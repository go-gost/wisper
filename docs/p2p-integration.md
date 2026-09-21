---
title: wisper 集成 p2p 的接缝评估
type: note
tags: [wisper, p2p, architecture, evaluation]
---

# wisper 集成 p2p 的接缝评估

2026-09-21 可行性评估。结论：可集成，但 p2p 只能当**链节点底层传输**，
不能替代 wisper 反向隧道的公网 ingress/rendezvous。

## Observations
- [fact] wisper 已把 x v0.13.18→v0.17.2、core v0.5.5→v0.6.1（commit `60b29fc`），x/p2p 与 `metadata.p2p` 因此可用；**源码零改动**（wisper 自建 ChainConfig wrapper，不经 x 顶层 Config.Chains 类型变更）。但 x/chain、x/hop、x/handler/forward、x/service、x/logger 变更较大，**运行时回归仍未做**（手动 http/tcp/udp/file 冒烟）。
- [fact] wisper 不走 x config loader，而是手搓 `xconfig.Config` 再 `chain_parser.ParseChain`；因此 `p2ps:` 不会自动注册，需自行 `registry.P2PRegistry().Register(name, host.Provider())`（旧 gRPC 方式为 `p2p_plugin.NewGRPCPlugin(...)`）
- [fact] 全部隧道/入口点的传输集中在 `tunnel/tunnel.go` 的 `ChainConfig()`（node addr=`GetServerAddr()`，connector=`tunnel`，dialer=`wss`），是唯一接缝
- [gotcha] p2p host 已完成库化（根包 `package p2p` + `cmd/p2p`，见 [[p2p-engine-extraction-plan]]），可 `import`；但**已发布的 v0.2.0 根包仍是 package main**——在 p2p 发新版前，wisper 只能用 go.work 指向本地 p2p，不能写进 go.mod
- [fact] p2p 接缝在 `x/config/parsing/node/parse.go`：node metadata `p2p` → `xp2p.NewTunnelDialer`，`SupportedDialer` 白名单含 tcp/tls/ws/wss/mux/udp
- [decision] p2p 是 peer→peer 可达性，不是公网入口：DERP 只在对端 key 之间转发，随机公网客户端无法直连；因此不能替换 wisper “本地→公网子域名端点”的反向隧道本体
- [fact] p2p 的合理定位：entrypoint（出站拨号）+ 新增“私有 peer-to-peer”模式（wisper 侧 p2p host 带 `--target` 指向本地服务，远端 gost/wisper 用 peer key 开隧道进来）
- [gotcha] UDP 是每 peer 一个 channel、last-dial-wins（`p2p/udp.go` 的 `attachLocal`），为 tun/outlet 设计；多并发 UDP 流的入口点会互踩，需 e2e 验证
- [fact] p2p 数据面不加密（内层 tls/wss 负责机密性）；控制面默认无鉴权，跨机需 token + 控制 TLS；UDP datagram 路径无内层 dialer 可加密
- [fact] p2p engine 模式需要部署 DERP relay（官方 derper），且无名称发现，peer 只能按 base64 pubkey 寻址

## TCP POC (done 2026-09-21, 改为进程内)
- [decision] 走**进程内**:`p2p.New(&p2p.Config{})` + `host.Provider()` 直接
  `registry.P2PRegistry().Register`。无子进程 / 无 loopback gRPC / 无 token。
  进程外 gRPC 只在 host 必须独立进程、多进程共享、或非 Go 客户端时才需要。
- [fact] 可用性已验证:`wisper/tunnel/p2p_poc_test.go`(build tag `p2ppoc`)。
  跑法:`cd wisper && go test -tags p2ppoc -run TestP2P -v ./tunnel/`
  (wisper 在 go.work 中直接对本地 `x/p2p` 与本地 p2p 库构建,无需升 pin)。
- [fact] 两测试:`TestP2PChainCarriesTCP`(stub 模式进程内 host + echo,wisper
  ChainConfig 改 node.Addr/forward+tcp/metadata.p2p,route.Dial 成功回显);
  `TestP2PUnregisteredFailsClosed`(未注册 provider → ParseChain 报错,无静默旁路)。
- [convention] wisper 注册 provider:`registry.P2PRegistry().Register(name, host.Provider())`;
  可加 `var _ xp2p.TunnelProvider = (*p2p.Provider)(nil)` 做编译期断言。
- [gotcha] 进程内 tunnel conn 的 `LocalAddr/RemoteAddr` 必须非 nil:gost 的 forward
  connector 会 `conn.RemoteAddr().String()`,返回 nil 直接 panic。p2p 库已修
  (p2p commit `3548ec4`,合成 `streamAddr{network, addr}`)。
- [gotcha] `chain_parser.ParseChain(cfg, clogger.Default())` 会解引用传入的 logger;
  wisper 作为库必须在启动时 `clogger.SetDefault(xlogger.NewLogger())`,否则 nil panic。
  这与 p2p 无关:进程内 `Provider` 本身不再需要全局 logger(gRPC 插件构造才需要)。
- [gotcha] POC 里需 blank-import `x/connector/forward` 与 `x/dialer/tcp`,否则
  "unregistered connector/dialer"。
- [blocker] 正式接入前仍需决策:wisper pin `x v0.13.18`(<0.17,无 `x/p2p` 与
  `metadata.p2p`);当前 POC 靠 go.work 用本地 x。正式化需升 x,或明确固定用 go.work。

## Relations
- relates_to [[p2p-data-plane-seam]]
- relates_to [[p2p-engine-extraction-plan]]
- relates_to [[p2p-play-configs-need-metadata-p2p]]
- relates_to [[p2p-derp-relay-done]]
