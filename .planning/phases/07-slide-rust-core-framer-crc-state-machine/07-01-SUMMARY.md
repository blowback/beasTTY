---
phase: 07-slide-rust-core-framer-crc-state-machine
plan: 01
subsystem: rust-core
tags: [slide, crc, crc-16-ccitt, ccitt-false, foundations, rust, wasm-free]

# Dependency graph
requires:
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: bestialitty-core crate scaffold (cdylib+rlib, mod-tree convention, #[cfg(test)] mod tests block style, D-20 cross-target reuse, D-15 silent-discard policy)
  - phase: 02-wasm-boundary
    provides: pub(crate) visibility convention enforced by tests/core_02_no_browser_deps.rs (lib.rs is the only wasm_bindgen-permitted file)
provides:
  - "crates/bestialitty-core/src/slide/ module skeleton (mod.rs + crc.rs)"
  - "pub(crate) fn crc16_ccitt(&[u8]) -> u16 — CCITT-FALSE variant, verbatim from slide-rs/protocol.rs:16-30 per CONTEXT D-01"
  - "Greg Cook catalogue reference vector pin (b\"123456789\" -> 0x29B1)"
  - "Cargo.toml D-01 audit-trail comment: rejected `crc = \"=3.4\"` crate; zero new external deps"
  - "pub mod slide; reachable from lib.rs in alphabetical position"
affects: [07-02-framer, 07-03-receiver-state-machine, 07-04-sender-state-machine, 07-05-adr, 08-wasm-boundary]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "verbatim-copy-from-upstream: source-level cross-validation against slide-rs as the wire-correctness gate (no build-time dependency on slide-rs)"
    - "non-negotiable reference-vector pin: single test (b\"123456789\" -> 0x29B1) distinguishes CCITT-FALSE from XMODEM/CCITT-AUG/KERMIT before any framer is written"
    - "transient #[allow(dead_code)] with cross-plan removal note when a primitive lands one plan ahead of its consumer"

key-files:
  created:
    - "crates/bestialitty-core/src/slide/mod.rs (slide module surface, D-20 wasm-free header)"
    - "crates/bestialitty-core/src/slide/crc.rs (pub(crate) crc16_ccitt + 3 unit tests)"
  modified:
    - "crates/bestialitty-core/src/lib.rs (alphabetical insert: pub mod slide;)"
    - "crates/bestialitty-core/Cargo.toml (D-01 audit-trail comment after vte block)"

key-decisions:
  - "CRC implementation is verbatim from /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30 per CONTEXT D-01; visibility narrowed to pub(crate) per D-03"
  - "Reference vector b\"123456789\" -> 0x29B1 is the single non-negotiable pin (D-04(a)); empty-input -> 0xFFFF and single-byte mutation tests are the supporting smokes"
  - "Cargo.toml records the rejected crc=\"=3.4\" crate as an audit-trail comment, NOT as a [dependencies] entry — zero new deps in graph"
  - "lib.rs pub mod slide; was pulled forward into Task 1 RED commit (Rule 3 deviation) because Task 1's verify command requires module reachability before Task 2's Cargo.toml comment can run"
  - "#[allow(dead_code)] on crc16_ccitt is a transient marker for the Plan 07-01 -> 07-02 gap; framer in 07-02 wires the call site and the allow can be removed then"

patterns-established:
  - "Slide module module-doc convention: explicit D-20 + D-XX cross-references in //! header (mirrors terminal.rs:1-8, vt52.rs:1-34 style with phase-specific decision IDs)"
  - "Reference-vector-first test ordering: variant-pinning catalogue test FIRST in the test block, init-pin and mutation-smoke tests as follow-ons"
  - "Audit-trail-only Cargo.toml comment for rejected dependencies: documents the decision in-tree without polluting [dependencies]"

requirements-completed: [SLIDE-01, SLIDE-03]

# Metrics
duration: 4min
completed: 2026-05-06
---

# Phase 7 Plan 01: SLIDE CRC Foundation Summary

**SLIDE module skeleton with CRC-16-CCITT (CCITT-FALSE) primitive, verbatim from slide-rs, pinned to the Greg Cook catalogue reference vector — no new dependencies in the graph.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-06T22:53:31Z
- **Completed:** 2026-05-06T22:57:39Z
- **Tasks:** 2 (Task 1 split into TDD RED + GREEN commits)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `crates/bestialitty-core/src/slide/` module exists with `pub mod crc;` declaration and module-doc header pinning the D-20 wasm-free architectural rule
- `pub(crate) fn crc16_ccitt(&[u8]) -> u16` implemented byte-for-byte from `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30` — CCITT-FALSE variant (poly 0x1021, init 0xFFFF, no refin/refout, xorout 0)
- Three unit tests passing: catalogue reference vector (`b"123456789" -> 0x29B1`, D-04(a) NON-NEGOTIABLE), empty-input init pin (`&[] -> 0xFFFF`), single-byte mutation smoke (`[0x00] != 0xFFFF`)
- `pub mod slide;` reachable from `lib.rs` in alphabetical position (between `scrollback` and `terminal`)
- `Cargo.toml` records the rejected `crc = "=3.4"` crate as an audit-trail comment with cross-link to ADR-003 (Plan 07-05) and CONTEXT §D-01 — zero new dependencies enter the graph
- `tests/core_02_no_browser_deps.rs` invariant remains green; the new `slide/` module is wasm-free and the dependency graph excludes browser crates
- Whole-crate `cargo test -p bestialitty-core` passes 164 tests with zero warnings

## Task Commits

Each task was committed atomically following the TDD RED/GREEN cycle for Task 1:

1. **Task 1 RED: failing CRC reference-vector tests** — `2ed1c60` (test)
   - slide/mod.rs + slide/crc.rs (stub returning 0) + lib.rs `pub mod slide;`
   - Catalogue and empty-input tests fail; mutation smoke passes by accident against stub
2. **Task 1 GREEN: verbatim CRC-16-CCITT impl from slide-rs** — `de4312d` (feat)
   - All 3 tests pass; byte-for-byte match with slide-rs/protocol.rs:16-30
3. **Task 2: D-01 audit comment + transient dead_code allow** — `bce2cdb` (chore)
   - Cargo.toml D-01 audit-trail comment after vte block
   - `#[allow(dead_code)]` on `crc16_ccitt` with explicit Plan 07-02 removal note

REFACTOR phase skipped: implementation is verbatim and idiomatic; nothing to clean up.

## Files Created/Modified

- **`crates/bestialitty-core/src/slide/mod.rs`** (created) — module surface declaration, `pub mod crc;`, module-doc header pinning D-20 wasm-free invariant and explaining the Phase 7 Plan 01 -> 07-05 module-tree growth path
- **`crates/bestialitty-core/src/slide/crc.rs`** (created) — `pub(crate) fn crc16_ccitt(&[u8]) -> u16` verbatim from slide-rs, 3 unit tests in `#[cfg(test)] mod tests` block, doc-comments documenting the CCITT-FALSE variant constants and the D-01/D-02/D-03/D-04(a) decision references
- **`crates/bestialitty-core/src/lib.rs`** (modified, lines 16-22) — `pub mod slide;` inserted in alphabetical order between `scrollback` and `terminal`
- **`crates/bestialitty-core/Cargo.toml`** (modified, lines 24-30) — D-01 audit-trail comment recording the rejected `crc = "=3.4"` crate, with cross-links to ADR-003 (Plan 07-05) and 07-CONTEXT.md §D-01

## Decisions Made

- **Verbatim copy from slide-rs over hand-rewrite (CONTEXT D-01):** the ~30-line CRC body is byte-for-byte identical to the upstream reference implementation. Future divergence is a Phase 7 bug, not an upstream change — slide-rs is ground truth for SLIDE v0.2 wire correctness. Visibility is the only deviation from upstream (`pub(crate)` here, `pub` upstream).
- **`#[allow(dead_code)]` is intentional and transient (this plan only).** The framer in Plan 07-02 wires the call site; the allow MUST be removed there. An explicit comment on the function says so.
- **`pub mod slide;` was pulled forward into Task 1 RED.** The plan's Task 1 verify command (`cargo test slide::crc::tests --lib`) cannot run unless `slide` is reachable from `lib.rs`. Task 2's lib.rs edit thus became a no-op; only the Cargo.toml audit comment remains as Task 2's net change. Documented under Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wired `pub mod slide;` into lib.rs at Task 1 RED instead of Task 2**

- **Found during:** Task 1 (CRC reference-vector tests)
- **Issue:** The plan's Task 1 verify command (`cargo test -p bestialitty-core slide::crc::tests --lib`) requires the `slide` module to be reachable from `lib.rs`. As planned, Task 1 only created `slide/mod.rs` + `slide/crc.rs` and Task 2 added the `pub mod slide;` line — meaning Task 1's verify command would error with "unresolved module" until Task 2 ran. Per-task verify-and-commit was therefore impossible.
- **Fix:** Added `pub mod slide;` to `lib.rs` (alphabetical position between `scrollback` and `terminal`) as part of Task 1's RED commit. Task 2's `lib.rs` edit then collapsed to a no-op confirmation — the file already has the correct line. Task 2 retained its meaningful work (the Cargo.toml D-01 audit comment).
- **Files modified:** `crates/bestialitty-core/src/lib.rs` (Task 1 RED commit instead of Task 2)
- **Verification:** `cargo test -p bestialitty-core slide::crc::tests --lib` ran successfully against the stub (RED → 2 fails as expected) and against the verbatim impl (GREEN → 3 passes); whole-crate `cargo test` 164/164 green; `core_02_no_browser_deps` 3/3 green.
- **Committed in:** `2ed1c60` (Task 1 RED commit)

**2. [Rule 1 - Bug] Silenced transient `dead_code` warning on `crc16_ccitt`**

- **Found during:** Task 2 (full verify gauntlet)
- **Issue:** `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` emitted a `warning: function 'crc16_ccitt' is never used` because Plan 07-01 ships the CRC primitive but the framer that consumes it lands in Plan 07-02. Without the allow, this warning would clutter every native build for the gap between plans. The function is `pub(crate)` — narrower than `pub`, so the standard "exported public API" exemption Rust uses for `pub` items doesn't apply.
- **Fix:** Added `#[allow(dead_code)]` directly above `pub(crate) fn crc16_ccitt` with an explicit comment: "Phase 7 Plan 01 -> 07-02 transient: this plan ships only the CRC primitive; the framer that calls it lands in Plan 07-02. Remove the allow when 07-02's framer wires up the call site."
- **Files modified:** `crates/bestialitty-core/src/slide/crc.rs`
- **Verification:** `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` finishes with no warnings; CRC tests still 3/3 green; whole crate 164/164 green.
- **Committed in:** `bce2cdb` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 bug)
**Impact on plan:** Both fixes were necessary to keep per-task verification honest and the build output clean. No scope creep — both fixes are tightly bounded to a single line each, and the Rule 1 fix carries an explicit removal trigger tied to the next plan.

## TDD Gate Compliance

Task 1 followed the TDD RED/GREEN cycle as specified by `tdd="true"` in the plan:

- **RED gate** (`2ed1c60`, `test(07-01)`): catalogue and empty-input tests fail against the deliberately-wrong stub; mutation-smoke test passes accidentally (stub returns `0`, which is `!= 0xFFFF`). Failure is in the function logic, not the build setup.
- **GREEN gate** (`de4312d`, `feat(07-01)`): verbatim slide-rs implementation; all 3 tests pass.
- **REFACTOR gate**: skipped — verbatim copy is idiomatic and matches upstream byte-for-byte.

The `test(...)` -> `feat(...)` ordering is verifiable in `git log --oneline -3`. Plan-level TDD gate compliance: PASSED.

## Issues Encountered

None — both deviations were anticipated by the deviation-rule framework (Rule 3 for blocking issues, Rule 1 for warning-as-bug). No surprises during execution.

## User Setup Required

None — no external service configuration, no auth gates, no human-action checkpoints. This is a pure-Rust, native-cargo-test plan.

## Next Phase Readiness

**Plan 07-02 (framer) is unblocked.** Plan 07-02 can now:

- Import `crate::slide::crc::crc16_ccitt` from `slide/framer.rs` (same crate, `pub(crate)` reachable)
- Add `#[cfg(test)] pub use crate::slide::crc::crc16_ccitt;` in `slide/tests_only.rs` so integration tests under `tests/slide_*.rs` can reach the primitive across the crate boundary
- Build the byte-fed framer state machine on top of a correctness-proven CRC primitive — the catalogue vector pin distinguishes CCITT-FALSE from sibling variants before a single frame is parsed
- **Remove the `#[allow(dead_code)]`** on `crc16_ccitt` once the framer wires the call site (the function comment says so explicitly)

**No blockers for downstream plans.** The wasm-free invariant remains green; ADR-003 (Plan 07-05) will document the v0.2.1 CAN amendment on top of this foundation.

## Self-Check: PASSED

**File-existence checks** (all FOUND):

- `crates/bestialitty-core/src/slide/mod.rs` — FOUND
- `crates/bestialitty-core/src/slide/crc.rs` — FOUND
- `crates/bestialitty-core/src/lib.rs` — FOUND (modified)
- `crates/bestialitty-core/Cargo.toml` — FOUND (modified)

**Commit-existence checks** (all FOUND in `git log`):

- `2ed1c60` — FOUND (Task 1 RED)
- `de4312d` — FOUND (Task 1 GREEN)
- `bce2cdb` — FOUND (Task 2)

**Acceptance-criteria checks** (all PASS):

- mod.rs contains `pub mod crc;` — PASS
- crc.rs contains `pub(crate) fn crc16_ccitt(data: &[u8]) -> u16` — PASS
- crc.rs contains init constant `let mut crc: u16 = 0xFFFF;` — PASS
- crc.rs contains polynomial `crc = (crc << 1) ^ 0x1021;` — PASS
- crc.rs contains no `wasm_bindgen` / `web_sys` / `js_sys` / `std::time` — PASS
- lib.rs contains `pub mod slide;` between `scrollback` and `terminal` — PASS
- Cargo.toml contains `REJECTED` — PASS
- Cargo.toml `[dependencies]` has no `^crc =` line — PASS
- `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` exits 0 — PASS
- `cargo test -p bestialitty-core slide::crc --lib` 3/3 — PASS
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` 3/3 — PASS
- `cargo test -p bestialitty-core` 164/164 — PASS

---
*Phase: 07-slide-rust-core-framer-crc-state-machine*
*Completed: 2026-05-06*
