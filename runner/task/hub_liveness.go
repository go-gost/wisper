package task

import (
	"strings"
	"time"

	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// Liveness watchdog thresholds. Compared against stalled time (misses × tick),
// never raw tick counts, so a reconfigured StatsInterval keeps the same
// wall-clock meaning.
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

// livenessAction is what one tick's deltas say once every gate is applied:
// file a warning, retract the one on the record, or say nothing.
type livenessAction int

const (
	livenessQuiet livenessAction = iota
	livenessWarn
	livenessRecover
)

// livenessDecide applies the tick's verdict to the action the runner takes.
func livenessDecide(st *livenessState, upDelta, downDelta uint64, now time.Time, tick time.Duration) livenessAction {
	warn, recovered := livenessTick(st, upDelta, downDelta, now, tick)
	switch {
	case recovered:
		return livenessRecover
	case warn:
		return livenessWarn
	}
	return livenessQuiet
}

// standingWarn is the liveness verdict the history still answers with: the
// newest one, when that verdict is a warn. The UI reads it the same way (see
// _hubNoReflow in the entrypoint detail page), so a warn this function reports
// is a warn the operator is looking at.
//
// Oldest-first list, newest verdict scanned first, and the first verdict found
// decides — the same rule the UI follows, because the two must not disagree
// about whether a stall is on.
func standingWarn(id string) bool {
	list := event.List(id)
	for i := len(list) - 1; i >= 0; i-- {
		switch msg := list[i].Message; {
		case strings.Contains(msg, msgLivenessNoReflow):
			return true
		case strings.Contains(msg, msgLivenessRecovered):
			return false
		}
	}
	return false
}

// checkLiveness runs the hub-liveness watchdog for one entrypoint. Only a
// running tun entrypoint is watched: any downlink byte proves the hub side
// returns traffic, sustained uplink without any is the signal, and dual-zero
// is idle. A service already in failed state is skipped: its error banner is
// the message.
func (t *updateStatsTask) checkLiveness(ep tunnel.Tunnel, upDelta, downDelta uint64) {
	if ep == nil || ep.Type() != entrypoint.TunEntryPoint || ep.IsClosed() {
		return
	}
	if tunnel.IsServiceFailed(ep) {
		return
	}
	id := ep.ID()
	if t.liveness == nil {
		t.liveness = map[string]*livenessState{}
	}
	st := t.liveness[id]
	fresh := st == nil
	if st == nil {
		st = &livenessState{}
		t.liveness[id] = st
	}
	// A restart re-seeds this watchdog's state but not the event history, and
	// the history is what the banner reads: a warn recorded before the restart
	// keeps showing with nothing on the record to retract it, so the operator
	// is told the hub is silent for as long as the app stays up. The first tick
	// of a fresh watchdog retracts it when the downlink is already moving —
	// the very fact that makes the warn false, reported the moment it is known
	// instead of waiting for the link to flap and warn all over again.
	if fresh && downDelta > 0 && standingWarn(id) {
		st.seeded = true
		st.misses = 0
		st.reported = false
		event.Record(id, event.LevelInfo, "%s", msgLivenessRecovered)
		return
	}
	switch livenessDecide(st, upDelta, downDelta, time.Now(), statsTickInterval()) {
	case livenessWarn:
		event.Record(id, event.LevelWarn, "%s", msgLivenessNoReflow)
	case livenessRecover:
		event.Record(id, event.LevelInfo, "%s", msgLivenessRecovered)
	}
}
