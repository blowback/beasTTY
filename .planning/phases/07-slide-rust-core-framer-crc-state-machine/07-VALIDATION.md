---
phase: 7
slug: slide-rust-core-framer-crc-state-machine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from 07-RESEARCH.md §Validation Architecture; expand task-IDs at plan time.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (Rust native, std-only) |
| **Config file** | `crates/bestialitty-core/Cargo.toml` (existing) |
| **Quick run command** | `cargo test -p bestialitty-core slide` |
| **Full suite command** | `cargo test -p bestialitty-core` |
| **Estimated runtime** | ~2 s quick / ~5 s full |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p bestialitty-core slide` (slide-prefixed unit + integration; <2 s)
- **After every plan wave:** Run `cargo test -p bestialitty-core` (whole crate; includes Phase 1+ regressions; <5 s)
- **Before `/gsd-verify-work`:** Full suite green PLUS `cargo test -p bestialitty-core --test core_02_no_browser_deps` green PLUS `cargo build --target x86_64-unknown-linux-gnu` succeeds (D-20 native-build invariant)
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

Task IDs (`07-NN-MM`) are filled at plan time. Each row maps a phase requirement to a concrete `cargo test` invocation. Threat refs come from each plan's `<threat_model>` block.

| Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 1 | SLIDE-01 | T-07-01 / — | `slide/` module compiles; `Slide::new()` constructs in Idle | unit | `cargo test -p bestialitty-core slide::tests::new_constructs_in_idle` | ❌ W0 — `slide/tests.rs` | ⬜ pending |
| TBD | 1 | SLIDE-01 | — | Zero browser deps preserved across new module | integration | `cargo test -p bestialitty-core --test core_02_no_browser_deps` | ✅ exists | ⬜ pending |
| TBD | 4 | SLIDE-01 | — | `Slide` public API surface pinned (Phase 8 anticipation contract) | integration | `cargo test -p bestialitty-core --test slide_boundary_shape` | ❌ W0 — `tests/slide_boundary_shape.rs` | ⬜ pending |
| TBD | 4 | SLIDE-02 | T-07-02 / Chunk-boundary framing (PITFALLS §1) | Every fixture frame torn at every internal byte offset still resolves to identical SM end-state | integration | `cargo test -p bestialitty-core --test slide_torn_chunk` | ❌ W0 — `tests/slide_torn_chunk.rs` | ⬜ pending |
| TBD | 4 | SLIDE-02 | — | Multi-frame chunks (RDY+header+ACK in one chunk vs three) resolve identically across splits | integration | `cargo test -p bestialitty-core --test slide_torn_chunk -- multi_frame` | ❌ W0 | ⬜ pending |
| TBD | 1 | SLIDE-03 | T-07-03 / CRC variant (PITFALLS §3) | Greg Cook reference vector `crc16_ccitt(b"123456789") == 0x29B1` | unit | `cargo test -p bestialitty-core slide::crc::tests::reference_vector_123456789` | ❌ W0 — `slide/crc.rs#tests` | ⬜ pending |
| TBD | 2 | SLIDE-03 | — | All 7 fixture frames feed-and-validate cleanly (HEADER, SUBFRAME, EMPTY, EOF, ALL_FF, MAX_PAYLOAD, SLIDE_RS_HELLO) | integration | `cargo test -p bestialitty-core --test slide_reference_corpus` | ❌ W0 — `tests/slide_reference_corpus.rs` | ⬜ pending |
| TBD | 2 | SLIDE-03 | — | CRC scope excludes SOF: mutated SOF byte does NOT change CRC; mutated SEQ/LEN/PAYLOAD byte DOES | unit | `cargo test -p bestialitty-core slide::framer::tests::crc_scope_excludes_sof` | ❌ W0 — `slide/framer.rs#tests` | ⬜ pending |
| TBD | 2 | SLIDE-03 | — | CRC big-endian wire order: swapping `[CRC_H, CRC_L]` emits `EVT_CRC_ERROR` | unit | `cargo test -p bestialitty-core slide::framer::tests::crc_wire_order_big_endian` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | — | Receiver SM: `enter_recv_mode → feed RDY` emits `EVT_RDY` and pushes RDY echo to `outbound_buf` | unit | `cargo test -p bestialitty-core slide::state::tests::recv_rdy_echoed` | ❌ W0 — `slide/state.rs#tests` | ⬜ pending |
| TBD | 3 | SLIDE-04 | — | Header frame triggers ACK with seq=0 | unit | `cargo test -p bestialitty-core slide::state::tests::header_acks_seq_0` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | — | Data frame seq mismatch triggers NAK with `expected_seq` | unit | `cargo test -p bestialitty-core slide::state::tests::seq_mismatch_naks` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | T-07-04 / NAK retry budget exhaustion | NAK budget = 15 retries; 16th CRC error transitions to `Error` | unit | `cargo test -p bestialitty-core slide::state::tests::nak_budget_exhaustion` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | — | EOF frame (zero-payload data frame) triggers ACK and loops to `HeaderPhase` | unit | `cargo test -p bestialitty-core slide::state::tests::eof_frame_loops_to_header` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | — | FIN in `HeaderPhase` triggers FIN echo and transitions to `Done` | unit | `cargo test -p bestialitty-core slide::state::tests::fin_echoes_and_completes` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | T-07-05 / Cancellation race (PITFALLS §5) | `cancel()` builds CTRL_CAN, transitions to `CancelPending`, idempotent on second call (D-06) | unit | `cargo test -p bestialitty-core slide::state::tests::cancel_idempotent` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | T-07-05 / — | Peer-initiated CAN during DataPhase echoes CTRL_CAN and transitions to `CancelPending` (D-05 strict bidirectional) | unit | `cargo test -p bestialitty-core slide::state::tests::peer_can_echoes` | ❌ W0 | ⬜ pending |
| TBD | 4 | SLIDE-04 | — | CancelPending: non-CAN bytes silently consumed; no events emitted (D-07) | integration | `cargo test -p bestialitty-core --test slide_idempotent_reentry cancel_pending_silent_drain` | ❌ W0 — `tests/slide_idempotent_reentry.rs` | ⬜ pending |
| TBD | 4 | SLIDE-04 | — | CancelPending: peer's CAN echo transitions to `Done` | integration | `cargo test -p bestialitty-core --test slide_idempotent_reentry can_echo_completes` | ❌ W0 | ⬜ pending |
| TBD | 3 | SLIDE-04 | — | `force_idle()` from any state transitions to `Done` (D-06 escape hatch) | unit | `cargo test -p bestialitty-core slide::state::tests::force_idle_transitions_to_done` | ❌ W0 | ⬜ pending |
| TBD | 4 | SLIDE-04 | T-07-06 / Re-entrant wakeup (PITFALLS §9) | All 6 idempotent-re-entry tests in 07-RESEARCH.md §Re-entry Test Cases pass | integration | `cargo test -p bestialitty-core --test slide_idempotent_reentry` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Files that MUST exist before any verification can run; created in Plans 07-01 (foundations) and 07-02 (framer):

- [ ] `crates/bestialitty-core/src/slide/mod.rs` — module surface, re-exports
- [ ] `crates/bestialitty-core/src/slide/crc.rs` — `crc16_ccitt` + `tests` block (≥3 unit tests: catalogue vector, slide-rs roundtrip, edge cases)
- [ ] `crates/bestialitty-core/src/slide/framer.rs` — `FramerState` enum + `feed_byte_framer` + `tests` block (≥8 unit tests: each transition row + 2 CRC-scope tests)
- [ ] `crates/bestialitty-core/src/slide/state.rs` — `Slide` struct + `SlideState` enum + receiver SM + `cancel`/`force_idle` + `tests` block (≥12 unit tests covering each receiver SM transition)
- [ ] `crates/bestialitty-core/src/slide/tests.rs` — module-level integration smoke (≥5 tests)
- [ ] `crates/bestialitty-core/src/slide/tests_only.rs` — `#[cfg(test)] pub` re-exports of fixture constants for cross-test reuse
- [ ] `crates/bestialitty-core/tests/slide_torn_chunk.rs` — torn-chunk corpus (mirrors `tests/torn_chunk.rs`)
- [ ] `crates/bestialitty-core/tests/slide_reference_corpus.rs` — 7 fixtures cross-validated against slide-rs contract
- [ ] `crates/bestialitty-core/tests/slide_idempotent_reentry.rs` — 6 re-entry tests from 07-RESEARCH.md §Re-entry Test Cases
- [ ] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — Phase 8 anticipation contract (mirrors Phase 2's `boundary_api_shape.rs`)
- [ ] `crates/bestialitty-core/src/lib.rs` — modify lines 16-21 to add `pub mod slide;`
- [ ] `crates/bestialitty-core/Cargo.toml` — add D-01 audit-trail comment (no new deps)

*(Framework install: none. Rust toolchain already in place.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Byte-for-byte CRC equality with slide-rs `build_frame` for the 7 reference fixtures | SLIDE-03 | Cross-tool source-availability dependency; the slide-rs CLI is at `/home/ant/src/microbeast/SLIDE/slide-rs/` — not on every CI runner. Automated test pins hand-derived bytes; one-time human cross-check confirms drift hasn't happened since fixture creation. | (Optional, dev-machine only) `cd /home/ant/src/microbeast/SLIDE/slide-rs && cargo run -- emit-fixtures` and diff against `tests/slide_reference_corpus.rs`. Flag any divergence as a Phase 7 regression. |

*All other behaviors have automated verification via `cargo test`.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---

## Dimension 8 Coverage Statement

Every Phase 7 phase requirement (SLIDE-01..04) has at least one automated `cargo test` command in the Per-Task Verification Map above. The "Per task commit" sampling rate (`cargo test -p bestialitty-core slide`) runs all slide-prefixed tests in <2 s, satisfying the Nyquist max-latency requirement. No requirement relies solely on manual verification; the single Manual-Only entry is an optional cross-tool drift check that supplements (does not replace) the automated reference-corpus test.
