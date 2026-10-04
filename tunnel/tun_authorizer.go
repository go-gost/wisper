package tunnel

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"sync/atomic"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/wisper/event"
	tunhandler "github.com/go-gost/x/handler/tun"
)

// The assertion that lets wisper satisfy x's authorization hook by shape. It
// stands here as well as in the test so that a change to x's interface breaks
// this build, at the line that implements it, instead of a hub that quietly
// authorizes nothing.
var _ tunhandler.PeerAuthorizer = (*spokeAuthorizer)(nil)

// spokeAuthorizer decides whether a spoke may hold the addresses it announced.
//
// The rule it applies is exact equality with the spoke's own allowlist row, and
// that is the whole of it: before there was an authorizer, any spoke the p2p
// allowlist had routed here could claim any address, and the hub's route table
// is last-writer-wins per address — so a spoke claiming a neighbour's address
// took that route from the spoke that owned it, with nothing anywhere saying so.
//
// The assignment is held behind an atomic pointer rather than a mutex because the
// handler takes its authorizer by value when it is built, and a save has to take
// effect without rebuilding the handler — that would re-create the tun device,
// which needs the privilege the hub was started with and which a config save, run
// by an unprivileged operator, does not have. A pointer also means a registration
// in flight never blocks on a save: it loads the map once, at the top, and decides
// against that one map even if a save lands halfway through the decision.
type spokeAuthorizer struct {
	hubID    string
	log      logger.Logger
	assigned atomic.Pointer[map[string][]netip.Addr]
}

// newSpokeAuthorizer parses the allowlist rows once and holds them. A row that
// does not parse is left out rather than stored as an empty set, because "this
// spoke may claim nothing" and "this spoke's row is a typo" are different states
// and only one of them is the operator's intent; the difference is that a typo is
// reported by the API, while an empty row is what allocation fills.
func newSpokeAuthorizer(hubID string, assigned map[string]string, log logger.Logger) *spokeAuthorizer {
	a := &spokeAuthorizer{hubID: hubID, log: log}
	a.set(assigned)
	return a
}

// set replaces the assignment with a parsed copy of rows. Parsing here rather than
// at decision time is what keeps Authorize a map read and a slice compare, which is
// the only reason it can run inside the hub's registration loop at all.
//
// The rows themselves are copied rather than retained: assigned is the caller's
// map, read from the config, and an authorizer that held it would see a later
// in-place edit appear without a save — making "what is saved" and "what is
// authorizing" two different things with no event between them.
func (a *spokeAuthorizer) set(assigned map[string]string) {
	parsed := make(map[string][]netip.Addr, len(assigned))
	for peer, spec := range assigned {
		addrs, ok := parsePeerIPs(spec)
		if !ok {
			continue
		}
		// The key is stored even when addrs is nil. An empty row is a spoke that
		// may claim nothing, and it has to be found in the map for Authorize to
		// say so — dropped, it would be refused as an unknown peer instead.
		parsed[peer] = unmapAll(addrs)
	}
	a.assigned.Store(&parsed)
}

// Authorize reports whether the peer that sent a registration may hold every
// address in it. The rule is set equality: the addresses a spoke claims must be the
// addresses its own allowlist row assigns, as a set — any order, no subset, nothing
// extra. It is called by the hub's peer-route loop, after the self-loop guard and
// before the auther, so a claim that is not this peer's to make costs no credential
// check.
func (a *spokeAuthorizer) Authorize(ctx context.Context, peer string, ips []net.IP) bool {
	// A cancelled context is not a policy decision and is not reported as one: a
	// spoke whose stream died mid-registration would otherwise write a warning
	// into the hub's history on every disconnect.
	if ctx.Err() != nil {
		return false
	}

	// Loaded once, here, and not re-read: a decision made against half of one
	// assignment and half of its replacement would be a decision against neither.
	addrs := a.assigned.Load()
	if addrs == nil {
		return a.refuse(peer, ips, nil, "the hub has no assignment loaded")
	}
	// Not in the assignment means not this hub's spoke, or one whose row did not
	// parse. Deny by default: the alternative is a claim nobody checked going into
	// a last-writer-wins table.
	want, ok := (*addrs)[peer]
	if !ok {
		return a.refuse(peer, ips, nil, "the peer is not in the hub's assignment")
	}

	// The claim is canonicalized before it is compared, not while.
	// netip.AddrFromSlice fails on anything that is not 4 or 16 bytes, and a claim
	// of something that is not an address has to be refused as such whether or not
	// its length would also have failed the comparison below — otherwise a
	// malformed claim reads as a mere mismatch and the warning points elsewhere.
	claim := make([]netip.Addr, 0, len(ips))
	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip)
		if !ok {
			return a.refuse(peer, ips, want, fmt.Sprintf("a claimed address is %d bytes, not 4 or 16", len(ip)))
		}
		// Unmap is what makes an IPv4 claim and an IPv4 assignment one address. The
		// claim comes off the wire, where x writes 16 bytes per address, so an
		// IPv4 spoke arrives as ::ffff:10.10.0.2 while the row is written 10.10.0.2
		// — the same address as two different netip.Addr values. Without this every
		// IPv4 spoke on the hub is refused as unauthorized, which looks like a
		// broken allowlist and is not.
		claim = append(claim, addr.Unmap())
	}

	// The claim must be exactly the assigned set, and — the whole point — no subset
	// of it.
	//
	// Order is not part of the rule. The claim arrives as a []net.IP parsed out of a
	// frame that came over the network, and nothing in the protocol pins its order to
	// the row's; a spoke entitled to exactly 10.10.0.2 and 10.10.0.3 that announces
	// them the other way round is claiming exactly what it is entitled to. Comparing
	// index by index would refuse it, as an intermittent spoke failure pointing
	// nowhere near the cause. Nothing downstream needs the order: x's peerTable.set
	// is keyed per address, so the routes registered are the same either way.
	//
	// The check is the length first, then a sweep that consumes. Both halves are
	// load-bearing and neither is a shortcut past the other:
	//
	//   - The length check rules out the directions a sweep cannot see: a spoke
	//     entitled to 10.10.0.2 that also claims 10.10.0.3 has made the claim the
	//     longer of the two, and one that claims nothing of two assigned addresses
	//     has made it the shorter. This is the half that keeps the sweep from being a
	//     subset test, and dropping it is the subset bug the authorizer exists to
	//     prevent.
	//   - The sweep consumes: the assigned addresses go into a set and each claimed
	//     address takes one out. So a claim of an address nobody is assigned fails on
	//     the first test, and a claim of the same address twice fails on the second,
	//     because the first claim already took it. Containment without consuming
	//     would accept a spoke assigned 10.10.0.2, 10.10.0.3, 10.10.0.4 that claims
	//     10.10.0.2, 10.10.0.2, 10.10.0.3 — the right count, every address of it
	//     assigned, and neither the assignment nor a subset of it, because .4 was
	//     never claimed at all.
	//
	// Together the two are set equality: same count, and each claim a distinct
	// assigned address. The count is what closes the other end — once every claim
	// has consumed a distinct assigned address, none can be left over.
	if len(want) != len(claim) {
		return a.refuse(peer, ips, want, fmt.Sprintf("claimed %d addresses, assigned %d", len(claim), len(want)))
	}
	left := make(map[netip.Addr]struct{}, len(want))
	for _, w := range want {
		left[w] = struct{}{}
	}
	for _, claimed := range claim {
		if _, ok := left[claimed]; !ok {
			// The two ways to miss are told apart, because an operator needs to know
			// which: an address that belongs to a neighbour is a hub configuration
			// problem, and a repeat is a spoke announcing itself wrongly.
			if assigned(want, claimed) {
				return a.refuse(peer, ips, want, fmt.Sprintf("claimed %s more than once", claimed))
			}
			return a.refuse(peer, ips, want, fmt.Sprintf("claimed %s, which is not assigned to it", claimed))
		}
		delete(left, claimed)
	}
	return true
}

// assigned reports whether want holds addr.
//
// Used only to tell a repeated claim from one that is nobody's, and it is here
// rather than a second map so the sweep allocates once.
func assigned(want []netip.Addr, addr netip.Addr) bool {
	for _, w := range want {
		if w == addr {
			return true
		}
	}
	return false
}

// refuse records one refusal, on the hub's logger and in the hub's event history,
// and returns false so that every path turning a spoke away reports it exactly
// once.
//
// The reporting lives here rather than in the hub's peer-route loop because that
// loop accepts a stream and never parses a frame: by the time a claim is refused
// the peer, what it claimed and what it was assigned are known nowhere else. The
// event goes under the hub's ID rather than the peer's because a peer key names an
// object wisper has no page for, so an event filed under it would be invisible to
// the operator who has to act on it.
//
// Nothing here can block: it is a map read, a slice compare and one append to a
// mutex-guarded history, where a plugin auther's RPC to another process could wait
// on anything.
func (a *spokeAuthorizer) refuse(peer string, ips []net.IP, want []netip.Addr, reason string) bool {
	assigned := joinAddrs(want)
	if assigned == "" {
		assigned = "(none)"
	}
	// One format, both sinks: a log line and an event that disagree about what was
	// refused are worse than either alone.
	format := "spoke %q refused: %s — claimed %v, assigned %s"
	args := []any{peer, reason, ips, assigned}
	if a.log != nil {
		a.log.Warnf(format, args...)
	}
	// An empty hub ID files nothing, which is event.Record's rule: an event
	// belonging to no object would never be read.
	event.Record(a.hubID, event.LevelWarn, format, args...)
	return false
}

// unmapAll canonicalizes a row's addresses to the same 4-byte form the claim side
// produces, so a row written in the ::ffff: form — or handed over by an older
// config — compares equal to the address a spoke announces for it.
func unmapAll(addrs []netip.Addr) []netip.Addr {
	if len(addrs) == 0 {
		return nil
	}
	out := make([]netip.Addr, len(addrs))
	for i, addr := range addrs {
		out[i] = addr.Unmap()
	}
	return out
}

// joinAddrs renders a set of addresses as comma-separated text, so a refusal
// names the addresses rather than printing an opaque slice.
func joinAddrs(addrs []netip.Addr) string {
	parts := make([]string, 0, len(addrs))
	for _, addr := range addrs {
		parts = append(parts, addr.String())
	}
	return strings.Join(parts, ",")
}
