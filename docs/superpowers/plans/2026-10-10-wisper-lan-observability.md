# wisper LAN 可观测性 + spoke 接线 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 v1.9.0 spoke 侧从未接线的 LAN routing（数据流真正可达），并让 hub 的路由/拒绝/撤销状态在 API、doctor、事件与 Web UI 上可见可定位。

**Architecture:** 先接线（entrypoint 配置面 + 控制通道 + 分享栈），再修计数真值，然后补路由记录（typed refusal、journal、事件、doctor），最后前端消费。所有后端改动只增不改 API 形状；不碰 x、p2p 两个仓。

**Tech Stack:** Go 1.x（wisper / x registry）、web-src 原生 Web Components + TypeScript、Vite。

**Spec:** `docs/superpowers/specs/2026-10-10-wisper-lan-observability-design.md`（v2，含 §5.0 接线设计）

## Global Constraints

- 不碰 x、p2p 两仓；`tun-share` connector 经 x 既有 `registry.ConnectorRegistry()` 从 wisper 注册。
- Go 门禁：`GOWORK=off go build ./...`；按包 `go test`（`./tunnel/...`、`./api/`、`./runner/...`）；`-race` 需 `CGO_ENABLED=1`；推送前 `GOWORK=off golangci-lint run --timeout 5m`（本地 v2.14.0 与 CI 一致，能复现 lint）。
- 已知先存失败：x 仓 `TestRunDeviceProbeReportsSent`（仅 `-race`、仅 x `./handler/tun/`）不属于本计划门禁。
- Web 门禁：`cd web-src && npx tsc --noEmit && npx vite build`；无 web 单测传统；`make ui-test`（Playwright）可选、不作门禁。
- 提交信息英文 conventional；一个任务一个 commit（spec 的"四分"是阶段：接线 → 计数 → 内核 → 前端，任务粒度更细便于审查）。
- API 只增不改；journal 内存环 16、重启即清；事件只记状态迁移。
- 实现分支 `sdd/wisper-lan-observability`，全部完成后合入 main（用户确认）。
- 代码注释/日志英文；i18n 需 en + zh 双语键。

## Review Focus

最可能伤人而测试未必覆盖的五类（各自测试挂到所属任务）：

1. **auto 降级在 spoke 上的选择错位**：没有 iptables 时应接 userspace shim；错选 `forward` 会让 LAN 流量被内核无声丢弃。→ Task 2 的 selection 测试。
2. **重启/停止的分享泄漏**：`SetupSpokeShare` 的规则与 shim 必须恰好清理一次，重跑不得叠加。→ Task 2 的 cleanup-once 测试。
3. **控制通道断线重连**：重连要重述 claim 并重装 netview；`tun-share` 每次 Connect 必须新建独立 shim/栈（旧 conn 由引擎关闭）。→ Task 2 的 two-Connect 测试 + 组件既有测试。
4. **LanState/refusals 在 churn 下的读取**：快照必须深拷贝、按独立锁保护，不能与 rib 锁嵌套。→ Task 5 的 `-race` 断言。
5. **空状态**：没有 netview 的 spoke、没有 claim 的 hub、journal 为空的 API，都应安静地是空，而不是报错/崩。→ Task 6/7 的空表测试。

---

### Task 1: entrypoint 携带 share_lan / share_mode

**Files:**
- Modify: `tunnel/entrypoint/entrypoint.go`（`LoadConfig` 映射 ~312-335、`RestartRunning` 同款字面量 ~265-287、`SaveConfig` 回写 ~366-392）
- Modify: `api/entrypoint_handler.go`（`entrypointCreateRequest` 17-40、`toOptions` 42-56、`validateTunEntryPoint` 126）
- Test: `tunnel/entrypoint/entrypoint_share_test.go`（新）、`api/api_test.go`

**Interfaces:**
- Consumes: `tunnel.ShareLANOption(string) Option`、`tunnel.ShareModeOption(string) Option`（已有，`tunnel/tunnel.go:357/361`）；`tunnel.ParseShareLANNets`（`tunnel/natlan.go:34`）。
- Produces: 请求 JSON `share_lan`/`share_mode`；`tunnel.Options.ShareLAN/ShareMode` 在 entrypoint 三处映射里存活（`createEntryPoint` 已走 `tunnel.TunnelOptions`，自动得值）。

- [ ] **Step 1: 写失败测试**

`tunnel/entrypoint/entrypoint_share_test.go`：`TestEntryPointConfigRoundTripsShareFields` — 用 `NewTunEntryPoint(tp.IDOption("ep-share"), tp.NameOption("ep-share"), tp.ShareLANOption("192.168.50.0/24"), tp.ShareModeOption("kernel"))` 建号、`SaveConfig()`、读回 `config.Get().EntryPoints` 断言两字段；再 `LoadConfig()` 断言注册表里的 ep `Options().ShareLAN/ShareMode` 一致（照 `restart_test.go`/`restore_test.go` 的 config 隔离方式）。

`api/api_test.go`：`TestCreateTunEntrypointShareFields` — POST `/api/entrypoints` `{type:"tun",name:"ep1",net:"10.20.0.2/24",share_lan:"192.168.50.0/24",share_mode:"auto"}`，GET 回读断言 `options.share_lan`/`options.share_mode`；`TestCreateTunEntrypointRejectsBadShareLAN` — `share_lan:"banana"` 得 400。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel/entrypoint/ -run TestEntryPointConfigRoundTripsShareFields -count=1`；`GOWORK=off go test ./api/ -run 'TestCreateTunEntrypointShare' -count=1`
Expected: FAIL（字段丢失 / 400 未拒绝）。

- [ ] **Step 3: 实现**

- `entrypointCreateRequest` 加：
  ```go
  ShareLAN  string `json:"share_lan,omitempty"`
  ShareMode string `json:"share_mode,omitempty"`
  ```
  `toOptions()` 加 `tunnel.ShareLANOption(r.ShareLAN), tunnel.ShareModeOption(r.ShareMode)`。
- `validateTunEntryPoint` 末尾照 `api/tunnel_handler.go:651-653` 加 share_lan 校验（`ParseShareLANNets` 失败 → `share_lan %q is not a comma-separated list of CIDRs: %v`）。
- `tunnel/entrypoint/entrypoint.go` 三处字面量映射（LoadConfig、RestartRunning、SaveConfig）各加 `ShareLAN: .../cfg.ShareLAN, ShareMode: .../cfg.ShareMode`。

- [ ] **Step 4: 跑测试确认通过**

Run: `GOWORK=off go test ./tunnel/entrypoint/ ./api/ -count=1`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add tunnel/entrypoint/entrypoint.go tunnel/entrypoint/entrypoint_share_test.go api/entrypoint_handler.go api/api_test.go
git commit -m "feat(entrypoint): carry share_lan and share_mode"
```

---

### Task 2: spoke 启动接线（控制通道 + 分享栈 + 降级 connector）

**Files:**
- Create: `tunnel/shareconnector.go`、`tunnel/shareconnector_test.go`
- Modify: `tunnel/share_spoke.go`（导出探针与 spec 构造）、`tunnel/entrypoint/tun.go`（struct、init、RunContext、Close）、
- Test: `tunnel/entrypoint/share_wire_test.go`（新）

**Interfaces:**
- Consumes: `tunnel.SetupSpokeShare(hubNet string, lans []*net.IPNet, mode string, kernelOK bool) (string, func(), error)`；`tunnel.NewChainShareShim(lans, stack)`；`newShareStack(mtu)`；`tunnel.StartNetview(ctx, host, hubPeer, shareLAN string, provider any, log)`；`ShareKernel/ShareUserspace/ShareAuto`。
- Produces:
  - `func ProbeShareKernel() bool`（包 tunnel 导出包装 `probeShareKernel`）。
  - `func ShareLANSpec(lans []*net.IPNet) string`（原 `shareLanSpec` 导出重命名，内部调用方同步）。
  - connector `"tun-share"`：metadata `lans`（`ShareLANSpec` 格式）、`mtu`（int）；`Connect` 返回以**新** `ChainShareShim`（新栈）包好的 conn。

- [ ] **Step 1: 写失败测试**

`tunnel/shareconnector_test.go`：
- `TestShareConnectorRegistersAndWraps`：`registry.ConnectorRegistry().Get("tun-share")` 非 nil；`NewShareConnector(...)` + `Init(mdx.NewMetadata(map[string]any{"lans":"192.168.50.0/24","mtu":1420}))`；对 `net.Pipe` 的链 conn `Connect`；用 fake stack（照 `share_spoke_test.go` 的 fake 实现）断言：写向 192.168.50.0/24 的包进 `stack.write`、普通包原样可读、stack 输出经 `pumpStack` 写回链。
- `TestShareConnectorNewShimPerConnect`：同一 connector `Connect` 两次（两个 pipe），断言两个返回 conn 各自独立（向第二个链写不因第一次状态而短路）。

`tunnel/entrypoint/share_wire_test.go`：
- `TestSpokeSelectsShareConnectorOnDowngrade`：替换 `probeKernel`/`applySpokeShare` 两个 package var（fake 返回 `(ShareUserspace, cleanup, nil)`、probe false）；`NewTunEntryPoint(tp.IDOption("ep1"), tp.NameOption("ep1"), tp.PeerOption(testPeerKey), tp.NetOption("10.20.0.2/24"), tp.ShareLANOption("192.168.50.0/24"))`；调 `s.init()`；断言 `s.config.Chains[0].Hops[0].Nodes[0].Connector.Type == "tun-share"` 且 metadata `lans` 正确。
- `TestSpokeKeepsForwardWhenKernel`：同上但 fake 返回 `ShareKernel`；断言 connector 仍 `"forward"`，且 `s.shareCleanup != nil`。
- `TestSpokeShareCleanupRunsOnce`：上例 init 后 `s.Close()` 两次，cleanup 调用计数 == 1。

- [ ] **Step 2: 跑测试确认失败**

Run: `GOWORK=off go test ./tunnel/ -run TestShareConnector -count=1`；`GOWORK=off go test ./tunnel/entrypoint/ -run TestSpoke -count=1`
Expected: FAIL（`tun-share` 未注册 / 字段不存在）。

- [ ] **Step 3: 实现**

`tunnel/shareconnector.go`：

```go
func NewShareConnector(opts ...connector.Option) connector.Connector // x registry 工厂
type shareConnector struct {
    opts     connector.Options
    lans     []*net.IPNet
    mtu      int
    newStack func(int) ShareStackBackend // 默认返回 newShareStack；测试可换
}
func (c *shareConnector) Init(md md.Metadata) error // md.Get("lans")/("mtu")，ParseShareLANNets
func (c *shareConnector) Connect(ctx context.Context, conn net.Conn, network, address string, opts ...connector.ConnectOption) (net.Conn, error)
// Connect: shim := NewChainShareShim(c.lans, c.newStack(c.mtu)); return shim.Wrap(conn), nil
func init() { registry.ConnectorRegistry().Register("tun-share", NewShareConnector) }
```

`tunnel/entrypoint/tun.go`：
- struct 加 `shareCleanup func()`；helper `teardownShare()`（nil-safe，调后置 nil）。
- `init()` 在 node/chain 组装后（~180 之后）：
  ```go
  if lans, err := tunnel.ParseShareLANNets(s.opts.ShareLAN); err == nil && len(lans) > 0 {
      eff, cleanup, err := applySpokeShare(s.opts.Net, lans, s.opts.ShareMode, probeKernel())
      if err != nil { return err }
      s.shareCleanup = cleanup
      if eff == tunnel.ShareUserspace {
          node.Connector = &xconfig.ConnectorConfig{Type: "tun-share",
              Metadata: map[string]any{"lans": tunnel.ShareLANSpec(lans), "mtu": s.opts.MTU}}
      }
  }
  ```
- package var 缝：`var probeKernel = tunnel.ProbeShareKernel`、`var applySpokeShare = tunnel.SetupSpokeShare`。
- `RunContext`：punch 之后（~265）加 `tunnel.StartNetview(ctx, host, s.peer, s.opts.ShareLAN, s.provider, log)`（**无条件**，不分享也要装去程路由）。
- 启动回滚：`!started` 的 defer（227-233）里加 `s.teardownShare()`；`Close()`（400-427）在 `forward.Close` 与 `Unregister` 之间加 `s.teardownShare()`（closeOnce 内，恰好一次）。

- [ ] **Step 4: 跑测试确认通过**

Run: `GOWORK=off go test ./tunnel/ ./tunnel/entrypoint/ -count=1`（再跑一次 `-race`：`CGO_ENABLED=1 go test -race ./tunnel/ ./tunnel/entrypoint/ -count=1`）
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add tunnel/shareconnector.go tunnel/shareconnector_test.go tunnel/share_spoke.go tunnel/entrypoint/tun.go tunnel/entrypoint/share_wire_test.go
git commit -m "fix(tun): start the spoke's control channel and share stack"
```

---

### Task 3: hub 的 LAN 计数真值

**Files:**
- Modify: `runner/task/stats.go`（`updateTunnel` 83-90 的 Stats 块）
- Test: `runner/task/stats_test.go`

**Interfaces:**
- Consumes: `xstats.KindLanRouted/KindLanDenied/KindLanWithdrawn`（x `observer/stats/stats.go:19-21`）；`config.ServiceStats` 的 `LanRouted/LanDenied/LanWithdrawn`（`config/config.go:473-478`）。
- Produces: hub（tunnel）的 `/api/stats` 三个 LAN 计数不再恒 0。

- [ ] **Step 1: 写失败测试**

`runner/task/stats_test.go` 加 `TestUpdateTunnelReportsLanCounters`：
```go
st := xstats.NewStats(false)
st.Add(xstats.KindLanRouted, 2); st.Add(xstats.KindLanDenied, 1); st.Add(xstats.KindLanWithdrawn, 3)
tun := tunnel.NewTunTunnel(tunnel.IDOption("lan-counters"), tunnel.NameOption("lan-counters"), tunnel.StatsOption(st))
tunnel.Add(tun); t.Cleanup(remove)
var task updateStatsTask
if err := task.updateTunnel(); err != nil { t.Fatal(err) }
got := tun.Stats()
// want LanRouted==2, LanDenied==1, LanWithdrawn==3
```
（若未运行的 `TunTunnel.Status().Stats()` 不是传入的 `st`，改用 hub 真实写入路径的同一个 sink——即 `controlHub.SetCounter` 拿到的那个 `xstats.Stats`；断言的是 `updateTunnel` 读的那条链。构造样式参考 `api/api_test.go:359` 的 `NewTunTunnel` 无 Run 用法。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./runner/task/ -run TestUpdateTunnelReportsLanCounters -count=1`
Expected: FAIL（三个字段为 0）。

- [ ] **Step 3: 实现**

`updateTunnel` 的 `if s := status.Stats(); s != nil { ... }` 块补三行（与 `updateEntrypoint:145-147` 完全同款）：
```go
stats.LanRouted = s.Get(xstats.KindLanRouted)
stats.LanDenied = s.Get(xstats.KindLanDenied)
stats.LanWithdrawn = s.Get(xstats.KindLanWithdrawn)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `GOWORK=off go test ./runner/... -count=1`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add runner/task/stats.go runner/task/stats_test.go
git commit -m "fix(stats): report the hub's LAN counters"
```

---

### Task 4: typed refusal（RIB 侧）

**Files:**
- Modify: `tunnel/rib.go`（struct 83-96、`newRIB` 111、拒绝点 195/199-200/204/208、`approvalRefusal` 222）
- Test: `tunnel/rib_test.go`（8 处 `newRIB` 调用点同步）

**Interfaces:**
- Produces:
  ```go
  // newRIB(hubID, allow, events, refused, now) — refused 追加在 events 之后
  refused func(origin string, prefix netip.Prefix, code, detail string)
  // 六个码（常量）：
  // refusalNoAllowRow="no-allow-row" / refusalEmptyAllow="empty-allow" / refusalOutsideAllow="outside-allow"
  // refusalCoversMember="covers-member" / refusalHubOwnRoute="hub-own-route" / refusalTakenByPeer="taken-by-peer"
  // approvalRefusal(origin, prefix) 改为返回 (code, detail string, ok bool)
  ```
- 语义：`detail` 为既有的人类句子；`r.report` 原样保留；钩子 nil-safe。

- [ ] **Step 1: 写失败测试**

`tunnel/rib_test.go` 加 `TestRIBRefusalCodes`：fake 收集 `(origin, code, detail)`；分别构造六个拒绝场景（无 allow 行 / 空 allow / allow 外 / 覆盖成员 tun 地址 / hub 自身静态路由 / 同长被他人先占），断言六码各出现一次、`detail` 非空；既有 8 个测试的 `newRIB` 调用补一个 nil refused 参数。

- [ ] **Step 2: 跑测试确认失败**

Run: `GOWORK=off go test ./tunnel/ -run TestRIB -count=1`
Expected: FAIL（签名不符）。

- [ ] **Step 3: 实现**

- `rib` 结构加 `refused` 字段；`newRIB` 加参数；`report` 旁加 nil-safe `refuse(origin, prefix, code, detail)` helper（调用 `r.refused`）。
- `approvalRefusal` 改为返回码+句子：no-allow-row/empty-allow/outside-allow。
- 四个拒绝点：:195 用 approval 的码；:199-200 码 `covers-member`；:204 码 `hub-own-route`；:208 码 `taken-by-peer`。每个点 `refuse(...)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `GOWORK=off go test ./tunnel/ -count=1`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add tunnel/rib.go tunnel/rib_test.go
git commit -m "feat(ctrl): type the hub's claim refusals"
```

---

### Task 5: refusal journal + 记账单源

**Files:**
- Modify: `tunnel/ctrlhub.go`（struct 61-88、sink 接线 150-154、`LanState` 316-344、`applyClaim` 448-463、`installed` 501-507）
- Test: `tunnel/ctrlhub_test.go`

**Interfaces:**
- Produces:
  ```go
  type LanRefusal struct { Prefix, Peer, Reason, Detail string; At time.Time }
  type LanState struct { Routes []LanRoute; Refused []LanRefusal } // Refused 新在前
  const refusalJournalCap = 16
  ```
- 钩子行为（唯一记账点）：入 journal（`refMu` 保护、append 后截断、新在前）+ `count(xstats.KindLanDenied, 1)` + `event.Record(ch.hubID, event.LevelWarn, "spoke %q may not claim %s: %s", origin, prefix, detail)`。
- **删除** `applyClaim` 的 `before - len(accepted)` 计数（458-462），否则双计。

- [ ] **Step 1: 写失败测试**

`tunnel/ctrlhub_test.go`：
- `TestControlHubJournalsRefusals`：经既有 deliver 管线投两个会被拒的 claim；`waitFor` 断言 `LanState().Refused` 两条、新在前、字段（prefix/peer/reason/detail/at）齐全；fakeCounters 的 `KindLanDenied` == 2（不再翻倍）；事件可用 `event.List(hubID)` 断言（若既有测试有事件断言模式则复用）。
- `TestControlHubJournalCapsAt16`：投 17 次拒绝，断言 len == 16 且最旧一条被挤掉。
- 既有 `TestControlHubCountsWhatItRouts`/`TestControlHubLanStateForTheDoctor` 同步（denied 来源变化；LanState 带 Refused 不影响既有断言）。

- [ ] **Step 2: 跑测试确认失败**

Run: `GOWORK=off go test ./tunnel/ -run TestControlHub -count=1`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `controlHub` 加 `refusals []LanRefusal` + `refMu sync.Mutex`（独立锁，不与 rib 锁嵌套——rib 的拒绝点持 rib 锁回调，`refMu` 是叶子锁；`LanState` 在此锁下深拷贝切片后立即释放）。
- `newControlHub` 里把 refused 钩子传给 `newRIB`（Task 4 的新参数）。
- `LanState` 返回值加 Refused 快照（拷贝，新在前）。
- 删除 `applyClaim` 的差集计数。

- [ ] **Step 4: 跑测试确认通过**

Run: `GOWORK=off go test ./tunnel/ -count=1`，再 `CGO_ENABLED=1 go test -race ./tunnel/ -run TestControlHub -count=1`
Expected: PASS，无 race。

- [ ] **Step 5: 提交**

```bash
git add tunnel/ctrlhub.go tunnel/ctrlhub_test.go
git commit -m "feat(ctrl): journal refused claims"
```

---

### Task 6: 装/撤路由的事件时间线

**Files:**
- Modify: `tunnel/ctrlhub.go`（`installed` 字段 78、`installed()` 501-507、`installRoutes` 513-543）
- Test: `tunnel/ctrlhub_test.go`

**Interfaces:**
- `installed map[netip.Prefix]string`（prefix→声称者）；`installed(routes) map[netip.Prefix]string`。
- `installRoutes` 在两条 diff 循环内记事件（只在 diff 非空时天然发生）：
  - 新增：`event.Record(ch.hubID, event.LevelInfo, "LAN route %s installed (spoke %q)", prefix, peer)`
  - 消失：`event.Record(ch.hubID, event.LevelInfo, "LAN route %s withdrawn (spoke %q)", prefix, oldPeer)`
- 计数（Routed/Withdrawn）与 `sink.SetPrefixRoutes` 行为不变。

- [ ] **Step 1: 写失败测试**

`TestControlHubRecordsRouteChanges`：claim 到达 → `event.List(hubID)` 含 "installed (spoke …)"；drop/TTL 撤销 → 含 "withdrawn (spoke …)" 且 peer 正确；同一表二次 publish（无 diff）→ 事件数不变（刷新不记）。

- [ ] **Step 2: 跑测试确认失败**

Run: `GOWORK=off go test ./tunnel/ -run TestControlHubRecordsRouteChanges -count=1`
Expected: FAIL。

- [ ] **Step 3: 实现**

`installed()` 返回 `map[netip.Prefix]string`（值取 `PrefixRoute.Peer`）；`installRoutes` diff 时携带旧值；两个循环内加 `event.Record`（import `github.com/go-gost/wisper/event`）。既有 `fakeP2PHandler.installed()` 辅助（值类型不同）与相关测试同步。

- [ ] **Step 4: 跑测试确认通过**

Run: `GOWORK=off go test ./tunnel/ -count=1`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add tunnel/ctrlhub.go tunnel/ctrlhub_test.go
git commit -m "feat(ctrl): record LAN route installs and withdrawals"
```

---

### Task 7: API / doctor / spoke 出口 / 日志纪律

**Files:**
- Modify: `tunnel/netview_router.go`（`Prefixes` 新方法；:225 debug→warn）、`tunnel/entrypoint/netview.go`（`InstalledLANRoutes` 新导出；:37/:62 debug→warn）
- Modify: `api/tunnel_handler.go`（`lanRouteJSON` 156、`lanResponse` 167、`lanJSON` 182、`peerStatsJSON` 52-74、`tunnelResponse` 23-27、`toTunnelResponse` 272-411）、`api/p2p_handler.go`（99-114）
- Test: `tunnel/netview_router_test.go`、`tunnel/entrypoint/` 测试、`api/api_test.go`

**Interfaces:**
- Produces:
  ```go
  func (r *NetviewRouter) Prefixes() []string                 // 排序 CIDR（mu 下）
  func entrypoint.InstalledLANRoutes() []string               // netviewRouter().Prefixes()；未装过返回空
  type lanRejectedJSON struct { Prefix, Peer, Reason, Detail string; At string } // json: prefix/peer/reason/detail/at
  // lanResponse 增 Rejected []lanRejectedJSON `json:"rejected,omitempty"`
  // peerStatsJSON 增 LAN []string `json:"lan,omitempty"`（从 LanState.PeerClaims()[key]）
  // tunnelResponse 增 LANRoutes []string `json:"lan_routes,omitempty"`（仅 tun entrypoint：t.Type()==entrypoint.TunEntryPoint）
  ```
- doctor：`doctor.Report` 文本后追加 LAN 段（spec §5.5 格式；遍历 `tunnel.Count()/GetIndex(i)` 的 `LanStateReporter`，非空才出；refused 封顶 5 条）。

- [ ] **Step 1: 写失败测试**

- `tunnel/netview_router_test.go`：`TestNetviewRouterPrefixes` — Apply 一个含两条 claim 的 netview 后 `Prefixes()` 排序正确；空 router 返回空。
- `tunnel/entrypoint`：`TestInstalledLANRoutesEmpty` — 未启动时返回空（不 panic）。
- `api/api_test.go`：`TestLanJSONRendersRejected`（构造 `tunnel.LanState{Refused: ...}`，断言 `lanJSON` 字段与 RFC3339）；`TestTunResponsePeerStatsCarryLAN`（照 `TestLanJSONRendersTheDoctorsViews` 的构造风格，断言 peer_stats[].lan）；`TestDoctorShowsLanSection`（含 `LanStateReporter` 的 tunnel 注册后，doctor 文本包含 "LAN routing" 段与 refused 行）。

- [ ] **Step 2: 跑测试确认失败**

Run: `GOWORK=off go test ./tunnel/ ./tunnel/entrypoint/ ./api/ -run 'Prefixes|InstalledLAN|Rejected|PeerStatsCarryLAN|DoctorShowsLan' -count=1`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `Prefixes()`：`r.mu` 下把 `r.routes` 的 `prefix.String()` 收集后 `sort.Strings`。
- `InstalledLANRoutes()`：`r := netviewRouter(); return r.Prefixes()`（注释说明"API 读取也会惰性建空 router，响应语义为空"）。
- `lanJSON`：`Rejected` 从 `lan.Refused` 映射（`At.UTC().Format(time.RFC3339)`），排序保持 journal 的新在前。
- `toTunnelResponse`：把 `LanStateReporter` 断言提前，取一次 `peerLAN := ls.LANState().PeerClaims()`；peer_stats 循环里 `if claims := peerLAN[key]; len(claims) > 0 { ps.LAN = claims }`；`resp.Lan` 逻辑不变并带上 Refused；tun entrypoint 时填 `resp.LANRoutes`。
- `handleGetP2PDoctor`：`text := doctor.Report(...)`；追加 LAN 段（格式照 spec §5.5：`=== LAN routing (hub <name>) ===`、`installed: N routes`、每路由一行、`claims:`、`refused (this run):` 至多 5 条）；`w.Write([]byte(text))`。
- 三处 debug→warn（消息文本不变，`netview_router.go:225` 的刷新失败信息带 prefix）。

- [ ] **Step 4: 跑测试确认通过**

Run: `GOWORK=off go test ./tunnel/ ./tunnel/entrypoint/ ./api/ -count=1`
Expected: PASS（api 套件约 130s，勿用短超时）。

- [ ] **Step 5: 提交**

```bash
git add tunnel/netview_router.go tunnel/netview_router_test.go tunnel/entrypoint/netview.go api/tunnel_handler.go api/p2p_handler.go api/api_test.go
git commit -m "feat(api): expose refused claims and the spoke's installed routes"
```

---

### Task 8: Web · 类型、store、peer 行

**Files:**
- Modify: `web-src/src/api/types.ts`（stats 27-47、`PeerStats` 103-137、`Tunnel` 151-173、`EntrypointOptions` 209-224、`Entrypoint` 226-242、`EntrypointCreateRequest` 249-268）、`web-src/src/store/tunnel-store.ts`（applyStats 117-133）、`web-src/src/components/peer-stats-row.ts`（132-135、样式 208-217）、`web-src/src/i18n/{en,zh}.ts`
- Test: 无（门禁 = typecheck + build）

**Interfaces:**
- `ServiceStats`/`ItemStats` 增 `lan_routed?: number; lan_denied?: number; lan_withdrawn?: number`。
- `PeerStats` 增 `lan?: string[]`。
- `Tunnel` 增 `lan?: { routes: LANRoute[]; claims: Record<string, { prefixes: string[]; allow?: string[] }>; rejected: LANRefusal[] }` + `interface LANRoute { prefix; origin; peer; allow?: string[] }`、`interface LANRefusal { prefix; peer; reason; detail?; at }`。
- `EntrypointOptions`/`EntrypointCreateRequest` 增 `share_lan?`/`share_mode?`；`Entrypoint` 增 `lan_routes?: string[]`。
- `applyStats` 增 `lan: s.lan`。
- peer 行：`stat?.lan` 非空时在 `.peer-ip` 旁显示 `LAN: cidr, …`（新 i18n 键 `peersLAN`，en/zh）。

- [ ] **Step 1: 实现（类型与拷贝先行，无单测）**

- [ ] **Step 2: 门禁**

Run: `cd web-src && npx tsc --noEmit && npx vite build`
Expected: 两者 exit 0。

- [ ] **Step 3: 提交**

```bash
git add web-src/src/api/types.ts web-src/src/store/tunnel-store.ts web-src/src/components/peer-stats-row.ts web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "feat(web): type the LAN API and show per-peer routes"
```

---

### Task 9: Web · hub tunnel 详情页「LAN 路由」段

**Files:**
- Modify: `web-src/src/pages/tunnel-detail-page.ts`（share 行 989-1010 之后、卡片收口 ~1120 之前；样式区 603-647 附近）、`web-src/src/i18n/{en,zh}.ts`
- Test: 无（门禁 = typecheck + build）

**Interfaces:**
- 仅当 `t2.lan` 存在渲染：
  1. 汇总行 `已路由 N · 拒绝 X · 已撤销 Y`（复用 `.stat-box`，色分正常/琥珀/灰），数值取 `t2.stats.lan_*`；
  2. 路由表 prefix / origin（`hub` 或 alias，无 alias 显示掩码 key）/ allow（"全部"或列表）；
  3. claims 按 peer 一行；
  4. rejected 表：时间 / peer / prefix / 原因码 + detail；表头标注"本次运行"；
  5. 指引行（固定）："路由已装但仍不通？看 peer 的传输徽标、共享后端事件（kernel/userspace）、诊断面板的 punch 状态。"
- routes 为空显示"暂无 LAN 路由"；新 i18n 键齐套（en+zh）。

- [ ] **Step 1: 实现**

- [ ] **Step 2: 门禁**

Run: `cd web-src && npx tsc --noEmit && npx vite build`
Expected: exit 0。

- [ ] **Step 3: 提交**

```bash
git add web-src/src/pages/tunnel-detail-page.ts web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "feat(web): show a hub's LAN routes and refusals"
```

---

### Task 10: Web · entrypoint 页（分享配置 + 已装路由）

**Files:**
- Modify: `web-src/src/pages/entrypoint-detail-page.ts`（state 35-56、populate 130-150、body 267-290、tun 表单 1001-1044、tun extras 849-878）、`web-src/src/i18n/{en,zh}.ts`
- Test: 无（门禁 = typecheck + build）

**Interfaces:**
- tun 表单加 `share_lan` 文本输入（`fieldShareLAN`/`fieldShareLANHint` 复用）+ `share_mode` 点击轮换（照 tunnel-detail 的 `SHARE_MODES`/`.switch-row` 模式，`shareModeAuto/Kernel/Userspace` 复用）；
- 请求体加 `share_lan`/`share_mode`（tun 才带）；
- tun extras 信息行加：`share_lan` 配置值 + `lan_routes`（`ep.lan_routes` 非空时，"LAN 路由（hub 批准）"）。

- [ ] **Step 1: 实现**

- [ ] **Step 2: 门禁**

Run: `cd web-src && npx tsc --noEmit && npx vite build`
Expected: exit 0。

- [ ] **Step 3: 提交**

```bash
git add web-src/src/pages/entrypoint-detail-page.ts web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "feat(web): configure a spoke's LAN share and show installed routes"
```

---

## 收尾（不在任务内，交付时执行）

- 全量门禁：`GOWORK=off go build ./...`；各包测试 + `-race`；`GOWORK=off golangci-lint run --timeout 5m`；web typecheck+build。
- 本地探针功能验收（spec §5.0，脚本在 `/tmp/opencode/probe/probe1.sh` 基础上补 spoke 段）：hub claims 出现 B、A ping 通 B 的 LAN 主机。
- 全分支审查后合入 main；spec 的四个阶段提交序检查；`TestRunDeviceProbeReportsSent` 与本次无关。
