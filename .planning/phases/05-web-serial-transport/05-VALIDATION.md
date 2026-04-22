---
phase: 5
slug: web-serial-transport
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated from 05-RESEARCH.md `## Validation Architecture` section by the planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.x (existing from Phase 3/4) + `cargo test` (native Rust, existing) |
| **Config file** | `www/playwright.config.js` (existing — testMatch to be extended) |
| **Quick run command** | `cd www && npx playwright test tests/transport --grep @fast` |
| **Full suite command** | `cd www && npx playwright test && cargo test --workspace` |
| **Estimated runtime** | ~30 seconds (transport suite); ~60 seconds (full project suite) |

---

## Sampling Rate

- **After every task commit:** Run quick transport subset
- **After every plan wave:** Run full transport suite
- **Before `/gsd-verify-work`:** Full suite must be green; human UAT checkpoint recorded
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

*Populated by the planner once plan structure is determined. Each task gets a row
mapping to its verification mechanism. Rows filled in as plans are written.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| _TBD_   | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `www/tests/transport/mock-serial.js` — `navigator.serial` mock harness (Serial, SerialPort, ReadableStream, WritableStream stubs + `window.__simulateUnplug` / `__simulateReplug` / `__mockReaderPush` / `__mockWriterLog`)
- [ ] `www/tests/transport/*.spec.js` — Playwright spec stubs covering XPORT-01..11, PLAT-01..02, SC-1..SC-5 (stubs `.fixme`d until real assertions land in later waves)
- [ ] `www/playwright.config.js` — testMatch glob extended to include `tests/transport/*.spec.js`
- [ ] `05-HUMAN-UAT.md` — real-hardware checklist (MicroBeast-at-desk items: connect, type, unplug USB, replug, reload, paste at 19200, polite fail in Firefox/Safari)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DTR/RTS on real CP2102N does not reset MicroBeast on connect | XPORT-06 / Pitfall #12 / D-09 / D-11 | Real USB-UART bridge + real Z80 board — no automated simulation of the CP2102N's post-open signal behavior | See `05-HUMAN-UAT.md §"Connect does not reset MicroBeast"` |
| Real MicroBeast output at 19200 8N1 renders on canvas (SC-1 end-to-end) | XPORT-04 + SC-1 | Requires a powered MicroBeast + USB cable | See `05-HUMAN-UAT.md §"SC-1 end-to-end with real hardware"` |
| Unplug/replug at the USB cable level | XPORT-06 / XPORT-08 / SC-3 | Playwright mock covers event plumbing, but real cable pull tests Chromium's actual `connect`/`disconnect` firing | See `05-HUMAN-UAT.md §"Physical unplug/replug"` |
| Paste throttling against real MicroBeast UART RX at 19200 (no overrun) | XPORT-09 / SC-4 | Timing assertions in mock validate pacer logic, but real UART buffer fill depends on MicroBeast firmware | See `05-HUMAN-UAT.md §"Paste at 19200 without MicroBeast input-buffer overrun"` |
| Polite-fail rendering in Firefox AND Safari (SC-5) | PLAT-01 / PLAT-02 / SC-5 | Playwright is Chromium-only for this project; non-Chromium rendering verified by human | See `05-HUMAN-UAT.md §"Polite fail in non-Chromium"` |
| 5-minute daily-driver feel test | Daily-driver goal (PROJECT.md Core Value) | Subjective; tests user experience of focus retention, connect-click, paste, reconnect under real use | See `05-HUMAN-UAT.md §"5-minute daily-driver feel"` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
