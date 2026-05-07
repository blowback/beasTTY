# Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup — Research

**Researched:** 2026-05-07
**Domain:** wasm-bindgen façade for the Phase 7 SLIDE state machine + a JS byte-routing dispatcher with a 7-byte wakeup matcher and TX writer ownership handoff
**Confidence:** HIGH (every claim grounded in code already in the repo + Phase 7 boundary-shape pin already covers the contract)

---

## Summary

Phase 8 is the integration gate for v1.1: it crosses the Phase 7 pure-Rust SLIDE state machine into the browser, threads inbound Web Serial chunks through a JS dispatcher that decides whether bytes go to the VT52 parser or the SLIDE state machine, detects the 7-byte `ESC ^ S L I D E` wakeup signature even when chunk boundaries split it at the worst possible place, and hands off the wire writer between the keyboard/paste path (Phase 4/5) and SLIDE without breaking either. Every piece lands on an existing seam — no architectural change.

The Rust side is mechanical. ARCHITECTURE.md §1 specified the surface a year of planning ago; Phase 7 Plan 04 already pinned the inner-API shape via fn-pointer coercion in `tests/slide_boundary_shape.rs`; Phase 8 just needs a sibling `Slide` `#[wasm_bindgen]` struct in `lib.rs:wasm_boundary` that one-line-forwards each method to `crate::slide::Slide`. Same pattern as `Terminal`, same zero-copy ptr/len/clear triple as `host_reply`. ADR-002 governs gating; ADR-003 governs cancel semantics.

The JS side is more interesting. The 7-byte wakeup matcher is a tiny state-machine over a 0..7 counter with replay-on-fail to preserve VT52 baseline behaviour for `ESC ^` (which is the legitimate VT52 "enter auto-copy mode" sequence the existing parser silently swallows). The TX handoff is a clean owner-state extension to the existing tx-sink writer-registration coupling Phase 5 D-21 already established. The dispatcher is a single-line edit at `serial.js:453` plus a new `transport/slide.js` module that mirrors the `paste-pump.js` / `scroll-state.js` module-scope-state-with-`wireXxx`-initializer idiom.

**Primary recommendation:** Two waves, mostly mechanical translations. Wave 0 (Rust) — extend `boundary_api_shape.rs` with the `Slide` wasm façade pin (or sibling-mirror it) AND build out the test corpus shells; Wave 1 (Rust + JS) — add the `Slide` `#[wasm_bindgen]` struct to `lib.rs:wasm_boundary`, ship `www/transport/slide.js` with the matcher + dispatcher + lifecycle, modify `tx-sink.js` for owner handoff, do the single-line edit at `serial.js:453`, wire it all in `main.js`. Test substrate: native `cargo test` boundary-shape pin + Playwright dispatcher harness on the existing `mock-serial.js`. Skip `wasm-bindgen-test` — the boundary-shape compile-time fn-pointer coercion already does the work.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Wakeup matcher (Phase 8 SC#3):**

- **D-01:** Match-index counter (0..7), module-scope state in `www/transport/slide.js`. A `wakeIdx` integer tracks progress through the 7-byte signature `ESC ^ S L I D E`. On each inbound byte during `mode === 'terminal'`: if byte matches `WAKEUP[wakeIdx]`, increment `wakeIdx` and **swallow** (do not forward to `term.feed`); on `wakeIdx === 7` switch `mode = 'recv'`, call `slide.enter_recv_mode()`, and forward any chunk residual via `slide.feed_chunk(remaining)`. State persists across Web Serial chunk boundaries via the module-scope variable. Rejects "7-byte sliding ring buffer" (allocates per byte; harder partial-match recovery) and "Rust-side stateful helper" (would expand Phase 7's locked Rust API surface beyond its boundary-shape pin). Matches the existing JS module-scope state idiom (`paste-pump.js`, `scroll-state.js`).

- **D-02:** Replay swallowed prefix to `term.feed` on partial-match failure. Hold the consumed bytes in a small backing buffer (max 6 bytes; allocated once at module init via `new Uint8Array(6)`). On any mismatch: flush the swallowed bytes to `term.feed` in original order, reset `wakeIdx = 0`, then **re-process the current failing byte from `wakeIdx === 0`** (so `ESC ^ ESC ^ S L I D E` still detects the second wakeup). Preserves baseline VT52 behaviour — a benign Z80 `ESC ^` still reaches the terminal parser exactly as it would today, where `vte` interprets the sequence and the existing D-15 silent-discard policy applies. Rejects "discard swallowed prefix" because it would make benign `ESC ^` (auto-copy mode toggle) effectively invisible to the terminal — a behavior change vs baseline.

- **D-03:** VT52 `ESC ^` lore. `ESC ^` is the VT52 "enter auto-copy mode" sequence (thermal printer hardcopy on the original DEC VT52 / MicroBeast peripheral); `ESC _` exits auto-copy mode. The MicroBeast has no thermal printer attached, so toggling auto-copy in the terminal parser is a visual no-op. The existing parser silently swallows both via D-15 (`vt52.rs:115-141` `_ => {}` arm). Phase 8's matcher must not regress this; D-02 is the mechanism.

**JS Dispatcher:**

- **D-04:** Pre-parser sniff in JS at `dispatchInbound`, NOT in Rust. The terminal parser already accumulates partial escape sequences across chunk boundaries; routing `ESC ^` through Rust first has no clean rewind path (ARCHITECTURE.md §2 + Anti-Pattern 2). All wakeup detection lives in JS.

- **D-05:** New module `www/transport/slide.js` exporting `dispatchInbound(value: Uint8Array)` that routes per `mode`:
  - `mode === 'terminal'`: drive the wakeup matcher (D-01 + D-02); on full match, switch to `'recv'` and forward any chunk tail via `slide.feed_chunk(tail)`.
  - `mode === 'recv'`: forward all bytes to `slide.feed_chunk(bytes)`; drain events via `slide.take_event_packed()`; drain outbound via `outbound_ptr/_len` + `clear_outbound`; on `slide.state() === Done` or `Error`, switch back to `mode = 'terminal'`, call `setWireOwner('terminal')`, and feed any chunk tail (residual bytes after `Done`) to `term.feed`.
  - `mode === 'send'`: not implemented in Phase 8 (Phase 9 scope).

- **D-06:** Single-line edit at `serial.js:453`: `term.feed(value)` → `dispatchInbound(value)`. Only hot-path change in any existing file. `runReadLoop` continues to call `sampleBellFn() / drainHostReplyFn / requestFrameFn / sessionLogRef.append` after `dispatchInbound` — the dispatcher shape preserves the post-feed invariant.

- **D-07:** In-recv mid-stream wakeup detection is Phase 10's concern, not Phase 8's. During `mode === 'recv'`, all bytes (including any spurious `ESC ^ S L I D E`) are forwarded raw to `slide.feed_chunk`. Phase 10 will add the idempotent re-entry detector + "Z80 reset detected" warning chip. Phase 8 must not preemptively implement this — keep `dispatchInbound`'s `'recv'` branch as a straight pass-through.

**TX writer ownership handoff (Phase 8 SC#4):**

- **D-08:** `tx-sink.js` gains `setWireOwner(o: 'terminal'|'slide')` module state + `writeSlideFrame(bytes: Uint8Array)` export. `pushTxBytes` early-returns when `owner === 'slide'` (silently drops keystroke writes during an active SLIDE session — chip messaging is Phase 11's concern). `writeSlideFrame` writes directly via the `registeredWriter` reference, bypassing the keystroke ring entirely.

- **D-09:** `slide.js` calls `setWireOwner('slide')` immediately after successful wakeup match (in the same tick that flips `mode = 'recv'`) and `setWireOwner('terminal')` when the SLIDE session reaches `Done` or `Error`. Synchronous handoff — no race window where pushTxBytes could land mid-session. Paste-pump cancellation (`pastePump.cancelPaste()`) on session start is **deferred to Phase 11**.

**Wasm boundary shape (Phase 8 SC#1):**

- **D-10:** `Slide` `#[wasm_bindgen]` struct in `lib.rs:wasm_boundary`, sibling to `Terminal`. Thin façade — every method one-line forwards to `crate::slide::Slide`. Mirrors the `Terminal` façade pattern at `lib.rs:54-174`. Phase 7's `tests/slide_boundary_shape.rs` already pinned the inner Rust API via fn-pointer coercion; Phase 8's `Slide` façade exposes `new`, `enter_recv_mode`, `feed_byte`, `feed_chunk`, `take_event_packed`, `state`, `outbound_ptr`, `outbound_len`, `clear_outbound`, `cancel`, `force_idle`. The full event constants (`EVT_NONE` / `EVT_RDY` / `EVT_ACK` / `EVT_NAK` / `EVT_FIN` / `EVT_CAN` / `EVT_DATA_FRAME` / `EVT_CRC_ERROR`) are exported as `#[wasm_bindgen]` associated constants OR as JS-side mirrored constants — planner picks the cleaner path.

- **D-11:** Zero-copy egress for `outbound_buf` mirrors the existing `host_reply_ptr/_len/clear_host_reply` triple at `lib.rs:83-95`. JS reads `new Uint8Array(wasm.memory.buffer, slide.outbound_ptr(), slide.outbound_len())`, slices to a JS-owned buffer (because `await writer.write` may straddle wasm memory growth), then calls `slide.clear_outbound()` to ack.

### Claude's Discretion

The following intentionally remain unlocked at the planning/research stage:

- **Slide wasm-bindgen export surface** — Phase 8 minimal vs Phase 9 anticipation. Phase 8 only exercises the recv-side path; Phase 9 will add `enter_send_mode(metadata)`. Default: (a) wrap exactly what Phase 8 needs and let Phase 9 amend.
- **Slide instance lifecycle.** Per-session `new Slide()` (current Phase 7 API; old instance dropped after `Done`) vs adding a `Slide::reset()` method to the Phase 7 module to reuse a singleton. Default: per-session `new` (no Rust API expansion).
- **Test strategy mix for SC#1–#5.** Native `cargo test` (extend `tests/boundary_api_shape.rs` for `Slide` exports OR new `tests/slide_wasm_boundary_shape.rs` mirroring the Phase 7 sibling file), `wasm-bindgen-test` for FFI shape, Playwright with the Phase 5 `navigator.serial` mock for full dispatcher coverage. Default: cargo boundary-shape pin + Playwright dispatcher harness; skip `wasm-bindgen-test`.
- **Boot wiring / dispatcher API shape.** Explicit DI (`wireSlideDispatcher({ term, getWriter, txSink })` at boot) vs module-scope state with imports. Default: module-scope with a `wire()` initializer.
- **`EVT_*` constant exposure.** `#[wasm_bindgen]` associated constants on the `Slide` struct vs JS-side mirrored `const EVT_RDY = 1 << 16;` in `transport/slide.js`. Planner picks based on which keeps drift risk lowest.
- **Wakeup-matcher backing-buffer location.** Module-scope `Uint8Array(6)` allocated once vs per-replay temporary slice. Planner picks readable layout.
- **Test corpus split-points for the 7-byte signature.** All 7 internal splits (mirror Phase 1 torn-chunk pattern) plus benign partial-match cases: `ESC ^ A`, `ESC ^ S L X`, `ESC ESC ^ S L I D E`.

### Deferred Ideas (OUT OF SCOPE)

- Sender-side `enter_send_mode(metadata)` wasm-bindgen wrapping — Phase 9.
- `www/input/file-source.js` (file picker + drag-drop) — Phase 9.
- Auto-typed `B:SLIDE R\r` command + 500 ms swallow-echo filter — Phase 9 (PITFALLS §11) + Phase 11.
- CP/M 8.3 filename uppercase / truncation / character-set validation in JS — Phase 9.
- Receiver-side per-file Chrome download — Phase 10.
- `chunks: Uint8Array[]` + single `new Blob(chunks)` 1 MB receive memory pattern — Phase 10.
- `Cancel` chip button + Esc-cancel disambiguation + post-cancel summary chip — Phase 10 + Phase 11.
- Mid-session re-entrant `ESC ^ S L I D E` detection + "Z80 reset detected" warning chip — Phase 10 (SLIDE-34).
- Floating SLIDE chip — Phase 11.
- Settings auto-send command pref + session-log pause + paste-pump gate + visibilitychange teardown + auto-type echo swallow + Z80 fallback chip — Phase 11.
- `slidePumpOnPortLost` symmetric to `pastePumpOnPortLost` — Phase 11. *Note: Phase 8 may export the symbol as a stub so Phase 11 wiring is additive.*
- Filename collision auto-rename UX, drag-drop pointer-select isolation regression, auto-send command safety validation — Phase 12.
- `docs/SLIDE_Z80_REQUIREMENT.md` + README "File transfer" section + `docs/SLIDE-UAT.md` real-hardware UAT — Phase 12.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SLIDE-05 | JS dispatcher (`transport/slide.js:dispatchInbound`) routes Web Serial chunks to terminal parser OR SLIDE state machine based on session mode; detects 7-byte wakeup `ESC ^ S L I D E` across chunk boundaries via single-byte carry flag | Architecture Patterns §"Pattern 1: Dispatch + Match-Index Wakeup"; matcher state-machine table; torn-chunk corpus design under Validation Architecture |
| SLIDE-06 | TX writer ownership handoff — `tx-sink.js:setWireOwner('slide')` blocks `pushTxBytes` keystroke writes during active session; SLIDE writes via separate `writeSlideFrame` path that bypasses the keystroke ring | Architecture Patterns §"Pattern 2: TX Owner Handoff"; integration points table for `tx-sink.js`; existing Phase 5 D-21 writer-registration coupling at `tx-sink.js:78-81` is the seam being extended |
| SLIDE-17 | BestialiTTY detects 7-byte wakeup `ESC ^ S L I D E` emitted by patched slide.com and enters receive mode | The wakeup matcher (D-01/D-02) IS the SLIDE-17 implementation; once `wakeIdx === 7` the dispatcher calls `slide.enter_recv_mode()` and switches `mode = 'recv'`; subsequent bytes route to the SLIDE SM |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

These are CI-enforced — plans must not contradict them:

- **Rust core owns parser, terminal state, key encoding** — pure logic, zero `web-sys` / `js-sys::Serial*` / DOM / I/O. Phase 8 honours this: the `Slide` façade is `#[wasm_bindgen]`-attributed but lives only in `lib.rs:wasm_boundary`, gated by `#[cfg(target_arch = "wasm32")]` (ADR-002).
- **JavaScript shell owns Web Serial I/O, canvas rendering, event loop, browser state.** Phase 8's wakeup matcher and dispatcher live in `www/transport/slide.js` — JS-only, no Rust state machine for byte-routing.
- **Web Serial is driven from JS, not Rust.** Phase 8 reads/writes via the existing `registeredWriter` reference in `tx-sink.js`; no Rust Web Serial bindings introduced.
- **Chromium-only.** Phase 5's polite-fail gate (already in `serial.js`) covers this; Phase 8 adds nothing on this axis.
- **`wasm-bindgen` attributes only in `lib.rs`** (ADR-002 + `tests/core_02_no_browser_deps.rs` invariant). Phase 8's `Slide` façade fits inside the existing `mod wasm_boundary` block. The Phase 7 `slide/` module stays wasm-free; its wasm-free invariant is CI-enforced.
- **No `std::time` in Rust core** (Plan 07-05 hardened `tests/core_02_no_browser_deps.rs` `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` to gate this). Phase 8's façade adds no time logic.
- **Native `cargo test` green for the whole crate** (D-20). Phase 8's `Slide` `#[wasm_bindgen]` struct is gated by `#[cfg(target_arch = "wasm32")]` so native `cargo test` doesn't see it; the inner `crate::slide::Slide` does the work natively (Phase 7's 232 tests already cover it).
- **VT52 pragmatic subset** (not strict DEC VT52). Relevant because `ESC ^` is a real VT52 escape sequence the existing parser silently swallows (D-15); D-02's replay-on-fail preserves this baseline.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 7-byte wakeup signature detection across chunk boundaries | Browser / Client (JS) | — | Pre-parser sniff in JS at `dispatchInbound`; ARCHITECTURE.md Anti-Pattern 2 — Rust parser has no clean rewind for SLIDE-vs-VT52 disambiguation. State persists across `reader.read()` resolutions in JS module-scope. |
| SLIDE state machine (CRC, framer, sliding window, sequence tracking, NAK budget, cancel/force_idle) | Rust core (wasm) | — | Phase 7 already shipped this — pure logic, native-`cargo test`-verified. Phase 8 only crosses it. |
| Wasm boundary façade (`#[wasm_bindgen]` `Slide` struct + zero-copy ptr/len/clear triple + state accessor) | Rust core (wasm) — `lib.rs` only | — | ADR-002 + Phase 2 D-06: wasm-bindgen attributes confined to `lib.rs:wasm_boundary`. One-line forwards to `crate::slide::Slide`. |
| Inbound byte routing (terminal parser vs SLIDE SM) | Browser / Client (JS) | — | Mode dispatch lives at the entry point right after `reader.read()` resolves. Single-line edit at `serial.js:453` keeps the read loop dumb. |
| TX writer ownership (keystroke vs SLIDE frames) | Browser / Client (JS) — `tx-sink.js` | — | Phase 5 D-21 already established `tx-sink.js` as the single owner of `registeredWriter`. Owner-state extension is a 15-line addition to that file. |
| Outbound SLIDE frame transmission | Browser / Client (JS) — `tx-sink.js:writeSlideFrame` | Rust core (wasm) — `outbound_buf` accessors | JS reads zero-copy view over `slide.outbound_ptr()..outbound_len()`, slices to JS-owned buffer, writes via `registeredWriter.write(bytes)`, calls `slide.clear_outbound()`. Crossing the boundary lives in `transport/slide.js`. |
| ESC^ baseline preservation (VT52 auto-copy mode no-op) | Rust core (wasm) — `vt52.rs` D-15 silent discard | Browser / Client (JS) — D-02 replay-on-fail | The existing `vte::Parser` already discards ESC^ via the `_ => {}` arm at `vt52.rs:134-140`. JS-side replay-on-fail of the swallowed prefix preserves this behaviour for partial-match cases. |
| Boot wiring (constructing `Slide`, passing refs to dispatcher + tx-sink) | Browser / Client (JS) — `main.js` | — | Same idiom as `wireKeyboard / wireSerial / wireScrollState`. |

## Standard Stack

### Core (already in repo, no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wasm-bindgen` | `=0.2.118` | Rust↔JS interop attributes; pinned in `Cargo.toml` `[target.'cfg(target_arch = "wasm32")'.dependencies]` per ADR-002 [VERIFIED: read Cargo.toml at lines 32-34] | Phase 2 already adopted; no migration. The `=` version pin is intentional — wasm-pack regenerates `pkg/` glue on every build, so an unpinned wasm-bindgen could ship a glue/binding mismatch silently. |
| `wasm-pack` | `0.12.1` (CLI) | Builds the cdylib into `www/pkg/bestialitty_core.{js,wasm}` via `--target web` [VERIFIED: `wasm-pack --version` returned 0.12.1] | Phase 2 build pipeline; `scripts/build.sh` driver unchanged. |
| `vte` | `=0.15` | VT52 parser DFA. Phase 8 doesn't add a vte call but D-02 replay-on-fail must not re-feed bytes that vte has already seen — the dispatcher only ever feeds vte the bytes vte hasn't yet processed. [VERIFIED: read Cargo.toml at line 25] | ADR-001. |
| `@playwright/test` | (bundled via `npx playwright install`) | Browser-driven dispatcher / wakeup / handoff verification; reuses `www/tests/transport/mock-serial.js` from Phase 5 [VERIFIED: read `www/tests/transport/mock-serial.js`] | Already the Phase 5 / Phase 6 test substrate; adding `www/tests/transport/slide-dispatch.spec.js` is additive. |

### Supporting (already in repo)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `crate::slide::Slide` (Phase 7 inner SM) | n/a | The receiver-side state machine the Phase 8 façade wraps; pinned by `tests/slide_boundary_shape.rs` [VERIFIED: read state.rs] | All recv-mode logic. Phase 8 NEVER calls `crate::slide::Slide` directly from JS — only via the wasm façade. |
| `tests/boundary_api_shape.rs` (Phase 2 boundary pin) | n/a | Compile-time fn-pointer coercion contract for the wasm façade surface [VERIFIED: read boundary_api_shape.rs] | Phase 8 either extends this file (preferred for grep-locality) OR creates a sibling `tests/slide_wasm_boundary_shape.rs`. Either path catches drift at compile time. |
| `www/tests/transport/mock-serial.js` (Phase 5 nav.serial mock) | n/a | `__mockReaderPush(bytes)` test hook delivers byte chunks to the read loop; `__simulateUnplug` for port-lost paths [VERIFIED: read mock-serial.js] | Phase 8 dispatcher tests reuse verbatim — no new mock infrastructure needed. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Module-scope state in `slide.js` (D-01 default per Claude's Discretion) | Explicit DI factory (`wireSlideDispatcher({ term, getWriter, txSink })`) | DI factory is more testable in isolation — but the project codebase consistently uses module-scope state with a `wireXxx` initializer (paste-pump.js, scroll-state.js, selection.js, session-log.js). Going against the grain costs more than the test-isolation benefit; the Playwright harness can drive the full module just as easily as a DI'd factory. |
| `wasm-bindgen` associated constants for `EVT_*` (`#[wasm_bindgen]` on associated `pub const`s in the Slide impl) | JS-side mirrored constants (`const EVT_RDY = 1 << 16;` in `transport/slide.js`) | wasm-bindgen does NOT have a clean associated-const export — the typical pattern is to mirror constants on the JS side and rely on a Rust-side test that asserts the values match. [CITED: rustwasm.github.io wasm-bindgen docs — only `#[wasm_bindgen(constructor)]`, `getter`, `setter` on impls; no `(const)` attribute]. The Phase 7 `tests/slide_boundary_shape.rs` already pins the EVT_* values; mirroring in JS with a comment pointing to that test is the lowest-drift-risk path. **Recommendation: JS-side mirrored constants.** |
| Per-session `new Slide()` (default per Claude's Discretion) | `Slide::reset()` method singleton | Per-session `new Slide()` is what Phase 7's API supports natively (no API expansion required). Allocation churn is irrelevant — a Slide instance is ~1 KB and sessions happen once per file batch, not per byte. Skip the singleton optimization. |
| `wasm-bindgen-test` for FFI shape verification | Native `cargo test` boundary-shape pin via fn-pointer coercion | wasm-bindgen-test would run the wasm bundle and call methods — but the Phase 7 `tests/slide_boundary_shape.rs` already catches signature drift at compile time via fn-pointer coercion against the inner crate's public API. Phase 8's wasm façade is a one-line forward; if the inner API drifts, Phase 7's test breaks; if the façade drifts, the wasm-pack build's TypeScript .d.ts emission and the JS-side import in `transport/slide.js` will fail at the next build. wasm-bindgen-test adds complexity without catching a class of bug the existing pattern misses. Skip. |
| Single-step single byte at a time for wakeup detection | Memchr-style scan for `ESC ^` followed by partial-match logic | Sliding ring buffer / memchr scan is harder to reason about for the partial-match recovery (D-02's "re-process current failing byte from idx=0"). Match-index counter (D-01) is 8 lines of JS, byte-perfect, easy to test exhaustively. **Locked by D-01.** |

**Installation:** No new dependencies. `npm install` and `wasm-pack build` (via `scripts/build.sh`) are unchanged.

**Version verification:** [VERIFIED 2026-05-07]
- `cargo --version` → `cargo 1.94.1 (29ea6fb6a 2026-03-24)`
- `wasm-pack --version` → `wasm-pack 0.12.1`
- `wasm-bindgen` pin at `=0.2.118` per `crates/bestialitty-core/Cargo.toml`
- `vte` pin at `=0.15`

## Architecture Patterns

### System Architecture Diagram

```
                    Web Serial (CP2102N) — physical wire
                             │
                             ▼
            ┌──────────────────────────────────┐
            │ navigator.serial reader.read()    │
            │ Uint8Array chunks (1..4096 bytes) │
            └──────────────┬───────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────────┐
        │ www/transport/serial.js:runReadLoop          │
        │   serial.js:453 — dispatchInbound(value)     │  ◀── single-line edit (D-06)
        │   serial.js:454 — sampleBellFn()             │       Post-feed invariant
        │   serial.js:455 — drainHostReplyFn('serial') │       must carry through
        │   serial.js:456 — requestFrameFn()           │       dispatcher unchanged
        │   serial.js:462 — sessionLogRef.append(value)│
        └──────────────┬───────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────────────────────┐
        │ www/transport/slide.js                            │
        │ ┌─────────────────────────────────────────────┐  │
        │ │ dispatchInbound(value: Uint8Array)          │  │
        │ │  ├─ if (mode === 'terminal')                │  │
        │ │  │     for each byte b in value:            │  │
        │ │  │       if b === WAKEUP[wakeIdx]:          │  │
        │ │  │         scratch[wakeIdx++] = b           │  │
        │ │  │         if wakeIdx === 7:                │  │
        │ │  │           mode = 'recv'                  │  │
        │ │  │           slide.enter_recv_mode()        │  │
        │ │  │           setWireOwner('slide')          │  │
        │ │  │           wakeIdx = 0                    │  │
        │ │  │           continue with chunk tail       │  │──┐
        │ │  │       else (mismatch):                   │  │  │
        │ │  │         flush scratch[0..wakeIdx]        │  │  │
        │ │  │           via term.feed                  │  │  │
        │ │  │         wakeIdx = 0                      │  │  │
        │ │  │         re-process b from idx=0          │  │  │
        │ │  │     [collect remaining bytes; term.feed] │  │  │
        │ │  │                                          │  │  │
        │ │  ├─ if (mode === 'recv')                    │  │  │
        │ │  │     count = slide.feed_chunk(value) ◀────┼──┼──┘
        │ │  │     drain events via take_event_packed   │  │
        │ │  │     if outbound_len > 0:                 │  │
        │ │  │       view = new Uint8Array(             │  │
        │ │  │         memory.buffer, outbound_ptr(),   │  │
        │ │  │         outbound_len())                  │  │
        │ │  │       writeSlideFrame(view.slice())      │  │
        │ │  │       slide.clear_outbound()             │  │
        │ │  │     if state === Done || Error:          │  │
        │ │  │       mode = 'terminal'                  │  │
        │ │  │       setWireOwner('terminal')           │  │
        │ │  │       feed any chunk tail to term.feed   │  │
        │ └─────────────────────────────────────────────┘  │
        └────────────┬────────────────────────────┬────────┘
                     │                            │
        terminal     │             slide          │
        path         ▼             path           ▼
        ┌─────────────────────┐    ┌──────────────────────────┐
        │ Terminal.feed       │    │ Slide.feed_chunk         │
        │ (lib.rs façade →    │    │ (lib.rs façade —         │
        │ vt52::Parser)       │    │ NEW IN PHASE 8)          │
        │                     │    │                          │
        │ ESC^ → silent       │    │ wraps                    │
        │ discard via D-15    │    │ crate::slide::Slide      │
        │ (vt52.rs:134-140)   │    │ (Phase 7)                │
        └─────────────────────┘    └─────────┬────────────────┘
                                             │
                                             ▼
                                   ┌─────────────────────────┐
                                   │ outbound_buf (Vec<u8>,  │
                                   │ pre-reserved 16 bytes)  │
                                   │ → outbound_ptr / _len / │
                                   │   clear_outbound triple │
                                   │   (zero-copy egress)    │
                                   └─────────────────────────┘

                  TX path (write) — Phase 8 D-08 / D-09 changes
                                             │
                                             ▼
        ┌──────────────────────────────────────────────────────┐
        │ www/input/tx-sink.js                                 │
        │   let owner = 'terminal'  (NEW)                      │
        │   pushTxBytes(bytes):                                │
        │     if (owner === 'slide') return  (NEW silent drop) │
        │     else: ring + registeredWriter.write(bytes)       │
        │   setWireOwner(o)        (NEW)                       │
        │   writeSlideFrame(bytes) (NEW: registeredWriter.write│
        │                          bypassing the ring)         │
        │   registerWriter(writer) — Phase 5 D-21 (UNCHANGED)  │
        └──────────────────────┬───────────────────────────────┘
                               │
                               ▼
                       Web Serial writer.write
```

### Component Responsibilities Table

| File | Type | Responsibility | Lines (est) |
|------|------|----------------|-------------|
| `crates/bestialitty-core/src/lib.rs` | MODIFIED Rust | Add `Slide` `#[wasm_bindgen]` struct + impl block in the existing `wasm_boundary` module, sibling to `Terminal`. Each method is a one-line forward to `crate::slide::Slide`. | +60 |
| `crates/bestialitty-core/tests/boundary_api_shape.rs` (or sibling `slide_wasm_boundary_shape.rs`) | MODIFIED or NEW Rust | Compile-time fn-pointer coercion pins for the wasm façade surface. Sibling-mirror is the cleaner choice — keeps the file scoped to one struct's contract, mirrors Phase 7's split. | +60 (new) or +60 (extension) |
| `www/transport/slide.js` | NEW JS | Module-scope state: `mode`, `wakeIdx`, `scratch: Uint8Array(6)`, `slide: Slide \| null`, `termRef`, `txSinkRef`. Exports `dispatchInbound(value)`, `wireSlideDispatcher({ term, txSink, slideCtor })`, `slidePumpOnPortLost()` (stub for Phase 11), `__resetForTests()` (test introspection). | ~180 |
| `www/transport/serial.js:453` | MODIFIED JS | Single-line edit — `term.feed(value)` → `dispatchInbound(value)`. | +0 (1-line replacement) |
| `www/input/tx-sink.js` | MODIFIED JS | Add `owner` module-scope state + `setWireOwner(o)` + `getWireOwner()` + `writeSlideFrame(bytes)`. Modify `pushTxBytes` to early-return when `owner === 'slide'`. | +18 |
| `www/main.js` | MODIFIED JS | Import `Slide` from `./pkg/bestialitty_core.js`, import `wireSlideDispatcher` from `./transport/slide.js`, call `wireSlideDispatcher({ term, txSink: { setWireOwner, writeSlideFrame }, slideCtor: Slide })` AFTER `wireSerial` so the dispatcher sees the running serial reader, BEFORE the read loop fires its first chunk. | +12 |
| `www/tests/transport/slide-dispatch.spec.js` | NEW Playwright spec | SC#1..#5 dispatcher coverage — mock peer drives `__mockReaderPush(bytes)` with all torn-chunk wakeup variants + benign partial-matches + recv-mode handoff + tx-owner gating. | ~250 |
| `scripts/build.sh` | UNCHANGED | `wasm-pack build --target web` automatically picks up the new `Slide` exports — no script change needed. | 0 |

### Pattern 1: Match-Index Wakeup Matcher with Replay-on-Fail

**What:** Single-byte-at-a-time scan against the 7-byte `ESC ^ S L I D E` signature. State persists across `reader.read()` resolutions via module-scope `wakeIdx` integer + a 6-byte scratch buffer.

**When to use:** D-01 + D-02 — the locked design for SLIDE-05 / SLIDE-17.

**State machine:**
```
state: { wakeIdx: 0..7, scratch: Uint8Array(6) }

per inbound byte b in mode === 'terminal':
  if b === WAKEUP[wakeIdx]:
    if wakeIdx < 6: scratch[wakeIdx] = b           # capture for replay
    wakeIdx++
    if wakeIdx === 7:
      → enter recv mode (D-09 setWireOwner('slide'); slide.enter_recv_mode())
      → wakeIdx = 0
      → continue dispatching remaining chunk bytes via slide.feed_chunk
      return
    # else: byte swallowed; do NOT forward to term.feed
  else:
    # mismatch — replay swallowed prefix
    if wakeIdx > 0:
      term.feed(scratch.subarray(0, wakeIdx))      # original-order replay
      wakeIdx = 0
      # Re-process current b from idx=0 (D-02 critical clause):
      if b === WAKEUP[0]:                           # b is ESC; second-wakeup case
        scratch[0] = b
        wakeIdx = 1
        # byte still swallowed — captured for next iteration
      else:
        # accumulate b into the term.feed pending-bytes buffer
        pending.push(b)
    else:
      # wakeIdx was already 0 — just forward
      pending.push(b)

at end of value chunk: if pending.length > 0: term.feed(pending)
```

**Example walks:**
- **Full match `ESC ^ S L I D E`:** all 7 bytes match in sequence; on byte 7 the dispatcher swaps mode and the next byte (or remaining chunk tail) goes to `slide.feed_chunk`. Common case.
- **Partial match fail `ESC ^ S L O P`:** bytes 0..3 match (`wakeIdx` reaches 4, scratch holds `[ESC, ^, S, L]`); byte 4 is `O`, mismatch. Replay `[ESC, ^, S, L]` to `term.feed`, then re-process `O` from `wakeIdx === 0`: `O` doesn't match `ESC`, so `O` goes into the pending buffer. Byte 5 (`P`) also pending. End of chunk: `term.feed([ESC, ^, S, L, O, P])` — byte-identical to a SLIDE-free build.
- **Mid-prefix retry `ESC ^ ESC ^ S L I D E`:** bytes 0..1 match (`wakeIdx === 2`, scratch holds `[ESC, ^]`); byte 2 is `ESC`, mismatch (expected `S`). Replay `[ESC, ^]` to `term.feed` (correct — that ESC^ was a benign auto-copy toggle), reset `wakeIdx = 0`, re-process current byte `ESC` from idx=0 → matches `WAKEUP[0]`, scratch[0] = ESC, wakeIdx = 1. Bytes 3..7 (`^ S L I D E`) match in sequence. Wakeup detected on byte 8. **D-02's "re-process current failing byte from idx=0" clause is load-bearing here.**

**Source:** D-01 + D-02 in CONTEXT.md; mirror of paste-pump.js / scroll-state.js module-scope-state idiom verified at [VERIFIED: read tx-sink.js — module-scope ring + writeIdx + wrapped flag pattern].

### Pattern 2: TX Owner Handoff

**What:** Module-scope `owner: 'terminal' | 'slide'` state in `tx-sink.js`. `pushTxBytes` early-returns when `owner === 'slide'`. New `writeSlideFrame(bytes)` export writes via the existing `registeredWriter` reference (registered by Phase 5 D-21 path) bypassing the keystroke ring.

**When to use:** D-08 + D-09 — the locked design for SLIDE-06.

**Reference shape** (tx-sink.js modification):

```js
// Phase 5 D-21 — already in tx-sink.js:
let registeredWriter = null;
export function registerWriter(writer) { registeredWriter = writer; }
export function unregisterWriter()     { registeredWriter = null; }

// Phase 8 D-08 — NEW:
let owner = 'terminal';
export function setWireOwner(o) {
    if (o !== 'terminal' && o !== 'slide') {
        throw new Error(`[tx-sink] invalid owner: ${o}`);
    }
    owner = o;
}
export function getWireOwner() { return owner; }

// Phase 8 D-08 — modify pushTxBytes (FIRST thing in body, before ring write):
export function pushTxBytes(bytes) {
    if (owner === 'slide') return;     // silent drop during SLIDE session
    // ... existing ring + writer.write path unchanged
}

// Phase 8 D-08 — NEW:
export function writeSlideFrame(bytes) {
    if (!registeredWriter) {
        console.error('[tx-sink] writeSlideFrame: no writer registered');
        return;
    }
    registeredWriter.write(bytes).catch((err) => {
        console.error('[tx-sink] writeSlideFrame failed:', err);
    });
}
```

**Source:** D-08 + D-09 + ARCHITECTURE.md §3 + Phase 5 D-21 [VERIFIED: read tx-sink.js:78-81].

### Pattern 3: Wasm Façade Mirror (Slide Sibling to Terminal)

**What:** Add `Slide` `#[wasm_bindgen]` struct to `lib.rs:wasm_boundary` next to `Terminal`. Each method is a one-line forward to `crate::slide::Slide`. The `inner: crate::slide::Slide` name collision (the outer type is `Slide`, the inner is also `Slide`) is resolved via `use crate::slide::Slide as CoreSlide;` mirroring the existing `use crate::terminal::Terminal as CoreTerminal;` at `lib.rs:39`.

**When to use:** D-10 — locked.

**Example** (Source: locked by D-10; mirror of `lib.rs:54-174` Terminal façade):

```rust
// lib.rs additions inside the existing #[cfg(target_arch = "wasm32")] mod wasm_boundary { ... } block.

use crate::slide::Slide as CoreSlide;
// (already have: use crate::terminal::Terminal as CoreTerminal;)

#[wasm_bindgen]
pub struct Slide {
    inner: CoreSlide,
}

#[wasm_bindgen]
impl Slide {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Slide {
        Slide { inner: CoreSlide::new() }
    }

    pub fn enter_recv_mode(&mut self) {
        self.inner.enter_recv_mode();
    }

    pub fn feed_byte(&mut self, b: u8) -> u32 {
        self.inner.feed_byte(b)
    }

    pub fn feed_chunk(&mut self, bytes: &[u8]) -> u32 {
        self.inner.feed_chunk(bytes)
    }

    pub fn take_event_packed(&mut self) -> u32 {
        self.inner.take_event_packed()
    }

    pub fn state(&self) -> u32 {
        self.inner.state()
    }

    pub fn outbound_ptr(&self) -> *const u8 {
        self.inner.outbound_ptr()
    }

    pub fn outbound_len(&self) -> usize {
        self.inner.outbound_len()
    }

    pub fn clear_outbound(&mut self) {
        self.inner.clear_outbound();
    }

    pub fn cancel(&mut self) {
        self.inner.cancel();
    }

    pub fn force_idle(&mut self) {
        self.inner.force_idle();
    }
}
```

**Source:** D-10 + Phase 7 `tests/slide_boundary_shape.rs` pinned the inner-API contract.

### Pattern 4: Zero-Copy Outbound Drain (Mirror of host_reply Triple)

**What:** Same `ptr/len/clear` triple Phase 2 already established for `host_reply`. JS reads outbound bytes via a `Uint8Array` view over wasm linear memory, slices to a JS-owned buffer (so `await writer.write` doesn't dangle through wasm memory growth), then calls `clear_outbound` to ack.

**When to use:** D-11 — locked.

**Example** (the JS side in `transport/slide.js`):

```js
// Source: D-11 + ARCHITECTURE.md §1 + lib.rs:83-95 host_reply mirror.
function drainSlideOutbound() {
    const len = slide.outbound_len();
    if (len === 0) return;
    // Re-derive view if memory grew; mirror of main.js:274-279 reDeriveHostReplyView.
    if (wasm.memory.buffer !== outboundBuffer) {
        outboundBuffer = wasm.memory.buffer;
        outboundView   = new Uint8Array(outboundBuffer, slide.outbound_ptr(), 16);
    }
    // Slice to JS-owned buffer — required because await writer.write may straddle
    // a wasm memory grow event between now and the actual byte-out.
    const owned = new Uint8Array(outboundView.subarray(0, len));
    txSink.writeSlideFrame(owned);
    slide.clear_outbound();
}
```

**Source:** D-11 + main.js:274-289 host_reply pattern [VERIFIED: read main.js].

### Anti-Patterns to Avoid

- **Routing wakeup detection through Rust** — ARCHITECTURE.md Anti-Pattern 2. The vte parser already accumulates partial escape sequences across chunk boundaries; once vte has seen `ESC`, there's no clean rewind to "actually that was SLIDE." Phase 8 detects in JS BEFORE bytes hit `term.feed`. (Locked by D-04.)
- **SLIDE writes through `pushTxBytes`** — ARCHITECTURE.md Anti-Pattern 5. The Phase 4 D-15 TX ring is for keystroke diagnostics; multi-KB binary frames don't belong there. `writeSlideFrame` writes directly via `registeredWriter`. (Locked by D-08.)
- **Putting SLIDE state in the `Terminal` struct** — ARCHITECTURE.md Anti-Pattern 1. Already prevented by Phase 7's separate `slide/` module + Phase 8's separate `Slide` façade.
- **Time logic in Rust SM** — ARCHITECTURE.md Anti-Pattern 4 + ADR-003. All cancel timing windows (200/500/100/2000 ms) live in JS; Phase 8's façade exposes `cancel()` + `force_idle()` and JS schedules via `setTimeout`. CI-enforced by `tests/core_02_no_browser_deps.rs` `FORBIDDEN_TOKENS` `("std::time", &[])` after Plan 07-05.
- **Discarding the swallowed wakeup prefix on partial-match failure** — would make benign `ESC ^` invisible to the terminal parser (regression vs baseline since the existing parser silently DOES handle it via `_ => {}` at vt52.rs:134-140 — but a silent handle is different from "the bytes never arrived"). D-02's replay path preserves baseline.
- **Mid-session re-entrant wakeup detection** — Phase 10 scope. Phase 8's `'recv'` branch is a straight pass-through. (Locked by D-07.)
- **Adding `wasm-bindgen-test` for FFI shape verification** — the Phase 7 boundary-shape pin via fn-pointer coercion catches signature drift at compile time. Adding a wasm-bindgen-test layer adds toolchain complexity without catching a class of bug the existing pattern misses. (Discretion — recommendation: skip.)
- **Per-byte FFI through `slide.feed_byte` in the recv hot path** — `slide.feed_chunk` exists for this exact reason (ARCHITECTURE.md §1, "feed_chunk is the hot path"). JS dispatches one boundary call per Web Serial chunk, not one per byte.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wasm linear memory access | A new abstraction over `wasm.memory.buffer` views | Reuse the `host_reply_ptr/_len/clear_host_reply` triple shape — mirror it as `outbound_ptr/_len/clear_outbound` | Phase 2 already proved this pattern at scale; main.js's `reDeriveHostReplyView` covers the memory-growth re-derivation edge case [VERIFIED: read main.js:274-289]. |
| Web Serial mock for tests | New mock infrastructure | `www/tests/transport/mock-serial.js` with `__mockReaderPush(bytes)` | Phase 5 already shipped this; tests/transport/readloop.spec.js shows the pattern. |
| Module-scope state vs DI factory wiring | DI framework / dependency injection container | Module-scope state with a `wireXxx({ ... })` initializer | Codebase grain — paste-pump.js, scroll-state.js, selection.js, session-log.js, clipboard.js all use this idiom. Going against the grain costs more than it saves. |
| Boundary-shape contract verification | Custom integration test framework | Compile-time fn-pointer coercion in `tests/boundary_api_shape.rs` (or sibling) | Phase 2 + Phase 7 both proved this; a drifted `fn(&mut Slide, u8) -> u32` for `feed_byte` fails at `cargo test` compile, before wasm-pack ever runs. |
| TX writer reference plumbing | Pass `writer` through every module that wants to send | `tx-sink.js` registered-writer pattern (Phase 5 D-21) | Existing shape — `slide.js` calls `txSink.writeSlideFrame(bytes)`; `tx-sink.js` knows where the writer is. No `getWriter` export needed. |
| ESC^ baseline preservation | Reimplement VT52 auto-copy mode handling in JS | D-02 replay-on-fail | `vt52.rs:115-141` already silently swallows ESC^ via D-15. Replaying the swallowed prefix to `term.feed` keeps baseline behaviour identical. |
| 7-byte signature scan | Memchr / ring buffer / sliding window | Match-index counter (D-01) | Locked by D-01 — match-index is 8 lines, byte-perfect, easy to test exhaustively across all 7 split points. |

**Key insight:** Phase 8 is *integration*, not invention. The Rust SM exists; the wasm boundary pattern exists; the dispatcher idiom exists; the tx-sink writer-coupling exists; the Playwright mock exists. Phase 8 wires what already exists. Every "don't hand-roll" entry above is a place where Phases 2/4/5/6/7 already did the work.

## Common Pitfalls

### Pitfall 1: Post-feed invariant lost when dispatcher routes to slide

**What goes wrong:** `runReadLoop` in `serial.js` calls `sampleBellFn() / drainHostReplyFn / requestFrameFn / sessionLogRef.append` AFTER `term.feed(value)`. If the dispatcher routes `value` to slide, those post-feed hooks still need to fire — but a naive implementation might think "the bytes didn't go through term.feed, so don't call drainHostReply/requestFrame". That's wrong: the bytes DID go through the dispatcher, the read loop's post-feed hooks are mode-agnostic (they query terminal state and request a frame regardless of what just got fed).

**Why it happens:** Mental model conflates "feed the bytes" with "kick the post-feed pipeline." They're separate.

**How to avoid:** `dispatchInbound` returns synchronously; the existing `serial.js:454-462` post-feed block runs unchanged. If `dispatchInbound` routed bytes to slide instead of term.feed, that's fine — `sampleBellFn` will just observe no bell pending, `drainHostReplyFn` will just observe an empty host_reply, `requestFrame` will tick (harmlessly). Same for `sessionLogRef.append(value)` — Phase 11 will add the slide-active gate; Phase 8 logs the raw bytes.

**Warning signs:** Dispatcher refactor that adds early-returns or moves post-feed hooks into the dispatcher branches. Test gate: `dispatchInbound([0x07])` (a BEL through terminal mode) must still produce a bell flash because `sampleBellFn` runs after.

### Pitfall 2: Wakeup matcher state leaks into recv-mode bytes

**What goes wrong:** When the matcher reaches `wakeIdx === 7`, the dispatcher swaps to `'recv'` mode and forwards "any remaining bytes in the chunk" to `slide.feed_chunk`. If the implementation forgets to skip the just-matched 7 bytes (via `value.subarray(matchEndIdx + 1)`), the 7-byte signature itself gets fed to slide.feed_chunk — slide sees `ESC ^ S L I D E` as raw bytes which the framer silently discards via `framer.rs:108-109` (idle-state garbage), but the implementation has lost confidence in what bytes slide saw.

**Why it happens:** Off-by-one on chunk-tail indexing.

**How to avoid:** When `wakeIdx === 7` is reached on byte at offset `i` in `value`, the chunk tail is `value.subarray(i + 1)`. If `i + 1 < value.length`, call `slide.feed_chunk(value.subarray(i + 1))`. If `i + 1 === value.length`, the chunk tail is empty — slide will see the next chunk fresh. Test gate: a single chunk containing exactly `ESC ^ S L I D E` (7 bytes) followed by `[CTRL_RDY]` (1 byte) — slide must see exactly `[CTRL_RDY]` and emit `EVT_RDY`.

**Warning signs:** Test corpus where the wakeup signature ends mid-chunk and is followed by a CTRL_* byte; if the implementation re-feeds the signature, the framer sees garbage and the SM doesn't transition.

### Pitfall 3: TX owner not flipped back on Done/Error

**What goes wrong:** After `slide.state() === Done` or `Error`, the dispatcher must call `setWireOwner('terminal')` AND switch `mode = 'terminal'`. If only one of these flips, the next keystroke is silently dropped (mode says 'terminal' but owner still says 'slide') OR the next inbound byte is fed to slide (mode still 'recv' but owner already 'terminal'). Both are wedge states.

**Why it happens:** Two separate state variables to keep in sync.

**How to avoid:** Centralize in a single `exitRecvMode()` helper that flips both atomically. Test gate: drive a complete recv session to Done, assert `getWireOwner() === 'terminal'` AND `mode === 'terminal'` AND a subsequent keystroke through `pushTxBytes` reaches the writer.

**Warning signs:** Two `if (state === Done)` branches in different parts of `dispatchInbound`. Refactor to one helper.

### Pitfall 4: Wasm memory growth invalidates outbound view

**What goes wrong:** `new Uint8Array(wasm.memory.buffer, slide.outbound_ptr(), slide.outbound_len())` is a view over the underlying ArrayBuffer. If wasm memory grows (`memory.buffer` is replaced with a new ArrayBuffer), the view is detached and reads return zeros / throw.

**Why it happens:** wasm memory grows when the Rust side allocates beyond current capacity. The Phase 7 SM pre-reserves 16 bytes for `outbound_buf` (OUTBOUND_RESERVE), so the buffer pointer is stable in steady state — but a `slice.toArrayBuffer` operation, a new file batch, or a WIN_SIZE increase could trigger growth.

**How to avoid:** Phase 2 Plan 06 already established the `reDeriveHostReplyView` pattern — re-derive the view when `wasm.memory.buffer !== cachedBuffer`. Mirror this verbatim for `outboundView`.

**Warning signs:** A test that runs many sessions back-to-back and watches outbound bytes go to zero. The boundary_api_shape.rs `outbound_ptr_stable_across_feed_byte` test pins steady-state stability; the JS-side memory-growth re-derivation is the orthogonal protection.

### Pitfall 5: `await writer.write` straddles wasm memory growth

**What goes wrong:** `txSink.writeSlideFrame(view)` where `view` is a `Uint8Array(wasm.memory.buffer, ...)` view. The `.write(view)` call may serialize internally, but if the underlying ArrayBuffer detaches (memory grows during the await), the serialization reads from detached memory.

**Why it happens:** Web Serial `writer.write` is async; wasm memory growth can happen between `.write` invocation and the actual byte-out.

**How to avoid:** Always slice to a JS-owned buffer before calling `writer.write`. `view.slice()` returns a fresh `Uint8Array` backed by JS memory, not wasm memory. The Pattern 4 example above already does this; planner must enforce it in code review.

**Warning signs:** A direct `txSink.writeSlideFrame(new Uint8Array(wasm.memory.buffer, ptr, len))` call without `.slice()` in between.

### Pitfall 6: Slide constructor name collision with crate::slide::Slide

**What goes wrong:** The wasm façade in `lib.rs:wasm_boundary` is itself named `Slide`. The inner type from `crate::slide::Slide` is also `Slide`. Without an alias, `pub struct Slide { inner: Slide }` is recursive and won't compile.

**Why it happens:** ARCHITECTURE.md §1 chose the name `Slide` for the wasm-exported struct (matching JS-side usage `import { Slide }`). Phase 7 chose `Slide` for the inner SM struct (mirroring `Terminal`).

**How to avoid:** `use crate::slide::Slide as CoreSlide;` at the top of `wasm_boundary` mod, then `pub struct Slide { inner: CoreSlide }`. Mirrors the existing `use crate::terminal::Terminal as CoreTerminal;` at `lib.rs:39`.

**Warning signs:** A "recursive type" or "expected type, found struct" error from rustc on first wasm-pack build.

### Pitfall 7: EVT_* constant drift between Rust and JS

**What goes wrong:** Phase 8 mirrors `EVT_RDY = 1 << 16` etc. on the JS side. If a future Rust-side renumbering of `framer.rs` constants happens, JS doesn't notice — until a Playwright test fails or a session silently misroutes events.

**Why it happens:** wasm-bindgen does not expose Rust associated constants cleanly; the typical pattern is JS-side mirror plus a Rust-side test that asserts the values match.

**How to avoid:** The Phase 7 `tests/slide_boundary_shape.rs:slide_event_constants_pinned` test already pins the EVT_* values [VERIFIED: read tests/slide_boundary_shape.rs:78-94]. Phase 8's JS-side constants in `transport/slide.js` should carry a comment pointing to that test as the authority, AND the Playwright dispatcher harness should drive a CTRL_RDY byte and assert the reported event kind matches the JS-side `EVT_RDY` constant. Two layers of drift detection.

**Warning signs:** A renumbering Rust commit that didn't touch `tests/slide_boundary_shape.rs` (CI catches this — the test asserts exact values). A renumbering that DID touch the test but didn't touch the JS-side mirror (CI doesn't catch this — Playwright might).

### Pitfall 8: Boot order — `Slide` import before `wasm.init` resolves

**What goes wrong:** `import { Slide } from './pkg/bestialitty_core.js'` is statically evaluated, but `new Slide()` requires the wasm module to have run its `init()`. Calling `new Slide()` before `await init()` resolves throws.

**Why it happens:** Top-level await is the boot pattern; Phase 2 main.js already does `const wasm = await init();` then `const term = new Terminal(...)`. Phase 8 must construct `Slide` AFTER that await.

**How to avoid:** Construct `Slide` in main.js right after `term`, pass it to `wireSlideDispatcher` along with `term` and the `tx-sink` exports. The boot order is: prefs → polite-fail → init() → new Terminal → bootRenderer → wireChrome → wireScrollState → wireSelection → wireKeyboard → wirePastePump → wireClipboard → wireSessionLog → wireSerial → **wireSlideDispatcher** [VERIFIED: read main.js boot sequence].

**Warning signs:** A `Slide is not a constructor` or `wasm not initialized` error at boot. Refactor that hoists `wireSlideDispatcher` above `await init()`.

## Code Examples

### Example: dispatcher entry point in `transport/slide.js`

```js
// www/transport/slide.js — NEW. Source: locked by D-01..D-09.

import { Slide } from '../pkg/bestialitty_core.js';

// Mirror of Rust framer.rs constants. Authority: tests/slide_boundary_shape.rs:78-94.
// Drift here would surface as a Playwright failure; cargo test catches Rust-side drift.
const EVT_NONE        = 0;
const EVT_RDY         = 1 << 16;
const EVT_FIN         = 4 << 16;
const EVT_CAN         = 5 << 16;
// ...

// Mirror of Rust SlideState repr(u32). Authority: tests/slide_boundary_shape.rs:64-76.
const STATE_IDLE          = 0;
const STATE_WAITING_RDY   = 1;
const STATE_HEADER_PHASE  = 2;
const STATE_DATA_PHASE    = 3;
const STATE_FIN_PENDING   = 4;
const STATE_CANCEL_PEND   = 5;
const STATE_DONE          = 6;
const STATE_ERROR         = 7;

// 7-byte wakeup signature: ESC ^ S L I D E
const WAKEUP = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);

// Module-scope state (idiom: paste-pump.js, scroll-state.js).
let mode = 'terminal';            // 'terminal' | 'recv' | 'send' (send = Phase 9)
let wakeIdx = 0;
const scratch = new Uint8Array(6); // max 6-byte swallowed prefix
let slide = null;
let termRef = null;
let txSinkRef = null;              // { setWireOwner, writeSlideFrame }
let wasmRef = null;                // for memory.buffer access

// Cached outbound view (re-derived on memory growth).
let outboundBuffer = null;
let outboundView = null;

export function wireSlideDispatcher({ term, txSink, wasm }) {
    termRef = term;
    txSinkRef = txSink;
    wasmRef = wasm;
}

export function dispatchInbound(value) {
    if (mode === 'terminal') {
        dispatchTerminalMode(value);
    } else if (mode === 'recv') {
        dispatchRecvMode(value);
    }
    // mode === 'send' is Phase 9.
}

// Stub for Phase 11 — exported now so wiring is additive.
export function slidePumpOnPortLost() {
    // Phase 11 will: cancel any in-flight session, force_idle, hide chip.
    // Phase 8: no-op (no chip yet).
}

// Test introspection (mirrors window.__scrollState precedent).
export function __resetForTests() {
    mode = 'terminal';
    wakeIdx = 0;
    if (slide) { slide.free?.(); slide = null; }
}
export function __getStateForTests() {
    return { mode, wakeIdx, hasSlide: slide !== null };
}

// --- Internals ---

function dispatchTerminalMode(value) {
    const pending = []; // bytes that should reach term.feed
    let i = 0;
    while (i < value.length) {
        const b = value[i];
        if (b === WAKEUP[wakeIdx]) {
            // capture for replay (max 6 bytes; the 7th byte is the trigger
            // and never replayed because match succeeds).
            if (wakeIdx < 6) scratch[wakeIdx] = b;
            wakeIdx++;
            if (wakeIdx === 7) {
                // Flush pending term.feed bytes (any benign bytes BEFORE the wakeup in this chunk).
                if (pending.length) {
                    termRef.feed(new Uint8Array(pending));
                    pending.length = 0;
                }
                enterRecvMode();
                wakeIdx = 0;
                // Forward chunk tail to slide.
                const tail = value.subarray(i + 1);
                if (tail.length) {
                    feedSlide(tail);
                }
                return;
            }
        } else {
            // Mismatch — replay swallowed prefix (D-02).
            if (wakeIdx > 0) {
                pending.push(...scratch.subarray(0, wakeIdx));
                wakeIdx = 0;
                // Re-process current b from idx=0 (D-02 critical clause).
                if (b === WAKEUP[0]) {
                    scratch[0] = b;
                    wakeIdx = 1;
                    // current b swallowed — captured.
                } else {
                    pending.push(b);
                }
            } else {
                pending.push(b);
            }
        }
        i++;
    }
    if (pending.length) {
        termRef.feed(new Uint8Array(pending));
    }
}

function dispatchRecvMode(value) {
    feedSlide(value);
    // Drain events (Phase 8 doesn't need to act on most events — Phase 10 will
    // surface progress via __slideProgress hook). Phase 8 just needs to detect
    // session end.
    while (slide.take_event_packed() !== EVT_NONE) { /* drain */ }
    drainSlideOutbound();
    const st = slide.state();
    if (st === STATE_DONE || st === STATE_ERROR) {
        exitRecvMode();
        // No chunk-tail handling in Phase 8 — receiver Done means end-of-batch
        // FIN was just consumed; bytes after that are next-session terminal output.
        // Phase 10 may revisit if Done can land mid-chunk.
    }
}

function feedSlide(bytes) {
    slide.feed_chunk(bytes);
}

function enterRecvMode() {
    if (slide) slide.free?.();
    slide = new Slide();
    slide.enter_recv_mode();
    txSinkRef.setWireOwner('slide');
    mode = 'recv';
}

function exitRecvMode() {
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    // Note: slide instance lifecycle — Phase 7 leaves the Done instance dropped on
    // the next enterRecvMode (Claude's Discretion). slide stays non-null until
    // the next session, which is fine — feed_byte is a no-op in Done state.
}

function drainSlideOutbound() {
    const len = slide.outbound_len();
    if (len === 0) return;
    if (wasmRef.memory.buffer !== outboundBuffer) {
        outboundBuffer = wasmRef.memory.buffer;
        outboundView = new Uint8Array(outboundBuffer, slide.outbound_ptr(), 16);
    }
    // CRITICAL: slice to JS-owned buffer (Pitfall 5).
    const owned = new Uint8Array(outboundView.subarray(0, len));
    txSinkRef.writeSlideFrame(owned);
    slide.clear_outbound();
}
```

### Example: tx-sink.js modification (D-08)

```js
// www/input/tx-sink.js — additions. Source: locked by D-08.

let owner = 'terminal';

export function setWireOwner(o) {
    if (o !== 'terminal' && o !== 'slide') {
        throw new Error(`[tx-sink] invalid owner: ${o}`);
    }
    owner = o;
}

export function getWireOwner() { return owner; }

// Modify pushTxBytes — add this as the FIRST statement:
export function pushTxBytes(bytes) {
    if (owner === 'slide') return; // silent drop during SLIDE session (D-08)
    // ... existing ring + writer.write path unchanged
}

export function writeSlideFrame(bytes) {
    if (!registeredWriter) {
        console.error('[tx-sink] writeSlideFrame: no writer registered');
        return;
    }
    registeredWriter.write(bytes).catch((err) => {
        console.error('[tx-sink] writeSlideFrame failed:', err);
    });
}
```

### Example: serial.js single-line edit (D-06)

```js
// www/transport/serial.js — line 453 only. Source: locked by D-06.
// BEFORE:
//     term.feed(value);
// AFTER:
    dispatchInbound(value);
// Lines 454-462 (sampleBellFn / drainHostReplyFn / requestFrameFn / sessionLogRef.append) UNCHANGED.
```

### Example: Slide façade in lib.rs

See Pattern 3 above — the full impl block is the canonical example.

### Example: boundary_api_shape extension for Slide wasm façade

```rust
// crates/bestialitty-core/tests/boundary_api_shape.rs (or sibling slide_wasm_boundary_shape.rs)
// Source: locked by D-10; mirror of slide_boundary_shape.rs:28-111 pattern.
//
// NOTE: This file pins the INNER (crate::slide::Slide) shape that the wasm
// boundary forwards to. The wasm façade itself is gated by
// #[cfg(target_arch = "wasm32")] so a native cargo test can't directly pin
// the wasm-bindgen-attributed methods. The intent is: if the inner API
// drifts, this test fails at compile time; if the wasm façade drifts to
// expose a method the inner API doesn't have, wasm-pack build fails.

// (The Phase 7 slide_boundary_shape.rs already does this work for the inner
// API. Phase 8's Plan can either extend that file with the Phase 8-specific
// fn-pointer pins for any ADDITIONAL methods the wasm façade adds — currently
// none, since D-10 locks the surface to exactly what slide_boundary_shape.rs
// already pins — OR add a sibling file with the same pins under a different
// name to signal "Phase 8 has read these contracts and depends on them."
// Recommendation: extend the existing file with a `// Phase 8 wasm boundary
// dependency` comment and a single pin re-asserting the full surface.)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `term.feed(value)` only path in `serial.js:runReadLoop` | `dispatchInbound(value)` routes to terminal OR slide based on mode | Phase 8 | Single-line edit; post-feed invariant preserved. |
| `pushTxBytes` writes regardless of context | `pushTxBytes` early-returns when `owner === 'slide'` | Phase 8 | Silent drop during SLIDE session; chip messaging Phase 11. |
| 2-byte wakeup signature `ESC ^` (research-original proposal in PITFALLS §2 forward-compat fallback) | 7-byte signature `ESC ^ S L I D E` | v1.1 OQ-2 locked 2026-05-06 | Reduces false-positive collision risk near-zero; adds matcher complexity. |
| Slide receiver lifecycle: not yet exposed to JS | Per-session `new Slide()`; `Slide::reset()` rejected | Phase 8 (default) | No Rust API expansion; ~1 KB allocation per session is irrelevant. |
| EVT_* constants Rust-only | Mirrored in JS `transport/slide.js` with comment pointing to `tests/slide_boundary_shape.rs` as authority | Phase 8 | wasm-bindgen does not expose associated constants cleanly. |
| Cancel timing in Rust | Cancel timing in JS (`setTimeout(2000)`); `slide.cancel()` + `slide.force_idle()` are pure event-driven | Phase 7 + ADR-003 | Honors no-`std::time` invariant; CI-enforced. |

**Deprecated/outdated:**
- The 2-byte `ESC ^` wakeup proposal in PITFALLS.md §2 is superseded by the 7-byte `ESC ^ S L I D E` lock (v1.1 OQ-2 from 2026-05-06).
- The "Rust-side stateful helper for wakeup" alternative is rejected (D-01) — would expand Phase 7's locked Rust API surface beyond its boundary-shape pin.
- The "discard swallowed prefix on partial-match failure" alternative is rejected (D-02) — would regress benign `ESC ^` (auto-copy mode) baseline behaviour.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | wasm-bindgen does not have a clean associated-constant export pattern; JS-side mirroring is the standard approach | Standard Stack — Alternatives Considered; Pitfall 7 | Low — verified via Context7 lookup; if wrong, planner can switch to `#[wasm_bindgen]` on associated `pub const`s. The boundary-shape pin already gates Rust-side values either way. [CITED: rustwasm.github.io wasm-bindgen docs via Context7 query] |
| A2 | Phase 5 D-21 `registeredWriter` reference reuse is sufficient — no need for a separate writer for SLIDE frames | Pattern 2; Don't Hand-Roll table | Low — `tx-sink.js:78-81` already exposes `registerWriter`/`unregisterWriter`; `writeSlideFrame` reuses the same reference. If an aliased writer were needed, Phase 5 would have already needed it. [VERIFIED: read tx-sink.js] |
| A3 | The `slide.feed_chunk` hot path is sufficiently fast through the wasm boundary at 19200 baud (~1.9 KB/s peak inbound during SLIDE recv); per-byte `feed_byte` is unnecessary | Architecture Patterns; Anti-Patterns | Low — 1.9 KB/s is well below per-call FFI overhead even at the worst case. wasm-bindgen FFI is sub-microsecond per call; one `feed_chunk` per Web Serial chunk is the natural cadence. |
| A4 | The Phase 7 `slide_boundary_shape.rs` pin is sufficient to catch Rust-side drift for Phase 8's wasm façade; no additional `wasm-bindgen-test` layer needed | Test Strategy (Claude's Discretion); Don't Hand-Roll table | Low — fn-pointer coercion catches signature drift at compile time. The wasm-pack build's TypeScript `.d.ts` emission catches façade-vs-inner mismatch separately. Two layers cover the contract. |
| A5 | Wasm memory growth is rare enough during a typical SLIDE session that re-deriving the outbound view at session boundaries is sufficient | Pattern 4; Pitfall 4 | Low — the `outbound_buf` Vec is pre-reserved 16 bytes; growth requires the JS side to allocate (e.g. construct a new Slide, which Phase 8 does per-session). The `reDeriveHostReplyView` pattern from main.js handles arbitrary re-derivation already. |
| A6 | Module-scope state in `transport/slide.js` (D-01 default) is testable enough via Playwright + a `__resetForTests` export | Test Strategy; Boot Wiring | Low — paste-pump.js / scroll-state.js / selection.js all use this pattern with Playwright tests; precedent is solid. |
| A7 | Phase 11's `slidePumpOnPortLost` symbol can be exported as a no-op stub from `transport/slide.js` in Phase 8 so Phase 11 wiring is purely additive | Component Responsibilities; Deferred section | Low — symmetric to Phase 5's `pastePumpOnPortLost` extension precedent. |

**No assumed claims about user-facing requirements, compliance, or security gates.** All `[ASSUMED]` items above are technical-architecture assumptions that the planner can validate via the Wave-0 boundary tests; nothing is hidden from the user.

## Open Questions

1. **Should wakeup-matcher backing buffer be module-scope or per-call?**
   - What we know: D-01 locks the match-index counter; the 6-byte scratch buffer is mentioned in D-02 ("hold the consumed bytes in a small backing buffer").
   - What's unclear: whether the planner prefers a module-scope `new Uint8Array(6)` allocated at module init (zero-allocation steady state) or a per-call temporary slice (more readable per-call, irrelevant cost).
   - Recommendation: module-scope, mirroring `paste-pump.js` and `tx-sink.js` ring-buffer idiom. Allocation cost is irrelevant; consistency with codebase grain is the lever.

2. **Boundary-shape test: extend `boundary_api_shape.rs` or add sibling `slide_wasm_boundary_shape.rs`?**
   - What we know: Phase 7 chose sibling-mirror (`tests/slide_boundary_shape.rs`) for the inner SM, distinct from `boundary_api_shape.rs` (Terminal façade).
   - What's unclear: whether Phase 8's wasm façade pin lives in the existing `slide_boundary_shape.rs` (since it's the same struct family) or extends `boundary_api_shape.rs` (since both files cover wasm-boundary-adjacent contracts).
   - Recommendation: extend `slide_boundary_shape.rs` with a "Phase 8 wasm façade dependency" section. Keeps grep locality on the slide subsystem.

3. **Should the dispatcher consume the wakeup signature's bytes from the chunk or pass-through to slide?**
   - What we know: D-05 says "forward any chunk tail via `slide.feed_chunk(tail)`" — the wakeup bytes are NOT part of "tail" because they were swallowed by the matcher.
   - What's unclear: implementation-level — when slicing `value.subarray(matchEndIdx + 1)`, off-by-one risk (Pitfall 2).
   - Recommendation: the test corpus must include the case "chunk = [...wakeup-7-bytes, CTRL_RDY]" and assert slide receives only `[CTRL_RDY]` (1 byte) and emits `EVT_RDY`. This pins the slicing arithmetic.

4. **Should `dispatchInbound` synchronously drain `take_event_packed` events in Phase 8, or defer to Phase 10's chip controller?**
   - What we know: D-05 mentions "drain events via `slide.take_event_packed()`" but Phase 8 has no chip UI — the events have nowhere to go.
   - What's unclear: whether Phase 8 drains events to a no-op (just to keep the ring from filling), or skips draining entirely (relies on Phase 10 to add it).
   - Recommendation: drain events in Phase 8 to a no-op (the ring is bounded at EVENT_RING_RESERVE = 32 entries; not draining could cause silent event-drop). Phase 10 adds the event handler that does work. This is the Phase 8 minimum-viable approach.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `cargo` | Native Rust tests + boundary-shape pin | ✓ | 1.94.1 | — |
| `wasm-pack` | Building `www/pkg/bestialitty_core.{js,wasm}` | ✓ | 0.12.1 | — |
| `node` | Playwright runtime | (assumed available — Phase 5 / Phase 6 already use it) | — | — |
| `@playwright/test` | Dispatcher + handoff specs | (assumed available — `www/playwright.config.js` exists at [VERIFIED: file present]) | — | — |
| `wasm-bindgen` (Rust dep) | `Slide` façade compilation under wasm32 target | ✓ | =0.2.118 (pinned) | — |
| `vte` (Rust dep) | Existing terminal parser; Phase 8 doesn't add a vte call but the dispatcher's replay-on-fail must not break vte's torn-chunk invariants | ✓ | =0.15 (pinned) | — |
| `navigator.serial` | Real Web Serial in Chromium for human-UAT | ✗ at test time (Playwright) | — | `www/tests/transport/mock-serial.js` covers SC#1..#5 in CI; real-hardware UAT deferred to Phase 12 SLIDE-42 |

**Missing dependencies with no fallback:** None — all Phase 8 verification gates can run in CI via `cargo test` + Playwright with the existing serial mock.

**Missing dependencies with fallback:** Real `navigator.serial` (mocked via `mock-serial.js` for CI; real-hardware verification is Phase 12's UAT scope, not Phase 8's gate).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Native Rust framework | `cargo test` (built-in) — Phase 7's 232 tests + Phase 8's boundary-shape additions [VERIFIED: STATE.md] |
| Browser framework | `@playwright/test` — Phase 5/6 substrate; `www/playwright.config.js` is the existing config [VERIFIED: file at `www/playwright.config.js`] |
| Wasm-bindgen FFI framework | `wasm-bindgen-test` — REJECTED for Phase 8 per Claude's Discretion default; the boundary-shape pin via fn-pointer coercion + the wasm-pack build's `.d.ts` emission cover the FFI contract |
| Quick run command | `cargo test --lib slide::` (~5 s) for inner SM regression; `npx playwright test transport/slide-dispatch.spec.js` (~30 s) for dispatcher harness |
| Full suite command | `cargo test` (whole crate, ~30 s) + `npx playwright test` from `www/` (full Playwright suite, ~3 min) |
| Phase gate | Both green |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLIDE-05 | dispatchInbound routes terminal-mode bytes through wakeup matcher; routes recv-mode bytes to slide.feed_chunk | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "SLIDE-05"` | ❌ Wave 0 |
| SLIDE-05 (inner) | Match-index counter state persists across reader.read() resolutions | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "torn-chunk wakeup"` | ❌ Wave 0 |
| SLIDE-05 (inner) | Partial-match failure replays swallowed prefix in original order to term.feed | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "partial-match replay"` | ❌ Wave 0 |
| SLIDE-05 (inner) | `ESC ^ ESC ^ S L I D E` re-process-from-idx=0 case detects second wakeup | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "mid-prefix retry"` | ❌ Wave 0 |
| SLIDE-06 | tx-sink.setWireOwner('slide') silently drops pushTxBytes during session | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "tx owner gate"` | ❌ Wave 0 |
| SLIDE-06 | writeSlideFrame writes via registeredWriter, not the keystroke ring | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "writeSlideFrame bypass"` | ❌ Wave 0 |
| SLIDE-17 | 7-byte signature `ESC ^ S L I D E` triggers enter_recv_mode | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "wakeup detected"` | ❌ Wave 0 |
| SC#1 (wasm boundary) | `Slide` `#[wasm_bindgen]` struct exists and exposes locked methods | Cargo (compile-time) | `cargo test --test slide_boundary_shape` | ✅ (extension Wave 0) |
| SC#1 (wasm boundary) | `wasm-pack build --target web` rebuilds without breaking Terminal contract | Build smoke | `bash scripts/build.sh` exits 0; `bash scripts/smoke-wasm-build.sh` (extension) | ✅ (smoke script exists; extension Wave 0) |
| SC#2 (dispatcher routing) | Single-line edit at `serial.js:453` is the only hot-path change | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "post-feed invariant preserved"` | ❌ Wave 0 |
| SC#2 (dispatcher routing) | post-feed invariant (sampleBell, drainHostReply, requestFrame, sessionLog.append) carries through dispatcher | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "BEL through dispatcher triggers flash"` | ❌ Wave 0 |
| SC#3 (wakeup matcher) | All 7 internal-split torn-chunk cases detect the wakeup | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "torn-chunk wakeup"` | ❌ Wave 0 |
| SC#3 (wakeup matcher) | Benign `ESC ^ A` does NOT trigger SLIDE entry; bytes reach term.feed | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "benign ESC caret"` | ❌ Wave 0 |
| SC#4 (TX handoff) | Keystrokes during active SLIDE session are silent-dropped | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "keystroke during session"` | ❌ Wave 0 |
| SC#4 (TX handoff) | SLIDE writes go through writeSlideFrame, not pushTxBytes ring | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "SLIDE writes bypass ring"` | ❌ Wave 0 |
| SC#5 (recv-mode hand-off) | Wakeup → enter_recv_mode → bytes after wakeup feed slide only | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "post-wakeup byte routing"` | ❌ Wave 0 |
| SC#5 (recv-mode hand-off) | After Done/Error, dispatcher returns to terminal mode + setWireOwner('terminal') | Playwright | `npx playwright test transport/slide-dispatch.spec.js -g "session-end mode flip"` | ❌ Wave 0 |

### Test Corpus for the 7-Byte Wakeup Matcher

The matcher is the load-bearing piece — Phase 8's correctness gate is exhaustive coverage of every torn-chunk + every partial-match scenario. The corpus is JS-side (Playwright); a sibling cargo-side smoke is unnecessary because the matcher logic is JS-only.

**Full-match torn-chunk variants (7 cases, mirrors Phase 1 torn_chunk pattern):**

| Case | Chunk 1 | Chunk 2 | Expected |
|------|---------|---------|----------|
| split-0/1 | `ESC` | `^ S L I D E` | mode = 'recv' after chunk 2 |
| split-1/2 | `ESC ^` | `S L I D E` | mode = 'recv' after chunk 2 |
| split-2/3 | `ESC ^ S` | `L I D E` | mode = 'recv' after chunk 2 |
| split-3/4 | `ESC ^ S L` | `I D E` | mode = 'recv' after chunk 2 |
| split-4/5 | `ESC ^ S L I` | `D E` | mode = 'recv' after chunk 2 |
| split-5/6 | `ESC ^ S L I D` | `E` | mode = 'recv' after chunk 2 |
| split-6/7 | `ESC ^ S L I D E` | (no chunk 2 needed) | mode = 'recv' after chunk 1 |

**3-way splits (random spot-checks):** `ESC` | `^ S L` | `I D E`; `ESC ^ S` | `L I` | `D E`. Sampling — exhaustive 3-way is `7 choose 2 = 21` cases; one or two suffices.

**Benign partial-match cases (replay-on-fail correctness):**

| Case | Input | Expected at term.feed |
|------|-------|----------------------|
| short-prefix-reject | `ESC ^ A` | `[ESC, ^, A]` byte-identical to a SLIDE-free build |
| mid-match-reject | `ESC ^ S L X` | `[ESC, ^, S, L, X]` byte-identical |
| long-match-reject | `ESC ^ S L I D X` | `[ESC, ^, S, L, I, D, X]` byte-identical |
| benign-isolated-ESC | `ESC` (alone, then `A` next chunk) | `[ESC]` then `[A]` (or merged into `[ESC, A]` depending on flush timing) — vte recovers from incomplete escape |
| benign-isolated-caret | `^ S L I D E` (no leading ESC) | `[^, S, L, I, D, E]` byte-identical (matcher never advances past idx=0) |

**Re-process-from-idx=0 cases (D-02 critical clause):**

| Case | Input | Expected |
|------|-------|----------|
| second-wakeup-after-prefix-fail | `ESC ^ ESC ^ S L I D E` | First `ESC ^` replays to term.feed; second `ESC ^ S L I D E` triggers wakeup |
| second-wakeup-mid-stream | `ESC ^ S X ESC ^ S L I D E` | `[ESC, ^, S, X]` to term.feed; second sequence triggers wakeup |
| chunk-boundary-second-wakeup | chunk 1 `ESC ^ S L X`; chunk 2 `ESC ^ S L I D E` | `[ESC, ^, S, L, X]` to term.feed (in chunk 1); second sequence triggers wakeup |

**Recv-mode pass-through cases:**

| Case | Setup | Input chunk | Expected |
|------|-------|-------------|----------|
| recv-bytes-feed-slide | wakeup completed; mode = 'recv' | `[CTRL_RDY]` | slide emits `EVT_RDY`; outbound contains `CTRL_RDY` echo |
| recv-mid-stream-wakeup-passthrough (D-07) | wakeup completed; mode = 'recv' | `ESC ^ S L I D E` | bytes feed slide as raw garbage; framer silent-discards (idle state); mode stays 'recv' |
| recv-completes-via-FIN | wakeup completed; mode = 'recv'; in HeaderPhase | `CTRL_FIN` | slide transitions to Done; dispatcher exits recv mode; setWireOwner('terminal'); mode = 'terminal' |

**Post-feed invariant cases:**

| Case | Input | Expected |
|------|-------|----------|
| BEL-through-dispatcher | `[0x07]` (BEL alone) | term.feed sees BEL; sampleBellFn observes bell_pending; bell flash triggers |
| ESC-Z-through-dispatcher | `ESC Z` | term.feed sees ESC Z; drainHostReplyFn pulls back `ESC / K`; tx-sink writeSlideFrame NOT called (it's a host_reply, not a SLIDE frame) |

**TX-owner-handoff cases:**

| Case | Setup | Input | Expected |
|------|-------|-------|----------|
| keystroke-during-session | wakeup → recv mode; setWireOwner('slide') | `pushTxBytes([0x41])` (key 'A') | writer.write NOT called; mockWriterLog unchanged |
| SLIDE-frame-during-session | wakeup → recv mode | `writeSlideFrame([CTRL_ACK, 0x00])` | writer.write called with `[0x06, 0x00]`; ring NOT updated |
| keystroke-after-session-end | wakeup → recv → Done; setWireOwner('terminal') | `pushTxBytes([0x41])` | writer.write called with `[0x41]` (normal path resumes) |

**Sampling cadence:**

- **Per task commit:** `cargo test --lib slide::` (~5 s; covers any inner-API regression)
- **Per wave merge:** full `cargo test` (~30 s) + targeted `npx playwright test transport/slide-dispatch.spec.js` (~30 s)
- **Phase gate:** full suite green before `/gsd-verify-phase`

### Acceptance Gates per ROADMAP Phase 8 Success Criterion

**SC#1 — Wasm boundary surface for `Slide` exists, parallel to `Terminal`; `wasm-pack` rebuild does not break Terminal contract.**
- Gate 1: `cargo test --test slide_boundary_shape` green (extension OR sibling pins all 11 façade methods + EVT_* + STATE_* values)
- Gate 2: `cargo test --test boundary_api_shape` green (existing Terminal contract intact)
- Gate 3: `bash scripts/build.sh` exits 0; `www/pkg/bestialitty_core.js` contains `class Slide` (grep)
- Gate 4: Phase 2's `core_02_no_browser_deps` invariant green (the new `Slide` façade lives in `lib.rs`, already exempted; no other file imports `wasm_bindgen`)

**SC#2 — `transport/slide.js:dispatchInbound` is wired; `serial.js:453` is the only hot-path change in existing code.**
- Gate 1: `git diff` of Phase 8 commits shows `serial.js` changed at exactly one line (453, `term.feed` → `dispatchInbound`)
- Gate 2: Playwright `slide-dispatch.spec.js: post-feed invariant preserved` green — BEL through dispatcher triggers flash; ESC Z through dispatcher returns identify reply via existing host_reply drain path
- Gate 3: Playwright `slide-dispatch.spec.js: pure-terminal mode unchanged` green — feeding a Phase 1 capture sequence through `dispatchInbound` produces grid state byte-identical to feeding directly through `term.feed` (regression: confirms dispatcher is transparent in terminal mode for non-wakeup bytes)

**SC#3 — 7-byte wakeup detected across arbitrary chunk-boundary splits; spurious `ESC ^` does NOT trigger SLIDE entry.**
- Gate 1: All 7 internal-split torn-chunk Playwright tests green (full test corpus above)
- Gate 2: All benign-partial-match Playwright tests green; term.feed receives the byte-perfect replay
- Gate 3: Mid-prefix retry case green (`ESC ^ ESC ^ S L I D E`)

**SC#4 — `tx-sink.setWireOwner('slide')` blocks `pushTxBytes` during session; SLIDE writes via `writeSlideFrame` bypassing the ring.**
- Gate 1: Playwright `keystroke-during-session` green — `pushTxBytes` called during `owner === 'slide'` produces zero entries in `__mockWriterLog`
- Gate 2: Playwright `SLIDE-frame-during-session` green — `writeSlideFrame([CTRL_ACK, 0x00])` produces exactly one `__mockWriterLog` entry with bytes `[0x06, 0x00]`; the keystroke ring (`formatHexStrip()`) is unchanged
- Gate 3: Playwright `keystroke-after-session-end` green — after recv → Done → `setWireOwner('terminal')`, `pushTxBytes([0x41])` reaches the writer

**SC#5 — Wakeup transitions BestialiTTY into receive mode; bytes after the wakeup signature feed only the SLIDE state machine.**
- Gate 1: Playwright `post-wakeup byte routing` green — chunk `[...wakeup-bytes, CTRL_RDY]` causes slide to emit `EVT_RDY` exactly once; `term.feed` is NOT called for those bytes
- Gate 2: Playwright `session-end mode flip` green — after slide reaches Done state, subsequent inbound bytes route to `term.feed` again
- Gate 3: Playwright `outbound drain` green — slide's outbound_buf bytes (e.g. `CTRL_RDY` echo) reach the writer via `writeSlideFrame`

### Wave 0 Gaps

- [ ] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — extend with Phase 8 wasm-façade dependency section (or sibling file) — covers SC#1
- [ ] `www/transport/slide.js` — module skeleton with `wireSlideDispatcher`, `dispatchInbound`, `slidePumpOnPortLost` (stub), `__resetForTests`, `__getStateForTests` exports — covers SC#2..#5
- [ ] `www/tests/transport/slide-dispatch.spec.js` — Playwright spec file with the test corpus above
- [ ] `scripts/smoke-wasm-build.sh` — extend (optional) with a `Slide`-only import smoke that asserts `pkg/bestialitty_core.js` exports `Slide` and `new Slide()` doesn't throw
- [ ] No new framework install required — `cargo test`, `wasm-pack`, Playwright are all already in use

## Sources

### Primary (HIGH confidence)
- `/home/ant/src/microbeast/bestialitty/.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-CONTEXT.md` — locked decisions (D-01..D-11)
- `/home/ant/src/microbeast/bestialitty/.planning/research/ARCHITECTURE.md` §1, §2, §3 — wasm façade, dispatcher, tx-sink (load-bearing)
- `/home/ant/src/microbeast/bestialitty/.planning/research/PITFALLS.md` §1, §2, §11 — chunk framing, wakeup detection, auto-type echo
- `/home/ant/src/microbeast/bestialitty/.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen attribute discipline
- `/home/ant/src/microbeast/bestialitty/.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — cancel/force_idle JS contract
- `/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/src/lib.rs` — Terminal façade (lines 54-174); `host_reply_ptr/_len/clear_host_reply` triple (lines 83-95); the verbatim template
- `/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/src/slide/state.rs` — Phase 7 Slide receiver SM (the inner type the wasm façade wraps)
- `/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/src/slide/framer.rs` — EVT_* + CTRL_* constants
- `/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/tests/slide_boundary_shape.rs` — Phase 7 fn-pointer pin; the contract Phase 8 must not drift from
- `/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/tests/boundary_api_shape.rs` — Phase 2 boundary pin pattern
- `/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — wasm/std::time invariant guard
- `/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/src/vt52.rs:115-141` — D-15 silent-discard arm (load-bearing for D-02/D-03)
- `/home/ant/src/microbeast/bestialitty/www/transport/serial.js:444-477` — `runReadLoop` post-feed invariant; line 453 single-edit site
- `/home/ant/src/microbeast/bestialitty/www/input/tx-sink.js` — Phase 5 D-21 writer-coupling at lines 78-81
- `/home/ant/src/microbeast/bestialitty/www/main.js` — boot wiring sequence; reDeriveHostReplyView memory-growth pattern (lines 274-289)
- `/home/ant/src/microbeast/bestialitty/www/tests/transport/mock-serial.js` — `__mockReaderPush` + `__simulateUnplug` Playwright hooks
- `/home/ant/src/microbeast/bestialitty/.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md` — Terminal façade design rationale; mirror template
- `/home/ant/src/microbeast/bestialitty/.planning/phases/05-web-serial-transport/05-CONTEXT.md` — D-21 writer registration; navigator.serial mock pattern
- `/home/ant/src/microbeast/bestialitty/.planning/phases/07-slide-rust-core-framer-crc-state-machine/07-CONTEXT.md` — every D-* constraint on the inner Rust SM Phase 8 wraps

### Secondary (MEDIUM confidence)
- Context7 query — `/websites/rustwasm_github_io_wasm-bindgen` for "associated consts struct impl static" / "const" — confirmed wasm-bindgen does not have a clean associated-constant export pattern; JS-side mirror is the standard approach (informs Pitfall 7 and EVT_* discretion).

### Tertiary (LOW confidence)
- None. All claims are grounded in repo files or Context7 verification.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already pinned in Cargo.toml + scripts/build.sh; verified via Read tool against current files
- Architecture: HIGH — ARCHITECTURE.md §1/§2/§3 are load-bearing and Phase 7's `tests/slide_boundary_shape.rs` already locks the inner contract
- Pitfalls: HIGH — Pitfalls 1–8 each map to a verified file location or test gate
- Wakeup matcher correctness: HIGH — the state machine is small enough to enumerate exhaustively (test corpus above covers every torn-chunk + benign-partial-match + re-process case)
- Test substrate availability: HIGH — Phase 5 `mock-serial.js` and Phase 7 `slide_boundary_shape.rs` are both already in the repo
- wasm-bindgen associated-constants alternative (Pitfall 7 / EVT_* discretion): MEDIUM — Context7 query suggests JS-side mirror is canonical, but a wasm-bindgen `(const)`-style attribute may exist in newer versions; planner should verify against `=0.2.118` docs if the discretion lever flips toward Rust-side exposure

**Research date:** 2026-05-07
**Valid until:** 30 days (stable substrate; no fast-moving dependencies in scope; the only mover is Phase 7's inner API which is contract-pinned by `tests/slide_boundary_shape.rs`)
