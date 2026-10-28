import { expect, test } from '@playwright/test';

/**
 * A tun entrypoint's create form.
 *
 * Why the order matters: the leading hints are what a reader has to know before
 * choosing anything — that the device needs administrator rights (the one thing
 * on this form that makes the save fail), what it joins, and what keepalive
 * does. They belong above the fields they explain, not under the last one.
 */
test('the tun entrypoint form explains itself before its fields', async ({ page }) => {
  await page.goto('/entrypoint/tun/new');

  // The privilege caveat leads: it is the one thing on this form that can make
  // the save fail.
  const lead = page.locator('.p2p-hint').first();
  await expect(lead).toBeVisible();
  await expect(lead).toContainText('administrator rights');

  const intro = page.locator('.p2p-hint').filter({ hasText: "hub's network" });
  await expect(intro).toBeVisible();

  const deviceAddress = page.locator('input[placeholder="10.10.0.2/24"]');
  await expect(deviceAddress).toBeVisible();

  const fieldBox = (await deviceAddress.boundingBox())!;
  expect((await lead.boundingBox())!.y).toBeLessThan(fieldBox.y);
  expect((await intro.boundingBox())!.y).toBeLessThan(fieldBox.y);

  // The page carries its own per-field hints too: the leading block is what
  // moved, not every hint on the page.
  expect(await page.locator('.p2p-hint').count()).toBeGreaterThan(1);

  await page.screenshot({ path: 'test-results/tun-entrypoint-new.png', fullPage: true });
});

/**
 * The peer key sits with the device address, and is required.
 *
 * A tun entrypoint dials its hub by key: it and the device address are the two
 * halves of "which side of the tunnel is this node", so the key belongs directly
 * under the address rather than at the bottom of the form. Without a key the
 * host refuses to start the tunnel, so the form says so before the save does.
 */
test('the tun entrypoint form asks for the peer key under the device address', async ({ page }) => {
  await page.goto('/entrypoint/tun/new');

  const device = page.locator('input[placeholder="10.10.0.2/24"]');
  const peer = page.locator('input[placeholder="Base64 public key"]');
  const mtu = page.locator('input[placeholder="1420"]');
  await expect(device).toBeVisible();
  await expect(peer).toBeVisible();

  const y = async (loc: typeof device) => (await loc.boundingBox())!.y;
  expect(await y(peer)).toBeGreaterThan(await y(device));
  expect(await y(peer)).toBeLessThan(await y(mtu));

  // Marked required on its own label, and the reason is on the mark.
  const label = page.locator('.form-label').filter({ hasText: 'Peer public key' });
  await expect(label.locator('.required-mark')).toBeVisible();
  await expect(label.locator('.required-mark')).toHaveAttribute('title', 'This field is required');

  // Saving without a key is refused before the device is armed.
  await page.locator('input[placeholder="My Entrypoint"]').fill('Spoke');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('Peer public key: This field is required');
});

/**
 * LAN sharing sits at the end of the tun entrypoint form.
 *
 * Routes and DNS describe the tunnel every spoke has; sharing this node's LAN is
 * the opt-in extra the hub has to approve, so it reads last rather than in the
 * middle of the fields a reader must fill either way.
 */
test('the tun entrypoint form keeps LAN sharing last', async ({ page }) => {
  await page.goto('/entrypoint/tun/new');

  const y = async (selector: string) => (await page.locator(selector).boundingBox())!.y;
  const dns = await y('input[placeholder="10.10.0.1"]');
  const shareLAN = await y('input[placeholder="192.168.1.0/24"]');
  const shareMode = await y('.switch-row');
  const shareHint = await y('.p2p-hint:has-text("kernel NAT")');

  expect(shareLAN).toBeGreaterThan(dns);
  expect(shareMode).toBeGreaterThan(shareLAN);
  expect(shareHint).toBeGreaterThan(shareMode);
});

/**
 * Every field sits the same distance from the next.
 *
 * A hint used to carry a 10px bottom padding of its own *and* the field group's
 * 14px margin, so a field with a caption sat 24px above the next label while one
 * without sat 14px — the form read as an uneven rhythm. The captions now hug
 * their input and the group margin is the only gap; this asserts that, by
 * comparing the gaps rather than hard-coding a number.
 */
test('the tun entrypoint form spaces its fields evenly', async ({ page }) => {
  await page.goto('/entrypoint/tun/new');

  const groups = page.locator('.form-group');
  const count = await groups.count();
  expect(count).toBeGreaterThan(3);

  const gaps: number[] = [];
  let prevBottom: number | null = null;
  for (let i = 0; i < count; i++) {
    const box = (await groups.nth(i).boundingBox())!;
    if (prevBottom !== null) gaps.push(Math.round(box.y - prevBottom));
    prevBottom = box.y + box.height;
  }

  // Fields without captions, fields with captions, and the switch row between
  // them all land on the same gap.
  expect(new Set(gaps).size).toBe(1);
});

