# Wisper — Flutter UI 实施计划

## Context

基于 `docs/flutter-ui-design.md` 设计规范，在 `go-gost/wisper/` 项目中实施 Flutter 前端 + Go HTTP API 后端。设计规范中所有 `GOST+` / `G+` 品牌替换为 `Wisper` / `W`，版本 `v0.1.0`。

HTML 原型已完成（`wisper/docs/prototype/index.html`），本计划是下一步的 Flutter 实施路线图。

## 项目位置

- 项目根目录：`/config/workspace/go-gost/wisper/`
- 设计规范：`/config/workspace/go-gost/gost-plus/docs/flutter-ui-design.md`（需要复制到 wisper 并更新品牌）

## Phase 1：Go HTTP API 层（1 周）

从现有 `gost-plus` 代码中提取，去除 Gio 依赖，新增 HTTP API。

### 关键文件（从 gost-plus 提取）

| 源文件（gost-plus） | 目标（wisper） | 操作 |
|---|---|---|
| `config/config.go` | `config/config.go` | 复制，去 Gio 依赖 |
| `tunnel/*.go` | `tunnel/*.go` | 复制，几乎不变 |
| `tunnel/entrypoint/*.go` | `tunnel/entrypoint/*.go` | 复制 |
| `runner/*.go` | `runner/*.go` | 复制 |
| `version/version.go` | `version/version.go` | 复制，改 Version = "0.1.0" |
| — | `api/server.go` | **新建**：HTTP API 服务器 |
| — | `api/tunnel_handler.go` | **新建**：Tunnel CRUD handler |
| — | `api/entrypoint_handler.go` | **新建**：Entrypoint CRUD handler |
| — | `api/stats_handler.go` | **新建**：Stats 查询 handler |
| — | `api/config_handler.go` | **新建**：配置读写 handler |
| — | `main.go` | **新建**：HTTP 服务入口（替代 Gio 事件循环） |

### HTTP API 端点

```
GET/POST/PUT/DELETE  /api/tunnels(/:id)
POST                 /api/tunnels/:id/start|stop
GET/POST/PUT/DELETE  /api/entrypoints(/:id)
POST                 /api/entrypoints/:id/start|stop
GET                  /api/stats
GET/PUT              /api/config
```

### Go 模块初始化

```bash
cd /config/workspace/go-gost/wisper
go mod init github.com/go-gost/wisper
```

依赖：`github.com/go-gost/x`, `github.com/go-gost/core`（版本化模块依赖）

## Phase 2：Flutter 项目骨架（1 周）

### 初始化

```bash
cd /config/workspace/go-gost/wisper
flutter create --org com.gogost --project-name wisper flutter/
```

### 项目结构

```
wisper/
├── flutter/
│   ├── lib/
│   │   ├── main.dart
│   │   ├── app.dart
│   │   ├── config/
│   │   │   ├── theme.dart          # Wisper 亮/暗主题
│   │   │   ├── routes.dart         # GoRouter 路由
│   │   │   └── constants.dart      # max-width 等常量
│   │   ├── models/
│   │   │   ├── tunnel.dart
│   │   │   ├── entrypoint.dart
│   │   │   ├── tunnel_stats.dart
│   │   │   └── app_settings.dart
│   │   ├── services/
│   │   │   ├── go_backend.dart     # HTTP 客户端
│   │   │   └── platform_service.dart
│   │   ├── providers/
│   │   │   ├── tunnel_provider.dart
│   │   │   ├── entrypoint_provider.dart
│   │   │   ├── settings_provider.dart
│   │   │   └── stats_provider.dart
│   │   ├── pages/
│   │   │   ├── home/home_page.dart
│   │   │   ├── tunnel/
│   │   │   │   ├── tunnel_list_page.dart
│   │   │   │   ├── tunnel_detail_page.dart
│   │   │   │   └── tunnel_form_fields.dart
│   │   │   ├── entrypoint/
│   │   │   │   ├── entrypoint_list_page.dart
│   │   │   │   └── entrypoint_detail_page.dart
│   │   │   └── settings/settings_page.dart
│   │   ├── widgets/
│   │   │   ├── app_scaffold.dart
│   │   │   ├── tunnel_card.dart
│   │   │   ├── stats_row.dart
│   │   │   ├── copyable_text.dart
│   │   │   ├── nav_tabs.dart
│   │   │   ├── selector_field.dart
│   │   │   └── delete_confirm_dialog.dart
│   │   └── l10n/
│   │       ├── app_en.arb
│   │       └── app_zh.arb
│   └── pubspec.yaml
├── go-backend/                    # Go 源码（Phase 1 产物）
├── docs/
│   ├── flutter-ui-design.md       # 设计规范（Wisper 品牌版）
│   └── prototype/index.html       # HTML 原型（已完成）
├── go.mod
└── go.sum
```

### 技术选型

| 组件 | 选择 |
|---|---|
| 状态管理 | Riverpod 2.x |
| 路由 | GoRouter |
| HTTP 客户端 | Dart 内置 http |
| 序列化 | json_serializable |
| i18n | flutter_localizations + gen-l10n |

## Phase 3：核心页面（2 周）

按 HTML 原型的 9 个页面对照实现：

| 页面 | 路由 | Flutter 文件 |
|---|---|---|
| Home（Tunnel/Entrypoint Tab） | `/` | `home/home_page.dart` |
| Tunnel 类型选择 | `/tunnel/new` | `tunnel/tunnel_list_page.dart` |
| Tunnel 详情（查看） | `/tunnel/:type/:id` | `tunnel/tunnel_detail_page.dart` |
| Tunnel 详情（编辑/新建） | `/tunnel/:type/new` | `tunnel/tunnel_detail_page.dart` |
| File Tunnel 表单 | `/tunnel/file/new` | 同上（参数化） |
| HTTP Tunnel 表单 | `/tunnel/http/new` | 同上 |
| Entrypoint 类型选择 | `/entrypoint/new` | `entrypoint/entrypoint_list_page.dart` |
| Entrypoint 详情 | `/entrypoint/:type/:id` | `entrypoint/entrypoint_detail_page.dart` |
| Settings | `/settings` | `settings/settings_page.dart` |

### TunnelCard 布局（参考 HTML 原型最终版）

```
┌──────────────────────────────────────────────┐
│ My TCP Tunnel ●                        左列↔右列
│ TCP · 5m          │    ↕ 12/120  5.2 R/s
│ localhost:8080     │    ↑ 1.5 KB   0.8 KB/s
│                    │    ↓ 3.2 KB   1.2 KB/s
└──────────────────────────────────────────────┘
```

- 左列：名称+状态、类型·时间、endpoint
- 右列：统计数据，靠右对齐
- 窄屏自动堆叠（响应式）

## Phase 4：状态和交互（1 周）

- Riverpod Provider 集成（Tunnel/Entrypoint/Stats/Settings）
- Stats 轮询（1s 间隔）
- 复制到剪贴板
- 主题/i18n 切换
- Toast 通知
- Start/Stop 按钮状态切换
- Favorite 收藏切换
- Basic Auth 字段显隐

## Phase 5：平台构建和测试（1 周）

- 各平台构建（Windows/macOS/Linux/Android/iOS）
- Go 后端嵌入到 Flutter 资源
- 端到端测试

## Phase 6：Inspector 流量观测（低优先级，后续迭代）

按设计规范 §6 执行。

## Verification

1. `cd wisper && go build ./... && go vet ./...` — Go 后端编译通过
2. `cd wisper/flutter && flutter analyze` — Flutter 静态分析无错误
3. `cd wisper/flutter && flutter build <platform>` — 各平台构建成功
4. 启动 Go 后端 + Flutter UI，手动验证所有 9 个页面功能
5. 确认 `gost-plus/` 无变化
