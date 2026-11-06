import { expect, test } from '@playwright/test';

/**
 * The local peer list is where a spoke's own view of its members lives. A
 * direct link must look the same there as it does on every other transport
 * badge: a green bolt plus the word "Direct" (直连). The page used to render a
 * plain pill with no icon, which read as just another state.
 */
const ID = 'e2e-local-direct';

test('the local peer list draws direct as a green lightning badge', async ({ page }) => {
  await page.route(`**/api/entrypoints/${ID}/peers`, route =>
    route.fulfill({
      json: {
        peers: [
          {
            key: 'h-TJnbcy7oNUT4uGjgNiF8Lg49PvmwdDwEMcTnIboBE',
            name: 'spoke-b',
            state: 'direct',
            transport: 'direct',
            blocked: false,
            ips: ['10.10.0.3'],
            input_bytes: 2048,
            output_bytes: 4096,
          },
          {
            key: 'r6LIsr7Z3IZEGrl8rrDzQD4PgHIuCUd6-UtVGJ7-MTU',
            name: 'hub',
            state: 'hub',
            blocked: false,
            ips: ['10.10.0.1'],
          },
        ],
      },
    }),
  );

  await page.goto(`/entrypoint/tun/${ID}/peers`);

  const direct = page.locator('.state.direct');
  await expect(direct, 'the direct badge is drawn').toBeVisible();
  await expect(direct, 'the badge says Direct/直连').toContainText(/Direct|直连/);

  // The bolt is the shared transport icon; a state pill without it is the old
  // look this test exists to prevent.
  const bolt = direct.locator('svg polygon');
  await expect(bolt, 'the direct badge carries the lightning bolt').toBeVisible();

  const color = await direct.evaluate(el => getComputedStyle(el).color);
  const green = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--green-text)';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(color, 'the direct badge text uses the green transport tone').toBe(green);

  const hubColor = await page
    .locator('.state.hub')
    .evaluate(el => getComputedStyle(el).color);
  expect(color, 'direct must not read like the hub path').not.toBe(hubColor);

  await page.screenshot({ path: 'test-results/entrypoint-peers-direct.png', fullPage: true });
});
