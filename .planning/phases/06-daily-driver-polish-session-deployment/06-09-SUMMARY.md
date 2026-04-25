---
phase: 06-daily-driver-polish-session-deployment
plan: 09
subsystem: state-and-transport
tags: [gap-closure, race-fix, prefs, serial, regression-tests]
gap_closure: true
requirements: [PREF-01, PREF-02]
dependency_graph:
  requires:
    - 06-06-PLAN.md (introduced applyPrefs subscriber pattern that caused the race)
    - 05-04-PLAN.md (introduced snapPreset that bypassed savePrefs)
  provides:
    - "snapPreset() that syncs cached prefs blob (closes proven Phase 5/6 race)"
    - "flushPrefs() with subscriber fan-out removed (closes the structural race surface)"
    - "Two no-revert regression tests in prefs.spec.js"
  affects:
    - www/transport/serial.js (snapPreset body)
    - www/state/prefs.js (flushPrefs body)
    - www/tests/session/prefs.spec.js (+2 tests)
    - www/tests/transport/config.spec.js (no test code change — production fix un-flakes)
tech-stack:
  added: []
  patterns:
    - "User-driven savePrefs MUST not race-revert DOM via subscriber fan-out"
    - "Future DOM-mutating helpers MUST call savePrefs themselves (flushPrefs no longer rescues them)"
key-files:
  created: []
  modified:
    - www/transport/serial.js
    - www/state/prefs.js
    - www/tests/session/prefs.spec.js
decisions:
  - "Phase 6 Plan 09 (gap closure): snapPreset now calls savePrefsFn({ serial: PRESET_BLOB }) inside the function body to keep cached.serial in sync with the visible form; field-name translation PRESET_CONFIG.baudRate -> serial.baud honors D-32"
  - "Phase 6 Plan 09 (gap closure): flushPrefs no longer iterates subscribers — routine debounced saves originate from user actions that already mutated the DOM, so re-applying is at best a no-op and at worst races; resetPrefs preserved as canonical subscriber fan-out path (D-35 in-place reset path intact)"
  - "Standing invariant: any future DOM-mutating helper that bypasses savePrefs MUST also call savePrefs to sync the cached blob (flushPrefs will no longer 'rescue' them via subscribers)"
metrics:
  duration: ~5 minutes
  completed_date: 2026-04-25
  tasks: 3
  commits: 2 production + 1 docs (this SUMMARY)
  files_modified: 3
---

# Phase 6 Plan 09: Chrome Buttons Non-Functional — Race Fix Summary

Two-part fix closes the chrome-buttons-non-functional blocker reported in 06-UAT.md Test 1: (a) MINIMAL — snapPreset() now syncs cached prefs blob to defeat the proven Phase 5/6 race, and (b) STRUCTURAL — flushPrefs() in prefs.js no longer fires subscribers, eliminating the entire race surface. Two regression tests added to prefs.spec.js as no-revert guards.

## Two-Line Production Diff

**www/transport/serial.js (snapPreset addition):**
```js
// Inside snapPreset(), after the five .value mutations, BEFORE hideReconnectHint:
if (savePrefsFn) {
    savePrefsFn({
        serial: {
            baud: PRESET_CONFIG.baudRate,
            dataBits: PRESET_CONFIG.dataBits,
            stopBits: PRESET_CONFIG.stopBits,
            parity: PRESET_CONFIG.parity,
            flowControl: PRESET_CONFIG.flowControl,
        },
    });
}
```

**www/state/prefs.js (flushPrefs subtraction):**
```diff
 function flushPrefs() {
     try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
     } catch (err) { ... }
     saveTimer = null;
-    for (const fn of subscribers) fn(cached);
+    // No subscriber fan-out here — see comment block above this function.
 }
```

resetPrefs() preserved verbatim — its `for (const fn of subscribers) fn(cached);` is the canonical fan-out path and the D-35 in-place reset depends on it.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | snapPreset syncs cached prefs (closes proven race) | `1b71531` | www/transport/serial.js |
| 2 | flushPrefs no longer fires subscribers + 2 regression tests | `68bdaec` | www/state/prefs.js, www/tests/session/prefs.spec.js |
| 3 | Final regression sweep — full Playwright suite | (no code change) | — |

## Test Results

### Deterministic Confirmations

| Test | Runs | Result |
|------|------|--------|
| `'Reset to MicroBeast preset button snaps all five selects to defaults'` | 10/10 | PASS (deterministic under --retries=0 --repeat-each=10) |
| `'flushPrefs does NOT fire subscribers — no DOM revert after debounce window'` (NEW) | 1/1 | PASS under --retries=0 |
| `'phosphor DOM state survives the 250ms debounce window — no race-revert'` (NEW) | 1/1 | PASS under --retries=0 |

### Best-Effort Secondary Flake-Confirms

| Test | File | Runs | Result |
|------|------|------|--------|
| `'glyphs painted at 1× are still painted after Ctrl+= zoom to 2× — gap #6'` (the "zoom-preserves-content" test name predicted by debug session) | tests/render/zoom.spec.js:68 | 5/5 | PASS |
| `'click each phosphor button keeps wrapper focused'` (the focus-retention phosphor test) | tests/input/focus-retention.spec.js:16 | 5/5 | PASS |

### Suite-Level Results

| Suite | Result |
|-------|--------|
| `tests/transport/` (41 tests) | 41/41 PASS under --retries=0 |
| `tests/session/prefs.spec.js` (16 tests, 14 pre-existing + 2 new) | 16/16 PASS under --retries=0 |
| Full `npx playwright test --retries=0` (final run) | 168 passed, 1 skipped, 0 failed |

## Public Exports of prefs.js — Unchanged

Verified byte-identical in name, arity, and shape:

- `loadPrefs()`
- `savePrefs(partial)`
- `resetPrefs()`
- `subscribe(fn)`
- `getPrefs()`
- `DEFAULTS` (re-exported)

## Standing Invariant (Future Plans Take Note)

`flushPrefs()`'s removed subscriber-fan-out is now a standing invariant: future DOM-mutating helpers MUST call `savePrefs()` themselves — `flushPrefs` will no longer "rescue" them via subscribers. Any new code path that mutates `serialEls.*.value`, `.checked`, `.aria-pressed`, `body[data-theme]`, or any other prefs-mirrored DOM control without going through the savePrefs path is a latent re-introduction of the same race. Code review must grep for `\.value\s*=` and `\.checked\s*=` outside savePrefs paths in any new chrome/transport helper.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — plan-spec accuracy] Plan's grep verify command was overly strict**
- **Found during:** Task 1 verification step
- **Issue:** The plan's automated verify command `grep -c "savePrefsFn({" transport/serial.js | grep -q "^1$"` requires exactly 1 occurrence file-wide, but the existing form-change listener at serial.js:253 (added by Plan 06-06) already uses `savePrefsFn({ serial: ...`. After my snapPreset addition, the count is 2, not 1.
- **Resolution:** Verified the plan's actual acceptance criterion #1 ("snapPreset()'s body contains the literal substring `savePrefsFn({` exactly once") is satisfied — the snapPreset function body itself contains exactly 1 occurrence (verified via `sed -n '/^function snapPreset/,/^}$/p' transport/serial.js | grep -c "savePrefsFn({" → 1`). The pre-existing line 253 occurrence is unrelated to this plan.
- **Files modified:** None (plan-spec mismatch, not a code issue)
- **Commit:** N/A

### Auth Gates

None.

### Architectural Changes (Rule 4)

None requested.

## Pre-Existing Flake Observed (NOT Blocking)

During Task 3's first full-suite run, `tests/render/grid.spec.js:27 'canvas is sized 1280x768 CSS px for 80x24 CRT grid @fast'` failed with `dims.cssW = NaN` — the canvas was measured before its CSS dimensions stabilised. This is a Phase 3 render-suite timing flake (the test file is owned by Phase 3, last touched in commit 5d47da7 / aa77b82; never modified by Phase 6). Verified pre-existing and unrelated to this plan:

- The test passes 5/5 under isolated `--repeat-each=5`
- The full suite passed cleanly on the second run (168/168 + 1 skipped)
- The test file does not import from `prefs.js` or `transport/serial.js`
- The failure mode (canvas measurement timing) is independent of the prefs/serial code paths

Per the plan's Task 3 instruction: "If any pre-existing-known-flake reappears (NOT one of the three the debug session predicted to un-flake), record it in a follow-up note but do not block this plan — those are separate gaps." Recorded here for follow-up triage.

## User UAT Next Action

Re-run `/gsd-verify-work 6` (or re-execute 06-UAT.md Test 1 manually) to confirm the chrome-buttons blocker is closed:

1. Click Connect — port picker appears; pick MicroBeast; connection established (data-state=connected).
2. Click Clear — visible 80×24 grid wipes.
3. Click Clean — body[data-theme] flips crt → clean; persists past 1 s (no race-revert).
4. Click Amber — phosphor radio aria-pressed flips to 'amber'; persists past 1 s.
5. Click Green — phosphor flips to 'green'; persists past 1 s.
6. Click White — phosphor flips to 'white'; persists past 1 s.
7. (Connection pane) Click Reset to MicroBeast preset — all 5 selects snap to 19200/8/1/none/none AND stay snapped.
8. Reload page — all chrome state restored from bestialitty.prefs.

UAT Tests 2-7 (currently blocked by Test 1) become unblocked. Test 8 (24-h soak) is out-of-band and unaffected by this fix.

## Self-Check: PASSED

Verified post-creation:

- [x] Created files exist:
  - FOUND: .planning/phases/06-daily-driver-polish-session-deployment/06-09-SUMMARY.md
- [x] Commits exist:
  - FOUND: 1b71531 (Task 1 — snapPreset syncs cached prefs)
  - FOUND: 68bdaec (Task 2 — flushPrefs structural fix + regression tests)
- [x] Modified files match plan's `files_modified`:
  - FOUND: www/transport/serial.js (snapPreset body)
  - FOUND: www/state/prefs.js (flushPrefs body)
  - FOUND: www/tests/session/prefs.spec.js (+2 tests)
  - NOT MODIFIED: www/tests/transport/config.spec.js (per plan — production fix un-flakes existing test, no test code change required)
- [x] Plan key_links verifiable:
  - snapPreset writes savePrefsFn({ serial: PRESET_BLOB }) before hideReconnectHint, gated on `if (savePrefsFn)` → CONFIRMED at serial.js:316
  - flushPrefs no longer iterates subscribers → CONFIRMED (grep shows 1 total occurrence in resetPrefs)
  - resetPrefs still iterates subscribers → CONFIRMED at prefs.js:113
- [x] Pre-existing flaky 'Reset to MicroBeast preset' transport test passes deterministically (10/10)
- [x] New 'no-revert' regression test added to www/tests/session/prefs.spec.js (`'flushPrefs does NOT fire subscribers'`)
