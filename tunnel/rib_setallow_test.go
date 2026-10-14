package tunnel

import (
	"net/netip"
	"testing"
	"time"
)

// TestRIBAllowRoundTrip is the live door's test, and the rest of rib_test.go is
// the build-time one. newRIB's allow argument is read once, when the hub comes
// up; SetAllow is what an operator changes while it runs, from the peers page.
// The two have to agree — the masking, the default-deny, the refusal codes, and
// the fact that a tightened row actually withdraws the route it used to approve.
func TestRIBAllowRoundTrip(t *testing.T) {
	t.Parallel()

	rib := newRIB("hub", nil, nil, nil, time.Now)

	// A claim against a rib with no row is refused as no-allow-row: default
	// deny, and the field case. Nothing is wrong with the spoke that sent it.
	code, _, approved := rib.approvalRefusal("pixel", netip.MustParsePrefix("192.168.1.0/24"))
	if approved || code != refusalNoAllowRow {
		t.Fatalf("no-row claim = (%q, approved=%v), want %q and a refusal", code, approved, refusalNoAllowRow)
	}

	// The row is masked on the way in: the spoke's config names
	// "192.168.1.7/24", and the network that LAN is actually means
	// "192.168.1.0/24". Held unmasked the row would approve a claim of the
	// literal /24 (the base address is not inside a /24 whose host bits are
	// set) and refuse the one it stands for.
	rib.SetAllow(map[string][]netip.Prefix{
		"pixel": {netip.MustParsePrefix("192.168.1.7/24")},
	})
	if _, _, approved := rib.approvalRefusal("pixel", netip.MustParsePrefix("192.168.1.0/24")); !approved {
		t.Fatalf("claim inside a masked-away row was refused")
	}
	// The claim itself installs, which is the point of allowing it. ApplyClaim
	// answers with the prefixes it accepted, so one is one and empty is a
	// refusal that said nothing.
	claim := netip.MustParsePrefix("192.168.1.0/24")
	if got := rib.ApplyClaim("pixel", []netip.Prefix{claim}, nil); len(got) != 1 {
		t.Fatalf("claim under an allowed row was refused: %v", got)
	}
	if _, ok := rib.claims[claim]; !ok {
		t.Fatalf("claim %v is not in the table", claim)
	}

	// Another spoke is still default-deny: one row did not name them all.
	code, _, approved = rib.approvalRefusal("spoke", netip.MustParsePrefix("192.168.1.0/24"))
	if approved || code != refusalNoAllowRow {
		t.Fatalf("an unnamed spoke's claim = (%q, approved=%v), want %q and a refusal", code, approved, refusalNoAllowRow)
	}

	// An empty row is "may claim nothing", which is a different answer from
	// "not configured here" and has to keep the key to say it.
	rib.SetAllow(map[string][]netip.Prefix{"pixel": {}})
	code, _, approved = rib.approvalRefusal("pixel", netip.MustParsePrefix("192.168.1.0/24"))
	if approved || code != refusalEmptyAllow {
		t.Fatalf("emptied row's claim = (%q, approved=%v), want %q and a refusal", code, approved, refusalEmptyAllow)
	}

	// Replacing the row replaces it: the two /24s above were not additive.
	rib.SetAllow(map[string][]netip.Prefix{
		"pixel": {netip.MustParsePrefix("172.16.0.0/12")},
	})
	code, _, approved = rib.approvalRefusal("pixel", netip.MustParsePrefix("192.168.1.0/24"))
	if approved || code != refusalOutsideAllow {
		t.Fatalf("claim outside the replaced row = (%q, approved=%v), want %q and a refusal", code, approved, refusalOutsideAllow)
	}
	if _, _, approved := rib.approvalRefusal("pixel", netip.MustParsePrefix("172.16.0.0/12")); !approved {
		t.Fatalf("claim inside the replaced row was refused")
	}

	// And the route the old row approved left the table: a tightened policy is a
	// save, not a preference. Without this the route would stay in force while
	// the hub refused every assertion that held it.
	if _, ok := rib.claims[claim]; ok {
		t.Fatalf("claim %v is still in the table after the row that approved it was replaced", claim)
	}
}
