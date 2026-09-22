# Wisper p2p entrypoint（出站侧）设计

> 2026-09-22。承接 [p2p-integration.md](../../../docs/p2p-integration.md) 的「边界与定位」与
> [私有 p2p 模式（反向侧）](2026-09-22-wisper-private-p2p-mode-design.md)：
> 第二增量 = **出站侧**——本地监听 → 经 p2p 隧道拨向对端 pubkey。TCP 先行（内层 dialer 固定 `tcp`；
> tls/ws 变体留后续）。依赖 p2p `v0.4.1`（已发布，wisper 已 bump）。

## 目标与非目标

- 目标：wisper 新增入口点类型 `p2p`：本地端口 + 对端 pubkey；本地客户端连进来后，流量经内嵌 host
  的隧道到对端 host 的 target。闭环「wisper ↔ wisper / wisper ↔ 任意 p2p host」。
- 非目标：内层 tls/ws（后续增量）；多对端扇出（hop 多 node + selector）；udp 入口点（等 p2p
  多客户端修复）；名称发现。

## 架构

### 组件

| 单元 | 位置 | 职责 |
|---|---|---|
| `p2pEntryPoint` | `tunnel/entrypoint/p2p.go`（新） | 入口点类型：内嵌 host + provider 注册 + 本地 listener/handler/chain 接线 |
| `Peer` 字段 | `tunnel/tunnel.go`（Options）+ `config/config.go`（Tunnel） | 对端 pubkey；`PeerOption`；持久化 + Load/Save/工厂透传 |
| 工厂/常量 | `tunnel/entrypoint/entrypoint.go` | `P2PEntryPoint = "p2p"` + `createEntryPoint` 分支（两处 Load 路径透传 `Peer`）|
| 导出复用 | `tunnel/p2p.go` | `P2PDerpURL`/`P2PTLSConfig`/`P2PKeyPath` 改为导出（entrypoint 包复用）|
| API | `api/entrypoint_handler.go`、`api/config_handler.go` | create/update/start 的 type switch 增 p2p；options 响应加 `peer`；删除路径清 key |
| UI | `web-src/src/{api/types.ts,pages/entrypoint-*,i18n/*}` | 类型卡片、表单（监听地址 + Peer key）、详情页显示 peer、i18n |

### `p2pEntryPoint` 细节

- `opts.Endpoint` = **本地监听地址**（沿用现有语义）；`Peer` = 对端 pubkey。
- `Endpoint()`（"公网侧"语义）返回 **peer key**；`Entrypoint()` 仍是本地监听地址（现有约定不变）。
- key 文件：`<UserConfigDir>/wisper/p2p/<entrypoint-id>.key`（0600，复用 `P2PKeyPath`；entrypoint ID
  是 UUID，与隧道 ID 不会撞）。stop/start 与 update 复用身份；**只有删除入口点**才移除。
- `Run()` 顺序（关键）：
  1. `p2p.New{Derp: P2PDerpURL(settings), Key: P2PKeyPath(id), Direct:false, TLS: P2PTLSConfig(settings)}`
     → `Connect()`（失败仅记日志，不写 `err`，状态保持 running——与反向侧一致）；
  2. **先注册 provider 再解析 chain**：`registry.P2PRegistry().Register(providerName, host.Provider())`；
     `providerName` 每入口点唯一（如 `"p2p-ep-" + ID`）；注册前先 best-effort `Unregister`（同进程
     stale 残留不能挡住重启）；
  3. 打补丁 `tunnel.ChainConfig(...)` 的 node（addr = peer key、`dialer: tcp`、`connector: forward`、
     `metadata.p2p = providerName`）→ `chain_parser.ParseChain`；
  4. 接线镜像 `tcp.go`：`tcp.NewListener(Addr=opts.Endpoint)` + `local.NewHandler(Router)` +
     `hop.NewHop(Node(name, peer))` + `xservice.NewService`，`go Serve()`。
- `Close()`：`host.Close()` + **注销 provider**（全局 registry，必须清）；key 保留；close-once 幂等。
- relay 不可达：状态 running，engine 5s 重连（`RestartRunning` 在设置变更时重建 ✓ 已有逻辑覆盖）。

## 安全

- 数据面明文（内层 tcp）：p2p 的设计就是"可达性，不是机密性"。跨公网建议后续加 tls/ws 内层；
  本轮在文档与详情页提示"内容在中继与直连路径上未加密"。
- 本侧 key 会呈现给 relay：`-verify-clients=true` 的 relay 下它就是客户端身份；key 文件 0600、
  不进 config.yml。
- 对端 target 的暴露由对端负责（反向侧的安全说明适用）。

## 测试

1. `tunnel/entrypoint/p2p_test.go`（无网络，`t.Setenv("XDG_CONFIG_HOME", ...)`）：
   - `Run()`（假 relay `wss://127.0.0.1:1/derp`）→ 无错、状态 running、key 0600、provider 已注册；
   - `Close()` → provider 已注销、幂等；key 保留；
   - stop→start 复用同一 pubkey（`Endpoint()` 即 peer key 不受影响）。
2. e2e（tag `p2ppoc`，`tunnel/entrypoint/p2p_e2e_test.go`；复用 `p2p_udp_poc_test.go` 的
   `startDerper`）：对端进程内 host（`Targets: ["tcp://"+echo]`）+ wisper p2p entrypoint
   （本地 `127.0.0.1:0`、peer = 对端 pubkey）→ 连本地监听 → 回环成功。
3. UI 手动（浏览器）：类型卡片 → 表单（监听地址 + Peer key）→ 创建 → 详情页显示 peer →
   本地 `nc` 连通 → stop/start → 删除（key 清理）。

## 交付物

- 代码：`tunnel/entrypoint/p2p.go`、`tunnel/tunnel.go`（Peer Option）、`config/config.go`（Peer）、
  `tunnel/p2p.go`（导出复用）、`tunnel/entrypoint/entrypoint.go`（常量/工厂/两处 Load）、
  `api/entrypoint_handler.go`、UI（types/entrypoint-select/detail/i18n）。
- 测试：`tunnel/entrypoint/p2p_test.go` + `tunnel/entrypoint/p2p_e2e_test.go`（tag `p2ppoc`）。
- 文档：`docs/p2p-integration.md` 的「私有 p2p 模式」一节补出站侧用法（本地监听 + peer key +
  客户端接入方式 + 明文提示）。
