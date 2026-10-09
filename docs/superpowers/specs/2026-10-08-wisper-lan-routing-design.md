# wisper LAN 路由：peer 身后网段可达设计

日期：2026-10-08 | 状态：draft 待 review | 路径：architectural（brainstorming 六问已确认）

## 1. 理解与目标（用户所说 vs 假设）

- 用户所说：让 spoke A 能访问 spoke B 身后的局域网网段（如 `192.168.50.0/24`），经 hub 中转；从扩展性、灵活性考虑要支持将来的多 hub 互联。
- 假设（待纠正）：sharer = 一台 Linux 主机跑 wisper spoke，`share_lan` 声明自己身后的网段；B 的 LAN 与 tun 网段不重叠；成员默认互信，但网段声称需 hub 审批（两层，见 §5）。
- 成功标准：A ping/curl B 的 LAN 内主机通；未声明的目的仍 `no route`；冲突网段有事件可查；hub 重启后各 spoke 重连即收敛；Android 上行为完全不变（首版 sharer 不含 Android）。

## 2. 现状与根因

- LAN 目的今天必丢。`x/handler/tun/p2p.go` 的 `dispatch` 只做 `destinationOf` + 精确查表（`router.go` 的 `peerTable`），命中才 `deliver`，否则 `ErrNoRoute` 丢弃。注册帧只带设备 IP（16 字节裸地址无掩码，`client.go:40`），表达不出子网。
- 网关回落只活在 socket 路径：`x/handler/tun/server.go:263 findRouteFor` 支持 `routes "cidr gw"`，但 p2p handler 开头就掐掉回落；wisper 走 p2p，一天都没用过这条能力。
- `x/router/router.go:252 GetRoute` 是**首匹配**而非最长前缀（LPM），同段重叠时结果取决于配置顺序；`core/router/router.go:40` 的 `Router` 接口只读（仅 `GetRoute`），自带 `localRouter` 只支持 loader/周期刷新，没有"外部即时 push"的口子。
- hub 侧已有 userspace LAN 分享能力（gVisor 终结 + `net.Dialer` 拨 LAN，`sharegvisor.go:170/205`），但那是"hub 主机自己共享自己的 LAN"，与"任一转 spoke 声称一个 LAN"是两件事。

## 3. 决策记录（brainstorming 已确认）

1. **peer 自声明 + hub 审批绑定**（非 hub 静态写死）。claim 单元 = `(prefix, origin peer, allow)`；多 hub 下可传播。
2. **冲突裁决 = 静态注入 > 动态声称；同类内 LPM；同级先到先得 + 冲突事件告警**。hub 永远有最终话事权。
3. **首版即做 hub 下发合并路由**（不是手工加 spoke routes）。复用阶段二 plan Tasks 1–3 的快照/控制通道，字段扩展带子网；阶段二 plan 其余部分（直连数据面）仍 deferred。
4. **缺省全开，可选 per-LAN 源 allowlist**：路由存在即全网成员可用，`allow=peerA,peerB` 可收紧；准入审批（§5）与访问授权是两层。
5. **claim 走控制通道，x 零改动（除 §7 一处必须的）**。不塞 keepalive 注册帧：帧格式只解决单跳，控制消息天然多跳。
6. **spoke 转发层用 `tun.router` 命名共享对象**（`x/listener/tun/metadata.go:37` 按名取共享实例，listener 持引用），wisper 侧实现一个 30 行的 `router.Router`（底层就是 RIB 快照，`GetRoute` 做 LPM），按名注册。
7. **hub 间同数据类型、异协议**：共享 `Prefix+Origin+Allow`，但 hub↔hub 用独立消息（version + entries + `path:[hubIDs]`，拒绝含自身 ID 的路径防环）。阶段三单 hub 时 `path` 恒空预留。
8. **首版 sharer = Linux only**，Android 留后续（理由见 §8）。
9. **NAT 到 sharer 自身**（不保留原始源）；**仅 TCP/UDP，ICMP 不支持**；LAN 主机主动向 A 建连不支持。

## 4. RIB 与控制消息

hub 侧一张 RIB，key = `netip.Prefix`，value = claim：

```go
type lanClaim struct {
    Prefix netip.Prefix // IPv4 only
    Origin string       // 声明者的 peer key；静态注入填 "static"
    Static bool
    Allow  []string     // 空 = 全开
    Rev    uint64
}
```

RIB 带单调 `version`，任一条目增删改 +1，`hubID`（tun tunnel 的 `opts.ID`，即 boot id）随每次下发一起发，让 spoke 区分"同 hub 的旧推送"和"hub 重启"。

控制消息：控制流上`控制魔数 + 4 字节大端长度 + JSON`，两种负载：

```json
{"type":"rib",  "hub":"hub1","version":12,"claims":[{"prefix":"192.168.50.0/24","origin":"peerB","allow":[]}]}
{"type":"claim","add":["192.168.50.0/24"],"drop":[]}
```

- hub→spoke：**全量快照**，spoke 校验 `version` 大于本地（或 `hubID` 变化）才接受，无条件覆盖本地视图。
- spoke→hub：**增量**。spoke 重连后全量重发自己的 `share_lan`；hub 以"最新收到"为准，与 §10 的 TTL 撤路由配合。
- 快照上限 64 KiB，超限直接拒绝读体（防恶意 spoke 打爆 bufio）。

## 5. 冲突与审批

- **准入（路由能否存在）**：hub 配置 `lan_allow: {peerB: ["192.168.0.0/16"]}`，**缺省拒绝一切动态声称**。rogue peer 冒领 `0.0.0.0/0` 在这一层被挡，且与 §3.4 的"缺省全开"（已存在路由的访问策略）不矛盾。
- **裁决（多个声称听谁）**：静态注入永远赢；同类内 LPM；同级先到先得，后来者不生效 + hub 记一条冲突事件（含双方 origin、prefix），管理员加静态路由或让先到者撤。
- **静态注入**：hub 配置 `lan_routes: ["192.168.50.0/24 via <B的虚拟IP>", "10.20.0.0/16 via 10.10.100.9 allow=peerA"]`，启动时直接写 RIB（`Static=true`），不进控制消息格式。

## 6. spoke 侧装路由：抓包层 vs 转发层

两层必须分开，混在一起就是咖啡馆陷阱。

- **抓包层（静态，OS 绑定）**：spoke 用超网抓包（如 `192.168.0.0/16` + hub 网段）。Linux 走 netlink，Android 走 `VpnService.Builder.addRoute`。它只回答"什么包进设备"，变更需重建，只在配置变时动。
- **转发层（动态，命名 router）**：hub 下发的 RIB 快照灌进 §3.6 的命名 router，LPM 查询，随 `version` 即时换表，设备无感。命中某 claim → 走 hub 链；未命中 → 丢（`no route` 计数）。
- **咖啡馆冲突裁决**：抓包层把本地同段设备也吸进来时，转发层只认 hub 批准过的**精确 claim**；本地同段但无人声称 → **不进隧道**，直发本地。隧道不劫持未声明的流量，这是抓包层与转发层分离的直接收益。

## 7. x 侧唯一改动点：hub 的按前缀投递

hub 要把发往 `192.168.50.0/24` 的包交给 B 的 stream，就必须在 x 里查前缀——`dispatch` 今天的精确查表做不到。这是本设计**唯一**的 x 改动，且是加法：

- `x/handler/tun/router.go` 的 `peerTable` 增一张 `prefixes map[netip.Prefix]peerKey` 与 `GetRoute` 的 LPM 语义（顺带修正 `x/router/router.go:252` 首匹配的缺陷，hub 自身 `share_lan` 的 `cidr gw` 一起受益）。
- `dispatch`（`p2p.go`）在精确未命中后查前缀表，命中则 `deliver`；仍未命中才 `ErrNoRoute`。精确匹配永远优先于前缀，主机语义不被 LAN 路由改变。
- wisper 侧 `tunnel/tun.go` 已持有 handler（`h.Init` 后仍在作用域），RIB 每次变更后调用新增的 `h.SetPrefixRoutes(map[netip.Prefix]string)`（hub 专用方法）。信令、审批、RIB 全在 wisper；x 只多一个查表维度和一个 setter。

## 8. sharer 侧：v1 = Linux only

B 收到目的为自家 LAN 的包后，包已在 B 的 tun 设备上，dst 属 B 的直连网段——内核自然从 eth0 发出，**不需要额外路由**；缺的只有 SNAT：LAN 主机的回程目标是 A 的虚拟 IP，它的默认网关不知道这个地址。所以 v1 的 sharer 就是复用现成代码、角色互换：

- `setupShareLAN(hubNet=hub网段, lanSpec=声称网段, mode)`（`tunnel/natlan.go:90`）+ `BuildShareNATRules`（`:141`）在 B 的 spoke 上执行：`MASQUERADE -s hubNet -d lan` + 双向 `FORWARD`。与 hub 自共享时的规则完全同构，只是 hubNet 换成 hub 网段。
- userspace 兜底（无 iptables 权限时）复用 `sharegvisor.go`，但**接入点不同**：hub 侧包在 `net.Conn` 的 Write 上分流（`tun.go:566`），B 侧包从 chain 来、栈的回复要回灌 chain（目的地址是对端 spoke 的虚拟 IP）。需要一个同量级、不同形状的 shim，不是复用 `sharedevice.go`。
- **ICMP 不支持**：`shareClassify` 在分类处丢 ping，`shareDevice.Dropped()` 计数给 UI badge。诊断只能 TCP/UDP。LAN 主机主动建连不支持（无端口映射）。
- **Android 排除及理由**（用户已确认）：数据面现成（`net.Dialer` 源地址即手机 WiFi IP，等价 SNAT；非 Linux 的 `probeShareKernel()` 恒 false，auto 自动落 userspace），专有工作量在三点——① spoke 要把共享 CIDR 收进 VPN 才会收到 LAN 包，同一条目端路由同时抓走栈自己拨 LAN 的 socket，死循环，唯一解是 `VpnService.protect(fd)`（`net.Dialer.Control` + JNI 注入）；② spoke 侧 shim 形状不同（见上）；③ `share_lan` 今天是 hub 创建参数（`api/tunnel_handler.go:133`），spoke claim 要重开配置面。三项都不涉及协议，等控制通道建好后单独一个 plan 即可。

## 9. 多 hub 预留

- 今天单 hub：hub 是唯一汇聚点，RIB 只由本地静态注入 + 本 hub 批准的声称组成。
- 多 hub：`xrib` 消息（`hubID` + `version` + `entries` + `path:[hubIDs]`）在 hub 间交换，拒绝 `path` 含自身的更新（防环），导入策略仍是每 hub 各自的 `lan_allow` 等价物。数据类型与 §4 完全一致，不改 spoke 可见格式。
- spoke 换 hub 附着：claim 由新 hub 的视角重新计算，随新 hub 的快照下发；旧 hub 只看一次 `claim` 撤回到 TTL 超时。零人工。

## 10. 撤路由与故障语义

- **spoke 掉线**：keepalive TTL 超时 → hub 撤其全部动态 claim，`version`+1 下发；重连后全量重发 `share_lan`，重新过审批。
- **审批撤销**：管理员从 `lan_allow` 删掉某段 → 同撤效果。已建连接不断（只拦新查询），下一个 `version` 下发后生效。
- **hub 重启**：RIB 从静态注入重建，动态声称等各 spoke 重连重发后逐个回归；`hubID` 变化让 spoke 直接接受 `version=1` 的新快照（阶段二快照同规则）。
- **冲突中输掉的一方**：查询 miss，效果等同"未声称"；hub 侧冲突事件 + UI 展示双方，管理员加静态路由裁决。
- **源 allowlist miss**：包到 hub 命中 claim 但源 peer 不在 `allow` → 丢 + 新计数器 `LanDenied`（缺省全开时此分支永不触发）。
- **抓包层黑洞**：VPN 重建（Android WiFi↔蜂窝切换）重放 `addRoute` 前到达的 LAN 包被丢，与撤路由语义叠加，重连期有一段黑洞。记录为已知限制，不做补偿（TCP 重传，UDP 按不可靠）。

## 11. 错误处理与可观测

- `no route` 仍进现有 `countUnrouted` 窗口；命中 LAN 前缀后投递失败走既有 `warnf route %s`。
- 新计数：`LanDenied`（§10）、`LanRouted`（经前缀表投递的包数）进 `P2PHostStatus`/doctor；RIB 视图（version、条目数、冲突数）供 UI。
- hub 日志：声称到达/批准/拒绝/冲突各一行，带 origin 与 prefix；撤路由带原因（TTL/审批撤销）。

## 12. 测试与交付

- 单测（wisper）：RIB 增删改与 version 语义；审批放行/拒绝；冲突裁决（静态赢、LPM、同级先到先得 + 事件）；快照接受/丢弃规则（旧 version、`hubID` 变化）；命名 router 的 LPM 与"无人声称即 no route"。
- 单测（x，§7）：前缀表 LPM（同段重叠取最长）；精确优先于前缀；`SetPrefixRoutes` 动态换表后行为；既有 p2p 用例全绿（除已知先存 race `TestRunDeviceProbeReportsSent`）。
- e2e：Linux hub + 两个 spoke，B 声明 `192.168.50.0/24`，A 访问 B 的 LAN 主机通；未声明目的仍丢；B 掉线后 A 不再可达；Android spoke 行为零变化（无新设备、无新路由）。
- 门禁：`GOWORK=off go build ./...`；`CGO_ENABLED=1 go test -race -p 1` 按包跑（wildcard 会 hang）；x 按包测，不跑裸 `./...`。
- 触点：新增 `tunnel/rib*.go`、`tunnel/tun_control.go`（阶段二 plan Tasks 1–3 的通道，本设计复用）、命名 router 注册；改 `x/handler/tun/router.go`、`p2p.go`；`api/tunnel_handler.go` claim 配置面；doctor/UI 展示。
- 顺序：spec → plan → 实现；Android sharer、LAN→A 主动建连、多 hub 交换，明确排除在本 plan 外。

## 13. 自查（spec self-review）

- 无 TBD/TODO；被排除项在 §12 末尾显式列出，不会悄悄膨胀。
- 与既有事实对齐：§4 帧格式沿用阶段二 plan 的 4 字节长度前缀；§8 引用 `natlan.go`/`sharegvisor.go` 现成能力而非重述；§7 修正 `x/router/router.go:252` 首匹配的方法与 hub 自身 `cidr gw` 同源，不是新机制。
- 歧义已收敛：声称=自声明+审批；冲突=静态>动态+ LPM + 同级先到先得；路由分发=hub 推送；访问=缺省全开可选 allow；抓包/转发分层；sharer v1=Linux。
- 已知限制已显式记录：ICMP 不可用、LAN 主动建连不可用、VPN 重建期黑洞、首版无多 hub 交换。
EOF
echo ok
