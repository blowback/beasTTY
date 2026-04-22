---
status: complete
phase: 04-keyboard-input
source: [04-VERIFICATION.md, 04-VALIDATION.md]
started: 2026-04-22
updated: 2026-04-22
---

## Current Test

[testing complete]

## Tests

### 1. Real IME composition (Japanese/Chinese/Korean)
expected: Enable a system IME (e.g. macOS Kotoeri, Linux fcitx5), focus #terminal-wrapper, type "こんにちは" and commit with space/Enter. TX hex strip shows the UTF-8 bytes of the committed string; zero stray bytes from intermediate composition state; no double-emit between keydown and compositionend.
result: skipped
reason: user declined — no IME available to test right now

### 2. AltGraph on non-US keyboard layout
expected: On a physical non-US keyboard (DE / FR / Compose-key layout, etc.), type AltGraph-accessible characters (€ on DE, æ on Compose, umlauts). TX hex strip shows the correct code-point bytes. No spurious Ctrl- or Alt- sequences.
result: pass

### 3. Daily-driver ergonomic feel (5-minute session)
expected: Type freely for 5 minutes with local-echo OFF, toggle echo ON via Settings, type another 5 minutes, toggle Settings closed. Ctrl+Alt+T still flips theme. No key-repeat latency issues, no focus-stickiness issues, no toggle-discoverability confusion. Settings pane close/open toggle does not blur the canvas.
result: pass

## Summary

total: 3
passed: 2
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none — 2/3 passed, 1 skipped (IME not available); zero implementation issues found]
