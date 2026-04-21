---
phase: 01-rust-core-parser-grid-key-encoder
plan: 01
subsystem: infra
tags: [rust, cargo, workspace, wasm, edition-2024]

# Dependency graph
requires:
  - phase: 00-initialization
    provides: .planning/ directory structure + phase context
provides:
  - Cargo workspace (resolver 3, Edition 2024, Rust 1.85 pinned)
  - bestialitty-core crate (cdylib + rlib dual crate-type)
  - Wasm-free logic module skeleton (terminal, grid, scrollback, dirty, vt52, key)
  - Integration test target (tests/fixture_runner.rs) + tests/fixtures/ reserved path
  - trace-malformed Cargo feature gate reserved for Plan 04
  - rust-toolchain.toml pinned to stable + rustfmt + clippy
  - .planning/research/captures/ reserved for Plan 02 (MicroBeast live captures)
  - .planning/decisions/ reserved for Plan 03 (ADR-001 parser strategy)
affects: [01-02 live-capture, 01-03 parser-spike, 01-04 parser-impl, 01-05 key-encoder, 01-06 cross-target-verify, 02-wasm-boundary]

# Tech tracking
tech-stack:
  added:
    - "rustc 1.94.1 stable (meets rust-version 1.85)"
    - "Cargo resolver 3 (Edition 2024)"
  patterns:
    - "Workspace root with single member crate at crates/bestialitty-core/"
    - "cdylib + rlib dual crate-type (enables cargo test as rlib AND Phase 2 wasm-pack build)"
    - "Wasm-free logic modules; wasm-bindgen attrs confined to lib.rs boundary (D-19/D-20)"
    - "Doc-comment-only stubs pin module responsibility + downstream plan ownership"

key-files:
  created:
    - Cargo.toml (workspace root — included in baseline commit; no changes needed)
    - rust-toolchain.toml
    - .gitignore
    - Cargo.lock (auto-generated; tracked per workspace convention)
    - crates/bestialitty-core/Cargo.toml
    - crates/bestialitty-core/src/lib.rs
    - crates/bestialitty-core/src/terminal.rs
    - crates/bestialitty-core/src/grid.rs
    - crates/bestialitty-core/src/scrollback.rs
    - crates/bestialitty-core/src/dirty.rs
    - crates/bestialitty-core/src/vt52.rs
    - crates/bestialitty-core/src/key.rs
    - crates/bestialitty-core/tests/fixture_runner.rs
    - crates/bestialitty-core/tests/fixtures/.gitkeep
    - .planning/research/captures/.gitkeep
    - .planning/decisions/.gitkeep
  modified: []

key-decisions:
  - "Pin rust-toolchain.toml now (D 'Claude's Discretion' — costs nothing; de-risks Plan 03 vte spike)"
  - "Include placeholder src/lib.rs in Task 1 so cargo check --workspace resolves the manifest (Task 1 verify requires this; full module tree lands in Task 2)"
  - "Track Cargo.lock in VCS for the workspace (cdylib project — convention matches binaries per cargo docs; .gitignore deliberately does NOT exclude it)"

patterns-established:
  - "Cargo workspace layout with resolver 3 + Edition 2024 + rust-version 1.85"
  - "Dual cdylib+rlib crate-type so the same crate backs wasm + native test harness + future native shell (CONTEXT D-20 cross-target reuse)"
  - "Logic modules are wasm-free; boundary attrs confined to lib.rs (CONTEXT D-19)"
  - "Integration tests live in tests/fixture_runner.rs — Plan 04 extends this single target instead of inventing new ones"
  - ".gitkeep sentinels reserve directory paths for downstream-plan output (captures/, decisions/)"

requirements-completed:
  - CORE-01
  - CORE-02
  - PARSER-08

# Metrics
duration: 3m
completed: 2026-04-21
---

# Phase 1 Plan 01: Cargo Workspace + bestialitty-core Skeleton Summary

**Greenfield Cargo workspace (resolver 3, Edition 2024, Rust 1.85 pinned) with bestialitty-core crate scaffolded as cdylib+rlib, six wasm-free logic module stubs, integration test harness, and reserved planning sub-directories for Plans 02/03 output — `cargo test` green at zero tests, zero browser deps in resolved graph.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-21T13:07:50Z
- **Completed:** 2026-04-21T13:11:21Z
- **Tasks:** 3
- **Files modified:** 15 (14 created + 1 placeholder lib.rs upgraded in-flight)

## Accomplishments

- Cargo workspace parses and `cargo check --workspace` exits 0
- `cargo test -p bestialitty-core --lib` and `--test fixture_runner` both report "running 0 tests" green
- `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core` succeeds (CORE-02 baseline)
- `cargo metadata` confirms zero browser deps in resolved graph (no web-sys, js-sys, wasm-bindgen, vte)
- Six logic modules (terminal, grid, scrollback, dirty, vt52, key) exist as wasm-free doc-comment stubs
- Integration test target (tests/fixture_runner.rs) reachable — Plan 04 can extend without inventing a new target
- `trace-malformed` Cargo feature gate reserved (prevents Plan 04 inventing a parallel feature name)
- `.planning/research/captures/` + `.planning/decisions/` reserved with `.gitkeep` sentinels for Plans 02/03

## Task Commits

Each task was committed atomically:

1. **Task 1: Create workspace root + crate manifest + toolchain pin** — `58f5183` (feat)
2. **Task 2: Create lib.rs stub + all empty logic module files + empty tests dir** — `fe0e28f` (feat)
3. **Task 3: Create planning sub-directories for Plans 02 and 03 output** — `a669142` (chore)

_The root `Cargo.toml` itself was already present in the pre-execution baseline commit `dca1519`; this plan verified its content matched Task 1's requirements and added the companion manifests / toolchain / gitignore around it._

## Files Created/Modified

**Build/config:**
- `rust-toolchain.toml` — stable + rustfmt + clippy; wasm32 target deferred to Phase 2
- `.gitignore` — /target/, editor backups; Cargo.lock intentionally tracked
- `Cargo.lock` — auto-generated by `cargo check`; tracked per workspace convention
- `crates/bestialitty-core/Cargo.toml` — package manifest, cdylib+rlib crate-type, trace-malformed feature gate

**Rust skeleton (all wasm-free):**
- `crates/bestialitty-core/src/lib.rs` — thin module-declaration boundary (wasm-bindgen exports land in Phase 2)
- `crates/bestialitty-core/src/terminal.rs` — VT52 semantic layer stub (Plan 04)
- `crates/bestialitty-core/src/grid.rs` — 80×24 Cell repr(C) stub (Plan 04)
- `crates/bestialitty-core/src/scrollback.rs` — VecDeque ring stub (Plan 04)
- `crates/bestialitty-core/src/dirty.rs` — byte-per-row dirty bitmap stub (Plan 04)
- `crates/bestialitty-core/src/vt52.rs` — parser state machine stub (Plan 04, driven by Plan 03 ADR)
- `crates/bestialitty-core/src/key.rs` — key encoder stub (Plan 05)
- `crates/bestialitty-core/tests/fixture_runner.rs` — integration test harness stub (Plan 04 populates)
- `crates/bestialitty-core/tests/fixtures/.gitkeep` — reserves fixtures path

**Planning:**
- `.planning/research/captures/.gitkeep` — reserves Plan 02 output directory
- `.planning/decisions/.gitkeep` — reserves Plan 03 ADR output directory

## Decisions Made

- **Cargo.lock tracked in VCS** — for a workspace hosting a cdylib/binary-adjacent project, cargo convention is to commit the lockfile; `.gitignore` deliberately does not exclude it. Matches plan comment on .gitignore content.
- **Placeholder lib.rs written in Task 1, upgraded in Task 2** — Task 1's verify step runs `cargo check --workspace`, which requires `src/lib.rs` to exist for the manifest to resolve. Documented as Rule 3 (blocking) auto-fix below; the intent of Task 1's verify is "manifests parse" and a zero-content lib.rs satisfies that while preserving Task 2's actual content scope.
- **rust-toolchain.toml pinned now** (per D "Claude's Discretion" ceiling) — the plan text explicitly green-lit pinning in Phase 1; did so. Phase 2 will add the wasm32-unknown-unknown target.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added placeholder src/lib.rs in Task 1 to make `cargo check` pass**
- **Found during:** Task 1 verification step
- **Issue:** Task 1's verify (`cargo check --manifest-path Cargo.toml --workspace`) requires a resolvable library crate, which in turn requires `src/lib.rs` to exist. As written, Task 1 creates no source files — only manifests. `cargo check --workspace` therefore errors with "can't find library `bestialitty_core`, rename file to `src/lib.rs` or specify lib.path". Task 2 is what populates lib.rs per the plan's literal task split.
- **Fix:** Wrote a single-line placeholder comment into `crates/bestialitty-core/src/lib.rs` during Task 1. Task 2 then overwrote this with the full module-declaration content.
- **Files modified:** `crates/bestialitty-core/src/lib.rs`
- **Verification:** `cargo check --workspace` exits 0 after Task 1 (previously errored); Task 2 verifies full module tree with `cargo test --lib` and `--test fixture_runner` both reporting "running 0 tests".
- **Committed in:** `58f5183` (Task 1 commit), superseded by `fe0e28f` (Task 2 commit)

**2. [Rule 1 - Plan self-inconsistency] Comment-vs-code false positives in acceptance greps**
- **Found during:** Task 1 + Task 2 verification
- **Issue:** Two acceptance criteria use shell-grep patterns that match documentation comments the plan itself authored. Task 1: `! grep -E "web-sys|js-sys|wasm-bindgen|vte" crates/bestialitty-core/Cargo.toml` — the plan's own Cargo.toml template contains a comment "Plan 03 spike MAY add `vte = \"0.15\"` if the vte-path wins the spike" which triggers the grep on `vte` and `wasm-bindgen`. Task 2: `! grep -rE "wasm_bindgen|web_sys|js_sys" crates/bestialitty-core/src/` — the plan's own lib.rs template contains a doc-comment documenting the architectural rule that forbids those attrs.
- **Fix:** Interpreted intent over literal grep. The *intent* of both criteria is "no actual dependency / no actual usage"; verified via `cargo metadata --format-version=1 -p bestialitty-core` (shows zero browser crates in resolved dep graph) and semantic inspection (zero attribute macros / imports in src/, only doc-comment prose references).
- **Files modified:** none (no code change needed — plan text was correct; only the automated grep patterns were too broad)
- **Verification:** `cargo metadata` shows 1 package (`bestialitty-core`) with zero deps; `grep -rE "wasm_bindgen|web_sys|js_sys" crates/bestialitty-core/src/ | grep -v '//!'` returns empty.
- **Committed in:** n/a (documentation-only; noted here for Plan 04 author so they do not repeat these grep patterns verbatim)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 plan-self-inconsistency)
**Impact on plan:** Neither altered plan scope or acceptance intent. #1 is a sequencing fix between Task 1 and Task 2 (one extra file write plus one in-place upgrade). #2 is a note about the acceptance-grep patterns for future plans.

## Issues Encountered

None material. The Task 1 `cargo check` requirement surfacing the need for a placeholder lib.rs was anticipated by the plan framing ("no code yet — this proves manifests parse") but required an extra file for cargo to actually parse the manifest; documented as Deviation #1.

## TDD Gate Compliance

Not applicable — this plan's frontmatter is `type: execute`, not `type: tdd`. The three tasks are all scaffolding (no production logic), so `feat` and `chore` commit types are appropriate.

## Self-Check: PASSED

- **Created files exist:**
  - `Cargo.toml` (workspace root): FOUND
  - `rust-toolchain.toml`: FOUND
  - `.gitignore`: FOUND
  - `Cargo.lock`: FOUND
  - `crates/bestialitty-core/Cargo.toml`: FOUND
  - `crates/bestialitty-core/src/{lib,terminal,grid,scrollback,dirty,vt52,key}.rs`: all FOUND
  - `crates/bestialitty-core/tests/fixture_runner.rs`: FOUND
  - `crates/bestialitty-core/tests/fixtures/.gitkeep`: FOUND
  - `.planning/research/captures/.gitkeep`: FOUND
  - `.planning/decisions/.gitkeep`: FOUND
- **Commits exist:**
  - `58f5183` (Task 1): FOUND
  - `fe0e28f` (Task 2): FOUND
  - `a669142` (Task 3): FOUND
- **Verification commands:**
  - `cargo check --workspace` → exit 0
  - `cargo test -p bestialitty-core --lib` → "running 0 tests", exit 0
  - `cargo test -p bestialitty-core --test fixture_runner` → "running 0 tests", exit 0
  - `cargo build --target x86_64-unknown-linux-gnu -p bestialitty-core` → exit 0
  - `cargo metadata` → zero browser deps in resolved graph

## Next Phase Readiness

**Ready for Plan 01-02 (live MicroBeast capture):**
- `.planning/research/captures/` directory exists, ready for `capture-01-cpm-boot/` + `capture-02-basic/` subdirectories.
- No Rust-side dependency — Plan 02 is a capture-tool (tio/minicom) session plus hex annotation.

**Ready for Plan 01-03 (parser strategy spike + ADR-001):**
- `.planning/decisions/` directory exists, ready for `ADR-001-parser-strategy.md`.
- `crates/bestialitty-core/src/vt52.rs` exists as an empty stub — the spike can prototype both hand-rolled and vte-based implementations in temporary branches without conflicting with other module files.
- `crates/bestialitty-core/Cargo.toml` has NO `vte` dependency yet — Plan 03 adds it only if the vte-path wins the spike.

**Ready for Plans 01-04 (parser impl) / 01-05 (key encoder):**
- All six logic module files exist as separate files, so the two plans can edit distinct files in parallel without lib.rs merge conflicts (CONTEXT D-19 rationale honoured).
- `trace-malformed` Cargo feature gate reserved — Plan 04 implements the ring-buffer behind it without manifest churn.
- `tests/fixture_runner.rs` exists as a single integration target — Plan 04 populates it with the Recording Terminal API + paired .bin/.trace fixtures.

**No blockers for Phase 1.** CORE-01, CORE-02, PARSER-08 unblocked at the baseline level (real completion criteria for PARSER-08 involve capture + ADR, which lands in Plans 02/03).

---
*Phase: 01-rust-core-parser-grid-key-encoder*
*Completed: 2026-04-21*
