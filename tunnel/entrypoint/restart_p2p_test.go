package entrypoint

import (
	"testing"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/x/registry"
	"github.com/go-gost/x/service"
)

var directOff = false

// nonP2PEntryPoint is an entrypoint that does not consume the shared p2p host;
// a p2p restart must leave it alone.
type nonP2PEntryPoint struct {
	id       string
	typ      string
	closed   bool
	closeHit bool
}

func (f *nonP2PEntryPoint) ID() string                        { return f.id }
func (f *nonP2PEntryPoint) Type() string                      { return f.typ }
func (f *nonP2PEntryPoint) Name() string                      { return f.id }
func (f *nonP2PEntryPoint) Endpoint() string                  { return "" }
func (f *nonP2PEntryPoint) Entrypoint() string                { return "" }
func (f *nonP2PEntryPoint) Options() tunnel.Options           { return tunnel.Options{ID: f.id, Name: f.id} }
func (f *nonP2PEntryPoint) Run() error                        { return nil }
func (f *nonP2PEntryPoint) Status() *service.Status           { return nil }
func (f *nonP2PEntryPoint) Stats() cfg.ServiceStats           { return cfg.ServiceStats{} }
func (f *nonP2PEntryPoint) SetStats(cfg.ServiceStats)         {}
func (f *nonP2PEntryPoint) StatsBaseline() cfg.ServiceStats   { return cfg.ServiceStats{} }
func (f *nonP2PEntryPoint) SetStatsBaseline(cfg.ServiceStats) {}
func (f *nonP2PEntryPoint) Favorite(bool)                     {}
func (f *nonP2PEntryPoint) IsFavorite() bool                  { return false }
func (f *nonP2PEntryPoint) Close() error                      { f.closeHit, f.closed = true, true; return nil }
func (f *nonP2PEntryPoint) IsClosed() bool                    { return f.closed }
func (f *nonP2PEntryPoint) Err() error                        { return nil }

// TestRestartP2PRunningSkipsOtherEntrypoints: a key reset restarts only the
// entrypoints that consume the p2p identity; a local TCP entrypoint keeps
// serving.
func TestRestartP2PRunningSkipsOtherEntrypoints(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}
	t.Cleanup(func() {
		for i := Count() - 1; i >= 0; i-- {
			Delete(GetIndex(i).ID())
		}
	})

	other := &nonP2PEntryPoint{id: "tcp-keep", typ: TCPEntryPoint}
	Add(other)
	ep := NewP2PEntryPoint(
		tunnel.IDOption("p2p-restart"),
		tunnel.EndpointOption("127.0.0.1:0"),
		tunnel.PeerOption(testPeerKey),
	)
	Add(ep)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}

	RestartP2PRunning()

	if other.closeHit {
		t.Fatal("RestartP2PRunning closed a non-p2p entrypoint")
	}
	if got := Get("tcp-keep"); got != EntryPoint(other) {
		t.Fatal("non-p2p entrypoint was replaced")
	}
	if !ep.IsClosed() {
		t.Fatal("old p2p entrypoint still open after restart")
	}
	next := Get("p2p-restart")
	if next == nil || next == EntryPoint(ep) || next.IsClosed() {
		t.Fatalf("p2p entrypoint was not restarted: %v", next)
	}
}

// TestRestartP2PRunningKeepsTungoRules: a key reset rebuilds the tungo
// entrypoint onto the new p2p identity, and that rebuild goes through the same
// tunnel.Options literal as every other restart. The rule list has to survive it:
// a split rebuilt without its rules comes back running with an empty list, which
// sends every flow direct — a tunnel that tunnels nothing, with no error
// anywhere to say so.
func TestRestartP2PRunningKeepsTungoRules(t *testing.T) {
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

	const id = "tungo-restart-p2p-rules"
	rules := []string{"example.com", "home.pi", "192.168.100.0/24"}
	old := runningTungoWithRules(t, id, rules)

	RestartP2PRunning()

	if next := Get(id); next == nil || next == old {
		t.Fatalf("tungo entrypoint was not restarted: %v", next)
	}
	requireTungoRules(t, id, rules)
}

// TestRestartP2PRunningRestartsTungo: a tungo entrypoint rides the same shared
// host as p2p and tun (its chain node dials through the host's p2p provider), so
// an identity reset has to restart it too. The provider holds the host that was
// just stopped: its flows would fail while the entrypoint still reported
// running, and only a restart moves it onto the new host.
func TestRestartP2PRunningRestartsTungo(t *testing.T) {
	tungoRunConfig(t)
	// The real device step builds a tun interface, which a test must not do to
	// the host it runs on; the lifecycle under test is everything around it.
	useDeviceListener(t, loopbackDeviceListener(t))
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}
	t.Cleanup(func() {
		for i := Count() - 1; i >= 0; i-- {
			Delete(GetIndex(i).ID())
		}
	})

	const id = "tungo-restart"
	const provider = "tungo-ep-" + id
	tungoCleanup(t, id)

	other := &nonP2PEntryPoint{id: "tcp-keep-tungo", typ: TCPEntryPoint}
	Add(other)
	ep := NewTungoEntryPoint(
		tunnel.IDOption(id),
		tunnel.NameOption("phone"),
		tunnel.PeerOption(testPeerKey),
		tunnel.NetOption("10.10.100.250/32"),
		tunnel.RoutesOption("0.0.0.0/0"),
		tunnel.RulesOption("example.com"),
	)
	Add(ep)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}

	RestartP2PRunning()

	if other.closeHit {
		t.Fatal("RestartP2PRunning closed a non-p2p entrypoint")
	}
	if got := Get(other.ID()); got != EntryPoint(other) {
		t.Fatal("non-p2p entrypoint was replaced")
	}
	if !ep.IsClosed() {
		t.Fatal("old tungo entrypoint still open after restart")
	}
	next := Get(id)
	if next == nil || next == ep {
		t.Fatalf("tungo entrypoint was not replaced: %v", next)
	}
	if next.Type() != TungoEntryPoint {
		t.Fatalf("restarted entrypoint type = %q, want %q", next.Type(), TungoEntryPoint)
	}
	if next.IsClosed() {
		t.Fatalf("the tungo restart failed: %v", next.Err())
	}
	// The point of the restart: the replacement is on the host, with its
	// provider registered, not stranded on the one that was stopped.
	if !registry.P2PRegistry().IsRegistered(provider) {
		t.Error("the restarted tungo entrypoint registered no p2p provider")
	}
}
