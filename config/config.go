package config

import (
	"bytes"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/logger"
	xconfig "github.com/go-gost/x/config"
	logger_parser "github.com/go-gost/x/config/parsing/logger"
	"gopkg.in/yaml.v3"
)

const (
	configFile = "wisper.yaml"
	logFile    = "wisper.log"
)

// writeMu serializes all config file writes to prevent concurrent file corruption.
var writeMu sync.Mutex

var (
	configDir string
)

func init() {
	config.Store(&Config{})
}

// Option configures the Init behavior.
type Option func(*options)

type options struct {
	configDir string
}

// WithConfigDir sets an explicit config directory for Init().
// When empty (the default), Init() uses os.UserConfigDir() + "/wisper".
func WithConfigDir(dir string) Option {
	return func(o *options) {
		o.configDir = dir
	}
}

// Dir returns the configuration directory: the one Init() was given — on
// Android the app's files directory, since there is neither $XDG_CONFIG_HOME nor
// $HOME — or the resolved default when Init() has not run.
func Dir() string {
	if configDir != "" {
		return configDir
	}
	return resolveConfigDir("")
}

// resolveConfigDir picks the configuration directory: an explicit one wins,
// otherwise $XDG_CONFIG_HOME (or $HOME)/wisper, falling back to the working
// directory when the environment defines neither.
func resolveConfigDir(explicit string) string {
	if explicit != "" {
		return explicit
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		slog.Error(fmt.Sprintf("configDir: %v", err))
	}
	if dir == "" {
		dir, _ = os.Getwd()
	}
	return filepath.Join(dir, "wisper")
}

// Init initializes the configuration directory and loads config.
func Init(opts ...Option) {
	o := &options{}
	for _, opt := range opts {
		opt(o)
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true})))

	configDir = resolveConfigDir(o.configDir)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		slog.Error(fmt.Sprintf("mkdir config dir: %v", err))
	}

	slog.Info(fmt.Sprintf("configDir: %s", configDir))

	cfg := Get()
	if err := cfg.load(); err != nil {
		slog.Error(fmt.Sprintf("load config: %v", err))
		if _, ok := err.(*os.PathError); ok {
			if err := cfg.Write(); err != nil {
				slog.Error(fmt.Sprintf("write config: %v", err))
			}
		}
	}
	Set(cfg)

	initLog()
}

func initLog() {
	cfg := Get().Log
	if cfg == nil {
		logDir := filepath.Join(configDir, "logs")
		if err := os.MkdirAll(logDir, 0755); err != nil {
			slog.Error(fmt.Sprintf("mkdir log dir: %v", err))
		}
		slog.Info(fmt.Sprintf("log dir: %s", logDir))

		cfg = &xconfig.LogConfig{
			Output: filepath.Join(logDir, logFile),
			Level:  string(logger.InfoLevel),
			Format: string(logger.JSONFormat),
			Rotation: &xconfig.LogRotationConfig{
				MaxSize:    10,
				MaxAge:     7,
				MaxBackups: 10,
				LocalTime:  true,
			},
		}
	}

	logger.SetDefault(logger_parser.ParseLogger(&xconfig.LoggerConfig{Log: cfg}))

	// One pipeline for the whole process: gost's components keep their logger,
	// everything written with slog (wisper's own code and the embedded p2p
	// library) lands in the same place, at the same level.
	setDefaultSlog(logger.Default())
}

var (
	config atomic.Value
)

// Get returns a deep copy of the current configuration.
func Get() *Config {
	c := config.Load().(*Config)
	return deepCopyConfig(c)
}

// Set stores the configuration.
func Set(c *Config) {
	if c == nil {
		c = &Config{}
	}
	config.Store(c)
}

// Settings holds application settings.
type Settings struct {
	// Server address (default: wisper.gost.run).
	Server string
	// Public entrypoint address (default: gost.run).
	Entrypoint string
	// Skip TLS certificate verification for the tunnel server.
	Insecure      bool
	Lang          string
	Theme         string
	StatsInterval int `yaml:"stats_interval,omitempty" json:"stats_interval,omitempty"`
	// Inspector API URL (e.g., http://inspector:8000). Empty = disabled.
	InspectorURL string `yaml:"inspector_url,omitempty" json:"inspector_url,omitempty"`
	// P2P holds the private p2p mode settings (DERP relay).
	P2P *P2PSettings `yaml:",omitempty" json:"p2p,omitempty"`
}

// P2PSettings holds the deployment-level p2p host settings: the DERP relay, its
// TLS options, and the direct path. Per-tunnel p2p tunnels share them; the
// tunnel's own config carries only its local backend address.
type P2PSettings struct {
	// Derp is the DERP relay URL (wss://host/derp). Required for p2p tunnels.
	Derp string `yaml:",omitempty" json:"derp"`
	// Secure verifies the relay's TLS certificate (nil = true).
	Secure *bool `yaml:",omitempty" json:"secure,omitempty"`
	// CAFile is a PEM CA file to trust the relay's self-signed certificate.
	CAFile string `yaml:"caFile,omitempty" json:"ca_file,omitempty"`
	// Stun is the STUN server (host:port) for the IPv4 direct path. Empty
	// derives it from the relay's host (see P2PStunAddr); the IPv6 direct path
	// needs no STUN.
	Stun string `yaml:",omitempty" json:"stun,omitempty"`
	// Direct attempts a direct (hole-punched) path, falling back to the relay.
	// nil = true.
	Direct *bool `yaml:",omitempty" json:"direct,omitempty"`
}

// Tunnel holds the persistent state of a single tunnel or entrypoint.
type Tunnel struct {
	ID          string
	Name        string
	Type        string
	Endpoint    string
	Prefix      string `yaml:",omitempty"`
	Hostname    string `yaml:",omitempty"`
	Username    string `yaml:",omitempty"`
	Password    string `yaml:",omitempty"`
	EnableTLS   bool   `yaml:"enableTLS,omitempty"`
	RewriteHost bool   `yaml:"rewriteHost,omitempty"`
	FileUpload  bool   `yaml:"fileUpload,omitempty"`
	Keepalive   bool   `yaml:",omitempty"`
	TTL         int    `yaml:"ttl,omitempty"`

	// RecordMode controls traffic recording: "full", "headers", "off".
	RecordMode string `yaml:"record_mode,omitempty"`

	// Peer is the remote peer's base64 public key (p2p entrypoints).
	Peer string `yaml:",omitempty" json:"peer,omitempty"`

	// Protocol is a p2p entrypoint's inner protocol: "tcp" (the default when
	// empty) or "udp".
	Protocol string `yaml:",omitempty" json:"protocol,omitempty"`

	// Peers is a p2p tunnel's inbound allowlist: the base64 public keys whose
	// streams are routed to it. Empty means no traffic is routed (the tunnel
	// runs but is unreachable).
	Peers []string `yaml:"peers,omitempty" json:"peers,omitempty"`

	// PeerAliases labels each allowlisted key for display (key → alias), so
	// the UI shows a short name instead of the key itself. Entries are
	// generated on demand — see NormalizePeerAliases.
	PeerAliases map[string]string `yaml:"peer_aliases,omitempty" json:"peer_aliases,omitempty"`

	// PeerDisabled lists allowlisted keys that are switched off: they stay in
	// Peers (and on the peers page) but hold no route, so their new streams are
	// closed while established ones drain. Empty means every peer is enabled.
	PeerDisabled []string `yaml:"peer_disabled,omitempty" json:"peer_disabled,omitempty"`

	// Net is a tun device's address: a CIDR, or several comma-separated. It is
	// what the device advertises (and, for a spoke, what it registers with the
	// hub's tun server).
	Net string `yaml:",omitempty" json:"net,omitempty"`

	// MTU is the tun device's MTU. 0 leaves the implementation default (1420).
	MTU int `yaml:"mtu,omitempty" json:"mtu,omitempty"`

	// DeviceName is the tun device's name. Empty lets the kernel choose.
	DeviceName string `yaml:"device_name,omitempty" json:"device_name,omitempty"`

	// Routes are the subnets routed through the device, comma-separated
	// "cidr [gw]" pairs: for a spoke, what to send into the tunnel (0.0.0.0/0
	// for a full tunnel); for a hub, only subnets behind one of its spokes.
	Routes string `yaml:",omitempty" json:"routes,omitempty"`

	// DNS is the device's DNS servers, comma-separated.
	DNS string `yaml:",omitempty" json:"dns,omitempty"`

	Stats         ServiceStats
	StatsBaseline ServiceStats `yaml:"stats_baseline,omitempty"`
	Favorite      bool
	Closed        bool
	CreatedAt     time.Time
}

// Config is the root configuration file structure.
type Config struct {
	Settings    *Settings
	Tunnels     []*Tunnel
	EntryPoints []*Tunnel
	Log         *xconfig.LogConfig
}

func (c *Config) load() error {
	f, err := os.Open(filepath.Join(configDir, configFile))
	if err != nil {
		return err
	}
	defer f.Close()

	return yaml.NewDecoder(f).Decode(c)
}

// Write persists the configuration to disk. It is safe for concurrent use.
func (c *Config) Write() error {
	writeMu.Lock()
	defer writeMu.Unlock()

	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	defer enc.Close()

	enc.SetIndent(2)
	if err := enc.Encode(c); err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(configDir, configFile), buf.Bytes(), 0644)
}

// deepCopyConfig returns a fully independent copy of the Config.
func deepCopyConfig(c *Config) *Config {
	cfg := &Config{}
	*cfg = *c

	if c.Settings != nil {
		cfg.Settings = &Settings{}
		*cfg.Settings = *c.Settings
	}

	if len(c.Tunnels) > 0 {
		cfg.Tunnels = make([]*Tunnel, len(c.Tunnels))
		for i, t := range c.Tunnels {
			if t != nil {
				clone := *t
				cfg.Tunnels[i] = &clone
			}
		}
	}

	if len(c.EntryPoints) > 0 {
		cfg.EntryPoints = make([]*Tunnel, len(c.EntryPoints))
		for i, t := range c.EntryPoints {
			if t != nil {
				clone := *t
				cfg.EntryPoints[i] = &clone
			}
		}
	}

	return cfg
}

// ServiceStats holds traffic statistics for a tunnel or entrypoint.
type ServiceStats struct {
	Time            time.Time
	TotalConns      uint64
	RequestRate     float64
	CurrentConns    uint64
	TotalErrs       uint64
	InputBytes      uint64
	InputRateBytes  uint64
	OutputBytes     uint64
	OutputRateBytes uint64
}
