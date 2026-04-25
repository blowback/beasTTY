---
phase: 05-web-serial-transport
plan: 09
subsystem: transport
tags: [web-serial, ui, paste-pump, gap-closure, spec-amendment, playwright]

# Dependency graph
requires:
  - phase: 05-web-serial-transport
    provides: Plan 05-06 paste-pump module + observer pattern; Plan 05-07 #paste-progress-row DOM + observer; Plan 05-08 beforeunload close-contract (preserved unchanged)
provides:
  - Gap 2 closure (UAT Test 6 paste auto-expands Connection pane + canvas lurch — major)
  - #paste-progress-row relocated from inside <details id="connection"> to <div id="top-bar"> (sticky, no canvas displacement)
  - main.js paste observer no longer mutates connectionPane.open in any branch (preExpansionOpen variable removed entirely)
  - 05-CONTEXT.md D-17 amended (original preserved in superseded <details> block)
  - 05-UI-SPEC.md §Connection pane auto-expand rules table amended (paste-start row marked SUPERSEDED BY PLAN 09)
  - 05-UI-SPEC.md §Paste-pump UI interactions table amended (enqueuePaste row no longer mentions auto-expand)
  - serial.js D-27 comment expanded with the intentional D-17/D-27 asymmetry rationale (code behavior unchanged)
  - Playwright Gap 2 regression test in paste.spec.js (4 KB paste invariant — pane stays collapsed end-to-end)
affects: [Phase 6 polish/deployment, future gsd-research/gsd-plan runs that consume the amended D-17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Paste-progress UI surfaces in the sticky #top-bar slot with [hidden]-toggled flex layout — visible without displacing the terminal canvas"
    - "Connection pane open-state is mutated by ONE path only (D-27 error-log auto-expand); paste-pump and other transient flows do NOT touch details.open. Asymmetry documented in amended D-17 rationale."
    - "Spec amendment with <details> superseded block: original D-17 text preserved verbatim inside a collapsible block tagged 'Superseded original D-17 (kept for traceability)' so future readers can reconstruct the full decision history without losing the original prose."

key-files:
  created: []
  modified:
    - "www/index.html — relocated <div id='paste-progress-row'> from inside <details id='connection'> to last child of <div id='top-bar'>; replaced #paste-progress-row CSS with #top-bar-scoped rules (margin-left:auto, white-space:nowrap, button styling for top-bar context)"
    - "www/main.js — removed preExpansionOpen variable + connectionPane.open mutations from all 4 paste-observer branches ('started' / 'complete' / 'cancelled' / 'cancelled-port-lost'); UI-SPEC copy strings preserved verbatim; comment block updated to reference amended D-17"
    - "www/transport/serial.js — D-27 auto-expand-on-error comment expanded to explain the intentional D-17/D-27 asymmetry; the connectionPane.open=true assignment line is UNCHANGED (Plan 08 shuttingDown / releaseLock invariants preserved: count=3 each)"
    - "www/tests/transport/paste.spec.js — added 'paste does NOT auto-expand Connection pane (Gap 2 regression)' test that asserts the pane-stays-collapsed invariant against a 4 KB paste (large enough to observe in-flight UI state without racing the 'Paste complete' transition); spec preamble comment updated to reference Plan 09 amendment"
    - ".planning/phases/05-web-serial-transport/05-CONTEXT.md — D-17 amended with 'AMENDED 2026-04-23 by Plan 09' block, rationale paragraph, D-27 contrast paragraph, and <details> superseded original-D-17 block"
    - ".planning/phases/05-web-serial-transport/05-UI-SPEC.md — Connection pane auto-expand rules table: paste-start row marked SUPERSEDED BY PLAN 09 (strikethrough + amendment note); Paste-pump UI interactions table enqueuePaste row no longer mentions auto-expand"

key-decisions:
  - "Phase 5 Plan 09 (Gap 2 fix): paste-progress UI relocated to #top-bar — Option A from the debug session was preferred over Option B (CSS hack to render inside closed <details>) because the sticky top-bar is the principled fix; Option B would bypass the disclosure semantic and accumulate technical debt."
  - "Phase 5 Plan 09: D-27 (error-log auto-expand) is KEPT and intentionally asymmetric with the amended D-17 — errors are rare + sticky + demand attention; pastes are frequent + transient. The asymmetry is documented in the amended D-17 rationale paragraph AND in the serial.js:441 comment block (now reads 'D-27 auto-expand on error (KEPT, intentionally asymmetric with D-17)')."
  - "Phase 5 Plan 09: spec artifacts (05-CONTEXT.md D-17 + 05-UI-SPEC.md auto-expand rules table + Paste-pump UI interactions table) amended in the same commit as the code change, so the 'spec-bug fix that future planners cannot accidentally re-propose' invariant is satisfied at git-history granularity. Original D-17 preserved verbatim in a <details> superseded block — full audit trail."
  - "Phase 5 Plan 09: connectionPane DOM ref retained in main.js + wireSerial opts, despite paste observer no longer using it, because serial.js's D-27 auto-expand-on-error path still depends on it. Removing the ref would break error-log UX. The plan's must_haves.artifacts contains marker 'D-27' is satisfied by the comment-only amendment at serial.js:441."
  - "Phase 5 Plan 09 regression test design: 4 KB paste payload chosen so the pump runs ~2.3 s at 19200 baud (32B chunks at 18ms) — long enough to observe the in-flight UI invariant ('Pasting' substring in #paste-progress-text) without racing 'Paste complete'. A short payload (e.g. 14 B) finished in <100 ms and consistently raced the assertion; this was caught and fixed inline as a Rule 1 bug during Task 2 execution."

patterns-established:
  - "Spec-bug amendment pattern (Plan 09): when a CONTEXT decision is wrong on real hardware (proven via UAT), amend the decision in CONTEXT.md with a dated 'AMENDED YYYY-MM-DD by Plan N' block, preserve the original text in a <details> superseded block for traceability, AND amend any UI-SPEC tables that cite the decision in the SAME plan/commit. This prevents gsd-research / gsd-plan future runs from re-proposing the original behavior."
  - "Sticky top-bar slot pattern: any transient status indicator that would otherwise expand a <details> pane and shift the canvas down should ride the #top-bar (sticky, top:0, zero canvas displacement) instead. #top-bar #paste-progress-row is the first instance; future indicators (e.g. paste-pump baud-mismatch warning, network error toasts) should follow the same pattern."

requirements-completed: [XPORT-09]

# Metrics
duration: 7min
completed: 2026-04-25
---

# Phase 5 Plan 09: Gap 2 Closure (Paste auto-expands Connection pane + canvas lurch) Summary

**Relocated #paste-progress-row from inside `<details id="connection">` into the sticky `#top-bar`, removed `preExpansionOpen` + `connectionPane.open` mutations from main.js's paste observer, amended 05-CONTEXT.md D-17 + 05-UI-SPEC.md auto-expand rules table to drop paste auto-expand (D-27 error-log auto-expand intentionally KEPT), and added a Playwright regression test that asserts the pane-stays-collapsed invariant against a 4 KB paste — eliminates the ~250-330 px canvas lurch UAT Test 6 reported.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-25T00:18:42Z
- **Completed:** 2026-04-25T00:25:22Z
- **Tasks:** 3
- **Files modified:** 6 (0 created, 6 edited)

## Accomplishments

- **Gap 2 root cause eliminated** — `connectionPane.open = true` mutation in main.js's `'started'` paste-observer branch was the load-bearing trigger for the lurch (faithful to original D-17, but D-17 was wrong on real hardware). All four occurrences removed (started + 3 restore branches); `preExpansionOpen` variable removed entirely. Now zero `connectionPane.open = ` assignments in main.js.
- **DOM relocation complete** — `<div id="paste-progress-row">` now lives as the last child of `<div id="top-bar">`. The element IDs (`paste-progress-row`, `paste-progress-text`, `paste-cancel`) are preserved verbatim so all downstream `getElementById` calls continue to resolve. CSS scoped with `#top-bar` prefix to fit the sticky-bar context (margin-left:auto for right-edge, white-space:nowrap to keep on one line).
- **Spec artifacts amended** — 05-CONTEXT.md D-17 has an "AMENDED 2026-04-23 by Plan 09" header, a rationale paragraph (citing UAT Test 6 + the debug session file), a D-27 contrast paragraph (documenting the intentional asymmetry), and the original D-17 text preserved verbatim in a `<details>` superseded block. 05-UI-SPEC.md auto-expand rules table marks the paste-start row SUPERSEDED BY PLAN 09 with strikethrough + amendment note. The Paste-pump UI interactions table's enqueuePaste row no longer mentions auto-expand.
- **D-27 KEPT, asymmetry documented** — the error-log auto-expand at serial.js:441 is kept (errors are rare + sticky + demand user attention); the comment block expanded to explain the intentional D-17/D-27 asymmetry. Code behavior at that line is UNCHANGED. Plan 08's `shuttingDown` / `releaseLock` / `unregisterWriter` invariants (count=3 each) preserved.
- **Automated regression coverage** — paste.spec.js gains "paste does NOT auto-expand Connection pane (Gap 2 regression)" which asserts the pane-stays-collapsed invariant end-to-end against a 4 KB paste, verifies `#paste-progress-row` is a descendant of `#top-bar`, and re-checks the open state after `Paste complete`. Transport suite went from 40 passed → 41 passed (zero pre-existing test regressions; the visibilitychange flake mentioned in Plan 08's Issues Encountered is unaffected by Plan 09 and passes on retry — confirmed via `--retries=2` run).

## Task Commits

Each task was committed atomically:

1. **Task 1: Relocate paste-progress-row from `<details id="connection">` to `#top-bar` (DOM + CSS)** — `ceac705` (fix)
2. **Task 2: Drop connectionPane.open mutations from paste observer + Gap 2 spec** — `f894620` (fix)
3. **Task 3: Amend D-17 + UI-SPEC auto-expand rules + serial.js D-27 comment** — `b3e2b3d` (docs)

_Note: All three tasks were tagged `tdd="true"` in the plan, but their verifications are static grep-anchored invariants (DOM relocation regex, `connectionPane.open` count = 0, "AMENDED 2026-04-23 by Plan 09" count >= 1) plus the Playwright regression test (single new test in paste.spec.js, committed alongside Task 2's code change since the test is the assertion of the new invariant)._

## Files Created/Modified

- **`www/index.html`** (modified) — `<div id="paste-progress-row">` block moved from inside `<details id="connection">` to last child of `<div id="top-bar">`; CSS rule block replaced with `#top-bar #paste-progress-row` scoped rules (display:flex, margin-left:auto, white-space:nowrap on text, button styling for top-bar context). Both Top-bar comment and the position previously occupied by paste-progress-row in the Connection pane carry an explanatory note referencing Plan 09 / amended D-17.
- **`www/main.js`** (modified) — paste observer rewritten: `preExpansionOpen` variable removed entirely; all four `connectionPane.open` mutations removed (one set in `'started'`, three restores in completion branches); UI-SPEC copy strings preserved verbatim; observer comment block updated to explain why `connectionPane` ref is still passed to wireSerial (D-27 error-log auto-expand path still uses it).
- **`www/transport/serial.js`** (modified) — comment-only change at line 441: D-27 auto-expand-on-error comment expanded to explain the intentional D-17/D-27 asymmetry. The `connectionPane.open = true` assignment is UNCHANGED (zero behavior change). Plan 08 invariants verified preserved (shuttingDown / readerReleaseLock / writerReleaseLock / unregisterWriter all count=3).
- **`www/tests/transport/paste.spec.js`** (modified) — preamble comment updated to reference Plan 09 amendment + setup() invariant; new test "paste does NOT auto-expand Connection pane (Gap 2 regression)" added before the closing `});` of the test.describe block. The test uses a 4 KB payload to ensure the pump stays active long enough to assert in-flight UI state.
- **`.planning/phases/05-web-serial-transport/05-CONTEXT.md`** (modified) — D-17 amended in place: dated amendment header, rationale paragraph (UAT Test 6 + debug session reference), D-27 contrast paragraph, and `<details><summary>Superseded original D-17 (kept for traceability)</summary>` block preserving the original text verbatim as a blockquote.
- **`.planning/phases/05-web-serial-transport/05-UI-SPEC.md`** (modified) — Connection pane auto-expand rules table: paste-start row strikethrough + SUPERSEDED BY PLAN 09 marker + amendment note paragraph below the table. Paste-pump UI interactions table: `enqueuePaste(bytes)` row text no longer mentions pane auto-expand and refers to the amended D-17. Implementation hint paragraph below the auto-expand table updated to direct executors away from the old `preExpansionOpen` pattern.

### DOM hierarchy: before / after

**Before (Plan 05-06 → Plan 05-08):**
```
<body>
  <div id="top-bar">
    <button id="connect-button">Connect</button>
    <button id="theme-toggle">Clean</button>
    <div id="phosphor-group">…</div>
  </div>
  <details id="connection">
    <summary>Connection</summary>
    <p id="port-status">…</p>
    <fieldset>…</fieldset>
    <button id="serial-reset-preset">…</button>
    <p class="hint">…</p>
    <div id="paste-progress-row" hidden>      ← LURCH SOURCE: expanding the parent
      <span id="paste-progress-text"></span>     pane on paste pushed canvas
      <button id="paste-cancel">Cancel</button>  down ~250-330 px (UAT Test 6)
    </div>
    <p class="hint">Recent errors</p>
    <pre id="error-log">…</pre>
  </details>
  <div id="terminal-wrapper">…</div>
```

**After (Plan 05-09):**
```
<body>
  <div id="top-bar">                          ← position: sticky; top: 0;
    <button id="connect-button">Connect</button>
    <button id="theme-toggle">Clean</button>
    <div id="phosphor-group">…</div>
    <div id="paste-progress-row" hidden>      ← rides the right edge of the
      <span id="paste-progress-text"></span>     sticky bar (margin-left:auto);
      <button id="paste-cancel">Cancel</button>  zero canvas displacement
    </div>
  </div>
  <details id="connection">                   ← unchanged content (no paste-row)
    <summary>Connection</summary>
    <p id="port-status">…</p>
    <fieldset>…</fieldset>
    <button id="serial-reset-preset">…</button>
    <p class="hint">…</p>
    <p class="hint">Recent errors</p>
    <pre id="error-log">…</pre>
  </details>
  <div id="terminal-wrapper">…</div>
```

### main.js paste-observer: before / after

**Before (Plan 05-06):**
```js
let preExpansionOpen = null;
onPastePumpProgress((ev) => {
    if (ev.status === 'started') {
        preExpansionOpen = connectionPane.open;
        if (!connectionPane.open) connectionPane.open = true;   // ← LURCH
        pasteProgressRow.hidden = false;
        pasteProgressText.textContent = `Pasting ${ev.total} B — 0%`;
        return;
    }
    // ... 'complete' / 'cancelled' / 'cancelled-port-lost' each restore
    //     connectionPane.open from preExpansionOpen after their timeout
});
```

**After (Plan 05-09):**
```js
onPastePumpProgress((ev) => {
    if (ev.status === 'started') {
        pasteProgressRow.hidden = false;
        pasteProgressText.textContent = `Pasting ${ev.total} B — 0%`;
        return;
    }
    // ... 'complete' / 'cancelled' / 'cancelled-port-lost' each only toggle
    //     pasteProgressRow.hidden after their timeout — no pane mutation
});
```

## Decisions Made

See `key-decisions` in the frontmatter — five entries are duplicated there for STATE.md extraction. Headline rationale:

- **Option A (relocate to #top-bar) over Option B (CSS hack)** — Option B would render `#paste-progress-row` outside its `<details>` parent's collapsed-state visibility via `position: absolute` or similar, bypassing the disclosure semantic and accumulating technical debt. Option A relocates the DOM, which is the principled fix: the row's home is now consistent with its visibility model.
- **D-27 KEPT (intentionally asymmetric with the amended D-17)** — errors are rare + sticky + demand user attention; pastes are frequent + transient. The asymmetry was made explicit in both the amended D-17 rationale paragraph AND the serial.js:441 comment block.
- **Spec amendment in the same plan as the code change** — original D-17 preserved verbatim inside a `<details>` superseded block so future planners can read the full history; the amendment is dated and references the debug session + UAT Test 6.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Verify-regex collision with comment text containing `<details id="connection">`**
- **Found during:** Task 1 (running the planner's verbatim verify command)
- **Issue:** The first attempt at the relocation included an explanatory HTML comment in the top-bar block reading `inside <details id="connection">`. The planner's verify regex `/<details id="connection"[\s\S]*?<\/details>/` is greedy and started matching at the literal text inside the comment, pulling the entire top-bar block (including the relocated `paste-progress-row`) into the supposed "connection block" — the verify command falsely reported the row was still inside the pane.
- **Fix:** Reworded the comment to "inside the Connection pane" (no literal `<details id="connection">` substring), keeping the explanation but removing the regex collision.
- **Files modified:** `www/index.html` (one comment paragraph)
- **Verification:** Re-ran the planner's verbatim verify — output `DOM relocation OK`.
- **Committed in:** `ceac705` (folded into Task 1's commit; not a separate commit)

**2. [Rule 1 — Bug] Gap 2 regression test raced 'Paste complete' with `Hello, world!\n` payload**
- **Found during:** Task 2 (running paste.spec.js after the new test was added)
- **Issue:** Initial regression test used a 14-byte payload. The pump finished in <100 ms — by the time `await expect(page.locator('#paste-progress-text')).toContainText('Pasting')` ran, the text had already transitioned to `'Paste complete'`. Test reliably failed.
- **Fix:** Bumped payload to 4 KB (`'G'.repeat(4096)` — 128 chunks × 18 ms ≈ 2.3 s at 19200 baud); added a final `Paste complete` wait + post-paste pane-state check to also verify the invariant after the pump finishes.
- **Files modified:** `www/tests/transport/paste.spec.js` (the regression test body)
- **Verification:** `npx playwright test tests/transport/paste.spec.js --reporter=list` — all 9 tests pass (including the new one).
- **Committed in:** `f894620` (folded into Task 2's commit; not a separate commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs — both inline-discovered during own-task verification)
**Impact on plan:** Negligible. Both deviations were inline iteration during the executor's verification step; neither required new architectural decisions or scope changes.

## Issues Encountered

- **Pre-existing visibilitychange flake** — `tests/transport/readloop.spec.js` "visibilitychange !hidden triggers requestFrame catch-up" failed once during the first all-suite run with parallel workers, then passed on isolated re-run AND on the `--retries=2` re-run of the full suite (41/41). This is the same flake noted in Plan 08's SUMMARY (timing-sensitive `visibilitychange` test under worker contention). Not introduced by Plan 09 (this plan's code changes are: DOM relocation in index.html, observer-body changes in main.js, comment-only amendment in serial.js — none of which touch the read loop or visibilitychange path).

## User Setup Required

None — no external service configuration required.

**Real-hardware UAT follow-up:** The user must re-run `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` Test 6 on the actual MicroBeast (CP2102N 10c4:ea60) and update Test 6's `result:` from `issue` to `pass` if:

1. Paste progress text appears in the **top-bar** (upper-right area, not inside the expanded Connection pane).
2. The Connection pane stays collapsed throughout the paste.
3. The terminal canvas does NOT shift vertically on the page.
4. After `Paste complete`, the top-bar slot hides itself after the existing 2 s timeout; for `cancelled-port-lost` after 3 s.

The automated `paste.spec.js` Gap 2 regression coverage is the closest a Playwright spec can get to verifying the no-displacement invariant; only physical-hardware visual confirmation can prove end-to-end Test 6 closure (the Playwright suite asserts `connectionPane.open === false`, which is the proximate cause of the lurch, but cannot directly assert "the canvas pixel position did not change between two screenshots taken before and during the paste" without extending the test infrastructure).

## Next Phase Readiness

- Gap 2 closed at the code level + spec level. Real-hardware re-test is the only remaining step to close the entry in 05-HUMAN-UAT.md.
- Plan 05's two known gaps (Plan 08 Gap 1 reload-hang + Plan 09 Gap 2 paste lurch) are now both code-fixed and spec-amended. The transport surface is clean for Phase 6 polish/deployment to inherit.
- Phase 6 (Polish & Deployment) inherits a transport layer with no known UI/UX regressions vs the original Phase 5 plan; the amended D-17 is the canonical contract for any future paste-progress UI work.

## Threat Flags

No new threat surface introduced. The relocation is a layout change (same DOM IDs, same selectors, same event listeners, same trust boundary) — confirmed against the plan's `<threat_model>` STRIDE register (T-05-09-01 through T-05-09-04, all `accept`). No new network endpoints, auth paths, or schema changes at trust boundaries.

## Self-Check: PASSED

- File `www/index.html`: present; contains exactly one `id="paste-progress-row"` (verified inside `#top-bar`); CSS rule `#top-bar #paste-progress-row` present.
- File `www/main.js`: present; contains zero `preExpansionOpen` occurrences; contains zero `connectionPane.open =` assignments; contains `onPastePumpProgress` (per artifacts.contains marker).
- File `www/transport/serial.js`: present; contains "D-27 auto-expand on error (KEPT" comment; Plan 08 invariants preserved (shuttingDown × 3, reader.releaseLock × 3, writer.releaseLock × 3, unregisterWriter × 3).
- File `.planning/phases/05-web-serial-transport/05-CONTEXT.md`: present; `grep -c "AMENDED 2026-04-23 by Plan 09"` returns 1; D-17 contains amended-by-plan-09 block + rationale + D-27 contrast + superseded original block; `grep -c "D-17"` >= 1 (per artifacts.contains marker).
- File `.planning/phases/05-web-serial-transport/05-UI-SPEC.md`: present; `grep -c "SUPERSEDED BY PLAN 09"` returns 1; "auto-expand" appears in the amended table (per artifacts.contains marker).
- File `www/tests/transport/paste.spec.js`: present; new "paste does NOT auto-expand Connection pane (Gap 2 regression)" test passes against the 4 KB payload.
- Commit `ceac705`: present in `git log` (Task 1 — fix(05-09): relocate paste-progress-row from Connection pane to #top-bar (Gap 2)).
- Commit `f894620`: present in `git log` (Task 2 — fix(05-09): drop connectionPane.open mutations from paste observer + Gap 2 spec).
- Commit `b3e2b3d`: present in `git log` (Task 3 — docs(05-09): amend D-17 + UI-SPEC auto-expand rules to drop paste auto-expand).
- Playwright transport suite: 41 passed under `npx playwright test tests/transport/ --retries=2`.

---
*Phase: 05-web-serial-transport*
*Completed: 2026-04-25*
