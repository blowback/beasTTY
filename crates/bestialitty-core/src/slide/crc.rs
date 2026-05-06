//! CRC-16-CCITT primitive for the SLIDE framer.
//!
//! VERBATIM copy of /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30
//! per CONTEXT D-01. Byte-for-byte cross-validation against slide-rs is the
//! wire-correctness gate (D-04(b)); do not "improve" this implementation
//! without re-pinning the slide-rs fixture frames in Plan 07-02's
//! `tests/slide_reference_corpus.rs`.
//!
//! Variant: CRC-16/IBM-3740 (a.k.a. CCITT-FALSE).
//! - polynomial: 0x1021
//! - init:       0xFFFF
//! - refin:      false
//! - refout:     false
//! - xorout:     0x0000
//! - reference vector: crc16_ccitt(b"123456789") == 0x29B1 (Greg Cook
//!   catalogue, https://reveng.sourceforge.io/crc-catalogue/all.htm)

/// CRC-16-CCITT (polynomial 0x1021, init 0xFFFF).
///
/// Per CONTEXT D-02: one-shot API only. The framer assembles the CRC scope
/// (`SEQ + LEN_H + LEN_L + PAYLOAD` — NOT including SOF, NOT including the
/// CRC bytes themselves) into a single contiguous slice before calling.
///
/// Per CONTEXT D-03: `pub(crate)` — framer-only consumer. Integration tests
/// reach this via the `slide/tests_only.rs` `#[cfg(test)] pub use` re-export
/// shim that Plan 07-02 will add.
//
// `#[allow(dead_code)]` is a Phase 7 Plan 01 -> 07-02 transient: this
// plan ships only the CRC primitive; the framer that calls it lands in
// Plan 07-02. Remove the allow when 07-02's framer wires up the call site.
#[allow(dead_code)]
pub(crate) fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
            crc &= 0xFFFF;
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;

    // D-04(a): NON-NEGOTIABLE. Greg Cook CRC catalogue / SLIDE v0.2 spec
    // reference vector. This single assertion pins the variant choice.
    // Distinguishes CCITT-FALSE (this) from XMODEM, CCITT-AUG, KERMIT —
    // each of those would silently pass cross-validation against frames
    // they themselves built but fail this catalogue pin.
    #[test]
    fn reference_vector_123456789() {
        assert_eq!(crc16_ccitt(b"123456789"), 0x29B1);
    }

    #[test]
    fn empty_input_yields_init_value() {
        // Empty input means the inner loop never runs; register stays at
        // its 0xFFFF initial value. Pins the init constant against a
        // future refactor that swaps it.
        assert_eq!(crc16_ccitt(&[]), 0xFFFF);
    }

    #[test]
    fn single_zero_byte_changes_crc() {
        // Smoke check: the algorithm actually mutates the register. A
        // stub `fn crc16_ccitt(_) -> u16 { 0xFFFF }` would pass the empty
        // case but fail this one.
        assert_ne!(crc16_ccitt(&[0x00]), 0xFFFF);
    }
}
