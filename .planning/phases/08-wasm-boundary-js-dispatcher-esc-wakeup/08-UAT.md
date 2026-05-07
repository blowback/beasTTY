---
status: complete
phase: 08-wasm-boundary-js-dispatcher-esc-wakeup
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md]
started: 2026-05-07T21:10:00Z
updated: 2026-05-07T21:25:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: |
  Kill any running dev server. Load www/index.html fresh in Chromium (e.g., `python3 -m http.server -d www 8000` then visit http://localhost:8000). The page loads without errors. The terminal canvas renders with the v1.0 chrome (top bar, theme button, Settings/Connection panes). Open DevTools → Console: no errors related to Slide, wireSlideDispatcher, dispatchInbound, or wasm imports. The Connect button is present and clickable.
result: pass

### 2. Terminal Mode Regression
expected: |
  Connect to your MicroBeast (or any serial device) via the Connect button. The v1.0 terminal experience is unchanged: typed keystrokes transmit to the wire (visible in the TX debug strip if Settings → Show TX hex is on), bytes received from the device render on the canvas, ESC sequences (cursor moves, ESC J erase, BEL flash) all work, scrollback/copy/paste behave as before. Disconnect cleanly. No SLIDE chip or unexpected UI elements appear. Console stays clean during connect/disconnect/typing.
result: pass
note: |
  First load showed missing character grid + non-functional Connect button. Hard reload (Ctrl+Shift+R) cleared the issue — stale wasm bundle / module cache from before Plan 08-02 regenerated `pkg/bestialitty_core.{js,wasm}`. Worth flagging in dev workflow: after `bash scripts/build.sh` regenerates the wasm bundle, a hard reload is required. Cache-busting could be added later (out of Phase 8 scope).

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
