---
phase: 9
slug: slide-sender-host-z80-send
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth distillation from `09-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust)** | `cargo test` (unit + integration tests under `crates/bestialitty-core/tests/`) |
| **Framework (JS)** | Playwright `^1.51.0` (Chromium-only, HiDPI deviceScaleFactor=2) |
| **Config file (Rust)** | `crates/bestialitty-core/Cargo.toml` |
| **Config file (JS)** | `www/playwright.config.js` |
| **Quick run command (Rust unit)** | `cargo test -p bestialitty-core slide::state::tests` |
| **Quick run command (Rust sender integration)** | `cargo test --test slide_sender` |
| **Quick run command (Playwright @fast)** | `cd www && npm run test:fast` |
| **Full suite command (Rust)** | `cargo test --workspace` |
| **Full suite command (JS)** | `cd www && npm test` |
| **Estimated runtime (Rust quick)** | ~5 seconds |
| **Estimated runtime (Rust full)** | ~30 seconds |
| **Estimated runtime (Playwright @fast)** | ~45 seconds |
| **Estimated runtime (Playwright full)** | ~3 minutes |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p bestialitty-core slide::` (Rust SM unit tests, < 5s)
- **After every plan wave:** Run `cargo test --workspace && cd www && npm run test:fast` (Rust full + Playwright @fast subset)
- **Before `/gsd-verify-work`:** `cargo test --workspace && cd www && npm test` — all green
- **Max feedback latency:** < 5 seconds for per-task commit; < 60 seconds per wave

---

## Per-Task Verification Map

> Filled in by planner during plan creation. Each plan task SHOULD declare its `<automated>` test command pointing to one of these targets.

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| SLIDE-07 | Multi-file picker triggers send via `<input type="file" multiple>` | Playwright e2e | `cd www && npx playwright test transport/slide-sender.spec.js -g "picker click flow"` | ❌ W0 |
| SLIDE-08 | Drag-drop onto `#terminal-wrapper` triggers send | Playwright e2e | `cd www && npx playwright test input/file-source.spec.js -g "drag-drop overlay"` | ❌ W0 |
| SLIDE-09 | Drag-over shows dashed-border overlay + tint + label | Playwright e2e | `cd www && npx playwright test input/file-source.spec.js -g "overlay visible"` | ❌ W0 |
| SLIDE-10 | Non-file drags rejected at `dragenter` | Playwright unit | `cd www && npx playwright test input/file-source.spec.js -g "non-file rejection"` | ❌ W0 |
| SLIDE-13 | Auto-types `B:SLIDE R\r` via existing tx-sink path | Playwright e2e | `cd www && npx playwright test transport/slide-sender.spec.js -g "auto-type"` | ❌ W0 |
| SLIDE-15 | Filenames uppercased + 8.3-truncated; rewrite shown in modal | Playwright unit + Rust unit | `cd www && npx playwright test input/file-source.spec.js -g "modal rewrite"` + `cargo test -p bestialitty-core slide::state::tests::sender_handshake_ships_header` | ❌ W0 |
| SLIDE-16 | CP/M-invalid characters rejected pre-flight | Playwright unit | `cd www && npx playwright test input/file-source.spec.js -g "modal rejection"` | ❌ W0 |
| Phase 9 SC#5 | Sender uses `await writer.ready; writer.write(bytes)` | Rust integration + Playwright e2e | `cargo test --test slide_sender end_to_end_single_file` + `cd www && npx playwright test transport/slide-sender.spec.js -g "byte-identical round-trip"` | ❌ W0 |
| Boundary contract | Sender API fn-pointer pin | Rust integration | `cargo test --test slide_boundary_shape slide_send_methods_have_stable_signatures` | ⚠️ EXTEND |
| Boundary contract | Wasm façade fn-pointer pin | Rust integration | `cargo test --test slide_wasm_boundary_shape slide_send_methods_have_stable_signatures` | ⚠️ EXTEND |
| Boundary contract | New `EVT_FILE_COMPLETE` / `EVT_SESSION_COMPLETE` / `EVT_RETRANSMIT_NEEDED` constants pinned | Rust integration | `cargo test --test slide_boundary_shape slide_event_constants_pinned` | ⚠️ EXTEND |
| OUTBOUND_RESERVE growth | Stable pointer across sender window pushes | Rust unit | `cargo test -p bestialitty-core slide::state::tests::outbound_ptr_stable_across_sender_window_pushes` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ❌ W0 = not yet implemented (Wave 0 dependency)*

---

## Wave 0 Requirements

Net-new test files (no framework install needed; Rust + Playwright already configured from Phases 1-8):

- [ ] `crates/bestialitty-core/tests/slide_sender.rs` — NEW; covers Phase 9 SC#5 byte-identical round-trip + multi-file + zero-byte + NAK retransmit + inbound CAN echo
- [ ] `crates/bestialitty-core/src/slide/state.rs` `#[cfg(test)] mod tests` — EXTEND with sender SM transition tests (handshake, ACK advance, NAK rewind, EOF, mid-send CAN echo)
- [ ] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — EXTEND with sender API fn-pointer coercions + new EVT_* assertions
- [ ] `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — EXTEND mirror of inner pin
- [ ] `www/tests/transport/slide-sender.spec.js` — NEW; full sender flow against mock SLIDE-receiver bot
- [ ] `www/tests/input/file-source.spec.js` — NEW; picker click, drag-drop overlay, modal flow, CP/M validation, non-file rejection
- [ ] `www/tests/transport/mock-serial-slide-bot.js` — NEW; SLIDE-receiver bot extending the existing `mock-serial.js` with frame parser + ACK/NAK injector hooks

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-hardware byte-identical send to MicroBeast (multi-KB file via CP/M `slide.com R`) | Phase 9 SC#5 (real device) | Web Serial automation cannot drive a physical Z80; Phase 9 ships against mock receiver only | Deferred to **Phase 12 SLIDE-UAT.md** — runs against patched `slide.asm` per Phase 12 SLIDE-42 |
| Auto-type CP/M loading delay (~500 ms post-header sleep) on real hardware | Performance only | slide-rs/send.rs:142-144 sleeps 500 ms after header ACK; mock receiver is instantaneous | **Phase 12 hardware UAT** confirms whether Phase 9 needs an additive sleep |
| Visible auto-type echo doubling (`B:SLIDE R\r` printed twice in terminal) | UX polish | Phase 11 owns SLIDE-14 swallow-echo filter; Phase 9 ships with visible doubling per CONTEXT D-13 | Phase 9 manual UAT confirms doubling is "tolerable"; Phase 11 fixes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies declared in Plan 09-04
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (7 net-new test files / extensions enumerated above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s per task / < 60s per wave
- [ ] `nyquist_compliant: true` set in frontmatter (after planner pins all task → test mappings)

**Approval:** pending
