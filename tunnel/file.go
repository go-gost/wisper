package tunnel

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/auth"
	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
	xauth "github.com/go-gost/x/auth"
	xchain "github.com/go-gost/x/chain"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	"github.com/go-gost/x/handler/file"
	"github.com/go-gost/x/listener/rtcp"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

type fileTunnel struct {
	endpoint      string
	opts          Options
	forward       service.Service
	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	cclose chan struct{}

	err error
	mu  sync.RWMutex
}

// NewFileTunnel creates a file-sharing tunnel.
func NewFileTunnel(opts ...Option) Tunnel {
	var options Options
	for _, opt := range opts {
		opt(&options)
	}
	if options.ID == "" {
		options.ID = uuid.NewString()
	}

	v := md5.Sum([]byte(options.ID))
	endpoint := hex.EncodeToString(v[:8])

	if options.Endpoint == "" {
		options.Endpoint, _ = os.Getwd()
	}

	if options.Name == "" {
		options.Name = endpoint
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}

	s := &fileTunnel{
		endpoint: endpoint,
		opts:     options,
		cclose:   make(chan struct{}),
	}

	return s
}

func (s *fileTunnel) ID() string       { return s.opts.ID }
func (s *fileTunnel) Type() string     { return FileTunnel }
func (s *fileTunnel) Name() string     { return s.opts.Name }
func (s *fileTunnel) Endpoint() string { return s.opts.Endpoint }
func (s *fileTunnel) Entrypoint() string {
	return fmt.Sprintf("https://%s.%s", entrypointHost(s.endpoint, s.opts.Prefix, s.forward), GetEndpointAddr())
}
func (s *fileTunnel) Options() Options { return s.opts }
func (s *fileTunnel) Favorite(b bool)  { s.favorite.Store(b) }
func (s *fileTunnel) IsFavorite() bool { return s.favorite.Load() }

func (s *fileTunnel) Run() (err error) {
	if s.IsClosed() {
		return ErrTunnelClosed
	}

	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

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

	handlerMeta := map[string]any{"file.dir": s.opts.Endpoint}
	if s.opts.FileUpload {
		handlerMeta["file.put"] = true
	}

	// The relay chain is what carries traffic to this host; nothing is dialed
	// locally, the served directory is on this machine.
	listenerLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "rtcp"})
	ch, err := chain_parser.ParseChain(ChainConfig(s.opts.ID, s.opts.Name, s.opts.RecordMode), log)
	if err != nil {
		log.Error(err)
		return
	}

	ln := rtcp.NewListener(
		listener.AddrOption(s.opts.Prefix),
		listener.RouterOption(xchain.NewRouter(chain.ChainRouterOption(ch), chain.LoggerRouterOption(listenerLogger))),
		listener.LoggerOption(listenerLogger),
		listener.StatsOption(pStats),
	)
	if err = ln.Init(mdx.NewMetadata(nil)); err != nil {
		return
	}

	// The file handler serves the directory in-process: an accepted relay
	// conn is handed straight to it, so there is no local listener, no dial
	// and no loopback hop between the relay and the files.
	handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "file"})
	var auther auth.Authenticator
	if s.opts.Username != "" {
		auther = xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{s.opts.Username: s.opts.Password}))
	}
	h := file.NewHandler(
		handler.LoggerOption(handlerLogger),
		handler.AutherOption(auther),
	)
	if err = h.Init(mdx.NewMetadata(handlerMeta)); err != nil {
		return
	}

	s.forward = xservice.NewService(s.opts.Name, ln, h,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)

	go func() {
		serveErr := s.forward.Serve()
		if CleanStop(serveErr) {
			log.Info("file tunnel stopped")
			s.setErr(nil)
		} else {
			log.Errorf("file tunnel stopped with error: %v", serveErr)
			s.setErr(serveErr)
		}
	}()

	// Wait for the initial relay bind so the entrypoint URL reflects the
	// server-assigned address (not the requested prefix). The rtcp listener's
	// Addr() returns "host:port" only after the first Accept calls Router.Bind.
	for range 100 {
		if addr := s.forward.Addr(); addr != nil {
			if _, _, err := net.SplitHostPort(addr.String()); err == nil {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}

	log.Infof("file tunnel serving %s, entrypoint: %s", s.opts.Endpoint, s.Entrypoint())
	return nil
}

func (s *fileTunnel) Status() *xservice.Status {
	if ss, _ := s.forward.(ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

func (s *fileTunnel) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *fileTunnel) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *fileTunnel) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *fileTunnel) SetStatsBaseline(baseline cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = baseline
}

func (s *fileTunnel) Close() error {
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

func (s *fileTunnel) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *fileTunnel) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *fileTunnel) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}
