import { expect, test } from '@playwright/test';

/**
 * A tun entrypoint's create form.
 *
 * Why the order matters: the leading hints are what a reader has to know before
 * choosing anything — that the device needs administrator rights (the one thing
 * on this form that makes the save fail), what it joins, and what keepalive
 * does. They belong above the fields they explain, not under the last one.
 */
test('the tun entrypoint form explains itself before its fields', async ({ page }) => {
  await page.goto('/entrypoint/tun/new');

  // The privilege caveat leads: it is the one thing on this form that can make
  // the save fail.
  const lead = page.locator('.p2p-hint').first();
  await expect(lead).toBeVisible();
  await expect(lead).toContainText('administrator rights');

  const intro = page.locator('.p2p-hint').filter({ hasText: "hub's network" });
  await expect(intro).toBeVisible();

  const deviceAddress = page.locator('input[placeholder="10.10.0.2/24"]');
  await expect(deviceAddress).toBeVisible();

  const fieldBox = (await deviceAddress.boundingBox())!;
  expect((await lead.boundingBox())!.y).toBeLessThan(fieldBox.y);
  expect((await intro.boundingBox())!.y).toBeLessThan(fieldBox.y);

  // The page carries its own per-field hints too: the leading block is what
  // moved, not every hint on the page.
  expect(await page.locator('.p2p-hint').count()).toBeGreaterThan(1);

  await page.screenshot({ path: 'test-results/tun-entrypoint-new.png', fullPage: true });
});
