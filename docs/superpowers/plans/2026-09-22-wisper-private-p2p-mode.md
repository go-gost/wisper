# Wisper 私有 p2p 模式（反向侧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wisper 新增隧道类型 `p2p`——内嵌 p2p host，`target` 指向隧道 Endpoint 的本地服务，对端按 base64 pubkey 拨入（tcp），含 config/API/UI 全套。

**Architecture:** `tunnel/p2p.go` 一种新隧道类型（一隧道一 host，key 文件由隧道 ID 推导）；`config.Settings.P2P` 持有部署级 derp/secure/caFile；API 的 type switch 增 `p2p` 分支（`entrypoint` 字段即 pubkey）；UI 增类型卡片/设置项/提示文案。

**Tech Stack:** Go（`github.com/go-gost/p2p` 进程内 Host API）、wisper 现有 tunnel/config/api 模式、Lit + TS、build tag `p2ppoc` 的 e2e（真 derper）。

**Spec:** `docs/superpowers/specs/2026-09-22-wisper-private-p2p-mode-design.md`

**运行前置：** 开发用 **go.work 模式**（本地 p2p `204e2d5` 含 framing 修复）；`GOWORK=off` 仍是 pinned `v0.4.0`（旧行为），发布与 bump 待定。所有 `go test` 带 `TMPDIR=/config/tmp`。

---

### Task 1: config 增加 P2P 设置

**Files:**
- Modify: `config/config.go`

- [ ] **Step 1: 加 P2PSettings 结构**

在 `Settings`（`config/config.go:135`）之后加：

```go
// P2PSettings holds the deployment-level p2p host settings: the DERP relay and
// the relay's TLS options. Per-tunnel p2p tunnels share them; the tunnel's own
// config carries only its local backend address.
type P2PSettings struct {
	// Derp is the DERP relay URL (wss://host/derp). Required for p2p tunnels.
	Derp string `yaml:",omitempty" json:"derp"`
	// Secure verifies the relay's TLS certificate (nil = true).
	Secure *bool `yaml:",omitempty" json:"secure,omitempty"`
	// CAFile is a PEM CA file to trust the relay's self-signed certificate.
	CAFile string `yaml:"caFile,omitempty" json:"ca_file,omitempty"`
}
```

并在 `Settings` 结构体里加字段：

```go
	// P2P holds the private p2p mode settings (DERP relay).
	P2P *P2PSettings `yaml:",omitempty" json:"p2p,omitempty"`
```

- [ ] **Step 2: 验证编译与序列化**

Run: `cd wisper && go build ./... && go vet ./config/`
Expected: 通过（无输出）。

- [ ] **Step 3: 提交**

```bash
git add config/config.go
git commit -m "feat(config): add p2p settings (derp relay, TLS options)"
```

---

### Task 2: p2p 隧道类型 + key 生命周期（含单测）

**Files:**
- Create: `tunnel/p2p.go`
- Modify: `tunnel/tunnel.go`（常量 + `createTunnel` 分支 + `Delete` 清理 key）
- Test: `tunnel/p2p_test.go`

- [ ] **Step 1: 写失败的测试**

创建 `tunnel/p2p_test.go`：

```go
package tunnel

import (
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/go-gost/wisper/config"
)

// TestP2PTunnelKeyLifecycle covers the key file: created on Run with 0600,
// reused across stop/start (same identity), removed by Delete.
func TestP2PTunnelKeyLifecycle(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	tn := NewP2PTunnel(IDOption("test-p2p-id"), EndpointOption("127.0.0.1:9"))
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// Connect to an unreachable relay is non-fatal (the engine retries), so Run
	// succeeds and the host still reports its pubkey.
	Add(tn) // Delete() only sees tunnels in the global list
	key1 := tn.Entrypoint()
	if key1 == "" {
		t.Fatal("Entrypoint() = empty, want the base64 public key")
	}

	keyPath := filepath.Join(os.Getenv("XDG_CONFIG_HOME"), "wisper", "p2p", "test-p2p-id.key")
	fi, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("key file: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("key file mode = %o, want 600", perm)
	}

	if err := tn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := tn.Close(); err != nil {
		t.Fatalf("second Close: %v (must be idempotent)", err)
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Close removed the key file: %v (stop/start must reuse the identity)", err)
	}

	// A restarted tunnel keeps the same identity.
	tn2 := NewP2PTunnel(IDOption("test-p2p-id"), EndpointOption("127.0.0.1:9"))
	if err := tn2.Run(); err != nil {
		t.Fatalf("Run after restart: %v", err)
	}
	Set(tn2) // replaces the old entry without touching the key file
	if got := tn2.Entrypoint(); got != key1 {
		t.Fatalf("pubkey changed across restart: %q -> %q", key1, got)
	}
	_ = tn2.Close()

	Delete("test-p2p-id")
	if _, err := os.Stat(keyPath); !os.IsNotExist(err) {
		t.Fatalf("Delete left the key file behind: %v", err)
	}
}

// TestP2PDerpDefault: an empty settings.p2p resolves to the public gost.run
// relay (never a hard failure).
func TestP2PDerpDefault(t *testing.T) {
	if got := p2pDerpURL(nil); got != defaultP2PDerp {
		t.Fatalf("p2pDerpURL(nil) = %q, want %q", got, defaultP2PDerp)
	}
	if got := p2pDerpURL(&cfg.Settings{}); got != defaultP2PDerp {
		t.Fatalf("p2pDerpURL(empty) = %q, want %q", got, defaultP2PDerp)
	}
	want := "wss://relay.example/derp"
	if got := p2pDerpURL(&cfg.Settings{P2P: &cfg.P2PSettings{Derp: want}}); got != want {
		t.Fatalf("p2pDerpURL(configured) = %q, want %q", got, want)
	}
}
```



- [ ] **Step 2: 跑测试确认失败**

Run: `cd wisper && TMPDIR=/config/tmp go test -run TestP2PTunnel ./tunnel/`
Expected: FAIL — `undefined: NewP2PTunnel` 等。

- [ ] **Step 3: 实现 `tunnel/p2p.go`**

```go
package tunnel

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/p2p"
	cfg "github.com/go-gost/wisper/config"
	"github.com/google/uuid"
)

// p2pTunnel exposes a local service to peers over an embedded p2p host: the
// peer addresses this host by its base64 public key and dials in through the
// DERP relay (no gost.run endpoint, no admission — the key is the credential).
type p2pTunnel struct {
	opts     Options
	favorite atomic.Bool
	stats    cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	host   *p2p.Host
	cclose chan struct{}

	err error
	mu  sync.RWMutex
}

// NewP2PTunnel creates a private p2p tunnel.
func NewP2PTunnel(opts ...Option) Tunnel {
	var options Options
	for _, opt := range opts {
		opt(&options)
	}
	if options.ID == "" {
		options.ID = uuid.NewString()
	}
	if options.Endpoint == "" {
		options.Endpoint = "localhost:8080"
	}
	if options.Name == "" {
		options.Name = "p2p-" + options.ID
		if len(options.ID) > 8 {
			options.Name = "p2p-" + options.ID[:8]
		}
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}
	return &p2pTunnel{opts: options, cclose: make(chan struct{})}
}

func (s *p2pTunnel) ID() string           { return s.opts.ID }
func (s *p2pTunnel) Type() string         { return P2PTunnel }
func (s *p2pTunnel) Name() string         { return s.opts.Name }
func (s *p2pTunnel) Endpoint() string     { return s.opts.Endpoint }
func (s *p2pTunnel) Options() Options     { return s.opts }
func (s *p2pTunnel) Favorite(b bool)      { s.favorite.Store(b) }
func (s *p2pTunnel) IsFavorite() bool     { return s.favorite.Load() }
func (s *p2pTunnel) Stats() cfg.ServiceStats { s.mu.RLock(); defer s.mu.RUnlock(); return s.stats }
func (s *p2pTunnel) SetStats(stats cfg.ServiceStats) { s.mu.Lock(); defer s.mu.Unlock(); s.stats = stats }
func (s *p2pTunnel) StatsBaseline() cfg.ServiceStats { s.mu.RLock(); defer s.mu.RUnlock(); return s.statsBaseline }
func (s *p2pTunnel) SetStatsBaseline(b cfg.ServiceStats) { s.mu.Lock(); defer s.mu.Unlock(); s.statsBaseline = b }

// Entrypoint is the value peers need: the host's base64 public key. Empty
// until Run has built the host.
func (s *p2pTunnel) Entrypoint() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.host == nil {
		return ""
	}
	return s.host.PublicKey()
}

// Status has no gost service behind it: the tunnel is a p2p host, not a
// listener+handler pair, so there is no service status to report.
func (s *p2pTunnel) Status() *xservice.Status { return nil }

// p2pDerpURL returns the configured DERP relay, falling back to the public
// gost.run relay — the same read-time-default pattern as GetServerName.
func p2pDerpURL(s *cfg.Settings) string {
	if s != nil && s.P2P != nil && s.P2P.Derp != "" {
		return s.P2P.Derp
	}
	return defaultP2PDerp
}

// p2pTLSConfig returns the relay TLS options, or nil to keep p2p's defaults
// (verify against the system roots) when settings.p2p is unset.
func p2pTLSConfig(s *cfg.Settings) *p2p.TLSConfig {
	if s == nil || s.P2P == nil {
		return nil
	}
	if s.P2P.Secure == nil && s.P2P.CAFile == "" {
		return nil
	}
	return &p2p.TLSConfig{Secure: s.P2P.Secure, CAFile: s.P2P.CAFile}
}

// P2PKeyPath is the per-tunnel key file: <UserConfigDir>/wisper/p2p/<id>.key
// (hex, 0600, created by the p2p library on first use).
func P2PKeyPath(id string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wisper", "p2p", id+".key"), nil
}

// RemoveP2PKey deletes a tunnel's key file. The API's explicit delete path
// calls it; tunnel.Delete deliberately does not, so an update/replace keeps
// the identity (and Close keeps it too, so stop/start reuses it).
func RemoveP2PKey(id string) error {
	path, err := P2PKeyPath(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *p2pTunnel) Run() (err error) {
	if s.IsClosed() {
		return ErrTunnelClosed
	}
	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

	settings := cfg.Get().Settings
	keyPath, err := P2PKeyPath(s.opts.ID)
	if err != nil {
		return
	}

	direct := false
	conf := &p2p.Config{
		Derp:    p2pDerpURL(settings),
		Key:     keyPath,
		Targets: []string{"tcp://" + s.opts.Endpoint},
		Direct:  &direct,
	}
	// settings may be nil (fresh install) and Settings.P2P unset — never
	// dereference it directly.
	conf.TLS = p2pTLSConfig(settings)
	host, err := p2p.New(conf)
	if err != nil {
		err = fmt.Errorf("p2p host: %w", err)
		return
	}
	// A failed relay connection is not fatal: the engine retries in the
	// background (the p2p CLI behaves the same), and the tunnel keeps running
	// so its peer key stays visible.
	if cerr := host.Connect(); cerr != nil {
		// 用 wisper 的 logger 记录（stderr/文件由 wisper 的 logger 决定）
		fmt.Fprintf(os.Stderr, "p2p tunnel %s: derp connect: %v\n", s.opts.Name, cerr)
	}

	s.mu.Lock()
	s.host = host
	s.mu.Unlock()
	return nil
}

func (s *p2pTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	s.mu.Lock()
	host := s.host
	s.host = nil
	s.mu.Unlock()
	if host != nil {
		return host.Close() // keeps the key file: the identity survives a restart
	}
	return nil
}

func (s *p2pTunnel) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *p2pTunnel) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}

func (s *p2pTunnel) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil && s.err == nil {
		s.err = err
	}
}
```

注意：
- 上面的方法集必须与 `Tunnel` 接口（`tunnel/tunnel.go:222`）完全对齐；`xservice` 若未在本文件用到，`Status()` 需要 `import xservice "github.com/go-gost/x/service"`。
- `Run` 里对 relay 连接失败用 `fmt.Fprintf(os.Stderr, ...)` 只是占位；若 wisper 有现成的 logger 获取方式（`logger.Default().WithFields(...)`，与 tcp.go 一致），改用 logger（推荐，随 `log.output` 落盘）。

- [ ] **Step 4: 接线 `tunnel/tunnel.go`**

1. 常量块加 `P2PTunnel = "p2p"`，并在 `defaultServerName` 旁加：

```go
// defaultP2PDerp is the DERP relay used when settings.p2p.derp is empty.
const defaultP2PDerp = "wss://derp.gost.run/derp"
```
2. `createTunnel`（`tunnel/tunnel.go:513`）的 switch 加：

```go
	case P2PTunnel:
		t = NewP2PTunnel(options...)
```

3. **不要**在 `Delete` 里清理 key 文件（update 流程会复用它）：key 文件的清理由 API 的显式删除路径负责（见 Task 3 Step 1b）。`Delete` 保持原样。



- [ ] **Step 5: 跑测试确认通过**

Run: `cd wisper && TMPDIR=/config/tmp go test -run TestP2PTunnel -v ./tunnel/ && go build ./... && go vet ./tunnel/`
Expected: 两个测试 PASS；build/vet 干净。

- [ ] **Step 6: 提交**

```bash
git add tunnel/p2p.go tunnel/p2p_test.go tunnel/tunnel.go
git commit -m "feat(tunnel): private p2p tunnel type (embedded host, per-tunnel key)"
```

---

### Task 3: API 分支（创建/更新/删除清理 + 设置项）

**Files:**
- Modify: `api/tunnel_handler.go`、`api/config_handler.go`

- [ ] **Step 1: 隧道 type switch 增 p2p**

`api/tunnel_handler.go` 里所有 `switch ... { case tunnel.FileTunnel: ... }`（创建约 `:212`、更新约 `:282`/`:370`）各加：

```go
	case tunnel.P2PTunnel:
		t = tunnel.NewP2PTunnel(req.toOptions()...)   // 或 optsSlice... / options...
```

（三个 switch 的变量名不同，按所在处既有形态补；`peer_key` 不需要新字段——`entrypoint` 字段已是 pubkey，`toTunnelResponse` 无需改动。）

- [ ] **Step 1b: 删除路径清理 key**

`handleDeleteTunnel` 在 `tunnel.Delete(id)` 之前加：

```go
	if t := tunnel.Get(id); t != nil && t.Type() == tunnel.P2PTunnel {
		// The key file is the tunnel's identity. Removing it here (not in
		// tunnel.Delete) keeps an update/replace from rotating the pubkey.
		if err := tunnel.RemoveP2PKey(id); err != nil {
			slog.Error("remove p2p key", "id", id, "err", err)
		}
	}
```

（用该 handler 已有的查找方式；`tunnel.Get` 若不存在则按 `handleUpdateTunnel` 的取法。）

- [ ] **Step 2: 设置 API 增 p2p**

`api/config_handler.go`：settings 响应结构（约 `:18`）加

```go
	P2P *P2PSettingsResp `json:"p2p,omitempty"`
```

并定义（放响应结构附近）：

```go
// P2PSettingsResp mirrors config.P2PSettings (secure is a pointer so an
// omitted value keeps the "verify" default).
type P2PSettingsResp struct {
	Derp   string `json:"derp"`
	Secure *bool  `json:"secure,omitempty"`
	CAFile string `json:"ca_file,omitempty"`
}
```

GET 填充：`if settings.P2P != nil { resp.P2P = &P2PSettingsResp{...} }`；
PUT 请求结构加 `P2P *P2PSettingsResp \`json:"p2p,omitempty"\``，在赋值段写入 `cfg.Settings.P2P`，并加变更标记：

```go
	p2pChanged := req.P2P != nil && (req.P2P.Derp != prev.Derp || ...)
```

随后并入重启条件：

```go
	if serverChanged || entrypointChanged || insecureChanged || p2pChanged {
		tunnel.RestartRunning()
		entrypoint.RestartRunning()
	}
```

（`prev`：进入 handler 时保存的旧值；实现时按该文件既有 `cfg.Settings.X` 读取顺序取值即可。）

- [ ] **Step 3: 验证**

Run: `cd wisper && go build ./... && go vet ./api/ && TMPDIR=/config/tmp go test ./api/`
Expected: build/vet 干净，API 测试全绿（现有测试不涉及 p2p，应无回归）。

- [ ] **Step 4: 提交**

```bash
git add api/tunnel_handler.go api/config_handler.go
git commit -m "feat(api): wire the p2p tunnel type and the p2p settings"
```

---

### Task 4: e2e——对端按 key 拨入（tag p2ppoc）

**Files:**
- Create: `tunnel/p2p_e2e_test.go`（同包同 tag，复用 `p2p_udp_poc_test.go` 的 `startDerper`/`startUDPEcho` 所在文件的 helpers；需在文件级复用 `startDerper`）

- [ ] **Step 1: 写 e2e 测试**

```go
//go:build p2ppoc

// TestP2PTunnelAcceptsPeerByKey is the acceptance test for the private p2p
// mode: a wisper p2p tunnel exposing a local echo, and a peer that dials in by
// the tunnel's public key through a real derper.
package tunnel_test

import (
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/p2p"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward"
	_ "github.com/go-gost/x/dialer/tcp"
	"github.com/go-gost/x/registry"

	cfg "github.com/go-gost/wisper/config"
	wtunnel "github.com/go-gost/wisper/tunnel"
)

func TestP2PTunnelAcceptsPeerByKey(t *testing.T) {
	echo := startEchoServer(t) // from p2p_poc_test.go (same package + tag)
	derp := startDerper(t)     // from p2p_udp_poc_test.go (same package + tag)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure},
	}})

	tn := wtunnel.NewP2PTunnel(wtunnel.IDOption("e2e-p2p"), wtunnel.EndpointOption(echo))
	if err := tn.Run(); err != nil {
		t.Fatalf("run p2p tunnel: %v", err)
	}
	wtunnel.Add(tn)
	t.Cleanup(func() { wtunnel.Delete("e2e-p2p") })

	key := tn.Entrypoint()
	if key == "" {
		t.Fatal("tunnel Entrypoint() = empty, want its public key")
	}

	// The peer side: an in-process host registered as the chain's provider.
	direct := false
	peer, err := p2p.New(&p2p.Config{
		Derp: derp, KeyHex: strings.Repeat("33", 32),
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
	})
	if err != nil {
		t.Fatalf("new peer host: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.Connect(); err != nil {
		t.Fatalf("peer connect: %v", err)
	}
	if err := registry.P2PRegistry().Register("e2e-peer", peer.Provider()); err != nil {
		t.Fatalf("register provider: %v", err)
	}
	t.Cleanup(func() { registry.P2PRegistry().Unregister("e2e-peer") })

	chCfg := wtunnel.ChainConfig("e2e-peer-chain", "e2e-peer-chain", "off")
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = key
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "tcp"}
	node.Metadata = map[string]any{"p2p": "e2e-peer"}
	ch, err := chain_parser.ParseChain(chCfg, clogger.Default())
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	rt := ch.Route(ctx, "tcp", key)
	if rt == nil {
		t.Fatal("chain returned a nil route")
	}
	conn, err := rt.Dial(ctx, "tcp", key)
	if err != nil {
		t.Fatalf("dial through the p2p tunnel: %v", err)
	}
	defer conn.Close()

	msg := []byte("hello-private-p2p")
	if _, err := conn.Write(msg); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != string(msg) {
		t.Fatalf("echo = %q, want %q", buf, msg)
	}
}
```

（`net` import 仅在上面未直接使用时可留给 `SetReadDeadline` 的 conn 类型推断——若 `go vet` 报未使用，删掉该 import。）

- [ ] **Step 2: 跑测试**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -count=1 -run TestP2PTunnelAcceptsPeerByKey -v ./tunnel/`
Expected: PASS（需要 docker 提取 derper；无 docker 时 skip）。失败则 BLOCKED + 日志。

- [ ] **Step 3: 提交**

```bash
git add tunnel/p2p_e2e_test.go
git commit -m "test(tunnel): e2e for the private p2p mode (peer dials in by key)"
```

---

### Task 5: UI（类型卡片 / 详情提示 / 设置项 / i18n）

**Files:**
- Modify: `web-src/src/api/types.ts`、`web-src/src/pages/tunnel-type-select-page.ts`、`web-src/src/pages/tunnel-detail-page.ts`、`web-src/src/pages/settings-page.ts`、`web-src/src/api/backend.ts`（若 AppSettings 类型需加字段）、`web-src/src/i18n/{en,zh}.ts`

- [ ] **Step 1: 类型与列表**

`types.ts`：
```ts
export type TunnelType = 'file' | 'http' | 'tcp' | 'udp' | 'p2p';
```
`TUNNEL_TYPES` 加 `{ value: 'p2p', label: 'P2P', desc: '' },`。
`AppSettings` 加 `p2p?: { derp: string; secure?: boolean; ca_file?: string }`，其更新请求同构加可选字段。

`tunnel-type-select-page.ts`：按既有 `ICONS`/`COLORS` 模式为 `p2p` 各加一项（图标建议 `hub`；颜色自选与现有区分）。

- [ ] **Step 2: 详情页提示（view 模式，p2p 专属）**

`tunnel-detail-page.ts` 在展示 `t2.entrypoint`（约 `:848`，pubkey 即在此）之后，按 `this.tunnelType === 'p2p'` 条件加一段提示：

```ts
${this.tunnelType === 'p2p'
  ? html`<div class="p2p-hint">${t('p2pHint')}</div>`
  : nothing}
```

样式 `.p2p-hint` 用小字 + 次要色（沿用页面既有 hint 样式类，若有则复用）。

- [ ] **Step 3: 设置页三项**

`settings-page.ts`：仿 `_server/_entrypoint/_insecure` 加 `_p2pDerp`、`_p2pSecure`、`_p2pCaFile`（加载/Save 同步），在服务器区块后加一个 "P2P" 区块（三个输入：DERP URL、secure 开关、CA 文件路径）；
DERP 输入框的 placeholder 用 `wss://derp.gost.run/derp`（空值即默认，与 server 字段的处理方式一致），保存时带上 `p2p: { derp, secure, ca_file }`。

- [ ] **Step 4: i18n**

`i18n/en.ts`：
```ts
  settingsP2P: 'P2P',
  settingsP2PDerp: 'DERP relay URL',
  settingsP2PSecure: 'Verify relay certificate',
  settingsP2PCAFile: 'Relay CA file',
  p2pHint: 'Anyone holding this key who can reach the relay can access the local service. No further authentication is applied by p2p.',
  tunnelTypeP2PDesc: 'Expose a local service to peers by public key (private p2p mode).',
```
`i18n/zh.ts` 对应中文。

- [ ] **Step 5: 构建验证**

Run: `cd wisper && make web && go build ./... && TMPDIR=/config/tmp go test ./api/`
Expected: web 构建成功、后端编译与 API 测试通过。

- [ ] **Step 6: 手动过一遍 UI（必须做，不能只跑构建）**

`./wisper`（`~/.config/wisper/config.yml` 里或设置页填 `p2p.derp`）→ 类型选择出现 P2P 卡片 → 创建（后端填本地 echo 地址）→ 详情页显示 pubkey + 提示 → stop/start 后 pubkey 不变 → 删除后 `~/.config/wisper/p2p/<id>.key` 消失。把结果（含任一异常）写进提交说明。

- [ ] **Step 7: 提交**

```bash
git add web-src/ web/
git commit -m "feat(ui): private p2p tunnel type, settings and peer-key hint"
```

（`web/` 是嵌产物：与仓库既有做法一致地一并提交。）

---

### Task 6: 文档

**Files:**
- Modify: `docs/p2p-integration.md`

- [ ] **Step 1: 新增一节**

在「进程内 POC」之后加：

```markdown
## 私有 p2p 模式（反向侧，已实现）

wisper 新增隧道类型 `p2p`：内嵌 p2p host，把 **Endpoint**（本地后端地址）通过 DERP 暴露给
持有其 **base64 pubkey** 的对端。无需 gost.run，也不经公网入口。

配置：`derp` 默认 `wss://derp.gost.run/derp`（gost.run 公共 relay），可在设置页或
`config.yml` 的 `settings.p2p` 改为自建 relay；另有 `secure`、`caFile`。
然后新建 type=`p2p` 的隧道，Endpoint = 本地服务地址。

对端接入（gost）：

```yaml
p2ps:
  - name: p2p
    plugin: {type: grpc, addr: 127.0.0.1:8003}
chains:
  - name: chain-0
    hops:
      - nodes:
          - addr: <详情页显示的 pubkey>
            dialer: {type: tcp}
            connector: {type: forward}
            metadata: {p2p: p2p}
```

**安全边界**：pubkey 即准入——持有 key 且可达 relay 的任何人能访问该本地服务；p2p 本身没有
admission。建议 relay 侧 `-verify-clients=true`，并在本地服务上另加鉴权。key 文件位于
`~/.config/wisper/p2p/<id>.key`（0600），删除隧道时一并删除。

**未发布依赖**：本功能依赖 p2p 的 framing 修复（p2p 本地 main `204e2d5`）。当前需
**go.work 模式**；`GOWORK=off`（pinned `v0.4.0`）下 udp 无关、tcp 路径不受影响，
但建议尽快发布 `v0.4.1` 并 bump。
```

- [ ] **Step 2: 校验并提交**

Run: `cd wisper && grep -n "私有 p2p 模式" -A 8 docs/p2p-integration.md`
Expected: 新节存在、无 `<...>` 残留。

```bash
git add docs/p2p-integration.md
git commit -m "docs: private p2p mode (reverse side) usage and boundaries"
```

---

## Self-Review 记录

- **Spec 覆盖**：组件表五个单元 → Task 1/2/3/5；安全边界 → Task 5（提示）+ Task 6（文档）；测试（单测/e2e/UI 手动）→ Task 2/4/5；交付物与版本说明 → Task 6。
- **占位符扫描**：全部为完整代码；Task 2 的两处实现选择（`xservice` import、logger 获取方式）已注明按所在文件既有写法就近选择。
- **类型一致性**：`P2PTunnel`/`NewP2PTunnel`/`P2PKeyPath`/`RemoveP2PKey`/`P2PSettings{Derp,Secure,CAFile}` 在 Task 1–4 用法一致；`Entrypoint()` 复用 API 的 `entrypoint` 字段（不加新字段）。
- **已知取舍**：不做 logger 桥接（p2p host 日志走 slog 默认 → stderr；wisper 日志走自有 logger）——Task 2 的实现注意里给了二选一，选 logger 则此项消失。
