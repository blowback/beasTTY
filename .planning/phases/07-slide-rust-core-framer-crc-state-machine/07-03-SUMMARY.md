---
phase: 07-slide-rust-core-framer-crc-state-machine
plan: 03
subsystem: rust-core
tags: [slide, state-machine, receiver, cancel, sliding-window, packed-events, stable-pointer]

# Dependency graph
requires:
  - phase: 07-slide-rust-core-framer-crc-state-machine (Plan 07-02)
    provides: pub Framer DFA + EVT_*/CTRL_* constants + tests_only fixture corpus + thin pub fn crc16_ccitt wrapper
  - phase: 07-slide-rust-core-framer-crc-state-machine (Plan 07-01)
    provides: pub(crate) crc16_ccitt + slide module skeleton + lib.rs pub mod slide
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: terminal.rs Terminal struct shape + host_reply pre-reserved buffer pattern (D-17 stable-pointer); D-15 silent-discard policy; D-20 cross-target reuse
provides:
  - "crates/bestialitty-core/src/slide/state.rs — pub Slide struct + pub SlideState (8 #[repr(u32)] variants) + pub SlideRole + receiver SM transition table + cancel()/force_idle() D-06 APIs + 16 unit tests"
  - "crates/bestialitty-core/src/slide/tests.rs — 5 module-level integration smokes exercising the public Slide API end-to-end"
  - "Top-level slide module re-exports: slide::Slide / slide::SlideState / slide::EVT_* (Phase 8 wasm boundary surface)"
  - "Stable-pointer outbound_buf accessor triple (outbound_ptr/outbound_len/clear_outbound) — Phase 8 wraps via wasm-bindgen"
  - "Internal handle_framer_event SM driver covering RESEARCH §Receiver SM transitions verbatim (RDY/header-ACK/per-window-ACK/seq-mismatch-NAK/EOF-loop/FIN-echo/NAK-budget/CAN-bidirectional)"
affects: [07-04-integration-tests-and-boundary-pin, 07-05-adr, 08-wasm-boundary, 09-sender, 10-receiver-cancellation, 11-js-bridge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Receiver-only SM scope (RESEARCH §SM Scope Recommendation): receiver exercises every SLIDE control byte without a peer, satisfying SLIDE-04 success criterion 4; sender SM deferred to Phase 9 because it has no testable surface without a peer"
    - "Packed-u32 event match arms with high-16-bit guard: (state, e) if e & 0xFFFF_0000 == EVT_KIND => ... — required for events that carry aux (EVT_DATA_FRAME | seq, EVT_CRC_ERROR | seq, EVT_ACK | seq, EVT_NAK | seq); aux-free events (EVT_RDY/EVT_FIN/EVT_CAN) match by exact equality"
    - "Stable-pointer mirror of D-17: outbound_buf pre-reserved 16 bytes (OUTBOUND_RESERVE); Vec::clear preserves capacity; outbound_ptr stable across feed_byte calls in steady state — Phase 8 wraps the triple"
    - "VecDeque event ring (32 entries) drained by JS via take_event_packed — RESEARCH §State Machine Event Surface hybrid recommendation (per-call return + multi-event drain)"
    - "Idempotent cancel API: matches!(state, CancelPending|Done|Error) early-return — D-06 contract verified by cancel_idempotent test"
    - "Silent drain in CancelPending: feed_byte short-circuits non-CAN bytes to EVT_NONE — D-07 contract verified by cancel_pending_silent_drains_non_can_bytes test"
    - "Strict bidirectional CAN echo: peer-initiated EVT_CAN from any non-Done/Error/CancelPending state pushes CTRL_CAN to outbound and transitions to CancelPending — D-05 contract verified by peer_can_during_data_phase_echoes_and_transitions test"

key-files:
  created:
    - "crates/bestialitty-core/src/slide/state.rs (Slide struct + SlideState + SlideRole + receiver SM + 16 unit tests)"
    - "crates/bestialitty-core/src/slide/tests.rs (5 module-level integration smokes for the public Slide API)"
  modified:
    - "crates/bestialitty-core/src/slide/mod.rs (declared pub mod state; + #[cfg(test)] mod tests; + top-level pub use re-exports)"
    - "crates/bestialitty-core/src/slide/tests_only.rs (added pub use crate::slide::state::{Slide, SlideRole, SlideState})"

key-decisions:
  - "Receiver-only SM scope per RESEARCH §SM Scope Recommendation lines 728-779: receiver exercises every SLIDE control byte (RDY/ACK/NAK/CAN/FIN/CTRL_FIN); sender SM has no testable surface without a peer and is deferred to Phase 9. SLIDE-04 success criterion 4 (sliding-window state machine handles RDY/ACK/NAK/CAN/FIN/CTRL_FIN per SLIDE v0.2 plus the v0.2.1 CAN-bidirectional amendment; cancellation and idempotent re-entry are exercised in unit tests) is satisfied by the receiver SM."
  - "Hybrid event surface per RESEARCH §State Machine Event Surface: feed_byte returns packed-u32 + feed_chunk returns event count + take_event_packed ring drain. JS gets both per-call event polling and multi-event drain after chunked feeds — no policy choice imposed on the wasm boundary."
  - "EVT_ACK and EVT_NAK NOT imported in state.rs's `use super::framer::{...}` line. The receiver SM only EMITS ACK/NAK as outbound bytes (via CTRL_ACK/CTRL_NAK); it never matches inbound EVT_ACK/EVT_NAK events because the peer is the one sending data (peer-as-sender model). Phase 9's sender SM will re-add these imports when it lands."
  - "Packed-u32 events with aux MUST use guard pattern in match arms: (state, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME (and same for EVT_CRC_ERROR). Without the guard, the arm only matches the bare event constant (e.g. EVT_CRC_ERROR = 0x70000) and never fires for the real wire event (EVT_CRC_ERROR | seq = 0x70001, 0x70002, ...). NAK-budget exhaustion test caught this auto-fixed bug."
  - "Top-level slide module re-exports via pub use state::{Slide, SlideState, SlideRole} + pub use framer::{EVT_*}: callers write slide::Slide and slide::EVT_RDY instead of slide::state::Slide and slide::framer::EVT_RDY. Mirror of lib.rs:16-21 top-level shape."
  - "CTRL_CAN is a raw single byte (0x18), NOT a wrapped frame. RESEARCH §CTRL_CAN Wire Format Resolution lines 698-725 resolved this from slide-rs/protocol.rs; ADR-003 (Plan 07-05) will document formally. Both cancel() and the peer-CAN echo arm push the single byte CTRL_CAN to outbound_buf."
  - "force_idle transitions to Done (NOT Idle): the session is over either way; JS constructs a new Slide for the next session. Aligns with the no-time-in-Rust invariant — JS owns the ~2 s no-echo timeout that triggers force_idle."

patterns-established:
  - "Receiver SM transition driver shape: handle_framer_event(evt: u32) inspects high 16 bits as kind and low 16 bits as aux (typically seq); match (sm_state, evt) dispatches with aux-carrying events guarded by `e & 0xFFFF_0000 == EVT_KIND`. Mirror in Phase 9 sender SM."
  - "Pre-construction Slide -> enter_recv_mode -> feed_byte loop: tests construct via fn s_recv() helper (mirrors terminal.rs:435-473 fn t() helper). Phase 8 dispatcher will follow the same shape from JS."
  - "Module-level integration smokes co-located with per-module unit tests: slide/tests.rs exercises only the public Slide API surface (no internal access); per-module #[cfg(test)] blocks in crc/framer/state cover transition-level behaviour. RESEARCH §Wave 0 Gaps requires ≥5 module-level smokes — 5 shipped."
  - "Cumulative mod.rs edits across same-plan tasks: Task 1 added pub mod state; + re-exports; Task 2 added only #[cfg(test)] mod tests; — no churn on the surface declarations."

requirements-completed: [SLIDE-01, SLIDE-04]

# Metrics
duration: 6min
completed: 2026-05-06
---

# Phase 7 Plan 03: SLIDE Receiver State Machine Summary

**Slide struct + SlideState (8 #[repr(u32)] variants) + receiver SM driving framer events (RDY/header-ACK/per-window-ACK/EOF-loop/FIN-echo/NAK-budget/strict-bidirectional-CAN) + idempotent cancel/force_idle APIs (D-05/D-06/D-07) + stable-pointer outbound_buf — 21 tests green (16 unit + 5 smoke).**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-06T23:16:15Z
- **Completed:** 2026-05-06T23:22:24Z
- **Tasks:** 2 (Task 1 TDD: RED + GREEN + auto-fix bundled into GREEN; Task 2 single commit)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `crates/bestialitty-core/src/slide/state.rs` ships `pub struct Slide` with the receiver SM, `pub enum SlideState` (8 variants: Idle/WaitingRdy/HeaderPhase/DataPhase/FinPending/CancelPending/Done/Error, `#[repr(u32)]` for Phase 8 wasm boundary), and `pub enum SlideRole` (Receiver/Sender — Phase 7 only constructs Receiver via `enter_recv_mode()`)
- Receiver SM transitions verbatim from RESEARCH §Receiver SM transitions (lines 624-648): WaitingRdy + EVT_RDY → HeaderPhase echoing CTRL_RDY; HeaderPhase + EVT_DATA_FRAME(seq=0) → DataPhase echoing [CTRL_ACK, 0x00]; DataPhase + per-window ACK at WIN_SIZE=4 frames; DataPhase + seq-mismatch → NAK with expected_seq; DataPhase + zero-payload data frame → EOF: ACK + loop to HeaderPhase; HeaderPhase + EVT_FIN → Done echoing CTRL_FIN; EVT_CRC_ERROR drives nak_retry_count bounded at NAK_BUDGET=15 → Error on 16th
- D-05 strict bidirectional CAN echo: peer-initiated EVT_CAN from any non-Done/Error/CancelPending state pushes CTRL_CAN to outbound and transitions to CancelPending. D-06 idempotent `cancel()`: subsequent calls in CancelPending/Done/Error are no-ops. D-06 `force_idle()` escape hatch: any state → Done with outbound cleared. D-07 silent drain: in CancelPending, non-CAN bytes silently consumed (no events emitted)
- Stable-pointer outbound_buf accessor triple: pre-reserved 16 bytes (OUTBOUND_RESERVE = RDY+ACK+seq+NAK+seq+CAN+FIN ≤ 7 bytes + 9 bytes headroom); `outbound_ptr`/`outbound_len`/`clear_outbound` mirror terminal.rs:107-123 host_reply pattern; D-17 invariant verified by `outbound_ptr_stable_across_feed_byte` test
- Hybrid event surface: `feed_byte` returns the most recent packed-u32 event (or EVT_NONE); `feed_chunk` returns event count drained into a 32-entry VecDeque ring; `take_event_packed` drains one event at a time from the ring (returns EVT_NONE when empty). Phase 8's wasm wrapper exposes both per-byte and ring-drain entry points cleanly
- 16 unit tests in `slide::state::tests` cover every transition row in RESEARCH §Receiver SM transitions: construction, enter_recv_mode, RDY echo, header ACK seq=0, per-window ACK at WIN_SIZE=4 (only one ACK after seq=4, none for 1/2/3), seq mismatch NAK with expected_seq, EOF loop to HeaderPhase, FIN echo + Done, NAK budget exhaustion (15 retries → Error on 16th), idempotent cancel, peer-CAN echo, force_idle to Done, silent drain in CancelPending, CancelPending + CAN → Done, stable-pointer invariant
- 5 module-level integration smokes in `slide::tests` exercise the public Slide API end-to-end: full session (RDY → header → EOF → loop → FIN), feed_chunk event count + ring drain, cancel+peer-echo round-trip, garbage-in-Idle silent discard, force_idle clears outbound
- Whole crate: 210 tests pass (157 lib + 53 integration). Up from 189 baseline = +21 new tests (16 state unit + 5 module smokes)
- `core_02_no_browser_deps.rs` invariant remains 3/3 green; the new `slide/state.rs` and `slide/tests.rs` contain no `wasm_bindgen` / `web_sys` / `js_sys` / `std::time` references
- Native build (`cargo build --target x86_64-unknown-linux-gnu`) succeeds with zero warnings

## Task Commits

Each task committed atomically following the TDD RED/GREEN cycle for Task 1:

1. **Task 1 RED: failing receiver SM tests for Slide struct** — `6f21100` (test)
   - slide/state.rs stub with full Slide + SlideState API surface but no-op SM (feed_byte returns EVT_NONE; cancel pushes CTRL_CAN but is not idempotent; enter_recv_mode does not transition; force_idle does nothing)
   - mod.rs declares pub mod state; + top-level pub use re-exports
   - tests_only.rs widens Slide/SlideState/SlideRole for integration tests
   - 13 of 16 tests fail; the 3 passing tests (new_constructs_in_idle, outbound_ptr_is_non_null_at_construction, outbound_ptr_stable_across_feed_byte) only exercise construction-time invariants which the stub satisfies via Vec::with_capacity discipline. Both unexpected passes are explainable and OK
2. **Task 1 GREEN: receiver SM with cancel + force_idle** — `8c3237a` (feat)
   - state.rs's stub bodies replaced with the full receiver SM transition driver
   - All 16 unit tests pass; auto-fix on the EVT_CRC_ERROR match arms required during GREEN (see Deviations)
3. **Task 2: module-level integration smokes** — `22a38dc` (test)
   - slide/tests.rs created with 5 module-level smokes
   - mod.rs declares #[cfg(test)] mod tests; (cumulative on Task 1)
   - Auto-fix removed unused `use super::*;` (super::tests_only::* re-exports everything needed)

REFACTOR phase skipped: implementation is direct and idiomatic; the cumulative GREEN replacements are tightly scoped to the SM driver body.

## Files Created/Modified

- **`crates/bestialitty-core/src/slide/state.rs`** (created, 396 lines) — `pub struct Slide` + `pub enum SlideState` (8 variants `#[repr(u32)]`) + `pub enum SlideRole` + receiver SM transition driver (handle_framer_event) + cancel/force_idle/feed_byte/feed_chunk/take_event_packed/state/outbound_ptr/outbound_len/clear_outbound public surface + 16 unit tests in #[cfg(test)] mod tests
- **`crates/bestialitty-core/src/slide/tests.rs`** (created, 84 lines) — 5 module-level integration smokes for the public Slide API
- **`crates/bestialitty-core/src/slide/mod.rs`** (modified) — added `pub mod state;`, `#[cfg(test)] mod tests;`, and top-level pub use re-exports for `Slide`/`SlideState`/`SlideRole` and the framer event constants
- **`crates/bestialitty-core/src/slide/tests_only.rs`** (modified) — added `pub use crate::slide::state::{Slide, SlideRole, SlideState}` so integration tests in tests/slide_*.rs can reach the Slide types via a single `use ::tests_only::*;`

## Decisions Made

- **Receiver-only SM scope.** RESEARCH §SM Scope Recommendation lines 728-779 documents that the receiver SM exercises every SLIDE control byte (RDY/ACK/NAK/CAN/FIN/CTRL_FIN) and so satisfies SLIDE-04 success criterion 4 by itself; the sender SM has no testable surface without a peer (every sender action is "send a byte and wait for the receiver to respond" — no observable state changes) and is deferred to Phase 9 where the JS sender driver provides the testable surface. SlideRole::Sender is reserved as a no-op variant; Phase 9 will add `enter_send_mode(metadata)`.
- **Hybrid event surface.** RESEARCH §State Machine Event Surface hybrid recommendation: `feed_byte` returns the most recent packed-u32 event (per-call) AND events are pushed into a 32-entry VecDeque ring that JS drains via `take_event_packed`. `feed_chunk` returns the event count for the chunk. JS gets both polling and drain shapes — no policy choice imposed on Phase 8's wasm boundary.
- **EVT_ACK / EVT_NAK NOT imported in state.rs.** The receiver SM only EMITS ACK/NAK as outbound bytes (via CTRL_ACK/CTRL_NAK constants); it never matches inbound EVT_ACK/EVT_NAK events because the peer is the one sending data (peer-as-sender model — RESEARCH §Receiver SM transitions). Phase 9's sender SM will re-add these imports. The plan's negative acceptance criterion (`File ... does NOT contain the literal string \`EVT_ACK,\``) verifies this discipline.
- **Top-level slide module re-exports.** `pub use state::{Slide, SlideState, SlideRole}` + `pub use framer::{EVT_*}` so callers write `slide::Slide` instead of `slide::state::Slide`. Mirror of lib.rs:16-21 top-level shape; Phase 8's `#[wasm_bindgen]` wrapper consumes the top-level surface without crossing into the `state` submodule path.
- **`#[allow(dead_code)]` on `role` field.** Phase 7 only constructs `Receiver`; the `Sender` variant exists in the enum but is never assigned. Without the allow, the compiler warns about the never-read field. Phase 9 wires sender mode and the allow can be removed there. Justification mirrors Plan 07-01's transient `#[allow(dead_code)]` on `crc16_ccitt` (removed by Plan 07-02 once the framer wired the call site).
- **Force_idle transitions to Done, not Idle.** The session is over either way; JS constructs a new Slide for the next session. Aligns with the no-time-in-Rust invariant — JS owns the ~2 s no-echo timeout that triggers force_idle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] EVT_CRC_ERROR match arms missed packed-u32 aux pattern**

- **Found during:** Task 1 GREEN (running `cargo test slide::state::tests` after the SM driver lands)
- **Issue:** The plan-as-written used bare match patterns `(SlideState::HeaderPhase, EVT_CRC_ERROR)` and `(SlideState::DataPhase, EVT_CRC_ERROR)` for the CRC-error transitions. But the framer emits `EVT_CRC_ERROR | seq` (e.g. `0x70001` for seq=1), NOT bare `EVT_CRC_ERROR = 0x70000`. The bare match never fires; the SM never increments `nak_retry_count`; the NAK budget never exhausts; `nak_budget_exhaustion_transitions_to_error` test fails (state stays at DataPhase=3 instead of transitioning to Error=7). Same packed-event guard pattern that the plan correctly applied for `EVT_DATA_FRAME` arms (`(state, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME =>`) was missing for `EVT_CRC_ERROR`.
- **Fix:** Replaced both `(state, EVT_CRC_ERROR)` arms with `(state, e) if e & 0xFFFF_0000 == EVT_CRC_ERROR =>`. The other event constants in the match (EVT_RDY, EVT_FIN, EVT_CAN) are aux-free per the framer (`CTRL_RDY => EVT_RDY` with no `| seq` OR), so bare equality is correct for those — verified by reading framer.rs:97-99.
- **Files modified:** `crates/bestialitty-core/src/slide/state.rs`
- **Verification:** `cargo test -p bestialitty-core slide::state::tests --lib` 16/16 green; `nak_budget_exhaustion_transitions_to_error` now correctly transitions to Error after 16 CRC-error frames.
- **Committed in:** `8c3237a` (Task 1 GREEN; the bug was introduced in the same commit and fixed before commit)

**2. [Rule 1 - Bug] Removed unused `use super::*;` in slide/tests.rs**

- **Found during:** Task 2 (running `cargo test slide::tests` after creating slide/tests.rs)
- **Issue:** The plan's `tests.rs` source had both `use super::*;` and `use super::tests_only::*;`. Since `tests_only::*` already re-exports `Slide`, `SlideState`, and the framer event/control constants (Plan 07-02 GREEN added the framer surface re-exports; Task 1 RED of this plan added the Slide re-exports), `super::*` is redundant and triggers a `unused_imports` warning that the plan-as-written's verification command (`cargo build --target x86_64-unknown-linux-gnu` produces zero `unused_imports` warnings) would catch.
- **Fix:** Dropped `use super::*;` from `slide/tests.rs`. The 5 smoke tests now reach Slide/SlideState/CTRL_*/EVT_* via the single `use super::tests_only::*;` line.
- **Files modified:** `crates/bestialitty-core/src/slide/tests.rs`
- **Verification:** `cargo build --target x86_64-unknown-linux-gnu` produces zero warnings; all 5 smoke tests still pass.
- **Committed in:** `22a38dc` (Task 2 commit; same-commit fix-before-commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bug)
**Impact on plan:** Both fixes are tightly bounded — fix #1 changed two match-arm patterns to add the same guard that the plan correctly used elsewhere; fix #2 dropped one unused `use` statement. Neither expanded scope nor altered the plan's intended functional behaviour. The bugs were both author-side oversights in the plan-as-written and were caught by the test gauntlet.

## TDD Gate Compliance

Task 1 followed the TDD RED/GREEN cycle as specified by `tdd="true"` in the plan frontmatter:

- **RED gate** (`6f21100`, `test(07-03)`): slide/state.rs lands with stub SM bodies; 13 of 16 unit tests fail as expected. The 3 unexpected passes (new_constructs_in_idle, outbound_ptr_is_non_null_at_construction, outbound_ptr_stable_across_feed_byte) only exercise construction-time invariants (state == Idle, outbound_len == 0, outbound_ptr non-null and stable when no pushes happen) — these properties hold by Vec::with_capacity discipline regardless of SM logic. Each unexpected pass is verified to test what it claims (not a feature-already-exists situation), so RED is honored.
- **GREEN gate** (`8c3237a`, `feat(07-03)`): real SM driver replaces stub; all 16 tests pass after the EVT_CRC_ERROR auto-fix.
- **REFACTOR gate**: skipped — implementation is direct and idiomatic; the cumulative GREEN replacement is tightly scoped to the SM driver body.

Task 2 was not TDD-flagged in the plan; it shipped as a single test-author commit with the auto-fix bundled before the commit.

The `test(...)` → `feat(...)` ordering for Task 1 is verifiable in `git log --oneline -3`. Plan-level TDD gate compliance: PASSED.

## Issues Encountered

None — both deviations were anticipated by the deviation-rule framework (Rule 1 for plan-as-written bugs caught by the test gauntlet). Both fixes were direct and within scope.

## User Setup Required

None — no external service configuration, no auth gates, no human-action checkpoints. This is a pure-Rust, native-cargo-test plan.

## Next Phase Readiness

**Plan 07-04 (integration tests for torn-chunk + idempotent re-entry + boundary shape) is unblocked.** Plan 07-04 can now:

- Import `bestialitty_core::slide::{Slide, SlideState}` (top-level re-exports) and `slide::tests_only::{FIXTURE_*, CTRL_*}` for fixture-driven tests
- Pin the Phase 8 wasm-boundary surface shape via `tests/slide_boundary_shape.rs` against the EXTERNAL crate path — Slide's full method surface (`new`/`enter_recv_mode`/`feed_byte`/`feed_chunk`/`take_event_packed`/`state`/`cancel`/`force_idle`/`outbound_ptr`/`outbound_len`/`clear_outbound`) is reachable via the public `slide::Slide` path
- Build torn-chunk integration tests that split every fixture at every internal byte boundary and verify equivalent end state — Plan 1 D-15 + this plan's framer DFA shape make this mechanical
- Build idempotent re-entry tests that exercise repeated cancel() calls, force_idle from various states, and cancel-during-cancel scenarios — D-06 contract pinned by this plan's unit tests already

**Plan 07-05 (ADR-003)** is unblocked: ADR-003 can now formally document the implemented v0.2.1 CAN bidirectional behaviour (D-05/D-06/D-07) with cross-references to the unit tests that exercise each rule. The receiver SM is the load-bearing implementation; Phase 9's sender SM will reference ADR-003 when it lands.

**Phase 8 (wasm boundary)** is unblocked at the Slide-shape level: the `Slide` struct + `SlideState` `#[repr(u32)]` enum are mechanical to wrap with `#[wasm_bindgen]`. The stable-pointer outbound_buf accessor triple mirrors the Phase 1 D-17 pattern that lib.rs:33-190 already wraps for Terminal.

**No blockers for downstream plans.** The wasm-free invariant remains green; the new files contain no browser tokens; native build is warning-free.

## Self-Check: PASSED

**File-existence checks** (all FOUND):

- `crates/bestialitty-core/src/slide/state.rs` — FOUND
- `crates/bestialitty-core/src/slide/tests.rs` — FOUND
- `crates/bestialitty-core/src/slide/mod.rs` — FOUND (modified)
- `crates/bestialitty-core/src/slide/tests_only.rs` — FOUND (modified)

**Commit-existence checks** (all FOUND in `git log`):

- `6f21100` — FOUND (Task 1 RED)
- `8c3237a` — FOUND (Task 1 GREEN)
- `22a38dc` — FOUND (Task 2)

**Acceptance-criteria checks** (all PASS):

- state.rs contains `pub struct Slide` — PASS
- state.rs contains `pub enum SlideState` — PASS
- state.rs contains all 8 SlideState variants (Idle, WaitingRdy, HeaderPhase, DataPhase, FinPending, CancelPending, Done, Error) — PASS
- state.rs contains `#[repr(u32)]` — PASS
- state.rs contains `pub fn cancel(&mut self)` and `pub fn force_idle(&mut self)` — PASS
- state.rs contains `pub fn outbound_ptr(&self) -> *const u8` — PASS
- state.rs contains `const NAK_BUDGET: u32 = 15` — PASS
- state.rs contains `const WIN_SIZE: u8 = 4` — PASS
- state.rs's `use super::framer::{...}` import line does NOT contain `EVT_ACK,` or `EVT_NAK,` — PASS (verified by grep on lines 20-24)
- mod.rs contains `pub mod state;` and `pub use state::{Slide, SlideState` — PASS
- mod.rs contains `#[cfg(test)]` and `mod tests;` — PASS
- tests.rs contains `use super::tests_only::*;` and `fn smoke_full_session_rdy_header_eof_fin` — PASS
- `cargo test -p bestialitty-core slide::state --lib` 16/16 — PASS
- `cargo test -p bestialitty-core slide::tests --lib` 5/5 — PASS
- `cargo test -p bestialitty-core slide --lib` 36/36 — PASS
- `cargo test -p bestialitty-core --test slide_reference_corpus` 13/13 — PASS
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` 3/3 — PASS
- `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` exits 0 with zero `unused_imports` warnings — PASS
- `cargo test -p bestialitty-core` whole crate 210/210 — PASS
- state.rs does NOT contain `wasm_bindgen`, `web_sys`, `js_sys`, or `std::time` — PASS

---
*Phase: 07-slide-rust-core-framer-crc-state-machine*
*Completed: 2026-05-06*
