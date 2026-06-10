#!/usr/bin/env bash
# wisper/build.sh — Build the Go backend and web UI together.
#
# Usage:
#   ./build.sh <platform>
#
# Platforms: linux, macos, windows, web
#
# Note: desktop platforms (linux/macos/windows) currently only build
# the Go backend. Desktop app wrapping (Tauri/Electron) is a future task.

set -euo pipefail

BINARY="wisper"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
WEB_SRC_DIR="$SCRIPT_DIR/web-src"

# Determine Go target OS/ARCH from platform argument.
case "${1:-}" in
  linux)
    GOOS=linux GOARCH=amd64
    BUNDLE_DIR="$DIST_DIR/$GOOS-$GOARCH"
    ;;
  macos)
    GOOS=darwin GOARCH=arm64
    BUNDLE_DIR="$DIST_DIR/$GOOS-$GOARCH"
    ;;
  windows)
    GOOS=windows GOARCH=amd64
    BUNDLE_DIR="$DIST_DIR/$GOOS-$GOARCH"
    ;;
  web)
    # Web-only: build Lit web UI via Vite (Go backend is compiled separately).
    ;;
  *)
    echo "Usage: $0 {linux|macos|windows|web}"
    exit 1
    ;;
esac

# Step 1: Build Lit web UI (no Go backend needed — it's embedded via go:embed).
if [ "$1" = "web" ]; then
  echo "==> Building Lit web UI (Vite + TypeScript)..."
  (cd "$WEB_SRC_DIR" && npm ci && npx vite build)
  echo "==> Done! Web assets at: $SCRIPT_DIR/web ($(du -sh "$SCRIPT_DIR/web" | cut -f1))"
  exit 0
fi

# Step 2: Build Go backend (for desktop platforms).
OUT_NAME="$BINARY"
[ "$GOOS" = "windows" ] && OUT_NAME="$BINARY.exe"
OUT_PATH="$BUNDLE_DIR/$OUT_NAME"

echo "==> Building Go backend ($GOOS/$GOARCH)..."
mkdir -p "$BUNDLE_DIR"
CGO_ENABLED=0 GOOS=$GOOS GOARCH=$GOARCH go build -ldflags="-s -w" -o "$OUT_PATH" .

echo "    Output: $OUT_PATH ($(du -h "$OUT_PATH" | cut -f1))"

# NOTE: Desktop app wrapping (Tauri/Electron) is not yet implemented.
# The Go binary above can be used as a sidecar or embedded server.
echo "==> Done! Binary at: $OUT_PATH"
echo "    Desktop wrapping (Tauri/Electron) is planned but not yet implemented."
