package tunnel

import (
	"strings"
	"testing"

	xlogger "github.com/go-gost/x/logger"
)

// TestServeForwardSurvivesAPanic pins the crash that took the spoke down on
// 2026-10-12. The last line the phone logged before the process died was
// "connect /ip" (forward/connector.go:44) — a dial inside the data plane this
// goroutine serves — and crash.log held only "panic: runtime error: index out
// of range [0] with length 0", three times, with no stack: in a c-shared
// library the runtime cannot unwind past the cgo boundary, so an unrecovered
// panic takes the whole app with it and leaves an unexplained SIGABRT.
// Recovered here, the panic is reported with its stack and the tunnel is
// marked failed: a forwarder that panicked is a tunnel that is down, not a
// process that has to die.
func TestServeForwardSurvivesAPanic(t *testing.T) {
	var buf strings.Builder
	log := xlogger.NewLogger(xlogger.OutputOption(&buf))

	s := &tunTunnel{}
	serveForward(s, log, func() error {
		panic("index out of range [0] with length 0")
	})

	if s.Err() == nil {
		t.Fatal("the tunnel is not marked failed after the forwarder panicked")
	}
	got := buf.String()
	if !strings.Contains(got, "index out of range") {
		t.Errorf("panic not reported: %s", got)
	}
	if !strings.Contains(got, "goroutine ") {
		t.Errorf("no goroutine stack captured: %s", got)
	}
}
