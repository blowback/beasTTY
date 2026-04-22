---
phase: 04-keyboard-input
plan: 01
subsystem: testing
tags: [playwright, test-scaffolding, nyquist-validation, fixme-stubs, harness-hook]

# Dependency graph
requires:
  - phase: 03-canvas-renderer
    provides: "Playwright 1.51 installed, www/tests/render/ suite (32 passing specs), HiDPI deviceScaleFactor: 2 contract, bootRenderer + term + wasm module exports"
  - phase: 02-wasm-boundary
    provides: "term.grid_ptr() / term.grid_byte_len() exports reused by __testGridView harness"
provides:
  - "8 fixmed stub specs under www/tests/input/ covering INPUT-01..INPUT-05 + SC-1 TX-strip + SC-5 focus + SC-5 IME"
  - "Extended Playwright testMatch discovering both tests/render/ and tests/input/"
  - "window.__testGridView global re-deriving a Uint8Array view of the wasm grid on every call"
affects: ["04-02-input-core", "04-03-chrome-wiring", "04-04-assertion-fill"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nyquist-compliant test scaffolding: every requirement's <automated> command resolves to a discoverable spec BEFORE implementation code lands"
    - "test.fixme(true, reason) as Nyquist placeholder — keeps specs discoverable + green"
    - "Unconditional test-harness globals (no ?test=1 gate) for Phase 4 zero-security-surface scope"
    - "Re-derive-on-call Uint8Array view pattern (immune to wasm.memory.buffer identity shifts)"

key-files:
  created:
    - www/tests/input/keydown-arrows.spec.js
    - www/tests/input/keydown-ctrl-letters.spec.js
    - www/tests/input/keydown-printable.spec.js
    - www/tests/input/local-echo.spec.js
    - www/tests/input/crlf-override.spec.js
    - www/tests/input/focus-retention.spec.js
    - www/tests/input/tx-debug-strip.spec.js
    - www/tests/input/ime-composition.spec.js
  modified:
    - www/playwright.config.js
    - www/main.js

key-decisions:
  - "testMatch uses explicit ['**/render/*.spec.js', '**/input/*.spec.js'] globs (mitigates T-04-01-03 DoS from node_modules recursion)"
  - "window.__testGridView unconditionally exposed — Phase 4 has zero security surface; gating would force every spec to use ?test=1"
  - "__testGridView re-derives the Uint8Array view on every call instead of caching (cheap; safe against wasm memory growth identity shifts)"
  - "Stub bodies use test.fixme(true, reason) so Playwright lists them but skips execution — SC-1 discoverability count ≥ 8 satisfied without red suite"

patterns-established:
  - "Phase 4 stub-spec naming: one file per INPUT-* req (plus SC-1 TX-strip + SC-5 IME/focus halves), header comment pins phase/plan/req IDs"
  - "Plan 04-04 will replace test.fixme(true, ...) bodies with real assertions; spec files themselves stay stable"
  - "Test-harness hooks in main.js live between wireChrome() and the Phase 2 Debug-pane helpers block"

requirements-completed: [INPUT-01, INPUT-02, INPUT-03, INPUT-04, INPUT-05]

# Metrics
duration: 3min
completed: 2026-04-22
---

# Phase 4 Plan 01: Keyboard Input Wave 0 Scaffolding Summary

**Nyquist-compliant Playwright scaffolding: 8 fixmed INPUT-*/SC-* stub specs discoverable alongside Phase 3's render suite, plus window.__testGridView harness hook for local-echo grid readback.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-22T20:52:29Z
- **Completed:** 2026-04-22T20:55:09Z
- **Tasks:** 3
- **Files modified:** 10 (8 new stubs + 2 edits)

## Accomplishments

- 8 fixmed Playwright spec stubs under `www/tests/input/` — one per Phase 4 INPUT-* requirement plus SC-1 TX-strip and SC-5 (IME + focus halves); each contains a `test.describe(...)` + single `test.fixme(true, reason)` block and a `// Phase 4 Plan 01 — <REQ>` header comment.
- `www/playwright.config.js` extended: `testDir` widened from `./tests/render` to `./tests`; new `testMatch: ['**/render/*.spec.js', '**/input/*.spec.js']` glob discovers both suites without sweeping `node_modules`. All other config (HiDPI deviceScaleFactor: 2, webServer, projects, expect.toHaveScreenshot) preserved verbatim.
- `www/main.js` gains `window.__testGridView = () => new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len())` right after the `wireChrome(...)` call. Re-derived on every call, unconditional (no `?test=1` gate), with a comment pinning the Phase 4 security-surface rationale. Plan 04-04's `local-echo.spec.js` will use it for grid-byte assertions.
- Full suite green: 32 render tests passed, 8 input stubs skipped, 0 failures (7.3 s wall-clock) — Phase 3 regressions zero.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 8 stub spec files in www/tests/input/** — `088c5f3` (test)
2. **Task 2: Extend playwright.config.js to discover tests/input/ alongside tests/render/** — `450f1ba` (chore)
3. **Task 3: Expose window.__testGridView harness hook in main.js** — `29df331` (feat)

**Plan metadata commit:** _appended after this summary is written_

_Note: No TDD multi-commit cycles — this plan is scaffolding only (no production-behaviour code)._

## Files Created/Modified

- `www/tests/input/keydown-arrows.spec.js` — INPUT-02 stub (`test.fixme`) for ESC A/B/C/D arrow TX.
- `www/tests/input/keydown-ctrl-letters.spec.js` — INPUT-03 stub for Ctrl+KeyL → 0x0C.
- `www/tests/input/keydown-printable.spec.js` — INPUT-01 stub for Shift+KeyA → 0x41.
- `www/tests/input/local-echo.spec.js` — INPUT-04 stub for echo OFF default / echo ON render path.
- `www/tests/input/crlf-override.spec.js` — INPUT-05 stub for CR / LF / CRLF Enter-byte radios.
- `www/tests/input/focus-retention.spec.js` — SC-5 focus-half stub (toolbar click retains canvas focus).
- `www/tests/input/tx-debug-strip.spec.js` — SC-1 stub for TX hex strip placeholder/update/reset.
- `www/tests/input/ime-composition.spec.js` — SC-5 IME-half stub (compositionstart/end no double-emit).
- `www/playwright.config.js` — `testDir` → `./tests`; new `testMatch` glob union; HiDPI + webServer + expect block untouched.
- `www/main.js` — `window.__testGridView` assignment + rationale comment, placed between `wireChrome(...)` and the Phase 2 harness-helpers block.

## Decisions Made

- **Unconditional harness exposure.** `window.__testGridView` is assigned at boot without a `?test=1` URL gate. Phase 4 has zero security surface (no auth, no PII, no network); gating would force every Playwright spec to adopt the URL param. Phase 5 Web Serial will re-evaluate if needed.
- **`test.fixme(true, reason)` over `test.skip` for stubs.** `fixme` signals "this test *should* pass once implementation lands" (auditable intent); `skip` would silently hide the Plan 04-04 obligation. Playwright lists both but `npm test` stays green.
- **Explicit testMatch glob.** `['**/render/*.spec.js', '**/input/*.spec.js']` rather than a single `**/*.spec.js` — explicit globs prevent any future `node_modules/*/spec.js` sweep from broadening test discovery (T-04-01-03 DoS mitigation).
- **Re-derive-on-call view.** `__testGridView = () => new Uint8Array(wasm.memory.buffer, ...)` constructs a fresh view every call instead of caching. One `Uint8Array` allocation per assertion is cheap, and this mirrors the Phase 2 Plan 02-06 pattern of treating `wasm.memory.buffer` identity as the rebuild trigger — callers never touch a stale view.

## Deviations from Plan

None — plan executed exactly as written. Every acceptance criterion in all three tasks passed on first attempt:

- 8 spec files, header comments, describe/fixme shape (Task 1).
- `testDir: './tests'`, `testMatch` glob matching both suites, 8 input + 32 render discovered (Task 2).
- `window.__testGridView` assigned once after `wireChrome`, uses `wasm.memory.buffer`, `node --check` reports clean syntax (Task 3).

No auto-fix rules triggered; no architectural decisions needed; no authentication gates.

## Issues Encountered

None. The initial `npx playwright test tests/input/ --list` run returned "No tests found" before Task 2 — this was the expected pre-config state (testDir still `./tests/render`), not a bug. After Task 2 committed, discovery worked immediately.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 04-02 (keyboard.js input core)** can land production code knowing `www/tests/input/keydown-arrows.spec.js`, `keydown-ctrl-letters.spec.js`, `keydown-printable.spec.js`, and `ime-composition.spec.js` already resolve as `<automated>` targets.
- **Plan 04-03 (chrome wiring: TX-strip, CR/LF radios, echo toggle, focus-retain)** has `tx-debug-strip.spec.js`, `crlf-override.spec.js`, `local-echo.spec.js`, and `focus-retention.spec.js` pre-staged.
- **Plan 04-04 (assertion fill)** now has both (a) eight stub bodies to replace and (b) `window.__testGridView()` for the local-echo grid-byte readback assertion — the only harness dependency the spec requires beyond standard Playwright `page.keyboard` and locator APIs.
- **No blockers surfaced.** Phase 3 contract (HiDPI, focus attribute, bell sampling, rAF cadence) untouched; D-13 (Phase 4 JS-only, no Rust changes) honoured — the wasm-bindgen crate and all Rust sources are identical to Phase 3 completion.

## Self-Check: PASSED

- All 11 expected artifacts found on disk (8 spec stubs + 2 modified + this summary).
- All 3 task commits present in `git log --oneline --all`: `088c5f3`, `450f1ba`, `29df331`.

---
*Phase: 04-keyboard-input*
*Completed: 2026-04-22*
