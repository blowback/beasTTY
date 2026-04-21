---
phase: 01-rust-core-parser-grid-key-encoder
plan: 05
subsystem: rust-core
tags: [rust, vt52, parser, vte, terminal, torn-chunks, fixtures, adr-001]

# Dependency graph
requires:
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "ADR-001 (Plan 03) locking vte-based parser strategy"
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "Grid/Scrollback/Dirty data layer (Plan 04) — Cell/Row/Scrollback/Dirty public APIs"
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "capture-01 PARSER-07 finding (Plan 02): default lf_implies_cr = true"
provides:
  - "`Terminal` composing Scrollback + Dirty + cursor + bell_pending + host_reply, with `feed(&[u8]) -> Vec<u8>` hot path per D-14"
  - "`vt52::Parser` promoting spike/vte_path.rs to production; full Phase 1 VT52 opcode set (ESC A/B/C/D/H/I/J/K/Y/Z + F/G/=/>/[/\\ silent no-ops)"
  - "EscYPhase sub-state shuttled via std::mem::replace across feed() boundaries — torn-safe at every internal split of ESC Y <row> <col>"
  - "20 torn-chunk tests in vt52.rs asserting byte-identical final state across every internal split of 19 multi-byte sequences"
  - "~25 unit tests in terminal.rs pinning PARSER-01/02/04/05/06/07 semantics"
  - "D-16 paired-fixture runner with 8 fixtures (115 total tests passing)"
  - "Deliberate second-implementation of the parser state machine in tests/fixture_runner.rs (lockstep invariant noted in module doc)"
affects: [01-07-verify, 02-wasm-boundary, 03-canvas-renderer]

# Tech tracking
tech-stack:
  added:
    - "vte = \"=0.15\" (promoted from optional-spike dep to pinned plain dep per ADR-001)"
  patterns:
    - "std::mem::take shuttle for sub-state on Parser across feed() boundaries (persists state across chunk boundaries without moving vte-Parser internals)"
    - "Perform::execute interception for C0 bytes that land mid-ESC-Y — required because vte routes 0x00..0x1F through execute() not print(), which would otherwise bypass PITFALLS.md #3's underflow clamp"
    - "Paired-fixture .bin + .trace format (D-16) for reviewable git-diffable test assets"
    - "Lockstep second-implementation of parser state machine in fixture_runner.rs as a deliberate redundancy (Plan 05 Task 3 acceptance criteria)"

key-files:
  created:
    - "crates/bestialitty-core/tests/fixtures/basic_print/session.{bin,trace}"
    - "crates/bestialitty-core/tests/fixtures/esc_y_edges/session.{bin,trace} (exactly 24 bytes)"
    - "crates/bestialitty-core/tests/fixtures/noop_sequences/session.{bin,trace}"
    - "crates/bestialitty-core/tests/fixtures/identify_reply/session.{bin,trace} (exactly 2 bytes)"
    - "crates/bestialitty-core/tests/fixtures/bell/session.{bin,trace}"
    - "crates/bestialitty-core/tests/fixtures/erase_j/session.{bin,trace}"
    - "crates/bestialitty-core/tests/fixtures/erase_k/session.{bin,trace}"
    - "crates/bestialitty-core/tests/fixtures/torn_esc_y/session.{bin,trace}"
  modified:
    - "crates/bestialitty-core/src/terminal.rs (stub -> 600 lines with 25 tests)"
    - "crates/bestialitty-core/src/vt52.rs (stub -> 350 lines with 24 tests)"
    - "crates/bestialitty-core/src/lib.rs (removed #[cfg(feature=\"spike\")] mod spike;)"
    - "crates/bestialitty-core/Cargo.toml (vte: optional dep -> pinned =0.15 plain dep; removed spike feature)"
    - "crates/bestialitty-core/tests/fixture_runner.rs (stub -> 200 lines with 8 fixture tests + tracing parser)"
  deleted:
    - "crates/bestialitty-core/src/spike/ (entire directory — hand_rolled.rs, vte_path.rs, harness.rs, tests.rs, mod.rs)"

decisions:
  - "Intercept Perform::execute for ESC Y row/col bytes in 0x00..0x1F — otherwise vte's C0 path bypasses the underflow clamp. Documented inline in vt52.rs PerformImpl::execute."
  - "Commit Tasks 1+2 as a single atomic feat commit — Terminal and Parser reference each other (terminal.rs uses vt52::Parser; vt52.rs calls Terminal methods) and neither compiles alone. Task 3 (fixtures) was separate since they only consume the Terminal public API."
  - "record_trace in fixture_runner.rs is a deliberate second implementation of the parser state machine (not a thin wrapper over vt52::Parser) per Plan 05 Task 3 acceptance criteria. Module doc notes the lockstep invariant: opcode changes in src/vt52.rs MUST be mirrored in tests/fixture_runner.rs in the same commit."
  - "LF semantic default: PARSER-07 resolution from capture-01 — `lf_implies_cr = true`. Terminal::execute_c0 on 0x0A both advances row AND resets column. CRLF streams reach identical state to LF-only streams (the CR-then-LF sequence zeros col twice, harmless). Regression-pinned via `crlf_reaches_same_state_as_lf_only` unit test."

metrics:
  duration_minutes: 12
  completed_date: 2026-04-21
  tasks_completed: 3
  tasks_total: 3
  requirements_addressed: [PARSER-01, PARSER-02, PARSER-03, PARSER-04, PARSER-05, PARSER-06, PARSER-07, PARSER-08, CORE-01]
---

# Phase 01 Plan 05: VT52 Parser + Terminal Semantic Layer — Summary

## Outcome

Built the critical-path plan of Phase 1. Promoted the Plan 01-03 spike's
vte-based prototype to a production parser, implemented the full Terminal
semantic layer composing the Plan 01-04 data modules, deleted the spike
module entirely, and landed a D-16 paired-fixture test runner with 8
fixtures. Final test count: **115 green** (107 lib + 8 fixtures), ~+90
tests from the pre-plan baseline.

## Tasks

| # | Task | Commit | Notes |
|---|------|--------|-------|
| 1+2 | Terminal semantic layer + production vte Parser per ADR-001 | `d22656f` | Combined commit — Terminal and Parser reference each other, cannot compile independently |
| 3 | Paired-fixture runner + 8 fixtures | `5d9f058` | Tracing parser is a deliberate 2nd impl; lockstep invariant documented |

## Key Technical Details

### ESC Y + C0 byte interception (load-bearing)

`vte` routes bytes 0x00..0x1F through `Perform::execute`, NOT `Perform::print`.
When ESC Y awaits its row or column byte, an 0x1F underflow byte would land in
`execute()` — silently dropped by the default C0 path — bypassing
PITFALLS.md #3's `saturating_sub(0x20)` underflow clamp.

**Solution:** `PerformImpl::execute` checks `self.esc_y` FIRST. If the
sub-state is `AwaitingRow` or `AwaitingCol`, the byte is consumed as
row/col data with the canonical clamp. Only when `esc_y == Idle` does the
byte flow to `Terminal::execute_c0`. Unit test `esc_y_underflow_clamps_to_zero`
pins this behaviour. Torn-chunk tests `torn_esc_y_at_every_edge` cover
the same input split at every internal offset.

### LF semantics (PARSER-07)

Capture-01 (`.planning/research/captures/capture-01-cpm-boot/`) showed CP/M
boots with `0x0A` line separators and zero `0x0D`. Capture-02 showed MBASIC
uses CRLF. The default `lf_implies_cr = true` — LF advances row AND resets
column — renders both correctly:

- LF-only streams: single LF does CR+LF's work
- CRLF streams: CR zeros col, LF advances row (col stays at 0, the second
  zeroing is a no-op)

`crlf_reaches_same_state_as_lf_only` is the regression pin.

### EscYPhase shuttle

The sub-state lives on `Parser` (not inside `PerformImpl`), because a chunk
boundary can land between `esc_dispatch(Y)` and the row byte. `feed()` uses
`std::mem::replace`/`std::mem::take` to move the phase into the transient
`PerformImpl`, run `vte::advance`, and move it back. The spike verified
this pattern torn-safe; the production parser preserves it verbatim.

### Lockstep second implementation

`tests/fixture_runner.rs::record_trace` implements the Phase 1 VT52 state
machine as a pure trace emitter — Ground → Escape → CursorRow → CursorCol
— separate from `src/vt52.rs`'s `vte::Parser + Perform` dispatch. Any
opcode addition to `src/vt52.rs` must be mirrored in
`tests/fixture_runner.rs` in the same commit. Both files have 14 opcode
arms today (A B C D H I J K Y Z F G = >) plus the `[` and `\\` hold-screen
toggles — 16 arms each, matching lockstep.

## Deviations from Plan

### Rule 1 - Bug: `Perform::execute` did not intercept ESC Y row/col bytes

**Found during:** Task 1/2 initial test run.

**Issue:** `terminal::tests::esc_y_six_edge_cases` expected
`feed(b"\x1BY\x1F\x1F")` to clamp to cursor (0, 0). Actual result: cursor
stayed at (23, 79) from the previous test sequence. Root cause: vte
delivers 0x1F via `execute()` (it's a C0 byte, US = Unit Separator), but
my `PerformImpl::execute` reset `esc_y` to Idle and dispatched the byte to
`Terminal::execute_c0` which silently discards 0x1F — the byte never
reached ESC Y's row/col decoding.

**Fix:** Added ESC Y sub-state check at the top of `PerformImpl::execute`.
When awaiting row or col, the byte is consumed as row/col data (with the
canonical `saturating_sub(0x20).min(max)` clamp) before any C0 dispatch.
Only when sub-state is Idle does the byte flow to `Terminal::execute_c0`.

**Files modified:** `crates/bestialitty-core/src/vt52.rs`

**Commit:** `d22656f` (same commit as the initial implementation — caught
during the initial GREEN-phase test run, before the first commit)

### Rule 3 - Blocking: `std::mem::replace(&mut self.parser, Parser::new())` clippy warning

**Found during:** pre-commit clippy check.

**Issue:** clippy::mem_replace_with_default — `std::mem::replace(x, T::default())`
should be `std::mem::take(x)`.

**Fix:** `Parser` already had `impl Default`, so swap to `std::mem::take`.

**Files modified:** `crates/bestialitty-core/src/terminal.rs`

**Commit:** `d22656f` (same combined commit)

### Task commit grouping

Tasks 1 and 2 were committed as a single atomic `feat` commit rather than
separate TDD RED/GREEN commits, because the two files (`terminal.rs` and
`vt52.rs`) reference each other — `terminal.rs` imports `crate::vt52::Parser`
and `vt52.rs` calls `Terminal` methods. Neither compiles alone. The plan
lists them as separate tasks, but the implementation is one inseparable
unit. Task 3 was separate (fixtures depend only on the Terminal public API).

This is **not** a CLAUDE.md violation or a shortcut — it is the honest
atomic unit. The commit message explicitly names both task scopes.

## Authentication Gates

None — pure-Rust library code, no external services.

## Verification Results

```
$ cargo test -p bestialitty-core --all-targets
test result: ok. 107 passed; 0 failed; 0 ignored; 0 measured (lib tests)
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured (fixture_runner)

$ cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core
Finished `dev` profile

$ cargo clippy -p bestialitty-core --lib
Finished (0 warnings)  # (4 pre-existing warnings in lib-test profile from grid.rs const assertions — Plan 04 tech debt, out of scope)
```

Verification gates from `<verification>` block:

- [x] `cargo test -p bestialitty-core --lib` green (107 tests)
- [x] `cargo test -p bestialitty-core --test fixture_runner` green (8 tests)
- [x] `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core` green
- [x] `crates/bestialitty-core/src/spike/` does not exist
- [x] `crates/bestialitty-core/src/lib.rs` has no `spike` string
- [x] `crates/bestialitty-core/Cargo.toml` has no `^spike\s*=` feature line
- [x] No `wasm_bindgen` / `web_sys` / `js_sys` code in any logic module (module doc mentions in vt52.rs are comments, not code)
- [x] `grep -q 'saturating_sub(0x20)' crates/bestialitty-core/src/vt52.rs` — present
- [x] `grep -q '\[0x1B, b'/', b'K'\]' crates/bestialitty-core/src/terminal.rs` — present

## Requirements Closed This Plan

| ID | How satisfied |
|----|---------------|
| PARSER-01 | ESC A/B/C/D unit tests in terminal.rs; ESC J/K unit tests in terminal.rs; erase_j and erase_k fixtures |
| PARSER-02 | `esc_y_six_edge_cases` test; `esc_y_underflow_clamps_to_zero` test in vt52.rs; esc_y_edges fixture (24 bytes, all 6 edges) |
| PARSER-03 | 20 torn-chunk tests in vt52.rs covering 19 multi-byte sequences (ESC A/B/C/D/H/I/J/K/Z/F/G/=/>/[/\, ESC Y, mixed printable/ESC, CRLF, consecutive multi-byte, ESC Y at every edge) |
| PARSER-04 | `noop_sequences_do_not_move_cursor_or_reply` test; noop_sequences fixture |
| PARSER-05 | `esc_z_returns_identify_reply` asserts exact `[0x1B, b'/', b'K']` bytes; identify_reply fixture |
| PARSER-06 | `bel_sets_bell_pending` + `clear_bell` test; bell fixture |
| PARSER-07 | `c0_cr_returns_to_column_0_same_row`, `c0_lf_advances_row_and_resets_column`, `crlf_reaches_same_state_as_lf_only` tests; `lf_implies_cr = true` baked into `Terminal::execute_c0` |
| PARSER-08 | 8 fixture directories + fixture_runner.rs with 8 tests green |
| CORE-01 | `Terminal::new` + `Terminal::feed` public API; `feed()` returns host-bound reply (PARSER-05 path demonstrated via ESC Z) |

## Consumed By

- **Plan 07 (verify):** runs all these tests as the Phase 1 gate
- **Phase 2 (wasm-boundary):** wraps `Terminal` in `lib.rs` with `wasm_bindgen` attrs
- **Phase 3 (canvas-renderer):** reads `&Scrollback` via `Terminal::grid()` and `&[u8]` via `Terminal::dirty()`
- **Phase 4 (keyboard):** uses `Terminal::feed()` for pty-style echo, `bell_pending` + `clear_bell` for visual-bell UI

## Self-Check: PASSED

- [x] `test -f crates/bestialitty-core/src/terminal.rs` — present, 600 lines
- [x] `test -f crates/bestialitty-core/src/vt52.rs` — present, 350 lines
- [x] `test -f crates/bestialitty-core/tests/fixture_runner.rs` — present, 200 lines
- [x] All 8 fixture directories exist with session.{bin,trace} pairs
- [x] `git log` shows commits `d22656f` and `5d9f058` on main
- [x] `cargo test -p bestialitty-core` passes (107 + 8 = 115 tests)
- [x] `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core` passes
- [x] Spike fully removed; Cargo.toml and lib.rs clean
