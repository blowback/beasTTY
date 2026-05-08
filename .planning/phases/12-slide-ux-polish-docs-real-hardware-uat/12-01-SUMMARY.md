---
phase: 12
plan: 01
subsystem: input/selection
tags: [slide-12, selection, drag-drop, regression-spec, tdd, pointer]
requirements: [SLIDE-12]
dependency_graph:
  requires:
    - "Phase 9 file-source.js — setDropTarget owner of [data-drop-target] attribute"
    - "Phase 6 selection.js — wireSelection public API + window.__selection introspection"
    - "Phase 5 mock-serial fixture (SERIAL_MOCK)"
  provides:
    - "Strict-equality early-return predicate in selection.js onPointerDown"
    - "3 Playwright regression tests covering SLIDE-12 SC#1"
  affects:
    - "Plan 12-02 — will add clearSelection() call into file-source.js onDrop (post-drop ghost-clear)"
tech_stack:
  added: []
  patterns:
    - "DOM attribute strict-equality predicate (mirrors [data-focused] / [data-scrolled-back] cross-module pattern)"
    - "Phase 8/9/10 spec-isolation convention (no cross-spec helper imports)"
key_files:
  created:
    - "www/tests/render/selection-drop.spec.js (115 lines, 3 tests)"
  modified:
    - "www/input/selection.js (337 → 343 lines; +6 lines at onPointerDown lines 113-124)"
decisions:
  - "Strict equality === 'true' (NOT !== 'false', NOT hasAttribute) per Pitfall 4"
  - "Direct attribute read (NOT injected predicate) per UI-SPEC §SLIDE-12 locked mechanism"
  - "Post-drop clearSelection() owned by Plan 12-02 (avoids file-modification overlap)"
metrics:
  duration: "3 min"
  completed: "2026-05-08"
  tasks: 1
  files: 2
  commits: 2
---

# Phase 12 Plan 01: SLIDE-12 Pointer/Drop Isolation — Summary

**One-liner:** selection.js onPointerDown gains a 3-line strict-equality early-return on `[data-drop-target] === 'true'`, deferring to file-source.js drag handlers when the SLIDE drop overlay is active; new `selection-drop.spec.js` proves the contract with 3 Playwright tests.

## What Shipped

### Production code

`www/input/selection.js` — **6-line insertion** at the top of `onPointerDown` (lines 115-121, immediately after the `if (ev.button !== 0) return;` guard, BEFORE `ev.preventDefault()`):

```js
function onPointerDown(ev) {
    if (ev.button !== 0) return;
    // SLIDE-12: drop overlay active → defer to file-source.js drag handlers.
    // canvasRef.parentElement is #terminal-wrapper (the [data-drop-target] owner).
    // Strict equality on the literal string 'true' — getAttribute returns null
    // when the attribute is absent (12-RESEARCH.md Pitfall 4).
    if (canvasRef.parentElement?.getAttribute('data-drop-target') === 'true') {
        return;
    }
    ev.preventDefault();
    // ... rest of body unchanged
}
```

**Exact insertion line range:** lines **115-121** of `www/input/selection.js` (3 lines of comment + 3 lines of code + closing brace + blank line). All other functions in selection.js are unchanged byte-for-byte.

### Test code

`www/tests/render/selection-drop.spec.js` — **NEW**, 115 lines, **3 tests**, self-contained per Phase 8/9/10 spec-isolation convention. Imports only `SERIAL_MOCK` from `../transport/mock-serial.js`; setup helpers inlined.

| # | Test name (verbatim) | Scenario | Assertion |
|---|---|---|---|
| 1 | `SLIDE-12 — onPointerDown does not start selection while drop overlay active` | Set `[data-drop-target=true]` programmatically; mouse-down/move/up | `getSelection() === null` AND `isDragging() === false` |
| 2 | `SLIDE-12 — pointerdown starts selection normally when drop overlay inactive (regression)` | No attribute set; mouse-down/move/up over fed glyphs | `getSelection() !== null` (Phase 6 baseline preserved) |
| 3 | `SLIDE-12 — post-drop pointer-select works after overlay clears` | Set + remove the attribute; mouse-down/move/up | `getSelection() !== null` (gate-and-clear, not gate-and-stick) |

## TDD Gate Compliance

Plan ran with `tdd="true"`. Both gates committed in order:

| Gate | Commit | Type | Notes |
|------|--------|------|-------|
| RED | `4c3767b` | `test(12-01): add failing SLIDE-12 pointer/drop isolation spec` | Test 1 failed as expected (selection of "hell" produced when overlay active); Tests 2 & 3 passed (independent of fix). |
| GREEN | `fe99569` | `feat(12-01): defer pointer-select to drop overlay (SLIDE-12)` | All 3 tests pass after the 3-line predicate insertion. |
| REFACTOR | — | (skipped) | The change is exactly the 3-line insertion + 3 lines of comment per UI-SPEC §SLIDE-12 locked contract; nothing to clean up. |

## Verification

### Acceptance criteria (plan §acceptance_criteria)

- `grep -q "data-drop-target" www/input/selection.js` → **PASS**
- `grep -q "=== 'true'" www/input/selection.js` → **PASS** (strict equality, not `!== 'false'`, not `hasAttribute`)
- `grep -q "SLIDE-12" www/input/selection.js` → **PASS**
- `test -f www/tests/render/selection-drop.spec.js` → **PASS**
- `grep -c "^test(" www/tests/render/selection-drop.spec.js` → **3**
- `grep -q "overlay active" …` → **PASS**
- `grep -q "regression" …` → **PASS**
- `grep -q "post-drop" …` → **PASS**
- `cd www && npx playwright test render/selection-drop.spec.js --workers=1` → **3/3 pass (1.3 s)**
- `cd www && npm run test:fast` → **81/81 deterministic green** (see Test Suite Baseline below)

### Final spec run (post-GREEN)

```
Running 3 tests using 1 worker

  ✓  1 [chromium] › tests/render/selection-drop.spec.js:46:1 › SLIDE-12 — onPointerDown does not start selection while drop overlay active (280ms)
  ✓  2 [chromium] › tests/render/selection-drop.spec.js:71:1 › SLIDE-12 — pointerdown starts selection normally when drop overlay inactive (regression) (232ms)
  ✓  3 [chromium] › tests/render/selection-drop.spec.js:93:1 › SLIDE-12 — post-drop pointer-select works after overlay clears (219ms)

  3 passed (1.3s)
```

### Test Suite Baseline (`npm run test:fast`)

**Final state: 81/81 passing** on the deterministic re-run.

The first run flagged 2 transient failures (`tx-sink.spec.js:87` `writeSlideFrame-bypasses-keystroke-ring @fast` and `tx-sink.spec.js:112` `writeSlideFrame-writes-via-registeredWriter @fast`), both with the same 5 s connect-handshake poll timeout. Verified pre-existing parallelism flake by:

1. Running `npx playwright test input/tx-sink.spec.js --workers=1` → **9/9 pass in isolation** (no production code in tx-sink.js path).
2. Re-running `npm run test:fast` → **81/81 deterministic green** at default 10-worker concurrency.

These match the parallelism-flake class already documented in `.planning/phases/11-slide-js-bridge-v1-0-integration/deferred-items.md` (slide-* specs racing on wasm boot under heavy parallel load). They are out of scope for this plan — selection.js's `onPointerDown` cannot affect tx-sink wire-owner state.

## Deviations from Plan

**None.** The plan executed exactly as written:

- 3-line predicate inserted verbatim at the specified location.
- 3 tests with verbatim names matching the 12-VALIDATION.md `-g` filters.
- Spec is self-contained per Phase 8/9/10 spec-isolation convention.
- No `clearSelection()` call added (correctly deferred to Plan 12-02 per plan §action).
- No other functions in selection.js modified.
- No new module-scope variables introduced.

No Rule 1 / Rule 2 / Rule 3 auto-fixes were necessary. No Rule 4 architectural decisions surfaced.

## Threat Model (from Plan)

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-12-01 (Spoofing — selection.js vs file-source.js drop overlay) | mitigate | **Mitigated.** Strict-equality `=== 'true'` predicate fails-closed: `getAttribute` returns `null` when the attribute is absent → predicate is false → selection works normally. Tests 1 + 3 verify both branches. |
| T-12-08 (Tampering — DOM attribute injection via untrusted scripts) | accept | **Unchanged.** Beastty is a static site; CSP locks origins; `[data-drop-target]` is owned exclusively by file-source.js's `setDropTarget`. |

No new threat surface introduced — the change reads from an existing setter contract.

## Commits

| Hash | Type | Subject |
|------|------|---------|
| `4c3767b` | test | add failing SLIDE-12 pointer/drop isolation spec |
| `fe99569` | feat | defer pointer-select to drop overlay (SLIDE-12) |

## Open Items / Carry-Forward

- **Plan 12-02** will wire `clearSelection()` into file-source.js's `onDrop` handler so any selection that pre-existed before the drag clears at drop-completion. This is the second half of SLIDE-12's "no ghost selection / inverse-text artefact remains after a drop completes" success criterion. Plan 12-01 ships only the early-return half; Plan 12-02 ships the post-drop clear half (separated to avoid file-modification overlap on file-source.js, which Plan 12-02 modifies extensively for the SLIDE-36 collision modal work).

## Self-Check: PASSED

All claims verified:

- `[ -f www/input/selection.js ]` → **FOUND** (343 lines, predicate at lines 115-121).
- `[ -f www/tests/render/selection-drop.spec.js ]` → **FOUND** (115 lines, 3 tests).
- `git log --oneline | grep 4c3767b` → **FOUND** (`test(12-01): add failing SLIDE-12…`).
- `git log --oneline | grep fe99569` → **FOUND** (`feat(12-01): defer pointer-select…`).
- All acceptance-criteria grep checks pass.
- All 3 plan tests green; test:fast 81/81 deterministic.
- No accidental deletions (`git diff --diff-filter=D HEAD~2 HEAD` empty).
