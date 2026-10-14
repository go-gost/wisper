package task

import (
	"testing"
	"time"

	"github.com/go-gost/wisper/event"
)

// TestLivenessTick pins the hub-liveness watchdog's decision table.
//
// The frozen rule: only byte deltas matter. Dual-zero is idle (silent),
// uplink-without-downlink sustained past the event line warns once,
// any downlink recovers and re-arms. Absolute totals never participate,
// so a hub that dies mid-run (history non-zero) is judged the same as
// one that never came up.
func TestLivenessTick(t *testing.T) {
	tick := time.Second
	now := time.Now()

	t.Run("seed stays silent", func(t *testing.T) {
		st := &livenessState{}
		if warn, rec := livenessTick(st, 0, 0, now, tick); warn || rec {
			t.Fatal("seed must not report")
		}
	})

	t.Run("dual zero is idle, never warns", func(t *testing.T) {
		st := &livenessState{}
		at := now
		livenessTick(st, 0, 0, at, tick) // seed
		for i := 0; i < 300; i++ {
			at = at.Add(tick)
			if warn, rec := livenessTick(st, 0, 0, at, tick); warn || rec {
				t.Fatalf("idle tick %d reported warn=%v recovered=%v", i, warn, rec)
			}
		}
	})

	t.Run("uplink without downlink warns once at the line", func(t *testing.T) {
		st := &livenessState{}
		at := now
		livenessTick(st, 0, 0, at, tick) // seed
		var warnedAt int
		warns := 0
		for i := 1; i <= 120; i++ {
			at = at.Add(tick)
			warn, rec := livenessTick(st, 100, 0, at, tick)
			if rec {
				t.Fatalf("tick %d recovered with no downlink", i)
			}
			if warn {
				warns++
				if warnedAt == 0 {
					warnedAt = i
				}
			}
		}
		if warnedAt != 60 {
			t.Errorf("first warn at tick %d, want 60", warnedAt)
		}
		if warns != 1 {
			t.Errorf("warned %d times, want exactly once per episode", warns)
		}
	})

	t.Run("any downlink recovers and re-arms", func(t *testing.T) {
		st := &livenessState{}
		at := now
		livenessTick(st, 0, 0, at, tick) // seed
		for i := 0; i < 60; i++ {
			at = at.Add(tick)
			livenessTick(st, 100, 0, at, tick)
		}
		at = at.Add(tick)
		warn, rec := livenessTick(st, 100, 50, at, tick)
		if warn || !rec {
			t.Fatalf("downlink must recover silently: warn=%v recovered=%v", warn, rec)
		}
		// Re-armed: a fresh episode warns again.
		warned := false
		for i := 0; i < 60; i++ {
			at = at.Add(tick)
			if warn, _ := livenessTick(st, 100, 0, at, tick); warn {
				warned = true
			}
		}
		if !warned {
			t.Fatal("second episode never warned after re-arm")
		}
	})

	t.Run("downlink alone never warns", func(t *testing.T) {
		st := &livenessState{}
		at := now
		livenessTick(st, 0, 0, at, tick) // seed
		for i := 0; i < 120; i++ {
			at = at.Add(tick)
			if warn, _ := livenessTick(st, 0, 50, at, tick); warn {
				t.Fatalf("tick %d warned on downlink-only traffic", i)
			}
		}
	})

	t.Run("idle resets the streak", func(t *testing.T) {
		st := &livenessState{}
		at := now
		livenessTick(st, 0, 0, at, tick) // seed
		for i := 0; i < 59; i++ {
			at = at.Add(tick)
			livenessTick(st, 100, 0, at, tick)
		}
		// One idle tick breaks the streak: 59 more must not warn.
		at = at.Add(tick)
		livenessTick(st, 0, 0, at, tick)
		for i := 0; i < 59; i++ {
			at = at.Add(tick)
			if warn, _ := livenessTick(st, 100, 0, at, tick); warn {
				t.Fatalf("tick %d warned: idle did not reset the streak", i)
			}
		}
	})

	t.Run("tick scales the line", func(t *testing.T) {
		st := &livenessState{}
		at := now
		big := 30 * time.Second
		livenessTick(st, 0, 0, at, big) // seed
		at = at.Add(big)
		if warn, _ := livenessTick(st, 100, 0, at, big); warn {
			t.Fatal("one 30s miss must stay silent (event line is 60s)")
		}
		at = at.Add(big)
		if warn, rec := livenessTick(st, 100, 0, at, big); !warn || rec {
			t.Fatalf("two 30s misses = 60s: warn=%v recovered=%v", warn, rec)
		}
	})
}

// TestLivenessDecideProbeSilence pins the order the two watchdogs' claims come
// in, which is the reporting half of a live outage: the phone showed
// "hub 无回流：只发包、无回包" while packets moved both ways, and the warn on
// the record could never be taken back.
//
// The sequence that produced it: the warn fired (the probe was still fine),
// the probe stalled on the next reconnect, and from then on the probe's own
// early return kept this watchdog silent — including the recovery, which is
// the one thing that clears the banner. The device probe answers nothing on
// this setup (441 sent, 0 acked), so the silence was permanent.
func TestLivenessDecideProbeSilence(t *testing.T) {
	tick := time.Second
	now := time.Now()

	t.Run("a stalled probe silences a new warning", func(t *testing.T) {
		st := &livenessState{}
		livenessDecide(st, 10, 0, false, now, tick) // seed through the same door
		for i := 0; i < 60; i++ {
			if got := livenessDecide(st, 10, 0, true, now, tick); got != livenessQuiet {
				t.Fatalf("tick %d = %v with the probe stalled, want quiet", i, got)
			}
		}
	})

	t.Run("it does not retract the hub's answer", func(t *testing.T) {
		st := &livenessState{}
		livenessDecide(st, 10, 0, false, now, tick) // seed
		// The warn the phone recorded, while the probe was still answering.
		var warned bool
		for i := 0; i < 60 && !warned; i++ {
			warned = livenessDecide(st, 10, 0, false, now, tick) == livenessWarn
		}
		if !warned {
			t.Fatal("the warn never fired, so this test proves nothing")
		}
		// The probe stalls on a reconnect and never answers again. The hub is
		// returning traffic throughout.
		if got := livenessDecide(st, 10, 50, true, now, tick); got != livenessRecover {
			t.Errorf("with the probe stalled and the downlink moving, the action = %v, want recovered", got)
		}
		if st.reported {
			t.Error("the warn is still on the record after the recovery")
		}
	})

}

// TestStandingWarn pins the reading of the history the banner is drawn from.
// A restart re-seeds the watchdog's own state but not the history, so the only
// thing that says a stall is still on is the newest verdict already written
// there — and it has to be read the way the UI reads it, or the backend
// retracts a warn the operator is not being shown.
func TestStandingWarn(t *testing.T) {
	const id = "tun-liveness-history"
	seed := func(msgs ...string) {
		event.Seed(id, nil)
		for i, m := range msgs {
			event.Record(id, event.LevelWarn, "%s", m) // level is irrelevant here
			_ = i
		}
	}

	t.Run("nothing on record is no warn", func(t *testing.T) {
		event.Seed(id, nil)
		if standingWarn(id) {
			t.Error("an empty history reported a standing warn")
		}
	})

	t.Run("the newest verdict decides", func(t *testing.T) {
		seed(msgLivenessNoReflow, "some other event", msgLivenessRecovered)
		if standingWarn(id) {
			t.Error("a recovery after the warn left the warn standing")
		}
		seed(msgLivenessRecovered, msgLivenessNoReflow)
		if !standingWarn(id) {
			t.Error("a warn after the recovery did not stand")
		}
	})

	t.Run("a coalesced repeat still counts", func(t *testing.T) {
		// Record folds an identical message into one row whose count rides
		// separately, so the message alone must be enough to read it.
		seed(msgLivenessNoReflow, msgLivenessNoReflow, msgLivenessNoReflow)
		if !standingWarn(id) {
			t.Error("three identical warns read as nothing")
		}
	})

	t.Run("unrelated events are not a verdict", func(t *testing.T) {
		seed("peer connected", "kernel NAT unavailable", msgLivenessRecovered)
		if standingWarn(id) {
			t.Error("unrelated rows were read as a warn")
		}
	})
	event.Seed(id, nil)
}
