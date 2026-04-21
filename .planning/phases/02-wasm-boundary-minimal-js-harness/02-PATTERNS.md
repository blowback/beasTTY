# Phase 2: Wasm Boundary & Minimal JS Harness — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 13 (8 modify, 5 create)
**Analogs found in codebase:** 8 / 13 (5 create-from-scratch files have no in-repo analog — canonical external refs cited)

## File Classification

| File | Action | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `crates/bestialitty-core/src/lib.rs` | MODIFY | boundary façade (wasm-bindgen) | request-response (FFI) | current `crates/bestialitty-core/src/lib.rs` (17 lines, doc + mod tree) — self-extension; structural shape from Phase 1 Terminal methods it will wrap | self / exact-role |
| `crates/bestialitty-core/src/terminal.rs` | MODIFY | core state + new `pack_buf` buffer | transform (memcpy), pointer export | same file (already hosts every method lib.rs will wrap) | exact |
| `crates/bestialitty-core/src/key.rs` | MODIFY | utility (u32 → KeyEvent unpacker helpers) | transform | same file (`encode` pure fn; unpackers follow same signature style) | exact |
| `crates/bestialitty-core/Cargo.toml` | MODIFY | config (manifest) | n/a | same file (existing `[dependencies] vte = "=0.15"` section) | exact |
| `crates/bestialitty-core/tests/boundary_api_shape.rs` | MODIFY | test (compile-time signature pin) | n/a | same file (every existing `#[test]` is the template) | exact |
| `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` | MODIFY | test (lint-ish source + metadata gate) | filesystem scan, process-output parse | same file (the walker + allowlist machinery is already there) | exact |
| `rust-toolchain.toml` | MODIFY | config (toolchain) | n/a | same file (one-line addition; existing `components` array is the template) | exact |
| `scripts/build.sh` | CREATE | build orchestration script | subprocess (invokes wasm-pack) | no existing `scripts/` dir — first script in repo. Canonical shape from RESEARCH Pitfall #5. | no-analog |
| `www/index.html` | CREATE | static HTML harness | DOM event-driven | no existing HTML in repo. Canonical shape from wasm-bindgen "without a bundler" guide + RESEARCH Pattern 1. | no-analog |
| `www/main.js` | CREATE | browser shell (JS harness driver) | event-driven / request-response over FFI | no existing JS in repo. Canonical shape from RESEARCH Patterns 1-3 + hex-escape parser in RESEARCH §"Hex-Escape Textarea Parser". | no-analog |
| `www/.gitignore` | CREATE | config (per-dir ignore) | n/a | repo-root `.gitignore` (tiny; same shape) | role-match |
| `.planning/decisions/ADR-002-wasm-gating.md` | CREATE (maybe) | decision record | n/a | `.planning/decisions/ADR-001-parser-strategy.md` | exact |
| `.planning/decisions/ADR-001-parser-strategy.md` | reference only | — | — | — | (template source) |

## Pattern Assignments

### `crates/bestialitty-core/src/lib.rs` (boundary façade)

**Analog:** `crates/bestialitty-core/src/lib.rs` (current state — 17 lines, doc + module tree). Phase 2 preserves lines 1-16 verbatim and adds a wasm-gated `mod wasm_boundary` below them.

**Preserve (current `lib.rs:1-16`):**
```rust
//! bestialitty-core: pure-Rust VT52 terminal logic.
//!
//! No browser deps. Logic lives in sub-modules; this file is a thin boundary
//! that Phase 2 will populate with `wasm-bindgen` exports. In Phase 1 it
//! declares the module tree and nothing else.
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-20): logic modules are wasm-free.
//! Any `wasm_bindgen` / `web_sys` / `js_sys` attrs stay confined to this file,
//! added in Phase 2 — not here.

pub mod dirty;
pub mod grid;
pub mod key;
pub mod scrollback;
pub mod terminal;
pub mod vt52;
```

**Add (wasm-bindgen façade, Candidate A gating per RESEARCH Pattern 4):**
The ONLY file in the crate that carries `#[wasm_bindgen]` (D-06, D-20). Entire façade is `#[cfg(target_arch = "wasm32")]`-gated so native `cargo test` compiles `lib.rs` down to just the module tree.

**Façade shape to copy (from RESEARCH lib.rs code example, lines 420-486 of `02-RESEARCH.md`, condensed):**
```rust
// ==== wasm boundary (wasm32 only) — Phase 2 addition ====
#[cfg(target_arch = "wasm32")]
mod wasm_boundary {
    use wasm_bindgen::prelude::*;
    use crate::terminal::Terminal as CoreTerminal;
    use crate::key::{self, KeyEvent, unpack_keycode, unpack_mods};

    #[wasm_bindgen]
    pub struct Terminal { inner: CoreTerminal }

    #[wasm_bindgen]
    impl Terminal {
        #[wasm_bindgen(constructor)]
        pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Terminal {
            Terminal { inner: CoreTerminal::new(rows, cols, scrollback_cap) }
        }

        pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8> { self.inner.feed(bytes) }

        pub fn snapshot_grid(&mut self) { self.inner.snapshot_grid(); }
        pub fn grid_ptr(&self) -> *const u8 { self.inner.pack_ptr() }
        pub fn grid_byte_len(&self) -> usize { self.inner.pack_byte_len() }
        pub fn dirty_ptr(&self) -> *const u8 { self.inner.dirty_ptr() }

        pub fn rows(&self) -> u32 { self.inner.rows() }
        pub fn cols(&self) -> u32 { self.inner.cols() }

        pub fn clear_dirty(&mut self) { self.inner.clear_dirty(); }
        pub fn bell_pending(&self) -> bool { self.inner.bell_pending() }
        pub fn clear_bell(&mut self) { self.inner.clear_bell(); }

        pub fn cursor_packed(&self) -> u32 {
            let (r, c) = self.inner.cursor();
            (r << 16) | c
        }

        pub fn resize(&mut self, rows: u32, cols: u32) { self.inner.resize(rows, cols); }
        pub fn resize_scrollback(&mut self, new_cap: usize) { self.inner.resize_scrollback(new_cap); }
    }

    #[wasm_bindgen]
    pub fn encode_key_raw(code: u32, mods: u32) -> Vec<u8> {
        let Some(kc) = unpack_keycode(code) else { return Vec::new(); };
        key::encode(KeyEvent { code: kc, mods: unpack_mods(mods) })
    }
}
```

**Constraints to honor:**
- **Thin-wrapper rule:** every Phase-1 Terminal method already exists in `src/terminal.rs:32-107`; façade methods only forward. No logic lives here.
- **No `web_sys` / `js_sys` tokens anywhere in `lib.rs`** (D-07). The CORE-02 test keeps those forbidden even with `lib.rs` exempted from the `wasm_bindgen` rule.
- **`#[wasm_bindgen(constructor)]`** on `new` — resolves Open Question 3 (`new Terminal(...)` in JS).
- **`cursor_packed`** packing is `(row << 16) | col` exactly (D-09 + RESEARCH Open Question convention); pinned by `boundary_api_shape.rs`.

---

### `crates/bestialitty-core/src/terminal.rs` (core + pack-buf)

**Analog:** `crates/bestialitty-core/src/terminal.rs` (current file — 20 KB, hosts every Phase-1 Terminal method; lines 17-30 struct def, lines 32-107 constructor + query/mutator methods).

**Preserve:**
- `Terminal` struct fields (lines 17-30) — append `pack_buf: Vec<Cell>` as a new private field.
- Constructor (lines 33-46) — initialize `pack_buf: Vec::new()` (filled on first `snapshot_grid`).
- Every existing `pub fn` (lines 32-107): `new`, `feed`, `cursor`, `rows`, `cols`, `bell_pending`, `clear_bell`, `grid`, `dirty`, `clear_dirty`, `graphics_mode`, `alt_keypad`, `hold_screen`, `resize`, `resize_scrollback` — none of these signatures change (D-09: Phase 2 *extends*, does not replace).
- All `pub(crate) fn` dispatch methods (lines 111+) stay untouched.

**Existing accessor pattern to copy** (from current `terminal.rs:61-85`) — Phase 2's new getters follow the same `&self` / `&mut self` / `-> usize | u32 | bool | &[u8]` shape:
```rust
pub fn cursor(&self) -> (u32, u32) {
    (self.cursor_row, self.cursor_col)
}
pub fn rows(&self) -> u32 {
    self.scrollback.visible_rows() as u32
}
pub fn bell_pending(&self) -> bool {
    self.bell_pending
}
pub fn dirty(&self) -> &[u8] {
    self.dirty.as_slice()
}
pub fn clear_dirty(&mut self) {
    self.dirty.clear();
}
```

**Add (from RESEARCH Pattern 3, lines 389-417 of `02-RESEARCH.md`):**
```rust
/// Refresh the pack buffer. Row-major memcpy of every visible row from the
/// scrollback into a contiguous Vec<Cell>. Called by JS once per frame
/// before reading `grid_ptr()` / `grid_byte_len()`. Pairs with `clear_dirty()`
/// in the per-frame cadence (D-02).
pub fn snapshot_grid(&mut self) {
    let cols = self.scrollback.cols();
    let visible_rows = self.scrollback.visible_rows();
    let needed = visible_rows * cols;
    if self.pack_buf.len() != needed {
        self.pack_buf.resize(needed, Cell::BLANK);
    }
    for r in 0..visible_rows {
        let src = self.scrollback.row(r).as_slice();     // &[Cell]
        let dst_start = r * cols;
        self.pack_buf[dst_start..dst_start + cols].copy_from_slice(src);
    }
}

pub fn pack_ptr(&self) -> *const u8 {
    self.pack_buf.as_ptr() as *const u8
}

pub fn pack_byte_len(&self) -> usize {
    self.pack_buf.len() * std::mem::size_of::<Cell>()
}

pub fn dirty_ptr(&self) -> *const u8 {
    self.dirty.as_slice().as_ptr()
}
```

**Borrowing pattern** (from current `terminal.rs:51-59` for `feed`, same shape):
- Pack-buf path uses plain `&mut self` (no `&[u8]` arg), so RESEARCH Pitfall #3 (mut-borrow + slice-arg) does not apply. `snapshot_grid` is trivially safe.

**Scrollback accessor to iterate** (from `scrollback.rs:108-128`, already `pub`):
- `self.scrollback.row(visible_idx) -> &Row` — returns a visible-only row by 0..visible_rows index
- `Row::as_slice() -> &[Cell]` (from `grid.rs:79-81`)
- `Scrollback::visible_rows()` / `Scrollback::cols()` — for sizing the pack

**Cell layout constraint** (from `grid.rs:14-29`, **DO NOT MODIFY**):
```rust
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    pub ch: u32,
    pub fg: u8,
    pub bg: u8,
    pub flags: u8,
    pub _pad: u8,
}
// grid.rs:55-59 — compile-time assertions are load-bearing for zero-copy
const _: () = assert!(size_of::<Cell>() == 8, "Cell must be 8 bytes per D-09");
const _: () = assert!(align_of::<Cell>() == 4, "Cell must be 4-byte aligned per D-09");
```
Phase 2's `pack_byte_len` relies on `size_of::<Cell>() == 8`; the const asserts already enforce it.

**Test pattern to add (inline `#[cfg(test)] mod tests`)** — match existing `grid.rs:105-184` `#[cfg(test)]` style:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_grid_mirrors_scrollback() {
        let mut term = Terminal::new(3, 4, 10);
        term.feed(b"Hi");            // writes "Hi" into row 0 cols 0..1
        term.snapshot_grid();
        // Row 0 cells 0..2 are 'H','i'; row 1+2 are blanks.
        let cols = term.cols() as usize;
        // Direct byte-layout inspection: ch LSB at offset 0 of each 8-byte cell.
        let ptr = term.pack_ptr();
        let len = term.pack_byte_len();
        assert_eq!(len, 3 * 4 * 8);
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        assert_eq!(bytes[0], b'H');                 // row 0 col 0 ch LSB
        assert_eq!(bytes[8], b'i');                 // row 0 col 1
        assert_eq!(bytes[16], 0x20);                // row 0 col 2 (blank = space)
        assert_eq!(bytes[cols * 8], 0x20);          // row 1 col 0
    }

    #[test]
    fn cursor_packed_round_trip() {
        let mut term = Terminal::new(24, 80, 100);
        term.feed(b"\x1BY\x23\x45");  // cursor -> (3, 37)
        let (r, c) = term.cursor();
        let packed = (r << 16) | c;
        assert_eq!(packed >> 16, r);
        assert_eq!(packed & 0xFFFF, c);
        assert_eq!(r, 3); assert_eq!(c, 37);
    }
}
```
Note: `cursor_packed()` itself lives on the wasm façade (`lib.rs`), not on `Terminal`, per D-06/D-20. The test above verifies the *convention* inside `terminal.rs` so native cargo test covers it.

---

### `crates/bestialitty-core/src/key.rs` (unpack helpers)

**Analog:** same file — existing `encode(KeyEvent) -> Vec<u8>` pure function at `key.rs:88-`.

**Preserve** (from `key.rs:17-82`): `KeyCode` enum, `Modifiers` struct, `KeyEvent` struct, `Modifiers::NONE` / `Modifiers::CTRL` consts, `KeyEvent::new` / `KeyEvent::with_ctrl` constructors, and `encode(KeyEvent) -> Vec<u8>`.

**Add (RESEARCH Open Question 2 scheme — testable from native):**
```rust
/// Decode the (code, mods) u32 pair the JS side packs from DOM KeyboardEvent
/// into a `KeyEvent`. Packing scheme:
///   code low 8 bits: discriminant tag (see table)
///   code bits 8-15:  payload byte (for `Char(u8)` only)
///   code bits 16-31: reserved (must be zero for recognized codes)
///   mods bit 0: ctrl, bit 1: shift, bit 2: alt, bit 3: meta
///   mods bits 4-31: reserved.
///
/// Returns `None` on an unknown tag so `encode_key_raw` can return an empty
/// Vec rather than panic across the FFI (RESEARCH Pitfall #4).
pub fn unpack_keycode(code: u32) -> Option<KeyCode> {
    let tag = code & 0xFF;
    let payload = ((code >> 8) & 0xFF) as u8;
    match tag {
        0  => Some(KeyCode::Char(payload)),
        1  => Some(KeyCode::ArrowUp),
        2  => Some(KeyCode::ArrowDown),
        3  => Some(KeyCode::ArrowLeft),
        4  => Some(KeyCode::ArrowRight),
        5  => Some(KeyCode::Enter),
        6  => Some(KeyCode::Tab),
        7  => Some(KeyCode::Backspace),
        8  => Some(KeyCode::Escape),
        9  => Some(KeyCode::KeypadDigit(payload)),
        10 => Some(KeyCode::KeypadEnter),
        11 => Some(KeyCode::KeypadComma),
        12 => Some(KeyCode::KeypadMinus),
        13 => Some(KeyCode::KeypadDot),
        _  => None,
    }
}

pub fn unpack_mods(mods: u32) -> Modifiers {
    Modifiers {
        ctrl:  (mods & 0b0001) != 0,
        shift: (mods & 0b0010) != 0,
        alt:   (mods & 0b0100) != 0,
        meta:  (mods & 0b1000) != 0,
    }
}
```

**Why move these to `key.rs` and not `lib.rs`:** the CORE-02 source test still runs — `lib.rs` is exempted from `wasm_bindgen` only, not from hosting pure-Rust logic; but moving the unpackers to `key.rs` means they are covered by native `cargo test` without `#[cfg(target_arch = "wasm32")]` gymnastics (RESEARCH "Phase Requirements → Test Map" — `key::tests::unpack_known_codes`).

**Test pattern to add to existing `#[cfg(test)] mod tests` in key.rs** (style matching whatever already exists in this file — every module has one):
```rust
#[test]
fn unpack_keycode_tags_round_trip() {
    assert_eq!(unpack_keycode(0 | ((b'A' as u32) << 8)), Some(KeyCode::Char(b'A')));
    assert_eq!(unpack_keycode(1), Some(KeyCode::ArrowUp));
    assert_eq!(unpack_keycode(8), Some(KeyCode::Escape));
    assert_eq!(unpack_keycode(9 | (5 << 8)), Some(KeyCode::KeypadDigit(5)));
    assert_eq!(unpack_keycode(0xFF), None);   // unknown tag
}

#[test]
fn unpack_mods_bit_layout() {
    assert_eq!(unpack_mods(0).ctrl, false);
    assert_eq!(unpack_mods(0b0001), Modifiers::CTRL);
    let m = unpack_mods(0b1111);
    assert!(m.ctrl && m.shift && m.alt && m.meta);
}
```

---

### `crates/bestialitty-core/Cargo.toml` (manifest)

**Analog:** current `Cargo.toml` — the existing `[dependencies]` block is the structural template.

**Preserve (lines 1-16):** `[package]`, `[lib] crate-type = ["cdylib", "rlib"]`, `[features]` (incl. `trace-malformed`). The `crate-type` line is pinned by `tests/core_02_no_browser_deps.rs::cargo_toml_declares_cdylib_and_rlib` at line 150-168.

**Preserve `[dependencies] vte = "=0.15"`** — ADR-001 pins this. Phase 2 MUST NOT bump.

**Add (Candidate A — RESEARCH Mechanism Evaluation, RECOMMENDED):**
```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2.118"
```

This is the load-bearing pattern: `wasm-bindgen` appears ONLY for the `wasm32` target, so plain `cargo test` on x86_64 does not resolve or compile it. Pairs with `#[cfg(target_arch = "wasm32")]` on `lib.rs`'s `wasm_boundary` module.

**Do NOT add** `wasm-bindgen-futures`, `web-sys`, `js-sys`, any `gloo-*` (forbidden in CORE-02 test, D-07, D-08).

---

### `crates/bestialitty-core/tests/boundary_api_shape.rs` (extend signature pins)

**Analog:** same file. Every existing `#[test]` in lines 24-149 is a compile-time signature pin template — Phase 2 adds pins in the same style.

**Existing template pattern to copy** (from `boundary_api_shape.rs:32-45`):
```rust
#[test]
fn terminal_feed_accepts_byte_slice_returns_vec_u8() {
    let mut term = Terminal::new(24, 80, 100);
    let bytes: &[u8] = b"\x1BZ";
    let reply: Vec<u8> = term.feed(bytes);
    assert_eq!(reply, vec![0x1B, b'/', b'K'], "...");
}
```
— explicit type annotations (`let reply: Vec<u8>`) are the compile-time pin mechanism. Any drift fails this test's compilation.

**State-query template** (`boundary_api_shape.rs:47-60`):
```rust
#[test]
fn terminal_state_queries_have_stable_return_types() {
    let term = Terminal::new(24, 80, 100);
    let _cursor: (u32, u32) = term.cursor();
    let _rows: u32 = term.rows();
    let _cols: u32 = term.cols();
    let _bell: bool = term.bell_pending();
    let _dirty: &[u8] = term.dirty();
}
```

**Add (D-10 — one test per Phase 2 method, same style):**
```rust
#[test]
fn terminal_snapshot_and_pointer_methods_have_stable_return_types() {
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid();                            // &mut self, no args, no return
    let _ptr: *const u8 = term.pack_ptr();           // D-09
    let _len: usize = term.pack_byte_len();          // D-09
    let _dptr: *const u8 = term.dirty_ptr();         // D-09
    assert_eq!(_len, 24 * 80 * 8, "pack_byte_len = rows*cols*sizeof(Cell)");
}

#[test]
fn key_unpack_signatures_are_stable() {
    use bestialitty_core::key::{unpack_keycode, unpack_mods, KeyCode, Modifiers};
    let _kc: Option<KeyCode> = unpack_keycode(1u32);
    let _m:  Modifiers      = unpack_mods(0u32);
}

#[test]
fn grid_ptr_stable_across_feed() {
    // D-03: feed() must not invalidate the pack-buf pointer.
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid();
    let before = term.pack_ptr() as usize;
    term.feed(b"Hello");
    term.snapshot_grid();
    let after = term.pack_ptr() as usize;
    assert_eq!(before, after, "pack_buf pointer must be stable across feed() per D-03");
}

#[test]
fn feed_accepts_large_slice() {
    // SC-4: one feed() call must handle 64 KB without panic.
    let mut term = Terminal::new(24, 80, 100);
    let payload = vec![b'A'; 65_536];
    let _reply: Vec<u8> = term.feed(&payload);
}
```

**Note on `cursor_packed` / `encode_key_raw`:** those are `#[wasm_bindgen]`-only exports in `lib.rs` and therefore NOT reachable from this native integration test. The *convention* (`(row << 16) | col` + tag-low-byte u32 scheme) is pinned by native unit tests in `terminal.rs` and `key.rs` respectively (see above).

---

### `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` (surgical update)

**Analog:** same file. Current test body at lines 35-187.

**Preserve (critical):**
- The `FORBIDDEN_TOKENS`-style grep approach (line 55).
- The `walk_rs_files` helper (lines 172-186).
- The `cargo_toml_declares_cdylib_and_rlib` test (lines 149-168) — unchanged.
- The `"\"name\":\"<crate>\""` substring-match shape for metadata (line 89).

**Change 1: `FORBIDDEN_CRATES` (line 35-52)** — remove `"wasm-bindgen"` only; keep every other entry. RESEARCH §"Change to `dependency_graph_excludes_browser_crates`" shows the exact diff:
```rust
const FORBIDDEN_CRATES: &[&str] = &[
    "web-sys",
    "js-sys",
    // "wasm-bindgen" — REMOVED in Phase 2 per D-08. Allowed on wasm32 target only.
    "wasm-bindgen-futures",
    "gloo", "gloo-utils", "gloo-timers", "gloo-events", "gloo-net",
    "gloo-storage", "gloo-file", "gloo-worker", "gloo-history",
    "gloo-console", "gloo-dialogs", "gloo-render",
];
```
A5 assumption check (RESEARCH line 1129): before committing, run `cargo tree -p bestialitty-core --target wasm32-unknown-unknown` and confirm `wasm-bindgen-futures` does NOT appear. If it does, add to allowlist.

**Change 2: `FORBIDDEN_TOKENS` (line 55) → `FORBIDDEN_TOKENS_WITH_EXEMPTIONS`** — per-token, per-file exemption. RESEARCH §"Change to `source_files_contain_no_wasm_attrs`" is the canonical shape:
```rust
/// Forbidden tokens under `src/**/*.rs`. Tuple: (token, exempt-file-relative-paths).
/// Every file is subject to every token unless explicitly exempted for that token.
const FORBIDDEN_TOKENS_WITH_EXEMPTIONS: &[(&str, &[&str])] = &[
    ("wasm_bindgen", &["lib.rs"]),  // D-07: lib.rs is the ONE file allowed to use it
    ("web_sys", &[]),               // never allowed anywhere (lib.rs INCLUDED)
    ("js_sys", &[]),                // never allowed anywhere (lib.rs INCLUDED)
];
```

**Updated scan loop pattern** (preserves the existing comment-stripping from lines 126-130, extends with exemption lookup):
```rust
for path in &files {
    let file_rel = path.strip_prefix(&src_dir)
        .expect("under src_dir")
        .to_string_lossy().to_string();
    let contents = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
    for (lineno, raw_line) in contents.lines().enumerate() {
        let code_portion = match raw_line.find("//") {
            Some(idx) => &raw_line[..idx],
            None => raw_line,
        };
        for (token, exempt) in FORBIDDEN_TOKENS_WITH_EXEMPTIONS {
            if exempt.contains(&file_rel.as_str()) { continue; }
            assert!(
                !code_portion.contains(token),
                "CORE-02 breach: {}:{} contains `{}` as code. \
                 Phase 2: wasm_bindgen is permitted ONLY in lib.rs; \
                 web_sys / js_sys are forbidden EVERYWHERE (lib.rs included). \
                 Offending line: {}",
                path.display(), lineno + 1, token, raw_line.trim()
            );
        }
    }
}
```

**Do NOT** use `if path.ends_with("lib.rs") { continue; }` — that would regress D-07 by also exempting `web_sys` / `js_sys` in `lib.rs`.

---

### `rust-toolchain.toml` (add wasm32 target)

**Analog:** same file — 4 lines, the comment on line 4 explicitly flags Phase 2 as the adder.

**Current state:**
```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
# wasm32 target intentionally omitted; Phase 2 adds it.
```

**Change (one-line addition, replace the comment):**
```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
targets = ["wasm32-unknown-unknown"]
```
Contributors running `rustup show` / `cargo build` get the target auto-installed; no manual `rustup target add` needed.

---

### `scripts/build.sh` (CREATE — no in-repo analog)

**Analog:** none. First script in repo; no existing `scripts/` directory. Canonical shape from RESEARCH Pitfall #5 (line 923-934).

**Pattern to copy verbatim (with `#!/usr/bin/env bash` + `set -euo pipefail` + `cd "$(dirname "$0")/.."` idiom — standard build-script hygiene):**
```bash
#!/usr/bin/env bash
# scripts/build.sh — build the wasm core into www/pkg
set -euo pipefail
cd "$(dirname "$0")/.."        # repo root, regardless of where the script is invoked
wasm-pack build crates/bestialitty-core \
    --target web \
    --out-dir ../../www/pkg \
    --release
echo "Built www/pkg/ — serve with: python3 -m http.server -d www 8000"
```

**Critical invariants (RESEARCH Pitfall #5):**
- `--out-dir ../../www/pkg` is **relative to the crate's Cargo.toml directory**, not the cwd. From `crates/bestialitty-core/` that resolves to `<repo-root>/www/pkg`. ✓
- The `cd "$(dirname "$0")/.."` line makes the script idempotent under `bash scripts/build.sh` and `./scripts/build.sh`.
- `--release` is the default for `wasm-pack build`, listed explicitly for clarity. Add `--no-opt` if `wasm-opt` isn't on PATH (RESEARCH Pitfall #6).

**File permissions:** `chmod +x scripts/build.sh` after creation so `./scripts/build.sh` works without `bash` prefix.

---

### `www/index.html` (CREATE — no in-repo analog)

**Analog:** none. No HTML in the repo. Canonical shape from wasm-bindgen "without a bundler" guide + RESEARCH Pattern 1 (lines 302-319).

**Full file pattern to follow** (from RESEARCH Pattern 1, D-11, D-12 — minimum viable harness):
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BestialiTTY Harness</title>
  <!-- Dev serve: `python3 -m http.server -d www 8000` OR `basic-http-server www` (D-14) -->
  <style>
    body { font-family: monospace; }
    #grid, #dirty { border: 1px solid #888; padding: 4px; }
    #status { display: inline-block; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>BestialiTTY Phase 2 Harness</h1>
  <p>Paste bytes (or <code>\xNN</code> escapes for control bytes) then click Feed.</p>

  <textarea id="input" rows="4" cols="80"
            placeholder="Hello\x1BY\x21\x20World"></textarea>
  <br>
  <button id="feed">Feed</button>
  <button id="stress64k">64 KB Stress</button>

  <h3>Grid (ASCII, 80x24)</h3>
  <pre id="grid"></pre>

  <h3>Dirty bitmap (1 byte/row)</h3>
  <pre id="dirty"></pre>

  <span id="status">cursor=(0,0) bell=false</span>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

**Invariants:**
- `<script type="module">` — required for ES-module import + top-level await (Chromium ≥89).
- `<pre>` is the rendering target; `textContent` (never `innerHTML`) is the sink in `main.js` — RESEARCH §"Security Domain" DOM-XSS guard.
- Two buttons match D-11 item 2 (Feed) and item 4 (64 KB stress).
- `#dirty` element matches D-12 dirty-row bitmap readout.
- `#status` matches D-12 cursor + bell flag readout.
- **No `<script src="./pkg/bestialitty_core.js">` without `type="module"`** — `wasm-pack --target web` emits an ES module.

---

### `www/main.js` (CREATE — no in-repo analog)

**Analog:** none. Canonical shape is stitched from RESEARCH Patterns 1-3 (lines 302-415), the hex-escape parser §(lines 716-760), and the SC-4 stress handler §(lines 762-796).

**Skeleton pattern to follow (five sections, matching CONTEXT D-11 + D-12):**

**Section 1: init + view derivation (Pattern 1 + 2):**
```javascript
import init, { Terminal } from './pkg/bestialitty_core.js';

const wasm = await init();                             // top-level await, Chromium ≥89 (CLAUDE.md constraint)
const term = new Terminal(24, 80, 10_000);             // #[wasm_bindgen(constructor)] form

// One-time view derivation (D-03 contract).
term.snapshot_grid();
let gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
let dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());

// Defensive re-derive helper — call after term.resize() OR (see Pitfall #2)
// on every render tick as a cheap guard against ArrayBuffer detachment.
function reDeriveViews() {
    gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
    dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
}
```

**Section 2: ASCII grid renderer (Pattern 2, lines 360-373):**
```javascript
const CELL_SIZE = 8;   // matches grid.rs Cell #[repr(C)] size assertion
function renderAscii() {
    term.snapshot_grid();
    reDeriveViews();   // defensive; Pitfall #2 guard
    const rows = term.rows();
    const cols = term.cols();
    let out = '';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * CELL_SIZE;
            const ch = gridView[i];               // ch LSB at offset 0 (little-endian, verified by Cell::with_byte test in grid.rs:124)
            out += ch === 0 ? ' ' : String.fromCharCode(ch < 0x20 ? 0x20 : ch);
        }
        out += '\n';
    }
    document.getElementById('grid').textContent = out;          // textContent, NEVER innerHTML (XSS guard)
}

function renderDirty() {
    document.getElementById('dirty').textContent = Array.from(dirtyView).join('');
    term.clear_dirty();                                          // per-frame cadence
}

function renderStatus() {
    const packed = term.cursor_packed();
    const row = packed >>> 16;
    const col = packed & 0xFFFF;
    const bell = term.bell_pending();
    document.getElementById('status').textContent = `cursor=(${row},${col}) bell=${bell}`;
}

function refreshHarnessUI() { renderAscii(); renderDirty(); renderStatus(); }
```

**Section 3: hex-escape parser (RESEARCH §Hex-Escape, lines 722-757 — copy verbatim with no changes):**
```javascript
function parseHexEscapes(input) {
    const out = [];
    let i = 0;
    while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === 0x5C /* \ */ && i + 3 < input.length + 1
            && (input.charCodeAt(i+1) === 0x78 || input.charCodeAt(i+1) === 0x58)) {
            const hiVal = hexDigit(input.charCodeAt(i+2));
            const loVal = hexDigit(input.charCodeAt(i+3));
            if (hiVal !== null && loVal !== null) {
                out.push((hiVal << 4) | loVal);
                i += 4; continue;
            }
        }
        if (ch <= 0xFF) out.push(ch);
        i++;
    }
    return new Uint8Array(out);
}
function hexDigit(c) {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    return null;
}
```

**Section 4: Feed button handler (D-11 item 2 — ONE feed call per click):**
```javascript
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);                     // ONE boundary call, even if bytes.length > 1
    refreshHarnessUI();
});
```

**Section 5: 64 KB stress button (D-11 item 4 — SC-4 signal; RESEARCH lines 766-787 verbatim):**
```javascript
function buildStressPayload(total) {
    const buf = new Uint8Array(total);
    let w = 0;
    while (w < total) {
        // 256 bytes printable ASCII ramp
        for (let b = 0x20; b <= 0x7E && w < total; b++) buf[w++] = b;
        // 6 bytes ESC Y home-ish
        if (w + 4 < total) {
            buf[w++] = 0x1B; buf[w++] = 0x59;   // ESC Y
            buf[w++] = 0x20; buf[w++] = 0x20;   // row=0, col=0 (post-offset)
        }
    }
    return buf;
}

document.getElementById('stress64k').addEventListener('click', () => {
    const bytes = buildStressPayload(65536);
    console.time('Terminal.feed 64KB');
    const t0 = performance.now();
    term.feed(bytes);                                             // ONE call — SC-4
    const t1 = performance.now();
    console.timeEnd('Terminal.feed 64KB');
    console.log(`[SC-4] Fed ${bytes.length} bytes in ONE feed() call`);
    console.log(`[SC-4] Elapsed: ${(t1 - t0).toFixed(3)} ms`);
    console.log(`[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.`);
    refreshHarnessUI();
});

refreshHarnessUI();  // initial render (blank grid, all-dirty bitmap)
```

**Anti-patterns to avoid (from RESEARCH §Anti-Patterns, lines 531-539):**
- **NEVER** iterate the input and call `term.feed(new Uint8Array([b]))` per byte (Pitfall #1).
- **NEVER** cache `gridView` across `term.resize()` without re-deriving (Pitfall #2).
- **NEVER** use `new TextDecoder().decode(bytes)` on input — bytes are raw (Pitfall / Anti-Pattern).
- **NEVER** set `grid.innerHTML = out` — always `textContent` (XSS).

---

### `www/.gitignore` (CREATE)

**Analog:** repo-root `/home/ant/src/microbeast/bestialitty/.gitignore` — 3 lines.

**Repo-root current content (reference):**
```
/target/
**/*.rs.bk
.DS_Store
```

**`www/.gitignore` content (1 line):**
```
pkg/
```

**Rationale (D-13):** `www/pkg/` is regenerated on every `scripts/build.sh` invocation; tracked files in `www/` are `index.html`, `main.js`, and this `.gitignore` only.

---

### `.planning/decisions/ADR-002-wasm-gating.md` (CREATE — MAYBE, per RESEARCH recommendation line 618)

**Analog:** `.planning/decisions/ADR-001-parser-strategy.md` — same directory, same format, established project convention.

**Header pattern to copy from ADR-001 lines 1-6:**
```markdown
# ADR-002: Wasm-bindgen Target Gating

**Status:** Accepted
**Date:** 2026-04-21
**Phase:** 02-wasm-boundary-minimal-js-harness
**Deciders:** ant (project author)
```

**Section structure (copy from ADR-001 lines 7-):**
1. **Context** — reference RESEARCH §"Mechanism Evaluation" (lines 541-618); three candidates considered.
2. **Decision** — Candidate A: `[target.'cfg(target_arch = "wasm32")'.dependencies] wasm-bindgen = "0.2.118"` + `#[cfg(target_arch = "wasm32")] mod wasm_boundary` in `lib.rs`.
3. **Consequences** — Positive (plain `cargo test` works, native builds don't compile wasm-bindgen, CORE-02 test update is surgical), Negative (Cargo.toml table syntax slightly less discoverable than a plain dep; rust-analyzer may show `wasm-bindgen` symbols as unresolved when the host target is x86_64).
4. **Rejected alternatives:** Candidate B (plain dep, adds ~15 s to clean test build), Candidate C (feature flag, forces `--features wasm` ceremony in `scripts/build.sh` and a footgun where plain `cargo build --target wasm32` silently produces an empty lib.rs).

**When to create:** per CONTEXT line 253-255 — "not required if the choice is a clean one-liner." Three-candidate tradeoff is documented; recommend creating the ADR. 1-page brief, not a full Nygard.

---

## Shared Patterns

### Compile-time signature pinning (applies to: `lib.rs`, new methods)

**Source:** `crates/bestialitty-core/tests/boundary_api_shape.rs` (the entire file).
**Apply to:** Every new public method Phase 2 adds to `Terminal` (in `terminal.rs`) and to `key.rs`.

**Pattern (from `boundary_api_shape.rs:48-60`):** Use explicit type annotations in a `#[test]` body — the test's compilation is the pin. Runtime assertions are an additional smoke test on top.
```rust
let _ptr: *const u8 = term.pack_ptr();
let _len: usize = term.pack_byte_len();
```
If any method's signature drifts (e.g., `*const u8` → `*const Cell`, `usize` → `u32`), the test fails to compile. That is the intended failure mode.

### `#[repr(C)]` POD structs at the boundary (applies to: `pack_buf`)

**Source:** `crates/bestialitty-core/src/grid.rs:14-29` + const asserts at `grid.rs:55-59`.
**Apply to:** Phase 2's `pack_buf: Vec<Cell>` — the Cell layout IS the wire format. JS decodes 8-byte strides. Any layout change regresses the zero-copy contract.
```rust
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell { pub ch: u32, pub fg: u8, pub bg: u8, pub flags: u8, pub _pad: u8 }
const _: () = assert!(size_of::<Cell>() == 8, "Cell must be 8 bytes per D-09");
```
Phase 2 adds `pack_byte_len() -> usize` that multiplies `self.pack_buf.len() * std::mem::size_of::<Cell>()` — the `size_of::<Cell>() == 8` const assert is load-bearing.

### `Vec<u8>` returns for cold/rare output (applies to: `feed`, `encode_key_raw`)

**Source:** `crates/bestialitty-core/src/terminal.rs:51-59` (`feed`) and `src/key.rs:88+` (`encode`).
**Apply to:** `encode_key_raw(code, mods) -> Vec<u8>` wrapper in `lib.rs` — matches the established convention.

### `&mut self` / `&self` split for query vs mutator (applies to: every boundary method)

**Source:** `crates/bestialitty-core/src/terminal.rs:61-107` — queries are `&self`, mutators are `&mut self`.
**Apply to:** `snapshot_grid(&mut self)` (mutates `pack_buf`), `pack_ptr(&self)`, `pack_byte_len(&self)`, `dirty_ptr(&self)`, `cursor_packed(&self)`.

### `#[cfg(test)] mod tests` per-module test blocks (applies to: `terminal.rs`, `key.rs` additions)

**Source:** `crates/bestialitty-core/src/grid.rs:105-184`, `src/dirty.rs:62-135`, `src/scrollback.rs:134-`.
**Apply to:** Phase 2's new native tests (`snapshot_grid_mirrors_scrollback`, `cursor_packed_round_trip`, `unpack_keycode_tags_round_trip`, `unpack_mods_bit_layout`) — live inside the module they test, not in `tests/`.

### Comment style (applies to: new Rust code)

**Source:** every file under `crates/bestialitty-core/src/` uses `//!` module-level docs and `///` item docs with references to CONTEXT decisions (D-01..D-20) and PITFALLS numbers inline.
**Apply to:** New methods reference D-09 / D-10 / D-03 in their doc-comments; the existing style (see `grid.rs:5` "D-09 and is load-bearing for the Phase 2 wasm boundary") is the template.

### ADR format (applies to: `ADR-002-wasm-gating.md` if created)

**Source:** `.planning/decisions/ADR-001-parser-strategy.md` lines 1-60+.
**Apply to:** Same header (title, Status/Date/Phase/Deciders), Context / Decision / Consequences / Rejected-alternatives sections.

### `.gitignore` shape (applies to: `www/.gitignore`)

**Source:** repo-root `.gitignore` (3 lines, one rule per line, no glob gymnastics).
**Apply to:** `www/.gitignore` — single line `pkg/`.

---

## No Analog Found

Files with no close match in the repo — planner should use RESEARCH.md + cited external refs:

| File | Role | Data Flow | Substitute Reference |
|---|---|---|---|
| `scripts/build.sh` | build script | subprocess | RESEARCH Pitfall #5 (lines 923-934) — canonical wasm-pack invocation |
| `www/index.html` | static HTML | DOM | wasm-bindgen "without a bundler" guide (https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html) + RESEARCH Pattern 1 (lines 302-319) |
| `www/main.js` | JS browser shell | event-driven | RESEARCH Patterns 1-3 (lines 295-415) + §"Hex-Escape Textarea Parser" (lines 716-760) + §"64 KB Single-Feed Demonstration" (lines 762-806) |
| `www/.gitignore` | config | n/a | repo-root `.gitignore` (structural only — one line) |

**Reason for no analog:** Phase 1 shipped only Rust code; `www/` and `scripts/` directories do not exist yet. Phase 2 is the bootstrap of the JS shell and build-orchestration layers. The wasm-bindgen Guide + wasm-pack docs (cited in RESEARCH Primary Sources) are the authoritative templates for this first pass; subsequent phases will copy from these Phase-2 files as *their* analogs.

---

## Metadata

**Analog search scope:**
- `crates/bestialitty-core/src/**` — every module read (lib.rs, terminal.rs, grid.rs, dirty.rs, scrollback.rs, key.rs)
- `crates/bestialitty-core/tests/**` — boundary_api_shape.rs + core_02_no_browser_deps.rs read in full
- `crates/bestialitty-core/Cargo.toml`, repo-root `Cargo.toml`, `rust-toolchain.toml`, repo-root `.gitignore`
- `.planning/decisions/` — ADR-001 for ADR-format template
- Repo-wide `ls` for `scripts/` and `www/` — both confirmed absent

**Files scanned:** 15 Rust/config/ADR files + phase context + phase research.
**Pattern extraction date:** 2026-04-21
