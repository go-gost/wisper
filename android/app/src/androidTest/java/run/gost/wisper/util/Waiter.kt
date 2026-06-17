package run.gost.wisper.util

import java.util.concurrent.TimeUnit

/**
 * Polling-based condition waiter. Wraps a lambda check with timeout + interval.
 *
 * Usage:
 *   val w = Waiter(timeoutMs = 10_000)
 *   w.waitUntil { someCondition() }
 */
class Waiter(
    private val timeoutMs: Long = 15_000,
    private val intervalMs: Long = 500
) {
    fun waitUntil(condition: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                if (condition()) return true
            } catch (_: Exception) {
                // Retry on transient errors
            }
            Thread.sleep(intervalMs)
        }
        return false
    }

    /** Sleep for a fixed duration. */
    fun sleep(ms: Long) {
        Thread.sleep(ms)
    }
}
