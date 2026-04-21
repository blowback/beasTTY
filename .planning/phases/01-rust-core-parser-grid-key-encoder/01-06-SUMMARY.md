---
phase: 01-rust-core-parser-grid-key-encoder
plan: 06
subsystem: input
tags: [rust, key-encoding, vt52, pure-logic, stateless, pod]

requires:
  - phase: 01-rust-core-parser-grid-key-encoder/01
    provides: "bestialitty-core crate skeleton with pub mod key; stub"
provides:
  - "KeyCode enum with Char(u8), 4 arrows, Enter/Tab/Backspace/Escape, KeypadDigit/Enter/Comma/Minus/Dot (14 variants)"
  - "Modifiers struct (hand-rolled; bool fields ctrl/shift/alt/meta) with NONE and CTRL consts"
  - "KeyEvent { code: KeyCode, mods: Modifiers } with new() and with_ctrl() constructors"
  - "Pure, stateless encode(KeyEvent) -> Vec<u8> covering arrows, ctrl-letter, ctrl-symbol, printable, keypad"
  - "30 exhaustive unit tests (all 26 ctrl-letters both cases, 6 ctrl-symbols, full 0x20-0x7E pass-through, 10 keypad digits, Modifiers/KeyEvent invariants)"
affects: [phase-02-wasm-boundary, phase-04-keyboard-input]

tech-stack:
  added: []
  patterns:
    - "Stateless pure-function API over structurally-typed input (KeyEvent) returning owned Vec<u8> on cold path"
    - "Hand-rolled Modifiers struct with `pub const NONE` / `pub const CTRL` — avoids bitflags dep per CONTEXT 'Claude's Discretion'"
    - "Constructor helpers (KeyEvent::new / with_ctrl) keep call sites terse and self-documenting"
    - "Exhaustive loop-based tests (b'a'..=b'z' iteration) catch formula-drift regressions loudly"

key-files:
  created: []
  modified:
    - crates/bestialitty-core/src/key.rs

key-decisions:
  - "Match arm ordering: Ctrl+letter guard (is_ascii_alphabetic) runs BEFORE Ctrl+symbol guard so the 0x40-subtract math is always applied to uppercase-normalized letters; Ctrl+symbol branch only reaches exactly the 6 bytes (@ [ \\ ] ^ _) where `c - 0x40` is safe."
  - "Arrow keys ignore modifiers in Phase 1 (arrows_ignore_modifiers test pins this). VT52 has no Ctrl-arrow convention; revisit in Phase 4 if a workflow surfaces one."
  - "Alt/Shift/Meta are currently behaviourally inert for printable chars (alt_and_meta_do_not_affect_printable_encoding_in_phase_1 pins this). Phase 4 may add Alt-prefix-ESC convention intentionally; this test will fail loudly when that change is deliberate, not accidentally."
  - "KeypadDigit(d) where d > 9 returns empty Vec (silent drop) rather than panicking on `b'0' + d` overflow — T-06-01 defensive mitigation."
  - "Ctrl-M overlaps with Enter (both emit 0x0D). Explicit smoke test (ctrl_m_overlaps_with_enter_cr) documents this is wire-level truth, not a bug — CR/LF semantics live on the host side."

patterns-established:
  - "Pure-logic leaf module (no siblings depended upon) ready for Phase 4 DOM-event packing layer to call directly"
  - "Phase 2 wasm boundary (lib.rs) will wrap `encode` with a wasm_bindgen shim; the underlying logic stays pure Rust per D-20"

requirements-completed: [CORE-01]

duration: 2min 7sec
completed: 2026-04-21
---

# Phase 1 Plan 06: PC-keyboard to VT52 Byte Encoder Summary

**Stateless, pure-Rust `encode(KeyEvent) -> Vec<u8>` covering arrows (ESC A/B/C/D), Ctrl-letter (0x01-0x1A), Ctrl-symbol (0x00, 0x1B-0x1F), printable ASCII pass-through, Enter/Tab/Backspace/Escape, and the keypad — 30 exhaustive tests, zero wasm deps.**

## Performance

- **Duration:** 2 min 7 sec
- **Started:** 2026-04-21T14:16:34Z
- **Completed:** 2026-04-21T14:18:41Z
- **Tasks:** 1 (TDD; RED + GREEN commits)
- **Files modified:** 1 (crates/bestialitty-core/src/key.rs)

## Accomplishments

- `KeyCode` enum with 14 variants covering every PC-keyboard input the MicroBeast will see in Phase 4 (printable chars, arrows, named nav keys, keypad cluster).
- `Modifiers` POD struct (ctrl/shift/alt/meta bools) with `NONE` and `CTRL` consts — zero-dep, directly wasm-safe.
- `KeyEvent` struct + `new()` / `with_ctrl()` constructors for terse test and caller code.
- `encode(KeyEvent) -> Vec<u8>` — pure function implementing the full PC→VT52 mapping table (CONTEXT D-13, RESEARCH Pattern 4):
  - Arrows → ESC A/B/C/D (modifiers ignored)
  - Enter/Tab/Backspace/Escape → 0x0D / 0x09 / 0x08 / 0x1B
  - Ctrl+letter (case-insensitive via `to_ascii_uppercase`) → 0x01-0x1A
  - Ctrl+@ / [ / \ / ] / ^ / _ → 0x00, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F
  - Printable ASCII → single-byte pass-through
  - Keypad digits → '0'-'9'; KeypadEnter → CR; ,/−/. → ASCII
  - KeypadDigit(10+) → empty Vec (defensive silent drop; T-06-01)
- 30 exhaustive unit tests — the mapping table is pinned as a regression harness: any formula drift (e.g., Ctrl-A emitting 0x41 instead of 0x01) fails loudly and by name.
- Module is wasm-free per D-20: zero `wasm_bindgen` / `web_sys` / `js_sys` references — verified by `grep` exit=1.

## Task Commits

TDD: RED → GREEN (no REFACTOR needed; implementation shipped clean on first pass).

1. **RED: failing arrow-up smoke test** — `babd01d` (test)
2. **GREEN: full encoder + 30 tests** — `39e07aa` (feat)

**Plan metadata (this file):** forthcoming on final commit.

## Files Created/Modified

- `crates/bestialitty-core/src/key.rs` — replaced Plan 01 stub (5 lines) with full implementation (368 lines: 131 logic + 237 tests).

## Decisions Made

- **Match arm ordering over explicit else-branches** — the Ctrl+letter guard uses `is_ascii_alphabetic()` which precisely covers 0x41-0x5A and 0x61-0x7A; the Ctrl+symbol guard uses `c == b'@' || (b'['..=b'_').contains(&c)` which precisely covers 6 bytes. Any Ctrl+Char(c) that doesn't match either guard (e.g., Ctrl+digit, Ctrl+space) falls through to the printable pass-through branch. This is intentional: browsers don't typically forward Ctrl+digit to the page anyway (OS reserves them), so the pass-through is a harmless default.
- **Hand-rolled Modifiers over `bitflags` crate** — CONTEXT's "Claude's Discretion" section explicitly notes this; Phase 1 baseline deps stay empty.
- **Keypad is mode-blind in Phase 1** (D-13) — no ESC = / ESC > tracking; keypad digits always emit plain ASCII. Phase 4 can layer mode on top without re-entering this function.
- **`Char(u8)` holds already-shift-resolved byte** — the caller (Phase 4 DOM handler) resolves Shift, so `Char(b'A')` arrives here directly; `Char(b'a')` stays lowercase. Preserves "case-insensitive Ctrl+letter" without needing a separate Shift bit in the match.
- **Arrows ignore modifiers** — no VT52 convention for Ctrl-arrows; future extension is reversible by adding a guard above the arrow arms, not by restructuring.

## Deviations from Plan

None — plan executed exactly as written. The plan already carried a full reference implementation in its `<action>` block; implementation matched it verbatim (modulo `rustfmt` formatting on the emitted code). All 30 tests from the plan's test list were included.

## Issues Encountered

None. `cargo test` passed on first run after the GREEN edit; no compilation diagnostics, no test failures.

## Verification Results

```bash
cargo test -p bestialitty-core --lib key::
# test result: ok. 30 passed; 0 failed (25 prior filtered out)

cargo test -p bestialitty-core --lib
# test result: ok. 55 passed; 0 failed (full crate: grid, scrollback, dirty, key)

cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core
# Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.10s

grep -E 'wasm_bindgen|web_sys|js_sys' crates/bestialitty-core/src/key.rs
# (no matches; exit=1)  — module is wasm-free per D-20
```

All success criteria met:

- [x] `key.rs` exports `KeyCode`, `Modifiers`, `KeyEvent`, `encode`
- [x] `encode()` covers arrows, Ctrl-letter (all 26, case-insensitive), Ctrl-symbol (6 bytes), printable ASCII (0x20-0x7E), Enter/Tab/BS/ESC, keypad digits 0-9, keypad symbols
- [x] 30 unit tests (>= 25 required) cover the exhaustive mapping table
- [x] Module is wasm-free (D-20)
- [x] `cargo test -p bestialitty-core --lib key::` exits 0
- [x] `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core` green
- [x] TDD gate sequence: test(...) commit before feat(...) commit

## TDD Gate Compliance

- **RED:** `babd01d` test(01-06): add failing test for arrow-up key encoding — compilation fails with E0433/E0425 (KeyEvent/KeyCode/encode undefined); RED gate satisfied (failure is due to missing types, not a passing test masquerading as red).
- **GREEN:** `39e07aa` feat(01-06): implement PC-keyboard to VT52 byte encoder — 30/30 key tests pass; 55/55 crate tests pass.
- **REFACTOR:** Not required. Implementation landed clean; no cleanup pass added.

## Next Phase Readiness

- Plan 01-06 closes the CORE-01 "Rust owns key encoding" portion of Phase 1 (D-13).
- The `encode` function is ready for Phase 2 wasm boundary wrapping: `lib.rs` will add a thin `encode_key(code: u32, mods: u32) -> Vec<u8>` shim that packs DOM-level values into a `KeyEvent` and delegates here.
- Phase 4 DOM event handler becomes a pure struct-packing layer: read `KeyboardEvent.code` / `.ctrlKey` etc., construct `KeyEvent`, call `encode`, write returned bytes to port.
- Parallel Wave 2 sibling Plan 01-05 (production parser + Terminal) remains the critical path for Phase 1 completion. Plan 01-07 (boundary API shape lock + fmt/clippy hygiene) will sweep this file into the final lint pass.

## Self-Check: PASSED

- FOUND: crates/bestialitty-core/src/key.rs (modified)
- FOUND: commit babd01d (RED)
- FOUND: commit 39e07aa (GREEN)
- FOUND: 30/30 key tests pass
- FOUND: 55/55 total crate tests pass
- FOUND: wasm-free grep returns no matches (exit=1)

---
*Phase: 01-rust-core-parser-grid-key-encoder*
*Completed: 2026-04-21*
