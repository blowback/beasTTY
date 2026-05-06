//! SLIDE protocol Rust core: byte-fed framer + CRC + sliding-window SM.
//!
//! Per the SLIDE v0.2 spec at `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md`
//! plus the v0.2.1 CAN-bidirectional amendment (see ADR-003, written in
//! Plan 07-05).
//!
//! - `crc` — CRC-16-CCITT primitive. `pub(crate)` per D-03; consumed by
//!   `framer` only. Hand-rolled (D-01) — no `crc` crate dependency.
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-20): NO `wasm_bindgen`,
//! NO `web_sys`, NO `js_sys`, NO `std::time`. Phase 8's `lib.rs:wasm_boundary`
//! adds the `Slide` `#[wasm_bindgen]` wrapper; Phase 7 ships the inner module
//! tree only. `tests/core_02_no_browser_deps.rs` enforces the wasm-free
//! invariant; Plan 07-05 may extend the FORBIDDEN_TOKENS table to also gate
//! `std::time` (RESEARCH §Open Questions #2).

pub mod crc;
