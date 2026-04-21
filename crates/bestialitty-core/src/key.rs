//! PC keyboard -> VT52 byte encoder.
//!
//! Stateless, pure function: `encode(KeyEvent) -> Vec<u8>`.
//!
//! - Arrow keys map to ESC A/B/C/D (the same bytes the parser recognizes).
//! - Ctrl-letter (A-Z with ctrl held) maps to 0x01..0x1A.
//! - Ctrl-@, Ctrl-[, Ctrl-\\, Ctrl-], Ctrl-^, Ctrl-_ cover the rest of 0x00-0x1F.
//! - Printable ASCII without ctrl passes through unchanged.
//! - Enter/Tab/Backspace/Escape produce CR/HT/BS/ESC bytes.
//! - Keypad digits and symbols produce their plain ASCII form in Phase 1;
//!   mode-aware keypad (ESC = / ESC >) is Phase 4's problem per D-13.
//!
//! No browser APIs. No DOM. Phase 4 owns the DOM-event -> `KeyEvent` packing.

/// What key was pressed. Holds raw bytes for character keys; named variants
/// for keys that need special handling.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeyCode {
    /// Any printable or character key. Raw ASCII byte (case-preserved).
    Char(u8),
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Enter,
    Tab,
    Backspace,
    Escape,
    /// 0..9
    KeypadDigit(u8),
    KeypadEnter,
    KeypadComma,
    KeypadMinus,
    KeypadDot,
}

/// Modifier keys held at the time of the keypress.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub meta: bool,
}

impl Modifiers {
    /// Convenience: no modifiers held.
    pub const NONE: Modifiers = Modifiers {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
    };

    pub const CTRL: Modifiers = Modifiers {
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
    };
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct KeyEvent {
    pub code: KeyCode,
    pub mods: Modifiers,
}

impl KeyEvent {
    pub fn new(code: KeyCode) -> Self {
        KeyEvent {
            code,
            mods: Modifiers::NONE,
        }
    }
    pub fn with_ctrl(code: KeyCode) -> Self {
        KeyEvent {
            code,
            mods: Modifiers::CTRL,
        }
    }
}

/// Encode a key event into the VT52 byte sequence to send to the host.
///
/// Pure function: same input always produces the same output.
/// Allocates a small `Vec<u8>` per call (cold path; humans type slowly).
pub fn encode(evt: KeyEvent) -> Vec<u8> {
    use KeyCode::*;

    match (evt.code, evt.mods.ctrl) {
        // --- Arrow keys (ESC A/B/C/D) ---
        (ArrowUp, _) => vec![0x1B, b'A'],
        (ArrowDown, _) => vec![0x1B, b'B'],
        (ArrowRight, _) => vec![0x1B, b'C'],
        (ArrowLeft, _) => vec![0x1B, b'D'],

        // --- Named navigation / editing keys ---
        (Enter, _) => vec![0x0D], // CR; Phase 4 adds LF/CRLF override per INPUT-05
        (Tab, _) => vec![0x09],   // HT
        (Backspace, _) => vec![0x08], // BS
        (Escape, _) => vec![0x1B], // ESC

        // --- Ctrl-letter: 0x01..0x1A ---
        // Subtract 0x40 from the uppercase form. Works for A-Z (0x41..0x5A).
        (Char(c), true) if c.is_ascii_alphabetic() => {
            vec![c.to_ascii_uppercase() - 0x40]
        }

        // --- Ctrl-symbol: 0x00, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F ---
        // Ctrl-@ = 0x00, Ctrl-[ = 0x1B, Ctrl-\ = 0x1C, Ctrl-] = 0x1D,
        // Ctrl-^ = 0x1E, Ctrl-_ = 0x1F
        (Char(c), true) if c == b'@' || (b'['..=b'_').contains(&c) => {
            vec![c - 0x40]
        }

        // --- Printable ASCII pass-through (no ctrl, or ctrl with unhandled byte) ---
        (Char(c), _) => vec![c],

        // --- Keypad: plain ASCII in Phase 1 per D-13 ---
        (KeypadDigit(d), _) if d <= 9 => vec![b'0' + d],
        (KeypadDigit(_), _) => Vec::new(), // out of range; silent drop
        (KeypadEnter, _) => vec![0x0D],
        (KeypadComma, _) => vec![b','],
        (KeypadMinus, _) => vec![b'-'],
        (KeypadDot, _) => vec![b'.'],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Arrows ---

    #[test]
    fn arrow_up_is_esc_a() {
        assert_eq!(encode(KeyEvent::new(KeyCode::ArrowUp)), vec![0x1B, b'A']);
    }
    #[test]
    fn arrow_down_is_esc_b() {
        assert_eq!(encode(KeyEvent::new(KeyCode::ArrowDown)), vec![0x1B, b'B']);
    }
    #[test]
    fn arrow_right_is_esc_c() {
        assert_eq!(encode(KeyEvent::new(KeyCode::ArrowRight)), vec![0x1B, b'C']);
    }
    #[test]
    fn arrow_left_is_esc_d() {
        assert_eq!(encode(KeyEvent::new(KeyCode::ArrowLeft)), vec![0x1B, b'D']);
    }
    #[test]
    fn arrows_ignore_modifiers() {
        // ctrl held should not change arrow encoding
        let with_ctrl = KeyEvent::with_ctrl(KeyCode::ArrowUp);
        assert_eq!(encode(with_ctrl), vec![0x1B, b'A']);
    }

    // --- Named nav keys ---

    #[test]
    fn enter_is_cr() {
        assert_eq!(encode(KeyEvent::new(KeyCode::Enter)), vec![0x0D]);
    }
    #[test]
    fn tab_is_ht() {
        assert_eq!(encode(KeyEvent::new(KeyCode::Tab)), vec![0x09]);
    }
    #[test]
    fn backspace_is_bs() {
        assert_eq!(encode(KeyEvent::new(KeyCode::Backspace)), vec![0x08]);
    }
    #[test]
    fn escape_is_esc() {
        assert_eq!(encode(KeyEvent::new(KeyCode::Escape)), vec![0x1B]);
    }

    // --- Ctrl-letter exhaustive ---

    #[test]
    fn ctrl_letter_lowercase_produces_0x01_to_0x1a() {
        // a..z with ctrl held -> 0x01..0x1A
        for (i, c) in (b'a'..=b'z').enumerate() {
            let evt = KeyEvent::with_ctrl(KeyCode::Char(c));
            let got = encode(evt);
            assert_eq!(
                got,
                vec![0x01 + i as u8],
                "ctrl-{} expected 0x{:02X}, got {:?}",
                c as char,
                0x01 + i as u8,
                got
            );
        }
    }

    #[test]
    fn ctrl_letter_uppercase_produces_0x01_to_0x1a() {
        // A..Z with ctrl held -> 0x01..0x1A (case-insensitive for ctrl)
        for (i, c) in (b'A'..=b'Z').enumerate() {
            let evt = KeyEvent::with_ctrl(KeyCode::Char(c));
            assert_eq!(
                encode(evt),
                vec![0x01 + i as u8],
                "ctrl-{} expected 0x{:02X}",
                c as char,
                0x01 + i as u8
            );
        }
    }

    #[test]
    fn ctrl_m_overlaps_with_enter_cr() {
        // Useful smoke: Ctrl-M and Enter both emit 0x0D. This is a VT52 reality,
        // not a bug — the wire byte is the same; semantics are host-side.
        assert_eq!(encode(KeyEvent::with_ctrl(KeyCode::Char(b'M'))), vec![0x0D]);
        assert_eq!(encode(KeyEvent::new(KeyCode::Enter)), vec![0x0D]);
    }

    // --- Ctrl-symbol ---

    #[test]
    fn ctrl_at_is_null() {
        assert_eq!(encode(KeyEvent::with_ctrl(KeyCode::Char(b'@'))), vec![0x00]);
    }
    #[test]
    fn ctrl_left_bracket_is_esc() {
        assert_eq!(encode(KeyEvent::with_ctrl(KeyCode::Char(b'['))), vec![0x1B]);
    }
    #[test]
    fn ctrl_backslash_is_fs() {
        assert_eq!(
            encode(KeyEvent::with_ctrl(KeyCode::Char(b'\\'))),
            vec![0x1C]
        );
    }
    #[test]
    fn ctrl_right_bracket_is_gs() {
        assert_eq!(encode(KeyEvent::with_ctrl(KeyCode::Char(b']'))), vec![0x1D]);
    }
    #[test]
    fn ctrl_caret_is_rs() {
        assert_eq!(encode(KeyEvent::with_ctrl(KeyCode::Char(b'^'))), vec![0x1E]);
    }
    #[test]
    fn ctrl_underscore_is_us() {
        assert_eq!(encode(KeyEvent::with_ctrl(KeyCode::Char(b'_'))), vec![0x1F]);
    }

    // --- Printable pass-through ---

    #[test]
    fn printable_ascii_passes_through_unchanged() {
        // 0x20..0x7E range, no modifiers, pass through as single byte
        for c in 0x20u8..=0x7E {
            let evt = KeyEvent::new(KeyCode::Char(c));
            assert_eq!(
                encode(evt),
                vec![c],
                "printable 0x{:02X} expected pass-through",
                c
            );
        }
    }

    #[test]
    fn printable_preserves_case() {
        assert_eq!(encode(KeyEvent::new(KeyCode::Char(b'a'))), vec![b'a']);
        assert_eq!(encode(KeyEvent::new(KeyCode::Char(b'A'))), vec![b'A']);
    }

    // --- Keypad ---

    #[test]
    fn keypad_digits_produce_ascii_digits() {
        for d in 0u8..=9 {
            let evt = KeyEvent::new(KeyCode::KeypadDigit(d));
            assert_eq!(
                encode(evt),
                vec![b'0' + d],
                "keypad digit {} expected '{}'",
                d,
                (b'0' + d) as char
            );
        }
    }

    #[test]
    fn keypad_enter_is_cr() {
        assert_eq!(encode(KeyEvent::new(KeyCode::KeypadEnter)), vec![0x0D]);
    }

    #[test]
    fn keypad_symbols_produce_their_ascii_forms() {
        assert_eq!(encode(KeyEvent::new(KeyCode::KeypadComma)), vec![b',']);
        assert_eq!(encode(KeyEvent::new(KeyCode::KeypadMinus)), vec![b'-']);
        assert_eq!(encode(KeyEvent::new(KeyCode::KeypadDot)), vec![b'.']);
    }

    #[test]
    fn keypad_digit_out_of_range_is_silent_drop() {
        // Defensive — callers should never construct KeypadDigit(10+), but
        // if they do, return empty vec rather than panic on overflow.
        assert_eq!(
            encode(KeyEvent::new(KeyCode::KeypadDigit(10))),
            Vec::<u8>::new()
        );
        assert_eq!(
            encode(KeyEvent::new(KeyCode::KeypadDigit(255))),
            Vec::<u8>::new()
        );
    }

    // --- Modifiers struct ---

    #[test]
    fn modifiers_default_has_no_mods_held() {
        let m = Modifiers::default();
        assert!(!m.ctrl);
        assert!(!m.shift);
        assert!(!m.alt);
        assert!(!m.meta);
    }

    #[test]
    fn modifiers_none_constant_matches_default() {
        assert_eq!(Modifiers::NONE, Modifiers::default());
    }

    #[test]
    fn modifiers_ctrl_constant_only_has_ctrl_set() {
        // Modifiers::CTRL is a `const`, so these assertions are constant
        // expressions; use a `const { ... }` block to evaluate them at
        // compile time (clippy::assertions_on_constants). A regression
        // that flipped any CTRL field would fail the build, not just
        // the test run — strictly stronger than a runtime assert!.
        const {
            assert!(Modifiers::CTRL.ctrl);
            assert!(!Modifiers::CTRL.shift);
            assert!(!Modifiers::CTRL.alt);
            assert!(!Modifiers::CTRL.meta);
        }
    }

    // --- KeyEvent constructors ---

    #[test]
    fn key_event_new_has_no_mods() {
        let evt = KeyEvent::new(KeyCode::ArrowUp);
        assert_eq!(evt.mods, Modifiers::NONE);
        assert_eq!(evt.code, KeyCode::ArrowUp);
    }

    #[test]
    fn key_event_with_ctrl_has_only_ctrl() {
        let evt = KeyEvent::with_ctrl(KeyCode::Char(b'c'));
        assert_eq!(evt.mods, Modifiers::CTRL);
    }

    // --- Alt / Shift / Meta are not yet behaviorally meaningful ---

    #[test]
    fn alt_and_meta_do_not_affect_printable_encoding_in_phase_1() {
        // Alt-a and Meta-a in Phase 1 still encode as 'a'. Phase 4 may add
        // alt-prefix-esc or meta-to-escape behavior; Phase 1 deliberately
        // punts.
        let mut mods = Modifiers::NONE;
        mods.alt = true;
        assert_eq!(
            encode(KeyEvent {
                code: KeyCode::Char(b'a'),
                mods
            }),
            vec![b'a']
        );
        mods.alt = false;
        mods.meta = true;
        assert_eq!(
            encode(KeyEvent {
                code: KeyCode::Char(b'a'),
                mods
            }),
            vec![b'a']
        );
    }
}
