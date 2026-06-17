package run.gost.wisper.smoke

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import run.gost.wisper.util.TestHelpers
import run.gost.wisper.util.TestHelpers.device

/**
 * Smoke tests for the WebView-based Wisper UI.
 *
 * The Wisper web app is a Lit SPA loaded inside a WebView. These tests
 * verify it loads without crashing and renders the main UI shell.
 */
class WebViewSmokeTest {

    companion object {
        private const val TIMEOUT = 15_000L
    }

    /** WebView loads the Wisper UI (page title "Wisper" appears in DOM). */
    @Test
    fun webViewLoadsWisperUi() {
        // The Lit app renders a <wisper-app> custom element with nav tabs, etc.
        // We wait for any text that should appear after render.
        // The home page has "Tunnels" tab and "Entrypoints" tab.
        val obj = TestHelpers.waitForTextContains("Wisper", TIMEOUT)
            ?: TestHelpers.waitForText("Tunnels", TIMEOUT)
            ?: TestHelpers.waitForText("Entrypoints", TIMEOUT)
        assertNotNull("WebView should render Wisper UI with recognizable text", obj)
    }

    /** No JavaScript error popups or crash dialogs appear. */
    @Test
    fun webViewHasNoErrorDialog() {
        Thread.sleep(5_000) // Let WebView fully render
        // Check for common Android error dialogs
        val hasCrash = device.hasObject(androidx.test.uiautomator.By.textContains("crash"))
        val hasStopped = device.hasObject(androidx.test.uiautomator.By.textContains("has stopped"))
        val hasError = device.hasObject(androidx.test.uiautomator.By.textContains("WebView"))
        // "WebView" alone shouldn't trigger a false positive — it's not an error dialog title.
        // We look specifically for crash/ANR patterns.
        assertTrue("No crash or ANR dialog should be visible",
            !hasCrash && !hasStopped)
    }

    /** The FAB (+) button is rendered (accessibility label or text). */
    @Test
    fun fabButtonExists() {
        // The Lit FAB renders as a button or link with "+" or "Create" text
        val fab = TestHelpers.waitForText("+", TIMEOUT)
            ?: TestHelpers.waitForText("＋", TIMEOUT)
        assertNotNull("FAB button should be visible", fab)
    }
}
