---
phase: 12-slide-ux-polish-docs-real-hardware-uat
plan: 07
subsystem: ui
tags: [slide-39, chip-lifecycle, force-start, gap-closure, playwright, regression-guard]

# Dependency graph
requires:
  - phase: 11-slide-js-bridge-v1-0-integration
    provides: "Plan 11-04 SLIDE-39 Compatibility-mode 3-way 3 s timer + handleChipInlineAction force-start dispatch path (the missing-enterActive defect site) + slideChipRef.enterActive() chip API surface (the call this plan wires)"
  - phase: 12-slide-ux-polish-docs-real-hardware-uat
    provides: "12-HUMAN-UAT.md Gap 1 root-cause analysis (.planning/debug/12-force-start-button-does-nothing.md) — the diagnosis this plan implements verbatim"
provides:
  - "case 'force-start' in slide.js:handleChipInlineAction now calls slideChipRef.enterActive() after enterSendModeInternal succeeds, mirroring the wakeup-completion-clause idiom in dispatchTerminalMode (slide.js:609-613)"
  - "Extended slide-compatibility.spec.js [Force start] test asserting chip lifecycle transitions to 'active' (regression-guard against the silent UI gap diagnosed in 12-force-start-button-does-nothing.md)"
affects: [phase-12-verify, real-hardware-uat-12-01, plan-12-08-rts-pref, plan-12-09-instrumentation-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mirror-the-idiom regression fix: copy the existing wakeup-completion enterActive() guard pattern verbatim into the parallel force-start branch rather than introducing a new chip-update mechanism (preserves slide.js single-call-site convention for chip transitions)"
    - "Inner-try chip-call wrap: place the chip method call INSIDE the existing try/catch on enterSendModeInternal so a chip-method exception cannot leave the dispatcher in an inconsistent state, but ordered AFTER enterSendModeInternal so the chip never shows 'active' on a still-terminal-mode dispatcher if enterSendModeInternal throws"
    - "Extend-don't-split test contract: adding the new lifecycle assertion BELOW the existing mode='send' assertion in the SAME test() block (preserves the -g filter anchor used by 12-VALIDATION.md per Plan 11-05 convention)"

key-files:
  created: []
  modified:
    - "www/transport/slide.js (case 'force-start' in handleChipInlineAction — added inner enterActive() guarded call after enterSendModeInternal inside the existing try/catch; +18 -1 lines including doc-comment block citing the debug session)"
    - "www/tests/transport/slide-compatibility.spec.js (extended [Force start] test with second expect.poll asserting __slideChip.__getStateForTests().lifecycle === 'active'; +9 -0 lines)"

key-decisions:
  - "enterActive() call placed INSIDE the existing try/catch (not split into a separate try) — a chip-method exception is logged via the same error path as enterSendModeInternal failures; preserves the single-error-path convention. enterActive() is ordered AFTER enterSendModeInternal so the chip never shows 'active' on a still-terminal-mode dispatcher if enterSendModeInternal throws."
  - "Test assertion lands as a second expect.poll() in the SAME test() block (not a new test) — preserves the test name '[Force start] click jumps directly into send mode without waiting for wakeup' as the 12-VALIDATION.md -g filter anchor (Plan 11-05 convention)."
  - "Diagnostic instrumentation (slideDbg, slideDbgHex, SLIDE_DEBUG, slideDbg call sites) UNCHANGED in this plan per <instrumentation_preservation> in execution context — Plan 12-09 owns the cleanup pass."

patterns-established:
  - "UAT-gap-closure plan idiom: small, atomic, two-task plans (one production-code edit + one test extension) that close a specific UAT gap diagnosed in .planning/debug/. Provides regression-guard at the contract layer rather than reactive code-review fixes."
  - "Asymmetric-chip-handling regression test: any future case in handleChipInlineAction that calls enterSendModeInternal must have a paired chip-lifecycle assertion in slide-compatibility.spec.js (precedent now set for force-start; retry has its own enterAwaitingWakeup assertion path)."

requirements-completed: []  # SLIDE-39 was already marked Complete in REQUIREMENTS.md (Phase 11 Plan 11-05) — Plan 12-07 is a regression-fix touchup, not a fresh requirement landing.

# Metrics
duration: ~4min
completed: 2026-05-09
---

# Phase 12 Plan 07: Force-start chip-lifecycle fix Summary

**Closes UAT Gap 1 (`12-HUMAN-UAT.md` Test 3 / Force-start "does nothing"): wires the missing `slideChipRef.enterActive()` call into `case 'force-start'` in `slide.js:handleChipInlineAction` so the chip transitions out of `awaiting-timeout` after the click — mirroring the wakeup-completion idiom in `dispatchTerminalMode`. Extends `slide-compatibility.spec.js` [Force start] test with a chip-lifecycle assertion as regression-guard.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-09T17:20:50Z
- **Completed:** 2026-05-09T17:24:02Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **Gap 1 root cause closed at the production layer** — `case 'force-start'` in `slide.js:handleChipInlineAction` (lines 399-429) now invokes `slideChipRef.enterActive()` after `enterSendModeInternal(session)` succeeds. With unpatched slide.com (the entire reason force-start exists), no wakeup byte ever arrives, so the production code-path that ordinarily transitions the chip to `'active'` (`dispatchTerminalMode:609-613`) never fires. Without this fix, the chip stayed pinned at `'awaiting-timeout'` showing the same `[Retry] [Cancel] [Force start]` text as before the click — zero visible UI feedback for the user.
- **Regression-guard locked in at the test layer** — `slide-compatibility.spec.js` `[Force start]` test now asserts BOTH `mode === 'send'` (existing) AND `lifecycle === 'active'` (new). The original test was silent on chip lifecycle, which is why CI didn't catch this gap when Plan 11-04 introduced it.
- **Phase 12 zero-Rust invariant preserved** — `cargo test --workspace` 283/283 (sanity-checked at end of Task 2 verification).
- **Real-hardware UAT-12-01 unblocked** — the user can now re-run UAT-12-01 against unpatched `slide.com` (drag-drop a file → wait for the awaiting-timeout chip → click `[Force start]` → observe the chip transition to `'active'` lifecycle); also unblocks force-start as a workaround for Gap 2 (RTS issue) while Plan 12-08 ships the real fix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add chip enterActive() call to slide.js case 'force-start'** — `68a1c27` (fix)
2. **Task 2: Extend slide-compatibility.spec.js to assert chip lifecycle transition after [Force start]** — `d9a42fa` (test)

## Files Created/Modified

- `www/transport/slide.js` (modified, +18/-1) — `case 'force-start'` in `handleChipInlineAction` now calls `slideChipRef.enterActive()` after `enterSendModeInternal(session)` succeeds, guarded by `slideChipRef && typeof slideChipRef.enterActive === 'function'`. Both calls live in the same `try/catch` block so a chip-method exception is logged via the existing error path. Doc-comment block above the branch cites `.planning/debug/12-force-start-button-does-nothing.md` and the reference idiom in `dispatchTerminalMode`.
- `www/tests/transport/slide-compatibility.spec.js` (modified, +9/-0) — `[Force start]` test (lines 269-296) extended with a second `expect.poll()` asserting `window.__slideChip.__getStateForTests().lifecycle === 'active'` after the click, with a 2000 ms timeout (Plan 11-05 chip-lifecycle-poll precedent). New assertion lands BELOW the existing `mode === 'send'` assertion in the SAME test block (preserves the 12-VALIDATION.md `-g` filter anchor name).

## Diary

- **Production fix exact text:**
  ```js
  if (pendingSendSession) {
      const session = pendingSendSession;
      pendingSendSession = null;
      try {
          enterSendModeInternal(session);
          if (slideChipRef && typeof slideChipRef.enterActive === 'function') {
              slideChipRef.enterActive();
          }
      } catch (err) {
          console.error('[slide.js] force-start (chip) enterSendModeInternal failed:', err);
      }
  }
  ```
- **Test assertion exact text:**
  ```js
  // Phase 12.1 Plan 12-07 — chip lifecycle MUST also transition out of
  // 'awaiting-timeout' so the user gets visible feedback on the click.
  // Regression guard for the gap diagnosed in
  // .planning/debug/12-force-start-button-does-nothing.md (force-start
  // case in slide.js previously omitted the enterActive() call).
  await expect.poll(
      () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
      { timeout: 2000 },
  ).toBe('active');
  ```
- **Try/catch placement:** `enterSendModeInternal` and `enterActive()` placed inside the **same** try block (per plan §action). Rationale: chip-method exception is logged via the same error path as dispatcher failures; preserves the single-error-path convention. `enterActive()` is ordered AFTER `enterSendModeInternal` so the chip never shows `'active'` on a still-terminal-mode dispatcher if `enterSendModeInternal` throws.
- **Diagnostic instrumentation:** UNCHANGED across this plan. `slideDbg('handleChipInlineAction:enter', ...)` at the top of `handleChipInlineAction` was preserved per `<instrumentation_preservation>` in execution context. Plan 12-09 owns the cleanup pass for `slideDbg` / `slideDbgHex` / `SLIDE_DEBUG` and all their call sites.

## Decisions Made

- **enterActive() inside same try/catch (vs split try):** Plan §action specified same try; followed verbatim. A split try would log chip-method exceptions to a different sink than dispatcher exceptions and lose the single-error-path convention. The slide.js wakeup-completion reference call site at lines 610-614 uses an outer try/catch wrapper specifically because that call site is in `dispatchTerminalMode` where there is no enclosing try; in `handleChipInlineAction` the existing try/catch is the natural home for the new call.
- **Assertion lands in same test() block:** Plan §action specified inline (not splitting). Plan 11-05's 12-VALIDATION.md `-g` filter convention requires the test name `[Force start] click jumps directly into send mode without waiting for wakeup` to remain unchanged; splitting would either rename the test (breaking the anchor) or duplicate setup (waste).
- **2000 ms expect.poll timeout:** Matches the existing chip-lifecycle poll on line 257 of the same file (precedent set in Plan 11-05 for chip lifecycle polls under parallel test load). Default 5000 ms used only for the `awaiting-timeout` poll because that one waits for the 3-second WAKEUP_TIMEOUT_MS plus connect handshake settling.

## Deviations from Plan

None — plan executed exactly as written. Two atomic commits on the two listed files only; no other files touched.

## Issues Encountered

None. Both Playwright runs at `--workers=1` (single-test `-g "Force start"` and full file scope) green deterministically on first attempt for both Task 1 (existing assertion preserved) and Task 2 (new assertion added).

## Verification Evidence

- **Pre-Task-1 baseline (existing test):** `npx playwright test slide-compatibility.spec.js -g "Force start" --workers=1` — 2 passed (Auto timeout + Force start). Existing `mode === 'send'` assertion still passes after Task 1.
- **Post-Task-2 spec runs (single-test scope):** `npx playwright test slide-compatibility.spec.js -g "Force start" --workers=1` — 2 passed. Both assertions green.
- **Post-Task-2 spec runs (whole file scope, 2 consecutive runs at `--workers=1`):** `npx playwright test slide-compatibility.spec.js --workers=1` — 9/9 passed both runs (parallelism flake check per Phase 11 deferred-items.md precedent).
- **cargo --workspace 283/283:** Per-suite breakdown summed: 166+20+5+3+8+12+6+6+1+6+13+11+12+10+4+0 = 283 (Phase 12 zero-Rust invariant preserved).
- **test:fast at --workers=1:** 81/81 passed deterministically.
- **`git diff HEAD~2 HEAD --stat`:**
  ```
  www/tests/transport/slide-compatibility.spec.js |  9 +++++++++
  www/transport/slide.js                          | 19 ++++++++++++++++++-
  2 files changed, 27 insertions(+), 1 deletion(-)
  ```
  Exactly the two files in plan frontmatter `files_modified`. No deletions, no other touched files.
- **`git log --oneline -2`:**
  ```
  d9a42fa test(12-07): assert chip lifecycle transitions to active after force-start
  68a1c27 fix(12-07): force-start now updates chip lifecycle to active
  ```
  Neither commit message contains AI attribution (per `<commit_message_rule>` and project memory `feedback_commit_messages.md`).

## Requirements Closure

`requirements: [SLIDE-39]` is listed in plan frontmatter for traceability. **SLIDE-39 was already marked `[x] Complete` in REQUIREMENTS.md** (flipped by Phase 11 Plan 11-05). Plan 12-07 is a UAT-gap regression fix — the contract for SLIDE-39 (Settings exposes auto-send command + show-summary checkbox + Compatibility-mode selector) was met at the surface layer in Plan 11-04, but the `[Force start]` button on the wakeup-required chip — wired in Plan 11-04 as the user-facing escape hatch for legacy slide.com — was missing the chip-lifecycle update. This plan repairs the chip lifecycle without flipping any requirement state.

No `requirements mark-complete` invocation needed.

## Next Phase Readiness

- **Real-hardware UAT-12-01 unblocked:** the user can re-run UAT-12-01 against unpatched `slide.com` and exercise force-start as the documented escape hatch with visible UI feedback.
- **Plan 12-08 (RTS-on-connect Settings toggle for Gap 2):** independently ready — Plan 12-07's edits do not touch `serial.js`, `prefs.js`, `index.html`, or `main.js`; force-start now also functions as a temporary workaround for Gap 2 while Plan 12-08 ships the real fix.
- **Plan 12-09 (instrumentation cleanup):** independently ready — `slide.js` instrumentation calls (`slideDbg`, `slideDbgHex`, `SLIDE_DEBUG`) UNCHANGED; this plan's edit slots cleanly alongside them.
- **Phase 12 verify gate:** ready to re-run `/gsd-verify-phase 12` once Plan 12-08 + 12-09 land. The 12-HUMAN-UAT.md Gap 1 row can flip from `severity: major` / status `diagnosed` to `closed` after manual UAT confirmation against real hardware.

## Self-Check: PASSED

- `www/transport/slide.js` — FOUND (modified)
- `www/tests/transport/slide-compatibility.spec.js` — FOUND (modified)
- `.planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-07-SUMMARY.md` — FOUND (this file)
- Commit `68a1c27` (fix Task 1) — FOUND in git log
- Commit `d9a42fa` (test Task 2) — FOUND in git log
- Commit messages contain no AI attribution — verified via `git log --oneline -2` text inspection above

---
*Phase: 12-slide-ux-polish-docs-real-hardware-uat*
*Completed: 2026-05-09*
