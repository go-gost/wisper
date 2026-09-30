import { expect, test } from '@playwright/test';

/**
 * Run diagnostic renders the p2p report.
 *
 * Why: the report is generated in-process (wisper is the only caller that can
 * read the relay's liveness directly), and it is plain text the UI must show —
 * a renamed field, an unwired route or a broken formatter leaves a button that
 * does nothing or a blank box, which no Go test sees. The fixture's relay
 * address is unroutable on purpose, so the report under test is a real one.
 */

test('the settings page renders the p2p diagnostic report', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('.section-title').filter({ hasText: 'Diagnostics' })).toBeVisible();

  const run = page.getByRole('button', { name: 'Run diagnostic' });
  await run.click();

  const out = page.locator('.doctor-output');
  await expect(out).toBeVisible();
  await expect(out).toContainText('p2p doctor');
  await expect(out).toContainText('summary:');
  await expect(out).toContainText('verdicts:');

  // The relay's dial failure lands a moment after start; re-running the report
  // is read-only, so polling with a fresh click is the honest way to wait. The
  // verdict line is the anchor (the header pads its labels, so "relay state:"
  // is followed by several spaces).
  await expect
    .poll(async () => {
      await run.click();
      return out.innerText();
    })
    .toMatch(/relay:\s+UNREACHABLE/);

  await page.screenshot({ path: 'test-results/settings-doctor.png', fullPage: true });
});
