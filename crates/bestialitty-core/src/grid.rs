//! 80x24 cell grid. `#[repr(C)]` Cell layout for zero-copy JS views in Phase 2.
//!
//! - Cell is exactly 8 bytes: `ch: u32 + fg: u8 + bg: u8 + flags: u8 + _pad: u8`.
//!   The layout is D-09 and is load-bearing for the Phase 2 wasm boundary.
//! - `ch` stores the raw VT52 byte (0x00-0xFF) in the LSB. Upper 24 bits are
//!   reserved for a future codepoint migration (D-10). Phase 1 never looks
//!   at the upper bits; Phase 3's JS renderer owns any glyph-table translation.
//! - Row is a `Vec<Cell>` because cols are runtime-configurable via
//!   `Terminal::resize` (D-17). For an 80-col row, sizeof = 80 * 8 = 640 bytes
//!   of cell data + Vec header overhead.

use std::mem::{align_of, size_of};

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    /// Raw VT52 byte (0x00-0xFF) in LSB; upper 24 bits reserved for future
    /// codepoint migration per D-10.
    pub ch: u32,
    /// Palette index — unused in Phase 1; keep 0.
    pub fg: u8,
    /// Palette index — unused in Phase 1; keep 0.
    pub bg: u8,
    /// Bit 0 = cursor, Bit 1 = bell_highlight, Bit 2 = graphics_mode.
    /// All 0 in Phase 1.
    pub flags: u8,
    /// Alignment filler; keep 0.
    pub _pad: u8,
}

impl Cell {
    /// A blank cell: ASCII space (0x20), no attributes.
    pub const BLANK: Cell = Cell {
        ch: 0x20,
        fg: 0,
        bg: 0,
        flags: 0,
        _pad: 0,
    };

    /// Construct a cell holding a single raw byte, no attributes.
    pub const fn with_byte(b: u8) -> Self {
        Cell {
            ch: b as u32,
            fg: 0,
            bg: 0,
            flags: 0,
            _pad: 0,
        }
    }
}

// Compile-time assertions: Cell layout is load-bearing for Phase 2.
// If either assertion fires, the JS-side Uint8Array view assumptions break.
const _: () = assert!(size_of::<Cell>() == 8, "Cell must be 8 bytes per D-09");
const _: () = assert!(align_of::<Cell>() == 4, "Cell must be 4-byte aligned per D-09");

/// A single grid row — runtime-sized to support `Terminal::resize(rows, cols)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row(pub Vec<Cell>);

impl Row {
    /// Blank row of the given width, filled with `Cell::BLANK`.
    pub fn blank(cols: usize) -> Self {
        Row(vec![Cell::BLANK; cols])
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn as_slice(&self) -> &[Cell] {
        &self.0
    }

    pub fn as_mut_slice(&mut self) -> &mut [Cell] {
        &mut self.0
    }

    /// Fill the entire row with blanks.
    pub fn clear(&mut self) {
        for c in &mut self.0 {
            *c = Cell::BLANK;
        }
    }

    /// Fill cells from `start..` (up to end of row) with blanks.
    pub fn clear_from(&mut self, start: usize) {
        if start >= self.0.len() {
            return;
        }
        for c in &mut self.0[start..] {
            *c = Cell::BLANK;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cell_size_is_eight_bytes() {
        assert_eq!(size_of::<Cell>(), 8);
        assert_eq!(align_of::<Cell>(), 4);
    }

    #[test]
    fn blank_cell_is_space() {
        assert_eq!(Cell::BLANK.ch, 0x20);
        assert_eq!(Cell::BLANK.fg, 0);
        assert_eq!(Cell::BLANK.bg, 0);
        assert_eq!(Cell::BLANK.flags, 0);
        assert_eq!(Cell::BLANK._pad, 0);
    }

    #[test]
    fn with_byte_stores_raw_byte_in_lsb() {
        let cell = Cell::with_byte(b'A');
        assert_eq!(cell.ch, 0x41);
        assert_eq!(cell.ch & 0xFF, 0x41);
        // Upper 24 bits reserved; must be zero per D-10.
        assert_eq!(cell.ch >> 8, 0);
    }

    #[test]
    fn with_byte_preserves_high_bit_bytes() {
        // 0x80..0xFF — some MicroBeast workloads may emit these.
        let cell = Cell::with_byte(0xAB);
        assert_eq!(cell.ch, 0xAB);
    }

    #[test]
    fn row_blank_creates_correctly_sized_row_of_blanks() {
        let r = Row::blank(80);
        assert_eq!(r.len(), 80);
        assert!(r.as_slice().iter().all(|c| *c == Cell::BLANK));
    }

    #[test]
    fn row_clear_from_preserves_prefix() {
        let mut r = Row::blank(10);
        for i in 0..10 {
            r.as_mut_slice()[i] = Cell::with_byte(b'A' + i as u8);
        }
        r.clear_from(3);
        // 0..3 survive
        for i in 0..3 {
            assert_eq!(r.as_slice()[i].ch, (b'A' + i as u8) as u32);
        }
        // 3..10 are blanks
        for i in 3..10 {
            assert_eq!(r.as_slice()[i], Cell::BLANK);
        }
    }

    #[test]
    fn row_clear_from_out_of_bounds_is_noop() {
        let mut r = Row::blank(5);
        for i in 0..5 {
            r.as_mut_slice()[i] = Cell::with_byte(b'A' + i as u8);
        }
        r.clear_from(10); // past end
        for i in 0..5 {
            assert_eq!(r.as_slice()[i].ch, (b'A' + i as u8) as u32);
        }
    }

    #[test]
    fn row_clear_blanks_every_cell() {
        let mut r = Row::blank(4);
        for i in 0..4 {
            r.as_mut_slice()[i] = Cell::with_byte(b'X' + i as u8);
        }
        r.clear();
        assert!(r.as_slice().iter().all(|c| *c == Cell::BLANK));
    }
}
