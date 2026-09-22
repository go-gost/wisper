# wisper p2p 进程级 host + peer 路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wisper 反向侧改用进程级 p2p host + 按 peer key 路由（每条隧道一个标准 gost service），拿到 conn 与流量统计；出站侧（entrypoint）改用同一个共享 host。

**Architecture:** `tunnel/p2p_host.go` 的 manager（引用计数 + 路由 + per-peer 队列 listener）；`p2pTunnel` 与 `p2pEntryPoint` 都 `acquire/release`；隧道用 `peerListener + local handler → 后端` 的 service（stats/auth 免费）。

**Tech Stack:** Go（`github.com/go-gost/p2p` v0.4.2 的 `Tunnel.Listen()`/`Dial`、x 的 local handler/router/service）、Lit + TS、tag `p2ppoc` 的 e2e。

**Spec:** `docs/superpowers/specs/2026-09-22-p2p-inbound-listen-redesign.md`（依赖 p2p 仓的 [Tunnel.Listen 计划](https://github.com/go-gost/p2p/blob/main/docs/2026-09-22-p2p-host-listen.md) → `v0.4.2`）

**运行前置：** p2p `v0.4.2` 已发布并 bump；`TMPDIR=/config/tmp`；e2e 需 docker（derper 已缓存）。

---

### Task 1: p2p host manager（引用计数 + peer 路由）

**Files:**
- Create: `tunnel/p2p_host.go`、`tunnel/p2p_host_test.go`

- [ ] **Step 1: 写失败的测试**

`tunnel/p2p_host_test.go`（package `tunnel`）：覆盖 ① acquire 两次 refs=2、release 一次后 host 仍在、第二次 release 后关闭；② register 重复 peer 报错；③ 路由投递（直接向 manager 的 accept 路径注入？——不易注入，改为测 `peerListener` 的队列语义 + register/unregister 的查表）；④ 未登记 peer：通过一个假的 `net.Conn` 调用 `dispatch(conn)`（把 accept 循环的分发体抽成可测方法 `dispatch(conn net.Conn)`）断言 conn 被关闭。

要点（完整代码由实现者按此写）：

```go
func TestP2PHostManagerRefcount(t *testing.T) { /* t.Setenv XDG；acquire×2 → refs 2；release → host 仍非 nil；release → host nil */ }
func TestP2PHostManagerRoutes(t *testing.T) { /* register("k1") ok；register("k1") 报错；unregister 后可再注册 */ }
func TestP2PHostManagerDispatchUnknownPeer(t *testing.T) { /* dispatch(假 conn，RemoteAddr=peerAddr("unknown")) → conn 被 Close */ }
```

（假 conn：`net.Pipe()` 的一端即可，断言另一端读到 EOF/ErrClosed。）

- [ ] **Step 2: 跑测试确认失败** — `TMPDIR=/config/tmp go test -run TestP2PHostManager ./tunnel/` → undefined。

- [ ] **Step 3: 实现 `tunnel/p2p_host.go`**

```go
package tunnel

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/p2p"
	cfg "github.com/go-gost/wisper/config"
)

// p2pBacklog bounds each peer route's undelivered inbound streams; overflow is
// dropped (the transport is lossy by design).
var p2pBacklog = 64

// P2PHostKeyPath is the process-wide p2p identity: <config>/wisper/p2p/host.key
// (0600, created on first use). One host, one identity, shared by every p2p
// tunnel and entrypoint.
func P2PHostKeyPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wisper", "p2p", "host.key"), nil
}

// p2pHostManager owns the process-wide host: refcounted lifetime, the inbound
// accept loop, and the peer-key → tunnel routes.
type p2pHostManager struct {
	mu     sync.Mutex
	host   *p2p.Host
	ln     net.Listener
	routes map[string]*peerListener
	refs   int
}

var p2pHost = &p2pHostManager{routes: make(map[string]*peerListener)}

// acquire starts the host on first use (key + relay + Listen + accept loop) and
// takes a reference. A failed relay connection is not fatal: the engine retries
// in the background, so it is logged, never returned.
func (m *p2pHostManager) acquire() (*p2p.Host, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.host == nil {
		keyPath, err := P2PHostKeyPath()
		if err != nil {
			return nil, err
		}
		settings := cfg.Get().Settings
		direct := false
		conf := &p2p.Config{
			Derp:   P2PDerpURL(settings),
			Key:    keyPath,
			Direct: &direct,
		}
		conf.TLS = P2PTLSConfig(settings)
		host, err := p2p.New(conf)
		if err != nil {
			return nil, fmt.Errorf("p2p host: %w", err)
		}
		ln, err := host.Tunnel().Listen()
		if err != nil {
			_ = host.Close()
			return nil, err
		}
		if cerr := host.Connect(); cerr != nil {
			if log := logger.Default(); log != nil {
				log.Warnf("p2p derp connect: %v", cerr)
			}
		}
		m.host, m.ln = host, ln
		go m.acceptLoop(ln)
	}
	m.refs++
	return m.host, nil
}

// release drops one reference; the last one stops the host and every route.
func (m *p2pHostManager) release() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.refs > 0 {
		m.refs--
	}
	if m.refs > 0 || m.host == nil {
		return
	}
	if m.ln != nil {
		_ = m.ln.Close()
	}
	_ = m.host.Close()
	m.host, m.ln = nil, nil
	for k, pl := range m.routes {
		pl.close()
		delete(m.routes, k)
	}
}

// register routes inbound streams from peer to the returned listener. 1:1: a
// peer key belongs to at most one tunnel.
func (m *p2pHostManager) register(peer string) (net.Listener, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.routes[peer]; ok {
		return nil, fmt.Errorf("peer %s is already used by another p2p tunnel", peer)
	}
	pl := newPeerListener(peer)
	m.routes[peer] = pl
	return pl, nil
}

func (m *p2pHostManager) unregister(peer string, ln net.Listener) {
	m.mu.Lock()
	pl, ok := m.routes[peer]
	if ok && pl == ln {
		delete(m.routes, peer)
	}
	m.mu.Unlock()
	if ok && pl == ln {
		pl.close()
	}
}

// PublicKey returns the host's base64 key, or "" while the host is not running.
func (m *p2pHostManager) PublicKey() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.host == nil {
		return ""
	}
	return m.host.PublicKey()
}

func (m *p2pHostManager) acceptLoop(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		m.dispatch(conn)
	}
}

// dispatch routes one inbound conn by its remote address (the peer key); an
// unregistered peer is closed (explicit allowlist, no fallback).
func (m *p2pHostManager) dispatch(conn net.Conn) {
	peer := ""
	if a := conn.RemoteAddr(); a != nil {
		peer = a.String()
	}
	m.mu.Lock()
	pl := m.routes[peer]
	m.mu.Unlock()
	if pl == nil {
		if log := logger.Default(); log != nil {
			log.Warnf("p2p inbound stream from unregistered peer %s: closed", peer)
		}
		_ = conn.Close()
		return
	}
	pl.deliver(conn)
}

// peerListener is one peer's route, exposed as a net.Listener for a gost
// service: a bounded queue, lossy on overflow.
type peerListener struct {
	peer   string
	ch     chan net.Conn
	closed chan struct{}
	once   sync.Once
}

func newPeerListener(peer string) *peerListener {
	return &peerListener{peer: peer, ch: make(chan net.Conn, p2pBacklog), closed: make(chan struct{})}
}

func (l *peerListener) deliver(conn net.Conn) {
	select {
	case l.ch <- conn:
	case <-l.closed:
		_ = conn.Close()
	default:
		if log := logger.Default(); log != nil {
			log.Warnf("p2p inbound stream for peer %s dropped (backlog full)", l.peer)
		}
		_ = conn.Close()
	}
}

func (l *peerListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *peerListener) close() {
	l.once.Do(func() {
		close(l.closed)
		for {
			select {
			case c := <-l.ch:
				_ = c.Close()
			default:
				return
			}
		}
	})
}

func (l *peerListener) Close() error { l.close(); return nil }

// Addr is the peer's key: the route's identity, not a socket.
func (l *peerListener) Addr() net.Addr { return peerRouteAddr(l.peer) }

type peerRouteAddr string

func (a peerRouteAddr) Network() string { return "p2p" }
func (a peerRouteAddr) String() string  { return string(a) }
```

- [ ] **Step 4: 跑测试确认通过** — `gofmt -w` + `go build ./... && go vet ./tunnel/` + 三个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add tunnel/p2p_host.go tunnel/p2p_host_test.go
git commit -m "feat(tunnel): process-wide p2p host manager with peer routes"
```

---

### Task 2: p2pTunnel 改用 manager + service 接线

**Files:**
- Modify: `tunnel/p2p.go`

- [ ] **Step 1: 改造 Run()**

要点（镜像 `tunnel/entrypoint/tcp.go` 的服务接线，去掉 chain）：

```go
	// Peer is required: it is the route key and the value the user shares.
	if s.opts.Peer == "" {
		err = errors.New("p2p tunnel requires the peer public key")
		return
	}
	host, err := p2pHost.acquire()
	if err != nil { return }
	ln, err := p2pHost.register(s.opts.Peer)
	if err != nil { p2pHost.release(); return }

	log := ...（nil-guard 的 logger）
	h := local.NewHandler(
		handler.RouterOption(xchain.NewRouter(chain.LoggerRouterOption(log))),
		handler.LoggerOption(log),
	)
	if err = h.Init(mdx.NewMetadata(nil)); err != nil { p2pHost.unregister(s.opts.Peer, ln); p2pHost.release(); return }
	if fwd, ok := h.(handler.Forwarder); ok {
		fwd.Forward(hop.NewHop(hop.NodeOption(chain.NewNode(s.opts.Name, s.opts.Endpoint)), hop.LoggerOption(log)))
	}
	s.forward = xservice.NewService(s.opts.Name, ln, h, xservice.LoggerOption(log), xservice.StatsOption(pStats))
	go func() { _ = s.forward.Serve() }()
```
- 删除旧的 `p2p.New{Targets: ...}` 与 `host` 字段（改由 manager 持有）；`Close()` 改为 `forward.Close()` + `p2pHost.unregister(peer, ln)` + `p2pHost.release()`（幂等，`ln` 存字段）。
- `Entrypoint()` 返回 `s.opts.Peer`（本机身份上移到设置页）；`Endpoint()` 不变（本地后端）。
- stats：service 的 `pStats` 按既有 `Stats()`/`StatsBaseline()` 透传（照抄 tcp.go 的 pstats 初始化块）。

- [ ] **Step 2: 更新单测 `tunnel/p2p_test.go`**

- 原 key 生命周期测试（per-tunnel key）删除，改为：`Run()` 无 peer → 报错；`Run()`（假 relay + peer）→ running 且 manager refs=1；`Close()` 幂等且 refs=0、`host.key` 生成 0600 并保留。
- 保留/改写 `TestP2PDerpDefault`、`TestP2PTLSConfig` 不变。

- [ ] **Step 3: 验证 + 提交**

Run: `TMPDIR=/config/tmp go test ./tunnel/ ./api/ && go build ./... && go vet ./tunnel/`

```bash
git add tunnel/p2p.go tunnel/p2p_test.go
git commit -m "feat(tunnel): p2p tunnel serves via the shared host and peer route"
```

---

### Task 3: p2pEntryPoint 迁移到共享 host

**Files:**
- Modify: `tunnel/entrypoint/p2p.go`（+ 其单测）

- [ ] **Step 1: 迁移**

- `Run()`：删掉自己的 `p2p.New(...)`/`host` 字段；改为 `host, err := tunnel.P2PManager().acquire()`（manager 需在 `tunnel` 包导出一个获取入口，如 `func AcquireP2PHost() (*p2p.Host, error)` / `func ReleaseP2PHost()` / `func P2PPublicKey() string`——按实现时的取舍命名，保持最小导出面）。
- provider 注册改用 `host.Tunnel()`；`Close()` 里 `release()`；key 文件（per-entrypoint）不再创建（`P2PKeyPath` 对入口点不再使用；删除入口点时对遗留 key 的清理逻辑可保留）。
- 其余（chain 打补丁、ParseChain、service 接线）不变。

- [ ] **Step 2: 更新单测**：`TestP2PEntryPointLifecycle` 改为断言共享 host 的 refs 与 provider 注册/注销；`host.key` 0600；不再断言 per-entrypoint key。

- [ ] **Step 3: 验证 + 提交**

Run: `TMPDIR=/config/tmp go test ./tunnel/... && go build ./... && go vet ./tunnel/...`

```bash
git add tunnel/entrypoint/p2p.go tunnel/entrypoint/p2p_test.go tunnel/p2p_host.go
git commit -m "feat(entrypoint): p2p entrypoint uses the shared host identity"
```

---

### Task 4: API——本机 p2p 身份

**Files:**
- Modify: `api/server.go`（路由）、新建 `api/p2p_handler.go`

- [ ] **Step 1: 新端点**

`GET /api/p2p` → `{"public_key": "<base64 or empty>"}`（来自 manager 的 `PublicKey()`；host 未启动时返回空串，不报错）。在 `api/server.go` 按现有路由注册方式挂上（读该文件照抄一条 `mux.HandleFunc`）。

- [ ] **Step 2: 验证 + 提交**

Run: `go build ./... && TMPDIR=/config/tmp go test ./api/`

```bash
git add api/p2p_handler.go api/server.go
git commit -m "feat(api): expose the process-wide p2p identity"
```

---

### Task 5: UI

**Files:**
- Modify: `web-src/src/api/types.ts`、`web-src/src/pages/settings-page.ts`、`web-src/src/pages/tunnel-detail-page.ts`、`web-src/src/api/backend.ts`、`web-src/src/i18n/{en,zh}.ts`

- [ ] **Step 1: 隧道表单/详情加 peer**

`tunnel-detail-page.ts`：p2p 类型时（create/edit）加 **Peer public key** 输入（绑定 `_peer`，payload `peer`；加载时从 `options.peer` 回填）——完全镜像入口点页的 `_peer` 实现。view 模式下 p2p 隧道的 `entrypoint` 行现在即 peer（后端已改）✓ 无需额外展示；若已有"本机 pubkey"相关文案，一并清理。

- [ ] **Step 2: 设置页身份区**

`backend.ts` 加 `getP2PIdentity()`（GET `/api/p2p`）；`settings-page.ts` 在 P2P 设置区上方加"P2P Identity"行：显示 `public_key`（copyable）+ 提示文案 `t('p2pIdentityHint')`；为空时显示 `t('p2pIdentityIdle')`。

- [ ] **Step 3: i18n**（en/zh）

```ts
  p2pIdentity: 'P2P Identity',
  p2pIdentityHint: 'Share this key with peers: their p2p entrypoint dials this host by it.',
  p2pIdentityIdle: 'Not running yet — start a p2p tunnel or entrypoint to create the identity.',
  fieldPeerKey: 'Peer public key',   // 若入口点页已有 entrypointPeerKey，可复用同值
```
中文对应。

- [ ] **Step 4: 构建 + 验证**

`cd web-src && npm run typecheck`；`make web`；`go build ./... && TMPDIR=/config/tmp go test ./api/ ./tunnel/...`；再用 curl 验证 `/api/p2p`（起一个 p2p 隧道后 key 非空、0600 的 host.key 存在）。

- [ ] **Step 5: 提交**

```bash
git add web-src/src web/
git commit -m "feat(ui): p2p identity card and the tunnel peer field"
```

---

### Task 6: e2e 改造 + bump

**Files:**
- Modify: `tunnel/p2p_e2e_test.go`、`tunnel/p2p_entrypoint_e2e_test.go`、`go.mod`

- [ ] **Step 1: 反向 e2e 改为 peer 路由 + 断言 stats**

`TestP2PTunnelAcceptsPeerByKey`：对端 host 用固定 KeyHex（如 `"44"*32`）→ 其 `PublicKey()` 作为隧道的 `PeerOption`；回环成功后**断言隧道 stats 非零**（`tn.Stats().InputBytes > 0 && OutputBytes > 0`，stats 由 service 的 pStats 实时累计——注意 runner 不在测试里，直接读 `tn.Stats()` 若为空则读 `tn.Status()` 的计数，按实现选择可断言的口径）。

- [ ] **Step 2: 出站 e2e**：仅确认仍通过（entrypoint 走共享 host 后行为不变）。

- [ ] **Step 3: bump + 验证**

`GOWORK=off go get github.com/go-gost/p2p@v0.4.2 && GOWORK=off go mod tidy`；`TMPDIR=/config/tmp go test -tags p2ppoc -count=1 -run TestP2P -v ./tunnel/ ./tunnel/entrypoint/` 全绿；`GOWORK=off` 再跑一次。

- [ ] **Step 4: 提交**

```bash
git add go.mod go.sum tunnel/p2p_e2e_test.go tunnel/p2p_entrypoint_e2e_test.go
git commit -m "test(tunnel): peer-routed reverse e2e with stats; bump p2p v0.4.2"
```

---

### Task 7: 文档

**Files:**
- Modify: `docs/p2p-integration.md`

- [ ] **Step 1: 改写反向侧一节**

- 反向侧 = 进程级 host（一份身份，设置页可见）+ 每条隧道填**对端公钥**（白名单，1:1）；
  未登记 peer 的入站流直接关闭。
- 隧道 stats/auth/录制来自标准 gost service（与入口点对称）。
- 旧模型（每隧道一份 key、`Config.Targets`）标注为已被取代。
- 保留：安全边界（pubkey=地址，白名单=准入）、key 文件位置（`host.key` 0600）、relay 语义。

- [ ] **Step 2: 校验 + 提交**

```bash
git add docs/p2p-integration.md
git commit -m "docs: the peer-routed reverse side (shared host identity)"
```

---

## Self-Review 记录

- **Spec 覆盖**：manager（refcount/路由/白名单/1:1）→ Task 1；隧道改造（service + stats）→ Task 2；entrypoint 共享 host → Task 3；身份 API → Task 4；UI（身份区 + peer 字段）→ Task 5；e2e（stats 断言）+ bump → Task 6；文档 → Task 7。
- **占位符**：Task 1 给了完整实现；Task 2/3 给出要点与镜像对象（tcp.go），实现者按既有样板补齐——与前一计划同法。Task 6 的 stats 断言口径留了两选一，实现者按可断言者取。
- **类型一致性**：`p2pHost`/`acquire`/`release`/`register`/`unregister`/`dispatch`/`peerListener`/`P2PHostKeyPath`/`p2pBacklog` 在 Task 1–3 一致；导出面（Task 3 的 acquire/release/PublicKey 包装）命名以实现为准，计划已注明"保持最小导出面"。
- **风险**：manager 是进程级单例——测试用 `t.Setenv("XDG_CONFIG_HOME", t.TempDir())` 隔离 key；`refs` 计数在测试间必须归零（每个测试 `defer release`）。
