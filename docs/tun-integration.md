# wisper 集成 tun 组网 评估

> **状态（2026-10-04，hub 成为地址的分配方）**：hub 的准入不再靠凭据。**白名单里每个 spoke 那一行现在
> 写着它可以声明哪些地址**，地址必须取自 hub 自己的 `net`；spoke 注册时声明的地址与该行**完全一致**
> （集合相等，不多不少，顺序无关）才放行，否则这次注册不生效——不建路由，也不回 keepalive 回显——并在
> hub 的事件里记一条 warn（事件挂在 hub 上，不是挂在那个 peer key 下）。形状：config `peer_ips`
> （peer key → 逗号分隔的**主机地址**，不是前缀）、API `Peers[].ip`、peers 页上每行一个地址框；留空的行
> 由 hub 从自己的网段按白名单顺序分配。**没有新增 token**：p2p 的 peer key 早已完成认证（它就是把这条流
> 路由进来的那份白名单），缺的只是授权。
>
> 下面 2026-09-24 那段「准入改由 tun server 的 `auther` 承担（`username` = spoke 的 tun IP、
> `password` = 该 spoke 的 `token`）」**已作废**：wisper 的 tun hub 不再读 `username`/`password`，
> `tunnel/tun.go` 里实现它的那段接线已删除（`9d6ce96`）——这两个字段还在 Options 里，别的隧道类型还在用。
> 它当时也不可能是对的：p2p hub 的 handler 内部 auther 恒为 nil（`x/handler/tun/p2phandler.go`，p2p 侧的
> 身份就是那份白名单），而 x 询问 auther 时用的用户名是 spoke **声称的**设备地址
> （`x/handler/tun/router.go`），所以它问的其实是「这个 peer 能不能用它刚声称的地址」——那是授权，不是
> 认证。照旧建议配出来的只是一个从不准入的运维专用配置。
>
> 运维要知道的三件事：
> ① **改 hub 的 `net` 不用重启**。peers 页保存走 `PUT /api/tunnels/{id}/peers`，就地换掉地址分配，设备
> 与路由都不动；hub 详情页保存则用请求里的 `net` 重建并重新跑起来（`handleUpdateTunnel` 关旧、
> `RunWithContext` 起新），保存返回时新 `net` 已经生效。
> ② **没动过的地址就是没动过**。页面上没碰过的行不发 `ip` 字段，含义是「保持不变」；只有**清空**一格
> 才算「重新分配」。
> ③ **不合规的行怎么落地，取决于是从哪儿进来的**。走 API 的三个入口（新建、hub 详情页的 PUT、peers 页的
> PUT）共用同一套校验：不解析、不在 hub 网段内、写的是 hub 自己的地址、同一地址被两行写——这次保存被
> **拒绝**，400 里点名是哪个 spoke、哪个地址。绕开 API 的那条路（从手改的配置启动的 hub）没有这个校验：
> 不满足的行被**整行丢掉**并记一条 warn 事件——不清空、不变成「可声明空」把 spoke 锁在门外、也不影响别的
> 行，所以一个坏行不会让后面每次保存都失败。没配 `net` 的 hub 不做网段判断（没有网段可问），已有的行
> 全部保留；只有要**新分配**时才报 `no subnet configured`。
> 换网段是唯一要绕一下的：hub 详情页保存会连各行地址一起带上，旧地址不在新网段里就会被拒。要换就先在
> peers 页把 spoke 删掉，改完 `net` 再加回来（留空的行按新网段分配）。

> **状态（2026-10-02，再次修订）**：hub 已**重新作为 wisper 类型落地**（`tunnel/tun.go`，实现取回
> `8411554`，并在 `Run` 里补上 `CleanStop` 分类）。理由与下面 2026-09-24 那段相反：为普通用户，
> UI 驱动的部署比手写 gost YAML 更容易，代价是 **hub 上的 wisper 需要特权**（root / CAP_NET_ADMIN，
> 因为设备由它自己创建）。下面 2026-09-24 的记录保留为历史；两条路都可用，见本文末尾的对比。

> **状态（2026-09-24，实施后修订）**：只落地了 **spoke**（wisper 的 `tun` 入口点）。**hub 没有做成 wisper 类型**：
> 设备由 gost 进程持有（tun server，见 `play/p2p-tun-hub/gost.yml`），wisper 只跑一条**现有的 p2p 隧道**
> 把各 spoke 桥到它的 UDP 口（`endpoint` 填 tun server 的地址），**白名单仍是准入**——未列出的 key 在拨号前就被关流。
> 理由：设备持有者不需要 wisper，因此 hub 上的 wisper 无需特权；hub 类型的实现见提交 `8411554`/`31141c9`，
> 随后删除（历史里保留）。本文其余部分（含 Android 章节）不受影响。
>
> **hub 上连 wisper 也不是必需的**：那条"把 spoke 桥到 tun server UDP 口"的隧道，用 `p2p` CLI 的
> `--target=udp://<tun server>` 一样能做，正式形态见 `play/p2p-tun-hub/docker-compose.yaml`（hub 上
> 只有一个 `p2p` 进程 + 一个 gost 进程）。差别只有两点：① **准入**——p2p 的 target 侧**没有白名单**
> （设计如此，见 `p2p/docs/2026-09-13-p2p-udp-target-streams.md`），必须改由 tun server 的 `auther`
> 承担（`username` = spoke 的 tun IP、`password` = 该 spoke 的 `token`），或用防火墙/relay 校验；
> ② 少了 wisper 的 UI/API、peer 状态与 per-peer 统计。想要白名单前置拒绝或那套界面，才用 wisper 的
> p2p 隧道类型当 hub 桥。

2026-09-24 评估。**结论：可集成，p2p 侧零改动**。前提是 p2p 侧的 tun hub 已改为 gost 侧实现
（`udp://` target outlet + gost 的 tun **server** 持有设备，p2p 只当管道、零 per-peer 状态，
见 `p2p/docs/2026-09-12-p2p-hub-mode.md` 顶部「已被取代」与 `2026-09-13-p2p-udp-target-streams.md`）。

wisper 侧要补的是**两个服务类型**（spoke 的 tun 入口点、hub 的 tun 服务），数据面协议一行都不用写；
Android 侧要新增一条 VpnService 通道 + 一处 x 改动。Android 可行，但**手机只能当 spoke，当不了 hub**。

## 现状：接缝已经就位

- p2p 侧已无 hub 概念：hub 是 gost 的 tun server（`x/handler/tun/server.go`，
  服务地址绑一个 UDP socket，按 spoke IP 解复用到同一块设备，路由靠 tun client 的
  keepalive 注册，即 `x/handler/tun/client.go` 的 `"GOST"+passphrase+IPs`）。
- wisper 内嵌 host 走的是 **embedder 模式**（`tunnel/p2p_host.go` 的 `host.Listen()`），
  而 tagged datagram stream 的解析顺序里 **embedder 优先于 udp target**
  （`p2p/internal/host/direct.go` 的 `serveInbound`：adopt → embedder → udp target → 关闭）。
  所以在 wisper 进程里，”出口”不是 p2p CLI 的 `--target`，而是 wisper 自己的 peer 路由。
- 该路由已经能服务 datagram stream：`peerListener.Accept` → x 的 local handler，
  而 local handler 按 conn 形状判 udp（`x/handler/forward/local/util.go`：
  `conn.(net.PacketConn)`）→ 拨 udp 后端。e2e 覆盖：
  `tunnel/p2p_e2e_test.go` 的 `TestP2PTunnelServesPeerDatagrams`
  （注释原文即 “the shape a udp entrypoint (or a tun …)”）。

**即：hub 的 outlet 在 wisper 里今天就是一条现有的 p2p udp 隧道。** 换掉 e2e 里的 udp echo
后端，换成 gost tun server 的 UDP 监听地址即可。

## wisper 侧要加的东西

| 角色 | 组成 | 复用度 |
|---|---|---|
| **spoke**（拨号进虚拟网） | 新 entrypoint 类型：`tun` listener + `tun` handler（client 模式）+ p2p chain node | 骨架 = `tunnel/entrypoint/p2p.go`（它已是手搓 `tcp/udp.NewListener` + `local.NewHandler`，换成 `tun` 的两个构造 + 元数据）；新增 `net`/`mtu`/`route`/`dns`/`gw`/`keepalive` 的 config/Options/API/UI 字段 |
| **hub**（持设备） | 新服务类型：`tun` listener + `tun` handler（server 模式）+ 现有 p2p udp 隧道（target 指向它的 UDP 口，allowlist = 各 spoke key） | 隧道侧已具备（见上）；缺的只是「在 wisper 里能跑一个 tun server 服务」 |

配置形状参照 `gost/play/p2p-tun.yaml`：spoke 是 `listener: tun` + `handler: tun` + `chain`
（无 forwarder 的 chain = client 模式，node addr 为对端公钥、dialer `udp`、connector `forward`、
`metadata.p2p` = 注册的 provider 名）。

两层 keepalive 都要配，缺一层就会静默断流：

- wisper 隧道 listener 的 `keepalive`/`ttl`：保住 datagram 会话（流不会在两条报文之间被回收）；
- tun client 的 `keepalive: true`：保住 tun **server** 侧的路由表（源端口在 peer edge 重建时会变，
  路由靠下一次 keepalive 刷新）。hub 的 tun server 侧同样要 `keepalive: true, ttl: 10s`
  （server 侧该值即 routeTTL，opt-in，未配则路由只增不过期）。

注意约束：`keepalive` 只在**对端是 tun server** 时有意义；点对点链路（两侧都是 tun client）
不得开，否则会对端不回显、空闲即超时重拨。

## 不做：真 mesh

每对 peer 直连、单设备按目的 IP 分发（单设备多 peer 的真正 mesh）在今天 tun handler 的
`routes: IP → UDPAddr` 模型下要另写分发与 per-peer 设备边，且 `tun.p2p` 标记会直接把路由表压成
单 peer。星形（hub 转发，hub 内核 `ip_forward` + 路由）已够用，也正是 p2p 侧刚改完的形状。
要扩展就是多 hub。

## Android（重点）

现状：`android/` 是 Kotlin 前台服务（`foregroundServiceType="dataSync"`）+ JNI + cgo 的 Go
（`lib_jni.c` 已经把「把参数传进 Go」的形式摆好），minSdk 26 / targetSdk 34，**没有任何 VpnService**。

约束与代价：

1. **非 root 拿不到 `/dev/net/tun`** → 只能 `VpnService.Builder.establish()` 拿 fd，Java 侧配置 +
   JNI 交给 Go，Go 侧用 `tun.CreateUnmonitoredTUNFromFD`（pinned 的 `golang.zx2c4.com/wireguard`
   提供，linux 实现覆盖 android；比 `CreateTUNFromFile` 少掉 netlink 监听与 `setMTU`）。
   传递形态：`WisperJNI.setTunFd(fd)`（fd 由 Java 侧 `detachFd()` 让渡）→ `tunnel.SetTunFD`
   → 入口点把**取 fd 的函数**放进 listener 的 `fd` metadata（不是号码）→ x 的 android 变体**每建一个设备
   现场解析 + dup 一次**：设备关闭不影响 VPN（停止/重启入口点无需重建 VPN），号码也不会因为
   设备重建时被回收（`fd` 收 int 也收 `func() int`，int 只适合固定不动的场景）。
2. **设备配置必须走 Java Builder**（`addAddress` / `addRoute` / `setMtu` / `addDnsServer`），
   配置来源就是 `/api/entrypoints` 里该 tun 入口点自己的字段（Java 与 Go 不各留一份）。
   已落地：`x/listener/tun/tun_linux.go` 加 `linux && !android`，新增 `tun_android.go`
   （只认 fd，跳过 netlink / addr / route / dns / `resolvectl`）。**x 发版 + 版本链待做**。
3. **路由变更要重建 VPN**（`Builder` 只能 establish 一次）→ 重建 = 新 fd + `SetTunFD` 替换
   （旧的由 Go 侧关闭），**在跑的入口点会随旧设备一起断**，需手动重启该入口点；v1 接受这个代价。
4. **只路由虚拟网段就不需要 `protect()`**。`addRoute(虚拟网段 + 对端 LAN)` 时，relay 的 wss、
   打洞的 UDP 都是公网地址，不进隧道；要做 0.0.0.0/0 出口才需要给 p2p 的每个套接字调
   `VpnService.protect(fd)`（Go → JNI 回调，Jigsaw Intra 的现成先例），那是侵入 p2p/x 的活。
   **第一版建议不做全流量。**
5. **Android 14 前台服务类型**：targetSdk 34 的服务必须声明类型；VPN 用 `systemExempted` +
   `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`，且**只有「已在系统设置里被配置为 VPN」才允许**，
   否则 `ForegroundServiceTypeNotAllowedException`；不声明类型则 `MissingForegroundServiceTypeException`。
   做法：manifest 声明 `dataSync|systemExempted`，按 VPN 是否已建立选类型。
6. 用户第一次要过一次 VPN 授权弹窗，且是设备唯一 VPN（Android 12+ 可链式）；现有 emulator 测试
   可用 `adb shell appops set run.gost.wisper ACTIVATE_VPN allow` 免弹窗，**可自动化**。
7. 手机不能当 hub（无公网入口）；Android 侧只需实现 spoke。

**待实测**：最终选的是 `CreateUnmonitoredTUNFromFD`（`CreateTUNFromFile` 的那个 netlink 监听 +
`setMTU` 版本正是不该在 app 里用的），所以「netlink 在 app netns 里能不能用」这个问题消失了；
剩下要实测的是 `TUNGETIFF`（取接口名）与 `initFromFlags` 两个 ioctl 在 VpnService 的 fd 上是否通过
（这正是 WireGuard-Android 走的同一条 API，属强先例、非实测）。失败则退到 **userspace netstack**：
不碰设备、把 tun fd 的 IP 包喂给现有 p2p udp 隧道
（Intra / tailscale-android 的同类做法；工作区里就有 `xjasonlyu/tun2socks` 可参考/复用）。
另外 android 没有 netmon：Wi-Fi↔蜂窝切换后 relay wss 与打洞 socket 需重建，engine 的 5s 重拨
能兜一部分，保活要在真机 + doze 下验证。

## 分阶段建议

1. **桌面/服务器先行**：hub = 现有 udp 隧道 + 新 tun server 服务；spoke = 新 tun 入口点。
   这一步 90% 是复用，只验证「tun 组网」本身。（Android 完全不碰。）
2. **手机只需访问内网**：零代码替代——继续用现有的 SOCKS/HTTP entrypoint，手机设代理即可，
   不需要 tun、不需要 VpnService、不需要过 VPN 授权。
3. **手机进虚拟网**：按上面 1→7 加 VpnService 通道；第一版只路由虚拟网段，不做全流量、不碰 `protect`。

每一步的门禁沿用现有习惯：`go build ./... && go vet ./...`、`CGO_ENABLED=1 go test -race ./...`
（wisper 侧）、涉及 x 时 `GOWORK=off go build ./...` + x 发版与版本链。

## 下一阶段（Android）工作顺序

> **进展（2026-09-24）**：1、3 的代码已落地（x 已改、wisper Go/Kotlin/manifest 已改），
> 2（x 发版与版本链）、4（真机验证）未做。实现时的取舍记在下面。

1. ~~**x**：android 变体~~ **已完成**。`tun_linux.go` 加 `//go:build linux && !android`；新增 `tun_android.go`：
   从 `fd` metadata `dup` 一份交给 `tun.CreateUnmonitoredTUNFromFD`，跳过 netlink/addr/route/dns 与
   `net.InterfaceByName`（listenLoop 里那次查找改成只记日志——Android 上接口未必在本进程可见）。
   `go build ./... && go vet ./...`（linux）+ `CGO_ENABLED=0 GOOS=android go build ./...` 通过。
2. **x 发版 + 版本链**：x 打 tag（先 push tag）→ bump `wisper/go.mod` → `GOWORK=off go build ./...` 门禁。
3. ~~**wisper/android**~~ **已完成**（细节见下）。Go：`tunnel/tunfd.go`（fd 保管 + `WaitTunFD`）、
   `lib.go`/`lib_jni.c` 加 `wisperSetTunFdGo`、tun 入口点在 android 上等 fd（≤10s）并写进 listener metadata。
   Kotlin：`WisperService` 改成 `VpnService`，由既有的 2s 轮询驱动（见下）。
4. **验证（未做）**：emulator 上 `adb shell appops set run.gost.wisper ACTIVATE_VPN allow` 免弹窗，走既有 `make android-test-*`；
   真机验证 `CreateUnmonitoredTUNFromFD`（含 `TUNGETIFF` 取名字、`initFromFlags`）在 app netns 内是否成功，
   失败即启第 7 条的 netstack 退路。

### 实现形态（2026-09-24）

- **谁建立 VPN**：**表单先"预装"**——tun 表单保存前经 `WisperNative.armVpn`（JsBridge，和 `pickDir` 同一套）把 `net/routes/mtu/dns` 交给原生侧，需要授权就由前台 Activity 弹窗，建立好再回调，UI 才提交创建。原因是死锁：创建 tun 入口点需要设备 fd，而 fd 只能来自 VpnService，且**创建失败会回滚**（[api/entrypoint_handler.go](../api/entrypoint_handler.go) 在 `entrypoint.Add` 之前就 500），所以"等入口点存在再建立 VPN"永远等不到。
  `WisperService` 的 2s 轮询保留为**兜底**：已有 tun 入口点（例如 App 重启后配置里那条）也会建立/重建（配置变了就重建，旧设备随旧 VPN 一起失效）；未授权时发一条提示通知。**不需要改 Go 侧**；emulator 上 `adb shell appops set run.gost.wisper ACTIVATE_VPN allow` 可免弹窗。
- **两个竞态**：
  ① 恢复运行中的入口点在 backend 起来时就启动，而 VPN 要等轮询（≤2s）→ Go 侧 `WaitTunFD` 等（≤10s），
  正常情况下首次 start 就能成功；需要用户点通知授权的场景超过等待时间，才需要再点一次 start。
  ② `onRevoke()`（被系统/其他 VPN 抢走）→ 清 fd、置未建立，轮询重新建立。
- **一个 VPN、一个 tun 入口点**：Android 一个 app 只有一个 VpnService，两个 tun 入口点会同时读同一块设备。
  v1 未拦截（UI 也不限制），文档里先记为已知限制。
- **VPN 的生死跟随「有 tun 入口点 或 表单预装的配置」，而不是「它跑没跑」**：两者有一即可建立（否则首次
  创建永远等不到设备），于是入口点全部停止时 VPN 也还挂着（系统栏有图标、虚拟网段没有出口）。v1 不在
  "没人需要"时主动拆掉；改 net/routes/mtu 保存时会按新配置重建（旧设备随旧 VPN 失效，跑着的入口点要
  重新启动一次）。
- **不做全流量也顺手防了一个坑**：`Builder.addDisallowedApplication(packageName)` 让本进程自己的套接字
  绕开隧道（等价于给每个 p2p socket 调 `protect()` 的免侵入版），否则一旦有人把 routes 配成 `0.0.0.0/0`，
  承载隧道的 wss/打洞流量会自己绕回 hub。
- **前台服务类型**：manifest 声明 `dataSync|systemExempted` + `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`；
  API 34 上建立 VPN 后重新 `startForeground(..., DATA_SYNC or SYSTEM_EXEMPTED)`（`systemExempted`
  只有「已经是 VPN」时才被接受）。
- **MTU**：入口点未配时 Java 侧按 wisper 的默认 1300 设置，避免 Builder 默认 1500 或旧的 1420 超出 p2p 的 KCP 路径。
- **设备名**：Android 上由系统命名（`VpnService` 不给名字），入口点的 `device_name` 在 Android 上无效。

不在这一阶段：全流量出口（要 `protect()`，侵入 p2p/x）、tun↔tun 直连的手动链路。

## 手机上按域名分流（tungo entrypoint）

2026-11-22 实现。部署形状已就位，但**分流尚未生效**（`gw-split` 的 allowlist 还是空的，手机仍跑在
原来的 `p2p-tun` 上，细节见本节「部署」的开头）。前面几节讲的是**全量 L3 进隧道**的 `tun` 入口点；这一节是新增的 `tungo`
入口点：本地仍是 tun 设备（Android 上是 VpnService 的 fd），但栈把每个 TCP 流终止下来，
**只把白名单里的目的送进隧道**，其余从手机自己的网络出去。判定**先看嗅到的域名**，嗅不到域名时
才用目的 IP —— 这正是 `tun` 做不到的那件事：VpnService 的路由在 `establish()` 时就定死了，而域名的
IP 不可预知。域名优先也解释了 DNS 凭什么走隧道：解析请求没有 SNI，它就是靠 IP 命中
`192.168.100.0/24` 这一条 CIDR 规则的。设计与取舍见
`docs/superpowers/specs/2026-11-22-android-tungo-split-design.md`。

### 形状

```
app → VpnService(tun fd) → x/listener/tungo → x/handler/tungo（gVisor 栈 + 嗅探）
    → Router.Dial(嗅到的 host:port，或 dst IP:port)
        → chain hop-0（bypass = whitelist）
            ├─ 命中 → node{connector: relay, dialer: tcp, metadata.p2p: provider}
            │        → p2p tcp 流 → hub 的 p2p tunnel（endpoint 指向 pi 的 relay 服务）
            │        → pi 的 relay handler → chain relay-wss（hop bypasses 原样复用）
            └─ 未命中 → 空路由 → DefaultRoute.Dial → 手机自己的网络
```

这套分流/路由的**设计**没有要求改动 `x/handler/tungo`：栈、嗅探、UDP 都已在。新增的是
`x/listener/tungo` 的 Android fd 分支、wisper 的 `tungo` 入口点（类型名 `tungo`），以及下面这套部署。
（这个 branch 上 handler 后来确实被改过两次 —— `x@0316d18` / `x@0d006b9`，Task 6c —— 但那只是修一个
既有的 `Close` 与 `Handle` 的竞争，与分流无关。）

### 规则：一份 whitelist，三种条目

- **语义与 pi 的 `bypass-gfw` 完全相同**：`matched == whitelist` → 走代理。清单里 → 进隧道；
  不在清单里 → 直连。
- 三种条目：① 需要代理的域名（与 pi 的 `gost:bypass:gfw` 对齐）；② 内网域名（写成前导点
  形式，如 `.example.com`、`.gost.local`、`dadax`）—— 匹配器按整名匹配，`example.com` 只命中这一个
  名字，`.example.com` 才命中它及其下所有子域名；内网服务按子域名访问，所以这些条目就是内网访问的
  主路径；③ `192.168.100.0/24`（给 DNS 用，也是按 IP 访问时的兜底）。
- **判定用的地址**：`Router.Dial` 收到的那个地址 —— TCP 嗅到 SNI/Host 时是 `host:port`，嗅不到
  时是原始 `dstIP:port`；UDP 永远只有 `dstIP:port`。手机的默认动作是「不下发域名 → 直连」，
  与 pi 上「嗅不到就按 IP 判」天然对齐。
- 清单**故意放宽**无害：多送几个域名进隧道只是白绕一圈（pi 的 bypass 会让它从家宽直连）；
  少送才会坏。
- 两条硬约束（都在入口点侧，不在 pi）：
  1. **不配 service 级 `bypass`**：TCP 路径上命中会直接丢弃这条流，不是直连 —— 直连只能来自
     hop 级 bypass。
  2. **不配 `resolver` / `hosts`**：router 会先解析，hop 的 bypass 看到的就是 IP，域名规则全部
     静默失效。
- 一个已知的非对称：bypass 只看一个地址，而带 SNI 的流传的是 `host:port`（原始 IP 丢了），
  所以**带域名的流会顶掉 CIDR 规则** —— 这也是内网服务要按子域名访问、而不是按 IP 访问的原因。

### DNS：唯一需要 UDP 的

- VpnService 的 `dns` 设为 `192.168.100.100`，于是所有 app 的查询是 `UDP/53` 到它 → 命中
  `192.168.100.0/24` → 走隧道 → pi 的 `dns` / `dns-tcp`（`hosts: hosts-dns`）作答。pi 那边已经是
  想要的行为：`home.pi` / `.gost.local` / `.dadax` 走 hosts-dns；中文域走 `192.168.100.1`；
  其余走 `8.8.8.8`/`8.8.4.4`（经 relay，无污染）。内网子域名可解析、被墙域名拿到未污染 IP、
  国内域名走 ISP，三件事一次到位。
- **只有 DNS 需要 UDP**：relay 把 UDP 帧化在同一条 TCP 里（`FUDP` 走 p2p tcp 流），所以不需要
  `udp` 类型的 p2p tunnel，手机侧也只有一种流类型、一种 dialer。
- 其余 UDP（QUIC、游戏、VoIP）一律直连：`handleUDPConn` 的 `Router.Dial("udp", dst)` 在清单外
  落到 `DefaultRoute.Dial`，出来就是普通 UDP socket，而 app 在 VPN 之外，所以它真的从手机自己的
  网络出去。被墙域名的 QUIC 因此也直连（没有 SNI，pi 上同样只能按 IP 判）。
- 代价：每次查询多一次「回家」往返（pi 侧缓存 + Android 侧缓存缓解）。这是选定的取舍。

### 隧道不可用时

没有任何静默直连的退路：清单内的流拨不通就是失败（白名单域名打不开），DNS 也在清单里，所以
**隧道一断连解析都拿不到**（唯一那个 hop 节点永远会被选中——最坏也是 `Select` 的 last-resort 分支——
所以不会落回直连）。这是事实上的 fail-closed。把它做成显式选项（fail-closed / fail-open）还没做，
属于设计 §8.1 的待定项 —— 在那之前，「隧道断了就断网」是预期的表现，不是故障。真机上 Android 会不会
在 VPN 的 DNS 失败后回退到别的解析器，本期没有结论。

### 部署（2026-11-22 已在 pi / hub 上落地）

**先说清现在的状态**：下面这套形状已经就位，但**分流还没有生效** —— hub 上的 `gw-split` allowlist
是**空的**（不接受任何 peer），手机仍跑在原来的 `p2p-tun` 上，p2p → pi relay 这整段（含 relay 的
FUDP/DNS）**尚未验证**，要等手机切过来（Task 7b）才有第一条真流量。已经验过的只有 pi 上 relay
handler 这一跳（用本机 gost 客户端经 `127.0.0.1:18080` 取过国内外各一个 URL）。

pi 上加一个 relay 服务，**只绑回环**（绑 LAN 地址就等于开了一个人人可用的代理）：

```yaml
- name: relay-phone
  addr: 127.0.0.1:18080
  metadata:
    enableStats: true
  handler:
    type: relay
    chain: relay-wss
  listener:
    type: tcp
```

- 监听器是 `tcp`，不是 `relay`：`x/listener` 没有 relay 类型，relay 协议在 handler 里识别。
  但这个端口**只认 relay**：`x/handler/relay` 上来就按 relay 读握手（`handler/relay/handler.go:219-222`），
  首字节对不上 relay 版本直接 `ErrBadVersion` 断开，没有 socks5/http 探测 —— 它服务不了那些客户端，
  也不该被当成通用代理端口暴露出去。
- `chain: relay-wss` 就是既有那条链，hop-0 的 `bypasses: [bypass-gfw, bypass-local]` 原样复用，
  分流逻辑一行不改：`bypass-gfw`（whitelist 模式）里的目的走出 `relay.gost.run`，**其余一律从家宽
  直连** —— 国内域名是因为「不在白名单里」而直连（hop 没选中任何节点），不是被 `bypass-local` 拦下来
  的；`bypass-local` 命中的内网地址同样直连，两条路径的出口相同。
- 热重载用 `SIGHUP`（不要重启服务）；实测 `ss -ltn` 只有 `127.0.0.1:18080` 一条。

**信任边界**（写在「只绑回环」旁边，因为两者是一对）：只绑回环挡住的是*网络上的*外部客户端，
挡不住通过隧道进来的人。`gw-split` 白名单里的任一 peer —— 也就是手机 —— 一旦连上，就可以让 pi
拨**任何 pi 能到达的目的地**：回环上的其它服务（本机管理口、`gost` API、只有 pi 本地才信任的面板）、
以及家宽所在的整个 LAN。`bypass-gfw` 只决定**走哪条链**，从来不限制**目的地**。所以：

- hub 的 `gw-split` allowlist 等同于「允许这些设备使用 pi 的网络出口」，加 peer 之前按这个标准审。
- 手机上的规则清单（tungo 的 `rules`）是**手机侧**的选择，不是 pi 侧的授权：清单外只是不走隧道，
  清单内并不因此被 pi 限制。
- 想让某类目的地不可达，要在 pi 侧（服务级 bypass / 防火墙 / `relay` 服务前面再加一层）挡，
  不能指望手机侧清单。

hub 上加一个 `p2p` tunnel，把这条流交给 pi 的 relay 服务：

```json
{"name": "gw-split", "type": "p2p", "endpoint": "127.0.0.1:18080"}
```

**一个 peer key 只能属于一个 tunnel**：tun hub 与 p2p tunnel 共用 hub 里同一张 peer 路由表
（`tunnel/tun.go` 与 `tunnel/p2p.go` 都走 `p2pHost.register`），所以两个 tunnel 的 allowlist 同时出现
同一个 key 会被拒绝（`peer … is already used by another p2p tunnel`，整个保存回滚）。手机切换时这两件事
只能**背靠背**做：先 `PUT …/p2p-tun/peers` 去掉它，紧接着 `PUT …/gw-split/peers` 加上它（反过来的第一次
请求会 500）。中间那几秒手机上没有任何隧道 —— 此时旧 `tun` 入口点已停、新 `tungo` 入口点本来就还连不上，
所以只影响它自己。在那之前，新 tunnel 可以**留空 allowlist** 先建好（空 = 不接受任何 peer，但状态是
running），这样切换时只剩两次 peers 保存。

### 编辑与保存：`tungo` 的保存不再等于重启

下面这一节**只对 `tungo` 入口点成立**。就地更新靠的是 `RuleSetter`，而它只由 tungo 入口点实现
（接口 `tunnel/entrypoint/entrypoint.go:39-47`，实现 `tunnel/entrypoint/tungo.go:265`）：API 只有在
被替换的入口点实现了它、且除 `rules` 外没有任何字段变化时才就地生效
（`api/entrypoint_handler.go:338`）。`tun` / `p2p` 入口点没有这个接缝，**哪怕什么都没改，保存一次
照样把入口点重建一遍**。

- **只改 `rules`** → 就地 `SetRules`，不重建入口点、不 flap VPN：清单是链按名字解析的一个活
  对象，能自己接住这次改动。
- **改了 net / mtu / dns / peer 等任何其它字段** → 重建：设备会断一次再回来。
- **什么都没改** → 不重建（旧行为是每次保存都重建一个健康的入口点）。
- 所以「停/启」现在得分别做，UI 和脚本都不能再假设「保存 = 重启」。

### 已知限制

- **Android 只有一个 VPN 设备**：`tun` 与 `tungo` 互斥，同时在跑会被拒并点名持有设备的那个
  入口点。
- v1 只做 TCP + DNS-over-UDP；ICMP / mDNS / 广播不做。
- 嗅不到域名的流（QUIC、非 TLS、原生 TCP 协议）按 IP 判 → 直连，与 pi 的表现一致。
- 桌面端的 `tungo`（`x/listener/tungo` 在 linux/windows/darwin 自建设备）本期只保证类型可复用，
  没专门验证体验。
- **x 版本链仍未做**：wisper 的 `go.mod` 还 pin `x v0.29.0`，而 APK 构建（`android/Dockerfile.apk`）
  只吃 wisper 仓库上下文、看不到工作区的 `go.work`。v0.29.0 的 `x/listener/tungo` 没有 android
  的 fd 分支（会去开 `/dev/net/tun`），所以**发版前必须先给 x 打 tag 再 bump `go.mod`**，否则
  装到手机上的 tungo 在 Android 上起不来。

## 相关

- `wisper/docs/p2p-integration.md` — p2p 接缝评估（本文是其 tun 续篇）
- `p2p/docs/2026-09-12-p2p-hub-mode.md`（已被取代）、`p2p/docs/2026-09-13-p2p-udp-target-streams.md`
- `gost/play/p2p-tun.yaml` — tun-to-tun over p2p 的配置形状
- `p2p/CLAUDE.md`（Datagram link / UDP target outlet）、`x/listener/tun/`、`x/handler/tun/`
