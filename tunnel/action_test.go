package tunnel

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/go-gost/p2p/endpoint"
	cfg "github.com/go-gost/wisper/config"
)

// syncBuffer is a bytes.Buffer safe to write from the engine's background
// goroutines while the test reads: the seam line is written on the caller's
// goroutine, but the engine shares the host's logger.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// TestRunContextNamesTheActionAtTheSeam: a start that carries an action id has
// it logged on the p2p seam calls the start makes (each peer's Warm, and the
// host's Listen when this start builds the host) — the join the feature exists
// for. The id reaches the seam through the request context only; nothing in the
// run path knows about it.
func TestRunContextNamesTheActionAtTheSeam(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
	if p2pHost.refs != 0 {
		t.Fatal("manager is not idle: a previous test leaked a reference")
	}
	defer func() {
		for p2pHost.refs > 0 {
			p2pHost.release()
		}
	}()

	var buf syncBuffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })

	tn := NewP2PTunnel(IDOption("test-p2p-action"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	// Through the API's own entry point: RunWithContext is what a handler calls,
	// so this covers the dispatch (a p2p tunnel is a ContextRunner) too.
	if err := RunWithContext(endpoint.WithAction(context.Background(), "ab12cd34"), tn); err != nil {
		t.Fatalf("RunWithContext: %v", err)
	}

	got := buf.String()
	if !strings.Contains(got, "call=warm action=ab12cd34") {
		t.Fatalf("seam log = %q, want the peer warm-up to name the action", got)
	}
	// No seam line may come back unlabelled: the whole point is that the id is
	// on the line the action produced.
	seams := 0
	for _, line := range strings.Split(got, "\n") {
		if !strings.Contains(line, "msg=seam") {
			continue
		}
		seams++
		if !strings.Contains(line, "action=ab12cd34") {
			t.Fatalf("seam line without the action: %q", line)
		}
	}
	if seams == 0 {
		t.Fatalf("no seam line logged at all: %q", got)
	}
}
