---
phase: 10
slug: slide-receiver-cancellation
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-08
revised: 2026-05-08
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

> Revised per planner split: old plan 10-02 split into 10-02 (skeleton) + 10-03 (cancel state machine + dispatcher + keyboard). Old plan 10-03 (Settings UI) renumbered to 10-04. Old plan 10-04 (UAT/E2E) renumbered to 10-05.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | SLIDE-18..24, 27, 29, 30, 34 (Rust SM payload exposure) | — | Receiver SM emits `EVT_HEADER_RECEIVED` + `EVT_RECV_DATA` + `EVT_RECV_FILE_DONE`; `recv_ptr/_len/clear_recv` triple stable across feed_byte | unit | `cargo test -p bestialitty-core slide::state::tests` | ✅ created by 10-01 | ⬜ pending |
| 10-01-02 | 01 | 1 | SLIDE-21, SLIDE-22, SLIDE-23 (zero-byte / sub-frame / binary edge cases + multi-data-per-chunk W3) | — | Edge-case payloads round-trip byte-identical through receiver SM; multi-data-frames-in-one-chunk asserts back-to-back EVT_RECV_DATA round-trip | integration | `cargo test --test slide_recv_corpus` | ✅ created by 10-01 | ⬜ pending |
| 10-01-03 | 01 | 1 | SLIDE-24 (memory bound) | T-10-01 (large-file DoS) | 1 MB receive uses `chunks: Uint8Array[]` accumulator; no O(n²) growth | integration | `cargo test --test slide_recv_memory -- --nocapture` | ✅ created by 10-01 | ⬜ pending |
| 10-01-04 | 01 | 1 | All Phase 10 (boundary stability) | — | Sender + receiver fn-pointer pin extended for new recv accessors + EVT constants | shape | `cargo test --test slide_boundary_shape` + `cargo test --test slide_wasm_boundary_shape` | ✅ created by 10-01 | ⬜ pending |
| 10-02-01 | 02 | 2 | SLIDE-21..24 (wasm boundary forwards) | — | 8 one-line wasm forwards on Slide façade; `recv_ptr/recv_len/clear_recv/recv_filename_*/recv_file_size/recv_current_file_idx` exported from wasm-pack output | shape | `cargo test --test slide_wasm_boundary_shape && bash scripts/build.sh` | ✅ created by 10-02 | ⬜ pending |
| 10-02-02 | 02 | 2 | SLIDE-18, SLIDE-19, SLIDE-20, SLIDE-23 (slide-recv.js skeleton + download dispatch + idb.js + prefs.js) | — | Per-file Blob assembly + anchor-click + 250ms gap (lastDownloadAt timestamp serialisation per W4); `Uint8Array[]` chunks throughout (no text-encoding); idb.js handles getRecvDirHandle / setRecvDirHandle / clearRecvDirHandle with incognito-tolerant try/catch | unit | `cd www && npm run test:fast` (Phase 4/5/6/8/9 regressions stay green; recv stubs from 10-01 remain skipped) | ✅ created by 10-02 | ⬜ pending |
| 10-03-01 | 03 | 3 | SLIDE-30, SLIDE-27 (cancellation drain + Esc-key wiring) | T-10-02 (wire desync after cancel) | 200ms allSettled → CTRL_CAN → 500ms echo wait → 100ms drain → 2s force_idle escape; never reader.cancel/port.close | integration | `cd www && npx playwright test slide-cancel.spec.js` (filled in 10-05) | ✅ created by 10-01 (stub); filled by 10-05 | ⬜ pending |
| 10-03-02 | 03 | 3 | SLIDE-34, SLIDE-29 (mid-session re-entry + hard-fail) | T-10-03 (re-entry corrupts session) | Mid-session ESC^SLIDE → force_idle + clean re-enter; NAK_BUDGET / port-lost / desync converge on terminal-mode reset; slidePumpOnPortLost 5-line minimum | integration | `cd www && npx playwright test slide-recv-reentry.spec.js` (filled in 10-05) | ✅ created by 10-01 (stub); filled by 10-05 | ⬜ pending |
| 10-03-03 | 03 | 3 | Esc disambiguation slot 2 of 4 (chain pos 3 of 5 with Ctrl+Shift+Esc) | — | keyboard.js inserts SLIDE-cancel arm BETWEEN selection-drag-cancel (existing slot 1) and paste-cancel (existing slot 2 → 3) per CONTEXT lock | unit | `cd www && npx playwright test slide-cancel.spec.js -g "Esc-cancel"` | ✅ stub from 10-01; filled in 10-05 | ⬜ pending |
| 10-04-01 | 04 | 4 | SLIDE-18 toggle UI | T-10-04 (silent overwrite) | Settings row + `[Choose folder…]` + IndexedDB persistence; permission re-request on reload | unit | `cd www && npx playwright test slide-recv-settings.spec.js` (filled in 10-05) | ✅ stub from 10-01; filled in 10-05 | ⬜ pending |
| 10-04-02 | 04 | 4 | SLIDE-18 (showDirectoryPicker path + ~N collision) | T-10-04 | `getFileHandle({create:true})` write path; `~N` suffix retry (1..999) then anchor fallback | integration | `cd www && npx playwright test slide-recv-fsap.spec.js` (filled in 10-05) | ✅ stub from 10-01; filled in 10-05 | ⬜ pending |
| 10-05-01 | 05 | 5 | All Phase 10 (E2E + mock-bot sender role) | — | Mock-serial-slide-bot.js sender role drives every Phase 10 SC end-to-end | e2e | `cd www && npx playwright test slide-recv-e2e.spec.js` | ✅ stub from 10-01; filled in 10-05 | ⬜ pending |
| 10-05-02 | 05 | 5 | All Phase 10 (regression + Phase 4/5/8/9 untouched) | — | All prior-phase Playwright suites + cargo workspace remain green | regression | `cargo test --workspace && cd www && npx playwright test` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All Wave-0 test scaffolds are CREATED by Plan 10-01 (Wave 1). Subsequent plans (10-02..10-05) extend or fill them.

- [x] `crates/bestialitty-core/tests/slide_recv_corpus.rs` — zero-byte / sub-frame / binary / multi-file / max-payload + multi-data-frames-in-one-chunk (W3) fixtures (created by 10-01)
- [x] `crates/bestialitty-core/tests/slide_recv_memory.rs` — 1 MB+ memory-bound smoke (created by 10-01)
- [x] `crates/bestialitty-core/tests/slide_recv_payload.rs` — accessor triple + EVT_* ordering unit tests (created by 10-01)
- [x] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — extension for new recv accessors + EVT constants (file already exists; extended by 10-01)
- [x] `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — same (extended by 10-01 for EVT_*; further extended by 10-02 for fn-pointer pin)
- [x] `www/tests/transport/slide-recv.spec.js` — anchor-click download path RED-gate stub (created by 10-01; filled by 10-05)
- [x] `www/tests/transport/slide-cancel.spec.js` — cancel drain + Esc-key disambiguation RED-gate stub (created by 10-01; filled by 10-05)
- [x] `www/tests/transport/slide-recv-reentry.spec.js` — mid-session ESC^SLIDE + hard-fail recovery RED-gate stub (created by 10-01; filled by 10-05)
- [x] `www/tests/transport/slide-recv-settings.spec.js` — Settings toggle + IndexedDB RED-gate stub (created by 10-01; filled by 10-05)
- [x] `www/tests/transport/slide-recv-fsap.spec.js` — File System Access API + collision suffix RED-gate stub (created by 10-01; filled by 10-05)
- [x] `www/tests/transport/slide-recv-e2e.spec.js` — full E2E with mock sender bot RED-gate stub (created by 10-01; filled by 10-05)
- [x] `www/tests/transport/mock-serial-slide-bot.js` — extension with `role: 'send'` parameter (existing file; extended by 10-05)

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (10 new test files; 2 file extensions) — all created by Plan 10-01 as RED-gate stubs
- [x] No watch-mode flags (Playwright is one-shot; cargo test is one-shot)
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (planner sign-off post-revision; checker pass scheduled).
