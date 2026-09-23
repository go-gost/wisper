package config

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"

	clogger "github.com/go-gost/core/logger"
	xlogger "github.com/go-gost/x/logger"
)

// TestSlogBridge: everything written with slog reaches the same sink as gost's
// own logs — the point of the process having one log pipeline. Records below
// the sink's level are dropped by the sink, not by the caller.
func TestSlogBridge(t *testing.T) {
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })

	var buf bytes.Buffer
	sink := func(level clogger.LogLevel) *bytes.Buffer {
		buf.Reset()
		setDefaultSlog(xlogger.NewLogger(xlogger.OutputOption(&buf), xlogger.LevelOption(level)))
		return &buf
	}

	out := sink(clogger.DebugLevel)
	slog.Warn("direct punch: v4 unavailable", "peer", "abc", "err", errors.New("i/o timeout"))
	slog.With("service", "peers").Info("path up")

	got := out.String()
	for _, want := range []string{
		"direct punch: v4 unavailable",
		"peer=abc",
		"err=i/o timeout",
		"path up",
		"service=peers",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("sink output is missing %q; got:\n%s", want, got)
		}
	}

	// The sink's level is the one that decides.
	out = sink(clogger.WarnLevel)
	slog.Debug("debug noise", "peer", "abc")
	slog.Warn("quiet warning")
	if got := out.String(); strings.Contains(got, "debug noise") {
		t.Errorf("a debug record passed a warn-level sink:\n%s", got)
	} else if !strings.Contains(got, "quiet warning") {
		t.Errorf("a warn record was dropped by a warn-level sink:\n%s", got)
	}
}

// TestSlogBridgeNoSink: without a configured logger the default is left alone
// (unit tests run before config.Init).
func TestSlogBridgeNoSink(t *testing.T) {
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })

	setDefaultSlog(nil)
	if slog.Default() != prev {
		t.Error("setDefaultSlog(nil) replaced the default logger")
	}
}
