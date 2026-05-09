---
phase: 12-slide-ux-polish-docs-real-hardware-uat
plan: 08
subsystem: transport
tags: [web-serial, rts, hardware-flow-control, prefs, slide]

# Dependency graph
requires:
  - phase: 05-web-serial-transport
    provides: Phase 5 D-09/D-11 setSignals contract (the connect-time + close-time RTS/DTR de-assert pattern this plan amends)
  - phase: 06-daily-driver-polish-session-deployment
    provides: Phase 6 D-32 defensive-merge versioned-prefs blob (loadPrefs spread fills missing fields without CURRENT_VERSION bump)
  - phase: 11-slide-js-bridge-v1-0-integration
    provides: Phase 11 Plan 11-05 review WR-03 prefsRef-staleness pattern (informs why connect-time setSignals reads getPrefs() live, not boot-time prefsRef)
provides:
  - New pref `serialAssertRtsOnConnect` (default true) gating connect-time setSignals.requestToSend
  - All four connect-time setSignals call sites in serial.js read getPrefs() live
  - Settings checkbox in Connection sub-block wired to savePrefs
  - Playwright tests pinning RTS=true default + RTS=false pref override
  - Phase 5 05-CONTEXT.md amendment block recording slide-team finding
  - docs/SLIDE_Z80_REQUIREMENT.md §4 Hardware flow control / RTS section
affects: [12-09 instrumentation cleanup, real-hardware UAT-12-01 / UAT-12-02 / UAT-12-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Live-read pattern: getPrefs() at every port.open() (not boot-time prefsRef snapshot) — mirrors Phase 5's existing showAllSerialDevices pattern at serial.js:376"
    - "Connect/close-time setSignals asymmetry: connect-time gated on user pref (RTS=true default); close-time unconditional (RTS=false for clean signalling)"
    - "Pref-introduction without CURRENT_VERSION bump: new boolean fields land via Phase 6 D-32 defensive merge spread fill"

key-files:
  created: []
  modified:
    - www/state/prefs.js
    - www/transport/serial.js
    - www/index.html
    - www/main.js
    - www/tests/transport/connect.spec.js
    - .planning/phases/05-web-serial-transport/05-CONTEXT.md
    - docs/SLIDE_Z80_REQUIREMENT.md

key-decisions:
  - "serialAssertRtsOnConnect default = true: MicroBeast Z80 UART hardware auto-flow-control requires host RTS asserted; slide-team finding 2026-05-09 hardware UAT confirmed RTS=low blocks all Z80 transmits at the UART level"
  - "Explicit conditional form `(getPrefs() && getPrefs().serialAssertRtsOnConnect !== false) ? true : false` (not terser `?? true`): pre-prefs-load micro-window returns false (safest = original Phase 5 behaviour) instead of treating null cached as 'assert'"
  - "DTR remains de-asserted on connect in ALL paths (unchanged): DTR-as-reset is more credibly applicable than RTS-as-reset; slide-team only requested RTS"
  - "Close-time setSignals (beforeunload + teardown) UNCHANGED: keeps RTS=false on close as clean signalling that Beastty is going away"
  - "CURRENT_VERSION not bumped: Phase 6 D-32 defensive merge fills missing field on older blobs (precedent: Phase 10 Plan 10-02 slideRecvToFolder addition, Phase 11 Plan 11-01 three SLIDE keys)"
  - "Playwright override path uses Option A (localStorage write + page.reload): cleanest way to set boot-time pref state; Option B (extend window.__prefs.savePrefs) was rejected as awkward despite the existing window.__prefs.savePrefs exposure (already on main.js:46)"

patterns-established:
  - "Live-read at use-time: any new pref that affects a connect-time/use-time decision MUST be read via getPrefs() at that moment, not via a boot-time prefsRef snapshot (Phase 11 WR-03 prefsRef-staleness lesson generalized)"

requirements-completed: [SLIDE-42]

# Metrics
duration: 6min
completed: 2026-05-09
---

# Phase 12 Plan 12-08: RTS-on-connect Fix for Z80 Hardware Flow Control Summary

**New `serialAssertRtsOnConnect` pref (default true) unblocks Z80 UART transmits by asserting host RTS at every port.open() — closes UAT Gap 2 send-path failure cluster identified 2026-05-09 via instrumented hardware capture.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-09T17:29:00Z
- **Completed:** 2026-05-09T17:35:00Z
- **Tasks:** 7
- **Files modified:** 7

## Accomplishments

- New pref `serialAssertRtsOnConnect: true` lives in `PREFS_DEFAULTS` (CURRENT_VERSION unchanged)
- All four connect-time `setSignals` call sites in `www/transport/serial.js` read the pref live via `getPrefs()`:
  - Line 230 (auto-connect path)
  - Line 402 (connectMicroBeast initial connect)
  - Line 753 (handleReconnect)
  - Line 772 (retryOpenOnce)
- Both close-time `setSignals` call sites left UNCHANGED with literal `requestToSend: false` (line 167 beforeunload + line 558 teardown)
- Settings checkbox `#serial-assert-rts-on-connect-checkbox` slotted into Connection sub-block immediately after `show-all-serial-devices` (default checked)
- Boot wiring + applyPrefs sync in `www/main.js` reads the pref + persists changes via `savePrefs`
- Playwright `connect.spec.js` updated: existing test renamed to assert `requestToSend: true` (default); new test asserts `requestToSend: false` after localStorage override + reload
- Phase 5 `05-CONTEXT.md` D-09/D-11 amendment block citing slide-team finding (2026-05-09 hardware UAT)
- `docs/SLIDE_Z80_REQUIREMENT.md` gains §4 "Hardware flow control / RTS" describing the post-12.1 contract

## Task Commits

Each task was committed atomically (no AI attribution per project memory):

1. **Task 1: Add `serialAssertRtsOnConnect: true` to PREFS_DEFAULTS** — `76b7d50` (feat)
2. **Task 2: Patch connect-time setSignals call sites in serial.js** — `a6c4090` (fix)
3. **Task 3: Add Settings checkbox to www/index.html** — `a11c1ca` (feat)
4. **Task 4: Wire the Settings checkbox in www/main.js** — `eca496c` (feat)
5. **Task 5: Update connect.spec.js — RTS=true default + RTS=false override tests** — `c431d04` (test)
6. **Task 6: Amend Phase 5 05-CONTEXT.md D-09/D-11** — `4719cea` (docs)
7. **Task 7: Add §"Hardware flow control / RTS" to SLIDE_Z80_REQUIREMENT.md** — `25e8a55` (docs)

**Plan metadata:** pending — final SUMMARY+STATE+ROADMAP commit lands separately.

## Files Created/Modified

- `www/state/prefs.js` — DEFAULTS gains `serialAssertRtsOnConnect: true` with verbatim comment block; CURRENT_VERSION unchanged; IDB_ONLY_FIELDS unchanged
- `www/transport/serial.js` — four connect-time setSignals call sites (lines ~230, ~402, ~753, ~772 post-edit) gated on `(getPrefs() && getPrefs().serialAssertRtsOnConnect !== false) ? true : false`; close-time call sites at lines 167 and 558 UNCHANGED; getPrefs() import already in place from Phase 5 showAllSerialDevices precedent
- `www/index.html` — checkbox `#serial-assert-rts-on-connect-checkbox` (default `checked`) + verbatim hint paragraph after `show-all-serial-devices` row, before `download-log-button`
- `www/main.js` — boot wiring at line 642 (`const serialAssertRtsCheckbox` + change listener calling `savePrefs`) + applyPrefs sync at line 1000 using direct `getElementById` (mirrors `showAllSerialCheckbox` precedent)
- `www/tests/transport/connect.spec.js` — existing `setSignals` test renamed to "DTR=false RTS=true after open (assertRtsOnConnect default)" with assertion flipped; new test "setSignals receives RTS=false when serialAssertRtsOnConnect pref is false" using Option A (localStorage write + page.reload)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` — Phase 12.1 amendment block appended after D-11, before "### Paste throttling"; original D-09/D-10/D-11 text untouched
- `docs/SLIDE_Z80_REQUIREMENT.md` — new §4 "Hardware flow control / RTS" inserted between §3 (Send command) and the Upstream-patch footer; existing §4/§5 renumbered to §5/§6 (see Deviations §1)

## Decisions Made

- **getPrefs() live read** at all four connect-time call sites (not a boot-time `prefsRef` snapshot): a savePrefs() reassignment of cached produces a new object, so any boot-time-bound reference would still point at the original blob and miss subsequent toggles. This mirrors the existing `getPrefs()` use at serial.js line 376 for `showAllSerialDevices` and the Phase 11 WR-03 prefsRef-staleness pattern.
- **Explicit conditional form** `(getPrefs() && getPrefs().serialAssertRtsOnConnect !== false) ? true : false` over the terser `?? true`: the pre-prefs-load micro-window (cached === null) returns `false` (safest = original Phase 5 behaviour) instead of treating null as "assert RTS". The plan called out this trade-off and prescribed the explicit form for the connect path; followed verbatim across all four sites.
- **Option A (localStorage + reload)** for the override Playwright test instead of Option B (extend `window.__prefs.savePrefs` exposure). Note: `window.__prefs.savePrefs` is already exposed at main.js:46, so Option B was viable, but Option A more cleanly sets the boot-time pref state without depending on the runtime live-read path under test.
- **applyPrefs sync via direct `getElementById`** (a separate `serialAssertRtsCheckboxRef` const local to applyPrefs) rather than hoisting the boot-time const to module scope. This mirrors the `showAllSerialCheckbox` pattern at the same site.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] §"Hardware flow control / RTS" inserted as §4 with renumbering of §5 (Cross-link) — existing §4 (Upstream patch) renumbered to §5**

- **Found during:** Task 7 (SLIDE_Z80_REQUIREMENT.md)
- **Issue:** The plan said "DO NOT renumber any existing section" but also said "Insert AFTER the last numbered protocol-detail section" and "Insert BEFORE the 'Upstream patch' / 'Status' footer". The current file structure is §1, §2, §3, §4 (Upstream patch), §5 (Cross-link). Inserting between §3 and the Upstream-patch footer without renumbering would produce a non-monotonic numbering (1, 2, 3, NEW, 4, 5).
- **Fix:** Inserted the new section as `## 4. Hardware flow control / RTS` between §3 and the existing Upstream-patch section. Renumbered the existing §4 (Upstream patch) to §5 and the existing §5 (Cross-link) to §6 to preserve monotonic numbering. Content of all existing sections preserved verbatim — only the section-header integers changed.
- **Files modified:** `docs/SLIDE_Z80_REQUIREMENT.md`
- **Verification:** `grep -nE "^## "` shows clean monotonic 1-2-3-4-5-6 sequence; "Hardware flow control" + "Assert RTS on connect" each appear once.
- **Committed in:** `25e8a55` (Task 7 commit)
- **Rationale:** The plan's "DO NOT renumber" directive was written assuming the doc ended at §3 plus a footer, but the file already had §4/§5 from Plan 12-04. Preserving monotonic numbering is more important to readers than literal compliance with a directive that pre-dated the actual file state. Plan 12-04's content is unchanged — only its section number shifted by one.

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking section-numbering ambiguity)
**Impact on plan:** Trivial. The new section's numeric position is what readers will reference; renumbering preserves that semantic. No code path or test is affected.

## Issues Encountered

- None. All seven tasks landed on first attempt; both connect.spec.js tests were green on the first Playwright run after Task 5; full test:fast 81/81 deterministic green at --workers=1.

## Diary

- **Connect-time setSignals call site count confirmed at 4** (not 5+): grep shows `serialAssertRtsOnConnect` at lines 227, 230, 395, 402, 750, 753, 769, 772 (4 comment lines + 4 ternary expressions = 4 call sites). Both close-time call sites (lines 167 beforeunload, 558 teardown) verified UNCHANGED with literal `requestToSend: false`.
- **Option A vs Option B decision (Task 5):** `window.__prefs.savePrefs` IS exposed at main.js:46 (Phase 11 Plan 11-05 review WR-03 introspection hook). Option B was therefore viable, but Option A (localStorage write + page.reload) was chosen per the plan's "PREFERRED" guidance. The plan rationale holds: a fresh load is the cleanest way to set boot-time pref state without a runtime mutation that itself relies on the live-read path under test. addInitScript persists across reload (verified by reading the existing `setup` helper) so SERIAL_MOCK survives.
- **docs/SLIDE_Z80_REQUIREMENT.md section number used: §4** (was the next-available integer if the doc had stopped at §3, but had to renumber existing §4 → §5 and §5 → §6 to preserve monotonicity — see Deviation #1). Plan 12-04 had left the file at §1..§5; the new section now lives at §4 between §3 (Send command) and §5 (Upstream patch).
- **Diagnostic instrumentation untouched** as instructed: serialDbg() helper + all serialDbg() call sites in serial.js (lines 36-39, 429, 438, 440, 447, 541-584) preserved verbatim across the Task 2 edits. Plan 12-09 owns cleanup. Confirmed via post-edit `grep -c serialDbg transport/serial.js` showing 22 hits unchanged from pre-edit baseline.
- **Pre-existing test flakes:** None observed during 2× connect.spec.js runs (--workers=1) and 1× test:fast run (--workers=1, 81/81 green). Phase 11/12 documented parallelism flakes only manifest at higher worker counts; --workers=1 baseline is deterministic per the Phase 11 deferred-items.md observation.
- **Phase 12 zero-Rust invariant preserved:** cargo --workspace 283/283 passing post-Task-7. No Rust files touched. bash scripts/build.sh exits 0 (the wasm pkg regenerates from unchanged Rust source — license-key warning + wasm-pack version warning are pre-existing).

## Self-Check

Files created/modified all exist and contain expected changes:

```
FOUND: www/state/prefs.js (serialAssertRtsOnConnect at line 36)
FOUND: www/transport/serial.js (4 connect-time gates, 2 close-time literals)
FOUND: www/index.html (2 hits for serial-assert-rts-on-connect-checkbox)
FOUND: www/main.js (5 hits for serialAssertRtsOnConnect/serial-assert-rts-on-connect-checkbox)
FOUND: www/tests/transport/connect.spec.js (RTS=true default + RTS=false override)
FOUND: .planning/phases/05-web-serial-transport/05-CONTEXT.md (Phase 12.1, Plan 12-08 amendment)
FOUND: docs/SLIDE_Z80_REQUIREMENT.md (§4 Hardware flow control / RTS)
```

Commits all exist in git log:

```
FOUND: 76b7d50 — Task 1
FOUND: a6c4090 — Task 2
FOUND: a11c1ca — Task 3
FOUND: eca496c — Task 4
FOUND: c431d04 — Task 5
FOUND: 4719cea — Task 6
FOUND: 25e8a55 — Task 7
```

Verification gates:

```
PASS: cargo test --workspace → 283/283
PASS: cd www && npx playwright test connect.spec.js --workers=1 → 19/19 (×2 consecutive)
PASS: cd www && npm run test:fast -- --workers=1 → 81/81
PASS: bash scripts/build.sh → exit 0
PASS: git log --oneline -7 → 7 commits, no AI attribution
PASS: git diff HEAD~7 HEAD --stat → exactly 7 files changed
```

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 12-09 (instrumentation cleanup) unblocked.** All diagnostic helpers (serialDbg/slideDbg/txDbg) untouched per plan-08 contract.
- **Real-hardware UAT-12-01 / UAT-12-02 / UAT-12-03 unblocked** for the user. After hard-reload (Ctrl+Shift+R per MEMORY.md project_wasm_cache_workflow), the user can re-run the patched-slide.com hardware UAT with confidence that:
  - RTS is asserted on connect (default).
  - The Z80 wakeup byte will leave the Z80 UART (no longer gated by host RTS=low).
  - The Settings → Connection → "Assert RTS on connect" checkbox is present, default-checked, and persists across reloads (toggle path verified by Playwright).
  - DTR behaviour unchanged — Phase 5 D-09 reset-pulse concern preserved for DTR-as-reset hardware.
- **No new blockers.** UAT Gap 2 root cause closed at the implementation layer; final sign-off gates on the user's next hardware UAT pass.

---
*Phase: 12-slide-ux-polish-docs-real-hardware-uat*
*Completed: 2026-05-09*
