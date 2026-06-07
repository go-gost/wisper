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
	configFile = "config.yml"
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

// Init initializes the configuration directory and loads config.
func Init() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true})))

	dir, err := os.UserConfigDir()
	if err != nil {
		slog.Error(fmt.Sprintf("configDir: %v", err))
	}
	if dir == "" {
		dir, _ = os.Getwd()
	}
	configDir = filepath.Join(dir, "wisper")
	os.MkdirAll(configDir, 0755)

	slog.Info(fmt.Sprintf("configDir: %s", configDir))

	cfg := Get()
	if err := cfg.load(); err != nil {
		slog.Error(fmt.Sprintf("load config: %v", err))
		if _, ok := err.(*os.PathError); ok {
			cfg.Write()
		}
	}
	Set(cfg)

	initLog()
}

func initLog() {
	cfg := Get().Log
	if cfg == nil {
		logDir := filepath.Join(configDir, "logs")
		os.MkdirAll(logDir, 0755)
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
	// Server address (default: tunnel.gost.plus).
	Server string
	// Public entrypoint address (default: gost.plus).
	Entrypoint string
	Lang       string
	Theme      string
}

// Tunnel holds the persistent state of a single tunnel or entrypoint.
type Tunnel struct {
	ID        string
	Name      string
	Type      string
	Endpoint  string
	Hostname  string `yaml:",omitempty"`
	Username  string `yaml:",omitempty"`
	Password  string `yaml:",omitempty"`
	EnableTLS   bool   `yaml:"enableTLS,omitempty"`
	RewriteHost bool   `yaml:"rewriteHost,omitempty"`
	Keepalive   bool   `yaml:",omitempty"`
	TTL       int    `yaml:"ttl,omitempty"`

	Stats     ServiceStats
	Favorite  bool
	Closed    bool
	CreatedAt time.Time
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
