package tunnel

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
	// Both x packages are named "tun": the aliases keep them apart.
	tunhandler "github.com/go-gost/x/handler/tun"
	tunlistener "github.com/go-gost/x/listener/tun"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

// tunTunnel is the hub half of a virtual network: it holds a tun device and
// serves it as a tun *server*, binding a UDP socket on its Endpoint. Every
// spoke's datagrams reach that socket through a separate p2p tunnel whose
// endpoint is the same address (the p2p host is the pipe; this device is the
// network). The server demultiplexes the spokes by the address each one
// registered with its keepalive, so the spokes themselves are stock tun
// clients and this side needs no per-peer configuration.
type tunTunnel struct {
	opts          Options
	forward       service.Service
	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

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

// Endpoint is the UDP address the tun server binds; the paired p2p tunnel must
// use the same address as its own endpoint.
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

// handlerMetadata is the tun server's keepalive configuration. "keepalive"
// enables route expiry (a route lives 3×ttl past its last keepalive), which is
// what retires a spoke that left; ttl is in seconds because that is the unit
// x's metadata accessor reads for an int.
func (s *tunTunnel) handlerMetadata() map[string]any {
	return map[string]any{
		"keepalive": s.opts.Keepalive,
		"ttl":       s.opts.TTL,
	}
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

	// A hub with no bind address cannot serve anything: the tun server binds
	// this address, and the paired p2p tunnel must use the same one (the API
	// rejects an empty or portless endpoint before reaching here).
	if s.opts.Endpoint == "" {
		return errors.New("tun tunnel requires a bind address (endpoint)")
	}

	log := logger.Default().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
	})

	pStats := xstats.NewStats(false)
	{
		prev := s.Stats()
		pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
		pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
		pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
		pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
	}

	listenerLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "tun"})
	ln := tunlistener.NewListener(
		listener.AddrOption(s.opts.Endpoint),
		listener.LoggerOption(listenerLogger),
		listener.StatsOption(pStats),
	)
	// Init creates the device (and blocks until it exists), so a failure here
	// is a failure to start — no listener is left behind.
	if err = ln.Init(mdx.NewMetadata(s.listenerMetadata())); err != nil {
		return
	}

	// No router and no forwarder hop: without either, x's tun handler runs in
	// server mode and binds the listener's address.
	handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tun"})
	h := tunhandler.NewHandler(
		handler.LoggerOption(handlerLogger),
	)
	if err = h.Init(mdx.NewMetadata(s.handlerMetadata())); err != nil {
		return
	}

	s.forward = xservice.NewService(s.opts.Name, ln, h,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)

	go func() {
		serveErr := s.forward.Serve()
		if serveErr != nil {
			log.Error("tun tunnel serve error", "err", serveErr)
		}
		s.setErr(serveErr)
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

func (s *tunTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	if s.forward != nil {
		return s.forward.Close()
	}
	return nil
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
