package entrypoint

import (
	"errors"
	"fmt"
	"log/slog"
	"runtime"
	"sync"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
)

const (
	TCPEntryPoint = "tcp"
	UDPEntryPoint = "udp"
	P2PEntryPoint = "p2p"
	// TunEntryPoint is a spoke: this node owns a tun device whose IP packets
	// ride a p2p datagram tunnel to a hub's public key.
	TunEntryPoint = "tun"
)

var (
	ErrEntryPointClosed = errors.New("entrypoint closed")
)

// EntryPoint is an alias for tunnel.Tunnel used by entrypoint types.
type EntryPoint = tunnel.Tunnel

// restore starts one restored entrypoint, and closes it if it cannot start —
// the same fate a config load has always given a broken entrypoint.
//
// The one exception is an Android tun entrypoint, whose device belongs to the
// app's VpnService. The app learns what device to build by reading this
// backend's /api/entrypoints, and this backend only starts listening once every
// restored entrypoint has been started (see Start) — so waiting inline for that
// device starves the very wait (tun.go's vpnDeviceWait) it depends on, and
// marks the entrypoint failed on every cold start. Starting it in the
// background lets the API answer, the VPN come up and the device arrive while
// the entrypoint is still waiting for it.
func restore(goos string, ep EntryPoint) {
	fail := func(err error) {
		if err != nil {
			slog.Error("start entrypoint", "name", ep.Name(), "err", err)
			event.Record(ep.ID(), event.LevelError, "start failed: %v", err)
			ep.Close()
		}
	}

	if restoreAsync(goos, ep) {
		go func() { fail(ep.Run()) }()
		return
	}
	fail(ep.Run())
}

// restoreAsync reports whether a restored entrypoint starts off the startup
// path: an Android tun one, and nothing else — a device elsewhere is local, and
// a p2p entrypoint binds a socket, so both are best reported at boot.
func restoreAsync(goos string, ep EntryPoint) bool {
	return goos == "android" && ep.Type() == TunEntryPoint
}

// Start begins an entrypoint that was just created, updated or started. It is
// restore's contract for that case: inline everywhere but an Android tun
// entrypoint, which runs in the background so the caller — an API handler, or
// the app's own restore — returns while the entrypoint is already listed. The
// app brings the device up for a *running* tun entrypoint, and it cannot see
// one that has not been added yet, so a caller that blocks on the device
// starves the very wait it is in: Run's device wait expires and the start
// fails with "no device fd".
//
// A start that cannot complete closes the entrypoint, which is how the callers'
// own Run error path reported it.
func Start(ep EntryPoint) {
	restore(runtime.GOOS, ep)
}

// CheckTunDeviceFree reports whether an entrypoint with this ID may use the tun
// device. Android gives an app a single VPN device, so a second tun entrypoint
// cannot work: both would read the same device and take each other's packets.
// The web API checks this before an answer, so a request that cannot work is
// refused with the name of the entrypoint holding the device — instead of being
// accepted and leaving the running one broken.
func CheckTunDeviceFree(id string) error {
	ownerID, ownerName := tunnel.TunDeviceOwner()
	if ownerID == "" || ownerID == id {
		return nil
	}
	return fmt.Errorf("another tun entrypoint (%s) is already running: stop it first", ownerName)
}

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
			event.Seed(id, nil)
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
		index         int
		opts          tunnel.Options
		fav           bool
		stats         config.ServiceStats
		statsBaseline config.ServiceStats
	}

	var pending []restartInfo

	// Phase 1: close all running entrypoints and collect their info.
	for i := 0; i < Count(); i++ {
		ep := GetIndex(i)
		if ep == nil || ep.IsClosed() {
			continue
		}
		pending = append(pending, restartInfo{
			index:         i,
			opts:          ep.Options(),
			fav:           ep.IsFavorite(),
			stats:         ep.Stats(),
			statsBaseline: ep.StatsBaseline(),
		})
		ep.Close()
	}

	// Phase 2: start new entrypoints with the updated config.
	for _, p := range pending {
		newEP := createEntryPoint(entryPoints.list[p.index].Type(), tunnel.Options{
			ID:            p.opts.ID,
			Name:          p.opts.Name,
			Endpoint:      p.opts.Endpoint,
			Hostname:      p.opts.Hostname,
			Username:      p.opts.Username,
			Password:      p.opts.Password,
			EnableTLS:     p.opts.EnableTLS,
			Keepalive:     p.opts.Keepalive,
			TTL:           p.opts.TTL,
			RecordMode:    p.opts.RecordMode,
			Peer:          p.opts.Peer,
			Protocol:      p.opts.Protocol,
			Peers:         p.opts.Peers,
			Net:           p.opts.Net,
			MTU:           p.opts.MTU,
			DeviceName:    p.opts.DeviceName,
			Routes:        p.opts.Routes,
			DNS:           p.opts.DNS,
			CreatedAt:     p.opts.CreatedAt,
			StatsBaseline: p.statsBaseline,
		})
		if newEP == nil {
			continue
		}

		newEP.SetStats(p.stats)
		newEP.SetStatsBaseline(p.statsBaseline)
		newEP.Favorite(p.fav)

		Set(newEP)
		Start(newEP)
	}

	if err := SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}
}

// LoadConfig loads entrypoints from the persisted configuration.
func LoadConfig() {
	for _, cfg := range config.Get().EntryPoints {
		if cfg == nil {
			continue
		}

		ep := createEntryPoint(cfg.Type, tunnel.Options{
			ID:            cfg.ID,
			Name:          cfg.Name,
			Endpoint:      cfg.Endpoint,
			Hostname:      cfg.Hostname,
			Username:      cfg.Username,
			Password:      cfg.Password,
			EnableTLS:     cfg.EnableTLS,
			Keepalive:     cfg.Keepalive,
			TTL:           cfg.TTL,
			RecordMode:    cfg.RecordMode,
			Peer:          cfg.Peer,
			Protocol:      cfg.Protocol,
			Peers:         cfg.Peers,
			Net:           cfg.Net,
			MTU:           cfg.MTU,
			DeviceName:    cfg.DeviceName,
			Routes:        cfg.Routes,
			DNS:           cfg.DNS,
			CreatedAt:     cfg.CreatedAt,
			Stats:         cfg.Stats,
			StatsBaseline: cfg.StatsBaseline,
		})
		if ep == nil {
			continue
		}

		event.Seed(cfg.ID, cfg.Events)

		if cfg.Closed {
			ep.Close()
		} else {
			restore(runtime.GOOS, ep)
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
			ID:            ep.ID(),
			Name:          ep.Name(),
			Type:          ep.Type(),
			Endpoint:      ep.Entrypoint(),
			Hostname:      opts.Hostname,
			Username:      opts.Username,
			Password:      opts.Password,
			EnableTLS:     opts.EnableTLS,
			Keepalive:     opts.Keepalive,
			TTL:           opts.TTL,
			RecordMode:    opts.RecordMode,
			Peer:          opts.Peer,
			Protocol:      opts.Protocol,
			Net:           opts.Net,
			MTU:           opts.MTU,
			DeviceName:    opts.DeviceName,
			Routes:        opts.Routes,
			DNS:           opts.DNS,
			Favorite:      ep.IsFavorite(),
			Closed:        ep.IsClosed(),
			CreatedAt:     opts.CreatedAt,
			Stats:         ep.Stats(),
			StatsBaseline: ep.StatsBaseline(),
			Events:        event.List(ep.ID()),
		})
	}

	cfg.Events = event.ListGlobal()

	config.Set(cfg)

	if err := cfg.Write(); err != nil {
		slog.Error("write config", "err", err)
		return err
	}
	return nil
}

// NewByType constructs an entrypoint of the given type; nil for an unknown
// type. It is the single place the type strings map to constructors.
func NewByType(st string, options ...tunnel.Option) EntryPoint {
	switch st {
	case TCPEntryPoint:
		return NewTCPEntryPoint(options...)
	case UDPEntryPoint:
		return NewUDPEntryPoint(options...)
	case P2PEntryPoint:
		return NewP2PEntryPoint(options...)
	case TunEntryPoint:
		return NewTunEntryPoint(options...)
	}
	return nil
}

func createEntryPoint(st string, opts tunnel.Options) (ep EntryPoint) {
	options := append(tunnel.TunnelOptions(opts), tunnel.StatsBaselineOption(opts.StatsBaseline))

	ep = NewByType(st, options...)
	if ep == nil {
		return nil
	}

	ep.SetStats(opts.Stats)
	ep.SetStatsBaseline(opts.StatsBaseline)
	return
}
