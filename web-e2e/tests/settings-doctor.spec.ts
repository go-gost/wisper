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

  // No sideways scrolling: the long relay error above wraps instead of widening
  // the box (the vertical bar is the themed one, not Chromium's default).
  expect(await out.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: 'test-results/settings-doctor.png', fullPage: true });

  // The box follows the theme — dark is a class on the root (the app sets no
  // color-scheme, so the browser's own bar is light). The scrollbar's colour
  // comes from a theme variable, so it must differ between the two.
  const scrollbarColor = () =>
    out.evaluate(el => getComputedStyle(el).getPropertyValue('scrollbar-color'));
  const light = await scrollbarColor();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  expect(await scrollbarColor()).not.toBe(light);
  // ...and the UA's own chrome follows it (color-scheme is the app's only switch
  // for the native scrollbars and form controls outside a shadow root).
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await page.screenshot({ path: 'test-results/settings-doctor-dark.png', fullPage: true });
});
