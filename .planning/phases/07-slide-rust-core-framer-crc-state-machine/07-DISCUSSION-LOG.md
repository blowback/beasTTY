# Phase 7: SLIDE Rust Core — Framer, CRC, State Machine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 07-slide-rust-core-framer-crc-state-machine
**Mode:** discuss (--chain)
**Areas discussed:** CRC implementation strategy, CAN v0.2.1 bidirectional amendment

---

## Gray Area Selection

The agent surfaced 4 gray areas; the user selected the strategic two and let the
remaining two (state machine event surface; Phase 7 sender vs receiver SM scope)
fall to Claude's discretion at planning time.

| Gray Area | Description | Selected |
|-----------|-------------|----------|
| CRC implementation strategy | `crc = "=3.4"` crate vs hand-rolled | ✓ |
| State machine API shape | Packed u32 events vs internal ring+drain | |
| CAN v0.2.1 bidirectional amendment | Define here vs stub-only | ✓ |
| Sender + receiver SM scope in Phase 7 | Both directions vs framer+recv only | |

---

## CRC Implementation Strategy

### Q: Which CRC implementation should `slide/crc.rs` use?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-rolled | ~30 LoC copy-paste from slide-rs/protocol.rs:16-30; zero deps; trivially auditable | ✓ |
| `crc = "=3.4"` crate, NoTable variant | Predefined CRC_16_IBM_3740; small wasm; one new dep | |
| `crc` crate, Slice16 (LUT) variant | Fastest; ~512B LUT; overkill at 19200 baud | |

**User's choice:** Hand-rolled (Recommended).
**Notes:** Aligns with Phase 1 ADR-001 preference for explicit hand-rolled DFA-style
logic; eliminates crate version drift risk against the upstream reference impl.

### Q: What CRC API shape should slide/crc.rs expose?

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot `crc16_ccitt(&[u8]) -> u16` only | Smallest surface; mirrors slide-rs `compute_crc`; framer concatenates header+payload | ✓ |
| Incremental `Crc16Ccitt::new() / update / finalize` | Streaming idiom; no real benefit at one-frame scope | |
| Both — one-shot wraps incremental | Negligible code cost; doubled API; documentation burden | |

**User's choice:** One-shot only (Recommended).

### Q: How should CRC + frame correctness be verified against slide-rs?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-coded reference vectors + small fixed corpus | Pin `0x29B1`; hand-paste 4-6 slide-rs frames as `[u8]` const fixtures | ✓ |
| Build-script subprocess to slide-rs at test time | Always-current; build-time dep on slide-rs CLI; CI complexity | |
| Vendored .bin files generated once and committed | Decoupled from slide-rs CLI presence; drift risk on regenerate | |

**User's choice:** Hand-coded reference vectors (Recommended).
**Notes:** Drift risk mitigated by SLIDE protocol being v0.2-frozen.

### Q: Should slide/crc.rs be `pub` or module-private?

| Option | Description | Selected |
|--------|-------------|----------|
| `pub(crate)` — framer-only | Narrow public surface; test re-export gated to `#[cfg(test)]` | ✓ |
| `pub` on slide module from the start | Future-proofs JS-side mock peer; widens API | |

**User's choice:** `pub(crate)` (Recommended).

---

## CAN v0.2.1 Bidirectional Amendment

### Q: What is the echo discipline for CTRL_CAN in v0.2.1?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict bidirectional echo | Either side may initiate; the other MUST echo CTRL_CAN; both drain and idle | ✓ |
| Initiator-only, no echo required | Simpler SM; PC has no positive confirmation Z80 saw the cancel | |
| PC-initiated only | Matches existing slide-rs/slide-py behavior; conflicts with SLIDE-04 "bidirectional" | |

**User's choice:** Strict bidirectional echo (Recommended).
**Notes:** Locks the JS-side cancel flow that PITFALLS §5 + ARCHITECTURE §7 already
sketched. Resolves OQ-1 from the v1.1 research summary in favour of the stronger
bidirectional contract.

### Q: What should the Rust `Slide::cancel()` API do?

| Option | Description | Selected |
|--------|-------------|----------|
| Push CAN to outbound, transition to CancelPending; idempotent | Fire-and-set-state; no-op on re-call; separate `force_idle()` for JS timeout | ✓ |
| Push CAN, return Result indicating outbound size | Idiomatic Rust; FFI return-shape complication for Phase 8 | |
| Two-phase: `request_cancel()` + `complete_cancel()` | Explicit two-phase; invites mis-sequencing | |

**User's choice:** Idempotent fire-and-set-state (Recommended).
**Notes:** Honours the no-`std::time`-in-Rust invariant; JS owns all timing.

### Q: Where should the v0.2.1 amendment be documented?

| Option | Description | Selected |
|--------|-------------|----------|
| ADR-003 in `.planning/decisions/` | Nygard-style; mirrors ADR-001/ADR-002 | ✓ |
| `docs/SLIDE-v0.2.1-amendment.md` | User-facing in repo root docs/ | |
| Both — ADR + docs/ | Decision history + user-facing spec | |

**User's choice:** ADR-003 (Recommended).
**Notes:** `docs/SLIDE_Z80_REQUIREMENT.md` (Phase 12 deliverable per SLIDE-40)
will reference ADR-003 as the canonical contract.

### Q: How does Rust SM handle the wire drain after CAN exchange?

| Option | Description | Selected |
|--------|-------------|----------|
| Rust discards in CancelPending; JS drives drain timing | `feed_byte` silently consumes until CAN echo; JS owns the 100ms drain window | ✓ |
| Rust counts drained bytes; emits Done after N bytes of silence | Self-contained; arbitrary threshold; "silence" needs time logic Rust can't have | |

**User's choice:** Rust discards; JS drives timing (Recommended).

---

## Claude's Discretion

The user explicitly deferred to planning-time judgement on:

- Exact CTRL_CAN wire format (raw byte 0x18 vs wrapped frame envelope)
- State machine event surface (packed u32 vs internal ring+drain)
- Phase 7 SM scope (sender + receiver in 7, or framer + receiver only with sender deferred to 9)
- Test fixture corpus content (which exact frames; CRC reference vector is non-negotiable)
- Re-entrant CAN handling specifics
- Specific Rust error type choice
- Native test layout details
- Module visibility from `lib.rs` (default: `pub mod slide;`)

## Deferred Ideas

None — discussion stayed inside Phase 7 scope. All cross-phase items
(wakeup detection, dispatcher, file picker, chip UI, downloads, real-hardware UAT)
were already mapped to Phases 8-12 in the v1.1 roadmap and surfaced in CONTEXT.md
`<deferred>` for cross-phase consistency.

## Scope Creep Avoided

None encountered — the user kept the discussion strictly inside the Rust core,
native-cargo-test boundary.
