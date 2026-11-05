package tunnel

import (
	"strings"
	"sync"
)

// PeerFilter is the spoke's local inbound block policy. It is built from the
// accepted netview (members and their approved LAN claims) plus the operator's
// blocked_peers list, and is shared by the device path and the userspace
// tun-share shim so a block holds on both.
//
// Task 3 establishes the policy container and the SetPolicy seam. Task 4 adds
// the packet classification and the conn wrapper; an empty policy is a
// pass-through, which is also the old behaviour.
type PeerFilter struct {
	mu      sync.RWMutex
	members []NetviewMember
	claims  []NetviewClaim
	blocked map[string]bool
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
	next := make(map[string]bool, len(blocked))
	for _, key := range blocked {
		key = strings.TrimSpace(key)
		if key != "" {
			next[key] = true
		}
	}
	f.mu.Lock()
	f.members = append([]NetviewMember(nil), members...)
	f.claims = make([]NetviewClaim, 0, len(claims))
	for _, c := range claims {
		c.Allow = append([]string(nil), c.Allow...)
		f.claims = append(f.claims, c)
	}
	f.blocked = next
	f.mu.Unlock()
}
