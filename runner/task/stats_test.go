package task

import (
	"context"
	"net"
	"testing"

	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/metadata"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
)

// TestRecordPunchFailures: a burst of failed rounds lands as one "punch failed"
// warning with a count, not a flood — the point of recording the constant
// message once per round. The count reaching the row is what makes the retries
// of a peer that cannot punch visible without spamming the history.
func TestRecordPunchFailures(t *testing.T) {
	event.Seed("t1", nil)
	defer event.Seed("t1", nil)

	cands := []peerCand{{
		ID:      "t1",
		Peers:   []string{"k1"},
		Aliases: map[string]string{"k1": "laptop"},
	}}

	recordPunchFailures([]punchFailure{{Key: "k1", Failures: 3}}, cands)

	got := event.List("t1")
	if len(got) != 1 {
		t.Fatalf("got %d events, want one coalesced row: %+v", len(got), got)
	}
	if got[0].Message != "peer laptop: punch failed" {
		t.Errorf("message = %q, want the constant punch-failed line", got[0].Message)
	}
	if got[0].Level != event.LevelWarn {
		t.Errorf("level = %q, want %q", got[0].Level, event.LevelWarn)
	}
	if got[0].Count != 3 {
		t.Errorf("Count = %d, want 3", got[0].Count)
	}
}

// unservedListener and unservedHandler pair into the service a hub's Run
// builds around them. Neither is served nor handled here — the service is
// built only to carry the stats sink Run installs in it — so the listener's
// embedded net.Listener is never reached.
type unservedListener struct{ net.Listener }

func (unservedListener) Init(metadata.Metadata) error { return nil }

type unservedHandler struct{}

func (unservedHandler) Init(metadata.Metadata) error { return nil }
func (unservedHandler) Handle(context.Context, net.Conn, ...handler.HandleOption) error {
	return nil
}

// servicedTunnel is a hub wrapped in the forward service its Run gives it.
//
// A hub that has not been Run holds no forward service, so its Status is nil
// and the stats task skips it outright — and there is no stats option that
// would stand one in: the hub's counters live in the xstats Run builds for
// itself and hands to the service. Run hands that same sink to the hub's
// control channel (SetCounter), which is what counts the LANs it routed,
// refused and withdrew. So the stub is built the way Run builds the real
// thing, and what updateTunnel reads is that sink. Everything else is the
// real hub, registered, saved and deleted like any other tunnel.
type servicedTunnel struct {
	tunnel.Tunnel
	status *xservice.Status
}

func (t *servicedTunnel) Status() *xservice.Status { return t.status }

// TestUpdateTunnelReportsLanCounters: a hub's LAN routing is counted by its
// control channel into the service stats the stats task reads, so the hub's
// routed/denied/withdrawn counters reach /api/stats instead of staying zero
// for a hub that carries that state in its head and never says it out loud.
func TestUpdateTunnelReportsLanCounters(t *testing.T) {
	// updateTunnel ends in SaveConfig, which writes ./wisper.yaml: keep that
	// artifact out of the repo, the way tunnel/event_persist_test.go does.
	t.Chdir(t.TempDir())

	sink := xstats.NewStats(false)
	sink.Add(xstats.KindLanRouted, 2)
	sink.Add(xstats.KindLanDenied, 1)
	sink.Add(xstats.KindLanWithdrawn, 3)

	svc := xservice.NewService("lan-counters", unservedListener{}, unservedHandler{},
		xservice.StatsOption(sink))
	ss, _ := svc.(tunnel.ServiceStatus)
	if ss == nil {
		t.Fatal("the hub's service exposes no status")
	}

	hub := tunnel.NewTunTunnel(
		tunnel.IDOption("lan-counters"),
		tunnel.NameOption("lan-counters"),
		tunnel.NetOption("10.10.0.1/24"),
	)
	hub.Close() // no device is created: this test is about the stats task
	tun := &servicedTunnel{Tunnel: hub, status: ss.Status()}
	tunnel.Add(tun)
	t.Cleanup(func() {
		tunnel.Delete(tun.ID())
		// SaveConfig replaced the in-memory config with what it saved; drop
		// that so a later test starts from an empty one, as the API suite's
		// setup does.
		config.Set(&config.Config{})
	})

	var task updateStatsTask
	if err := task.updateTunnel(); err != nil {
		t.Fatalf("updateTunnel: %v", err)
	}

	stats := tun.Stats()
	for _, tc := range []struct {
		field string
		got   uint64
		want  uint64
	}{
		{"LanRouted", stats.LanRouted, 2},
		{"LanDenied", stats.LanDenied, 1},
		{"LanWithdrawn", stats.LanWithdrawn, 3},
	} {
		if tc.got != tc.want {
			t.Errorf("%s = %d, want %d", tc.field, tc.got, tc.want)
		}
	}
}
