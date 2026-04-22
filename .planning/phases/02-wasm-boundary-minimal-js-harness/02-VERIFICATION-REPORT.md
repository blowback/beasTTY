---
phase: 02-wasm-boundary-minimal-js-harness
verified: 2026-04-22T10:00:00Z
mode: post-human-UAT goal-backward verification
verdict: PHASE COMPLETE
score: 4/4 SCs PASS; 3/3 requirements SATISFIED; 5/5 quality gates GREEN
---

# Phase 2 Verification Report — Post-Gap-Closure Goal-Backward

**Phase goal (ROADMAP §Phase 2):** "Prove the Rust->JS interop shape end-to-end
with the smallest possible JS surface area — batched `feed(bytes)`, zero-copy
`Uint8Array` views over wasm linear memory, and a `wasm-pack --target web`
build that a static site can consume directly."

**Context for this re-verification:** Phase 2 Plan 06 closed the SC-3
zero-copy heap-sawtooth gap. Author has just approved the Chromium DevTools
demo. 02-HUMAN-UAT.md now shows 4/4 PASS, status=complete, gap=closed.
This report verifies the artifacts in the working tree actually deliver what
the goal promises — not just what the SUMMARYs claim.

## Success Criteria

### SC-1: wasm ES-module loads in Chromium without a bundler step — PASS

**Evidence:**
- `www/index.html:53` — `<script type="module" src="./main.js">` loads as bare ES module.
- `www/main.js:14` — `import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js';`
- `www/main.js:18` — `const wasm = await init();` top-level-await (Chromium >=89).
- `www/pkg/` present with `bestialitty_core.js` (11,010 B), `bestialitty_core_bg.wasm` (40,984 B), `bestialitty_core.d.ts`, `bestialitty_core_bg.wasm.d.ts`, `package.json`.
- `./scripts/smoke-wasm-build.sh` exits 0 with `[smoke] OK`.
- Author UAT 2026-04-22: Chromium demo PASS.

### SC-2: paste -> feed() -> ASCII render — PASS

**Evidence:**
- Feed handler at `www/main.js:132-147` wires `#feed` button to `term.feed(bytes)` exactly once per click (grep count `term.feed(bytes)` = 2: one in Feed handler, one in 64 KB Stress handler — neither inside a loop).
- `renderAscii()` at `www/main.js:58-75` reads from `gridView` (a `Uint8Array` over `wasm.memory.buffer`) and writes to `document.getElementById('grid').textContent`.
- `www/index.html:46` — `<pre id="grid">`; `www/index.html:39` — `<textarea id="input">`.
- No `navigator.serial`, no `addEventListener('keydown')`, no `innerHTML` in `www/main.js` (correct Phase 2 scope exclusion).
- Author UAT 2026-04-22: Chromium demo PASS (`Hello\x1BY\x21\x20World` -> `Hello` on row 0, `World` on row 1, `cursor=(1,5)`).

### SC-3: zero-copy `Uint8Array` views with no per-frame allocation growth — PASS

**Evidence — Rust side:**
- `crates/bestialitty-core/src/lib.rs:76-78` — `pub fn feed(&mut self, bytes: &[u8]) { self.inner.feed_silent(bytes); }` returns `()`.
- `crates/bestialitty-core/src/lib.rs:83-95` — `host_reply_ptr() -> *const u8`, `host_reply_len() -> usize`, `clear_host_reply()` all exported via wasm_bindgen.
- `crates/bestialitty-core/src/terminal.rs:56` — `host_reply: Vec::with_capacity(8)` pre-reserved at construction (pointer stability).
- `crates/bestialitty-core/src/terminal.rs:90-96` — `feed_silent` does not take or return `host_reply`.

**Evidence — generated JS wrapper:**
- `www/pkg/bestialitty_core.js:84-88` — the new `feed(bytes)` body contains ONLY `passArray8ToWasm0 + wasm.terminal_feed`. No `.slice()`, no `__wbindgen_free`, no `getArrayU8FromWasm0` in this method. (The three tokens still appear at lines 179, 180, 209 but exclusively inside `encode_key_raw`, which is not in the SC-3 hot path.)

**Evidence — JS harness:**
- `www/main.js:38-48` — module-scope cached `gridView` / `dirtyView` / `hostReplyView` + `cachedBuffer`.
- `www/main.js:51` — literal guard `if (wasm.memory.buffer !== cachedBuffer) rebuildViews();`.
- `www/main.js:54` — one-time `rebuildViews()` at startup.
- `www/main.js:138-145, 181-186` — host_reply drained via `host_reply_len()` + `hostReplyView.subarray(0, replyLen)` + `clear_host_reply()` — zero-alloc in the common empty-reply path.
- Author UAT 2026-04-22: Chromium DevTools Performance demo PASS — no wasm-boundary heap sawtooth.

### SC-4: 64 KB in a single `feed()` call — PASS

**Evidence:**
- `www/main.js:151-169` — `buildStressPayload(65536)` constructs a `Uint8Array(65536)` before timing.
- `www/main.js:171-194` — stress handler calls `term.feed(bytes)` exactly once between `performance.now()` t0/t1 markers; the four `[SC-4]` log strings (`Fed 65536 bytes in ONE feed() call`, `Elapsed`, `If this log appears ONCE...`) emit once per click.
- `crates/bestialitty-core/tests/boundary_api_shape.rs::feed_accepts_large_slice_without_panic` passes (part of 148-test green).
- Author UAT 2026-04-22: Chromium Performance flame graph shows ONE `Terminal.feed` entry.

## Requirements Coverage

| Req     | Description                                                                    | Status    | Evidence                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORE-03 | Rust-JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`)               | SATISFIED | `scripts/build.sh` invokes `wasm-pack build --target web`; `smoke-wasm-build.sh` green; `www/pkg/bestialitty_core.js` is an ES module produced by wasm-bindgen; `lib.rs` is the sole `wasm_bindgen` site. |
| CORE-04 | JS shell owns Web Serial I/O, canvas, event loop, browser state               | SATISFIED | Zero `web_sys` / `js_sys::Serial*` anywhere in `crates/bestialitty-core/src/*`. `www/main.js` drives wasm from JS; no Rust Web Serial bindings exist. (Web Serial itself is Phase 5, correctly out of scope here.) |
| CORE-05 | Wasm boundary uses batched byte feeds and shared-memory views                  | SATISFIED | `term.feed(bytes)` called once per click (never per-byte); grid/dirty/host_reply all exposed via `ptr`+`len` with zero JSON across the boundary. 64 KB single-call integration test green.             |

## Quality Gates (working tree, 2026-04-22)

| Gate                                                               | Result                                     |
| ------------------------------------------------------------------ | ------------------------------------------ |
| `cargo test -p bestialitty-core`                                   | **148 tests pass, 0 failed** (118 lib + 19 boundary_api_shape + 3 core_02_no_browser_deps + 8 fixture_runner) |
| `cargo build --target wasm32-unknown-unknown -p bestialitty-core`  | **Exit 0** — `Finished dev profile`        |
| `cargo test -p bestialitty-core --test core_02_no_browser_deps`    | **3/3 pass** — `cargo_toml_declares_cdylib_and_rlib`, `source_files_contain_no_wasm_attrs`, `dependency_graph_excludes_browser_crates` |
| `./scripts/smoke-wasm-build.sh`                                    | **`[smoke] OK`**, 40,984 B wasm, cleaned up |
| `node --check www/main.js`                                         | **Exit 0**                                 |

## Architecture Invariants

- **Pure-Rust core:** No `web_sys` / `js_sys::Serial*` in `crates/bestialitty-core/src/*`. The only two source files mentioning `wasm_bindgen` are `lib.rs` (uses it — exempt) and `vt52.rs` (mentions it only in a comment forbidding it). Verified by `core_02_no_browser_deps::source_files_contain_no_wasm_attrs`.
- **`wasm_bindgen` confinement:** Only `crates/bestialitty-core/src/lib.rs` carries `#[wasm_bindgen]` attributes, gated by `#[cfg(target_arch = "wasm32")] mod wasm_boundary` (lib.rs:33-172).
- **Chromium-only policy:** Top-level-await + ES module + Web Serial plan remain Chromium-only as per CLAUDE.md. Polite-fail lives in Phase 5 scope.

## Threat Model (02-06-PLAN.md T-02-06-01..05)

- **T-02-06-02 (tampering — JS reads past `host_reply_len`):** MITIGATED. `www/main.js:143` and `www/main.js:184` both use `hostReplyView.subarray(0, replyLen)`, never raw `hostReplyView`. `HOST_REPLY_VIEW_CAP=8` (line 36) matches Rust `Vec::with_capacity(8)`, so even a future slip cannot overrun the Vec.
- T-02-06-01, T-02-06-03, T-02-06-04, T-02-06-05: all documented as `accept` with rationale in 02-06-PLAN.md; no code mitigations required.

## Gaps / Regressions

**None.** The original SC-3 gap (heap sawtooth) is closed in code and confirmed by the author's Chromium DevTools demo. No new regressions detected. Review warnings CR-01/WR-02/WR-03/WR-04 from the initial verification remain non-blocking.

## Verdict: PHASE COMPLETE

All four ROADMAP Success Criteria PASS in the working tree. All three mapped
requirements (CORE-03/04/05) SATISFIED. All five quality gates GREEN. No
blocker anti-patterns. Architecture invariants held. Threat model
mitigations in place.

**Next logical step: Phase 3 — Canvas Renderer.** The ptr/len/ack triad and
buffer-identity-guard pattern established in Plan 06 are the canonical shape
Phase 3 will inherit; the three deferred pre-text-harness allocation sources
(`renderAscii`, `renderDirty`, `parseHexEscapes`) vanish by construction when
canvas replaces the `<pre>` grid.
