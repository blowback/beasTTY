---
phase: 09-slide-sender-host-z80-send
plan: 01
subsystem: slide-sender-rust-core
tags:
  - rust
  - slide
  - sender-sm
  - native-test
  - phase-9
requirements:
  partial:
    - SLIDE-13
    - SLIDE-15
    - SLIDE-16
dependency_graph:
  requires:
    - phase-7 slide framer (build_frame, EVT_*) — extended in place
    - phase-7 slide state (Slide receiver SM) — extended with role gate
    - phase-8 wasm boundary (lib.rs:wasm_boundary Slide façade) — UNCHANGED in 09-01; Plan 09-02 wires the new methods
  provides:
    - sender state machine API: enter_send_mode(metadata) + feed_send_chunk(payload, eof)
    - frame builder helper: build_frame_into(buf, seq, payload)
    - sender event constants: EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE / EVT_RETRANSMIT_NEEDED
    - OUTBOUND_RESERVE = 4128 bytes (4-frame window stable-pointer contract)
    - end-to-end sender corpus (tests/slide_sender.rs, 6 tests)
  affects:
    - JS shell (Plan 09-02): wasm façade in lib.rs forwards into the new APIs
    - JS shell (Plan 09-02): OUTBOUND_VIEW_CAP in www/transport/slide.js MUST grow in lockstep to match OUTBOUND_RESERVE = 4128
    - JS shell (Plan 09-03): file-source.js sender dispatcher consumes the new EVT_* events
tech-stack:
  added: []
  patterns:
    - module-private SendCtx struct populated by enter_send_mode (mirror of receiver-side state fields)
    - sender role gate at top of handle_framer_event (after the existing CAN-echo clause); receiver path unchanged below
    - free pub fn build_frame_into helper (alloc-free when caller pre-reserves capacity) shared between Slide push_header_frame and feed_send_chunk
    - in-process Rust mock receiver bot for integration tests (parallel reimplementation of slide-rs/recv.rs per PITFALLS §13)
key-files:
  created:
    - crates/bestialitty-core/tests/slide_sender.rs
  modified:
    - crates/bestialitty-core/src/slide/framer.rs
    - crates/bestialitty-core/src/slide/state.rs
    - crates/bestialitty-core/src/slide/mod.rs
    - crates/bestialitty-core/src/slide/tests_only.rs
    - crates/bestialitty-core/tests/slide_boundary_shape.rs
decisions:
  - Plan 09-01 implements CONTEXT D-08 through D-12 verbatim; sender SM extends receiver SM in-place via role gate, no parallel struct
  - OUTBOUND_RESERVE grown 16 -> 4128 (4 frames * 1030 + 8 byte slack) — receiver-side stable-pointer test continues to pass
  - SlideState variants NOT renumbered (D-10) — JS-side STATE_* constants in transport/slide.js remain pinned
  - build_frame_into placed as a free pub fn in framer module (NOT inside impl Framer) because it doesn't need framer state
  - Sender retry budget: matches slide-rs (no upper bound) per CONTEXT Claude's Discretion §"Sender retry budget"; SEND_NAK_BUDGET deferred to Phase 12 hardening
  - Mock receiver bot uses awaiting_retransmit latch (mirror of slide-rs/recv.rs window-rewind) — silently drops post-NAK frames until sender retransmits the requested seq
metrics:
  duration: 9min
  completed: 2026-05-08
  tasks_completed: 3
  commits: 4 (1 RED + 1 GREEN + 1 GREEN + 1 GREEN)
  files_changed: 5 (4 modified + 1 created)
  tests_added: 17 (3 boundary-shape + 8 sender SM unit + 6 sender corpus)
---

# Phase 9 Plan 01: Rust Sender SM Core Summary

**One-liner:** Phase 9's load-bearing Rust correctness gate — sender state machine on `slide::Slide`, frame-builder helper, three new EVT_* constants, OUTBOUND_RESERVE growth, and a 6-test end-to-end corpus that proves byte-identical round-trip against an in-process mock receiver before any JS plumbing lands.

## What Shipped

### 1. New EVT_* constants + frame builder helper (Task 1)

Three new packed-u32 event constants in `crates/bestialitty-core/src/slide/framer.rs`, extending the Phase 7 EVT_* namespace at `(kind << 16)`:

```rust
pub const EVT_FILE_COMPLETE:    u32 = 8 << 16;   // aux = file_idx
pub const EVT_SESSION_COMPLETE: u32 = 9 << 16;
pub const EVT_RETRANSMIT_NEEDED: u32 = 10 << 16;  // aux = seq
```

No existing 0..7 values renumbered (CONTEXT D-12). JS-side `STATE_*` / `EVT_*` mirror constants in `www/transport/slide.js` (Plan 09-02) extend in lockstep.

A new free `pub fn build_frame_into(buf, seq, payload)` helper mirrors `slide-rs/protocol.rs:33-44` byte-for-byte. Allocation-free when caller pre-reserves capacity. Used by sender SM's `feed_send_chunk` and `push_header_frame`.

Re-exported via `slide::mod.rs` and `slide::tests_only` for use by the integration corpus.

### 2. Sender state machine extension (Task 2)

`crates/bestialitty-core/src/slide/state.rs`:

- **OUTBOUND_RESERVE 16 -> 4128 bytes** (4 max-size frames at 1030 bytes each + 8 bytes slack). Receiver-side `outbound_ptr_stable_across_feed_byte` test continues to pass; new `outbound_ptr_stable_across_sender_window_pushes` test proves no reallocation across 4 max-size sender frames.
- **`SendCtx` struct + `FileMeta`** — module-private. Slide.send_ctx is `None` for receiver-mode sessions; populated by `enter_send_mode`.
- **`pub fn enter_send_mode(metadata: &[u8])`** parses CONTEXT D-09 LE blob (`<u32 file_count><for each file: u32 name_len, name bytes, u32 size>`), sets `role = Sender`, pushes CTRL_RDY, transitions Idle -> WaitingRdy.
- **`pub fn feed_send_chunk(payload: &[u8], eof: bool)`** — JS feeds payload chunks; Rust builds frames via `build_frame_into` and pushes EOF marker on `eof=true`.
- **Sender role gate** at top of `handle_framer_event` after the existing CAN-echo clause. Receiver path runs unchanged below the gate.
- **Sender SM transitions per CONTEXT D-11:**
  - WaitingRdy + EVT_RDY -> push header for files[0] -> HeaderPhase
  - HeaderPhase + EVT_ACK(0) -> DataPhase (or EOF fast-path if size=0, SLIDE-21)
  - DataPhase + EVT_ACK(eof_seq) -> EVT_FILE_COMPLETE + next file or CTRL_FIN -> FinPending
  - DataPhase + EVT_NAK(seq) -> EVT_RETRANSMIT_NEEDED | seq into ring
  - FinPending + EVT_FIN -> EVT_SESSION_COMPLETE -> Done
- **D-19 / ADR-003 bidirectional CAN echo** — sender benefits from the existing pre-gate CAN-echo clause; no duplication.

Boundary-shape pin: `tests/slide_boundary_shape.rs` extended with `slide_send_methods_have_stable_signatures` (fn-pointer coercion of `enter_send_mode` and `feed_send_chunk`) and a sender API runtime reachability check inside `slide_runtime_calls_compile_against_external_surface`.

### 3. End-to-end sender corpus (Task 3)

NEW `crates/bestialitty-core/tests/slide_sender.rs` with 6 tests:

1. `end_to_end_single_file` — 3 KB pseudo-random (xorshift32, fixed seed 0xdeadbeef) via multi-frame sliding window; **Phase 9 SC#5 byte-identical round-trip — load-bearing acceptance gate**.
2. `end_to_end_multi_file` — 2 files (800 + 1500 bytes), per-file ACK + FIN exchange; both arrive byte-identical.
3. `end_to_end_zero_byte_file` — SLIDE-21 empty-file fast path.
4. `nak_triggers_retransmit` — bot NAKs first data frame and silently drops follow-on frames until sender retransmits seq=1; final round-trip is byte-identical.
5. `mid_send_can_echoes_and_aborts` — D-19 / ADR-003 sender-side bidirectional CAN echo.
6. `fin_after_all_files_acks_session_complete` — FIN exchange transitions to Done; EVT_SESSION_COMPLETE reaches the event ring.

The mock receiver bot is **intentionally a parallel reimplementation** of slide-rs/recv.rs per PITFALLS §13 — no production framer is imported, so SLIDE protocol drift cannot mask itself in a sympathetic mock peer.

## Verification Results

| Command | Result |
|---------|--------|
| `cargo test --workspace` | 165 + 20 + 5 + 3 + 8 + 11 + 6 + 13 + 6 + 8 + 8 + 4 = **257 tests, all green** |
| `cargo test --test slide_sender` | **6/6 green** |
| `cargo test --test slide_sender end_to_end_single_file` | **green** (Phase 9 SC#5 load-bearing) |
| `cargo test --test slide_boundary_shape` | **11/11 green** (8 prior + 3 new pins) |
| `cargo test --test core_02_no_browser_deps` | **3/3 green** (no `std::time` / `web_sys` / `js_sys` introduced) |
| `cargo test -p bestialitty-core --lib slide::state::tests` | **24/24 green** (16 receiver + 8 sender) |

**Test delta:** +17 new tests across 3 files (3 boundary-shape pins + 8 sender SM unit + 6 sender corpus integration).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan asserted header frame total length = 17 bytes**
- **Found during:** Task 2 — sender_handshake_ships_header_after_rdy_echo test
- **Issue:** Plan said `assert_eq!(buf.len(), 17)` for a header with payload_len=10, but actual frame is SOF(1) + SEQ(1) + LEN_H(1) + LEN_L(1) + payload(10) + CRC_H(1) + CRC_L(1) = 16 bytes. Plan double-counted one byte.
- **Fix:** Updated test assertion to 16 with explicit layout comment.
- **File modified:** `crates/bestialitty-core/src/slide/state.rs` (test body)
- **Commit:** `2ef5ddd`

**2. [Rule 1 - Bug] Plan asserted build_frame_into output for 1024-byte payload = 1031 bytes**
- **Found during:** Task 1 — build_frame_into_preserves_reserved_capacity_for_max_payload
- **Issue:** Same off-by-one as #1: 4 (header) + 1024 (payload) + 2 (CRC) = 1030 bytes, not 1031. The plan's comment "FRAME_SIZE+7 = 1031" double-counted one of the header bytes.
- **Fix:** Updated test assertion to 1030 with explicit layout comment. OUTBOUND_RESERVE = 4128 still fits 4 frames + slack (4 × 1030 = 4120, plus 8 bytes slack).
- **File modified:** `crates/bestialitty-core/tests/slide_boundary_shape.rs` (test body)
- **Commit:** `26d87c8`

**3. [Rule 3 - Blocker] Plan match arms used bare `(SlideState::WaitingRdy, EVT_RDY)` patterns**
- **Found during:** Task 2 — adding sender role gate in handle_framer_event
- **Issue:** EVT_RDY is a non-const expression (`1 << 16`), not a constant pattern, so it cannot appear bare in a match arm. The plan-as-written would not compile with stable Rust. (Existing receiver code uses guarded arms `if e & 0xFFFF_0000 == EVT_DATA_FRAME`.)
- **Fix:** Switched all sender role gate match arms to guarded patterns: `(state, k) if k == EVT_RDY => ...`. Semantically equivalent, compiles cleanly.
- **File modified:** `crates/bestialitty-core/src/slide/state.rs` (handle_framer_event)
- **Commit:** `2ef5ddd`

**4. [Rule 1 - Bug] nak_triggers_retransmit hit "index out of bounds"**
- **Found during:** Task 3 — first run of slide_sender test corpus
- **Issue:** Mock bot was injecting NAK on seq=1 but then silently letting the follow-on EOF frame (seq=2) through with a normal ACK. The sender then treated the file as complete, advanced `current_file` to 1 (beyond the single-file `file_payloads` bound), and the test driver panicked.
- **Fix:** Added an `awaiting_retransmit: Option<u8>` latch on the mock bot mirroring slide-rs/recv.rs window-rewind semantics: after NAK, the bot drops further frames until the sender retransmits the requested seq. This makes the bot a more faithful reference implementation of the SLIDE protocol's NAK behaviour.
- **File modified:** `crates/bestialitty-core/tests/slide_sender.rs` (MockReceiver fields + handle_frame logic)
- **Commit:** `a751b5e`

### Auth Gates

None.

## Architectural Compliance

- **No `std::time`** — sender SM is purely event-driven; retransmit budget by count (none in Phase 9 per CONTEXT Claude's Discretion §"Sender retry budget"), JS owns timeouts. `core_02_no_browser_deps.rs` invariant green.
- **No `wasm_bindgen` / `web_sys` / `js_sys` in `slide/`** — Phase 8/9 wasm wrapping lives in `lib.rs:wasm_boundary` only (ADR-002). Plan 09-02 will add the `enter_send_mode` / `feed_send_chunk` forwards; this plan ships the inner-API only.
- **Stable-pointer discipline preserved** — OUTBOUND_RESERVE = 4128 absorbs the 4-frame sliding window without Vec realloc. New `outbound_ptr_stable_across_sender_window_pushes` test proves it; existing receiver-side `outbound_ptr_stable_across_feed_byte` test continues to pass.

## Plan 09-02 Unblocked

Plan 09-02 (wasm façade `enter_send_mode` / `feed_send_chunk` + JS dispatcher `'send'` mode branch + `writeSlideFrameAwaitable`) can now begin. The wasm façade in `lib.rs:wasm_boundary` will add one-line forwards into the now-available inner APIs. The JS-side `OUTBOUND_VIEW_CAP` constant in `www/transport/slide.js` MUST grow to 4128 in lockstep with this plan's `OUTBOUND_RESERVE` change.

## Commits

- `b050b1f` — test(09-01): add failing pin tests for new EVT_* constants and build_frame_into (RED)
- `26d87c8` — feat(09-01): add EVT_FILE_COMPLETE/EVT_SESSION_COMPLETE/EVT_RETRANSMIT_NEEDED + build_frame_into (GREEN)
- `2ef5ddd` — feat(09-01): extend slide::Slide with sender state machine (Task 2 GREEN, includes 8 sender SM unit tests + boundary-shape extension)
- `a751b5e` — test(09-01): end-to-end sender corpus against in-process mock receiver bot (Task 3, 6 integration tests)

## Self-Check: PASSED

- File `crates/bestialitty-core/tests/slide_sender.rs` exists (verified)
- 6 #[test] markers present (verified via grep)
- All commits in `git log --oneline -10` (verified)
- `cargo test --workspace` exits 0 (verified)
- `cargo test --test slide_sender end_to_end_single_file` exits 0 — Phase 9 SC#5 byte-identical round-trip proven natively (verified)
- `cargo test --test core_02_no_browser_deps` exits 0 — no `std::time` / `web_sys` / `js_sys` / `wasm_bindgen` introduced (verified)
- All acceptance-criteria grep checks pass (verified)
