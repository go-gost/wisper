# wisper tun Phase 2: On-Demand Direct Peering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: DEFERRED — read this before executing any task.** A cost/benefit review (2026-10-08) found the direct-peering data plane buys little: `p2p@v0.14.0` already prefers a direct smux session per peer when one exists (`internal/host/direct.go:28`), so the hub is already skipped whenever a path can be punched, and spoke-to-spoke traffic is ~0 today. Phase 3 (LAN routing, `specs/2026-10-08-wisper-lan-routing-design.md`, plan `plans/2026-10-09-wisper-lan-routing.md`) was built first because it delivers value on its own.
>
> **Tasks 1–3 of this plan (the control channel) are re-scoped by the phase-3 plan** — the transport is the same (a second p2p stream, magic-demuxed, length-framed JSON), but the payload there is `netview` (members + LAN claims) and `claim`, not this plan's `peerSnapshot`. Implement them from the phase-3 plan, not from this file.
>
> **Tasks 4–8 are retained as the direct-peering data-plane design** and are still valid as written: Task 4's `LinkProvider` hook and Task 5's on-demand punch remain the right shape if phase 2 is ever revived. Task 2's magic is `WISP` with shape-first dispatch, matching the phase-3 channel.

**Goal:** A wisper tun spoke reaches another spoke directly over p2p when a direct path can be punched, and falls back to the hub relay whenever the direct path is absent, broken, or unknown — with the chosen path visible in doctor/peers.

**Architecture:** Two halves. The **control plane** (hub → spoke) pushes a monotonically-revved snapshot of the network's members `(peerKey, addrs, rev)` over a second p2p stream to the same peer key the tun link uses, demultiplexed by a magic-prefix peek at the hub's shared p2p host. The **data plane** (spoke) keeps the hub link permanently and creates direct links lazily; x's tun client gains an optional `LinkProvider` hook so the device's read pump can choose a link per packet and write to that link's conn, with the current single-chain behaviour preserved verbatim when no provider is set.

**Tech Stack:** Go, `github.com/go-gost/wisper` (hub/entrypoint), `github.com/go-gost/x` (tun handler/link provider), existing p2p host (`github.com/go-gost/p2p` endpoint), existing x chain parser.

**Spec:** `wisper/docs/superpowers/specs/2026-10-06-wisper-tun-routing-design.md` (§4 phase 2, §5 observability, §6 gates).

## Global Constraints

- **Single hub, IPv4-first, mutually trusting members.** The hub allowlist is whole-network membership: any member may connect directly to any member, no per-pair authorization. Both ends of a direct link verify the far side is in their local snapshot; that check is the only gate.
- **Android constraints unchanged:** one VPN, one tun entrypoint per process. Direct links add p2p streams only — never a second device.
- **x's existing tun behaviour must not change when no `LinkProvider` is configured.** The default path is byte-for-byte today's path: one pre-dialed conn, `transportClient` pumps device→conn.
- **Snapshot rev is monotonic per hub process and only advances on content change.** A spoke discards any snapshot whose `rev` is not greater than the one it holds.
- **Direct-connect failure is never fatal.** Best-effort, consistent with tun/UDP semantics: any punch/dial/link error is logged and counted, and traffic keeps flowing over the hub link.
- **Test commands:** wisper package tests need no special env; x cross-module checks need `GOWORK=off`. Run x tests per-package or with `-p 1` (a wildcard hangs). `-race` needs `CGO_ENABLED=1`. Known pre-existing failure unrelated to this work: `TestRunDeviceProbeReportsSent` in `x/handler/tun` races on a clean tree.
- **Commit discipline:** one commit per task, message in the repo's conventional style. Do not push unless asked.

## Review Focus

Each of these is a condition the spec implies but no happy-path test covers. Each is pinned by a test in the task that owns the code; add them as you write those tasks.

1. **A direct link to a peer that has left the network.** The snapshot drops the peer; the link must be closed, not left half-open. Expect: link closed on `SetSnapshot` when the peer vanishes.
2. **A snapshot that arrives out of order or repeated.** The wire can deliver a stale push after a newer one. Expect: `rev <= held` is dropped, the peer map unchanged, no downgrade of a live link.
3. **A device packet for a destination nobody owns.** With a snapshot present but no matching member, traffic must go over the hub link, not be dropped. Expect: `SelectLink` returns "" (hub) and the packet is written there.
4. **A direct link that dies mid-flow while the peer is still a member.** Expect: link torn down, `relayFallback` counted, subsequent packets flow over the hub with no user-visible error and no reconnect storm (a failed link is not re-punched on the very next packet — backoff).
5. **Two spokes behind the same NAT, or a hub that is itself a member.** Punching a direct path can fail where the relay path works. Expect: punch error is a counted warn, hub link untouched, traffic still flows.
6. **The hub restarts (rev resets to 1) while a spoke holds rev 40.** Expect: the spoke accepts the lower rev if and only if the hub instance is new — decided by including the hub's boot id in the snapshot; a same-boot lower rev is dropped.
7. **A spoke with no snapshot yet (control channel down) but a perfectly good hub link.** Expect: everything flows over the hub; the spoke does not attempt direct links to peers it cannot see.

---

## File Structure

| File | Responsibility |
|---|---|
| `wisper/tunnel/peermap.go` (new) | `peerSnapshot`, `peerSnapshotPeer`, `snapshotBuilder` — the hub's revved, change-detected network view and its JSON form. |
| `wisper/tunnel/tun_control.go` (new) | Hub-side control channel: magic prefix, length-prefixed framing, per-spoke control conns, push on connect/change/tick. |
| `wisper/tunnel/p2p_host.go` (modify) | Demux a peer key's inbound conns to the tun route or the control route by peeking a magic prefix. |
| `wisper/tunnel/tun.go` (modify) | Own the control listener for its spoke allowlist; build and push snapshots on `SetPeers`/`SetPeerIPs`. |
| `wisper/tunnel/entrypoint/direct.go` (new) | Spoke-side direct-link manager: snapshot cache, on-demand punch+dial, link lifecycle, `LinkProvider` implementation. |
| `wisper/tunnel/entrypoint/tun.go` (modify) | Start the control channel to the hub; hand the direct-link manager to the handler; counters. |
| `wisper/tunnel/entrypoint/tun_test.go` (modify) | Provider wiring tests. |
| `x/handler/tun/link.go` (new) | `LinkProvider` interface + the no-op default. |
| `x/handler/tun/client.go` (modify) | Per-packet link selection in the device read pump; multi-link inbound fan-in. |

Task order is a dependency chain: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

---

### Task 1: The hub's revved network snapshot

The spoke cannot pick a direct peer it has never heard of, so the hub has to tell it who exists. This task builds that view and nothing else — no wire format, no channel.

**Files:**
- Create: `wisper/tunnel/peermap.go`
- Test: `wisper/tunnel/peermap_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```go
  type peerSnapshotPeer struct {
      Peer  string   `json:"peer"`
      Addrs []string `json:"addrs"`
  }
  type peerSnapshot struct {
      Hub    string            `json:"hub"`     // hub boot id, see step 3
      Rev    uint64            `json:"rev"`
      Peers  []peerSnapshotPeer `json:"peers"`
  }
  type snapshotBuilder struct{ /* ... */ }
  func newSnapshotBuilder() *snapshotBuilder
  // build returns the current view of the network and whether it changed since
  // the last call. A false second return means rev is unchanged and the caller
  // has nothing to push.
  func (b *snapshotBuilder) build(hubID string, peers []string, assigned map[string]string) (peerSnapshot, bool)
  ```
  `assigned` is the hub's spoke→addresses assignment as the authorizer holds it (peer key → comma-separated IPs). `peers` is the enabled allowlist, in any order.

- [ ] **Step 1: Write the failing test**

```go
func TestSnapshotBuilderRevAdvancesOnlyOnChange(t *testing.T) {
	b := newSnapshotBuilder()
	assigned := map[string]string{"peerA": "10.10.100.2"}

	first, changed := b.build("hub1", []string{"peerA", "peerB"}, assigned)
	if !changed {
		t.Fatal("first build must report a change")
	}
	if first.Rev != 1 {
		t.Fatalf("first rev = %d, want 1", first.Rev)
	}
	if first.Hub != "hub1" {
		t.Fatalf("hub = %q, want hub1", first.Hub)
	}
	// peerB has no assignment row: a member that holds no address yet is still
	// a member, and the spoke must see it with an empty address list.
	if len(first.Peers) != 2 {
		t.Fatalf("peers = %d, want 2", len(first.Peers))
	}
	if first.Peers[1].Peer != "peerB" || len(first.Peers[1].Addrs) != 0 {
		t.Fatalf("peerB entry = %+v, want empty addrs", first.Peers[1])
	}

	// Same content, different input order: not a change.
	same, changed := b.build("hub1", []string{"peerB", "peerA"}, assigned)
	if changed {
		t.Fatalf("reordered identical input reported a change: %+v", same)
	}
	if same.Rev != first.Rev {
		t.Fatalf("rev moved without a change: %d -> %d", first.Rev, same.Rev)
	}

	// One address added: a change, and the rev advances by one.
	assigned["peerA"] = "10.10.100.2,10.10.100.3"
	next, changed := b.build("hub1", []string{"peerA", "peerB"}, assigned)
	if !changed {
		t.Fatal("an added address must report a change")
	}
	if next.Rev != first.Rev+1 {
		t.Fatalf("rev = %d, want %d", next.Rev, first.Rev+1)
	}
	if len(next.Peers[0].Addrs) != 2 {
		t.Fatalf("peerA addrs = %v, want two", next.Peers[0].Addrs)
	}
}

func TestSnapshotBuilderHubRestartResetsRev(t *testing.T) {
	b := newSnapshotBuilder()
	for i := 0; i < 3; i++ {
		b.build("hub1", []string{"peerA"}, map[string]string{})
	}
	// A different hub process: the rev restarts, and the hub id is what lets a
	// spoke tell that apart from a stale push.
	after, changed := b.build("hub2", []string{"peerA"}, map[string]string{})
	if !changed {
		t.Fatal("a new hub must report a change")
	}
	if after.Rev != 1 {
		t.Fatalf("rev after restart = %d, want 1", after.Rev)
	}
	if after.Hub != "hub2" {
		t.Fatalf("hub = %q, want hub2", after.Hub)
	}
}

func TestSnapshotJSONRoundTrip(t *testing.T) {
	b := newSnapshotBuilder()
	snap, _ := b.build("hub1", []string{"peerA"}, map[string]string{"peerA": "10.10.100.2"})

	data, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	var back peerSnapshot
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	if back.Rev != snap.Rev || back.Hub != snap.Hub || len(back.Peers) != 1 ||
		back.Peers[0].Peer != "peerA" || back.Peers[0].Addrs[0] != "10.10.100.2" {
		t.Fatalf("round trip changed the snapshot: %+v -> %+v", snap, back)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run TestSnapshot -count=1`
Expected: FAIL — `undefined: newSnapshotBuilder`.

- [ ] **Step 3: Implement `wisper/tunnel/peermap.go`**

Canonicalize before comparing, because the two inputs arrive in whatever order the config and the map have: sort `peers` by key and sort each address list. Change detection compares that canonical form against the last one built; a mismatch (or a different hub id) advances `rev` by one and resets it to 1 when the hub id changes.

`hubID` is the hub's identity for snapshot purposes. Use the tun tunnel's `opts.ID` — it is stable across a config reload and unique per configured hub, which is exactly the "same boot vs new boot" signal a spoke needs. Pass it in from the caller (Task 3) rather than reading a global.

Addrs are kept as the strings the assignment holds, parsed through `unmapAll` first (the file already has it, and `honorablePeerIPs` shows why: `::ffff:10.10.100.2` and `10.10.100.2` are one address). A row that does not parse contributes no addrs rather than failing the build — `honorablePeerIPs` has already dropped those rows before the authorizer ever sees them, so the build can trust what it is handed.

Document on the type: this is a *read-only view*, not the route table. It says who exists and which addresses they claim; whether a claim is honoured is the authorizer's answer, already reflected in what `assigned` contains.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run TestSnapshot -count=1`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/peermap.go tunnel/peermap_test.go
git commit -m "feat(tun): model the hub's revved network snapshot"
```

---

### Task 2: Demultiplexing a peer key's inbound streams

The hub already routes every inbound p2p conn for a peer key to one listener, and refuses a second claim on that key (`p2p_host.go:436`). The tun link and the control stream share that key, and the host cannot tell them apart — a p2p conn carries no destination. They are not indistinguishable, though: the hub already knows the answer in the conn's *shape*.

`p2p/internal/host/inbound.go:56-67` wraps an inbound datagram stream's conn in `newFrameConn`, and `Accept` hands it out as an `inboundDatagramConn` satisfying `net.PacketConn` (`inbound.go:101-108`) — that is how a consumer "tells a udp tunnel stream from a tcp one", per the comment there. A tun link is `p2p.network="ip"` (`entrypoint/tun.go:180`), which `seam.go:164-171` normalizes to a datagram link. So **every tun stream arrives as a PacketConn**, and the control stream — a reliable byte stream, dialed without `p2p.network` (`seam.go:158-159`) — does not.

The demux is therefore two-tier: shape first, magic as fallback. A tun stream is never read even one byte, which matters because a datagram conn's `Read` discards whatever falls past the read buffer (`frame.go:88-116`): peeking an MTU-sized datagram with an 8-byte buffer would tear the head off that packet and no replay could restore it. The transport is not at fault — KCP+smux deliver whole frames — the peek's own buffer size would be.

**Files:**
- Create: `wisper/tunnel/prefixconn.go`
- Modify: `wisper/tunnel/p2p_host.go` (the `routes` and `ctrl` maps, `reconcile`, `dispatch`)
- Test: `wisper/tunnel/p2p_host_test.go`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```go
  // controlMagic opens a control stream: the first bytes the spoke writes on
  // one. Four bytes, ASCII so a hexdump reads as itself, and its first byte's
  // high nibble is 5 (an ASCII 'W') — an IP packet's version nibble is 4 or 6
  // (waterutil.IsIPv6, x/handler/tun/server.go:80), so no device stream can
  // begin with it. It must also stay clear of every other frame grammar on
  // this stream: 'GOST' is taken by the keepalive registration frame
  // (x/handler/tun/client.go:27), which is the *first* frame on every tun
  // stream (client.go:71 runs the handshake before transportClient), and
  // p2p's own 0x00/0x01 control/data kinds are taken too. Do not reuse
  // 'GOST' for this: a 'G' is 0x47, high nibble 4, so it is also a legal
  // IPv4 header start — the first byte would discriminate nothing.
  //
  // There is no version in the magic on purpose: a message schema version
  // lives in the frame's own "v" field, and a stream whose messages are too
  // new is handled by the unknown-version rule (drop the frame, keep the
  // stream), not by the hub mistaking it for a device stream.
  var controlMagic = []byte("WISP")

  // prefixConn replays already-read bytes ahead of the rest of a *byte*
  // stream, so a peek is invisible to whoever ends up reading it. Never use
  // it on a datagram conn: see frame.go:88-116.
  type prefixConn struct { /* ... */ }
  func newPrefixConn(c net.Conn, pre []byte) net.Conn

  // registerControl claims peer for the control stream. It succeeds only when
  // no tun route holds the key; a control claim and a tun claim coexist, a
  // second claim of either kind does not.
  func (m *p2pHostManager) registerControl(peer string) (net.Listener, error)
  func (m *p2pHostManager) unregisterControl(ln net.Listener)
  ```
  Plus `controlPeekTimeout`, a package-level `var` (not a const) so tests can shrink it. It bounds only the byte-stream fallback path.

- [ ] **Step 1: Write the failing test**

```go
func TestDispatchDatagramStreamSkipsPeek(t *testing.T) {
	// A tun stream is a PacketConn (p2p/internal/host/inbound.go:101-108):
	// the hub knows it is one without reading a byte. Reading would corrupt
	// it — a datagram conn's Read drops whatever falls past the read buffer
	// (frame.go:88-116) — so with a control claim on this very key the
	// datagram conn must still arrive whole, and untouched.
	m := &p2pHostManager{
		routes: make(map[string]*peerListener),
		ctrl:   make(map[string]*peerListener),
	}
	tunLn := newPeerListener([]string{"peerA"})
	if err := m.reconcile(tunLn, []string{"peerA"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.registerControl("peerA"); err != nil {
		t.Fatal(err)
	}

	server, client := net.Pipe()
	// The hub's own wrapper: the datagram twin a tun stream arrives as.
	go m.dispatch(newPacketConnPeer(client))

	conn, err := tunLn.Accept()
	if err != nil {
		t.Fatal(err)
	}
	// One whole datagram, IPv4-shaped so it could never be mistaken for the
	// magic even by a hub that peeked: 0x45 has high nibble 4.
	want := append([]byte{0x45, 0x00}, make([]byte, 26)...)
	go func() { _, _ = client.Write(want) }()
	got := make([]byte, len(want))
	if _, err := io.ReadFull(conn, got); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("tun datagram arrived altered: %x, want %x", got, want)
	}
	_ = server.Close()
}

func TestDispatchByteStreamRoutesByMagic(t *testing.T) {
	// The fallback, for a conn whose shape says nothing. net.Pipe conns are
	// not PacketConns, so this is the byte-stream path the magic decides.
	m := &p2pHostManager{
		routes: make(map[string]*peerListener),
		ctrl:   make(map[string]*peerListener),
	}
	tunLn := newPeerListener([]string{"peerA"})
	if err := m.reconcile(tunLn, []string{"peerA"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.registerControl("peerA"); err != nil {
		t.Fatal(err)
	}
	ctrlLn, err := m.ctrlListener("peerA")
	if err != nil {
		t.Fatal(err)
	}
	ctrlLn.setPeers([]string{"peerA"}) // the claim is the manager's; this listener is the one it hands conns to

	// A control stream: the magic first, then the payload. The magic is the
	// stream's identification and nothing more — once it has routed the conn,
	// dispatch does not hand it to the control listener: what that listener
	// reads is the framing that follows ({} here), not WISP again.
	server, client := net.Pipe()
	go m.dispatch(client)
	ctrlConn, err := ctrlLn.Accept()
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		_, _ = client.Write(append(append([]byte(nil), controlMagic...), []byte("{}")...))
	}()
	got := make([]byte, 2)
	if _, err := io.ReadFull(ctrlConn, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != "{}" {
		t.Fatalf("control stream payload = %q, want %q: the magic is framing, not content", got, "{}")
	}

	// A byte stream that is not control: every byte still reaches the tun
	// listener, the peeked ones replayed ahead of the rest.
	server2, client2 := net.Pipe()
	go m.dispatch(client2)
	tunConn, err := tunLn.Accept()
	if err != nil {
		t.Fatal(err)
	}
	go func() { _, _ = client2.Write([]byte("hello tun")) }()
	got2 := make([]byte, 9)
	if _, err := io.ReadFull(tunConn, got2); err != nil {
		t.Fatal(err)
	}
	if string(got2) != "hello tun" {
		t.Fatalf("tun stream payload = %q, want %q", got2, "hello tun")
	}
	_ = server.Close()
	_ = server2.Close()
}

func TestDispatchNoControlRouteGoesStraightToTun(t *testing.T) {
	// A key with no control claim must not pay a peek: the conn reaches the
	// tun listener immediately.
	m := &p2pHostManager{routes: make(map[string]*peerListener), ctrl: make(map[string]*peerListener)}
	tunLn := newPeerListener([]string{"peerA"})
	if err := m.reconcile(tunLn, []string{"peerA"}); err != nil {
		t.Fatal(err)
	}
	server, client := net.Pipe()
	go m.dispatch(client)
	conn, err := tunLn.Accept()
	if err != nil {
		t.Fatal(err)
	}
	_ = server.Close()
	_ = conn.Close()
}

func TestRegisterControlRejectsSecondTunClaim(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener), ctrl: make(map[string]*peerListener)}
	other := newPeerListener([]string{"peerA"})
	if err := m.reconcile(other, []string{"peerA"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.registerControl("peerA"); err != nil {
		t.Fatalf("control claim alongside a tun claim: %v", err)
	}
	if _, err := m.registerControl("peerA"); err == nil {
		t.Fatal("a second control claim must be refused")
	}
	second := newPeerListener([]string{"peerA"})
	if err := m.reconcile(second, []string{"peerA"}); err == nil {
		t.Fatal("a second tun claim on a controlled key must be refused")
	}
}

// packetConnPeer emulates the datagram conn a tun stream arrives as, so a
// test can tell a peek from a clean hand-off. It is the one behaviour that
// matters: Read returns exactly one datagram and *drops* whatever falls past
// the caller's buffer, which is frameConn.Read's contract
// (p2p/internal/host/frame.go:88-116) — it keeps the frame remainder but does
// not return the bytes it could not copy out. A four-byte peek into an
// MTU-sized datagram therefore leaves that packet headless, and no replay can
// restore it: the test fails if the hub peeked, passes if it did not.
//
// The pipe's own Write is synchronous, so a blocked writer is also evidence of
// a hub that read nothing.
type packetConnPeer struct {
	net.Conn
	dgram chan []byte
}

func newPacketConnPeer(c net.Conn) *packetConnPeer {
	p := &packetConnPeer{Conn: c, dgram: make(chan []byte, 8)}
	go func() {
		for {
			buf := make([]byte, 65535)
			n, err := c.Read(buf)
			if n > 0 {
				p.dgram <- append([]byte(nil), buf[:n]...)
			}
			if err != nil {
				close(p.dgram)
				return
			}
		}
	}()
	return p
}

func (c *packetConnPeer) Read(b []byte) (int, error) {
	pkt, ok := <-c.dgram
	if !ok {
		return 0, net.ErrClosed
	}
	n := copy(b, pkt) // truncates, like frameConn: the rest is gone
	return n, nil
}

func (c *packetConnPeer) ReadFrom(b []byte) (int, net.Addr, error) {
	n, err := c.Read(b)
	return n, c.RemoteAddr(), err
}

func (c *packetConnPeer) WriteTo(b []byte, _ net.Addr) (int, error) { return c.Write(b) }
```

`TestDispatchDatagramStreamSkipsPeek` then writes a whole datagram (an IPv4 packet's worth of bytes) and asserts the tun listener receives all of it: with a peek, the first four bytes are gone and the `io.ReadFull` of the full length fails or the bytes differ. Note in the test why the pipe's synchronous `Write` also proves the point — the writer stays blocked until the *tun* side reads, so a hub that consumed four bytes early would both unblock the writer and still fail the byte comparison.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestDispatch|TestRegisterControl' -count=1`
Expected: FAIL — `ctrl` undefined, `registerControl`/`ctrlListener` undefined, `controlMagic` undefined, `packetConnPeer` undefined.

- [ ] **Step 3: Add `prefixConn` in `wisper/tunnel/prefixconn.go`**

A `Read` that drains the retained prefix first and then delegates. Implement `net.Conn` by embedding; `Read` takes `p`, copies as much of the prefix as fits, and only delegates once it is empty. Guard with a mutex — `dispatch` peeks on one goroutine and the listener reads on another, and the prefix is touched by both.

It is used on the byte-stream path only. A datagram conn must never be wrapped: `frameConn.Read` (`p2p/internal/host/frame.go:88-116`) keeps the frame remainder but drops the bytes it did not copy out, so replaying a partial datagram is impossible — which is why the shape check above runs first.

- [ ] **Step 4: Wire the demux into `p2p_host.go`**

Add `ctrl map[string]*peerListener` to `p2pHostManager` and initialize it wherever `routes` is initialized (including `var p2pHost = ...`).

`controlMagic` is `[]byte("WISP")`. See the Interfaces block for why those four bytes and why not `GOST`.

`registerControl(peer)`: under `m.mu`, refuse if `m.ctrl[peer]` already exists or if another `*peerListener` already holds the peer in `m.routes`; otherwise create the listener, store it in both `m.ctrl` and `m.routes` (a controlled key's control listener *is* its route — that is how `dispatch` finds it), and return it. Also expose `ctrlListener(peer) *peerListener` so a test can reach the listener `dispatch` will use.

`reconcile` must now refuse a key that has a control claim held by a *different* listener, which the existing `cur != ln` check already does once control claims live in `m.routes`. Verify that: `TestRegisterControlRejectsSecondTunClaim` fails if it does not.

`dispatch(conn)`, in this order:

1. **Shape.** If `conn` satisfies `net.PacketConn`, it is a tun stream — deliver it to `m.routes[peer]` as today, without reading a byte. Do not even look at `m.ctrl` for this case.
2. **No control claim.** If `m.ctrl[peer]` is nil, deliver as today.
3. **Otherwise** (a byte stream on a key that also carries a control claim) — set a read deadline of `controlPeekTimeout`, read up to `len(controlMagic)` bytes, clear the deadline, and:
   - bytes equal to `controlMagic`: deliver to the control listener **with the magic consumed and not replayed**. The magic has done its one job — naming the stream — and everything the control listener reads afterwards is a length-prefixed frame. Handing the magic back would make every wait for "4 bytes then a frame" ambiguity for nothing.
   - anything else, including a read error with zero bytes: `newPrefixConn(conn, got)` and deliver to the tun listener. A spoke whose control channel is slow must still get its device; a byte-stream tun peer is not punished for a control stream existing.

The magic is a fallback, not the primary discriminator: step 1 already routes every tun stream this system opens (`p2p.network="ip"` is a datagram link, `seam.go:164-171`). Step 3 exists for a future or third-party byte-stream link, where the conn's shape would otherwise say nothing at all.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestDispatch|TestRegisterControl' -count=1`
Expected: PASS.

Then confirm the existing host tests still pass, since `dispatch` is on their path:
Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -count=1`
Expected: PASS (existing p2p host tests included).

- [ ] **Step 6: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/prefixconn.go tunnel/p2p_host.go tunnel/p2p_host_test.go
git commit -m "feat(p2p): demux a peer's control stream from its tun stream"
```

---

### Task 3: The hub pushes snapshots to its spokes

**Files:**
- Create: `wisper/tunnel/tun_control.go`
- Modify: `wisper/tunnel/tun.go` (own a control listener; push on change)
- Test: `wisper/tunnel/tun_control_test.go`

**Interfaces:**
- Consumes: Task 1's `peerSnapshot` / `snapshotBuilder`; Task 2's `registerControl`, `unregisterControl`, `controlMagic`.
- Produces:
  ```go
  // controlHub owns the control side: one conn per spoke, each fed the
  // current snapshot on connect and on every change.
  type controlHub struct { /* ... */ }
  func newControlHub(b *snapshotBuilder, hubID string, log logger.Logger) *controlHub
  func (c *controlHub) accept(ctx context.Context, ln net.Listener)
  func (c *controlHub) publish(peers []string, assigned map[string]string)
  func (c *controlHub) close()

  // writeSnapshot frames and writes one snapshot.
  func writeSnapshot(w io.Writer, snap peerSnapshot) error
  // readSnapshot reads one framed snapshot.
  func readSnapshot(r io.Reader) (peerSnapshot, error)
  ```
  Framing: 4-byte big-endian length, then that many bytes of JSON. Reject a length above `maxSnapshotFrame` (64 KiB) without reading the body.

- [ ] **Step 1: Write the failing test**

```go
func TestControlHubPushesOnConnectAndOnChange(t *testing.T) {
	b := newSnapshotBuilder()
	c := newControlHub(b, "hub1", testLogger())

	// Two spokes knock; each gets the current view immediately.
	server, client := net.Pipe()
	done := make(chan struct{})
	go func() { c.accept(context.Background(), singleConnListener{client}); close(done) }()

	knocker, spoke := net.Pipe()
	go func() { c.accept(context.Background(), singleConnListener{knocker}) }()

	snap, err := readSnapshot(spoke)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Rev != 1 || snap.Hub != "hub1" {
		t.Fatalf("first snapshot = %+v, want rev 1 hub1", snap)
	}

	// A change reaches the already-connected spoke without it reconnecting.
	c.publish([]string{"peerA", "peerB"}, map[string]string{"peerA": "10.10.100.2"})
	snap2, err := readSnapshot(spoke)
	if err != nil {
		t.Fatal(err)
	}
	if snap2.Rev != snap.Rev+1 {
		t.Fatalf("rev = %d, want %d", snap2.Rev, snap.Rev+1)
	}

	_ = client.Close()
	<-done
}

func TestControlHubSkipsPushWhenNothingChanged(t *testing.T) {
	b := newSnapshotBuilder()
	c := newControlHub(b, "hub1", testLogger())

	knocker, spoke := net.Pipe()
	go c.accept(context.Background(), singleConnListener{knocker})
	if _, err := readSnapshot(spoke); err != nil {
		t.Fatal(err)
	}

	// An identical publish must not write a second frame: the spoke would
	// count it as a change and re-plan its links for nothing.
	c.publish([]string{"peerA"}, map[string]string{"peerA": "10.10.100.2"})
	_ = spoke.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, err := readSnapshot(spoke); err == nil {
		t.Fatal("an unchanged publish wrote a frame")
	}
}

func TestWriteReadSnapshotRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	want := peerSnapshot{Hub: "hub1", Rev: 7, Peers: []peerSnapshotPeer{{Peer: "peerA", Addrs: []string{"10.10.100.2"}}}}
	if err := writeSnapshot(&buf, want); err != nil {
		t.Fatal(err)
	}
	got, err := readSnapshot(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if got.Rev != want.Rev || got.Hub != want.Hub || len(got.Peers) != 1 {
		t.Fatalf("round trip: %+v", got)
	}
}

func TestReadSnapshotRejectsOversizeFrame(t *testing.T) {
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], 1<<20) // 1 MiB, above the cap
	if _, err := readSnapshot(bytes.NewReader(hdr[:])); err == nil {
		t.Fatal("an oversize frame must be refused before its body is read")
	}
}
```

`singleConnListener` is a test helper wrapping one `net.Conn` as a `net.Listener` (Accept returns it once, then blocks until Close). If the file already has one, reuse it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestControlHub|TestWriteReadSnapshot|TestReadSnapshot' -count=1`
Expected: FAIL — `undefined: newControlHub`.

- [ ] **Step 3: Implement `tun_control.go`**

`controlHub` holds the builder, the hub id, the logger, and under a mutex the live control conns (`map[*controlConn]struct{}` where `controlConn` wraps the conn and its peer key).

`accept(ctx, ln)`: loop `ln.Accept()` until error or ctx done. Per conn: register it, `go` a writer that immediately builds and writes the current snapshot, then blocks on `ctx.Done()`/conn close to deregister. Registration and deregistration are the only shared state — writes to different conns must not serialize behind one mutex, so hold the lock only to add/remove and to snapshot the conn list for a broadcast.

`publish(peers, assigned)`: call `b.build(...)`; if `changed` is false, return. Otherwise write to every live conn. A write error drops that conn (close + deregister) and is logged at warn — one dead spoke must not stall the others.

A push is best-effort by construction: a spoke that misses one gets the next tick, and a spoke that reconnects gets the whole snapshot on connect. Do not add per-conn retry or a queue.

`writeSnapshot` marshals, checks the cap, writes the length then the body, and returns any error. `readSnapshot` reads 4 bytes, refuses a length above `maxSnapshotFrame`, reads exactly that many, and unmarshals.

- [ ] **Step 4: Hook the control hub into `tunTunnel.Run`**

In `Run`, after `p2pHost.register(enabled)` succeeds and before the service starts serving, claim the control listener for the same allowlist:

```go
ctrlHub := newControlHub(newSnapshotBuilder(), s.opts.ID, log)
for _, peer := range enabled {
    ctrlLn, err := p2pHost.registerControl(peer)
    if err != nil {
        // A spoke already controlled, or held by another tunnel: log and
        // continue. Control is advisory — a spoke without it still reaches
        // everything through this hub.
        log.Warnf("tun control listener for %s: %v", peer, err)
        continue
    }
    defer p2pHost.unregisterControl(ctrlLn)
    go ctrlHub.accept(ctx, ctrlLn)
}
defer ctrlHub.close()
```

Use the `ctx` already in scope in `Run` (it is cancelled on the way out — confirm by reading how `Run` derives it; if `Run` uses `context.Background()` internally, derive one and `cancel` it in the existing teardown path so the goroutines stop).

Note on ordering: `registerControl` must run *after* `register`, since a control claim and a tun claim on the same key are both allowed but `reconcile` refuses a key another listener holds.

- [ ] **Step 5: Publish on the two places the network changes**

`SetPeers` and `SetPeerIPs` both end with the allowlist being applied (`reconcile` / the authorizer `set`). Publish immediately after each succeeds:

```go
ctrlHub.publish(enabledPeers(s.opts.Peers, s.opts.PeerDisabled), s.peerIPsAssignment())
```

`peerIPsAssignment()` is a small accessor returning the author's current assignment as `map[string]string`, read under the lock `newAuthorizer` already takes. The `controlHub` must be reachable from these methods: store it on `tunTunnel` beside `authz`, guarded so a `SetPeers` that runs before `Run` (config load) is a no-op rather than a nil dereference.

Also start a periodic re-publish so a spoke that was unreachable at change time still converges:

```go
go func() {
    t := time.NewTicker(snapshotPushInterval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            ctrlHub.publish(enabled, s.peerIPsAssignment())
        }
    }
}()
```

`snapshotPushInterval` is a package-level `var` (30 * time.Second) so a test can shrink it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestControlHub|TestWriteReadSnapshot|TestReadSnapshot' -count=1`
Expected: PASS.

Then the whole package, because `Run` and `SetPeers` are on many existing tests' paths:
Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -count=1`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/tun_control.go tunnel/tun_control_test.go tunnel/tun.go
git commit -m "feat(tun): push the network snapshot to each spoke"
```

---

### Task 4: A per-packet link hook in x's tun client

This is the one place phase 2 touches x, and it is additive: with no provider configured, the client keeps its single pre-dialed conn and its current pump untouched.

The device's read pump currently writes every packet to the one conn it dialed at startup. To choose a link per packet it needs the destination before it writes, which it has — `destinationOf(pkt)` is already in the package (`p2p.go`).

**Files:**
- Create: `x/handler/tun/link.go`
- Modify: `x/handler/tun/client.go`
- Test: `x/handler/tun/link_test.go`

**Interfaces:**
- Consumes: nothing from wisper. This task is x-local.
- Produces:
  ```go
  // LinkProvider hands the client the conn a device packet should leave on, and
  // the conns packets may arrive on. A nil provider means the client uses the
  // single conn it dialed — today's behaviour, byte for byte.
  type LinkProvider interface {
      // LinkFor returns the conn for the packet bound for dst, or nil to use
      // the client's default conn. It must not block indefinitely: the client
      // holds the device's read pump for its duration.
      LinkFor(ctx context.Context, dst net.IP) net.Conn
      // Links returns every conn inbound packets may arrive on, beyond the
      // default one. The client reads them and writes what they carry into the
      // device. Called once per link-established cycle.
      Links(ctx context.Context) []net.Conn
  }
  ```
  Add to the handler options in `handler.go`:
  ```go
  // LinkProviderOption sets the per-packet link provider.
  func LinkProviderOption(p LinkProvider) HandlerOption
  ```

- [ ] **Step 1: Write the failing test**

```go
func TestClientPumpWritesPerPacketToSelectedLink(t *testing.T) {
	// A device carrying one packet for 10.10.100.3 must land on the link the
	// provider names for it, and one for 10.10.100.2 on the other — with both
	// packets arriving, in order, on the right conn.
	...
}
```

The client reads from an `io.ReadWriter` device, so the test drives it with pipes and no real device. Follow the shape already in `p2p_test.go` / `client_test.go` — read how those construct a handler with a device and assert on written bytes, and reuse that harness rather than inventing one. The assertions that matter:

- a packet whose destination is `10.10.100.3` arrives, unmodified, on provider link A; a packet for `10.10.100.2` arrives unmodified on link B;
- the provider is asked for the destination of each packet (record the dsts it was called with and assert both appear);
- `LinkFor` returning nil sends the packet to the default conn.

And the regression, in the same file:

```go
func TestClientPumpWithoutProviderIsUnchanged(t *testing.T) {
	// No provider: every packet goes to the pre-dialed conn, and Links() is
	// never consulted. This is the pre-phase-2 path and must not drift.
	...
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/x && GOWORK=off CGO_ENABLED=1 go test ./handler/tun/ -run 'TestClientPump' -count=1`
Expected: FAIL — `LinkProvider` undefined.

- [ ] **Step 3: Implement `x/handler/tun/link.go`**

The interface plus its documented contract. Keep it to the interface and any small helper the client needs; the wisper implementation lives in the wisper module.

- [ ] **Step 4: Wire the hook into `client.go`**

In `handleClient`, after the conn is established and before `transportClient`, branch once:

- **No provider** — call `h.transportClient(ctx, conn, cc, log)` exactly as today. No other change in this path.
- **Provider** — run a pump that, per device packet, asks `LinkFor(ctx, destinationOf(pkt))`, writes to the returned conn or to `cc` when nil, and starts a reader goroutine per conn in `Links(ctx)` that writes inbound bytes into the device. Every conn the provider hands out must be closed when the pump returns, or the provider leaks links.

Note in the code why the packet cannot simply be handed to the provider and forgotten: the provider chooses a *link*, it does not see or own the packet's fate. If `LinkFor` returns a conn that is already closed (a link that died between selection and write), treat it as a failed write for this packet — log at debug and drop this packet, never fall back to the default conn mid-packet. Falling back per-packet would reorder traffic between two links; the fallback policy belongs to the provider's `LinkFor`.

`keepalive` and `probeDevice` keep using `cc`: registration and probe traffic is hub-link business by definition, and a probe answered over a direct link would prove nothing about the hub link.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/x && GOWORK=off CGO_ENABLED=1 go test ./handler/tun/ -run 'TestClientPump' -count=1`
Expected: PASS.

Then the package, which contains the pre-existing probe race — run it and separate the two:
Run: `cd /root/code/go-gost/x && GOWORK=off CGO_ENABLED=1 go test ./handler/tun/ -count=1`
Expected: PASS except `TestRunDeviceProbeReportsSent`, which fails on a clean tree too (see `.memory/notes/tun-probe-test-race.md`). If anything *else* fails, it is this task's.

- [ ] **Step 6: Commit**

```bash
cd /root/code/go-gost/x
git add handler/tun/link.go handler/tun/link_test.go handler/tun/client.go handler/tun/handler.go
git commit -m "feat(tun): let the client pick a link per packet"
```

---

### Task 5: The spoke's direct-link manager

The spoke half: it holds the snapshot, punches a path on demand, dials a direct link with the same chain shape the hub link already uses, and implements Task 4's `LinkProvider`.

**Files:**
- Create: `wisper/tunnel/entrypoint/direct.go`
- Test: `wisper/tunnel/entrypoint/direct_test.go`

**Interfaces:**
- Consumes: Task 4's `LinkProvider`; Task 1's `peerSnapshot`; the chain-building shape already in `entrypoint/tun.go:170-186` (forward connector, udp dialer, `metadata.p2p` = provider, `metadata["p2p.network"] = "ip"`).
- Produces:
  ```go
  // dialFunc opens one direct link to a peer key. It is a field so tests can
  // supply links without a p2p host.
  type dialFunc func(ctx context.Context, peer string) (net.Conn, error)

  type directLinks struct { /* ... */ }
  func newDirectLinks(punch func(ctx context.Context, peer string) error, dial dialFunc, log logger.Logger) *directLinks
  // SetSnapshot installs a snapshot. A rev that is not newer is ignored
  // wholesale; an unknown hub id is accepted and resets the held rev.
  func (d *directLinks) SetSnapshot(snap peerSnapshot)
  // PeerFor reports the member key owning dst, and whether the address is
  // claimed by any member at all.
  func (d *directLinks) PeerFor(dst net.IP) (peer string, known bool)
  // LinkFor implements x's LinkProvider: a live direct link for dst's owner,
  // or nil (hub link) when there is none.
  func (d *directLinks) LinkFor(ctx context.Context, dst net.IP) net.Conn
  // Stats reports directPeers (live direct links) and relayFallback (packets
  // that went to the hub because no direct link existed or it was down).
  func (d *directLinks) Stats() (directPeers int, relayFallback uint64)
  func (d *directLinks) Close()
  ```

  Backoff for a failed punch/dial: `directRetryBackoff` as a package `var` (30 * time.Second), per peer. A peer that failed is not retried until the backoff expires, and a packet for it during the backoff goes to the hub.

- [ ] **Step 1: Write the failing test**

```go
func TestDirectLinksPreferDirectAndFallBack(t *testing.T) {
	var punched, dialed []string
	d := newDirectLinks(
		func(_ context.Context, peer string) error { punched = append(punched, peer); return nil },
		func(_ context.Context, peer string) (net.Conn, error) {
			dialed = append(dialed, peer)
			server, client := net.Pipe()
			go func() { _, _ = io.Copy(io.Discard, server) }()
			return client, nil
		},
		testLogger(),
	)
	d.SetSnapshot(peerSnapshot{Hub: "hub1", Rev: 1, Peers: []peerSnapshotPeer{
		{Peer: "peerB", Addrs: []string{"10.10.100.3"}},
	}})

	dst := net.ParseIP("10.10.100.3")
	if link := d.LinkFor(context.Background(), dst); link == nil {
		t.Fatal("a known peer with no link yet must be punched, not routed to the hub")
	}
	if len(punched) != 1 || punched[0] != "peerB" || len(dialed) != 1 {
		t.Fatalf("punched=%v dialed=%v, want one peerB each", punched, dialed)
	}

	// The second packet reuses the link — no second punch.
	if d.LinkFor(context.Background(), dst) == nil {
		t.Fatal("the established link must be reused")
	}
	if len(punched) != 1 {
		t.Fatalf("punched %d times, want 1", len(punched))
	}

	// An address no member claims is the hub's business.
	direct, fallback := d.Stats()
	if direct != 1 {
		t.Fatalf("directPeers = %d, want 1", direct)
	}
	if d.LinkFor(context.Background(), net.ParseIP("10.10.100.9")) != nil {
		t.Fatal("an unclaimed address must go to the hub")
	}
	_ = fallback
}

func TestDirectLinksIgnoreStaleSnapshot(t *testing.T) {
	d := newDirectLinks(okPunch, countingDial, testLogger())
	d.SetSnapshot(peerSnapshot{Hub: "hub1", Rev: 5, Peers: []peerSnapshotPeer{{Peer: "peerB", Addrs: []string{"10.10.100.3"}}}})

	// Same hub, older rev: ignored, so the membership learned at rev 5 stands.
	d.SetSnapshot(peerSnapshot{Hub: "hub1", Rev: 4, Peers: []peerSnapshotPeer{{Peer: "rogue", Addrs: []string{"10.10.100.3"}}}})
	if peer, _ := d.PeerFor(net.ParseIP("10.10.100.3")); peer != "peerB" {
		t.Fatalf("peer = %q, want peerB: a stale snapshot must not apply", peer)
	}

	// Same rev, different content: also ignored.
	d.SetSnapshot(peerSnapshot{Hub: "hub1", Rev: 5, Peers: []peerSnapshotPeer{{Peer: "rogue", Addrs: []string{"10.10.100.3"}}}})
	if peer, _ := d.PeerFor(net.ParseIP("10.10.100.3")); peer != "peerB" {
		t.Fatalf("peer = %q, want peerB: an equal rev must not apply", peer)
	}

	// A new hub process: accepted, rev resets.
	d.SetSnapshot(peerSnapshot{Hub: "hub2", Rev: 1, Peers: []peerSnapshotPeer{{Peer: "rogue", Addrs: []string{"10.10.100.3"}}}})
	if peer, _ := d.PeerFor(net.ParseIP("10.10.100.3")); peer != "rogue" {
		t.Fatalf("peer = %q, want rogue: a new hub must be accepted", peer)
	}
}

func TestDirectLinksCloseLinkWhenPeerLeaves(t *testing.T) {
	var closed int
	d := newDirectLinks(okPunch, func(context.Context, string) (net.Conn, error) {
		server, client := net.Pipe()
		go func() {
			_, _ = io.Copy(io.Discard, server)
			_ = server.Close()
		}()
		_ = closed
		return client, nil
	}, testLogger())
	d.SetSnapshot(peerSnapshot{Hub: "hub1", Rev: 1, Peers: []peerSnapshotPeer{
		{Peer: "peerB", Addrs: []string{"10.10.100.3"}},
		{Peer: "peerC", Addrs: []string{"10.10.100.4"}},
	}})
	link := d.LinkFor(context.Background(), net.ParseIP("10.10.100.3"))
	if link == nil {
		t.Fatal("no link established")
	}

	// peerB leaves the network: its link must be closed, not orphaned.
	d.SetSnapshot(peerSnapshot{Hub: "hub1", Rev: 2, Peers: []peerSnapshotPeer{
		{Peer: "peerC", Addrs: []string{"10.10.100.4"}},
	}})
	_ = link.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := link.Read(make([]byte, 1)); err == nil {
		t.Fatal("the link to a departed peer must be closed")
	}
	if direct, _ := d.Stats(); direct != 0 {
		t.Fatalf("directPeers = %d, want 0", direct)
	}
}

func TestDirectLinksBackOffAfterFailedPunch(t *testing.T) {
	var attempts int
	d := newDirectLinks(
		func(context.Context, string) error { attempts++; return errors.New("no path") },
		func(context.Context, string) (net.Conn, error) { return nil, errors.New("unused") },
		testLogger(),
	)
	directRetryBackoff = time.Hour // keep the test from waiting
	d.SetSnapshot(peerSnapshot{Hub: "hub1", Rev: 1, Peers: []peerSnapshotPeer{
		{Peer: "peerB", Addrs: []string{"10.10.100.3"}},
	}})

	dst := net.ParseIP("10.10.100.3")
	if d.LinkFor(context.Background(), dst) != nil {
		t.Fatal("a failed punch must yield no link")
	}
	if d.LinkFor(context.Background(), dst) != nil {
		t.Fatal("a failed punch must yield no link")
	}
	if attempts != 1 {
		t.Fatalf("punch attempts = %d, want 1: a backoff must stop a retry storm", attempts)
	}
	if _, fallback := d.Stats(); fallback != 2 {
		t.Fatalf("relayFallback = %d, want 2", fallback)
	}
}
```

Restore `directRetryBackoff` to its default with `t.Cleanup` — these tests run in one process and the package's other tests must see the real value.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/entrypoint/ -run TestDirectLinks -count=1`
Expected: FAIL — `undefined: newDirectLinks`.

- [ ] **Step 3: Implement `direct.go`**

State under one mutex: `hubID string`, `rev uint64`, `byAddr map[string]string` (address → peer key; an address claimed by two peers keeps the first and logs a warn, because a hub that honours two claims for one address would have refused both rows in `honorablePeerIPs`), `links map[string]*directLink`, `failUntil map[string]time.Time`, and the counters.

`directLink` is `conn net.Conn`, `punchedAt time.Time`, plus a `closed` flag so `Close` is idempotent.

`SetSnapshot(snap)`:
- if `snap.Hub == d.hubID && snap.Rev <= d.rev` → return, unchanged.
- if `snap.Hub != d.hubID` and `d.hubID != ""` → this is a different hub: drop every link (its peers mean nothing here), reset `rev`, set the new hub id.
- install the new `byAddr`, set `rev`.
- close every link whose peer is absent from the new snapshot, and forget it.
- clear `failUntil` entries for peers still present, so a peer that rejoined is tried again.

`LinkFor(ctx, dst)`:
- `peer, known := d.PeerFor(dst)`; if `!known` → increment `relayFallback`, return nil (hub link).
- if a live link exists → return it.
- if `failUntil[peer]` is in the future → increment `relayFallback`, return nil.
- else `punch(ctx, peer)`; on error, set `failUntil[peer] = now + directRetryBackoff`, increment `relayFallback`, return nil. On success, `dial(ctx, peer)`; same handling on error, plus close a conn returned alongside an error if there is one.
- store and return the conn.

A closed conn found in `links` is removed and treated as a failure (fallback + backoff), which is how a link that died between packets stops being handed out.

Document that authorization is membership: a member may link to any other member, so the only check is "is this address claimed by a member I know". That is the spec's confirmed decision, not an oversight.

`Stats` returns the live link count and the fallback counter.

`Close` closes every link and clears the maps.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/entrypoint/ -run TestDirectLinks -count=1`
Expected: PASS.

- [ ] **Step 5: Run with the race detector**

Run: `cd /root/code/go-gost/wisper && CGO_ENABLED=1 go test ./tunnel/entrypoint/ -run TestDirectLinks -race -count=1`
Expected: PASS. This state is touched from the control reader and the device pump concurrently; a failure here means the locking is wrong.

- [ ] **Step 6: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/entrypoint/direct.go tunnel/entrypoint/direct_test.go
git commit -m "feat(tun): manage on-demand direct links between peers"
```
---

### Task 6: The spoke's control channel and provider wiring

The direct-link manager exists; now the entrypoint starts a control channel to the hub, feeds it snapshots, and hands the manager to the handler as the link provider.

**Files:**
- Modify: `wisper/tunnel/entrypoint/tun.go`
- Test: `wisper/tunnel/entrypoint/tun_test.go`

**Interfaces:**
- Consumes: Task 5's `directLinks`; Task 3's `controlMagic`, `readSnapshot`; Task 4's `LinkProviderOption`.
- Produces: nothing new — the entrypoint's observable behaviour is the product.

- [ ] **Step 1: Write the failing test**

Extend the file's existing entrypoint tests (read them first; `TestTunEntryPointDefaultsRoutesToOwnSubnet` is the pattern to follow) with one test on the config the entrypoint builds, because that is where the new option must appear:

```go
func TestTunEntryPointInstallsLinkProvider(t *testing.T) {
	// init is where the handler's options are decided, so assert there: with
	// direct peering configured the handler gets a provider, and the
	// entrypoint's config still carries exactly one service and one chain —
	// the hub link — so a direct link cannot be mistaken for a second device.
	...
}
```

If `init` cannot see the handler options (they are built in `RunContext`), assert on a small seam instead: a `tunEntryPoint.linkProvider()` accessor returning the manager, `nil` before `RunContext` has built it. Assert:

- `linkProvider()` is nil before `RunContext`;
- after `RunContext` (in the existing harness that already starts an entrypoint — find it in `tun_test.go`) it is non-nil and its `Stats()` report `directPeers == 0`;
- `len(s.config.Services) == 1` and `len(s.config.Chains) == 1` throughout, which is the "one device, one hub link" invariant on Android.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/entrypoint/ -run 'TestTunEntryPoint' -count=1`
Expected: FAIL — `linkProvider` undefined.

- [ ] **Step 3: Wire the control channel into `RunContext`**

After the p2p host is acquired and the entrypoint's own provider is registered (the existing code at `entrypoint/tun.go:248-251`), and reusing that same `host` for punching:

```go
// Direct peering: the hub tells us who else is on the network, and we punch
// a path to them on demand. Best-effort throughout — with no snapshot, every
// packet keeps flowing over the hub link this entrypoint already holds.
s.links = newDirectLinks(host.PunchContext, s.dialDirectPeer, log)
```

`s.dialDirectPeer(ctx, peer)` builds a direct chain and dials it, mirroring `init`'s hub chain (`tunnel.ChainConfig(...)`, node addr = the peer key, `forward` connector, `udp` dialer, `metadata.p2p` = `s.provider`, `metadata["p2p.network"] = "ip"`) and returns `xchain.NewRouter(chain.ChainRouterOption(ch)).Dial(ctx, "ip", "")`.

Two details that matter and are easy to get wrong:
- The chain must be built per dial, not once at start: each direct link is its own chain, and a chain holds a node's connector state.
- `p2p.network: ip` stays on the direct chain too, so a direct link whose far side vanishes is torn down by the host rather than left half-open.

Then start the control channel in a goroutine, after `host` is available:

```go
go s.runControlChannel(ctx, host, log)
```

`runControlChannel` dials the hub's peer key through a chain of the same shape (a distinct chain name and provider name per direction so it does not collide with the hub link's), writes `controlMagic` as its first bytes, then loops `readSnapshot` → `s.links.SetSnapshot(snap)` until the conn dies, redialing with the same 1-second spacing the other reconnect paths in this file use. Every failure here is logged at debug and retried: the control channel is advisory, and a spoke without one is a spoke that routes everything through the hub.

- [ ] **Step 4: Hand the manager to the handler**

In the handler construction block (`entrypoint/tun.go:312`):

```go
h := tunhandler.NewHandler(
    handler.RouterOption(xchain.NewRouter(...)),
    handler.LoggerOption(handlerLogger),
    tunhandler.LinkProviderOption(s.linkProvider()),
)
```

`s.linkProvider()` returns `s.links` or nil if it is not built. Returning nil is the honest "no direct peering" answer and lands the client on Task 4's unchanged path.

Release the manager on the way out: add `if s.links != nil { s.links.Close() }` to the existing teardown in `RunContext`'s deferred path, next to the provider unregister and `ReleaseP2PHost`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/entrypoint/ -count=1`
Expected: PASS.

- [ ] **Step 6: Run the gate**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go build ./...`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/entrypoint/tun.go tunnel/entrypoint/tun_test.go
git commit -m "feat(tun): wire direct peering into the tun entrypoint"
```

---

### Task 7: Make the chosen path visible

An operator staring at a spoke that "sometimes works" needs to see which path each packet took. Counters are the whole of this task.

**Files:**
- Modify: `wisper/config/config.go` (`ServiceStats`)
- Modify: `wisper/tunnel/entrypoint/tun.go` (report the counters)
- Modify: the doctor/peers surface that reads `P2PHostStatus` — find it by reading `doctor.Report(tunnel.P2PHostStatus(), opts)` at `api/p2p_handler.go:113` and following where it renders.
- Test: the doctor/report test file for whichever package owns `doctor.Report`.

**Interfaces:**
- Consumes: Task 5's `directLinks.Stats() (directPeers int, relayFallback uint64)`.
- Produces: two new `uint64` fields on `config.ServiceStats` next to `ProbeSent`/`ProbeAcked` (`config/config.go:461`): `DirectPackets uint64`, `RelayPackets uint64`. The names say packets, not links, because they are per-packet counters and a gauge called `directPeers` in a stats struct would read as a link count.

  Rename the spec's `directPeers` accordingly: the live link count is available from `directLinks.Stats()` for the status line; the stats struct carries the two packet counters. Note the deviation in the commit body.

- [ ] **Step 1: Write the failing test**

In the doctor/report test file:

```go
func TestReportShowsDirectAndRelayPaths(t *testing.T) {
	// A spoke that has one live direct link and has sent some packets both
	// ways must render both paths, so "which way did my traffic go" is
	// answerable from the UI.
	...
}
```

Read the existing report tests first and match their construction. The assertions: the rendered output names the direct path and the relay path with their two counters, and a spoke with no direct link still renders the relay line (an absent line must not read as "no traffic").

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /root/code/go-gost/wisper && go test ./doctor/ -run TestReport -count=1` (adjust the package to wherever `doctor.Report` lives).
Expected: FAIL — the fields do not exist.

- [ ] **Step 3: Add the fields and report them**

Add `DirectPackets` and `RelayPackets` to `ServiceStats`. In the entrypoint, extend the existing `probeReport`-style delta hook (`entrypoint/tun.go:287`) with a `linkReport func(direct, relay uint64)` that adds the deltas into the entrypoint's `pStats`, wired from `directLinks`' counters. Then render them where `doctor.Report` renders the tun entrypoint's stats.

Keep the presentation to the existing style — one line, both numbers. A per-peer breakdown is out of scope; it is phase 3 material with LAN peering, where "which peer" becomes the question.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./doctor/ ./tunnel/... -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add config/config.go tunnel/entrypoint/tun.go doctor/ api/
git commit -m "feat(tun): report whether traffic went direct or via the hub"
```

---

### Task 8: End-to-end verification

Nothing above proves two spokes actually reach each other directly. This task proves it, and it is the only place a real p2p host is used.

**Files:**
- Modify: `wisper/tunnel/p2p_entrypoint_e2e_test.go` (the file that already stands up hub + entrypoint over a real p2p host — read it and follow its harness)
- No production changes. If a test here forces a production change, that is a finding: fix it in the task that owns the code and come back.

**Interfaces:**
- Consumes: everything.
- Produces: proof.

- [ ] **Step 1: Write the failing test**

```go
func TestTunSpokesReachEachOtherDirectly(t *testing.T) {
	// Three members: hub, spokeA, spokeB. Each spoke has its own address and
	// its own p2p identity. A packet from A addressed to B must reach B, and
	// the hub's counters must show the hub neither forwarded nor received it.
}
```

The hub-side assertion is the load-bearing one: "the spoke's `DirectPackets` counter moved and the hub's per-peer traffic for that pair did not" is what distinguishes a direct path from a hub relay that happened to work. Assert both.

And the fallback case, which is the more valuable of the two:

```go
func TestTunSpokeFallsBackToHubWithoutASnapshot(t *testing.T) {
	// A spoke whose control channel never opens (its control dial is blocked)
	// must still reach B, through the hub, and its RelayPackets counter must
	// say so.
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestTunSpokesReach|TestTunSpokeFallsBack' -count=1 -timeout 5m`
Expected: FAIL — no direct peering yet (the hub link works, so the fallback test may already pass; the direct one must fail).

- [ ] **Step 3: Make them pass**

No production code. If they fail for a reason the earlier tasks should have covered, that is a bug in the earlier task — fix it there and re-run that task's tests.

- [ ] **Step 4: Run the whole gate**

```sh
cd /root/code/go-gost/wisper && GOWORK=off go build ./... && CGO_ENABLED=1 go test -race -p 1 ./tunnel/... -count=1
cd /root/code/go-gost/x && GOWORK=off go build ./... && CGO_ENABLED=1 go test -race -p 1 ./handler/tun/ -count=1
```

Expected: all pass, except the pre-existing `TestRunDeviceProbeReportsSent` race in x, which fails on a clean tree.

Run the x suite per-package, never with a bare `./...` wildcard — it hangs.

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/p2p_entrypoint_e2e_test.go
git commit -m "test(tun): prove spokes reach each other directly and fall back"
```

---

## Follow-ups this plan deliberately leaves out

- **LAN peering** (`share_lan` reachable from a remote spoke) is phase 3. When it comes, the snapshot's `Addrs` field is where the subnet claims go, and `x/handler/tun/p2p.go`'s `dispatch`/`fromSpoke` gain the gateway fallback the socket path already has in `findRouteFor` (`x/handler/tun/server.go:263`).
- **Source-based access control** on a LAN route: a hook at the same chokepoint, defaulting to open, since the hub allowlist is whole-network membership today.
- **Per-peer traffic counters** in the peers page, once LAN peering makes "which peer" the natural question.
- **Multi-hub.** Every task here is written against a single hub. The snapshot's `Hub` field is the seam a second hub's view would arrive on, but nothing in this plan consumes two.

## Self-Review

**Spec coverage.** §4's three bullets map to Tasks 1–3 (snapshot and its push), Tasks 4–6 (multi-link spoke data plane with on-demand punch and hub fallback), and Task 5's `PeerFor` (the membership check on both ends). §5's `ErrNoRoute` counting is untouched — no new drop path is introduced — and `directPeers`/`relayFallback` become Task 7's `DirectPackets`/`RelayPackets`. §6's gates are Task 8. The spec's "x zero-diff" holds for the control plane (Tasks 1–3, 5–7 are all wisper-side); it does not hold for the data plane, which needs Task 4's per-packet hook. That deviation is stated in Task 4 and in Task 7 for the counter rename.

**Step scan.** Each step names a signature, a test, or a command. Task 4's test bodies are left to the existing harness deliberately — `client_test.go` already builds a device-backed client, and transcribing it into the plan would duplicate code that must stay in sync with it. Task 6's test has the same property, and says so.

**Type consistency.** `peerSnapshot`/`peerSnapshotPeer` are defined once in Task 1 and consumed unchanged in Tasks 3, 5, 6. `LinkProvider` is defined in Task 4 and implemented by `directLinks` in Task 5, wired in Task 6. `directLinks.Stats()` returns `(int, uint64)` in Task 5 and Task 7 reads it. `controlMagic` is defined in Task 2, consumed in Tasks 3 and 6.

**Review Focus.** All seven lines are pinned: departed peer (Task 5), stale/equal rev (Task 5), unclaimed destination (Task 5), dead link (Task 5's closed-conn path, Task 8's fallback), punch failure (Task 5's backoff test, Task 8), hub restart (Tasks 1 and 5), no snapshot (Task 8).

**Proportion.** Roughly 600 lines of plan for a change that touches ~10 files across two modules. Task 8 is a quarter of it, which is the right share for the only task that proves the feature works.
