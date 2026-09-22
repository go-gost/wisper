package entrypoint

import (
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	xchain "github.com/go-gost/x/chain"
	"github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward" // chain node connector for p2p nodes
	_ "github.com/go-gost/x/dialer/tcp"        // chain node dialer for p2p nodes
	"github.com/go-gost/x/handler/forward/local"
	"github.com/go-gost/x/hop"
	"github.com/go-gost/x/listener/tcp"
	xlogger "github.com/go-gost/x/logger"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	"github.com/go-gost/x/registry"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

// p2pEntryPoint is the out-dial counterpart of the p2pTunnel: it listens on a
// local address and forwards every connection through the process-wide p2p
// host's tunnel to a peer identified by its base64 public key. The peer's own
// target is the outlet (no local admission — the key is the credential).
type p2pEntryPoint struct {
	opts     tunnel.Options
	peer     string
	provider string // p2p registry name, unique per entrypoint
	config   *config.Config
	forward  service.Service
	acquired bool // holds one reference on the shared p2p host

	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	cclose chan struct{}
	err    error
	mu     sync.RWMutex
}

// NewP2PEntryPoint creates a p2p entrypoint: a local TCP listener whose
// traffic exits through an embedded p2p host to the peer's public key.
func NewP2PEntryPoint(opts ...tunnel.Option) EntryPoint {
	var options tunnel.Options
	for _, opt := range opts {
		opt(&options)
	}

	if options.ID == "" {
		options.ID = uuid.NewString()
	}
	if options.Endpoint == "" {
		options.Endpoint = "127.0.0.1:8080"
	}
	if options.Name == "" {
		options.Name = "p2p-ep-" + options.ID
		if len(options.ID) > 8 {
			options.Name = "p2p-ep-" + options.ID[:8]
		}
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}

	return &p2pEntryPoint{
		opts:     options,
		peer:     options.Peer,
		provider: "p2p-ep-" + options.ID,
		cclose:   make(chan struct{}),
	}
}

func (s *p2pEntryPoint) ID() string   { return s.opts.ID }
func (s *p2pEntryPoint) Type() string { return P2PEntryPoint }
func (s *p2pEntryPoint) Name() string { return s.opts.Name }

// Endpoint is the "public side" value — here the remote peer's base64 public
// key, the counterpart of a tunnel's public URL.
func (s *p2pEntryPoint) Endpoint() string { return s.peer }

// Entrypoint is the local listen address (same convention as the tcp/udp
// entrypoints).
func (s *p2pEntryPoint) Entrypoint() string      { return s.opts.Endpoint }
func (s *p2pEntryPoint) Options() tunnel.Options { return s.opts }
func (s *p2pEntryPoint) Favorite(b bool)         { s.favorite.Store(b) }
func (s *p2pEntryPoint) IsFavorite() bool        { return s.favorite.Load() }

// p2pLog returns the process default logger, or a discarding one when none is
// set (unit tests run without config.Init).
func p2pLog() logger.Logger {
	if log := logger.Default(); log != nil {
		return log
	}
	return xlogger.NewLogger(xlogger.OutputOption(io.Discard))
}

func (s *p2pEntryPoint) init() error {
	tcpSvc := &config.ServiceConfig{
		Name: s.opts.Name,
		Addr: s.opts.Endpoint,
		Handler: &config.HandlerConfig{
			Type:  "tcp",
			Chain: s.opts.Name,
		},
		Listener: &config.ListenerConfig{
			Type: "tcp",
		},
		Forwarder: &config.ForwarderConfig{
			Nodes: []*config.ForwardNodeConfig{
				{
					Name: s.opts.Name,
					Addr: s.peer,
				},
			},
		},
	}

	// Patch the tunnel chain into a p2p chain: the node dials the peer's
	// public key through the embedded host's tunnel (metadata.p2p selects the
	// provider), and the "forward" connector hands the tunnel conn straight to
	// the target — the peer's own target routing decides the outlet.
	chCfg := tunnel.ChainConfig(s.opts.ID, s.opts.Name, s.opts.RecordMode)
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = s.peer
	node.Connector = &config.ConnectorConfig{Type: "forward"}
	node.Dialer = &config.DialerConfig{Type: "tcp"}
	node.Metadata = map[string]any{"p2p": s.provider}

	s.config = &config.Config{
		Services: []*config.ServiceConfig{tcpSvc},
		Chains:   []*config.ChainConfig{chCfg},
	}
	return nil
}

func (s *p2pEntryPoint) Run() (err error) {
	if s.IsClosed() {
		return ErrEntryPointClosed
	}
	if s.peer == "" {
		return errors.New("p2p entrypoint requires a peer public key")
	}

	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

	if err = s.init(); err != nil {
		return
	}

	// The identity is process-wide: take a reference on the shared host. A
	// failed relay connection is not fatal: the engine retries in the
	// background and the entrypoint keeps running, so the manager logs it
	// rather than failing the Run.
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
		ln := tcp.NewListener(
			listener.AddrOption(svcCfg.Addr),
			listener.LoggerOption(log.WithFields(map[string]any{"kind": "listener", "listener": "tcp"})),
			listener.StatsOption(pStats),
		)
		if err = ln.Init(mdx.NewMetadata(svcCfg.Listener.Metadata)); err != nil {
			return
		}

		handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tcp"})
		h := local.NewHandler(
			handler.RouterOption(xchain.NewRouter(
				chain.ChainRouterOption(ch),
				chain.LoggerRouterOption(handlerLogger),
			)),
			handler.LoggerOption(handlerLogger),
		)
		if err = h.Init(mdx.NewMetadata(svcCfg.Handler.Metadata)); err != nil {
			return
		}

		node := svcCfg.Forwarder.Nodes[0]
		if forwarder, ok := h.(handler.Forwarder); ok {
			forwarder.Forward(hop.NewHop(
				hop.NodeOption(chain.NewNode(node.Name, node.Addr)),
				hop.LoggerOption(log.WithFields(map[string]any{"kind": "hop"})),
			))
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
			log.Error("p2p entrypoint serve error", "err", serveErr)
		}
		s.setErr(serveErr)
	}()

	return nil
}

func (s *p2pEntryPoint) Status() *xservice.Status {
	s.mu.RLock()
	forward := s.forward
	s.mu.RUnlock()

	if ss, _ := forward.(tunnel.ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

func (s *p2pEntryPoint) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *p2pEntryPoint) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *p2pEntryPoint) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *p2pEntryPoint) SetStatsBaseline(baseline cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = baseline
}

// Close stops the local listener, unregisters the p2p provider and gives the
// shared host reference back. It is idempotent; the shared identity file is
// kept so stop/start keeps the same key.
func (s *p2pEntryPoint) Close() error {
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
	// acquired is set exactly when Run completed, so an entrypoint that never
	// started (or whose Run rolled back) releases nothing here.
	if acquired {
		tunnel.ReleaseP2PHost()
	}
	return err
}

func (s *p2pEntryPoint) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *p2pEntryPoint) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *p2pEntryPoint) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}
