import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ID = 'e2e-tungo-requests';
const DETAIL = `/entrypoint/tungo/${ID}`;
const REQUESTS = `${DETAIL}/requests`;

const FLOWS = [
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
      { chain: '', hop: 1, node: '', addr: '198.51.100.10:443', connect_ms: 0, err: '' },
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
  {
    time: '2026-11-26T12:00:00Z',
    host: '',
    dst: '[2001:4860:4860::8888]:443',
    network: 'tcp',
    proto: 'tls',
    tunneled: false,
    input_bytes: 128,
    output_bytes: 256,
    duration_ms: 1900,
    err: '',
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
    requests?: typeof FLOWS;
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
    return route.fulfill({ json: { requests: options.requests ?? FLOWS } });
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

test('renders inspector cards newest-first and polls on the two-second tick', async ({ page }) => {
  // Playwright's clock makes the polling assertion deterministic: runFor(2000)
  // advances exactly one refresh interval instead of racing a wall-clock timeout.
  const now = new Date('2026-11-26T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const mock = await mockEntrypoint(page);
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  await expect(requestsPage).toBeVisible();
  await expect(requestsPage.getByRole('heading', { name: 'Recent requests' })).toBeVisible();
  await expect(requestsPage.locator('.requests-count')).toHaveText('4 requests');
  const rows = requestsPage.locator('.request-row');
  const list = requestsPage.locator('.request-list');
  await expect(rows).toHaveCount(4);
  await expect(list).toHaveCSS('display', 'flex');
  await expect(list).toHaveCSS('flex-direction', 'column');
  await expect(list).toHaveCSS('row-gap', '4px');
  await expect(rows.first()).toHaveCSS('padding', '8px 12px');
  await expect(rows.first()).toHaveCSS('border-radius', '4px');
  await expect(rows.first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(requestsPage.locator('.route-badge')).toHaveCount(0);

  const tunneled = rows.nth(0);
  await expect(tunneled).toContainText('api.example.com');
  await expect(tunneled).toContainText(':443');
  await expect(tunneled).not.toContainText('198.51.100.10');
  const lock = tunneled.locator('.tunnel-lock');
  await expect(lock).toHaveAttribute('title', 'Tunnel');
  await expect(lock).toHaveAttribute('aria-label', 'Tunnel');
  await expect(lock.locator('svg')).toHaveCount(1);
  await expect(tunneled).toContainText('tcp · http');
  await expect(tunneled).toContainText('1.00 KB');
  await expect(tunneled).toContainText('2.00 KB');
  await expect(tunneled.locator('.duration')).toHaveText('12.0ms');
  await expect(tunneled.locator('.request-meta time')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

  const direct = rows.nth(1);
  await expect(direct).toContainText('192.0.2.20:80');
  await expect(direct.locator('.tunnel-lock, .route-badge')).toHaveCount(0);
  await expect(direct.locator('.duration')).toHaveText('4.0ms');

  const udp = rows.nth(2);
  await expect(udp).toContainText('198.51.100.53:5353');
  await expect(udp).toContainText('udp · dns');
  await expect(udp.locator('.tunnel-lock')).toHaveAttribute('aria-label', 'Tunnel');
  await expect(udp).toHaveClass(/error/);
  await expect(udp).toHaveCSS('border-left-width', '2px');
  await expect(udp.locator('.duration')).toHaveText('<1ms');

  const ipv6 = rows.nth(3);
  await expect(ipv6.locator('.destination')).toHaveText('[2001:4860:4860::8888]:443');
  await expect(ipv6.locator('.duration')).toHaveText('1.9s');

  // Details stay out of the collapsed card. The row's accessible name keeps
  // its destination and action instead of only saying "Show path".
  await expect(requestsPage.locator('.detail-chips')).toHaveCount(0);
  await expect(tunneled.getByRole('button', { name: /api\.example\.com.*Show path/ })).toBeVisible();
  await tunneled.locator('.row-toggle').click();
  const details = tunneled.locator('.detail-chips');
  await expect(details).toBeVisible();
  await expect(details).toContainText('Host: api.example.com');
  await expect(details).toContainText('Target: 198.51.100.10:443');
  await expect(details).toContainText('Route: hub/home → 198.51.100.10:443');
  await expect(details).toContainText('Duration: 12.0ms');
  await expect(details).toContainText('Bytes: ↑1.00 KB ↓2.00 KB');
  await tunneled.locator('.row-toggle').click();
  await expect(details).toBeHidden();

  await direct.locator('.row-toggle').click();
  await expect(direct.locator('.detail-chips')).toContainText('Route: direct');
  await expect(direct.locator('.detail-chips')).not.toContainText('Host:');

  await udp.locator('.row-toggle').click();
  await expect(udp.locator('.detail-chip.error')).toHaveText('Error: lookup failed');

  await expect.poll(() => mock.requestCalls()).toBe(1);
  await page.clock.runFor(2000);
  await expect.poll(() => mock.requestCalls()).toBe(2);
});

test('uses a full local timestamp for older records and a clock time for today', async ({ page }) => {
  const now = new Date(2026, 10, 27, 12, 0, 0);
  await page.clock.install({ time: now });
  const requests = [
    { ...FLOWS[1], time: new Date(2026, 10, 27, 11, 59, 59).toISOString(), dst: '192.0.2.30:80' },
    { ...FLOWS[1], time: new Date(2026, 10, 26, 12, 0, 0).toISOString(), dst: '192.0.2.31:80' },
  ];
  await mockEntrypoint(page, { requests });
  await page.goto(REQUESTS);

  const rows = page.locator('entrypoint-requests-page .request-row');
  await expect(rows.nth(0).locator('.request-meta time')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(rows.nth(1).locator('.request-meta time')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('formats request durations with the inspector units and precision', async ({ page }) => {
  const cases = [
    { duration_ms: 0.586, expected: '586µs' },
    { duration_ms: 45.6, expected: '45.6ms' },
    { duration_ms: 10_000, expected: '10.0s' },
    { duration_ms: 61_000, expected: '1m1s' },
    { duration_ms: 3_661_000, expected: '1h1m1s' },
  ];
  const requests = cases.map(({ duration_ms }, index) => ({
    ...FLOWS[1],
    time: new Date(Date.UTC(2026, 10, 26, 12, 0, index)).toISOString(),
    dst: `192.0.2.${index + 40}:80`,
    duration_ms,
  }));
  await mockEntrypoint(page, { requests });
  await page.goto(REQUESTS);

  const rows = page.locator('entrypoint-requests-page .request-row');
  for (const [index, { expected }] of cases.entries()) {
    const row = rows.filter({ hasText: `192.0.2.${index + 40}:80` });
    await expect(row.locator('.duration')).toHaveText(expected);
  }
});

test.describe('phone-width request rows', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('keeps every row and rule action inside the viewport', async ({ page }) => {
    const requests = FLOWS.map((request, index) => index === 0
      ? { ...request, host: 'a-very-long-hostname-that-must-truncate.example.com' }
      : request);
    await mockEntrypoint(page, { requests });
    await page.goto(REQUESTS);

    const requestsPage = page.locator('entrypoint-requests-page');
    const rows = requestsPage.locator('.request-row');
    await expect(rows).toHaveCount(FLOWS.length);
    const viewport = page.viewportSize()!;

    for (const row of await rows.all()) {
      const size = await row.evaluate(element => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);

      const action = row.locator('.rule-action');
      await expect(action).toBeVisible();
      await expect(action).toHaveAttribute('title', /Add to rules|Remove from rule/);
      await expect(action).toHaveCSS('width', '24px');
      await expect(action).toHaveCSS('height', '24px');
      const actionBox = await action.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(actionBox!.x).toBeGreaterThanOrEqual(0);
      expect(actionBox!.y).toBeGreaterThanOrEqual(0);
      expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(viewport.width);
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(viewport.height);

      const destination = row.locator('.destination');
      const destinationSize = await destination.evaluate(element => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        textOverflow: getComputedStyle(element).textOverflow,
        whiteSpace: getComputedStyle(element).whiteSpace,
        overflowX: getComputedStyle(element).overflowX,
      }));
      expect(destinationSize.scrollWidth).toBeGreaterThanOrEqual(destinationSize.clientWidth);
      expect(destinationSize.textOverflow).toBe('ellipsis');
      expect(destinationSize.whiteSpace).toBe('nowrap');
      expect(destinationSize.overflowX).toBe('hidden');
    }

    const ipv6 = rows.nth(3);
    await expect(ipv6.locator('.destination')).toHaveText('[2001:4860:4860::8888]:443');

    const expandedRow = rows.first();
    const longDestination = await expandedRow.locator('.destination').evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(longDestination.scrollWidth).toBeGreaterThan(longDestination.clientWidth);
    await expandedRow.locator('.row-toggle').click();
    await expect(expandedRow.locator('.detail-chips')).toBeVisible();
    const expandedSize = await expandedRow.evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(expandedSize.scrollWidth).toBeLessThanOrEqual(expandedSize.clientWidth + 1);

    const timestamp = expandedRow.locator('.request-meta time');
    await expect(timestamp).toHaveCSS('white-space', 'nowrap');
    await expect(timestamp).toHaveCSS('flex-shrink', '0');
    const timestampSize = await timestamp.evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(timestampSize.scrollWidth).toBeLessThanOrEqual(timestampSize.clientWidth + 1);

    const pageWidth = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth + 1);
  });
});

test('adds a host to the rules and removes an already listed destination', async ({ page }) => {
  const mock = await mockEntrypoint(page);
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  const rows = requestsPage.locator('.request-row');
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

test('renders exact, suffix, CIDR, and port-normalized rule coverage', async ({ page }) => {
  const requests = [
    { ...FLOWS[1], time: '2026-11-26T12:00:07Z', host: 't.me:80', dst: '149.154.167.99:80' },
    { ...FLOWS[1], time: '2026-11-26T12:00:06Z', host: 'sub.t.me:443', dst: '149.154.167.99:443' },
    { ...FLOWS[1], time: '2026-11-26T12:00:05Z', host: 'exact.example:443', dst: '198.51.100.5:443' },
    { ...FLOWS[1], time: '2026-11-26T12:00:04Z', dst: '192.168.100.201:4096' },
    { ...FLOWS[1], time: '2026-11-26T12:00:03Z', dst: '[2001:db8::201]:443' },
    { ...FLOWS[1], time: '2026-11-26T12:00:02Z', host: 'port.example:8080', dst: '198.51.100.6:8080' },
    { ...FLOWS[1], time: '2026-11-26T12:00:01Z', host: 'case.example:443', dst: '198.51.100.7:443' },
    { ...FLOWS[1], time: '2026-11-26T12:00:00Z', host: 'nott.me:443', dst: '198.51.100.8:443' },
  ];
  const mock = await mockEntrypoint(page, {
    rules: [
      'exact.example',
      '.t.me',
      '192.168.100.0/24',
      '2001:db8::/64',
      'port.example:8080',
      '.EXAMPLE',
    ],
    requests,
  });
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  const rows = requestsPage.locator('.request-row');
  await expect(rows).toHaveCount(requests.length);

  const covered = [
    ['t.me:80', '.t.me'],
    ['sub.t.me:443', '.t.me'],
    ['192.168.100.201:4096', '192.168.100.0/24'],
    ['[2001:db8::201]:443', '2001:db8::/64'],
    ['port.example:8080', 'port.example:8080'],
    ['case.example:443', '.EXAMPLE'],
  ];
  for (const [destination, rule] of covered) {
    const row = rows.filter({ hasText: destination });
    const label = `Covered by rule: ${rule}`;
    await expect(row.locator('.rule-covered')).toHaveAttribute('title', label);
    await expect(row.locator('.rule-covered')).toHaveAttribute('aria-label', label);
    await expect(row.locator('.rule-covered svg polyline')).toHaveCount(1);
    await expect(row.locator('.rule-action')).toHaveCount(0);
    await expect(row.locator('.row-toggle')).toHaveAttribute('aria-expanded', 'false');
  }

  const exact = rows.filter({ hasText: 'exact.example:443' });
  await expect(exact.locator('.rule-action')).toHaveAttribute('title', 'Remove from rule: exact.example');
  await expect(exact.locator('.rule-action svg line')).toHaveCount(1);
  await expect(exact.locator('.rule-covered')).toHaveCount(0);

  const uncovered = rows.filter({ hasText: 'nott.me:443' });
  await expect(uncovered.locator('.rule-action')).toHaveAttribute('title', 'Add to rules: nott.me');
  await expect(uncovered.locator('.rule-action svg line')).toHaveCount(2);
  await expect(uncovered.locator('.rule-covered')).toHaveCount(0);
  expect(mock.ruleBodies()).toEqual([]);
});

test('adds a bare host and removes only its exact rule when a broader rule still covers it', async ({ page }) => {
  const requests = [
    { ...FLOWS[1], time: '2026-11-26T12:00:03Z', host: 't.me:80', dst: '149.154.167.99:80' },
    { ...FLOWS[1], time: '2026-11-26T12:00:02Z', host: 'both.example.com:443', dst: '198.51.100.9:443' },
    { ...FLOWS[1], time: '2026-11-26T12:00:01Z', host: 'uncovered.example:8443', dst: '198.51.100.10:8443' },
    { ...FLOWS[1], time: '2026-11-26T12:00:00Z', dst: '192.168.100.201:4096' },
  ];
  const mock = await mockEntrypoint(page, {
    rules: ['.t.me', '192.168.100.0/24', '.example.com', 'both.example.com'],
    requests,
  });
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  const rows = requestsPage.locator('.request-row');
  await expect(rows).toHaveCount(requests.length);

  const covered = rows.filter({ hasText: 't.me:80' });
  await expect(covered.locator('.rule-covered')).toHaveAttribute('title', 'Covered by rule: .t.me');
  await expect(covered.locator('.rule-action')).toHaveCount(0);

  const exact = rows.filter({ hasText: 'both.example.com:443' });
  await exact.locator('.rule-action').click();
  await expect.poll(() => mock.ruleBodies().length).toBe(1);
  expect(mock.ruleBodies()[0]).toEqual(['.t.me', '192.168.100.0/24', '.example.com']);
  await expect(exact.locator('.rule-covered')).toHaveAttribute('title', 'Covered by rule: .example.com');
  await expect(exact.locator('.rule-action')).toHaveCount(0);

  const uncovered = rows.filter({ hasText: 'uncovered.example:8443' });
  await uncovered.locator('.rule-action').click();
  await expect.poll(() => mock.ruleBodies().length).toBe(2);
  expect(mock.ruleBodies()[1]).toEqual([
    '.t.me',
    '192.168.100.0/24',
    '.example.com',
    'uncovered.example',
  ]);
  await expect(uncovered.locator('.rule-action')).toHaveAttribute('title', 'Remove from rule: uncovered.example');
});

test('turning auto refresh off stops the timer while manual refresh still works', async ({ page }) => {
  const now = new Date('2026-11-26T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const mock = await mockEntrypoint(page);
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  await expect(requestsPage.locator('.request-row')).toHaveCount(4);
  const auto = requestsPage.getByRole('button', { name: 'Auto', exact: true });
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await page.clock.runFor(5000);
  expect(mock.requestCalls()).toBe(1);

  await requestsPage.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => mock.requestCalls()).toBe(2);
  await expect(requestsPage.locator('.request-row')).toHaveCount(4);
});

test('pauses the timer while the page is hidden and resumes when visible', async ({ page }) => {
  const now = new Date('2026-11-26T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const mock = await mockEntrypoint(page);
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  await expect(requestsPage.locator('.request-row')).toHaveCount(4);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(requestsPage.locator('.pause-indicator')).toHaveText('Paused while the page is hidden');
  await page.clock.runFor(6000);
  expect(mock.requestCalls()).toBe(1);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => mock.requestCalls()).toBe(2);
  await expect(requestsPage.locator('.pause-indicator')).toHaveCount(0);
});

test('a failed refresh keeps the last rows and shows an inline error', async ({ page }) => {
  const mock = await mockEntrypoint(page, { failRequestsAfterFirst: true });
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  await expect(requestsPage.locator('.request-row')).toHaveCount(4);
  await requestsPage.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(requestsPage.locator('.requests-error')).toContainText('Could not load recent requests');
  await expect(requestsPage.locator('.request-row')).toHaveCount(4);
  expect(mock.requestCalls()).toBe(2);
});

test('a rejected rule edit is shown on its row and leaves the rules unchanged', async ({ page }) => {
  const mock = await mockEntrypoint(page, { ruleStatus: 500 });
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  const row = requestsPage.locator('.request-row').filter({ hasText: 'api.example.com' });
  const button = row.getByRole('button', { name: /Add to rules/ });
  await button.click();
  await expect(row.locator('.row-error')).toContainText('Could not update rule: rule rejected');
  await expect(button).toBeEnabled();
  expect(mock.ruleBodies()).toEqual([['192.0.2.20', 'api.example.com']]);
});

test('caps rendered rows at 200 and reports the full returned count', async ({ page }) => {
  const requests = Array.from({ length: 201 }, (_, index) => ({
    ...FLOWS[1],
    time: new Date(Date.UTC(2026, 10, 26, 12, 0, 201 - index)).toISOString(),
    dst: `192.0.2.${index + 1}:80`,
  }));
  await mockEntrypoint(page, { rules: [], requests });
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  await expect(requestsPage.locator('.requests-count')).toHaveText('201 requests');
  await expect(requestsPage.locator('.request-row')).toHaveCount(200);
  await expect(requestsPage.locator('.showing-count')).toHaveText('Showing the last 200 of 201');
});

test('shows a translated empty state when no flows have been recorded', async ({ page }) => {
  await mockEntrypoint(page, { requests: [] });
  await page.goto(REQUESTS);

  const requestsPage = page.locator('entrypoint-requests-page');
  await expect(requestsPage.locator('.requests-empty')).toHaveText('No recent requests');
  await expect(requestsPage.locator('.request-row')).toHaveCount(0);
});
