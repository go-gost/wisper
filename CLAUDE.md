# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
# Build Go backend for current platform
go build -o wisper .

# Build all platforms (linux, darwin, windows) into dist/
make all

# Build Go backend for a specific target (from Makefile)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/linux-amd64/wisper .

# Build Flutter web UI for embedding (use make web, not flutter build directly)
make web

# Build Go + Flutter together for desktop (build.sh)
./build.sh linux       # Go binary → Flutter linux bundle
./build.sh macos       # Go binary → Flutter macOS .app bundle
./build.sh windows     # Go binary → Flutter Windows bundle

# Run the server (defaults to :8900)
./wisper
./wisper -addr :9000                    # custom port
./wisper -version                       # print version and exit

# Run Go tests
go test ./... -v
go test ./api/ -v -run TestListTunnels  # single test suite
```

## Architecture

Wisper is a **GOST tunnel manager** — a Go HTTP API server with an embedded Flutter web UI for creating and managing reverse proxy tunnels through the GOST network.

The project is a **single Go module** (`github.com/go-gost/wisper`, `go.mod` at root). The Flutter app lives under `flutter/` and is embedded into the Go binary via `//go:embed` in `web.go`.

### How the two halves connect

1. `flutter build web` outputs to `flutter/build/web/`
2. Copy to `web/` (or symlink) for `go:embed` to find
3. `web.go` embeds `web/*` and serves it as an SPA (non-file requests → `index.html`)
4. `api/server.go` registers API routes on `/api/*` and falls back to the web handler for everything else
5. Flutter's `GoBackend` Dart class uses relative URLs when `_base` is empty, so it works same-origin

### Go package layout

| Package | Purpose |
|---------|---------|
| `main` (`main.go`) | Entry point: parses flags, inits config, starts stats runner, starts HTTP server, graceful shutdown |
| `web.go` | Embeds Flutter web build and serves it with SPA fallback |
| `config/` | App settings + tunnel/entrypoint persistence to `~/.config/wisper/config.yml`. Thread-safe via `atomic.Value` with deep-copy semantics |
| `tunnel/` | `Tunnel` interface + 4 concrete types (file, http, tcp, udp) + `ChainConfig` builder |
| `tunnel/entrypoint/` | Entrypoint types (tcp, udp) implementing `tunnel.Tunnel` interface |
| `api/` | REST handlers (`Go 1.22 ServeMux` with method routing) + CORS middleware |
| `runner/` | Background task scheduler: async execution, optional repeat interval, cancel-by-ID |
| `runner/task/` | Concrete tasks — currently only `stats` polling |
| `version/` | Version string (set via `-ldflags="-X main.version=..."` at link time) |

### Startup flow

1. `main()` parses `-addr` and `-version` flags
2. `config.Init()` creates `~/.config/wisper/`, loads `config.yml` (creates empty config if missing), initializes structured logging
3. `tunnel.LoadConfig()` and `entrypoint.LoadConfig()` reconstruct tunnel/entrypoint objects from persisted config, auto-starting non-closed ones
4. `runner.Exec()` starts the stats polling task (1s interval, async)
5. HTTP server starts on the configured address with the combined API + web handler
6. On SIGINT/SIGTERM: persist state (`tunnel.SaveConfig()` + `entrypoint.SaveConfig()`), graceful HTTP shutdown (5s timeout)

### Tunnel types and their internal structure

Every tunnel type follows the same pattern:
- **Constructor** (`NewFileTunnel`, `NewHTTPTunnel`, etc.): generates a UUID ID → MD5 hash for the public endpoint subdomain, sets defaults
- **`init()`**: builds `x/config.ServiceConfig` structs describing the GOST listener + handler + chain
- **`Run()`**: parses the chain config, instantiates the GOST listener/handler/router/hop objects, wires them together, starts `Serve()` in a goroutine
- **`Close()`** / **`IsClosed()`**: close-once channel pattern

**File tunnel** (`tunnel/file.go`): Two-phase setup — starts a local TCP file server (`:0`), then a reverse-TCP forwarder (rtcp) that tunnels through WSS to `tunnel.gost.run:443`. The forwarder's hop targets the local file server address.

**HTTP tunnel** (`tunnel/http.go`): Single reverse-TCP forwarder (rtcp) that tunnels through WSS and forwards to a local HTTP endpoint. Supports TLS to backend, host rewriting, sniffing, basic auth.

**TCP tunnel** (`tunnel/tcp.go`): Reverse-TCP forwarder through WSS to a raw TCP endpoint.

**UDP tunnel** (`tunnel/udp.go`): Reverse-UDP forwarder (rudp) through WSS to a raw UDP endpoint.

**TCP entrypoint** (`tunnel/entrypoint/tcp.go`): Local TCP listener (`handler: tcp`) that forwards through the tunnel chain. This is the reverse of a tunnel — it listens locally and sends traffic *out* through the GOST tunnel.

**UDP entrypoint** (`tunnel/entrypoint/udp.go`): Same as TCP entrypoint but for UDP, with keepalive+TTL support.

### Key dependency: `github.com/go-gost/x`

The `x` module (in the parent `go.work` workspace) provides concrete GOST implementations. Wisper uses:
- Listeners: `tcp`, `rtcp` (reverse-tcp), `rudp` (reverse-udp), `udp`
- Handlers: `file`, `rtcp`, `tcp`, `udp`, `remote` (reverse-tunnel forwarder), `local` (entrypoint forwarder)
- Chain/router/hop from `x/chain/`, `x/hop/`
- Stats from `x/observer/stats/`

### Tunnel ↔ Entrypoint distinction

- **Tunnels** expose a *local* service to the public internet via GOST reverse proxy. `Endpoint()` returns the local address; `Entrypoint()` returns the public URL (`https://<hash>.gost.run`).
- **Entrypoints** expose a *public* GOST tunnel endpoint to a *local* port. `Endpoint()` returns the public URL; `Entrypoint()` returns the local listen address. They share the same `tunnel.Tunnel` interface but use `local.NewHandler` (forward-out) vs `remote.NewHandler` (reverse-in).

### REST API routes (all under `/api/`)

```
GET    /api/tunnels                  list all tunnels
POST   /api/tunnels                  create tunnel
GET    /api/tunnels/{id}             get one tunnel
PUT    /api/tunnels/{id}             update tunnel (destroys old, starts new)
DELETE /api/tunnels/{id}             delete tunnel
POST   /api/tunnels/{id}/start       start a stopped tunnel
POST   /api/tunnels/{id}/stop        stop a running tunnel

GET    /api/entrypoints              list all entrypoints
POST   /api/entrypoints              create entrypoint
GET    /api/entrypoints/{id}         get one entrypoint
PUT    /api/entrypoints/{id}         update entrypoint
DELETE /api/entrypoints/{id}         delete entrypoint
POST   /api/entrypoints/{id}/start   start a stopped entrypoint
POST   /api/entrypoints/{id}/stop    stop a running entrypoint

GET    /api/stats                    aggregated stats for all tunnels + entrypoints
GET    /api/config                   get app settings (server, entrypoint, lang, theme)
PUT    /api/config                   update app settings
```

### Flutter app structure

```
flutter/lib/
  main.dart              — App entry point, provider setup
  app.dart               — MaterialApp.router with GoRouter, theme, i18n
  config/                — Theme, routes, constants, formatting helpers
  models/                — Data classes with json_serializable (*.g.dart)
  services/              — GoBackend HTTP client, PlatformService, clipboard helpers
  providers/             — Riverpod providers for tunnel, entrypoint, settings, stats state
  pages/
    home/                — Tab shell: tunnels | entrypoints | settings
    tunnel/              — List, detail/form pages for tunnels
    entrypoint/          — List, detail/form pages for entrypoints
    settings/            — Settings page (lang, theme, server config)
  widgets/               — Reusable: TunnelCard, StatsRow, CopyableText, NavTabs, etc.
  l10n/                  — AppLocalizations with en + zh (46+ strings)
```

State management is **Riverpod** with `StateNotifier` providers. Navigation is **GoRouter** with path-based routing (`/tunnels`, `/tunnels/:id`, `/entrypoints`, `/entrypoints/:id`, `/settings`).

The Flutter app uses conditional imports (`clipboard_helper.dart` → `clipboard_helper_web.dart` / `clipboard_helper_stub.dart`) to handle the `dart:html` clipboard API on web vs other platforms.

## Configuration

- Config file: `~/.config/wisper/config.yml` (YAML)
- Log file: `~/.config/wisper/logs/wisper.log` (JSON format, 10MB rotation, 7-day retention)
- `config.Get()` returns a deep copy — mutations are safe without locks
- `config.Set()` + `cfg.Write()` persists changes
- `config.writeMu` serializes all file writes

## Test patterns

API tests (`api/api_test.go`) use `httptest.NewServer` and pre-register tunnel/entrypoint objects in a closed state (no network services started). Helper functions: `setupTestServer`, `preRegisterTunnel`, `preRegisterEntrypoint`. Tests reset global state between cases. Flutter tests live alongside each Dart source file and use `flutter_test` + `mockito`.

## Key design conventions

- **Constructor pattern**: Every tunnel/entrypoint uses functional options (`tunnel.Option`). `IDOption`, `NameOption`, `EndpointOption`, etc. generate UUIDs when no ID is provided.
- **Close-once channel**: `IsClosed()` checks a `chan struct{}` via non-blocking select; `Close()` closes it once.
- **No `init()` registration**: Unlike the main GOST project, wisper does not use `init()` side-effect registrations. Tunnel types are created directly via constructors.
- **Stats polling**: `runner/task/stats.go` runs every second, computes input/output bytes-per-second rates and connection rates from cumulative counters, then persists to disk (note: this means disk writes every second while tunnels are running).
