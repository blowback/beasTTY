---
phase: 08-wasm-boundary-js-dispatcher-esc-wakeup
plan: 02
subsystem: wasm-boundary
tags:
  - slide
  - wasm-boundary
  - rust-facade
  - wave-2

# Dependency graph
requires:
  - phase: 07-slide-rust-core-framer-crc-state-machine
    provides: "crate::slide::Slide receiver state machine + EVT_* + SlideState repr(u32)"
  - plan: 08-01
    provides: "tests/slide_wasm_boundary_shape.rs fn-pointer pin (8 tests) — Wave 0 RED gate the facade satisfies via the inner type"
provides:
  - "Slide #[wasm_bindgen] facade in lib.rs:wasm_boundary, sibling to Terminal — 11 one-line forwarding methods"
  - "Regenerated www/pkg/bestialitty_core.{js,wasm,d.ts} exposing class Slide for JS consumption (Plan 08-03 import target)"
affects:
  - 08-03-PLAN (JS dispatcher — can now `import { Slide } from '../pkg/bestialitty_core.js'` and `new Slide()`)
  - 08-04-PLAN (Wave 3 — Playwright assertions exercise the regenerated bundle end-to-end)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling-facade addition inside an existing `mod wasm_boundary { ... }` block — verbatim mirror of the Terminal facade's constructor + one-line forward + outbound triple shape (Phase 2 P01 pattern)"
    - "Inner-type alias (`use crate::slide::Slide as CoreSlide;`) prevents `pub struct Slide { inner: Slide }` recursive type at compile time (Pitfall 6 — mirrors `as CoreTerminal` at lib.rs:40)"

key-files:
  created: []
  modified:
    - "crates/bestialitty-core/src/lib.rs (+111 LOC, +1 import alias) — Slide #[wasm_bindgen] struct + impl block sibling to Terminal in wasm_boundary mod"
  generated:
    - "www/pkg/bestialitty_core.js (regenerated, 17,470 bytes, +5,580 bytes vs prior) — wasm-bindgen JS glue exposing class Slide"
    - "www/pkg/bestialitty_core_bg.wasm (regenerated, 47,208 bytes, +4,823 bytes vs prior) — compiled wasm with Slide FFI symbols"
    - "www/pkg/bestialitty_core.d.ts (regenerated, 11,125 bytes, +4,579 bytes vs prior) — TypeScript declarations for Slide class"
    - "www/pkg/bestialitty_core_bg.wasm.d.ts (regenerated, 2,298 bytes, +676 bytes vs prior) — wasm symbol table"

key-decisions:
  - "Generated www/pkg/* artifacts NOT committed — root .gitignore excludes www/pkg/ entirely (Phase 2 baseline; build.sh comment header confirms 'Output files (all gitignored)'). Plan 08-02 text claimed Phase 2 P04 .gitignore committed the bundle, but inspection confirmed the entire directory is gitignored at repo root. Build verification proceeds without committing artifacts; downstream Plan 08-03 will rebuild on demand."
  - "Slide facade scope = 11 receiver-side methods only, per CONTEXT D-10. Sender-side `enter_send_mode(metadata)` deferred to Phase 9 per RESEARCH §SM Scope Recommendation (receiver SM exercises every SLIDE control byte; sender is structurally similar but uplift not yet needed)."
  - "EVT_* constants exposed as JS-side mirrors in transport/slide.js (Plan 08-03), NOT wasm-bindgen-exported associated consts — RESEARCH §Discretion choice. Authority for kind values stays in tests/slide_boundary_shape.rs (Phase 7) + tests/slide_wasm_boundary_shape.rs (Plan 08-01); both pin via fn-pointer + assert_eq, two-layer drift detection."

requirements-completed: []  # SLIDE-05/06/17 stay [ ] until Plan 08-04's Playwright assertions land per sequential_execution discipline.

# Metrics
duration: 2min
completed: 2026-05-07
---

# Phase 08 Plan 02: Wasm Boundary — Slide Facade Summary

**Phase 8 SC#1 deliverable shipped: a `Slide` `#[wasm_bindgen]` struct with 11 one-line-forwarding methods now lives in `lib.rs:wasm_boundary` sibling to `Terminal`. wasm-pack rebuilds the bundle without breaking the Terminal contract; `www/pkg/bestialitty_core.{js,d.ts}` exports `class Slide` for Plan 08-03 to import.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-07T19:17:08Z
- **Completed:** 2026-05-07T19:19:24Z
- **Tasks:** 2 / 2
- **Files modified:** 1 (Rust src) + 4 generated (www/pkg, gitignored)
- **wasm size delta:** 42,385 → 47,208 bytes (+4,823 bytes, +11.4%) — reflects 11 new wasm-bindgen FFI methods + Slide constructor/free symbols

## Accomplishments

- `crate::slide::Slide` is now reachable from JS via `import { Slide } from './pkg/bestialitty_core.js'`. The inner state machine (Phase 7 ship) crosses the wasm boundary unchanged in behavior — every method body is `self.inner.METHOD(args)`.
- 11 wasm-bound methods: `new`, `enter_recv_mode`, `feed_byte`, `feed_chunk`, `take_event_packed`, `state`, `outbound_ptr`, `outbound_len`, `clear_outbound`, `cancel`, `force_idle`. Constructor is `#[wasm_bindgen(constructor)]`; everything else is a plain method.
- Inner-name collision resolved via `use crate::slide::Slide as CoreSlide;` import alias (Pitfall 6) — mirrors the existing `as CoreTerminal` pattern at lib.rs:40 and prevents the recursive-type compile error.
- Native `cargo test -p bestialitty-core` passes 240 tests (no regression from Plan 08-01's 240 baseline; the new code is `#[cfg(target_arch = "wasm32")]`-gated and invisible to native test runs).
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` still green — `wasm_bindgen` attribute remains exempted only in `lib.rs`; the ADR-002 invariant is unbroken.
- `cargo test -p bestialitty-core --test slide_wasm_boundary_shape` (the Wave 0 pin from Plan 08-01) is still green — the 8 fn-pointer-coercion tests against the inner type validate the contract Phase 8's facade forwards to.
- `cargo test -p bestialitty-core --test boundary_api_shape` (Terminal contract pin from Phase 2) is still green — Terminal exports unaffected by the new Slide neighbor.
- Regenerated `www/pkg/bestialitty_core.{js,wasm,d.ts}` files contain `class Slide` (JS), TypeScript declarations for all 11 methods, AND preserve the existing `Terminal` and `encode_key_raw` exports.
- TypeScript declaration ergonomics confirmed: `feed_chunk(bytes: Uint8Array): number` and `cancel(): void` both ship.

## Task Commits

Each task was committed atomically (Task 2 had no source changes to commit — generated artifacts are gitignored, see Deviations):

1. **Task 1: Add Slide #[wasm_bindgen] facade to lib.rs:wasm_boundary** — `4a50b68` (feat)
2. **Task 2: Run wasm-pack build and verify www/pkg exposes Slide** — no commit (verification-only; regenerated artifacts gitignored at repo root, see Deviation 1)

## Files Created/Modified

### Modified
- `crates/bestialitty-core/src/lib.rs` — added `use crate::slide::Slide as CoreSlide;` import alias, added `pub struct Slide { inner: CoreSlide }` with `#[wasm_bindgen]`, added `impl Slide` block with 11 wasm-bound methods (constructor + 10 instance methods, every body = one-line `self.inner.METHOD(args)` forward). Net +111 LOC, all inside the existing `#[cfg(target_arch = "wasm32")] mod wasm_boundary { ... }` block.

### Generated (gitignored, not tracked — see Deviation 1)
- `www/pkg/bestialitty_core.js` — regenerated by wasm-bindgen via wasm-pack; now contains `class Slide` with all 11 methods + free/dispose. Size 11,890 → 17,470 bytes (+47%).
- `www/pkg/bestialitty_core_bg.wasm` — recompiled wasm binary. Size 42,385 → 47,208 bytes (+11.4%).
- `www/pkg/bestialitty_core.d.ts` — regenerated TypeScript declarations. `export class Slide { ... }` now present alongside the preserved `export class Terminal { ... }` and `export function encode_key_raw(...)`. Size 6,546 → 11,125 bytes (+70%).
- `www/pkg/bestialitty_core_bg.wasm.d.ts` — wasm symbol table now includes `slide_*` entries (`slide_new`, `slide_feed_chunk`, etc.). Size 1,622 → 2,298 bytes (+42%).

## Decisions Made

- **`#[cfg(target_arch = "wasm32")]` gate inherited from the wrapping mod, not re-applied per item.** The Slide struct + impl live inside the existing `mod wasm_boundary { ... }` block, which already carries the cfg gate at line 34. No separate gating needed; native `cargo test` compiles past this code without resolving any wasm-bindgen attribute (zero proc-macro cost on native builds — ADR-002 Candidate A behavior).
- **Doc-comments on every wasm-bound method.** wasm-bindgen forwards Rust doc-comments into the generated `.d.ts` JSDoc blocks; this means JS / TypeScript callers get inline documentation in IDEs. The doc-comments cite the source-of-truth pin tests (`tests/slide_wasm_boundary_shape.rs` for SlideState values, `tests/slide_boundary_shape.rs` for EVT_* kind values) so future drift fixers know where to look.
- **Constructor takes no arguments.** Unlike `Terminal::new(rows, cols, scrollback_cap)`, `Slide::new()` is parameter-free per the inner constructor's signature. Per-session Slide allocation (~1 KB) is acceptable per RESEARCH §Alternatives Considered (singleton-with-reset rejected — sessions are per-file-batch, not per-byte).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] www/pkg/* generated artifacts are NOT committed because the repo .gitignore excludes them**

- **Found during:** Task 2 (verifying Task 2 acceptance criteria for committing regenerated artifacts)
- **Issue:** Plan 08-02 Task 2 `<action>` block states: "Commit the regenerated `www/pkg/` files in this task — they are tracked in git (see `.gitignore` from Phase 2 Plan 04 which deliberately excludes only `pkg/.gitignore` not the bundle itself)." This claim is incorrect. Inspection of the repo's root `.gitignore` shows the line `www/pkg/` (full directory exclusion). `git ls-files | grep -i pkg` returns nothing — no www/pkg files have ever been tracked. `git check-ignore www/pkg/bestialitty_core.js` confirms the file is gitignored. The build script `scripts/build.sh` itself documents (line 17) "Output files (all gitignored)".
- **Fix:** Did NOT commit www/pkg artifacts. Task 2 ran `bash scripts/build.sh` (mandatory, exits 0), verified the regenerated artifacts contain `class Slide` (mandatory, all greps satisfied), and recorded the regeneration in this SUMMARY. The build is reproducible from `crates/bestialitty-core/src/lib.rs` (Task 1's commit) — Plan 08-03 will rebuild on demand or CI will rebuild before serving.
- **Files affected:** None committed; regenerated files exist on disk in `www/pkg/` but remain gitignored.
- **Verification:**
  - `git ls-files | grep -c pkg` returns 0 (confirms not tracked)
  - `git check-ignore www/pkg/bestialitty_core.js` exit 0 + filename echoed (confirms ignored)
  - `head -8 scripts/build.sh` confirms "all gitignored" comment
  - `git status --short` after build shows no www/pkg entries
- **Committed in:** N/A (no commit; verification-only)
- **Impact on downstream plans:** None. Plan 08-03 imports from `./pkg/bestialitty_core.js` at runtime — the file exists on disk after `bash scripts/build.sh`, so the import resolves. CI / deploy / dev flow already assume `scripts/build.sh` runs before serving.
- **Recommendation for plan-checker:** Plan 08-02 Task 2 acceptance criteria item "`www/pkg/bestialitty_core.js` is regenerated (mtime newer than before this task)" was satisfied (mtime moved from 1777197901 → 1778181530). The grep-based criteria for `class Slide`, `feed_chunk`, `outbound_ptr`, `export class Slide`, `export class Terminal`, `feed_chunk(bytes: Uint8Array)`, `cancel(): void` were all satisfied. The "files committed in this task" sub-claim is the only piece that diverged from plan text, and the divergence is downstream of an incorrect plan claim about Phase 2 P04's gitignore — the underlying gate (Slide class is exposed in the bundle) holds.

---

**Total deviations:** 1 auto-fixed (1 blocking — preserved acceptance criteria semantics; the underlying contract "Plan 08-03 can `import { Slide }`" holds because the file exists on disk after build, gitignore status is orthogonal)
**Impact on plan:** No scope change. Phase 8 SC#1 ("A new `Slide` wasm-bindgen struct lives in `lib.rs` (alongside `Terminal`) with the feed_chunk / outbound zero-copy accessors / state / progress / cancel exports") is satisfied by Task 1's commit alone; Task 2's role is build-and-verify, which succeeded.

## Issues Encountered

- None. Both verify commands (`cargo test -p bestialitty-core --test slide_wasm_boundary_shape` and `bash scripts/build.sh`) ran clean on first try.
- A `[WARN]` from wasm-pack about a newer version available (0.12.1 → 0.14.0) is informational; does not affect bundle correctness and is orthogonal to Plan 08-02 scope.
- Pre-build wasm-pack INFO messages about missing `repository` field and missing `LICENSE` files in `crates/bestialitty-core/Cargo.toml` are informational only — both fields exist at the workspace root (the repo has a top-level LICENSE per Phase 6 Plan 08); the per-crate Cargo.toml omission predates Phase 8 and is out of scope for this plan.

## User Setup Required

None — Wave 2 is a Rust-side facade addition + wasm rebuild. JS-side dispatcher (Plan 08-03) and Playwright assertions (Plan 08-04) follow.

## Next Phase Readiness

- **Plan 08-03 (JS dispatcher)** — UNBLOCKED. Can `import init, { Slide } from '../pkg/bestialitty_core.js'` and call `new Slide()` after `await init()` resolves. The 11-method surface is exactly what `transport/slide.js` will drive in the recv hot path: `slide.feed_chunk(bytes)` per Web Serial chunk, `slide.outbound_ptr()` + `slide.outbound_len()` zero-copy view, `slide.clear_outbound()` ack, `slide.cancel()` for the future Phase 10 cancel-chip, `slide.force_idle()` for ADR-003 stock-slide.com tolerance.
- **Plan 08-04 (Playwright assertions)** — UNBLOCKED. The 27 `test.skip` stubs from Plan 08-01 can now reference `class Slide` runtime calls in their assertion bodies; the JS-side import resolves to the regenerated bundle.
- **Phase 9 (SLIDE Sender)** — When Phase 9 adds `enter_send_mode(metadata)` to `crate::slide::Slide`, the lib.rs facade gets a one-line addition next to `enter_recv_mode`. Phase 8's pattern is complete and reusable.

## Threat Surface Scan

No new threat surface beyond what the plan's `<threat_model>` already enumerated:
- T-08-02-01 (inner method drift) — mitigated by `tests/slide_wasm_boundary_shape.rs` fn-pointer pin (still green)
- T-08-02-02 (outbound_ptr exposure) — accepted, mirrors host_reply pattern
- T-08-02-03 (memory growth) — mitigation deferred to Plan 08-03's drainSlideOutbound
- T-08-02-04 (per-session alloc) — accepted
- T-08-02-05 (wasm-bindgen attr placement) — mitigated; core_02_no_browser_deps still green
- T-08-02-06 (recursive Slide name collision) — mitigated; `as CoreSlide` alias verified by grep

No new threat flags discovered.

## TDD Gate Compliance

This plan's frontmatter declares `type: execute`, not `type: tdd`. The plan-level TDD gate sequence does not apply. Plan 08-01 already shipped the RED gate (the `slide_wasm_boundary_shape.rs` fn-pointer pin); Plan 08-02 is the GREEN gate (the facade satisfies that pin). Plan 08-04 will exercise the runtime contract via Playwright assertions. The whole sequence Plan 08-01 → Plan 08-02 → Plan 08-04 follows the macro RED → GREEN → assertion pattern across plans rather than within a single plan.

## Verification Evidence

```
$ cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu
   Compiling bestialitty-core v0.1.0
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.09s

$ cargo test -p bestialitty-core --test slide_wasm_boundary_shape
running 8 tests
test slide_constructor_signature_is_stable ... ok
test slide_event_constants_pinned_for_phase_8_jsmirror ... ok
test slide_feed_methods_have_stable_signatures ... ok
test slide_lifecycle_methods_have_stable_signatures ... ok
test slide_outbound_accessors_have_stable_signatures ... ok
test slide_phase8_wasm_facade_surface_runtime_callable ... ok
test slide_state_accessor_signature_is_stable ... ok
test slide_state_enum_repr_u32_pinned ... ok
test result: ok. 8 passed; 0 failed; 0 ignored

$ cargo test -p bestialitty-core --test core_02_no_browser_deps
running 3 tests
test cargo_toml_declares_cdylib_and_rlib ... ok
test source_files_contain_no_wasm_attrs ... ok
test dependency_graph_excludes_browser_crates ... ok
test result: ok. 3 passed; 0 failed; 0 ignored

$ cargo test -p bestialitty-core --test boundary_api_shape
[20 tests passed — Terminal contract intact]

$ cargo test -p bestialitty-core
[whole-crate run: 240 tests passed across 13 test binaries + doc-tests]

$ bash scripts/build.sh
[INFO]: Compiling to Wasm... Finished `release` profile [optimized] in 0.58s
[INFO]: Optimizing wasm binaries with `wasm-opt`...
[INFO]: ✨   Done in 1.04s
[INFO]: 📦   Your wasm pkg is ready to publish at .../www/pkg.

$ grep -c "class Slide" www/pkg/bestialitty_core.js
1
$ grep -c "feed_chunk" www/pkg/bestialitty_core.js
5
$ grep -c "outbound_ptr" www/pkg/bestialitty_core.js
3
$ grep -c "export class Slide" www/pkg/bestialitty_core.d.ts
1
$ grep -c "export class Terminal" www/pkg/bestialitty_core.d.ts
1
$ grep -c "feed_chunk(bytes: Uint8Array)" www/pkg/bestialitty_core.d.ts
1
$ grep -c "cancel(): void" www/pkg/bestialitty_core.d.ts
1

# Acceptance-criteria greps from Task 1:
$ grep -c "use crate::slide::Slide as CoreSlide" crates/bestialitty-core/src/lib.rs
1
$ grep -c "pub struct Slide" crates/bestialitty-core/src/lib.rs
1
$ grep -c "self.inner.feed_chunk" crates/bestialitty-core/src/lib.rs
1
$ grep -c "self.inner.outbound_ptr" crates/bestialitty-core/src/lib.rs
1
$ grep -c "self.inner.cancel" crates/bestialitty-core/src/lib.rs
1
$ grep -c "self.inner.force_idle" crates/bestialitty-core/src/lib.rs
1
$ grep -c "#\[wasm_bindgen(constructor)\]" crates/bestialitty-core/src/lib.rs
2
```

## Self-Check: PASSED

- File exists: `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-02-SUMMARY.md`
- File exists: `crates/bestialitty-core/src/lib.rs`
- File exists: `www/pkg/bestialitty_core.js` (gitignored, on disk only)
- File exists: `www/pkg/bestialitty_core.d.ts` (gitignored, on disk only)
- Commit found: `4a50b68` (Task 1 — Slide #[wasm_bindgen] facade)
- Task 2 has no commit by design — generated artifacts are gitignored at repo root (Deviation 1)

---
*Phase: 08-wasm-boundary-js-dispatcher-esc-wakeup*
*Completed: 2026-05-07*
