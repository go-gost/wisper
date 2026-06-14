# Inspector Traffic Inspection — Integration Design

**Date**: 2026-06-12
**Status**: Design approved, pending implementation
**Prototype**: `.superpowers/brainstorm/3932168-1781253357/content/inspector-prototype.html`

## Context

Wisper manages GOST tunnels but provides no visibility into the traffic flowing through them. The go-gost/inspector module already provides a full traffic observability stack (MongoDB query + Redis Pub/Sub live streaming) with a React SPA frontend. Rather than reimplementing this backend, wisper will integrate with an existing inspector instance as a pure frontend consumer — the inspector API URL is configured in settings, and wisper's Lit UI provides a native traffic inspection experience.

**Key constraint**: No Go backend changes for inspector data. Wisper's Go backend only needs to persist/return the inspector URL setting. All inspector API calls happen directly from the browser.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI placement | Dedicated route per tunnel/entrypoint | Full inspector needs full screen; inline would be too cramped |
| Feature scope | Full inspector (Query + Live, 4 protocols) | All inspector features are useful; no reason to subset |
| Backend integration | Browser → inspector API directly | Avoids adding MongoDB/Redis deps to wisper; inspector runs independently |
| Feature gating | Settings-based (inspectorUrl non-empty → visible) | Clean on/off; no UI clutter when not configured |

## Routes

```
/tunnel/:type/:id/inspector       → inspector-page  (tunnel context)
/entrypoint/:type/:id/inspector   → inspector-page  (entrypoint context)
```

Routes are statically registered. The `inspector-page` reads `settings.inspectorUrl` reactively — if empty, it shows an "Inspector not configured" empty state.

**Context resolution**: The page extracts `type` and `id` from route params. For tunnels, `id` is the tunnel UUID used as the `client_id` filter. For entrypoints, the page looks up the entrypoint from `entrypoint-store` to get its parent tunnel ID, which becomes the `client_id`. The back button label and app bar title are derived from the tunnel/entrypoint name, looked up from the respective store.

## Component Architecture

### New files

```
web-src/src/pages/inspector-page.ts          — Page shell: app-scaffold, mode toggle, protocol tabs, filter bar, record list
web-src/src/components/inspector/
  record-list.ts      — Scrollable record rows, infinite scroll (query) or prepend-stream (live)
  record-detail.ts    — Expandable detail panel: headers, body with text/hex/json tabs
  filter-bar.ts       — Tunnel ID (pre-filled, readonly), service, SID, time range inputs
  protocol-tabs.ts    — HTTP / WebSocket / TLS / DNS tab bar
  mode-toggle.ts      — Query / Live segmented toggle
  body-viewer.ts      — Request/response body renderer: text, hex dump, JSON pretty-print, copy
  live-indicator.ts   — Green pulsing dot + record counter + stop/reconnect/clear controls
  empty-state.ts      — "No records" / "Inspector not configured" states
web-src/src/api/inspector.ts                 — InspectorApiClient: query(), tail(), liveness(); base URL from settings
```

### Modified files

| File | Change |
|------|--------|
| `web-src/src/router/routes.ts` | Add `/tunnel/:type/:id/inspector` and `/entrypoint/:type/:id/inspector` routes |
| `web-src/src/pages/tunnel-detail-page.ts` | Add "Traffic Inspection" button below stats grid (conditional on `inspectorUrl`) |
| `web-src/src/pages/entrypoint-detail-page.ts` | Same inspector entry button |
| `web-src/src/pages/settings-page.ts` | Add "Inspector" section with URL input + connection status |
| `web-src/src/store/settings-store.ts` | Add `inspectorUrl` field, persists through load/update cycle |
| `web-src/src/api/types.ts` | Add `InspectorRecord`, `InspectorQueryResponse`, protocol-specific sub-types |
| `web-src/src/api/backend.ts` | Add `inspector_url` to `AppSettings` type mapping |
| `web-src/src/i18n/en.ts` | Add inspector strings (~8 keys) |
| `web-src/src/i18n/zh.ts` | Add inspector strings (~8 keys) |
| `config/config.go` | Add `InspectorURL string` to `Settings` struct |
| `api/config_handler.go` | Include `inspector_url` in config GET/PUT responses |

### Inspector entry button (on tunnel/entrypoint detail)

Placed below the stats grid, above the Edit button. Styled as a card-like banner with a search icon, "Traffic Inspection" title, subtitle showing protocol types, and a chevron. Only rendered when `settings.inspectorUrl` is non-empty.

```
┌─────────────────────────────────────┐
│ 🔍  Traffic Inspection          →   │
│     View HTTP / WS / TLS / DNS      │
└─────────────────────────────────────┘
```

### Inspector page structure

```
<app-scaffold>
  appBar: ← Tunnel name    "Traffic"    [tunnel-id chip]
  body:
    ┌─ Mode Toggle: [Query | Live] ─┐
    ├─ Protocol Tabs: HTTP WS TLS DNS ─┤
    ├─ Filter Bar (tunnel_id pre-filled, readonly) ─┤
    ├─ Record List (scrollable) ─┤
    └─ Record Detail Panel (expandable) ─┤
```

## Data Flow

### Query mode (historical)

```
User opens inspector page
  → mounted() reads settings.inspectorUrl
  → constructs: GET {inspectorUrl}/api/records/query?client_id={tunnelId}&type={protocol}&limit=100
  → renders record rows
  → infinite scroll: IntersectionObserver fires → fetch with `before` cursor → append rows
  → click row → expand detail panel → fetch request/response body if needed
```

### Live mode (real-time)

```
User toggles to Live
  → open WebSocket: ws://{inspectorUrl}/api/records/tail?client_id={tunnelId}&type={protocol}
  → each message = HandlerRecorderObject → prepend to list (cap 200)
  → connection status: green pulsing dot when open, red when closed
  → auto-reconnect: exponential backoff 1s → 2s → 4s → … → 30s max
  → Stop button: close WS, freeze list
  → Clear button: empty list, keep WS open
  → switching protocol tab or mode → close old WS, open new
```

### CORS note

The browser makes cross-origin requests to the inspector API. The inspector's Gin middleware already sets `Access-Control-Allow-Origin: *` (confirmed in `inspector/pkg/api/api.go`), so no CORS issues are expected. If the user's inspector deployment adds auth, they need to configure CORS to allow the wisper origin.

## Settings Page — Inspector Section

```
┌─ Inspector ──────────────────────────┐
│ Configure inspector API URL.          │
│                                       │
│ Inspector API URL                     │
│ ┌───────────────────────────────────┐ │
│ │ http://inspector.local:8000       │ │
│ └───────────────────────────────────┘ │
│ Leave empty to disable.               │
│                                       │
│ Connection Status                     │
│ ● Connected                      Test │
└───────────────────────────────────────┘
```

- **URL field**: Text input, placeholder `e.g. http://inspector.local:8000`
- **Status indicator**: Calls `GET {url}/liveness` on input change (debounced 500ms). Shows green "Connected" or red "Unreachable"
- **Test button**: Manual re-check

## Go Backend Changes (minimal — config persistence only)

1. **`config/config.go`**: Add `InspectorURL string` to `Settings` struct
2. **`api/config_handler.go`**: Read/write `inspector_url` from/to `Settings.InspectorURL`
3. **`deepCopyConfig`**: Already copies `Settings` as a whole struct, no change needed

No new Go dependencies. No MongoDB or Redis client in wisper.

**AppSettings TypeScript update** (`web-src/src/api/types.ts`): Add `inspector_url?: string` field. The `GoBackend.getConfig()` / `updateConfig()` methods include it in the JSON round-trip. The `settings-store` adds `inspectorUrl` with default `''` (empty = disabled).

## API Types (TypeScript)

```typescript
// From inspector API — matches HandlerRecorderObject
interface InspectorRecord {
  node?: string;
  service: string;
  network: string;
  remote: string;
  local: string;
  host: string;
  dst: string;
  proto?: string;
  clientIP: string;
  clientID?: string;
  http?: HttpRecord;
  websocket?: WsRecord;
  tls?: TlsRecord;
  dns?: DnsRecord;
  route?: string;
  inputBytes: number;
  outputBytes: number;
  redirect?: string;
  err?: string;
  sid: string;
  duration: number;  // nanoseconds
  time: string;       // ISO 8601
}

interface HttpRecord {
  host: string;
  method: string;
  proto: string;
  scheme: string;
  uri: string;
  statusCode: number;
  request: { header: string; body: string };   // body is base64-encoded bytes
  response: { header: string; body: string };  // body is base64-encoded bytes
}

// WsRecord, TlsRecord, DnsRecord similarly...
// Note: body/payload/clientHello/serverHello fields are base64-encoded on the wire.
// The body-viewer component decodes them client-side for Hex/Text/JSON display.

interface InspectorQueryResponse {
  code: number;
  data: {
    list: InspectorRecord[];
    before?: string;  // cursor for prev page
    after?: string;   // cursor for next page
  };
  msg: string;
  error?: string;
}
```

## i18n Keys

```typescript
// en.ts additions
'inspector.title': 'Traffic Inspection',
'inspector.desc': 'View HTTP / WebSocket / TLS / DNS records',
'inspector.notConfigured': 'Inspector not configured',
'inspector.notConfiguredDesc': 'Set the inspector API URL in Settings to enable traffic inspection.',
'inspector.settingsLabel': 'Inspector API URL',
'inspector.settingsDesc': 'Traffic inspection service URL. When configured, a "Traffic Inspection" button appears on tunnel detail pages.',
'inspector.connected': 'Connected',
'inspector.unreachable': 'Unreachable',
'inspector.test': 'Test',
'inspector.query': 'Query',
'inspector.live': 'Live',
'inspector.noRecords': 'No records found',
'inspector.recordsCount': '{count} records',
```

## Verification

1. **Settings persistence**: Set inspector URL in settings → reload page → URL still present
2. **Conditional display**: Empty URL → no inspection button on detail pages; set URL → button appears
3. **Navigation**: Click "Traffic Inspection" → navigates to `/tunnel/:type/:id/inspector`
4. **Query mode**: Select HTTP tab → records load from inspector API; scroll → more load via cursor
5. **Protocol switching**: Click WS/TLS/DNS tabs → records re-fetch with type filter
6. **Live mode**: Toggle to Live → WebSocket connects → records stream in real-time → Stop/Clear work
7. **Record detail**: Click a record → detail panel expands → body viewer tabs (Text/Hex/JSON) work
8. **Error handling**: Inspector unreachable → show error state, not blank page
9. **Theme**: Inspector page respects dark/light theme
10. **Empty state**: No inspector URL → "Not configured" message with link to settings
11. **Existing functionality**: Tunnel CRUD, stats, entrypoints all work unchanged
12. **Go tests**: `go test ./...` passes (no new logic, just config field plumbing)
