//! VT52 semantic layer.
//!
//! Owns `Scrollback` (grid + history ring), `Dirty` bitmap, cursor position,
//! bell_pending flag, host-bound reply buffer, and mode flags. Driven by
//! `vt52::Parser` via crate-visible callbacks.
//!
//! No wasm attrs here (D-20): module is pure Rust, testable as rlib.
//! Phase 2's `lib.rs` adds a thin wasm-bindgen wrapper around `Terminal`.

use crate::dirty::Dirty;
use crate::grid::Cell;
use crate::scrollback::Scrollback;
use crate::vt52::Parser;

/// Full VT52 terminal state. Composes grid+scrollback, dirty bitmap, cursor,
/// bell flag, host-reply accumulator, and mode flags.
pub struct Terminal {
    parser: Parser,
    scrollback: Scrollback,
    dirty: Dirty,
    cursor_row: u32,
    cursor_col: u32,
    bell_pending: bool,
    host_reply: Vec<u8>,
    // Phase 1 tracks these modes but does not change behavior based on them.
    // Phase 3/4 consumers may read them.
    graphics_mode: bool,
    alt_keypad: bool,
    hold_screen: bool,
}

impl Terminal {
    pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Self {
        Self {
            parser: Parser::new(),
            scrollback: Scrollback::new(rows as usize, cols as usize, scrollback_cap),
            dirty: Dirty::new(rows as usize),
            cursor_row: 0,
            cursor_col: 0,
            bell_pending: false,
            host_reply: Vec::new(),
            graphics_mode: false,
            alt_keypad: false,
            hold_screen: false,
        }
    }

    /// Hot path: process a chunk of bytes from the host; accumulate any
    /// host-bound reply (e.g. ESC Z -> ESC / K). Returns bytes the JS shell
    /// writes to `port.writable`. Typically empty.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8> {
        self.host_reply.clear();
        // Take the parser out of self briefly so Rust's borrow checker
        // allows us to pass `&mut self` as the Performer/dispatch target.
        let mut parser = std::mem::take(&mut self.parser);
        parser.feed(self, bytes);
        self.parser = parser;
        std::mem::take(&mut self.host_reply)
    }

    pub fn cursor(&self) -> (u32, u32) {
        (self.cursor_row, self.cursor_col)
    }
    pub fn rows(&self) -> u32 {
        self.scrollback.visible_rows() as u32
    }
    pub fn cols(&self) -> u32 {
        self.scrollback.cols() as u32
    }
    pub fn bell_pending(&self) -> bool {
        self.bell_pending
    }
    pub fn clear_bell(&mut self) {
        self.bell_pending = false;
    }

    pub fn grid(&self) -> &Scrollback {
        &self.scrollback
    }
    pub fn dirty(&self) -> &[u8] {
        self.dirty.as_slice()
    }
    pub fn clear_dirty(&mut self) {
        self.dirty.clear();
    }

    pub fn graphics_mode(&self) -> bool {
        self.graphics_mode
    }
    pub fn alt_keypad(&self) -> bool {
        self.alt_keypad
    }
    pub fn hold_screen(&self) -> bool {
        self.hold_screen
    }

    pub fn resize(&mut self, rows: u32, cols: u32) {
        self.scrollback.resize_grid(rows as usize, cols as usize);
        self.dirty.resize(rows as usize);
        self.dirty.mark_all();
        self.cursor_row = self.cursor_row.min(rows.saturating_sub(1));
        self.cursor_col = self.cursor_col.min(cols.saturating_sub(1));
    }

    pub fn resize_scrollback(&mut self, new_cap: usize) {
        self.scrollback.resize_scrollback(new_cap);
    }

    // --- Parser-callable dispatch methods ---

    pub(crate) fn print(&mut self, byte: u8) {
        let cols = self.scrollback.cols() as u32;
        let row = self.cursor_row as usize;
        let col = self.cursor_col as usize;
        // Bounds-safe write. If the cursor is at last col, we still write
        // there then leave cursor at last col (no auto-wrap in VT52 by default;
        // MicroBeast capture may reveal different behavior, record as follow-up).
        let row_ref = self.scrollback.row_mut(row);
        if col < row_ref.len() {
            row_ref.as_mut_slice()[col] = Cell::with_byte(byte);
        }
        self.dirty.mark(row);
        if self.cursor_col + 1 < cols {
            self.cursor_col += 1;
        }
    }

    pub(crate) fn execute_c0(&mut self, byte: u8) {
        match byte {
            0x07 => {
                // BEL
                self.bell_pending = true;
            }
            0x08 => {
                // BS
                self.cursor_col = self.cursor_col.saturating_sub(1);
            }
            0x09 => {
                // HT — advance to next multiple of 8; clamp at cols-1.
                let cols = self.scrollback.cols() as u32;
                let next = ((self.cursor_col / 8) + 1) * 8;
                self.cursor_col = next.min(cols.saturating_sub(1));
            }
            0x0A => {
                // LF — PARSER-07 finding: capture-01 shows CP/M emits LF-only.
                // Default `lf_implies_cr = true` — LF resets column AND advances row.
                self.line_feed();
                self.cursor_col = 0;
            }
            0x0D => {
                // CR — column to 0, row unchanged.
                self.cursor_col = 0;
            }
            _ => {
                // D-15: silent discard
            }
        }
    }

    pub(crate) fn cursor_up(&mut self) {
        if self.cursor_row > 0 {
            self.cursor_row -= 1;
        }
    }
    pub(crate) fn cursor_down(&mut self) {
        let max = self.scrollback.visible_rows() as u32;
        if self.cursor_row + 1 < max {
            self.cursor_row += 1;
        }
        // ESC B does NOT scroll at bottom per DEC VT52 (RESEARCH opcode table).
    }
    pub(crate) fn cursor_right(&mut self) {
        let max = self.scrollback.cols() as u32;
        if self.cursor_col + 1 < max {
            self.cursor_col += 1;
        }
    }
    pub(crate) fn cursor_left(&mut self) {
        if self.cursor_col > 0 {
            self.cursor_col -= 1;
        }
    }
    pub(crate) fn cursor_home(&mut self) {
        self.cursor_row = 0;
        self.cursor_col = 0;
    }
    pub(crate) fn reverse_lf(&mut self) {
        // ESC I: cursor up; if at top, scroll DOWN (insert blank row at top).
        if self.cursor_row > 0 {
            self.cursor_row -= 1;
        } else {
            // Shift visible rows down; blank the top.
            let visible_rows = self.scrollback.visible_rows();
            for r in (1..visible_rows).rev() {
                let src = self.scrollback.row(r - 1).clone();
                *self.scrollback.row_mut(r) = src;
            }
            self.scrollback.row_mut(0).clear();
            self.dirty.mark_all();
        }
    }
    pub(crate) fn erase_to_end_of_screen(&mut self) {
        let cols = self.scrollback.cols();
        let visible_rows = self.scrollback.visible_rows();
        let cursor_row = self.cursor_row as usize;
        let cursor_col = self.cursor_col as usize;
        // Current row from cursor to EOL
        self.scrollback.row_mut(cursor_row).clear_from(cursor_col);
        self.dirty.mark(cursor_row);
        // All subsequent rows fully cleared
        for r in (cursor_row + 1)..visible_rows {
            for c in 0..cols {
                self.scrollback.row_mut(r).as_mut_slice()[c] = Cell::BLANK;
            }
            self.dirty.mark(r);
        }
    }
    pub(crate) fn erase_to_end_of_line(&mut self) {
        let cursor_row = self.cursor_row as usize;
        let cursor_col = self.cursor_col as usize;
        self.scrollback.row_mut(cursor_row).clear_from(cursor_col);
        self.dirty.mark(cursor_row);
    }
    pub(crate) fn move_cursor(&mut self, row: u32, col: u32) {
        // Clamp both — parser should have already, but belt-and-braces.
        let max_row = self.scrollback.visible_rows() as u32;
        let max_col = self.scrollback.cols() as u32;
        self.cursor_row = row.min(max_row.saturating_sub(1));
        self.cursor_col = col.min(max_col.saturating_sub(1));
    }
    pub(crate) fn emit_identify_reply(&mut self) {
        // PARSER-05: ESC Z -> ESC / K (three bytes).
        self.host_reply.extend_from_slice(&[0x1B, b'/', b'K']);
    }

    // Mode toggles (Phase 1: tracked but no behavior change)
    pub(crate) fn enter_graphics_mode(&mut self) {
        self.graphics_mode = true;
    }
    pub(crate) fn exit_graphics_mode(&mut self) {
        self.graphics_mode = false;
    }
    pub(crate) fn enter_alt_keypad(&mut self) {
        self.alt_keypad = true;
    }
    pub(crate) fn exit_alt_keypad(&mut self) {
        self.alt_keypad = false;
    }
    pub(crate) fn enter_hold_screen(&mut self) {
        self.hold_screen = true;
    }
    pub(crate) fn exit_hold_screen(&mut self) {
        self.hold_screen = false;
    }

    // --- private helpers ---

    fn line_feed(&mut self) {
        let max = self.scrollback.visible_rows() as u32;
        if self.cursor_row + 1 < max {
            self.cursor_row += 1;
        } else {
            // At bottom: scroll. Scrollback.push_line appends a blank row
            // and evicts if over-cap. Visible cursor stays at the last row
            // (since the visible window is bottom-aligned).
            self.scrollback.push_line();
            // Every visible row has effectively moved up one; all dirty.
            self.dirty.mark_all();
            // cursor_row stays at max-1 because the visible window slides.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t() -> Terminal {
        Terminal::new(24, 80, 100)
    }

    #[test]
    fn new_cursor_at_origin_no_bell_no_reply() {
        let term = t();
        assert_eq!(term.cursor(), (0, 0));
        assert!(!term.bell_pending());
        assert_eq!(term.rows(), 24);
        assert_eq!(term.cols(), 80);
    }

    #[test]
    fn print_advances_cursor_and_writes_cell() {
        let mut term = t();
        let out = term.feed(b"ABC");
        assert_eq!(out, Vec::<u8>::new());
        assert_eq!(term.cursor(), (0, 3));
        let r = term.grid().row(0);
        assert_eq!(r.as_slice()[0].ch, b'A' as u32);
        assert_eq!(r.as_slice()[1].ch, b'B' as u32);
        assert_eq!(r.as_slice()[2].ch, b'C' as u32);
        assert_eq!(term.dirty()[0], 1);
    }

    #[test]
    fn bel_sets_bell_pending() {
        let mut term = t();
        term.feed(b"\x07");
        assert!(term.bell_pending());
        term.clear_bell();
        assert!(!term.bell_pending());
    }

    #[test]
    fn esc_a_moves_cursor_up_clamped() {
        let mut term = t();
        term.feed(b"\x1BY\x25\x20"); // move to (5, 0)
        term.feed(b"\x1BA");
        assert_eq!(term.cursor(), (4, 0));
        // At top, ESC A clamps
        term.feed(b"\x1BH"); // home
        term.feed(b"\x1BA");
        assert_eq!(term.cursor(), (0, 0));
    }

    #[test]
    fn esc_b_does_not_scroll_at_bottom() {
        let mut term = t();
        // Move to bottom row (23 for visible_rows=24)
        term.feed(b"\x1BY\x37\x20"); // row=23, col=0
        term.feed(b"\x1BB"); // cursor_down: should stay at 23
        assert_eq!(term.cursor(), (23, 0));
    }

    #[test]
    fn esc_c_moves_cursor_right() {
        let mut term = t();
        term.feed(b"\x1BC");
        assert_eq!(term.cursor(), (0, 1));
    }

    #[test]
    fn esc_c_clamps_at_last_column() {
        let mut term = t();
        term.feed(b"\x1BY\x20\x6F"); // (0, 79)
        term.feed(b"\x1BC");
        assert_eq!(term.cursor(), (0, 79));
    }

    #[test]
    fn esc_d_moves_cursor_left_clamped() {
        let mut term = t();
        term.feed(b"\x1BY\x20\x23"); // (0, 3)
        term.feed(b"\x1BD");
        assert_eq!(term.cursor(), (0, 2));
        // Clamp at 0
        term.feed(b"\x1BH");
        term.feed(b"\x1BD");
        assert_eq!(term.cursor(), (0, 0));
    }

    #[test]
    fn esc_y_six_edge_cases() {
        let mut term = t();
        term.feed(b"\x1BY\x20\x20");
        assert_eq!(term.cursor(), (0, 0));
        term.feed(b"\x1BY\x37\x6F");
        assert_eq!(term.cursor(), (23, 79));
        term.feed(b"\x1BY\x1F\x1F");
        assert_eq!(term.cursor(), (0, 0));
        term.feed(b"\x1BY\x7F\x7F");
        assert_eq!(term.cursor(), (23, 79));
        term.feed(b"\x1BY\x20\x6F");
        assert_eq!(term.cursor(), (0, 79));
        term.feed(b"\x1BY\x37\x20");
        assert_eq!(term.cursor(), (23, 0));
    }

    #[test]
    fn esc_h_home() {
        let mut term = t();
        term.feed(b"\x1BY\x25\x25");
        term.feed(b"\x1BH");
        assert_eq!(term.cursor(), (0, 0));
    }

    #[test]
    fn esc_i_reverse_lf_moves_cursor_up() {
        let mut term = t();
        term.feed(b"\x1BY\x25\x20"); // row 5, col 0
        term.feed(b"\x1BI");
        assert_eq!(term.cursor(), (4, 0));
    }

    #[test]
    fn esc_i_at_top_scrolls_down() {
        let mut term = t();
        // Put "X" at row 0, col 0
        term.feed(b"X");
        // Put "Y" at row 1, col 0
        term.feed(b"\x1BY\x21\x20Y");
        term.feed(b"\x1BH"); // home to (0, 0)
        term.feed(b"\x1BI"); // at top, should scroll down
        // After scroll-down, row 0 is blank, row 1 holds the old row 0 ('X')
        assert_eq!(term.cursor(), (0, 0));
        assert_eq!(term.grid().row(0).as_slice()[0], Cell::BLANK);
        assert_eq!(term.grid().row(1).as_slice()[0].ch, b'X' as u32);
    }

    #[test]
    fn esc_j_erases_from_cursor_to_end_of_screen() {
        let mut term = t();
        term.feed(b"ABCDE"); // fills (0,0..5) with ABCDE
        term.feed(b"\x1BY\x20\x22"); // move to (0, 2)
        term.feed(b"\x1BJ");
        let r = term.grid().row(0);
        assert_eq!(r.as_slice()[0].ch, b'A' as u32);
        assert_eq!(r.as_slice()[1].ch, b'B' as u32);
        assert_eq!(r.as_slice()[2], Cell::BLANK);
        assert_eq!(r.as_slice()[3], Cell::BLANK);
        assert_eq!(r.as_slice()[4], Cell::BLANK);
    }

    #[test]
    fn esc_k_erases_from_cursor_to_end_of_line_only() {
        let mut term = t();
        term.feed(b"ABCDE\x0A"); // row 0 has ABCDE; LF -> row 1
        term.feed(b"\x1BY\x21\x22"); // row=1, col=2
        term.feed(b"fgh"); // row 1 has _,_,'f','g','h'
        term.feed(b"\x1BY\x21\x23"); // row=1, col=3
        term.feed(b"\x1BK"); // erase row 1 from col 3 onward
        assert_eq!(term.grid().row(1).as_slice()[2].ch, b'f' as u32);
        assert_eq!(term.grid().row(1).as_slice()[3], Cell::BLANK);
        assert_eq!(term.grid().row(1).as_slice()[4], Cell::BLANK);
        // Row 0 ABCDE is UNCHANGED by ESC K on row 1
        assert_eq!(term.grid().row(0).as_slice()[0].ch, b'A' as u32);
        assert_eq!(term.grid().row(0).as_slice()[4].ch, b'E' as u32);
    }

    #[test]
    fn esc_z_returns_identify_reply() {
        let mut term = t();
        let out = term.feed(b"\x1BZ");
        assert_eq!(out, vec![0x1B, b'/', b'K']);
    }

    #[test]
    fn noop_sequences_do_not_move_cursor_or_reply() {
        let mut term = t();
        term.feed(b"\x1BY\x22\x23"); // move to (2, 3)
        let before_cursor = term.cursor();
        for noop in &[
            &b"\x1BF"[..],
            b"\x1BG",
            b"\x1B=",
            b"\x1B>",
            b"\x1B[",
            b"\x1B\\",
        ] {
            let out = term.feed(noop);
            assert_eq!(out, Vec::<u8>::new(), "noop {:?} produced host reply", noop);
            assert_eq!(term.cursor(), before_cursor, "noop {:?} moved cursor", noop);
        }
        // Mode flags have been toggled through on/off pairs; final state should match
        // the last toggle the parser saw. We don't assert final mode values — only
        // that they didn't affect cursor or reply (PARSER-04).
    }

    #[test]
    fn c0_bs_clamps_at_column_0() {
        let mut term = t();
        term.feed(b"AB\x08\x08\x08"); // print AB, BS x3 -> col underflow clamps at 0
        assert_eq!(term.cursor(), (0, 0));
    }

    #[test]
    fn c0_ht_advances_to_next_tab_stop_multiple_of_8() {
        let mut term = t();
        term.feed(b"\x09"); // from (0,0) -> (0,8)
        assert_eq!(term.cursor(), (0, 8));
        term.feed(b"abc"); // advance to (0,11)
        term.feed(b"\x09"); // -> (0,16)
        assert_eq!(term.cursor(), (0, 16));
    }

    #[test]
    fn c0_ht_clamps_at_last_column() {
        let mut term = t();
        term.feed(b"\x1BY\x20\x6A"); // move to (0, 74)
        term.feed(b"\x09"); // next tab would be 80, clamp to 79
        assert_eq!(term.cursor(), (0, 79));
    }

    #[test]
    fn c0_cr_returns_to_column_0_same_row() {
        let mut term = t();
        term.feed(b"ABCD\x0D");
        assert_eq!(term.cursor(), (0, 0));
        // Row unchanged — CR does NOT advance row on its own
    }

    #[test]
    fn c0_lf_advances_row_and_resets_column() {
        // PARSER-07: default lf_implies_cr = true.
        let mut term = t();
        term.feed(b"ABC\x0A");
        // (0, 3) -> LF -> (1, 0)  [not (1, 3), because lf_implies_cr=true]
        assert_eq!(term.cursor(), (1, 0));
    }

    #[test]
    fn c0_lf_at_bottom_scrolls_via_scrollback_push_line() {
        let mut term = Terminal::new(3, 4, 100);
        // Fill rows 0..2 with markers.
        term.feed(b"aaaa\x0A"); // row 0 = "aaaa"; LF -> row 1 col 0
        term.feed(b"bbbb\x0A"); // row 1 = "bbbb"; LF -> row 2 col 0
        term.feed(b"cccc"); // row 2 = "cccc"; cursor at (2, 3)
        // Now LF at row 2 (last row) — should push_line + slide visible window.
        term.feed(b"\x0A");
        // After scroll: row 0 is 'bbbb', row 1 is 'cccc', row 2 is blank.
        assert_eq!(term.grid().row(0).as_slice()[0].ch, b'b' as u32);
        assert_eq!(term.grid().row(1).as_slice()[0].ch, b'c' as u32);
        assert_eq!(term.grid().row(2).as_slice()[0], Cell::BLANK);
    }

    #[test]
    fn crlf_reaches_same_state_as_lf_only() {
        // PARSER-07 double-check: lf_implies_cr is behaviourally a no-op on CRLF
        // streams (CR already zeroed col, LF's col=0 assignment is a no-op).
        let mut a = Terminal::new(24, 80, 100);
        a.feed(b"ABC\x0D\x0ADEF");
        let mut b = Terminal::new(24, 80, 100);
        b.feed(b"ABC\x0ADEF"); // LF-only (CP/M convention)
        assert_eq!(a.cursor(), b.cursor());
        // row 1 cells match
        for c in 0..3 {
            assert_eq!(
                a.grid().row(1).as_slice()[c].ch,
                b.grid().row(1).as_slice()[c].ch
            );
        }
    }

    #[test]
    fn unknown_esc_letter_is_silent_discard() {
        let mut term = t();
        term.feed(b"\x1BY\x22\x23"); // (2, 3)
        let before = term.cursor();
        term.feed(b"\x1BX"); // ESC X is undefined in VT52 subset
        assert_eq!(term.cursor(), before);
    }

    #[test]
    fn feed_across_two_calls_matches_one_call() {
        // ESC Y split across feed() boundary
        let mut a = t();
        a.feed(b"\x1BY\x23\x45");
        let cursor_a = a.cursor();

        let mut b = t();
        b.feed(b"\x1BY");
        b.feed(b"\x23\x45");
        let cursor_b = b.cursor();

        assert_eq!(cursor_a, cursor_b);
    }

    #[test]
    fn resize_clamps_cursor_and_marks_all_dirty() {
        let mut term = Terminal::new(24, 80, 100);
        term.feed(b"\x1BY\x37\x6F"); // (23, 79)
        term.clear_dirty();
        term.resize(10, 40);
        assert_eq!(term.rows(), 10);
        assert_eq!(term.cols(), 40);
        assert_eq!(term.cursor(), (9, 39));
        // All rows dirty after resize
        for b in term.dirty() {
            assert_eq!(*b, 1);
        }
    }

    #[test]
    fn clear_dirty_zeroes_bitmap() {
        let mut term = t();
        term.feed(b"A");
        assert_eq!(term.dirty()[0], 1);
        term.clear_dirty();
        assert_eq!(term.dirty()[0], 0);
    }

    #[test]
    fn print_marks_dirty_at_current_row_only() {
        let mut term = t();
        term.feed(b"\x1BY\x25\x20"); // row 5, col 0
        term.clear_dirty();
        term.feed(b"A");
        assert_eq!(term.dirty()[5], 1);
        for (i, b) in term.dirty().iter().enumerate() {
            if i != 5 {
                assert_eq!(*b, 0, "row {} should not be dirty", i);
            }
        }
    }
}
