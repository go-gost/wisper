package task

import (
	"time"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// Probe watchdog thresholds. Compared against stalled time (misses × tick),
// never raw tick counts, so a reconfigured StatsInterval keeps the same
// wall-clock meaning.
const (
	probeEventAfter   = 60 * time.Second
	probeRestartAfter = 120 * time.Second
	probeCooldown     = 10 * time.Minute
)

// Event texts are constants — no counts in them — so consecutive triggers
// coalesce into a single "×N" row instead of a flood.
const (
	msgProbeStalled   = "tun probe stalled: acks not advancing"
	msgProbeRestarted = "tun probe stalled: entrypoint restarted"
)

type probeState struct {
	lastAcked   uint64
	misses      int
	lastRestart time.Time
	reported    bool
	seeded      bool
}

// probeTick is the watchdog's whole decision: pure, so the table test pins
// every line. The first sample only seeds the baseline and stays silent; an
// advancing acked clears the stall and re-arms the one-shot event; a stall
// past the event line reports once; a stall past the restart line restarts
// unless the cooldown from the previous restart has not elapsed.
func probeTick(st *probeState, acked uint64, now time.Time, tick time.Duration) (event, restart bool) {
	if !st.seeded {
		st.seeded = true
		st.lastAcked = acked
		return false, false
	}
	if acked != st.lastAcked {
		st.lastAcked = acked
		st.misses = 0
		st.reported = false
		return false, false
	}
	st.misses++
	stalled := time.Duration(st.misses) * tick
	if stalled >= probeRestartAfter && now.Sub(st.lastRestart) > probeCooldown {
		st.lastRestart = now
		st.reported = true
		return true, true
	}
	if stalled >= probeEventAfter && !st.reported {
		st.reported = true
		return true, false
	}
	return false, false
}

// probeTickInterval is the stats tick the watchdog counts in wall-clock
// terms. Read per call: Settings.StatsInterval is reconfigurable at runtime.
func probeTickInterval() time.Duration {
	if s := config.Get().Settings; s != nil && s.StatsInterval > 0 {
		return time.Duration(s.StatsInterval) * time.Second
	}
	return time.Second
}

// checkProbe runs the watchdog for one entrypoint. Only a running tun
// entrypoint with the probe switch on is watched; the hub-side tun tunnel
// has no probe and never reaches here. A restart that loses the race with a
// concurrent close returns nil and stays silent rather than recording a
// restart that never happened.
func (t *updateStatsTask) checkProbe(ep tunnel.Tunnel) {
	if ep == nil || ep.Type() != entrypoint.TunEntryPoint || ep.IsClosed() || !ep.Options().Probe {
		return
	}
	if t.probe == nil {
		t.probe = map[string]*probeState{}
	}
	id := ep.ID()
	st := t.probe[id]
	if st == nil {
		st = &probeState{}
		t.probe[id] = st
	}
	ev, rs := probeTick(st, ep.Stats().ProbeAcked, time.Now(), probeTickInterval())
	if rs {
		if entrypoint.Restart(id) == nil {
			return
		}
		event.Record(id, event.LevelWarn, "%s", msgProbeRestarted)
		return
	}
	if ev {
		event.Record(id, event.LevelWarn, "%s", msgProbeStalled)
	}
}
