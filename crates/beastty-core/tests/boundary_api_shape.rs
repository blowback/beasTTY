//! Boundary API shape contract (D-17 + D-18).
//!
//! Phase 2's wasm-bindgen wrapper in `lib.rs` will expose the `Terminal`'s
//! public surface (plus the `key::encode` function) to JS. If any of these
//! signatures drift — a method removed, a return type changed, a `pub`
//! accidentally narrowed to `pub(crate)` — Phase 2 will fail at the
//! wasm-pack build step with a cryptic error.
//!
//! This file pins the shape as a compile-time contract: every `#[test]`
//! below is a runtime fn call that only compiles if the public API matches
//! the shape stated in `01-CONTEXT.md` D-17 and in `01-07-PLAN.md`'s
//! `<interfaces>` block. Compile failure IS the intended failure mode;
//! the runtime assertions double as a smoke test that the shapes actually
//! behave as advertised (not merely type-check).
//!
//! NOTE: This test intentionally lives OUTSIDE the crate (integration test
//! under `tests/`), so it consumes exactly the surface that `wasm-bindgen`
//! will consume. A `pub(crate)` method that compiles against an in-crate
//! `#[cfg(test)]` module would fail here — which is what we want.

use beastty_core::key::{KeyCode, KeyEvent, Modifiers, encode, unpack_keycode, unpack_mods};
use beastty_core::terminal::Terminal;

#[test]
fn terminal_constructor_signature_is_stable() {
    // D-12 / D-17: `Terminal::new(rows: u32, cols: u32, scrollback_cap: usize)`
    // Explicit type annotations ensure a widening / narrowing of any arg
    // produces a compile error here.
    let _term: Terminal = Terminal::new(24u32, 80u32, 10_000usize);
}

#[test]
fn terminal_feed_accepts_byte_slice_returns_vec_u8() {
    // D-14 / D-17: `feed(&[u8]) -> Vec<u8>`. The returned Vec is the
    // host-bound reply the JS shell writes to `port.writable` (typically
    // empty; non-empty on ESC Z and any future identify-style sequence).
    let mut term = Terminal::new(24, 80, 100);
    let bytes: &[u8] = b"\x1BZ"; // ESC Z -> identify
    let reply: Vec<u8> = term.feed(bytes);
    assert_eq!(
        reply,
        vec![0x1B, b'/', b'K'],
        "ESC Z must return the canonical identify reply [0x1B, b'/', b'K']"
    );
}

#[test]
fn terminal_state_queries_have_stable_return_types() {
    // D-17 read-only accessors — every one of these is a Phase 2 wasm export.
    let term = Terminal::new(24, 80, 100);

    // cursor() -> (row, col) tuple per PLAN.md interface block. The packed
    // u32 form noted in D-17 is a Phase 2 wasm-boundary projection; the
    // semantic-layer shape exposes the tuple.
    let _cursor: (u32, u32) = term.cursor();
    let _rows: u32 = term.rows();
    let _cols: u32 = term.cols();
    let _bell: bool = term.bell_pending();
    let _dirty: &[u8] = term.dirty();
}

#[test]
fn terminal_mutations_have_stable_signatures() {
    // D-17 mutators — every one of these is a Phase 2 wasm export.
    let mut term = Terminal::new(24, 80, 100);
    term.clear_bell();
    term.clear_dirty();
    term.resize(30u32, 90u32);
    term.resize_scrollback(5_000usize);
}

#[test]
fn key_encode_signature_is_stable() {
    // CORE-01: the Rust core owns key encoding. Phase 4's DOM event handler
    // packs a (KeyCode, Modifiers) pair into a KeyEvent and calls encode().
    let evt = KeyEvent {
        code: KeyCode::ArrowUp,
        mods: Modifiers::default(),
    };
    let bytes: Vec<u8> = encode(evt);
    assert_eq!(
        bytes,
        vec![0x1B, b'A'],
        "ArrowUp must encode to ESC A per the VT52 spec"
    );
}

#[test]
fn key_event_constructors_exist() {
    // Phase 4 convenience: construct a plain-key event and a ctrl-modified
    // event without having to spell out the Modifiers literal each time.
    let _a = KeyEvent::new(KeyCode::Enter);
    let _b = KeyEvent::with_ctrl(KeyCode::Char(b'c'));
    let _none: Modifiers = Modifiers::NONE;
    let _ctrl: Modifiers = Modifiers::CTRL;
}

#[test]
fn terminal_exposes_grid_read_access() {
    // D-17 zero-copy hot path (semantic-layer side): Phase 3's renderer
    // will reach the Cell grid via `term.grid()`. The zero-copy wasm
    // boundary projection (`grid_ptr()` / `grid_byte_len()`) is Phase 2's
    // problem; Phase 1 ensures the semantic accessor exists.
    let term = Terminal::new(24, 80, 100);
    let sb = term.grid();
    assert_eq!(sb.visible_rows(), 24);
    assert_eq!(sb.cols(), 80);
}

#[test]
fn esc_y_end_to_end_through_feed() {
    // Integration smoke: ESC Y decoded via the public feed() path
    // produces the PITFALLS.md #3 saturating clamp at the bottom-right edge.
    let mut term = Terminal::new(24, 80, 100);
    term.feed(b"\x1BY\x37\x6F"); // row=0x37-0x20=23, col=0x6F-0x20=79
    assert_eq!(term.cursor(), (23, 79));
}

#[test]
fn feed_across_two_calls_is_stateful() {
    // Core correctness of a byte-streaming parser (PARSER-03 torn-chunk
    // invariant): splitting ESC Y across feed() calls must reach the
    // identical cursor state as a single feed().
    let mut split = Terminal::new(24, 80, 100);
    split.feed(b"\x1BY");
    split.feed(b"\x23\x45");

    let mut whole = Terminal::new(24, 80, 100);
    whole.feed(b"\x1BY\x23\x45");

    assert_eq!(
        split.cursor(),
        whole.cursor(),
        "torn ESC Y must reach the same cursor state as whole ESC Y"
    );
    // Concrete value: row=0x23-0x20=3, col=0x45-0x20=37
    assert_eq!(split.cursor(), (3, 37));
}

#[test]
fn bell_end_to_end() {
    // PARSER-06 smoke: BEL flips bell_pending; clear_bell resets it.
    let mut term = Terminal::new(24, 80, 100);
    assert!(!term.bell_pending());
    term.feed(b"\x07");
    assert!(term.bell_pending());
    term.clear_bell();
    assert!(!term.bell_pending());
}

#[test]
fn terminal_snapshot_and_pointer_methods_have_stable_return_types() {
    // Phase 2 D-10: every new method on crate::terminal::Terminal is pinned.
    // Drift in `&mut self` / `&self` / return type / arg count fails the build.
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid(); // &mut self, no args, no return

    let _ptr: *const u8 = term.pack_ptr(); // D-09 pack pointer (lib.rs exposes as grid_ptr())
    let _len: usize = term.pack_byte_len(); // D-09 pack byte length
    let _dptr: *const u8 = term.dirty_ptr(); // D-09 dirty bitmap pointer

    assert_eq!(
        _len,
        24 * 80 * 8,
        "pack_byte_len must equal rows * cols * size_of::<Cell>() (size_of = 8 per grid.rs const_assert)"
    );
}

#[test]
fn pack_ptr_stable_across_feed_per_d03() {
    // D-03 invalidation contract: feed() must not invalidate the pack-buf pointer.
    // Integration-level pin (duplicates terminal::tests for the lib-public surface).
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid();
    let before = term.pack_ptr() as usize;
    term.feed(b"Hello\x1BY\x21\x21World");
    term.snapshot_grid();
    let after = term.pack_ptr() as usize;
    assert_eq!(
        before, after,
        "pack_buf pointer must be stable across feed() per D-03"
    );
}

#[test]
fn feed_accepts_large_slice_without_panic() {
    // SC-4 integration gate: one feed() call must accept a 64 KB slice without
    // panicking. The wasm façade's `feed` is the same signature; if this passes
    // natively, it passes under wasm too (modulo JS marshalling, which is a
    // separate concern tested via the harness in Plan 04 / SC-4 manual demo).
    let mut term = Terminal::new(24, 80, 100);
    let payload = vec![b'A'; 65_536];
    let _reply: Vec<u8> = term.feed(&payload);
    // Not asserting reply contents — ESC Z would be the reply-triggering seq;
    // a block of 'A's is pure print ops with no host reply.
}

#[test]
fn key_unpack_signatures_are_stable() {
    // D-10 pins for the Phase 2 additions to key.rs. Plan 03's lib.rs
    // encode_key_raw delegates to these; signature drift here is the
    // single failure mode that catches a misaligned JS-side packing scheme.
    let _kc: Option<KeyCode> = unpack_keycode(1u32);
    let _m: Modifiers = unpack_mods(0u32);

    // Round-trip smoke: ArrowUp (tag=1, no payload) + empty mods must encode to ESC A.
    let evt = KeyEvent {
        code: unpack_keycode(1u32).expect("tag 1 is ArrowUp"),
        mods: unpack_mods(0u32),
    };
    let bytes: Vec<u8> = encode(evt);
    assert_eq!(bytes, vec![0x1B, b'A']);
}

// --- Phase 2 Plan 06: zero-copy host_reply surface pins (SC-3 gap closure) ---

#[test]
fn feed_silent_returns_unit_and_accumulates_host_reply() {
    // 02-06 contract: `feed_silent` drives the parser without taking or
    // returning the host_reply. JS reads the pending reply via
    // `host_reply_ptr` / `host_reply_len`, then acks via `clear_host_reply`.
    // This eliminates the wasm-bindgen-generated `.slice()` on the feed()
    // return value (dominant SC-3 allocation source).
    let mut term = Terminal::new(24, 80, 100);
    term.feed_silent(b"\x1BZ");
    assert_eq!(
        term.host_reply_len(),
        3,
        "ESC Z accumulates 3 bytes into host_reply"
    );
    let bytes =
        unsafe { core::slice::from_raw_parts(term.host_reply_ptr(), term.host_reply_len()) };
    assert_eq!(
        bytes,
        &[0x1B, b'/', b'K'][..],
        "host_reply must hold the canonical identify reply"
    );
    term.clear_host_reply();
    assert_eq!(term.host_reply_len(), 0, "clear_host_reply resets len to 0");
}

#[test]
fn feed_silent_empty_reply_path_is_zero_len() {
    // Steady-state common case: pure print has no host_reply. The pointer
    // must still be valid (Vec pre-reserved in Terminal::new) so JS can
    // construct a persistent Uint8Array view over the capacity even when
    // the current len is 0.
    let mut term = Terminal::new(24, 80, 100);
    term.feed_silent(b"Hello");
    assert_eq!(
        term.host_reply_len(),
        0,
        "pure-print feed produces no host_reply bytes"
    );
    assert!(
        !term.host_reply_ptr().is_null(),
        "host_reply_ptr must be non-null even when len=0 (pre-reserved Vec)"
    );
}

#[test]
fn host_reply_ptr_stable_across_feed_silent_calls() {
    // D-03 mirror: the host_reply pointer must not move under steady-state
    // ESC-Z traffic. Vec::with_capacity(8) in Terminal::new + the 3-byte
    // reply keeps us well under the reallocation threshold. JS caches the
    // Uint8Array view over this pointer; a move here would require JS to
    // re-derive per call (which is what we're eliminating).
    let mut term = Terminal::new(24, 80, 100);
    term.feed_silent(b"\x1BZ");
    let before = term.host_reply_ptr() as usize;
    term.clear_host_reply();
    term.feed_silent(b"\x1BZ");
    let after = term.host_reply_ptr() as usize;
    assert_eq!(
        before, after,
        "host_reply_ptr must be stable across feed_silent+clear_host_reply cycles"
    );
}

#[test]
fn feed_silent_does_not_return() {
    // Compile-time pin: a future change to `feed_silent` that introduces
    // a return type (e.g. reverting to `-> Vec<u8>`) would reintroduce the
    // wasm-bindgen `.slice()` and fail the SC-3 contract. This assertion
    // fails to compile if the signature drifts.
    let _: fn(&mut Terminal, &[u8]) = Terminal::feed_silent;
}

#[test]
fn existing_feed_still_returns_vec_u8() {
    // Regression guard: Plan 06 RETAINS the native `Terminal::feed -> Vec<u8>`
    // surface so all 11 native callers (terminal.rs tests + boundary_api_shape
    // + fixture_runner) keep working. Only the wasm façade in lib.rs switches
    // to feed_silent; pure-Rust callers are unaffected.
    let mut term = Terminal::new(24, 80, 100);
    let reply: Vec<u8> = term.feed(b"\x1BZ");
    assert_eq!(
        reply,
        vec![0x1B, b'/', b'K'],
        "native Terminal::feed continues to return the Vec<u8> reply"
    );
}

// --- Phase 6 Plan 02: pinned signatures for snapshot_grid_at + clear_visible ---

#[test]
fn phase6_snapshot_grid_at_and_clear_visible_signatures_pinned() {
    // Phase 6 D-06 + D-26: pinned method signatures.
    // Drift in &mut self / arg type / return type fails the build, mirroring
    // Phase 2 D-10 boundary-shape lock. Type-annotated function-pointer coercion
    // catches a signature change at compile time even before the runtime calls.
    let _: fn(&mut Terminal, usize) = Terminal::snapshot_grid_at;
    let _: fn(&mut Terminal) = Terminal::clear_visible;

    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid_at(0_usize); // &mut self, usize, no return
    term.clear_visible(); // &mut self, no args, no return
    let _ = &term;
}
