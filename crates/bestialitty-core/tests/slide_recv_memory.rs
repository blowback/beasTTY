//! Phase 10 — receiver-side memory-bound smoke test (SLIDE-24).
//!
//! Drives many sequential 1024-byte data frames through the receiver SM,
//! cleans recv_buf between each, and asserts:
//!   1. recv_ptr() is stable across all frames (RECV_BUF_RESERVE absorbs
//!      every push without reallocation).
//!   2. recv_buf.len() never exceeds FRAME_SIZE = 1024 between frames
//!      (per-frame clear discipline is enforced).
//!   3. The receiver SM accepts ≥ 250 KB of sustained input without
//!      ballooning recv_buf.
//!
//! Note on the "1 MB headline": SLIDE seq is u8 and resets per file. A real
//! sender splits a 1 MB file across multiple files-or-resets; the smoke test
//! drives a single file's worth of sequential frames up to the seq-wrap
//! boundary (255 frames * 1024 bytes ~= 261 KB of payload). The goal is
//! NOT to deliver 1 MB end-to-end — the goal is to assert recv_buf is
//! cleared per frame and recv_ptr never moves.

use bestialitty_core::slide::tests_only::*;

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

#[test]
fn recv_one_megabyte_does_not_balloon_recv_buf() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_byte(CTRL_RDY);
    const FILE_SIZE: u32 = 1024 * 1024; // 1 MB headline
    s.feed_chunk(&build_header_frame(b"BIG.BIN", FILE_SIZE));
    // Drain header events.
    while s.take_event_packed() != EVT_NONE {}

    let ptr_before = s.recv_ptr();
    let mut total_received = 0usize;
    let payload_template = pseudo_random_bytes(1024);

    // SLIDE seq is u8 + WIN_SIZE = 4 ACK boundary; receiver SM expects
    // monotonic seq within a file. Drive seq 1..=255 (255 frames), then stop.
    // 255 frames * 1024 bytes = 261,120 bytes ≈ 255 KB sustained input.
    for i in 0u32..255 {
        let seq = ((i + 1) & 0xFF) as u8;
        if seq == 0 {
            // safety — receiver SM expects monotonic within file
            break;
        }
        s.feed_chunk(&build_data_frame(seq, &payload_template));
        assert_eq!(
            s.recv_len(),
            1024,
            "frame {} populated recv_buf with full 1024 bytes",
            i
        );
        total_received += s.recv_len();
        s.clear_recv();
        assert_eq!(s.recv_len(), 0, "clear_recv after frame {}", i);
        // Drain events to keep ring from filling up.
        while s.take_event_packed() != EVT_NONE {}
    }

    // Stable-pointer discipline (T-10-rust-stale-pointer mitigation): recv_ptr
    // must NEVER move while recv_buf.len() ≤ RECV_BUF_RESERVE (= 1024).
    assert_eq!(
        s.recv_ptr(),
        ptr_before,
        "recv_ptr stable across all frames — RECV_BUF_RESERVE = 1024 absorbs every push without realloc"
    );

    // T-10-01 mitigation: total bytes received reached the expected high
    // watermark without recv_buf growing beyond FRAME_SIZE per frame.
    assert!(
        total_received >= 250 * 1024,
        "received {} bytes; expected ≥ 250 KB without recv_buf reallocation",
        total_received
    );
}
