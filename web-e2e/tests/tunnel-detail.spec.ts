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
/** A tun hub, closed (a device needs root): its allowlist rows must render
 *  anyway, since a peer's first connection is the case they exist for. */
const HUB_ID = 'e2e-tun-hub';
const HUB = `/tunnel/tun/${HUB_ID}`;
/** A tun hub whose allowlist is empty: the state a hub is created in, since
 *  the create form does not ask for peers. */
const EMPTY_HUB_ID = 'e2e-tun-hub-empty';
const EMPTY_HUB = `/tunnel/tun/${EMPTY_HUB_ID}`;

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

test('a tun hub reaches its peers page the way a p2p tunnel does', async ({ page }) => {
  await page.goto(HUB);
  // The info card's row, not the peers card below it: the row is "Peers" and
  // the card is "Allowed peers", the same way round on both types — the row
  // names the thing, the card is the entry to managing it.
  const hubPeers = page.locator('.info-label').filter({ hasText: 'Peers' });
  await expect(hubPeers).toBeVisible();

  // Same entry, same page, same component: a hub's peers are p2p peers on the
  // same host, so a user who knows where a tunnel's list lives finds it here.
  await page.getByText('Allowed peers', { exact: true }).last().click();
  await expect(page).toHaveURL(new RegExp(`/tunnel/tun/${HUB_ID}/peers$`));

  // One row per allowlisted peer, by alias — the same component the peers page
  // draws, so a hub and a tunnel cannot report a peer differently. The alias
  // comes off the allowlist, so a peer that has never dialled is still named.
  const rows = page.locator('peer-stats-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('laptop');
  // This hub is closed, so its counters read zero and the row says so rather
  // than inventing a path. What is checked is that the traffic line is here at
  // all: a hub whose rows dropped it would render nothing on this line.
  await expect(rows.first()).toContainText('No traffic yet.');
  // The key is a credential: masked until the eye says otherwise.
  await expect(rows.first()).not.toContainText('dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA');
  await page.getByTitle('Reveal').first().click();
  await expect(rows.first()).toContainText('dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA');

  await page.screenshot({ path: 'test-results/tun-hub-peers.png', fullPage: true });
});

test("a hub's allowlist row reads exactly as a p2p tunnel's", async ({ page }) => {
  // The two rows were written separately and drifted: the hub's label was the
  // longer "Allowed peers", which does not fit the label column's fixed 80px,
  // so it wrapped onto a second line and pushed the row's own buttons out of
  // line with its text. Same words, same face, same shape — this is what keeps
  // them that way, since nothing else compares the two pages.
  const shapeOf = async (url: string) => {
    await page.goto(url);
    const row = page.locator('.info-row').filter({ hasText: 'Peers' });
    return {
      label: (await row.locator('.info-label').innerText()).trim(),
      value: (await row.locator('.info-value').innerText()).trim(),
      // .info-value is monospace by default; "text" is the proportional face a
      // count wants.
      proportional: await row.locator('.info-value').evaluate(el => el.classList.contains('text')),
    };
  };

  const p2p = await shapeOf(DETAIL);
  const hub = await shapeOf(HUB);

  expect(hub.label).toBe(p2p.label);
  expect(hub.proportional).toBe(p2p.proportional);
  // Both a count — not one a count and the other a comma-joined list of
  // aliases, which is what the p2p side used to render.
  expect(hub.value).toMatch(/^\d+/);
  expect(p2p.value).toMatch(/^\d+/);
});

/**
 * A tun hub's create form.
 *
 * Same assertions as the tun entrypoint's, and for the same reason: the leading
 * hints are what a reader has to know before choosing anything — the device
 * needs administrator rights (the one thing that makes the save fail) and what
 * the hub is. They belong above the fields they explain.
 */
test('the tun hub form explains itself before its fields', async ({ page }) => {
  await page.goto('/tunnel/tun/new');

  const lead = page.locator('.p2p-hint').first();
  await expect(lead).toBeVisible();
  await expect(lead).toContainText('administrator rights');

  const intro = page.locator('.p2p-hint').filter({ hasText: 'the network' });
  await expect(intro).toBeVisible();

  const deviceAddress = page.locator('input[placeholder="10.10.0.1/24"]');
  await expect(deviceAddress).toBeVisible();

  const fieldBox = (await deviceAddress.boundingBox())!;
  expect((await lead.boundingBox())!.y).toBeLessThan(fieldBox.y);
  expect((await intro.boundingBox())!.y).toBeLessThan(fieldBox.y);

  // The allowlist is not asked for here: it lives on the peers page, exactly as
  // a p2p tunnel's does.
  await expect(page.locator('textarea')).toHaveCount(0);

  await page.screenshot({ path: 'test-results/tun-hub-new.png', fullPage: true });
});

/**
 * The privilege hint is styled, not merely marked: `warn` is a suffix nothing
 * implements unless the page defines it, and this defect shipped exactly that —
 * the class was on the element and no `.p2p-hint.warn` rule existed, so the
 * warning rendered as ordinary grey hint text. Asserting the *colour* is what
 * catches it; asserting the class or the string would both pass on the broken
 * build.
 *
 * Checked on both pages because they are separate components with separate
 * `static styles`: one having the rule says nothing about the other.
 */
const RED = 'rgb(239, 68, 68)'; // --red, the light theme's value.
const MUTED = 'rgb(156, 163, 175)'; // --text-muted, the plain hint colour.

for (const [name, path] of [
  ['tun hub', '/tunnel/tun/new'],
  ['tun entrypoint', '/entrypoint/tun/new'],
] as const) {
  test(`the ${name} privilege hint is actually red`, async ({ page }) => {
    await page.goto(path);
    const warn = page.locator('.p2p-hint.warn').first();
    await expect(warn).toBeVisible();
    await expect(warn).toHaveCSS('color', RED);

    // And the rule is scoped to `warn`, so the ordinary hints beside it are
    // still the muted grey rather than inheriting the warning colour.
    await expect(page.locator('.p2p-hint:not(.warn)').first()).toHaveCSS('color', MUTED);

    await page.screenshot({ path: `test-results/${name.replace(' ', '-')}-privilege-warn.png`, fullPage: true });
  });
}

/**
 * A hub with no peers: the state the API used to refuse to create.
 *
 * Why it must render and not look broken: the hub is running — its device is
 * there — it simply has nothing to route to, and its first peer is added on
 * the peers page. The page a user is looking at has to say that, and it has to
 * say it in the muted empty-state voice the p2p side already uses, not in the
 * error voice: there is nothing wrong here.
 */
test('a hub with no peers says so where the fix is, in the empty-state voice', async ({ page }) => {
  await page.goto(EMPTY_HUB);

  // The allowlist row: the same muted .info-value.empty the p2p page uses,
  // naming the peers page as what makes it reachable.
  const row = page.locator('.info-row').filter({ hasText: 'Peers' });
  await expect(row.locator('.info-value.empty')).toBeVisible();
  await expect(row.locator('.info-value.empty')).toContainText('peers page');

  // The peers card: an entry to the fix, with a hub-specific line. The p2p
  // wording ("running but unreachable") would read as a fault and would call a
  // hub a tunnel. The info row carries the same title, so the card is the one
  // holding this line rather than the one holding the count.
  const card = page.locator('.card').filter({ hasText: 'The hub is up' });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('unreachable');

  // Clicking it reaches the peers page, where the peer is added.
  await card.getByText('Allowed peers', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tunnel/tun/${EMPTY_HUB_ID}/peers$`));
  await expect(page.locator('.empty')).toContainText('No peers yet');

  // A hub that DOES have peers must not show the empty state at all — and it
  // must not show it merely because its peer has not carried traffic yet, so
  // this hub is closed and idle. That is the case a traffic-derived condition
  // gets wrong.
  await page.goto(HUB);
  await expect(page.getByText('The hub is up')).toHaveCount(0);
  await expect(page.getByText('1 allowed', { exact: true })).toBeVisible();

  await page.screenshot({ path: 'test-results/tun-hub-no-peers.png', fullPage: true });
});

test('a tun hub card carries the encryption badge', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('tunnel-card').filter({ hasText: 'Hub' });
  // The same wire a p2p tunnel's badge asserts, so the same lock.
  await expect(card.locator('.secure')).toHaveAttribute('title', 'End-to-end encrypted');
});
