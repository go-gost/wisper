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

  // The words Status.PeerTransports reports, with the badge text each carries.
  const states = [
    { transport: 'direct', badge: 'direct' },
    { transport: 'derp', badge: 'relay' },
    { transport: 'disabled', badge: 'relay' },
    { transport: 'failed', badge: 'relay' },
    { transport: 'punching', badge: 'punching' },
    { transport: 'no-candidates', badge: 'relay' },
    { transport: 'stun-unreachable', badge: 'relay' },
  ];

  for (const { transport, badge: want } of states) {
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

    const detail = page.locator('.detail-text');
    await expect(detail, `${transport}: detail opens`).toBeVisible();
    await expect(detail, `${transport}: detail says it is connected`).toContainText('Connected');
    await expect(detail, `${transport}: detail is not empty`).not.toHaveText('');

    // The badge and the ⓘ share a line, in every state.
    const b = (await badge.boundingBox())!;
    const i = (await info.boundingBox())!;
    expect(
      Math.abs(b.y + b.height / 2 - (i.y + i.height / 2)),
      `${transport}: ⓘ not centered on the badge`,
    ).toBeLessThan(4);
  }
});
