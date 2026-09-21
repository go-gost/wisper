# p2p UDP 入口点限制验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用进程内 e2e（真 derper + 两个进程内 p2p host + wisper 的 udp 入口点栈）实测入口点形态在 p2p udp 隧道上的行为，产出精确签名并写回 `docs/p2p-integration.md`。

**Architecture:** 单个测试文件（build tag `p2ppoc`）承载 harness 与 R0–R3 四个 run；测试内用两个 provider 包装（寻址 shim、framing shim）分离三个候选缺陷；产品代码零改动。

**Tech Stack:** Go test（tag `p2ppoc`）、`github.com/go-gost/p2p`（进程内 Provider）、`github.com/go-gost/x`（listener/handler/chain/registry）、derper 二进制（`gogost/derper` 镜像提取，或 `DERPER_BIN`）。

**Spec:** `docs/superpowers/specs/2026-09-21-p2p-udp-entrypoint-verification-design.md`

**运行前置：** 需要 `docker`（提取 derper；或设 `DERPER_BIN`）；无需 root / netns。所有 `go test` 命令都带 `TMPDIR=/config/tmp`（本机 /tmp 是 tmpfs）。

**任务顺序理由：** 先 R2 基线（证明 harness 数据面正确），再 R0/R1（各自归因一个缺陷），最后 R3（碰撞）。R0–R3 的断言按**实测**填写：预测与实测不符时，改断言为实测签名并在 Task 6 的文档里记录实际值（R2 若不通则停下重定位，见 spec 判定规则）。

---

### Task 1: derper helper + 冒烟测试

**Files:**
- Create: `tunnel/p2p_udp_poc_test.go`

- [ ] **Step 1: 写冒烟测试（先失败）**

创建 `tunnel/p2p_udp_poc_test.go`，先只放文件头、import 和这一个测试：

```go
//go:build p2ppoc

// UDP entrypoint over p2p: the shapes docs/p2p-integration.md left open, run
// over the stack wisper's udp entrypoint actually builds
// (tunnel/entrypoint/udp.go Run()): a local udp listener -> local forward
// handler -> a chain whose node is a p2p udp tunnel -> a peer host holding a
// udp target outlet.
//
// Runs:
//
//	R0  addressing as-is: the local handler appends ":0" to the peer key,
//	    which parsePeerKey rejects, so the tunnel dial fails before data flows.
//	R1  addressing shim only: the in-process provider's conn carries no
//	    datagram framing (the gRPC plugin's does), so the outlet's frame
//	    parser never sees a frame.
//	R2  addressing + framing shims: the baseline datagram path.
//	R3  two concurrent clients on R2: the second dial replaces the channel's
//	    local edge (last-dial-wins) and frames carry no client identity, so an
//	    in-flight reply is cross-delivered.
//
// Run:
//
//	TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/
//
// Needs docker to extract the derper binary from gogost/derper (or DERPER_BIN);
// the tests skip without it. No root, no network namespaces.
package tunnel_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-gost/core/chain"
	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/p2p"
	"github.com/go-gost/plugin/p2p/proto"
	xchain "github.com/go-gost/x/chain"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward"
	_ "github.com/go-gost/x/dialer/udp"
	"github.com/go-gost/x/handler/forward/local"
	"github.com/go-gost/x/hop"
	xudp "github.com/go-gost/x/listener/udp"
	mdx "github.com/go-gost/x/metadata"
	xp2p "github.com/go-gost/x/p2p"
	"github.com/go-gost/x/p2p/streamconn"
	"github.com/go-gost/x/registry"
	xservice "github.com/go-gost/x/service"

	wtunnel "github.com/go-gost/wisper/tunnel"
)

const p2pUDPProvider = "p2p-udp-poc"

// TestP2PUDPDerperUp isolates the relay: derper extracts, starts on a free
// high port and accepts a TCP connection.
func TestP2PUDPDerperUp(t *testing.T) {
	url := startDerper(t)
	if !strings.HasPrefix(url, "wss://127.0.0.1:") || !strings.HasSuffix(url, "/derp") {
		t.Fatalf("derper url = %q", url)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDPDerperUp -v ./tunnel/`
Expected: FAIL — `undefined: startDerper`

- [ ] **Step 3: 实现 derper helpers**

在 `TestP2PUDPDerperUp` 之后追加：

```go
// derperBin returns the derper binary to run: $DERPER_BIN if set, the p2p e2e
// cache if present, or a fresh extraction from the gogost/derper image. The
// test skips when neither a binary nor docker is available.
func derperBin(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("DERPER_BIN"); p != "" {
		return p
	}
	const cache = "/tmp/p2p-e2e/derper-root/usr/local/bin/derper"
	if fi, err := os.Stat(cache); err == nil && fi.Mode()&0o111 != 0 {
		return cache
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("derper unavailable: no DERPER_BIN, no cached binary, no docker")
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(cache)))) // .../derper-root
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Skipf("derper cache dir: %v", err)
	}
	name := fmt.Sprintf("p2p-udp-poc-derper-%d", os.Getpid())
	if out, err := exec.Command("docker", "create", "--name", name, "gogost/derper").CombinedOutput(); err != nil {
		t.Skipf("docker create gogost/derper: %v (%s)", err, out)
	}
	defer exec.Command("docker", "rm", name).Run()
	cmd := exec.Command("sh", "-c", fmt.Sprintf("docker export %s | tar -C %s -xf -", name, root))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("extract derper: %v (%s)", err, out)
	}
	if fi, err := os.Stat(cache); err != nil || fi.Mode()&0o111 == 0 {
		t.Skip("derper not found in the image")
	}
	return cache
}

// writeSelfSignedCert writes <dir>/<host>.crt and .key — the names derper's
// manual cert mode expects.
func writeSelfSignedCert(t *testing.T, dir, host string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: host},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IPAddresses:           []net.IP{net.ParseIP(host)},
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if err := os.WriteFile(filepath.Join(dir, host+".crt"), certPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, host+".key"), keyPEM, 0o600); err != nil {
		t.Fatal(err)
	}
}

// freePort returns a currently free loopback TCP port.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// startDerper runs the relay on a free high port (no root) and waits for its
// listener. It returns the wss URL the hosts dial.
func startDerper(t *testing.T) string {
	t.Helper()
	bin := derperBin(t)
	dir := t.TempDir()
	certDir := filepath.Join(dir, "certs")
	writeSelfSignedCert(t, certDir, "127.0.0.1")
	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))

	logPath := filepath.Join(dir, "derper.log")
	logf, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(bin,
		"-c", filepath.Join(dir, "derper.json"),
		"-hostname", "127.0.0.1",
		"-certmode", "manual",
		"-certdir", certDir,
		"-a", addr,
		"-http-port", "-1",
		"-stun=false",
	)
	cmd.Stdout, cmd.Stderr = logf, logf
	if err := cmd.Start(); err != nil {
		t.Fatalf("start derper: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		logf.Close()
	})

	deadline := time.Now().Add(25 * time.Second)
	for {
		c, err := net.DialTimeout("tcp", addr, time.Second)
		if err == nil {
			c.Close()
			break
		}
		if time.Now().After(deadline) {
			b, _ := os.ReadFile(logPath)
			t.Fatalf("derper did not listen on %s: %v\n%s", addr, err, b)
		}
		time.Sleep(200 * time.Millisecond)
	}
	return "wss://" + addr + "/derp"
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDPDerperUp -v ./tunnel/`
Expected: PASS（首次会 docker export 提取 derper，~10s）

- [ ] **Step 5: 提交**

```bash
git add tunnel/p2p_udp_poc_test.go
git commit -m "test(tunnel): run derper from the local image for the p2p udp harness"
```

---

### Task 2: harness（hosts + 入口点栈 + echo）+ R2 基线

**Files:**
- Modify: `tunnel/p2p_udp_poc_test.go`

- [ ] **Step 1: 写 R2 基线测试（先失败）**

追加：

```go
// TestP2PUDPFramedBaseline is R2: with the addressing and framing shims the
// datagram path is correct — the baseline that proves R1's failure is framing,
// not the harness.
func TestP2PUDPFramedBaseline(t *testing.T) {
	entry := startUDPEntrypoint(t, func(pr xp2p.TunnelProvider) xp2p.TunnelProvider {
		return framedProvider{inner: stripPortProvider{inner: pr}}
	}, 0)

	c := udpClient(t, entry)
	udpSend(t, c, "ping-r2")
	got, err := udpRead(t, c, 5*time.Second)
	if err != nil {
		t.Fatalf("round trip through the udp entrypoint: %v", err)
	}
	if got != "ping-r2" {
		t.Fatalf("echo = %q, want ping-r2", got)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDPFramedBaseline -v ./tunnel/`
Expected: FAIL — `undefined: startUDPEntrypoint` 等

- [ ] **Step 3: 实现 echo、shims、harness、client helpers**

追加：

```go
// startUDPEcho starts a UDP echo server; replies are delayed by d (R3 uses the
// delay to engineer the overlap).
func startUDPEcho(t *testing.T, d time.Duration) string {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 2048)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			p := append([]byte(nil), buf[:n]...)
			go func() {
				if d > 0 {
					time.Sleep(d)
				}
				_, _ = pc.WriteTo(p, addr)
			}()
		}
	}()
	return pc.LocalAddr().String()
}

// stripPortProvider drops a ":port" suffix from the peer before the tunnel is
// opened. Test-local: it stands in for the addressing fix the entrypoint shape
// needs (the local handler appends ":0" to a key-shaped node addr).
type stripPortProvider struct{ inner xp2p.TunnelProvider }

func (p stripPortProvider) Close() error { return p.inner.Close() }

func (p stripPortProvider) OpenTunnelStream(ctx context.Context, network, peer string) (net.Conn, error) {
	if host, _, err := net.SplitHostPort(peer); err == nil {
		peer = host
	}
	return p.inner.OpenTunnelStream(ctx, network, peer)
}

// framedProvider adapts the in-process provider's raw conn to the datagram
// framing the gRPC plugin path gets from x/p2p/streamconn. Test-local: it
// stands in for the missing production wrapper.
type framedProvider struct{ inner xp2p.TunnelProvider }

func (p framedProvider) Close() error { return p.inner.Close() }

func (p framedProvider) OpenTunnelStream(ctx context.Context, network, peer string) (net.Conn, error) {
	c, err := p.inner.OpenTunnelStream(ctx, network, peer)
	if err != nil || network != "udp" {
		return c, err
	}
	return streamconn.New(connStream{c: c}, func() { c.Close() }, "udp", c.LocalAddr(), c.RemoteAddr()), nil
}

// connStream presents a net.Conn as a streamconn.Stream.
type connStream struct{ c net.Conn }

func (s connStream) Send(ch *proto.Chunk) error {
	_, err := s.c.Write(ch.GetData())
	return err
}

func (s connStream) Recv() (*proto.Chunk, error) {
	b := make([]byte, 32*1024)
	n, err := s.c.Read(b)
	if n > 0 {
		return &proto.Chunk{Data: b[:n]}, nil
	}
	return nil, err
}

func (s connStream) Context() context.Context { return context.Background() }

// startUDPEntrypoint runs the whole shape and returns the entrypoint's local
// udp address. wrap adapts the registered provider (nil = as shipped).
func startUDPEntrypoint(t *testing.T, wrap func(xp2p.TunnelProvider) xp2p.TunnelProvider, echoDelay time.Duration) string {
	t.Helper()
	derp := startDerper(t)
	echo := startUDPEcho(t, echoDelay)

	direct, secure := false, false
	newHost := func(keyHex string, targets []string) *p2p.Host {
		h, err := p2p.New(&p2p.Config{
			Derp:    derp,
			KeyHex:  keyHex,
			Direct:  &direct,
			TLS:     &p2p.TLSConfig{Secure: &secure},
			Targets: targets,
		}, p2p.WithLogger(slog.Default()))
		if err != nil {
			t.Fatalf("new p2p host: %v", err)
		}
		t.Cleanup(func() { _ = h.Close() })
		if err := h.Connect(); err != nil {
			t.Fatalf("p2p connect to derper: %v", err)
		}
		return h
	}
	// B holds the udp target outlet; A dials out through the tunnel.
	outlet := newHost(strings.Repeat("11", 32), []string{"udp://" + echo})
	dialer := newHost(strings.Repeat("22", 32), nil)

	var pr xp2p.TunnelProvider = dialer.Provider()
	if wrap != nil {
		pr = wrap(pr)
	}
	if err := registry.P2PRegistry().Register(p2pUDPProvider, pr); err != nil {
		t.Fatalf("register provider: %v", err)
	}
	t.Cleanup(func() { registry.P2PRegistry().Unregister(p2pUDPProvider) })

	// Mirror tunnel/entrypoint/udp.go Run(): patch the chain node onto the p2p
	// peer, then wire the udp listener + local handler + router + hop.
	chCfg := wtunnel.ChainConfig("p2p-udp-poc", "p2p-udp-poc", "off")
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = outlet.PublicKey()
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "udp"}
	node.Metadata = map[string]any{"p2p": p2pUDPProvider}

	log := clogger.Default().WithFields(map[string]any{"kind": "service", "service": "p2p-udp-poc"})
	ch, err := chain_parser.ParseChain(chCfg, log)
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}

	ln := xudp.NewListener(
		listener.AddrOption("127.0.0.1:0"),
		listener.LoggerOption(log),
	)
	if err := ln.Init(mdx.NewMetadata(nil)); err != nil {
		t.Fatalf("listener init: %v", err)
	}

	h := local.NewHandler(
		handler.RouterOption(xchain.NewRouter(
			chain.ChainRouterOption(ch),
			chain.LoggerRouterOption(log),
		)),
		handler.LoggerOption(log),
	)
	if err := h.Init(mdx.NewMetadata(nil)); err != nil {
		t.Fatalf("handler init: %v", err)
	}
	h.(handler.Forwarder).Forward(hop.NewHop(
		hop.NodeOption(chain.NewNode("p2p-udp-poc", outlet.PublicKey())),
		hop.LoggerOption(log),
	))

	svc := xservice.NewService("p2p-udp-poc", ln, h, xservice.LoggerOption(log))
	go func() { _ = svc.Serve() }()
	t.Cleanup(func() { _ = svc.Close() })

	return ln.Addr().String()
}

// udpClient dials the entrypoint with a distinct source port.
func udpClient(t *testing.T, entry string) net.Conn {
	t.Helper()
	c, err := net.Dial("udp", entry)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c
}

// udpSend sends one datagram.
func udpSend(t *testing.T, c net.Conn, payload string) {
	t.Helper()
	if err := c.SetWriteDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write([]byte(payload)); err != nil {
		t.Fatalf("send %q: %v", payload, err)
	}
}

// udpRead waits for one datagram.
func udpRead(t *testing.T, c net.Conn, timeout time.Duration) (string, error) {
	t.Helper()
	if err := c.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 2048)
	n, err := c.Read(buf)
	if err != nil {
		return "", err
	}
	return string(buf[:n]), nil
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDPFramedBaseline -v ./tunnel/`
Expected: PASS（~5s）。若 FAIL：先看 p2p host 日志（slog 输出）确认 tunnel/channel 是否建立；仍不通则**停止**，按 spec 判定规则回到静态分析（不要硬改断言）。

- [ ] **Step 5: 提交**

```bash
git add tunnel/p2p_udp_poc_test.go
git commit -m "test(tunnel): in-process udp entrypoint harness over a real derper"
```

---

### Task 3: R0 — 入口点寻址（无 shim）

**Files:**
- Modify: `tunnel/p2p_udp_poc_test.go`

- [ ] **Step 1: 写 R0 测试**

追加：

```go
// TestP2PUDPEntrypointAddressing is R0: the entrypoint shape as shipped cannot
// address the peer. The local handler appends ":0" to a key-shaped node addr
// (x/handler/forward/local) and p2p's parsePeerKey wants the whole string to be
// the base64 key, so the dial fails before any data flows. When the addressing
// is fixed this test should be inverted (it will then behave like R1).
func TestP2PUDPEntrypointAddressing(t *testing.T) {
	entry := startUDPEntrypoint(t, nil, 0)

	c := udpClient(t, entry)
	udpSend(t, c, "ping-r0")
	got, err := udpRead(t, c, 3*time.Second)
	if err == nil {
		t.Fatalf("round trip succeeded (echo=%q): the entrypoint addressing seam appears fixed", got)
	}
	t.Logf("R0 signature: no reply (%v)", err)
}
```

- [ ] **Step 2: 跑测试并记录实测签名**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDPEntrypointAddressing -v ./tunnel/ 2>&1 | tee /config/tmp/r0.log`
Expected: PASS，日志含 `R0 signature: no reply (...)`。
同时**记录**日志中 handler 的 dial 报错文本（应含 `is not a valid base64 key` 或 `invalid peer "<key>:0"`）。若实测**通了**（意外）：说明补端口未发生，把测试改为记录实际行为并在 Task 6 文档中写明（不要保留会误报的断言）。

- [ ] **Step 3: 提交**

```bash
git add tunnel/p2p_udp_poc_test.go
git commit -m "test(tunnel): pin the p2p udp entrypoint addressing failure (R0)"
```

---

### Task 4: R1 — 进程内 provider 的 framing（仅寻址 shim）

**Files:**
- Modify: `tunnel/p2p_udp_poc_test.go`

- [ ] **Step 1: 写 R1 测试**

追加：

```go
// TestP2PUDPRawProviderNoFraming is R1: with the addressing fixed but the
// provider as shipped, the in-process conn carries no datagram framing while
// the outlet parses 2-byte length-prefixed frames: it reads the payload's
// first two bytes as a length and waits for bytes that never come. When the
// framing is fixed this test should be inverted.
func TestP2PUDPRawProviderNoFraming(t *testing.T) {
	entry := startUDPEntrypoint(t, func(pr xp2p.TunnelProvider) xp2p.TunnelProvider {
		return stripPortProvider{inner: pr}
	}, 0)

	c := udpClient(t, entry)
	udpSend(t, c, "ping-r1")
	got, err := udpRead(t, c, 3*time.Second)
	if err == nil {
		t.Fatalf("round trip succeeded (echo=%q): the in-process framing gap appears fixed", got)
	}
	t.Logf("R1 signature: no reply (%v)", err)
}
```

- [ ] **Step 2: 跑测试并记录实测签名**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDPRawProviderNoFraming -v ./tunnel/ 2>&1 | tee /config/tmp/r1.log`
Expected: PASS，日志含 `R1 signature: no reply (...)`；应能看到 tunnel/channel 建立（与 R0 的 dial 失败区分开）。若实测**通了**：framing 假设被证伪 → 改断言记录实际行为，并在 Task 6 文档写明（可能 framing 由其他层补上）。

- [ ] **Step 3: 提交**

```bash
git add tunnel/p2p_udp_poc_test.go
git commit -m "test(tunnel): pin the in-process provider framing gap (R1)"
```

---

### Task 5: R3 — 两并发客户端的碰撞（寻址 + framing shim）

**Files:**
- Modify: `tunnel/p2p_udp_poc_test.go`

- [ ] **Step 1: 写 R3 测试**

追加：

```go
// TestP2PUDPTwoClientsCollide is R3: two concurrent clients on the framed
// baseline. The second dial replaces the channel's local edge (last-dial-wins)
// and the frames carry no client identity, so the first client's in-flight
// reply is cross-delivered to the second. The echo delay engineers the overlap.
func TestP2PUDPTwoClientsCollide(t *testing.T) {
	entry := startUDPEntrypoint(t, func(pr xp2p.TunnelProvider) xp2p.TunnelProvider {
		return framedProvider{inner: stripPortProvider{inner: pr}}
	}, 500*time.Millisecond)

	c1 := udpClient(t, entry)
	c2 := udpClient(t, entry)

	udpSend(t, c1, "from-c1") // its reply is pending for 500ms

	time.Sleep(100 * time.Millisecond) // let the datagram reach the outlet
	udpSend(t, c2, "from-c2")          // replaces c1's local edge

	// The second client receives both replies: its own, and the in-flight one
	// that now belongs to the current edge.
	first, err := udpRead(t, c2, 5*time.Second)
	if err != nil {
		t.Fatalf("client 2 read: %v", err)
	}
	second, err := udpRead(t, c2, 5*time.Second)
	if err != nil {
		t.Fatalf("client 2 second read: %v (got %q first)", err, first)
	}
	seen := map[string]bool{first: true, second: true}
	if !seen["from-c1"] || !seen["from-c2"] {
		t.Fatalf("client 2 received %q + %q, want the cross-delivered from-c1 and its own from-c2", first, second)
	}

	// The first client's reply went to the other edge: it gets nothing.
	reply, err := udpRead(t, c1, 1*time.Second)
	if err == nil {
		t.Fatalf("client 1 received %q; the edge replacement did not drop its reply", reply)
	}
	t.Logf("R3 signature: client 2 received %q + %q; client 1 got no reply (%v)", first, second, err)
}
```

- [ ] **Step 2: 跑测试并记录实测签名**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDPTwoClientsCollide -v ./tunnel/ 2>&1 | tee /config/tmp/r3.log`
Expected: PASS，日志含 `R3 signature: client 2 received "from-c1" + "from-c2"; client 1 got no reply (...)`。
若实测形态不同（如 c1 收到回复、c2 只收到一条、或双方都丢）：按 spec 的「多态」条款，把断言改为**实测签名**（保留「两客户端不能同时被服务」这一核心事实的可断言形式），并在 Task 6 文档里记录实际序列。

- [ ] **Step 3: 全量跑一遍 + 提交**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/`
Expected: 5 个测试全 PASS（DerperUp / FramedBaseline / EntrypointAddressing / RawProviderNoFraming / TwoClientsCollide）

```bash
git add tunnel/p2p_udp_poc_test.go
git commit -m "test(tunnel): pin the two-client collision on the p2p udp channel (R3)"
```

---

### Task 6: 把实测结论写回 p2p-integration.md

**Files:**
- Modify: `docs/p2p-integration.md`

- [ ] **Step 1: 改写「已知限制」一节**

用实测签名替换原有一句，模板如下（尖括号处填 Task 3/4/5 记录的实际值；修复方向三条照抄）：

```markdown
## 已知限制

入口点形态（本地 udp listener → local handler → chain node(p2p udp 隧道) → 对端 outlet）
的进程内 e2e 结论（`tunnel/p2p_udp_poc_test.go`，tag `p2ppoc`，真 derper；跑法
`TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/`）：

1. **寻址不通（R0）**：`local` handler 对非 host:port 的 node addr 补 `:0`，p2p 的
   `parsePeerKey` 要求整个 peer 字符串是 base64 key → 拨号在 `<实测报错文本>` 处失败。
2. **进程内 provider 缺 datagram framing（R1）**：plugin 路径的 conn 由
   `x/p2p/streamconn` 按 udp 模式加 2 字节长度前缀，进程内 `Provider` 返回 raw conn →
   outlet 侧帧解析永远等不到完整帧，实测签名 `<实测：无回复/…>`。
3. **多客户端互踩（R3）**：每客户端一次 Dial → 同 peer 一个 channel、last-dial-wins；
   且帧里没有客户端身份 → 实测签名 `<实测序列，如：client 2 收到自己与 client 1 的在途回复，
   client 1 无回复>`。

修复方向（产品改动，另立任务）：
① 寻址：`local` handler 不再对 key 形态补 `:0`，或让 tunnel dialer 从 node metadata 取 peer；
② x 侧按 network 把 provider conn 包成 framed（与 plugin 路径对齐）；
③ 多客户端：per-client channel，或 GOST 侧 session 多路复用（对齐 relay 协议的 udp session id）。

tun 形态（p2p e2e 的 `udp-tun`/`udp-outlet`）不受上述影响：那些场景两端都是
plugin 路径且单流。
```

- [ ] **Step 2: 校验文档**

Run: `grep -n "已知限制" -A 24 wisper/docs/p2p-integration.md`
Expected: 新一节完整、无 `<...>` 残留（除有意保留的占位说明）。

- [ ] **Step 3: 提交**

```bash
git add docs/p2p-integration.md
git commit -m "docs: record the measured p2p udp entrypoint limitations"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec 的 Harness（derper/两 host/入口点栈/echo）→ Task 1–2；矩阵 R0–R3 → Task 3/4/2/5；产出（测试 + 文档改写 + 零产品改动）→ Task 2–5/6；判定规则（R2 不通则停）→ Task 2 Step 4；多态条款 → Task 5 Step 2。
- **占位符扫描**：代码步骤均为完整代码；仅 Task 6 的文档模板含 `<实测…>`，由 Task 3–5 的记录填充（有意为之，非缺失）。
- **类型一致性**：`startUDPEntrypoint(t, wrap, echoDelay)`、`stripPortProvider`/`framedProvider`/`connStream`、`udpClient/udpSend/udpRead`、`startDerper`/`startUDPEcho` 在各任务中签名一致。
