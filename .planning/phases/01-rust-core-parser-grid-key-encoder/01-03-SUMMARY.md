---
phase: 01-rust-core-parser-grid-key-encoder
plan: 03
status: complete
started: 2026-04-21
completed: 2026-04-21
tasks_completed: 2
tasks_total: 2
requirements_addressed: [PARSER-01, PARSER-02, PARSER-03, PARSER-04, PARSER-08]
---

# Plan 01-03 — Parser-Strategy Spike + ADR-001 — SUMMARY

## Outcome

Both parser prototypes implemented, both cleared the D-03 torn-chunk floor
(22/22 tests green). Author selected **`vte::Parser` + `Perform`** as the
winning approach. ADR-001 committed with specific code citations in both the
adoption and rejection rationales.

## Tasks

| # | Task | Status | Commits |
|---|------|--------|---------|
| 1 | Implement both prototypes + shared harness + tests | complete | `9cf95b7`, `1fd2170`, `44aa085`, `270c997` |
| 2 | Author readability decision + write ADR-001 | complete | `8b40369` |

## Key Findings

### 1. Both prototypes pass identical torn-chunk matrix (D-03 floor)

`cargo test -p bestialitty-core --features spike --lib` returns 22 tests green,
including:

- 10 `both_produce!` macro-generated tests on D-02 opcode set (ESC A/B/C/D +
  4 ESC Y edges from PITFALLS.md #3 + ESC J + ESC K)
- 9 `torn_*` tests splitting every multi-byte sequence at every internal
  offset, cross-checked with `assert_identical_across_splits`
- 3 direct cross-prototype state-equivalence tests on mixed-input payloads

Neither prototype has a correctness gap vs the other — the decision is purely
on readability + extensibility (D-03 criterion).

### 2. Side-by-side code characteristics

| | Hand-rolled | vte-based |
|---|---|---|
| Core parser block | 53 lines linear match | 55 lines impl Perform |
| ESC Y handling | `State::CursorRow → State::CursorCol(r)` state pair (`hand_rolled.rs:89,95-100`) | `EscYPhase` sub-state shuttled via `mem::replace` across `esc_dispatch` + `print` callbacks (`vte_path.rs:20-23,99,130-135`) |
| Empty trait methods | 0 | 5 (`csi_dispatch`, `hook`, `put`, `unhook`, `osc_dispatch`) |
| Transitive deps | 0 | `vte`, `memchr`, `arrayvec` |

### 3. Author decision: vte wins

Rationale (from ADR-001):
- Alacritty's state machine is third-party-hardened; hand-rolled relies on
  author-written tests alone for every edge case.
- `Perform` callback categories map 1:1 onto VT52 semantic groups
  (`esc_dispatch` / `execute` / `print`).
- CSI/DCS/OSC are free to add if scope ever widens (PROJECT.md currently
  forecloses this, but future-proofing at zero code cost).

Rejected alternative cited at `hand_rolled.rs:65-101` (author-written DFA
correctness risk) and `hand_rolled.rs:89,95-100` (doesn't generalize to
CSI-style multi-byte families).

### 4. Implications locked for Plan 04

ADR-001 writes down the exact Plan 04 migration steps:
1. Delete `src/spike/hand_rolled.rs` + `pub mod hand_rolled;` line
2. Promote `spike/vte_path.rs` to `src/vt52.rs`, extend `esc_dispatch` for
   ESC H/I/Z/F/G/=/>/[\\ and `execute` for BS/HT/LF/CR/BEL
3. Move `EscYPhase` onto `struct Parser` so it persists across `feed()`
   boundaries
4. Pin `vte = "=0.15"` (non-optional), remove `spike = ["dep:vte"]` feature
5. Keep torn-chunk harness as a production test
6. Delete `src/spike/` in its entirety

### 5. vte 0.15.0 API confirmed

Verified against the cached crate source at
`~/.cargo/registry/src/index.crates.io-*/vte-0.15.0/src/lib.rs:360-363`:
- `Parser::advance(&mut self, performer: &mut P, bytes: &[u8])` signature OK
- `esc_dispatch` dispatches `ESC Y` as `esc_dispatch(b'Y')` then two
  `print` callbacks for the row + col bytes (hence the `EscYPhase` workaround)
- `Perform` trait surface matches `01-RESEARCH.md` Pattern 1

Resolves RESEARCH.md Open Question #4 (vte version ambiguity).

## Deviations

None. Task 1 ran autonomously, Task 2 went through the intended
checkpoint:decision → ADR-write path.

**Note on test invocation:** the plan's acceptance-criterion command
`cargo test --features spike spike::tests` ran 0 tests when issued at the
workspace root without `--lib`. The correct invocation is
`cargo test -p bestialitty-core --features spike --lib` (filter by target,
not module path). The 22 tests exist and pass; the invocation phrasing in
the plan's verify block was slightly off, not the test code.

## Consumed By

- **Plan 04 (parser core + Terminal):** ADR-001's "Implications for Plan 04"
  section is the migration checklist. Promotes `spike/vte_path.rs` to
  `src/vt52.rs` and extends.
- **Plan 05 (fixtures):** fixture_runner's `record_trace` parser will mirror
  the production vte+Perform structure for lockstep parity (see Plan 05
  Task 3 acceptance criterion on opcode-arm count parity).
- **Phase 2 (wasm-pack):** bundle-size measurement against the ADR's
  assumption that vte+memchr+arrayvec cost is < 20 KB gzipped delta. If over,
  reopen ADR-001.

## Files Created

- `crates/bestialitty-core/src/spike/mod.rs` (27 lines)
- `crates/bestialitty-core/src/spike/harness.rs` (137 lines — `SpikeTerminal`, `decode_esc_y_byte`, `assert_identical_across_splits`)
- `crates/bestialitty-core/src/spike/hand_rolled.rs` (111 lines — to be deleted in Plan 04)
- `crates/bestialitty-core/src/spike/vte_path.rs` (144 lines — promoted to production in Plan 04)
- `crates/bestialitty-core/src/spike/tests.rs` (231 lines — torn-chunk + cross-prototype equivalence)
- `.planning/decisions/ADR-001-parser-strategy.md` (184 lines — Nygard-style ADR)

## Files Modified

- `crates/bestialitty-core/Cargo.toml` — added `spike = ["dep:vte"]` feature + optional vte 0.15 dep
- `crates/bestialitty-core/src/lib.rs` — added `#[cfg(any(test, feature = "spike"))] pub mod spike;`

## Self-Check: PASSED

All seven verification bullets satisfied:

- [x] Both prototypes implemented under `spike/`
- [x] Shared harness in `spike/harness.rs` with all required exports
- [x] Identical test matrix runs against both via `both_produce!` macro + helper closures
- [x] Both pass D-02 set + torn-chunk floor (22/22)
- [x] Default build has zero vte deps in resolve graph (build succeeds with empty dep set)
- [x] ADR-001 committed with Status/Date/Decision/Rejected Alternative/Floor Condition/Implications/References — all sections specific
- [x] PARSER-01..04 + PARSER-08 exercised at spike-level against D-02 minimum; production coverage extends in Plan 04
