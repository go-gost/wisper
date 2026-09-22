# p2p 入站流交给 embedder（Tunnel.Listen / Dial）+ wisper 反向侧改造

> 2026-09-22。承接 [出站侧](2026-09-22-wisper-p2p-entrypoint-design.md)：
> 反向侧当前用 `Config.Targets`（host 自己桥 target）→ 拿不到 conn、没有流量统计、
> 且因 target 池按流 round-robin 而被迫"一隧道一 host"。本设计把**入站流以 conn 交给 embedder**，
> p2p 退化为纯传输（两个方向对称），并把"一 host 多隧道"收口进来。
> 本设计**取代** [私有 p2p 模式（反向侧）](2026-09-22-wisper-private-p2p-mode-design.md) 的
> "一隧道一 host + Targets"部分；其余（key 生命周期、安全边界、relay 语义）继续有效。

## 目标与非目标

- 目标：p2p 提供 `Tunnel.Listen()`（入站 peer 流，conn 的 `RemoteAddr()` 携带 peer key）；
  wisper 用**进程级 host**（一份身份/一条 DERP 连接）+ 按 peer key 路由到各隧道；
  每条隧道一个标准 gost service（`Listen()` 作 listener + `local` handler → 后端）→
  **stats / auth / 录制免费**，与 entrypoint 完全对称。
- 非目标：udp 入站流的 Listen（datagram framing 语义另议，留后续）；一条隧道多后端；
  p2p 的 DERP/直连机制不变。**一条隧道多 peer（白名单列表）已纳入范围**。

## p2p 侧 API（契约，发 `v0.4.2`）

> 命名（2026-09-22 修订）：**`Tunnel` 是唯一对外的传输接口** —— `Dial` / `Listen` / `Close`，
> 与 `net` 包一致；`Host` 只负责生命周期（New/Connect/PublicKey/Close）。因此 `Provider` 改名
> **`Tunnel`**、`Provider.OpenTunnelStream` 改名 **`Dial`**、原计划的 `Host.Listen` 移到 **`Tunnel.Listen`**。
> 这要求 x 的 `xp2p.TunnelProvider` 接口同步改名 **`Tunnel`**（结构化匹配是唯一纽带），
> 见 `x/docs/plans/2026-09-22-p2p-provider-dial-rename.md`：**x 先改发版 → p2p 跟随 → wisper bump**。

```go
// Listen returns a listener over inbound peer tunnel streams. Each accepted
// conn's RemoteAddr() carries the peer's base64 public key (Network() "p2p");
// LocalAddr() carries the host's own key. Streams arriving while the backlog
// is full are dropped (lossy, like the datagram channel). It is mutually
// exclusive with Config.Targets: with targets configured the host bridges
// internally (the CLI behaviour) and Listen returns an error.
func (t *Tunnel) Listen() (net.Listener, error)
```

- 合成地址与既有 `streamAddr` 同款：`Network() = "p2p"`、`String() = <base64 key>`。
- **不需要新增计数 API**：Listen 模式下 host 不碰数据，字节/连接统计由持有 conn 的 embedder
  （wisper 的 gost service）负责；CLI/Targets 模式行为不变（统计仍无，记为已知）。
- backlog 容量固定（如 64），满则丢弃并计数日志；文档写明。

## wisper 侧

### 进程级 host manager（新）

- 一个进程一份身份：key 文件 `<config>/wisper/p2p/host.key`（0600）；`Listen()` 的 accept 循环
  由 manager 独占消费。
- **引用计数**：第一条 p2p 隧道 `Run()` 时启动（host + DERP 连接），最后一条 `Close()` 时关闭。
- 对端身份路由：每条隧道声明 `Peers []string`（**入站白名单列表**）。入站 conn 的
  `RemoteAddr()` → 查表 → 投递到该隧道的内部 listener（per-tunnel 队列，容量有界，满则丢 + 日志）。
  - **空列表 = 不路由任何流量**（隧道可运行、身份照常展示，但没有入站流会被投递；不是兜底路由）。
  - 未在白名单内的 peer → 直接关闭 + 日志。
  - 同一 peer key 出现在两条隧道的白名单 → `Run()` 报错（每个 peer 只能属于一条路由）。
  - 允许 N:1：多条 peer 共享同一后端。
- **身份按需物化**：`GET /api/p2p` 在 host 未运行时用 `p2p.New(...)` + `PublicKey()` + `Close()`
  **就地生成/读取 key 并返回 pubkey**（`New` 无网络 I/O，不建 DERP 连接）——双方先互换 key 再配置，
  消除"配置 A 需要 B 的 key、配置 B 需要 A 的 key"的先后死结。
- manager 暴露 `PublicKey()` 给 API/UI（设置页展示"本机 p2p 身份"）。

### 隧道（反向侧）改造

- `p2pTunnel.Run()`：不再 `p2p.New{Targets: ...}`；改为 manager.acquire()（拿 host + 内部 listener）
  → `xservice.NewService(name, listener, local.NewHandler(hop=Endpoint))` → `go Serve()`。
  这就是 entrypoint 的接线去掉 chain ✓。
- `Endpoint()` = 本地后端地址；`Entrypoint()` = **对端 pubkey**（隧道页展示"这条链路对端的地址"；
  本机身份 pubkey 上移到设置页）——与入口点的 `Endpoint()`=peer、`Entrypoint()`=本地监听 互为镜像。
- 旧 per-tunnel key（`p2p/<tunnel-id>.key`）：不再使用；删除隧道时的清理逻辑保留（清遗留文件）。
- 字段：反向侧隧道用 `Options.Peers []string`（白名单，可为空）；入口点保留 `Options.Peer string`
  （必填，拨出目标）——两个字段语义不同，文档写清。

### API / UI

- 设置页：新增"P2P 身份"区（host pubkey + 复制；按需物化，永远可见）。
- 隧道详情/表单：**Peers 白名单**（多行输入，每行一个 key；详情页列表展示）；列表为空时提示
  "未配置对端，不会有流量进入"；移除"本机 pubkey 显示在隧道页"的旧行为。
- entrypoint 侧不变（其 `peer` 字段语义本就一致）。

## 安全

- 白名单即准入：未登记 peer 的入站流一律关闭；host pubkey 公开可分享（它就是"地址"）。
- key 文件 0600（host.key）、不进 config.yml；relay 侧 `-verify-clients` 仍是运营者杠杆。
- 数据面仍明文（内层 tcp），与既有说明一致。

## 测试

1. p2p：`TestHostListen`（两个 in-process host + 测试 relay：A `OpenStream`/Provider 拨 B，B 的
   `Listen()` 收到 conn，`RemoteAddr()` = A 的 base64 key；回环字节）；`TestListenRequiresNoTargets`
   （设了 Targets 再 Listen → 错误）；backlog 满丢流（用小 backlog）。
2. wisper：
   - 单测：manager 引用计数（acquire/release）、peer 路由（登记/未登记/重复）；
   - e2e（tag `p2ppoc`）：wisper p2p 隧道（`Peer` = 对端 key）+ 对端 host 拨入 → 回环成功
     **且隧道 stats 非零**（本设计的核心收益，必须断言）；
   - 既有两个 e2e（按 key 拨入 / entrypoint 拨出）改造后仍需通过。
3. UI 手动：设置页身份区、隧道表单 peer 字段、对端拨入。

## 交付物与分期

1. **p2p**：`Tunnel.Listen()` + 互斥校验 + 测试 → 发 `v0.4.2` → wisper bump；
2. **wisper**：host manager（refcount + 路由）+ p2p 隧道改用 `Listen()` + 设置页身份区 +
   隧道 peer 字段 + 文档更新（p2p-integration.md 反向侧一节改写）。
