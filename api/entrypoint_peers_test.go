package api

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// fakePeerEntryPoint stands in for a running tun spoke for the API shapes.
// The real PeerList is driven by the netview router (not reachable from this
// package without a control channel); the API only calls the interface.
type fakePeerEntryPoint struct {
	entrypoint.EntryPoint
	peers    []tunnel.EntryPeer
	setCalls int
}

func (f *fakePeerEntryPoint) PeerList() []tunnel.EntryPeer { return f.peers }

func (f *fakePeerEntryPoint) SetBlockedPeers(_ context.Context, keys []string) error {
	f.setCalls++
	for i := range f.peers {
		f.peers[i].Blocked = slices.Contains(keys, f.peers[i].Key)
		if f.peers[i].Blocked {
			f.peers[i].State = "blocked"
		}
	}
	return nil
}

func newFakePeerEntryPoint(t *testing.T, id, hub string, peers []tunnel.EntryPeer) *fakePeerEntryPoint {
	t.Helper()
	base := entrypoint.NewTunEntryPoint(
		tunnel.IDOption(id),
		tunnel.PeerOption(hub),
		tunnel.NetOption("10.10.0.2/24"),
	)
	base.Close()
	f := &fakePeerEntryPoint{EntryPoint: base, peers: peers}
	entrypoint.Add(f)
	t.Cleanup(func() { entrypoint.Delete(id) })
	return f
}

func TestEntrypointPeersGET(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	const hub = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	fake := newFakePeerEntryPoint(t, "ep-peers-get", hub, []tunnel.EntryPeer{
		{Key: hub, Name: "Hub", State: "hub", RTTMs: 21},
		{Key: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", Name: "laptop", State: "direct-off", Direct: true, RTTMs: 43},
	})

	resp, body := getJSON(t, srv.URL+"/api/entrypoints/"+fake.ID()+"/peers")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET peers = %d: %v", resp.StatusCode, body)
	}
	peers, ok := body["peers"].([]any)
	if !ok || len(peers) != 2 {
		t.Fatalf("peers = %v, want two rows", body["peers"])
	}
	first, _ := peers[0].(map[string]any)
	if first["key"] != hub || first["state"] != "hub" {
		t.Fatalf("first row = %v, want the hub", first)
	}
	if first["rtt_ms"] != float64(21) {
		t.Fatalf("hub rtt_ms = %v, want 21", first["rtt_ms"])
	}
	second, _ := peers[1].(map[string]any)
	if second["state"] != "direct-off" || second["direct"] != true {
		t.Fatalf("second row = %v, want direct-off", second)
	}
	if second["rtt_ms"] != float64(43) {
		t.Fatalf("direct row rtt_ms = %v, want 43", second["rtt_ms"])
	}

	// A non-tun entrypoint has no local device network.
	tcp := preRegisterEntrypoint(t, entrypoint.TCPEntryPoint, "tcp", "127.0.0.1:0")
	resp, body = getJSON(t, srv.URL+"/api/entrypoints/"+tcp.ID()+"/peers")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("GET peers on tcp = %d: %v, want 400", resp.StatusCode, body)
	}
}

func TestEntrypointPeersPUT(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	const hub = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	const peerB = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
	fake := newFakePeerEntryPoint(t, "ep-peers-put", hub, []tunnel.EntryPeer{
		{Key: hub, Name: "Hub", State: "hub"},
		{Key: peerB, Name: "laptop", State: "hub"},
	})

	resp, body := putJSON(t, srv.URL+"/api/entrypoints/"+fake.ID()+"/peers", map[string]any{
		"blocked": []string{peerB},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT peers = %d: %v", resp.StatusCode, body)
	}
	if fake.setCalls != 1 {
		t.Fatalf("SetBlockedPeers calls = %d, want 1", fake.setCalls)
	}
	peers := body["peers"].([]any)
	row := peers[1].(map[string]any)
	if row["blocked"] != true || row["state"] != "blocked" {
		t.Fatalf("blocked row = %v, want blocked", row)
	}

	// Clearing is explicit and does not require a restart.
	resp, body = putJSON(t, srv.URL+"/api/entrypoints/"+fake.ID()+"/peers", map[string]any{
		"blocked": []string{},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear peers = %d: %v", resp.StatusCode, body)
	}
	if fake.setCalls != 2 {
		t.Fatalf("SetBlockedPeers calls = %d, want 2", fake.setCalls)
	}
	if got := body["peers"].([]any)[1].(map[string]any)["blocked"]; got != nil {
		t.Fatalf("cleared row blocked = %v, want absent/false", got)
	}
}

func TestEntrypointPeersInvalidAndDuplicate(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	const hub = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	fake := newFakePeerEntryPoint(t, "ep-peers-bad", hub, nil)

	for name, blocked := range map[string][]string{
		"invalid":   {"not-a-key"},
		"duplicate": {hub, hub},
	} {
		t.Run(name, func(t *testing.T) {
			resp, body := putJSON(t, srv.URL+"/api/entrypoints/"+fake.ID()+"/peers", map[string]any{
				"blocked": blocked,
			})
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("PUT peers %s = %d: %v, want 400", name, resp.StatusCode, body)
			}
			if fake.setCalls != 0 {
				t.Fatalf("SetBlockedPeers ran for a rejected request: %d", fake.setCalls)
			}
		})
	}
}

func TestEntrypointFullPutPreservesBlockedPeers(t *testing.T) {
	const key = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
	for _, tc := range []struct {
		name    string
		body    map[string]any
		want    []string
		wantNil bool
	}{
		{
			name: "omitted preserves",
			body: map[string]any{"type": "tcp", "name": "updated", "endpoint": "127.0.0.1:0"},
			want: []string{key},
		},
		{
			name: "explicit empty clears",
			body: map[string]any{"type": "tcp", "name": "updated", "endpoint": "127.0.0.1:0", "blocked_peers": []string{}},
			want: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := setupTestServer(t)
			defer srv.Close()

			const id = "ep-full-put"
			old := entrypoint.NewTCPEntryPoint(
				tunnel.IDOption(id),
				tunnel.NameOption("old"),
				tunnel.EndpointOption("127.0.0.1:0"),
				tunnel.BlockedPeersOption(key),
			)
			entrypoint.Add(old)
			t.Cleanup(func() { entrypoint.Delete(id) })

			resp, body := putJSON(t, srv.URL+"/api/entrypoints/"+id, tc.body)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("PUT = %d: %v", resp.StatusCode, body)
			}
			opts, _ := body["options"].(map[string]any)
			got, _ := opts["blocked_peers"].([]any)
			var gotKeys []string
			for _, v := range got {
				gotKeys = append(gotKeys, v.(string))
			}
			if tc.wantNil {
				if len(gotKeys) != 0 {
					t.Fatalf("blocked_peers = %v, want cleared", gotKeys)
				}
			} else if !slices.Equal(gotKeys, tc.want) {
				t.Fatalf("blocked_peers = %v, want %v", gotKeys, tc.want)
			}
		})
	}
}

func TestEntrypointPeersEndpointIsOnlyTun(t *testing.T) {
	// The route exists for every entrypoint id; the type gate is what keeps a
	// p2p/tcp entrypoint from claiming a peer list it does not have.
	srv := setupTestServer(t)
	defer srv.Close()
	ep := preRegisterEntrypoint(t, entrypoint.P2PEntryPoint, "p2p", "127.0.0.1:0")
	resp, body := getJSON(t, srv.URL+"/api/entrypoints/"+ep.ID()+"/peers")
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(body["error"].(string), "tun") {
		t.Fatalf("p2p peers = %d: %v", resp.StatusCode, body)
	}
}

func TestEntrypointFullPutPreservesDirect(t *testing.T) {
	for _, tc := range []struct {
		name string
		body map[string]any
		want bool
	}{
		{
			name: "omitted preserves",
			body: map[string]any{"type": "tcp", "name": "updated", "endpoint": "127.0.0.1:0"},
			want: true,
		},
		{
			name: "explicit false clears",
			body: map[string]any{"type": "tcp", "name": "updated", "endpoint": "127.0.0.1:0", "direct": false},
			want: false,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := setupTestServer(t)
			defer srv.Close()

			const id = "ep-direct-put"
			old := entrypoint.NewTCPEntryPoint(
				tunnel.IDOption(id),
				tunnel.NameOption("old"),
				tunnel.EndpointOption("127.0.0.1:0"),
				tunnel.DirectOption(true),
			)
			entrypoint.Add(old)
			t.Cleanup(func() { entrypoint.Delete(id) })

			resp, body := putJSON(t, srv.URL+"/api/entrypoints/"+id, tc.body)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("PUT = %d: %v", resp.StatusCode, body)
			}
			opts, _ := body["options"].(map[string]any)
			if got := opts["direct"] == true; got != tc.want {
				t.Fatalf("direct = %v, want %v", opts["direct"], tc.want)
			}
		})
	}
}
