package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
	xlogger "github.com/go-gost/x/logger"
)

// directOff pins the p2p hosts in these tests to the relay: they cover API
// shapes, and a host with the direct path on probes for a STUN server on the
// way up.
var directOff = false

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

	// Global event history is process-wide and outlives a run of cases, so it
	// is dropped here too: a case asserting on it must not see an earlier one's.
	event.ClearGlobal()

	return httptest.NewServer(NewHandler(nil))
}

// preRegisterTunnel creates a tunnel object (without calling Run) and
// adds it to the global registry so GET/LIST/DELETE handlers can find it.
// The tunnel is left in "closed" state so no network services are started.
func preRegisterTunnel(t *testing.T, tunnelType, name, endpoint string) tunnel.Tunnel {
	t.Helper()
	tun := tunnel.NewByType(tunnelType,
		tunnel.NameOption(name),
		tunnel.EndpointOption(endpoint),
		tunnel.CreatedAtOption(time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)),
	)
	if tun == nil {
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
	ep := entrypoint.NewByType(epType,
		tunnel.NameOption(name),
		tunnel.EndpointOption(endpoint),
		tunnel.CreatedAtOption(time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)),
	)
	if ep == nil {
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

// TestUpdateConfigP2PDirect: the direct path and its STUN server survive the
// settings round trip (the UI writes them, the host reads them back).
func TestUpdateConfigP2PDirect(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, _ := putJSON(t, srv.URL+"/api/config", map[string]any{
		"p2p": map[string]any{
			"derp": "wss://relay.example/derp", "stun": "192.0.2.7:3479", "direct": false,
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	_, body := getJSON(t, srv.URL+"/api/config")
	p2p, _ := body["p2p"].(map[string]any)
	if p2p == nil {
		t.Fatalf("config has no p2p block: %v", body)
	}
	if p2p["stun"] != "192.0.2.7:3479" {
		t.Errorf("stun = %v, want the saved server", p2p["stun"])
	}
	if direct, ok := p2p["direct"].(bool); !ok || direct {
		t.Errorf("direct = %v, want false", p2p["direct"])
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

// TestGetTunTunnelOptions: a tun hub's device configuration (and the keepalive
// pair) survives the trip out through the API — the fields the UI reads back
// into the edit form.
func TestGetTunTunnelOptions(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := tunnel.NewTunTunnel(
		tunnel.NameOption("Hub"),
		tunnel.EndpointOption("127.0.0.1:8421"),
		tunnel.NetOption("10.10.0.1/24"),
		tunnel.MTUOption(1400),
		tunnel.DeviceNameOption("wisper-hub"),
		tunnel.RoutesOption("192.168.50.0/24"),
		tunnel.DNSOption("10.10.0.1"),
		tunnel.KeepaliveOption(true),
		tunnel.TTLOption(15),
	)
	tun.Close() // no device is created: this test is about the API shape
	tunnel.Add(tun)

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
	}
	opts, ok := body["options"].(map[string]any)
	if !ok {
		t.Fatalf("expected options object, got %v", body["options"])
	}
	for field, want := range map[string]any{
		"net":         "10.10.0.1/24",
		"mtu":         float64(1400),
		"device_name": "wisper-hub",
		"routes":      "192.168.50.0/24",
		"dns":         "10.10.0.1",
		"keepalive":   true,
		"ttl":         float64(15),
	} {
		if got := opts[field]; got != want {
			t.Errorf("options[%s] = %v, want %v", field, got, want)
		}
	}
}

// TestCreateTunTunnelValidation: the fields a tun hub cannot work without are
// refused before any object is built. A p2p hub binds nothing, so an endpoint
// is a configuration error rather than a missing requirement; and x's tun
// listener skips what it cannot parse, so a typo in the device fields would
// otherwise start a device with no address. The allowlist is not among them:
// it is managed on the peers page, which the create form never reaches.
func TestCreateTunTunnelValidation(t *testing.T) {
	// A well-formed peer key: base64 (raw url) of 32 bytes.
	peer := strings.Repeat("A", 43)

	tests := []struct {
		name string
		body map[string]any
	}{
		{
			name: "endpoint set",
			body: map[string]any{"type": "tun", "name": "hub", "net": "10.10.0.1/24", "endpoint": "127.0.0.1:8421",
				"peers": []map[string]any{{"key": peer}}},
		},
		{
			name: "no net",
			body: map[string]any{"type": "tun", "name": "hub", "peers": []map[string]any{{"key": peer}}},
		},
		{
			name: "bad net",
			body: map[string]any{"type": "tun", "name": "hub", "net": "10.10.0.1", "peers": []map[string]any{{"key": peer}}},
		},
		{
			// A *valid* route is the case that matters: this is the value that
			// reached the host's routing table and took the LAN down, so the
			// guard must refuse it, not merely refuse malformed ones.
			name: "route set",
			body: map[string]any{"type": "tun", "name": "hub", "net": "10.10.0.1/24", "routes": "192.168.50.0/24",
				"peers": []map[string]any{{"key": peer}}},
		},
		{
			name: "dns set",
			body: map[string]any{"type": "tun", "name": "hub", "net": "10.10.0.1/24", "dns": "10.10.0.1",
				"peers": []map[string]any{{"key": peer}}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := setupTestServer(t)
			defer srv.Close()

			resp, body := postJSON(t, srv.URL+"/api/tunnels", tt.body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %v", resp.StatusCode, body)
			}
			if n := tunnel.Count(); n != 0 {
				t.Errorf("%d tunnels registered after a rejected create, want 0", n)
			}
		})
	}
}

// TestCreateTunTunnelWithoutPeers: a hub is created with just a device — the
// create form never asks for the allowlist, so demanding one makes the
// documented flow unreachable. The request is therefore not a rejection: it
// gets as far as starting the tunnel, and the state that was refusing to be
// silent about is recorded instead (see noteNoPeers). The response is a hub
// with no peers, not a 400.
//
// Run still needs the privilege to create the device, so this asserts what
// stops being a validation error — the create is no longer refused *for the
// allowlist* — and not that the device came up. That is the smoke's job: it
// creates a hub this way in a privileged container and then runs two peers
// through it.
func TestCreateTunTunnelWithoutPeers(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()

	// The gost default logger is nil here (wisper sets it at startup) and
	// Run() dereferences it; a real one keeps the device path running. Only
	// restore a logger that was there — Store(nil) panics on an atomic.Value.
	if oldLog := clogger.Default(); oldLog != nil {
		t.Cleanup(func() { clogger.SetDefault(oldLog) })
	}
	clogger.SetDefault(xlogger.NewLogger(xlogger.LevelOption(clogger.ErrorLevel)))

	resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"type": "tun", "name": "hub", "net": "10.10.0.1/24",
	})

	// 201 needs the device, which needs CAP_NET_ADMIN; 500 is the device
	// refusing, not the allowlist. 400 would be the guard still in place.
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("create tun hub with no peers = %d: %v, want 201 (or 500 from the device, not 400 from validation)",
			resp.StatusCode, body)
	}
	if resp.StatusCode == http.StatusInternalServerError {
		if msg, _ := body["error"].(string); !strings.Contains(msg, "failed to start tunnel") {
			t.Fatalf("error = %v, want the device's failure, not an allowlist refusal", body)
		}
		t.Skip("no CAP_NET_ADMIN here: the device could not be created, so the hub never ran")
	}

	if got, _ := body["type"].(string); got != "tun" {
		t.Errorf("type = %v, want tun", body["type"])
	}
	if peers, ok := body["options"].(map[string]any)["peers"]; ok && peers != nil {
		t.Errorf("peers = %v, want none on a hub created without peers", peers)
	}
	id, _ := body["id"].(string)
	defer tunnel.Delete(id)

	// The state the removed guard used to refuse is announced instead, so a
	// hub created and never finished is not a hub that silently drops packets.
	found := false
	for _, ev := range event.List(id) {
		if ev.Level == event.LevelWarn && strings.Contains(ev.Message, "no peers") {
			found = true
		}
	}
	if !found {
		t.Errorf("creating a hub with no peers recorded no warning: %v", event.List(id))
	}
}

// TestNoteNoPeers: the helper every empty-allowlist moment goes through —
// creation and every save that leaves the list empty, including the removal of
// the last peer on the peers page. It speaks for tun hubs only: a p2p tunnel
// is reached by its own peers over a separate route, so an empty list there is
// a normal state that was never silent and needs no announcement.
func TestNoteNoPeers(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	peer := strings.Repeat("A", 43)

	cases := []struct {
		name       string
		tunnelType string
		opts       []tunnel.Option
		want       int
	}{
		{
			name:       "a hub with no peers is announced",
			tunnelType: tunnel.TunTunnel,
			opts:       []tunnel.Option{tunnel.NetOption("10.10.0.1/24")},
			want:       1,
		},
		{
			name:       "a hub with peers is not",
			tunnelType: tunnel.TunTunnel,
			opts:       []tunnel.Option{tunnel.NetOption("10.10.0.1/24"), tunnel.PeersOption(peer)},
			want:       0,
		},
		{
			name:       "a p2p tunnel with no peers is not",
			tunnelType: tunnel.P2PTunnel,
			opts:       []tunnel.Option{tunnel.EndpointOption("127.0.0.1:9")},
			want:       0,
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			tun := tunnel.NewByType(tt.tunnelType, append([]tunnel.Option{
				tunnel.NameOption(tt.name),
				tunnel.CreatedAtOption(time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)),
			}, tt.opts...)...)
			if tun == nil {
				t.Fatalf("unknown tunnel type: %s", tt.tunnelType)
			}
			tun.Close() // no device, no service: these cases are about the event
			tunnel.Add(tun)
			noteNoSpokes(tun)
			if got := len(event.List(tun.ID())); got != tt.want {
				t.Errorf("recorded %d events, want %d: %v", got, tt.want, event.List(tun.ID()))
			}
		})
	}
}

// TestNoteNoPeersCoalesces: the peers page is polled, and a repeated save
// with an empty list must not flood the history — event.Record folds a repeat
// of the newest event into one row with a count, and that is what noteNoSpokes
// relies on to stay quiet.
func TestNoteNoPeersCoalesces(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := preRegisterTunnel(t, tunnel.TunTunnel, "hub", "")
	for i := 0; i < 3; i++ {
		noteNoSpokes(tun)
	}
	evs := event.List(tun.ID())
	if len(evs) != 1 {
		t.Fatalf("recorded %d events, want one folded row: %v", len(evs), evs)
	}
	if evs[0].Count < 3 {
		t.Errorf("count = %d, want 3", evs[0].Count)
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

// TestCreateTunEntryPointValidation: a peer needs a device address and the
// hub's key; everything else is refused before any object (or device) is built.
func TestCreateTunEntryPointValidation(t *testing.T) {
	const key = "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"

	tests := []struct {
		name string
		body map[string]any
	}{
		{
			name: "no net",
			body: map[string]any{"type": "tun", "name": "spoke", "peer": key},
		},
		{
			name: "bad net",
			body: map[string]any{"type": "tun", "name": "spoke", "net": "10.10.0.2", "peer": key},
		},
		{
			name: "no peer",
			body: map[string]any{"type": "tun", "name": "spoke", "net": "10.10.0.2/24"},
		},
		{
			name: "peer is not a key",
			body: map[string]any{"type": "tun", "name": "spoke", "net": "10.10.0.2/24", "peer": "hub.example.com:443"},
		},
		{
			name: "bad route",
			body: map[string]any{"type": "tun", "name": "spoke", "net": "10.10.0.2/24", "peer": key, "routes": "nope"},
		},
		{
			name: "bad dns",
			body: map[string]any{"type": "tun", "name": "spoke", "net": "10.10.0.2/24", "peer": key, "dns": "not-an-ip"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := setupTestServer(t)
			defer srv.Close()

			resp, body := postJSON(t, srv.URL+"/api/entrypoints", tt.body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %v", resp.StatusCode, body)
			}
			if n := entrypoint.Count(); n != 0 {
				t.Errorf("%d entrypoints registered after a rejected create, want 0", n)
			}
		})
	}
}

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

	out := peersJSON(opts.Peers, opts.PeerAliases, nil)
	if len(out) != 2 || out[0].Alias != opts.PeerAliases["k1"] || out[1].Alias != "laptop" {
		t.Errorf("response peers = %+v, want both aliases", out)
	}

	// No stored aliases (a tunnel saved before aliases existed): still named.
	legacy := peersJSON([]string{"k1", "k2"}, nil, []string{"k2"})
	for _, p := range legacy {
		if len(p.Alias) != len("peer-")+4 {
			t.Errorf("legacy peer %s alias = %q, want a generated name", p.Key, p.Alias)
		}
	}
	if legacy[0].Alias == legacy[1].Alias {
		t.Error("legacy peers share one alias")
	}
	if !legacy[1].Disabled || legacy[0].Disabled {
		t.Errorf("disabled flags = %v/%v, want only k2 off", legacy[0].Disabled, legacy[1].Disabled)
	}
	if peersJSON(nil, nil, nil) != nil {
		// An empty allowlist must stay absent from the JSON, not become [].
		if got := peersJSON(nil, nil, nil); len(got) != 0 {
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
		P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Secure: &secure, Direct: &directOff},
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

// TestUpdateP2PTunnelPeers: the peers page saves the allowlist on its own. The
// endpoint replaces just the list (the rest of the config survives), keeps the
// submitted aliases and generates the missing ones, and refuses an entry that
// cannot be a key — a junk key is a route that silently never matches.
func TestUpdateP2PTunnelPeers(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	secure := false
	config.Set(&config.Config{Settings: &config.Settings{
		P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Secure: &secure, Direct: &directOff},
	}})

	key1 := strings.Repeat("A", 43) // base64 of 32 bytes: a well-formed peer key
	key2 := strings.Repeat("B", 43)

	resp, created := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
		"peers": []map[string]any{{"key": key1}},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create p2p tunnel = %d: %v", resp.StatusCode, created)
	}
	id, _ := created["id"].(string)
	defer tunnel.Delete(id)
	before := tunnel.Get(id)

	resp, updated := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key2, "alias": "laptop"}, {"key": key1}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save peers = %d: %v", resp.StatusCode, updated)
	}
	// The list is taken in place: a rebuilt tunnel would be a new object (and
	// would have dropped every live peer stream).
	if after := tunnel.Get(id); after != before {
		t.Fatal("saving the allowlist rebuilt the tunnel; it must apply in place")
	}
	// The peers-only save leaves the rest of the config alone.
	if got, _ := updated["name"].(string); got != "Private" {
		t.Errorf("name after saving peers = %q, want it kept", got)
	}
	if got, _ := updated["endpoint"].(string); got != "127.0.0.1:9" {
		t.Errorf("endpoint after saving peers = %q, want it kept", got)
	}

	peers, _ := updated["options"].(map[string]any)["peers"].([]any)
	if len(peers) != 2 {
		t.Fatalf("saved peers = %v, want two entries", peers)
	}
	p0, _ := peers[0].(map[string]any)
	if p0["key"] != key2 || p0["alias"] != "laptop" {
		t.Errorf("peers[0] = %v, want the submitted alias", p0)
	}
	p1, _ := peers[1].(map[string]any)
	if p1["key"] != key1 {
		t.Errorf("peers[1] = %v, want the second submitted key", p1)
	}
	if a, _ := p1["alias"].(string); a == "" {
		t.Error("an entry without an alias got none back, want a generated one")
	}

	// A junk key: it would be a route nothing ever matches.
	resp, _ = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": "not-a-key"}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("saving a junk key = %d, want 400", resp.StatusCode)
	}

	// A duplicate key: the host routes one key to exactly one tunnel, so a
	// doubled entry is a config error, not a no-op.
	resp, _ = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1}, {"key": key1}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("saving a duplicate key = %d, want 400", resp.StatusCode)
	}

	// Disabling a peer keeps it on the list but takes its route away: the row
	// (and the key) survives so it can be switched back on without retyping.
	resp, updated = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key2, "alias": "laptop", "disabled": true}, {"key": key1}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("disabling a peer = %d: %v", resp.StatusCode, updated)
	}
	peers, _ = updated["options"].(map[string]any)["peers"].([]any)
	if len(peers) != 2 {
		t.Fatalf("peers after disabling = %v, want both kept", peers)
	}
	p0, _ = peers[0].(map[string]any)
	if off, _ := p0["disabled"].(bool); !off || p0["key"] != key2 {
		t.Errorf("peers[0] = %v, want the disabled entry flagged", p0)
	}
	p1, _ = peers[1].(map[string]any)
	if off, _ := p1["disabled"].(bool); off {
		t.Errorf("peers[1] = %v, want the enabled entry unflagged", p1)
	}
	off := tunnel.Get(id).Options().PeerDisabled
	if len(off) != 1 || off[0] != key2 {
		t.Errorf("PeerDisabled = %v, want [%s]", off, key2)
	}

	// The route really is free: a key the host still routed would fail the
	// second tunnel's registration with a conflict.
	resp, other := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Other", "type": "p2p", "endpoint": "127.0.0.1:9",
		"peers": []map[string]any{{"key": key2}},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("claiming a disabled peer's key = %d: %v (the route was not released)", resp.StatusCode, other)
	}
	if otherID, _ := other["id"].(string); otherID != "" {
		defer tunnel.Delete(otherID)
	}

	// The rejected saves changed nothing.
	tun := tunnel.Get(id)
	if tun == nil || len(tun.Options().Peers) != 2 {
		t.Fatalf("allowlist after the rejected saves = %v, want the accepted one", tun.Options().Peers)
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
		P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Secure: &secure, Direct: &directOff},
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

// TestPendingPeersEndpoint: the handler contract. The recording path itself
// (a knock reaching dispatch) is covered in the tunnel package — from out here
// there is no way to make one, so what is checked here is the shape and the
// dismiss semantics.
func TestPendingPeersEndpoint(t *testing.T) {
	ts := setupTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/p2p/pending")
	if err != nil {
		t.Fatalf("GET /api/p2p/pending: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	// The field must be present and empty: that is why the response is a
	// wrapper object rather than a bare array.
	if !strings.Contains(string(raw), `"peers":[]`) {
		t.Fatalf("body = %s, want an empty peers array", raw)
	}

	var body struct {
		Peers []struct {
			Key       string `json:"key"`
			FirstSeen string `json:"first_seen"`
			LastSeen  string `json:"last_seen"`
			Attempts  int    `json:"attempts"`
		} `json:"peers"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Peers) != 0 {
		t.Fatalf("peers = %d, want 0 on a fresh server", len(body.Peers))
	}
}

// TestDismissPendingPeerEndpoint: dismissing is idempotent — a key the TTL (or
// an earlier dismiss) already retired is still a 200, because the caller's
// intent, that the key not be listed, holds either way.
func TestDismissPendingPeerEndpoint(t *testing.T) {
	ts := setupTestServer(t)
	defer ts.Close()

	for i := 0; i < 2; i++ {
		req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/p2p/pending/kQ7Zm0Q0Y2r0k9v2mQm1Z2yq8S5w1Kc3x7bN0rH4tUg", nil)
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("DELETE (attempt %d): %v", i+1, err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("attempt %d: status = %d, want 200", i+1, res.StatusCode)
		}
	}
}

// TestP2PDoctorEndpoint: the endpoint renders the shared doctor report as
// plain text. No host runs in this test, so the snapshot is empty — what is
// checked is that the handler produces a real (non-empty) report with the
// report's section headers, not a JSON error.
func TestP2PDoctorEndpoint(t *testing.T) {
	ts := setupTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/p2p/doctor")
	if err != nil {
		t.Fatalf("GET /api/p2p/doctor: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("content-type = %q, want text/plain", ct)
	}

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	body := string(raw)
	for _, want := range []string{"p2p doctor", "summary:", "peers:", "verdicts:"} {
		if !strings.Contains(body, want) {
			t.Errorf("report missing %q\n---\n%s", want, body)
		}
	}
}

func TestLifecycleRecordsEvents(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	// Registered open (not closed): this case is about the stop path, and
	// preRegisterTunnel leaves its object closed — stopping that one answers 409.
	tun := tunnel.NewByType("tcp",
		tunnel.NameOption("lifecycle"),
		tunnel.EndpointOption("127.0.0.1:0"),
	)
	if tun == nil {
		t.Fatal("unknown tunnel type: tcp")
	}
	tunnel.Add(tun)
	id := tun.ID()

	// Stop: a per-object event.
	resp, _ := postJSON(t, srv.URL+"/api/tunnels/"+id+"/stop", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stop: status %d", resp.StatusCode)
	}
	if got := event.List(id); len(got) != 1 || got[0].Message != "stopped" {
		t.Fatalf("stop recorded %+v, want one \"stopped\"", got)
	}

	// Delete: a global event, since the object it described is gone.
	resp, _ = deleteJSON(t, srv.URL+"/api/tunnels/"+id)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: status %d", resp.StatusCode)
	}
	globals := event.ListGlobal()
	if len(globals) == 0 || !strings.Contains(globals[len(globals)-1].Message, "deleted") {
		t.Fatalf("delete recorded %+v, want a global \"deleted\"", globals)
	}
}

// TestStopForVpnRevokeStopsTheHolder: a revoked VPN takes the device with it —
// another app replaced it, or the user or the system disconnected it — so the
// entrypoint that held it must stop, with a warn event saying why, and a second
// call must find nobody left to stop.
func TestStopForVpnRevokeStopsTheHolder(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	// Created but not started: the seam only needs the entrypoint to be
	// registered and to hold the device, which the claim below does exactly as
	// a running Android tun entrypoint would.
	ep := entrypoint.NewTunEntryPoint(
		tunnel.NameOption("spoke"),
		tunnel.PeerOption("dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"),
	)
	entrypoint.Add(ep)
	id := ep.ID()
	defer tunnel.ReleaseTunDevice(id)

	if owner, ok := tunnel.ClaimTunDevice(id, ep.Name()); !ok {
		t.Fatalf("claim device: already held by %q", owner)
	}

	name, ok := StopForVpnRevoke()
	if !ok || name != ep.Name() {
		t.Fatalf("StopForVpnRevoke = (%q, %v), want (%q, true)", name, ok, ep.Name())
	}
	if holder := entrypoint.Get(id); holder == nil || !holder.IsClosed() {
		t.Fatal("the holder is still running")
	}
	if evs := event.List(id); len(evs) == 0 || evs[len(evs)-1].Level != event.LevelWarn {
		t.Fatalf("events = %+v, want a trailing warn", evs)
	}

	// The holder let the device go on the way out, so there is nobody to report.
	if name, ok := StopForVpnRevoke(); ok || name != "" {
		t.Fatalf("second StopForVpnRevoke = (%q, %v), want (\"\", false)", name, ok)
	}
}

// TestStopForVpnRevokeNoHolder: with no device claimed, the revoke path is a
// no-op rather than a stop of some unrelated entrypoint.
func TestStopForVpnRevokeNoHolder(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	if id, _ := tunnel.TunDeviceOwner(); id != "" {
		t.Fatalf("a previous case left the device claimed by %q", id)
	}
	if name, ok := StopForVpnRevoke(); ok || name != "" {
		t.Fatalf("StopForVpnRevoke with no holder = (%q, %v), want (\"\", false)", name, ok)
	}
}

func TestGlobalEventsEndpoint(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	event.Global(event.LevelWarn, "relay connect failed: timeout")

	resp, body := getJSON(t, srv.URL+"/api/events")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET: status %d", resp.StatusCode)
	}
	list, _ := body["events"].([]any)
	if len(list) != 1 {
		t.Fatalf("GET returned %v", body["events"])
	}
	first, _ := list[0].(map[string]any)
	if first["message"] != "relay connect failed: timeout" || first["level"] != event.LevelWarn {
		t.Errorf("event = %v", first)
	}

	resp, _ = deleteJSON(t, srv.URL+"/api/events")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE: status %d", resp.StatusCode)
	}
	if n := len(event.ListGlobal()); n != 0 {
		t.Errorf("DELETE left %d events", n)
	}
}

func TestTunnelResponseCarriesEvents(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	tun := preRegisterTunnel(t, "tcp", "with history", "127.0.0.1:0")
	event.Record(tun.ID(), event.LevelError, "service failed: boom")

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+tun.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	list, _ := body["events"].([]any)
	if len(list) != 1 {
		t.Fatalf("events = %v", body["events"])
	}
	first, _ := list[0].(map[string]any)
	if first["message"] != "service failed: boom" {
		t.Errorf("message = %v", first["message"])
	}
	if first["level"] != event.LevelError {
		t.Errorf("level = %v, want %q", first["level"], event.LevelError)
	}
}

// actionIDRe pulls the id field out of a text-handler log line.
var actionIDRe = regexp.MustCompile(`\bid=([0-9a-f]+)\b`)

// TestMutationLogCarriesActionID: the mutation line carries the request's action
// id — the one the UI sent, or a generated one when the header is absent — so
// it can be joined with the p2p seam line for the work the action started. The
// generated id is 8 hex chars and never repeats: two requests must be told
// apart in one log tail.
func TestMutationLogCarriesActionID(t *testing.T) {
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(old) })

	h := NewHandler(nil)

	// The UI's id is logged as given.
	buf.Reset()
	req := httptest.NewRequest(http.MethodDelete, "/api/tunnels/missing", nil)
	req.Header.Set(actionHeader, "abc123")
	h.ServeHTTP(httptest.NewRecorder(), req)
	if got := buf.String(); !strings.Contains(got, "id=abc123") {
		t.Fatalf("log = %q, want the sent id (id=abc123)", got)
	}

	// No header: a generated id, still correlatable.
	var ids []string
	for i := 0; i < 2; i++ {
		buf.Reset()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodDelete, "/api/tunnels/missing", nil))
		m := actionIDRe.FindStringSubmatch(buf.String())
		if m == nil {
			t.Fatalf("log = %q, want a generated id field", buf.String())
		}
		if len(m[1]) != 8 {
			t.Fatalf("generated id = %q, want 8 hex chars", m[1])
		}
		ids = append(ids, m[1])
	}
	if ids[0] == ids[1] {
		t.Fatalf("two requests share the generated id %q, want one each", ids[0])
	}

	// A GET mutates nothing, so it is not part of this trail.
	buf.Reset()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/tunnels", nil))
	if got := buf.String(); strings.Contains(got, "id=") {
		t.Fatalf("GET log = %q, want no mutation line", got)
	}
}

// TestHasP2PPeers: which objects take the process-wide p2p host's snapshot.
//
// This is the whole of the hub-is-blind defect. The condition used to name a
// tunnel type, so a tun hub was left out even though it reaches its peers over
// that same host and PeerStats already returns them — its rows carried the
// traffic counters and empty strings for everything the host knows: no path
// word, no punch state, no last error. A hub is where a peer's FIRST
// connection is hardest (the spoke is behind NAT, the hub holds the key), so
// it is the least useful place to be blind.
//
// The question is asked of the peers rather than the type, so the cases pin
// that: a peer-less object of any type must stay out (the snapshot is a
// whole-host read and there is nothing to show for it), while every object that
// names a p2p peer must be in. A p2p entrypoint's single peer counts as much
// as a tunnel's allowlist, and a tun hub's spokes as much as a p2p tunnel's.
//
// The words the snapshot supplies are p2p's, for a peer with a live data path,
// which needs a relay and a real peer: tunnel/p2p_e2e_test (tag p2ppoc) proves
// those values end to end. What this pins is that the handler reads the
// snapshot at all for a hub, which is what it stopped doing.
func TestHasP2PPeers(t *testing.T) {
	key := strings.Repeat("A", 43) // base64 of 32 bytes: a well-formed peer key

	cases := []struct {
		name string
		opts tunnel.Options
		want bool
	}{
		{"p2p tunnel with an allowlist", tunnel.Options{Peers: []string{key}}, true},
		// The case the condition got wrong: a hub's spokes are p2p peers, so
		// its allowlist must buy the host snapshot like a tunnel's does.
		{"tun hub with spokes", tunnel.Options{Peers: []string{key}}, true},
		{"p2p entrypoint's single peer", tunnel.Options{Peer: key}, true},
		{"p2p tunnel with an empty allowlist", tunnel.Options{}, false},
		{"tun hub with no spokes", tunnel.Options{}, false},
		{"ordinary tunnel", tunnel.Options{Endpoint: "127.0.0.1:9"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasP2PPeers(tc.opts); got != tc.want {
				t.Errorf("hasP2PPeers(peer=%q, peers=%d) = %v, want %v",
					tc.opts.Peer, len(tc.opts.Peers), got, tc.want)
			}
		})
	}
}

// TestTunHubRowsFollowItsAllowlist: a hub's per-peer report is its own
// allowlist, one row per spoke in allowlist order, exactly as a p2p tunnel's
// is. The rows are filled from the hub's PeerStats, and the host's per-peer
// words are merged onto them when hasP2PPeers says to — so a hub's rows and a
// p2p tunnel's are built by the same code from the same two interfaces.
//
// A hub cannot run here: creating the device needs root, and an unrun hub has
// no route, so PeerStats is nil and there are no rows to read. What is pinned
// is the part that does not need a device: a hub's response answers with the
// allowlist intact, which is what its rows are built from, and a peer-less
// object reports nothing.
func TestTunHubRowsFollowItsAllowlist(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()

	key := strings.Repeat("A", 43)

	hub := tunnel.NewTunTunnel(
		tunnel.NameOption("Hub"),
		tunnel.NetOption("10.10.0.1/24"),
		tunnel.PeersOption(key),
	)
	hub.Close() // no device is created (that needs root) and no route is claimed
	tunnel.Add(hub)
	defer tunnel.Delete(hub.ID())

	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+hub.ID())
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get hub = %d: %v", resp.StatusCode, body)
	}
	peers, _ := body["options"].(map[string]any)["peers"].([]any)
	if len(peers) != 1 {
		t.Fatalf("hub allowlist = %v, want the spoke it was built with", body["options"])
	}
	if first, _ := peers[0].(map[string]any); first["key"] != key {
		t.Errorf("allowlist[0] = %v, want the spoke's key", first)
	}

	// A peer-less object stays out of the snapshot and reports nothing, so a
	// plain tunnel's response is unchanged by any of this.
	plain := preRegisterTunnel(t, tunnel.TCPTunnel, "Plain", "127.0.0.1:9")
	if rows := peerStatsRows(t, srv, plain.ID()); len(rows) != 0 {
		t.Errorf("a tunnel with no peers has %d peer_stats rows, want none", len(rows))
	}
}

// peerStatsRows reads one object's per-peer report off the API, as the UI does.
func peerStatsRows(t *testing.T, srv *httptest.Server, id string) []map[string]any {
	t.Helper()
	resp, body := getJSON(t, srv.URL+"/api/tunnels/"+id)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get %s = %d: %v", id, resp.StatusCode, body)
	}
	raw, _ := body["peer_stats"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, r := range raw {
		if m, ok := r.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}
