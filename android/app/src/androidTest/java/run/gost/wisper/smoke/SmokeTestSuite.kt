package run.gost.wisper.smoke

import org.junit.runner.RunWith
import org.junit.runners.Suite

/**
 * Smoke suite — fast gate checks (< 90s target).
 *
 * Run via:
 *   ./gradlew connectedDebugAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=run.gost.wisper.smoke.SmokeTestSuite
 */
@RunWith(Suite::class)
@Suite.SuiteClasses(
    ServiceSmokeTest::class,
    NotificationSmokeTest::class,
    WebViewSmokeTest::class
)
class SmokeTestSuite
