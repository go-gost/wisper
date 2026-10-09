package tunnel

import (
	"fmt"
	"net/netip"
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
