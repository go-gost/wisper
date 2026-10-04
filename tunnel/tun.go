package tunnel

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	// Both x packages are named "tun": the aliases keep them apart.
	tunhandler "github.com/go-gost/x/handler/tun"
	tunlistener "github.com/go-gost/x/listener/tun"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

// A tun hub accounts for its spokes' traffic exactly as a p2p tunnel does: the
// API fills a hub's allowlist rows from the same two interfaces.
var (
	_ PeerStatsReporter = (*tunTunnel)(nil)
	_ PeerStatsUpdater  = (*tunTunnel)(nil)
	_ PeerSetter        = (*tunTunnel)(nil)
	_ PeerIPSetter      = (*tunTunnel)(nil)
)

// tunTunnel is the hub half of a virtual network: it holds a tun device and
// serves it to its spokes over p2p. There is no socket here — a spoke's
// datagrams arrive as a stream on the process-wide p2p host, keyed by the
// peer key in its allowlist, and the hub writes them straight to the device.
// The allowlist is therefore the whole of this hub's configuration: it is
// both what admits a spoke and what names it.
//
// The device is created by this process, so the hub needs root (or
// CAP_NET_ADMIN) — the trade the maintainer accepted for a UI-driven setup.
// See docs/tun-integration.md.
type tunTunnel struct {
	opts    Options
	forward service.Service
	// ln is the p2p route, released on Close; device is the tun listener, kept
	// only so it can be closed there — its accepted conn is the device the hub
	// runs on, so it is not closed on the way out of Run.
	ln     net.Listener
	device listener.Listener
	// authz is the hub's address assignment, held so a save can replace it in
	// place. It is nil until Run builds it — there is no hub to allocate for
	// before that — and Close clears it with ln and device, because both mean the
	// same thing here: nothing is running.
	authz         *spokeAuthorizer
	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	// peerStats is the last per-peer snapshot the stats task took, with rates;
	// peerStatsAt times the window those rates average over. Same fields, and
	// the same helpers, as a p2p tunnel's: a hub's spokes arrive on the same
	// peer route, so they are counted the same way.
	peerStats   []PeerStat
	peerStatsAt time.Time

	cclose chan struct{}

	err error
	mu  sync.RWMutex
}

// NewTunTunnel creates a tun hub: the node that holds the device.
func NewTunTunnel(opts ...Option) Tunnel {
	var options Options
	for _, opt := range opts {
		opt(&options)
	}

	if options.ID == "" {
		options.ID = uuid.NewString()
	}
	if options.Name == "" {
		v := md5.Sum([]byte(options.ID))
		options.Name = hex.EncodeToString(v[:8])
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}

	return &tunTunnel{
		opts:   options,
		cclose: make(chan struct{}),
	}
}

func (s *tunTunnel) ID() string   { return s.opts.ID }
func (s *tunTunnel) Type() string { return TunTunnel }
func (s *tunTunnel) Name() string { return s.opts.Name }

// Endpoint is empty: a p2p hub binds nothing. It is kept on the interface so
// the config round trip still carries whatever was set — an endpoint that
// survived from the socket form is what init refuses.
func (s *tunTunnel) Endpoint() string { return s.opts.Endpoint }

// Entrypoint is the device's address. A tun hub has no public URL, so the
// device address is what identifies it on screen.
func (s *tunTunnel) Entrypoint() string { return s.opts.Net }

// Options is the hub's configuration, read under the lock for the same reason
// p2pTunnel's is: a save rewrites the allowlist and the assignment in place, and
// Options is how the API reads them. Without the lock a concurrent save tore the
// copy, and a torn copy of a multi-word struct is not a slightly stale read — it
// is one response carrying an allowlist and an assignment from different instants,
// and a peers-PUT that read such a copy deciding what "unchanged" meant, then
// saving the result as the new truth.
//
// That read is the one the API makes on the way into settlePeerIPs, where it
// supplies the value a row with no address keeps, so the race was on this
// feature's critical path and not merely somewhere in the background.
//
// It fixes the torn read only. The window between SetPeers and SetPeerIPs — a
// hub that briefly has the new routes and the old assignment — is the documented
// ordered save and is not a locking problem; it closes only when both have been
// applied, and the order is what keeps a spoke from holding a route whose
// address has been withdrawn.
func (s *tunTunnel) Options() Options {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.opts
}
func (s *tunTunnel) Favorite(b bool)  { s.favorite.Store(b) }
func (s *tunTunnel) IsFavorite() bool { return s.favorite.Load() }

// listenerMetadata is the tun listener's device configuration. Keys follow
// x/listener/tun: name, mtu, net, routes, dns. Empty values are ignored by the
// listener, so an unset optional field is simply absent behavior.
// listenerMetadata is the tun device's configuration.
//
// Routes and DNS are deliberately absent, and must stay absent. Both are
// client-side: they tell a device whose traffic is being captured what to
// capture and which resolver to use. A hub captures nothing, so it needs
// neither — and on a hub running with host networking, both are actively
// dangerous, because the device is created in the host's network namespace:
//
//   - routes go through netlink.RouteReplace, so naming a subnet the host
//     already routes (its own LAN, say) does not add a route beside it, it
//     replaces it. On a machine that is its network's gateway, that points the
//     whole LAN at the tunnel and takes the network down.
//   - dns is applied with `resolvectl dns <dev> ...`, which would register the
//     hub's device as a resolver on the host.
//
// A hub's peers are reached over p2p streams and share the device's own
// subnet, so the address in "net" is the only route it needs.
func (s *tunTunnel) listenerMetadata() map[string]any {
	return map[string]any{
		"name": s.opts.DeviceName,
		"mtu":  s.opts.MTU,
		"net":  s.opts.Net,
	}
}

// handlerMetadata is the keepalive configuration carried over from the socket
// form. A p2p hub does not read it — x's p2p handler takes no metadata at all,
// because a peer announces its departure by closing its stream instead of by
// going silent — but the keepalive and ttl options are still in the config
// file until the UI drops them, and this keeps what it says in one place.
func (s *tunTunnel) handlerMetadata() map[string]any {
	return map[string]any{
		"keepalive": s.opts.Keepalive,
		"ttl":       s.opts.TTL,
	}
}

// init describes the hub: the device it creates, and the p2p route its spokes'
// datagrams arrive on. It binds no address — a spoke's datagrams reach the
// device over the p2p host directly, so there is no socket and no endpoint for
// a paired p2p tunnel to repeat.
func (s *tunTunnel) init() error {
	// An endpoint left over from the socket form is refused rather than
	// ignored: silently dropping it would run a hub in a different shape than
	// its config says, and the paired p2p tunnel that repeated the address would
	// be pointing at a socket nobody binds.
	if strings.TrimSpace(s.opts.Endpoint) != "" {
		return fmt.Errorf("tun hub no longer binds an address (endpoint %q): clear the endpoint — the peer allowlist is the whole configuration", s.opts.Endpoint)
	}
	// An empty allowlist is valid: the list is managed on the peers page, which
	// the create form never reaches, so a hub starts with no spokes and its
	// first one is added there. The hub then runs and discards every packet,
	// which is expected rather than broken — the API records an event at
	// creation and on every save that leaves the list empty, and the detail
	// page says so in place. p2pTunnel has always taken an empty list this way.
	return nil
}

// newAuthorizer builds the hub's address assignment: the whole of the admission
// policy a spoke is checked against, since a spoke's stream arrives on a route the
// p2p allowlist already decided to give it. A spoke may then hold exactly the
// addresses its own row names, and nothing else — the hub's route table is
// last-writer-wins per address, so a claim that is not checked takes a neighbour's
// route with nothing anywhere saying so.
//
// The rows are filtered first (honorablePeerIPs) and what survives is both what the
// authorizer holds and what the hub saves, so a hub started from a hand-edited file
// lands on exactly the assignment a save through the API would have written.
//
// The identity handed to it is s.opts.ID — the hub's — because that is what
// event.Record files a refusal under: a peer key names an object the operator has
// no page for, and a route's name is not an object either. A hub built without one
// has no assignment loaded, so every claim is refused as unknown rather than
// passing unchecked.
func (s *tunTunnel) newAuthorizer(log logger.Logger) *spokeAuthorizer {
	s.mu.RLock()
	rows := s.opts.PeerIPs
	s.mu.RUnlock()

	kept := s.honorablePeerIPs(rows, log)
	// The filtered rows go back into the options, not only into the authorizer:
	// spokeAuthorizer.set is written on the invariant that what is saved and what is
	// authorizing are one fact, and a hub that kept a dropped row in its config would
	// break it on the next SaveConfig — showing the operator a row the hub is not
	// honouring.
	s.mu.Lock()
	s.opts.PeerIPs = kept
	s.mu.Unlock()

	return newSpokeAuthorizer(s.opts.ID, kept, log)
}

// honorablePeerIPs returns the rows of peerIPs this hub can honour. It is the only
// place that answer is computed, and both chokepoints — the authorizer Run builds
// and SetPeerIPs — apply the result to s.opts.PeerIPs and to the authorizer alike.
//
// It is two independent steps, and keeping them independent is the point:
//
//  1. Can this hub route the address at all? A row that does not parse names no
//     address to judge and could never authorize a claim either. A row naming an
//     address outside every subnet the hub's device is on, or naming the hub's own
//     address, is one the hub cannot honour: the listener adds a connected route for
//     the hub's own net and nothing else, and a hub deliberately asks for no routes
//     at all, so a spoke holding such an address registers, believes it holds it, and
//     is unreachable at it — leaving a route-table entry behind for the hub's own
//     address case, where x's self-loop guard turns the spoke away at registration
//     with a message pointing nowhere near the cause.
//
//     The subnet and own-address halves of this step need the hub's subnets, so they
//     are asked only of a hub that has any; a row that does not parse is dropped on
//     every hub, since it names no address to be inside or outside of.
//     A hub with no net configured is one broken hub rather than a set of broken
//     rows: there is no subnet for an address to be inside or outside of, so the
//     question has no answer, and refusing every row would turn one missing "net"
//     into a hub that authorizes nothing at all — a worse outcome than the
//     misconfiguration, and one that reads as a broken allowlist. The mistake is
//     already reported where it is made: assignPeerIPs refuses to allocate on such a
//     hub and this error names the missing subnet to whoever typed an address.
//
//  2. Is this address claimed twice? Two rows naming one address need no prefixes
//     to detect — it is a comparison among the rows themselves — and it is the case
//     this feature exists to prevent, because the hub's route table is
//     last-writer-wins per address: the second spoke to register silently takes the
//     first one's route and its traffic goes to the wrong device. It is asked on
//     every hub, subnet or not, because in a no-subnet config that address is still
//     routable and the theft is still silent.
//
//     Both rows go, not one of them: the tie cannot be broken by iteration order (Go
//     randomizes map order), and a hub that picked a winner would give a different
//     answer on the next save, which is a network that changes under a running
//     config.
//
// Only rows step 1 left are counted, and that is the order the two run in: a row that
// is not in force cannot take a route from anyone, so it must not be able to cost a
// sound row its address either.
//
// Every row dropped is dropped whole — never emptied, never turned into an error.
// Dropping is the answer spokeAuthorizer.set already gives a row that does not
// parse: the peer is absent, so every claim from it is refused as not in the hub's
// assignment. Emptying the row instead would be the present-with-nil failure — a
// typo would come back as "this spoke may claim nothing" and lock the spoke out with
// a reason pointing nowhere. Failing the save instead would be worse still: one bad
// row in the file would make every later save fail until the operator hand-edited the
// yaml, where failing closed per row needs nothing.
func (s *tunTunnel) honorablePeerIPs(peerIPs map[string]string, log logger.Logger) map[string]string {
	// s.opts.Net and s.opts.ID are set at construction and never written again, so
	// they are read here without the lock the assignment itself needs.
	prefixes, self := parseHubNets(s.opts.Net)

	type row struct {
		peer  string
		spec  string
		addrs []netip.Addr
	}
	rows := make([]row, 0, len(peerIPs))
	for peer, spec := range peerIPs {
		addrs, ok := parsePeerIPs(spec)
		if !ok {
			s.dropPeerIP(peer, fmt.Sprintf("its row %q is not a comma-separated list of IP addresses", spec), log)
			continue
		}
		// Unmapped before anything else looks at it: a row written ::ffff:10.10.0.2
		// names the same address as 10.10.0.2, and neither a prefix's Contains nor
		// the hub's own-address list would match it as it stands. The value kept is
		// the operator's own text, byte for byte.
		addrs = unmapAll(addrs)

		// Step 1, asked only of a hub that has a subnet to ask about. Every reason
		// the row has, in the row's own order: one row, one event, so an operator
		// fixing the row sees everything wrong with it at once.
		if len(prefixes) > 0 {
			var why []string
			for _, addr := range distinctAddrs(addrs) {
				if err := validatePeerIP(addr.String(), prefixes, self); err != nil {
					why = append(why, err.Error())
				}
			}
			if len(why) > 0 {
				s.dropPeerIP(peer, strings.Join(why, "; "), log)
				continue
			}
		}
		rows = append(rows, row{peer: peer, spec: spec, addrs: addrs})
	}

	// Step 2, on every hub: how many row slots name each address, including twice in
	// one row — which is the same ambiguity, since no claim can ever match such a row
	// (the authorizer's sweep consumes, so the second copy finds its address already
	// taken) and a row that can authorize nothing is one the hub cannot honour.
	claims := make(map[netip.Addr]int, len(rows))
	for _, r := range rows {
		for _, addr := range r.addrs {
			claims[addr]++
		}
	}

	kept := make(map[string]string, len(rows))
	for _, r := range rows {
		var why []string
		for _, addr := range distinctAddrs(r.addrs) {
			if n := claims[addr]; n > 1 {
				why = append(why, fmt.Sprintf("%s appears %d times in the assignment, so the hub cannot tell which row owns it", addr, n))
			}
		}
		if len(why) > 0 {
			s.dropPeerIP(r.peer, strings.Join(why, "; "), log)
			continue
		}
		// An empty row survives both steps: it is the state that means "this spoke
		// may claim nothing", and it is what allocation fills.
		kept[r.peer] = r.spec
	}
	return kept
}

// dropPeerIP records one row the hub cannot honour. One format and both sinks, and
// under the hub's ID, for the same reason spokeAuthorizer.refuse files a refusal
// there: the operator who has to act on this is looking at the hub's page, and a
// peer key names an object wisper has none for.
//
// log may be nil — a save has no logger of its own, and the event is the record the
// operator reads either way — which is why the sink is guarded rather than assumed.
func (s *tunTunnel) dropPeerIP(peer, reason string, log logger.Logger) {
	format := "spoke %q dropped from the hub's address assignment: %s"
	args := []any{peer, reason}
	if log != nil {
		log.Warnf(format, args...)
	}
	event.Record(s.opts.ID, event.LevelWarn, format, args...)
}

// distinctAddrs keeps a row's first occurrence of each address, in the row's own
// order. A row naming the same address twice is one thing to say out loud, and an
// event that repeated the same sentence twice would read as two problems where there
// is one.
//
// Identity is the unmapped address, so one address written two ways — 10.10.0.2
// and ::ffff:10.10.0.2 — is one address rather than two, which is what a row means
// by naming it twice. The spelling kept is the one the row was written with rather
// than a canonical one: the caller that validates rows hands it to validatePeerIP,
// and feeding it the operator's own text is what leaves validatePeerIP's own unmap
// to decide a row written in the ::ffff: form instead of having this function
// quietly answer for it. Every other caller has already unmapped (see unmapAll),
// for which Unmap is the identity, so the two spellings are the same value there.
func distinctAddrs(addrs []netip.Addr) []netip.Addr {
	seen := make(map[netip.Addr]struct{}, len(addrs))
	out := make([]netip.Addr, 0, len(addrs))
	for _, addr := range addrs {
		canonical := addr.Unmap()
		if _, ok := seen[canonical]; ok {
			continue
		}
		seen[canonical] = struct{}{}
		out = append(out, addr)
	}
	return out
}

func (s *tunTunnel) Run() (err error) {
	if s.IsClosed() {
		return ErrTunnelClosed
	}

	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

	if err = s.init(); err != nil {
		return
	}

	log := logger.Default().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
	})

	// Stats carry over across a restart, like the other tunnel types.
	pStats := xstats.NewStats(false)
	{
		prev := s.Stats() // read under lock
		pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
		pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
		pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
		pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
	}

	// The device is the only privileged part, and it is unchanged: the listener
	// creates it and hands back one conn carrying the parsed device config on
	// its context, which is where the hub reads its own addresses.
	deviceLn := tunlistener.NewListener(
		listener.LoggerOption(log.WithFields(map[string]any{"kind": "listener", "listener": "tun"})),
		listener.StatsOption(pStats),
	)
	// Init creates the device (and blocks until it exists), so a failure here
	// is a failure to start — no listener is left behind. The listener must be
	// closed on the way out: its own loop retries a device creation that cannot
	// succeed (a missing privilege, say) — one line per second, forever, for an
	// object that is about to be discarded.
	if err = deviceLn.Init(mdx.NewMetadata(s.listenerMetadata())); err != nil {
		deviceLn.Close()
		return
	}
	// The device conn is the handler's, not the service's: the service accepts
	// the spokes' streams. Take it from the device listener's queue here, so a
	// failed start below never leaves a privileged device behind.
	deviceConn, err := deviceLn.Accept()
	if err != nil {
		deviceLn.Close()
		return
	}

	// The spokes: one datagram stream each, straight off the p2p host. A failed
	// route registration closes the device again — the device has no other
	// consumer and nothing to serve.
	//
	// The manager owns the host (identity, DERP connection, accept loop); this
	// hub holds one reference and its routes on it, so the routes are only
	// reached while something is listening. A peer has its own p2p tunnel on
	// the host, so this is usually already running — but a hub can be the only
	// p2p tunnel on the host, and then this is what starts it.
	if _, err = p2pHost.acquire(context.Background()); err != nil {
		deviceLn.Close()
		return
	}
	// A disabled spoke keeps its place in the allowlist but gets no route, the
	// same as a p2p tunnel's disabled peer. The route is built from the
	// options, which is also what SetPeers swaps, so there is one allowlist
	// and a save cannot leave the two out of step.
	enabled := enabledPeers(s.opts.Peers, s.opts.PeerDisabled)
	ln, err := p2pHost.register(enabled)
	if err != nil {
		p2pHost.release()
		deviceLn.Close()
		return
	}
	// register hands the route back as a net.Listener; it is always a
	// *peerListener, the gost listener the service needs.
	peerLn := ln.(*peerListener)
	// The route is a plain listener, not an x listener, so it does not wrap
	// accepted conns itself: hand it the stats the service reports.
	peerLn.setStats(pStats)

	// A p2p hub has no TTL and no keepalive setting: a peer announces its
	// departure by closing its stream, so nothing here is parsed from metadata.
	handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tun"})
	// The hub is the allocator of record; see newAuthorizer. A hub with no
	// assignment refuses every claim, which is the safe default — the alternative
	// is a last-writer-wins route table with nothing checking what went into it.
	authz := s.newAuthorizer(log)
	h := tunhandler.NewP2PHandler(deviceConn, authz,
		handler.LoggerOption(handlerLogger),
		handler.ServiceOption(s.opts.Name),
	)
	if err = h.Init(mdx.NewMetadata(nil)); err != nil {
		p2pHost.unregister(peerLn)
		p2pHost.release()
		deviceLn.Close()
		return
	}

	s.forward = xservice.NewService(s.opts.Name, peerLn, h,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)

	s.mu.Lock()
	s.ln, s.device, s.authz = peerLn, deviceLn, authz
	forward := s.forward
	s.mu.Unlock()

	go func() {
		// The service is read once, here, rather than off the field: Close sets
		// s.forward to nil, and a full-tunnel PUT calls it on this very tunnel
		// while this goroutine is starting. What is served is the service built
		// above either way — Close closes that same object, which is the point.
		serveErr := forward.Serve()
		if CleanStop(serveErr) {
			log.Info("tun tunnel stopped")
			s.setErr(nil)
		} else {
			log.Errorf("tun tunnel stopped with error: %v", serveErr)
			s.setErr(serveErr)
		}
	}()

	return nil
}

// Status is the underlying gost service's status, read under the lock for the same
// reason p2pTunnel's is: Close clears the field, and this is reached from the API's
// response builder on the way past a PUT that is doing exactly that.
func (s *tunTunnel) Status() *xservice.Status {
	s.mu.RLock()
	forward := s.forward
	s.mu.RUnlock()

	if ss, _ := forward.(ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

func (s *tunTunnel) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *tunTunnel) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *tunTunnel) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *tunTunnel) SetStatsBaseline(baseline cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = baseline
}

// PeerStats reports each allowlisted spoke's traffic, in allowlist order —
// the same report a p2p tunnel gives, over the same peer route, so a hub's
// allowlist rows carry traffic like every other tunnel's. Nil while the hub is
// not running (there is no route to count on).
func (s *tunTunnel) PeerStats() []PeerStat {
	return peerStatSnapshot(&s.mu, &s.ln, &s.opts.Peers, &s.peerStats)
}

// UpdatePeerStats snapshots the spokes' counters, deriving each rate from the
// previous snapshot. The stats task calls it through PeerStatsUpdater, the
// way it calls SetStats.
func (s *tunTunnel) UpdatePeerStats() {
	updatePeerStatSnapshot(&s.mu, &s.ln, &s.peerStats, &s.peerStatsAt, &s.opts.Peers)
}

// SetPeers applies a new spoke allowlist in place, exactly as a p2p tunnel
// applies a new peer list: the process-wide host's routes are reconciled
// (all-or-nothing) and the options are swapped, so the service, its peer route
// and its tun device all keep running and a live spoke's stream is not cut.
// What a p2p tunnel never had to give up, a hub does: the device conn belongs
// to a handler the service owns, so tearing the hub down and running it again
// would drop the device and re-create it — which needs the privilege the hub
// was started with and would take the network down mid-save. Reconciling the
// routes in place keeps both. ctx carries the action id of the save, named in
// the warm-up's p2p seam log line.
func (s *tunTunnel) SetPeers(ctx context.Context, peers []string, aliases map[string]string, disabled []string) error {
	if s.IsClosed() {
		return ErrTunnelClosed
	}

	s.mu.RLock()
	pl, _ := s.ln.(*peerListener)
	s.mu.RUnlock()
	if pl == nil {
		return errors.New("tun hub is not running")
	}

	normalized := NormalizePeerAliases(peers, aliases)
	off := NormalizePeerDisabled(peers, disabled)
	enabled := enabledPeers(peers, off)
	if err := p2pHost.reconcile(pl, enabled); err != nil {
		return err
	}

	s.mu.Lock()
	s.opts.Peers = peers
	s.opts.PeerAliases = normalized
	s.opts.PeerDisabled = off
	s.mu.Unlock()

	// A spoke added here must get the same head start a spoke configured at Run
	// time does, or its row would stay blank until it happens to dial in.
	p2pHost.warmPeers(ctx, enabled)
	return nil
}

// SetPeerIPs replaces the hub's address assignment. ctx is accepted for the
// same reason SetPeers takes one — a save may be named in a log line — and is
// not otherwise used here.
//
// It cannot fail once it has decided to apply: the assignment is parsed into a
// fresh map and the pointer to it is swapped, and neither step touches the
// network. That is why it is safe to call after SetPeers has reconciled the
// routes. Reconciling first and assigning second is the order that matters —
// the reverse would leave a spoke holding a route whose assignment had been
// withdrawn, and a claim on that route would be refused with no route to fall
// back on.
//
// The rows are filtered before they are applied (honorablePeerIPs), and what
// survives is both what the options carry and what the authorizer holds — so what a
// save writes and what authorizes are the same rows. A row naming an address outside
// the hub's subnets, the hub's own address, or an address another row names too, is
// dropped and warned about here, at the moment the operator can act on it, rather
// than refused later from a spoke that simply will not register. The save itself
// still cannot fail on one: failing it would make every later save fail until the
// file was hand-edited, where failing closed per row needs nothing.
func (s *tunTunnel) SetPeerIPs(ctx context.Context, peerIPs map[string]string) error {
	if s.IsClosed() {
		return ErrTunnelClosed
	}
	s.mu.RLock()
	authz := s.authz
	s.mu.RUnlock()
	if authz == nil {
		return errors.New("tun hub is not running")
	}

	// Filtered outside the lock: a drop records an event, and holding the options
	// lock across that would put the config's writer behind the event store for no
	// reason. The rows are the caller's map, and only the kept ones are stored, so
	// neither the caller's map nor the one saved here is ever edited in place.
	kept := s.honorablePeerIPs(peerIPs, nil)
	s.mu.Lock()
	s.opts.PeerIPs = kept
	s.mu.Unlock()
	authz.set(kept)
	return nil
}

func (s *tunTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	s.mu.Lock()
	forward, ln, device := s.forward, s.ln, s.device
	s.forward, s.ln, s.device, s.authz = nil, nil, nil, nil
	s.mu.Unlock()

	var err error
	if forward != nil {
		err = forward.Close()
	}
	// ln is set exactly when Run claimed the routes, so a hub that never got
	// that far releases nothing here.
	if ln != nil {
		p2pHost.unregister(ln)
		p2pHost.release()
	}
	// The service closes the handler, and the handler closes the device conn —
	// which is also the listener's, so the listener has nothing left to release.
	if device != nil {
		_ = device.Close()
	}
	return err
}

func (s *tunTunnel) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *tunTunnel) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *tunTunnel) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}
