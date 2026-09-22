# wisper 集成 p2p 的接缝评估

2026-09-21 可行性评估。结论：可集成，但 p2p 只能当**链节点底层传输**，
不能替代 wisper 反向隧道的公网 ingress/rendezvous。

> 状态：评估已完成，进程内 POC 通过；反向侧与入口点已改为共享的进程级 p2p host（p2p
> `v0.4.2`，2026-09-22，见「私有 p2p 模式」）；UDP 入口点限制已 e2e 实测（2026-09-21，
> 见「已知限制」）。

## 接缝

- 全部隧道/入口点的传输集中在 `tunnel/tunnel.go` 的 `ChainConfig()`
  （node addr=`GetServerAddr()`，connector=`tunnel`，dialer=`wss`），是唯一接缝。
- p2p 接缝在 `x/config/parsing/node/parse.go`：node metadata `p2p` →
  `xp2p.NewTunnelDialer`，`SupportedDialer` 白名单含 tcp/tls/ws/wss/mux/udp。
- wisper 不走 x config loader，而是手搓 `xconfig.Config` 再 `chain_parser.ParseChain`；
  因此 `p2ps:` 不会自动注册，需自行
  `registry.P2PRegistry().Register(name, host.Tunnel())`
  （旧 gRPC 方式为 `p2p_plugin.NewGRPCPlugin(...)`）。

## 依赖与可用性

- wisper 已把 x v0.13.18→v0.17.2、core v0.5.5→v0.6.1（commit `60b29fc`），
  `x/p2p` 与 `metadata.p2p` 因此可用；**源码零改动**（wisper 自建 ChainConfig
  wrapper，不经 x 顶层 `Config.Chains` 类型变更）。x/chain、x/hop、
  x/handler/forward、x/service、x/logger 变更较大，运行时回归见
  `scripts/smoke-local-relay.sh`。
- p2p 已完成库化（根包 `package p2p` + `cmd/p2p`，见
  [p2p 库化重构计划](https://github.com/go-gost/p2p/blob/main/docs/2026-09-21-p2p-package-extraction.md)），
  当前发布 `v0.4.2`（`Tunnel.Listen()`/`Dial` API、进程内 udp framing 修复）；wisper `go.mod` 依赖 `github.com/go-gost/p2p v0.4.2`。

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

## 已知限制

入口点形态（本地 udp listener → local handler → chain node(p2p udp 隧道) → 对端 outlet）的
**进程内 e2e 实测结论**（`tunnel/p2p_udp_poc_test.go`，build tag `p2ppoc`：真 derper + 两个
进程内 p2p host + 与 `tunnel/entrypoint/udp.go` `Run()` 同构的栈；跑法
`cd wisper && TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/`）：

1. ~~**进程内 provider 缺 datagram framing**~~ —— **已修复**（p2p 本地 main `204e2d5`，未发布）：
   进程内 `Provider` 现在对 `network=udp` 的 conn 自行加 2 字节 BE 长度前缀（复用 p2p
   `frame.go` 的 `appendFrame`/`frameAt`），与 plugin 路径的 conn 形状一致。实测：修复前
   隧道拨号成功、channel 正常建立但连发 3 包全无回复；修复后同一 harness 回环成功。
   已随 p2p **`v0.4.1`** 发布并 bump；go.work 与 `GOWORK=off` 两种模式行为一致。
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

- 走**进程内**：`p2p.New(&p2p.Config{})` + `host.Tunnel()` 直接
  `registry.P2PRegistry().Register`。无子进程 / 无 loopback gRPC / 无 token。
  进程外 gRPC 只在 host 必须独立进程、多进程共享、或非 Go 客户端时才需要。
- 可用性已验证：`wisper/tunnel/p2p_poc_test.go`（build tag `p2ppoc`）。
  跑法：`cd wisper && go test -tags p2ppoc -run TestP2P -v ./tunnel/`。
  p2p `v0.4.0` 起该测试在独立模式（`GOWORK=off`）下即可构建，无需 go.work。
- 两测试：`TestP2PChainCarriesTCP`（stub 模式进程内 host + echo，wisper
  ChainConfig 改 node.Addr/forward+tcp/metadata.p2p，route.Dial 成功回显）；
  `TestP2PUnregisteredFailsClosed`（未注册 provider → ParseChain 报错，无静默旁路）。
- 注册约定：`registry.P2PRegistry().Register(name, host.Tunnel())`；
  可加 `var _ xp2p.Tunnel = (*p2p.Tunnel)(nil)` 做编译期断言。
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
的隧道，填「允许的对端」（Allowed peers，每行一个 base64 公钥，**可留空**）与
Endpoint = 本地服务地址。对端数量不限：**N 个对端公钥 → 同一条隧道、同一个本地后端**。
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
连接与字节计数在 peer 路由 Accept 处按 x listener 的做法包一层
（`stats.wrapper.WrapConn`），`runner/task/stats.go` 每秒把 `Status().Stats()` 回填进
`Tunnel.Stats()`，因此详情页的速率与其它隧道类型一致（早期"host 不暴露、详情页显示 —"
的限制已消除）。

**出站侧（p2p entrypoint）**：入口点类型 `p2p`——本地监听 + 对端 pubkey。本地客户端连
监听地址，流量经**同一个共享 host** 的隧道拨到对端 target（内层 `tcp`，**数据面明文**；跨公网
建议后续用 tls/ws 变体）。对端可以是 wisper 的反向侧 p2p 隧道，也可以是任意带 target 的
p2p host。本侧身份同样是进程级 `host.key`（不再有 per-entrypoint key）。API 语义：响应里
`endpoint` = 对端 pubkey、`entrypoint` = 本地监听地址。

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

**依赖版本**：p2p `v0.4.2`（`Tunnel.Listen()`/`Dial` API、进程内 udp framing 修复）与
x `v0.18.0`，wisper `go.mod` 已 bump；go.work 与 `GOWORK=off` 两种模式行为一致。

**API 与 UI**：隧道 create/update 请求与响应都带 `peers`（`[]string`，响应来自
`Options.Peers`）；`GET /api/p2p` → `{"public_key": "...", "running": bool}`。详情页
p2p 隧道用「允许的对端」多行输入（每行一个 key），未配置时显示"没有入站流量能到达"的提示；
设置页身份区以 `running` 区分"空闲（已持有身份）"与"运行中（显示 key）"。

**验证**：`tunnel/p2p_test.go`（空白名单运行、生命周期、白名单 1/N 条、跨隧道重复 key、
TLS 配置/默认 relay，无网络）、
`tunnel/p2p_host_test.go`（引用计数、路由 1:1 与白名单批量注册、未登记 peer 关闭）与
`tunnel/p2p_e2e_test.go`（tag `p2ppoc`：真 derper；`TestP2PTunnelAcceptsPeerByKey` 白名单
内的对端按身份公钥拨入回环并断言服务实时计数非零；`TestP2PTunnelRefusesUnlistedPeer` 同场
对照——白名单内的对端可回环，白名单外的 host 拨入拿不到任何回复/被关闭；跑法
`TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PTunnel -v ./tunnel/`）；API 级（curl）
已验证 create/list/delete + `/api/p2p` 身份与 `running` 往返 + `peers` 回显 + `host.key`
0600；**浏览器内的 UI 视觉与交互尚未人工过一遍**（多行对端输入/设置页空闲态/详情页列表）。

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
