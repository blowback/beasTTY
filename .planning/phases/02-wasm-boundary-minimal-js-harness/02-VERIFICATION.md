---
phase: 02-wasm-boundary-minimal-js-harness
verified: 2026-04-22T00:00:00Z
status: human_needed
score: 10/10 must-haves verified (automated); 4 browser SCs deferred to human
overrides_applied: 0
human_verification:
  - test: "SC-1: wasm-pack ES-module loads in Chromium"
    expected: "Console shows '[boot] encode_key_raw(ArrowUp, none) = [27, 65]' and '[boot] Harness ready. Terminal= ... wasm.memory= ...' with no red errors; page renders textarea, Feed + 64 KB Stress buttons, two <pre> elements, status span"
    why_human: "Requires a running Chromium browser with DevTools. The ES-module import and wasm streaming-compile rely on browser APIs that cannot be driven from a shell agent."
  - test: "SC-2: paste -> feed() -> ASCII render"
    expected: "Paste 'Hello\\x1BY\\x21\\x20World' into textarea, click Feed. Grid pre shows 'Hello' on row 0 and 'World' starting row 1 col 0. Status shows 'cursor=(1,5) bell=false'. Dirty pre shows '11' followed by zeros."
    why_human: "Requires browser DOM interaction and visual inspection of rendered output. Depends on SC-1 passing first."
  - test: "SC-3: zero-copy Uint8Array views — no per-frame allocation growth"
    expected: "DevTools Performance / Memory track shows a flat allocation profile attributable to the WASM BOUNDARY when Feed is clicked 5-10 times with simple ASCII input that produces no host_reply. Specifically: zero allocations attributable to (a) the wasm-bindgen-generated `Terminal.feed` wrapper, and (b) `reDeriveViews()`. The pre-text harness paths (`renderAscii` flat-string build, `renderDirty` Array.from().join, `parseHexEscapes` Uint8Array construction) are accepted as harness-only artifacts that Phase 3's canvas renderer eliminates by replacing the pre-text grid; their per-click ~5 KB churn is expected and not in scope for SC-3."
    why_human: "Requires DevTools Memory/Performance profiling in a running Chromium session. Cannot be driven from a shell agent."
  - test: "SC-4: 64 KB in ONE feed() call"
    expected: "Click '64 KB Stress'. Console shows exactly ONE occurrence per click of: 'Terminal.feed 64KB: X ms', '[SC-4] Fed 65536 bytes in ONE feed() call', '[SC-4] Elapsed: N ms', '[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.' DevTools Performance flame graph shows a single Terminal.feed entry, not 65536 stacked frames."
    why_human: "Single-frame vs 65536-frame distinction requires DevTools Performance profiling and visual flame-graph inspection in a running Chromium session."
---

# Phase 2: wasm-boundary-minimal-js-harness Verification Report

**Phase Goal:** Prove the Rust-JS interop shape end-to-end with the smallest possible JS surface area — batched `feed(bytes)`, zero-copy `Uint8Array` views over wasm linear memory, and a `wasm-pack --target web` build that a static site can consume directly without a bundler step.

**Verified:** 2026-04-21
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `wasm-pack build --target web` produces a `pkg/` directory loadable via ES module import without a bundler | ✓ VERIFIED | `scripts/smoke-wasm-build.sh` exits 0 with `[smoke] OK`; `www/pkg/` contains `bestialitty_core.js`, `bestialitty_core_bg.wasm`, `bestialitty_core.d.ts` (40,946 bytes); `node --check www/main.js` exits 0 |
| 2  | Debug harness page accepts paste, calls `term.feed(bytes)` once per chunk, renders ASCII in `<pre>` (no canvas, no Web Serial, no per-byte calls) | ✓ VERIFIED (automated portion) | `www/index.html` has `<pre id="grid">` and `<textarea id="input">`; `www/main.js` calls `term.feed(bytes)` exactly twice (grep count = 2), neither inside a loop; no `navigator.serial` or `addEventListener('keydown'`; no `innerHTML`; browser demonstration deferred (SC-2 human item) |
| 3  | Grid and dirty-row bitmap read from JS via `new Uint8Array(wasm.memory.buffer, ptr, len)` with no allocation per frame and no JSON serialisation | ✓ VERIFIED (automated portion) | `www/main.js` lines 32-33 and `reDeriveViews()` use `new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len())` and `new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows())`; no JSON calls; browser memory profile deferred (SC-3 human item) |
| 4  | 64 KB byte feed crosses boundary in a single `feed()` call, not 65,536 calls | ✓ VERIFIED (automated portion) | `boundary_api_shape.rs::feed_accepts_large_slice_without_panic` passes (65,536-byte payload, single call, no panic); `www/main.js` stress handler calls `term.feed(bytes)` once; SC-4 log strings present; flame-graph single-entry demonstration deferred (SC-4 human item) |
| 5  | Native `cargo test -p bestialitty-core` passes with 143 tests (128 Phase 1 + 15 Phase 2) | ✓ VERIFIED | 143 tests pass: 118 lib (dirty/grid/key/scrollback/terminal/vt52) + 14 boundary_api_shape + 3 core_02_no_browser_deps + 8 fixture_runner; zero failures |
| 6  | CORE-02 gate enforces wasm_bindgen in lib.rs only; web_sys/js_sys forbidden everywhere; wasm-bindgen crate removed from FORBIDDEN_CRATES | ✓ VERIFIED | `core_02_no_browser_deps` 3 tests pass; `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` present with `("wasm_bindgen", &["lib.rs"])`; `cargo tree --target wasm32-unknown-unknown` produces no web-sys/js-sys/gloo output |
| 7  | wasm-bindgen façade in lib.rs is cfg-gated to wasm32; all D-09 exports present; one-line forwards to pure-Rust methods | ✓ VERIFIED | `lib.rs` contains `#[cfg(target_arch = "wasm32")] mod wasm_boundary`; all 15 D-09 methods present (Terminal::new, feed, snapshot_grid, grid_ptr, grid_byte_len, dirty_ptr, rows, cols, clear_dirty, bell_pending, clear_bell, cursor_packed, resize, resize_scrollback, encode_key_raw); each is a one-line forward; `None => Vec::new()` FFI-safe branch present |
| 8  | `pack_buf`/`snapshot_grid`/`pack_ptr`/`pack_byte_len`/`dirty_ptr` on Terminal; `unpack_keycode`/`unpack_mods` on key; all unit-tested | ✓ VERIFIED | `terminal.rs` contains `pack_buf: Vec<Cell>`, `snapshot_grid`, `pack_ptr`, `pack_byte_len`, `dirty_ptr`; `key.rs` contains `unpack_keycode`, `unpack_mods`; 5 new terminal tests + 6 new key tests pass; compile-time pins in `boundary_api_shape.rs` pass |
| 9  | `scripts/build.sh` and `scripts/smoke-wasm-build.sh` exist, are executable, produce expected pkg/ artifacts | ✓ VERIFIED | `build.sh`: executable, contains `wasm-pack build crates/bestialitty-core --target web --out-dir ../../www/pkg --release`; `smoke-wasm-build.sh`: executable, uses mktemp throwaway dir, feature-detects `--no-opt`, exits 0 with `[smoke] OK` |
| 10 | ADR-002 records target-specific-dep + cfg gating choice with two rejected alternatives | ✓ VERIFIED | `.planning/decisions/ADR-002-wasm-gating.md` exists, contains "Adopt Candidate A", "Rejected Alternatives" with Candidate B and Candidate C |

**Score:** 10/10 truths verified (automated). 4 browser-based SCs require human demonstration.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `rust-toolchain.toml` | wasm32 target declaration | VERIFIED | Contains `targets = ["wasm32-unknown-unknown"]` |
| `crates/bestialitty-core/Cargo.toml` | target-specific wasm-bindgen dep | VERIFIED | Contains `[target.'cfg(target_arch = "wasm32")'.dependencies]` with `wasm-bindgen = "0.2.118"` |
| `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` | Updated CORE-02 gate | VERIFIED | Contains `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` with `("wasm_bindgen", &["lib.rs"])` |
| `.planning/decisions/ADR-002-wasm-gating.md` | Decision record | VERIFIED | Contains Status/Decision/Rejected-Alternatives sections |
| `crates/bestialitty-core/src/terminal.rs` | pack_buf + 4 new methods + tests | VERIFIED | `pack_buf: Vec<Cell>`, `snapshot_grid`, `pack_ptr`, `pack_byte_len`, `dirty_ptr`; 5 new tests pass |
| `crates/bestialitty-core/src/key.rs` | unpack_keycode + unpack_mods + tests | VERIFIED | Both fns present; 6 new tests pass; no wasm_bindgen token |
| `crates/bestialitty-core/src/lib.rs` | wasm-bindgen façade (cfg-gated) | VERIFIED | `#[cfg(target_arch = "wasm32")] mod wasm_boundary` with all D-09 exports |
| `crates/bestialitty-core/tests/boundary_api_shape.rs` | Extended compile-time pins | VERIFIED | 14 tests pass (10 Phase 1 + 4 Phase 2); `terminal_snapshot_and_pointer_methods_have_stable_return_types`, `pack_ptr_stable_across_feed_per_d03`, `feed_accepts_large_slice_without_panic`, `key_unpack_signatures_are_stable` all present |
| `scripts/build.sh` | wasm-pack build wrapper | VERIFIED | Executable; `--target web --out-dir ../../www/pkg --release`; `www/pkg/` populated |
| `www/index.html` | Static harness page with D-11/D-12 affordances | VERIFIED | Elements `input`, `feed`, `stress64k`, `grid`, `dirty`, `status` all present; loads `./main.js` as `<script type="module">` |
| `www/main.js` | ES-module harness driver | VERIFIED | Imports `init, { Terminal, encode_key_raw }` from `./pkg/bestialitty_core.js`; `new Uint8Array(wasm.memory.buffer, ...)` views; `term.feed(bytes)` twice (not in loops); `[SC-4]` log strings; `buildStressPayload(65536)`; `node --check` exits 0 |
| `www/.gitignore` | Ignores pkg/ | VERIFIED | Contains `pkg/` |
| `.gitignore` | Includes www/pkg/ | VERIFIED | Contains `www/pkg/` |
| `scripts/smoke-wasm-build.sh` | CI-friendly wasm-pack gate | VERIFIED | Executable; mktemp throwaway dir; feature-detects `--no-opt`; exits 0 with `[smoke] OK` |
| `www/README.md` | Dev-server options + SC-1..SC-4 procedures | VERIFIED | Contains both server options, SC-1/SC-2/SC-3/SC-4 sections, verbatim log-line quotes, Chromium-only note |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib.rs wasm_boundary::Terminal::feed` | `crate::terminal::Terminal::feed` | `self.inner.feed(bytes)` | WIRED | lib.rs line 71: `self.inner.feed(bytes)` |
| `lib.rs wasm_boundary::encode_key_raw` | `crate::key::{unpack_keycode, unpack_mods, encode}` | `match unpack_keycode(code)` | WIRED | lib.rs lines 141-147: full match with None => Vec::new() path |
| `www/main.js` | `www/pkg/bestialitty_core.js` | `import init, { Terminal, encode_key_raw }` | WIRED | main.js line 14 |
| `www/main.js renderAscii()` | `wasm.memory.buffer + term.grid_ptr()` | `new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len())` | WIRED | main.js lines 32-33, 36-37 |
| `www/main.js stress64k button` | `term.feed(bytes)` — ONE call | `console.time; term.feed(bytes); console.timeEnd` | WIRED | main.js line 150; SC-4 log strings at lines 155-157 |
| `scripts/build.sh` | `www/pkg/` | `--out-dir ../../www/pkg` | WIRED | build.sh line 29 |
| `boundary_api_shape.rs` | `terminal.rs pack_ptr/pack_byte_len/dirty_ptr/snapshot_grid` | explicit type annotations | WIRED | boundary_api_shape.rs lines 152-167 |

### Data-Flow Trace (Level 4)

The core data flow is Rust-owned terminal state surfaced to JS via wasm linear memory — no database, no fetch, no store. The pack buffer is populated by `snapshot_grid()` (memcpy from scrollback rows), and JS reads it via a `Uint8Array` view. This is a deliberate zero-copy design, not a "disconnected prop" pattern.

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `www/main.js renderAscii()` | `gridView[i]` | `term.snapshot_grid()` -> `pack_buf` <- `scrollback.row(r).as_slice()` memcpy | Yes — row-major memcpy of scrollback cells | FLOWING |
| `www/main.js renderDirty()` | `dirtyView` | `Dirty::bytes` via `term.dirty_ptr()` | Yes — dirty bitmap updated by every `print`/erase op | FLOWING |
| `www/main.js renderStatus()` | `packed = term.cursor_packed()` | `(cursor_row << 16) | cursor_col` from Terminal state | Yes — live cursor position | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `cargo test -p bestialitty-core` passes with expected count | `cargo test -p bestialitty-core` | 143 tests pass (118 lib + 14 boundary_api_shape + 3 core_02_no_browser_deps + 8 fixture_runner) | PASS |
| wasm32 build succeeds | `cargo build --target wasm32-unknown-unknown -p bestialitty-core` | Exit 0, "Finished" | PASS |
| smoke-wasm-build.sh exits 0 | `./scripts/smoke-wasm-build.sh` | `[smoke] OK: all expected files present. bestialitty_core_bg.wasm: 40946 bytes` | PASS |
| main.js parses cleanly | `node --check www/main.js` | Exit 0 (no output) | PASS |
| `term.feed(bytes)` appears exactly twice, not in a loop | `grep -c 'term.feed(bytes)' www/main.js` | `2` | PASS |
| Forbidden crates absent from wasm dep graph | `cargo tree -p bestialitty-core --target wasm32-unknown-unknown \| grep -iE 'web-sys\|js-sys\|gloo'` | No output | PASS |
| SC-1 browser load | Requires Chromium DevTools | — | SKIP (human item) |
| SC-2 paste-feed-render | Requires Chromium browser interaction | — | SKIP (human item) |
| SC-3 zero-copy memory profile | Requires Chromium Performance profiler | — | SKIP (human item) |
| SC-4 single flame-graph entry | Requires Chromium Performance profiler | — | SKIP (human item) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CORE-03 | Plans 01, 03, 04, 05 | Rust-JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`) | SATISFIED | `wasm-pack build --target web` succeeds; `bestialitty_core.js` ES-module produced; `smoke-wasm-build.sh` exits 0 |
| CORE-04 | Plans 04, 05 | JS shell owns Web Serial I/O, canvas rendering, event loop, browser state | SATISFIED | `www/main.js` drives wasm from JS; no `web-sys` / Rust Web Serial bindings in crate; no `navigator.serial` in harness (Phase 5 scope correctly excluded) |
| CORE-05 | Plans 02, 03, 04, 05 | Wasm boundary uses batched byte feeds and shared-memory views | SATISFIED | `term.feed(bytes)` called once per click (grep count = 2, neither in a loop); `Uint8Array` views over `wasm.memory.buffer` using `grid_ptr()` / `dirty_ptr()`; zero JSON serialisation across boundary; `feed_accepts_large_slice_without_panic` integration test passes |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `www/main.js` | 32-33 | Module-level `gridView`/`dirtyView` constructed before any `feed()` call; could be stale after wasm memory growth from a `feed()` that happens before `reDeriveViews()` runs | Warning (CR-01 from REVIEW.md) | Latent only — in the current harness there is no read between `feed()` and `refreshHarnessUI()` which calls `reDeriveViews()` first. A future code insertion between `feed()` and `refreshHarnessUI()` could hit a detached ArrayBuffer. Not a current blocker. |
| `www/main.js` | 90 | `i + 3 < input.length + 1` is algebraically `i + 3 <= input.length` — reads one past end, relies on `charCodeAt` returning `NaN` for out-of-bounds | Info (WR-02 from REVIEW.md) | Behavior is correct (NaN propagation from `hexDigit` returns null, falls through to literal). Misleading but not broken. |
| `scripts/smoke-wasm-build.sh` | 38-41 | No `--release` flag; smoke builds with debug profile | Warning (WR-03 from REVIEW.md) | A bug that only manifests at optimized codegen would pass smoke but fail in production. However, the smoke script's stated purpose is to verify file presence, not production correctness; `scripts/build.sh` uses `--release`. Acceptable for Phase 2. |
| `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` | 36 | `wasm-bindgen` removed from `FORBIDDEN_CRATES`; no test enforces it must remain in target-gated section | Warning (WR-04 from REVIEW.md) | A future contributor moving `wasm-bindgen` from `[target.cfg(wasm32).dependencies]` to `[dependencies]` would not be caught by this test. Token-level test still catches wasm_bindgen in wrong source files. |

No blocker anti-patterns found. The four items above are warnings/info, all pre-identified in the code review.

### Human Verification Required

The four ROADMAP Success Criteria for Phase 2 are browser-based demonstrations that cannot be driven from a shell agent. All automated pre-flight checks pass. The author should run the following in Chromium:

**Pre-flight (all automated — confirmed passing):**

    cargo test -p bestialitty-core          # 143 tests pass
    ./scripts/smoke-wasm-build.sh           # [smoke] OK
    ./scripts/build.sh                      # www/pkg/ populated
    node --check www/main.js                # exit 0

**Start a dev server (pick one):**

    python3 -m http.server -d www 8000
    # OR
    basic-http-server www    # port 4000

#### 1. SC-1: wasm-pack ES-module loads in Chromium

**Test:** Open Chromium DevTools Console, navigate to http://localhost:8000/. Clear console first.

**Expected:** No red errors. Exactly these log lines appear:

    [boot] encode_key_raw(ArrowUp, none) = [27, 65]
    [boot] Harness ready. Terminal= ... wasm.memory= ...

Page renders: textarea with placeholder, Feed and 64 KB Stress buttons, two `<pre>` elements, a status span.

**Why human:** ES-module import and wasm streaming-compile require a running Chromium browser with working Web platform APIs.

#### 2. SC-2: paste -> feed() -> ASCII render

**Test:** Paste `Hello\x1BY\x21\x20World` into the textarea. Click **Feed**.

**Expected:** `<pre id="grid">` shows `Hello` on row 0 (followed by spaces) and `World` starting at row 1 col 0. `<span id="status">` shows `cursor=(1,5) bell=false`. `<pre id="dirty">` shows `11` followed by zeros.

**Why human:** Requires DOM interaction and visual inspection. Depends on SC-1.

#### 3. SC-3: zero-copy Uint8Array views — no per-frame allocation growth

**Test:** DevTools Performance tab → Record. Click **Feed** 5-10 times with simple ASCII input (no ESC sequences). Stop recording.

**Expected:** Memory track shows a flat allocation profile attributable to the WASM BOUNDARY. Specifically: zero allocations attributable to (a) the wasm-bindgen-generated `Terminal.feed` wrapper in `www/pkg/bestialitty_core.js`, and (b) `reDeriveViews()` in `www/main.js`. The pre-text harness paths (`renderAscii` flat-string build, `renderDirty` Array.from().join, `parseHexEscapes` Uint8Array construction) are accepted as harness-only artifacts — Phase 3's canvas renderer eliminates them by replacing the pre-text grid.

**Why human:** Requires DevTools Memory/Performance profiling in a live browser session.

**Updated 2026-04-22 (per 02-06-PLAN.md gap closure):** SC-3 was initially failed in 02-HUMAN-UAT.md (sawtooth observed). Diagnosis (`.planning/debug/sc3-zero-copy-heap-sawtooth.md`) found five allocation sources; the dominant two (wasm-bindgen `feed()` `.slice()` and per-tick `reDeriveViews`) were eliminated by 02-06-PLAN.md (Rust `feed_silent` + cached views with buffer-identity guard). Three pre-text-harness sources (`renderAscii` flat-string build, `renderDirty` Array.from().join, `parseHexEscapes` Uint8Array construction) are intentionally deferred to Phase 3 — the canvas renderer replaces the pre-text grid entirely and these allocations vanish without further code change. SC-3's wording above reflects the post-fix testable contract.

#### 4. SC-4: 64 KB in ONE feed() call

**Test:** Clear DevTools Console. Click **64 KB Stress** once.

**Expected:** Exactly ONE occurrence of each log line per click:

    Terminal.feed 64KB: X ms
    [SC-4] Fed 65536 bytes in ONE feed() call
    [SC-4] Elapsed: N ms
    [SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.

For flame-graph confirmation: DevTools Performance → Record → click **64 KB Stress** once → Stop. A single `Terminal.feed` (or `__wbg_feed_*`) frame should appear in the timeline, not 65,536 stacked frames.

**Why human:** Single-frame vs 65536-frame distinction requires visual flame-graph inspection in a live Chromium DevTools session.

---

### Gaps Summary

No gaps blocking goal achievement. All automated must-haves are verified. The four items marked `human_needed` are browser-based demonstrations that are by design not automatable — they are the canonical SC-1 through SC-4 of the ROADMAP. The code evidence (feed called once, Uint8Array views wired, 65KB integration test passing) supports that all four SCs will pass in browser, but the author must demonstrate them to formally close the phase.

Review warnings (CR-01, WR-01 through WR-04) are improvements but none block the phase goal. They have been noted in the code review and are candidates for Phase 3 housekeeping.

---

_Verified: 2026-04-21_
_Verifier: Claude (gsd-verifier)_
_Re-verified after 02-06-PLAN.md gap closure: 2026-04-22_
