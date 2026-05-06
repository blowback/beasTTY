//! SLIDE torn-chunk corpus.
//!
//! Splits every reference fixture at every internal byte offset and asserts
//! identical SM end-state — direct mirror of Phase 1's tests/torn_chunk.rs
//! and vt52.rs:189-318. Torn-chunk safety is SLIDE-02's load-bearing
//! invariant (PITFALLS §1, BLOCKING). The receiver SM is built per-byte —
//! state persists across feed_byte/feed_chunk calls — so torn-chunk safety
//! is a side-effect of the design, not a special case.

use bestialitty_core::slide::tests_only::*;

/// Outbound snapshot helper (raw byte copy via the stable-pointer accessors
/// — same shape Phase 8's wasm wrapper will use).
fn outbound_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.outbound_len();
    if len == 0 {
        return Vec::new();
    }
    // SAFETY: outbound_ptr is stable for at least outbound_len bytes.
    unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), len).to_vec() }
}

/// Drive a fresh Slide through the prelude (enter_recv_mode + RDY +
/// optionally a header) and run an arbitrary fixture in one chunk for the
/// reference run. Then for every internal split offset 1..fixture.len(),
/// re-build the same prelude and feed the fixture in two chunks; assert
/// state + outbound match the reference.
fn assert_identical_across_splits(
    prelude: &[u8],
    fixture: &[u8],
    label: &str,
) {
    // Reference run: prelude + fixture as one chunk.
    let mut reference = Slide::new();
    reference.enter_recv_mode();
    reference.feed_chunk(prelude);
    // Reference outbound BEFORE feeding the fixture (so we compare apples-to-apples).
    // We capture outbound at end of full feed; we don't need to clear here.
    reference.feed_chunk(fixture);
    let ref_state = reference.state();
    let ref_outbound = outbound_snapshot(&reference);

    // For every internal split offset on the fixture (the prelude is fed
    // unsplit; we're testing torn-chunk safety on the fixture frame itself).
    for split in 1..fixture.len() {
        let mut s = Slide::new();
        s.enter_recv_mode();
        s.feed_chunk(prelude);
        s.feed_chunk(&fixture[..split]);
        s.feed_chunk(&fixture[split..]);
        assert_eq!(
            s.state(), ref_state,
            "[{}] state mismatch at split offset {} (ref={}, torn={})",
            label, split, ref_state, s.state()
        );
        assert_eq!(
            outbound_snapshot(&s), ref_outbound,
            "[{}] outbound mismatch at split offset {}", label, split
        );
    }
}

/// Power-of-2 split variant for very long fixtures (RESEARCH Assumption A5).
/// 1030 splits × N fixtures is wall-clock-bounded but we use log-scale
/// splits for the max-payload fixture to keep `cargo test` snappy.
fn assert_identical_across_log_splits(
    prelude: &[u8],
    fixture: &[u8],
    label: &str,
) {
    let mut reference = Slide::new();
    reference.enter_recv_mode();
    reference.feed_chunk(prelude);
    reference.feed_chunk(fixture);
    let ref_state = reference.state();
    let ref_outbound = outbound_snapshot(&reference);

    let mut split = 1usize;
    while split < fixture.len() {
        let mut s = Slide::new();
        s.enter_recv_mode();
        s.feed_chunk(prelude);
        s.feed_chunk(&fixture[..split]);
        s.feed_chunk(&fixture[split..]);
        assert_eq!(
            s.state(), ref_state,
            "[{}] state mismatch at split offset {}", label, split
        );
        assert_eq!(
            outbound_snapshot(&s), ref_outbound,
            "[{}] outbound mismatch at split offset {}", label, split
        );
        split *= 2;
    }
}

#[test]
fn torn_header_test_txt() {
    // Header position: prelude = [CTRL_RDY] (drives WaitingRdy → HeaderPhase).
    assert_identical_across_splits(
        &[CTRL_RDY],
        FIXTURE_HEADER_TEST_TXT,
        "FIXTURE_HEADER_TEST_TXT",
    );
}

#[test]
fn torn_empty_seq_0_as_header() {
    // FIXTURE_EMPTY_SEQ_0 has seq=0 — valid header position.
    assert_identical_across_splits(
        &[CTRL_RDY],
        FIXTURE_EMPTY_SEQ_0,
        "FIXTURE_EMPTY_SEQ_0",
    );
}

#[test]
fn torn_subframe_hi_in_data_phase() {
    // Drive into DataPhase first (RDY + header), then split FIXTURE_SUBFRAME_HI.
    let mut prelude = Vec::with_capacity(1 + FIXTURE_HEADER_TEST_TXT.len());
    prelude.push(CTRL_RDY);
    prelude.extend_from_slice(FIXTURE_HEADER_TEST_TXT);
    assert_identical_across_splits(
        &prelude,
        FIXTURE_SUBFRAME_HI,
        "FIXTURE_SUBFRAME_HI in DataPhase",
    );
}

#[test]
fn torn_slide_rs_hello_in_data_phase() {
    // FIXTURE_SLIDE_RS_HELLO has seq=5 — sequence mismatch in fresh DataPhase
    // (which expects seq=1) but that's deterministic: reference + every split
    // produce the same NAK. Still tests torn-chunk safety.
    let mut prelude = Vec::with_capacity(1 + FIXTURE_HEADER_TEST_TXT.len());
    prelude.push(CTRL_RDY);
    prelude.extend_from_slice(FIXTURE_HEADER_TEST_TXT);
    assert_identical_across_splits(
        &prelude,
        FIXTURE_SLIDE_RS_HELLO,
        "FIXTURE_SLIDE_RS_HELLO in DataPhase",
    );
}

#[test]
fn torn_eof_frame_in_data_phase() {
    // FIXTURE_EOF_SEQ_4 is a zero-payload data frame → loops back to HeaderPhase.
    let mut prelude = Vec::with_capacity(1 + FIXTURE_HEADER_TEST_TXT.len());
    prelude.push(CTRL_RDY);
    prelude.extend_from_slice(FIXTURE_HEADER_TEST_TXT);
    assert_identical_across_splits(
        &prelude,
        FIXTURE_EOF_SEQ_4,
        "FIXTURE_EOF_SEQ_4 in DataPhase",
    );
}

#[test]
fn torn_all_ff_16_in_data_phase() {
    // FIXTURE_ALL_FF_16 has seq=0xFF — sequence mismatch in DataPhase
    // (expects seq=1); deterministic NAK. Tests payload bytes 0xFF
    // don't trip up the framer (no byte-stuffing-style edge case).
    let mut prelude = Vec::with_capacity(1 + FIXTURE_HEADER_TEST_TXT.len());
    prelude.push(CTRL_RDY);
    prelude.extend_from_slice(FIXTURE_HEADER_TEST_TXT);
    assert_identical_across_splits(
        &prelude,
        FIXTURE_ALL_FF_16,
        "FIXTURE_ALL_FF_16 in DataPhase",
    );
}

#[test]
fn torn_max_payload_log_splits() {
    // 1030 splits × full corpus would be slow; use log-scale splits per
    // RESEARCH Assumption A5.
    let mut prelude = Vec::with_capacity(1 + FIXTURE_HEADER_TEST_TXT.len());
    prelude.push(CTRL_RDY);
    prelude.extend_from_slice(FIXTURE_HEADER_TEST_TXT);
    let frame = fixture_max_payload_aa();
    assert_identical_across_log_splits(
        &prelude,
        &frame,
        "fixture_max_payload_aa in DataPhase",
    );
}

#[test]
fn torn_multi_frame_rdy_then_header() {
    // Multi-frame chunk: [CTRL_RDY, ...HEADER_FRAME] split at every
    // internal byte offset. The dispatching SM must reach DataPhase
    // and emit [CTRL_RDY, CTRL_ACK, 0x00] regardless of split.
    let mut multi = Vec::with_capacity(1 + FIXTURE_HEADER_TEST_TXT.len());
    multi.push(CTRL_RDY);
    multi.extend_from_slice(FIXTURE_HEADER_TEST_TXT);

    let mut reference = Slide::new();
    reference.enter_recv_mode();
    reference.feed_chunk(&multi);
    let ref_state = reference.state();
    let ref_outbound = outbound_snapshot(&reference);
    assert_eq!(ref_state, SlideState::DataPhase as u32);
    assert_eq!(ref_outbound, vec![CTRL_RDY, CTRL_ACK, 0x00]);

    for split in 1..multi.len() {
        let mut s = Slide::new();
        s.enter_recv_mode();
        s.feed_chunk(&multi[..split]);
        s.feed_chunk(&multi[split..]);
        assert_eq!(s.state(), ref_state,
            "multi-frame split at {} produced different state", split);
        assert_eq!(outbound_snapshot(&s), ref_outbound,
            "multi-frame split at {} produced different outbound", split);
    }
}
