# wisper 集成 p2p 的接缝评估

2026-09-21 可行性评估。结论：可集成，但 p2p 只能当**链节点底层传输**，
不能替代 wisper 反向隧道的公网 ingress/rendezvous。

> 状态：评估已完成，进程内 POC 通过；p2p 已发布 `v0.4.0` 并成为 wisper 的直接依赖；
> UDP 入口点限制已 e2e 实测（2026-09-21，见「已知限制」）。

## 接缝

- 全部隧道/入口点的传输集中在 `tunnel/tunnel.go` 的 `ChainConfig()`
  （node addr=`GetServerAddr()`，connector=`tunnel`，dialer=`wss`），是唯一接缝。
- p2p 接缝在 `x/config/parsing/node/parse.go`：node metadata `p2p` →
  `xp2p.NewTunnelDialer`，`SupportedDialer` 白名单含 tcp/tls/ws/wss/mux/udp。
- wisper 不走 x config loader，而是手搓 `xconfig.Config` 再 `chain_parser.ParseChain`；
  因此 `p2ps:` 不会自动注册，需自行
  `registry.P2PRegistry().Register(name, host.Provider())`
  （旧 gRPC 方式为 `p2p_plugin.NewGRPCPlugin(...)`）。

## 依赖与可用性

- wisper 已把 x v0.13.18→v0.17.2、core v0.5.5→v0.6.1（commit `60b29fc`），
  `x/p2p` 与 `metadata.p2p` 因此可用；**源码零改动**（wisper 自建 ChainConfig
  wrapper，不经 x 顶层 `Config.Chains` 类型变更）。x/chain、x/hop、
  x/handler/forward、x/service、x/logger 变更较大，运行时回归见
  `scripts/smoke-local-relay.sh`。
- p2p 已完成库化（根包 `package p2p` + `cmd/p2p`，见
  [p2p 库化重构计划](https://github.com/go-gost/p2p/blob/main/docs/2026-09-21-p2p-package-extraction.md)），
  并发布 `v0.4.0`；wisper `go.mod` 已直接依赖 `github.com/go-gost/p2p v0.4.0`。

## 边界与定位

- p2p 是 peer→peer 可达性，不是公网入口：DERP 只在对端 key 之间转发，
  随机公网客户端无法直连；因此不能替换 wisper “本地→公网子域名端点”的反向隧道本体。
- 合理定位：entrypoint（出站拨号）+ 新增“私有 peer-to-peer”模式
  （wisper 侧 p2p host 带 `--target` 指向本地服务，远端 gost/wisper 用 peer key
  开隧道进来）。
- p2p 数据面不加密（内层 tls/wss 负责机密性）；控制面默认无鉴权，跨机需 token +
  控制 TLS；UDP datagram 路径无内层 dialer 可加密。
- p2p engine 模式需要部署 DERP relay（官方 derper），且无名称发现，
  peer 只能按 base64 pubkey 寻址。

## 已知限制

入口点形态（本地 udp listener → local handler → chain node(p2p udp 隧道) → 对端 outlet）的
**进程内 e2e 实测结论**（`tunnel/p2p_udp_poc_test.go`，build tag `p2ppoc`：真 derper + 两个
进程内 p2p host + 与 `tunnel/entrypoint/udp.go` `Run()` 同构的栈；跑法
`cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/`）：

1. ~~**进程内 provider 缺 datagram framing**~~ —— **已修复**（p2p 本地 main `204e2d5`，未发布）：
   进程内 `Provider` 现在对 `network=udp` 的 conn 自行加 2 字节 BE 长度前缀（复用 p2p
   `frame.go` 的 `appendFrame`/`frameAt`），与 plugin 路径的 conn 形状一致。实测：修复前
   隧道拨号成功、channel 正常建立但连发 3 包全无回复；修复后同一 harness 回环成功。
   注意：需 `go.work` 模式（本地 p2p）；wisper 仍 pin `v0.4.0`，`GOWORK=off` 下是旧行为，
   待发布 `v0.4.1` 后 bump。
2. **会话首个数据报必丢（R2）**：拨号由会话首包触发，而 channel 的 peer edge 异步挂载，
   建链窗口内 `pumpLocal` 静默丢字节（p2p 设计如此：「Bytes are dropped while the opposite
   edge is absent」）。实测（加 framing shim 后）：首发丢失、同会话第二次发送即回环成功——
   50 次运行中 48 次需第 2 发、2 次第 1 发即回。
3. **keepalive=false（入口点默认）下每请求一条隧道**：udp listener 写出回复后即关会话
   （`x/internal/net/udp` 的 `if !c.keepalive { defer c.Close() }`）→ 会话关 → 隧道拆，
   每个请求-响应都重建一次隧道。
4. **多客户端互踩（R3，keepalive=true）**：每客户端一次 Dial → 同 peer 一个 channel、
   `attachLocal` last-dial-wins；channel 本身保持 up，只换 local edge（日志实测：c2 建连与
   c1 会话被取消在同一毫秒）。且帧里没有客户端身份 → 实测签名：**c2 收到 c1 的在途回复
   （串投）后再收到自己的回复，c1 什么都收不到**。

> 已证伪、勿重复排查：入口点 node addr 的 `:0` 补端口**不会**打到 p2p 的 `parsePeerKey`——
> `x/chain/route.go` 拨的是 `node.Addr`（干净 base64 key），`:0` 只补在 *target* 地址上，
> 而 `x/connector/forward` 忽略该地址。入口点形态在 p2p 下**寻址正常**。

修复方向（产品改动）：
① ~~provider conn 按 network 包 framed~~ —— **已做，落在 p2p Provider 侧**（见上，比 x 侧包
更小：不触碰 x、不会与 plugin 路径叠加成双层 framing）；② 多客户端：per-client channel，或
GOST 侧 session 多路复用（对齐 relay 协议的 udp session id 思路）；③ 首包丢失 / 每请求重建隧道：
入口点默认打开 keepalive，或 p2p 侧在 peer edge 就绪前缓冲 local edge 的字节（权衡内存与语义）。

tun 形态（p2p e2e 的 `udp-tun`/`udp-outlet`）不受上述影响：那些场景两端都走 plugin 路径且单流。

## 进程内 POC

- 走**进程内**：`p2p.New(&p2p.Config{})` + `host.Provider()` 直接
  `registry.P2PRegistry().Register`。无子进程 / 无 loopback gRPC / 无 token。
  进程外 gRPC 只在 host 必须独立进程、多进程共享、或非 Go 客户端时才需要。
- 可用性已验证：`wisper/tunnel/p2p_poc_test.go`（build tag `p2ppoc`）。
  跑法：`cd wisper && go test -tags p2ppoc -run TestP2P -v ./tunnel/`。
  p2p `v0.4.0` 起该测试在独立模式（`GOWORK=off`）下即可构建，无需 go.work。
- 两测试：`TestP2PChainCarriesTCP`（stub 模式进程内 host + echo，wisper
  ChainConfig 改 node.Addr/forward+tcp/metadata.p2p，route.Dial 成功回显）；
  `TestP2PUnregisteredFailsClosed`（未注册 provider → ParseChain 报错，无静默旁路）。
- 注册约定：`registry.P2PRegistry().Register(name, host.Provider())`；
  可加 `var _ xp2p.TunnelProvider = (*p2p.Provider)(nil)` 做编译期断言。
- UDP 入口点形态另有实测 harness：`tunnel/p2p_udp_poc_test.go`（同 tag，需 docker 提取 derper），
  跑法 `TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/`；结论见「已知限制」。

## 实施注意

- 进程内 tunnel conn 的 `LocalAddr/RemoteAddr` 必须非 nil：gost 的 forward
  connector 会 `conn.RemoteAddr().String()`，返回 nil 直接 panic。p2p 库已修
  （p2p commit `3548ec4`，合成 `streamAddr{network, addr}`）。
- `chain_parser.ParseChain(cfg, clogger.Default())` 会解引用传入的 logger；
  wisper 作为库必须在启动时 `clogger.SetDefault(xlogger.NewLogger())`，否则
  nil panic。这与 p2p 无关：进程内 `Provider` 本身不再需要全局 logger
  （gRPC 插件构造才需要）。
- POC 里需 blank-import `x/connector/forward` 与 `x/dialer/tcp`，否则
  "unregistered connector/dialer"。
