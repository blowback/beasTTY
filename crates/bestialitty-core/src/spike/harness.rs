//! Shared state + test helpers used by BOTH parser prototypes.
//!
//! The contract is simple: both [`crate::spike::hand_rolled::Parser`] and
//! [`crate::spike::vte_path::Parser`] mutate a [`SpikeTerminal`] by invoking
//! its methods. Because the mutation surface is identical, the torn-chunk
//! comparison in `tests.rs` is a straight `assert_eq!` on final state.
//!
//! Scope is deliberately tiny — the D-02 7-sequence set only. No scrollback,
//! no dirty bitmap, no bell, no host reply accumulator for real sequences.
//! Plan 01-04 owns all of that. Keeping the spike lean means the ADR-001
//! readability judgment is on the parser dispatch code itself, not on
//! incidental state-management choices.

/// Minimal terminal state. Both prototypes mutate this via the methods below.
///
/// `grid` is row-major: `grid[row * cols + col]`. Blanks are encoded as
/// `0x20` (ASCII space) so erase operations are a simple fill. `host_reply`
/// exists for API symmetry with the eventual production `Terminal` but stays
/// empty across the D-02 spike set (ESC Z, the only reply-generating
/// sequence in Phase 1, is deferred to Plan 01-04).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpikeTerminal {
    pub rows: u32,
    pub cols: u32,
    pub cursor_row: u32,
    pub cursor_col: u32,
    pub grid: Vec<u8>,
    pub host_reply: Vec<u8>,
}

impl SpikeTerminal {
    pub fn new(rows: u32, cols: u32) -> Self {
        Self {
            rows,
            cols,
            cursor_row: 0,
            cursor_col: 0,
            grid: vec![0x20; (rows * cols) as usize],
            host_reply: Vec::new(),
        }
    }

    /// Write a printable byte at the cursor and advance one column.
    ///
    /// At the right margin the cursor stays put (no auto-wrap in spike scope —
    /// VT52 auto-wrap is a Plan 01-04 concern).
    pub fn put(&mut self, byte: u8) {
        let idx = (self.cursor_row * self.cols + self.cursor_col) as usize;
        if idx < self.grid.len() {
            self.grid[idx] = byte;
            if self.cursor_col + 1 < self.cols {
                self.cursor_col += 1;
            }
        }
    }

    pub fn cursor_up(&mut self) {
        self.cursor_row = self.cursor_row.saturating_sub(1);
    }

    pub fn cursor_down(&mut self) {
        self.cursor_row = (self.cursor_row + 1).min(self.rows - 1);
    }

    pub fn cursor_right(&mut self) {
        self.cursor_col = (self.cursor_col + 1).min(self.cols - 1);
    }

    pub fn cursor_left(&mut self) {
        self.cursor_col = self.cursor_col.saturating_sub(1);
    }

    pub fn move_cursor(&mut self, row: u32, col: u32) {
        self.cursor_row = row.min(self.rows - 1);
        self.cursor_col = col.min(self.cols - 1);
    }

    pub fn erase_to_end_of_screen(&mut self) {
        let start = (self.cursor_row * self.cols + self.cursor_col) as usize;
        for b in &mut self.grid[start..] {
            *b = 0x20;
        }
    }

    pub fn erase_to_end_of_line(&mut self) {
        let start = (self.cursor_row * self.cols + self.cursor_col) as usize;
        let row_end = ((self.cursor_row + 1) * self.cols) as usize;
        let end = row_end.min(self.grid.len());
        for b in &mut self.grid[start..end] {
            *b = 0x20;
        }
    }
}

/// Decode a single ESC Y row-or-col byte — **PITFALLS.md #3 canonical formula**.
///
/// VT52 direct cursor addressing uses raw bytes biased by `0x20` (space).
/// Row 0 == byte `0x20`, row 23 == byte `0x37`. Bytes below `0x20` underflow
/// to 0 via `saturating_sub`; bytes above the addressable max clamp down via
/// `.min(max)`. Both clamps are deliberate:
///
/// - `saturating_sub(0x20)` prevents the unsigned wraparound that shipped
///   as a real bug in mintty (#1299) for years.
/// - `.min(max)` caps MicroBeast host bugs that send byte `0x7F` when they
///   meant something less surprising.
///
/// Both prototypes call this verbatim so there is exactly one decoder to
/// audit and exactly one place where the bias lives.
pub fn decode_esc_y_byte(raw: u8, max: u32) -> u32 {
    (raw.saturating_sub(0x20) as u32).min(max)
}

/// Assert that `make_run` produces identical [`SpikeTerminal`] state whether
/// `bytes` is fed as one chunk or as `(a, b)` at every internal split offset.
///
/// The caller provides a closure that takes `&[&[u8]]` (list of chunks to
/// feed in order) and returns the resulting [`SpikeTerminal`]. This is the
/// D-03 floor condition: if either prototype's closure produces different
/// state for ANY split, the test fails and Plan 01-03 Task 2 cannot proceed.
///
/// For `bytes.len() == N`, this runs `N` total parses (1 baseline + `N-1`
/// torn). With N up to ~16 for the biggest D-02 test, that's trivial.
pub fn assert_identical_across_splits<F>(bytes: &[u8], make_run: F)
where
    F: Fn(&[&[u8]]) -> SpikeTerminal,
{
    let baseline = make_run(&[bytes]);
    for split in 1..bytes.len() {
        let (a, b) = bytes.split_at(split);
        let torn = make_run(&[a, b]);
        assert_eq!(
            baseline, torn,
            "torn-chunk state mismatch: bytes={:02X?} split_at={}",
            bytes, split
        );
    }
}
