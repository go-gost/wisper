package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	clogger "github.com/go-gost/core/logger"
	xconfig "github.com/go-gost/x/config"
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

// TestLogFile: the path the log API reads is the one initLog() writes to — the
// configured output, or the default under the config dir when there is none.
// Outputs that are not a file have no path to report.
func TestLogFile(t *testing.T) {
	dir := t.TempDir()
	prevSlog, prevDir := slog.Default(), configDir
	t.Cleanup(func() {
		slog.SetDefault(prevSlog)
		configDir = prevDir
		logOutput, logLevel = "", ""
	})

	// The stored config is process-wide and Init() keeps it when it has to
	// write a fresh file, so start from an empty one.
	Set(&Config{})
	Init(WithConfigDir(dir))

	if got, want := LogFile(), filepath.Join(dir, "logs", logFile); got != want {
		t.Errorf("LogFile() = %q, want the default path %q", got, want)
	}

	for _, output := range []string{"stderr", "stdout", "none"} {
		Set(&Config{Log: &xconfig.LogConfig{Output: output}})
		if got := LogFile(); got != "" {
			t.Errorf("LogFile() = %q for output %q, want \"\"", got, output)
		}
	}

	fileOut := filepath.Join(dir, "x.log")
	Set(&Config{Log: &xconfig.LogConfig{Output: fileOut}})
	if got := LogFile(); got != fileOut {
		t.Errorf("LogFile() = %q, want %q", got, fileOut)
	}
}

// TestSetLogLevel: the level switch reaches the running logger, leaves the
// stored config alone, and refuses a level it does not know.
func TestSetLogLevel(t *testing.T) {
	dir := t.TempDir()
	yml := []byte("log:\n  output: " + filepath.Join(dir, "x.log") + "\n  level: info\n")
	if err := os.WriteFile(filepath.Join(dir, configFile), yml, 0644); err != nil {
		t.Fatal(err)
	}

	prevSlog, prevDir := slog.Default(), configDir
	t.Cleanup(func() {
		slog.SetDefault(prevSlog)
		configDir = prevDir
		logOutput, logLevel = "", ""
	})

	Init(WithConfigDir(dir))

	if clogger.Default().IsLevelEnabled(clogger.DebugLevel) {
		t.Fatal("debug was on before anyone asked for it")
	}

	if err := SetLogLevel("DEBUG"); err != nil {
		t.Fatalf("SetLogLevel(debug): %v", err)
	}
	if !clogger.Default().IsLevelEnabled(clogger.DebugLevel) {
		t.Error("the running logger did not pick up level=debug")
	}
	if got := Get().Log.Level; got != "info" {
		t.Errorf("the level leaked into the stored config: %q", got)
	}
	if clogger.Default().IsLevelEnabled(clogger.TraceLevel) {
		t.Error("trace is enabled at level=debug")
	}

	if err := SetLogLevel("loud"); err == nil {
		t.Error("SetLogLevel accepted an unknown level")
	}
	if got := LogLevel(); got != "debug" {
		t.Errorf("LogLevel() = %q after a rejected level, want debug", got)
	}
}
