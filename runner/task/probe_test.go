package task

import (
	"testing"
	"time"
)

func TestProbeTick(t *testing.T) {
	tick := time.Second
	now := time.Now()

	t.Run("advance clears", func(t *testing.T) {
		st := &probeState{}
		if ev, rs := probeTick(st, 0, now, tick); ev || rs {
			t.Fatal("seed must not report")
		}
		if ev, rs := probeTick(st, 5, now.Add(tick), tick); ev || rs {
			t.Fatal("advance must not report")
		}
		if st.misses != 0 {
			t.Fatalf("misses=%d after advance", st.misses)
		}
	})

	t.Run("stall events once then restarts", func(t *testing.T) {
		st := &probeState{}
		at := now
		probeTick(st, 7, at, tick) // seed
		var eventAt, restartAt int
		for i := 1; i <= 130; i++ {
			at = at.Add(tick)
			ev, rs := probeTick(st, 7, at, tick)
			if ev && eventAt == 0 {
				eventAt = i
			}
			if rs && restartAt == 0 {
				restartAt = i
			}
			if ev && i != eventAt && i != restartAt {
				t.Fatalf("repeat event at tick %d", i)
			}
		}
		if eventAt != 60 {
			t.Errorf("first event at tick %d, want 60", eventAt)
		}
		if restartAt != 120 {
			t.Errorf("restart at tick %d, want 120", restartAt)
		}
	})

	t.Run("cooldown suppresses restart", func(t *testing.T) {
		st := &probeState{}
		at := now
		probeTick(st, 7, at, tick)
		for i := 1; i <= 120; i++ {
			at = at.Add(tick)
			probeTick(st, 7, at, tick)
		}
		if st.lastRestart.IsZero() {
			t.Fatal("restart should have fired at tick 120")
		}
		// Keep stalling inside the 10min cooldown: event once, never restart.
		restarts := 0
		events := 0
		for i := 121; i <= 300; i++ {
			at = at.Add(tick)
			ev, rs := probeTick(st, 7, at, tick)
			if ev {
				events++
			}
			if rs {
				restarts++
			}
		}
		if restarts != 0 {
			t.Errorf("restarted %d times inside cooldown", restarts)
		}
		if events != 0 {
			t.Errorf("re-evented %d times inside cooldown", events)
		}
	})

	t.Run("recovery re-arms", func(t *testing.T) {
		st := &probeState{}
		at := now
		probeTick(st, 7, at, tick)
		for i := 1; i <= 60; i++ {
			at = at.Add(tick)
			probeTick(st, 7, at, tick)
		}
		at = at.Add(tick)
		if ev, rs := probeTick(st, 8, at, tick); ev || rs {
			t.Fatal("advance after event must stay silent")
		}
		at = at.Add(tick)
		ev, rs := probeTick(st, 8, at, tick)
		if ev || rs {
			t.Fatal("single miss after recovery must stay silent")
		}
	})

	t.Run("tick scales thresholds", func(t *testing.T) {
		st := &probeState{}
		at := now
		big := 30 * time.Second
		probeTick(st, 7, at, big)
		at = at.Add(big)
		if ev, _ := probeTick(st, 7, at, big); ev {
			t.Fatal("one 30s miss must stay silent (event line is 60s)")
		}
		at = at.Add(big)
		if ev, rs := probeTick(st, 7, at, big); !ev || rs {
			t.Fatalf("two 30s misses = 60s: event=%v restart=%v", ev, rs)
		}
	})
}
