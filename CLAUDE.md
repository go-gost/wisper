# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
# ⚠️ BUILD ORDER: web FIRST, then backend.
# The Go binary embeds web/ via //go:embed, so the web build must exist
# before go build runs. `make all` enforces this; plain go build does not.

# Step 1: Build Lit web UI
# ⚠️ MUST use `make web` — NEVER run `npx vite build` directly.
# The Makefile handles conditional rebuild (stamp-based) and cleanup.
make web

# Step 2: Build Go backend for current platform (embeds web/)
go build -o wisper .

# Or build all platforms (linux, darwin, windows) — runs web + go build
make all

# Build Go backend for a specific target (from Makefile)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/linux-amd64/wisper .

# Force web rebuild (ignore stamp)
make web-force

# Run the server (defaults to :8900)
./wisper
./wisper -addr :9000                    # custom port
./wisper -version                       # print version and exit

# Run Go tests
go test ./... -v
go test ./api/ -v -run TestListTunnels  # single test suite
```

## Architecture

Wisper is a **GOST tunnel manager** — a Go HTTP API server with an embedded Lit web UI for creating and managing reverse proxy tunnels through the GOST network.

The project is a **single Go module** (`github.com/go-gost/wisper`, `go.mod` at root). The Lit web app lives under `web-src/` and is embedded into the Go binary via `//go:embed` in `web.go`.

### How the two halves connect

1. `npx vite build` in `web-src/` outputs to `web/`
2. `web.go` embeds `web/*` via `//go:embed` and serves it as an SPA (non-file requests → `index.html`)
3. `api/server.go` registers API routes on `/api/*` and falls back to the web handler for everything else
4. The `GoBackend` TypeScript class uses relative URLs when base is empty, so it works same-origin

### Go package layout

| Package | Purpose |
|---------|---------|
| `main` (`main.go`) | Entry point: parses flags, inits config, starts stats runner, starts HTTP server, graceful shutdown |
| `web.go` | Embeds Lit web build and serves it with SPA fallback |
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

The `x` module (declared as a versioned module in `go.mod`) provides concrete GOST implementations. Wisper uses:
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

### Lit web app structure

```
web-src/
  index.html              — Bootstrap HTML, loads /src/main.ts
  package.json            — Dependencies (lit, @lit-labs/router)
  tsconfig.json           — TypeScript config (strict, decorators)
  vite.config.ts          — Vite: output to ../web/, proxy /api in dev

  src/
    main.ts               — Entry: imports global.css and app.ts
    app.ts                — Root <wisper-app>: init settings, stats polling, router outlet

    api/
      backend.ts          — GoBackend class (17 API methods, fetch-based)
      types.ts            — Tunnel, Entrypoint, Stats, AppSettings types + enums

    store/
      tunnel-store.ts     — Module-level store: CRUD, subscribe/notify
      entrypoint-store.ts — Module-level store: CRUD, subscribe/notify
      settings-store.ts   — Settings state, load/save via API, theme/locale apply
      stats-store.ts      — 1s polling, pushes stats into tunnel/entrypoint stores

    router/
      routes.ts           — 6 route definitions with lazy-loaded pages

    components/
      app-scaffold.ts     — Centered 800px layout wrapper
      nav-tabs.ts         — Pill-style tab bar
      tunnel-card.ts      — Tunnel/entrypoint summary card
      stats-row.ts        — Icon + value + rate display
      copyable-text.ts    — Monospace text + copy button
      delete-dialog.ts    — Confirmation modal dialog
      spinner.ts          — Loading spinner
      form-fields/        — Type-specific form field groups

    pages/
      home-page.ts                — Tabbed list + FAB
      tunnel-type-select-page.ts  — 4 tunnel type cards
      tunnel-detail-page.ts       — View/edit/create form + stats
      entrypoint-type-select-page.ts — 2 entrypoint type cards
      entrypoint-detail-page.ts   — View/edit/create form + stats
      settings-page.ts            — Server/theme/language settings

    i18n/
      en.ts               — English strings (~55 keys)
      zh.ts               — Chinese strings (~55 keys)
      i18n.ts             — t(key, params?) + setLocale() + locale change events

    styles/
      theme.ts            — CSS custom properties for light/dark, applyTheme()
      global.css          — Reset, base typography

    utils/
      format.ts           — formatBytes, formatRate, formatNumber
      clipboard.ts        — navigator.clipboard with execCommand fallback
```

State management uses **module-level singleton stores with subscribe/notify pattern** — no extra dependencies. Components subscribe in `connectedCallback()` and unsubscribe in `disconnectedCallback()`.

Routing uses **`@lit-labs/router`** with lazy-loaded page modules. SPA navigation uses `window.history.pushState` + `PopStateEvent`.

Theming uses **CSS custom properties** toggled by `.dark` class on `document.documentElement`.

## Configuration

- Config file: `~/.config/wisper/config.yml` (YAML)
- Log file: `~/.config/wisper/logs/wisper.log` (JSON format, 10MB rotation, 7-day retention)
- `config.Get()` returns a deep copy — mutations are safe without locks
- `config.Set()` + `cfg.Write()` persists changes
- `config.writeMu` serializes all file writes

## Test patterns

API tests (`api/api_test.go`) use `httptest.NewServer` and pre-register tunnel/entrypoint objects in a closed state (no network services started). Helper functions: `setupTestServer`, `preRegisterTunnel`, `preRegisterEntrypoint`. Tests reset global state between cases.

## Key design conventions

- **Constructor pattern**: Every tunnel/entrypoint uses functional options (`tunnel.Option`). `IDOption`, `NameOption`, `EndpointOption`, etc. generate UUIDs when no ID is provided.
- **Close-once channel**: `IsClosed()` checks a `chan struct{}` via non-blocking select; `Close()` closes it once.
- **No `init()` registration**: Unlike the main GOST project, wisper does not use `init()` side-effect registrations. Tunnel types are created directly via constructors.
- **Stats polling**: `runner/task/stats.go` runs every second, computes input/output bytes-per-second rates and connection rates from cumulative counters, then persists to disk (note: this means disk writes every second while tunnels are running).

## Desktop/Mobile Wrapping

The Tauri 2 desktop shell lives at `src-tauri/`. It spawns the Go binary as a sidecar, serves the Lit web UI through a system WebView, and provides a system tray icon. Build targets:

```bash
# Linux (.deb + .AppImage)
make linux-installer         # Docker-based (no host system deps needed)
make sidecar && cargo tauri build   # native (requires webkit2gtk dev headers)

# macOS (.dmg)
make macos-installer         # macOS host only (or macos-latest CI)
make macos-sidecar           # cross-compile Go sidecar for darwin-arm64 only

# Windows (NSIS .exe)
make windows-installer       # Docker cross-compile from Linux
make windows-sidecar         # cross-compile Go sidecar for windows-amd64 only

# Development
make tauri-dev               # hot-reload frontend + sidecar

# Icons — regenerate all brand assets from appicon.png
make icons                   # requires Python 3 + Pillow
```

Android APK is built via Docker + NDK cross-compile: `make android` / `make android-release`.

The sidecar binary name is `wisper-api` (must differ from the Cargo package name `wisper`). All API calls use relative paths, no Node.js-specific APIs, optional `baseUrl` on GoBackend for non-embedded scenarios, CSS custom properties for theming everywhere.

### GitHub Actions release pipeline (`release.yml`)

Current desktop build jobs (all `needs: create-release`):
- **`desktop-linux`** — ubuntu-latest, native `deb+appimage` via `npx tauri build`
- **`desktop-macos`** — macos-latest, native `.dmg` via `npx tauri build` (unsigned, ARM-native)
- **`desktop-windows`** — windows-latest, native `.nsis` via `npx tauri build`
- **`goreleaser`** — cross-compiles Go CLI binaries (linux/darwin/windows, amd64/arm64)
- **`android`** — Docker-based NDK cross-compile + Gradle release APK
