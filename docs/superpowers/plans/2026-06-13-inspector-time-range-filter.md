# Inspector Time-Range Filtering & Page-Size Reduction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preset time-range filter (5m/15m/1h/6h/24h/All) to the inspector's Query-mode record list, and reduce the per-page record count from 100 to 50.

**Architecture:** Frontend-only. The inspector backend already accepts `start`/`end` Unix-second query params, and `InspectorApiClient.query()` already forwards `start` — the UI just never set it. We add a pill row to the existing filter bar (visible only in Query mode), hold a `_range` selection in the page, compute `start = now - rangeSec`, and pass it to the query. The page-size constants change from 100 to 50 at both the request site and the `hasMore` comparison.

**Tech Stack:** TypeScript, Lit 3 (web components), Vite. No backend changes.

**Spec:** `docs/superpowers/specs/2026-06-13-inspector-time-range-filter-design.md`

---

## Verification approach (read this first)

This project has **no frontend test runner** (`web-src/package.json` defines only `dev`, `build`, `preview`, `typecheck`). Established verification for web changes is:

1. `npm run typecheck` (runs `tsc --noEmit`) — the per-task gate. This matters because `make web` uses esbuild, which **strips types without checking them**, so type errors ship silently unless `tsc --noEmit` is run explicitly.
2. `make web` — produces the embedded `web/` bundle.
3. Manual browser check.

So tasks below use `npm run typecheck` as the automated gate instead of unit tests. (Adding a test harness is out of scope for this feature.) All `npm`/`make` commands run from `web-src/` or repo root respectively — see each step.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `web-src/src/i18n/en.ts` | English strings | Add 2 keys: `inspectorTime`, `inspectorRangeAll` |
| `web-src/src/i18n/zh.ts` | Chinese strings | Add 2 keys: `inspectorTime`, `inspectorRangeAll` |
| `web-src/src/components/inspector/filter-bar.ts` | Filter controls row | Add `mode` + `range` props, time-range pill row (query mode only), `range-change` event |
| `web-src/src/pages/inspector-page.ts` | Page state + query orchestration | `_range` state, `_onRangeChange` handler, send `start`, page size 100→50 (2 sites), bind `mode`/`range` to filter bar |

No changes to `web-src/src/api/inspector.ts` (already forwards `start`/`end`).

---

### Task 1: Add i18n keys

**Files:**
- Modify: `web-src/src/i18n/en.ts` (after line ~133, the `inspectorFilterSid` key)
- Modify: `web-src/src/i18n/zh.ts` (after line ~133, the `inspectorFilterSid` key)

- [ ] **Step 1: Add keys to `en.ts`**

Find this exact line in `web-src/src/i18n/en.ts`:

```ts
  inspectorFilterSid: 'Session ID',
```

Insert these two lines immediately **after** it:

```ts
  inspectorFilterSid: 'Session ID',
  inspectorTime: 'Time',
  inspectorRangeAll: 'All',
```

- [ ] **Step 2: Add keys to `zh.ts`**

Find this exact line in `web-src/src/i18n/zh.ts`:

```ts
  inspectorFilterSid: '会话 ID',
```

Insert these two lines immediately **after** it:

```ts
  inspectorFilterSid: '会话 ID',
  inspectorTime: '时间',
  inspectorRangeAll: '全部',
```

- [ ] **Step 3: Typecheck**

Run: `cd web-src && npm run typecheck`
Expected: PASS, no output (clean exit). A duplicate-key error here means the keys were inserted in the wrong place — verify each is inside the object literal, before the closing `};`.

- [ ] **Step 4: Commit**

```bash
git add web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "feat(inspector): add time-range filter i18n keys"
```

---

### Task 2: Add time-range pill row to the filter bar

**Files:**
- Modify: `web-src/src/components/inspector/filter-bar.ts`

- [ ] **Step 1: Add `mode` and `range` properties + a RANGES constant**

In `web-src/src/components/inspector/filter-bar.ts`, replace the existing property block:

```ts
@customElement('inspector-filter-bar')
export class InspectorFilterBar extends LitElement {
  @property() sid = '';
```

with:

```ts
type RangeValue = 'all' | number;

const RANGES: { m: number; label: string }[] = [
  { m: 5, label: '5m' },
  { m: 15, label: '15m' },
  { m: 60, label: '1h' },
  { m: 360, label: '6h' },
  { m: 1440, label: '24h' },
];

@customElement('inspector-filter-bar')
export class InspectorFilterBar extends LitElement {
  @property() sid = '';
  @property() mode: 'query' | 'live' = 'query';
  @property() range: RangeValue = 'all';
```

Place the `type RangeValue` and `const RANGES` declarations at the top of the file, after the existing imports and before the `@customElement` decorator (i.e. where module-level constants belong).

- [ ] **Step 2: Add styles for the pill row**

In the same file, inside the `static styles = css\`...\`` block, append these rules (after the existing `input:focus { border-color: var(--accent); }` line, before the closing backtick):

```css
    .range-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .range-label { font-size: var(--font-sm); color: var(--text-muted); flex-shrink: 0; }
    .pills { display: flex; gap: 2px; background: var(--bg); border-radius: var(--radius-md); padding: 3px; }
    .pill {
      padding: 4px 10px; font-size: var(--font-sm); font-weight: 500;
      color: var(--text-muted); border-radius: 6px; cursor: pointer;
      border: none; background: none; font-family: inherit; transition: all 0.15s;
    }
    .pill.active { background: var(--accent); color: var(--accent-fg, #fff); }
    .pill:hover:not(.active) { color: var(--text); }
```

- [ ] **Step 3: Render the pill row in Query mode + dispatch `range-change`**

Replace the entire `render()` method with:

```ts
  render() {
    return html`
      <div class="filter-row">
        <input .value=${this.sid} placeholder=${t('inspectorFilterSid')}
          @input=${(e: Event) => { this.sid = (e.target as HTMLInputElement).value; this._fireChange(); }}>
      </div>
      ${this.mode === 'query' ? html`
        <div class="range-row">
          <span class="range-label">${t('inspectorTime')}</span>
          <div class="pills">
            ${RANGES.map(r => html`
              <button class="pill ${this.range === r.m ? 'active' : ''}"
                @click=${() => this.dispatchEvent(new CustomEvent('range-change', { detail: r.m, bubbles: true, composed: true }))}>
                ${r.label}
              </button>
            `)}
            <button class="pill ${this.range === 'all' ? 'active' : ''}"
              @click=${() => this.dispatchEvent(new CustomEvent('range-change', { detail: 'all', bubbles: true, composed: true }))}>
              ${t('inspectorRangeAll')}
            </button>
          </div>
        </div>
      ` : ''}
    `;
  }
```

Notes:
- The time row renders **only** when `mode === 'query'`. In Live mode it is absent, so `range-change` never fires there (the live WebSocket has no time param).
- `range-change` dispatches immediately on click (no debounce) — discrete selection, unlike the debounced `sid` text input.

- [ ] **Step 4: Typecheck**

Run: `cd web-src && npm run typecheck`
Expected: PASS. If you see "'RangeValue' is declared but never used" or similar, re-check that the `@property() range: RangeValue` line from Step 1 is present.

- [ ] **Step 5: Commit**

```bash
git add web-src/src/components/inspector/filter-bar.ts
git commit -m "feat(inspector): add time-range preset pills to filter bar"
```

---

### Task 3: Wire range state + reduce page size in the page

**Files:**
- Modify: `web-src/src/pages/inspector-page.ts`

- [ ] **Step 1: Add `_range` state**

In `web-src/src/pages/inspector-page.ts`, find this state declaration:

```ts
  @state() private _sid = '';
```

Add a new line immediately **after** it:

```ts
  @state() private _sid = '';
  @state() private _range: 'all' | number = 'all';
```

- [ ] **Step 2: Send `start` and change page size to 50**

In the `_fetchRecords` method, find this query block:

```ts
      const resp = await this._client.query({
        client_id: this._getClientId(),
        type: this._protocol,
        sid: this._sid || undefined,
        before,
        limit: 100,
      });
```

Replace it with:

```ts
      const resp = await this._client.query({
        client_id: this._getClientId(),
        type: this._protocol,
        sid: this._sid || undefined,
        start: this._range !== 'all' ? Math.floor(Date.now() / 1000) - (this._range as number) * 60 : undefined,
        before,
        limit: 50,
      });
```

Then, a few lines down in the same method, find:

```ts
        this._hasMore = list.length >= 100;
```

Replace with:

```ts
        this._hasMore = list.length >= 50;
```

(Both sites must change together: `hasMore` gates the infinite-scroll sentinel, so a mismatch would either stop loading early or never stop.)

- [ ] **Step 3: Add the `_onRangeChange` handler**

Add this method to the class (place it right after the existing `_onFilterChange` method for locality):

```ts
  private _onRangeChange(e: CustomEvent) {
    this._range = e.detail as 'all' | number;
    this._selectedIndex = -1;
    // Mirror the protocol/sid handlers: reset cursor + refetch.
    // range-change only fires in query mode (the time row is query-only),
    // so no live-mode branch is needed.
    this._records = [];
    this._hasMore = true;
    this._cursor = null;
    this._fetchRecords();
  }
```

- [ ] **Step 4: Bind `mode`, `range`, and the `range-change` event to the filter bar**

In the `render()` method, find this element:

```ts
          <inspector-filter-bar
            .sid=${this._sid}
            @filter-change=${this._onFilterChange}>
          </inspector-filter-bar>
```

Replace it with:

```ts
          <inspector-filter-bar
            .sid=${this._sid}
            .mode=${this._mode}
            .range=${this._range}
            @filter-change=${this._onFilterChange}
            @range-change=${this._onRangeChange}>
          </inspector-filter-bar>
```

- [ ] **Step 5: Typecheck**

Run: `cd web-src && npm run typecheck`
Expected: PASS. If it reports `_onRangeChange` unused, re-check Step 4 wired the `@range-change` handler.

- [ ] **Step 6: Commit**

```bash
git add web-src/src/pages/inspector-page.ts
git commit -m "feat(inspector): apply time-range filter and reduce page size to 50"
```

---

### Task 4: Build and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build the embedded web bundle**

Run: `make web` (from repo root)
Expected: completes without error and updates `web/`. (If the stamp says "up to date" and you want to force a rebuild, run `make web-force`.)

- [ ] **Step 2: Manual checks in the browser**

Run `./wisper` (after `go build -o wisper .`), open the UI, configure the inspector URL in Settings, then on a tunnel's Traffic Inspection page in **Query** mode, verify:

1. The time row shows pills `5m 15m 1h 6h 24h All`, with **`All` active by default** and the list loads as before.
2. Open devtools Network. Clicking **`All`** → request to `/api/records/query` has **no `start` param**.
3. Clicking **`1h`** → the request includes `start=<unixsec>` where the value ≈ `now - 3600`. The list refreshes.
4. Switching to **Live** mode → the time pill row **disappears**.
5. Back in Query mode with `1h` selected: scrolling to the bottom triggers another `/api/records/query` request carrying both `start` (same window) and `before` (the cursor) — i.e. infinite scroll still paginates within the window.
6. The first response returns at most 50 rows; the sentinel still offers "load more".

- [ ] **Step 3: Go build (sanity — no Go files changed, but the binary embeds web/)**

Run: `go build -o wisper .`
Expected: builds cleanly (embeds the freshly-built `web/`).

---

## Self-Review

**Spec coverage:**
- Preset pill row 5m/15m/1h/6h/24h/All → Task 2 Step 3 (RANGES + All button). ✓
- Default `All`, no `start` sent → Task 3 Step 2 (`start: ... : undefined`) + Task 4 check 2. ✓
- Hidden in Live mode → Task 2 Step 3 (`mode === 'query'` guard) + Task 4 check 4. ✓
- `start = now - rangeSec`, no `end` → Task 3 Step 2. ✓
- Reset cursor + refetch on range change → Task 3 Step 3. ✓
- `start` held across pagination → Task 3 Step 2 recomputes from constant `_range`; `before` advances separately. ✓
- Page size 100→50 at both sites → Task 3 Step 2. ✓
- i18n keys → Task 1. ✓
- Verification: typecheck + make web + manual → Task 4. ✓

**Placeholder scan:** None — every step contains concrete code or an exact command with expected output.

**Type consistency:** `range`/`_range` typed `'all' | number` in `filter-bar.ts` (`RangeValue`) and `inspector-page.ts`; `range-change` `detail` is `RangeValue`, cast consistently in `_onRangeChange`. `mode` typed `'query' | 'live'` in both files. `start`/`limit` match `InspectorApiClient.query()`'s existing signature (no API client change). ✓
