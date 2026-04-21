//! Identical test matrix for both parser prototypes — D-03 floor condition.
//!
//! Every test here must pass for BOTH `hand_rolled::Parser` and
//! `vte_path::Parser` before Plan 01-03 Task 2 (ADR-001) can be written.
//! If either prototype diverges, the failing prototype gets fixed first —
//! a broken prototype cannot be the subject of a readability judgment.

use super::harness::{assert_identical_across_splits, SpikeTerminal};
use super::{hand_rolled, vte_path};

fn run_hand_rolled(chunks: &[&[u8]]) -> SpikeTerminal {
    let mut term = SpikeTerminal::new(24, 80);
    let mut parser = hand_rolled::Parser::new();
    for chunk in chunks {
        parser.feed(&mut term, chunk);
    }
    term
}

fn run_vte(chunks: &[&[u8]]) -> SpikeTerminal {
    let mut term = SpikeTerminal::new(24, 80);
    let mut parser = vte_path::Parser::new();
    for chunk in chunks {
        parser.feed(&mut term, chunk);
    }
    term
}

// --- D-02 minimum-set opcode tests ---
//
// Each `both_produce!` generates ONE #[test] that runs both prototypes on
// identical input, asserts their final states match, then runs a
// sequence-specific `$check`. Identical-state assertion guards against
// silent divergence; per-test checks guard against both prototypes being
// identically wrong.

macro_rules! both_produce {
    ($name:ident, $bytes:expr, $check:expr) => {
        #[test]
        fn $name() {
            let hr = run_hand_rolled(&[$bytes]);
            let vt = run_vte(&[$bytes]);
            assert_eq!(hr, vt, "hand_rolled vs vte_path diverge on {:02X?}", $bytes);
            ($check)(&hr);
        }
    };
}

both_produce!(
    esc_a_cursor_up,
    &b"\x1BB\x1BA"[..], // down, then up -> back to row 0
    |t: &SpikeTerminal| assert_eq!(t.cursor_row, 0)
);
both_produce!(
    esc_b_cursor_down,
    &b"\x1BB"[..],
    |t: &SpikeTerminal| assert_eq!(t.cursor_row, 1)
);
both_produce!(
    esc_c_cursor_right,
    &b"\x1BC"[..],
    |t: &SpikeTerminal| assert_eq!(t.cursor_col, 1)
);
both_produce!(
    esc_d_cursor_left,
    &b"\x1BC\x1BD"[..],
    |t: &SpikeTerminal| assert_eq!(t.cursor_col, 0)
);

// ESC Y edges — PITFALLS.md #3 canonical cases.
both_produce!(
    esc_y_home,
    &b"\x1BY\x20\x20"[..],
    |t: &SpikeTerminal| {
        assert_eq!(t.cursor_row, 0);
        assert_eq!(t.cursor_col, 0);
    }
);
both_produce!(
    esc_y_bottom_right,
    &b"\x1BY\x37\x6F"[..],
    |t: &SpikeTerminal| {
        assert_eq!(t.cursor_row, 23);
        assert_eq!(t.cursor_col, 79);
    }
);
both_produce!(
    esc_y_underflow_clamps_to_zero,
    &b"\x1BY\x1F\x1F"[..],
    |t: &SpikeTerminal| {
        assert_eq!(t.cursor_row, 0);
        assert_eq!(t.cursor_col, 0);
    }
);
both_produce!(
    esc_y_overflow_clamps_to_max,
    &b"\x1BY\x7F\x7F"[..],
    |t: &SpikeTerminal| {
        assert_eq!(t.cursor_row, 23);
        assert_eq!(t.cursor_col, 79);
    }
);

#[test]
fn esc_j_erase_to_end_of_screen_both() {
    // Put AB at (0,0)+(0,1), back home, erase -> whole grid blank.
    let input = &b"\x1BY\x20\x20AB\x1BY\x20\x20\x1BJ"[..];
    let hr = run_hand_rolled(&[input]);
    let vt = run_vte(&[input]);
    assert_eq!(hr, vt);
    assert!(hr.grid.iter().all(|&b| b == 0x20));
}

#[test]
fn esc_k_erase_to_end_of_line_both() {
    // AB at (0,0)+(0,1); go (0,1); ESC K erases from (0,1) to end of row 0.
    let input = &b"\x1BY\x20\x20AB\x1BY\x20\x21\x1BK"[..];
    let hr = run_hand_rolled(&[input]);
    let vt = run_vte(&[input]);
    assert_eq!(hr, vt);
    assert_eq!(hr.grid[0], b'A'); // (0,0) survives
    assert_eq!(hr.grid[1], 0x20); // (0,1) erased
    assert_eq!(hr.grid[79], 0x20); // (0,79) erased
                                   // (1,0) never touched — still blank from init, also 0x20.
    assert_eq!(hr.grid[80], 0x20);
}

// --- Explicit cross-prototype equivalence tests ---
//
// These duplicate the comparison already embedded in `both_produce!` but
// make the grep-verifiable `assert_eq!(hr, vt, ...)` call sites visible in
// the raw source (the macro definition only shows once). More importantly,
// they exercise whole realistic sequences end-to-end rather than a single
// opcode at a time.

#[test]
fn combined_sequence_matches_between_prototypes() {
    // Printable + ESC Y + printable + ESC K + printable — a mini session.
    let input = &b"START\x1BY\x22\x24AB\x1BK\x1BY\x20\x20XY"[..];
    let hr = run_hand_rolled(&[input]);
    let vt = run_vte(&[input]);
    assert_eq!(hr, vt, "hand_rolled vs vte_path diverge on {:02X?}", input);
}

#[test]
fn repeated_cursor_moves_match_between_prototypes() {
    // Four cursor-down + two cursor-right then a home + printable.
    let input = &b"\x1BB\x1BB\x1BB\x1BB\x1BC\x1BC\x1BY\x20\x20Z"[..];
    let hr = run_hand_rolled(&[input]);
    let vt = run_vte(&[input]);
    assert_eq!(hr, vt, "hand_rolled vs vte_path diverge on {:02X?}", input);
}

#[test]
fn malformed_escape_ignored_identically() {
    // ESC followed by a non-D-02 byte (lowercase 'q'): both prototypes
    // silently discard per D-15, then the following printable lands at
    // column 0.
    let input = &b"\x1BqHi"[..];
    let hr = run_hand_rolled(&[input]);
    let vt = run_vte(&[input]);
    assert_eq!(hr, vt, "hand_rolled vs vte_path diverge on {:02X?}", input);
}

// --- Torn-chunk floor (D-03) ---
//
// Each sequence is split at every internal offset; both prototypes must
// produce state identical to the unsplit baseline at every split.

#[test]
fn torn_esc_a() {
    assert_identical_across_splits(b"\x1BA", run_hand_rolled);
    assert_identical_across_splits(b"\x1BA", run_vte);
}

#[test]
fn torn_esc_b() {
    assert_identical_across_splits(b"\x1BB", run_hand_rolled);
    assert_identical_across_splits(b"\x1BB", run_vte);
}

#[test]
fn torn_esc_c() {
    assert_identical_across_splits(b"\x1BC", run_hand_rolled);
    assert_identical_across_splits(b"\x1BC", run_vte);
}

#[test]
fn torn_esc_d() {
    assert_identical_across_splits(b"\x1BD", run_hand_rolled);
    assert_identical_across_splits(b"\x1BD", run_vte);
}

#[test]
fn torn_esc_j() {
    assert_identical_across_splits(b"\x1BJ", run_hand_rolled);
    assert_identical_across_splits(b"\x1BJ", run_vte);
}

#[test]
fn torn_esc_k() {
    assert_identical_across_splits(b"\x1BK", run_hand_rolled);
    assert_identical_across_splits(b"\x1BK", run_vte);
}

#[test]
fn torn_esc_y_all_three_splits() {
    // Four-byte sequence splits at ESC|Y r c, ESC Y|r c, ESC Y r|c.
    // The two interesting splits are ESC Y|r c (inside vte's esc_dispatch
    // boundary -> our EscYPhase must persist across feed() calls) and
    // ESC Y r|c (sub-state is AwaitingCol between calls).
    assert_identical_across_splits(b"\x1BY\x23\x45", run_hand_rolled);
    assert_identical_across_splits(b"\x1BY\x23\x45", run_vte);
}

#[test]
fn torn_mixed_printable_and_escape() {
    // "Hello" + ESC A + "World" — 11 bytes, 10 internal split points.
    // Exercises Ground -> put loop, ESC dispatch mid-stream, and return
    // to put loop, all across every internal split.
    assert_identical_across_splits(b"Hello\x1BAWorld", run_hand_rolled);
    assert_identical_across_splits(b"Hello\x1BAWorld", run_vte);
}

#[test]
fn torn_esc_y_then_text() {
    // ESC Y home + "Hi" — tests that the EscYPhase cleanly clears and the
    // next printable byte puts instead of being consumed as col.
    assert_identical_across_splits(b"\x1BY\x20\x20Hi", run_hand_rolled);
    assert_identical_across_splits(b"\x1BY\x20\x20Hi", run_vte);
}
