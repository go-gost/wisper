# Wisper Android Port — Design

**Date:** 2026-06-14
**Status:** Approved design (pending implementation plan)

## Context

Wisper is a GOST tunnel manager: a Go HTTP server with an embedded Lit web UI. Currently it runs only on desktop. This design brings **full Wisper functionality to Android** — the phone itself becomes a GOST tunnel node (exposes local services / forwards traffic through the GOST network).

Constraints established during brainstorming:

- **Approach:** Go backend stays as-is (Rust is only instrumental, not strategic) — reuse the entire GOST protocol stack. A thin native Android shell wraps it. No Rust rewrite.
- **Keep-alive:** Only Android needs it; only "while the app has been opened" (Foreground Service), **no boot auto-start**.
- **iOS:** Out of scope (would require Network Extension + Apple entitlement approval — a separate future project).
- **Frontend:** The existing Lit web UI is reused 100% unchanged (already responsive via CSS custom properties).

A codebase audit confirmed the `x` module needs only **one small build-time patch** (see "x module patch"), so the port is low-risk: ~2-3 weeks, not months.

## Architecture

Single Android process. Go compiled as a c-shared library (`libwisper.so`), loaded via JNI, running **embedded in-process** (not as a separate program — Android 10+ SELinux restricts direct launching of bundled binaries; c-shared + JNI is the gomobile-standard, reliable path).

```
Android App (one process)
├─ WisperService (Foreground Service)
│   └─ JNI: System.loadLibrary("wisper")
│       ├─ wisperStart(configDir, addr) → starts Go HTTP server (goroutines)
│       └─ wisperStop()                 → persist state + graceful shutdown
│           └─ Go runtime (in-process)
│               ├─ API server @ 127.0.0.1:8900
│               ├─ GOST tunnel stack (x module, full reuse)
│               └─ Lit Web UI (//go:embed)
│
└─ MainActivity
    └─ WebView → http://127.0.0.1:8900  (loads embedded Lit UI)
```

WebView→localhost cleartext works without extra config: Android's default NetworkSecurityConfig permits cleartext to the loopback interface.

**Why c-shared + JNI over a launched binary:** Android 10+ enforces SELinux policies that block direct launching of arbitrary bundled binaries (the W^X problem). Compiling Go with `-buildmode=c-shared` produces a `.so` loaded by `System.loadLibrary`, which runs the Go runtime inside the app's own process — the same model gomobile uses, proven reliable on stock Android.

## Go-side changes

**1. Config directory injection** — [config/config.go:36](../../../config/config.go)

`Init()` hardcodes `os.UserConfigDir()+"/wisper"`, which on Android does not point at the app sandbox. Refactor to accept an option:

```go
func Init(opts ...Option)        // add SetConfigDir(dir) functional option
```

Desktop `main()` is unchanged (defaults to current behavior). Android passes `Context.getFilesDir()`.

**2. Extract Start/Stop from `main()`** — [main.go:24](../../../main.go)

Move the "init config → load tunnels → start stats runner → start HTTP server → wait for signal → persist + shutdown" sequence into callable functions in a new `lib.go`:

```go
//go:build cgo
func Start(configDir, addr string)   // non-blocking: launches server in goroutine
func Stop()                          // persist (tunnel.SaveConfig + entrypoint.SaveConfig) + srv.Shutdown
```

Desktop `main()` becomes: parse flags → `Start()` → wait SIGINT/SIGTERM → `Stop()`. Behavior identical to today (must pass `go test ./...` unchanged).

**3. Listen on 127.0.0.1 on mobile** — the Android JNI call passes `addr="127.0.0.1:8900"`. Desktop keeps `:8900`. No code change beyond parameterizing (already a flag).

## x module patch (the one blocker)

Reach path: every tunnel file → `x/chain` → `x/internal/net/dialer/dialer.go`.

- `dialer.go` (base, **no build constraint**) imports `vishvananda/netns` — Linux-specific syscalls, fails to compile/link on `GOOS=android`.
- `dialer_linux.go` (defines `bindDevice`/`setMark` with SO_MARK/SO_BINDTODEVICE) has the `_linux.go` suffix → **not compiled on Android** → symbols undefined at link time.

Everything else hostile (TUN/TAP/ICMP/redirect/WireGuard/gRPC/netlink) is **outside wisper's import graph** — it is only pulled by `gost/cmd/gost/register.go`, which wisper never imports (wisper blank-imports only `x/connector/tunnel` and `x/dialer/ws`). Additionally, `_linux.go` filename suffixes do not match `GOOS=android` (Android is its own GOOS in Go's build system, not `linux`), so those files are auto-excluded and their `_other.go` stubs (constrained `!linux && !windows && !darwin`) compile on Android. Confirmed by audit — no other patching needed.

**Fix (standard Go platform split):**

- Move netns code out of base `dialer.go` into `dialer_netns.go` (`//go:build linux`).
- Add `dialer_android.go` stub: no-op `bindDevice`/`setMark` + no-op netns-dependent helpers.
- Ship as a **build-time `.patch`** (precedent: ShadowsocksGostPlugin's `go.patch`), applied only during the Android c-shared build. **Do not modify the shared `x` module source** — it serves the gost CLI, inspector, etc.

The patch is finalized empirically: cross-compile, fix the first undefined symbol, repeat until `libwisper.so` links. Budget a compile-fix iteration loop; the audit indicates `dialer.go` is the only expected stop.

## Android native shell (new, ~400 lines Kotlin)

| Component | Responsibility |
|-----------|----------------|
| `MainActivity` | Create WebView, bind + `startForegroundService(WisperService)`, load `http://127.0.0.1:8900` |
| `WisperService` | Foreground Service: JNI `wisperStart` in `onCreate`, `startForeground` notification, optional `WakeLock`, JNI `wisperStop` in `onDestroy` |
| `WisperJNI` | `external fun start(configDir: String, addr: String)` / `external fun stop()` |
| `AndroidManifest.xml` | Permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` (Android 14+ type), `WAKE_LOCK`, `INTERNET`. Declare `WisperService` |

Project scaffold: Gradle (AGP 8.x) + NDK 26+, `jniLibs/arm64-v8a/libwisper.so` (device) + `x86_64` (emulator).

## Keep-alive lifecycle (open-app-only, no boot start)

```
User opens app
 └─ MainActivity.onCreate → startForegroundService(WisperService)
     └─ wisperStart() → Go server up → LoadConfig auto-resumes previously-running tunnels (existing wisper behavior)
     └─ startForeground() → persistent notification "Wisper running" with a Stop action

App backgrounded   → Foreground Service continues, tunnels alive  ← the point of keep-alive
Screen off         → WakeLock (optional) keeps CPU; GOST rtcp/rudp auto-reconnect to tunnel.gost.run
Swipe-away (onTaskRemoved) → KEEP RUNNING (keep-alive intent); stop only via notification Stop action or re-opening app
User taps Stop (notification or in-app) → wisperStop() → persist state → service destroyed

No BOOT_COMPLETED receiver — after device reboot tunnels stay off until user reopens the app.
```

Foreground service type: `dataSync` (ongoing tunnel traffic), required declaration on Android 14+.

## Build pipeline

Add a `make android` target to the Makefile. The target: (1) apply the x-module patch to a temp copy of `../x`, (2) cross-compile c-shared via the NDK clang toolchain for `GOOS=android GOARCH=arm64 CGO_ENABLED=1 -buildmode=c-shared`, outputting `libwisper.so` into `android/app/src/main/jniLibs/arm64-v8a/`, (3) repeat for `x86_64` (emulator), (4) revert the patch so the shared `x` module stays pristine. Then `./gradlew assembleDebug` produces the APK. (Concrete compiler path: `$NDK/toolchains/llvm/prebuilt/<host>/bin/aarch64-linux-android24-clang`.)

## Scope / deferral

| Item | This plan | Deferred |
|------|-----------|----------|
| Android full Wisper + keep-alive | ✅ | — |
| Boot auto-start | — | ❌ explicitly excluded |
| iOS | — | Future: simple-mode first; keep-alive needs Network Extension (separate project) |
| Upstreaming the x-module patch to go-gost | — | Optional follow-up (would make x portable to android in general) |

## Verification

1. **Desktop regression** — after the `main()` refactor: `go build ./...`, `go vet ./...`, `go test ./...` all pass; behavior unchanged (open browser to :8900, manage tunnels).
2. **Cross-compile** — `make android` produces `libwisper.so` for arm64-v8a and x86_64 without link errors; `objdump` confirms exported `wisperStart`/`wisperStop` symbols.
3. **APK build** — `./gradlew assembleDebug` succeeds; APK installs on an arm64 device.
4. **Functional (real device)** — open app → create each tunnel type (file/http/tcp/udp) → verify public endpoint works → background the app → tunnel stays alive → notification Stop → tunnel stops.
5. **Keep-alive stress** — background 10 min, screen off, trigger Doze; verify rtcp connection to `tunnel.gost.run` survives or cleanly auto-reconnects.
6. **Swipe-away** — remove app from recents; confirm tunnel keeps running and notification remains; Stop via notification works.

## Build sequence (suggested order)

1. Go refactor: config-dir option + `Start`/`Stop` extraction. Verify desktop still works. (~2 days)
2. Stand up NDK cross-compile; iterate the x-module patch until `libwisper.so` links. (~2-3 days)
3. Kotlin shell: MainActivity + WebView + JNI bridge, simple in-foreground start/stop. (~3-4 days)
4. Foreground Service + notification + keep-alive lifecycle + WakeLock. (~3-4 days)
5. All four tunnel types tested on device; keep-alive stress. (~2-3 days)

## Reference: prior art

- **ShadowsocksGostPlugin** (hamid-nazari) — proves the Go→Android `.so` path via NDK + cgo cross-compile, with a `build.gost.sh` template and `go.patch`/`gost.patch` for source trimming. Its `gost_helper` `ControlOnConnSetup` + SCM_RIGHTS `ancil_send_fd` pattern for VPNService `protect()` is reusable if VPN-mode integration is added later.
