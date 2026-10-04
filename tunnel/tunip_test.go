package tunnel

import (
	"net/netip"
	"strings"
	"testing"
)

// TestParseHubNets: the hub's "net" field is a list of CIDRs, each naming the
// hub's own address inside its subnet ("10.10.0.1/24,fd00::1/64"). Both halves
// come back — the subnet to allocate from, and the address the hub itself holds.
// A junk entry is skipped, not refused: net is user-typed and the listener that
// has to tolerate it is not this code.
func TestParseHubNets(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/24,fd00::1/64")

	if got := prefixesString(prefixes); got != "10.10.0.0/24 fd00::/64" {
		t.Errorf("prefixes = %q, want %q", got, "10.10.0.0/24 fd00::/64")
	}
	if got := addrsString(self); got != "10.10.0.1 fd00::1" {
		t.Errorf("self = %q, want %q", got, "10.10.0.1 fd00::1")
	}

	prefixes, self = parseHubNets("10.10.0.1/24, not-a-cidr ,,10.0.0.1/8")
	if got := prefixesString(prefixes); got != "10.10.0.0/24 10.0.0.0/8" {
		t.Errorf("prefixes with junk entries = %q, want the two that parse", got)
	}
	if got := addrsString(self); got != "10.10.0.1 10.0.0.1" {
		t.Errorf("self with junk entries = %q, want the two that parse", got)
	}

	if prefixes, self = parseHubNets(""); len(prefixes) != 0 || len(self) != 0 {
		t.Errorf("parseHubNets(\"\") = (%q, %q), want nothing", prefixesString(prefixes), addrsString(self))
	}
}

// TestParseHubNetsKeepsTheHubOwnAddress: why parseHubNets returns two slices
// rather than one. net.ParseCIDR("10.10.0.1/24") hands back the prefix
// 10.10.0.0/24 and throws 10.10.0.1 away, so a caller holding only the prefix
// cannot tell which address in it is the hub's own — and would give it to the
// first spoke. The hub's self-loop guard then refuses that spoke at
// registration, with a message that points nowhere near the cause.
func TestParseHubNetsKeepsTheHubOwnAddress(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/24")

	if len(prefixes) != 1 || prefixes[0].String() != "10.10.0.0/24" {
		t.Fatalf("prefixes = %q, want the masked network 10.10.0.0/24", prefixesString(prefixes))
	}
	// The host part is the one thing the prefix cannot say.
	if got := prefixes[0].Addr().String(); got != "10.10.0.0" {
		t.Errorf("prefix address = %s, want 10.10.0.0 — the hub's own address is not in the prefix", got)
	}
	if len(self) != 1 || self[0].String() != "10.10.0.1" {
		t.Errorf("self = %q, want 10.10.0.1, the address ParseCIDR discards", addrsString(self))
	}
}

// TestParsePeerIPs: a row's value is a comma-separated list of bare host
// addresses, because the address a spoke registers is the host address alone. A
// prefix is not one, so it is refused — as is a hostname, and an empty element
// between commas. An empty row is empty of addresses, not malformed: it is the
// state that means "this peer may claim nothing", which allocation fills and
// validation does not widen.
func TestParsePeerIPs(t *testing.T) {
	addrs, ok := parsePeerIPs("10.10.0.2,fd00::2")
	if !ok {
		t.Fatal(`parsePeerIPs("10.10.0.2,fd00::2") reported the value as malformed`)
	}
	if got := addrsString(addrs); got != "10.10.0.2 fd00::2" {
		t.Errorf("addrs = %q, want %q", got, "10.10.0.2 fd00::2")
	}

	addrs, ok = parsePeerIPs(" 10.10.0.2 , fd00::2 ")
	if !ok || addrsString(addrs) != "10.10.0.2 fd00::2" {
		t.Errorf("parsePeerIPs with padding = (%q, %v), want the two addresses and ok", addrsString(addrs), ok)
	}

	for _, spec := range []string{
		"10.10.0.2/24",        // a prefix, not an address
		"10.10.0.2,fd00::/64", // one prefix among addresses
		"10.10.0.2,,fd00::2",  // an empty element between commas
		"host.example.com",    // a name
		"10.10.0.300",         // not an address
	} {
		if addrs, ok = parsePeerIPs(spec); ok {
			t.Errorf("parsePeerIPs(%q) = (%q, true), want ok=false", spec, addrsString(addrs))
		}
	}

	for _, spec := range []string{"", "   "} {
		if addrs, ok = parsePeerIPs(spec); !ok || len(addrs) != 0 {
			t.Errorf("parsePeerIPs(%q) = (%q, %v), want no addresses and ok=true", spec, addrsString(addrs), ok)
		}
	}
}

// TestValidatePeerIP: the error says which address is refused and why, because
// it is what the API hands an operator who typed one. A hub that has no subnet
// configured is a third reason, and the message says that rather than blaming the
// address. So is the hub's own address: the half of "net" that the prefix cannot
// carry is exactly what this needs, and refusing it here is what makes validation
// agree with allocation.
func TestValidatePeerIP(t *testing.T) {
	prefixes := mustPrefixes(t, "10.10.0.0/24", "fd00::/64")
	self := mustAddrs(t, "10.10.0.1", "fd00::1")

	if err := validatePeerIP("10.10.0.2", prefixes, self); err != nil {
		t.Errorf("validatePeerIP(10.10.0.2) = %v, want nil", err)
	}
	if err := validatePeerIP("fd00::2", prefixes, self); err != nil {
		t.Errorf("validatePeerIP(fd00::2) = %v, want nil", err)
	}
	// Both endpoints of a subnet are inside it; the network address is refused
	// only by assignment, not by this check.
	if err := validatePeerIP("10.10.0.255", prefixes, self); err != nil {
		t.Errorf("validatePeerIP(10.10.0.255) = %v, want nil", err)
	}
	// The hub's own addresses are refused, and the message says why rather than
	// blaming a subnet they are inside: 10.10.0.1 is in 10.10.0.0/24, so a walk
	// over the prefixes would wave it through and say nothing.
	for _, own := range []string{"10.10.0.1", "fd00::1"} {
		err := validatePeerIP(own, prefixes, self)
		if err == nil {
			t.Errorf("validatePeerIP(%s) = nil, want the hub's own address refused", own)
			continue
		}
		if !strings.Contains(err.Error(), "the hub's own address") || !strings.Contains(err.Error(), own) {
			t.Errorf("validatePeerIP(%s) = %q, want it named as the hub's own address", own, err)
		}
	}
	// The same address written in the form that arrives off the wire is the same
	// address: unmapped here, or the hub would refuse its own address as though it
	// were outside every subnet.
	if err := validatePeerIP("::ffff:10.10.0.1", prefixes, self); err == nil ||
		!strings.Contains(err.Error(), "the hub's own address") {
		t.Errorf("validatePeerIP(::ffff:10.10.0.1) = %v, want the hub's own address refused", err)
	}
	// 10.10.0.1 is nobody's own address on a hub that does not say it holds one, so
	// the same value passes: the rule is about the hub's own address, not about a
	// shape an address happens to have.
	if err := validatePeerIP("10.10.0.1", prefixes, nil); err != nil {
		t.Errorf("validatePeerIP(10.10.0.1) on a hub not holding it = %v, want nil", err)
	}

	err := validatePeerIP("192.168.9.9", prefixes, self)
	if err == nil {
		t.Fatal("validatePeerIP(192.168.9.9) = nil, want an error: it is in none of the hub's subnets")
	}
	for _, want := range []string{"192.168.9.9", "10.10.0.0/24", "fd00::/64"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not name %q", err, want)
		}
	}

	if err = validatePeerIP("10.10.0.2/24", prefixes, self); err == nil ||
		!strings.Contains(err.Error(), "not an IP address") {
		t.Errorf("validatePeerIP(10.10.0.2/24) = %v, want a not-an-address error", err)
	}

	if err = validatePeerIP("10.10.0.2", nil, nil); err == nil ||
		!strings.Contains(err.Error(), "no subnet") {
		t.Errorf("validatePeerIP with no hub subnet = %v, want an error saying the hub has none", err)
	}
	// The hub's own address is refused even on a hub with no subnet, because the
	// address is the hub's whatever else is true of the hub — and this check is the
	// one the hub's own filter skips on such a hub, so the two must not be confused.
	if err = validatePeerIP("10.10.0.1", nil, self); err == nil ||
		!strings.Contains(err.Error(), "the hub's own address") {
		t.Errorf("validatePeerIP of the hub's own address with no subnet = %v, want it refused as the hub's own", err)
	}
}

// TestAssignPeerIPsSkipsTheHubsOwnAddress: the first spoke must not be given the
// hub's own address. That is what the self half of parseHubNets is for — the
// prefix 10.10.0.0/24 cannot say which address inside it the hub holds, and
// 10.10.0.1 is the one every hub takes.
//
// The validator agrees with it, which is what makes the two halves worth having:
// everything allocation hands out is something validation accepts, and the one value
// allocation refuses to produce is one validation refuses to accept. Without that, an
// operator could type the hub's own address for a spoke, be told it was fine, and
// watch the spoke be turned away at registration.
func TestAssignPeerIPsSkipsTheHubsOwnAddress(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/24")

	got, err := assignPeerIPs([]string{"a"}, nil, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs = %v, want one address for one row", err)
	}
	if got["a"] != "10.10.0.2" {
		t.Errorf("a = %q, want 10.10.0.2 — .0 is the network address and .1 is the hub's own", got["a"])
	}
	if err := validatePeerIP(got["a"], prefixes, self); err != nil {
		t.Errorf("validatePeerIP refused what assignPeerIPs produced (%q): %v", got["a"], err)
	}
	if err := validatePeerIP(self[0].String(), prefixes, self); err == nil {
		t.Errorf("validatePeerIP accepted %q, which assignPeerIPs would never hand out", self[0])
	}
}

// TestAssignPeerIPsNeverOverwritesATypedRow (Review Focus #5): a row that names
// an address keeps it, byte for byte — an operator who typed one must not have it
// silently rewritten by an allocation that ran beside it. The address is still
// counted as taken, and the caller's map is not written into.
func TestAssignPeerIPsNeverOverwritesATypedRow(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/24")
	assigned := map[string]string{"a": "10.10.0.9"}

	got, err := assignPeerIPs([]string{"a", "b"}, assigned, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs = %v, want b filled beside a", err)
	}
	if got["a"] != "10.10.0.9" {
		t.Errorf("a = %q, want the typed 10.10.0.9 unchanged", got["a"])
	}
	if got["b"] != "10.10.0.2" {
		t.Errorf("b = %q, want 10.10.0.2 — the lowest address nothing else holds", got["b"])
	}
	if len(got) != 2 {
		t.Errorf("result = %v, want exactly the two rows", got)
	}
	// The caller's map is the caller's: allocation returns a copy.
	if len(assigned) != 1 || assigned["a"] != "10.10.0.9" {
		t.Errorf("assigned = %v, want it untouched (%q was never added)", assigned, "b")
	}
}

// TestAssignPeerIPsFollowsTheAllowlistOrder: allocation walks the allowlist, not
// the map, so the same hub always hands out the same addresses and they match the
// order the rows are displayed in. Go randomizes map iteration, so a
// map-driven allocator would flip these two between runs.
func TestAssignPeerIPsFollowsTheAllowlistOrder(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/24")

	got, err := assignPeerIPs([]string{"b", "a"}, nil, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs = %v, want two addresses", err)
	}
	if got["b"] != "10.10.0.2" || got["a"] != "10.10.0.3" {
		t.Errorf("assignPeerIPs([b a]) = %v, want b=10.10.0.2 and a=10.10.0.3", got)
	}

	reversed, err := assignPeerIPs([]string{"a", "b"}, nil, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs = %v, want two addresses", err)
	}
	if reversed["a"] != "10.10.0.2" || reversed["b"] != "10.10.0.3" {
		t.Errorf("assignPeerIPs([a b]) = %v, want a=10.10.0.2 and b=10.10.0.3", reversed)
	}
}

// TestAssignPeerIPsAcceptsMultipleTypedAddressesInOneRow: a row may name several
// addresses — a device with more than one, or a peer that claimed a range. Both
// are the operator's to give, both are counted as taken, and neither is
// rewritten.
func TestAssignPeerIPsAcceptsMultipleTypedAddressesInOneRow(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/24,fd00::1/64")
	assigned := map[string]string{"a": "10.10.0.2,10.10.0.3"}

	got, err := assignPeerIPs([]string{"a", "b"}, assigned, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs = %v, want b filled beside a", err)
	}
	if got["a"] != "10.10.0.2,10.10.0.3" {
		t.Errorf("a = %q, want the typed pair unchanged", got["a"])
	}
	// .0 is the network, .1 the hub, .2 and .3 the typed row: .4 is next.
	if got["b"] != "10.10.0.4" {
		t.Errorf("b = %q, want 10.10.0.4 — both of a's addresses must count as taken", got["b"])
	}
}

// TestAssignPeerIPsRefusesAnExhaustedSubnet (Review Focus #3): a /30 has four
// addresses, one of which is the hub's own. Four rows cannot be served, and the
// allocator must say so rather than hand out the network address, wrap around, or
// give two rows the same address.
func TestAssignPeerIPsRefusesAnExhaustedSubnet(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/30")
	order := []string{"a", "b", "c", "d"}

	got, err := assignPeerIPs(order, nil, prefixes, self)
	if err == nil {
		t.Fatalf("assignPeerIPs over a /30 with %d rows = %v, want an error", len(order), got)
	}
	if !strings.Contains(err.Error(), "10.10.0.0/30") {
		t.Errorf("error %q does not name the exhausted subnet 10.10.0.0/30", err)
	}

	seen := map[string]string{}
	for name, ips := range got {
		if ips == "10.10.0.0" {
			t.Errorf("%s = %s, the network address is not a spoke's", name, ips)
		}
		if ips == "10.10.0.1" {
			t.Errorf("%s = %s, that is the hub's own address", name, ips)
		}
		if other, dup := seen[ips]; dup {
			t.Errorf("%s and %s both hold %s", other, name, ips)
		}
		seen[ips] = name
	}
	if len(seen) != 2 {
		t.Errorf("assigned %d rows in a /30 whose only free addresses are .2 and .3: %v", len(seen), got)
	}
	if seen["10.10.0.2"] == "" || seen["10.10.0.3"] == "" {
		t.Errorf("assigned = %v, want the two free addresses handed out before the refusal", got)
	}
}

// TestAssignPeerIPsRefusesAHubWithNoNet: with no subnet there is nothing to
// allocate from, and an empty row is an error rather than a silent empty value —
// the caller has to report it, and the message says which peer could not be
// served. Rows that already name an address need nothing from the hub, so a hub
// with no net at all still returns them untouched.
func TestAssignPeerIPsRefusesAHubWithNoNet(t *testing.T) {
	got, err := assignPeerIPs([]string{"a", "b"}, map[string]string{"a": "10.10.0.2"}, nil, nil)
	if err == nil {
		t.Fatalf("assignPeerIPs with no hub subnet = %v, want an error", got)
	}
	if !strings.Contains(err.Error(), "b") {
		t.Errorf("error %q does not name the peer that could not be served", err)
	}
	if got["a"] != "10.10.0.2" {
		t.Errorf("a = %q, want the typed 10.10.0.2", got["a"])
	}

	typed := map[string]string{"a": "10.10.0.2"}
	got, err = assignPeerIPs([]string{"a"}, typed, nil, nil)
	if err != nil {
		t.Errorf("assignPeerIPs with nothing to fill = %v, want nil: every row names an address", err)
	}
	if got["a"] != "10.10.0.2" || len(got) != 1 {
		t.Errorf("assignPeerIPs with nothing to fill = %v, want the one row unchanged", got)
	}
}

// TestAssignPeerIPsFallsThroughToTheSecondPrefix: a hub may name more than one
// subnet. The first that still has a free address wins, and the subnet that is
// full is passed over rather than mistaken for the end of the hub's range.
func TestAssignPeerIPsFallsThroughToTheSecondPrefix(t *testing.T) {
	// A /31 is the smallest subnet there is, so naming the hub one of its two
	// addresses fills it: the next spoke has to be served from the second subnet.
	prefixes := mustPrefixes(t, "10.10.0.0/31", "10.10.1.0/24")
	self := mustAddrs(t, "10.10.0.0")

	got, err := assignPeerIPs([]string{"a", "b"}, nil, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs = %v, want two addresses across two subnets", err)
	}
	if got["a"] != "10.10.0.1" {
		t.Errorf("a = %q, want the last address left in the first subnet", got["a"])
	}
	if got["b"] != "10.10.1.1" {
		t.Errorf("b = %q, want 10.10.1.1 from the second subnet", got["b"])
	}
}

// TestAssignPeerIPsReservesTheNetworkAndBroadcastAddresses: which addresses a
// subnet keeps for itself. Below /30 the last address is the broadcast and is not
// a spoke's; at /30 and tighter it is an ordinary host address. A /31 is a
// point-to-point link and a /32 a single host, so neither reserves a network
// address — which is also the one case where the masked address itself is
// handable.
func TestAssignPeerIPsReservesTheNetworkAndBroadcastAddresses(t *testing.T) {
	cases := []struct {
		name     string
		net      string
		order    []string
		want     map[string]string
		wantFail bool
	}{
		{
			// .0 network, .7 broadcast, .1 is the hub: five spokes fit.
			name:  "a /29 keeps its broadcast",
			net:   "10.10.0.1/29",
			order: []string{"a", "b", "c", "d", "e", "f"},
			want: map[string]string{
				"a": "10.10.0.2", "b": "10.10.0.3", "c": "10.10.0.4",
				"d": "10.10.0.5", "e": "10.10.0.6",
			},
			wantFail: true,
		},
		{
			// A /30 is where the broadcast convention stops: .3 is a host.
			name:  "a /30 hands out its last address",
			net:   "10.10.0.1/30",
			order: []string{"a", "b", "c"},
			want:  map[string]string{"a": "10.10.0.2", "b": "10.10.0.3"},
			// Three rows, two free addresses: the third must be refused rather
			// than served the network address or a duplicate.
			wantFail: true,
		},
		{
			// The masked address 10.10.0.0 is a host here, not a network, so it
			// is a spoke's to hold — the case a "skip the network address" rule
			// gets wrong.
			name:  "a /31 hands out its first address",
			net:   "10.10.0.1/31",
			order: []string{"a", "b"},
			want:  map[string]string{"a": "10.10.0.0"},
			// .1 is the hub's own, so the second row has nowhere to go.
			wantFail: true,
		},
		{
			// The one case a /32 can serve: the hub's own address is the /32's
			// only address, so it is taken and nothing is left. Stated here
			// because it is the case a "skip the network address" rule gets
			// wrong — there is no other address to fall back to.
			name:     "a /32 holds only the hub's own address",
			net:      "10.10.0.5/32",
			order:    []string{"a"},
			want:     map[string]string{},
			wantFail: true,
		},
	}

	for _, tc := range cases {
		prefixes, self := parseHubNets(tc.net)
		got, err := assignPeerIPs(tc.order, nil, prefixes, self)
		if len(got) != len(tc.want) {
			t.Errorf("%s: assigned %v, want %v", tc.name, got, tc.want)
			continue
		}
		if tc.wantFail && err == nil {
			t.Errorf("%s: more rows than free addresses and err = nil, want an error", tc.name)
		}
		if !tc.wantFail && err != nil {
			t.Errorf("%s: err = %v, want nil", tc.name, err)
		}
		for name, want := range tc.want {
			if got[name] != want {
				t.Errorf("%s: %s = %q, want %q", tc.name, name, got[name], want)
			}
		}
	}
}

// TestAssignPeerIPsIgnoresARowThatNamesNoAddress: a row whose value is not a
// list of addresses is left exactly as the operator typed it — allocation has no
// opinion about it, validatePeerIP is where it is reported — and it reserves
// nothing, because there is no address in it to reserve.
func TestAssignPeerIPsIgnoresARowThatNamesNoAddress(t *testing.T) {
	prefixes, self := parseHubNets("10.10.0.1/24")
	assigned := map[string]string{"a": "not-an-address"}

	got, err := assignPeerIPs([]string{"a", "b"}, assigned, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs = %v, want b filled", err)
	}
	if got["a"] != "not-an-address" {
		t.Errorf("a = %q, want the value untouched", got["a"])
	}
	if got["b"] != "10.10.0.2" {
		t.Errorf("b = %q, want 10.10.0.2", got["b"])
	}
}

func mustPrefixes(t *testing.T, specs ...string) []netip.Prefix {
	t.Helper()
	prefixes := make([]netip.Prefix, 0, len(specs))
	for _, spec := range specs {
		prefix, err := netip.ParsePrefix(spec)
		if err != nil {
			t.Fatalf("netip.ParsePrefix(%q) = %v", spec, err)
		}
		prefixes = append(prefixes, prefix)
	}
	return prefixes
}

func mustAddrs(t *testing.T, specs ...string) []netip.Addr {
	t.Helper()
	addrs := make([]netip.Addr, 0, len(specs))
	for _, spec := range specs {
		addr, err := netip.ParseAddr(spec)
		if err != nil {
			t.Fatalf("netip.ParseAddr(%q) = %v", spec, err)
		}
		addrs = append(addrs, addr)
	}
	return addrs
}

// addrsString and prefixesString render a slice as space-separated text, so a
// failure names what it got instead of two opaque slices.
func addrsString(addrs []netip.Addr) string {
	parts := make([]string, 0, len(addrs))
	for _, addr := range addrs {
		parts = append(parts, addr.String())
	}
	return strings.Join(parts, " ")
}

func prefixesString(prefixes []netip.Prefix) string {
	parts := make([]string, 0, len(prefixes))
	for _, prefix := range prefixes {
		parts = append(parts, prefix.String())
	}
	return strings.Join(parts, " ")
}
