package tunnel

import (
	"context"
	"net"
	"net/netip"
	"sort"
	"strings"
	"sync/atomic"
)

// PeerFilter is the spoke's local inbound block policy. It is built from the
// accepted netview (members and their approved LAN claims) plus the operator's
// blocked_peers list, and is shared by the device path and the userspace
// tun-share shim so a block holds on both.
//
// An empty policy is a pass-through: a spoke that has received no netview and
// blocked nobody keeps the exact old data path, with no packet parsing.
type PeerFilter struct {
	policy  atomic.Pointer[peerFilterPolicy]
	blocked atomic.Uint64
}

// peerFilterPolicy is immutable after construction. Replacing the pointer is
// the whole update; a reader either sees the old policy or the new one, never a
// half-built map.
type peerFilterPolicy struct {
	members map[netip.Addr]string
	// claims are longest-prefix-first, so the first containing claim is the
	// most specific one. A more specific allowed claim therefore wins over a
	// broader blocked one, which is the same longest-prefix rule the route
	// table uses.
	claims  []peerFilterClaim
	blocked map[string]bool
}

type peerFilterClaim struct {
	prefix netip.Prefix
	owner  string
}

// NewPeerFilter builds an empty filter. Empty is pass-through: a spoke that
// has received no netview and blocked nobody keeps the exact old data path.
func NewPeerFilter() *PeerFilter {
	return &PeerFilter{}
}

// SetPolicy replaces the view the filter classifies against. members and
// claims are the hub's accepted netview; blocked is the operator's local list.
// The filter copies everything, so a caller can keep mutating its own slices.
func (f *PeerFilter) SetPolicy(members []NetviewMember, claims []NetviewClaim, blocked []string) {
	if f == nil {
		return
	}

	blockedSet := make(map[string]bool, len(blocked))
	for _, key := range blocked {
		key = strings.TrimSpace(key)
		if key != "" {
			blockedSet[key] = true
		}
	}
	// No block means no policy at all: the packet path must not pay for a
	// parse or even an atomic load's worth of work on every packet.
	if len(blockedSet) == 0 {
		f.policy.Store(nil)
		return
	}

	p := &peerFilterPolicy{
		members: make(map[netip.Addr]string, len(members)),
		claims:  make([]peerFilterClaim, 0, len(claims)),
		blocked: blockedSet,
	}
	for _, m := range members {
		addr, err := netip.ParseAddr(strings.TrimSpace(m.IP))
		if err != nil {
			continue
		}
		p.members[addr.Unmap()] = m.Key
	}
	for _, c := range claims {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(c.Prefix))
		if err != nil {
			continue
		}
		p.claims = append(p.claims, peerFilterClaim{
			prefix: prefix.Masked(),
			owner:  c.Origin,
		})
	}
	sort.Slice(p.claims, func(i, j int) bool {
		if p.claims[i].prefix.Bits() != p.claims[j].prefix.Bits() {
			return p.claims[i].prefix.Bits() > p.claims[j].prefix.Bits()
		}
		return p.claims[i].prefix.String() < p.claims[j].prefix.String()
	})
	f.policy.Store(p)
}

// BlockedSrc reports whether pkt's source belongs to a locally blocked peer.
// It is a pure predicate; the caller owns counting.
func (f *PeerFilter) BlockedSrc(pkt []byte) bool {
	if f == nil {
		return false
	}
	p := f.policy.Load()
	if p == nil {
		return false
	}
	src, _, ok := packetAddrs(pkt)
	return ok && p.blockedAddr(src)
}

// BlockedDst reports whether pkt's destination belongs to a locally blocked
// peer. It is a pure predicate; the caller owns counting.
func (f *PeerFilter) BlockedDst(pkt []byte) bool {
	if f == nil {
		return false
	}
	p := f.policy.Load()
	if p == nil {
		return false
	}
	_, dst, ok := packetAddrs(pkt)
	return ok && p.blockedAddr(dst)
}

// BlockedPackets counts packets the filter dropped. It is cumulative across
// policy updates and reset only with the process.
func (f *PeerFilter) BlockedPackets() uint64 {
	if f == nil {
		return 0
	}
	return f.blocked.Load()
}

func (f *PeerFilter) countBlocked() {
	if f != nil {
		f.blocked.Add(1)
	}
}

func (p *peerFilterPolicy) blockedAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	// An exact member address is the most specific ownership there is: a
	// member's own IP is decided by that member's key, even if some broader
	// LAN claim happens to cover the same address.
	if key, ok := p.members[addr]; ok {
		return p.blocked[key]
	}
	for _, c := range p.claims {
		if c.prefix.Contains(addr) {
			return p.blocked[c.owner]
		}
	}
	return false
}

// packetAddrs parses the source and destination of an IPv4 or IPv6 packet.
// The packet is not validated beyond the addresses: the tun device already
// hands the engine IP packets, and a malformed one must keep its old fate
// rather than be silently blocked by a parser guess.
func packetAddrs(pkt []byte) (src, dst netip.Addr, ok bool) {
	if len(pkt) < 20 {
		return src, dst, false
	}
	switch pkt[0] >> 4 {
	case 4:
		ihl := int(pkt[0]&0x0f) * 4
		if ihl < 20 || len(pkt) < ihl {
			return src, dst, false
		}
		var s, d [4]byte
		copy(s[:], pkt[12:16])
		copy(d[:], pkt[16:20])
		return netip.AddrFrom4(s), netip.AddrFrom4(d), true
	case 6:
		if len(pkt) < 40 {
			return src, dst, false
		}
		var s, d [16]byte
		copy(s[:], pkt[8:24])
		copy(d[:], pkt[24:40])
		return netip.AddrFrom16(s).Unmap(), netip.AddrFrom16(d).Unmap(), true
	default:
		return src, dst, false
	}
}

// Wrap returns conn guarded by this policy. Read drops packets whose
// destination is blocked (the spoke's outbound direction); Write drops packets
// whose source is blocked (the inbound direction) and reports them as written,
// so the engine does not retry a packet the local policy refused.
//
// With an empty policy the wrapper is a pass-through and never parses. The
// wrapper still exists, so a policy installed later applies to the same conn.
func (f *PeerFilter) Wrap(conn net.Conn) net.Conn {
	if f == nil || conn == nil {
		return conn
	}
	return &filterConn{Conn: conn, filter: f}
}

type filterConn struct {
	net.Conn
	filter *PeerFilter
}

var _ net.Conn = (*filterConn)(nil)

func (c *filterConn) Read(p []byte) (int, error) {
	for {
		n, err := c.Conn.Read(p)
		if n > 0 && c.filter.BlockedDst(p[:n]) {
			c.filter.countBlocked()
			if err != nil {
				return 0, err
			}
			continue
		}
		return n, err
	}
}

func (c *filterConn) Write(p []byte) (int, error) {
	if c.filter.BlockedSrc(p) {
		c.filter.countBlocked()
		return len(p), nil
	}
	return c.Conn.Write(p)
}

// Context forwards the device context the x tun handler reads. Without this
// method the wrapper would hide the tun conn's addresses from the handler.
func (c *filterConn) Context() context.Context {
	if cc, ok := c.Conn.(interface{ Context() context.Context }); ok {
		return cc.Context()
	}
	return context.Background()
}
