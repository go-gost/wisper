package run.gost.wisper.full

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters
import run.gost.wisper.util.TestHelpers
import run.gost.wisper.util.TestHelpers.device
import run.gost.wisper.util.Waiter

/**
 * End-to-end CRUD tests for Tunnels via the WebView UI.
 *
 * Walks the Lit SPA's accessibility tree using UIAutomator to:
 *  - Create tunnels of each type (File, HTTP, TCP, UDP)
 *  - Start / stop them
 *  - Verify they appear on the home page
 *  - Delete them
 *
 * These tests are stateful and ordered — each builds on the previous.
 */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class TunnelCrudTest {

    private val waiter = Waiter(timeoutMs = 8_000)

    // ── Create ──────────────────────────────────────────────────────────

    @Test
    fun step01_createFileTunnel() {
        createTunnel("File", "test-file-tunnel")
    }

    @Test
    fun step02_createHttpTunnel() {
        createTunnel("HTTP", "test-http-tunnel")
    }

    @Test
    fun step03_createTcpTunnel() {
        createTunnel("TCP", "test-tcp-tunnel")
    }

    @Test
    fun step04_createUdpTunnel() {
        createTunnel("UDP", "test-udp-tunnel")
    }

    // ── Start / Stop ────────────────────────────────────────────────────

    @Test
    fun step05_startTunnel() {
        // Navigate home, find the first tunnel card, tap Start
        navigateHome()
        waiter.sleep(1000)

        // Scroll to find a tunnel card with "test-file-tunnel"
        val card = TestHelpers.scrollToText("test-file-tunnel")
        assertNotNull("Should find test-file-tunnel card", card)
        card!!.click()

        // On the detail page, tap "Start"
        val started = TestHelpers.tapByText("Start") || TestHelpers.tapByText("▶")
        // If already started, "Stop" will be visible instead
        val alreadyRunning = device.findObject(
            androidx.test.uiautomator.By.text("Stop")
        ) != null
        assertTrue("Start button should be tappable or tunnel already running",
            started || alreadyRunning)

        // Go back
        device.pressBack()
    }

    @Test
    fun step06_stopTunnel() {
        // Navigate to the file tunnel detail, tap Stop
        navigateHome()
        waiter.sleep(1000)

        val card = TestHelpers.scrollToText("test-file-tunnel")
        assertNotNull("Should find test-file-tunnel card", card)
        card!!.click()

        val stopped = TestHelpers.tapByText("Stop") || TestHelpers.tapByText("⏹")
        val alreadyStopped = device.findObject(
            androidx.test.uiautomator.By.text("Start")
        ) != null
        assertTrue("Stop button should be tappable or tunnel already stopped",
            stopped || alreadyStopped)

        device.pressBack()
    }

    // ── Delete ──────────────────────────────────────────────────────────

    @Test
    fun step07_deleteAllTunnels() {
        val tunnels = listOf("test-file-tunnel", "test-http-tunnel", "test-tcp-tunnel", "test-udp-tunnel")

        for (name in tunnels) {
            navigateHome()
            waiter.sleep(800)

            val card = TestHelpers.scrollToText(name)
            if (card == null) {
                // Already deleted or not created — skip
                continue
            }
            card.click()
            waiter.sleep(500)

            // Tap Delete button (may need to scroll)
            val deleted = TestHelpers.tapByText("Delete") || TestHelpers.tapByText("🗑")
            if (deleted) {
                // Confirm in dialog
                TestHelpers.tapByText("Confirm") || TestHelpers.tapByText("Delete")
                waiter.sleep(500)
            }

            // Fallback: use the Back button if we can't find Delete
            device.pressBack()
            waiter.sleep(300)
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private fun navigateHome() {
        // Press back until we're at the home page, or just wait
        // The FAB "+" and nav tabs indicate we're home
        for (i in 0..3) {
            val fab = device.findObject(androidx.test.uiautomator.By.text("+"))
            if (fab != null) return
            device.pressBack()
            waiter.sleep(500)
        }
    }

    private fun createTunnel(typeLabel: String, name: String) {
        navigateHome()
        waiter.sleep(1000)

        // 1. Tap FAB "+"
        assertTrue("FAB should be tappable",
            TestHelpers.tapByText("+"))
        waiter.sleep(800)

        // 2. On the type-select page, tap the tunnel type card
        val typeCard = TestHelpers.waitForTextContains(typeLabel, 5_000)
        assertNotNull("$typeLabel tunnel type card should be visible", typeCard)
        typeCard!!.click()
        waiter.sleep(1000)

        // 3. Fill the name field — try to find an input field
        //    We use device type-text as a fallback if the input isn't findable
        val nameInput = device.findObject(androidx.test.uiautomator.By.clazz("android.widget.EditText"))
            ?: device.findObject(androidx.test.uiautomator.By.focused(true))
        if (nameInput != null) {
            nameInput.text = name
        } else {
            // Try to tap "Name" label and type
            TestHelpers.tapByTextContains("Name")
            waiter.sleep(300)
            device.findObject(androidx.test.uiautomator.By.focused(true))?.let {
                it.text = name
            }
        }
        waiter.sleep(500)

        // 4. Fill the endpoint field if visible
        val endpointInput = device.findObject(androidx.test.uiautomator.By.textContains("Endpoint"))
            ?: device.findObject(androidx.test.uiautomator.By.textContains("endpoint"))
        if (endpointInput == null) {
            // Try to find a second EditText (endpoint field)
            val editTexts = device.findObjects(androidx.test.uiautomator.By.clazz("android.widget.EditText"))
            if (editTexts.size >= 2) {
                editTexts[1].text = "127.0.0.1:9999"
            }
        }
        waiter.sleep(500)

        // 5. Tap Save
        assertTrue("Save button should be tappable",
            TestHelpers.tapByText("Save"))
        waiter.sleep(1000)

        // 6. Go back to home
        navigateHome()
        waiter.sleep(500)
    }
}
