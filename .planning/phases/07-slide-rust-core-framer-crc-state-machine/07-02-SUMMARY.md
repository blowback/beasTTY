---
phase: 07-slide-rust-core-framer-crc-state-machine
plan: 02
subsystem: rust-core
tags: [slide, framer, dfa, crc, fixtures, integration-tests, tests-only-shim]

# Dependency graph
requires:
  - phase: 07-slide-rust-core-framer-crc-state-machine (Plan 07-01)
    provides: pub(crate) crc16_ccitt + slide module skeleton + lib.rs pub mod slide
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: byte-fed DFA shape (vt52.rs Parser + EscYPhase), per-module #[cfg(test)] mod tests style, D-15 silent-discard policy, D-17 stable-pointer pre-reserve discipline, D-20 cross-target reuse
  - phase: 02-wasm-boundary
    provides: integration-vs-in-crate distinction (boundary_api_shape.rs:16-19)
provides:
  - "crates/bestialitty-core/src/slide/framer.rs — pub Framer struct + pub FramerState (8 variants) + pub control bytes + pub packed-u32 events + 12 unit tests"
  - "crates/bestialitty-core/src/slide/tests_only.rs — pub fn crc16_ccitt wrapper + 7 reference fixtures + 5 control-byte fixtures + framer surface re-exports"
  - "crates/bestialitty-core/tests/slide_reference_corpus.rs — 13 integration tests pinning the 7 fixtures, the catalogue vector, the CRC scope discipline, and 3 control-byte transitions"
  - "Removal of transient #[allow(dead_code)] on crc16_ccitt now that the framer wires the call site"
affects: [07-03-receiver-state-machine, 07-04-integration-tests-and-boundary-pin, 07-05-adr, 08-wasm-boundary]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "byte-fed DFA mirroring vt52.rs shape: state-enum-on-struct + per-call (state, byte) match dispatch — torn-chunk safety as a side-effect, not a special case"
    - "packed-u32 events: (kind << 16) | aux — mirrors lib.rs:152-155 cursor_packed; fits cleanly into Phase 8's wasm boundary u32-return convention"
    - "tests_only.rs unconditional pub mod with #[doc(hidden)] — required for cross-integration-test fixture sharing because #[cfg(test)] does not gate visibility for integration tests under tests/"
    - "thin pub fn wrapper for pub(crate) item: tests_only.rs::crc16_ccitt forwards to slide::crc::crc16_ccitt — preserves D-03 framer-only consumer discipline while making the primitive reachable from integration tests"

key-files:
  created:
    - "crates/bestialitty-core/src/slide/framer.rs (Framer DFA + 12 unit tests)"
    - "crates/bestialitty-core/src/slide/tests_only.rs (7 reference fixtures + framer surface re-exports + CRC widening wrapper)"
    - "crates/bestialitty-core/tests/slide_reference_corpus.rs (13 integration tests)"
  modified:
    - "crates/bestialitty-core/src/slide/mod.rs (declared pub mod framer; + pub mod tests_only with #[doc(hidden)])"
    - "crates/bestialitty-core/src/slide/crc.rs (removed transient #[allow(dead_code)] now that framer wires the call site)"

key-decisions:
  - "Framer surface (Framer struct, FramerState enum, EVT_* constants, CTRL_* and SOF byte constants) is pub (NOT pub(crate)) — Phase 8 wasm boundary consumes them via tests/slide_boundary_shape.rs at the EXTERNAL crate path"
  - "CRC primitive in slide/crc.rs stays pub(crate) per D-03 — only sanctioned non-test consumer is the framer; integration tests reach it via slide::tests_only::crc16_ccitt thin wrapper"
  - "tests_only module is unconditionally pub (NOT #[cfg(test)] gated) because integration tests under tests/ compile against the lib in non-test mode and so cannot see #[cfg(test)] modules; #[doc(hidden)] flags it as internal-use-only and Phase 8's #[wasm_bindgen] façade never wraps anything from it"
  - "pub use of a pub(crate) item across the crate boundary fails E0364; use a thin pub fn wrapper that calls the pub(crate) primitive — same end-effect, type-checks cleanly"
  - "FramerState carries SEQ + crc_input_buf accumulator across ReadingPayload steps; CRC scope is built up byte-by-byte in WaitingSeq -> WaitingLenHi -> WaitingLenLo -> ReadingPayload, ending exactly at the byte before WaitingCrcHi (PITFALLS §3 BLOCKING)"
  - "Zero-length payload (LEN=0) short-circuits ReadingPayload directly to WaitingCrcHi — required for FIXTURE_EMPTY_SEQ_0 and FIXTURE_EOF_SEQ_4 fixtures to round-trip"

patterns-established:
  - "Framer DFA shape: 8 FramerState variants with payload-carrying enum data (e.g. WaitingLenLo { seq, len_hi }); transitions happen in a single match per step() call; state persists across calls so torn chunks 'just work'"
  - "tests_only.rs co-location pattern: integration tests under tests/ get a single use bestialitty_core::slide::tests_only::*; that pulls fixtures + framer surface + CRC widening wrapper in one shot"
  - "RED gate for fixture-paste tasks: write the integration test file first (compile-fails because tests_only doesn't exist) — that compile failure IS the RED gate; the GREEN commit creates tests_only.rs and the tests pass"

requirements-completed: [SLIDE-02, SLIDE-03]

# Metrics
duration: 7min
completed: 2026-05-06
---

# Phase 7 Plan 02: SLIDE Framer DFA + Reference Corpus Summary

**Byte-fed DFA framer (8 FramerState variants, packed-u32 events) plus a 7-fixture reference corpus pinned via integration tests at the EXTERNAL crate boundary; CRC scope/byte-order discipline locked in at both module-test and integration-test levels.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-06T23:02:39Z
- **Completed:** 2026-05-06T23:10:07Z
- **Tasks:** 2 (both TDD: 4 commits total — Task 1 RED+GREEN, Task 2 RED+GREEN)
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `crates/bestialitty-core/src/slide/framer.rs` ships a per-byte-fed DFA `Framer` struct with `FramerState` (8 variants), 6 wire control-byte constants (SOF + CTRL_FIN/ACK/RDY/NAK/CAN), and 8 packed-u32 event constants (EVT_NONE/RDY/ACK/NAK/FIN/CAN/DATA_FRAME/CRC_ERROR)
- 12 unit tests in `slide::framer::tests` cover every transition row in RESEARCH §State Machine: SOF advance, RDY/FIN/CAN emission, ACK/NAK + seq, garbage silent-discard (Phase 1 D-15), full-frame round-trip, zero-length-payload edge case, CRC scope (excludes SOF), CRC big-endian wire order (LE-swap emits CRC_ERROR), CRC payload bit-flip detection
- `crates/bestialitty-core/src/slide/tests_only.rs` ships the 7 RESEARCH §Test Corpus fixtures (FIXTURE_HEADER_TEST_TXT, FIXTURE_SUBFRAME_HI, FIXTURE_EMPTY_SEQ_0, FIXTURE_EOF_SEQ_4, FIXTURE_ALL_FF_16, FIXTURE_SLIDE_RS_HELLO, fixture_max_payload_aa() ctor) + 5 control-byte fixtures + `pub fn crc16_ccitt` thin wrapper that widens `pub(crate) -> pub` for integration tests
- `crates/bestialitty-core/tests/slide_reference_corpus.rs` exercises all 7 fixtures + the catalogue vector + the CRC-scope pin + 3 control-byte transitions in 13 integration tests at the EXTERNAL crate boundary
- The transient `#[allow(dead_code)]` on `crc16_ccitt` is removed — the framer's `WaitingCrcLo` arm now wires the call site (Plan 07-01 SUMMARY explicitly directed this removal)
- Whole crate: 189 tests pass (15 slide-lib + 13 slide_reference_corpus + 161 pre-existing); 164 → 189 = +25 new tests
- `core_02_no_browser_deps.rs` invariant remains 3/3 green; the new files contain no `wasm_bindgen` / `web_sys` / `js_sys` / `std::time`
- Native build (`cargo build --target x86_64-unknown-linux-gnu`) succeeds with zero warnings

## Task Commits

Each task followed the TDD RED/GREEN cycle:

1. **Task 1 RED: failing framer DFA transition tests** — `e972bc8` (test)
   - slide/framer.rs with stub `step()` returning EVT_NONE always; 10 of 12 tests fail as expected
   - 2 tests pass against stub (idle_garbage_silently_discarded — state stays Idle by construction; crc_scope_excludes_sof — exercises only the Plan 07-01 CRC primitive, not the framer); both unexpected passes are explainable and OK
2. **Task 1 GREEN: framer DFA per-byte step + CRC validation** — `4a8b2e4` (feat)
   - Real `step()` impl with full 8-variant FramerState match dispatch; all 12 unit tests pass; transient `#[allow(dead_code)]` removed from crc.rs
3. **Task 2 RED: integration tests added (compile-fails because tests_only does not exist)** — `94b09f7` (test)
   - tests/slide_reference_corpus.rs with 13 #[test] fns importing from bestialitty_core::slide::tests_only::*
   - Compile-failure IS the intended RED gate
4. **Task 2 GREEN: tests_only fixture shim + 7 reference fixtures** — `34194f2` (feat)
   - slide/tests_only.rs created; mod.rs adds `pub mod tests_only;` with `#[doc(hidden)]`; CRC visibility widened via thin wrapper fn (NOT `pub use`, which fails E0364); all 13 integration tests pass

REFACTOR phase skipped on both tasks: the implementations are direct, single-purpose translations of the plan's reference excerpts and do not need cleanup.

## Files Created/Modified

- **`crates/bestialitty-core/src/slide/framer.rs`** (created, 280 lines) — byte-fed DFA `Framer` struct with `FramerState` (8 variants), wire control-byte constants, packed-u32 event constants, single-byte `step()` dispatcher, `take_payload()` accessor, `state()` peek, and 12 unit tests
- **`crates/bestialitty-core/src/slide/tests_only.rs`** (created, 119 lines) — `pub fn crc16_ccitt` wrapper + 6 fixture `pub const` byte arrays + 1 fixture constructor fn + 5 control-byte fixtures + framer surface re-exports
- **`crates/bestialitty-core/tests/slide_reference_corpus.rs`** (created, 104 lines) — 13 integration tests covering 7 fixture round-trips + payload-decode + CRC-scope pin + 3 control-byte transitions + catalogue vector pin
- **`crates/bestialitty-core/src/slide/mod.rs`** (modified) — added `pub mod framer;` and `#[doc(hidden)] pub mod tests_only;` (the latter with a comment explaining the deviation from `#[cfg(test)]`); module-doc gained a bullet for the framer
- **`crates/bestialitty-core/src/slide/crc.rs`** (modified) — removed the transient `#[allow(dead_code)]` on `crc16_ccitt` per Plan 07-01 SUMMARY directive (framer now wires the call site)

## Decisions Made

- **Framer surface visibility is `pub`, not `pub(crate)`.** D-03 scopes `pub(crate)` to the CRC primitive only ("framer-only consumer; no public surface"). The framer's event constants, control bytes, `FramerState`, and `Framer` struct ARE the Phase 8 wasm-boundary surface that Plan 07-04's `tests/slide_boundary_shape.rs` will pin via the EXTERNAL crate path `bestialitty_core::slide::*`. Declaring them `pub` from the start avoids a Phase 8 widening churn.
- **CRC primitive stays `pub(crate)`.** D-03 unchanged. Integration tests reach the primitive via `slide::tests_only::crc16_ccitt` which is a thin `pub fn` wrapper that calls `crate::slide::crc::crc16_ccitt`. Production code never imports from `tests_only`.
- **`tests_only` is unconditionally `pub`** with `#[doc(hidden)]`. The plan specified `#![cfg(test)]` gating but that does not work for integration tests (they compile against the lib in non-test mode, so `cfg(test)`-gated modules are invisible). Without a Cargo feature flag (which would require dev-dependency plumbing), unconditional `pub` is the simplest path; `#[doc(hidden)]` flags intent and Phase 8's `#[wasm_bindgen]` façade never wraps anything from `tests_only`, so production wasm bundles do not surface it.
- **Thin `pub fn` wrapper for `pub(crate)` re-export** — `pub use crate::slide::crc::crc16_ccitt;` fails E0364 ("only public within the crate, and cannot be re-exported outside"). The conventional workaround is a thin wrapper fn: `pub fn crc16_ccitt(data: &[u8]) -> u16 { crate::slide::crc::crc16_ccitt(data) }`. Same end-effect for callers; type-checks cleanly.
- **Zero-length-payload short-circuit.** When `len == 0` in `WaitingLenLo`, transition directly to `WaitingCrcHi` (skip `ReadingPayload` entirely). Required for `FIXTURE_EMPTY_SEQ_0` and `FIXTURE_EOF_SEQ_4` to round-trip; the unit test `zero_length_payload_skips_directly_to_crc` pins this contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `#[cfg(test)]` on `tests_only` does not gate visibility for integration tests; replaced with unconditional `pub mod` + `#[doc(hidden)]`**

- **Found during:** Task 2 (running `cargo test -p bestialitty-core --test slide_reference_corpus` after creating `slide/tests_only.rs` per the plan's `#![cfg(test)]` instruction)
- **Issue:** The plan specified `#![cfg(test)]` on `tests_only.rs` and `#[cfg(test)] pub mod tests_only;` on `mod.rs`, with the rationale that integration tests would see the module via `cfg(test)` widening. This is incorrect: integration tests under `tests/*.rs` compile against the lib in NON-test mode (only the lib's *unit* tests are compiled with `cfg(test)`), so `cfg(test)`-gated modules are invisible to integration tests. Compile-fail: `error[E0432]: unresolved import \`bestialitty_core::slide::tests_only\``.
- **Fix:** Removed `#![cfg(test)]` from the file and the `#[cfg(test)]` from the `pub mod` declaration. Added `#[doc(hidden)]` on the `pub mod tests_only;` line and a multi-paragraph module-doc comment explaining the deviation. Phase 8's `#[wasm_bindgen]` façade never wraps anything from `tests_only`, so production wasm bundles do not surface it; `#[doc(hidden)]` flags it as internal-use-only.
- **Files modified:** `crates/bestialitty-core/src/slide/mod.rs`, `crates/bestialitty-core/src/slide/tests_only.rs`
- **Verification:** `cargo test -p bestialitty-core --test slide_reference_corpus` now compiles and runs (13/13 pass). `core_02_no_browser_deps` still 3/3 green. Whole crate 189/189 green.
- **Committed in:** `34194f2` (Task 2 GREEN commit)

**2. [Rule 3 - Blocking] `pub use crate::slide::crc::crc16_ccitt;` fails E0364 (cannot re-export `pub(crate)` outside crate); replaced with thin `pub fn` wrapper**

- **Found during:** Task 2 (after Fix #1, the next compile error revealed E0364: "`crc16_ccitt` is only public within the crate, and cannot be re-exported outside")
- **Issue:** The plan specified `pub use crate::slide::crc::crc16_ccitt;` in `tests_only.rs` to widen `pub(crate)` to `pub` for tests. But `pub use` of a `pub(crate)` item fails compile because the visibility of the use statement cannot exceed the visibility of the imported item. The plan's `#![cfg(test)]` cover would have allowed it (since within a test build, the `cfg(test)` use statement could see the `pub(crate)` item just fine), but with that gate removed (Fix #1), the underlying limitation surfaced.
- **Fix:** Replaced the `pub use` with a thin `pub fn crc16_ccitt(data: &[u8]) -> u16 { crate::slide::crc::crc16_ccitt(data) }` wrapper. Same end-effect for callers (`crc16_ccitt(b"123456789")` works the same), and type-checks cleanly. The CRC primitive in `slide/crc.rs` itself stays `pub(crate)` per D-03, so the framer-only-consumer discipline is preserved.
- **Files modified:** `crates/bestialitty-core/src/slide/tests_only.rs`
- **Verification:** `cargo test -p bestialitty-core --test slide_reference_corpus reference_vector_123456789` passes (the test calls `crc16_ccitt(b"123456789")` and gets `0x29B1`). All 13 integration tests pass.
- **Committed in:** `34194f2` (Task 2 GREEN commit; Fix #1 and Fix #2 are squashed into the same commit because they are halves of the same root-cause investigation)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking)
**Impact on plan:** Both fixes are infrastructure-level — they preserve every functional intent of the plan (CRC stays `pub(crate)` in its own module; integration tests can reach fixtures via a single `use ::tests_only::*;`). The deviations are purely a correction of the plan author's misunderstanding of how `cfg(test)` interacts with integration tests. No scope creep; both fixes are tightly bounded to a few lines each.

## TDD Gate Compliance

Both Task 1 and Task 2 followed the TDD RED/GREEN/(REFACTOR) cycle as specified by `tdd="true"` in the plan frontmatter:

**Task 1:**
- **RED gate** (`e972bc8`, `test(07-02)`): `slide/framer.rs` lands with stub `step()` returning EVT_NONE; 10 of 12 framer tests fail as expected. 2 tests pass against stub (`idle_garbage_silently_discarded` — stub leaves state at Idle which matches; `crc_scope_excludes_sof` — exercises only the pre-existing CRC primitive, not the framer). Both unexpected passes are explainable (state-by-construction property; pre-existing CRC infrastructure) and do NOT indicate the feature already exists, so RED is honored.
- **GREEN gate** (`4a8b2e4`, `feat(07-02)`): real `step()` impl; all 12 framer tests pass; transient `#[allow(dead_code)]` removed from crc.rs.
- **REFACTOR gate**: skipped — implementation is direct and idiomatic.

**Task 2:**
- **RED gate** (`94b09f7`, `test(07-02)`): `tests/slide_reference_corpus.rs` lands; the integration test crate fails to compile because `bestialitty_core::slide::tests_only` does not exist yet. Compile-failure IS the intended RED gate.
- **GREEN gate** (`34194f2`, `feat(07-02)`): `slide/tests_only.rs` lands with the 7 fixtures + thin wrapper fn; `mod.rs` declares `pub mod tests_only;` with `#[doc(hidden)]`; all 13 integration tests pass.
- **REFACTOR gate**: skipped — fixture content is hand-pasted from RESEARCH §Test Corpus and the wrapper fn is a one-liner.

The `test(...)` → `feat(...)` ordering is verifiable in `git log --oneline -5`. Plan-level TDD gate compliance: PASSED.

## Issues Encountered

None — both deviations were anticipated by the deviation-rule framework (Rule 3 for blocking issues). Both root-caused to the same misunderstanding in the plan-as-written (`cfg(test)` vs integration tests + `pub use` of `pub(crate)`); the fix path was direct.

## User Setup Required

None — no external service configuration, no auth gates, no human-action checkpoints. This is a pure-Rust, native-cargo-test plan.

## Next Phase Readiness

**Plan 07-03 (`Slide` struct + receiver SM) is unblocked.** Plan 07-03 can now:

- Import `crate::slide::framer::{Framer, FramerState, EVT_*, CTRL_*}` from `slide/state.rs`
- Drive a `Framer` instance from inside the `Slide` struct's `feed_byte` / `feed_chunk` entry points
- Trust that EVT_DATA_FRAME / EVT_CRC_ERROR / EVT_RDY / EVT_ACK / EVT_NAK / EVT_FIN / EVT_CAN events arrive correctly framed (12 unit tests + 13 integration tests anchor this)
- Reach the 7 reference fixtures + control-byte fixtures via `slide::tests_only::*` for any cross-fixture state-machine tests

**Plan 07-04 (integration tests + boundary-shape pin)** is also unblocked for fixture reuse: `tests/slide_torn_chunk.rs`, `tests/slide_idempotent_reentry.rs`, and `tests/slide_boundary_shape.rs` can all `use bestialitty_core::slide::tests_only::*;` to access the same fixture corpus with no duplication.

**No blockers for downstream plans.** The wasm-free invariant remains green; the framer surface is shaped to wrap cleanly in Phase 8.

## Self-Check: PASSED

**File-existence checks** (all FOUND):

- `crates/bestialitty-core/src/slide/framer.rs` — FOUND
- `crates/bestialitty-core/src/slide/tests_only.rs` — FOUND
- `crates/bestialitty-core/tests/slide_reference_corpus.rs` — FOUND
- `crates/bestialitty-core/src/slide/mod.rs` — FOUND (modified)
- `crates/bestialitty-core/src/slide/crc.rs` — FOUND (modified)

**Commit-existence checks** (all FOUND in `git log`):

- `e972bc8` — FOUND (Task 1 RED)
- `4a8b2e4` — FOUND (Task 1 GREEN)
- `94b09f7` — FOUND (Task 2 RED)
- `34194f2` — FOUND (Task 2 GREEN)

**Acceptance-criteria checks** (all PASS):

- framer.rs contains `pub enum FramerState` — PASS
- framer.rs contains `pub struct Framer` — PASS
- framer.rs contains `pub const SOF:` and `pub const CTRL_RDY:` (and 4 other control bytes) — PASS
- framer.rs contains `pub const EVT_DATA_FRAME:` — PASS
- framer.rs contains `pub const EVT_` (visibility widening verified) — PASS
- framer.rs does NOT contain `pub(crate) const EVT_` (negative check) — PASS
- framer.rs does NOT contain `pub(crate) enum FramerState` (negative check) — PASS
- framer.rs does NOT contain `pub(crate) struct Framer` (negative check) — PASS
- framer.rs contains `use super::crc::crc16_ccitt;` — PASS
- mod.rs contains `pub mod framer;` — PASS
- mod.rs contains `pub mod tests_only;` (with `#[doc(hidden)]` rather than `#[cfg(test)]` per deviation #1) — PASS (functional equivalent)
- tests_only.rs contains `pub const FIXTURE_SLIDE_RS_HELLO: &[u8] = &[` — PASS
- tests_only.rs contains the 7 fixture identifiers (FIXTURE_HEADER_TEST_TXT, FIXTURE_SUBFRAME_HI, FIXTURE_EMPTY_SEQ_0, FIXTURE_EOF_SEQ_4, FIXTURE_ALL_FF_16, FIXTURE_SLIDE_RS_HELLO, fixture_max_payload_aa) — PASS
- slide_reference_corpus.rs contains `use bestialitty_core::slide::tests_only::*;` — PASS
- `cargo test -p bestialitty-core slide::framer --lib` 12/12 — PASS
- `cargo test -p bestialitty-core slide --lib` 15/15 — PASS
- `cargo test -p bestialitty-core --test slide_reference_corpus` 13/13 — PASS
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` 3/3 — PASS
- `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` exits 0 with no warnings — PASS
- `cargo test -p bestialitty-core` whole crate 189/189 — PASS

---
*Phase: 07-slide-rust-core-framer-crc-state-machine*
*Completed: 2026-05-06*
