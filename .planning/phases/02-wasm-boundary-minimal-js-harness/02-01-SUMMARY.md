---
phase: 02-wasm-boundary-minimal-js-harness
plan: 01
subsystem: infra
tags: [wasm, wasm-bindgen, cargo, toolchain, gating, cfg-target-arch, adr]

# Dependency graph
requires:
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "cdylib+rlib crate type (D-19), FORBIDDEN_CRATES / FORBIDDEN_TOKENS gate in core_02_no_browser_deps.rs, rust-toolchain.toml pinned to stable+rustfmt+clippy (wasm32 deferred)"
provides:
  - "wasm32-unknown-unknown target declared in rust-toolchain.toml (auto-installed by rustup on next cargo invocation)"
  - "target-specific dependency table [target.'cfg(target_arch = \"wasm32\")'.dependencies] wasm-bindgen = \"0.2.118\" in crates/bestialitty-core/Cargo.toml"
  - "Updated CORE-02 test allowing wasm-bindgen crate in metadata and per-token/per-file exemption (wasm_bindgen allowed in lib.rs only; web_sys/js_sys forbidden everywhere)"
  - "ADR-002-wasm-gating.md recording the three-candidate evaluation and choice of Candidate A"
affects:
  - "02-02 (static harness) / 02-03 (lib.rs wasm_boundary module) / 02-04 (boundary API shape extension) / 02-05 (snapshot_grid pack-buffer)"
  - "Every future Phase 2 plan relies on the wasm build path working and on CORE-02 not false-positiving on wasm_bindgen in lib.rs"

# Tech tracking
tech-stack:
  added: ["wasm-bindgen 0.2.118 (target-specific)", "wasm32-unknown-unknown rust target"]
  patterns:
    - "Target-specific dependency + cfg(target_arch = \"wasm32\") gating (ADR-002 Candidate A)"
    - "Per-token, per-file forbidden-token exemption via FORBIDDEN_TOKENS_WITH_EXEMPTIONS tuple list"

key-files:
  created:
    - ".planning/decisions/ADR-002-wasm-gating.md"
  modified:
    - "rust-toolchain.toml"
    - "crates/bestialitty-core/Cargo.toml"
    - "crates/bestialitty-core/tests/core_02_no_browser_deps.rs"
    - "Cargo.lock"

key-decisions:
  - "ADR-002 Candidate A: wasm-bindgen as target-specific dep + cfg(target_arch) gating (not plain dep, not feature flag)"
  - "FORBIDDEN_TOKENS upgraded to FORBIDDEN_TOKENS_WITH_EXEMPTIONS — per-token, per-file exemption; wasm_bindgen exempt in lib.rs only"
  - "wasm-bindgen kept in FORBIDDEN_CRATES was dropped; wasm-bindgen-futures / web-sys / js-sys / gloo-* remain forbidden per D-07/D-08"

patterns-established:
  - "Target-specific wasm dep table in Cargo.toml: pattern future crates with wasm boundaries should copy"
  - "Per-token exemption tuple list: future boundary-adjacent invariants that need per-file relaxation should use the same shape rather than path-based early-continue"

requirements-completed: [CORE-03]

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 2 Plan 01: Toolchain + Cargo.toml + CORE-02 Test Update Summary

**wasm32 target + target-specific wasm-bindgen 0.2.118 dep + CORE-02 gate re-armed for Phase 2 — native `cargo test` still works with zero flags, wasm build compiles clean, ADR-002 captures the Candidate A gating choice.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-21T16:44:26Z
- **Completed:** 2026-04-21T16:47:35Z
- **Tasks:** 3
- **Files modified:** 4 (3 edited, 1 created, 1 lockfile touched)

## Accomplishments

- `rust-toolchain.toml` now declares `targets = ["wasm32-unknown-unknown"]` so every contributor gets the target auto-installed on first `cargo` invocation.
- `crates/bestialitty-core/Cargo.toml` pulls `wasm-bindgen = "0.2.118"` only under `[target.'cfg(target_arch = "wasm32")'.dependencies]`, keeping native `cargo test` free of wasm-bindgen + its proc-macro transitives (`syn`, `quote`, `proc-macro2`).
- `cargo build --target wasm32-unknown-unknown -p bestialitty-core` compiles clean (`wasm-bindgen` plus `memchr`, `arrayvec`, `cfg-if`, `once_cell`, `bumpalo`, `rustversion`, `unicode-ident` resolved; no forbidden transitive).
- CORE-02 gate in `tests/core_02_no_browser_deps.rs` is re-armed for Phase 2: `wasm-bindgen` allowed in `cargo metadata`; `wasm_bindgen` token exempt only in `lib.rs` via a new `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` tuple list; `web_sys` / `js_sys` still forbidden everywhere (lib.rs included).
- `cargo test -p bestialitty-core` passes all 128 tests with zero flags (D-20 preserved).
- `ADR-002-wasm-gating.md` documents the three-mechanism evaluation and the Candidate A decision alongside ADR-001.

## Task Commits

Each task was committed atomically on `main`:

1. **Task 1: Add wasm32 target + target-specific wasm-bindgen dep** — `b7dfe66` (feat)
2. **Task 2: Update CORE-02 test — allow wasm-bindgen crate + per-token per-file exemption for lib.rs** — `2bd37cd` (test)
3. **Task 3: Record ADR-002 — wasm-bindgen target gating choice** — `1ebab6d` (docs)

## Files Created/Modified

- `rust-toolchain.toml` — added `targets = ["wasm32-unknown-unknown"]`; removed the "Phase 2 adds it" TODO comment.
- `crates/bestialitty-core/Cargo.toml` — appended new `[target.'cfg(target_arch = "wasm32")'.dependencies]` table with `wasm-bindgen = "0.2.118"`; all prior lines preserved verbatim (package, `crate-type = ["cdylib", "rlib"]`, features including `trace-malformed`, `vte = "=0.15"`, empty `[dev-dependencies]`).
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — (a) removed `"wasm-bindgen"` from `FORBIDDEN_CRATES` (documenting the removal inline); (b) replaced `FORBIDDEN_TOKENS` with `FORBIDDEN_TOKENS_WITH_EXEMPTIONS`; (c) updated `source_files_contain_no_wasm_attrs` scan loop to compute `file_rel` once per file and skip only the specific token that file is exempt from.
- `Cargo.lock` — auto-updated by cargo with 11 new packages required for the wasm32 target (wasm-bindgen + transitives). No workspace-wide version changes.
- `.planning/decisions/ADR-002-wasm-gating.md` — new ADR; mirrors ADR-001 header (Status/Date/Phase/Deciders) and section layout (Context / Decision / Consequences / Rejected Alternatives). Documents Candidate A adoption and cites the Rust+WebAssembly book pattern.

## Decisions Made

- **Candidate A (target-specific dep + cfg(target_arch)) adopted** as ADR-002 over Candidate B (plain dep, ~15s native test tax) and Candidate C (feature flag, footgun with empty lib.rs on wasm without `--features`). Honors D-20 (zero-flag `cargo test`) and keeps `wasm-pack build --target web` ceremony-free.
- **FORBIDDEN_TOKENS_WITH_EXEMPTIONS tuple shape** chosen over a `if path.ends_with("lib.rs") { continue }` early-continue because the simple form would regress D-07 by also exempting `web_sys` / `js_sys` in lib.rs. The per-token shape lets `wasm_bindgen` be exempt in lib.rs while `web_sys` / `js_sys` remain forbidden everywhere.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes triggered; no architectural questions surfaced; no authentication gates encountered.

## Issues Encountered

- Intermediate state between Task 1 and Task 2 left `cargo test -p bestialitty-core` failing (the stale `FORBIDDEN_CRATES` list still listed `wasm-bindgen`, which now appears in `cargo metadata` once wasm-bindgen is a Cargo.toml dep). This is expected by the plan's task ordering — Task 1 acceptance criteria do not require `cargo test` to pass, only `cargo build --target wasm32-unknown-unknown`. Task 2 intentionally removed the stale entry and all 3 CORE-02 tests went green, followed by the full 128-test native suite.

## Threat Flags

None — every file touched is the one the threat register already enumerated (T-02-01-01, T-02-01-02, T-02-01-03 covered by the verifications in this plan; T-02-01-04 accepted). No new trust-boundary surface was introduced beyond what Plan 01 explicitly scoped.

## User Setup Required

None — no external service configuration needed. Contributors running `cargo build` or `cargo test` for the first time after this change will have rustup auto-install the `wasm32-unknown-unknown` target from the `rust-toolchain.toml` `targets` field. The local build environment already had the target installed so no re-install was needed during this plan's verification.

## Threat Model Verification

- **T-02-01-01 (Tampering, FORBIDDEN_CRATES):** mitigated — only `wasm-bindgen` removed; `wasm-bindgen-futures` / `web-sys` / `js-sys` / all `gloo-*` still present; substring match on `"name":"<crate>"` JSON shape preserved. Verified via passing `dependency_graph_excludes_browser_crates` test.
- **T-02-01-02 (Tampering, per-token exemption logic):** mitigated — `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` uses per-token tuples; `web_sys` and `js_sys` have empty exemption lists so lib.rs is NOT exempted from them. Verified by reading the updated test body and by the passing `source_files_contain_no_wasm_attrs` assertion.
- **T-02-01-03 (DoS via transitive):** mitigated — `cargo tree -p bestialitty-core --target wasm32-unknown-unknown` returns no forbidden transitive (verified this session: no wasm-bindgen-futures, no web-sys, no js-sys, no gloo-*).
- **T-02-01-04 (Info disclosure, ADR-002):** accepted — no secrets in the ADR.

## Next Phase Readiness

- Plan 02-02 (minimal JS harness scaffold) can proceed: `wasm-pack build --target web` will resolve the target-specific `wasm-bindgen` dep via the Cargo.toml table added here.
- Plan 02-03 (lib.rs `wasm_boundary` module) can proceed: `lib.rs` is the allowed file for `#[wasm_bindgen]` per the updated CORE-02 exemption.
- Plan 02-04 (extend `boundary_api_shape.rs`) can proceed: the native test harness is untouched and compiles clean.
- Plan 02-05 (pack-buffer + snapshot_grid) can proceed: no blockers from this plan.
- No blockers or deferred items added.

## Self-Check: PASSED

Verified on disk:
- `rust-toolchain.toml` contains `targets = ["wasm32-unknown-unknown"]` ✓
- `crates/bestialitty-core/Cargo.toml` contains `[target.'cfg(target_arch = "wasm32")'.dependencies]` and `wasm-bindgen = "0.2.118"` ✓
- `crates/bestialitty-core/Cargo.toml` still contains `crate-type = ["cdylib", "rlib"]` and `vte = "=0.15"` ✓
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` contains `FORBIDDEN_TOKENS_WITH_EXEMPTIONS`, `("wasm_bindgen", &["lib.rs"])`, `("web_sys", &[])`, `("js_sys", &[])` ✓
- Old `const FORBIDDEN_TOKENS: &[&str] = ...` line removed ✓
- `.planning/decisions/ADR-002-wasm-gating.md` exists with required headings ✓

Verified via git:
- `b7dfe66` present in `git log --oneline` (Task 1) ✓
- `2bd37cd` present in `git log --oneline` (Task 2) ✓
- `1ebab6d` present in `git log --oneline` (Task 3) ✓

Verified via cargo:
- `cargo build --target wasm32-unknown-unknown -p bestialitty-core` exits 0 ✓
- `cargo test -p bestialitty-core` — 128 tests pass, 0 fail, 0 flags ✓
- `cargo tree -p bestialitty-core --target wasm32-unknown-unknown` — no forbidden transitive deps ✓

---
*Phase: 02-wasm-boundary-minimal-js-harness*
*Plan: 01*
*Completed: 2026-04-21*
