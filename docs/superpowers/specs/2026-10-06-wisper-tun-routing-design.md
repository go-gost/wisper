# wisper tun 路由：peer 互通设计

日期：2026-10-06 | 状态：draft 待 review | 路径：architectural（brainstorming 四节已确认）

## 1. 理解与目标（用户所说 vs 假设）

- 用户所说：为 wisper 的 tun tunnel 设计路由功能，让各 peer 直接可以互通；分阶段都要；基线是仅 hub 通、peer 不通；先单 hub 可扩展；常规组网即可（IPv4 为主、网段独立、peer 默认互信、接受 Android 单 VPN 单 entrypoint）。
- 假设（待纠正）：hub 即 `wisper/tunnel/tun.go` 的 tunTunnel（持 device，经 p2p 收发 spoke 包）；peer 即 `tunnel/entrypoint/tun.go` 的 tunEntryPoint（拨 hub 公钥，`p2p.network=ip` session-scoped）；“直接互通”分两阶段——阶段一经 hub 中转可达（A ping B 通），阶段二 spoke 间按需直连、失败回落 hub。
- 成功标准：阶段一：双 spoke 经 hub 互 ping 通、hub 本机仍通、未注册目的仍 `no route` 丢弃；阶段二（设计先行）：hub 下发成员、spoke 按需直连、不通自动走 hub，doctor/peers 页可见走了哪条路。

## 2. 现状与根因

当前 spokeA→spokeB 路径（`x/handler/tun/p2p.go` + `router.go` + `CONTEXT.md`）：

```
spokeA device → client transportClient → p2p stream → hub fromSpoke
  → device.Write → [内核路由 hairpin] → device.Read(run) → dispatch
  → peerTable.lookup → router.deliver → spokeB stream → spokeB device
```

断点：`fromSpoke`（`x/handler/tun/p2p.go:280`）把非 keepalive 包一律写 device，指望内核把包路由回同一块 tun 设备。要求 hub 宿主机开 `ip_forward` + 同接口 hairpin，在 Docker/host-network 下 fragile；且 spoke `routes`（`entrypoint/tun.go:131`）若未覆盖对端网段，包根本不进隧道。`peerTable`（`router.go`）本身按目的 IP 查 peer key 是对的，缺的是不依赖内核的直达路径。

## 3. 阶段一：hub 用户态直转（先落地）

改动（x 侧为主）：`p2pHub.fromSpoke` 先 `destinationOf(pkt)` + `table.lookup(dst)`：

- 命中 peer 路由 → 直接 `router.deliver(dst, pkt)`，不经 device/内核；
- 未命中（hub 本机地址、未注册、未知包）→ 保持 `device.Write`，`no route` 计数/告警不变（`countUnrouted` 5s 窗口）；
- 目的 == hub 本机或源 == 目的（自环）→ 按 `no route` 丢弃并计数，不回送。

语义不变：`peerGone/withdraw/dropPeer`、`deviceNets` 自环 guard、`keepalive/answerKeepalive` 回显、`unroutedWindow` 口径都不动；per-peer 计数点仍在 `peerStream.write`，直转包照常计数。

spoke 配合（wisper 侧）：`entrypoint/tun.go` 的 `routes` 为空时缺省填 hub 网段 CIDR（hub `net` 的子网）；`api/entrypoint_handler.go:validateTunRoutes` 规则不变；UI hint（`web-src/.../entrypoint-detail-page.ts` + `i18n/zh|en.ts:fieldRoutesHint`）补一句“留空即走 hub 网段（含其他 peer）”。hub 侧 `tunnel/tun.go:listenerMetadata` 维持现状（不加 routes/DNS，见该文件注释的 host-network 危险性）。

## 4. 阶段二：按需直连 + 回落 hub（本次只定设计）

- 成员发现：hub 复用 `peerTable` + allowlist 生成只读快照 `(IP, peerKey, rev)`，`rev` 单调递增；经 wisper 控制面（p2p 直连推送，定时 + 变更触发）下发各 spoke；spoke 缓存 `peerMap`，旧 `rev` 丢弃。信令全在 `wisper/tunnel`，x 零改动（keepalive 回显通道太窄，不用它）。
- spoke 数据面：`entrypoint/tun.go` 从单 peer 单链扩展为 1 条 hub 中转链（常连）+ N 条直连链（按需 `PunchContext` + `session-scoped ip` dial，复用已验证的注册语义）。选路：目的在 `peerMap` 且直连已建立 → 直连；否则 hub 中转；直连失败/断开 → 自动回落 hub（best-effort，与 tun/UDP 语义一致）。
- 授权（已确认按推荐）：hub allowlist 即全网成员，任一成员可直连任一成员；直连两端都校验对端在本地成员快照中，不另设 per-pair 授权。Android 约束不变：单 VPN 单 entrypoint，直连只多 p2p 流，不占额外设备。

## 5. 错误处理与可观测

- `ErrNoRoute` 进现有 `countUnrouted` 窗口；写流失败（对端断开中）走 `warnf route %s` 单行。
- spoke 新增 `directPeers / relayFallback` 计数，进 `P2PHostStatus`/doctor 与 peers 页（走直连还是中转可见）；hub per-peer stats 口径不变。

## 6. 测试与交付

- 阶段一：x 单测 `fromSpoke` 直转命中/未命中/自环（参照 `x/handler/tun/p2p_test.go`，不起真实设备）；wisper e2e 双 spoke+hub：A ping B 通、hub 本机通、未注册目的仍丢弃；回归单 spoke 行为不变。门禁：`GOWORK=off go build ./...`，`CGO_ENABLED=1 go test -race -p 1` 按包跑（wildcard 会 hang）。
- 触点：阶段一 `x/handler/tun/p2p.go`（+单测）、`wisper/tunnel/entrypoint/tun.go`、API/UI hint；阶段二 `wisper/tunnel/tun.go`（快照推送）、`entrypoint/`（多链路选路）、doctor/peers 展示。
- 顺序：阶段一 spec→plan→实现；阶段二本次只合设计，实现另起 plan。

## 7. 自查（spec self-review）

- 无 TBD/TODO；阶段二实现范围明确排除在本次 plan 外，不会膨胀阶段一。
- 一致性：阶段一不动 `peerTable`/`peerRouter` 存储语义，只改 `fromSpoke` 递交路径；阶段二信令在 wisper 侧，与 x 改动无交叉。
- 歧义已收敛：授权=hub allowlist 全网互信；spoke 缺省路由=hub 网段；Android 单 entrypoint 不变。
