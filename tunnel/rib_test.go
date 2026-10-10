package tunnel

import (
	"fmt"
	"net/netip"
	"strings"
	"testing"
	"time"
)

func TestRIBApprovalGatesDynamicClaims(t *testing.T) {
	var events []string
	r := newRIB("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
	}, func(format string, args ...any) { events = append(events, fmt.Sprintf(format, args...)) }, nil, time.Now)

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
	r := newRIB("hub1", map[string][]netip.Prefix{"peerB": {netip.MustParsePrefix("192.168.0.0/16")}}, func(string, ...any) {}, nil, time.Now)
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
	}, func(format string, args ...any) { events = append(events, fmt.Sprintf(format, args...)) }, nil, time.Now)

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
	r := newRIB("hub1", map[string][]netip.Prefix{"peerB": {netip.MustParsePrefix("192.168.0.0/16")}}, func(string, ...any) {}, nil, time.Now)
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
	}, func(format string, args ...any) { events = append(events, fmt.Sprintf(format, args...)) }, nil, time.Now)
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
	}, func(string, ...any) {}, nil, time.Now)
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
	r := newRIB("hub1", map[string][]netip.Prefix{"peerB": {netip.MustParsePrefix("192.168.0.0/16")}}, func(string, ...any) {}, nil, time.Now)
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

// TestRIBWithdrawsAStaleClaim: a claim is live only while its owner re-sends
// it. A spoke whose control stream died kept its LAN routed forever, which is
// the one failure a hub cannot recover from on its own — so the claim carries
// the time of its last re-claim, and a sweep past the TTL drops it, advancing
// the rev so every spoke sees the withdrawal in a netview. The static route a
// hub's own config asked for is not a claim and never expires.
func TestRIBWithdrawsAStaleClaim(t *testing.T) {
	var events []string
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	r := newRIB("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
	}, func(format string, args ...any) { events = append(events, fmt.Sprintf(format, args...)) }, nil, func() time.Time { return now })

	r.SetMembers([]memberEntry{{IP: "10.10.100.5", Key: "peerB"}})
	if got := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil); len(got) != 1 {
		t.Fatalf("setup claim refused: %v", got)
	}
	if err := r.AddStatic("192.168.60.0/24 via 10.10.100.5"); err != nil {
		t.Fatal(err)
	}
	before := r.Snapshot()

	// Half the TTL by: a spoke that is refreshing on time is untouched, and
	// nothing publishes.
	now = now.Add(claimTTL / 2)
	if withdrawn := r.Withdraw(claimTTL); len(withdrawn) != 0 {
		t.Fatalf("a claim half the TTL old was withdrawn: %v", withdrawn)
	}
	if r.Snapshot().Rev != before.Rev {
		t.Fatal("a sweep that withdrew nothing advanced the rev")
	}

	// Past the TTL with no re-claim: the dynamic claim goes, with an event
	// that names the prefix so an operator can see what the hub did, and the
	// rev advances so spokes see it.
	now = now.Add(claimTTL)
	withdrawn := r.Withdraw(claimTTL)
	if len(withdrawn) != 1 || withdrawn[0] != netip.MustParsePrefix("192.168.50.0/24") {
		t.Fatalf("withdrawn = %v, want the stale claim's prefix", withdrawn)
	}
	after := r.Snapshot()
	if after.Rev <= before.Rev {
		t.Fatal("a withdrawal must advance the rev")
	}
	for _, claim := range after.Claims {
		if claim.Origin == "peerB" && claim.Prefix == "192.168.50.0/24" {
			t.Fatalf("the stale claim is still published: %v", after.Claims)
		}
	}
	// The hub's own route stays: it is configuration, not a claim.
	routes := r.Routes()
	if _, ok := routes[netip.MustParsePrefix("192.168.60.0/24")]; !ok {
		t.Fatal("a static route was withdrawn")
	}
	if len(events) == 0 || !strings.Contains(events[0], "192.168.50.0/24") {
		t.Fatalf("a withdrawal must be reported: %v", events)
	}

	// A refresh is a new claim: the surviving spoke is not next to be dropped
	// for having sat quiet while a neighbour's stream died.
	now = now.Add(claimTTL / 2)
	r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.77.0/24")}, nil)
	now = now.Add(claimTTL / 2)
	if withdrawn := r.Withdraw(claimTTL); len(withdrawn) != 0 {
		t.Fatalf("a refreshed claim was withdrawn: %v", withdrawn)
	}
	if _, ok := r.Routes()[netip.MustParsePrefix("192.168.77.0/24")]; !ok {
		t.Fatal("the refreshed claim is not routed")
	}
}

// TestRIBRefusalCodes: a refusal is a decision, and a decision an operator can
// act on has to say which of the six reasons it was. The codes are the closed
// set the hub's journal and the API publish — a seventh spelling of "no" would
// be a refusal nothing downstream could classify — and each carries the human
// sentence it has always carried, so the log line and the journal entry are one
// fact in two shapes rather than two facts that can drift apart.
//
// The order below is the order ApplyClaim checks in, which is also the order an
// operator fixes them in: not permitted to claim at all, then permitted but not
// of anything this network is made of, then permitted and taken.
func TestRIBRefusalCodes(t *testing.T) {
	type refusal struct {
		origin string
		prefix netip.Prefix
		code   string
		detail string
	}
	var got []refusal
	var lines []string
	r := newRIB("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("10.0.0.0/8")},
		"peerC": {netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("10.0.0.0/8")},
		// A row that exists and names nothing: this spoke is configured, and
		// configured to claim nothing — a different failure from "rogue", which
		// has no row at all.
		"peerD": {},
	}, func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) },
		func(origin string, prefix netip.Prefix, code, detail string) {
			got = append(got, refusal{origin: origin, prefix: prefix, code: code, detail: detail})
		},
		time.Now)

	r.SetMembers([]memberEntry{{IP: "10.10.100.9", Key: "peerA"}})
	if err := r.AddStatic("10.20.0.0/16 via 10.10.100.9"); err != nil {
		t.Fatal(err)
	}
	// The claim the last refusal is measured against: a taken prefix is one a
	// peer already holds.
	if accepted := r.ApplyClaim("peerB", []netip.Prefix{netip.MustParsePrefix("192.168.50.0/24")}, nil); len(accepted) != 1 {
		t.Fatal("setup claim refused")
	}

	// The expected codes are spelled here as literals, not as the rib package's
	// constants: from the next commit on these strings leave the process — the
	// journal, the API, the UI — so a renamed constant must break this test,
	// not silently move the contract with it.
	cases := []struct {
		origin string
		prefix netip.Prefix
		code   string
	}{
		{"rogue", netip.MustParsePrefix("10.0.0.0/8"), "no-allow-row"},
		{"peerD", netip.MustParsePrefix("10.0.0.0/8"), "empty-allow"},
		{"peerB", netip.MustParsePrefix("0.0.0.0/0"), "outside-allow"},
		{"peerB", netip.MustParsePrefix("10.10.100.0/24"), "covers-member"},
		{"peerC", netip.MustParsePrefix("10.20.0.0/16"), "hub-own-route"},
		{"peerC", netip.MustParsePrefix("192.168.50.0/24"), "taken-by-peer"},
	}
	for _, c := range cases {
		if accepted := r.ApplyClaim(c.origin, []netip.Prefix{c.prefix}, nil); len(accepted) != 0 {
			t.Fatalf("%s claiming %s must be refused with %s: %v", c.origin, c.prefix, c.code, accepted)
		}
	}

	if len(got) != len(cases) {
		t.Fatalf("the hook saw %d refusals, want %d: %+v", len(got), len(cases), got)
	}
	if len(lines) != len(got) {
		t.Fatalf("the log saw %d lines for %d refusals: %v", len(lines), len(got), lines)
	}
	for i, c := range cases {
		if got[i].origin != c.origin || got[i].prefix != c.prefix || got[i].code != c.code {
			t.Fatalf("refusal %d = %+v, want %s of %s as %s", i, got[i], c.origin, c.prefix, c.code)
		}
		if got[i].detail == "" {
			t.Fatalf("%s carries no explanation for the operator", c.code)
		}
		// One sentence, two sinks: the journal's detail and the log line's are
		// the same one, or the operator reading both is reading two accounts of
		// one decision that can drift apart.
		if !strings.Contains(lines[i], got[i].detail) {
			t.Fatalf("refusal %d logs %q without its detail %q", i, lines[i], got[i].detail)
		}
	}
}
