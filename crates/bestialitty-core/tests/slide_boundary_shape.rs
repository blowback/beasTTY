//! SLIDE boundary API shape contract — Phase 8 anticipation pin.
//!
//! Phase 8 will wrap `Slide` in `lib.rs:wasm_boundary` with feed_byte /
//! feed_chunk / outbound_ptr / outbound_len / clear_outbound / state /
//! cancel / force_idle / take_event_packed exports. If any of these
//! signatures drift — a method removed, a return type changed, a `pub`
//! accidentally narrowed to `pub(crate)` — Phase 8 will fail at the
//! wasm-pack build step with a cryptic error.
//!
//! This file pins the shape as a compile-time contract: every #[test]
//! below is a runtime fn call that only compiles if the public API matches
//! the shape stated in 07-CONTEXT.md and ARCHITECTURE.md §1. Compile
//! failure IS the intended failure mode.
//!
//! NOTE: This test intentionally lives OUTSIDE the crate (integration test
//! under `tests/`), so it consumes exactly the surface that wasm-bindgen
//! will consume in Phase 8. A pub(crate) method that compiles against an
//! in-crate #[cfg(test)] module would fail here — which is what we want.
//!
//! Direct mirror of crates/bestialitty-core/tests/boundary_api_shape.rs:280-318.

use bestialitty_core::slide::{
    Slide, SlideState,
    EVT_NONE, EVT_RDY, EVT_ACK, EVT_NAK, EVT_FIN, EVT_CAN,
    EVT_DATA_FRAME, EVT_CRC_ERROR,
    EVT_FILE_COMPLETE, EVT_SESSION_COMPLETE, EVT_RETRANSMIT_NEEDED,
};

#[test]
fn slide_constructor_signature_is_stable() {
    // fn-pointer coercion: catches signature drift at compile time.
    let _ctor: fn() -> Slide = Slide::new;
    let _slide: Slide = Slide::new();
}

#[test]
fn slide_lifecycle_methods_have_stable_signatures() {
    let _: fn(&mut Slide)              = Slide::enter_recv_mode;
    let _: fn(&mut Slide)              = Slide::cancel;
    let _: fn(&mut Slide)              = Slide::force_idle;
}

#[test]
fn slide_feed_methods_have_stable_signatures() {
    let _: fn(&mut Slide, u8) -> u32   = Slide::feed_byte;
    let _: fn(&mut Slide, &[u8]) -> u32 = Slide::feed_chunk;
    let _: fn(&mut Slide) -> u32       = Slide::take_event_packed;
}

#[test]
fn slide_state_accessor_signature_is_stable() {
    let _: fn(&Slide) -> u32           = Slide::state;
}

#[test]
fn slide_outbound_accessors_have_stable_signatures() {
    // The ptr/len/clear triple is the load-bearing zero-copy contract
    // Phase 8 will wrap. Mirror of boundary_api_shape.rs:286/312 lines.
    let _: fn(&Slide) -> *const u8     = Slide::outbound_ptr;
    let _: fn(&Slide) -> usize         = Slide::outbound_len;
    let _: fn(&mut Slide)              = Slide::clear_outbound;
}

#[test]
fn slide_state_enum_repr_u32_pinned() {
    // SlideState is #[repr(u32)] so Phase 8's `state()` accessor returns
    // a u32 cleanly across the wasm boundary. Pin the variant values:
    // any future renumbering breaks the JS-side enum mapping.
    assert_eq!(SlideState::Idle          as u32, 0);
    assert_eq!(SlideState::WaitingRdy    as u32, 1);
    assert_eq!(SlideState::HeaderPhase   as u32, 2);
    assert_eq!(SlideState::DataPhase     as u32, 3);
    assert_eq!(SlideState::FinPending    as u32, 4);
    assert_eq!(SlideState::CancelPending as u32, 5);
    assert_eq!(SlideState::Done          as u32, 6);
    assert_eq!(SlideState::Error         as u32, 7);
}

#[test]
fn slide_event_constants_pinned() {
    // (kind << 16) | aux packing convention (RESEARCH §Pattern 3,
    // mirror of lib.rs:152-155 cursor_packed). Phase 8 unpacks these in
    // JS via `(evt >>> 16)` for kind and `evt & 0xFFFF` for aux.
    assert_eq!(EVT_NONE,            0);
    assert_eq!(EVT_RDY        >> 16, 1);
    assert_eq!(EVT_ACK        >> 16, 2);
    assert_eq!(EVT_NAK        >> 16, 3);
    assert_eq!(EVT_FIN        >> 16, 4);
    assert_eq!(EVT_CAN        >> 16, 5);
    assert_eq!(EVT_DATA_FRAME >> 16, 6);
    assert_eq!(EVT_CRC_ERROR  >> 16, 7);
    // Aux bits are zero for the constants (filled in at runtime per byte).
    assert_eq!(EVT_RDY & 0xFFFF,  0);
    assert_eq!(EVT_ACK & 0xFFFF,  0);

    // Phase 9 sender extensions — must NOT shift any existing 0..7 value.
    assert_eq!(EVT_FILE_COMPLETE     >> 16, 8);
    assert_eq!(EVT_SESSION_COMPLETE  >> 16, 9);
    assert_eq!(EVT_RETRANSMIT_NEEDED >> 16, 10);
    assert_eq!(EVT_FILE_COMPLETE     & 0xFFFF, 0);
    assert_eq!(EVT_SESSION_COMPLETE  & 0xFFFF, 0);
    assert_eq!(EVT_RETRANSMIT_NEEDED & 0xFFFF, 0);
}

#[test]
fn build_frame_into_emits_slide_rs_hello_fixture() {
    // Cross-check against slide-rs/protocol.rs:231-243 fixture:
    //   build_frame(0x05, b"hello") => [0x01, 0x05, 0x00, 0x05,
    //   b'h', b'e', b'l', b'l', b'o', 0xF9, 0xE3]
    use bestialitty_core::slide::tests_only::build_frame_into;
    let mut buf = Vec::with_capacity(64);
    build_frame_into(&mut buf, 0x05, b"hello");
    assert_eq!(
        &buf[..],
        &[0x01, 0x05, 0x00, 0x05,
          b'h', b'e', b'l', b'l', b'o',
          0xF9, 0xE3]
    );
}

#[test]
fn build_frame_into_preserves_reserved_capacity_for_max_payload() {
    // Phase 9 OUTBOUND_RESERVE = 4128 will absorb 4 max frames
    // without reallocation; here we prove the helper itself does
    // not reallocate when the caller has pre-reserved enough.
    use bestialitty_core::slide::tests_only::build_frame_into;
    let mut buf: Vec<u8> = Vec::with_capacity(4128);
    let ptr_before = buf.as_ptr();
    let payload = vec![0xAA; 1024];
    build_frame_into(&mut buf, 0x01, &payload);
    assert_eq!(buf.as_ptr(), ptr_before, "OUTBOUND_RESERVE must absorb a 1024-byte frame without reallocating");
    assert_eq!(buf.len(), 1031);  // SOF + SEQ + LEN_H + LEN_L + 1024 payload + CRC_H + CRC_L
}

#[test]
fn slide_runtime_calls_compile_against_external_surface() {
    // Each method called at runtime — proves the public surface is reachable
    // from a downstream crate (wasm-bindgen façade is a downstream crate too).
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    let _: u32 = slide.feed_byte(0x11);    // CTRL_RDY
    let _: u32 = slide.feed_chunk(&[]);
    let _: u32 = slide.take_event_packed();
    let _: u32 = slide.state();
    let _: *const u8 = slide.outbound_ptr();
    let _: usize = slide.outbound_len();
    slide.clear_outbound();
    slide.cancel();
    slide.force_idle();
}
