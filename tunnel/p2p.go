package tunnel

import (
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	"github.com/go-gost/p2p"
	cfg "github.com/go-gost/wisper/config"
	xchain "github.com/go-gost/x/chain"
	"github.com/go-gost/x/handler/forward/local"
	"github.com/go-gost/x/hop"
	xlogger "github.com/go-gost/x/logger"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

// p2pTunnel exposes a local service to peers over the process-wide p2p host:
// the peer dials the host by its base64 public key through the DERP relay, the
// manager routes the inbound stream to this tunnel's peer route, and a
// standard gost service serves it, so stats come from the service stack.
type p2pTunnel struct {
	opts          Options
	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	forward service.Service
	ln      net.Listener // the peer route, held for teardown
	cclose  chan struct{}

	err error
	mu  sync.RWMutex
}

// NewP2PTunnel creates a private p2p tunnel.
func NewP2PTunnel(opts ...Option) Tunnel {
	var options Options
	for _, opt := range opts {
		opt(&options)
	}
	if options.ID == "" {
		options.ID = uuid.NewString()
	}
	if options.Endpoint == "" {
		options.Endpoint = "localhost:8080"
	}
	if options.Name == "" {
		options.Name = "p2p-" + options.ID
		if len(options.ID) > 8 {
			options.Name = "p2p-" + options.ID[:8]
		}
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}
	return &p2pTunnel{opts: options, cclose: make(chan struct{})}
}

func (s *p2pTunnel) ID() string       { return s.opts.ID }
func (s *p2pTunnel) Type() string     { return P2PTunnel }
func (s *p2pTunnel) Name() string     { return s.opts.Name }
func (s *p2pTunnel) Endpoint() string { return s.opts.Endpoint }
func (s *p2pTunnel) Options() Options { return s.opts }
func (s *p2pTunnel) Favorite(b bool)  { s.favorite.Store(b) }
func (s *p2pTunnel) IsFavorite() bool { return s.favorite.Load() }

func (s *p2pTunnel) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *p2pTunnel) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *p2pTunnel) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *p2pTunnel) SetStatsBaseline(b cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = b
}

// Entrypoint is the value the tunnel page shows: the peer's base64 public key
// (the route key, "this link's other end"). This host's own identity is
// process-wide — see P2PHostPublicKey and the settings page.
func (s *p2pTunnel) Entrypoint() string { return s.opts.Peer }

// Status is the underlying gost service's status (state and live stats).
func (s *p2pTunnel) Status() *xservice.Status {
	s.mu.RLock()
	forward := s.forward
	s.mu.RUnlock()

	if ss, _ := forward.(ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

// p2pLog returns the process default logger, or a discarding one when none is
// set (unit tests run without config.Init).
func p2pLog() logger.Logger {
	if log := logger.Default(); log != nil {
		return log
	}
	return xlogger.NewLogger(xlogger.OutputOption(io.Discard))
}

// P2PKeyPath is the legacy per-tunnel key file:
// <UserConfigDir>/wisper/p2p/<id>.key (hex, 0600). The p2p identity is
// process-wide now (P2PHostKeyPath); this only locates files left by older
// versions so they can be cleaned up.
func P2PKeyPath(id string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wisper", "p2p", id+".key"), nil
}

// RemoveP2PKey deletes a legacy per-tunnel key file; called by the API's
// delete handlers so files left by older versions do not pile up.
func RemoveP2PKey(id string) error {
	path, err := P2PKeyPath(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// P2PDerpURL returns the configured DERP relay, falling back to the public
// gost.run relay — the same read-time-default pattern as GetServerName.
func P2PDerpURL(s *cfg.Settings) string {
	if s != nil && s.P2P != nil && s.P2P.Derp != "" {
		return s.P2P.Derp
	}
	return defaultP2PDerp
}

// P2PTLSConfig returns the relay TLS options, or nil to keep p2p's defaults
// (verify against the system roots) when settings.p2p is unset.
func P2PTLSConfig(s *cfg.Settings) *p2p.TLSConfig {
	if s == nil || s.P2P == nil {
		return nil
	}
	if s.P2P.Secure == nil && s.P2P.CAFile == "" {
		return nil
	}
	return &p2p.TLSConfig{Secure: s.P2P.Secure, CAFile: s.P2P.CAFile}
}

// Run joins the process-wide p2p host, claims this tunnel's peer route on it
// and serves that route with a standard gost service forwarding to Endpoint.
func (s *p2pTunnel) Run() (err error) {
	if s.IsClosed() {
		return ErrTunnelClosed
	}
	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

	// Peer is required: it is the route key — the only peer allowed to dial
	// into this tunnel — and the value the tunnel page shows.
	if s.opts.Peer == "" {
		err = errors.New("p2p tunnel requires the peer public key")
		return
	}

	// The manager owns the host (identity, DERP connection, accept loop); this
	// tunnel holds one reference and one route on it.
	if _, err = p2pHost.acquire(); err != nil {
		return
	}
	ln, err := p2pHost.register(s.opts.Peer)
	if err != nil {
		p2pHost.release()
		return
	}
	// register hands the route back as a net.Listener; it is always a
	// *peerListener, the gost listener the service needs.
	peerLn := ln.(*peerListener)

	log := p2pLog().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
	})

	// Stats carry over across a restart, like the other tunnel types.
	pStats := xstats.NewStats(false)
	{
		prev := s.Stats()
		pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
		pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
		pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
		pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
	}

	// Every inbound stream is forwarded straight to the backend endpoint: no
	// chain, the peer's stream is the whole path (the entrypoint wiring minus
	// the chain).
	h := local.NewHandler(
		handler.RouterOption(xchain.NewRouter(chain.LoggerRouterOption(log))),
		handler.LoggerOption(log),
	)
	if err = h.Init(mdx.NewMetadata(nil)); err != nil {
		p2pHost.unregister(s.opts.Peer, ln)
		p2pHost.release()
		return
	}
	if fwd, ok := h.(handler.Forwarder); ok {
		fwd.Forward(hop.NewHop(
			hop.NodeOption(chain.NewNode(s.opts.Name, s.opts.Endpoint)),
			hop.LoggerOption(log),
		))
	}
	forward := xservice.NewService(s.opts.Name, peerLn, h,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)

	s.mu.Lock()
	s.forward, s.ln = forward, ln
	s.mu.Unlock()

	go func() {
		serveErr := forward.Serve()
		if serveErr != nil {
			log.Error("p2p tunnel serve error", "err", serveErr)
		}
		s.setErr(serveErr)
	}()

	return nil
}

// Close stops the service, drops the peer route and gives the manager
// reference back. It is idempotent; the shared identity file is kept.
func (s *p2pTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	s.mu.Lock()
	forward, ln := s.forward, s.ln
	s.forward, s.ln = nil, nil
	s.mu.Unlock()

	var err error
	if forward != nil {
		err = forward.Close()
	}
	// ln is set exactly when Run claimed the route, so a tunnel that never
	// acquired (or rolled back a failed Run) releases nothing here.
	if ln != nil {
		p2pHost.unregister(s.opts.Peer, ln)
		p2pHost.release()
	}
	return err
}

func (s *p2pTunnel) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *p2pTunnel) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}

func (s *p2pTunnel) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil && s.err == nil {
		s.err = err
	}
}
