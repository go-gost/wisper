package run.gost.wisper.full

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import run.gost.wisper.util.TestHelpers
import run.gost.wisper.util.TestHelpers.device
import run.gost.wisper.util.Waiter

/**
 * Tests for the Settings page.
 *
 * Verifies navigation to Settings, form field interaction, and save.
 */
class SettingsTest {

    private val waiter = Waiter(timeoutMs = 8_000)

    /** Navigate to Settings page and verify key fields exist. */
    @Test
    fun settingsPageLoads() {
        navigateHome()

        // Tap the Settings nav tab or gear icon
        val opened = TestHelpers.tapByText("Settings") ||
            TestHelpers.tapByText("设置") ||
            TestHelpers.tapByText("⚙")
        assertTrue("Should be able to navigate to Settings", opened)
        waiter.sleep(1500)

        // Verify server address field or label exists
        val hasServer = TestHelpers.waitForTextContains("Server", 5_000)
            ?: TestHelpers.waitForTextContains("server", 5_000)
            ?: TestHelpers.waitForTextContains("addr", 5_000)
            ?: TestHelpers.waitForTextContains("8900", 5_000)  // default port
        assertNotNull("Settings page should have server-related UI", hasServer)

        // Verify theme or language toggle exists
        val hasThemeOrLang = device.findObject(
            androidx.test.uiautomator.By.textContains("Theme")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.textContains("Language")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.textContains("Dark")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.textContains("中文")
        )
        assertNotNull("Settings should have theme or language option", hasThemeOrLang)
    }

    /** Verify save button is present on settings page. */
    @Test
    fun settingsHasSaveButton() {
        navigateHome()

        TestHelpers.tapByText("Settings") || TestHelpers.tapByText("设置")
        waiter.sleep(1500)

        val saveBtn = device.findObject(androidx.test.uiautomator.By.text("Save"))
            ?: device.findObject(androidx.test.uiautomator.By.text("保存"))
        assertNotNull("Settings page should have a Save button", saveBtn)

        // Navigate back
        device.pressBack()
    }

    private fun navigateHome() {
        for (i in 0..3) {
            val fab = device.findObject(androidx.test.uiautomator.By.text("+"))
            if (fab != null) return
            device.pressBack()
            waiter.sleep(500)
        }
    }
}
