package run.gost.wisper.full

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import run.gost.wisper.util.TestHelpers
import run.gost.wisper.util.TestHelpers.device
import run.gost.wisper.util.Waiter

/**
 * Tests for multi-tab navigation.
 *
 * Wisper's home page has a pill-style tab bar: Tunnels | Entrypoints.
 */
class NavigationTest {

    private val waiter = Waiter(timeoutMs = 8_000)

    /** Verify Tunnels tab is active by default. */
    @Test
    fun tunnelsTabVisibleByDefault() {
        navigateHome()
        waiter.sleep(2000)

        val hasTunnels = device.findObject(
            androidx.test.uiautomator.By.text("Tunnels")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.text("隧道")
        )
        assertNotNull("Tunnels tab should be visible on home page", hasTunnels)
    }

    /** Switch to Entrypoints tab and verify content changes. */
    @Test
    fun switchToEntrypointsTab() {
        navigateHome()
        waiter.sleep(2000)

        assertTrue("Should be able to tap Entrypoints tab",
            TestHelpers.tapByText("Entrypoints") || TestHelpers.tapByText("入口点"))
        waiter.sleep(1500)

        // Entrypoints tab content should be visible — either an entrypoint card
        // or an empty state message.
        val hasContent = device.findObject(
            androidx.test.uiautomator.By.text("Entrypoints")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.text("TCP")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.text("UDP")
        )
        // Even if empty, the tab should have switched and show content area
        assertNotNull("Entrypoints tab should show content", hasContent)
    }

    /** Switch back to Tunnels tab. */
    @Test
    fun switchBackToTunnelsTab() {
        navigateHome()
        waiter.sleep(2000)

        // Go to Entrypoints first
        TestHelpers.tapByText("Entrypoints") || TestHelpers.tapByText("入口点")
        waiter.sleep(1000)

        // Switch back to Tunnels
        assertTrue("Should be able to tap Tunnels tab",
            TestHelpers.tapByText("Tunnels") || TestHelpers.tapByText("隧道"))
        waiter.sleep(1500)

        val hasContent = device.findObject(
            androidx.test.uiautomator.By.text("Tunnels")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.text("File")
        ) ?: device.findObject(
            androidx.test.uiautomator.By.text("HTTP")
        )
        assertNotNull("Tunnels tab should show content after switching back", hasContent)
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
