import { expect, test } from '@playwright/test';

/**
 * A p2p entrypoint's peer key is required, and the form says so.
 *
 * Both entrypoint kinds dial their hub by key, and the host refuses to start one
 * without it ("p2p entrypoint requires a peer public key"). A tun entrypoint's
 * key sits with its device address and carries the mark; this is the same field
 * on the p2p form, so it carries the same mark and the same save-time refusal.
 */
test('the p2p entrypoint form marks the peer key required', async ({ page }) => {
  await page.goto('/entrypoint/p2p/new');

  const label = page.locator('.form-label').filter({ hasText: 'Peer public key' });
  await expect(label.locator('.required-mark')).toBeVisible();
  await expect(label.locator('.required-mark')).toHaveAttribute('title', 'This field is required');

  await page.locator('input[placeholder="My Entrypoint"]').fill('Exit');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('Peer public key: This field is required');
});
