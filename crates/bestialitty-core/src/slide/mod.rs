//! SLIDE protocol Rust core: byte-fed framer + CRC + sliding-window SM.
//!
//! Per the SLIDE v0.2 spec at `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md`
//! plus the v0.2.1 CAN-bidirectional amendment (see ADR-003, written in
//! Plan 07-05).
//!
//! - `crc` — CRC-16-CCITT primitive. `pub(crate)` per D-03; consumed by
//!   `framer` only. Hand-rolled (D-01) — no `crc` crate dependency.
//! - `framer` — byte-fed DFA that consumes SLIDE wire bytes and emits
//!   packed-u32 events (EVT_RDY, EVT_FIN, EVT_CAN, EVT_ACK, EVT_NAK,
//!   EVT_DATA_FRAME, EVT_CRC_ERROR). `pub` surface — Phase 8 wasm boundary.
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-20): NO `wasm_bindgen`,
//! NO `web_sys`, NO `js_sys`, NO `std::time`. Phase 8's `lib.rs:wasm_boundary`
//! adds the `Slide` `#[wasm_bindgen]` wrapper; Phase 7 ships the inner module
//! tree only. `tests/core_02_no_browser_deps.rs` enforces the wasm-free
//! invariant; Plan 07-05 may extend the FORBIDDEN_TOKENS table to also gate
//! `std::time` (RESEARCH §Open Questions #2).

pub mod crc;
pub mod framer;
pub mod state;

#[cfg(test)]
mod tests;

// `tests_only` is unconditionally `pub` because integration tests under
// `tests/slide_*.rs` compile against the lib in NON-test mode and so cannot
// see `#[cfg(test)]` modules. `#[doc(hidden)]` flags it as internal-use-only;
// Phase 8's `#[wasm_bindgen]` façade in `lib.rs` does not wrap anything from
// this module, so production wasm bundles do not surface it.
#[doc(hidden)]
pub mod tests_only;

// Top-level re-exports so callers can write `slide::Slide` instead of
// `slide::state::Slide`. Mirror of lib.rs top-level shape.
pub use state::{Slide, SlideRole, SlideState};
pub use framer::{
    EVT_NONE, EVT_RDY, EVT_ACK, EVT_NAK, EVT_FIN, EVT_CAN,
    EVT_DATA_FRAME, EVT_CRC_ERROR,
    EVT_FILE_COMPLETE, EVT_SESSION_COMPLETE, EVT_RETRANSMIT_NEEDED,
    build_frame_into,
};
