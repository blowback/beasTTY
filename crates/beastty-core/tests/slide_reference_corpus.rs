//! SLIDE reference corpus: 7 fixtures + CRC scope/byte-order regression pins.
//!
//! Mirrors Phase 2's `tests/boundary_api_shape.rs` pattern: every #[test] is
//! a per-property assertion against a fixed-byte fixture. Byte-for-byte
//! equality with slide-rs is the wire-correctness gate (CONTEXT D-04).
//!
//! Hand-pasted offline; no build-time tooling dep on slide-rs (D-04 explicit).

use beastty_core::slide::tests_only::*;

/// D-04(a) catalogue pin from the integration-test boundary. Re-asserted here
/// (also tested in slide::crc::tests::reference_vector_123456789) — having it
/// at both levels protects against accidental visibility changes.
#[test]
fn reference_vector_123456789() {
    assert_eq!(crc16_ccitt(b"123456789"), 0x29B1);
}

fn assert_fixture_emits_data_frame(frame: &[u8], expected_seq: u8) {
    let mut framer = Framer::new();
    let mut last_evt = EVT_NONE;
    for &b in frame {
        let evt = framer.step(b);
        if evt != EVT_NONE {
            last_evt = evt;
        }
    }
    assert_eq!(last_evt, EVT_DATA_FRAME | (expected_seq as u32),
        "fixture did not emit expected EVT_DATA_FRAME with seq={:#X}", expected_seq);
}

#[test]
fn fixture_header_test_txt_round_trips() {
    assert_fixture_emits_data_frame(FIXTURE_HEADER_TEST_TXT, 0x00);
}

#[test]
fn fixture_subframe_hi_round_trips() {
    assert_fixture_emits_data_frame(FIXTURE_SUBFRAME_HI, 0x01);
}

#[test]
fn fixture_empty_seq_0_round_trips() {
    assert_fixture_emits_data_frame(FIXTURE_EMPTY_SEQ_0, 0x00);
}

#[test]
fn fixture_eof_seq_4_round_trips() {
    assert_fixture_emits_data_frame(FIXTURE_EOF_SEQ_4, 0x04);
}

#[test]
fn fixture_all_ff_16_round_trips() {
    assert_fixture_emits_data_frame(FIXTURE_ALL_FF_16, 0xFF);
}

#[test]
fn fixture_slide_rs_hello_round_trips() {
    assert_fixture_emits_data_frame(FIXTURE_SLIDE_RS_HELLO, 0x05);
}

#[test]
fn fixture_max_payload_aa_round_trips() {
    let frame = fixture_max_payload_aa();
    assert_fixture_emits_data_frame(&frame, 0x01);
}

#[test]
fn fixture_slide_rs_hello_payload_decodes_to_hello() {
    let mut framer = Framer::new();
    for &b in FIXTURE_SLIDE_RS_HELLO {
        framer.step(b);
    }
    assert_eq!(framer.take_payload(), b"hello".to_vec());
}

#[test]
fn crc_scope_pins_with_vs_without_sof() {
    // PITFALLS §3 BLOCKING: with-SOF and without-SOF CRCs must differ;
    // without-SOF must match FIXTURE_SLIDE_RS_HELLO's wire CRC (0xF9E3).
    let crc_with_sof    = crc16_ccitt(&[0x01, 0x05, 0x00, 0x05, b'h', b'e', b'l', b'l', b'o']);
    let crc_without_sof = crc16_ccitt(&[0x05, 0x00, 0x05, b'h', b'e', b'l', b'l', b'o']);
    assert_ne!(crc_with_sof, crc_without_sof);
    assert_eq!(crc_without_sof, 0xF9E3);
}

#[test]
fn ctrl_rdy_byte_emits_evt_rdy() {
    let mut framer = Framer::new();
    assert_eq!(framer.step(CTRL_RDY_BYTE[0]), EVT_RDY);
}

#[test]
fn ctrl_can_byte_emits_evt_can() {
    let mut framer = Framer::new();
    assert_eq!(framer.step(CTRL_CAN_BYTE[0]), EVT_CAN);
}

#[test]
fn ctrl_ack_seq_3_emits_evt_ack_with_seq_aux() {
    let mut framer = Framer::new();
    assert_eq!(framer.step(CTRL_ACK_SEQ_3[0]), EVT_NONE);
    assert_eq!(framer.step(CTRL_ACK_SEQ_3[1]), EVT_ACK | 0x03);
}
