# Phase 7: SLIDE Rust Core — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 13 (11 new + 2 modified) + 1 ADR
**Analogs found:** 13 / 13 (every Phase 7 file has a Phase 1/2 analog or a documented "no analog, use research" note)

Phase 7 is pure-Rust, additive to `crates/bestialitty-core/`. Every new file mirrors a Phase 1 or Phase 2 sibling; the planner can paste analog excerpts as templates.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/bestialitty-core/src/slide/mod.rs` | module root | declarative re-export | `crates/bestialitty-core/src/lib.rs:16-21` (mod tree) + each pure module's `//!` header | exact (mod-tree pattern) |
| `crates/bestialitty-core/src/slide/crc.rs` | utility (pure fn + tests block) | transform (bytes → u16) | `crates/bestialitty-core/src/dirty.rs` (small focused module) + `crates/bestialitty-core/src/key.rs:179-271` (`#[cfg(test)] mod tests` style) | role-match |
| `crates/bestialitty-core/src/slide/framer.rs` | parser DFA | byte-fed state machine | `crates/bestialitty-core/src/vt52.rs:1-181` (Parser + state enum + feed driver) | exact (DFA shape mirror) |
| `crates/bestialitty-core/src/slide/state.rs` | core struct + SM | event-driven request-response | `crates/bestialitty-core/src/terminal.rs:17-130` (`Terminal` struct + `host_reply` ring + ptr/len/clear) | exact (struct shape mirror) |
| `crates/bestialitty-core/src/slide/tests.rs` | unit-test smoke | integration-in-module | `crates/bestialitty-core/src/terminal.rs:435-450` (`#[cfg(test)] mod tests { use super::*; fn t()…}`) | exact |
| `crates/bestialitty-core/src/slide/tests_only.rs` | test-only fixture re-exports | declarative | (no Phase 1 analog — see §No Analog Found) | use research §Code Examples |
| `crates/bestialitty-core/tests/slide_torn_chunk.rs` | integration test (corpus) | byte-stream chunking | `crates/bestialitty-core/src/vt52.rs:189-318` (`assert_identical_across_splits` + `torn_*` test array) | direct mirror |
| `crates/bestialitty-core/tests/slide_reference_corpus.rs` | integration test (cross-validation) | const fixtures + assertion | `crates/bestialitty-core/tests/boundary_api_shape.rs:24-86` (per-property `#[test]` against fixed bytes) | role-match |
| `crates/bestialitty-core/tests/slide_idempotent_reentry.rs` | integration test (state transitions) | sequenced calls + assertion | `crates/bestialitty-core/src/terminal.rs:832-857` (`pack_ptr_stable_across_feed`-style step-and-assert) | role-match |
| `crates/bestialitty-core/tests/slide_boundary_shape.rs` | API-shape compile pin | function-pointer coercion | `crates/bestialitty-core/tests/boundary_api_shape.rs:280-318` (`let _: fn(&mut T, …) = T::method;` pin) | direct mirror |
| `crates/bestialitty-core/src/lib.rs` (modify) | mod-tree extension | declarative | self (lines 16-21 — `pub mod` lines, alphabetical, one per line) | exact (in-place mirror) |
| `crates/bestialitty-core/Cargo.toml` (modify) | dependency manifest comment | declarative | self (lines 18-22 — pin + reasoning comment for `vte = "=0.15"`) | exact (in-place mirror) |
| `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` | decision record | Nygard ADR template | `.planning/decisions/ADR-001-parser-strategy.md` + `.planning/decisions/ADR-002-wasm-gating.md` | direct mirror |

---

## Pattern Assignments

### `crates/bestialitty-core/src/slide/mod.rs` (module root, declarative)

**Analog:** `crates/bestialitty-core/src/lib.rs:16-21` (root mod-tree) + module-doc headers in every pure-Rust file.

**Module-doc header pattern** (verbatim shape, see e.g. `dirty.rs:1-11`, `key.rs:1-13`, `vt52.rs:1-34`):

```rust
//! SLIDE protocol Rust core: byte-fed framer + CRC + sliding-window SM.
//!
//! - `crc`, `framer`, `state` — pure Rust, wasm-free (D-20). Exercised by
//!   native `cargo test` as part of the rlib.
//! - `crc::crc16_ccitt` is `pub(crate)` per D-03 — framer-only consumer.
//!
//! Architectural rule (CLAUDE.md + D-20): NO `wasm_bindgen`, NO `web_sys`,
//! NO `js_sys`, NO `std::time`. Phase 8's `lib.rs:wasm_boundary` adds the
//! `Slide` `#[wasm_bindgen]` wrapper; Phase 7 ships the inner struct only.
//! `tests/core_02_no_browser_deps.rs` enforces this.
```

**Mod tree** (alphabetical, one `pub mod` per line — copy from `lib.rs:16-21`):

```rust
pub mod crc;
pub mod framer;
pub mod state;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub mod tests_only;     // gate via #[cfg(test)] for D-03 visibility (see RESEARCH §CRC Visibility)
```

**Re-export pattern** (mirror `lib.rs:16-21`'s top-level shape — keep `Slide` reachable without callers writing `slide::state::Slide`):

```rust
pub use state::{Slide, SlideState};
```

---

### `crates/bestialitty-core/src/slide/crc.rs` (utility, transform)

**Analog:** small focused modules — `dirty.rs:1-50` for the size + module-doc shape; `key.rs:179-271` for the `#[cfg(test)] mod tests { use super::*; … }` block; **slide-rs upstream** `protocol.rs:16-30` is the byte-for-byte source per D-01.

**CRC implementation pattern** (verbatim from `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30` — D-01 says copy this 1:1, change visibility to `pub(crate)`):

```rust
/// CRC-16-CCITT (polynomial 0x1021, init 0xFFFF).
///
/// Verbatim from /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30
/// per D-01 — byte-for-byte cross-validation against slide-rs is the
/// wire-correctness gate. Do not "improve" without re-pinning slide-rs's
/// fixture frames in `tests/slide_reference_corpus.rs`.
pub(crate) fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
            crc &= 0xFFFF;
        }
    }
    crc
}
```

**`#[cfg(test)]` block pattern** (mirror `key.rs:179-200`):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // D-04(a): non-negotiable Greg Cook CRC catalogue reference vector.
    #[test]
    fn catalogue_vector_pin() {
        assert_eq!(crc16_ccitt(b"123456789"), 0x29B1);
    }

    // D-04(b): one slide-rs fixture round-trip (full corpus lives in
    // tests/slide_reference_corpus.rs, this is the in-module smoke).
    #[test]
    fn empty_input_yields_init_value() {
        assert_eq!(crc16_ccitt(&[]), 0xFFFF);
    }
}
```

**Visibility:** `pub(crate)` per D-03. Test-only re-export goes in `tests_only.rs` per CONTEXT D-03's "Mock peer in tests imports via `#[cfg(test)] pub use` re-export" note.

---

### `crates/bestialitty-core/src/slide/framer.rs` (parser DFA, byte-fed)

**Analog:** `crates/bestialitty-core/src/vt52.rs:1-181` is the closest existing byte-fed parser. Phase 7 does NOT use `vte::Parser` (vte is for ANSI escape DFA, not binary framing — see ADR-001 + RESEARCH §"Anti-Patterns to Avoid"). The pattern to mirror is the **shape**: state-enum-on-Parser-struct + per-call dispatch + sub-state shuttled across calls.

**State-enum-on-struct + per-call dispatch pattern** (mirror `vt52.rs:39-47, 162-181`):

```rust
// Mirrors vt52.rs:39-47 EscYPhase enum + vt52.rs:162-181 Parser::new/feed shape.
// State persists across feed calls — torn-chunk safety is a side-effect of
// the design, NOT a special case (RESEARCH §Pattern 1 / §Pitfall 1).

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum FramerState {
    Idle,
    AfterAckOrNak(u8),                       // saw 0x06 or 0x15; next byte is seq
    WaitingSeq,                              // saw SOF; reading SEQ
    WaitingLenHi(u8),                        // carry SEQ; reading LEN_H
    WaitingLenLo { seq: u8, len_hi: u8 },
    ReadingPayload { seq: u8, remaining: usize /* + crc accumulator on Slide */ },
    WaitingCrcHi { seq: u8 },
    WaitingCrcLo { seq: u8, crc_hi: u8 },
}
```

**Silent-discard-on-malformed pattern** (mirror Phase 1 D-15; see `vt52.rs:73-82` Idle path that drops unknown bytes):

```rust
// Phase 1 D-15: silent discard + return to safe state on unexpected bytes.
// In FramerState::Idle, garbage bytes that aren't SOF / RDY / FIN / CAN /
// ACK / NAK silently advance the read position with NO state change and
// NO event emission.
match self.framer_state {
    FramerState::Idle => match b {
        SOF       => { self.framer_state = FramerState::WaitingSeq; EVT_NONE }
        CTRL_RDY  => self.on_rdy(),
        // ... etc ...
        _ => EVT_NONE,  // silent discard per Phase 1 D-15
    },
    // ...
}
```

**Sub-state shuttled across calls** (mirror `vt52.rs:162-181` `Parser::new` + `feed`):

```rust
// vt52.rs:162-180 ships EscYPhase across calls via std::mem::replace.
// Slide does NOT need that gymnastics — FramerState lives directly on
// `Slide`, not on a transient Performer, because Slide owns the byte loop
// itself (no vte::Parser indirection).
impl Slide {
    pub(crate) fn feed_byte_framer(&mut self, b: u8) -> u32 {
        // single match on (framer_state, b); transitions exactly one step.
        // Returns packed-u32 event per RESEARCH §Pattern 3.
    }
}
```

**Tests block pattern:** mirror `vt52.rs:189-200` — `#[cfg(test)] mod tests` with helpers building a `Slide` and feeding chunks; one `#[test]` per transition-table row + 2 CRC-scope tests (RESEARCH Wave 0 Gaps: 8 tests min).

---

### `crates/bestialitty-core/src/slide/state.rs` (core struct, event-driven)

**Analog:** `crates/bestialitty-core/src/terminal.rs:17-130` — `Terminal` struct shape, `Vec<u8>`-with-stable-pointer ring (`host_reply`), and `*const u8 + len + clear` accessor triple are all directly mirrored.

**Struct shape** (mirror `terminal.rs:17-41`):

```rust
// Mirror of terminal.rs:17-41 Terminal struct.
// `outbound_buf` is the SLIDE analog of `host_reply` — JS reads via
// outbound_ptr/_len, acks via clear_outbound. Pre-reserved at new() so
// the pointer is stable across feed_byte / feed_chunk in steady state
// (D-03 invalidation contract; Phase 8 wasm wrapper depends on this).
pub struct Slide {
    framer_state: FramerState,
    sm_state: SlideState,
    outbound_buf: Vec<u8>,                   // pre-reserved (RESEARCH: 16 bytes)
    // window state, current frame seq, current file metadata, etc.
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]                                  // RESEARCH §"Reusable Assets": Phase 8 wasm wrap
pub enum SlideState {
    Idle = 0,
    AwaitingHeader = 1,
    DataPhase = 2,
    CancelPending = 3,
    Done = 4,
}
```

**Constructor pattern** (mirror `terminal.rs:43-62`):

```rust
impl Slide {
    pub fn new() -> Self {
        Self {
            framer_state: FramerState::Idle,
            sm_state: SlideState::Idle,
            // Pre-reserve 16 bytes — comfortably covers RDY (1) + ACK+seq (2)
            // + NAK+seq (2) + CAN (1) + FIN (1) plus headroom. Keeps
            // outbound_ptr stable across feed_byte calls in steady state
            // (D-03 mirror; see terminal.rs:52-56 host_reply commentary).
            outbound_buf: Vec::with_capacity(16),
            // ...
        }
    }
}
```

**Stable-pointer accessor triple** (verbatim shape from `terminal.rs:107-123`):

```rust
// Pointer into outbound_buf. Stable across feed_byte / feed_chunk in steady
// state. Mirrors the D-03 contract for pack_ptr / dirty_ptr / host_reply_ptr.
//
// JS re-derives its Uint8Array view if wasm.memory.buffer is replaced
// (memory growth / ArrayBuffer detachment). A future >16-byte outbound
// would require either bumping the pre-reserve OR adding a pointer-identity
// guard alongside the buffer-identity guard in JS.
pub fn outbound_ptr(&self) -> *const u8 {
    self.outbound_buf.as_ptr()
}

pub fn outbound_len(&self) -> usize {
    self.outbound_buf.len()
}

pub fn clear_outbound(&mut self) {
    self.outbound_buf.clear();   // preserves capacity per D-03
}
```

**Cancel API pattern** (D-06, no analog in Phase 1 — closest is `terminal.rs:121-123 clear_host_reply` for the idempotent-ish state-mutating API; planner writes it fresh):

```rust
// D-06: fire-and-set-state. Idempotent — calling cancel() while already in
// CancelPending is a no-op. JS owns timing (200/500/100/2000 ms windows
// per PITFALLS §5); Rust SM is purely event-driven.
pub fn cancel(&mut self) {
    if matches!(self.sm_state, SlideState::CancelPending | SlideState::Done) {
        return;  // idempotent
    }
    self.outbound_buf.push(CTRL_CAN);  // wire format resolved at planning per D-08
    self.sm_state = SlideState::CancelPending;
}

// D-06: timeout escape hatch for JS. After ~2 s with no echo, JS forcibly
// drops CancelPending and resets the SM. All timing in JS — Rust never
// reads std::time (CORE-02 invariant; tests/core_02_no_browser_deps.rs).
pub fn force_idle(&mut self) {
    self.sm_state = SlideState::Idle;
    self.framer_state = FramerState::Idle;
    self.outbound_buf.clear();
}
```

**Event-packing pattern** (RESEARCH §Pattern 3, mirror `lib.rs:152-155 cursor_packed`):

```rust
// (kind << 16) | aux per RESEARCH §Pattern 3. Phase 8 wraps as feed_byte ->
// u32 across the wasm boundary. cursor_packed in lib.rs:152-155 is the
// existing convention.
pub const EVT_NONE:                     u32 = 0;
pub const EVT_FRAME_OK:                 u32 = 1 << 16;
pub const EVT_FRAME_BAD_CRC:            u32 = 2 << 16;
pub const EVT_HEADER_FRAME:             u32 = 3 << 16;
pub const EVT_SESSION_COMPLETE:         u32 = 4 << 16;
// ... aux bits encode seq number / control byte / kind-specific payload ...
```

---

### `crates/bestialitty-core/src/slide/tests.rs` (unit-test smoke)

**Analog:** `crates/bestialitty-core/src/terminal.rs:435-473` — `#[cfg(test)] mod tests { use super::*; fn t() -> X {...} #[test] ... }` shape.

**File header + helper + first test** (mirror `terminal.rs:435-450`):

```rust
//! Unit smoke tests for the slide module. Per-module #[cfg(test)] blocks
//! in crc.rs / framer.rs / state.rs cover transition-level behaviour;
//! this file exercises end-to-end happy-path + 5 module-level smokes
//! (RESEARCH Wave 0 Gaps).

use super::*;
use crate::slide::state::Slide;

fn s() -> Slide {
    Slide::new()
}

#[test]
fn new_slide_is_idle_with_empty_outbound() {
    let slide = s();
    assert_eq!(slide.outbound_len(), 0);
    // ... etc, mirroring terminal.rs:443-450 ...
}
```

---

### `crates/bestialitty-core/src/slide/tests_only.rs` (test-only fixture re-exports)

**Analog:** none in Phase 1 — closest conceptually is the pattern of `#[cfg(test)] pub use` gating noted in CONTEXT D-03. Planner uses RESEARCH §Test Corpus Byte Vectors (07-RESEARCH.md lines 933-1086) for fixture content.

**Recommended shape** (synthesised from D-03's wording):

```rust
//! Test-only re-exports of fixture constants and `pub(crate)` items that
//! the integration tests under `tests/slide_*.rs` need to import.
//!
//! Gated under `#[cfg(test)]` per D-03 — these symbols are NOT part of the
//! production crate surface. Phase 8's wasm boundary never sees them.

#![cfg(test)]

pub use crate::slide::crc::crc16_ccitt;
// + each fixture frame defined in slide/tests.rs, re-exported as `pub`
//   so tests/slide_reference_corpus.rs can `use bestialitty_core::slide::tests_only::FIXTURE_*;`.
```

**Note for planner:** integration tests (`tests/slide_*.rs`) compile against the *external* crate surface, so `pub(crate)` items are NOT visible. The `tests_only.rs` shim is the bridge — same trick `boundary_api_shape.rs:1-19` describes (its lines 16-19 explicitly call out the in-crate-vs-integration distinction).

---

### `crates/bestialitty-core/tests/slide_torn_chunk.rs` (integration: torn-chunk corpus)

**Analog:** `crates/bestialitty-core/src/vt52.rs:189-318` — `assert_identical_across_splits` helper + per-sequence `torn_*` `#[test]`. **Direct mirror.** Note: the existing harness is currently in-crate (`vt52.rs` `#[cfg(test)] mod tests`), not under `tests/`. Phase 7's torn-chunk corpus moves to `tests/slide_torn_chunk.rs` per CONTEXT "Native test layout" — both styles, integration file in addition to in-module tests.

**Helper pattern** (verbatim shape from `vt52.rs:193-233`):

```rust
//! SLIDE torn-chunk corpus. Splits every multi-byte frame at every internal
//! offset and asserts identical end state — the same harness Phase 1 used
//! for ESC sequences (vt52.rs:189-318). Torn-chunk safety is the byte-fed
//! framer's load-bearing invariant (RESEARCH §Pitfall 1, BLOCKING).

use bestialitty_core::slide::Slide;

fn run_chunks(chunks: &[&[u8]]) -> Slide {
    let mut slide = Slide::new();
    for c in chunks {
        for &b in *c {
            slide.feed_byte(b);            // or slide.feed_chunk(c) when ready
        }
    }
    slide
}

fn assert_identical_across_splits(bytes: &[u8]) {
    let baseline = run_chunks(&[bytes]);
    for split in 1..bytes.len() {
        let (a, b) = bytes.split_at(split);
        let torn = run_chunks(&[a, b]);
        assert_eq!(
            baseline.sm_state(), torn.sm_state(),
            "sm_state mismatch for {:02X?} split at {}", bytes, split
        );
        assert_eq!(
            baseline.outbound_snapshot(), torn.outbound_snapshot(),
            "outbound mismatch for {:02X?} split at {}", bytes, split
        );
        // ... + frame-decoded equality if applicable ...
    }
}
```

**Per-sequence `#[test]` array pattern** (mirror `vt52.rs:235-317`):

```rust
#[test]
fn torn_header_frame_seq0() {
    // Fixture 1 from RESEARCH §Test Corpus Byte Vectors
    assert_identical_across_splits(&[0x01, 0x00, 0x00, 0x0E /* TEST.TXT\0 + size LE + CRC */ ]);
}

#[test]
fn torn_subframe_two_byte_payload() { /* Fixture 2 */ }

#[test]
fn torn_empty_payload_seq0() { /* Fixture 3 */ }

// ... etc, 7 fixtures from RESEARCH §Test Corpus Byte Vectors lines 944-1051 ...
```

---

### `crates/bestialitty-core/tests/slide_reference_corpus.rs` (integration: cross-validation)

**Analog:** `crates/bestialitty-core/tests/boundary_api_shape.rs:24-86` — per-property `#[test]` against fixed-byte fixtures. Use `&[u8]` const arrays (D-04 hand-paste fixtures from slide-rs offline; no build-time dep on slide-rs).

**Const fixture pattern** (synthesised — RESEARCH §Test Corpus Byte Vectors gives the 7 fixtures):

```rust
//! Cross-validation corpus: 7 frames generated by slide-rs `build_frame`,
//! pinned here as raw byte arrays. Byte-for-byte equality with slide-rs is
//! the wire-correctness gate (CONTEXT D-04). Hand-pasted offline; no
//! build-time tooling dep on slide-rs (D-04 explicit).

use bestialitty_core::slide::tests_only::crc16_ccitt;
use bestialitty_core::slide::Slide;

// Fixture 1: build_frame(0x05, b"hello") from slide-rs
// Source: RESEARCH §Fixture 7 (07-RESEARCH.md:1036-1051)
const FIXTURE_HELLO: &[u8] = &[
    0x01,                                    // SOF
    0x05,                                    // SEQ
    0x00, 0x05,                              // LEN_H, LEN_L
    b'h', b'e', b'l', b'l', b'o',            // PAYLOAD
    0xXX, 0xXX,                              // CRC_H, CRC_L (planner fills from slide-rs)
];

#[test]
fn fixture_hello_round_trips_through_framer() {
    let mut slide = Slide::new();
    for &b in FIXTURE_HELLO {
        slide.feed_byte(b);
    }
    // assert frame-ok event was emitted, payload decoded matches b"hello".
}

#[test]
fn crc_scope_excludes_sof_and_crc_bytes() {
    // PITFALLS §3 pin: flipping SOF must NOT change the CRC.
    let crc_with_sof    = crc16_ccitt(&FIXTURE_HELLO[..]);
    let crc_without_sof = crc16_ccitt(&FIXTURE_HELLO[1..FIXTURE_HELLO.len() - 2]);
    // ... see RESEARCH §"CRC-scope test" (07-RESEARCH.md:1061-1086) ...
}
```

---

### `crates/bestialitty-core/tests/slide_idempotent_reentry.rs` (integration: state transitions)

**Analog:** `crates/bestialitty-core/src/terminal.rs:832-857` — step-and-assert pattern (`pack_ptr_stable_across_feed`-style). 6 re-entry tests from RESEARCH §"Idempotent Re-entry Test Cases" (lines 1088-1182).

**Per-test step-and-assert pattern** (mirror `terminal.rs:832-845`):

```rust
//! Re-entry corpus from RESEARCH §Idempotent Re-entry Test Cases (6 tests).
//! Each test is a sequence of (action, assertion) pairs that pin D-06's
//! "idempotent cancel" contract end-to-end.

use bestialitty_core::slide::Slide;

#[test]
fn re1_cancel_during_cancel_pending_is_noop() {
    // RESEARCH §Re-entry Test 1 (07-RESEARCH.md:1093-1108).
    // D-06: cancel() while already in CancelPending must be a no-op.
    let mut slide = Slide::new();
    // … drive into DataPhase via feed_byte …
    slide.cancel();
    let outbound_after_first = slide.outbound_len();
    let state_after_first = slide.sm_state();
    slide.cancel();                                  // re-entry
    assert_eq!(slide.outbound_len(), outbound_after_first,
        "second cancel() must NOT push a second CTRL_CAN onto outbound");
    assert_eq!(slide.sm_state(), state_after_first,
        "second cancel() must NOT change sm_state");
}

#[test]
fn re2_peer_initiated_can_during_cancel_pending() { /* §Test 2 */ }
#[test]
fn re3_silent_consume_in_cancel_pending() { /* §Test 3, D-07 */ }
#[test]
fn re4_spurious_can_during_data_phase() { /* §Test 4 */ }
#[test]
fn re5_force_idle_resets_cancel_pending() { /* §Test 5 */ }
#[test]
fn re6_garbage_in_idle_silently_discarded() { /* §Test 6, Phase 1 D-15 */ }
```

---

### `crates/bestialitty-core/tests/slide_boundary_shape.rs` (Phase 8 anticipation contract)

**Analog:** `crates/bestialitty-core/tests/boundary_api_shape.rs` — **direct mirror.** Use the function-pointer-coercion pin pattern (lines 280-318) for every method Phase 8 will wrap. Compile failure IS the intended failure mode if any signature drifts.

**File-header rationale** (mirror `boundary_api_shape.rs:1-19` verbatim shape):

```rust
//! SLIDE boundary API shape contract — Phase 8 anticipation pin.
//!
//! Phase 8 will wrap `Slide` in `lib.rs:wasm_boundary` with feed_byte /
//! feed_chunk / outbound_ptr / outbound_len / clear_outbound / state /
//! progress_packed / cancel / force_idle exports. If any of these
//! signatures drift — a method removed, a return type changed, a `pub`
//! accidentally narrowed to `pub(crate)` — Phase 8 will fail at the
//! wasm-pack build step with a cryptic error.
//!
//! This file pins the shape as a compile-time contract: every #[test]
//! below is a runtime fn call that only compiles if the public API matches
//! the shape stated in 07-CONTEXT.md and ARCHITECTURE.md §1. Compile
//! failure IS the intended failure mode.
//!
//! NOTE: This test intentionally lives OUTSIDE the crate (integration test
//! under `tests/`), so it consumes exactly the surface that wasm-bindgen
//! will consume in Phase 8. A pub(crate) method that compiles against an
//! in-crate #[cfg(test)] module would fail here — which is what we want.

use bestialitty_core::slide::{Slide, SlideState};
```

**Function-pointer-coercion pin pattern** (verbatim shape from `boundary_api_shape.rs:280-318`):

```rust
#[test]
fn slide_constructor_signature_is_stable() {
    let _slide: Slide = Slide::new();
}

#[test]
fn slide_outbound_accessors_have_stable_signatures() {
    // Compile-time pin: function-pointer coercion catches signature drift
    // before the runtime calls. Mirror of boundary_api_shape.rs:286 / 312.
    let _: fn(&Slide) -> *const u8 = Slide::outbound_ptr;
    let _: fn(&Slide) -> usize     = Slide::outbound_len;
    let _: fn(&mut Slide)          = Slide::clear_outbound;
    let _: fn(&mut Slide)          = Slide::cancel;
    let _: fn(&mut Slide)          = Slide::force_idle;
    let _: fn(&mut Slide, u8) -> u32 = Slide::feed_byte;
    // ... etc per ARCHITECTURE.md §1 export table ...
}

#[test]
fn slide_event_constants_pinned() {
    // Pin the (kind << 16) | aux packing convention (RESEARCH §Pattern 3,
    // lib.rs:152-155 cursor_packed mirror).
    use bestialitty_core::slide::state::{EVT_FRAME_OK, EVT_NONE};
    assert_eq!(EVT_NONE, 0);
    assert_eq!(EVT_FRAME_OK >> 16, 1);
    // ... etc ...
}
```

---

### `crates/bestialitty-core/src/lib.rs` (modify — mod-tree extension)

**Analog:** self, lines 16-21. The change is one-line: insert `pub mod slide;` in alphabetical order between `scrollback` and `terminal`:

```rust
pub mod dirty;
pub mod grid;
pub mod key;
pub mod scrollback;
pub mod slide;          // NEW — Phase 7 (D-20: pure Rust, wasm-free)
pub mod terminal;
pub mod vt52;
```

**No change to the `wasm_boundary` block.** Phase 8 will add the `Slide` `#[wasm_bindgen]` wrapper in `lib.rs:33-190`; Phase 7 leaves that file otherwise alone.

---

### `crates/bestialitty-core/Cargo.toml` (modify — audit-trail comment)

**Analog:** self, lines 18-22. The convention is a multi-line comment explaining each dep + its pinning rationale (`vte = "=0.15"` block). Phase 7 adds **no new deps** per D-01; the planner adds an audit-trail comment recording the rejected `crc` crate so future readers know it was considered.

**Recommended insert** (mirror `Cargo.toml:18-22` comment shape):

```toml
[dependencies]
# vte::Parser + Perform drives the production VT52 parser per ADR-001. Pinned to
# exactly 0.15 so a silent `cargo update` cannot drift the `Parser::advance`
# signature out from under us — see ADR-001 "Negative" consequences.
vte = "=0.15"

# SLIDE Phase 7 (D-01): the `crc = "=3.4"` crate was REJECTED in favour of a
# ~30-line hand-roll in src/slide/crc.rs verbatim from
# /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30. Zero new
# dependencies, byte-for-byte cross-validation against slide-rs is 1:1.
# See `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` and
# 07-CONTEXT.md §D-01.
```

**Do NOT add to `[dependencies]`.** The comment is purely audit-trail.

---

### `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` (decision record)

**Analog:** `.planning/decisions/ADR-001-parser-strategy.md` + `.planning/decisions/ADR-002-wasm-gating.md` — **direct mirror** of the Nygard structure.

**Required sections** (extracted from ADR-001/ADR-002 shape):

```markdown
# ADR-003: SLIDE v0.2.1 CAN-Bidirectional Amendment

**Status:** Accepted
**Date:** 2026-05-?? (planner fills)
**Phase:** 07-slide-rust-core-framer-crc-state-machine
**Deciders:** ant (project author)

## Context
[Why an amendment is needed; cite SLIDE-04, PITFALLS §5, ARCHITECTURE.md §7,
07-CONTEXT.md D-05/D-06/D-07.]

## Decision
[Strict bidirectional echo (D-05); cancel() / force_idle() API (D-06);
silent-drain semantics in CancelPending (D-07); CTRL_CAN exact wire format
(raw 0x18 vs framed — resolve from slide-rs/protocol.rs:199-206 at planning
time per CONTEXT "Claude's Discretion").]

## Consequences
**Positive:** [hard-fail recovery; aligns with SLIDE-04 wording; …]
**Negative:** [adds an upstream-divergent contract; documents the gap;
Phase 12 must coordinate the slide-rs PR.]

## Rejected Alternatives
- "Initiator-only no echo" — leaves Phase 10's hard-fail recovery weaker.
- "PC-initiated only" — conflicts with SLIDE-04 "bidirectional" wording.

## Cross-link
- Upstream PR target: github.com/blowback/slide
  (Phase 12 dependency per `docs/SLIDE_Z80_REQUIREMENT.md`)
- 07-CONTEXT.md D-05 / D-06 / D-07 / D-08
- ARCHITECTURE.md §7 cancellation propagation
- PITFALLS.md §5 cancellation race

## References
[Same shape as ADR-001:160-184 / ADR-002 — list every primary source.]
```

---

## Shared Patterns

### Pure-Rust + wasm-free invariant (applies to every new `slide/` source file)

**Source:** `crates/bestialitty-core/src/lib.rs:11-14` doc comment + `tests/core_02_no_browser_deps.rs:55-67` `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` table.

**Apply to:** every file in `crates/bestialitty-core/src/slide/`.

```rust
//! Architectural rule (CLAUDE.md + D-20): NO `wasm_bindgen`, NO `web_sys`,
//! NO `js_sys`, NO `std::time`. `tests/core_02_no_browser_deps.rs` enforces
//! this — the test walks every .rs file under `src/` and rejects forbidden
//! tokens. `lib.rs` is the ONLY file with a `wasm_bindgen` exemption (D-07).
```

**Optional extension** (RESEARCH Wave 0 Gaps line 1564 marks this OPTIONAL): extend `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` in `tests/core_02_no_browser_deps.rs:63-67` to add `("std::time", &[])` so the no-time invariant is automated. The planner decides whether to include this in Phase 7 scope.

### Silent discard on malformed input (Phase 1 D-15)

**Source:** `crates/bestialitty-core/src/vt52.rs:73-82` Idle-arm pattern (vte's `print` for chars; unrecognised C0 falls through `execute` with no state change).

**Apply to:** `slide/framer.rs` `FramerState::Idle` arm + every "unexpected byte for current state" branch.

```rust
// Phase 1 D-15: malformed bytes silently advance the read position. No
// state change, no event emission, no panic. Returning to a safe state
// (Idle) is the only side-effect when garbage interrupts a half-received
// frame.
_ => EVT_NONE,
```

### Stable-pointer ring buffer (Phase 1 D-17 + Phase 2 host_reply)

**Source:** `crates/bestialitty-core/src/terminal.rs:107-123` (host_reply ptr/len/clear) + `crates/bestialitty-core/src/lib.rs:83-95` (wasm-bindgen wrapping; informational — Phase 7 doesn't touch lib.rs's wasm boundary).

**Apply to:** `slide/state.rs` `outbound_buf` + `outbound_ptr` / `outbound_len` / `clear_outbound`. Pre-reserve at `Slide::new()` (≥16 bytes; bounded by RDY+ACK+seq+NAK+seq+CAN+FIN ≤ 7 bytes plus headroom). `Vec::clear()` preserves capacity → next `Vec::push` reuses allocation → pointer stable across feed cycles in steady state.

### Per-module `#[cfg(test)] mod tests { use super::*; }` blocks

**Source:** `crates/bestialitty-core/src/key.rs:179-181`, `crates/bestialitty-core/src/terminal.rs:435-441`, `crates/bestialitty-core/src/vt52.rs:189-200`.

**Apply to:** every `slide/{crc,framer,state}.rs` file, in addition to the `slide/tests.rs` module-level integration smoke and `tests/slide_*.rs` external integration tests. Both styles, per CONTEXT "Native test layout".

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn s() -> Slide { Slide::new() }      // mirror terminal.rs:439-441 `fn t()`

    #[test]
    fn descriptive_test_name_one_assertion_per_test() {
        // ...
    }
}
```

### Compile-time-pinned API shape via fn-pointer coercion

**Source:** `crates/bestialitty-core/tests/boundary_api_shape.rs:280-318`.

**Apply to:** `tests/slide_boundary_shape.rs` for every Phase-8-bound method on `Slide`. Function-pointer coercion catches `&self` ↔ `&mut self`, return type, and arg-count drift at compile time — strictly stronger than runtime call-site assertions.

```rust
// Compile-time pin: a future signature drift fails to compile here.
let _: fn(&Slide) -> *const u8   = Slide::outbound_ptr;
let _: fn(&mut Slide)            = Slide::clear_outbound;
let _: fn(&mut Slide, u8) -> u32 = Slide::feed_byte;
```

### Module-doc header conventions

**Source:** every pure-Rust file in `crates/bestialitty-core/src/` opens with a `//!` doc block following this shape:

1. One-line module summary (what the module owns).
2. Bullet list of key types / contracts (`- Field/Type — purpose; D-X reference`).
3. D-20 / wasm-free reminder when applicable (mirror `terminal.rs:7-8`, `vt52.rs:31-34`).

**Apply to:** every new file in `slide/`. Naming + comment style: terse, factual, with `D-XX` cross-references to the locked decisions in 07-CONTEXT.md.

---

## No Analog Found

| File | Role | Reason | Fallback |
|---|---|---|---|
| `crates/bestialitty-core/src/slide/tests_only.rs` | test-only `pub` re-export shim | No Phase 1 file uses this pattern. CONTEXT D-03 is the first introduction. | Synthesised shape under §`tests_only.rs` above; planner uses RESEARCH §Test Corpus Byte Vectors for the const fixture content. |
| `Slide::cancel()` / `Slide::force_idle()` API design | event-driven idempotent state mutator | No Phase 1 method has the "idempotent + event-driven + JS-owned-timing" combination. | RESEARCH §"Slide Struct Shape Proposal" (07-RESEARCH.md:862-925) plus the §`state.rs` excerpt above. |
| Packed-u32 event constants (`EVT_FRAME_OK` etc.) | enum-of-events as `const u32` | Phase 1's `cursor_packed` is a single packed value, not an enum. | RESEARCH §Pattern 3 (07-RESEARCH.md:382-392) + §"Event kinds" (lines 840-861) — copy the constant list verbatim. |

---

## Metadata

**Analog search scope:**
- `crates/bestialitty-core/src/` — every `.rs` file
- `crates/bestialitty-core/tests/` — every `.rs` file
- `crates/bestialitty-core/Cargo.toml`
- `.planning/decisions/ADR-001-parser-strategy.md`, `.planning/decisions/ADR-002-wasm-gating.md`
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` (D-01 verbatim source)

**Files scanned:** 11 in core crate src/tests; 2 ADRs; 1 upstream slide-rs file (CRC source only).

**Pattern extraction date:** 2026-05-06

**Key recurring patterns identified:**
1. Every pure-Rust module opens with a `//!` header naming the D-XX decisions it implements (mirror `terminal.rs:1-8`, `vt52.rs:1-34`).
2. Stable-pointer ring buffers (`Vec<u8>` pre-reserved + `_ptr` / `_len` / `clear_*` triple) are the canonical "emit bytes from Rust to JS" pattern (mirror `terminal.rs:107-123`).
3. Byte-fed state machines carry their state as a `Clone, Copy` enum on a long-lived struct; transitions happen in a single `match` per call; torn-chunk safety is a side-effect (mirror `vt52.rs:39-47, 162-181`).
4. API shape is pinned twice: at the `pub` boundary of the in-crate `#[cfg(test)] mod tests` block (semantic correctness), AND at the integration-test boundary under `tests/` via fn-pointer coercion (compile-time drift detection — `boundary_api_shape.rs:280-318`).
5. `tests/core_02_no_browser_deps.rs` is the architectural-invariant gate; every new file under `src/` is auto-checked for `wasm_bindgen` / `web_sys` / `js_sys` tokens. Phase 7 keeps this green by adhering to D-20 in every new file.
6. ADRs follow Nygard structure (Status / Date / Phase / Deciders / Context / Decision / Consequences / Rejected Alternative / References) — `ADR-001` and `ADR-002` are the templates for `ADR-003`.
