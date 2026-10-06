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

	return httptest.NewServer(NewHandler(nil, false))
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

// TestUpdateConfigP2PFaults: the fault-injection block survives the settings
// round trip the manual harness drives (PUT /api/config, then the host reads it
// back on acquire), so a faults config set through the API reaches the engine
// rather than being silently dropped by the response type.
func TestUpdateConfigP2PFaults(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, _ := putJSON(t, srv.URL+"/api/config", map[string]any{
		"p2p": map[string]any{
			"derp": "wss://relay.example/derp",
			"faults": map[string]any{
				"dropDataRate": 0.05,
			},
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
	faults, _ := p2p["faults"].(map[string]any)
	if faults == nil {
		t.Fatalf("config has no p2p.faults block: %v", body)
	}
	if rate, ok := faults["dropDataRate"].(float64); !ok || rate != 0.05 {
		t.Errorf("dropDataRate = %v, want 0.05", faults["dropDataRate"])
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
	// nil is what a non-hub has to settle to: a p2p tunnel's rows carry no address.
	for _, opt := range req.toOptions(nil) {
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

	out := peersJSON(opts.Peers, opts.PeerAliases, nil, opts.PeerIPs)
	if len(out) != 2 || out[0].Alias != opts.PeerAliases["k1"] || out[1].Alias != "laptop" {
		t.Errorf("response peers = %+v, want both aliases", out)
	}

	// No stored aliases (a tunnel saved before aliases existed): still named.
	legacy := peersJSON([]string{"k1", "k2"}, nil, []string{"k2"}, nil)
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
	// A row with an address of its own carries it out with it, and one with none is
	// left without the field rather than given an empty one: absent is what tells a
	// save "unchanged", and a response that said otherwise would ask the operator's
	// own client to clear every address the hub holds.
	withIP := peersJSON([]string{"k1"}, nil, nil, map[string]string{"k1": "10.10.0.2"})
	if len(withIP) != 1 || withIP[0].IP == nil || *withIP[0].IP != "10.10.0.2" {
		t.Errorf("peersJSON with an assignment = %+v, want the row carrying 10.10.0.2", withIP)
	}
	if got := peersJSON([]string{"k1"}, nil, nil, map[string]string{"other": "10.10.0.2"})[0].IP; got != nil {
		t.Errorf("a row with no assignment carries %q, want the field absent", *got)
	}
	// A spoke the operator cleared holds "", and that is not the same thing as a
	// spoke with nothing: it must not come back looking like a request to clear.
	if got := peersJSON([]string{"k1"}, nil, nil, map[string]string{"k1": ""})[0].IP; got != nil {
		t.Errorf("a row with an empty assignment carries %q, want the field absent", *got)
	}
	if peersJSON(nil, nil, nil, nil) != nil {
		// An empty allowlist must stay absent from the JSON, not become [].
		if got := peersJSON(nil, nil, nil, nil); len(got) != 0 {
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

// TestRestartForVpnSwapRestartsTheHolder: the VpnService rebuilt the device
// under a running tun entrypoint, so the holder must be restarted — a new
// entrypoint object whose run re-reads the device — with an event saying why.
// A second call with nobody holding the device is a no-op.
func TestRestartForVpnSwapRestartsTheHolder(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	// Created but not started: the seam only needs the entrypoint registered
	// and holding the device, which the claim below does exactly as a running
	// Android tun entrypoint would.
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

	done := make(chan struct{})
	var name string
	var ok bool
	go func() {
		name, ok = RestartForVpnSwap()
		close(done)
	}()

	// The restart re-registers the entrypoint before it runs, so the new object
	// is observable even while the new run is still starting.
	deadline := time.Now().Add(3 * time.Second)
	for entrypoint.Get(id) == ep && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := entrypoint.Get(id); got == nil || got == ep {
		t.Fatal("the holder was not recreated")
	}

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("RestartForVpnSwap did not return")
	}
	if !ok || name != ep.Name() {
		t.Fatalf("RestartForVpnSwap = (%q, %v), want (%q, true)", name, ok, ep.Name())
	}
	if evs := event.List(id); len(evs) == 0 {
		t.Fatal("want an event recording the restart")
	}
}

// TestRestartForVpnSwapNoHolder: with no device claimed, the swap path is a
// no-op rather than a restart of some unrelated entrypoint.
func TestRestartForVpnSwapNoHolder(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	if id, _ := tunnel.TunDeviceOwner(); id != "" {
		t.Fatalf("a previous case left the device claimed by %q", id)
	}
	if name, ok := RestartForVpnSwap(); ok || name != "" {
		t.Fatalf("RestartForVpnSwap with no holder = (%q, %v), want (\"\", false)", name, ok)
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

	h := NewHandler(nil, false)

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

// ---------------------------------------------------------------------------
// A tun hub's peers carry the address each spoke may claim
// ---------------------------------------------------------------------------

// defaultLogger installs a real one for the duration of the test. The gost default
// logger is nil here (wisper sets it at startup) and tunTunnel.Run dereferences it,
// so any test that reaches a hub's device needs this — it is a helper rather than
// a line in each test because forgetting it is invisible: the panic lands in the
// server's goroutine, and the test fails only if it happened to run first. Only
// restore a logger that was there — Store(nil) panics on an atomic.Value.
func defaultLogger(t *testing.T) {
	t.Helper()
	if oldLog := clogger.Default(); oldLog != nil {
		t.Cleanup(func() { clogger.SetDefault(oldLog) })
	}
	clogger.SetDefault(xlogger.NewLogger(xlogger.LevelOption(clogger.ErrorLevel)))
}

// startTunHub creates a tun hub through the API and returns its id. The device is
// what makes a hub a hub, so a case that needs one is skipped rather than asserted
// against a hub that never ran: creating the device needs CAP_NET_ADMIN. Each
// caller passes its own subnet, because a hub adds a connected route for the net
// it holds and two devices on one subnet would collide.
func startTunHub(t *testing.T, srv *httptest.Server, netSpec string) string {
	t.Helper()
	defaultLogger(t)

	resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"type": "tun", "name": "hub", "net": netSpec,
	})
	if resp.StatusCode == http.StatusInternalServerError {
		t.Skipf("no CAP_NET_ADMIN here: the hub's device could not be created (%v)", body["error"])
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create tun hub on %s = %d: %v", netSpec, resp.StatusCode, body)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("created hub on %s has no id: %v", netSpec, body)
	}
	t.Cleanup(func() { tunnel.Delete(id) })
	return id
}

// closedHub registers a tun hub that is not running: no device, no route. It is
// all the refusal cases below need, because a row the hub cannot honour is refused
// before anything is applied — which is what makes the refusal an answer to this
// request instead of an event with nobody left to connect it to a fix.
func closedHub(t *testing.T, netSpec string) string {
	t.Helper()
	hub := tunnel.NewTunTunnel(tunnel.NameOption("hub"), tunnel.NetOption(netSpec))
	hub.Close() // nothing here needs a running hub, and nothing here runs one
	tunnel.Add(hub)
	t.Cleanup(func() { tunnel.Delete(hub.ID()) })
	return hub.ID()
}

// peerRows reads the allowlist off a response body, as the peers page does.
func peerRows(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	raw, _ := body["options"].(map[string]any)["peers"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, r := range raw {
		if m, ok := r.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

// rowIP is one allowlist row's address out of a response, or "" when the field is
// absent. Absent is not "allocate me one": it is "unchanged", the ruling a save
// with no ip in the request keeps the address the spoke already holds. It is also
// what a row with no address comes back as, which is the same sentence said back —
// so a response never reads as a request to clear.
func rowIP(row map[string]any) string {
	ip, _ := row["ip"].(string)
	return ip
}

// offlineP2P points the process-wide p2p host at an unreachable relay: the connect
// is non-fatal and the host routes anyway, which is all these cases need of it, and
// it keeps the run off the network.
func offlineP2P() {
	secure := false
	config.Set(&config.Config{Settings: &config.Settings{
		P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Secure: &secure, Direct: &directOff},
	}})
}

// TestUpdateTunnelPeersCarriesTheAddress: a row round trips its address out to the
// UI and back in. A hub is the allocator of record, so a spoke listed with no
// address of its own is given one from the hub's own subnet by the save that lists
// it — and the answer comes back on the row, so the peers page shows the address the
// spoke was given instead of a blank nobody can act on.
//
// It has to be that save that fills it: an empty row is the state that means "this
// spoke may claim nothing", so storing what was typed would lock a spoke out of the
// device address the hub would have handed it, with no error anywhere.
func TestUpdateTunnelPeersCarriesTheAddress(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key1, key2 := strings.Repeat("C", 43), strings.Repeat("D", 43)
	id := startTunHub(t, srv, "10.10.0.1/24")

	// Both spokes are saved with no address at all. 10.10.0.1 is the hub's own, so
	// the first two free addresses are .2 and .3, in allowlist order.
	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1, "alias": "laptop"}, {"key": key2}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save two spokes = %d: %v", resp.StatusCode, saved)
	}
	rows := peerRows(t, saved)
	if len(rows) != 2 {
		t.Fatalf("saved allowlist = %v, want the two spokes", rows)
	}
	if got := rowIP(rows[0]); got != "10.10.0.2" {
		t.Errorf("the first spoke's address = %q, want 10.10.0.2", got)
	}
	if got := rowIP(rows[1]); got != "10.10.0.3" {
		t.Errorf("the second spoke's address = %q, want 10.10.0.3", got)
	}
	// In force, not merely in the reply: the response is built from the hub's own
	// options, so this is the same map the authorizer holds from here on.
	if got := tunnel.Get(id).Options().PeerIPs; len(got) != 2 || got[key1] != "10.10.0.2" || got[key2] != "10.10.0.3" {
		t.Errorf("the hub's assignment = %v, want both spokes holding what they were given", got)
	}
	// The whole assignment is on the response too, the shape a config file carries,
	// so a client may read the map or the rows and get the same thing.
	ips, _ := saved["options"].(map[string]any)["peer_ips"].(map[string]any)
	if len(ips) != 2 || ips[key1] != "10.10.0.2" {
		t.Errorf("options.peer_ips = %v, want the two allocated rows", ips)
	}

	// And back in: the peers page saves what it was shown, and the addresses come
	// back unchanged rather than being allocated a second time.
	resp, again := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{"peers": rows})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save the allowlist back = %d: %v", resp.StatusCode, again)
	}
	if got := tunnel.Get(id).Options().PeerIPs; got[key1] != "10.10.0.2" || got[key2] != "10.10.0.3" {
		t.Errorf("the assignment after the round trip = %v, want it unchanged", got)
	}

	// An address the operator typed is kept, padding trimmed, and a row that says
	// nothing about its address keeps what its spoke already had. This is the rule
	// that makes an address belong to a spoke: the second spoke still holds .3
	// although .2 is sitting free, because nothing about this save was about it.
	resp, retyped := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1, "alias": "laptop", "ip": " 10.10.0.9 "}, {"key": key2}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save a typed address = %d: %v", resp.StatusCode, retyped)
	}
	rows = peerRows(t, retyped)
	if len(rows) != 2 {
		t.Fatalf("allowlist after the typed address = %v, want both spokes", rows)
	}
	if got := rowIP(rows[0]); got != "10.10.0.9" {
		t.Errorf("the typed address = %q, want 10.10.0.9, padding trimmed", got)
	}
	if got := rowIP(rows[1]); got != "10.10.0.3" {
		t.Errorf("the unmentioned spoke's address = %q, want 10.10.0.3 kept: this save was not about it", got)
	}

	// A GET is built the same way, so the page that reads the assignment off the
	// list and the page that saves it are looking at one fact.
	_, fetched := getJSON(t, srv.URL+"/api/tunnels/"+id)
	rows = peerRows(t, fetched)
	if len(rows) != 2 {
		t.Fatalf("allowlist on a GET = %v, want both spokes", rows)
	}
	if got := rowIP(rows[0]); got != "10.10.0.9" {
		t.Errorf("the address on a GET = %q, want the one in force", got)
	}
}

// TestUpdateTunnelPeersAcceptsAnUnmappedAddress: the accepting half of
// validatePeerIP's unmap. ::ffff:10.10.0.2 is the same address as 10.10.0.2, and a
// row written that way is one the hub will hand to a spoke announcing it — an IPv4
// claim arrives over the wire as ::ffff:10.10.0.2, so the two have to compare
// equal or the spoke is turned away as unauthorized with no mistake anywhere to
// point at.
//
// On the tunnel layer's filter path that unmap is redundant, because an unmapAll
// has already run, so this handler is the only place the branch is ever
// load-bearing. Refused here, every IPv4 spoke whose row is written in that form
// loses its address to a message naming a subnet it is plainly inside — and nothing
// else in the tree would catch it.
//
// The row is stored as it was written: the value is the operator's own text, and
// the authorizer unmaps it when it decides.
func TestUpdateTunnelPeersAcceptsAnUnmappedAddress(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key1, key2 := strings.Repeat("C", 43), strings.Repeat("D", 43)
	id := startTunHub(t, srv, "10.10.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{
			{"key": key1, "ip": "::ffff:10.10.0.2"},
			{"key": key2, "ip": "10.10.0.3"},
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("a row written ::ffff:10.10.0.2 = %d: %v, want 200", resp.StatusCode, saved)
	}
	rows := peerRows(t, saved)
	if len(rows) != 2 {
		t.Fatalf("saved allowlist = %v, want both spokes", rows)
	}
	if got := rowIP(rows[0]); got != "::ffff:10.10.0.2" {
		t.Errorf("the accepted row = %q, want it kept as it was written", got)
	}
	// Accepted means in force: the hub's own filter runs over the row this handler
	// hands it, and a row dropped there would authorize nothing while the API said
	// it was saved.
	if got := tunnel.Get(id).Options().PeerIPs; got[key1] != "::ffff:10.10.0.2" || got[key2] != "10.10.0.3" {
		t.Errorf("the hub's assignment = %v, want both rows in force", got)
	}
}

// TestUpdateTunnelPeersRejectsAnOutOfSubnetAddress: an address the hub's device is
// not on is refused where it was typed, naming the spoke, the address and the
// subnets it would have had to come from — an operator can fix a row that says all
// three, and cannot fix one that says "invalid request".
//
// The hub filters such a row out itself, by dropping it and warning, but by then
// the request is gone: the spoke is saved with no address at all, which reads as
// "may claim nothing" and is refused at registration with a message pointing
// nowhere near the cause. A stopped hub is all this needs, because the refusal
// happens before anything is applied.
func TestUpdateTunnelPeersRejectsAnOutOfSubnetAddress(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	key := strings.Repeat("C", 43)
	id := closedHub(t, "10.10.0.1/24")

	resp, body := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key, "ip": "192.168.9.9"}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("an address outside the hub's subnet = %d: %v, want 400", resp.StatusCode, body)
	}
	msg, _ := body["error"].(string)
	for _, want := range []string{key, "192.168.9.9", "10.10.0.0/24"} {
		if !strings.Contains(msg, want) {
			t.Errorf("the refusal %q does not name %q", msg, want)
		}
	}
	// A refused save changed nothing.
	if got := tunnel.Get(id).Options(); len(got.Peers) != 0 || len(got.PeerIPs) != 0 {
		t.Errorf("the hub after a refused save = %v / %v, want it untouched", got.Peers, got.PeerIPs)
	}
}

// TestUpdateTunnelPeersRejectsAPrefix: a row names host addresses, not networks. A
// device holds one address, so "10.10.0.2/24" is a row no spoke could ever hold —
// and it is refused at the request instead of stored, because the hub's own filter
// drops it as an event that no request is left to explain.
func TestUpdateTunnelPeersRejectsAPrefix(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	key := strings.Repeat("C", 43)
	id := closedHub(t, "10.10.0.1/24")

	resp, body := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key, "ip": "10.10.0.2/24"}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a prefix where an address belongs = %d: %v, want 400", resp.StatusCode, body)
	}
	msg, _ := body["error"].(string)
	if !strings.Contains(msg, key) || !strings.Contains(msg, "10.10.0.2/24") {
		t.Errorf("the refusal %q does not name the row and the spoke", msg)
	}
	if got := tunnel.Get(id).Options(); len(got.Peers) != 0 || len(got.PeerIPs) != 0 {
		t.Errorf("the hub after a refused save = %v / %v, want it untouched", got.Peers, got.PeerIPs)
	}
}

// TestUpdateTunnelPeersRejectsAnAddressItsSubnetKeepsBack: the two addresses a
// /24 holds for itself — the network address and the broadcast address — are
// refused where they were typed, naming the spoke, the address, and which of the
// two it is.
//
// Nothing in the kernel would have refused them: checked against a real tun
// device, Linux accepts 10.10.0.0/24 and 10.10.0.255/24 and gives both
// scope-host local routes. They are not equally usable, though. The network
// address carries traffic and delivers to a socket bound on it, whereas lookups
// go on classifying the broadcast address as broadcast — ip route get reports
// broadcast even with an explicit /32 unicast host route installed and never
// used — and ping refuses it. So refusing the broadcast address is the safer of
// the two rules rather than the pedantic one, and the two cases below differ for
// reasons the kernel supplies, not for uniformity's sake.
//
// Both are the hub's own rule, and the reason it has to be enforced at the
// request rather than left to the hub's filter is the same as for every other
// refusal: the hub would drop such a row as an event the request is no longer
// around to explain, leaving the spoke saved with no address at all.
func TestUpdateTunnelPeersRejectsAnAddressItsSubnetKeepsBack(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	key := strings.Repeat("C", 43)
	for _, tc := range []struct {
		addr string
		role string
	}{
		{"10.10.0.0", "is the network address of 10.10.0.0/24"},
		{"10.10.0.255", "is the broadcast address of 10.10.0.0/24"},
	} {
		t.Run(tc.addr, func(t *testing.T) {
			id := closedHub(t, "10.10.0.1/24")

			resp, body := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
				"peers": []map[string]any{{"key": key, "ip": tc.addr}},
			})
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("%s = %d: %v, want 400", tc.addr, resp.StatusCode, body)
			}
			msg, _ := body["error"].(string)
			for _, want := range []string{key, tc.addr, tc.role} {
				if !strings.Contains(msg, want) {
					t.Errorf("the refusal %q does not name %q", msg, want)
				}
			}
			if got := tunnel.Get(id).Options(); len(got.Peers) != 0 || len(got.PeerIPs) != 0 {
				t.Errorf("the hub after a refused save = %v / %v, want it untouched", got.Peers, got.PeerIPs)
			}
		})
	}
}

// TestUpdateTunnelPeersRejectsADuplicateAddress: two rows naming one address. The
// hub's route table is last-writer-wins per address, so the second spoke to
// register silently takes the first one's route and its traffic goes to the wrong
// device, with nothing anywhere saying so. Both rows are named, because the
// refusal is about the pair and fixing one of them is not enough.
//
// One address written two ways is the same address: ::ffff:10.10.0.2 and
// 10.10.0.2 are one address in two spellings, so the pair is caught as the
// duplicate it is rather than as two rows that merely look alike.
func TestUpdateTunnelPeersRejectsADuplicateAddress(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	key1, key2 := strings.Repeat("C", 43), strings.Repeat("D", 43)
	id := closedHub(t, "10.10.0.1/24")

	cases := []struct {
		name  string
		peers []map[string]any
		want  []string
	}{
		{
			name: "two rows naming one address",
			peers: []map[string]any{
				{"key": key1, "ip": "10.10.0.2"},
				{"key": key2, "ip": "10.10.0.2"},
			},
			want: []string{key1, key2, "10.10.0.2"},
		},
		{
			name: "one address written two ways",
			peers: []map[string]any{
				{"key": key1, "ip": "::ffff:10.10.0.2"},
				{"key": key2, "ip": "10.10.0.2"},
			},
			want: []string{key1, key2, "10.10.0.2"},
		},
		{
			name:  "one row naming it twice",
			peers: []map[string]any{{"key": key1, "ip": "10.10.0.2,10.10.0.2"}},
			want:  []string{key1, "10.10.0.2"},
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			resp, body := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{"peers": tt.peers})
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("a contested address = %d: %v, want 400", resp.StatusCode, body)
			}
			msg, _ := body["error"].(string)
			for _, want := range tt.want {
				if !strings.Contains(msg, want) {
					t.Errorf("the refusal %q does not name %q", msg, want)
				}
			}
			if got := tunnel.Get(id).Options(); len(got.Peers) != 0 || len(got.PeerIPs) != 0 {
				t.Errorf("the hub after a refused save = %v / %v, want it untouched", got.Peers, got.PeerIPs)
			}
		})
	}
}

// TestUpdateTunnelPeersRefusesAllocationWithoutANet: a hub with no net has nothing
// to allocate from, so every row on it has to be typed. The refusal names the
// spoke that could not be given an address, which is the difference between an
// operator knowing which row to fill and one reading "invalid request".
//
// A typed row is deliberately not refused on such a hub. With no subnet there is
// no subnet for an address to be outside of, and the hub's own filter leaves such
// rows alone (see tunTunnel.honorablePeerIPs): refusing them here would make the
// API stricter than the hub and turn one missing "net" into a save that cannot be
// made. The request getting as far as the routes — a stopped hub has none, hence
// the 409 — is what shows the row was let through.
func TestUpdateTunnelPeersRefusesAllocationWithoutANet(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	key := strings.Repeat("C", 43)
	id := closedHub(t, "")

	resp, body := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unallocatable row on a hub with no net = %d: %v, want 400", resp.StatusCode, body)
	}
	msg, _ := body["error"].(string)
	if !strings.Contains(msg, key) || !strings.Contains(msg, "no subnet configured") {
		t.Errorf("the refusal %q does not name the spoke and the missing subnet", msg)
	}

	resp, body = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key, "ip": "10.10.0.2"}},
	})
	if resp.StatusCode == http.StatusBadRequest {
		t.Fatalf("a typed row on a hub with no net = %d: %v, want it past validation", resp.StatusCode, body)
	}
	if msg, _ := body["error"].(string); strings.Contains(msg, "no subnet") {
		t.Errorf("the refusal %q blames the missing subnet for a row that needs none", msg)
	}
}

// TestUpdateTunnelPeersRefusesRowsItCannotHonour: the rest of what the hub's own
// filter drops, refused here for the same reason and with the same insistence on
// naming the row. The hub's own address, which is inside the hub's subnet by
// construction, so asking only about subnets would wave it through and say nothing
// about why it is refused; a hostname, which nothing downstream resolves, so an
// unresolvable row is indistinguishable from a typo; and a hole in the list, where
// "10.10.0.2,,10.10.0.3" is a row whose second address went missing rather than a
// row of two.
func TestUpdateTunnelPeersRefusesRowsItCannotHonour(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	key1, key2 := strings.Repeat("C", 43), strings.Repeat("D", 43)
	id := closedHub(t, "10.10.0.1/24")

	cases := []struct {
		name string
		ip   string
		want string
	}{
		{"the hub's own address", "10.10.0.1", "the hub's own address"},
		{"a hostname", "spoke.example.com", "comma-separated list of IP addresses"},
		{"a hole in the list", "10.10.0.2,,10.10.0.3", "comma-separated list of IP addresses"},
		{"a bare word", "spoke", "comma-separated list of IP addresses"},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			resp, body := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
				"peers": []map[string]any{{"key": key1, "ip": tt.ip}, {"key": key2}},
			})
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("%s = %d: %v, want 400", tt.name, resp.StatusCode, body)
			}
			msg, _ := body["error"].(string)
			for _, want := range []string{key1, tt.want} {
				if !strings.Contains(msg, want) {
					t.Errorf("the refusal %q does not name %q", msg, want)
				}
			}
			// The other row was sound and is refused with it: the request is one
			// allowlist, so it is answered whole or not at all.
			if strings.Contains(msg, key2) {
				t.Errorf("the refusal %q blames the sound row as well", msg)
			}
			if got := tunnel.Get(id).Options(); len(got.Peers) != 0 || len(got.PeerIPs) != 0 {
				t.Errorf("the hub after a refused save = %v / %v, want it untouched", got.Peers, got.PeerIPs)
			}
		})
	}
}

// TestUpdateTunnelPeersSetsTheRoutesBeforeTheAssignment: the order of the two
// saves is load-bearing, and this is the case that pins it. Reconciling the routes
// can fail — a key another tunnel holds is the host's one refusal — and it is
// all-or-nothing, so a failure leaves the hub holding the assignment it had. The
// other way round would have swapped the assignment first and then left a spoke
// holding a route whose address had just been withdrawn: a black hole with nothing
// in the reply to explain it.
func TestUpdateTunnelPeersSetsTheRoutesBeforeTheAssignment(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key1, key2, key3 := strings.Repeat("C", 43), strings.Repeat("D", 43), strings.Repeat("E", 43)
	id := startTunHub(t, srv, "10.20.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1}, {"key": key2}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save two spokes = %d: %v", resp.StatusCode, saved)
	}
	if got := tunnel.Get(id).Options().PeerIPs; got[key1] != "10.20.0.2" || got[key2] != "10.20.0.3" {
		t.Fatalf("the assignment after the first save = %v, want the two allocated addresses", got)
	}

	// Another tunnel holds the third key's route, so the hub's next save cannot
	// have it.
	resp, other := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Other", "type": "p2p", "endpoint": "127.0.0.1:9",
		"peers": []map[string]any{{"key": key3}},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create the tunnel holding %s = %d: %v", key3, resp.StatusCode, other)
	}
	if otherID, _ := other["id"].(string); otherID != "" {
		t.Cleanup(func() { tunnel.Delete(otherID) })
	}

	// The refused save moves one spoke's address and adds the third spoke, which is
	// exactly the kind of change the routes have to follow.
	resp, refused := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{
			{"key": key1, "ip": "10.20.0.2"},
			{"key": key2, "ip": "10.20.0.9"},
			{"key": key3, "ip": "10.20.0.4"},
		},
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("a save claiming another tunnel's key = %d: %v, want 409", resp.StatusCode, refused)
	}
	if msg, _ := refused["error"].(string); !strings.Contains(msg, key3) {
		t.Errorf("the refusal %q does not name the key that is taken", msg)
	}

	// Nothing moved: the assignment is the one that was in force, and the third
	// spoke was never given a row it could be refused against.
	if got := tunnel.Get(id).Options().PeerIPs; len(got) != 2 || got[key1] != "10.20.0.2" || got[key2] != "10.20.0.3" {
		t.Errorf("the assignment after a refused save = %v, want it unchanged", got)
	}
	if got := tunnel.Get(id).Options().Peers; len(got) != 2 {
		t.Errorf("the allowlist after a refused save = %v, want the two spokes it had", got)
	}
}

// TestUpdateTunnelKeepsUnmentionedAddresses: the ruling, at the full-tunnel PUT —
// a save that does not mention a spoke's address does not move it. This is the
// shape that used to lock the network out: the detail page PUTs the tunnel with
// its peers listed and no ip on them (a client that never learned the field), the
// rows came back as "" — "may claim nothing" — every spoke was refused, and every
// signal said healthy, because "" is what "not allocated yet" also looks like.
//
// The second half is the other half of the ruling: an address the operator types is
// taken, and one they clear with an explicit empty string is replaced. So there is
// exactly one way to move a spoke to a different address, and it is a request that
// says so.
func TestUpdateTunnelKeepsUnmentionedAddresses(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key := strings.Repeat("C", 43)
	id := startTunHub(t, srv, "10.40.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key, "ip": "10.40.0.7"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save one spoke = %d: %v", resp.StatusCode, saved)
	}
	// .7 and not the .2 the allocator hands out first, so that "kept" and
	// "reallocated" cannot look the same from here: every case below is about an
	// address that allocation would not have chosen.
	if got := tunnel.Get(id).Options().PeerIPs[key]; got != "10.40.0.7" {
		t.Fatalf("the assignment after the peers save = %q, want 10.40.0.7", got)
	}

	// The body below names the spoke and says nothing about its address.
	resp, kept := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "hub", "type": "tun", "net": "10.40.0.1/24",
		"peers": []map[string]any{{"key": key, "alias": "laptop"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update the whole hub = %d: %v", resp.StatusCode, kept)
	}
	if got := tunnel.Get(id).Options().PeerIPs[key]; got != "10.40.0.7" {
		t.Errorf("the assignment after a PUT that did not mention it = %q, want 10.40.0.7 kept", got)
	}
	if got := config.Get().Tunnels[0].PeerIPs[key]; got != "10.40.0.7" {
		t.Errorf("the persisted assignment = %q, want 10.40.0.7, not an empty row", got)
	}

	// The same again with the alias changed, since that is the edit the detail page
	// actually offers and the one that used to take the addresses with it.
	resp, renamed := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "renamed", "type": "tun", "net": "10.40.0.1/24",
		"peers": []map[string]any{{"key": key, "alias": "desktop"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rename the hub = %d: %v", resp.StatusCode, renamed)
	}
	if got := tunnel.Get(id).Options().PeerIPs[key]; got != "10.40.0.7" {
		t.Errorf("the assignment after a rename = %q, want 10.40.0.7 kept", got)
	}

	// Clearing an address on purpose is the one request that does replace it, and
	// what replaces it is the first free address of the hub's subnet — .2, which is
	// what a save that reallocated would also have produced.
	resp, cleared := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "renamed", "type": "tun", "net": "10.40.0.1/24",
		"peers": []map[string]any{{"key": key, "alias": "desktop", "ip": ""}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear the spoke's address = %d: %v", resp.StatusCode, cleared)
	}
	if got := tunnel.Get(id).Options().PeerIPs[key]; got != "10.40.0.2" {
		t.Errorf("the assignment after an explicit clear = %q, want a fresh 10.40.0.2", got)
	}
}

// TestUpdateTunnelValidatesTheAssignmentItCarries: the full-tunnel PUT applies the
// same policy as the peers door, and has to — it rebuilds the hub, so anything it
// does not check is written straight through and only discovered afterwards, when
// the new hub's own filter drops the row and SaveConfig persists the loss. The old
// answers were a 200 and a hub authorizing nothing.
//
// The second case is the one that pins which net the rows are judged against. This
// request proposes a different device network, so its rows have to be checked
// against the network they would live on: the addresses are sound where the hub is
// today and unusable where it is being moved, and a save that answers 200 has just
// made a hub no spoke can reach.
func TestUpdateTunnelValidatesTheAssignmentItCarries(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key := strings.Repeat("C", 43)
	id := startTunHub(t, srv, "10.50.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save one spoke = %d: %v", resp.StatusCode, saved)
	}
	hub := tunnel.Get(id)

	for _, tc := range []struct {
		name string
		body map[string]any
		want string
	}{
		{
			name: "an address off the hub's subnet",
			body: map[string]any{
				"name": "hub", "type": "tun", "net": "10.50.0.1/24",
				"peers": []map[string]any{{"key": key, "ip": "192.168.9.9"}},
			},
			want: "192.168.9.9",
		},
		{
			name: "an address off the subnet the request is moving the hub to",
			body: map[string]any{
				"name": "hub", "type": "tun", "net": "10.60.0.1/24",
				"peers": []map[string]any{{"key": key, "ip": "10.50.0.2"}},
			},
			want: "10.50.0.2",
		},
		{
			name: "a prefix where an address belongs",
			body: map[string]any{
				"name": "hub", "type": "tun", "net": "10.50.0.1/24",
				"peers": []map[string]any{{"key": key, "ip": "10.50.0.2/24"}},
			},
			want: "not a comma-separated list",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := putJSON(t, srv.URL+"/api/tunnels/"+id, tc.body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("PUT %s = %d: %v, want 400", tc.name, resp.StatusCode, body)
			}
			msg, _ := body["error"].(string)
			if !strings.Contains(msg, tc.want) {
				t.Errorf("the refusal %q does not name %q", msg, tc.want)
			}
			// The refusal is the whole answer: the hub that was running is still
			// running, still holds the assignment, and the config still has it.
			if got := tunnel.Get(id); got != hub {
				t.Fatalf("a refused PUT rebuilt the hub: %v", got)
			}
			if got := hub.Options().PeerIPs[key]; got != "10.50.0.2" {
				t.Errorf("the assignment after a refused PUT = %q, want 10.50.0.2 untouched", got)
			}
			if tunnel.IsServiceFailed(hub) {
				t.Error("a refused PUT stopped the hub it was not about")
			}
			if got := config.Get().Tunnels[0].PeerIPs[key]; got != "10.50.0.2" {
				t.Errorf("the persisted assignment = %q, want 10.50.0.2: a refused save must not persist a loss", got)
			}
		})
	}
}

// TestCreateTunTunnelAllocatesItsSpokes: a create is the third door onto the same
// field, so it gets the same policy — a hub created with spokes that name no
// address is given one each, rather than coming up authorizing nothing.
func TestCreateTunTunnelAllocatesItsSpokes(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()
	defaultLogger(t)

	key1, key2 := strings.Repeat("C", 43), strings.Repeat("D", 43)
	resp, created := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"type": "tun", "name": "hub", "net": "10.70.0.1/24",
		"peers": []map[string]any{{"key": key1}, {"key": key2}},
	})
	if resp.StatusCode == http.StatusInternalServerError {
		t.Skipf("no CAP_NET_ADMIN here: the hub's device could not be created (%v)", created["error"])
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create a hub with two spokes = %d: %v, want 201", resp.StatusCode, created)
	}
	id, _ := created["id"].(string)
	t.Cleanup(func() { tunnel.Delete(id) })

	if got := tunnel.Get(id).Options().PeerIPs; got[key1] != "10.70.0.2" || got[key2] != "10.70.0.3" {
		t.Errorf("the created hub's assignment = %v, want the two spokes allocated", got)
	}
	rows := peerRows(t, created)
	if len(rows) != 2 || rowIP(rows[0]) != "10.70.0.2" || rowIP(rows[1]) != "10.70.0.3" {
		t.Errorf("the created hub's rows = %v, want each spoke holding its address", rows)
	}

	// And the same refusal as the two saves: a row the hub could not honour is
	// refused before the device is built, not dropped afterwards by the new hub.
	resp, refused := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"type": "tun", "name": "hub", "net": "10.80.0.1/24",
		"peers": []map[string]any{{"key": key1, "ip": "192.168.9.9"}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("create a hub with an unusable address = %d: %v, want 400", resp.StatusCode, refused)
	}
	if msg, _ := refused["error"].(string); !strings.Contains(msg, "192.168.9.9") {
		t.Errorf("the refusal %q does not name the address", msg)
	}
}

// TestUpdateTunnelPeersKeepsUnmentionedAddresses: the ruling at the peers door, and
// the case a reviewer demonstrated: deleting one spoke moved another from .4 to .3.
// A spoke's address belongs to that spoke, so a save that does not mention it
// leaves it alone — including when the save is a deletion elsewhere in the list.
func TestUpdateTunnelPeersKeepsUnmentionedAddresses(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key1, key2, key3 := strings.Repeat("C", 43), strings.Repeat("D", 43), strings.Repeat("E", 43)
	id := startTunHub(t, srv, "10.90.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1}, {"key": key2}, {"key": key3}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save three spokes = %d: %v", resp.StatusCode, saved)
	}
	want := map[string]string{key1: "10.90.0.2", key2: "10.90.0.3", key3: "10.90.0.4"}
	if got := tunnel.Get(id).Options().PeerIPs; !sameAssignment(got, want) {
		t.Fatalf("the assignment after the first save = %v, want %v", got, want)
	}

	// A save that mentions no address at all, which is what a client that never
	// learned the field sends. Everything stays where it is.
	resp, none := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1}, {"key": key2}, {"key": key3}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save three spokes without addresses = %d: %v", resp.StatusCode, none)
	}
	if got := tunnel.Get(id).Options().PeerIPs; !sameAssignment(got, want) {
		t.Errorf("a save that named no address moved the assignment: %v, want %v", got, want)
	}

	// The demonstrated one: dropping a spoke from the list. The other two keep
	// theirs, and the address the deleted one freed is not handed to a neighbour.
	resp, deleted := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1}, {"key": key3}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete the middle spoke = %d: %v", resp.StatusCode, deleted)
	}
	if got := tunnel.Get(id).Options().PeerIPs; len(got) != 2 || got[key1] != "10.90.0.2" || got[key3] != "10.90.0.4" {
		t.Errorf("the assignment after deleting a spoke = %v, want the other two where they were", got)
	}

	// Clearing an address on purpose is the one request that does move a spoke, and
	// it is explicit: "ip": "" means the operator cleared it.
	resp, cleared := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1, "ip": ""}, {"key": key3}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear one spoke's address = %d: %v", resp.StatusCode, cleared)
	}
	// .2 is the first free address of the subnet, which is the one just freed.
	if got := tunnel.Get(id).Options().PeerIPs; got[key1] != "10.90.0.2" || got[key3] != "10.90.0.4" {
		t.Errorf("the assignment after an explicit clear = %v, want key1 back on 10.90.0.2", got)
	}

	// A spoke added to a list the client was shown keeps the neighbours it showed
	// and is given an address of its own.
	resp, added := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key1}, {"key": key2}, {"key": key3}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("add a spoke back = %d: %v", resp.StatusCode, added)
	}
	if got := tunnel.Get(id).Options().PeerIPs; got[key1] != "10.90.0.2" || got[key2] != "10.90.0.3" || got[key3] != "10.90.0.4" {
		t.Errorf("the assignment after adding a spoke back = %v, want the three as they were", got)
	}
}

// sameAssignment reports whether two assignments hold the same rows and the same
// addresses, so a failure prints the two rather than an index.
func sameAssignment(got, want map[string]string) bool {
	if len(got) != len(want) {
		return false
	}
	for peer, ips := range want {
		if got[peer] != ips {
			return false
		}
	}
	return true
}

// TestUpdateTunnelPreservesPeerIPs: the full-tunnel PUT rebuilds the hub from the
// request, so the assignment has to travel with it. While toOptions did not carry
// it, an unrelated edit — a rename on the detail page — closed the hub, restarted
// it with no assignment at all, and had SaveConfig write peer_ips back as null:
// every spoke refused, silently, and the addresses gone from the config too. The
// body below is the one the detail page sends: the object it was shown, peers and
// all.
func TestUpdateTunnelPreservesPeerIPs(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key := strings.Repeat("C", 43)
	id := startTunHub(t, srv, "10.30.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key, "alias": "laptop"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save one spoke = %d: %v", resp.StatusCode, saved)
	}
	if got := tunnel.Get(id).Options().PeerIPs[key]; got != "10.30.0.2" {
		t.Fatalf("the assignment after the peers save = %q, want 10.30.0.2", got)
	}

	_, shown := getJSON(t, srv.URL+"/api/tunnels/"+id)
	options, _ := shown["options"].(map[string]any)
	if rows := peerRows(t, shown); len(rows) != 1 || rowIP(rows[0]) != "10.30.0.2" {
		t.Fatalf("the allowlist as shown = %v, want the spoke holding 10.30.0.2", rows)
	}

	resp, updated := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "hub", "type": "tun", "net": "10.30.0.1/24",
		"peers": options["peers"],
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update the whole hub = %d: %v", resp.StatusCode, updated)
	}

	// In force on the rebuilt hub, which is the whole of it: a hub restarted with no
	// assignment refuses every spoke, and answers 200 while doing it.
	hub := tunnel.Get(id)
	if hub == nil {
		t.Fatal("the hub is gone after the update")
	}
	if got := hub.Options().PeerIPs[key]; got != "10.30.0.2" {
		t.Errorf("the assignment after the update = %q, want 10.30.0.2", got)
	}
	if tunnel.IsServiceFailed(hub) {
		t.Error("the rebuilt hub is a failed service, so it is routing nothing")
	}
	if rows := peerRows(t, updated); len(rows) != 1 || rowIP(rows[0]) != "10.30.0.2" {
		t.Errorf("the allowlist on the update's reply = %v, want the address in force", rows)
	}
	// And in the config, which is where it has to survive a restart of the process
	// as well: a save that dropped it would lose it again silently.
	saved2 := config.Get().Tunnels
	if len(saved2) != 1 || saved2[0].PeerIPs[key] != "10.30.0.2" {
		t.Errorf("the persisted assignment = %v, want peer_ips to carry 10.30.0.2", saved2)
	}
}

// TestUpdateP2PTunnelPeersIgnoresAddresses: a p2p tunnel has no device network to
// allocate from, so a row's ip is a field nothing there reads. It is ignored rather
// than refused — the same body may be sent to either type, and a client that has
// just been talking to a hub should not be told no — and above all not stored,
// because a saved assignment on a tunnel with no authorizer would come back in the
// options looking like a hub's. The address here is not even an address, which is
// what shows nothing parsed it.
func TestUpdateP2PTunnelPeersIgnoresAddresses(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key := strings.Repeat("C", 43)
	resp, created := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"name": "Private", "type": "p2p", "endpoint": "127.0.0.1:9",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create p2p tunnel = %d: %v", resp.StatusCode, created)
	}
	id, _ := created["id"].(string)
	t.Cleanup(func() { tunnel.Delete(id) })

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key, "ip": "not-an-address"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("saving an address on a p2p tunnel = %d: %v, want it ignored", resp.StatusCode, saved)
	}
	rows := peerRows(t, saved)
	if len(rows) != 1 || rows[0]["key"] != key {
		t.Fatalf("the saved allowlist = %v, want the one peer", rows)
	}
	if got := rowIP(rows[0]); got != "" {
		t.Errorf("the p2p row carries %q, want no address at all", got)
	}
	if got := tunnel.Get(id).Options().PeerIPs; got != nil {
		t.Errorf("a p2p tunnel stored the assignment %v, want none", got)
	}
	if ips, ok := saved["options"].(map[string]any)["peer_ips"]; ok {
		t.Errorf("options.peer_ips = %v on a p2p tunnel, want the field absent", ips)
	}
}
