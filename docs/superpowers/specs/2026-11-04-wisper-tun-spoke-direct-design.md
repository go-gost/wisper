# wisper tun spoke 直连与本地入站访问控制设计

日期：2026-11-04 | 状态：draft 待 review | 范围：tun spoke-hub 模式下 spoke 之间的成员 tun IP 流量

## 1. 理解与目标

用户所说：目前 tun spoke-hub 模式里，spoke A 到 spoke B 的流量必须经过 hub（A 的 p2p 流到 hub，hub 再转发到 B 的流）。现在要设计直连模式，让 A 到 B 的流量尽量不经过 hub 进程。

已确认的取舍：

- **第一版只直连成员自己的 tun IP**。访问 hub 本身、访问任何 spoke 共享的 LAN 前缀、DNS 等仍然走 hub。
- **按需建立直连**。第一次有包发往某成员时才拨号；建立前先走 hub，建立后切换。
- **实现放在 x 的多链路 tun 能力上**（方案 A）。x 只提供通用数据面能力；成员表、拨号策略、重试留在 wisper。

成功标准：

- A ping/B 访问 B 的 tun IP 时，数据路径为 A 的 p2p 流到 B，hub 进程不参与转发。
- 直连还没建立、建立失败、或直连中途断开时，流量自动继续走 hub，不黑洞、不需要用户手动切回。
- 直连使用 p2p 已有端到端加密；成员资格仍由 hub 的白名单和地址分配决定。
- hub 移除成员或收回地址后，其它 spoke 在收到下一次被接受的 netview 后关闭到该成员的直连链路，不能继续绕过 hub 访问。
- tun entrypoint 增加自己的 peer 列表：能看到 hub 和每个成员的当前路径、是否直连、p2p underlay、双向流量；并有一套**本地入站访问控制**：默认 allow，可按 peer 阻断。阻断覆盖该 peer 的 tun IP 和它声明的 LAN 前缀，直连与 hub 中转都生效；被阻断的 peer 与本机之间不再有流量。
- 旧 hub / 旧 spoke 混部时，直连自动不启用，hub 中转行为不变。
- 默认配置（`direct=false`、`blocked_peers` 空）下，gost、p2p、wisper 的现有数据面/测试/配置行为不变；所有新能力必须显式开启才生效。

## 2. 非目标与反目标

非目标（第一版不做）：

- 不直连 spoke 共享的 LAN 前缀；`lan_allow` 继续只在 hub 上执行。
- 不把 hub 变成纯信令节点后删除 hub 数据面；hub 仍是永久 fallback。
- 不做全互联常驻链路；链路按需建立，空闲后回收。
- 不做多 hub、跨 hub 直连。
- 不做按 flow 的粘性选路；同一 TCP 流在直连建立/断开时可能经历一次路径切换（见 §7.6）。
- 不保证 hub 侧看到直连流量。直连流量不经过 hub，hub 的 per-peer 统计只统计经过它的部分。
- **不做独立的 outbound allow/deny**：主动访问某个 peer 是否成功，最终由那个 peer 的入站策略决定；本机只控制“谁能访问我”。但**被 block 的 peer 是本机与它之间完全无流量**：入站丢弃，出站到该 peer 也不发送——这不是 outbound 权限，而是 block 的语义，避免半开连接和无意义的出站包。
- **不做有状态防火墙**：block 是双向逐包丢弃，不区分谁先发起；若要“我能访问它、它不能访问我”的不对称语义，需要连接跟踪，另立设计。
- 不做端口/协议级 ACL；第一版只按 peer（及其 LAN 前缀）粒度。

反目标（出现即视为失败）：

- 直连失败时丢包而不是回落 hub。
- 直连绕过成员授权或 `lan_allow`。
- 本地入站 ACL 被直连、hub 中转或 userspace share 路径绕过。
- 为了直连在 spoke 上再开一个用户态 NAT / 本地 UDP 桥。
- 把 x 的 tun 客户端逻辑复制一份到 wisper 重新实现。
- **破坏现有功能**：`direct=false` 且 `blocked_peers` 为空时，wisper 的 tun 数据面必须与改动前逐字节一致；gost/x 的现有 handler、p2p 的 wire/行为、wisper 的 p2p tunnel/entrypoint/LAN/share 都不能因为新增代码而改变。
- **mesh 路由抢占已有 p2p tunnel/entrypoint 的 peer key**：显式 p2p 配置永远优先于直连 mesh 路由。

## 3. 现状与缺口

### 3.1 已有基础

- hub 的控制通道已经向每个 spoke 下发 `netview`，其中 `Members` 是全部 allowlist 成员的 `key + tun IP`（`tunnel/ctrl.go`、`tunnel/ctrlhub.go`、`tunnel/rib.go`）。成员发现不需要新协议。
- p2p 的 `Endpoint.Dial(ctx, "ip", peerKey)` 可以直接和任意 peer 建立 datagram 隧道；打洞失败自动走 DERP。对 spoke 来说，这两条路都不经过 hub。
- hub 侧 `x/handler/tun/p2phandler.go` 已经具备：单设备、按目的 IP 路由到多个 peer stream、设备写串行化、keepalive 注册/回显、非 IP/超大包丢弃。它证明了多 peer 数据面在 x 里可行。
- wisper 的共享 p2p host 已经有按 peer key 分发入站流的路由表（`tunnel/p2p_host.go`），可以给直连入站流复用。

### 3.2 缺口

spoke 的数据面仍是单链路：

- `x/handler/tun/client.go` 只拨一个 hub，`transportClient` 把整块 tun 设备读到的所有包写进这一条流。
- `tunnel/entrypoint/tun.go` 只构造一个 `tun` handler + 一条指向 hub key 的 chain。
- 只有 hub 侧才会按目的 IP 把包分发给多个 peer。
- spoke 没有任何本地访问控制：谁能访问它完全由 hub 的 allowlist 决定；peer 页也只存在于 hub 侧。

所以直连的难点不是发现或打洞，而是 **spoke 必须从“单 hub 客户端”变成“持有多条链路的设备所有者”**：既能按目的把设备包发到不同 peer，也能把多个 peer 进来的包写回同一块设备。

## 4. 方案选择

### A. 在 x 增加多链路 tun 节点能力（采用）

复用 hub 侧 `p2pHandler` / `peerTable` / `peerRouter` / 设备写锁。x 增加一个 mesh 模式的 tun handler：

- handler 独占 tun 设备；
- wisper 把按需拨通的 p2p datagram conn 注入 handler，安装成某个 peer key 的链路；
- 设备包按成员 IP → peer key 选路，直连不在时写 hub 链路；
- 对端进来的直连流复用现有入站处理，写回同一块设备；
- 成员表、拨号策略、失败重试、UI 都留在 wisper。

代价：要改 x 并发版，wisper 升 x 依赖。

### B. wisper 侧“本地 UDP 桥 + 现有 x tun server”（未采用）

每个 spoke 跑一个本地 tun server 持有设备，每个成员一条本地 UDP 桥。不需要改 x，但每包多一次 loopback UDP；tun server 监听 `:0` 时桥拿不到实际端口，仍需小改 x 或固定端口；多一层保活和重试，Android 排查面更大。不作为第一版。

### C. wisper 自建 mesh 数据面（未采用）

完全自己读设备、管 p2p 流、写设备。控制力最强，但等于重写注册、半死链路检测、并发写这些历史上多次出过黑洞的部分，回归风险最高。

## 5. 总体架构

三种路径并存：

```
A 的 tun 设备
  ├─ 直连（members[IP] 有健康直连链路）── p2p stream ──► B 的 tun 设备
  ├─ p2p 直连/DERP 由 p2p 自己选择；两条都不经过 hub
  └─ 回落（直连未建立/失败/目标是 hub 或 LAN）── p2p stream ──► hub ──► B
```

- **直连模式**：A→B 的 p2p 流由 A 直接拨 B。p2p 内部可能选 hole-punched direct，也可能选 DERP；两者都不经过 hub。UI 需要分别显示“业务路径 = 直连”和“p2p underlay = direct/derp”。
- **hub 回落**：A 把包写到 hub 链路，hub 按现有 `peerTable`/prefix 逻辑转发。现有 LAN 授权、`lan_allow`、hub 统计全部不变。
- **hub 自身/LAN/DNS/非成员目的**：永远走 hub 回落。

控制面仍然是 hub：

- hub 的 allowlist 决定成员资格；
- hub 的 `peer_ips` 决定每个成员的 tun IP；
- 成员新增/删除/改地址通过现有 netview 下发；
- 新增一个能力位，让双方知道对方是否支持直连。

## 6. 控制面设计

### 6.1 能力位

在控制帧上增加两个向后兼容的 JSON 字段：

```go
// claimMessage（spoke → hub）
type claimMessage struct {
    ...
    Direct bool `json:"direct,omitempty"` // 本 spoke 已启用直连
}

// memberEntry（hub → spoke）
type memberEntry struct {
    IP       string `json:"ip"`
    Key      string `json:"key"`
    Name     string `json:"name,omitempty"`     // hub's peer alias, for the spoke's peer list
    Direct   bool   `json:"direct,omitempty"`   // 该成员已启用直连
    Disabled bool   `json:"disabled,omitempty"` // hub 侧 peer_disabled / 已从 allowlist 移除
}
```

- 新 spoke 在初始 claim 和每 20s 的 claim refresh 里带 `direct: true`（仅当 entrypoint 的 `direct` 打开）。
- hub 的 `controlHub` 维护 `key → direct` 能力表；`SetMembers` 把 `authz.Members()` 的成员和这张表合并，写入 RIB。
- 能力变化会让 RIB 的成员内容变化，从而推进 `rev` 并重新发布 netview。
- `memberEntry.Name` 来自 hub 的 `PeerAliases`；hub 在 `SetMembers`/`SetPeers` 时合并别名，别名变化也推进 rev，spoke 的 peer 列表因此能显示名字而不是只有短 key。
- **禁用即撤销**：hub 的 `SetPeers`（删除 key、`peer_disabled`）必须清掉该 key 的 Direct 能力、设置 `memberEntry.Disabled` 并重新发布 netview，让其它 spoke 关闭直连。**不要额外改变 `authz.Members()` 的 membership 过滤**：`Members` 同时服务 LAN 路由的 covers-member/via 语义，把 disabled peer 从成员表里删掉会改变既有 LAN 行为。若 key 从 `Peers`/`PeerIPs` 完全移除，membership 自然消失；仅 disabled 的 key 保留成员行但 `Direct=false, Disabled=true`。`SetPeerIPs` 改变地址行时同样重新发布；被禁用/移除的 key 不能残留 `Direct: true`。
- **别名变更也要发布**：当前只有 `SetPeerIPs` 会 `ch.SetMembers(authz.Members())`；实现时 `SetPeers` 也必须带着新 `PeerAliases` 刷新成员表（或给 controlHub 一个独立的 `SetAliases`），否则 spoke 的 peer 列表会一直显示旧别名。
- 控制流暂时断开不等于成员被禁用：不因为 `Unregister` 就清能力；只有 allowlist / `peer_ips` 的显式变更才撤销。
- 旧 hub 不认识该字段，直接忽略；旧 spoke 不发送该字段，新 hub 看到 false。旧 hub 的 netview 没有 `direct`，新 spoke 看到 false。**混部自动不直连，不需要版本协商协议。**

### 6.2 成员快照与 hub generation

`NetviewRouter` 增加：

- 保存最近一次被接受的 netview 的完整 `Members`；
- 保存被接受的 claims 的 `prefix + origin`（本地 ACL 需要知道哪个 peer 拥有哪个 LAN 前缀）；
- `Members() []memberEntry` / `Claims() []claimEntry`；
- `Apply` 返回是否接受（旧 hub id / 旧 rev 返回 false）；
- 接受后通过 `ControlChannelConfig.MemberSync` 回调通知直连管理器和本地 ACL 过滤器。

只有被接受的 netview 才能改成员表和 ACL 映射；旧 rev 不能撤掉链路。

同时修复一个会直接破坏撤销语义的既有问题：hub 的 `netview.Hub` 用的是持久化的 tunnel ID，而 RIB 的 `rev` 每次进程启动从 1 开始。hub 重启后，已经见过高 rev 的 spoke 会把新 netview 当旧消息全部丢掉，成员撤销永远到不了它。设计增加：

```go
// netviewMessage
Gen string `json:"gen,omitempty"` // per-run generation, random on each controlHub build
```

- `Hub` 仍是 tunnel ID，用于身份和诊断；`Gen` 是每次 hub 运行新生成的随机值。
- 新 spoke 在 `(Hub, Gen)` 变化时重置 rev，因此 hub 重启后 rev 1 会被接受。
- 旧 spoke 忽略 `Gen`，保持既有行为（它们本来也不支持直连）；新 hub + 新 spoke 修复。
- 必须有“重启 hub → 移除成员 → spoke 关闭直连”的测试。

### 6.3 entrypoint 配置

`tunnel.Options` 增加：

```go
// Direct enables spoke-to-spoke direct links for member tun IPs.
// It is also advertised to the hub; peers only dial members that advertise
// direct too. Default false.
Direct bool
```

- 仅 tun entrypoint 使用；其它类型忽略。
- API/YAML 字段 `direct`。
- UI 在 tun entrypoint 表单增加 checkbox，默认关闭；hint 说明：
  - 只直连成员的 tun IP；
  - 共享 LAN、hub 本机、DNS 仍走 hub；
  - 对端也必须开启；
  - 直连流量不经过 hub，hub 侧统计看不到。
- `direct` 关闭时走现有单 hub 客户端路径，完全不进入新 mesh 数据面。这样新特性可以按 entrypoint 回退。
- 同一 entrypoint 还携带本地 `blocked_peers`（§7.7.3）；它与 `direct` 独立，`direct=false` 时仍然生效。peer 列表页/详情卡片见 §7.7.4。

### 6.4 升级顺序

1. hub 先升级到带能力位的新 wisper（x 可以先不升）。
2. spoke 升级到带 mesh handler 的 x + 新 wisper，再在需要的 entrypoint 上打开 `direct`。
3. 任意一端旧版本时，能力位为 false，直连不启用；hub 中转正常。

## 7. 数据面设计

### 7.1 x 侧：mesh handler

在 `x/handler/tun` 增加 mesh 模式（与现有 p2pHandler 同包，复用内部类型和包级 helper；不复制一份完整客户端）：

```go
// MeshMember is one member as the mesh handler routes by.
type MeshMember struct {
    IP      net.IP
    Key     string
    Name    string // display alias from the hub, optional
    Direct  bool   // peer advertises direct capability
    Blocked bool   // local inbound ACL denies this peer
}

// MeshCloseReason says why a link went away, so the manager redials only the
// closes that a new dial can fix.
type MeshCloseReason string

const (
    MeshCloseRemote     MeshCloseReason = "remote"     // peer closed / stream ended
    MeshCloseUnhealthy  MeshCloseReason = "unhealthy"  // no inbound past the timeout
    MeshCloseWrite      MeshCloseReason = "write"      // a write failed
    MeshCloseDial       MeshCloseReason = "dial"       // never became ready
    MeshCloseIdle       MeshCloseReason = "idle"       // idle reclaim
    MeshCloseDedup      MeshCloseReason = "dedup"      // lost the preferred-link tie-break
    MeshCloseMembership MeshCloseReason = "membership" // member removed / direct off
    MeshCloseBlocked    MeshCloseReason = "blocked"    // local inbound ACL denies the peer
    MeshCloseShutdown   MeshCloseReason = "shutdown"
)

type MeshPeerStatus struct {
    Key           string
    IPs           []string
    State         string // direct / connecting / fallback / failed
    Underlay      string // direct / derp / "" (from p2p status)
    DialedLocally bool
    Since         time.Time
    LastInbound   time.Time
    BytesIn       uint64
    BytesOut      uint64
}

// MeshHandler is the spoke-side tun device owner. It is reached by shape from
// wisper the same way SetPrefixRoutes is today.
type MeshHandler interface {
    handler.Handler
    // RunDevice owns the device conn the tun listener produced and returns
    // when that device closes. A replacement device is simply the next call;
    // links and their state survive a device swap.
    RunDevice(conn net.Conn) error
    SetMembers(members []MeshMember)
    SetHubLink(conn net.Conn)
    AddDialedLink(peer string, conn net.Conn)
    DropLink(peer string)
    SetDirectNeeded(func(peer string))
    SetLinkClosed(func(peer string, reason MeshCloseReason))
    MeshStatus() []MeshPeerStatus
}
```

实现要点：

- **设备所有权与重建**：mesh handler 不把设备固定在构造函数里。entrypoint 保留 tun listener；一个 supervisor goroutine 循环 `Accept` 设备 conn 并调用 `RunDevice(conn)`。设备关闭（Android VPN flap、接口重建）只是 `RunDevice` 返回，supervisor 接受下一块设备；直连链路、成员表和计数都不丢。设备写目标在锁内替换；写往旧设备的在途包丢失，后续包走新设备。设备地址集合发生变化（不是简单重建）仍按现有约定重启 entrypoint，因为 hub 的地址分配需要同步。
- **单设备写者**：所有写设备（直连入站、hub 入站）经过同一把写锁；设备写只阻塞链路读循环，不阻塞设备读循环。
- **入站 `Handle`**：用于共享 p2p host 路由到本 entrypoint 的直连流。校验 remote key 在成员表中、`Direct` 为 true、`Blocked` 为 false、不是自己、不是 hub；首帧必须是 tun 帧（keepalive 或完整 IP 包），否则关闭；安装为入站链路。
- **出站 `AddDialedLink`**：wisper 拨通后把 conn 交进来，安装为出站链路并启动读循环。
- **`SetHubLink`**：安装 hub 链路，永不参与直连去重，也不因成员变化关闭。
- **`dispatch`**：
  - 解析目的 IP；
  - 如果目的是本机 tun 地址：这是从本机发出又回到本机的包，丢弃并计数，避免环回；
  - 如果目的是成员 IP：查该成员的直连链路；链路 ready 且发送队列有空间则入队直连；否则入队 hub，并调用 `DirectNeeded(peer)` 触发按需拨号。`Blocked` 的成员不会走到这里——设备过滤器在 dispatch 之前就丢弃了发往它的包；即使走到，也不触发 `DirectNeeded`、不走直连。
  - 如果目的不是成员 IP（hub 本机、LAN、DNS、其它）：入队 hub；
  - 没有 hub 链路时丢弃并计数，不阻塞。
- **出站写不得阻塞设备读循环**：每条链路有一个有界发送队列（默认 256 个包）和一个写 goroutine。`dispatch` 只做非阻塞入队：
  - 直连入队失败（队列满/链路不健康）→ 尝试入队 hub；hub 也满 → 丢弃并计数；
  - 直连写 goroutine 出错 → 关闭链路（`MeshCloseWrite`），队列中剩余包丢弃；后续包回落 hub；
  - hub 写 goroutine 出错 → 关闭 hub 链路并通知管理器重拨；
  - 不为失败的写重放包；TCP 由重传恢复，UDP 接受丢失。
- **入站包**：keepalive/注册帧按协议处理并回显；完整 IP 包在通过源地址和目的地址校验后写设备；非 IP 包丢弃计数。**spoke 绝不把入站包再转发给另一个 peer**——它只在 hub 才做中转。
- **目的地址授权**：直连入站包的**目的地址必须是本机自己的 tun 地址之一**。目的为其它成员 tun IP、hub tun IP、共享 LAN、DNS 等一律丢弃并计数。否则一个成员可以把 A 当跳板访问 C 或 A 身后的 LAN，绕过 hub 的 `lan_allow`，这与 §2 的反目标冲突。
- **注册/保活复用现有格式**：`GOST` + 16 字节地址；每条链路（hub 和直连）都发自己的设备地址，收方回显 `keepAliveReply`。这样：
  - hub 链路对旧 hub 完全兼容；
  - 直连链路也有滚动 liveness；
  - 注册声明的地址必须与该 peer 在成员表里的地址集合完全一致，否则拒绝/关闭。
- **链路 ready**：链路安装后先发注册；收到首帧（回显或数据）才标记 ready。ready 之前不接收业务包，避免把包写进一条还没建立的流。
- **直连去重**：同一 peer 同时可能有出站和入站链路。保留规则：
  - 优先保留“拨号方 key 字典序更小”的那条；
  - 如果只有一条，保留它；
  - 新的优先链路建立后关闭旧的；两端用同一规则，因此会收敛到同一条物理流。
  - hub 链路不参与。
  - 去重关闭使用 `MeshCloseDedup`，管理器不得因此立即重拨。
- **空闲回收**：直连链路超过 `directIdleTimeout`（默认 5 分钟）没有任何双向业务包则关闭（`MeshCloseIdle`），回到 hub；下次有包再按需建立。hub 链路不回收。
- **成员变化**：`SetMembers` 替换成员表；凡是 key 被移除、`Direct` 变 false、`Blocked` 变 true、或地址变化的链路，立即关闭（`MeshCloseMembership` / `MeshCloseBlocked`）。入站包校验源地址必须是该 peer 的成员地址，防止成员伪造其它成员源地址。
- **本地 block**：`Blocked` 的 peer 不建立/接受直连，也不接收任何来自它的包；发往它的包在设备过滤器处丢弃。具体执行在 §7.7 的设备过滤器（入站按源、出站按目的，覆盖直连和 hub 中转），handler 这一层负责链路拒绝和关闭。
- **计数**：非 IP、超大包、无路由、源地址不合法、目的地址不合法、发送队列满分别计数；沿用 hub 的“首条立即日志、窗口内汇总”风格，避免刷屏。

### 7.2 wisper 侧：直连管理器

新增 `tunnel/entrypoint` 内的 `directManager`（或同包文件），职责：

- 持有共享 p2p host、HubPeer、本机公钥、mesh handler、成员快照。
- **成员准入**：只对 `Direct == true`、`Disabled == false`、`Blocked == false`、key 不是自己、key 不是 hub 的成员建立直连；本地阻断的 peer 从 mesh listener 的 claim 集合里移除，对端拨过来会在共享 host 层被拒绝。
- **按需拨号**：
  - `DirectNeeded(peer)` 只在没有链路、没有在途拨号、不在 backoff 时启动一次；
  - 拨号前 `host.PunchContext(ctx, peer)` 预热打洞；
  - `conn, err := host.Dial(ctx, "ip", peer)`，把 conn 交给 `mesh.AddDialedLink`；
  - 首次 ready 超时（默认 10s）或链路关闭时，按 backoff 重试：1s、5s、30s、5m 封顶，带抖动；成功后退避复位。
- **关闭原因驱动重拨**：只有 `remote` / `unhealthy` / `write` / `dial` 会进入 backoff 并在下一次有包时重拨；`idle`、`dedup`、`membership`、`blocked`、`shutdown` 不触发立即重拨。`idle` 后等下一次 `DirectNeeded`；`membership`/`blocked` 后该 peer 已不可直连；`dedup` 后保留的链路仍在。
- **hub 链路沿用现有 chain**：hub 链路不能用裸 `host.Dial`，而要走 entrypoint 现有的 chain（`forward` connector + `udp` dialer + p2p provider），这样 `share_mode=userspace` 的 `tun-share` connector 仍然包裹 hub 连接，LAN 共享行为不变；`record_mode` 等 chain 级行为也继续生效。直连链路只承载成员 tun IP，不承载 LAN，所以直接用 `host.Dial`，不需要 share shim。
  - 独立循环拨 hub key，交给 `mesh.SetHubLink`；关闭后 1s 重拨。hub 链路断开时，直连继续工作；hub/LAN/非成员流量暂时丢弃并告警。
- **入站路由**：在共享 p2p host 上注册一个 mesh 专用 `peerListener`，只 claim 当前可直连的成员 key。
  - **显式 p2p 配置优先**：如果某个 key 已被 p2p tunnel/entrypoint 持有，mesh 不 claim；如果 mesh 先持有、后来用户创建/启用了同 key 的 p2p tunnel/entrypoint，mesh 必须立即让出该 key（reconcile 释放），p2p 配置正常注册，该成员回落 hub。不能让 mesh 路由导致既有 p2p 配置创建失败。
  - 让出/跳过要记录一次事件，但只在状态变化时记录，不能每个 reconcile 刷屏。
  - 成员变化时 reconcile；冲突释放后下一次 reconcile 再 claim。
  - 同一进程只允许一个 direct-enabled tun entrypoint 持有 mesh 路由；第二个 direct-enabled entrypoint 启动失败并明确报错（hub-only 的 entrypoint 不受影响）。
  - **不要污染 pending peer 列表**：mesh 成员（包括被 block 的成员）对共享 host 来说是“已知 key”，它们的直连 knock 不应出现在 p2p tunnel 页面的 pending 列表里。实现上给 host 一个 mesh-known key 集合，`notePending` 跳过这些 key；默认无 mesh 时行为不变。
- **生命周期**：随 entrypoint `Close` 取消所有拨号、关闭链路（`MeshCloseShutdown`）、unregister mesh 路由；所有 goroutine 有退出路径，`-race` 下无泄漏。

### 7.3 与现有单 hub 客户端路径的关系

- `Direct == false`：完全走现有 `x/handler/tun` client 路径，行为不变。
- `Direct == true`：走 mesh handler。hub 链路必须兼容旧 hub：
  - 首帧是注册帧；
  - 每 10s 重新注册；
  - 30s 无入站视为半死，关闭重拨；
  - 设备地址集合与旧客户端一致。
- 这条兼容路径要有针对旧 hub 的 e2e（新 spoke + 旧 hub）。

### 7.4 授权

- 成员资格仍由 hub allowlist 决定；直连不新增准入名单。
- 每个 spoke 还有本地入站 ACL（§7.7），默认 allow、可按 peer deny；它只能收紧 hub 的授权，不能放行 hub 未授权的 peer。
- 直连两端都校验对方 key 在当前 netview 成员表中且 `Direct == true`。
- 注册帧声明的地址必须与该 key 的成员地址集合完全一致；直连入站包源地址也必须是该成员地址。
- 直连入站包的目的地址必须是本机自己的 tun 地址；否则丢弃。这保证直连不会变成“成员之间的跳板”，也不会绕过 hub 对共享 LAN 的 `lan_allow`。
- 成员被移除、`peer_disabled`、或地址被收回时，hub 在下一次 netview 里移除/更新该成员；spoke 收到被接受的 netview 后关闭链路。即使对端未收到更新，本端也会拒绝其入站链路和包；本端若仍在旧成员表里，对端（仍持有新表的一侧）也会拒绝它。
- 控制面分区期间，双方可能都停留在旧成员表；此时直连可能继续，直到任一侧收到新 netview。这是第一版的撤销语义（best-effort，见 §12），不是硬性 lease。
- 共享 LAN 仍走 hub，因此 `lan_allow` 继续在 hub 的 `lookupPrefix` 执行，不存在直连绕过。

### 7.5 成员发现与选路数据

- `NetviewRouter.Members()` 是唯一成员来源；直连管理器不读 hub 私有状态。
- 每成员可以有多个地址（现有 `peer_ips` 支持逗号分隔）；直连管理器把它们全部映射到同一个 key。
- 自己：通过本机 p2p 公钥识别，不加入直连目标。
- hub：通过 entrypoint 配置的 `peer` 识别，不加入直连目标。

### 7.6 路径切换语义

- 直连未 ready 前，包走 hub；ready 后的新包走直连。
- 直连断开/空闲回收后，新包回到 hub，并按需重新拨号。
- 不缓存、不回放切换前的包；TCP 能承受一次路径切换带来的重排/重传，UDP 可能乱序，这是接受的代价。
- 不做 per-flow 粘性；第一版按包选择当前健康链路。

### 7.7 Spoke 本地入站访问控制与 peer 列表

#### 7.7.1 语义

每个 tun entrypoint 有一套**本地入站 ACL**，与 hub 的 allowlist 分层：

- hub 的 allowlist / `peer_disabled` 决定谁属于网络、hub 是否给谁路由；
- spoke 的本地 ACL 决定“这个成员能不能访问我”；
- 本地 ACL 只能收紧，不能放大 hub 的授权：hub 不放行的 peer，本地 allow 也不会让它通；
- 第一版**默认 allow**，按 peer key 配置 deny；不提供独立的 outbound allow/deny；
- **block 的语义是本机与该 peer 之间完全无流量**：来自它的入站包丢弃，发给它的出站包也不发送。出站丢弃不是一项权限，而是 block 的一部分，避免半开连接。

阻断范围：

- 该 peer 的 tun IP（netview 里它的全部成员地址）；
- 该 peer 通过 netview claim 声明的 LAN 前缀（`claim.Origin == peer key`）；
- 来自这些源地址的**任何入站包**：直连、hub 中转、userspace share 路径都一样丢弃；
- 去往这些目的地址的**任何出站包**：在设备读循环/过滤器处丢弃；
- hub 自己那一行只读，不能在本地阻断控制面。

重要限制：

- block 是**逐包**的，不做连接跟踪，也不区分谁先发起；本机主动访问被 block 的 peer 同样不会发送；
- 如果需要“本机能访问它、它不能访问本机”的不对称语义，需要状态防火墙/连接跟踪，另立设计；
- 阻断是本地策略，不改变 hub 的 membership，也不影响其它 spoke；要全网禁用某个 peer，用 hub 的 `peer_disabled`；
- 没有 netview 时拿不到 peer 的 IP/前缀映射，本地阻断只保存配置、暂不生效；netview 到达后自动应用。

#### 7.7.2 执行点

1. **设备过滤器**：一个 `peerFilter` 包住 tun 设备 conn。`Write`（包写向设备，即入站）解析源 IP；源地址映射到被阻断 peer 就丢弃并计数，并返回 `len(p), nil`，让上游不会因为一次策略丢弃而拆链路。`Read`（设备出站）解析目的 IP；目的地址映射到被阻断 peer 同样丢弃并计数（这是 block 的一部分，不是 outbound 权限），其余包交给上层，同时做 per-peer 流量归属统计。被丢弃的读要继续读下一个包，不能返回空包。entrypoint 在两条路径都套同一过滤器：`direct=false` 时用 `filterListener` 包住 tun listener；mesh 路径由 supervisor 在 `RunDevice` 前 `Wrap` 设备 conn。
   - **过滤器常驻，空策略纯直通**：这样运行中新增/解除 block 不需要重建设备。`blocked_peers` 为空时，`Read`/`Write` 必须直接委托底层 conn，不解析、不计数、不改变错误/超时/Close/Context 语义；非空时才启用策略。不能因为空策略包装改变任何现有行为。
   - 过滤器激活时也提供 per-peer 计数；空策略下不提供 hub 中转的 per-member 字节，显示为不可用，不伪造数字。
2. **userspace share shim**：`tun-share` 会在设备之前把 LAN-bound 包吃进 gvisor stack；设备过滤器看不到这些包。`ChainShareShim` 必须拿同一份不可变 block policy，在 `shareClassify` 之前按源/目的地址拦截（进 stack 和从 stack 出来的方向都要查）。kernel share 路径不经过 shim，设备过滤器已覆盖。`blocked_peers` 为空时 policy 为空，shim 走原来的 `shareClassify` 路径，不改变现有 LAN 共享行为。
3. **直连路径**：被阻断的 peer 从 mesh listener 的 claim 集合中移除（入站直连在共享 host 层被拒绝），direct manager 不拨它，已有链路以 `MeshCloseBlocked` 关闭。
4. **hub 路径**：hub 仍可能把被阻断 peer 的包转发到本机；设备过滤器/`tun-share` shim 在写设备或进 stack 前丢弃。

策略是不可变快照（`netip.Addr → key`、`[]prefix → key`），由 netview 成员/claims 和 `blocked_peers` 计算；配置变化时原子替换，包路径只读。`peerFilter` 必须保留 `net.Conn` 的超时/地址/Close 语义；如果下层 conn 还实现了设备配置的 context 接口，要透传，否则旧路径/设备自检会拿不到配置。filter/policy 必须在 `init` 构造 chain 之前就存在，`tun-share` 节点的 metadata 才能带上同一个 policy 指针。

#### 7.7.3 配置与 API

`tunnel.Options` 增加：

```go
// BlockedPeers is a tun entrypoint's local access block: member keys whose
// traffic this spoke drops in both directions. The permission model is
// inbound (who may access this spoke); the outbound drop is part of the block.
// It is local only, does not change the hub's allowlist, and defaults to empty
// (allow every member).
BlockedPeers []string
```

- YAML/JSON 字段 `blocked_peers`。
- 只对 tun entrypoint 有意义；其它类型忽略。
- 运行中修改不重启设备/entrypoint：

```http
GET /api/entrypoints/{id}/peers
PUT /api/entrypoints/{id}/peers

{"blocked": ["<peer key>", ...]}
```

- `PUT` 用 `*[]string` 区分“未提及”和“清空”，和 hub peers 页的约定一致；只接受合法 base64 key，去重。
- 完整 entrypoint PUT 也必须用 `*[]string`/缺席沿用语义携带 `blocked_peers`：peer 页外的一次无关编辑不能把本地 ACL 清空；显式空数组才是清空。
- 只允许 tun entrypoint；其它类型 400。
- 应用顺序：更新 options（锁内）→ 重建 filter policy → 更新 direct manager/mesh listener/handler → 保存配置。失败返回错误；运行态已应用但保存失败沿用现有保存路径的告警方式。
- 运行中的 entrypoint 通过 `SetBlockedPeers(ctx, keys)` 就地应用；停止状态只更新 options/config，下次启动生效。
- 被 hub 移除的 peer，其 block override 保留在配置里（如果 peer 以后回来仍生效）；peer 列表用“blocked, not in network”一栏显示这些 key，允许手动解除，避免不可见的残留。

#### 7.7.4 peer 列表

列表由 tun entrypoint 自己生成，不依赖 hub 的 peers 页：

- **Hub 行**：hub key、连接状态、p2p underlay（direct/derp）、流量；只读。
- **成员行**：alias（来自 netview `memberEntry.Name`，缺失时短 key）、tun IP、该 peer 在 netview 里 claim 的 LAN 前缀、`state`、`transport`、`dialed_locally`、双向字节、RTT、`blocked`。
- **stale 行**：不在当前 netview membership 里、但仍在 `blocked_peers` 的 key；只显示 blocked 和解除按钮。
- `state`：
  - `direct`：直连链路 ready；
  - `connecting`：拨号/等首帧；
  - `hub`：没有直连，走 hub；
  - `blocked`：本地 block（权限模型是入站，效果是双向无流量）；
  - `disabled`：hub 侧 `peer_disabled` / 已从 allowlist 移除（`memberEntry.Disabled`），不直连，hub 也不路由；
  - `direct-off`：全局 `direct=false` 或 peer 未启用直连，走 hub。
- `state` 优先级：`blocked` > `disabled` > `direct` > `connecting` > `direct-off` > `hub`；同时成立时显示更高优先级。
- `transport` 来自 `P2PHostStatus`；`rtt_ms` 来自 peer diagnostics；没有测量就不显示。
- 字节统计：直连链路有精确的双向计数；hub 中转的 per-member 字节只有在本地 block 过滤器安装时才能按地址归属（过滤器同时做计数），否则显示“不可用”，不用总量去猜。被阻断的包计入 `blocked_bytes/packets`，便于确认策略生效。hub 行使用 hub 链路自己的计数。
- UI：
  - tun entrypoint 详情页增加 “Peers” 卡片/入口；
  - 新增 `entrypoint-peers-page`，路由 `/entrypoints/:id/peers`，布局对齐 hub peers 页但简化：没有 add/remove/alias/IP 编辑，只有每行 `Block inbound` 开关和只读状态；
  - 开关文案明确表达“阻断该 peer（双向无流量）”，权限模型是入站；不要写成“outbound 放行”。
  - 顶部提示“本地策略，只影响这台设备；全网禁用请到 hub 的 peers 页”；
  - 空 netview 时显示“waiting for hub membership”，不伪造在线状态。
- “是否直连”是本地路径状态；“peer 是否在线”只有 hub 的 peers 页能准确回答；spoke 列表不把 `hub` 状态写成 online。

## 8. 可观测性

- entrypoint API 返回 `direct` 配置、`blocked_peers`，以及 peer 列表（§7.7.4）：
  - hub 行 + 成员行 + stale blocked 行；
  - 每个成员的 state：`direct` / `connecting` / `hub` / `blocked` / `disabled` / `direct-off`；
  - p2p underlay：`direct` / `derp`；
  - 是否本端拨号、建立时间、最后入站时间、双向字节、RTT。
- UI：
  - tun entrypoint 详情页增加 “Peers” 卡片/入口；
  - 新增 `/entrypoints/:id/peers` 页面，显示 hub + 成员 + stale blocked；每行一个本地 `Block` 开关；
  - 明确提示：阻断是本地策略（权限模型是入站：谁可以访问本机；被 block 的 peer 与本机之间无流量），不改变 hub membership；hub 侧看不到直连流量。
- doctor：显示直连能力、当前直连成员数、失败/回落计数、本地阻断数。
- 事件：直连建立、断开、拨号失败、回退 hub、成员路由冲突、本地 block/unblock；失败类 warn，状态类 info，并对重复失败做窗口汇总/去重。direct 成员的 p2p 路径变化应归属到该 tun entrypoint（而不是落到全局未归属事件），避免新增噪声。
- 统计：
  - spoke 的总流量继续由 tun 设备 listener 的 stats 统计（设备是所有路径的公共点），不要把直连入站 conn 再计入 service stats，避免双算；
  - mesh 路径把**同一个 pStats 对象**同时给 tun 设备 listener 和 mesh service 的 `StatsOption`；peer listener 不 `setStats`，只保留 per-peer 计数。这样现有 stats task 通过 `Status().Stats()` 读到的仍是设备总量，和旧路径口径一致；服务本身不按 conn 累加字节；
  - peer 列表的 per-peer 字节：直连链路精确；hub 中转只有在本地 block 过滤器安装时才可按地址归属，否则显示不可用，不伪造；被阻断的包单独计数；
  - hub 的 per-peer 统计只代表经过 hub 的流量，文档和 UI 要写清楚；本地阻断的包已经过 hub 的仍会计入 hub 统计。

## 9. 错误处理与边界

| 情况 | 行为 |
|---|---|
| 直连拨号失败/超时 | 关闭尝试，继续 hub，按 backoff 重试 |
| 直连中途断开 | 立即回 hub；下一次有包时按 backoff 重拨 |
| 直连链路半死（写成功但无入站） | 30s 无入站关闭，回 hub |
| 直连发送队列满 / 写阻塞 | 不阻塞设备读循环；能入 hub 就入 hub，否则丢弃计数 |
| 直连写失败 | 关闭链路（`write`），后续包回 hub；不重放失败包 |
| hub 链路断开 | 直连继续；hub/LAN/非成员流量丢弃并 warn，1s 重拨 |
| 成员被移除/地址改变 | 关闭对应直连；旧地址不再路由 |
| 成员能力位 false / `peer_disabled` | 不拨号、不接入站流；走 hub |
| 本地 block | 不建/关闭直连；来自该 peer 的 tun IP/LAN 前缀包在设备或 share stack 前丢弃；发往该 peer 的包也在过滤器处丢弃；本机与它之间无流量 |
| userspace share + 本地 block | `tun-share` shim 在进 stack 前按同一策略拦截，不能绕过 |
| key 与其它 p2p tunnel 冲突 | 跳过该成员直连，走 hub，记一次事件 |
| 第二个 direct-enabled tun entrypoint | 启动失败，提示已有 entrypoint 占用直连模式 |
| 非 IP 包/超大包 | 丢弃并计数，不关闭链路 |
| 直连入站目的不是本机 tun 地址 | 丢弃并计数，不写设备、不转发 |
| 旧 hub / 旧 spoke | 能力位 false，自动不直连；hub 中转不变 |
| Android VPN 重建 | supervisor 接受新设备并调用 `RunDevice`；链路保留，写目标切到新设备；地址集合变化才重启 entrypoint |
| c-shared 下 panic | 直连管理器和链路 goroutine 加 recover，记录 stack，链路失败回 hub，不能带崩进程 |

## 10. 测试与验收

### x 单测

- device dispatch：成员 + 直连 ready → 写直连；成员 + 无链路 → 写 hub 且触发 `DirectNeeded`；非成员 → 写 hub；无 hub → 丢弃计数。
- 入站：IP 包写设备；keepalive 回显；非 IP/源地址不合法/目的地址不是本机 tun 地址丢弃；绝不转发给其它 peer。
- 出站背压：直连写 goroutine 卡住时，设备读循环仍能继续处理并回落 hub；队列满丢弃计数；直连写失败关闭链路。
- 去重：同时有入站/出站链路时按“拨号方 key 较小”保留；两端规则一致；`dedup` 关闭不触发重拨。
- 成员更新：移除 key / 改地址 / `Direct=false` / `Blocked=true` 关闭链路；旧 rev 不生效。
- 设备重建：`RunDevice` 返回后接受新设备；链路保留，后续包写新设备；旧设备在途包不 panic。
- liveness：首帧超时、30s 无入站、空闲回收、keepalive 回显。
- 并发：多链路同时写设备，`-race` 通过；设备写不交错。
- 旧 hub 兼容：用现有 `NewP2PHandler` 起一个旧 hub，mesh handler 的 hub 链路能注册、收发、重拨。

### wisper 单测

- claim/netview 能力位：新字段双向兼容；能力变化推进 rev；旧字段缺省 false；别名变化推进 rev。
- `NetviewRouter` 成员保存、回调只在接受 netview 时触发、旧 rev 不触发；`Gen` 变化重置 rev；claim 的 `Origin` 保留下来供本地 ACL 使用。
- 直连管理器：按需合并拨号、backoff、成功复位、成员变化关闭、hub key/自己排除；`dedup`/`idle`/`membership`/`blocked` 关闭不触发重拨。
- 共享 host 路由冲突：跳过冲突 key，不失败；冲突释放后 reconcile。
- `peer_disabled`/从 allowlist 删除：Direct 能力清除、`Disabled` 标记发布、直连关闭；`Members` 的既有 LAN 语义不被额外过滤；peer 列表显示 `disabled`。
- 第二个 direct-enabled entrypoint 启动失败；hub-only 仍可启动。
- `direct=false` 时完全不进入 mesh 路径，但本地入站 block 仍然生效。
- `share_mode=userspace` + `direct=true`：hub 链路仍走现有 chain（`tun-share` 生效），LAN 共享不回归；直连只走成员 IP。
- 入站过滤器：阻断 peer 的 tun IP、IPv4/IPv6、阻断 peer 的 LAN 前缀；未阻断成员照常；空 block 集直通；来自被阻断 peer 的包不写设备且计数；发往被阻断 peer 的出站包也被丢弃并计数；源/目的地址不属于任何成员时按非 ACL 路径处理。
- userspace share shim：阻断 peer 发往共享 LAN 的包在进 stack 前丢弃；未阻断 peer 不受影响。
- peer 列表 API：hub/成员/stale blocked 行；alias/IP/state/transport/bytes；`PUT` 就地生效、不重启、持久化；只接受 tun entrypoint。
- 完整 entrypoint PUT：省略 `blocked_peers` 时保留已有列表，显式空数组才清空。
- 阻断变更：新增/解除后 filter policy 原子替换；直连链路关闭/重新按需建立；`-race` 通过。

### e2e

> 现有 gost/x、p2p、wisper 套件必须原样通过；下面的新场景不能替代 §15.6 的回归矩阵。

1. **三节点直连**：hub + A + B，A/B 都开 direct；A ping B 通；A `MeshStatus` 显示 B 为 `direct`；hub 对 A→B 的转发字节无增长；B 回程也走直连。
2. **DERP-only**：关闭 A/B 的 p2p 打洞（或限制直连），A→B 仍为直连模式但 underlay 为 `derp`；hub 不参与。
3. **直连失败回落**：阻断 A↔B 的 p2p 路径；A→B 走 hub 仍通；状态 `fallback`，有失败/回落计数。
4. **成员撤销**：hub 移除 B 或设置 `peer_disabled`；A 收到新 netview 后直连关闭；A→B 不再通（而不是继续直连）。再加一条：重启 hub 后移除成员，A 仍能收到新 netview 并关闭（`Gen` 修复）。
5. **LAN 不直连**：A 访问 B 共享 LAN，仍经 hub；`lan_allow` 拒绝时不通；hub 统计可见；A 直连发往 B 的 LAN 地址被 B 丢弃，不 NAT。
6. **旧版本混部**：旧 hub + 新 spoke、新 hub + 旧 spoke，均不直连但 hub 中转正常。
7. **Android 真机**：APK 打开 direct，Wi-Fi/cellular 切换后直连能重新建立；空闲回收后再次访问能重建；VPN flap 后 `RunDevice` 接新设备且链路保留。
8. **userspace LAN 共享**：`share_mode=userspace` + `direct=true`，LAN 仍可用，直连成员 IP 仍工作。
9. **本地 block**：A 对 B 设置本地 block；B→A 的直连和 hub 中转都 dropped；A→B 的包也在 A 的设备过滤器处丢弃；A↔C 不受影响；解除后恢复；重启 A 后 block 仍生效。
10. **本地阻断保护共享 LAN**：B 访问 A 共享的 LAN 被 A 丢弃；C 访问同一 LAN 正常；A 的 hub 侧统计仍看到 B 的包（说明是本地丢弃）。
11. **userspace share + 本地 block**：B 发往 A 共享 LAN 的包在 `tun-share` 进 stack 前被丢弃；未阻断的 C 正常。
12. **peer 列表**：A 的 `/entrypoints/{id}/peers` 显示 hub、直连成员、via-hub 成员、blocked 成员；`PUT` 切换 block 不重启 entrypoint；alias 来自 hub。
13. **回归**：direct=false 的单 hub 客户端行为、现有多 spoke hub 中转、LAN 路由全部不变。

门禁：

- `GOWORK=off go build ./...`（x、wisper 各自模块）
- `CGO_ENABLED=1 go test -race -p 1 ./...`（按包跑，避免 wildcard hang）
- e2e 用 `-count=1`，并做“回退修复必挂”的验证
- 真机 APK 用现有重签/安装流程

## 11. 交付顺序

1. **x**：mesh handler（数据面、去重、成员表、liveness、fallback、Blocked 链路拒绝）+ 单测；x 打 tag。
2. **wisper 控制面**：claim/netview 能力位、别名、`NetviewRouter` 成员/claims、`Gen`、entrypoint `direct` 配置/API/UI（先默认关闭）；升 x 依赖；hub 镜像可先发布。
3. **wisper 数据面**：直连管理器、共享 host mesh 路由、hub 链路重拨、entrypoint 生命周期；单测。
4. **wisper 本地 ACL 与 peer 列表**：入站过滤器（设备 + `tun-share` shim）、`blocked_peers` 配置/API、peer 列表页/详情卡片、就地应用与持久化；单测。
5. **e2e 与混部验证**：三节点直连、DERP、回落、撤销、LAN、本地 block、userspace share、旧版本。
6. **Android 真机**：直连建立、切网、空闲回收、VPN 重建、peer 列表与 block。
7. **文档/UI**：直连说明、本地 ACL 语义、hub 统计口径、故障排查；教程补一节。

## 12. 已做的决定（review 时重点看这些）

- 默认 `direct=false`。理由：直连会改变流量路径和 hub 侧可见性，第一版先让用户显式开启；后续可再讨论默认值。
- 直连只覆盖成员 tun IP；共享 LAN 继续走 hub，避免复制 `lan_allow` 到每个 spoke。
- 能力位放在 claim/netview 的 JSON 里，不新增控制消息类型，不做版本协商协议。
- 一个进程只允许一个 direct-enabled tun entrypoint；Android 本来就是一个 VPN/一个 entrypoint。
- 同一 peer 的重复链路按“拨号方 key 较小”收敛；hub 链路不参与；`dedup` 关闭不触发重拨。
- 直连链路空闲 5 分钟回收；hub 链路常驻。
- 直连流量在 spoke 的设备 stats 里统计一次；hub 侧统计只代表经过 hub 的流量。
- 直连入站包同时校验源地址（必须属于该 peer）和目的地址（必须是本机 tun 地址）；hub 链路不校验源地址（hub 可能转发其它成员的包），目的地址交给设备处理。
- 出站链路使用有界队列 + 写 goroutine，设备读循环永不因链路写阻塞；直连队列满时回落 hub，hub 也满则丢弃计数。
- 设备生命周期由 entrypoint supervisor 管理：`RunDevice` 每次接管一块设备，设备重建不重建链路。
- 新增 `MeshCloseReason`，只有真实失败类关闭会触发 backoff 重拨。
- hub 的 `SetPeers`/`peer_disabled` 必须撤销 Direct 能力并重新发布 netview；不额外过滤 `Members`，保持既有 LAN 路由语义。
- netview 增加 per-run `Gen`，修复 hub 重启后 rev 回退被 spoke 丢弃的问题。
- hub 链路沿用现有 entrypoint chain（保留 `tun-share` userspace LAN 共享）；直连链路才用裸 `host.Dial`。`record_mode` 对 tun entrypoint 的 `forward` connector 本来就不生效，不需要额外限制。
- 第一版撤销语义已确定为 best-effort：收到被接受的 netview 后关闭；控制面分区期间可能继续使用旧成员表。不实现 netview 心跳 + 成员 lease；如果以后需要硬撤销，再单独加。
- 直连失败不阻塞首包；首包始终可以先走 hub。
- 本地访问控制只有 **inbound 权限模型**：spoke 决定谁能访问它；没有独立的 outbound allow/deny。
- 本地 inbound ACL **默认 allow**，按 peer key 配置 deny；不提供 default-deny 选项（如果以后要零信任，再加 `default_inbound: deny` 和 allow override，数据结构不变）。
- `block` 的语义是本机与该 peer 之间完全无流量：入站按源地址丢弃，出站按目的地址丢弃；出站丢弃是 block 的一部分，不是 outbound 权限。
- 本地 block 覆盖该 peer 的 tun IP 和它 claim 的 LAN 前缀；按逐包地址执行，不做连接跟踪。
- 本地 block 对直连、hub 中转、userspace share 全部生效；直连链路会关闭且不再建立。
- 因为不做连接跟踪，block 是双向的，不支持“我能访问它、它不能访问我”的不对称语义；不对称访问不在第一版。
- 本地 block 是 entrypoint 配置（`blocked_peers`），不改变 hub membership；全网禁用仍用 hub 的 `peer_disabled`。
- peer 列表是 spoke 本地视图：hub 行只读；成员行显示本地路径状态，不把“via hub”写成 online。
- 成员别名随 netview 的 `memberEntry.Name` 下发；没有别名时显示短 key。
- 不在当前 membership 的 blocked key 仍保留在配置中，并在 peer 列表的 stale 区显示，允许手动解除。
- **不回归是硬约束**：默认 `direct=false` + `blocked_peers` 空时，tun 数据面与改动前逐字节一致；不安装 mesh handler、不改变 stats/超时/错误语义、不新增 peer key claim；设备过滤器为空策略纯直通。
- **显式 p2p 配置优先**：mesh 直连路由是可抢占的；同 key 的 p2p tunnel/entrypoint 永远能注册成功，mesh 让出并回落 hub。
- 设备过滤器常驻，但 `blocked_peers` 为空时是纯直通（Read/Write 直接委托，不解析/不计数）；非空时才启用策略。这样运行中增删 block 不需要重建设备。
- 控制面新字段全部可选；别名有长度上限，超限省略别名而不是让 netview 失败。
- 所有现有 gost/x、p2p、wisper 测试套件必须原样通过；新增测试不得修改旧断言来适配。

## 13. 留给 builder 的

- x mesh handler 内部的具体拆分（新文件 `mesh.go` 还是扩展 `p2phandler.go`）由实现者决定，但必须复用现有设备写锁、keepalive 解析、`isTunFrame`/`destinationOf` 等 helper，不能复制一套。
- 直连管理器的拨号 goroutine 数量、backoff 抖动、空闲回收 tick 的具体参数，可在实现时按测试调整；语义按本文。
- 共享 p2p host 的 mesh 路由冲突跳过/重试/让出的具体内部 API 形状由实现者决定；必须实现“显式 p2p 配置优先”，不能让 mesh 路由导致既有 p2p 配置创建失败。
- 入站过滤器/计数器的内部结构（不可变 policy 快照、per-peer 计数器、锁粒度）由实现者决定；必须保证包路径只读、更新原子替换、`-race` 干净；`blocked_peers` 为空时必须纯直通，不能解析/计数/改变底层 conn 语义。
- `tun-share` shim 接入 block policy 的具体接口由实现者决定；空 policy 必须走原路径，非空时 LAN-bound 入站包在进 stack 前被拦截。policy 指针只放在内存里的 chain metadata，不能进入配置持久化/日志。
- 别名长度上限、netview 大小保护和超限降级由实现者决定；不能因为别名让控制流超过 `maxFrame`。
- peer 列表的 API 字段命名、详情卡片和 `/entrypoints/:id/peers` 页面的具体布局/组件拆分由实现者按现有 UI 约定决定；行为按 §7.7.4。
- UI 直连/阻断区块的具体文案 key 由实现者按现有 `t()` / i18n 约定决定。
- e2e 容器/netns 的具体拓扑和 flake 处理按现有 `p2p/tests/e2e`、`wisper/docs/tun-hub-bandwidth-e2e.md` 的约定决定。
- 回归矩阵的实现方式（哪些用现有套件、哪些新增）由实现者决定，但 §15.6 的每一项都必须有可执行证据。

## 14. 撤销语义（已确认）

第一版采用 **best-effort**：

- 成员被移除/禁用后，spoke 在收到下一次被接受的 netview 时关闭直连。
- 控制面分区期间，如果双方都没收到新 netview，直连可能继续使用旧成员表；这与 hub 本身在分区期间的行为一致。
- 不在第一版实现成员 lease / netview 心跳。理由是保持 hub 短时不可用时直连仍可用（与 Tailscale 的现有行为同类），且撤销在控制面恢复后立即生效。
- 如果以后需要硬性撤销，再单独设计 lease：hub 每 60s 重发当前 netview，spoke 超过 `memberLease` 未收到就关闭所有直连。

## 15. 兼容性、不回归与回滚

**硬约束：本方案不能破坏现有任何功能，包括 gost、p2p、wisper。** 下面的规则是验收的一部分，不是建议。

### 15.1 功能开关矩阵

| 配置 | 数据面 | 新代码是否生效 |
|---|---|---|
| `direct=false` + `blocked_peers` 空 | 完全走改动前的单 hub tun 客户端路径 | 不安装 mesh handler、不 claim 任何 mesh peer key；设备过滤器存在但空策略**纯直通**（Read/Write 直接委托，不解析/不计数/不改错误语义）；`tun-share` 走原 `shareClassify`；只有新增的空配置字段存在 |
| `direct=true` + `blocked_peers` 空 | mesh handler；hub 链路仍走原 chain；直连只覆盖成员 tun IP | 设备过滤器为纯直通（block 空，不激活策略）；peer 列表显示路径/状态，hub 中转的 per-member 字节显示不可用 |
| `direct=true` + `blocked_peers` 非空 | mesh handler + 设备过滤器 + `tun-share` policy | 用户显式配置 block 后才生效 |
| `direct=false` + `blocked_peers` 非空 | 原单 hub 路径 + 设备过滤器 | 用户显式配置 block 后才生效 |

默认配置必须落在第一行：`direct` 默认 false，`blocked_peers` 默认空。升级后不配置任何新字段，行为与升级前一致。

### 15.2 各模块边界

- **core / plugin**：零改动。
- **p2p**：零代码、零 wire 改动。直连使用现有的 `Endpoint.Dial(ctx, "ip", peer)`、`Punch`、DERP 和打洞路径；不新增协议、不改 `p2p/internal/host`。现有 p2p e2e 必须原样通过。
- **gost / x**：
  - 新增 mesh handler 作为**新文件/新构造函数**；现有 `NewHandler`、`NewP2PHandler`、socket tun server、hub 数据面语义不变。
  - 如果复用 `peerTable`/`peerRouter`/helper，只做包内复用，不改变现有调用路径的默认值/错误/日志。
  - 不新增注册名或修改现有注册名；gost 二进制不配置新 handler 时行为不变。
  - x 的公开 API 只增不改；现有 gost 用户升级 x 不配置新功能时无感。
- **wisper**：
  - 默认走旧路径；新配置字段全部可选；旧配置文件加载后 `direct=false`、`blocked_peers` 空。
  - 新 API 字段/端点只增不改；旧客户端忽略新字段；旧版 wisper 加载包含新字段的配置不能失败（未知字段应被忽略；实现时加测试）。
  - 完整 entrypoint PUT 省略 `blocked_peers`/`direct` 时沿用现值，避免无关编辑改变行为。
  - 现有 p2p tunnel、p2p entrypoint、tun hub、LAN 路由、share_lan（kernel/userspace）、事件/统计行为不变。
- **Android**：不改变 VpnService/fd 流程；直连和 block 默认关闭；新增页面/API 不影响现有启动/恢复。

### 15.3 peer key 所有权：显式 p2p 配置优先

共享 p2p host 的一个 peer key 只能路由到一个对象。为了保证既有 p2p 配置不被直连破坏：

- 优先级：**显式 p2p tunnel/entrypoint > tun mesh 直连路由**。
- mesh 启动时只 claim 当前未被占用的成员 key。
- mesh 已持有某 key，用户随后创建/启用同 key 的 p2p tunnel/entrypoint 时，p2p 配置必须成功注册；mesh 在注册路径上立即让出该 key（reconcile 释放），该成员回落 hub，并记录一次状态变化事件。
- 不能让 mesh 路由导致既有 p2p 配置报 “peer already used by another p2p tunnel”。
- p2p 配置移除后，mesh 可以在下一次 reconcile 重新 claim；不是即时要求。
- 测试必须覆盖：mesh 先占 key → 创建 p2p tunnel 成功；p2p tunnel 先占 key → mesh 跳过；删除 p2p tunnel → mesh 重新 claim；全程不影响 hub 中转。

### 15.4 控制协议兼容

- `memberEntry.Name/Direct/Disabled`、`netview.Gen`、`claim.Direct` 都是新增可选 JSON 字段：
  - 旧 hub 不发送/忽略新字段；新 spoke 看到缺失值按 false/空处理；
  - 旧 spoke 忽略新字段；新 hub 发送的新字段不会改变旧 spoke 的 LAN 路由；
  - `Gen` 只被新 `NetviewRouter` 使用；旧 spoke 仍按旧 `Hub/Rev` 行为（既有 bug 不恶化）。
- 别名是可选字段：为空时 netview 与改动前等价；别名长度要设上限，避免大 netview 超过 `maxFrame` 导致控制流被关。超过上限时省略别名而不是让整个 netview 失败。
- `SetPeers` 刷新 membership/别名是修复现有能力位/别名传播，不改变旧 spoke 的 LAN 路由；必须有 LAN 路由回归测试。

### 15.5 数据面不变量

- 旧单 hub 路径的 `handleClient`/`transportClient`、hub 的 `p2pHandler`/`p2pHub` 不改语义；新 mesh 路径独立。
- `direct=false` 且无 block 时，设备 conn 上的过滤器必须是纯直通：`Read`/`Write` 直接委托底层，不解析/不计数；stats、超时、错误、Close、Context 语义与原实现一致。
- mesh 路径的 stats 口径与旧路径一致：设备 listener 的 pStats 是唯一字节来源，mesh service 的 `Status().Stats()` 暴露同一个 pStats；peer listener 不把入站 conn 的字节加进 service stats。
- `tun-share` 的 `shareClassify` 在空 policy 下走原路径；kernel share 不受影响。
- 直连只承载成员 tun IP；共享 LAN 仍走 hub，`lan_allow` 继续在 hub 执行。
- 不新增后台常驻 goroutine（除 mesh/direct/block 显式开启时）；默认路径的 goroutine 数量不变。
- 不新增依赖；过滤器复用现有 IP 解析工具（必要时使用已在 go.sum 的 `waterutil`/`x/net`，不引入新模块）。

### 15.6 回归测试矩阵（必须全绿）

**现有套件原样通过：**

- `x`：`go build ./...`、`go vet ./...`、`CGO_ENABLED=1 go test -race -p 1` 按包。
- `gost`：`go build ./cmd/gost`、现有 e2e（`-count=1`）。
- `p2p`：现有 e2e（`p2p/tests/e2e`），包括 direct/DERP/punch/relay 场景。
- `wisper`：现有 Go 单测、web-e2e、Android 构建/安装 smoke。

**新增路径的回归用例：**

1. `direct=false` + 空 block：单 hub tun 入口点、hub 中转、LAN 路由、share_lan 行为与基线一致；空策略过滤器纯直通（Read/Write 直接委托，可用测试 seam 断言）。
2. `direct=true` + 空 block：hub 链路仍走原 chain；`share_mode=userspace` 的 LAN 共享可用；直连只走成员 IP；hub 中转仍可用。
3. `blocked_peers` 非空：直连/hub/userspace share 都被拦；解除后恢复；默认路径无 block 时没有过滤器。
4. peer key 所有权：mesh 与现有 p2p tunnel/entrypoint 的先后顺序、抢占/让出、回落 hub。
5. 混部：旧 hub + 新 spoke、新 hub + 旧 spoke、旧/新配置互相加载。
6. hub 重启 + `Gen`：LAN 路由和成员撤销都恢复；旧 spoke 行为不变。
7. 完整 entrypoint PUT：省略新字段保留、显式空清空；无关编辑不改变 direct/block。
8. 事件/统计：默认路径无新增噪声；新事件只在 direct/block 变化时出现。

### 15.7 回滚

- 关闭 `direct`、清空 `blocked_peers` 即回到旧数据面；不需要迁移配置。
- 旧 wisper 加载带新字段的配置必须成功（未知字段忽略）；若某版本不能忽略，发布说明要写清降级前删除新字段。
- x 的新 handler 是加法；wisper 降级到旧 x 依赖前先关闭 direct。
- hub 可以先升级，spoke 后升级；任意一端旧版本时直连不启用，hub 中转不变。

### 15.8 验收口径

- 默认配置下，现有功能的日志/事件/统计/数据路径与改动前等价。
- 所有现有测试套件原样通过；新增测试不得通过修改旧断言来“适配”。
- 任何需要改变现有行为的修复（如 hub 重启 `Gen`、`SetPeers` 刷新 Direct 能力/别名）必须单独标注为 bugfix，并有独立的红绿测试。这两个修复是直连撤销/别名/禁用语义的必要前置；它们不改变默认数据面，只修正“hub 重启后 netview 被旧 rev 丢弃”和“禁用/改别名后 netview 不刷新”的既有缺陷；`Members` 的 LAN 语义不额外过滤。
- **2026-11-05 已确认**：以上两个 bugfix 随本方案一起带上；设计按本文件冻结。
- 发布前由维护者确认“默认路径无感、显式开启才生效”。
