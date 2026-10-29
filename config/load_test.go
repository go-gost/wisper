package config

import (
	"bytes"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// corruptFiles lists the preserved copies of an unreadable config.
func corruptFiles(t *testing.T, dir string) []string {
	t.Helper()
	m, err := filepath.Glob(filepath.Join(dir, configFile+".corrupt-*"))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// TestLoadRecoversFromBackup: an empty main file is not a config. The backup is
// restored and the unreadable file is kept, not overwritten.
func TestLoadRecoversFromBackup(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	if err := os.WriteFile(filepath.Join(dir, configFile), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	yml := []byte("settings:\n  server: bak\n")
	if err := os.WriteFile(filepath.Join(dir, backupFile), yml, 0o644); err != nil {
		t.Fatal(err)
	}

	var c Config
	recovered, err := c.load()
	if !recovered {
		t.Fatalf("load did not report a recovery: %v", err)
	}
	if err == nil {
		t.Error("load did not report what was wrong with the main file")
	}
	if c.Settings == nil || c.Settings.Server != "bak" {
		t.Errorf("recovered settings = %+v, want server bak", c.Settings)
	}

	if got := readConfig(t, filepath.Join(dir, configFile)).Settings; got == nil || got.Server != "bak" {
		t.Errorf("main file was not repaired: %+v", got)
	}

	kept := corruptFiles(t, dir)
	if len(kept) != 1 {
		t.Fatalf("kept %d corrupt files, want one", len(kept))
	}
	if b, err := os.ReadFile(kept[0]); err != nil || len(b) != 0 {
		t.Errorf("corrupt copy = %q, %v; want the empty original", b, err)
	}
}

// TestLoadMissingMainUsesBackup: a missing main file with a valid backup also
// recovers.
func TestLoadMissingMainUsesBackup(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	yml := []byte("settings:\n  server: bak\n")
	if err := os.WriteFile(filepath.Join(dir, backupFile), yml, 0o644); err != nil {
		t.Fatal(err)
	}

	var c Config
	recovered, err := c.load()
	if !recovered {
		t.Fatalf("load did not report a recovery: %v", err)
	}
	if err == nil {
		t.Error("load did not report the missing main file")
	}
	if c.Settings == nil || c.Settings.Server != "bak" {
		t.Errorf("recovered settings = %+v, want server bak", c.Settings)
	}
	if got := readConfig(t, filepath.Join(dir, configFile)).Settings; got == nil || got.Server != "bak" {
		t.Errorf("main file was not repaired: %+v", got)
	}
	if len(corruptFiles(t, dir)) != 0 {
		t.Error("a missing file was reported as corrupt")
	}
}

// TestLoadPreservesCorruptFile: a corrupt main file with no backup is preserved
// and reported; the caller can then write defaults without destroying the
// evidence.
func TestLoadPreservesCorruptFile(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	raw := []byte("settings: [oops")
	if err := os.WriteFile(filepath.Join(dir, configFile), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	var c Config
	recovered, err := c.load()
	if recovered {
		t.Error("load reported a recovery from a backup that does not exist")
	}
	if err == nil {
		t.Fatal("load accepted invalid YAML")
	}
	if _, statErr := os.Stat(filepath.Join(dir, configFile)); !os.IsNotExist(statErr) {
		t.Errorf("corrupt main file was left in place: %v", statErr)
	}

	kept := corruptFiles(t, dir)
	if len(kept) != 1 {
		t.Fatalf("kept %d corrupt files, want one", len(kept))
	}
	if b, err := os.ReadFile(kept[0]); err != nil || !bytes.Equal(b, raw) {
		t.Errorf("corrupt copy = %q, %v; want the original bytes", b, err)
	}
	if c.Settings != nil || len(c.Tunnels) != 0 || len(c.EntryPoints) != 0 {
		t.Errorf("receiver kept stale data after a failed load: %+v", c)
	}
}

// TestInitPreservesCorruptFile: Init on a corrupt file keeps the bad copy and
// leaves a valid default file.
func TestInitPreservesCorruptFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, configFile), []byte("settings: [oops"), 0o644); err != nil {
		t.Fatal(err)
	}

	prevSlog, prevDir := slog.Default(), configDir
	t.Cleanup(func() {
		slog.SetDefault(prevSlog)
		configDir = prevDir
		logOutput, logLevel = "", ""
		Set(&Config{})
	})
	Set(&Config{})

	Init(WithConfigDir(dir), WithLogOutput("none"))

	if got := corruptFiles(t, dir); len(got) != 1 {
		t.Fatalf("kept %d corrupt files, want one", len(got))
	}
	c := readConfig(t, filepath.Join(dir, configFile))
	if len(c.Tunnels) != 0 || len(c.EntryPoints) != 0 {
		t.Errorf("default config was not written: %+v", c)
	}
}

// TestInitReportsLoadFailureInFile: the load error reaches wisper.log, not just
// the stdout sink Android cannot read.
func TestInitReportsLoadFailureInFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, configFile), []byte("settings: [oops"), 0o644); err != nil {
		t.Fatal(err)
	}

	prevSlog, prevDir := slog.Default(), configDir
	t.Cleanup(func() {
		slog.SetDefault(prevSlog)
		configDir = prevDir
		logOutput, logLevel = "", ""
		Set(&Config{})
	})
	Set(&Config{})

	logPath := filepath.Join(dir, "wisper.log")
	Init(WithConfigDir(dir), WithLogOutput(logPath))

	b, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	if !bytes.Contains(b, []byte("load config")) {
		t.Errorf("load error missing from the log:\n%s", b)
	}
}

// TestLoadLeavesUnreadableFileAlone: an open/read failure is not corruption. The
// file must stay where it is and the backup must not silently replace it.
func TestLoadLeavesUnreadableFileAlone(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	main := filepath.Join(dir, configFile)
	if err := os.MkdirAll(main, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, backupFile), []byte("settings:\n  server: bak\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var c Config
	recovered, err := c.load()
	if recovered {
		t.Error("load recovered over an unreadable file")
	}
	if err == nil {
		t.Fatal("load accepted a directory as a config")
	}
	if fi, statErr := os.Stat(main); statErr != nil || !fi.IsDir() {
		t.Errorf("the unreadable file was moved or replaced: %v", statErr)
	}
	if got := corruptFiles(t, dir); len(got) != 0 {
		t.Errorf("an unreadable file was treated as corrupt: %v", got)
	}
	if c.Settings != nil {
		t.Errorf("receiver kept stale data after a failed load: %+v", c)
	}
}

// TestRecoveryKeepsBackupWhenCorruptFileCannotMove: when the corrupt main cannot
// be moved aside, recovery must publish over it without rotating it into .bak.
func TestRecoveryKeepsBackupWhenCorruptFileCannotMove(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	main := filepath.Join(dir, configFile)
	if err := os.WriteFile(main, []byte("settings: [oops"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, backupFile), []byte("settings:\n  server: bak\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	prev := preserveFile
	preserveFile = func(string, string) error { return errors.New("cannot preserve") }
	defer func() { preserveFile = prev }()

	var c Config
	recovered, err := c.load()
	if !recovered {
		t.Fatalf("load did not recover from the backup: %v", err)
	}
	if got := readConfig(t, main).Settings; got == nil || got.Server != "bak" {
		t.Errorf("main was not repaired: %+v", got)
	}
	if got := readConfig(t, filepath.Join(dir, backupFile)).Settings; got == nil || got.Server != "bak" {
		t.Errorf("backup was clobbered by the unmovable corrupt main: %+v", got)
	}
}

// TestCorruptCopyNameIsUnique: two corruptions at the same wall-clock second
// must both be preserved, not overwrite each other.
func TestCorruptCopyNameIsUnique(t *testing.T) {
	dir := t.TempDir()
	withConfigDir(t, dir)

	prev := configNow
	configNow = func() time.Time { return time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { configNow = prev })

	for i := 0; i < 2; i++ {
		if err := os.WriteFile(filepath.Join(dir, configFile), []byte("settings: [oops"), 0o644); err != nil {
			t.Fatal(err)
		}
		var c Config
		if _, err := c.load(); err == nil {
			t.Fatal("load of a corrupt config succeeded")
		}
	}
	if got := corruptFiles(t, dir); len(got) != 2 {
		t.Fatalf("kept %d corrupt files, want two", len(got))
	}
}
