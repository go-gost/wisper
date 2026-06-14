# Wisper 桌面版打包技术选型分析

## Context（背景）

Wisper 当前是「Go HTTP 服务 + 内嵌 Lit Web UI」的单进程应用，已具备打包为桌面应用的理想基础：

- 纯 Go、无 CGO、静态链接，跨平台编译干净（二进制 ~20–28MB）
- Web 资源通过 `//go:embed` 内嵌（[web.go](web.go)）
- 配置/日志路径已用 `os.UserConfigDir()` 做 OS 适配（[config/config.go:39-46](config/config.go#L39-L46)），无硬编码路径
- 完善的信号处理与优雅退出（[main.go:70-82](main.go#L70-L82)）
- 无子进程、无系统托盘、无单实例锁（这些将由桌面 shell 补齐）

**目标**：将 Wisper 打包为 Windows / Linux / Mac 原生桌面应用，并**保留未来扩展到移动端的可能**。应用形态为**常驻系统托盘 + 按需弹出窗口**（贴合「后台隧道管理器」的定位）。集成方式由框架决定，选各框架下风险最低的路径。

## 选型结论：Tauri 2.0

按「Desktop + mobile later」的取向，**Tauri 2.0 是唯一同时满足下列条件的成熟方案**：稳定（非 alpha）、同一份 shell 输出桌面 + iOS/Android、一等公民的系统托盘/单实例/自动更新、体积小（~5–15MB shell vs Electron 80–150MB）。

集成采用 **Sidecar 模式**：Tauri 以子进程方式启动**现有 Go 二进制**。**Go 代码与 Web 构建产物完全零改动**——Tauri（Rust 端）先挑一个空闲本机端口，再用 `-addr 127.0.0.1:<port>` 启动 Go sidecar，webview 直接加载该端口。直接复用 [main.go:25](main.go#L25) 现有的 `-addr` flag，无需任何 Go 侧改动。

## 候选框架对比（2026-06 现状）

| 维度 | **Tauri 2.0 ✅** | Wails v2 | Wails v3 | Electron | 轻量(托盘+浏览器) |
|---|---|---|---|---|---|
| 成熟度 | 稳定 | 稳定 | **Alpha**(alpha.98) | 极成熟 | — |
| 桌面平台 | Win/Linux/Mac | Win/Linux/Mac | Win/Linux/Mac | Win/Linux/Mac | 全平台 |
| **移动端** | **iOS/Android（稳定）** | ❌ 无 | 未完成 | ❌ 无 | ❌ |
| 后端语言 | Rust | **Go** | **Go** | Node.js | **Go** |
| Go 集成 | sidecar 子进程 | 原生绑定 | 原生绑定 | sidecar 子进程 | 无 shell |
| 二进制体积 | ~5–15MB | ~10–20MB | ~10–20MB | ~80–150MB | 最小(纯 Go) |
| 系统托盘 | ✅ | ✅ | ✅ | ✅ | ✅(fyne/systray) |
| 自动更新 | ✅ 内置 | 插件 | 插件 | ✅ | 需自建 |
| 工具链 | Rust+Go+Web | Go+Web | Go+Web | Node+Go+Web | Go+Web |
| WebView | 系统 WebView | 系统 WebView | 系统 WebView | 自带 Chromium | 系统/无 |

### 为什么不选 Wails（虽是 Go 原生，最贴合团队技能）

- **Wails v2**：仅桌面，**直接切断移动路径**，与「mobile later」冲突。
- **Wails v3**：截至 2026-06 仍是 alpha，移动支持未完成，API 可能变动，不宜作生产基石。

→ **若未来明确放弃移动端，或团队坚决不愿引入 Rust**，可改选 Wails v2/v3，集成方式改为「原生绑定」（把 `/api/*` handler 改为 Wails bound methods），代价是前端 `GoBackend` 类需重写。这是保留的备选路径。

### 为什么不选 Electron

体积是 Tauri 的 5–10 倍、内存高数倍，对「Go 服务 + 轻量 Web UI」属于明显过度打包。仅在「团队只熟 JS、完全不在意体积」时考虑。

### 轻量备选：系统托盘 + 系统浏览器

`fyne/systray` 等纯 Go 托盘库 + 打开默认浏览器访问 `localhost:8900`。体积最小、无额外运行时，但失去原生窗口体验，签名/自动更新需自建。仅适合「最小化桌面化」诉求，不满足「移动端复用」。

## 实施方案（Tauri 2.0，Sidecar 模式）

### 目录结构（与现有 Go 模块并存）
```
wisper/
├── main.go, web.go, api/, tunnel/, config/   # 现有 Go 后端，零改动
├── web-src/                                  # 现有 Lit 前端
├── src-tauri/                                # 新增：Tauri shell
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/
│   ├── capabilities/
│   └── src/main.rs                           # 启动 sidecar / 建托盘 / 开窗口
└── Makefile                                  # 新增 tauri / dist 目标
```

### 关键实现点

1. **Sidecar 打包**：`tauri.conf.json` 的 `bundle.externalBin` 指向构建好的 Go 二进制（按 Tauri 平台命名约定加后缀，如 `wisper-x86_64-pc-windows-msvc.exe`、`wisper-aarch64-apple-darwin`）。Makefile 新增目标：`make web` → `go build`（sidecar）→ `tauri build`。

2. **Tauri 挑端口 → 传 `-addr`**（Go 侧**零改动**）：在 `src-tauri/src/main.rs` 中，Tauri 先绑定一个临时 TCP socket 到 `127.0.0.1:0`，读取系统分配的端口，关闭该 socket，然后以 `wisper -addr 127.0.0.1:<port>` 启动 sidecar，webview 加载 `http://127.0.0.1:<port>`。约 10 行 Rust 代码，完全复用 [main.go:25](main.go#L25) 现有的 `-addr` flag。本机 localhost 上「挑端口 → Go 绑定」之间的 TOCTOU 竞态可忽略；同时只绑 `127.0.0.1`（而非默认的 `0.0.0.0`），避免 API 暴露到局域网。

3. **托盘 + 窗口生命周期**：用 Tauri `tray-icon` API 建常驻托盘图标；点击托盘 → 显示/聚焦主窗口；窗口关闭按钮 → `prevent_close` → 隐藏到托盘（隧道继续运行）；托盘右键菜单含「显示 / 退出」。退出时关闭 sidecar（触发现有 SIGTERM → 配置持久化流程）。

4. **单实例**：`tauri-plugin-single-instance`，防止重复启动。

5. **自动更新**：`@tauri-apps/plugin-updater` + 签名更新包，配合 GitHub Releases 托管。

### 平台分发与签名（成本主要在此）

| 平台 | 包格式 | 关键事项 |
|---|---|---|
| **Windows** | MSI / NSIS（tauri-bundler） | 代码签名（Azure Trusted Signing 或 EV 证书），否则 SmartScreen 拦截；WebView2 bootstrapper（Win10/11 多已预装） |
| **macOS** | `.app` / `.dmg` | **代码签名 + 公证(Notarization) 必备**，否则 Gatekeeper 阻止运行；Universal Binary（ARM64 + x86_64）；需 Apple Developer 账号（$99/年） |
| **Linux** | AppImage（首选，单文件免装）/ .deb / .rpm | WebKitGTK 运行时依赖（`libwebkit2gtk-4.1`）；Flatpak/Snap 可选 |

代码签名是桌面分发最大的隐性成本（尤其 macOS 公证）。仅内部使用可跳过；面向终端用户分发建议完成。

### 构建/CI 矩阵

GitHub Actions 三平台并行：每个 OS runner 装 Rust + Go + Node → `make web` → `go build`（sidecar）→ `tauri build` → 上传产物。macOS runner 上签名公证；Windows runner 上签名。

## 移动端未来路径（坦诚说明）

选 Tauri 的核心收益是「桌面现在能用、移动 shell 未来可复用」。但需明确：**移动端真正难点不在 shell，而在 Go 后端如何跑在移动设备上**——

- iOS/Android 不允许 spawn 外部子进程，**sidecar 模式不适用于移动端**
- 需把 Go 后端（含 GOST 网络）编译进 app：`gomobile bind` 或 app 内嵌本地 server
- GOST 大量网络代码在移动端的可用性未经验证，是独立的大工作项

→ Tauri 让「移动 shell + Web UI 复用」这一半变得轻松；「Go-on-mobile 后端」是另一条独立工作流，需单独评估，**不在本次桌面打包范围内**。

## 验证（Verification）

1. `make web && go build -o wisper .` 仍通过（Go 侧完全零改动，无需回归验证）
2. `go test ./...` 全绿（现有 API 测试不受影响）
3. `tauri dev`：本地启动，确认 sidecar 起来、webview 加载到正确端口、API 可用
4. 托盘行为：点击托盘显隐窗口、关窗隐藏到托盘、隐藏期间隧道持续运行（看 `/api/stats`）
5. 三平台 `tauri build` 各产出安装包；Windows/Linux/macOS 各装一遍验证
6. 退出应用：sidecar 进程被回收，`~/.config/wisper/config.yml` 被正确持久化
7. （可选）自动更新：构造测试更新通道验证 updater

## 框架现状来源（2026-06 核实）

- Wails v3：仍 ALPHA（`v3.0.0-alpha.98`，2026-06-03），移动支持未完成
- Tauri 2.0：稳定，单一代码库输出 iOS/Android/桌面，官方 App Store 分发指南
