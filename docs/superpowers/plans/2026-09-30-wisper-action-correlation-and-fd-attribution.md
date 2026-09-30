# wisper: action correlation + tun-fd attribution — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> **Commit policy:** neither repo commits without explicit user approval. The
> `git commit` steps are the *intended* commits — run them only when the user has
> said to commit. Build/vet/test are the real gates for each task.

**Goal:** two answers that today take a debugging session each — *which UI action
caused this backend/p2p log line?* and *who released the tun device?*

Design spec: [docs/superpowers/specs/2026-09-30-wisper-action-correlation-and-fd-attribution-design.md](../specs/2026-09-30-wisper-action-correlation-and-fd-attribution-design.md).
Read it before Task 1: it carries the decisions (the `Wisper-Id` header and its
generated-when-absent rule, the correlation boundary — the seam calls an action
*initiates*, never p2p's background logs — and why three ctx variants). Do not
widen the scope past it.

---

## File structure

| File | Responsibility |
|---|---|
| `p2p/endpoint/endpoint.go`, `p2p/internal/host/seam.go` | the ctx-carrying variants and the one seam log line that names the action. |
| `p2p/internal/host/action.go` (new) | `WithAction(ctx, id)` / `actionOf(ctx)` — the p2p-side half of the contract. |
| `wisper/api/server.go` | the middleware: read-or-generate `Wisper-Id`, log it, put it in the ctx. |
| `wisper/api/tunnel_handler.go`, `entrypoint_handler.go` | pass the request ctx into the lifecycle. |
| `wisper/tunnel/*.go`, `tunnel/entrypoint/*.go` | thread the ctx to `Listen`/`Warm`/`Punch`. |
| `wisper/web-src/src/api/backend.ts` | attach `Wisper-Id` to every request. |
| `wisper/android/app/src/main/java/run/gost/wisper/*.kt`, `wisper/tunnel/tunfd.go` | the fd attribution logs. |

---

## Task 1 (p2p): the ctx-carrying seam

**Files:**
- Create: `p2p/internal/host/action.go`
- Modify: `p2p/internal/host/seam.go`, `p2p/endpoint/endpoint.go`
- Test: `p2p/internal/host/action_test.go`

- [ ] **Step 1: write the failing test** — a call made with a ctx that carries an
  action logs exactly one line naming it, and a call without one logs no action
  field at all (never `action=`):

```go
func TestListenLogsTheActionFromContext(t *testing.T) {
	var buf bytes.Buffer
	h := newTestHost(t, slog.New(slog.NewTextHandler(&buf, nil)))
	if _, err := h.ListenContext(host.WithAction(context.Background(), "ab12cd34"), ...); err != nil { ... }
	if !strings.Contains(buf.String(), "action=ab12cd34") { t.Fatal(...) }
	// and: a plain Listen() must NOT emit an action field
}
```

- [ ] **Step 2: implement**

```go
// actionKey is the context key for the caller's action id: a short, opaque
// string that ties a backend log line to the UI action that caused it. p2p
// treats it as a label — it never parses it, stores it, or lets it change
// behaviour.
type actionKey struct{}

// WithAction returns ctx carrying id, so the seam calls made with it name the
// action in their log line. An empty id is ignored.
func WithAction(ctx context.Context, id string) context.Context

// actionOf reads the action id, or "".
func actionOf(ctx context.Context) string
```

`Host.ListenContext(ctx)`, `Host.WarmContext(ctx, peer)`,
`Host.PunchContext(ctx, peer)` (each a thin wrapper over the existing method,
logging `action=<id>` once at entry), and on `endpoint`:
`ListenContext(ctx)`, `WarmContext(ctx, peer)`, `PunchContext(ctx, peer)`.
Keep the existing no-ctx methods — they are the third-party API and stay
unchanged; the ctx variants are additive.

(Three variants, not the two first agreed: spec decision 3 — `AddForward` is a
CLI-only path with no UI action behind it. Dropping `PunchContext` is the
fallback if the smaller surface is preferred.)

- [ ] **Step 3: verify** — `cd p2p && go build ./... && go vet ./... && gofmt -l .`
  and `TMPDIR=/config/tmp CGO_ENABLED=1 go test -race -count=1 ./internal/host/ ./endpoint/`

- [ ] **Step 4: commit (gated)** — `p2p`: one commit for the seam + tests.

---

## Task 2 (wisper): the middleware

**Files:** `api/server.go`, `api/actionid.go` (new), tests in `api/api_test.go`

- [ ] **Step 1: write the failing test** — POST with `Wisper-Id: abc123` logs
  `id=abc123`; POST **without** the header still logs an `id=` (generated, 8 hex
  chars); two requests get different generated ids.

- [ ] **Step 2: implement** — in `logMutations`, before the debug line:

```go
// actionID is the header a UI action carries so its backend log line can be
// joined with the click. It is not auth and never influences behaviour: an
// absent header gets a generated id, so a curl is still correlatable.
const actionHeader = "Wisper-Id"
```

read it, else generate `crypto/rand` 4 bytes hex; log `"id", id`; store it in
the request context (`r = r.WithContext(...)`) via the same
`host.WithAction`-shaped helper wisper owns — `api.WithActionID(ctx, id)` /
`api.ActionID(ctx)` — so no wisper package has to import p2p for this.

- [ ] **Step 3: verify** — `go build ./... && go vet ./... && gofmt -l .` +
  `CGO_ENABLED=1 go test -race ./api/`

- [ ] **Step 4: commit (gated)**

---

## Task 3 (wisper): thread it to the p2p calls

**Files:** `api/tunnel_handler.go`, `api/entrypoint_handler.go`, `tunnel/p2p_host.go`,
`tunnel/entrypoint/*.go`

- [ ] **Step 1: write the failing test** — the start path passes the action id to
  the p2p call: an in-package test with a fake/observable seam (or an assertion
  on the log stream) shows `action=<id>` on the p2p line for a start request
  that carried the header. If the seam is not injectable, assert on the captured
  slog output of a real `p2pHostManager` start.

- [ ] **Step 2: implement** — `warmPeers(peers []string)` becomes
  `warmPeers(ctx context.Context, peers []string)` and calls
  `host.WarmContext(ctx, peer)`; the entrypoint's `host.Listen()` →
  `ListenContext(ctx)`, `host.Punch(peer)` → `PunchContext(ctx, peer)`. Thread
  `ctx` from the handlers through whatever `tunnel.Register`/`Start` path
  reaches them — passing `context.Background()` anywhere is a bug in this task.

- [ ] **Step 3: verify** — build/vet/gofmt + `go test -race ./api/ ./tunnel/...`
  (per package; `CGO_ENABLED=1`), plus `scripts/ui-test.sh` (the API shape did not
  change, so the UI suite must stay green).

- [ ] **Step 4: commit (gated)**

---

## Task 4 (wisper web): send the header

**Files:** `web-src/src/api/backend.ts`, `web-e2e/tests/*.spec.ts`

- [ ] **Step 1: implement** — in `GoBackend.request`, add
  `'Wisper-Id': actionId()` to the headers, where `actionId()` returns a fresh
  short id per request (`crypto.randomUUID().slice(0, 8)` with a
  `Math.random` fallback for older webviews).

- [ ] **Step 2: verify** — `make web && (cd web-src && npx tsc --noEmit)` and
  `make ui-test`. Add one assertion to an existing spec: a mutation (e.g. the
  entrypoint stop) still succeeds — the header must not break the API.

- [ ] **Step 3: commit (gated)** — `web:` one commit (the rebuilt `web/` included).

---

## Task 5 (wisper android + go): who released the tun fd

**Files:**
- Modify: `android/app/src/main/java/run/gost/wisper/TunVpnService.kt` (sites at
  `:91` establish, `:105` clear, `:117` `onRevoke`),
  `android/app/src/main/java/run/gost/wisper/WisperService.kt` (`:268` clear),
  `tunnel/tunfd.go` (`SetTunFD`, `WaitTunFD`)

- [ ] **Step 1: implement** — every one of those call sites gets one log line
  naming *itself* as the caller, with the fd and the reason:

```kotlin
// Logcat, not the wisper log: this is the Android side, and "who took the
// device" is asked while reading logcat adb-side.
Log.i("wisper-tunfd", "release: TunVpnService.onRevoke (system revoked)")
```

and on the Go side `SetTunFD` logs the fd it was handed (or the release, at
info), so the Go and Kotlin timelines can be read together.

- [ ] **Step 2: verify** — no Kotlin toolchain locally: build the APK
  (`make android`, `--network host`, retry on EOF)), install
  (`adb install -r --no-incremental`, test APK re-signed with
  `/config/tmp/apkwork/sign-only.sh`), then on the device: start the tun
  entrypoint, stop it, and confirm logcat (`adb logcat -s wisper-tunfd`) names
  `WisperService.kt` as the releaser while the entrypoint's own stop is what
  triggered it. **The real Pixel 9 is currently attached at
  `192.168.100.4:39455` (use `adb mdns services` if the port changed) — this task
  is verified on it, not in the emulator.**

- [ ] **Step 3: commit (gated)** — `android:` one commit.

---

## Task 6: docs

- [ ] `wisper/README.md` (REST API table note) + `CLAUDE.md`: the `Wisper-Id`
  header, its generated-when-absent behaviour, and that it is a *label*, never
  auth.
- [ ] `p2p/CLAUDE.md`: the ctx variants + `WithAction` note (one short paragraph),
  and that the seam logs the action while the engine's background logs do not.
- [ ] Verify: build/vet/gofmt in both repos, `scripts/ui-test.sh`, and (p2p)
  the per-package test run.

## Verification summary (run before reporting done)

```bash
cd p2p    && go build ./... && go vet ./... && gofmt -l . \
          && TMPDIR=/config/tmp CGO_ENABLED=1 go test -race -count=1 ./internal/host/ ./endpoint/ ./grpc/
cd wisper && go build ./... && GOWORK=off go build ./... && go vet ./... && gofmt -l . \
          && CGO_ENABLED=1 go test -race ./api/ ./tunnel/... \
          && make web && (cd web-src && npx tsc --noEmit) && make ui-test
```

(The `GOWORK=off` build stays red until the pending release bumps the pins — see
the release step in `p2p/docs/2026-09-30-p2p-peer-diagnostics-plan.md`.)
