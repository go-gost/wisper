package tunnel

import (
	"net/netip"
	"strings"
	"testing"

	"github.com/go-gost/wisper/event"
	xlogger "github.com/go-gost/x/logger"
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
// agree with allocation. And so are the addresses a subnet keeps back — its
// network address, and the broadcast address of an IPv4 subnet that has one.
func TestValidatePeerIP(t *testing.T) {
	prefixes := mustPrefixes(t, "10.10.0.0/24", "fd00::/64")
	self := mustAddrs(t, "10.10.0.1", "fd00::1")

	if err := validatePeerIP("10.10.0.2", prefixes, self); err != nil {
		t.Errorf("validatePeerIP(10.10.0.2) = %v, want nil", err)
	}
	if err := validatePeerIP("fd00::2", prefixes, self); err != nil {
		t.Errorf("validatePeerIP(fd00::2) = %v, want nil", err)
	}
	// The last address of a /24 is the broadcast, which allocation never hands out,
	// so validation refuses it — unlike the last address of a /30, which it does.
	if err := validatePeerIP("10.10.0.255", prefixes, self); err == nil ||
		!strings.Contains(err.Error(), "the broadcast address of 10.10.0.0/24") {
		t.Errorf("validatePeerIP(10.10.0.255) = %v, want the broadcast address refused", err)
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

// TestValidatePeerIPAgreesWithAllocation: the property the two halves of the
// policy rest on — for every address of a hub's subnet, validation accepts it if
// and only if allocation is able to produce it.
//
// It is written as a walk of freeAddrIn to exhaustion rather than as a second
// hand-written list of the addresses a /24 keeps back, because a list written out
// twice is a list that can agree with itself and disagree with the code. Every
// address the prefix contains is checked, so a subnet too large to enumerate
// (/64 and shorter) is checked on the addresses allocation walked to, and its
// held-back addresses — which between them are all a prefix can reserve.
//
// Nothing in a kernel objects to either of the addresses this refuses: against a
// real tun device, Linux accepts 10.253.98.0/24 and 10.253.98.255/24, gives both
// scope-host local routes and delivers to sockets bound on them. So the rule is
// the hub's, not a workaround, and it is checked here because the API would
// otherwise store an address the allocator will never produce.
func TestValidatePeerIPAgreesWithAllocation(t *testing.T) {
	// fd00::1/64 is in the list because it is the prefix where the two families'
	// rules part company, and the /64 is also the one prefix here too large to
	// enumerate — see walkAddresses.
	for _, netSpec := range []string{
		"10.10.0.1/24", "10.10.0.1/30", "10.10.0.1/29", "10.10.0.1/31", "10.10.0.5/32",
		"fd00::1/64", "fd00::1/126", "fd00::1/125", "fd00::1/127", "fd00::9/128",
	} {
		t.Run(netSpec, func(t *testing.T) {
			// self is left empty on purpose: the hub's own address would be refused
			// for a second and better reason, which is its own case above.
			prefixes, _ := parseHubNets(netSpec)
			prefix := prefixes[0]

			producible, walked := walkAddresses(prefix)

			// Every address allocation is able to produce must be accepted. This
			// direction is the one that matters: an address the hub would hand out
			// and validation refused is a save the API rejects and the hub honours.
			for _, addr := range walked {
				if err := validatePeerIP(addr.String(), prefixes, nil); err != nil {
					t.Errorf("validatePeerIP(%s) = %v, but freeAddrIn hands it out on %s: the two disagree about the same subnet",
						addr, err, prefix)
				}
			}

			// And nothing else may be, for any address of the subnet that the walk
			// did not reach. Only a prefix small enough to enumerate can be closed
			// this way, and that is what makes it exhaustive rather than sampled.
			for _, addr := range enumeratePrefix(prefix) {
				if _, ok := producible[addr]; ok {
					continue
				}
				if err := validatePeerIP(addr.String(), prefixes, nil); err == nil {
					t.Errorf("validatePeerIP(%s) = nil, but freeAddrIn would never hand it out on %s: the two disagree about the same subnet",
						addr, prefix)
				}
			}
		})
	}
}

// walkAddresses asks freeAddrIn for one address at a time until it stops, which
// is exactly the set assignPeerIPs can produce from this prefix, and how far it
// got in the order it produces them.
//
// A prefix small enough to list is walked to exhaustion, so `producible` is
// complete and the closing half of the property can be exhaustive. A prefix too
// large to walk is walked to its first eight addresses only, which is where the
// first address a prefix reserves would be; the closing half is skipped for
// those, which is why the /64's last address is pinned by name in the table
// below rather than here.
func walkAddresses(prefix netip.Prefix) (map[netip.Addr]struct{}, []netip.Addr) {
	limit := 8
	if all := enumeratePrefix(prefix); len(all) > 0 {
		limit = len(all)
	}
	produced := make(map[netip.Addr]struct{}, limit)
	var walked []netip.Addr
	for len(walked) < limit {
		addr, ok := freeAddrIn(prefix, produced)
		if !ok {
			break
		}
		walked = append(walked, addr)
		produced[addr] = struct{}{}
	}
	return produced, walked
}

// enumeratePrefix is every address of prefix, or nil when there are too many to
// list. /24 and /126 and everything tighter come back whole; /64 does not.
func enumeratePrefix(prefix netip.Prefix) []netip.Addr {
	masked := prefix.Masked()
	hostBits := masked.Addr().BitLen() - prefix.Bits()
	if hostBits > 12 {
		return nil
	}
	all := make([]netip.Addr, 0, 1<<hostBits)
	for addr := masked.Addr(); masked.Contains(addr); addr = addr.Next() {
		all = append(all, addr)
	}
	return all
}

// TestValidatePeerIPRefusesTheAddressesASubnetKeepsBack: the refusal an
// operator reads, for both families, and the point where their rules differ — a
// /24 keeps back two addresses, a /30 one, a /31 none, and an IPv6 prefix none at
// all, which is why fd00:: is a host address below and 10.10.0.0 is not.
//
// The messages are pinned because they are what the API returns: an operator who
// typed 10.10.0.255 has to be told which address of theirs is wrong and why, not
// that the value is invalid.
func TestValidatePeerIPRefusesTheAddressesASubnetKeepsBack(t *testing.T) {
	cases := []struct {
		name   string
		net    string
		refuse map[string]string
		accept []string
	}{
		{
			// .0 is the network address and .255 the broadcast; .1 is the hub's own
			// and .2.. are ordinary hosts.
			name:   "an IPv4 /24 keeps back its network and broadcast addresses",
			net:    "10.10.0.1/24",
			refuse: map[string]string{"10.10.0.0": "is the network address of 10.10.0.0/24", "10.10.0.255": "is the broadcast address of 10.10.0.0/24"},
			accept: []string{"10.10.0.2", "10.10.0.254"},
		},
		{
			// Where the broadcast convention stops: .3 is a host.
			name:   "an IPv4 /30 keeps back its network address only",
			net:    "10.10.0.1/30",
			refuse: map[string]string{"10.10.0.0": "is the network address of 10.10.0.0/30"},
			accept: []string{"10.10.0.2", "10.10.0.3"},
		},
		{
			// RFC 3021: a /31 has no network address, so the first address is a host
			// — the case a "skip the network address" rule gets wrong.
			name:   "an IPv4 /31 keeps nothing back",
			net:    "10.10.0.1/31",
			accept: []string{"10.10.0.0", "10.10.0.1"},
		},
		{
			name:   "an IPv4 /32 keeps nothing back",
			net:    "10.10.0.5/32",
			accept: []string{"10.10.0.5"},
		},
		{
			// The asymmetry, stated rather than left to be discovered: hasNetworkAddr
			// is false for every IPv6 prefix, so an fd00::1/64 hub hands out fd00::,
			// the subnet-router anycast address, and validation must accept it. The
			// last address of the same prefix is a host address for the other reason
			// that IPv6 has no broadcast at all.
			name:   "an IPv6 /64 keeps nothing back",
			net:    "fd00::1/64",
			accept: []string{"fd00::", "fd00::1", "fd00::2", "fd00::ffff:ffff:ffff:ffff"},
		},
		{
			name:   "an IPv6 /127 keeps nothing back",
			net:    "fd00::1/127",
			accept: []string{"fd00::", "fd00::1"},
		},
		{
			// A /126 is the IPv6 counterpart of a /30, and it behaves like one: no
			// network address and no broadcast address, so all four are hosts.
			name:   "an IPv6 /126 keeps nothing back either",
			net:    "fd00::1/126",
			accept: []string{"fd00::", "fd00::1", "fd00::2", "fd00::3"},
		},
		{
			name:   "an IPv6 /128 keeps nothing back",
			net:    "fd00::9/128",
			accept: []string{"fd00::9"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// self is left empty on purpose: what a prefix keeps back is a question
			// about the prefix, and the hub's own address would refuse half these
			// addresses for a different and better-explained reason.
			prefixes, _ := parseHubNets(tc.net)
			for addr, want := range tc.refuse {
				err := validatePeerIP(addr, prefixes, nil)
				if err == nil {
					t.Errorf("validatePeerIP(%s) = nil, want it refused: %s", addr, want)
					continue
				}
				if !strings.Contains(err.Error(), want) {
					t.Errorf("validatePeerIP(%s) = %q, want it to say %q", addr, err, want)
				}
				if !strings.Contains(err.Error(), "which no spoke may claim") {
					t.Errorf("validatePeerIP(%s) = %q, want it to say why the spoke may not have it", addr, err)
				}
			}
			for _, addr := range tc.accept {
				if err := validatePeerIP(addr, prefixes, nil); err != nil {
					t.Errorf("validatePeerIP(%s) = %v, want nil: it is a host address of %s", addr, err, tc.net)
				}
			}
		})
	}
}

// TestValidatePeerIPAndNestedSubnets: two subnets of one hub may be one inside
// the other. An address the inner subnet reserves may still be a host address of
// the outer one, and allocation scans them in order and hands it out as soon as
// one of them has it free — so validation must not refuse it, or the API would
// refuse a row the hub would then have allocated itself.
func TestValidatePeerIPAndNestedSubnets(t *testing.T) {
	prefixes := mustPrefixes(t, "10.10.0.0/24", "10.0.0.0/8")

	if err := validatePeerIP("10.10.0.0", prefixes, nil); err != nil {
		t.Errorf("validatePeerIP(10.10.0.0) = %v, want nil: 10.0.0.0/8 holds it as a host address", err)
	}
	// Reserved by both, so there is nothing to hand it out as.
	outer := mustPrefixes(t, "10.0.0.0/8", "172.16.0.0/12")
	if err := validatePeerIP("172.16.0.0", outer, nil); err == nil {
		t.Error("validatePeerIP(172.16.0.0) = nil, want it refused: both subnets reserve it")
	}
}

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

// TestAllocatePeerIPsAgreesWithHonorablePeerIPs pins the two implementations of one
// policy to each other. AllocatePeerIPs is what the REST door answers a proposed
// configuration with; honorablePeerIPs is what the hub does to the rows it is
// actually given. They are two code paths and not one, and nothing but this test
// keeps them in step — which is what makes the duplication safe to have at all.
//
// The direction asserted is the one that matters: anything the door accepted must
// survive the hub untouched. If they drift the other way, the door refuses a save
// the hub would have honoured, which is an operator blocked from a configuration
// that works; if they drift this way, the door promises an assignment and the hub
// silently drops a row, which is the failure the whole feature exists to prevent — a
// spoke refused at registration with a message pointing nowhere near the cause.
//
// The cases are the ones the two disagree about first, when they do.
//
// What this table cannot do is reach the *filter's* survivor rule — that only rows
// step 1 kept take part in its duplicate sweep — because it only runs the filter on
// cases the door accepted, and on those step 1 has nothing to drop. That rule is
// pinned in tun_test.go instead ("contested" in TestTunHubDropsRowsItCannotHonour),
// where the filter is driven directly. What the table does reach is the door's own
// version of the same idea, which is a separate property and has its own case below.
func TestAllocatePeerIPsAgreesWithHonorablePeerIPs(t *testing.T) {
	const hubID = "hub-agrees"
	event.Seed(hubID, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(hubID, nil) })

	cases := []struct {
		name string
		net  string
		// peers is the allowlist in order, which is the order allocation walks.
		peers []string
		// rows is what each spoke's row says.
		rows map[string]string
		// wantRefused is the headline of the refusal, empty when the door accepts.
		wantRefused string
		// notRefused is text that must not appear in the refusal — used to pin a
		// sound row out of a conflict it did not cause.
		notRefused string
	}{
		{
			name:  "a plain assignment is kept whole",
			net:   "10.10.0.1/24",
			peers: []string{"a", "b"},
			rows:  map[string]string{"a": "10.10.0.2", "b": "10.10.0.3"},
		},
		{
			name:  "blank rows are allocated and kept",
			net:   "10.10.0.1/24",
			peers: []string{"a", "b", "c"},
			rows:  map[string]string{"a": "", "b": "", "c": ""},
		},
		{
			// A blank row is filled here, so it cannot survive: what comes back is
			// two allocated addresses. The empty row as a *surviving* state is a
			// filter behaviour, not a door one, and tun_test.go pins it —
			// "empty" in TestTunHubDropsRowsItCannotHonour. It is the one asymmetry
			// between this door and that filter: the filter keeps what it cannot
			// fill, the door refuses rather than leaving a spoke that may claim
			// nothing, which is what the API has to do to be able to answer.
			name:  "a blank row is filled, never left empty",
			net:   "10.10.0.1/24,fd00::1/64",
			peers: []string{"a", "b"},
			rows:  map[string]string{"a": "", "b": "fd00::2"},
		},
		{
			name:        "an address off every subnet is refused",
			net:         "10.10.0.1/24",
			peers:       []string{"a"},
			rows:        map[string]string{"a": "192.168.9.9"},
			wantRefused: "192.168.9.9",
		},
		{
			name:        "the hub's own address is refused",
			net:         "10.10.0.1/24",
			peers:       []string{"a"},
			rows:        map[string]string{"a": "10.10.0.1"},
			wantRefused: "the hub's own address",
		},
		{
			name:        "a prefix is not a host address",
			net:         "10.10.0.1/24",
			peers:       []string{"a"},
			rows:        map[string]string{"a": "10.10.0.2/24"},
			wantRefused: "not a comma-separated list",
		},
		{
			name:        "a hostname is refused",
			net:         "10.10.0.1/24",
			peers:       []string{"a"},
			rows:        map[string]string{"a": "spoke.example.com"},
			wantRefused: "not a comma-separated list",
		},
		{
			name:        "a hole in the list is refused",
			net:         "10.10.0.1/24",
			peers:       []string{"a"},
			rows:        map[string]string{"a": "10.10.0.2,,10.10.0.3"},
			wantRefused: "not a comma-separated list",
		},
		{
			name:        "two rows naming one address are both refused",
			net:         "10.10.0.1/24",
			peers:       []string{"a", "b"},
			rows:        map[string]string{"a": "10.10.0.2", "b": "10.10.0.2"},
			wantRefused: "cannot tell which spoke owns it",
		},
		{
			name:        "one row naming it twice is refused",
			net:         "10.10.0.1/24",
			peers:       []string{"a"},
			rows:        map[string]string{"a": "10.10.0.2,10.10.0.2"},
			wantRefused: "named twice",
		},
		{
			// The one address written two ways is the one address, and that is the
			// rule that needs validatePeerIP's own unmap on this path.
			name:        "one address written two ways is a duplicate",
			net:         "10.10.0.1/24",
			peers:       []string{"a", "b"},
			rows:        map[string]string{"a": "::ffff:10.10.0.2", "b": "10.10.0.2"},
			wantRefused: "cannot tell which spoke owns it",
		},
		{
			// The door's own survivor rule, which is a real property and distinct
			// from the filter's version of it. "broken" does name 10.10.0.2, the same
			// address "good" holds — but its row does not parse, so it contributes
			// nothing to the sweep and must not be reported as a second claimant.
			// Otherwise the sound row is refused too, pointing at a conflict that
			// does not exist between the two of them.
			//
			// What is defended here is the seam rather than the order of statements
			// below: parsePeerIPs hands back an empty slice when it says no, so
			// there is nothing for the claims loop to count even if the door read
			// past the failure. That contract has its own test in TestParsePeerIPs;
			// this case pins the consequence, which is the one that matters to an
			// operator — make parsePeerIPs keep the half of a row it understood and
			// the sound row is refused with it, which is what this case catches.
			//
			// The row-dropped-by-*validation* version of the rule is a different
			// one, and it is pinned where the filter is driven directly —
			// "contested" in TestTunHubDropsRowsItCannotHonour — because this table
			// cannot reach it.
			name: "a row that does not parse is in no sweep",
			net:  "10.10.0.1/24",
			peers: []string{
				"broken", "good",
			},
			rows:        map[string]string{"broken": "10.10.0.2,not-an-address", "good": "10.10.0.2"},
			wantRefused: `"broken"`,
			// "good" is sound: it is in the hub's subnet and no other row survives
			// to contest its address, so nothing about it may appear in the refusal.
			notRefused: `"good"`,
		},
		{
			name: "the hub's own address written its other way is refused",
			net:  "10.10.0.1/24",
			peers: []string{
				"a",
			},
			rows:        map[string]string{"a": "::ffff:10.10.0.1"},
			wantRefused: "the hub's own address",
		},
		{
			name:        "an exhausted subnet is refused by the door too",
			net:         "10.10.0.1/30",
			peers:       []string{"a", "b", "c"},
			rows:        map[string]string{"a": "", "b": "", "c": ""},
			wantRefused: "no address free",
		},
		{
			name:        "a blank row with no subnet at all is refused",
			net:         "",
			peers:       []string{"a"},
			rows:        map[string]string{"a": ""},
			wantRefused: "no subnet configured",
		},
		{
			// A hub with no net is one broken hub, not a set of broken rows: there is
			// no subnet for an address to be outside of, so a typed row is neither
			// refused nor blamed for anything, and only the duplicate sweep still
			// applies. Both doors exempt it, and this is where that exemption shows.
			name: "a typed row on a hub with no subnet is not the subnet's business",
			net:  "",
			peers: []string{
				"a", "b",
			},
			rows: map[string]string{"a": "10.10.0.2", "b": "10.10.0.3"},
		},
		{
			name:        "a duplicate is still a duplicate with no subnet",
			net:         "",
			peers:       []string{"a", "b"},
			rows:        map[string]string{"a": "10.10.0.2", "b": "10.10.0.2"},
			wantRefused: "cannot tell which spoke owns it",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			settled, err := AllocatePeerIPs(tc.peers, tc.rows, tc.net)
			if tc.wantRefused != "" {
				if err == nil {
					t.Fatalf("AllocatePeerIPs accepted %v on %q, want a refusal naming %q", tc.rows, tc.net, tc.wantRefused)
				}
				if !strings.Contains(err.Error(), tc.wantRefused) {
					t.Fatalf("AllocatePeerIPs = %v, want a refusal naming %q", err, tc.wantRefused)
				}
				if tc.notRefused != "" && strings.Contains(err.Error(), tc.notRefused) {
					t.Fatalf("AllocatePeerIPs = %v, want no mention of %s: that row is sound", err, tc.notRefused)
				}
				return
			}
			if err != nil {
				t.Fatalf("AllocatePeerIPs = %v, want it accepted", err)
			}

			// The agreement itself: whatever the door settled, the hub keeps whole.
			// Built with the same net and run through the filter the hub applies at
			// Run and at a save, with no authorizer set so nothing else is involved.
			hub := NewTunTunnel(
				IDOption(hubID),
				NetOption(tc.net),
				PeersOption(tc.peers...),
			).(*tunTunnel)
			kept := hub.honorablePeerIPs(settled, xlogger.Nop())
			if len(kept) != len(settled) {
				t.Errorf("the hub kept %v of %d rows the door settled (%v), want all of them", kept, len(settled), settled)
			}
			for peer, want := range settled {
				got, ok := kept[peer]
				if !ok {
					t.Errorf("the hub dropped row %q = %q, which the door had settled", peer, want)
					continue
				}
				if got != want {
					t.Errorf("the hub changed row %q from %q to %q, want it kept byte for byte", peer, want, got)
				}
			}
		})
	}
}

// TestAllocatePeerIPsOnItsOwnTerms: the exported door, pinned by itself.
//
// It is covered from api/ end to end, and that is a weaker pin than it looks. The
// api case has to go through a hub, a request and a JSON round trip to reach one
// call, and it can only assert the status code and whatever else that test
// happened to check — while the door duplicates a policy that
// TestAllocatePeerIPsAgreesWithHonorablePeerIPs compares against the filter. A
// message rewritten, a row added to the sweep or dropped from it, a family
// confused: the agreement test would still pass, because the filter changed with
// it. This one cannot drift, because it names what the door says rather than
// asking whether two things still agree.
//
// Refusals are pinned whole rather than by substring, since the string is the
// product: it is what the API returns to whoever typed the row, and "no address
// free for \"b\" in the hub's subnets (10.10.0.0/30)" is actionable where "no
// address free" is not.
//
// One rule is deliberately absent. The filter lets only its step-1 survivors join
// the duplicate sweep, so a row already dropped for being out of the subnet
// cannot cost a sound row its address. This door has no such step: it returns on
// the first failure, so it has no survivor set to sweep. The rule is real and is
// pinned in tun_test.go ("contested" in TestTunHubDropsRowsItCannotHonour),
// where the filter is driven directly; what is pinned here is the door's own
// version of the idea — the first row to fail is the one reported — which is a
// separate property and would be a false expectation if it were left implicit.
func TestAllocatePeerIPsOnItsOwnTerms(t *testing.T) {
	cases := []struct {
		name  string
		net   string
		peers []string
		rows  map[string]string
		// want is the assignment the door returns, checked whole and in order
		// independent: no allocation and no refusal means these rows and no others.
		want map[string]string
		// wantErr is the whole refusal, empty when the door accepts.
		wantErr string
	}{
		{
			// The whole reason the door exists: a spoke listed with no address is
			// given one from the hub's subnet, and .1 is the hub's own.
			name:  "blank rows are filled in allowlist order",
			net:   "10.10.0.1/24",
			peers: []string{"a", "b", "c"},
			rows:  map[string]string{"a": "", "b": "", "c": ""},
			want:  map[string]string{"a": "10.10.0.2", "b": "10.10.0.3", "c": "10.10.0.4"},
		},
		{
			// The order is the allowlist's, not the map's, so the same hub settles
			// the same way every time and the answer matches the rows as shown.
			name:  "the allowlist order decides, not the map's",
			net:   "10.10.0.1/24",
			peers: []string{"c", "b", "a"},
			rows:  map[string]string{"a": "", "b": "", "c": ""},
			want:  map[string]string{"c": "10.10.0.2", "b": "10.10.0.3", "a": "10.10.0.4"},
		},
		{
			name:  "a typed in-subnet row is kept and counts as taken",
			net:   "10.10.0.1/24",
			peers: []string{"a", "b"},
			rows:  map[string]string{"a": "10.10.0.9", "b": ""},
			want:  map[string]string{"a": "10.10.0.9", "b": "10.10.0.2"},
		},
		{
			// The spelling is the operator's, byte for byte: the row is not
			// normalized on the way through.
			name:  "a typed row is not rewritten",
			net:   "10.10.0.1/24",
			peers: []string{"a", "b"},
			rows:  map[string]string{"a": "::ffff:10.10.0.9", "b": ""},
			want:  map[string]string{"a": "::ffff:10.10.0.9", "b": "10.10.0.2"},
		},
		{
			name:  "a row may name several addresses",
			net:   "10.10.0.1/24",
			peers: []string{"a", "b"},
			rows:  map[string]string{"a": "10.10.0.2,10.10.0.3", "b": ""},
			want:  map[string]string{"a": "10.10.0.2,10.10.0.3", "b": "10.10.0.4"},
		},
		{
			name:    "a prefix is not a host address",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "10.10.0.2/24"},
			wantErr: `spoke "a": "10.10.0.2/24" is not a comma-separated list of IP addresses`,
		},
		{
			name:    "a hostname is not an address",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "spoke.example.com"},
			wantErr: `spoke "a": "spoke.example.com" is not a comma-separated list of IP addresses`,
		},
		{
			name:    "an address that does not parse is not one",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "10.10.0.300"},
			wantErr: `spoke "a": "10.10.0.300" is not a comma-separated list of IP addresses`,
		},
		{
			// A partially parsed row is worse than none: the caller could not tell
			// which half of it was understood.
			name:    "a hole in the list is refused whole",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "10.10.0.2,,10.10.0.3"},
			wantErr: `spoke "a": "10.10.0.2,,10.10.0.3" is not a comma-separated list of IP addresses`,
		},
		{
			name:    "an address off every subnet is refused",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "192.168.9.9"},
			wantErr: `spoke "a": 192.168.9.9 is outside the hub's subnets (10.10.0.0/24)`,
		},
		{
			// The two doors disagree deliberately here and neither is wrong: the
			// filter drops the row and warns, while the door has a request in hand to
			// answer and says so in the reply.
			name:    "the hub's own address is refused",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "10.10.0.1"},
			wantErr: `spoke "a": 10.10.0.1 is the hub's own address, which no spoke may claim`,
		},
		{
			// The one address written two ways, and the one place validatePeerIP's
			// own unmap is load-bearing on this path: the tunnel layer unmapped
			// every row already, so a call made here is the only place it runs. The
			// message names the unmapped address, which is the address itself.
			name:    "the hub's own address in its other spelling is refused",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "::ffff:10.10.0.1"},
			wantErr: `spoke "a": 10.10.0.1 is the hub's own address, which no spoke may claim`,
		},
		{
			// What allocation would never hand out, and what the api case pins at
			// 400: this is the coherence rule reaching the door.
			name:    "the subnet's own network address is refused",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "10.10.0.0"},
			wantErr: `spoke "a": 10.10.0.0 is the network address of 10.10.0.0/24, which no spoke may claim`,
		},
		{
			name:    "the subnet's own broadcast address is refused",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "10.10.0.255"},
			wantErr: `spoke "a": 10.10.0.255 is the broadcast address of 10.10.0.0/24, which no spoke may claim`,
		},
		{
			// A /30's last address is a host address, so the rule that refused .255
			// on the /24 does not fire here. The door is asking the prefix, not the
			// shape of the value.
			name:  "a /30 hands out the address a /24 would have refused",
			net:   "10.10.0.1/30",
			peers: []string{"a"},
			rows:  map[string]string{"a": "10.10.0.3"},
			want:  map[string]string{"a": "10.10.0.3"},
		},
		{
			name:    "two rows naming one address are refused",
			net:     "10.10.0.1/24",
			peers:   []string{"a", "b"},
			rows:    map[string]string{"a": "10.10.0.2", "b": "10.10.0.2"},
			wantErr: `spoke "a": 10.10.0.2 is also named by spoke "b", so the hub cannot tell which spoke owns it`,
		},
		{
			name:    "one row naming it twice is refused",
			net:     "10.10.0.1/24",
			peers:   []string{"a"},
			rows:    map[string]string{"a": "10.10.0.2,10.10.0.2"},
			wantErr: `spoke "a": 10.10.0.2 is named twice in the same row, which no spoke's claim could ever match`,
		},
		{
			// The one address written two ways. Note what the message names: the
			// spelling the operator typed, not the unmapped address it resolves to,
			// because that is the text they have to go and fix. The hub's-own-address
			// refusal below is the other way round — validatePeerIP unmaps before it
			// reports — and the two look inconsistent until you know which side of
			// the door each is on.
			name:    "one address written two ways is one duplicate",
			net:     "10.10.0.1/24",
			peers:   []string{"a", "b"},
			rows:    map[string]string{"a": "::ffff:10.10.0.2", "b": "10.10.0.2"},
			wantErr: `spoke "a": ::ffff:10.10.0.2 is also named by spoke "b", so the hub cannot tell which spoke owns it`,
		},
		{
			// The door's own survivor rule, and the whole of what it has instead of
			// the filter's: it stops at the first row that fails, so a later row with
			// a different problem is not reported and a sound row is not implicated.
			name:    "the first row to fail is the one reported",
			net:     "10.10.0.1/24",
			peers:   []string{"a", "b"},
			rows:    map[string]string{"a": "192.168.9.9", "b": "10.10.0.1"},
			wantErr: `spoke "a": 192.168.9.9 is outside the hub's subnets (10.10.0.0/24)`,
		},
		{
			// Every reason one row has, in the row's own order, so an operator
			// fixing it sees everything wrong with it at once.
			name:  "one row's several problems come back together",
			net:   "10.10.0.1/24",
			peers: []string{"a"},
			rows:  map[string]string{"a": "192.168.9.9,10.10.0.1"},
			wantErr: `spoke "a": 192.168.9.9 is outside the hub's subnets (10.10.0.0/24); ` +
				`10.10.0.1 is the hub's own address, which no spoke may claim`,
		},
		{
			// A hub with no net is one broken hub rather than a set of broken rows:
			// there is no subnet for an address to be outside of, so a typed row is
			// neither refused nor blamed, and only allocation needs a subnet.
			name:    "a blank row with no subnet at all is refused",
			net:     "",
			peers:   []string{"a"},
			rows:    map[string]string{"a": ""},
			wantErr: `no address free for "a": the hub has no subnet configured`,
		},
		{
			name:  "a typed row on a hub with no subnet is the hub's business, not the row's",
			net:   "",
			peers: []string{"a", "b"},
			rows:  map[string]string{"a": "10.10.0.2", "b": "fd00::2"},
			want:  map[string]string{"a": "10.10.0.2", "b": "fd00::2"},
		},
		{
			name:    "a duplicate is still a duplicate with no subnet",
			net:     "",
			peers:   []string{"a", "b"},
			rows:    map[string]string{"a": "10.10.0.2", "b": "10.10.0.2"},
			wantErr: `spoke "a": 10.10.0.2 is also named by spoke "b", so the hub cannot tell which spoke owns it`,
		},
		{
			// Mixed families: each blank row takes the first subnet that still has an
			// address, so a mixed hub fills from IPv4 until IPv4 is full.
			name:  "a mixed hub fills each blank from the first subnet with room",
			net:   "10.10.0.1/24,fd00::1/64",
			peers: []string{"a", "b", "c"},
			rows:  map[string]string{"a": "", "b": "", "c": "fd00::2"},
			want:  map[string]string{"a": "10.10.0.2", "b": "10.10.0.3", "c": "fd00::2"},
		},
		{
			// The /30 is full after two rows, and the third falls through to the IPv6
			// subnet rather than being refused or given a duplicate. fd00:: is what
			// an IPv6 subnet hands out first, because no IPv6 prefix reserves its
			// first address.
			name:  "a mixed hub falls through to the second family when the first is full",
			net:   "10.10.0.1/30,fd00::1/64",
			peers: []string{"a", "b", "c"},
			rows:  map[string]string{"a": "", "b": "", "c": ""},
			want:  map[string]string{"a": "10.10.0.2", "b": "10.10.0.3", "c": "fd00::"},
		},
		{
			// Nothing left anywhere: the refusal names the peer that could not be
			// served and the subnets it was looked for in, because "no address free"
			// alone leaves an operator with nothing to widen.
			name:    "an exhausted subnet is refused by the door too",
			net:     "10.10.0.1/30",
			peers:   []string{"a", "b", "c"},
			rows:    map[string]string{"a": "", "b": "", "c": ""},
			wantErr: `no address free for "c" in the hub's subnets (10.10.0.0/30)`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// rows is the caller's map and must come back untouched either way:
			// assignPeerIPs returns a merged copy rather than writing in place, so
			// the difference between what is saved and what is running stays
			// observable.
			caller := make(map[string]string, len(tc.rows))
			for peer, spec := range tc.rows {
				caller[peer] = spec
			}

			got, err := AllocatePeerIPs(tc.peers, caller, tc.net)

			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("AllocatePeerIPs(%v) = %v, want the refusal %q", tc.peers, got, tc.wantErr)
				}
				if err.Error() != tc.wantErr {
					t.Fatalf("AllocatePeerIPs(%v) = %q, want %q", tc.peers, err, tc.wantErr)
				}
				// A refusal is no partial answer: the caller has something to report
				// and must not use what was managed alongside the error.
				if got != nil {
					t.Errorf("AllocatePeerIPs returned %v alongside a refusal, want nil", got)
				}
			} else {
				if err != nil {
					t.Fatalf("AllocatePeerIPs(%v) = %v, want it accepted", tc.peers, err)
				}
				if len(got) != len(tc.want) {
					t.Fatalf("AllocatePeerIPs(%v) = %v, want %v", tc.peers, got, tc.want)
				}
				for peer, want := range tc.want {
					if got[peer] != want {
						t.Errorf("AllocatePeerIPs(%v)[%q] = %q, want %q", tc.peers, peer, got[peer], want)
					}
				}
			}

			for peer, spec := range tc.rows {
				if caller[peer] != spec {
					t.Errorf("the caller's row %q = %q, want it untouched (%q)", peer, caller[peer], spec)
				}
			}
			if len(caller) != len(tc.rows) {
				t.Errorf("the caller's map grew to %v, want it untouched", caller)
			}
		})
	}
}

// TestAllocatePeerIPsIsDeterministic: the same input settled twice gives the same
// answer, on every call. TestAssignPeerIPsFollowsTheAllowlistOrder pins the
// substantive property — that the order comes from the allowlist — but only once
// through, so an allocator that read the assigned map instead would still pass
// it on the run that happened to come out in order.
//
// Go randomizes map iteration per range, so a map-driven allocator disagrees
// with itself across calls and this catches it; the repetition is what a single
// pass cannot ask for.
func TestAllocatePeerIPsIsDeterministic(t *testing.T) {
	peers := []string{"a", "b", "c", "d", "e"}
	rows := map[string]string{"a": "", "b": "", "c": "", "d": "", "e": ""}

	first, err := AllocatePeerIPs(peers, rows, "10.10.0.1/24")
	if err != nil {
		t.Fatalf("AllocatePeerIPs = %v, want five addresses", err)
	}

	// Many settlements of the one input, each from a fresh copy of the rows, since
	// the door promises not to write into the caller's map and a caller that broke
	// that promise would get a different answer rather than a different map.
	for i := range 25 {
		fresh := make(map[string]string, len(rows))
		for peer, spec := range rows {
			fresh[peer] = spec
		}
		got, err := AllocatePeerIPs(peers, fresh, "10.10.0.1/24")
		if err != nil {
			t.Fatalf("settlement %d = %v, want five addresses", i, err)
		}
		for peer, want := range first {
			if got[peer] != want {
				t.Fatalf("settlement %d gave %q = %q, want %q: the door is not deterministic", i, peer, got[peer], want)
			}
		}
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
