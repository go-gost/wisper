package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
	xconfig "github.com/go-gost/x/config"
	"github.com/go-gost/x/registry"
)

type requestListEntryPoint struct {
	entrypoint.EntryPoint
	requests []entrypoint.Request
}

func (e *requestListEntryPoint) Requests(limit int) []entrypoint.Request {
	if limit <= 0 || limit > len(e.requests) {
		limit = len(e.requests)
	}
	return slices.Clone(e.requests[:limit])
}

func requestsBody(t *testing.T, resp *http.Response) []entrypoint.Request {
	t.Helper()
	defer resp.Body.Close()
	var body struct {
		Requests []entrypoint.Request `json:"requests"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode requests: %v", err)
	}
	return body.Requests
}

func TestEntrypointRequestsList(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	plain := preRegisterEntrypoint(t, entrypoint.TCPEntryPoint, "plain", "127.0.0.1:0")

	resp, err := http.Get(srv.URL + "/api/entrypoints/plain-id/requests")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown entrypoint requests = %d, want 404", resp.StatusCode)
	}

	resp, err = http.Get(srv.URL + "/api/entrypoints/" + plain.ID() + "/requests")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("requests of an entrypoint without a ring = %d, want 200", resp.StatusCode)
	}
	if got := requestsBody(t, resp); len(got) != 0 {
		t.Fatalf("requests of an entrypoint without a ring = %+v, want none", got)
	}
}

func TestEntrypointRequestsListLimit(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	base := entrypoint.NewByType(entrypoint.TCPEntryPoint,
		tunnel.NameOption("requests"),
		tunnel.EndpointOption("127.0.0.1:0"),
		tunnel.CreatedAtOption(time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)),
	)
	if base == nil {
		t.Fatal("unknown entrypoint type")
	}
	base.Close()

	const total = 501
	fake := &requestListEntryPoint{EntryPoint: base}
	for i := total - 1; i >= 0; i-- {
		fake.requests = append(fake.requests, entrypoint.Request{
			Time: time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC).Add(time.Duration(i) * time.Second),
			Host: fmt.Sprintf("request-%03d", i),
		})
	}
	entrypoint.Add(fake)
	t.Cleanup(func() { entrypoint.Delete(base.ID()) })

	get := func(query string) []entrypoint.Request {
		t.Helper()
		resp, err := http.Get(srv.URL + "/api/entrypoints/" + base.ID() + "/requests" + query)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			t.Fatalf("GET requests%s = %d, want 200", query, resp.StatusCode)
		}
		return requestsBody(t, resp)
	}

	all := get("")
	if len(all) != 50 || all[0].Host != "request-500" {
		t.Fatalf("default request list = %d rows starting %q, want 50 newest rows", len(all), all[0].Host)
	}
	capped := get("?limit=501")
	if len(capped) != 500 || capped[0].Host != "request-500" || capped[499].Host != "request-001" {
		t.Fatalf("capped request list = %d rows %q .. %q, want 500 rows request-500 .. request-001",
			len(capped), capped[0].Host, capped[len(capped)-1].Host)
	}
	limited := get("?limit=2")
	if len(limited) != 2 || limited[0].Host != "request-500" || limited[1].Host != "request-499" {
		t.Fatalf("limited request list = %+v, want the two newest rows", limited)
	}
}

func TestEntrypointRulesEndpointAppliesInPlace(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	const id = "ep-tungo-rules-endpoint"
	const peer = "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"
	const rulesName = "tungo-rules-" + id

	ep := entrypoint.NewTungoEntryPoint(
		tunnel.IDOption(id),
		tunnel.NameOption("phone"),
		tunnel.NetOption("10.20.0.250/32"),
		tunnel.PeerOption(peer),
		tunnel.RulesOption("example.com", "192.168.100.0/24"),
		tunnel.RoutesOption("0.0.0.0/0, ::/0"),
		tunnel.DNSOption("192.168.100.100"),
	)
	if _, err := ep.(interface {
		ChainConfig() (*xconfig.ChainConfig, error)
	}).ChainConfig(); err != nil {
		t.Fatalf("assemble the split chain: %v", err)
	}
	entrypoint.Add(ep)
	t.Cleanup(func() { entrypoint.Delete(id) })

	if owner, ok := tunnel.ClaimTunDevice(id, "phone"); !ok {
		t.Fatalf("claim tun device: held by %q", owner)
	}
	t.Cleanup(func() { tunnel.ReleaseTunDevice(id) })
	beforeID, beforeName := tunnel.TunDeviceOwner()

	resp, body := putJSON(t, srv.URL+"/api/entrypoints/"+id+"/rules", map[string]any{
		"rules": []string{"example.org"},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT rules = %d: %v, want 200", resp.StatusCode, body)
	}
	if got := entrypoint.Get(id); got != ep {
		t.Fatal("the rules endpoint replaced the entrypoint: a rebuilt run takes the VPN device down with it")
	}
	if got := entrypointRules(t, body); !slices.Equal(got, []string{"example.org"}) {
		t.Errorf("response rules = %v, want the edited list", got)
	}
	if got := ep.Options().Rules; !slices.Equal(got, []string{"example.org"}) {
		t.Errorf("stored rules = %v, want the edited list", got)
	}
	afterID, afterName := tunnel.TunDeviceOwner()
	if afterID != beforeID || afterName != beforeName {
		t.Errorf("tun device owner after rules edit = (%q, %q), want unchanged (%q, %q)",
			afterID, afterName, beforeID, beforeName)
	}

	ctx := context.Background()
	bp := registry.BypassRegistry().GetAll()[rulesName]
	if bp == nil {
		t.Fatalf("%s is not registered: the edit has nowhere to land", rulesName)
	}
	if bp.Contains(ctx, "tcp", "example.org:443") {
		t.Error("the edited list still does not tunnel the new rule")
	}
	if !bp.Contains(ctx, "tcp", "example.com:443") {
		t.Error("the old rule still claims the tunnel")
	}

	resp, body = putJSON(t, srv.URL+"/api/entrypoints/"+id+"/rules", map[string]any{
		"rules": []string{},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear rules = %d: %v, want 200", resp.StatusCode, body)
	}
	if got := entrypointRules(t, body); len(got) != 0 {
		t.Errorf("rules after clearing = %v, want none", got)
	}
}

func TestEntrypointRulesEndpointRejectsWrongType(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	plain := preRegisterEntrypoint(t, entrypoint.TCPEntryPoint, "plain", "127.0.0.1:0")

	resp, body := putJSON(t, srv.URL+"/api/entrypoints/"+plain.ID()+"/rules", map[string]any{
		"rules": []string{"example.com"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("PUT rules on a tcp entrypoint = %d: %v, want 400", resp.StatusCode, body)
	}

	resp, _ = putJSON(t, srv.URL+"/api/entrypoints/missing/rules", map[string]any{
		"rules": []string{"example.com"},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("PUT rules on an unknown entrypoint = %d, want 404", resp.StatusCode)
	}
}

// TestEntrypointRulesRequestNeedsRules keeps the two meanings apart: a body
// without a rules field says nothing, while an explicit [] clears the split.
func TestEntrypointRulesRequestNeedsRules(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	const id = "ep-tungo-rules-missing"
	ep := entrypoint.NewTungoEntryPoint(
		tunnel.IDOption(id),
		tunnel.NameOption("phone"),
		tunnel.NetOption("10.20.0.250/32"),
		tunnel.PeerOption("dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"),
		tunnel.RulesOption("example.com"),
	)
	if _, err := ep.(interface {
		ChainConfig() (*xconfig.ChainConfig, error)
	}).ChainConfig(); err != nil {
		t.Fatalf("assemble the split chain: %v", err)
	}
	entrypoint.Add(ep)
	t.Cleanup(func() { entrypoint.Delete(id) })

	resp, body := putJSON(t, srv.URL+"/api/entrypoints/"+id+"/rules", map[string]any{})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("PUT rules without the field = %d: %v, want 400", resp.StatusCode, body)
	}
	if got := ep.Options().Rules; !slices.Equal(got, []string{"example.com"}) {
		t.Errorf("rules after a body without the field = %v, want the saved list", got)
	}
}
