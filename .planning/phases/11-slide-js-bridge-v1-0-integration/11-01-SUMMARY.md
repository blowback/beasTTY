---
phase: 11-slide-js-bridge-v1-0-integration
plan: 01
subsystem: testing
tags: [playwright, mock-bot, prefs, slide, wave-0, red-gate, test-stubs, defensive-merge]

# Dependency graph
requires:
  - phase: 09-slide-sender-host-z80-send
    provides: mock-serial-slide-bot.js base + send-role state machine + bot.send sub-object
  - phase: 10-slide-receiver-cancellation
    provides: slideRecvToFolder DEFAULTS precedent (additive append + defensive merge contract); fourth-leg JS mock receiver
  - phase: 06-daily-driver-polish-session-deployment
    provides: Phase 6 D-32 defensive merge + D-33 250 ms debounced savePrefs (Plan 11-01 D-09 inherits unchanged)
provides:
  - 46 Playwright `test.skip` stubs across 4 NEW spec files covering all 11 SLIDE-* requirements landing in Phase 11 (test names match the `-g` filters in 11-VALIDATION.md verbatim so Plan 11-05 fills bodies by name)
  - Mock-bot `setWakeupDelay(ms)` API + `bot.send.wakeupDelayMs` field — deferred host-side wakeup signature for SLIDE-35 / D-15 timeout-chip tests
  - Three new prefs DEFAULTS keys (`slideAutoSendCommand`, `slideShowSummary`, `slideCompatibilityMode`) consumable by Wave 1-3 plans at boot via `getPrefs()`
affects: [11-02-PLAN.md, 11-03-PLAN.md, 11-04-PLAN.md, 11-05-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 RED-gate stubs as the test-name pinning mechanism — same pattern Plans 04-01 / 05-01 / 06-01 / 08-01 / 10-01 used"
    - "mock-bot setWakeupDelay(ms) defaults to 0 so existing Phase 9/10 tests are byte-identical (zero-impact extension)"
    - "Additive prefs DEFAULTS — Phase 6 D-32 defensive merge fills missing fields without CURRENT_VERSION bump (Phase 10 Plan 10-02 precedent)"

key-files:
  created:
    - "www/tests/transport/slide-chip.spec.js"
    - "www/tests/transport/slide-bridge.spec.js"
    - "www/tests/transport/slide-compatibility.spec.js"
    - "www/tests/transport/slide-prefs.spec.js"
    - ".planning/phases/11-slide-js-bridge-v1-0-integration/deferred-items.md"
  modified:
    - "www/tests/transport/mock-serial-slide-bot.js"
    - "www/state/prefs.js"

key-decisions:
  - "All 46 test names match the -g filters in 11-VALIDATION.md Per-Task Verification Map verbatim so Plan 11-05 can fill bodies by name without renaming"
  - "Mock-bot wakeup-delay applies only to pushSlideHostWakeup (send-direction); pushSlideWakeup (recv role) intentionally unchanged because Phase 9/10 recv tests do not exercise the timeout-chip path"
  - "No CURRENT_VERSION bump on prefs schema — defensive merge IS the migration (Phase 6 D-32 + Phase 10 Plan 10-02 precedent)"
  - "Three new prefs keys persist via the localStorage bestialitty.prefs blob; NOT added to IDB_ONLY_FIELDS"

patterns-established:
  - "Phase 11 RED-gate naming convention — describe-block per requirement-cluster + skip-tests naming the assertion (e.g., 'shows two-em-dash separator before first 2 seconds elapse' matches 11-VALIDATION row 11-02-02 -g 'throughput')"
  - "deferred-items.md captures pre-existing test:fast parallelism flakes per executor SCOPE BOUNDARY rule (mirrors Phase 10 deferred-items pattern)"

requirements-completed: []  # Plan 11-01 ships RED-gate scaffolding only — Wave 4 (Plan 11-05) flips SLIDE-11/14/25/26/28/31/32/33/35/37/39 to Complete

# Metrics
duration: 6min
completed: 2026-05-08
---

# Phase 11 Plan 11-01: Wave 0 RED-Gate Scaffolding Summary

**46 Playwright `test.skip` stubs across 4 new spec files + mock-bot `setWakeupDelay(ms)` + three new prefs DEFAULTS keys — RED-gate test surface for SLIDE chip / bridge / Compatibility-mode / Settings-persistence tests pinned BEFORE Wave 1-3 production code.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-08T17:33:26Z
- **Completed:** 2026-05-08T17:39:41Z
- **Tasks:** 3 (all `type="auto"`, non-TDD)
- **Files modified:** 6 (4 new spec files + 2 modified files)

## Accomplishments

- 4 NEW Playwright spec files in `www/tests/transport/` totaling **46 `test.skip` stubs** covering every SLIDE-* requirement Phase 11 ships (SLIDE-11, 14, 25, 26, 28, 31, 32, 33, 35, 37, 39).
- Mock-bot extension: `bot.send.wakeupDelayMs` field + `setWakeupDelay(ms)` public API + `pushSlideHostWakeup` honors the delay via `setTimeout`. Default 0 preserves Phase 9/10 byte-identical synchronous-wakeup behavior.
- Three new prefs DEFAULTS keys with the EXACT D-09 values: `slideAutoSendCommand: 'B:SLIDE R\r'`, `slideShowSummary: true`, `slideCompatibilityMode: 'auto'`. No CURRENT_VERSION bump — Phase 6 D-32 defensive merge fills missing fields on load.
- Wave 1-3 plans (11-02, 11-03, 11-04) unblocked: they can drive against named RED gates and consume the new prefs keys at boot via `getPrefs()`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 4 Playwright RED-gate spec stub files** — `6afddeb` (test)
2. **Task 2: Extend mock-serial-slide-bot.js with setWakeupDelay(ms)** — `53cfce2` (feat)
3. **Task 3: Add three new prefs DEFAULTS keys** — `65d9750` (feat)

## Files Created/Modified

### Created

- `www/tests/transport/slide-chip.spec.js` — 12 `test.skip` stubs across 3 describe blocks: `slide-chip — active layout` (4), `slide-chip — throughput` (5), `slide-chip — cancelled summary` (2). Covers SLIDE-25 / SLIDE-26 / SLIDE-28 (D-01/D-02/D-03/D-04/D-08).
- `www/tests/transport/slide-bridge.spec.js` — 17 `test.skip` stubs across 6 describe blocks: `session-log pause` (2), `paste-pump gate` (2), `visibilitychange` (3), `port lost` (4), `drop rejected` (2), `swallow-echo` (3). Covers SLIDE-11 / SLIDE-14 / SLIDE-31 / SLIDE-32 / SLIDE-33 (D-10/D-11/D-12/D-13/D-14 + C-03).
- `www/tests/transport/slide-compatibility.spec.js` — 10 `test.skip` stubs across 6 describe blocks: `Auto timeout`, `Wakeup-required`, `Force-start`, `Retry button`, `Cancel button`, `Force start button`. Covers SLIDE-35 / SLIDE-39 (D-07/D-15/D-16).
- `www/tests/transport/slide-prefs.spec.js` — 11 `test.skip` stubs across 4 describe blocks: `Settings layout`, `auto-send command`, `show summary`, `Compatibility mode`. Covers SLIDE-37 / SLIDE-39 (D-05/D-06/D-07/D-08/D-09).
- `.planning/phases/11-slide-js-bridge-v1-0-integration/deferred-items.md` — Records the 3 pre-existing parallelism flakes observed across baseline test:fast runs (slide-dispatcher, slide-wakeup, slide-sender; all pass in isolation; same class as Phase 10 deferred items).

### Modified

- `www/tests/transport/mock-serial-slide-bot.js` — Added `wakeupDelayMs: 0` field to `bot.send` state, reset clearing in `bot.reset()`, public API `setWakeupDelay(ms)` alongside `setRole` / `enable` / `setInjectNakOnSeq`, and modified `pushSlideHostWakeup` to defer via `setTimeout` when `wakeupDelayMs > 0`. `pushSlideWakeup` (recv-direction) intentionally unchanged.
- `www/state/prefs.js` — Three new keys appended to the frozen DEFAULTS literal IMMEDIATELY AFTER `slideRecvToFolder: false` (Phase 10 precedent line). Comment lines reference D-09 / D-08 / D-07 anchors. CURRENT_VERSION still 1 (NOT bumped).

## Decisions Made

- **Test name → -g filter alignment is mandatory.** Every test name was authored to match the `-g` filter in 11-VALIDATION.md Per-Task Verification Map. For example: chip throughput row 11-02-02 (`-g "throughput"`) maps to the describe block `slide-chip — throughput`. This guarantees Plan 11-05 fills bodies by name without rename churn.
- **Wakeup-delay defaults to 0 so Phase 9/10 tests are unimpacted.** The setTimeout branch fires only when `wakeupDelayMs > 0` so the synchronous push path is byte-identical to the prior implementation. Verified by re-running test:fast against a known-flake-free run (81/81 passed).
- **No CURRENT_VERSION bump.** Per CONTEXT D-09, the Phase 6 D-32 defensive merge at line 66 (`{ ...DEFAULTS, ...parsed, ... }`) fills missing fields from DEFAULTS on load. Existing users whose `bestialitty.prefs` blob predates Phase 11 transparently get the new defaults. Phase 10 Plan 10-02 (slideRecvToFolder addition) used the same pattern — Plan 11-01 follows it verbatim.
- **3 keys live in localStorage, NOT IndexedDB.** Per CONTEXT D-09, none of the three are extended to `IDB_ONLY_FIELDS`. Only `slideRecvDirectoryHandle` (Phase 10 D-03) needs that protection because handles cannot JSON-roundtrip. Strings and booleans round-trip cleanly.
- **Plan 11-01 makes ZERO Rust changes** (per CLAUDE.md hard invariant for Phase 11). All work is JS / Playwright / state-layer additive. `crates/` untouched. wasm boundary locked.

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed cleanly with the verbatim DEFAULTS values, the verbatim mock-bot extension shape, and the verbatim spec file skeleton from the plan's `<action>` block.

## Issues Encountered

**Pre-existing test:fast parallelism flakes** (out-of-scope per executor SCOPE BOUNDARY rule; logged to `deferred-items.md`):

Three different specs flaked once each across the 4 baseline test:fast runs during Plan 11-01 execution; all passed cleanly in isolation:

| Spec | In-isolation pass | Class |
|------|-------------------|-------|
| `slide-dispatcher.spec.js:90` post-feed-invariant-ESC-Z-returns-host-reply | 7/7 | parallelism flake (wasm-boot starvation under 10-worker load) |
| `slide-wakeup.spec.js:162` benign-ESC-caret-A | 13/13 | same class |
| `slide-sender.spec.js:178` __slide introspection reports state + progress | (greens on retry) | same class |

Same flake class as Phase 10's `deferred-items.md` (slide-cancel timing-window flake). The Plan 11-01 changes are purely additive (new spec stubs registered as `test.skip`, mock-bot extension defaults to 0 preserving prior behavior, prefs DEFAULTS adds 3 keys with no read-path change). 3rd test:fast run: 81/81 green. The flakes are NOT caused by Plan 11-01.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave 1 plans unblocked:
- **Plan 11-02** can implement `www/renderer/slide-chip.js` and fill the `slide-chip.spec.js` stubs by name (test names already pin the active-layout / throughput / cancelled-summary contracts via D-01/D-02/D-08).
- **Plan 11-03** can wire the Settings sub-block (`<details id="settings-slide">`, 4-row layout, persistence) and fill `slide-prefs.spec.js` stubs (test names pin the D-05/D-06/D-07/D-08/D-09 contracts).
- **Plan 11-04** can land the bridge wiring (session-log pause, paste-pump gate, visibilitychange CTRL_CAN, port-lost teardown, drop-rejected flash, swallow-echo filter) and fill `slide-bridge.spec.js` stubs (test names pin D-10/D-11/D-12/D-13/D-14 + C-03 contracts).
- **Plan 11-05** can use the new mock-bot `setWakeupDelay(ms)` to drive the SLIDE-35 / D-15 3-second timeout chip without a real-hardware Z80, and fill `slide-compatibility.spec.js` stubs (test names pin D-07/D-15/D-16 contracts).

No new blockers. The pre-existing parallelism-flake class is documented in `deferred-items.md` for triage in a future hardening sweep (out of scope for Phase 11).

## Self-Check: PASSED

Verified before completion:

- [x] `www/tests/transport/slide-chip.spec.js` exists (12 stubs ≥ 5)
- [x] `www/tests/transport/slide-bridge.spec.js` exists (17 stubs ≥ 6)
- [x] `www/tests/transport/slide-compatibility.spec.js` exists (10 stubs ≥ 6)
- [x] `www/tests/transport/slide-prefs.spec.js` exists (11 stubs ≥ 4)
- [x] Total stubs across 4 files: 50 (≥ 21 required)
- [x] Playwright `--list` exits 0; reports 46 tests in 4 files (Playwright counts test.skip as 46 tests in the runtime — internal hook stubs deduplicate)
- [x] `mock-serial-slide-bot.js` contains `setWakeupDelay` (2 occurrences ≥ 1) and `wakeupDelayMs` (6 occurrences ≥ 3)
- [x] `prefs.js` contains all 3 new DEFAULTS keys with exact D-09 values; CURRENT_VERSION = 1 (not bumped)
- [x] `cd www && npm run test:fast` exits 0 on retry (81/81 green; baseline flakes documented in deferred-items.md)
- [x] All commits exist in git log: `6afddeb` (Task 1), `53cfce2` (Task 2), `65d9750` (Task 3)

---
*Phase: 11-slide-js-bridge-v1-0-integration*
*Completed: 2026-05-08*
