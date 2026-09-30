package task

import (
	"testing"

	"github.com/go-gost/wisper/event"
)

// TestRecordPunchFailures: a burst of failed rounds lands as one "punch failed"
// warning with a count, not a flood — the point of recording the constant
// message once per round. The count reaching the row is what makes the retries
// of a peer that cannot punch visible without spamming the history.
func TestRecordPunchFailures(t *testing.T) {
	event.Seed("t1", nil)
	defer event.Seed("t1", nil)

	cands := []peerCand{{
		ID:      "t1",
		Peers:   []string{"k1"},
		Aliases: map[string]string{"k1": "laptop"},
	}}

	recordPunchFailures([]punchFailure{{Key: "k1", Failures: 3}}, cands)

	got := event.List("t1")
	if len(got) != 1 {
		t.Fatalf("got %d events, want one coalesced row: %+v", len(got), got)
	}
	if got[0].Message != "peer laptop: punch failed" {
		t.Errorf("message = %q, want the constant punch-failed line", got[0].Message)
	}
	if got[0].Level != event.LevelWarn {
		t.Errorf("level = %q, want %q", got[0].Level, event.LevelWarn)
	}
	if got[0].Count != 3 {
		t.Errorf("Count = %d, want 3", got[0].Count)
	}
}
