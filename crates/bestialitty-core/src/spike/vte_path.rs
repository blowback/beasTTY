//! `vte::Parser + Perform` path — ARCHITECTURE.md recommendation, prototype B.
//!
//! Drives Alacritty's [`vte::Parser`] with a minimal [`Perform`] impl. vte
//! owns the DFA and delivers callbacks per-action; our `Perform` impl has to
//! interpret them into [`SpikeTerminal`] mutations.
//!
//! ## ESC Y subtlety (load-bearing for the ADR)
//!
//! vte delivers `ESC A` / `ESC B` / ... / `ESC Y` / `ESC J` / `ESC K`
//! uniformly as a single [`Perform::esc_dispatch`] callback with the final
//! byte. That is clean for single-byte dispatches.
//!
//! But VT52's `ESC Y <row> <col>` is a three-byte sequence. vte's DFA does
//! NOT know about VT52's row/col tail — after `esc_dispatch(b'Y')` it
//! returns to Ground, then sees the row byte (e.g. `0x20`) as ordinary text
//! and delivers it via [`Perform::print`]. The col byte follows the same
//! way. **The VT52 multi-byte semantics have to be reconstructed in the
//! Perform impl** via a sub-state machine ([`EscYPhase`]) that intercepts
//! the two post-ESC-Y `print()` callbacks and routes them to `move_cursor`
//! instead of `put`.
//!
//! Because a chunk boundary can land BETWEEN `esc_dispatch(Y)` and the row
//! byte (or between row and col), [`EscYPhase`] must persist across
//! `feed()` calls. We keep it as a field on [`Parser`] and shuttle it in
//! and out of [`PerformTerm`] via `std::mem::replace`.
//!
//! Verified against vte-0.15.0 source (crates.io registry cache, 2026-04-21):
//! in `advance_esc`, byte `0x59` matches the `0x59..=0x5A` arm which calls
//! `esc_dispatch` and transitions back to `State::Ground` — see
//! `vte-0.15.0/src/lib.rs:360-363`.

use super::harness::{decode_esc_y_byte, SpikeTerminal};
use vte::{Params, Parser as VteParser, Perform};

/// Sub-state for ESC Y row/col interception inside the Perform impl.
///
/// Persisted on [`Parser`] across `feed()` calls — see module doc.
#[derive(Clone, Copy)]
enum EscYPhase {
    Idle,
    /// `ESC Y` seen; next printable byte is the row.
    AwaitingRow,
    /// `ESC Y <row>` seen; holds the raw row byte; next printable is the col.
    AwaitingCol(u8),
}

/// Per-feed Perform implementation. Holds a mutable borrow of the shared
/// [`SpikeTerminal`] plus the ESC Y sub-state (shuttled in from
/// [`Parser::feed`]). Non-`pub` — an internal detail of the vte adapter.
struct PerformTerm<'a> {
    term: &'a mut SpikeTerminal,
    esc_y: EscYPhase,
}

impl<'a> Perform for PerformTerm<'a> {
    fn print(&mut self, c: char) {
        match self.esc_y {
            EscYPhase::AwaitingRow => {
                self.esc_y = EscYPhase::AwaitingCol(c as u8);
            }
            EscYPhase::AwaitingCol(r) => {
                let row = decode_esc_y_byte(r, self.term.rows - 1);
                let col = decode_esc_y_byte(c as u8, self.term.cols - 1);
                self.term.move_cursor(row, col);
                self.esc_y = EscYPhase::Idle;
            }
            EscYPhase::Idle => {
                // vte's print() emits char, not byte — but VT52 is 8-bit.
                // Spike scope only treats printable ASCII as glyphs; other
                // code points silently discard (D-15).
                if (0x20..=0x7E).contains(&(c as u32)) {
                    self.term.put(c as u8);
                }
            }
        }
    }

    fn execute(&mut self, _byte: u8) {
        // D-02 scope excludes C0 behaviour entirely. A C0 byte arriving
        // mid-ESC-Y is a malformed stream; reset the sub-state so the
        // parser doesn't later misinterpret a fresh byte as row/col.
        self.esc_y = EscYPhase::Idle;
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, byte: u8) {
        match byte {
            b'A' => self.term.cursor_up(),
            b'B' => self.term.cursor_down(),
            b'C' => self.term.cursor_right(),
            b'D' => self.term.cursor_left(),
            b'J' => self.term.erase_to_end_of_screen(),
            b'K' => self.term.erase_to_end_of_line(),
            b'Y' => {
                self.esc_y = EscYPhase::AwaitingRow;
            }
            _ => { /* D-15: silent discard on out-of-D-02 escapes */ }
        }
    }

    // vte's Perform trait requires these methods to exist but VT52 does not
    // use CSI / OSC / DCS at all. Defaulted empty impls would work, but
    // listing them explicitly here is the POINT of the ADR comparison:
    // readers see the full surface a VT52-only client has to opt out of.
    fn csi_dispatch(&mut self, _p: &Params, _i: &[u8], _ig: bool, _a: char) {}
    fn hook(&mut self, _p: &Params, _i: &[u8], _ig: bool, _a: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_term: bool) {}
}

/// Parser owning vte's internal state plus the VT52-specific ESC Y
/// sub-state. Torn-chunk safety comes from (a) vte's own DFA for the
/// `ESC|Y` split and (b) our own `esc_y` field for the `Y|row|col` splits.
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

    pub fn feed(&mut self, term: &mut SpikeTerminal, bytes: &[u8]) {
        // Move the persisted sub-state into a fresh PerformTerm, run vte,
        // then move the updated sub-state back out. std::mem::replace keeps
        // the struct field well-defined across the call even if vte panics.
        let mut performer = PerformTerm {
            term,
            esc_y: std::mem::replace(&mut self.esc_y, EscYPhase::Idle),
        };
        self.inner.advance(&mut performer, bytes);
        self.esc_y = performer.esc_y;
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}
