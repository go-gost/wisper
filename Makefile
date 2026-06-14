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
LDFLAGS := -s -w -X main.version=$(VERSION)

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

.PHONY: all linux darwin windows web web-force typecheck clean sidecar tauri-dev tauri-build tauri-deps

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

# ----- Cross-platform Go binaries (no Tauri shell) -----

# ----- Clean -----
clean:
	rm -rf $(DIST_DIR)
	rm -rf $(SIDECAR_DIR)
	rm -rf src-tauri/target
