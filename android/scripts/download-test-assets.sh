#!/bin/bash
# download-test-assets.sh — Pre-download emulator + system image for Dockerfile.test.
#
# Dockerfile.test needs these zip files in android/test-assets/:
#   emulator-linux_x64.zip   (~258 MB)
#   x86_64-34.zip            (~1.5 GB)
#
# Usage:  ./scripts/download-test-assets.sh
#         make android-test-assets   (wraps this script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS_DIR="${SCRIPT_DIR}/../test-assets"
mkdir -p "${ASSETS_DIR}"

# ── Emulator binary ──────────────────────────────────────────────────────
# URL from repository2-3.xml <remotePackage path="emulator"> revision 36.6.11
EMULATOR_URL="https://dl.google.com/android/repository/emulator-linux_x64-10696886.zip"
EMULATOR_ZIP="${ASSETS_DIR}/emulator-linux_x64.zip"

if [ -f "${EMULATOR_ZIP}" ]; then
    echo "=== Emulator: already downloaded ($(du -h "${EMULATOR_ZIP}" | cut -f1)) ==="
else
    echo "=== Downloading emulator (~258 MB)... ==="
    curl -fsSL --retry 3 -o "${EMULATOR_ZIP}" "${EMULATOR_URL}"
    echo "=== Downloaded: $(du -h "${EMULATOR_ZIP}" | cut -f1) ==="
fi
unzip -tq "${EMULATOR_ZIP}" && echo "  ✓ emulator zip valid"

# ── System image (x86_64, API 34, Google APIs) ───────────────────────────
# URL from sys-img/google_apis/sys-img2-1.xml, revision 14
SYSIMG_URL="https://dl.google.com/android/repository/sys-img/google_apis/x86_64-34_r14.zip"
SYSIMG_ZIP="${ASSETS_DIR}/x86_64-34.zip"

if [ -f "${SYSIMG_ZIP}" ]; then
    echo "=== System image: already downloaded ($(du -h "${SYSIMG_ZIP}" | cut -f1)) ==="
else
    echo "=== Downloading system image (~1.5 GB)... ==="
    curl -fsSL --retry 3 -o "${SYSIMG_ZIP}" "${SYSIMG_URL}"
    echo "=== Downloaded: $(du -h "${SYSIMG_ZIP}" | cut -f1) ==="
fi
unzip -tq "${SYSIMG_ZIP}" && echo "  ✓ system image zip valid"

echo ""
echo "=== Test assets ready ==="
echo "  ${EMULATOR_ZIP} ($(du -h "${EMULATOR_ZIP}" | cut -f1))"
echo "  ${SYSIMG_ZIP} ($(du -h "${SYSIMG_ZIP}" | cut -f1))"
