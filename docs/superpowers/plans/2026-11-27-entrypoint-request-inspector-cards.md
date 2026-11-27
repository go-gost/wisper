# Entrypoint Request Inspector Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restyle the tungo recent-request list as inspector-like cards with compact metadata, expandable detail chips, and unchanged data/rule behavior.

**Architecture:** Keep the existing Lit page, polling, API calls, expansion state, and rule mutations. Replace only row rendering/styles, align the shared nanosecond duration formatter with the inspector, and add local-time request timestamp formatting.

**Tech Stack:** TypeScript, Lit, CSS custom properties, Playwright.

**Spec:** The controller's 2026-11-27 request-list restyle brief and `/root/code/go-gost/inspector/web/src/pages/LivePage.tsx` plus `utils/format.ts`.

## Global Constraints

- Work in `wisper` on `main`; commit only, never push.
- No dependencies and no subagents.
- Preserve request data, refresh logic, rule actions, and all three rule states.
- Comments in English only.
- Required commit subject: `fix(web): restyle the request list after the inspector feed`.
- Required gates: `make typecheck && make ui-test && make web`; `go test ./api/ -count=1` once.
- Inspect temporary 420×900 screenshots, then remove the temporary spec and `web-e2e/shots/`.

## Review Focus

- Long IPv6/host values and full timestamps must not overflow at 360px.
- Direct rows must have no tunnel/direct badge; tunneled rows need one named lock icon.
- Invalid/empty timestamps and zero/sub-millisecond durations must remain readable.
- Expanding direct and errored rows must expose full chip text without horizontal spill.
- Covered rule markers must remain non-clickable while the row itself stays expandable.

---

### Task 1: Render inspector-style request cards and verify them

**Files:**
- Modify: `web-src/src/pages/entrypoint-requests-page.ts`
- Modify: `web-src/src/utils/format.ts`
- Modify: `web-src/src/i18n/en.ts`
- Modify: `web-src/src/i18n/zh.ts`
- Test: `web-e2e/tests/entrypoint-tungo-requests.spec.ts`
- Rebuild: `web/assets/*`, `web/index.html`

**Interfaces:**
- Consumes: `EntrypointRequest`, `requestDestination`, `ruleCovers`, `icon('lock')`, existing locale keys.
- Produces: `formatDuration(ns)` with inspector units/precision; card rows with `.request-line`, `.request-meta`, `.detail-chips`, `.tunnel-lock`; local-time compact/full timestamps.

- [x] **Step 1: Update the Playwright assertions first**
  - Assert 4px list gaps, 8px 12px card padding, error left border, named lock only on tunneled rows, no route badges, line-2 timestamps, inspector durations, and expanded Host/Target/Route/Duration/Bytes/Error chips.
  - Add today-versus-older timestamp and minute/hour duration coverage.
  - Keep 360px overflow, polling, refresh, rule-state, failure, cap, and empty-state tests; adjust the covered-row button assertion for the expandable row.

- [x] **Step 2: Run the request spec and verify RED**
  Run: `scripts/ui-test.sh tests/entrypoint-tungo-requests.spec.ts`
  Expected: failures on missing card styles, lock/chips, timestamp placement, and duration format.

- [x] **Step 3: Implement the card rendering and formatters**
  - Use a flex column list with 4px gaps and bordered surface cards; errored cards get a 2px red left border.
  - Line 1: ellipsized monospace destination, optional named lock, right-aligned monospace duration, chevron, and unchanged 24×24 rule control.
  - Line 2: ellipsized network/protocol/traffic summary plus non-truncating local timestamp (`HH:mm:ss` today, full date otherwise).
  - Make every row expandable; render wrapping chips for Host (when present), Target, Route (`node@addr` hops joined by ` → `, otherwise `direct`), Duration, Bytes, and full Error text.
  - Match `fmtDuration`: `<1ms`, rounded microseconds, one-decimal milliseconds/seconds, then minutes/hours.
  - Add matching en/zh chip labels; remove only keys made unused by this page.

- [x] **Step 4: Run the request spec and verify GREEN**
  Run: `scripts/ui-test.sh tests/entrypoint-tungo-requests.spec.ts`
  Expected: all request-page tests pass.

- [x] **Step 5: Capture and inspect screenshots**
  - Create a temporary mock-backed 420×900 Playwright spec writing `shots/list.png` and `shots/list-expanded.png`.
  - Run `scripts/ui-test.sh -g <temporary spec>` and read both PNGs.
  - Fix visual defects with a failing regression assertion when applicable; rerun and reinspect.
  - Delete the temporary spec and `web-e2e/shots/`.

- [x] **Step 6: Run all gates and self-review**
  - Run `make typecheck && make ui-test && make web`.
  - Run `go test ./api/ -count=1` once.
  - Review the diff for requirement coverage, locale parity, overflow, accessibility, generated assets, and debug artifacts.

- [x] **Step 7: Commit and record**
  - Commit all task files with the required subject; never push.
  - Append the short report to `/root/code/go-gost/.superpowers/sdd/2026-11-22-android-tungo-split/final-fix-report.md`.

## Implementation record

- **Date/status:** 2026-11-27 — complete.
- **Repository + commit SHA:** `wisper` (`github.com/go-gost/wisper`, branch `main`); implementation commit `8c7eb21` — `fix(web): restyle the request list after the inspector feed` (not pushed).
- **Files changed:** `web-src/src/pages/entrypoint-requests-page.ts`, `web-src/src/utils/format.ts`, `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`, `web-e2e/tests/entrypoint-tungo-requests.spec.ts`, this plan, and rebuilt tracked `web/assets/*` plus `web/index.html`.
- **Behavior:** request rows are 4px-gapped cards with a red error edge, monospace destination, lock-only tunnel marker, inspector duration, compact local timestamp, unchanged three-state rule control, and wrapping detail chips. Every row expands; unnamed final path hops render as their address rather than `@address`.
- **Tests/commands and results:** request spec RED (5 expected failures) → GREEN (13/13); temporary 420×900 screenshot spec passed and both PNGs were read; `make typecheck && make ui-test && make web` passed (57/57 UI tests, Vite build succeeded); `go test ./api/ -count=1` passed (129.883s); locale-key diff and `git diff --check` clean.
- **Review findings and fixes:** self-review found the unnamed final-hop `@address` edge case; added the real two-hop fixture and watched it fail, then rendered unnamed hops as the address alone. No Critical/Important findings remain. Temporary screenshot spec and `web-e2e/shots/` were removed.
- **Deferred items/limitations:** none. The existing npm audit summary still reports four high-severity advisories; no dependency changed.
- **Ruling:** All rows become expandable so the required `Route: direct` chip is reachable; this preserves the chevron/toggle interaction while extending it beyond path-bearing rows.
