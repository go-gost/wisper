# p2p 对端 RTT 被动测量与实时显示设计

日期：2026-10-11 | 状态：draft 待 review | 路径：architectural（brainstorming 收敛：只做 p2p 对端 SRTT + DERP RTT；只用被动测量；peer 行 / entrypoint 详情页内联数字 + 展开面板明细；doctor 加 relay RTT 行）

## 1. 理解与目标（用户所说 vs 假设）

- 用户所说（brainstorming 收敛，逐条为凭）：
  - 层面：只做 **p2p 对端 RTT（SRTT/传输层）**；tun 端到端 RTT 不做；经隧道的公网 ping 不做。
  - 机制：**只用被动测量**（每 peer 的 KCP SRTT/RTO + host↔relay 的 DERP ping RTT）；不做主动探测按钮。
  - 显示：**peer 行 / entrypoint 详情页徽章旁一个数字 + 展开面板明细**；不做 sparkline。
  - doctor 报告**加** relay RTT 一行。
- 假设（待纠正）：
  - "实时" = 跟随既有 stats 轮询（默认 3s，`stats_interval` 可调）；不新增 WebSocket。
  - peer 行组件 `peer-stats-row` 被 p2p tunnel 的 peers 页与 tun hub 详情页共用，一处实现两处生效。
- 成功标准：
  - S1：p2p tunnel / tun hub 的 peer 行上，有活 KCP 会话的 peer 显示毫秒数（悬停说明含义），无会话的 peer 整块缺省而非显示 0。
  - S2：peer 行展开面板有 SRTT/RTO/RTTVar 三行。
  - S3：设置页 p2p 区块显示 relay RTT；未连接/未测到时缺省。
  - S3b：**p2p entrypoint 详情页**（单 peer = hub）同样显示对端 RTT：徽章旁一个数字 + ⓘ 展开明细；非 p2p entrypoint 不显示。
  - S4：`/api/p2p/doctor` 文本有 relay RTT 行。
  - S5：全程零新增探测流量——KCP SRTT 是数据流的副产品，DERP RTT 是既有 30s keepalive ping 的副产品。

## 2. 现状

**数据本来就在，缺的是出口**：

- `p2p.PeerDiagnostic.RelayKCP`（`p2p/status.go:113-140`）：SRTT/RTO/RTTVar（ms）/Live/Path，由 `engine.relayKCPStats`（`internal/host/engine.go:1529`）从 pair 的 KCP 会话读出。仅进程内。
- `derpclient` 已 ping/pong：`Ping()`（`internal/derpclient/derpclient.go:369`）发送，`Recv()` 的 framePong 分支盖 `pongAt`（:414-423），`LastPong()`/`Pongs()` 已导出——**未换算成 RTT**。
- `p2p.Status` 有 `RelayConnected`/`RelayError`，无 RTT。
- doctor 每 peer 已打印 `relay kcp srtt=...`（`doctor/doctor.go:157-162`），无连接级 RTT。

**wisper 侧断点**：

- `api/tunnel_handler.go` 的 `peerStatsJSON`（构造处 :411-432）与 `api/p2p_handler.go` 的 `peerDiagnosticJSON`（:43-54）都不映射 RelayKCP；`tunnelResponse` 有单 peer 的 `PeerTransport`（:36）但没有对端 RTT 字段。
- `web-src/src/components/peer-stats-row.ts` 无 RTT 渲染；`web-src/src/pages/entrypoint-detail-page.ts` 只有 `peer_transport` 徽章（:917/:935）；`web-src/src/api/types.ts` 无字段。
- 设置页 p2p 区块（`web-src/src/pages/settings-page.ts`）只在打开/动作时拉一次 identity，无轮询。

**关键事实（已核对）**：

- KCP 是 pair 级一会话（relay/direct 双读同一会话，见 p2p-kcp-session-migration），SRTT 是**会话级**、非单路径；当前 preferred path 由 `PeerTransports`/`RelayKCP.Path` 给出，显示时用悬停文案说明。
- DERP ping 每 30s（`keepAlivePeriod`，`engine.go:745`；可由 DerpKeepAlive 配置）→ relay RTT 最长 30s 龄期，可接受。
- gRPC proto 冻结：新增字段按惯例仅进程内（与 `PeerTransports`/`RelayConnected` 一致）；wisper 进程内嵌入 p2p host，正好消费。

## 3. 决策记录

1. **只被动**：零新增流量、零新按钮、不动线协议、无需双侧升级（SRTT 来自本机 p2p host 的本地会话，不要求对端升级）。
2. **语义标注**：peer 行 / entrypoint 徽章旁的数字悬停说明"KCP 会话 SRTT · 当前路径 direct/derp"，避免会话级 SRTT 被误读为单路径 RTT。
3. **显示门槛**：仅 `kcp_live && srtt>0` 显示；否则整块缺省（不是 0——`RelayKCPStats.Live` 的既有注释即此约定）。
4. **relay RTT 只进设置页 + doctor**：它是 host↔relay 的连接级数字，不是对端 RTT，不进 peer 行。
5. **设置页轮询随页面生命周期起停**，频率取 `stats_interval`（复用 settings store）。
6. **交付分三个提交序**：p2p 仓（derpclient RTT + Status + doctor + 测试）→ wisper（API 映射 → UI）→ wisper go.mod bump p2p 新版本（照旧例，tag 后单独提交）。
7. **不动的东西**：tun entrypoint 的设备探针（L1/L2/L3 冻结设计不变）、doctor 既有 per-peer `relay kcp` 行、API 既有字段形状只增不改、p2p 的 gRPC proto。

## 4. 详细设计

### 4.1 p2p · derpclient RTT（`internal/derpclient/derpclient.go`）

- 新字段 `pingedAt atomic.Int64`（unix nanos）与 `rtt atomic.Int64`（ms），与既有 `recvAt`/`pongAt` 同用包级 `clock`。
- `Ping()` 写入前 `c.pingedAt.Store(clock.UnixNano())`。
- `Recv()` framePong 分支：过 dropPong 检查后（fault 注入的 pong 已 `continue`），若 `pingedAt > 0` 则 `c.rtt.Store(time.Since(time.Unix(0, at)).Milliseconds())`——与 `pongAt` 存放位置一致。
- 新方法 `LastRTT() int64`（ms；0 = 未测到）。
- 注释写明：30s 一次采样，host↔relay 经 ws 帧往返的网络 RTT。

### 4.2 p2p · Status、engine 与 doctor

- `p2p/status.go`：`Status` 加 `RelayRTT int64`（ms，0 = 无连接或未答复），注释标明 in-process only（proto 冻结，与 `RelayConnected` 同规矩）。
- `internal/host/engine.go`：`relayState()`（:231）旁加 `relayRTT() int64`：持 `e.mu`，`e.client != nil` 时返回 `c.LastRTT()`，否则 0。
- `internal/host/server.go` `status()`（:324）：`st.RelayRTT = s.engine.relayRTT()`（与 `st.RelayConnected, st.RelayError = s.engine.relayState()` 相邻）。
- `doctor/doctor.go`：`relay state` 行（:57-61）后加 `relay rtt` 行——connected 且 >0 显示毫秒；未测到显示"not measured"。

### 4.3 wisper · API（`api/`）

- `api/tunnel_handler.go`：`peerStatsJSON` 加四个字段 `SrttMs int64 \`json:"srtt_ms"\``、`RtoMs`、`RttVarMs`、`KcpLive bool \`json:"kcp_live"\``；peer 行构造处从 `d.RelayKCP` 填。RTT 映射提取为可单测的小 helper（api 包现有测试无 p2p host seam，纯函数才好测）。
- `api/p2p_handler.go`：`peerDiagnosticJSON` 同加四字段（identity 的 `peer_diagnostics` 同步出口）；`p2pIdentityResponse` 加 `RelayRTTMS int64 \`json:"relay_rtt_ms"\`` + `RelayConnected bool \`json:"relay_connected"\``（数字离开 connected 不可解释，两字段一起出）。
- `api/tunnel_handler.go`（entrypoint 单 peer）：`tunnelResponse` 在 `PeerTransport`（:36）旁加对称四字段 `PeerRTTMs`/`PeerRtoMs`/`PeerRttVarMs`/`PeerKcpLive`，来源 `diagnostics[opts.Peer].RelayKCP`（与 :436-438 的 `PeerTransport` 同一快照、同一 hook 判断 `opts.Peer != ""`）。tunnel 的多 peer 面仍走 `peer_stats`，这两个字段只对单 peer 的 entrypoint 有意义。
- API 既有形状只增不改；老客户端/老 UI 自动忽略新字段。

### 4.4 wisper · Web（`web-src/`）

- `api/types.ts`：`PeerStats` 加 `srtt_ms?: number; rto_ms?: number; rttvar_ms?: number; kcp_live?: boolean;`；identity 响应类型加 `relay_rtt_ms?: number; relay_connected?: boolean;`。
- `components/peer-stats-row.ts`：路径徽章后加 `<span class="peer-rtt">${n}ms</span>`，条件 `s.kcp_live && s.srtt_ms > 0`；title 含当前 transport 词与"KCP SRTT"语义；展开面板 `_renderDiag` 加 SRTT/RTO/RTTVar 三行（i18n label）。
- `pages/settings-page.ts`：p2p 传输计数渲染处旁加 relay RTT（connected 时显示毫秒值，否则 `—`）；`connectedCallback` 起轮询、`disconnectedCallback` 停，间隔 `getSettings().stats_interval || 3` 秒（store 导入照现有用法）。
- `pages/entrypoint-detail-page.ts`：`_renderTransport` 徽章旁内联 RTT（条件 `peer_kcp_live && peer_rtt_ms > 0`，悬停语义同 peer 行）；ⓘ 展开面板在 connected 文案下加 SRTT/RTO/RTTVar 三行。数据经 `entrypoint-store.ts` 的 `applyStats`（:110 一带）把新字段从响应拷进来（注意 store 只拷已知字段的现状，需补映射）。
- `i18n/en.ts` + `i18n/zh.ts`：加 key（行内 title、展开三行 label、设置页 relay RTT label）。

### 4.5 数据契约（JSON 增量）

peer_stats 行（既有对象新增四字段，无会话时缺省）：

```json
{ "key": "base64…", "transport": "direct", "srtt_ms": 23, "rto_ms": 200, "rttvar_ms": 5, "kcp_live": true }
```

`/api/p2p` identity 新增：

```json
{ "relay_rtt_ms": 87, "relay_connected": true }
```

tunnel/entrypoint 响应新增（单 peer 的 entrypoint；多 peer 的 tunnel 为空，per-peer 走 peer_stats）：

```json
{ "peer_transport": "direct", "peer_rtt_ms": 23, "peer_rto_ms": 200, "peer_rttvar_ms": 5, "peer_kcp_live": true }
```

## 5. 测试与交付

- **p2p**：
  - `internal/derpclient/derpclient_test.go`：扩 `TestPingIsAnsweredAndStamped`（现成 fake conn 套路）断言 `LastRTT()`——ping/pong 往返后为合理 ms 值，未答复为 0。
  - 门禁：`GOWORK=off go test ./internal/derpclient/ ./internal/host/ ./doctor/ -count=1`。
- **wisper**：
  - `api/`：helper/映射单测——构造带 `RelayKCP` 的 `p2p.PeerDiagnostic`，断言响应字段（peer_stats 行 + 单 peer 的 `peer_rtt_ms` 一族 + identity 的 `relay_rtt_ms`/`relay_connected`）。
  - 门禁：`GOWORK=off go test ./api/ ./tunnel/ ./runner/task/ -count=1`；web：`npx tsc --noEmit && npx vite build`。
- **触点清单**：p2p（`internal/derpclient/derpclient.go`、`status.go`、`internal/host/engine.go`、`internal/host/server.go`、`doctor/doctor.go` + 测试）；wisper（`api/tunnel_handler.go`、`api/p2p_handler.go`、`web-src/src/api/types.ts`、`web-src/src/components/peer-stats-row.ts`、`web-src/src/pages/settings-page.ts`、`web-src/src/pages/entrypoint-detail-page.ts`、`web-src/src/store/entrypoint-store.ts`、`web-src/src/i18n/en.ts`、`web-src/src/i18n/zh.ts`、`go.mod`）。**不改** core/x/gost、不动 tun entrypoint 探针。
- **顺序**：[p2p 分支/提交] → [wisper API 提交] → [wisper UI 提交] → [p2p tag 后 wisper go.mod bump 提交]；不 push 除非明确要求。

## 6. 风险与已知限制

- **relay RTT 龄期最长 30s**：连接级探针固有频率；peer 级有 KCP SRTT 补足，不为此新增 ping。
- **SRTT 是会话级**：relay/direct 双读同一 KCP 会话，SRTT 混合两路径；以悬停文案 + Path 字段缓解，不拆 per-underlay RTT（超出被动范围）。
- **ms 取整**：亚毫秒抖动不可见；陆地连接通常 ≥ 数 ms，可接受。
- **settings 页轮询成本**：每 stats_interval 一次轻量 JSON，页面不可见即停。
- **proto 冻结的后果**：`RelayRTT` 仅进程内可见，CLI/plugin 客户端看不到——与既有惯例一致，doctor 文本不受影响。
- **不在本设计兑现**：tun 端到端 RTT、主动探测、sparkline、per-underlay RTT 拆分、WebSocket 推送。

## 7. 自查（spec self-review）

- 无 TBD/TODO；排除项（§6 末）显式。
- 与代码逐条核对：`RelayKCP`（`status.go:113`）、`relayKCPStats`（`engine.go:1529`）、framePong 分支（`derpclient.go:414-423`）、`relayState`（`engine.go:231`）、`peerStatsJSON` 构造（`tunnel_handler.go:411-432`）、doctor relay kcp 行（`doctor.go:157-162`）、settings identity 拉取（`settings-page.ts:208`）。
- 歧义已收敛：显示门槛二条件（`kcp_live && srtt>0`）；relay RTT 只进设置页 + doctor；settings 轮询随页面生命周期。
- 规模可单 plan 交付：p2p 改动小且自洽，wisper 两提交无循环依赖。
