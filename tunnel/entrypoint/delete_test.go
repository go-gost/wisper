package entrypoint

import (
	"testing"

	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
)

// TestDeleteKeepsHistory: the update/replace path swaps an entrypoint out
// through Delete, so Delete must leave the object's event history alone.
// Clearing it there wipes the history of an entrypoint that is merely being
// updated (the reported "restart clears the events" bug). Only the explicit
// delete handler forgets it.
func TestDeleteKeepsHistory(t *testing.T) {
	const id = "ep-delete-keeps-history"
	event.Seed(id, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(id, nil) })

	event.Record(id, event.LevelInfo, "created")

	ep := NewTCPEntryPoint(tunnel.IDOption(id))
	Add(ep)
	Delete(id)

	got := event.List(id)
	if len(got) != 1 || got[0].Message != "created" {
		t.Fatalf("Delete cleared the history: %+v", got)
	}
}
