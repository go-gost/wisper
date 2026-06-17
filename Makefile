# Wisper — Build Go backend for all platforms
#
# Usage:
#   make all          — build all platforms
#   make linux        — build Linux amd64
#   make darwin       — build macOS arm64 + amd64
#   make windows      — build Windows amd64
#   make web          — build Lit web UI (Vite + TypeScript)
#   make typecheck    — type-check web UI (tsc --noEmit); Vite/esbuild skips this
#   make clean        — remove build artifacts

BINARY  := wisper
VERSION := 0.1.0
LDFLAGS := -s -w -X github.com/go-gost/wisper/version.Version=$(VERSION)

# Output directories
DIST_DIR   := dist

# Tauri desktop app
TARGET_TRIPLE := $(shell rustc -vV 2>/dev/null | grep host | awk '{print $$2}')
SIDECAR_DIR   := src-tauri/binaries
# The sidecar binary name MUST differ from the Cargo package name (`wisper`),
# otherwise Tauri 2 refuses to build: "Cannot define a sidecar with the same
# name as the Cargo package name". This must match externalBin in
# tauri.conf.json and the sidecar() call in src-tauri/src/lib.rs.
SIDECAR_NAME  := wisper-api
SIDECAR       := $(SIDECAR_DIR)/$(SIDECAR_NAME)-$(TARGET_TRIPLE)

.PHONY: all linux darwin windows web web-force typecheck clean sidecar tauri-dev tauri-build tauri-deps icons windows-sidecar windows-installer linux-installer android-test-image android-test-smoke android-test-full android-test-stop

all: linux darwin windows

# ----- Lit Web UI (embedded into Go binary) -----
# Uses Vite + TypeScript + Lit for a fast, lightweight web build.
# Build is skipped when no source files have changed.
web:
	@STAMP="web/.build_stamp"; NEEDS_BUILD=0; \
	if [ ! -f "$$STAMP" ]; then NEEDS_BUILD=1; \
	elif [ -n "$$(find web-src/src/ -type f -newer $$STAMP 2>/dev/null)" ]; then NEEDS_BUILD=1; \
	elif [ "web-src/package.json" -nt "$$STAMP" ]; then NEEDS_BUILD=1; \
	elif [ ! -f "web/index.html" ]; then NEEDS_BUILD=1; \
	elif [ ! -f "web/assets/main-*.js" ] && [ ! -f "web/assets/index-*.js" ]; then NEEDS_BUILD=1; fi; \
	if [ "$$NEEDS_BUILD" -eq 1 ]; then \
		echo "Building Lit web UI (Vite + TypeScript)..."; \
		rm -rf web; \
		(cd web-src && npm ci && npx vite build) || { echo "Vite build failed"; exit 1; }; \
		touch "$$STAMP"; \
		echo "Web build complete"; \
	else \
		echo "No source changes, skipping web build (use 'make web-force' to force)"; \
	fi

.PHONY: web-force
web-force:
	rm -f web/.build_stamp
	$(MAKE) web

# ----- Branding icons -----
# Regenerate the desktop icon set (src-tauri/icons/) and the web assets
# (web-src/public/) from appicon.png. Re-run whenever appicon.png changes.
# Requires Python 3 + Pillow.
.PHONY: icons
icons:
	python3 scripts/gen-icons.py

# ----- Type-check (tsc) -----
# Vite/esbuild strips types without checking them, so type errors (e.g. an
# undefined-variable reference after a rename) build green and fail at runtime.
# Run this to catch them. NOTE: not wired into `web` because home-page.ts still
# has unused-symbol errors from the in-progress favorites cleanup.
.PHONY: typecheck
typecheck:
	cd web-src && npx tsc --noEmit

# ----- Linux -----
linux: $(DIST_DIR)/linux-amd64/$(BINARY)

$(DIST_DIR)/linux-amd64/$(BINARY):
	@mkdir -p $(dir $@)
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $@ .

# ----- macOS -----
darwin: $(DIST_DIR)/darwin-arm64/$(BINARY) $(DIST_DIR)/darwin-amd64/$(BINARY)

$(DIST_DIR)/darwin-arm64/$(BINARY):
	@mkdir -p $(dir $@)
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $@ .

$(DIST_DIR)/darwin-amd64/$(BINARY):
	@mkdir -p $(dir $@)
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $@ .

# ----- Windows -----
windows: $(DIST_DIR)/windows-amd64/$(BINARY).exe

$(DIST_DIR)/windows-amd64/$(BINARY).exe:
	@mkdir -p $(dir $@)
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $@ .

# ----- Tauri Desktop App -----
# Run on each target platform to produce native installers (.deb, .dmg, .msi).

# Build the Go sidecar for the host platform and place it where Tauri expects it.
# Tauri appends -<target-triple> automatically to the name in externalBin.
.PHONY: sidecar
sidecar:
	@echo "Building wisper sidecar for $(TARGET_TRIPLE)..."
	@mkdir -p $(SIDECAR_DIR)
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o $(SIDECAR) .
	@echo "Sidecar ready: $(SIDECAR)"

# Development mode — hot-reload frontend + sidecar.
# Requires Tauri CLI: cargo install tauri-cli --version "^2"
.PHONY: tauri-dev
tauri-dev: web sidecar
	cargo tauri dev

# Production desktop build for the host platform.
.PHONY: tauri-build
tauri-build: web sidecar
	cargo tauri build

# Print OS-specific instructions for installing Tauri 2 system dependencies.
# Linux requires webkit2gtk + gtk dev packages.  macOS and Windows only need
# the standard build toolchain (Xcode CLT / Visual Studio Build Tools).
.PHONY: tauri-deps
tauri-deps:
	@echo "Tauri 2 system dependencies:"
	@echo ""
	@echo "  Ubuntu / Debian:"
	@echo "    sudo apt-get install -y \\"
	@echo "      libwebkit2gtk-4.1-dev libgtk-3-dev \\"
	@echo "      libayatana-appindicator3-dev librsvg2-dev \\"
	@echo "      libsoup-3.0-dev libjavascriptcoregtk-4.1-dev"
	@echo ""
	@echo "  Fedora:"
	@echo "    sudo dnf install webkit2gtk4.1-devel gtk3-devel \\"
	@echo "      libappindicator-gtk3-devel librsvg2-devel"
	@echo ""
	@echo "  macOS:  no extra deps (Xcode CLT is enough)"
	@echo "  Windows: WebView2 is pre-installed on Win10 21H2+ / Win11"
	@echo ""
	@echo "  Tauri CLI: cargo install tauri-cli --version \"^2\""

# ----- Windows NSIS installer (Docker cross-compile on Linux) -----
# Builds the Windows installer WITHOUT a Windows host or sudo. Rust is NOT in
# the Docker image — the host's Rust toolchain (~/.rustup + ~/.cargo) is
# volume-mounted in, so the build uses the host's already-installed rustc,
# cargo-xwin, and Windows MSVC target. Only makensis + lld + Node live in the
# image. Artifacts land on the host via a bind-mount of the repo root.
#
# Prerequisites on the host (one-time):
#   rustc + cargo (already installed)
#   cargo-xwin:  cargo install cargo-xwin --locked
#   Windows target:  rustup target add x86_64-pc-windows-msvc
#
# Division of labor:
#   host  → make web  +  make windows-sidecar
#   image → npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
#
# Artifacts land in:
#   src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/

WIN_TRIPLE    := x86_64-pc-windows-msvc
WIN_SIDECAR   := $(SIDECAR_DIR)/$(SIDECAR_NAME)-$(WIN_TRIPLE).exe
WIN_IMAGE     := wisper-windows
WIN_DIST      := src-tauri/target/$(WIN_TRIPLE)/release/bundle/nsis

# Cross-compile the Go sidecar for Windows amd64.
# Pure Go (CGO_ENABLED=0), so no Windows toolchain needed on the host.
.PHONY: windows-sidecar
windows-sidecar:
	@echo "Building wisper sidecar for $(WIN_TRIPLE)..."
	@mkdir -p $(SIDECAR_DIR)
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(WIN_SIDECAR) .
	@echo "Sidecar ready: $(WIN_SIDECAR)"

# Full pipeline: web → windows-sidecar → docker build image → docker run builds .exe.
# The repo root is bind-mounted into the container so the tauri build output
# lands directly back on the host. Host Rust toolchain is volume-mounted to
# bypass the flaky static.rust-lang.org CDN.
.PHONY: windows-installer
windows-installer: web windows-sidecar
	@echo "==> Building Docker image $(WIN_IMAGE)..."
	DOCKER_BUILDKIT=1 docker build -t $(WIN_IMAGE) -f Dockerfile.windows .
	@echo "==> Running container to build NSIS installer..."
	@mkdir -p $(WIN_DIST)
	docker run --rm \
	  -v "$$PWD:/work" \
	  -v "$$HOME/.rustup:/root/.rustup:ro" \
	  -v "$$HOME/.cargo:/root/.cargo" \
	  -v "$$HOME/.cache:/root/.cache" \
	  $(WIN_IMAGE)
	@echo "==> Windows installer ready:"
	@ls -lh $(WIN_DIST)/*.exe 2>/dev/null || echo "  (no .exe found — check container logs)"

# ----- Linux desktop installer (Docker build) -----
# Builds .deb + .AppImage WITHOUT sudo or webkit2gtk on the host. Rust is NOT
# in the Docker image — the host's Rust toolchain (~/.rustup + ~/.cargo) is
# volume-mounted in, same as the Windows build.
#
# Division of labor:
#   host  → make web  +  make sidecar
#   image → npx tauri build --bundles deb,appimage
#
# Artifacts land in:
#   src-tauri/target/release/bundle/deb/
#   src-tauri/target/release/bundle/appimage/

LINUX_IMAGE         := wisper-desktop
LINUX_DEB_DIST      := src-tauri/target/release/bundle/deb
LINUX_APPIMAGE_DIST := src-tauri/target/release/bundle/appimage

.PHONY: linux-installer
linux-installer: web sidecar
	@echo "==> Building Docker image $(LINUX_IMAGE)..."
	DOCKER_BUILDKIT=1 docker build -t $(LINUX_IMAGE) -f Dockerfile.desktop .
	@echo "==> Running container to build Linux installers..."
	docker run --rm \
	  -e HOST_UID=$$(id -u) -e HOST_GID=$$(id -g) \
	  -v "$$PWD:/work" \
	  -v "$$HOME/.rustup:/root/.rustup:ro" \
	  -v "$$HOME/.cargo:/root/.cargo" \
	  $(LINUX_IMAGE)
	@echo "  (bins in /usr/bin — FHS-compliant, managed by dpkg)"
	@echo "==> Linux installers ready:"
	@ls -lh $(LINUX_DEB_DIST)/*.deb 2>/dev/null || echo "  (no .deb found — check container logs)"
	@ls -lh $(LINUX_APPIMAGE_DIST)/*.AppImage 2>/dev/null || echo "  (no .AppImage found — check container logs)"

# ----- Cross-platform Go binaries (no Tauri shell) -----

# ----- Android APK (Docker build) -----
# Builds libwisper.so via NDK cross-compile + APK via Gradle, all inside a
# Docker container (host needs no Android toolchain).
#
# Prerequisites: Docker, Go 1.26+ on host (for `make web`).
#
# Wisper is mounted as /wisper; module resolution uses go.mod alone (no go.work).
# The x module comes from the module cache as a versioned dependency (v0.11.0).
#
# Artifacts: android/app/build/outputs/apk/debug/app-debug.apk

ANDROID_IMAGE := wisper-android

.PHONY: android
android: web
	@echo "==> Building Docker image $(ANDROID_IMAGE)..."
	DOCKER_BUILDKIT=1 docker build -t $(ANDROID_IMAGE) -f android/Dockerfile.android android/
	@echo "==> Cross-compiling libwisper.so (arm64 + x86_64) + assembling APK..."
	@mkdir -p android/app/src/main/jniLibs/arm64-v8a
	@mkdir -p android/app/src/main/jniLibs/x86_64
	docker run --rm \
		-v "$(PWD):/wisper" \
		-v "$$(go env GOMODCACHE):/root/go/pkg/mod" \
		-v "$$(go env GOCACHE):/root/.cache/go-build" \
		-w /wisper \
		$(ANDROID_IMAGE) sh -c '\
		set -e; \
		NDK_BIN="$$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"; \
		echo "--- Copying JNI bridge into package root ---"; \
		cp android/lib_jni.c .; \
		echo "--- Cross-compiling libwisper.so (arm64-v8a) ---"; \
		export CC="$$NDK_BIN/aarch64-linux-android24-clang"; \
		export CXX="$$NDK_BIN/aarch64-linux-android24-clang++"; \
		export CGO_ENABLED=1; \
		export GOOS=android; \
		export GOARCH=arm64; \
		go build -buildmode=c-shared -buildvcs=false -ldflags="-s -w" \
			-o android/app/src/main/jniLibs/arm64-v8a/libwisper.so .; \
		echo "--- libwisper.so (arm64): $$(wc -c < android/app/src/main/jniLibs/arm64-v8a/libwisper.so) bytes ---"; \
		echo "--- Cross-compiling libwisper.so (x86_64) ---"; \
		export CC="$$NDK_BIN/x86_64-linux-android24-clang"; \
		export CXX="$$NDK_BIN/x86_64-linux-android24-clang++"; \
		export GOARCH=amd64; \
		go build -buildmode=c-shared -buildvcs=false -ldflags="-s -w" \
			-o android/app/src/main/jniLibs/x86_64/libwisper.so .; \
		echo "--- libwisper.so (x86_64): $$(wc -c < android/app/src/main/jniLibs/x86_64/libwisper.so) bytes ---"; \
		rm -f lib_jni.c; \
		echo "--- Assembling APK with Gradle ---"; \
		cd android; \
		gradle assembleDebug --no-daemon; \
		'
	@echo "==> APK ready:"
	@ls -lh android/app/build/outputs/apk/debug/*.apk 2>/dev/null || echo "  (no .apk found — check container logs)"

# ----- Android Automated Tests (Docker + Emulator) -----
# Prerequisites: Docker, /dev/kvm available on host.
#
#   make android-test-smoke  — smoke suite (< 90s target)
#   make android-test-full   — full suite (< 5 min target)
#   make android-test-stop   — stop & remove test container
#
# The test pipeline:
#   1. Build wisper-android-test image (FROM wisper-android + emulator + AVD)
#   2. Launch container with --privileged (needs KVM)
#   3. Boot headless emulator → wait for boot
#   4. Install APK → run connectedCheck → output report

TEST_CONTAINER := wisper-android-test-container
TEST_IMAGE     := wisper-android-test

.PHONY: android-test-image
android-test-image:
	@echo "==> Building Docker image $(TEST_IMAGE)..."
	DOCKER_BUILDKIT=1 docker build -t $(TEST_IMAGE) -f android/Dockerfile.test android/

.PHONY: android-test-smoke
android-test-smoke: android-test-image android
	@echo "==> Starting test container for SMOKE suite..."
	docker run --rm --privileged \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		-d --name $(TEST_CONTAINER) \
		-v "$(PWD):/wisper" \
		-v "$$HOME/.gradle:/root/.gradle" \
		$(TEST_IMAGE) \
		bash -c '\
			set -e; \
			/opt/start-emulator.sh; \
			echo "=== Installing APK ==="; \
			adb -s emulator-5554 install -r /wisper/android/app/build/outputs/apk/debug/app-debug.apk; \
			echo "=== Running smoke tests ==="; \
			cd /wisper/android; \
			gradle connectedDebugAndroidTest \
				-Pandroid.testInstrumentationRunnerArguments.class=run.gost.wisper.smoke.SmokeTestSuite \
				--no-daemon; \
			echo "=== Tests complete ==="; \
		'
	@echo "==> Waiting for tests (docker logs -f $(TEST_CONTAINER))..."
	docker logs -f $(TEST_CONTAINER)
	@echo ""
	@echo "==> Test report: android/app/build/reports/androidTests/connected/"

.PHONY: android-test-full
android-test-full: android-test-image android
	@echo "==> Starting test container for FULL suite..."
	docker run --rm --privileged \
		--security-opt seccomp=unconfined \
		--security-opt apparmor=unconfined \
		-d --name $(TEST_CONTAINER) \
		-v "$(PWD):/wisper" \
		-v "$$HOME/.gradle:/root/.gradle" \
		$(TEST_IMAGE) \
		bash -c '\
			set -e; \
			/opt/start-emulator.sh; \
			echo "=== Installing APK ==="; \
			adb -s emulator-5554 install -r /wisper/android/app/build/outputs/apk/debug/app-debug.apk; \
			echo "=== Running full tests ==="; \
			cd /wisper/android; \
			gradle connectedDebugAndroidTest \
				-Pandroid.testInstrumentationRunnerArguments.class=run.gost.wisper.full.FullTestSuite \
				--no-daemon; \
			echo "=== Tests complete ==="; \
		'
	@echo "==> Waiting for tests (docker logs -f $(TEST_CONTAINER))..."
	docker logs -f $(TEST_CONTAINER)
	@echo ""
	@echo "==> Test report: android/app/build/reports/androidTests/connected/"

.PHONY: android-test-stop
android-test-stop:
	docker stop $(TEST_CONTAINER) 2>/dev/null || true
	docker rm $(TEST_CONTAINER) 2>/dev/null || true

# ----- Clean -----
clean:
	rm -rf $(DIST_DIR)
	rm -rf $(SIDECAR_DIR)
	rm -rf src-tauri/target
