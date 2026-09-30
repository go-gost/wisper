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
	prev := map[string]p2p.PeerDiagnostic{
		"a": {Attempts: 1, Ups: 1, Drops: 0},
		"b": {Attempts: 3, Ups: 0, Drops: 0},
	}
	cur := map[string]p2p.PeerDiagnostic{
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
	got := diffPunchDrops(nil, map[string]p2p.PeerDiagnostic{"a": {Attempts: 9, Ups: 4, Drops: 3}})
	if len(got) != 0 {
		t.Errorf("a first observation must be seeded, not reported: %+v", got)
	}
}

func TestDiffPunchFailures(t *testing.T) {
	prev := map[string]p2p.PeerDiagnostic{
		"a": {Attempts: 1, Ups: 1}, // was healthy
		"b": {Attempts: 3, Ups: 0}, // two failures so far
		"c": {Attempts: 2, Ups: 2}, // healthy, unchanged below
		"d": {Attempts: 4, Ups: 1}, // failing, ups again below
	}
	cur := map[string]p2p.PeerDiagnostic{
		"a": {Attempts: 2, Ups: 1}, // one new failure
		"b": {Attempts: 5, Ups: 0}, // two more failures
		"c": {Attempts: 2, Ups: 2}, // unchanged: nothing
		"d": {Attempts: 5, Ups: 2}, // one more attempt and one more up: failures steady
		"e": {Attempts: 9, Ups: 0}, // first observation: seeded
	}

	got := diffPunchFailures(prev, cur)
	byKey := map[string]int64{}
	for _, c := range got {
		byKey[c.Key] = c.Failures
	}
	if len(got) != 2 || byKey["a"] != 1 || byKey["b"] != 2 {
		t.Fatalf("got %+v, want a=1 and b=2 only (no unchanged, ups-ed, or first-observation peer)", got)
	}
}

func TestDiffPunchFailuresSeedsFirstObservation(t *testing.T) {
	got := diffPunchFailures(nil, map[string]p2p.PeerDiagnostic{"a": {Attempts: 9, Ups: 0}})
	if len(got) != 0 {
		t.Errorf("a first observation must be seeded, not reported: %+v", got)
	}

	// An unchanged pair reports nothing.
	p := map[string]p2p.PeerDiagnostic{"a": {Attempts: 4, Ups: 1}}
	if got := diffPunchFailures(p, p); len(got) != 0 {
		t.Errorf("unchanged counters must report nothing: %+v", got)
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
