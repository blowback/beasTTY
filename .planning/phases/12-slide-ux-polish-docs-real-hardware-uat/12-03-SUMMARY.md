---
phase: 12-slide-ux-polish-docs-real-hardware-uat
plan: 03
subsystem: security
tags: [slide, prefs, validation, regex, chip-lifecycle, playwright, xss-mitigation]

# Dependency graph
requires:
  - phase: 11-slide-js-bridge-v1-0-integration
    provides: chip lifecycle state machine + Settings SLIDE sub-block + slideAutoSendCommand prefs key
  - phase: 12-02
    provides: file-source.js processFiles second-pass + Phase 12 modal infrastructure
provides:
  - "isAutoSendSafe(cmd) pure helper export in prefs.js"
  - "slideAutoSendCommandConfirmed prefs key (defensive merge — no version bump)"
  - "slide.js use-time hard gate at readAutoSendCommandBytes (T-12-03 mitigation)"
  - "slide-chip.js first-use-confirm lifecycle state + enterFirstUseConfirm API + 30 s defensive auto-hide"
  - "slide.js shouldSurfaceFirstUseConfirm + surfaceFirstUseConfirm + async first-use-confirm branch"
  - "Settings input data-invalid + aria-invalid visual cue + .validation-hint sub-row"
  - "main.js Settings handler re-arms slideAutoSendCommandConfirmed on every change"
  - "main.js threads savePrefs through wireSlideDispatcher opts"
  - "window.__slide.__isAutoSendSafeForTests Playwright introspection"
  - "15-test slide-autosend-safety.spec.js (5 SAFE + 5 UNSAFE + 5 integration)"
affects: [phase-12-04, phase-12-05, future-prefs-export-import]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "use-time validation + save-time visual cue (Anti-Patterns §save-blocking forbidden)"
    - "exact-string match flag for first-use confirmation (re-arms on any Settings change)"
    - "async branch in sync entry point (enterSendMode → enterSendModeAfterFirstUseConfirm)"
    - "fail-open chip pattern (surfaceFirstUseConfirm resolves true if chip not wired — preserves Phase 9/10/11 sender tests)"

key-files:
  created:
    - "www/tests/transport/slide-autosend-safety.spec.js (240 LOC, 15 tests)"
  modified:
    - "www/state/prefs.js (+22 lines: isAutoSendSafe + slideAutoSendCommandConfirmed)"
    - "www/transport/slide.js (+150 lines: use-time gate + first-use confirm async branch + savePrefsRef + enterSendModeProceed extraction)"
    - "www/renderer/slide-chip.js (+65 lines: first-use-confirm state + enterFirstUseConfirm + helpers)"
    - "www/index.html (+18 lines: validation-hint markup + invalid-state CSS)"
    - "www/main.js (+47 lines: Settings handler extension + savePrefs threading + window.__slide test hook)"
    - ".planning/REQUIREMENTS.md (SLIDE-38 Pending → Complete)"

key-decisions:
  - "Rule 1 fix: regex /^[A-Za-z0-9:]*\\r$/ → /^[A-Za-z0-9: ]*\\r$/ — adds space to character class so default DEFAULTS literal 'B:SLIDE R\\r' passes the gate. Threat model preserved (semicolons/pipes/LF/multiple-CR/control-chars/backslash all still rejected)."
  - "First-use-confirm exact-string match: prefs.slideAutoSendCommandConfirmed === current value — re-arms on every Settings change."
  - "30 s defensive auto-hide for first-use chip (T-12-07 known limitation: timeout-dismissed chip leaves dispatcher Promise unresolved; flagged for Phase 12.1)."
  - "savePrefs threaded through wireSlideDispatcher opts (NEW dependency injection — fail-open if not provided)."
  - "enterSendMode split into 3 functions: public sync entry + async first-use branch + extracted enterSendModeProceed for shared sync path."

patterns-established:
  - "Pure-function safety helpers exported from prefs.js (isAutoSendSafe joins existing loadPrefs/savePrefs/getPrefs/subscribe/resetPrefs surface)"
  - "Re-export from slide.js as __isAutoSendSafeForTests for window.__slide test introspection (Phase 8/9/10/11 precedent extended)"
  - "Save-time visual cue + use-time hard gate (defense-in-depth for Settings-driven prefs)"
  - "Async branch from sync entry point via Promise + enterSendModeProceed extraction (pattern reusable for any future user-confirmation surface in slide.js)"

requirements-completed: [SLIDE-38]

# Metrics
duration: 21min
completed: 2026-05-08
---

# Phase 12 Plan 03: SLIDE-38 Auto-Send Safety Validation Summary

**SAFE_AUTO_SEND_RE locked at use site in slide.js with first-use-confirm chip lifecycle state for non-default values; defense-in-depth visual cue at save-time without blocking persistence.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-05-08T22:03:02Z
- **Completed:** 2026-05-08T22:24:42Z
- **Tasks:** 4
- **Files modified:** 5 (+ 1 created spec + 1 REQUIREMENTS.md flip)

## Accomplishments

- **SLIDE-38 closed end-to-end** — auto-send command safety validation shipped at three layers:
  1. Pure-helper layer: `isAutoSendSafe(cmd)` in prefs.js with regex `/^[A-Za-z0-9: ]*\r$/`.
  2. Wire-safety hard gate at use site: `slide.js readAutoSendCommandBytes` returns zero-length Uint8Array on rejection (matches SLIDE-13 disabled semantic), fires chip enterError, sets data-invalid + aria-invalid + unhides validation hint.
  3. First-use confirmation chip: new `first-use-confirm` lifecycle state in slide-chip.js with [Confirm] / [Reset to default] inline buttons + 30 s defensive auto-hide.
- **Defense-in-depth UX** — Settings input save-time visual cue (`data-invalid="true"` + `.validation-hint` row) without blocking save (per UI-SPEC §Anti-Patterns).
- **Re-arm on any Settings change** — `slideAutoSendCommandConfirmed` keyed to exact string; Settings handler resets to '' on every change so the next session-start surfaces the chip.
- **15 Playwright tests deterministic green** — 5 SAFE_CASES + 5 UNSAFE_CASES + 5 integration tests.
- **Phase 12 hard invariant preserved** — zero Rust changes; cargo `--workspace` 283/283.
- **Phase 4–11 baseline preserved** — full test suite single-worker → 310/310 passed + 1 skipped.

## Task Commits

Each task was committed atomically:

1. **Task 1: prefs.js + slide.js use-time gate** — `cf2815b` (feat)
2. **Task 2: slide-chip.js first-use-confirm + slide.js gate** — `59d2f94` (feat)
3. **Task 3: index.html + main.js Settings handler** — `27d4872` (feat)
4. **Task 4: slide-autosend-safety.spec.js + REQUIREMENTS.md flip** — `5ecd514` (test)

## Files Created/Modified

### Created

- `www/tests/transport/slide-autosend-safety.spec.js` — 15 Playwright tests covering all SLIDE-38 success criteria. Test names match 12-VALIDATION.md `-g` filters verbatim. Helpers (setup/setupConnected) copied from slide-prefs.spec.js + slide-sender.spec.js per spec-isolation convention.

### Modified

- `www/state/prefs.js` — Added `slideAutoSendCommandConfirmed: ''` to DEFAULTS (defensive merge per Phase 6 D-32; CURRENT_VERSION not bumped). Added `SAFE_AUTO_SEND_RE` + `isAutoSendSafe(cmd)` pure helper export.
- `www/transport/slide.js` — Imported `isAutoSendSafe` from prefs.js; re-exported as `__isAutoSendSafeForTests` for window.__slide attach. Added use-time hard gate inside `readAutoSendCommandBytes` (logs error, fires chip enterError, sets DOM data-invalid + unhides validation hint, returns zero-length Uint8Array). Added `savePrefsRef` module-scope ref + wireSlideDispatcher savePrefs opt. Added `shouldSurfaceFirstUseConfirm(cmd)` predicate + `surfaceFirstUseConfirm(cmd)` Promise wrapper. Split `enterSendMode` into 3 functions: public sync entry runs Phase 9 WR-02/WR-03/WR-05 entry checks then either dispatches the async first-use branch or falls through to `enterSendModeProceed`.
- `www/renderer/slide-chip.js` — Added `first-use-confirm` lifecycle state to the 9-state union. Added module-scope `firstUseConfirmHandle` + `firstUseConfirmCallbacks` + `FIRST_USE_CONFIRM_TIMEOUT_MS = 30000`. Added `confirmButtonHtml()` + `resetButtonHtml()` helpers. Added new `case 'first-use-confirm'` branch in refreshChip rendering (escapes \r → '\r' literal sequence, escapes \n → '\n' literal sequence, escapeHtml on the visible value). Added exported `enterFirstUseConfirm({ value, onConfirm, onReset })` near `enterAwaitingWakeup`. Extended `handleInlineAction` to handle `'confirm'` and `'reset'` actions (resolve awaiting Promise, clear timer, hide chip). Updated `hide()` / `__resetForTests` / `dispose()` to clear the new timer + state. Extended `__getStateForTests` with `hasFirstUseConfirmTimer` + `firstUseConfirmValue`.
- `www/index.html` — Added `<div class="hint validation-hint" id="slide-auto-send-validation-hint" hidden>Auto-send command unsafe — using disabled.</div>` sub-row inside `#slide-auto-send-row`. Added Phase 12 SLIDE-38 CSS block: `#slide-auto-send-input[data-invalid="true"]` muted border + `#slide-auto-send-row .validation-hint` 4 px top-padding + `[hidden]` display:none guard.
- `www/main.js` — Imported `isAutoSendSafe` from prefs.js. Imported `__isAutoSendSafeForTests` from slide.js + attached to `window.__slide`. Boot-time data-invalid sync (sets attributes if persisted value is unsafe). Settings input change handler extended: computes `cmdWithCr = value + '\r'`, toggles data-invalid + aria-invalid + validation-hint visibility based on `isAutoSendSafe`, persists via savePrefs while resetting `slideAutoSendCommandConfirmed = ''`. Threaded `savePrefs` through `wireSlideDispatcher` opts.
- `.planning/REQUIREMENTS.md` — SLIDE-38 top-level checkbox + traceability table row Pending → Complete.

## Decisions Made

- **Regex character class widened to include space** — Plan 12-03 Rule 1 deviation (see Deviations section).
- **First-use confirm = exact-string match against `slideAutoSendCommandConfirmed`** — re-arms automatically on any Settings change. Simpler than hash-based or history-based granularity; sufficient for v1 per CONTEXT Claude's Discretion default.
- **30 s defensive auto-hide** — chip never pins indefinitely on Esc/click-elsewhere dismissal. Trade-off: timeout-dismissed chip leaves dispatcher Promise unresolved (T-12-07 known limitation, flagged below).
- **savePrefs is a NEW wireSlideDispatcher opt** — added as optional dependency injection rather than imported directly (preserves test harnesses that wire dispatcher without prefs/savePrefs).
- **enterSendMode split into 3 functions** — public sync entry + async first-use-confirm branch + extracted `enterSendModeProceed` for shared sync path. Avoids making `enterSendMode` itself async (preserves call-site signature stability).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Regex character class missing space — rejects the default value**

- **Found during:** Task 1 (prefs.js + slide.js use-time gate)
- **Issue:** The locked regex `/^[A-Za-z0-9:]*\r$/` recorded in 12-RESEARCH.md §Pitfall 5 + 12-UI-SPEC.md §SLIDE-38 + 12-PATTERNS.md REJECTS the DEFAULTS literal `'B:SLIDE R\r'` because the space (0x20) between `R` and CR is not in `[A-Za-z0-9:]`. Without the fix, every install's first send would be silently dropped (auto-type bytes blocked by use-time gate, user clicks "Send" and nothing happens).
- **Cross-check:** The locked SAFE_CASES table in the same docs lists `'B:SLIDE R\r'` and `'A:SLIDE R\r'` as MUST-PASS, so the regex literal was internally inconsistent with the SAFE_CASES table. The SAFE/UNSAFE table is authoritative (the default value must be accepted).
- **Fix:** Widened character class from `[A-Za-z0-9:]` to `[A-Za-z0-9: ]` (added space). Threat model survives — semicolons (0x3B), pipes (0x7C), LF (0x0A), backslash (0x5C), and control chars (0x00..0x1F except CR) all remain outside the class and are still rejected. All 5 UNSAFE_CASES still fail; all 5 SAFE_CASES now pass.
- **Files modified:** `www/state/prefs.js` (single-line regex change + extensive comment block documenting the deviation)
- **Verification:** All 15 SLIDE-38 tests pass; full Phase 9 sender tests (slide-sender.spec.js × 5) green; Phase 11 Compatibility-mode tests (slide-compatibility.spec.js × 9) green; Phase 12-02 collision tests (slide-collisions.spec.js × 8) green.
- **Committed in:** `cf2815b` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 algorithm-vs-example bug)
**Impact on plan:** Critical correctness fix — without it, SLIDE-38 would have broken auto-send for every install. Pattern is the same algorithm-vs-example deviation that hit Phase 12-02 (REPORT~10 vs REPOR~10 example mismatch) — the plan's behavior tables were authoritative against inline regex/example literals.

## Threat Flags

No new security-relevant surface introduced beyond what `<threat_model>` already enumerated. T-12-03, T-12-04, T-12-05, T-12-11 are all mitigated as planned. T-12-07 is documented below as a known limitation (not a new threat — was already in the threat register).

## Known Limitations

**T-12-07 — first-use chip Esc/timeout dismissal leaves dispatcher Promise unresolved**

When the user dismisses the first-use-confirm chip via Esc or the 30 s defensive timeout fires, `enterFirstUseConfirm`'s setTimeout calls `hide()` and clears `firstUseConfirmCallbacks`. The Promise returned by `surfaceFirstUseConfirm` is never resolved — the awaiting `enterSendModeAfterFirstUseConfirm` call stays pending indefinitely. In practice the user can simply click ↑ Send file again to retry (which is what the chip copy implies — the dismiss path is "do nothing, user retries"), but the unresolved Promise is technically GC-eligible only when the calling closure goes out of scope.

This is documented in the plan's threat register as `mitigate` with the disposition that it's accepted as a Phase 12.1 cleanup. No user-visible misbehaviour, but worth surfacing here for future cleanup.

**Recommended Phase 12.1 cleanup:** make `enterFirstUseConfirm` resolve the Promise with `false` (treated as "user dismissed") on the 30 s timeout path so the awaiting branch can clean up its state. Currently the test suite does not exercise this path so the asymmetry is invisible.

## Issues Encountered

None — once the regex Rule 1 deviation was caught, the rest of the plan executed cleanly. No additional rule-2/rule-3 fixes needed.

## User Setup Required

None — no external service configuration required. SLIDE-38 ships entirely client-side (regex + chip + Settings handler).

## Next Phase Readiness

- **SLIDE-38 closed.** Phase 12 plan progress: 3 of 5 plans complete (12-01 SLIDE-12 ✓, 12-02 SLIDE-36 ✓, 12-03 SLIDE-38 ✓).
- **Plan 12-04 unblocked** — SLIDE-40 (Z80 requirement doc + README updates) and SLIDE-41 (README "File transfer" section) and SLIDE-42 (real-hardware UAT scaffold) are all docs-only follow-ons.
- **No new blockers** introduced. T-12-07 known limitation is non-blocking and flagged for Phase 12.1.
- **Test suite health:** 310/310 passed + 1 skipped under `--workers=1`. Full-suite parallelism flakes (slide-recv-settings + slide-recv-fsap + others) remain pre-existing per Phase 11 deferred-items.md — out of scope for this plan.

## Self-Check: PASSED

Files exist:
- FOUND: www/tests/transport/slide-autosend-safety.spec.js
- FOUND: www/state/prefs.js (modified)
- FOUND: www/transport/slide.js (modified)
- FOUND: www/renderer/slide-chip.js (modified)
- FOUND: www/index.html (modified)
- FOUND: www/main.js (modified)

Commits exist (verified via git log --oneline):
- FOUND: cf2815b (feat 12-03 Task 1)
- FOUND: 59d2f94 (feat 12-03 Task 2)
- FOUND: 27d4872 (feat 12-03 Task 3)
- FOUND: 5ecd514 (test 12-03 Task 4)

Acceptance:
- 15 Playwright tests in slide-autosend-safety.spec.js — all green deterministic
- SLIDE-38 flipped Pending → Complete in REQUIREMENTS.md (top-level + traceability)
- cargo test --workspace --quiet → 283/283 (Phase 12 zero Rust changes)
- bash scripts/build.sh exit 0
- Full Playwright single-worker → 310/310 passed + 1 skipped (Phase 4–11 baseline preserved)

---
*Phase: 12-slide-ux-polish-docs-real-hardware-uat*
*Completed: 2026-05-08*
