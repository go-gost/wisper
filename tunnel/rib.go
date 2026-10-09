package tunnel

import (
	"fmt"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"
)

// staticOrigin is the Origin of a route the hub's own configuration injected.
// It is not a peer key, so it can never collide with one, and a spoke reading
// a snapshot can tell an operator's route from a peer's own.
const staticOrigin = "static"

// lanClaim is one route the hub has approved: the CIDR, who holds it, and —
// the second of the two layers, and the one that has nothing to do with
// approval — who may use it.
//
// claimTTL is how long a claim lives without its owner re-sending it. It is
// what the hub sweeps on, and a spoke refreshes on claimRefreshInterval — well
// inside it — so a claim only expires when the spoke behind it is genuinely
// gone: a control stream that died, a host that never came back.
//
// The numbers are paired deliberately: the refresh must be shorter than the TTL
// (or a healthy spoke exits) and the sweep must come often enough that a dead
// spoke's LAN is withdrawn promptly ("promptly" here meaning inside a minute,
// not inside a second).
const (
	claimTTL           = 45 * time.Second
	claimSweepInterval = 15 * time.Second
)

// Approval (lan_allow) decided whether this route could exist at all. Allow is
// what an approved route is open to: empty means every member, which is the
// default because the hub's allowlist is already whole-network membership, and
// a route narrower than that is the operator narrowing it on purpose.
type lanClaim struct {
	Prefix netip.Prefix
	Origin string // claiming peer key, or "static"
	Static bool
	Allow  []string // empty = every member

	// Via is the member key an injected route's "via" address resolved to, and
	// empty for a dynamic claim, whose Origin already names the peer that holds
	// the LAN. Both kinds of route answer one question the hub asks per packet —
	// which peer carries this destination — and they answer it in different
	// fields, so the resolution has to be kept somewhere.
	Via string

	// Seen is when this route was last announced by its owner. A dynamic
	// claim that has gone quiet is withdrawn (Withdraw); a static one carries
	// a time too, so one comparison answers for the table, but is skipped
	// because configuration is not something a peer can stop re-asserting.
	Seen time.Time
}

// claimSet is one version of the RIB as a spoke is allowed to see it: the
// approved routes and nothing else. A route the hub refused never appears, so
// a spoke cannot learn a LAN exists by being told about the claim that was
// turned down.
//
// Members rides along because it changes for reasons of its own — a peer joins
// or leaves — and a spoke that could not see them would keep routing to an
// address that is no longer anybody's.
type claimSet struct {
	Hub     string
	Rev     uint64
	Claims  []claimEntry
	Members []memberEntry // from Task 1
}

// rib is the hub's routing information base for peer LANs. It decides which
// claimed CIDRs exist, and nothing else: no packet, no stream, no conn.
//
// Everything is under one mutex because every operation is a read of the whole
// and a write of a part — approval reads the allow rows, arbitration reads the
// claim table, and the snapshot reads both — and a table read while a claim is
// applied is a snapshot of the winners taken mid-arbitration. The sections are
// a map lookup and a sort of a handful of prefixes, so the lock is never held
// for longer than a config save takes.
type rib struct {
	mu      sync.Mutex
	hubID   string
	rev     uint64
	claims  map[netip.Prefix]*lanClaim
	allow   map[string][]netip.Prefix
	members []memberEntry
	events  func(string, ...any)
	// now is where the clock comes from. It is injected because the whole
	// point of a TTL is the comparison it makes, and a RIB that read the
	// clock itself could not be tested without a minute of sleeping — the
	// tests would have to be the size of the race they check for.
	now func() time.Time
}

// newRIB builds a hub's RIB. allow is the lan_allow policy: per peer, the
// supernets it may claim inside. A peer with no row claims nothing at all —
// default-deny — so a spoke that reaches a hub it is not configured for cannot
// put a route into it just by saying so. events receives one line per refusal
// and per conflict, which is how the operator learns a claim did not take.
//
// The rows are copied and masked rather than held: allow is the caller's map,
// read from the hub's config, and a RIB that read it in place would see a later
// edit appear with no save — "what is authorized" and "what is saved" becoming
// two different facts with nothing between them. A peer with an empty row keeps
// its key, because "this spoke may claim nothing" and "this spoke is not
// configured here" are different states and only the refusal message tells them
// apart.
func newRIB(hubID string, allow map[string][]netip.Prefix, events func(string, ...any), now func() time.Time) *rib {
	rows := make(map[string][]netip.Prefix, len(allow))
	for peer, supers := range allow {
		row := make([]netip.Prefix, 0, len(supers))
		for _, super := range supers {
			row = append(row, super.Masked())
		}
		rows[peer] = row
	}
	return &rib{
		hubID:  hubID,
		rev:    1,
		claims: make(map[netip.Prefix]*lanClaim),
		allow:  rows,
		events: events,
		now:    now,
	}
}

// SetMembers replaces the membership the RIB reasons about: the members a
// claim may not swallow (a claim covering a member's own tun address would
// blackhole that member's host traffic) and the addresses an injected route's
// "via" resolves against.
//
// A membership that actually changed advances the rev, because the snapshot
// carries it: a spoke decides whether to install a netview by its rev, so a new
// member list published under a rev a spoke has already seen is a change no
// spoke would ever apply. An identical list is not a change, so the hub may
// call this on every registration without a wake-up storm.
func (r *rib) SetMembers(members []memberEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if slices.Equal(r.members, members) {
		return
	}
	r.members = slices.Clone(members)
	r.rev++
}

// ApplyClaim applies one spoke's add/drop and returns the prefixes the RIB
// accepted for that origin. A refusal is not an error and not a return value:
// it is an event, because a spoke is told nothing about why its claim did not
// take, and the operator reading the hub's history is the one who can fix it.
//
// Every prefix is masked first. A spoke sends the string it was configured
// with, and "192.168.50.7/24" names the same network as "192.168.50.0/24" —
// unmasked, the two would be two table entries for one destination and the
// second claim on it would look like a conflict with the first.
func (r *rib) ApplyClaim(origin string, add, drop []netip.Prefix) []netip.Prefix {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Drops before adds. A message naming one prefix in both lists is a spoke
	// re-asserting itself, and the assertion is the newer half of that.
	for _, prefix := range drop {
		prefix = prefix.Masked()
		held, ok := r.claims[prefix]
		// Only this origin's own claim, and never an injected one: a drop that
		// took a static route would let any spoke withdraw an operator's route.
		if !ok || held.Origin != origin || held.Static {
			continue
		}
		delete(r.claims, prefix)
		r.rev++
	}

	accepted := make([]netip.Prefix, 0, len(add))
	for _, prefix := range add {
		prefix = prefix.Masked()
		held, taken := r.claims[prefix]

		// Already this origin's route. It is in force, so it is accepted — and
		// nothing moves: this is what a re-claim's refresh is, and advancing
		// the rev here would push the same netview to every spoke on the network.
		if taken && held.Origin == origin {
			held.Seen = r.now()
			accepted = append(accepted, prefix)
			continue
		}
		// The three refusals, in the order an operator would fix them: not
		// permitted to claim it at all, then permitted but not of anything this
		// network is made of, then permitted and taken by a peer.
		if why, ok := r.approvalRefusal(origin, prefix); !ok {
			r.report("spoke %q may not claim %s: %s", origin, prefix, why)
			continue
		}
		if addr, key, ok := r.memberIn(prefix); ok {
			r.report("spoke %q may not claim %s: it covers %s, the tun address of spoke %q, and routing it there would blackhole that spoke's own traffic",
				origin, prefix, addr, key)
			continue
		}
		if taken && held.Static {
			r.report("spoke %q may not claim %s: the hub has that route of its own", origin, prefix)
			continue
		}
		if taken {
			r.report("spoke %q may not claim %s: spoke %q claimed it first and keeps it", origin, prefix, held.Origin)
			continue
		}

		r.claims[prefix] = &lanClaim{Prefix: prefix, Origin: origin, Seen: r.now()}
		r.rev++
		accepted = append(accepted, prefix)
	}
	return accepted
}

// approvalRefusal is the first gate: may this origin have this route in the
// table at all. It reports why, because "refused" without a reason is the one
// answer that leaves an operator nothing to do.
func (r *rib) approvalRefusal(origin string, prefix netip.Prefix) (string, bool) {
	supers, ok := r.allow[origin]
	if !ok {
		return "the hub has no lan_allow row for it, and an unconfigured peer may claim nothing", false
	}
	if len(supers) == 0 {
		return "its lan_allow row is empty", false
	}
	for _, super := range supers {
		// Both halves: the network address has to be inside the supernet, and
		// the supernet may not be shorter. "0.0.0.0/0" is inside every supernet
		// by address and inside none of them by length, and approving it on the
		// address alone is how a claim of the whole internet gets through.
		if super.Contains(prefix.Addr()) && super.Bits() <= prefix.Bits() {
			return "", true
		}
	}
	return "lan_allow lets it claim only inside " + joinPrefixes(supers), false
}

// memberIn reports a member whose own tun address falls inside prefix. Such a
// claim is refused: the hub's route table is consulted first for a destination
// a route covers, so a route swallowing a member's virtual address would take
// that member's own traffic — including the traffic that claims the LAN — and
// blackhole the spoke behind it.
func (r *rib) memberIn(prefix netip.Prefix) (netip.Addr, string, bool) {
	for _, m := range r.members {
		addr, err := netip.ParseAddr(strings.TrimSpace(m.IP))
		if err != nil {
			// A member the hub cannot name an address for cannot be checked, and
			// is not this gate's business to refuse a claim over.
			continue
		}
		// Unmapped because a member row may carry the ::ffff: spelling of an
		// IPv4 address, and a prefix.Contains that misses it would wave a
		// blackholing claim straight through the one check meant to stop it.
		if addr = addr.Unmap(); prefix.Contains(addr) {
			return addr, m.Key, true
		}
	}
	return netip.Addr{}, "", false
}

// Withdraw drops every dynamic claim whose owner has not re-sent it within
// ttl, and returns what it dropped. It is the hub's only way back from the one
// failure no claim can recover from: a spoke that stopped talking but whose
// route is still installed, blackholing every packet aimed at its LAN.
//
// A withdrawn route has to reach every spoke, so it advances the rev — the same
// signal the claim itself travelled on. An event rides along naming the prefix
// and its origin, because an operator watching a LAN disappear needs to see
// which spoke stopped re-asserting it.
//
// Static routes are skipped: their owner is the hub's own config, not a peer,
// and a config file does not go quiet.
func (r *rib) Withdraw(ttl time.Duration) []netip.Prefix {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := r.now()
	var withdrawn []netip.Prefix
	for prefix, claim := range r.claims {
		if claim.Static {
			continue
		}
		if now.Sub(claim.Seen) <= ttl {
			continue
		}
		delete(r.claims, prefix)
		withdrawn = append(withdrawn, prefix)
		r.rev++
	}
	if len(withdrawn) == 0 {
		return nil
	}
	// Longest-prefix-first, the order Snapshot publishes in, so the event
	// reads like the change it describes.
	slices.SortFunc(withdrawn, func(a, b netip.Prefix) int { return b.Bits() - a.Bits() })
	for _, prefix := range withdrawn {
		r.report("a claim on %s stopped being re-asserted: the route is withdrawn", prefix)
	}
	return withdrawn
}

// AddStatic injects a route the hub's own configuration asked for. spec is
// "192.168.50.0/24", "192.168.50.0/24 via 10.10.100.9" or
// "192.168.50.0/24 via 10.10.100.9 allow=peerA,peerB".
//
// An injected route outranks every dynamic claim on the same prefix, and is
// never displaced by one: it is the answer an operator gave deliberately, and a
// spoke that claimed the same CIDR afterwards does not get to overrule it. It
// is still not beyond the members — a via naming an address no member holds is
// refused, because a route to nobody carries every packet addressed to it
// nowhere.
//
// A malformed spec is an error rather than an event, because it is the operator
// typing it, not a spoke misbehaving: the caller can report it against the
// config line that caused it.
func (r *rib) AddStatic(spec string) error {
	fields := strings.Fields(spec)
	if len(fields) == 0 {
		return fmt.Errorf("static route %q is empty: want \"cidr [via addr] [allow=keys]\"", spec)
	}
	prefix, err := netip.ParsePrefix(fields[0])
	if err != nil {
		return fmt.Errorf("static route %q: %v", spec, err)
	}
	prefix = prefix.Masked()

	// Parsed before the lock, resolved after it: the via is resolved against
	// the members SetMembers holds, so it is parsed here and looked up there
	// rather than the lock being held across a parse.
	var via netip.Addr
	var allow []string
	for i := 1; i < len(fields); i++ {
		switch {
		case fields[i] == "via":
			if i+1 == len(fields) {
				return fmt.Errorf("static route %q: \"via\" is named with no address", spec)
			}
			i++
			addr, err := netip.ParseAddr(fields[i])
			if err != nil {
				return fmt.Errorf("static route %q: via %q is not an IP address", spec, fields[i])
			}
			// Unmapped here, once, so the resolution below compares one spelling
			// of an address against another.
			via = addr.Unmap()
		case strings.HasPrefix(fields[i], "allow="):
			allow = splitKeys(fields[i][len("allow="):])
		default:
			return fmt.Errorf("static route %q: %q is not \"cidr [via addr] [allow=keys]\"", spec, fields[i])
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	claim := &lanClaim{Prefix: prefix, Origin: staticOrigin, Static: true, Allow: allow, Seen: r.now()}
	if via.IsValid() {
		key, ok := r.memberKey(via)
		if !ok {
			return fmt.Errorf("static route %q: via %s names no member of this network", spec, via)
		}
		claim.Via = key
	}

	if held, ok := r.claims[prefix]; ok && sameRoute(held, claim) {
		return nil
	}
	r.claims[prefix] = claim
	r.rev++
	return nil
}

// memberKey is the peer key holding a tun address. Its dual is memberIn, and
// the unmapping is the same for the same reason: the hub's membership and the
// hub's config may spell one address two ways, and a via that resolves to
// nothing would refuse a route an operator can see is correct.
func (r *rib) memberKey(addr netip.Addr) (string, bool) {
	for _, m := range r.members {
		member, err := netip.ParseAddr(strings.TrimSpace(m.IP))
		if err != nil {
			continue
		}
		if member.Unmap() == addr {
			return m.Key, true
		}
	}
	return "", false
}

// sameRoute reports whether held already says exactly what claim says, so that
// re-reading the hub's config — which happens on every start and on every save
// that touches the route list — does not publish a netview identical to the one
// spokes already hold.
func sameRoute(held, claim *lanClaim) bool {
	return held.Prefix == claim.Prefix && held.Origin == claim.Origin &&
		held.Static == claim.Static && held.Via == claim.Via &&
		slices.Equal(held.Allow, claim.Allow)
}

// Snapshot is the winners only: what a spoke is allowed to know. Same content
// means an unchanged Rev, so a caller can push on a rev change and nothing else.
//
// The claims come out longest-prefix-first, so a reader that takes the first
// match gets longest-prefix match without doing any arithmetic — and a static
// route comes before a dynamic one of the same length, because that is the
// order the arbitration that produced this snapshot already decided in.
func (r *rib) Snapshot() claimSet {
	r.mu.Lock()
	defer r.mu.Unlock()

	winners := make([]*lanClaim, 0, len(r.claims))
	for _, c := range r.claims {
		winners = append(winners, c)
	}
	// The last comparison is not cosmetic: a map iterates in a different order
	// every time, so without a total order two identical RIBs would produce two
	// different snapshots and every caller would see a change where there is
	// none.
	slices.SortFunc(winners, func(a, b *lanClaim) int {
		if a.Prefix.Bits() != b.Prefix.Bits() {
			return b.Prefix.Bits() - a.Prefix.Bits()
		}
		if a.Static != b.Static {
			if a.Static {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Prefix.String(), b.Prefix.String())
	})

	claims := make([]claimEntry, 0, len(winners))
	for _, c := range winners {
		claims = append(claims, claimEntry{
			Prefix: c.Prefix.String(),
			Origin: c.Origin,
			Allow:  slices.Clone(c.Allow),
		})
	}
	return claimSet{
		Hub:     r.hubID,
		Rev:     r.rev,
		Claims:  claims,
		Members: slices.Clone(r.members),
	}
}

// PrefixRoute is one winner in the shape x's SetPrefixRoutes takes: the peer
// key that reaches the prefix, and the members allowed to use it (empty = every
// member).
type PrefixRoute struct {
	Peer  string
	Allow []string
}

// Routes is the winners-only table, for the hub rather than for a spoke. It is
// the other half of Snapshot: the snapshot says which prefixes exist and to
// whom, and a spoke routes all of them to the hub; the hub itself has to know
// which peer carries each one, which is not in the snapshot at all — a
// claimEntry names the claiming peer, and for an injected route the peer that
// reaches the LAN is a different fact from the "static" the snapshot reports.
//
// So Peer is the Origin of a dynamic claim, and for a static route the member
// key its "via" resolved to. A static route written without a via has no Peer:
// it names a destination no member reaches, and saying so is better than
// naming a peer that carries it nowhere.
//
// Order is not meaningful in a map and none is needed — the consumer matches by
// longest prefix. The map and its slices are freshly allocated, so the caller
// owns what it gets and a table already handed to the handler cannot be edited
// under the handler's feet.
func (r *rib) Routes() map[netip.Prefix]PrefixRoute {
	r.mu.Lock()
	defer r.mu.Unlock()

	routes := make(map[netip.Prefix]PrefixRoute, len(r.claims))
	for prefix, c := range r.claims {
		peer := c.Origin
		if c.Static {
			peer = c.Via
		}
		routes[prefix] = PrefixRoute{Peer: peer, Allow: slices.Clone(c.Allow)}
	}
	return routes
}

// report records one refusal or one conflict in the hub's log. One line per
// occurrence, each naming the prefix and the origin involved, because this is
// the only account the operator gets of a claim that did not take — the spoke
// is told nothing, deliberately, so that a refused spoke has nothing to retry.
//
// The sink is called under the lock. It is a log line and an entry in the hub's
// event history, neither of which blocks, and the ordering matters: this event
// describes a decision the caller has just made and will not make again.
func (r *rib) report(format string, args ...any) {
	if r.events == nil {
		return
	}
	r.events(format, args...)
}

// splitKeys reads an allow list: comma-separated peer keys, empties dropped so
// that a trailing comma is not a member named by nothing. Empty means every
// member, which is why an "allow=" with nothing after it is an open list rather
// than a list naming no one — an allow list naming nobody would refuse every
// packet, which is not what anyone who wrote it meant.
//
// No trimming here: the tokenizer that reaches this has already split on
// whitespace, so "allow=peerA, peerB" is two fields and the second is refused by
// the parse as a field it does not recognize.
func splitKeys(spec string) []string {
	var out []string
	for _, key := range strings.Split(spec, ",") {
		if key != "" {
			out = append(out, key)
		}
	}
	return out
}
