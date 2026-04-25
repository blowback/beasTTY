# Phase 6 — Deferred Items

Out-of-scope discoveries from plan execution. Logged here per the executor
deviation-rule scope boundary: "Only auto-fix issues DIRECTLY caused by the
current task's changes. Pre-existing warnings, linting errors, or failures
in unrelated files are out of scope."

## Pre-existing rustfmt drift in `boundary_api_shape.rs`

**Discovered during:** Plan 06-01 Task 2 (snapshot_at_offset.rs / clear_visible.rs stubs).

**Issue:** `cargo fmt --manifest-path crates/bestialitty-core/Cargo.toml --check`
reports 2 fmt diffs in `crates/bestialitty-core/tests/boundary_api_shape.rs`:
- Line 228: a multi-line `unsafe { ... }` block prefers single-line form.
- Line 237: a multi-line `assert_eq!` with short args prefers single-line form.

**Why deferred:** File was last touched in Phase 2 Plan 06; Plan 06-01 only
added two NEW test files which pass `rustfmt --check` cleanly on their own.
Per the executor's scope boundary, pre-existing fmt drift in unrelated files
is not auto-fixed.

**Suggested resolution:** Run `cargo fmt --manifest-path crates/bestialitty-core/Cargo.toml`
once at the start of any future Phase 6 plan that touches the bestialitty-core
crate (Plans 06-02 / 06-04 likely candidates). One-line fix; no behavior change.
