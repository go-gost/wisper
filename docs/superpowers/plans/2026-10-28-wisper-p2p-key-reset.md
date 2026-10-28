# Wisper P2P Key Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rotate wisper's process-wide p2p identity from the API and the settings page, restarting p2p consumers on the new key.

**Architecture:** The tunnel package owns the identity file and the shared host, so it gains `ResetP2PIdentity` (atomic key replacement + host teardown) and filtered restart helpers. The API orchestrates reset + tunnel/entrypoint restarts behind a mutex. The settings page adds a danger dialog over the new endpoint.

**Tech Stack:** Go 1.22+ `net/http` mux, Lit + TypeScript, `crypto/ecdh` via `p2p.GenerateKey`.

**Spec:** `wisper/docs/superpowers/specs/2026-10-28-wisper-p2p-key-reset-design.md`

## Global Constraints

- Comments in English only.
- `en.ts` and `zh.ts` must carry identical key sets.
- `web/assets` is tracked: run `make web` after `web-src` changes.
- Do not commit or push unless asked.
- Tests in `wisper/` are run per-package (wildcard runs can hang here).

## Review Focus

- Reset while a p2p consumer runs: the host must actually stop and the new key must be the one the restarted host uses.
- Reset failure (unwritable directory): the old key must survive and remain usable.
- Two concurrent resets: the file and the rebuilt host must agree on one key.
- A reset must not restart unrelated tunnels (HTTP/TCP/UDP/file).
- The UI must show the new key without a reload.

---

### Task 1: Identity rotation and host teardown

**Files:**
- Modify: `tunnel/p2p_host.go`
- Test: `tunnel/p2p_host_test.go`

**Interfaces:**
- Produces: `func ResetP2PIdentity() (publicKey string, err error)`
- Produces: `func (m *p2pHostManager) resetIdentity() (string, error)`
- Produces: `func writeIdentityFile(path, hexKey string) error`

- [x] **Step 1: Write the failing tests**

In `tunnel/p2p_host_test.go` add:

```go
func TestResetP2PIdentity(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
	if p2pHost.refs != 0 || p2pHost.host != nil {
		t.Fatal("manager is not idle: a previous test leaked a reference")
	}

	old, err := EnsureP2PIdentity()
	if err != nil {
		t.Fatalf("EnsureP2PIdentity: %v", err)
	}
	got, err := ResetP2PIdentity()
	if err != nil {
		t.Fatalf("ResetP2PIdentity: %v", err)
	}
	if got == old {
		t.Fatal("reset returned the old public key")
	}
	if len(got) != 43 {
		t.Fatalf("public key = %q (%d chars), want a 43-char base64 key", got, len(got))
	}
	again, err := EnsureP2PIdentity()
	if err != nil || again != got {
		t.Fatalf("identity after reset = %q, %v; want %q", again, err, got)
	}
	fi, err := os.Stat(P2PHostKeyPath())
	if err != nil {
		t.Fatalf("host.key: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("host.key mode = %o, want 600", perm)
	}
	if p2pHost.host != nil || p2pHost.refs != 0 {
		t.Fatalf("reset started the host: host %v refs %d", p2pHost.host, p2pHost.refs)
	}

	// Every reset is a new identity.
	third, err := ResetP2PIdentity()
	if err != nil || third == got {
		t.Fatalf("second reset = %q, %v; want a key different from %q", third, err, got)
	}
}

func TestResetP2PIdentityStopsRunningHost(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
	tn := NewP2PTunnel(IDOption("reset-host"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	old := p2pHost.PublicKey()
	if old == "" || !P2PHostRunning() {
		t.Fatal("host is not running after Run")
	}

	pub, err := ResetP2PIdentity()
	if err != nil {
		t.Fatalf("ResetP2PIdentity: %v", err)
	}
	if P2PHostRunning() {
		t.Fatal("host still running after reset")
	}
	if pub == old {
		t.Fatal("reset kept the host key")
	}
	_ = tn.Close()
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd wisper && go test ./tunnel/ -run 'TestResetP2PIdentity' -count=1`
Expected: FAIL with `undefined: ResetP2PIdentity`.

- [x] **Step 3: Implement**

In `tunnel/p2p_host.go` add next to `EnsureP2PIdentity`:

```go
// ResetP2PIdentity rotates the process-wide p2p identity: it generates a new
// key, replaces the key file atomically, and stops the shared host so the next
// acquire rebuilds it with the new key. Running p2p consumers are left to the
// caller (RestartP2PRunning), which must restart them after this returns.
func ResetP2PIdentity() (string, error) { return p2pHost.resetIdentity() }
```

and the manager method:

```go
// resetIdentity replaces the identity file under the manager lock, so a
// concurrent EnsureP2PIdentity cannot read (or build a host with) a key that is
// being replaced, then tears the running host down. References are kept: their
// holders are restarted and will return them.
func (m *p2pHostManager) resetIdentity() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	hexKey, publicKey, err := p2p.GenerateKey()
	if err != nil {
		return "", fmt.Errorf("p2p identity: %w", err)
	}
	if err := writeIdentityFile(P2PHostKeyPath(), hexKey); err != nil {
		return "", fmt.Errorf("p2p identity %s: %w", P2PHostKeyPath(), err)
	}
	m.teardownLocked()
	return publicKey, nil
}
```

and the atomic writer, near `ensureIdentityLocked`:

```go
// writeIdentityFile replaces path with hexKey atomically: the key file is
// either the old identity or the new one, never missing or half-written. A
// failed write leaves the old file in place.
func writeIdentityFile(path, hexKey string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".host.key-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp) // gone after a successful rename; cleans up on failure
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		return err
	}
	if _, err := f.WriteString(hexKey + "\n"); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd wisper && go test ./tunnel/ -run 'TestResetP2PIdentity' -count=1`
Expected: PASS.

---

### Task 2: Restart only p2p consumers

**Files:**
- Modify: `tunnel/tunnel.go:561-643`
- Modify: `tunnel/entrypoint/entrypoint.go:252-324`
- Test: `tunnel/tunnel_test.go` (create if absent), `tunnel/entrypoint/entrypoint_test.go` (create if absent)

**Interfaces:**
- Produces: `func RestartP2PRunning()` in both packages.
- Keeps: `func RestartRunning()` (all running services).

- [x] **Step 1: Write the failing tests**

`tunnel` package test:

```go
// fakeTunnel stands in for a non-p2p tunnel: it must not be touched by the
// p2p-only restart.
type fakeTunnel struct {
	id       string
	typ      string
	closed   bool
	closeHit bool
}

func (f *fakeTunnel) ID() string { return f.id }
func (f *fakeTunnel) Type() string { return f.typ }
func (f *fakeTunnel) Name() string { return f.id }
func (f *fakeTunnel) Endpoint() string { return "" }
func (f *fakeTunnel) Entrypoint() string { return "" }
func (f *fakeTunnel) Options() Options { return Options{ID: f.id, Name: f.id} }
func (f *fakeTunnel) Run() error { return nil }
func (f *fakeTunnel) Close() error { f.closeHit = true; f.closed = true; return nil }
func (f *fakeTunnel) IsClosed() bool { return f.closed }
func (f *fakeTunnel) Favorite(bool) {}
func (f *fakeTunnel) IsFavorite() bool { return false }
func (f *fakeTunnel) Stats() config.ServiceStats { return config.ServiceStats{} }
func (f *fakeTunnel) SetStats(config.ServiceStats) {}
func (f *fakeTunnel) StatsBaseline() config.ServiceStats { return config.ServiceStats{} }
func (f *fakeTunnel) SetStatsBaseline(config.ServiceStats) {}
func (f *fakeTunnel) Status() *xservice.Status { return nil }

func TestRestartP2PRunningSkipsOtherTunnels(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}

	other := &fakeTunnel{id: "http-keep", typ: HTTPTunnel}
	Add(other)
	p2p := NewP2PTunnel(IDOption("p2p-restart"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	Add(p2p)
	if err := p2p.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}

	RestartP2PRunning()

	if other.closeHit {
		t.Fatal("RestartP2PRunning closed a non-p2p tunnel")
	}
	if got := Get("http-keep"); got != other {
		t.Fatal("non-p2p tunnel was replaced")
	}
	if !p2p.IsClosed() {
		t.Fatal("old p2p tunnel still open after restart")
	}
	next := Get("p2p-restart")
	if next == nil || next == Tunnel(p2p) || next.IsClosed() {
		t.Fatalf("p2p tunnel was not restarted: %v", next)
	}
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}
}
```

Add the same shape to `tunnel/entrypoint/entrypoint_test.go` for entrypoints
(a `fakeEntryPoint` implementing `EntryPoint` and a real p2p entrypoint), using
`EntryPoint` types `TCPEntryPoint` and `P2PEntryPoint`.

- [x] **Step 2: Run to verify they fail**

Run: `cd wisper && go test ./tunnel/ ./tunnel/entrypoint/ -run 'TestRestartP2PRunning' -count=1`
Expected: FAIL with `undefined: RestartP2PRunning`.

- [x] **Step 3: Implement the filter**

In `tunnel/tunnel.go`, change `RestartRunning` into:

```go
func RestartRunning() { restartRunning(nil) }

// RestartP2PRunning recreates the running tunnels that consume the shared p2p
// host — p2p tunnels and tun hubs — so they come back on a new identity after
// ResetP2PIdentity. Other tunnel types are left untouched.
func RestartP2PRunning() {
	restartRunning(func(t Tunnel) bool {
		switch t.Type() {
		case P2PTunnel, TunTunnel:
			return true
		}
		return false
	})
}

func restartRunning(match func(Tunnel) bool) {
	// ... existing RestartRunning body, with the loop guard extended:
	// if t == nil || t.IsClosed() || (match != nil && !match(t)) { continue }
}
```

Do the same in `tunnel/entrypoint/entrypoint.go` with
`P2PEntryPoint`/`TunEntryPoint`, preserving the existing `Start(...)` call.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd wisper && go test ./tunnel/ ./tunnel/entrypoint/ -run 'TestRestartP2PRunning' -count=1`
Expected: PASS.

---

### Task 3: Reset endpoint

**Files:**
- Modify: `api/p2p_handler.go`
- Modify: `api/server.go:159-166`
- Modify: `CLAUDE.md` route list
- Test: `api/p2p_test.go` (create if absent)

**Interfaces:**
- Consumes: `tunnel.ResetP2PIdentity()`, `tunnel.RestartP2PRunning()`,
  `entrypoint.RestartP2PRunning()`.
- Produces: `POST /api/p2p/reset` → `p2pIdentityResponse` on success.

- [x] **Step 1: Write the failing API tests**

```go
func TestResetP2PIdentityRequiresConfirmation(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	config.Set(&config.Config{Settings: &config.Settings{P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})
	_, before := getJSON(t, srv.URL+"/api/p2p")
	old := before["public_key"].(string)

	resp, body := postJSON(t, srv.URL+"/api/p2p/reset", map[string]any{})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %v)", resp.StatusCode, body)
	}
	_, after := getJSON(t, srv.URL+"/api/p2p")
	if after["public_key"] != old {
		t.Fatal("refused reset changed the key")
	}
}

func TestResetP2PIdentity(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	config.Set(&config.Config{Settings: &config.Settings{P2P: &config.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})
	_, before := getJSON(t, srv.URL+"/api/p2p")
	old := before["public_key"].(string)

	resp, body := postJSON(t, srv.URL+"/api/p2p/reset", map[string]any{"confirm": true})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %v)", resp.StatusCode, body)
	}
	got, _ := body["public_key"].(string)
	if got == "" || got == old {
		t.Fatalf("public_key = %q, want a new key (old %q)", got, old)
	}
	_, after := getJSON(t, srv.URL+"/api/p2p")
	if after["public_key"] != got {
		t.Fatalf("GET after reset = %v, want %q", after["public_key"], got)
	}
	fi, err := os.Stat(tunnel.P2PHostKeyPath())
	if err != nil {
		t.Fatalf("host.key: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("host.key mode = %o, want 600", perm)
	}
}
```

- [x] **Step 2: Run to verify failure**

Run: `cd wisper && go test ./api/ -run 'TestResetP2PIdentity' -count=1`
Expected: FAIL with 404 (route absent).

- [x] **Step 3: Implement**

In `api/p2p_handler.go`:

```go
// p2pResetRequest is the body of POST /api/p2p/reset. The explicit flag also
// forces a CORS preflight, so a plain cross-origin form POST cannot rotate the
// key.
type p2pResetRequest struct {
	Confirm bool `json:"confirm"`
}

var p2pResetMu sync.Mutex

// handleResetP2PIdentity rotates the process-wide identity and brings every
// running p2p consumer back on the new key. Peers that know the old key lose
// access until they are updated; the response carries the new key.
func handleResetP2PIdentity(w http.ResponseWriter, r *http.Request) {
	var req p2pResetRequest
	if !readJSON(w, r, &req) {
		return
	}
	if !req.Confirm {
		writeError(w, http.StatusBadRequest, "confirmation required")
		return
	}

	p2pResetMu.Lock()
	defer p2pResetMu.Unlock()

	if _, err := tunnel.ResetP2PIdentity(); err != nil {
		writeError(w, http.StatusInternalServerError, "reset p2p identity: "+err.Error())
		return
	}
	tunnel.RestartP2PRunning()
	entrypoint.RestartP2PRunning()
	handleGetP2PIdentity(w, r)
}
```

Add imports `sync` and `github.com/go-gost/wisper/tunnel/entrypoint`.
Register in `api/server.go` next to the other p2p routes:

```go
mux.HandleFunc("POST /api/p2p/reset", handleResetP2PIdentity)
```

Update the route list in `CLAUDE.md`.

- [x] **Step 4: Run to verify pass**

Run: `cd wisper && go test ./api/ -run 'TestResetP2PIdentity' -count=1`
Expected: PASS.

---

### Task 4: Settings-page control and rebuilt assets

**Files:**
- Modify: `web-src/src/api/backend.ts`
- Modify: `web-src/src/pages/settings-page.ts`
- Modify: `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`
- Rebuild: `web/assets` via `make web`

**Interfaces:**
- Consumes: `POST /api/p2p/reset`.
- Produces: `GoBackend.resetP2PIdentity()`.

- [x] **Step 1: Add the backend method**

```ts
/** Rotate the process-wide p2p identity. Every running p2p consumer restarts
 *  on the new key; peers that know the old key lose access until updated. */
resetP2PIdentity(): Promise<{ public_key: string; running: boolean }> {
  return this.request('POST', '/api/p2p/reset', { confirm: true });
}
```

- [x] **Step 2: Add the UI**

State: `_showResetKeyDialog = false`, `_resettingKey = false`.
Method:

```ts
private async _resetP2PKey() {
  this._resettingKey = true;
  try {
    const res = await this._backend.resetP2PIdentity();
    this._p2pPublicKey = res.public_key;
    this._p2pRunning = res.running;
    this._showP2PKey = true;      // the value just changed: show it
    this._showResetKeyDialog = false;
    this._showSnackbar(t('p2pKeyResetDone'));
  } catch (e) {
    this._showSnackbar(`${t('p2pKeyResetFailed')}: ${e}`);
  } finally {
    this._resettingKey = false;
  }
}
```

Below the identity warnings add:

```html
<button class="reset-key-btn" @click=${() => { this._showResetKeyDialog = true; }}>
  ${t('p2pKeyReset')}
</button>
```

Add the dialog next to the QR dialog, with title `${t('p2pKeyResetTitle')}`,
message `${t('p2pKeyResetWarning')}`, a cancel button and a
`dialog-btn danger` confirm button calling `_resetP2PKey`, disabled while
`_resettingKey`.

CSS: `.reset-key-btn` (danger-outline pill using `var(--red)`),
`.dialog-message` (muted small text), `.dialog-btn.danger` (red background,
white text) — mirror `tunnel-detail-page.ts`.

- [x] **Step 3: Add i18n keys (same keys in both files)**

```
p2pKeyReset: 'Reset key' / '重置密钥'
p2pKeyResetTitle: 'Reset P2P identity?' / '重置 P2P 身份？'
p2pKeyResetWarning: long text: a new key replaces the old one, every running
  p2p tunnel / tun hub / p2p or tun entrypoint restarts, and every peer or
  allowlist that used the old key must be updated; peers using the old key lose
  access immediately.
p2pKeyResetDone: 'New key generated' / '已生成新密钥'
p2pKeyResetFailed: 'Reset failed' / '重置失败'
btnReset: 'Reset' / '重置'
```

- [x] **Step 4: Build and verify**

Run: `cd wisper && make web`
Expected: vite build succeeds and `web/assets` is updated.
Then: `cd wisper && go build ./...`
Expected: success.

---

### Task 5: Final verification

- [x] `cd wisper && go test ./tunnel/ ./tunnel/entrypoint/ ./api/ -count=1`
- [x] `cd wisper && go vet ./...`
- [x] `cd wisper && go build ./...`
- [x] Confirm `git status` shows only intended files (plus the design/plan).
