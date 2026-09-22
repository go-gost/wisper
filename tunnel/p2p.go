package tunnel

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/p2p"
	cfg "github.com/go-gost/wisper/config"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

// p2pTunnel exposes a local service to peers over an embedded p2p host: the
// peer addresses this host by its base64 public key and dials in through the
// DERP relay (no gost.run endpoint, no admission — the key is the credential).
type p2pTunnel struct {
	opts          Options
	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	host   *p2p.Host
	cclose chan struct{}

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

// Entrypoint is the value peers need: the host's base64 public key. Empty
// until Run has built the host.
func (s *p2pTunnel) Entrypoint() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.host == nil {
		return ""
	}
	return s.host.PublicKey()
}

// Status has no gost service behind it: the tunnel is a p2p host, not a
// listener+handler pair, so there is no service status to report.
func (s *p2pTunnel) Status() *xservice.Status { return nil }

// P2PKeyPath is the per-tunnel key file: <UserConfigDir>/wisper/p2p/<id>.key
// (hex, 0600, created by the p2p library on first use).
func P2PKeyPath(id string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wisper", "p2p", id+".key"), nil
}

// RemoveP2PKey deletes a tunnel's key file; called by the API's delete handler
// only (not by tunnel.Delete/replace), so a tunnel update keeps its identity.
// Close likewise keeps the file so stop/start reuses the identity.
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

// p2pDerpURL returns the configured DERP relay, falling back to the public
// gost.run relay — the same read-time-default pattern as GetServerName.
func p2pDerpURL(s *cfg.Settings) string {
	if s != nil && s.P2P != nil && s.P2P.Derp != "" {
		return s.P2P.Derp
	}
	return defaultP2PDerp
}

// p2pTLSConfig returns the relay TLS options, or nil to keep p2p's defaults
// (verify against the system roots) when settings.p2p is unset.
func p2pTLSConfig(s *cfg.Settings) *p2p.TLSConfig {
	if s == nil || s.P2P == nil {
		return nil
	}
	if s.P2P.Secure == nil && s.P2P.CAFile == "" {
		return nil
	}
	return &p2p.TLSConfig{Secure: s.P2P.Secure, CAFile: s.P2P.CAFile}
}

func (s *p2pTunnel) Run() (err error) {
	if s.IsClosed() {
		return ErrTunnelClosed
	}
	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

	settings := cfg.Get().Settings
	keyPath, err := P2PKeyPath(s.opts.ID)
	if err != nil {
		return
	}

	direct := false
	conf := &p2p.Config{
		Derp:    p2pDerpURL(settings),
		Key:     keyPath,
		Targets: []string{"tcp://" + s.opts.Endpoint},
		Direct:  &direct,
	}
	conf.TLS = p2pTLSConfig(settings)
	host, err := p2p.New(conf)
	if err != nil {
		err = fmt.Errorf("p2p host: %w", err)
		return
	}
	// A failed relay connection is not fatal: the engine retries in the
	// background (the p2p CLI behaves the same), and the tunnel keeps running
	// so its peer key stays visible.
	if cerr := host.Connect(); cerr != nil {
		// logger.Default() is nil until config.Init sets one (unit tests).
		if log := logger.Default(); log != nil {
			log.WithFields(map[string]any{
				"kind":   "tunnel",
				"tunnel": s.opts.Name,
			}).Warnf("p2p derp connect: %v", cerr)
		}
	}

	s.mu.Lock()
	s.host = host
	s.mu.Unlock()
	return nil
}

func (s *p2pTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	s.mu.Lock()
	host := s.host
	s.host = nil
	s.mu.Unlock()
	if host != nil {
		return host.Close() // keeps the key file: the identity survives a restart
	}
	return nil
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
