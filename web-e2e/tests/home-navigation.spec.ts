import { expect, test } from '@playwright/test';

/**
 * Coming back from a detail page lands on the list you left.
 *
 * Why: the home page's tab started out as component state, and the router
 * discards the component on the way to a detail page — so the tab fell back to
 * its default and an entrypoint's back button dropped you on the tunnel list.
 */

test('coming back from an entrypoint lands on the entrypoint list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrypoints' }).click();
  await expect(page.getByText('Local echo').first()).toBeVisible();

  await page.getByText('Local echo').first().click();
  await expect(page).toHaveURL(/\/entrypoint\/tcp\/e2e-entrypoint$/);

  await page.locator('.back-btn').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('nav-tabs button.active')).toHaveText('Entrypoints');
  await expect(page.getByText('Local echo').first()).toBeVisible();
});

/** Back leaves the editor, not the item: the appbar button used to go to the
 *  list from every mode, dropping you out of the page you were editing. */
test('back from the tunnel editor returns to the tunnel', async ({ page }) => {
  await page.goto('/tunnel/p2p/e2e-p2p-tunnel');
  await page.locator('.btn-edit-bottom').click();
  await expect(page.locator('.form-input').first()).toBeVisible();

  await page.locator('.back-btn').click();
  await expect(page).toHaveURL(/\/tunnel\/p2p\/e2e-p2p-tunnel$/);
  await expect(page.getByText('Allowed peers')).toBeVisible(); // view mode again
});

test('back from the entrypoint editor returns to the entrypoint', async ({ page }) => {
  await page.goto('/entrypoint/tcp/e2e-entrypoint');
  await page.locator('.btn-edit-bottom').click();
  await expect(page.locator('.form-input').first()).toBeVisible();

  await page.locator('.back-btn').click();
  await expect(page).toHaveURL(/\/entrypoint\/tcp\/e2e-entrypoint$/);
});
