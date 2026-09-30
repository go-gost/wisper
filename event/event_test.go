package event

import "testing"

// reset clears the store between cases; the store is process-wide.
func reset() {
	store = &storeT{objects: make(map[string][]Event)}
}

func TestRecordOrdersAndCaps(t *testing.T) {
	reset()

	for i := 0; i < maxObjectEvents+5; i++ {
		Record("t1", LevelInfo, "event %d", i)
	}

	got := List("t1")
	if len(got) != maxObjectEvents {
		t.Fatalf("len = %d, want %d", len(got), maxObjectEvents)
	}
	if got[0].Message != "event 5" {
		t.Errorf("oldest = %q, want %q (the first five must be evicted)", got[0].Message, "event 5")
	}
	if last := got[len(got)-1].Message; last != "event 104" {
		t.Errorf("newest = %q, want %q", last, "event 104")
	}
}

func TestRecordIgnoresEmptyID(t *testing.T) {
	reset()
	Record("", LevelInfo, "orphan")
	if n := len(List("")); n != 0 {
		t.Errorf("stored %d events under an empty id", n)
	}
}

func TestListReturnsACopy(t *testing.T) {
	reset()
	Record("t1", LevelInfo, "first")

	got := List("t1")
	got[0].Message = "mutated"

	if again := List("t1"); again[0].Message != "first" {
		t.Errorf("store leaked a mutable copy: %q", again[0].Message)
	}
}

func TestSeedReplaces(t *testing.T) {
	reset()
	Record("t1", LevelInfo, "live")
	Seed("t1", []Event{{Level: LevelWarn, Message: "persisted"}})

	got := List("t1")
	if len(got) != 1 || got[0].Message != "persisted" {
		t.Fatalf("Seed did not replace: %+v", got)
	}

	// Seeding the same id twice must not accumulate — a reload re-seeds.
	Seed("t1", []Event{{Level: LevelWarn, Message: "persisted"}})
	if n := len(List("t1")); n != 1 {
		t.Errorf("re-seed duplicated: %d entries", n)
	}

	Seed("t1", nil)
	if n := len(List("t1")); n != 0 {
		t.Errorf("seeding nil left %d entries", n)
	}
}

func TestGlobalCapAndClear(t *testing.T) {
	reset()

	for i := 0; i < maxGlobalEvents+5; i++ {
		Global(LevelInfo, "g %d", i)
	}
	if n := len(ListGlobal()); n != maxGlobalEvents {
		t.Fatalf("len = %d, want %d", n, maxGlobalEvents)
	}
	if first := ListGlobal()[0].Message; first != "g 5" {
		t.Errorf("oldest = %q, want %q", first, "g 5")
	}

	ClearGlobal()
	if n := len(ListGlobal()); n != 0 {
		t.Errorf("ClearGlobal left %d entries", n)
	}
}

// TestRecordSameMessageCoalesces: a repeated condition reads as one row with a
// count, keeping the run's original time ("began at T, seen N times").
func TestRecordSameMessageCoalesces(t *testing.T) {
	reset()

	Record("t1", LevelWarn, "relay down")
	first := List("t1")[0].Time
	Record("t1", LevelWarn, "relay down")
	Record("t1", LevelWarn, "relay down")

	got := List("t1")
	if len(got) != 1 {
		t.Fatalf("len = %d, want one coalesced event: %+v", len(got), got)
	}
	if got[0].Count != 3 {
		t.Errorf("Count = %d, want 3", got[0].Count)
	}
	if !got[0].Time.Equal(first) {
		t.Errorf("Time = %v, want the run's first occurrence %v", got[0].Time, first)
	}
}

// TestRecordRunBreaksOnDifference: only the tail of the list joins a run — a
// different message in between, or the same message at a different level,
// starts a new event.
func TestRecordRunBreaksOnDifference(t *testing.T) {
	reset()

	Record("t1", LevelWarn, "relay down")
	Record("t1", LevelInfo, "relay back")
	Record("t1", LevelWarn, "relay down")  // not adjacent to the first: a new run
	Record("t1", LevelError, "relay down") // same message, different level: not the same event

	got := List("t1")
	if len(got) != 4 {
		t.Fatalf("len = %d, want four (every run broken): %+v", len(got), got)
	}
	for _, e := range got {
		if e.Count != 1 {
			t.Errorf("Count = %d for %s %q, want 1", e.Count, e.Level, e.Message)
		}
	}
}

// TestGlobalCoalescesRepeats: the same folding applies to the global list.
func TestGlobalCoalescesRepeats(t *testing.T) {
	reset()

	Global(LevelError, "relay disconnected")
	Global(LevelError, "relay disconnected")

	got := ListGlobal()
	if len(got) != 1 || got[0].Count != 2 {
		t.Fatalf("global = %+v, want one event with Count 2", got)
	}
}

// TestCoalesceRespectsCap: folding a repeat never grows past the cap, and a new
// distinct event still evicts the oldest.
func TestCoalesceRespectsCap(t *testing.T) {
	reset()

	for i := 0; i < maxObjectEvents; i++ {
		Record("t1", LevelInfo, "event %d", i)
	}
	// Repeat the newest: it folds in, so the list stays at the cap.
	Record("t1", LevelInfo, "event %d", maxObjectEvents-1)

	got := List("t1")
	if len(got) != maxObjectEvents {
		t.Fatalf("len = %d after a repeat, want the cap %d", len(got), maxObjectEvents)
	}
	if last := got[len(got)-1]; last.Count != 2 || last.Message != "event 99" {
		t.Errorf("newest = %+v, want event 99 with Count 2", last)
	}

	// A new distinct event past the cap trims the oldest.
	Record("t1", LevelInfo, "one more")
	got = List("t1")
	if len(got) != maxObjectEvents {
		t.Fatalf("len = %d after a new event, want the cap %d", len(got), maxObjectEvents)
	}
	if got[0].Message != "event 1" {
		t.Errorf("oldest = %q, want %q (the first must be evicted)", got[0].Message, "event 1")
	}
}

// TestCoalesceNormalizesPreCountEvent: an event persisted before coalescing
// existed has Count 0 but happened once; folding a repeat must make it 2, not 1.
func TestCoalesceNormalizesPreCountEvent(t *testing.T) {
	reset()

	Seed("t1", []Event{{Level: LevelWarn, Message: "relay down"}})
	Record("t1", LevelWarn, "relay down")

	got := List("t1")
	if len(got) != 1 || got[0].Count != 2 {
		t.Fatalf("pre-count event after a repeat = %+v, want one event with Count 2", got)
	}
}

// TestSeedPreservesCount: Count round-trips through the persisted copy (Seed is
// how LoadConfig restores it).
func TestSeedPreservesCount(t *testing.T) {
	reset()

	Seed("t1", []Event{{Level: LevelWarn, Message: "relay down", Count: 5}})

	got := List("t1")
	if len(got) != 1 || got[0].Count != 5 {
		t.Fatalf("Seed dropped the count: %+v", got)
	}
}
