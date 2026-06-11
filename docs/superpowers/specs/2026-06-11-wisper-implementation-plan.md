# Wisper UI Redesign — Implementation Plan

## Context

The Wisper Lit web UI (rewritten from Flutter in commit `0856492`) needs a complete visual + interaction redesign. The Go backend API is stable and requires **zero changes**. All work is in `web-src/` only.

The design spec is at `docs/superpowers/specs/2026-06-11-wisper-ui-redesign.md`. An interactive prototype lives at `.superpowers/brainstorm/2069641-1781075506/content/interactive-prototype.html`.

## Implementation Phases

### Phase 1: Design System Foundation

Create the CSS design token file and SVG icon utility. These are shared dependencies for all other work.

**Files to create:**
- `web-src/src/styles/theme.css` — All CSS custom properties for light/dark themes. Single source of truth for colors, spacing, radius, typography, shadows. Uses `:root` and `:root.dark` selectors.
- `web-src/src/utils/icons.ts` — Single `icon(name: string): TemplateResult` function returning SVG templates for all icons (`star`, `star-filled`, `settings`, `trash`, `copy`, `chevron-left`, `chevron-right`, `folder`, `globe`, `link`, `broadcast`).

**Files to modify:**
- `web-src/src/main.ts` — Import `theme.css` instead of `global.css`
- `web-src/src/app.ts` — Remove `_injectThemeStyles()` (no longer needed; we inject theme CSS via `<style>` in `index.html` referencing `theme.css` content, or import directly in components). Keep theme CSS injection but use the new token set.

**Files to delete:**
- `web-src/src/styles/global.css`
- `web-src/src/styles/theme.ts`

**Verification:** `make web` succeeds. Open in browser: toggle theme, verify all CSS variables resolve correctly.

### Phase 2: Core Components

Rewrite the shared UI components with the new design language.

**Files to create/replace:**

- `web-src/src/components/app-scaffold.ts` — Layout wrapper. Sticky appbar at top, scrollable content, FAB slot. Max-width centering. Simpler than current — no complex slot management.
- `web-src/src/components/nav-tabs.ts` — Centered pill tabs. Accepts `tabs: string[]`, `activeIndex: number`. Fires `tab-change` event. No favorites toggle (moved to appbar).
- `web-src/src/components/tunnel-card.ts` — Rewrite from scratch. Render function only (no Lit component — or keep as simple Lit element). Layout: dot · name+meta · traffic column · chevron. Supports `stopped` class for reduced opacity. Conditionally shows speed column for running items.
- `web-src/src/components/spinner.ts` — Minor style tweaks to match new color tokens.

**Files to delete:**
- `web-src/src/components/delete-dialog.ts` (inline in pages)
- `web-src/src/components/copyable-text.ts` (inline in pages)
- `web-src/src/components/stats-row.ts` (inline in detail page stats grid)
- `web-src/src/components/form-fields/file-form-fields.ts`
- `web-src/src/components/form-fields/http-form-fields.ts`
- `web-src/src/components/form-fields/entrypoint-form-fields.ts`

**Verification:** `make web` succeeds. Components render in isolation (use dev server to check).

### Phase 3: Root + Router

Update app root and route definitions.

**Files to modify:**
- `web-src/src/app.ts` — Simplify `WisperApp`:
  - Keep: router setup, settings loading, stats polling lifecycle
  - Remove: `_injectThemeStyles()`
  - Add: theme CSS import or injection via external `<link>` or inline `<style>` in index.html
  - Pass host element explicitly to router
- `web-src/src/router/routes.ts` — No route pattern changes. Ensure lazy imports still work. Update page component tag names if any changed.
- `web-src/index.html` — Add theme style injection for Shadow DOM penetration (or solve differently — load theme.css into light DOM and use `:host` selectors in components).

**Verification:** App boots without errors. Router navigates to all 6 routes. Theme toggle works. Stats polling runs.

### Phase 4: Pages — Home, Type Select, Settings

**Files to replace:**

- `web-src/src/pages/home-page.ts` — Complete rewrite:
  - Centered Tunnels/Entrypoints tab bar
  - Favorites star in appbar
  - List rendering with inline expand
  - FAB for create (context-aware: opens tunnel or entrypoint type select)
  - Empty state when no items
  - Subscribes to tunnel-store + entrypoint-store + stats-store
  - State: `tabIndex`, `showFavorites`, `expandedRowId`

- `web-src/src/pages/tunnel-type-select-page.ts` — Update icons to SVG, restructure card layout per prototype

- `web-src/src/pages/tunnel-detail-page.ts` — Complete rewrite split into view/edit/create modes:
  - View mode: status banner, info card (ordered fields per spec), stats grid, Edit button
  - Edit mode: form with Save, Danger Zone
  - Create mode: form with type locked, Save creates new
  - Field ordering as per spec for each tunnel type
  - Inline delete confirmation dialog (overlay + modal)

- `web-src/src/pages/entrypoint-type-select-page.ts` — Update icons to SVG

- `web-src/src/pages/entrypoint-detail-page.ts` — Complete rewrite:
  - View: Type → Tunnel ID → Name → Bind Address → Entrypoint
  - Edit: Tunnel ID readonly, Name + Bind Address editable
  - Create: Tunnel ID as text input (user pastes UUID)
  - No own-ID field (entrypoints have no separate ID in detail view)

- `web-src/src/pages/settings-page.ts` — Complete rewrite:
  - App info header (logo + name + version)
  - Server Configuration: inputs + TLS toggle + Save button
  - Preferences: Language + Theme cycling rows with chevrons

**Verification:** Navigate all routes. Create/edit/start/stop/delete for both tunnels and entrypoints. Verify all form fields render correctly per type.

### Phase 5: Integration & Polish

1. **Update `web-src/src/i18n/en.ts` and `zh.ts`** — Add/update translation keys for any new UI strings.
2. **Update `web-src/src/store/`** — No structural changes needed (API contract unchanged). Verify favorite toggle, stats application works with new components.
3. **`make web`** — Build production bundle.
4. **`go build -o wisper .`** — Embed web/ into Go binary.
5. **`go test ./api/ -v`** — All 21 tests pass.
6. **`go vet ./...`** — Clean.
7. **Manual smoke test** — Run `./wisper`, navigate all screens, toggle theme, create/edit/delete items, verify stats update.

## Key Design Decisions

1. **Theme CSS in light DOM, not per-component.** The prototype showed this works: a global `<style>` element with `:root` / `:root.dark` blocks penetrates Shadow DOM when components use `var()` references. No per-`<style>` injection needed per component.

2. **Form fields inline, not separate components.** File/HTTP/Entrypoint form fields are simple enough to render inline in their page components. This removes 3 files and simplifies data flow (no `field-change` event bubbling).

3. **Delete dialog inline in pages.** Both detail pages render their own delete confirmation overlay. No separate component needed. Keeps deletion logic co-located with the page that triggers it.

4. **SVG icons as a utility function.** `icon('star')` returns a `TemplateResult` (Lit `html` tagged template). Not a component — just a function. Lightweight, tree-shakeable.

## Files Summary

| Action | Count | Files |
|--------|-------|-------|
| Create | 2 | `styles/theme.css`, `utils/icons.ts` |
| Rewrite | 8 | `app.ts`, `app-scaffold.ts`, `nav-tabs.ts`, `tunnel-card.ts`, `home-page.ts`, `tunnel-detail-page.ts`, `entrypoint-detail-page.ts`, `settings-page.ts` |
| Modify | 4 | `main.ts`, `routes.ts`, `en.ts`, `zh.ts` |
| Delete | 9 | `global.css`, `theme.ts`, `delete-dialog.ts`, `copyable-text.ts`, `stats-row.ts`, `file-form-fields.ts`, `http-form-fields.ts`, `entrypoint-form-fields.ts`, `spinner.ts` (tweak or delete) |
| No change | 5 | `backend.ts`, `types.ts`, `tunnel-store.ts`, `entrypoint-store.ts`, `stats-store.ts`, `settings-store.ts`, `format.ts`, `clipboard.ts`, `tunnel-type-select-page.ts`, `entrypoint-type-select-page.ts` (minor icon updates) |

## Verification

```bash
# Build web UI
make web

# Build Go binary
go build -o wisper .

# Run API tests
go test ./api/ -v

# Go vet
go vet ./...

# Manual: start server and verify all interactions
./wisper
```
