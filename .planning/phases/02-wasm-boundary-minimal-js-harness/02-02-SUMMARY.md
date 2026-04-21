---
phase: 02-wasm-boundary-minimal-js-harness
plan: 02
subsystem: core
tags: [wasm, pack-buffer, zero-copy, terminal, key-unpack, ffi-safety]

# Dependency graph
requires:
  - phase: 02-wasm-boundary-minimal-js-harness
    plan: 01
    provides: "wasm32 target + target-specific wasm-bindgen 0.2.118 dep + FORBIDDEN_TOKENS_WITH_EXEMPTIONS gate (wasm_bindgen exempt only in lib.rs)"
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "Terminal / Scrollback::row(idx) / Dirty::as_slice / Cell #[repr(C)] 8-byte layout / key::{KeyCode, Modifiers, KeyEvent, encode}"
provides:
  - "Terminal::pack_buf + snapshot_grid() + pack_ptr() + pack_byte_len() + dirty_ptr() as pure-Rust methods (no wasm attrs)"
  - "key::unpack_keycode(u32) -> Option<KeyCode> + key::unpack_mods(u32) -> Modifiers decoders"
  - "Pinned wire formats: cursor_packed = (row << 16) | col; keycode tag low 8 bits + payload bits 8-15; mods bits 0..3 = ctrl/shift/alt/meta"
  - "T-02-02-01..05 threat mitigations (resize-grow path, Option<KeyCode> FFI safety, pointer stability, cursor-packed round-trip)"
affects:
  - "Plan 02-03 (lib.rs wasm_bindgen façade): every boundary method is now a one-liner forward to these pure-Rust methods"
  - "Plan 02-04 (boundary_api_shape.rs extension): new pins reference snapshot_grid / pack_ptr / pack_byte_len / dirty_ptr / cursor_packed / encode_key_raw"
  - "Plan 02-05 (pack-buffer integration): buffer already landed here; 02-05 only wires the wasm façade"
  - "Phase 4 DOM keyboard handler: implements against pinned keycode/mods packing scheme, no guesswork"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scratch pack-on-read buffer owned by Terminal (D-01): row-major memcpy from VecDeque<Row> into a contiguous Vec<Cell> once per frame; JS reads a stable (ptr, len) pair"
    - "Option<T> return across the FFI boundary instead of panic (T-02-02-02): lib.rs unwraps with .unwrap_or_default() on unknown discriminants"
    - "Tag/payload packing in a single u32 for discriminated unions (keycode): bits 0-7 tag, 8-15 payload, 16-31 reserved"
    - "TDD gate enforcement: dedicated test(...) commit establishes RED, separate feat(...) commit lands GREEN — each plan task is two commits"

key-files:
  created: []
  modified:
    - "crates/bestialitty-core/src/terminal.rs"
    - "crates/bestialitty-core/src/key.rs"

key-decisions:
  - "pack_buf lives on Terminal (D-04), initialized empty in new() — snapshot_grid() is the single source of truth for sizing (resize-if-needed pattern avoids double-allocation)"
  - "cursor_packed wire format pinned to (row << 16) | col via round-trip test — lib.rs (Plan 03) must use the identical expression"
  - "unpack_keycode returns Option<KeyCode>, not KeyCode with a default — forces lib.rs to be explicit about unknown-tag handling (T-02-02-02)"
  - "Keycode discriminant numbering: 0=Char, 1..4=arrows, 5..8=Enter/Tab/Backspace/Escape, 9=KeypadDigit, 10..13=KeypadEnter/Comma/Minus/Dot — now frozen by unpack_keycode_named_keys_and_keypad_digit test"
  - "Modifier bit layout frozen: bit 0 ctrl, 1 shift, 2 alt, 3 meta, 4..31 reserved — frozen by unpack_mods_bits_map_to_flags test including the 'reserved bits do not flip flags' case"

patterns-established:
  - "Pure-Rust pack-on-read buffer pattern (D-04): zero `#[wasm_bindgen]` attrs in the core module; lib.rs adds them as thin forwards. Native `cargo test` exercises the pack path without cfg(target_arch) gymnastics."
  - "Option<T> + None-on-unknown discriminant pattern for FFI u32 inputs — same pattern extends to any future boundary that decodes an untrusted u32 discriminant"
  - "Grow-once pack buffer: self.pack_buf.resize(needed, Cell::BLANK) only runs when rows*cols changes, so steady-state feed loops never re-allocate"

requirements-completed: [CORE-05]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 2 Plan 02: WASM-Boundary Pure-Rust Support Summary

**Pack-on-read scratch buffer on Terminal + u32 unpackers on key.rs land as pure Rust — Plan 03's lib.rs façade is now mechanically a set of one-line forwards, 11 new unit tests pin wire formats (cursor_packed, keycode tags, mod bits), and all 139 native tests plus CORE-02 stay green without adding a single wasm attr outside lib.rs.**

## Performance

- **Duration:** ~4 minutes (16:51:13Z → 16:54:49Z)
- **Tasks:** 2 (4 atomic commits — RED/GREEN per task per TDD gate)
- **Files modified:** 2
- **Net tests added:** 11 (5 in terminal::tests, 6 in key::tests)
- **Baseline test count:** 128 → **139**

## Accomplishments

- `crates/bestialitty-core/src/terminal.rs` gains a `pack_buf: Vec<Cell>` private field plus four new pub methods: `snapshot_grid()` (row-major memcpy from `Scrollback::row(idx)` into `pack_buf`), `pack_ptr()` (stable raw pointer into `pack_buf`), `pack_byte_len()` (`pack_buf.len() * size_of::<Cell>()`), and `dirty_ptr()` (aliases the existing `Dirty::as_slice().as_ptr()`).
- The pack buffer is lazy-initialized: `Terminal::new` sets it to `Vec::new()` and `snapshot_grid()` resizes it on first call (and only when `visible_rows * cols` changes, so steady-state feed loops do not re-allocate). Pointer stability across `feed()` is pinned by the `pack_ptr_stable_across_feed` test (D-03).
- The `(row << 16) | col` cursor-packed wire format is pinned at the Terminal level via the `cursor_packed_convention_round_trips` test even though the wasm boundary method lands in Plan 03's lib.rs. Any future drift in either Terminal OR lib.rs fails this test immediately.
- `crates/bestialitty-core/src/key.rs` gains two new pub fns: `unpack_keycode(u32) -> Option<KeyCode>` (tag low 8 bits + payload bits 8-15 + reserved bits 16-31) and `unpack_mods(u32) -> Modifiers` (bits 0..3 = ctrl/shift/alt/meta). The Option return type forces lib.rs to handle unknown tags without panicking across the FFI boundary (T-02-02-02 / RESEARCH Pitfall #4).
- Keycode discriminant tags are now frozen: 0=Char, 1..4=arrows, 5=Enter, 6=Tab, 7=Backspace, 8=Escape, 9=KeypadDigit, 10..13=KeypadEnter/Comma/Minus/Dot. Phase 4's DOM handler implements against this pinned contract.
- End-to-end smoke: `unpack_keycode(1)` → `KeyCode::ArrowUp` → `encode(KeyEvent { code, mods })` → `[0x1B, b'A']` — the `unpack_keycode_and_encode_compose` test proves the full pipeline works.
- All verifications green: `cargo test -p bestialitty-core` (139 tests: 118 lib + 10 parser integration + 3 CORE-02 + 8 boundary shape, 0 fail, 0 flags), `cargo build --target wasm32-unknown-unknown -p bestialitty-core` clean, `cargo fmt --check` + `cargo clippy -- -D warnings` clean, no `wasm_bindgen` / `web_sys` / `js_sys` tokens in `terminal.rs` or `key.rs` (CORE-02 stays green).

## Task Commits

Each task followed the TDD RED/GREEN cycle (separate test and feat commits per task) on `main`:

1. **Task 1 RED — failing pack-buffer tests** — `9fb4e75` (test)
2. **Task 1 GREEN — pack-buffer + 4 new Terminal methods** — `f2cac08` (feat)
3. **Task 2 RED — failing unpacker tests** — `593a0c1` (test)
4. **Task 2 GREEN — key::unpack_keycode + unpack_mods** — `e5050a0` (feat)

## Files Created/Modified

- `crates/bestialitty-core/src/terminal.rs` — appended `pack_buf: Vec<Cell>` as the last Terminal struct field with full D-01/D-03/D-04 doc comment; added `pack_buf: Vec::new()` to the struct literal in `new()`; added four pub methods between `resize_scrollback` and the `// --- Parser-callable dispatch methods ---` comment; added five unit tests at the end of the existing `#[cfg(test)] mod tests` block. No existing Phase 1 method body or signature changed.
- `crates/bestialitty-core/src/key.rs` — appended `pub fn unpack_keycode` + `pub fn unpack_mods` at module level after the existing `encode` fn and before the existing `#[cfg(test)] mod tests` block; added six unit tests inside the existing test block. No existing Phase 1 item (`KeyCode`, `Modifiers`, `KeyEvent`, `encode`) touched.

## Decisions Made

- **pack_buf lazy-init in `new()`** (not pre-allocated): `new()` sets `pack_buf: Vec::new()` and `snapshot_grid()` owns the resize-if-needed path. Rationale: single source of truth for sizing; avoids any possibility of `new()` and `snapshot_grid()` disagreeing about what `visible_rows * cols` should equal. Steady-state cost is the same either way because `Vec::resize` with matching length is a no-op.
- **Option<KeyCode> return from unpack_keycode** (not `KeyCode` with default): the `_ => None` arm forces lib.rs (Plan 03) to make an explicit choice about unknown-tag handling. A default-Char-NUL would silently swallow JS-side bugs; None + `Vec::new()` in lib.rs surfaces them as "no bytes written" which Phase 4 can detect.
- **Char tag = 0 + local CHAR_TAG const in test**: clippy flagged `0 | (payload << 8)` as `identity_op`. Rather than lose the conceptual tag-plus-payload structure, the test uses `const CHAR_TAG: u32 = 0;` so the OR expresses the packing scheme explicitly without triggering the lint.
- **Threat register mapping verified**: all five T-02-02-XX threats from the plan are covered by the new tests — T-02-02-01 (DoS via pack_buf indexing) by `snapshot_grid_repopulates_after_resize`, T-02-02-02 (FFI panic) by `unpack_keycode_unknown_tag_is_none`, T-02-02-03 (pointer stability) by `pack_ptr_stable_across_feed`, T-02-02-04 (info disclosure) accepted, T-02-02-05 (cursor-packed convention drift) by `cursor_packed_convention_round_trips`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Clippy identity_op lint on `0 | ((b'A' as u32) << 8)` in the first unpack test**
- **Found during:** Task 2 GREEN verification (`cargo clippy -p bestialitty-core --lib --tests -- -D warnings` failed).
- **Issue:** The test expressed the Char tag as the literal `0`, so `0 | (payload << 8)` triggered `clippy::identity_op`. Treating this as a Rule 1 fix (introduced by my edit, in-scope for the current task) rather than silencing the lint.
- **Fix:** Introduced a local `const CHAR_TAG: u32 = 0;` in the test body. The OR still expresses the tag-plus-payload structure conceptually, and the named constant also makes the scheme more legible.
- **Files modified:** `crates/bestialitty-core/src/key.rs` (test body only; the production `unpack_keycode` fn uses the `0 => Some(KeyCode::Char(payload))` match arm which clippy does not flag).
- **Commit:** folded into the Task 2 GREEN commit `e5050a0`.

**2. [Rule 3 - Formatting] rustfmt reformatted long `assert_eq!` calls in terminal.rs tests**
- **Found during:** Task 1 GREEN verification (`cargo fmt --check` flagged three lines).
- **Issue:** Two long `assert_eq!(..., "message")` calls exceeded the 100-col limit and rustfmt wanted them broken across lines.
- **Fix:** Ran `cargo fmt -p bestialitty-core`. Re-ran `cargo fmt --check` → clean; re-ran full test suite → 139 tests still pass.
- **Files modified:** `crates/bestialitty-core/src/terminal.rs` (formatting only, no semantic change).
- **Commit:** folded into the Task 1 GREEN commit `f2cac08`.

No Rule 2 (missing critical functionality) or Rule 4 (architectural) deviations were triggered.

## Issues Encountered

- Intermediate RED-state test failures are expected by the TDD cycle. The RED commits (`9fb4e75` and `593a0c1`) deliberately land code that fails to compile until the matching GREEN commit (`f2cac08` and `e5050a0`) adds the production methods. A hypothetical bisect into either RED commit would hit a compile error — this is the TDD gate, not a regression.

## Threat Flags

None — every threat from the plan's `<threat_model>` block is either mitigated by a test shipped in this plan or explicitly accepted (T-02-02-04). No new boundary surface beyond what the plan enumerated was introduced.

## User Setup Required

None — pure Rust changes, zero new dependencies. Contributors who `cargo test` after this plan get the 11 new tests automatically.

## Threat Model Verification

- **T-02-02-01 (Denial of Service, `snapshot_grid` indexing):** mitigated. `pack_buf.resize(needed, Cell::BLANK)` runs before the copy loop whenever `visible_rows * cols` changes; `copy_from_slice` cannot panic because source and destination lengths are algebraically equal. Verified by `snapshot_grid_repopulates_after_resize` (exercises the 3×4 → 5×10 resize path).
- **T-02-02-02 (Denial of Service, FFI panic):** mitigated. `unpack_keycode` returns `Option<KeyCode>`; unknown tags (0xFF, 100, 255) return `None`. Verified by `unpack_keycode_unknown_tag_is_none`.
- **T-02-02-03 (Tampering, `pack_ptr` stability):** mitigated. Pointer captured before `feed()` equals pointer captured after `feed()` on a 24×80 terminal. Verified by `pack_ptr_stable_across_feed`.
- **T-02-02-04 (Information Disclosure, `pack_ptr`):** accepted. The pointer is always into `pack_buf`, a Vec<Cell> owned by Terminal; Cell is `#[repr(C)]` with a zeroed `_pad` byte. No unrelated wasm memory is exposed.
- **T-02-02-05 (Spoofing, `cursor_packed` convention drift):** mitigated. The `(row << 16) | col` expression is pinned in `cursor_packed_convention_round_trips`. Plan 03's lib.rs must use the identical expression or the test fails.

## Next Plan Readiness

- **Plan 02-03 (lib.rs wasm_bindgen façade):** unblocked. Every boundary method is a one-line forward — e.g. `pub fn pack_ptr(&self) -> *const u8 { self.inner.pack_ptr() }` with `#[wasm_bindgen]` on the wrapper struct. `encode_key_raw` is literally `key::encode(KeyEvent { code: unpack_keycode(code)?, mods: unpack_mods(mods) }).unwrap_or_default()` pattern.
- **Plan 02-04 (boundary_api_shape.rs extension):** unblocked. The pin file adds compile-time assertions that `snapshot_grid: fn(&mut Terminal)`, `pack_ptr: fn(&Terminal) -> *const u8`, `pack_byte_len: fn(&Terminal) -> usize`, `dirty_ptr: fn(&Terminal) -> *const u8`, `cursor_packed: fn(&Terminal) -> u32`, and `encode_key_raw: fn(u32, u32) -> Vec<u8>` all exist at expected signatures. Phase 1's existing pins stay unchanged.
- **Plan 02-05 (pack-buffer integration):** partial early win — the pack buffer itself is already landed here; 02-05 now only needs to wire the wasm façade (if any extra work beyond Plan 03 remains), rather than landing the buffer plumbing.
- No blockers added; no deferred items.

## Self-Check: PASSED

Verified on disk via Grep:
- `crates/bestialitty-core/src/terminal.rs` contains `pack_buf: Vec<Cell>,` at line 40 — FOUND
- `crates/bestialitty-core/src/terminal.rs` contains `pub fn snapshot_grid(&mut self)` at line 127 — FOUND
- `crates/bestialitty-core/src/terminal.rs` contains `pub fn pack_ptr(&self) -> *const u8` at line 146 — FOUND
- `crates/bestialitty-core/src/terminal.rs` contains `pub fn pack_byte_len(&self) -> usize` at line 153 — FOUND
- `crates/bestialitty-core/src/terminal.rs` contains `pub fn dirty_ptr(&self) -> *const u8` at line 160 — FOUND
- `crates/bestialitty-core/src/key.rs` contains `pub fn unpack_keycode(code: u32) -> Option<KeyCode>` at line 141 — FOUND
- `crates/bestialitty-core/src/key.rs` contains `pub fn unpack_mods(mods: u32) -> Modifiers` at line 170 — FOUND
- Neither file contains `wasm_bindgen`, `web_sys`, or `js_sys` — CONFIRMED

Verified via git:
- `9fb4e75` (test 02-02 RED pack-buffer) — FOUND in `git log --oneline -6`
- `f2cac08` (feat 02-02 GREEN pack-buffer) — FOUND
- `593a0c1` (test 02-02 RED unpackers) — FOUND
- `e5050a0` (feat 02-02 GREEN unpackers) — FOUND

Verified via cargo:
- `cargo test -p bestialitty-core` — 139 tests pass (118 lib + 10 parser + 3 CORE-02 + 8 boundary shape), 0 fail, 0 flags — CONFIRMED
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` — 3 pass — CONFIRMED (CORE-02 still green)
- `cargo build --target wasm32-unknown-unknown -p bestialitty-core` — exits 0 — CONFIRMED
- `cargo fmt --check -p bestialitty-core` — clean — CONFIRMED
- `cargo clippy -p bestialitty-core --lib --tests -- -D warnings` — clean — CONFIRMED

---
*Phase: 02-wasm-boundary-minimal-js-harness*
*Plan: 02*
*Completed: 2026-04-21*
