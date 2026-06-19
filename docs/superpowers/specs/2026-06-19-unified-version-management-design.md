# Unified Version Management — Design

**Date:** 2026-06-19
**Status:** Approved (awaiting implementation plan)
**Author:** brainstorming session

## Problem

Version numbers across the project are inconsistent and stale. There is no single
source of truth; instead seven locations each hand-maintain a version string that
drifts apart in practice:

| Source | Current value | Owner |
|--------|---------------|-------|
| Git tag (release source) | `v0.1.3` | manual `git tag` |
| `version/version.go` | `0.1.0` (default) | goreleaser `-ldflags -X` override |
| Web Settings page (`settings-page.ts`) | `v1.0.0` | **hardcoded HTML literal, stale + wrong** |
| `web-src/package.json` | `0.1.0` | manual (cosmetic, unconsumed) |
| Android `versionName` | `0.1.0` | CI `sed` rewrite |
| Android `versionCode` | `1` | **hardcoded, never incremented** |
| Tauri `tauri.conf.json` | `0.1.0` | manual |
| `Cargo.toml` | `0.1.0` | manual (cosmetic, unconsumed) |
| `Makefile` `VERSION` | `0.1.0` | manual |

Concrete bugs found during exploration:

1. **Settings page shows `v1.0.0`** while the latest release is `0.1.3` — the value
   is a hardcoded HTML literal that has never been updated, and the number itself is
   wrong.
2. **The web UI never reads the version from the backend.** The Go binary carries the
   correct version (ldflags-injected), but the UI ignores it and there is no
   `/api/version` endpoint.
3. **`v` prefix inconsistency.** The Windows desktop build
   (`release.yml`, line ~211) passes the full `github.ref_name` (`v0.1.2`, *with* `v`)
   into the Go binary, while goreleaser (`{{ .Version }}`) and Android
   (`${TAG#v}`) strip the `v`. So the Go binary reports `v0.1.2` on Windows but
   `0.1.2` everywhere else.
4. **Android `versionCode` is permanently `1`.** It is never incremented, so Android
   treats every release as the same version — a root cause of the
   uninstall-to-upgrade pain recorded in project memory.

The root cause is structural: there is no single source of truth.

## Goal

Establish the **git tag as the single source of truth**. Every version string in
every artifact (Go binary, web UI, Android APK, Tauri desktop app) derives from the
tag at build time. Releasing is: `git tag v0.1.4 && git push --tags`. No version
string is hand-maintained except a dev fallback.

## Non-goals

- A `VERSION` file in the repo (rejected option — git tag is the source).
- Build-time version injection into the web bundle (rejected — the UI reads the
  version from the backend at runtime instead).
- A new release-automation tool. We reuse the existing goreleaser + release.yml CI.

## Decisions

These were settled during brainstorming:

1. **Single source of truth = git tag** (CI-injection model). Everything derives from
   the tag; nothing is hand-synced.
2. **Web UI reads version at runtime from `/api/version`** rather than via build-time
   injection. The backend is always co-deployed with the UI (embedded in the Go
   binary / Tauri sidecar / Android), so it is always available.

## Design

### Version normalization

- Tag format: `v<major>.<minor>.<patch>` (e.g. `v0.1.4`).
- **Canonical internal form = bare semver, no `v` prefix** (`0.1.4`). All injection
  points store/display the bare value. This single rule fixes the Windows prefix bug.
- **Display form:** the UI prepends `v` → renders `v0.1.4`. Backend and config files
  store the bare value.

### Injection points (CI, derived from tag)

| Target | Mechanism | Status |
|--------|-----------|--------|
| Go binary | `-ldflags -X github.com/go-gost/wisper/version.Version=<bare>` | goreleaser + Android already do this; **Windows must be fixed** to strip `v` |
| Android `versionName` | `<bare>` via CI `sed` | already done |
| Android `versionCode` | `major*10000 + minor*100 + patch` (`0.1.4` → `104`) via CI | **new** — replaces hardcoded `1` |
| Tauri `tauri.conf.json` `version` | `<bare>` via CI `sed` before build | **new** — replaces hardcoded `0.1.0` |
| Web UI | **not injected** — runtime fetch of `/api/version` | new mechanism |

### Android `versionCode` scheme

`versionCode = major*10000 + minor*100 + patch`.

- Deterministic and monotonic from the semver.
- `0.1.4` → `104`; `0.2.0` → `200`; `0.10.5` → `1005`; `1.0.0` → `10000`.
- Constraint: this is only monotonic while patch < 100 and minor < 100, which holds
  for the foreseeable release cadence. If that is ever exceeded, the scheme must be
  revisited.
- CI computes this from `$VERSION` and `sed`s it into `build.gradle.kts` alongside
  `versionName`.

### New backend endpoint

`GET /api/version` → `{"version": "0.1.4"}`.

- Returns `version.Version` (the ldflags-injected value).
- Registered in `api/server.go` next to `/api/config`.
- Add a small handler + a test in `api/api_test.go` following the existing test
  patterns (`setupTestServer`).

### Web UI changes

- `web-src/src/api/backend.ts`: add `getVersion(): Promise<string>` following the
  existing `url(path)` + `fetch` pattern; returns the parsed `version` field.
- `web-src/src/pages/settings-page.ts`: remove the hardcoded `v1.0.0` literal at
  line 330. Fetch the version in `connectedCallback` (or on first render) and render
  `v${version} · ${t('appSubtitle')}` (keep the "GOST Tunnel Manager" subtitle).
- i18n: add an `appSubtitle` key (`"GOST Tunnel Manager"`) to `en.ts` and `zh.ts` so
  the subtitle is localized like the rest of the UI.

### Local / dev builds (no tag)

- `Makefile`: `VERSION := $(shell git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')`,
  falling back to `0.0.0-dev` when there is no tag.
- `version/version.go` default: `0.1.0` → `0.0.0-dev`. A bare `go build` / `go run`
  then reports an obviously-dev version instead of lying with a real number.
- CI desktop jobs override explicitly: `make sidecar VERSION=$VERSION`
  (`make sidecar` already consumes `$(VERSION)` via `$(LDFLAGS)`).

### CI changes (`release.yml`)

Each job normalizes the version once at the top and reuses it:

```bash
VERSION="${GITHUB_REF_NAME#v}"   # strip leading 'v'
```

- **`goreleaser` job:** already correct (`{{ .Version }}`); no change.
- **Windows desktop job:** replace `${VERSION:=${github.ref_name}}` usage with the
  stripped `$VERSION` for the `-X` ldflag (fixes the prefix bug).
- **Android job:** compute `VNAME=$VERSION` and
  `VCODE=$(echo "$VERSION" | awk -F. '{print $1*10000+$2*100+$3}')`; `sed` both into
  `build.gradle.kts`. Keep the existing `sed` for `versionName`, add one for
  `versionCode`.
- **Linux desktop job:** `sed` `tauri.conf.json` `version` to `$VERSION` before the
  Tauri build; pass `VERSION=$VERSION` to `make sidecar`.

### Hardcoded values removed

| File | Before | After |
|------|--------|-------|
| `version/version.go` | `0.1.0` | `0.0.0-dev` |
| `Makefile` `VERSION` | `0.1.0` | `$(shell git describe …)` w/ fallback |
| `tauri.conf.json` `version` | `0.1.0` | CI-injected; file keeps `0.0.0-dev` as the local-dev placeholder (consistent with `version.go`) |
| `settings-page.ts` | `v1.0.0` (literal) | runtime-fetched |
| `build.gradle.kts` | `versionName="0.1.0"`, `versionCode=1` | CI-injected both |

`web-src/package.json` and `Cargo.toml` `version` fields are cosmetic and
unconsumed; left as-is.

## Consistency contract (verification)

A release built from tag `vX.Y.Z` satisfies all of:

1. `./wisper -version` prints `wisper X.Y.Z` on **every** platform (linux, darwin,
   windows, android .so) — same bare semver, no stray `v`.
2. The web Settings page renders `vX.Y.Z`.
3. The Android APK reports `versionName = X.Y.Z` and `versionCode = X*10000+Y*100+Z`.
4. The Tauri desktop app's bundled version is `X.Y.Z`.
5. All of the above are identical for the same tag across Linux/Windows/Android/desktop.

These become the acceptance checks for the implementation.

## Risk / edge cases

- **`make sidecar` on a checkout with no tag** (e.g. a feature branch in CI that is
  not a release): produces `0.0.0-dev`. Acceptable — only tagged pushes trigger the
  release jobs.
- **versionCode overflow:** only if minor ≥ 100 or patch ≥ 100. Documented constraint
  above.
- **Web UI before backend responds:** the Settings page should render gracefully if
  `/api/version` fails (show `v0.0.0` or omit the number) rather than throw. Handler
  must degrade.
- **`git describe` during a shallow checkout:** `actions/checkout` already uses
  `fetch-depth: 0` in the relevant jobs, so tags are present. Local shallow clones
  fall back to `0.0.0-dev`.
- **Prerelease tags (`vX.Y.Z-rc1`, `-alpha`, `-beta`):** the workflow's `create-release`
  job treats these as prereleases, so they are supported inputs. The Android
  `versionCode` strips the prerelease suffix before the arithmetic
  (`sed 's/-.*//'`), so `0.1.4-rc1` and the final `0.1.4` both map to `versionCode 104`
  while `versionName` keeps the full `0.1.4-rc1`. Consequence: a prerelease and the
  final of the same `X.Y.Z` share a `versionCode`, so they cannot coexist as
  upgradable versions in the same Android channel. This is acceptable for
  GitHub-release artifacts (the final supersedes the prerelease) but should be
  revisited if prereleases are ever published to Play Store. No prerelease tag has
  been cut on this project to date.
