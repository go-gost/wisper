# p2p Host.Listen（入站流交付 embedder）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** p2p host 支持把**入站 peer 流以 conn 交给 embedder**（`Host.Listen()`），host 不再自己桥 target；为 wisper 的进程级 host + peer 路由铺路。

**Architecture:** engine 侧新增"入站队列"（`Host.Listen()` 创建并独占消费）；`serveInbound` 的未打标签路径在队列存在时改为投递而非桥接；合成地址携带 peer key。

**Tech Stack:** Go（本仓 `github.com/go-gost/p2p`）、`engine_test.go` 的进程内测试 relay。

**Spec:** `../wisper/docs/superpowers/specs/2026-09-22-p2p-inbound-listen-redesign.md`

**运行前置：** 工作目录 `../p2p`（本仓）；`GOWORK=off` 独立构建须过；`TMPDIR=/config/tmp`；测试 `CGO_ENABLED=1 -race`。

---

### Task 1: `Host.Listen()` + 入站队列

**Files:**
- Modify: `engine.go`（队列字段 + 投递）、`direct.go`（`serveInbound` 分支）、`host.go`（`Listen()` + Close 联动）
- Create: `inbound.go`（队列 + listener + 合成地址）
- Test: `inbound_test.go`

- [ ] **Step 1: 写失败的测试**

`inbound_test.go`（与既有 `engine_test.go` 同包，复用其进程内 relay 辅助——按 `engine_test.go` 里现成的 `newTestEngine`/relay helper 取名）：

```go
package p2p

import (
	"context"
	"io"
	"testing"
	"time"
)

// TestHostListen: with Listen the host hands inbound peer streams to the
// embedder instead of bridging them to a target; the conn carries the peer's
// key as its remote address.
func TestHostListen(t *testing.T) {
	rs := &relayServer{}       // engine_test.go's in-process DERP-style relay
	url := rs.start(t)
	a := newListenTestHost(t, url, strings.Repeat("aa", 32))
	b := newListenTestHost(t, url, strings.Repeat("bb", 32))

	ln, err := b.Listen()
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	// A opens a tunnel to B; B accepts it and both ends exchange bytes.
	client, err := a.Provider().OpenTunnelStream(context.Background(), "tcp", b.PublicKey())
	if err != nil {
		t.Fatalf("open tunnel: %v", err)
	}
	defer client.Close()

	type res struct {
		conn net.Conn
		err  error
	}
	accepted := make(chan res, 1)
	go func() {
		c, err := ln.Accept()
		accepted <- res{c, err}
	}()

	var srv net.Conn
	select {
	case r := <-accepted:
		if r.err != nil {
			t.Fatalf("accept: %v", r.err)
		}
		srv = r.conn
	case <-time.After(10 * time.Second):
		t.Fatal("accept timed out")
	}
	defer srv.Close()

	if got := srv.RemoteAddr().String(); got != a.PublicKey() {
		t.Fatalf("RemoteAddr = %q, want A's key %q", got, a.PublicKey())
	}
	if got := srv.RemoteAddr().Network(); got != "p2p" {
		t.Fatalf("RemoteAddr network = %q, want p2p", got)
	}

	msg := []byte("hello inbound")
	if _, err := client.Write(msg); err != nil {
		t.Fatal(err)
	}
	srv.SetReadDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(srv, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != string(msg) {
		t.Fatalf("got %q, want %q", buf, msg)
	}
	if _, err := srv.Write([]byte("ack")); err != nil {
		t.Fatal(err)
	}
	client.SetReadDeadline(time.Now().Add(5 * time.Second))
	ack := make([]byte, 3)
	if _, err := io.ReadFull(client, ack); err != nil {
		t.Fatalf("read ack: %v", err)
	}
}

// TestListenWithTargetsErrors: Targets and Listen are mutually exclusive.
func TestListenWithTargetsErrors(t *testing.T) {
	rs := &relayServer{}
	url := rs.start(t)
	direct := false
	h, err := New(&Config{Derp: url, KeyHex: strings.Repeat("cc", 32), Direct: &direct, Targets: []string{"tcp://127.0.0.1:9"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close() })
	if _, err := h.Listen(); err == nil {
		t.Fatal("Listen with configured targets = nil error, want a failure")
	}
}

// newListenTestHost builds a connected in-process host for the Listen tests.
func newListenTestHost(t *testing.T, url, keyHex string) *Host {
	t.Helper()
	direct := false
	h, err := New(&Config{Derp: url, KeyHex: keyHex, Direct: &direct})
	if err != nil {
		t.Fatalf("new host: %v", err)
	}
	t.Cleanup(func() { _ = h.Close() })
	if err := h.Connect(); err != nil {
		t.Fatalf("connect: %v", err)
	}
	return h
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd p2p && TMPDIR=/config/tmp CGO_ENABLED=1 go test -race -run 'TestHostListen|TestListenWithTargetsErrors' .`
Expected: FAIL — `undefined: (*Host).Listen`。

- [ ] **Step 3: 实现**

`inbound.go`：

```go
package p2p

import (
	"errors"
	"net"
	"sync"
)

// inboundBacklog bounds how many accepted-but-undelivered inbound streams the
// host holds; a var so tests can shrink it. Overflow is dropped and logged.
var inboundBacklog = 64

// peerAddr is the synthetic address of a p2p peer: Network "p2p", String the
// base64 public key.
type peerAddr struct{ key string }

func (a peerAddr) Network() string { return "p2p" }
func (a peerAddr) String() string  { return a.key }

// inboundStream is one peer tunnel stream waiting for the embedder.
type inboundStream struct {
	conn    net.Conn
	peer    string
	transport string
	peerAddr  string
}

// inboundQueue carries inbound streams from the engine to Listen's listener.
type inboundQueue struct {
	ch     chan inboundStream
	closed chan struct{}
	once   sync.Once
}

func newInboundQueue() *inboundQueue {
	return &inboundQueue{
		ch:     make(chan inboundStream, inboundBacklog),
		closed: make(chan struct{}),
	}
}

// deliver hands one inbound stream to the embedder; when the backlog is full
// the stream is closed and dropped (lossy, documented).
func (q *inboundQueue) deliver(conn net.Conn, peer, transport, peerAddr string, log *slog.Logger) {
	select {
	case q.ch <- inboundStream{conn: conn, peer: peer, transport: transport, peerAddr: peerAddr}:
	case <-q.closed:
		conn.Close()
	default:
		log.Warn("inbound stream dropped (backlog full)", "peer", peer)
		conn.Close()
	}
}

func (q *inboundQueue) close() {
	q.once.Do(func() {
		close(q.closed)
		for {
			select {
			case s := <-q.ch:
				s.conn.Close()
			default:
				return
			}
		}
	})
}

// inboundListener is the net.Listener returned by Host.Listen.
type inboundListener struct {
	q    *inboundQueue
	host string // the host's own base64 key, for LocalAddr
}

func (l *inboundListener) Accept() (net.Conn, error) {
	select {
	case s := <-l.q.ch:
		return &inboundConn{Conn: s.conn, local: peerAddr{key: l.host}, remote: peerAddr{key: s.peer}}, nil
	case <-l.q.closed:
		return nil, net.ErrClosed
	}
}

func (l *inboundListener) Close() error { l.q.close(); return nil }
func (l *inboundListener) Addr() net.Addr { return peerAddr{key: l.host} }

// inboundConn overrides the addresses: the transport conn's own addrs are
// smux-internal and meaningless to the embedder.
type inboundConn struct {
	net.Conn
	local, remote net.Addr
}

func (c *inboundConn) LocalAddr() net.Addr  { return c.local }
func (c *inboundConn) RemoteAddr() net.Addr { return c.remote }
```



`engine.go`：`engine` 结构加字段 `inbound *inboundQueue`（nil = 未启用）。

`host.go`：

```go
// Listen returns a listener over inbound peer tunnel streams. Each accepted
// conn's RemoteAddr() carries the peer's base64 public key; the conn's bytes
// are the peer's tunnel exactly as they arrived (no framing on tcp). Streams
// arriving before Listen is called, or while the backlog is full, are closed
// and dropped. It is mutually exclusive with Config.Targets: with targets
// configured the host bridges inbound tunnels internally (the CLI behaviour).
// Single consumer: calling it twice returns the same listener.
func (h *Host) Listen() (net.Listener, error) {
	if h.engine == nil {
		return nil, errors.New("p2p: Listen requires derp mode")
	}
	if len(h.cfg.TargetList()) > 0 {
		return nil, errors.New("p2p: Listen and Config.Targets are mutually exclusive")
	}
	h.listenOnce.Do(func() {
		h.engine.inbound = newInboundQueue()
		h.listener = &inboundListener{q: h.engine.inbound, host: h.PublicKey()}
	})
	return h.listener, nil
}
```
（`Host` 加 `listenOnce sync.Once`、`listener net.Listener` 字段；`Close()` 里若 `h.listener != nil` 调 `h.listener.Close()`。）

`direct.go` 的 `serveInbound` 未打标签路径改为：

```go
	// Listen mode: the embedder owns the stream (and its target).
	if e.inbound != nil {
		e.inbound.deliver(stream, keyName(peer), transport, peerAddr, e.log)
		return
	}
	target, ok := e.targets.pick("tcp")
	if !ok {
		e.log.Warn("inbound tunnel refused", "transport", transport, "peer", keyName(peer))
		stream.Close()
		return
	}
	bridgeInbound(stream, transport, keyName(peer), peerAddr, target, e.log)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd p2p && gofmt -w inbound.go engine.go direct.go host.go && GOWORK=off go build ./... && GOWORK=off go vet ./... && TMPDIR=/config/tmp CGO_ENABLED=1 go test -race -count=1 -run 'TestHostListen|TestListenWithTargetsErrors' -v .`
Expected: PASS；build/vet 干净。

- [ ] **Step 5: 提交**

```bash
git add inbound.go inbound_test.go engine.go direct.go host.go
git commit -m "p2p: hand inbound peer streams to the embedder (Host.Listen)"
```

---

### Task 2: backlog 溢出行为测试 + 全量回归

**Files:**
- Modify: `inbound_test.go`

- [ ] **Step 1: 写溢出测试**

```go
// TestListenBacklogOverflow: a stream arriving with a full backlog is dropped
// and closed, not queued forever.
func TestListenBacklogOverflow(t *testing.T) {
	old := inboundBacklog
	inboundBacklog = 1
	t.Cleanup(func() { inboundBacklog = old })
	// 起 relay + 两个 host；B.Listen()；A 连续开两条隧道（不 Accept）→
	// 第一条进队列，第二条被丢弃：A 侧写入应失败或读不到回环。
	// 断言方式：A 的第二条 conn 上 Write 一个字节后，1s 内 Read 得到错误/EOF。
}
```

（按上面注释实现；用 `strings.Repeat` 的 key 与 Task 1 同款辅助。）

- [ ] **Step 2: 跑测试 + 全量**

Run: `cd p2p && TMPDIR=/config/tmp CGO_ENABLED=1 go test -race -p 1 -count=1 ./...`
Expected: 全绿（含既有 engine/direct/udp/e2e 包）。

- [ ] **Step 3: 提交**

```bash
git add inbound_test.go
git commit -m "p2p: test the Listen backlog overflow"
```

---

### Task 3: 文档 + 发布 v0.4.2

- [ ] **Step 1: 更新 CLAUDE.md 的架构段落**

在 `CLAUDE.md` 的「Architecture (two planes)」数据面段落补一段（英文，与全文一致）：

```markdown
**Embedder mode** (`Host.Listen`): an in-process embedder can take inbound peer
streams as conns instead of letting the host bridge them to `--target` (mutually
exclusive with `Config.Targets`). Each accepted conn's `RemoteAddr()` carries the
peer's base64 key, so the embedder can route by peer, own the service stack
(stats, auth, recording) and skip the target pool entirely.
```

- [ ] **Step 2: 验证 + 提交**

Run: `cd p2p && GOWORK=off go build ./... && GOWORK=off go vet ./...`

```bash
git add CLAUDE.md
git commit -m "p2p: document the embedder Listen mode"
```

- [ ] **Step 3: 发布（需用户确认后执行）**

```bash
git push && git tag v0.4.2 && git push origin v0.4.2
```

---

## Self-Review 记录

- **Spec 覆盖**：`Listen()` 契约（互斥、合成地址、backlog、单消费者）→ Task 1；溢出行为 → Task 2；文档/发布 → Task 3。spec 里"不需要计数 API"→ 计划里确实没有计数改动 ✓。
- **占位符**：溢出测试（Task 2）给了断言方式而非完整代码（复用 Task 1 的辅助），实现者按样板补齐。
- **类型一致性**：`inboundQueue`/`inboundStream`/`inboundListener`/`inboundConn`/`peerAddr`/`inboundBacklog` 命名一致；`engine.inbound`、`Host.listener`/`listenOnce` 在 Task 1 内自洽。
- **风险**：`Host.Listen()` 需在 `Connect()` 之前调用才能保证不漏流入流（文档写明）；smux 流的 `CloseWrite` 语义由 `inboundConn` 透传（`net.Conn` 无该方法，embedder 侧如需要半关需类型断言——wisper 侧用 gost 的 pipe，无需半关）。
