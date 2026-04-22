---
phase: 3
slug: canvas-renderer
status: active
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure is bootstrapped in Plan 01 (Wave 1); specs land in Plan 04 (Wave 4).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright `@playwright/test` ^1.51 — Chromium-only (matches project constraint) |
| **Config file** | `www/playwright.config.js` (created in Plan 01 Task 2) |
| **Quick run command** | `cd www && npx playwright test --project=chromium --grep '@fast'` |
| **Full suite command** | `cd www && npx playwright test --project=chromium` |
| **Baseline regen** | `cd www && npx playwright test --project=chromium --update-snapshots` (Plan 04 Task 1 only) |
| **Estimated runtime** | ~45 s full suite (9 specs × ~5 s each incl. rAF + font-ready waits) |
| **Supplemental** | `cargo test -p bestialitty-core` — unchanged from Phase 1/2; no Rust changes in Phase 3 |

---

## Sampling Rate

- **After every task commit:** Quick-run command OR the most-specific spec the task affects
- **After every plan wave:** Full suite must be green
- **Before `/gsd-verify-phase`:** Full suite green + manual UAT checkpoint (Plan 04 Task 2) complete
- **Max feedback latency:** ≤ 45 s (full suite); ≤ 5 s for a single spec during task iteration

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | RENDER-04 | T-03-01-01 | Original creative work (no binary font copy) | fixture | `node -e "const {BITMAP_FONT}=require('./www/renderer/bitmap-font.js'); process.exit(BITMAP_FONT.length===2048?0:1)"` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | RENDER-05 | T-03-01-02 | OFL 1.1 attribution present, WOFF2 magic bytes validated | fixture | `head -c 4 www/assets/fonts/jetbrains-mono-regular.woff2 \| xxd \| grep -q "7742 4f32"` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | — | T-03-01-03 | Playwright config restricts to Chromium + DPR 2 | fixture | `grep -c "deviceScaleFactor.*2" www/playwright.config.js` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 2 | RENDER-04, RENDER-08 | T-03-02-01 | Theme enum guarded, no DOM text from external input | unit | `cd www && npx playwright test tests/render/theme-crt.spec.js` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 2 | RENDER-09, RENDER-12 | T-03-02-02 | Full atlas evict on theme/phosphor/zoom/DPR change; no unbounded growth | integration | `cd www && npx playwright test tests/render/zoom.spec.js` | ❌ W0 | ⬜ pending |
| 3-02-03 | 02 | 2 | RENDER-01, RENDER-02, RENDER-10 | T-03-02-03 | HiDPI setTransform(dpr, 0, 0, dpr, 0, 0) correctness; no sub-pixel blur | integration | `cd www && npx playwright test tests/render/hidpi.spec.js tests/render/grid.spec.js tests/render/cursor.spec.js` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 3 | RENDER-06, RENDER-07, RENDER-08 | T-03-03-01 | textContent only (no innerHTML); preventDefault synchronous | integration | `cd www && npx playwright test tests/render/theme-toggle.spec.js tests/render/phosphor.spec.js` | ❌ W0 | ⬜ pending |
| 3-03-02 | 03 | 3 | RENDER-03, RENDER-11 | T-03-03-02 | Bell + visibility logic executed on feed() completion path (not rAF-throttled) | integration | `cd www && npx playwright test tests/render/bell.spec.js tests/render/focus.spec.js` | ❌ W0 | ⬜ pending |
| 3-03-03 | 03 | 3 | RENDER-07 | T-03-03-03 | Ctrl+Shift+T captured only when canvas focused; no global shortcut leak | integration | `cd www && npx playwright test tests/render/keyboard.spec.js` | ❌ W0 | ⬜ pending |
| 3-04-01 | 04 | 4 | ALL (RENDER-01..12) | T-03-04-01 | Visual-regression baselines pinned at DPR 2 | integration | `cd www && npx playwright test --project=chromium` | ❌ W0 | ⬜ pending |
| 3-04-02 | 04 | 4 | ALL (RENDER-01..12) | — | Human UAT checkpoint — manual verification per `www/README.md` | manual | checkpoint:human-verify | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Coverage continuity:** No 3 consecutive task IDs without an automated entry (Task 3-04-02 is the only manual, and it is the terminal UAT).

---

## Wave 0 Requirements

Plan 01 delivers all Wave 0 infrastructure before any renderer code is exercised:

- [ ] `www/package.json` — declares `@playwright/test` ^1.51 devDependency (Plan 01 Task 2)
- [ ] `www/playwright.config.js` — Chromium-only, `deviceScaleFactor: 2`, `testDir: './tests/render'` (Plan 01 Task 2)
- [ ] `www/tests/fixtures/vt52-sample.bin` — deterministic VT52 byte stream derived from `.planning/research/captures/capture-01-cpm-boot/bytes.bin` (Plan 01 Task 3)
- [ ] `www/tests/render/.gitkeep` — spec directory scaffold (Plan 01 Task 2)
- [ ] `www/.gitignore` — excludes `node_modules/`, `playwright-report/`, `test-results/` (Plan 01 Task 2)
- [ ] `npm install` inside `www/` — Playwright browsers downloaded (run once at Plan 01 completion; executor confirms via `npx playwright --version`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HiDPI crispness across monitor DPR change | RENDER-10 | Requires physically dragging the browser between monitors of different DPR (Playwright cannot emulate mid-session DPR change reliably) | Open `www/index.html` on a HiDPI primary; drag the window to a non-HiDPI secondary; confirm no blur, no re-layout flash, cursor remains sharp |
| BEL audible-vs-visible sanity on real MicroBeast | RENDER-11 | Requires the real hardware feed (Phase 5 integration) — Phase 3 can only verify the visible half via fixture | Phase 5 UAT only; Phase 3 fallback is the `0x07` byte in `vt52-sample.bin` |
| Readable 80×24 at typical laptop viewport without squinting | RENDER-01 | Subjective readability is not grep-verifiable | Author opens the page at 1440×900 viewport and confirms all 80 columns fit horizontally with comfortable reading |
| Phosphor color fidelity vs period-authentic reference | RENDER-08 | Palette RGB values (#33ff66 / #ffb000 / #e8e8d8) are author-chosen; side-by-side with a DEC VT220 photo is a human judgement | Author reviews each phosphor against a reference image at Plan 04 Task 2 checkpoint |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (9 auto + 1 manual terminal UAT)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Plan 01 delivers infrastructure before any Wave 2+ task runs)
- [x] No watch-mode flags (all commands run-once)
- [x] Feedback latency < 45 s for full suite, < 5 s for a single spec
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-22 (plan-phase orchestrator)
