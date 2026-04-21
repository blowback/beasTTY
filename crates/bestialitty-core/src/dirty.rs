//! Byte-per-row dirty bitmap.
//!
//! One byte per row; 1 = dirty, 0 = clean. Byte (not bit) layout so Phase 2
//! can expose a zero-copy `Uint8Array` view directly over the buffer
//! without JS-side bit-fiddling. At 24 rows, the buffer is 24 bytes —
//! unmeasurable in memory footprint, and `mark(row)` is a single byte write.
//!
//! Usage pattern:
//! - Parser calls `mark(row)` on every write into that row.
//! - Phase 2 renderer reads `as_slice()` via a Uint8Array view.
//! - At end of frame, renderer calls `clear()` via the wasm boundary.

pub struct Dirty {
    bytes: Vec<u8>,
}

impl Dirty {
    pub fn new(rows: usize) -> Self {
        Self {
            bytes: vec![0; rows],
        }
    }

    /// Mark `row` as dirty. Silent no-op if `row >= len` (defensive —
    /// guards against a stale row index during resize).
    pub fn mark(&mut self, row: usize) {
        if row < self.bytes.len() {
            self.bytes[row] = 1;
        }
    }

    pub fn mark_all(&mut self) {
        for b in &mut self.bytes {
            *b = 1;
        }
    }

    pub fn clear(&mut self) {
        for b in &mut self.bytes {
            *b = 0;
        }
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.bytes
    }

    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    /// Resize the buffer. New bytes are 0 (clean); truncation drops trailing bytes.
    pub fn resize(&mut self, rows: usize) {
        self.bytes.resize(rows, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_creates_zeroed_buffer_of_given_size() {
        let d = Dirty::new(24);
        assert_eq!(d.as_slice().len(), 24);
        assert!(d.as_slice().iter().all(|&b| b == 0));
    }

    #[test]
    fn mark_sets_only_target_byte() {
        let mut d = Dirty::new(10);
        d.mark(3);
        assert_eq!(d.as_slice()[3], 1);
        for i in 0..10 {
            if i != 3 {
                assert_eq!(d.as_slice()[i], 0);
            }
        }
    }

    #[test]
    fn mark_is_idempotent() {
        let mut d = Dirty::new(10);
        d.mark(3);
        d.mark(3);
        d.mark(3);
        assert_eq!(d.as_slice()[3], 1);
    }

    #[test]
    fn mark_out_of_bounds_is_silent_noop() {
        let mut d = Dirty::new(10);
        d.mark(100); // must not panic
        d.mark(usize::MAX); // must not panic
        assert!(d.as_slice().iter().all(|&b| b == 0));
    }

    #[test]
    fn mark_all_sets_every_byte() {
        let mut d = Dirty::new(24);
        d.mark_all();
        assert!(d.as_slice().iter().all(|&b| b == 1));
    }

    #[test]
    fn clear_zeroes_every_byte() {
        let mut d = Dirty::new(5);
        d.mark_all();
        d.clear();
        assert!(d.as_slice().iter().all(|&b| b == 0));
    }

    #[test]
    fn resize_grow_initializes_new_bytes_to_zero() {
        let mut d = Dirty::new(5);
        d.mark_all(); // bytes = [1,1,1,1,1]
        d.resize(8); // bytes = [1,1,1,1,1,0,0,0]
        assert_eq!(d.len(), 8);
        assert_eq!(d.as_slice()[0..5], [1, 1, 1, 1, 1]);
        assert_eq!(d.as_slice()[5..8], [0, 0, 0]);
    }

    #[test]
    fn resize_shrink_truncates_trailing_bytes() {
        let mut d = Dirty::new(8);
        d.mark_all();
        d.resize(3);
        assert_eq!(d.len(), 3);
        assert_eq!(d.as_slice(), &[1, 1, 1]);
    }
}
