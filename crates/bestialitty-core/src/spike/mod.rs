//! Parser-strategy spike module (CONTEXT D-02, D-03, D-04; Plan 01-03).
//!
//! Both candidate parser approaches live side by side under this module:
//!  - [`hand_rolled`]: explicit DFA (Ground / Escape / CursorRow / CursorCol)
//!  - [`vte_path`]:    [`vte::Parser`] + a minimal [`vte::Perform`] impl
//!
//! [`harness`] provides shared state ([`harness::SpikeTerminal`]) and the
//! torn-chunk helper [`harness::assert_identical_across_splits`]. [`tests`]
//! drives both prototypes through the identical D-02 7-sequence + torn-chunk
//! matrix so neither prototype can influence the ADR-001 decision without
//! first clearing the floor condition in D-03.
//!
//! Compiled only under `#[cfg(any(test, feature = "spike"))]` so default /
//! production builds never pull in the spike code or (transitively) the
//! `vte` crate. See `Cargo.toml` — `vte` is declared `optional = true` and
//! only activated by the `spike` feature.
//!
//! Plan 01-04 consumes the winner (per ADR-001) and removes this module.
//! The losing prototype is deleted rather than archived; git history is the
//! archive.

pub mod harness;
pub mod hand_rolled;
pub mod vte_path;

#[cfg(test)]
mod tests;
