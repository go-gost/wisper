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
 * End-to-end CRUD tests for Entrypoints via the WebView UI.
 */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class EntrypointCrudTest {

    private val waiter = Waiter(timeoutMs = 8_000)

    @Test
    fun step01_createTcpEntrypoint() {
        createEntrypoint("TCP", "test-tcp-entry")
    }

    @Test
    fun step02_createUdpEntrypoint() {
        createEntrypoint("UDP", "test-udp-entry")
    }

    @Test
    fun step03_startStopEntrypoint() {
        navigateHome()
        // Switch to Entrypoints tab
        switchToEntrypointsTab()
        waiter.sleep(1000)

        val card = TestHelpers.scrollToText("test-tcp-entry")
        assertNotNull("Should find test-tcp-entry card", card)
        card!!.click()
        waiter.sleep(800)

        // Try Start
        val didAction = TestHelpers.tapByText("Start") || TestHelpers.tapByText("Stop")
        assertTrue("Should be able to toggle entrypoint state", didAction)

        device.pressBack()
    }

    @Test
    fun step04_deleteAllEntrypoints() {
        val entrypoints = listOf("test-tcp-entry", "test-udp-entry")

        for (name in entrypoints) {
            navigateHome()
            switchToEntrypointsTab()
            waiter.sleep(800)

            val card = TestHelpers.scrollToText(name)
            if (card == null) continue
            card.click()
            waiter.sleep(500)

            TestHelpers.tapByText("Delete") || TestHelpers.tapByText("🗑")
            if (TestHelpers.tapByText("Confirm") || TestHelpers.tapByText("Delete")) {
                waiter.sleep(500)
            }

            device.pressBack()
            waiter.sleep(300)
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private fun navigateHome() {
        for (i in 0..3) {
            val fab = device.findObject(androidx.test.uiautomator.By.text("+"))
            if (fab != null) return
            device.pressBack()
            waiter.sleep(500)
        }
    }

    private fun switchToEntrypointsTab() {
        TestHelpers.tapByText("Entrypoints") || TestHelpers.tapByText("入口点")
        waiter.sleep(800)
    }

    private fun createEntrypoint(typeLabel: String, name: String) {
        navigateHome()
        switchToEntrypointsTab()
        waiter.sleep(800)

        // 1. Tap FAB "+"
        assertTrue("FAB should be tappable",
            TestHelpers.tapByText("+"))
        waiter.sleep(800)

        // 2. Tap the entrypoint type card
        val typeCard = TestHelpers.waitForTextContains(typeLabel, 5_000)
        assertNotNull("$typeLabel entrypoint type card should be visible", typeCard)
        typeCard!!.click()
        waiter.sleep(1000)

        // 3. Fill name
        val nameInput = device.findObject(androidx.test.uiautomator.By.clazz("android.widget.EditText"))
            ?: device.findObject(androidx.test.uiautomator.By.focused(true))
        if (nameInput != null) {
            nameInput.text = name
        }
        waiter.sleep(500)

        // 4. Fill public URL
        val editTexts = device.findObjects(androidx.test.uiautomator.By.clazz("android.widget.EditText"))
        if (editTexts.size >= 2) {
            editTexts[1].text = "https://example.gost.run"
        }
        waiter.sleep(500)

        // 5. Save
        assertTrue("Save button should be tappable",
            TestHelpers.tapByText("Save"))
        waiter.sleep(1000)

        navigateHome()
    }
}
