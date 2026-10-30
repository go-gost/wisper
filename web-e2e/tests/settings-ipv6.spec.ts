import { expect, test } from '@playwright/test';

/**
 * The IPv6 direct-path switch is a host-level setting: the page must show the
 * value from the API, save a change, and read the saved value back. A missing
 * field or an unwired save leaves the switch visually toggled but lost on
 * reload, which no Go test sees.
 */
test('the settings page persists the IPv6 direct-path switch', async ({ page }) => {
  await page.goto('/settings');

  const row = page.locator('.switch-row', { hasText: 'IPv6 direct path' });
  await expect(row).toBeVisible();
  const toggle = row.locator('.switch');
  await expect(toggle).not.toHaveClass(/\bon\b/);

  await toggle.click();
  await expect(toggle).toHaveClass(/\bon\b/);

  const p2pCard = page.locator('.card', { hasText: 'IPv6 direct path' });
  await p2pCard.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Saved');

  await page.reload();
  const reloaded = page.locator('.switch-row', { hasText: 'IPv6 direct path' }).locator('.switch');
  await expect(reloaded).toHaveClass(/\bon\b/);

  // Restore the fixture default so a later run (and other specs) start off.
  await reloaded.click();
  await page.locator('.card', { hasText: 'IPv6 direct path' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
});
