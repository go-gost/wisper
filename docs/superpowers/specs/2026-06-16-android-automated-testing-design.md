# Android Automated Testing — Design Spec

## Status: approved | Date: 2026-06-16

---

## 1. Motivation

Wisper 的 Android 应用当前没有自动化测试。当前验证方式是：
1. `make android` 构建 APK
2. 手动 `adb install` 到 Pixel 9
3. 肉眼确认启动、通知栏、图标

每次改动都需要这个手动循环。需要在不依赖真机的前提下，让"APK 构建 → 模拟器启动 → 安装 → 测试 → 报告"全链路一键完成。

## 2. Architecture

```
make android-test-smoke
make android-test-full
make android-test-stop
       │
       ▼  docker run --privileged (needs KVM)
┌──────────────────────────────────────────────────┐
│  wisper-android-test container                    │
│  (FROM wisper-android + system-image + AVD)      │
│                                                   │
│  ┌──────────────────┐    ADB    ┌──────────────┐ │
│  │ Android Emulator  │◄─────────│ gradle        │ │
│  │ API 34 / x86_64   │          │ connectedCheck│ │
│  │ headless (-no-window)        │               │ │
│  └──────────────────┘          │ ├─ smoke suite │ │
│                                 │ └─ full suite  │ │
│                                 └──────────────┘ │
│                                                   │
│  report → $PWD/android/app/build/outputs/         │
│           androidTest-results/                     │
└──────────────────────────────────────────────────┘
```

### 关键设计决策

| 决策 | 选型 | 理由 |
|------|------|------|
| 模拟器运行环境 | Docker + KVM（宿主机 KVM 透传） | 与当前 `make android` 构建容器化一致；无需宿主 SDK |
| 模拟器架构 | x86_64（非 ARM） | x86 模拟器快 10x+，有 KVM 时速度接近真机 |
| API level | 34（= targetSdk） | 与编译目标和 Pixel 9 真机保持一致 |
| 测试框架 | UIAutomator + JUnit Instrumentation | 可操作系统 UI（通知栏、图标）+ 通过 Accessibility Tree 操作 WebView |
| 不选 Espresso | — | Lit 渲染的动态 WebView DOM 需要 JS 注入，Espresso `onWebView()` 不稳定 |
| 构建链路 | Gradle `connectedCheck` 标准流程 | Managed device 不适用（需要宿主 SDK），手动启动模拟器 + `connectedCheck` 可完全容器化 |
| JNI 架构 | APK 内建 arm64 + x86_64 双 `libwisper.so` | x86_64 供模拟器，arm64 供真机。Go 交叉编译零代码改动 |
| 镜像分层 | `wisper-android` (4.8GB SDK + NDK) → `wisper-android-test` (+3GB system image) | 复用现有构建镜像，测试层只增量加模拟器 |



## 3. Test Suite Layering

### Smoke Suite (门禁，目标 <90s)

| # | 测试 | 方法 |
|---|------|------|
| 1 | APK 安装到模拟器 | `adb install` + 验证 package manager 返回 |
| 2 | MainActivity 启动不崩溃 | `am start` + 检查 Activity 栈 |
| 3 | WisperService 前台化 | `dumpsys activity services` grep `isForeground=true` |
| 4 | 通知存在且 smallIcon 正确 | `dumpsys notification` grep `smallIcon` + `run.gost.wisper` |
| 5 | Go 后端端口监听 8900 | `adb shell cat /proc/net/tcp` 或 `nc -z` |
| 6 | WebView 无 crash dialog | UIAutomator waitFor `android:id/content` 无 crash 元素 |

### Full Suite (PR/每日构建，目标 <5min)

包含 Smoke 全部 + 以下功能测试：

| # | 测试 | 方法 |
|---|------|------|
| 7 | 创建/启动/停止/删除 Tunnel (4 类型) | FAB → Tunnel Type Select → Form fill → Save → Start/Stop toggle → Delete |
| 8 | 创建/启动/停止/删除 Entrypoint (2 类型) | 同上 |
| 9 | Settings 页修改 server addr + theme + lang | 导航 Settings → fill form → verify 持久化 |
| 10 | 多 Tab 导航 | 点击 nav-tabs → verify 页面切换 |
| 11 | 通知栏 tap → 回到 Activity | `input swipe` 展开通知 → 点击通知 → verify Activity resumed |
| 12 | 横竖屏旋转不崩溃 | `content rotate` → Activity 仍在前台 |

## 4. Project Changes

### 4.1 新增文件

```
android/Dockerfile.test
  — FROM wisper-android
  — RUN sdkmanager "system-images;android-34;google_apis;x86_64"
  — RUN avdmanager create avd -n test_avd -k "system-images;android-34;google_apis;x86_64" -d pixel_6
  — ADD scripts/start-emulator.sh /opt/start-emulator.sh

android/scripts/start-emulator.sh
  — 启动 headless 模拟器: emulator -avd test_avd -no-window -no-audio -gpu swiftshader_indirect
  — 循环等待 boot completed: until adb shell getprop sys.boot_completed | grep 1
  — 等待 package manager ready
  — 输出 "EMULATOR_READY"

android/app/src/androidTest/java/run/gost/wisper/
  smoke/
    SmokeTestSuite.kt          — @RunWith(Suite::class)
    ServiceSmokeTest.kt         — 前台服务 + 端口
    NotificationSmokeTest.kt    — 通知 icon + 标题
    WebViewSmokeTest.kt         — WebView 加载不崩溃
  full/
    FullTestSuite.kt
    TunnelCrudTest.kt
    EntrypointCrudTest.kt
    SettingsTest.kt
    NavigationTest.kt
  util/
    TestHelpers.kt              — waitForService(), tapElement(), scrollTo()
    Waiter.kt                   — 轮询条件等待
```

### 4.2 修改文件

```
Makefile
  + android-test-smoke   # 启动模拟器容器 → connectedCheck smoke → 报告
  + android-test-full    # 启动模拟器容器 → connectedCheck full   → 报告
  + android-test-stop    # docker stop & rm 模拟器容器

android/app/build.gradle.kts
  + androidTestImplementation("androidx.test.ext:junit:1.1.5")
  + androidTestImplementation("androidx.test.uiautomator:uiautomator:2.2.0")
  + androidTestImplementation("androidx.test:runner:1.5.2")
  + testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  + testBuildType = "debug"
```

### 4.3 Dockerfile.test 核心步骤

```dockerfile
FROM wisper-android

# Install x86_64 system image for emulator
RUN /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager \
    "system-images;android-34;google_apis;x86_64"

# Create AVD
RUN echo "no" | /opt/android-sdk/cmdline-tools/latest/bin/avdmanager \
    create avd -n test_avd -k "system-images;android-34;google_apis;x86_64" \
    -d pixel_6 --force

# Emulator prefs: skip setup wizard, increase screen timeout
COPY scripts/avd_config.ini /root/.android/avd/test_avd.avd/config.ini

# Startup script
COPY scripts/start-emulator.sh /opt/start-emulator.sh
RUN chmod +x /opt/start-emulator.sh
```

### 4.4 Makefile targets

```makefile
TEST_CONTAINER := wisper-android-test-container
TEST_IMAGE     := wisper-android-test

android-test-image:
	DOCKER_BUILDKIT=1 docker build -t $(TEST_IMAGE) -f android/Dockerfile.test android/

android-test-smoke: android-test-image android
	docker run --rm --privileged -d --name $(TEST_CONTAINER) \
		-v "$(PWD):/go-gost/wisper" $(TEST_IMAGE) \
		bash -c '/opt/start-emulator.sh && \
			cd /go-gost/wisper/android && ./gradlew connectedDebugAndroidTest \
			-Pandroid.testInstrumentationRunnerArguments.class=run.gost.wisper.smoke.SmokeTestSuite'
	docker logs -f $(TEST_CONTAINER)
	@echo "==> Test report: android/app/build/reports/androidTests/"

android-test-full: android-test-image android
	docker run --rm --privileged -d --name $(TEST_CONTAINER) ...
	# same pattern with full suite

android-test-stop:
	docker stop $(TEST_CONTAINER) 2>/dev/null || true
	docker rm $(TEST_CONTAINER) 2>/dev/null || true
```

## 5. Test Implementation Details

### 5.1 Service Smoke Test

```kotlin
@Test
fun serviceIsForeground() {
    val result = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        .executeShellCommand("dumpsys activity services run.gost.wisper")
    assertThat(result).contains("isForeground=true")
}
```

### 5.2 Notification Smoke Test

```kotlin
@Test
fun notificationHasSmallIconAndTitle() {
    val result = UiDevice.getInstance(instrumentation)
        .executeShellCommand("dumpsys notification --noredact")
    assertThat(result).contains("smallIcon")
    assertThat(result).contains("Wisper running")
}
```

### 5.3 WebView Smoke Test

```kotlin
@Test
fun webViewLoadsWithoutCrash() {
    val device = UiDevice.getInstance(instrumentation)
    // Wait for WebView to render (don't find crash dialog)
    device.wait(Until.hasObject(By.text("Wisper")), 10000)
    // Verify no ANR/crash dialogs
    assertThat(device.hasObject(By.textContains("crash"))).isFalse()
    assertThat(device.hasObject(By.textContains("has stopped"))).isFalse()
}
```

### 5.4 Full Suite — Tunnel CRUD

通过 UIAutomator 的 Accessibility Tree 遍历 WebView DOM 元素，用 `findObject(By.text("..."))` 定位按钮和输入框。Wisper 的 Lit 组件使用语义化 HTML（按钮、链接、label），Accessibility Tree 能正确捕获。

操作流程：
1. FAB `+` 按钮 → Tunnel Type Select page
2. Tap tunnel type card → detail form page
3. Fill name field → Save
4. Back to home → verify card appears
5. Tap Start → verify stats row shows active state
6. Tap Stop → verify stopped state
7. Swipe delete → confirm dialog → verify card removed

### 5.5 Emulator Startup Sequence

```bash
#!/bin/bash
# start-emulator.sh

echo "Starting emulator..."
nohup /opt/android-sdk/emulator/emulator \
    -avd test_avd \
    -no-window \
    -no-audio \
    -no-boot-anim \
    -gpu swiftshader_indirect \
    -accel on \
    -memory 2048 \
    -cores 4 \
    &

# Wait for boot
echo "Waiting for boot..."
adb wait-for-device
while [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
    sleep 2
done

# Wait for package manager
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'

echo "EMULATOR_READY"
```

## 6. x86_64 JNI 支持

当前 `make android` 只交叉编译 `arm64-v8a` 的 `libwisper.so`。x86_64 模拟器无法加载它，`WisperJNI.start()` 会失败 → Service 会 `stopSelf()`。需要同步构建 x86_64 的 `.so`：

```makefile
# 在 make android 的 docker run 中增加:
mkdir -p android/app/src/main/jniLibs/x86_64
CC=<x86_64 NDK clang> GOARCH=amd64 go build -buildmode=c-shared \
    -o android/app/src/main/jniLibs/x86_64/libwisper.so .
```

Go 交叉编译到 `android/amd64` 只需改 `GOARCH=amd64` + 换 x86_64 NDK 编译器即可，无需改 Go 源码。APK 将内置双架构 `.so`，模拟器和真机都能完整运行 Go 后端。

## 7. Known Limitations

1. **KVM 必须可用** — `/dev/kvm` 透传到容器。没有 KVM 模拟器会极慢（>10min boot），不适合自动化。
2. **Kernel Compatibility** — Android emulator QEMU (build 15507667, emulator 36.6.11) crashes on Linux 7.0+ kernels due to memory mapping incompatibility (`cannnot unmap ptr` in protected range). The emulator requires Linux 6.x kernel. When a compatible kernel is available, boot takes ~30s with KVM.
3. **Docker security opts required** — Container must run with `--security-opt seccomp=unconfined --security-opt apparmor=unconfined` or KVM ioctls are blocked by the default seccomp profile.
4. **Hang detection must be disabled** — Set `ANDROID_EMU_DISABLE_HANG_DETECTION=1` or the emulator watchdog kills QEMU prematurely (a known issue with some CPU models).
5. **WebView 版本差异** — 模拟器的 WebView 与 Pixel 9 可能不同。P0 层的 crash 检查覆盖性不受影响，但 UI 渲染差异不在本 scope 内。
6. **Full suite 依赖 Lit SPA 的语义化 DOM** — UIAutomator 通过 text/label 定位元素，需要 WebView contentDescription 或 DOM label 正确映射到 Accessibility Tree。
7. **Single-core emulator** — Multi-core KVM (4 cores) causes thread hangs. Current workaround: `-cores 1`.

## 7. Build Impact

- 测试镜像首次构建时间：约 +5 分钟（下载 ~1.5GB system image）
- 后续增量构建：`wisper-android` 阶段不变，测试镜像秒级重建（仅 COPY 脚本）
- 签名：debug APK 即可，不引入 release signing
- 产物大小：`wisper-android-test` 镜像约 8GB

## 8. Docker Run Configuration

The working `docker run` configuration for kernel 6.x hosts:

```bash
docker run --rm --privileged \
    --security-opt seccomp=unconfined \
    --security-opt apparmor=unconfined \
    -v "$(pwd):/go-gost/wisper" \
    -v "${HOME}/.gradle:/root/.gradle" \
    wisper-android-test bash -c '
        /opt/start-emulator.sh
        adb -s emulator-5554 install -r /go-gost/wisper/android/app/build/outputs/apk/debug/app-debug.apk
        cd /go-gost/wisper/android
        gradle connectedDebugAndroidTest \
            -Pandroid.testInstrumentationRunnerArguments.class=run.gost.wisper.smoke.SmokeTestSuite \
            --no-daemon
    '
```

## 9. CI Integration (Future)

当前先手动 `make android-test-smoke`。后续 CI 集成（GitHub Actions runner 上启用 KVM）：

```yaml
- name: Android smoke test
  run: make android-test-smoke
```

runner 需要 `ubuntu-latest` + KVM enabled group + Linux 6.x kernel.

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-16 | Initial spec approved |
| 2026-06-17 | Implemented: dual-arch APK, Dockerfile.test, smoke/full test suites, Makefile targets. Discovered kernel 7.0 incompatibility with emulator QEMU |
