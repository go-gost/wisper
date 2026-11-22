# Android tungo 分流入口点 — 设计

日期：2026-11-22
状态：待评审
范围：wisper（主）、x（Android fd 分支）、部署配置（pi / hub）

## 1. 意图

手机通过 wisper 接入家庭网络。家里的 pi（192.168.100.100）是 LAN 默认网关，上面
跑 gost：`iptables` tproxy 把所有 TCP 送 `127.0.0.1:12345`，`red` handler 开 sniffing，
`chain: relay-wss` 的 hop-0 挂着 `bypasses: [bypass-gfw, bypass-local]`，其中
`bypass-gfw` 是 **whitelist 模式**、redis `gost:bypass:gfw` 里 6394 条域名 ——
即「只有白名单里的域名走 relay，其余从家宽直连」。

要的是：手机只把 **① 内网 `192.168.100.0/24`** 和 **② 需要代理的域名** 送进隧道，
其余流量直接走手机自己的网络。分流判定用**域名**，不是 IP。

今天做不到，原因只有一个：wisper 的 tun 是纯 L3 管道（`x/listener/tun` 读原始 IP 包，
`x/handler/tun` 塞进 p2p `ip` 数据报通道），路径上没有任何嗅探；而 VpnService 的路由
只能在 `establish()` 时定死，域名的 IP 又不可预知 —— 所以「按域名选择性进隧道」必须
在手机侧终止流。

## 2. 目标 / 非目标 / 反目标

### 目标

1. 新增 entrypoint 类型 `tungo`（spoke）：本地仍是 tun 设备（Android 用 VpnService 的
   fd），栈终止 TCP/UDP，按域名/目的前缀决定「走后端 / 直连」。
2. 后端一跳是 **p2p tcp 流 + relay 协议**，落到 pi 上的 relay 监听，复用 pi 现有的
   `relay-wss` 链与同一套 hop bypasses —— 最终分流仍由 pi 决定。
3. 内网服务（按子域名访问，如 `home.pi` / `.dadax`）经同一条后端路径可用；**DNS 走
   隧道到 pi**，由 pi 的 hosts-dns + 分流解析作答。
4. 现有 `tun` entrypoint 逐字节不变。

### 非目标（v1）

- ICMP / ping / mDNS / 广播（栈只做 TCP/UDP）。
- 手机参与 mesh / direct 数据面，以及把手机所在 LAN 共享给 hub。
- hub 侧按域名分流（此前的「第三种」方案，已否决）。
- **除 DNS 以外的 UDP 进隧道**：QUIC 等一律直连（被墙域名的 QUIC 因此走直连，与 pi 的
  表现一致 —— 无 SNI 时 pi 也只能按 IP 判）。
- 桌面端的 UI 细节（`x/listener/tungo` 在 linux/windows/darwin 能自建设备，本期只保证
  类型可复用，不专门验证桌面体验）。

### 反目标

- 让 `tun` 的成熟路径（fd 交换、flap、liveness、route claim、stats）承担新代码的风险。
- 把 pi 的 tproxy 逻辑搬到手机或 hub。
- 让 hub 变成「任意目标代理」（旧的 A 变体需要它，本方案不需要）。

## 3. 约束（都已验证）

1. **Android 只有一个 VPN 设备**：`tun` 与 `tungo` 互斥。现有
   `entrypoint.CheckTunDeviceFree` 已按 entrypoint 实现这件互斥，需泛化成「VPN 设备
   所有者」。App 侧现在只认「running 的 `tun` entrypoint」建 VPN 并读
   net/routes/mtu/dns，要改成认「持有设备的 entrypoint」。
2. **app 已被排除在 VPN 之外**：`TunVpnService.kt:80-87` 用
   `addDisallowedApplication(packageName)` 替代 `VpnService.protect()`，所以
   **直连腿用普通 socket 即可，不会绕回隧道** —— 这是本方案能成立的前提。若将来把 app
   放进 VPN，直连腿会回环，必须改用 `protect()` 钩子（那是另一项大改）。
3. **规则只挂在 hop 上，而且这一条对 TCP/UDP 都成立**：
   TCP 路径上 `x/handler/tungo/stack.go:256-257` 若配了 service 级 bypass，命中会直接
   `return`（丢弃，不是直连）—— 所以 **service 级 bypass 不配**。
   真正的「直连」只能来自 **hop 级 bypass**：`x/hop/hop.go:207-211` 选中 nil 节点 →
   `x/chain/route.go:160-163` 空路由 → `DefaultRoute.Dial`（`x/chain/route.go:50`）→
   普通 socket。
   **UDP 路径 `stack.go:282-359`（`handleUDPConn`）虽然自己不查 bypass，但它同样走
   `Router.Dial` → 同一个 hop**，所以「清单外 → 空路由 → `DefaultRoute.Dial("udp")`」
   自动成立，不需要改 handler。
4. **bypass 的 whitelist 语义**（`x/bypass/bypass.go:431-455`）：
   `matched == whitelist` → 走代理。即 whitelist 模式下「清单内 → proxy，清单外 →
   bypass」。和 pi 的 `bypass-gfw` 完全一致。
5. **一个 peer key 只应属于一个 tunnel**：p2p 只按 peer key 路由，同一 key 同时出现在
   tun 与 p2p 两个 tunnel 的 allowlist 里会重温
   `p2p-misdelivered-stream-takes-tun-route` 那个坑。手机改用 `tungo` 后应从 tun
   tunnel 的 `peers` 里移除。
6. **relay 协议每连接一个请求**（无多路复用）：每个 app 流 = 一条 p2p stream。
   **TCP 与 UDP 都走 tcp 流** —— relay 把 UDP 帧化在同一条 TCP 上（`UDPTunClientConn`），
   所以不需要 `udp` 类型的 p2p tunnel，也不存在第二种流类型。
7. **relay 覆盖 UDP**：`x/connector/relay/connector.go:52-72` 用 `FUDP` +
   `NetworkUDP`，地址走 `AddrFeature`（支持域名）。这是选 relay 而不是 socks5 的
   原因 —— UDP 走 relay 的帧开销更低。
8. **hop bypass 看到的是「resolve 之后」的地址**：`x/chain/router.go:132-144` 先过
   router 的 resolve/hosts，`x/internal/net/resolve.go:73-77` 只在 router 既无 resolver
   也无 hosts mapper 时原样返回。所以**这个 service 上不能配 `resolver` / `hosts`**
   （手机与 pi 两端都不行），否则域名规则会看到 IP，全部静默变成直连。
9. **bypass 只看一个地址**：`x/bypass/bypass.go:415-452` 的 `localBypass` 只用 `addr`
   参数，`WithHostOption` 传入的 host 被忽略。而 tungo 嗅到 SNI 之后传给 Router 的是
   `host:port`（IP 丢失），所以 **CIDR 规则会被任何带 SNI 的流顶掉** —— 见 §5 的规则
   判定顺序。

## 4. 方案取舍

| 变体 | 做法 | 结论 |
|---|---|---|
| A | pi 零改动；手机 gVisor 开第二个 NIC，把隧道流以 L3 重放进 p2p `ip` 通道 | 否决：每字节两次拷贝、gVisor 的 TCP 叠在 KCP/QUIC 之上、RTO 行为要实测 |
| C | hub 侧按域名分流 | 否决（用户已排除） |
| D | 保持 tun 全量 `0.0.0.0/0` 进隧道，分流交给 pi | 否决：所有流量回家里绕 |
| **B** | **新 `tungo` entrypoint；上行走 p2p tcp 流 + relay；pi 增加 relay 监听** | **选定** |

选 B 的理由：分流结果与 A 完全一致（最终都由 pi 的 bypass 决定），但手机少一层重放，
每流只付一次拷贝；pi 只多一个 service 块；手机侧能复用的都是现成件
（`x/handler/tungo` 的栈+嗅探、`x/connector/relay`、wisper 的 p2p provider 组装）。

## 5. 选定的形状

```
app
 └─ VpnService(tun fd, 路由 0.0.0.0/0 + ::/0, dns 192.168.100.100)
     └─ x/listener/tungo (android: dup fd)          ← 新增 android 分支
         └─ x/handler/tungo  gVisor 栈 + sniffing    ← 现成
             └─ Router.Dial(network, 目的 IP 或嗅探到的 host)
                 └─ chain hop-0（bypass = whitelist 清单）
                     ├─ 清单内 → node{connector: relay, dialer: tcp, metadata.p2p: provider}
                     │            → p2p tcp 流 → hub `p2p` tunnel(endpoint=127.0.0.1:<relay 端口>)
                     │            → pi relay 服务 → chain relay-wss
                     │               → hop bypasses: 白名单→relay.gost.run / bypass-local→家宽
                     │            （UDP 同路，relay FUDP；v1 只有 DNS 会走到这里）
                     └─ 清单外 → DefaultRoute.Dial → 手机自己的网络
```

### 规则怎么表达

**一份 whitelist，三种条目**，语义与 pi 的 `bypass-gfw` 完全相同：

- 需要代理的域名（对齐 pi 的 `gost:bypass:gfw`）
- 内网域名后缀：`home.pi`、`gost.local`、`dadax`（**内网服务按子域名访问，IP 不可直接
  访问** —— 所以这些条目是内网访问的主路径）
- `192.168.100.0/24`（给 DNS 用，见下；也是按 IP 访问时的兜底）

清单外 = 直连。**手机可以故意放宽**（多送几个域名进隧道无害：pi 的 bypass 会让它们从
家宽直连，只是白绕一圈；少送才会坏）。

**判定用的地址（已定）**：`Router.Dial` 收到的那个地址就是判定依据 —— TCP 嗅到
SNI/Host 时是 `host:port`，嗅不到时是原始 `dstIP:port`；UDP 永远是 `dstIP:port`。
所以**不需要在 handler 里做「IP 优先」**：内网服务按子域名访问（用户确认，IP 不可直接
访问），域名规则自然命中；DNS 是 UDP、本来就没有域名，靠 `192.168.100.0/24` 命中。

实现形态：entrypoint 把 `Options.Rules` 组装成一个 `BypassConfig{Whitelist: true,
Matchers: rules}`，hop-0 用 `bypasses: [<name>]` 引用它。清单内的地址 → 选中
`relay` 节点；清单外 → 空路由 → `DefaultRoute.Dial`。**这个设计不需要改动 `x/handler/tungo`**
（本 branch 上它后来被 `0316d18`/`0d006b9` 动过两次（Task 6c），但只是修既有的
`Close`/`Handle` 竞争，不是分流需要的改动）。

### 5.1 DNS：只有它需要 UDP

- VpnService 的 `dns` 设为 `192.168.100.100`，于是所有 app 的查询是 `UDP/53` 到它 →
  CIDR 命中 → 走隧道 → pi 的 `dns` / `dns-tcp` 服务（`hosts: hosts-dns`）作答。
- pi 那边已经是我们想要的行为：`home.pi` / `.gost.local` / `.dadax` 走 hosts-dns；
  中文域走 `192.168.100.1`；其余走 `8.8.8.8`/`8.8.4.4`（经 relay，无污染）。所以
  **内网子域名可解析、被墙域名拿到未污染 IP、国内域名走 ISP**，三件事一次到位。
- 代价：每次查询多一次「回家」往返（pi 侧缓存 + Android 侧缓存缓解）。这是选定的取舍。
- **其余 UDP 一律直连**（QUIC、游戏、VoIP），走的正是 hop 那条空路由：
  `handleUDPConn` 调的 `Router.Dial("udp", dst)` 在清单外时落到 `DefaultRoute.Dial`，
  出来就是一个普通 UDP socket，而 app 在 VPN 之外，所以它真的从手机自己的网络出去。
- **DNS 是 relay `FUDP` 在 v1 里唯一的用户**，而 `FUDP` 仍然跑在 **tcp** 流上（relay
  把 UDP 帧化在同一条 TCP 里），所以手机侧只有一种流类型、一种 dialer（`tcp`），p2p
  tunnel 也不分 tcp/udp。
- 与 pi 的一致性不变：被墙域名的 QUIC 没有 SNI → 不命中 → 直连（和 pi 相同）。

### 与 pi 的一致性

嗅不到域名的流（QUIC、非 TLS、原生 TCP 协议）在 pi 上同样只能按 IP 判 → 白名单不匹配
→ 直连。手机端的默认动作正是「不下发域名 → 直连」，两端语义天然对齐，不会出现「手机
送进去了但 pi 直连」或反过来的错配。

## 6. 要改的组件

### x

1. `x/listener/tungo`：Android 分支不止一个文件，三处都要动：
   - 新增 `tun_android.go`，从 metadata `fd` 取 VpnService 的设备（照
     `x/listener/tun/tun_android.go` 的 `syscall.Dup` + `tun.CreateUnmonitoredTUNFromFD`），
     `readOffset/writeOffset` 与 linux 分支一致；`metadata.go` 增加 `fd` 解析（照
     `x/listener/tun/metadata.go:23-29,135-139`）。
   - `tun_linux.go` 必须加 `//go:build linux && !android`：它现在没有 build tag，而 Go
     会把 `_linux.go` 编给 `GOOS=android`，否则与 `tun_android.go` 重复定义
     `createTun`/`readOffset`/`writeOffset`（对照 `x/listener/tun/tun_linux.go:1`）。
   - `listener.go:96-99` 的 `net.InterfaceByName(name)` 失败是致命的（`return err`），
     Android 上会让听循环每轮都失败、永不交出 conn。照
     `x/listener/tun/listener.go:103-111` 降级为 `log.Warnf`。
2. `x/handler/tungo`：**设计上不需要改动**（§3.3、§5）。service 级 bypass 保持不配；
   规则全部由 hop 的 whitelist bypass 表达，TCP/UDP 都走同一条 `Router.Dial`。
   （事实更正：分支上 `0316d18`/`0d006b9` 确实碰过这个 handler，但那是修一个既有的
   `Close` 与 `Handle` 竞争，与分流无关 —— 本节说的是「分流设计没有拉出这个改动」。）

### wisper

3. 新 entrypoint 类型 `tungo`（`tunnel/entrypoint/tungo.go`）：
   - 服务 = `{listener: tungo, handler: tungo, chain: <单节点 p2p 链>}`。
   - 链节点照 `tunnel/entrypoint/p2p.go:125-175` 组装：`node.Addr = peer key`、
     `node.Connector = {Type: "relay"}`、`node.Dialer = {Type: "tcp"}`、
     `node.Metadata = {"p2p": provider}`；hop 上挂 whitelist bypass（来源见 §8）。
   - Android 生命周期复用 `tunnel/entrypoint/tun.go` 的那套：`vpnDeviceWait`、后台
     `restoreAsync`、`CheckTunDeviceFree`（泛化）、stats（注意
     `wisper-tun-hub-device-counted-as-connection` 的双计坑）。
4. config / API / UI：新类型与它的字段（net、mtu、peer、清单、默认动作）。
   清单本身**放在 entrypoint 的配置里**（`tunnel.Options` 新字段，v1 不做手机侧文件加载），
   并提供一个 `SetRules` 式的**热更新**接缝（照 `SetBlockedPeers`），改清单不重建
   entrypoint、不 flap VPN。坑：`tunnel/entrypoint/entrypoint.go:304-320` 的
   `restartRunning` 是逐字段重新组装 `tunnel.Options`，**新字段不加进去会在重启后
   静默丢失**。
5. App 侧：`TunVpnService` 现在按「running tun entrypoint」取设备参数；改为按「持有
   VPN 设备的 entrypoint」（`tun` 或 `tungo`）。
   `dns` 设为 `192.168.100.100`（§5.1），**并且设备要同时拿到 IPv4 与 IPv6 地址**
   （`0.0.0.0/0` + `::/0` 两条路由）：只捕获 v4 时，白名单域名的 v6 连接会直接走蜂窝
   —— 这是本工具最不能有的外泄。`x/handler/tungo` 已经按 `tcp6` 建连
   （`stack.go:120`），relay 的 `AddrFeature` 也支持 v6 目标，所以 v6 只是多一条
   net/route 与测试面。

### 部署

6. hub：新增一个 `p2p` tunnel，`endpoint: 127.0.0.1:<relay 端口>`、
   `peers: [pixel-9 的 key]`；并把 pixel-9 从现有 `p2p-tun` tun tunnel 的 `peers`
   里移除（约束 5）。
7. pi：新增一个 relay 服务，只绑回环：

   ```yaml
   - name: relay-phone
     addr: 127.0.0.1:18080
     handler:
       type: relay
       chain: relay-wss
   ```

   `relay-wss` 的 hop bypasses 原样复用，分流逻辑一行不改。绑 `127.0.0.1` 是为了不
   在 LAN 上开一个可用代理。

## 7. 验收

1. **白名单域名**：手机 `curl https://<白名单域名>` 成功；pi 的 gost 日志出现来自
   relay 的请求；hub 上能看到对应 p2p 流。
2. **非白名单域名**：手机可访问，且 hub 无对应流、pi 无日志 —— 证明走了手机本地网络。
3. **内网子域名**：`curl https://home.pi/…` 之类（内网服务按子域名访问）可在手机侧解析
   并访问；解析走隧道的 DNS（`192.168.100.100`），TCP 走隧道 → pi → `bypass-local`
   直连 LAN。`ping` 不通属预期。
4. **DNS**：`adb shell` 里看到的 VPN DNS 是 `192.168.100.100`；被墙域名的解析结果与在
   pi 上直接解析一致（未污染）；其余 UDP（如某个 QUIC 请求）不产生 hub 流。
5. **IPv6**：白名单域名在只有 AAAA 可达时仍走隧道（不出现外泄的 v6 直连）。
6. **互斥**：`tun` 在跑时启动 `tungo` 被拒并给出持有设备的 entrypoint 名字；反之亦然。
7. **回归**：现有 tun entrypoint 的 e2e（`tunnel/entrypoint/*_test.go`、
   `wisper-tun-*` 相关场景）全绿；`x` 的 tungo 现有测试全绿。
8. **隧道不可用**：p2p 断链或 pi 的 relay 服务没起时，白名单域名按 §8.1 的失败策略表现。

## 8. 待定 / 风险（需要拍板或实测）

1. **隧道不可用时的动作**：白名单流量「失败」（fail-closed，推荐：不泄漏到污染路径）还
   是「静默直连」（fail-open，可用但可能被污染/被墙）。建议做成选项、默认 fail-closed。
2. **清单来源与同步**：v1 的清单是 entrypoint 配置里的一条（§6.4，热更新、不 flap）；
   与 pi 的 `gost:bypass:gfw` 对齐靠手工维护。后续可以让 hub 从本机 redis 拉取，
   经现有控制通道（`ctrlhub` / netview 那套）下发给 spoke。
3. **每流一条 p2p stream 的规模**：短连接风暴下的 smux 上界、是否需要对同目标复用/限流。
4. **Android fd 生命周期**：`tungo` 要复用 flap/restart 语义（对照
   `wisper-vpn-flap-blackhole`、`wisper-tun-fd-swap-blackhole`、`wisper-tun-restart-direct-fix`）。
5. **观测**：tungo 是流计数而非包计数，hub 的 `no route` / liveness 提示对它不适用，
   需要自己的连通性信号（可复用 `tun-liveness` 的思路）。
6. **relay FUDP 端到端要实测**：v1 唯一的用户是 DNS，但它是新路径
   （`x/connector/relay` → p2p tcp 流 → pi 的 relay handler → `bindUDP`）。若在 p2p 流上
   表现不佳，退路是把 DNS 以 TCP DNS 转发到 pi 的 `dns-tcp`（同一个 socks/relay 流上
   `network=tcp`，framing 只多 2 字节长度前缀）。
7. **内网 DNS 依赖 pi 的 hosts-dns**：新增内网子域名要落在 pi 的 `hosts-dns` 里，
   否则手机解析不到（手机侧没有 split DNS 的能力）。

## 9. 实施顺序（供计划阶段参考）

1. `x/listener/tungo` 的 Android fd 分支 + 单测（用假 fd 或进程内设备）。
2. wisper `tungo` entrypoint 的配置组装与规则（桌面即可验证：解析生成的 chain，断言
   清单内选中 relay 节点、清单外为空路由）。
3. 生命周期：p2p provider、设备 claim、Android 设备等待/restart、stats。
4. pi 的 relay 服务 + hub 的 p2p tunnel 接线，用桌面 tungo 端到端验证（含 DNS 的 FUDP）。
5. Android：App 侧取设备参数（含 v4+v6 双地址与 `dns`）、UI 的类型与字段、真机验证 §7。
6. 清单的配置/热更新与 UI（先手写维护，后接 redis 下发）。
7. 失败策略与观测。