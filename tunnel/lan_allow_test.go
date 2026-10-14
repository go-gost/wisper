package tunnel

import (
	"context"
	"net/netip"
	"os"
	"strings"
	"testing"

	"github.com/go-gost/core/logger"
	cfg "github.com/go-gost/wisper/config"
	xlogger "github.com/go-gost/x/logger"
)

// SetLanAllow is what answers a spoke that was refused with "no-allow-row":
// the hub's own pages reach the policy through it, so the spoke does not have to
// wait for a restart that the hub's own operator asked for nothing of the sort.
//
// A hub with no spoke is what the field showed — the claim, its refusal and the
// row that would have allowed it — so the test needs no spoke at all. The device
// does, because the RIB the policy feeds lives behind the hub's handler: this is
// the endpoint, not the unit under test.
func TestTunHubSetLanAllowAnswersARefusedClaim(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("a tun device needs root")
	}
	if logger.Default() == nil {
		logger.SetDefault(xlogger.Nop())
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})

	const spoke = "spoke-lan"
	tun := NewTunTunnel(
		IDOption("tun-lan-allow"),
		NameOption("hub-lan-allow"),
		NetOption("10.10.100.1/24"),
		MTUOption(1400),
		DeviceNameOption("wisper-lanallow"),
		PeersOption(spoke),
	).(*tunTunnel)
	if err := tun.Run(); err != nil {
		t.Fatalf("run: %v", err)
	}
	t.Cleanup(func() { _ = tun.Close() })

	claim := netip.MustParsePrefix("192.168.1.0/24")

	// The spoke's claim arrives the way the control channel carries one: through
	// the hub's own assertion path. There is no spoke here, so the claim is made
	// by a direct call into the path a real one takes.
	rib := tun.controlHub().rib
	rib.SetMembers([]memberEntry{{IP: "10.10.100.2", Key: spoke}})

	if code, _, approved := rib.approvalRefusal(spoke, claim); approved || code != refusalNoAllowRow {
		t.Fatalf("the claim with no row = (%q, approved=%v), want %q and a refusal", code, approved, refusalNoAllowRow)
	}

	// The save an operator makes from the peers page: one row, the way the form
	// holds it — plain CIDRs, keyed by the spoke they belong to.
	if err := tun.SetLanAllow(context.Background(), map[string][]string{
		spoke: {"192.168.1.0/24"},
	}); err != nil {
		t.Fatalf("set lan_allow: %v", err)
	}

	if _, _, ok := rib.approvalRefusal(spoke, claim); !ok {
		t.Fatalf("the same claim after the save was still refused")
	}
	if got := rib.ApplyClaim(spoke, []netip.Prefix{claim}, nil); len(got) != 1 {
		t.Fatalf("the claim the row allows did not install: %v", got)
	}
	if _, ok := rib.claims[claim]; !ok {
		t.Fatalf("claim %v is not in the table", claim)
	}
	// And the journal that said "no-allow-row" did not have to: the spoke's next
	// assertion asks the new row, and the hub that refused nothing says nothing.
	if got := len(tun.controlHub().refusals); got != 0 {
		t.Fatalf("the hub's refusal journal has %d refusals for a claim it approved", got)
	}

	// What the save wrote is what a reload comes back up with: the options carry
	// the rows in their config form, so a tunnel read from a file answers the
	// same way it answers live. Round-tripping through ParseLanAllow is the
	// check — FormatLanAllow's other half.
	rows, err := ParseLanAllow(tun.opts.LanAllow)
	if err != nil {
		t.Fatalf("parse back the saved rows %q: %v", tun.opts.LanAllow, err)
	}
	if got := rows[spoke]; len(got) != 1 || got[0] != claim {
		t.Fatalf("saved rows for %s = %v, want %s", spoke, got, claim)
	}

	// The row it replaced did not survive next to it: a hub whose policy is
	// edited twice is a hub whose second edit is its whole policy.
	if err := tun.SetLanAllow(context.Background(), map[string][]string{
		spoke: {},
	}); err != nil {
		t.Fatalf("clear the row: %v", err)
	}
	if code, _, ok := rib.approvalRefusal(spoke, claim); ok || code != refusalEmptyAllow {
		t.Fatalf("the claim after clearing the row = (%q, approved=%v), want %q", code, ok, refusalEmptyAllow)
	}
}

// The other three answers SetLanAllow can give, all of which are the caller's:
// a hub that is closed, a hub that is not running, and a row that does not parse.
func TestSetLanAllowRefusals(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})

	closed := NewTunTunnel(IDOption("tun-closed"), NameOption("hub")).(*tunTunnel)
	closed.Close()
	if err := closed.SetLanAllow(context.Background(), map[string][]string{"p": {"10.0.0.0/8"}}); err == nil {
		t.Error("a closed hub accepted a policy save")
	} else if !strings.Contains(err.Error(), "closed") {
		t.Errorf("the refusal %q does not say the tunnel is closed", err)
	}

	registered := NewTunTunnel(IDOption("tun-notrunning"), NameOption("hub")).(*tunTunnel)
	// Not closed and not run: what a hub sits in after a failed start.
	if err := registered.SetLanAllow(context.Background(), map[string][]string{"p": {"10.0.0.0/8"}}); err == nil {
		t.Error("a hub that never ran accepted a policy save")
	} else if !strings.Contains(err.Error(), "not running") {
		t.Errorf("the refusal %q does not say the hub is not running", err)
	}

	bad := NewTunTunnel(
		IDOption("tun-badrow"), NameOption("hub"), NetOption("10.10.100.1/24"),
		MTUOption(1400), DeviceNameOption("wisper-lanbad"),
	).(*tunTunnel)
	if err := bad.Run(); err != nil {
		t.Skipf("no CAP_NET_ADMIN here: %v", err)
	}
	t.Cleanup(func() { _ = bad.Close() })
	err := bad.SetLanAllow(context.Background(), map[string][]string{"p": {"192.168.1.0/24", "not-a-cidr"}})
	if err == nil {
		t.Fatal("a row that does not parse was saved")
	}
	if !strings.Contains(err.Error(), "not-a-cidr") || !strings.Contains(err.Error(), "lan_allow") {
		t.Errorf("the refusal %q does not name the row and the form it belongs to", err)
	}
	// The bad row took the save with it: half a policy saved is a hub whose
	// other half surprises its operator later.
	if rows, _ := ParseLanAllow(bad.opts.LanAllow); len(rows) != 0 {
		t.Errorf("the options kept %v out of a refused save", rows)
	}
}
