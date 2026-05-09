---
phase: 12-slide-ux-polish-docs-real-hardware-uat
plan: 09
subsystem: testing
tags: [cleanup, instrumentation, slide, serial, tx-sink, gap-closure]

# Dependency graph
requires:
  - phase: 12-slide-ux-polish-docs-real-hardware-uat
    provides: Plan 12-07 force-start chip-lifecycle fix (slideChipRef.enterActive() in case 'force-start') — preserved through this strip
  - phase: 12-slide-ux-polish-docs-real-hardware-uat
    provides: Plan 12-08 RTS-on-connect fix (four getPrefs()-gated requestToSend reads at connect-time setSignals call sites) — preserved through this strip
provides:
  - www/transport/slide.js with all SLIDE_DEBUG / slideDbg / slideDbgHex helpers and call sites removed
  - www/transport/serial.js with all SERIAL_DEBUG / serialDbg helpers and call sites removed (including the runReadLoop inbound-chunk inline block and 5-step teardown probes)
  - www/input/tx-sink.js with all TX_DEBUG / txDbg / txDbgHex helpers and call sites removed
  - 12-DEBUG-INSTRUMENTATION.md deleted from the phase directory
  - Net -244 lines across the four files; zero behavioural change to production code
affects: [Phase 12 verification gate, 12-HUMAN-UAT.md retrospective trail]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Diagnostic-instrumentation lifecycle: helpers are added with 'Remove this block' breadcrumbs in their own header comments, then mechanically stripped in a follow-up cleanup plan after the diagnosis lands"
    - "Cleanup-strip atomicity: one commit per file, separate commit for the reference doc deletion (4 commits total) — preserves git-bisect granularity"

key-files:
  created: []
  modified:
    - www/transport/slide.js
    - www/transport/serial.js
    - www/input/tx-sink.js
  deleted:
    - .planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-DEBUG-INSTRUMENTATION.md

key-decisions:
  - "Auto-fix Rule 1: removed dead local cmdSource (only-set-never-read) inside readAutoSendCommandBytes after slideDbg call sites consuming it were stripped; would otherwise produce an ESLint unused-variable warning post-cleanup"
  - "Multi-line slideDbg call sites and surrounding diagnostic-only state collected into entire block deletions where natural (e.g., the 8-key enterSendMode entry-probe object literal); single-line probes deleted at line granularity"
  - "Plan-12-07 force-start chip enterActive() call site sits in the same case 'force-start' branch as the slideDbg('handleChipInlineAction:enter', ...) probe — the surrounding production logic was left untouched and the slideDbg line was the only one removed (verified via grep before commit)"
  - "Plan-12-08 RTS-on-connect production fix is at four getPrefs()-gated requestToSend reads (lines 218 / 390 / 710 / 729 in serial.js) — those use getPrefs() not serialDbg() and were never on the strip path; verified with `grep -n requestToSend transport/serial.js` post-strip showing 6 hits (4 connect-time + 2 close-time)"

patterns-established:
  - "Pattern 1: Mechanical instrumentation strip — when stripping helpers, also strip dead locals that existed solely to feed those helpers (Rule 1 hygiene)"
  - "Pattern 2: Cleanup-plan grep gate — every cleanup plan ends with a whole-tree grep for the stripped identifiers; zero hits is the gate to mark the plan complete"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-05-09
---

# Phase 12 Plan 09: Diagnostic Instrumentation Cleanup Summary

**Stripped all SLIDE_DEBUG / slideDbg / serialDbg / txDbg helpers and call sites from www/{transport/slide.js,transport/serial.js,input/tx-sink.js} and deleted the now-stale 12-DEBUG-INSTRUMENTATION.md reference doc; net -244 lines, zero production-behaviour change, both Plan 12-07 and Plan 12-08 fixes intact.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-09T19:10:51Z
- **Completed:** 2026-05-09T19:18:43Z
- **Tasks:** 4 (atomic per file + the doc deletion)
- **Files modified:** 3 JS files + 1 deleted markdown reference

## Accomplishments

- Removed 49 occurrences of `slideDbg` / `SLIDE_DEBUG` / `slideDbgHex` from `www/transport/slide.js` (88 lines deleted, 12 added — net −76 in this file)
- Removed 26 occurrences of `serialDbg` / `SERIAL_DEBUG` from `www/transport/serial.js` (47 lines deleted, 4 added — net −43 in this file)
- Removed 11 occurrences of `txDbg` / `TX_DEBUG` / `txDbgHex` from `www/input/tx-sink.js` (33 lines deleted, 4 added — net −29 in this file)
- Deleted `.planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-DEBUG-INSTRUMENTATION.md` (96-line reference doc whose own "Removal" section explicitly said to delete after gap closure)
- Whole-tree grep for `slideDbg|SLIDE_DEBUG|slideDbgHex|serialDbg|SERIAL_DEBUG|txDbg|TX_DEBUG|txDbgHex` in `www/` returns zero matches; whole-tree grep for the log-tag strings `[slide-debug]` / `[serial-debug]` / `[tx-debug]` also returns zero matches
- cargo --workspace 283/283 baseline preserved (Phase 12 zero-Rust invariant honoured — no Rust file touched)
- npm run test:fast --workers=1 baseline preserved at 81/81
- Plan 12-07 force-start chip-lifecycle test (`slide-compatibility.spec.js -g "Force start"`) passes 2/2; Plan 12-08 RTS-on-connect tests (`connect.spec.js`) all pass 19/19
- bash scripts/build.sh exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Strip slideDbg / slideDbgHex / SLIDE_DEBUG from www/transport/slide.js** — `ce4c404` (chore)
2. **Task 2: Strip serialDbg / SERIAL_DEBUG from www/transport/serial.js** — `aad7da7` (chore)
3. **Task 3: Strip txDbg / txDbgHex / TX_DEBUG from www/input/tx-sink.js** — `94e1f8e` (chore)
4. **Task 4: Delete 12-DEBUG-INSTRUMENTATION.md** — `df28e8d` (chore)

**Plan metadata commit:** to follow this SUMMARY (per executor protocol — covers SUMMARY.md + STATE.md + ROADMAP.md updates).

## Files Created/Modified

- `www/transport/slide.js` — Stripped 49 occurrences of slideDbg / SLIDE_DEBUG / slideDbgHex (helpers + call sites + surrounding diagnostic-only locals like `cmdSource`). 12 insertions / 88 deletions.
- `www/transport/serial.js` — Stripped 26 occurrences of serialDbg / SERIAL_DEBUG (helpers + disconnect probes + runReadLoop inbound-chunk inline block + teardown 5-step probes). 4 insertions / 47 deletions.
- `www/input/tx-sink.js` — Stripped 11 occurrences of txDbg / TX_DEBUG / txDbgHex (helpers + call sites in pushTxBytes). 4 insertions / 33 deletions.
- `.planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-DEBUG-INSTRUMENTATION.md` — DELETED (96-line reference doc).

## Decisions Made

- **Strip dead locals alongside their consumers (Rule 1):** `let cmdSource;` inside `readAutoSendCommandBytes` was assigned in three branches solely to feed `slideDbg('readAutoSendCommandBytes:enter', { cmdSource, ... })` — once the slideDbg call was stripped, the variable became dead. Removed it as part of the same task to avoid leaving an ESLint warning footprint.
- **Multi-line probe object literals collapsed in single edits:** Several call sites passed multi-line object literals with 4–10 keys (e.g., the `enterSendMode:enter` probe with 9 keys, the `enterSendModeInternal:enter` probe with `metadataHex` + `fileCount` + `fileSizes`). These were removed in a single multi-line `Edit` rather than line-by-line to preserve atomicity.
- **Replaced multi-statement single-line probe-laden constructs with their core production statement:** e.g., `try { serialDbg('teardown:step2-reader-cancel-pending', {}); await reader.cancel(); serialDbg('teardown:step2-reader-cancel-done', {}); } catch (err) { serialDbg(...); }` collapsed to `try { await reader.cancel(); } catch { /* ignore */ }`. Functional behaviour identical (same try/catch shape, same await), instrumentation gone, error-binding renamed to anonymous catch since the error was only ever read by the dropped probe.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Dead-code hygiene] Removed `let cmdSource` inside `readAutoSendCommandBytes`**
- **Found during:** Task 1 (slide.js strip)
- **Issue:** `cmdSource` was a local string variable assigned in three branches at lines 216–226 of the original file solely to feed the `slideDbg('readAutoSendCommandBytes:enter', { cmdSource, ... })` probe. Once that probe was stripped, the variable became dead — only set, never read. Leaving it would produce an ESLint `no-unused-vars` warning under most lint configs and increases visual noise in a function whose body is otherwise tight.
- **Fix:** Removed the `let cmdSource;` declaration plus the three trailing `cmdSource = '…'` assignments inside the three if/else branches. The `cmd` variable assignments were preserved verbatim (functional logic).
- **Files modified:** `www/transport/slide.js`
- **Verification:** Function still produces correct `cmd` resolution per the original branch logic; `node --check` passes; Plan 12-07 force-start Playwright test passes after the change.
- **Committed in:** `ce4c404` (Task 1 commit)

**2. [Rule 1 - Dead-error-binding hygiene] Renamed error parameters to anonymous catches**
- **Found during:** Task 2 (serial.js strip)
- **Issue:** Several teardown try/catch sites bound `err` solely to feed `serialDbg('teardown:step1-setSignals-threw', { msg: err && err.message })` probes. After stripping, `err` was bound but never used — same `no-unused-vars` concern as #1.
- **Fix:** Where the `err` binding had no remaining consumer, switched `} catch (err) { ... }` to `} catch { /* ignore */ }`. Where the binding still fed a real `appendErrorLog` call (the setSignals catch), the binding was kept implicit-via-removal (the original block had two consumers: the probe and the appendErrorLog; only the probe was removed; the appendErrorLog used the message via `err && err.message` indirectly through the probe — verified by reading the original block before stripping).
- **Files modified:** `www/transport/serial.js`
- **Verification:** All 19 connect.spec.js tests still pass after the change; teardown step error paths still produce the same user-visible appendErrorLog output (the probe-only branches that lost their `err` binding had no other consumers).
- **Committed in:** `aad7da7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — dead-code hygiene downstream of the planned instrumentation strip)
**Impact on plan:** Both auto-fixes are direct consequences of the strip and necessary to keep the resulting code lint-clean. No production logic changed; no new identifiers introduced; no scope creep. Net diff stays line-removal-dominated as the plan specified (4 files, +20 / −264).

## Issues Encountered

None. Strip was mechanical; verification gates green on first run for each task; no test-flake retries needed at --workers=1.

## User Setup Required

None — purely internal cleanup; no external service configuration involved.

## Next Phase Readiness

- Phase 12 hardware UAT gap-closure milestone is now code-complete: 12-06 (UAT cosmetic + autosend invalid state), 12-07 (force-start chip lifecycle), 12-08 (RTS-on-connect), and 12-09 (instrumentation cleanup) all landed. The user's real-hardware re-test (UAT-12-01 / UAT-12-02 / UAT-12-03 against the patched slide.com) earlier today (commit 1382cf4) confirmed multi-file send works end-to-end, which is the gate that authorised this strip.
- `/gsd-verify-phase 12` is the next step — Phase 12 ready for verifier sweep.
- Pending real-hardware UAT items 4 (Z80→PC receive on real Z80) and 5 (1 MB-batch daily-driver feel) remain user-driven manual sign-offs; they do not block phase verification but are tracked in 12-HUMAN-UAT.md.

## Self-Check: PASSED

- FOUND: www/transport/slide.js (modified — slideDbg/SLIDE_DEBUG/slideDbgHex zero residue confirmed via grep)
- FOUND: www/transport/serial.js (modified — serialDbg/SERIAL_DEBUG zero residue confirmed via grep)
- FOUND: www/input/tx-sink.js (modified — txDbg/TX_DEBUG/txDbgHex zero residue confirmed via grep)
- MISSING: .planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-DEBUG-INSTRUMENTATION.md (intentional — deleted by Task 4)
- FOUND: ce4c404 (Task 1 commit on this branch)
- FOUND: aad7da7 (Task 2 commit on this branch)
- FOUND: 94e1f8e (Task 3 commit on this branch)
- FOUND: df28e8d (Task 4 commit on this branch)
- FOUND: cargo --workspace 283/283 (zero Rust touched)
- FOUND: npm run test:fast --workers=1 81/81
- FOUND: bash scripts/build.sh exit 0
- FOUND: Plan 12-07 force-start chip-lifecycle test passes (slideChipRef.enterActive() in case 'force-start' preserved at slide.js:382-383)
- FOUND: Plan 12-08 RTS-on-connect tests pass (4 connect-time getPrefs()-gated requestToSend reads + 2 close-time literals preserved at serial.js:155, 218, 390, 531, 710, 729)

---
*Phase: 12-slide-ux-polish-docs-real-hardware-uat*
*Completed: 2026-05-09*
