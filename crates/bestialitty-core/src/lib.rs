//! bestialitty-core: pure-Rust VT52 terminal logic with a wasm-bindgen boundary.
//!
//! Module-level structure:
//! - `dirty`, `grid`, `key`, `scrollback`, `terminal`, `vt52` — pure Rust,
//!   wasm-free (D-20). Exercised by native `cargo test` as an rlib.
//! - `wasm_boundary` — `#[cfg(target_arch = "wasm32")]`-gated thin façade
//!   wrapping `crate::terminal::Terminal` and `crate::key` with
//!   `#[wasm_bindgen]` attributes. Consumed by JS via
//!   `wasm-pack build --target web` (ADR-002, Phase 2 Plan 01).
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-06 / D-20): `wasm_bindgen`
//! attributes live in THIS FILE ONLY. `web_sys` / `js_sys` / `gloo-*` are
//! forbidden everywhere (lib.rs included). `tests/core_02_no_browser_deps.rs`
//! enforces both rules via per-token, per-file exemption.

pub mod dirty;
pub mod grid;
pub mod key;
pub mod scrollback;
pub mod terminal;
pub mod vt52;

// ==== wasm boundary (wasm32 only) ====
//
// Entire façade is `#[cfg(target_arch = "wasm32")]`-gated per ADR-002
// (Candidate A: target-specific dep + module-level cfg). Native `cargo
// test` compiles this file down to just the `pub mod` tree above — no
// wasm-bindgen resolution, no proc-macro expansion, no compile cost.
//
// Every method in the façade is a one-line forward to an already-tested
// Phase 1 / Plan 02 method on the inner `crate::terminal::Terminal` or
// `crate::key::*`. No logic lives here — façade only.
#[cfg(target_arch = "wasm32")]
mod wasm_boundary {
    use wasm_bindgen::prelude::*;

    use crate::key::{self, KeyEvent, unpack_keycode, unpack_mods};
    use crate::terminal::Terminal as CoreTerminal;

    /// Wasm-exported VT52 terminal. Thin façade over `crate::terminal::Terminal`.
    ///
    /// JS-side shape (from `www/main.js`):
    ///
    /// ```js
    /// import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js';
    /// const wasm = await init();
    /// const term = new Terminal(24, 80, 10_000);
    /// term.feed(bytes);                                          // one boundary call
    /// term.snapshot_grid();                                       // refresh pack_buf
    /// const grid = new Uint8Array(wasm.memory.buffer,
    ///                             term.grid_ptr(), term.grid_byte_len());
    /// ```
    #[wasm_bindgen]
    pub struct Terminal {
        inner: CoreTerminal,
    }

    #[wasm_bindgen]
    impl Terminal {
        /// JS `new Terminal(rows, cols, scrollback_cap)` constructor.
        #[wasm_bindgen(constructor)]
        pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Terminal {
            Terminal {
                inner: CoreTerminal::new(rows, cols, scrollback_cap),
            }
        }

        /// Feed a byte chunk through the VT52 parser. ONE boundary call per
        /// chunk — never per-byte (RESEARCH Pitfall #4, SC-4).
        pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8> {
            self.inner.feed(bytes)
        }

        /// Refresh the pack buffer. Call once per frame before reading
        /// `grid_ptr()` / `grid_byte_len()` (D-02).
        pub fn snapshot_grid(&mut self) {
            self.inner.snapshot_grid();
        }

        /// Pointer into the pack buffer — stable across `feed()` /
        /// `push_line` / `resize_scrollback` (D-03). Invalidated by
        /// `resize()` — JS must re-derive `Uint8Array` after.
        pub fn grid_ptr(&self) -> *const u8 {
            self.inner.pack_ptr()
        }

        /// Byte length of the pack buffer: `visible_rows * cols * 8`.
        pub fn grid_byte_len(&self) -> usize {
            self.inner.pack_byte_len()
        }

        /// Pointer into the dirty-row bitmap (1 byte per row; 1 = dirty).
        pub fn dirty_ptr(&self) -> *const u8 {
            self.inner.dirty_ptr()
        }

        pub fn rows(&self) -> u32 {
            self.inner.rows()
        }

        pub fn cols(&self) -> u32 {
            self.inner.cols()
        }

        pub fn clear_dirty(&mut self) {
            self.inner.clear_dirty();
        }

        pub fn bell_pending(&self) -> bool {
            self.inner.bell_pending()
        }

        pub fn clear_bell(&mut self) {
            self.inner.clear_bell();
        }

        /// Packed cursor: `(row << 16) | col`. JS decodes with
        /// `row = packed >>> 16; col = packed & 0xFFFF;`.
        /// Pinned by `terminal::tests::cursor_packed_convention_round_trips`.
        pub fn cursor_packed(&self) -> u32 {
            let (r, c) = self.inner.cursor();
            (r << 16) | c
        }

        pub fn resize(&mut self, rows: u32, cols: u32) {
            self.inner.resize(rows, cols);
        }

        pub fn resize_scrollback(&mut self, new_cap: usize) {
            self.inner.resize_scrollback(new_cap);
        }
    }

    /// Encode a packed (code, mods) u32 pair into the VT52 byte sequence.
    ///
    /// On unknown tag, returns an empty `Vec<u8>` rather than panicking
    /// across the wasm FFI boundary (RESEARCH Pitfall #4). The packing
    /// scheme is pinned by `key::tests::unpack_keycode_*`.
    #[wasm_bindgen]
    pub fn encode_key_raw(code: u32, mods: u32) -> Vec<u8> {
        match unpack_keycode(code) {
            Some(kc) => key::encode(KeyEvent {
                code: kc,
                mods: unpack_mods(mods),
            }),
            None => Vec::new(),
        }
    }
}
