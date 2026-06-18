package task

import (
	"context"
	"log/slog"
	"time"

	stats_pkg "github.com/go-gost/core/observer/stats"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/runner"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

type updateStatsTask struct{}

// UpdateStats returns a task that polls service stats.
func UpdateStats() runner.Task {
	return &updateStatsTask{}
}

func (t *updateStatsTask) ID() runner.TaskID {
	return runner.TaskUpdateStats
}

func (t *updateStatsTask) Run(context.Context) error {
	if err := t.updateTunnel(); err != nil {
		slog.Error("stats", "err", err)
	}
	if err := t.updateEntrypoint(); err != nil {
		slog.Error("stats", "err", err)
	}
	return nil
}

func (t *updateStatsTask) updateTunnel() error {
	for i := 0; i < tunnel.Count(); i++ {
		tun := tunnel.GetIndex(i)
		if tun == nil {
			continue
		}

		status := tun.Status()
		if status == nil {
			continue
		}

		oldStats := tun.Stats()

		d := time.Since(oldStats.Time)
		if d <= 0 {
			continue
		}

		stats := config.ServiceStats{}

		if s := status.Stats(); s != nil {
			stats.CurrentConns = s.Get(stats_pkg.KindCurrentConns)
			stats.InputBytes = s.Get(stats_pkg.KindInputBytes)
			stats.OutputBytes = s.Get(stats_pkg.KindOutputBytes)
			stats.TotalConns = s.Get(stats_pkg.KindTotalConns)
			stats.TotalErrs = s.Get(stats_pkg.KindTotalErrs)
			stats.Time = time.Now()
		}

		inputRateBytes := int64(stats.InputBytes) - int64(oldStats.InputBytes)
		if inputRateBytes < 0 {
			inputRateBytes = 0
		}
		stats.InputRateBytes = uint64(float64(inputRateBytes) / d.Seconds())

		outputRateBytes := int64(stats.OutputBytes) - int64(oldStats.OutputBytes)
		if outputRateBytes < 0 {
			outputRateBytes = 0
		}
		stats.OutputRateBytes = uint64(float64(outputRateBytes) / d.Seconds())

		reqRate := int64(stats.TotalConns) - int64(oldStats.TotalConns)
		if reqRate < 0 {
			reqRate = 0
		}
		stats.RequestRate = float64(reqRate) / d.Seconds()

		tun.SetStats(stats)
	}

	return tunnel.SaveConfig()
}

func (t *updateStatsTask) updateEntrypoint() error {
	for i := 0; i < entrypoint.Count(); i++ {
		ep := entrypoint.GetIndex(i)
		if ep == nil {
			continue
		}

		status := ep.Status()
		if status == nil {
			continue
		}

		oldStats := ep.Stats()

		d := time.Since(oldStats.Time)
		if d <= 0 {
			continue
		}

		stats := config.ServiceStats{}

		if s := status.Stats(); s != nil {
			stats.CurrentConns = s.Get(stats_pkg.KindCurrentConns)
			stats.InputBytes = s.Get(stats_pkg.KindInputBytes)
			stats.OutputBytes = s.Get(stats_pkg.KindOutputBytes)
			stats.TotalConns = s.Get(stats_pkg.KindTotalConns)
			stats.TotalErrs = s.Get(stats_pkg.KindTotalErrs)
			stats.Time = time.Now()
		}

		inputRateBytes := int64(stats.InputBytes) - int64(oldStats.InputBytes)
		if inputRateBytes < 0 {
			inputRateBytes = 0
		}
		stats.InputRateBytes = uint64(float64(inputRateBytes) / d.Seconds())

		outputRateBytes := int64(stats.OutputBytes) - int64(oldStats.OutputBytes)
		if outputRateBytes < 0 {
			outputRateBytes = 0
		}
		stats.OutputRateBytes = uint64(float64(outputRateBytes) / d.Seconds())

		reqRate := int64(stats.TotalConns) - int64(oldStats.TotalConns)
		if reqRate < 0 {
			reqRate = 0
		}
		stats.RequestRate = float64(reqRate) / d.Seconds()

		ep.SetStats(stats)
	}

	return entrypoint.SaveConfig()
}
