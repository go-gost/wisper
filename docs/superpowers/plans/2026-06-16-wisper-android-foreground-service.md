# Android Foreground Service + Keep-Alive Implementation Plan

## Context

The current Android app is a **minimal APK**: Go backend starts/stops in `MainActivity.onCreate()/onDestroy()`. When the app is backgrounded or swiped away, tunnels die immediately — defeating the purpose of a tunnel manager. This plan adds a **Foreground Service** to host the Go runtime so tunnels survive Activity lifecycle changes.

Reference design spec: `docs/superpowers/specs/2026-06-14-wisper-android-port-design.md`

**Status: IMPLEMENTED** (2026-06-16)

## Verification Results (Pixel 9 / Android 16)

| Test | Result | Details |
|------|--------|---------|
| Build | ✅ PASS | `assembleDebug` clean, 0 warnings |
| Install & launch | ✅ PASS | APK installs, service starts on first open |
| Backend listening | ✅ PASS | `127.0.0.1:8900 LISTEN` (ss -tlnp) |
| API responding | ✅ PASS | `GET /api/tunnels` returns tunnel list, existing tunnels auto-resume |
| Notification | ✅ PASS | Channel `wisper_foreground` (IMPORTANCE_LOW), notification with Stop action posted |
| Foreground service | ✅ PASS | `isForeground=true`, `types=0x1` (dataSync), notification attached |
| Background survival | ✅ PASS | Home press → API still serves after 30s+ |
| Swipe-away survival | ✅ PASS | Activity task removed → service alive, notification remains |
| Restart | ✅ PASS | Re-launch after stop → service recreates, tunnels auto-resume from yaml |
| Stop action (shell) | ⚠️ SKIP | `RECEIVER_NOT_EXPORTED` prevents adb testing (correct security) — user-visible button works |
| Stop action (UI) | ✅ PASS | In-app "Stop Service" menu triggers stopSelf → onDestroy → JNI stop |

## Files to Create

### 1. `android/app/src/main/res/values/strings.xml` (NEW)

String resources for notification channel and actions. Required before WisperService can reference `R.string.*`.

### 2. `android/app/src/main/res/drawable/ic_notification.xml` (NEW)

Vector drawable (24dp, white-on-transparent) for the notification icon. A simple arrow/tunnel glyph.

### 3. `android/app/src/main/java/run/gost/wisper/WisperService.kt` (NEW)

Core new file — a `Service()` that:
- **`onCreate()`**: Creates notification channel (API 26+), registers stop-action `BroadcastReceiver`, calls `WisperJNI.start(filesDir, "127.0.0.1:8900")`, acquires `PARTIAL_WAKE_LOCK` (10min timeout), calls `startForeground()` with `dataSync` type
- **`onBind()`**: Returns `LocalBinder` exposing `isBackendReady: Boolean` (volatile)
- **`onStartCommand()`**: Returns `START_NOT_STICKY` (no auto-restart after kill)
- **`onDestroy()`**: Unregisters receiver, releases WakeLock, calls `WisperJNI.stop()`
- **Notification**: "Wisper running" with a **Stop action** (`PendingIntent.getBroadcast` → `stopSelf()`)
- **WakeLock**: `PowerManager.PARTIAL_WAKE_LOCK` with 10-minute timeout, acquired in `onCreate()`, released in `onDestroy()`
- **Stop receiver**: `BroadcastReceiver` registered with `ContextCompat.registerReceiver()` (compatible with minSdk 26)

### 4. `android/app/src/main/res/values/colors.xml` (NEW if needed)

May not be needed if we use framework colors, but good to have for notification color.

## Files to Modify

### 5. `android/app/src/main/AndroidManifest.xml` (MODIFY)

Add:
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

Add `android:launchMode="singleTop"` to MainActivity.

Add service declaration:
```xml
<service
    android:name=".WisperService"
    android:exported="false"
    android:foregroundServiceType="dataSync" />
```

### 6. `android/app/src/main/java/run/gost/wisper/MainActivity.kt` (REWRITE)

**Remove**: Direct JNI calls (`WisperJNI.start/stop`).

**Add**: Service binding pattern:
- `onCreate()`: Create WebView, call `startForegroundService()` + `bindService()`
- `onServiceConnected()`: Wait for `isBackendReady`, then `webView.loadUrl("http://127.0.0.1:8900")`
- `onDestroy()`: ONLY `unbindService()` — does NOT stop service (keep-alive)
- Options menu: "Stop Service" menu item that calls `stopService()` + `finish()`

### 7. No Changes Needed

- `WisperJNI.kt` — Same JNI bridge, now called from Service instead of Activity
- `app/build.gradle.kts` — No new dependencies needed (core-ktx, appcompat are sufficient)
- `lib.go`, `app.go`, `config/config.go` — Go side unchanged

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| App backgrounded | Service keeps running, notification remains |
| App swiped from recents | Activity `onDestroy()` only unbinds; service lives on |
| Screen off | WakeLock keeps CPU for 10 min; GOST auto-reconnects after wake |
| Notification Stop tapped | Broadcast → `stopSelf()` → `onDestroy()` → JNI stop + WakeLock release |
| Notification tapped | Returns to existing Activity (`singleTop`) or creates new one |
| Process killed (OOM) | `START_NOT_STICKY` — no auto-restart; user reopens app |
| Rotation | `configChanges="orientation|screenSize"` prevents Activity recreate |
| Reopen after stop | `startForegroundService()` idempotent; service recreates, WebView loads |

## Implementation Order

1. Create `res/values/strings.xml` (resources first)
2. Create `res/drawable/ic_notification.xml` (notification icon)
3. Modify `AndroidManifest.xml` (permissions + service declaration)
4. Create `WisperService.kt` (foreground service with JNI, notification, WakeLock)
5. Rewrite `MainActivity.kt` (remove JNI, add service binding)
6. Build: `./gradlew assembleDebug`
7. Install and verify on Pixel 9 via ADB

## Verification

1. **Build**: `make android` or `./gradlew assembleDebug` succeeds
2. **Install**: `adb install` on Pixel 9, app launches
3. **Service starts**: `adb logcat -s WisperService` shows `onCreate` + backend ready
4. **Notification**: "Wisper running" visible with Stop action
5. **WebView loads**: Wisper UI at `http://127.0.0.1:8900` renders correctly
6. **Background survival**: Press Home, wait 30s, `curl localhost:8900` responds
7. **Stop via notification**: Tap Stop, service stops, notification disappears
8. **Swipe-away survival**: Remove from recents, notification remains, tunnels alive
9. **Restart**: Reopen from launcher after stop, everything works
10. **Screen-off**: Turn screen off 2 min, tunnels still alive on wake
