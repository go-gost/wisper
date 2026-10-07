package api

import (
	"net/http"
	"testing"

	"github.com/go-gost/wisper/tunnel/entrypoint"
)

func TestCreateEntrypointProbeEcho(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, created := postJSON(t, srv.URL+"/api/entrypoints", map[string]any{
		"type": "tun", "name": "spoke", "peer": "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA",
		"net": "10.10.0.2/24", "probe": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create tun entrypoint = %d: %v", resp.StatusCode, created)
	}
	id, _ := created["id"].(string)
	defer entrypoint.Delete(id)
	if opts, _ := created["options"].(map[string]any); opts["probe"] != true {
		t.Errorf("options.probe after create = %v, want true", opts["probe"])
	}

	resp, updated := putJSON(t, srv.URL+"/api/entrypoints/"+id, map[string]any{
		"type": "tun", "name": "spoke", "peer": "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA",
		"net": "10.10.0.2/24",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update tun entrypoint = %d: %v", resp.StatusCode, updated)
	}
	if opts, _ := updated["options"].(map[string]any); opts["probe"] == true {
		t.Errorf("options.probe after PUT without probe = %v, want absent/false (full-replace)", opts["probe"])
	}
}
