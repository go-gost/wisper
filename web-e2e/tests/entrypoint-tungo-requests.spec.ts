import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ID = 'e2e-tungo-requests';
const DETAIL = `/entrypoint/tungo/${ID}`;

const REQUESTS = [
  {
    time: '2026-11-26T12:00:03Z',
    host: 'api.example.com',
    dst: '198.51.100.10:443',
    network: 'tcp',
    proto: 'http',
    tunneled: true,
    input_bytes: 1024,
    output_bytes: 2048,
    duration_ms: 12,
    err: '',
    path: [
      { chain: 'hub', hop: 0, node: 'home', addr: '127.0.0.1:8421', connect_ms: 12, err: '' },
    ],
  },
  {
    time: '2026-11-26T12:00:02Z',
    host: '',
    dst: '192.0.2.20:80',
    network: 'tcp',
    proto: 'http',
    tunneled: false,
    input_bytes: 512,
    output_bytes: 256,
    duration_ms: 4,
    err: '',
  },
  {
    time: '2026-11-26T12:00:01Z',
    host: '',
    dst: '198.51.100.53:5353',
    network: 'udp',
    proto: 'dns',
    tunneled: true,
    input_bytes: 64,
    output_bytes: 128,
    duration_ms: 0,
    err: 'lookup failed',
  },
];

function entrypoint(rules = ['192.0.2.20']) {
  return {
    id: ID,
    name: 'Split requests',
    type: 'tungo',
    endpoint: '',
    entrypoint: '10.10.100.250/32',
    status: 'stopped',
    favorite: false,
    created_at: '2026-01-15T10:30:00Z',
    error: '',
    options: {
      keepalive: true,
      ttl: 15,
      peer: 'dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA',
      net: '10.10.100.250/32',
      rules,
    },
    stats: {
      current_conns: 0,
      total_conns: 0,
      total_errs: 0,
      request_rate: 0,
      input_bytes: 0,
      output_bytes: 0,
      input_rate_bytes: 0,
      output_rate_bytes: 0,
    },
    events: [],
  };
}

async function mockEntrypoint(
  page: Page,
  options: {
    rules?: string[];
    requests?: typeof REQUESTS;
    failRequestsAfterFirst?: boolean;
    ruleStatus?: number;
  } = {},
) {
  let current = entrypoint(options.rules);
  let requestCalls = 0;
  const ruleBodies: string[][] = [];

  await page.route('**/api/entrypoints', route => route.fulfill({ json: [current] }));
  await page.route(`**/api/entrypoints/${ID}`, route => route.fulfill({ json: current }));
  await page.route(new RegExp(`/api/entrypoints/${ID}/requests(?:\\?.*)?$`), route => {
    requestCalls += 1;
    if (options.failRequestsAfterFirst && requestCalls > 1) {
      return route.fulfill({ status: 500, json: { error: 'requests unavailable' } });
    }
    return route.fulfill({ json: { requests: options.requests ?? REQUESTS } });
  });
  await page.route(`**/api/entrypoints/${ID}/rules`, route => {
    expect(route.request().method()).toBe('PUT');
    const body = route.request().postDataJSON() as { rules: string[] };
    ruleBodies.push(body.rules);
    if (options.ruleStatus) {
      return route.fulfill({ status: options.ruleStatus, json: { error: 'rule rejected' } });
    }
    current = entrypoint(body.rules);
    return route.fulfill({ json: current });
  });

  return {
    requestCalls: () => requestCalls,
    ruleBodies: () => ruleBodies,
  };
}

test('renders newest-first tunnel and direct flows and polls on the two-second tick', async ({ page }) => {
  // Playwright's clock makes the polling assertion deterministic: runFor(2000)
  // advances exactly one refresh interval instead of racing a wall-clock timeout.
  const now = new Date('2026-11-26T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const mock = await mockEntrypoint(page);
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.requests-count')).toHaveText('3 requests');
  const rows = card.locator('.request-row');
  await expect(rows).toHaveCount(3);

  const tunneled = rows.nth(0);
  await expect(tunneled).toContainText('api.example.com');
  await expect(tunneled).toContainText(':443');
  await expect(tunneled).not.toContainText('198.51.100.10');
  await expect(tunneled.locator('.route-badge')).toHaveText('Tunnel');
  await expect(tunneled).toContainText('tcp/http');
  await expect(tunneled).toContainText('1.00 KB');
  await expect(tunneled).toContainText('2.00 KB');
  await expect(tunneled).toContainText('12.00ms');
  await expect(tunneled.locator('time')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

  const direct = rows.nth(1);
  await expect(direct).toContainText('192.0.2.20:80');
  await expect(direct.locator('.route-badge')).toHaveText('Direct');

  const udp = rows.nth(2);
  await expect(udp).toContainText('198.51.100.53:5353');
  await expect(udp).toContainText('udp/dns');
  await expect(udp.locator('.route-badge')).toHaveText('Tunnel');
  await expect(udp.locator('.request-error')).toContainText('lookup failed');

  await expect.poll(() => mock.requestCalls()).toBe(1);
  await page.clock.runFor(2000);
  await expect.poll(() => mock.requestCalls()).toBe(2);
});

test('adds a host to the rules and removes an already listed destination', async ({ page }) => {
  const mock = await mockEntrypoint(page);
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  const rows = card.locator('.request-row');
  const addRow = rows.filter({ hasText: 'api.example.com' });
  await expect(addRow.getByRole('button', { name: /Add to rules/ })).toBeVisible();
  await addRow.getByRole('button', { name: /Add to rules/ }).click();
  await expect.poll(() => mock.ruleBodies().length).toBe(1);
  expect(mock.ruleBodies()[0]).toEqual(['192.0.2.20', 'api.example.com']);
  await expect(addRow.getByRole('button', { name: /Remove from rule/ })).toBeVisible();
  await expect.poll(() => mock.requestCalls()).toBeGreaterThanOrEqual(2);

  const removeRow = rows.filter({ hasText: '192.0.2.20:80' });
  await expect(removeRow.getByRole('button', { name: /Remove from rule/ })).toBeVisible();
  await removeRow.getByRole('button', { name: /Remove from rule/ }).click();
  await expect.poll(() => mock.ruleBodies().length).toBe(2);
  expect(mock.ruleBodies()[1]).toEqual(['api.example.com']);
  await expect(removeRow.getByRole('button', { name: /Add to rules/ })).toBeVisible();
});

test('turning auto refresh off stops the timer while manual refresh still works', async ({ page }) => {
  const now = new Date('2026-11-26T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const mock = await mockEntrypoint(page);
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  await expect(card.locator('.request-row')).toHaveCount(3);
  const auto = card.getByRole('button', { name: 'Auto', exact: true });
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await page.clock.runFor(5000);
  expect(mock.requestCalls()).toBe(1);

  await card.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => mock.requestCalls()).toBe(2);
  await expect(card.locator('.request-row')).toHaveCount(3);
});

test('collapsing the card pauses polling and says why', async ({ page }) => {
  const now = new Date('2026-11-26T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const mock = await mockEntrypoint(page);
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  await expect(card.locator('.request-row')).toHaveCount(3);
  await card.getByRole('button', { name: 'Collapse recent requests' }).click();
  await expect(card.locator('.request-row')).toHaveCount(0);
  await expect(card.locator('.pause-indicator')).toHaveText('Paused while collapsed');
  await page.clock.runFor(6000);
  expect(mock.requestCalls()).toBe(1);
});

test('a failed refresh keeps the last rows and shows an inline error', async ({ page }) => {
  const mock = await mockEntrypoint(page, { failRequestsAfterFirst: true });
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  await expect(card.locator('.request-row')).toHaveCount(3);
  await card.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(card.locator('.requests-error')).toContainText('Could not load recent requests');
  await expect(card.locator('.request-row')).toHaveCount(3);
  expect(mock.requestCalls()).toBe(2);
});

test('a rejected rule edit is shown on its row and leaves the rules unchanged', async ({ page }) => {
  const mock = await mockEntrypoint(page, { ruleStatus: 500 });
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  const row = card.locator('.request-row').filter({ hasText: 'api.example.com' });
  const button = row.getByRole('button', { name: /Add to rules/ });
  await button.click();
  await expect(row.locator('.row-error')).toContainText('Could not update rule: rule rejected');
  await expect(button).toBeEnabled();
  expect(mock.ruleBodies()).toEqual([['192.0.2.20', 'api.example.com']]);
});

test('caps rendered rows at 200 and reports the full returned count', async ({ page }) => {
  const requests = Array.from({ length: 201 }, (_, index) => ({
    ...REQUESTS[1],
    time: new Date(Date.UTC(2026, 10, 26, 12, 0, 201 - index)).toISOString(),
    dst: `192.0.2.${index + 1}:80`,
  }));
  await mockEntrypoint(page, { rules: [], requests });
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  await expect(card.locator('.requests-count')).toHaveText('201 requests');
  await expect(card.locator('.request-row')).toHaveCount(200);
  await expect(card.locator('.showing-count')).toHaveText('Showing the last 200 of 201');
});

test('shows a translated empty state when no flows have been recorded', async ({ page }) => {
  await mockEntrypoint(page, { requests: [] });
  await page.goto(DETAIL);

  const card = page.locator('entrypoint-requests-card');
  await expect(card.locator('.requests-empty')).toHaveText('No recent requests');
  await expect(card.locator('.request-row')).toHaveCount(0);
});
