package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-gost/wisper/tunnel"
)

// The ruling this pins down is the field's: a hub that refused a spoke's LAN
// claim with "no-allow-row" has to be told it may claim it without losing the
// network. The detail page would need a full PUT — which rebuilds the hub and
// closes its live streams — so the peers door, which touches everything else
// about a spoke's row, is where it goes.
func TestUpdateTunnelPeersSetsLanAllow(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key := strings.Repeat("C", 43)
	id := startTunHub(t, srv, "10.30.0.1/24")

	// The hub has no row, so a claim from this spoke would be refused.
	if got := tunnel.Get(id).Options().LanAllow; got != "" {
		t.Fatalf("a fresh hub carries rows %q, want none", got)
	}

	// One row for one spoke, in the form the form holds it: the spoke, and the
	// LAN it is allowed to claim.
	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key}},
		"lan_allow": map[string][]string{
			key: {"192.168.1.0/24"},
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save the allow rows = %d: %v", resp.StatusCode, saved)
	}
	if got := tunnel.Get(id).Options().LanAllow; got != key+"=192.168.1.0/24" {
		t.Fatalf("the rows the save wrote = %q, want %q", got, key+"=192.168.1.0/24")
	}

	// The save is round-tripped in the reply, so the form that sent it does not
	// have to know what it did not type.
	if got, _ := saved["options"].(map[string]any)["lan_allow"].(string); got != key+"=192.168.1.0/24" {
		t.Errorf("the reply echoes lan_allow = %q, want %q", got, key+"=192.168.1.0/24")
	}

	// The same again for a second spoke: the second save replaces the whole
	// policy rather than appending to it, which is what makes an edit of one row
	// not drop the other.
	resp, saved = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key}, {"key": strings.Repeat("D", 43)}},
		"lan_allow": map[string][]string{
			key:                     {"192.168.1.0/24"},
			strings.Repeat("D", 43): {"10.5.0.0/16"},
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save both rows = %d: %v", resp.StatusCode, saved)
	}
	if got := tunnel.Get(id).Options().LanAllow; !strings.Contains(got, key+"=192.168.1.0/24") || !strings.Contains(got, "D=10.5.0.0/16") {
		t.Errorf("the rows after the second save = %q, want both rows", got)
	}

	// A save that mentions no rows at all leaves them: the p2p case, and a hub
	// saving its allowlist from a form that never heard of the field.
	resp, saved = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save without rows = %d: %v", resp.StatusCode, saved)
	}
	if got := tunnel.Get(id).Options().LanAllow; !strings.Contains(got, key+"=192.168.1.0/24") {
		t.Errorf("a save that did not mention the rows cleared them: %q", got)
	}
}

// The ruling the shape needed, found in production: a save that carries only
// the policy — which is the shape every script, every curl and every future
// client that does not restate the allowlist has — must not be read as an empty
// allowlist. The field is required, so an absent array is a field not mentioned
// and the list stands; the one request that empties it is an explicit [].
//
// This is what the earlier shape got wrong on the live hub: the policy save
// reconciled every spoke's route away, the streams went to an unregistered peer
// and the network went dark for a spoke whose row had just been allowed.
func TestUpdateTunnelPeersLanAllowOnlyKeepsTheAllowlist(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key := strings.Repeat("E", 43)
	id := startTunHub(t, srv, "10.60.0.1/24")

	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{{"key": key, "alias": "phone"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("put the allowlist in place = %d: %v", resp.StatusCode, saved)
	}
	if peers := tunnel.Get(id).Options().Peers; len(peers) != 1 {
		t.Fatalf("the setup is wrong: the hub's allowlist is %v, want one spoke", peers)
	}

	// The save the ruling is about: nothing but the rows.
	resp, saved = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"lan_allow": map[string][]string{key: {"192.168.1.0/24"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save only the rows = %d: %v", resp.StatusCode, saved)
	}
	if got := tunnel.Get(id).Options().LanAllow; got != key+"=192.168.1.0/24" {
		t.Errorf("the rows after the save = %q, want %q", got, key+"=192.168.1.0/24")
	}
	if peers := tunnel.Get(id).Options().Peers; len(peers) != 1 {
		t.Errorf("a rows-only save left the allowlist as %v, want the spoke it had", peers)
	}

	// An empty array still means what it says: every spoke is gone.
	resp, saved = putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers": []map[string]any{},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("empty the allowlist = %d: %v", resp.StatusCode, saved)
	}
	if peers := tunnel.Get(id).Options().Peers; len(peers) != 0 {
		t.Errorf("an explicit empty allowlist = %v, want none", peers)
	}
}

// The other half of the ruling: a hub saved from the detail page, whose form
// knows nothing about the policy, must not empty it. This is the shape that used
// to lock a whole network out, and it is still the shape the UI is in.
func TestUpdateTunnelKeepsUnmentionedLanAllow(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	key := strings.Repeat("C", 43)
	id := startTunHub(t, srv, "10.50.0.1/24")
	rows := key + "=192.168.1.0/24"

	// The rows in place, spoken for by the tunnel itself rather than by a save
	// through the peers door.
	resp, saved := putJSON(t, srv.URL+"/api/tunnels/"+id+"/peers", map[string]any{
		"peers":     []map[string]any{{"key": key}},
		"lan_allow": map[string][]string{key: {"192.168.1.0/24"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("put the rows in place = %d: %v", resp.StatusCode, saved)
	}
	if got := tunnel.Get(id).Options().LanAllow; got != rows {
		t.Fatalf("the setup is wrong: the hub carries %q, want %q", got, rows)
	}

	// The detail page's save: name, net, device, and the allowlist it carries.
	// No lan_allow, because the page has no field for it.
	resp, kept := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "hub", "type": "tun", "net": "10.50.0.1/24",
		"peers": []map[string]any{{"key": key, "alias": "laptop"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update the whole hub = %d: %v", resp.StatusCode, kept)
	}
	if got := tunnel.Get(id).Options().LanAllow; got != rows {
		t.Errorf("a PUT that did not mention the rows emptied them: %q, want %q", got, rows)
	}

	// Saying so is the one request that clears them.
	resp, cleared := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "hub", "type": "tun", "net": "10.50.0.1/24", "lan_allow": "",
		"peers": []map[string]any{{"key": key, "alias": "laptop"}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear the rows = %d: %v", resp.StatusCode, cleared)
	}
	if got := tunnel.Get(id).Options().LanAllow; got != "" {
		t.Errorf("an explicit empty lan_allow = %q, want it cleared", got)
	}
}
