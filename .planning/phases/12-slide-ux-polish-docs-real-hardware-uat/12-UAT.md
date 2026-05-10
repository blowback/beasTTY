---
status: partial
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-01-SUMMARY.md, 12-02-SUMMARY.md, 12-03-SUMMARY.md, 12-04-SUMMARY.md, 12-05-SUMMARY.md, 12-06-SUMMARY.md, 12-07-SUMMARY.md, 12-08-SUMMARY.md, 12-09-SUMMARY.md]
started: 2026-05-09T19:26:31Z
updated: 2026-05-10T19:50:00Z
---

## Current Test

[testing paused — 1 item outstanding (test 14 blocked by upstream defects in tests 7/8/12)]

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

### 7. Auto-send safety regex with RED invalid border (SLIDE-38 + Plan 12-06)
expected: Open Settings → SLIDE sub-block. In the Auto-send command field, type something unsafe like `B:RM *.* ; SLIDE R` and tab/click away (blur). The input gets a RED border (`#e04040` = `--chrome-invalid-strong`) and a sub-row hint appears reading "Auto-send command unsafe — using disabled.". The unsafe value is still SAVED — the gate is at use-time, not save-time.
result: issue
reported: "the sub row hint \"Auto-send command unsafe - using disabled\" does not appear"
severity: major

### 8. First-use confirmation chip (SLIDE-38)
expected: In Settings, change the SLIDE auto-send command from the default `B:SLIDE R` to a different SAFE value (e.g. `A:SLIDE R`). Reload the page (new session). Click `↑ Send file` and pick a file → the chip surfaces a "first-use confirm" state with `[Confirm]` and `[Reset to default]` inline buttons, and the file is NOT yet sent. Click `[Confirm]` → the auto-send command goes to the wire and the transfer proceeds.
result: issue
reported: "first use chip does not appear. goes immediately to send \"sending 1 file\" dialog."
severity: major

### 9. README File-transfer section (SLIDE-41)
expected: Open `README.md` at the repo root. It contains a new top-level section `## File transfer (SLIDE)` with three sub-sections (`### Sending files (PC → Z80)`, `### Receiving files (Z80 → PC)`, `### Cancelling`). The Keyboard-shortcuts table at the top of the file has three new rows: drag-files-onto-canvas, ↑ Send file button, Esc-during-SLIDE-transfer.
result: pass

### 10. Z80 firmware requirement doc (SLIDE-40 + Plan 12-08 §4)
expected: Open `docs/SLIDE_Z80_REQUIREMENT.md`. Six numbered sections present in monotonic order: §1 Wakeup signature `ESC ^ S L I D E`, §2 v0.2.1 amendment (CTRL_CAN echo + ADR-003 cite), §3 Send command convention `B:SLIDE R`, §4 Hardware flow control / RTS (post-12-08 — describes the new `serialAssertRtsOnConnect` pref), §5 Upstream patch with "Status: pending upstream merge" banner and a repo-root link to `https://github.com/blowback/slide` (no hardcoded PR number), §6 Cross-link to ADR-003 / SPEC-v0.2.md / PROJECT.md.
result: pass

### 11. Real-hardware UAT scaffold (SLIDE-42)
expected: Open `docs/SLIDE-UAT.md`. Exactly four tests present (`### UAT-12-01` through `### UAT-12-04`), preceded by a Setup section identifying the patched-slide.com requirement, and followed by a Sign-off block. UAT-12-04 carries `result: blocked` (waiting on upstream Z80 PR for ESC^SLIDE wakeup + CTRL_CAN echo). UAT-12-01..03 carry `result: TBD (pending Z80 PR ...)`.
result: pass

### 12. Force-start chip lifecycle transition (Plan 12-07)
expected: Set Compatibility mode to "Wake-up required" in Settings. Drag a file onto the canvas (or click ↑ Send file) so the wakeup chip surfaces. Wait for the 3-second WAKEUP_TIMEOUT to elapse — the chip shows `[Retry] [Cancel] [Force start]`. Click `[Force start]`. The chip TRANSITIONS to the active sending state (lifecycle changes from `awaiting-timeout` to `active` — visible UI feedback, no longer pinned on the timeout prompt).
result: issue
reported: "I changed the auto-start setting to \"B:OLDSLIDE r\" - previously it was \"A:SLIDE r\". I dragged the file, it prompted me to confirm the command, then the 3 second timeout happened. CP/M reported \"A:SLIDE?\" and returned to the cli - so beastty has used a stale version of the auot-start command. Then I clicked \"Force Start\" which obviously cannot succeed as the target is not running SLIDE. The file transfer chip appears, but the \"Cancel\" button does not work and I can't get rid of it."
severity: major
notes: |
  Mixed report — Plan 12-07 chip-lifecycle transition (awaiting-timeout → active) DID fire (user observed "The file transfer chip appears"). Two NEW bugs surfaced under the same flow:
  (a) Stale auto-send command: Settings value `B:OLDSLIDE r` did not reach the wire on the next send; CP/M echoed `A:SLIDE?` (the previous value). Suggests prefs read is not live at the use-time call site (despite Plan 12-08's getPrefs() pattern landing in serial.js, this one is in slide.js readAutoSendCommandBytes).
  (b) Active-chip Cancel broken: after force-start transitions chip to active, [Cancel] click does not dismiss the chip / abort the (stalled) transfer. User has no recovery short of page reload.

### 13. RTS-on-connect Settings checkbox (Plan 12-08)
expected: Open Settings → Connection sub-block. Immediately after the existing "Show all serial devices" row, a new checkbox `Assert RTS on connect` appears, default CHECKED, with an explanatory hint paragraph below. Toggling it OFF and reloading: on next connect, RTS is not asserted (Z80 won't transmit on auto-flow-control hardware). Toggling it back ON and reloading: connect asserts RTS again. The pref persists across page reloads.
result: pass

### 14. Debug instrumentation absent from console (Plan 12-09)
expected: Open the browser DevTools console. Connect to MicroBeast, drop a file, send it (or attempt to), then disconnect. Throughout the flow, the console shows ZERO log lines tagged `[slide-debug]`, `[serial-debug]`, or `[tx-debug]`. Only normal user-visible warnings/errors (if any) appear. (This confirms Plan 12-09's instrumentation strip — the diagnostic helpers used to find the 12-07/12-08 root causes have been cleanly removed.)
result: blocked
blocked_by: other
reason: "Cannot test. Every time I drop a file it says \"Confirm auto-send: B:OLDSLIDE r\\r\" when I click on \"confirm\" it says \"Waiting for z80...\" and nothing further happens, even after waiting for 60 seconds. I click \"cancel\". If I repeat the process, exactly the same result. So confirming the autocommand isn't working, for starters."
notes: |
  Console-output observation requires a complete connect→send→disconnect flow, which the user cannot drive due to the auto-send-command wire-path defect already captured in test 12 Gap A (stale prefs read in slide.js readAutoSendCommandBytes). The "Waiting for z80..." pin and 60s no-op are consistent with the OLDSLIDE program not being on the Z80 — but the larger story (auto-send not reflecting Settings) IS the test 12 Gap A. No NEW gap added here; resolving Gap A unblocks this test. Side-note: user reports the first-use-confirm chip DOES appear here ("Confirm auto-send: B:OLDSLIDE r\\r") — contradicts test 8's "does not appear" report. Likely the test 8 setup hit a different path (e.g. the value being set was identical to a prior confirmed value, or slideAutoSendCommandConfirmed was already set to the new value when the test 8 reload happened). Diagnosis of test 8's gap should reconcile both data points.

## Summary

total: 14
passed: 10
issues: 3
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "Settings auto-send command field surfaces the .validation-hint sub-row reading 'Auto-send command unsafe — using disabled.' when the typed value fails SAFE_AUTO_SEND_RE on blur"
  status: failed
  reason: "User reported: the sub row hint \"Auto-send command unsafe - using disabled\" does not appear"
  severity: major
  test: 7
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis

- truth: "After changing the SLIDE auto-send command to a non-default SAFE value and reloading, the next ↑ Send file click surfaces the first-use-confirm chip with [Confirm] / [Reset to default] inline buttons before any bytes go to the wire"
  status: failed
  reason: "User reported: first use chip does not appear. goes immediately to send \"sending 1 file\" dialog."
  severity: major
  test: 8
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis

- truth: "When the user changes the SLIDE auto-send command in Settings, the new value is read at use-time on the next send (not a stale snapshot from boot or prior load)"
  status: failed
  reason: "User reported (test 12 mixed report): changed setting to 'B:OLDSLIDE r' from 'A:SLIDE r', dragged file, but CP/M echoed 'A:SLIDE?' — wire received the OLD value. Suggests slide.js readAutoSendCommandBytes does not getPrefs() live (cf. Plan 12-08's serial.js pattern)."
  severity: major
  test: 12
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis

- truth: "The [Cancel] button on the active-state SLIDE chip dismisses the chip and aborts the in-flight transfer when clicked"
  status: failed
  reason: "User reported (test 12 mixed report): after Force-start transitioned chip to active over a stalled transfer, [Cancel] click did nothing — 'I can't get rid of it'. No recovery short of page reload. Possibly Plan 12-07's enterActive() call leaves the chip in a state where the cancel inline-action handler is unwired or the dispatcher Promise is stuck."
  severity: major
  test: 12
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
