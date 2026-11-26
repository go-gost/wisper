import { expect, test } from '@playwright/test';

/**
 * A tungo entrypoint's create form: the split spoke.
 *
 * It owns a device like a tun spoke, so it asks for the same device fields and
 * spends them on the same peer key. What it does not have is the tun spoke's
 * LAN sharing and direct-path switch: those describe what a tun hub sees of
 * this device, while a tungo decides for itself — every destination is either
 * on its split list or dialled directly.
 */
test('the tungo entrypoint form shows the device fields, the peer and its rules', async ({ page }) => {
  await page.goto('/entrypoint/tungo/new');

  // The device: address, MTU, routed subnets and DNS, the same four a tun
  // spoke fills in.
  await expect(page.locator('input[placeholder="10.10.0.2/24"]')).toBeVisible();
  await expect(page.locator('input[placeholder="1300"]')).toBeVisible();
  await expect(page.locator('input[placeholder="0.0.0.0/0, ::/0"]')).toBeVisible();
  await expect(page.locator('input[placeholder="192.168.100.100"]')).toBeVisible();

  // The routes hint is the split's own: no hub subnet to fall back to, and the
  // rules below decide what the device carries.
  await expect(
    page.locator('.p2p-hint').filter({ hasText: 'decided by the split rules below' }),
  ).toBeVisible();

  // The hub it dials, marked required: without a key there is nobody to reach.
  const peer = page.locator('input[placeholder="Base64 public key"]');
  await expect(peer).toBeVisible();
  const peerLabel = page.locator('.form-label').filter({ hasText: 'Peer public key' });
  await expect(peerLabel.locator('.required-mark')).toBeVisible();

  // The split itself: the compact editor stays on the page until the full
  // one-destination-per-line editor is opened.
  await expect(page.locator('.form-label').filter({ hasText: 'Split rules' })).toBeVisible();
  await expect(page.locator('.rules-editor-header')).toContainText('Empty list — all traffic goes direct');
  await expect(page.locator('textarea')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  const rules = page.locator('.rules-bulk-textarea');
  await expect(rules).toBeVisible();
  await expect(rules).toHaveValue('');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.p2p-hint').filter({ hasText: 'dialled directly' }).first()).toBeVisible();

  // None of the tun spoke's own controls: a split shares no LAN and has no
  // separate mesh path to switch — every unlisted flow is already direct.
  await expect(page.locator('.form-label').filter({ hasText: 'Shared LAN' })).toHaveCount(0);
  await expect(page.locator('.switch-label').filter({ hasText: 'Sharing Backend' })).toHaveCount(0);
  await expect(page.locator('.switch-label').filter({ hasText: 'Direct links' })).toHaveCount(0);
  await expect(page.locator('.switch-row')).toHaveCount(0);

  await page.screenshot({ path: 'test-results/tungo-entrypoint-new.png', fullPage: true });
});

/**
 * The split is reachable at all: the picker is the only way to a create form.
 *
 * A type that no card offers can only be created by hand-editing the config, and
 * a detail page nothing links to is a page nobody sees.
 */
test('the entrypoint picker offers the split entrypoint', async ({ page }) => {
  await page.goto('/entrypoint/new');

  const card = page.locator('.type-card').filter({ hasText: 'TUN Split' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('listed destinations only');

  await card.click();
  await expect(page).toHaveURL(/\/entrypoint\/tungo\/new$/);
  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  await expect(page.locator('.rules-bulk-textarea')).toBeVisible();
});

/**
 * The rules travel as a list, and the text box is only its rendering.
 *
 * A save trims each line and drops the empty ones, so a pasted list with blank
 * lines and stray spaces lands as the same rules a hand-typed one does. An
 * empty box is an explicit clear (`[]`, everything direct) rather than "keep
 * what you had": the field is sent on every save so both states are the
 * operator's, never a leftover.
 *
 * The save is answered here rather than by the host: creating a device needs
 * administrator rights, and the request body is what this test is about.
 */
test('the tungo form saves its rules as a trimmed list', async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  const created = {
    id: 'e2e-tungo-created',
    name: 'Split',
    type: 'tungo',
    endpoint: '',
    entrypoint: '10.10.100.250/32',
    status: 'stopped',
    favorite: false,
    created_at: '2026-01-15T10:30:00Z',
    error: '',
    options: {},
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
  await page.route('**/api/entrypoints', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: created });
  });

  const save = async (rules: string) => {
    await page.goto('/entrypoint/tungo/new');
    await page.locator('input[placeholder="My Entrypoint"]').fill('Split');
    await page
      .locator('input[placeholder="Base64 public key"]')
      .fill('dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA');
    await page.locator('input[placeholder="10.10.0.2/24"]').fill('10.10.100.250/32');
    await page.getByRole('button', { name: 'Edit all', exact: true }).click();
    await page.locator('.rules-bulk-textarea').fill(rules);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  };

  await save('example.com\n\n  192.168.100.0/24  \n');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].type).toBe('tungo');
  // A device entrypoint binds no socket: the device address is the net field.
  expect(sent[0].endpoint).toBe('');
  // The address is not optional on the wire: the host refuses a split without
  // it (validateTungoEntryPoint), so a save that drops `net` must not stay
  // green here.
  expect(sent[0].net).toBe('10.10.100.250/32');
  // Sent on every save, and present even when empty — that presence is what
  // lets an empty box mean "clear the list" instead of "keep the old one".
  expect(Object.keys(sent[0])).toContain('rules');
  expect(sent[0].rules).toEqual(['example.com', '192.168.100.0/24']);

  await save('');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].net).toBe('10.10.100.250/32');
  expect(Object.keys(sent[1])).toContain('rules');
  expect(sent[1].rules).toEqual([]);

  // A tun spoke sends no rules at all: the field belongs to the split, not to
  // every device entrypoint.
  await page.goto('/entrypoint/tun/new');
  await page.locator('input[placeholder="My Entrypoint"]').fill('Spoke');
  await page
    .locator('input[placeholder="Base64 public key"]')
    .fill('dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA');
  await page.locator('input[placeholder="10.10.0.2/24"]').fill('10.10.0.2/24');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2].type).toBe('tun');
  expect(sent[2].net).toBe('10.10.0.2/24');
  expect('rules' in sent[2]).toBe(false);
});

/**
 * An existing split's rules come back as text, in both modes.
 *
 * The stored form is the API's array; the editor is a text box. Reading one
 * into the other and back is what keeps a save from quietly rewriting the list
 * — and an empty list has to render as an empty box in the editor, not as the
 * word "undefined".
 */
test('a tungo entrypoint renders its saved rules in view and edit mode', async ({ page }) => {
  const ep = {
    id: 'e2e-tungo-entrypoint',
    name: 'Split',
    type: 'tungo',
    endpoint: 'dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA',
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
      mtu: 1300,
      routes: '0.0.0.0/0',
      dns: '192.168.100.100',
      rules: ['home.pi', '192.168.100.0/24'],
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
  await page.route('**/api/entrypoints', r => r.fulfill({ json: [ep] }));
  await page.route('**/api/entrypoints/e2e-tungo-entrypoint', r => r.fulfill({ json: ep }));

  await page.goto('/entrypoint/tungo/e2e-tungo-entrypoint');

  const rulesRow = page
    .locator('.info-row')
    .filter({ has: page.locator('.info-label', { hasText: 'Split rules' }) });
  await expect(rulesRow.locator('.info-value')).toHaveText('home.pi, 192.168.100.0/24');

  // The tun-only rows stay off a split's page, exactly as they stay off its form.
  await expect(page.locator('.info-label').filter({ hasText: 'Shared LAN' })).toHaveCount(0);
  await expect(page.locator('.info-label').filter({ hasText: 'Direct links' })).toHaveCount(0);

  await page.goto('/entrypoint/tungo/e2e-tungo-entrypoint?edit');
  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  const editor = page.locator('.rules-bulk-textarea');
  await expect(editor).toHaveValue('home.pi\n192.168.100.0/24');
  await editor.fill('changed-but-cancelled');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  await expect(editor).toHaveValue('home.pi\n192.168.100.0/24');
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.screenshot({ path: 'test-results/tungo-entrypoint-edit.png', fullPage: true });
});

function tungoEntrypoint(rules: string[]) {
  return {
    id: 'e2e-tungo-long',
    name: 'Long split',
    type: 'tungo',
    endpoint: 'dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA',
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
      mtu: 1300,
      routes: '0.0.0.0/0, ::/0',
      dns: '192.168.100.100',
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

async function mockTungoEntrypoint(page: import('@playwright/test').Page, rules: string[]) {
  const ep = tungoEntrypoint(rules);
  await page.route('**/api/entrypoints', r => r.fulfill({ json: [ep] }));
  await page.route('**/api/entrypoints/e2e-tungo-long', r => r.fulfill({ json: ep }));
}

test('a long tungo rule list is collapsed until its details are expanded', async ({ page }) => {
  const rules = Array.from({ length: 200 }, (_, i) => `host-${String(i + 1).padStart(3, '0')}.example`);
  await mockTungoEntrypoint(page, rules);
  await page.goto('/entrypoint/tungo/e2e-tungo-long');

  const rulesRow = page
    .locator('.info-row')
    .filter({ has: page.locator('.info-label', { hasText: 'Split rules' }) });
  await expect(rulesRow.locator('.info-value')).toHaveText('200 rules');

  const disclosure = page.locator('details.rules-disclosure');
  const pre = disclosure.locator('pre');
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(pre).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(pre).toBeVisible();
  await expect(pre).toContainText('host-001.example');
  await expect(pre).toContainText('host-200.example');
  await expect(pre).toHaveCSS('max-height', '320px');
  await expect(pre).toHaveCSS('overflow', 'auto');
  await disclosure.locator('summary').click();
  await expect(pre).toBeHidden();
});

test('an empty tungo rule list says that all traffic goes direct', async ({ page }) => {
  await mockTungoEntrypoint(page, []);
  await page.goto('/entrypoint/tungo/e2e-tungo-long');

  const rulesRow = page
    .locator('.info-row')
    .filter({ has: page.locator('.info-label', { hasText: 'Split rules' }) });
  await expect(rulesRow.locator('.info-value')).toHaveText('Empty list — all traffic goes direct');
  await expect(page.locator('details.rules-disclosure')).toHaveCount(0);
});

test('the long tungo editor searches and removes exactly one matching rule', async ({ page }) => {
  const rules = Array.from({ length: 200 }, (_, i) => `host-${String(i + 1).padStart(3, '0')}.example`);
  await mockTungoEntrypoint(page, rules);
  await page.goto('/entrypoint/tungo/e2e-tungo-long?edit');

  await expect(page.locator('.rules-editor-header')).toContainText('200 rules');
  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  const editor = page.locator('.rules-bulk-textarea');
  await expect(editor).toHaveValue(rules.join('\n'));
  const scroll = await editor.evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  const search = page.getByRole('searchbox', { name: 'Find a rule' });
  await search.fill('host-');
  await expect(page.locator('.rules-match')).toHaveCount(50);
  await search.fill('host-199.example');
  const match = page.locator('.rules-match').filter({ hasText: 'host-199.example' });
  await expect(match).toBeVisible();
  await match.getByRole('button', { name: 'Remove host-199.example' }).click();
  await expect(page.locator('.rules-editor-header')).toContainText('199 rules');
  await expect(page.locator('.rules-match')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  await expect(editor).toHaveValue(rules.filter(rule => rule !== 'host-199.example').join('\n'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('the tungo rule editor adds trimmed unique entries and Done preserves the typed text', async ({ page }) => {
  await page.goto('/entrypoint/tungo/new');

  const header = page.locator('.rules-editor-header');
  await expect(header).toContainText('Empty list — all traffic goes direct');
  const add = page.getByRole('textbox', { name: 'New rule' });
  await add.fill('  example.com  ');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(header).toContainText('1 rules');
  await add.fill('example.com');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(header).toContainText('1 rules');

  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  const editor = page.locator('.rules-bulk-textarea');
  await expect(editor).toHaveValue('example.com');
  const typed = ' example.com \n\n 192.168.100.0/24 ';
  await editor.fill(typed);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(header).toContainText('2 rules');
  await page.getByRole('button', { name: 'Edit all', exact: true }).click();
  await expect(editor).toHaveValue(typed);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
