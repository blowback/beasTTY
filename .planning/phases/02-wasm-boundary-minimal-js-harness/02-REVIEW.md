---
phase: 02-wasm-boundary-minimal-js-harness
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - .gitignore
  - crates/bestialitty-core/Cargo.toml
  - crates/bestialitty-core/src/key.rs
  - crates/bestialitty-core/src/lib.rs
  - crates/bestialitty-core/src/terminal.rs
  - crates/bestialitty-core/tests/boundary_api_shape.rs
  - crates/bestialitty-core/tests/core_02_no_browser_deps.rs
  - rust-toolchain.toml
  - scripts/build.sh
  - scripts/smoke-wasm-build.sh
  - www/.gitignore
  - www/README.md
  - www/index.html
  - www/main.js
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-21
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 2 delivers the wasm-bindgen boundary facade in `lib.rs`, a minimal JS
harness in `www/`, and supporting scripts and tests. The overall architecture
is sound: the `wasm_boundary` module is correctly gated to `wasm32` only,
`wasm_bindgen` attributes are confined to `lib.rs` as required, and the JS
harness uses `textContent` exclusively (no `innerHTML`). The `set -euo pipefail`
discipline is consistent across both shell scripts.

One critical issue is present: `pack_ptr()` / `dirty_ptr()` are exposed as
`*const u8` through the wasm boundary and are called from JS after wasm memory
may have grown, but the D-03 invalidation contract only forbids `feed()` from
moving `pack_buf` — it does not account for the wasm linear-memory growth event
that detaches *every* `Uint8Array` view simultaneously. The JS code calls
`reDeriveViews()` defensively but only at render time, not immediately after
`term.feed()`. If a `feed()` call causes wasm memory to grow (triggering
`ArrayBuffer` detachment) and the caller reads the returned `Vec<u8>` through
a previously constructed view before `reDeriveViews()` runs, the old buffer is
already detached. This is latent rather than immediately reproducible at Phase 2
scope, but the contract documentation overstates its own safety guarantee.

Four warnings cover: the hex-escape boundary-condition off-by-one in
`parseHexEscapes`, the `pack_buf` pointer exposed as a raw `*const u8` that
returns a dangling pointer before `snapshot_grid()` is called, the missing
`--release` flag in the smoke build (diverging from the prod build), and the
`core_02_no_browser_deps` test that parses `cargo metadata` JSON by substring
match in a way that cannot detect `wasm-bindgen` added as a non-target dep.

---

## Critical Issues

### CR-01: Memory-view detachment window between `feed()` and `reDeriveViews()`

**File:** `www/main.js:119`
**Issue:** The `feed` button handler calls `term.feed(bytes)` and then
`refreshHarnessUI()`. `refreshHarnessUI()` calls `renderAscii()`, which calls
`reDeriveViews()` before reading `gridView`. This ordering is correct for the
render path. However, `gridView` and `dirtyView` are constructed once at module
load time (lines 32-33) against `wasm.memory.buffer`. If `term.feed(bytes)` at
line 119 causes wasm linear memory to grow — which detaches the original
`ArrayBuffer` — any code that reads `gridView` or `dirtyView` before
`reDeriveViews()` runs will throw
`TypeError: Cannot perform %TypedArray%.prototype.length on detached ArrayBuffer`.

In the current harness there is no read between `feed()` and
`refreshHarnessUI()`, so the bug is not immediately triggered. But the module-
level `gridView`/`dirtyView` at lines 32-33 are stale from the moment `feed()`
causes growth, and any future code inserted between `term.feed(bytes)` and
`refreshHarnessUI()` — for example, an early-return on empty reply, a debug
log reading `dirtyView.length`, or Phase 3's renderer being wired in before the
defensive re-derive — will hit a detached buffer.

The D-03 comment in `terminal.rs` (line 39) and the JS comment at line 31
document that `reDeriveViews()` must be called after `resize()`. They do not
document that any `feed()` that triggers wasm memory growth also detaches all
views, which makes the contract misleadingly narrow. The actual invariant is:
"after ANY wasm call that may allocate, re-derive before reading."

**Fix:** Wrap the view derivation in a helper that is called immediately after
`term.feed()` returns, before any downstream consumer can see the old buffer.
The simplest change is to make `reDeriveViews()` the first thing called inside
`refreshHarnessUI()` (before `renderAscii()` calls it again — the second call
is then a cheap no-op):

```js
// www/main.js — feed handler
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);
    reDeriveViews();   // <-- always re-derive immediately after feed(),
                       //     before ANY consumer touches gridView/dirtyView
    refreshHarnessUI();
});
```

And the same pattern in the stress handler:
```js
document.getElementById('stress64k').addEventListener('click', () => {
    const bytes = buildStressPayload(65536);
    console.time('Terminal.feed 64KB');
    const t0 = performance.now();
    term.feed(bytes);
    reDeriveViews();   // <-- re-derive before reading any view
    const t1 = performance.now();
    console.timeEnd('Terminal.feed 64KB');
    ...
});
```

Also update the D-03 contract in `terminal.rs` line 39 to state: "Invalidated
by `resize(rows, cols)` OR by any wasm allocation that causes linear-memory
growth — JS must re-derive its `Uint8Array` views after every boundary call
that may allocate."

---

## Warnings

### WR-01: `pack_ptr()` returns a dangling pointer before `snapshot_grid()` is called

**File:** `crates/bestialitty-core/src/terminal.rs:146`
**Issue:** `pack_ptr()` is defined as:
```rust
pub fn pack_ptr(&self) -> *const u8 {
    self.pack_buf.as_ptr() as *const u8
}
```
`pack_buf` is initialized as `Vec::new()` (line 56), which allocates no heap
storage. `Vec::new().as_ptr()` returns a non-null dangling pointer (Rust
guarantees `as_ptr()` is non-null even for empty Vecs, but the pointer does not
point to valid memory). If JS calls `term.grid_ptr()` before
`term.snapshot_grid()` — which is valid JS since nothing in the exported API
enforces ordering — the returned pointer is dangling. Constructing a
`Uint8Array` over a dangling wasm pointer is undefined behavior and will produce
corrupted data or a crash.

The `pack_byte_len()` returns 0 in that state (line 153-154, `0 * size_of`),
so a zero-length `Uint8Array` constructed from a dangling pointer happens to be
safe in practice. However, this is an accident of the current Chromium
implementation; the spec does not guarantee it, and a future reader can easily
call `grid_byte_len()` after `resize()` (which changes `pack_buf`'s length but
does not populate it until `snapshot_grid()` is called) and get a non-zero
length with a stale pointer.

**Fix:** Either document `snapshot_grid()` as a mandatory precondition in the
wasm boundary comment block and add an assertion in `pack_ptr()`:
```rust
pub fn pack_ptr(&self) -> *const u8 {
    // pack_buf is populated by snapshot_grid(). Calling grid_ptr()
    // before snapshot_grid() returns a dangling pointer if pack_buf is empty.
    debug_assert!(!self.pack_buf.is_empty(),
        "pack_ptr() called before snapshot_grid(); pointer is dangling");
    self.pack_buf.as_ptr() as *const u8
}
```
Or, populate `pack_buf` in `Terminal::new()` so the initial pointer is always
valid:
```rust
let mut t = Self { ..., pack_buf: Vec::new() };
t.snapshot_grid();  // pre-populate at construction
t
```
The latter removes the ordering footgun entirely.

---

### WR-02: `parseHexEscapes` off-by-one allows reading past the last character

**File:** `www/main.js:90`
**Issue:** The boundary check for a `\x` escape sequence is:
```js
if (ch === 0x5C
    && i + 3 < input.length + 1    // <-- equivalent to: i + 3 <= input.length
    && ...)
```
`i + 3 < input.length + 1` is algebraically equivalent to `i + 3 <= input.length`,
which means indices `i`, `i+1`, `i+2`, `i+3` are all read when
`i + 3 === input.length`. Index `i+3` is `input.charCodeAt(i + 3)` where
`i+3 = input.length`, which returns `NaN` for a valid string (out-of-bounds
`charCodeAt` returns `NaN`).

`hexDigit(NaN)` — `NaN` is passed as `c` — evaluates to `null` (none of the
comparison branches match), so `loVal` is `null` and the function falls through
to the backslash-as-literal path. The malformed escape is silently treated as a
literal backslash, which is the documented intent ("fall through and treat
backslash as literal"). So the behavior is correct, but the boundary expression
is misleading: it reads one character past the end and relies on `NaN`
propagation from `charCodeAt` to paper over the overread. A reader expecting
`i + 3 < input.length` (strict, no +1 trick) will find a subtle discrepancy.

The cleaner form that is both correct and self-documenting is the strict
inequality:
```js
// require all 4 chars (\, x, H, L) to be present
if (ch === 0x5C
    && i + 3 < input.length     // strict: indices i..i+3 all valid
    && (input.charCodeAt(i + 1) === 0x78 || input.charCodeAt(i + 1) === 0x58))
```
With this change `loVal` is only computed when `i+3` is a valid index; no
`NaN`-propagation crutch needed.

**Fix:**
```js
// main.js line 90 — replace: i + 3 < input.length + 1
// with:
if (ch === 0x5C
    && i + 3 < input.length
    && (input.charCodeAt(i + 1) === 0x78 || input.charCodeAt(i + 1) === 0x58)) {
```

---

### WR-03: `smoke-wasm-build.sh` omits `--release`; builds a debug wasm

**File:** `scripts/smoke-wasm-build.sh:38`
**Issue:** The smoke build runs:
```bash
wasm-pack build crates/bestialitty-core \
    --target web \
    --out-dir "$TMPDIR_OUT" \
    "${NOOPT_ARG[@]}"
```
There is no `--release` flag. `wasm-pack build` defaults to `--dev` when
`--release` is not specified, meaning CI runs the smoke gate against an
unoptimized debug wasm. A bug that only manifests at optimized codegen (DCE of
an unexported function, optimizer-exposed UB in an `unsafe` block, LTO strip of
a needed wasm export) would pass smoke but fail in production.

The `scripts/build.sh` correctly passes `--release` explicitly (line 27-30).
The smoke script's intent (per its header comment) is to verify that
`wasm-pack` still produces the expected file set — it does not need to be fast
enough to justify a debug build, especially since `--no-opt` already eliminates
the slow wasm-opt step.

**Fix:**
```bash
# scripts/smoke-wasm-build.sh line 38 — add --release
wasm-pack build crates/bestialitty-core \
    --target web \
    --out-dir "$TMPDIR_OUT" \
    --release \
    "${NOOPT_ARG[@]}"
```

---

### WR-04: `core_02_no_browser_deps` dep-graph check cannot detect `wasm-bindgen` as a non-target dep

**File:** `crates/bestialitty-core/tests/core_02_no_browser_deps.rs:36`
**Issue:** `wasm-bindgen` was intentionally removed from `FORBIDDEN_CRATES` in
Phase 2 (per the comment at line 37-39). The test therefore no longer enforces
that `wasm-bindgen` only appears in the `[target.'cfg(target_arch = "wasm32")'.dependencies]`
section. If a future contributor accidentally moves `wasm-bindgen` from the
target-gated section to the unconditional `[dependencies]` section of
`Cargo.toml`, the dep-graph check will not catch it — `cargo metadata` will
still include `wasm-bindgen` in the resolved graph for the native test target,
but the test no longer looks for it.

The token-level test in `source_files_contain_no_wasm_attrs` (line 115) still
catches accidental `wasm_bindgen` usage in non-`lib.rs` source files, but it
does not catch the Cargo.toml placement regression.

**Fix:** Add a targeted `Cargo.toml` check alongside the existing
`cargo_toml_declares_cdylib_and_rlib` test to verify that `wasm-bindgen` only
appears inside a `[target.'cfg(target_arch = "wasm32")'.dependencies]` section:

```rust
#[test]
fn wasm_bindgen_is_only_in_target_gated_section() {
    let cargo_toml =
        std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")
        ).expect("Cargo.toml must be readable");

    // wasm-bindgen must NOT appear under [dependencies] (unconditional).
    // Parse naively: find [dependencies] section and scan until the next [
    // heading; assert wasm-bindgen is absent there.
    let mut in_unconditional_deps = false;
    for line in cargo_toml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_unconditional_deps = trimmed == "[dependencies]";
        }
        if in_unconditional_deps && trimmed.starts_with("wasm-bindgen") {
            panic!(
                "wasm-bindgen found in unconditional [dependencies]. \
                 It must only be in [target.'cfg(target_arch = \"wasm32\")'.dependencies] \
                 per ADR-002."
            );
        }
    }
}
```

---

## Info

### IN-01: `encode_key_raw` import is unused at runtime in the harness (dead-stripped risk)

**File:** `www/main.js:14`
**Issue:** `encode_key_raw` is imported from the wasm module and called once at
boot (line 23) as a smoke exercise with the result logged. After boot it is
never used. The comment on line 22 acknowledges this: "Phase 4 will wire DOM
keydown to it." This is intentional for Phase 2, but the single call is only
to prevent dead-stripping of the export. If `wasm-bindgen` adds more aggressive
tree-shaking in a future version, the export may be stripped even with the one
call. A more robust approach for Phase 4 wiring would be to export it as a
module-level name that can be reached from a future event handler:

```js
// Export for Phase 4 use instead of a one-shot smoke call
window._encodeKeyRaw = encode_key_raw;
```

This is low-priority for Phase 2; noting for Phase 4 handoff.

---

### IN-02: `console.log` boot lines are production noise

**File:** `www/main.js:24,165`
**Issue:** `console.log('[boot] encode_key_raw(...)')` and
`console.log('[boot] Harness ready...')` are present. For a Phase 2 dev harness
this is appropriate and intentional. Phase 3 should audit and remove or
gate them behind a `DEBUG` flag to avoid noisy DevTools output in the
daily-driver build.

---

### IN-03: `build.sh` `--out-dir` path relies on wasm-pack's cwd-relative resolution

**File:** `scripts/build.sh:27`
**Issue:** The `--out-dir ../../www/pkg` path is documented as being resolved
relative to the crate's `Cargo.toml` directory (per the script's own comment
on line 8). This is correct for the current crate layout. However, if the crate
is ever moved or the script is called with an unexpected working directory, the
`cd "$(dirname "$0")/.."` at line 25 sets cwd to the repo root, not to the
crate directory, so the relative `../../www/pkg` will resolve relative to the
repo root and produce a path two levels above the repo. The current behavior is
correct because `wasm-pack` internally `cd`s to the crate directory before
resolving `--out-dir`, but this is an undocumented wasm-pack implementation
detail.

For robustness, prefer an absolute path:
```bash
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
wasm-pack build crates/bestialitty-core \
    --target web \
    --out-dir "$REPO_ROOT/www/pkg" \
    --release
```

---

_Reviewed: 2026-04-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
