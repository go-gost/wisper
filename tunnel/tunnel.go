package tunnel

import (
	"errors"
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
	EndpointAddr = "gost.run"
	ServerName   = "tunnel.gost.run"
	ServerAddr   = ServerName + ":443"
)

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

// ServiceStatus is implemented by services that expose a Status method.
type ServiceStatus interface {
	Status() *xservice.Status
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

// ChainConfig builds a GOST chain configuration that connects to the tunnel server.
func ChainConfig(id string, name string) *xconfig.ChainConfig {
	return &xconfig.ChainConfig{
		Name: name,
		Hops: []*xconfig.HopConfig{
			{
				Name: name,
				Nodes: []*xconfig.NodeConfig{
					{
						Name: name,
						Addr: ServerAddr,
						Connector: &xconfig.ConnectorConfig{
							Type:     "tunnel",
							Metadata: map[string]any{"tunnel.id": id},
						},
						Dialer: &xconfig.DialerConfig{
							Type: "wss",
							TLS: &xconfig.TLSConfig{
								Secure:     true,
								ServerName: ServerName,
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
		})
		if tun == nil {
			continue
		}

		if cfg.Closed {
			tun.Close()
		} else {
			tun.Run()
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
	return
}
