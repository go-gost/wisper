# Plan: Flutter → Lit Web Components Rewrite

## Context

Wisper's Flutter web UI compiles to ~3.2MB of JavaScript and requires a multi-hundred-second build pipeline with complex post-processing (CanvasKit stripping, asset exclusion, symbol cleanup). A pure web implementation using **Lit (Web Components) + Vite + TypeScript** reduces output size by **~150x** (to ~20KB gzipped), builds in <5s, and enables seamless wrapping into Electron/Tauri/Capacitor without framework-specific bridges.

This plan replaces the entire Flutter web frontend while keeping the Go backend **unchanged in structure** — only comments need updating.

## Approach

**Big bang replacement** — the new Lit app is developed in a separate `web-src/` directory, built with Vite into the existing `web/` output directory. Once verified, the `flutter/` directory is deleted. Both build pipelines can coexist during development for comparison testing.

## Files to Create

### `web-src/` — New Lit Web Application Source

```
web-src/
  index.html                         # Bootstrap HTML, loads /src/main.ts
  package.json                       # Dependencies + scripts
  tsconfig.json                      # TypeScript config (strict, decorators)
  vite.config.ts                     # Vite: output to ../web/, base /

  src/
    main.ts                          # Entry: setup locale, theme, router
    app.ts                           # Root LitElement: theme provider, router outlet

    api/
      backend.ts                     # GoBackend class — same 17-method API surface
      types.ts                       # Tunnel, Entrypoint, StatsSnapshot, AppSettings, enums

    store/
      tunnel-store.ts                # Module-level store: list, CRUD, subscribe/notify
      entrypoint-store.ts            # Module-level store: list, CRUD, subscribe/notify  
      settings-store.ts              # AppSettings state, load/save via API
      stats-store.ts                 # 1s polling interval, subscribe/notify

    router/
      routes.ts                      # 6 route definitions + page mapping

    components/
      app-scaffold.ts                # Centered 800px layout wrapper
      nav-tabs.ts                    # Pill-style tab bar (Tunnel | Entrypoint)
      tunnel-card.ts                 # Tunnel/entrypoint summary card w/ status dot, stats
      stats-row.ts                   # Icon + value + rate display row
      copyable-text.ts               # Monospace text + copy button + tooltip
      delete-dialog.ts               # Confirmation dialog
      selector-field.ts              # Cycling option selector (theme/language)
      form-fields/                   # Type-specific form fields
        file-form-fields.ts          # Directory, basic auth, file upload toggles
        http-form-fields.ts          # Rewrite host, enable TLS toggles
        entrypoint-form-fields.ts    # Keepalive, TTL fields

    pages/
      home-page.ts                   # Tabbed list view + FAB
      tunnel-type-select-page.ts     # 4 tunnel type cards
      tunnel-detail-page.ts          # View/edit/create form + stats
      entrypoint-type-select-page.ts # 2 entrypoint type cards
      entrypoint-detail-page.ts      # View/edit/create form + stats
      settings-page.ts               # Server/theme/language settings

    i18n/
      en.ts                          # English string map (~55 keys)
      zh.ts                          # Chinese string map (~55 keys)
      i18n.ts                        # t(key, params?) function + setLocale()

    styles/
      theme.ts                       # CSS custom properties for light/dark themes
      global.css                     # Reset, base typography, transitions

    utils/
      format.ts                      # formatBytes, formatRate
      clipboard.ts                   # navigator.clipboard with execCommand fallback
```

## Architecture Decisions

### Component Model
Each page and widget is a **LitElement** using `@customElement()` for registration. Components use Lit's `ReactiveController` for lifecycle-aware data binding. Shadow DOM provides CSS isolation per component.

### Routing
Use **`@lit-labs/router`** (Lit's official router, ~2.4KB). Declarative pattern matching inside the root `<wisper-app>` component:

```
/                            → <home-page>
/tunnel/new                  → <tunnel-type-select-page>
/tunnel/:type/:id            → <tunnel-detail-page>
/entrypoint/new              → <entrypoint-type-select-page>
/entrypoint/:type/:id        → <entrypoint-detail-page>
/settings                    → <settings-page>
```

### State Management
**Module-level singleton stores with subscribe/notify pattern** — no extra dependencies:

```typescript
// Pattern for tunnel-store, entrypoint-store, stats-store, settings-store
let state: T[] = [];
const listeners = new Set<() => void>();
function subscribe(fn: () => void): () => void { ... }
function notify(): void { listeners.forEach(fn => fn()); }
async function refresh(): Promise<void> { /* fetch from API, then notify() */ }
```

Each Lit page component calls `subscribe(this.requestUpdate.bind(this))` in `connectedCallback()` and unsubscribes in `disconnectedCallback()`. No virtual DOM, no framework overhead.

### i18n
A `Map<string, Record<string, string>>` keyed by locale, accessed via `t('key', {param: 'value'})` function. Locale is stored in `settings-store` and persisted to the backend. On locale change, a custom event triggers all components to re-render via the store subscription.

### Theming
CSS custom properties defined on `:root` / `:root.dark`. A `ThemeController` (ReactiveController) sets/removes the `dark` class on `document.documentElement`. System preference uses `matchMedia('prefers-color-scheme: dark')`.

### API Client
`GoBackend` class in `src/api/backend.ts` mirrors the current Dart `GoBackend` class exactly — same 17 methods, same JSON serialization. Uses `fetch()` API (zero dependencies). Error handling via a custom `BackendError` class. When `_base` is empty, uses relative paths (same-origin embedded mode).

## Files to Modify

### Go Backend (comments-only changes)

1. **`web.go`** — Update comments: s/Flutter/web/g
2. **`api/server.go`** — Update CORS comment: s/Flutter/Lit web/g
3. **`CLAUDE.md`** — Replace all Flutter references with Lit/Vite/web-src

### Build System

4. **`Makefile`** — Replace `web` target:
   - Instead of `flutter build web`, run `cd web-src && npm ci && npx vite build`
   - Stamp-based conditional rebuild: check `web-src/src/**` and `package.json` instead of `flutter/lib/*.dart`
   - Remove Flutter-specific cleanup (CanvasKit, assets/backend, .symbols, NOTICES)
   - Keep the backup/restore pattern for `flutter/assets/backend/` until Flutter is fully removed
   
5. **`build.sh`** — For `web` platform:
   - Replace `flutter build web` with `cd web-src && npm ci && npx vite build`
   - For desktop platforms (linux/macos/windows): note that these are **temporarily broken** — they need a separate plan for Tauri/Electron wrapping. Add a warning comment.

## Files to Delete (after verification)

6. **`flutter/`** — Entire Flutter project directory
7. **`build.sh`** desktop section — Remove Flutter-specific bundle copy logic (keep Go cross-compile parts)
8. **`Makefile`** — Remove `flutter-linux/darwin/windows` targets

## Implementation Order

1. **Scaffold**: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
2. **Foundation**: `src/api/types.ts`, `src/api/backend.ts`, `src/i18n/`, `src/styles/`, `src/utils/`
3. **Stores**: `src/store/settings-store.ts`, `tunnel-store.ts`, `entrypoint-store.ts`, `stats-store.ts`
4. **Core components**: `app-scaffold.ts`, `nav-tabs.ts`
5. **Home page**: `home-page.ts` + `tunnel-card.ts` + `stats-row.ts` — verify list + stats polling works
6. **Detail pages**: `tunnel-detail-page.ts` + form fields — verify CRUD + start/stop works
7. **Other pages**: `tunnel-type-select-page.ts`, settings page, entrypoint pages
8. **Polish**: `copyable-text.ts`, `delete-dialog.ts`, error banners, snackbar notifications
9. **Build integration**: Update `Makefile`, `build.sh`, `CLAUDE.md`
10. **Cleanup**: Delete `flutter/`, run `go build` + `go test ./...` to verify

## Verification

### Build Verification
```bash
cd web-src && npm ci && npx vite build    # produces web/ output
ls web/index.html web/assets/*.js         # verify output exists
go build -o wisper .                      # embeds web/ correctly
```

### Runtime Verification
```bash
./wisper -addr :8900
```
1. Open `http://localhost:8900` — home page loads with tunnel/entrypoint tabs
2. Create a tunnel of each type (file, http, tcp, udp) — all work
3. Create an entrypoint of each type (tcp, udp) — both work
4. View tunnel/entrypoint details — stats display updates every second
5. Start/stop tunnels and entrypoints — status dot updates
6. Edit a tunnel — form values populate, save works
7. Delete a tunnel — confirmation dialog, item removed from list
8. Toggle favorites filter — list filters correctly
9. Open settings page — change language (en↔zh), theme (system/light/dark) — UI updates immediately
10. Change tunnel server/entrypoint domain — auto-restart triggers, list refreshes
11. Test on mobile viewport (375px) — responsive, no overflow
12. `go test ./api/ -v` — all API tests pass

### Size Check
```bash
du -sh web/
# Expected: <500KB uncompressed total (vs 3.2MB Flutter)
```

## Desktop/Mobile Wrapping Considerations

The architecture supports future wrapping:

| Wrapper | What it does | Wisper Lit app role |
|---------|-------------|---------------------|
| **Electron** | Chromium + Node.js | Load `index.html` in BrowserWindow, optionally spawn Go backend as child process |
| **Tauri** | Rust + system WebView | Load `index.html`, Go backend as sidecar binary |
| **Capacitor** | Native WebView shell | Copy `web/` into Capacitor `www/`, Go backend as native library or embedded server |

The key design choices that enable this:
- All API calls are relative paths (`/api/...`) — no hardcoded `localhost` URLs
- Lit Web Components are framework-agnostic — they run in any browser/WebView
- No Node.js-specific APIs in the web app itself
- The `GoBackend` class accepts an optional `baseUrl` parameter for non-embedded scenarios
- CSS custom properties for theming work everywhere

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| `@lit-labs/router` is experimental | Only 6 routes, API surface is small — easy to swap for a 50-line custom router if needed |
| Desktop/mobile wrapping deferred | Architecture is designed for it; the web app is the core deliverable; Tauri/Electron are thin wrappers that load the same `index.html` |
| Go tests depend on API, not Flutter | No risk — API tests use `httptest`, not the web UI |
| build.sh desktop targets broken | Keep Go cross-compile targets in Makefile; desktop wrapping is a separate follow-up task |
