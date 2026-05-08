//! Phase 10 — receiver payload extraction unit tests.
//!
//! Verifies the recv_buf / recv_filename / recv_file_size accessor triple
//! and EVT_HEADER_RECEIVED / EVT_RECV_DATA / EVT_RECV_FILE_DONE event
//! ordering invariant (Assumption A7 — JS sees filename + size before any
//! data event for the new file).
//!
//! Mirror of Phase 7 slide_torn_chunk.rs idiom — uses
//! `beastty_core::slide::tests_only::*` so the tests compile against the
//! lib in NON-test mode (same surface as Plan 10-02's wasm-bindgen façade).

use beastty_core::slide::tests_only::*;

fn recv_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.recv_len();
    if len == 0 {
        return Vec::new();
    }
    // SAFETY: recv_ptr is non-null and len bytes are initialized while
    // recv_buf is alive and unmutated.
    unsafe { std::slice::from_raw_parts(slide.recv_ptr(), len).to_vec() }
}

fn recv_filename_string(slide: &Slide) -> Vec<u8> {
    let len = slide.recv_filename_len();
    if len == 0 {
        return Vec::new();
    }
    unsafe { std::slice::from_raw_parts(slide.recv_filename_ptr(), len).to_vec() }
}

fn drain_events_collect(slide: &mut Slide) -> Vec<u32> {
    let mut out = Vec::new();
    loop {
        let e = slide.take_event_packed();
        if e == EVT_NONE {
            break;
        }
        out.push(e);
    }
    out
}

/// Build a hand-rolled SLIDE header frame:
///   payload = name.bytes ++ b'\0' ++ size_le_u32 (4 bytes)
/// Wrapped by build_frame_into into:
///   SOF + SEQ(0) + LEN_HI + LEN_LO + payload + CRC_HI + CRC_LO
fn build_header_frame(name: &[u8], size: u32) -> Vec<u8> {
    let mut payload = Vec::with_capacity(name.len() + 1 + 4);
    payload.extend_from_slice(name);
    payload.push(0);
    payload.extend_from_slice(&size.to_le_bytes());
    let mut buf = Vec::with_capacity(7 + payload.len());
    build_frame_into(&mut buf, 0, &payload);
    buf
}

fn build_data_frame(seq: u8, payload: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(7 + payload.len());
    build_frame_into(&mut buf, seq, payload);
    buf
}

fn s_recv() -> Slide {
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    slide
}

// --- Test 1 — zero-byte file completes with empty chunks (SLIDE-21) ---
#[test]
fn recv_zero_byte_file_completes_with_empty_chunks() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    let header = build_header_frame(b"A.TXT", 0);
    s.feed_chunk(&header);
    // Filename + size populated synchronously with EVT_HEADER_RECEIVED.
    assert_eq!(recv_filename_string(&s), b"A.TXT".to_vec());
    assert_eq!(s.recv_file_size(), 0);
    // Now send the zero-payload EOF marker at seq=1 (per slide-rs convention,
    // even zero-byte files send an EOF data frame).
    let eof = build_data_frame(1, &[]);
    s.feed_chunk(&eof);
    let events = drain_events_collect(&mut s);
    assert!(
        events.iter().any(|e| (e & 0xFFFF_0000) == EVT_HEADER_RECEIVED),
        "expected EVT_HEADER_RECEIVED in event ring, got: {:08X?}",
        events
    );
    assert!(
        events.iter().any(|e| (e & 0xFFFF_0000) == EVT_RECV_FILE_DONE),
        "expected EVT_RECV_FILE_DONE in event ring, got: {:08X?}",
        events
    );
    assert_eq!(s.recv_len(), 0, "no data frame received between header and EOF");
}

// --- Test 2 — sub-frame file: single data frame then EOF (SLIDE-22) ---
#[test]
fn recv_sub_frame_file_single_data_frame_then_eof() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"B.TXT", 10));
    drain_events_collect(&mut s);
    s.clear_recv_filename();
    // Single data frame at seq=1, 10 bytes payload.
    let payload: Vec<u8> = (1..=10).collect();
    s.feed_chunk(&build_data_frame(1, &payload));
    // Snapshot recv_buf BEFORE clear; then EOF.
    assert_eq!(recv_snapshot(&s), payload);
    s.clear_recv();
    // EOF at seq=2.
    s.feed_chunk(&build_data_frame(2, &[]));
    let events = drain_events_collect(&mut s);
    assert!(
        events
            .iter()
            .any(|e| (e & 0xFFFF_0000) == EVT_RECV_DATA && (e & 0xFFFF) == 1),
        "expected EVT_RECV_DATA with aux=1, got: {:08X?}",
        events
    );
    assert!(
        events.iter().any(|e| (e & 0xFFFF_0000) == EVT_RECV_FILE_DONE),
        "expected EVT_RECV_FILE_DONE, got: {:08X?}",
        events
    );
}

// --- Test 3 — binary payload bytes round-trip byte-identical (SLIDE-23) ---
#[test]
fn recv_binary_payload_passes_through_uint8() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"X.COM", 6));
    drain_events_collect(&mut s);
    let bin: Vec<u8> = vec![0x00, 0x80, 0xFF, 0x7F, 0xC0, 0xDE];
    s.feed_chunk(&build_data_frame(1, &bin));
    assert_eq!(recv_snapshot(&s), bin, "binary bytes round-trip byte-identical");
}

// --- Test 4 — Assumption A7: EVT_HEADER_RECEIVED precedes EVT_RECV_DATA ---
#[test]
fn recv_payload_event_ordering_header_before_data() {
    // Drive header + first data frame in the SAME chunk via feed_chunk.
    // The JS-side slide-recv.js drain loop relies on this ordering — it
    // updates the chip's filename before pushing the first byte to the
    // file's blob accumulator (Assumption A7).
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    let header = build_header_frame(b"C.TXT", 5);
    let data = build_data_frame(1, &[1, 2, 3, 4, 5]);
    let mut combined = Vec::with_capacity(header.len() + data.len());
    combined.extend_from_slice(&header);
    combined.extend_from_slice(&data);
    s.feed_chunk(&combined);
    let events = drain_events_collect(&mut s);
    let h_idx = events
        .iter()
        .position(|e| (e & 0xFFFF_0000) == EVT_HEADER_RECEIVED)
        .expect("EVT_HEADER_RECEIVED present");
    let d_idx = events
        .iter()
        .position(|e| (e & 0xFFFF_0000) == EVT_RECV_DATA)
        .expect("EVT_RECV_DATA present");
    assert!(
        h_idx < d_idx,
        "Assumption A7: EVT_HEADER_RECEIVED ({}) must precede EVT_RECV_DATA ({}) in the event ring",
        h_idx, d_idx
    );
}

// --- Test 5 — recv_buf cleared per-frame; recv_ptr stable across pushes ---
#[test]
fn recv_buf_cleared_per_frame_no_balloon() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"D.BIN", 8 * 1024));
    drain_events_collect(&mut s);
    let ptr_before = s.recv_ptr();
    for seq in 1u8..=8 {
        let payload = vec![seq; 1024];
        s.feed_chunk(&build_data_frame(seq, &payload));
        assert_eq!(s.recv_len(), 1024, "frame {} populated recv_buf", seq);
        assert_eq!(
            unsafe { std::slice::from_raw_parts(s.recv_ptr(), 1024) },
            &payload[..],
            "frame {} payload byte-identical",
            seq
        );
        s.clear_recv();
        assert_eq!(s.recv_len(), 0, "clear_recv after frame {}", seq);
    }
    assert_eq!(
        s.recv_ptr(),
        ptr_before,
        "recv_ptr stable across 8 max-payload frames (RECV_BUF_RESERVE absorbs without realloc)"
    );
}

// --- Test 6 — full 8.3 filename round-trip ---
#[test]
fn recv_filename_max_length_8_3_plus_null() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"ABCDEFGH.IJK", 100));
    assert_eq!(recv_filename_string(&s), b"ABCDEFGH.IJK".to_vec());
    assert_eq!(s.recv_file_size(), 100);
}
