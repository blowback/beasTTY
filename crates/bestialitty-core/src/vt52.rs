//! VT52 parser state machine. Byte-at-a-time DFA (Ground / Escape / CursorRow /
//! CursorCol) OR `vte::Parser` + `Perform` impl — resolved by the Plan 03
//! spike + ADR-001.
//!
//! Plan 01 stub. Real implementation lands in Plan 04 (driven by the ADR winner).
