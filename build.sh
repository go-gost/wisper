#!/usr/bin/env bash
# wisper/build.sh — Build the Go backend and Flutter app together.
#
# Usage:
#   ./build.sh <platform>
#
# Platforms: linux, macos, windows, apk, ios
#
# This script:
# 1. Cross-compiles the Go backend for the target platform
# 2. Places the binary where the Flutter app expects it
# 3. Runs flutter build for the target platform

set -euo pipefail

BINARY="wisper"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
FLUTTER_DIR="$SCRIPT_DIR/flutter"

# Determine Go target OS/ARCH from platform argument.
case "${1:-}" in
  linux)
    GOOS=linux GOARCH=amd64
    FLUTTER_CMD="flutter build linux"
    BUNDLE_DIR="$FLUTTER_DIR/build/linux/x64/release/bundle"
    ;;
  macos)
    GOOS=darwin GOARCH=arm64
    FLUTTER_CMD="flutter build macos"
    BUNDLE_DIR="$FLUTTER_DIR/build/macos/Build/Products/Release/wisper.app/Contents/MacOS"
    ;;
  windows)
    GOOS=windows GOARCH=amd64
    FLUTTER_CMD="flutter build windows"
    BUNDLE_DIR="$FLUTTER_DIR/build/windows/x64/runner/Release"
    ;;
  apk)
    echo "Android APK: Go backend must be bundled as a native library (not supported by this script)"
    echo "Use a FFI bridge or gomobile for Android/iOS."
    exit 1
    ;;
  ios)
    echo "iOS: Go backend must be bundled as a native framework (not supported by this script)"
    echo "Use gomobile bind for iOS."
    exit 1
    ;;
  *)
    echo "Usage: $0 {linux|macos|windows}"
    exit 1
    ;;
esac

# Step 1: Build Go backend.
OUT_NAME="$BINARY"
[ "$GOOS" = "windows" ] && OUT_NAME="$BINARY.exe"
OUT_PATH="$DIST_DIR/$GOOS-$GOARCH/$OUT_NAME"

echo "==> Building Go backend ($GOOS/$GOARCH)..."
mkdir -p "$(dirname "$OUT_PATH")"
CGO_ENABLED=0 GOOS=$GOOS GOARCH=$GOARCH go build -ldflags="-s -w" -o "$OUT_PATH" .

echo "    Output: $OUT_PATH ($(du -h "$OUT_PATH" | cut -f1))"

# Step 2: Build Flutter app.
echo "==> Building Flutter app ($1)..."
(cd "$FLUTTER_DIR" && $FLUTTER_CMD)

# Step 3: Copy Go binary into the Flutter bundle.
echo "==> Copying Go backend into Flutter bundle..."
mkdir -p "$BUNDLE_DIR"
cp "$OUT_PATH" "$BUNDLE_DIR/$OUT_NAME"
chmod +x "$BUNDLE_DIR/$OUT_NAME"

echo "==> Done! Bundle at: $BUNDLE_DIR"
