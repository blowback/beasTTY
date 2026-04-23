---
status: draft
phase: 05-web-serial-transport
source: [05-VERIFICATION.md, 05-VALIDATION.md]
started: 2026-04-23
updated: 2026-04-23
---

# Phase 5 — Human UAT (real hardware)

## Current Test

[testing not yet started]

## Tests

### 1. Real MicroBeast connect + type commands (SC-1 / XPORT-04)

**expected:** Power the MicroBeast, plug USB-C, click Connect, pick CP2102N 10c4:ea60 in native picker. Connection pane shows `MicroBeast (CP2102N 10c4:ea60) — 19200 8N1`, Connect button border turns green, button label reads `Disconnect`. Type `HELP` + Enter — MicroBeast responds on canvas. No boot banner appears on Connect (DTR/RTS stayed low).

**steps:**
1. (placeholder — Wave 6 fills)

result: pending

reason: (fill after test)

### 2. Physical unplug / replug (XPORT-06 / XPORT-08 / SC-3)

**expected:** With connection live, yank USB cable — within ~1 s button border turns red, label reads `Reconnect`. Error log shows `read-error` or similar. Reinsert USB — border cycles red → amber → green silently; typing resumes without permission prompt.

**steps:**
1. (placeholder — Wave 6 fills)

result: pending

reason: (fill after test)

### 3. Reload with granted port (XPORT-07 / SC-3c)

**expected:** With connection live, hit reload. App loads; Connect button reads `Connect`, border gray. Connection pane shows `MicroBeast (CP2102N 10c4:ea60) — click Connect`. Click Connect — no permission prompt (port already granted), connects in < 1 s.

**steps:**
1. (placeholder — Wave 6 fills)

result: pending

reason: (fill after test)

### 4. Paste at 19200 baud no-overrun (XPORT-09 / SC-4b)

**expected:** Connect, type `copy con dummy.txt` on MicroBeast CP/M, paste ~2 KB of text via Debug pane Paste test button. Progress line ticks 0% → 100% over ~1.2 s. No dropped bytes in MicroBeast file (compare SHA256 before/after).

**steps:**
1. (placeholder — Wave 6 fills)

result: pending

reason: (fill after test)

### 5. Polite fail in Firefox AND Safari (PLAT-01 / PLAT-02 / SC-5a)

**expected:** Open BestialiTTY URL in Firefox stable AND Safari (macOS). Each shows polite-fail page with heading `BestialiTTY requires a Chromium-based browser`, bulleted browser list, Download Chromium link. Zero console errors. Title reads `BestialiTTY — Chromium required`. No canvas flash before takeover.

**steps:**
1. (placeholder — Wave 6 fills)

result: pending

reason: (fill after test)

### 6. 5-minute daily-driver feel (PROJECT.md Core Value)

**expected:** Drive a real work session — CP/M shell, BASIC program, intentional paste, intentional Ctrl+C, intentional Disconnect + Connect. Focus retention on every chrome click (terminal stays focused; typing never misses). No jarring pane pops during paste. Reconnect after accidental unplug is seamless.

**steps:**
1. (placeholder — Wave 6 fills)

result: pending

reason: (fill after test)

## Summary

| metric | value |
|--------|-------|
| passed | - |
| issues | - |

## Gaps

(to be filled as tests run)

## Sign-Off

**Approval:** pending
