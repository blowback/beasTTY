# Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Cross the Phase 7 SLIDE state machine into the browser via wasm-bindgen, route
inbound Web Serial chunks to either the terminal parser or the SLIDE state
machine via a new JS dispatcher, detect the 7-byte `ESC ^ S L I D E` wakeup
signature robustly across torn Web Serial chunks, and hand off TX writer
ownership cleanly without breaking Phase 5's writer contract.

**In scope:** new `Slide` `#[wasm_bindgen]` struct in `lib.rs` (sibling to
`Terminal`) wrapping the Phase 7 receiver-side `crate::slide::Slide`; new
`www/transport/slide.js` dispatcher exporting `dispatchInbound(value)` plus
SLIDE-mode lifecycle; the 7-byte wakeup matcher (torn-chunk safe); TX writer
ownership handoff in `tx-sink.js` (`setWireOwner` + `writeSlideFrame`);
single-line edit at `serial.js:453`; native `cargo test` + Playwright coverage
for the dispatch / wakeup / handoff / event-drain flows; `Slide` boundary
contract pinned by an extension to the existing `tests/boundary_api_shape.rs`
or a sibling `tests/slide_wasm_boundary_shape.rs`.

**Out of scope:** sender-side `enter_send_mode` and file-source modules
(Phase 9); receiver-side per-file Chrome download + `chunks: Uint8Array[]`
reassembly (Phase 10); `Cancel` chip UI + Esc-cancel disambiguation +
post-cancel chip + cancellation drain timing (Phase 10); mid-session
re-entrant wakeup detection (`ESC ^ S L I D E` while `mode === 'recv'`) +
"Z80 reset detected" warning chip (Phase 10); floating SLIDE chip (Phase 11);
Settings auto-send command pref + session-log pause + paste-pump gate +
visibilitychange teardown + auto-type echo swallow + Z80 fallback chip
(Phase 11); filename collision UX, drag-drop pointer-select isolation,
`docs/SLIDE_Z80_REQUIREMENT.md`, real-hardware UAT (Phase 12).

</domain>

<decisions>
## Implementation Decisions

### Wakeup matcher (Phase 8 SC#3)

- **D-01:** **Match-index counter (0..7), module-scope state in
  `www/transport/slide.js`.** A `wakeIdx` integer tracks progress through the
  7-byte signature `ESC ^ S L I D E`. On each inbound byte during
  `mode === 'terminal'`: if byte matches `WAKEUP[wakeIdx]`, increment
  `wakeIdx` and **swallow** (do not forward to `term.feed`); on `wakeIdx === 7`
  switch `mode = 'recv'`, call `slide.enter_recv_mode()`, and forward any
  chunk residual via `slide.feed_chunk(remaining)`. State persists across
  Web Serial chunk boundaries via the module-scope variable. Rejects the
  "7-byte sliding ring buffer" alternative (allocates per byte; harder
  partial-match recovery) and the "Rust-side stateful helper" alternative
  (would expand Phase 7's locked Rust API surface beyond its boundary-shape
  pin). Matches the existing JS module-scope state idiom (`paste-pump.js`,
  `scroll-state.js`).

- **D-02:** **Replay swallowed prefix to `term.feed` on partial-match
  failure.** Hold the consumed bytes in a small backing buffer (max 6
  bytes; allocated once at module init via `new Uint8Array(6)`). On any
  mismatch (e.g. wire shows `ESC ^ S L I D X`): flush the swallowed
  bytes to `term.feed` in original order, reset `wakeIdx = 0`, then
  **re-process the current failing byte from `wakeIdx === 0`** (so
  `ESC ^ ESC ^ S L I D E` still detects the second wakeup). Preserves
  baseline VT52 behavior — a benign Z80 `ESC ^` still reaches the
  terminal parser exactly as it would today, where `vte` interprets the
  sequence and the existing D-15 silent-discard policy applies. Rejects
  the "discard swallowed prefix" alternative because it would make benign
  `ESC ^` (auto-copy mode toggle) effectively invisible to the terminal,
  a behavior change vs baseline.

- **D-03:** **VT52 `ESC ^` lore.** `ESC ^` is the VT52 "enter auto-copy
  mode" sequence (thermal printer hardcopy on the original DEC VT52 /
  MicroBeast peripheral); `ESC _` exits auto-copy mode. The MicroBeast
  has no thermal printer attached, so toggling auto-copy mode in the
  terminal parser is a no-op visually. The existing parser silently
  swallows both via D-15 (`vt52.rs:115-141` `_ => {}` arm) — confirmed by
  reading `vt52.rs` directly. Phase 8's matcher must not regress this
  baseline; D-02 is the mechanism. Capture this in the test corpus so
  future contributors don't think `ESC ^` is "just SLIDE noise" (it
  isn't — it's a legitimate VT52 escape we re-purpose for SLIDE wakeup
  via the 7-byte extension that VT52 would never emit).

### JS Dispatcher

- **D-04:** **Pre-parser sniff in JS at `dispatchInbound`, NOT in Rust.**
  The terminal parser already accumulates partial escape sequences across
  chunk boundaries; routing `ESC ^` through Rust first has no clean
  rewind path (ARCHITECTURE.md §2 + Anti-Pattern 2). All wakeup detection
  lives in JS. (Locked by ARCHITECTURE.md.)

- **D-05:** **New module `www/transport/slide.js` exporting
  `dispatchInbound(value: Uint8Array)`** that routes per `mode`:
  - `mode === 'terminal'`: drive the wakeup matcher (D-01 + D-02); on
    full match, switch to `'recv'` and forward any chunk tail via
    `slide.feed_chunk(tail)`.
  - `mode === 'recv'`: forward all bytes to `slide.feed_chunk(bytes)`;
    drain events via `slide.take_event_packed()`; drain outbound via
    `outbound_ptr/_len` + `clear_outbound`; on `slide.state() === Done`
    or `Error`, switch back to `mode = 'terminal'`, call
    `setWireOwner('terminal')`, and feed any chunk tail (residual bytes
    after `Done`) to `term.feed`.
  - `mode === 'send'`: not implemented in Phase 8 (Phase 9 scope).
  This is the locked dispatch shape from ARCHITECTURE.md §2.

- **D-06:** **Single-line edit at `serial.js:453`:** `term.feed(value)` →
  `dispatchInbound(value)`. The only hot-path change in any existing file.
  `runReadLoop` continues to call `sampleBellFn() / drainHostReplyFn /
  requestFrameFn / sessionLogRef.append` after `dispatchInbound` — the
  dispatcher shape preserves the post-feed invariant. (Locked by
  ARCHITECTURE.md §2.)

- **D-07:** **In-recv mid-stream wakeup detection is Phase 10's concern,
  not Phase 8's.** During `mode === 'recv'`, all bytes (including any
  spurious `ESC ^ S L I D E`) are forwarded raw to `slide.feed_chunk`.
  Phase 10 will add the idempotent re-entry detector + "Z80 reset
  detected" warning chip (per ROADMAP Phase 10 SC#5). Phase 8 must not
  preemptively implement this — keep `dispatchInbound`'s `'recv'` branch
  as a straight pass-through.

### TX writer ownership handoff (Phase 8 SC#4)

- **D-08:** **`tx-sink.js` gains `setWireOwner(o: 'terminal'|'slide')`
  module state + `writeSlideFrame(bytes: Uint8Array)` export.**
  `pushTxBytes` early-returns when `owner === 'slide'` (silently drops
  keystroke writes during an active SLIDE session — chip messaging like
  "Transfer in progress" is Phase 11's concern). `writeSlideFrame` writes
  directly via the `registeredWriter` reference, bypassing the keystroke
  ring entirely (the ring is for Phase 4 D-15 hex-strip diagnostics, not
  multi-KB binary frames). (Locked by ARCHITECTURE.md §3.)

- **D-09:** **`slide.js` calls `setWireOwner('slide')` immediately after
  successful wakeup match (in the same tick that flips `mode = 'recv'`)
  and `setWireOwner('terminal')` when the SLIDE session reaches
  `Done` or `Error`.** The handoff is synchronous — no race window where
  pushTxBytes could land mid-session. Paste-pump cancellation
  (`pastePump.cancelPaste()`) on session start is **deferred to Phase 11**
  (it's safe to silently drop in-flight paste during Phase 8 because no
  user-visible chip exists yet to explain "transfer in progress").

### Wasm boundary shape (Phase 8 SC#1)

- **D-10:** **`Slide` `#[wasm_bindgen]` struct in `lib.rs:wasm_boundary`,
  sibling to `Terminal`.** Thin façade — every method one-line forwards
  to `crate::slide::Slide`. Mirrors the `Terminal` façade pattern at
  `lib.rs:54-174`. Phase 7's `tests/slide_boundary_shape.rs` already
  pinned the inner Rust API via fn-pointer coercion; Phase 8's `Slide`
  façade exposes `new`, `enter_recv_mode`, `feed_byte`, `feed_chunk`,
  `take_event_packed`, `state`, `outbound_ptr`, `outbound_len`,
  `clear_outbound`, `cancel`, `force_idle`. The full event constants
  (`EVT_NONE` / `EVT_RDY` / `EVT_ACK` / `EVT_NAK` / `EVT_FIN` / `EVT_CAN`
  / `EVT_DATA_FRAME` / `EVT_CRC_ERROR`) are exported as `#[wasm_bindgen]`
  associated constants OR as JS-side mirrored constants in
  `transport/slide.js` — planner picks the cleaner path.

- **D-11:** **Zero-copy egress for `outbound_buf`** mirrors the existing
  `host_reply_ptr/_len/clear_host_reply` triple at `lib.rs:83-95`. JS
  reads `new Uint8Array(wasm.memory.buffer, slide.outbound_ptr(),
  slide.outbound_len())`, slices to a JS-owned buffer (because `await
  writer.write` may straddle wasm memory growth — RESEARCH §pattern 3),
  then calls `slide.clear_outbound()` to ack. (Locked by ARCHITECTURE.md
  §1.)

### Claude's Discretion

The following intentionally remain unlocked at the planning/research stage:

- **Slide wasm-bindgen export surface — Phase 8 minimal vs Phase 9
  anticipation.** Phase 8 only exercises the recv-side path; Phase 9 will
  add `enter_send_mode(metadata)`. Planner may either (a) wrap exactly
  what Phase 8 needs and let Phase 9 amend, or (b) wrap the full
  recv+send surface in Phase 8 with `enter_send_mode` as a stub /
  to-be-extended method. Default: (a) — keep Phase 8 atomic.

- **Slide instance lifecycle.** Per-session `new Slide()` (current Phase 7
  API; old instance dropped after `Done` per `state.rs:128-131`) vs
  adding a `Slide::reset()` method to the Phase 7 module to reuse a
  singleton. Default: per-session `new` (no Rust API expansion); planner
  may revise if benchmarking shows allocation churn.

- **Test strategy mix for SC#1–#5.** Native `cargo test` (extend
  `tests/boundary_api_shape.rs` for `Slide` exports OR new
  `tests/slide_wasm_boundary_shape.rs` mirroring the Phase 7 sibling
  file), `wasm-bindgen-test` for FFI shape, Playwright with the Phase 5
  `navigator.serial` mock (`05-01-PLAN.md` Wave 0 pattern) for full
  dispatcher + wakeup torn-chunk + handoff coverage. Default: cargo
  boundary-shape pin + Playwright dispatcher harness; skip
  `wasm-bindgen-test` unless the boundary shape needs runtime FFI
  verification beyond compile-time fn-pointer coercion.

- **Boot wiring / dispatcher API shape.** Explicit DI
  (`wireSlideDispatcher({ term, getWriter, txSink })` at boot) vs
  module-scope state with imports (matches `paste-pump.js` /
  `scroll-state.js` idiom). Default: module-scope with a `wire()`
  initializer following the codebase grain.

- **`EVT_*` constant exposure.** `#[wasm_bindgen]` associated constants
  on the `Slide` struct vs JS-side mirrored `const EVT_RDY = 1 << 16;`
  in `transport/slide.js`. Planner picks based on which keeps drift risk
  lowest (the boundary-shape pin already constrains the Rust side).

- **Wakeup-matcher backing-buffer location.** Module-scope
  `Uint8Array(6)` allocated once vs per-replay temporary slice. Planner
  picks readable layout; allocation cost is irrelevant at this scale.

- **Test corpus split-points for the 7-byte signature.** All 7 internal
  splits (mirror Phase 1 torn-chunk pattern) is the obvious upper bound;
  planner may choose to also exercise the boundary cases that matter
  most (split between byte 0/1 = `ESC | ^ S L I D E`, split between byte
  6/7 = `ESC ^ S L I D | E`, and a few intermediates). Plus benign
  partial-match cases: `ESC ^ A`, `ESC ^ S L X`, `ESC ESC ^ S L I D E`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` §Current Milestone — v1.1 FileTransfer locked scope
  (Rust core / JS shell split; Z80 PR delivery model; 7-byte wakeup signature
  rationale)
- `.planning/REQUIREMENTS.md` §SLIDE protocol (Phase 8 covers SLIDE-05,
  SLIDE-06, SLIDE-17)
- `.planning/ROADMAP.md` §Phase 8 — goal, dependencies, 5 success criteria

### v1.1 milestone research

- `.planning/research/SUMMARY.md` §3 Architecture Decisions, §5 phase boundaries
- `.planning/research/ARCHITECTURE.md` — **§1 wasm-bindgen façade for SLIDE
  (the Phase 8 wrapping contract); §2 byte-routing dispatch in the read loop;
  §3 TX-sink integration / wire-owner handoff; §9 build orchestration; §10
  Z80 source ownership; Anti-Patterns 1, 2, 4, 5**
- `.planning/research/PITFALLS.md` §1 (chunk-boundary framing — Phase 7's job
  but Phase 8's dispatcher must not subvert it), §2 (`ESC ^` wakeup detection
  across chunk boundaries), §11 (echo of auto-typed `B:SLIDE R\r` confused
  for protocol bytes — flagged for Phase 9/11; Phase 8 must not preempt)
- `.planning/research/STACK.md` §Recommended Stack — Additions (no new JS
  deps; locked)

### Existing project decisions

- `.planning/decisions/ADR-001-parser-strategy.md` — chose `vte = "=0.15"` for
  VT52 parser; relevant because the dispatcher must not break vte's torn-chunk
  invariants when replaying swallowed wakeup-prefix bytes (D-02)
- `.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen attrs gated to
  `target_arch = "wasm32"` only in `lib.rs`; Phase 8's new `Slide` façade lives
  in the same `mod wasm_boundary { ... }` block as `Terminal`
- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — bidirectional
  CAN echo contract; Phase 8 exposes `cancel()` + `force_idle()` across the
  wasm boundary (D-10) so the JS contract (200/500/100/2000 ms windows in
  PITFALLS §5) can be driven from JS in later phases

### Prior phase context (cross-phase consistency)

- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md` —
  Terminal façade shape, zero-copy host_reply pattern, build pipeline (Phase 8
  mirrors all of these for the new `Slide` façade)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` — D-21 writer
  registration + tx-sink coupling (Phase 8 D-08/D-09 extend this contract);
  `navigator.serial` Playwright mock pattern (Phase 8 reuses for dispatcher
  tests); D-20 `pastePumpOnPortLost` symmetric extension pattern (Phase 11
  will mirror as `slidePumpOnPortLost`)
- `.planning/phases/07-slide-rust-core-framer-crc-state-machine/07-CONTEXT.md`
  — every D-* constraint on the Rust `Slide` struct that Phase 8's façade
  wraps; the boundary shape Phase 7 Plan 04 pinned in
  `tests/slide_boundary_shape.rs`

### Existing core crate seams (Phase 8 modifies / honours)

- `crates/bestialitty-core/src/lib.rs:24-191` — `mod wasm_boundary` block;
  Phase 8 adds `Slide` `#[wasm_bindgen]` struct + impl block sibling to the
  existing `Terminal` façade (lines 54-174). The `Terminal` façade pattern is
  the verbatim template.
- `crates/bestialitty-core/src/lib.rs:83-95` — `host_reply_ptr/_len/
  clear_host_reply` zero-copy triple; Phase 8 mirrors as
  `outbound_ptr/_len/clear_outbound` (D-11)
- `crates/bestialitty-core/src/slide/state.rs` — Phase 7 receiver SM; Phase 8
  wraps `Slide::new`, `enter_recv_mode`, `feed_byte`, `feed_chunk`,
  `take_event_packed`, `state`, `outbound_ptr/_len`, `clear_outbound`,
  `cancel`, `force_idle` exactly as pinned by `tests/slide_boundary_shape.rs`
- `crates/bestialitty-core/src/slide/framer.rs` — `EVT_*` constants +
  `CTRL_*` constants; D-10 export decision
- `crates/bestialitty-core/src/vt52.rs:115-141` — `Perform` impl with
  `_ => {}` D-15 silent discard arm. **Confirms `ESC ^` (auto-copy mode) is
  silently swallowed by the existing parser** — load-bearing for D-02/D-03
  (replay-on-fail preserves baseline because baseline is "silently swallow")
- `crates/bestialitty-core/tests/boundary_api_shape.rs` — Phase 2 boundary
  pin pattern; Phase 8 either extends or sibling-mirrors for `Slide`
- `crates/bestialitty-core/tests/slide_boundary_shape.rs` — Phase 7 inner-API
  pin via fn-pointer coercion; Phase 8's wasm façade must not drift from this
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — invariant
  guard; Phase 8 modifies only `lib.rs` (already exempted) — must remain
  green

### Existing JS shell seams (Phase 8 modifies / honours)

- `www/transport/serial.js:444-477` — `runReadLoop`; **single-line edit at
  line 453** (D-06)
- `www/input/tx-sink.js:1-88` — TX ring + writer registration; Phase 8 adds
  `setWireOwner` + `writeSlideFrame` (D-08)
- `www/main.js` — boot wiring; Phase 8 adds `dispatchInbound` ↔ `Slide`
  ↔ `term` ↔ `tx-sink` thread
- `www/pkg/bestialitty_core.js` (regenerated by `scripts/build.sh`) —
  `Slide` import lands here after `wasm-pack build --target web`

### SLIDE upstream protocol & reference impls

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec (Phase 8 does
  not modify protocol behavior; Phase 7 + ADR-003 are the authoritative
  on-wire references)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` — control byte
  constants reference

### Build / test orchestration

- `scripts/build.sh` — `wasm-pack build --target web` driver; Phase 8 rebuild
  produces an updated `www/pkg/bestialitty_core.js` exposing `Slide`
- `scripts/smoke-wasm-build.sh` — Phase 2 pattern for verifying the wasm
  bundle imports cleanly into a fresh harness; Phase 8 may extend with a
  `Slide`-only smoke

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`Terminal` wasm façade pattern** (`lib.rs:54-174`): exact template for
  the new `Slide` façade. One-line forwards to inner methods; zero-copy
  pointer accessors; constructor + lifecycle methods. Phase 8's `Slide`
  façade is mechanical translation.
- **`host_reply_ptr/_len/clear_host_reply` zero-copy triple**
  (`lib.rs:83-95`, `terminal.rs` impl): direct template for `outbound_ptr/
  _len/clear_outbound` — same Vec-with-stable-pointer discipline as Phase 7
  D-17 already mirrors.
- **Phase 5 `navigator.serial` mock** (`tests/serial-mock.js` introduced in
  Plan 05-01): drop-in pattern for Phase 8 dispatcher tests — mock peer
  feeds bytes to the read loop, Playwright asserts `dispatchInbound`
  routing.
- **`paste-pump.js` / `scroll-state.js` module-scope state idiom**:
  template for `slide.js` `mode` + `wakeIdx` + `slide` + `termRef` +
  `writerRef` module variables. Boot-time `wireXxx({...})` initializer
  pattern.
- **Phase 1 torn-chunk corpus pattern** (`tests/torn_chunk.rs`,
  `slide_torn_chunk.rs`): direct template for the wakeup-matcher torn-chunk
  test cases — split the 7-byte signature at every internal offset, plus
  benign-partial cases (`ESC ^ A`, `ESC ^ S L X`, `ESC ESC ^ S L I D E`).
- **`tx-sink.js` writer registration coupling** (`tx-sink.js:78-81`):
  Phase 5 D-21 already routes `pushTxBytes` to `writer.write`. Phase 8's
  `writeSlideFrame` reuses the same `registeredWriter` reference (D-08).

### Established Patterns

- **`#[wasm_bindgen]` attributes only in `lib.rs`** (ADR-002 + Phase 7
  invariant): Phase 8's `Slide` façade fits this rule; the Phase 7 inner
  module stays wasm-free (`tests/core_02_no_browser_deps.rs` already
  asserts).
- **Stable-pointer Vec discipline** (Phase 1 D-17, Phase 7 OUTBOUND_RESERVE
  + `outbound_ptr` stability test): `Slide::outbound_buf` is pre-reserved
  to 16 bytes; clear() preserves capacity; pointer is stable across
  `feed_byte`/`feed_chunk` in steady state. Phase 8's wasm wrapping must
  not allocate over this discipline.
- **Module-scope JS state with `wireXxx({...})` initializers**
  (paste-pump, scroll-state, selection): grain of the existing JS shell.
  No DI framework; main.js calls each module's `wireXxx` once at boot.
- **Single-line hot-path edits in long-lived files** (Phase 5's
  `serial.js` was deliberately built around line 453's `term.feed(value)`
  being the only inbound mutation point): Phase 8's D-06 `term.feed →
  dispatchInbound` is the locked path.
- **Post-feed invariant (Phase 3 + Phase 6)**: `runReadLoop` calls
  `sampleBellFn / drainHostReplyFn / requestFrameFn / sessionLogRef.append`
  after `term.feed`. **`dispatchInbound` must call these too in the
  `'terminal'`-routing branch**, otherwise canvas repaint / bell / host
  reply (ESC Z → ESC / K) regress. Planner must verify the invariant
  carries through the dispatcher.

### Integration Points

- **`crates/bestialitty-core/src/lib.rs`** — add `Slide` `#[wasm_bindgen]`
  struct + impl block; sibling to `Terminal`. Inner field
  `inner: crate::slide::Slide` (note: name collision with the outer
  `Slide` — the `Terminal` façade resolves the same collision via `as
  CoreTerminal` import alias at `lib.rs:39`; Phase 8 mirrors via
  `use crate::slide::Slide as CoreSlide`).
- **`www/transport/slide.js`** (NEW) — exports `dispatchInbound`,
  `wireSlideDispatcher` (or whatever DI shape planner picks per Claude's
  Discretion), and `slidePumpOnPortLost` (stub for Phase 11; export now
  to keep the symbol stable so Phase 11's port-lost wiring is additive).
- **`www/transport/serial.js:453`** — single-line edit (D-06).
- **`www/input/tx-sink.js`** — add `owner` state + `setWireOwner` +
  `writeSlideFrame`; modify `pushTxBytes` to early-return on slide owner.
- **`www/main.js`** — boot wiring: import `Slide` from `./pkg/...`,
  construct, pass to `wireSlideDispatcher` along with `term` ref and
  `tx-sink` ref; replace hot-path `term.feed` reference with
  `dispatchInbound`.
- **`scripts/build.sh`** — no change; `wasm-pack build --target web`
  picks up the new `Slide` exports automatically.
- **`crates/bestialitty-core/tests/`** — Phase 8 either extends
  `boundary_api_shape.rs` for the `Slide` wasm façade OR creates a
  sibling `slide_wasm_boundary_shape.rs`. Planner picks (Claude's
  Discretion).

</code_context>

<specifics>
## Specific Ideas

- **Trace-walk for `ESC ^ S L O P`** (5-byte stream, partial match fails
  at `O`): D-01 + D-02 yield byte-perfect replay to `term.feed` — the
  terminal sees `ESC ^ S L O P` in original order, identical to a SLIDE-
  free build. This is the test corpus's primary "partial-match preserves
  baseline" assertion.
- **`ESC ^ ESC ^ S L I D E`** (mid-prefix retry case): D-02's
  "re-process current failing byte from `wakeIdx === 0`" clause is
  load-bearing — without it the second wakeup is missed. Test corpus
  must cover this.
- **Phase 8 SC#3 test harness drives BOTH cases**: real wakeup detection
  AND benign `ESC ^` non-trigger. The Phase 5 `navigator.serial`
  Playwright mock is the right substrate; cargo tests cover the
  matcher's Rust-free pure-JS logic via a small headless harness if
  planner wants the speed.
- **Phase 8 SC#4 silent drop is non-negotiable**: keystrokes during
  active SLIDE session must not corrupt the wire. The chip messaging
  ("Transfer in progress — cancel first") is Phase 11; Phase 8's gate
  is silent + a documented behavior in the PR description.
- **`Slide` constructor lives in `lib.rs`** sibling to `Terminal::new`;
  the inner-name collision is resolved via `use crate::slide::Slide as
  CoreSlide` (mirrors `use crate::terminal::Terminal as CoreTerminal`
  at `lib.rs:39`).
- **The Phase 7 boundary-shape pin is the contract**: any drift in
  Phase 8's wasm façade against `tests/slide_boundary_shape.rs` (or
  `boundary_api_shape.rs` extension) fails compile. This is the
  deliberate failure mode — wasm-pack errors are cryptic; compile-time
  fn-pointer coercion is not.

</specifics>

<deferred>
## Deferred Ideas

Out of scope for Phase 8; tracked here so they're not lost:

- **Sender-side `enter_send_mode(metadata)`** wasm-bindgen wrapping —
  Phase 9.
- **`www/input/file-source.js` (file picker + drag-drop)** — Phase 9.
- **Auto-typed `B:SLIDE R\r` command + 500 ms swallow-echo filter** —
  Phase 9 (PITFALLS §11) + Phase 11 (Settings + chip).
- **CP/M 8.3 filename uppercase / truncation / character-set validation
  in JS** — Phase 9.
- **Receiver-side per-file Chrome download** (anchor-click +
  `showDirectoryPicker` opt-in fallback + 250 ms inter-file gap) —
  Phase 10.
- **`chunks: Uint8Array[]` + single `new Blob(chunks)` 1 MB receive
  memory pattern** — Phase 10 (PITFALLS §12).
- **`Cancel` chip button + Esc-cancel disambiguation (slot 2 of 4) +
  post-cancel summary chip** — Phase 10 (cancel mechanics) + Phase 11
  (chip UI).
- **Mid-session re-entrant `ESC ^ S L I D E` detection + "Z80 reset
  detected" warning chip** — Phase 10 (SLIDE-34).
- **Floating SLIDE chip at `bottom: 8px; left: 8px` (opposite scrollback
  chip) showing direction + filename + N/M + percent + bytes + 2 s
  sliding-window throughput** — Phase 11 (SLIDE-25/26).
- **Settings auto-send command pref + "show transfer summary chip"
  checkbox + `Compatibility mode` selector** — Phase 11
  (SLIDE-37/39).
- **Session-log pause during active SLIDE session** + **paste-pump
  `slide.isActive()` gate** + **paste-pump.cancelPaste() on session
  start** — Phase 11 (SLIDE-33 + PITFALLS §16/§18).
- **`visibilitychange` listener best-effort CTRL_CAN on tab close** —
  Phase 11 (SLIDE-31).
- **`slidePumpOnPortLost` symmetric to `pastePumpOnPortLost` in
  serial.js teardown / handleReadError / onNavSerialDisconnect** —
  Phase 11 (SLIDE-32). *Note: Phase 8 may export the symbol as a stub
  so Phase 11 wiring is additive.*
- **Auto-type "Z80 didn't respond" timeout chip with [Retry] [Cancel]
  [Force start (legacy slide.com)] options** — Phase 11 (SLIDE-35 +
  PITFALLS §15).
- **Filename collision auto-rename UX, drag-drop pointer-select
  isolation regression, auto-send command safety validation** —
  Phase 12 (SLIDE-12/36/38).
- **`docs/SLIDE_Z80_REQUIREMENT.md` + README "File transfer" section
  + `docs/SLIDE-UAT.md` real-hardware UAT** — Phase 12
  (SLIDE-40/41/42).

</deferred>

---

*Phase: 08-wasm-boundary-js-dispatcher-esc-wakeup*
*Context gathered: 2026-05-07*
