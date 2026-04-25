---
phase: 6
slug: daily-driver-polish-session-deployment
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-25
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.55.x (Phase 3–5 established) + `cargo test` (Phase 1 Rust core) |
| **Config file** | `www/playwright.config.js` (extends with `tests/session/` glob) + workspace `Cargo.toml` |
| **Quick run command** | `cd www && npx playwright test --grep @fast tests/session/` |
| **Full suite command** | `cargo test --manifest-path crates/bestialitty-core/Cargo.toml && cd www && npx playwright test` |
| **Estimated runtime** | Quick: ~10–15 s — Full: ~90–120 s (excluding the 24 h soak in 06-SOAK.md) |

---

## Sampling Rate

- **After every task commit:** Run `cd www && npx playwright test --grep @fast tests/session/`
- **After every plan wave:** Run full suite (`cargo test` + `npx playwright test`)
- **Before `/gsd-verify-work`:** Full suite green + 06-HUMAN-UAT.md checkpoint passed
- **Max feedback latency:** 15 seconds (quick run); 120 seconds (full suite). 24 h soak runs out-of-band.

---

## Per-Task Verification Map

> Populated by planner. Each task in PLAN.md must map to a row here, and every row's
> `Status` must reach ✅ before phase verification can pass.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _populated by planner_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `www/tests/session/scrollback.spec.js` — `test.fixme` stubs for SESS-01 / scrollback nav (D-01..D-15)
- [ ] `www/tests/session/selection.spec.js` — `test.fixme` stubs for SESS-02 (drag-select, double/triple-click, copy format, inverted-glyph rendering)
- [ ] `www/tests/session/clipboard.spec.js` — `test.fixme` stubs for SESS-02/SESS-03 (Ctrl+Shift+C, Ctrl+Shift+V, large-paste warn 4 KB+)
- [ ] `www/tests/session/clear-screen.spec.js` — `test.fixme` stubs for SESS-06 (top-bar Clear, Shift+click clears scrollback)
- [ ] `www/tests/session/log-download.spec.js` — `test.fixme` stubs for SESS-04/SESS-05 (log accumulator, mid-session download Blob)
- [ ] `www/tests/session/prefs.spec.js` — `test.fixme` stubs for PREF-01/PREF-02 (round-trip schema, debounced save, beforeunload flush, version migration)
- [ ] `www/tests/session/auto-connect.spec.js` — `test.fixme` stubs for PLAT-05/PREF-01 (first-open defaults, auto-connect-off-by-default, opt-in silent open)
- [ ] `www/tests/session/clipboard-mock.js` — Playwright `addInitScript` shim for `navigator.clipboard.writeText` / `readText` returning controllable buffers
- [ ] `crates/bestialitty-core/tests/snapshot_at_offset.rs` — stub for `Terminal::snapshot_grid_at(row_offset)` (re-uses Phase 2 `pack_buf` contract)
- [ ] `crates/bestialitty-core/tests/clear_visible.rs` — stub for `Terminal::clear_visible()` (zeros all 24 visible rows, leaves scrollback intact)
- [ ] Extend `www/playwright.config.js` `testMatch` glob with `tests/session/**/*.spec.js`

*Wave 0 lands every test stub before any production code; Waves 1–5 un-`fixme` each
stub as the corresponding feature lands. Mirrors Phase 4 Plan 01 + Phase 5 Plan 01
test-scaffolding-first discipline.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 24-hour memory-flat soak | SESS-01 SC-2 | Real MicroBeast hardware required; `performance.memory` requires Chromium runtime; 24 h elapsed time cannot be CI-budget compressed | See 06-SOAK.md — boot real MicroBeast emitting ~1 line/sec, sample `performance.memory` + `wasm.memory.buffer.byteLength` every 60 s for 24 h, post-run review confirms ±10% stability after first 10 min |
| Static deploy reachability | PLAT-03 | Live URL must be visited in a real Chromium browser; CI cannot validate "I can connect to my MicroBeast from this URL" | Visit deployed `https://<user>.github.io/bestialitty/` in Chromium → polite-fail does NOT show → click Connect → port picker opens → connect succeeds |
| Daily-driver UAT | SC-5 | "Used as the only terminal for a full MicroBeast work session" requires a human with a MicroBeast | See 06-HUMAN-UAT.md — work session with paste 100 KB during real CP/M, scroll back through 8 K lines of BASIC, copy-and-paste a command from history, theme-toggle while scrolled up, clear-screen during long output, full reload restores prefs + auto-connect on second visit |
| Real-clipboard handshake | SESS-02/SESS-03 | Playwright clipboard mocks bypass Chromium's user-gesture requirement; need one round-trip with real OS clipboard to prove the read-permission grant flow | Manual: open Chromium with no prior site permission → drag-select → Ctrl+Shift+C → confirm clipboard contains expected text via OS paste-buffer reader → Ctrl+Shift+V → confirm bytes hit the wire |
| GitHub Pages first-deploy headers | PLAT-03 | Pages cache TTL hides config errors; first push reveals whether `.nojekyll` and `_headers` shipped correctly | Manual: after first GH Action push, curl the deployed `index.html` URL → confirm `content-type: text/html`; curl `pkg/*.wasm` → confirm `content-type: application/wasm`; if not, document fallback |
| `<meta http-equiv="Content-Security-Policy">` defense-in-depth | PLAT-03 | `frame-ancestors` and a few directives cannot be enforced via `meta` — confirm what IS enforced | Manual: load deployed page → DevTools → check that `script-src 'self' 'wasm-unsafe-eval'` is enforced (test by injecting `<script>` from data URI and confirming block) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (Playwright runs non-interactive; `cargo test` no `--watch`)
- [ ] Feedback latency < 15 s (quick run) / 120 s (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
