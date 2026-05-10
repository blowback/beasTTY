---
status: complete
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-01-SUMMARY.md, 12-02-SUMMARY.md, 12-03-SUMMARY.md, 12-04-SUMMARY.md, 12-05-SUMMARY.md, 12-06-SUMMARY.md, 12-07-SUMMARY.md, 12-08-SUMMARY.md, 12-09-SUMMARY.md]
started: 2026-05-09T19:26:31Z
updated: 2026-05-10T22:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev server. Run `bash scripts/build.sh`, serve `www/` over HTTP, open in Chromium with a HARD RELOAD (Ctrl+Shift+R per MEMORY.md project_wasm_cache_workflow). Page boots without console errors, terminal canvas + top bar render, ▼ Connect opens the Web Serial picker.
result: pass

### 2. Drop overlay isolation (SLIDE-12)
expected: Connect the MicroBeast (or use a saved-session). Drag a file from the OS file manager over the terminal canvas — the drop overlay highlights `#terminal-wrapper`. While the overlay is showing, NO text selection appears on the canvas underneath. (This is exercised end-to-end by `selection-drop.spec.js` since the OS-level mouse button is exclusive — manual testers typically skip with reason.)
result: pass

### 3. Post-drop ghost-clear (SLIDE-12)
expected: Make a normal text selection on the canvas (mouse-drag over fed glyphs — inverse text appears). Now drag a file from the OS over the canvas and drop it. After the drop completes (modal opens or closes), the previous inverse-text selection is gone — no leftover "ghost selection" lingers under the modal or after Cancel.
result: pass

### 4. Collision detection + auto-rename (SLIDE-36)
expected: Drop two files into the terminal whose names collide under CP/M 8.3 rules (e.g. `report.txt` and `REPORT.TXT`, or `longname1.txt` and `longname2.txt` which both truncate to `LONGNAME.TXT`). The send modal opens and shows a collision-row UI with the proposed renames (e.g. `REPORT.TXT` kept, `REPORT~1.TXT` for the second). The original list is visible alongside the rewritten names.
result: pass

### 5. Three-button modal default focus + visible focus ring (SLIDE-36 + Plan 12-06)
expected: With collisions present in the modal (from test 4), the footer shows three buttons: `[Send N renamed]` / `[Send only first]` / `[Refuse batch]`. The `[Send N renamed]` button has the default focus AND a visible green focus ring (rgb(51,255,102) border via `[data-focused="true"]` attribute pattern). Pressing Enter triggers `[Send N renamed]`.
result: pass

### 6. Refuse-batch cancellation (SLIDE-36)
expected: With the collision modal open from test 4-5, click `[Refuse batch]`. The modal closes, no transfer starts, and the chip area does not transition into a sending state. Nothing is sent over the wire (Z80 prompt unchanged).
result: pass

### 7. Auto-send safety regex with RED invalid border + validation hint (SLIDE-38 + Plan 12-06 + Gap A fix 760fbab)
expected: Open Settings → SLIDE sub-block. In the Auto-send command field, type something unsafe like `B:RM *.* ; SLIDE R` and tab/click away (blur). The input gets a RED border (`#e04040` = `--chrome-invalid-strong`) AND a sub-row hint appears reading "Auto-send command unsafe — disabled." (copy tightened in commit 7365b9b — was "using disabled."). The unsafe value is still SAVED — the gate is at use-time, not save-time.
result: pass
notes: "Initial run flagged 'sub row hint does not appear' (Plan 12-03 had restricted hint to use-time only per UI-SPEC §D; Plan 12-06 fixed border but not hint). Resolved by Gap A fix in commit 760fbab — change handler now unhides hint on unsafe blur (UI-SPEC §D retired). Hint copy further tightened from 'Auto-send command unsafe — using disabled.' to 'Auto-send command unsafe — disabled.' in commit 7365b9b per user feedback. User-verified after fix."

### 8. First-use confirmation chip (SLIDE-38 + Gap B fix 153aaed)
expected: In Settings, change the SLIDE auto-send command from the default `B:SLIDE R` to a different SAFE value (e.g. `A:SLIDE R`). Reload the page (new session). Click `↑ Send file` and pick a file → the chip surfaces a "first-use confirm" state with `[Confirm]` and `[Reset to default]` inline buttons, and the file is NOT yet sent. Click `[Confirm]` → the auto-send command goes to the wire and the transfer proceeds.
result: pass
notes: "Initial run flagged 'first use chip does not appear, goes immediately to send'. Root cause shared with Gap C: shouldSurfaceFirstUseConfirm read prefsRef.slideAutoSendCommandConfirmed from a stale boot-time snapshot — the Settings change handler had reset Confirmed='' but slide.js never saw it without a reload. Resolved by Gap C/B fix in commit 153aaed (slide.js getPrefs() live-read retrofit). User-verified after fix — chip surfaces correctly with Confirm/Reset buttons."

### 9. README File-transfer section (SLIDE-41)
expected: Open `README.md` at the repo root. It contains a new top-level section `## File transfer (SLIDE)` with three sub-sections (`### Sending files (PC → Z80)`, `### Receiving files (Z80 → PC)`, `### Cancelling`). The Keyboard-shortcuts table at the top of the file has three new rows: drag-files-onto-canvas, ↑ Send file button, Esc-during-SLIDE-transfer.
result: pass

### 10. Z80 firmware requirement doc (SLIDE-40 + Plan 12-08 §4)
expected: Open `docs/SLIDE_Z80_REQUIREMENT.md`. Six numbered sections present in monotonic order: §1 Wakeup signature `ESC ^ S L I D E`, §2 v0.2.1 amendment (CTRL_CAN echo + ADR-003 cite), §3 Send command convention `B:SLIDE R`, §4 Hardware flow control / RTS (post-12-08 — describes the new `serialAssertRtsOnConnect` pref), §5 Upstream patch with "Status: pending upstream merge" banner and a repo-root link to `https://github.com/blowback/slide` (no hardcoded PR number), §6 Cross-link to ADR-003 / SPEC-v0.2.md / PROJECT.md.
result: pass

### 11. Real-hardware UAT scaffold (SLIDE-42)
expected: Open `docs/SLIDE-UAT.md`. Exactly four tests present (`### UAT-12-01` through `### UAT-12-04`), preceded by a Setup section identifying the patched-slide.com requirement, and followed by a Sign-off block. UAT-12-04 carries `result: blocked` (waiting on upstream Z80 PR for ESC^SLIDE wakeup + CTRL_CAN echo). UAT-12-01..03 carry `result: TBD (pending Z80 PR ...)`.
result: pass

### 12. Force-start chip lifecycle transition + active-chip Cancel (Plan 12-07 + Gap C/D fixes 153aaed/728cbfe)
expected: Set Compatibility mode to "Auto" in Settings (NOT "Wakeup required" — that has no timeout). Drag a file onto the canvas. Click Confirm on first-use chip if surfaced. Wait for the 3-second WAKEUP_TIMEOUT — the chip shows `[Retry] [Cancel] [Force start]`. Click `[Force start]`. The chip TRANSITIONS to the active sending state. Click `[Cancel]` on the active chip. The chip dismisses cleanly, terminal returns to normal, no need to reload.
result: pass
notes: "Initial run mixed-flag report — Plan 12-07's chip-lifecycle transition (awaiting-timeout → active) DID fire, but two NEW bugs surfaced: (a) stale auto-send command on wire — Settings change without reload sent OLD value (Gap C); (b) [Cancel] on active-state chip after Force-start was a dead button (Gap D). Resolved by: commit 153aaed (slide.js getPrefs() live-read retrofit) for Gap C; commit 728cbfe (cancelSlideSend export + mode-dispatching onCancel in main.js) for Gap D. User-verified Gap D end-to-end with B:OLDSLIDE.COM legacy slide on real Z80 hardware: Force-start → active → Cancel → chip dismissed cleanly."

### 13. RTS-on-connect Settings checkbox (Plan 12-08)
expected: Open Settings → Connection sub-block. Immediately after the existing "Show all serial devices" row, a new checkbox `Assert RTS on connect` appears, default CHECKED, with an explanatory hint paragraph below. Toggling it OFF and reloading: on next connect, RTS is not asserted (Z80 won't transmit on auto-flow-control hardware). Toggling it back ON and reloading: connect asserts RTS again. The pref persists across page reloads.
result: pass

### 14. Debug instrumentation absent from console (Plan 12-09)
expected: Open the browser DevTools console. Connect to MicroBeast, drop a file, send it (or attempt to), then disconnect. Throughout the flow, the console shows ZERO log lines tagged `[slide-debug]`, `[serial-debug]`, or `[tx-debug]`. Only normal user-visible warnings/errors (if any) appear. (This confirms Plan 12-09's instrumentation strip — the diagnostic helpers used to find the 12-07/12-08 root causes have been cleanly removed.)
result: pass
notes: "Initially blocked because the SLIDE flow itself was broken (Gap C wire-path defect prevented driving a complete connect→send→disconnect). After Gaps C/D fixes landed and user successfully exercised real-hardware sends, no debug log lines were reported. Plan 12-09 SUMMARY confirms whole-tree grep for slideDbg|SLIDE_DEBUG|slideDbgHex|serialDbg|SERIAL_DEBUG|txDbg|TX_DEBUG|txDbgHex returns zero matches in www/, so the contract is structurally guaranteed."

## Summary

total: 14
passed: 14
issues: 0
pending: 0
skipped: 0
blocked: 0

## Resolutions (post-diagnosis)

All originally-flagged gaps resolved during the 2026-05-10 fix session.
Two additional UX niggles surfaced during user re-test were also closed.

| Gap / Niggle | Test | Diagnosis | Fix commit |
|---|---|---|---|
| Gap C — stale auto-send command on wire | 12 | slide.js prefsRef captured at boot; savePrefs reassigns cached blob | `153aaed` |
| Gap B — first-use-confirm chip skipped | 8 | shared root cause with Gap C (same prefsRef stale read) | `153aaed` |
| Gap D — [Cancel] no-op on active-state chip | 12 | onCancel only wired to cancelSlideRecv; send-mode counterpart absent | `728cbfe` |
| Gap A — validation-hint sub-row never paints | 7 | UI-SPEC §D restricted hint to use-time only | `760fbab` |
| Niggle 1 — focus border missing after Cancel | (post-D) | hidden chip drops focus to <body>; pointerdown preventDefault blocks click refocus | `e1ba1e8` |
| Niggle 2 — send modal button order/default focus | (post-A) | Phase 9 Pitfall 2 Cancel-default focus retired | `7fd276c` |
| Niggle 3 — hint copy "using disabled" awkward | (post-A) | tightened to "Auto-send command unsafe — disabled." | `7365b9b` |

Two debug sessions resolved:
- `.planning/debug/slide-stale-auto-send-cmd.md` (status: resolved) — Gap C/B
- `.planning/debug/slide-active-cancel-broken.md` (status: resolved) — Gap D

Regression coverage added across:
- `www/tests/transport/slide-autosend-safety.spec.js` — 3 new tests (Gap A hint, Gap B savePrefs first-use, Gap C savePrefs wire bytes)
- `www/tests/transport/slide-compatibility.spec.js` — 1 new test (Gap D [Cancel] dismisses post-Force-start active chip)
- `www/tests/transport/slide-collisions.spec.js` — 1 updated test (Niggle 2 default-focus on [Send N files])

## Gaps

[all closed — see Resolutions table above]
