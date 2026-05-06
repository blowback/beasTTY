//! SLIDE byte-fed framer DFA.
//!
//! Mirrors the vte::Parser shape from Phase 1's vt52.rs: a state-enum-on-struct
//! design where each `step(byte)` is a pure function of (state, byte).
//! Torn-chunk safety (SLIDE-02) is a side-effect, NOT a special case.
//!
//! CRC scope: [SEQ, LEN_H, LEN_L, ...PAYLOAD] — NOT including SOF; NOT
//! including the CRC bytes themselves. Per slide-rs/protocol.rs:35-36, 170-173
//! and PITFALLS §3 (BLOCKING). Wire byte order: big-endian (CRC_H first)
//! per slide-rs/protocol.rs:41-42, 167-168.
//!
//! Visibility: this module's event/control constants, `FramerState`, and
//! `Framer` are `pub`. They form part of the Phase 8 wasm-boundary surface
//! that Phase 7 Plan 07-04's `tests/slide_boundary_shape.rs` pins. D-03's
//! `pub(crate)` scope applies ONLY to the CRC primitive in `slide/crc.rs`.
//!
//! Architectural rule: NO `wasm_bindgen`, NO `web_sys`, NO `js_sys`,
//! NO `std::time` (CLAUDE.md + CONTEXT D-20). Time logic lives in JS;
//! Rust SM is purely event-driven.

use super::crc::crc16_ccitt;

// ===== Wire control bytes (verbatim from slide-rs/protocol.rs) =====
pub const SOF:      u8 = 0x01;
pub const CTRL_FIN: u8 = 0x04;
pub const CTRL_ACK: u8 = 0x06;
pub const CTRL_RDY: u8 = 0x11;
pub const CTRL_NAK: u8 = 0x15;
pub const CTRL_CAN: u8 = 0x18;

// ===== Packed events: (kind << 16) | aux. Mirrors lib.rs:152-155 cursor_packed. =====
pub const EVT_NONE:       u32 = 0;
pub const EVT_RDY:        u32 = 1 << 16;
pub const EVT_ACK:        u32 = 2 << 16;  // aux = seq
pub const EVT_NAK:        u32 = 3 << 16;  // aux = seq
pub const EVT_FIN:        u32 = 4 << 16;
pub const EVT_CAN:        u32 = 5 << 16;
pub const EVT_DATA_FRAME: u32 = 6 << 16;  // aux = seq
pub const EVT_CRC_ERROR:  u32 = 7 << 16;  // aux = seq

/// Per-position framer state. Mirrors vt52.rs:39-47 EscYPhase shape.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FramerState {
    Idle,
    AfterAckOrNak(u8),                         // carry the original 0x06 or 0x15
    WaitingSeq,
    WaitingLenHi { seq: u8 },
    WaitingLenLo { seq: u8, len_hi: u8 },
    ReadingPayload { seq: u8, remaining: usize },
    WaitingCrcHi { seq: u8 },
    WaitingCrcLo { seq: u8, crc_hi: u8 },
}

/// Byte-fed SLIDE framer. Holds the per-position state and the rolling
/// CRC-input buffer + payload buffer. Pre-reserves 1027 bytes (FRAME_SIZE
/// 1024 + 3 SEQ/LEN bytes) at `new()` per Phase 1 D-17 stable-pointer
/// discipline.
pub struct Framer {
    state: FramerState,
    crc_input_buf: Vec<u8>,
    payload_buf: Vec<u8>,
}

const FRAME_SIZE: usize = 1024;
const CRC_INPUT_RESERVE: usize = FRAME_SIZE + 3;  // SEQ + LEN_H + LEN_L + payload

impl Framer {
    pub fn new() -> Self {
        Self {
            state: FramerState::Idle,
            crc_input_buf: Vec::with_capacity(CRC_INPUT_RESERVE),
            payload_buf: Vec::with_capacity(FRAME_SIZE),
        }
    }

    pub fn state(&self) -> FramerState {
        self.state
    }

    /// Drain the most recently completed payload. Caller takes ownership;
    /// the framer's payload_buf retains capacity (Vec::clear preserves capacity).
    pub fn take_payload(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.payload_buf)
    }

    /// Single-byte step. Returns a packed event word per RESEARCH §Pattern 3.
    pub fn step(&mut self, b: u8) -> u32 {
        match self.state {
            FramerState::Idle => match b {
                SOF => {
                    self.state = FramerState::WaitingSeq;
                    // Reset rolling CRC scope buf at frame start.
                    self.crc_input_buf.clear();
                    self.payload_buf.clear();
                    EVT_NONE
                }
                CTRL_RDY => EVT_RDY,
                CTRL_FIN => EVT_FIN,
                CTRL_CAN => EVT_CAN,
                CTRL_ACK => {
                    self.state = FramerState::AfterAckOrNak(CTRL_ACK);
                    EVT_NONE
                }
                CTRL_NAK => {
                    self.state = FramerState::AfterAckOrNak(CTRL_NAK);
                    EVT_NONE
                }
                // Phase 1 D-15: silent discard on malformed bytes.
                _ => EVT_NONE,
            },

            FramerState::AfterAckOrNak(ctrl) => {
                // The next byte is the seq number for ACK/NAK.
                self.state = FramerState::Idle;
                match ctrl {
                    CTRL_ACK => EVT_ACK | (b as u32),
                    CTRL_NAK => EVT_NAK | (b as u32),
                    _ => EVT_NONE,  // unreachable in practice
                }
            }

            FramerState::WaitingSeq => {
                // Push SEQ as the first byte of CRC scope.
                self.crc_input_buf.push(b);
                self.state = FramerState::WaitingLenHi { seq: b };
                EVT_NONE
            }

            FramerState::WaitingLenHi { seq } => {
                self.crc_input_buf.push(b);
                self.state = FramerState::WaitingLenLo { seq, len_hi: b };
                EVT_NONE
            }

            FramerState::WaitingLenLo { seq, len_hi } => {
                self.crc_input_buf.push(b);
                let len = ((len_hi as usize) << 8) | (b as usize);
                if len == 0 {
                    // Zero-payload frame (e.g. EOF marker, empty header)
                    // skip ReadingPayload entirely.
                    self.state = FramerState::WaitingCrcHi { seq };
                } else {
                    self.state = FramerState::ReadingPayload { seq, remaining: len };
                }
                EVT_NONE
            }

            FramerState::ReadingPayload { seq, remaining } => {
                self.crc_input_buf.push(b);
                self.payload_buf.push(b);
                if remaining == 1 {
                    self.state = FramerState::WaitingCrcHi { seq };
                } else {
                    self.state = FramerState::ReadingPayload { seq, remaining: remaining - 1 };
                }
                EVT_NONE
            }

            FramerState::WaitingCrcHi { seq } => {
                // CRC bytes are NOT pushed into crc_input_buf — scope ends at payload.
                self.state = FramerState::WaitingCrcLo { seq, crc_hi: b };
                EVT_NONE
            }

            FramerState::WaitingCrcLo { seq, crc_hi } => {
                let received_crc = ((crc_hi as u16) << 8) | (b as u16);
                let expected_crc = crc16_ccitt(&self.crc_input_buf);
                self.state = FramerState::Idle;
                self.crc_input_buf.clear();
                if received_crc == expected_crc {
                    EVT_DATA_FRAME | (seq as u32)
                } else {
                    // CRC mismatch: payload is invalid; clear payload_buf.
                    self.payload_buf.clear();
                    EVT_CRC_ERROR | (seq as u32)
                }
            }
        }
    }
}

impl Default for Framer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f() -> Framer { Framer::new() }

    #[test]
    fn idle_sof_advances_to_waiting_seq() {
        let mut fr = f();
        assert_eq!(fr.step(SOF), EVT_NONE);
        assert!(matches!(fr.state(), FramerState::WaitingSeq));
    }

    #[test]
    fn idle_rdy_emits_evt_rdy_stays_idle() {
        let mut fr = f();
        assert_eq!(fr.step(CTRL_RDY), EVT_RDY);
        assert!(matches!(fr.state(), FramerState::Idle));
    }

    #[test]
    fn idle_fin_emits_evt_fin_stays_idle() {
        let mut fr = f();
        assert_eq!(fr.step(CTRL_FIN), EVT_FIN);
        assert!(matches!(fr.state(), FramerState::Idle));
    }

    #[test]
    fn idle_can_emits_evt_can_stays_idle() {
        let mut fr = f();
        assert_eq!(fr.step(CTRL_CAN), EVT_CAN);
        assert!(matches!(fr.state(), FramerState::Idle));
    }

    #[test]
    fn idle_garbage_silently_discarded() {
        let mut fr = f();
        for b in [0x00u8, 0x42, 0x7F, 0xAA, 0xFF] {
            assert_eq!(fr.step(b), EVT_NONE);
            assert!(matches!(fr.state(), FramerState::Idle));
        }
    }

    #[test]
    fn ack_seq_emits_evt_ack_with_seq_aux() {
        let mut fr = f();
        assert_eq!(fr.step(CTRL_ACK), EVT_NONE);
        assert_eq!(fr.step(0x03), EVT_ACK | 0x03);
        assert!(matches!(fr.state(), FramerState::Idle));
    }

    #[test]
    fn nak_seq_emits_evt_nak_with_seq_aux() {
        let mut fr = f();
        assert_eq!(fr.step(CTRL_NAK), EVT_NONE);
        assert_eq!(fr.step(0x05), EVT_NAK | 0x05);
        assert!(matches!(fr.state(), FramerState::Idle));
    }

    #[test]
    fn full_frame_subframe_hi_emits_evt_data_frame() {
        // FIXTURE_SUBFRAME_HI from RESEARCH §Test Corpus Fixture 2
        let frame: &[u8] = &[
            0x01,                       // SOF
            0x01,                       // SEQ
            0x00, 0x02,                 // LEN = 2
            b'H', b'i',                 // payload
            0xAC, 0xD7,                 // CRC
        ];
        let mut fr = f();
        for &b in &frame[..frame.len() - 1] {
            assert_eq!(fr.step(b), EVT_NONE);
        }
        let final_evt = fr.step(*frame.last().unwrap());
        assert_eq!(final_evt, EVT_DATA_FRAME | 0x01);
        assert_eq!(fr.take_payload(), vec![b'H', b'i']);
    }

    #[test]
    fn zero_length_payload_skips_directly_to_crc() {
        // FIXTURE_EMPTY_SEQ_0 from RESEARCH §Test Corpus Fixture 3
        let frame: &[u8] = &[
            0x01,                       // SOF
            0x00,                       // SEQ
            0x00, 0x00,                 // LEN = 0
            0xCC, 0x9C,                 // CRC
        ];
        let mut fr = f();
        for &b in &frame[..frame.len() - 1] {
            assert_eq!(fr.step(b), EVT_NONE);
        }
        assert_eq!(fr.step(*frame.last().unwrap()), EVT_DATA_FRAME | 0x00);
        assert_eq!(fr.take_payload(), Vec::<u8>::new());
    }

    #[test]
    fn crc_scope_excludes_sof() {
        // PITFALLS §3 BLOCKING: CRC scope is [SEQ, LEN_H, LEN_L, ...PAYLOAD]
        // — NOT including SOF. If implementation includes SOF, the
        // crc_with_sof value would equal the framer's expected_crc; that
        // would make FIXTURE_SLIDE_RS_HELLO (correct CRC 0xF9E3) emit
        // EVT_CRC_ERROR. Instead, feeding the correct CRC must emit
        // EVT_DATA_FRAME, AND the without-SOF computation must match.
        let crc_with_sof    = crc16_ccitt(&[0x01, 0x05, 0x00, 0x05, b'h', b'e', b'l', b'l', b'o']);
        let crc_without_sof = crc16_ccitt(&[0x05, 0x00, 0x05, b'h', b'e', b'l', b'l', b'o']);
        assert_ne!(crc_with_sof, crc_without_sof,
            "test invariant: with-SOF and without-SOF CRCs must differ");
        assert_eq!(crc_without_sof, 0xF9E3,
            "without-SOF CRC must match FIXTURE_SLIDE_RS_HELLO's CRC");
    }

    #[test]
    fn crc_wire_order_big_endian() {
        // Wire byte order MUST be big-endian (CRC_H first). Feeding
        // FIXTURE_SLIDE_RS_HELLO with CRC bytes swapped to [0xE3, 0xF9]
        // (little-endian) emits EVT_CRC_ERROR.
        let frame_le_crc: &[u8] = &[
            0x01, 0x05, 0x00, 0x05,
            b'h', b'e', b'l', b'l', b'o',
            0xE3, 0xF9,                 // CRC swapped: LE instead of BE
        ];
        let mut fr = f();
        for &b in &frame_le_crc[..frame_le_crc.len() - 1] {
            fr.step(b);
        }
        let final_evt = fr.step(*frame_le_crc.last().unwrap());
        assert_eq!(final_evt, EVT_CRC_ERROR | 0x05);
    }

    #[test]
    fn crc_payload_bit_flip_detected() {
        // PITFALLS §3 under-scope contract: payload bytes MUST be in CRC
        // scope. Flipping payload[2] from 'l' to 'L' must produce EVT_CRC_ERROR.
        let frame_flipped: &[u8] = &[
            0x01, 0x05, 0x00, 0x05,
            b'h', b'e', b'L', b'l', b'o',  // 'L' uppercase (was 'l')
            0xF9, 0xE3,                     // CRC for the original (lowercase 'l')
        ];
        let mut fr = f();
        for &b in &frame_flipped[..frame_flipped.len() - 1] {
            fr.step(b);
        }
        let final_evt = fr.step(*frame_flipped.last().unwrap());
        assert_eq!(final_evt, EVT_CRC_ERROR | 0x05);
    }
}
