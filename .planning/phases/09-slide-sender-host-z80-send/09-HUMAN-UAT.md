---
status: partial
phase: 09-slide-sender-host-z80-send
source: [09-VERIFICATION.md]
started: 2026-05-08T03:00:00Z
updated: 2026-05-08T03:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Multi-file picker → modal → send flow
expected: Picker opens, modal shows `original.txt → ORIGINAL.TXT` rewrite row, clicking `[Send 1 file(s)]` auto-types `B:SLIDE R\r` in the terminal, button transitions to `[↑ Send file (sending…)]` (disabled), session begins.
result: [pending]

### 2. Drag-drop overlay appearance
expected: Dragging a file onto `#terminal-wrapper` shows the dashed-border overlay with ~10% chrome-accent tint and verbatim text "Drop file(s) to send via SLIDE". Dragging text/URL onto the same area shows nothing (silent rejection).
result: [pending]

### 3. All-rejected modal disabled state
expected: Triggering with all-invalid filenames (e.g. `my*file.txt`) shows the modal with rejection rows ("invalid CP/M character '*'"), the Send button label reads `Send 0 files` and is disabled, hint text "All files rejected — see details below." is visible.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
