package entrypoint

import (
	"errors"
	"fmt"
	"sync"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
)

const (
	TCPEntryPoint = "tcp"
	UDPEntryPoint = "udp"
)

var (
	ErrEntryPointClosed = errors.New("entrypoint closed")
)

// EntryPoint is an alias for tunnel.Tunnel used by entrypoint types.
type EntryPoint = tunnel.Tunnel

type entryPointList struct {
	list []EntryPoint
	mux  sync.RWMutex
}

var (
	entryPoints entryPointList
)

// Count returns the number of registered entrypoints.
func Count() int {
	entryPoints.mux.RLock()
	defer entryPoints.mux.RUnlock()
	return len(entryPoints.list)
}

// Add registers an entrypoint.
func Add(s EntryPoint) {
	entryPoints.mux.Lock()
	defer entryPoints.mux.Unlock()
	entryPoints.list = append(entryPoints.list, s)
}

// Set replaces an existing entrypoint by ID, preserving its favorite state.
func Set(s EntryPoint) {
	if s == nil {
		return
	}

	old := Get(s.ID())
	if old == nil {
		return
	}
	s.Favorite(old.IsFavorite())

	entryPoints.mux.Lock()
	defer entryPoints.mux.Unlock()

	for i, ep := range entryPoints.list {
		if ep != nil && ep.ID() == s.ID() {
			entryPoints.list[i] = s
		}
	}
}

// GetIndex returns the entrypoint at the given index.
func GetIndex(index int) EntryPoint {
	entryPoints.mux.RLock()
	defer entryPoints.mux.RUnlock()
	if index < 0 || index >= len(entryPoints.list) {
		return nil
	}
	return entryPoints.list[index]
}

// Get returns the entrypoint with the given ID.
func Get(id string) EntryPoint {
	entryPoints.mux.RLock()
	defer entryPoints.mux.RUnlock()

	for _, s := range entryPoints.list {
		if s != nil && s.ID() == id {
			return s
		}
	}
	return nil
}

// Delete removes and closes the entrypoint with the given ID.
func Delete(id string) {
	entryPoints.mux.Lock()
	defer entryPoints.mux.Unlock()

	for i, s := range entryPoints.list {
		if s != nil && s.ID() == id {
			s.Close()
			entryPoints.list = append(entryPoints.list[:i], entryPoints.list[i+1:]...)
			return
		}
	}
}

// RestartRunning recreates all running entrypoints so they pick up the current
// config (e.g. a changed server address). Stopped entrypoints are left as-is.
// Endpoints are closed before new ones start to avoid conflicts on the relay
// server (same tunnel ID cannot be registered twice concurrently).
func RestartRunning() {
	type restartInfo struct {
		index int
		opts  tunnel.Options
		fav   bool
		stats          config.ServiceStats
		statsBaseline  config.ServiceStats
	}

	var pending []restartInfo

	// Phase 1: close all running entrypoints and collect their info.
	for i := 0; i < Count(); i++ {
		ep := GetIndex(i)
		if ep == nil || ep.IsClosed() {
			continue
		}
		pending = append(pending, restartInfo{
			index: i,
			opts:  ep.Options(),
			fav:   ep.IsFavorite(),
			stats:         ep.Stats(),
			statsBaseline: ep.StatsBaseline(),
		})
		ep.Close()
	}

	// Phase 2: start new entrypoints with the updated config.
	for _, p := range pending {
		newEP := createEntryPoint(entryPoints.list[p.index].Type(), tunnel.Options{
			ID:        p.opts.ID,
			Name:      p.opts.Name,
			Endpoint:  p.opts.Endpoint,
			Hostname:  p.opts.Hostname,
			Username:  p.opts.Username,
			Password:  p.opts.Password,
			EnableTLS: p.opts.EnableTLS,
			Keepalive: p.opts.Keepalive,
			TTL:       p.opts.TTL,
			CreatedAt:     p.opts.CreatedAt,
			StatsBaseline: p.statsBaseline,
		})
		if newEP == nil {
			continue
		}

		newEP.SetStats(p.stats)
		newEP.SetStatsBaseline(p.statsBaseline)
		newEP.Favorite(p.fav)

		if err := newEP.Run(); err != nil {
			logger.Default().Error(fmt.Sprintf("restart entrypoint %s: %v", p.opts.Name, err))
			continue
		}

		Set(newEP)
	}

	SaveConfig()
}

// LoadConfig loads entrypoints from the persisted configuration.
func LoadConfig() {
	for _, cfg := range config.Get().EntryPoints {
		if cfg == nil {
			continue
		}

		ep := createEntryPoint(cfg.Type, tunnel.Options{
			ID:        cfg.ID,
			Name:      cfg.Name,
			Endpoint:  cfg.Endpoint,
			Hostname:  cfg.Hostname,
			Username:  cfg.Username,
			Password:  cfg.Password,
			EnableTLS: cfg.EnableTLS,
			Keepalive: cfg.Keepalive,
			TTL:       cfg.TTL,
			CreatedAt: cfg.CreatedAt,
			Stats:         cfg.Stats,
			StatsBaseline: cfg.StatsBaseline,
		})
		if ep == nil {
			continue
		}

		if cfg.Closed {
			ep.Close()
		} else {
			ep.Run()
		}

		ep.Favorite(cfg.Favorite)
		Add(ep)
	}
}

// SaveConfig persists all entrypoint states to disk.
func SaveConfig() error {
	cfg := config.Get()
	cfg.EntryPoints = nil

	for i := 0; i < Count(); i++ {
		ep := GetIndex(i)
		if ep == nil {
			continue
		}

		opts := ep.Options()

		cfg.EntryPoints = append(cfg.EntryPoints, &config.Tunnel{
			ID:        ep.ID(),
			Name:      ep.Name(),
			Type:      ep.Type(),
			Endpoint:  ep.Entrypoint(),
			Hostname:  opts.Hostname,
			Username:  opts.Username,
			Password:  opts.Password,
			EnableTLS: opts.EnableTLS,
			Favorite:  ep.IsFavorite(),
			Closed:    ep.IsClosed(),
			CreatedAt: opts.CreatedAt,
			Stats:         ep.Stats(),
			StatsBaseline: ep.StatsBaseline(),
		})
	}

	config.Set(cfg)

	if err := cfg.Write(); err != nil {
		logger.Default().Error(err)
		return err
	}
	return nil
}

func createEntryPoint(st string, opts tunnel.Options) (ep EntryPoint) {
	options := []tunnel.Option{
		tunnel.IDOption(opts.ID),
		tunnel.NameOption(opts.Name),
		tunnel.EndpointOption(opts.Endpoint),
		tunnel.HostnameOption(opts.Hostname),
		tunnel.UsernameOption(opts.Username),
		tunnel.PasswordOption(opts.Password),
		tunnel.EnableTLSOption(opts.EnableTLS),
		tunnel.CreatedAtOption(opts.CreatedAt),
		tunnel.StatsBaselineOption(opts.StatsBaseline),
	}
	switch st {
	case TCPEntryPoint:
		ep = NewTCPEntryPoint(options...)
	case UDPEntryPoint:
		ep = NewUDPEntryPoint(options...)
	default:
		return nil
	}

	ep.SetStats(opts.Stats)
	ep.SetStatsBaseline(opts.StatsBaseline)
	return
}
