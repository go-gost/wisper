package task

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	stats_pkg "github.com/go-gost/core/observer/stats"
	"github.com/go-gost/p2p"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/runner"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

type updateStatsTask struct {
	// Last tick's samples, for transition detection. Nil until the first tick,
	// whose observation of anything is seeded rather than reported.
	service   map[string]serviceState
	peers     map[string]string
	punches   map[string]p2p.PeerPunch
	relay     relaySample
	relaySeen bool
	hostOn    bool
	hostSet   bool
}

// UpdateStats returns a task that polls service stats.
func UpdateStats() runner.Task {
	return &updateStatsTask{}
}

func (t *updateStatsTask) ID() runner.TaskID {
	return runner.TaskUpdateStats
}

func (t *updateStatsTask) Run(context.Context) error {
	// Ahead of the saves below, so this tick's events are persisted by the same
	// SaveConfig that already runs every tick.
	t.observeTransitions()

	if err := t.updateTunnel(); err != nil {
		slog.Error("stats", "err", err)
	}
	if err := t.updateEntrypoint(); err != nil {
		slog.Error("stats", "err", err)
	}
	return nil
}

func (t *updateStatsTask) updateTunnel() error {
	for i := 0; i < tunnel.Count(); i++ {
		tun := tunnel.GetIndex(i)
		if tun == nil {
			continue
		}

		status := tun.Status()
		if status == nil {
			continue
		}

		// p2p tunnels also break their traffic down per peer; the same tick
		// turns those counters into rates.
		if u, ok := tun.(tunnel.PeerStatsUpdater); ok {
			u.UpdatePeerStats()
		}

		oldStats := tun.Stats()

		d := time.Since(oldStats.Time)
		if d <= 0 {
			continue
		}

		stats := config.ServiceStats{}

		if s := status.Stats(); s != nil {
			stats.CurrentConns = s.Get(stats_pkg.KindCurrentConns)
			stats.InputBytes = s.Get(stats_pkg.KindInputBytes)
			stats.OutputBytes = s.Get(stats_pkg.KindOutputBytes)
			stats.TotalConns = s.Get(stats_pkg.KindTotalConns)
			stats.TotalErrs = s.Get(stats_pkg.KindTotalErrs)
			stats.Time = time.Now()
		}

		inputRateBytes := int64(stats.InputBytes) - int64(oldStats.InputBytes)
		if inputRateBytes < 0 {
			inputRateBytes = 0
		}
		stats.InputRateBytes = uint64(float64(inputRateBytes) / d.Seconds())

		outputRateBytes := int64(stats.OutputBytes) - int64(oldStats.OutputBytes)
		if outputRateBytes < 0 {
			outputRateBytes = 0
		}
		stats.OutputRateBytes = uint64(float64(outputRateBytes) / d.Seconds())

		reqRate := int64(stats.TotalConns) - int64(oldStats.TotalConns)
		if reqRate < 0 {
			reqRate = 0
		}
		stats.RequestRate = float64(reqRate) / d.Seconds()

		tun.SetStats(stats)
	}

	return tunnel.SaveConfig()
}

func (t *updateStatsTask) updateEntrypoint() error {
	for i := 0; i < entrypoint.Count(); i++ {
		ep := entrypoint.GetIndex(i)
		if ep == nil {
			continue
		}

		status := ep.Status()
		if status == nil {
			continue
		}

		oldStats := ep.Stats()

		d := time.Since(oldStats.Time)
		if d <= 0 {
			continue
		}

		stats := config.ServiceStats{}

		if s := status.Stats(); s != nil {
			stats.CurrentConns = s.Get(stats_pkg.KindCurrentConns)
			stats.InputBytes = s.Get(stats_pkg.KindInputBytes)
			stats.OutputBytes = s.Get(stats_pkg.KindOutputBytes)
			stats.TotalConns = s.Get(stats_pkg.KindTotalConns)
			stats.TotalErrs = s.Get(stats_pkg.KindTotalErrs)
			stats.Time = time.Now()
		}

		inputRateBytes := int64(stats.InputBytes) - int64(oldStats.InputBytes)
		if inputRateBytes < 0 {
			inputRateBytes = 0
		}
		stats.InputRateBytes = uint64(float64(inputRateBytes) / d.Seconds())

		outputRateBytes := int64(stats.OutputBytes) - int64(oldStats.OutputBytes)
		if outputRateBytes < 0 {
			outputRateBytes = 0
		}
		stats.OutputRateBytes = uint64(float64(outputRateBytes) / d.Seconds())

		reqRate := int64(stats.TotalConns) - int64(oldStats.TotalConns)
		if reqRate < 0 {
			reqRate = 0
		}
		stats.RequestRate = float64(reqRate) / d.Seconds()

		ep.SetStats(stats)
	}

	return entrypoint.SaveConfig()
}

// observeTransitions records what changed since the previous tick: a service
// leaving or rejoining the running state, a p2p peer moving between transports
// or losing a direct session, the relay going down or coming back, and the
// shared p2p host starting or stopping.
func (t *updateStatsTask) observeTransitions() {
	cur := make(map[string]serviceState)
	cands := make([]peerCand, 0, tunnel.Count()+entrypoint.Count())

	for i := 0; i < tunnel.Count(); i++ {
		observeObject(tunnel.GetIndex(i), cur, &cands)
	}
	for i := 0; i < entrypoint.Count(); i++ {
		observeObject(entrypoint.GetIndex(i), cur, &cands)
	}

	for _, c := range diffServiceState(t.service, cur) {
		if c.Failed {
			event.Record(c.ID, event.LevelError, "service failed: %s", c.Message)
		} else {
			event.Record(c.ID, event.LevelInfo, "service recovered")
		}
	}
	t.service = cur

	on := tunnel.P2PHostRunning()
	if t.hostSet && on != t.hostOn {
		if on {
			event.Global(event.LevelInfo, "p2p host started")
		} else {
			event.Global(event.LevelInfo, "p2p host stopped")
		}
	}
	t.hostOn, t.hostSet = on, true

	if !on {
		// The host is down, so every peer session died with it and the host
		// event above already says so. Forget the baselines instead of
		// reporting a burst of disconnects for sessions that no longer exist,
		// and re-seed the relay on the next start rather than reading the zero
		// Status as an outage.
		t.peers, t.punches, t.relaySeen = nil, nil, false
		return
	}

	// One Status covers every p2p tunnel and entrypoint: the host is shared.
	st := tunnel.P2PHostStatus()
	if !tunnel.P2PHostRunning() {
		// The host was released between the two reads above, so this zero
		// Status is the teardown, not an outage: take the same reset path the
		// host-down branch does. The stop itself is reported next tick.
		t.peers, t.punches, t.relaySeen = nil, nil, false
		return
	}

	for _, c := range diffPeerTransports(t.peers, st.PeerTransports) {
		level, msg := peerChangeMessage(c, peerDisplayOf(c.Key, cands))
		recordFor(c.Key, cands, level, msg)
	}
	t.peers = st.PeerTransports

	// A drop counter moving is a live direct session ending. Unlike a gauge, a
	// counter survives a gap between samples — though not a peer whose
	// directConn is torn down before this tick looks, which takes its counters
	// with it.
	for _, d := range diffPunchDrops(t.punches, st.PeerPunches) {
		msg := fmt.Sprintf("peer %s: direct session dropped (%d)", peerDisplayOf(d.Key, cands), d.Drops)
		recordFor(d.Key, cands, event.LevelWarn, msg)
	}

	// A failed-round counter moving is a punch that did not reach a direct
	// session and will be retried on the engine's backoff — the retries a peer
	// that cannot punch keeps making, invisible in the one-shot "failed" gauge.
	recordPunchFailures(diffPunchFailures(t.punches, st.PeerPunches), cands)
	t.punches = st.PeerPunches

	relay := relaySample{connected: st.RelayConnected, err: st.RelayError}
	for _, c := range diffRelay(t.relay, t.relaySeen, relay) {
		switch {
		case c.Connected:
			event.Global(event.LevelInfo, "relay restored")
		case c.Err != "":
			event.Global(event.LevelError, "relay disconnected: %s", c.Err)
		default:
			// The connection died but the redial has not failed yet, so there
			// is no reason to quote: measured against a real relay, the engine
			// drops the client immediately and only records dialErr on its next
			// 5-second attempt. The text arrives as a second change.
			event.Global(event.LevelError, "relay disconnected")
		}
	}
	t.relay, t.relaySeen = relay, true
}

// peerDisplayOf names a peer for an event message, using the owning object's
// alias when it has one.
func peerDisplayOf(key string, cands []peerCand) string {
	cand, ok := ownerOfPeer(key, cands)
	return peerDisplay(key, cand, ok)
}

// recordFor files a peer event on the object that owns the key, or globally
// when no object claims it.
func recordFor(key string, cands []peerCand, level, msg string) {
	if cand, ok := ownerOfPeer(key, cands); ok {
		event.Record(cand.ID, level, "%s", msg)
		return
	}
	event.Global(level, "%s", msg)
}

// recordPunchFailures files one warning per failed round. The message is
// constant — the count must not be in it — so that consecutive rounds coalesce
// into a single "×N" row instead of a flood.
func recordPunchFailures(failures []punchFailure, cands []peerCand) {
	for _, f := range failures {
		msg := fmt.Sprintf("peer %s: punch failed", peerDisplayOf(f.Key, cands))
		for i := int64(0); i < f.Failures; i++ {
			recordFor(f.Key, cands, event.LevelWarn, msg)
		}
	}
}

// observeObject samples one tunnel or entrypoint into cur, and adds it to this
// tick's peer-attribution candidates.
func observeObject(t tunnel.Tunnel, cur map[string]serviceState, cands *[]peerCand) {
	if t == nil {
		return
	}
	id := t.ID()

	st := serviceState{failed: tunnel.IsServiceFailed(t)}
	if st.failed {
		st.err = tunnel.ServiceErrorMessage(t)
	}
	cur[id] = st

	opts := t.Options()
	*cands = append(*cands, peerCand{
		ID:      id,
		Peers:   opts.Peers,
		Peer:    opts.Peer,
		Aliases: opts.PeerAliases,
	})
}
