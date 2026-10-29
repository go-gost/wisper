# Config Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `wisper.yaml` survive a crash or kill without ever being published empty or partial, keep the previous good copy, preserve an unreadable one, and stop rewriting the file every second.

**Architecture:** Every write encodes to memory, writes a temp file in the config directory, fsyncs it, keeps the current file as `wisper.yaml.bak`, and renames the temp into place. Startup recovers from the backup and keeps a corrupt main file. The stats task keeps computing every second but persists at most every 10s.

**Tech Stack:** Go, `gopkg.in/yaml.v3`, `os.CreateTemp` / `Sync` / `Rename`.

**Spec:** `docs/superpowers/specs/2026-10-28-config-durability-design.md`

## Global Constraints

- **Do not commit.** The workspace rule is no `git add` / `git commit` unless the user explicitly asks. Tasks end with tests; the diff stays in the working tree.
- No config schema, API, or UI change.
- No new dependencies.
- File names are exactly `wisper.yaml.bak` and `wisper.yaml.corrupt-<UTC ts>` (`20060102T150405Z`).
- The periodic save window is `configSaveInterval = 10 * time.Second` in `runner/task`.

## Review Focus

- First run: no main file, no backup → defaults written, no warning spam, no `.corrupt` file.
- Empty or partial main + valid backup → backup wins, main repaired, corrupt copy kept.
- Crash between the two renames → main missing, `.bak` intact, next load recovers.
- Mode: preserve the current file's permission bits (the config carries tunnel passwords).
- Cross-platform: rename over an existing `.bak`; directory sync is best-effort and ignored when unsupported.
- Large config (up to 100 events per object, 200 global): temp file removed on every failure path.

---

### Task 1: Atomic replace with a backup

**Files:**
- Modify: `config/config.go`
- Test: `config/write_test.go`

**Interfaces:**
- Produces: `const backupFile = "wisper.yaml.bak"`, `func writeFileAtomic(path string, data []byte, perm os.FileMode) error`, `var renameFile = os.Rename`, `func syncDir(dir string)`.
- `func (c *Config) Write() error` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Create `config/write_test.go` (package `config`) with a helper that points the package at a temp dir:

```go
func withConfigDir(t *testing.T, dir string) {
	t.Helper()
	prev := configDir
	configDir = dir
	t.Cleanup(func() { configDir = prev })
}

func readConfig(t *testing.T, path string) *Config {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil { t.Fatal(err) }
	c := &Config{}
	if err := yaml.Unmarshal(b, c); err != nil { t.Fatal(err) }
	return c
}
```

```go
// A second write publishes the new file and keeps the first one as .bak, so a
// bad load can fall back instead of starting from nothing.
func TestWriteKeepsPreviousAsBackup(t *testing.T)

// A failure while publishing leaves the previous config recoverable: the main
// file is gone but .bak still holds it, and no temp file is left behind.
func TestWriteFailureKeepsRecoverableConfig(t *testing.T)
```

Assertions for `TestWriteKeepsPreviousAsBackup`: after writing `Server:"one"` then `Server:"two"`, the main file decodes to `two`, `wisper.yaml.bak` decodes to `one`, and no entry in the directory starts with `.wisper.yaml-`.

Assertions for `TestWriteFailureKeepsRecoverableConfig`: write `Server:"one"`; set `renameFile` to return `errors.New("boom")` when `new == filepath.Join(dir, configFile)` (the final rename only); `Write()` of `Server:"two"` returns an error; restore `renameFile`; `load()` returns `recovered == true` and `Settings.Server == "one"`; no `.wisper.yaml-*` file remains.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd wisper && go test ./config -run 'TestWrite' -v`
Expected: FAIL — `renameFile` / `load` recovery do not exist yet (`undefined: renameFile`, or the backup assertion fails because `Write` truncates in place).

- [ ] **Step 3: Implement the atomic writer**

In `config/config.go`:

```go
const (
	configFile = "wisper.yaml"
	backupFile = "wisper.yaml.bak"
	logFile    = "wisper.log"
)
```

```go
// renameFile is os.Rename in production: the failure path (the published file
// must stay the old one) is only reachable by making the rename fail.
var renameFile = os.Rename

// writeFileAtomic publishes data at path via a temp file in the same directory.
// A crash leaves either the old file or the new one, never an empty or partial
// file. perm is applied to the temp file before it is published.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error
```

Implementation order inside `writeFileAtomic`: `os.CreateTemp(dir, ".wisper.yaml-*")`; `defer os.Remove(tmp)`; `f.Chmod(perm)`; `f.Write(data)`; `f.Sync()`; `f.Close()`; then `replaceFile(tmp, path)`:

```go
// replaceFile keeps the current file as path+".bak" and publishes tmp at path.
// A crash between the two renames leaves the backup as the only file, which
// load() restores on the next start.
func replaceFile(tmp, path string) error
```

`replaceFile` stats `path`: if it exists, `renameFile(path, path+".bak")`; if the error is not `os.IsNotExist`, return it; then `renameFile(tmp, path)`; finally `syncDir(filepath.Dir(path))`.

`syncDir` opens the directory, calls `Sync`, closes it, and ignores all errors (Windows and some filesystems cannot sync a directory).

Change `Write` to compute the target mode from the existing file (fall back to `0o644`) and return `writeFileAtomic(...)` instead of `os.WriteFile`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd wisper && go test ./config -run 'TestWrite' -v`
Expected: PASS.

- [ ] **Step 5: Run the whole config package**

Run: `cd wisper && go test ./config`
Expected: PASS.

---

### Task 2: Recover from the backup, preserve a corrupt file

**Files:**
- Modify: `config/config.go` (`load`, `Init`)
- Test: `config/load_test.go`

**Interfaces:**
- Produces: `func (c *Config) load() (recovered bool, err error)` and `func loadConfigFile(path string) (*Config, error)`.
- Consumes: `backupFile`, `writeFileAtomic` from Task 1.

- [ ] **Step 1: Write the failing tests**

Create `config/load_test.go` (package `config`), reusing `withConfigDir` / `readConfig` from Task 1.

```go
// An empty main file is not a config: the backup is restored and the unreadable
// file is kept, not overwritten.
func TestLoadRecoversFromBackup(t *testing.T)

// A missing main file with a valid backup also recovers.
func TestLoadMissingMainUsesBackup(t *testing.T)

// A corrupt main file with no backup is preserved and reported; the caller can
// then write the defaults without destroying the evidence.
func TestLoadPreservesCorruptFile(t *testing.T)

// Init on a corrupt file keeps the bad copy and leaves a valid default file.
func TestInitPreservesCorruptFile(t *testing.T)
```

Assertions:

- `TestLoadRecoversFromBackup`: write a 0-byte main and a valid `.bak` with `Server:"bak"`; `load()` returns `recovered == true`; the receiver has `Server:"bak"`; the main file now decodes to `bak`; exactly one `wisper.yaml.corrupt-*` exists and its bytes are empty.
- `TestLoadMissingMainUsesBackup`: only `.bak` exists; `recovered == true`, main rewritten.
- `TestLoadPreservesCorruptFile`: main contains `settings: [oops` (invalid YAML); `load()` returns `recovered == false` and a non-nil error; main no longer exists; exactly one `.corrupt-*` holds the original bytes; the receiver is empty.
- `TestInitPreservesCorruptFile`: write invalid YAML; call `Init(WithConfigDir(dir), WithLogOutput("none"))` inside the same `slog`/`configDir` cleanup pattern `log_test.go` uses; afterwards the main file parses, `.corrupt-*` exists, and `Get().Tunnels` is empty.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd wisper && go test ./config -run 'TestLoad|TestInitPreserves' -v`
Expected: FAIL — `load` has no `recovered` return and does not move the file.

- [ ] **Step 3: Implement the fallback**

```go
// loadConfigFile decodes path into a fresh Config. A missing file, an empty
// file (io.EOF) and malformed YAML all return an error.
func loadConfigFile(path string) (*Config, error)
```

Rewrite `load`:

1. `loaded, err := loadConfigFile(filepath.Join(configDir, configFile))`; on success `*c = *loaded; return false, nil`.
2. If the error is not `os.IsNotExist`, rename the file to `path + ".corrupt-" + time.Now().UTC().Format("20060102T150405Z")` and wrap the original error with the kept name (`kept as <base>`); if the rename fails for a reason other than not-exist, wrap that too.
3. Try `loadConfigFile(filepath.Join(configDir, backupFile))`. On success `*c = *backup`, `c.Write()` to repair the main file, and return `true` with a note that it was restored (still wrapping the original error). If the rewrite fails, return `true` and include the rewrite error.
4. If the backup also fails: `*c = Config{}` and return `false, errors.Join(err, backupErr)`.

Update `Init` to:

```go
cfg := Get()
recovered, loadErr := cfg.load()
var writeErr error
if loadErr != nil && !recovered {
	writeErr = cfg.Write() // defaults; a corrupt file was moved aside above
}
Set(cfg)
event.SeedGlobal(cfg.Events)
initLog()

switch {
case loadErr == nil:
case recovered:
	slog.Warn("config restored from backup", "cause", loadErr)
default:
	if !errors.Is(loadErr, os.ErrNotExist) {
		slog.Error("load config", "err", loadErr)
	}
}
if writeErr != nil {
	slog.Error("write config", "err", writeErr)
}
```

Keep the imports tidy (`errors` is added). The logger switch is what makes this message reach `wisper.log`; before `initLog()` it only reached stdout.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd wisper && go test ./config -v`
Expected: PASS, including the existing log tests.

- [ ] **Step 5: Check the module still builds**

Run: `cd wisper && go build ./...`
Expected: no output.

---

### Task 3: Persist stats at most every 10 seconds

**Files:**
- Modify: `runner/task/stats.go`
- Modify: `runner/task/stats_test.go`

**Interfaces:**
- Produces: `const configSaveInterval = 10 * time.Second` and `func (t *updateStatsTask) persist()`.
- `updateTunnel` / `updateEntrypoint` lose their `error` return; they no longer write the file.
- `Run(context.Context) error` keeps its signature.

- [ ] **Step 1: Write the failing test**

Append to `runner/task/stats_test.go`:

```go
// The stats task computes every tick but writes the config at most once per
// window: the first tick persists, a tick inside the window does not, and a
// tick past it does.
func TestStatsPersistThrottled(t *testing.T)
```

Steps: `t.Chdir(t.TempDir())`; `t.Cleanup(func() { config.Set(&config.Config{}) })`; run `task.Run(context.Background())`; `os.Stat("wisper.yaml")` must succeed; run again and assert the modtime did not advance; set `task.lastSave = time.Now().Add(-configSaveInterval - time.Second)`; run again and assert the modtime advanced.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd wisper && go test ./runner/task -run TestStatsPersistThrottled -v`
Expected: FAIL — `configSaveInterval` and `lastSave` do not exist; the second tick still rewrites.

- [ ] **Step 3: Move the saves out of the tick**

In `runner/task/stats.go`:

- Add `lastSave time.Time` to `updateStatsTask`.
- Replace the `save := tunnel.SaveConfig()` / `entrypoint.SaveConfig()` returns in `updateTunnel` and `updateEntrypoint` with no return value (update their callers and the one test call).
- Give `Run` this tail:

```go
func (t *updateStatsTask) Run(context.Context) error {
	t.observeTransitions()
	t.updateTunnel()
	t.updateEntrypoint()
	t.persist()
	return nil
}

const configSaveInterval = 10 * time.Second

// persist writes the config at most once per configSaveInterval. Rates and
// liveness still update every tick; only the file write is throttled. API
// handlers and Stop() keep calling SaveConfig directly, so user changes are
// never delayed.
func (t *updateStatsTask) persist() {
	now := time.Now()
	if !t.lastSave.IsZero() && now.Sub(t.lastSave) < configSaveInterval {
		return
	}
	t.lastSave = now
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("stats: save tunnel config", "err", err)
	}
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("stats: save entrypoint config", "err", err)
	}
}
```

In `stats_test.go`, change `if err := task.updateTunnel(); err != nil { ... }` to `task.updateTunnel()`, and update the stale comment that says `updateTunnel` ends in `SaveConfig`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd wisper && go test ./runner/task -v`
Expected: PASS, including the existing LAN-counter test.

- [ ] **Step 5: Full module verification**

Run: `cd wisper && go vet ./... && go test ./...`
Expected: no vet output; all tests pass.

---

## Self-review notes

- Spec coverage: atomic write (Task 1), backup + corrupt preservation + load fallback + in-file logging (Task 2), 10s throttle (Task 3), tests in each task.
- Interfaces used across tasks: `backupFile` and `writeFileAtomic` (Task 1) are used by `load` (Task 2); `configSaveInterval` / `lastSave` live only in Task 3.
- Review Focus items each have a test: first run and empty/partial main in Task 2; crash-between-renames in Task 1's failure test; mode preservation in Task 1's code (existing mode read); cross-platform dir sync is best-effort and untested by design; temp cleanup asserted in Task 1.
