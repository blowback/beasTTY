---
phase: 07-slide-rust-core-framer-crc-state-machine
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - crates/bestialitty-core/Cargo.toml
  - crates/bestialitty-core/src/lib.rs
  - crates/bestialitty-core/src/slide/crc.rs
  - crates/bestialitty-core/src/slide/framer.rs
  - crates/bestialitty-core/src/slide/mod.rs
  - crates/bestialitty-core/src/slide/state.rs
  - crates/bestialitty-core/src/slide/tests.rs
  - crates/bestialitty-core/src/slide/tests_only.rs
  - crates/bestialitty-core/tests/core_02_no_browser_deps.rs
  - crates/bestialitty-core/tests/slide_boundary_shape.rs
  - crates/bestialitty-core/tests/slide_idempotent_reentry.rs
  - crates/bestialitty-core/tests/slide_reference_corpus.rs
  - crates/bestialitty-core/tests/slide_torn_chunk.rs
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 7 delivers a clean, well-architected SLIDE protocol Rust core. The
implementation is idiomatic, panic-free on user input, has zero `unsafe`
in production code, respects the locked decisions (D-01 verbatim CRC, D-03
`pub(crate)` scoping, D-05/D-06/D-07 cancel semantics, D-20 wasm-free core),
and ships a strong test suite (CRC catalogue pin, 7 reference fixtures,
torn-chunk corpus, idempotent re-entry corpus, boundary-shape pin).

No critical (security / data-loss / crash) issues were found. All findings
are correctness/quality refinements:

- **WR-01** is the most significant: a CRC mid-flight on a malformed frame
  is left in `crc_input_buf` with no reset path, which can cause a *latent*
  spurious EVT_CRC_ERROR on the *next* frame if the framer is interrupted
  mid-frame by a control byte (e.g. peer CAN, or a re-entry via
  `enter_recv_mode`).
- **WR-02** flags an off-by-one ambiguity in the documented vs implemented
  NAK_BUDGET semantics.
- **WR-03** flags a missing transition for unexpected mid-frame control
  bytes (peer sends CTRL_RDY mid-DataPhase — currently silently
  swallowed by the framer's WaitingSeq path because RDY happens to equal
  0x11 which is a valid SEQ byte).
- **WR-04** flags potential u8 wrap-around on `expected_seq` interacting
  with the WIN_SIZE ACK heuristic in long sessions.

The Info items are all stylistic / hardening suggestions.

## Warnings

### WR-01: Framer CRC scope buffer not reset on out-of-band re-entry

**File:** `crates/bestialitty-core/src/slide/framer.rs:122-127`, `state.rs:102-105`
**Issue:**

The framer's `crc_input_buf` is only reset to empty in the `Idle → SOF`
branch (`framer.rs:93-94`). If the SM is interrupted mid-frame — for
example, a peer-initiated CTRL_CAN arrives while the framer is in
`ReadingPayload` (state.rs handles CAN at the SM level *before* the
framer.step call would push the byte) — the framer state machine resets
to `Idle` only on the *next* SOF, not immediately. Concretely, look at
this sequence:

1. Framer is in `ReadingPayload { seq: 1, remaining: 5 }`,
   `crc_input_buf` holds `[0x01, 0x00, 0x05, b'h', b'e']`
2. Peer sends CTRL_CAN. State machine intercepts at
   `state.rs:210-216`, transitions to `CancelPending`, but **does not
   call `framer.step(CTRL_CAN)`**, so the framer is still in
   `ReadingPayload` with stale `crc_input_buf` contents.
3. JS later calls `Slide::new()` for a fresh session — this is the safe
   path. *But* if a future code path reuses the same `Slide` instance
   (none currently — but `enter_recv_mode` looks like it might be such
   an entry point in Phase 9 for sender mode), the next SOF would
   correctly clear the buffer (line 93). So this is currently a latent
   issue, not an active one.

The latent bug is in `enter_recv_mode` (state.rs:102-105): it sets
`sm_state = WaitingRdy` but does **not** reset the framer. If JS
mistakenly calls `enter_recv_mode` mid-session (a misuse), the framer
will be in some partial state. The framer's auto-recovery on next SOF
saves us, but we have no test that pins this.

Additionally, for state.rs's CancelPending transition: when peer-CAN
arrives mid-frame, `framer.step(CTRL_CAN)` is bypassed, so the
framer's own state is whatever it was (e.g. `ReadingPayload`).
If the receiver later transitions out of CancelPending into Done
and JS opens a new `Slide`, this is fine. But the implicit assumption
that "framer state after CancelPending is don't-care" is not pinned.

**Fix:**

Either (a) add a `Framer::reset()` that JS-side wrappers can call, or
(b) clear the framer state explicitly in `enter_recv_mode` and on the
peer-CAN-intercept path:

```rust
impl Framer {
    /// Drop any in-flight frame state. Used by SM-level intercepts
    /// (CTRL_CAN handled before framer.step) and by enter_recv_mode
    /// to defend against caller misuse.
    pub fn reset(&mut self) {
        self.state = FramerState::Idle;
        self.crc_input_buf.clear();
        self.payload_buf.clear();
    }
}

// In state.rs:
pub fn enter_recv_mode(&mut self) {
    self.role = SlideRole::Receiver;
    self.sm_state = SlideState::WaitingRdy;
    self.framer.reset();  // defend against re-entry mid-frame
}

// In handle_framer_event peer-CAN intercept:
if evt == EVT_CAN && !matches!(...) {
    self.outbound_buf.push(CTRL_CAN);
    self.sm_state = SlideState::CancelPending;
    // Note: framer.step already advanced; framer is back in Idle from
    //       the Idle-state CTRL_CAN match at framer.rs:99. So this
    //       case is OK, but pin it with a test:
    //   `peer_can_mid_payload_resets_framer_to_idle()`.
    return;
}
```

Minimum: add a regression test
`peer_can_during_reading_payload_resets_framer` that drives the framer
into `ReadingPayload`, fires CTRL_CAN, then asserts `framer.state() ==
FramerState::Idle`. (It currently won't be — the byte goes through
`framer.step` while in `ReadingPayload`, gets pushed to crc_input_buf
and payload_buf, and the framer transitions further into the frame
parse, treating CTRL_CAN as a payload byte. The SM CAN intercept *only*
fires on `EVT_CAN`, which only the framer's `Idle` arm produces.)

This is **the most important finding in this review.** A mid-payload
peer CAN is currently handled *only* by silent payload accumulation
until CRC eventually fails (then EVT_CRC_ERROR is emitted, which is
a state-mismatched response in DataPhase — we'd NAK instead of CAN-echo).

### WR-02: NAK_BUDGET off-by-one between doc comment and assertion

**File:** `crates/bestialitty-core/src/slide/state.rs:29-31`, `state.rs:255`, `state.rs:454-466`
**Issue:**

The constant doc says "Maximum CRC-error retry count before SM transitions
to Error (slide-rs/recv.rs:142)" with `NAK_BUDGET: u32 = 15`.

The check is `if self.nak_retry_count > NAK_BUDGET`, i.e. transition
fires when count reaches **16**. The test `nak_budget_exhaustion_transitions_to_error`
loops 16 times and expects Error state — which matches the strict-greater-than
check, not the doc comment.

So either:
- The constant should be `NAK_BUDGET: u32 = 16` ("max retries allowed"), with
  the check unchanged, OR
- The check should be `>= NAK_BUDGET` so that the 15th NAK transitions
  (matching "15 max retries"), OR
- The doc should clarify "after 15 retries, the 16th CRC error transitions
  to Error".

Cross-reference slide-rs/recv.rs:142 to confirm which semantic is correct
on the wire. If slide-rs uses `>= 15` (transitions on 15th error),
this is a **correctness divergence** from the reference; if slide-rs
uses `> 15` (transitions on 16th), only the doc is misleading.

**Fix:**

Read `slide-rs/recv.rs:142` and pin the semantic explicitly:

```rust
/// Maximum CRC-error retry count before SM transitions to Error.
/// Matches slide-rs/recv.rs:142 — we transition on the 16th consecutive
/// CRC error (i.e., after 15 successful NAK responses, the 16th attempt
/// gives up). Equivalent: `nak_retry_count > 15` triggers Error.
const NAK_BUDGET: u32 = 15;
```

Or, if slide-rs actually transitions on the 15th:

```rust
const NAK_BUDGET: u32 = 15;
// ...
self.nak_retry_count += 1;
if self.nak_retry_count >= NAK_BUDGET {
    self.sm_state = SlideState::Error;
}
```

The test should then loop 15 times, not 16.

### WR-03: CTRL_RDY (0x11) collides with valid SEQ byte during WaitingSeq

**File:** `crates/bestialitty-core/src/slide/framer.rs:122-127`
**Issue:**

After SOF, the framer enters `WaitingSeq` and accepts ANY byte as the SEQ
field, including byte `0x11` (which is `CTRL_RDY` in the wire vocabulary).
This is *technically* spec-compliant — SEQ is a u8 and any value is legal —
but it means a **stray peer CTRL_RDY mid-frame is silently absorbed as
data**, with the surrounding bytes interpreted as LEN, payload, CRC.

Worse: `CTRL_FIN = 0x04`, `CTRL_ACK = 0x06`, `CTRL_NAK = 0x15`,
`CTRL_CAN = 0x18` all collide with valid SEQ bytes too. So **any
out-of-band control byte that arrives between SOF and CRC is silently
swallowed by the in-flight frame.**

This is consistent with the SLIDE wire protocol design (control bytes are
unframed and have no escape mechanism — relying on stat. probability
that mid-frame collisions are rare). Per Phase 1 D-15 silent-discard,
this is acceptable behaviour. But the receiver SM has no defense
against the specific case where a mid-frame **CTRL_CAN** arrives:

- If CTRL_CAN arrives at Idle: emits EVT_CAN, SM cancels (correct).
- If CTRL_CAN arrives mid-frame (any state ≠ Idle in the framer):
  silently consumed as SEQ/LEN/payload/CRC byte. The peer-CAN echo
  required by D-05 strict bidirectional **does not fire** until the
  current frame completes (with a likely CRC error if the CAN byte
  was misinterpreted), and then only if the CAN happens to be the
  *first* byte of the next attempted frame.

This is a real protocol gap, not just a doc nit. PITFALLS §1 calls it
out indirectly: framers are byte-fed and have no frame delimiter
escape, so true mid-frame CAN preemption is impossible — the SLIDE
spec itself accepts this.

**Fix:**

This is a spec-level limitation, not a fixable bug. But:

1. Document it explicitly in `framer.rs` module header so future
   maintainers (and Phase 9 sender-side authors) don't waste time
   wondering why we don't preempt:

```rust
//! NOTE: SLIDE wire protocol has no byte-stuffing or escape mechanism.
//! Control bytes (RDY=0x11, FIN=0x04, ACK=0x06, NAK=0x15, CAN=0x18)
//! collide with valid SEQ/LEN/PAYLOAD byte values. A control byte
//! arriving mid-frame is silently absorbed by the in-flight frame
//! parse and will most likely cause a CRC error (which, in DataPhase,
//! produces a NAK — *not* a CAN echo). Peer-initiated mid-frame CAN
//! is therefore best-effort: detection latency is bounded by the
//! current frame's remaining byte count.
```

2. Consider adding a test that pins this expected behaviour so it
   doesn't regress:

```rust
#[test]
fn ctrl_can_mid_frame_is_absorbed_as_payload_byte() {
    // SLIDE has no escape mechanism; a CAN byte mid-frame is treated
    // as payload, not a control byte. Pin this behaviour.
    let mut fr = Framer::new();
    fr.step(SOF);                    // → WaitingSeq
    fr.step(0x01);                   // SEQ=1
    fr.step(0x00);                   // LEN_H
    fr.step(0x02);                   // LEN_L=2
    fr.step(CTRL_CAN);               // payload byte 0 — NOT a control byte
    fr.step(b'X');                   // payload byte 1
    // CRC verification will fail — that's expected for this synthetic frame.
    // The point is: framer never emitted EVT_CAN.
    let evt = fr.step(0x00);          // CRC_H (bogus)
    let evt2 = fr.step(0x00);         // CRC_L (bogus)
    assert_eq!(evt, EVT_NONE);
    // evt2 will be EVT_CRC_ERROR, not EVT_CAN.
    assert_eq!(evt2 & 0xFFFF_0000, EVT_CRC_ERROR);
}
```

### WR-04: u8 expected_seq wrap-around may produce premature window ACK

**File:** `crates/bestialitty-core/src/slide/state.rs:276-282`
**Issue:**

The window-boundary ACK heuristic is:

```rust
self.expected_seq = self.expected_seq.wrapping_add(1);
let last_acked = self.expected_seq.wrapping_sub(1);
if last_acked & (WIN_SIZE - 1) == 0 {
    self.outbound_buf.push(CTRL_ACK);
    self.outbound_buf.push(last_acked);
}
```

`WIN_SIZE = 4` so `(WIN_SIZE - 1) = 3 = 0b11`. The check fires when
`last_acked` ends in `00` — i.e., 0, 4, 8, 12, …, 252, **0**, 4, …
After accepting seq 252, last_acked=252, ACK fires. After 253, 254, 255,
nothing. After accepting "256" (which wraps to 0), last_acked=0, ACK fires
on the **first frame after wrap**, which is one frame too early relative
to the window cadence (we'd expect the next ACK at last_acked=4, not 0).

This is *not* a wire-correctness bug per se — sending an "extra" ACK is
always safe in a sliding-window protocol — but it diverges from
slide-rs/recv.rs:206-212's behaviour, which (per the citation) sends
ACK every WIN_SIZE frames *strictly counted*, not modulo wrap.

If the SLIDE spec intends "ACK every 4th frame from session start"
versus "ACK whenever count is a multiple of 4 modulo 256", those
diverge after frame 256.

In practice: this only affects sessions of >256 frames, which at
1024-byte payloads is >256 KiB — well within the realistic file
size range for the MicroBeast use case. So it's exercised in real use.

**Fix:**

Either:

1. Use a separate counter to track "frames accepted since last ACK",
   reset on window boundary, with no wrap concern:

```rust
self.frames_since_ack += 1;
if self.frames_since_ack as u8 == WIN_SIZE {
    self.frames_since_ack = 0;
    self.outbound_buf.push(CTRL_ACK);
    self.outbound_buf.push(last_acked);
}
```

2. Verify against slide-rs/recv.rs:206-212 exactly (read the source) and
   add a test case that drives 260 frames through the SM and asserts
   the ACK count and timing match slide-rs's. If slide-rs has the same
   wrap quirk, document it as wire-compatible behaviour. Otherwise, fix.

Minimum: add a `data_phase_window_ack_after_seq_wrap` test that exercises
the seq=255→0 transition.

## Info

### IN-01: Magic numbers in event packing should be named

**File:** `crates/bestialitty-core/src/slide/state.rs:206`, `framer.rs:171, 175`
**Issue:**

Event packing uses bare `0xFFFF` and `0xFFFF_0000` masks throughout:

```rust
let aux = (evt & 0xFFFF) as u8;
// ...
(SlideState::HeaderPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
```

Each constant is a magic number that re-encodes the
`(kind << 16) | aux` packing convention from `framer.rs:31`. If that
convention ever changes (e.g., to `(kind << 24) | aux` for a 24-bit aux
field, or some such), every site would need to be hunted down.

**Fix:**

Hoist the masks into named constants in `framer.rs` next to the EVT_*
constants:

```rust
// Event packing layout: (kind << EVT_KIND_SHIFT) | aux.
pub const EVT_KIND_SHIFT: u32 = 16;
pub const EVT_KIND_MASK:  u32 = 0xFFFF_0000;
pub const EVT_AUX_MASK:   u32 = 0x0000_FFFF;
```

Then use them at every site. This also makes the JS-side decode
(`evt >>> 16` for kind, `evt & 0xFFFF` for aux) explicit at the Rust
boundary.

### IN-02: `_ => EVT_NONE` unreachable arm should `unreachable!()`

**File:** `crates/bestialitty-core/src/slide/framer.rs:118`
**Issue:**

```rust
FramerState::AfterAckOrNak(ctrl) => {
    self.state = FramerState::Idle;
    match ctrl {
        CTRL_ACK => EVT_ACK | (b as u32),
        CTRL_NAK => EVT_NAK | (b as u32),
        _ => EVT_NONE,  // unreachable in practice
    }
}
```

`AfterAckOrNak(ctrl)` is only constructed at `framer.rs:101, 105` with
the literal arguments `CTRL_ACK` and `CTRL_NAK`. The `_ => EVT_NONE` arm
is dead code that silently masks any future bug where `AfterAckOrNak` is
constructed with an unexpected ctrl.

**Fix:**

```rust
_ => unreachable!("AfterAckOrNak only carries CTRL_ACK or CTRL_NAK; constructed at lines 101, 105"),
```

Or refactor `AfterAckOrNak` to carry a typed enum (`AckOrNak::Ack` /
`AckOrNak::Nak`) so the impossibility is encoded in the type system and
the `_` arm vanishes entirely.

This would arguably be cleaner:

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum AckOrNak { Ack, Nak }

// ...
AfterAckOrNak(AckOrNak),
// ...
FramerState::AfterAckOrNak(kind) => {
    self.state = FramerState::Idle;
    match kind {
        AckOrNak::Ack => EVT_ACK | (b as u32),
        AckOrNak::Nak => EVT_NAK | (b as u32),
    }
}
```

### IN-03: `SlideState::FinPending` is declared but never referenced

**File:** `crates/bestialitty-core/src/slide/state.rs:50`
**Issue:**

`FinPending = 4` is a declared variant but no code path reads or writes
it. The boundary-shape test pins its u32 value, but there's no SM
transition that uses it.

This is fine for Phase 7 (sender-side transitions land in Phase 9, which
is when FinPending becomes load-bearing — the sender uses it to track
"sent FIN, waiting for peer's FIN echo"). But future maintainers will
see an unused variant and wonder.

**Fix:**

Add a doc comment explicitly noting the deferred use:

```rust
/// Sender-side: FIN sent, waiting for peer's FIN echo. Phase 7 is
/// receiver-only; this variant is wired up in Phase 9. Pinned as a
/// repr(u32) value here so the JS-side enum mapping (Phase 8) doesn't
/// renumber when Phase 9 lands.
FinPending    = 4,
```

### IN-04: `#[allow(dead_code)]` on `role` field hints at incomplete design

**File:** `crates/bestialitty-core/src/slide/state.rs:69-70`
**Issue:**

```rust
#[allow(dead_code)]
role: SlideRole,
```

The `role` field is set but never read. Like `FinPending`, this is
intentionally preserved for Phase 9. But `#[allow(dead_code)]` is a
broader hammer than needed — it suppresses *all* dead-code warnings on
that field, including ones we'd want to know about (e.g., if Phase 9
ships and `role` is still unused, we should re-enable the warning).

**Fix:**

Add a TODO with a phase pin and consider tightening the allow:

```rust
// Phase 9 will read this in handle_framer_event to dispatch sender-vs-receiver
// transitions. Keep field+enter_send_mode wired up in Phase 7 to avoid
// landing them in a churny phase-boundary diff.
#[allow(dead_code, reason = "Phase 9 sender SM will read this field")]
role: SlideRole,
```

(Note: `#[allow(_, reason = "...")]` requires Rust 1.81+; if MSRV is lower,
just keep the comment above the attribute.)

### IN-05: Test fixture-byte arrays use raw `unsafe { from_raw_parts }` repeatedly

**File:** `crates/bestialitty-core/src/slide/state.rs:358, 372, 401, 419, 435, 448, 495`, `tests/slide_idempotent_reentry.rs:14`, `tests/slide_torn_chunk.rs:20`
**Issue:**

The pattern

```rust
let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
```

is repeated ~10x in the test code. While each call is sound (the SAFETY
comment is correct: `outbound_ptr` is non-null and `outbound_len` is the
true valid length), repeating raw pointer ops in tests is a foot-gun
nursery — a single typo (e.g., `outbound_len() + 1`) silently produces
UB.

The integration test files already factor this into `outbound_snapshot`
(see `slide_idempotent_reentry.rs:11-15`, `slide_torn_chunk.rs:14-21`),
but the unit tests in `state.rs` inline it.

**Fix:**

Add a safe accessor on `Slide` for tests (or a `#[cfg(test)]` helper) that
returns `&[u8]`:

```rust
impl Slide {
    /// Test-only safe view into the outbound buffer.
    #[cfg(test)]
    pub fn outbound_slice(&self) -> &[u8] {
        &self.outbound_buf
    }
}
```

Then unit tests collapse to:

```rust
assert_eq!(slide.outbound_slice(), &[CTRL_RDY]);
```

Integration tests can keep `outbound_snapshot` (since they live outside
the crate and can't see `#[cfg(test)]`).

This both eliminates the unsafe-block repetition and gives a more
readable assertion site.

### IN-06: `events: VecDeque` push without bound; capacity could grow unboundedly

**File:** `crates/bestialitty-core/src/slide/state.rs:84, 143`
**Issue:**

`events` is pre-reserved at `EVENT_RING_RESERVE = 32` but `push_back`
is unbounded. If JS forgets to call `take_event_packed` after a
`feed_chunk` (or calls feed_chunk faster than it drains), the deque
grows linearly. For the MicroBeast use case (115200 baud → ~12 KiB/s
of inbound bytes max → at most a few events per ms), the practical
risk is low, but a runaway test with a large fixture could grow
memory.

**Fix:**

This is borderline between Info and Warning; the practical risk is low
because JS owns the drain cadence per the API contract. Two options:

1. **Document the contract** in the `events` field comment: "JS MUST drain
   via take_event_packed after every feed_chunk. Failure to drain leaks
   memory."

2. **Bounded-replace policy**: drop oldest event when at capacity:

```rust
fn push_event(&mut self, evt: u32) {
    if self.events.len() == EVENT_RING_RESERVE {
        self.events.pop_front();
    }
    self.events.push_back(evt);
}
```

Option 2 is safer but changes the semantics (events can be lost, JS
must be ready for that). Option 1 is the lower-cost choice for v1.

### IN-07: `vt52` and `vt52` boundary tests not run on wasm32 target

**File:** `crates/bestialitty-core/tests/core_02_no_browser_deps.rs:78-120`
**Issue:**

`dependency_graph_excludes_browser_crates` runs `cargo metadata` for the
default target, which on the dev host is `x86_64-unknown-linux-gnu` (or
similar native). The wasm32 target has its own dep graph (with
wasm-bindgen) that this test does NOT exercise.

The current logic *correctly* excludes wasm-bindgen from FORBIDDEN_CRATES
per the comment at line 39, so the test passes for native. But it
doesn't actively *verify* that the wasm32 graph contains *only*
wasm-bindgen and not, say, web-sys via some transitive dep that gets
introduced by Phase 8.

**Fix:**

Add a separate test (or extend this one) that runs:

```bash
cargo metadata --filter-platform wasm32-unknown-unknown --format-version=1
```

…and asserts that even on wasm32, web-sys / js-sys / gloo-* are absent.
This is a future-proofing assertion for Phase 8.

```rust
#[test]
fn dependency_graph_wasm32_excludes_browser_crates_except_wasm_bindgen() {
    let output = Command::new(env!("CARGO"))
        .args([
            "metadata",
            "--filter-platform=wasm32-unknown-unknown",
            "--format-version=1",
        ])
        .output()
        .expect("cargo metadata --filter-platform=wasm32 should succeed");

    assert!(output.status.success(), "cargo metadata wasm32 failed: {}",
        String::from_utf8_lossy(&output.stderr));

    let stdout = String::from_utf8_lossy(&output.stdout);

    // wasm32 IS allowed wasm-bindgen but nothing else from the
    // browser ecosystem.
    for forbidden in FORBIDDEN_CRATES {
        // FORBIDDEN_CRATES already excludes wasm-bindgen.
        let needle = format!("\"name\":\"{}\"", forbidden);
        assert!(
            !stdout.contains(&needle),
            "wasm32 dep graph contains forbidden browser crate {}",
            forbidden
        );
    }
}
```

This test would also catch a Phase 8 regression where someone adds
web-sys to wrap a wasm-only feature.

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
