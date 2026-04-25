//! Phase 6 Plan 02 (Wave 1) — Real assertions for Terminal::clear_visible().
//!
//! 06-CONTEXT.md D-26 — direct grid mutation; parser state untouched; cursor
//! goes home; visible region only (scrollback retained).

use bestialitty_core::terminal::Terminal;

#[test]
fn clear_visible_wipes_visible_grid() {
    let mut term = Terminal::new(24, 80, 100);
    // Fill some cells with 'X'.
    term.feed(b"XXXXXXXXXX\n");
    term.clear_visible();
    term.snapshot_grid();
    let len = term.pack_byte_len();
    let snap: Vec<u8> = unsafe { std::slice::from_raw_parts(term.pack_ptr(), len).to_vec() };
    // Cell #[repr(C)] u32 char first field — char byte at offset (r*80 + c)*8
    // is 0 when the cell == Cell::BLANK (Cell::BLANK has ch=0x20 — a space —
    // verify against the actual BLANK constant byte).
    let blank_ch_byte = 0x20u8; // Cell::BLANK ch is space (0x20)
    for r in 0..24 {
        for c in 0..80 {
            let off = (r * 80 + c) * 8;
            assert_eq!(
                snap[off], blank_ch_byte,
                "cell ({},{}) char byte must be 0x20 (BLANK space) after clear_visible",
                r, c
            );
        }
    }
}

#[test]
fn clear_visible_marks_all_rows_dirty() {
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid();
    term.clear_dirty();
    term.clear_visible();
    let dirty: &[u8] = term.dirty();
    for r in 0..24 {
        assert_eq!(dirty[r], 1, "row {} must be dirty after clear_visible", r);
    }
}

#[test]
fn clear_visible_homes_cursor() {
    let mut term = Terminal::new(24, 80, 100);
    // ESC Y to row 5 col 10 — encoded as ESC Y (5+0x20) (10+0x20) = ESC Y % * (= 0x1B 0x59 0x25 0x2A)
    term.feed(b"\x1BY%*");
    // Sanity check pre-conditions
    assert_eq!(term.cursor(), (5, 10));
    term.clear_visible();
    assert_eq!(term.cursor(), (0, 0), "cursor must be at (0,0) after clear_visible");
}

#[test]
fn clear_visible_does_not_invoke_parser() {
    let mut term = Terminal::new(24, 80, 100);
    // Put parser in EscState by feeding the bare ESC byte (no follow-up yet).
    let _ = term.feed(b"\x1B");
    // clear_visible MUST NOT push the parser through any state — it does not feed bytes.
    term.clear_visible();
    // Now feed 'Z' — if parser preserved its EscState, this completes ESC Z (identify query),
    // and the returned reply will contain the [0x1B, b'/', b'K'] identify response (Phase 1 PARSER-05).
    let reply = term.feed(b"Z");
    assert_eq!(
        reply,
        vec![0x1B, b'/', b'K'],
        "ESC Z identify reply must fire after clear_visible — proves parser state was preserved (D-26)"
    );
}

#[test]
fn clear_visible_does_not_touch_scrollback() {
    let mut term = Terminal::new(24, 80, 100);
    // Push 50 historical lines.
    for i in 0..50 {
        let s = format!("line{}\n", i);
        term.feed(s.as_bytes());
    }
    let total_before = term.grid().total_len();
    term.clear_visible();
    let total_after = term.grid().total_len();
    assert_eq!(
        total_before, total_after,
        "clear_visible must NOT mutate scrollback total_len"
    );
}
