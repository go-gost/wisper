# Wisper P2P QUIC settings — design

Date: 2026-10-30
Status: approved (2026-10-30)
Scope: `wisper/` only. p2p v0.15.2 already implements the QUIC data plane.

## Why

p2p v0.15.2 added a global `transport: kcp | quic` switch and a `quic:`
tuning block. Wisper only forwards `derp`, `secure`, `caFile`, `stun` and
`direct`, so the settings UI has no QUIC controls. This was not a dropped
checkbox: the QUIC design/plan explicitly scoped the work to the `p2p/`
module, and wisper integration was never designed.

This change adds the missing opt-in surface without changing the KCP default.
It also exposes the one KCP-adjacent setting with a safe, supported meaning:
the smux session keepalive.

## Goals

- Add a global **Transport** selector to the P2P settings card: KCP (default)
  or QUIC.
- Add one **Advanced** button, collapsed by default. Its contents follow the
  selected transport:
  - KCP: `smux.interval` and `smux.timeout`.
  - QUIC: the six QUIC tuning fields.
- Persist the settings, rebuild the p2p host, and restart running consumers
  through the existing settings-update path.
- Keep KCP behavior, defaults and wire format unchanged.
- Add English and Chinese labels/hints, plus Go/API/web tests.

## Non-goals

- Per-peer KCP fallback, mixed KCP/QUIC peers, or runtime switching.
- Changing the p2p protocol or QUIC implementation.
- Exposing raw KCP MTU/window/NoDelay/retransmit constants. p2p deliberately
  keeps these fixed because they are coupled to the relay's bounded queue and
  the measured throughput knee.
- Exposing `punchWait` (currently write-only) or `directSmux` (compatibility
  no-op).
- Exposing p2p fault injection or other internal knobs.
- A separate advanced-settings page.

## Approaches considered

**A. Transport selector + collapsible QUIC tunables in the existing P2P card
(chosen).** One obvious place, no new route, and advanced values stay out of
the way until QUIC is selected. Existing relay/STUN/direct fields remain where
they are.

**B. Transport selector only; QUIC tunables stay config-file only.** Smaller
UI, but the user still cannot tune the new transport from the app.

**C. Separate advanced page.** Cleaner for many knobs, but six fields do not
justify a new page and it would split related P2P settings.

## UX

Inside the existing P2P card, after the direct/STUN group:

1. **Transport** selector (`KCP` default, `QUIC`).
2. A hint when QUIC is selected: QUIC is a global strict mode; every peer
   must support it; handshake failure does not fall back to KCP; changing the
   transport restarts the P2P connection.
3. One **Advanced** button, collapsed by default and visible for both modes.
   When expanded:
   - KCP: `smux.interval` (default 3s) and `smux.timeout` (default 15s).
     Timeout must be at least twice the interval. A hint warns that shortening
     them makes a suspended or briefly quiet peer look dead and causes
     reconnects.
   - QUIC: `MTU` (default 1200), `Relay batch bytes` (default 32768),
     `Relay flush` (default 200µs), `Keep-alive` (default 5s), `Idle timeout`
     (default 15s), `Handshake timeout` (default 10s).
   Empty means "use the built-in default". Placeholders show the defaults.
4. Switching transport changes the advanced fields but keeps both sets of
   values in the form/config, so switching back does not lose tuning.

The existing Save button persists the whole P2P block. Duration fields accept
Go duration strings (`200µs`, `5s`, `1m`). The UI validates before saving:
transport is `kcp|quic`; MTU is 1200–1452; batch bytes is 1–65536; each
duration parses and is positive; QUIC idle must exceed keep-alive after
applying defaults; smux timeout must be at least 2× interval after applying
defaults. The API repeats the validation as the final guard.

## Data model and flow

`config.P2PSettings` gains:

```go
Transport string              `yaml:"transport,omitempty" json:"transport,omitempty"`
QUIC      *QUICSettings       `yaml:"quic,omitempty" json:"quic,omitempty"`
Timeouts  *P2PTimeoutsSettings `yaml:"timeouts,omitempty" json:"timeouts,omitempty"`

type QUICSettings struct {
    MTU              int    `yaml:"mtu,omitempty" json:"mtu,omitempty"`
    RelayBatchBytes  int    `yaml:"relay_batch_bytes,omitempty" json:"relay_batch_bytes,omitempty"`
    RelayFlush       string `yaml:"relay_flush,omitempty" json:"relay_flush,omitempty"`
    KeepAlive        string `yaml:"keep_alive,omitempty" json:"keep_alive,omitempty"`
    Idle             string `yaml:"idle,omitempty" json:"idle,omitempty"`
    HandshakeTimeout string `yaml:"handshake_timeout,omitempty" json:"handshake_timeout,omitempty"`
}

type P2PTimeoutsSettings struct {
    Smux *SmuxSettings `yaml:"smux,omitempty" json:"smux,omitempty"`
}

type SmuxSettings struct {
    Interval string `yaml:"interval,omitempty" json:"interval,omitempty"`
    Timeout  string `yaml:"timeout,omitempty" json:"timeout,omitempty"`
}
```

`api/config_handler.go` mirrors these fields in `P2PSettingsResp`, includes
them in `p2pChanged`, and validates the transport/durations before writing.

`tunnel/p2p.go` adds side-effect-free helpers:

- `P2PTransport(settings)` → `""`/`"quic"` (p2p treats empty as KCP).
- `P2PQUICConfig(settings)` → `*p2p.QUICConfig`, parsing duration strings and
  returning an error for malformed values.
- `P2PTimeouts(settings)` → `*p2p.TimeoutsConfig` with the optional smux
  block, parsing duration strings and enforcing timeout ≥ 2× interval.

`tunnel/p2p_host.go` passes them into `p2p.Config`, and `p2pHostSig` includes
the transport, QUIC and smux values so a settings change rebuilds the host.
Existing `RestartRunning()` behavior restarts p2p consumers.

`web-src/src/api/types.ts` extends `P2PSettings`; `settings-page.ts` owns the
selector, advanced disclosure, field state, validation and save payload;
`i18n/en.ts` and `i18n/zh.ts` get matching keys.

## Risks

- QUIC requires both ends; the UI cannot detect the peer's mode before saving.
  The warning is explicit and the transport remains opt-in.
- Invalid advanced values would otherwise break host creation; the API and UI
  validate them before the restart.
- The settings save path intentionally ignores backend errors and still
  applies locally. The UI validation keeps malformed values out of that path;
  server-side validation remains the final guard.

## Verification

- Go: config round-trip, API update/validation, helper parsing, host signature
  includes transport/QUIC, `go test ./...` for wisper.
- Web: `npx tsc --noEmit`, `npx vite build`; the generated `web/` assets are
  refreshed.
- Manual: KCP default remains; QUIC appears; Advanced is collapsed; switching
  transport restarts the entrypoint and the phone still reports a direct peer.
