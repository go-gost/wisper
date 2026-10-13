package tunnel

import (
	"context"
	"testing"

	"github.com/go-gost/p2p/endpoint"
	cfg "github.com/go-gost/wisper/config"
	xservice "github.com/go-gost/x/service"
)

// requestKey is a value of this test's own, standing in for the action id the
// API's middleware puts on the request context: it is read back after the run
// to prove the strip drops the cancellation and nothing else. The action id
// itself is only readable inside the p2p module — the seam test
// (TestRunContextNamesTheActionAtTheSeam) is what covers that one.
type requestKey struct{}

// requestRecorder is the API's own view of a tunnel: a Tunnel (RunWithContext
// holds one) that is also a ContextRunner, which cancels "the request" from
// inside its run the way net/http does the moment a handler returns, and
// records the ctx the dispatch handed it.
type requestRecorder struct {
	got  context.Context
	stop context.CancelFunc
}

func (r *requestRecorder) RunContext(ctx context.Context) error {
	r.got = ctx
	// The handler has written its response: net/http cancels r.Context() here.
	r.stop()
	return nil
}

func (r *requestRecorder) ID() string                        { return "" }
func (r *requestRecorder) Type() string                      { return "" }
func (r *requestRecorder) Name() string                      { return "" }
func (r *requestRecorder) Endpoint() string                  { return "" }
func (r *requestRecorder) Entrypoint() string                { return "" }
func (r *requestRecorder) Options() Options                  { return Options{} }
func (r *requestRecorder) Run() error                        { return nil }
func (r *requestRecorder) Status() *xservice.Status          { return nil }
func (r *requestRecorder) Stats() cfg.ServiceStats           { return cfg.ServiceStats{} }
func (r *requestRecorder) SetStats(cfg.ServiceStats)         {}
func (r *requestRecorder) StatsBaseline() cfg.ServiceStats   { return cfg.ServiceStats{} }
func (r *requestRecorder) SetStatsBaseline(cfg.ServiceStats) {}
func (r *requestRecorder) Favorite(bool)                     {}
func (r *requestRecorder) IsFavorite() bool                  { return false }
func (r *requestRecorder) Close() error                      { return nil }
func (r *requestRecorder) IsClosed() bool                    { return false }
func (r *requestRecorder) Err() error                        { return nil }

// TestRunWithContextOutlivesTheRequest pins the lifetime bug that silently
// killed LAN routing on 2026-10-12. The API starts a tunnel with
// r.Context(), which net/http cancels as soon as the handler returns — while
// Run has itself returned and the goroutines it started (the control channel
// among them) are still serving. A run that inherits that cancellation is torn
// down by a response being written: the control channel's loop saw
// ctx.Err() != nil, logged one "control channel: context canceled" and exited,
// and the spoke claimed nothing at the hub for the rest of the process's life.
//
// The request's cancellation must therefore stop at the dispatch boundary. Its
// values do not: the action id the middleware put on the context is still what
// labels the p2p seam calls this start makes.
func TestRunWithContextOutlivesTheRequest(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	defer cancel()

	rec := &requestRecorder{stop: cancel}
	req := context.WithValue(endpoint.WithAction(parent, "ab12cd34"), requestKey{}, "the-request")
	if err := RunWithContext(req, rec); err != nil {
		t.Fatalf("RunWithContext: %v", err)
	}

	// The request ended inside the run. The run's own ctx must still be alive:
	// its goroutines outlive Run, and only Close() may stop them.
	if err := rec.got.Err(); err != nil {
		t.Fatalf("the run's ctx died with the request that started it: %v", err)
	}
	if rec.got.Done() != nil {
		t.Fatal("the run's ctx still watches a Done channel the request closes")
	}
	if got := rec.got.Value(requestKey{}); got != "the-request" {
		t.Fatalf("the run's ctx lost the request's values: got %v", got)
	}
}
