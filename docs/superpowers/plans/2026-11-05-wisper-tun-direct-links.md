# Plan 3: Wisper tun spoke direct links

**Goal:** Turn the completed x mesh handler and the Plan 2 control/ACL plane into
an opt-in direct spoke-to-spoke data path. A direct-enabled spoke keeps the
existing hub chain as its fallback, dials members on demand over the shared p2p
host, accepts inbound direct streams only from current members, and never
changes the default (`direct=false`) path.

**Design:** `docs/superpowers/specs/2026-11-04-wisper-tun-spoke-direct-design.md`
**Prerequisite:** Plan 1 (`x/tun/mesh.go`, merged) and Plan 2 (`direct` control
fields, netview members, block/peer list, merged).

**Hard constraints**
- `direct=false`: do not install a mesh handler, do not claim mesh peer keys,
  and keep the existing `tun` handler/service path byte-for-byte.
- Mixed versions: an old hub publishes no `Direct` capability, so no spoke
  dials; an old spoke never sets the capability, so no peer treats it as a
  target.
- Local `blocked_peers` wins over direct: a blocked member gets no link, its
  inbound direct stream is rejected/closed, and the device filter still drops
  its packets on the hub path.
- Explicit p2p tunnel/entrypoint ownership of a peer key always wins over a
  mesh route. Mesh yields immediately; p2p registration never fails because of
  mesh.
- The hub link continues through the existing chain (`forward` or `tun-share`
  connector), so `share_mode=userspace`, `record_mode`, and LAN behavior are
  unchanged.

---

### Task 1: `direct` option, persistence, API, and form

**Files:**
- Modify: `tunnel/tunnel.go` (`Options`, `DirectOption`, `TunnelOptions`)
- Modify: `config/config.go`
- Modify: `tunnel/entrypoint/entrypoint.go` (Load/Save/restart copies)
- Modify: `api/entrypoint_handler.go`, `api/tunnel_handler.go`
- Modify: `web-src/src/api/types.ts`, `web-src/src/pages/entrypoint-detail-page.ts`, i18n
- Build: `web/assets`
- Test: `tunnel/entrypoint/peerlist_test.go` or a new `direct_option_test.go`, `api/entrypoint_peers_test.go`

**Interfaces:**
- `tunnel.Options.Direct bool`; `func DirectOption(bool) Option`; included in
  `TunnelOptions`.
- `config.Tunnel.Direct bool` with `yaml:"direct,omitempty" json:"direct,omitempty"`.
- Entrypoint request/response `direct`; full PUT omitted `direct` preserves the
  old value, exactly like `blocked_peers` (a pointer on the request).
- The tun detail form gets a “Direct links” switch. It is only rendered for
  `tun`, defaults off, and is copied into `EntrypointCreateRequest`.
- `ControlChannelConfig.Direct bool` and `claimMessage.Direct` are wired in the
  control session, but `StartNetview` keeps sending false until Task 3 installs
  the mesh runtime. This prevents an intermediate build from advertising a
  capability it cannot serve.

- [x] **Step 1: Write failing tests**

- `TestDirectOptionRoundTrip`: option → `Options()`; config save/load and
  `TunnelOptions` carry it; true survives a replacement; false is omitted.
- `TestEntrypointFullPutPreservesDirect`: omitted keeps true; explicit false
  clears.
- Existing API/web tests pass.

- [x] **Step 2: Run tests to verify they fail**

`GOWORK=off go test ./tunnel/entrypoint ./api -run 'TestDirect|TestEntrypointFullPutPreservesDirect' -count=1`

- [x] **Step 3: Implement**

Follow the `blocked_peers` pointer pattern. Add the field to every copy path:
`LoadConfig`, `SaveConfig`, `restartRunning`, `Restart` (via `Options`), API
create/update, and `TunnelOptions`. The detail form sends `direct` only for a
tun entrypoint. Rebuild the web assets.

- [x] **Step 4: Run tests**

`GOWORK=off go test ./tunnel/entrypoint ./api -run 'TestDirect|TestEntrypointFullPutPreservesDirect' -count=1`

- [x] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel config api web-src web/assets
git -C /root/code/go-gost/wisper commit -m "feat(tun): add the opt-in direct-links setting"
```

**Implementation record**
- Date/status: 2026-11-05 / complete
- Repo/commit: wisper / 63f9651
- Files changed: `tunnel/tunnel.go`, `config/config.go`, `tunnel/netview_router.go`, `tunnel/entrypoint/entrypoint.go`, `tunnel/entrypoint/direct_option_test.go`, `tunnel/netview_router_test.go`, `api/entrypoint_handler.go`, `api/tunnel_handler.go`, `api/entrypoint_peers_test.go`, `web-src/src/api/types.ts`, `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`, `web-src/src/pages/entrypoint-detail-page.ts`, `web/index.html`, `web/assets/*`
- Tests: targeted `TestDirectOption|TestEntrypointFullPutPreservesDirect|TestKeepClaimFresh` PASS; full `GOWORK=off go test ./tunnel/... -count=1` PASS; `npx tsc --noEmit` PASS; `npx vite build` PASS; `go vet ./tunnel/... ./api` PASS.
- Review findings/fixes: `direct` is a `*bool` on the request so an omitted full PUT preserves the old value and explicit `false` clears it; the control claim now carries `Direct` through both the first claim and the refresh, but `StartNetview` leaves the config field false until Task 3 installs the mesh listener. The web form always sends the tun switch's explicit state, so editing other fields cannot silently change direct.
- Deferred/limitations: a saved `direct=true` does not advertise the capability yet (the control config stays false until Task 3); the runtime and direct links are Tasks 3/4. Full API suite is deferred to Task 6.

---

### Task 2: Mesh route with explicit-p2p priority

**Files:**
- Modify: `tunnel/p2p_host.go`
- Test: `tunnel/p2p_host_test.go`

**Interfaces:**
- New exported `tunnel.MeshRoute` with:
  ```go
  func RegisterMeshRoute(peers []string) (*MeshRoute, error)
  func (r *MeshRoute) Reconcile(peers []string) []string // keys actually claimed
  func (r *MeshRoute) Peers() []string
  func (r *MeshRoute) Init(metadata.Metadata) error
  func (r *MeshRoute) Accept() (net.Conn, error)
  func (r *MeshRoute) Addr() net.Addr
  func (r *MeshRoute) Close() error
  ```
  It satisfies `listener.Listener`, so the mesh service can serve it directly.
- `p2pHostManager` keeps `meshRoutes map[string]*peerListener` and a
  `meshKnown map[string]struct{}` separate from the explicit `routes`.
- `Reconcile` claims only keys not in `routes`; keys held by an explicit p2p
  route are skipped and returned as not claimed.
- Explicit `register`/`reconcile` preempts a mesh key: it removes the key from
  the mesh listener's route (without closing the listener) and invokes the
  mesh route's `onPreempt` callback. The explicit route always succeeds.
- `dispatch` checks explicit routes first, then mesh routes. Mesh routes carry
  raw tun datagrams and never run the control-channel demux.
- `notePending` skips every key in `meshKnown` even after it is preempted, so a
  mesh member never appears in the p2p tunnel pending list.
- Unregistering an explicit route does not close mesh routes; the next
  `Reconcile` may claim the key again.

- [x] **Step 1: Write failing tests**

- `TestMeshRouteClaimsOnlyFreeKeys`: mesh claims A/B, skips an explicitly held
  C; `Peers()` and Accept routing match.
- `TestExplicitRoutePreemptsMesh`: mesh holds A; explicit registration for A
  succeeds, mesh Peers loses A, callback fires once; dispatch sends a new A
  stream to the explicit listener.
- `TestMeshReclaimsAfterExplicitRemoved`: unregister explicit A; reconcile
  claims A again.
- `TestMeshKnownKeyIsNotPending`: a refused/unknown key still becomes pending;
  a mesh-known key does not.
- Existing p2p host route tests pass.

- [x] **Step 2: Run tests**

`GOWORK=off go test ./tunnel -run 'TestMeshRoute|TestExplicitRoute|TestMeshReclaims|TestMeshKnown' -count=1`

- [x] **Step 3: Implement**

Keep the existing explicit `routes` map semantics. Add the mesh map and a
small route wrapper rather than changing every existing caller. Preemption
must not close the mesh listener: it only removes the key from its `peers` and
notifies the owner to drop its link and fall back to the hub. A mesh route is
closed only by its owner.

- [x] **Step 4: Run tests**

The Step 2 command.

- [x] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/p2p_host.go tunnel/p2p_host_test.go
git -C /root/code/go-gost/wisper commit -m "feat(tun): give mesh routes second priority to explicit p2p"
```

**Implementation record**
- Date/status: 2026-11-05 / complete
- Repo/commit: wisper / 428aa22
- Files changed: `tunnel/p2p_host.go`, `tunnel/p2p_host_test.go`
- Tests: `GOWORK=off go test ./tunnel -run 'TestMeshRoute|TestExplicitRoute|TestMeshReclaims|TestMeshKnown' -count=1` PASS; the same under `-race` PASS; all `TestP2PHost|TestMesh` PASS; `GOWORK=off go vet ./tunnel` PASS.
- Review findings/fixes: `reconcileMesh` updates the listener's peers while holding the host lock, closing the window where a concurrent explicit preemption could be overwritten by a stale reconcile. Explicit registration preempts mesh only after its whole allowlist is validated, so a rejected explicit list changes nothing; the callback is read under the host lock to avoid a race with `SetPreempt`. `MeshRoute` compiles against both `listener.Listener` and `net.Listener`.
- Deferred/limitations: only one mesh route holder is expected (the one direct-enabled entrypoint); a second mesh route skips keys already owned by the first. `meshKnown` entries survive preemption on purpose, so a member's knock never lands in the pending list while it is still a member.

---

### Task 3: Mesh runtime, device supervisor, and hub link

**Files:**
- Create: `tunnel/entrypoint/direct.go`
- Modify: `tunnel/entrypoint/tun.go`
- Modify: `tunnel/entrypoint/netview.go`
- Test: `tunnel/entrypoint/direct_test.go`, `tunnel/entrypoint/tun_test.go`

**Interfaces:**
- `directRuntime` owns:
  - the x `tunhandler.MeshHandler`
  - a `*tunnel.MeshRoute`
  - a device supervisor loop
  - a hub-link dial loop
  - the local key (`host.PublicKey()`), hub key (`s.peer`), local tun IPs
  - the chain/dial closure for the hub (the existing chain, never a bare
    `host.Dial`, so `tun-share` and `record_mode` stay in the path)
- In `tunEntryPoint.RunContext`, after the tun listener's `Init`:
  - if `s.opts.Direct` is false, build the existing `tun` handler/service exactly
    as today;
  - if true:
    - build `MeshConfig{LocalKey, HubKey, LocalIPs}` from `s.opts.Net`;
    - `mesh := tunhandler.NewMeshHandler(cfg, handler.LoggerOption(...))`;
    - `route := tunnel.RegisterMeshRoute(nil)`;
    - build the mesh service over `route` + `mesh`, sharing the same `pStats`
      as the device listener;
    - start the device supervisor: `Accept` a device, wrap it with
      `s.filter`, call `mesh.RunDevice(conn)`; after a device ends, accept the
      next one;
    - start the hub dial loop: parse the existing chain once per attempt, dial
      the hub key, `mesh.SetHubLink(conn)`; on close redial after 1s;
    - set `s.mesh`, `s.direct`, `s.deviceLn`, and start the control channel with
      `Direct: true`.
- Device-address changes still restart the entrypoint (the hub allocation must
  be re-registered); a same-address device replacement only swaps the device
  under `RunDevice`, preserving links.
- `Close` must close the supervisor, runtime, mesh service, device listener,
  route, and shared host reference exactly once.
- `PeerList` remains the Plan 2 view while no mesh status exists; Task 5 joins
  live mesh status.

- [ ] **Step 1: Write failing tests**

- `TestDirectRuntimeBuildsMeshService`: with a fake device listener and a
  test-chain dialer, the service is the mesh service and the device supervisor
  calls `RunDevice` with the filter-wrapped conn.
- `TestDirectDeviceReplacementKeepsRuntime`: two fake devices; the runtime is
  the same instance and links/membership survive (use a mesh fake).
- `TestDirectHubLinkRedials`: hub dial returns a pipe, closes it, assert a
  second dial after the retry interval (short test seam).
- `TestDirectPathDoesNotInstallOldHandler`: direct true never constructs the
  old `tun` handler service.
- Existing `direct=false` tests pass unchanged.

- [ ] **Step 2: Run tests**

`GOWORK=off go test ./tunnel/entrypoint -run 'TestDirect' -count=1`

- [ ] **Step 3: Implement**

The hub chain must be the same `s.config.Chains[0]` used today. Do not replace
it with `host.Dial`; the userspace `tun-share` connector is what keeps LAN
sharing working. The mesh handler owns the device; the tun listener no longer
has a gost service of its own on the direct path. Keep the listener's stats
object shared with the mesh service so the existing stats task reports the
device's total bytes once.

- [ ] **Step 4: Run tests**

The Step 2 command; then `GOWORK=off go test ./tunnel/entrypoint -count=1`.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/entrypoint
git -C /root/code/go-gost/wisper commit -m "feat(tun): install the mesh runtime and hub link"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 4: On-demand direct manager

**Files:**
- Modify: `tunnel/entrypoint/direct.go`
- Test: `tunnel/entrypoint/direct_test.go`

**Interfaces:**
- `directRuntime.Refresh(members []tunnel.NetviewMember, claims []tunnel.NetviewClaim, blocked []string)`:
  - builds the x `MeshMember` table (one member per hub member, `Direct` only
    for members with the capability, `Blocked` from the local list, `Disabled`
    from the hub);
  - `mesh.SetMembers`;
  - reconciles the mesh route to the direct-capable, non-blocked, non-disabled
    member keys;
  - drops links for members that became blocked/disabled/non-direct.
- `mesh.SetDirectNeeded` → coalesced one dial per peer:
  - `host.PunchContext(ctx, peer)`, then `host.Dial(ctx, "ip", peer)`;
  - `mesh.AddDialedLink(peer, conn)`;
  - 10s first-ready timeout (poll `MeshStatus` or the close callback) then
    `mesh.DropLink(peer)`;
  - backoff 1s/5s/30s/5m with jitter; reset on ready.
- `mesh.SetLinkClosed`:
  - hub key: redial loop owns it; do not backoff;
  - failure reasons (`remote`, `unhealthy`, `write`, `dial`): schedule backoff
    for that peer;
  - `idle`, `dedup`, `membership`, `blocked`, `shutdown`: no redial.
- The runtime reconciles route ownership on every netview and on the route's
  preemption callback. A preempted peer is removed from direct claims, its link
  is dropped as membership, and it falls back to the hub. Reconcile can reclaim
  it after the explicit route disappears.
- `Refresh` is also called by `SetBlockedPeers`; no entrypoint restart.

- [ ] **Step 1: Write failing tests**

- `TestDirectManagerDialsOnDemand`: one allowed member; `DirectNeeded` triggers
  one Punch + Dial; `AddDialedLink` receives the conn; a second signal while
  in-flight does not dial twice.
- `TestDirectManagerBacksOff`: dial failure waits/retries with a short test
  backoff; a successful link resets it.
- `TestDirectManagerSkipsBlockedDisabledSelfHub`: no dial and no route claim.
- `TestDirectManagerRefreshesMembership`: a member removed/direct-off/blocked
  closes its link with the right reason; a new member becomes claimable.
- `TestDirectManagerPreemption`: explicit p2p preemption removes the route,
  drops the link, and falls back to hub; after release a reconcile reclaims.
- `TestDirectManagerHubCloseRedials`: hub close triggers a redial, independent
  of direct links.
- `TestDirectManagerIdleNoRedial`: `MeshCloseIdle`/`Dedup`/`Membership` do not
  schedule a redial.

- [ ] **Step 2: Run tests**

`GOWORK=off go test ./tunnel/entrypoint -run 'TestDirectManager' -count=1`

- [ ] **Step 3: Implement**

Use a `directHost` interface (`PunchContext`, `Dial`) and a `dialHub` closure
so tests need no relay. All callbacks may run on the device reader or link
reader: never block them; schedule dials on a bounded worker or a per-peer
goroutine with a context. Close cancels every goroutine and waits for the hub
loop and device supervisor.

- [ ] **Step 4: Run tests**

The Step 2 command; then `GOWORK=off go test ./tunnel/entrypoint -count=1` and
`-race` on the direct tests.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/entrypoint/direct.go tunnel/entrypoint/direct_test.go tunnel/entrypoint/tun.go
git -C /root/code/go-gost/wisper commit -m "feat(tun): dial direct member links on demand"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 5: Peer-list/status join and block integration

**Files:**
- Modify: `tunnel/entrypoint/tun.go`
- Modify: `tunnel/peerlist.go` if the exported row needs a new field
- Modify: `web-src/src/pages/entrypoint-peers-page.ts` (render direct/connecting,
  transport, bytes) and i18n
- Build: `web/assets`
- Test: `tunnel/entrypoint/peerlist_test.go`, `api/entrypoint_peers_test.go`

**Interfaces:**
- `PeerList` uses `mesh.MeshStatus()` when the mesh runtime exists:
  - hub first, members sorted, stale blocked keys last;
  - state from mesh (`direct`, `connecting`, `hub`, `direct-off`, `blocked`,
    `disabled`);
  - `DialedLocally`, `InputBytes`, `OutputBytes` from mesh;
  - `Transport` from `tunnel.P2PHostStatus().PeerTransports[key]` when present;
  - `Blocked` from the local list, `Direct`/`Disabled` from the netview.
- `SetBlockedPeers` updates the filter and the runtime in place. A newly blocked
  peer is removed from the mesh route, its link is closed as blocked, and a
  stale blocked row remains visible. Unblocking lets the next netview/reconcile
  claim it again.
- The web page shows the real state/transport/bytes columns. It still has no
  add/remove/allowlist controls.
- The API response already carries the fields; no new endpoint.

- [ ] **Step 1: Write failing tests**

- `TestPeerListJoinsMeshStatus`: direct/connecting/blocked/disabled rows,
  `DialedLocally`, bytes, transport; hub first; stale blocked last.
- `TestSetBlockedPeersDropsDirectLink`: runtime receives the new membership and
  route; a blocked peer is removed; unblocked is claimable.
- `TestPeerListDirectOffWithoutRuntime`: direct false keeps Plan 2 behavior.
- Existing API/UI tests pass.

- [ ] **Step 2: Run tests**

`GOWORK=off go test ./tunnel/entrypoint -run 'TestPeerListJoins|TestSetBlockedPeersDrops' -count=1`
and `cd web-src && npx tsc --noEmit && npx vite build`.

- [ ] **Step 3: Implement**

Do not duplicate the mesh member table: the handler is the source for live link
state, the netview router for names/IPs/LANs, and `blocked_peers` for local
policy. Keep the Plan 2 hub/stale rows when the mesh runtime is absent.

- [ ] **Step 4: Run tests**

The Step 2 commands; then the full entrypoint/API suites.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/wisper add tunnel/entrypoint web-src web/assets
git -C /root/code/go-gost/wisper commit -m "feat(tun): show direct link state in the spoke peer list"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 6: End-to-end and regression gate

**Files:** no production changes expected; fix only failures caused by this plan.

- [ ] **Step 1: Unit/race suites**

```bash
cd /root/code/go-gost/wisper
GOWORK=off go test -p 1 ./... -count=1
GOWORK=off go test -race ./tunnel ./tunnel/entrypoint -count=1
```

- [ ] **Step 2: Build/vet/Android/web**

```bash
GOWORK=off go build ./...
GOWORK=off go vet ./...
GOWORK=off GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build ./tunnel/... ./api/...
cd web-src && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Direct-path integration**

Add or run the opt-in integration test with three nodes (hub + A + B):
- A/B direct=true; A pings B; `MeshStatus` reports direct; B replies direct.
- Block B on A: no direct link, A↔B traffic drops, hub membership unchanged;
  unblock restores on demand.
- Stop B's direct: A falls back to hub and reconnects when B returns.
- Explicit p2p route for B preempts mesh; deleting it lets mesh reclaim.
- Old hub (no `Direct` capability): A/B stay on the hub path.
- `share_mode=userspace` hub link still works, and LAN traffic never uses a
  direct link.
- Device replacement (fake or Android) preserves direct links.

If the repository has no relay-backed harness for this, mark the integration
case opt-in and record the missing coverage explicitly; do not claim an e2e that
was not run.

- [ ] **Step 4: No x/p2p changes**

`git -C /root/code/go-gost/x status --short` and
`git -C /root/code/go-gost/p2p status --short`. Report pre-existing untracked
files; do not touch them.

- [ ] **Step 5: Commit final test fixes**

```bash
git -C /root/code/go-gost/wisper add tunnel api config web-src web/assets
git -C /root/code/go-gost/wisper commit -m "test(tun): verify direct spoke links"
```

**Implementation record**
- Date/status: pending
- Repo/commit: wisper / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —
