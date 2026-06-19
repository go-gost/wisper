package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-gost/wisper/version"
)

func TestGetVersion(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/version")
	if err != nil {
		t.Fatalf("GET /api/version: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var got map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	if got["version"] != version.Version {
		t.Errorf("version = %q, want %q", got["version"], version.Version)
	}
}
