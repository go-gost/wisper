# x tun mesh handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable spoke-side tun mesh handler in x that owns one tun device, routes member-IP traffic over direct or hub p2p links, and exposes per-peer state — without changing any existing handler.

**Architecture:** A new `meshHandler` in `x/handler/tun` (new files, existing constructors untouched) owns the device via `RunDevice`, keeps a hub link plus on-demand direct links, and routes each device packet by destination member IP. Links have bounded send queues and writer goroutines so the device reader never blocks; inbound direct packets are validated against the member snapshot and never forwarded to another peer.

**Tech Stack:** Go 1.26, `github.com/go-gost/x` module, `core/handler` + `core/logger`, existing `x/handler/tun` test harness (`datagramPipe`, `compatDevice`, `compatTunDevice`).

**Spec:** `/root/code/go-gost/wisper/docs/superpowers/specs/2026-11-04-wisper-tun-spoke-direct-design.md`

## Scope

This is **Plan 1 of 3**. It changes only `x/handler/tun` and produces a unit-tested library handler; no wisper or p2p changes.

- Plan 1 (this file): x mesh handler.
- Plan 2: wisper control plane (`Direct`/`Name`/`Disabled`/`Gen`), peer list API/UI, local inbound block/filter, `tun-share` policy.
- Plan 3: wisper direct link manager, shared-host mesh routes/preemption, entrypoint wiring, e2e/Android.

## Global Constraints

- Do not change the behavior of `NewHandler` (socket/client), `NewP2PHandler` (hub), `p2pHub`, or `peerTable` used by them. New behavior lives on the new mesh path only.
- Comments in English only.
- No new module dependencies. Reuse existing package helpers (`destinationOf`, `isTunFrame`, `isKeepaliveFrame`, `isRegistrationFrame`, `keepAliveReply`, `keepAliveHeaderLength`, `magicHeader`, `MaxMessageSize`, `ErrTun`, `ErrNoRoute`).
- Do not modify existing tests to accommodate the new handler. Add new test files/helpers instead.
- Default/empty inputs must not panic: no members, no hub link, no local IPs, nil callbacks, repeated `Close`.
- Run x tests with `GOWORK=off` (module graph); run race with `CGO_ENABLED=1`.
- Commit after each task. Do not push. Record the x commit SHA in the task's Implementation record; update the plan in the wisper repo and commit that record separately (the plan lives in wisper). After each task's x commit, fill the record and commit the spec + plan in wisper; the first such commit also adds the spec/plan files.
- Any test-only timeouts are package vars, like `p2pRegisterInterval`, so tests can shrink them.

## Review Focus

1. A stalled direct link must never block the single device reader: every link write goes through a bounded queue; full direct queue falls back to hub, full hub queue drops with a counter.
2. Inbound direct packets for a destination other than one of the local tun addresses must be dropped, never written to the device or forwarded to another peer.
3. Duplicate inbound/outbound links for one peer must converge on the preferred dialer (`dialer key` lexicographically smaller); a `dedup` close must not trigger a redial.
4. A device replacement (`RunDevice` called again after the previous device closes) must keep links, route subsequent packets to the new device, and not panic on late writes.
5. Empty/disabled inputs (no members, no hub link, `Blocked`/`Disabled` members, nil callbacks, `Close` twice) must be inert, not panic and not accidentally drop all traffic.

---

### Task 1: Mesh types, membership, and status

**Files:**
- Create: `handler/tun/mesh.go`
- Create: `handler/tun/mesh_test.go`

**Interfaces:**
- Produces:
  ```go
  type MeshMember struct {
      IP       net.IP
      Key      string
      Name     string
      Direct   bool
      Blocked  bool
      Disabled bool
  }
  type MeshCloseReason string // remote/unhealthy/write/dial/idle/dedup/membership/blocked/shutdown
  const (
      MeshCloseRemote     MeshCloseReason = "remote"
      MeshCloseUnhealthy  MeshCloseReason = "unhealthy"
      MeshCloseWrite      MeshCloseReason = "write"
      MeshCloseDial       MeshCloseReason = "dial"
      MeshCloseIdle       MeshCloseReason = "idle"
      MeshCloseDedup      MeshCloseReason = "dedup"
      MeshCloseMembership MeshCloseReason = "membership"
      MeshCloseBlocked    MeshCloseReason = "blocked"
      MeshCloseShutdown   MeshCloseReason = "shutdown"
  )
  type MeshPeerStatus struct {
      Key, Name string
      IPs []string
      State string // direct/connecting/hub/blocked/disabled/direct-off
      DialedLocally bool
      Since, LastInbound time.Time
      BytesIn, BytesOut uint64
      BlockedPackets, BlockedBytes uint64
  }
  type MeshConfig struct {
      LocalKey string
      HubKey   string
      LocalIPs []net.IP
  }
  type MeshHandler interface {
      handler.Handler
      RunDevice(conn net.Conn) error
      SetMembers(members []MeshMember)
      SetHubLink(conn net.Conn)
      AddDialedLink(peer string, conn net.Conn)
      DropLink(peer string)
      SetDirectNeeded(func(peer string))
      SetLinkClosed(func(peer string, reason MeshCloseReason))
      MeshStatus() []MeshPeerStatus
  }
  func NewMeshHandler(cfg MeshConfig, opts ...handler.Option) MeshHandler
  ```
- Produces `meshHandler` (unexported) with: `cfg`, `log`, `mu`, `members map[string]MeshMember`, `memberByIP map[netip.Addr]string`, `links map[string]*meshLink`, `hub *meshLink`, `device net.Conn`, `closed bool`, callbacks.
- `Init(md md.Metadata) error { return nil }`, idempotent `Close() error`.

- [ ] **Step 1: Write the failing tests**

Add to `handler/tun/mesh_test.go`:

```go
func TestMeshSetMembersStatus(t *testing.T) {
    h := NewMeshHandler(MeshConfig{LocalKey: "local", HubKey: "hub",
        LocalIPs: []net.IP{net.ParseIP("10.0.0.1")}},
        handler.LoggerOption(compatLogger())).(*meshHandler)

    h.SetMembers([]MeshMember{
        {IP: net.ParseIP("10.0.0.2"), Key: "b", Name: "B", Direct: true},
        {IP: net.ParseIP("10.0.0.3"), Key: "c", Direct: true, Blocked: true},
        {IP: net.ParseIP("10.0.0.4"), Key: "d", Direct: false},
    })
    st := h.MeshStatus()
    // hub first, then b, c, d in key order
    // b state "hub" (no link), c state "blocked", d state "direct-off"
}

func TestMeshCloseIsIdempotent(t *testing.T) {
    h := NewMeshHandler(MeshConfig{}, handler.LoggerOption(compatLogger()))
    if err := h.Close(); err != nil { t.Fatalf("first Close: %v", err) }
    if err := h.Close(); err != nil { t.Fatalf("second Close: %v", err) }
}
```

Also assert `SetMembers(nil)` leaves only the hub row and does not panic.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/code/go-gost/x && GOWORK=off go test ./handler/tun -run 'TestMeshSetMembersStatus|TestMeshCloseIsIdempotent' -count=1`
Expected: FAIL — `NewMeshHandler` undefined.

- [ ] **Step 3: Implement the types, constructor, membership map, status, and Close**

Build `memberByIP` from every member IP. `MeshStatus` returns a hub row first (`State: "hub"`, `Key: cfg.HubKey`) then members sorted by key. State priority: `blocked` > `disabled` > `direct` (if a ready link exists) > `connecting` (link exists, not ready) > `direct-off` (not Direct) > `hub`. `IPs` is sorted as strings. `Close` sets `closed` under the lock and closes every link/device (no-op if none). Nil logger falls back to `xlogger.Nop()`.

- [ ] **Step 4: Run test to verify it passes**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /root/code/go-gost/x add handler/tun/mesh.go handler/tun/mesh_test.go
git -C /root/code/go-gost/x commit -m "feat(tun): add mesh handler types and membership"
```

**Implementation record**
- Date/status: 2026-11-05 / complete
- Repo/commit: x / 16784e5 (`feat/tun: add mesh handler types and membership`)
- Files changed: `x/handler/tun/mesh.go`, `x/handler/tun/mesh_test.go`
- Tests: `GOWORK=off go test ./handler/tun -run 'TestMeshSetMembersStatus|TestMeshCloseIsIdempotent' -count=1` → PASS; `GOWORK=off go test ./handler/tun -count=1` → ok 28.175s
- Review findings/fixes: Task 1 originally planned the full `MeshHandler` interface; TDD kept only `SetMembers`/`MeshStatus`/`Close` here, with `handler.Handler` and link methods added by the tasks that test them. `Ruling` recorded in the SDD ledger.
- Deferred/limitations: `RunDevice`, link installation, and `handler.Handle` arrive in Tasks 2–4.

---

### Task 2: Link abstraction with bounded queues, writer, registration sender, and liveness

**Files:**
- Create: `handler/tun/mesh_link.go`
- Create: `handler/tun/mesh_link_test.go`

**Interfaces:**
- Produces:
  ```go
  var meshQueueDepth = 256
  var meshFirstInboundTimeout = 30 * time.Second
  var meshInboundTimeout = 30 * time.Second
  var meshRegisterInterval = 10 * time.Second
  var meshIdleTimeout = 5 * time.Minute
  var meshWriteTimeout = 30 * time.Second

  type meshLink struct {
      key string
      conn net.Conn
      dialedLocally bool
      hub bool
      send chan []byte
      done chan struct{}
      closeOnce sync.Once
      ready atomic.Bool
      since time.Time
      lastInbound atomic.Int64 // unix nanos
      lastTraffic atomic.Int64
      bytesIn, bytesOut atomic.Uint64
      onClose func(*meshLink, MeshCloseReason)
  }
  func newMeshLink(key string, conn net.Conn, dialedLocally, hub bool, onClose func(*meshLink, MeshCloseReason)) *meshLink
  func (l *meshLink) enqueue(pkt []byte) bool
  func (l *meshLink) close(reason MeshCloseReason)
  func (l *meshLink) markInbound()
  func (l *meshLink) start(first []byte, registration []byte, onFrame func([]byte) error)
  ```
- `enqueue` copies `pkt`, never blocks: `select { case send <- cp: ...; case <-done: false; default: false }`. It updates `lastTraffic`.
- `start` launches `writeLoop`, `readLoop(first, onFrame)`, `keepaliveLoop(registration)`, and `watchdog`; any goroutine error calls `close`.
- `writeLoop` sets a write deadline before each `conn.Write`; on error closes with `MeshCloseWrite`.
- `readLoop` reads whole datagrams (`MaxMessageSize`), calls `markInbound`, updates `bytesIn`, and calls `onFrame`; a zero-length read is skipped; an error closes with `MeshCloseRemote`.
- `keepaliveLoop` writes `registration` immediately, then every `meshRegisterInterval`, and closes with `MeshCloseWrite` on error.
- `watchdog` closes with `MeshCloseDial` if no inbound before `meshFirstInboundTimeout`; after ready, closes with `MeshCloseUnhealthy` after `meshInboundTimeout` without inbound. Direct links (`!hub`) close with `MeshCloseIdle` after `meshIdleTimeout` without traffic.
- `onClose` runs exactly once from `close`, outside the link lock.

- [ ] **Step 1: Write the failing tests**

Add a bidirectional test helper in `mesh_link_test.go`:

```go
// meshConn is one end of a bidirectional datagram pipe. The link owns one
// end; the test owns the other.
type meshConn struct {
    send, recv *datagramPipe
}
func (c meshConn) Read(b []byte) (int, error)  { return c.recv.Read(b) }
func (c meshConn) Write(b []byte) (int, error) { return c.send.Write(b) }
func (c meshConn) Close() error                { _ = c.send.Close(); return c.recv.Close() }
func (c meshConn) LocalAddr() net.Addr         { return peerAddr{"mesh", ""} }
func (c meshConn) RemoteAddr() net.Addr        { return peerAddr{"mesh", "peer"} }
func (c meshConn) SetDeadline(time.Time) error { return nil }
func (c meshConn) SetReadDeadline(time.Time) error { return nil }
func (c meshConn) SetWriteDeadline(time.Time) error { return nil }

// newMeshPipe returns the link's end and the test's end. Link writes arrive
// at the test's recv; test writes arrive at the link's recv.
func newMeshPipe() (link, peer meshConn) {
    toPeer, fromLink := newDatagramPipe(16)
    toLink, fromPeer := newDatagramPipe(16)
    link = meshConn{send: toPeer, recv: fromPeer}
    peer = meshConn{send: toLink, recv: fromLink}
    return
}
```

Tests:

- `TestMeshLinkWritesEachDatagram`: `link, peer := newMeshPipe()`; start the link; `enqueue(pkt)`; assert `peer.recv` reads exactly `pkt`.
- `TestMeshLinkQueueFullDoesNotBlock`: set `meshQueueDepth = 1` (restore in cleanup); block the writer by not reading; enqueue two packets; the second returns false quickly.
- `TestMeshLinkRegistrationAndEcho`: start with a registration frame; peer reads it, writes a 20-byte echo; assert `ready` becomes true and `markInbound` updates.
- `TestMeshLinkFirstInboundTimeout`: shrink `meshFirstInboundTimeout` to 50ms; start; peer reads but never writes; assert `close` reason `MeshCloseDial` within 1s.
- `TestMeshLinkIdleDirectLink`: shrink `meshIdleTimeout` and `meshInboundTimeout`; after an echo, no traffic; assert `MeshCloseIdle`.
- `TestMeshLinkCloseIsOnce`: call `close` twice; `onClose` called once; `enqueue` afterwards false.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/x && GOWORK=off go test ./handler/tun -run 'TestMeshLink' -count=1`
Expected: FAIL — `meshLink` undefined.

- [ ] **Step 3: Implement `mesh_link.go`**

Use package `tun`; reuse `MaxMessageSize`. The link's read buffer is per-link (`make([]byte, MaxMessageSize)`); do not share buffers. `close` should close `done` and the conn once, then call `onClose`; the writer/readers exit on `done`/conn errors. Do not close the `send` channel (avoids send-on-closed). A nil `onFrame` treats every packet as an error; callers always pass one.

- [ ] **Step 4: Run tests to verify they pass**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Race check**

Run: `cd /root/code/go-gost/x && CGO_ENABLED=1 GOWORK=off go test -race ./handler/tun -run 'TestMeshLink' -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /root/code/go-gost/x add handler/tun/mesh_link.go handler/tun/mesh_link_test.go
git -C /root/code/go-gost/x commit -m "feat(tun): add mesh link queues, keepalive, and liveness"
```

**Implementation record**
- Date/status: pending
- Repo/commit: x / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 3: Device runner, routing, and hub fallback

**Files:**
- Modify: `handler/tun/mesh.go`
- Modify: `handler/tun/mesh_test.go`

**Interfaces:**
- Produces `meshHandler.RunDevice(conn net.Conn) error`; it stores the device under the lock, reads packets, and calls `dispatch`.
- Produces `meshHandler.dispatch(pkt []byte)` and `meshHandler.writeDevice(pkt []byte) error`.
- Produces counters on `meshHandler`: `countNonIP`, `countLoop`, `countNoRoute`, `countDirectFallback`, `countQueueFull`, `countOversize`, `countBlocked`, `countDisabled`.
- Device read error returns `errors.Join(ErrTun, err)`; a deliberate close is `ErrTun`.
- `RunDevice` returns an error if another device is already active (`errDeviceBusy`); the entrypoint supervisor calls it sequentially.
- Dispatch rules:
  - unparseable packet → count non-IP, drop;
  - destination equals a local IP → count loop, drop;
  - destination is a `Blocked`/`Disabled` member → drop (count blocked/disabled);
  - destination is a `Direct` member: enqueue the peer's direct link if it exists, is ready, and has queue space; otherwise enqueue the hub. If the direct link is missing/not ready, call `DirectNeeded(peer)` (coalesced by the callback owner);
  - destination is a non-direct member or unknown → enqueue hub;
  - no hub link → count no-route, drop.
- Hub queue depth uses `meshQueueDepth`.

- [ ] **Step 1: Write the failing tests**

Use `newMeshPipe()` from Task 2 and direct `meshLink` construction (same package):

```go
// meshTestLink builds a link over one end of a pipe and returns the test's
// end plus a ready-to-use link.
func meshTestLink(t *testing.T, key string, local bool) (*meshLink, meshConn) {
    t.Helper()
    linkEnd, peerEnd := newMeshPipe()
    l := newMeshLink(key, linkEnd, local, false, func(*meshLink, MeshCloseReason) {})
    return l, peerEnd
}
```

Tests:

- `TestMeshDispatchDirectAndHub`: handler with local 10.0.0.1, member B 10.0.0.2 Direct, member C 10.0.0.3 non-direct; install a ready direct link for B and a hub link; feed device packet to B → read on B link; to C → read on hub; to 10.0.0.9 → hub.
- `TestMeshDirectNeededAndFallback`: no B link; packet to B → hub receives it; `DirectNeeded("b")` called; install a non-ready B link → packet still hub; mark ready → packet direct.
- `TestMeshBlockedMemberIsDropped`: B Blocked; packet to B → neither direct nor hub; blocked counter increments.
- `TestMeshNoHubDrops`: unknown destination with no hub → drop, no panic, counter increments.
- `TestMeshLocalDestinationLoop`: packet to 10.0.0.1 → drop, loop counter.
- `TestMeshEmptyLocalIPsDoesNotPanic`: handler with empty `LocalIPs`, member B; packet to B goes to hub/direct without panic; an inbound direct packet is dropped because no local destination matches.
- `TestMeshNilCallbacks`: clear `SetDirectNeeded`/`SetLinkClosed` after setting them; dispatch/close a link; no panic.
- `TestMeshQueueFullFallsBackToHub`: direct link writer blocked and queue depth 1; dispatch two packets to B; first direct, second hub (not blocked).
- `TestMeshBackpressureDoesNotBlockDeviceReader`: with the direct writer blocked, feed 100 packets to B and one to C; assert C/hub packets are processed before a timeout and the device reader does not stall.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/x && GOWORK=off go test ./handler/tun -run 'TestMeshDispatch|TestMeshDirectNeeded|TestMeshBlocked|TestMeshNoHub|TestMeshLocal|TestMeshQueueFull|TestMeshBackpressure' -count=1`
Expected: FAIL — `RunDevice`/`dispatch` undefined.

- [ ] **Step 3: Implement `RunDevice` and `dispatch`**

The device read loop uses one buffer allocated per `RunDevice` call. `writeDevice` takes `wmu`, reads the current device pointer, and writes; `listenertun.ErrPacketTooLarge` is dropped and counted, not returned. `dispatch` never calls `conn.Write`; it only calls `enqueue` on links. A direct `enqueue` failure tries the hub; a hub failure increments the drop counter. `DirectNeeded` is called only for members that are `Direct && !Blocked && !Disabled` and when no ready link exists; do not call it for hub/unknown destinations.

- [ ] **Step 4: Run tests to verify they pass**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Race check**

Run: `cd /root/code/go-gost/x && CGO_ENABLED=1 GOWORK=off go test -race ./handler/tun -run 'TestMeshDispatch|TestMeshQueueFull|TestMeshBackpressure' -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /root/code/go-gost/x add handler/tun/mesh.go handler/tun/mesh_test.go
git -C /root/code/go-gost/x commit -m "feat(tun): route mesh device packets with hub fallback"
```

**Implementation record**
- Date/status: pending
- Repo/commit: x / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 4: Install hub/direct links, inbound Handle, and frame validation

**Files:**
- Modify: `handler/tun/mesh.go`
- Modify: `handler/tun/mesh_test.go`

**Interfaces:**
- Produces `meshHandler.SetHubLink(conn net.Conn)`, `AddDialedLink(peer string, conn net.Conn)`, `DropLink(peer string)`, and `Handle(ctx, conn, opts...) error`.
- Produces `meshHandler.handleHubFrame(pkt []byte) error`, `handleDirectFrame(link *meshLink, pkt []byte) error`.
- Produces `meshRegistrationFrame(localIPs []net.IP) []byte` and `meshValidRegistration(member MeshMember, frame []byte) bool`.
- Produces counters `countForeignSrc`, `countForeignDst`, `countRegistrationRefused`.
- `SetHubLink` installs a hub link (`hub=true`), replaces any previous hub link (closing the old one with `shutdown` and no callback), starts it with `handleHubFrame`; hub link writes are allowed before the first inbound. When the current hub link closes, clear `h.hub` and call `SetLinkClosed(cfg.HubKey, reason)` unless the close is `shutdown`, so the manager can redial.
- `AddDialedLink` validates the peer is a member, `Direct && !Blocked && !Disabled`, not local/hub; installs a dialed link, starts it with `handleDirectFrame`.
- `Handle` reads the first frame from an inbound stream before installing; it must be a tun frame (`isTunFrame`); the remote key must be a member with `Direct && !Blocked && !Disabled`; then install, process the first frame, start the link with `handleDirectFrame`, and block until the link closes. Bound the first read with `meshFirstInboundTimeout` and clear the deadline afterwards.
- `DropLink` closes the current direct link (reason `MeshCloseMembership`) if present.
- Hub frame handling: keepalive echo → `markInbound`; IP packet → `writeDevice`; non-IP → count/drop. No source/destination ACL.
- Direct frame handling:
  - bare 20-byte keepalive echo → `markInbound`;
  - registration frame → validate exact address set equals the member's IPs; echo `keepAliveReply(peer)`; invalid → close link with `MeshCloseMembership`;
  - IP packet → source must be one of the peer's member IPs; destination must be one of `cfg.LocalIPs`; otherwise count/drop; then `writeDevice`;
  - non-IP → count/drop.
- Registration sender uses the `GOST` magic + 16-byte IPs, same shape as `x/handler/tun/client.go`; empty passphrase.

- [ ] **Step 1: Write the failing tests**

Use `datagramPipe` streams as inbound/outbound p2p conns (`meshConn`). Tests:

- `TestMeshAddDialedLinkWrites`: member B; `AddDialedLink("b", conn)`; assert a registration frame is written by the link, send an echo plus an IP packet from the test end, assert it is written to the device.
- `TestMeshAddDialedLinkRejects`: unknown key, hub key, local key, `Blocked`, `Disabled`, `Direct=false` — no link installed, no panic.
- `TestMeshHandleInbound`: call `Handle` in a goroutine with a stream whose remote addr is B; first write a registration frame; assert an echo; write a valid B→local packet; assert device write; close stream; `Handle` returns.
- `TestMeshHandleRejectsNonTunFirstFrame`: first frame `"GET /"`; `Handle` returns, no link installed.
- `TestMeshHandleRejectsWrongSource`: B sends a packet with source C's IP; not written to device.
- `TestMeshHandleRejectsForeignDestination`: B sends a packet to C's IP; not written to device (spoke does not relay).
- `TestMeshHandleNeverForwardsToPeer`: B sends a packet to C's IP; assert C's direct link/hub link received nothing.
- `TestMeshHubFrameWritesDevice`: hub link receives an IP packet with any source/destination; written to device.
- `TestMeshInvalidRegistrationCloses`: B sends a registration claiming C's IP; link closes with `MeshCloseMembership`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/x && GOWORK=off go test ./handler/tun -run 'TestMeshAddDialed|TestMeshHandle|TestMeshHubFrame|TestMeshInvalidRegistration' -count=1`
Expected: FAIL — install/handle methods undefined.

- [ ] **Step 3: Implement installation and frame handling**

Use a `wmu` device write lock. `Handle` must close the conn on every return path (defer) and remove the link only if it is still current. The direct link source/destination checks happen before `writeDevice`; count rejected packets. `meshValidRegistration` compares the claimed IP set to the member's IP set exactly (order-independent), using `net.IP.Equal`. The registration reply is `keepAliveReply(peer)` (20 bytes). The sender goroutine is `meshLink.start` with `meshRegistrationFrame(cfg.LocalIPs)`.

- [ ] **Step 4: Run tests to verify they pass**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Race check**

Run: `cd /root/code/go-gost/x && CGO_ENABLED=1 GOWORK=off go test -race ./handler/tun -run 'TestMeshAddDialed|TestMeshHandle|TestMeshHubFrame|TestMeshInvalidRegistration' -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /root/code/go-gost/x add handler/tun/mesh.go handler/tun/mesh_test.go
git -C /root/code/go-gost/x commit -m "feat(tun): install mesh links and validate inbound frames"
```

**Implementation record**
- Date/status: pending
- Repo/commit: x / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 5: Dedupe, membership teardown, status, and link callbacks

**Files:**
- Modify: `handler/tun/mesh.go`
- Modify: `handler/tun/mesh_test.go`

**Interfaces:**
- Produces `meshHandler.installLink(link *meshLink) bool`: installs unless a preferred existing link wins; closes the loser with `MeshCloseDedup`.
- Preferred rule: dialer key is `cfg.LocalKey` for dialed links, `link.key` for inbound links. Keep the link with the lexicographically smaller dialer key; if equal, keep the existing one.
- Produces `meshHandler.removeLink(link *meshLink, reason MeshCloseReason)`: removes only if current; calls `SetLinkClosed(peer, reason)` for non-shutdown closes.
- `SetMembers` closes links whose key is removed, `Direct=false`, `Blocked=true`, or `Disabled=true`, with `MeshCloseMembership`/`MeshCloseBlocked`; hub link untouched.
- `MeshStatus` includes link bytes and `DialedLocally`.

- [ ] **Step 1: Write the failing tests**

- `TestMeshDedupePrefersSmallerDialer`: local key `"a"`, peer `"b"`; install an outbound link (dialer a) and an inbound link (dialer b); assert the outbound remains, inbound closes with `dedup`, and `SetLinkClosed` fires once.
- `TestMeshDedupeEqualKeepsExisting`: same dialer key on both; existing remains.
- `TestMeshDedupeLargerDialerOnly`: local key `"z"`, peer `"b"`; only inbound (dialer b) exists; keep it; a later outbound (dialer z) loses.
- `TestMeshMembershipRemovalClosesLink`: link for B; `SetMembers` without B; link closes with `membership`; `SetLinkClosed` fires.
- `TestMeshBlockedMemberClosesLink`: `SetMembers` marks B Blocked; link closes with `blocked`.
- `TestMeshStatusAfterLinks`: ready direct link → state `direct`, `DialedLocally` correct, bytes; stale inbound link after removal not shown.
- `TestMeshHubLinkCloseCallback`: install a hub link with `SetLinkClosed` set; close the peer end; assert the callback fires with the hub key and a non-shutdown reason, and `h.hub` is cleared.
- `TestMeshShutdownDoesNotRedial`: `Close` closes links with `shutdown`; `SetLinkClosed` is not called for shutdown (or is called with shutdown and the manager ignores it — pick one and pin it; prefer not called).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/x && GOWORK=off go test ./handler/tun -run 'TestMeshDedupe|TestMeshMembership|TestMeshBlockedMember|TestMeshStatusAfter|TestMeshShutdown' -count=1`
Expected: FAIL — dedupe/remove/status incomplete.

- [ ] **Step 3: Implement install/remove and update status**

`installLink` and `removeLink` take `h.mu`; do not call `SetLinkClosed` while holding it (capture the callback/peer, unlock, then call). `link.close` calls the link's `onClose`, which calls `removeLink`; avoid double callback. `SetMembers` copies the input, rebuilds `memberByIP`, closes affected links outside the lock. `MeshStatus` copies state under the lock and reads atomics after.

- [ ] **Step 4: Run tests to verify they pass**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Race check**

Run: `cd /root/code/go-gost/x && CGO_ENABLED=1 GOWORK=off go test -race ./handler/tun -run 'TestMeshDedupe|TestMeshMembership|TestMeshBlockedMember|TestMeshStatusAfter|TestMeshShutdown' -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /root/code/go-gost/x add handler/tun/mesh.go handler/tun/mesh_test.go
git -C /root/code/go-gost/x commit -m "feat(tun): dedupe mesh links and tear down on membership changes"
```

**Implementation record**
- Date/status: pending
- Repo/commit: x / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 6: Device replacement, concurrency, and panic containment

**Files:**
- Modify: `handler/tun/mesh.go`
- Modify: `handler/tun/mesh_link.go`
- Modify: `handler/tun/mesh_test.go`
- Modify: `handler/tun/mesh_link_test.go`

**Interfaces:**
- `RunDevice` may be called again after the previous device returns; links, membership, and counters survive.
- The handler's current device is read under the lock for every `writeDevice`; a late write after `Close` is dropped, not a panic.
- Every long-lived goroutine (`writeLoop`, `readLoop`, `keepaliveLoop`, `watchdog`, `RunDevice` reader) recovers a panic, logs it, and closes the link/returns an error. A panic must not take the process down in a c-shared build.

- [ ] **Step 1: Write the failing tests**

- `TestMeshDeviceReplacement`: `RunDevice(dev1)` in a goroutine; feed a packet; close dev1; wait for return; `RunDevice(dev2)`; install a ready direct link; feed a packet to B; assert dev2 receives it; links still present.
- `TestMeshLateDeviceWriteAfterClose`: start `RunDevice`, `Close`; a link reader writes; no panic; write dropped.
- `TestMeshConcurrentDeviceWrites`: two direct links + hub link all receive packets concurrently; use `writeRecorder` as the device's write side; assert no overlap (the existing `writeRecorder` detects it) and `-race` clean.
- `TestMeshLinkPanicBecomesClose`: pass an `onFrame` that panics; assert the link closes and the test process survives; the handler's `SetLinkClosed` fires (or the link is removed).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/code/go-gost/x && GOWORK=off go test ./handler/tun -run 'TestMeshDeviceReplacement|TestMeshLateDevice|TestMeshConcurrentDevice|TestMeshLinkPanic' -count=1`
Expected: FAIL — replacement/late-write/panic paths incomplete.

- [ ] **Step 3: Implement replacement and recover**

Add a `recover` helper that logs the panic and the reason. `RunDevice` sets the device pointer under the lock, reads until error, then clears the pointer only if it still points at that conn. `Close` clears the pointer and closes the conn. `writeDevice` snapshots the pointer under the lock and writes outside it (the device's own write lock is the handler's `wmu`); a nil device returns `ErrTun`/drops. Link goroutines recover and call `close(MeshCloseUnhealthy)` (or `MeshCloseWrite`) with the panic logged.

- [ ] **Step 4: Run tests to verify they pass**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Race check**

Run: `cd /root/code/go-gost/x && CGO_ENABLED=1 GOWORK=off go test -race ./handler/tun -run 'TestMeshDeviceReplacement|TestMeshLateDevice|TestMeshConcurrentDevice|TestMeshLinkPanic' -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /root/code/go-gost/x add handler/tun/mesh.go handler/tun/mesh_link.go handler/tun/mesh_test.go handler/tun/mesh_link_test.go
git -C /root/code/go-gost/x commit -m "fix(tun): survive device replacement and link goroutine panics"
```

**Implementation record**
- Date/status: pending
- Repo/commit: x / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —

---

### Task 7: Full verification and no-regression gate

**Files:**
- No source changes expected; fix only failures caused by this feature.

- [ ] **Step 1: Run the existing tun package tests unchanged**

Run: `cd /root/code/go-gost/x && GOWORK=off go test ./handler/tun -count=1`
Expected: PASS. If a pre-existing test fails, stop and report; do not edit it to fit the new code.

- [ ] **Step 2: Run the full x module tests (per package, avoid wildcard hangs)**

Run: `cd /root/code/go-gost/x && GOWORK=off go test -p 1 ./... -count=1`
Expected: PASS. This is the no-regression gate for the rest of x; a failure unrelated to tun must be reported, not patched to fit.

- [ ] **Step 3: Run the whole x module build/vet**

Run:
```bash
cd /root/code/go-gost/x
GOWORK=off go build ./...
GOWORK=off go vet ./...
```
Expected: PASS.

- [ ] **Step 4: Run the new tests with race**

Run: `cd /root/code/go-gost/x && CGO_ENABLED=1 GOWORK=off go test -race ./handler/tun -run 'TestMesh' -count=1`
Expected: PASS.

- [ ] **Step 5: Confirm no existing constructor was touched**

Run: `git -C /root/code/go-gost/x diff --stat <first-task-commit>^..HEAD -- handler/tun`
Expected: only `mesh.go`, `mesh_link.go`, `mesh_test.go`, `mesh_link_test.go` (plus any test-only helper file). `p2phandler.go`, `handler.go`, `p2p.go`, `server.go`, `client.go` must be unchanged unless a failure required a no-behavior-change helper extraction; if so, record why in the implementation record.

- [ ] **Step 6: Commit any final test fixes**

```bash
git -C /root/code/go-gost/x add handler/tun
git -C /root/code/go-gost/x commit -m "test(tun): verify mesh handler no-regression gate"
```

**Implementation record**
- Date/status: pending
- Repo/commit: x / —
- Files changed: —
- Tests: —
- Review findings/fixes: —
- Deferred/limitations: —
