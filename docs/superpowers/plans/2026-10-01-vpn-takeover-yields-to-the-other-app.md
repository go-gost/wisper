# wisper: a taken VPN yields to the other app — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> **Commit policy:** this repo does not commit without explicit user approval. The
> `git commit` steps are the *intended* commits — run them only when the user has
> said to commit. Build/test are the real gates for each task.

**Goal:** when the VPN is handed to another app, stop instead of racing it back —
and make the fd log say which call site released the device.

Design spec: [docs/superpowers/specs/2026-10-01-vpn-takeover-yields-to-the-other-app-design.md](../specs/2026-10-01-vpn-takeover-yields-to-the-other-app-design.md).
Read it first: it carries the measurement (three `release → set` rounds in nine
seconds), the two-branch rule, and the non-goals.

---

## File structure

| File | Responsibility |
|---|---|
| `api/vpn.go` (new) | `StopForVpnTaken()`: stop the entrypoint holding the tun device, record why. Testable, and the only caller is the JNI shim. |
| `lib.go` | the JNI exports: `wisperVpnTakenGo`, and `wisperSetTunFdGo` gaining the caller's reason. |
| `tunnel/tunfd.go` | `SetTunFD(fd int, reason string)`: the reason lands in the hand-off line. |
| `android/.../TunVpnService.kt` | `onRevoke` branches on `TRANSPORT_VPN`; reasons at the four call sites. |
| `android/.../WisperService.kt` | an arm older than a takeover is dropped; its own release reason. |
| `android/.../WisperJNI.kt`, `AndroidManifest.xml` | the new JNI declarations; `ACCESS_NETWORK_STATE`. |

---

## Task 1: the Go seam (`api`)

**Files:** create `api/vpn.go`; test `api/api_test.go`

- [ ] **Step 1: write the failing test**

```go
// A VPN handed to another app takes the device with it: the entrypoint that
// held it must stop, and its page must say why.
func TestStopForVpnTakenStopsTheHolder(t *testing.T) {
	// start a tun entrypoint (the existing tests in this package do), claim the
	// device via tunnel.ClaimTunDevice(id, name), then:
	name, ok := StopForVpnTaken()
	if !ok || name == "" { t.Fatal("no holder reported") }
	if !entrypoint.Get(id).IsClosed() { t.Fatal("holder still running") }
	if evs := event.List(id); len(evs) == 0 || evs[len(evs)-1].Level != event.LevelWarn {
		t.Fatalf("no warn event recorded: %+v", evs)
	}
	// and a second call is a no-op (the holder is gone)
	if _, ok := StopForVpnTaken(); ok { t.Fatal("reported a holder twice") }
}
```

- [ ] **Step 2: run it (fails: undefined: StopForVpnTaken)**
  `cd wisper && TMPDIR=/config/tmp CGO_ENABLED=1 go test -race -count=1 -run TestStopForVpnTaken ./api/`

- [ ] **Step 3: implement** — `tunnel.TunDeviceOwner()` gives the id and name;
  `entrypoint.Get(id)` + `ep.Close()` + `entrypoint.SaveConfig()` are what
  `handleStopEntrypoint` already does, and the event is
  `event.Record(id, event.LevelWarn, "VPN handed to another app — stopped")`.
  Return `(name, false)` when nobody holds the device.

- [ ] **Step 4: tests** — the new one plus the package's existing suite.

- [ ] **Step 5: commit (gated)** — `api: stop the entrypoint whose VPN was taken`.

---

## Task 2: the fd log names its caller

**Files:** `tunnel/tunfd.go`, `lib.go`

- [ ] **Step 1: implement** — `SetTunFD(fd int, reason string)`; the log line
  becomes `slog.Info("tunfd", "op", op, "fd", fd, "prev", prev, "reason", reason)`
  (omit the field when the reason is empty, so the pre-existing reading is
  unchanged). `lib.go`: `wisperSetTunFdGo(fd C.int, reason *C.char)` — the JNI
  signature gains the string.

- [ ] **Step 2: add the takeover export** — `//export wisperVpnTakenGo` calling
  `api.StopForVpnTaken()` and logging its result at info when it stopped
  something.

- [ ] **Step 3: verify** — `go build ./... && go vet ./... && gofmt -l .` and
  `TMPDIR=/config/tmp CGO_ENABLED=1 go test -race -count=1 ./tunnel/... ./api/`
  (the JNI shim itself is android-tagged and is compiled by the APK build in
  Task 4).

- [ ] **Step 4: commit (gated)** — `tunfd: name the releasing call site`;
  `android: report a VPN taken by another app`.

---

## Task 3: the Android side

**Files:** `TunVpnService.kt`, `WisperService.kt`, `WisperJNI.kt`,
`android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: manifest** — add `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`
  (normal permission, no prompt).

- [ ] **Step 2: `onRevoke`** — branch as the spec says:

```kotlin
override fun onRevoke() {
    // Android revoked *our* VPN, so any VPN still up belongs to another app —
    // the one moment the question has an unambiguous answer.
    val takenByOther = otherVpnActive()
    Log.w(TAG, "VPN revoked by the system (another VPN active: $takenByOther)")
    Log.w(TUNFD_TAG, "release: TunVpnService.onRevoke fd=-1 (revoked, otherVpn=$takenByOther)")
    VpnStatus.established = false
    VpnStatus.config = null
    WisperJNI.setTunFd(-1, "onRevoke")
    if (takenByOther) {
        // A deliberate switch: racing it back would undo the user's choice and
        // ping-pong with the other app (each establish() revokes the other).
        // The backend stops the entrypoint that held the device, and with the
        // arm dropped nothing wants a device again.
        VpnStatus.takenAt = System.currentTimeMillis()
        WisperJNI.vpnTaken()
    }
    super.onRevoke()
}

/** True when another app holds a VPN right now. A revoked VPN must never crash
 *  the process, so every failure reads as "no". */
private fun otherVpnActive(): Boolean = try {
    getSystemService(ConnectivityManager::class.java)?.let { cm ->
        cm.allNetworks.any {
            cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        }
    } ?: false
} catch (e: Exception) {
    Log.w(TAG, "vpn probe failed", e)
    false
}
```

- [ ] **Step 3: reasons at the other three sites** — `set: TunVpnService.establish`,
  `TunVpnService.release`, `WisperService.onDestroy` (each its own short string).

- [ ] **Step 4: the stale arm** — in `WisperService.ensureVpn`, before the arm is
  used: `if (VpnStatus.takenAt > armedAt) armedOptions = null` with the comment
  that a takeover invalidates an arm that predates it, while a *newer* arm (the
  user starting an entrypoint) survives. `VpnStatus` gains `@Volatile var takenAt = 0L`.

- [ ] **Step 5: compile Kotlin** (there is no Kotlin toolchain on the host):

```
docker run --rm -v /config/workspace/go-gost:/gost -w /gost/wisper \
  localhost:5000/gogost/wisper-android:latest \
  bash -c 'cd android && gradle compileDebugKotlin --no-daemon'
```

- [ ] **Step 6: commit (gated)** — `android: yield the VPN to the app that took it`.

---

## Task 4: the APK, and the device check

- [ ] **Step 1: build a debug APK.** `make android` does not work here (its
  toolchain image is the private registry, and the fallback downloads Go with no
  egress). Use the local image:

```
DOCKER_BUILDKIT=1 docker build -f android/Dockerfile.apk \
  --build-arg TOOLCHAIN=localhost:5000/gogost/wisper-android:latest \
  --build-arg WISPER_VERSION=1.7.1-dev.$(date +%y%m%d-%H%M) \
  --build-arg WISPER_VERSION_CODE=10701 \
  --network host --target apk --output type=local,dest=/config/tmp/apkout-vpn .
```

  Sign it (`cp … /config/tmp/apkwork/app-patched.apk` then
  `docker run --rm -v /config/tmp/apkwork:/work localhost:5000/gogost/wisper-android:latest sh /work/sign-only.sh`)
  and install: `adb -s <device> install -r --no-incremental /config/tmp/apkwork/app-final.apk`.

- [ ] **Step 2: the device check (the user preempts; the agent reads logs).**
  With a tun entrypoint running, the user starts the other VPN app. Then:

```
adb shell run-as run.gost.wisper grep tunfd files/logs/wisper.log | tail -5
```

  Expected: exactly **one** `release … reason=onRevoke`, and **no** `set` after it
  until the entrypoint is started again — versus the three rounds the same
  experiment produced before. The entrypoint must read stopped, with a warn event
  saying the VPN was handed over. Report the raw lines; if the other VPN is not
  available, say the device check did not run rather than claiming it passed.

- [ ] **Step 3: stop and report.** No commit for the artifact (the APK is not
  tracked); the code commits are the ones gated above.

---

## Docs (fold into the code commits)

- `CLAUDE.md`: one paragraph — a VPN handed to another app stops the entrypoint
  (a deliberate switch) while a revoke with no other VPN keeps the automatic
  recovery, plus the `VpnStatus.takenAt` rule for arms.
- `README.md`: the Android section gets one sentence on the same behaviour.
