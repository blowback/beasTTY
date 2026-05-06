//! Test-only re-exports for integration tests under `tests/slide_*.rs`.
//!
//! Two purposes:
//!
//! 1. **CRC visibility widening (D-03):** `slide/crc.rs::crc16_ccitt` is
//!    `pub(crate)` per CONTEXT D-03 (framer-only consumer; no public surface).
//!    Integration tests compile against the EXTERNAL crate surface and so
//!    cannot see `pub(crate)` items. The `pub use` below is the *only*
//!    widening of CRC visibility — `slide::crc::crc16_ccitt` itself stays
//!    `pub(crate)`; only the re-export here is `pub`.
//!
//! 2. **Fixture co-location:** the 7 reference fixtures + framer surface
//!    re-exports live here so `tests/slide_*.rs` can write a single
//!    `use bestialitty_core::slide::tests_only::*;`.
//!
//! ## Visibility note (deviation from plan-as-written)
//!
//! The plan specified `#![cfg(test)]` on this module so it would be visible
//! only in the test build. That gate works for *unit* tests (the lib is
//! compiled with `cfg(test)`) but NOT for *integration* tests under
//! `tests/`, which compile against the lib in non-test mode and thus do not
//! see `cfg(test)` modules. Without a Cargo feature flag (which would
//! require dev-dependency plumbing), the module must be unconditionally
//! `pub` to be reachable from integration tests.
//!
//! Mitigation: `#[doc(hidden)]` marks the module as not-for-public-use;
//! Phase 8's `#[wasm_bindgen]` façade in `lib.rs` wraps only specific items
//! and never touches `slide::tests_only`, so production wasm bundles do not
//! re-export anything from this module.
//!
//! Compare boundary_api_shape.rs:1-19 — same in-crate-vs-integration
//! distinction motivates this shim.

/// Test-only wrapper widening `slide::crc::crc16_ccitt`'s `pub(crate)`
/// visibility to `pub` for integration tests under `tests/slide_*.rs`.
/// Production code MUST NOT call this — call `crate::slide::crc::crc16_ccitt`
/// directly inside the framer (the only sanctioned consumer per D-03).
///
/// A `pub use` of a `pub(crate)` item won't compile (E0364 — "only public
/// within the crate, and cannot be re-exported outside"); this wrapper fn
/// is the conventional workaround.
#[doc(hidden)]
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    crate::slide::crc::crc16_ccitt(data)
}
pub use crate::slide::framer::{
    SOF, CTRL_FIN, CTRL_ACK, CTRL_RDY, CTRL_NAK, CTRL_CAN,
    EVT_NONE, EVT_RDY, EVT_ACK, EVT_NAK, EVT_FIN, EVT_CAN,
    EVT_DATA_FRAME, EVT_CRC_ERROR,
    FramerState, Framer,
};

pub use crate::slide::state::{Slide, SlideRole, SlideState};

// ===== D-04(b) reference corpus: 7 fixtures pasted from RESEARCH §Test Corpus =====
// Each fixture's CRC was independently re-computed against slide-py/common.py
// (line-for-line equivalent to slide-rs/protocol.rs:16-30 algorithmically).

/// FIXTURE_HEADER_TEST_TXT — header frame "TEST.TXT", size=42, seq=0
pub const FIXTURE_HEADER_TEST_TXT: &[u8] = &[
    0x01,                                                 // SOF
    0x00,                                                 // SEQ = 0
    0x00, 0x0D,                                           // LEN = 13
    b'T', b'E', b'S', b'T', b'.', b'T', b'X', b'T',
    0x00,                                                 // null terminator
    0x2A, 0x00, 0x00, 0x00,                               // size = 42 (LE u32)
    0xFF, 0x4E,                                           // CRC
];

/// FIXTURE_SUBFRAME_HI — sub-frame data "Hi", seq=1
pub const FIXTURE_SUBFRAME_HI: &[u8] = &[
    0x01, 0x01, 0x00, 0x02, b'H', b'i', 0xAC, 0xD7,
];

/// FIXTURE_EMPTY_SEQ_0 — empty payload, seq=0
pub const FIXTURE_EMPTY_SEQ_0: &[u8] = &[
    0x01, 0x00, 0x00, 0x00, 0xCC, 0x9C,
];

/// FIXTURE_EOF_SEQ_4 — zero-payload, seq=4 (EOF semantics)
pub const FIXTURE_EOF_SEQ_4: &[u8] = &[
    0x01, 0x04, 0x00, 0x00, 0x10, 0x5C,
];

/// FIXTURE_ALL_FF_16 — all-FF payload, 16 bytes, seq=0xFF
pub const FIXTURE_ALL_FF_16: &[u8] = &[
    0x01, 0xFF, 0x00, 0x10,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x04, 0x5A,
];

/// FIXTURE_SLIDE_RS_HELLO — slide-rs's own test vector: build_frame(0x05, b"hello")
/// Cited from /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:231-243
pub const FIXTURE_SLIDE_RS_HELLO: &[u8] = &[
    0x01, 0x05, 0x00, 0x05,
    b'h', b'e', b'l', b'l', b'o',
    0xF9, 0xE3,
];

/// FIXTURE_MAX_PAYLOAD_AA — max payload, 1024 bytes of 0xAA, seq=1.
/// Constructor function rather than const because of size.
pub fn fixture_max_payload_aa() -> Vec<u8> {
    let mut frame = Vec::with_capacity(1030);
    frame.push(0x01);                           // SOF
    frame.push(0x01);                           // SEQ
    frame.push(0x04);                           // LEN_H = 0x04 (1024 = 0x0400)
    frame.push(0x00);                           // LEN_L = 0x00
    frame.extend(std::iter::repeat(0xAA).take(1024));
    frame.push(0xED);                           // CRC_H
    frame.push(0x8D);                           // CRC_L
    frame
}

// ===== Control-byte fixtures =====
pub const CTRL_RDY_BYTE: &[u8] = &[0x11];
pub const CTRL_FIN_BYTE: &[u8] = &[0x04];
pub const CTRL_CAN_BYTE: &[u8] = &[0x18];
pub const CTRL_ACK_SEQ_3: &[u8] = &[0x06, 0x03];
pub const CTRL_NAK_SEQ_5: &[u8] = &[0x15, 0x05];
