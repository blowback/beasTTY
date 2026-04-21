//! Byte-per-row dirty bitmap. Byte (not bit) layout so Phase 2 can expose a
//! zero-copy `Uint8Array` view directly over the buffer without JS-side
//! bit-fiddling.
//!
//! Plan 01 stub. Real implementation lands in Plan 04.
