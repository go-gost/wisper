package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
)

// TestResetP2PIdentityRequiresConfirmation: the explicit flag makes a caller
// state the intent; it is a human confirmation guard, not authentication.
func TestResetP2PIdentityRequiresConfirmation(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	config.Set(&config.Config{Settings: &config.Settings{P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	_, before := getJSON(t, srv.URL+"/api/p2p")
	old, _ := before["public_key"].(string)
	if old == "" {
		t.Fatal("GET /api/p2p returned no public key")
	}

	resp, body := postJSON(t, srv.URL+"/api/p2p/reset", map[string]any{})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %v)", resp.StatusCode, body)
	}
	_, after := getJSON(t, srv.URL+"/api/p2p")
	if after["public_key"] != old {
		t.Fatal("refused reset changed the key")
	}
}

// TestResetP2PIdentity: a confirmed reset returns the new key, the key file
// matches it, and the following read reports the same identity.
func TestResetP2PIdentity(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	config.Set(&config.Config{Settings: &config.Settings{P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	_, before := getJSON(t, srv.URL+"/api/p2p")
	old, _ := before["public_key"].(string)
	if old == "" {
		t.Fatal("GET /api/p2p returned no public key")
	}

	resp, body := postJSON(t, srv.URL+"/api/p2p/reset", map[string]any{"confirm": true})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %v)", resp.StatusCode, body)
	}
	got, _ := body["public_key"].(string)
	if got == "" || got == old {
		t.Fatalf("public_key = %q, want a new key (old %q)", got, old)
	}
	_, after := getJSON(t, srv.URL+"/api/p2p")
	if after["public_key"] != got {
		t.Fatalf("GET after reset = %v, want %q", after["public_key"], got)
	}

	fi, err := os.Stat(tunnel.P2PHostKeyPath())
	if err != nil {
		t.Fatalf("host.key: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("host.key mode = %o, want 600", perm)
	}
}

// TestResetP2PIdentityConcurrent: racing resets are serialized by the handler,
// so the file, the next read and the responses all agree on one key — no
// interleaving of a key write and another request's host rebuild.
func TestResetP2PIdentityConcurrent(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	config.Set(&config.Config{Settings: &config.Settings{P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	_, before := getJSON(t, srv.URL+"/api/p2p")
	old, _ := before["public_key"].(string)
	if old == "" {
		t.Fatal("GET /api/p2p returned no public key")
	}

	const n = 2
	type result struct {
		status int
		key    string
		err    error
	}
	results := make([]result, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp, err := http.Post(srv.URL+"/api/p2p/reset", "application/json",
				strings.NewReader(`{"confirm":true}`))
			if err != nil {
				results[i].err = err
				return
			}
			defer resp.Body.Close()
			results[i].status = resp.StatusCode
			var body struct {
				PublicKey string `json:"public_key"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
				results[i].err = err
				return
			}
			results[i].key = body.PublicKey
		}(i)
	}
	wg.Wait()

	seen := make(map[string]bool, n)
	for i, r := range results {
		if r.err != nil {
			t.Fatalf("request %d: %v", i, r.err)
		}
		if r.status != http.StatusOK {
			t.Fatalf("request %d status = %d, want 200", i, r.status)
		}
		if r.key == "" || r.key == old {
			t.Fatalf("request %d key = %q, want a new key", i, r.key)
		}
		if seen[r.key] {
			t.Fatalf("request %d repeated key %q; resets were not distinct", i, r.key)
		}
		seen[r.key] = true
	}

	_, after := getJSON(t, srv.URL+"/api/p2p")
	got, _ := after["public_key"].(string)
	if !seen[got] {
		t.Fatalf("identity after concurrent resets = %q, not one of the returned keys", got)
	}
	filePub, err := tunnel.EnsureP2PIdentity()
	if err != nil {
		t.Fatalf("EnsureP2PIdentity: %v", err)
	}
	if filePub != got {
		t.Fatalf("key file = %q, GET = %q; file and host disagree", filePub, got)
	}
}
