package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
)

// TestTunHubOptionsIsSafeUnderConcurrentPeersSave: the race probe for
// tunTunnel.Options(). A save rewrites the allowlist and the assignment in place,
// and Options is how the API reads both — so a peers-PUT and a GET on one running
// hub were reading the same multi-word struct while it was being written.
//
// The read on the write's critical path is the one settlePeerIPs makes: it supplies
// the value a row with no ip keeps, so a torn copy here does not merely make a
// response inconsistent, it decides what "unchanged" means and SaveConfig then
// persists that as the new truth.
//
// It is a probe rather than an assertion about a value, and it earns its place by
// failing under -race when the read is unlocked: a test that merely checked the
// answers would pass on a torn read. Sequential tests cannot reach this at all —
// the suite is serial by construction, which is why the race survived a green
// gate.
func TestTunHubOptionsIsSafeUnderConcurrentPeersSave(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()
	defaultLogger(t)

	keys := []string{strings.Repeat("C", 43), strings.Repeat("D", 43), strings.Repeat("E", 43)}
	id := startTunHub(t, srv, "10.11.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": keys[0]}, {"key": keys[1]}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save two spokes = %d: %v", resp.StatusCode, saved)
	}

	// Each writer re-saves the whole allowlist with its own addresses typed, so
	// every save really writes Peers and PeerIPs under the lock. The reads are GETs,
	// which build a response out of the same Options copy the writer is mutating.
	// Four writers against four readers is what makes the interleaving likely; two
	// rounds is enough because each save takes seconds (it warms the peers) while a
	// GET is free, so the readers get many overlaps out of few writes. More rounds
	// buys a large linear cost and nothing the detector does not already see — this
	// fires on the first overlap, not on a lucky one.
	const writers, readers, rounds = 4, 4, 2
	var wg sync.WaitGroup
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for r := 0; r < rounds; r++ {
				peers := []map[string]any{}
				for i, key := range keys {
					// A different address per writer, so the two are not writing the
					// same bytes and the race is on the struct, not the contents.
					peers = append(peers, map[string]any{
						"key": key,
						"ip":  []string{"10.11.0.2", "10.11.0.3", "10.11.0.4"}[(i+w)%3],
					})
				}
				req, err := newJSONRequest(srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{"peers": peers})
				if err != nil {
					t.Errorf("build the save: %v", err)
					return
				}
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Errorf("save: %v", err)
					return
				}
				resp.Body.Close()
			}
		}(w)
	}
	for r := 0; r < readers; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < rounds*writers; n++ {
				resp, err := http.Get(srv.URL + "/api/tunnels/" + id)
				if err != nil {
					t.Errorf("get: %v", err)
					return
				}
				resp.Body.Close()
			}
		}()
	}
	wg.Wait()

	// The hub survived it and still authorizes what it is holding: a race that
	// corrupted the assignment would show up here as a lost row rather than only
	// under the detector.
	hub := tunnel.Get(id)
	if hub == nil {
		t.Fatal("the hub is gone after the concurrent saves")
	}
	if got := hub.Options().PeerIPs; len(got) == 0 {
		t.Error("the assignment is empty after the concurrent saves")
	}
	if tunnel.IsServiceFailed(hub) {
		t.Error("the hub is a failed service after the concurrent saves")
	}
	if got := config.Get().Tunnels; len(got) == 0 || len(got[0].PeerIPs) == 0 {
		t.Errorf("the persisted assignment = %v, want it non-empty", got)
	}
}

// newJSONRequest builds a PUT with a JSON body, so the probe can drive the handler
// concurrently instead of the test helper's Fatalf, which is not safe off the
// test's own goroutine.
func newJSONRequest(url string, body any) (*http.Request, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}
