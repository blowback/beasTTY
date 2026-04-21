//! Hand-rolled VT52 DFA — STACK.md recommendation, prototype A.
//!
//! A four-state byte-streaming DFA covering the D-02 minimum set:
//!
//! ```text
//! Ground --[ESC]--> Escape --[A/B/C/D/J/K]--> Ground
//!                   Escape --[Y]-----------> CursorRow --[r]--> CursorCol(r) --[c]--> Ground
//!                   Escape --[other]-------> Ground  (D-15: silent discard)
//! Ground --[printable 0x20..=0x7E]--> Ground  (put byte)
//! Ground --[other]-------------------> Ground  (D-15: silent discard)
//! ```
//!
//! Every match arm returns a new state unconditionally — no loops, no
//! "scan forward for next byte", no hidden backtracking. This is the
//! Pitfall-2 (torn-chunk) safety guarantee made explicit.
//!
//! Readability note for the ADR: the whole dispatch table fits in one
//! `match self.state { ... }` block. ESC Y's row/col continuation is
//! encoded directly as states `CursorRow -> CursorCol(row)` rather than
//! via a separate callback indirection.

use super::harness::{decode_esc_y_byte, SpikeTerminal};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Escape,
    /// Received `ESC Y`, awaiting the row byte.
    CursorRow,
    /// Received `ESC Y <row>`, holding the raw row byte, awaiting the col byte.
    CursorCol(u8),
}

/// Hand-rolled byte-streaming DFA. Feed bytes; state persists across calls.
pub struct Parser {
    state: State,
}

impl Parser {
    pub fn new() -> Self {
        Self {
            state: State::Ground,
        }
    }

    /// Feed an arbitrary chunk of bytes. Torn-chunk safe: the only state
    /// across calls is `self.state`, which advances strictly one byte at a
    /// time through the DFA above.
    pub fn feed(&mut self, term: &mut SpikeTerminal, bytes: &[u8]) {
        for &b in bytes {
            self.state = match self.state {
                State::Ground => match b {
                    0x1B => State::Escape,
                    // Printable ASCII goes to the grid so mixed-run
                    // torn-chunk tests exercise both paths.
                    0x20..=0x7E => {
                        term.put(b);
                        State::Ground
                    }
                    // D-15: silent discard on C0 controls / high-bit bytes
                    // in spike scope. Plan 01-04 revisits C0 (BS/HT/LF/CR/BEL).
                    _ => State::Ground,
                },
                State::Escape => match b {
                    b'A' => {
                        term.cursor_up();
                        State::Ground
                    }
                    b'B' => {
                        term.cursor_down();
                        State::Ground
                    }
                    b'C' => {
                        term.cursor_right();
                        State::Ground
                    }
                    b'D' => {
                        term.cursor_left();
                        State::Ground
                    }
                    b'J' => {
                        term.erase_to_end_of_screen();
                        State::Ground
                    }
                    b'K' => {
                        term.erase_to_end_of_line();
                        State::Ground
                    }
                    b'Y' => State::CursorRow,
                    // D-15: silent discard on anything else (including a
                    // stray second ESC — we return to Ground, not Escape,
                    // because the first ESC's intent is considered lost).
                    _ => State::Ground,
                },
                State::CursorRow => State::CursorCol(b),
                State::CursorCol(r) => {
                    let row = decode_esc_y_byte(r, term.rows - 1);
                    let col = decode_esc_y_byte(b, term.cols - 1);
                    term.move_cursor(row, col);
                    State::Ground
                }
            };
        }
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}
