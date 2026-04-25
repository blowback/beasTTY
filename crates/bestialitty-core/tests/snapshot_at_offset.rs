//! Phase 6 Plan 01 (Wave 0) — Stubs for Terminal::snapshot_grid_at(row_offset).
//!
//! Source: 06-PATTERNS.md §"crates/bestialitty-core/tests/snapshot_at_offset.rs".
//! 06-CONTEXT.md D-06 — out-of-range row_offset clamps to min(row_offset, scrollback_len).
//! All bodies are TODO until Plan 02-02 (Wave 1) lands the snapshot_grid_at API.

use bestialitty_core::terminal::Terminal;

#[test]
fn snapshot_grid_at_zero_matches_snapshot_grid() {
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid();
    // TODO Wave 1: call term.snapshot_grid_at(0) and assert pack_byte_len + first row bytes
    //              are byte-identical to the snapshot_grid() result above.
    let _ = &mut term;
}

#[test]
fn snapshot_grid_at_clamps_oversized_offset() {
    let mut term = Terminal::new(24, 80, 100);
    // TODO Wave 1: feed 100 line breaks to push 100 lines into scrollback.
    // TODO Wave 1: term.snapshot_grid_at(usize::MAX); assert no panic + first visible
    //              row matches the OLDEST retained row (clamped to scrollback start).
    let _ = &mut term;
}

#[test]
fn snapshot_grid_at_returns_historical_window() {
    let mut term = Terminal::new(24, 80, 100);
    // TODO Wave 1: feed 50 lines with markers '0'..'9' (cycle); call snapshot_grid_at(10);
    // TODO Wave 1: assert pack_buf rows match the markers [total - visible - 10 .. total - 10].
    let _ = &mut term;
}

#[test]
fn pack_ptr_stable_across_snapshot_grid_at() {
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid();
    let ptr1 = term.pack_ptr();
    // TODO Wave 1: call term.snapshot_grid_at(N) repeatedly; assert pack_ptr() is identity-stable
    //              after the first call (mirrors Phase 2 D-03 contract).
    let _ = ptr1;
}
