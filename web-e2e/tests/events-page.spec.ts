import { expect, test } from '@playwright/test';

/**
 * The event history, as a browser sees it.
 *
 * Why these assertions: this feature exists so a drop is visible in the app
 * instead of only in a rotated log file, so the thing worth proving is that the
 * rendered page actually shows it — the Go suite covers the API and tsc covers
 * types, but neither renders a Lit template. Two kinds of check here: the data
 * reaching the DOM (the entries, newest first), and layout (a new card that
 * lines up with its neighbours — an unclosed <div> nests every block after it,
 * which is invisible everywhere except as layout).
 */

/** Seeded by scripts/ui-test.sh: the p2p tunnel carries three events and the
 *  config a global pair. */
const TUNNEL_ID = 'e2e-p2p-tunnel';
const DETAIL = `/tunnel/p2p/${TUNNEL_ID}`;

/** Newest first, so the drop sits above the connection it followed. */
const NEWEST = 'peer laptop: direct session dropped (2)';
const OLDER = 'peer laptop: connected (direct)';
/** A coalesced run (count 4 in the fixture): its row must show the ×N badge. */
const COALESCED = 'peer phone: punch failed (24)';

/** A sub-pixel difference is layout rounding, not a layout bug. */
const SAME_WIDTH = 0.5;

test('the detail page offers history and hints at the newest entry', async ({ page }) => {
  // The newest entry cannot be hardcoded: this fixture runs a live p2p host, so
  // it records its own events (a peer session coming up, for one) whose
  // timestamps are newer than the ones seeded in the config. Ask the API what
  // the newest one is, then require the page to show exactly that — which is
  // the actual claim, "the hint is the newest event".
  const resp = await page.request.get(`/api/tunnels/${TUNNEL_ID}`);
  const tunnel = await resp.json();
  const newest = tunnel.events?.[0]?.message;
  expect(newest).toBeTruthy();

  await page.goto(DETAIL);

  const entry = page.locator('.card').filter({ hasText: newest });
  await expect(entry).toBeVisible();
  await expect(entry.getByText('History')).toBeVisible();

  // It is a card like its neighbours, so it must line up with them.
  const info = (await page.locator('.section').first().locator('.card').first().boundingBox())!;
  const history = (await entry.boundingBox())!;
  expect(Math.abs(info.width - history.width)).toBeLessThan(SAME_WIDTH);

  await page.screenshot({ path: 'test-results/events-entry.png', fullPage: true });
});

test('the events page lists the object history, newest first', async ({ page }) => {
  await page.goto(`${DETAIL}/events`);

  await expect(page.getByText(NEWEST)).toBeVisible();
  await expect(page.getByText(OLDER)).toBeVisible();

  // The concrete time is text, not a hover tooltip: a touch screen cannot show
  // a `title`. Asserted by shape rather than a literal, because the formatter
  // renders in the browser's local zone.
  await expect(
    page.locator('.row').filter({ hasText: NEWEST }).locator('.time'),
  ).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);

  const drop = (await page.getByText(NEWEST).boundingBox())!;
  const conn = (await page.getByText(OLDER).boundingBox())!;
  expect(drop.y).toBeLessThan(conn.y);

  // The level reaches the row, not just the message: the drop is marked warn.
  // Scoped to the row rather than counted, since a live host is adding events of
  // its own alongside the seeded ones.
  await expect(
    page.locator('.row').filter({ hasText: NEWEST }).locator('.dot.warn'),
  ).toBeVisible();

  // A coalesced run carries its count: the seeded event has count 4, so its row
  // shows ×4 — the count reaching the DOM, not just the API.
  await expect(
    page.locator('.row').filter({ hasText: COALESCED }).locator('.count'),
  ).toHaveText('×4');

  await page.screenshot({ path: 'test-results/events-tunnel.png', fullPage: true });
});

test('the host events page is reachable from settings and can be cleared', async ({ page }) => {
  // Clicked, not goto'd: this link is the only way in from the UI, so asserting
  // the destination alone would leave the entry point uncovered.
  await page.goto('/settings');
  const link = page.locator('.settings-links a').filter({ hasText: 'Host events' });
  await expect(link).toBeVisible();
  await expect(link.locator('svg')).toBeVisible();

  await page.screenshot({ path: 'test-results/settings-links.png', fullPage: true });

  await link.click();
  await page.waitForURL('**/settings/events');

  await expect(page.getByText('relay disconnected: connection refused')).toBeVisible();
  await expect(page.getByText('relay restored')).toBeVisible();
  await expect(
    page
      .locator('.row')
      .filter({ hasText: 'relay disconnected: connection refused' })
      .locator('.dot.error'),
  ).toBeVisible();

  await page.screenshot({ path: 'test-results/events-global.png', fullPage: true });

  // Clear asks first, then drops the history. Asserted on an event only the
  // config can produce ("relay restored" — the fixture's relay is unroutable, so
  // the running host never emits it) rather than on the list becoming empty: a
  // live host keeps recording failures of its own here.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('Clear the host event history?')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).last().click();
  await expect(page.getByText('relay restored')).toBeHidden();
});
