//! SLIDE wasm-boundary shape contract — Phase 8 dependency pin.
//!
//! Phase 8 wraps `crate::slide::Slide` in `lib.rs:wasm_boundary` with a
//! `#[wasm_bindgen]` façade exposing 11 methods: new / enter_recv_mode /
//! feed_byte / feed_chunk / take_event_packed / state / outbound_ptr /
//! outbound_len / clear_outbound / cancel / force_idle. The façade is gated
//! by `#[cfg(target_arch = "wasm32")]` so native cargo test cannot directly
//! pin the wasm-bindgen-attributed methods. This file pins the INNER
//! signatures via fn-pointer coercion against `crate::slide::Slide`; the
//! façade is mechanical one-line forwarding so any inner-API drift fails
//! HERE at compile time before wasm-pack ever runs (per CONTEXT D-10 and
//! 08-PATTERNS.md §"Slide façade addition").
//!
//! Sibling-mirror of `tests/slide_boundary_shape.rs` (Phase 7 pin) — keeps
//! grep locality on the slide subsystem (per RESEARCH §Open Questions #2
//! recommendation). EVT_* + SlideState repr(u32) constants pinned because
//! `transport/slide.js` mirrors them in JS (per RESEARCH §Pitfall 7 +
//! Alternatives Considered table — wasm-bindgen has no clean associated-const
//! export, so Rust-side pin + JS-side mirror is the standard pattern).

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
fn slide_send_methods_have_stable_signatures() {
    // Phase 9 sender API surface — wasm boundary mirror of
    // slide_boundary_shape.rs:slide_send_methods_have_stable_signatures.
    // Tests/ integration tests compile against the lib in NON-test mode,
    // so they see exactly the public surface that wasm-bindgen sees.
    // Plan 09-02 forwards these one-line through lib.rs:wasm_boundary
    // (cfg target_arch=wasm32) — drift here fails native cargo test
    // BEFORE wasm-pack would.
    let _: fn(&mut Slide, &[u8])       = Slide::enter_send_mode;
    let _: fn(&mut Slide, &[u8], bool) = Slide::feed_send_chunk;
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
    // any future renumbering breaks the JS-side enum mapping in
    // www/transport/slide.js.
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
fn slide_event_constants_pinned_for_phase_8_jsmirror() {
    // (kind << 16) | aux packing convention (RESEARCH §Pattern 3,
    // mirror of lib.rs:152-155 cursor_packed). Phase 8 unpacks these in
    // JS via `(evt >>> 16)` for kind and `evt & 0xFFFF` for aux. The
    // JS-side mirror lives in www/transport/slide.js and MUST stay in
    // lockstep with the constants pinned below.
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
    // JS-side www/transport/slide.js mirrors these as:
    //   const EVT_FILE_COMPLETE     = 8  << 16;
    //   const EVT_SESSION_COMPLETE  = 9  << 16;
    //   const EVT_RETRANSMIT_NEEDED = 10 << 16;
    // Drift here fails this test BEFORE the JS mirror desyncs.
    assert_eq!(EVT_FILE_COMPLETE     >> 16, 8);
    assert_eq!(EVT_SESSION_COMPLETE  >> 16, 9);
    assert_eq!(EVT_RETRANSMIT_NEEDED >> 16, 10);
    assert_eq!(EVT_FILE_COMPLETE     & 0xFFFF, 0);
    assert_eq!(EVT_SESSION_COMPLETE  & 0xFFFF, 0);
    assert_eq!(EVT_RETRANSMIT_NEEDED & 0xFFFF, 0);
}

#[test]
fn slide_phase8_wasm_facade_surface_runtime_callable() {
    // Each method called at runtime — proves the public surface is reachable
    // from a downstream crate (wasm-bindgen façade is a downstream crate too).
    // Mirror of slide_boundary_shape.rs::slide_runtime_calls_compile_against_external_surface
    // because Phase 8's wasm façade forwards to exactly the same 11 methods
    // Phase 7 pinned. Two files, one shape — by design (Phase 7 says "ships";
    // Phase 8 says "depends on these contracts").
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

    // Phase 9 sender API runtime reachability check — mirror of
    // slide_boundary_shape.rs:slide_runtime_calls_compile_against_external_surface.
    // Proves the wasm-bindgen façade in lib.rs forwards into a method that
    // is actually callable on the inner Slide. Full sender SM transitions
    // are exercised in slide::state::tests + tests/slide_sender.rs.
    let mut slide2 = Slide::new();
    let metadata = {
        let mut m = Vec::new();
        m.extend_from_slice(&1u32.to_le_bytes());          // file_count = 1
        m.extend_from_slice(&5u32.to_le_bytes());          // name_len = 5
        m.extend_from_slice(b"A.TXT");                      // name
        m.extend_from_slice(&0u32.to_le_bytes());          // size = 0 (empty file)
        m
    };
    slide2.enter_send_mode(&metadata);
    // For empty-file case, no further feed_send_chunk is needed; sender SM
    // takes the EOF fast-path. Just prove the API is reachable.
}
