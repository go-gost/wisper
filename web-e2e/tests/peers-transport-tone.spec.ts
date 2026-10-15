import { expect, test } from '@playwright/test';

/**
 * A relay badge must say *which* relay.
 *
 * A peer that is on the relay reads grey either way — plain derp fallback, or
 * the peer itself turning the direct path off — and an operator cannot tell
 * them apart. The peer list is where that matters: one hub serves several
 * spokes, and "why is this spoke never direct?" is the first question about
 * it. The reason used to live only in the tooltip, which a phone has no way
 * to reach, so the state gets a colour of its own.
 *
 * These assertions compare computed colours, not class names: a state that
 * draws the same grey as its neighbour fails here whatever the CSS calls it.
 */

/** Seeded by scripts/ui-test.sh: a running p2p tunnel with two allowlisted
 *  peers, the second one switched off (so its row keeps the base grey badge). */
const TUNNEL_ID = 'e2e-p2p-tunnel';
const PEERS = `/tunnel/p2p/${TUNNEL_ID}/peers`;
const LAPTOP = 'dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA';

/** The entrypoint fixture's own shape, minus what the transport assertions
 *  read: peer_transport is injected per state, as the detail spec does. */
function entrypoint(transport: string) {
  return {
    id: 'e2e-transport',
    name: 'tun',
    type: 'tun',
    endpoint: '127.0.0.1:9',
    entrypoint: 'hub.example:8421',
    status: 'running',
    favorite: false,
    created_at: '2026-01-15T10:30:00Z',
    error: '',
    options: {
      keepalive: true,
      ttl: 15,
      peer: LAPTOP,
      net: '10.10.100.250/24',
    },
    stats: {
      current_conns: 1,
      total_conns: 79,
      total_errs: 0,
      request_rate: 0,
      input_bytes: 54_200_000,
      output_bytes: 3_800_000,
      input_rate_bytes: 0,
      output_rate_bytes: 0,
    },
    peer_transport: transport,
    events: [],
  };
}

function badgeColor(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).first().evaluate(el => getComputedStyle(el).color);
}

/** On the entrypoint's detail page, "the peer turned direct off" must not
 *  draw the same grey as a plain relay fallback: both say "relay", and both
 *  explain themselves on a tap, but the colours answer "which relay" before
 *  the tap. */
test('the entrypoint badge colours peer-direct-off apart from derp', async ({ page }) => {
  const colors: Record<string, string> = {};
  for (const transport of ['derp', 'peer-direct-off']) {
    const ep = entrypoint(transport);
    await page.route('**/api/entrypoints', r => r.fulfill({ json: [ep] }));
    await page.route('**/api/entrypoints/e2e-transport', r => r.fulfill({ json: ep }));
    await page.goto('/entrypoint/tun/e2e-transport');
    const badge = page.locator('.peer-badge').first();
    await expect(badge, `${transport}: badge`).toBeVisible();
    await expect(badge, `${transport}: says relay`).toContainText('relay');
    colors[transport] = await badgeColor(page, '.peer-badge');
    // The distinction is colour alone: the tappable detail must still be there,
    // and still say the connection is fine before it says why it is not direct.
    const info = page.locator('.detail-btn').first();
    await expect(info, `${transport}: ⓘ`).toBeVisible();
    await info.click();
    const detail = page.locator('.detail-text');
    await expect(detail, `${transport}: detail opens`).toBeVisible();
    await expect(detail, `${transport}: detail says connected`).toContainText('Connected');
  }

  expect(
    colors['peer-direct-off'],
    'peer-direct-off draws the same grey as a plain derp fallback',
  ).not.toBe(colors['derp']);
});

/** On the hub's peers page, where several spokes are listed side by side: a
 *  spoke whose direct path is off must not read like one that simply fell
 *  back to the relay. The switched-off peer's row keeps the base grey badge
 *  (a disabled row draws no transport), so it is the in-page reference for
 *  what "plain grey" looks like. */
test('the peers page colours a spoke with direct off apart from a plain relay row', async ({ page }) => {
  const stats = {
    tunnels: [
      {
        id: TUNNEL_ID,
        entrypoint: '127.0.0.1:9',
        status: 'running',
        error: '',
        peer_stats: [
          {
            key: LAPTOP,
            alias: 'laptop',
            transport: 'peer-direct-off',
            state: 'none',
            caps: ['no-direct'],
            kcp_live: true,
            current_conns: 1,
            input_bytes: 1_000,
            output_bytes: 2_000,
          },
        ],
      },
    ],
    entrypoints: [],
  };
  await page.route('**/api/stats', r => r.fulfill({ json: stats }));

  await page.goto(PEERS);
  await expect(page.getByText('laptop')).toBeVisible();

  const row = page.locator('.peer-row').filter({ hasText: 'laptop' });
  const badge = row.locator('.peer-badge').first();
  await expect(badge, 'the badge is drawn').toBeVisible();
  await expect(badge, 'it still says relay').toContainText('relay');

  // The disabled peer's row is the plain-grey reference on the same page.
  const grey = page
    .locator('.peer-row')
    .filter({ hasText: 'phone' })
    .locator('.peer-badge')
    .first();
  await expect(grey, 'the disabled row draws its own badge').toBeVisible();

  const spokeColor = await badge.evaluate(el => getComputedStyle(el).color);
  const greyColor = await grey.evaluate(el => getComputedStyle(el).color);
  expect(
    spokeColor,
    'a spoke with the direct path off reads the same grey as a row with no transport at all',
  ).not.toBe(greyColor);

  await page.screenshot({ path: 'test-results/peers-transport-tone.png', fullPage: true });
});
