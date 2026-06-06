# Wisper Flutter UI 设计规范

## Context

将 Wisper 从 Gio (Go) 迁移到 Flutter (Dart)，Go 后端作为嵌入式 HTTP 服务运行。本文档定义 Flutter 前端的完整 UI 设计。

当前 Gio 版本的 UI 特征：
- 单窗口应用，最大宽度 800dp 居中
- 11 个页面，栈式导航（push/pop + 返回键）
- 7 个自定义 Widget
- 亮色/暗色/系统主题
- 中英双语 i18n
- 每秒刷新的实时流量统计

---

## 一、项目结构

```
wisper/
├── lib/
│   ├── main.dart                    # 入口，启动 Go 后端 + Flutter UI
│   ├── app.dart                     # MaterialApp + 路由配置
│   │
│   ├── config/
│   │   ├── theme.dart               # ThemeData（亮/暗），对应 Gio palette
│   │   ├── routes.dart              # GoRouter 路由定义
│   │   └── constants.dart           # MaxWidth=800 等常量
│   │
│   ├── models/
│   │   ├── tunnel.dart              # Tunnel DTO（id, name, type, endpoint, status, stats...）
│   │   ├── entrypoint.dart          # EntryPoint DTO
│   │   ├── tunnel_stats.dart        # ServiceStats（connections, bytes, rates）
│   │   └── app_settings.dart        # Settings（server, lang, theme）
│   │
│   ├── services/
│   │   ├── go_backend.dart          # HTTP 客户端，与 Go 服务通信
│   │   └── platform_service.dart    # 进程管理（启动/停止 Go 二进制）
│   │
│   ├── providers/
│   │   ├── tunnel_provider.dart     # Tunnel 列表 + CRUD 操作
│   │   ├── entrypoint_provider.dart # EntryPoint 列表 + CRUD 操作
│   │   ├── settings_provider.dart   # 配置读写
│   │   └── stats_provider.dart      # 定时轮询统计数据（1s 间隔）
│   │
│   ├── pages/
│   │   ├── home/
│   │   │   └── home_page.dart       # 主页（Tab: Tunnel / Entrypoint）
│   │   ├── tunnel/
│   │   │   ├── tunnel_list_page.dart    # Tunnel 类型选择
│   │   │   ├── tunnel_detail_page.dart  # 通用 Tunnel 详情（参数化）
│   │   │   └── tunnel_form_fields.dart  # 各类型表单字段组件
│   │   ├── entrypoint/
│   │   │   ├── entrypoint_list_page.dart
│   │   │   └── entrypoint_detail_page.dart
│   │   └── settings/
│   │       └── settings_page.dart
│   │
│   ├── widgets/
│   │   ├── app_scaffold.dart        # 统一页面骨架（max-width 居中）
│   │   ├── tunnel_card.dart         # 列表中的 Tunnel/Entrypoint 卡片
│   │   ├── stats_row.dart           # 流量统计行（图标 + 数值 + 速率）
│   │   ├── copyable_text.dart       # 可复制的文本（ID、Entrypoint）
│   │   ├── nav_tabs.dart            # Tunnel/Entrypoint 切换 Tab
│   │   ├── selector_field.dart      # 下拉选择器（语言、主题）
│   │   └── delete_confirm_dialog.dart # 删除确认对话框
│   │
│   └── l10n/
│       ├── app_en.arb               # 英文字符串
│       └── app_zh.arb               # 中文字符串
│
├── go-backend/                      # Go 后端源码（从现有项目提取）
│   ├── main.go                      # HTTP API 服务器入口
│   ├── api/                         # HTTP handler
│   ├── tunnel/                      # 现有 tunnel 包（几乎不变）
│   ├── entrypoint/                  # 现有 entrypoint 包
│   ├── config/                      # 现有 config 包（去 Gio 依赖）
│   └── runner/                      # 现有 runner 包
│
├── pubspec.yaml
└── README.md
```

---

## 二、技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 状态管理 | **Riverpod 2.x** | 编译时安全，支持异步状态，比 Provider 更现代 |
| 路由 | **GoRouter** | 声明式路由，支持深链接，栈式导航 |
| HTTP 客户端 | **Dart 内置 http** | localhost 通信，无需复杂功能 |
| 序列化 | **json_serializable** | 代码生成，类型安全 |
| i18n | **flutter_localizations + gen-l10n** | Flutter 官方方案，ARB 文件 |
| 进程管理 | **Process + dart:io** | 启动 Go 二进制作为子进程 |

---

## 三、Go 后端 HTTP API 设计

```
# Tunnel CRUD
GET    /api/tunnels                  # 列表
POST   /api/tunnels                  # 创建
GET    /api/tunnels/:id              # 详情
PUT    /api/tunnels/:id              # 更新
DELETE /api/tunnels/:id              # 删除
POST   /api/tunnels/:id/start       # 启动
POST   /api/tunnels/:id/stop        # 停止

# Entrypoint CRUD（同上）
GET    /api/entrypoints
POST   /api/entrypoints
GET    /api/entrypoints/:id
PUT    /api/entrypoints/:id
DELETE /api/entrypoints/:id
POST   /api/entrypoints/:id/start
POST   /api/entrypoints/:id/stop

# Stats
GET    /api/stats                    # 所有 tunnel/entrypoint 的统计

# Config
GET    /api/config                   # 读取配置
PUT    /api/config                   # 更新配置
```

JSON 响应格式：
```json
{
  "id": "uuid-string",
  "name": "My Tunnel",
  "type": "tcp",
  "endpoint": "localhost:8080",
  "entrypoint": "https://xxx.wisper.app",
  "status": "running",
  "favorite": false,
  "created_at": "2026-01-15T10:30:00Z",
  "options": { "username": "", "password": "", "basic_auth": false },
  "stats": {
    "current_conns": 5,
    "total_conns": 120,
    "request_rate": 5.2,
    "input_bytes": 3276,
    "output_bytes": 1536,
    "input_rate_bytes": 1280,
    "output_rate_bytes": 820
  }
}
```

---

## 四、页面设计

### 4.1 通用布局框架

所有页面使用统一的 `AppScaffold`：

```
┌──────────────────────────────────────────────────────────┐
│                    窗口（全宽）                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │            内容区域（max-width: 800px 居中）         │  │
│  │                                                    │  │
│  │  [AppBar / 自定义 Header]                           │  │
│  │                                                    │  │
│  │  [Body content（可滚动）]                            │  │
│  │                                                    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Flutter 实现：
```dart
// app_scaffold.dart
class AppScaffold extends StatelessWidget {
  final Widget? appBar;
  final Widget body;
  final Widget? floatingActionButton;

  @override
  Widget build(BuildContext context) {
    return Center(  // 水平居中
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 800),
        child: Scaffold(
          body: Column(children: [
            if (appBar != null) appBar!,
            Expanded(child: body),
          ]),
          floatingActionButton: floatingActionButton,
        ),
      ),
    );
  }
}
```

### 4.2 主页（Home Page）

**路由**：`/`

```
┌────────────────────────────────────────┐
│ [AppIcon]           [★ Fav] [⚙ Settings] │  ← header
│                                        │
│        ┌──────────┬──────────────┐     │
│        │ Tunnel ▶ │ Entrypoint   │     │  ← Nav Tabs（pill 样式）
│        └──────────┴──────────────┘     │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ My TCP Tunnel              ● 运行中│  │  ← TunnelCard
│  │ Type: TCP            5m 运行时长  │  │
│  │ localhost:8080                    │  │
│  │ ↗ 12 / 120 连接     5.2 R/s     │  │
│  │ ↑ 1.5 KB  0.8 KB/s              │  │
│  │ ↓ 3.2 KB  1.2 KB/s              │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ File Share               ● 运行中 │  │
│  │ Type: FILE           2h 运行时长  │  │
│  │ /home/user/files                 │  │
│  │ ↗ 3 / 45 连接        1.1 R/s    │  │
│  │ ↑ 5.2 KB  2.1 KB/s             │  │
│  │ ↓ 12.8 KB  5.6 KB/s            │  │
│  └──────────────────────────────────┘  │
│                                        │
│                              ┌───┐     │
│                              │ + │     │  ← FAB（右下角）
│                              └───┘     │
└────────────────────────────────────────┘
```

**TunnelCard 布局（两列式）**：
```
┌──────────────────────────────────────────────┐
│ 左列                          │          右列 │
│ My TCP Tunnel ●               │  ↕ 12/120  5.2 R/s
│ TCP · 5m                      │  ↑ 1.5 KB   0.8 KB/s
│ localhost:8080                │  ↓ 3.2 KB   1.2 KB/s
└──────────────────────────────────────────────┘
```
- 左列：名称+状态指示器、类型·运行时长、endpoint
- 右列：统计数据，靠右对齐
- 窄屏（≤600px）自动上下堆叠（响应式）

**Flutter Widget 树**：
```
HomeScreen
└── AppScaffold
    ├── appBar: HomeHeader
    │   ├── AppIcon (Image.asset, 50x50)
    │   ├── Spacer
    │   ├── IconButton(star/favorite, color: red/grey)
    │   └── IconButton(settings)
    ├── body: Column
    │   ├── NavTabs(tabs: ['Tunnel', 'Entrypoint'])
    │   └── Expanded
    │       └── Consumer(builder:)  ← Riverpod 监听 tunnel/entrypoint 列表
    │           └── ListView.builder
    │               └── TunnelCard(item: tunnel)
    └── floatingActionButton: FloatingActionButton(
            icon: Icons.add,
            onPressed: → /tunnel/new 或 /entrypoint/new
        )
```

**TunnelCard Widget**：
```dart
class TunnelCard extends StatelessWidget {
  // 卡片使用 Card + InkWell
  // 左侧：名称 + 状态指示器、类型·时长、endpoint
  // 右侧：统计数据（connections, upload, download）
  Widget build(context) {
    return Card(
      color: theme.listBg,           // BlueGrey50 / Grey700
      shape: RoundedRectangleBorder(borderRadius: 16),
      child: InkWell(
        borderRadius: 16,
        onTap: → /tunnel/{id},
        child: Padding(padding: 16, child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 左列：名称、类型、endpoint
            Expanded(
              flex: 3,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Text(name, style: semiBold),
                  SizedBox(width: 8),
                  Icon(circle, color: green/red/grey, size: 12),
                ]),
                SizedBox(height: 4),
                Text('$type · $duration'),
                SizedBox(height: 4),
                Text(endpoint),
              ]),
            ),
            // 右列：统计数据
            Expanded(
              flex: 2,
              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                StatsRow(icon: Icons.swap_vert, stats: '12/120', rate: '5.2 R/s'),
                SizedBox(height: 4),
                StatsRow(icon: Icons.arrow_upward, stats: '1.5 KB', rate: '0.8 KB/s'),
                SizedBox(height: 4),
                StatsRow(icon: Icons.arrow_downward, stats: '3.2 KB', rate: '1.2 KB/s'),
              ]),
            ),
          ],
        )),
      ),
    );
  }
}
```

### 4.3 Tunnel 类型选择页

**路由**：`/tunnel/new`

```
┌────────────────────────────────────────┐
│ [← Back]  Tunnel                      │  ← AppBar
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ File                        [→]  │  │  ← 类型卡片
│  │ Share files from a directory      │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ HTTP                        [→]  │  │
│  │ Share a local HTTP server         │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ TCP                         [→]  │  │
│  │ Forward a local TCP port          │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ UDP                         [→]  │  │
│  │ Forward a local UDP port          │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**Flutter Widget 树**：
```
TunnelListScreen
└── AppScaffold
    ├── appBar: AppBar(leading: BackButton, title: 'Tunnel')
    └── body: ListView(children: [
         TypeCard(name: 'File', desc: '...', onTap: → /tunnel/file/new),
         TypeCard(name: 'HTTP', desc: '...', onTap: → /tunnel/http/new),
         TypeCard(name: 'TCP', desc: '...', onTap: → /tunnel/tcp/new),
         TypeCard(name: 'UDP', desc: '...', onTap: → /tunnel/udp/new),
       ])
```

### 4.4 Tunnel 详情页（以 TCP 为例）

**路由**：`/tunnel/tcp/:id`（编辑已有）或 `/tunnel/tcp/new`（新建）

**查看模式**：
```
┌────────────────────────────────────────┐
│ [←] TCP  [★] [▶ Start] [🗑] [✏ Edit] │  ← AppBar
│                                        │
│  ┌──────────────────────────────────┐  │
│  │                                  │  │  ← Card surface
│  │  a1b2c3d4-e5f6-...        [📋]  │  │  ← ID（可复制）
│  │  https://xxx.wisper.app  [📋]  │  │  ← Entrypoint（可复制）
│  │                                  │  │
│  │  Name                            │  │
│  │  ┌──────────────────────────┐    │  │
│  │  │ My TCP Tunnel        (只读) │  │  │
│  │  └──────────────────────────┘    │  │
│  │                                  │  │
│  │  Endpoint                        │  │
│  │  ┌──────────────────────────┐    │  │
│  │  │ localhost:8080        (只读) │  │  │
│  │  └──────────────────────────┘    │  │
│  │                                  │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**编辑模式**：
```
┌────────────────────────────────────────┐
│ [←] TCP              [✓ Save]          │  ← AppBar（无 Favorite/Start/Delete）
│                                        │
│  ┌──────────────────────────────────┐  │
│  │  Name                            │  │
│  │  ┌──────────────────────────┐    │  │
│  │  │ My TCP Tunnel             │    │  │  ← 可编辑
│  │  └──────────────────────────┘    │  │
│  │                                  │  │
│  │  Endpoint                        │  │
│  │  ┌──────────────────────────┐    │  │
│  │  │ localhost:8080          ↓ │    │  │  ← 可编辑 + 验证
│  │  │ Invalid address              │  │  ← 错误提示
│  │  └──────────────────────────┘    │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**File Tunnel 额外字段**：
```
│  │  Basic Auth               [开关] │  │  ← Switch
│  │                                  │  │
│  │  ┌──────────────────────────┐    │  │
│  │  │ Username                   │    │  │  ← 仅当 basicAuth=true 显示
│  │  └──────────────────────────┘    │  │
│  │  ┌──────────────────────────┐    │  │
│  │  │ Password               👁 │    │  │  ← 密码可见性切换
│  │  └──────────────────────────┘    │  │
```

**HTTP Tunnel 额外字段**：
```
│  │  Rewrite Host             [开关] │  │  ← Switch
│  │  Enable TLS               [开关] │  │  ← Switch
```

**UDP Tunnel 额外字段**：
```
│  │  (同 TCP，但验证 UDP 地址)        │  │
```

**Flutter Widget 树**：
```
TunnelDetailScreen
├── params: type (file/http/tcp/udp), id (optional)
├── state: isEditing (true if id==null or user tapped Edit)
│
└── AppScaffold
    ├── appBar: DetailAppBar(
    │     leading: BackButton,
    │     title: typeLabel,
    │     actions: [
    │       if !isNew: FavoriteButton,
    │       if !isNew: StartStopButton,
    │       if !isNew: DeleteButton(→ ConfirmDialog),
    │       isEditing ? SaveButton : EditButton,
    │     ]
    │   )
    └── body: SingleChildScrollView(
        child: Card(
          child: Padding(padding: 16, child: Column(
            children: [
              if !isNew: CopyableText(label: tunnel.id),
              if !isNew: CopyableText(label: tunnel.entrypoint),
              // 通用字段
              TextFormField(label: 'Name', ...),
              TextFormField(label: 'Endpoint', validator: ...),
              // 类型特有字段
              if type==file: ...basicAuth, username, password fields
              if type==http: ...rewriteHost, enableTLS switches
            ],
          )),
        ),
      )
```

### 4.5 Settings 页

**路由**：`/settings`

```
┌────────────────────────────────────────┐
│ [← Back]  Settings                    │  ← AppBar
│                                        │
│            [AppIcon 80x80]             │
│               Wisper                   │
│              v0.1.0                    │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ Language              English  ▶ │  │  ← SelectorField
│  │ Theme                   System ▶ │  │  ← SelectorField
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**Flutter Widget 树**：
```
SettingsScreen
└── AppScaffold
    ├── appBar: AppBar(leading: BackButton, title: 'Settings')
    └── body: Column(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          SizedBox(height: 32),
          Image.asset(appIcon, width: 80, height: 80),
          SizedBox(height: 16),
          Text('Wisper', style: semiBold),
          SizedBox(height: 8),
          Text(version),
          SizedBox(height: 32),
          Card(
            child: Column(children: [
              SelectorField(
                title: 'Language',
                value: currentLang,
                options: ['English', '中文'],
                onChanged: updateLang,
              ),
              SelectorField(
                title: 'Theme',
                value: currentTheme,
                options: ['System', 'Light', 'Dark'],
                onChanged: updateTheme,
              ),
            ]),
          ),
        ],
      )
```

### 4.6 Entrypoint 页面

与 Tunnel 页面结构完全对称：

- `/entrypoint/new` — 类型选择（TCP / UDP）
- `/entrypoint/tcp/:id` — TCP EntryPoint 详情
- `/entrypoint/udp/:id` — UDP EntryPoint 详情
- 额外字段：Keepalive（Switch）、TTL（TextInput）

### 4.7 全局覆盖层

**Toast 通知**：
```
┌────────────────────────────────────────┐
│                                        │
│   ┌──────────────────────────────┐     │  ← 屏幕上方 1/5 位置
│   │ ℹ / ⚠ / ✖  Error message    │     │  ← 3 秒自动消失
│   └──────────────────────────────┘     │
│                                        │
└────────────────────────────────────────┘
```

使用 Flutter 的 `ScaffoldMessenger.showSnackBar` 或自定义 `OverlayEntry`。

**确认对话框（删除）**：
```
┌────────────────────────────────────────┐
│           Delete Tunnel?               │
│                                        │
│     This action cannot be undone.      │
│                                        │
│         [Cancel]    [Delete]           │
└────────────────────────────────────────┘
```

使用 Flutter 的 `showDialog` + `AlertDialog`。

---

## 五、主题设计

### 亮色主题（对应 Gio light palette）
```dart
ThemeData(
  brightness: Brightness.light,
  scaffoldBackgroundColor: Colors.white,           // Bg: White
  colorScheme: ColorScheme.light(
    primary: Color(0xFF7C3AED),                    // Wisper Purple: primary brand
    onPrimary: Colors.white,                        // ContrastFg: White
    surface: Colors.white,
    onSurface: Colors.black,                        // Fg: Black
  ),
  cardTheme: CardTheme(
    color: Color(0xFFF5F5F5),                       // ContentSurfaceBg: Grey50
    elevation: 1,
    shape: RoundedRectangleBorder(borderRadius: 16),
  ),
  // 自定义扩展色
  extensions: [
    WisperColors(
      listBg: Color(0xFFECEFF1),                    // BlueGrey50
      navButtonBg: Color(0xFFECEFF1),               // BlueGrey50
      navButtonContrastBg: Color(0xFFCFD8DC),       // BlueGrey100
      notificationBg: Color(0xFFE0E0E0),            // Grey200
    ),
  ],
);
```

### 暗色主题（对应 Gio dark palette）
```dart
ThemeData(
  brightness: Brightness.dark,
  scaffoldBackgroundColor: Color(0xFF212121),       // Bg: Grey900
  colorScheme: ColorScheme.dark(
    primary: Color(0xFF06B6D4),                     // Wisper Cyan: accent brand
    onPrimary: Colors.white,
    surface: Color(0xFF212121),
    onSurface: Colors.white,
  ),
  cardTheme: CardTheme(
    color: Color(0xFF424242),                        // ContentSurfaceBg: Grey800
    elevation: 1,
    shape: RoundedRectangleBorder(borderRadius: 16),
  ),
  extensions: [
    WisperColors(
      listBg: Color(0xFF616161),                     // Grey700
      navButtonBg: Color(0xFF424242),                // Grey800
      navButtonContrastBg: Color(0xFF757575),        // Grey600
      notificationBg: Color(0xFF616161),             // Grey700
    ),
  ],
);
```

### 状态指示器颜色
| 状态 | 颜色 |
|------|------|
| 运行中 | `GreenA700` (#00C853) |
| 错误 | `Red600` (#E53935) |
| 已停止 | `Grey600` (#757575) |
| 收藏 | `Red500` (#F44336) |

---

## 六、导航路由

```dart
// routes.dart
final router = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (_, __) => HomeScreen()),
    GoRoute(path: '/settings', builder: (_, __) => SettingsScreen()),
    GoRoute(
      path: '/tunnel/new',
      builder: (_, __) => TunnelTypeListScreen(),
      routes: [
        GoRoute(path: 'file', builder: (_, __) => TunnelDetailScreen(type: 'file')),
        GoRoute(path: 'http', builder: (_, __) => TunnelDetailScreen(type: 'http')),
        GoRoute(path: 'tcp', builder: (_, __) => TunnelDetailScreen(type: 'tcp')),
        GoRoute(path: 'udp', builder: (_, __) => TunnelDetailScreen(type: 'udp')),
      ],
    ),
    GoRoute(
      path: '/tunnel/:type/:id',
      builder: (_, state) => TunnelDetailScreen(
        type: state.pathParameters['type'],
        id: state.pathParameters['id'],
      ),
    ),
    GoRoute(path: '/entrypoint/new', builder: (_, __) => EntrypointTypeListScreen(),
      routes: [
        GoRoute(path: 'tcp', builder: (_, __) => EntrypointDetailScreen(type: 'tcp')),
        GoRoute(path: 'udp', builder: (_, __) => EntrypointDetailScreen(type: 'udp')),
      ],
    ),
    GoRoute(
      path: '/entrypoint/:type/:id',
      builder: (_, state) => EntrypointDetailScreen(
        type: state.pathParameters['type'],
        id: state.pathParameters['id'],
      ),
    ),
  ],
);
```

---

## 七、状态管理

### Provider 设计

```dart
// tunnel_provider.dart
@riverpod
class TunnelList extends _$TunnelList {
  @override
  Future<List<Tunnel>> build() async {
    final backend = ref.read(goBackendProvider);
    return backend.getTunnels();
  }

  Future<void> create(TunnelConfig config) async { ... }
  Future<void> update(String id, TunnelConfig config) async { ... }
  Future<void> delete(String id) async { ... }
  Future<void> start(String id) async { ... }
  Future<void> stop(String id) async { ... }
}

// stats_provider.dart
@riverpod
class StatsPoller extends _$StatsPoller {
  Timer? _timer;

  @override
  Map<String, TunnelStats> build() {
    _timer = Timer.periodic(Duration(seconds: 1), (_) => _poll());
    ref.onDispose(() => _timer?.cancel());
    return {};
  }

  Future<void> _poll() async {
    final backend = ref.read(goBackendProvider);
    final stats = await backend.getAllStats();
    state = stats;
  }
}
```

---

## 八、Go 后端集成

### 进程生命周期

```dart
// platform_service.dart
class GoBackendService {
  Process? _process;

  Future<void> start() async {
    final exePath = await _getBackendPath();  // 平台相关路径
    _process = await Process.start(exePath, ['-addr', '127.0.0.1:0']);

    // 读取 Go 服务输出的实际端口
    _process!.stdout.transform(utf8.decoder).listen((line) {
      if (line.contains('listening on')) {
        _port = _parsePort(line);
      }
    });
  }

  Future<void> stop() async {
    _process?.kill();
  }
}
```

### HTTP 客户端

```dart
// go_backend.dart
class GoBackend {
  final String baseUrl;

  Future<List<Tunnel>> getTunnels() async {
    final resp = await http.get(Uri.parse('$baseUrl/api/tunnels'));
    return (jsonDecode(resp.body) as List).map((e) => Tunnel.fromJson(e)).toList();
  }

  Future<Tunnel> createTunnel(TunnelConfig config) async { ... }
  Future<void> startTunnel(String id) async { ... }
  // ... 其余 API
}
```

---

## 九、国际化

使用 Flutter 官方 gen-l10n 方案：

```
l10n.yaml
├── arb-dir: lib/l10n
├── template-arb-file: app_en.arb
└── output-localization-file: app_localizations.dart
```

```json
// app_en.arb
{
  "@@locale": "en",
  "tunnel": "Tunnel",
  "entrypoint": "Entrypoint",
  "settings": "Settings",
  "name": "Name",
  "endpoint": "Endpoint",
  "type": "Type",
  "deleteTunnel": "Delete Tunnel",
  "fileTunnelDesc": "Share files from a local directory",
  "httpTunnelDesc": "Share a local HTTP server",
  "tcpTunnelDesc": "Forward a local TCP port",
  "udpTunnelDesc": "Forward a local UDP port",
  "basicAuth": "Basic Auth",
  "username": "Username",
  "password": "Password",
  "language": "Language",
  "theme": "Theme",
  "themeLight": "Light",
  "themeDark": "Dark",
  "themeSystem": "System",
  "errInvalidAddr": "Invalid address",
  "errDirectory": "is not a directory"
}
```

```json
// app_zh.arb
{
  "@@locale": "zh",
  "tunnel": "隧道",
  "entrypoint": "入口",
  "settings": "设置",
  "name": "名称",
  "endpoint": "端点",
  "type": "类型",
  "deleteTunnel": "删除隧道",
  "fileTunnelDesc": "共享本地文件目录",
  "httpTunnelDesc": "共享本地 HTTP 服务",
  "tcpTunnelDesc": "转发本地 TCP 端口",
  "udpTunnelDesc": "转发本地 UDP 端口",
  "basicAuth": "基本认证",
  "username": "用户名",
  "password": "密码",
  "language": "语言",
  "theme": "主题",
  "themeLight": "浅色",
  "themeDark": "深色",
  "themeSystem": "跟随系统",
  "errInvalidAddr": "无效地址",
  "errDirectory": "不是目录"
}
```

---

## 十、验证方案

### 构建验证
```bash
# Flutter 项目
cd wisper/flutter && flutter analyze
cd wisper/flutter && flutter build windows
cd wisper/flutter && flutter build macos
cd wisper/flutter && flutter build linux
cd wisper/flutter && flutter build apk
cd wisper/flutter && flutter build ios

# Go 后端
cd wisper/go-backend && go build ./...
cd wisper/go-backend && go vet ./...
```

### 功能验证
1. 启动 Go 后端服务，确认所有 HTTP API 端点响应正确
2. Flutter UI 能创建/编辑/删除/启停各类型的 Tunnel 和 Entrypoint
3. Stats 实时更新（1 秒刷新）
4. 亮色/暗色主题切换正常
5. 中英文切换正常
6. 返回键导航正常
7. ID/Entrypoint 复制到剪贴板正常
8. 删除确认对话框正常
9. 错误通知 Toast 正常显示

---

## 十一、实施顺序

1. **Phase 1：Go HTTP API 层**（1 周）
   - 修改 `config/config.go` 去除 Gio 依赖
   - 新增 `api/` 包，实现所有 HTTP 端点
   - 修改 `main.go` 启动 HTTP 服务而非 Gio 事件循环

2. **Phase 2：Flutter 项目骨架**（1 周）
   - 初始化 Flutter 项目
   - 配置主题、路由、i18n
   - 实现 AppScaffold、GoBackend 服务
   - 实现 Go 进程管理

3. **Phase 3：核心页面**（2 周）
   - Home 页（Tunnel/Entrypoint 列表）
   - Tunnel 类型选择 + 详情页（4 种类型）
   - Entrypoint 类型选择 + 详情页（2 种类型）
   - Settings 页

4. **Phase 4：状态和交互**（1 周）
   - Riverpod Provider 集成
   - Stats 轮询
   - 复制到剪贴板
   - 主题/i18n 切换
   - Toast 通知

5. **Phase 5：平台构建和测试**（1 周）
   - 各平台构建配置
   - 端到端测试
   - 打磨和 Bug 修复

6. **Phase 6：Inspector 流量观测集成**（低优先级，后续迭代）
   - 将 [inspector](/config/workspace/go-gost/inspector/) 的流量观测 UI 集成到 Flutter 客户端
   - Inspector 当前是独立 Web 应用（React + Go），通过 Redis Pub/Sub 接收 GOST 节点的流量记录，存储到 MongoDB
   - 集成后用户无需单独部署 inspector，直接在 Wisper 内查看隧道流量
   - 需要实现的 Inspector 功能：
     - **历史查询页** — 按协议类型（HTTP/WebSocket/TLS/DNS）浏览流量记录，支持按 tunnel_id、service、session、时间范围过滤，分页加载
     - **实时流量页** — 通过 WebSocket 流式查看实时流量记录，带连接状态指示和停止/重连/清空控制
     - **协议详情展开** — HTTP（请求/响应 headers + body，支持 text/hex/JSON 切换）、WebSocket（方向、opcode、payload）、TLS（SNI、版本、ALPN、ClientHello/ServerHello 解析）、DNS（查询名、类型、回答段）
     - **过滤栏** — tunnel_id、service、session ID、时间范围选择器
   - Go 后端需新增的 API（复用 inspector 现有逻辑）：
     - `GET /api/records/query` — 历史记录查询（MongoDB）
     - `WS /api/records/tail` — 实时流（Redis Pub/Sub）
   - Flutter 端新增页面：
     - `/inspector` — Inspector 入口（从主页或 Tunnel 详情页进入）
     - `/inspector/query/:type` — 历史查询（type: http/websocket/tls/dns）
     - `/inspector/live/:type` — 实时流量
   - 项目结构扩展：
     ```
     lib/
     ├── pages/inspector/
     │   ├── inspector_home_page.dart      # Inspector 入口
     │   ├── query_page.dart               # 历史查询
     │   ├── live_page.dart                # 实时流量
     │   ├── record_detail_sheet.dart      # 记录详情展开面板
     │   └── filter_bar.dart               # 过滤栏组件
     ├── widgets/
     │   ├── body_viewer.dart              # Body 查看器（text/hex/json）
     │   └── tls_parser.dart               # TLS ClientHello/ServerHello 解析
     └── providers/
         └── inspector_provider.dart       # Inspector 数据 Provider
     ```
   - **依赖**：需要 MongoDB（存储历史记录）和可选的 Redis（实时流），这两个依赖可能需要在 Go 后端中集成 inspector 的 recorder 功能
