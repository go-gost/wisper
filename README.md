# 🪄 Wisper

**GOST tunnel manager** — a self-hosted web UI and API for creating and managing reverse proxy tunnels through the [GOST](https://github.com/go-gost/gost) network.

Expose local services to the public internet without opening firewall ports. Wisper handles the tunnel lifecycle — create, start, stop, update, and monitor — through a browser-based UI.

## Features

- **4 tunnel types** — File server, HTTP reverse proxy, TCP relay, UDP relay
- **2 entrypoint types** — TCP and UDP endpoints that expose GOST tunnels on local ports
- **Real-time stats** — bytes in/out per second, connection counts, per-tunnel rates
- **Dark / light theme** — CSS custom properties, auto-detected from OS preference
- **i18n** — English and Chinese
- **Single binary** — Go backend with embedded Lit web UI, ~15 MB
- **Graceful state management** — tunnels persist across restarts, auto-resume on startup
- **Linux, macOS, Windows, Android** — cross-compiled Go binary + Tauri desktop shell + APK

## Quick Start

```bash
# Build and run
make web
go build -o wisper .
./wisper

# Open http://localhost:8900 in your browser
```

Or with a custom port:

```bash
./wisper -addr :9000
```

Print version:

```bash
./wisper -version
```

## Tunnel Types

### Tunnels (local → public)

| Type | Description | Default Entrypoint |
|------|-------------|-------------------|
| **File** | Serve a local directory over HTTPS | `https://<hash>.gost.run` |
| **HTTP** | Expose a local HTTP service | `https://<hash>.gost.run` |
| **TCP** | Relay a raw TCP connection | `tcp://<hash>.gost.run:<port>` |
| **UDP** | Relay a raw UDP connection | `udp://<hash>.gost.run:<port>` |

### Entrypoints (public → local)

| Type | Description |
|------|-------------|
| **TCP** | Listen locally and forward into a GOST tunnel |
| **UDP** | Same as TCP entrypoint, with keepalive + TTL support |

## Configuration

Config file: `~/.config/wisper/config.yml` (YAML)

- **Server settings** — listen address, GOST relay server
- **Tunnel state** — persisted tunnel/entrypoint objects, auto-restored on startup
- **App settings** — language, theme, entrypoint endpoint

Logs: `~/.config/wisper/logs/wisper.log` (JSON format, 10 MB rotation, 7-day retention)

## REST API

All routes under `/api/`:

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/tunnels` | List all tunnels |
| `POST` | `/api/tunnels` | Create tunnel |
| `GET` | `/api/tunnels/{id}` | Get one tunnel |
| `PUT` | `/api/tunnels/{id}` | Update tunnel (replaces + restarts) |
| `DELETE` | `/api/tunnels/{id}` | Delete tunnel |
| `POST` | `/api/tunnels/{id}/start` | Start a stopped tunnel |
| `POST` | `/api/tunnels/{id}/stop` | Stop a running tunnel |
| `GET` | `/api/entrypoints` | List all entrypoints |
| `POST` | `/api/entrypoints` | Create entrypoint |
| `GET` | `/api/entrypoints/{id}` | Get one entrypoint |
| `PUT` | `/api/entrypoints/{id}` | Update entrypoint |
| `DELETE` | `/api/entrypoints/{id}` | Delete entrypoint |
| `POST` | `/api/entrypoints/{id}/start` | Start a stopped entrypoint |
| `POST` | `/api/entrypoints/{id}/stop` | Stop a running entrypoint |
| `GET` | `/api/stats` | Aggregated stats for all tunnels + entrypoints |
| `GET` | `/api/config` | Get app settings |
| `PUT` | `/api/config` | Update app settings |

## Build

### Prerequisites

- Go 1.26+
- Node.js 22+
- Python 3 + Pillow (for icon generation)
- Docker (for Android APK + desktop installers)

### Build all platforms

```bash
# Go binaries for Linux, macOS, Windows
make all

# Output: dist/linux-amd64/wisper, dist/darwin-arm64/wisper, etc.
```

### Web UI only

```bash
make web        # conditional rebuild (stamp-based — skips if no changes)
make web-force  # force rebuild
make typecheck  # type-check TypeScript (tsc --noEmit)
```

### Desktop app (Tauri 2)

```bash
# Linux .deb + .AppImage (Docker cross-compile)
make linux-installer

# Windows NSIS installer (Docker cross-compile)
make windows-installer

# Development mode (hot-reload frontend + sidecar)
make tauri-dev
```

### Android APK

```bash
# Build APK (Docker NDK cross-compile + Gradle)
make android
```

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│         (Lit web UI on localhost)            │
└──────────────────┬──────────────────────────┘
                   │ HTTP /api/*
┌──────────────────▼──────────────────────────┐
│              Go HTTP Server                   │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐ │
│  │  API    │  │  Runner  │  │  Web (SPA)   │ │
│  │ handlers│  │ (stats)  │  │  //go:embed  │ │
│  └────┬────┘  └──────────┘  └─────────────┘ │
│       │                                       │
│  ┌────▼────────────────────────────────────┐ │
│  │           Tunnel Manager                 │ │
│  │  File │ HTTP │ TCP │ UDP │ Entrypoints  │ │
│  └────┬────────────────────────────────────┘ │
└───────┼──────────────────────────────────────┘
        │ WSS / GOST relay
┌───────▼──────────┐
│  GOST Network    │
│ (tunnel.gost.run)│
└──────────────────┘
```

Wisper is a **single Go module** (`github.com/go-gost/wisper`). The Lit web app (`web-src/`) compiles to `web/` via Vite and is embedded into the Go binary via `//go:embed`.

### Go package layout

| Package | Purpose |
|---------|---------|
| `main` | Entry point, flag parsing, server lifecycle |
| `web.go` | Embeds web build, serves SPA |
| `config/` | Settings + tunnel persistence (atomic, thread-safe) |
| `tunnel/` | Tunnel interface + 4 tunnel types + chain builder |
| `tunnel/entrypoint/` | TCP/UDP entrypoint types |
| `api/` | REST handlers (Go 1.22+ ServeMux with method routing) |
| `runner/` | Background task scheduler with cancel-by-ID |
| `runner/task/` | Stats polling task |
| `version/` | Version string (set via ldflags) |

### Web app stack

- **Lit** — Web Components with reactive state
- **@lit-labs/router** — SPA routing with lazy-loaded pages
- **Vite** — Build tool with dev proxy to Go backend
- **CSS custom properties** — Light/dark theme system
- **Module-level stores** — Subscribe/notify pattern, zero dependencies

## License

MIT
