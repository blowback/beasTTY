//! Phase 6 Plan 01 (Wave 0) — Stubs for Terminal::clear_visible().
//!
//! Source: 06-PATTERNS.md §"crates/bestialitty-core/tests/clear_visible.rs".
//! 06-CONTEXT.md D-26 — direct grid mutation; parser state untouched; cursor goes home.
//! All bodies are TODO until Plan 02-02 (Wave 1) lands the clear_visible API.

use bestialitty_core::terminal::Terminal;

#[test]
fn clear_visible_wipes_visible_grid() {
    let mut term = Terminal::new(24, 80, 100);
    // TODO Wave 1: fill 24x80 with 'X' via term.feed(b"XXXX..."); call term.clear_visible();
    // TODO Wave 1: snapshot_grid + assert every visible cell == Cell::BLANK.
    let _ = &mut term;
}

#[test]
fn clear_visible_marks_all_rows_dirty() {
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid();
    term.clear_dirty();
    // TODO Wave 1: term.clear_visible(); assert every byte of dirty bitmap == 1.
    let _ = &mut term;
}

#[test]
fn clear_visible_homes_cursor() {
    let mut term = Terminal::new(24, 80, 100);
    // TODO Wave 1: feed b"\x1BY3+" to move cursor to row 3 col 11 (ESC Y r=0x33 c=0x2B → 19,11);
    //              term.clear_visible(); assert cursor at (0, 0).
    let _ = &mut term;
}

#[test]
fn clear_visible_does_not_invoke_parser() {
    let mut term = Terminal::new(24, 80, 100);
    // TODO Wave 1: feed b"\x1B" to put parser in EscState; term.clear_visible();
    //              feed b"Z" — assert host_reply contains the [0x1B, b'/', b'K'] identify bytes
    //              (proves parser state was preserved across clear_visible — D-26).
    let _ = &mut term;
}

#[test]
fn clear_visible_does_not_touch_scrollback() {
    let mut term = Terminal::new(24, 80, 100);
    // TODO Wave 1: push 50 historical lines via feed b"line0\nline1\n..."; term.clear_visible();
    // TODO Wave 1: assert term.grid().total_len() == visible_rows + 50 (history retained).
    let _ = &mut term;
}
