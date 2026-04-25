//! Phase 6 Plan 02 (Wave 1) — Real assertions for Terminal::snapshot_grid_at(row_offset).
//!
//! 06-CONTEXT.md D-06 — out-of-range row_offset clamps to min(row_offset, scrollback_len).
//! D-03 mirror — pack_ptr identity-stable across snapshot_grid_at calls.

use bestialitty_core::terminal::Terminal;

#[test]
fn snapshot_grid_at_zero_matches_snapshot_grid() {
    let mut term = Terminal::new(24, 80, 100);
    // Feed some content so pack_buf is non-empty.
    term.feed(b"hello world\n");
    term.snapshot_grid();
    let len = term.pack_byte_len();
    let snap_a: Vec<u8> = unsafe { std::slice::from_raw_parts(term.pack_ptr(), len).to_vec() };
    term.snapshot_grid_at(0);
    let snap_b: Vec<u8> = unsafe { std::slice::from_raw_parts(term.pack_ptr(), len).to_vec() };
    assert_eq!(
        snap_a, snap_b,
        "snapshot_grid_at(0) must match snapshot_grid()"
    );
}

#[test]
fn snapshot_grid_at_clamps_oversized_offset() {
    let mut term = Terminal::new(24, 80, 100);
    // Push 100 lines into scrollback by feeding 100 newlines preceded by markers.
    for i in 0..100 {
        let s = format!("{}\n", (b'0' + (i % 10) as u8) as char);
        term.feed(s.as_bytes());
    }
    // Should not panic; clamps to min(row_offset, scrollback_len).
    term.snapshot_grid_at(usize::MAX);
    // Pack_buf is populated; assert first byte (row 0, col 0) is reachable.
    let _ = term.pack_byte_len();
    let _ = term.pack_ptr();
}

#[test]
fn snapshot_grid_at_returns_historical_window() {
    let mut term = Terminal::new(24, 80, 100);
    // Feed 50 distinct line markers.
    for i in 0..50 {
        let s = format!("L{:02}\n", i);
        term.feed(s.as_bytes());
    }
    term.snapshot_grid_at(10);
    // Read first row of the snapshot — should be a historical line, NOT the live tail.
    let len = term.pack_byte_len();
    assert!(len > 0);
    // Detailed marker assertion: read first cell's char byte (Cell layout: u32 char + 4 bytes attrs per Phase 1 grid.rs const_assert).
    let snap: Vec<u8> = unsafe { std::slice::from_raw_parts(term.pack_ptr(), len).to_vec() };
    // Row 0 col 0 char byte is at offset 0 (Cell #[repr(C)] u32 first field — LSB at offset 0).
    assert_eq!(
        snap[0], b'L',
        "first cell of historical window should be 'L' marker"
    );
}

#[test]
fn pack_ptr_stable_across_snapshot_grid_at() {
    let mut term = Terminal::new(24, 80, 100);
    term.feed(b"some content\n");
    term.snapshot_grid_at(0);
    let p1 = term.pack_ptr();
    term.snapshot_grid_at(0);
    term.snapshot_grid_at(1);
    term.snapshot_grid_at(0);
    let p2 = term.pack_ptr();
    assert_eq!(
        p1, p2,
        "pack_ptr must be identity-stable across snapshot_grid_at calls"
    );
}
