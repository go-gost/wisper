package tunnel

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// TestRunControlChannelSurvivesAPanicInTheLoop is the crash this was written
// for. The phone died with "index out of range [0] with length 0": the panic
// left RunControlChannel's loop and the runtime wrote the message to crash.log
// without a goroutine stack, then aborted the c-shared library — an
// unexplained SIGABRT and an app that stayed down until Android's deferred
// restart. Recovered per iteration, the panic is reported with its stack and
// the loop keeps its retry cadence: a dead control channel is recoverable.
func TestRunControlChannelSurvivesAPanicInTheLoop(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// A dialing controlSession that panicked in the far end of the stream: the
	// shape that produced the phone's crash.log line. Restored on the way out
	// because the loop calls it again, and a leaked panic would kill the suite.
	//
	// Assigned before the goroutine that reads it starts. controlSession is a
	// package variable the loop reads once per iteration, so writing it from
	// here while the loop runs is a data race on that variable — which is what
	// the CI's -race run caught, on a test that had to be fixed rather than the
	// code it was testing.
	prevSession := controlSession
	t.Cleanup(func() { controlSession = prevSession })
	calls := make(chan struct{}, 4)
	controlSession = func(ctx context.Context, cfg ControlChannelConfig) error {
		select {
		case calls <- struct{}{}:
		default:
		}
		panic("index out of range [0] with length 0")
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		RunControlChannel(ctx, ControlChannelConfig{
			HubPeer: "gfyuoMdKHdqS-LjNTqd6x6V5YJhpnU5ebhF-Qpfo1DI",
		})
	}()

	// Two recoveries prove the loop keeps going; one entry closes immediately.
	select {
	case <-calls:
	case <-time.After(3 * time.Second):
		t.Fatal("controlSession was never called")
	}
	select {
	case <-calls:
	case <-time.After(5 * time.Second):
		t.Fatal("the loop stopped after the first panic instead of retrying")
	}
	cancel()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("RunControlChannel did not return on cancel")
	}

	line := buf.String()
	if !strings.Contains(line, "index out of range") {
		t.Errorf("panic not reported: %s", line)
	}
	if !strings.Contains(line, "goroutine ") {
		t.Errorf("no goroutine stack captured: %s", line)
	}
}
