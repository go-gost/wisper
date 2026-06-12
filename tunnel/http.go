package tunnel

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net"
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
	xauth "github.com/go-gost/x/auth"
	xchain "github.com/go-gost/x/chain"
	"github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	"github.com/go-gost/x/handler/forward/remote"
	"github.com/go-gost/x/hop"
	"github.com/go-gost/x/listener/rtcp"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

type httpTunnel struct {
	endpoint string
	opts     Options
	config   *config.Config
	forward  service.Service
	favorite atomic.Bool
	stats    cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	cclose chan struct{}

	err error
	mu  sync.RWMutex
}

// NewHTTPTunnel creates an HTTP forwarding tunnel.
func NewHTTPTunnel(opts ...Option) Tunnel {
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
		options.Endpoint = "localhost:8080"
	}

	if options.Name == "" {
		options.Name = endpoint
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}

	s := &httpTunnel{
		endpoint: endpoint,
		opts:     options,
		cclose:   make(chan struct{}),
	}

	return s
}

func (s *httpTunnel) ID() string       { return s.opts.ID }
func (s *httpTunnel) Type() string     { return HTTPTunnel }
func (s *httpTunnel) Name() string     { return s.opts.Name }
func (s *httpTunnel) Endpoint() string { return s.opts.Endpoint }
func (s *httpTunnel) Entrypoint() string {
	return fmt.Sprintf("https://%s.%s", s.endpoint, GetEndpointAddr())
}
func (s *httpTunnel) Options() Options { return s.opts }
func (s *httpTunnel) Favorite(b bool)  { s.favorite.Store(b) }
func (s *httpTunnel) IsFavorite() bool { return s.favorite.Load() }

func (s *httpTunnel) init() error {
	node := &config.ForwardNodeConfig{
		Name: s.opts.Name,
		Addr: s.opts.Endpoint,
		HTTP: &config.HTTPNodeConfig{},
	}
	if s.opts.Username != "" {
		node.HTTP.Auth = &config.AuthConfig{
			Username: s.opts.Username,
			Password: s.opts.Password,
		}
	}
	if s.opts.Hostname != "" {
		node.HTTP.Host = s.opts.Hostname
	} else if s.opts.RewriteHost {
		host, _, _ := net.SplitHostPort(s.opts.Endpoint)
		if host == "" {
			host = s.opts.Endpoint
		}
		node.HTTP.Host = host
	}
	if s.opts.EnableTLS {
		node.TLS = &config.TLSNodeConfig{}
	}

	rtcpSvc := &config.ServiceConfig{
		Name: s.opts.Name,
		Addr: "",
		Handler: &config.HandlerConfig{
			Type: "rtcp",
			Metadata: map[string]any{
				"sniffing": true,
			},
		},
		Listener: &config.ListenerConfig{
			Type:  "rtcp",
			Chain: s.opts.Name,
		},
		Forwarder: &config.ForwarderConfig{
			Nodes: []*config.ForwardNodeConfig{node},
		},
	}

	s.config = &config.Config{
		Services: []*config.ServiceConfig{rtcpSvc},
		Chains:   []*config.ChainConfig{ChainConfig(s.opts.ID, s.opts.Name)},
	}
	return nil
}

func (s *httpTunnel) Run() (err error) {
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

	{
		var ch chain.Chainer
		ch, err = chain_parser.ParseChain(s.config.Chains[0], log)
		if err != nil {
			log.Error(err)
			return
		}

		listenerLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "rtcp"})
		pStats := xstats.NewStats(false)
		{
			prev := s.Stats()
			pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
			pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
			pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
			pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
		}
		cfg := s.config.Services[0]
		ln := rtcp.NewListener(
			listener.AddrOption(cfg.Addr),
			listener.RouterOption(xchain.NewRouter(chain.ChainRouterOption(ch), chain.LoggerRouterOption(listenerLogger))),
			listener.LoggerOption(listenerLogger),
			listener.StatsOption(pStats),
		)
		if err = ln.Init(mdx.NewMetadata(cfg.Listener.Metadata)); err != nil {
			return
		}

		handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "rtcp"})
		h := remote.NewHandler(
			handler.RouterOption(xchain.NewRouter(chain.LoggerRouterOption(handlerLogger))),
			handler.LoggerOption(handlerLogger),
		)
		if err = h.Init(mdx.NewMetadata(cfg.Handler.Metadata)); err != nil {
			return
		}

		fwdNode := cfg.Forwarder.Nodes[0]
		var nodeOpts []chain.NodeOption
		if fwdNode.HTTP != nil {
			httpNodeSettings := &chain.HTTPNodeSettings{
				Host:          fwdNode.HTTP.Host,
				RequestHeader: fwdNode.HTTP.RequestHeader,
			}
			if fwdNode.HTTP.Auth != nil {
				httpNodeSettings.Auther = xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{fwdNode.HTTP.Auth.Username: fwdNode.HTTP.Auth.Password}))
			}
			nodeOpts = append(nodeOpts, chain.HTTPNodeOption(httpNodeSettings))
		}
		if fwdNode.TLS != nil {
			nodeOpts = append(nodeOpts, chain.TLSNodeOption(&chain.TLSNodeSettings{
				ServerName: fwdNode.TLS.ServerName,
				Secure:     fwdNode.TLS.Secure,
			}))
		}
		if forwarder, ok := h.(handler.Forwarder); ok {
			forwarder.Forward(hop.NewHop(hop.NodeOption(chain.NewNode(fwdNode.Name, fwdNode.Addr, nodeOpts...)),
				hop.LoggerOption(log.WithFields(map[string]any{"kind": "hop"})),
			))
		}
		s.forward = xservice.NewService(s.opts.Name, ln, h,
			xservice.LoggerOption(log),
			xservice.StatsOption(pStats),
		)
	}

	go func() {
		serveErr := s.forward.Serve()
		if serveErr != nil {
			log.Error("http tunnel forwarder stopped with error", "err", serveErr)
		} else {
			log.Info("http tunnel forwarder stopped")
		}
		s.setErr(serveErr)
	}()

	return nil
}

func (s *httpTunnel) Status() *xservice.Status {
	if ss, _ := s.forward.(ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

func (s *httpTunnel) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *httpTunnel) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *httpTunnel) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *httpTunnel) SetStatsBaseline(baseline cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = baseline
}

func (s *httpTunnel) Close() error {
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

func (s *httpTunnel) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *httpTunnel) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *httpTunnel) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}
