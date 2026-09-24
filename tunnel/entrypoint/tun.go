package entrypoint

import (
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
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

	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	cclose chan struct{}
	err    error
	mu     sync.RWMutex
}

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
// client mode (the chain, with no forwarder, is what selects client mode). The
// keepalive is what registers this spoke's address with the hub's tun server —
// without it the hub has no route back, so it is the difference between a
// working link and a silent one-way one.
func (s *tunEntryPoint) init() error {
	svc := &xconfig.ServiceConfig{
		Name: s.opts.Name,
		// The tun listener binds no socket: the address only labels the service.
		Addr: ":0",
		Handler: &xconfig.HandlerConfig{
			Type:  "tun",
			Chain: s.opts.Name,
			Metadata: map[string]any{
				"keepalive": s.opts.Keepalive,
				"ttl":       s.opts.TTL,
			},
		},
		Listener: &xconfig.ListenerConfig{
			Type: "tun",
			Metadata: map[string]any{
				"name":   s.opts.DeviceName,
				"mtu":    s.opts.MTU,
				"net":    s.opts.Net,
				"routes": s.opts.Routes,
				"dns":    s.opts.DNS,
			},
		},
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
	node.Metadata = map[string]any{"p2p": s.provider}

	s.config = &xconfig.Config{
		Services: []*xconfig.ServiceConfig{svc},
		Chains:   []*xconfig.ChainConfig{chCfg},
	}
	return nil
}

func (s *tunEntryPoint) Run() (err error) {
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
	host, err := tunnel.AcquireP2PHost()
	if err != nil {
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
		}
	}()

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
	if err := host.Punch(s.peer); err != nil {
		slog.Warn("tun entrypoint: punch peer", "peer", s.peer, "err", err)
	}

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
		}

		svcCfg := s.config.Services[0]
		lnLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "tun"})
		ln := tunlistener.NewListener(
			listener.AddrOption(svcCfg.Addr),
			listener.LoggerOption(lnLogger),
			listener.StatsOption(pStats),
		)
		// Init creates the device (and blocks until it exists), so a failure
		// here fails the whole Run — nothing half-started is left behind.
		if err = ln.Init(mdx.NewMetadata(svcCfg.Listener.Metadata)); err != nil {
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
	s.forward, s.acquired = forward, true
	s.mu.Unlock()
	started = true // the reference and the provider are Close's now

	go func() {
		serveErr := forward.Serve()
		if serveErr != nil {
			log.Error("tun entrypoint serve error", "err", serveErr)
		}
		s.setErr(serveErr)
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
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	s.mu.Lock()
	forward, acquired := s.forward, s.acquired
	s.forward, s.acquired = nil, false
	s.mu.Unlock()

	var err error
	if forward != nil {
		err = forward.Close()
	}
	registry.P2PRegistry().Unregister(s.provider)
	if acquired {
		tunnel.ReleaseP2PHost()
	}
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
