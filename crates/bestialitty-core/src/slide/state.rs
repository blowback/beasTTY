//! SLIDE sliding-window state machine — receiver-only in Phase 7.
//!
//! Phase 9 will extend this with sender-side transitions (the SLIDE-04
//! success criterion is satisfied by the receiver SM, which exercises every
//! control byte; see RESEARCH §SM Scope Recommendation lines 728-779).
//!
//! Mirrors terminal.rs:17-130 shape: a long-lived struct holding the
//! per-position state + a stable-pointer outbound ring buffer. Phase 8's
//! `lib.rs:wasm_boundary` will wrap this with `#[wasm_bindgen]` attributes;
//! Phase 7 leaves the wasm boundary untouched.
//!
//! Architectural rule (CLAUDE.md + CONTEXT D-20): NO `wasm_bindgen`,
//! NO `web_sys`, NO `js_sys`, NO `std::time`. All timing in JS;
//! Rust SM is purely event-driven. `cancel()` and `force_idle()` are the
//! D-06 idempotent + escape-hatch APIs JS uses to drive the v0.2.1 CAN
//! amendment without leaking time logic into Rust.
//!
use std::collections::VecDeque;

use super::framer::{
    Framer, EVT_NONE, EVT_RDY, EVT_FIN, EVT_CAN,
    EVT_DATA_FRAME, EVT_CRC_ERROR,
    CTRL_RDY, CTRL_ACK, CTRL_NAK, CTRL_FIN, CTRL_CAN,
};

/// SLIDE v0.2 sliding window size (slide-rs/protocol.rs:12-13).
const WIN_SIZE: u8 = 4;

/// Maximum CRC-error retry count before SM transitions to Error
/// (slide-rs/recv.rs:142).
const NAK_BUDGET: u32 = 15;

/// Outbound buffer pre-reserve (RDY+ACK+seq+NAK+seq+CAN+FIN ≤ 7 bytes;
/// 16 = 9 bytes headroom for stable-pointer discipline). Vec::clear()
/// preserves capacity → subsequent push() reuses allocation → outbound_ptr()
/// is stable across feed_byte calls in steady state (Phase 1 D-17 mirror).
const OUTBOUND_RESERVE: usize = 16;

const EVENT_RING_RESERVE: usize = 32;

/// Top-level SLIDE session state. `#[repr(u32)]` so Phase 8 can return it
/// across the wasm boundary as a plain u32 (RESEARCH §"Reusable Assets").
#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlideState {
    Idle          = 0,
    WaitingRdy    = 1,
    HeaderPhase   = 2,
    DataPhase     = 3,
    FinPending    = 4,
    CancelPending = 5,
    Done          = 6,
    Error         = 7,
}

/// Direction role. Phase 7 only constructs Receiver via enter_recv_mode().
/// Phase 9 will add an enter_send_mode(metadata) constructor for Sender.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlideRole {
    Receiver,
    Sender,
}

/// SLIDE state machine. Receiver-only in Phase 7. Mirror of terminal.rs:17-41
/// Terminal struct shape; outbound_buf is the SLIDE analog of host_reply.
pub struct Slide {
    framer: Framer,
    sm_state: SlideState,
    #[allow(dead_code)]
    role: SlideRole,
    /// Next-expected data-frame sequence number (incremented per accepted
    /// data frame, wrapping at u8). Receiver tracks this against incoming
    /// EVT_DATA_FRAME(seq).
    expected_seq: u8,
    /// CRC-error retry budget. Reset to 0 on a clean ACK; bounded at NAK_BUDGET
    /// (slide-rs/recv.rs:142). Exhaustion → SlideState::Error.
    nak_retry_count: u32,
    /// Pre-reserved 16 bytes per OUTBOUND_RESERVE. Vec::clear() preserves
    /// capacity; outbound_ptr() is stable across feed_byte calls in steady
    /// state. Phase 8 wraps this triple with #[wasm_bindgen] in lib.rs.
    outbound_buf: Vec<u8>,
    /// Event ring drained by JS via take_event_packed() after feed_chunk.
    /// Pre-reserved EVENT_RING_RESERVE entries.
    events: VecDeque<u32>,
}

impl Slide {
    pub fn new() -> Self {
        Self {
            framer: Framer::new(),
            sm_state: SlideState::Idle,
            role: SlideRole::Receiver,
            expected_seq: 1,                 // first data frame is seq 1 (seq 0 is header)
            nak_retry_count: 0,
            outbound_buf: Vec::with_capacity(OUTBOUND_RESERVE),
            events: VecDeque::with_capacity(EVENT_RING_RESERVE),
        }
    }

    /// Transition Idle → WaitingRdy as receiver (Phase 8 dispatcher calls this
    /// after consuming the wakeup signature). Receiver-only in Phase 7.
    pub fn enter_recv_mode(&mut self) {
        self.role = SlideRole::Receiver;
        self.sm_state = SlideState::WaitingRdy;
    }

    /// State accessor (returns SlideState as u32 for Phase 8 boundary).
    pub fn state(&self) -> u32 {
        self.sm_state as u32
    }

    /// Per-byte feed step. Drives the framer; on framer events, drives the
    /// SM transition. Returns the most recent packed event from this byte
    /// (or EVT_NONE if no event). Events are also pushed into the ring
    /// for feed_chunk multi-event drain.
    pub fn feed_byte(&mut self, b: u8) -> u32 {
        // CancelPending: silent drain per D-07. Only CTRL_CAN echo wakes us.
        if self.sm_state == SlideState::CancelPending {
            if b == CTRL_CAN {
                self.sm_state = SlideState::Done;
                let evt = EVT_CAN;
                self.events.push_back(evt);
                return evt;
            }
            return EVT_NONE;
        }

        // Done / Error: ignore further bytes. JS should call Slide::new() for
        // the next session.
        if matches!(self.sm_state, SlideState::Done | SlideState::Error) {
            return EVT_NONE;
        }

        let evt = self.framer.step(b);
        if evt == EVT_NONE {
            return EVT_NONE;
        }

        // Drive the receiver SM on framer event.
        self.handle_framer_event(evt);

        // Push into ring for feed_chunk drain.
        self.events.push_back(evt);
        evt
    }

    /// Multi-byte hot path. Returns the count of events drained INTO the
    /// ring (JS calls take_event_packed repeatedly to consume).
    pub fn feed_chunk(&mut self, bytes: &[u8]) -> u32 {
        let before = self.events.len();
        for &b in bytes {
            let _ = self.feed_byte(b);
        }
        (self.events.len() - before) as u32
    }

    /// Drain one event from the ring. Returns EVT_NONE when empty.
    pub fn take_event_packed(&mut self) -> u32 {
        self.events.pop_front().unwrap_or(EVT_NONE)
    }

    /// D-06: fire-and-set-state cancel. Idempotent — calling cancel() while
    /// already in CancelPending or Done is a no-op. JS owns timing
    /// (200/500/100/2000 ms windows per PITFALLS §5).
    pub fn cancel(&mut self) {
        if matches!(self.sm_state, SlideState::CancelPending | SlideState::Done | SlideState::Error) {
            return;
        }
        // CTRL_CAN is a raw single byte (RESEARCH §CTRL_CAN Wire Format
        // Resolution lines 698-725; ADR-003 records this).
        self.outbound_buf.push(CTRL_CAN);
        self.sm_state = SlideState::CancelPending;
    }

    /// D-06: escape hatch for JS after the ~2 s no-echo timeout. Forcibly
    /// transitions to Done (NOT Idle — the session is over either way; JS
    /// constructs a new Slide for the next session).
    pub fn force_idle(&mut self) {
        self.sm_state = SlideState::Done;
        self.outbound_buf.clear();
    }

    // ===== Stable-pointer accessor triple (D-17 mirror) =====

    /// Pointer into outbound_buf. Stable across feed_byte/feed_chunk calls
    /// IN STEADY STATE (i.e., outbound_buf.len() ≤ OUTBOUND_RESERVE).
    /// Phase 8 wraps via wasm-bindgen.
    pub fn outbound_ptr(&self) -> *const u8 {
        self.outbound_buf.as_ptr()
    }

    pub fn outbound_len(&self) -> usize {
        self.outbound_buf.len()
    }

    /// Acknowledge outbound drain. Resets len to 0; preserves capacity per
    /// Vec::clear() contract.
    pub fn clear_outbound(&mut self) {
        self.outbound_buf.clear();
    }

    // ===== Internal: receiver SM transition driver =====

    fn handle_framer_event(&mut self, evt: u32) {
        // High 16 bits = kind; low 16 bits = aux (typically seq).
        let aux = (evt & 0xFFFF) as u8;

        // Peer-initiated CAN (D-05 strict bidirectional): from any non-Done state,
        // echo CTRL_CAN and transition to CancelPending.
        if evt == EVT_CAN
            && !matches!(self.sm_state, SlideState::Done | SlideState::Error | SlideState::CancelPending)
        {
            self.outbound_buf.push(CTRL_CAN);
            self.sm_state = SlideState::CancelPending;
            return;
        }

        match (self.sm_state, evt) {
            // ===== WaitingRdy =====
            (SlideState::WaitingRdy, EVT_RDY) => {
                // Echo CTRL_RDY back per spec §Startup Handshake.
                self.outbound_buf.push(CTRL_RDY);
                self.sm_state = SlideState::HeaderPhase;
            }
            (SlideState::WaitingRdy, EVT_FIN) => {
                // Empty session — sender had nothing to send.
                self.outbound_buf.push(CTRL_FIN);
                self.sm_state = SlideState::Done;
            }

            // ===== HeaderPhase =====
            (SlideState::HeaderPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
                if aux == 0 {
                    // Header validated by application layer; for the SM,
                    // seq=0 marker is sufficient. ACK and advance to DataPhase.
                    self.outbound_buf.push(CTRL_ACK);
                    self.outbound_buf.push(0);
                    self.expected_seq = 1;
                    self.nak_retry_count = 0;
                    self.sm_state = SlideState::DataPhase;
                } else {
                    // Protocol violation — sender sent data before header.
                    self.sm_state = SlideState::Error;
                }
            }
            (SlideState::HeaderPhase, EVT_FIN) => {
                // Multi-file batch done — echo FIN.
                self.outbound_buf.push(CTRL_FIN);
                self.sm_state = SlideState::Done;
            }
            (SlideState::HeaderPhase, e) if e & 0xFFFF_0000 == EVT_CRC_ERROR => {
                self.outbound_buf.push(CTRL_NAK);
                self.outbound_buf.push(aux);
                self.nak_retry_count += 1;
                if self.nak_retry_count > NAK_BUDGET {
                    self.sm_state = SlideState::Error;
                }
            }

            // ===== DataPhase =====
            (SlideState::DataPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
                // EOF marker: zero-payload data frame. Receiver ACKs and
                // loops back to HeaderPhase for the next file in the batch.
                // (slide-rs/recv.rs:172-180 — len==0 case.)
                let payload = self.framer.take_payload();
                if payload.is_empty() {
                    // EOF: ACK the EOF frame's seq, loop to HeaderPhase.
                    self.outbound_buf.push(CTRL_ACK);
                    self.outbound_buf.push(aux);
                    self.expected_seq = 1;
                    self.nak_retry_count = 0;
                    self.sm_state = SlideState::HeaderPhase;
                } else if aux == self.expected_seq {
                    // Match — accept frame; per-window ACK on WIN_SIZE boundary.
                    // slide-rs/recv.rs:206-212: send ACK every WIN_SIZE frames.
                    self.expected_seq = self.expected_seq.wrapping_add(1);
                    self.nak_retry_count = 0;
                    let last_acked = self.expected_seq.wrapping_sub(1);
                    if last_acked & (WIN_SIZE - 1) == 0 {
                        self.outbound_buf.push(CTRL_ACK);
                        self.outbound_buf.push(last_acked);
                    }
                } else {
                    // Sequence mismatch — NAK with expected_seq.
                    self.outbound_buf.push(CTRL_NAK);
                    self.outbound_buf.push(self.expected_seq);
                }
            }
            (SlideState::DataPhase, e) if e & 0xFFFF_0000 == EVT_CRC_ERROR => {
                self.outbound_buf.push(CTRL_NAK);
                self.outbound_buf.push(self.expected_seq);
                self.nak_retry_count += 1;
                if self.nak_retry_count > NAK_BUDGET {
                    self.sm_state = SlideState::Error;
                }
            }
            (SlideState::DataPhase, EVT_FIN) => {
                // Protocol violation — FIN mid-file.
                self.sm_state = SlideState::Error;
            }

            // Default: ignore irrelevant events (RDY/ACK/NAK during receive
            // are not semantically meaningful to the receiver SM since the
            // peer is the one sending data; and Idle/CancelPending/Done/Error
            // were handled above).
            _ => {}
        }
    }
}

impl Default for Slide {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slide::tests_only::*;

    fn s_recv() -> Slide {
        let mut slide = Slide::new();
        slide.enter_recv_mode();
        slide
    }

    #[test]
    fn new_constructs_in_idle() {
        let slide = Slide::new();
        assert_eq!(slide.state(), SlideState::Idle as u32);
        assert_eq!(slide.outbound_len(), 0);
    }

    #[test]
    fn outbound_ptr_is_non_null_at_construction() {
        let slide = Slide::new();
        // Vec::with_capacity guarantees a valid pointer when capacity > 0.
        // Stable-pointer discipline: the same pointer must persist across
        // feed_byte calls in steady state.
        assert!(!slide.outbound_ptr().is_null());
    }

    #[test]
    fn enter_recv_mode_transitions_to_waiting_rdy() {
        let mut slide = Slide::new();
        slide.enter_recv_mode();
        assert_eq!(slide.state(), SlideState::WaitingRdy as u32);
    }

    #[test]
    fn recv_rdy_echoed() {
        let mut slide = s_recv();
        assert_eq!(slide.feed_byte(CTRL_RDY), EVT_RDY);
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
        assert_eq!(slide.outbound_len(), 1);
        // SAFETY: outbound_ptr is non-null, len is 1.
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_RDY]);
    }

    #[test]
    fn header_acks_seq_0() {
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.clear_outbound();
        for &b in FIXTURE_HEADER_TEST_TXT {
            slide.feed_byte(b);
        }
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        // ACK with seq=0
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_ACK, 0x00]);
    }

    #[test]
    fn data_phase_per_window_ack_at_win_size_4() {
        // Drive into DataPhase with expected_seq=1.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT {
            slide.feed_byte(b);
        }
        slide.clear_outbound();
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        // Now feed 4 frames seq 1..4 — slide-rs/recv.rs:206-212 says ACK
        // when (last_acked & (WIN_SIZE - 1)) == 0, i.e. when last_acked is
        // a multiple of 4. After accepting seq=4, last_acked == 4 → ACK.
        // Build 4 minimal valid data frames (1-byte payload each).
        for seq in 1u8..=4 {
            let mut frame = vec![0x01, seq, 0x00, 0x01, 0x00];   // SOF SEQ LEN_H LEN_L PAYLOAD(0x00)
            let crc = crc16_ccitt(&[seq, 0x00, 0x01, 0x00]);
            frame.push((crc >> 8) as u8);
            frame.push((crc & 0xFF) as u8);
            for &b in &frame {
                slide.feed_byte(b);
            }
        }
        // Outbound should contain exactly one ACK (after seq=4); no ACKs
        // for seqs 1, 2, 3 (within window).
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_ACK, 0x04],
            "expected single window-boundary ACK at seq=4, got {:02X?}", buf);
    }

    #[test]
    fn seq_mismatch_naks_with_expected() {
        // Drive to DataPhase with expected_seq=1.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        slide.clear_outbound();
        // Feed a frame with seq=5 instead of expected seq=1.
        let mut frame = vec![0x01, 0x05, 0x00, 0x01, 0xAA];
        let crc = crc16_ccitt(&[0x05, 0x00, 0x01, 0xAA]);
        frame.push((crc >> 8) as u8);
        frame.push((crc & 0xFF) as u8);
        for &b in &frame { slide.feed_byte(b); }
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_NAK, 0x01],
            "NAK must carry expected_seq=1, not the received seq=5");
    }

    #[test]
    fn eof_frame_loops_to_header() {
        // Drive to DataPhase, then feed a zero-payload data frame (EOF marker).
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        slide.clear_outbound();
        // EOF frame with seq=4 (FIXTURE_EOF_SEQ_4 from tests_only).
        for &b in FIXTURE_EOF_SEQ_4 { slide.feed_byte(b); }
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32,
            "EOF frame must loop back to HeaderPhase for next file in batch");
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_ACK, 0x04]);
    }

    #[test]
    fn fin_in_header_phase_echoes_and_completes() {
        // Drive to HeaderPhase, then feed CTRL_FIN.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.clear_outbound();
        assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
        assert_eq!(slide.feed_byte(CTRL_FIN), EVT_FIN);
        assert_eq!(slide.state(), SlideState::Done as u32);
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_FIN]);
    }

    #[test]
    fn nak_budget_exhaustion_transitions_to_error() {
        // In DataPhase, 16 consecutive CRC errors should exhaust budget on
        // the 16th. (NAK_BUDGET=15 → 16th error transitions to Error.)
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        // Build a frame with deliberately-wrong CRC.
        for _ in 0..16 {
            let frame: &[u8] = &[0x01, 0x01, 0x00, 0x01, 0xAA, 0xDE, 0xAD]; // bogus CRC
            for &b in frame { slide.feed_byte(b); }
        }
        assert_eq!(slide.state(), SlideState::Error as u32,
            "16 consecutive CRC errors must exhaust NAK_BUDGET=15 and transition to Error");
    }

    #[test]
    fn cancel_idempotent() {
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.clear_outbound();
        slide.cancel();
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
        let len_after_first = slide.outbound_len();
        assert_eq!(len_after_first, 1);
        // D-06 idempotent contract: second cancel() must not push another CAN.
        slide.cancel();
        assert_eq!(slide.outbound_len(), len_after_first,
            "second cancel() must not push another CTRL_CAN onto outbound");
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
    }

    #[test]
    fn peer_can_during_data_phase_echoes_and_transitions() {
        // D-05 strict bidirectional: receiving CTRL_CAN must echo CTRL_CAN.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
        assert_eq!(slide.state(), SlideState::DataPhase as u32);
        slide.clear_outbound();
        assert_eq!(slide.feed_byte(CTRL_CAN), EVT_CAN);
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
        let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
        assert_eq!(buf, &[CTRL_CAN]);
    }

    #[test]
    fn force_idle_transitions_to_done() {
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.cancel();
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
        slide.force_idle();
        assert_eq!(slide.state(), SlideState::Done as u32);
        assert_eq!(slide.outbound_len(), 0);
    }

    #[test]
    fn cancel_pending_silent_drains_non_can_bytes() {
        // D-07: while in CancelPending, non-CAN bytes silently consumed.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.cancel();
        slide.clear_outbound();
        // Feed a partial frame's worth of bytes.
        for &b in FIXTURE_SLIDE_RS_HELLO {
            let evt = slide.feed_byte(b);
            assert_eq!(evt, EVT_NONE,
                "byte {:#X} during CancelPending must produce no events", b);
        }
        assert_eq!(slide.state(), SlideState::CancelPending as u32);
    }

    #[test]
    fn cancel_pending_can_completes_session() {
        // D-05 echo received: peer's CTRL_CAN during CancelPending → Done.
        let mut slide = s_recv();
        slide.feed_byte(CTRL_RDY);
        slide.cancel();
        slide.clear_outbound();
        // simulate JS drained CAN to wire
        assert_eq!(slide.feed_byte(CTRL_CAN), EVT_CAN);
        assert_eq!(slide.state(), SlideState::Done as u32);
    }

    #[test]
    fn outbound_ptr_stable_across_feed_byte() {
        // D-17 mirror: outbound_ptr is stable across feed_byte calls in
        // steady state (i.e., outbound_buf.len() ≤ OUTBOUND_RESERVE).
        let mut slide = s_recv();
        let ptr_before = slide.outbound_ptr();
        // Drive a couple of state transitions that push to outbound.
        slide.feed_byte(CTRL_RDY);
        let ptr_after_rdy = slide.outbound_ptr();
        assert_eq!(ptr_before, ptr_after_rdy,
            "outbound_ptr must be stable across feed_byte (D-17 mirror)");
    }
}
