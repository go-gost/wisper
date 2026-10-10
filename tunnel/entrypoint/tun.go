package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	xchain "github.com/go-gost/x/chain"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	tunhandler "github.com/go-gost/x/handler/tun"
	tunlistener "github.com/go-gost/x/listener/tun"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	"github.com/go-gost/x/registry"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

const (
	// vpnDeviceWait is how long an Android start waits for the VpnService's
	// device. The app establishes the VPN after the backend is up, and a
	// restored entrypoint starts with it, so they race.
	vpnDeviceWait = 10 * time.Second
)

// tunEntryPoint is the spoke half of a virtual network: it owns a tun device
// whose IP packets ride the shared p2p host's datagram tunnel to a hub. The
// hub holds the device the network hangs off (a tun server), so this side dials
// and the hub answers; between two entrypoints it is a point-to-point link.
type tunEntryPoint struct {
	opts     tunnel.Options
	peer     string
	provider string // p2p registry name, unique per entrypoint
	config   *xconfig.Config
	forward  service.Service
	acquired bool // holds one reference on the shared p2p host

	// shareCleanup removes the NAT rules init applied for a shared LAN. Nil
	// unless the kernel path was used (the userspace fallback has no rules),
	// and cleared by teardownShare as it runs, so it runs exactly once —
	// the same shape as the hub's shareCleanup.
	shareCleanup func()

	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	cclose    chan struct{}
	closeOnce sync.Once
	err       error
	mu        sync.RWMutex
}

// The spoke's two host-touching share steps are package vars so a test can
// reason about the wiring without a host: probing the kernel reads and writes
// /proc and the PATH, and applying the rules shells out to iptables.
var (
	probeKernel     = tunnel.ProbeShareKernel
	applySpokeShare = tunnel.SetupSpokeShare
)

// NewTunEntryPoint creates a tun entrypoint: a device whose traffic exits
// through the shared p2p host to the peer's public key.
func NewTunEntryPoint(opts ...tunnel.Option) EntryPoint {
	var options tunnel.Options
	for _, opt := range opts {
		opt(&options)
	}

	if options.ID == "" {
		options.ID = uuid.NewString()
	}
	if options.Name == "" {
		options.Name = "tun-ep-" + options.ID
		if len(options.ID) > 8 {
			options.Name = "tun-ep-" + options.ID[:8]
		}
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}

	return &tunEntryPoint{
		opts:     options,
		peer:     options.Peer,
		provider: "tun-ep-" + options.ID,
		cclose:   make(chan struct{}),
	}
}

func (s *tunEntryPoint) ID() string   { return s.opts.ID }
func (s *tunEntryPoint) Type() string { return TunEntryPoint }
func (s *tunEntryPoint) Name() string { return s.opts.Name }

// Endpoint is the "public side" value — here the hub's base64 public key, the
// counterpart of a tunnel's public URL.
func (s *tunEntryPoint) Endpoint() string { return s.peer }

// Entrypoint is the device address. A tun entrypoint binds no local socket, so
// the device address is what identifies it (and what the other side sees).
func (s *tunEntryPoint) Entrypoint() string { return s.opts.Net }

func (s *tunEntryPoint) Options() tunnel.Options { return s.opts }
func (s *tunEntryPoint) Favorite(b bool)         { s.favorite.Store(b) }
func (s *tunEntryPoint) IsFavorite() bool        { return s.favorite.Load() }

// init builds the service description: a tun listener over a tun handler in
// client mode (the chain, with no forwarder, is what selects client mode).
//
// The handler carries no keepalive or ttl. Both would be inert here: this
// entrypoint reaches its hub over p2p and nothing else (the peer key is
// required and this side dials out), the handshake that registers this
// device's address is sent either way, and a hub's route table has no TTL to
// refresh — a p2p peer announces that it has left by closing its stream. The
// options remain on the entrypoint because the udp one uses them.
func (s *tunEntryPoint) init() error {
	// No explicit routes means this device's own subnet: the hub registers
	// the routes (not the net) for direct peer delivery, and without this
	// default a spoke would be reachable but reach nothing back. A Net that
	// is empty or has no mask parses to nothing, so routes stays empty —
	// the listener validates it the same way it validates an explicit one.
	routes := strings.TrimSpace(s.opts.Routes)
	if routes == "" {
		if _, ipNet, err := net.ParseCIDR(strings.TrimSpace(s.opts.Net)); err == nil {
			routes = ipNet.String()
		}
	}

	svc := &xconfig.ServiceConfig{
		Name: s.opts.Name,
		// The tun listener binds no socket: the address only labels the service.
		Addr: ":0",
		Handler: &xconfig.HandlerConfig{
			Type:  "tun",
			Chain: s.opts.Name,
			Metadata: map[string]any{
				"probe": s.opts.Probe,
			},
		},
		Listener: &xconfig.ListenerConfig{
			Type: "tun",
			Metadata: map[string]any{
				"name":   s.opts.DeviceName,
				"mtu":    s.opts.MTU,
				"net":    s.opts.Net,
				"routes": routes,
				"dns":    s.opts.DNS,
			},
		},
	}

	// Android: the device is a VpnService's, created and configured on the Java
	// side, and its fd reaches us outside the config. Each device asks for one
	// when it is built (so a rebuilt VPN or a restarted entrypoint gets a live
	// descriptor), and waits rather than failing: the app can only establish
	// the VPN once the backend — and this entrypoint — is already running.
	if runtime.GOOS == "android" {
		svc.Listener.Metadata["fd"] = func() int {
			return tunnel.WaitTunFD(vpnDeviceWait)
		}
	}

	// Patch the tunnel chain into a p2p chain: the node dials the peer's public
	// key through the embedded host's tunnel (metadata.p2p selects the
	// provider), and the "forward" connector hands the tunnel conn straight to
	// the target — the peer decides the outlet. The dialer is udp, so the host
	// gives this link a datagram tunnel instead of a byte stream.
	chCfg := tunnel.ChainConfig(s.opts.ID, s.opts.Name, s.opts.RecordMode)
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = s.peer
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "udp"}
	// p2p.network "ip" is not a third transport: it is the datagram link the
	// "udp" dialer already asks for, marked session-scoped on the p2p host, so
	// the host ends the link when the hub's peer session is lost and this side
	// re-dials — which resends the address registration the hub routes by. The
	// "udp" link stays transparent; only this tun link is session-scoped.
	node.Metadata = map[string]any{"p2p": s.provider, "p2p.network": "ip"}

	// Sharing a LAN is host-level NAT: the same rules a hub applies, with the
	// roles swapped (masquerade from the virtual subnet into the LAN, and no
	// route — the LAN is directly connected). A malformed share_lan fails the
	// start here, exactly as a hub's does, rather than at the first packet:
	// a typo would otherwise silently share nothing. Both steps below touch
	// the host, so both are package seams.
	if lans, err := tunnel.ParseShareLANNets(s.opts.ShareLAN); err != nil {
		return fmt.Errorf("tun entrypoint share_lan %q is not a comma-separated list of CIDRs: %v", s.opts.ShareLAN, err)
	} else if len(lans) > 0 {
		// A pinned kernel mode that cannot run is a start failure, never a
		// silent downgrade: the operator asked for the kernel and must be
		// told it is unavailable. Auto degrades to userspace and says so.
		effective, cleanup, err := applySpokeShare(s.opts.Net, lans, tunnel.NormalizeShareMode(s.opts.ShareMode), probeKernel())
		if err != nil {
			return err
		}
		s.mu.Lock()
		s.shareCleanup = cleanup
		s.mu.Unlock()

		// Auto's downgrade is the one case that must never be silent: ping
		// works through the kernel and dies in userspace, and without this a
		// LAN that stops pinging reads as the network breaking for no
		// reason. It is read the way the hub reads it (setupShareLAN's
		// downgraded flag): auto, resolved to userspace.
		userspace := effective == tunnel.ShareUserspace
		downgraded := userspace && tunnel.NormalizeShareMode(s.opts.ShareMode) == tunnel.ShareAuto
		switch {
		case effective == tunnel.ShareKernel:
			slog.Info("tun entrypoint: sharing LAN via kernel NAT",
				"entrypoint", s.opts.Name, "lan", s.opts.ShareLAN)
			event.Record(s.ID(), event.LevelInfo, "sharing LAN %s via kernel NAT", s.opts.ShareLAN)
		case downgraded:
			slog.Warn("tun entrypoint: kernel NAT unavailable, sharing LAN via userspace TCP/UDP: ping will not reach the LAN",
				"entrypoint", s.opts.Name, "lan", s.opts.ShareLAN)
			event.Record(s.ID(), event.LevelWarn,
				"kernel NAT unavailable, sharing LAN %s via userspace TCP/UDP: ping will not reach the LAN", s.opts.ShareLAN)
		case userspace:
			slog.Info("tun entrypoint: sharing LAN via userspace TCP/UDP: ping will not reach the LAN",
				"entrypoint", s.opts.Name, "lan", s.opts.ShareLAN)
			event.Record(s.ID(), event.LevelInfo,
				"sharing LAN %s via userspace TCP/UDP: ping will not reach the LAN", s.opts.ShareLAN)
		}

		if userspace {
			// The engine must run the chain through the userspace shim: a
			// plain "forward" connector hands LAN packets to a kernel that
			// drops them, with nothing anywhere saying why.
			node.Connector = &xconfig.ConnectorConfig{
				Type: "tun-share",
				Metadata: map[string]any{
					"lans": tunnel.ShareLANSpec(lans),
					"mtu":  s.opts.MTU,
				},
			}
		}
	}

	s.config = &xconfig.Config{
		Services: []*xconfig.ServiceConfig{svc},
		Chains:   []*xconfig.ChainConfig{chCfg},
	}
	return nil
}

// teardownShare removes whatever the share setup applied, exactly once. The
// field is cleared before the teardown runs, so a stop that races a second
// stop — or a start that failed halfway — cannot remove a rule twice, and a
// Close that never started anything does nothing.
func (s *tunEntryPoint) teardownShare() {
	s.mu.Lock()
	cleanup := s.shareCleanup
	s.shareCleanup = nil
	s.mu.Unlock()

	if cleanup != nil {
		cleanup()
	}
}

func (s *tunEntryPoint) Run() error { return s.RunContext(context.Background()) }

// RunContext is Run carrying the caller's action id: the shared host's
// acquisition (Listen) and the peer's punch name it in their p2p seam log
// lines, so a start that came from the UI can be joined with the p2p work it
// set in motion. Run is this with no action, for the config-load and restart
// paths (an Android restore starts from a background goroutine, where the id is
// still only ever read for a log field).
func (s *tunEntryPoint) RunContext(ctx context.Context) (err error) {
	if s.IsClosed() {
		return ErrEntryPointClosed
	}

	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

	if s.peer == "" {
		return errors.New("tun entrypoint requires a peer public key")
	}

	if err = s.init(); err != nil {
		return
	}

	// The identity is process-wide: take a reference on the shared host. A
	// failed relay connection is not fatal: the engine retries in the
	// background and the entrypoint keeps running, so it is logged.
	host, err := tunnel.AcquireP2PHost(ctx)
	if err != nil {
		// init already applied the share rules and nothing below has been
		// set up to unwind them, so this is where they come off.
		s.teardownShare()
		return
	}
	// Until the service is wired, Run owns the reference and the provider
	// registration; afterwards Close gives them back. A failure from here on
	// rolls both back so a dropped object cannot leak them.
	started := false
	defer func() {
		if !started {
			registry.P2PRegistry().Unregister(s.provider)
			tunnel.ReleaseP2PHost()
			tunnel.ReleaseTunDevice(s.opts.ID)
			// The share setup ran in init, before the host was taken, so the
			// same rollback has to reach it.
			s.teardownShare()
		}
	}()

	// One tun entrypoint at a time on Android: the app has a single VPN device,
	// and every device built from its fd reads the same packets, so a second
	// entrypoint would take them from the first instead of adding a link. The
	// web API checks the same thing before it answers a start.
	if runtime.GOOS == "android" {
		if owner, ok := tunnel.ClaimTunDevice(s.opts.ID, s.opts.Name); !ok {
			return fmt.Errorf("tun device is in use by entrypoint %q: stop it first", owner)
		}
	}

	// Register the provider before parsing the chain: the chain node resolves
	// metadata.p2p by name at parse time. The Unregister clears a stale
	// registration left by a previous Run in this process.
	registry.P2PRegistry().Unregister(s.provider)
	if err = registry.P2PRegistry().Register(s.provider, host); err != nil {
		return
	}

	log := p2pLog().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
	})

	// The peer is known up front and this side is the one that dials out, so
	// bring its path up and punch now: the direct path is being arranged (and
	// visible in the status) before the first packet. Punch failures are
	// logged, never fatal.
	if err := host.PunchContext(ctx, s.peer); err != nil {
		slog.Warn("tun entrypoint: punch peer", "peer", s.peer, "err", err)
		event.Record(s.ID(), event.LevelWarn, "punch %s failed: %v", s.peer, err)
	}

	// The control channel is the spoke's half of LAN routing: it claims this
	// spoke's share_lan at the hub and installs every netview the hub
	// approves into the router the tun listener resolves by name. It runs for
	// every spoke, sharing a LAN or not — a spoke with no share_lan still
	// needs the hub-approved routes back. Never fatal by construction: a
	// channel that cannot open is a spoke that tunnels exactly as it did
	// before LAN routing existed.
	StartNetview(ctx, host, s.peer, s.opts.ShareLAN, s.provider, log)

	var forward service.Service
	{
		var ch chain.Chainer
		ch, err = chain_parser.ParseChain(s.config.Chains[0], log)
		if err != nil {
			log.Error(err)
			return
		}

		pStats := xstats.NewStats(false)
		{
			prev := s.Stats()
			pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
			pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
			pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
			pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
			pStats.Add(xstats.KindProbeSent, int64(prev.ProbeSent))
			pStats.Add(xstats.KindProbeAcked, int64(prev.ProbeAcked))
		}

		s.config.Services[0].Handler.Metadata["probeReport"] = func(sentDelta, ackedDelta uint64) {
			pStats.Add(xstats.KindProbeSent, int64(sentDelta))
			pStats.Add(xstats.KindProbeAcked, int64(ackedDelta))
		}

		svcCfg := s.config.Services[0]
		lnLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "tun"})
		ln := tunlistener.NewListener(
			listener.AddrOption(svcCfg.Addr),
			listener.LoggerOption(lnLogger),
			listener.StatsOption(pStats),
		)
		// Init creates the device (and blocks until it exists), so a failure
		// here fails the whole Run. The listener must be closed on the way out:
		// its own loop retries a device creation that cannot succeed (a missing
		// privilege, say) — one line per second, forever, for an object that is
		// about to be discarded.
		if err = ln.Init(mdx.NewMetadata(svcCfg.Listener.Metadata)); err != nil {
			ln.Close()
			return
		}

		handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tun"})
		// The chain (and no forwarder hop) is the client-mode switch: the
		// device's packets go out through the chain node, which is the peer.
		h := tunhandler.NewHandler(
			handler.RouterOption(xchain.NewRouter(
				chain.ChainRouterOption(ch),
				chain.LoggerRouterOption(handlerLogger),
			)),
			handler.LoggerOption(handlerLogger),
		)
		if err = h.Init(mdx.NewMetadata(svcCfg.Handler.Metadata)); err != nil {
			return
		}

		forward = xservice.NewService(s.opts.Name, ln, h,
			xservice.LoggerOption(log),
			xservice.StatsOption(pStats),
		)
	}

	s.mu.Lock()
	// A restored Android entrypoint is started off the startup path, so Close
	// can land while this Run is still waiting for its device. Under this lock
	// is the only place that can be told apart: Close closes cclose before it
	// takes the lock, so a Run that sees it here must not publish its service —
	// nothing would ever close it.
	closed := s.IsClosed()
	if !closed {
		s.forward, s.acquired = forward, true
	}
	s.mu.Unlock()

	if closed {
		_ = forward.Close()
		return ErrEntryPointClosed // the deferred rollback releases the rest
	}

	started = true // the reference and the provider are Close's now

	go func() {
		serveErr := forward.Serve()
		if tunnel.CleanStop(serveErr) {
			log.Info("tun entrypoint stopped")
			s.setErr(nil)
		} else {
			log.Errorf("tun entrypoint stopped with error: %v", serveErr)
			s.setErr(serveErr)
		}
	}()

	return nil
}

func (s *tunEntryPoint) Status() *xservice.Status {
	s.mu.RLock()
	forward := s.forward
	s.mu.RUnlock()

	if ss, _ := forward.(tunnel.ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

func (s *tunEntryPoint) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *tunEntryPoint) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *tunEntryPoint) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *tunEntryPoint) SetStatsBaseline(baseline cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = baseline
}

// Close stops the service (which closes the device), unregisters the p2p
// provider and gives the shared host reference back. It is idempotent; the
// shared identity file is kept so stop/start keeps the same key.
func (s *tunEntryPoint) Close() error {
	var err error
	s.closeOnce.Do(func() {
		close(s.cclose)

		s.mu.Lock()
		forward, acquired := s.forward, s.acquired
		s.forward, s.acquired = nil, false
		s.mu.Unlock()

		if forward != nil {
			err = forward.Close()
		}
		// The NAT rules go here: the service is stopped, so nothing still
		// needs them, and the field is cleared as it runs so a repeat cannot
		// delete a rule twice. A start that never applied any holds nil.
		s.teardownShare()
		// Only the first Close may touch the shared registry: a replacement
		// reuses the name (the ID survives an update), and Unregister closes
		// the value it finds, so a repeat call would take the successor's p2p
		// host down with the name.
		registry.P2PRegistry().Unregister(s.provider)
		if acquired {
			tunnel.ReleaseP2PHost()
		}
		// The device is free for the next tun entrypoint; a no-op when this one
		// never held it (another platform, or a start that was refused).
		tunnel.ReleaseTunDevice(s.opts.ID)
	})
	return err
}

func (s *tunEntryPoint) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *tunEntryPoint) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *tunEntryPoint) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}
