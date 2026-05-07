---
phase: 08-wasm-boundary-js-dispatcher-esc-wakeup
plan: 01
subsystem: testing
tags:
  - slide
  - wasm-boundary
  - test-scaffolding
  - playwright
  - cargo-test
  - wave-0

# Dependency graph
requires:
  - phase: 07-slide-rust-core-framer-crc-state-machine
    provides: "Slide / SlideState / EVT_* public re-exports from crates/bestialitty-core/src/slide/mod.rs"
  - phase: 05-web-serial-transport
    provides: "SERIAL_MOCK fixture + readloop.spec.js setup() helper at www/tests/transport/mock-serial.js"
  - phase: 04-keyboard-input
    provides: "tx-debug-strip.spec.js input-level Playwright spec template"
provides:
  - "Compile-time fn-pointer pin (8 #[test] fns) for Phase 8 wasm-façade surface against inner Slide methods"
  - "13 Playwright stubs for SLIDE-17 7-byte ESC ^ S L I D E wakeup matcher (full + 7 enumerated splits + 4 benign + reprocess-from-idx-0 + isolated-ESC)"
  - "8 Playwright stubs for SLIDE-05 dispatchInbound routing (terminal pass-through + post-feed invariant + recv-mode handoff + FIN session-end + chunk-tail off-by-one)"
  - "6 Playwright stubs for SLIDE-06 wire-owner handoff (default = terminal + setWireOwner + writeSlideFrame + invalid-owner)"
affects:
  - 08-02-PLAN (Rust façade — every wasm method wrapped is pinned by slide_wasm_boundary_shape.rs)
  - 08-03-PLAN (JS dispatcher — three Playwright stubs become its acceptance harness)
  - 08-04-PLAN (Wave 3 — replaces test.skip with real assertions across all 27 stubs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling-mirror Rust integration test: tests/slide_wasm_boundary_shape.rs mirrors tests/slide_boundary_shape.rs verbatim with a Phase 8 doc-header — keeps grep locality on the slide subsystem and enforces the same fn-pointer coercion contract from a different vantage point"
    - "test.skip(true, '...') Playwright stubs with TODO Plan 08-NN markers — Wave 0 RED gate convention for downstream plans to light up"
    - "Playwright spec source-line enumeration over for-loop runtime expansion when grep -c on test.skip is part of acceptance criteria"

key-files:
  created:
    - "crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs (117 lines, 8 tests, Phase 8 wasm-façade pin)"
    - "www/tests/transport/slide-wakeup.spec.js (128 lines, 13 stubs, SLIDE-17 wakeup matcher)"
    - "www/tests/transport/slide-dispatcher.spec.js (94 lines, 8 stubs, SLIDE-05 dispatchInbound routing)"
    - "www/tests/input/tx-sink.spec.js (70 lines, 6 stubs, SLIDE-06 wire-owner handoff)"
  modified: []

key-decisions:
  - "Sibling-mirror approach (not extension of slide_boundary_shape.rs) — keeps the two pin files as discrete grep targets so `grep -l Phase 8 crates/bestialitty-core/tests/` finds the wasm-boundary file specifically; doc-headers signal each file's distinct purpose (Phase 7 ships, Phase 8 depends)"
  - "Enumerated torn-chunk-split-1/6 .. split-7/0 as 7 explicit test.skip declarations rather than a JS for-loop — required by 08-01-PLAN.md acceptance criterion `grep -c 'test.skip' >= 12`; loops register at runtime but only count as a single source-line stub. Each split now appears in `pnpm playwright test --reporter=list` output as a discrete test name."
  - "tx-sink.spec.js placed at www/tests/input/ (not www/tests/transport/) — wire-owner handoff is a tx-sink concern (input lane), and the existing tx-debug-strip.spec.js sets the precedent for input-level tx-sink Playwright specs. Required cross-directory import `../transport/mock-serial.js` for SERIAL_MOCK."

patterns-established:
  - "Pattern: Phase-scoped wasm-boundary pin file at tests/slide_wasm_boundary_shape.rs — sibling to the Phase 7 inner-API pin, demonstrating that two pin files at different points in the dependency chain (one for the producing phase, one for the consuming phase) can coexist with verbatim test bodies as long as their doc-headers declare distinct purposes."
  - "Pattern: Playwright Wave 0 stub template — module header citing CONTEXT/RESEARCH/PATTERNS sources + analog spec file, test.describe with REQ-ID prefix, every test.skip body contains `await setup(page); expect(true).toBe(true);` plus a `// TODO Plan 08-NN: ...` marker. Keeps stubs valid syntactically while the implementation lags."

requirements-completed: []  # SLIDE-05/06/17 are scaffold-only at this stage; full completion happens in Plan 08-04 when assertions land.

# Metrics
duration: 4min
completed: 2026-05-07
---

# Phase 08 Plan 01: Wave 0 Test Scaffolding Summary

**Wave 0 RED-gate scaffolds shipped: 1 Rust fn-pointer pin (8 tests, all green) + 3 Playwright spec stubs (27 tests, all skipped) so Plans 08-02 / 08-03 / 08-04 can declare `<verify>` against existing test paths without scaffolding-not-found errors.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-07T19:07:14Z
- **Completed:** 2026-05-07T19:11:31Z
- **Tasks:** 2 / 2
- **Files created:** 4

## Accomplishments

- Phase 8 wasm-façade contract is now compile-time-pinned. Any signature drift on the 11 methods Phase 8's `lib.rs:wasm_boundary` will wrap (`new` / `enter_recv_mode` / `feed_byte` / `feed_chunk` / `take_event_packed` / `state` / `outbound_ptr` / `outbound_len` / `clear_outbound` / `cancel` / `force_idle`) fails `cargo test --test slide_wasm_boundary_shape` before wasm-pack ever runs.
- `SlideState` repr(u32) variant values 0..7 and `EVT_*` (kind << 16) packing pinned for the JS-side mirror in the forthcoming `www/transport/slide.js`.
- 27 Playwright stubs registered (13 wakeup + 8 dispatcher + 6 tx-sink) — all `skipped` (not failed), exit code 0, full Phase 5 readloop+lifecycle suite still green.
- All four files are auto-discovered by `www/playwright.config.js`'s existing `testMatch` glob; no config change needed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create `slide_wasm_boundary_shape.rs` (Phase 8 fn-pointer pin)** — `c47ad55` (test)
2. **Task 2: Create `slide-wakeup.spec.js` + `slide-dispatcher.spec.js` + `tx-sink.spec.js`** — `92f762f` (test)

## Files Created/Modified

- `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — 8 #[test] fns; fn-pointer coercion against inner `Slide` methods; SlideState repr(u32) and EVT_* (kind << 16) constants pinned for the JS-side mirror.
- `www/tests/transport/slide-wakeup.spec.js` — 13 `test.skip` stubs covering the SLIDE-17 7-byte matcher: full-match-single-chunk, 7 enumerated torn-chunk splits (1/6 .. 7/0), 2 benign passthroughs (`ESC ^ A`, `ESC ^ S L X`), reprocess-from-idx-0 (`ESC ^ ESC ^ S L I D E` — D-02 critical clause), isolated-caret, isolated-ESC.
- `www/tests/transport/slide-dispatcher.spec.js` — 8 `test.skip` stubs covering SLIDE-05 dispatchInbound routing: terminal pass-through, post-feed invariant (BEL flash + ESC Z host reply), recv-mode handoff to `slide.feed_chunk`, D-07 mid-stream wakeup passthrough, FIN-driven mode flip, session-end TX-owner restoration, Pitfall 2 chunk-tail off-by-one.
- `www/tests/input/tx-sink.spec.js` — 6 `test.skip` stubs covering SLIDE-06 wire-owner handoff: default = terminal, `setWireOwner('slide')` silently drops keystrokes, `setWireOwner('terminal')` restores, `writeSlideFrame` bypasses keystroke ring via `registeredWriter`, `writeSlideFrame` via registered writer, invalid-owner throws.

## Decisions Made

- **Sibling-mirror over extension.** `slide_wasm_boundary_shape.rs` is a verbatim-structured sibling of `slide_boundary_shape.rs`, not an extension. Rationale: keeping each pin file as a discrete grep target (one for the producing phase, one for the consuming phase) makes the dependency chain self-documenting. Doc-headers do the work of distinguishing purpose.
- **Enumerate splits, do not loop them.** The first draft of `slide-wakeup.spec.js` used a `for` loop to register 6 split tests at runtime. The plan's acceptance criterion `grep -c "test.skip" >= 12` only counts source lines, so a loop produces 1 grep hit for 6 runtime tests. Resolved by enumerating split-1/6 through split-7/0 as 7 explicit `test.skip` calls. Each split now appears as its own line in `pnpm playwright test --reporter=list` output, which is also more readable in the failure report when stubs light up.
- **`tx-sink.spec.js` lives in `www/tests/input/`** — alongside the existing `tx-debug-strip.spec.js`. Wire-owner handoff is a tx-sink (input lane) concern and the directory precedent is set. Cross-directory import `../transport/mock-serial.js` is fine — playwright.config.js's testMatch covers both directories.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced for-loop torn-chunk splits with 7 enumerated test.skip declarations**
- **Found during:** Task 2 (Playwright stub creation)
- **Issue:** The plan's text suggested a `for (let split = 1; split <= 6; split++)` loop for the 6 mid-splits, but the acceptance criterion `grep -c "test.skip" www/tests/transport/slide-wakeup.spec.js returns at least 12` counts source lines. A loop produces a single source line for 6 tests, so the grep would have returned 9 instead of the required 12.
- **Fix:** Replaced the for-loop with 7 explicit `test.skip(...)` calls (split-1/6, 2/5, 3/4, 4/3, 5/2, 6/1, 7/0). This also makes each split appear as a discrete test name in `pnpm playwright test --reporter=list`, which is a usability win when stubs light up and individual splits start to fail.
- **Files modified:** `www/tests/transport/slide-wakeup.spec.js`
- **Verification:** `grep -c "test.skip"` now returns 16 (1 comment + 13 stubs + 2 incidental comment-line mentions); `TODO Plan 08-04` count = 13; `pnpm playwright test --reporter=list` registers all 13 wakeup stubs as discrete `skipped` entries.
- **Committed in:** 92f762f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — preserved acceptance criteria semantics)
**Impact on plan:** No scope change. The fix preserves the semantic intent of "exercise every torn-chunk split point" while satisfying both the grep-based acceptance criterion AND the per-split test-naming convention that downstream Plan 08-04 will rely on.

## Issues Encountered

- None. Both verify commands (`cargo test --test slide_wasm_boundary_shape` and `pnpm playwright test transport/slide-wakeup.spec.js transport/slide-dispatcher.spec.js input/tx-sink.spec.js`) ran clean on first try.

## User Setup Required

None — Wave 0 is test-only scaffolding.

## Next Phase Readiness

- **Plan 08-02 (Rust wasm façade)** — can now reference `cargo test -p bestialitty-core --test slide_wasm_boundary_shape` in its `<verify>` block; the pin file already declares the 11-method surface contract that 08-02's `#[wasm_bindgen]` impl block must forward to.
- **Plan 08-03 (JS dispatcher)** — can reference `pnpm playwright test transport/slide-wakeup.spec.js transport/slide-dispatcher.spec.js` in its `<verify>` block; stubs become the integration-level harness.
- **Plan 08-04 (Wave 3)** — replaces `test.skip(true, ...)` with `test('...', async ({ page }) => { ... real assertions ... })` across all 27 stubs.
- Cargo invariant intact: `cargo test -p bestialitty-core --test core_02_no_browser_deps` still green (3 passed); the `Slide` re-exports remain wasm-attribute-free in Phase 7's source tree.
- Whole-crate cargo run: 240 tests pass (previous 232 + 8 new in `slide_wasm_boundary_shape.rs`).

## Verification Evidence

```
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

$ pnpm playwright test transport/slide-wakeup.spec.js transport/slide-dispatcher.spec.js input/tx-sink.spec.js --reporter=list
Running 27 tests using 10 workers
[27 entries — all `-` (skipped)]
27 skipped
exit=0

$ pnpm playwright test transport/readloop.spec.js transport/lifecycle.spec.js --reporter=list
[regression check on Phase 5 specs — passed]
```

## Self-Check: PASSED

- File exists: `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs`
- File exists: `www/tests/transport/slide-wakeup.spec.js`
- File exists: `www/tests/transport/slide-dispatcher.spec.js`
- File exists: `www/tests/input/tx-sink.spec.js`
- File exists: `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-01-SUMMARY.md`
- Commit found: `c47ad55` (Task 1 — Rust pin)
- Commit found: `92f762f` (Task 2 — Playwright stubs)

---
*Phase: 08-wasm-boundary-js-dispatcher-esc-wakeup*
*Completed: 2026-05-07*
