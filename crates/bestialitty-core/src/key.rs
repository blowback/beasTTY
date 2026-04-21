//! PC keyboard -> VT52 byte encoder. Stateless; pure function.
//! Arrows -> ESC A/B/C/D; Ctrl-letter -> 0x01..0x1A; Ctrl-@ / [ / \ / ] / ^ / _
//! -> 0x00..0x1F; printable ASCII pass-through. See CONTEXT D-13.
//!
//! Plan 01 stub. Real implementation lands in Plan 05.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrow_up_is_esc_a() {
        // RED: fails because encode/KeyCode/KeyEvent do not exist yet.
        assert_eq!(encode(KeyEvent::new(KeyCode::ArrowUp)), vec![0x1B, b'A']);
    }
}
