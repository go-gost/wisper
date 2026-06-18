package tunnel

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/wisper/config"
	xconfig "github.com/go-gost/x/config"
	_ "github.com/go-gost/x/connector/tunnel"
	_ "github.com/go-gost/x/dialer/ws"
	xservice "github.com/go-gost/x/service"
)

const (
	defaultEndpointAddr = "gost.run"
	defaultServerName   = "tunnel.gost.run"
)

// GetEndpointAddr returns the public entrypoint domain, reading from config
// with fallback to the default (gost.run).
func GetEndpointAddr() string {
	if s := config.Get().Settings; s != nil && s.Entrypoint != "" {
		return s.Entrypoint
	}
	return defaultEndpointAddr
}

// GetServerName returns the tunnel relay server hostname, reading from config
// with fallback to the default (tunnel.gost.run).
func GetServerName() string {
	if s := config.Get().Settings; s != nil && s.Server != "" {
		return s.Server
	}
	return defaultServerName
}

// GetServerAddr returns the tunnel relay server address (hostname:443).
func GetServerAddr() string {
	return GetServerName() + ":443"
}

const (
	FileTunnel = "file"
	HTTPTunnel = "http"
	TCPTunnel  = "tcp"
	UDPTunnel  = "udp"
)

var (
	ErrTunnelClosed = errors.New("tunnel closed")
)

// Options holds the configuration for creating a tunnel.
type Options struct {
	ID          string
	Name        string
	Endpoint    string
	Hostname    string
	Username    string
	Password    string
	EnableTLS   bool
	RewriteHost bool
	FileUpload  bool
	Keepalive   bool
	TTL         int
	CreatedAt   time.Time
	Stats       config.ServiceStats
	StatsBaseline config.ServiceStats
}

// Option is a functional option for tunnel Options.
type Option func(opts *Options)

func IDOption(id string) Option {
	return func(opts *Options) {
		opts.ID = id
	}
}

func NameOption(name string) Option {
	return func(opts *Options) {
		opts.Name = name
	}
}

func EndpointOption(endpoint string) Option {
	return func(opts *Options) {
		opts.Endpoint = endpoint
	}
}

func HostnameOption(hostname string) Option {
	return func(opts *Options) {
		opts.Hostname = hostname
	}
}

func UsernameOption(username string) Option {
	return func(opts *Options) {
		opts.Username = username
	}
}

func PasswordOption(password string) Option {
	return func(opts *Options) {
		opts.Password = password
	}
}

func EnableTLSOption(b bool) Option {
	return func(opts *Options) {
		opts.EnableTLS = b
	}
}

func RewriteHostOption(b bool) Option {
	return func(opts *Options) {
		opts.RewriteHost = b
	}
}

func FileUploadOption(b bool) Option {
	return func(opts *Options) {
		opts.FileUpload = b
	}
}

func KeepaliveOption(b bool) Option {
	return func(opts *Options) {
		opts.Keepalive = b
	}
}

func TTLOption(ttl int) Option {
	return func(opts *Options) {
		opts.TTL = ttl
	}
}

func CreatedAtOption(createdAt time.Time) Option {
	return func(opts *Options) {
		opts.CreatedAt = createdAt
	}
}

func StatsBaselineOption(baseline config.ServiceStats) Option {
	return func(opts *Options) {
		opts.StatsBaseline = baseline
	}
}

// ServiceStatus is implemented by services that expose a Status method.
type ServiceStatus interface {
	Status() *xservice.Status
}

// IsServiceFailed checks whether the tunnel's underlying GOST service is in a
// failed state (e.g., cannot connect to the relay server). This is more
// reliable than Err() because Serve() retries temporary bind/accept errors
// indefinitely and never returns.
func IsServiceFailed(t Tunnel) bool {
	s := t.Status()
	return s != nil && s.State() == xservice.StateFailed
}

// ServiceErrorMessage returns the last accept/bind error message from the
// underlying GOST service status. Returns an empty string if no error is
// available.
func ServiceErrorMessage(t Tunnel) string {
	s := t.Status()
	if s == nil {
		return ""
	}
	if err := s.LastError(); err != nil {
		return err.Error()
	}
	return ""
}

// Tunnel is the interface for all tunnel and entrypoint types.
type Tunnel interface {
	ID() string
	Type() string
	Name() string
	Endpoint() string
	Entrypoint() string
	Options() Options
	Run() error
	Status() *xservice.Status
	Stats() config.ServiceStats
	SetStats(stats config.ServiceStats)
	StatsBaseline() config.ServiceStats
	SetStatsBaseline(baseline config.ServiceStats)
	Favorite(b bool)
	IsFavorite() bool
	Close() error
	IsClosed() bool
	Err() error
}

type tunnelList struct {
	list []Tunnel
	mux  sync.RWMutex
}

var (
	tunnels tunnelList
)

// Count returns the number of registered tunnels.
func Count() int {
	tunnels.mux.RLock()
	defer tunnels.mux.RUnlock()
	return len(tunnels.list)
}

// Add registers a tunnel.
func Add(s Tunnel) {
	tunnels.mux.Lock()
	defer tunnels.mux.Unlock()
	tunnels.list = append(tunnels.list, s)
}

// Set replaces an existing tunnel by ID, preserving its favorite state.
func Set(s Tunnel) {
	if s == nil {
		return
	}
	t := Get(s.ID())
	if t == nil {
		return
	}
	s.Favorite(t.IsFavorite())

	tunnels.mux.Lock()
	defer tunnels.mux.Unlock()

	for i, sv := range tunnels.list {
		if sv != nil && sv.ID() == s.ID() {
			tunnels.list[i] = s
		}
	}
}

// GetIndex returns the tunnel at the given index.
func GetIndex(index int) Tunnel {
	tunnels.mux.RLock()
	defer tunnels.mux.RUnlock()
	if index < 0 || index >= len(tunnels.list) {
		return nil
	}
	return tunnels.list[index]
}

// Get returns the tunnel with the given ID.
func Get(id string) Tunnel {
	tunnels.mux.RLock()
	defer tunnels.mux.RUnlock()

	for _, s := range tunnels.list {
		if s != nil && s.ID() == id {
			return s
		}
	}
	return nil
}

// Delete removes and closes the tunnel with the given ID.
func Delete(id string) {
	tunnels.mux.Lock()
	defer tunnels.mux.Unlock()

	for i, s := range tunnels.list {
		if s != nil && s.ID() == id {
			s.Close()
			tunnels.list = append(tunnels.list[:i], tunnels.list[i+1:]...)
			return
		}
	}
}

// RestartRunning recreates all running tunnels so they pick up the current
// config (e.g. a changed server address). Stopped tunnels are left as-is.
// Tunnels are closed before new ones start to avoid conflicts on the relay
// server (same tunnel ID cannot be registered twice concurrently).
func RestartRunning() {
	type restartInfo struct {
		index int
		opts  Options
		fav   bool
		stats          config.ServiceStats
		statsBaseline  config.ServiceStats
	}

	var pending []restartInfo

	// Phase 1: close all running tunnels and collect their info.
	for i := 0; i < Count(); i++ {
		t := GetIndex(i)
		if t == nil || t.IsClosed() {
			continue
		}
		pending = append(pending, restartInfo{
			index: i,
			opts:  t.Options(),
			fav:   t.IsFavorite(),
			stats:         t.Stats(),
			statsBaseline: t.StatsBaseline(),
		})
		t.Close()
	}

	// Phase 2: start new tunnels with the updated config.
	for _, p := range pending {
		newT := createTunnel(tunnels.list[p.index].Type(), Options{
			ID:          p.opts.ID,
			Name:        p.opts.Name,
			Endpoint:    p.opts.Endpoint,
			Hostname:    p.opts.Hostname,
			Username:    p.opts.Username,
			Password:    p.opts.Password,
			EnableTLS:   p.opts.EnableTLS,
			RewriteHost: p.opts.RewriteHost,
			FileUpload:  p.opts.FileUpload,
			CreatedAt:   p.opts.CreatedAt,
		})
		if newT == nil {
			continue
		}

		newT.SetStats(p.stats)
		newT.SetStatsBaseline(p.statsBaseline)
		newT.Favorite(p.fav)

		if err := newT.Run(); err != nil {
			logger.Default().Error(fmt.Sprintf("restart tunnel %s: %v", p.opts.Name, err))
			continue
		}

		Set(newT)
	}

	if err := SaveConfig(); err != nil {
		logger.Default().Error(fmt.Sprintf("save config: %v", err))
	}
}

// ChainConfig builds a GOST chain configuration that connects to the tunnel server.
func ChainConfig(id string, name string) *xconfig.ChainConfig {
	s := config.Get().Settings
	secure := true
	if s != nil && s.Insecure {
		secure = false
	}

	return &xconfig.ChainConfig{
		Name: name,
		Hops: []*xconfig.HopConfig{
			{
				Name: name,
				Nodes: []*xconfig.NodeConfig{
					{
						Name: name,
						Addr: GetServerAddr(),
						Connector: &xconfig.ConnectorConfig{
							Type:     "tunnel",
							Metadata: map[string]any{"tunnel.id": id},
						},
						Dialer: &xconfig.DialerConfig{
							Type: "wss",
							TLS: &xconfig.TLSConfig{
								Secure:     secure,
								ServerName: GetServerName(),
							},
						},
					},
				},
			},
		},
	}
}

// LoadConfig loads tunnels from the persisted configuration.
func LoadConfig() {
	for _, cfg := range config.Get().Tunnels {
		if cfg == nil {
			continue
		}

		tun := createTunnel(cfg.Type, Options{
			ID:          cfg.ID,
			Name:        cfg.Name,
			Endpoint:    cfg.Endpoint,
			Hostname:    cfg.Hostname,
			Username:    cfg.Username,
			Password:    cfg.Password,
			EnableTLS:   cfg.EnableTLS,
			RewriteHost: cfg.RewriteHost,
			FileUpload:  cfg.FileUpload,
			CreatedAt:   cfg.CreatedAt,
			Stats:       cfg.Stats,
			StatsBaseline: cfg.StatsBaseline,
		})
		if tun == nil {
			continue
		}

		if cfg.Closed {
			tun.Close()
		} else if err := tun.Run(); err != nil {
			tun.Close()
		}

		tun.Favorite(cfg.Favorite)
		Add(tun)
	}
}

// SaveConfig persists all tunnel states to disk.
func SaveConfig() error {
	cfg := config.Get()
	cfg.Tunnels = nil

	for i := 0; i < Count(); i++ {
		tun := GetIndex(i)
		if tun == nil {
			continue
		}

		opts := tun.Options()

		cfg.Tunnels = append(cfg.Tunnels, &config.Tunnel{
			ID:        tun.ID(),
			Name:      tun.Name(),
			Type:      tun.Type(),
			Endpoint:  tun.Endpoint(),
			Hostname:  opts.Hostname,
			Username:  opts.Username,
			Password:  opts.Password,
				EnableTLS:   opts.EnableTLS,
				RewriteHost: opts.RewriteHost,
				FileUpload:  opts.FileUpload,
			Favorite:  tun.IsFavorite(),
			Closed:    tun.IsClosed(),
			CreatedAt: opts.CreatedAt,
			Stats:     tun.Stats(),
			StatsBaseline: tun.StatsBaseline(),
		})
	}

	config.Set(cfg)

	if err := cfg.Write(); err != nil {
		logger.Default().Error(err)
		return err
	}
	return nil
}

func createTunnel(st string, opts Options) (t Tunnel) {
	options := []Option{
		IDOption(opts.ID),
		NameOption(opts.Name),
		EndpointOption(opts.Endpoint),
		HostnameOption(opts.Hostname),
		UsernameOption(opts.Username),
		PasswordOption(opts.Password),
		EnableTLSOption(opts.EnableTLS),
		CreatedAtOption(opts.CreatedAt),
			RewriteHostOption(opts.RewriteHost),
			FileUploadOption(opts.FileUpload),
	}

	switch st {
	case FileTunnel:
		t = NewFileTunnel(options...)
	case HTTPTunnel:
		t = NewHTTPTunnel(options...)
	case TCPTunnel:
		t = NewTCPTunnel(options...)
	case UDPTunnel:
		t = NewUDPTunnel(options...)
	default:
		return nil
	}

	t.SetStats(opts.Stats)
	t.SetStatsBaseline(opts.StatsBaseline)
	return
}
