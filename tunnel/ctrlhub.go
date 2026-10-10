package tunnel

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	tunhandler "github.com/go-gost/x/handler/tun"
	xstats "github.com/go-gost/x/observer/stats"

	"github.com/go-gost/wisper/event"
)

const (
	// controlWriteTimeout bounds one netview write to one spoke. A stream
	// that cannot take its netview inside it is closed — the spoke reconnects
	// and re-sends its claim — so one slow peer never holds the others'.
	controlWriteTimeout = 5 * time.Second

	// controlPeekTimeout bounds how long dispatch waits for an inbound stream
	// on a hub route to identify itself before sending it down the tun path
	// it was headed for anyway. It is the only place a spoke is asked to
	// speak first, and the deadline is what stops that question from becoming
	// a stall on the host's accept loop: a stream that says nothing inside it
	// is delivered unread to the service, exactly as before.
	controlPeekTimeout = 500 * time.Millisecond
)

// prefixSink is the one method the hub needs from its handler: x's tun p2p
// handler is the only implementation, and it is reached by shape because
// NewP2PHandler hands back a core handler.Handler. The interface is what lets
// the hub be tested against a stand-in, and what keeps a change to x's
// handler surface a compile error here rather than a hub that silently
// installs nothing.
type prefixSink interface {
	SetPrefixRoutes(routes map[netip.Prefix]tunhandler.PrefixRoute)
}

// controlHub is the hub side of the LAN-routing control channel: one RIB, one
// control stream per spoke, and the prefix table it pushes into the handler.
//
// It owns no policy of its own. Which claims may exist is the RIB's decision
// (approval and conflict), which streams exist is the p2p host's decision
// (allowlist and shape), and which packets take which route is x's. What this
// adds is the wiring: claims in, netviews out, and the hub's own table kept
// equal to what the spokes were told.
//
// A hub whose control channel never opens is not broken: Register failing, a
// spoke refusing the stream, or both mean that spoke reaches every member
// exactly as it does today.
type controlHub struct {
	hubID string
	rib   *rib
	sink  prefixSink
	log   logger.Logger

	mu sync.Mutex
	// peers holds one entry per spoke that has a control stream or is
	// expected to open one. The entry carries the stream's conn, so
	// publishing writes to it, and the rev it last received, so a fresh
	// stream gets the current netview even when nothing has changed.
	peers map[string]*controlPeer
	// publishedRev is the rev last installed into the sink, so a settle that
	// changed nothing does not reinstall the same table.
	publishedRev uint64
	// installed is what is in the sink's table right now — every prefix mapped
	// to the spoke that claimed it — so the counters can say what changed and
	// the events page can still name who a route belonged to once it is gone.
	installed map[netip.Prefix]string
	closed    bool
	done      chan struct{}
	closeOnce sync.Once

	// counter is where the hub's LAN accounting lands: x's stats object by
	// shape. It is optional — a hub with no stats object counts nowhere rather
	// than panicking — and it is set from Run, which holds the shared stats
	// the API reads.
	counter statsCounter

	// refMu guards refusals, the run's window on the claims the hub turned
	// down. It is a separate lock from mu, and deliberately the innermost one:
	// the RIB calls the refusal hook while holding its own lock, so anything
	// taken here must never take the RIB's (or the hub's) back. LanState copies
	// the journal out under it and lets it go, so a reader never holds a lock
	// the RIB is waiting on.
	refMu    sync.Mutex
	refusals []LanRefusal

	// now is where the clock comes from, the same one the RIB was built with:
	// a refusal recorded and the claim it lost to have to agree about when.
	// It is injected rather than read here so that wiring stays in one place,
	// and a test that ever needs a fixed time has somewhere to put it.
	now func() time.Time
}

// statsKind is the kind of LAN event being counted: x's kinds (KindLanRouted
// and its siblings) are the values.
type statsKind = stats.Kind

// statsCounter is the one method the hub needs from the stats object: count an
// event of a kind. It is satisfied by x's Stats, and by a test's counter.
type statsCounter interface {
	Add(kind statsKind, n int64)
}

// SetCounter gives the hub somewhere to count what it does. It is called from
// Run, which owns the shared stats the API reads; a hub with no counter counts
// nowhere, which is a test shape and nothing else.
func (ch *controlHub) SetCounter(c statsCounter) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	ch.counter = c
}

func (ch *controlHub) count(kind statsKind, n int64) {
	ch.mu.Lock()
	counter := ch.counter
	ch.mu.Unlock()
	if counter != nil && n > 0 {
		counter.Add(kind, n)
	}
}

// controlPeer is one spoke's slot: the channel its next control stream arrives
// on, the stream currently held, and what that stream has been told.
type controlPeer struct {
	inbound chan net.Conn
	conn    net.Conn
	sent    uint64
	// stopped ends the goroutine serving this slot, which is what makes
	// Unregister release it rather than parking it for the life of the hub.
	stopped chan struct{}
	once    sync.Once
}

// newControlPeer is one spoke's slot: one waiting stream and one live stream.
func newControlPeer() *controlPeer {
	return &controlPeer{
		inbound: make(chan net.Conn, 1),
		stopped: make(chan struct{}),
	}
}

// newControlHub builds the hub side of the control channel. allow is the
// lan_allow policy (per spoke, the supernets it may claim inside); a spoke
// with no row claims nothing. sink is the handler the winners are installed
// into, and may be nil — a hub with no handler installs nowhere, which is a
// test shape and nothing else.
//
// The RIB's event sink is the hub's log: every refusal and every conflict is a
// line naming the prefix and the spokes involved, because the operator reading
// the hub's history is the only one who can act on a claim that did not take.
// The typed half of a refusal goes to the journal, which is also the hub's one
// place for counting it.
func newControlHub(hubID string, allow map[string][]netip.Prefix, sink prefixSink, log logger.Logger) *controlHub {
	// One clock for the RIB's TTL and the journal's timestamps, so a refusal
	// recorded and the claim it lost to carry the same notion of now.
	now := time.Now
	ch := &controlHub{
		hubID:     hubID,
		sink:      sink,
		log:       log,
		peers:     make(map[string]*controlPeer),
		installed: make(map[netip.Prefix]string),
		done:      make(chan struct{}),
		now:       now,
	}
	ch.rib = newRIB(hubID, allow, func(format string, args ...any) {
		if log != nil {
			log.Warnf(format, args...)
		}
	}, ch.refuse, now)

	// The withdrawal sweep runs for the life of the hub. It is the one
	// operation that removes a route nobody withdrew: a claim is live only
	// while its owner re-asserts it, so a spoke that stopped talking exits
	// the network within a TTL instead of blackholing it forever.
	go ch.sweep()

	return ch
}

// sweep drops claims whose owner stopped re-asserting them and republishes
// whatever it took. A sweep that withdrew nothing publishes nothing: the rev
// is what moves a spoke, and an unchanged rev costs no stream a write.
func (ch *controlHub) sweep() {
	ticker := time.NewTicker(claimSweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if withdrawn := ch.rib.Withdraw(claimTTL); len(withdrawn) > 0 {
				ch.publish()
			}
		case <-ch.done:
			return
		}
	}
}

// Register opens the control channel for a spoke whose tun stream the hub has
// just accepted. It is called per stream, so it is idempotent: a spoke that
// reconnected keeps the slot and the stream it already holds, and a second
// call for a key that is already registered does nothing.
//
// It fails only for a key that names no spoke or a closed hub, and neither is
// fatal to the spoke: it gets no control channel, which means it holds no LAN
// routes and behaves exactly as it does today.
func (ch *controlHub) Register(peer string) error {
	if peer == "" {
		return errors.New("control: a spoke with no peer key has no control channel")
	}
	ch.mu.Lock()
	if ch.closed {
		ch.mu.Unlock()
		return errors.New("control: the hub is closed")
	}
	if _, ok := ch.peers[peer]; ok {
		ch.mu.Unlock()
		return nil
	}
	p := newControlPeer()
	ch.peers[peer] = p
	ch.mu.Unlock()

	go ch.serve(peer, p)
	return nil
}

// Unregister forgets a spoke's slot and closes the stream it holds. It is
// called for a peer dropped from the hub's allowlist, so a removed spoke's
// control stream does not outlive its tun route.
func (ch *controlHub) Unregister(peer string) {
	ch.mu.Lock()
	p := ch.peers[peer]
	if p == nil {
		ch.mu.Unlock()
		return
	}
	delete(ch.peers, peer)
	conn := p.conn
	ch.mu.Unlock()

	// Stopping the slot is what releases its goroutine: without it the reader
	// parks forever on a channel nothing will send to again, one goroutine per
	// removed spoke for the rest of the hub's life.
	p.once.Do(func() { close(p.stopped) })
	if conn != nil {
		_ = conn.Close()
	}
}

// SetMembers replaces the membership the RIB reasons about: the members a
// claim may not swallow, and the addresses an injected route's "via" resolves
// against. A membership that changed advances the rev, so this publishes.
func (ch *controlHub) SetMembers(members []memberEntry) {
	ch.rib.SetMembers(members)
	ch.publish()
}

// SetStaticRoutes injects the hub's own routes from its config, before any
// claim. A refused spec is reported and the rest still land: one typo in a
// route list should not cost the operator every other route on the hub.
func (ch *controlHub) SetStaticRoutes(specs []string) error {
	var errs []error
	for _, spec := range specs {
		if strings.TrimSpace(spec) == "" {
			continue
		}
		if err := ch.rib.AddStatic(spec); err != nil {
			errs = append(errs, err)
		}
	}
	if err := errors.Join(errs...); err != nil {
		return err
	}
	ch.publish()
	return nil
}

// Snapshot is the winners as a spoke may see them, for the hub's own
// reporting (the doctor's routes view) — the same content every netview
// carries.
func (ch *controlHub) Snapshot() claimSet { return ch.rib.Snapshot() }

// LanRefusal is one claim the hub turned down: the CIDR the spoke asked for,
// the spoke that asked, which of the RIB's reasons said no, the sentence the
// operator reads, and when. It is a record of a decision, not of a state — a
// refusal is never revoked, and its prefix is never in the route table.
type LanRefusal struct {
	Prefix string
	Peer   string
	Reason string
	Detail string
	At     time.Time
}

// refusalJournalCap is how many refusals a run remembers. A bound and not a
// setting: the journal is a window on what just went wrong, and a hub that has
// been misconfigured for an hour should not grow for as long as it lived.
const refusalJournalCap = 16

// LanState is the hub's LAN routing the way an operator reads it: both owners
// of every route, because a route's claimer and its carrier are different
// things. A claim names the spoke that asked for the prefix; a route names the
// member that reaches it — the same peer for a dynamic claim, the "via" member
// for an injected one — and an operator debugging a LAN that is not working
// needs both halves to say which they are looking at.
type LanState struct {
	// Routes is what the hub installed: every route in force, with both of
	// its owners.
	Routes []LanRoute
	// Refused is what the hub turned down, newest first: the claims a spoke
	// was never told about, which is the one half of this state an operator
	// can get nowhere else.
	Refused []LanRefusal
}

// LanRoute is one installed route: the CIDR, the spoke that claimed it (or
// staticOrigin for the hub's own config), the member that carries it, and the
// members allowed to use it.
type LanRoute struct {
	Prefix string
	Origin string
	Peer   string
	Allow  []string
}

// PeerClaims is the per-spoke view of the same routes: what each spoke holds,
// keyed by peer key. It is a spoke's row in the doctor — the LAN column — and
// a hub's own injected route is deliberately absent, because it is not a
// spoke's claim and an operator reading a spoke's row wants what that spoke
// asked for.
func (l LanState) PeerClaims() map[string][]string {
	out := make(map[string][]string, len(l.Routes))
	for _, r := range l.Routes {
		if r.Origin == staticOrigin {
			continue
		}
		out[r.Origin] = append(out[r.Origin], r.Prefix)
	}
	return out
}

// LanState is what the hub installed, as the doctor and the API read it. Both
// lists come off one RIB read, so they can never disagree about what is in
// force. A hub whose control channel never opened has installed nothing.
func (ch *controlHub) LanState() LanState {
	routes := ch.rib.Routes()
	snap := ch.rib.Snapshot()

	origins := make(map[string]string, len(snap.Claims))
	for _, c := range snap.Claims {
		origins[c.Prefix] = c.Origin
	}

	out := make([]LanRoute, 0, len(routes))
	for prefix, route := range routes {
		// A route whose Peer is empty is one the hub chose not to install
		// (installRoutes skips them, for the same reason), so it is not in
		// force and not shown.
		if route.Peer == "" {
			continue
		}
		out = append(out, LanRoute{
			Prefix: prefix.String(),
			Origin: origins[prefix.String()],
			Peer:   route.Peer,
			Allow:  route.Allow,
		})
	}
	// One order, so the list a reader sees is the list the next reader sees and
	// a UI can render without re-sorting.
	slices.SortFunc(out, func(a, b LanRoute) int { return strings.Compare(a.Prefix, b.Prefix) })
	return LanState{Routes: out, Refused: ch.refusedSnapshot()}
}

// refusedSnapshot is the journal as a copy, newest first. It is read under the
// journal's own lock and that lock is released before the caller has anything
// — which is the point of it being a leaf: the RIB refuses claims under its
// lock, and a reader holding the journal's lock across a render would be a
// second path into the same mutex.
func (ch *controlHub) refusedSnapshot() []LanRefusal {
	ch.refMu.Lock()
	defer ch.refMu.Unlock()
	return slices.Clone(ch.refusals)
}

// refuse is the RIB's typed hook and the hub's one place for counting a
// refusal. It runs under the RIB's lock, so it does three things that cannot
// block and takes no lock the RIB holds: the journal (a copy of 16 structs),
// the counter, and the hub's event history.
//
// The counting lives here rather than beside ApplyClaim because this is the
// decision: applyClaim's other way of counting them — the difference between
// what a spoke asked for and what it got — counted each refusal a second time,
// and could only ever see the ones it happened to measure against.
func (ch *controlHub) refuse(origin string, prefix netip.Prefix, code, detail string) {
	ch.journal(LanRefusal{
		Prefix: prefix.String(),
		Peer:   origin,
		Reason: code,
		Detail: detail,
		At:     ch.now(),
	})
	ch.count(xstats.KindLanDenied, 1)
	// Same line the hub's log gets, filed under the tunnel: the log is what
	// scrolls past, the event page is what an operator reads back later.
	event.Record(ch.hubID, event.LevelWarn, "spoke %q may not claim %s: %s", origin, prefix, detail)
}

// journal puts one refusal at the front of the window and drops whatever fell
// off the back. Newest first, so a reader gets the order an operator wants
// without a sort, and the drop is the tail rather than a shift.
func (ch *controlHub) journal(r LanRefusal) {
	ch.refMu.Lock()
	defer ch.refMu.Unlock()

	ch.refusals = append([]LanRefusal{r}, ch.refusals...)
	if len(ch.refusals) > refusalJournalCap {
		ch.refusals = ch.refusals[:refusalJournalCap]
	}
}

// deliver hands the hub the spoke end of one accepted control stream, with
// the magic already consumed. A peer with no slot gets one: a control stream
// may arrive before its spoke's tun stream is accepted, and refusing it would
// misroute the spoke's claims into the tun handler as garbage.
func (ch *controlHub) deliver(peer string, conn net.Conn) {
	if peer == "" {
		_ = conn.Close()
		return
	}
	ch.mu.Lock()
	if ch.closed {
		ch.mu.Unlock()
		_ = conn.Close()
		return
	}
	p := ch.peers[peer]
	if p == nil {
		p = newControlPeer()
		ch.peers[peer] = p
		ch.mu.Unlock()
		go ch.serve(peer, p)
	} else {
		ch.mu.Unlock()
	}

	// Never wait: this runs on the p2p host's accept loop, which is one
	// goroutine serving every inbound stream for every tunnel. A send that
	// waited for a slot would let one peer stall the whole host, so a stream
	// that finds no room is closed on the spot and its spoke redials — which
	// is exactly what it does for a stream that was refused anyway.
	select {
	case p.inbound <- conn:
	case <-ch.done:
		_ = conn.Close()
	default:
		_ = conn.Close()
	}
}

// serve holds one spoke's control streams for as long as the hub lives. It
// takes the next stream whenever one arrives — a reconnect hands the claim
// afresh, which is how the hub learns the spoke survived — and ends only when
// the hub closes.
func (ch *controlHub) serve(peer string, p *controlPeer) {
	for {
		select {
		case conn := <-p.inbound:
			ch.runStream(peer, p, conn)
		case <-p.stopped:
			// The slot was dropped (the spoke is no longer in the allowlist),
			// so whatever streams are still queued for it are nobody's.
			for {
				select {
				case queued := <-p.inbound:
					_ = queued.Close()
				default:
					return
				}
			}
		case <-ch.done:
			return
		}
	}
}

// runStream reads one spoke's claims and answers every rev change with a
// netview. A refused frame is dropped and the stream kept (forward-compat,
// the rule readMessage documents); a stream that ended is simply gone, and the
// spoke's next session re-sends everything.
func (ch *controlHub) runStream(peer string, p *controlPeer, conn net.Conn) {
	defer func() { _ = conn.Close() }()

	ch.mu.Lock()
	p.conn = conn
	ch.mu.Unlock()

	for {
		_, claim, err := readMessage(conn)
		if err != nil {
			if !streamDead(err) && !ch.isClosed() {
				// The frame was refused, not the stream: keep reading. A peer
				// that floods refusals supplies the bytes each refusal reads,
				// so this waits on it rather than spinning.
				ch.warnf("control: spoke %q sent a refused frame: %v", peer, err)
				continue
			}
			return
		}
		// A hub sends no claims, so a claim frame is the only message a spoke
		// has for it. A netview from a spoke is dropped rather than answered:
		// a spoke that sees one has its own channel's failure to report.
		if claim.Type != ctrlTypeClaim {
			continue
		}
		ch.applyClaim(peer, claim)
		ch.publish()
	}
}

// applyClaim hands one spoke's add/drop to the RIB. A prefix that does not
// parse is an event, not a silence: the spoke was configured with something
// that names no network, and the operator gets to see which.
//
// The RIB's answer is not read: a refused claim is counted and journaled where
// the refusal is decided (see refuse), not measured here against what the spoke
// asked for. Counting it both ways counted every refusal twice.
func (ch *controlHub) applyClaim(peer string, m claimMessage) {
	add := parseClaimPrefixes(ch, peer, m.Add)
	drop := parseClaimPrefixes(ch, peer, m.Drop)
	if len(add) == 0 && len(drop) == 0 {
		return
	}
	ch.rib.ApplyClaim(peer, add, drop)
}

// publish pushes the RIB's winners out: the prefix table into the handler, and
// one netview to every stream that has not seen this rev. Both halves are
// per-rev, so a settle that changed nothing touches nothing.
func (ch *controlHub) publish() {
	snap := ch.rib.Snapshot()

	ch.mu.Lock()
	install := snap.Rev != ch.publishedRev
	if install {
		ch.publishedRev = snap.Rev
	}
	targets := make([]net.Conn, 0, len(ch.peers))
	for _, p := range ch.peers {
		if p.conn == nil || p.sent == snap.Rev {
			continue
		}
		p.sent = snap.Rev
		targets = append(targets, p.conn)
	}
	ch.mu.Unlock()

	if install {
		ch.installRoutes()
	}
	for _, conn := range targets {
		if err := writeWithDeadline(conn, snap.message(), controlWriteTimeout); err != nil {
			// That stream alone: the spoke reconnects within a second and
			// re-sends its whole claim, so a write that times out costs a
			// refresh and nothing else.
			_ = conn.Close()
		}
	}
}

// installed is the set of prefixes a route map carries, mapped to the spoke each
// one is claimed by, so what changed can be counted and what left can be
// attributed to the spoke that held it.
func installed(routes map[netip.Prefix]tunhandler.PrefixRoute) map[netip.Prefix]string {
	out := make(map[netip.Prefix]string, len(routes))
	for prefix, route := range routes {
		out[prefix] = route.Peer
	}
	return out
}

// installRoutes copies the RIB's winners into the shape x takes. It skips a
// route whose Peer is empty — an injected route written without a "via" names
// a destination no member reaches, and installing it would have x write those
// packets to a peer that carries them nowhere.
func (ch *controlHub) installRoutes() {
	if ch.sink == nil {
		return
	}
	routes := ch.rib.Routes()
	out := make(map[netip.Prefix]tunhandler.PrefixRoute, len(routes))
	for prefix, route := range routes {
		if route.Peer == "" {
			continue
		}
		out[prefix] = tunhandler.PrefixRoute{Peer: route.Peer, Allow: route.Allow}
	}
	// Counted against what is installed rather than against the RIB, so the
	// two numbers describe the table an operator can see: a prefix that
	// appeared is a LAN routed for, one that left is a LAN withdrawn.
	var routed, withdrawn int
	for prefix, route := range out {
		if _, ok := ch.installed[prefix]; !ok {
			routed++
			// A spoke is told its own claims and nothing else, so the hub is
			// the only thing on the network that knows which spoke holds a
			// route. A line saying a LAN appeared therefore has to name that
			// spoke here or go nameless forever.
			event.Record(ch.hubID, event.LevelInfo, "LAN route %s installed (spoke %q)", prefix, route.Peer)
		}
	}
	for prefix, oldPeer := range ch.installed {
		if _, ok := out[prefix]; !ok {
			withdrawn++
			// The spoke that was holding it, read off the table being replaced:
			// why a route went (its claim expired, its spoke went quiet) is a
			// warn line the RIB already wrote, and all the operator has left to
			// match it against is who had lost the route.
			event.Record(ch.hubID, event.LevelInfo, "LAN route %s withdrawn (spoke %q)", prefix, oldPeer)
		}
	}
	ch.installed = installed(out)
	ch.count(xstats.KindLanRouted, int64(routed))
	ch.count(xstats.KindLanWithdrawn, int64(withdrawn))
	ch.sink.SetPrefixRoutes(out)
}

// message renders one revision as the wire message a spoke installs.
func (s claimSet) message() netviewMessage {
	return netviewMessage{
		Type:    ctrlTypeNetview,
		V:       ctrlVersion,
		Hub:     s.Hub,
		Rev:     s.Rev,
		Members: s.Members,
		Claims:  s.Claims,
	}
}

// Close forgets every spoke and closes every control stream. The RIB is left
// as it is: nothing reads it after the hub is gone, and a close is not a
// withdrawal.
func (ch *controlHub) Close() {
	ch.closeOnce.Do(func() {
		ch.mu.Lock()
		ch.closed = true
		conns := make([]net.Conn, 0, len(ch.peers))
		for _, p := range ch.peers {
			if p.conn != nil {
				conns = append(conns, p.conn)
			}
		}
		ch.mu.Unlock()

		for _, p := range ch.peers {
			p.once.Do(func() { close(p.stopped) })
		}
		close(ch.done)
		for _, conn := range conns {
			_ = conn.Close()
		}
	})
}

func (ch *controlHub) isClosed() bool {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	return ch.closed
}

func (ch *controlHub) warnf(format string, args ...any) {
	if ch.log != nil {
		ch.log.Warnf(format, args...)
	}
}

// parseClaimPrefixes reads the prefixes one claim message names. A token that
// does not parse is reported and skipped rather than failing the whole
// message: the rest of the spoke's claim is still what it intends.
func parseClaimPrefixes(ch *controlHub, peer string, specs []string) []netip.Prefix {
	out := make([]netip.Prefix, 0, len(specs))
	for _, spec := range specs {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(spec))
		if err != nil {
			ch.warnf("control: spoke %q claimed %q, which is not a CIDR", peer, spec)
			continue
		}
		out = append(out, prefix.Masked())
	}
	return out
}

// ParseLanAllow reads the lan_allow policy from its config form:
// whitespace- or comma-separated "key=cidr" rows, one or more per spoke.
//
// A key with an empty value is a spoke that may claim nothing — default-deny
// written out, which is a different state from a key that is absent and has to
// stay in the map, because the RIB's refusal message is what tells the two
// apart. Nothing at all is not an error: a hub with no policy claims nothing.
//
// A row that does not parse is an error rather than a dropped row, because a
// typo that silently vanished would leave an operator looking at a policy that
// is not the one they wrote.
func ParseLanAllow(spec string) (map[string][]netip.Prefix, error) {
	rows := make(map[string][]netip.Prefix)
	for _, row := range strings.FieldsFunc(spec, func(r rune) bool {
		return r == ',' || unicode.IsSpace(r)
	}) {
		key, value, ok := strings.Cut(row, "=")
		if !ok {
			return nil, fmt.Errorf("lan_allow row %q is not \"key=cidr\"", row)
		}
		key = strings.TrimSpace(key)
		if key == "" {
			return nil, fmt.Errorf("lan_allow row %q names no spoke", row)
		}
		if _, seen := rows[key]; !seen {
			rows[key] = nil
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			return nil, fmt.Errorf("lan_allow row %q: %v", row, err)
		}
		rows[key] = append(rows[key], prefix.Masked())
	}
	return rows, nil
}

// streamDead reports whether a read error means the conn is finished, as
// opposed to one frame being unreadable.
//
// readMessage returns one plain error for both — a length it refuses and a
// stream that ended — and the difference is the whole behavior here: a refused
// frame leaves the peer connected and usable (the plan's oversize case), while
// a finished stream ends the session. The transport errors are named
// explicitly; anything else is a refused frame the stream survives. A closed
// pipe is named last because net.Pipe spells it its own way, and treating it
// as a refused frame would spin a reader on a conn that can never return
// another byte.
func streamDead(err error) bool {
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.Is(err, io.ErrClosedPipe) ||
		errors.Is(err, net.ErrClosed) || errors.Is(err, os.ErrDeadlineExceeded) ||
		errors.Is(err, context.Canceled)
}

// consumeControlMagic reads the magic off an inbound stream and reports whether
// it matched. The bytes it read come back either way: a stream that did not
// announce itself replays them (see replayConn), so nothing a spoke sent
// before it was identified is lost.
func consumeControlMagic(conn net.Conn) (prefix []byte, ok bool) {
	_ = conn.SetReadDeadline(time.Now().Add(controlPeekTimeout))
	buf := make([]byte, len(ControlMagic))
	n, _ := io.ReadFull(conn, buf)
	// The deadline is cleared before the conn goes anywhere: a stream that was
	// peeked at and found to be a tun link must not inherit it.
	_ = conn.SetReadDeadline(time.Time{})
	return buf[:n], n == len(ControlMagic) && bytes.Equal(buf, ControlMagic)
}

// writeWithDeadline writes one control message under conn's write deadline, so
// a spoke that stopped reading cannot hold the hub's publish loop.
func writeWithDeadline(conn net.Conn, m netviewMessage, timeout time.Duration) error {
	_ = conn.SetWriteDeadline(time.Now().Add(timeout))
	defer func() { _ = conn.SetWriteDeadline(time.Time{}) }()
	return writeMessage(conn, m)
}

// dialControlForTest hands the hub one control stream the way dispatch does —
// the magic consumed from the stream first — and returns the hub end and the
// spoke end, which the test then writes frames to.
//
// The magic is written from inside, because the pipe blocks until the hub
// reads it: a caller could not write the opening bytes before it has the spoke
// end, and the peek would time out before the caller was even running. That is
// also what a real spoke does — RunControlChannel writes the magic first, on
// its own, before any message follows.
func (ch *controlHub) dialControlForTest(peer string) (net.Conn, net.Conn) {
	hub, spoke := net.Pipe()
	go func() { _, _ = spoke.Write(ControlMagic) }()
	if _, ok := consumeControlMagic(hub); !ok {
		_ = hub.Close()
		_ = spoke.Close()
		return hub, spoke
	}
	ch.deliver(peer, hub)
	return hub, spoke
}

// controlRoute is the route a hub's service accepts from, wrapped so a spoke's
// control channel is registered the moment its tun stream is accepted.
//
// It is a wrapper and not a per-conn hook because the service owns the accept
// loop: the hub has no other moment at which it learns a spoke is here. The two
// streams arrive independently — a spoke opens its control channel and its tun
// link in whichever order it likes — so the hub does not wait for a control
// stream to learn a spoke exists. The tun stream says so first, and Register
// only opens the slot that spoke's control stream will fill.
type controlRoute struct {
	*peerListener
	ch *controlHub
}

func (l *controlRoute) Accept() (net.Conn, error) {
	conn, err := l.peerListener.Accept()
	if err != nil {
		return nil, err
	}
	// A conn with no peer key names no spoke, and the hub has nothing to
	// register it against. The stream is still delivered: the service closes
	// it, exactly as it does for any conn it cannot route.
	if peer := peerOf(conn); peer != "" {
		if err := l.ch.Register(peer); err != nil {
			// Not fatal and not logged as one: the spoke gets no control
			// channel, which means it lives exactly as it does without one.
			l.ch.warnf("control: spoke %q: %v", peer, err)
		}
	}
	return conn, nil
}
