---
phase: 4
slug: keyboard-input
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.51 (Chromium-only per CLAUDE.md) |
| **Config file** | `www/playwright.config.js` — extend testMatch or add `tests/input/` directory |
| **Quick run command** | `cd www && npm run test:fast` — runs `@fast`-tagged specs |
| **Full suite command** | `cd www && npm test` — all specs (render/ + input/) |
| **Estimated runtime** | ~15 s fast; ~90 s full |

---

## Sampling Rate

- **After every task commit:** Run `cd www && npm run test:fast`
- **After every plan wave:** Run `cd www && npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds (fast suite)

---

## Per-Task Verification Map

Task IDs are tentative and will be finalized by the planner. Every `INPUT-*`
requirement maps to at least one automated Playwright spec in `www/tests/input/`.

| Task ID (tentative) | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | infra | — | N/A | scaffold | `ls www/tests/input/` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | INPUT-01 | — | N/A | integration | `cd www && npx playwright test tests/input/keydown-printable.spec.js --project=chromium` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | INPUT-02 | — | N/A | integration | `cd www && npx playwright test tests/input/keydown-arrows.spec.js --project=chromium` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | INPUT-03 | — | N/A | integration | `cd www && npx playwright test tests/input/keydown-ctrl-letters.spec.js --project=chromium` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | INPUT-04 | — | N/A | integration | `cd www && npx playwright test tests/input/local-echo.spec.js --project=chromium` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | INPUT-05 | — | N/A | integration | `cd www && npx playwright test tests/input/crlf-override.spec.js --project=chromium` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 2 | SC-1 | — | N/A | integration | `cd www && npx playwright test tests/input/tx-debug-strip.spec.js --project=chromium` | ❌ W0 | ⬜ pending |
| 04-04-02 | 04 | 2 | SC-5 (focus) | — | N/A | integration | `cd www && npx playwright test tests/input/focus-retention.spec.js --project=chromium` | ❌ W0 | ⬜ pending |
| 04-04-03 | 04 | 2 | SC-5 (IME) | — | N/A | integration | `cd www && npx playwright test tests/input/ime-composition.spec.js --project=chromium` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `www/tests/input/` directory — does not exist; create in Wave 0
- [ ] Extend `www/playwright.config.js` testMatch to include `tests/input/*.spec.js` (or add a second `testDir` entry)
- [ ] `www/tests/input/keydown-arrows.spec.js` — stub for INPUT-02 + SC-1
- [ ] `www/tests/input/keydown-ctrl-letters.spec.js` — stub for INPUT-03 + SC-2
- [ ] `www/tests/input/keydown-printable.spec.js` — stub for INPUT-01
- [ ] `www/tests/input/local-echo.spec.js` — stub for INPUT-04 + SC-3
- [ ] `www/tests/input/crlf-override.spec.js` — stub for INPUT-05 + SC-4
- [ ] `www/tests/input/ime-composition.spec.js` — stub for SC-5 IME half
- [ ] `www/tests/input/focus-retention.spec.js` — stub for SC-5 focus half
- [ ] `www/tests/input/tx-debug-strip.spec.js` — stub for SC-1 hex-strip format + Reset TX
- [ ] Test-harness helper for grid readback: `window.__testGridView` gated behind a URL param (e.g. `?test=1`) OR exposed unconditionally in main.js — planner decides

*No framework install needed — Phase 3 already installed Playwright 1.51 + @playwright/test in www/package.json.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real IME composition (Japanese/Chinese/Korean) with hardware IME keyboard | SC-5 (IME) | Playwright cannot drive a real system IME. Synthetic `CompositionEvent` dispatch covers the listener logic but not OS-level IME integration. | Enable a Japanese IME (e.g. macOS Kotoeri or Linux fcitx5), focus the terminal, type "こんにちは", commit with space/Enter. Verify: zero double-emit (one TX-sequence per committed character set), no stray bytes from the intermediate composition state, TX hex strip shows the UTF-8 bytes of the composed string. |
| AltGraph key behavior on non-US keyboard layouts | INPUT-01 edge | Playwright test runs on en-US layout by default; AltGraph (e.g. Euro €, German umlauts via Alt+letter) requires a real locale switch. | On a physical non-US keyboard (author's preference: whatever layout they daily-drive), type a few AltGraph-accessible characters. Verify TX strip shows the correct code-point bytes and no spurious Ctrl-/Alt- sequences. |
| Daily-driver sanity: 5-minute typing session with local-echo both on and off | Cross-SC | Ergonomic feel (key repeat latency, focus stickiness, toggle discoverability) is not automatable. | Open the app, type freely for 5 min with echo off, toggle echo on via Settings, type another 5 min, toggle Settings closed, verify Ctrl+Alt+T still flips theme and the typing feel did not degrade. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15 s for fast suite
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills Wave 0 tasks and checker approves)

**Approval:** pending
