package tunnel

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/auth"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
	xauth "github.com/go-gost/x/auth"
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
	ln            net.Listener
	device        listener.Listener
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

func (s *tunTunnel) Options() Options { return s.opts }
func (s *tunTunnel) Favorite(b bool)  { s.favorite.Store(b) }
func (s *tunTunnel) IsFavorite() bool { return s.favorite.Load() }

// listenerMetadata is the tun listener's device configuration. Keys follow
// x/listener/tun: name, mtu, net, routes, dns. Empty values are ignored by the
// listener, so an unset optional field is simply absent behavior.
func (s *tunTunnel) listenerMetadata() map[string]any {
	return map[string]any{
		"name":   s.opts.DeviceName,
		"mtu":    s.opts.MTU,
		"net":    s.opts.Net,
		"routes": s.opts.Routes,
		"dns":    s.opts.DNS,
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
	// An empty allowlist runs and discards every packet: the routes are the
	// admission, so with none there is nothing to admit.
	if len(s.opts.Peers) == 0 {
		return errors.New("tun hub requires at least one allowlisted peer")
	}

	return nil
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

	var auther auth.Authenticator
	if s.opts.Username != "" {
		auther = xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{s.opts.Username: s.opts.Password}))
	}

	// A p2p hub has no TTL and no keepalive setting: a peer announces its
	// departure by closing its stream, so nothing here is parsed from metadata.
	handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tun"})
	h := tunhandler.NewP2PHandler(deviceConn, auther,
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
	s.ln, s.device = peerLn, deviceLn
	s.mu.Unlock()

	go func() {
		serveErr := s.forward.Serve()
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

func (s *tunTunnel) Status() *xservice.Status {
	if ss, _ := s.forward.(ServiceStatus); ss != nil {
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
	s.forward, s.ln, s.device = nil, nil, nil
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
