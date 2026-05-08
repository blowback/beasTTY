---
phase: 11
slug: slide-js-bridge-v1-0-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (browser, www/tests/) + Vitest/Jest (none — Phase 11 makes zero Rust changes) |
| **Config file** | `www/playwright.config.js` (existing) |
| **Quick run command** | `cd www && npm run test:fast` |
| **Full suite command** | `cd www && npm test` |
| **Estimated runtime** | ~30 s (fast subset) / ~90 s (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `cd www && npm run test:fast`
- **After every plan wave:** Run `cd www && npm test` (full Playwright suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 s (fast) / ~90 s (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 0 | (Wave 0 scaffolding) | — | Stub specs scaffold green | scaffolding | `cd www && npx playwright test transport/slide-chip.spec.js transport/slide-bridge.spec.js transport/slide-compatibility.spec.js transport/slide-prefs.spec.js --list` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | SLIDE-25, SLIDE-26 | — | chip renders single-line dense layout with throughput sliding window | unit + Playwright | `cd www && npx playwright test transport/slide-chip.spec.js -g "active layout"` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | SLIDE-26 | — | throughput shows '—' for first 2 s; auto-scaled units after | Playwright | `cd www && npx playwright test transport/slide-chip.spec.js -g "throughput"` | ❌ W0 | ⬜ pending |
| 11-02-03 | 02 | 1 | SLIDE-28 | — | post-cancel summary chip shows "Cancelled — N of M files transferred" 5 s | Playwright | `cd www && npx playwright test transport/slide-chip.spec.js -g "cancelled summary"` | ❌ W0 | ⬜ pending |
| 11-03-01 | 03 | 2 | SLIDE-37 | — | prefs.slideAutoSendCommand persists default 'B:SLIDE R\\r' | Playwright | `cd www && npx playwright test transport/slide-prefs.spec.js -g "auto-send command"` | ❌ W0 | ⬜ pending |
| 11-03-02 | 03 | 2 | SLIDE-39 | — | Settings SLIDE block: nested details + 4 rows + Compatibility 3-way select | Playwright | `cd www && npx playwright test transport/slide-prefs.spec.js -g "Settings layout"` | ❌ W0 | ⬜ pending |
| 11-03-03 | 03 | 2 | SLIDE-39 | — | slideShowSummary checkbox default ON; toggling persists | Playwright | `cd www && npx playwright test transport/slide-prefs.spec.js -g "show summary"` | ❌ W0 | ⬜ pending |
| 11-03-04 | 03 | 2 | SLIDE-39 | — | slideCompatibilityMode default 'auto'; 3-way persists | Playwright | `cd www && npx playwright test transport/slide-prefs.spec.js -g "Compatibility mode"` | ❌ W0 | ⬜ pending |
| 11-04-01 | 04 | 3 | SLIDE-14 | T-11-echo | swallow-echo filter consumes auto-typed bytes within 500 ms; mismatch flushes | Playwright | `cd www && npx playwright test transport/slide-bridge.spec.js -g "swallow-echo"` | ❌ W0 | ⬜ pending |
| 11-04-02 | 04 | 3 | SLIDE-31 | T-11-vis | visibilitychange + pagehide emit single-byte CTRL_CAN when active | Playwright | `cd www && npx playwright test transport/slide-bridge.spec.js -g "visibilitychange"` | ❌ W0 | ⬜ pending |
| 11-04-03 | 04 | 3 | SLIDE-32 | T-11-port-lost | slidePumpOnPortLost called from serial.js teardown / handleReadError / onNavSerialDisconnect | Playwright | `cd www && npx playwright test transport/slide-bridge.spec.js -g "port lost"` | ❌ W0 | ⬜ pending |
| 11-04-04 | 04 | 3 | SLIDE-33 | T-11-log-leak | session-log gated during active session; resumes after | Playwright | `cd www && npx playwright test transport/slide-bridge.spec.js -g "session-log pause"` | ❌ W0 | ⬜ pending |
| 11-04-05 | 04 | 3 | SLIDE-33 | — | paste-pump cancelled on session start; enqueuePaste no-ops while active | Playwright | `cd www && npx playwright test transport/slide-bridge.spec.js -g "paste-pump gate"` | ❌ W0 | ⬜ pending |
| 11-04-06 | 04 | 3 | SLIDE-11 | — | drag-drop during active session emits chip flash "Transfer in progress — cancel first" | Playwright | `cd www && npx playwright test transport/slide-bridge.spec.js -g "drop rejected"` | ❌ W0 | ⬜ pending |
| 11-05-01 | 05 | 4 | SLIDE-35 | T-11-no-resp | Auto mode: 3-second timer + chip with [Retry][Cancel][Force start] | Playwright | `cd www && npx playwright test transport/slide-compatibility.spec.js -g "Auto timeout"` | ❌ W0 | ⬜ pending |
| 11-05-02 | 05 | 4 | SLIDE-39 | — | Wakeup-required: no timer; indefinite wait | Playwright | `cd www && npx playwright test transport/slide-compatibility.spec.js -g "Wakeup-required"` | ❌ W0 | ⬜ pending |
| 11-05-03 | 05 | 4 | SLIDE-39 | — | Force-start: skip wakeup matcher; jump to send-mode | Playwright | `cd www && npx playwright test transport/slide-compatibility.spec.js -g "Force-start"` | ❌ W0 | ⬜ pending |
| 11-05-04 | 05 | 4 | SLIDE-35 | — | [Retry] re-emits auto-type + restarts 3-second timer | Playwright | `cd www && npx playwright test transport/slide-compatibility.spec.js -g "Retry"` | ❌ W0 | ⬜ pending |
| 11-05-05 | 05 | 4 | SLIDE-35 | — | [Cancel] clears pendingSendSession; chip hides | Playwright | `cd www && npx playwright test transport/slide-compatibility.spec.js -g "Cancel"` | ❌ W0 | ⬜ pending |
| 11-05-06 | 05 | 4 | SLIDE-35 | — | [Force start] enters send mode immediately; legacy slide.com flow | Playwright | `cd www && npx playwright test transport/slide-compatibility.spec.js -g "Force start button"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `www/tests/transport/slide-chip.spec.js` — stub specs for SLIDE-25, SLIDE-26, SLIDE-28 (chip lifecycle states)
- [ ] `www/tests/transport/slide-bridge.spec.js` — stub specs for SLIDE-11, SLIDE-14, SLIDE-31, SLIDE-32, SLIDE-33
- [ ] `www/tests/transport/slide-compatibility.spec.js` — stub specs for SLIDE-35, SLIDE-39 Compatibility-mode behavior
- [ ] `www/tests/transport/slide-prefs.spec.js` — stub specs for SLIDE-37, SLIDE-39 prefs persistence
- [ ] `www/tests/mock-serial-slide-bot.js` — extend existing mock with `setWakeupDelay(ms)` for timeout-chip tests
- [ ] `www/tests/playwright.config.js` — testMatch already covers `transport/*.spec.js` from Phase 8/9/10; no config change needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-hardware UAT against patched slide.asm | SLIDE-35 (Force start with legacy slide.com) | Requires actual MicroBeast Z80 with pre-v0.2.1 slide.com | Defer to Phase 12 SLIDE-42 (`docs/SLIDE-UAT.md`) |
| Tab-close behavior on real browser | SLIDE-31 | Chrome DevTools cannot reliably mock `pagehide` during bfcache; test in real Chromium tab | Open BestialiTTY, start a SLIDE recv, close tab; check Z80-side log for CTRL_CAN receipt |
| Throughput chip visual feel under fast send | SLIDE-26 | Subjective UX — does the 2-second sliding window feel responsive at 19200 baud? | Send a 100 KB file; visually confirm throughput updates without jitter or stale numbers |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 new spec files + mock-bot extension)
- [ ] No watch-mode flags
- [ ] Feedback latency < 90 s (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
