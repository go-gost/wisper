import { expect, test } from '@playwright/test';

/**
 * The tunnel detail page, as a browser sees it.
 *
 * Why these assertions: the Go suite covers the API and tsc covers types, but
 * neither looks at the rendered page — an unclosed <div> in a Lit template
 * silently nests every block after it, which is invisible to both and shows up
 * only as layout (the peers card came out 32px narrower than the card above
 * it, and the edit button 18px wider than either). Comparing bounding boxes
 * catches that class of bug in one line.
 */

/** Seeded by scripts/ui-test.sh: a running p2p tunnel with two allowlisted
 *  peers, the second one switched off. */
const TUNNEL_ID = 'e2e-p2p-tunnel';
const DETAIL = `/tunnel/p2p/${TUNNEL_ID}`;

/** A sub-pixel difference is layout rounding, not a layout bug. */
const SAME_WIDTH = 0.5;

function peersCard(page: import('@playwright/test').Page) {
  return page.locator('.card').filter({ hasText: 'Allowed peers' });
}

test('the peers card and the edit button line up with the info card', async ({ page }) => {
  await page.goto(DETAIL);
  await expect(page.getByText('Allowed peers')).toBeVisible();

  const info = (await page.locator('.section').first().locator('.card').first().boundingBox())!;
  const peers = (await peersCard(page).boundingBox())!;
  const edit = (await page.locator('.btn-edit-bottom').boundingBox())!;

  expect(Math.abs(info.width - peers.width)).toBeLessThan(SAME_WIDTH);
  expect(Math.abs(info.width - edit.width)).toBeLessThan(SAME_WIDTH);

  // For a human (or an agent) to look at: this is the page the widths above
  // are about.
  await page.screenshot({ path: 'test-results/tunnel-detail.png', fullPage: true });
});

test('the peers card keeps a gap below the stats grid', async ({ page }) => {
  await page.goto(DETAIL);
  const stats = (await page.locator('.stats-grid').boundingBox())!;
  const peers = (await peersCard(page).boundingBox())!;

  expect(peers.y - (stats.y + stats.height)).toBeGreaterThan(8);
});

test('the peers page marks the switched-off peer', async ({ page }) => {
  await page.goto(`${DETAIL}/peers`);
  await expect(page.getByText('laptop')).toBeVisible();
  await expect(page.getByText('phone')).toBeVisible();
  // The disabled one keeps its row and is flagged, rather than disappearing.
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible();

  await page.screenshot({ path: 'test-results/tunnel-peers.png', fullPage: true });
});
