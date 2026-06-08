# Wisper — Build Go backend for all platforms
#
# Usage:
#   make all          — build all platforms
#   make linux        — build Linux amd64
#   make darwin       — build macOS arm64 + amd64
#   make windows      — build Windows amd64
#   make clean        — remove build artifacts

BINARY  := wisper
VERSION := 0.1.0
LDFLAGS := -s -w -X main.version=$(VERSION)

# Output directories
DIST_DIR   := dist
FLUTTER_ASSETS := flutter/assets/backend

.PHONY: all linux darwin windows web clean

all: linux darwin windows

# ----- Flutter Web (embedded into Go binary) -----
web:
	cd flutter && flutter build web --no-source-maps --no-wasm-dry-run
	rm -rf web
	mv flutter/build/web web
	rm -rf web/canvaskit
	rm -rf web/assets/assets/backend
	find web/ -name '*.symbols' -delete
	find web/ -name 'NOTICES' -delete

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

# ----- Copy to Flutter assets -----
# Call after building the target platform. Example: make flutter-linux
.PHONY: flutter-linux flutter-darwin flutter-windows

flutter-linux: linux
	mkdir -p $(FLUTTER_ASSETS)
	cp $(DIST_DIR)/linux-amd64/$(BINARY) $(FLUTTER_ASSETS)/$(BINARY)

flutter-darwin: darwin
	mkdir -p $(FLUTTER_ASSETS)
	cp $(DIST_DIR)/darwin-arm64/$(BINARY) $(FLUTTER_ASSETS)/$(BINARY)

flutter-windows: windows
	mkdir -p $(FLUTTER_ASSETS)
	cp $(DIST_DIR)/windows-amd64/$(BINARY).exe $(FLUTTER_ASSETS)/$(BINARY).exe

# ----- Clean -----
clean:
	rm -rf $(DIST_DIR)
