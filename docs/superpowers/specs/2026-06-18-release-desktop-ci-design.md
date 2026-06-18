# Release CI — Desktop Build (Linux + Windows)

2026-06-18 | Status: approved | Implementation: pending

## Goal

Extend `.github/workflows/release.yml` to build Tauri 2 desktop installers for **Linux** (`.deb` + `.AppImage`) and **Windows** (NSIS `.exe`) alongside the existing GoReleaser cross-compiled Go binaries, all triggered by `git push --tags "v*"`.

## Architecture

```
                  ┌──────────┐
                  │ lint+test│
                  └────┬─────┘
                       │
                  ┌────▼──────┐
                  │create-rel │  ← single job that creates the GitHub Release + changelog
                  └────┬──────┘
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌──────────┐ ┌───────────┐ ┌──────────────┐
   │goreleaser│ │desktop-lnx│ │desktop-win   │
   │(ubuntu)  │ │(ubuntu)   │ │(windows-lt)  │
   └────┬─────┘ └─────┬─────┘ └──────┬───────┘
        └─────────────┼─────────────┘
                      ▼
              ┌──────────────┐
              │ GitHub Release│
              │ • Go binaries  │
              │ • .deb/.AppImg │
              │ • .exe (NSIS)  │
              │ • checksums    │
              └──────────────┘
```

- **`create-release`** — creates the GitHub Release once, generates a changelog from git history, marks pre-release if tag contains `alpha`/`beta`/`rc`.
- **`goreleaser`** — cross-compiles Go binaries (linux/darwin/windows × amd64/arm64), builds web UI first (embedded via `//go:embed`), skips its own release creation (`--skip=release`), uploads `.tar.gz` / `.zip` / `checksums.txt` via `softprops/action-gh-release`.
- **`desktop-linux`** — native build on `ubuntu-latest`, no Docker. Installs webkit2gtk dev headers via apt, compiles web UI + Go sidecar, runs `npx @tauri-apps/cli build --bundles deb,appimage`, uploads artifacts.
- **`desktop-windows`** — native build on `windows-latest`, no Docker, no `cargo-xwin`. Compiles web UI + Go sidecar (.exe), runs `npx @tauri-apps/cli build --bundles nsis`, uploads the NSIS installer.

All three build jobs depend on `create-release` and run in parallel after it completes.

## Why native runners (not Docker)

The existing local desktop builds use Docker (`Dockerfile.desktop`, `Dockerfile.windows`) because the dev host has three constraints: no sudo, crates.io blocked (needs Tuna mirror), and missing webkit2gtk dev headers. None of these apply to GitHub Actions runners:

| Constraint | Local host | GHA runner |
|---|---|---|
| webkit2gtk dev headers | missing, no sudo to install | `sudo apt-get install` works |
| crates.io | blocked (HTTP 403) | accessible from Azure DCs |
| Rust toolchain | host-installed, volume-mounted | `dtolnay/rust-toolchain` action |
| Windows WebView2 | N/A | pre-installed on `windows-latest` |

Native builds are faster, simpler to cache, and avoid the complexity of Docker-in-Docker or volume-mounting toolchains.

## Job details

### create-release

- Runs on `ubuntu-latest`.
- Needs `contents: write` permission.
- Outputs `upload_url` (though `softprops` in child jobs discovers the release by tag name, so the output is informational).
- Generates changelog from `git log` between the previous tag and HEAD.
- Detects pre-release: `contains(github.ref_name, 'alpha') || contains(github.ref_name, 'beta') || contains(github.ref_name, 'rc')`.

### goreleaser (modified)

- Now depends on `create-release` instead of `[lint, test]` directly.
- Adds `--skip=release` to goreleaser args (the web hook still runs, changelog is still generated, but no GitHub Release API call is made).
- After goreleaser, `softprops/action-gh-release@v2` uploads `dist/*.tar.gz`, `dist/*.zip`, `dist/checksums.txt` to the existing release.
- The `release` section is removed from `.goreleaser.yaml` (already overridden by `--skip=release`, but removing it keeps the config clean).

### desktop-linux

- Runs on `ubuntu-latest`.
- **System deps**: `sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev`.
- **Rust**: `dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown` (required by the Tauri 2 IPC layer).
- **Rust cache**: `actions/cache@v4` keyed on `src-tauri/Cargo.lock`, paths `~/.cargo/registry/`, `~/.cargo/git/`, `src-tauri/target/`.
- **Go sidecar**: `make sidecar` — builds to `src-tauri/binaries/wisper-api-<host-triple>` (host triple on ubuntu-latest is `x86_64-unknown-linux-gnu`).
- **Tauri build**: `npx --yes @tauri-apps/cli@latest build --bundles deb,appimage` from `src-tauri/`.
- **Upload**: `softprops/action-gh-release@v2` with `src-tauri/target/release/bundle/deb/*.deb` and `src-tauri/target/release/bundle/appimage/*.AppImage`.

### desktop-windows

- Runs on `windows-latest`.
- **Rust**: `dtolnay/rust-toolchain@stable` — no extra targets needed (no wasm, Windows WebView2 uses COM).
- **Rust cache**: same key strategy as Linux (`${{ runner.os }}-cargo-...`).
- **Go sidecar**: inline PowerShell/bash — `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o src-tauri/binaries/wisper-api-x86_64-pc-windows-msvc.exe`. The triple must match what Tauri appends to `externalBin` on the Windows runner.
- **Tauri build**: `npx --yes @tauri-apps/cli@latest build --bundles nsis` from `src-tauri/`.
- **Code signing**: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env vars are wired but optional — build succeeds without them (unsigned installer).
- **Upload**: `softprops/action-gh-release@v2` with `src-tauri/target/release/bundle/nsis/*.exe`.

## Files changed

| File | Change |
|------|--------|
| `.github/workflows/release.yml` | Add `create-release`, `desktop-linux`, `desktop-windows` jobs. Modify `goreleaser` to depend on `create-release`, add `--skip=release`, add softprops upload step. |
| `.goreleaser.yaml` | Remove `release` section (cleanup — `--skip=release` already prevents creation, but the section is misleading if kept). |

## Non-goals

- macOS desktop build — no macOS runner access (GitHub-hosted macOS runners are 10× more expensive per minute and not requested).
- Android APK in release CI — Android uses a separate Docker-based pipeline (`make android`), needs NDK + Gradle, out of scope for this change.
- Desktop build in `ci.yml` (push to main) — Tauri builds are too expensive for every push. Desktop artifacts are only built on tag pushes.
- Code signing — deferred. Wired as optional env vars, no secrets required yet.
- AppImage EGL caveat — the `.deb` is the primary Linux artifact; AppImage is included but known to abort on Mesa ≥26 (documented in `appimage-egl-caveat.md` memory).

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| First build is slow (no Rust cache) | `actions/cache@v4` persists `target/` — subsequent builds are ~70% faster |
| `softprops` concurrency (3 jobs uploading to same release) | GitHub's `upload-release-asset` API is per-file; no lock contention |
| goreleaser `release` config conflicts with `--skip=release` | Remove the `release` section from `.goreleaser.yaml` entirely |
| wasm target missing on Linux | `dtolnay/rust-toolchain` explicitly includes `wasm32-unknown-unknown` |
| `${{ github.ref_name }}` in Windows sidecar script | `github.ref_name` is `v0.1.0` (tag name, no shell interpolation issues) |
