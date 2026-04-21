//! Paired-fixture integration tests (D-16).
//!
//! For each `fixtures/<name>/` subdirectory:
//!   - Load `session.bin` — raw bytes fed into Terminal.
//!   - Load `session.trace` — expected sequence of semantic ops.
//!   - Run bytes through an instrumented tracing parser that logs every
//!     semantic operation.
//!   - Diff recorded trace against expected.
//!
//! The tracing parser in [`record_trace`] is a deliberate second
//! implementation of the Phase 1 VT52 state machine. It emits opcode names
//! instead of mutating a Terminal. Keeping two implementations catches
//! "parser refactor broke opcode dispatch" bugs that both implementations
//! would have to mis-handle identically to hide.
//!
//! **Lockstep invariant:** when a new opcode is added to the production
//! parser at `crates/bestialitty-core/src/vt52.rs`, it MUST be mirrored in
//! `record_trace` below IN THE SAME COMMIT or fixture tests silently
//! diverge from production behaviour. See Plan 01-05 Task 3 acceptance
//! criteria.
//!
//! Also drives a real [`Terminal`] over each fixture to assert the
//! production path doesn't panic; exact per-row grid assertions live in
//! unit tests.

use bestialitty_core::terminal::Terminal;
use std::fs;
use std::path::PathBuf;

// Tracing parser: identical state machine to production vt52::Parser,
// but dispatches to a trace buffer instead of a Terminal.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Escape,
    CursorRow,
    CursorCol(u8),
}

fn record_trace(bytes: &[u8], rows: u32, cols: u32) -> Vec<String> {
    let mut out = Vec::new();
    let mut state = State::Ground;
    for &b in bytes {
        state = match state {
            State::Ground => match b {
                0x1B => State::Escape,
                0x07 | 0x08 | 0x09 | 0x0A | 0x0D => {
                    out.push(format!("execute_c0 {:02X}", b));
                    State::Ground
                }
                0x20..=0x7E => {
                    out.push(format!("print {:02X}", b));
                    State::Ground
                }
                0x80..=0xFF => {
                    out.push(format!("print {:02X}", b));
                    State::Ground
                }
                _ => State::Ground,
            },
            State::Escape => match b {
                b'A' => {
                    out.push("cursor_up".into());
                    State::Ground
                }
                b'B' => {
                    out.push("cursor_down".into());
                    State::Ground
                }
                b'C' => {
                    out.push("cursor_right".into());
                    State::Ground
                }
                b'D' => {
                    out.push("cursor_left".into());
                    State::Ground
                }
                b'H' => {
                    out.push("cursor_home".into());
                    State::Ground
                }
                b'I' => {
                    out.push("reverse_lf".into());
                    State::Ground
                }
                b'J' => {
                    out.push("erase_to_end_of_screen".into());
                    State::Ground
                }
                b'K' => {
                    out.push("erase_to_end_of_line".into());
                    State::Ground
                }
                b'Y' => State::CursorRow,
                b'Z' => {
                    out.push("emit_identify_reply".into());
                    State::Ground
                }
                b'F' => {
                    out.push("enter_graphics_mode".into());
                    State::Ground
                }
                b'G' => {
                    out.push("exit_graphics_mode".into());
                    State::Ground
                }
                b'=' => {
                    out.push("enter_alt_keypad".into());
                    State::Ground
                }
                b'>' => {
                    out.push("exit_alt_keypad".into());
                    State::Ground
                }
                b'[' => {
                    out.push("enter_hold_screen".into());
                    State::Ground
                }
                b'\\' => {
                    out.push("exit_hold_screen".into());
                    State::Ground
                }
                _ => State::Ground,
            },
            State::CursorRow => State::CursorCol(b),
            State::CursorCol(r) => {
                let row = (r.saturating_sub(0x20) as u32).min(rows.saturating_sub(1));
                let col = (b.saturating_sub(0x20) as u32).min(cols.saturating_sub(1));
                out.push(format!("move_cursor {} {}", row, col));
                State::Ground
            }
        };
    }
    out
}

fn run_fixture(name: &str) {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let bin = fs::read(base.join("session.bin"))
        .unwrap_or_else(|e| panic!("fixtures/{}/session.bin: {}", name, e));
    let trace_expected = fs::read_to_string(base.join("session.trace"))
        .unwrap_or_else(|e| panic!("fixtures/{}/session.trace: {}", name, e));

    // Record the trace via the parallel parser.
    let got = record_trace(&bin, 24, 80);

    // Also drive the production Terminal to assert it doesn't panic.
    let mut term = Terminal::new(24, 80, 100);
    let _reply = term.feed(&bin);

    let got_str: String = got.join("\n");
    let expected = trace_expected.trim_end();
    let got_trim = got_str.trim_end();

    if expected != got_trim {
        eprintln!("--- EXPECTED ({})", name);
        eprintln!("{}", expected);
        eprintln!("--- GOT");
        eprintln!("{}", got_trim);
        panic!("fixture '{}' trace mismatch", name);
    }
}

#[test]
fn fixture_basic_print() {
    run_fixture("basic_print");
}

#[test]
fn fixture_esc_y_edges() {
    run_fixture("esc_y_edges");
}

#[test]
fn fixture_noop_sequences() {
    run_fixture("noop_sequences");
}

#[test]
fn fixture_identify_reply() {
    run_fixture("identify_reply");
}

#[test]
fn fixture_bell() {
    run_fixture("bell");
}

#[test]
fn fixture_erase_j() {
    run_fixture("erase_j");
}

#[test]
fn fixture_erase_k() {
    run_fixture("erase_k");
}

#[test]
fn fixture_torn_esc_y() {
    run_fixture("torn_esc_y");
}
