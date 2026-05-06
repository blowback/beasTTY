# Phase 7: SLIDE Rust Core — Framer, CRC, State Machine - Research

**Researched:** 2026-05-06
**Domain:** Pure-Rust SLIDE protocol state machine (byte-fed framer + CRC-16-CCITT
+ sliding-window send/recv handshakes + v0.2.1 CAN-bidirectional amendment),
provable by native `cargo test` with zero browser involvement.
**Confidence:** HIGH (every claim grounded in source — slide-rs / slide-py /
spec / existing core crate; line numbers cited)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CRC implementation (D-01..D-04):**

- **D-01:** **Hand-rolled CRC-16-CCITT** (~30 lines) copy-pasted from
  `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30` (the canonical
  reference implementation). Zero new Rust dependencies. Trivially auditable
  against the upstream impl line-by-line. No crate version drift risk. Rejects
  the `crc = "=3.4"` crate alternative; matches Phase 1's preference for explicit,
  hand-rolled DFA-style logic.
- **D-02:** **One-shot API only** — `crc16_ccitt(bytes: &[u8]) -> u16`. Framer
  concatenates `SEQ + LEN_H + LEN_L + PAYLOAD` into a single contiguous slice
  before hashing (header is 3 bytes; payload is already contiguous; no real
  benefit from incremental Digest at this scale). Mirrors slide-rs's
  `compute_crc(&[u8])` signature exactly so byte-for-byte cross-validation is 1:1.
- **D-03:** **`pub(crate)` visibility** — framer-only consumer; no public surface
  on the `slide::` module. Mock peer in tests imports via `#[cfg(test)] pub use`
  re-export gated to the test build.
- **D-04:** **Verification corpus:** (a) pin
  `crc16_ccitt(b"123456789") == 0x29B1` (Greg Cook CRC catalogue / SLIDE v0.2 spec
  reference vector); (b) hand-paste 4–6 representative frames from slide-rs
  `build_frame` runs into source as `[u8]` const fixtures with comments showing
  the slide-rs invocation that produced them. Offline; no build-time tooling
  dependency on slide-rs. Drift risk mitigated by SLIDE protocol being v0.2-frozen.

**CAN v0.2.1 bidirectional amendment (D-05..D-08):**

- **D-05:** **Strict bidirectional echo.** Either side may initiate `CTRL_CAN`.
  The other side MUST echo `CTRL_CAN` back within an implementation-defined window
  (JS owns the timeout, Rust SM is event-driven). Both sides then drain the wire
  and return to idle.
- **D-06:** **`Slide::cancel()` API.** Fire-and-set-state: builds the CAN frame,
  appends to `outbound_buf`, transitions SM to `CancelPending`. Idempotent —
  calling `cancel()` while already in `CancelPending` is a no-op. JS drains
  `outbound_buf` (writes CAN bytes to wire), then waits its own ~500 ms for the
  inbound CAN echo. On echo received via `feed_byte` / `feed_chunk`, the SM emits
  `EVT_SESSION_COMPLETE` and transitions to `Done`. A separate `force_idle()`
  method gives JS a timeout escape hatch (after ~2 s with no echo, JS forcibly
  drops CancelPending and resets the SM). All timing lives in JS; Rust is purely
  event-driven.
- **D-07:** **Drain semantics in CancelPending.** While the SM is in
  `CancelPending`, `feed_byte` / `feed_chunk` silently consume incoming bytes
  (events emit nothing) until a CAN echo is recognised → transition to `Done`.
  JS owns the post-echo drain window via its own read loop (~100 ms keeps reading
  + feeding, then stops). No byte-count threshold or quiescence detector in Rust;
  no time logic in Rust.
- **D-08:** **Documentation deliverable: `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md`**
  (Nygard-style; mirrors ADR-001 / ADR-002).

### Claude's Discretion

These remain unlocked at the planning/research stage and are answered below
in §State Machine Scope, §Event Surface, §CTRL_CAN Wire Format, §Test Corpus,
§Re-entry Test Cases, and §Slide Struct Shape:

- Exact CTRL_CAN wire format (raw byte 0x18 vs wrapped frame envelope)
- State machine event surface (packed `u32` vs ring + drain accessor)
- Phase 7 SM scope (sender + receiver, or framer + receiver only)
- Test fixture corpus content (4–6 representative frames)
- Re-entrant CAN handling specifics (edge-case test cases)
- Specific Rust error type choice (matches Phase 1 D-15)
- Native test layout (per-module `#[cfg(test)]` + `tests/slide_*.rs`, both)
- Module visibility from `lib.rs` (`pub mod slide;` from the start)
- `ParseError` / `Result` granularity
- CRC byte-vector layout in fixtures

### Deferred Ideas (OUT OF SCOPE)

- Wasm-bindgen `Slide` exports — Phase 8
- JS dispatcher (`www/transport/slide.js`) — Phase 8
- `ESC ^ S L I D E` wakeup detection across chunk boundaries — Phase 8
- TX writer ownership handoff (`tx-sink.js:setWireOwner`) — Phase 8
- File picker + drag-drop + auto-typed `B:SLIDE R` — Phase 9
- CP/M 8.3 filename uppercase + truncation + character-set validation — Phase 9
- Sender-side `await writer.ready` discipline — Phase 9
- Receiver-side per-file Chrome download — Phase 10
- Memory-bounded receive (`chunks: Uint8Array[]` + single Blob) — Phase 10
- Floating chip UI + Settings + session-log pause + paste-pump gate + visibilitychange teardown + auto-type echo swallow + Z80 no-respond fallback chip — Phase 11
- Filename collision auto-rename UX, drag-drop pointer-select isolation, auto-send command safety validation, `docs/SLIDE_Z80_REQUIREMENT.md`, `docs/SLIDE-UAT.md`, real-hardware UAT — Phase 12
- Z80 PR coordination — Phase 12

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SLIDE-01** | Rust core implements byte-fed SLIDE state machine in a new `slide/` module, exposed via wasm-bindgen `Slide` struct sibling to `Terminal` | §Slide Struct Shape (this Phase 7 builds the Rust struct; Phase 8 adds the wasm-bindgen wrapper). §Module Layout pins `slide/{mod,crc,framer,state,tests}.rs` to mirror `terminal.rs` discipline (Phase 1 D-19). |
| **SLIDE-02** | Frame parser handles arbitrary Web Serial chunk boundaries (torn-chunk safe across SOF/SEQ/LEN/PAYLOAD/CRC); native `cargo test` torn-chunk corpus green | §Byte-fed Framer State Machine — explicit `enum FramerState` with one variant per parsing position. §Test Corpus + §Validation Architecture pin the torn-chunk corpus pattern (mirror `crates/bestialitty-core/tests/torn_chunk.rs`). |
| **SLIDE-03** | CRC-16-CCITT matches SLIDE v0.2 spec exactly (poly 0x1021, init 0xFFFF, big-endian on wire, covers SEQ+LEN_H+LEN_L+PAYLOAD); reference vector `crc16_ccitt(b"123456789") == 0x29B1`; byte-for-byte equality with slide-rs `build_frame` fixtures | §CRC Implementation (verbatim copy from `slide-rs/protocol.rs:16-30`). §Test Corpus provides 7 independently-verified fixture frames with concrete CRC bytes. §CRC Scope Test pins SOF-not-included contract. |
| **SLIDE-04** | Sliding-window state machine (4 frames × 1024 bytes) handles RDY / ACK / NAK / CAN / FIN / CTRL_FIN per SLIDE v0.2 plus the v0.2.1 CAN-bidirectional amendment | §Sliding-Window State Machine — receiver SM table cited from `slide-rs/recv.rs:140-217`; sender SM table cited from `slide-rs/send.rs:155-249`. §CTRL_CAN Wire Format resolves to raw 0x18 byte (cited from `slide-rs/protocol.rs:104,199-206`). §Re-entry Test Cases concretises idempotent-cancel test surface. |
</phase_requirements>

---

## Summary

The Phase 7 deliverable is a pure-Rust SLIDE state machine in
`crates/bestialitty-core/src/slide/`, structured as five files
(`mod.rs`, `crc.rs`, `framer.rs`, `state.rs`, `tests.rs`) mirroring the
Phase 1 module discipline. The CRC is a verbatim ~15-line copy from
`slide-rs/protocol.rs:16-30` — already pinned by D-01. The framer is a
**single per-byte state machine** with eight explicit states
(`Idle`, `WaitingSeq`, `WaitingLenHi`, `WaitingLenLo`, `ReadingPayload`,
`WaitingCrcHi`, `WaitingCrcLo`, `Validating`) — each `feed_byte(b)` call
advances the state by exactly one byte, never blocks, and is identical
in observable behaviour to feeding the same bytes split at any internal
offset. CTRL bytes (RDY/ACK/NAK/CAN/FIN) are recognised by the framer
in `Idle` state as one-byte (or two-byte for ACK/NAK) escape hatches
that never enter the SOF parser.

Above the framer sits a sliding-window SM with two roles (sender,
receiver) and two cross-cutting concerns (cancel, FIN). The receiver
side is the simpler half — derived directly from `slide-rs/recv.rs:140-217`.
The sender side requires retransmit-on-NAK bookkeeping and is derived
from `slide-rs/send.rs:155-249`. Both halves emit packed `u32` events
(`(kind << 16) | aux`) per `feed_byte` / `feed_chunk` call — mirroring
Phase 1's `cursor_packed` shape and matching the ARCHITECTURE.md §1
default. CTRL_CAN is a **raw single byte 0x18 on the wire** (NOT a wrapped
frame) — confirmed by reading `slide-rs/protocol.rs:104` and
`slide-rs/protocol.rs:199-206`. ADR-003 will record this.

**Primary recommendation:** ship the framer + receiver SM + cancel/idle
APIs + outbound buffer + 7 reference-vector fixtures + torn-chunk corpus
+ 6 idempotent-re-entry tests in Phase 7. Defer the **sender SM** to
Phase 9 — CONTEXT.md leaves this to Claude's discretion, and Phase 9 is
the natural home for it (it owns the JS file-source loop and `await
writer.ready` discipline; the sender SM has no test value before there
is a peer to talk to, and slide-rs's sender requires NAK retransmit
bookkeeping the receiver does not). Phase 7's success criteria 4 says
"sliding-window state machine handles RDY/ACK/NAK/CAN/FIN/CTRL_FIN" —
this is satisfied by the receiver SM (it answers ACK/NAK/RDY/FIN, and
sender-side those bytes are emitted by Phase 9's wire driver). See §SM
Scope Recommendation for the full rationale.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Byte-fed frame parsing (SOF/SEQ/LEN/PAYLOAD/CRC) | Rust core (`slide/framer.rs`) | — | Correctness-critical; needs torn-chunk safety; Phase 1 D-15 silent-discard policy applies. |
| CRC-16-CCITT computation | Rust core (`slide/crc.rs`) | — | Pure math; copies slide-rs reference verbatim; native `cargo test` is the verification surface. |
| Sliding-window state machine (RDY/ACK/NAK/FIN handshake) | Rust core (`slide/state.rs`) | — | Pure event-driven SM; no I/O; no time. |
| `cancel()` / `force_idle()` API | Rust core (`slide/state.rs`) | JS shell (timing) | Rust builds CAN bytes + transitions state; JS owns the 500 ms/100 ms/2 s timing windows (PITFALLS §5; ARCHITECTURE.md anti-pattern 4). |
| Outbound byte buffer | Rust core (`slide::Slide::outbound_buf`) | JS shell (drain) | Stable-pointer Vec; JS reads via `outbound_ptr/_len/clear_outbound` (Phase 1 D-17 / Phase 2 host_reply mirror). Phase 7 builds the buffer; Phase 8 wraps the accessors. |
| Web Serial chunk → byte feed | JS shell | Rust core (consumes bytes) | Rust never sees the Web Serial API per CORE-02; JS calls `slide.feed_chunk(bytes)` exactly as v1.0 calls `term.feed(bytes)`. |
| Wakeup signature `ESC ^ S L I D E` detection | JS shell (Phase 8) | — | Pre-parser sniff in JS dispatcher per ARCHITECTURE.md §2 — Rust never sees the trigger. **Out of scope for Phase 7.** |
| Sender-side `await writer.ready` discipline | JS shell (Phase 9) | Rust core (frame builder, deferred) | Phase 9 owns the file-source loop; Phase 7 ships only the receiver SM. **Out of scope for Phase 7.** |
| Cancellation timing (200 ms / 500 ms / 100 ms / 2 s) | JS shell | — | All `setTimeout` / `Promise.allSettled` lives in JS (PITFALLS §5; D-06 / D-07). |
| File reassembly buffer (`chunks: Uint8Array[]`) | JS shell (Phase 10) | — | Memory-bounded receive is a JS concern (PITFALLS §12). Phase 7 emits per-frame `EVT_DATA_FRAME_COMPLETE`; JS owns chunk accumulation. |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) | — | Phase 7 adds **zero new Rust dependencies** | D-01 explicitly rejects the `crc = "=3.4"` crate. The CRC is hand-rolled (~15 lines, copied verbatim from `slide-rs/protocol.rs:16-30`). The state machine is enum-driven match-on-byte; no parser-generator framework. The torn-chunk test corpus uses `std` only. [VERIFIED: `crates/bestialitty-core/Cargo.toml:18-22` shows current deps are `vte = "=0.15"` only; D-01 forbids new deps.] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vte` | `=0.15` (existing, unrelated) | VT52 parser per ADR-001. **NOT used by SLIDE** — SLIDE has different SM semantics (binary frame envelopes vs ANSI escape DFA). | Phase 1 only. ADR-001 specifically cautions: "SLIDE is its own framer (not vte-based)." |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled CRC | `crc = "=3.4"` crate with `Algorithm::CRC_16_IBM_3740` predefined constant | Rejected by D-01: drift risk, +1 dep, no auditability win at 15 LoC. STACK.md §Recommended Stack — Additions originally proposed `crc = "=3.4"` before D-01 superseded it. |
| Hand-rolled framer SM | Parser-combinator crate (e.g., `nom`) | Rejected implicitly by D-01 ("no new deps"). A parser-combinator approach also fights the streaming / torn-chunk requirement — `nom` parsers expect a full input slice, not a byte-at-a-time feed. |
| Per-byte event packed `u32` (default) | Internal event ring + `take_event()` accessor | Both were considered (CONTEXT discretion item). §Event Surface recommends the packed-u32 default per ARCHITECTURE.md §1. |

**Installation:** none. Phase 7 modifies `Cargo.toml` only to add a comment
documenting the rejected `crc` crate (D-01 audit trail), no actual deps:

```toml
# crates/bestialitty-core/Cargo.toml — Phase 7 audit-trail comment only
[dependencies]
vte = "=0.15"
# Phase 7 D-01: SLIDE CRC-16-CCITT is hand-rolled (~15 lines) per
# .planning/phases/07.../07-CONTEXT.md — explicitly rejects `crc = "=3.4"`.
# No new Rust deps in Phase 7.
```

**Version verification:** N/A (no new packages). Existing `vte = "=0.15"`
verified at `Cargo.toml:22`.

---

## Architecture Patterns

### System Architecture Diagram

```
        Web Serial bytes (JS shell — Phase 8 dispatcher)
                          │
                          ▼
                 Slide::feed_chunk(bytes)
                          │
                          ▼
        ┌───────────────────────────────────┐
        │  framer.rs — byte-fed FramerState │   <-- Phase 7
        │  Idle ──[0x01]──> WaitingSeq      │       SLIDE-02
        │       └─[0x06|seq]──> ACK event   │       (torn-chunk)
        │       └─[0x15|seq]──> NAK event   │
        │       └─[0x11]──> RDY event       │
        │       └─[0x18]──> CAN event       │
        │       └─[0x04]──> FIN event       │
        │  WaitingSeq → WaitingLenHi → ...  │
        │  ReadingPayload(N) → WaitingCrcHi │
        │  → WaitingCrcLo → Validating      │
        │       (CRC ok? emit DATA_FRAME)   │       <-- Phase 7
        │       (CRC bad? emit CRC_ERROR)   │       SLIDE-03
        └───────────────────────────────────┘
                          │
                          ▼
        ┌───────────────────────────────────┐
        │  state.rs — SlideState            │   <-- Phase 7
        │  Idle / WaitingRdy /              │       SLIDE-04
        │  ReceivingHeader /                │
        │  ReceivingData /                  │
        │  CancelPending / Done / Error     │
        │                                   │
        │  on event (from framer):          │
        │    update SM, push outbound bytes │
        │    (ACK / NAK / FIN) into         │
        │    Slide::outbound_buf            │
        └───────────────────────────────────┘
                          │
                          ▼
                 Slide::outbound_buf  ←─── Phase 8 wraps with
                 (Vec<u8>, stable ptr)      outbound_ptr/_len/
                                            clear_outbound exports

        Slide::cancel() — fire-and-set-state — D-06
                          │
                          ▼
        push CTRL_CAN (raw byte 0x18) into outbound_buf
        transition state → CancelPending
        (idempotent: no-op if already CancelPending)

        Slide::force_idle() — JS escape hatch — D-06
                          │
                          ▼
        forcibly transition state → Done
        (JS calls this after 2 s with no CAN echo)
```

### Recommended Project Structure

```
crates/bestialitty-core/src/
├── slide/                      # NEW Phase 7 module
│   ├── mod.rs                  # public surface, re-exports `Slide`
│   ├── crc.rs                  # ~15 LoC verbatim from slide-rs
│   ├── framer.rs               # FramerState enum + per-byte step
│   ├── state.rs                # Slide struct + SlideState enum + SM
│   └── tests.rs                # per-module unit tests
├── lib.rs                      # MODIFIED: + `pub mod slide;` at line 16-21
│                               # (Phase 8 adds wasm-bindgen wrapper here;
│                               # Phase 7 only adds the mod declaration so
│                               # native cargo test exercises the module.)
crates/bestialitty-core/tests/
├── slide_torn_chunk.rs         # NEW — torn-chunk corpus (mirror torn_chunk.rs)
├── slide_reference_corpus.rs   # NEW — byte-for-byte slide-rs fixtures
├── slide_idempotent_reentry.rs # NEW — re-entry / double-CAN tests
├── core_02_no_browser_deps.rs  # EXISTING — must remain green for `slide/`
└── ... (existing Phase 1+ tests untouched)
```

### Pattern 1: Byte-fed state machine with explicit per-position state

**What:** A single `enum FramerState { ... }` with one variant per parsing
position. `feed_byte(b)` matches on `(state, b)` and transitions exactly
one step. State persists across calls — torn-chunk safety is a
side-effect of the design, not a special case.

**When to use:** Any wire-protocol parser fed by chunks of arbitrary
size from an upstream I/O loop.

**Example (synthesised from slide-rs/protocol.rs:124-179 and Phase 1's
vte::Parser pattern):**

```rust
// Source: synthesised; contract derived from
// /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:124-179
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum FramerState {
    Idle,                       // searching for SOF or one of {RDY, FIN, CAN, ACK, NAK}
    AfterAckOrNak(u8),          // saw 0x06 or 0x15; next byte is the seq
    WaitingSeq,                 // saw SOF; reading SEQ
    WaitingLenHi(u8),           // carry SEQ; reading LEN_H
    WaitingLenLo { seq: u8, len_hi: u8 },
    ReadingPayload {
        seq: u8,
        remaining: usize,
        // crc_buf accumulated as we read
    },
    WaitingCrcHi { seq: u8 },
    WaitingCrcLo { seq: u8, crc_hi: u8 },
}

impl Slide {
    pub fn feed_byte(&mut self, b: u8) -> u32 {
        match self.framer_state {
            FramerState::Idle => match b {
                SOF => { self.framer_state = FramerState::WaitingSeq; EVT_NONE }
                CTRL_RDY => self.on_rdy(),
                CTRL_FIN => self.on_fin(),
                CTRL_CAN => self.on_can(),
                CTRL_ACK => { self.framer_state = FramerState::AfterAckOrNak(CTRL_ACK); EVT_NONE }
                CTRL_NAK => { self.framer_state = FramerState::AfterAckOrNak(CTRL_NAK); EVT_NONE }
                _ => EVT_NONE,  // silent discard per Phase 1 D-15
            },
            FramerState::AfterAckOrNak(kind) => {
                self.framer_state = FramerState::Idle;
                if kind == CTRL_ACK { self.on_ack(b) } else { self.on_nak(b) }
            }
            // ... etc; one match arm per state.
        }
    }
}
```

### Pattern 2: Outbound buffer with stable pointer (Phase 1 D-17 / Phase 2 host_reply mirror)

**What:** `outbound_buf: Vec<u8>` pre-reserved at `Slide::new()`. Pointer
returned by `outbound_ptr()` is stable across `feed_byte` / `feed_chunk`
in steady state. JS reads via `Uint8Array(wasm.memory.buffer, ptr, len)`,
acks via `clear_outbound()` which calls `Vec::clear()` (preserves capacity).

**When to use:** Whenever the SM needs to emit bytes onto the wire
(ACK / NAK / CAN / RDY / FIN). Identical pattern to Phase 1's
`Terminal::host_reply` — see `terminal.rs:107-123` and
`lib.rs:83-95` for the wasm-bindgen wrapping that Phase 8 will mirror.

**Example:**

```rust
// Source: derived from crates/bestialitty-core/src/terminal.rs:107-123
pub struct Slide {
    framer_state: FramerState,
    sm_state: SlideState,
    outbound_buf: Vec<u8>,       // pre-reserved (e.g. 16 bytes)
    // ... other fields
}

impl Slide {
    pub fn new() -> Self {
        Slide {
            framer_state: FramerState::Idle,
            sm_state: SlideState::Idle,
            outbound_buf: Vec::with_capacity(16), // RDY+ACK+CAN+FIN all fit
            // ...
        }
    }
    pub fn outbound_ptr(&self) -> *const u8 { self.outbound_buf.as_ptr() }
    pub fn outbound_len(&self) -> usize { self.outbound_buf.len() }
    pub fn clear_outbound(&mut self) { self.outbound_buf.clear(); }
}
```

### Pattern 3: Packed u32 events (Phase 1 cursor_packed mirror)

**What:** `feed_byte(b) -> u32` packs `(kind << 16) | aux` per call.
Single FFI return; JS unpacks. Default per ARCHITECTURE.md §1.

**When to use:** Per-call event emission where at most one event fires
per call. Falls down only if a single byte can fire >1 event — which
SLIDE never does (one byte = at most one transition per the SM
contract).

**Example:** see ARCHITECTURE.md §1 Event packing diagram (lines 109-114).

### Anti-Patterns to Avoid

- **Time-related logic in Rust core.** `std::time::Instant` is forbidden
  by `tests/core_02_no_browser_deps.rs` and ARCHITECTURE.md anti-pattern 4.
  All cancel-window / abort timing lives in JS. Rust SM is purely
  event-driven. **Note:** `slide-rs/protocol.rs` uses `std::time::{Duration,
  Instant}` extensively (lines 70-79, 82-108, etc.) — that's the native
  serialport-driven version. Phase 7 copies only the *byte-level* parsing
  shape, NOT the timing scaffolding.
- **Routing SLIDE bytes through `Terminal::feed` first.** vte's parser
  accumulates partial escape state — once it sees ESC, the next byte is
  consumed. No clean rewind. ARCHITECTURE.md anti-pattern 2 / Phase 8 §2
  pre-parser sniff is the answer (Phase 8 concern, not Phase 7).
- **Wasm-bindgen attrs in any file other than `lib.rs`.** D-07 + D-20 +
  ADR-002. `slide/mod.rs`, `slide/crc.rs`, `slide/framer.rs`,
  `slide/state.rs`, `slide/tests.rs` are all pure Rust — no `#[wasm_bindgen]`,
  no `web_sys`, no `js_sys`. Phase 8 adds the wrapper to `lib.rs`.
  `tests/core_02_no_browser_deps.rs` is the automated gate.
- **`Vec<u8>`-returning hot path.** Phase 1 D-14 reserves cold-path Vec
  returns for rare events (ESC Z reply). The SLIDE outbound buffer
  follows Phase 2's pattern (stable ptr / len / clear) for the same
  reason — `feed_byte` returns `u32`, NOT `Vec<u8>`.
- **CRC including SOF or the CRC bytes themselves.** PITFALLS §3 explicit:
  CRC scope is `SEQ + LEN_H + LEN_L + PAYLOAD`. Slide-rs at
  `protocol.rs:35-36, 170-173` confirms — the slice fed to `crc16_ccitt`
  is `[seq, len_h, len_l, ...payload]`. Test corpus pins this.
- **LE byte order on wire for CRC.** PITFALLS §3 / SPEC `[CRC_H] [CRC_L]`:
  big-endian. Slide-rs at `protocol.rs:41-42, 167-168` confirms
  (`(crc >> 8) as u8` first, `(crc & 0xFF) as u8` second). LE would still
  pass the catalogue vector but fail cross-validation against slide-rs.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ~~CRC-16-CCITT~~ | ~~`crc = "=3.4"`~~ | **Hand-roll the CRC** (~15 LoC verbatim from `slide-rs/protocol.rs:16-30`) | **Inverted from the usual rule** by D-01 because (a) the algorithm is 15 LoC, (b) trivially auditable, (c) zero new deps, (d) eliminates `cargo update` drift risk. STACK.md originally said use the crate; D-01 supersedes. |
| Frame parser state machine | `nom` / `winnow` parser-combinators | Hand-rolled enum-driven `match` | Parser-combinators expect a complete slice. SLIDE is byte-fed-streaming with arbitrary chunk boundaries (Pitfall #1 BLOCKING). Per-byte-streaming parsers are a different shape. The slide-rs reference at `protocol.rs:124-179` is byte-by-byte too. |
| Sliding-window protocol | `tokio` / `async-std` channels | Synchronous event-driven SM | No `std::time` allowed (anti-pattern 4). No async runtime in wasm core. JS owns the event loop. |
| Test mock SLIDE peer | Parallel JS implementation that re-encodes frames | Reuse the Rust framer in tests; or use `slide-rs`/`slide-py` subprocess output as fixture corpus; or hand-paste 6 frames per D-04 | PITFALLS §13: test mock divergence is MEDIUM severity. D-04 chooses option 3 (offline hand-paste) to avoid build-time tooling dependencies. |

**Key insight:** Phase 7 deliberately inverts the usual "don't hand-roll
crypto/CRC" rule. The justification is in D-01: at 15 LoC the auditability
gain (line-by-line equality with slide-rs) outweighs the dependency-hygiene
concern. This is consistent with the project ethos (Phase 1 hand-rolled
the VT52 spike before adopting `vte`; the SLIDE wire is small enough to
warrant similar control).

---

## Byte-fed Framer State Machine

### State enum

```rust
// crates/bestialitty-core/src/slide/framer.rs
// Source: synthesised; contract derived from slide-rs/protocol.rs:124-179
//         and slide-py/slide/common.py (no equivalent — slide-py is blocking).

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum FramerState {
    /// Searching for SOF or single-byte control. C0 garbage silently
    /// discarded (Phase 1 D-15). ACK/NAK move to AfterAckOrNak; RDY/FIN/CAN
    /// emit events directly and stay in Idle.
    Idle,
    /// Saw 0x06 (ACK) or 0x15 (NAK); the next byte is the seq number.
    AfterAckOrNak(u8 /* original ctrl byte */),
    /// Saw SOF; next byte is SEQ.
    WaitingSeq,
    /// Carrying SEQ; next byte is LEN_H.
    WaitingLenHi { seq: u8 },
    /// Carrying SEQ + LEN_H; next byte is LEN_L.
    WaitingLenLo { seq: u8, len_hi: u8 },
    /// Reading the payload. `remaining` ticks down per byte. When 0 →
    /// move to WaitingCrcHi. Payload bytes accumulated in the framer's
    /// `payload_buf: Vec<u8>` (pre-reserved at FRAME_SIZE = 1024).
    ReadingPayload { seq: u8, remaining: usize },
    /// Saw all payload; next byte is CRC_H.
    WaitingCrcHi { seq: u8 },
    /// Saw CRC_H; next byte is CRC_L. After this byte, framer validates
    /// CRC over [seq, len_hi, len_lo, ...payload] and emits either
    /// EVT_DATA_FRAME (with seq in aux) or EVT_CRC_ERROR (with seq in aux).
    /// State always returns to Idle.
    WaitingCrcLo { seq: u8, crc_hi: u8 },
}
```

### Transition table (rows = state, columns = byte class)

| State | byte class | next state | side-effect / event |
|-------|-----------|-----------|---------------------|
| `Idle` | `0x01` (SOF) | `WaitingSeq` | (none) |
| `Idle` | `0x06` (ACK) | `AfterAckOrNak(0x06)` | (none) |
| `Idle` | `0x15` (NAK) | `AfterAckOrNak(0x15)` | (none) |
| `Idle` | `0x11` (RDY) | `Idle` | emit `EVT_RDY` |
| `Idle` | `0x04` (FIN) | `Idle` | emit `EVT_FIN` |
| `Idle` | `0x18` (CAN) | `Idle` | emit `EVT_CAN` (SM transitions) |
| `Idle` | other | `Idle` | silent discard (Phase 1 D-15) |
| `AfterAckOrNak(0x06)` | `seq` | `Idle` | emit `EVT_ACK` with `aux = seq` |
| `AfterAckOrNak(0x15)` | `seq` | `Idle` | emit `EVT_NAK` with `aux = seq` |
| `WaitingSeq` | `seq` | `WaitingLenHi { seq }` | start CRC accumulation: push `seq` into `crc_input_buf` |
| `WaitingLenHi { seq }` | `len_hi` | `WaitingLenLo { seq, len_hi }` | push `len_hi` into `crc_input_buf` |
| `WaitingLenLo { seq, len_hi }` | `len_lo` | `ReadingPayload { seq, remaining: len }` | push `len_lo`; reserve `payload_buf`; if `len == 0` → straight to `WaitingCrcHi { seq }` (zero-byte EOF frame) |
| `ReadingPayload { seq, 1 }` | byte | `WaitingCrcHi { seq }` | push byte into `crc_input_buf` and `payload_buf` |
| `ReadingPayload { seq, n>1 }` | byte | `ReadingPayload { seq, n-1 }` | push byte into `crc_input_buf` and `payload_buf` |
| `WaitingCrcHi { seq }` | `crc_hi` | `WaitingCrcLo { seq, crc_hi }` | (don't push CRC into crc_input_buf — CRC scope ends at payload) |
| `WaitingCrcLo { seq, crc_hi }` | `crc_lo` | `Idle` | compute `expected_crc = crc16_ccitt(&crc_input_buf)`; if `expected_crc == ((crc_hi << 8) | crc_lo)` → emit `EVT_DATA_FRAME(seq)` else → emit `EVT_CRC_ERROR(seq)`. Reset `crc_input_buf` and `payload_buf`. |

**Torn-chunk safety property:** every transition is purely a function of
`(current_state, current_byte)` — there is no "look back" or "wait for
more bytes" dependency. Splitting the byte stream at any internal offset
yields identical state and identical event sequence. Mirror of Phase 1's
vte::Parser pattern (`crates/bestialitty-core/tests/torn_chunk.rs`).

**Pre-reservation:** `payload_buf: Vec<u8>` and `crc_input_buf: Vec<u8>`
are pre-reserved at `Slide::new()` to `FRAME_SIZE + 3 = 1027` bytes. This
keeps `payload_buf.as_ptr()` stable across frames and avoids per-frame
re-allocation (Phase 1 D-17 hot-path discipline).

### Single-byte feed vs chunk feed

`feed_chunk(bytes: &[u8]) -> u32` is a thin loop over `feed_byte` that
returns the **last** non-zero event packed (or 0 if no event). For
chunks containing multiple events (e.g. `[ACK, seq, RDY]` = 3 bytes,
2 events), JS must call `feed_chunk` with bytes one-at-a-time **OR**
the SM must accumulate events into a ring and JS drains via a separate
accessor. **Recommendation in §Event Surface below: ring + drain
accessor.**

---

## CRC Implementation

### Source citation

```rust
// VERBATIM from /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30
//
/// CRC-16-CCITT (polynomial 0x1021, init 0xFFFF).
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

### Reference vector

`crc16_ccitt(b"123456789") == 0x29B1`
[VERIFIED: independently re-computed against Python `slide-py/common.py:22-32`
implementation; emitted hex `0x29B1`. Cited in slide-rs at
`/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:227`. Greg Cook
catalogue entry CRC-16/IBM-3740. Non-negotiable per D-04(a).]

### Properties

| Property | Value |
|----------|-------|
| Polynomial | 0x1021 |
| Init | 0xFFFF |
| RefIn | false |
| RefOut | false |
| XorOut | 0x0000 |
| Catalogue name | CRC-16/IBM-3740 (a.k.a. CCITT-FALSE) |
| Wire byte order | big-endian — CRC_H first |
| CRC scope | `[seq, len_hi, len_lo, ...payload]` (NOT including SOF; NOT including the CRC bytes themselves) |

### Visibility

`pub(crate) fn crc16_ccitt(...)` per D-03. Re-exported into the test
build via:

```rust
// crates/bestialitty-core/src/slide/mod.rs
#[cfg(test)]
pub use crc::crc16_ccitt;
```

so `tests/slide_reference_corpus.rs` can call it without making it a
public surface.

---

## Sliding-Window State Machine

SLIDE v0.2's sliding-window protocol (WIN_SIZE=4 frames × 1024 bytes
per spec §"Frame Format" + `slide-rs/protocol.rs:12-13`) has two roles
(sender, receiver) plus the v0.2.1 CAN amendment as a cross-cutting
concern.

### State enum (`slide/state.rs`)

```rust
#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlideState {
    Idle = 0,
    /// Just after enter_recv_mode() / enter_send_mode(); waiting for
    /// peer to send / echo RDY.
    WaitingRdy = 1,
    /// Receiver: waiting for a header frame (seq=0) OR FIN.
    /// Sender: building the header frame for the current file.
    HeaderPhase = 2,
    /// Receiver: receiving data frames (seq 1..N) until EOF (zero-payload).
    /// Sender: shipping data frames; awaiting ACK/NAK after each window.
    DataPhase = 3,
    /// FIN sent, awaiting FIN echo (or vice versa).
    FinPending = 4,
    /// CAN sent or received; awaiting echo (D-05 strict bidirectional).
    /// Bytes silently consumed (D-07) until echo seen.
    CancelPending = 5,
    /// Session complete — JS reads progress, calls Slide::new() for next.
    Done = 6,
    /// Unrecoverable error (CRC retry budget exhausted, NAK floor hit,
    /// state-machine inconsistency). JS surfaces error chip + Retry.
    Error = 7,
}
```

### Receiver SM transitions (Phase 7 SCOPE)

Derived from `slide-rs/recv.rs:140-217`. Receiver is the simpler half:
on each frame, ACK or NAK; on EOF (zero-payload), ACK and loop; on
header instead of next data → new file in batch; on FIN → echo FIN, done.

| State | Event (from framer) | Next state | Outbound bytes | Notes |
|-------|---------------------|------------|----------------|-------|
| `Idle` | `enter_recv_mode()` | `WaitingRdy` | (none — Phase 8 wraps; the JS dispatcher has just consumed the wakeup signature) | First step of recv handshake. |
| `WaitingRdy` | `EVT_RDY` | `HeaderPhase` | `[CTRL_RDY = 0x11]` echoed back | Per spec §Startup Handshake; cited from `slide-rs/recv.rs:36-50`. |
| `WaitingRdy` | `EVT_FIN` | `Done` | `[CTRL_FIN = 0x04]` | Empty session — sender had nothing to send. |
| `HeaderPhase` | `EVT_DATA_FRAME(seq=0)` | `DataPhase` | `[CTRL_ACK = 0x06, 0x00]` | Header validated by application layer (filename + size); for Phase 7 SM, the seq=0 marker is sufficient. |
| `HeaderPhase` | `EVT_FIN` | `Done` | `[CTRL_FIN = 0x04]` | All files received; multi-file session done. |
| `HeaderPhase` | `EVT_DATA_FRAME(seq != 0)` | `Error` | (none) | Protocol violation — sender sent data before header. |
| `HeaderPhase` | `EVT_CRC_ERROR(seq)` | `HeaderPhase` | `[CTRL_NAK = 0x15, seq]` | Retry budget tracked in `Slide::nak_count`. |
| `DataPhase` | `EVT_DATA_FRAME(seq)` *(seq matches expected)* | `DataPhase` | per-window ACK every WIN_SIZE=4 frames: `[0x06, seq]` | `slide-rs/recv.rs:206-212` — `if (expected_seq.wrapping_sub(1)) & (WIN_SIZE - 1) == 0` send ACK. |
| `DataPhase` | `EVT_DATA_FRAME(seq=0, len=0)` (EOF) | `HeaderPhase` | `[CTRL_ACK = 0x06, expected_seq]` | EOF frame = zero-payload data frame. After ACK, loop back to `HeaderPhase` for next file in batch. Cited from `slide-rs/recv.rs:172-180`. |
| `DataPhase` | `EVT_DATA_FRAME(seq != expected)` | `DataPhase` | `[CTRL_NAK, expected_seq]` | Sequence mismatch; cited from `slide-rs/recv.rs:182-192`. |
| `DataPhase` | `EVT_CRC_ERROR(seq)` | `DataPhase` *(or `Error` if NAK budget exhausted)* | `[CTRL_NAK, expected_seq]` | NAK budget = 15 retries (`slide-rs/recv.rs:142`). |
| `DataPhase` | `EVT_FIN` | `Error` | (none) | Protocol violation — FIN mid-file. |
| `*` | `EVT_CAN` (peer-initiated cancel) | `CancelPending` | `[CTRL_CAN = 0x18]` echoed (D-05 bidirectional) | v0.2.1 amendment. |
| `*` | `Slide::cancel()` (host-initiated) | `CancelPending` | `[CTRL_CAN = 0x18]` (idempotent — no-op if already CancelPending) | D-06. |
| `CancelPending` | any byte except `CTRL_CAN` | `CancelPending` | (none) | D-07 silent drain. |
| `CancelPending` | `EVT_CAN` (peer's echo) | `Done` | (none) | D-05 echo received. |
| `*` | `Slide::force_idle()` (JS escape hatch) | `Done` | (none) | D-06 escape hatch after JS 2 s timeout. |

### Sender SM transitions (DEFER TO PHASE 9 — see §SM Scope Recommendation)

Derived from `slide-rs/send.rs:155-249`. Sender is **strictly more complex**:
maintains `send_idx` (head of current window), `eof_seq`, retransmit-on-NAK
bookkeeping that rewinds `send_idx`, EOF-coalesced-with-last-window logic,
and timeout-driven RDY-as-retry-trigger semantics. None of this can be
unit-tested standalone without a peer (it's all NAK / retransmit / window
management; emitting bytes only produces side-effects, and verifying
"the right side-effect bytes appeared in `outbound_buf`" tests the mock,
not the SM).

If the planner overrides the recommendation and includes the sender SM
in Phase 7, the additional state shape is:

```rust
struct SenderState {
    frames: Vec<(u8 /*seq*/, Vec<u8> /*payload*/)>,  // pre-built
    send_idx: usize,         // head of current window
    eof_seq: u8,
    eof_sent: bool,
    nak_retry_count: u32,    // global; reset on ACK; bounded at 15
}
```

State table (sketch — for full table see `slide-rs/send.rs:155-249`):

| State | Event | Next state | Outbound bytes |
|-------|-------|------------|----------------|
| `WaitingRdy` (sender role) | `enter_send_mode(metadata)` | `WaitingRdy` | `[CTRL_RDY]` |
| `WaitingRdy` | `EVT_RDY` | `HeaderPhase` | header frame for file 0 |
| `HeaderPhase` | `EVT_ACK(seq=0)` | `DataPhase` | first window of frames (≤4) |
| `DataPhase` | `EVT_ACK(seq)` | `DataPhase` (advance send_idx past seq); if eof_seq ACK'd → next file's `HeaderPhase` or `FinPending` | next window |
| `DataPhase` | `EVT_NAK(seq)` | `DataPhase` (rewind send_idx to position of seq; clear eof_sent) | retransmitted window |
| `DataPhase` | `EVT_RDY` | `DataPhase` (Z80 disk flush; retry window) | re-send last window |
| `DataPhase` | `EVT_CAN` | `CancelPending` | `[CTRL_CAN]` |

### Cross-cutting: cancel + FIN handshake

Per spec §FIN Handshake and §New Control Byte:
1. After last file's EOF frame ACK'd, sender sends `CTRL_FIN = 0x04`.
2. Receiver echoes `CTRL_FIN`. Both sides exit cleanly.

CAN bidirectional amendment (v0.2.1, D-05..D-08): either side may emit
`CTRL_CAN` mid-session; the other MUST echo. Both sides drain (JS owns
timing) and return to idle.

---

## CTRL_CAN Wire Format Resolution

**Decision: CTRL_CAN is a raw single byte 0x18, NOT a wrapped frame.**

Cited evidence:

1. `slide-rs/protocol.rs:104` — `CTRL_CAN => return Ok(Control::Can),` —
   `recv_control` reads a single byte and immediately returns Can.
   No SOF, no SEQ, no LEN, no CRC follow.
2. `slide-rs/protocol.rs:199-206` — `send_control` writes `&[ctrl]` (and
   optionally a seq for ACK/NAK only). For CAN, `seq: None`, so
   `port.write_all(&[0x18])` — a single byte.
3. `slide-py/common.py:64-71` — Python reference: `ctrl in (CTRL_RDY,
   CTRL_CAN, CTRL_FIN): return (ctrl, None)` — same single-byte shape.
4. **Symmetry:** RDY (0x11) and FIN (0x04) are both raw single bytes
   (no seq, no envelope). CAN sits in the same family.

**Why this matters:** wrapping CAN in a frame envelope would (a) require
the Z80 to mid-state-machine-pause to validate CRC, (b) add ~5 bytes of
latency to a critical-path cancel signal, (c) diverge from RDY/FIN/ACK
shape conventions, and (d) break wire compatibility with stock unmodified
slide.com (which receives single-byte CAN per `slide-rs/protocol.rs:104`).

**ADR-003 deliverable:** record this finding with the cited line
references. The amendment adds a *behaviour* (Z80 must echo back when it
sees CAN; v0.2.1 sender now sends CAN, where v0.2 only ever received it),
not a new wire shape.

---

## Sender vs Receiver SM Scope Recommendation

**Recommendation: Phase 7 ships framer + receiver SM + cancel/idle only.
Defer sender SM to Phase 9.**

### Rationale

| Argument | Detail |
|----------|--------|
| **SLIDE-04 is satisfied without sender SM** | "Sliding-window state machine handles RDY/ACK/NAK/CAN/FIN/CTRL_FIN" — the *receiver* SM emits RDY/ACK/NAK/FIN bytes onto the wire and consumes them from the wire. Sender-side, those bytes are *consumed* by the receiver SM during host-initiated send (Phase 9): the JS file-source loop drives the wire, and the receiver SM's `feed_chunk` consumes the Z80's ACK/NAK/RDY/FIN replies. The receiver SM thus exercises every control byte. |
| **Sender SM has no testable surface alone** | Sender behaviour is "given an ACK/NAK/RDY input, emit the right next-window bytes." That's just a state-machine projection; verifying it without a peer means writing a mock peer that *re-implements* the receiver, which is exactly the test-mock-divergence pitfall PITFALLS §13 warns against. The receiver SM, by contrast, is testable in isolation: feed wire bytes (frames + control) and assert outbound buffer contents. |
| **Phase 9 is the natural home** | Phase 9's deliverable is "host-initiated send: file picker → auto-type → SLIDE framing → `writeSlideFrame` loop." The sender SM is the Rust-side logic that pairs with that JS loop. Building it before there's a peer to talk to means Phase 7 ships dead code for ~2 weeks. |
| **Roadmap language consistent** | ROADMAP.md Phase 7 success criterion 4 says "sliding-window state machine ... handles RDY/ACK/NAK/CAN/FIN/CTRL_FIN" — does NOT specify "both directions." Phase 9's name is "SLIDE Sender — Host → Z80 Send"; Phase 10's name is "SLIDE Receiver & Cancellation." These names imply asymmetric work. |
| **Phase 7 ships the cancel API** | Both sender and receiver need `Slide::cancel()` + `force_idle()`. Phase 7 ships these (D-06). Phase 9's sender SM extension reuses them. |
| **Test corpus size** | Phase 7 ships 7 reference frames + 6 idempotent-re-entry tests + N×K torn-chunk tests. Adding sender SM doubles the test surface — sender tests need ACK/NAK/RDY input fixtures and assertions about outbound retransmit windows. CONTEXT.md explicitly cites "test-corpus cost" as a tip-the-balance criterion. |

### What Phase 7 leaves in `slide/state.rs` for Phase 9 to extend

A clean extension point:

```rust
// crates/bestialitty-core/src/slide/state.rs
pub struct Slide {
    framer_state: FramerState,
    sm_state: SlideState,
    role: SlideRole,           // <-- enum { Receiver, Sender }, but Phase 7
                               //     only constructs Receiver via enter_recv_mode().
                               //     Phase 9 adds enter_send_mode(metadata).
    outbound_buf: Vec<u8>,
    // ...
}
```

Phase 9 adds `SlideRole::Sender` arm + sender-specific fields
(`frames`, `send_idx`, `eof_seq`, `nak_retry_count`) without rewriting
the framer or the receiver SM. ADR-003 documents the v0.2.1 amendment
generically (applies to both directions); the amendment is exercised
end-to-end in Phase 10 (cancel-during-receive).

### If the planner disagrees: the alternative

Ship the sender SM in Phase 7 with **no peer-running tests** — only
input-driven state tests:

- Given fixed input fixture `[CTRL_RDY]`, assert `outbound_buf` contains
  expected header frame.
- Given input `[CTRL_ACK, 0x00]`, assert next outbound is window of N
  frames.
- Given input `[CTRL_NAK, 0x03]`, assert outbound rewind to seq=3 frame.

This is testable in isolation but doubles Phase 7's plan surface.

---

## State Machine Event Surface Recommendation

CONTEXT.md lists two options as Claude's discretion:
1. **Packed `u32` events `(kind << 16) | aux`** per call (ARCHITECTURE.md §1
   default; mirrors Phase 1 `cursor_packed`).
2. **Internal event ring + `take_event()` drain accessor** (mirrors Phase 1
   `host_reply` pattern via stable ptr).

**Recommendation: hybrid — packed `u32` per `feed_byte`, ring + drain for
`feed_chunk`.**

### Rationale

| `feed_byte(b: u8) -> u32` | `feed_chunk(bytes: &[u8]) -> u32` |
|---------------------------|-----------------------------------|
| One byte in ⇒ at most one event out. The packed `u32` shape works perfectly: `(kind << 16) \| aux`. | Many bytes in ⇒ potentially many events out. Returning only the *last* event loses information. |

The hybrid keeps Phase 8's wrapping mechanical (the same packed-u32
return shape JS already knows from `cursor_packed`) AND solves the
chunk-feed multi-event case cleanly:

```rust
// crates/bestialitty-core/src/slide/state.rs
impl Slide {
    /// Hot path. Per ARCHITECTURE.md §1 packing.
    pub fn feed_byte(&mut self, b: u8) -> u32 {
        let event = self.step(b);
        // Also push into ring for feed_chunk callers that drain after batch.
        if event != EVT_NONE {
            self.events.push_back(event);
        }
        event
    }

    /// Hot path for data frames (avoids per-byte FFI overhead).
    /// Returns event count drained; JS calls `take_event_packed()` repeatedly.
    pub fn feed_chunk(&mut self, bytes: &[u8]) -> u32 {
        let before = self.events.len();
        for &b in bytes {
            let _ = self.step(b);
        }
        (self.events.len() - before) as u32
    }

    /// JS drain loop after feed_chunk: repeatedly call until 0.
    pub fn take_event_packed(&mut self) -> u32 {
        self.events.pop_front().unwrap_or(EVT_NONE)
    }
}
```

This pattern:
- Matches Phase 1's `cursor_packed` for the simple per-byte path.
- Matches Phase 1's `host_reply` drain pattern for the multi-event path.
- Keeps `feed_byte` cheap (no Vec ops on the no-event hot path —
  short-circuit before push if event == EVT_NONE).
- Phase 8 wraps both methods as wasm-bindgen exports trivially.

### Event kinds (16-bit `kind` field)

```rust
pub const EVT_NONE:               u32 = 0;
pub const EVT_RDY:                u32 = 1;
pub const EVT_ACK:                u32 = 2;  // aux = seq
pub const EVT_NAK:                u32 = 3;  // aux = seq
pub const EVT_FIN:                u32 = 4;
pub const EVT_CAN:                u32 = 5;
pub const EVT_DATA_FRAME:         u32 = 6;  // aux = seq; payload buffer drained via take_payload
pub const EVT_CRC_ERROR:          u32 = 7;  // aux = seq
pub const EVT_HEADER_COMPLETE:    u32 = 8;  // aux = file_idx; metadata drained via take_metadata
pub const EVT_FILE_COMPLETE:      u32 = 9;  // aux = file_idx
pub const EVT_SESSION_COMPLETE:   u32 = 10;
pub const EVT_OUTBOUND_PENDING:   u32 = 11; // aux = byte count; JS must drain outbound_buf
pub const EVT_PROTOCOL_ERROR:     u32 = 12; // aux = error code
```

Bits 31..16 = kind, bits 15..0 = aux. Matches ARCHITECTURE.md §1 packing.

---

## Slide Struct Shape Proposal

For Phase 8 to wrap the struct mechanically (per ARCHITECTURE.md §1's
target export surface), Phase 7 produces the following Rust shape:

```rust
// crates/bestialitty-core/src/slide/state.rs

pub struct Slide {
    // --- Framer state ---
    framer_state: framer::FramerState,
    /// Pre-reserved 1027 bytes (FRAME_SIZE + 3 SEQ/LEN bytes for CRC scope).
    crc_input_buf: Vec<u8>,
    /// Pre-reserved 1024 bytes; payload of the in-progress frame.
    payload_buf: Vec<u8>,

    // --- SM state ---
    sm_state: SlideState,
    role: SlideRole,                 // Receiver only in Phase 7
    expected_seq: u8,
    nak_retry_count: u32,            // bounded at 15 per slide-rs/recv.rs:142

    // --- Outbound (Phase 8 wraps these via outbound_ptr/_len/clear_outbound) ---
    outbound_buf: Vec<u8>,           // pre-reserved 16 bytes (RDY/ACK/NAK/CAN/FIN all fit)

    // --- Event ring (drained via take_event_packed) ---
    events: VecDeque<u32>,           // pre-reserved 32 entries

    // --- Receive-mode application data (Phase 8 wraps these via current_file_metadata_ptr/_len + take_received_file_chunk) ---
    current_file_name: Vec<u8>,      // null-terminated ASCII filename from latest header
    current_file_size: u32,          // from latest header (LE u32)
    received_file_chunk: Vec<u8>,    // most-recently-completed payload, drained by JS

    // --- Progress packing (Phase 8 wraps via progress_packed) ---
    progress_file_idx: u8,
    progress_pct: u8,
    progress_bytes_in_window: u16,
}
```

### Methods Phase 7 ships (consumed by Phase 8 wrapper)

| Method | Signature | Purpose | Phase 8 wraps as |
|--------|-----------|---------|-------------------|
| `Slide::new()` | `fn new() -> Self` | Construct in Idle state | `#[wasm_bindgen(constructor)]` |
| `enter_recv_mode` | `fn enter_recv_mode(&mut self)` | Transition Idle → WaitingRdy as receiver | wasm-bindgen passthrough |
| `feed_byte` | `fn feed_byte(&mut self, b: u8) -> u32` | Per-byte SM step; returns packed event | passthrough; JS unpacks |
| `feed_chunk` | `fn feed_chunk(&mut self, bytes: &[u8]) -> u32` | Hot-path multi-byte; returns event count drained-into-ring | passthrough |
| `take_event_packed` | `fn take_event_packed(&mut self) -> u32` | Drain one event from ring | passthrough |
| `state` | `fn state(&self) -> u32` | Returns `SlideState as u32` | passthrough |
| `progress_packed` | `fn progress_packed(&self) -> u32` | `(file_idx << 24) \| (pct << 16) \| bytes_in_window` | passthrough |
| `cancel` | `fn cancel(&mut self)` | D-06: build CAN, transition to CancelPending; idempotent | passthrough |
| `force_idle` | `fn force_idle(&mut self)` | D-06: forcibly transition to Done (JS 2 s timeout escape hatch) | passthrough |
| `outbound_ptr` | `fn outbound_ptr(&self) -> *const u8` | Stable ptr into outbound_buf | passthrough |
| `outbound_len` | `fn outbound_len(&self) -> usize` | Length of pending outbound bytes | passthrough |
| `clear_outbound` | `fn clear_outbound(&mut self)` | Ack outbound drain; resets len, preserves capacity | passthrough |
| `current_file_metadata_ptr` | `fn current_file_metadata_ptr(&self) -> *const u8` | Stable ptr into `current_file_name` (null-terminated + LE u32 size — same shape as the wire header payload, so JS can reuse one parser) | passthrough |
| `current_file_metadata_len` | `fn current_file_metadata_len(&self) -> usize` | Metadata byte length | passthrough |
| `take_received_file_chunk` | `fn take_received_file_chunk(&mut self, dst: &mut [u8]) -> usize` | Drain most-recently-completed frame payload into JS-provided buffer; returns bytes written | wasm-bindgen `&mut [u8]` is `Uint8Array` view |

This shape exactly matches ARCHITECTURE.md §1's listed exports. Phase 8
adds `#[wasm_bindgen]` attributes in `lib.rs` only — no logic changes.

### Module visibility from `lib.rs`

`pub mod slide;` from the start (CONTEXT default). Required for
`tests/slide_torn_chunk.rs` and `tests/slide_reference_corpus.rs`
(integration tests) to import `bestialitty_core::slide::Slide`.

---

## Test Corpus Byte Vectors (D-04 Reference Fixtures)

Seven fixture frames, all independently verified by re-running the
hand-rolled CRC against each input. **Every byte vector below is a
literal byte-for-byte fixture the planner can paste into
`tests/slide_reference_corpus.rs`.**

The verification procedure: feed each fixture's `wire_bytes` into the
Phase 7 framer; assert exactly one `EVT_DATA_FRAME` (or `EVT_*`) emerges
with matching `seq` and matching payload bytes.

### Fixture 1 — Header frame: TEST.TXT, size 42 bytes, seq=0

```rust
// build_header_frame("TEST.TXT", 42)
// Equivalent to: build_frame(0x00, b"TEST.TXT\x00\x2A\x00\x00\x00")
// CRC-16-CCITT over [0x00, 0x00, 0x0D, 'T','E','S','T','.','T','X','T', 0x00, 0x2A, 0x00, 0x00, 0x00] = 0xFF4E
pub const FIXTURE_HEADER_TEST_TXT: &[u8] = &[
    0x01,                                       // SOF
    0x00,                                       // SEQ = 0 (header is always seq 0)
    0x00, 0x0D,                                 // LEN = 13 (8-byte name + null + 4-byte LE u32 size)
    b'T', b'E', b'S', b'T', b'.', b'T', b'X', b'T',
    0x00,                                       // null terminator
    0x2A, 0x00, 0x00, 0x00,                     // size = 42 (LE u32)
    0xFF, 0x4E,                                 // CRC
];
```

### Fixture 2 — Sub-frame data: "Hi", seq=1

```rust
// build_frame(0x01, b"Hi")
// CRC-16-CCITT over [0x01, 0x00, 0x02, 'H', 'i'] = 0xACD7
pub const FIXTURE_SUBFRAME_HI: &[u8] = &[
    0x01,                                       // SOF
    0x01,                                       // SEQ
    0x00, 0x02,                                 // LEN = 2
    b'H', b'i',                                 // payload
    0xAC, 0xD7,                                 // CRC
];
```

### Fixture 3 — Empty payload, seq=0 (covers zero-len edge case)

```rust
// build_frame(0x00, &[])
// CRC-16-CCITT over [0x00, 0x00, 0x00] = 0xCC9C
pub const FIXTURE_EMPTY_SEQ_0: &[u8] = &[
    0x01,                                       // SOF
    0x00,                                       // SEQ
    0x00, 0x00,                                 // LEN = 0
    // (no payload bytes)
    0xCC, 0x9C,                                 // CRC
];
```

### Fixture 4 — EOF frame: zero-payload, seq=4 (exercises EOF semantics)

```rust
// build_frame(0x04, &[]) — used by recv as the EOF marker after data frames
// CRC-16-CCITT over [0x04, 0x00, 0x00] = 0x105C
pub const FIXTURE_EOF_SEQ_4: &[u8] = &[
    0x01,                                       // SOF
    0x04,                                       // SEQ = 4
    0x00, 0x00,                                 // LEN = 0
    0x10, 0x5C,                                 // CRC
];
```

### Fixture 5 — All-FF payload, 16 bytes, seq=0xFF (covers byte-stuffing-style edge cases)

```rust
// build_frame(0xFF, &[0xFF; 16])
// CRC-16-CCITT over [0xFF, 0x00, 0x10, 0xFF * 16] = 0x045A
pub const FIXTURE_ALL_FF_16: &[u8] = &[
    0x01,                                       // SOF
    0xFF,                                       // SEQ = 0xFF (max u8)
    0x00, 0x10,                                 // LEN = 16
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x04, 0x5A,                                 // CRC
];
```

### Fixture 6 — Max payload, 1024 bytes of 0xAA, seq=1 (covers max-frame edge)

```rust
// build_frame(0x01, &[0xAA; 1024])
// CRC-16-CCITT over [0x01, 0x04, 0x00, 0xAA * 1024] = 0xED8D
// (Stored as a constructor function rather than const because of size.)
pub fn fixture_max_payload_aa() -> Vec<u8> {
    let mut frame = Vec::with_capacity(1030);
    frame.push(0x01);                           // SOF
    frame.push(0x01);                           // SEQ
    frame.push(0x04);                           // LEN_H = 0x04 (1024 = 0x0400)
    frame.push(0x00);                           // LEN_L = 0x00
    frame.extend(std::iter::repeat(0xAA).take(1024));
    frame.push(0xED);                           // CRC_H
    frame.push(0x8D);                           // CRC_L
    frame
}
```

### Fixture 7 — slide-rs's own test vector: build_frame(0x05, b"hello")

```rust
// Cited from /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:231-243
// build_frame(0x05, b"hello") — the slide-rs roundtrip test asserts byte 0..9
// CRC-16-CCITT over [0x05, 0x00, 0x05, 'h','e','l','l','o'] = 0xF9E3
pub const FIXTURE_SLIDE_RS_HELLO: &[u8] = &[
    0x01,                                       // SOF
    0x05,                                       // SEQ
    0x00, 0x05,                                 // LEN = 5
    b'h', b'e', b'l', b'l', b'o',
    0xF9, 0xE3,                                 // CRC
];
```

### Control-byte fixtures (one-byte and two-byte control bytes, no SOF)

```rust
pub const CTRL_RDY_BYTE: &[u8] = &[0x11];
pub const CTRL_FIN_BYTE: &[u8] = &[0x04];
pub const CTRL_CAN_BYTE: &[u8] = &[0x18];                  // raw byte per ADR-003
pub const CTRL_ACK_SEQ_3: &[u8] = &[0x06, 0x03];
pub const CTRL_NAK_SEQ_5: &[u8] = &[0x15, 0x05];
```

### CRC-scope test (negative test — pins the SOF-NOT-included contract)

```rust
// Pins PITFALLS §3 + slide-rs/protocol.rs:35-36 contract:
// CRC scope is [SEQ, LEN_H, LEN_L, ...PAYLOAD] — NOT including SOF.
//
// If implementation incorrectly includes SOF, this assertion catches it:
// crc_with_sof = crc16_ccitt([0x01, 0x05, 0x00, 0x05, 'h','e','l','l','o']) = 0x3B8C
// crc_without_sof (correct) = crc16_ccitt([0x05, 0x00, 0x05, 'h','e','l','l','o']) = 0xF9E3
//
// Test asserts: feeding FIXTURE_SLIDE_RS_HELLO (which has the correct CRC 0xF9E3)
// emits EVT_DATA_FRAME, NOT EVT_CRC_ERROR.
//
// Companion test asserts: feeding the same frame with bytes[9..11] = [0x3B, 0x8C]
// (the over-scope CRC) emits EVT_CRC_ERROR.
```

### CRC bit-flip test (pins under-scope contract)

```rust
// If implementation incorrectly omits PAYLOAD from CRC, flipping any payload byte
// would still pass. Test asserts: feeding FIXTURE_SLIDE_RS_HELLO with payload[2]
// = b'L' (uppercase) instead of b'l' emits EVT_CRC_ERROR.
```

---

## Idempotent Re-entry Test Cases

Six concrete byte streams + expected end states, exercising D-06's
"idempotent" contract and PITFALLS §9's re-entrant wakeup discipline.

### Re-entry Test 1 — `cancel()` while already in `CancelPending`

```rust
// Setup: enter recv mode, call cancel() once, drain outbound,
//        call cancel() again (idempotent per D-06).
let mut s = Slide::new();
s.enter_recv_mode();
s.feed_chunk(&[CTRL_RDY]);                  // → state = HeaderPhase, outbound = [CTRL_RDY]
s.clear_outbound();
s.cancel();                                  // → state = CancelPending, outbound = [CTRL_CAN]
let outbound_len_after_first = s.outbound_len();
s.cancel();                                  // idempotent — should be no-op
assert_eq!(s.state(), SlideState::CancelPending as u32);
assert_eq!(s.outbound_len(), outbound_len_after_first,
           "second cancel() must not push another CAN byte");
```

### Re-entry Test 2 — Peer-initiated CAN during CancelPending

```rust
// Both sides initiated cancel simultaneously. SM must accept the peer's
// CAN as the echo, not as a new cancel.
let mut s = Slide::new();
s.enter_recv_mode();
s.feed_chunk(&[CTRL_RDY]);
s.clear_outbound();
s.cancel();                                  // host-initiated, SM = CancelPending
s.clear_outbound();                          // simulate JS drained CAN to wire
s.feed_byte(CTRL_CAN);                       // peer's CAN arrives — interpreted as echo
assert_eq!(s.state(), SlideState::Done as u32,
           "peer CAN during CancelPending must complete the session");
```

### Re-entry Test 3 — Bytes silently consumed in CancelPending (D-07)

```rust
// While in CancelPending, all non-CAN bytes silently consumed.
let mut s = Slide::new();
s.enter_recv_mode();
s.feed_chunk(&[CTRL_RDY]);
s.cancel();
let event_ring_len_before = /* count events drained */;
s.feed_chunk(&[0x01, 0x05, 0x00, 0x05, b'h', b'e', b'l', b'l', b'o', 0xF9, 0xE3]);
let event_ring_len_after = /* count events drained */;
assert_eq!(event_ring_len_after, event_ring_len_before,
           "bytes during CancelPending must not emit framer events (D-07 silent drain)");
assert_eq!(s.state(), SlideState::CancelPending as u32);
```

### Re-entry Test 4 — Spurious mid-stream CTRL_CAN during DataPhase

```rust
// Z80 unilaterally cancels mid-transfer (e.g., disk full). PITFALLS §5
// + D-05: SM must transition to CancelPending and echo CTRL_CAN.
let mut s = Slide::new();
s.enter_recv_mode();
s.feed_chunk(&[CTRL_RDY]);
s.feed_chunk(FIXTURE_HEADER_TEST_TXT);       // header → state = DataPhase
s.clear_outbound();
s.feed_byte(CTRL_CAN);                       // peer-initiated mid-DataPhase cancel
assert_eq!(s.state(), SlideState::CancelPending as u32);
assert_eq!(s.outbound_buf().last(), Some(&CTRL_CAN),
           "bidirectional echo (D-05): receiving CAN must emit CAN");
```

### Re-entry Test 5 — `force_idle()` from CancelPending

```rust
// JS 2 s timeout fires; force_idle() takes us straight to Done.
let mut s = Slide::new();
s.enter_recv_mode();
s.feed_chunk(&[CTRL_RDY]);
s.cancel();                                  // SM = CancelPending
s.force_idle();                              // JS escape hatch
assert_eq!(s.state(), SlideState::Done as u32);
```

### Re-entry Test 6 — Garbage bytes in Idle state (Phase 1 D-15 silent discard)

```rust
// Random garbage between sessions doesn't blow up the framer.
let mut s = Slide::new();
// State is Idle; feed garbage that's not SOF, RDY, FIN, CAN, ACK, NAK
s.feed_chunk(&[0x00, 0xFF, 0x42, 0x7F, 0xAA]);
// Should still be in Idle, no events, no panics.
assert_eq!(s.state(), SlideState::Idle as u32);
```

---

## Common Pitfalls

### Pitfall 1: Time-related logic creeping into Rust core

**What goes wrong:** Copying `slide-rs/protocol.rs:70-78` (`read_byte_timeout`)
or `protocol.rs:82-108` (`recv_control` with deadline) verbatim brings
`std::time::{Duration, Instant}` into the wasm core. `tests/core_02_no_browser_deps.rs`
will fail (FORBIDDEN_TOKENS doesn't currently include `std::time` but
ARCHITECTURE.md anti-pattern 4 + D-06 + D-07 are explicit).

**Why it happens:** The reference implementation is a native CLI tool
that owns its own I/O loop. Its parsing logic and its timing logic are
intertwined. Phase 7 must extract only the *parsing* logic.

**How to avoid:** Copy ONLY `crc16_ccitt` (`protocol.rs:16-30`) and the
*shape* of `recv_frame_after_sof` (`protocol.rs:148-179`). Translate the
shape to a state machine that's fed bytes externally — never reads bytes
itself, never blocks, never sleeps. JS owns timing (PITFALLS §5 +
ARCHITECTURE.md §7).

**Warning signs:** any `use std::time` import appearing in `slide/`. Add
`std::time` to `tests/core_02_no_browser_deps.rs:FORBIDDEN_TOKENS_WITH_EXEMPTIONS`
as a Phase 7 hardening — though the planner can argue this is overreach
given Phase 1 didn't need it.

### Pitfall 2: CRC scope mistake — including SOF or excluding payload

**What goes wrong:** Including SOF in the CRC scope means every frame's
CRC differs from slide-rs's, even though the catalogue vector
`crc16_ccitt(b"123456789") == 0x29B1` still passes (since that test
doesn't include a SOF). 50% of frames pass when both ends agree on the
wrong scope, which masks the bug. Slide-rs ground truth is at
`protocol.rs:35-36, 170-173`.

**Why it happens:** The wire layout `[SOF][SEQ][LEN_H][LEN_L][PAYLOAD][CRC_H][CRC_L]`
visually suggests "all wire bytes between SOF and CRC" — but slide-rs
actually uses `[SEQ, LEN_H, LEN_L, ...PAYLOAD]` (excludes SOF).

**How to avoid:** The CRC-scope test fixture above (Fixture 7's CRC bit
0xF9E3 vs the over-scope value 0x3B8C) catches this directly. Failing
the test means the framer is wrong, not slide-rs.

**Warning signs:** Cross-validation against slide-rs `build_frame` fails
on every frame, but the catalogue vector passes.

### Pitfall 3: LE byte order for CRC on wire

**What goes wrong:** Packing CRC as `[crc & 0xFF, crc >> 8]` instead of
`[crc >> 8, crc & 0xFF]`. Slide-rs at `protocol.rs:41-42, 167-168` is
explicit: high byte first.

**Why it happens:** Rust's `to_be_bytes()` vs `to_le_bytes()` confusion;
or copy-paste from a different protocol where LE is convention.

**How to avoid:** Fixture 7 has CRC bytes `[0xF9, 0xE3]` — if the framer
emits `[0xE3, 0xF9]` it fails the test.

**Warning signs:** Catalogue vector passes; cross-validation fails on
every frame; first byte mismatches consistently.

### Pitfall 4: `Vec::with_capacity` not actually pre-reserving

**What goes wrong:** `Vec::with_capacity(1024)` returns a Vec with
`len()=0`. Indexing into `payload_buf[i]` while `i >= len` panics. Must
use `payload_buf.push(b)` or `payload_buf.resize(remaining, 0)` then
overwrite.

**Why it happens:** Confusing capacity (allocation size) with length
(addressable). Phase 1 D-17 stable-pointer discipline relies on capacity,
not length.

**How to avoid:** Use `payload_buf.push(b)` per byte (append-only) or
re-allocate via `resize` once at frame start. Verify
`payload_buf.as_ptr()` is stable across `feed_byte` (Phase 1
`pack_ptr_stable_across_feed` test pattern at `terminal.rs:833-845`).

### Pitfall 5: Per-byte FFI cost on hot data path

**What goes wrong:** JS calling `slide.feed_byte(b)` 1024 times per
frame. Each call is a wasm boundary crossing (~50 ns); 1024 × 50 ns = 51 μs
per frame, plus event drain. At 19200 baud (~2 KB/s) that's tolerable,
but wasteful.

**Why it happens:** `feed_byte` is the simpler API; tempting to use it
exclusively.

**How to avoid:** `feed_chunk(bytes)` is the hot path for data-phase
bytes. Phase 7 ships both; Phase 8 wraps both; Phase 10 documents
"call feed_chunk for chunks, not feed_byte" in the dispatcher.

### Pitfall 6: Forgetting D-04(a) reference vector in tests

**What goes wrong:** The `crc16_ccitt(b"123456789") == 0x29B1` pin is the
**only** test that distinguishes CCITT-FALSE from XMODEM (init=0x0000) and
CCITT-AUG (init=0x1D0F) and KERMIT (refin/refout=true). All three pass
the build_frame roundtrip test against frames they themselves built. Only
the catalogue vector pins which CRC variant.

**Why it happens:** "I copied from slide-rs, it must be right." Maybe —
but a future commit could refactor `crc16_ccitt` and accidentally swap
the init constant.

**How to avoid:** Make the catalogue vector test the **first** test in
`slide/crc.rs#tests` and `slide/tests.rs`. Non-negotiable per D-04(a).

---

## Code Examples

Verified patterns from existing files + slide-rs. Each annotation cites
file:line.

### Example 1 — Outbound buffer with stable pointer (Phase 7 mirrors Phase 1)

```rust
// Source: crates/bestialitty-core/src/terminal.rs:107-123 (pattern)
//         crates/bestialitty-core/src/lib.rs:83-95     (wasm wrapper Phase 8 mirrors)

// Phase 7 in slide/state.rs:
impl Slide {
    pub fn outbound_ptr(&self) -> *const u8 { self.outbound_buf.as_ptr() }
    pub fn outbound_len(&self) -> usize { self.outbound_buf.len() }
    pub fn clear_outbound(&mut self) { self.outbound_buf.clear(); }
}

// Phase 8 in lib.rs (NOT for this phase, but for shape reference):
// pub fn outbound_ptr(&self) -> *const u8 { self.inner.outbound_ptr() }
// pub fn outbound_len(&self) -> usize { self.inner.outbound_len() }
// pub fn clear_outbound(&mut self) { self.inner.clear_outbound(); }
```

### Example 2 — CRC scope assembly (verbatim from slide-rs)

```rust
// Source: /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:35-37, 170-173
// Phase 7 in slide/framer.rs (transition from WaitingLenLo to ReadingPayload):
//
// Build CRC input incrementally as bytes arrive — pre-reserved 1027-byte buf.
// At frame start (WaitingSeq → WaitingLenHi): clear + push seq.
// At each subsequent byte (LEN_H, LEN_L, payload bytes): push.
// At WaitingCrcLo terminal step: compute crc16_ccitt(&self.crc_input_buf).
// Note: SOF is NOT pushed; CRC bytes themselves are NOT pushed.
```

### Example 3 — Torn-chunk test pattern (mirror Phase 1 `tests/torn_chunk.rs`)

```rust
// Source: pattern from crates/bestialitty-core/tests/torn_chunk.rs (Phase 1)
//
// crates/bestialitty-core/tests/slide_torn_chunk.rs (Phase 7 NEW):

use bestialitty_core::slide::Slide;

fn assert_identical_across_splits(input: &[u8], expected_state: u32) {
    // Whole-feed reference run.
    let mut reference = Slide::new();
    reference.enter_recv_mode();
    let _ = reference.feed_chunk(input);
    let ref_state = reference.state();
    assert_eq!(ref_state, expected_state);

    // For every internal split offset 1..input.len():
    for split in 1..input.len() {
        let mut s = Slide::new();
        s.enter_recv_mode();
        let _ = s.feed_chunk(&input[..split]);
        let _ = s.feed_chunk(&input[split..]);
        assert_eq!(
            s.state(), ref_state,
            "split at offset {} produced different state",
            split
        );
    }
}

#[test]
fn fixture_subframe_hi_torn_chunk_safe() {
    use bestialitty_core::slide::tests_only::FIXTURE_SUBFRAME_HI;
    assert_identical_across_splits(
        // Driver bytes: enter_recv_mode then feed RDY then feed the frame.
        // For this test, just feed the frame directly and assert state advances
        // identically regardless of split.
        FIXTURE_SUBFRAME_HI,
        SlideState::DataPhase as u32,
    );
}
```

### Example 4 — Cross-validation against slide-rs reference frames

```rust
// crates/bestialitty-core/tests/slide_reference_corpus.rs (Phase 7 NEW)

use bestialitty_core::slide::tests_only::*;
use bestialitty_core::slide::{Slide, SlideState, EVT_DATA_FRAME};

#[test]
fn reference_frame_hello_seq_5_validates() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_byte(0x11);                          // RDY
    s.feed_byte(0x11);                          // mock peer's RDY echo (would normally come from peer)
    // Now in DataPhase via header skip — for this test, feed manually:
    s.feed_chunk(FIXTURE_SLIDE_RS_HELLO);
    // Assert exactly one EVT_DATA_FRAME with seq=5 emerged.
    let evt = s.take_event_packed();
    assert_eq!(evt >> 16, EVT_DATA_FRAME);
    assert_eq!(evt & 0xFFFF, 0x05);
}

#[test]
fn reference_vector_123456789() {
    use bestialitty_core::slide::crc16_ccitt;
    assert_eq!(crc16_ccitt(b"123456789"), 0x29B1);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `crc = "=3.4"` crate (STACK.md original recommendation) | Hand-rolled `crc16_ccitt` per D-01 | 2026-05-06 (CONTEXT.md D-01) | -1 dep; +1 file; ADR-001-style auditability gain |
| Naive frame-at-a-time parsing | Byte-fed state machine in Rust core | 2026-04-25 (PITFALLS §1, BLOCKING) | Eliminates torn-chunk hazard; testable in isolation |
| `ESC ^` 2-byte wakeup signature | `ESC ^ S L I D E` 7-byte signature | 2026-05-06 (PROJECT.md OQ-2 resolution) | Reduces false-positive collisions; out of scope for Phase 7 (Phase 8 owns wakeup detection) |
| Native blocking `recv_control` + `recv_frame` (slide-rs/slide-py) | Event-driven byte-fed Rust SM | 2026-05-06 (Phase 7 design) | No `std::time` in core; JS owns event loop |
| ~~SLIDE v0.2 PC→Z80-only CAN~~ | v0.2.1 bidirectional CAN amendment | 2026-05-06 (D-05..D-08, ADR-003 deliverable) | Both sides may initiate; both must echo |

**Deprecated/outdated:**
- STACK.md §Recommended Stack — Additions: lists `crc = "=3.4"` as a
  recommendation. Superseded by D-01 in CONTEXT.md. STACK.md is a
  research artefact, not a decision; D-01 is the binding decision.
  Cargo.toml comment in Phase 7 should explicitly note the rejection.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Z80 echoes CTRL_CAN on receiving it (v0.2.1 strict bidirectional D-05) | §Sliding-Window State Machine, §CTRL_CAN Wire Format | Already explicitly an [ASSUMED] design — depends on the upstream Z80 PR being accepted. PITFALLS §5: BLOCKING in cancellation flow if Z80 doesn't echo. **Mitigation:** D-06 `force_idle()` provides JS-driven escape hatch; ADR-003 documents the assumption + Phase 12 UAT verifies on real hardware. |
| A2 | Receiver-only sender SM scope satisfies SLIDE-04 | §SM Scope Recommendation | If the planner / reviewer insists "both directions in Phase 7", the recommendation flips and Phase 7 grows ~50% larger. Docs in §Sender SM transitions show the alternative state table. |
| A3 | Hybrid event surface (packed u32 per feed_byte; ring + drain for feed_chunk) is acceptable | §Event Surface | If the planner prefers ring-only or packed-only, the recommendation is overrideable; the underlying Slide struct is shape-flexible. |
| A4 | Reference fixture CRC values (0xFF4E, 0xACD7, 0xCC9C, 0x105C, 0x045A, 0xED8D, 0xF9E3) are correct | §Test Corpus Byte Vectors | All 7 were re-computed from the spec using a Python implementation that matches `slide-py/common.py:22-32` line-for-line and matches `slide-rs/protocol.rs:16-30` algorithmically. Re-verification at planning time recommended (run `slide-rs --debug` over the same payloads). |
| A5 | Phase 1's torn-chunk test pattern (split-at-every-internal-offset) scales to ~1030-byte SLIDE frames | §Test Corpus, §Validation Architecture | Worst case 1030 splits × 7 fixtures = 7210 split assertions. Wall-clock cost on `cargo test`: estimated <1 s (each split is a Slide::new + feed_chunk + state read; ~5 μs each). If too slow, reduce to power-of-2 splits (10 splits per fixture). |
| A6 | The Phase 8 export surface (per ARCHITECTURE.md §1) is mechanical to wrap given the Slide struct shape proposed | §Slide Struct Shape | Phase 8 must verify by writing the lib.rs wrapper and rebuilding; if any export needs additional Rust-side state, Phase 7 may need a follow-up tweak. Risk LOW — every method maps 1:1. |

---

## Open Questions

These are not research gaps — they are decisions that get answered at
planning time or are deferred to later phases.

1. **Should the planner choose to ship sender SM in Phase 7 anyway?**
   - What we know: receiver-only is recommended; sender SM doubles test
     surface and has no testable shape without a peer.
   - What's unclear: planner's risk tolerance for "Phase 7 doesn't fully
     answer SLIDE-04 alone (relies on Phase 9 to complete the picture)."
   - Recommendation: Default to receiver-only. If reviewer pushes back,
     revisit with §Sender SM transitions table — the work is well-scoped
     even if it doubles the test surface.

2. **Should `tests/core_02_no_browser_deps.rs` be hardened to forbid
   `std::time`?**
   - What we know: Phase 1 didn't need it; ARCHITECTURE.md anti-pattern 4
     + D-06 are explicit about no time logic in core.
   - What's unclear: whether to broaden the gate as a Phase 7 deliverable
     vs trust convention.
   - Recommendation: Add `std::time` to FORBIDDEN_TOKENS_WITH_EXEMPTIONS
     as a Phase 7 belt-and-braces. Cheap to add; closes a foot-gun.

3. **Granularity of `EVT_PROTOCOL_ERROR`?**
   - What we know: ARCHITECTURE.md §1 lists `event_kind = 9` as
     "error" + `aux = error_code`.
   - What's unclear: how many error codes Phase 7 surfaces.
     Recommendation: 4 codes — `ERR_CRC_RETRY_EXHAUSTED = 1`,
     `ERR_NAK_BUDGET_EXHAUSTED = 2`, `ERR_UNEXPECTED_STATE_TRANSITION = 3`,
     `ERR_HEADER_PARSE = 4`. Mirrors slide-rs `recv.rs` retry budget
     concept.

4. **Should `FRAME_SIZE = 1024` be a const, a config constant, or
   `Slide::new` parameter?**
   - What we know: SLIDE v0.2 spec says exactly 1024 bytes/frame; not
     negotiable per spec.
   - Recommendation: `pub const FRAME_SIZE: usize = 1024;` and
     `pub const WIN_SIZE: usize = 4;` at module level — exact match to
     slide-rs `protocol.rs:12-13`. Not configurable; spec-fixed.

5. **`current_file_metadata` payload format on the JS-side accessor?**
   - What we know: `current_file_metadata_ptr/_len` exposes a
     null-terminated ASCII filename + LE u32 size — same shape as the
     wire header payload (per `slide-rs/protocol.rs:46-57`).
   - Recommendation: forward the wire payload bytes verbatim. JS parses
     the same bytes the wire delivered — single source of truth.

---

## Environment Availability

> Phase 7 is purely code/config — Rust core changes only, no external
> services. Standard Rust toolchain assumed.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | All Rust work | ✓ | 1.85+ stable, Edition 2024 (per Phase 1) | — |
| `cargo test` (native) | All Phase 7 testing | ✓ | bundled with cargo | — |
| `cargo build --target x86_64-unknown-linux-gnu` | Validation Architecture | ✓ | bundled | — |
| `wasm-pack` | NOT used in Phase 7 (Phase 8 concern) | — | — | — |
| `slide-rs` binary | NOT required at build/test time per D-04 (offline fixture corpus) | (irrelevant) | — | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust native, std-only) |
| Config file | `crates/bestialitty-core/Cargo.toml` (existing) |
| Quick run command | `cargo test -p bestialitty-core slide` (slide-prefixed unit + integration) |
| Full suite command | `cargo test -p bestialitty-core` (whole crate including Phase 1+ regressions) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| **SLIDE-01** | `slide/` module exists; `pub mod slide;` in `lib.rs`; `Slide::new()` constructs in Idle state | unit | `cargo test -p bestialitty-core slide::tests::new_constructs_in_idle -x` | ❌ Wave 0 — `slide/tests.rs` |
| **SLIDE-01** | `core_02_no_browser_deps` test remains green for `slide/` (zero browser deps) | integration | `cargo test -p bestialitty-core --test core_02_no_browser_deps` | ✅ exists; auto-covers new module |
| **SLIDE-01** | `boundary_api_shape`-style contract test pinning `Slide` public surface (anticipates Phase 8 wrapper) | integration | `cargo test -p bestialitty-core --test slide_boundary_shape` | ❌ Wave 0 — `tests/slide_boundary_shape.rs` |
| **SLIDE-02** | Each fixture frame's state advances identically when split at every internal offset | integration | `cargo test -p bestialitty-core --test slide_torn_chunk` | ❌ Wave 0 — `tests/slide_torn_chunk.rs` (mirror of `tests/torn_chunk.rs`) |
| **SLIDE-02** | Multi-frame chunk feeds resolve identically across splits (e.g., RDY+header+ACK in one chunk vs three) | integration | `cargo test -p bestialitty-core --test slide_torn_chunk -- multi_frame` | ❌ Wave 0 |
| **SLIDE-03** | `crc16_ccitt(b"123456789") == 0x29B1` reference vector | unit | `cargo test -p bestialitty-core slide::crc::tests::reference_vector_123456789 -x` | ❌ Wave 0 — `slide/crc.rs#tests` |
| **SLIDE-03** | All 7 fixtures (FIXTURE_HEADER_TEST_TXT, FIXTURE_SUBFRAME_HI, FIXTURE_EMPTY_SEQ_0, FIXTURE_EOF_SEQ_4, FIXTURE_ALL_FF_16, fixture_max_payload_aa(), FIXTURE_SLIDE_RS_HELLO) feed-and-validate cleanly | integration | `cargo test -p bestialitty-core --test slide_reference_corpus` | ❌ Wave 0 — `tests/slide_reference_corpus.rs` |
| **SLIDE-03** | CRC-scope test (SOF-not-included): mutated SOF byte does NOT change CRC; mutated SEQ/LEN/PAYLOAD byte DOES change CRC | unit | `cargo test -p bestialitty-core slide::framer::tests::crc_scope_excludes_sof -x` | ❌ Wave 0 — `slide/framer.rs#tests` |
| **SLIDE-03** | CRC big-endian wire order: feeding fixture with bytes[CRC_H, CRC_L] swapped emits `EVT_CRC_ERROR` | unit | `cargo test -p bestialitty-core slide::framer::tests::crc_wire_order_big_endian -x` | ❌ Wave 0 |
| **SLIDE-04** | Receiver SM: `enter_recv_mode → feed RDY` emits `EVT_RDY` and pushes RDY echo to `outbound_buf` | unit | `cargo test -p bestialitty-core slide::state::tests::recv_rdy_echoed -x` | ❌ Wave 0 — `slide/state.rs#tests` |
| **SLIDE-04** | Receiver SM: header frame triggers ACK with seq=0 | unit | `cargo test -p bestialitty-core slide::state::tests::header_acks_seq_0 -x` | ❌ Wave 0 |
| **SLIDE-04** | Receiver SM: data frame seq mismatch triggers NAK with `expected_seq` | unit | `cargo test -p bestialitty-core slide::state::tests::seq_mismatch_naks -x` | ❌ Wave 0 |
| **SLIDE-04** | Receiver SM: NAK budget = 15 retries; on 16th CRC error, transitions to `Error` | unit | `cargo test -p bestialitty-core slide::state::tests::nak_budget_exhaustion -x` | ❌ Wave 0 |
| **SLIDE-04** | Receiver SM: EOF frame (zero-payload data frame) triggers ACK and loops to `HeaderPhase` | unit | `cargo test -p bestialitty-core slide::state::tests::eof_frame_loops_to_header -x` | ❌ Wave 0 |
| **SLIDE-04** | Receiver SM: FIN in `HeaderPhase` triggers FIN echo and transitions to `Done` | unit | `cargo test -p bestialitty-core slide::state::tests::fin_echoes_and_completes -x` | ❌ Wave 0 |
| **SLIDE-04** | `cancel()` builds CTRL_CAN, transitions to `CancelPending`, idempotent on second call | unit | `cargo test -p bestialitty-core slide::state::tests::cancel_idempotent -x` | ❌ Wave 0 |
| **SLIDE-04** | Peer-initiated CAN during DataPhase echoes CTRL_CAN and transitions to `CancelPending` (D-05) | unit | `cargo test -p bestialitty-core slide::state::tests::peer_can_echoes -x` | ❌ Wave 0 |
| **SLIDE-04** | CancelPending: non-CAN bytes silently consumed; no events emitted (D-07) | integration | `cargo test -p bestialitty-core --test slide_idempotent_reentry cancel_pending_silent_drain` | ❌ Wave 0 — `tests/slide_idempotent_reentry.rs` |
| **SLIDE-04** | CancelPending: peer's CAN echo transitions to `Done` | integration | `cargo test -p bestialitty-core --test slide_idempotent_reentry can_echo_completes` | ❌ Wave 0 |
| **SLIDE-04** | `force_idle()` from any state transitions to `Done` | unit | `cargo test -p bestialitty-core slide::state::tests::force_idle_transitions_to_done -x` | ❌ Wave 0 |
| **SLIDE-04** | All 6 idempotent-re-entry tests in §Re-entry Test Cases pass | integration | `cargo test -p bestialitty-core --test slide_idempotent_reentry` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cargo test -p bestialitty-core slide` (slide-prefixed
  unit + integration; expected wall-clock <2 s)
- **Per wave merge:** `cargo test -p bestialitty-core` (full crate; includes
  Phase 1 regressions; expected wall-clock <5 s)
- **Phase gate:** `cargo test -p bestialitty-core --release` green; PLUS
  `cargo test -p bestialitty-core --test core_02_no_browser_deps` green
  (zero-browser-deps invariant); PLUS `cargo build --target x86_64-unknown-linux-gnu`
  succeeds (D-20 native build invariant).

### Wave 0 Gaps

- [ ] `crates/bestialitty-core/src/slide/mod.rs` — module surface, re-exports
- [ ] `crates/bestialitty-core/src/slide/crc.rs` — `crc16_ccitt` + `tests` block (3 tests min: catalogue vector, slide-rs roundtrip, edge cases)
- [ ] `crates/bestialitty-core/src/slide/framer.rs` — `FramerState` enum + `feed_byte_framer` + `tests` block (8 tests min: each transition table row + 2 CRC-scope tests)
- [ ] `crates/bestialitty-core/src/slide/state.rs` — `Slide` struct + `SlideState` enum + receiver SM + `cancel`/`force_idle` + `tests` block (12 tests min covering each receiver SM transition)
- [ ] `crates/bestialitty-core/src/slide/tests.rs` — module-level integration smoke (5 tests)
- [ ] `crates/bestialitty-core/src/slide/tests_only.rs` — `#[cfg(test)] pub` re-exports of fixture constants for cross-test reuse
- [ ] `crates/bestialitty-core/tests/slide_torn_chunk.rs` — torn-chunk corpus (mirror `tests/torn_chunk.rs`)
- [ ] `crates/bestialitty-core/tests/slide_reference_corpus.rs` — 7 fixtures cross-validated against slide-rs contract
- [ ] `crates/bestialitty-core/tests/slide_idempotent_reentry.rs` — 6 re-entry tests from §Re-entry Test Cases
- [ ] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — Phase 8 anticipation contract
- [ ] `crates/bestialitty-core/src/lib.rs` — modify line 16-21 to add `pub mod slide;`
- [ ] `crates/bestialitty-core/Cargo.toml` — add D-01 audit-trail comment (no new deps)
- [ ] `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — Nygard-style ADR per D-08
- [ ] (Optional, recommended) `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — extend FORBIDDEN_TOKENS to include `std::time` (Open Question 2)

*(Framework install: none. Rust toolchain already in place.)*

---

## Project Constraints (from CLAUDE.md)

These directives constrain Phase 7 with the same authority as locked
decisions in CONTEXT.md:

| Directive | Source | Phase 7 Application |
|-----------|--------|---------------------|
| Rust → wasm core owns the parser, terminal state, key encoding. Pure logic. Zero `web-sys` / `js-sys::Serial*` / DOM / I/O dependencies. | CLAUDE.md §Architecture | `slide/` is pure Rust — no wasm-bindgen, no web-sys, no js-sys, no `std::time`. |
| JavaScript shell owns Web Serial I/O, canvas rendering, event loop, browser state. No business logic. | CLAUDE.md §Architecture | All cancel timing (200/500/100/2000 ms) lives in JS. Rust SM is purely event-driven. |
| Rust↔JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`). | CLAUDE.md §Architecture | Phase 8 will add the `Slide` `#[wasm_bindgen]` wrapper in `lib.rs`. Phase 7 only ships the inner struct. |
| Web Serial is driven from JS, not Rust. No Rust Web Serial bindings. | CLAUDE.md §Architecture | Rust SLIDE never reads/writes Web Serial; only emits bytes into `outbound_buf`. |
| Chromium-only. | CLAUDE.md §Architecture | Phase 7 has no browser surface; constraint is downstream-only. |
| Static site deploy only. No server runtime. | CLAUDE.md §Architecture | Phase 7 has no deploy artefact; no impact. |
| VT52 pragmatic subset — only what the MicroBeast actually emits. | CLAUDE.md §Architecture | Unrelated; SLIDE protocol is its own wire spec. |
| Phases execute strictly in order 1 → 2 → 3 → 4 → 5 → 6. | CLAUDE.md §Workflow | Phase 7 follows Phase 6 (complete). |
| No AI attribution in commit messages — never add Co-Authored-By: Claude or mention Claude/Anthropic in any commit message | userMemory feedback_commit_messages.md | All Phase 7 commit messages must omit any AI attribution. |

---

## Sources

### Primary (HIGH confidence)

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec authoritative source
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:16-30` — CRC reference (D-01 source)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:32-57` — `build_frame` / `build_header_frame` ground truth
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:96-108` — `recv_control` shape (control bytes single-byte)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:124-179` — `recv_frame` byte-fed pattern
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:199-206` — `send_control` raw-byte CTRL_CAN
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:227` — `crc16_ccitt(b"123456789") == 0x29B1` reference vector
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/recv.rs:140-217` — receiver SM reference
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/send.rs:155-249` — sender SM reference (deferred to Phase 9)
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py:22-32` — Python CRC implementation (cross-check)
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py:35-49` — Python build_frame (cross-check)
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py:64-71` — Python `recv_control` confirms single-byte CTRL_CAN
- `/home/ant/src/microbeast/SLIDE/README.md:151-158` — protocol spec summary (RTS/CTS hardware flow control note relevant to Phase 9)
- `crates/bestialitty-core/src/lib.rs:13-21` — module tree where `pub mod slide;` is added
- `crates/bestialitty-core/src/lib.rs:33-190` — wasm boundary Phase 8 will extend
- `crates/bestialitty-core/src/terminal.rs:107-123` — `host_reply` stable-pointer pattern (Phase 7 outbound_buf mirror)
- `crates/bestialitty-core/src/terminal.rs:833-845` — `pack_ptr_stable_across_feed` pattern test
- `crates/bestialitty-core/Cargo.toml:18-32` — current dep set + ADR-002 wasm gating
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs:36-67` — FORBIDDEN_CRATES + FORBIDDEN_TOKENS gate
- `crates/bestialitty-core/tests/torn_chunk.rs` — Phase 1 torn-chunk template
- `.planning/decisions/ADR-001-parser-strategy.md` — pin convention `vte = "=0.15"` + spike→ADR pattern
- `.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen gating + `core_02_no_browser_deps.rs` invariant
- `.planning/research/ARCHITECTURE.md` §1 — Phase 8 export surface + event packing scheme
- `.planning/research/ARCHITECTURE.md` §7 — cancellation propagation contract
- `.planning/research/ARCHITECTURE.md` §9 — build orchestration + module layout
- `.planning/research/PITFALLS.md` §1 — chunk-boundary framing (BLOCKING)
- `.planning/research/PITFALLS.md` §3 — CRC variant (BLOCKING)
- `.planning/research/PITFALLS.md` §5 — cancellation race (BLOCKING; v0.2.1 amendment rationale)
- `.planning/research/PITFALLS.md` §9 — re-entrant ESC^ idempotent SM
- `.planning/research/PITFALLS.md` §13 — test isolation / mock peer
- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md` — D-15 silent discard, D-16 fixture pattern, D-19 module layout, D-20 cross-target reuse
- `.planning/phases/07-slide-rust-core-framer-crc-state-machine/07-CONTEXT.md` — D-01..D-08 locked decisions

### Secondary (MEDIUM confidence)

- Greg Cook CRC catalogue (https://reveng.sourceforge.io/crc-catalogue/all.htm) — confirms CRC-16/IBM-3740 = poly 0x1021, init 0xFFFF, no refin/refout, xorout 0x0000
- `.planning/research/SUMMARY.md` — milestone synthesis (already locked decisions)
- `.planning/research/STACK.md` — original `crc = "=3.4"` recommendation **superseded** by D-01

### Tertiary (LOW confidence)

- (none — every claim is grounded in primary or secondary source)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — D-01 explicitly forbids new deps; one-line audit trail
- Architecture (framer + receiver SM): HIGH — every transition cited from slide-rs:line
- Architecture (sender SM): HIGH for what's documented; receives recommendation to defer to Phase 9
- CTRL_CAN wire format: HIGH — three independent citations confirm raw 0x18 byte
- Test corpus reference vectors: HIGH — independently re-computed; matches slide-rs contract
- Pitfalls: HIGH — all five BLOCKING pitfalls grounded in source + spec
- Validation Architecture: HIGH — every requirement has an automated test command

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (30 days; SLIDE v0.2 protocol is stable; Z80 PR coordination is the only moving piece)
