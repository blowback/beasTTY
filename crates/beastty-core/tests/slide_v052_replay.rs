// Replay of the exact byte stream SLIDE v0.5.2 (slide.asm) emits for
// `SLIDE S SLIDE.COM` (2845-byte file), as observed in the 2026-07-23
// hardware session where the transfer failed and the payload dumped to the
// terminal. Reproduces the Z80 send flow byte-for-byte:
//
//   wakeup (consumed by slide.js, not the SM) → CTRL_RDY → console text
//   "Sending: SLIDE   COM\r\n" (v0.5.2 routes user messages to the UART
//   mid-session — commit c397b07 in the SLIDE repo) → header frame seq 0 →
//   [wait ACK] → data frames seq 1,2,3 (1024/1024/797) + EOF frame seq 4 →
//   [wait ACK].
//
// The SM must ACK the header, consume the frames, ACK the EOF, and never
// enter Error — anywhere it diverges is the interop bug.

use beastty_core::slide::Slide;

const CTRL_RDY: u8 = 0x11;
const CTRL_ACK: u8 = 0x06;
const SOF: u8 = 0x01;

const STATE_WAITING_RDY: u32 = 1;
const STATE_HEADER: u32 = 2;
const STATE_DATA: u32 = 3;
const STATE_ERROR: u32 = 7;

fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

// Mirror of slide.asm send_frame: SOF SEQ LEN_H LEN_L PAYLOAD CRC_H CRC_L,
// CRC-CCITT-FALSE over SEQ+LEN+PAYLOAD.
fn frame(seq: u8, payload: &[u8]) -> Vec<u8> {
    let len = payload.len() as u16;
    let mut crc_scope = vec![seq, (len >> 8) as u8, (len & 0xFF) as u8];
    crc_scope.extend_from_slice(payload);
    let crc = crc16(&crc_scope);
    let mut out = vec![SOF];
    out.extend_from_slice(&crc_scope);
    out.push((crc >> 8) as u8);
    out.push((crc & 0xFF) as u8);
    out
}

fn drain_outbound(slide: &mut Slide) -> Vec<u8> {
    let len = slide.outbound_len() as usize;
    let ptr = slide.outbound_ptr();
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
    slide.clear_outbound();
    bytes
}

fn drain_events(slide: &mut Slide) -> Vec<u32> {
    let mut evts = Vec::new();
    loop {
        let e = slide.take_event_packed();
        if e == 0 {
            break;
        }
        evts.push(e);
    }
    evts
}

#[test]
fn v052_send_session_replays_clean() {
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    assert_eq!(slide.state(), STATE_WAITING_RDY);

    // --- Z80 handshake: CTRL_RDY (possibly repeated at ~660ms) ---
    slide.feed_chunk(&[CTRL_RDY]);
    drain_events(&mut slide);
    assert_eq!(slide.state(), STATE_HEADER, "RDY should advance to HeaderPhase");
    assert_eq!(drain_outbound(&mut slide), vec![CTRL_RDY], "RDY must be echoed");

    // --- v0.5.2 console text on the wire, before the header frame ---
    slide.feed_chunk(b"Sending: SLIDE   COM\r\n");
    drain_events(&mut slide);
    assert_ne!(
        slide.state(),
        STATE_ERROR,
        "mid-session console text must not error the SM"
    );
    let noise_out = drain_outbound(&mut slide);
    assert!(
        noise_out.is_empty(),
        "console text must not trigger outbound bytes, got {noise_out:02X?}"
    );

    // --- Header frame seq 0: "SLIDE.COM\0" + 4-byte LE size (2845) ---
    let mut hdr_payload = b"SLIDE.COM\0".to_vec();
    hdr_payload.extend_from_slice(&2845u32.to_le_bytes());
    slide.feed_chunk(&frame(0, &hdr_payload));
    drain_events(&mut slide);
    assert_eq!(
        slide.state(),
        STATE_DATA,
        "header must be accepted and advance to DataPhase"
    );
    assert_eq!(
        drain_outbound(&mut slide),
        vec![CTRL_ACK, 0],
        "header must be ACKed with seq 0"
    );

    // --- Data burst exactly as send_window_from_buf emits it: one chunk ---
    // 2845 bytes = 1024 + 1024 + 797, then the EOF frame (seq 4, len 0).
    let body: Vec<u8> = (0..2845u32).map(|i| (i % 251) as u8).collect();
    let mut burst = Vec::new();
    burst.extend_from_slice(&frame(1, &body[0..1024]));
    burst.extend_from_slice(&frame(2, &body[1024..2048]));
    burst.extend_from_slice(&frame(3, &body[2048..2845]));
    burst.extend_from_slice(&frame(4, &[]));
    slide.feed_chunk(&burst);
    let evts = drain_events(&mut slide);
    assert_ne!(
        slide.state(),
        STATE_ERROR,
        "data burst must not error the SM; events drained: {evts:08X?}"
    );
    let out = drain_outbound(&mut slide);
    assert!(
        out.windows(2).any(|w| w == [CTRL_ACK, 4]),
        "EOF frame (seq 4) must be ACKed so the Z80's .wait_ack completes; outbound was {out:02X?}"
    );
    assert_eq!(
        slide.state(),
        STATE_HEADER,
        "after EOF the SM loops to HeaderPhase for the next file"
    );

    // --- Z80: all files sent → CTRL_FIN, expects echo ---
    slide.feed_chunk(&[0x04]);
    drain_events(&mut slide);
    let fin_out = drain_outbound(&mut slide);
    assert!(
        fin_out.contains(&0x04),
        "FIN must be echoed, got {fin_out:02X?}"
    );
}

#[test]
fn retransmitted_window_after_lost_eof_ack_is_re_acked() {
    // slide.asm .tx_timeout: when the Z80's post-window ACK wait times out
    // (our EOF ACK was lost on the wire), it rewinds tx_seq to the window
    // start and re-sends the identical data frames + EOF. The receiver sits
    // in HeaderPhase by then; it must swallow the replayed frames and re-ACK
    // the EOF — not hard-Error and dump the stream to the terminal.
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    slide.feed_chunk(&[CTRL_RDY]);
    drain_events(&mut slide);
    drain_outbound(&mut slide);

    let mut hdr_payload = b"SLIDE.COM\0".to_vec();
    hdr_payload.extend_from_slice(&2845u32.to_le_bytes());
    slide.feed_chunk(&frame(0, &hdr_payload));
    drain_events(&mut slide);
    drain_outbound(&mut slide);

    let body: Vec<u8> = (0..2845u32).map(|i| (i % 251) as u8).collect();
    let mut burst = Vec::new();
    burst.extend_from_slice(&frame(1, &body[0..1024]));
    burst.extend_from_slice(&frame(2, &body[1024..2048]));
    burst.extend_from_slice(&frame(3, &body[2048..2845]));
    burst.extend_from_slice(&frame(4, &[]));

    // First pass: consumed, EOF ACKed, one RECV_FILE_DONE.
    slide.feed_chunk(&burst);
    let first_events = drain_events(&mut slide);
    let file_done = 13u32 << 16;
    assert_eq!(
        first_events.iter().filter(|e| (*e & 0xFFFF_0000) == file_done).count(),
        1
    );
    assert!(drain_outbound(&mut slide).windows(2).any(|w| w == [CTRL_ACK, 4]));

    // The ACK is lost; the Z80 replays the identical burst.
    slide.feed_chunk(&burst);
    let replay_events = drain_events(&mut slide);
    assert_ne!(slide.state(), STATE_ERROR, "retransmit must not hard-Error");
    assert_eq!(slide.state(), STATE_HEADER, "must stay parked in HeaderPhase");
    assert_eq!(
        replay_events.iter().filter(|e| (*e & 0xFFFF_0000) == file_done).count(),
        0,
        "no duplicate RECV_FILE_DONE — the file was already delivered"
    );
    let out = drain_outbound(&mut slide);
    assert!(
        out.windows(2).any(|w| w == [CTRL_ACK, 4]),
        "the replayed EOF must be re-ACKed so the Z80's retry converges; outbound was {out:02X?}"
    );

    // Session still completes normally.
    slide.feed_chunk(&[0x04]);
    drain_events(&mut slide);
    assert!(drain_outbound(&mut slide).contains(&0x04));
}

#[test]
fn partial_final_frame_on_window_boundary_gets_one_ack_not_two() {
    // slide.asm reads exactly ONE control per window flush. A file whose
    // final data frame is partial AND lands on a WIN_SIZE boundary (e.g. a
    // ~23.5 KB .COM → data frames 1..24, frame 24 short, EOF 25 in the same
    // burst) must produce a single ACK — the EOF's. The old double ACK
    // (boundary + EOF) left a stray control in the Z80's RX that shifted
    // every later read, surfacing as a stray "^D" after the session (the
    // FIN echo bounced off the CCP).
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    slide.feed_chunk(&[CTRL_RDY]);
    drain_events(&mut slide);
    drain_outbound(&mut slide);

    // 4 data frames: 1024 + 1024 + 1024 + 512 (partial, seq 4 ≡ 0 mod 4).
    let size: u32 = 1024 * 3 + 512;
    let mut hdr_payload = b"MBASIC.COM\0".to_vec();
    hdr_payload.extend_from_slice(&size.to_le_bytes());
    slide.feed_chunk(&frame(0, &hdr_payload));
    drain_events(&mut slide);
    drain_outbound(&mut slide);

    let body: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
    let mut burst = Vec::new();
    burst.extend_from_slice(&frame(1, &body[0..1024]));
    burst.extend_from_slice(&frame(2, &body[1024..2048]));
    burst.extend_from_slice(&frame(3, &body[2048..3072]));
    burst.extend_from_slice(&frame(4, &body[3072..])); // partial 512B on the boundary
    burst.extend_from_slice(&frame(5, &[]));           // EOF, same burst
    slide.feed_chunk(&burst);
    drain_events(&mut slide);
    let out = drain_outbound(&mut slide);
    let acks: Vec<&[u8]> = out.windows(2).filter(|w| w[0] == CTRL_ACK).collect();
    assert_eq!(
        acks,
        vec![&[CTRL_ACK, 5][..]],
        "exactly one ACK (the EOF's) for a partial-final-frame window; outbound was {out:02X?}"
    );

    // Contrast: an exact-4-frame file (4096 bytes) keeps the boundary ACK —
    // its EOF arrives SOLO on the sender's next disk read and is ACKed then.
    slide.feed_chunk(&[0x04]); // FIN — close previous session
    drain_events(&mut slide);
    drain_outbound(&mut slide);
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    slide.feed_chunk(&[CTRL_RDY]);
    drain_events(&mut slide);
    drain_outbound(&mut slide);
    let mut hdr2 = b"EXACT.BIN\0".to_vec();
    hdr2.extend_from_slice(&4096u32.to_le_bytes());
    slide.feed_chunk(&frame(0, &hdr2));
    drain_events(&mut slide);
    drain_outbound(&mut slide);
    let body2: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
    let mut w = Vec::new();
    for s in 1..=4u8 {
        w.extend_from_slice(&frame(s, &body2[((s as usize) - 1) * 1024..(s as usize) * 1024]));
    }
    slide.feed_chunk(&w);
    drain_events(&mut slide);
    assert!(drain_outbound(&mut slide).windows(2).any(|x| x == [CTRL_ACK, 4]),
        "full-frame boundary ACK must survive");
    slide.feed_chunk(&frame(5, &[])); // solo EOF, next wait
    drain_events(&mut slide);
    assert!(drain_outbound(&mut slide).windows(2).any(|x| x == [CTRL_ACK, 5]),
        "solo EOF still gets its own ACK");
}

#[test]
fn eof_after_crc_gap_naks_and_window_replay_repairs_the_file() {
    // A blind-burst window where frame 2 arrives CRC-corrupt: the sender
    // reads no controls until its post-window ACK wait, so frames 3 and the
    // EOF follow regardless. The EOF must NOT complete the short file —
    // it NAKs so the sender's .handle_nak window rewind can fill the gap.
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    slide.feed_chunk(&[CTRL_RDY]);
    drain_events(&mut slide);
    drain_outbound(&mut slide);

    let mut hdr_payload = b"SLIDE.COM\0".to_vec();
    hdr_payload.extend_from_slice(&2845u32.to_le_bytes());
    slide.feed_chunk(&frame(0, &hdr_payload));
    drain_events(&mut slide);
    drain_outbound(&mut slide);

    let body: Vec<u8> = (0..2845u32).map(|i| (i % 251) as u8).collect();
    let f1 = frame(1, &body[0..1024]);
    let f2 = frame(2, &body[1024..2048]);
    let f3 = frame(3, &body[2048..2845]);
    let eof = frame(4, &[]);

    // First pass: corrupt f2's CRC low byte.
    let mut f2_bad = f2.clone();
    let last = f2_bad.len() - 1;
    f2_bad[last] ^= 0xFF;
    let mut burst1 = Vec::new();
    burst1.extend_from_slice(&f1);
    burst1.extend_from_slice(&f2_bad);
    burst1.extend_from_slice(&f3);
    burst1.extend_from_slice(&eof);
    slide.feed_chunk(&burst1);
    let evts1 = drain_events(&mut slide);
    let file_done = 13u32 << 16;
    assert_eq!(
        evts1.iter().filter(|e| (*e & 0xFFFF_0000) == file_done).count(),
        0,
        "gap EOF must not complete the file"
    );
    let out1 = drain_outbound(&mut slide);
    assert!(
        !out1.windows(2).any(|w| w == [CTRL_ACK, 4]),
        "gap EOF must not be ACKed; outbound was {out1:02X?}"
    );
    assert!(
        out1.windows(2).any(|w| w == [0x15, 2]),
        "expected NAK(2) for the gap; outbound was {out1:02X?}"
    );
    assert_eq!(slide.state(), STATE_DATA, "must stay in DataPhase awaiting the replay");

    // Sender rewinds and replays the intact window.
    let mut burst2 = Vec::new();
    burst2.extend_from_slice(&f1);
    burst2.extend_from_slice(&f2);
    burst2.extend_from_slice(&f3);
    burst2.extend_from_slice(&eof);
    slide.feed_chunk(&burst2);
    let evts2 = drain_events(&mut slide);
    assert_eq!(
        evts2.iter().filter(|e| (*e & 0xFFFF_0000) == file_done).count(),
        1,
        "replay must complete the file exactly once"
    );
    let out2 = drain_outbound(&mut slide);
    assert!(
        out2.windows(2).any(|w| w == [CTRL_ACK, 4]),
        "EOF ACKed after the gap is filled; outbound was {out2:02X?}"
    );
    assert_eq!(slide.state(), STATE_HEADER);

    // Total delivered payload across both passes is exactly the file, in order.
    // (Pass 1 delivered frame 1; pass 2 delivered frames 2 and 3.)
    let mut delivered = Vec::new();
    while slide.pop_recv_payload() {
        let len = slide.recv_len() as usize;
        let ptr = slide.recv_ptr();
        delivered.extend_from_slice(unsafe { std::slice::from_raw_parts(ptr, len) });
    }
    assert_eq!(delivered.len(), 2845);
    assert_eq!(delivered, body);
}
