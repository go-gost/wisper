# wisper LAN Routing: Peer LANs Reachable Through the Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spoke reaches an address inside another peer's LAN, relayed through the hub, with the hub as the only authority on which LANs exist and who may use them — and with a spoke that claims nothing behaving exactly as it does today.

**Architecture:** One control stream per hub↔spoke pair, dialed alongside the existing tun link and demuxed at the hub by conn shape (a tun stream is always a `net.PacketConn`; the control stream is not). It carries two directions: `netview@1` (hub→spoke, a versioned snapshot of members and approved LAN claims) and `claim@1` (spoke→hub, add/drop of the peer's own intent). The hub arbitrates claims into a RIB and pushes the winners; the spoke installs them into a named `tun.router` whose `GetRoute` does longest-prefix match. The one x change is a prefix table in the hub's dispatch so a LAN-bound packet reaches the peer that owns it.

**Tech Stack:** Go, `github.com/go-gost/wisper` (hub/entrypoint/RIB), `github.com/go-gost/x` (prefix routes + LPM in the p2p handler), `github.com/go-gost/p2p` (control stream transport), gVisor userspace stack (existing, sharer fallback).

**Spec:** `wisper/docs/superpowers/specs/2026-10-08-wisper-lan-routing-design.md` (§3 decisions, §4 RIB/messages, §5 conflict/approval, §7 x change, §8 sharer, §10 failure semantics, §11 observability, §12 gates).

## Global Constraints

- **Single hub, IPv4-first, members mutually trusting.** The hub allowlist is whole-network membership. A route an admin approved is usable by every member by default; an optional per-route `allow` list narrows it.
- **Approval and access are two layers.** `lan_allow` (per peer, per supernet) decides whether a claimed CIDR may exist in the RIB; `allow` on a route decides who may use it. Default-deny for dynamic claims, default-open for approved routes.
- **Conflict resolution: static beats dynamic, longest prefix wins, equal length first-wins with a conflict event.** The hub is the final arbiter; a losing claim is not an error, it is a logged event.
- **v1 sharers are Linux hosts only.** Android consumers (spokes using LAN routes) are supported and unchanged; Android *sharers* are a later plan — they need `VpnService.protect(fd)`, a differently-shaped shim, and a claim config surface.
- **TCP and UDP only.** ICMP is dropped at classification and counted (`shareDevice.Dropped()`); no LAN→spoke inbound connections (no port mapping).
- **Exact host routes always win over prefix routes.** `peerTable`'s existing /32 registrations are unmatched authority; LAN routes never displace or shadow them.
- **Test commands:** wisper package tests need no special env; x cross-module checks need `GOWORK=off`. Run x tests per-package or with `-p 1` (a wildcard hangs). `-race` needs `CGO_ENABLED=1`. Known pre-existing failure unrelated to this work: `TestRunDeviceProbeReportsSent` in `x/handler/tun` races on a clean tree.
- **Commit discipline:** one commit per task, conventional message. Do not push unless asked.

## Review Focus

Each line is an input or condition the spec implies but no happy-path test covers. Each is pinned by a test in the task that owns the code.

1. **A device packet for a LAN address no member claims.** Expect: it goes to the hub and is still `no route` there — never dropped locally because a supernet was captured.
2. **A claim that arrives for a CIDR overlapping the peer's own tun address.** The hub must refuse it before it can blackhole that member's own host traffic. Expect: claim denied, conflict event, peer's /32 untouched.
3. **A hub that restarts while a spoke holds a high `Rev`.** Expect: the spoke accepts the new hub's `Rev:1` netview, because the hub id changed — and rejects a *same-hub* lower rev.
4. **A spoke whose control channel never opens.** Expect: it uses LAN routes it already holds until they expire, claims nothing, and reaches every member as it does today.
5. **Two peers claiming the same /24 at the same instant.** Expect: first-wins by arrival, second gets a conflict event naming both, and no routing flap when they flap their connections.
6. **A route with an `allow` list that does not include the sender.** Expect: the hub drops the packet and counts it; it does not silently deliver to the LAN.
7. **A sharer whose LAN is gone (Wi-Fi down, cable out) while its claim is still in the RIB.** Expect: keepalive TTL withdraws the claim, and a new dial to that subnet is `no route` — not a blackhole.

## File Structure

| File | Responsibility |
|---|---|
| `wisper/tunnel/ctrl.go` (new) | Control-stream wire format: `netview@1`, `claim@1`, length framing, magic, unknown-version rule. No policy. |
| `wisper/tunnel/rib.go` (new) | The RIB: claim intake, `lan_allow` approval, static injection, conflict arbitration, LPM snapshot of winners. |
| `wisper/tunnel/rib_test.go` (new) | Approval, conflict, static-wins, snapshot shape. |
| `wisper/tunnel/tun.go` (modify) | Hub side: open the control listener, feed claims to the RIB, push netviews on change and tick, `SetPrefixRoutes` into the handler. |
| `wisper/tunnel/p2p_host.go` (modify) | Shape-first demux: `PacketConn` → tun route unread; byte stream on a controlled key → magic, then control listener. |
| `x/handler/tun/router.go` (modify) | `SetPrefixRoutes` + longest-prefix lookup, after exact match. |
| `x/handler/tun/p2p.go` (modify) | `dispatch`: exact route, then prefix, then `ErrNoRoute`. |
| `wisper/tunnel/entrypoint/netview.go` (new) | Spoke side: holds the latest netview, sends its own `share_lan` claim, re-sends on reconnect. |
| `wisper/tunnel/netview_router.go` (new) | The named `router.Router` implementation: netview + LPM, registered under `tun.router`. |
| `wisper/tunnel/entrypoint/share.go` (new) | Sharer side: `setupShareLAN` called with the roles swapped, plus the userspace chain-side shim. |
| `wisper/tunnel/tun_control.go` (new) | Hub control listener: one goroutine per spoke stream, framing reads, netview writes. |

Task order is a dependency chain: 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

### Task 1: The control stream's wire format

Nothing else in this plan can be tested until a message can cross the stream. This task is the format only — no policy, no RIB, no hub wiring.

**Files:**
- Create: `wisper/tunnel/ctrl.go`
- Test: `wisper/tunnel/ctrl_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```go
  // ControlMagic opens a control stream. Four bytes: 'W' is 0x57, high nibble
  // 5, and an IP packet's version nibble is 4 or 6 — so no device stream can
  // begin with it. 'GOST' is NOT available: it is the keepalive registration
  // frame's magic (x/handler/tun/client.go:27), which is the first frame on
  // every tun stream (client.go:71 runs the handshake before transportClient),
  // and 'G' is 0x47 — high nibble 4, a legal IPv4 header start.
  var ControlMagic = []byte("WISP")

  // maxFrame caps one message body. A spoke that sends a larger length is
  // refused before its body is read.
  const maxFrame = 64 << 10

  type netviewMessage struct {
      Type    string        `json:"type"`  // "netview"
      V       int           `json:"v"`     // 1
      Hub     string        `json:"hub"`
      Rev     uint64        `json:"rev"`
      Members []memberEntry `json:"members"`
      Claims  []claimEntry  `json:"claims"`
  }
  type memberEntry struct {
      IP  string `json:"ip"`  // the member's tun address, "10.10.100.5"
      Key string `json:"key"` // its peer key
  }
  type claimEntry struct {
      Prefix string   `json:"prefix"` // "192.168.50.0/24"
      Origin string   `json:"origin"` // claiming peer key
      Allow  []string `json:"allow"`  // empty = every member
  }
  type claimMessage struct {
      Type string   `json:"type"` // "claim"
      V    int      `json:"v"`    // 1
      Add  []string `json:"add"`
      Drop []string `json:"drop"`
  }

  // writeMessage frames one message: 4-byte big-endian length then the JSON.
  func writeMessage(w io.Writer, m any) error
  // readMessage reads one framed message. An unknown type, a version above 1,
  // or an oversize length is an error the caller turns into "drop the frame,
  // keep the stream" — forward-compat, the same rule derpclient applies
  // (p2p/internal/derpclient/derpclient.go:16).
  func readMessage(r io.Reader) (netviewMessage, claimMessage, error)
  ```
  `readMessage` returns both structs because a caller reading a mixed stream does not know which is coming; exactly one is non-zero. Decoding is per-type: a `netview` decodes into `netviewMessage` and leaves `claimMessage` zero, and vice versa.

- [ ] **Step 1: Write the failing test**

```go
func TestMessageRoundTrip(t *testing.T) {
	want := netviewMessage{Type: "netview", V: 1, Hub: "hub1", Rev: 3,
		Members: []memberEntry{{IP: "10.10.100.5", Key: "k1"}},
		Claims:  []claimEntry{{Prefix: "192.168.50.0/24", Origin: "k2"}},
	}
	var buf bytes.Buffer
	if err := writeMessage(&buf, want); err != nil {
		t.Fatal(err)
	}
	got, claim, err := readMessage(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Type != "" {
		t.Fatalf("a netview also decoded a claim: %+v", claim)
	}
	if got.Rev != want.Rev || got.Hub != want.Hub || len(got.Members) != 1 ||
		len(got.Claims) != 1 || got.Claims[0].Prefix != "192.168.50.0/24" {
		t.Fatalf("round trip changed the message: %+v", got)
	}
}

func TestReadMessageRefusesBadInput(t *testing.T) {
	// An oversize length: refused before its body is read, so a hostile
	// spoke cannot make the hub allocate.
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], maxFrame+1)
	if _, _, err := readMessage(bytes.NewReader(hdr[:])); err == nil {
		t.Fatal("an oversize frame must be refused")
	}

	// A version we do not speak: an error the caller drops, not a panic.
	body := []byte(`{"type":"netview","v":99,"hub":"h","rev":1}`)
	binary.BigEndian.PutUint32(hdr[:], uint32(len(body)))
	if _, _, err := readMessage(bytes.NewReader(append(hdr[:], body...))); err == nil {
		t.Fatal("an unknown version must be refused")
	}

	// An unknown type: same rule.
	body = []byte(`{"type":"somethingelse","v":1}`)
	binary.BigEndian.PutUint32(hdr[:], uint32(len(body)))
	if _, _, err := readMessage(bytes.NewReader(append(hdr[:], body...))); err == nil {
		t.Fatal("an unknown type must be refused")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestMessage' -count=1`
Expected: FAIL — `writeMessage`, `readMessage`, `netviewMessage` undefined.

- [ ] **Step 3: Implement `wisper/tunnel/ctrl.go`**

`writeMessage`: `json.Marshal`, check `len(body) <= maxFrame`, write the length then the body. `readMessage`: read 4 bytes (a short read is an error), refuse a length above `maxFrame`, read exactly that many, then unmarshal twice — once into `netviewMessage` and once into `claimMessage` — and validate on each: the right `type` string, `V == 1`, and for a netview that `Claims`/`Members` parse. Return the error for an unknown type or version.

Keep the message types free of `netip.Prefix`: JSON carries strings, and parsing/validation of a prefix belongs to the RIB (Task 2), which is where a malformed CIDR has consequences. A CIDR that does not parse here is simply carried.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestMessage' -count=1`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/ctrl.go tunnel/ctrl_test.go
git commit -m "feat(tun): define the hub-spoke control wire format"
```

---

### Task 2: The hub's RIB

The RIB decides which LAN claims exist, and carries the two rules that make a claim safe: per-peer approval, and conflict resolution. Nothing here touches a packet or a stream.

**Files:**
- Create: `wisper/tunnel/rib.go`, `wisper/tunnel/rib_test.go`

**Interfaces:**
- Consumes: Task 1's `claimEntry` type.
- Produces:
  ```go
  type lanClaim struct {
      Prefix netip.Prefix
      Origin string   // claiming peer key, or "static"
      Static bool
      Allow  []string // empty = every member
  }

  // newRIB: allow is the hub's lan_allow policy — per peer, the supernets it
  // may claim inside. A peer absent from it may claim nothing. events receives
  // one line per conflict or refusal, for the hub log.
  func newRIB(hubID string, allow map[string][]netip.Prefix, events func(string, ...any)) *rib

  // ApplyClaim applies one spoke's add/drop. It returns the prefixes the RIB
  // accepted for that origin; everything it refused is already in events.
  func (r *rib) ApplyClaim(origin string, add, drop []netip.Prefix) []netip.Prefix

  // AddStatic injects a hub-config route. spec is "192.168.50.0/24" or
  // "192.168.50.0/24 via 10.10.100.9" or "192.168.50.0/24 via 10.10.100.9
  // allow=peerA,peerB". The "via" address is a member's tun address, resolved
  // to its key when the RIB is asked for routes; a via that names no member
  // is refused. Static routes outrank every dynamic claim on the same prefix.
  func (r *rib) AddStatic(spec string) error

  // Snapshot is the winners only: what a spoke is allowed to know. Same
  // content means an unchanged Rev.
  func (r *rib) Snapshot() claimSet

  type claimSet struct {
      Hub    string
      Rev    uint64
      Claims []claimEntry
      Members []memberEntry // from Task 1
  }
  ```

- [ ] **Step 1: Write the failing test**

```go
func TestRIBApprovalGatesDynamicClaims(t *testing.T) {
	var events []string
	r := newRIB("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
	}, func(format string, args ...any) { events = append(events, fmt.Sprintf(format, args...)) })

	// Inside the approved supernet: accepted.
	got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil)
	if len(got) != 1 {
		t.Fatalf("an approved claim was refused: %v", got)
	}

	// Outside it: refused, and the refusal is explained.
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("0.0.0.0/0")}, nil); len(got) != 0 {
		t.Fatal("a claim outside lan_allow must be refused")
	}
	if len(events) == 0 {
		t.Fatal("a refused claim must emit an event")
	}

	// A peer with no row at all: default deny.
	if got := r.ApplyClaim("rogue", []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}, nil); len(got) != 0 {
		t.Fatal("a peer absent from lan_allow must claim nothing")
	}
}

func TestRIBConflictStaticWinsAndLPM(t *testing.T) {
	r := newRIB("hub1", map[string][]netip.Prefix{"peerB": {netip.MustParsePrefix("192.168.0.0/16")}}, func(string, ...any) {})
	// A "via" resolves against the members the hub knows.
	r.SetMembers([]memberEntry{{IP: "10.10.100.9", Key: "peerB"}})

	// Dynamic first, so the static has something to beat.
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil); len(got) != 1 {
		t.Fatal("setup claim refused")
	}
	if err := r.AddStatic("192.168.50.0/24 via 10.10.100.9"); err != nil {
		t.Fatal(err)
	}
	for _, c := range r.Snapshot().Claims {
		if c.Prefix == "192.168.50.0/24" && c.Origin != "static" {
			t.Fatalf("a static route must outrank the dynamic claim: %+v", c)
		}
	}

	// A longer dynamic claim is a different destination, not a conflict: both
	// exist and the snapshot carries both, in longest-first order.
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.128/25")}, nil); len(got) != 1 {
		t.Fatal("a more-specific claim must not be refused by a shorter one")
	}
}

func TestRIBEqualLengthFirstWinsWithEvent(t *testing.T) {
	var events []string
	r := newRIB("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
		"peerC": {netip.MustParsePrefix("192.168.0.0/16")},
	}, func(format string, args ...any) { events = append(events, fmt.Sprintf(format, args...)) })

	r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil)
	if got := r.ApplyClaim("peerC", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil); len(got) != 0 {
		t.Fatal("an equal-length claim on a taken prefix must lose")
	}
	if len(events) == 0 {
		t.Fatal("the loser must produce a conflict event naming both")
	}
	// The winner must not flap when the loser reconnects and tries again.
	r.ApplyClaim("peerC", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil)
	for _, c := range r.Snapshot().Claims {
		if c.Prefix == "192.168.50.0/24" && c.Origin != "peerB" {
			t.Fatalf("first-wins must be stable across retries: %+v", c)
		}
	}
}

func TestRIBSnapshotRevOnlyOnChange(t *testing.T) {
	r := newRIB("hub1", map[string][]netip.Prefix{"peerB": {netip.MustParsePrefix("192.168.0.0/16")}}, func(string, ...any) {})
	if s := r.Snapshot(); s.Rev != 1 {
		t.Fatalf("first rev = %d, want 1", s.Rev)
	}
	first := r.Snapshot().Rev
	r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil)
	if r.Snapshot().Rev <= first {
		t.Fatal("a change must advance the rev")
	}
	// Re-applying the identical claim is not a change.
	before := r.Snapshot().Rev
	r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil)
	if r.Snapshot().Rev != before {
		t.Fatal("an identical re-claim must not advance the rev")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestRIB' -count=1`
Expected: FAIL — `newRIB` undefined.

- [ ] **Step 3: Implement `wisper/tunnel/rib.go`**

State under one mutex: `rev uint64`, `claims map[netip.Prefix]*lanClaim`, `allow map[string][]netip.Prefix`, the hub id, and the events sink.

`ApplyClaim`: for each add, parse the prefix, then refuse when (a) the origin has no `lan_allow` row containing the prefix, (b) the prefix is a member's own tun address or contains one (that would blackhole host traffic — refuse and event), or (c) a claim already exists for the *identical* prefix from another origin (first-wins, event). A drop removes only that origin's claim. Any change (accepted add, accepted drop) advances `rev`; a fully-idempotent re-apply does not.

`AddStatic`: parse `cidr [via addr] [allow=keys]`; resolve `via` through the members the hub reports (Task 4 passes them via `rib.SetMembers`) and refuse a via that names no member. Static claims overwrite a dynamic claim on the same prefix and are never overwritten by one.

`Snapshot`: emit `Claims` ordered longest-prefix-first so a first-match reader still gets LPM, with `Static` rows first inside an equal length. Set `Members` from the last `SetMembers`.

`func (r *rib) SetMembers(members []memberEntry)` — from the hub's peerTable/allowlist, so `via` resolves and `Members` in the snapshot is current.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TestRIB' -count=1`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/rib.go tunnel/rib_test.go
git commit -m "feat(tun): arbitrate LAN claims in the hub RIB"
```

---

### Task 3: Prefix routes and longest-prefix match in x

The one x change. Additive: no provider, no prefix table, no behaviour change.

**Files:**
- Create: `x/handler/tun/link.go` (the `prefixRoute` type and its doc)
- Modify: `x/handler/tun/router.go` (`peerTable` gains a prefix table + LPM), `x/handler/tun/p2p.go` (`dispatch`), `x/handler/tun/handler.go` (the setter)
- Test: `x/handler/tun/prefix_test.go`

**Interfaces:**
- Consumes: nothing from wisper; x-local.
- Produces:
  ```go
  // prefixRoute is a LAN route the hub holds: the member that reaches the
  // prefix, and the members allowed to use it (empty = everyone).
  type prefixRoute struct {
      Peer  string
      Allow []string
  }

  // SetPrefixRoutes replaces the hub's prefix table. Routes are matched
  // longest-prefix-first, and only after an exact peerTable match — a
  // member's registered /32 is unmatched authority and never displaced by a
  // LAN route.
  func (h *tunHandler) SetPrefixRoutes(routes map[netip.Prefix]prefixRoute)
  // lookupPrefix returns the peer owning dst by longest prefix, and whether
  // the requesting peer key may use it.
  func (pt *peerTable) lookupPrefix(dst net.IP, from string) (string, bool)
  ```

- [ ] **Step 1: Write the failing test**

```go
func TestPrefixLookupLongestPrefixAndAllow(t *testing.T) {
	pt := newPeerTable(nil, 0, "tun-service", nil)
	pt.SetPrefixRoutes(map[netip.Prefix]prefixRoute{
		netip.MustParsePrefix("192.168.0.0/16"):  {Peer: "peerWide"},
		netip.MustParsePrefix("192.168.50.0/24"): {Peer: "peerB"},
	})
	// Longest match wins.
	if peer, _ := pt.lookupPrefix(net.ParseIP("192.168.50.9"), "peerA"); peer != "peerB" {
		t.Fatalf("dst in the /24 resolved to %q, want peerB", peer)
	}
	if peer, _ := pt.lookupPrefix(net.ParseIP("192.168.77.9"), "peerA"); peer != "peerWide" {
		t.Fatalf("dst outside the /24 resolved to %q, want peerWide", peer)
	}
	// A member's exact route still outranks any prefix.
	pt.set(net.ParseIP("10.10.100.5"), "peerA")
	if peer, _ := pt.lookupPrefix(net.ParseIP("10.10.100.5"), "peerA"); peer != "peerA" {
		t.Fatal("an exact route must outrank a prefix")
	}
	// An allow list gates use.
	pt.SetPrefixRoutes(map[netip.Prefix]prefixRoute{
		netip.MustParsePrefix("192.168.50.0/24"): {Peer: "peerB", Allow: []string{"peerA"}},
	})
	if _, ok := pt.lookupPrefix(net.ParseIP("192.168.50.9"), "peerZ"); ok {
		t.Fatal("a peer outside allow must not use the route")
	}
}

func TestDispatchFallsThroughExactThenPrefixThenNoRoute(t *testing.T) {
	// Follow the harness of TestP2PDispatchSendsToPeerNamedByDestination
	// (p2p_test.go:302) and TestP2PDeliverReportsNoRoute (p2p_test.go:333).
	// One destination in a claimed LAN is delivered by prefix, and the same
	// destination with an empty prefix table still takes the existing
	// ErrNoRoute path — so the fall-through added a case, not a new outcome.
	...
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/x && GOWORK=off CGO_ENABLED=1 go test ./handler/tun/ -run 'TestPrefix|TestDispatchFallsThrough' -count=1`
Expected: FAIL — `SetPrefixRoutes` undefined.

- [ ] **Step 3: Implement**

`prefixRoute` lives in `link.go` with the doc comment above. `peerTable` gains `prefixes map[netip.Prefix]prefixRoute` guarded by its existing mutex; `lookupPrefix` walks the table and keeps the longest matching prefix, returning `ok=false` when the match carries an `Allow` that excludes `from`. `dispatch` calls it only after the exact lookup misses, and a denied prefix is treated as no route so the existing `countUnrouted` path counts it. `SetPrefixRoutes` is a hub-only method on `tunHandler`; document that it is meaningless on a spoke, where no inbound peer is routed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/x && GOWORK=off CGO_ENABLED=1 go test ./handler/tun/ -count=1`
Expected: PASS except `TestRunDeviceProbeReportsSent`, which fails on a clean tree too (pre-existing race).

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/x
git add handler/tun/link.go handler/tun/router.go handler/tun/p2p.go handler/tun/handler.go handler/tun/prefix_test.go
git commit -m "feat(tun): route hub packets by prefix after exact match"
```

---

### Task 4: The spoke installs netviews into a named router

**Files:**
- Create: `wisper/tunnel/netview_router.go`, `wisper/tunnel/entrypoint/netview.go`
- Test: `wisper/tunnel/netview_router_test.go`

**Interfaces:**
- Consumes: Task 1's `netviewMessage`, `readMessage`, `writeMessage`, `ControlMagic`; Task 2's RIB config shape.
- Produces:
  ```go
  // NetviewRouter implements core/router.Router over the newest netview, with
  // longest-prefix match. Registered by name so a listener references it with
  // tun.router (x/listener/tun/metadata.go:37) instead of baking routes at
  // init (tun.routes, metadata.go:70-121, which builds a fresh internal router
  // and cannot change afterwards).
  type NetviewRouter struct{ /* ... */ }
  func NewNetviewRouter() *NetviewRouter
  // Apply installs a netview. A Rev that is not newer is ignored; a new Hub
  // id resets the rev and is accepted.
  func (r *NetviewRouter) Apply(n netviewMessage)
  func (r *NetviewRouter) GetRoute(ctx context.Context, dst string, opts ...router.Option) *router.Route

  // RunControlChannel dials the hub's peer key over a chain of the same shape
  // as the tun link (forward connector, udp dialer, metadata p2p provider, no
  // "p2p.network" so the stream is a byte stream), writes ControlMagic, then
  // sends this spoke's share_lan as a claim and reads netviews until the conn
  // dies, redialing every second. Failures are logged at debug and retried.
  func RunControlChannel(ctx context.Context, cfg ControlChannelConfig)
  ```

```go
  type ControlChannelConfig struct {
      Host     endpoint // the shared p2p host, for PunchContext
      HubPeer  string   // the hub's peer key
      ShareLAN []string // this spoke's claimed CIDRs, from share_lan
      Provider any      // the entrypoint's p2p provider, for the chain metadata
      Router   *NetviewRouter
      Log      logger.Logger
  }
  ```

- [ ] **Step 1: Write the failing test**

```go
func TestNetviewRouterLPMAndUnknownDestination(t *testing.T) {
	r := NewNetviewRouter()
	r.Apply(netviewMessage{Type: "netview", V: 1, Hub: "hub1", Rev: 1, Claims: []claimEntry{
		{Prefix: "192.168.0.0/16", Origin: "peerW"},
		{Prefix: "192.168.50.0/24", Origin: "peerB"},
	}})

	// A claimed LAN: the route names the hub as the gateway, which is where
	// the spoke actually sends it.
	if rt := r.GetRoute(context.Background(), "192.168.50.9"); rt == nil {
		t.Fatal("a claimed prefix must resolve")
	}
	// Inside the /16 but outside the /24: the shorter claim still matches,
	// because the earlier task made the snapshot longest-first.
	if rt := r.GetRoute(context.Background(), "192.168.77.9"); rt == nil {
		t.Fatal("a /16 claim must match a destination no /24 covers")
	}
	// Nothing claims it: no route, and the packet keeps its existing fate.
	if rt := r.GetRoute(context.Background(), "8.8.8.8"); rt != nil {
		t.Fatalf("an unclaimed destination must have no route: %+v", rt)
	}
}

func TestNetviewRouterIgnoresStaleRevAndAcceptsNewHub(t *testing.T) {
	r := NewNetviewRouter()
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 5, Claims: []claimEntry{{Prefix: "192.168.50.0/24", Origin: "peerB"}}})
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 4, Claims: []claimEntry{{Prefix: "10.0.0.0/8", Origin: "peerX"}}})
	if rt := r.GetRoute(context.Background(), "10.1.2.3"); rt != nil {
		t.Fatal("a stale rev must not install")
	}
	r.Apply(netviewMessage{V: 1, Hub: "hub2", Rev: 1, Claims: []claimEntry{{Prefix: "10.0.0.0/8", Origin: "peerX"}}})
	if rt := r.GetRoute(context.Background(), "10.1.2.3"); rt == nil {
		t.Fatal("a new hub id must be accepted at any rev")
	}
}
```

- [ ] **Step 2: Run to verify failure**: `go test ./tunnel/ -run 'TestNetviewRouter' -count=1` → FAIL, `NewNetviewRouter` undefined.

- [ ] **Step 3: Implement**

`NetviewRouter` holds `hub string`, `rev uint64`, and the routes under a mutex. `GetRoute` walks them longest-prefix-first (the snapshot is already ordered; verify with a sort so a hand-built message works too), returning a `&router.Route{Net: ipNet, Dst: ipNet.String(), Gateway: <the hub's tun address>}` — the gateway is how `x/router`'s in-memory route is consumed, and on a spoke every approved LAN is behind the hub. Return `nil` when nothing matches.

`RunControlChannel` builds a chain per dial (a chain holds a node's connector state) and dials it, writes `ControlMagic`, then: send `claimMessage{Add: ShareLAN}` once per successful connect — a reconnect re-sends the whole claim, which is how the hub learns it survived — and loop `readMessage`, handing netviews to `Router.Apply`. A read error closes the conn, waits a second, and redials. Never fatal: a spoke without this channel reaches every member exactly as today.

- [ ] **Step 4: Run to verify pass**: `go test ./tunnel/ -run 'TestNetviewRouter' -count=1` → PASS (2 tests). Then `go test ./tunnel/ -count=1` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/netview_router.go tunnel/netview_router_test.go tunnel/entrypoint/netview.go
git commit -m "feat(tun): install hub-approved LAN routes on the spoke"
```

---

### Task 5: The sharer's side

**Files:**
- Create: `wisper/tunnel/share_spoke.go`, `wisper/tunnel/share_spoke_test.go`

Package `tunnel`, not `tunnel/entrypoint`: `shareClassify`, `shareStack` and `setupShareLAN` are unexported in `tunnel`, and the entrypoint already imports `tunnel` (`tunnel/entrypoint/entrypoint.go:13`), so the entrypoint calls the exported `SetupSpokeShare`. Put the shim in the same package as its collaborators.

**Interfaces:**
- Consumes: the existing `setupShareLAN(hubNet, lanSpec, mode string, kernelOK bool, run shareRunner) (string, bool, func(), error)` (`tunnel/natlan.go:90`), `BuildShareNATRules` (`:141`), `ParseShareLANNets`/`NormalizeShareMode`/`ShareAuto`; `shareStack`/`shareClassify` for the userspace fallback.
- Produces:
  ```go
  // SetupSpokeShare applies the sharer side: masquerade from the hub's subnet
  // into the claimed LAN, and the forwarding rules that let B's kernel pass
  // it out eth0. B's LAN is directly connected, so no route is added — the
  // kernel already knows it; only SNAT is missing, because a LAN host has no
  // route back to a spoke's virtual address.
  func SetupSpokeShare(hubNet string, lans []*net.IPNet, mode string, kernelOK bool) (effective string, cleanup func(), err error)

  // NewChainShareShim is the userspace fallback's spoke-side twin: where the
  // hub wraps its device conn (tunnel/tun.go:566), a spoke diverts outbound
  // chain writes to the stack and merges the stack's replies back into the
  // chain, because those replies are addressed to another spoke's virtual IP
  // and must travel back up the chain, not into this device.
  func NewChainShareShim(lans []*net.IPNet, stack ShareStackBackend) *ChainShareShim
  ```

- [ ] **Step 1: Write the failing test**

```go
func TestSpokeShareRulesMatchHubShape(t *testing.T) {
	// The rules B needs are the hub's own rules with the roles swapped: the
	// "hubNet" the hub masquerades from is the hub's subnet here.
	var ran []string
	eff, cleanup, err := SetupSpokeShare("10.10.100.0/24", []*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, ShareAuto, runner(&ran))
	...
	// Assert: one MASQUERADE from 10.10.100.0/24 to 192.168.50.0/24, the two
	// FORWARD rules, and no route added (a directly-connected LAN needs none).
}

func TestSpokeShareFallsBackToUserspace(t *testing.T) {
	// No iptables: the effective mode is userspace, and the shim routes a
	// LAN-bound TCP through the stack while a non-LAN packet passes through.
	... // drive NewChainShareShim with a fake ShareStackBackend and a net.Pipe chain
}
```

- [ ] **Step 2: Run to verify failure**: `go test ./tunnel/ -run 'TestSpokeShare' -count=1` → FAIL, `SetupSpokeShare` undefined.

- [ ] **Step 3: Implement**

`SetupSpokeShare` delegates to `setupShareLAN` with `hubNet` = the hub's subnet and `lanSpec` = the claimed CIDRs, and maps its return. Keep the same downgrade semantics: `kernel` pinned and unavailable is a start failure; `auto` degrades to userspace and says so in the effective mode the UI shows.

`ChainShareShim` is `shareDevice`'s twin with the write path redirected: classify on the write to the chain (`shareClassify` is reusable), send LAN-bound TCP/UDP into `shareStack`, and merge the stack's output channel into the chain's read side. ICMP takes the existing `Dropped()` path. The shim's `Close` tears the stack down. Export whatever the entrypoint must call, nothing more.

- [ ] **Step 4: Run to verify pass**: `go test ./tunnel/ -count=1` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/share_spoke.go tunnel/share_spoke_test.go
git commit -m "feat(tun): share a spoke's LAN through the hub"
```

---

### Task 6: The hub publishes its netview

**Files:**
- Create: `wisper/tunnel/ctrlhub.go`, `wisper/tunnel/ctrlhub_test.go`
- Modify: `wisper/tunnel/p2p_host.go` (shape-first demux, Task 1's `ControlMagic`), `wisper/tunnel/tun.go` (own the RIB and the control listener), `wisper/tunnel/reg_listener.go` (claim config)

**Interfaces:**
- Consumes: Task 1's `netviewMessage`/`claimMessage`/`readMessage`/`writeMessage`; Task 2's `rib`; Task 3's `SetPrefixRoutes`.
- Produces:
  ```go
  // controlHub owns one RIB, one control listener per spoke, and the prefix
  // table it pushes into the p2p handler.
  type controlHub struct { /* ... */ }
  func newControlHub(hubID string, allow map[string][]netip.Prefix, hdl *p2pHandler, log logger.Logger) *controlHub

  // Register is called after a spoke's tun stream is accepted: it opens the
  // control stream for that peer key. A key that refuses is a spoke that
  // gets no control channel, which is not fatal.
  func (ch *controlHub) Register(peer string) error
  func (ch *controlHub) Unregister(peer string)

  // SetStaticRoutes injects hub-config routes at start, before any claim.
  func (ch *controlHub) SetStaticRoutes(specs []string) error
  ```

- [ ] **Step 1: Write the failing test**

```go
func TestControlHubRoundTripAndPublish(t *testing.T) {
	h := newFakeP2PHandler() // the smallest stand-in for *p2pHandler
	ch := newControlHub("hub1", map[string][]netip.Prefix{"peerB": {netip.MustParsePrefix("192.168.0.0/16")}}, h, logger())

	if err := ch.Register("peerB"); err != nil {
		t.Fatal(err)
	}
	defer ch.Unregister("peerB")

	// A claim over the control stream: magic, then the framed message.
	conn, ctrl := ch.dialControlForTest("peerB")
	go func() {
		_, _ = ctrl.Write(append(append([]byte(nil), ControlMagic...), framed(claimMessage{V: 1, Add: []string{"192.168.50.0/24"}})...
	) }()

	// Wait for the RIB to settle, then assert the hub pushed it out and
	// installed it as a prefix route.
	...
}

func TestControlHubIgnoresOversizeAndUnknownType(t *testing.T) {
	// A frame whose header says 1 MiB is refused by readMessage, and the hub
	// must keep the stream and the peer usable: the next valid claim still lands.
	...
}
```

- [ ] **Step 2: Run to verify failure**: `go test ./tunnel/ -run 'TestControlHub' -count=1` → FAIL, `newControlHub` undefined.

- [ ] **Step 3: Implement**

`controlHub` runs one goroutine per registered peer: it reads `claimMessage`s from that stream, hands add/drop to the RIB, and — whenever `Snapshot()` has a new `Rev` — writes one `netviewMessage` to *every* registered stream and calls `SetPrefixRoutes` on the handler with the RIB's winners as prefixes. Writes to one slow stream never block the others: give each stream a write deadline and, on timeout, close that stream only (the spoke reconnects and re-sends its claim).

The p2p host demux, in `dispatch`'s order: (1) `conn` is a `net.PacketConn` → tun route, no read at all; (2) no control claim on the key → tun route; (3) otherwise read up to `len(ControlMagic)` bytes under a short deadline, route the conn to the control listener only on an exact match (magic consumed, not replayed), else wrap in the prefix-replay conn and send it to the tun listener.

`Register` is called from `tun.go`'s accept path, after the peer's tun route exists. Config: `lan_allow` and `lan_routes` come from the hub's service config, replacing today's hub-only `share_lan` (`api/tunnel_handler.go:133`).

- [ ] **Step 4: Run to verify pass**: `go test ./tunnel/ -count=1` → PASS. Also the x side: `cd /root/code/go-gost/x && GOWORK=off CGO_ENABLED=1 go test ./handler/tun/ -count=1` → PASS except the known pre-existing race.

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/ctrlhub.go tunnel/ctrlhub_test.go tunnel/p2p_host.go tunnel/tun.go tunnel/reg_listener.go
git commit -m "feat(tun): publish hub-approved LAN routes to spokes"
```

---

### Task 7: Withdrawal, observability, and the end-to-end gate

**Files:**
- Modify: `wisper/tunnel/tun.go` (claim TTL and withdraw), `wisper/tunnel/reg_listener.go` (doctor/LAN columns), `gost/tests/e2e/e2e_test.go` (the three-scenario gate)
- Test: `gost/tests/e2e/e2e_test.go`

**Interfaces:**
- Consumes: Task 6's `controlHub`; Task 3's `lookupPrefix`.
- Produces:
  ```go
  // LanDenied, LanRouted, LanWithdrawn — three counters on the existing
  // device-probe stats struct in x/handler/tun, named for what they count,
  // not how they are gathered.
  ```

- [ ] **Step 1: Write the failing test** (unit first: the withdraw timer)

```go
func TestRIBWithdrawsAStaleClaim(t *testing.T) {
	// A claim is live only while its owner re-sends it. Feed the RIB a claim,
	// advance past the TTL without a re-claim, and expect it gone from the
	// snapshot with a withdraw event — not a blackhole.
	...
}
```

- [ ] **Step 2: Run to verify failure**: `go test ./tunnel/ -run 'TestRIBWithdraws' -count=1` → FAIL, no TTL support.

- [ ] **Step 3: Implement**

A claim carries the time of its last re-claim. The hub ticks every 15s and drops claims older than 45s, advancing the rev so spokes see the withdrawal in the same `netview` that carried them. The claim message a spoke sends on reconnect is therefore a *refresh*, and the interval between refreshes is longer than the TCP retransmit ceiling but shorter than the TTL — 20s refresh, 45s TTL.

Doctor: `peers` gains a LAN column (claimed CIDRs per peer) and `routes` lists installed prefix routes with origin and allow. Counters surface in the existing stats output and in the API.

- [ ] **Step 4: The e2e gate** (three scenarios, the existing harness + Docker images)

```go
// 1. A reaches B's LAN, and an unclaimed subnet still behaves as today.
//    hub masquerades; A pings 192.168.50.7 (B's LAN host) → success.
//    A pings 192.168.50.7 when B claims nothing → no route, same as today.
// 2. B stops claiming (control stream killed) → 192.168.50.7 becomes
//    unreachable within the TTL, and A's packets are not silently dropped
//    mid-flight: a device read still completes, it just has no route.
// 3. Overlapping claims: B claims /24, C claims the same /24, hub keeps B,
//    and C's traffic still reaches its own LAN through B — the visible
//    behaviour is a single route, not a flap.
```

Run: `cd /root/code/go-gost/gost/tests/e2e && go test -v -run 'TestLAN' ./...`
Expected: all three PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/wisper
git add tunnel/tun.go tunnel/reg_listener.go
git commit -m "test(tun): LAN routing end-to-end with withdrawal and conflicts"
```
The e2e file lives in the `gost` repo (a separate git checkout from `wisper`), so commit it there with its own message.

## Self-Review

**Spec coverage:** §3 decision record → Tasks 1–6 (one task per decision group). §4 messages/RIB → Tasks 1, 2. §5 approval and conflict → Task 2. §7 the x change → Task 3. §8 sharer → Task 5. §9 multi-hub reserve → Task 1's `Hub` field plus Task 4's new-hub rule; the path-vector `path` field stays absent, as the spec reserves. §10 failure semantics → Task 7. §11 observability → Task 7. §12 gates → each task's own run command plus Task 7's e2e.

**Gaps found and fixed while writing:** the x `prefixRoute.Allow` check needed a packet-time decision, which is why `lookupPrefix` takes `from`; the refresh/TTL pair is stated because "withdraw" alone left a claim live forever; `Controller`/`ControlChannelConfig.Provider` is `any` deliberately — the entrypoint's provider type is internal, and the chain builder only needs to stamp it into metadata.

**Type consistency:** `claimEntry`, `memberEntry`, `netviewMessage`, `claimMessage` are defined once in Task 1. `claimSet` in Task 2 carries them. `prefixRoute` is x-local. `ControlMagic` is one var, used by Tasks 4, 5 and 6. Counters named once in Task 7.

**Proportion:** 7 tasks, each ending in a test run and a commit; code blocks are tests and signatures only, except the dispatch ordering in Task 6, which is an algorithm the tests do not determine.
