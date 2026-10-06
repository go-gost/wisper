package entrypoint

import (
	"testing"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
)

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
