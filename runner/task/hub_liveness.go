package task

import (
	"time"

	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// Liveness watchdog thresholds. Compared against stalled time (misses × tick),
// never raw tick counts, so a reconfigured StatsInterval keeps the same
// wall-clock meaning — the same shape as the probe watchdog's.
const (
	livenessEventAfter = 60 * time.Second
)

// Event texts are constants — no counts in them — so consecutive triggers
// coalesce into a single "×N" row instead of a flood.
const (
	msgLivenessNoReflow  = "tun uplink without downlink: hub not returning traffic"
	msgLivenessRecovered = "tun downlink recovered"
)

// livenessState tracks one tun entrypoint's uplink-without-downlink streak.
// Only byte deltas feed it: absolute totals never participate, so a hub that
// dies mid-run (history non-zero) is judged exactly like one that never came
// up. Dual-zero ticks are idle and reset the streak.
type livenessState struct {
	misses   int
	reported bool
	seeded   bool
}

// livenessTick is the watchdog's whole decision: pure, so the table test pins
// every line. The first sample only seeds the baseline and stays silent; any
// downlink recovers (and re-arms a previous report); an idle tick resets the
// streak; sustained uplink without downlink past the event line warns once per
// episode.
func livenessTick(st *livenessState, upDelta, downDelta uint64, now time.Time, tick time.Duration) (warn, recovered bool) {
	if !st.seeded {
		st.seeded = true
		return false, false
	}
	if downDelta > 0 {
		if st.reported {
			st.reported = false
			st.misses = 0
			return false, true
		}
		st.misses = 0
		return false, false
	}
	if upDelta == 0 {
		st.misses = 0
		return false, false
	}
	st.misses++
	if stalled := time.Duration(st.misses) * tick; stalled >= livenessEventAfter && !st.reported {
		st.reported = true
		return true, false
	}
	return false, false
}

// checkLiveness runs the hub-liveness watchdog for one entrypoint. Only a
// running tun entrypoint is watched: any downlink byte proves the hub side
// returns traffic, sustained uplink without any is the signal, and dual-zero
// is idle. A probe-stalled device is the higher suspect — the device probe
// proves only the local fd — so while the probe watchdog's stall report
// stands, this stays silent rather than blaming the hub for a dead device.
// A service already in failed state is skipped the same way: its error banner
// is the message.
func (t *updateStatsTask) checkLiveness(ep tunnel.Tunnel, upDelta, downDelta uint64) {
	if ep == nil || ep.Type() != entrypoint.TunEntryPoint || ep.IsClosed() {
		return
	}
	if tunnel.IsServiceFailed(ep) {
		return
	}
	if ps := t.probe[ep.ID()]; ps != nil && ps.reported {
		return
	}
	if t.liveness == nil {
		t.liveness = map[string]*livenessState{}
	}
	id := ep.ID()
	st := t.liveness[id]
	if st == nil {
		st = &livenessState{}
		t.liveness[id] = st
	}
	warn, recovered := livenessTick(st, upDelta, downDelta, time.Now(), probeTickInterval())
	if warn {
		event.Record(id, event.LevelWarn, "%s", msgLivenessNoReflow)
		return
	}
	if recovered {
		event.Record(id, event.LevelInfo, "%s", msgLivenessRecovered)
	}
}
