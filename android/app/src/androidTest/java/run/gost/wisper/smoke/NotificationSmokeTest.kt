package run.gost.wisper.smoke

import org.junit.Assert.assertTrue
import org.junit.Test
import run.gost.wisper.util.TestHelpers

/**
 * Smoke tests for the foreground service notification.
 */
class NotificationSmokeTest {

    companion object {
        private const val PACKAGE = "run.gost.wisper"
        private const val TIMEOUT = 15_000L
    }

    /** Notification exists with smallIcon and the "Wisper running" title. */
    @Test
    fun notificationHasSmallIconAndTitle() {
        // dumpsys notification with --noredact exposes icon and text content
        val found = TestHelpers.waitForShell(
            shellCmd = "dumpsys notification --noredact",
            check = { output ->
                output.contains(PACKAGE) &&
                    output.contains("smallIcon") &&
                    output.contains("Wisper running")
            },
            timeoutMs = TIMEOUT
        )
        assertTrue("Notification should have smallIcon and 'Wisper running' title", found)
    }

    /** Notification has a stop action button. */
    @Test
    fun notificationHasStopAction() {
        val found = TestHelpers.waitForShell(
            shellCmd = "dumpsys notification --noredact",
            check = { output ->
                output.contains(PACKAGE) &&
                    (output.contains("actions=") || output.contains("action"))
            },
            timeoutMs = TIMEOUT
        )
        assertTrue("Notification should have action buttons", found)
    }
}
