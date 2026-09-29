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
