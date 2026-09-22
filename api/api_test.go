package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// setupTestServer creates an HTTP test server with the API handler.
// It resets global tunnel/entrypoint state and config.
func setupTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	// Reset global state.
	for i := tunnel.Count() - 1; i >= 0; i-- {
		if tun := tunnel.GetIndex(i); tun != nil {
			tunnel.Delete(tun.ID())
		}
	}
	for i := entrypoint.Count() - 1; i >= 0; i-- {
		if ep := entrypoint.GetIndex(i); ep != nil {
			entrypoint.Delete(ep.ID())
		}
	}

	config.Set(&config.Config{})

	return httptest.NewServer(NewHandler(nil))
}

// preRegisterTunnel creates a tunnel object (without calling Run) and
// adds it to the global registry so GET/LIST/DELETE handlers can find it.
// The tunnel is left in "closed" state so no network services are started.
func preRegisterTunnel(t *testing.T, tunnelType, name, endpoint string) tunnel.Tunnel {
	t.Helper()
	var tun tunnel.Tunnel
	opts := []tunnel.Option{
		tunnel.NameOption(name),
		tunnel.EndpointOption(endpoint),
		tunnel.CreatedAtOption(time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)),
	}
	switch tunnelType {
	case tunnel.FileTunnel:
		tun = tunnel.NewFileTunnel(opts...)
	case tunnel.HTTPTunnel:
		tun = tunnel.NewHTTPTunnel(opts...)
	case tunnel.TCPTunnel:
		tun = tunnel.NewTCPTunnel(opts...)
	case tunnel.UDPTunnel:
		tun = tunnel.NewUDPTunnel(opts...)
	default:
		t.Fatalf("unknown tunnel type: %s", tunnelType)
	}
	// Close immediately so no network services are started.
	tun.Close()
	tunnel.Add(tun)
	return tun
}

// preRegisterEntrypoint creates an entrypoint (without Run) and adds it.
func preRegisterEntrypoint(t *testing.T, epType, name, endpoint string) entrypoint.EntryPoint {
	t.Helper()
	var ep entrypoint.EntryPoint
	opts := []tunnel.Option{
		tunnel.NameOption(name),
		tunnel.EndpointOption(endpoint),
		tunnel.CreatedAtOption(time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)),
	}
	switch epType {
	case entrypoint.TCPEntryPoint:
		ep = entrypoint.NewTCPEntryPoint(opts...)
	case entrypoint.UDPEntryPoint:
		ep = entrypoint.NewUDPEntryPoint(opts...)
	default:
		t.Fatalf("unknown entrypoint type: %s", epType)
	}
	ep.Close()
	entrypoint.Add(ep)
	return ep
}

// HTTP helpers

func getJSON(t *testing.T, url string) (*http.Response, map[string]any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	return resp, decodeBody(t, resp.Body)
}

func postJSON(t *testing.T, url string, body any) (*http.Response, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return resp, decodeBody(t, resp.Body)
}

func putJSON(t *testing.T, url string, body any) (*http.Response, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPut, url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT %s: %v", url, err)
	}
	return resp, decodeBody(t, resp.Body)
}

func deleteJSON(t *testing.T, url string) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE %s: %v", url, err)
	}
	return resp, decodeBody(t, resp.Body)
}

func decodeBody(t *testing.T, r io.ReadCloser) map[string]any {
	t.Helper()
	defer r.Close()
	var m map[string]any
	_ = json.NewDecoder(r).Decode(&m)
	return m
}

func getJSONArray(t *testing.T, url string) (*http.Response, []map[string]any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	var arr []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&arr)
	return resp, arr
}

// ---------------------------------------------------------------------------
// Config endpoint tests
// ---------------------------------------------------------------------------

func TestGetConfig(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, body := getJSON(t, srv.URL+"/api/config")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	if body["theme"] != "" {
		t.Errorf("expected empty theme, got %v", body["theme"])
	}
}

func TestUpdateConfig(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, _ := putJSON(t, srv.URL+"/api/config", map[string]any{
		"theme": "dark",
		"lang":  "zh",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	_, body := getJSON(t, srv.URL+"/api/config")
	if body["theme"] != "dark" {
		t.Errorf("expected theme=dark, got %v", body["theme"])
	}
	if body["lang"] != "zh" {
		t.Errorf("expected lang=zh, got %v", body["lang"])
	}
}

// ---------------------------------------------------------------------------
// Tunnel list/get/delete tests (using pre-registered, non-running tunnels)
// ---------------------------------------------------------------------------

func TestListTunnelsEmpty(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, list := getJSONArray(t, srv.URL+"/api/tunnels")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d", len(list))
	}
}

func TestListTunnelsWithItems(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	preRegisterTunnel(t, tunnel.FileTunnel, "Files", "/tmp/a")
	preRegisterTunnel(t, tunnel.TCPTunnel, "TCP Forward", "localhost:3000")

	resp, list := getJSONArray(t, srv.URL+"/api/tunnels")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 tunnels, got %d", len(list))
	}
	if list[0]["name"] != "Files" {
		t.Errorf("expected name=Files, got %v", list[0]["name"])
	}
	if list[1]["name"] != "TCP Forward" {
		t.Errorf("expected name=TCP Forward, got %v", list[1]["name"])
	}
}

func TestGetTunnel(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := preRegisterTunnel(t, tunnel.HTTPTunnel, "My HTTP", "localhost:8080")

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	if body["id"] != tun.ID() {
		t.Errorf("expected id=%s, got %v", tun.ID(), body["id"])
	}
	if body["name"] != "My HTTP" {
		t.Errorf("expected name=My HTTP, got %v", body["name"])
	}
	if body["type"] != "http" {
		t.Errorf("expected type=http, got %v", body["type"])
	}
	if body["status"] != "stopped" {
		t.Errorf("expected status=stopped, got %v", body["status"])
	}
}

func TestGetTunnelWithOptions(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	// Create a tunnel with full options via the constructor.
	tun := tunnel.NewHTTPTunnel(
		tunnel.NameOption("Secure"),
		tunnel.EndpointOption("localhost:443"),
		tunnel.HostnameOption("example.com"),
		tunnel.UsernameOption("admin"),
		tunnel.PasswordOption("secret"),
		tunnel.EnableTLSOption(true),
		tunnel.RewriteHostOption(true),
	)
	tun.Close()
	tunnel.Add(tun)

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}

	opts, ok := body["options"].(map[string]any)
	if !ok {
		t.Fatalf("expected options object, got %v", body["options"])
	}
	if opts["hostname"] != "example.com" {
		t.Errorf("expected hostname=example.com, got %v", opts["hostname"])
	}
	if opts["basic_auth"] != true {
		t.Errorf("expected basic_auth=true (username present), got %v", opts["basic_auth"])
	}
	if opts["enableTLS"] != true {
		t.Errorf("expected enableTLS=true, got %v", opts["enableTLS"])
	}
	if opts["rewriteHost"] != true {
		t.Errorf("expected rewriteHost=true, got %v", opts["rewriteHost"])
	}
}

func TestGetTunnelNotFound(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, _ := getJSON(t, srv.URL+"/api/tunnels/nonexistent")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestDeleteTunnel(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := preRegisterTunnel(t, tunnel.FileTunnel, "to-delete", "/tmp/x")

	resp, body := deleteJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	if body["status"] != "deleted" {
		t.Errorf("expected status=deleted, got %v", body["status"])
	}

	// Verify it's gone.
	resp, _ = getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", resp.StatusCode)
	}
}

func TestDeleteTunnelNotFound(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, _ := deleteJSON(t, srv.URL+"/api/tunnels/nonexistent")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// Tunnel create validation tests (no Run() needed)
// ---------------------------------------------------------------------------

func TestCreateTunnelMissingType(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "test", "endpoint": "/tmp/test",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %v", resp.StatusCode, body)
	}
	if body["error"] != "type is required" {
		t.Errorf("unexpected error: %v", body["error"])
	}
}

func TestCreateTunnelUnknownType(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "test", "type": "unknown", "endpoint": "/tmp/test",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %v", resp.StatusCode, body)
	}
}

func TestCreateTunnelInvalidJSON(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/tunnels", "application/json", bytes.NewReader([]byte("not json")))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// Entrypoint list/get/delete tests
// ---------------------------------------------------------------------------

func TestListEntrypointsEmpty(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, list := getJSONArray(t, srv.URL+"/api/entrypoints")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d", len(list))
	}
}

func TestGetEntrypoint(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	ep := preRegisterEntrypoint(t, entrypoint.TCPEntryPoint, "My TCP EP", ":9090")

	resp, body := getJSON(t, srv.URL+"/api/entrypoints/"+ep.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	if body["id"] != ep.ID() {
		t.Errorf("expected id=%s, got %v", ep.ID(), body["id"])
	}
	if body["type"] != "tcp" {
		t.Errorf("expected type=tcp, got %v", body["type"])
	}
}

func TestDeleteEntrypoint(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	ep := preRegisterEntrypoint(t, entrypoint.TCPEntryPoint, "to-delete", ":9091")

	resp, body := deleteJSON(t, srv.URL+"/api/entrypoints/"+ep.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	if body["status"] != "deleted" {
		t.Errorf("expected status=deleted, got %v", body["status"])
	}

	resp, _ = getJSON(t, srv.URL+"/api/entrypoints/"+ep.ID())
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", resp.StatusCode)
	}
}

func TestCreateEntrypointMissingType(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, body := postJSON(t, srv.URL+"/api/entrypoints", map[string]any{
		"name": "test", "endpoint": ":8080",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %v", resp.StatusCode, body)
	}
}

func TestCreateEntrypointUnknownType(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, body := postJSON(t, srv.URL+"/api/entrypoints", map[string]any{
		"name": "test", "type": "unknown", "endpoint": ":8080",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %v", resp.StatusCode, body)
	}
}

// ---------------------------------------------------------------------------
// Stats endpoint tests
// ---------------------------------------------------------------------------

func TestGetStatsEmpty(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/stats")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)

	tunnels := body["tunnels"].([]any)
	entrypoints := body["entrypoints"].([]any)
	if len(tunnels) != 0 {
		t.Errorf("expected empty tunnels, got %d", len(tunnels))
	}
	if len(entrypoints) != 0 {
		t.Errorf("expected empty entrypoints, got %d", len(entrypoints))
	}
}

func TestGetStatsWithData(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	preRegisterTunnel(t, tunnel.FileTunnel, "t1", "/tmp/a")
	preRegisterEntrypoint(t, entrypoint.TCPEntryPoint, "e1", ":9092")

	resp, err := http.Get(srv.URL + "/api/stats")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)

	tunnels := body["tunnels"].([]any)
	entrypoints := body["entrypoints"].([]any)
	if len(tunnels) != 1 {
		t.Errorf("expected 1 tunnel, got %d", len(tunnels))
	}
	if len(entrypoints) != 1 {
		t.Errorf("expected 1 entrypoint, got %d", len(entrypoints))
	}
}

// ---------------------------------------------------------------------------
// Config deep copy tests
// ---------------------------------------------------------------------------

func TestConfigDeepCopy(t *testing.T) {
	original := &config.Config{
		Settings: &config.Settings{
			Server: "test.example.com",
			Theme:  "dark",
		},
		Tunnels: []*config.Tunnel{
			{ID: "t1", Name: "Test", Type: "file"},
		},
	}
	config.Set(original)

	copy := config.Get()
	copy.Settings.Theme = "light"
	copy.Tunnels[0].Name = "Modified"

	orig := config.Get()
	if orig.Settings.Theme != "dark" {
		t.Error("deep copy failed: settings mutation leaked")
	}
	if orig.Tunnels[0].Name != "Test" {
		t.Error("deep copy failed: tunnel mutation leaked")
	}
}

func TestConfigSetNil(t *testing.T) {
	config.Set(nil)
	cfg := config.Get()
	if cfg == nil {
		t.Error("Set(nil) should store an empty Config, not nil")
	}
}

func TestValidatePrefix(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", "", false},
		{"MyApp-Name1", "myapp-name1", false},
		{"  padded8x  ", "padded8x", false},
		{"exactly8", "exactly8", false},
		{"a23456789012345678901234567890123456789012345678901234567890123", "a23456789012345678901234567890123456789012345678901234567890123", false}, // 63 chars
		{"short", "", true},
		{"a234567890123456789012345678901234567890123456789012345678901234", "", true}, // 64 chars
		{"-leading1", "", true},
		{"trailing1-", "", true},
		{"bad_char1", "", true},
		{"has.dot12", "", true},
	}
	for _, tt := range tests {
		got, err := normalizePrefix(tt.in)
		if tt.wantErr {
			if err == nil {
				t.Errorf("normalizePrefix(%q): expected error, got %q", tt.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("normalizePrefix(%q): unexpected error: %v", tt.in, err)
			continue
		}
		if got != tt.want {
			t.Errorf("normalizePrefix(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestCreateTunnelInvalidPrefix(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	for _, prefix := range []string{"bad!", "short"} {
		resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
			"name": "test", "type": "http", "endpoint": "localhost:8080",
			"prefix": prefix,
		})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("prefix %q: expected 400, got %d: %v", prefix, resp.StatusCode, body)
		}
	}
}

func TestUpdateTunnelInvalidPrefix(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := preRegisterTunnel(t, tunnel.HTTPTunnel, "Test", "localhost:8080")

	resp, body := putJSON(t, srv.URL+"/api/tunnels/"+tun.ID(), map[string]any{
		"name": "Test", "type": "http", "endpoint": "localhost:8080",
		"prefix": "bad!",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %v", resp.StatusCode, body)
	}
	// Original tunnel must be untouched.
	if got := tunnel.Get(tun.ID()); got == nil {
		t.Error("original tunnel was removed on failed update")
	}
}

func TestGetTunnelWithPrefix(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := tunnel.NewHTTPTunnel(
		tunnel.NameOption("Prefixed"),
		tunnel.EndpointOption("localhost:8080"),
		tunnel.PrefixOption("myprefix1"),
	)
	tun.Close()
	tunnel.Add(tun)

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	opts, ok := body["options"].(map[string]any)
	if !ok {
		t.Fatalf("expected options object, got %v", body["options"])
	}
	if opts["prefix"] != "myprefix1" {
		t.Errorf("expected prefix=myprefix1, got %v", opts["prefix"])
	}
	// Optimistic entrypoint: prefix shown before any bind (forward is nil).
	if body["entrypoint"] != "https://myprefix1.gost.run" {
		t.Errorf("expected entrypoint=https://myprefix1.gost.run, got %v", body["entrypoint"])
	}

	// Without a prefix the md5-hash endpoint is used.
	plain := preRegisterTunnel(t, tunnel.HTTPTunnel, "Plain", "localhost:8080")
	_, pbody := getJSON(t, srv.URL+"/api/tunnels/"+plain.ID())
	ep, _ := pbody["entrypoint"].(string)
	if ep == "" || ep == "https://.gost.run" {
		t.Errorf("expected md5-hash entrypoint, got %q", ep)
	}
	if ep == "https://myprefix1.gost.run" {
		t.Error("plain tunnel must not reuse the prefixed entrypoint")
	}
}

// TestPeerAliasesFlow: the allowlist carries display aliases end to end — a
// submitted alias is kept, an omitted one is generated, and a legacy tunnel
// (keys stored before aliases existed) gets names on the way out.
func TestPeerAliasesFlow(t *testing.T) {
	req := tunnelCreateRequest{
		Name:  "Private",
		Type:  tunnel.P2PTunnel,
		Peers: []peerJSON{{Key: "k1"}, {Key: "k2", Alias: "laptop"}},
	}
	var opts tunnel.Options
	for _, opt := range req.toOptions() {
		opt(&opts)
	}

	if len(opts.Peers) != 2 || opts.Peers[0] != "k1" || opts.Peers[1] != "k2" {
		t.Fatalf("allowlist = %v, want [k1 k2] in order", opts.Peers)
	}
	if opts.PeerAliases["k2"] != "laptop" {
		t.Errorf("k2 alias = %q, want the submitted one kept", opts.PeerAliases["k2"])
	}
	if a := opts.PeerAliases["k1"]; len(a) != len("peer-")+4 {
		t.Errorf("k1 alias = %q, want a generated peer-xxxx name", a)
	}

	out := peersJSON(opts.Peers, opts.PeerAliases)
	if len(out) != 2 || out[0].Alias != opts.PeerAliases["k1"] || out[1].Alias != "laptop" {
		t.Errorf("response peers = %+v, want both aliases", out)
	}

	// No stored aliases (a tunnel saved before aliases existed): still named.
	legacy := peersJSON([]string{"k1", "k2"}, nil)
	for _, p := range legacy {
		if len(p.Alias) != len("peer-")+4 {
			t.Errorf("legacy peer %s alias = %q, want a generated name", p.Key, p.Alias)
		}
	}
	if legacy[0].Alias == legacy[1].Alias {
		t.Error("legacy peers share one alias")
	}
	if peersJSON(nil, nil) != nil {
		// An empty allowlist must stay absent from the JSON, not become [].
		if got := peersJSON(nil, nil); len(got) != 0 {
			t.Errorf("peersJSON() = %v, want empty", got)
		}
	}
}

// TestUpdateP2PTunnel: a p2p tunnel must be replaceable. Its peers live as
// routes on the shared host, so the old tunnel has to release them before the
// replacement claims them — otherwise every edit answered 500 "peer ... is
// already used by another p2p tunnel".
func TestUpdateP2PTunnel(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	// An unreachable relay: the connect is non-fatal, the host routes anyway.
	secure := false
	config.Set(&config.Config{Settings: &config.Settings{
		P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Secure: &secure},
	}})

	resp, created := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"peers": []map[string]any{{"key": "k1"}, {"key": "k2", "alias": "laptop"}},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create p2p tunnel = %d: %v", resp.StatusCode, created)
	}
	id, _ := created["id"].(string)
	defer tunnel.Delete(id)

	peers, _ := created["options"].(map[string]any)["peers"].([]any)
	if len(peers) != 2 {
		t.Fatalf("created peers = %v, want two entries", peers)
	}
	first, _ := peers[0].(map[string]any)
	generated, _ := first["alias"].(string)
	if generated == "" {
		t.Fatal("the created allowlist entry has no generated alias")
	}

	// Per-peer traffic: an entry per allowlisted peer, in allowlist order, with
	// its alias and (nothing connected yet) zeroed counters.
	pstats, _ := created["peer_stats"].([]any)
	if len(pstats) != 2 {
		t.Fatalf("created peer_stats = %v, want an entry per allowlisted peer", created["peer_stats"])
	}
	ps0, _ := pstats[0].(map[string]any)
	if ps0["key"] != "k1" || ps0["alias"] != generated {
		t.Errorf("peer_stats[0] = %v, want k1 under its generated alias", ps0)
	}
	if ps0["total_conns"] != float64(0) || ps0["input_bytes"] != float64(0) || ps0["current_conns"] != float64(0) {
		t.Errorf("peer_stats[0] counters = %v, want zeros before any traffic", ps0)
	}

	resp, updated := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"peers": []map[string]any{
			{"key": "k1", "alias": "renamed"},
			{"key": "k2", "alias": "laptop"},
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update p2p tunnel = %d: %v", resp.StatusCode, updated)
	}
	upeers, _ := updated["options"].(map[string]any)["peers"].([]any)
	if len(upeers) != 2 {
		t.Fatalf("updated peers = %v, want two entries", upeers)
	}
	if got, _ := upeers[0].(map[string]any)["alias"].(string); got != "renamed" {
		t.Errorf("k1 alias after update = %q, want the submitted one", got)
	}
	if got, _ := upeers[1].(map[string]any)["alias"].(string); got != "laptop" {
		t.Errorf("k2 alias after update = %q, want it kept", got)
	}
}

// freePort returns a port nothing is listening on.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("free port: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// TestUpdateRunningEntrypoint: an entrypoint holds its listen address, so the
// old one must let go before the replacement starts — otherwise every edit of
// a running entrypoint answered 500 "bind: address already in use".
func TestUpdateRunningEntrypoint(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	secure := false
	config.Set(&config.Config{Settings: &config.Settings{
		P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Secure: &secure},
	}})

	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))
	resp, created := postJSON(t, srv.URL+"/api/entrypoints", map[string]any{
		"name": "Peer", "type": "p2p", "endpoint": addr, "peer": "k1",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create p2p entrypoint = %d: %v", resp.StatusCode, created)
	}
	id, _ := created["id"].(string)
	defer entrypoint.Delete(id)

	resp, updated := putJSON(t, srv.URL+"/api/entrypoints/"+id, map[string]any{
		"name": "Peer", "type": "p2p", "endpoint": addr, "peer": "k2",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update p2p entrypoint = %d: %v", resp.StatusCode, updated)
	}
	if opts, _ := updated["options"].(map[string]any); opts["peer"] != "k2" {
		t.Errorf("peer after update = %v, want the submitted k2", opts["peer"])
	}
}
