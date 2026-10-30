# Wisper QUIC/KCP advanced settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global KCP/QUIC transport selector and a collapsed Advanced section (KCP smux keepalive, QUIC tuning) to the P2P settings UI, wired through config, API and the p2p host.

**Architecture:** Wisper's `P2PSettings` mirrors the p2p transport/QUIC/timeout fields as string-valued UI settings; `tunnel` parses them into `p2p.Config`; the API validates and round-trips them; the Lit settings page renders transport-dependent advanced fields.

**Tech Stack:** Go 1.26, Lit/TypeScript, Vite.

**Spec:** `wisper/docs/superpowers/specs/2026-10-30-wisper-quic-settings-design.md`

## Global Constraints

- Default transport is KCP; existing KCP behavior and wire format must not change.
- QUIC is global and strict: both peers must support it; no KCP fallback; changing transport restarts the p2p host.
- Do not expose p2p's internal KCP MTU/window/NoDelay constants, `punchWait`, or `directSmux`.
- Advanced is collapsed by default and its fields are optional; empty means p2p's built-in default.
- Duration strings use Go syntax (`200µs`, `5s`).
- KCP smux timeout must be at least 2× interval after defaults (3s/15s).
- UI text must be added to both `en.ts` and `zh.ts`.

## Review Focus

- A saved `transport` that never reaches `p2p.Config` (the host silently stays KCP).
- A changed QUIC/smux value that does not rebuild the host because `p2pHostSig` missed it.
- Invalid advanced values that pass the UI and break the next host acquire/restart.
- Switching KCP→QUIC→KCP losing previously entered advanced values.
- Old config files without the new fields loading as KCP with defaults.

---

### Task 1: Config types, parsing helpers and host wiring

**Files:**
- Modify: `config/config.go` (P2PSettings, new QUICSettings/P2PTimeoutsSettings/SmuxSettings)
- Modify: `tunnel/p2p.go` (P2PTransport, P2PQUICConfig, P2PTimeouts)
- Modify: `tunnel/p2p_host.go` (acquire config, p2pHostSig)
- Test: `tunnel/p2p_test.go`, `tunnel/p2p_host_test.go`

**Interfaces:**
- Produces: `P2PTransport(*config.Settings) string`
- Produces: `P2PQUICConfig(*config.Settings) (*p2p.QUICConfig, error)`
- Produces: `P2PTimeouts(*config.Settings) (*p2p.TimeoutsConfig, error)`
- Config types: `QUICSettings`, `P2PTimeoutsSettings`, `SmuxSettings` as in the spec.

- [x] **Step 1: Write failing helper tests**

Add tests asserting: empty settings → KCP/nil/nil; `transport: quic` → `"quic"`; QUIC `mtu:1400`, `relay_flush:"250µs"`, `keep_alive:"6s"`, `idle:"20s"`, `handshake_timeout:"12s"` parse to the p2p struct; `mtu:1000` and `idle:5s/keep_alive:6s` return errors; smux `interval:"4s", timeout:"12s"` parse; `interval:"3s", timeout:"5s"` returns an error.

- [x] **Step 2: Run tests to verify failure**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel -run 'TestP2P(Transport|QUIC|Timeouts)' -count=1`
Expected: compile failure (helpers/types absent).

- [x] **Step 3: Implement config and helpers**

Add the config structs with `yaml`/`json` snake_case tags. Implement parsing with `time.ParseDuration`; 0/empty keeps the p2p default. Validate MTU ≥1200, batch ≤65536, positive durations, QUIC idle > keepalive (defaults 5s/15s), smux timeout ≥ 2× interval (defaults 3s/15s).

- [x] **Step 4: Wire host build and signature**

In `acquire`, parse both helpers and set `conf.Transport`, `conf.QUIC`, `conf.Timeouts`; return the parse error. Extend `p2pHostSig` with the raw transport, QUIC and smux values. Add a test that two settings differing only in transport/quic/smux produce different signatures.

- [x] **Step 5: Run tests**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel -count=1`
Expected: PASS.

---

### Task 2: API round trip and validation

**Files:**
- Modify: `api/config_handler.go`
- Test: `api/api_test.go`

**Interfaces:**
- Consumes: `config.QUICSettings`, `config.P2PTimeoutsSettings`, `tunnel.P2PQUICConfig`, `tunnel.P2PTimeouts`.
- Produces: JSON fields `p2p.transport`, `p2p.quic`, `p2p.timeouts.smux` on GET/PUT `/api/config`.

- [x] **Step 1: Write failing API tests**

Add `TestUpdateConfigP2PAdvanced` (PUT the full block, GET it back) and `TestUpdateConfigP2PRejectsInvalid` (transport `sctp`, MTU 1000, smux 3s/5s each return 400). Include the existing `derp` field.

- [x] **Step 2: Run tests to verify failure**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./api -run 'TestUpdateConfigP2PAdvanced|TestUpdateConfigP2PRejectsInvalid' -count=1`
Expected: FAIL (fields ignored or invalid values accepted).

- [x] **Step 3: Implement mapping, change detection and validation**

Add fields to `P2PSettingsResp`, copy them in GET, compare them in `p2pChanged`, assign them on PUT. Validate transport (`""|kcp|quic`) and call `tunnel.P2PQUICConfig`/`tunnel.P2PTimeouts`; on error return `writeError(w, http.StatusBadRequest, err.Error())` before mutating config.

- [x] **Step 4: Run API tests**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./api -count=1`
Expected: PASS.

---

### Task 3: Settings UI and i18n

**Files:**
- Modify: `web-src/src/api/types.ts`
- Modify: `web-src/src/pages/settings-page.ts`
- Modify: `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`

**Interfaces:**
- Consumes: `P2PSettings.transport`, `.quic`, `.timeouts.smux` from the API.
- Produces: a transport `<select>`, one Advanced disclosure, and mode-specific fields.

- [x] **Step 1: Extend types**

Add `QUICSettings`, `SmuxSettings`, `P2PTimeoutsSettings`; add `transport?: 'kcp' | 'quic'`, `quic?`, `timeouts?` to `P2PSettings`.

- [x] **Step 2: Add state/load/save**

Load all fields from `s.p2p`; initialize transport to `kcp` when absent. Save sends `transport`, `quic` and `timeouts.smux` alongside the existing fields. Preserve both advanced value sets when toggling transport.

- [x] **Step 3: Render and validate**

Add the selector after the STUN group; show a QUIC strict-mode hint. Always render one Advanced button, collapsed by default. KCP shows `smux.interval`/`smux.timeout`; QUIC shows the six fields. Placeholders show defaults. On save validate: transport enum, MTU 1200–1452, batch 1–65536, durations parse and are positive, QUIC idle > keepalive, smux timeout ≥ 2× interval; show a localized error instead of saving.

- [x] **Step 4: Add i18n keys**

Add matching keys in `en.ts` and `zh.ts` for transport labels, hints, advanced, KCP fields, QUIC fields and validation errors. Keep both key sets identical.

- [x] **Step 5: Build the web assets**

Run: `cd /root/code/go-gost/wisper/web-src && npx tsc --noEmit && npx vite build`
Expected: PASS; the tracked `web/` output is refreshed.

---

### Task 4: Full verification

- [x] **Step 1: Go tests**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./... -count=1`
Expected: PASS.

- [x] **Step 2: Build**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go build ./...`
Expected: PASS.

- [x] **Step 3: Manual check**

Start the local binary/UI, confirm KCP is the default and the saved advanced values survive a reload. If the phone build is requested, rebuild and install the APK, then verify the existing direct peer still comes up under KCP and, only when both ends opt in, under QUIC.
