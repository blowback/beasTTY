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

use bestialitty_core::key::{KeyCode, KeyEvent, Modifiers, encode};
use bestialitty_core::terminal::Terminal;

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
