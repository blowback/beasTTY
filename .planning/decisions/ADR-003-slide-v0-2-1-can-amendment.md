# ADR-003: SLIDE v0.2.1 CAN-Bidirectional Amendment

**Status:** Accepted
**Date:** 2026-05-06
**Phase:** 07-slide-rust-core-framer-crc-state-machine
**Deciders:** ant (project author)

## Context

The SLIDE v0.2 spec at `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` defines
`CTRL_CAN = 0x18` as a cancellation signal but specifies an asymmetric
contract: only the receiver (Z80) emits CAN. The reference implementations
`/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:104` (`recv_control`
consumes 0x18) and `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py:64-71`
(Python receive path) accept inbound CAN; neither implementation has a
sender-emits-CAN path.

BestialiTTY v1.1 needs PC-initiated cancellation: the user clicks the
floating chip's Cancel button (Phase 11) or hits Esc mid-transfer
(REQUIREMENTS.md SLIDE-27, SLIDE-30). The PC is the sender during host →
Z80 transfers (Phase 9) and the receiver during Z80 → PC transfers
(Phase 10); cancellation must work in both directions, neutrally leaving
the wire ready for the next session without `reader.cancel()` /
`port.close()` (PITFALLS §5, BLOCKING).

A naive PC-side `port.write(&[0x18])` without a documented Z80 contract
leaves the wire desync'd: the Z80 may not know whether to abort its
current state machine, may finish writing the current frame, or may
interpret 0x18 as in-band data. PITFALLS §5 calls this BLOCKING for
cancellation correctness.

07-CONTEXT.md decisions D-05 / D-06 / D-07 lock the resolution at the
discuss-phase: strict bidirectional echo, idempotent `cancel()` /
`force_idle()` API, silent-drain semantics in CancelPending. D-08
requires this ADR document the resulting amendment formally so that
`docs/SLIDE_Z80_REQUIREMENT.md` (Phase 12 deliverable) and the upstream
`github.com/blowback/slide` PR (Phase 12 dependency) can both reference it.

## Decision

BestialiTTY adopts the **SLIDE v0.2.1 CAN-bidirectional amendment**:

1. **Strict bidirectional echo (D-05).** Either side MAY initiate
   `CTRL_CAN`. The other side MUST echo `CTRL_CAN` back. Both sides then
   drain the wire and return to idle. The amendment makes CAN symmetric;
   previously only the receiver could emit it.

2. **CTRL_CAN wire format: raw single byte 0x18, NOT a wrapped frame.**
   Cited evidence:
   - `slide-rs/src/protocol.rs:104` — `CTRL_CAN => return Ok(Control::Can),` —
     `recv_control` reads a single byte and immediately returns Can.
     No SOF, no SEQ, no LEN, no CRC follow.
   - `slide-rs/src/protocol.rs:199-206` — `send_control` writes `&[ctrl]`
     (and optionally a seq for ACK/NAK only). For CAN, `seq: None`, so
     `port.write_all(&[0x18])` — a single byte.
   - `slide-py/slide/common.py:64-71` — Python reference: `ctrl in (CTRL_RDY,
     CTRL_CAN, CTRL_FIN): return (ctrl, None)` — same single-byte shape.
   - **Symmetry argument:** RDY (0x11) and FIN (0x04) are both raw single
     bytes. CAN sits in the same family. Wrapping CAN in a frame envelope
     would (a) require the Z80 to mid-state-machine-pause to validate CRC,
     (b) add ~5 bytes of latency to a critical-path cancel signal,
     (c) diverge from RDY/FIN/ACK shape conventions, and (d) break wire
     compatibility with stock unmodified slide.com (which receives
     single-byte CAN per `slide-rs/src/protocol.rs:104`).

   The amendment adds a *behaviour* (Z80 must echo back when it sees CAN;
   v0.2.1 sender now sends CAN, where v0.2 only ever received it), not
   a new wire shape.

3. **Idempotent host-initiated cancel API (D-06).** The Rust SM exposes:

   ```rust
   pub fn cancel(&mut self);       // builds CTRL_CAN, transitions to CancelPending; idempotent
   pub fn force_idle(&mut self);   // forcibly transitions to Done (JS escape hatch)
   ```

   Implemented in `crates/bestialitty-core/src/slide/state.rs`. `cancel()`
   is fire-and-set-state: it pushes `CTRL_CAN = 0x18` onto `outbound_buf`
   and transitions `sm_state` to `CancelPending`. Calling `cancel()` while
   already in `CancelPending` (or `Done` / `Error`) is a no-op — the
   second call does NOT push another CTRL_CAN. JS owns timing windows
   (200 ms in-flight settle / 500 ms echo wait / 100 ms drain / 2 s
   absolute timeout per PITFALLS §5); Rust SM is purely event-driven.
   `force_idle()` is the JS escape hatch after the absolute timeout: it
   drops `CancelPending` and transitions to `Done` so JS can construct
   a fresh `Slide::new()` for the next session.

4. **Silent-drain semantics in CancelPending (D-07).** While the SM is
   in `CancelPending`, `feed_byte` / `feed_chunk` silently consume
   incoming bytes (no events emitted) until a CAN echo is recognised
   → transition to `Done`. JS owns the post-echo drain window via its
   own read loop (~100 ms keeps reading + feeding, then stops). No
   byte-count threshold or quiescence detector in Rust; no time logic
   in Rust (CORE-02 invariant + ARCHITECTURE.md anti-pattern 4).

The amendment is exercised in unit tests in
`crates/bestialitty-core/src/slide/state.rs`
(`cancel_idempotent`, `peer_can_during_data_phase_echoes_and_transitions`,
`force_idle_transitions_to_done`, `cancel_pending_silent_drains_non_can_bytes`,
`cancel_pending_can_completes_session`) and in the integration corpus
`crates/bestialitty-core/tests/slide_idempotent_reentry.rs` (6 re-entry
test cases re1..re6).

## Consequences

**Positive:**
- Cancellation is symmetric and recoverable from either side. Both PC and
  Z80 can initiate; both must echo; both drain to a neutral wire.
- Phase 10's hard-fail recovery is strictly stronger than v0.2 because
  the receiver now has an authoritative way to terminate a session
  (the v0.2 spec only allowed the sender to terminate via FIN; receivers
  had to wait it out).
- The `force_idle()` escape hatch tolerates Z80 firmware that doesn't yet
  support the amendment: after JS's 2 s timeout, the session terminates
  cleanly client-side even if the Z80 never echoes back.
- All timing logic stays in JS — Rust SM is event-driven, no `std::time`,
  satisfying the CORE-02 invariant (`tests/core_02_no_browser_deps.rs`
  enforces this; Plan 07-05 Task 2 hardens it by adding `std::time` to the
  forbidden-token list).
- Idempotent `cancel()` tolerates user double-clicks on the chip's Cancel
  button without sending two CTRL_CAN bytes that could confuse the Z80.

**Negative:**
- Adds an upstream-divergent contract. Stock slide.com (running v0.2 only)
  will receive CAN from BestialiTTY but NOT echo back. The `force_idle()`
  escape hatch absorbs this — the user-visible result is a 2 s wait
  followed by a clean reset — but the wire-level behaviour is non-ideal
  until the Z80 PR lands.
- Phase 12 must coordinate the `github.com/blowback/slide` PR. Until the
  PR is accepted and the user has updated slide.com on their Z80,
  cancellation in BestialiTTY relies on the escape hatch rather than the
  echo. Phase 12's `docs/SLIDE_Z80_REQUIREMENT.md` (REQUIREMENTS.md
  SLIDE-40) will document this clearly.
- Maintaining the two-impl matrix (BestialiTTY-side amended vs slide.com-side
  stock) is fragile if Z80 firmware drifts: stale slide.com installs may
  look like a hardware fault rather than a "please update slide.com"
  situation. The Phase 11 chip's "Z80 didn't respond" timeout (SLIDE-35)
  surfaces this gracefully with a Compatibility-mode option.

## Rejected Alternatives

- **"Initiator-only no echo."** Whichever side first sends CAN simply
  transitions to a terminal state without waiting. Rejected because
  Phase 10's hard-fail recovery is strictly weaker (the non-initiator
  doesn't know the session is dead until its next read times out, and a
  multi-second fenced-off wire kills daily-driver responsiveness).
- **"PC-initiated only."** Only the PC may emit CAN; Z80 may not.
  Rejected because it conflicts with REQUIREMENTS.md SLIDE-04's
  "bidirectional" wording AND because slide-rs / slide-py / spec already
  define Z80-initiated CAN — the v0.2 spec is symmetric on receive,
  asymmetric on send; v0.2.1 closes that gap.
- **"CTRL_CAN as a wrapped frame."** Wrap 0x18 in `[SOF, SEQ, 0x00, 0x01,
  0x18, CRC_H, CRC_L]` to give it CRC integrity. Rejected per the four
  evidence points cited in the Decision section (slide-rs / slide-py
  both consume 0x18 raw, and RDY/FIN are also raw — single-byte family).

## Cross-link

- **Upstream PR target:** `github.com/blowback/slide` (Phase 12 dependency
  per REQUIREMENTS.md SLIDE-40).
- 07-CONTEXT.md §D-05 (strict bidirectional)
- 07-CONTEXT.md §D-06 (idempotent cancel + force_idle)
- 07-CONTEXT.md §D-07 (drain semantics in CancelPending)
- 07-CONTEXT.md §D-08 (this ADR is the deliverable)
- 07-RESEARCH.md §CTRL_CAN Wire Format Resolution (lines 698-725 — cited evidence)
- .planning/research/PITFALLS.md §5 (cancellation race + v0.2.1 amendment rationale)
- .planning/research/ARCHITECTURE.md §7 (cancellation propagation)
- .planning/research/ARCHITECTURE.md anti-pattern 4 (no `std::time` in core)
- REQUIREMENTS.md SLIDE-04, SLIDE-27, SLIDE-30, SLIDE-40
- `crates/bestialitty-core/src/slide/state.rs` — `pub fn cancel`, `pub fn force_idle`, CancelPending state arm
- `crates/bestialitty-core/tests/slide_idempotent_reentry.rs` — re1..re6 corpus
- ADR-001 (Parser strategy) — same Nygard structure used here
- ADR-002 (Wasm gating) — same Nygard structure used here

## References

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — authoritative v0.2 spec
  (frame format, control bytes, sliding window, NO bidirectional CAN)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30` — CRC source
  copied verbatim per CONTEXT D-01
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:104` — `recv_control`
  single-byte CAN consumption
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:199-206` —
  `send_control` single-byte CAN emission
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py:64-71` — Python
  single-byte CAN consumption (cross-validation)
- ADR-001 (Parser strategy) — same Nygard structure used here
- ADR-002 (Wasm gating) — same Nygard structure used here
- Greg Cook CRC catalogue (https://reveng.sourceforge.io/crc-catalogue/all.htm)
  — confirms CRC variant CCITT-FALSE / IBM-3740 used by SLIDE
