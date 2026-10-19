import { expect, test } from '@playwright/test';

/**
 * A hub refusing a spoke's LAN claim must say so where the operator can answer
 * it.
 *
 * Default-deny is deliberate: a spoke with no `lan_allow` row may claim
 * nothing, and it re-asserts every ~20 seconds. The hub records each refusal
 * (the same claim sixteen times in the run's journal) and the detail page
 * showed it only as a passive, duplicated table — no prompt, and nothing on
 * the peers page, which is the one place the answer lives. These assertions
 * cover the prompt on the detail page, the row-level warning and action on the
 * peers page, and the stale prompt going away once the claim is installed.
 */

const DADAX = 'AQ2xKBooUikp1VssCUa9YCl2G9TG755cVwcuKinRhWg';
const HUB_ID = 'e2e-lan-hub';
const HUB = `/tunnel/tun/${HUB_ID}`;

/** A running hub: dadax keeps asserting 192.168.8.0/24 and the hub refuses it
 *  for the same reason every twenty seconds. */
function hub(withClaim: boolean) {
  return {
    id: HUB_ID,
    name: 'Hub',
    type: 'tun',
    endpoint: '',
    entrypoint: '10.10.100.1/24',
    status: 'running',
    favorite: false,
    created_at: '2026-01-15T10:30:00Z',
    error: '',
    options: {
      peers: [{ key: DADAX, alias: 'dadax', ip: '10.10.100.111' }],
      lan_allow: withClaim ? `${DADAX}=192.168.8.0/24` : '',
    },
    stats: {
      current_conns: 1,
      total_conns: 4,
      total_errs: 0,
      request_rate: 0,
      input_bytes: 1024,
      output_bytes: 2048,
      input_rate_bytes: 0,
      output_rate_bytes: 0,
      lan_routed: withClaim ? 1 : 0,
      lan_denied: 16,
      lan_withdrawn: 0,
    },
    lan: {
      routes: withClaim
        ? [{ prefix: '192.168.8.0/24', origin: DADAX, peer: DADAX }]
        : [],
      claims: withClaim ? { [DADAX]: { prefixes: ['192.168.8.0/24'] } } : {},
      rejected: [
        { prefix: '192.168.8.0/24', peer: DADAX, reason: 'no-allow-row', detail: 'the hub has no lan_allow row for it', at: '2026-10-19T03:39:52Z' },
        { prefix: '192.168.8.0/24', peer: DADAX, reason: 'no-allow-row', detail: 'the hub has no lan_allow row for it', at: '2026-10-19T03:39:32Z' },
      ],
    },
    events: [],
  };
}

test('a refused LAN claim is prompted where it can be approved', async ({ page }) => {
  let current = hub(false);
  await page.route('**/api/tunnels', r => r.fulfill({ json: [current] }));
  await page.route('**/api/stats', r => r.fulfill({ json: { tunnels: [current], entrypoints: [] } }));
  await page.route('**/api/p2p/pending', r => r.fulfill({ json: { peers: [] } }));
  await page.route(`**/api/tunnels/${HUB_ID}/peers`, async r => {
    expect(r.request().method()).toBe('PUT');
    // The operator reviewed the staged value: the refused prefix, written into
    // dadax's LAN allow row.
    expect(r.request().postDataJSON()).toMatchObject({
      lan_allow: { [DADAX]: ['192.168.8.0/24'] },
    });
    current = hub(true);
    await r.fulfill({ json: current });
  });

  await page.goto(HUB);
  // The prompt sits under the status banner, naming the peer and the prefix.
  const banner = page.locator('.status-banner.degraded');
  await expect(banner).toContainText('LAN sharing is being refused');
  await expect(banner).toContainText('dadax');
  await expect(banner).toContainText('192.168.8.0/24');

  // The table collapses the same claim asserted every ~20s into one row,
  // rather than filling the journal's whole window with copies.
  const refused = page.locator('.lan-table').filter({ hasText: 'Refused' }).last();
  await expect(refused.locator('.lan-row:not(.head)')).toHaveCount(1);
  await expect(refused).toContainText('×2');
  await page.screenshot({ path: 'test-results/lan-refused-detail.png', fullPage: true });

  // The prompt leads to the page where the policy row is written.
  await banner.click();
  await expect(page).toHaveURL(new RegExp(`/tunnel/tun/${HUB_ID}/peers$`));

  const row = page.locator('peer-stats-row').filter({ hasText: 'dadax' });
  await expect(row.locator('.lan-refused')).toContainText('Shared LAN refused');
  await expect(row.locator('.lan-refused')).toContainText('no-allow-row');
  await page.screenshot({ path: 'test-results/lan-refused-peers.png', fullPage: true });

  // Approving stages the value in the editor; it does not grant access with a
  // single tap. The refused CIDR is prefilled and the operator still saves.
  await row.getByRole('button', { name: 'Fill in LAN…' }).click();
  const lanField = page.getByPlaceholder('e.g. 192.168.1.0/24');
  await expect(lanField).toHaveValue('192.168.8.0/24');

  const request = page.waitForRequest(r =>
    r.url().endsWith(`/api/tunnels/${HUB_ID}/peers`) && r.method() === 'PUT',
  );
  await page.locator('.peer-row.editing').getByTitle('Save').click();
  await request;

  // Once the claim is installed the prompt goes away: the journal still holds
  // the run's refusals, but they are history now, not something to act on.
  await expect(row.locator('.lan-refused')).toHaveCount(0);
});
