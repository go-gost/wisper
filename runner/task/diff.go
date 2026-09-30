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
// be missed between samples. Attempts and Ups moving on their own are still not
// reported here; the rounds that failed (attempts minus ups) are, by
// diffPunchFailures.
func diffPunchDrops(prev, cur map[string]p2p.PeerDiagnostic) []punchDrop {
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

// punchFailure is one peer's newly counted failed punch rounds since the last
// sample.
type punchFailure struct {
	Key      string
	Failures int64 // the delta
}

// diffPunchFailures reports the peers whose failed-round counter moved. One
// round's failures is Attempts minus Ups: the rounds that did not reach a live
// direct session. A peer that cannot punch at all (a symmetric NAT) shows only
// once as the "failed" gauge, but the engine keeps retrying on its backoff —
// this delta is where those retries become visible, so the caller can fold them
// into a count. A peer absent from prev is seeded, never reported (its history
// predates this tick); a peer whose failures stop moving — it ups-ed, or simply
// did not retry — reports nothing.
func diffPunchFailures(prev, cur map[string]p2p.PeerDiagnostic) []punchFailure {
	var out []punchFailure
	for key, c := range cur {
		p, seen := prev[key]
		if !seen {
			continue // this peer's first observation: seed, never report
		}
		if d := (c.Attempts - c.Ups) - (p.Attempts - p.Ups); d > 0 {
			out = append(out, punchFailure{Key: key, Failures: d})
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
