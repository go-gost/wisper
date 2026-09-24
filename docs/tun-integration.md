# wisper 集成 tun 组网 评估

> **状态（2026-09-24，实施后修订）**：只落地了 **spoke**（wisper 的 `tun` 入口点）。**hub 没有做成 wisper 类型**：
> 设备由 gost 进程持有（tun server，见 `play/p2p-tun-hub/gost.yml`），wisper 只跑一条**现有的 p2p 隧道**
> 把各 spoke 桥到它的 UDP 口（`endpoint` 填 tun server 的地址），**白名单仍是准入**——未列出的 key 在拨号前就被关流。
> 理由：设备持有者不需要 wisper，因此 hub 上的 wisper 无需特权；hub 类型的实现见提交 `8411554`/`31141c9`，
> 随后删除（历史里保留）。本文其余部分（含 Android 章节）不受影响。

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
   JNI 交给 Go，Go 侧用 `tun.CreateTUNFromFile`（已确认 pinned 的 `golang.zx2c4.com/wireguard`
   有此 API，linux 实现覆盖 android）。这就是 WireGuard-Android 的做法；fd 传递按现有
   `lib_jni.c` 模式加一个 `wisperSetTunFd(fd)` 即可。
2. **设备配置必须走 Java Builder**（`addAddress` / `addRoute` / `setMtu` / `addDnsServer`）。
   gost 现在的 android 编译结果是走 `x/listener/tun/tun_linux.go` 的 netlink + `resolvectl` shell
   （已实测 `GOOS=android` 能编译，但 app 无 CAP_NET_ADMIN、也没有 `resolvectl`）→
   **需要一处 x 改动**：`tun_linux.go` 加 `!android`，新增 android 变体（只包 fd，跳过
   addr/route/dns 与 `net.InterfaceByName`）。连带 x 发版 + 版本链（core → x → gost，wisper 再 bump）。
3. **路由变更要重建 VPN**（`Builder` 只能 establish 一次）→ fd 要做成可注入、可替换
   （`tunListener.listenLoop` 本来就在循环重建设备），避免重建整条 p2p 隧道/会话。
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

**待实测（唯一未知项）**：`CreateTUNFromFile` 内部还会经 netlink 取 ifindex、`setMTU`
（见其 linux 实现的 `getIFIndex` / `setMTU`），在 app 自己的 netns 内是否成功需真机验证
（WireGuard-Android 是这么用的，但那是先例判断，不是我们的实测）。失败则退到 **userspace
netstack**：不碰 netlink、不碰设备配置，把 tun fd 的 IP 包喂给现有 p2p udp 隧道
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

## 相关

- `wisper/docs/p2p-integration.md` — p2p 接缝评估（本文是其 tun 续篇）
- `p2p/docs/2026-09-12-p2p-hub-mode.md`（已被取代）、`p2p/docs/2026-09-13-p2p-udp-target-streams.md`
- `gost/play/p2p-tun.yaml` — tun-to-tun over p2p 的配置形状
- `p2p/CLAUDE.md`（Datagram link / UDP target outlet）、`x/listener/tun/`、`x/handler/tun/`
