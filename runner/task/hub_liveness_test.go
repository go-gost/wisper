package task

import (
	"testing"
	"time"
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
