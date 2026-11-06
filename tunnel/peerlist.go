package tunnel

import "context"

// EntryPeer is one row of a tun spoke's local peer view: the hub, every member
// the hub published, and any blocked key that is no longer a member. It is the
// spoke's own view, not the hub's allowlist: a member the hub disabled stays
// here with Disabled set, and a blocked key that left the netview stays visible
// so the operator can unblock it.
//
// The transport and traffic fields are filled by the direct-link layer; with
// no direct link they are zero and State says why the peer is on the hub path.
type EntryPeer struct {
	Key   string
	Name  string
	IPs   []string
	LANs  []string
	State string // hub / blocked / disabled / direct-off / direct / connecting

	Blocked  bool
	Direct   bool
	Disabled bool

	Transport     string
	DialedLocally bool
	// RTTMs is the live transport's measured round trip in milliseconds: KCP's
	// session SRTT or QUIC's connection RTT. Zero when no p2p session exists
	// (the row reaches the peer through the hub, or is not connected).
	RTTMs       int64
	InputBytes  uint64
	OutputBytes uint64
}

// PeerListReporter is implemented by a tun spoke entrypoint. The API asks for
// the list rather than rebuilding it, because only the entrypoint holds the
// current local policy and, once direct links exist, their live state.
type PeerListReporter interface {
	PeerList() []EntryPeer
}

// BlockedPeersSetter applies a local inbound block list to a running or
// stopped tun spoke. It must not restart the entrypoint: the block is a packet
// filter and a netview-derived policy, both of which can change in place.
type BlockedPeersSetter interface {
	SetBlockedPeers(ctx context.Context, keys []string) error
}
