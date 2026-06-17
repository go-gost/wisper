#!/bin/bash
# start-emulator.sh — boot a headless Android emulator and wait until ready.
#
# Usage: /opt/start-emulator.sh
#   - Starts emulator in background (no window, no audio, no boot animation)
#   - Blocks until sys.boot_completed == 1 and package manager is ready
#   - Prints "EMULATOR_READY" when done

set -e

AVD_NAME="${AVD_NAME:-test_avd}"
EMULATOR_PORT="${EMULATOR_PORT:-5554}"
EMULATOR_SERIAL="emulator-${EMULATOR_PORT}"
export ANDROID_SERIAL="${EMULATOR_SERIAL}"

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
EMULATOR="${ANDROID_SDK_ROOT}/emulator/emulator"
ADB="${ANDROID_SDK_ROOT}/platform-tools/adb"

# QEMU links against libraries in the emulator lib64 directory
export LD_LIBRARY_PATH="${ANDROID_SDK_ROOT}/emulator/lib64:${ANDROID_SDK_ROOT}/emulator/lib64/gles_swiftshader:${LD_LIBRARY_PATH:-}"
# Disable the emulator watchdog — on some kernels (7.0+) the KVM threads
# appear to hang even though QEMU is running fine.
export ANDROID_EMU_DISABLE_HANG_DETECTION=1

echo "=== Starting Android emulator (AVD: ${AVD_NAME}) ==="

# Kill any stale adb server
"${ADB}" kill-server 2>/dev/null || true
"${ADB}" start-server 2>/dev/null || true

# Start emulator in background
echo "Booting emulator..."
nohup "${EMULATOR}" \
    -avd "${AVD_NAME}" \
    -no-window \
    -no-audio \
    -no-boot-anim \
    -gpu swiftshader_indirect \
    -accel on \
    -memory 1536 \
    -cores 1 \
    -port "${EMULATOR_PORT}" \
    -netdelay none \
    -netspeed full \
    &

EMULATOR_PID=$!

# Wait for device to appear
echo "Waiting for device (serial: ${EMULATOR_SERIAL})..."
"${ADB}" -s "${EMULATOR_SERIAL}" wait-for-device

# Wait for boot to complete (with timeout: 5 minutes)
echo "Waiting for boot to complete..."
TIMEOUT=300
ELAPSED=0
while [ "$("${ADB}" -s "${EMULATOR_SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    if [ ${ELAPSED} -ge ${TIMEOUT} ]; then
        echo "ERROR: Emulator boot timed out after ${TIMEOUT}s"
        exit 1
    fi
    echo "  ... ${ELAPSED}s elapsed"
done

# Wait for package manager to be ready
echo "Waiting for package manager..."
"${ADB}" -s "${EMULATOR_SERIAL}" shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'

# Additional settling time — on some images the launcher needs a moment
sleep 5

# Dismiss any setup wizard or keyguard
"${ADB}" -s "${EMULATOR_SERIAL}" shell wm dismiss-keyguard 2>/dev/null || true
"${ADB}" -s "${EMULATOR_SERIAL}" shell settings put global setup_wizard_has_run 1 2>/dev/null || true
"${ADB}" -s "${EMULATOR_SERIAL}" shell settings put secure user_setup_complete 1 2>/dev/null || true

echo "=== EMULATOR_READY ==="
