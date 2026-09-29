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
