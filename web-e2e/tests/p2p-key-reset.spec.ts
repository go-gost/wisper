import { expect, test } from '@playwright/test';

/**
 * Resetting the p2p identity from the settings page.
 *
 * The fixture (scripts/ui-test.sh) starts a real p2p tunnel whose relay is
 * unreachable on purpose: the shared host still runs and the tunnel still
 * reports "running", which is exactly what the reset must bring back on the new
 * key. Nothing here is mocked — the key file, the host teardown and the
 * restart are the real ones.
 */

test('the settings page rotates the p2p identity and keeps the p2p host running', async ({ page, request }) => {
  const identity = async () => {
    const res = await request.get('/api/p2p');
    expect(res.ok()).toBe(true);
    return (await res.json()) as { public_key: string; running: boolean };
  };

  // The fixture's p2p tunnel starts with the process; wait out that first
  // acquisition instead of racing it.
  await expect.poll(async () => (await identity()).running, { timeout: 10_000 }).toBe(true);
  const before = await identity();
  expect(before.public_key).toMatch(/^[A-Za-z0-9_-]{43}$/);

  await page.goto('/settings');
  const key = page.locator('.identity-key');
  await expect(key).toBeVisible();
  const identityLabel = page.locator('.form-label').filter({ hasText: 'P2P Identity' });
  await identityLabel.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.getByTitle('Reveal').click();
  await expect(key).toHaveText(before.public_key);

  const open = page.getByRole('button', { name: 'Reset key', exact: true });
  await open.click();
  const dialog = page.locator('.dialog-box');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.dialog-title')).toHaveText('Reset P2P identity?');
  await expect(dialog.locator('.dialog-message')).toContainText('restarts');
  await expect(dialog.locator('.dialog-message')).toContainText('allowlist');
  await page.screenshot({ path: 'test-results/p2p-key-reset-dialog.png' });

  // Cancelling is not a reset: the identity must survive a dismissed dialog.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await identity()).public_key).toBe(before.public_key);

  await open.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();

  await expect
    .poll(async () => (await identity()).public_key, { timeout: 15_000 })
    .not.toBe(before.public_key);
  const after = await identity();
  expect(after.public_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(after.public_key).not.toBe(before.public_key);
  // The running p2p tunnel was restarted on the new key, not left down.
  expect(after.running).toBe(true);

  // The page takes the response's key (revealed on success) and closes the
  // dialog; a reload then proves the file — not just the response — holds it.
  await expect(dialog).toBeHidden();
  await expect(key).toHaveText(after.public_key);
  await expect(page.locator('.toast')).toHaveText('New key generated');
  await page.screenshot({ path: 'test-results/p2p-key-reset-done.png' });

  const tunnels = (await (await request.get('/api/tunnels')).json()) as Array<{
    id: string;
    type: string;
    status: string;
  }>;
  const p2p = tunnels.find(t => t.id === 'e2e-p2p-tunnel');
  expect(p2p?.type).toBe('p2p');
  expect(p2p?.status).toBe('running');

  await page.reload();
  await identityLabel.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.getByTitle('Reveal').click();
  await expect(key).toHaveText(after.public_key);

  await page.screenshot({ path: 'test-results/p2p-key-reset.png' });
});
