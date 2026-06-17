package run.gost.wisper.util

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until

/**
 * Shared helpers for UIAutomator tests.
 */
object TestHelpers {

    val device: UiDevice by lazy {
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    }

    /** Poll-shell until the predicate returns true, up to [timeoutMs]. */
    fun waitForShell(
        shellCmd: String,
        check: (String) -> Boolean,
        timeoutMs: Long = 15_000,
        intervalMs: Long = 500
    ): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val out = device.executeShellCommand(shellCmd)
            if (check(out)) return true
            Thread.sleep(intervalMs)
        }
        return false
    }

    /** Wait for a UI object by text, with timeout. */
    fun waitForText(text: String, timeoutMs: Long = 10_000): UiObject2? {
        return device.wait(Until.findObject(By.text(text)), timeoutMs)
    }

    /** Wait for a UI object by text *containing* substring. */
    fun waitForTextContains(substring: String, timeoutMs: Long = 10_000): UiObject2? {
        return device.wait(Until.findObject(By.textContains(substring)), timeoutMs)
    }

    /** Tap an object found by text. Returns true if tapped. */
    fun tapByText(text: String, timeoutMs: Long = 5_000): Boolean {
        val obj = waitForText(text, timeoutMs) ?: return false
        obj.click()
        return true
    }

    /** Tap an object found by text containing substring. */
    fun tapByTextContains(substring: String, timeoutMs: Long = 5_000): Boolean {
        val obj = waitForTextContains(substring, timeoutMs) ?: return false
        obj.click()
        return true
    }

    /** Check if the device has any "crash" or "stopped" dialogs. */
    fun hasCrashDialog(): Boolean {
        return device.hasObject(By.textContains("crash")) ||
            device.hasObject(By.textContains("has stopped")) ||
            device.hasObject(By.textContains("keeps stopping")) ||
            device.hasObject(By.textContains("isn't responding"))
    }

    /** Scroll until text is visible, then return it. */
    fun scrollToText(text: String, maxSwipes: Int = 10): UiObject2? {
        for (i in 0 until maxSwipes) {
            val obj = device.findObject(By.text(text))
            if (obj != null) return obj
            device.swipe(
                device.displayWidth / 2, device.displayHeight * 3 / 4,
                device.displayWidth / 2, device.displayHeight / 4,
                10
            )
        }
        return null
    }
}
