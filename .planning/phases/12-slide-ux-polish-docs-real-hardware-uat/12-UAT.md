---
status: complete
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-01-SUMMARY.md, 12-02-SUMMARY.md, 12-03-SUMMARY.md, 12-04-SUMMARY.md, 12-05-SUMMARY.md]
started: 2026-05-09T00:00:00Z
updated: 2026-05-09T00:11:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev server. Run `bash scripts/build.sh`, serve `www/` over HTTP, open in Chromium with a HARD RELOAD. Page boots without console errors, terminal canvas + top bar render, ▼ Connect opens the Web Serial picker.
result: pass

### 2. Drop overlay isolation (SLIDE-12)
expected: Connect the MicroBeast (or use a saved-session). Drag a file from the OS file manager over the terminal canvas — the drop overlay highlights `#terminal-wrapper`. While the overlay is showing, press-and-drag the mouse over the canvas. NO text selection appears (no inverse-text rectangle, no "Copy" availability).
result: skipped
reason: "Not user-reachable — OS-level mouse button is exclusive (can't drag a file AND press-and-drag for selection simultaneously). Contract is exercised by the synthetic regression spec www/tests/render/selection-drop.spec.js (3 Playwright tests) which sets [data-drop-target] programmatically."

### 3. Post-drop ghost-clear (SLIDE-12)
expected: Make a normal text selection on the canvas (mouse-drag over fed glyphs — inverse text appears). Now drag a file from the OS over the canvas and drop it. After the drop completes (modal opens or closes), the previous inverse-text selection is gone — no leftover "ghost selection" lingers under the modal or after Cancel.
result: pass

### 4. Collision detection + auto-rename (SLIDE-36)
expected: Drop two files into the terminal whose names collide under CP/M 8.3 rules (e.g. `report.txt` and `REPORT.TXT`, or `longname1.txt` and `longname2.txt` which both truncate to `LONGNAME.TXT`). The send modal opens and shows a collision-row UI with the proposed renames (e.g. `REPORT.TXT` kept, `REPORT~1.TXT` for the second). The original list is visible alongside the rewritten names.
result: pass

### 5. Three-button modal default focus (SLIDE-36)
expected: With collisions present in the modal (from test 4), the footer shows three buttons: `[Send N renamed]` / `[Send only first]` / `[Refuse batch]`. The `[Send N renamed]` button has the default keyboard focus (visible focus ring). Pressing Enter triggers `[Send N renamed]`.
result: issue
reported: "the three buttons are there but \"Send N renamed\" does NOT have a visible focus ring. It is the default action tho when i hit enter."
severity: cosmetic

### 6. Refuse-batch cancellation (SLIDE-36)
expected: With the collision modal open from test 4-5, click `[Refuse batch]`. The modal closes, no transfer starts, and the chip area does not transition into a sending state. Nothing is sent over the wire (Z80 prompt unchanged).
result: pass

### 7. Auto-send safety regex (SLIDE-38)
expected: Open Settings → SLIDE sub-block. In the Auto-send command field, type something unsafe like `B:RM *.* ; SLIDE R` and blur the field. The input gets a red/muted invalid border, and a sub-row hint appears reading "Auto-send command unsafe — using disabled." (or similar). The unsafe value is still SAVED — the gate is at use-time, not save-time.
result: issue
reported: "nope, no red border"
severity: major

### 8. First-use confirmation chip (SLIDE-38)
expected: In Settings, change the SLIDE auto-send command from the default `B:SLIDE R` to a different SAFE value (e.g. `A:SLIDE R`). Reload the page (new session). Click `↑ Send file` and pick a file → the chip surfaces a "first-use confirm" state with `[Confirm]` and `[Reset to default]` inline buttons, and the file is NOT yet sent. Click `[Confirm]` → the auto-send command goes to the wire and the transfer proceeds.
result: pass

### 9. README File-transfer section (SLIDE-41)
expected: Open `README.md` at the repo root. It contains a new top-level section `## File transfer (SLIDE)` with three sub-sections (`### Sending files (PC → Z80)`, `### Receiving files (Z80 → PC)`, `### Cancelling`). The Keyboard-shortcuts table at the top of the file has three new rows: drag-files-onto-canvas, ↑ Send file button, Esc-during-SLIDE-transfer.
result: pass

### 10. Z80 firmware requirement doc (SLIDE-40)
expected: Open `docs/SLIDE_Z80_REQUIREMENT.md`. Five locked sections present: §1 Wakeup signature `ESC ^ S L I D E`, §2 v0.2.1 amendment (CTRL_CAN echo + ADR-003 cite), §3 Send command convention `B:SLIDE R`, §4 Upstream patch with "Status: pending upstream merge" banner and a repo-root link to `https://github.com/blowback/slide` (no hardcoded PR number), §5 Cross-link to ADR-003 / SPEC-v0.2.md / PROJECT.md.
result: pass

### 11. Real-hardware UAT scaffold (SLIDE-42)
expected: Open `docs/SLIDE-UAT.md`. Exactly four tests present (`### UAT-12-01` through `### UAT-12-04`), preceded by a Setup section identifying the patched-slide.com requirement, and followed by a Sign-off block. UAT-12-04 carries `result: blocked` (waiting on upstream Z80 PR for ESC^SLIDE wakeup + CTRL_CAN echo). UAT-12-01..03 carry `result: TBD (pending Z80 PR ...)`.
result: pass

## Summary

total: 11
passed: 8
issues: 2
pending: 0
skipped: 1
blocked: 0

## Gaps

- truth: "[Send N renamed] button shows a visible focus ring as the modal's default-focused element when collisions are present"
  status: failed
  reason: "User reported: the three buttons are there but \"Send N renamed\" does NOT have a visible focus ring. It is the default action tho when i hit enter."
  severity: cosmetic
  test: 5
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis

- truth: "Settings auto-send command field shows a red/muted invalid border + 'Auto-send command unsafe — using disabled.' hint when the typed value fails SAFE_AUTO_SEND_RE"
  status: failed
  reason: "User reported: nope, no red border"
  severity: major
  test: 7
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
  notes: "Threat T-12-03 (auto-send command injection) is still mitigated by the use-time gate in slide.js readAutoSendCommandBytes — the missing visual cue is defense-in-depth UX, not the safety control itself. User did not confirm whether the validation-hint TEXT appeared, only that the red border is absent. Diagnosis should check both the [data-invalid] attribute path and the .validation-hint visibility path."
