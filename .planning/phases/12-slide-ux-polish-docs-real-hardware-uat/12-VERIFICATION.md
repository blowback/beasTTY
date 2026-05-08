---
phase: 12-slide-ux-polish-docs-real-hardware-uat
verified: 2026-05-08T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (automated)
overrides_applied: 0
human_verification:
  - test: "Execute SLIDE-UAT.md UAT-12-01 — Multi-file send including binary .COM"
    expected: "Z80 receives all files cleanly, CP/M prompt returns after session; SLIDE chip shows correct file count and 100% on all files"
    why_human: "Requires patched MicroBeast hardware with ESC^SLIDE wakeup in slide.asm plus physical serial connection"
  - test: "Execute SLIDE-UAT.md UAT-12-02 — Multi-file recv including zero-byte file"
    expected: "All files appear in Chrome downloads tray with correct names; zero-byte file creates an empty download; CP/M prompt returns cleanly"
    why_human: "Requires patched MicroBeast hardware and real Z80-initiated transfer"
  - test: "Execute SLIDE-UAT.md UAT-12-03 — Cancel mid-send (PC-initiated)"
    expected: "Wire returns to neutral CP/M prompt after cancel; SLIDE chip shows 'Cancelled — N of M files transferred'; no data corruption"
    why_human: "Requires real hardware to verify wire neutrality and CP/M prompt recovery"
  - test: "Execute SLIDE-UAT.md UAT-12-04 — Cancel mid-recv with Z80 echo verified (currently blocked)"
    expected: "result: blocked — Z80 SLIDE.COM does not yet implement ADR-003 CTRL_CAN echo; gate on upstream github.com/blowback/slide PR landing"
    why_human: "Requires upstream slide.asm patch to land plus physical hardware verification of bidirectional CTRL_CAN echo"
---

# Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT — Verification Report

**Phase Goal:** Close the v1.1 milestone — handle the residual UX cliffs (filename collisions on send, drag-drop vs pointer-select isolation, auto-send command safety validation), document the Z80-side dependency and the user-facing protocol, and run an end-to-end UAT against a real MicroBeast with the patched slide.asm. After this phase, Beastty v1.1 is daily-driver-ready for SLIDE.

**Verified:** 2026-05-08
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                                                                                                | Status     | Evidence                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Drag-drop on `#terminal-wrapper` coexists with v1.0 pointer-select: `selection.js:onPointerDown` early-returns when drop overlay is active; Playwright regression spec proves no ghost selection after a drop         | ✓ VERIFIED | `selection.js` line 115-121 contains strict-equality predicate `getAttribute('data-drop-target') === 'true'`; `selection-drop.spec.js` exists (115 lines, 3 tests: overlay-active / regression / post-drop); commits `fe99569`, `4c3767b` |
| 2   | Filename collisions on send are detected pre-flight; user prompted to auto-rename, refuse batch, or send only first; `computeRenameScheme` implements the D-04 unlimited-via-base-truncation rule                    | ✓ VERIFIED | `file-source.js` exports `computeRenameScheme` (line confirms); `index.html` has 3 collision modal buttons (`send-modal-send-renamed`, `send-modal-first-only`, `send-modal-refuse`); default focus on `[Send N renamed]` when collisions; 8-test spec `slide-collisions.spec.js` (224 lines, 8 tests); commits `be4a630`, `93efb1b`, `6eb72f9` |
| 3   | Auto-send command validated for safety — `isAutoSendSafe` exported from `prefs.js` with regex `/^[A-Za-z0-9: ]*\r$/`; use-time gate in `slide.js`; first-use-confirm chip lifecycle in `slide-chip.js`              | ✓ VERIFIED | `prefs.js` contains `const SAFE_AUTO_SEND_RE = /^[A-Za-z0-9: ]*\r$/` and exports `isAutoSendSafe`; `slide.js` imports `isAutoSendSafe` and gates at `readAutoSendCommandBytes`; `slide-chip.js` has `first-use-confirm` lifecycle state + `enterFirstUseConfirm`; 15-test spec `slide-autosend-safety.spec.js` (5 SAFE + 5 UNSAFE + 5 integration); commits `cf2815b`, `59d2f94`, `27d4872`, `5ecd514` |
| 4   | `docs/SLIDE_Z80_REQUIREMENT.md` documents ESC^SLIDE wakeup, v0.2.1 amendment, B:SLIDE R convention, upstream PR link; README.md gains "File transfer" section + extended keyboard shortcuts covering drag-drop and file-picker | ✓ VERIFIED | `docs/SLIDE_Z80_REQUIREMENT.md` exists (135 lines); contains ESC^SLIDE wakeup, ADR-003 citation, B:SLIDE R, `github.com/blowback/slide` link, "Status: pending upstream merge" banner; `README.md` has `## File transfer (SLIDE)` with `### Sending files`, `### Receiving files`, `### Cancelling`; 3 new keyboard-shortcut rows (drag files / ↑ Send file / Esc during transfer); commits `8c38b29`, `083e1ec` |
| 5   | `docs/SLIDE-UAT.md` exists with exactly 4 `### UAT-12-NN` headings; UAT-12-04 has `result: blocked` idiom; scaffold ready for hardware execution once upstream slide.asm patch lands                                | ✓ VERIFIED (scaffold) | `docs/SLIDE-UAT.md` exists (172 lines); `grep -c '^### UAT-12-'` returns 4; UAT-12-01..03 have `result: TBD (pending Z80 PR...)`; UAT-12-04 has `result: blocked (Z80 SLIDE.COM does not yet implement the v0.2.1 ADR-003...)`; commit `df59090` |

**Score:** 5/5 truths verified (automated artifacts and code)

---

### Required Artifacts

| Artifact                                                      | Expected                                                   | Status     | Details                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `www/input/selection.js`                                      | onPointerDown early-return on `[data-drop-target="true"]`  | ✓ VERIFIED | Lines 115-121: strict-equality predicate; SLIDE-12 comment; em-dash in header causes `file` to report binary but file is valid UTF-8 JS |
| `www/tests/render/selection-drop.spec.js`                     | 3 Playwright regression tests (SLIDE-12)                   | ✓ VERIFIED | 115 lines; 3 tests: "overlay active", "regression", "post-drop"; self-contained per spec-isolation convention        |
| `www/input/file-source.js`                                    | computeRenameScheme export + processFiles 2nd pass + modal | ✓ VERIFIED | 682 LOC; exports `computeRenameScheme`; `applyCollisionRenames` + `applyFirstOnlyFilter` helpers; modal three-mode flow; `clearSelectionFnRef` in `onDrop` |
| `www/index.html`                                              | 3 new modal footer buttons + collision row CSS             | ✓ VERIFIED | `#send-modal-send-renamed`, `#send-modal-first-only`, `#send-modal-refuse` buttons (all `hidden` by default); collision-row CSS appended |
| `www/main.js`                                                 | wireFileSource opts extended with clearSelectionFn          | ✓ VERIFIED | Contains `clearSelectionFn: () => { try { selection.clearSelection(); } catch { /* ignore */ } }` in wireFileSource call |
| `www/tests/transport/slide-collisions.spec.js`               | 8 Playwright tests (SLIDE-36)                              | ✓ VERIFIED | 224 lines; 8 top-level `test()` calls (verified via `grep -c "^test("`)                                              |
| `www/state/prefs.js`                                          | isAutoSendSafe export with correct regex                    | ✓ VERIFIED | `const SAFE_AUTO_SEND_RE = /^[A-Za-z0-9: ]*\r$/`; `export function isAutoSendSafe(cmd)` present                     |
| `www/transport/slide.js`                                      | use-time gate at readAutoSendCommandBytes                   | ✓ VERIFIED | Imports `isAutoSendSafe`; gate inside `readAutoSendCommandBytes`; `enterSendMode` split into 3 functions (sync entry + async first-use branch + `enterSendModeProceed`) |
| `www/renderer/slide-chip.js`                                  | first-use-confirm lifecycle state + enterFirstUseConfirm   | ✓ VERIFIED | `'first-use-confirm'` state in 9-state union; `enterFirstUseConfirm({ value, onConfirm, onReset })`; 30s defensive auto-hide |
| `www/tests/transport/slide-autosend-safety.spec.js`          | 15 Playwright tests (SLIDE-38)                             | ✓ VERIFIED | 239 lines; 10 loop-generated tests (5 SAFE + 5 UNSAFE via `for...of`) + 5 explicit `test()` calls = 15 total         |
| `docs/SLIDE_Z80_REQUIREMENT.md`                               | Z80 requirements doc with all 4 locked sections            | ✓ VERIFIED | 135 lines; §1 ESC^SLIDE wakeup; §2 v0.2.1 amendment + ADR-003 citation; §3 B:SLIDE R convention; §4 upstream PR link with pending-upstream-merge banner; §5 cross-links |
| `README.md`                                                   | New "File transfer (SLIDE)" section + 3 keyboard shortcuts | ✓ VERIFIED | `## File transfer (SLIDE)` + 3 sub-sections; 3 new keyboard-shortcut rows; 36 insertions, 0 deletions (append-only)   |
| `docs/SLIDE-UAT.md`                                           | 4 UAT-12-NN headings + blocked idiom on UAT-12-04          | ✓ VERIFIED | 172 lines; `grep -c '^### UAT-12-'` = 4; UAT-12-04 `result: blocked`; UAT-12-01..03 `result: TBD`                    |

---

### Key Link Verification

| From                                   | To                                          | Via                                                 | Status     | Details                                                                |
| -------------------------------------- | ------------------------------------------- | --------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `selection.js:onPointerDown`           | `#terminal-wrapper [data-drop-target]`      | `getAttribute('data-drop-target') === 'true'`       | ✓ WIRED    | Confirmed in selection.js lines 115-121; matches CONTEXT §Claude's Discretion default mechanism |
| `file-source.js:processFiles`          | `computeRenameScheme`                       | second pass after validate+truncate loop             | ✓ WIRED    | `computeRenameScheme(group)` called in collisionRows construction      |
| `file-source.js:showConfirmModal`      | `#send-modal-send-renamed`                  | `modalElRef.returnValue 'send' | 'first-only' | 'refuse'` | ✓ WIRED | Button present in index.html; `sendRenamedBtnRef` wired in wireFileSource |
| `file-source.js:onDrop`               | `selection.clearSelection` via clearSelectionFn | main.js boot wiring injection                   | ✓ WIRED    | `clearSelectionFnRef` called in `onDrop` after `setDropTarget(false)`; `clearSelectionFn` in main.js wireFileSource opts |
| `slide.js:readAutoSendCommandBytes`    | `isAutoSendSafe` from prefs.js              | import + use-time gate                              | ✓ WIRED    | `import { isAutoSendSafe } from '../state/prefs.js'`; gate fires before `TextEncoder.encode` |
| `slide.js:shouldSurfaceFirstUseConfirm` | `slide-chip.js:enterFirstUseConfirm`       | `surfaceFirstUseConfirm` Promise + chip callbacks   | ✓ WIRED    | Async branch in `enterSendModeAfterFirstUseConfirm` calls `slideChipRef.enterFirstUseConfirm` |
| `main.js Settings handler`             | `slideAutoSendCommandConfirmed` in prefs    | `savePrefs` threaded through `wireSlideDispatcher`  | ✓ WIRED    | `savePrefsRef` module-scope ref in slide.js; settings change handler resets confirmed flag |

---

### Data-Flow Trace (Level 4)

Level 4 data-flow trace applies to UI components that render dynamic data. For Phase 12, the key dynamic surfaces are the collision modal and the first-use-confirm chip.

| Artifact                   | Data Variable     | Source                                    | Produces Real Data | Status     |
| -------------------------- | ----------------- | ----------------------------------------- | ------------------ | ---------- |
| `file-source.js` modal     | `collisionRows`   | `processFiles` second pass over `surviving` array | Yes — derived from actual file objects passed by user | ✓ FLOWING |
| `file-source.js` modal     | `sendRenamedBtnRef.textContent` | computed count of renamed files from `collisionRows` | Yes — live count `Send ${n} renamed` | ✓ FLOWING |
| `slide-chip.js` first-use-confirm | `firstUseConfirmCallbacks.value` | `cmd` string from `prefs.slideAutoSendCommand` at enterSendMode call time | Yes — read from prefs at use time | ✓ FLOWING |

---

### Behavioral Spot-Checks (Step 7b)

The app has no standalone runnable entry points (requires browser + wasm). Spot-checks via grep-level verification instead:

| Behavior                                                        | Check                                                                                         | Result | Status  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ------- |
| isAutoSendSafe rejects default value before space-fix           | `python3 -c "import re; print(bool(re.match(r'^[A-Za-z0-9:]*\\r$', 'B:SLIDE R\\r')))"` | False (correctly would reject without space) | ✓ VERIFIED (space fix confirmed via regex in prefs.js) |
| isAutoSendSafe accepts 'B:SLIDE R\r' with space in class        | `SAFE_AUTO_SEND_RE = /^[A-Za-z0-9: ]*\r$/` — space present in class                        | PASS   | ✓ PASS  |
| selection-drop.spec.js has correct test count                   | `grep -c "^test(" www/tests/render/selection-drop.spec.js` = 3                              | 3      | ✓ PASS  |
| slide-collisions.spec.js has correct test count                 | `grep -c "^test(" www/tests/transport/slide-collisions.spec.js` = 8                         | 8      | ✓ PASS  |
| UAT-12-04 blocked result present                                | `grep "result:.*blocked" docs/SLIDE-UAT.md` matches                                         | MATCH  | ✓ PASS  |
| Zero Rust files modified in Phase 12 commits                    | `git show --name-only <12 commits> \| grep "^crates/"` = empty                              | Empty  | ✓ PASS  |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                    | Status      | Evidence                                                                         |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| SLIDE-12    | 12-01, 12-02 | Drag-drop coexists with pointer-select; onPointerDown early-returns when drop overlay active   | ✓ SATISFIED | selection.js predicate + clearSelectionFn injection + 3-test spec; REQUIREMENTS.md [x] |
| SLIDE-36    | 12-02       | Filename collisions detected pre-flight; user prompted to auto-rename/refuse/send-only-first    | ✓ SATISFIED | computeRenameScheme export + 3-button modal + 8-test spec; REQUIREMENTS.md [x]   |
| SLIDE-38    | 12-03       | Auto-send command validated; isAutoSendSafe with `/^[A-Za-z0-9: ]*\r$/`; first-use confirm chip | ✓ SATISFIED | prefs.js regex + slide.js gate + slide-chip.js lifecycle + 15-test spec; REQUIREMENTS.md [x] |
| SLIDE-40    | 12-04       | docs/SLIDE_Z80_REQUIREMENT.md with all 4 locked content items                                  | ✓ SATISFIED | 135-line doc exists with all 4 sections + pending-merge banner; REQUIREMENTS.md [x] |
| SLIDE-41    | 12-04       | README "File transfer" section + keyboard shortcuts extended for drag-drop + file-picker        | ✓ SATISFIED | README.md has section + 3 shortcut rows; no BestialiTTY occurrences; REQUIREMENTS.md [x] |
| SLIDE-42    | 12-05       | docs/SLIDE-UAT.md mirroring 06-HUMAN-UAT.md with 4 UAT-12-NN tests                            | ✓ SATISFIED | 172-line scaffold exists; 4 headings; UAT-12-04 blocked; REQUIREMENTS.md [x]     |

All 6 Phase 12 requirement IDs are marked Complete in both REQUIREMENTS.md top-level checkboxes and traceability table.

---

### Anti-Patterns Found

| File                           | Line | Pattern                                                                        | Severity | Impact                                                                                                   |
| ------------------------------ | ---- | ------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `www/input/selection.js`       | 209  | `text[end] === '\x00'` — null byte comparison (WR-01 from code review); second branch of the whitespace-trim `while` loop compares to null byte (0x00) rather than a Unicode whitespace look-alike | ⚠️ Warning | Silently fails to trim null-byte positions in triple-click `selectLine`; harmless in practice (terminal cells never contain null bytes in text form) — pre-existing to Phase 12; Phase 12 change was limited to lines 115-121 |
| `www/transport/slide.js`       | 850-870 | No `firstUseConfirmPending` sentinel flag (WR-02 from code review) — double-`enterSendMode` race window during async first-use-confirm path | ⚠️ Warning | In production, the Send button is disabled during the confirm modal; race only triggered by rapid programmatic double-call (e.g., `window.__slide.enterSendMode` in tests). Known limitation documented in 12-03-SUMMARY.md §Known Limitations as T-12-07, flagged for Phase 12.1 cleanup. Not a goal blocker. |
| `www/tests/render/selection-drop.spec.js` | 37-44 | `window.__metrics?.cellSize?.()` fallback path never resolves — always uses hardcoded `{ cellW: 9, cellH: 18 }` (IN-01 from code review) | ℹ️ Info | Hardcoded fallback fires correctly for current cell dimensions; risk if cell size changes via zoom or DPR change. Test reliability concern only, not a production issue. |
| `www/transport/slide.js`       | 920  | `cmd` parameter commented out of `enterSendModeProceed` destructuring (IN-02); `readAutoSendCommandBytes` re-reads prefs internally instead of using caller-provided validated `cmd` | ℹ️ Info  | Negligible time window between validation and re-read in practice; inconsistency in design intent. Non-blocking. |
| `README.md`                    | 20   | "crips" typo should be "crisp" (IN-03 from code review)                        | ℹ️ Info  | Cosmetic typo only, pre-existing to Phase 12                                                              |
| `www/input/file-source.js`     | 223-228 | `isSessionActive()` does not check `mode === 'recv'` (IN-04 from code review) — drop overlay can appear during recv session | ℹ️ Info  | UI incorrectly renders drop overlay during recv; the `enterSendMode` wire-safety gate in slide.js prevents actual wire corruption (`owner !== 'terminal'` guard). Modal opens but no bytes reach the wire. |
| `.planning/ROADMAP.md`         | 261-264, 284 | Phase 12 plan checkmarks for 12-02..12-05 are still `[ ]` (unchecked) and progress table shows "1/5 In progress" | ℹ️ Info  | Documentation staleness only; all actual deliverables verified as shipped. REQUIREMENTS.md correctly shows all 6 IDs Complete. |

**Blockers:** 0 critical issues.
**Warnings:** 2 (WR-01 pre-existing null-byte bug in selectLine; WR-02 first-use-confirm race window — flagged for Phase 12.1). Neither prevents goal achievement.

---

### Human Verification Required

#### 1. UAT-12-01: Multi-file send including binary .COM

**Test:** With a patched MicroBeast (slide.asm with ESC^SLIDE wakeup + CTRL_CAN echo per ADR-003): drag a batch of files including a `.COM` binary onto the canvas. Observe the SLIDE chip, observe file receipt on the Z80 side, confirm CP/M prompt returns cleanly.

**Expected:** All files appear on the Z80; the SLIDE chip shows "File N of M" progress and completes at 100%; CP/M prompt returns after session. The filename collision auto-rename modal appears correctly if any dropped filenames collide after 8.3 truncation.

**Why human:** Requires patched MicroBeast hardware with ESC^SLIDE-capable slide.asm plus physical serial connection. Cannot be automated without real hardware.

---

#### 2. UAT-12-02: Multi-file recv including zero-byte file

**Test:** From CP/M prompt, run `B:SLIDE S FILE.TXT,ZERO.DAT` where `ZERO.DAT` is a 0-byte file. Observe browser downloads.

**Expected:** Both files appear in Chrome downloads tray; `ZERO.DAT` creates a 0-byte download; CP/M prompt returns cleanly after session. ESC^SLIDE wakeup detected automatically.

**Why human:** Requires patched MicroBeast hardware and real Z80-initiated transfer.

---

#### 3. UAT-12-03: Cancel mid-send (PC-initiated)

**Test:** Initiate a multi-file send; during transfer, press Esc or click [Cancel] on the SLIDE chip.

**Expected:** Transfer cancels; SLIDE chip shows "Cancelled — N of M files transferred"; CP/M prompt returns cleanly (wire neutral); no data corruption observed on Z80 side.

**Why human:** Requires real hardware to verify wire neutrality and clean CP/M prompt recovery.

---

#### 4. UAT-12-04: Cancel mid-recv with Z80 echo verified — CURRENTLY BLOCKED

**Test:** Would verify ADR-003 bidirectional CTRL_CAN echo: PC sends CTRL_CAN, Z80 must echo within 500ms.

**Expected:** result: blocked (Z80 SLIDE.COM does not yet implement ADR-003 ESC^SLIDE wakeup + CTRL_CAN echo). Gate: upstream github.com/blowback/slide PR must land first.

**Why human:** Requires upstream slide.asm patch to land plus physical hardware verification of bidirectional CTRL_CAN echo. Inherits UAT-10-01 blocked-result idiom.

---

### Gaps Summary

No automated gaps found. All 6 Phase 12 requirement IDs are verified as implemented in the codebase. The only open items are:

1. **Real-hardware UAT execution** (SC#5): `docs/SLIDE-UAT.md` is scaffolded and ready. UAT-12-01..03 await the upstream `github.com/blowback/slide` PR (ESC^SLIDE wakeup support in patched slide.asm). UAT-12-04 additionally requires ADR-003 CTRL_CAN echo implementation. This is the designed outcome per CONTEXT — blocked on upstream, not on Beastty implementation.

2. **ROADMAP.md progress table staleness**: Plans 12-02..12-05 checkmarks are `[ ]` and progress shows "1/5 In progress". This is a documentation artifact — all deliverables are shipped and REQUIREMENTS.md correctly reflects all 6 IDs as Complete. The ROADMAP should be updated to mark Phase 12 complete.

3. **WR-01 null-byte bug in selectLine** and **WR-02 first-use-confirm race window**: Both are warning-level issues flagged for Phase 12.1 cleanup. Neither blocks the v1.1 milestone goal.

---

_Verified: 2026-05-08_
_Verifier: Claude (gsd-verifier)_
