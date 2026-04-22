---
phase: 04-keyboard-input
plan: 03
subsystem: ui
tags: [settings-pane, tx-hex-strip, mousedown-preventdefault, focus-retention, details-pane, radio-group, checkbox, ui-wiring]

# Dependency graph
requires:
  - phase: 04-keyboard-input (Plan 04-02)
    provides: "setLocalEcho / setCrlfMode / getLocalEcho / getCrlfMode exports from www/input/keyboard.js; registerTxObserver / formatHexStrip / resetTx / pushTxBytes exports from www/input/tx-sink.js"
  - phase: 04-keyboard-input (Plan 04-01)
    provides: "8 fixmed Playwright stubs under www/tests/input/ (Plan 04-04 un-fixmes them); window.__testGridView harness hook"
  - phase: 03-canvas-renderer
    provides: "Debug <details> pane pattern (www/index.html:133-165 + 187-201); top-bar chrome (theme-toggle + 3 phosphor buttons); [data-focused] attribute contract; chrome.js wireX(opts) entry pattern"
provides:
  - "Settings <details> pane in www/index.html with default-unchecked local-echo checkbox, CR/LF 3-way radio group (CR default), and nested Browser-reserved-Ctrl-combinations note"
  - "Debug pane extended with 'TX bytes (last 64):' hint, <pre id=\"tx-strip\"> placeholder, and Reset TX button"
  - "Mousedown preventDefault on all Phase-4 click targets: theme-toggle, 3 phosphor buttons (chrome.js), local-echo, 3 CR/LF radios, tx-reset (main.js) — clicks keep #terminal-wrapper focused"
  - "Live TX hex strip: registered exactly once via registerTxObserver; textContent updates synchronously after every pushTxBytes; placeholder restored when ring is empty"
  - "Full INPUT-03 (browser-reserved note) + INPUT-04 (local-echo toggle) + INPUT-05 (CR/LF override) user-visible wiring"
affects: ["04-04-assertion-fill", "05-web-serial-transport"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mousedown preventDefault + explicit state restore for native form controls — suppresses focus transfer AND native click-toggle semantics, so main.js explicitly flips checkbox.checked / radio.checked after preventDefault and invokes the corresponding setter (setLocalEcho / setCrlfMode / resetTx). Matches UI-SPEC Interaction Contracts verbatim."
    - "Observer registration at boot (module-lifetime, no deregister) — exactly one registerTxObserver call in main.js; fires synchronously after every pushTxBytes; placeholder fallback when formatHexStrip(64) returns empty string"
    - "Settings pane as sibling <details> of Debug pane, DOM-ordered below #terminal-wrapper and above #debug (D-13 frequency-of-access ordering); CSS mirrors #debug block verbatim except for the selector (reuses --chrome-bg / --chrome-border / --chrome-fg; zero new color tokens)"
    - "Sibling mousedown listener next to each existing click handler in chrome.js (not folded into click) — click fires on keyboard activation where preventDefault would be a no-op that reads oddly; mousedown only fires on pointer path"

key-files:
  created: []
  modified:
    - www/index.html
    - www/renderer/chrome.js
    - www/main.js

key-decisions:
  - "mousedown-preventDefault on native form controls (checkbox + radios) requires an explicit JS restore of the toggle state — native click-toggle semantics are cancelled along with focus transfer. UI-SPEC Interaction Contracts calls this out explicitly; main.js implements: (1) setState() from change listener AND (2) manual .checked flip + setState() from mousedown listener (the mousedown path is load-bearing for mouse activation; the change path is load-bearing for keyboard activation)"
  - "CR/LF radio mousedown restore also clears sibling radios manually. Native radio exclusivity is driven by the click event, which mousedown preventDefault suppresses, so we emulate the exclusion in JS (iterate crlfRadios; if !== this, .checked = false)"
  - "Reset TX button wires BOTH click and mousedown handlers to resetTx() — click for keyboard activation (Tab + Space/Enter), mousedown for mouse activation (because preventDefault cancels the native click path). Both handlers are idempotent (resetTx fills ring with zeros; double-invocation is a no-op on zeroed state)"
  - "Plan's <automated> verify for Task 2 specified 'grep -c \"mousedown\" chrome.js == 2', but the plan's own action block added 3 comment lines containing the word 'mousedown' (verbatim copy from UI-SPEC). Documented as Rule 1 (verify script bug, not implementation bug); the detailed <acceptance_criteria> — which ARE implementation-checking — all pass"

patterns-established:
  - "Phase 4 chrome-wiring split: chrome.js owns top-bar (theme-toggle + 3 phosphor) mousedowns; main.js owns Settings-pane (local-echo + 3 CR/LF) and Debug-pane (tx-reset) mousedowns. Rationale: chrome.js already imported every top-bar ref; Settings/Debug refs are resolved in main.js where the DOM-to-keyboard-handler wiring already lives"
  - "TX strip observer contract: main.js is the ONLY registerTxObserver caller in v1 (module-lifetime, no deregister). Phase 5 Web Serial may add a second observer if it needs to mirror TX on wire (vs. display). No API change needed — observers.push is idempotent at registration site"
  - "Settings pane CSS block mirrors Debug pane rule-for-rule: same 16px auto margin, 90ch max-width, 8px 16px padding, var(--chrome-bg) background, var(--chrome-border) border, 12px body font-size, 14px summary font-size. Phase 4 adds ONE new typography size: 13px for <label> and <legend> (UI-SPEC Typography §Rationale for 13px Label)"

requirements-completed: [INPUT-03, INPUT-04, INPUT-05]

# Metrics
duration: 5min
completed: 2026-04-22
---

# Phase 4 Plan 03: Settings Pane + TX-Strip + Mousedown Focus-Retention Summary

**Settings <details> pane with local-echo checkbox, CR/LF radio group, and Browser-reserved Ctrl note; Debug pane extended with live TX hex strip + Reset TX button; mousedown preventDefault on every Phase-4 click target so #terminal-wrapper never loses focus to chrome clicks.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-22T21:10:16Z
- **Completed:** 2026-04-22T21:15:06Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **`www/index.html` — Settings pane + Debug TX strip + CSS.** New `<details id="settings">` with the INPUT-04 local-echo checkbox (default unchecked), the INPUT-05 CR/LF 3-way radio group (CR checked by default per UI-SPEC D-12), and the INPUT-03 `<details class="reserved">` Browser-reserved-Ctrl note. Debug pane extended with a `<p class="hint">TX bytes (last 64):</p>`, `<pre id="tx-strip">` placeholder, and a `Reset TX` button. A new CSS block for `#settings` and `#tx-strip` mirrors the existing `#debug` block (same spacing/border/background tokens); zero new color tokens, one new typography size (13px for `<label>` / `<legend>`).
- **`www/renderer/chrome.js` — Mousedown preventDefault on top-bar buttons.** `themeButton` and the three phosphor buttons each gain a sibling `mousedown` listener that calls `e.preventDefault()`. Click handlers still fire (separate event) so theme/phosphor state still mutates on pointer path; keyboard activation (Tab + Space) is unaffected because `mousedown` doesn't fire on keyboard activation. Existing keydown chord block, focus/blur listeners, visibilitychange listener, and click-to-focus handler all preserved verbatim.
- **`www/main.js` — Settings controls + TX observer + Reset TX wiring.** Imports extended to include `setLocalEcho` + `setCrlfMode` from keyboard.js and `resetTx` from tx-sink.js. Resolves `#local-echo` / `input[name="crlf"]` / `#tx-strip` / `#tx-reset` DOM refs. Wires: `change` + `mousedown` on the checkbox (explicit toggle restore); `change` + `mousedown` on each CR/LF radio (explicit check + sibling-clear + setCrlfMode); exactly one `registerTxObserver` call that writes `formatHexStrip(64)` (or the placeholder when the ring is empty) to `#tx-strip.textContent`; `click` + `mousedown` on `#tx-reset` (both invoke `resetTx()`).
- **Zero Phase 3 regressions.** `cd www && npm test` ran clean after each task commit: 32 render tests passed, 8 input stubs skipped (Plan 04-04 un-fixmes them), 0 failures. One Phase-3-pre-existing theme-toggle flake surfaced once during Task 1 verification (documented in Plan 04-02 SUMMARY `## Issues Encountered`); re-running the spec in isolation confirmed the flake rather than a regression, and subsequent full-suite runs passed.
- **Zero `crates/` modifications.** `git diff --stat HEAD~3 HEAD -- crates/` reports empty — D-13 Phase 4 JS-only constraint honoured.
- **Zero ESC =/> accidental implementation.** `grep -rn "ESC =" www/input/ www/main.js` returns nothing — D-18 deferral preserved.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Settings pane + TX hex strip + Reset TX to index.html (DOM + CSS)** — `ece6baf` (feat)
2. **Task 2: Add mousedown preventDefault to top-bar buttons in chrome.js** — `703a4ff` (feat)
3. **Task 3: Wire Settings controls + TX observer + Reset TX + Settings mousedown in main.js** — `37a21cd` (feat)

**Plan metadata commit:** _appended after this summary is written_

_Note: No TDD multi-commit cycles — Plan 04-03 lands production-behaviour wiring against APIs that Plan 04-02 already implemented; Plan 04-04 will un-fixme the Plan 04-01 stub specs to provide end-to-end RED→GREEN evidence for the Settings-pane + TX-strip surface area._

## Files Created/Modified

- `www/index.html` (edited, +81 lines / -0) — added `#settings` CSS block (mirrors `#debug`, 13px label size per UI-SPEC), added `#tx-strip` CSS rule (monospace, #0f1419 bg matching `#debug textarea`, `min-height: 1.4em` to reserve a line for the placeholder), inserted `<details id="settings">` with checkbox + fieldset + nested reserved `<details>`, inserted `<p class="hint">` + `<pre id="tx-strip">` + `<button id="tx-reset">` inside the Debug pane immediately after the existing Feed / 64 KB Stress `<div>`.
- `www/renderer/chrome.js` (edited, +12 lines / -0) — 2 new mousedown listeners (one on `themeButton`, one inside the phosphor-button `for` loop, with an inline comment pointing at D-16 in each case). No other changes.
- `www/main.js` (edited, +63 lines / -2) — extended two existing import lines, resolved 4 new DOM refs alongside existing chrome refs, defined `TX_STRIP_PLACEHOLDER` constant with the UI-SPEC verbatim copy (em-dash U+2014), wired 2 listeners per Settings control (change + mousedown), registered exactly one TX observer, wired click + mousedown on `#tx-reset`. Existing `wireKeyboard({...})` call, Feed handler, 64 KB Stress handler, host-reply drain helper, sampleBell helper, and `window.__testGridView` hook all preserved verbatim.

## Decisions Made

- **Mousedown preventDefault + explicit state restore is load-bearing, not optional.** When `mousedown` preventDefault fires on a native `<input type="checkbox">` or `<input type="radio">`, Chromium suppresses BOTH the native focus transfer AND the native click-to-toggle/click-to-check semantics. UI-SPEC Interaction Contracts calls this out explicitly in its Focus Retention table; main.js implements the restore as: (1) flip `.checked` programmatically in the mousedown handler, (2) for radios, manually clear sibling radios (native radio-group exclusion is ALSO suppressed along with click), (3) call the corresponding setter so keyboard.js state mirrors the DOM. Keyboard activation (Tab + Space) goes through the `change` listener, which continues to work because `mousedown` doesn't fire on keyboard activation.
- **Reset TX needs both click AND mousedown handlers.** Click handles keyboard activation (Tab + Space/Enter), mousedown handles mouse activation (because preventDefault cancels the native click path). Both call `resetTx()` directly; double-invocation is safe because `ring.fill(0)` on an already-zeroed ring is a no-op.
- **Settings pane CSS mirrors Debug pane.** The only typography addition is 13px for `<label>` and `<legend>` — UI-SPEC justifies this as the single step in the existing scale (summary 14 > label 13 > hint 12) that gives Settings controls visual hierarchy without introducing a new scale dimension. Everything else (margin, padding, border, background, summary font-size, hint color) is a verbatim copy of the `#debug` block.
- **One TX observer only.** main.js is the sole `registerTxObserver` caller in v1; the observer rewrites `textContent` synchronously after each `pushTxBytes`. No polling, no rAF dependency — satisfies SC-1 "instant verifiability" (author presses ArrowUp, immediately sees `1B 41` in the Debug pane).
- **Plan Task 2 verify script has a known limitation documented, not a code issue.** The plan's `<automated>` block asserts `grep -c "mousedown" chrome.js == 2`, but the plan's own action block inserts 3 comment lines that contain the word "mousedown" (verbatim from UI-SPEC D-16 rationale). The resulting count is 5 (2 bindings + 3 comment mentions). The detailed `<acceptance_criteria>` — which assert the specific bindings — all pass: `themeButton.addEventListener('mousedown'` == 1, `btn.addEventListener('mousedown'` == 1, `e.preventDefault` >= 5 (6 actual: 3 chord preventDefaults + 2 new mousedown preventDefaults + 1 existing `Ctrl+Shift+T` guard that Phase 3 commit left in place). Recorded as Rule 1 in Deviations below — the verify script's shape, not the implementation, was the anomaly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Verify script mismatch] Task 2 `<automated>` grep count expected 2 but plan action generates 5**
- **Found during:** Task 2 (chrome.js mousedown wiring verification)
- **Issue:** The plan's Task 2 `<automated>` verification block asserts `grep -c "mousedown" www/renderer/chrome.js == 2`. The plan's own action block, however, inserts three comment lines that contain the word "mousedown" (the D-16 rationale explaining why mousedown+preventDefault is the right mechanism — copied verbatim from UI-SPEC §Focus retention). After applying the action block exactly as specified, the count is 5 (2 listener bindings + 3 comment mentions).
- **Fix:** No code change needed — this is a plan-text-vs-verify-script inconsistency, not an implementation bug. Verified the actual implementation against the detailed `<acceptance_criteria>` block instead: `themeButton.addEventListener('mousedown'` count == 1 (OK), `btn.addEventListener('mousedown'` count == 1 (OK), `e.preventDefault` count >= 5 (OK — 6 actual), `keydown` listener preserved (OK — 1), `focus` listener preserved (OK — 1), `visibilitychange` preserved (OK — 1 binding, 1 comment). Additionally ran the full Playwright render suite (`npx playwright test tests/render/`) — all 32 tests pass.
- **Files modified:** None (documentation-level deviation).
- **Verification:** See Task 2 commit `703a4ff` body — it explicitly cites this and links the detailed acceptance criteria that DO hold. Full regression suite green after the commit.
- **Committed in:** `703a4ff` (Task 2 commit — no separate commit needed because the implementation is exactly what the plan's action block describes).

---

**Total deviations:** 1 auto-fixed (Rule 1 — verify script inconsistency with plan's own action text).
**Impact on plan:** No scope change, no code change. The plan's action block was correct; the coarse `<automated>` grep was imprecise. Specific `<acceptance_criteria>` all hold, and the full Playwright suite is green. Recorded here so future plans avoid the same verify-script shape (prefer `grep -c "specific_pattern"` over `grep -c "common_word"`).

## Issues Encountered

- **Phase 3 theme-toggle flake surfaced once during Task 1 verification.** On the first `npm test` run after Task 1 (`feat: add Settings pane to index.html`), the `Ctrl+Alt+T toggles theme — gap #4 remap @fast` spec in `www/tests/render/theme-toggle.spec.js:19` failed with `Expected: "clean", Received: "crt"` after 5 s. Plan 04-02's `## Issues Encountered` already documented this as a Phase 3 timing sensitivity (rAF race + fullyParallel worker contention), not a Plan 04-0X regression. Re-running `tests/render/theme-toggle.spec.js` in isolation passed all 5 tests in 1.9 s; subsequent full-suite runs (after Task 2 and Task 3) passed 32/32. Not logged to `deferred-items.md` because it is a pre-existing Phase 3 flake that is already tracked there by Plan 04-02.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 04-04 (assertion fill)** can now un-fixme all 8 Playwright stubs under `www/tests/input/` and fill real assertions:
  - `keydown-arrows.spec.js`, `keydown-ctrl-letters.spec.js`, `keydown-printable.spec.js`, `ime-composition.spec.js` — assert against `#tx-strip.textContent` (Plan 04-03's live observer).
  - `local-echo.spec.js` — check `#local-echo` checkbox via mouse `.click()` or `.check()`, assert `window.__testGridView()` contents after keypress (grid updated when echo is on; unchanged when off).
  - `crlf-override.spec.js` — `.check()` each CR/LF radio, press Enter, assert `#tx-strip.textContent` shows `0D` / `0A` / `0D 0A`.
  - `focus-retention.spec.js` — `.click()` every chrome control, `expect(#terminal-wrapper).toBeFocused()` after each. Also: `.click()` `#local-echo` → assert `document.activeElement.id === 'terminal-wrapper'` AND `#local-echo.checked` is true (explicit-restore pattern).
  - `tx-debug-strip.spec.js` — assert initial `#tx-strip.textContent` equals the placeholder string; press a key; assert updated; click `#tx-reset`; assert placeholder returns.
- **Phase 5 (Web Serial transport)** — `pushTxBytes(bytes)` in tx-sink.js remains the single swap point (Plan 04-02 contract). Plan 04-03 adds no new swap points; the Settings pane controls and TX observer are orthogonal to the wire transport. Phase 5 may optionally add a second TX observer (to mirror TX on wire vs. display) — registration is additive; no API change needed.
- **No blockers surfaced.** Phase 3 contract intact (rAF cadence, focus attribute, bell sampling). D-13 Phase 4 JS-only constraint honoured (zero `crates/` modifications). D-18 ESC =/> deferral honoured (zero accidental implementation). UI-SPEC §Copywriting Contract honoured (verbatim copy strings including em-dash U+2014). UI-SPEC §Color honoured (zero new color tokens).

## Self-Check: PASSED

- All modified files exist:
  - `www/index.html` — FOUND (modified)
  - `www/renderer/chrome.js` — FOUND (modified)
  - `www/main.js` — FOUND (modified)
- All task commits exist in `git log`:
  - `ece6baf` (Task 1) — FOUND
  - `703a4ff` (Task 2) — FOUND
  - `37a21cd` (Task 3) — FOUND
- Regression gate: `cd www && npm test` — 32 render tests passed / 8 input stubs skipped / 0 failures.
- D-13 gate: `git diff --stat HEAD~3 HEAD -- crates/` — empty output (zero crates/ modifications).
- D-18 gate: `grep -rn "ESC =" www/input/ www/main.js` — no matches (no accidental ESC =/> implementation).
- Acceptance criteria sampled:
  - `grep -c 'id="settings"' www/index.html` → 1
  - `grep -c 'id="local-echo"' www/index.html` → 1
  - `grep -c 'id="crlf-cr"' www/index.html` → 1 (and same line contains `checked`)
  - `grep -c 'id="tx-strip"' www/index.html` → 1
  - `grep -c 'id="tx-reset"' www/index.html` → 1
  - DOM order: settings pane at line 242, debug pane at line 265 (settings < debug)
  - `grep -c "themeButton.addEventListener('mousedown'" www/renderer/chrome.js` → 1
  - `grep -c "btn.addEventListener('mousedown'" www/renderer/chrome.js` → 1
  - `grep -c "setLocalEcho" www/main.js` → 4 (import + change + mousedown + (implicit via destructure: 0))
  - `grep -c "setCrlfMode" www/main.js` → 4 (import + change + mousedown + (implicit: 0))
  - `grep -c "registerTxObserver" www/main.js` → 2 (1 import + 1 call)
  - `grep -c "resetTx()" www/main.js` → 2 (click + mousedown)
  - `grep -c "TX_STRIP_PLACEHOLDER" www/main.js` → 2 (declaration + usage)
  - `node --check www/main.js` → clean

---
*Phase: 04-keyboard-input*
*Completed: 2026-04-22*
