# 电池优化豁免（Doze 保活）设计

- 日期：2026-10-07
- 状态：设计已确认，待实现计划
- 背景：2026-10-07 真机确认息屏约 11 分钟后 Doze 饿死 derp 长连接
  （hub 侧流 EOF、路由丢掉），解锁补发上行凑满 60 个 uplink-only tick
  触发 `tun downlink without uplink` 告警（2026-10-07 真机实测链条，见
  仓库 memory 笔记 `wisper-tun-hub-liveness` 的息屏链确认节）。App 已是前台服务
  （VPN + dataSync），只能保进程不死，保不住 Doze 下的网络。
- 目标机：Pixel 9（stock AOSP，`ro.product.manufacturer=Google`）。
  系统「电池使用 → 无限制」与 `isIgnoringBatteryOptimizations()` 是同一个
  power-save 白名单开关（2026-10-07 实测：wisper 不在
  `dumpsys deviceidle whitelist` 中，`mDeepEnabled=true`）。
- 非目标：解锁即时重连（另立项）、国产 ROM 自启动/后台弹出权限、
  看门狗解锁宽限。

## 目标

系统本就带这个开关，本设计**不发明能力，只做状态可见 + 一跳直达**：
豁免按安装持久（卸载重装即丢），系统入口深达 5 层
（设置→应用→全部→wisper→电池→无限制），无人盯着一定会忘。
设置页常显当前豁免状态，未豁免时一键跳系统对话框。

## 方案

### 1. Manifest（`android/app/src/main/AndroidManifest.xml`）

加一行：

```xml
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

自有分发，无 Play 政策顾虑。该权限与系统「电池使用 → 无限制」控制的是同一个
白名单，权限只用于**能自己跳对话框**；目标机 stock AOSP，用户在系统里手动设
「无限制」效果完全等价。

### 2. JsBridge（`MainActivity.kt`，照抄 `armVpn`/`pickDir` 模式）

新增两个 `@JavascriptInterface` 方法：

- `isBatteryExempt(callbackId: String)` ——
  `powerManager.isIgnoringBatteryOptimizations(packageName)`，
  回调布尔。`callbackId` 同 `armVpn` 的 `^[A-Za-z0-9_]{1,64}$` 校验。
- `requestBatteryExemption()` —— 起
  `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + `package:` URI。
  只能从 Activity context 启动；`resolveActivity` 为空则静默返回。
  豁免是粘性的、卸载才丢：用户拒绝一次，下次进设置页仍可点，不做
  "不再提示"记忆。

### 3. 设置页（`web-src/src/pages/settings-page.ts` + i18n 中英各一）

Preferences 区（或其后新 section，看行数，超 4 行则独立 section）
加一行"后台保活"：

- 仅当 `window.WisperNative?.isBatteryExempt` 存在时渲染
  （桌面端/浏览器无此 bridge，不显示——照抄 `pickDir` 的存在性门控）。
- 值区显示"已豁免"/"未豁免"；未豁免时整行可点，调
  `requestBatteryExemption()`。
- 返回设置页时（`connectedCallback` / 可见性恢复）重查状态，
  用户在系统对话框点了允许后回来即变为已豁免。
- 文案键：`batteryExemptTitle` / `batteryExemptOn` / `batteryExemptOff` /
  `batteryExemptHint`（hint 只说作用，不提 Doze/derp 等内部词）。

### 4. Go 后端

无改动。

## 成功标准

- 真机：未豁免→息屏 15 分钟→hub 侧流 EOF 复现；豁免后→同样 15 分钟，
  流不断、无 `downlink without uplink` 告警。
- 交叉验证豁免真的落地：`dumpsys deviceidle whitelist | grep wisper`
  必须出现本应用条目（当前为空，即未豁免基线）。
- 拒绝豁免：功能不受影响，只是行状态保持"未豁免"。

## 测试

- Android 侧无单测传统：以真机实测为准（上metric）。
- 前端 `npm run typecheck` 门禁；bridge key 缺失时行不渲染
  （桌面浏览器回归：设置页无新增行）。
