package main

import (
	"log/slog"
	"os"
	"runtime"
	"runtime/debug"

	"github.com/go-gost/wisper/version"
)

// buildID reads the VCS revision out of build info. It returns "" when the
// binary carries none: a release stamped via ldflags, a `go run`, or an APK
// built without -buildvcs all fall through to "". It is a function of the
// BuildInfo rather than of the process so it can be tested without building.
func buildID(bi *debug.BuildInfo) string {
	// A build-time stamp wins over build info: the Android APK is built with
	// -buildvcs=false and carries no vcs settings at all.
	if version.Commit != "" {
		return version.Commit
	}
	if bi == nil {
		return ""
	}
	for _, s := range bi.Settings {
		if s.Key == "vcs.revision" {
			return s.Value
		}
	}
	return ""
}

// buildDirty reports whether VCS said the tree had uncommitted changes when
// the binary was built. A dirty build is not reproducible, so a crash in one
// cannot be matched against a commit.
func buildDirty(bi *debug.BuildInfo) bool {
	if bi == nil {
		return false
	}
	for _, s := range bi.Settings {
		if s.Key == "vcs.modified" {
			return s.Value == "true"
		}
	}
	return false
}

// startupBanner writes one line per process start. Without it the combined
// log file is one undelimited blob: a fatal error mid-file leaves no way to
// tell where one process's life began, and — on Android, where the APK's
// git SHA is unreadable without root — no way to tell which build crashed.
func startupBanner() {
	info, _ := debug.ReadBuildInfo()
	id, dirty := buildID(info), buildDirty(info)
	slog.Info("wisper starting",
		"pid", os.Getpid(),
		"version", version.Version,
		"vcs", id,
		"dirty", dirty,
		"go", runtime.Version(),
	)
}
