//! bestialitty-core: pure-Rust VT52 terminal logic.
//!
//! No browser deps. Logic lives in sub-modules; this file is a thin boundary
//! that Phase 2 will populate with `wasm-bindgen` exports. In Phase 1 it
//! declares the module tree and nothing else.
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-20): logic modules are wasm-free.
//! Any `wasm_bindgen` / `web_sys` / `js_sys` attrs stay confined to this file,
//! added in Phase 2 — not here.

pub mod terminal;
pub mod grid;
pub mod scrollback;
pub mod dirty;
pub mod vt52;
pub mod key;

// Parser-strategy spike (Plan 01-03). Gated behind the `spike` Cargo feature
// so the module + its optional `vte` dep stay out of every default and test
// build. Spike tests are invoked specifically via
// `cargo test --features spike spike::tests` — using `cfg(test)` alone here
// would pull the `vte` use into ordinary `cargo test --lib` runs and break
// them when the feature is off. See CONTEXT D-02/D-03 and ADR-001 (written
// in Plan 01-03 Task 2).
#[cfg(feature = "spike")]
pub mod spike;
