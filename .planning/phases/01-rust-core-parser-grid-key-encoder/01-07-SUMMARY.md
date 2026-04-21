---
phase: 01-rust-core-parser-grid-key-encoder
plan: 07
subsystem: rust-core
tags: [rust, ci-gate, core-02, d-17, clippy, rustfmt, phase-exit, boundary-api]

# Dependency graph
requires:
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "Plan 05 (Terminal + vte Parser + fixture_runner) and Plan 06 (key::encode) public surfaces — the shapes this plan locks"
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "Plan 01 Cargo workspace with cdylib+rlib crate-type — the D-19 constraint this plan codifies as a test"
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "ADR-001 (vte = \"=0.15\" is the sole approved production dep) — the allow-list this plan's forbidden-crate list is the complement of"
provides:
  - "tests/core_02_no_browser_deps.rs with 3 #[test] functions (cargo metadata scan + src/ token grep + Cargo.toml crate-type check) that promote VALIDATION.md's manual grep to an automated in-repo CI gate"
  - "tests/boundary_api_shape.rs with 10 #[test] functions that pin the D-17 / D-18 boundary surface (Terminal + key::encode) as a compile-time contract — signature drift fails cargo test, not wasm-pack build"
  - "4 pre-existing clippy::assertions_on_constants warnings in key.rs cleared via const { ... } blocks (strictly stronger: build-time fail, not runtime fail)"
  - "Phase 1 exit gate: fmt-clean, clippy-clean at default -D warnings, 128 tests green, cross-target build green"
affects: [02-wasm-boundary, 03-canvas-renderer, 04-keyboard-input, 05-web-serial-transport]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-repo automated gate over `cargo metadata --format-version=1` JSON + filesystem walk + Cargo.toml string match — no new deps; pure std::process::Command + std::fs"
    - "const { assert!(..) } compile-time assertions for invariants on `const` values (promotes runtime to build-time failure)"
    - "Compile-time API shape contract via tests/ integration test with explicit type annotations on every accessor — pub narrowing / return-type drift fails `cargo test` at compile, not at wasm-pack build"

key-files:
  created:
    - "crates/bestialitty-core/tests/core_02_no_browser_deps.rs (187 lines, 3 tests)"
    - "crates/bestialitty-core/tests/boundary_api_shape.rs (149 lines, 10 tests)"
    - ".planning/phases/01-rust-core-parser-grid-key-encoder/01-07-SUMMARY.md (this file)"
  modified:
    - "crates/bestialitty-core/src/grid.rs (rustfmt: multi-line const assert)"
    - "crates/bestialitty-core/src/key.rs (const { ... } block for 4 Modifiers::CTRL assertions)"
    - "crates/bestialitty-core/src/lib.rs (rustfmt: pub mod alphabetization)"
    - "crates/bestialitty-core/src/terminal.rs (rustfmt: resize chain flattened)"

decisions:
  - "Task 1 source-file grep excludes line comments (lines with `//`) before token matching — doc-comment mentions of 'wasm-free architecture' in lib.rs and vt52.rs are fine; only actual code use of wasm_bindgen / web_sys / js_sys regresses. Block comments are NOT stripped — if someone hides an attr inside `/* ... */`, the build is already compromised (the comment itself would not compile as a real attr)."
  - "Task 2 asserts `cursor() -> (u32, u32)` tuple per PLAN.md <interfaces> block, not the packed-u32 form mentioned in D-17's hot-path wasm shape. The packed u32 is a Phase 2 wasm-boundary projection (produced by `lib.rs`'s thin wrapper); the semantic-layer API stays as a readable tuple. Neither option closes any Phase 1 success-criteria gap differently."
  - "Task 3 committed as the phase exit gate commit `chore(01): phase 1 exit gate green` bundling the rustfmt + clippy cleanup. Per 01-07-PLAN.md Task 3 scope: 'no file modifications' was nominal; in practice the three-line rustfmt drift and the clippy fix landed here. No separate phase-gate commit was spawned because all four gates pass on this single commit."
  - "FORBIDDEN_CRATES list in Task 1 extends the VALIDATION.md minimal set (web-sys / js-sys / wasm-bindgen) to also deny wasm-bindgen-futures + 11 gloo-* crates. Rationale: any gloo crate implies browser-API bindings; adding the explicit list means a contributor who reaches for e.g. gloo-timers gets a fail-fast error instead of silently breaching D-20."

metrics:
  duration_minutes: 9
  completed_date: 2026-04-21
  tasks_completed: 3
  tasks_total: 3
  requirements_addressed: [CORE-02]
---

# Phase 01 Plan 07: Phase 1 Exit Gate — CORE-02 Automation + Boundary Shape Lock — Summary

## Outcome

Promoted CORE-02 from a manual-grep checklist item in VALIDATION.md to
an in-repo automated gate; pinned the D-17 boundary API shape as a
compile-time contract consumed from outside the crate; cleared the
4-warning clippy tech debt noted in 01-05-SUMMARY.md verification block;
landed the single-commit Phase 1 exit gate.

Final Phase 1 state:

- **128 tests green** across 4 binaries (lib: 107, boundary_api_shape: 10, core_02_no_browser_deps: 3, fixture_runner: 8)
- **fmt-clean** (`cargo fmt --all -- --check` exits 0)
- **clippy-clean at -D warnings** (`cargo clippy --workspace --all-targets -- -D warnings` exits 0)
- **cross-target green** (`cargo build --target x86_64-unknown-linux-gnu --workspace` exits 0)
- **CORE-02 zero-browser-dep gate green** (automated + the VALIDATION.md manual `! cargo metadata | grep` sanity check)

## Tasks

| # | Task | Commit | Notes |
|---|------|--------|-------|
| 1 | tests/core_02_no_browser_deps.rs — 3 automated CORE-02 checks | `b0e40ff` | `cargo metadata` JSON scan + src/ token grep (comment-aware) + Cargo.toml crate-type assertion |
| 2 | tests/boundary_api_shape.rs — 10 compile-time D-17 shape locks | `1604243` | `(u32, u32)` cursor tuple per PLAN.md interfaces, not packed u32 (Phase 2 projects that) |
| 3 | Phase 1 exit gate: fmt + clippy + test + build all green | `3cf6642` | Bundled the rustfmt drift and 4 const-assert clippy fixes in the gate commit |

## Key Technical Details

### CORE-02 gate architecture (Task 1)

Three independent gates covering three distinct failure modes:

1. **Dep graph** (T-07-01): `cargo metadata --format-version=1` stdout
   is scanned for exact `"name":"<crate>"` substrings of 16 forbidden
   crate names. `env!("CARGO")` resolves to the cargo binary the test
   was launched with, so the gate works under any rustup/toolchain. A
   smoke assertion (`"name":"bestialitty-core"` must appear) guards
   against a silently-broken metadata command passing this test with
   empty JSON.

2. **Source tokens** (T-07-02): `std::fs::read_dir`-based recursive walk
   of `crates/bestialitty-core/src/` grepping each `.rs` file for
   `wasm_bindgen` / `web_sys` / `js_sys`. Line-comment-aware: for each
   line, the substring before `//` is scanned; everything after `//` is
   ignored. This is load-bearing — both `lib.rs` and `vt52.rs` contain
   doc-comment mentions of "No `wasm_bindgen` / `web_sys` / `js_sys`
   attrs here" that a naive `contains()` would false-positive on
   (caught by the first test run; see Deviations below).

3. **Cargo.toml** (T-07-03): reads the manifest and asserts the exact
   `crate-type = ["cdylib", "rlib"]` string or its reversed form is
   present. Defends D-19 from a "just drop rlib, it's not wasm" quick
   fix that would break D-20 native testability silently.

### Boundary shape contract (Task 2)

10 #[test] functions against `bestialitty_core::terminal::Terminal` and
`bestialitty_core::key::{encode, KeyEvent, KeyCode, Modifiers}` with
explicit type annotations on every binding. The file lives under
`tests/` (integration test), so it consumes the exact surface that
`wasm-bindgen` will consume in Phase 2 — a `pub(crate)` method that
compiles against an in-crate `#[cfg(test)]` module would fail here.

Covered shapes:

- `Terminal::new(u32, u32, usize) -> Self`
- `Terminal::feed(&[u8]) -> Vec<u8>` with ESC Z pinned to `[0x1B, b'/', b'K']`
- `Terminal::cursor() -> (u32, u32)` tuple (not packed u32 — that's Phase 2's projection)
- `Terminal::{rows, cols, bell_pending, dirty}` accessors with pinned return types
- `Terminal::{clear_bell, clear_dirty, resize, resize_scrollback}` mutators
- `Terminal::grid() -> &Scrollback` with `visible_rows()` / `cols()` reachable
- `key::encode(KeyEvent) -> Vec<u8>` with ArrowUp pinned to `[0x1B, b'A']`
- `KeyEvent::new` / `KeyEvent::with_ctrl`, `Modifiers::NONE` / `Modifiers::CTRL`
- PARSER-03 torn-chunk invariant at the public-API level (split `feed()` reaches identical cursor state to whole)

### Clippy cleanup (Task 3)

`key.rs::modifiers_ctrl_constant_only_has_ctrl_set` held 4 `assert!`
calls on constant-valued expressions (fields of `Modifiers::CTRL`,
itself a `const`). Clippy's `-D warnings` default-level lint
`assertions_on_constants` fires here. Moved into a single
`const { ... }` block per clippy's suggestion:

```rust
const {
    assert!(Modifiers::CTRL.ctrl);
    assert!(!Modifiers::CTRL.shift);
    assert!(!Modifiers::CTRL.alt);
    assert!(!Modifiers::CTRL.meta);
}
```

Strictly stronger than the runtime assert: a regression that flipped
any `Modifiers::CTRL` field value now fails the BUILD, not just the
test run. 01-05-SUMMARY.md verification block noted these as "4
pre-existing warnings in lib-test profile from grid.rs const
assertions — Plan 04 tech debt, out of scope" — that debt is now
closed. (The `grid.rs` const-assert attribution in 01-05's summary
was incorrect; the actual site was `key.rs`. Both files had
multi-line const-assert rustfmt drift fixed in this plan; neither
continues to produce clippy warnings.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Task 1 source-file grep false-positived on doc comments**

- **Found during:** Task 1 first test run
- **Issue:** `source_files_contain_no_wasm_attrs` initially used a naive
  `contents.contains(token)` check which hit line 8 of `lib.rs`
  ("`Any wasm_bindgen / web_sys / js_sys attrs stay confined to this file`")
  and line 33 of `vt52.rs` (similar doc-comment wording). Both are
  intentional architectural documentation, not code.
- **Fix:** Split each file into lines and, for each line, strip
  everything at or after `//` before the token scan. Doc comments
  (`//!`, `///`, plain `//`) are all stripped by this one rule.
  Block comments are NOT stripped — a deliberate choice documented
  inline. The plan's `<action>` block foresaw this issue ("Plan 05
  removes the spike module; Phase 2 will add wasm_bindgen attrs to
  lib.rs") but the initial code did not implement the stripping; caught
  by the first test run, fixed in the same uncommitted draft.
- **Files modified:** `crates/bestialitty-core/tests/core_02_no_browser_deps.rs`
- **Commit:** `b0e40ff` (fix was applied before first commit — no
  rework of committed code)

**2. [Rule 1 — Bug] Four pre-existing clippy::assertions_on_constants warnings in key.rs**

- **Found during:** Task 3 first `cargo clippy --workspace --all-targets -- -D warnings` run
- **Issue:** 4 warnings at `key.rs:332-335` on `assert!(Modifiers::CTRL.<field>)`
  expressions — clippy wants these in a `const { ... }` block since
  both operands are `const`. Phase 1 exit gate requires clippy-clean;
  these had to go.
- **Fix:** Wrapped the 4 assertions in a single `const { ... }` block
  with an explanatory comment. Promotes runtime-fail to build-fail
  for `Modifiers::CTRL` drift — a strict upgrade.
- **Files modified:** `crates/bestialitty-core/src/key.rs`
- **Commit:** `3cf6642`

**3. [Rule 3 — Blocking] Rustfmt drift across 4 source files**

- **Found during:** Task 3 `cargo fmt --all -- --check`
- **Issue:** Small drift in `grid.rs` (one const assert wanted
  multi-line), `lib.rs` (pub mod order wasn't alphabetical),
  `terminal.rs` (one `resize_grid` chain could collapse to one line),
  and the two new test files (import order + minor rewrap).
- **Fix:** `cargo fmt --all` applied the mechanical fix.
- **Files modified:** 4 source files + 2 test files
- **Commit:** `3cf6642` (bundled into the exit gate commit)

### Task commit grouping

Task 3 was planned as "no file modifications — verification-only task
that may surface formatting or lint fixes". In practice, it surfaced
both: the rustfmt drift was real (pre-existing + introduced by the two
new test files) and the clippy warnings were real (pre-existing from
Plan 06). Per the plan's `<action>` Step 1 explicit permission to
"apply the minimum fix and re-run until green", the commit bundles the
rustfmt + clippy fixes with the gate itself. This matches the
orchestrator prompt: `chore(01): phase 1 exit gate green`.

## Authentication Gates

None — pure-Rust library code, no external services.

## Verification Results

```
$ cargo fmt --all -- --check
[exit 0, no output]

$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.28s
[exit 0, no warnings]

$ cargo test --workspace --all-targets
test result: ok. 107 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out (lib tests)
test result: ok. 10 passed;  0 failed; 0 ignored; 0 measured; 0 filtered out (boundary_api_shape)
test result: ok. 3 passed;   0 failed; 0 ignored; 0 measured; 0 filtered out (core_02_no_browser_deps)
test result: ok. 8 passed;   0 failed; 0 ignored; 0 measured; 0 filtered out (fixture_runner)
TOTAL: 128 tests, all green

$ cargo build --target x86_64-unknown-linux-gnu --workspace
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.11s
[exit 0]

$ ! cargo metadata --format-version=1 -p bestialitty-core \
    | grep -E '"name":"(web-sys|js-sys|wasm-bindgen)"'
CORE-02 manual grep: CLEAN
```

Verification gates from `<verification>` block:

- [x] `cargo test -p bestialitty-core --test core_02_no_browser_deps` green (3 tests)
- [x] `cargo test -p bestialitty-core --test boundary_api_shape` green (10 tests, ≥8 required)
- [x] `cargo test --workspace --all-targets` green (128 tests)
- [x] `cargo fmt --all -- --check` exits 0
- [x] `cargo clippy --workspace --all-targets -- -D warnings` exits 0
- [x] `cargo build --target x86_64-unknown-linux-gnu --workspace` exits 0
- [x] CORE-02 manual metadata grep green

## Requirements Closed This Plan

| ID | How satisfied |
|----|---------------|
| CORE-02 | `tests/core_02_no_browser_deps.rs` enforces zero browser deps automatically on every `cargo test` run. Dep graph gate covers the build-tree route; source-file gate covers the import-attr route; Cargo.toml gate covers the crate-type drift route. The VALIDATION.md manual-grep sanity check still passes (`! cargo metadata | grep` returns exit 0). Plan 01 established the clean workspace state; this plan ensures it can never silently regress. |

## Phase 1 Exit Success Criteria

All 5 Phase 1 ROADMAP success criteria confirmed satisfied as of this commit:

| SC  | Status | Evidence |
|-----|--------|----------|
| SC1 | Met (Plan 05) | Fixture runner at `tests/fixture_runner.rs` feeds captured-session-style bytes through production parser, diffs against `.trace` files; 8 fixtures green |
| SC2 | Met (Plan 05 + ADR spike) | 20 torn-chunk tests in `vt52.rs::tests`; spike demonstrated floor condition; production parser preserves the `std::mem::take` shuttle for sub-state across feed() boundaries |
| SC3 | Met (Plan 03) | `.planning/decisions/ADR-001-parser-strategy.md` committed 2026-04-21 locking vte `=0.15` |
| SC4 | Met (Plan 02) | `.planning/research/captures/capture-01-cpm-boot/` + `capture-02-basic/` both with bytes.bin + hexdump.txt + README.md; PARSER-07 (lf_implies_cr default) derived from capture-01 |
| SC5 | Met (Plan 07) | This plan's 3 automated CORE-02 tests + the VALIDATION.md manual metadata grep + `cargo build --target x86_64-unknown-linux-gnu --workspace` all green on commit 3cf6642 |

Phase 1 is **complete**.

## Known Stubs

None. Every function exposed in `lib.rs`'s pub-mod surface is wired to
real logic; no placeholder returns. `lib.rs` itself is intentionally
thin (6 pub mod lines) — Phase 2 will populate it with the wasm-bindgen
wrapper.

## Consumed By

- **Phase 2 (wasm-boundary):** consumes the exact `Terminal` and
  `key::encode` surface locked by `tests/boundary_api_shape.rs`. When
  Phase 2 adds `#[wasm_bindgen]` attrs to `lib.rs`, it MUST update
  `tests/core_02_no_browser_deps.rs::source_files_contain_no_wasm_attrs`
  to exempt that one file by path (NOT by lifting the grep).
- **Phase 3 / 4 / 5:** every future commit runs through these gates
  on `cargo test` — if anyone adds a browser crate outside Phase 2's
  `lib.rs`, the build fails loudly.

## Self-Check: PASSED

- [x] `test -f crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — present, 187 lines
- [x] `test -f crates/bestialitty-core/tests/boundary_api_shape.rs` — present, 149 lines
- [x] `git log` shows commits `b0e40ff`, `1604243`, `3cf6642` on main
- [x] `cargo fmt --all -- --check` exits 0
- [x] `cargo clippy --workspace --all-targets -- -D warnings` exits 0
- [x] `cargo test --workspace --all-targets` passes (128 tests)
- [x] `cargo build --target x86_64-unknown-linux-gnu --workspace` exits 0
- [x] `! cargo metadata --format-version=1 -p bestialitty-core | grep -E '"name":"(web-sys|js-sys|wasm-bindgen)"'` — CLEAN
