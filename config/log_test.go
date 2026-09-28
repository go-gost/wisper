package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	clogger "github.com/go-gost/core/logger"
)

// TestInitLogOverrides: -log.output/-log.level apply to the running logger and
// are not written back into the stored config, which Get() shares with it.
func TestInitLogOverrides(t *testing.T) {
	dir := t.TempDir()
	fileOut := filepath.Join(dir, "x.log")
	yml := []byte("log:\n  output: " + fileOut + "\n  level: info\n")
	if err := os.WriteFile(filepath.Join(dir, configFile), yml, 0644); err != nil {
		t.Fatal(err)
	}

	prevSlog, prevDir := slog.Default(), configDir
	t.Cleanup(func() {
		slog.SetDefault(prevSlog)
		configDir = prevDir
		logOutput, logLevel = "", ""
	})

	Init(WithConfigDir(dir), WithLogOutput("stderr"), WithLogLevel("debug"))

	if got := Get().Log; got == nil || got.Output != fileOut || got.Level != "info" {
		t.Errorf("overrides leaked into the stored config: %+v", got)
	}
	if !clogger.Default().IsLevelEnabled(clogger.DebugLevel) {
		t.Error("log.level=debug was not applied to the running logger")
	}
}
