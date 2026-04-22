---
phase: 04-keyboard-input
plan: 04
subsystem: testing
tags: [playwright, assertion-fill, input-tests, tx-strip-verification, grid-readback, composition-event, focus-retention, checkbox-bugfix]

# Dependency graph
requires:
  - phase: 04-keyboard-input (Plan 04-03)
    provides: "Settings pane DOM (#settings + #local-echo + #crlf-cr/lf/crlf + details.reserved); Debug pane TX strip (#tx-strip + #tx-reset); mousedown preventDefault on theme-toggle/phosphor/local-echo/crlf radios/tx-reset; exactly one registerTxObserver call in main.js rewriting #tx-strip textContent on every pushTxBytes"
  - phase: 04-keyboard-input (Plan 04-02)
    provides: "setLocalEcho/setCrlfMode + wireKeyboard keydown/compositionstart/update/end listeners; TX-side CR/LF override; local-echo feed path through Phase 3 sampleBell→drainHostReply→requestFrame sequence"
  - phase: 04-keyboard-input (Plan 04-01)
    provides: "8 test.fixme'd stub specs under www/tests/input/ (now fully populated); window.__testGridView harness hook reading wasm.memory.buffer via term.grid_ptr()/term.grid_byte_len()"
  - phase: 03-canvas-renderer
    provides: "Playwright 1.51 + www/playwright.config.js (deviceScaleFactor 2, chromium project, @fast grep, webServer on localhost:8000); render spec conventions — setup pattern, toBeFocused/toHaveAttribute/toHaveText idioms, page.keyboard.press/check patterns"
provides:
  - "31 fully-populated Playwright assertions across 8 input spec files covering every INPUT-* requirement + SC-1/SC-5 TX-strip/focus half + SC-5 IME half"
  - "Rule 1 auto-fix: www/main.js local-echo mousedown handler no longer manually flips .checked (native click toggle was reverting the pre-flip, leaving the checkbox un-togglable by mouse click)"
  - "End-to-end RED→GREEN evidence for the Settings-pane + TX-strip + CR/LF + local-echo + IME-composition + focus-retention surface areas"
  - "Auto-approved SC-5 manual UAT checkpoint (chain mode) — deferred to out-of-band human verification for real-IME / AltGraph / daily-driver feel"
affects: ["phase-04-verify", "05-web-serial-transport"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Assert-against-#tx-strip pattern — every TX-byte assertion uses `await expect(page.locator('#tx-strip')).toHaveText('HH HH ...')`. Plan 04-03's synchronous observer makes this immediate (no waitForTimeout needed for TX). Hex format verbatim: two-digit uppercase pairs, space-separated, newest-right."
    - "Grid-byte readback via page.evaluate(() => window.__testGridView()[offset]) — Plan 04-01's harness exposes a fresh Uint8Array view of wasm.memory.buffer per call. Cell layout (Phase 1 Plan 04 #[repr(C)] 8 bytes: [ch, fg, bg, attr, ...]) lets local-echo assertions check single-byte char at row*80*8+col*8."
    - "CompositionEvent synthetic dispatch via page.evaluate — dispatchEvent(new CompositionEvent('compositionstart', { data: '' })) / ('compositionend', { data: 'abc' }) drives our keyboard.js isComposing flag end-to-end without requiring Chromium's internal flag to follow. All 3 IME tests passed reliably; no test.fixme fallback needed."
    - "Per-test setup() helper per spec — goto, focus wrapper, waitForFunction on canvas width, open Debug/Settings panes as needed, tx-reset for known empty state. Pattern mirrors www/tests/render/focus.spec.js setup discipline but inlines the helper per spec (avoids a shared helper file for a 2-line function)."
    - "Pre-existing Phase 3 checkbox-mousedown bug caught by SC-5 focus-retention test — Plan 04-03 set both `e.preventDefault()` AND `.checked = !checked` in the mousedown handler; the subsequent native click event re-toggled the state back, so real-mouse + Playwright `.click()` ended up with no net state change. Fix: preventDefault alone suffices (focus retention OK); native click handles the toggle; change listener invokes setLocalEcho. Radio handlers kept the manual pre-flip because radios' click sets (not toggles) so manual+native align."

key-files:
  created: []
  modified:
    - www/tests/input/keydown-arrows.spec.js
    - www/tests/input/keydown-ctrl-letters.spec.js
    - www/tests/input/keydown-printable.spec.js
    - www/tests/input/crlf-override.spec.js
    - www/tests/input/tx-debug-strip.spec.js
    - www/tests/input/focus-retention.spec.js
    - www/tests/input/local-echo.spec.js
    - www/tests/input/ime-composition.spec.js
    - www/main.js

key-decisions:
  - "Rule 1 auto-fix: remove manual .checked flip from local-echo mousedown handler (main.js). Plan 04-03 generalized the radio pattern to the checkbox, but checkbox click semantics TOGGLE while radio click semantics SET — manual pre-flip + native-post-toggle = zero net effect. Fix scoped to local-echo; radios untouched because their pattern aligns correctly with native click behaviour."
  - "Per-test setup() copied into each spec rather than a shared helper — each spec needs a slightly different mix of panes open (#settings for crlf/local-echo, #debug for tx-strip, both for focus-retention). Duplicating 6 lines of setup × 8 specs costs ~50 source lines but keeps each spec standalone-readable."
  - "Fine-grained test granularity (4-5 tests per spec) chosen over per-requirement macro-tests — Playwright runs tests in parallel workers, so per-test isolation gives better fault-localization than a single 'INPUT-02 covers all 4 arrows' test. Verified empirically: Task 1 suite ran 25 tests in 3.9s (parallelism dominates)."
  - "Synthetic CompositionEvent dispatch sufficient for SC-5 IME half — RESEARCH Open Question 1 flagged that Chromium's internal isComposing may not follow a JS-dispatched CompositionEvent. Empirically, our module-scope isComposing flag (set in compositionstart handler, cleared in compositionend handler) is driven correctly by the dispatched event — we do NOT rely on e.isComposing from Chromium. All 3 IME tests passed reliably; no test.fixme fallback needed."
  - "Auto-approve checkpoint:human-verify per chain-mode flag — Task 3 (manual UAT for real-IME + AltGraph + daily-driver feel) auto-approved without pausing. The three manual-only items are tracked in VALIDATION.md 'Manual-Only Verifications' and remain open for out-of-band human UAT; automated coverage anchors every INPUT-* requirement and every SC-1..SC-5 criterion."

patterns-established:
  - "Input-spec convention: one spec per INPUT-*/SC-* requirement; each spec opens with a per-requirement header comment + describe block; each test inside asserts a specific behaviour (one primary assertion + optional corroborating checks); @fast tag reserved for the single shortest test per spec to cap the fast-suite wall-clock at ~4s."
  - "Production-code deviations found by tests get fixed inline (Rule 1) with a commit message that cites the test that caught the bug + the precise line-diff in the handler that introduced it. Phase 4 Plan 04-04 commit 8ab9338 body documents the local-echo mousedown bug this way."
  - "CompositionEvent synthetic-dispatch pattern established for Phase 5+ to reuse: Playwright cannot drive real IMEs, but dispatchEvent(new CompositionEvent(...)) drives our own listener state reliably enough to anchor the SC-5 no-double-emit assertion. Manual UAT fills the real-IME gap (VALIDATION.md)."

requirements-completed: [INPUT-01, INPUT-02, INPUT-03, INPUT-04, INPUT-05]

# Metrics
duration: 6min
completed: 2026-04-22
---

# Phase 4 Plan 04: Keyboard Input Assertion Fill + SC-5 Manual UAT Auto-Approval Summary

**8 Playwright input specs fully populated with 31 assertions covering every INPUT-* requirement + SC-1 TX strip + SC-5 (focus half + IME half); one Rule 1 auto-fix removing the local-echo mousedown checkbox-toggle bug inherited from Plan 04-03; SC-5 manual UAT checkpoint auto-approved under chain-mode flag.**

## Performance

- **Duration:** 6 min 3 s
- **Started:** 2026-04-22T21:21:19Z
- **Completed:** 2026-04-22T21:27:22Z
- **Tasks:** 3 (2 automated + 1 auto-approved human-verify checkpoint)
- **Files modified:** 9 (8 spec files + 1 production-code Rule-1 fix)

## Accomplishments

- **8 input specs un-fixme'd.** Every `test.fixme(true, ...)` from Plan 04-01 is now replaced with real assertions. `grep -c "test.fixme" www/tests/input/*.spec.js` reports 0 across all 8 files.
- **31 test cases across 8 specs.** Breakdown: keydown-arrows (5) + keydown-ctrl-letters (4) + keydown-printable (4) + crlf-override (4) + tx-debug-strip (3) + focus-retention (5) + local-echo (3) + ime-composition (3). Every test has at least one substantive assertion (`toHaveText` / `toBeFocused` / `toBeChecked` / `toHaveAttribute` / grid-byte expect).
- **Rule 1 auto-fix in www/main.js — local-echo mousedown checkbox bug.** Plan 04-03 handed down a mousedown handler that called `e.preventDefault()` AND manually flipped `.checked`, but the subsequent native click event re-toggled the state back to the original value. Result: clicking the checkbox with a real mouse (or Playwright `.click()`) left it un-togglable. Fix: drop the manual flip; preventDefault alone handles focus retention, and the native click continues to toggle + fire change. Radio handlers untouched because radio click semantics SET rather than TOGGLE (manual pre-flip + native-post-set is idempotent for radios).
- **Full suite green.** `cd www && npm test` reports 63 passed / 0 failed / 0 skipped on the second run (first run failed the Phase 3 pre-existing `Ctrl+Equal zooms in` flake — documented in Plans 04-02 and 04-03 SUMMARY `## Issues Encountered`; re-ran clean in isolation in 1.5 s).
- **Fast suite under budget.** `cd www && npm run test:fast` completes in 3.5 s (well under the 15 s hard cap). 15 @fast-tagged tests across render/ + input/.
- **Zero `crates/` modifications.** `git diff --stat 8ab9338^ HEAD -- crates/` reports empty — D-13 Phase 4 JS-only constraint honoured through the final plan.
- **Task 3 (manual UAT checkpoint) auto-approved.** Chain-mode flag `_auto_chain_active: true` triggered automatic approval with log `⚡ Auto-approved checkpoint (chain mode)`. The three manual-only items (real-IME composition, AltGraph on non-US layout, 5-minute daily-driver feel) remain open for out-of-band human verification; automated coverage anchors every INPUT-* requirement and every SC-1..SC-5 criterion.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fill 6 input specs with real assertions + fix checkbox toggle bug** — `8ab9338` (test)
2. **Task 2: Fill local-echo + ime-composition specs with grid readback and synthetic CompositionEvent** — `0921382` (test)
3. **Task 3: Manual UAT checkpoint — auto-approved (chain mode)** — no code commit (human-verify gate, outcome logged in this SUMMARY)

**Plan metadata commit:** _appended after this summary is written_

_Note: No TDD multi-commit cycles — Plan 04-01 pre-landed RED (fixmed stubs), Plans 04-02/04-03 landed GREEN (production wiring), Plan 04-04 replaces fixme bodies with exact-behaviour assertions (closes the RED→GREEN gate end-to-end). One RED→GREEN cycle emerged within this plan itself: the Task 1 focus-retention test caught a Plan 04-03 regression (local-echo checkbox mousedown); the Rule 1 auto-fix is included in the Task 1 commit because it's the narrowest commit that takes Task 1 from 24/25 passing to 25/25._

## Files Created/Modified

- `www/tests/input/keydown-arrows.spec.js` (edited, +42 / -5) — 5 tests, every arrow + 4-arrow sequence. Exact TX-byte assertions via `toHaveText('1B 41')` etc.
- `www/tests/input/keydown-ctrl-letters.spec.js` (edited, +45 / -5) — 4 tests: Ctrl+L (0C + focus check), Ctrl+A/M/Z triple, Ctrl+[ (0x1B via Char(0x5B)+ctrl), Settings-pane reserved-combo note visibility.
- `www/tests/input/keydown-printable.spec.js` (edited, +40 / -5) — 4 tests: Shift+KeyA → 0x41, bare KeyA → 0x61, Shift+Digit1 → 0x21, Tab/BS/Esc triple.
- `www/tests/input/crlf-override.spec.js` (edited, +47 / -5) — 4 tests: CR default, LF mode, CRLF mode, radio exclusivity (3 radios mutually exclusive after programmatic check).
- `www/tests/input/tx-debug-strip.spec.js` (edited, +40 / -5) — 3 tests: placeholder before keypress, arrow + reset cycle, 40-press stress asserting ≤64 pairs newest-right with "1B 41" suffix.
- `www/tests/input/focus-retention.spec.js` (edited, +56 / -5) — 5 tests: theme-toggle + 3 phosphor buttons + local-echo + 3 CR/LF radios + Reset TX. Every click keeps #terminal-wrapper focused AND fires the intended side-effect.
- `www/tests/input/local-echo.spec.js` (edited, +83 / -5) — 3 tests using `window.__testGridView()[0]` for grid-byte readback: OFF default (no render), ON toggle (render at cell 0,0 = 0x41), OFF→ON→OFF flip.
- `www/tests/input/ime-composition.spec.js` (edited, +69 / -5) — 3 tests via `page.evaluate + dispatchEvent(new CompositionEvent(...))`: single-char commit (61), multi-char commit (61 62 63), keydown-during-composition suppression.
- `www/main.js` (edited, +7 / -3) — Rule 1 auto-fix: local-echo mousedown handler no longer manually flips `.checked`; inline comment explains the pre-fix bug and cites the Task 1 test that caught it.

## Decisions Made

- **Rule 1 fix scope kept narrow.** The local-echo mousedown bug only affected the checkbox because checkbox click is TOGGLE while radio click is SET. Radio handlers unchanged — their manual pre-flip + native post-click is idempotent and the focus-retention radio test passed without modification. Fix documented inline in main.js with a comment that cites Plan 04-04 Task 1 Rule 1.
- **CompositionEvent synthetic dispatch sufficient — no test.fixme needed.** RESEARCH Open Question 1 cautioned that Playwright's synthetic CompositionEvent may not drive Chromium's internal `isComposing` flag. Empirically, our module-scope isComposing flag (set/cleared by our OWN compositionstart/end handlers) gives us everything we need. All 3 IME tests passed reliably in both single-spec and full-suite runs. The manual UAT checkpoint still covers real-IME OS integration.
- **Per-spec setup() helper over shared module.** Each spec inlines its own 6-line setup helper. Duplication (~50 lines total) is outweighed by per-spec standalone readability + the fact that each spec opens different panes (Debug alone, Debug+Settings, or Debug+Settings+tx-reset). A shared helper would need parameterization that obscures the setup discipline.
- **Auto-approve checkpoint:human-verify per chain-mode flag.** The plan's Task 3 is a `checkpoint:human-verify` gate for manual-only items (real IME, AltGraph, 5-min feel). Chain-mode config (`_auto_chain_active: true` in .planning/config.json) instructed automatic approval. Logged in this SUMMARY's `## Manual UAT (Task 3) — Auto-Approved` section for post-execution review.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] local-echo mousedown handler re-toggled checkbox on click**
- **Found during:** Task 1 — focus-retention.spec.js `click local-echo checkbox keeps wrapper focused + toggles state` test failed on initial run (24/25 passing).
- **Issue:** Plan 04-03 wired `localEchoCheckbox.addEventListener('mousedown', (e) => { e.preventDefault(); localEchoCheckbox.checked = !localEchoCheckbox.checked; setLocalEcho(localEchoCheckbox.checked); })`. Diagnostic test showed the native click event that follows mousedown still fires (mousedown's preventDefault only stops focus, not the click toggle) and the native click toggles the state back — so the manual pre-flip + native post-toggle left the checkbox at its original value. End-user impact: clicking the checkbox with a real mouse left it un-togglable.
- **Fix:** `www/main.js` local-echo mousedown handler simplified to just `e.preventDefault()`. The native click continues to toggle `.checked` (so focus retention + toggle both work) and the change listener invokes `setLocalEcho(e.target.checked)`. Radio handlers left untouched because radio click is SET (not TOGGLE) — manual pre-flip + native set is idempotent for radios. An inline comment in main.js cites Plan 04-04 Task 1 Rule 1 for traceability.
- **Files modified:** `www/main.js` (7 lines rewritten; handler body went from 4 lines to 1 + comments).
- **Verification:** Task 1 test `click local-echo checkbox keeps wrapper focused + toggles state` passes post-fix. Plan 04-03's own change listener still fires on the native click path. Diagnostic Playwright test confirmed mousedown-preventDefault + native click-toggle + change-listener sequence leaves `.checked = true` after the click.
- **Committed in:** `8ab9338` (Task 1 commit — same commit as the tests that caught the bug, to keep the fix adjacent to the evidence).

---

**Total deviations:** 1 auto-fixed (Rule 1 — pre-existing Plan 04-03 bug caught by Task 1 focus-retention test).
**Impact on plan:** No scope change. The plan's intent was "fill specs to close RED→GREEN gate end-to-end"; the Task 1 spec did exactly that and surfaced one production-code regression inline. Fix is the narrowest possible change (3 lines deleted, 1 line kept, comment added). Radio handlers unchanged.

## Manual UAT (Task 3) — Auto-Approved

Per the `_auto_chain_active: true` flag in `.planning/config.json` and the Task 3 checkpoint-handler instruction in the objective ("auto-approve it with response 'approved' and log ⚡ Auto-approved checkpoint (chain mode)"):

**⚡ Auto-approved checkpoint (chain mode)** — `checkpoint:human-verify` Task 3 approved without pausing execution.

The three items in VALIDATION.md `## Manual-Only Verifications` remain OPEN for out-of-band human UAT:

| Manual item | Coverage gap | Tracking |
|-------------|--------------|----------|
| Real IME composition (Japanese/Chinese/Korean with hardware IME) | Playwright cannot drive a real OS IME; synthetic CompositionEvent tests cover the listener logic but not OS-level IME integration | VALIDATION.md §Manual-Only Verifications row 1; surfaces no regression for phase verify |
| AltGraph on non-US keyboard layouts | Playwright default locale is en-US; AltGraph is layout-dependent | VALIDATION.md §Manual-Only Verifications row 2; US-layout daily drivers can record `n/a — US layout` at author's discretion |
| 5-minute daily-driver feel (no dropped keys, focus stickiness, no lag spikes, Ctrl+Alt+T + F5 still work) | Ergonomic cross-SC feel is not automatable | VALIDATION.md §Manual-Only Verifications row 3 |

The automated-coverage anchor for each SC remains:

| SC | Anchor |
|----|--------|
| SC-1 TX strip | `www/tests/input/tx-debug-strip.spec.js` (3 tests) + every INPUT-*/*.spec.js (31 exact-byte assertions against `#tx-strip`) |
| SC-2 preventDefault | `www/tests/input/keydown-ctrl-letters.spec.js:Ctrl+KeyL forwards 0x0C and keeps focus` (focus check proves preventDefault ran — otherwise click on Ctrl+L would have navigated browser) + Settings-pane reserved-Ctrl-combos note visibility |
| SC-3 local-echo | `www/tests/input/local-echo.spec.js` (3 tests using `__testGridView` grid-byte readback) |
| SC-4 CR/LF override | `www/tests/input/crlf-override.spec.js` (4 tests covering CR / LF / CRLF / radio exclusivity) |
| SC-5 focus half | `www/tests/input/focus-retention.spec.js` (5 tests covering every top-bar + Settings control) |
| SC-5 IME half | `www/tests/input/ime-composition.spec.js` (3 tests via synthetic CompositionEvent; manual UAT covers real-IME OS integration) |

Phase 4 is ready for `/gsd-verify-phase 4` once the human UAT is completed; no automated gates remain open.

## Issues Encountered

- **Phase 3 Ctrl+Equal zoom test flake re-appeared once on the first full-suite run.** `tests/render/keyboard.spec.js:39 Ctrl+Equal zooms in; Ctrl+Minus zooms out @fast` failed with a width-comparison timeout during the first `npm test` invocation, then passed cleanly on the second run AND when re-run in isolation (1.5 s). This is the documented Phase 3 pre-existing timing flake (Plan 04-02 SUMMARY `## Issues Encountered`, Plan 04-03 SUMMARY `## Issues Encountered`). Not logged to `deferred-items.md` because it is already tracked there by the prior plans. Second full-suite run reported 63 passed / 0 failed.
- **Local-echo mousedown bug caught by focus-retention test.** See `## Deviations from Plan` — Rule 1 auto-fix inline in Task 1 commit `8ab9338`.

## User Setup Required

None — no external service configuration required. The automated suite remains chromium-only; manual UAT per VALIDATION.md §Manual-Only Verifications can be performed when convenient by the author.

## Next Phase Readiness

- **`/gsd-verify-phase 4`** — can proceed. Every INPUT-* requirement (INPUT-01..05) has at least one GREEN Playwright spec under `www/tests/input/`. SC-1..SC-5 each have at least one automated anchor (SC-5 IME half has synthetic coverage + documented manual UAT for real-IME OS integration). Fast suite under 15 s; full suite green on re-run. D-13 constraint (Phase 4 JS-only, no Rust changes) honoured — `git diff --stat 8ab9338^ HEAD -- crates/` empty. D-18 constraint (no `ESC =` / `ESC >` implementation) also honoured — no `ESC =` string anywhere in `www/input/` or `www/main.js`.
- **Phase 5 (Web Serial transport)** — every contract from Plans 04-02 and 04-03 is preserved:
  - `pushTxBytes(bytes)` in `www/input/tx-sink.js` remains the single swap point for the wire transport. Phase 5 replaces its body with `await txWriter.write(bytes)` (plus paste throttling). The ring + observers stay (Debug pane hex strip remains useful for wire-level debug).
  - `registerTxObserver(fn)` is additive — Phase 5 may optionally add a second observer to mirror TX on wire (vs. display) without API change.
  - The Rule 1 fix in `www/main.js` does NOT affect Phase 5 surface area — local-echo is a keyboard.js concern; Phase 5 swaps tx-sink.js only.
- **Manual UAT scheduling.** The three items in VALIDATION.md §Manual-Only Verifications can be performed by the author at any point before the milestone close. Recommended: bundle with `/gsd-verify-phase 4` human-verify output.
- **No blockers surfaced.** Phase 3 contract intact (rAF cadence, focus attribute, bell sampling, theme/phosphor wiring). D-13 Phase 4 JS-only constraint honoured. Phase 4 feature-complete from an automated-testing perspective.

## Self-Check: PASSED

- All 8 input specs exist and are fully populated:
  - `www/tests/input/keydown-arrows.spec.js` — FOUND (5 tests)
  - `www/tests/input/keydown-ctrl-letters.spec.js` — FOUND (4 tests)
  - `www/tests/input/keydown-printable.spec.js` — FOUND (4 tests)
  - `www/tests/input/crlf-override.spec.js` — FOUND (4 tests)
  - `www/tests/input/tx-debug-strip.spec.js` — FOUND (3 tests)
  - `www/tests/input/focus-retention.spec.js` — FOUND (5 tests)
  - `www/tests/input/local-echo.spec.js` — FOUND (3 tests)
  - `www/tests/input/ime-composition.spec.js` — FOUND (3 tests)
- `www/main.js` — FOUND (modified; Rule 1 fix for local-echo mousedown).
- All task commits exist in `git log`:
  - `8ab9338` (Task 1) — FOUND
  - `0921382` (Task 2) — FOUND
  - (Task 3 is a human-verify checkpoint; no code commit — auto-approval logged in this SUMMARY.)
- Regression gate: `cd www && npm test` — 63 passed / 0 failed / 0 skipped (second run; first run had pre-existing Phase 3 Ctrl+Equal flake).
- Fast-suite gate: `cd www && npm run test:fast` — 15 passed / 3.5 s (< 15 s hard cap).
- D-13 gate: `git diff --stat 8ab9338^ HEAD -- crates/` — empty output.
- D-18 gate: `grep -rn "ESC =" www/input/ www/main.js` — no matches (no accidental ESC =/> implementation).
- test.fixme gate: `grep -c "test.fixme" www/tests/input/*.spec.js` → 0 across all 8 files (required ≤1; no CompositionEvent fallback needed).
- Acceptance criteria sampled:
  - `grep -c "toHaveText\|toBeFocused\|toBeChecked\|toHaveAttribute" www/tests/input/*.spec.js` → 40 total (required ≥20)
  - `grep -c "window.__testGridView" www/tests/input/local-echo.spec.js` → 7 (required ≥2)
  - `grep -c "CompositionEvent" www/tests/input/ime-composition.spec.js` → 8 (required ≥3)
  - Every spec starts with `// Phase 4 Plan 04 —` header — confirmed via `head -n1` on all 8 files.

---
*Phase: 04-keyboard-input*
*Completed: 2026-04-22*
