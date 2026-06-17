package run.gost.wisper.smoke

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import run.gost.wisper.util.TestHelpers
import run.gost.wisper.util.TestHelpers.device

/**
 * Smoke tests for foreground service and Go backend health.
 *
 * These are the P0 gate: if any of these fail, the APK is fundamentally
 * broken (service won't start, backend won't listen, notification missing).
 */
class ServiceSmokeTest {

    companion object {
        private const val PACKAGE = "run.gost.wisper"
        private const val TIMEOUT = 20_000L
    }

    /** 1. WisperService is registered with foreground status. */
    @Test
    fun serviceIsForeground() {
        val started = TestHelpers.waitForShell(
            shellCmd = "dumpsys activity services ${PACKAGE}",
            check = { it.contains("isForeground=true") },
            timeoutMs = TIMEOUT
        )
        assertTrue("WisperService should be in foreground state", started)
    }

    /** 2. Go backend listens on port 8900. */
    @Test
    fun backendPortListens() {
        // /proc/net/tcp contains hex-formatted addresses.
        // 0100007F:22C2 is 127.0.0.1:8900 (0x22C2 = 8900)
        val listening = TestHelpers.waitForShell(
            shellCmd = "cat /proc/net/tcp",
            check = { it.contains("0100007F:22C2") || it.contains("00000000:22C2") },
            timeoutMs = TIMEOUT
        )
        assertTrue("Go backend should listen on port 8900", listening)
    }

    /** 3. No crash/ANR dialog is visible. */
    @Test
    fun noCrashDialog() {
        // Give WebView a moment to render, then check
        Thread.sleep(3_000)
        assertFalse("No crash dialog should be visible", TestHelpers.hasCrashDialog())
    }
}
