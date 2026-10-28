package tunnel

import (
	"testing"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/x/service"
)

// nonP2PTunnel is a tunnel that does not consume the shared p2p host; a p2p
// restart must leave it alone (only a config change restarts everything).
type nonP2PTunnel struct {
	id       string
	typ      string
	closed   bool
	closeHit bool
}

func (f *nonP2PTunnel) ID() string                        { return f.id }
func (f *nonP2PTunnel) Type() string                      { return f.typ }
func (f *nonP2PTunnel) Name() string                      { return f.id }
func (f *nonP2PTunnel) Endpoint() string                  { return "" }
func (f *nonP2PTunnel) Entrypoint() string                { return "" }
func (f *nonP2PTunnel) Options() Options                  { return Options{ID: f.id, Name: f.id} }
func (f *nonP2PTunnel) Run() error                        { return nil }
func (f *nonP2PTunnel) Status() *service.Status           { return nil }
func (f *nonP2PTunnel) Stats() cfg.ServiceStats           { return cfg.ServiceStats{} }
func (f *nonP2PTunnel) SetStats(cfg.ServiceStats)         {}
func (f *nonP2PTunnel) StatsBaseline() cfg.ServiceStats   { return cfg.ServiceStats{} }
func (f *nonP2PTunnel) SetStatsBaseline(cfg.ServiceStats) {}
func (f *nonP2PTunnel) Favorite(bool)                     {}
func (f *nonP2PTunnel) IsFavorite() bool                  { return false }
func (f *nonP2PTunnel) Close() error                      { f.closeHit, f.closed = true, true; return nil }
func (f *nonP2PTunnel) IsClosed() bool                    { return f.closed }
func (f *nonP2PTunnel) Err() error                        { return nil }

// TestRestartP2PRunningSkipsOtherTunnels: a key reset restarts only the
// tunnels that consume the p2p identity; restarting an HTTP tunnel would drop
// its live connections for no reason.
func TestRestartP2PRunningSkipsOtherTunnels(t *testing.T) {
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

	other := &nonP2PTunnel{id: "http-keep", typ: HTTPTunnel}
	Add(other)
	tn := NewP2PTunnel(IDOption("p2p-restart"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	Add(tn)
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}

	RestartP2PRunning()

	if other.closeHit {
		t.Fatal("RestartP2PRunning closed a non-p2p tunnel")
	}
	if got := Get("http-keep"); got != Tunnel(other) {
		t.Fatal("non-p2p tunnel was replaced")
	}
	if !tn.IsClosed() {
		t.Fatal("old p2p tunnel still open after restart")
	}
	next := Get("p2p-restart")
	if next == nil || next == Tunnel(tn) || next.IsClosed() {
		t.Fatalf("p2p tunnel was not restarted: %v", next)
	}
}

// TestResetP2PIdentityRestartUsesNewKey: the two halves must agree — after a
// reset and a p2p restart, the running host serves the key the reset returned,
// not the one it captured before.
func TestResetP2PIdentityRestartUsesNewKey(t *testing.T) {
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

	tn := NewP2PTunnel(IDOption("p2p-new-key"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	Add(tn)
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	old := p2pHost.PublicKey()

	pub, err := ResetP2PIdentity()
	if err != nil {
		t.Fatalf("ResetP2PIdentity: %v", err)
	}
	RestartP2PRunning()

	if !P2PHostRunning() {
		t.Fatal("host is not running after the p2p restart")
	}
	if got := p2pHost.PublicKey(); got != pub {
		t.Fatalf("running host key = %q, want the reset key %q", got, pub)
	}
	if pub == old {
		t.Fatal("reset kept the old key")
	}
}
