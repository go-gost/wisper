package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// withConfigDir points the package's writes at dir for the duration of a test.
func withConfigDir(t *testing.T, dir string) {
	t.Helper()
	prev := configDir
	configDir = dir
	t.Cleanup(func() { configDir = prev })
}

// readConfig decodes a config file written by the test.
func readConfig(t *testing.T, path string) *Config {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	c := &Config{}
	if err := yaml.Unmarshal(b, c); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return c
}

// TestWriteKeepsPreviousAsBackup: a second write publishes the new file and
// keeps the first one as .bak, so a bad load can fall back instead of starting
// from nothing.
func TestWriteKeepsPreviousAsBackup(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	if err := (&Config{Settings: &Settings{Server: "one"}}).Write(); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := (&Config{Settings: &Settings{Server: "two"}}).Write(); err != nil {
		t.Fatalf("second write: %v", err)
	}

	if got := readConfig(t, filepath.Join(dir, configFile)).Settings; got == nil || got.Server != "two" {
		t.Errorf("main config = %+v, want server two", got)
	}
	if got := readConfig(t, filepath.Join(dir, backupFile)).Settings; got == nil || got.Server != "one" {
		t.Errorf("backup config = %+v, want server one", got)
	}

	assertNoTempFiles(t, dir)
}

// TestWriteFailureKeepsRecoverableConfig: a failure while publishing leaves the
// previous config as .bak, and no temp file behind.
func TestWriteFailureKeepsRecoverableConfig(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	if err := (&Config{Settings: &Settings{Server: "one"}}).Write(); err != nil {
		t.Fatalf("first write: %v", err)
	}

	orig := renameFile
	renameFile = func(oldpath, newpath string) error {
		if newpath == filepath.Join(dir, configFile) {
			return errors.New("boom")
		}
		return orig(oldpath, newpath)
	}
	err := (&Config{Settings: &Settings{Server: "two"}}).Write()
	renameFile = orig
	if err == nil {
		t.Fatal("Write succeeded with a failing publish rename")
	}

	// The published file could not be replaced, so the old one must still be
	// the only readable config — here, as the backup.
	if got := readConfig(t, filepath.Join(dir, backupFile)).Settings; got == nil || got.Server != "one" {
		t.Errorf("backup config = %+v, want server one", got)
	}
	if _, statErr := os.Stat(filepath.Join(dir, configFile)); !os.IsNotExist(statErr) {
		t.Errorf("main file still exists after a failed publish: %v", statErr)
	}

	assertNoTempFiles(t, dir)
}

func assertNoTempFiles(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".wisper.yaml-") {
			t.Errorf("temp file left behind: %s", e.Name())
		}
	}
}

// TestWriteKeepsBackupModeWhenMainIsGone: recovering from .bak must not widen a
// private mode just because the main file is missing.
func TestWriteKeepsBackupModeWhenMainIsGone(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	bak := filepath.Join(dir, backupFile)
	if err := os.WriteFile(bak, []byte("settings:\n  server: bak\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(bak, 0o600); err != nil {
		t.Fatal(err)
	}

	var c Config
	if recovered, err := c.load(); !recovered {
		t.Fatalf("load did not recover from the backup: %v", err)
	}
	fi, err := os.Stat(filepath.Join(dir, configFile))
	if err != nil {
		t.Fatal(err)
	}
	if got := fi.Mode().Perm(); got != 0o600 {
		t.Errorf("restored mode = %o, want 600 (the backup's mode)", got)
	}
}

func TestWriteP2PTransportSettings(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	c := &Config{Settings: &Settings{P2P: &P2PSettings{
		Derp:      "wss://relay.example/derp",
		Transport: "quic",
		QUIC: &QUICSettings{
			MTU: 1400, RelayBatchBytes: 16384,
			RelayFlush: "250µs", KeepAlive: "6s", Idle: "20s", HandshakeTimeout: "12s",
		},
		Timeouts: &P2PTimeoutsSettings{Smux: &SmuxSettings{Interval: "4s", Timeout: "12s"}},
	}}}
	if err := c.Write(); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := readConfig(t, filepath.Join(dir, configFile)).Settings.P2P
	if got == nil || got.Transport != "quic" || got.QUIC == nil || got.QUIC.MTU != 1400 ||
		got.QUIC.RelayFlush != "250µs" || got.Timeouts == nil || got.Timeouts.Smux == nil ||
		got.Timeouts.Smux.Interval != "4s" {
		t.Fatalf("p2p = %+v", got)
	}
}
