package tunnel

import (
	"fmt"
	"net"
	"net/netip"
	"strings"
)

// A tun hub is the allocator of record: each spoke's row in the allowlist names
// the addresses it may claim, and a row with no address is filled from the hub's
// own subnet. Nothing here knows about a hub, a config or a route table — these
// are the four pure functions the rest of the feature is written on, so that the
// caller owns every error it has to report and the rules can be tested on their
// own.

// parseHubNets reads the hub's own "net" field ("10.10.0.1/24,fd00::1/64") and
// returns both halves of what it finds: the subnet of each entry, and the address
// the hub itself holds in it.
//
// Both halves are needed because net.ParseCIDR keeps only one. Given
// "10.10.0.1/24" it returns the *network* 10.10.0.0/24 and discards 10.10.0.1 —
// the one address in that subnet the hub must never hand out. A caller holding
// only the prefix cannot recover it, so it would give 10.10.0.1 to the first
// spoke, and the hub's self-loop guard would then refuse that spoke's
// registration at runtime with a message pointing nowhere near the cause. That
// is why self is a separate return value rather than something to re-derive
// later.
//
// An entry that does not parse is skipped, not refused: net is a field an
// operator types, the listener that ultimately consumes it tolerates whatever it
// is given, and a hub that names one bad entry is still a hub whose good entries
// work.
func parseHubNets(netSpec string) (prefixes []netip.Prefix, self []netip.Addr) {
	for _, entry := range strings.Split(netSpec, ",") {
		// The address and the prefix are two results of one parse: ParseCIDR
		// gives up the host part as the first return value and the network as
		// the second, which is exactly the pair needed here.
		addr, ipNet, err := net.ParseCIDR(strings.TrimSpace(entry))
		if err != nil {
			continue
		}
		host, ok := netip.AddrFromSlice(addr)
		if !ok {
			continue
		}
		// net.ParseCIDR hands an IPv4 address back as a 16-byte v4-in-v6 IP, and
		// Unmap is what turns it into the 4-byte form every other address here —
		// and every address the hub's config is written with — uses. Without it
		// the prefix comes out as "::/24" and the hub hands a spoke "::1".
		host = host.Unmap()
		// The prefix is built from the network the parse returned, not from
		// the host address: Masked() on 10.10.0.1/24 would keep the host bits
		// unless they are cleared, and a prefix with bits set in its host part
		// is not a prefix.
		bits, _ := ipNet.Mask.Size()
		prefixes = append(prefixes, netip.PrefixFrom(host, bits).Masked())
		self = append(self, host)
	}
	return prefixes, self
}

// parsePeerIPs reads one allowlist row's value: a comma-separated list of bare
// host addresses.
//
// Bare, because a row names the addresses a spoke may claim and a prefix is not
// one of them — the device takes a host address, so "10.10.0.2/24" here would
// name a network the spoke cannot hold. A hostname is refused for the same
// reason: nothing downstream resolves one, and an unresolvable row value is
// indistinguishable from a typo. An empty row is not an error: it is the state
// that means "this spoke may claim nothing", which is what assignPeerIPs fills.
//
// ok is false if any element is not an address, and the returned slice is then
// empty — a partially parsed list would be worse than none, because the caller
// cannot tell which half of the row was understood.
func parsePeerIPs(spec string) ([]netip.Addr, bool) {
	// An empty row is not malformed. It is the state that means "this spoke may
	// claim nothing" — before allocation fills it, or after it was deliberately
	// cleared — so it is the one empty value this accepts.
	if strings.TrimSpace(spec) == "" {
		return nil, true
	}

	var addrs []netip.Addr
	for _, entry := range strings.Split(spec, ",") {
		entry = strings.TrimSpace(entry)
		// An empty element means the row has a hole in it: "10.10.0.2,,fd00::2"
		// is a row whose second address went missing, not a row of two. The
		// whole-row case is handled before the loop, so this only fires on a
		// comma.
		if entry == "" {
			return nil, false
		}
		addr, err := netip.ParseAddr(entry)
		if err != nil {
			return nil, false
		}
		addrs = append(addrs, addr)
	}
	return addrs, true
}

// validatePeerIP reports why a typed address cannot be assigned: it is not an
// address at all, it is the hub's own, or it is outside every subnet the hub's
// device is on. err is nil when it is fine.
//
// self is the half of parseHubNets that a prefix cannot carry, and it is checked
// here rather than only in assignPeerIPs because that leaves the two paths
// disagreeing: allocation skips the hub's own address, so a validator that accepted
// one would bless a row the hub will never hand out — the API would report it saved
// and the spoke would be turned away at registration by x's self-loop guard, with a
// message pointing nowhere near the cause. Refusing it here is what makes the two
// paths say the same thing.
//
// It names the offending value in the message, because this error goes back to
// whoever typed it through the API and the UI. A bare "invalid" tells an operator
// nothing they did not already know.
func validatePeerIP(host string, prefixes []netip.Prefix, self []netip.Addr) error {
	addr, err := netip.ParseAddr(strings.TrimSpace(host))
	if err != nil {
		return fmt.Errorf("%q is not an IP address", host)
	}
	// Unmapped before anything compares it. A row written ::ffff:10.10.0.2 names the
	// same address as 10.10.0.2, and neither netip.Prefix.Contains nor a plain
	// comparison against the hub's own addresses would match it as it stands — so
	// the hub would refuse a row that is in its own subnet, and refuse the hub's own
	// address as though it were somewhere else entirely.
	addr = addr.Unmap()
	// Before the subnet walk, and not as a subnet question: the hub's own address is
	// inside its own prefix by construction, so asking whether it is in one of the
	// hub's subnets would answer yes and say nothing about why it is refused.
	for _, own := range self {
		if own == addr {
			return fmt.Errorf("%s is the hub's own address, which no spoke may claim", addr)
		}
	}
	// An IPv4 address is not inside an IPv6 prefix, and netip.Prefix.Contains
	// says so itself, so a mixed-family hub needs no special case here.
	for _, prefix := range prefixes {
		if prefix.Contains(addr) {
			return nil
		}
	}
	if len(prefixes) == 0 {
		return fmt.Errorf("%s is outside the hub's subnets: the hub has no subnet configured", addr)
	}
	return fmt.Errorf("%s is outside the hub's subnets (%s)", addr, joinPrefixes(prefixes))
}

// assignPeerIPs fills the rows that name no address, in order, with the next free
// host address of the first hub subnet that still has one. Rows that already have
// a value are never touched — an operator who typed an address keeps it, byte for
// byte, and a row that names two keeps both.
//
// "Free" is decided by collecting every address any row already names, typed or
// previously assigned, plus the hub's own. Walking then starts at the first host
// address of a prefix and goes up: not at Prefix.Masked().Addr(), which for
// 10.10.0.1/24 is the network address 10.10.0.0 and is nobody's to hold, and not
// at the host address the hub wrote, which is the hub's own.
//
// It walks order rather than the assigned map, so the same allowlist always
// yields the same addresses, and those addresses match the order the rows are
// displayed in. Iterating a map would reshuffle them on every save.
//
// The merged map is returned rather than assigned in place: the caller's map
// belongs to the caller's config, and an allocator that wrote into it would make
// the difference between "this is what is saved" and "this is what is running"
// unobservable. On error the map is returned too — the caller reports the error
// and must not use the partial result, which is stated here so that is not a
// surprise.
func assignPeerIPs(order []string, assigned map[string]string, prefixes []netip.Prefix, self []netip.Addr) (map[string]string, error) {
	merged := make(map[string]string, len(assigned)+len(order))
	for peer, ips := range assigned {
		merged[peer] = ips
	}

	// Everything that already holds an address, whether an operator typed it or
	// a previous pass allocated it. A row that does not parse names no address
	// to reserve, and validatePeerIP is where that is reported.
	taken := make(map[netip.Addr]struct{}, len(merged)+len(self))
	for _, spec := range merged {
		addrs, _ := parsePeerIPs(spec)
		for _, addr := range addrs {
			taken[addr] = struct{}{}
		}
	}
	for _, addr := range self {
		taken[addr] = struct{}{}
	}

	for _, peer := range order {
		if strings.TrimSpace(merged[peer]) != "" {
			continue
		}
		if len(prefixes) == 0 {
			return merged, fmt.Errorf("no address free for %q: the hub has no subnet configured", peer)
		}
		addr, ok := nextFreeAddr(prefixes, taken)
		if !ok {
			return merged, fmt.Errorf("no address free for %q in the hub's subnets (%s)", peer, joinPrefixes(prefixes))
		}
		merged[peer] = addr.String()
		taken[addr] = struct{}{}
	}
	return merged, nil
}

// nextFreeAddr is the first address of prefixes that nothing has taken, scanning
// the prefixes in the order the hub listed them. It is deliberately not a single
// combined range: two prefixes the operator wrote are two subnets with a gap
// between them, and a spoke handed an address from the gap would be unreachable.
//
// ok is false when every prefix is exhausted, which is the caller's signal to
// report rather than wrap around and hand out an address twice.
func nextFreeAddr(prefixes []netip.Prefix, taken map[netip.Addr]struct{}) (netip.Addr, bool) {
	for _, prefix := range prefixes {
		if addr, ok := freeAddrIn(prefix, taken); ok {
			return addr, true
		}
	}
	return netip.Addr{}, false
}

// freeAddrIn scans one prefix from its first host address upward and returns the
// first address that is neither reserved by the prefix itself nor already taken.
//
// The scan starts at Next() of the masked prefix address, not at the masked
// address: 10.10.0.0 in 10.10.0.0/24 is the network, and a spoke cannot hold it.
// hasNetworkAddr below is the rule for the prefixes where that is true at all.
func freeAddrIn(prefix netip.Prefix, taken map[netip.Addr]struct{}) (netip.Addr, bool) {
	masked := prefix.Masked()
	last := lastAddrIn(masked)

	addr := masked.Addr()
	if hasNetworkAddr(masked) {
		// A /31 is two usable addresses and a /32 is one: there the first
		// address of the prefix is a host address, and skipping it would leave
		// nothing to hand out.
		addr = addr.Next()
	}

	for ; masked.Contains(addr); addr = addr.Next() {
		if addr == last && hasBroadcastAddr(masked) {
			continue
		}
		if _, busy := taken[addr]; busy {
			continue
		}
		return addr, true
	}
	return netip.Addr{}, false
}

// hasNetworkAddr reports whether a prefix reserves its network address.
//
// A /31 or /32 does not: RFC 3021 defines a /31 as two point-to-point endpoints
// with no network address, and a /32 is a single host. That is the whole reason
// this is a named predicate and not a constant compared against Bits() at the
// call site — the two cases behave differently and both have to be right.
func hasNetworkAddr(prefix netip.Prefix) bool {
	return prefix.Bits() < 31
}

// hasBroadcastAddr reports whether a prefix reserves its last address as the
// broadcast.
//
// Only an IPv4 prefix below /30 has one. A /30's last address is a usable host
// address and is handed out like any other, which is what makes a /30 hub able to
// serve two spokes. IPv6 has no broadcast address at all, so the rule is stated
// for IPv4 and the family is checked rather than assumed.
func hasBroadcastAddr(prefix netip.Prefix) bool {
	return prefix.Addr().Is4() && prefix.Bits() < 30
}

// lastAddrIn is the highest address in prefix: its masked address with every
// host bit set. The broadcast address, where there is one, is this address — so
// the walk below compares against one value instead of computing a whole second
// range.
func lastAddrIn(prefix netip.Prefix) netip.Addr {
	addr := prefix.Masked().Addr()
	if !addr.IsValid() {
		return addr
	}
	// AsSlice returns a copy, so setting bits here cannot reach the Addr it
	// came from. For a /0 the loop is empty and this returns the address itself,
	// which is also the last one — the single-address case needs no special case.
	hostBits := prefix.Bits()
	raw := addr.AsSlice()
	for i := hostBits / 8; i < len(raw); i++ {
		// The byte the prefix length ends inside keeps its high bits; the rest
		// of it, and every byte after it, are host bits.
		if i == hostBits/8 && hostBits%8 != 0 {
			raw[i] |= 0xff >> (hostBits % 8)
			continue
		}
		raw[i] = 0xff
	}
	last, _ := netip.AddrFromSlice(raw)
	return last
}

// joinPrefixes renders prefixes for an error message, so the operator is told
// which subnets the address would have had to come from.
func joinPrefixes(prefixes []netip.Prefix) string {
	parts := make([]string, 0, len(prefixes))
	for _, prefix := range prefixes {
		parts = append(parts, prefix.String())
	}
	return strings.Join(parts, ", ")
}
