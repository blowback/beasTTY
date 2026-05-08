---
phase: 10
slug: slide-receiver-cancellation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust)** | `cargo test` (workspace) |
| **Framework (JS/E2E)** | Playwright (`@playwright/test`) |
| **Config file (Rust)** | `crates/bestialitty-core/Cargo.toml` |
| **Config file (JS)** | `www/playwright.config.js` |
| **Quick run command (Rust)** | `cargo test --workspace --lib` |
| **Quick run command (JS)** | `cd www && npm run test:fast` |
| **Full suite command (Rust)** | `cargo test --workspace` |
| **Full suite command (JS)** | `cd www && npx playwright test` |
| **WASM rebuild** | `bash scripts/build.sh` (mandatory after Rust changes; hard reload Ctrl+Shift+R per MEMORY.md) |
| **Estimated runtime (Rust)** | ~30 seconds (~258+ tests after Phase 9) |
| **Estimated runtime (JS fast)** | ~45 seconds (80+ tests after Phase 9) |

---

## Sampling Rate

- **After every task commit:** Run the Rust quick command if `slide/` files changed; the JS fast command if `www/transport/` or `www/input/` files changed.
- **After every plan wave:** Run both full suites + `bash scripts/build.sh` to verify wasm regeneration.
- **Before `/gsd-verify-work`:** Both full suites green + manual UAT checkpoint.
- **Max feedback latency:** 60 seconds (rust quick + js fast in parallel).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | SLIDE-18..24, 27, 29, 30, 34 (Rust SM payload exposure) | — | Receiver SM emits `EVT_HEADER_RECEIVED` + `EVT_RECV_DATA` + `EVT_RECV_FILE_DONE`; `recv_ptr/_len/clear_recv` triple stable across feed_byte | unit | `cargo test -p bestialitty-core slide::state::tests` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | SLIDE-21, SLIDE-22, SLIDE-23 (zero-byte / sub-frame / binary edge cases) | — | Edge-case payloads round-trip byte-identical through receiver SM | integration | `cargo test --test slide_recv_edge_cases` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | SLIDE-24 (memory bound) | T-10-01 (large-file DoS) | 1 MB receive uses `chunks: Uint8Array[]` accumulator; no O(n²) growth | integration | `cargo test --test slide_recv_memory -- --nocapture` | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | All Phase 10 (boundary stability) | — | Sender + receiver fn-pointer pin extended for new recv accessors + EVT constants | shape | `cargo test --test slide_boundary_shape` + `cargo test --test slide_wasm_boundary_shape` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | SLIDE-18, SLIDE-19, SLIDE-20, SLIDE-23 (slide-recv.js download dispatch) | — | Per-file Blob assembly + anchor-click + 250ms gap; `Uint8Array[]` chunks throughout (no text-encoding) | unit | `cd www && npx playwright test slide-recv.spec.js -g "anchor-click"` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 2 | SLIDE-30, SLIDE-27 (cancellation drain + Esc-key wiring) | T-10-02 (wire desync after cancel) | 200ms allSettled → CTRL_CAN → 500ms echo wait → 100ms drain → 2s force_idle escape; never reader.cancel/port.close | integration | `cd www && npx playwright test slide-cancel.spec.js` | ❌ W0 | ⬜ pending |
| 10-02-03 | 02 | 2 | SLIDE-34, SLIDE-29 (mid-session re-entry + hard-fail) | T-10-03 (re-entry corrupts session) | Mid-session ESC^SLIDE → force_idle + clean re-enter; NAK_BUDGET / port-lost / desync converge on terminal-mode reset | integration | `cd www && npx playwright test slide-recv-reentry.spec.js` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 3 | SLIDE-18 toggle UI | T-10-04 (silent overwrite) | Settings row + `[Choose folder…]` + IndexedDB persistence; permission re-request on reload | unit | `cd www && npx playwright test slide-recv-settings.spec.js` | ❌ W0 | ⬜ pending |
| 10-03-02 | 03 | 3 | SLIDE-18 (showDirectoryPicker path + ~N collision) | T-10-04 | `getFileHandle({create:true})` write path; `~N` suffix retry (1..999) then anchor fallback | integration | `cd www && npx playwright test slide-recv-fsap.spec.js` | ❌ W0 | ⬜ pending |
| 10-04-01 | 04 | 4 | All Phase 10 (E2E + mock-bot sender role) | — | Mock-serial-slide-bot.js sender role drives every Phase 10 SC end-to-end | e2e | `cd www && npx playwright test slide-recv-e2e.spec.js` | ❌ W0 | ⬜ pending |
| 10-04-02 | 04 | 4 | All Phase 10 (regression + Phase 4/5/8/9 untouched) | — | All prior-phase Playwright suites + cargo workspace remain green | regression | `cargo test --workspace && cd www && npx playwright test` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/bestialitty-core/tests/slide_recv_edge_cases.rs` — zero-byte / sub-frame / binary fixtures
- [ ] `crates/bestialitty-core/tests/slide_recv_memory.rs` — 1 MB+ memory-bound smoke
- [ ] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — extension for new recv accessors + EVT constants (file already exists; extend)
- [ ] `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — same (extend)
- [ ] `www/tests/slide-recv.spec.js` — anchor-click download path
- [ ] `www/tests/slide-cancel.spec.js` — cancel drain + Esc-key disambiguation
- [ ] `www/tests/slide-recv-reentry.spec.js` — mid-session ESC^SLIDE + hard-fail recovery
- [ ] `www/tests/slide-recv-settings.spec.js` — Settings toggle + IndexedDB
- [ ] `www/tests/slide-recv-fsap.spec.js` — File System Access API + collision suffix
- [ ] `www/tests/slide-recv-e2e.spec.js` — full E2E with mock sender bot
- [ ] `www/tests/mock-serial-slide-bot.js` — extend with `role: 'send'` parameter

*Existing infrastructure: `cargo test --workspace` (258 tests after Phase 9), `cd www && npx playwright test` (80 tests after Phase 9), `bash scripts/build.sh` wasm-pack driver.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Z80 cancel echo timing | SLIDE-30 | Hardware-dependent; 19200 baud may make 500ms echo wait tight on slow CP/M shells | Drive a 100 KB recv; press Esc mid-frame; confirm wire returns to neutral CP/M prompt within 2s; recommend updating ms windows if echo doesn't arrive |
| FileSystemDirectoryHandle persistence across browser restart | SLIDE-18 toggle | Chromium permission-store behavior varies by version; 1-click Allow on reload requires user verification | Toggle on; pick folder; reload tab; verify one-click Allow; close browser; reopen; reload tab; verify reprompt vs. one-click |
| Multi-download Chrome throttle threshold | SLIDE-19 (250ms gap adequacy) | Chrome doesn't formally document the threshold; varies across Chromium versions | Drive a 5-file recv batch with toggle off (anchor-click path); verify all 5 land without "Allow multiple downloads" prompt |
| 1 MB+ daily-driver UX | SLIDE-24 | Memory smoke test asserts no O(n²); subjective UI smoothness needs human eye | Drive a 1 MB recv; verify percent counter updates smoothly; verify Settings pane stays interactive |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (10 new test files; 2 file extensions)
- [ ] No watch-mode flags (Playwright is one-shot; cargo test is one-shot)
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
