import { defineConfig, devices } from '@playwright/test';

/**
 * UI tests for the embedded Lit app.
 *
 * They run inside the official Playwright image, not on this machine: the dev
 * container has neither a chromium binary nor the system libraries it needs
 * (and no root to install them). See scripts/ui-test.sh. The image tag and the
 * @playwright/test version in package.json are the same version — chromium
 * speaks a versioned protocol, so the two cannot drift apart.
 */
export default defineConfig({
  testDir: './tests',
  // One wisper instance and one fixture serve the whole run: keep it serial.
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,

  use: {
    // The wisper started by scripts/ui-test.sh. dockerd runs in the same
    // container, so a --network=host browser reaches it on 127.0.0.1.
    baseURL: process.env.WISPER_BASE_URL ?? 'http://127.0.0.1:8900',
    screenshot: 'only-on-failure',
    launchOptions: {
      // The container's userns is restricted, so chromium's own sandbox fails
      // to start.
      args: ['--no-sandbox'],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
