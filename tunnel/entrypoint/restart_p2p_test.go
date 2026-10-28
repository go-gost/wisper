package entrypoint

import (
	"testing"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
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
