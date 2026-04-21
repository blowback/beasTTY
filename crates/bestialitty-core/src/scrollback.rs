//! VecDeque-based scrollback ring.
//!
//! - Default cap: 10_000 lines (D-11).
//! - Runtime-configurable via constructor arg + `resize_scrollback` (D-12).
//! - Oldest-row eviction is `VecDeque::pop_front` — O(1).
//! - Memory budget at default cap: 10_000 lines * 80 cols * 8 bytes/cell
//!   = 6.4 MB of cell data, plus VecDeque + Vec headers. Fits comfortably
//!   in any daily-driver browser session.
//!
//! The Scrollback holds BOTH the visible region (last `visible_rows` entries)
//! AND the historical tail (older entries up to `scrollback_cap`). Terminal
//! state cursor indexing goes into the visible region.

use std::collections::VecDeque;

use crate::grid::Row;

pub struct Scrollback {
    rows: VecDeque<Row>,
    cols: usize,
    visible_rows: usize,
    scrollback_cap: usize,
}

impl Scrollback {
    /// Create a new scrollback with `visible_rows` blank rows pre-allocated
    /// for the visible region and an empty historical tail. Cap is the
    /// MAX number of HISTORICAL (off-screen) rows retained.
    pub fn new(visible_rows: usize, cols: usize, scrollback_cap: usize) -> Self {
        let mut rows = VecDeque::with_capacity(visible_rows);
        for _ in 0..visible_rows {
            rows.push_back(Row::blank(cols));
        }
        Self {
            rows,
            cols,
            visible_rows,
            scrollback_cap,
        }
    }

    /// Push a new blank row at the bottom. Pops the oldest row from the front
    /// if total length exceeds `visible_rows + scrollback_cap`.
    pub fn push_line(&mut self) {
        self.rows.push_back(Row::blank(self.cols));
        let max_total = self.visible_rows + self.scrollback_cap;
        while self.rows.len() > max_total {
            self.rows.pop_front();
        }
    }

    /// Change the scrollback cap. If shrinking, truncate historical rows
    /// from the front until within the new cap. If growing, does nothing
    /// (we never retroactively fabricate history).
    pub fn resize_scrollback(&mut self, new_cap: usize) {
        self.scrollback_cap = new_cap;
        let max_total = self.visible_rows + new_cap;
        while self.rows.len() > max_total {
            self.rows.pop_front();
        }
    }

    /// Resize the visible grid. Growing adds blank rows at the bottom.
    /// Shrinking the row count does NOT evict — existing content stays in
    /// the scrollback tail. Cols change re-sizes every row.
    pub fn resize_grid(&mut self, new_visible_rows: usize, new_cols: usize) {
        if new_cols != self.cols {
            // Resize every existing row, preserving content where it fits.
            for row in self.rows.iter_mut() {
                row.0.resize(new_cols, crate::grid::Cell::BLANK);
            }
            self.cols = new_cols;
        }

        if new_visible_rows > self.visible_rows {
            // Grow: add blank rows at the bottom.
            let extra = new_visible_rows - self.visible_rows;
            for _ in 0..extra {
                self.rows.push_back(Row::blank(self.cols));
            }
        }
        // Shrinking visible_rows does NOT evict — content flows into history.
        // (The historical tail is capped independently via scrollback_cap.)
        self.visible_rows = new_visible_rows;

        // Re-enforce cap in case the historical tail + new visible overflows.
        let max_total = self.visible_rows + self.scrollback_cap;
        while self.rows.len() > max_total {
            self.rows.pop_front();
        }
    }

    /// Iterate the `visible_rows` bottom rows (newest at the end).
    pub fn visible(&self) -> impl Iterator<Item = &Row> {
        let total = self.rows.len();
        let start = total.saturating_sub(self.visible_rows);
        self.rows.iter().skip(start)
    }

    /// Mutable visible iterator — used by parser on writes.
    pub fn visible_mut(&mut self) -> impl Iterator<Item = &mut Row> {
        let total = self.rows.len();
        let start = total.saturating_sub(self.visible_rows);
        self.rows.iter_mut().skip(start)
    }

    /// Index into the visible region (0 = topmost visible row).
    pub fn row(&self, visible_idx: usize) -> &Row {
        let total = self.rows.len();
        let start = total.saturating_sub(self.visible_rows);
        &self.rows[start + visible_idx]
    }

    pub fn row_mut(&mut self, visible_idx: usize) -> &mut Row {
        let total = self.rows.len();
        let start = total.saturating_sub(self.visible_rows);
        &mut self.rows[start + visible_idx]
    }

    pub fn total_len(&self) -> usize {
        self.rows.len()
    }
    pub fn visible_rows(&self) -> usize {
        self.visible_rows
    }
    pub fn cols(&self) -> usize {
        self.cols
    }
    pub fn scrollback_cap(&self) -> usize {
        self.scrollback_cap
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::Cell;

    #[test]
    fn new_preallocates_visible_rows_only() {
        let sb = Scrollback::new(24, 80, 10_000);
        assert_eq!(sb.visible_rows(), 24);
        assert_eq!(sb.cols(), 80);
        assert_eq!(sb.scrollback_cap(), 10_000);
        assert_eq!(sb.total_len(), 24); // visible only, no history yet
    }

    #[test]
    fn push_line_below_cap_grows_total_len() {
        let mut sb = Scrollback::new(24, 80, 100);
        sb.push_line();
        assert_eq!(sb.total_len(), 25);
        sb.push_line();
        assert_eq!(sb.total_len(), 26);
    }

    #[test]
    fn push_line_at_cap_evicts_oldest() {
        let mut sb = Scrollback::new(2, 4, 2); // visible=2, cap=2, total_max=4
        // Mark each inserted row distinctively so we can see eviction order.
        // At start, rows[0..2] are the 2 blank visible rows.
        sb.row_mut(0).as_mut_slice()[0] = Cell::with_byte(b'A');
        sb.row_mut(1).as_mut_slice()[0] = Cell::with_byte(b'B');

        // push_line appends a blank 'C' row at the bottom; total=3 (still <= 4)
        sb.push_line();
        sb.row_mut(1).as_mut_slice()[0] = Cell::with_byte(b'C'); // now-visible bottom
        assert_eq!(sb.total_len(), 3);

        // push another; total=4 (== max)
        sb.push_line();
        sb.row_mut(1).as_mut_slice()[0] = Cell::with_byte(b'D');
        assert_eq!(sb.total_len(), 4);

        // push another; total would be 5, so pop_front evicts 'A'
        sb.push_line();
        sb.row_mut(1).as_mut_slice()[0] = Cell::with_byte(b'E');
        assert_eq!(sb.total_len(), 4);

        // The first surviving row (topmost) must be 'B' now — 'A' was evicted.
        // Rows in VecDeque order: [B, C, D, E]
        // visible window is the last 2: [D, E]. Historical tail is [B, C].
        // We verify by iterating all rows from the front.
        let first = sb.rows.front().unwrap();
        assert_eq!(
            first.as_slice()[0].ch,
            b'B' as u32,
            "oldest row should be 'B' after evicting 'A'"
        );
    }

    #[test]
    fn resize_scrollback_shrink_evicts_history() {
        let mut sb = Scrollback::new(2, 4, 100);
        // Push 50 historical lines
        for _ in 0..50 {
            sb.push_line();
        }
        assert_eq!(sb.total_len(), 52); // 2 visible + 50 history

        // Shrink cap to 10; total should become 2 + 10 = 12
        sb.resize_scrollback(10);
        assert_eq!(sb.total_len(), 12);
        assert_eq!(sb.scrollback_cap(), 10);
    }

    #[test]
    fn resize_scrollback_grow_does_not_fabricate_history() {
        let mut sb = Scrollback::new(2, 4, 5);
        for _ in 0..3 {
            sb.push_line();
        }
        assert_eq!(sb.total_len(), 5);

        sb.resize_scrollback(100);
        assert_eq!(sb.total_len(), 5); // no new rows
        assert_eq!(sb.scrollback_cap(), 100);
    }

    #[test]
    fn resize_grid_grow_visible_rows_adds_blank_rows() {
        let mut sb = Scrollback::new(2, 4, 100);
        sb.row_mut(0).as_mut_slice()[0] = Cell::with_byte(b'X');
        sb.row_mut(1).as_mut_slice()[0] = Cell::with_byte(b'Y');

        sb.resize_grid(4, 4); // grow visible from 2 to 4
        assert_eq!(sb.visible_rows(), 4);
        assert_eq!(sb.total_len(), 4);
        // Top two rows preserved
        assert_eq!(sb.row(0).as_slice()[0].ch, b'X' as u32);
        assert_eq!(sb.row(1).as_slice()[0].ch, b'Y' as u32);
        // Bottom two rows are blanks
        assert_eq!(sb.row(2).as_slice()[0], Cell::BLANK);
        assert_eq!(sb.row(3).as_slice()[0], Cell::BLANK);
    }

    #[test]
    fn resize_grid_change_cols_resizes_all_rows() {
        let mut sb = Scrollback::new(2, 4, 5);
        sb.resize_grid(2, 8);
        assert_eq!(sb.cols(), 8);
        assert_eq!(sb.row(0).len(), 8);
    }

    #[test]
    fn visible_iterator_yields_exactly_visible_rows() {
        let mut sb = Scrollback::new(3, 4, 5);
        for _ in 0..4 {
            sb.push_line();
        }
        // total=7 (3 visible + 4 history); visible() yields 3
        let count = sb.visible().count();
        assert_eq!(count, 3);
    }

    #[test]
    fn row_idx_0_is_topmost_visible() {
        let mut sb = Scrollback::new(2, 4, 5);
        // Push enough history to have a tail
        for _ in 0..3 {
            sb.push_line();
        }
        // Set the topmost visible row marker
        sb.row_mut(0).as_mut_slice()[0] = Cell::with_byte(b'T');
        sb.row_mut(1).as_mut_slice()[0] = Cell::with_byte(b'B');
        // The bottom row is index (visible_rows - 1) = 1
        assert_eq!(sb.row(0).as_slice()[0].ch, b'T' as u32);
        assert_eq!(sb.row(1).as_slice()[0].ch, b'B' as u32);
    }
}
