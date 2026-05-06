# Phase 7: SLIDE Rust Core — Framer, CRC, State Machine - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

A pure-Rust SLIDE state machine living in a new `crates/bestialitty-core/src/slide/`
module: byte-fed framer, CRC-16-CCITT exact-match, sliding-window send/receive
handshakes (RDY / ACK / NAK / CAN / FIN / CTRL_FIN per SLIDE v0.2 plus the
v0.2.1 CAN-bidirectional amendment) — all provable by native `cargo test` with
zero browser involvement.

**In scope:** new `slide/` module (crc, framer, state, mod, tests); CRC-16-CCITT
implementation + reference-vector pin + slide-rs cross-validation corpus; byte-fed
framer with explicit per-field state machine and torn-chunk safety; sliding-window
SM (4 frames × 1024 bytes) covering all SLIDE v0.2 control bytes plus v0.2.1
CAN-bidirectional amendment (PC↔Z80 echo); `Slide::cancel()` + `force_idle()`
APIs for JS-driven cancellation flow; ADR-003 documenting the v0.2.1 amendment;
native `cargo test` corpus including torn-chunk and idempotent-re-entry tests;
preservation of the `tests/core_02_no_browser_deps.rs` invariant.

**Out of scope:** wasm-bindgen exports for the new `Slide` struct (Phase 8); the
JS dispatcher routing Web Serial chunks to terminal-or-SLIDE (Phase 8); ESC ^
wakeup detection (Phase 8); TX writer ownership handoff (Phase 8); file picker /
drag-drop / auto-type (Phase 9); receiver-side file reassembly + Chrome download
(Phase 10); floating chip + cancellation UX wiring (Phase 11); real-hardware UAT,
docs, Z80 PR coordination (Phase 12).

</domain>

<decisions>
## Implementation Decisions

### CRC implementation

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

### CAN v0.2.1 bidirectional amendment

- **D-05:** **Strict bidirectional echo.** Either side may initiate `CTRL_CAN`.
  The other side MUST echo `CTRL_CAN` back within an implementation-defined window
  (JS owns the timeout, Rust SM is event-driven). Both sides then drain the wire
  and return to idle. This locks the contract that ARCHITECTURE.md §7 and
  PITFALLS §5 already assume; rejects "initiator-only no echo" and "PC-initiated
  only" alternatives because they leave Phase 10's hard-fail recovery weaker and
  conflict with SLIDE-04's "bidirectional" wording.
- **D-06:** **`Slide::cancel()` API.** Fire-and-set-state: builds the CAN frame,
  appends to `outbound_buf`, transitions SM to `CancelPending`. **Idempotent** —
  calling `cancel()` while already in `CancelPending` is a no-op. JS drains
  `outbound_buf` (writes CAN bytes to wire), then waits its own ~500 ms for the
  inbound CAN echo. On echo received via `feed_byte` / `feed_chunk`, the SM emits
  `EVT_SESSION_COMPLETE` and transitions to `Done`. A separate **`force_idle()`**
  method gives JS a timeout escape hatch (after ~2 s with no echo, JS forcibly
  drops CancelPending and resets the SM). All timing lives in JS; Rust is purely
  event-driven. Honours the no-`std::time`-in-Rust invariant
  (ARCHITECTURE.md anti-pattern 4).
- **D-07:** **Drain semantics in CancelPending.** While the SM is in
  `CancelPending`, `feed_byte` / `feed_chunk` silently consume incoming bytes
  (events emit nothing) until a CAN echo is recognised → transition to `Done`.
  JS owns the post-echo drain window via its own read loop (~100 ms keeps reading
  + feeding, then stops). No byte-count threshold or quiescence detector in Rust;
  no time logic in Rust.
- **D-08:** **Documentation deliverable: `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md`**
  (Nygard-style; mirrors ADR-001 / ADR-002). Records: spec extension over
  upstream SLIDE v0.2; frame format for CTRL_CAN; echo discipline (D-05); drain
  semantics (D-07); rationale for choosing strict bidirectional over alternatives;
  cross-link to the upstream `github.com/blowback/slide` PR (Phase 12 dependency).
  The user-facing `docs/SLIDE_Z80_REQUIREMENT.md` (Phase 12 deliverable per
  SLIDE-40) will reference ADR-003.

### Claude's Discretion

The following intentionally remain unlocked at the planning/research stage:

- **Exact CTRL_CAN wire format** — raw byte 0x18 vs wrapped frame
  (`SOF SEQ LEN_H LEN_L 0x18 CRC_H CRC_L`) — resolve from
  `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` at planning time and
  capture in ADR-003.
- **State machine event surface** — packed `u32` events `(kind << 16) | aux`
  per call (ARCHITECTURE.md §1 recommendation, mirrors Phase 1 `cursor_packed`)
  vs internal event ring + `take_event()` drain accessor (mirrors Phase 1
  `host_reply` pattern). Default to ARCHITECTURE.md §1's packed-u32 recommendation
  unless planning surfaces a reason to change. The choice locks the Rust↔JS
  shape Phase 8 will wrap.
- **Phase 7 SM scope: sender + receiver, or framer + receiver only.** SLIDE-04
  success criteria say "sliding-window state machine handles RDY/ACK/NAK/CAN/FIN
  per SLIDE v0.2 plus the v0.2.1 CAN-bidirectional amendment; cancellation and
  idempotent re-entry are exercised in unit tests" — interpreted as "both
  directions in Phase 7" by default. Planner may scope down to "framer + receiver
  SM only, defer sender SM to Phase 9" if that lands cleaner against test-corpus
  cost.
- **Test fixture corpus content** — which exact frames to pin (4–6 representative
  shapes covering empty payload, sub-frame, max payload, all-FF, header-only).
  Planner picks at the test-design step; CRC reference vector
  (`crc16_ccitt(b"123456789") == 0x29B1`) is non-negotiable.
- **Re-entrant CAN handling specifics** — covered by the "idempotent" D-06
  contract; specific edge-case test cases (Z80 reboots mid-cancel, double-CAN
  initiation, CAN during CancelPending) chosen at planning time and exercised in
  `slide/tests.rs`.
- **Specific Rust error type choice** — matches Phase 1 D-15 pattern: silent
  discard for malformed wire bytes (return to a safe state), explicit `Error`
  events for protocol-level errors (CRC fail, NAK retry budget exhausted,
  unexpected-state transition).
- **Native test layout** — `crates/bestialitty-core/src/slide/tests.rs` (per
  ARCHITECTURE.md §9) supplemented by `crates/bestialitty-core/tests/slide_*.rs`
  integration files for torn-chunk and reference-corpus tests, mirroring Phase 1's
  `tests/torn_chunk.rs` style. Both, not either-or.
- **Module visibility from `lib.rs`** — `pub mod slide;` from the start (Phase 8
  expects this) vs private until Phase 8 wires the wasm-bindgen façade. Default
  to `pub mod slide;` so cargo test can exercise the module without re-export
  gymnastics.
- **`ParseError` / `Result` granularity** — discretion of planner / writer.
- **CRC byte-vector layout in fixtures** — wire-order vs structured-record
  per fixture; planner chooses readable layout.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` §Current Milestone — v1.1 FileTransfer locked scope,
  architecture (Rust core / JS shell split), Z80 PR delivery model
- `.planning/REQUIREMENTS.md` §SLIDE protocol (Phase 7 covers SLIDE-01..04)
- `.planning/ROADMAP.md` §Phase 7 — goal, dependencies, 5 success criteria

### v1.1 milestone research

- `.planning/research/SUMMARY.md` — synthesis; §3 Architecture Decisions, §4
  BLOCKING pitfalls (P1 framing, P3 CRC), §5 phase boundaries
- `.planning/research/ARCHITECTURE.md` §1 wasm-bindgen façade for Slide
  (the Phase 8 contract Phase 7 must be ready for); §7 cancellation propagation;
  §9 build orchestration; §Anti-Patterns 1, 2, 4, 5 (Phase 7-relevant)
- `.planning/research/PITFALLS.md` §1 (chunk-boundary framing), §3 (CRC variant),
  §5 (cancellation race + v0.2.1 amendment rationale), §9 (re-entrant `ESC ^`),
  §13 (test isolation / mock peer)
- `.planning/research/STACK.md` §Recommended Stack — Additions
  (rejected `crc` crate per D-01; canonical reference for hand-roll choice)
- `.planning/research/FEATURES.md` — table-stakes for v1.1 milestone (context
  for what Phase 7 enables downstream)

### Existing project decisions

- `.planning/decisions/ADR-001-parser-strategy.md` — chose `vte = "=0.15"` for
  VT52 parser; SLIDE is its own framer (not vte-based) — different SM semantics
- `.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen attrs gated to
  `target_arch = "wasm32"` only in `lib.rs`; `tests/core_02_no_browser_deps.rs`
  invariant must remain green for the whole crate including new `slide/` module

### Decisions to be created in this phase

- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — **written during
  Phase 7** (D-08); records the bidirectional CAN echo contract, frame format,
  drain semantics, and rationale

### SLIDE upstream protocol & reference impls

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — authoritative protocol spec
  (frame format, control bytes, sliding window WIN_SIZE=4, CRC variant)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` — **reference for D-01**
  (lines 16-30 are the CRC source); also defines `build_frame`, frame parse,
  control-byte constants — Phase 7's correctness contract is byte-for-byte equality
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/send.rs` — sender SM reference
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/recv.rs` — receiver SM reference
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py` — Python ref impl
  (cross-check for ambiguous spec sections)
- `/home/ant/src/microbeast/SLIDE/README.md` — RTS/CTS hardware flow control note

### Existing core crate seams (Phase 7 modifies / honours)

- `crates/bestialitty-core/src/lib.rs:13-21` — module tree; add `pub mod slide;`
  here (Claude's discretion — default is from-the-start visibility)
- `crates/bestialitty-core/src/lib.rs:33-190` — existing `mod wasm_boundary`
  (Phase 8 will add `Slide` wasm-bindgen wrapper here, sibling to `Terminal`;
  Phase 7 leaves this file mostly alone but ensures the `Slide` struct is
  shaped to be wrappable cleanly)
- `crates/bestialitty-core/src/terminal.rs` — pattern reference for the
  pure-logic `Slide` struct (event-driven, no time, no I/O)
- `crates/bestialitty-core/tests/torn_chunk.rs` — Phase 1 pattern for the
  Phase 7 SLIDE torn-chunk corpus (mirror, don't share)
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — invariant guard;
  Phase 7's new `slide/` module must keep this test green
- `crates/bestialitty-core/Cargo.toml` — current dep set; D-01 means **no new
  Rust deps** are added in Phase 7

### Prior phase context (cross-phase consistency)

- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md` —
  D-15 (silent discard on malformed bytes), D-16 (paired `.bin`/`.trace` test
  fixture pattern, applicable to SLIDE), D-19 (Cargo workspace layout),
  D-20 (cross-target reuse — same crate backs wasm + native tests)

### External CRC references

- Greg Cook CRC catalogue (https://reveng.sourceforge.io/crc-catalogue/all.htm)
  — confirms CCITT-FALSE family member CRC-16/IBM-3740 = poly 0x1021,
  init 0xFFFF, no refin/refout, xorout 0x0000

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`vte = "=0.15"` pinning convention** (Cargo.toml) — pin SLIDE deps the same
  way; D-01 means no new deps, but `Cargo.toml` should record the rejected `crc`
  crate as an explicit non-decision (Cargo.toml comment).
- **Phase 1 torn-chunk test pattern** (`tests/torn_chunk.rs`) — direct template
  for `tests/slide_torn_chunk.rs`. Splits every multi-byte sequence at every
  internal offset and asserts identical end state.
- **Phase 1 D-15 malformed-byte policy** — silent discard + return to a safe
  state on unexpected bytes; debug-only `trace-malformed` Cargo feature for a
  bounded ring of `{offset, byte, state}` entries. SLIDE framer applies the
  same policy at the byte-stream level (e.g., garbage during SOF-search).
- **Existing `repr(C)` POD discipline** for anything that may eventually cross
  the wasm boundary (Phase 1 D-09). SLIDE state enum should be `#[repr(u32)]`
  per ARCHITECTURE.md §1 to be wrappable cleanly in Phase 8.
- **Phase 1 cross-target reuse** (D-20) — `bestialitty-core` is `cdylib` + `rlib`;
  Phase 7's `slide/` module must keep `cargo test` green natively without any
  wasm involvement, so reuse the same disciplines.

### Established Patterns

- **Pure-logic Rust modules, wasm-free** — `terminal.rs`, `grid.rs`, `key.rs`,
  `vt52.rs` all wasm-free; `lib.rs` is the only file with wasm-bindgen attrs.
  SLIDE `mod.rs`, `crc.rs`, `framer.rs`, `state.rs`, `tests.rs` continue this.
- **Per-module `#[cfg(test)]` blocks supplemented by `tests/` integration files**
  — Phase 1 used both. SLIDE follows: `slide/tests.rs` for unit tests, plus
  `tests/slide_*.rs` integration tests for torn-chunk and slide-rs cross-validation.
- **Zero-copy via stable pointers into wasm linear memory for hot paths** —
  Phase 1 D-17 (`grid_ptr`, `dirty_ptr`, etc.). Phase 8 will wrap Slide's
  outbound buffer with the same pattern (`outbound_ptr / _len / clear_outbound`);
  Phase 7 must shape `Slide` so the buffer is contiguous and stable.
- **Cold-path `Vec<u8>` returns for rare-output APIs** (Phase 1 D-14 for
  `feed()` host-bound reply). Same pattern available for SLIDE event
  data-payload accessors if needed.
- **No `std::time::Instant` anywhere in core** (`tests/core_02_no_browser_deps.rs`
  invariant + ARCHITECTURE.md anti-pattern 4). All timing in JS. SLIDE SM is
  purely event-driven; CancelPending, retry budgets, and drain windows are
  all JS-driven.

### Integration Points

Phase 7 delivers the Rust SLIDE state machine only. Integration appears in
later phases:

- **Phase 8 (Wasm Boundary, Dispatcher, Wakeup):** wraps `Slide` in
  `lib.rs:wasm_boundary` with `feed_byte` / `feed_chunk` / `outbound_ptr/_len/
  clear_outbound` / `state` / `progress_packed` / `cancel` / `force_idle` /
  `current_file_metadata_ptr/_len` / `take_received_file_chunk` exports
  (per ARCHITECTURE.md §1). Phase 7 must shape the `Slide` struct so this
  wrapping is mechanical — no API changes needed in Phase 8.
- **Phase 9 (Sender):** drives `Slide` via a JS file-source loop;
  `await writer.ready` discipline (PITFALLS §4); auto-typed `B:SLIDE R\r`
  pre-session; CP/M 8.3 filename truncation in JS before Slide sees the metadata.
- **Phase 10 (Receiver & Cancellation):** drives `Slide` from `dispatchInbound`;
  exercises the Phase 7 cancel API (D-06) end-to-end; per-file Chrome download.
- **Phase 11 (JS Bridge):** floating chip + Settings + session-log pause +
  paste-pump gate; consumes Phase 7's progress accessors via the Phase 8 wrapper.
- **Phase 12 (UX Polish, Docs, UAT):** real-hardware UAT with patched slide.asm;
  references ADR-003 (D-08) in `docs/SLIDE_Z80_REQUIREMENT.md`.

</code_context>

<specifics>
## Specific Ideas

- **PITFALLS §5 cancellation flow is the JS contract** — Phase 7 Rust SM must be
  fully event-driven so JS can drive timing (200 ms in-flight settle → CTRL_CAN
  → 500 ms echo wait → 100 ms drain → re-arm). Anything that puts time logic
  inside Rust violates the no-`std::time` invariant and the JS contract.
- **ADR-001 chose `vte` for the VT52 parser; SLIDE is its own framer** — different
  state machine semantics (binary frame envelopes vs ANSI escape-sequence DFA).
  Don't reach for `vte` for SLIDE.
- **Pin to the Greg Cook CRC catalogue reference vector** —
  `crc16_ccitt(b"123456789") == 0x29B1` is the canonical CCITT-FALSE pin; any
  other value indicates a wrong variant. Non-negotiable.
- **Byte-for-byte equality with slide-rs is the wire-correctness gate** — D-04
  fixtures are the verification surface. If they ever diverge, the bug is in
  Phase 7, not in slide-rs (slide-rs is ground truth for v0.2).
- **CRC scope: SEQ + LEN_H + LEN_L + PAYLOAD** — not SOF, not the CRC bytes
  themselves. PITFALLS §3 is explicit. Test this directly with a fixture where
  flipping SOF bits leaves CRC unchanged (would catch over-scope), and where
  flipping any of SEQ/LEN/PAYLOAD bits changes CRC (would catch under-scope).
- **CRC bytes on wire are big-endian** (CRC_H first). Verify in build_frame and
  parse_frame; an LE serialization will pass the catalogue vector but fail
  cross-validation against slide-rs.
- **Sliding window: WIN_SIZE = 4 frames × 1024 bytes per SLIDE v0.2** — not a
  Phase 7 decision; it's the upstream spec. Phase 7 implements; ADR-003 documents
  any v0.2.1 additions on top.

</specifics>

<deferred>
## Deferred Ideas

Explicitly out of scope for Phase 7; tracked here so they're not lost:

- **Wasm-bindgen `Slide` exports** — Phase 8 (per ARCHITECTURE.md §1).
- **JS dispatcher (`www/transport/slide.js`)** — Phase 8.
- **`ESC ^ S L I D E` wakeup detection across chunk boundaries** — Phase 8
  (single-byte carry flag in JS pre-parser sniff).
- **TX writer ownership handoff (`tx-sink.js:setWireOwner`)** — Phase 8.
- **File picker + drag-drop + auto-typed `B:SLIDE R`** — Phase 9.
- **CP/M 8.3 filename uppercase + truncation + character-set validation** —
  Phase 9 (JS layer; never reaches Rust core per ARCHITECTURE.md §5).
- **Sender-side `await writer.ready` discipline** — Phase 9 (PITFALLS §4).
- **Receiver-side per-file Chrome download (anchor-click + showDirectoryPicker
  fallback)** — Phase 10.
- **Memory-bounded receive (`chunks: Uint8Array[]` + single Blob)** — Phase 10
  (PITFALLS §12; mirrors Phase 6 session-log pattern).
- **Floating chip UI + Settings auto-send command + session-log pause +
  paste-pump gate + visibilitychange teardown + auto-type echo swallow + Z80
  no-respond fallback chip** — Phase 11.
- **Filename collision auto-rename UX, drag-drop pointer-select isolation,
  auto-send command safety validation, `docs/SLIDE_Z80_REQUIREMENT.md`,
  `docs/SLIDE-UAT.md`, real-hardware UAT** — Phase 12.
- **CTRL_CAN exact wire format** (raw byte vs wrapped frame) — Claude's
  discretion at planning time; resolves from slide-rs/protocol.rs and is captured
  in ADR-003 as part of the v0.2.1 amendment.
- **State machine event surface (packed u32 vs ring+drain)** — Claude's
  discretion at planning time; defaults to ARCHITECTURE.md §1 packed-u32.
- **Phase 7 SM scope (sender + receiver vs framer + receiver only)** — Claude's
  discretion at planning time; defaults to "both directions per SLIDE-04
  success criteria".
- **Z80 PR coordination** — Phase 12 (`docs/SLIDE_Z80_REQUIREMENT.md` references
  the upstream PR; not a Phase 7 deliverable).

</deferred>

---

*Phase: 07-slide-rust-core-framer-crc-state-machine*
*Context gathered: 2026-05-06*
