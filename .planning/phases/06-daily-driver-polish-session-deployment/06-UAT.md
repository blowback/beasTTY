---
status: testing
phase: 06-daily-driver-polish-session-deployment
source: [06-HUMAN-UAT.md, 06-VERIFICATION.md, 06-SOAK.md]
started: 2026-04-25
updated: 2026-04-25
---

## Current Test

[testing paused — Test 1 reported a chrome-wiring blocker that prevents Tests 2–7 from running until fixed]

## Tests

### 1. Paste 100 KB during a real CP/M session
expected: 100 KB pastes at ~19200 baud (~52s); confirm chip appears at ≥4096-byte threshold; no garbled chars or dropped bytes after completion.
result: issue
reported: "FAIL: connect button doesn't work, Clear, Clean, Green, Amber, White buttons do not work"
severity: blocker

### 2. Scroll back through 8K lines of BASIC output
expected: Wheel + Shift+PgUp navigate smoothly; Shift+Home jumps to top; theme toggle while scrolled keeps row offset; cursor hidden while scrolled; chip count accurate; Shift+End snaps to live tail.
result: blocked
blocked_by: prior-phase
reason: "Cannot drive scrollback test without Connect button; depends on Test 1's chrome-wiring fix"

### 3. Copy a command from history and paste it back
expected: Drag-select paints inverted glyphs; Ctrl+Shift+C copies plain text; selection clears; pastes correctly into another app; Ctrl+Shift+V sends to MicroBeast and echoes at prompt.
result: blocked
blocked_by: prior-phase
reason: "Cannot drive copy/paste test without Connect button"

### 4. Theme toggle while scrolled up
expected: Ctrl+Alt+T while scrolled at offset 50 keeps the row offset; cells repaint with new theme colors; toggling back preserves offset again.
result: blocked
blocked_by: prior-phase
reason: "Theme button (Clean/CRT) reported broken in Test 1; same chrome-wiring blocker"

### 5. Clear-screen before / during long output
expected: Plain Clear wipes visible 80×24 only; output continues correctly mid-stream; scrollback intact. Shift+Clear also wipes scrollback.
result: blocked
blocked_by: prior-phase
reason: "Clear button reported broken in Test 1; same chrome-wiring blocker"

### 6. Full reload restores prefs + port preset
expected: Theme + phosphor + zoom + serial config + localEcho + crlfMode all persist via bestialitty.prefs; port preset persists via bestialitty.port.preset; defaults match D-36 on fresh start.
result: blocked
blocked_by: prior-phase
reason: "Phosphor radio buttons (Green/Amber/White) reported broken in Test 1; cannot persist what cannot be set"

### 7. Auto-connect on second visit
expected: With prefs.autoConnect=true and previously-granted port, page silently calls connectMicroBeast() after boot; no port picker; live MicroBeast output streams in. Disabling auto-connect → reload → Connect stays gray until clicked.
result: blocked
blocked_by: prior-phase
reason: "Cannot establish initial connection if Connect button is broken"

### 8. 24-hour memory-flat soak (06-SOAK.md)
expected: wasm.memory.buffer.byteLength stable within ±10% of t=10-minute baseline for 24 hours; no memory cliff.
result: blocked
blocked_by: prior-phase
reason: "Soak requires a live connection; Connect button blocker prevents the run"

## Summary

total: 8
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 7

## Gaps

- truth: "Top-bar Connect, Clear, theme-toggle (Clean/CRT), and phosphor radio (Green/Amber/White) buttons fire their handlers when clicked"
  status: failed
  reason: "User reported: FAIL: connect button doesn't work, Clear, Clean, Green, Amber, White buttons do not work"
  severity: blocker
  test: 1
  scope: "Affects Tests 1–7 (every daily-driver flow that starts with the top-bar chrome). Tests 2–7 marked blocked on this fix."
  artifacts: []
  missing: []
  debug_session: ""
