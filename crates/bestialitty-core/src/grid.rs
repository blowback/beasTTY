//! 80x24 cell grid. `#[repr(C)]` Cell layout for zero-copy JS views in Phase 2.
//! See CONTEXT D-09 for the exact Cell shape: `{ ch: u32, fg: u8, bg: u8,
//! flags: u8, _pad: u8 }` — 8 bytes, naturally aligned.
//!
//! Plan 01 stub. Real implementation lands in Plan 04.
