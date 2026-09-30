import { expect, test } from '@playwright/test';

/**
 * A UI mutation carries the Wisper-Id header.
 *
 * Why: the backend logs that id on its mutation line, and the p2p seam logs it
 * on the calls the action started — the join the feature exists for. Only a
 * browser can show that the app actually attaches it (a header set server-side
 * would never reach the backend) and that the API still accepts the request
 * with it.
 *
 * The peers toggle is the mutation used: it is a real PUT through the app's own
 * fetch, it applies in place, and the second click undoes the first — so the
 * fixture is left as it was found.
 */

/** Seeded by scripts/ui-test.sh: two allowlisted peers, "laptop" enabled. */
const PEERS = '/tunnel/p2p/e2e-p2p-tunnel/peers';

const DISABLE = 'Disable (stays on the list, takes no new connections)';
const ENABLE = 'Enable';

test('a mutation carries Wisper-Id and still succeeds', async ({ page }) => {
  const mutations: { url: string; id: string; status: number }[] = [];
  page.on('response', (res) => {
    const req = res.request();
    if (req.method() === 'GET' || !req.url().includes('/api/')) return;
    mutations.push({ url: req.url(), id: req.headers()['wisper-id'] ?? '', status: res.status() });
  });

  await page.goto(PEERS);
  const laptop = page.locator('.peer-row').filter({ hasText: 'laptop' });
  await expect(laptop).toBeVisible();

  // Off, then back on: two saves, each an atomic PUT of the whole list. The
  // toggle's own title is the marker — an enabled row carries a .peer-badge too
  // (its transport), so the class alone says nothing about the switch.
  await laptop.getByTitle(DISABLE).click();
  await expect(laptop.getByTitle(ENABLE)).toBeVisible();
  await laptop.getByTitle(ENABLE).click();
  await expect(laptop.getByTitle(DISABLE)).toBeVisible();

  expect(mutations.length).toBeGreaterThanOrEqual(2);
  for (const m of mutations) {
    expect.soft(m.id, `no Wisper-Id on ${m.url}`).toMatch(/^[0-9a-f]{8}$/);
    expect.soft(m.status, `${m.url} rejected a header-bearing request`).toBe(200);
  }
  // Each click gets its own id, or two actions would read as one in the log.
  expect(new Set(mutations.map((m) => m.id)).size).toBe(mutations.length);
});
