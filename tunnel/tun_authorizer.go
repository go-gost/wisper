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
// address in it. It is called by the hub's peer-route loop, after the self-loop
// guard and before the auther, so a claim that is not this peer's to make costs no
// credential check.
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

	// The claim must be the row's set, in the row's order: not a subset, because a
	// subset check would let a spoke entitled to 10.10.0.2 also claim 10.10.0.3
	// and take that route from the spoke that owns it.
	//
	// Index by index rather than as an unordered set, because both ends build the
	// frame from the same allowlist row — the spoke writes its addresses in the
	// order the row lists them, and the hub reads them back in that order. A spoke
	// that reorders its own list is refused like any other mismatch, naming both
	// sides, rather than silently taking a different route home.
	if len(want) != len(claim) {
		return a.refuse(peer, ips, want, fmt.Sprintf("claimed %d addresses, assigned %d", len(claim), len(want)))
	}
	for i := range want {
		if want[i] != claim[i] {
			return a.refuse(peer, ips, want, fmt.Sprintf("claimed %s, assigned %s", claim[i], want[i]))
		}
	}
	return true
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
