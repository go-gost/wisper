package tunnel

import (
	"fmt"
	"net/netip"
	"strings"
	"testing"
)

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

// The two rules the plan's Review Focus #2 turns on, and which nothing later in
// this plan tests: a claim that would swallow a member's own address, and a
// drop that is not the owner's. Both were verified while building the RIB and
// both are this task's own behaviour, so they are pinned here.

func TestRIBRefusesAClaimOverAMemberTunAddress(t *testing.T) {
	var events []string
	r := newRIB("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("192.168.0.0/16")},
	}, func(format string, args ...any) { events = append(events, fmt.Sprintf(format, args...)) })
	r.SetMembers([]memberEntry{{IP: "10.10.100.5", Key: "peerA"}})

	// The member's address exactly: the hub's own route to a spoke is the one
	// route a claim may not displace.
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("10.10.100.5/32")}, nil); len(got) != 0 {
		t.Fatalf("a claim of a member's own address must be refused: %v", got)
	}
	// And the subnet around it: the table is consulted first for any destination
	// a prefix covers, so this would take peerA's own traffic — including the
	// traffic that claims the LAN in the first place — and blackhole it.
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("10.10.100.0/24")}, nil); len(got) != 0 {
		t.Fatalf("a claim containing a member's own address must be refused: %v", got)
	}
	if len(r.Snapshot().Claims) != 0 {
		t.Fatalf("a refused claim reached the snapshot: %+v", r.Snapshot().Claims)
	}
	// One line per refusal, naming the address and the member it is: this is the
	// only account of the refusal anyone gets.
	if len(events) != 2 {
		t.Fatalf("want one event per refusal, got %d: %v", len(events), events)
	}
	if !strings.Contains(events[0], "10.10.100.5") || !strings.Contains(events[0], "peerA") {
		t.Fatalf("the event must name the address and its member: %q", events[0])
	}
	// The refusal is about the member's address, not about the supernet: a claim
	// the same peer may make, elsewhere in the same allowed range, still lands.
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil); len(got) != 1 {
		t.Fatalf("an approved claim elsewhere must be accepted: %v", got)
	}
}

func TestRIBDropTakesOnlyItsOwnClaim(t *testing.T) {
	r := newRIB("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
		"peerC": {netip.MustParsePrefix("192.168.0.0/16")},
	}, func(string, ...any) {})
	r.SetMembers([]memberEntry{{IP: "10.10.100.9", Key: "peerB"}})
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil); len(got) != 1 {
		t.Fatal("setup claim refused")
	}
	if got := r.ApplyClaim("peerC", []netip.Prefix{netip.MustParsePrefix("192.168.60.0/24")}, nil); len(got) != 1 {
		t.Fatal("setup claim refused")
	}
	if err := r.AddStatic("10.20.0.0/16 via 10.10.100.9"); err != nil {
		t.Fatal(err)
	}

	// A peer dropping a prefix that is not its own claim takes nothing, and
	// moves nothing — it is not holding that route to give up.
	before := r.Snapshot().Rev
	r.ApplyClaim("peerC", nil, []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")})
	if r.Snapshot().Rev != before {
		t.Fatal("a drop that matches nothing must not advance the rev")
	}
	if len(r.Snapshot().Claims) != 3 {
		t.Fatalf("a drop removed another origin's claim: %+v", r.Snapshot().Claims)
	}

	// Its own drop does remove it, and that is a change spokes must be told
	// about — a withdrawn LAN has to become unreachable, not silently linger.
	r.ApplyClaim("peerC", nil, []netip.Prefix{netip.MustParsePrefix("192.168.60.0/24")})
	if r.Snapshot().Rev <= before {
		t.Fatal("an accepted drop must advance the rev")
	}
	claims := r.Snapshot().Claims
	if len(claims) != 2 || claims[0].Prefix != "192.168.50.0/24" || claims[0].Origin != "peerB" {
		t.Fatalf("the drop took the wrong claim: %+v", claims)
	}

	// And no spoke can withdraw the hub's own route: a drop is a peer speaking
	// for itself, and the operator's route is not the peer's to drop.
	r.ApplyClaim("peerB", nil, []netip.Prefix{netip.MustParsePrefix("10.20.0.0/16")})
	if len(r.Snapshot().Claims) != 2 {
		t.Fatalf("a spoke dropped a static route: %+v", r.Snapshot().Claims)
	}
}

func TestRIBRoutesCarryThePeerThatReachesThem(t *testing.T) {
	r := newRIB("hub1", map[string][]netip.Prefix{"peerB": {netip.MustParsePrefix("192.168.0.0/16")}}, func(string, ...any) {})
	r.SetMembers([]memberEntry{{IP: "10.10.100.9", Key: "peerB"}, {IP: "10.10.100.10", Key: "peerC"}})
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil); len(got) != 1 {
		t.Fatal("setup claim refused")
	}
	if err := r.AddStatic("192.168.60.0/24 via 10.10.100.10 allow=peerB"); err != nil {
		t.Fatal(err)
	}

	routes := r.Routes()
	// A dynamic claim is carried by the peer that holds the LAN.
	if got := routes[netip.MustParsePrefix("192.168.50.0/24")]; got.Peer != "peerB" {
		t.Fatalf("a dynamic route must name its claiming peer: %+v", got)
	}
	// An injected one is carried by whoever its via resolved to — the snapshot
	// says "static" for it, and the hub cannot route a prefix to the string.
	static := routes[netip.MustParsePrefix("192.168.60.0/24")]
	if static.Peer != "peerC" {
		t.Fatalf("a static route must name its via's member, not %q: %+v", static.Peer, static)
	}
	if len(static.Allow) != 1 || static.Allow[0] != "peerB" {
		t.Fatalf("the allow list did not carry: %+v", static)
	}
	// Winners only: what the RIB refused is not routable.
	if len(routes) != 2 {
		t.Fatalf("routes carries non-winners: %+v", routes)
	}
	// The caller owns what it got.
	routes[netip.MustParsePrefix("192.168.50.0/24")] = PrefixRoute{Peer: "hacked"}
	if r.Routes()[netip.MustParsePrefix("192.168.50.0/24")].Peer != "peerB" {
		t.Fatal("routes aliases the RIB's own state")
	}
}
