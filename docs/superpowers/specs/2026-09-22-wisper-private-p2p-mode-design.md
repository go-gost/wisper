# Wisper 私有 p2p 模式（反向侧）设计

> 2026-09-22。承接 [p2p-integration.md](../../../docs/p2p-integration.md) 的「边界与定位」：
> 第一增量 = **反向侧**——wisper 内嵌 p2p host，`target` 指向本地服务，对端按 base64 key 拨入，
> 不经 gost.run。全套含 UI。前提：p2p 库化 + 进程内 Provider + framing 修复
> （p2p 本地 main `204e2d5`；**未发布**，当前用 go.work 模式开发，发布与 bump 待定）。

## Context（背景）

三条已核实的事实决定形态：

1. **一隧道一 host**：p2p 的 target 池按流 round-robin 挑选（`e.targets.pick("tcp")`，
   [p2p/direct.go](https://github.com/go-gost/p2p/blob/v0.4.0/direct.go)），多隧道共享一个 host
   会让不同 peer 的入站流在服务间轮转 → 每条 p2p 隧道必须是**独立 host**（独立 key + 单一 target）。
2. **接缝现成**：对端用 `chain` 节点寻址（node addr = pubkey、`dialer: tcp`、`connector: forward`、
   `metadata.p2p = provider 名`），wisper 侧只需注册 `host.Provider()`
   （POC 已验证，见 [tunnel/p2p_poc_test.go](../../../tunnel/p2p_poc_test.go)）。
3. **安全边界在调用方**：p2p 没有 admission（见 p2p CLAUDE.md）。持有 pubkey 且能连到 relay 的人
   即可到达该本地服务；可用的杠杆是 key 保密、relay 的 `-verify-clients`、以及本地服务自身鉴权。

## 目标与非目标

- 目标：wisper 新增隧道类型 `p2p`——填本地后端地址，运行后展示 base64 pubkey，远端 gost/wisper
  按 key 拨入（tcp），全套 UI/API/config 支持。
- 非目标（后续增量）：出站 entrypoint；udp target（等 p2p 多客户端修复）；打洞直连
  （`Direct` 固定 `false`）；名称发现（p2p 不支持）；per-tunnel 流量统计（host 不暴露，
  详情页显示 "—"）。

## 架构

### 组件

| 单元 | 位置 | 职责 |
|---|---|---|
| `p2PTunnel` | `tunnel/p2p.go`（新） | 一种隧道类型：key 生命周期 + 内嵌 host 生命周期；`Run`/`Close`/`Entrypoint` |
| `P2PSettings` | `config/config.go` | 部署级设置：`derp`（wss URL）、`secure`、`caFile`；挂在 `Settings.P2P` |
| API 分支 | `api/tunnel_handler.go` | create/update/list/get 的 type switch 增 `p2p`；响应增 `peer_key` |
| UI | `web-src/src/{api/types.ts,pages/*,i18n/*}` | 类型卡片、表单（后端地址）、详情页 pubkey + 接入提示、设置页 p2p 三项 |

**`p2PTunnel` 细节**

- key 路径由隧道 ID 推导：`<UserConfigDir>/wisper/p2p/<id>.key`（hex，0600）。不进 config.yml。
- `Run()`：load-or-create key → `p2p.New(&p2p.Config{Derp: settings.p2p.derp, Key: path,
  Targets: []string{"tcp://" + Endpoint}, Direct: &false, TLS: {Secure, CAFile}})` → `host.Connect()`
  → running。`Connect` 失败**不致命**（engine 后台重连，与 p2p CLI 语义一致）：状态仍 running，
  错误进 `err` 供 UI 展示。
- `Entrypoint()` 返回 `host.PublicKey()`（base64，UI 的"共享给对端"值；API 响应里即 `entrypoint`
  字段，卡片按现有样式展示）；`Endpoint()` 仍是本地后端地址。`IsClosed()`/`Close()` 沿用
  close-once 模式；`Close` **保留** key 文件
  （stop→start 复用同一身份）；**删除隧道**时由 API 层清理 key 文件。
- 缺 `settings.p2p.derp` → `Run` 直接报错（error 状态，提示去设置页），不建 host。

### 数据流

创建（后端地址）→ `Run` 生成 key + 建 host + 连 derper → UI 展示 pubkey 与对端接入片段 →
对端 gost 以 `node addr=<pubkey>` + `dialer tcp` + `connector forward` + `metadata.p2p` 拨入 →
host 把入站流桥到 `Endpoint` 的本地服务。

对端接入提示（详情页文案，复制区）：

```yaml
chains:
  - hops:
      - nodes:
          - addr: <pubkey>
            dialer: {type: tcp}
            connector: {type: forward}
            metadata: {p2p: p2p}
p2ps:
  - name: p2p
    plugin: {type: grpc, addr: ...}   # 或进程内注册
```

### 错误处理

- 缺 derp → error 状态 + 明确文案。
- key 不可写/损坏 → error 状态 + 日志。
- `Connect` 失败 → 保持 running，`err` 里带原因（engine 自愈）。

## 安全（写进 UI 与文档，不可弱化）

- pubkey 即准入：详情页固定提示"持有该 key 且可达 relay 的任何人可访问该本地服务"。
- key 文件 0600、不写 config.yml；删除隧道时删除。
- relay 侧建议 `-verify-clients=true`（运营者杠杆），文档写明。

## 测试

1. `tunnel/p2p_test.go`（普通构建，无网络）：`t.Setenv("XDG_CONFIG_HOME", t.TempDir())` 后
   - key 文件生成 + 权限 0600 + stop→start 复用同一 pubkey；
   - 缺 `settings.p2p.derp` → Run 报错/setErr；
   - Close 幂等。
2. e2e（build tag `p2ppoc`，复用 `tunnel/p2p_udp_poc_test.go` 的 `startDerper`）：
   `TestP2PTunnelAcceptsPeerByKey`——起 wisper `p2p` 隧道（Endpoint = 本地 echo），
   `config.Set` 指向测试 derper；对端用另一个进程内 host 注册 provider + chain（node addr = 隧道
   pubkey）→ `route.Dial` 回环成功。
3. UI 手动：类型选择 → 创建 → 详情页 pubkey → 对端拨入 → stop/start → 删除（key 文件清理）。

## 交付物

- 代码：`tunnel/p2p.go`、`config/config.go`、`api/tunnel_handler.go`、UI（types/select/detail/settings/i18n）。
- 测试：`tunnel/p2p_test.go` + `tunnel/p2p_e2e_test.go`（tag `p2ppoc`）。
- 文档：`docs/p2p-integration.md` 增「私有 p2p 模式（反向侧）」一节（配置步骤 + 对端接入示例 +
  安全边界 + 未发布版本说明）。
- 版本：开发期用 go.work（本地 p2p `204e2d5`）；p2p `v0.4.1` 发布与 wisper bump 待定。
