import { expect, test } from '@playwright/test';

/**
 * The transport badge's ⓘ.
 *
 * A phone has no hover, so the badge's own tooltip is unreachable there: a grey
 * "relay" read as "not connected" rather than "connected, on the relay". The
 * reason therefore has to be tappable — and it has to survive the page's poll,
 * which repopulates the form (and once closed the detail on every tick).
 *
 * The peer key is the fixture's own, and its transport is injected: reaching a
 * real relay is not what this page's rendering is about.
 */
test('the transport badge carries a tappable detail that outlives a poll', async ({ page }) => {
  const ep = {
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
      peer: 'dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA',
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
    peer_transport: 'disabled',
    events: [],
  };
  await page.route('**/api/entrypoints', r => r.fulfill({ json: [ep] }));
  await page.route('**/api/entrypoints/e2e-transport', r => r.fulfill({ json: ep }));

  await page.goto('/entrypoint/tun/e2e-transport');

  const badge = page.locator('.peer-badge').first();
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('relay');

  // The ⓘ sits on the badge's own line, centered with it.
  const info = page.locator('.detail-btn').first();
  await expect(info).toBeVisible();
  const b = (await badge.boundingBox())!;
  const i = (await info.boundingBox())!;
  expect(Math.abs(b.y + b.height / 2 - (i.y + i.height / 2))).toBeLessThan(4);

  // Tapping reveals the detail: that the link is up first, then why it is not
  // direct. Closed until then — the tap is the only way to it on a phone.
  await expect(page.locator('.detail-text')).toHaveCount(0);
  await info.click();
  const detail = page.locator('.detail-text');
  await expect(detail).toBeVisible();
  // disabled is a connected peer on the relay, so "Connected" is the right lead.
  await expect(detail).toContainText('Connected');

  // A poll tick repopulates the form; it must not close the detail.
  await page.waitForTimeout(3500);
  await expect(detail).toBeVisible();

  await page.screenshot({ path: 'test-results/entrypoint-transport-detail.png', fullPage: true });
});

/**
 * Every transport state carries the same tappable detail, not just the grey
 * one: the badge word is the same shape everywhere, and a state that explains
 * itself only when it is a problem is a state that reads as a problem.
 *
 * "direct" is included deliberately — it has no reason word (why is it on a
 * direct path? because it is), so this is what keeps a future state from
 * dropping the ⓘ and getting an unexplained badge again.
 */
test('every transport state carries a tappable detail', async ({ page }) => {
  const base = {
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
      peer: 'dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA',
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
    events: [],
  };

  // The words Status.PeerTransports reports, with the badge text each carries
  // and the word its detail leads with. The lead word is asserted exactly
  // because it used to be a blanket "Connected" — which the raw i18n key
  // p2pTransportConnected satisfies by substring, so a missing translation
  // passed. These strings exist in the locale, so an untranslated key cannot.
  const states = [
    { transport: 'direct', badge: 'direct', lead: 'Connected' },
    { transport: 'derp', badge: 'relay', lead: 'Connected' },
    { transport: 'disabled', badge: 'relay', lead: 'Connected' },
    { transport: 'peer-direct-off', badge: 'relay', lead: 'Connected' },
    { transport: 'failed', badge: 'relay', lead: 'Connected' },
    { transport: 'punching', badge: 'punching', lead: 'Connected' },
    { transport: 'no-candidates', badge: 'relay', lead: 'Connected' },
    { transport: 'stun-unreachable', badge: 'relay', lead: 'Connected' },
    // The API's own words for a peer with no session: it used to arrive as
    // "server-unreachable" alone, which claimed the hub was down for the whole
    // first connection. Neither of these has a connection to call Connected.
    { transport: 'connecting', badge: 'connecting', lead: 'connecting' },
    { transport: 'server-unreachable', badge: 'unreachable', lead: 'unreachable' },
  ];

  for (const { transport, badge: want, lead } of states) {
    const ep = { ...base, peer_transport: transport };
    await page.route('**/api/entrypoints', r => r.fulfill({ json: [ep] }));
    await page.route('**/api/entrypoints/e2e-transport', r => r.fulfill({ json: ep }));

    await page.goto('/entrypoint/tun/e2e-transport');

    const badge = page.locator('.peer-badge').first();
    await expect(badge, `${transport}: badge`).toBeVisible();
    await expect(badge, `${transport}: badge text`).toContainText(want);

    const info = page.locator('.detail-btn').first();
    await expect(info, `${transport}: ⓘ`).toBeVisible();
    await info.click();

    const detail = page.locator('.detail-text').first();
    await expect(detail, `${transport}: detail opens`).toBeVisible();
    // Exact lead word, so an untranslated key (which renders as the literal
    // "p2pTransportConnected") cannot pass.
    await expect(detail, `${transport}: detail lead word`).toContainText(lead);
    const text = (await detail.textContent()) ?? '';
    expect(text, `${transport}: detail leaks a raw i18n key`).not.toMatch(/p2pTransport/);

    // The badge and the ⓘ share a line, in every state.
    const b = (await badge.boundingBox())!;
    const i = (await info.boundingBox())!;
    expect(
      Math.abs(b.y + b.height / 2 - (i.y + i.height / 2)),
      `${transport}: ⓘ not centered on the badge`,
    ).toBeLessThan(4);
  }
});

/**
 * A stopped endpoint draws no transport row, and a "connecting" peer does not
 * raise the unreachable banner.
 *
 * Two leftovers of the same bug: the shared p2p host outlives an entrypoint's
 * Close by its teardown grace, so the API used to keep reporting the path the
 * last run ended on — a stopped tun entrypoint sat under a "stopped" banner
 * still labelled "direct". And the banner's condition treated any missing word
 * as an outage, so an ordinary first connection read "Server (hub) is
 * unreachable" until the session came up.
 */
test('a stopped entrypoint has no transport row and only an unreachable relay raises the banner', async ({ page }) => {
  const base = {
    id: 'e2e-transport-status',
    name: 'tun',
    type: 'tun',
    endpoint: '127.0.0.1:9',
    entrypoint: '10.10.100.250/24',
    favorite: false,
    created_at: '2026-01-15T10:30:00Z',
    error: '',
    options: {
      keepalive: true,
      peer: 'dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA',
      net: '10.10.100.250/24',
    },
    stats: {
      current_conns: 0,
      total_conns: 79,
      total_errs: 0,
      request_rate: 0,
      input_bytes: 0,
      output_bytes: 0,
      input_rate_bytes: 0,
      output_rate_bytes: 0,
    },
    events: [],
  };

  // Each state is served (and the page loaded) fresh: the page's own poll
  // re-reads /api/entrypoints on a timer, so a state left in place would be
  // replaced mid-assertion by whichever fixture was routed last.
  const serve = async (ep: Record<string, unknown>) => {
    await page.route('**/api/entrypoints', r => r.fulfill({ json: [ep] }));
    await page.route('**/api/entrypoints/e2e-transport-status', r => r.fulfill({ json: ep }));
    await page.goto('/entrypoint/tun/e2e-transport-status');
  };

  // Stopped: no badge, even though the API's last word was "direct".
  await serve({ ...base, status: 'stopped', peer_transport: 'direct' });
  await expect(page.locator('.status-banner').first()).toContainText('Stopped');
  await expect(page.locator('.peer-badge')).toHaveCount(0);

  // Running and still connecting: the badge is drawn, the banner is not.
  await serve({ ...base, status: 'running', peer_transport: 'connecting' });
  await expect(page.locator('.peer-badge').first()).toContainText('connecting');
  await expect(page.getByText('Server (hub) is unreachable')).toHaveCount(0);

  // Running with the relay genuinely down: the banner is the point of the word.
  await serve({ ...base, status: 'running', peer_transport: 'server-unreachable' });
  await expect(page.getByText('Server (hub) is unreachable')).toBeVisible();

  await page.screenshot({ path: 'test-results/entrypoint-transport-status.png', fullPage: true });
});
