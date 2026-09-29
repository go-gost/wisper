# Wisper Event History — Design

Date: 2026-09-29
Status: approved, pending spec review

## Problem

When a tunnel or entrypoint drops — especially a p2p path falling back to relay, direct-session churn, or a tun device / VPN teardown — the only record is `~/.config/wisper/logs/wisper.log` (JSON, 10 MB / 7 day rotation). The desktop app cannot show any of it, so diagnosing "when did it drop, and what happened around it" means reading rotated logs by hand.

## Goal

A bounded, persisted event history, surfaced in the UI:

- **Per-object history** on a sub-page of each tunnel and entrypoint detail page.
- **Global history** — host-level events and deletions — on its own sub-page reached from the settings page.

### Non-goals

- Mirroring the log into the UI (the logger-tee option; rejected — noisy, needs dedup).
- The direct session's own death reason (e.g. `io: read/write on closed pipe`). The *relay's* failure reason does become available, through a new `p2p.Status.RelayError` — see the dependency below. Everything else stays in the log.
- A merged cross-object timeline API.

## Dependency: a p2p `Status` change

This design cannot meet its own goal on today's `p2p.Status`. Measured on 2026-09-29 with a real `derper` on loopback (the probe kept at `tunnel/probe_events_test.go`, tag `p2ppoc`):

| Moment | `PeerTransports` | direct/derp | punch |
|---|---|---|---|
| relay up, no traffic, t=0–3 s | `peer=derp` | 0/1 | 0/0 |
| t=4 s (punch done) | `peer=direct` | 1/0 | 1/1 |
| **12 s after the derper was killed** | `peer=direct` — unchanged | 1/0 — unchanged | 1/1 — unchanged |
| 15 s after the relay came back | unchanged | unchanged | unchanged |

Two facts follow:

- **A relay outage is invisible to `Status`.** `PeerTransports` describes which *path* a peer rides, and a hole-punched session is independent of the DERP transport — so "relay dead, direct alive" reads as perfectly healthy. The only trace is a `derp dial ... connection refused` log line every 5 s. A snapshot diff can never see it, and this is the very failure ("p2p 断连") the feature exists for.
- **`PunchAttempts`/`PunchSuccess` are process-wide**, so they cannot attribute churn to a peer.

So the p2p library gains three things (its own plan: `p2p/docs/2026-09-29-p2p-relay-state-and-punch-counters-plan.md`), all additive:

- `Status.RelayConnected` / `Status.RelayError` — the relay transport's own liveness and last dial failure. The engine already tracks this (`e.client`, `e.dialErr`) and already redials every 5 s.
- `Status.PeerPunches map[string]PeerPunch` with `Attempts` / `Ups` / `Drops` per peer — where **`Drops` is the literal count of a live direct session ending**, taken at `detachSessionLocked`, the single choke point both the accept loop and the opening side route through.

`Drops` is what makes the 18 s churn observable at all: it is a counter, so it is immune to the sampling problem below, and it is per peer, so it is attributable. No consumer's `go.mod` changes for local work — `go.work` resolves the module from the tree; publishing the tag is the owner's separate step.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Event classes | Two: per-object, global | Avoids a cross-object aggregation/sort API; gives deletions and host-level events a home. |
| Storage | Both in `wisper.yaml` | The file is already a config **+ runtime state** mix (`stats`, `stats_baseline`, `closed`, `favorite`), and `SaveConfig` already rewrites it every second from the stats tick. Zero new read/write paths. |
| Retention | In-place caps: 100 per object, 200 global; oldest dropped | Constants, not configurable. |
| Recording rule | For the snapshot diff, record only **transitions**, never the first observation | Otherwise every object logs a row on startup and the list is noise. Consequence: the first row you see is a change, never "it started running". Explicit lifecycle records (below) are unaffected. |
| Capture | Diff of a per-tick snapshot + explicit lifecycle records | No new goroutine, no polling loop, no changes to the `Tunnel` interface. |
| Presentation | One dedicated sub-page per list, never inline | A 100- or 200-entry list is a page of its own; inline it would dominate the detail/settings pages it hangs off. |
| Page component | One `events-page`, `kind` ∈ `tunnel` / `entrypoint` / `global` | Mirrors `inspector-page`, which already serves both object kinds off one component; three routes, one page module. |
| Global entry point | A link row on the settings page → `/settings/events` | Host-level events are not the same class as the tunnel/entrypoint lists, and settings already owns the host-level config (server, p2p, log) they describe. |

## Event model

New package `event` (stdlib only), which owns the type and the runtime store:

```go
// event/event.go
type Event struct {
    Time    time.Time `yaml:"time" json:"time"`
    Level   string    `yaml:"level" json:"level"` // "info" | "warn" | "error"
    Message string    `yaml:"message" json:"message"`
}
```

Three fields are the floor: a per-object event knows its object implicitly, a global event names its subject in `Message` (e.g. `DERP relay: connect failed: ...`), and `Level` drives UI color and an "only failures" filter. No `kind` / `source` field — add one when a consumer needs to filter without reading text.

## Storage

Both classes persist in `wisper.yaml`, on the struct that already carries runtime state:

```go
// config/config.go
type Tunnel struct {
    ...
    Events []event.Event `yaml:"events,omitempty"` // per-object; shared by tunnels and entrypoints
}

type Config struct {
    Settings    *Settings
    Tunnels     []*Tunnel
    EntryPoints []*Tunnel
    Log         *xconfig.LogConfig
    Events      []event.Event `yaml:"events,omitempty"` // global
}
```

`EntryPoints` reuses `config.Tunnel`, so the per-object field covers entrypoints with no schema duplication.

**Required fix:** `deepCopyConfig` (config.go) shallow-clones with `clone := *t`. A `[]Event` field would leave the copy sharing the original's backing array, so two `Get()` copies could write over each other. Both the per-object slice and `Config.Events` must be explicitly cloned.

## Runtime store

`event` holds the live history; `config` imports it for the field type, so `event` must not import `config` (no cycle).

```go
func Record(id, level, format string, args ...any) // per-object, cap 100
func Global(level, format string, args ...any)     // cap 200
func List(id string) []Event
func ListGlobal() []Event
func Seed(id string, events []Event)               // replace-by-id
func SeedGlobal(events []Event)                    // replace-all
```

- A mutex-guarded `map[string][]Event` plus one global slice; both append and trim to the cap.
- Ordering: append-only, oldest first; the API reverses for display.
- `Seed` is replace-by-id and `SeedGlobal` replaces the whole list, so a config reload or a SIGINT/SIGTERM round-trip cannot duplicate history.

Wiring:

- `tunnel.SaveConfig` / `entrypoint.SaveConfig`: `cfg.Tunnels[i].Events = event.List(tun.ID())`, and one of them also sets `cfg.Events = event.ListGlobal()`. They run sequentially in the same stats tick, and `Get()` returns a copy, so the second write preserves the first's change.
- `config.Init`: after load, `event.SeedGlobal(cfg.Events)`.
- `tunnel.LoadConfig` / `entrypoint.LoadConfig`: `event.Seed(cfg.ID, cfg.Events)`.

Because `SaveConfig` already runs every second, an event is effectively persisted within one tick. Because seeding is keyed by object ID, history **survives both an app restart and a tunnel restart** (an update or a server-address change recreates the object with the same ID).

## Capture

### a. Lifecycle — explicit, few sites

| Site | Event |
|---|---|
| `api/tunnel_handler.go`, `api/entrypoint_handler.go` create/update/start/stop | per-object `info` |
| same handlers, delete | **global** `warn` (the object is gone) |
| `entrypoint.go` `restore`'s `fail` (start failure) | per-object `error` |
| `tunnel/entrypoint/tun.go` punch failure (currently `slog.Warn`) | per-object `warn` |
| `app.go` startup | global `info` "wisper started" |

No `started` event is emitted for objects restored at boot — that would flood the list on every launch.

### b. Disconnect / recovery — per-tick snapshot diff

The stats task is a **single reused instance** (`app.go` constructs `task.UpdateStats()` once; `runner.Exec` calls `Run` on it from a ticker), so it can hold last-seen state. No new goroutine.

- **Service-level.** For each tunnel and entrypoint, read `Status().State()`. On a `running → failed` or `failed → running` transition, record a per-object event; on entering `failed`, append the reason via the existing `tunnel.ServiceErrorMessage(t)`. The first observation seeds the state without recording.
- **p2p path-level.** Once per tick, take `tunnel.P2PHostStatus().PeerTransports` (peer key → `direct` / `punching` / `failed` / `derp` / …) and diff it against the previous snapshot. Each changed key is attributed to the object that owns it — the one whose allowlist `Peers` contains the key, or whose `Peer` equals it (p2p entrypoints) — and recorded there; a key with no owner goes to the global list. This catches **sustained** path changes: a peer settling onto the relay, or a punch that cannot work.
  - `punching` is deliberately *not* treated as a signal: the p2p docs note that a peer's re-announcements restart rounds often enough that the live state reads `punching` for a long time, so it says nothing about a drop. `failed` is sticky and meaningful; `punching` is not.
- **p2p churn-level.** Also once per tick, diff `PeerPunches`. A **delta in a peer's `Drops`** is a direct session that ended — recorded per object as a warning naming the peer. This is the churn signal, and it does not depend on sampling: a counter moves whether or not any single sample lands inside the gap. `Ups` moving without `Drops` is a first connection; `Attempts` moving with `Ups` flat is a peer that cannot punch (which `PeerTransports` already reports as `failed`).
- **Relay-level.** Diff `RelayConnected` / `RelayError`. `true → false` records a global `error`; `false → true` records a global `info` "relay restored". Measured against a real relay: the flip to `false` happens on the **next sample** after the relay dies, but `RelayError` stays empty until the engine's next 5-second redial attempt records `dialErr`. So the transition and the reason are **two separate changes** — the recorder quotes the message when there is one and emits a bare "relay disconnected" when there is not, rather than printing an empty reason. Without this diff the relay outage is invisible — see the dependency above.
- **Host-level.** `tunnel.P2PHostRunning()` transitions → global. A rejected derived STUN address (already logged in `p2p_host.go`) → global; the startup-time `p2p derp connect` failure is now covered by the relay-level diff, which also covers every later outage.

The status probes are side-effect-free by construction (`PeerTransports` uses `live()`, never `session()`), so polling cannot churn sessions. `PeerPunches` and the relay state read atomics and the engine's existing fields — no `session()` call anywhere.

### Diff purity

The comparisons are extracted as pure functions — `diffServiceState(prev, cur)`, `diffPeerTransports(prev, cur)`, `diffPunchDrops(prev, cur)` and `diffRelay(prev, seen, cur)` — so the part of this feature that is easy to get wrong is unit-testable without a running service. A `punching`-only change produces no event, and a first observation never does.

## API

- **Per-object:** no new endpoint. `tunnelResponse` gains `Events []eventResponse` (newest first, capped). Entrypoints reuse the same struct (`toTunnelResponse`), so a per-object events page reads history from the object it already fetches. `eventResponse` is `{time, level, message}`.
- **Global:** `GET /api/events` → `{"events":[...]}` and `DELETE /api/events` → clears the global list; the next stats tick persists the empty list through the existing `SaveConfig`. Registered in `api/server.go` next to the stats/config routes.

## UI

### Sub-pages

One new page module, `web-src/src/pages/events-page.ts`, serving all three lists off a `kind` property — the way `inspector-page` already serves both object kinds off `parentKind`. It renders the list body directly (time, level dot, message, newest first, empty state); there is no shared list component, since nothing else uses the rows.

| Route | `kind` | Data |
|---|---|---|
| `/tunnel/:type/:id/events` | `tunnel` | `GET /api/tunnels/{id}` |
| `/entrypoint/:type/:id/events` | `entrypoint` | `GET /api/entrypoints/{id}` |
| `/settings/events` | `global` | `GET /api/events`, plus a clear action calling `DELETE /api/events` behind a confirmation |

All three re-fetch on the settings' `stats_interval` while the page is mounted. The existing per-second stats poll carries only stats and status (`applyStats` in `stats-store.ts`), not events, so the page cannot read them out of the store — it fetches, and a low-frequency refresh is what keeps a churning p2p session visible without touching the poll's payload.

Routes are registered in `router/routes.ts` alongside the existing `peers` / `inspector` routes. The page follows `tunnel-peers-page`'s shape: `appBar` with back navigation, `app-scaffold` wrapper, and a fetch started in `connectedCallback` whose interval is cleared in `disconnectedCallback`.

### Entry points

- **Detail pages** (`tunnel-detail-page`, `entrypoint-detail-page`): a sub-page entry row that navigates to `…/events`, styled and placed like the existing peers entry row (tunnel-detail-page.ts:1087) and inspector entry row. The row's description can show the newest event or the count, so a drop is visible without opening the page.
- **Settings page** (`settings-page.ts`): a link row → `/settings/events`, in the page's existing links block.

### Supporting changes

- `i18n/en.ts` + `zh.ts`: ~7 keys (page titles for the three kinds, entry-row labels, empty state, clear/confirm, level names).
- `api/types.ts` + `api/backend.ts`: the `Event` type and `getEvents()` / `clearEvents()`.
- Row timestamps reuse the existing `formatRelativeTime` / `formatTimestamp` (`utils/format.ts`) — no new helper. The entry row reuses the existing `zap` icon; no new icon asset.

## Tests

- `event`: cap eviction, ordering, `Seed` / `SeedGlobal` idempotency.
- `diffServiceState` / `diffPeerTransports`: table-driven, including a first-observation-seeds case and an unattributed key.
- API: `GET /api/events` returns a seeded event; `DELETE` clears it — reusing `api_test.go`'s `setupTestServer`.
- UI: Playwright (`web-e2e/tests/events-page.spec.ts`), because this is new Lit markup and the repo's own reason for having the harness is that an unclosed `<div>` nests every following block — invisible to `tsc` and to the Go suite, visible only as layout. It asserts the entries reach the DOM newest-first with their level, that the detail page's entry row shows the newest event, and that the new card lines up with its neighbours. The fixture in `scripts/ui-test.sh` gained an `events:` list for the tunnel and one at the top level, so the seeded pages have history to render.
  - Note: in that fixture the running p2p host records events of its own (the relay address is deliberately unroutable, and the seeded tunnel's `direct: false` makes a peer session report `connected (disabled)`). The spec therefore takes the expected newest message from the API rather than hardcoding it — the claim being tested is "the hint is the newest event", not which event is newest.

## Limitations (accepted)

- **Gauges are sampled at the stats interval** (default 1 s, `settings.stats_interval`), so a gauge that changes and changes back inside one tick is invisible. This is why the churn signal is a **counter** (`PeerPunches.Drops`) rather than a state: a counter moves regardless of when the samples land. State-based catches — service `running ↔ failed`, peer transport settling, relay up/down — are all multi-second by nature (measured: the relay outage persisted 12 s+; a loopback punch settled in ~4 s), so sampling is not a limit for them.
- **The direct session's death reason is not captured.** `PeerPunches.Drops` counts the event; the error text (`io: read/write on closed pipe`) stays in the log. The relay's own failure reason *is* captured, via `RelayError`.
- **`punching` is not reported as a transition**, by design — it is a long-lived transient rather than a state change (see the capture section).
- **Deletes lose their per-object history** by construction; the deletion itself is recorded globally.
- **A relay outage with no p2p object running produces no event** — the relay state is read from the host, and `P2PHostRunning()` false already covers that case as a host-level event.

## File map

| File | Change |
|---|---|
| `event/event.go` | new: type, store, caps, `Seed` |
| `event/event_test.go` | new |
| `config/config.go` | `Tunnel.Events`, `Config.Events`, `deepCopyConfig` slice clones, `SeedGlobal` in `Init` |
| `tunnel/tunnel.go` | `SaveConfig` writes per-object events; `LoadConfig` seeds |
| `tunnel/entrypoint/entrypoint.go` | same, plus the start-failure record |
| `runner/task/stats.go` | snapshot diff, the pure diff functions, host-level transitions |
| `runner/task/diff.go` | the pure diffs (service state, peer transports, peer punches, relay) |
| `api/tunnel_handler.go`, `api/entrypoint_handler.go` | lifecycle records, `Events` in the responses |
| `api/event_handler.go` | new: `GET` / `DELETE /api/events` |
| `api/server.go` | route registration |
| `web-src/src/pages/events-page.ts` | new: the three lists, one component |
| `web-src/src/router/routes.ts` | three routes |
| `web-src/src/pages/settings-page.ts` | link row → `/settings/events` |
| `web-src/src/pages/tunnel-detail-page.ts`, `entrypoint-detail-page.ts` | sub-page entry row |
| `web-src/src/api/types.ts`, `api/backend.ts` | `Event` type + two methods |
| `web-src/src/i18n/en.ts`, `zh.ts` | strings |
| `tunnel/p2p_host.go` | one global record for a rejected derived STUN address |

The `p2p` module changes in its own repository, under its own plan; wisper only reads the new `Status` fields. No changes to `x`, `core`, `gost` or `plugin`. The `tunnel.Tunnel` interface is unchanged.
