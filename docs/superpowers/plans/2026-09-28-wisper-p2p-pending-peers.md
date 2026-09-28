# Pending peers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the peer keys that knocked on the p2p host without being on any allowlist, and let the user add one to the tunnel whose peers page is open, or dismiss the record.

**Architecture:** The shared p2p host manager records a knock in memory when `dispatch()` finds no route for an incoming stream's peer key (deduped, 32 entries max, 10-minute TTL, cleared when the host stops). Two `/api/p2p/pending` endpoints expose and dismiss those records, filtering out any key some tunnel already lists. The peers page renders them in a card above the allowlist and reuses the existing in-place `SetPeers` save for "add".

**Tech Stack:** Go 1.26 (wisper module, `github.com/go-gost/x` for the registry and service plumbing), Lit + TypeScript web UI, `net/http/httptest` for the API tests.

**Spec:** `docs/superpowers/specs/2026-09-28-p2p-pending-peers-design.md`

**Commits:** the repo owner asks for commits explicitly. Each "Commit" step is a checkpoint — run it when asked, do not commit on your own initiative.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `tunnel/p2p_host.go` | modify | `pendingPeer` / `PendingPeer` records, `notePending`, `pendingSnapshot`, `dismissPending`, `P2PPendingPeers`, `DismissPendingPeer`; hooks in `dispatch()` and `release()` |
| `tunnel/p2p_host_test.go` | modify | recording, counting, TTL, bound, dispatch wiring, host teardown, allowlist filtering |
| `api/p2p_handler.go` | modify | `handleListPendingPeers`, `handleDismissPendingPeer` |
| `api/server.go` | modify | the two routes |
| `api/api_test.go` | modify | handler contract, including idempotent dismiss |
| `web-src/src/api/types.ts` | modify | `PendingPeer` type |
| `web-src/src/api/backend.ts` | modify | `listPendingPeers`, `dismissPendingPeer` |
| `web-src/src/pages/tunnel-peers-page.ts` | modify | the card, add/dismiss handlers, pending refresh |
| `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts` | modify | 7 keys |

---

### Task 1: Record, expire and dismiss knocks on the host manager

**Files:**
- Modify: `tunnel/p2p_host.go`
- Test: `tunnel/p2p_host_test.go`

- [ ] **Step 1: Write the failing test**

Append to `tunnel/p2p_host_test.go`:

```go
// knock drives one refused inbound stream through the real path: a pipe conn
// whose RemoteAddr is the peer key, the way the p2p listener presents it.
func knock(m *p2pHostManager, key string) {
	inbound, far := peerPipe(key)
	defer far.Close()
	m.dispatch(inbound)
}

// TestPendingPeersRecordAndDismiss: one entry per key, counted across knocks,
// forgotten on request, and its absence is not an error.
func TestPendingPeersRecordAndDismiss(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}
	const key = "kQ7Zm0Q0Y2r0k9v2mQm1Z2yq8S5w1Kc3x7bN0rH4tUg"

	knock(m, key)
	knock(m, key)

	got := m.pendingSnapshot()
	if len(got) != 1 {
		t.Fatalf("pending = %d entries, want 1: one entry per key", len(got))
	}
	if got[0].Key != key || got[0].Attempts != 2 {
		t.Fatalf("pending = %+v, want key %s with 2 attempts", got[0], key)
	}
	if got[0].FirstSeen.IsZero() || got[0].LastSeen.Before(got[0].FirstSeen) {
		t.Fatalf("timestamps = %v/%v, want the first at or before the last", got[0].FirstSeen, got[0].LastSeen)
	}

	if !m.dismissPending(key) {
		t.Error("dismissPending = false for a key that knocked")
	}
	if m.dismissPending(key) {
		t.Error("dismissPending = true for a key that is not recorded")
	}
	if n := len(m.pendingSnapshot()); n != 0 {
		t.Fatalf("pending = %d entries after dismiss, want 0", n)
	}
}

// TestPendingPeersExpireAndEvict: the list is a notice, not a log — an entry
// past the TTL is gone, and the list cannot be grown past its bound by anyone
// who can reach the relay.
func TestPendingPeersExpireAndEvict(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}
	now := time.Now()

	m.notePending("stale")
	m.pending["stale"] = &pendingPeer{
		Key:       "stale",
		FirstSeen: now.Add(-2 * p2pPendingTTL),
		LastSeen:  now.Add(-2 * p2pPendingTTL),
		Attempts:  1,
	}
	if n := len(m.pendingSnapshot()); n != 0 {
		t.Fatalf("pending = %d entries, want 0: a knock older than the TTL is retired", n)
	}

	for i := 0; i < p2pPendingMax; i++ {
		key := fmt.Sprintf("key-%02d", i)
		m.notePending(key)
		m.pending[key].LastSeen = now.Add(time.Duration(i) * time.Second)
	}
	m.notePending("newest")

	if n := len(m.pending); n != p2pPendingMax {
		t.Fatalf("pending holds %d entries, want the cap %d", n, p2pPendingMax)
	}
	if _, ok := m.pending["key-00"]; ok {
		t.Error("the least recently seen knock was not evicted")
	}
	if _, ok := m.pending["newest"]; !ok {
		t.Error("the new knock was not recorded")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./tunnel/ -run 'TestPendingPeers' -v`
Expected: FAIL — `undefined: pendingPeer`, `undefined: p2pPendingTTL`, `m.pendingSnapshot undefined`.

- [ ] **Step 3: Implement the records**

In `tunnel/p2p_host.go`, add to the imports: `"slices"` (the file already imports `time`).

Add the constants and types next to `p2pBacklog`:

```go
const (
	// p2pPendingTTL is how long a refused knock stays listed after the last
	// one. The record is a nudge to act on, not a log.
	p2pPendingTTL = 10 * time.Minute
	// p2pPendingMax bounds the list. Anyone who can reach the relay can append
	// to it by connecting, so it must not be able to grow.
	p2pPendingMax = 32
)

// pendingPeer is one key that knocked while on no allowlist: the record behind
// a "requesting peer" row.
type pendingPeer struct {
	Key       string
	FirstSeen time.Time
	LastSeen  time.Time
	Attempts  int
}

// PendingPeer is a refused knock as the API reads it.
type PendingPeer struct {
	Key       string
	FirstSeen time.Time
	LastSeen  time.Time
	Attempts  int
}
```

Add the `pending` map to `p2pHostManager`:

```go
type p2pHostManager struct {
	mu      sync.Mutex
	host    *endpoint.Endpoint
	ln      net.Listener
	routes  map[string]*peerListener
	pending map[string]*pendingPeer
	refs    int
}
```

Add the methods after `release()`:

```go
// notePending records a refused knock. Safe to call without the lock: dispatch
// has already dropped it by the time it gets here.
func (m *p2pHostManager) notePending(key string) {
	if key == "" {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	if m.pending == nil {
		m.pending = make(map[string]*pendingPeer)
	}
	m.expirePendingLocked(now)

	if p := m.pending[key]; p != nil {
		p.LastSeen, p.Attempts = now, p.Attempts+1
		return
	}
	if len(m.pending) >= p2pPendingMax {
		m.evictOldestPendingLocked()
	}
	m.pending[key] = &pendingPeer{Key: key, FirstSeen: now, LastSeen: now, Attempts: 1}
}

// expirePendingLocked retires the entries whose last knock is past the TTL.
// Lazy on read and on write: a sweeper goroutine would outlive every reason to
// have one.
func (m *p2pHostManager) expirePendingLocked(now time.Time) {
	for key, p := range m.pending {
		if now.Sub(p.LastSeen) > p2pPendingTTL {
			delete(m.pending, key)
		}
	}
}

// evictOldestPendingLocked makes room by dropping the least recently seen
// entry.
func (m *p2pHostManager) evictOldestPendingLocked() {
	var oldest string
	var at time.Time
	for key, p := range m.pending {
		if oldest == "" || p.LastSeen.Before(at) {
			oldest, at = key, p.LastSeen
		}
	}
	delete(m.pending, oldest)
}

// pendingSnapshot copies the refused knocks out, newest first.
func (m *p2pHostManager) pendingSnapshot() []PendingPeer {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.expirePendingLocked(time.Now())

	out := make([]PendingPeer, 0, len(m.pending))
	for _, p := range m.pending {
		out = append(out, PendingPeer{
			Key:       p.Key,
			FirstSeen: p.FirstSeen,
			LastSeen:  p.LastSeen,
			Attempts:  p.Attempts,
		})
	}
	slices.SortFunc(out, func(a, b PendingPeer) int { return b.LastSeen.Compare(a.LastSeen) })
	return out
}

// dismissPending forgets one knock, reporting whether there was one.
func (m *p2pHostManager) dismissPending(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.pending[key]; !ok {
		return false
	}
	delete(m.pending, key)
	return true
}
```

Add `"fmt"` to the test file's imports — it is not there today, and Step 1 uses `fmt.Sprintf`. The other imports it needs (`time`, `cfg`) are already present.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./tunnel/ -run 'TestPendingPeers' -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add tunnel/p2p_host.go tunnel/p2p_host_test.go
git commit -m "p2p: record the peers that knocked and were refused"
```

---

### Task 2: Hook the records into the host's lifetime and the allowlists

**Files:**
- Modify: `tunnel/p2p_host.go`
- Test: `tunnel/p2p_host_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `tunnel/p2p_host_test.go`:

```go
// TestPendingPeersClearedWithHost: with no host running nobody can knock, so
// the records go with it rather than outliving their reason to exist.
func TestPendingPeersClearedWithHost(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})

	if _, err := AcquireP2PHost(); err != nil {
		t.Fatalf("AcquireP2PHost: %v", err)
	}
	p2pHost.notePending("kQ7Zm0Q0Y2r0k9v2mQm1Z2yq8S5w1Kc3x7bN0rH4tUg")
	if n := len(p2pHost.pendingSnapshot()); n != 1 {
		t.Fatalf("pending = %d entries before release, want 1", n)
	}

	ReleaseP2PHost()

	if n := len(p2pHost.pendingSnapshot()); n != 0 {
		t.Fatalf("pending = %d entries after the host stopped, want 0", n)
	}
}

// TestP2PPendingPeersFiltersListedKeys: a key another tunnel lists — or this
// one lists as disabled, which keeps it off the host's route table too — is not
// a requesting peer. It already has a row of its own on the peers page.
func TestP2PPendingPeersFiltersListedKeys(t *testing.T) {
	t.Chdir(t.TempDir()) // Delete/SaveConfig reach for ./wisper.yaml without a config dir
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	const (
		listed  = "key-listed"
		off     = "key-disabled"
		unknown = "key-unknown"
	)

	tun := NewP2PTunnel(
		IDOption("pending-filter"),
		PeersOption(listed, off),
		PeerDisabledOption([]string{off}),
	)
	Add(tun)
	defer Delete("pending-filter")

	p2pHost.notePending(listed)
	p2pHost.notePending(off)
	p2pHost.notePending(unknown)
	defer func() {
		p2pHost.dismissPending(listed)
		p2pHost.dismissPending(off)
		p2pHost.dismissPending(unknown)
	}()

	got := P2PPendingPeers()
	if len(got) != 1 || got[0].Key != unknown {
		t.Fatalf("pending = %+v, want only %s", got, unknown)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./tunnel/ -run 'TestPendingPeersClearedWithHost|TestP2PPendingPeersFiltersListedKeys' -v`
Expected: FAIL — the first with `pending = 1 entries after the host stopped, want 0`, the second with `undefined: P2PPendingPeers`.

- [ ] **Step 3: Implement the hooks**

In `tunnel/p2p_host.go`, in `release()`, drop the records with the routes — the function already holds `m.mu` there:

```go
	_ = m.host.Close()
	m.host, m.ln = nil, nil
	m.pending = nil
	for k, pl := range m.routes {
		pl.close()
		delete(m.routes, k)
	}
```

`dispatch()` already records the knock (Task 1's tests drive that path, so the hook went in with the records). Confirm it reads like this — no edit should be needed here:

```go
func (m *p2pHostManager) dispatch(conn net.Conn) {
	peer := peerOf(conn)
	m.mu.Lock()
	pl := m.routes[peer]
	m.mu.Unlock()
	if pl == nil {
		slog.Warn("p2p inbound stream from unregistered peer: closed", "peer", peer)
		// The key is the whole of what a knock tells us: a p2p stream carries
		// no destination, so which tunnel it wanted is unknowable here.
		m.notePending(peer)
		_ = conn.Close()
		return
	}
	pl.deliver(conn)
}
```

Add the two package-level functions next to `P2PHostRunning()`:

```go
// P2PPendingPeers returns the keys that knocked and are on no allowlist,
// newest first. Keys any tunnel lists — enabled or disabled — are dropped: a
// disabled peer is off the host's route table too, so its streams land in the
// record path, and it already has a row of its own on the peers page.
func P2PPendingPeers() []PendingPeer {
	known := make(map[string]struct{})
	for i := 0; i < Count(); i++ {
		t := GetIndex(i)
		if t == nil {
			continue
		}
		opts := t.Options()
		for _, k := range opts.Peers {
			known[k] = struct{}{}
		}
		for _, k := range opts.PeerDisabled {
			known[k] = struct{}{}
		}
	}

	out := p2pHost.pendingSnapshot()
	kept := out[:0] // same array, filtered in place
	for _, p := range out {
		if _, listed := known[p.Key]; !listed {
			kept = append(kept, p)
		}
	}
	return kept
}

// DismissPendingPeer forgets one knock, reporting whether there was one.
func DismissPendingPeer(key string) bool { return p2pHost.dismissPending(key) }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./tunnel/ -run 'TestPendingPeers|TestP2PPendingPeers' -v`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add tunnel/p2p_host.go tunnel/p2p_host_test.go
git commit -m "p2p: a knock list that dies with the host and ignores known keys"
```

---

### Task 3: Serve the list

**Files:**
- Modify: `api/p2p_handler.go`, `api/server.go`
- Test: `api/api_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `api/api_test.go`:

```go
// TestPendingPeersEndpoint: the handler contract. The recording path itself
// (a knock reaching dispatch) is covered in the tunnel package — from out here
// there is no way to make one, so what is checked here is the shape and the
// dismiss semantics.
func TestPendingPeersEndpoint(t *testing.T) {
	ts := setupTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/p2p/pending")
	if err != nil {
		t.Fatalf("GET /api/p2p/pending: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}

	var body struct {
		Peers []struct {
			Key       string `json:"key"`
			FirstSeen string `json:"first_seen"`
			LastSeen  string `json:"last_seen"`
			Attempts  int    `json:"attempts"`
		} `json:"peers"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Peers) != 0 {
		t.Fatalf("peers = %d, want 0 on a fresh server", len(body.Peers))
	}
}

// TestDismissPendingPeerEndpoint: dismissing is idempotent — a key the TTL (or
// an earlier dismiss) already retired is still a 200, because the caller's
// intent, that the key not be listed, holds either way.
func TestDismissPendingPeerEndpoint(t *testing.T) {
	ts := setupTestServer(t)
	defer ts.Close()

	for i := 0; i < 2; i++ {
		req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/p2p/pending/kQ7Zm0Q0Y2r0k9v2mQm1Z2yq8S5w1Kc3x7bN0rH4tUg", nil)
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("DELETE (attempt %d): %v", i+1, err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("attempt %d: status = %d, want 200", i+1, res.StatusCode)
		}
	}
}
```

`api/api_test.go` already imports everything these two tests need (`encoding/json`, `net/http`, `testing`), so no import changes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./api/ -run 'TestPendingPeersEndpoint|TestDismissPendingPeerEndpoint' -v`
Expected: FAIL with `404` — the routes do not exist yet.

- [ ] **Step 3: Implement the handlers**

Append to `api/p2p_handler.go` (add `"time"` to its imports):

```go
// pendingPeerResponse is one refused knock as the UI reads it.
type pendingPeerResponse struct {
	Key       string `json:"key"`
	FirstSeen string `json:"first_seen"`
	LastSeen  string `json:"last_seen"`
	Attempts  int    `json:"attempts"`
}

// pendingPeersResponse is the whole list; the field is always present, empty or
// not, so a client can render it without a nil check.
type pendingPeersResponse struct {
	Peers []pendingPeerResponse `json:"peers"`
}

// handleListPendingPeers lists the keys that knocked without being on any
// tunnel's allowlist, newest first. The list is process-wide: a p2p stream
// carries no destination, so a knock cannot be attributed to a tunnel.
func handleListPendingPeers(w http.ResponseWriter, r *http.Request) {
	peers := tunnel.P2PPendingPeers()
	out := make([]pendingPeerResponse, 0, len(peers))
	for _, p := range peers {
		out = append(out, pendingPeerResponse{
			Key:       p.Key,
			FirstSeen: p.FirstSeen.UTC().Format("2006-01-02T15:04:05Z"),
			LastSeen:  p.LastSeen.UTC().Format("2006-01-02T15:04:05Z"),
			Attempts:  p.Attempts,
		})
	}
	writeJSON(w, http.StatusOK, pendingPeersResponse{Peers: out})
}

// handleDismissPendingPeer forgets one knock. Idempotent: an entry that is
// already gone is still a 200.
func handleDismissPendingPeer(w http.ResponseWriter, r *http.Request) {
	tunnel.DismissPendingPeer(r.PathValue("key"))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

In `api/server.go`, after the existing `/api/p2p` routes:

```go
	mux.HandleFunc("GET /api/p2p/pending", handleListPendingPeers)
	mux.HandleFunc("DELETE /api/p2p/pending/{key}", handleDismissPendingPeer)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./api/ -run 'TestPendingPeersEndpoint|TestDismissPendingPeerEndpoint' -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add api/p2p_handler.go api/server.go api/api_test.go
git commit -m "api: serve the peer knock list"
```

---

### Task 4: Teach the web client the two calls

**Files:**
- Modify: `web-src/src/api/types.ts`, `web-src/src/api/backend.ts`

- [ ] **Step 1: Add the type**

In `web-src/src/api/types.ts`, next to the other response types:

```ts
/** One key that knocked on the p2p host without being on any allowlist. */
export interface PendingPeer {
  key: string;
  first_seen: string;
  last_seen: string;
  attempts: number;
}
```

- [ ] **Step 2: Add the two methods**

In `web-src/src/api/backend.ts`, import the type (`import type { ..., PendingPeer } from './types';`) and add to the P2P section, after `testP2PStun`:

```ts
  /** Keys that knocked on the shared host without being on any tunnel's
   *  allowlist, newest first. The list is process-wide: a p2p stream carries
   *  no destination, so a knock cannot be attributed to a tunnel. */
  listPendingPeers(): Promise<{ peers: PendingPeer[] }> {
    return this.request('GET', '/api/p2p/pending');
  }

  /** Forget one knock. The peer is refused either way — this only clears the
   *  notice — so an unknown key is not an error. */
  dismissPendingPeer(key: string): Promise<void> {
    return this.request('DELETE', `/api/p2p/pending/${encodeURIComponent(key)}`);
  }
```

- [ ] **Step 3: Type-check**

Run: `make typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web-src/src/api/types.ts web-src/src/api/backend.ts
git commit -m "ui: the client calls for the peer knock list"
```

---

### Task 5: The requesting-peers card

**Files:**
- Modify: `web-src/src/pages/tunnel-peers-page.ts`, `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`

- [ ] **Step 1: Add the i18n keys**

In `web-src/src/i18n/en.ts`, after the existing `peers*` keys:

```ts
  peersPendingTitle: 'Requesting peers',
  peersPendingAdd: 'Add to this tunnel',
  peersPendingDismiss: 'Dismiss',
  peersPendingAttempts: '{n} attempts',
  peersPendingJustNow: 'just now',
  peersPendingMinutes: '{n} min ago',
  peersPendingHint:
    'These keys knocked but are on no allowlist. A p2p stream carries no destination, so which tunnel they wanted is unknown — Add puts the key on this one.',
```

In `web-src/src/i18n/zh.ts`, at the same place:

```ts
  peersPendingTitle: '请求接入',
  peersPendingAdd: '加到这条隧道',
  peersPendingDismiss: '忽略',
  peersPendingAttempts: '{n} 次',
  peersPendingJustNow: '刚刚',
  peersPendingMinutes: '{n} 分钟前',
  peersPendingHint:
    '这些公钥敲过门，但不在任何白名单里。p2p 流不带目的地，无法得知它想连哪条隧道——「加到这条隧道」就是把它加到这里。',
```

- [ ] **Step 2: Fetch the list with the page's own refresh**

In `web-src/src/pages/tunnel-peers-page.ts`:

Add `import { GoBackend } from '../api/backend';` and `import type { Peer, PendingPeer, Tunnel } from '../api/types';` (replacing the existing `Peer, Tunnel` import line).

Add the backend and the state next to the existing fields:

```ts
  private _backend = new GoBackend();
  /** Keys that knocked and are on no allowlist. Process-wide, so it is fetched
   *  here rather than read from the tunnel store. */
  @state() private _pending: PendingPeer[] = [];
```

Extend `_load()`:

```ts
  private _load() {
    const t2 = getTunnels().find(x => x.id === this.tunnelId) ?? null;
    this._tunnel = t2;
    this._rows = rowsOf(t2);
    void this._loadPending();
  }

  /** A failed fetch keeps the last list and changes nothing else: the rows this
   *  page exists for are unaffected. */
  private async _loadPending() {
    try {
      this._pending = (await this._backend.listPendingPeers()).peers ?? [];
    } catch {
      // Leave the previous list in place.
    }
  }
```

- [ ] **Step 3: Render the card and wire the two actions**

In the same file, add the handlers next to `_toggleRow`:

```ts
  /** _addPending puts a requesting key on this tunnel's list: the peers page is
   *  the attribution — the knock itself does not say which tunnel it wanted. */
  private _addPending = async (key: string) => {
    if (await this._save([...this._rows, { key, alias: '', disabled: false }])) {
      this._pending = this._pending.filter(p => p.key !== key);
    }
  };

  private _dismissPending = async (key: string) => {
    try {
      await this._backend.dismissPendingPeer(key);
      this._pending = this._pending.filter(p => p.key !== key);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      this._showSnackbar(`${t('saveFailed')}${msg ? ': ' + msg : ''}`);
    }
  };

  /** _ago keeps the row's age coarse: an entry is gone ten minutes after its
   *  last knock, so minutes are the whole resolution that matters. */
  private _ago(iso: string): string {
    const secs = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (secs < 60) return t('peersPendingJustNow');
    return t('peersPendingMinutes', { n: Math.floor(secs / 60) });
  }
```

In `render()`, inside the `${t2 ? html\`...\` : ...}` branch, immediately before the allowlist's `<div class="section">`, insert:

```ts
            ${this._pending.length > 0
              ? html`
                <div class="section">
                  <div class="card">
                    <div class="pending-head">
                      ${t('peersPendingTitle')} (${this._pending.length})
                    </div>
                    ${this._pending.map(p => html`
                      <div class="peer-row">
                        <div class="row-line">
                          <span class="peer-key">${this._showKeys ? p.key : maskKey(p.key)}</span>
                          <span class="peer-age">
                            ${t('peersPendingAttempts', { n: p.attempts })} · ${this._ago(p.last_seen)}
                          </span>
                          <span class="row-actions">
                            <button class="icon-btn accent" title="${t('peersPendingAdd')}"
                              ?disabled=${this._saving}
                              @click=${() => this._addPending(p.key)}>
                              ${icon('plus')}
                            </button>
                            <button class="icon-btn" title="${t('peersPendingDismiss')}"
                              @click=${() => this._dismissPending(p.key)}>
                              ${icon('close')}
                            </button>
                          </span>
                        </div>
                      </div>
                    `)}
                    <div class="hint">${t('peersPendingHint')}</div>
                  </div>
                </div>
              `
              : nothing}
```

Add the two styles to the component's `static styles`, next to `.peer-key`:

```css
    .pending-head {
      font-weight: 600;
      padding: 4px 0 8px;
    }
    .peer-age {
      color: var(--text-secondary);
      font-size: var(--font-xs);
      white-space: nowrap;
    }
```

- [ ] **Step 4: Type-check and build**

Run: `make typecheck`
Expected: no errors.

Run: `make web`
Expected: `Building Lit web UI (Vite + TypeScript)...` then `Web build complete` — the stamp check sees the edited sources, so it rebuilds rather than skipping.

- [ ] **Step 5: Verify by hand**

Start `./wisper` with a p2p tunnel configured, open the tunnel's peers page, and confirm the card renders only when a knock is pending. A knock can be made from another machine by running a p2p entrypoint pointed at this host's key without being on the allowlist. Confirm: the row's key respects the reveal toggle, Add saves the key (the row moves to the allowlist and the card disappears), Dismiss removes it, and the list is empty after ten minutes of no knocks.

- [ ] **Step 6: Commit**

```bash
git add web-src/src/pages/tunnel-peers-page.ts web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "ui: the peers page answers the peers that knocked"
```

---

### Task 6: Full verification

**Files:** none — this task only runs checks.

- [ ] **Step 1: Build and vet everything touched**

Run: `go build ./... && go vet ./tunnel/... ./api/`
Expected: no output.

- [ ] **Step 2: Run the affected packages**

Run: `go test ./tunnel/... ./api/ ./config/`
Expected: `ok` for each.

- [ ] **Step 3: Run the concurrency-sensitive ones under the race detector**

Run: `CGO_ENABLED=1 go test -race ./tunnel/... ./api/`
Expected: `ok` for each. `CGO_ENABLED=1` is required or the race detector is silently skipped on this platform.

- [ ] **Step 4: Type-check the web UI**

Run: `make typecheck`
Expected: no errors.

---

## Notes for the implementer

- **The pending list is deliberately not persisted.** The config file is rewritten every second by the stats task, and the list is only meaningful while a host is running. Do not add it to `config.Config`.
- **Do not add a "deny" state.** An unknown peer is already refused — nothing on no allowlist gets a route — so a deny list could only silence the notice. The allowlist already models "listed but switched off".
- **`dispatch` is the only writer.** If you need a pending entry in a test outside the `tunnel` package, drive a real knock or test the layer that owns the record; do not export a setter for tests.
