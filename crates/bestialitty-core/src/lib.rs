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
