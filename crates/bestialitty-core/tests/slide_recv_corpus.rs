//! Phase 10 — receiver corpus integration tests.
//!
//! End-to-end coverage for SLIDE-21 (zero-byte) / SLIDE-22 (sub-frame) /
//! SLIDE-23 (binary) / multi-file batches / max-payload (1024 byte) /
//! W3 multi-data-frames-in-one-chunk OS-USB concatenation contract via
//! hand-built fixture frames driving the production receiver SM.
//!
//! Mirrors the Phase 7 slide_torn_chunk.rs corpus pattern + the Phase 9
//! slide_sender.rs cross-validation discipline (PITFALLS §13).

use bestialitty_core::slide::tests_only::*;

// =====================================================================
// Helpers (verbatim mirror of slide_recv_payload.rs Task 2 helpers; integration
// tests live in separate compilation units so we don't share a helper module).
// =====================================================================

fn recv_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.recv_len();
    if len == 0 {
        return Vec::new();
    }
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

/// Deterministic pseudo-random bytes (xorshift32 seeded with fixed seed).
/// Verbatim from Phase 9 tests/slide_sender.rs:37-48.
fn pseudo_random_bytes(len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    let mut state: u32 = 0xdeadbeef;
    for _ in 0..len {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        out.push((state & 0xFF) as u8);
    }
    out
}

// =====================================================================
// Tests
// =====================================================================

#[test]
fn recv_corpus_zero_byte_file() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"ZERO.TXT", 0));
    s.feed_chunk(&build_data_frame(1, &[]));
    let events = drain_events_collect(&mut s);
    assert!(
        events.iter().any(|e| (e & 0xFFFF_0000) == EVT_HEADER_RECEIVED),
        "expected EVT_HEADER_RECEIVED"
    );
    assert!(
        events.iter().any(|e| (e & 0xFFFF_0000) == EVT_RECV_FILE_DONE),
        "expected EVT_RECV_FILE_DONE"
    );
    assert_eq!(recv_filename_string(&s), b"ZERO.TXT".to_vec());
    assert_eq!(s.recv_file_size(), 0);
}

#[test]
fn recv_corpus_sub_frame_file() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"SMALL.TXT", 512));
    drain_events_collect(&mut s);
    let payload = pseudo_random_bytes(512);
    s.feed_chunk(&build_data_frame(1, &payload));
    assert_eq!(recv_snapshot(&s), payload);
    s.clear_recv();
    s.feed_chunk(&build_data_frame(2, &[]));
    let events = drain_events_collect(&mut s);
    assert!(
        events.iter().any(|e| (e & 0xFFFF_0000) == EVT_RECV_FILE_DONE),
        "expected EVT_RECV_FILE_DONE"
    );
}

#[test]
fn recv_corpus_binary_payload() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"BIN.COM", 6));
    drain_events_collect(&mut s);
    let bin = vec![0x00u8, 0xFF, 0x80, 0x7F, 0xDE, 0xAD];
    s.feed_chunk(&build_data_frame(1, &bin));
    assert_eq!(recv_snapshot(&s), bin, "byte-identical binary round-trip");
}

#[test]
fn recv_corpus_multi_file() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    // File 0: A.TXT, 5 bytes
    s.feed_chunk(&build_header_frame(b"A.TXT", 5));
    s.feed_chunk(&build_data_frame(1, &[1, 2, 3, 4, 5]));
    s.clear_recv();
    s.feed_chunk(&build_data_frame(2, &[]));
    // File 1: B.TXT, 10 bytes
    s.feed_chunk(&build_header_frame(b"B.TXT", 10));
    let p2: Vec<u8> = (10..20).collect();
    s.feed_chunk(&build_data_frame(1, &p2));
    s.clear_recv();
    s.feed_chunk(&build_data_frame(2, &[]));
    let events = drain_events_collect(&mut s);
    let header_events: Vec<_> = events
        .iter()
        .copied()
        .filter(|e| (*e & 0xFFFF_0000) == EVT_HEADER_RECEIVED)
        .collect();
    let done_events: Vec<_> = events
        .iter()
        .copied()
        .filter(|e| (*e & 0xFFFF_0000) == EVT_RECV_FILE_DONE)
        .collect();
    assert_eq!(header_events.len(), 2, "two header events for two files");
    assert_eq!(done_events.len(), 2, "two file-done events for two files");
    // file_idx pin: header events carry 0 and 1.
    assert_eq!(header_events[0] & 0xFFFF, 0);
    assert_eq!(header_events[1] & 0xFFFF, 1);
    // Symmetry: done events carry 0 and 1.
    assert_eq!(done_events[0] & 0xFFFF, 0);
    assert_eq!(done_events[1] & 0xFFFF, 1);
}

#[test]
fn recv_corpus_max_payload_frame() {
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"MAX.BIN", 1024));
    drain_events_collect(&mut s);
    let payload = pseudo_random_bytes(1024);
    s.feed_chunk(&build_data_frame(1, &payload));
    assert_eq!(s.recv_len(), 1024);
    assert_eq!(recv_snapshot(&s), payload);
}

#[test]
fn recv_corpus_multi_data_frames_in_one_chunk() {
    // W3 contract — OS-level USB chunks may concatenate multiple SLIDE frames.
    // feed_chunk(&combined) must emit N sequential EVT_RECV_DATA events,
    // one per frame, with per-frame recv_buf semantics so JS-side
    // clear_recv()-per-event drains correctly.
    //
    // This pins the contract that Plan 10-02's slide-recv.js head comment
    // and 10-VALIDATION.md row 10-01-02 cite as existing.
    //
    // Phase 10 review CR-01 / IN-04 — extended to assert per-event recv_buf
    // bytes via pop_recv_payload(). Earlier this test only counted events;
    // the SM was happily overwriting recv_buf per-frame inside feed_chunk,
    // so by the time JS drained, only the LAST frame's bytes remained.
    // The pop_recv_payload accessor pops the front of the per-frame queue
    // into recv_buf so each event's bytes are observable in turn.
    let mut s = s_recv();
    s.feed_byte(CTRL_RDY);
    s.feed_chunk(&build_header_frame(b"MULTI.TXT", 6));
    drain_events_collect(&mut s);
    // Concatenate two data frames into ONE feed_chunk (as a real OS USB
    // chunk would deliver back-to-back frames).
    let mut combined = Vec::new();
    combined.extend_from_slice(&build_data_frame(1, &[1, 2, 3]));
    combined.extend_from_slice(&build_data_frame(2, &[4, 5, 6]));
    s.feed_chunk(&combined);
    // After feed_chunk, the per-frame queue holds two payloads.
    assert_eq!(
        s.recv_payload_queue_len(),
        2,
        "queue must hold one Vec per data frame after feed_chunk returns"
    );
    // Drain events ONE AT A TIME, popping recv_buf between each EVT_RECV_DATA.
    // Note: the events ring contains BOTH the low-level EVT_DATA_FRAME events
    // (pushed unconditionally by feed_byte at state.rs:360) and the high-level
    // EVT_RECV_DATA events (pushed by the DataPhase arm of handle_framer_event).
    // The JS dispatcher (slide.js:drainEventsAndOutbound) filters for
    // EVT_RECV_DATA before calling onRecvEvent; this test mirrors that filter.
    fn next_recv_data(s: &mut Slide) -> u32 {
        loop {
            let e = s.take_event_packed();
            if e == EVT_NONE {
                return EVT_NONE;
            }
            if (e & 0xFFFF_0000) == EVT_RECV_DATA {
                return e;
            }
        }
    }
    let evt1 = next_recv_data(&mut s);
    assert_eq!(evt1 & 0xFFFF_0000, EVT_RECV_DATA, "first EVT_RECV_DATA found");
    assert_eq!(evt1 & 0xFFFF, 1, "first event seq=1");
    assert!(s.pop_recv_payload(), "queue must have first payload");
    assert_eq!(
        recv_snapshot(&s),
        vec![1, 2, 3],
        "first event must read first frame's payload (was [4,5,6] before CR-01 fix)"
    );
    s.clear_recv();
    let evt2 = next_recv_data(&mut s);
    assert_eq!(evt2 & 0xFFFF_0000, EVT_RECV_DATA, "second EVT_RECV_DATA found");
    assert_eq!(evt2 & 0xFFFF, 2, "second event seq=2");
    assert!(s.pop_recv_payload(), "queue must have second payload");
    assert_eq!(
        recv_snapshot(&s),
        vec![4, 5, 6],
        "second event must read second frame's payload"
    );
    s.clear_recv();
    // Queue must be empty after both pops.
    assert_eq!(s.recv_payload_queue_len(), 0, "queue drained");
    assert!(!s.pop_recv_payload(), "extra pop on empty queue returns false");
}
