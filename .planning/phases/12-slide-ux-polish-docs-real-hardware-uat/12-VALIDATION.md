---
phase: 12
slug: slide-ux-polish-docs-real-hardware-uat
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Sourced
> from `12-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (existing — `@playwright/test`). Phase 12 makes ZERO Rust changes; cargo invocation is no-op. |
| **Config file** | `www/playwright.config.js` (testMatch covers render/input/transport/session). |
| **Quick run command** | `cd www && npm run test:fast -g "SLIDE-12\|SLIDE-36\|SLIDE-38"` |
| **Full suite command** | `cd www && npx playwright test` |
| **Estimated runtime** | ~10–30 s quick / 2–4 min full |

---

## Sampling Rate

- **After every task commit:** `cd www && npm run test:fast` (≤ 30 s feedback)
- **After every plan wave:** `cd www && npx playwright test --workers=4` (full)
- **Before `/gsd-verify-work`:** Full suite green + manual smoke greps for the 3 doc files (SLIDE-40/41/42)
- **Max feedback latency:** 30 seconds (per-task commit signal)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-XX-01 | SLIDE-12 | 0 | SLIDE-12 | T-12-01 | Pointer-select isolation prevents accidental remote-text leaks during file drag | integration | `cd www && npx playwright test render/selection-drop.spec.js` | ❌ W0 | ⬜ pending |
| 12-XX-02 | SLIDE-12 | 0 | SLIDE-12 | — | Pointer-select still works when overlay NOT active | regression | `cd www && npx playwright test render/selection-drop.spec.js -g "regression"` | ❌ W0 | ⬜ pending |
| 12-XX-03 | SLIDE-12 | 0 | SLIDE-12 | — | Post-drop pointer-select works (overlay clears cleanly) | integration | `cd www && npx playwright test render/selection-drop.spec.js -g "post-drop"` | ❌ W0 | ⬜ pending |
| 12-XX-04 | SLIDE-36 | 0 | SLIDE-36 | T-12-02 | `computeRenameScheme` 12-collision case (base shrink at N≥10) | unit | `cd www && npx playwright test transport/slide-collisions.spec.js -g "12-collision"` | ❌ W0 | ⬜ pending |
| 12-XX-05 | SLIDE-36 | 0 | SLIDE-36 | T-12-02 | `computeRenameScheme` 100-collision case (double base shrink) | unit | `cd www && npx playwright test transport/slide-collisions.spec.js -g "100-collision"` | ❌ W0 | ⬜ pending |
| 12-XX-06 | SLIDE-36 | 0 | SLIDE-36 | T-12-02 | `computeRenameScheme` no-extension case | unit | `cd www && npx playwright test transport/slide-collisions.spec.js -g "no-extension"` | ❌ W0 | ⬜ pending |
| 12-XX-07 | SLIDE-36 | 0 | SLIDE-36 | — | Modal renders 3 buttons + correct default focus when collisions present | integration | `cd www && npx playwright test transport/slide-collisions.spec.js -g "modal"` | ❌ W0 | ⬜ pending |
| 12-XX-08 | SLIDE-36 | 0 | SLIDE-36 | — | `[Send N renamed]` applies rename via mock-bot send round-trip | integration | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-09 | SLIDE-36 | 0 | SLIDE-36 | — | `[Send only first]` drops collision-group members 1..N | integration | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-10 | SLIDE-36 | 0 | SLIDE-36 | — | `[Refuse batch]` prevents enterSendMode call | integration | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-11 | SLIDE-36 | 0 | SLIDE-36 | — | No-collision happy path: Cancel-default focus preserved | regression | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-12 | SLIDE-38 | 0 | SLIDE-38 | T-12-03 | `isAutoSendSafe` regex accepts SAFE_CASES (5 cases) | unit | `cd www && npx playwright test transport/slide-autosend-safety.spec.js -g "accepts"` | ❌ W0 | ⬜ pending |
| 12-XX-13 | SLIDE-38 | 0 | SLIDE-38 | T-12-03 | `isAutoSendSafe` regex rejects UNSAFE_CASES (5 cases) | unit | `cd www && npx playwright test transport/slide-autosend-safety.spec.js -g "rejects"` | ❌ W0 | ⬜ pending |
| 12-XX-14 | SLIDE-38 | 0 | SLIDE-38 | T-12-03 | Unsafe command blocks auto-type at use site | integration | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-15 | SLIDE-38 | 0 | SLIDE-38 | T-12-04 | First-use confirm surfaces for non-default value | integration | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-16 | SLIDE-38 | 0 | SLIDE-38 | — | Confirmation flag sticks across enterSendMode calls | integration | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-17 | SLIDE-38 | 0 | SLIDE-38 | — | Changing auto-send re-arms confirmation flag | integration | (same file) | ❌ W0 | ⬜ pending |
| 12-XX-18 | SLIDE-40 | 0 | SLIDE-40 | — | `docs/SLIDE_Z80_REQUIREMENT.md` exists with required sections | smoke | `test -f docs/SLIDE_Z80_REQUIREMENT.md && grep -qE 'ESC.\\^.*SLIDE\|wakeup' docs/SLIDE_Z80_REQUIREMENT.md` | ❌ W0 | ⬜ pending |
| 12-XX-19 | SLIDE-41 | 0 | SLIDE-41 | — | README.md gains "File transfer" section | smoke | `grep -q 'File transfer' README.md` | n/a | ⬜ pending |
| 12-XX-20 | SLIDE-41 | 0 | SLIDE-41 | — | README.md keyboard shortcuts table extended | smoke | `grep -q 'Active SLIDE transfer' README.md` | n/a | ⬜ pending |
| 12-XX-21 | SLIDE-42 | 0 | SLIDE-42 | — | `docs/SLIDE-UAT.md` exists with 4 tests in 10-HUMAN-UAT format | smoke | `test -f docs/SLIDE-UAT.md && [ "$(grep -c '^### UAT-12-' docs/SLIDE-UAT.md)" = "4" ]` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs are placeholders (12-XX-NN); planner assigns concrete plan numbers
during step 8.*

---

## Wave 0 Requirements

- [ ] `www/tests/render/selection-drop.spec.js` — covers SLIDE-12 (3 tests)
- [ ] `www/tests/transport/slide-collisions.spec.js` — covers SLIDE-36 (8 tests including unit + integration + regression)
- [ ] `www/tests/transport/slide-autosend-safety.spec.js` — covers SLIDE-38 (15 tests across SAFE/UNSAFE_CASES + integration)
- [ ] `docs/SLIDE_Z80_REQUIREMENT.md` — SLIDE-40 deliverable (new file; `mkdir docs` first)
- [ ] `docs/SLIDE-UAT.md` — SLIDE-42 deliverable (new file)
- [ ] Optional `__isAutoSendSafeForTests` introspection export on `window.__slide` — needed for SLIDE-38 unit-style tests

*Framework install: NOT NEEDED — Playwright already installed at Phase 5; cargo not invoked.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-hardware multi-file send including binary `.COM` | SLIDE-42 (UAT-12-01) | Requires real MicroBeast + patched slide.asm; mock-bot can't validate Z80-side decode of binary | Per `docs/SLIDE-UAT.md` UAT-12-01 |
| Real-hardware multi-file recv including zero-byte file | SLIDE-42 (UAT-12-02) | Same as above; tests Z80 sender path | Per `docs/SLIDE-UAT.md` UAT-12-02 |
| Real-hardware cancel mid-send | SLIDE-42 (UAT-12-03) | Tests Z80 CTRL_CAN echo timing under physical wire conditions | Per `docs/SLIDE-UAT.md` UAT-12-03 |
| Real-hardware cancel mid-recv | SLIDE-42 (UAT-12-04) | Same; **inherits UAT-10-01 blocked-result idiom until upstream slide.asm PR lands** | Per `docs/SLIDE-UAT.md` UAT-12-04 |

*Daily-driver UX checks (drag-drop feel, modal copy clarity, chip placement) are
covered by automated specs above; manual verification is Z80-hardware-bound only.*

---

## Validation Sign-Off

- [ ] All 21 tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (5 new test files + 2 new docs)
- [ ] No watch-mode flags (Playwright runs in single-shot mode)
- [ ] Feedback latency < 30s (test:fast quick run)
- [ ] `nyquist_compliant: true` set in frontmatter once planner assigns concrete task IDs

**Approval:** pending
