# wisper LAN 可观测性与诊断：让路由状态可见、故障可定位设计

日期：2026-10-10（审查后修订 v2） | 状态：draft 待 review | 路径：architectural（brainstorming 已确认：UI 为主 + 诊断可精准快速定位，用户指示"走spec"；审查发现 spoke 侧未接线，用户确认修复纳入本 plan）

## 1. 理解与目标（用户所说 vs 假设）

- 用户所说：v1.9.0 已发布 LAN routing，但"新版本完全看不到新功能变化"；且可观测性与诊断要同时考虑**以后 debug 是否方便、能否精准快速定位问题**。
- 假设（待纠正）：主要消费者是 app 内的 Web UI（原生壳 / Tauri / Android 都嵌 `web-src`）；排查入口同时存在服务器侧（日志文件、`GET /api/logs`）与设备侧（设置页诊断面板）；hub 与 spoke 通常是两台主机，调试依赖各自状态而非同机观察（e2e 探针尚未建成，不在本设计内兑现）。
- 成功标准：
  - **S0 功能可达（修复前置，审查后增补）**：spoke 的 `share_lan` 配置真正生效——claim 到达 hub、路由装上、A 能经 hub 到达 B 的 LAN。不满足 S0，S1–S5 都是给空表做 UI。
  - S1 可见：hub 的 tunnel 详情页能看到已装路由表、各 spoke 的 claim、三个 LAN 计数；peer 行能看到各自 LAN 网段；spoke 的 entrypoint 页能看到本机已装路由。
  - S2 可定位："ping 不通"能在半分钟内归到三类之一——claim 没到 / 被拒（**带原因**）/ 装上但传输层不通——每类指出具体 peer 与 prefix，并给出下一步看哪里。
  - S3 可回溯：装路由 / 撤路由 / 拒绝都有时间线，"什么时候变的、为什么变"可答。
  - S4 一处面板：设置页诊断面板不新增界面即可看到 LAN 摘要。
  - S5 数字为真：hub 的三个 LAN 计数不再恒 0（§2 断点一是这一切的地基）。

## 2. 现状与根因

- **断点零（最致命，2026-10-10 审查发现）：spoke 侧从未接线。** `StartNetview`（`tunnel/entrypoint/netview.go:53`）、`SetupSpokeShare`/`NewChainShareShim`（`tunnel/share_spoke.go`）零非测试调用方；`tunEntryPoint.RunContext` 不启动控制通道也不应用分享；entrypoint 的配置面（config/API/UI）没有 `share_lan`。真实部署中没有任何 claim 到达 hub——claims 恒空、路由恒无，不只是显示问题。修复见 §5.0，为本 plan 第一优先级。
- 数据本来就在，且 API 契约是对的：`api/tunnel_handler.go:44` `Lan *lanResponse`（routes + claims，`:156-199`）、peer 的 `LAN []string`（`:87`）、`statsResponse.LanRouted/LanDenied/LanWithdrawn`（`:212-216`），`/api/stats`、`/api/tunnels`、`/api/entrypoints` 都在吐。
- **断点一（最致命）：hub 的计数恒 0。** `runner/task/stats.go` 的 `updateTunnel`（`:85-90`）只读 5 个通用 kind；三个 LAN kind 只有 `updateEntrypoint` 读（`:145-147`）。hub 是 tunnel 不是 entrypoint，而 LAN 计数只由 hub 产生（`tunnel/ctrlhub.go` 的 `installRoutes`/`applyClaim`），于是 API 对 hub 永远吐 0。唯一有数据的那个面是假的。
- **断点二：前端不消费。** `web-src/src/api/types.ts` 无 `lan` 字段；`store/tunnel-store.ts` 的 `applyStats`（`:118-131`）只拷 `entrypoint/stats/status/error/peer_stats`，`lan` 被直接丢弃。
- **断点三：失败不可定位。** 被拒只有 `tunnel/rib.go:195-208` 的 warn 行（六种原因），无结构化出口、无对象、无时间；路由**装上**无任何记录（成功路径完全静默）；spoke 侧刷新失败是 debug 级（`tunnel/entrypoint/netview_router.go:225`），默认不可见。
- **断点四：诊断割裂。** `api/p2p_handler.go:99-114` 的 doctor 是纯 p2p 文本，与 LAN 状态无关；一个问题要同时翻 API、日志、doctor 三处。

## 3. 诊断模型（本设计的主线）

一切 LAN 故障归三类，每类一条证据链，每类一个首页可读出口：

| 类 | 含义 | 证据链（既有） | 本设计新增 |
|---|---|---|---|
| A claim 没到 hub | spoke 的声明从未被 RIB 收到 | hub claims 表为空 | spoke 侧 register/refresh 失败提到 **warn**（现为 debug），带 prefix 与失败原因 |
| B claim 被拒 | RIB 拒绝，spoke 不知情 | `rib.go:195-208` 六种原因的 warn 行 | **refusal journal**：peer/prefix/原因码/时间，API + UI 可读（§5.2） |
| C 装上但不通 | 路由在表里但流量不过 | peer 行 transport 徽标；`share_effective`/`share_downgraded` 事件（`tunnel/tun.go:551-554`）；doctor 的 punch 状态 | UI 在 LAN 段给一行"仍不通看这三处"的指引，不新增机制 |

接线修复（§5.0）是这一切的前置：在它落地前，A/B/C 三类都只是"没有数据"。

撤销是第四种状态变化而非故障：TTL 到期（spoke 停止重述）与显式 drop 都要带原因进时间线（§5.3）。

## 4. 决策记录

1. **一次到位**：UI 三处呈现 + refusal journal + 事件时间线 + doctor LAN 段落 + 计数修复（用户确认"UI 为主"，并要求诊断可精准定位；不做半吊子）。
2. **journal 只驻内存（用户确认）**：环形 16 条、新在前、重启即清；"时间线/回溯"由事件历史（持久、按对象）承担。UI 标注"本次运行"，避免把易失数据当承诺。
3. **refusal 结构化但句子不双写**：RIB 增加带原因码的 typed refusal 钩子，人类可读的 `r.report` 行保持不动——日志与 journal 同源，不会漂移。
4. **doctor 段落由 wisper 侧追加**：`handleGetP2PDoctor` 在 p2p 文本后附加 LAN 段，**不动 p2p 仓库**（跨仓发布不在本设计范围）。
5. **计数修复走真源**：`updateTunnel` 补三个 `s.Get`。`updateEntrypoint` 的三个读数保留——spoke entrypoint 不产生 LAN 计数，恒 0 无害；不为它新增逻辑。
6. **不动的东西**：API 既有形状只增不改；首页状态条不做；不上 prometheus；不碰 Android 原生壳；**不建 CI e2e**（功能验收用 2026-10-09 的本地探针，§5.0；CI 化另行排期）。
7. **接线纳入（用户确认）**：spoke 接线修复是本 plan 的 commit 1（§5.0）——观察性以功能存在为前提。
8. **提交四分**：接线修复（§5.0）→ 数据真值（计数修复）→ 内核（RIB/journal/事件/API/doctor/日志）→ 前端（UI）。每个 commit 可独立验证。

## 5. 详细设计

### 5.0 Go · spoke 接线：让数据流真的存在（修复，commit 1）

**现状证据**（审查）：`StartNetview`（`tunnel/entrypoint/netview.go:53`）、`SetupSpokeShare`/`NewChainShareShim`（`tunnel/share_spoke.go`）零非测试调用方；`tunEntryPoint.RunContext` 从不启动它们；entrypoint 无 `share_lan` 配置。

**配置面（`share_lan` + `share_mode`，与 tunnel 同名同义）**：
- `config/config.go`：entrypoint 配置结构体加 `ShareLAN`/`ShareMode` 两字段（tag 同 tunnel，`config.go:352-354` 的孪生）；config→options 映射同步带上。`createEntryPoint` 已走 `tunnel.TunnelOptions(opts)`（`entrypoint.go:422`），上游填上即通。
- `api/entrypoint_handler.go`：`entrypointCreateRequest` 加两字段 + `toOptions()` 映射 + 创建/更新校验（`ParseShareLANNets`/`NormalizeShareMode`，照 `api/tunnel_handler.go:651`）。
- Web：`entrypoint-detail-page.ts` 表单状态/输入/请求体/回填（照 `tunnel-detail-page.ts:195/291` 的 `_shareLAN`），tun 类型才显示；`share_mode` 缺省 auto。

**启动接线（`tunnel/entrypoint/tun.go`）**：
1. **控制通道永远启动**：`StartNetview(ctx, host, s.peer, s.opts.ShareLAN, s.provider, log)`——不分享 LAN 的 spoke 也要靠它装 hub 批准的去程路由；ctx 用 RunContext 的 ctx；放在 host 注册与 punch 之后。空 `share_lan` 族 claim 为空（组件已处理），不影响控制通道与 netview 安装。
2. **分享条件应用**：`share_lan` 非空时 `SetupSpokeShare(s.opts.Net, lans, shareMode, probeShareKernel())`；语义与 hub 对齐（`kernel` 钉死失败即启动失败；`auto` 降级 userspace + warn 事件）。cleanup 挂 entrypoint 关闭路径（与 hub 的 `shareCleanup` 同款），启动中途失败即回滚。
3. **userspace 降级的数据路径**：`init()` 里先 probe+SetupSpokeShare 再定 connector——kernel 时节点保持 `forward`（`tun.go:173`）；userspace 时 `node.Connector.Type = "tun-share"`。新文件 `tunnel/shareconnector.go`：`init()` 向 x 的 connector registry 注册 `tun-share`；`Connect(ctx, conn, …)` 对拿到的链 conn 建一颗**新的** `ChainShareShim` + `newShareStack(mtu)`（每次 Connect 一颗，重拨不复用旧栈）并 `Wrap` 返回；metadata 传 `lans`/`mtu`。组件语义（分类/回复泵/关闭行为）Task 5 测试已覆盖，接线只管"何时建、挂在哪、谁关"。
4. **失败永远不致命**：控制通道连不上、auto 分享降级失败 → 记日志/事件，entrypoint 照常提供普通隧道能力（`StartNetview` 的既有承诺）。

**测试**：
- `tunnel/`：`tun-share` connector 注册可查；`Connect` 返回的 conn 对 fake 链分类走 stack、直通包原样；每次 Connect 独立栈。
- config/API：`share_lan`/`share_mode` round-trip；创建校验拒绝坏 CIDR。
- 接线级：断言 RunContext 在分享时选定 `tun-share`（probe/SetupSpokeShare 走可注入 fake；具体 seam 实现计划定）。
- **功能验收（本地探针，非 CI）**：复用 2026-10-09 探针（relay+hub+spoke 容器），spoke B 配 `share_lan` 后：hub 的 `lan.claims` 出现 B、A ping 通 B 的 LAN 主机（kernel 路径）——这正是 Task 7 缺掉的第一手检查。

### 5.1 Go · 计数修复（`runner/task/stats.go` + `stats_test.go`）

`updateTunnel` 的 `if s := status.Stats(); s != nil` 块补：

```go
stats.LanRouted = s.Get(xstats.KindLanRouted)     // 103
stats.LanDenied = s.Get(xstats.KindLanDenied)     // 104
stats.LanWithdrawn = s.Get(xstats.KindLanWithdrawn) // 105
```

（kind 定义在 `x/observer/stats/stats.go:19-21`；`config.ServiceStats` 字段已存在，`config/config.go:473-478`。）
测试：现有 `stats_test.go` 风格下，构造一个挂了 xstats 且三个 kind 非零的 tunnel，断言 `SetStats` 落下的 `ServiceStats.LanRouted/LanDenied/LanWithdrawn` 正确——守护"hub 计数能到 API"这条不变量。

### 5.2 Go · typed refusal + journal（`tunnel/rib.go`、`tunnel/ctrlhub.go`）

- 原因码（六种，与 `rib.go:195-208`/`approvalRefusal` 一一对应，顺序即排障顺序）：

  码 | 触发 | 人类句子（保持原样）
  ---|---|---
  `no-allow-row` | hub 没有该 peer 的 `lan_allow` 行 | "the hub has no lan_allow row for it..."
  `empty-allow` | 该行空 | "its lan_allow row is empty"
  `outside-allow` | prefix 不在允许的超网内 | "lan_allow lets it claim only inside ..."
  `covers-member` | prefix 覆盖某成员的 tun 地址 | "it covers %s, the tun address of spoke %q..."
  `hub-own-route` | hub 自己已注入该路由 | "the hub has that route of its own"
  `taken-by-peer` | 别的 spoke 先到先得 | "spoke %q claimed it first and keeps it"

- RIB：`newRIB` 增第二个钩子 `refused func(Origin string, Prefix netip.Prefix, Code string, Detail string)`。拒绝点只有四处 `r.report`：`no-allow-row`/`empty-allow`/`outside-allow` 三码由 `approvalRefusal` 改为返回 `(code, detail, ok)` 产生，其余三处（`covers-member`/`hub-own-route`/`taken-by-peer`）在分支内直接带码。`ApplyClaim` 签名不变。`rib.go:301` 的 TTL 撤销走 `report`（现有 warn 行）即可，不入 journal（它不是"被拒"）。
- `controlHub`：环形缓冲 `refusals []LanRefusal`（cap 16，`append` 后截断，新在前），钩子落地时：入 journal + `count(KindLanDenied, 1)` + `event.Record(hubID, event.LevelWarn, ...)`（与 `report` 的 warn 同行同内容，事件侧供 UI/事件页）。
- **记账唯一来源**：`applyClaim`（`ctrlhub.go:458-462`）里 `before - len(accepted)` 的 `KindLanDenied` 计数**删除**——与 refusal 钩子并存会双计，`ctrlhub_test.go:407` 的 `denied == 1` 也会破。
- 数据结构：`type LanRefusal struct { Prefix, Peer, Reason, Detail string; At time.Time }`，与 `LanRoute`/`LanState` 同放 `ctrlhub.go`。
- 访问：`LanState` 增字段 `Refused []LanRefusal`（tunnel 包内一个读，医生和 API 不会互不同意，与 Routes/PeerClaims 同源的原则一致）。

### 5.3 Go · 事件时间线（`tunnel/ctrlhub.go` installRoutes）

`installRoutes` 已有 diff（`routed`/`withdrawn`），把两边各补一条事件，**只在 diff 非空时记**（刷新不记，保证有界）：

- 新 prefix：`event.Record(hubID, LevelInfo, "LAN route %s installed (spoke %q)", prefix, peer)`
- 消失的 prefix：`event.Record(hubID, LevelInfo, "LAN route %s withdrawn (spoke %q)", prefix, peer)`。`ch.installed` 现为 `map[netip.Prefix]struct{}`（`ctrlhub.go:78`，无 peer），改为 `map[netip.Prefix]string`（prefix→声称者），同步改 `installed()` 辅助函数（`ctrlhub.go:501`）与相关测试；**原因**（TTL/掉线）由 `rib.go:301` 的既有 warn 行承担——事件给「谁/哪条」，日志给「为什么」，两行相邻可对照，不重新发明原因枚举。

hubID 即 tunnel ID（`s.opts.ID`，与 `tun.go:551` 的既有用法一致）。

### 5.4 Go · API（`api/tunnel_handler.go`）

- `lanResponse` 增 `Rejected []lanRejectedJSON `json:"rejected"``，元素 `{prefix, peer, reason, detail, at}`（`reason` = 原因码，`detail` = 人类句子，`at` RFC3339 UTC）；`lanJSON` 从 `lan.Refused` 填充，claims/routes 不变。
- `tunnelResponse` 增 `LANRoutes []string `json:"lan_routes,omitempty"``，仅 tun entrypoint 填充：`entrypoint.InstalledLANRoutes()`（新导出；`NetviewRouter` 增 `Prefixes() []string`，排序 CIDR）。
- **per-peer LAN 走轮询路径**：`peerStatsJSON` 增 `LAN []string `json:"lan,omitempty"``（数据源 `LanState.PeerClaims()[key]`），`toTunnelResponse` 的 peer_stats 映射同步填充。不依赖 allowlist 的 `options.peers[].lan`——那是静态配置面，`applyStats` 不拷 `options`，轮询不会刷新它。
- **只增不改**，旧消费者不受影响；其他出口不变（`/api/tunnels`、`/api/stats` 自动带上）。

### 5.5 Go · doctor LAN 段（`api/p2p_handler.go`）

`handleGetP2PDoctor` 在 `doctor.Report(...)` 文本后追加：遍历 tunnel 注册表（`runner/task/stats.go` 同款 `tunnel.Count()/GetIndex(i`），对实现 `LanStateReporter` 且 LAN 状态非空的每个 hub 输出一段：

```
=== LAN routing (hub <name>) ===
installed: 2 routes
  192.168.50.0/24  via spoke <alias/key>  allow: (all)
claims:
  <key-prefix…>: 192.168.50.0/24
refused (this run):
  [time] spoke <key-prefix…>: 10.0.0.0/8 — outside-allow (lan_allow lets it claim only inside 192.168.50.0/24)
```

封顶：refused 至多 5 条；无数据的 hub 不出现。设置页诊断面板零改动即可读。

### 5.6 Go · 日志纪律（spoke 侧升格）

`tunnel/netview_router.go:225`（刷新失败）与 `tunnel/entrypoint/netview.go:37/62`（注册失败、share_lan 解析失败）由 debug 提 warn，信息带 prefix：claim 发送/接收侧的失败是"LAN 不通"的 A 类直接证据，默认级别必须看得见。

### 5.7 Web（`web-src/src`）

- **`api/types.ts`**：
  - `ServiceStats`/`ItemStats` 增 `lan_routed?: number; lan_denied?: number; lan_withdrawn?: number`。
  - `PeerStats` 增 `lan?: string[]`（对应 `peerStatsJSON.lan`，轮询路径，随 `peer_stats` 每次刷新）。
  - `Tunnel` 增 `lan?: TunnelLAN`：

    ```ts
    interface LANRoute { prefix: string; origin: string; peer: string; allow?: string[] }
    interface LANRefusal { prefix: string; peer: string; reason: string; detail?: string; at: string }
    interface TunnelLAN { routes: LANRoute[]; claims: Record<string, { prefixes: string[]; allow?: string[] }>; rejected: LANRefusal[] }
    ```

- **`store/tunnel-store.ts`**：`applyStats` 多拷 `lan: s.lan`。
- **`store/stats-store.ts`**：`{...t.stats}` spread 已覆盖 `lan_*`，仅类型跟进，无需逻辑改。
- **`pages/tunnel-detail-page.ts`**：`share_lan` info 行之后渲染「LAN 路由」段，**仅当 `t2.lan` 存在**：
  1. 汇总行：`已路由 N · 拒绝 X · 已撤销 Y`（`.stat-box` 小格复用，色分：routed 正常、denied 琥珀、withdrawn 灰）；
  2. 路由表：prefix / origin（`hub` 或 spoke，spoke 显示 alias，无 alias 显示 key 掩码）/ allow（"全部"或列表）；
  3. claims：按 peer 一行（alias + CIDRs）；
  4. 被拒表（`rejected`）：时间 / peer（alias）/ prefix / 原因码 + 人类句子；表头标注"本次运行"；
  5. 指引行（固定一行）："路由已装但仍不通？看 peer 的传输徽标、共享后端事件（kernel/userspace）、诊断面板的 punch 状态。"
  - routes 为空时显示"暂无 LAN 路由"而非空白段。
- **`components/peer-stats-row.ts`**：`peer-ip` 行旁（同款 `.peer-ip` 样式）加 `LAN: cidr, …`，`lan` 非空才出现。
- **`pages/entrypoint-detail-page.ts`**：spoke 侧加一条 info-row：`LAN 路由（hub 批准）: 192.168.50.0/24, …`（顶置 `lan_routes` 非空时）。**生产者**：`tunnel/netview_router.go` 增 `(*NetviewRouter).Prefixes() []string`；`tunnel/entrypoint/netview.go` 增 `InstalledLANRoutes() []string`（经 `netviewRouter()` 读，未初始化进程返回空）；`toTunnelResponse` 对 tun entrypoint 填充。
- **`i18n/en.ts` + `zh.ts`**：新键齐套（段标题、表头、汇总标签、指引行、空态）。

## 6. 数据契约

```jsonc
// GET /api/tunnels（hub tunnel，新增/确认字段）
{
  "lan": {
    "routes": [
      { "prefix": "192.168.50.0/24", "origin": "yWeo…nMTQ", "peer": "yWeo…nMTQ" }
    ],
    "claims": { "yWeo…nMTQ": { "prefixes": ["192.168.50.0/24"] } },
    "rejected": [
      { "prefix": "10.0.0.0/8", "peer": "AbCd…1234", "reason": "outside-allow",
        "at": "2026-10-10T03:14:22Z" }
    ]
  },
  "stats": { "lan_routed": 2, "lan_denied": 1, "lan_withdrawn": 0, /* 其余不变 */ },
  "peer_stats": [ { "key": "…", "lan": ["192.168.50.0/24"], /* 其余不变 */ } ]
}
```

## 7. 测试与交付

- **Go 单测**：
  - `runner/task/stats_test.go`：hub 计数被采集（§5.1）。
  - `tunnel/rib_test.go`（现成）：六个原因码各一例；`outside-allow` 的位数规则不回归。
  - `tunnel/ctrlhub_test.go`（现成）：refusal 同时进 journal/count/event；journal 满 16 截断且新在前；installRoutes 只对 diff 记事件（刷新不记）；`LanState.Refused` 与 Routes 同源。
  - `api/` 渲染测试：`lan.rejected` 字段形状；doctor 文本含 LAN 段且有封顶。
  - `tunnel/` connector（§5.0）：`tun-share` 注册可查；Connect 返回的 conn 分类走 stack、直通包原样；每次 Connect 独立栈（重拨不复用）。
  - config/API（§5.0）：`share_lan`/`share_mode` round-trip；创建校验拒绝坏 CIDR。
- **Web**：无单测传统，门禁 = `npx tsc --noEmit` + `npx vite build`（CI 同款）。
- **门禁**：`GOWORK=off go build ./...`；按包 `go test`（`./runner/...`、`./tunnel/...`、`./api/...`；`-race` 需 `CGO_ENABLED=1`）；**推送前本地 `GOWORK=off golangci-lint run --timeout 5m`**（v1.9.0 的 CI 教训：CI 的 lint 即本地 v2.14.0，可完全复现）。
- **已知先存失败**：（x 仓）`TestRunDeviceProbeReportsSent` 只在 `-race` 下失败、只出现在 x 的 `./handler/tun/`；wisper 门禁不受影响。
- **触点清单**：改 `runner/task/stats.go`、`tunnel/rib.go`、`tunnel/ctrlhub.go`、`api/tunnel_handler.go`、`api/p2p_handler.go`、`tunnel/netview_router.go`、`tunnel/entrypoint/netview.go`、`config/config.go`、`api/entrypoint_handler.go`、`tunnel/entrypoint/tun.go`（§5.0），新增 `tunnel/shareconnector.go`（§5.0），`web-src/src/{api/types.ts,store/*,pages/tunnel-detail-page.ts,pages/entrypoint-detail-page.ts,components/peer-stats-row.ts,i18n/{en,zh}.ts}`；**不改** x、p2p 两个仓（`tun-share` 经 x 既有 connector registry 注册，无需改 x）。
- **顺序**：spec 批准 → writing-plans → 在 `sdd/wisper-lan-observability` 分支四个 commit 序贯实现（§5.0 先行），跑完合入 main（用户确认）。

## 8. 风险与已知限制

- **journal 易失**：重启清空；UI 标注"本次运行"，回溯靠事件历史（持久）。用内存换"不把运行时churn写进配置"。
- **事件体积有界但非零**：只记状态迁移，长期运行的 hub 事件量取决于 LAN 变动频率（每 spoke 每 20s 重述不触发）。
- **doctor 文本增长**：LAN 段封顶（routes 全量、claims 全量、refused 5 条）；多 hub 各一段。
- **alias 解析在 UI 侧**：claims/rejected 以 peer key 为键，UI 用 `options.peers`/`peer_stats` 的 alias 渲染，退化显示掩码 key。
- **userspace shim 的接线风险（§5.0）**：`tun-share` 每次 Connect 建新 shim/栈、关闭随 conn；重拨时旧 conn 由引擎关闭——实现计划需用测试钉住"重拨不漏栈、不双泵"（组件级 Task 5 已测，接线级是新增面）。
- **不在本设计兑现**：CI e2e（本地探针做功能验收，§5.0；CI 化另行排期）；Android 原生壳无变化；prometheus 导出；doctor 的 p2p 段本身不动。

## 9. 自查（spec self-review）

- 无 TBD/TODO；排除项（§8 末）显式。
- 与既有事实对齐：§5.1 的 kind 编号、§5.2 的六条原因串、§5.4 的既有字段名均逐条核对过代码；§3 的"三处既有信号"分别指向 peer 行徽标、`tun.go:551-554` 事件、doctor punch，无一新增。
- 歧义已收敛：journal 内存态且标注易失；refusal 码集封闭为六；doctor 段封顶；事件只在 diff 非空时记。
- 规模可单 plan 交付：三个 commit 可分别独立测试，无循环依赖。
- 审查后增补：spoke 接线缺口（§2 断点零；证据=三个导出符号零非测试调用方 + entrypoint 无配置字段）经用户确认纳入 §5.0；S0、提交四分、触点与测试同步增补。
- review 轮修正（fresh-eyes 对照代码）：per-peer LAN 定在 `peerStatsJSON` 轮询路径；`KindLanDenied` 记账单源；`ch.installed` 改 prefix→peer；`approvalRefusal` 返回码；spoke 侧文件名与门禁归属修正。
