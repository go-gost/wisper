package api

import (
	"net/http"
	"testing"

	"github.com/go-gost/wisper/tunnel"
)

// TestGetTunnelNeverExposesPassword pins the CWE-522 fix: the API must never
// echo the configured Basic Auth password — not on GET, not on LIST — while
// still reporting the username and the basic_auth presence signal the UI's
// edit form needs.
func TestGetTunnelNeverExposesPassword(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := tunnel.NewHTTPTunnel(
		tunnel.NameOption("Secure"),
		tunnel.EndpointOption("localhost:443"),
		tunnel.UsernameOption("admin"),
		tunnel.PasswordOption("s3cr3t"),
	)
	tun.Close()
	tunnel.Add(tun)
	defer tunnel.Delete(tun.ID())

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	opts, ok := body["options"].(map[string]any)
	if !ok {
		t.Fatalf("expected options object, got %v", body["options"])
	}
	if _, leaked := opts["password"]; leaked {
		t.Errorf("security violation: password exposed in GET tunnel response")
	}
	if opts["username"] != "admin" {
		t.Errorf("expected username=admin echoed, got %v", opts["username"])
	}
	if opts["basic_auth"] != true {
		t.Errorf("expected basic_auth=true, got %v", opts["basic_auth"])
	}

	_, list := getJSONArray(t, srv.URL+"/api/tunnels")
	for _, item := range list {
		if o, ok := item["options"].(map[string]any); ok {
			if _, leaked := o["password"]; leaked {
				t.Errorf("security violation: password exposed in LIST tunnels response (id=%v)", item["id"])
			}
		}
	}
}

// TestUpdateTunnelPreservesPasswordWhenOmitted pins the edit roundtrip: the
// UI prefills its form from GET (which no longer carries the password), so a
// PUT that says nothing about the password must keep the stored one —
// otherwise every unrelated edit silently wipes auth.
func TestUpdateTunnelPreservesPasswordWhenOmitted(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	_, created := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"username": "admin", "password": "s3cr3t",
	})
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("create p2p tunnel failed: %v", created)
	}
	defer tunnel.Delete(id)

	resp, updated := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"username": "admin",
		// no "password" key: the form had nothing to send back.
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update p2p tunnel = %d: %v", resp.StatusCode, updated)
	}
	if got := tunnel.Get(id); got == nil {
		t.Fatal("tunnel missing after update")
	} else if pw := got.Options().Password; pw != "s3cr3t" {
		t.Errorf("password after omit-password update = %q, want it preserved (got %q)", pw, "s3cr3t")
	}
}

// TestUpdateTunnelSetsPasswordWhenProvided guards the other side: an explicit
// password in the PUT replaces the stored one.
func TestUpdateTunnelSetsPasswordWhenProvided(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	_, created := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"username": "admin", "password": "s3cr3t",
	})
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("create p2p tunnel failed: %v", created)
	}
	defer tunnel.Delete(id)

	resp, _ := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"username": "admin", "password": "n3w-one",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update p2p tunnel = %d", resp.StatusCode)
	}
	if pw := tunnel.Get(id).Options().Password; pw != "n3w-one" {
		t.Errorf("password after explicit update = %q, want %q", pw, "n3w-one")
	}
}

// TestUpdateTunnelClearsPasswordWhenExplicitEmpty documents the escape hatch:
// sending "password": "" clears the stored secret (absent key preserves,
// empty string clears — the same nil-vs-empty sentence the spoke IP field
// speaks).
func TestUpdateTunnelClearsPasswordWhenExplicitEmpty(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	_, created := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"username": "admin", "password": "s3cr3t",
	})
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("create p2p tunnel failed: %v", created)
	}
	defer tunnel.Delete(id)

	resp, _ := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"username": "admin", "password": "",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update p2p tunnel = %d", resp.StatusCode)
	}
	if pw := tunnel.Get(id).Options().Password; pw != "" {
		t.Errorf("password after explicit-empty update = %q, want it cleared", pw)
	}
}
