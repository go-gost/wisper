package entrypoint

import (
	"context"
	"slices"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/x/registry"
)

// runningTungoWithRules adds and runs a tungo entrypoint carrying rules, with
// the device step stubbed (a real one builds a tun interface): the lifecycle
// under test is the rebuild, not the device.
func runningTungoWithRules(t *testing.T, id string, rules []string) EntryPoint {
	t.Helper()
	tungoCleanup(t, id)

	ep := NewTungoEntryPoint(
		tunnel.IDOption(id),
		tunnel.NameOption("phone"),
		tunnel.PeerOption(testPeerKey),
		tunnel.NetOption("10.10.100.250/32"),
		tunnel.RoutesOption("0.0.0.0/0"),
		tunnel.DNSOption("192.168.100.100"),
		tunnel.RulesOption(rules...),
	)
	t.Cleanup(func() { _ = ep.Close() })
	Add(ep)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	return ep
}

// requireTungoRules asserts a rebuilt tungo entrypoint kept its split: the rule
// list in the options a restart re-reads, and in the bypass the chain hop
// resolves by name. An empty list is "everything direct", so both are checked —
// a lost list leaves an entrypoint that still reports running, serving nothing
// through the tunnel.
func requireTungoRules(t *testing.T, id string, rules []string) {
	t.Helper()

	ep := Get(id)
	if ep == nil {
		t.Fatalf("no entrypoint %q after the restart", id)
	}
	t.Cleanup(func() { _ = ep.Close() })

	if got := ep.Options().Rules; !slices.Equal(got, rules) {
		t.Errorf("restarted rules = %v, want %v (an empty list sends every flow direct)", got, rules)
	}
	bp := registry.BypassRegistry().GetAll()["tungo-rules-"+id]
	if bp == nil {
		t.Fatalf("the restarted entrypoint registered no rules: the hop has nothing to resolve")
	}
	ctx := context.Background()
	// A whitelist bypass reports true for destinations that skip the tunnel.
	if bp.Contains(ctx, "tcp", "example.com:443") {
		t.Error("the restarted split no longer tunnels a listed destination")
	}
	if !bp.Contains(ctx, "tcp", "1.2.3.4:443") {
		t.Error("the restarted split tunnels a destination that is not listed")
	}
}

// TestRestartKeepsStats: Restart recreates the run (Android VPN rebuild), so
// the replacement must carry the live cumulative counters and the live
// baseline — like RestartRunning and the update/start handlers do. Losing the
// counters while keeping a post-reset baseline pins the displayed totals at
// zero (safeSub underflow guard) while the rates keep moving.
func TestRestartKeepsStats(t *testing.T) {
	const id = "ep-restart-keeps-stats"
	ep := NewTCPEntryPoint(
		tunnel.IDOption(id),
		tunnel.EndpointOption("127.0.0.1:0"),
	)
	Add(ep)
	t.Cleanup(func() { Delete(id) })

	ep.SetStats(cfg.ServiceStats{InputBytes: 483513, OutputBytes: 3454414, TotalConns: 4})
	ep.SetStatsBaseline(cfg.ServiceStats{InputBytes: 274842891, OutputBytes: 294805931})

	newEP := Restart(id)
	if newEP == nil {
		t.Fatal("Restart returned nil for a running entrypoint")
	}
	t.Cleanup(func() { _ = newEP.Close() })

	if got := newEP.Stats(); got.InputBytes != 483513 || got.OutputBytes != 3454414 || got.TotalConns != 4 {
		t.Errorf("Restart lost live stats: %+v, want the old run's counters", got)
	}
	if got := newEP.StatsBaseline(); got.InputBytes != 274842891 || got.OutputBytes != 294805931 {
		t.Errorf("Restart lost live baseline: %+v, want the old run's baseline", got)
	}
}

// TestRestartRunningKeepsRules: restartRunning rebuilds every running
// entrypoint from a fresh tunnel.Options literal, so a field missing from that
// literal is silently lost on a restart. For a tungo entrypoint the rule list is
// the whole split, and losing it is the quietest possible failure: the
// entrypoint comes back running with an empty list, which sends every flow
// direct — no error, no event, just a tunnel that tunnels nothing.
func TestRestartRunningKeepsRules(t *testing.T) {
	tungoRunConfig(t)
	t.Chdir(t.TempDir())
	useDeviceListener(t, loopbackDeviceListener(t))
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}
	t.Cleanup(func() {
		for i := Count() - 1; i >= 0; i-- {
			Delete(GetIndex(i).ID())
		}
	})

	const id = "tungo-restart-running"
	rules := []string{"example.com", "192.168.100.0/24"}
	old := runningTungoWithRules(t, id, rules)

	RestartRunning()

	if next := Get(id); next == nil || next == old {
		t.Fatalf("tungo entrypoint was not restarted: %v", next)
	}
	requireTungoRules(t, id, rules)
}
