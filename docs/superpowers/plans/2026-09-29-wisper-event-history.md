# Event History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record tunnel/entrypoint disconnects, p2p path changes and lifecycle events into a bounded, persisted history, and surface it on a detail-page sub-page (per object) and a settings sub-page (host-wide).

**Architecture:** A new `event` package holds an in-memory bounded store — per-object entries keyed by tunnel/entrypoint ID, plus one global list. The existing once-per-second stats task is a single reused instance, so it samples each object's service state plus the p2p host's per-peer transports, per-peer punch counters and relay liveness, and diffs them against the previous tick; changes become events. The existing `SaveConfig` paths (which already rewrite `wisper.yaml` every second) copy the store into two new yaml fields, and `LoadConfig` seeds it back. Three Lit sub-pages render the three lists.

**Tech Stack:** Go 1.26 (wisper module, `github.com/go-gost/x` for `x/service` state, `github.com/go-gost/p2p` for the status snapshot), Lit 3 + TypeScript, `net/http/httptest` for API tests.

**Spec:** `docs/superpowers/specs/2026-09-29-wisper-event-history-design.md`

**Depends on:** `p2p/docs/2026-09-29-p2p-relay-state-and-punch-counters-plan.md` — it adds `Status.RelayConnected`, `Status.RelayError` and `Status.PeerPunches`, which Tasks 3 and 4 below read. **Land that plan first.** `go.work` resolves the module from the tree, so nothing in `go.mod` changes and no tag is needed for local work.

**Commits:** the repo owner asks for commits explicitly. Each "Commit" step is a checkpoint — run it when asked, do not commit on your own initiative.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `event/event.go` | create | `Event`, the bounded store, `Record` / `Global` / `List` / `Seed` / `ClearGlobal` |
| `event/event_test.go` | create | caps, ordering, seeding, copy-on-read |
| `config/config.go` | modify | `Tunnel.Events`, `Config.Events`, `deepCopyConfig` slice clones, `SeedGlobal` in `Init` |
| `config/deepcopy_test.go` | create | the two copies must not share an events backing array |
| `runner/task/diff.go` | create | pure: service-state diff, peer-transport diff, peer-punch diff, relay diff, peer ownership, message rendering |
| `runner/task/diff_test.go` | create | table-driven checks for the pure functions |
| `runner/task/stats.go` | modify | sample per tick, diff, record |
| `tunnel/tunnel.go` | modify | `SaveConfig` / `LoadConfig` / `Delete` event wiring |
| `tunnel/entrypoint/entrypoint.go` | modify | same, plus the start-failure record |
| `tunnel/entrypoint/tun.go` | modify | punch-failure record |
| `tunnel/p2p_host.go` | modify | one global record for a rejected derived STUN address |
| `api/tunnel_handler.go` | modify | lifecycle records; `Events` in the response |
| `api/entrypoint_handler.go` | modify | lifecycle records |
| `api/event_handler.go` | create | `GET` / `DELETE /api/events` |
| `api/server.go` | modify | the two routes |
| `api/api_test.go` | modify | lifecycle recording, the events endpoints, `events` in a response |
| `web-src/src/api/types.ts` | modify | `WisperEvent`, `Tunnel.events` |
| `web-src/src/api/backend.ts` | modify | `getEvents` / `clearEvents` |
| `web-src/src/i18n/en.ts`, `zh.ts` | modify | strings |
| `web-src/src/pages/events-page.ts` | create | the three lists, one component |
| `web-src/src/router/routes.ts` | modify | three routes |
| `web-src/src/pages/settings-page.ts` | modify | link row → `/settings/events` |
| `web-src/src/pages/tunnel-detail-page.ts`, `entrypoint-detail-page.ts` | modify | sub-page entry row |

---

## Task 1: The `event` package

**Files:**
- Create: `event/event.go`
- Test: `event/event_test.go`

- [ ] **Step 1: Write the failing test**

Create `event/event_test.go`:

```go
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./event/ -v`
Expected: FAIL — `no required module provides package github.com/go-gost/wisper/event` (the package does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `event/event.go`:

```go
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

// Event is one recorded occurrence.
type Event struct {
	Time    time.Time `yaml:"time" json:"time"`
	Level   string    `yaml:"level" json:"level"`
	Message string    `yaml:"message" json:"message"`
}

var store = &storeT{objects: make(map[string][]Event)}

type storeT struct {
	mu      sync.Mutex
	objects map[string][]Event
	global  []Event
}

// Record appends one per-object event, dropping the oldest once the object
// holds maxObjectEvents. An empty id is ignored: an event belonging to no
// object would be invisible.
func Record(id, level, format string, args ...any) {
	if id == "" {
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.objects[id] = appendCapped(store.objects[id], newEvent(level, format, args...), maxObjectEvents)
}

// Global appends one global event, dropping the oldest once the list holds
// maxGlobalEvents.
func Global(level, format string, args ...any) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.global = appendCapped(store.global, newEvent(level, format, args...), maxGlobalEvents)
}

func newEvent(level, format string, args ...any) Event {
	msg := format
	if len(args) > 0 {
		// Only format when there is something to substitute: a message with a
		// literal % must survive untouched.
		msg = fmt.Sprintf(format, args...)
	}
	return Event{Time: time.Now(), Level: level, Message: msg}
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./event/ -v`
Expected: PASS — `ok github.com/go-gost/wisper/event`.

- [ ] **Step 5: Commit**

```bash
git add event/event.go event/event_test.go
git commit -m "feat(event): add the bounded event store"
```

---

## Task 2: Persist events in the config

**Files:**
- Modify: `config/config.go` (the `Tunnel` struct at ~227, the `Config` struct at ~294, `deepCopyConfig` at ~329, `Init` at ~98)
- Test: `config/deepcopy_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `config/deepcopy_test.go`:

```go
package config

import (
	"testing"
	"time"

	"github.com/go-gost/wisper/event"
)

// deepCopyConfig must not leave two Config copies sharing an events backing
// array. Every caller of Get() mutates what it gets and writes it back through
// SaveConfig, so a shared array means one copy silently rewrites another's
// history.
func TestDeepCopyIsolatesEvents(t *testing.T) {
	orig := &Config{
		Tunnels: []*Tunnel{{
			ID:     "t1",
			Events: []event.Event{{Time: time.Now(), Level: event.LevelInfo, Message: "first"}},
		}},
		Events: []event.Event{{Time: time.Now(), Level: event.LevelInfo, Message: "global"}},
	}

	cp := deepCopyConfig(orig)
	cp.Tunnels[0].Events[0].Message = "changed"
	cp.Events[0].Message = "changed"

	if got := orig.Tunnels[0].Events[0].Message; got != "first" {
		t.Errorf("per-object events leaked between copies: %q", got)
	}
	if got := orig.Events[0].Message; got != "global" {
		t.Errorf("global events leaked between copies: %q", got)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./config/ -run TestDeepCopyIsolatesEvents -v`
Expected: FAIL — `both` assertions report the leaked `"changed"`, since `clone := *t` copies the slice header.

- [ ] **Step 3: Add the fields**

In `config/config.go`, add the import:

```go
	"github.com/go-gost/wisper/event"
```

In the `Tunnel` struct, directly above the existing `Stats` field, add:

```go
	// Events is this object's recent history, oldest first. Runtime state, like
	// Stats: SaveConfig rewrites it on every stats tick.
	Events []event.Event `yaml:"events,omitempty"`
```

In the `Config` struct, after `EntryPoints`:

```go
	// Events is the global history: host-level events and deletions, shown on
	// the settings page's events sub-page.
	Events []event.Event `yaml:"events,omitempty"`
```

- [ ] **Step 4: Isolate the slices in `deepCopyConfig`**

In `deepCopyConfig`, inside the tunnels loop, after `clone := *t`:

```go
				clone.Events = append([]event.Event(nil), t.Events...)
```

Inside the entrypoints loop, after `clone := *t`:

```go
				clone.Events = append([]event.Event(nil), t.Events...)
```

After the entrypoints block, before `return cfg`:

```go
	if len(c.Events) > 0 {
		cfg.Events = append([]event.Event(nil), c.Events...)
	}
```

- [ ] **Step 5: Seed the global history at startup**

In `Init`, immediately after `Set(cfg)`:

```go
	Set(cfg)
	event.SeedGlobal(cfg.Events)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `go test ./config/ -v`
Expected: PASS, including the two existing suites (`log_test.go`, `slog_test.go`).

- [ ] **Step 7: Commit**

```bash
git add config/config.go config/deepcopy_test.go
git commit -m "feat(config): persist event history in wisper.yaml"
```

---

## Task 3: The pure transition diff

**Files:**
- Create: `runner/task/diff.go`
- Test: `runner/task/diff_test.go`

- [ ] **Step 1: Write the failing test**

Create `runner/task/diff_test.go`:

```go
package task

import (
	"testing"

	"github.com/go-gost/p2p"
	"github.com/go-gost/wisper/event"
)

func TestDiffServiceState(t *testing.T) {
	prev := map[string]serviceState{
		"a": {failed: false},
		"b": {failed: false},
		"c": {failed: true},
	}

	cur := map[string]serviceState{
		"a": {failed: true, err: "dial tcp: timeout"}, // running → failed
		"b": {failed: false},                          // unchanged
		"c": {failed: false},                          // failed → running
		"d": {failed: true, err: "boom"},              // first observation: seeded
	}

	got := diffServiceState(prev, cur)
	if len(got) != 2 {
		t.Fatalf("got %d changes, want 2: %+v", len(got), got)
	}
	if got[0].ID != "a" || !got[0].Failed || got[0].Message != "dial tcp: timeout" {
		t.Errorf("change[0] = %+v, want a/failed/dial tcp: timeout", got[0])
	}
	if got[1].ID != "c" || got[1].Failed {
		t.Errorf("change[1] = %+v, want c/recovered", got[1])
	}
}

func TestDiffServiceStateSeedsFirstObservation(t *testing.T) {
	got := diffServiceState(nil, map[string]serviceState{"a": {failed: true, err: "x"}})
	if len(got) != 0 {
		t.Errorf("a first observation must be seeded, not reported: %+v", got)
	}
}

func TestOwnerOfPeer(t *testing.T) {
	cands := []peerCand{
		{ID: "t1", Peers: []string{"key-a", "key-b"}},
		{ID: "t2", Peer: "key-c"},
	}

	for _, tc := range []struct {
		key  string
		want string
	}{
		{"key-a", "t1"},
		{"key-b", "t1"},
		{"key-c", "t2"},
		{"key-d", ""},
	} {
		got, ok := ownerOfPeer(tc.key, cands)
		if tc.want == "" {
			if ok {
				t.Errorf("ownerOfPeer(%q) = %q, want no owner", tc.key, got.ID)
			}
			continue
		}
		if !ok || got.ID != tc.want {
			t.Errorf("ownerOfPeer(%q) = %q/%v, want %q", tc.key, got.ID, ok, tc.want)
		}
	}
}

func TestDiffPeerTransports(t *testing.T) {
	prev := map[string]string{"a": "direct", "b": "derp", "c": "direct"}
	cur := map[string]string{"a": "punching", "c": "direct", "d": "derp"}

	got := diffPeerTransports(prev, cur)
	if len(got) != 3 {
		t.Fatalf("got %d changes, want 3: %+v", len(got), got)
	}
	// Sorted by key: a, b, d.
	if got[0] != (peerChange{Key: "a", From: "direct", To: "punching"}) {
		t.Errorf("change[0] = %+v", got[0])
	}
	if got[1] != (peerChange{Key: "b", From: "derp"}) {
		t.Errorf("change[1] = %+v, want a session that ended", got[1])
	}
	if got[2] != (peerChange{Key: "d", To: "derp"}) {
		t.Errorf("change[2] = %+v, want a session that appeared", got[2])
	}
}

func TestPeerChangeMessage(t *testing.T) {
	cases := []struct {
		change  peerChange
		level   string
		message string
	}{
		{peerChange{Key: "k", To: "direct"}, event.LevelInfo, "peer phone: connected (direct)"},
		{peerChange{Key: "k", From: "derp"}, event.LevelWarn, "peer phone: disconnected (was derp)"},
		{peerChange{Key: "k", From: "punching", To: "failed"}, event.LevelWarn, "peer phone: punching → failed (punch failed)"},
		{peerChange{Key: "k", From: "direct", To: "derp"}, event.LevelInfo, "peer phone: direct → derp"},
	}
	for _, tc := range cases {
		level, msg := peerChangeMessage(tc.change, "phone")
		if level != tc.level || msg != tc.message {
			t.Errorf("peerChangeMessage(%+v) = %q/%q, want %q/%q", tc.change, level, msg, tc.level, tc.message)
		}
	}
}

func TestPeerDisplay(t *testing.T) {
	long := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq"
	if got := peerDisplay(long, peerCand{}, false); got != "ABCDEFGH…" {
		t.Errorf("peerDisplay(unowned) = %q", got)
	}
	cand := peerCand{Aliases: map[string]string{long: "phone"}}
	if got := peerDisplay(long, cand, true); got != "phone" {
		t.Errorf("peerDisplay(aliased) = %q, want phone", got)
	}
	if got := peerDisplay("short", peerCand{}, false); got != "short" {
		t.Errorf("peerDisplay(short) = %q", got)
	}
}

func TestDiffPunchDrops(t *testing.T) {
	prev := map[string]p2p.PeerPunch{
		"a": {Attempts: 1, Ups: 1, Drops: 0},
		"b": {Attempts: 3, Ups: 0, Drops: 0},
	}
	cur := map[string]p2p.PeerPunch{
		"a": {Attempts: 2, Ups: 2, Drops: 1}, // died and rebuilt: a drop
		"b": {Attempts: 4, Ups: 0, Drops: 0}, // still cannot punch: attempts move, drops do not
		"c": {Attempts: 1, Ups: 1, Drops: 0}, // first observation: seeded
	}

	got := diffPunchDrops(prev, cur)
	if len(got) != 1 {
		t.Fatalf("got %d changes, want 1 (only the genuine drop): %+v", len(got), got)
	}
	if got[0].Key != "a" || got[0].Drops != 1 {
		t.Errorf("change = %+v, want key a with 1 drop", got[0])
	}
}

func TestDiffPunchDropsSeedsFirstObservation(t *testing.T) {
	got := diffPunchDrops(nil, map[string]p2p.PeerPunch{"a": {Attempts: 9, Ups: 4, Drops: 3}})
	if len(got) != 0 {
		t.Errorf("a first observation must be seeded, not reported: %+v", got)
	}
}

func TestDiffRelay(t *testing.T) {
	cases := []struct {
		name          string
		seen          bool
		prev          relaySample
		cur           relaySample
		want          int
		wantConnected bool
	}{
		{"first observation", false, relaySample{}, relaySample{connected: false, err: "refused"}, 0, false},
		{"unchanged, connected", true, relaySample{connected: true}, relaySample{connected: true}, 0, false},
		{"goes down with a reason", true, relaySample{connected: true}, relaySample{connected: false, err: "connection refused"}, 1, false},
		{"comes back", true, relaySample{connected: false, err: "connection refused"}, relaySample{connected: true}, 1, true},
		{"still down, same error", true, relaySample{connected: false, err: "connection refused"}, relaySample{connected: false, err: "connection refused"}, 0, false},
		{"still down, new error", true, relaySample{connected: false, err: "refused"}, relaySample{connected: false, err: "i/o timeout"}, 1, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := diffRelay(tc.prev, tc.seen, tc.cur)
			if len(got) != tc.want {
				t.Fatalf("got %d changes, want %d: %+v", len(got), tc.want, got)
			}
			if tc.want > 0 && got[0].Connected != tc.wantConnected {
				t.Errorf("Connected = %v, want %v", got[0].Connected, tc.wantConnected)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./runner/task/ -v`
Expected: FAIL — `undefined: serviceState`, `undefined: diffServiceState`, and so on.

- [ ] **Step 3: Write the implementation**

Create `runner/task/diff.go`:

```go
package task

import (
	"fmt"
	"sort"

	"github.com/go-gost/p2p"
	"github.com/go-gost/wisper/event"
)

// serviceState is one object's service state, sampled once per tick.
type serviceState struct {
	failed bool
	err    string
}

// stateChange is a detected running ↔ failed transition.
type stateChange struct {
	ID      string
	Failed  bool   // the state it moved to
	Message string // the failure reason, when moving to failed
}

// diffServiceState reports the objects whose failed/running state changed since
// the previous sample. An object missing from prev is seeded, never reported:
// otherwise every object would log a row on startup and the history would be
// noise. Sorted by ID so a tick's events are deterministic.
func diffServiceState(prev, cur map[string]serviceState) []stateChange {
	var out []stateChange
	for id, c := range cur {
		p, seen := prev[id]
		if !seen || p.failed == c.failed {
			continue
		}
		out = append(out, stateChange{ID: id, Failed: c.failed, Message: c.err})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// peerCand is one object that may own a peer key: a p2p tunnel's allowlist, or
// a p2p/tun entrypoint's dial peer.
type peerCand struct {
	ID      string
	Peers   []string
	Peer    string
	Aliases map[string]string
}

// ownerOfPeer reports which object claims a peer key. A routed key is exclusive
// — the host refuses to give one key to two tunnels — so at most one candidate
// matches, and a key nobody claims belongs to no object.
func ownerOfPeer(key string, cands []peerCand) (peerCand, bool) {
	for _, c := range cands {
		if c.Peer == key {
			return c, true
		}
		for _, p := range c.Peers {
			if p == key {
				return c, true
			}
		}
	}
	return peerCand{}, false
}

// peerChange is one peer's path transition between ticks. From is empty when the
// peer's session first appears; To is empty when it ends.
type peerChange struct {
	Key  string
	From string
	To   string
}

// diffPeerTransports reports the peers whose transport changed between two
// snapshots. A key only in cur is a new session; one only in prev has ended.
func diffPeerTransports(prev, cur map[string]string) []peerChange {
	var out []peerChange
	for k, p := range prev {
		c, ok := cur[k]
		switch {
		case !ok:
			out = append(out, peerChange{Key: k, From: p})
		case c != p:
			out = append(out, peerChange{Key: k, From: p, To: c})
		}
	}
	for k, c := range cur {
		if _, ok := prev[k]; !ok {
			out = append(out, peerChange{Key: k, To: c})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// peerChangeMessage renders a peer transition, naming the peer by its alias when
// the owning object has one. A drop to "failed" is the only transition worth a
// warning beyond the ones that end or start a session: it is the peer whose
// hole punch cannot work (a symmetric NAT, or a STUN server that does not
// answer), which is the state a user has to act on.
func peerChangeMessage(c peerChange, display string) (level, message string) {
	switch {
	case c.From == "":
		return event.LevelInfo, fmt.Sprintf("peer %s: connected (%s)", display, c.To)
	case c.To == "":
		return event.LevelWarn, fmt.Sprintf("peer %s: disconnected (was %s)", display, c.From)
	case c.To == "failed":
		return event.LevelWarn, fmt.Sprintf("peer %s: %s → failed (punch failed)", display, c.From)
	default:
		return event.LevelInfo, fmt.Sprintf("peer %s: %s → %s", display, c.From, c.To)
	}
}

// peerDisplay names a peer in an event message: the alias the owning object
// gives it, else a truncated key (43 base64 characters would swamp the row).
func peerDisplay(key string, cand peerCand, ok bool) string {
	if ok {
		if a := cand.Aliases[key]; a != "" {
			return a
		}
	}
	if len(key) > 8 {
		return key[:8] + "…"
	}
	return key
}

// punchDrop is one peer's newly counted direct-session deaths since the last
// sample.
type punchDrop struct {
	Key   string
	Drops int64 // the delta
}

// diffPunchDrops reports the peers whose drop counter moved. A drop is the
// literal end of a live hole-punched session, so — unlike a gauge — it cannot
// be missed between samples. Attempts and Ups moving on their own are not
// reported: a peer that cannot punch at all (a symmetric NAT) retries forever,
// and PeerTransports already reads "failed" for it.
func diffPunchDrops(prev, cur map[string]p2p.PeerPunch) []punchDrop {
	var out []punchDrop
	for key, c := range cur {
		p, seen := prev[key]
		if !seen {
			continue // this peer's first observation: seed, never report
		}
		if d := c.Drops - p.Drops; d > 0 {
			out = append(out, punchDrop{Key: key, Drops: d})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// relaySample is the relay transport's state, sampled once per tick.
type relaySample struct {
	connected bool
	err       string
}

// relayChange is a detected relay connectivity transition. Connected is the
// state moved to; Err is the relay's own message when it went down.
type relayChange struct {
	Connected bool
	Err       string
}

// diffRelay reports a relay connectivity transition. seen is false on the first
// observation, which is seeded rather than reported — a host that starts
// connected is not a "relay restored". A new error message while already down
// is reported too: a second failure with a different cause is worth a row, and
// during a long outage it is the only thing that moves.
func diffRelay(prev relaySample, seen bool, cur relaySample) []relayChange {
	if !seen {
		return nil
	}
	if cur.connected != prev.connected {
		return []relayChange{{Connected: cur.connected, Err: cur.err}}
	}
	if !cur.connected && cur.err != "" && cur.err != prev.err {
		return []relayChange{{Connected: false, Err: cur.err}}
	}
	return nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./runner/task/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runner/task/diff.go runner/task/diff_test.go
git commit -m "feat(stats): add the pure transition diff"
```

---

## Task 4: Wire the diff into the stats tick

**Files:**
- Modify: `runner/task/stats.go`

The stats task is constructed once (`app.go:60`, `task.UpdateStats()`) and `runner.Exec` calls `Run` on that same instance from a ticker, so fields on it persist between ticks. That is what makes last-tick state possible without a new goroutine or a new poll loop.

Note the `if !tunnel.P2PHostRunning()` guard that follows `P2PHostStatus()` in Step 3 below. Those two reads take the p2p manager's lock separately, so the last p2p object can be released between them and hand back a zero `Status` — which the diff would read as a burst of disconnects, exactly what the `!on` block exists to prevent. The guard closes that window without touching the `p2p` module's locking; the stop is reported by the `p2p host stopped` event on the next tick.

- [ ] **Step 1: Add the last-tick fields**

In `runner/task/stats.go`, replace:

```go
type updateStatsTask struct{}
```

with:

```go
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
```

- [ ] **Step 2: Observe before saving**

Replace the body of `Run` with:

```go
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
```

- [ ] **Step 3: Add the sampler and the recorder**

Append to `runner/task/stats.go`:

```go
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
```

- [ ] **Step 4: Add the imports**

In the `import` block of `runner/task/stats.go`, add:

```go
	"fmt"

	"github.com/go-gost/p2p"
	"github.com/go-gost/wisper/event"
```

- [ ] **Step 5: Build and vet**

Run: `go build ./... && go vet ./...`
Expected: no output.

- [ ] **Step 6: Run the package tests**

Run: `go test ./runner/task/ -v`
Expected: PASS (the pure diff tests from Task 3).

- [ ] **Step 7: Commit**

```bash
git add runner/task/stats.go
git commit -m "feat(stats): record service and p2p path transitions"
```

---

## Task 5: Persist and reload the history

**Files:**
- Modify: `tunnel/tunnel.go` (`SaveConfig` ~590, `LoadConfig` ~547, `Delete` ~420)
- Modify: `tunnel/entrypoint/entrypoint.go` (`SaveConfig` ~292, `LoadConfig` ~241, `Delete` ~161)
- Test: `tunnel/event_persist_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `tunnel/event_persist_test.go`:

```go
package tunnel

import (
	"os"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"gopkg.in/yaml.v3"
)

// A round trip through the config file is what makes history survive a
// restart, so both halves are asserted: SaveConfig writes the store into the
// config, LoadConfig seeds the store back from it.
//
// It uses chdir rather than config.Init: Init sets the package-global config
// directory that Write reads, and a test that left it set would point every
// later test's Write at its own (by then deleted) temp dir — the same reason
// TestSaveConfigKeepsPeers chdirs and leaves the global empty.
func TestEventHistoryPersists(t *testing.T) {
	t.Chdir(t.TempDir()) // empty global config dir: SaveConfig writes ./wisper.yaml
	cfg.Set(&cfg.Config{})

	tun := NewTCPTunnel(
		NameOption("round trip"),
		EndpointOption("127.0.0.1:0"),
	)
	tun.Close() // closed: nothing is started, so the test needs no network
	Add(tun)
	id := tun.ID()
	t.Cleanup(func() { Delete(id) })

	event.Record(id, event.LevelWarn, "service failed: dial tcp: timeout")
	event.Global(event.LevelInfo, "p2p host started")

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	// The file itself must hold both lists: that is what survives a restart.
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	var onDisk cfg.Config
	if err := yaml.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("parse config: %v", err)
	}

	var persisted *cfg.Tunnel
	for _, tc := range onDisk.Tunnels {
		if tc != nil && tc.ID == id {
			persisted = tc
		}
	}
	if persisted == nil {
		t.Fatalf("tunnel %s missing from the config file", id)
	}
	if len(persisted.Events) != 1 || persisted.Events[0].Message != "service failed: dial tcp: timeout" {
		t.Fatalf("tunnel events not persisted: %+v", persisted.Events)
	}
	if len(onDisk.Events) != 1 || onDisk.Events[0].Message != "p2p host started" {
		t.Fatalf("global events not persisted: %+v", onDisk.Events)
	}

	// Delete forgets the object's history; LoadConfig must seed it back from
	// what was persisted. LoadConfig reads the in-memory config, which the
	// SaveConfig above has already replaced.
	Delete(id)
	if n := len(event.List(id)); n != 0 {
		t.Fatalf("Delete left %d events", n)
	}
	LoadConfig()

	if got := event.List(id); len(got) != 1 || got[0].Message != "service failed: dial tcp: timeout" {
		t.Errorf("LoadConfig did not seed the tunnel history: %+v", got)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./tunnel/ -run TestEventHistoryRoundTrip -v`
Expected: FAIL — `persisted.Tunnels[0].Events` is empty (`len = 0, want 1`).

- [ ] **Step 3: Write the events in `tunnel.SaveConfig`**

In `tunnel/tunnel.go`, in the `&config.Tunnel{...}` literal inside `SaveConfig`, after `StatsBaseline: tun.StatsBaseline(),` add:

```go
			Events:        event.List(tun.ID()),
```

Then, immediately before `config.Set(cfg)`, add:

```go
	cfg.Events = event.ListGlobal()
```

Do the same in `tunnel/entrypoint/entrypoint.go`'s `SaveConfig`: after `StatsBaseline: p.statsBaseline,` in the `&config.Tunnel{...}` literal add `Events: event.List(ep.ID()),`, and immediately before its `config.Set(cfg)` add `cfg.Events = event.ListGlobal()`.

**Note:** the entrypoint `SaveConfig` builds the literal with `ID: ep.ID()`, but writes the other fields from a captured `p` struct — use `ep.ID()` for `Events`, matching the `ID` field on the line above it.

- [ ] **Step 4: Seed the store in `LoadConfig`**

In `tunnel/tunnel.go`'s `LoadConfig`, inside the loop, after the `if tun == nil { continue }` guard:

```go
		event.Seed(cfg.ID, cfg.Events)
```

In `tunnel/entrypoint/entrypoint.go`'s `LoadConfig`, inside its loop, after its own `if ep == nil { continue }` guard:

```go
		event.Seed(cfg.ID, cfg.Events)
```

- [ ] **Step 5: Forget a deleted object's history**

In `tunnel/tunnel.go`'s `Delete`, inside the matching branch, after the `Close()` and the slice removal:

```go
			event.Seed(id, nil)
```

In `tunnel/entrypoint/entrypoint.go`'s `Delete`, the same, after the removal.

Without this, the store keeps history for every object ever deleted.

- [ ] **Step 6: Add the `event` import**

Both files need `"github.com/go-gost/wisper/event"` in their import block.

- [ ] **Step 7: Run the test to verify it passes**

Run: `go test ./tunnel/ -run TestEventHistoryRoundTrip -v`
Expected: PASS.

- [ ] **Step 8: Run the module tests**

Run: `go test ./tunnel/ ./tunnel/entrypoint/ -v`
Expected: PASS, including the existing p2p and tun suites. List the packages explicitly: a wildcard `go test ./...` is known to hang in this workspace.

- [ ] **Step 9: Commit**

```bash
git add tunnel/tunnel.go tunnel/entrypoint/entrypoint.go tunnel/event_persist_test.go
git commit -m "feat(tunnel): persist and reload event history"
```

---

## Task 6: Lifecycle records in the API handlers

**Files:**
- Modify: `api/tunnel_handler.go` (handlers at ~323, ~370, ~437, ~461, ~504)
- Modify: `api/entrypoint_handler.go` (handlers at ~153, ~204, ~276, ~300, ~345)
- Test: `api/api_test.go`

- [ ] **Step 1: Write the failing test**

Append to `api/api_test.go` (add `strings` and the `event` package to its imports):

```go
func TestLifecycleRecordsEvents(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	// Registered open (not closed): this case is about the stop path, and
	// preRegisterTunnel leaves its object closed — stopping that one answers 409.
	tun := tunnel.NewByType("tcp",
		tunnel.NameOption("lifecycle"),
		tunnel.EndpointOption("127.0.0.1:0"),
	)
	if tun == nil {
		t.Fatal("unknown tunnel type: tcp")
	}
	tunnel.Add(tun)
	id := tun.ID()

	// Stop: a per-object event.
	resp, _ := postJSON(t, srv.URL+"/api/tunnels/"+id+"/stop", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stop: status %d", resp.StatusCode)
	}
	if got := event.List(id); len(got) != 1 || got[0].Message != "stopped" {
		t.Fatalf("stop recorded %+v, want one \"stopped\"", got)
	}

	// Delete: a global event, since the object it described is gone.
	resp, _ = deleteJSON(t, srv.URL+"/api/tunnels/"+id)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: status %d", resp.StatusCode)
	}
	globals := event.ListGlobal()
	if len(globals) == 0 || !strings.Contains(globals[len(globals)-1].Message, "deleted") {
		t.Fatalf("delete recorded %+v, want a global \"deleted\"", globals)
	}
}
```

Note it does **not** use `preRegisterTunnel`: that helper closes the object it registers, and `handleStopTunnel` answers 409 for a closed tunnel, so the stop leg could never record. Registering an open object directly is what makes the case testable.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./api/ -run TestLifecycleRecordsEvents -v`
Expected: FAIL — `stop: status 409` before the test setup above is applied (and with it, the recorded list is empty until Step 3).

- [ ] **Step 3: Record the tunnel lifecycle**

In `api/tunnel_handler.go`, add `"github.com/go-gost/wisper/event"` to the imports, then:

- `handleCreateTunnel`, after `tunnel.Add(t)` and before `tunnel.SaveConfig()`:

```go
	event.Record(t.ID(), event.LevelInfo, "created")
```

- `handleUpdateTunnel`, after `tunnel.Add(t)` and before `tunnel.SaveConfig()`:

```go
	event.Record(t.ID(), event.LevelInfo, "updated")
```

- `handleStartTunnel`, after `tunnel.Set(newT)` and before `tunnel.SaveConfig()`:

```go
	event.Record(newT.ID(), event.LevelInfo, "started")
```

- `handleStopTunnel`, before its `tunnel.SaveConfig()`:

```go
	event.Record(id, event.LevelInfo, "stopped")
```

- `handleDeleteTunnel`, after `tunnel.Delete(id)` and before `tunnel.SaveConfig()`:

```go
	event.Global(event.LevelWarn, "%s: deleted", name)
```

For `handleDeleteTunnel`, capture the object's name before the delete (`t := tunnel.Get(id)` gives it; the handler already looks the tunnel up to 404 on an unknown id — reuse that value).

- [ ] **Step 4: Record the entrypoint lifecycle**

In `api/entrypoint_handler.go`, add the `event` import, then the same five records: `handleCreateEntrypoint` → `event.Record(ep.ID(), event.LevelInfo, "created")` after `entrypoint.Add(ep)`; `handleUpdateEntrypoint` → `"updated"` after `entrypoint.Add(ep)`; `handleStartEntrypoint` → `"started"` after `entrypoint.Set(newEP)`; `handleStopEntrypoint` → `"stopped"` before its `SaveConfig`; `handleDeleteEntrypoint` → `event.Global(event.LevelWarn, "%s: deleted", name)` after `entrypoint.Delete(id)`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./api/ -v`
Expected: PASS, including the existing API suites.

- [ ] **Step 6: Commit**

```bash
git add api/tunnel_handler.go api/entrypoint_handler.go api/api_test.go
git commit -m "feat(api): record tunnel and entrypoint lifecycle events"
```

---

## Task 7: Host-level and start-failure records

**Files:**
- Modify: `tunnel/entrypoint/entrypoint.go` (`restore`'s `fail`, ~41)
- Modify: `tunnel/entrypoint/tun.go` (`slog.Warn("tun entrypoint: punch peer"…)`, ~231)
- Modify: `tunnel/p2p_host.go` (the rejected-STUN warn, ~697)

These cover the failures that happen before a service or a session exists to sample — a start that cannot complete, a punch that cannot work — so the tick diff can never see them. A relay that will not connect is no longer one of these: the relay-level diff in Task 4 sees it, and keeps seeing it after a restart.

- [ ] **Step 1: Record a failed start**

In `tunnel/entrypoint/entrypoint.go`, in `restore`'s `fail` closure, after the existing `slog.Error("start entrypoint", "name", ep.Name(), "err", err)`:

```go
			event.Record(ep.ID(), event.LevelError, "start failed: %v", err)
```

- [ ] **Step 2: Record a failed punch**

In `tunnel/entrypoint/tun.go`, at the existing `slog.Warn("tun entrypoint: punch peer", "peer", s.peer, "err", err)`:

```go
		event.Record(s.ID(), event.LevelWarn, "punch %s failed: %v", s.peer, err)
```

(`s.ID()` is `tunEntryPoint`'s existing accessor, `func (s *tunEntryPoint) ID() string { return s.opts.ID }`.)

- [ ] **Step 3: Record the rejected STUN address**

The startup-time relay failure that was logged at this site is now covered by
the relay-level diff in Task 4, which also catches every *later* outage — a
one-shot record at host start would miss all of them. Only the STUN rejection
remains.

In `tunnel/p2p_host.go`, at the existing derived-STUN warning (`"p2p: derived STUN does not answer…"`):

```go
		event.Global(event.LevelWarn, "STUN %s does not answer: direct (IPv4) stays off", addr)
```

- [ ] **Step 4: Add the `event` import**

All three files need `"github.com/go-gost/wisper/event"`.

- [ ] **Step 5: Build and vet**

Run: `go build ./... && go vet ./...`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tunnel/entrypoint/entrypoint.go tunnel/entrypoint/tun.go tunnel/p2p_host.go
git commit -m "feat(tunnel): record host-level and start-failure events"
```

---

## Task 8: The global events endpoint

**Files:**
- Create: `api/event_handler.go`
- Modify: `api/server.go`
- Test: `api/api_test.go`

- [ ] **Step 1: Write the failing test**

Append to `api/api_test.go`:

```go
func TestGlobalEventsEndpoint(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	event.Global(event.LevelWarn, "relay connect failed: timeout")

	resp, body := getJSON(t, srv.URL+"/api/events")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET: status %d", resp.StatusCode)
	}
	list, _ := body["events"].([]any)
	if len(list) != 1 {
		t.Fatalf("GET returned %v", body["events"])
	}
	first, _ := list[0].(map[string]any)
	if first["message"] != "relay connect failed: timeout" || first["level"] != event.LevelWarn {
		t.Errorf("event = %v", first)
	}

	resp, _ = deleteJSON(t, srv.URL+"/api/events")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE: status %d", resp.StatusCode)
	}
	if n := len(event.ListGlobal()); n != 0 {
		t.Errorf("DELETE left %d events", n)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./api/ -run TestGlobalEventsEndpoint -v`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Write the handler**

Create `api/event_handler.go`:

```go
package api

import (
	"net/http"

	"github.com/go-gost/wisper/event"
)

// eventResponse is one recorded occurrence as the UI reads it.
type eventResponse struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

// eventsResponse is the global history; the field is always present, empty or
// not, so a client can render it without a nil check.
type eventsResponse struct {
	Events []eventResponse `json:"events"`
}

// toEventResponses renders events newest first: the list is read from the top,
// and the store keeps them oldest first so its own trimming drops the right end.
func toEventResponses(events []event.Event) []eventResponse {
	out := make([]eventResponse, 0, len(events))
	for i := len(events) - 1; i >= 0; i-- {
		out = append(out, eventResponse{
			Time:    events[i].Time.UTC().Format("2006-01-02T15:04:05Z"),
			Level:   events[i].Level,
			Message: events[i].Message,
		})
	}
	return out
}

// handleGetEvents returns the host-level history: relay and STUN failures, p2p
// host start/stop, peer knocks that belong to no tunnel, and deletions.
func handleGetEvents(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, eventsResponse{Events: toEventResponses(event.ListGlobal())})
}

// handleClearEvents forgets the host-level history. The next stats tick writes
// the empty list out through the ordinary SaveConfig path.
func handleClearEvents(w http.ResponseWriter, r *http.Request) {
	event.ClearGlobal()
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

- [ ] **Step 4: Register the routes**

In `api/server.go`, in the stats/config/version block:

```go
	mux.HandleFunc("GET /api/events", handleGetEvents)
	mux.HandleFunc("DELETE /api/events", handleClearEvents)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./api/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/event_handler.go api/server.go api/api_test.go
git commit -m "feat(api): add the global events endpoint"
```

---

## Task 9: Events in the object response

**Files:**
- Modify: `api/tunnel_handler.go` (`tunnelResponse` ~18, `toTunnelResponse` ~126)
- Test: `api/api_test.go`

- [ ] **Step 1: Write the failing test**

Append to `api/api_test.go`:

```go
func TestTunnelResponseCarriesEvents(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := preRegisterTunnel(t, "tcp", "with history", "127.0.0.1:0")
	event.Record(tun.ID(), event.LevelError, "service failed: boom")

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	list, _ := body["events"].([]any)
	if len(list) != 1 {
		t.Fatalf("events = %v", body["events"])
	}
	first, _ := list[0].(map[string]any)
	if first["message"] != "service failed: boom" {
		t.Errorf("message = %v", first["message"])
	}
	if first["level"] != event.LevelError {
		t.Errorf("level = %v, want %q", first["level"], event.LevelError)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./api/ -run TestTunnelResponseCarriesEvents -v`
Expected: FAIL — `events = []`.

- [ ] **Step 3: Add the field**

In `api/tunnel_handler.go`, in the `tunnelResponse` struct, after `PeerTransport`:

```go
	// Events is this object's recent history, newest first.
	Events []eventResponse `json:"events"`
```

- [ ] **Step 4: Populate it**

In `toTunnelResponse`, immediately before `return resp`:

```go
	resp.Events = toEventResponses(event.List(t.ID()))
```

- [ ] **Step 5: Add the `event` import**

`api/tunnel_handler.go` needs `"github.com/go-gost/wisper/event"`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `go test ./api/ -v`
Expected: PASS. Entrypoints get the field for free: they reuse `tunnelResponse` through `toTunnelResponse`.

- [ ] **Step 7: Commit**

```bash
git add api/tunnel_handler.go api/api_test.go
git commit -m "feat(api): carry event history on the object response"
```

---

## Task 10: Frontend types, client and strings

**Files:**
- Modify: `web-src/src/api/types.ts`
- Modify: `web-src/src/api/backend.ts`
- Modify: `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`

- [ ] **Step 1: Add the type**

In `web-src/src/api/types.ts`, after the `PeerStats` interface:

```ts
/** One recorded occurrence in a tunnel's, entrypoint's, or the host's history.
 *  Named WisperEvent rather than Event: the DOM's global Event type would be
 *  shadowed in every module that imports this. */
export interface WisperEvent {
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}
```

In the `Tunnel` interface, after `peer_transport?`:

```ts
  /** This object's recent history, newest first. */
  events?: WisperEvent[];
```

The `Entrypoint` interface is separate, so add the same field there, after its `peer_transport?`:

```ts
  /** This object's recent history, newest first. */
  events?: WisperEvent[];
```

- [ ] **Step 2: Add the client methods**

In `web-src/src/api/backend.ts`, before the closing brace of `GoBackend`, after `dismissPendingPeer`:

```ts
  /** The host's global event history (relay/STUN failures, host start/stop,
   *  deletions), newest first. */
  getEvents(): Promise<{ events: WisperEvent[] }> {
    return this.request('GET', '/api/events');
  }

  /** Forget the global event history. */
  clearEvents(): Promise<void> {
    return this.request('DELETE', '/api/events');
  }
```

Add `WisperEvent` to the file's `import type { ... } from './types'` list.

- [ ] **Step 3: Add the strings**

In `web-src/src/i18n/en.ts`, after the `peersTitle` group:

```ts
  // Event history
  eventsTunnelTitle: 'History',
  eventsEntrypointTitle: 'History',
  eventsGlobalTitle: 'Host events',
  eventsEntryTitle: 'History',
  eventsEntryDesc: 'Recent drops, recoveries and lifecycle events',
  eventsEmpty: 'Nothing recorded yet',
  eventsClear: 'Clear',
  eventsClearConfirm: 'Clear the host event history?',
  eventsLevelInfo: 'Info',
  eventsLevelWarn: 'Warning',
  eventsLevelError: 'Error',
```

In `web-src/src/i18n/zh.ts`, at the same position:

```ts
  // Event history
  eventsTunnelTitle: '历史事件',
  eventsEntrypointTitle: '历史事件',
  eventsGlobalTitle: '主机事件',
  eventsEntryTitle: '历史事件',
  eventsEntryDesc: '最近的断连、恢复与生命周期事件',
  eventsEmpty: '暂无记录',
  eventsClear: '清空',
  eventsClearConfirm: '清空主机事件历史?',
  eventsLevelInfo: '信息',
  eventsLevelWarn: '警告',
  eventsLevelError: '错误',
```

- [ ] **Step 4: Type-check**

Run: `cd web-src && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add web-src/src/api/types.ts web-src/src/api/backend.ts web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "feat(ui): add event types, client methods and strings"
```

---

## Task 11: The events page

**Files:**
- Create: `web-src/src/pages/events-page.ts`

- [ ] **Step 1: Write the component**

Create `web-src/src/pages/events-page.ts`:

```ts
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GoBackend } from '../api/backend';
import type { WisperEvent } from '../api/types';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { formatRelativeTime, formatTimestamp } from '../utils/format';
import { getSettings } from '../store/settings-store';
import '../components/app-scaffold';

export type EventsKind = 'tunnel' | 'entrypoint' | 'global';

/**
 * The event history of one tunnel, one entrypoint, or the host.
 *
 * History is not in the stores: the per-second stats poll carries only stats
 * and status (see stats-store.ts's applyStats), so this page fetches the object
 * itself, and re-fetches on the stats interval while it is mounted — which is
 * what keeps a churning p2p session visible.
 *
 * @attr kind       — 'tunnel' | 'entrypoint' | 'global'.
 * @attr parentType — the object's tunnel type, for the back path.
 * @attr parentId   — the object's id.
 */
@customElement('events-page')
export class EventsPage extends LitElement {
  @property() kind: EventsKind = 'tunnel';
  @property() parentType = '';
  @property() parentId = '';

  @state() private _events: WisperEvent[] = [];
  @state() private _error = '';
  @state() private _confirmClear = false;

  private _backend = new GoBackend();
  private _timer: ReturnType<typeof setInterval> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._load();
    const sec = getSettings().stats_interval || 3;
    this._timer = setInterval(() => this._load(), sec * 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _load(): Promise<void> {
    try {
      if (this.kind === 'global') {
        this._events = (await this._backend.getEvents()).events ?? [];
      } else {
        const obj =
          this.kind === 'tunnel'
            ? await this._backend.getTunnel(this.parentId)
            : await this._backend.getEntrypoint(this.parentId);
        this._events = obj.events ?? [];
      }
      this._error = '';
    } catch (e) {
      this._error = e instanceof Error ? e.message : String(e);
    }
  }

  private async _clear(): Promise<void> {
    this._confirmClear = false;
    try {
      await this._backend.clearEvents();
      this._events = [];
    } catch (e) {
      this._error = e instanceof Error ? e.message : String(e);
    }
  }

  private get _title(): string {
    if (this.kind === 'global') return t('eventsGlobalTitle');
    if (this.kind === 'entrypoint') return t('eventsEntrypointTitle');
    return t('eventsTunnelTitle');
  }

  private get _backPath(): string {
    if (this.kind === 'global') return '/settings';
    return `/${this.kind}/${this.parentType}/${this.parentId}`;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _levelLabel(level: string): string {
    if (level === 'error') return t('eventsLevelError');
    if (level === 'warn') return t('eventsLevelWarn');
    return t('eventsLevelInfo');
  }

  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }
    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }
    .clear-btn {
      background: none; border: none; cursor: pointer; color: var(--accent);
      font-family: inherit; font-size: var(--font-sm); padding: 4px 8px;
      border-radius: var(--radius-sm);
    }
    .clear-btn:hover { background: var(--border-subtle); }
    .row {
      display: flex; align-items: baseline; gap: 10px; padding: 10px 16px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; margin-top: 5px; }
    .dot.info { background: var(--text-muted); }
    .dot.warn { background: #d29922; }
    .dot.error { background: #f85149; }
    .body { flex: 1; min-width: 0; }
    .message { font-size: var(--font-sm); color: var(--text); word-break: break-word; }
    .time { font-size: var(--font-xs); color: var(--text-muted); white-space: nowrap; }
    .empty {
      display: flex; align-items: center; justify-content: center;
      padding: 64px 24px; color: var(--text-muted); font-size: var(--font-md);
    }
    .confirm {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px;
      background: var(--border-subtle); font-size: var(--font-sm);
    }
    .confirm button {
      font-family: inherit; font-size: var(--font-sm); padding: 4px 10px;
      border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);
      background: var(--surface); color: var(--text); cursor: pointer;
    }
  `;

  render() {
    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate(this._backPath)}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">${this._title}</span>
          ${this.kind === 'global' && this._events.length
            ? html`<button class="clear-btn" @click=${() => (this._confirmClear = true)}>
                ${t('eventsClear')}
              </button>`
            : nothing}
        </div>

        ${this._error
          ? html`<div class="empty">${this._error}</div>`
          : this._events.length === 0
            ? html`<div class="empty">${t('eventsEmpty')}</div>`
            : html`${this._renderRows()}`}
      </app-scaffold>
    `;
  }

  private _renderRows() {
    return html`
      ${this._confirmClear
        ? html`<div class="confirm">
            <span>${t('eventsClearConfirm')}</span>
            <button @click=${() => this._clear()}>${t('eventsClear')}</button>
            <button @click=${() => (this._confirmClear = false)}>${t('btnCancel')}</button>
          </div>`
        : nothing}
      ${this._events.map(
        (e) => html`
          <div class="row">
            <span class="dot ${e.level}" title=${this._levelLabel(e.level)}></span>
            <div class="body">
              <div class="message">${e.message}</div>
              <div class="time" title=${formatTimestamp(e.time)}>${formatRelativeTime(e.time)}</div>
            </div>
          </div>
        `,
      )}
    `;
  }
}
```

`btnCancel` is the existing key (`en.ts`: `btnCancel: 'Cancel'`), so no string is added for it.

- [ ] **Step 2: Type-check**

Run: `cd web-src && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Build the UI**

Run: `make web`
Expected: the Vite build completes and `web/` is refreshed.

- [ ] **Step 4: Commit**

```bash
git add web-src/src/pages/events-page.ts web/
git commit -m "feat(ui): add the events page"
```

---

## Task 12: Routes

**Files:**
- Modify: `web-src/src/router/routes.ts`

- [ ] **Step 1: Add the lazy import**

In `web-src/src/router/routes.ts`, with the other page imports:

```ts
const eventsPage = () => import('../pages/events-page');
```

- [ ] **Step 2: Add the three routes**

After the `tunnel-peers-page` route entry, add:

```ts
      {
        path: '/tunnel/:type/:id/events',
        render: (params: { type?: string; id?: string }) =>
          html`<events-page
            .kind=${'tunnel'}
            .parentType=${params.type ?? ''}
            .parentId=${params.id ?? ''}
          ></events-page>`,
        enter: async () => {
          await eventsPage();
          return true;
        },
      },
      {
        path: '/entrypoint/:type/:id/events',
        render: (params: { type?: string; id?: string }) =>
          html`<events-page
            .kind=${'entrypoint'}
            .parentType=${params.type ?? ''}
            .parentId=${params.id ?? ''}
          ></events-page>`,
        enter: async () => {
          await eventsPage();
          return true;
        },
      },
      {
        path: '/settings/events',
        render: () =>
          html`<events-page .kind=${'global'}></events-page>`,
        enter: async () => {
          await eventsPage();
          return true;
        },
      },
```

**Ordering note:** `@lit-labs/router` matches in declaration order, so `/settings/events` must be declared **before** the `/settings` route for it to win. If the existing `/settings` entry precedes it, move the new block above `/settings`.

- [ ] **Step 3: Type-check and build**

Run: `cd web-src && npx tsc --noEmit && cd .. && make web`
Expected: no output from tsc; Vite build completes.

- [ ] **Step 4: Commit**

```bash
git add web-src/src/router/routes.ts web/
git commit -m "feat(ui): route the three events pages"
```

---

## Task 13: Entry rows

**Files:**
- Modify: `web-src/src/pages/tunnel-detail-page.ts` (~1080, next to the peers entry row)
- Modify: `web-src/src/pages/entrypoint-detail-page.ts`
- Modify: `web-src/src/pages/settings-page.ts` (~592, the links block)

- [ ] **Step 1: Add the tunnel entry row**

In `web-src/src/pages/tunnel-detail-page.ts`, after the peers entry block, add:

```ts
            <!-- History: drops, recoveries and lifecycle events, on their own
                 page — a list this long does not belong inline. -->
            ${this.mode === 'view' && t2
              ? html`
                <div class="section">
                  <div class="card" style="padding:0;">
                    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;"
                      @click=${() => this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}/events`)}>
                      <span style="color:var(--accent);">${icon('zap')}</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${t('eventsEntryTitle')}</div>
                        <div style="font-size:var(--font-sm);color:var(--text-muted);">
                          ${(t2.events ?? []).length
                            ? (t2.events ?? [])[0].message
                            : t('eventsEntryDesc')}
                        </div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `
              : nothing}
```

- [ ] **Step 2: Add the entrypoint entry row**

In `web-src/src/pages/entrypoint-detail-page.ts`, at the equivalent position (next to any existing sub-page entry row; if the page has none, place it after the stats block and before the edit button), add the same block, using the page's own view-model (`this._entrypoint`, of type `Entrypoint | null`) and route properties:

```ts
            ${this.mode === 'view' && this._entrypoint
              ? html`
                <div class="section">
                  <div class="card" style="padding:0;">
                    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;"
                      @click=${() => this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/events`)}>
                      <span style="color:var(--accent);">${icon('zap')}</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${t('eventsEntryTitle')}</div>
                        <div style="font-size:var(--font-sm);color:var(--text-muted);">
                          ${(this._entrypoint.events ?? []).length
                            ? (this._entrypoint.events ?? [])[0].message
                            : t('eventsEntryDesc')}
                        </div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `
              : nothing}
```

Match the `mode` guard and the surrounding markup to whatever the entrypoint page's existing sections use — its stats block is the closest reference.

- [ ] **Step 3: Add the settings link row**

In `web-src/src/pages/settings-page.ts`, inside the links block (`class="settings-links"`), add:

```ts
          <a
            href="/settings/events"
            @click=${(e: Event) => {
              e.preventDefault();
              this._navigate('/settings/events');
            }}
          >${t('eventsGlobalTitle')} &rarr;</a>
```

- [ ] **Step 4: Type-check and build**

Run: `cd web-src && npx tsc --noEmit && cd .. && make web`
Expected: no output from tsc; Vite build completes.

- [ ] **Step 5: Commit**

```bash
git add web-src/src/pages/tunnel-detail-page.ts web-src/src/pages/entrypoint-detail-page.ts web-src/src/pages/settings-page.ts web/
git commit -m "feat(ui): link the events pages from the detail and settings pages"
```

---

## Task 14: Full verification

- [ ] **Step 1: Build the backend**

Run: `go build -o /tmp/wisper-check . && rm -f /tmp/wisper-check`
Expected: no output. A bare `go build ./...` writes no binary, which hides a broken main package — build the binary explicitly.

- [ ] **Step 2: Vet**

Run: `go vet ./...`
Expected: no output.

- [ ] **Step 3: Run the affected packages with the race detector**

Run: `CGO_ENABLED=1 go test -race -count=1 ./event/ ./config/ ./runner/task/ ./api/ ./tunnel/ ./tunnel/entrypoint/`
Expected: `ok` for each. Run the packages by name: a wildcard `go test ./...` is known to hang in this workspace, and `CGO_ENABLED=1` is required for the race detector to actually run.

- [ ] **Step 4: Rebuild the UI from scratch**

Run: `make web-force`
Expected: the build completes; `web/` is regenerated.

- [ ] **Step 5: Smoke-test by hand**

Run the server and exercise the paths with `curl`, then confirm the same in the UI:

```bash
./wisper -addr :8900 &
curl -s localhost:8900/api/events                       # {"events":[]}
curl -s -X POST localhost:8900/api/tunnels \
  -d '{"name":"smoke","type":"tcp","endpoint":"127.0.0.1:9999"}' -H 'Content-Type: application/json'
curl -s localhost:8900/api/tunnels | head -c 400        # the new tunnel, with "created"
curl -s localhost:8900/api/tunnels/<id> | head -c 600   # events[0] is newest first
curl -s -X POST localhost:8900/api/tunnels/<id>/stop
curl -s localhost:8900/api/tunnels/<id> | head -c 600   # a "stopped" event
curl -s -X DELETE localhost:8900/api/tunnels/<id>
curl -s localhost:8900/api/events                       # a "<name>: deleted" event
cat ~/.config/wisper/wisper.yaml                        # events: present under the tunnel and at top level
```

Expected: each command returns what the comment says; the yaml holds the history. Then confirm in the browser: the tunnel detail page shows a History row whose hint is the newest event, opening it lists the events, and Settings → Host events lists the deletion with a working Clear.

- [ ] **Step 6: Verify the p2p signals against a real relay**

These are the signals the whole p2p half rests on, and the ones a hand smoke test cannot produce. Reuse the probe kept at `tunnel/probe_events_test.go` (build tag `p2ppoc`), which starts a real `derper`, brings up a p2p host with a peer, and kills the relay mid-run:

```bash
CGO_ENABLED=1 go test -tags p2ppoc -run TestProbeEventSignals -v -timeout 8m ./tunnel/
```

Expected, with the relay fields added to the probe's `sample()` line (the p2p plan's Task 6 Step 4 gives that snippet). These are the values actually measured on 2026-09-29:

- `relay=true err=""` while the relay is up, and `peers=[<key>=derp]` for the first seconds, then `=direct` once the punch lands (t≈4 s) — the transport transition Task 3's `diffPeerTransports` reports.
- On killing the derper: **`relay=false err=""` on the very next sample**, with the reason arriving as a *second* change up to 5 s later (`err="... connection refused"`) — the engine drops the client at once but only records `dialErr` on its next redial tick. Both are `diffRelay` transitions, which is why the recorder above distinguishes the empty-reason case.
- On restarting the derper: `relay=true` again within ~5 s.
- `punches=[<key>={Attempts:1 Ups:1 Drops:0}]` throughout — one round, one up, **no drop**, because the direct session survived the relay outage.

Before the p2p change, none of the relay columns existed and **nothing at all changed for the 12 s of the outage** — that is the gap this work closes.

If the relay column does not flip, stop: the p2p dependency has not landed, and Tasks 3–4 read fields that do not exist. Say so rather than reporting the feature verified.

- [ ] **Step 7: Report**

Record the observed behaviour and any deviation from the spec. State plainly which of the four p2p signals were exercised and which were not. `Drops` is expected to remain 0 in every scenario available in this environment: the 18-second direct-session churn does not reproduce on loopback (a plain punch stayed up for the whole probe), so the drop path is covered by unit tests only. Do not claim it verified end to end.
