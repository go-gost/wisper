// Package event holds wisper's bounded history of notable occurrences: a
// service dropping or recovering, a p2p peer moving between transports, a
// tunnel being started, updated or deleted.
//
// Two classes share this store. Per-object history is keyed by a tunnel or
// entrypoint ID and shown on that object's events page. Global history covers
// host-level events and deletions and is shown on the settings page's events
// page. Both live in memory here; the tunnel and entrypoint SaveConfig paths —
// which already rewrite wisper.yaml on every stats tick — copy them into the
// config file, and LoadConfig seeds them back, so history survives a restart.
package event

import (
	"fmt"
	"sync"
	"time"
)

// Levels, mirrored by the UI's row colors.
const (
	LevelInfo  = "info"
	LevelWarn  = "warn"
	LevelError = "error"
)

// Caps. Constants, not settings: a history is a debugging aid, and a
// user-tunable bound is a knob nobody turns.
const (
	maxObjectEvents = 100
	maxGlobalEvents = 200
)

// Event is one recorded occurrence. A run of identical events (same level and
// message, nothing in between) is folded into one Event carrying a Count, so a
// repeating condition reads as a single row with "×N" rather than a flood; the
// Time is the run's first occurrence. A stored event written before coalescing
// existed has Count 0 and stands for one occurrence.
type Event struct {
	Time    time.Time `yaml:"time" json:"time"`
	Level   string    `yaml:"level" json:"level"`
	Message string    `yaml:"message" json:"message"`
	Count   int       `yaml:"count" json:"count"`
}

var store = &storeT{objects: make(map[string][]Event)}

type storeT struct {
	mu      sync.Mutex
	objects map[string][]Event
	global  []Event
}

// Record appends one per-object event, dropping the oldest once the object
// holds maxObjectEvents. An empty id is ignored: an event belonging to no
// object would be invisible. A repeat of the object's last event (same level
// and message) is folded into it instead of appended.
func Record(id, level, format string, args ...any) {
	if id == "" {
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	ev := newEvent(level, format, args...)
	if last := lastOf(store.objects[id]); last != nil && last.Level == ev.Level && last.Message == ev.Message {
		last.Count = repeatCount(last.Count) + 1
		return
	}
	store.objects[id] = appendCapped(store.objects[id], ev, maxObjectEvents)
}

// Global appends one global event, dropping the oldest once the list holds
// maxGlobalEvents. A repeat of the newest global event is folded into it.
func Global(level, format string, args ...any) {
	store.mu.Lock()
	defer store.mu.Unlock()
	ev := newEvent(level, format, args...)
	if last := lastOf(store.global); last != nil && last.Level == ev.Level && last.Message == ev.Message {
		last.Count = repeatCount(last.Count) + 1
		return
	}
	store.global = appendCapped(store.global, ev, maxGlobalEvents)
}

func newEvent(level, format string, args ...any) Event {
	msg := format
	if len(args) > 0 {
		// Only format when there is something to substitute: a message with a
		// literal % must survive untouched.
		msg = fmt.Sprintf(format, args...)
	}
	return Event{Time: time.Now(), Level: level, Message: msg, Count: 1}
}

// lastOf returns the newest event in list, or nil when list is empty. The
// pointer aliases the slice's storage, so a bump through it is seen by whoever
// holds the slice.
func lastOf(list []Event) *Event {
	if len(list) == 0 {
		return nil
	}
	return &list[len(list)-1]
}

// repeatCount reads a stored count as occurrences: a pre-count event (persisted
// before coalescing existed) has 0 and stands for one occurrence.
func repeatCount(n int) int {
	if n < 1 {
		return 1
	}
	return n
}

// appendCapped appends ev and, past max, returns a fresh slice holding only the
// last max entries.
func appendCapped(list []Event, ev Event, max int) []Event {
	list = append(list, ev)
	if len(list) <= max {
		return list
	}
	trimmed := make([]Event, max)
	copy(trimmed, list[len(list)-max:])
	return trimmed
}

// List returns a copy of an object's events, oldest first.
func List(id string) []Event {
	store.mu.Lock()
	defer store.mu.Unlock()
	return clone(store.objects[id])
}

// ListGlobal returns a copy of the global events, oldest first.
func ListGlobal() []Event {
	store.mu.Lock()
	defer store.mu.Unlock()
	return clone(store.global)
}

func clone(in []Event) []Event {
	if len(in) == 0 {
		return nil
	}
	out := make([]Event, len(in))
	copy(out, in)
	return out
}

// Seed replaces an object's history with the persisted copy, loaded from
// wisper.yaml. Replace-by-id, so a reload cannot duplicate what a SaveConfig
// already wrote. An empty list forgets the object.
func Seed(id string, events []Event) {
	if id == "" {
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(events) == 0 {
		delete(store.objects, id)
		return
	}
	store.objects[id] = clone(events)
}

// SeedGlobal replaces the global history with the persisted copy.
func SeedGlobal(events []Event) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.global = clone(events)
}

// ClearGlobal drops the global history.
func ClearGlobal() { SeedGlobal(nil) }
