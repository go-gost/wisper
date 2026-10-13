package main

import (
	"bytes"
	"log/slog"
	"runtime/debug"
	"strings"
	"testing"

	"github.com/go-gost/wisper/version"
)

// TestBuildIDAndDirty pins the VCS stamp extraction. A release build stamped
// with ldflags has no vcs settings, and an app installed from an APK has
// neither — both must yield "" rather than a wrong answer.
func TestBuildIDAndDirty(t *testing.T) {
	tests := []struct {
		name      string
		info      *debug.BuildInfo
		wantID    string
		wantDirty bool
	}{
		{name: "nil build info", info: nil, wantID: "", wantDirty: false},
		{
			name: "clean revision",
			info: &debug.BuildInfo{Settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "a1b2c3d4e5f6"},
				{Key: "vcs.modified", Value: "false"},
			}},
			wantID: "a1b2c3d4e5f6", wantDirty: false,
		},
		{
			name: "dirty tree",
			info: &debug.BuildInfo{Settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "a1b2c3d4e5f6"},
				{Key: "vcs.modified", Value: "true"},
			}},
			wantID: "a1b2c3d4e5f6", wantDirty: true,
		},
		{
			name: "no vcs settings at all",
			info: &debug.BuildInfo{Settings: []debug.BuildSetting{
				{Key: "-buildmode", Value: "c-shared"},
			}},
			wantID: "", wantDirty: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildID(tt.info); got != tt.wantID {
				t.Errorf("buildID = %q, want %q", got, tt.wantID)
			}
			if got := buildDirty(tt.info); got != tt.wantDirty {
				t.Errorf("buildDirty = %v, want %v", got, tt.wantDirty)
			}
		})
	}
}

// TestStartupBannerPinsTheSession is the reason the banner exists: a 100MB
// concatenated log file is unreadable, and a fatal error mid-file leaves no
// marker of where a process's life began. One line per start bounds every
// crash site, and the vcs stamp answers which build crashed.
func TestStartupBannerPinsTheSession(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	startupBanner()

	line := buf.String()
	for _, want := range []string{"pid=", "version=", "vcs=", "dirty="} {
		if !strings.Contains(line, want) {
			t.Errorf("banner line missing %q, got: %s", want, line)
		}
	}

	// The pid must be this process's, or the banner cannot be correlated with
	// the tombstone / adb process listing.
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		t.Skip("no build info")
	}
	want := buildID(bi)
	got := ""
	for _, kv := range strings.Fields(line) {
		if v, ok := strings.CutPrefix(kv, "vcs="); ok {
			got = strings.Trim(v, `"`)
		}
	}
	if got != want {
		t.Errorf("banner vcs = %q, want %q", got, want)
	}
}

// TestBuildIDStampWins: the Android build passes -buildvcs=false, so build info
// carries no vcs settings and the banner would print an empty commit for every
// installed APK — the unreadable-SHA problem this banner was added to solve. A
// stamped commit has to beat whatever build info says.
func TestBuildIDStampWins(t *testing.T) {
	bi := &debug.BuildInfo{Settings: []debug.BuildSetting{
		{Key: "vcs.revision", Value: "frombuildinfo"},
	}}
	prev := version.Commit
	t.Cleanup(func() { version.Commit = prev })

	version.Commit = "abc123def"
	if got := buildID(bi); got != "abc123def" {
		t.Errorf("buildID = %q, want the stamped commit", got)
	}

	// With no stamp, build info is the fallback — a desktop or CI build.
	version.Commit = ""
	if got := buildID(bi); got != "frombuildinfo" {
		t.Errorf("buildID = %q, want the build-info revision", got)
	}
}
