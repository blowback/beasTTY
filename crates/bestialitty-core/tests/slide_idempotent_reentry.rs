//! SLIDE idempotent re-entry corpus.
//!
//! Implements the 6 test cases from RESEARCH §Idempotent Re-entry Test
//! Cases (lines 1088-1182). Each test pins a specific clause of D-05
//! (strict bidirectional CAN echo), D-06 (idempotent cancel + force_idle
//! escape hatch), and D-07 (silent drain in CancelPending). Together they
//! cover T-07-06 (re-entrant wakeup mid-session, PITFALLS §9 HIGH).

use bestialitty_core::slide::tests_only::*;

fn outbound_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.outbound_len();
    if len == 0 { return Vec::new(); }
    unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), len).to_vec() }
}

fn drain_events(slide: &mut Slide) -> usize {
    let mut count = 0usize;
    while slide.take_event_packed() != EVT_NONE {
        count += 1;
    }
    count
}

/// Re-entry Test 1 (RESEARCH lines 1093-1108): cancel() while already in
/// CancelPending must be a no-op (D-06 idempotent contract).
#[test]
fn re1_cancel_during_cancel_pending_is_noop() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_chunk(&[CTRL_RDY]);
    s.clear_outbound();
    s.cancel();
    let outbound_len_after_first = s.outbound_len();
    let state_after_first = s.state();
    assert_eq!(state_after_first, SlideState::CancelPending as u32);

    s.cancel();    // re-entry — must be no-op
    assert_eq!(s.outbound_len(), outbound_len_after_first,
        "second cancel() must NOT push another CTRL_CAN onto outbound (D-06)");
    assert_eq!(s.state(), state_after_first,
        "second cancel() must NOT change sm_state (D-06)");
}

/// Re-entry Test 2 (RESEARCH lines 1110-1124): peer-initiated CAN during
/// CancelPending must complete the session (D-05 echo received).
#[test]
fn re2_peer_initiated_can_during_cancel_pending() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_chunk(&[CTRL_RDY]);
    s.clear_outbound();
    s.cancel();                           // host-initiated, SM = CancelPending
    s.clear_outbound();                   // simulate JS drained CAN to wire
    s.feed_byte(CTRL_CAN);                // peer's CAN arrives — interpreted as echo
    assert_eq!(s.state(), SlideState::Done as u32,
        "peer CAN during CancelPending must complete the session (D-05)");
}

/// Re-entry Test 3 (RESEARCH lines 1126-1140): bytes silently consumed in
/// CancelPending — no framer events emitted (D-07 silent drain).
#[test]
fn re3_silent_consume_in_cancel_pending() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_chunk(&[CTRL_RDY]);
    s.cancel();
    let _ = drain_events(&mut s);    // clear pre-cancel events

    // Feed a valid frame's bytes — none of them should produce events.
    s.feed_chunk(FIXTURE_SLIDE_RS_HELLO);
    let event_count_after = drain_events(&mut s);
    assert_eq!(event_count_after, 0,
        "bytes during CancelPending must not emit framer events (D-07)");
    assert_eq!(s.state(), SlideState::CancelPending as u32);
}

/// Re-entry Test 4 (RESEARCH lines 1142-1156): spurious mid-stream CTRL_CAN
/// during DataPhase echoes CAN and transitions (D-05 strict bidirectional).
#[test]
fn re4_spurious_can_during_data_phase() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_chunk(&[CTRL_RDY]);
    s.feed_chunk(FIXTURE_HEADER_TEST_TXT);
    assert_eq!(s.state(), SlideState::DataPhase as u32);
    s.clear_outbound();

    s.feed_byte(CTRL_CAN);                // peer-initiated mid-DataPhase cancel
    assert_eq!(s.state(), SlideState::CancelPending as u32);
    assert_eq!(outbound_snapshot(&s), vec![CTRL_CAN],
        "bidirectional echo (D-05): receiving CAN must emit CAN");
}

/// Re-entry Test 5 (RESEARCH lines 1158-1168): force_idle() from
/// CancelPending → Done (D-06 escape hatch).
#[test]
fn re5_force_idle_resets_cancel_pending() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_chunk(&[CTRL_RDY]);
    s.cancel();
    assert_eq!(s.state(), SlideState::CancelPending as u32);

    s.force_idle();
    assert_eq!(s.state(), SlideState::Done as u32,
        "force_idle() from CancelPending must transition to Done (D-06)");
}

/// Re-entry Test 6 (RESEARCH lines 1170-1179): garbage bytes in Idle state
/// silently discarded (Phase 1 D-15).
#[test]
fn re6_garbage_in_idle_silently_discarded() {
    let mut s = Slide::new();
    // State is Idle (no enter_recv_mode call). Feed garbage bytes that
    // are not SOF, RDY, FIN, CAN, ACK, NAK.
    s.feed_chunk(&[0x00, 0xFF, 0x42, 0x7F, 0xAA]);
    assert_eq!(s.state(), SlideState::Idle as u32,
        "garbage bytes in Idle must not change state (Phase 1 D-15)");
    assert_eq!(s.outbound_len(), 0,
        "garbage bytes in Idle must not push any outbound");
}
