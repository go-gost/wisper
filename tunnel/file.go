package tunnel

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
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
	"github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	"github.com/go-gost/x/handler/file"
	"github.com/go-gost/x/handler/forward/remote"
	"github.com/go-gost/x/hop"
	"github.com/go-gost/x/listener/rtcp"
	"github.com/go-gost/x/listener/tcp"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

type fileTunnel struct {
	endpoint string
	opts     Options
	config   *config.Config
	file     service.Service
	forward  service.Service
	favorite atomic.Bool
	stats    cfg.ServiceStats

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
	return fmt.Sprintf("https://%s.%s", s.endpoint, EndpointAddr)
}
func (s *fileTunnel) Options() Options { return s.opts }
func (s *fileTunnel) Favorite(b bool)  { s.favorite.Store(b) }
func (s *fileTunnel) IsFavorite() bool { return s.favorite.Load() }

func (s *fileTunnel) init() error {
	handlerMeta := map[string]any{"file.dir": s.opts.Endpoint}
	if s.opts.FileUpload {
		handlerMeta["file.put"] = true
	}
	fileSvc := &config.ServiceConfig{
		Name: s.opts.Name,
		Addr: ":0",
		Handler: &config.HandlerConfig{
			Type:     "file",
			Metadata: handlerMeta,
		},
		Listener: &config.ListenerConfig{
			Type: "tcp",
		},
	}
	if s.opts.Username != "" {
		fileSvc.Handler.Auth = &config.AuthConfig{
			Username: s.opts.Username,
			Password: s.opts.Password,
		}
	}

	rtcpSvc := &config.ServiceConfig{
		Name: s.opts.Name,
		Addr: s.opts.Hostname,
		Handler: &config.HandlerConfig{
			Type: "rtcp",
		},
		Listener: &config.ListenerConfig{
			Type:  "rtcp",
			Chain: s.opts.Name,
		},
	}

	s.config = &config.Config{
		Services: []*config.ServiceConfig{fileSvc, rtcpSvc},
		Chains:   []*config.ChainConfig{ChainConfig(s.opts.ID, s.opts.Name)},
	}

	return nil
}

func (s *fileTunnel) Run() (err error) {
	if s.IsClosed() {
		return ErrTunnelClosed
	}

	defer func() { s.setErr(err) }()

	if err = s.init(); err != nil {
		return
	}

	log := logger.Default().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
	})

	// Phase 1: start the local file server.
	{
		svcCfg := s.config.Services[0]
		ln := tcp.NewListener(
			listener.LoggerOption(log.WithFields(map[string]any{"kind": "listener", "listener": "tcp"})),
		)
		if err = ln.Init(nil); err != nil {
			return
		}
		log.Infof("listen on %s", ln.Addr())

		var auther auth.Authenticator
		if auth := svcCfg.Handler.Auth; auth != nil {
			auther = xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{auth.Username: auth.Password}))
		}
		h := file.NewHandler(
			handler.LoggerOption(log.WithFields(map[string]any{"kind": "handler", "handler": "file"})),
			handler.AutherOption(auther),
		)
		if err = h.Init(mdx.NewMetadata(svcCfg.Handler.Metadata)); err != nil {
			return
		}
		s.file = xservice.NewService(s.opts.Name, ln, h, xservice.LoggerOption(log))
	}

	// Phase 2: start the reverse-tunnel forwarder.
	{
		var ch chain.Chainer
		ch, err = chain_parser.ParseChain(s.config.Chains[0], log)
		if err != nil {
			s.file.Close()
			log.Error(err)
			return
		}

		pStats := xstats.NewStats(false)
		{
			prev := s.Stats() // read under lock
			pStats.Add(stats.KindCurrentConns, int64(prev.CurrentConns))
			pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
			pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
			pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
			pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
		}

		listenerLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "rtcp"})
		fwdCfg := s.config.Services[1]
		ln := rtcp.NewListener(
			listener.AddrOption(fwdCfg.Addr),
			listener.RouterOption(xchain.NewRouter(chain.ChainRouterOption(ch), chain.LoggerRouterOption(listenerLogger))),
			listener.LoggerOption(listenerLogger),
			listener.StatsOption(pStats),
		)
		if err = ln.Init(mdx.NewMetadata(fwdCfg.Listener.Metadata)); err != nil {
			s.file.Close()
			return
		}

		handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "rtcp"})
		h := remote.NewHandler(
			handler.RouterOption(xchain.NewRouter(chain.LoggerRouterOption(handlerLogger))),
			handler.LoggerOption(handlerLogger),
		)
		if err = h.Init(mdx.NewMetadata(fwdCfg.Handler.Metadata)); err != nil {
			s.file.Close()
			return
		}
		if forwarder, ok := h.(handler.Forwarder); ok {
			forwarder.Forward(hop.NewHop(
				hop.NodeOption(chain.NewNode(s.opts.Name, s.file.Addr().String())),
				hop.LoggerOption(log.WithFields(map[string]any{"kind": "hop"})),
			))
		}
		s.forward = xservice.NewService(s.opts.Name, ln, h,
			xservice.LoggerOption(log),
			xservice.StatsOption(pStats),
		)
		log.Infof("service listen on %s", s.file.Addr())
	}

	go s.file.Serve()
	go func() {
		serveErr := s.forward.Serve()
		if serveErr != nil {
			log.Error("file tunnel forwarder stopped with error", "err", serveErr)
		} else {
			log.Info("file tunnel forwarder stopped")
		}
		s.setErr(serveErr)
	}()

	log.Infof("file service run at %s, entrypoint: https://%s.%s", s.file.Addr(), s.endpoint, EndpointAddr)
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

func (s *fileTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	if s.forward != nil {
		s.forward.Close()
	}
	if s.file != nil {
		return s.file.Close()
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
