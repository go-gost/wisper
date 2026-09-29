package tunnel

import (
	"testing"

	"github.com/go-gost/wisper/event"
)

// TestDeleteKeepsHistory: the update/replace path swaps a tunnel out through
// Delete, so Delete must leave its event history alone — only the explicit
// delete handler forgets it. Otherwise updating a tunnel wipes its history.
func TestDeleteKeepsHistory(t *testing.T) {
	const id = "delete-keeps-history"
	event.Seed(id, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(id, nil) })

	event.Record(id, event.LevelInfo, "created")

	Add(NewTCPTunnel(IDOption(id)))
	Delete(id)

	got := event.List(id)
	if len(got) != 1 || got[0].Message != "created" {
		t.Fatalf("Delete cleared the history: %+v", got)
	}
}
