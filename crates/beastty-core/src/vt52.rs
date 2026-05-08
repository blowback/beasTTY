//! VT52 parser — `vte::Parser` + `Perform` impl per ADR-001.
//!
//! vte owns the byte-streaming state machine and torn-chunk safety; our
//! `Perform` impl maps dispatch events to [`Terminal`] callbacks. This is
//! the winning strategy from ADR-001 (`.planning/decisions/ADR-001-parser-strategy.md`):
//! we chose it over the hand-rolled DFA on correctness-by-authoring grounds
//! (vte has been exercised by Alacritty's user base since 2017), not bundle
//! size. Phase 2's wasm-pack build will measure the bundle delta and may
//! reopen the ADR if it overshoots 20 KB gzipped.
//!
//! ## ESC Y subtlety (load-bearing)
//!
//! vte's state machine does NOT model VT52's `ESC Y <row> <col>` as a single
//! three-byte sequence. vte delivers `esc_dispatch(byte='Y')` then returns to
//! Ground, treating the row and column bytes as ordinary `print(char)`
//! callbacks. We reconstruct the VT52 semantics via an [`EscYPhase`] sub-state
//! that intercepts the next two `print` calls and routes them to
//! `Terminal::move_cursor`.
//!
//! Because a chunk boundary can land BETWEEN `esc_dispatch(Y)` and the row
//! byte (or between row and col), the sub-state lives on [`Parser`] itself
//! and is shuttled in and out of the transient `PerformImpl` via
//! `std::mem::replace` — the same pattern the Plan 01-03 spike verified
//! torn-safe across every internal split of `ESC Y <row> <col>`.
//!
//! Verified against vte-0.15.0 source (crates.io registry cache, 2026-04-21):
//! in `advance_esc`, byte `0x59` matches the `0x59..=0x5A` arm which calls
//! `esc_dispatch` and transitions back to `State::Ground` — see
//! `vte-0.15.0/src/lib.rs:360-363`.
//!
//! ## D-20 wasm-free
//!
//! No `wasm_bindgen` / `web_sys` / `js_sys` attrs here; this module is pure
//! logic. The Phase 2 wasm boundary wraps `Terminal` in `lib.rs`, not here.

use crate::terminal::Terminal;
use vte::{Params, Parser as VteParser, Perform};

/// ESC Y row/col sub-state. Persists across [`Parser::feed`] calls.
#[derive(Clone, Copy)]
enum EscYPhase {
    Idle,
    /// `ESC Y` seen; next printable byte is the row.
    AwaitingRow,
    /// `ESC Y <row>` seen; holds the raw row byte; next printable is the col.
    AwaitingCol(u8),
}

/// Per-feed Perform implementation. Holds a mutable borrow of the `Terminal`
/// plus the ESC Y sub-state (shuttled in from [`Parser::feed`]).
struct PerformImpl<'a> {
    term: &'a mut Terminal,
    esc_y: EscYPhase,
}

impl<'a> Perform for PerformImpl<'a> {
    fn print(&mut self, c: char) {
        match self.esc_y {
            EscYPhase::AwaitingRow => {
                // vte gives us `char`; the VT52 byte stream is 8-bit, but the
                // row byte is in the `0x20..=0x7F` band where char == byte.
                self.esc_y = EscYPhase::AwaitingCol(c as u8);
            }
            EscYPhase::AwaitingCol(r) => {
                let rows = self.term.rows();
                let cols = self.term.cols();
                // PITFALLS.md #3 canonical clamp: saturating_sub(0x20).min(max).
                let row = ((r.saturating_sub(0x20)) as u32).min(rows.saturating_sub(1));
                let col = ((c as u8).saturating_sub(0x20) as u32).min(cols.saturating_sub(1));
                self.term.move_cursor(row, col);
                self.esc_y = EscYPhase::Idle;
            }
            EscYPhase::Idle => {
                // vte's `print` is chars; VT52 is 8-bit. Cast back to the raw
                // byte for any char that fits in one byte. Higher codepoints
                // cannot arise from a byte stream vte was driven by.
                let b = c as u32;
                if b < 0x100 {
                    self.term.print(b as u8);
                }
            }
        }
    }

    fn execute(&mut self, byte: u8) {
        // VT52 ESC Y consumes the NEXT TWO raw bytes unconditionally, including
        // bytes in the C0 range (0x00..=0x1F) — PITFALLS.md #3's underflow clamp
        // IS the only defence against malformed row/col bytes. vte funnels
        // `0x00..=0x1F` through `execute` (not `print`), so we must intercept
        // them here when in an ESC Y sub-state, or underflow clamps never fire.
        match self.esc_y {
            EscYPhase::AwaitingRow => {
                self.esc_y = EscYPhase::AwaitingCol(byte);
                return;
            }
            EscYPhase::AwaitingCol(r) => {
                let rows = self.term.rows();
                let cols = self.term.cols();
                let row = ((r.saturating_sub(0x20)) as u32).min(rows.saturating_sub(1));
                let col = (byte.saturating_sub(0x20) as u32).min(cols.saturating_sub(1));
                self.term.move_cursor(row, col);
                self.esc_y = EscYPhase::Idle;
                return;
            }
            EscYPhase::Idle => {
                // Normal path: dispatch C0 to Terminal.
            }
        }
        self.term.execute_c0(byte);
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, byte: u8) {
        // Any intermediate ESC dispatch invalidates a half-received ESC Y.
        self.esc_y = EscYPhase::Idle;
        match byte {
            b'A' => self.term.cursor_up(),
            b'B' => self.term.cursor_down(),
            b'C' => self.term.cursor_right(),
            b'D' => self.term.cursor_left(),
            b'H' => self.term.cursor_home(),
            b'I' => self.term.reverse_lf(),
            b'J' => self.term.erase_to_end_of_screen(),
            b'K' => self.term.erase_to_end_of_line(),
            b'Y' => {
                self.esc_y = EscYPhase::AwaitingRow;
            }
            b'Z' => self.term.emit_identify_reply(),
            b'F' => self.term.enter_graphics_mode(),
            b'G' => self.term.exit_graphics_mode(),
            b'=' => self.term.enter_alt_keypad(),
            b'>' => self.term.exit_alt_keypad(),
            b'[' => self.term.enter_hold_screen(),
            b'\\' => self.term.exit_hold_screen(),
            _ => {
                // D-15: silent discard on out-of-subset escapes.
                // A dev-only trace-malformed feature ring buffer could log
                // this; Plan 01 reserves the feature but Phase 1 does not
                // populate it.
            }
        }
    }

    // vte's Perform trait requires these for CSI / DCS / OSC. VT52 uses none of
    // them. Empty impls with `debug_assert!` would be louder in dev builds, but
    // vte's `advance` DOES call them speculatively on malformed input streams;
    // so we silently swallow to honour D-15.
    fn csi_dispatch(&mut self, _p: &Params, _i: &[u8], _ig: bool, _a: char) {}
    fn hook(&mut self, _p: &Params, _i: &[u8], _ig: bool, _a: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_term: bool) {}
}

/// Parser owning vte's internal state plus the VT52-specific ESC Y sub-state.
/// Torn-chunk safety comes from (a) vte's own DFA for the `ESC | Y` split and
/// (b) our own `esc_y` field for the `Y | row | col` splits.
pub struct Parser {
    inner: VteParser,
    esc_y: EscYPhase,
}

impl Parser {
    pub fn new() -> Self {
        Self {
            inner: VteParser::new(),
            esc_y: EscYPhase::Idle,
        }
    }

    /// Feed `bytes` into the parser, dispatching to `term`.
    ///
    /// `std::mem::replace` shuttles the persisted ESC Y sub-state into the
    /// transient `PerformImpl` and back out, so the Parser field remains
    /// well-defined even if vte panics mid-advance.
    pub fn feed(&mut self, term: &mut Terminal, bytes: &[u8]) {
        let esc_y = std::mem::replace(&mut self.esc_y, EscYPhase::Idle);
        let mut performer = PerformImpl { term, esc_y };
        self.inner.advance(&mut performer, bytes);
        self.esc_y = performer.esc_y;
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use crate::terminal::Terminal;

    fn run_chunks(chunks: &[&[u8]]) -> Terminal {
        let mut term = Terminal::new(24, 80, 100);
        for c in chunks {
            term.feed(c);
        }
        term
    }

    fn assert_identical_across_splits(bytes: &[u8]) {
        let baseline = run_chunks(&[bytes]);
        for split in 1..bytes.len() {
            let (a, b) = bytes.split_at(split);
            let torn = run_chunks(&[a, b]);
            assert_eq!(
                baseline.cursor(),
                torn.cursor(),
                "cursor mismatch for {:02X?} split at {}",
                bytes,
                split
            );
            assert_eq!(
                baseline.bell_pending(),
                torn.bell_pending(),
                "bell mismatch for {:02X?} split at {}",
                bytes,
                split
            );
            for r in 0..(baseline.rows() as usize) {
                let ba = baseline.grid().row(r);
                let bb = torn.grid().row(r);
                assert_eq!(
                    ba.as_slice(),
                    bb.as_slice(),
                    "grid row {} mismatch for {:02X?} split at {}",
                    r,
                    bytes,
                    split
                );
            }
        }
    }

    #[test]
    fn torn_esc_a() {
        assert_identical_across_splits(b"\x1BA");
    }
    #[test]
    fn torn_esc_b() {
        assert_identical_across_splits(b"\x1BB");
    }
    #[test]
    fn torn_esc_c() {
        assert_identical_across_splits(b"\x1BC");
    }
    #[test]
    fn torn_esc_d() {
        assert_identical_across_splits(b"\x1BD");
    }
    #[test]
    fn torn_esc_h() {
        assert_identical_across_splits(b"\x1BH");
    }
    #[test]
    fn torn_esc_i() {
        assert_identical_across_splits(b"\x1BI");
    }
    #[test]
    fn torn_esc_j() {
        assert_identical_across_splits(b"\x1BJ");
    }
    #[test]
    fn torn_esc_k() {
        assert_identical_across_splits(b"\x1BK");
    }
    #[test]
    fn torn_esc_z() {
        assert_identical_across_splits(b"\x1BZ");
    }
    #[test]
    fn torn_esc_f() {
        assert_identical_across_splits(b"\x1BF");
    }
    #[test]
    fn torn_esc_g() {
        assert_identical_across_splits(b"\x1BG");
    }
    #[test]
    fn torn_esc_eq() {
        assert_identical_across_splits(b"\x1B=");
    }
    #[test]
    fn torn_esc_gt() {
        assert_identical_across_splits(b"\x1B>");
    }
    #[test]
    fn torn_esc_open_bracket() {
        assert_identical_across_splits(b"\x1B[");
    }
    #[test]
    fn torn_esc_backslash() {
        assert_identical_across_splits(b"\x1B\\");
    }
    #[test]
    fn torn_esc_y_three_internal_splits() {
        assert_identical_across_splits(b"\x1BY\x23\x45");
    }
    #[test]
    fn torn_mixed_printable_and_escape() {
        assert_identical_across_splits(b"Hello\x1BAWorld");
    }
    #[test]
    fn torn_printable_cr_lf() {
        assert_identical_across_splits(b"AB\x0D\x0ACD");
    }
    #[test]
    fn torn_consecutive_multi_byte() {
        assert_identical_across_splits(b"\x1BY\x23\x45\x1BY\x20\x20");
    }
    #[test]
    fn torn_esc_y_at_every_edge() {
        assert_identical_across_splits(b"\x1BY\x20\x20"); // (0,0)
        assert_identical_across_splits(b"\x1BY\x37\x6F"); // (23,79)
        assert_identical_across_splits(b"\x1BY\x1F\x1F"); // underflow
        assert_identical_across_splits(b"\x1BY\x7F\x7F"); // overflow
    }

    // Targeted unit tests (non-torn) — these duplicate terminal.rs coverage
    // but assert the parser path specifically.

    #[test]
    fn parser_dispatches_esc_z_via_feed() {
        let mut term = Terminal::new(24, 80, 100);
        let out = term.feed(b"\x1BZ");
        assert_eq!(out, vec![0x1B, b'/', b'K']);
    }

    #[test]
    fn parser_silently_discards_unknown_esc() {
        let mut term = Terminal::new(24, 80, 100);
        term.feed(b"\x1BY\x22\x23");
        let before = term.cursor();
        term.feed(b"\x1BX");
        assert_eq!(term.cursor(), before);
    }

    #[test]
    fn parser_handles_bel_via_execute() {
        let mut term = Terminal::new(24, 80, 100);
        term.feed(b"\x07");
        assert!(term.bell_pending());
    }

    #[test]
    fn esc_y_underflow_clamps_to_zero() {
        let mut term = Terminal::new(24, 80, 100);
        term.feed(b"\x1BY\x1F\x1F");
        assert_eq!(term.cursor(), (0, 0));
    }
}
