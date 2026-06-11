# Wisper UI Redesign — Design Specification

**Date:** 2026-06-11
**Prototype:** `.superpowers/brainstorm/2069641-1781075506/content/interactive-prototype.html`
**Scope:** Full visual and interaction redesign of Wisper web UI (Lit + TypeScript + Vite)

## Design Language

**Terminal/Industrial + Refined Minimalist fusion**, with dual light/dark theme support.

### Color System

| Token | Light | Dark |
|-------|-------|------|
| `--bg` | `#fafafa` | `#1a1a2e` |
| `--surface` | `#fff` | `#222240` |
| `--border` | `#e5e7eb` | `#3a3a5c` |
| `--border-subtle` | `#f3f4f6` | `#2a2a45` |
| `--text` | `#111827` | `#e8e8f0` |
| `--text-secondary` | `#6b7280` | `#a0a0b8` |
| `--text-muted` | `#9ca3af` | `#6e6e88` |
| `--green` / `--green-bg` / `--green-border` / `--green-text` | `#10b981` / `#ecfdf5` / `#d1fae5` / `#059669` | `#4ade80` / `#0d2818` / `#1a4a2a` / `#4ade80` |
| `--red` / `--red-bg` / `--red-border` / `--red-text` | `#ef4444` / `#fef2f2` / `#fecaca` / `#dc2626` | `#f87171` / `#2d1518` / `#4a2025` / `#f87171` |
| `--accent` / `--accent-fg` | `#374151` / `#fff` | `#818cf8` / `#fff` |

### Typography

- **Font:** System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- **Mono:** `SF Mono, Fira Code, Consolas, monospace` (IDs, endpoints, addresses)
- **Scale:** Appbar title 13px, tab 10px, list name 11px, meta 9px, form labels 8px uppercase, detail values 10px mono

### Icons

Material-style SVG line icons (Feather/Lucide aesthetic), 16px, `stroke-width: 2`, `stroke: currentColor`. No emoji icons. Key icons: `star`, `star-filled`, `settings`, `trash`, `copy`, `chevron-left`, `chevron-right`, `folder`, `globe`, `link`, `broadcast`.

### Radius Scale

`--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 8px`. Buttons and cards use rounded corners consistently.

## Information Architecture

### Pages

| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Tab-switched tunnel/entrypoint list with inline expand |
| Type Select | `/tunnel/new` or `/entrypoint/new` | Two-step creation: pick type first |
| Detail | `/tunnel/:type/:id` or `/entrypoint/:type/:id` | View mode with status banner, info card, live stats |
| Edit | `/tunnel/:type/:id?edit` or `/entrypoint/:type/:id?edit` | Full-page edit form |
| Settings | `/settings` | Server config, theme, language |

### Home Page

- **Tabs:** Centered "Tunnels" / "Entrypoints" pill toggle. No "All" tab.
- **Favorites filter:** Star icon in top-right appbar. Toggles show-favorites-only. Active star is filled amber.
- **List rows:** Status dot (green/red/gray) → Name + meta line → Traffic column (cumulative + rate) → Expand chevron.
- **No status badge** on rows — status conveyed by dot color only.
- **Inline expand:** Click chevron (→ rotates to ↓) to expand detail panel inline. Shows entrypoint URL (copyable), target address, error message if any, action buttons (Start/Stop/Edit/Delete).
- **FAB:** Bottom-right "+" button to create new item. Context-aware based on current tab.
- **Empty state:** When no items, show guidance text + create button.

### Detail Page

**Tunnel detail (view mode):**
```
Status banner (Running/Error/Stopped + Start/Stop action)
Info card:
  Type          HTTP Tunnel
  Target        localhost:3000
  Entrypoint    api-8f3a.gost.run  [copy]
  Host Rewrite  api.example.com    (if set)
  TLS           Enabled/Disabled   (HTTP only)
  Auth          Basic · admin      (if set)
  Upload        Enabled/Disabled   (File only)
  ID            uuid...  [copy]
Live Stats (4-box grid, running only):
  Current Conns | Total Conns | Download | Upload
[Edit] button at bottom
```

**Entrypoint detail (view mode):**
```
Type          TCP Entrypoint
Tunnel ID     uuid...  [copy]
Name          my-entrypoint
Bind Address  :8080
Entrypoint    8f3a.gost.run  [copy]
```

### Edit / Create Page

**Field ordering (consistent):**

Tunnel create/edit:
```
Type          (readonly)
Name          [input]
Target        [input]  (or "Bind Address" for entrypoints)
Hostname      [input]  (HTTP/File tunnels, optional)
Enable TLS    [toggle] (HTTP tunnel)
Auth section (HTTP/File tunnels):
  Username    [input]
  Password    [input]
File Upload   [toggle] (File tunnel)
Danger Zone — Delete button (edit only, not create)
```

Entrypoint create:
```
Type          (readonly, shows "TCP Entrypoint" or "UDP Entrypoint")
Tunnel ID     [input]  (free text, user pastes UUID)
Name          [input]
Bind Address  [input]
```

Entrypoint edit:
```
Type          (readonly)
Tunnel ID     (readonly — cannot be changed after creation)
Name          [input]
Bind Address  [input]
Danger Zone — Delete button
```

### Settings Page

- App info header: large logo + "Wisper" + version
- Server Configuration section: Tunnel Server input, Entrypoint Domain input, Skip TLS Verify toggle, Save Settings button
- Preferences section: Language (toggles English/中文), Theme (cycles System/Dark/Light)

## Interaction Model

- **Hybrid mode:** Inline expand for quick view/actions in the list; full-page push for editing.
- **No ⌘K command palette** (deferred).
- **Two-step creation:** Click "+" → type selection page → form page.
- **Snackbar notifications** for all mutations (Started, Stopped, Saved, Deleted, Copied).
- **Delete confirmation dialog** with overlay backdrop. Click backdrop or Cancel to dismiss.
- **All API calls use relative paths** (no baseUrl needed).
- **Favorites toggle** with optimistic update pattern (instant UI feedback, backend sync in background).

## Tech Stack

- **Lit 3.x** (Web Components) — retained from current codebase
- **TypeScript 5.7** (strict)
- **Vite 6** (build)
- **@lit-labs/router** (SPA routing, lazy-loaded pages)
- **Go backend** — zero changes required (API contract unchanged)

## Implementation Strategy

Retain existing store layer (`tunnel-store.ts`, `entrypoint-store.ts`, `settings-store.ts`, `stats-store.ts`), API client (`backend.ts`, `types.ts`), and router (`routes.ts`). Replace all visual components and pages with new design-system-aligned versions. Delete old unused components (`delete-dialog.ts`, `copyable-text.ts` — replaced by inline implementations).

### Files to Create/Replace

**Design system (new):**
- `web-src/src/styles/theme.css` — CSS custom properties for light/dark, replaces `theme.ts` + global.css
- `web-src/src/utils/icons.ts` — SVG icon factory function, shared across all components

**Components (rewrite):**
- `app-scaffold.ts` → redesigned layout shell
- `nav-tabs.ts` → centered pill tabs
- `tunnel-card.ts` → rewritten list row with traffic column
- `stats-row.ts` → stat display
- `spinner.ts` → keep, minor style tweaks
- `form-fields/` → replaced by inline form rendering in detail pages

**Pages (rewrite):**
- `app.ts` → simplified root, theme injection via CSS (not JS style injection)
- `home-page.ts` → tabbed list with inline expand
- `tunnel-type-select-page.ts` → Material SVG icons
- `tunnel-detail-page.ts` → redesigned view/edit/create with all form fields
- `entrypoint-type-select-page.ts` → Material SVG icons
- `entrypoint-detail-page.ts` → redesigned view/edit/create with Tunnel ID
- `settings-page.ts` → redesigned with sections

**Files to delete:**
- `components/delete-dialog.ts` (inline in pages)
- `components/copyable-text.ts` (inline in pages)
- `components/form-fields/file-form-fields.ts`
- `components/form-fields/http-form-fields.ts`
- `components/form-fields/entrypoint-form-fields.ts`
- `styles/theme.ts` (replaced by theme.css)
- `styles/global.css` (replaced by theme.css)

## Verification

1. `make web` — builds without errors
2. `go build -o wisper .` — Go binary embeds new web/
3. `./wisper` — loads without errors, serves all pages
4. `go test ./api/ -v` — all 21 API tests pass
5. Manual: navigate all routes, toggle theme, create/edit/start/stop/delete tunnels and entrypoints, verify stats polling
6. `go vet ./...` — clean
