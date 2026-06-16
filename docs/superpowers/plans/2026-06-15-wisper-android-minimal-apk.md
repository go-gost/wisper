# Wisper Android Minimal APK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal Android APK where the Go backend runs in-process (c-shared JNI), WebView loads the Lit UI from `http://127.0.0.1:8900`, and tunnels stop when the activity closes. No foreground service, no keep-alive, no WakeLock.

**Architecture:** Single Android process — Go compiled as `libwisper.so` via `-buildmode=c-shared`, loaded by `System.loadLibrary`. A C JNI bridge in `lib.go`'s cgo preamble handles `jstring` ↔ `char*` conversion. `app.go` extracts `Start()`/`Stop()` from `main()`; `config.Init()` gains a `WithConfigDir()` option for Android's sandbox path. Docker provides the NDK + SDK (host has neither).

**Tech Stack:** Go 1.26.4 (cgo + `-buildmode=c-shared`), Android NDK 26.1 + SDK 34 in Docker, Kotlin + AGP 8.2 + Gradle 8.5, existing Lit web UI (unchanged).

**Spec:** [2026-06-14-wisper-android-port-design.md](../specs/2026-06-14-wisper-android-port-design.md)

---

## File Structure

```
wisper/
├── config/config.go             # MODIFY: Option type + WithConfigDir, Init(opts...)
├── app.go                       # NEW: Start()/Stop() — always compiled, pure Go
├── main.go                      # MODIFY: delegate to Start()/Stop(), slim imports
├── lib.go                       # NEW: //go:build cgo — JNI bridge via cgo preamble
├── Makefile                     # MODIFY: add `make android` target

├── android/                     # NEW: Android project root
│   ├── build.gradle.kts
│   ├── settings.gradle.kts
│   ├── gradle.properties
│   ├── x-dialer-android.patch   # x-module patch
│   ├── Dockerfile.android       # Docker image: Ubuntu 24.04 + Go + SDK + NDK + Gradle
│   └── app/
│       ├── build.gradle.kts
│       └── src/main/
│           ├── AndroidManifest.xml
│           └── java/run/gost/wisper/
│               ├── MainActivity.kt
│               └── WisperJNI.kt
```

---

### Task 1: Go refactor — config.WithConfigDir option

**Files:**
- Modify: `config/config.go:27-61`

- [ ] **Step 1: Add Option type and WithConfigDir**

Insert after `var (configDir string)` block (after line 29):

```go
// Option configures the Init behavior.
type Option func(*options)

type options struct {
	configDir string
}

// WithConfigDir sets an explicit config directory for Init().
// When empty (default behavior), Init() uses os.UserConfigDir() + "/wisper".
func WithConfigDir(dir string) Option {
	return func(o *options) {
		o.configDir = dir
	}
}
```

- [ ] **Step 2: Change `func Init()` to `func Init(opts ...Option)` and use the option**

Replace `func Init() {` through `initLog()` (lines 36-61) with:

```go
func Init(opts ...Option) {
	o := &options{}
	for _, opt := range opts {
		opt(o)
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true})))

	if o.configDir != "" {
		configDir = o.configDir
	} else {
		dir, err := os.UserConfigDir()
		if err != nil {
			slog.Error(fmt.Sprintf("configDir: %v", err))
		}
		if dir == "" {
			dir, _ = os.Getwd()
		}
		configDir = filepath.Join(dir, "wisper")
	}
	os.MkdirAll(configDir, 0755)

	slog.Info(fmt.Sprintf("configDir: %s", configDir))

	cfg := Get()
	if err := cfg.load(); err != nil {
		slog.Error(fmt.Sprintf("load config: %v", err))
		if _, ok := err.(*os.PathError); ok {
			cfg.Write()
		}
	}
	Set(cfg)

	initLog()
}
```

The rest of the file (types, Get/Set, Write, deepCopy) is unchanged.

- [ ] **Step 3: Verify desktop build still works**

```bash
CGO_ENABLED=0 go build -o /dev/null .
```

Expected: exit 0. `config.Init()` call in `main.go` still compiles — variadic params default to empty.

- [ ] **Step 4: Commit**

```bash
git add config/config.go
git commit -m "feat(config): add WithConfigDir functional option to Init()"
```

---

### Task 2: Go refactor — extract Start/Stop into app.go

**Files:**
- Create: `app.go`
- Modify: `main.go:1-85`

- [ ] **Step 1: Create app.go**

```go
package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/wisper/api"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/runner"
	"github.com/go-gost/wisper/runner/task"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

var (
	httpServer atomic.Pointer[http.Server]
	stopOnce   sync.Once
)

// Start initializes wisper and starts the HTTP server in a background goroutine.
// configDir: path for config/logs (empty = OS user config dir).
// addr: listen address, e.g. "127.0.0.1:8900" (Android) or ":8900" (desktop).
func Start(configDir, addr string) error {
	config.Init(config.WithConfigDir(configDir))
	tunnel.LoadConfig()
	entrypoint.LoadConfig()

	statsInterval := 1
	if s := config.Get().Settings; s != nil && s.StatsInterval > 0 {
		statsInterval = s.StatsInterval
	}
	runner.Exec(context.Background(), task.UpdateStats(),
		runner.WithAsync(true),
		runner.WithInterval(time.Duration(statsInterval)*time.Second),
		runner.WithCancel(true),
	)

	handler := api.NewHandler(webFileServer())
	srv := &http.Server{Handler: handler}
	httpServer.Store(srv)

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	slog.Info("wisper listening", "addr", ln.Addr())

	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
		}
	}()

	return nil
}

// Stop persists state and gracefully shuts down the HTTP server.
// Safe to call multiple times; only the first call has effect.
func Stop() {
	stopOnce.Do(func() {
		slog.Info("shutting down...")
		tunnel.SaveConfig()
		entrypoint.SaveConfig()

		if srv := httpServer.Load(); srv != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			srv.Shutdown(ctx)
		}
		slog.Info("wisper stopped")
	})
}
```

- [ ] **Step 2: Rewrite main.go**

Replace the entire `main.go` with:

```go
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-gost/wisper/version"
)

func main() {
	addr := flag.String("addr", ":8900", "HTTP API listen address")
	showVersion := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("wisper %s\n", version.Version)
		os.Exit(0)
	}

	if err := Start("", *addr); err != nil {
		slog.Error("start failed", "addr", *addr, "err", err)
		os.Exit(1)
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	Stop()
}
```

- [ ] **Step 3: Verify desktop build, vet, and tests pass**

```bash
make web
CGO_ENABLED=0 go build -o /dev/null .
CGO_ENABLED=0 go vet ./...
go test ./... -v
```

Expected: all pass.

- [ ] **Step 4: Run server smoke test**

```bash
go build -o wisper .
./wisper &
sleep 1
curl -s http://127.0.0.1:8900/api/config | head -c 200
kill %1
```

Expected: JSON response from `/api/config`, clean shutdown.

- [ ] **Step 5: Commit**

```bash
git add app.go main.go
git commit -m "feat: extract Start/Stop from main() into app.go"
```

---

### Task 3: Create x-module Android patch

**Files:**
- Create: `android/x-dialer-android.patch`

- [ ] **Step 1: Write the patch file**

```diff
diff --git a/internal/net/dialer/dialer.go b/internal/net/dialer/dialer.go
--- a/internal/net/dialer/dialer.go
+++ b/internal/net/dialer/dialer.go
@@ -3,18 +3,16 @@
 import (
 	"context"
 	"fmt"
 	"net"
-	"runtime"
 	"strings"
 	"syscall"
 	"time"
 
 	"github.com/go-gost/core/logger"
 	ctxvalue "github.com/go-gost/x/ctx"
 	xnet "github.com/go-gost/x/internal/net"
-	"github.com/vishvananda/netns"
 )
 
 const (
 	// DefaultTimeout is the default dial timeout.
 	DefaultTimeout = 10 * time.Second
@@ -53,28 +51,9 @@
 		})
 
-	if d.Netns != "" {
-		runtime.LockOSThread()
-		defer runtime.UnlockOSThread()
-
-		originNs, err := netns.Get()
-		if err != nil {
-			return nil, fmt.Errorf("netns.Get(): %v", err)
-		}
-		defer netns.Set(originNs)
-
-		var ns netns.NsHandle
-		if strings.HasPrefix(d.Netns, "/") {
-			ns, err = netns.GetFromPath(d.Netns)
-		} else {
-			ns, err = netns.GetFromName(d.Netns)
-		}
-		if err != nil {
-			return nil, fmt.Errorf("netns.Get(%s): %v", d.Netns, err)
-		}
-		defer ns.Close()
-
-		if err := netns.Set(ns); err != nil {
-			return nil, fmt.Errorf("netns.Set(%s): %v", d.Netns, err)
-		}
+	if d.Netns != "" {
+		if err := switchNetns(d.Netns); err != nil {
+			return nil, err
+		}
 	}
 
diff --git a/internal/net/dialer/dialer_netns.go b/internal/net/dialer/dialer_netns.go
new file mode 100644
--- /dev/null
+++ b/internal/net/dialer/dialer_netns.go
@@ -0,0 +1,41 @@
+//go:build linux
+
+package dialer
+
+import (
+	"fmt"
+	"runtime"
+	"strings"
+
+	"github.com/vishvananda/netns"
+)
+
+func switchNetns(name string) error {
+	runtime.LockOSThread()
+	defer runtime.UnlockOSThread()
+
+	originNs, err := netns.Get()
+	if err != nil {
+		return fmt.Errorf("netns.Get(): %v", err)
+	}
+	defer netns.Set(originNs)
+
+	var ns netns.NsHandle
+	if strings.HasPrefix(name, "/") {
+		ns, err = netns.GetFromPath(name)
+	} else {
+		ns, err = netns.GetFromName(name)
+	}
+	if err != nil {
+		return fmt.Errorf("netns.Get(%s): %v", name, err)
+	}
+	defer ns.Close()
+
+	if err := netns.Set(ns); err != nil {
+		return fmt.Errorf("netns.Set(%s): %v", name, err)
+	}
+
+	return nil
+}
diff --git a/internal/net/dialer/dialer_android.go b/internal/net/dialer/dialer_android.go
new file mode 100644
--- /dev/null
+++ b/internal/net/dialer/dialer_android.go
@@ -0,0 +1,17 @@
+//go:build android
+
+package dialer
+
+import "fmt"
+
+func switchNetns(name string) error {
+	return fmt.Errorf("netns not supported on android")
+}
+
+func bindDevice(network, address string, fd uintptr, ifceName string) error {
+	return nil
+}
+
+func setMark(fd uintptr, mark int) error {
+	return nil
+}
```

**What the patch does:**
1. Removes `vishvananda/netns` and `runtime` imports from `dialer.go` (netns doesn't compile on GOOS=android; `runtime` was only used in the netns block).
2. Replaces the inline netns block in `Dial()` with a call to `switchNetns(d.Netns)`.
3. Adds `dialer_netns.go` (`//go:build linux`): real `switchNetns()` implementation with `vishvananda/netns`.
4. Adds `dialer_android.go` (`//go:build android`): stub `switchNetns()` (returns error), `bindDevice()`, and `setMark()`. Android is its own GOOS — neither `dialer_linux.go` (`_linux.go`) nor `dialer_other.go` (`!unix && !windows`) covers it, so these symbols would be undefined at link time.

- [ ] **Step 2: Verify the patch applies cleanly to the x module**

```bash
X_DIR=$(go list -m -f '{{.Dir}}' github.com/go-gost/x)
cd "$X_DIR"
git apply --check "$(pwd)/../wisper/android/x-dialer-android.patch" 2>&1 || echo "Trying from wisper root..."
cd /home/gerry/code/go-gost/wisper
git -C "$X_DIR" apply --check android/x-dialer-android.patch
```

Expected: no output (clean application). If line numbers drift, adjust the hunk headers.

- [ ] **Step 3: Commit**

```bash
git add android/x-dialer-android.patch
git commit -m "feat(android): add x-module dialer patch for GOOS=android cross-compile"
```

---

### Task 4: Create Go JNI bridge (lib.go)

**Files:**
- Create: `lib.go`

**Design note:** This file uses `//go:build cgo` — it's only compiled with `CGO_ENABLED=1`. Desktop builds (`CGO_ENABLED=0`) skip it but still get `Start()`/`Stop()` from `app.go`. The cgo C preamble contains the JNI bridge — no separate `.c` file needed.

- [ ] **Step 1: Write lib.go**

```go
//go:build cgo

package main

/*
#include <jni.h>
#include <stdlib.h>

// Go functions — declared here so the C JNI bridge can call them.
extern int wisperStartGo(char* configDir, char* addr);
extern void wisperStopGo();

// JNI bridge: Kotlin String → C string → Go function.
JNIEXPORT jint JNICALL
Java_run_gost_wisper_WisperJNI_start(JNIEnv *env, jclass clazz,
	jstring configDir, jstring addr) {
	const char *configDirC = (*env)->GetStringUTFChars(env, configDir, NULL);
	const char *addrC      = (*env)->GetStringUTFChars(env, addr, NULL);

	jint result = wisperStartGo((char*)configDirC, (char*)addrC);

	(*env)->ReleaseStringUTFChars(env, configDir, configDirC);
	(*env)->ReleaseStringUTFChars(env, addr, addrC);

	return result;
}

JNIEXPORT void JNICALL
Java_run_gost_wisper_WisperJNI_stop(JNIEnv *env, jclass clazz) {
	wisperStopGo();
}
*/
import "C"

// wisperStartGo bridges C → Go. Returns 0 on success, -1 on error.
func wisperStartGo(configDirC *C.char, addrC *C.char) C.int {
	if err := Start(C.GoString(configDirC), C.GoString(addrC)); err != nil {
		return -1
	}
	return 0
}

// wisperStopGo bridges C → Go.
func wisperStopGo() {
	Stop()
}

// main is required by c-shared build mode; never called directly.
func main() {}
```

- [ ] **Step 2: Verify go build can parse the file (no NDK needed for parse check)**

```bash
cd /home/gerry/code/go-gost/wisper
GOOS=android GOARCH=arm64 CGO_ENABLED=1 go build -buildmode=c-shared -n -o /dev/null . 2>&1 | head -20
```

Expected: shows compile/link commands (parsing succeeds; link will fail at this stage without NDK — that's OK).

- [ ] **Step 3: Commit**

```bash
git add lib.go
git commit -m "feat(android): add JNI bridge lib.go (cgo c-shared entry point)"
```

---

### Task 5: Android project scaffold + Kotlin shell

**Files (all new):**
- `android/settings.gradle.kts`
- `android/build.gradle.kts`
- `android/gradle.properties`
- `android/app/build.gradle.kts`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/run/gost/wisper/MainActivity.kt`
- `android/app/src/main/java/run/gost/wisper/WisperJNI.kt`

- [ ] **Step 1: Create android/settings.gradle.kts**

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "Wisper"
include(":app")
```

- [ ] **Step 2: Create android/build.gradle.kts**

```kotlin
plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.20" apply false
}
```

- [ ] **Step 3: Create android/gradle.properties**

```properties
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
```

- [ ] **Step 4: Create android/app/build.gradle.kts**

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "run.gost.wisper"
    compileSdk = 34

    defaultConfig {
        applicationId = "run.gost.wisper"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("src/main/jniLibs")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
}
```

- [ ] **Step 5: Create AndroidManifest.xml**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:label="Wisper"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

`usesCleartextTraffic="true"` is needed because WebView loads `http://127.0.0.1:8900` (loopback cleartext). Android's default NetworkSecurityConfig allows cleartext to loopback, but the WebView may still enforce HTTPS without this attribute.

- [ ] **Step 6: Create MainActivity.kt**

```kotlin
package run.gost.wisper

import android.os.Bundle
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Start the Go backend in-process via JNI.
        // filesDir = /data/data/run.gost.wisper/files (app sandbox).
        // Listen on loopback only — no external access to the API.
        val err = WisperJNI.start(filesDir.absolutePath, "127.0.0.1:8900")
        if (err != 0) {
            throw RuntimeException("wisper start failed: $err")
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            loadUrl("http://127.0.0.1:8900")
        }
        setContentView(webView)
    }

    override fun onDestroy() {
        WisperJNI.stop()
        super.onDestroy()
    }
}
```

- [ ] **Step 7: Create WisperJNI.kt**

```kotlin
package run.gost.wisper

object WisperJNI {
    init {
        System.loadLibrary("wisper")
    }

    /** Start the Go backend. Returns 0 on success, -1 on error. */
    external fun start(configDir: String, addr: String): Int

    /** Stop the Go backend (persist state + graceful shutdown). */
    external fun stop()
}
```

Note: `System.loadLibrary("wisper")` looks for `libwisper.so` — the `lib` prefix and `.so` suffix are automatic.

- [ ] **Step 8: Commit**

```bash
git add android/settings.gradle.kts android/build.gradle.kts android/gradle.properties \
        android/app/build.gradle.kts android/app/src/main/
git commit -m "feat(android): add project scaffold + Kotlin shell (MainActivity, WebView, JNI)"
```

---

### Task 6: Docker build container + Gradle wrapper + Makefile target

**Files:**
- Create: `android/Dockerfile.android`
- Create: `android/gradle/wrapper/gradle-wrapper.properties`
- Modify: `Makefile` (add `make android` before `clean` target)

**Why Docker:** The host has no Android SDK, NDK, Java, or Gradle. A Docker image provides reproducible builds — same pattern as the existing desktop (`Dockerfile.desktop`) and Windows (`Dockerfile.windows`) builds.

- [ ] **Step 1: Create android/Dockerfile.android**

```dockerfile
# Docker image with Go 1.26, Android SDK 34, NDK 26.1, and Gradle 8.5.
# Build:  docker build -t wisper-android -f android/Dockerfile.android android/
# Usage:  docker run --rm -v "$(cd ../.. && pwd):/go-gost" wisper-android \
#           sh -c 'cd /go-gost/wisper && make android'

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_NDK_HOME=/opt/android-sdk/ndk/26.1.10909125
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip wget ca-certificates git make \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Go 1.26.4
RUN curl -fsSL https://go.dev/dl/go1.26.4.linux-amd64.tar.gz | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:$PATH"

# Gradle 8.5
RUN curl -fsSL https://services.gradle.org/distributions/gradle-8.5-bin.zip -o /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && rm /tmp/gradle.zip
ENV PATH="/opt/gradle-8.5/bin:$PATH"

# Android SDK command-line tools
RUN mkdir -p $ANDROID_SDK_ROOT/cmdline-tools \
    && curl -fsSL -o /tmp/cmdline-tools.zip \
        https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
    && unzip -q /tmp/cmdline-tools.zip -d /tmp \
    && mv /tmp/cmdline-tools $ANDROID_SDK_ROOT/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip

# Accept licenses and install SDK + NDK packages
RUN yes | sdkmanager --licenses > /dev/null 2>&1 || true \
    && sdkmanager \
        "platform-tools" \
        "platforms;android-34" \
        "build-tools;34.0.0" \
        "ndk;26.1.10909125"

WORKDIR /go-gost
```

- [ ] **Step 2: Create android/gradle/wrapper/gradle-wrapper.properties**

```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.5-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

- [ ] **Step 3: Download gradle-wrapper.jar**

```bash
mkdir -p android/gradle/wrapper
curl -fsSL -o android/gradle/wrapper/gradle-wrapper.jar \
    https://github.com/gradle/gradle/raw/v8.5.0/gradle/wrapper/gradle-wrapper.jar
```

- [ ] **Step 4: Create android/gradlew (shell script)**

```bash
#!/bin/sh

# Gradle wrapper starter script — see
# https://docs.gradle.org/current/userguide/gradle_wrapper.html

# Use system gradle if available, otherwise download.
exec gradle "$@" 2>/dev/null || exec java -cp "$(dirname "$0")/gradle/wrapper/gradle-wrapper.jar" \
    org.gradle.wrapper.GradleWrapperMain "$@"
```

```bash
chmod +x android/gradlew
```

- [ ] **Step 5: Add `make android` target to Makefile**

Insert before the `clean:` target (around line 233). Replace the X_MODULE_DIR computation with the workspace-relative path that works inside Docker:

```makefile
# ----- Android APK (Docker build) -----
# Builds libwisper.so via NDK cross-compile + APK via Gradle, all inside a
# Docker container (host needs no Android toolchain).
#
# Prerequisites: Docker, Go 1.26+ on host (for `make web`).
#
# Artifacts: android/app/build/outputs/apk/debug/app-debug.apk
#

ANDROID_IMAGE := wisper-android
ANDROID_PATCH := android/x-dialer-android.patch

.PHONY: android
android: web
	@echo "==> Building Docker image $(ANDROID_IMAGE)..."
	DOCKER_BUILDKIT=1 docker build -t $(ANDROID_IMAGE) -f android/Dockerfile.android android/
	@echo "==> Cross-compiling Go + building APK in container..."
	@mkdir -p android/app/src/main/jniLibs/arm64-v8a
	docker run --rm \
		-v "$(PWD)/..:/go-gost" \
		-v "$$(go env GOMODCACHE):/root/go/pkg/mod" \
		-v "$$(go env GOCACHE):/root/.cache/go-build" \
		-w /go-gost/wisper \
		$(ANDROID_IMAGE) sh -c '\
		set -e; \
		echo "--- Patching x module for Android ---"; \
		cd /go-gost/x; \
		git apply /go-gost/wisper/$(ANDROID_PATCH); \
		echo "--- Cross-compiling libwisper.so (arm64-v8a) ---"; \
		cd /go-gost/wisper; \
		export CC=$$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang; \
		export CXX=$$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang++; \
		export CGO_ENABLED=1; \
		export GOOS=android; \
		export GOARCH=arm64; \
		export GOWORK=/go-gost/go.work; \
		go build -buildmode=c-shared -ldflags="-s -w" \
			-o android/app/src/main/jniLibs/arm64-v8a/libwisper.so .; \
		echo "--- Reverting x-module patch ---"; \
		cd /go-gost/x; \
		git checkout -- internal/net/dialer/; \
		echo "--- Assembling APK with Gradle ---"; \
		cd /go-gost/wisper/android; \
		gradle wrapper --gradle-version 8.5 --no-daemon 2>/dev/null || true; \
		./gradlew assembleDebug --no-daemon; \
		'
	@echo "==> APK ready:"
	@ls -lh android/app/build/outputs/apk/debug/*.apk 2>/dev/null || echo "  (no .apk found — check container logs)"
```

- [ ] **Step 6: Verify the Docker image builds**

```bash
DOCKER_BUILDKIT=1 docker build -t wisper-android -f android/Dockerfile.android android/
```

Expected: image builds successfully (takes 3-5 min, ~2.5GB image).

- [ ] **Step 7: Commit**

```bash
git add android/Dockerfile.android android/gradle/wrapper/gradle-wrapper.properties \
        android/gradlew Makefile
git commit -m "feat(android): add Docker build container + Gradle wrapper + make android target"
```

---

### Task 7: End-to-end build

- [ ] **Step 1: Run the full Android build**

```bash
make android
```

Expected output stages:
1. Web UI builds (`make web`) — on host
2. Docker image builds (first time: ~3-5 min)
3. Container starts, applies x-module patch
4. Go cross-compile produces `libwisper.so`
5. Patch reverted
6. Gradle assembles `app-debug.apk`
7. APK path printed

- [ ] **Step 2: Verify the APK contains libwisper.so**

```bash
unzip -l android/app/build/outputs/apk/debug/app-debug.apk | grep -E "libwisper|\.dex|AndroidManifest"
```

Expected output similar to:
```
   12345  ...   lib/arm64-v8a/libwisper.so
    6789  ...   classes.dex
    1234  ...   AndroidManifest.xml
```

- [ ] **Step 3: Commit the APK (optional)**

```bash
# Not committed by default — large binary
ls -lh android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Build Troubleshooting Guide

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `git apply` fails on x module | Patch line numbers drifted | Regenerate: apply changes manually to `x/internal/net/dialer/`, then `cd ../x && git diff -- internal/net/dialer/ > ../wisper/android/x-dialer-android.patch; git checkout -- internal/net/dialer/` |
| Go link error: undefined symbol `bindDevice` | Android needs its own `_android.go` stub | Verify `dialer_android.go` was created by patch |
| Go link error: undefined JNI symbol | cgo preamble not including `jni.h` correctly | Check NDK `sysroot/usr/include` is on clang's default include path |
| Gradle sync failure in Docker | First run, Gradle wrapper downloads Gradle | Expected; retry — it downloads once then caches in container |
| WebView shows "connection refused" | Go server not started or wrong port | Check `WisperJNI.start()` return code; verify `libwisper.so` has the JNI symbols (`nm -D libwisper.so \| grep WisperJNI`) |
| `go: no matching versions` in Docker | Go module cache needs refreshing | Mount `GOMODCACHE` from host or run `go mod download` in container |

## Verification Checklist

1. **Desktop regression:** `make web && go build . && go vet ./... && go test ./...` — all pass after Task 2.
2. **Patch applies:** `git -C $(go list -m -f '{{.Dir}}' github.com/go-gost/x) apply --check android/x-dialer-android.patch` — clean.
3. **Cross-compile succeeds:** `make android` produces `libwisper.so` without link errors.
4. **JNI symbols exported:** `nm -D android/app/src/main/jniLibs/arm64-v8a/libwisper.so | grep Java_run_gost_wisper_WisperJNI` — `start` and `stop` symbols present.
5. **APK assembled:** `.apk` file exists under `android/app/build/outputs/apk/debug/`.
6. **Device test:** Install on arm64 Android 10+ → app opens → WebView loads Wisper UI → create a tunnel → verify tunnel works → close app → verify cleanup.
