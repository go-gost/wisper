# p2p UDP 入口点限制验证设计（进程内 e2e）

> 2026-09-21。承接 [p2p-integration.md](../../../docs/p2p-integration.md) 的「已知限制」：
> UDP 是每 peer 一个 channel、last-dial-wins，多并发 UDP 流的入口点会互踩，需 e2e 验证。
> 本文只做**验证**：不改产品代码，产出精确的行为签名与修复方向。

## Context（背景）

wisper 的下一步（p2p entrypoint / 私有 p2p 模式）都建立在「udp 隧道能否承载入口点形态」之上。
静态读代码已得到三个候选缺陷，本设计用 e2e 证实/证伪：

0. ~~**入口点形态的寻址接缝不通**~~（**已证伪**，见第三次修订）：`local` handler 对非 host:port 的 node addr 补 `:0`
   （[x/handler/forward/local](https://github.com/go-gost/x/blob/v0.17.2/handler/forward/local/forward.go)），
   而 p2p 的 `parsePeerKey` 要求整个 peer 字符串就是 base64 key
   （[p2p/engine.go](https://github.com/go-gost/p2p/blob/v0.4.0/engine.go)）→ 裸 pubkey 变 `<pubkey>:0`，
   隧道拨号在 `parsePeerKey` 处失败。入口点要在 p2p 下寻址，需要修 handler 的补端口、
   或让 tunnel dialer 从 metadata 取 peer（而非 addr）。
1. ~~**进程内 provider 的 udp conn 缺 framing**~~（**已修复**，见第四次修订）：gRPC plugin 路径返回
   [x/p2p/streamconn](https://github.com/go-gost/x/blob/v0.17.2/p2p/streamconn/conn.go)（`network=="udp"` 时自动 framed，
   2 字节 BE 长度前缀），而进程内 `p2p.Provider` 返回 p2p 自己的 raw `streamConn`
   （[p2p/provider.go](https://github.com/go-gost/p2p/blob/v0.4.0/provider.go)），无 framing。
   outlet 侧（p2p host 的 `serveTargetStream`，见 [p2p/dgram.go](https://github.com/go-gost/p2p/blob/v0.4.0/dgram.go)）
   按 framed 解析 peer edge → 进程内 udp 路径疑似直接不可用。
2. **多客户端碰撞**：`x/dialer/udp` 每次 Dial 都经 base 拨一次
   （[x/dialer/udp](https://github.com/go-gost/x/blob/v0.17.2/dialer/udp/dialer.go)），
   `tunnelDialer.Dial` 每次新建 `tunnelBaseDialer`
   （[x/p2p/tunnel_dialer.go](https://github.com/go-gost/x/blob/v0.17.2/p2p/tunnel_dialer.go)）→ 每个 UDP 客户端开一条新隧道；
   p2p 侧同 peer 仅一个 channel、`attachLocal` last-dial-wins（[p2p/udp.go](https://github.com/go-gost/p2p/blob/v0.4.0/udp.go)）
   → 新客户端疑似顶掉旧客户端的隧道。入口点的 udp listener 按客户端地址会话化
   （[x/internal/net/udp](https://github.com/go-gost/x/blob/v0.17.2/internal/net/udp/listener.go)），因此每个客户端一次 Handle、一次 Dial。

## 目标与非目标

- 目标：给出入口点形态（本地 udp listener → 本地 handler → chain node(p2p udp 隧道) → 对端 outlet）
  在 1 客户端 / 2 并发客户端下的**实测行为签名**，并把结论写回 p2p-integration.md。
- 非目标：不修产品代码；不做跨机 / NAT 真实性验证（本问题不需要）；不做 tun 形态（已由 p2p e2e 覆盖）。

## Harness（`tunnel/p2p_udp_poc_test.go`，build tag `p2ppoc`）

- **derper**：从本地 `gogost/derper` 镜像提取二进制（`docker create` + `docker export`，
  复用缓存目录）；测试内用 Go 生成 127.0.0.1 自签证书；启动参数照搬
  [p2p/tests/e2e/run.sh](https://github.com/go-gost/p2p/blob/v0.4.0/tests/e2e/run.sh) 的 `start_derper`：
  `-c <json> -hostname 127.0.0.1 -certmode manual -certdir <dir> -a 127.0.0.1:<高位端口> -http-port -1 -stun=false`。
  高位端口免 root；`-stun=false` + host `Direct=false` 避免打洞抖动。
  docker 或 derper 二进制不可用 → `t.Skip`。
- **对端 host B（outlet）**：进程内 `p2p.New{Derp: wss://127.0.0.1:<port>/derp, KeyHex, Direct:false, TLS.Secure:false, Targets:["udp://<echo>"]}` → `Connect()`。
- **拨出 host A**：进程内 `p2p.New{同上}` → `Connect()`；
  `registry.P2PRegistry().Register(name, A.Provider())`。
- **入口点栈**（镜像 [tunnel/entrypoint/udp.go](../../../tunnel/entrypoint/udp.go) `Run()` 的接线，
  因 entrypoint 内部 chain 不可注入，故测试内同构复刻并在注释标明）：
  `tunnel.ChainConfig()` 打补丁（node addr = B 的 pubkey，`dialer: udp`，`connector: forward`，
  `metadata.p2p = name`）→ `chain_parser.ParseChain` → `udp.NewListener` + `local.NewHandler(Router)`
  + `hop.NewHop(Node(name, B pubkey))` → `xservice.NewService`。
- **UDP echo 后端**：一个本地 UDP socket 回显收到的报文。

## 实验矩阵

| Run | 配置 | 观测点 |
|---|---|---|
| R0 | provider 原样（无 shim），1 客户端 | 拨号成功、channel 建立，但无回复 → framing 缺失（寻址假设已证伪，见第三次修订） |
| ~~R1~~ | 已退休：与 R0 机制相同（寻址 shim 是 no-op），合并进 R0 | — |
| R2 | 加 **framing shim**（用 `x/p2p/streamconn.New` 把 provider conn 包成 udp framed，模拟插件路径的 conn），1 客户端 | 数据面正确基线；证明 R0 的失败归因于 framing 而非其他 |
| R3 | 同 R2，2 个并发客户端（不同源端口、不同 payload；echo 延迟 500ms 制造重叠） | last-dial-wins 签名：client 1 在途回复是否被顶掉、是否错投给 client 2（帧无客户端身份） |

判定规则：R2 若也不通，说明 shim 假设错误 → 停止、回到静态分析重新定位（不硬写断言）。

## 第一次实测修订（2026-09-21，Task 2 执行中发现）

R2 基线首跑失败（4/4 复现）。按判定规则回到静态分析，定位到 harness 假设之外的真实行为，
矩阵据此修订：

- **会话首个数据报必丢**：tunnel 拨号由会话首包触发，而 channel 的 peer edge 是异步挂载的，
  `pumpLocal` 在对端 edge 缺席时静默丢字节（[p2p/udp.go](https://github.com/go-gost/p2p/blob/v0.4.0/udp.go)
  的「Bytes are dropped while the opposite edge is absent」）。实测：首发丢失；同会话第二次
  发送即回环成功（channel 已挂上）。
- **keepalive=false（入口点默认）下每个请求-响应后会话即关**：udp listener 写出回复后
  `if !c.keepalive { defer c.Close() }`
  （[x/internal/net/udp](https://github.com/go-gost/x/blob/v0.17.2/internal/net/udp/listener.go)）
  → 会话关 → 隧道拆 → **每请求一条新隧道**（channel refs 归零即拆）。
- 修订后矩阵（第二次修订见下）：
  - **R2 基线**（默认 keepalive=false）= 重试循环：首包在建链窗口被丢、重试后回环成功，
    并记录「第几次发送才拿到回复」的分布（量化首包丢失）；
  - **R1**（默认形态）= 连发 3 次仍无回复（channel 已通，归因 framing）；
  - **R3**（**keepalive=true**）= c1 重试 warm 后在途请求（echo 延迟 500ms）+ c2 顶替 local edge →
    c2 收到 c1 的在途回复（帧无客户端身份，串投）与自己的回复，c1 无回复。

## 第二次实测修订（2026-09-21，R2 warm-up 变体）

warm-up + 单次测量包仍 ~1.4% 抖动（145 次 2 败）：当 warm-up 首包**赢**了建链竞态而直接回环时，
其回复即关会话（keepalive=false）→ 隧道拆 → 测量包成为新会话首包 → 又被丢。修正：

- R2 改为**重试循环**（预算内反复发送直到拿到回复），两种竞态结果都被吸收，
  并顺带产出首包丢失的量化签名（实测 50 次：48 次需第 2 发，2 次第 1 发即回）。
- R3 改用 **keepalive=true**：默认形态下每个回复都拆隧道，不存在可供碰撞的常驻状态；
  keepalive=true 是入口点暴露的合法 listener 选项（API `keepalive`），碰撞因此可干净测量。
  默认形态下的碰撞表现为「每次新请求重建隧道并顶掉对方」（由 R2 的分布与 host 日志佐证）。

## 第三次实测修订（2026-09-21，R0 寻址假设）

R0 首跑**未复现**寻址缺陷：日志显示 `dial <key>:0/udp` 成功、`channel up` 建立、仅无回复。
源码定位：`x/chain/route.go` 解析并拨的是 **`node.Addr`**（干净的 base64 key），
`x/handler/forward/local` 的 `:0` 只补在 *target* 地址上，而 `x/connector/forward` 完全忽略该地址
（`Connect` 只记日志、原样返回 conn）。结论：

- 入口点形态在 p2p 下**寻址没问题**（与 tun 形态一致）；原候选缺陷 0 撤回。
- 原 R0 与原 R1 机制相同 → 合并为 R0（provider 原样）；`stripPortProvider` 删除（从未改变行为）。
- 文档（Task 6）须写明这是一条**被证伪**的假设，避免后人重复排查。

## 第四次修订（2026-09-21，framing 修复落地）

候选缺陷 1 已在 p2p 侧修复（本地 main `204e2d5`，未发布）：`Provider` 对 `network=udp` 的 conn
自行 framing（复用 `frame.go` 的 `appendFrame`/`frameAt`），与 plugin 路径对齐。矩阵据此收敛：

- 原 R0（原样）与原 R2（framing shim）合并为**唯一 baseline**（`TestP2PUDPBaseline`，`wrap=nil`）：
  修复前 R0 无回复、R2 靠 shim 回环；修复后二者等价（实测 3× 通过，回复需 2 发）。
- `framedProvider` shim 删除——它会与 Provider 的 framing 叠加成双层（echo 原样回显下自抵消，
  真实后端会多收到 2 字节内层前缀）。
- R3 改为 `wrap=nil`（keepalive=true 不变），签名不变：c2 收到 c1 的在途回复 + 自己的，c1 无回复。
- 版本策略：先用 `go.work` 模式开发；`v0.4.1` tag 与 wisper bump 待定。

## 产出

- 可复跑测试：R0/R3 断言**实测签名**并注明「修复落地后应反转」；R2 断言基线通过。
- [p2p-integration.md](../../../docs/p2p-integration.md) 「已知限制」一节改写：实测签名 +
  修复方向（① x 侧把 provider conn 按 network 包 framed；② 多客户端需 per-client channel
  或 GOST 侧 session 多路复用，对齐 relay 协议的 udp session id 思路；寻址无需改动，见第三次修订）。
- 产品代码零改动。

## 风险

- derper 在本地跑高位端口依赖 docker 提取二进制；无 docker 的机器上测试 skip（与 p2p e2e 同策略）。
- R3 的碰撞签名可能有多态（顶掉 / 错投 / 部分可用），测试按实测记录，不预设单一形态。
- R0 的失败点已定位为 framing（`channel up` 已建立、无回复），不再是未知项。
