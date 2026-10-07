package api

import (
	"net/http"
	"os/exec"
	"strings"
	"testing"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
)

// A malformed share_lan is refused at the door (400), not stored and failed
// at Run: the create would otherwise answer 201 and leave a hub that never
// runs. No device is needed for this — validation runs before one is built.
func TestCreateTunHubRefusesBadShareLAN(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()

	resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"type": "tun", "name": "hub", "net": "10.10.0.1/24",
		"share_lan": "not-a-cidr",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("create hub with bad share_lan = %d: %v, want 400", resp.StatusCode, body)
	}
}

// The share fields round trip like every other option: the create carries
// them, the response shows them, and the persisted config keeps them —
// otherwise an unrelated edit would silently unshare the LAN (the same loss
// TestUpdateTunnelPreservesPeerIPs pins for the address assignment).
func TestTunHubShareFieldsRoundTrip(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()
	defaultLogger(t)

	resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"type": "tun", "name": "hub", "net": "10.60.0.1/24",
		"share_lan": "192.168.1.0/24", "share_mode": "userspace",
	})
	if resp.StatusCode == http.StatusInternalServerError {
		t.Skipf("no CAP_NET_ADMIN here: the hub's device could not be created (%v)", body["error"])
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create hub with share_lan = %d: %v", resp.StatusCode, body)
	}
	id, _ := body["id"].(string)
	t.Cleanup(func() { tunnel.Delete(id) })

	opts, _ := body["options"].(map[string]any)
	if opts["share_lan"] != "192.168.1.0/24" {
		t.Errorf("options.share_lan = %v, want 192.168.1.0/24", opts["share_lan"])
	}
	if opts["share_mode"] != "userspace" {
		t.Errorf("options.share_mode = %v, want userspace", opts["share_mode"])
	}
	// Pinned userspace is not a downgrade — the badge must not cry wolf.
	if eff, _ := body["share_effective"].(string); eff != "userspace" {
		t.Errorf("share_effective = %q, want userspace", eff)
	}
	if down, _ := body["share_downgraded"].(bool); down {
		t.Error("share_downgraded = true for a pinned mode, want false")
	}

	// And in force on the hub plus in the config, where a restart reads it.
	if got := tunnel.Get(id).Options().ShareLAN; got != "192.168.1.0/24" {
		t.Errorf("hub ShareLAN = %q, want 192.168.1.0/24", got)
	}
	saved := config.Get().Tunnels
	if len(saved) != 1 || saved[0].ShareLAN != "192.168.1.0/24" || saved[0].ShareMode != "userspace" {
		t.Errorf("persisted share = %+v, want 192.168.1.0/24/userspace", saved)
	}

	// A full-tunnel PUT that says nothing about sharing keeps it: the detail
	// page sends back the object it was shown, share fields included.
	_, shown := getJSON(t, srv.URL+"/api/tunnels/"+id)
	shownOpts, _ := shown["options"].(map[string]any)
	resp, updated := putJSON(t, srv.URL+"/api/tunnels/"+id, map[string]any{
		"name": "hub", "type": "tun", "net": "10.60.0.1/24",
		"peers":      shownOpts["peers"],
		"share_lan":  shownOpts["share_lan"],
		"share_mode": shownOpts["share_mode"],
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update the whole hub = %d: %v", resp.StatusCode, updated)
	}
	if got := tunnel.Get(id).Options().ShareLAN; got != "192.168.1.0/24" {
		t.Errorf("ShareLAN after the update = %q, want it kept", got)
	}
}

// TestTunHubShareKernelLive starts a hub pinned to the kernel backend and
// checks the host itself: the MASQUERADE rule is present while the hub runs
// and gone after it is deleted. It needs privilege (device + iptables) and
// skips without it — the fake-runner unit tests pin the rule rendering, this
// pins that running the hub installs and removes exactly those rules.
func TestTunHubShareKernelLive(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	srv := setupTestServer(t)
	defer srv.Close()
	offlineP2P()
	defaultLogger(t)

	if out, err := exec.Command("iptables", "-t", "nat", "-S").CombinedOutput(); err != nil {
		t.Skipf("no iptables here: %v (%s)", err, out)
	}

	resp, body := postJSON(t, srv.URL+"/api/tunnels", map[string]any{
		"type": "tun", "name": "hub", "net": "10.61.0.1/24",
		"share_lan": "192.168.1.0/24", "share_mode": "kernel",
	})
	if resp.StatusCode == http.StatusInternalServerError {
		t.Skipf("no CAP_NET_ADMIN here: the hub's device could not be created (%v)", body["error"])
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create hub with kernel sharing = %d: %v", resp.StatusCode, body)
	}
	id, _ := body["id"].(string)
	// Deletes the hub, which is also what removes the rules: every assertion
	// below runs while the hub is up, and the post-delete check runs after.
	t.Cleanup(func() { tunnel.Delete(id) })

	if eff, _ := body["share_effective"].(string); eff != "kernel" {
		t.Fatalf("share_effective = %q, want kernel", eff)
	}

	natRules := iptablesRules(t, "nat")
	want := "POSTROUTING -s 10.61.0.0/24 -d 192.168.1.0/24 -j MASQUERADE"
	if !strings.Contains(natRules, want) {
		t.Fatalf("nat POSTROUTING lacks %q:\n%s", want, natRules)
	}

	tunnel.Delete(id)
	if natRules := iptablesRules(t, "nat"); strings.Contains(natRules, want) {
		t.Fatalf("nat POSTROUTING still carries %q after the hub was deleted:\n%s", want, natRules)
	}
}

func iptablesRules(t *testing.T, table string) string {
	t.Helper()
	out, err := exec.Command("iptables", "-t", table, "-S").CombinedOutput()
	if err != nil {
		t.Fatalf("iptables -t %s -S: %v (%s)", table, err, out)
	}
	return string(out)
}
