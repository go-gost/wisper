# Inspector Time-Range Filtering & Page-Size Reduction

**Date:** 2026-06-13
**Status:** Approved
**Scope:** Frontend only (`web-src/`)

## Goal

1. Let users filter the inspector's historical (Query-mode) record list by a time window, to reduce the volume of data fetched and make recent traffic easier to scan.
2. Reduce the record-list page size from 100 to 50 to cut per-response payload.

## Background

The inspector is an external HTTP API (base URL stored in app settings as `inspector_url`). Wisper's Lit web app queries it for traffic records.

Two facts make this a frontend-only change:

- **Backend already supports time filtering.** `inspector/pkg/api/record.go` binds `start` and `end` as Unix-second timestamps (`time.Unix(req.Start, 0)`) and passes them into `service.RecordListOptions`.
- **The API client already forwards them.** `InspectorApiClient.query()` (`web-src/src/api/inspector.ts`) already accepts and sets `start`/`end` query params. They are simply never populated by the page today.

So the work is: add a UI control to choose a window, compute `start`, and pass it through — plus change the two `100` literals to `50`.

## Design

### Time-range selector (preset quick ranges)

A row of pill-style buttons in the existing filter bar (`web-src/src/components/inspector/filter-bar.ts`), placed alongside the Session ID input:

```
5m · 15m · 1h · 6h · 24h · All
```

- Reuses the pill styling already established by `protocol-tabs`.
- Wraps on narrow screens (the filter bar already uses `flex-wrap`).
- Default selection: **`All`** — equivalent to today's behavior (no `start` sent). The 50-item cap plus cursor pagination already bounds the first response, so the default stays least-surprising.
- The filter bar gains a `mode` property (`'query' | 'live'`). The time-range row **renders only when `mode === 'query'`**. In Live mode the time filter is meaningless (the tail WebSocket has no `start`/`end` params), so the row is hidden rather than shown-but-inert.

### Range state and wiring (`web-src/src/pages/inspector-page.ts`)

- New `_range` state: `'all'` or a number of minutes from the set `{5, 15, 60, 360, 1440}`. Default `'all'`.
- The filter bar emits a `range-change` event carrying the new selection; the page stores it in `_range`.
- When `_range !== 'all'`, `_fetchRecords()` adds `start: Math.floor(Date.now() / 1000) - rangeSec` to the query. **`end` is never sent** — meaning "from `start` up to now", which avoids a subtle bug where records newer than the page-load moment would be excluded on subsequent "load more" fetches.
- On any range change: reset `_records = []`, `_cursor = null`, `_hasMore = true`, then refetch — identical to the existing `_onProtocolChange` / `_onFilterChange` handlers.

### Pagination interaction

Cursor pagination uses the `before` param (the ID of the oldest loaded record). The `_range` selection stays constant across pages, so `start` is recomputed with the same window on every "load more" fetch. The backend intersects the cursor with the time window, so pagination naturally stops at the window's lower bound. No extra client-side time filtering is needed.

### Page-size reduction

In `_fetchRecords()` (`web-src/src/pages/inspector-page.ts`):

- `limit: 100` → `limit: 50`
- `this._hasMore = list.length >= 100` → `>= 50`

Both must change together: `hasMore` gates the infinite-scroll sentinel, so a mismatch would either stop loading early (threshold > page size) or never stop (threshold < page size).

### i18n (`web-src/src/i18n/en.ts`, `zh.ts`)

Add keys:

- `inspectorTime` — a small label for the row ("Time" / "时间").
- `inspectorRangeAll` — the "All" preset ("All" / "全部").

The duration presets (`5m`, `15m`, `1h`, `6h`, `24h`) are locale-neutral tokens and are reused as-is in both locales.

## Behavior Summary

| Aspect | Behavior |
|---|---|
| Default range | `All` — no `start` sent, identical to current behavior |
| Mode visibility | Time buttons visible only in Query mode; hidden in Live mode |
| Refetch triggers | Range / protocol / SID change → reset cursor + refetch |
| Pagination | `start` held constant across `before`-cursor pages |
| New page size | 50 records per page (load-more via infinite scroll) |

## Files Changed

| File | Change |
|---|---|
| `web-src/src/pages/inspector-page.ts` | `limit` 100→50 (2 sites); add `_range` state + handler; pass `start` + `mode` into filter bar/query |
| `web-src/src/components/inspector/filter-bar.ts` | Add time-range pill row; `mode` prop; `range-change` event |
| `web-src/src/i18n/en.ts` | `inspectorTime`, `inspectorRangeAll` |
| `web-src/src/i18n/zh.ts` | `inspectorTime`, `inspectorRangeAll` |

No changes to `web-src/src/api/inspector.ts` (already forwards `start`/`end`), no Go changes, no backend changes.

## Verification

- `tsc --noEmit` — required because `make web` (esbuild) does not type-check; a stray undefined-variable bug would otherwise ship silently.
- `make web` to produce the embedded `web/` bundle.
- Manual checks:
  - Switching a preset adds a `start=<unixsec>` query param; `All` sends none.
  - Infinite scroll still paginates with the `before` cursor under a fixed range.
  - Time row is absent in Live mode.
  - First page returns ≤50 rows; sentinel still triggers "load more".
