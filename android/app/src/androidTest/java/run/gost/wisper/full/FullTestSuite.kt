package run.gost.wisper.full

import org.junit.runner.RunWith
import org.junit.runners.Suite

/**
 * Full test suite — comprehensive functional tests (target < 5 min).
 *
 * Run via:
 *   ./gradlew connectedDebugAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=run.gost.wisper.full.FullTestSuite
 */
@RunWith(Suite::class)
@Suite.SuiteClasses(
    TunnelCrudTest::class,
    EntrypointCrudTest::class,
    SettingsTest::class,
    NavigationTest::class
)
class FullTestSuite
