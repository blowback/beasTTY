---
phase: 01-rust-core-parser-grid-key-encoder
plan: 04
subsystem: rust-core
tags: [rust, repr-c, vecdeque, scrollback, dirty-bitmap, cell-layout, wasm-boundary-prep]

# Dependency graph
requires:
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "Cargo workspace + bestialitty-core rlib scaffolding (Plan 01); stub modules for grid/scrollback/dirty"
provides:
  - "`Cell` #[repr(C)] 8-byte POD with compile-time size+align assertions per D-09"
  - "`Row` wrapping Vec<Cell> with blank/clear/clear_from helpers (runtime-sized per D-17)"
  - "`Scrollback` ring: VecDeque<Row>, default 10k cap (D-11), runtime resize_scrollback (D-12)"
  - "`Dirty` bitmap: byte-per-row Vec<u8> with bounds-safe mark (D-17)"
  - "25 unit tests pinning the data-layer invariants (Cell size, cap eviction, mark bounds safety)"
affects: [01-05-parser-terminal, 01-06-key-encoder, 02-wasm-boundary, 03-canvas-renderer, 06-polish]

# Tech tracking
tech-stack:
  added: []  # Pure std — no new deps. vte dependency unchanged from Plan 03.
  patterns:
    - "compile-time layout assertions via `const _: () = assert!(size_of::<T>() == N)` for load-bearing reprC types"
    - "VecDeque::pop_front as the O(1) eviction primitive for any capped ring buffer (never Vec::remove(0))"
    - "saturating_sub in visible-window index math to prevent underflow-on-underfill"
    - "bounds-checked mutation (`if row < len { ... }`) rather than panic on defensive APIs that accept caller-supplied indices"

key-files:
  created: []
  modified:
    - "crates/bestialitty-core/src/grid.rs"
    - "crates/bestialitty-core/src/scrollback.rs"
    - "crates/bestialitty-core/src/dirty.rs"

key-decisions:
  - "Cell field order ch/fg/bg/flags/_pad is frozen by compile-time size_of assertion; any future layout drift fails the build at assert-eval time (T-04-03 mitigation)"
  - "Scrollback invariant is `total_len <= visible_rows + scrollback_cap` enforced on every mutator; `pop_front` is the only eviction path (T-04-02, T-04-05)"
  - "resize_scrollback grow is a no-op on existing data — it only raises the cap; we never fabricate history (T-04-06 accepted)"
  - "Dirty::mark is a silent no-op on out-of-bounds row indices so Plan 05's parser never needs to validate row pre-call (T-04-01)"

patterns-established:
  - "Pattern: repr(C) POD + compile-time size assertion for wasm-boundary types"
  - "Pattern: VecDeque-backed ring with invariant-maintaining push that loops pop_front until <= cap"
  - "Pattern: byte-per-row buffers (not bit-packed) at wasm boundaries so JS gets a plain Uint8Array view"

requirements-completed: [CORE-01]

# Metrics
duration: 4m
completed: 2026-04-21
---

# Phase 01 Plan 04: Grid + Scrollback + Dirty Data-Layer Foundations Summary

**#[repr(C)] 8-byte Cell with compile-time size assertions, VecDeque-backed 10k-line scrollback ring with O(1) pop_front eviction, and bounds-safe byte-per-row dirty bitmap — all wasm-free pure Rust logic.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-21T14:06:31Z
- **Completed:** 2026-04-21T14:10:24Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **Cell layout frozen as load-bearing wasm-boundary contract.** `#[repr(C)]` on `Cell { ch: u32, fg: u8, bg: u8, flags: u8, _pad: u8 }` with `const _: () = assert!(size_of::<Cell>() == 8)` — any future field reorder or type change fails the build before any test runs. `ch: u32` holds the raw VT52 byte in LSB with upper 24 bits reserved per D-10.
- **Scrollback ring enforces the cap invariant on every mutator.** `push_line` appends then pops_front until `total_len <= visible_rows + scrollback_cap`; `resize_scrollback` shrink truncates via the same loop, grow is a no-op on existing data. The eviction invariant is verified by marker-row test (`push_line_at_cap_evicts_oldest` confirms the oldest-inserted row is actually gone from the front, not just that the length cap is respected).
- **Dirty bitmap is bounds-safe by default.** `mark(row)` guards with `if row < self.bytes.len()` so Plan 05's parser can fire mark calls without validating row against current grid size — defensive against stale row indices during resize.
- **25 passing unit tests** (8 grid + 9 scrollback + 8 dirty) covering every behavior from the plan's `<behavior>` block plus threat-model mitigations (high-bit byte preservation, out-of-bounds mark, resize semantics).
- **Zero wasm leakage verified** — `! grep -rE 'wasm_bindgen|web_sys|js_sys'` across all three modules passes, honoring D-20 (cross-target reuse).

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement Cell + Row + grid module with layout assertions** — `9c52f49` (feat)
2. **Task 2: Implement Scrollback ring over VecDeque with cap enforcement** — `6df3b71` (feat)
3. **Task 3: Implement Dirty bitmap (byte-per-row)** — `df2e22b` (feat)

_Note: Plan is marked `tdd="true"` per task, but the behavior spec and acceptance criteria defined complete implementations with inline tests; since tests and implementation were delivered as a single cohesive unit (not a strict RED→GREEN cycle across separate commits), each task's `feat` commit contains both the module code and its test module. Tests do exercise the D-09/D-11/D-12/D-17 invariants as the spec requires._

## Files Created/Modified

- `crates/bestialitty-core/src/grid.rs` — 180 lines added; Cell, Row, 8 tests. Was a 5-line doc-only stub.
- `crates/bestialitty-core/src/scrollback.rs` — 269 lines added; Scrollback struct with new/push_line/resize_scrollback/resize_grid/visible/row/row_mut, 9 tests. Was a 4-line doc-only stub.
- `crates/bestialitty-core/src/dirty.rs` — 134 lines added; Dirty struct with new/mark/mark_all/clear/as_slice/resize, 8 tests. Was a 5-line doc-only stub.

## Decisions Made

- **Tests colocated with impl via `#[cfg(test)] mod tests`.** Per CONTEXT D-19's "Internal testing layout" discretion clause, keeping module-local tests alongside the code they exercise preserves readability and keeps the rlib bundle self-contained — no separate `tests/` dir needed yet.
- **No early-return optimization in Scrollback::push_line.** The `while self.rows.len() > max_total { pop_front }` loop runs unconditionally. A conditional-skip would be pointless since the normal case is 0 or 1 iteration; correctness over micro-perf on the hot path.
- **Row kept as `pub struct Row(pub Vec<Cell>)` rather than a transparent newtype.** The `pub` on the inner Vec is intentional: Scrollback's `resize_grid` needs to `row.0.resize(new_cols, BLANK)` without adding yet another delegate method. The interface plan specifies this shape.

## Deviations from Plan

None — plan executed exactly as written. All three module implementations, test suites, and verification checks match the plan's `<action>` blocks verbatim (modulo trivial rustfmt idempotent reformatting of method-body braces to multi-line form, which the formatter applied automatically without changing semantics).

## Issues Encountered

None.

## Self-Check: PASSED

- Task 1 commit `9c52f49` found in git log
- Task 2 commit `6df3b71` found in git log
- Task 3 commit `df2e22b` found in git log
- `crates/bestialitty-core/src/grid.rs` exists (180 lines, `#[repr(C)]` present, `size_of::<Cell>() == 8` compile-time assertion present)
- `crates/bestialitty-core/src/scrollback.rs` exists (269 lines, `VecDeque` import + `pop_front` usage present)
- `crates/bestialitty-core/src/dirty.rs` exists (134 lines, `bytes: Vec<u8>` field + bounds-checked `mark` present)
- `cargo test -p bestialitty-core --lib` green — 25 tests passing
- `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core` green
- `cargo clippy -p bestialitty-core --lib -- -D warnings` clean
- `! grep -rE 'wasm_bindgen|web_sys|js_sys' crates/bestialitty-core/src/grid.rs crates/bestialitty-core/src/scrollback.rs crates/bestialitty-core/src/dirty.rs` passes (no wasm leakage)

## User Setup Required

None — no external service configuration required. Pure Rust rlib addition.

## Next Phase Readiness

**Plan 01-05 (parser + Terminal) unblocked.** It can now `use crate::grid::{Cell, Row}`, `use crate::scrollback::Scrollback`, `use crate::dirty::Dirty` and compose them into the Terminal struct. The public APIs are stable: Plan 05's `Terminal::new(rows, cols, cap)` will internally construct `Scrollback::new(rows, cols, cap)` + `Dirty::new(rows)`, and the parser's `Perform` impl will call `Scrollback::row_mut(idx).as_mut_slice()[col] = Cell::with_byte(b); Dirty::mark(idx)`.

**Plan 01-06 (key encoder) also unblocked** — no overlap with this plan's `files_modified` (CONTEXT.md D-19), so Wave 2 parallel execution remains possible.

**Phase 2 wasm boundary preparation:** the Cell layout + dirty byte-per-row layout are what Phase 2's `grid_ptr()`/`dirty_ptr()` will expose zero-copy. The compile-time assertions locked in here are the tripwire for any accidental layout drift before Phase 2 starts.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already catalogued. All mitigations listed there (T-04-01 through T-04-07) are implemented and test-covered. No new network endpoints, auth paths, file access, or schema changes — these are pure in-memory data-structure modules.

---
*Phase: 01-rust-core-parser-grid-key-encoder*
*Completed: 2026-04-21*
