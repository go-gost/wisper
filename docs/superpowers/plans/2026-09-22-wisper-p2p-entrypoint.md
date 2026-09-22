# Wisper p2p entrypoint（出站侧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wisper 新增入口点类型 `p2p`：本地监听 + 对端 pubkey；本地客户端流量经内嵌 host 的隧道到对端 target（内层 tcp）。

**Architecture:** `tunnel/entrypoint/p2p.go` 镜像 `entrypoint/tcp.go` 的接线，另加"内嵌 host + provider 注册（先于 ParseChain）+ 按 key 拨出"；`Peer` 作为 Options/config 新字段透传；复用反向侧的 `P2PKeyPath`/`P2PDerpURL`/`P2PTLSConfig`。

**Tech Stack:** Go（`github.com/go-gost/p2p` 进程内 Host API、x 的 tcp listener/local handler/chain）、Lit + TS、tag `p2ppoc` 的 e2e（真 derper）。

**Spec:** `docs/superpowers/specs/2026-09-22-wisper-p2p-entrypoint-design.md`

**运行前置：** p2p `v0.4.1` 已发布；`go test` 带 `TMPDIR=/config/tmp`；e2e 需要 docker（提取 derper，已缓存）。

---

### Task 1: `Peer` 字段打通 + 导出 p2p helpers

**Files:**
- Modify: `tunnel/tunnel.go`、`config/config.go`、`tunnel/p2p.go`、`tunnel/entrypoint/entrypoint.go`

- [ ] **Step 1: Options + config + option function**

`tunnel/tunnel.go`：`Options` 加
```go
	// Peer is the remote peer's base64 public key for p2p entrypoints.
	Peer string
```
并在 option 函数区加：
```go
// PeerOption sets the remote peer's base64 public key (p2p entrypoints).
func PeerOption(peer string) Option {
	return func(opts *Options) {
		opts.Peer = peer
	}
}
```
`config/config.go`：`Tunnel` 结构加
```go
	// Peer is the remote peer's base64 public key (p2p entrypoints).
	Peer string `yaml:",omitempty" json:"peer,omitempty"`
```

- [ ] **Step 2: 透传（三处构建 Options 的地方）**

- `tunnel/tunnel.go` 的 `LoadConfig()`（`Options{...}` 字面量）加 `Peer: cfg.Peer,`。
- `tunnel/tunnel.go` 的 `SaveConfig()`：确认它从 `tun.Options()` 写回；若无 `Peer` 行则加 `Peer: opts.Peer,`（读该函数按现有字段照抄一行）。
- `tunnel/entrypoint/entrypoint.go` 的 `createEntryPoint` 的 options 列表加 `tunnel.PeerOption(opts.Peer)`，并在其两处 `tunnel.Options{...}`（`RestartRunning` ≈`:140`、`LoadConfig` ≈`:181`）加 `Peer: p.opts.Peer,` / `Peer: cfg.Peer,`。

- [ ] **Step 3: 导出复用 helper**

`tunnel/p2p.go`：`p2pDerpURL` → `P2PDerpURL`、`p2pTLSConfig` → `P2PTLSConfig`（含 doc comment 更新），调用点同步；`tunnel/p2p_test.go` 里的测试同步改名调用。

- [ ] **Step 4: 验证**

Run: `cd wisper && go build ./... && go vet ./tunnel/... ./config/ && TMPDIR=/config/tmp go test ./tunnel/ ./api/`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add tunnel/tunnel.go tunnel/p2p.go tunnel/p2p_test.go tunnel/entrypoint/entrypoint.go config/config.go
git commit -m "feat(tunnel): carry the peer key in options/config and export the p2p helpers"
```

---

### Task 2: p2p entrypoint 类型 + 单测

**Files:**
- Create: `tunnel/entrypoint/p2p.go`
- Create: `tunnel/entrypoint/p2p_test.go`
- Modify: `tunnel/entrypoint/entrypoint.go`（常量 + 工厂分支）

- [ ] **Step 1: 写失败的测试**

`tunnel/entrypoint/p2p_test.go`（package `entrypoint`，与生产代码同包以便用未导出字段不行——用导出面即可）：

```go
package entrypoint

import (
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/x/registry"
)

// TestP2PEntryPointLifecycle: Run builds the host, registers the provider and
// creates the key file (0600); Close unregisters and is idempotent while the
// key survives so a restart reuses the identity.
func TestP2PEntryPointLifecycle(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	ep := NewP2PEntryPoint(
		tp.IDOption("test-p2p-ep"),
		tp.EndpointOption("127.0.0.1:0"),
		tp.PeerOption("dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"),
	)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := ep.Endpoint(); got != "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA" {
		t.Fatalf("Endpoint() = %q, want the peer key", got)
	}

	keyPath := filepath.Join(os.Getenv("XDG_CONFIG_HOME"), "wisper", "p2p", "test-p2p-ep.key")
	fi, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("key file: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("key file mode = %o, want 600", perm)
	}
	if !registry.P2PRegistry().IsRegistered("p2p-ep-test-p2p-ep") {
		t.Fatal("provider not registered after Run")
	}

	if err := ep.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := ep.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	if registry.P2PRegistry().IsRegistered("p2p-ep-test-p2p-ep") {
		t.Fatal("provider still registered after Close")
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Close removed the key file: %v", err)
	}
}

// TestP2PEntryPointRequiresPeer: a missing peer key fails loudly.
func TestP2PEntryPointRequiresPeer(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{}})
	ep := NewP2PEntryPoint(tp.IDOption("no-peer"))
	if err := ep.Run(); err == nil {
		t.Fatal("Run without a peer key = nil error, want a failure")
	}
	_ = ep.Close()
}
```

（`Registry[T]` 的 `IsRegistered(name) bool` 已确认存在；`Unregister(name)` 无返回值。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd wisper && TMPDIR=/config/tmp go test -run TestP2PEntryPoint ./tunnel/entrypoint/`
Expected: FAIL — `undefined: NewP2PEntryPoint`。

- [ ] **Step 3: 实现 `tunnel/entrypoint/p2p.go`**

按 `tcp.go` 镜像（结构体/构造函数/ID-Type-Name/Options/Endpoint/Entrypoint/Favorite/Stats 系列/Status/IsClosed/Err/setErr），差异如下：

```go
const P2PEntryPoint = "p2p"

type p2pEntryPoint struct {
	opts     tp.Options      // tp = "github.com/go-gost/wisper/tunnel"
	peer     string
	provider string          // registry name, derived from the ID
	config   *config.Config
	forward  service.Service
	host     *p2p.Host      // "github.com/go-gost/p2p"

	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	cclose chan struct{}
	err    error
	mu     sync.RWMutex
}
```

- 构造函数：默认 ID（uuid）、默认 `Endpoint` = `127.0.0.1:8080`、默认 Name = `p2p-ep-<id[:8]>`、`provider = "p2p-ep-" + options.ID`、`peer = options.Peer`。
- `Type()` 返回 `P2PEntryPoint`；`Endpoint()` 返回 `s.peer`（公网侧语义 = 对端 key）；`Entrypoint()` 返回 `s.opts.Endpoint`（本地监听地址，与既有约定一致）。
- `init()`：镜像 tcp.go，但 chain 打补丁：
  ```go
  	chCfg := tp.ChainConfig(s.opts.ID, s.opts.Name, s.opts.RecordMode)
  	node := chCfg.Hops[0].Nodes[0]
  	node.Addr = s.peer
  	node.Connector = &config.ConnectorConfig{Type: "forward"}
  	node.Dialer = &config.DialerConfig{Type: "tcp"}
  	node.Metadata = map[string]any{"p2p": s.provider}
  	s.config = &config.Config{
  		Services: []*config.ServiceConfig{tcpSvc},   // Addr = s.opts.Endpoint, Handler tcp + Chain name
  		Chains:   []*config.ChainConfig{chCfg},
  	}
  ```
  且 `Forwarder.Nodes[0].Addr = s.peer`。
- `Run()`：
  1. `s.peer == ""` → 返回明确错误（“p2p entrypoint requires a peer public key”）；
  2. `init()`；
  3. `tunnel.P2PKeyPath(s.opts.ID)` → `p2p.New(&p2p.Config{Derp: tunnel.P2PDerpURL(settings), Key: keyPath, Direct: &false})`，`conf.TLS = tunnel.P2PTLSConfig(settings)`；`host.Connect()` 失败仅记日志（nil-guard 的 `logger.Default()`，不写 `s.err`）；存 `s.host`；
  4. `registry.P2PRegistry().Unregister(s.provider)`（best-effort 清 stale）→ `Register(s.provider, host.Provider())`；
  5. `chain_parser.ParseChain` → `tcp.NewListener(Addr=cfg.Addr)` + `local.NewHandler(Router)` + `hop.NewHop(Node(name, s.peer))` + `xservice.NewService` → `go Serve()`（全部镜像 tcp.go，含 stats 透传）。
- `Close()`：`s.forward.Close()`（若非 nil）→ `registry.P2PRegistry().Unregister(s.provider)` → `s.host.Close()`（若非 nil），最后 close-once `cclose`；幂等。key 保留。

- [ ] **Step 4: 接线 `entrypoint.go`**

常量块加 `P2PEntryPoint = "p2p"`；`createEntryPoint` 的 switch 加：
```go
	case P2PEntryPoint:
		ep = NewP2PEntryPoint(options...)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd wisper && TMPDIR=/config/tmp go test -run TestP2PEntryPoint -v ./tunnel/entrypoint/ && go build ./... && go vet ./tunnel/...`
Expected: 两个测试 PASS；build/vet 干净。

- [ ] **Step 6: 提交**

```bash
git add tunnel/entrypoint/p2p.go tunnel/entrypoint/p2p_test.go tunnel/entrypoint/entrypoint.go
git commit -m "feat(entrypoint): p2p entrypoint type (dial out to a peer key)"
```

---

### Task 3: API 接线

**Files:**
- Modify: `api/entrypoint_handler.go`

- [ ] **Step 1: type switch + peer 字段**

`api/entrypoint_handler.go` 的三处 switch（create ≈`:60`、update ≈`:119`、start ≈`:198`）各加：
```go
	case entrypoint.P2PEntryPoint:
		ep = entrypoint.NewP2PEntryPoint(...)   // 按各处变量风格：req.toOptions() / opts / optsSlice
```
create/update 的请求结构加 `Peer string \`json:"peer,omitempty"\``（或复用现有 options 结构，按文件实际情况），并让 `toOptions()` 带上 `tunnel.PeerOption(req.Peer)`；响应 options 结构（`entrypointOptionsResp` 或同名）加 `Peer string \`json:"peer,omitempty"\``，赋值处从 `t.Options().Peer` 取。

- [ ] **Step 2: 删除路径清 key**

`handleDeleteEntrypoint`（≈`:149`）在 `entrypoint.Delete(id)` 之前加（镜像隧道侧）：
```go
	if ep != nil && ep.Type() == entrypoint.P2PEntryPoint {
		// The key file is the entrypoint's identity: removed only on explicit
		// delete, so stop/start and update keep the same key.
		if err := tunnel.RemoveP2PKey(id); err != nil {
			slog.Error("remove p2p key", "id", id, "err", err)
		}
	}
```
（`tunnel` 与 `slog` 的 import 按该文件现状补。）

- [ ] **Step 3: 验证**

Run: `cd wisper && go build ./... && go vet ./api/ && TMPDIR=/config/tmp go test ./api/`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add api/entrypoint_handler.go
git commit -m "feat(api): wire the p2p entrypoint type and its key cleanup"
```

---

### Task 4: e2e（tag p2ppoc）

**Files:**
- Create: `tunnel/p2p_entrypoint_e2e_test.go`（**放 `tunnel/` 目录**，package `tunnel_test`——这样能直接用同包 `startDerper`；它是测试辅助，不能跨包共享）

- [ ] **Step 1: 写 e2e 测试**

```go
//go:build p2ppoc

// TestP2PEntryPointDialsPeerByKey is the acceptance test for the out-dial
// side: a wisper p2p entrypoint listening locally, dialing a peer host's
// target through a real derper by public key.
package tunnel_test

import (
	"io"
	"net"
	"testing"
	"time"

	"github.com/go-gost/p2p"
	"github.com/go-gost/x/registry"

	cfg "github.com/go-gost/wisper/config"
	wtunnel "github.com/go-gost/wisper/tunnel"
	wep "github.com/go-gost/wisper/tunnel/entrypoint"
)

func TestP2PEntryPointDialsPeerByKey(t *testing.T) {
	echo := startEchoServer(t) // p2p_poc_test.go (same package + tag)
	derp := startDerper(t)     // p2p_udp_poc_test.go (same package + tag)

	secure := false
	direct := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure},
	}})

	// The peer side: an in-process host holding the echo as its target.
	peer, err := p2p.New(&p2p.Config{
		Derp: derp, KeyHex: strings.Repeat("44", 32),
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
		Targets: []string{"tcp://" + echo},
	})
	if err != nil {
		t.Fatalf("new peer host: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.Connect(); err != nil {
		t.Fatalf("peer connect: %v", err)
	}

	// The entrypoint listens locally and dials the peer by key.
	ep := wep.NewP2PEntryPoint(
		wtunnel.IDOption("e2e-p2p-ep"),
		wtunnel.EndpointOption("127.0.0.1:0"),
		wtunnel.PeerOption(peer.PublicKey()),
	)
	if err := ep.Run(); err != nil {
		t.Fatalf("run p2p entrypoint: %v", err)
	}
	t.Cleanup(func() { _ = ep.Close() })

	addr := ep.Entrypoint() // the local listen address
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial the local entrypoint at %s: %v", addr, err)
	}
	defer conn.Close()

	msg := []byte("hello-p2p-entrypoint")
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

（`strings` 加进 import；`registry` 仅在需要时保留——若本文件未用到就删掉该 import。）

**判定规则：** 若拨号/回环失败，**不要**改弱断言；抓两侧日志（`-v` 会打出 p2p host 的 slog）并报 BLOCKED——那是发现，不是噪声。

- [ ] **Step 2: 跑测试**

Run: `cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -count=2 -run TestP2PEntryPointDialsPeerByKey -v ./tunnel/`
Expected: PASS 两次。

- [ ] **Step 3: 提交**

```bash
git add tunnel/p2p_entrypoint_e2e_test.go
git commit -m "test(tunnel): e2e for the p2p entrypoint (dials a peer by key)"
```

---

### Task 5: UI

**Files:**
- Modify: `web-src/src/api/types.ts`、`web-src/src/pages/entrypoint-type-select-page.ts`、`web-src/src/pages/entrypoint-detail-page.ts`、`web-src/src/store/entrypoint-store.ts`（如需）、`web-src/src/i18n/{en,zh}.ts`

- [ ] **Step 1: 类型与列表**

`types.ts`：
```ts
export type EntrypointType = 'tcp' | 'udp' | 'p2p';
```
`ENTRYPOINT_TYPES` 加 `{ value: 'p2p', label: 'P2P', desc: '' }`；
`EntrypointOptions`（或响应 options 类型）加 `peer?: string`；`EntrypointCreateRequest` 加 `peer?: string`。
`entrypoint-type-select-page.ts`：图标/配色表加 `p2p`（可用与隧道侧一致的 `hub`）。

- [ ] **Step 2: 详情页表单与展示**

`entrypoint-detail-page.ts`：
- edit/create 模式：当 `entrypointType === 'p2p'` 时，除现有的监听地址（endpoint）字段外，加一个 **Peer key** 输入（绑定新 state `_peer`，与 `_endpoint` 同款样式；label 用 i18n key），提交时带 `peer: this._peer`；加载已有入口点时从 `options.peer` 回填。
- view 模式：p2p 时展示 peer key（可复制，复用页面已有的复制按钮模式），并加一行提示 `t('p2pEntryHint')`。
- 非 p2p 类型不显示这些。

- [ ] **Step 3: i18n**

`i18n/en.ts`：
```ts
  entrypointPeerKey: 'Peer public key',
  p2pEntryHint: 'Local clients connect to the listen address; traffic exits through the p2p tunnel to the peer key, unencrypted (tcp inner).',
  typeP2pDesc: 'Forward local traffic to a peer by public key (p2p entrypoint).',
```
`zh.ts` 对应中文（`entrypointPeerKey: '对端公钥'`、`p2pEntryHint: '本地客户端连接监听地址；流量经 p2p 隧道到对端公钥，明文（内层 tcp）。'`、`typeP2pDesc: '按公钥把本地流量转发到对端（p2p 入口点）。'`）。
注意：类型卡片的 desc key 是 `type<Pascal>` 形式（与隧道侧一致），**不要**用 `tunnelType...`。

- [ ] **Step 4: 构建 + 类型检查 + API 级验证**

Run（web-src 目录）：`npm run typecheck`；然后 `make web`；`go build ./... && TMPDIR=/config/tmp go test ./api/ ./tunnel/`。
再按隧道侧的同一套 curl 流程验证入口点：`POST /api/entrypoints {"name":"p2p-ep","type":"p2p","endpoint":"127.0.0.1:18901","peer":"<43 字符 key>"}` → list 里 `type: p2p`、options.peer 回显、status running（relay 用 `127.0.0.1:1`）；`DELETE` → `$XDG_CONFIG_HOME/wisper/p2p/<id>.key` 消失。

- [ ] **Step 5: 提交**

```bash
git add web-src/src web/
git commit -m "feat(ui): p2p entrypoint type, peer-key field and hint"
```

（`web-src/node_modules` 部分被跟踪——只 stage `web-src/src` 与 `web/`。）

---

### Task 6: 文档

**Files:**
- Modify: `docs/p2p-integration.md`

- [ ] **Step 1: 在「私有 p2p 模式」一节的用法之后加"出站侧"**

```markdown
**出站侧（p2p entrypoint）**：新增入口点类型 `p2p`——本地监听 + 对端 pubkey。本地客户端连
监听地址，流量经内嵌 host 的隧道拨到对端 target（内层 `tcp`，**数据面明文**；跨公网建议后续用
tls/ws 变体）。对端可以是 wisper 的反向侧 p2p 隧道，也可以是任意带 target 的 p2p host。
本侧 key 同样在 `~/.config/wisper/p2p/<entrypoint-id>.key`（0600），stop/start 与更新复用，
删除入口点时移除。
```

- [ ] **Step 2: 校验并提交**

Run: `grep -n "出站侧" -A 6 docs/p2p-integration.md`
Expected: 新段落存在。

```bash
git add docs/p2p-integration.md
git commit -m "docs: p2p entrypoint (out-dial side) usage"
```

---

## Self-Review 记录

- **Spec 覆盖**：组件表六个单元 → Task 1（Peer/导出）、2（类型）、3（API）、5（UI）；Run 顺序（provider 先于 ParseChain、stale 注销）→ Task 2 Step 3；安全（明文提示）→ Task 5（UI hint）+ Task 6（文档）；测试（单测/e2e/UI 手动）→ Task 2/4/5。
- **占位符**：Go 侧均为完整代码（p2p.go 给出结构与差异点，实现者镜像 tcp.go 的样板）；UI 为锚点式指令（与上一个计划同法）。注册表 `Get` 的签名等不确定处已注明按实际调整。
- **类型一致性**：`P2PEntryPoint`/`NewP2PEntryPoint`/`PeerOption`/`P2PDerpURL`/`P2PTLSConfig`/`P2PKeyPath`/`provider = "p2p-ep-"+ID` 在 Task 1–4 一致；`Endpoint()`=peer key、`Entrypoint()`=本地监听 与既有约定一致。
- **已知取舍**：e2e 放 `tunnel/` 目录以复用 `startDerper`（测试辅助不可跨包），文件内 import `tunnel/entrypoint` ✓。
