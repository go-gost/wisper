# Wisper — Build Go backend for all platforms
#
# Usage:
#   make all          — build all platforms
#   make linux        — build Linux amd64
#   make darwin       — build macOS arm64 + amd64
#   make windows      — build Windows amd64
#   make web          — build Lit web UI (Vite + TypeScript)
#   make clean        — remove build artifacts

BINARY  := wisper
VERSION := 0.1.0
LDFLAGS := -s -w -X main.version=$(VERSION)

# Output directories
DIST_DIR   := dist

.PHONY: all linux darwin windows web web-force clean

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

# ----- Clean -----
clean:
	rm -rf $(DIST_DIR)
