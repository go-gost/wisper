# 电池优化豁免（设置页状态 + 一跳跳转）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置页常显 Doze 豁免状态，未豁免时一键跳系统"忽略电池优化"对话框——让用户不必记住 5 层深的系统入口，也能在重装 APK 掉豁免时立刻看见。

**Architecture:** 纯 Android + 前端，**Go 后端零改动**。`MainActivity.JsBridge` 加两个 `@JavascriptInterface` 方法（查状态 / 请求豁免），照抄 `pickDir` 的 callbackId 模式；设置页加一行 `selector-row`，存在性门控（无 bridge 不渲染）。豁免状态每次 `connectedCallback` 重查，用户从系统对话框回来即刷新。

**Tech Stack:** Kotlin（Android bridge）、Lit + TypeScript（`web-src`，`npm run typecheck` 门禁）。

**Spec:** `wisper/docs/superpowers/specs/2026-10-07-battery-exemption-design.md`
（§目标/§方案/§成功标准/§测试 是本 plan 的依据）

## Global Constraints

- **Go 后端一行不碰**（无 API、无 config、无 runner 改动）。
- `core/` 一行不碰；p2p 模块一行不碰；本 plan 只动 `android/` 与 `web-src/`。
- 目标机 **Pixel 9 / stock AOSP**：该权限与系统「电池使用 → 无限制」是**同一个**
  power-save 白名单（`dumpsys deviceidle whitelist`）。权限只用于能自己跳对话框。
- 用户在系统里手动设「无限制」与本实现**完全等价**，不是替代关系。
- `callbackId` 必须过 `^[A-Za-z0-9_]{1,64}$` 校验（回调名被插值进 JS，照抄 `armVpn` 既有防护）。
- 不做"不再提示"记忆：豁免按安装持久、卸载即丢，系统对话框拒绝一次后下次进设置页仍可点。
- 文案只说作用（`batteryExemptTitle`/`On`/`Off`/`Hint`），不出现 Doze / derp / power-save 等内部词；中英各一。

## Review Focus

- **重装 APK 后豁免丢失**：设置页必须显示"未豁免"，不能沿用上次的状态缓存——
  `_batteryExempt` 初值必须是"未知/未豁免"而不是 `true`，且每次 `connectedCallback`
  都重新查 bridge（Task 2 的 `_queryBatteryExempt` 步骤 pin 死）。
- **用户拒绝系统对话框**：行保持"未豁免"，不报错、不消失、下次仍可点——
  `requestBatteryExemption` 不做乐观置位（Task 1 pin 死：状态只由查询写）。
- **bridge 缺失的运行环境**（桌面/浏览器）：整行不渲染，且不调用不存在的
  `WisperNative.*`（Task 2 用 `?.` 存在性门控，照抄 `_isNativeDirPicker`）。
- **`resolveActivity` 为空**：静默返回，不崩（Task 1 pin 死）。
- **GoBuild/编译门槛**：`npm run typecheck` + Android Gradle 编译（本机无 npm/node，
  见 Task 3 备选验证路径）。

---

### Task 1: Android bridge（查状态 + 请求豁免）

**Files:**
- Modify: `wisper/android/app/src/main/AndroidManifest.xml`（在 `FOREGROUND_SERVICE_*`
  那组后加一行）
- Modify: `wisper/android/app/src/main/java/run/gost/wisper/MainActivity.kt`
  （`JsBridge` 内 `pickDir` 之后，约 511 行附近）

**Interfaces:**
- Produces: JsBridge 两个方法，Task 2 按名字调用——
  - `@JavascriptInterface fun isBatteryExempt(callbackId: String)`
    回调 `callbackId(<boolean 字面量>)`，即 `runOnUiThread` 里
    `webView.evaluateJavascript("$callbackId($exempt)", null)`。
  - `@JavascriptInterface fun requestBatteryExemption()`（无回调）。

- [ ] **Step 1: Manifest 加权限**

在 `FOREGROUND_SERVICE_SYSTEM_EXEMPTED` 那行之后加：

```xml
    <!-- Doze: without power-save exemption the system cuts this app's network
         while the screen is off. Same switch as Settings > Battery > Unrestricted;
         this permission is what lets the app show its state and open the dialog. -->
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

- [ ] **Step 2: 实现 `isBatteryExempt`**

放在 `JsBridge` 内。语义要求（逐条照做）：
- 复用 `armVpn` 的 callbackId 校验：不匹配则 `Log.w("MainActivity", "isBatteryExempt: bad callback id")` + `return`。
- 整个逻辑在 `runOnUiThread { }` 内（`evaluateJavascript` 必须在 UI 线程）。
- 查状态用
  `getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(packageName) == true`。
- 回调 `webView.evaluateJavascript("$callbackId($exempt)", null)`。
- `PowerManager` 取不到时按**未豁免**（`false`）处理并 `Log.w` 一行——保守方向：
  误报未豁免只是多显示一行状态，误报已豁免会让用户以为息屏不断网。

- [ ] **Step 3: 实现 `requestBatteryExemption`**

语义要求：
- 无 callbackId 参数。
- 在 `runOnUiThread { }` 内构造
  `Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
  Uri.parse("package:$packageName"))`。
- `if (intent.resolveActivity(packageManager) == null) { Log.w(...); return@runOnUiThread }`
  ——静默返回，不崩。
- `startActivity(intent)` 包 `try/catch`，异常 `Log.w("MainActivity", "battery exemption request failed", e)`。
- 需要 import `android.net.Uri`（已有）、`android.os.PowerManager`、`android.provider.Settings`
  （若无则加；`Intent`/`Uri` 已有）。

- [ ] **Step 4: 编译验证**

Run: `cd wisper/android && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL。

（本机 Gradle 需要 Android SDK；若无 SDK，见 Task 3 的验证替代路径——
用 `docker run gogost/wisper-android` 内的 Gradle，见 `wisper-apk-build.md`。）

---

### Task 2: 设置页状态行 + i18n

**Files:**
- Modify: `wisper/web-src/src/pages/settings-page.ts`（`@state()` 组后加一个
  `@state() private _batteryExempt = false;`；`connectedCallback` 内加查询调用；
  Preferences 的 card 末尾（约 884 行 `_statsInterval` 那行之后）加一行）
- Modify: `wisper/web-src/src/i18n/en.ts`、`zh.ts`（`settingsStatsInterval` 附近）

**Interfaces:**
- Consumes: Task 1 的 `WisperNative.isBatteryExempt(callbackId)` /
  `WisperNative.requestBatteryExemption()`。
- Produces: 无（终点，Task 3 只验证）。

- [ ] **Step 1: 加 4 个 i18n 键（en + zh）**

紧邻 `settingsStatsInterval` 加（key 名逐字照抄）：

```
batteryExemptTitle: 'Background activity'   // zh: '后台保活'
batteryExemptOn:    'Unrestricted'          // zh: '无限制'
batteryExemptOff:   'Restricted'            // zh: '优化'
batteryExemptHint:  'Keep the tunnel alive while the screen is off.'   // zh: '息屏时保持隧道不断。'
```

- [ ] **Step 2: 加 `@state` 与存在性门控**

在 `@state() private _statsInterval = 3;` 之后加：

```ts
  /** Doze power-save exemption: false until the native bridge says otherwise,
   *  so a reinstall (which drops the exemption) shows "Restricted" again. */
  @state() private _batteryExempt = false;
```

在类里加私有 getter（照抄 `tunnel-detail-page.ts:77-79` 的 `_isNativeDirPicker`）：

```ts
  private get _hasBatteryBridge(): boolean {
    return !!(window as any).WisperNative?.isBatteryExempt;
  }
```

- [ ] **Step 3: `connectedCallback` 里查状态**

在 `connectedCallback()` 末尾加调用 `_queryBatteryExempt()`，并定义它：

```ts
  /** Reads the exemption through the bridge. Sets false when the bridge is
   *  absent (desktop/browser), so the row stays "Restricted" rather than
   *  claiming a state nothing can confirm. */
  private _queryBatteryExempt() {
    if (!this._hasBatteryBridge) { this._batteryExempt = false; return; }
    const cbName = '__wisper_battery_callback__';
    (window as any)[cbName] = (exempt: boolean) => {
      this._batteryExempt = exempt === true;
      this.requestUpdate();
      delete (window as any)[cbName];
    };
    (window as any).WisperNative.isBatteryExempt(cbName);
  }
```

无 `try/catch`：bridge 缺失已被 getter 挡住；bridge 抛异常属真 bug，不静默。

- [ ] **Step 4: 渲染那一行**

放在 Preferences card 内、`_statsInterval` 那行 `</div>` 之后（card 闭合前）：

```html
            ${this._hasBatteryBridge ? html`
              <div class="selector-row" @click=${() => this._requestBatteryExemption()}>
                <span class="selector-label">${t('batteryExemptTitle')}</span>
                <span class="selector-value">
                  ${t(this._batteryExempt ? 'batteryExemptOn' : 'batteryExemptOff')}
                  ${this._batteryExempt ? '' : icon('chevron-right')}
                </span>
              </div>` : ''}
```

外层已有 `.section-title` 为「Preferences」的 section；该行语义属于平台行为，
不是用户偏好——若与其他三行并排显得错位，可另起一个 `.section`，
但**不要**为它新增 section-title（否则多一个空标题）。

- [ ] **Step 5: 点击处理**

```ts
  /** Asks for the exemption; the system dialog owns the answer, so nothing
   *  here changes _batteryExempt — only _queryBatteryExempt writes it. */
  private _requestBatteryExemption() {
    if (this._batteryExempt || !this._hasBatteryBridge) return;
    (window as any).WisperNative.requestBatteryExemption();
  }
```

已豁免时整行不可点（无 chevron 也无点击效果）——幂等，避免重复弹系统对话框。

- [ ] **Step 6: typecheck 门禁**

Run: `cd wisper/web-src && npm run typecheck`
Expected: 无输出即过。

（构建机 `/root` 下无 npm/node——若本机无 node，按 Task 3 Step 2 的替代路径在
toolchain 容器内跑，或在 CI（web typecheck job）验证。）

---

### Task 3: 打包验证 + 真机验收（不提交代码）

**Files:** 无代码改动。

- [ ] **Step 1: 构建 APK**

按 `.memory/notes/wisper-apk-build.md` §1 走完整流程（`--network host`、默认 docker
driver、不用 `make android`）→ `dist/android/app-final.apk`。

- [ ] **Step 2: 编译兜底验证（仅当构建机无 node/npm 时需要）**

若 Task 1 Step 4 的 `./gradlew :app:compileDebugKotlin` 因缺 SDK 失败，
APK 构建本身就是那条编译路径的完整替代——它编同一个 Kotlin 源集。

- [ ] **Step 3: 安装 + 启动**

`adb install -r`（保留数据 → 豁免状态保留，正好可验状态行显示"无限制"），
`adb forward tcp:18900 tcp:8900`，`am start -n run.gost.wisper/.MainActivity`。

- [ ] **Step 4: 验状态行两态**

1. 设置页 → 应显示「后台保活 / 无限制」（本机当前已豁免，2026-10-07 实测
   `dumpsys deviceidle whitelist | grep wisper` 曾为空；若已手动设过则为无限制）。
2. `adb shell dumpsys deviceidle whitelist | grep wisper` → 必须有本应用条目
   （这是"系统开关真的开着"的交叉验证，不是 UI 自说自话）。

- [ ] **Step 5: 息屏 15 分钟验收**

息屏 → 等 15 分钟 → 解锁 → `curl -s http://127.0.0.1:18900/api/stats` 看
entrypoint 的 `input_bytes` 是否连续增长；hub 侧（`ssh pi@192.168.100.100
docker logs p2p-tun-wisper-1`）不应出现流 EOF/路由丢弃。
**判据**：15 分钟息屏期间双向字节都在涨 = Doze 不再掐，验收通过。

- [ ] **Step 6: 确认工作区只有本 plan 的文件**

`git status --short`，不 commit（本仓库约定 no-auto-commit，见
`.memory/notes/no-auto-commit.md`），交审。

---

## Review Focus → 测试归属

| Review Focus 行 | pin 在哪 |
|---|---|
| 重装后豁免丢失须显示未豁免 | Task 2 Step 2/3：初值 `false`，每次 `connectedCallback` 重查 |
| 拒绝对话框后行保持未豁免、不消失 | Task 1 Step 3（不乐观置位）+ Task 2 Step 5（幂等早退） |
| bridge 缺失不渲染不调用 | Task 2 Step 2/4（`_hasBatteryBridge` 门控） |
| `resolveActivity` 空时静默返回 | Task 1 Step 3 |
| typecheck / 编译门槛 | Task 2 Step 6 + Task 3 Step 1/2 |

## 关系

- relates_to [[wisper-tun-hub-liveness]]（本 plan 修的 Doze 断链就是它记录的现场）
- relates_to [[wisper-apk-build]]（Task 3 Step 1 的构建流程）
- 未立项项：解锁即时重连（spec §非目标），需要 p2p 暴露重拨钩子 + wisper bump