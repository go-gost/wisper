# wisper tun control plane, local ACL, and peer list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a tun entrypoint its own peer list and local inbound access block, plumb the hub's per-run generation / aliases / disabled / direct-capability fields through netview, and enforce the block on the existing single-hub data path and the userspace share shim — without touching the x mesh handler.

**Architecture:** The hub's control frames gain optional `Gen`, member `Name`/`Direct`/`Disabled`, and claim `Direct` fields. `NetviewRouter` keeps the accepted members/claims and notifies the entrypoint. The entrypoint builds an immutable `PeerFilter` policy from those snapshots plus `blocked_peers`, wraps the tun device / `tun-share` chain, and exposes a peer list API/UI. Direct links themselves are Plan 3; this plan's rows show `hub`/`direct-off` until then.

**Tech Stack:** Go 1.26, `net/http` mux, `netip`, Lit + TypeScript, existing `gost`/`x`/p2p dependencies.

**Spec:** `/root/code/go-gost/wisper/docs/superpowers/specs/2026-11-04-wisper-tun-spoke-direct-design.md` (§6, §7.7, §8, §15)

## Scope

This is **Plan 2 of 3**. It does not wire the x mesh handler or create direct p2p links; those are Plan 3. It does make `blocked_peers` and the peer list useful on the existing single-hub path, including Android.

## Global Constraints

- Do not change existing behavior when `blocked_peers` is empty: the filter is a pure pass-through. All new control fields are optional JSON; old hubs/spokes ignore them.
- Do not modify `x/` or `p2p/` in this plan. The only external dependency is the existing `gost`/`x` API.
- Comments in English only. `en.ts` and `zh.ts` key sets must match. `web/assets` is tracked: run the web build after `web-src` changes.
- Do not edit existing tests to accommodate new behavior; add new tests. Do not change `Members` filtering semantics used by LAN routing.
- `blocked_peers` is local ingress policy: it does not change hub membership. The peer list is a local view; `hub` means "no direct link / direct off", not "online".
- Run tests per package (`GOWORK=off` as appropriate); wildcard `go test ./...` can hang in this workspace.
- Commit after each task; fill the Implementation record and commit it in the plan repo. Do not push.

## Review Focus

1. `blocked_peers` must block both direct and hub-relayed traffic on the **old** path, including userspace-share LAN-bound packets, and must not alter traffic when empty.
2. A disabled/removed hub peer must not keep a stale `Direct=true`, and aliases/disabled must republish without changing `Members` LAN semantics.
3. A hub restart must not have its `rev=1` netview rejected by a spoke that saw a higher rev; `Gen` reset must work for new spokes while old ones ignore it.
4. The peer list must never claim a peer is online when it only knows "via hub"; blocked/stale rows must be visible and actionable.
5. The full entrypoint PUT must preserve an omitted `blocked_peers` (and absent API fields generally), while an explicit empty list clears it.

---

### Task 1: Control fields and hub capability/alias/disabled plumbing

**Files:**
- Modify: `tunnel/ctrl.go`
- Modify: `tunnel/ctrlhub.go`
- Modify: `tunnel/tun.go`
- Test: `tunnel/ctrl_test.go`, `tunnel/ctrlhub_test.go`, `tunnel/tun_authorizer_test.go`

**Interfaces:**
- Produces:
  ```go
  // memberEntry
  type memberEntry struct {
      IP       string
      Key      string
      Name     string `json:"name,omitempty"`
      Direct   bool   `json:"direct,omitempty"`
      Disabled bool   `json:"disabled,omitempty"`
  }
  // claimMessage
  Direct bool `json:"direct,omitempty"`
  // netviewMessage
  Gen string `json:"gen,omitempty"`
  ```
- Produces `controlHub.gen string` (random per `newControlHub`), `controlHub.SetCapability(peer string, direct bool)`, `controlHub.SetPeerMeta(aliases map[string]string, disabled []string)`.
- `SetMembers` merges `Name` from aliases, `Direct` from caps, `Disabled` from the disabled set; `rib.SetMembers` sees the merged rows.
- `applyClaimSet` calls `SetCapability(peer, m.Direct)`; a changed capability republishes.
- `tunTunnel.SetPeers` calls `SetPeerMeta` + `SetMembers` after updating options (no extra `Members` filtering).

- [ ] **Step 1: Write failing tests**

- `TestControlMemberFieldsJSON`: encode/decode a `netviewMessage` with `Gen`, member `Name/Direct/Disabled`, claim `Direct`; assert round trip.
- `TestControlHubCapabilityAndMeta`: start a `controlHub` with a fake sink; set members from `authz.Members()`; `SetCapability("b", true)`, `SetPeerMeta(map["b"]"B", []{"c"})`; assert `rib` snapshot has `b.Name=="B", Direct==true`, `c.Disabled==true`, and a changed rev.
- `TestControlHubGenIsPerRun`: two `newControlHub` instances with the same ID have different non-empty `gen`.
- `TestTunSetPeersRefreshesMeta`: `tunTunnel.SetPeers` updates aliases/disabled and the control hub's membership/rev; `Members` LAN semantics unchanged.
- Existing tests must pass unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel -run 'TestControl|TestTunSetPeers' -count=1`
Expected: FAIL — fields/methods undefined.

- [ ] **Step 3: Implement fields and merges**

Use `crypto/rand` + hex for `Gen` (or `uuid.NewString`). Keep `Members` as `authz.Members()` plus the metadata; do not filter disabled/removed keys out of the LAN-routing membership. `SetPeerMeta` stores copies; only republish when contents change. `SetCapability` normalizes empty/unknown peers but still records the claim for a peer that may get a row later.

- [ ] **Step 4: Run tests**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/ctrl.go tunnel/ctrlhub.go tunnel/tun.go tunnel/*_test.go
git -C /root/code/go-gost/wisper commit -m "feat(tun): plumb direct, alias, disabled, and netview generation"
```

**Implementation record**
- Date/status: 2026-11-05 / complete
- Repo/commit: wisper / a6e1178 (`feat(tun): plumb direct, alias, disabled, and netview generation`)
- Files changed: `tunnel/ctrl.go`, `tunnel/ctrlhub.go`, `tunnel/rib.go`, `tunnel/tun.go`, `tunnel/ctrl_test.go`, `tunnel/ctrlhub_test.go`, `tunnel/tun_test.go`
- Tests: `GOWORK=off go test ./tunnel -run 'TestControlMemberFieldsJSON|TestControlHubCapabilityAndMeta|TestControlHubGenIsPerRun|TestTunSetPeersRefreshesMeta' -count=1` → PASS; `GOWORK=off go test ./tunnel -count=1` → PASS (34.631s)
- Review findings/fixes: `controlHub` stores base members separately and merges alias/capability/disabled metadata; `Members` is deliberately not filtered. `SetPeerMeta` is called from `Run` and `SetPeers`. `Gen` is a per-run UUID; `publish`/`Snapshot` stamp it into `claimSet`.
- Deferred/limitations: The spoke-side `Direct` option that would send a true claim is Plan 3; until then claims carry false. `SetPeers` test covers metadata but not a live control session's publish.

---

### Task 2: NetviewRouter members/claims/Gen and member-sync callback

**Files:**
- Modify: `tunnel/netview_router.go`
- Modify: `tunnel/ctrl.go` / `tunnel/ctrlhub.go` if the callback lives in `ControlChannelConfig`
- Test: `tunnel/netview_router_test.go`, `tunnel/ctrlhub_test.go`

**Interfaces:**
- Produces exported:
  ```go
  type NetviewMember struct { IP, Key, Name string; Direct, Disabled bool }
  type NetviewClaim  struct { Prefix, Origin string; Allow []string }
  func (r *NetviewRouter) Apply(n netviewMessage) bool
  func (r *NetviewRouter) Members() []NetviewMember
  func (r *NetviewRouter) Claims() []NetviewClaim
  func (r *NetviewRouter) Generation() (hub, gen string, rev uint64)
  ```
- `Apply` resets `rev` when `(Hub, Gen)` changes; returns false for a stale same-generation rev or empty hub.
- Stores accepted members + claims; returns deep copies; longest-first claim order preserved.
- `ControlChannelConfig.MemberSync func()` is called after an accepted netview.
- `deliverNetview` calls `Apply`; only on true runs `RouteSync` and `MemberSync`.

- [x] **Step 1: Write failing tests**

- `TestNetviewRouterGenResetsRev`: apply hub/gen A rev 5, then hub/gen B rev 1; accepted. Same gen rev 4 after 5 rejected.
- `TestNetviewRouterMembersClaims`: apply members/claims; assert `Members()`/`Claims()` copies and claim order; mutate the returned slices and re-read.
- `TestNetviewMemberSyncOnlyAccepted`: callback counter increments on accepted netviews, not stale.
- Existing LAN route tests pass unchanged.

- [x] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel -run 'TestNetviewRouter|TestNetviewMemberSync' -count=1`
Expected: FAIL — methods/types undefined.

- [x] **Step 3: Implement**

Keep the existing route install behavior; add fields `gen`, `members`, `claims`. A netview without `Hub` remains rejected. `Members()`/`Claims()` deep-copy strings/slices. Do not call `MemberSync` for a rejected netview.

- [x] **Step 4: Run tests**

Run Step 2. Expected: PASS.

- [x] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/netview_router.go tunnel/ctrl.go tunnel/*_test.go
git -C /root/code/go-gost/wisper commit -m "feat(tun): expose netview members and generation to the spoke"
```

**Implementation record**
- Date/status: 2026-11-05 / complete
- Repo/commit: wisper / e166ecf
- Files changed: `tunnel/netview_router.go`, `tunnel/netview_router_test.go`
- Tests: `GOWORK=off go test ./tunnel -run 'TestNetviewRouter|TestNetviewMemberSync' -count=1` PASS; full `GOWORK=off go test ./tunnel -count=1` PASS; `GOWORK=off go vet ./tunnel` PASS.
- Review findings/fixes: `Apply` now returns bool and only accepted snapshots reach `RouteSync`/`MemberSync`; generation reset matches the hub's per-run Gen while empty Gen keeps the old hub-only rule; `Members`/`Claims` are deep copies and keep the hub's claim order. The tests were written with the implementation in one pass, so the Step 2 expected compile failure was not separately captured; the absence of that evidence is noted rather than claimed.
- Deferred/limitations: `MemberSync` is wired into `ControlChannelConfig` but no entrypoint supplies it yet (Task 3/4); `Generation` is exported for the peer list/API, not used outside the router yet.

---

### Task 3: `blocked_peers` option/config/peer-list state

**Files:**
- Modify: `tunnel/tunnel.go` (Options/Option)
- Modify: `config/config.go`
- Modify: `tunnel/entrypoint/entrypoint.go` (Load/Save/Restart copies)
- Modify: `tunnel/entrypoint/tun.go`
- Test: `tunnel/entrypoint/tun_test.go`, `tunnel/entrypoint/restart_test.go`, `tunnel/tunip_test.go` or a new `tunnel/peerlist_test.go`

**Interfaces:**
- Produces:
  ```go
  // tunnel.Options
  BlockedPeers []string
  func BlockedPeersOption(peers ...string) Option
  // config.Tunnel
  BlockedPeers []string `yaml:"blocked_peers,omitempty" json:"blocked_peers,omitempty"`
  // exported tunnel surface
  type EntryPeer struct {
      Key, Name string
      IPs, LANs []string
      State string // hub / blocked / disabled / direct-off (Plan 3 adds direct/connecting)
      Blocked, Direct, Disabled bool
      Transport string
      DialedLocally bool
      RTTMs int64
      InputBytes, OutputBytes uint64
  }
  type PeerListReporter interface { PeerList() []EntryPeer }
  type BlockedPeersSetter interface { SetBlockedPeers(ctx context.Context, keys []string) error }
  ```
- `tunEntryPoint` holds `filter *tunnel.PeerFilter` (created in `NewTunEntryPoint`), `blockedPeers []string` under `mu`.
- `PeerList()` returns hub row first (`Key: opts.Peer`, `Name: "Hub"`, `State: "hub"`), then netview members sorted by key, then stale blocked keys not in membership (`State: "blocked"`). Member states: blocked > disabled > direct-off > hub. `LANs` from claims whose Origin is the member key.
- `SetBlockedPeers` normalizes/dedupes, updates options, calls `filter.SetPolicy(netviewRouter().Members(), netviewRouter().Claims(), keys)`, and is safe while stopped.
- Config Load/Save/Restart carries `BlockedPeers`.

- [x] **Step 1: Write failing tests**

- `TestTunOptionsBlockedPeersRoundTrip`: option → `Options()`; config Save/Load → same; Restart preserves.
- `TestTunPeerListRows`: fake netview members/claims; blocked/disabled; assert hub first, states, LANs, stale blocked row.
- `TestTunSetBlockedPeersInPlace`: running/stopped; keys deduped; no panic with nil filter.
- `TestEntryPointUpdatePreservesBlockedPeers` (API-level helper): absent field carries current; explicit empty clears.

- [x] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel/entrypoint -run 'TestTunOptionsBlocked|TestTunPeerList|TestTunSetBlocked|TestEntryPointUpdatePreserves' -count=1`
Expected: FAIL — field/methods undefined.

- [x] **Step 3: Implement options/config/state**

Add the field in the four copy paths (`LoadConfig`, `SaveConfig`, `RestartRunning`, create/update) and in `tunnel.TunnelOptions`. Keep `blockedPeers` normalized (trim, drop empty, dedupe, preserve first occurrence). `PeerList` reads the process-wide `netviewRouter()`; this plan assumes the existing one-tun-entrypoint-per-process deployment shape.

- [x] **Step 4: Run tests**

Run Step 2. Expected: PASS.

- [x] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/tunnel.go config/config.go tunnel/entrypoint
git -C /root/code/go-gost/wisper commit -m "feat(tun): add local blocked peers and peer-list state"
```

**Implementation record**
- Date/status: 2026-11-05 / complete
- Repo/commit: wisper / f5fa3c7
- Files changed: `tunnel/tunnel.go`, `config/config.go`, `tunnel/peerlist.go`, `tunnel/peerfilter.go`, `tunnel/entrypoint/entrypoint.go`, `tunnel/entrypoint/tun.go`, `tunnel/entrypoint/peerlist_test.go`
- Tests: `GOWORK=off go test ./tunnel/entrypoint -run 'TestTunOptionsBlocked|TestTunPeerList|TestTunSetBlocked' -count=1` PASS; `GOWORK=off go test -race ./tunnel/entrypoint -run 'TestTunOptionsBlocked|TestTunPeerList|TestTunSetBlocked' -count=1` PASS; full `GOWORK=off go test ./tunnel/... -count=1` PASS; `GOWORK=off go vet ./tunnel/...` PASS.
- Review findings/fixes: `Options()` now copies `BlockedPeers` under `s.mu` because it is the one field mutated after construction; `PeerFilter` is a policy container in this task (packet checks land in Task 4) and `SetBlockedPeers` is nil-filter safe; `PeerList` skips a duplicate hub member row and keeps stale blocked keys last; `SetBlockedPeers` never restarts the service. No `Options()` caller holds `s.mu`, so the new lock cannot self-deadlock.
- Deferred/limitations: `TestEntryPointUpdatePreservesBlockedPeers` needs the API handler and moves to Task 6; the filter is not yet wired to the device path or netview updates (Tasks 4/5); `PeerList` direct/transport/traffic fields remain zero until Plan 3.

---

### Task 4: Peer filter policy and device-conn filter

**Files:**
- Create: `tunnel/peerfilter.go`
- Create: `tunnel/peerfilter_test.go`
- Modify: `tunnel/entrypoint/tun.go`
- Test: `tunnel/entrypoint/filter_test.go` if wiring needs it

**Interfaces:**
- Produces in `tunnel`:
  ```go
  type PeerFilter struct { /* immutable policy, counters */ }
  func NewPeerFilter() *PeerFilter
  func (f *PeerFilter) SetPolicy(members []NetviewMember, claims []NetviewClaim, blocked []string)
  func (f *PeerFilter) Wrap(conn net.Conn) net.Conn
  func (f *PeerFilter) BlockedSrc(pkt []byte) bool
  func (f *PeerFilter) BlockedDst(pkt []byte) bool
  func (f *PeerFilter) BlockedPackets() uint64
  ```
- Policy maps: exact member IP → key; claim prefix → origin key (longest match). A blocked key blocks both its exact IPs and prefixes whose origin is that key. `BlockedSrc`/`BlockedDst` parse IPv4/IPv6; malformed packets are not blocked (pass through).
- `Wrap` returns a conn whose `Read` drops packets with a blocked destination and whose `Write` drops packets with a blocked source (return `len(p), nil`). Empty policy is a pure passthrough (Read/Write delegate directly; no parse/counters). Preserve `net.Conn` deadlines/addresses/Close.
- `SetPolicy` is atomic replace; counters are cumulative.
- `tunEntryPoint.Run` wraps the tun listener's accepted conns with the filter for the existing single-hub path; the filter is created before `init` so userspace-share metadata can reference it (Task 5).
- `tunEntryPoint.startControlChannel` passes a `MemberSync` closure that calls `s.refreshFilter()` (router members/claims + blocked list) so a netview update changes the policy.

- [ ] **Step 1: Write failing tests**

- `TestPeerFilterBlocksTunIP`: member B 10.0.0.2 blocked; inbound src B dropped; outbound dst B dropped; C passes.
- `TestPeerFilterBlocksLANPrefix`: claim `192.168.50.0/24 origin b` blocked; src/dst inside dropped; a more specific allowed owner is not blocked.
- `TestPeerFilterEmptyPassthrough`: empty policy delegates exact bytes, deadlines, errors, Close; no counters.
- `TestPeerFilterIPv6` and malformed/non-IP pass-through.
- `TestPeerFilterBlockedSrcDst` for the share shim helpers.
- `TestTunRunWrapsDevice`: with a test seam, assert the accepted device conn is the filter wrapper; empty policy still passes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel -run 'TestPeerFilter' -count=1`
Expected: FAIL — types undefined.

- [ ] **Step 3: Implement**

Use a small raw packet parser (IPv4 header at offsets 12/16, IPv6 at 8/24; require minimum lengths). Store policy in an atomic pointer; blocked keys normalized. The wrapper must not parse when the immutable blocked set is empty. Do not add a new dependency; `net`, `netip`, `sync/atomic` suffice.

- [ ] **Step 4: Run tests**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/peerfilter.go tunnel/peerfilter_test.go tunnel/entrypoint
git -C /root/code/go-gost/wisper commit -m "feat(tun): enforce local peer block on the device path"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 5: `tun-share` shim block policy

**Files:**
- Modify: `tunnel/shareconnector.go`
- Modify: `tunnel/share_spoke.go`
- Test: `tunnel/shareconnector_test.go`, `tunnel/share_spoke_test.go`

**Interfaces:**
- `NewChainShareShim(lans []*net.IPNet, stack ShareStackBackend, policy *PeerFilter) *ChainShareShim` (add parameter; update all callers/tests).
- `shareConnector.Init` reads `block_policy` from metadata as `*PeerFilter`; `NewShareConnector`/tests pass nil when absent.
- `chainShareConn.Read` (hub → device/stack) checks `policy.BlockedSrc(pkt)` before `shareClassify`; `Write` and `pumpStack` (device/stack → hub) check `policy.BlockedDst(pkt)`.
- A nil/empty policy is the original behavior, no drop/counter.
- `tunEntryPoint.init` puts the filter pointer in the `tun-share` connector metadata only when `ShareMode` resolves to userspace (or always; nil/empty is inert).

- [ ] **Step 1: Write failing tests**

- `TestShareShimBlocksInboundLAN`: a blocked peer's packet to a shared LAN is dropped before the stack; allowed peer passes.
- `TestShareShimBlocksOutbound`: stack reply/outbound to a blocked peer is dropped.
- `TestShareShimNilPolicyUnchanged`: existing share tests pass with nil policy; no drops.
- `TestConnectorReadsBlockPolicy`: metadata pointer survives `Init` and `Connect`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel -run 'TestShareShim' -count=1`
Expected: FAIL — signature/metadata not present.

- [ ] **Step 3: Implement**

Add the policy parameter and checks at the three write/read paths. Keep `Dropped()` semantics: policy drops increment the same dropped counter, or a separate `blocked` counter; the UI only needs a non-zero signal. Do not close the shim on a policy drop.

- [ ] **Step 4: Run tests**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/shareconnector.go tunnel/share_spoke.go tunnel/share*_test.go
git -C /root/code/go-gost/wisper commit -m "feat(tun): apply local peer block to the userspace share shim"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 6: Peer-list API, blocked-peers PUT, and full-PUT preservation

**Files:**
- Modify: `api/server.go`
- Modify: `api/entrypoint_handler.go`
- Test: `api/entrypoint_peers_test.go` (new), `api/api_test.go`

**Interfaces:**
- Routes:
  ```http
  GET /api/entrypoints/{id}/peers
  PUT /api/entrypoints/{id}/peers
  ```
- `GET` response `{ "peers": [ {key,name,ips,lans,state,blocked,direct,disabled,transport,dialed_locally,rtt_ms,input_bytes,output_bytes} ] }`; only a tun entrypoint; 400 otherwise.
- `PUT` body `{ "blocked": *[]string }`; absent = unchanged, explicit empty = clear; validate `tunnel.ValidPeerKey`, dedupe; call `entrypoint.BlockedPeersSetter.SetBlockedPeers`; `entrypoint.SaveConfig`; return the new list.
- `entrypointCreateRequest.BlockedPeers *[]string`; create absent = nil; update absent = old options' list; explicit empty = clear. `toOptions` maps it to `BlockedPeersOption`.
- `tunnelOptionsResp.BlockedPeers []string`.
- Full entrypoint PUT preserves omitted fields; the peers PUT does not restart the entrypoint.

- [ ] **Step 1: Write failing tests**

- `TestEntrypointPeersGET`: seed a tun entrypoint with netview members/claims; GET returns hub + rows; non-tun 400.
- `TestEntrypointPeersPUT`: block B; filter/policy and response update; no restart (test seam counts starts); unblock; persist.
- `TestEntrypointPeersInvalidKey` and duplicate key 400.
- `TestEntrypointFullPutPreservesBlockedPeers`: omit field → preserved; explicit [] → cleared.
- Existing API tests pass unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./api -run 'TestEntrypointPeers|TestEntrypointFullPutPreserves' -count=1`
Expected: FAIL — route/handlers undefined.

- [ ] **Step 3: Implement**

Register the two routes in `api/server.go`. Add the request/response types. Type-assert the running entrypoint to `tunnel.PeerListReporter`/`tunnel.BlockedPeersSetter`; if stopped, `SetBlockedPeers` still updates options. Save config after a successful PUT. Echo the list via the reporter. Keep the full PUT’s `BlockedPeers` pointer semantics.

- [ ] **Step 4: Run tests**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add api
git -C /root/code/go-gost/wisper commit -m "feat(api): expose tun entrypoint peers and local block"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 7: Peer-list page, detail card, types, and i18n

**Files:**
- Modify: `web-src/src/api/types.ts`
- Modify: `web-src/src/api/backend.ts`
- Create: `web-src/src/pages/entrypoint-peers-page.ts`
- Modify: `web-src/src/router/routes.ts`
- Modify: `web-src/src/pages/entrypoint-detail-page.ts`
- Modify: `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`
- Modify: `web-src/src/styles/*` if the page needs shared row styles
- Build: `web/assets` (tracked)

**Interfaces:**
- Types `EntryPeer` and `EntrypointPeersResponse`; `Entrypoint.options.blocked_peers`.
- Backend methods `listEntrypointPeers(id)`, `updateEntrypointPeers(id, blocked)`.
- Route `/entrypoint/:type/:id/peers` renders `<entrypoint-peers-page>`; detail page adds a “Peers” card/link and shows blocked count.
- Page rows: hub first (read-only), member rows (alias/key/IPs/LANs/state/direct-off/blocked), stale blocked rows (unblock). One `Block` switch per row; a hint that it is local and does not change hub membership; refresh on a 5s poll and after a save.
- i18n: all new copy through `t()`; en/zh key sets identical; keep technical terms (TUN, P2P, DERP, RTT, ID, IP) untranslated.

- [ ] **Step 1: Write failing type/build tests**

Add a small page test or at least the type imports; run:
```bash
cd /root/code/go-gost/wisper/web-src
npx tsc --noEmit
```
Expected: FAIL — missing types/methods/page.

- [ ] **Step 2: Implement types, backend, page, route, card, i18n**

Follow `tunnel-peers-page.ts` for row structure but do not add/edit allowlist rows. The spoke page has no add/remove/alias/IP edit. Use short-key masking with the existing `maskKey`.

- [ ] **Step 3: Build and verify**

```bash
cd /root/code/go-gost/wisper/web-src
npx tsc --noEmit
npx vite build
```
Expected: PASS; `web/assets` refreshed. If the repo’s web-e2e suite has a navigation test, add the new route assertion.

- [ ] **Step 4: Commit**

```bash
git -C /root/code/go-gost/wisper add web-src web/assets
git -C /root/code/go-gost/wisper commit -m "feat(web): add tun entrypoint peer list and local block UI"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 8: Full verification and regression gate

**Files:** none expected; fix only failures caused by this plan.

- [ ] **Step 1: Tunnel package tests**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./tunnel -count=1`
Expected: PASS.

- [ ] **Step 2: All wisper Go tests (per package)**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test -p 1 ./... -count=1`
Expected: PASS. Report any unrelated failure; do not patch it to fit.

- [ ] **Step 3: Build/vet and Android compile**

```bash
cd /root/code/go-gost/wisper
GOWORK=off go build ./...
GOWORK=off go vet ./...
GOWORK=off GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build ./tunnel/... ./api/...
```
Expected: PASS. The full cgo/APK build is a Plan 3/e2e gate; this catches Android build tags in the touched packages.

- [ ] **Step 4: Web build**

Run the Task 7 tsc/vite commands. Expected: PASS.

- [ ] **Step 5: No x/p2p changes**

Run: `git -C /root/code/go-gost/x status --short` and `git -C /root/code/go-gost/p2p status --short`.
Expected: no changes from this plan. If x/p2p are dirty, stop and report.

- [ ] **Step 6: Commit any final test fixes**

```bash
git -C /root/code/go-gost/wisper add tunnel api config web-src web/assets
git -C /root/code/go-gost/wisper commit -m "test(tun): verify control plane, local block, and peer list"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —
