//! Module-level integration smokes for the slide module.
//!
//! Per-module #[cfg(test)] blocks in crc.rs / framer.rs / state.rs cover
//! transition-level behaviour. This file exercises end-to-end happy-path
//! scenarios using only the public Slide API surface, mirroring how Phase 8's
//! wasm wrapper (and JS callers) will use it. RESEARCH §Wave 0 Gaps requires
//! ≥5 module-level smokes here.

use super::tests_only::*;

fn s_recv() -> Slide {
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    slide
}

#[test]
fn smoke_full_session_rdy_header_eof_fin() {
    // End-to-end happy path: RDY echo, header ACK, EOF frame ACK + loop,
    // FIN echo, Done.
    let mut slide = s_recv();
    slide.feed_byte(CTRL_RDY);
    assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
    for &b in FIXTURE_HEADER_TEST_TXT { slide.feed_byte(b); }
    assert_eq!(slide.state(), SlideState::DataPhase as u32);
    // EOF frame (zero-payload data frame).
    for &b in FIXTURE_EOF_SEQ_4 { slide.feed_byte(b); }
    assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
    // Sender signals end-of-batch.
    slide.feed_byte(CTRL_FIN);
    assert_eq!(slide.state(), SlideState::Done as u32);
}

#[test]
fn smoke_feed_chunk_emits_event_count() {
    // RESEARCH §State Machine Event Surface: feed_chunk returns count drained
    // into the ring; JS consumes via take_event_packed.
    let mut slide = s_recv();
    let count = slide.feed_chunk(&[CTRL_RDY]);
    assert_eq!(count, 1, "feed_chunk should report exactly one event from CTRL_RDY");
    let evt = slide.take_event_packed();
    assert_eq!(evt, EVT_RDY);
    assert_eq!(slide.take_event_packed(), EVT_NONE,
        "ring should be empty after drain");
}

#[test]
fn smoke_cancel_then_peer_echo_completes() {
    // D-05/D-06/D-07: host cancels, drains CAN to wire, peer echoes CAN, Done.
    let mut slide = s_recv();
    slide.feed_byte(CTRL_RDY);
    slide.cancel();
    assert_eq!(slide.state(), SlideState::CancelPending as u32);
    slide.clear_outbound();   // simulate JS drained CAN to wire
    slide.feed_byte(CTRL_CAN);
    assert_eq!(slide.state(), SlideState::Done as u32);
}

#[test]
fn smoke_garbage_in_idle_no_events_no_panic() {
    // Phase 1 D-15 silent discard — random garbage between sessions
    // doesn't blow up the framer or push events.
    let mut slide = Slide::new();
    // State is Idle (not WaitingRdy — no enter_recv_mode call).
    slide.feed_chunk(&[0x00, 0xFF, 0x42, 0x7F, 0xAA]);
    assert_eq!(slide.state(), SlideState::Idle as u32);
    assert_eq!(slide.outbound_len(), 0);
}

#[test]
fn smoke_force_idle_clears_outbound() {
    // D-06: force_idle clears outbound (any pending CAN bytes JS hasn't
    // yet drained are dropped — JS owns the wire after force_idle).
    let mut slide = s_recv();
    slide.feed_byte(CTRL_RDY);
    slide.cancel();   // pushes CTRL_CAN to outbound
    assert!(slide.outbound_len() > 0);
    slide.force_idle();
    assert_eq!(slide.outbound_len(), 0);
    assert_eq!(slide.state(), SlideState::Done as u32);
}
