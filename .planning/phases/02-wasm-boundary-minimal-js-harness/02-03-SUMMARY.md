---
phase: 02-wasm-boundary-minimal-js-harness
plan: 03
subsystem: core
tags: [wasm, wasm-bindgen, boundary, facade, lib-rs, cfg-target-arch]

# Dependency graph
requires:
  - phase: 02-wasm-boundary-minimal-js-harness
    plan: 01
    provides: "target-specific wasm-bindgen 0.2.118 dep + FORBIDDEN_TOKENS_WITH_EXEMPTIONS gate (wasm_bindgen exempt only in lib.rs) + wasm32 target in rust-toolchain.toml"
  - phase: 02-wasm-boundary-minimal-js-harness
    plan: 02
    provides: "Terminal::snapshot_grid/pack_ptr/pack_byte_len/dirty_ptr + key::unpack_keycode(u32)->Option<KeyCode>/unpack_mods(u32)->Modifiers as pure-Rust methods"
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "Phase 1 Terminal pub surface (new/feed/cursor/rows/cols/bell_pending/clear_bell/dirty/clear_dirty/resize/resize_scrollback) + key::{KeyCode, Modifiers, KeyEvent, encode} + Cell #[repr(C)] 8-byte layout"
provides:
  - "crates/bestialitty-core/src/lib.rs cfg(target_arch=\"wasm32\") mod wasm_boundary { ... } — the D-09 façade"
  - "Wasm-exported Terminal class (constructor new + 13 methods + encode_key_raw free fn) produced by wasm-pack build --target web"
  - "Extended tests/boundary_api_shape.rs (14 tests = 10 Phase 1 preserved + 4 Phase 2 new) — compile-time pins for every Phase 2 signature (D-10)"
  - "Verified pkg/ artifact shape: bestialitty_core.js + bestialitty_core_bg.wasm + bestialitty_core.d.ts emitted cleanly"
affects:
  - "02-04 (static JS harness): can now `import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js'` against a real pkg/"
  - "02-05 (SC-4 64 KB demonstration + any end-to-end glue left): the façade that feed() calls cross is done"
  - "Phase 3 (canvas renderer): consumes Terminal.grid_ptr / grid_byte_len / dirty_ptr / snapshot_grid / cursor_packed via Uint8Array views over wasm.memory.buffer"
  - "Phase 4 (DOM keyboard): calls encode_key_raw(code, mods) with the packing scheme frozen in Plan 02-02 and now surfaced through lib.rs"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin #[wasm_bindgen] façade module gated by #[cfg(target_arch=\"wasm32\")] — native cargo test compiles lib.rs down to just the pub mod tree, zero wasm-bindgen resolution / proc-macro expansion"
    - "façade-over-pure-Rust: every exported method is a one-line forward to an already-tested crate::terminal::Terminal or crate::key::* item. No logic in lib.rs."
    - "Rust identifier == JS identifier (no #[wasm_bindgen(js_name=...)] renames) — JS imports { Terminal, encode_key_raw } with the exact Rust spelling"
    - "Option<T> unwrapped at the FFI boundary to an empty Vec, not a panic — encode_key_raw(unknown_tag, ...) returns Vec::new() (T-02-03-01 / RESEARCH Pitfall #4)"
    - "Compile-time signature pins in integration tests — type annotations (`let _ptr: *const u8 = ...`) make any return-type drift a build failure, not a silent JS-side break"

key-files:
  created: []
  modified:
    - "crates/bestialitty-core/src/lib.rs"
    - "crates/bestialitty-core/tests/boundary_api_shape.rs"

key-decisions:
  - "lib.rs is the SOLE file in the crate that carries wasm_bindgen tokens (D-06 / D-20). CORE-02 per-token per-file exemption added in Plan 01 is what makes it legal; verified by dedicated CORE-02 run."
  - "Entire façade lives inside a single #[cfg(target_arch=\"wasm32\")] mod wasm_boundary { ... } (ADR-002 Candidate A at the module level) rather than per-item cfg attributes — one gate, one attribute, zero cognitive overhead."
  - "Wrapper Terminal struct holds inner: CoreTerminal (aliased from crate::terminal::Terminal via `use ... as CoreTerminal`) rather than deriving From or Deref — keeps the boundary the explicit one-line forwards required by 'façade only, no logic'."
  - "cursor_packed re-expressed at the façade layer as `(r << 16) | c` on the tuple returned by inner.cursor() — no `cursor_packed` method on CoreTerminal (Plan 02 elected to pin the convention via a test rather than a method). Both Plan 02's test and this expression must stay in sync; drift in either fails cursor_packed_convention_round_trips."
  - "encode_key_raw's unknown-tag branch returns Vec::new() via the Option<KeyCode> from unpack_keycode — this is the single FFI-safe choice that lets JS detect 'nothing to send' as a zero-length Uint8Array rather than a wasm abort."

patterns-established:
  - "façade module pattern: cfg(target_arch=\"wasm32\") mod wasm_boundary { ... } — future Phase 2 / 3 / 4 additions to the wasm surface drop into this module, never leak attrs into logic modules"
  - "Compile-time pin pattern for boundary integration tests: explicit type annotations + trivial assertion. Adopted consistently across Phase 1 (10 pins) and Phase 2 (4 new pins) — any Phase 3+ boundary additions should extend the same file"
  - "Two-commit cadence per plan task (this plan): each task is its own atomic commit, no RED/GREEN since the Plan 02 tests already provide the safety net at the pure-Rust layer"

requirements-completed: [CORE-03, CORE-04, CORE-05]

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 2 Plan 03: Wasm-Bindgen Façade + Boundary Pin Extension Summary

**lib.rs is now the D-09 wasm-bindgen façade — a 140-line cfg(target_arch)-gated module of one-line forwards over the already-tested Plan 02 pure-Rust methods. `wasm-pack build --target web` emits a valid pkg/ with Terminal + encode_key_raw exports; CORE-02 stays green (lib.rs is the sole file with wasm_bindgen tokens); 14 boundary_api_shape tests (10 Phase 1 preserved + 4 Phase 2 new) lock the full Phase 2 signature surface as a compile-time contract.**

## Performance

- **Duration:** ~3 minutes (16:59:33Z → 17:02:31Z, executor-local)
- **Tasks:** 2 atomic commits on main
- **Files modified:** 2
- **Net tests added:** 4 new boundary_api_shape pins
- **Baseline test count:** 139 (post-Plan 02) → **143**
- **Wasm pkg size (release, wasm-opt enabled):** 40 KB (`/tmp/pkg-smoke-plan03/bestialitty_core_bg.wasm`) — informational

## Accomplishments

- `crates/bestialitty-core/src/lib.rs` grew from 17 lines of module declarations to 140 lines — appended a `#[cfg(target_arch = "wasm32")] mod wasm_boundary { ... }` block containing the full D-09 façade. The six `pub mod` declarations from Phase 1 are preserved verbatim. No `use` at the file root; `wasm_bindgen::prelude::*` is imported only inside the gated module.
- The façade exports a `Terminal` struct wrapping `crate::terminal::Terminal` (aliased `CoreTerminal` via `use ... as CoreTerminal`) with 14 `#[wasm_bindgen]` methods: `#[wasm_bindgen(constructor)] new(rows, cols, scrollback_cap)`, `feed`, `snapshot_grid`, `grid_ptr`, `grid_byte_len`, `dirty_ptr`, `rows`, `cols`, `clear_dirty`, `bell_pending`, `clear_bell`, `cursor_packed`, `resize`, `resize_scrollback`. Every method is a literal one-line forward. Plus the free `#[wasm_bindgen] pub fn encode_key_raw(code: u32, mods: u32) -> Vec<u8>` that matches `unpack_keycode` → `encode` → return-or-empty-on-None.
- `cursor_packed` uses `(r << 16) | c` exactly (matches Plan 02's `cursor_packed_convention_round_trips` pin). `encode_key_raw` returns `Vec::new()` on `unpack_keycode` returning `None` — never panics across the FFI boundary (T-02-03-01 / RESEARCH Pitfall #4). No `#[wasm_bindgen(js_name = ...)]` renames — JS imports every symbol by its Rust identifier.
- `wasm-pack build --target web --out-dir /tmp/pkg-smoke-plan03 crates/bestialitty-core` succeeded: emitted `bestialitty_core.js` (10 KB), `bestialitty_core_bg.wasm` (40 KB), `bestialitty_core.d.ts` (4.7 KB), `bestialitty_core_bg.wasm.d.ts` (1.3 KB). The generated `.d.ts` documents all 14 methods + `constructor(rows, cols, scrollback_cap)` + `encode_key_raw(code, mods)` exactly as D-09 specifies.
- `tests/boundary_api_shape.rs` extended from 10 to 14 tests: the four new pins (`terminal_snapshot_and_pointer_methods_have_stable_return_types`, `pack_ptr_stable_across_feed_per_d03`, `feed_accepts_large_slice_without_panic`, `key_unpack_signatures_are_stable`) cover every Phase 2 signature that the lib.rs façade forwards to. `use` line updated to import `unpack_keycode, unpack_mods` alongside the existing `KeyCode, KeyEvent, Modifiers, encode`. All 10 Phase 1 tests preserved verbatim.
- All native verifications green: `cargo test -p bestialitty-core` passes 143 tests with zero flags (118 lib + 14 boundary shape + 10 parser fixture + 3 CORE-02 + 0 doctests), `cargo fmt --check` clean, `cargo clippy --lib --tests -- -D warnings` clean.
- CORE-02 specifically: `cargo test -p bestialitty-core --test core_02_no_browser_deps` passes 3/3 — the `wasm_bindgen` token appears only in `src/lib.rs` (exempt); `web_sys` / `js_sys` / `gloo-*` / `wasm-bindgen-futures` appear nowhere in the crate.

## Task Commits

Each task was committed atomically on `main`:

1. **Task 1: lib.rs wasm-bindgen façade** — `c810870` (feat)
2. **Task 2: boundary_api_shape.rs Phase 2 pins** — `af91b17` (test)

## Files Created/Modified

- `crates/bestialitty-core/src/lib.rs` — replaced the 17-line stub with a 140-line file: original module doc comment expanded to describe the pure-Rust / wasm_boundary split and the D-06/D-20 architectural rule; original 6 `pub mod` lines preserved verbatim; new `#[cfg(target_arch = "wasm32")] mod wasm_boundary { ... }` block appended containing the `Terminal` wrapper struct, the 14-method `impl` block, and the free `encode_key_raw` fn. `wasm_bindgen::prelude::*` imported inside the gated module only; `crate::key::{self, KeyEvent, unpack_keycode, unpack_mods}` and `crate::terminal::Terminal as CoreTerminal` are the only logic-side imports.
- `crates/bestialitty-core/tests/boundary_api_shape.rs` — `use` line at the top updated to additionally import `unpack_keycode, unpack_mods` from `bestialitty_core::key`. Four new `#[test]` fns appended at end of file after `bell_end_to_end`. No existing test modified or removed. Net line change: +65 / -1 (the `-1` is the replaced `use` line).

## Decisions Made

- **Module-level cfg attribute rather than per-item**: `#[cfg(target_arch = "wasm32")] mod wasm_boundary { ... }` is one attribute for the whole façade instead of sprinkling `#[cfg]` across every item inside. Matches ADR-002 Candidate A at the module level — one gate, one attribute, zero cognitive overhead, and it makes native `cargo test` compile lib.rs down to just the `pub mod` tree.
- **Wrapper struct with `inner: CoreTerminal`**: explicit one-line forwards instead of deriving `Deref` or exposing `CoreTerminal` directly via `#[wasm_bindgen]`. The plan's constraints require "façade only, no logic" — a wrapper struct makes every boundary crossing visible and grep-able (`self.inner.<method>(...)` is the pattern to audit), and it leaves the pure-Rust `crate::terminal::Terminal` consumable by native callers and by future Rust-side users (e.g., a hypothetical desktop build) without wasm_bindgen baggage.
- **`cursor_packed` expressed in the façade rather than on `CoreTerminal`**: Plan 02 pinned the `(row << 16) | col` convention via a unit test (`cursor_packed_convention_round_trips`) on `CoreTerminal` rather than adding a `cursor_packed` method there. This plan honors that choice — the façade does the bit-packing directly. Any drift between the façade expression and Plan 02's test fails the test, catching divergence at `cargo test` time.
- **`encode_key_raw` None arm returns `Vec::new()`, not a panic or negative sentinel**: the FFI-safe choice per T-02-03-01. JS sees an empty `Uint8Array` and can branch on `.length === 0` to detect "nothing to send". A panic would abort the wasm module; a sentinel would steal a valid byte pattern from future keycodes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `wasm-pack build --no-opt` flag rejected by wasm-pack 0.12.1**
- **Found during:** Task 1 verification (initial `wasm-pack build --target web --out-dir /tmp/pkg-smoke-plan03 --no-opt` failed with `error: unexpected argument '--no-opt' found` — cargo surfaced it because wasm-pack passes unknown flags through to `cargo build`).
- **Issue:** The plan's action text specified `--no-opt` to suppress `wasm-opt` warnings, but wasm-pack 0.12.1 (installed locally, confirmed via `wasm-pack --version`) does not accept `--no-opt` as a build flag; it may be a different flag name or a newer-version-only option.
- **Fix:** Reran the command without `--no-opt`. The build succeeded in 4.5s + 7.3s optimization; `wasm-opt` produced informational-level warnings about a missing `repository` field and a missing `LICENSE` file (both are pre-existing Phase 1 Cargo.toml observations, out of scope for this plan), but the pkg/ directory was emitted cleanly with all four required files.
- **Files modified:** None (command-line only).
- **Commit:** N/A (build invocation, not a code change).

No Rule 1 (bug), Rule 2 (missing critical functionality), or Rule 4 (architectural) deviations triggered. No authentication gates.

## Issues Encountered

- `wasm-pack` 0.12.1 emits an informational warning recommending upgrade to 0.14.0. Not acted on — 0.12.1 works for `--target web` (confirmed by the successful pkg/ emission) and a toolchain bump is out of scope for Plan 03. If a future plan hits a real compatibility issue, `cargo install wasm-pack --force` upgrades in one step.
- `wasm-opt` informational warnings about missing `repository` Cargo.toml field and missing `LICENSE` file are pre-existing Phase 1 observations and out of scope. Noted for Phase 6 (Polish & Deployment) to pick up.

## Threat Flags

None — every file touched is enumerated in the plan's `<threat_model>` block. No new security-relevant surface was introduced beyond what lib.rs already scoped (JS→wasm boundary for Terminal::new / feed / encode_key_raw, all of which have disposition + mitigation documented). No new network endpoints, auth paths, file access, or schema changes at trust boundaries.

## User Setup Required

None — this is a pure code change, no external service configuration needed. Contributors who rebuild after this commit will:
- Pick up the extended CORE-02 exemption automatically (the tuple list from Plan 01 already allowed `wasm_bindgen` in lib.rs).
- Get 4 new `cargo test` cases automatically.
- Get a wasm pkg/ on `wasm-pack build --target web` — which will be exercised for real once Plan 04's static harness lands.

## Threat Model Verification

- **T-02-03-01 (Denial of Service, `encode_key_raw` FFI panic on malformed input):** mitigated. `encode_key_raw` matches on `unpack_keycode(code)`; the `None` arm returns `Vec::new()` directly rather than calling `encode`. Verified via `key_unpack_signatures_are_stable` (pins the `Option<KeyCode>` return type) + Plan 02's existing `unpack_keycode_unknown_tag_is_none` unit test. No wasm panic path in the façade.
- **T-02-03-02 (Denial of Service, `Terminal::feed` panic on malformed bytes):** mitigated. `feed_accepts_large_slice_without_panic` exercises a 65_536-byte payload through the public `feed()` — passes without panic. The underlying Phase 1 parser is total (silent discard on malformed per D-15), and the façade's `feed` is a one-line forward to that parser.
- **T-02-03-03 (Tampering, wasm_bindgen attribute leak into logic modules):** mitigated. CORE-02 test `source_files_contain_no_wasm_attrs` was re-run explicitly after Task 1 and passed 3/3 — `wasm_bindgen` appears only in `src/lib.rs` (exempt); `web_sys` / `js_sys` appear nowhere. Any future drift (e.g. a PR adding `#[wasm_bindgen]` to `terminal.rs`) fails this test.
- **T-02-03-04 (Tampering, boundary_api_shape.rs drift breaking JS silently):** mitigated. Task 2 added 4 compile-time pins for `snapshot_grid`, `pack_ptr`, `pack_byte_len`, `dirty_ptr`, `unpack_keycode`, `unpack_mods`. Any return-type change (e.g. `usize` → `u32`, `*const u8` → `*const Cell`, `Option<KeyCode>` → `KeyCode`) fails to compile the integration test — noisy, not silent.
- **T-02-03-05 (Information Disclosure, Cell `_pad: u8` leaking stack/heap garbage):** accepted. `Cell::BLANK` sets `_pad: 0`; `Cell::with_byte` sets `_pad: 0`. There is no code path that writes anything other than 0 to `_pad`. Phase 1 assertion; Plan 03 does not modify `grid.rs`.
- **T-02-03-06 (Elevation of Privilege, wasm-bindgen memory safety):** accepted. Standard wasm sandbox + wasm-bindgen's generated shim. The façade's `grid_ptr` / `dirty_ptr` expose `*const u8` pointers; JS reads them via `new Uint8Array(wasm.memory.buffer, ptr, len)` which is bounds-checked at view construction. No `unsafe` blocks in lib.rs; the only raw pointers cross the boundary as opaque u32 wasm addresses.

## Next Plan Readiness

- **Plan 02-04 (if present — static JS harness):** unblocked. The pkg/ output shape is confirmed to contain `bestialitty_core.js`, `bestialitty_core_bg.wasm`, and `bestialitty_core.d.ts`, so `import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js'` in a static HTML page will resolve cleanly once the build script writes the pkg/ into `www/pkg/` (per D-13).
- **Plan 02-05 (if present — 64 KB single-feed SC-4 demonstration):** unblocked. `feed_accepts_large_slice_without_panic` already exercises the 64 KB payload at the native-integration level; the harness only needs to replicate the call from JS with a `Uint8Array` and one `term.feed(...)` invocation to satisfy SC-4 end-to-end.
- **Phase 3 (canvas renderer):** unblocked on the wasm-side. The renderer's per-frame cadence is now `term.snapshot_grid(); read grid_ptr/grid_byte_len/dirty_ptr via Uint8Array; draw; term.clear_dirty();`. All five methods are exported and pinned.
- **Phase 4 (DOM keyboard):** unblocked on the wasm-side. `encode_key_raw(code, mods) -> Uint8Array` is exported with the packing scheme frozen in Plan 02-02 (tag low 8 bits + payload 8..15; mods 0..3 = ctrl/shift/alt/meta) and now surfaced through lib.rs. The DOM handler's job is to pack its `KeyboardEvent` into those two u32s and ship the returned bytes down the Web Serial write path.
- No blockers added; no deferred items. The `wasm-pack --no-opt` flag incompatibility is a one-liner command adjustment, not a planning artifact to carry forward.

## Self-Check: PASSED

Verified on disk via Grep:
- `crates/bestialitty-core/src/lib.rs` contains `#[cfg(target_arch = "wasm32")]` exactly once — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `mod wasm_boundary {` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `#[wasm_bindgen(constructor)]` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8>` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `pub fn snapshot_grid(&mut self)` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `pub fn grid_ptr(&self) -> *const u8` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `pub fn grid_byte_len(&self) -> usize` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `pub fn dirty_ptr(&self) -> *const u8` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `pub fn cursor_packed(&self) -> u32` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `<< 16` expression — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `pub fn encode_key_raw(code: u32, mods: u32) -> Vec<u8>` — FOUND
- `crates/bestialitty-core/src/lib.rs` contains `None => Vec::new()` — FOUND
- `crates/bestialitty-core/src/lib.rs` does NOT contain `web_sys`, `js_sys`, `wasm-bindgen-futures`, or any `gloo` import — CONFIRMED
- `crates/bestialitty-core/tests/boundary_api_shape.rs` contains `terminal_snapshot_and_pointer_methods_have_stable_return_types` — FOUND
- `crates/bestialitty-core/tests/boundary_api_shape.rs` contains `pack_ptr_stable_across_feed_per_d03` — FOUND
- `crates/bestialitty-core/tests/boundary_api_shape.rs` contains `feed_accepts_large_slice_without_panic` — FOUND
- `crates/bestialitty-core/tests/boundary_api_shape.rs` contains `key_unpack_signatures_are_stable` — FOUND
- `crates/bestialitty-core/tests/boundary_api_shape.rs` contains `unpack_keycode, unpack_mods` in the `use` line — FOUND
- `crates/bestialitty-core/tests/boundary_api_shape.rs` still contains `terminal_constructor_signature_is_stable`, `terminal_feed_accepts_byte_slice_returns_vec_u8`, `bell_end_to_end` (Phase 1 pins preserved) — FOUND

Verified via git:
- `c810870` (feat 02-03 Task 1 lib.rs façade) — FOUND in `git log --oneline`
- `af91b17` (test 02-03 Task 2 boundary_api_shape pins) — FOUND in `git log --oneline`

Verified via cargo + wasm-pack:
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` — 3/3 pass (wasm_bindgen exempt in lib.rs; forbidden elsewhere) — CONFIRMED
- `cargo test -p bestialitty-core --test boundary_api_shape` — 14/14 pass (10 Phase 1 preserved + 4 Phase 2 new) — CONFIRMED
- `cargo test -p bestialitty-core` — 143 tests pass (118 lib + 14 boundary shape + 10 parser + 3 CORE-02 + 0 doctest), 0 fail, 0 flags (D-20 preserved) — CONFIRMED
- `cargo fmt --check -p bestialitty-core` — clean — CONFIRMED
- `cargo clippy -p bestialitty-core --lib --tests -- -D warnings` — clean — CONFIRMED
- `wasm-pack build crates/bestialitty-core --target web --out-dir /tmp/pkg-smoke-plan03` — exits 0 — CONFIRMED
- `/tmp/pkg-smoke-plan03/bestialitty_core.js` — exists (10 KB) — CONFIRMED
- `/tmp/pkg-smoke-plan03/bestialitty_core_bg.wasm` — exists (40 KB) — CONFIRMED
- `/tmp/pkg-smoke-plan03/bestialitty_core.d.ts` — exists (4.7 KB), documents constructor + 13 methods + encode_key_raw — CONFIRMED

---
*Phase: 02-wasm-boundary-minimal-js-harness*
*Plan: 03*
*Completed: 2026-04-21*
