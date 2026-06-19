# Unified Version Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the git tag the single source of truth for the version number across the Go binary, web UI, Android APK, and Tauri desktop app — eliminating the seven hand-maintained, drifting version strings.

**Architecture:** CI derives a bare semver (tag minus the `v` prefix) and injects it into the Go binary (ldflags), Android (`versionName` + computed `versionCode`), and Tauri (`tauri.conf.json`). The web Settings page reads the version at runtime from a new `GET /api/version` endpoint instead of a hardcoded literal. Local/dev builds fall back to `0.0.0-dev` via `git describe`.

**Tech Stack:** Go 1.22 `ServeMux`, Lit + TypeScript (Vite), GitHub Actions, goreleaser, Gradle (Android), Tauri 2.

**Spec:** `docs/superpowers/specs/2026-06-19-unified-version-management-design.md`

---

## File Structure

**Create:**
- `api/version_handler.go` — `handleGetVersion` handler returning `{"version": "..."}`
- `api/version_test.go` — test for the endpoint

**Modify:**
- `version/version.go` — dev fallback `0.1.0` → `0.0.0-dev`
- `api/server.go` — register `GET /api/version`
- `web-src/src/api/types.ts` — add `VersionInfo` interface
- `web-src/src/api/backend.ts` — add `getVersion()`
- `web-src/src/pages/settings-page.ts` — fetch + render version, drop hardcoded `v1.0.0`
- `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts` — add `appSubtitle` key
- `Makefile` — derive `VERSION` from `git describe`
- `src-tauri/tauri.conf.json` — local-dev placeholder `0.0.0-dev`
- `android/app/build.gradle.kts` — local-dev placeholder `versionName`
- `.github/workflows/release.yml` — Windows prefix fix, Android versionCode, Linux Tauri version + sidecar VERSION

---

### Task 1: Backend `GET /api/version` endpoint (TDD)

**Files:**
- Create: `api/version_handler.go`
- Create test: `api/version_test.go`
- Modify: `api/server.go:76` (register route)

- [ ] **Step 1: Write the failing test**

Create `api/version_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-gost/wisper/version"
)

func TestGetVersion(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/version")
	if err != nil {
		t.Fatalf("GET /api/version: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var got map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	if got["version"] != version.Version {
		t.Errorf("version = %q, want %q", got["version"], version.Version)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./api/ -run TestGetVersion -v`
Expected: FAIL — `GET /api/version` returns 404 (route not registered) → status 404, not 200.

- [ ] **Step 3: Write the handler**

Create `api/version_handler.go`:

```go
package api

import (
	"net/http"

	"github.com/go-gost/wisper/version"
)

// versionResponse is the JSON representation of the running app version.
type versionResponse struct {
	Version string `json:"version"`
}

// handleGetVersion returns the build version of the running Wisper binary.
// The version is injected at build time via -ldflags; in dev builds it is
// "0.0.0-dev".
func handleGetVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, versionResponse{Version: version.Version})
}
```

- [ ] **Step 4: Register the route**

In `api/server.go`, add the route next to the other GET endpoints. Find this block (around line 76):

```go
	// Stats and config
	mux.HandleFunc("GET /api/stats", handleGetStats)
	mux.HandleFunc("GET /api/config", handleGetConfig)
	mux.HandleFunc("PUT /api/config", handleUpdateConfig)
```

Change it to:

```go
	// Stats, config, and version
	mux.HandleFunc("GET /api/stats", handleGetStats)
	mux.HandleFunc("GET /api/config", handleGetConfig)
	mux.HandleFunc("PUT /api/config", handleUpdateConfig)
	mux.HandleFunc("GET /api/version", handleGetVersion)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./api/ -run TestGetVersion -v`
Expected: PASS.

- [ ] **Step 6: Run the full API suite to confirm no regression**

Run: `go test ./api/ -v`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add api/version_handler.go api/version_test.go api/server.go
git commit -m "feat(api): add GET /api/version endpoint"
```

---

### Task 2: Dev-fallback version string

**Files:**
- Modify: `version/version.go`

- [ ] **Step 1: Change the default version**

In `version/version.go`, change:

```go
// Version is the current version of Wisper.
var Version = "0.1.0"
```

to:

```go
// Version is the current version of Wisper. It is overridden at release build
// time via -ldflags "-X ...version.Version=<tag>" (see .goreleaser.yaml and
// .github/workflows/release.yml). The default is a dev marker so an unbuilt
// or `go run` binary is obviously not a release.
var Version = "0.0.0-dev"
```

- [ ] **Step 2: Verify the endpoint test still passes (it reads this var)**

Run: `go test ./api/ -run TestGetVersion -v && go build -o /tmp/wisper . && /tmp/wisper -version`
Expected: test PASS; `-version` prints `wisper 0.0.0-dev`.

- [ ] **Step 3: Commit**

```bash
git add version/version.go
git commit -m "chore(version): default to 0.0.0-dev for non-release builds"
```

---

### Task 3: Web API client — `getVersion()` + `VersionInfo` type

**Files:**
- Modify: `web-src/src/api/types.ts`
- Modify: `web-src/src/api/backend.ts:147` (add method)

- [ ] **Step 1: Add the `VersionInfo` type**

In `web-src/src/api/types.ts`, append a new interface (after the existing types):

```ts
/** Response from GET /api/version. */
export interface VersionInfo {
  version: string;
}
```

- [ ] **Step 2: Add the `getVersion()` method**

In `web-src/src/api/backend.ts`, first add `VersionInfo` to the type import at the top (line 1-9). Change:

```ts
import type {
  Tunnel,
  TunnelCreateRequest,
  Entrypoint,
  EntrypointCreateRequest,
  StatsSnapshot,
  AppSettings,
  AppSettingsUpdate,
} from './types';
```

to:

```ts
import type {
  Tunnel,
  TunnelCreateRequest,
  Entrypoint,
  EntrypointCreateRequest,
  StatsSnapshot,
  AppSettings,
  AppSettingsUpdate,
  VersionInfo,
} from './types';
```

Then add a new section after the Config section (after line 147, before the closing `}` of the class):

```ts
  // ─── Version ────────────────────────────────────────────────────────────

  getVersion(): Promise<VersionInfo> {
    return this.request<VersionInfo>('GET', '/api/version');
  }
}
```

- [ ] **Step 3: Type-check**

Run: `make typecheck` (or `cd web-src && npx tsc --noEmit`)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web-src/src/api/types.ts web-src/src/api/backend.ts
git commit -m "feat(web): add GoBackend.getVersion()"
```

---

### Task 4: Settings page — fetch + render version, drop hardcoded literal

**Files:**
- Modify: `web-src/src/pages/settings-page.ts` (imports, state, lifecycle, render)
- Modify: `web-src/src/i18n/en.ts`
- Modify: `web-src/src/i18n/zh.ts`

- [ ] **Step 1: Add the `appSubtitle` i18n key**

In `web-src/src/i18n/en.ts`, in the `const en: Record<string, string> = {` object, add a line near `appName` (after line 4 `appName: 'Wisper',`):

```ts
  appName: 'Wisper',
  appSubtitle: 'GOST Tunnel Manager',
```

In `web-src/src/i18n/zh.ts`, add the matching key near its `appName` entry:

```ts
  appName: 'Wisper',
  appSubtitle: 'GOST 隧道管理器',
```

- [ ] **Step 2: Import `GoBackend` in the settings page**

In `web-src/src/pages/settings-page.ts`, change the imports (lines 1-7). Add the `GoBackend` import:

```ts
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t, onLocaleChange } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { getSettings, updateSettings, subscribe } from '../store/settings-store';
import { GoBackend } from '../api/backend';
import type { ThemePreference, LanguagePreference } from '../api/types';
import '../components/app-scaffold';
```

- [ ] **Step 3: Add version state and a backend instance**

In the `SettingsPage` class, add `_version` to the `@state()` block (after line 40 `@state() private _saving = false;`):

```ts
  @state() private _saving = false;
  @state() private _version = '';
```

Add a backend field next to `_unsubs` (after line 42 `private _unsubs: (() => void)[] = [];`):

```ts
  private _unsubs: (() => void)[] = [];
  private _backend = new GoBackend();
```

- [ ] **Step 4: Fetch the version in `connectedCallback`**

In `connectedCallback` (after the `this._unsubs.push(` block ends, before the closing `}` of the method — i.e. after line 68), add a fetch call:

```ts
    this._unsubs.push(
      subscribe(() => {
        const s2 = getSettings();
        this._server = s2.server;
        this._entrypoint = s2.entrypoint;
        this._insecure = s2.insecure;
        this._theme = s2.theme;
        this._lang = s2.lang;
        this._statsInterval = s2.stats_interval || 1;
        this._inspectorUrl = s2.inspector_url || '';
        this.requestUpdate();
      }),
      onLocaleChange(() => this.requestUpdate()),
    );

    this._fetchVersion();
  }

  private async _fetchVersion(): Promise<void> {
    try {
      const v = await this._backend.getVersion();
      this._version = v.version;
    } catch {
      this._version = '';
    }
  }
```

(Note: this replaces the existing closing `}` of `connectedCallback`; the new `_fetchVersion` method follows it.)

- [ ] **Step 5: Render the fetched version instead of the hardcoded literal**

Find the App Info block (around line 326-331):

```ts
        <!-- App Info -->
        <div class="app-info">
          <img class="app-logo" src="/logo.png" alt="Wisper" />
          <div class="app-name">${t('appName')}</div>
          <div class="app-version">v1.0.0 · GOST Tunnel Manager</div>
        </div>
```

Change the `.app-version` line to render the fetched version gracefully (empty if the request failed):

```ts
        <!-- App Info -->
        <div class="app-info">
          <img class="app-logo" src="/logo.png" alt="Wisper" />
          <div class="app-name">${t('appName')}</div>
          <div class="app-version">${this._version ? `v${this._version} · ` : ''}${t('appSubtitle')}</div>
        </div>
```

- [ ] **Step 6: Type-check and build**

Run: `make typecheck && make web`
Expected: no type errors; web build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web-src/src/pages/settings-page.ts web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "feat(web): show runtime version on settings page"
```

---

### Task 5: Makefile — derive VERSION from git describe

**Files:**
- Modify: `Makefile:14`

- [ ] **Step 1: Replace the hardcoded VERSION**

In `Makefile`, find (line 14):

```makefile
VERSION := 0.1.0
```

Replace with:

```makefile
# VERSION is derived from the most recent git tag (the single source of truth),
# with the leading "v" stripped. Falls back to 0.0.0-dev when there is no tag.
# Override on the command line for CI: `make sidecar VERSION=0.1.4`.
GIT_TAG := $(shell git describe --tags --abbrev=0 2>/dev/null)
VERSION := $(patsubst v%,%,$(GIT_TAG))
ifeq ($(strip $(VERSION)),)
VERSION := 0.0.0-dev
endif
```

- [ ] **Step 2: Verify the derivation works locally**

Run: `make -C . -p 2>/dev/null | grep '^VERSION =' | head -1` — or simply:
`eval "$(grep -A5 '^GIT_TAG' Makefile | head -6)"` is unreliable; instead verify by building:
`make sidecar && ls -la src-tauri/binaries/ 2>/dev/null; go build -ldflags "$(make -s -p | sed -n 's/^LDFLAGS := //p' | head -1)" -o /tmp/wisper . && /tmp/wisper -version`
Expected: `/tmp/wisper -version` prints `wisper <latest tag without v>` (e.g. `wisper 0.1.3`), or `wisper 0.0.0-dev` if no tag is reachable.

A simpler, sufficient check:
`make clean >/dev/null 2>&1; go build -o /tmp/wisper . && /tmp/wisper -version`
Expected: prints `wisper 0.0.0-dev` (no ldflags → default) — confirms the default still compiles. Then:
`make linux >/dev/null 2>&1 && dist/linux-amd64/wisper -version`
Expected: prints the tag-derived version (e.g. `wisper 0.1.3`).

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "build: derive VERSION from git describe in Makefile"
```

---

### Task 6: Local-dev version placeholders (Tauri + Android)

**Files:**
- Modify: `src-tauri/tauri.conf.json:3`
- Modify: `android/app/build.gradle.kts:25`

These files are overwritten by CI on release (Tasks 8–9); the in-repo value is only the local-dev fallback.

- [ ] **Step 1: Tauri placeholder**

In `src-tauri/tauri.conf.json`, change (line 3):

```json
  "version": "0.1.0",
```

to:

```json
  "version": "0.0.0-dev",
```

- [ ] **Step 2: Android versionName placeholder**

In `android/app/build.gradle.kts`, change (line 25):

```kotlin
        versionName = "0.1.0"
```

to:

```kotlin
        versionName = "0.0.0-dev"
```

Leave `versionCode = 1` as-is (the dev default; CI computes the release value in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json android/app/build.gradle.kts
git commit -m "chore: use 0.0.0-dev placeholders for local Tauri/Android builds"
```

---

### Task 7: CI — fix Windows `v`-prefix injection

**Files:**
- Modify: `.github/workflows/release.yml` (desktop-windows job, ~line 204-212)

- [ ] **Step 1: Strip the `v` prefix in the Windows build step**

Find the Windows Go-sidecar build step:

```yaml
      - name: Build Go sidecar (Windows)
        shell: bash
        env:
          VERSION: ${{ github.ref_name }}
        run: |
          mkdir -p src-tauri/binaries
          CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
            go build -ldflags "-s -w -X github.com/go-gost/wisper/version.Version=${VERSION}" \
            -o src-tauri/binaries/wisper-api-x86_64-pc-windows-msvc.exe .
```

Replace with (strip `v` from `GITHUB_REF_NAME`, drop the now-redundant `env`):

```yaml
      - name: Build Go sidecar (Windows)
        shell: bash
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          mkdir -p src-tauri/binaries
          CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
            go build -ldflags "-s -w -X github.com/go-gost/wisper/version.Version=${VERSION}" \
            -o src-tauri/binaries/wisper-api-x86_64-pc-windows-msvc.exe .
```

- [ ] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(windows): strip v prefix from injected version"
```

---

### Task 8: CI — Android `versionCode` derived from semver

**Files:**
- Modify: `.github/workflows/release.yml` (android job, ~line 288-289)

- [ ] **Step 1: Compute and inject versionCode**

Find the Android version-injection block inside the docker `run` script:

```bash
              echo "--- Injecting version ${WISPER_VERSION} ---"
              sed -i "s/versionName = \"[^\"]*\"/versionName = \"${WISPER_VERSION}\"/" /wisper/android/app/build.gradle.kts
```

Replace with (compute `versionCode = major*10000 + minor*100 + patch`, inject it, then versionName):

```bash
              echo "--- Injecting version ${WISPER_VERSION} ---"
              VCODE=$(echo "$WISPER_VERSION" | awk -F. '{print $1*10000+$2*100+$3}')
              echo "--- Computed versionCode=${VCODE} ---"
              sed -i "s/versionCode = [0-9][0-9]*/versionCode = ${VCODE}/" /wisper/android/app/build.gradle.kts
              sed -i "s/versionName = \"[^\"]*\"/versionName = \"${WISPER_VERSION}\"/" /wisper/android/app/build.gradle.kts
```

- [ ] **Step 2: Validate the YAML parses and the awk computes correctly**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
echo "0.1.4" | awk -F. '{print $1*10000+$2*100+$3}'
```
Expected: `yaml ok` then `104`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(android): derive versionCode from semver"
```

---

### Task 9: CI — Linux Tauri version + sidecar VERSION injection

**Files:**
- Modify: `.github/workflows/release.yml` (desktop-linux job, ~line 151-159)

- [ ] **Step 1: Inject the Tauri version and pass VERSION to `make sidecar`**

Find the Linux desktop build steps:

```yaml
      - name: Build web UI
        run: cd web-src && npm ci && npx vite build

      - name: Build Go sidecar
        run: make sidecar

      - name: Build Linux installers
        run: npx --yes @tauri-apps/cli@latest build --bundles deb,appimage
        working-directory: src-tauri
```

Replace with (add a version-injection step that sets `VERSION` in `$GITHUB_ENV`, patches `tauri.conf.json`, and overrides the sidecar build):

```yaml
      - name: Build web UI
        run: cd web-src && npm ci && npx vite build

      - name: Inject version (tag → bare semver)
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          echo "VERSION=${VERSION}" >> "$GITHUB_ENV"
          sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json

      - name: Build Go sidecar
        run: make sidecar VERSION=${{ env.VERSION }}

      - name: Build Linux installers
        run: npx --yes @tauri-apps/cli@latest build --bundles deb,appimage
        working-directory: src-tauri
```

- [ ] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(linux): inject Tauri version + sidecar VERSION from tag"
```

---

### Task 10: End-to-end verification

This task has no commit — it confirms the consistency contract from the spec.

- [ ] **Step 1: Backend endpoint + ldflags injection**

Run:
```bash
go build -ldflags "-X github.com/go-gost/wisper/version.Version=9.9.9" -o /tmp/wisper . && \
  /tmp/wisper -version && \
  /tmp/wisper -addr :18900 &
sleep 1
curl -s http://127.0.0.1:18900/api/version
kill %1 2>/dev/null
```
Expected: `wisper 9.9.9` then `{"version":"9.9.9"}`.

- [ ] **Step 2: Go test suite green**

Run: `go test ./... -v -count=1`
Expected: all PASS, including `TestGetVersion`.

- [ ] **Step 3: Web type-check + build**

Run: `make typecheck && make web`
Expected: no errors.

- [ ] **Step 4: Web UI shows the version (manual)**

Run: `make web && go build -ldflags "-X github.com/go-gost/wisper/version.Version=9.9.9" -o /tmp/wisper . && /tmp/wisper -addr :18900`
Open `http://127.0.0.1:18900/` → Settings tab → confirm the App Info line reads `v9.9.9 · GOST Tunnel Manager` (or the localized subtitle). Stop the server when done.

- [ ] **Step 5: Android versionCode sanity (local arithmetic)**

Run:
```bash
for v in 0.1.4 0.2.0 1.0.0 0.10.5; do
  echo "$v -> $(echo "$v" | awk -F. '{print $1*10000+$2*100+$3}')"
done
```
Expected:
```
0.1.4 -> 104
0.2.0 -> 200
1.0.0 -> 10000
0.10.5 -> 1005
```
Confirm the values are monotonically increasing with semver order.

- [ ] **Step 6: Contract checklist (confirm against spec)**

Confirm each is true for a hypothetical tag `vX.Y.Z`:
- [ ] `./wisper -version` prints the bare `X.Y.Z` on every platform (no stray `v`).
- [ ] Settings page renders `vX.Y.Z`.
- [ ] Android APK `versionName = X.Y.Z`, `versionCode = X*10000+Y*100+Z`.
- [ ] Tauri desktop bundled version = `X.Y.Z`.
- [ ] No version string anywhere is still `0.1.0` or `v1.0.0` except `web-src/package.json` and `Cargo.toml` (cosmetic, unconsumed — left intentionally).

---

## Self-Review Notes

- **Spec coverage:** every injection target in the spec table (Go, Android versionName, Android versionCode, Tauri, web-via-API) maps to a task. Dev fallback (`version.go`, Makefile, tauri/gradle placeholders) covered. Windows prefix bug = Task 7. `/api/version` = Tasks 1–4. All spec sections represented.
- **Type consistency:** `VersionInfo { version: string }` defined in Task 3, used by `getVersion()` (Task 3) and read as `v.version` (Task 4). Handler returns `versionResponse{Version: ...}` JSON-tagged `version` — matches the TS `version` field. No mismatch.
- **No placeholders:** every code/CI step contains the exact before/after text and exact commands with expected output.
