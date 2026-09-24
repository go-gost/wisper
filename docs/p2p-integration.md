# wisper 集成 p2p 的接缝评估

2026-09-21 可行性评估。结论：可集成，但 p2p 只能当**链节点底层传输**，
不能替代 wisper 反向隧道的公网 ingress/rendezvous。

> 状态：评估已完成，进程内 POC 通过；反向侧与入口点已改为共享的进程级 p2p host（p2p
> `v0.6.0`，2026-09-22，见「私有 p2p 模式」）；UDP 入口点限制已 e2e 实测（2026-09-21，
> 见「已知限制」）——**三个数据面缺陷已由 p2p `v0.6.0`（每拨号一条 datagram link）修掉**，
> wisper 侧同步支持 udp：反向侧按流服务 udp、p2p 入口点新增 `protocol: udp`
> （2026-09-23，见「UDP 支持」）。

## 接缝

- 全部隧道/入口点的传输集中在 `tunnel/tunnel.go` 的 `ChainConfig()`
  （node addr=`GetServerAddr()`，connector=`tunnel`，dialer=`wss`），是唯一接缝。
- p2p 接缝在 `x/config/parsing/node/parse.go`：node metadata `p2p` →
  `xp2p.NewTunnelDialer`，`SupportedDialer` 白名单含 tcp/tls/ws/wss/mux/udp。
- wisper 不走 x config loader，而是手搓 `xconfig.Config` 再 `chain_parser.ParseChain`；
  因此 `p2ps:` 不会自动注册，需自行
  `registry.P2PRegistry().Register(name, ep)`（`ep` 是 `*endpoint.Endpoint`，满足
  `xp2p.Tunnel`）（旧 gRPC 方式为 `p2p_plugin.NewGRPCPlugin(...)`）。

## 依赖与可用性

- wisper 已把 x v0.13.18→v0.17.2、core v0.5.5→v0.6.1（commit `60b29fc`），
  `x/p2p` 与 `metadata.p2p` 因此可用；**源码零改动**（wisper 自建 ChainConfig
  wrapper，不经 x 顶层 `Config.Chains` 类型变更）。x/chain、x/hop、
  x/handler/forward、x/service、x/logger 变更较大，运行时回归见
  `scripts/smoke-local-relay.sh`。
- p2p 已完成库化（根包 `package p2p` + `cmd/p2p`，见
  [p2p 库化重构计划](https://github.com/go-gost/p2p/blob/main/docs/2026-09-21-p2p-package-extraction.md)），
  当前发布 `v0.6.0`（contracts/endpoint/transport 分层；udp 数据面 = 每拨号一条 datagram
  link）；wisper `go.mod` 依赖 `github.com/go-gost/p2p v0.6.0`。

## 边界与定位

- p2p 是 peer→peer 可达性，不是公网入口：DERP 只在对端 key 之间转发，
  随机公网客户端无法直连；因此不能替换 wisper “本地→公网子域名端点”的反向隧道本体。
- 合理定位：entrypoint（出站拨号）+ 新增“私有 peer-to-peer”模式
  （wisper 侧进程级 p2p host，每条隧道按对端公钥路由到本地服务；远端 gost/wisper 用该
  身份公钥开隧道进来）。
- p2p 数据面不加密（内层 tls/wss 负责机密性）；控制面默认无鉴权，跨机需 token +
  控制 TLS；UDP datagram 路径无内层 dialer 可加密。
- p2p engine 模式需要部署 DERP relay（官方 derper），且无名称发现，
  peer 只能按 base64 pubkey 寻址。

## 已知限制（历史实测；p2p v0.6.0 已修 R2/R3）

入口点形态（本地 udp listener → local handler → chain node(p2p udp 隧道) → 对端 outlet）的
**进程内 e2e 实测结论**（`tunnel/p2p_udp_poc_test.go`，build tag `p2ppoc`：真 derper + 两个
进程内 p2p host + 与入口点 `Run()` 同构的栈；跑法
`cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/`）：

1. ~~**进程内 provider 缺 datagram framing**~~ —— **已修复**（p2p **`v0.4.1`**）：进程内
   provider 对 `network=udp` 的 conn 自行加 2 字节 BE 长度前缀（复用 p2p `frame.go` 的
   `appendFrame`/`frameAt`），与 plugin 路径的 conn 形状一致。
2. ~~**会话首个数据报必丢（R2）**~~ —— **已修复**（p2p **`v0.6.0`**）：数据报链路在 peer edge
   就绪前**缓冲** local edge 的字节（32 KiB 有界，超出即丢），触发拨号的那个数据报不再丢。
   实测：`TestP2PUDPBaseline` 现在要求**首次发送**即回环成功（旧 harness 的 retry 循环已删）。
3. **keepalive=false 下每请求一条隧道** —— 语义保留（每个数据报一条链路；正确但有开销）：
   p2p 入口点的表单默认勾选 keepalive=true，客户端会话（及其隧道）在数据报之间保持。
4. ~~**多客户端互踩（R3，keepalive=true）**~~ —— **已修复**（p2p **`v0.6.0`**）：每次拨号一条
   独立 link，`TestP2PUDPTwoClientsIsolated` 断言两个并发客户端各自只收到自己的回复
   （并跑第二轮证明两条链路持续独立）。

> 已证伪、勿重复排查：入口点 node addr 的 `:0` 补端口**不会**打到 p2p 的 `parsePeerKey`——
> `x/chain/route.go` 拨的是 `node.Addr`（干净 base64 key），`:0` 只补在 *target* 地址上，
> 而 `x/connector/forward` 忽略该地址。入口点形态在 p2p 下**寻址正常**。

修复落在 p2p 库侧（比改 x 更小、不触碰 x，也不会与 plugin 路径叠加成双层 framing）：模型与
决策见 p2p 仓库 `docs/2026-09-23-p2p-udp-per-dial-links.md`。tun 形态（p2p e2e 的
`udp-tun`/`udp-outlet`）不受上述影响：那些场景两端都走 plugin 路径且单流。

## UDP 支持（2026-09-23）

p2p `v0.6.0` 把 udp 数据面重写为「每拨号一条 datagram link」，wisper 侧随之支持 udp：

- **反向侧（p2p 隧道）透明服务 udp**：`Listen` 把 udp 流投递为**数据报 conn**
  （`net.PacketConn`、帧已解析、地址是对端 key），peer 路由把它交给同一条隧道 service；x 的
  local handler 用 `conn.(net.PacketConn)` 判定 udp，于是自动以 udp 拨 Endpoint 并按数据报
  转发。**无需配置**：同一条 p2p 隧道既能服务 tcp 也能服务 udp 对端。per-peer 计数与 service
  计数都保留——`tunnel/p2p_host.go` 的 `wrapConnStats` 对数据报 conn 用自带包装（x 的
  `WrapConn` 会剥掉 PacketConn 形状，让 handler 误判成 tcp）。
- **入口点（p2p）新增 `protocol` 选项**：`tcp`（默认）/ `udp`。udp 时本地监听是 udp listener
  （keepalive/ttl 生效），链节点 dialer 也是 `udp` → 隧道按数据报语义拨出。API 的
  create/update 与响应都带 `protocol`，并持久化到 `wisper.yaml`。
- **验证**：`TestP2PTunnelServesPeerDatagrams`（真 derper：udp 拨入 wisper 反向侧 → 回显 +
  per-peer 计数）、`TestP2PUDPBaseline`/`TestP2PUDPTwoClientsIsolated`（R2/R3 断言翻转）、
  `TestP2PEntryPointUDPProtocol`（listener/handler/dialer 与绑定 socket 都是 udp）、
  `TestSaveConfigKeepsPeer`（protocol 持久化往返）、`TestPeerListenerDeliversDatagramConn`
  （投递的数据报 conn 形状与计数）。跑法：
  `TMPDIR=/config/tmp DERPER_BIN=<derper> go test -tags p2ppoc ./tunnel/...`。
- **边界**：数据面仍**明文**（p2p 只做可达性，内层协议不加密）；混合拓扑（同一对端既拨 udp
  又接受本机多条 udp 拨号）不支持，见 p2p 文档的「非目标」。

## 直连打洞（2026-09-23，默认开启）

共享 host 现在**默认尝试直连**（`settings.p2p.direct`，nil = 开）：中继 session 建立后双方各
自收集候选（IPv4 走 STUN、IPv6 绑本机出口地址），经控制通道交换后同时打洞（KCP + smux），
成功则隧道流走直连、失败自动回退中继——**打洞是尽力而为，中继始终在**。反向侧与入口点共用
同一个 host，所以一处设置两边都生效。

- **STUN 地址无需配置**：`settings.p2p.stun` 留空即取**中继主机 + 3478**（derper 默认在该端口
  提供 STUN，见 `-stun-port`）；自建中继换了端口或关了 STUN 时再显式填写。没有 STUN 也不妨：
  双栈且都有全局 v6 时走 IPv6 直连（v6 不需要 STUN）。
- **推导出来的地址会先验证一次**（2026-09-23 修的坑）：**公共中继 `derp.gost.run` 不提供
  STUN**（3478/443 都不响应）。如果把这个猜测直接交给 host，每次打洞都会对着死地址等
  `stunTimeout`（3s）才失败，而**每个对端的首条流**还要等打洞有结果才回落中继——实测就是
  "连不上/很卡"。现在 `p2pHostStun` 只在推导地址**答得上来**时才启用（1.2s 一次探测，
  失败即放弃并记一条 warn 日志），失败时不打洞：`punch_attempts=0`、首字节 ~700ms、
  传输标记显示 `no-candidates`；显式填写的 STUN 则原样使用（设置页有测试按钮兜底）。
- **设置页**：P2P 区新增「直连（打洞）路径」开关与 STUN 输入；STUN 输入下面有和中继一样的
  「测试」按钮（`POST /api/p2p/test-stun`，见下）；身份区多一行实时传输统计——`GET /api/p2p`
  现在同时返回 `direct_peers`/`derp_peers`（当前各对端走哪条路）与
  `punch_attempts`/`punch_success`（本机打洞成不成）。改这两项会重建 host（重启所有 p2p
  隧道/入口点）。
- **STUN 测试**：`POST /api/p2p/test-stun` body `{"stun":"host:port"}`（留空 = 用配置/推导的
  地址），返回 `{"ok", "stun", "mapped", "latency_ms", "error"}`——`mapped` 是服务器看到的
  本机公网地址（打洞要用的映射），失败是 200 + `ok:false`（和探针语义一致：连不上是结果，
  不是请求错误）。底层是 p2p 新增的 `endpoint.StunLookup`（`internal/stun` 是 internal 包，
  wisper 引不到，且 STUN 的实现归属在 p2p）。探测用自己的 socket，报的端口是那条 socket 的
  映射，不是之后打洞那条。
- **每个对端标出当前走哪条路**（2026-09-23）：`p2p.Status` 增加 `PeerTransports`（base64
  公钥 → 状态值，无会话的对端不出现），由 engine 的 `peerTransports()` 用与计数同一套
  `live()` 规则生成（`DirectPeers`/`DerpPeers` 现在就是它的汇总）。取值：
  `direct`（打洞成功）/ `punching`（正在打洞）/ `failed`（该对端打洞失败，多是对称 NAT）/
  `derp`（中继，无阻碍）/ `disabled`（设置里关了直连）/ `no-candidates`（没配 STUN 且无
  IPv6）/ `stun-unreachable`（配了 STUN 但不响应，且没有 IPv6 兜底）——后三个是**主机级**
  原因（对每个对端一样），前四个是**对端级**状态优先。wisper 把它带进 API：tunnel 响应的
  `peer_stats[].transport`、entrypoint 响应的 `peer_transport`。UI 用
  `web-src/src/utils/transport.ts` 统一映射成图标+文案：直连=闪电（绿）、打洞中=转圈、
  打洞失败=断闪电、STUN 不可达=断云、其余中继=hub。**对端列表页**与**入口点详情页**显示徽标：
  徽标文字**只写状态**（直连/打洞中/中继，对端之间保持一致），原因（STUN 无响应、打洞失败…）
  放在 hover tooltip。**首页的 tunnel 卡片不显示**——一条隧道的多个对端可能各走各的路，一行
  概括不出来（入口点只有一个对端，卡片上仍显示）。gRPC transport 不带这个字段（proto 冻结），
  插件路径只有计数。
- **p2p v0.6.1 顺带修的**：`OpenStream` 原先在"打洞未成功"时对**每条**流都阻塞满
  `punchWaitTimeout`（生产 5s）——对打洞不可能成功的对端（对称 NAT、UDP 被封）等于每条连接
  都多等 5s。现在只有**真正发起打洞的那次调用**会等（与"让第一条连接走直连"的原意一致），
  处于 in-flight / backoff 状态时立即回退中继。
- **验证**：`TestP2PTunnelDirectPath`（tag `p2ppoc`：真 derper 开 STUN，反向往返走通后断言
  两侧 `DirectPeers >= 1`，再开第二条流断言 `streams_direct` 增长——即流量确实走直连）；
  `tunnel/p2p_test.go` 的 `TestP2PStunAddr`/`TestP2PDirect`（推导与默认值）；
  p2p 侧 `TestPunchAndWaitDoesNotStallWhenPunchCannotStart`（backoff/in-flight 不再等）。
  跑法：`TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PTunnelDirectPath -v ./tunnel/`。
- **实测**：本机回环（两进程同机、真 derper + STUN）直连可用，日志里流的 `transport=direct`；
  跨 NAT 是否成取决于网络（对称型 NAT 仍永久走中继，属预期）。

## 进程内 POC

- 走**进程内**：`endpoint.New(&p2p.Config{})` 直接
  `registry.P2PRegistry().Register`。无子进程 / 无 loopback gRPC / 无 token。
  进程外 gRPC 只在 host 必须独立进程、多进程共享、或非 Go 客户端时才需要。
- 可用性已验证：`wisper/tunnel/p2p_poc_test.go`（build tag `p2ppoc`）。
  跑法：`cd wisper && go test -tags p2ppoc -run TestP2P -v ./tunnel/`。
  p2p `v0.4.0` 起该测试在独立模式（`GOWORK=off`）下即可构建，无需 go.work。
- 两测试：`TestP2PChainCarriesTCP`（stub 模式进程内 host + echo，wisper
  ChainConfig 改 node.Addr/forward+tcp/metadata.p2p，route.Dial 成功回显）；
  `TestP2PUnregisteredFailsClosed`（未注册 provider → ParseChain 报错，无静默旁路）。
- 注册约定：`registry.P2PRegistry().Register(name, ep)`（`ep` = `*endpoint.Endpoint`）；
  可加 `var _ xp2p.Tunnel = (*endpoint.Endpoint)(nil)` 做编译期断言。
- UDP 入口点形态另有实测 harness：`tunnel/p2p_udp_poc_test.go`（同 tag，需 docker 提取 derper），
  跑法 `TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/`；结论见「已知限制」。

## 私有 p2p 模式（反向侧，已实现 2026-09-22）

wisper 新增隧道类型 `p2p`：**进程级 p2p host** 持有一份身份，入站流按 **对端公钥** 路由给
各条隧道，每条隧道由**标准 gost service**（peer 路由 listener + local handler）转发到其
**Endpoint**（本地后端地址）。不经 gost.run，也没有公网入口——定位是"私有 peer-to-peer"。

**本机身份（进程级，一份）**：首个 p2p 隧道或 p2p 入口点启动时创建
`~/.config/wisper/p2p/host.key`（0600），之后所有 p2p 隧道/入口点共用这一份身份；设置页
"P2P Identity" 显示其 base64 公钥（`GET /api/p2p`）。**身份按需物化**：即使没有任何
p2p 隧道/入口点在运行，该接口也会即时创建 `host.key` 并返回公钥（不连 relay），响应里的
`running` 字段才表示 host 是否真的启动（`running:false` + 非空 key = 已持有身份但空闲）。
因此双方**可以先把各自的本机公钥读出来再互配**——不存在"A 要先拿到 B 的 key、B 也要先拿到
A 的 key"的死结。host 以引用计数存活：最后一个使用者关闭时 host 停止，key 文件保留
（stop/start、更新对象都保持同一身份）。

**用法**：设置页（或 `config.yml` 的 `settings.p2p`）配置 `derp`（默认
`wss://derp.gost.run/derp`，可改为自建 relay）、`secure`、`caFile`；然后新建 type=`p2p`
的隧道，Endpoint = 本地服务地址。**新建时白名单留空是正常起点**（"运行但不可达"），随后在
详情页进入「允许的对端」页逐条添加（每行一条 base64 公钥，也可留空长期不加）。对端数量不限：
**N 个对端公钥 → 同一条隧道、同一个本地后端**。
详情页 `entrypoint` 行显示的就是这份列表（逗号连接；为空时显示未配置提示）——本机身份在
设置页，不在这里。

**准入即白名单**：隧道的白名单决定哪些入站流会被路由到它。白名单里的每个 key 在 host 上
注册一条路由，同一条隧道内 key 去重、且一个 key 不能出现在两条 p2p 隧道（重复即配置错误）；
入站流按 RemoteAddr（对端 base64 公钥）精确查表投递，**未登记 peer 的入站流直接关闭**——
没有 catch-all，也没有"默认隧道"。**白名单为空是合法状态**：隧道照常启动、正常出现在
列表里，但任何入站流都会被关闭（即"运行但不可达"），适合先把身份与后端配置好、之后再补
对端。对端按本机身份公钥拨入：

**对端接入**（gost；`p2ps` 可用 gRPC 插件，也可进程内注册 provider）：

```yaml
p2ps:
  - name: p2p
    plugin: {type: grpc, addr: 127.0.0.1:8003}
chains:
  - name: chain-0
    hops:
      - nodes:
          - addr: <设置页显示的本机身份公钥>
            dialer: {type: tcp}
            connector: {type: forward}
            metadata: {p2p: p2p}
```

**隧道 stats/auth/录制**：与入口点对称——都来自挂在这条 peer 路由上的标准 gost service。
连接与字节计数在 peer 路由 Accept 处按 x listener 的做法包一层（`tunnel/p2p_host.go` 的
`wrapConnStats`：tcp 流走 `stats.wrapper.WrapConn`，udp 数据报 conn 走自带包装以保留
`net.PacketConn` 形状），`runner/task/stats.go` 每秒把 `Status().Stats()` 回填进
`Tunnel.Stats()`，因此详情页的速率与其它隧道类型一致（早期"host 不暴露、详情页显示 —"
的限制已消除）。

**出站侧（p2p entrypoint）**：入口点类型 `p2p`——本地监听 + 对端 pubkey + `protocol`
（`tcp` 默认 / `udp`）。本地客户端连监听地址，流量经**同一个共享 host** 的隧道拨到对端 target
（**数据面明文**；跨公网建议后续用 tls/ws 变体）。udp 时本地监听与链节点 dialer 都是 udp，
隧道按数据报语义拨出（表单默认勾选 keepalive，会话在数据报之间保持）。对端可以是 wisper 的
反向侧 p2p 隧道，也可以是任意带 target 的 p2p host。本侧身份同样是进程级 `host.key`（不再有
per-entrypoint key）。API 语义：响应里 `endpoint` = 对端 pubkey、`entrypoint` = 本地监听地址，
`options.protocol` = 内层协议。

**生命周期与语义**：
- relay 连不上不致命：状态保持 running，engine 每 5s 重连（与 p2p CLI 一致）。
- 隧道/入口点 `Close()` 幂等：注销 peer 路由与 provider 注册、归还 host 引用；`host.key` 不动。
- **旧模型（已被取代）**：每隧道一份 `~/.config/wisper/p2p/<id>.key` 的一隧道一 host
  （带 `Config.Targets`，host 内部桥接到 target、无 service、无统计）。v0.4.2 起重构为上面的
  进程级 host + peer 路由；遗留的 per-tunnel key 文件只在删除对象时清理（API delete 路径调
  `RemoveP2PKey`）。

**安全边界**：pubkey 即地址——DERP 只在对端 key 之间转发，peer 只能按 base64 pubkey 寻址
（无名称发现）；准入即白名单——隧道只服务其白名单列表内的对端 key 的入站流，其余直接关闭
（列表为空则没有任何入站流被服务）。因此持有**白名单内**对端 key 的人就是这条隧道的对端本身
（可信方），p2p 层没有按连接的 auth。建议 relay 侧 `-verify-clients=true`，并在本地服务上
另加鉴权。

**依赖版本**：p2p `v0.6.0`（contracts/endpoint/transport 分层、每拨号一条 datagram link、
`Listen` 投递数据报 conn）与 x `v0.18.0`，wisper `go.mod` 已 bump；go.work 与 `GOWORK=off`
两种模式行为一致。

**API 与 UI**：隧道 create/update 请求与响应都带 `peers`（`[]Peer`，响应来自
`Options.Peers`）；`GET /api/p2p` → `{"public_key", "running"}` + 直连/中继统计（见「直连
打洞」）；`PUT /api/tunnels/{id}/peers` 只改白名单（含每项的 `disabled`）。白名单有独立的
「允许的对端」页（详情页进入）：默认只读、公钥按字符掩码显示（顶栏眼睛图标整页揭示），一次
编辑一行，删除需确认；每行一个停止/播放按钮切换启用状态（见「对端开关」）；未配置时显示
"没有入站流量能到达"的提示。设置页身份区以 `running` 区分"空闲（已持有身份）"与"运行中
（显示 key）"。

**白名单就地生效**：保存不再重建隧道。`p2pHostManager.reconcile` 在进程级路由表里一次性完成
增删（全有或全无——与其它隧道冲突的 key 会让整次改动被拒绝并返回 409），同一个
`peerListener` 继续服务，因此在线的对端流不断；被移除的对端不再接入**新**流，其计数器随行消失
（key 再次加入从零开始）。`PeerSetter` 是这个能力的接口；`unregister` 改为按 listener 身份
注销（不再按 key 列表比对），因此陈旧注销不会误删他人路由。

**对端开关（2026-09-23）**：白名单里的 key 可以**单独禁用**。禁用不是移除：key 仍留在
`Peers`（和对端页）里，只是不再持有路由、也不预热——它的新流被关闭、已建立的流自然结束，
重新启用不需要重新输入公钥。落点：`config.Tunnel.PeerDisabled` / `Options.PeerDisabled`；
`NormalizePeerDisabled` 只保留仍在白名单里的 key（从白名单移除的 key 不会以禁用状态残留，
再次加入时是启用的），`enabledPeers` 产出真正建路由与预热的那份列表——
`register`/`reconcile`/`warmPeers` 一律用启用集合，`Peers` 保持完整（对端页与 `peer_stats`
仍按完整白名单出行）。API：`peers` 每项带 `disabled`（create 与 `PUT /api/tunnels/{id}/peers`
都接受），响应 `omitempty` 省略 `false`。UI：行上的停止/播放按钮就地切换（走同一条 `PUT`，
仍不重建隧道），禁用行显示「已禁用」徽标、整行压暗，transport 徽标让位给状态徽标。
**验证**：`tunnel/p2p_test.go` 的 `TestPeerDisabled`（规范化与启用集合）与
`TestSaveConfigKeepsPeers`（白名单/别名/开关经 `wisper.yaml` 往返，含 yaml 键）、
`api/api_test.go` 的 `TestPeerAliasesFlow`（响应带 `disabled`）与
`TestUpdateP2PTunnelPeers`（禁用段：两个 key 都留在列表、只有被禁的那个带标记、
`Options().PeerDisabled` 落到隧道对象）。

**验证**：`tunnel/p2p_test.go`（空白名单运行、生命周期、白名单 1/N 条、跨隧道重复 key、
TLS 配置/默认 relay，无网络）、
`tunnel/p2p_host_test.go`（引用计数、路由 1:1 与白名单批量注册、未登记 peer 关闭、就地
reconcile 的增删/计数器清理/冲突整拒）与
`tunnel/p2p_e2e_test.go`（tag `p2ppoc`：真 derper；`TestP2PTunnelAcceptsPeerByKey` 白名单
内的对端按身份公钥拨入回环并断言服务实时计数非零；`TestP2PTunnelRefusesUnlistedPeer` 同场
对照——白名单内的对端可回环，白名单外的 host 拨入拿不到任何回复/被关闭；跑法
`TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PTunnel -v ./tunnel/`）；API 级
（`api/api_test.go` 的 `TestUpdateP2PTunnelPeers` 断言保存前后隧道对象同一，即未重建）；curl
已验证 create/list/delete + `/api/p2p` 身份与 `running` 往返 + `peers` 回显 + `host.key`
0600；**浏览器内的 UI 视觉与交互尚未人工过一遍**（按行编辑/掩码与揭示/删除确认/对端开关/
设置页空闲态）。

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
