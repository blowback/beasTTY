# Phase 9: SLIDE Sender — Host → Z80 Send - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver host-initiated SLIDE send end-to-end. User picks files (multi-file
`<input type="file" multiple>` picker OR drag-drop onto `#terminal-wrapper`),
BestialiTTY auto-types the configured `B:SLIDE R\r` command, then the Phase 7
SLIDE state machine — extended in Phase 9 with sender-side transitions — frames
and ships the bytes via `await writer.ready` backpressure discipline. Filenames
are uppercased + truncated to CP/M 8.3 + character-set validated in JS before
any frame leaves the wire; the rewrite list is surfaced to the user via an
inline confirm modal before the SLIDE session opens.

**In scope:** new `<button id="send-file-btn">↑ Send file</button>` + hidden
`<input type="file" multiple>` in `#top-bar`; new `www/input/file-source.js`
owning the picker click + drag-drop event lifecycle on `#terminal-wrapper`;
new `<dialog>` element + tiny CSS for the rewrite/rejection confirm modal;
extension to `www/transport/slide.js` adding the `'send'` mode branch in
`dispatchInbound` plus a `pendingSend` queue flag set by `enterSendMode()`
before the wakeup match; extension to `www/input/tx-sink.js` adding a
`writeSlideFrameAwaitable(bytes) -> Promise<void>` Promise-returning sibling
to the existing fire-and-forget `writeSlideFrame`; extension to
`crates/bestialitty-core/src/slide/state.rs` adding `enter_send_mode(metadata: &[u8])`
+ sender-side SM transitions (WaitingRdy → SendingHeader → WaitingHeaderAck →
SendingData → WaitingDataAck → SendingEof → ... → FinPending → Done) +
`feed_send_chunk(payload: &[u8], eof: bool)` API that pushes framed bytes
into `outbound_buf` + sender-side `EVT_FILE_COMPLETE` and `EVT_SESSION_COMPLETE`
event constants (extending the Phase 7 EVT_* namespace); extension to
`crates/bestialitty-core/src/lib.rs:wasm_boundary` Slide façade with the new
methods (one-line forwards); extension to
`crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` and
`tests/slide_boundary_shape.rs` pinning the new fn-pointer surface; native
`cargo test` corpus covering sender-side handshake / window ACK / NAK
retransmit / EOF / mid-send CAN echo per ADR-003 v0.2.1; Playwright dispatcher
+ file-source coverage for SC#1..#5; `window.__slide` introspection accessor
mirroring Phase 8's `window.__slide` precedent so tests assert state transitions
+ progress without a visible chip.

**Out of scope:** floating SLIDE chip at `bottom: 8px; left: 8px` with file
count / percent / bytes / 2-second sliding-window throughput (Phase 11,
SLIDE-25/26); user-visible Cancel button + Esc-key cancel disambiguation +
post-cancel "Cancelled — N of M files transferred" chip + cancellation drain
timing windows (Phase 10, SLIDE-27/28/30); Z80 → PC receive (file Chrome
download, edge cases, memory-bounded reassembly) (Phase 10,
SLIDE-18..24/29/34); rejection chip "Transfer in progress — cancel first" for
drops during active session (Phase 11, SLIDE-11); auto-typed-command
500 ms swallow-echo filter (Phase 11, SLIDE-14); Settings pane row exposing
the auto-send command text input + "show transfer summary chip" checkbox +
`Compatibility mode` selector (Phase 11, SLIDE-37/39); `prefs.js`
`slideAutoSendCommand` field (Phase 11 — Phase 9 hardcodes the default
`B:SLIDE R\r`); session-log pause + paste-pump gate during active SLIDE
session (Phase 11, SLIDE-33); `visibilitychange` best-effort CTRL_CAN
emission on tab close (Phase 11, SLIDE-31); `slidePumpOnPortLost` real
implementation (Phase 11, SLIDE-32 — Phase 8 stub remains a no-op); auto-type
"Z80 didn't respond" timeout chip with `[Retry] [Cancel] [Force start (legacy
slide.com)]` (Phase 11, SLIDE-35); filename collision auto-rename UX
(`NAME.TXT, NAME~1.TXT, NAME~2.TXT`) (Phase 12, SLIDE-36); auto-send command
safety validation (alphanumeric + `:` + `\r` only) + first-use confirmation
chip (Phase 12, SLIDE-38); drag-drop vs pointer-select isolation regression
spec (Phase 12, SLIDE-12); `docs/SLIDE_Z80_REQUIREMENT.md` + README + UAT
docs (Phase 12, SLIDE-40/41/42).

</domain>

<decisions>
## Implementation Decisions

### Send entry points UX (Phase 9 SC#1, SC#2)

- **D-01:** **Top-bar text button `[↑ Send file]`** appended to the existing
  `#top-bar` row alongside `[Connect] [Disconnect] [Download log] [Clear]`.
  Plain Unicode arrow + label, matches the Phase 6 text-button style verbatim;
  zero asset / SVG overhead. A hidden `<input type="file" multiple
  id="send-file-input">` adjacent to the button is triggered by the button's
  click handler. Mirrors SLIDE-07 acceptance: multi-file `<input>` is the
  picker. (Locked.)

- **D-02:** **No keyboard chord in Phase 9.** Top-bar click + drag-drop are
  sufficient. Defer chord introduction to Phase 11/12 if a real workload
  surfaces the need; avoids burning a keystroke on a low-frequency action and
  sidesteps the Ctrl+O browser-reservation footgun. (Locked.)

- **D-03:** **Drag-drop overlay: full-canvas dashed border + ~10% chrome-accent
  tint + centred "Drop file(s) to send via SLIDE".** Overlay is a div parented
  to `#terminal-wrapper` with `position: absolute; inset: 0; pointer-events:
  none;` (so canvas pointer-select keeps working underneath when no drag is
  active). Visibility toggled via `[data-drop-target]` attribute on
  `#terminal-wrapper` matching the existing CSS-attribute idiom (`[data-focused]`
  Phase 3 / `[data-scrolled-back]` Phase 6). Matches SLIDE-09 verbatim. (Locked.)

- **D-04:** **Non-file drag rejection: silent at `dragenter`.** On every
  `dragenter`/`dragover`, check `dataTransfer.types.includes('Files')`; if
  false, never set `data-drop-target` and never `preventDefault()`. The
  user sees nothing — exactly the SLIDE-10 acceptance. No chip flash. (Locked.)

### Filename rewrite & validation surfacing (SLIDE-15, SLIDE-16)

- **D-05:** **Inline `<dialog>` confirm modal showing the rewrite list +
  rejected files before opening the SLIDE session.** Native browser `<dialog>`
  element with `showModal()`; small CSS adopting the Phase 6 chip palette.
  Modal lists each file as either `original.txt → ORIGINAL.TXT` (rewrite)
  or `bad?file.txt — rejected: invalid CP/M character '?'` (rejection).
  Two buttons: `[Cancel]` and `[Send N file(s)]` (label includes the
  surviving count after rejections). If ALL files are rejected, the Send
  button is disabled and the modal copy shifts to "All files rejected — see
  details below." Mirrors SLIDE-15 ("rewrite surfaced") and SLIDE-16
  ("error chip surfaces before session opens") with one shared modal rather
  than two surfaces. (Locked.)

- **D-06:** **CP/M-invalid character set:** `< > , ; : = ? * [ ]` + any
  byte ≥ 0x80 (non-ASCII) + control characters (< 0x20). Authority:
  REQUIREMENTS.md SLIDE-16 + slide-rs `build_header_frame` upstream
  uppercase convention + CP/M 2.2 reference. Validation function
  `validateCpmFilename(name) -> { ok: boolean, reason: string | null }`
  lives in `www/input/file-source.js`. (Locked.)

- **D-07:** **CP/M 8.3 truncation algorithm:** uppercase via
  `String#toUpperCase()`, split on last `.`, truncate base to 8 chars,
  truncate extension to 3 chars. Files with no extension truncate base to 8
  and emit empty extension. Files with leading `.` (dotfiles) treated as
  invalid (no base name). Files with multiple `.` collapse to last-dot split
  (`my.tar.gz → MY.TAR.GZ → MY.TAR`? — answer: split on FINAL dot only,
  yielding base `my.tar` truncated to 8 = `MY.TAR` → final result
  `MY.TAR.GZ` already fits 6+2; if it had been `my.tar.long`, base=`my.tar`,
  ext=`long` → truncate → `MY.TAR.LON`). Mirror of slide-rs/protocol.rs:47-56
  and slide-py uppercase logic. **Multi-file filename collision detection is
  Phase 12 (SLIDE-36)** — Phase 9's modal shows the rewrite list but does
  NOT detect duplicates after truncation. (Locked.)

### Sender state machine (Rust core extension)

- **D-08:** **Rust owns sender SM + frame builder; JS feeds payload chunks.**
  Mirror of Phase 7/8 receiver pattern. New `slide::Slide`
  `enter_send_mode(metadata: &[u8])` API takes a packed metadata blob — the
  sender SM uses the embedded filename + size to build the header frame
  (slide-rs/protocol.rs:47-56 `build_header_frame` shape: null-terminated
  filename + 4-byte little-endian size). `feed_send_chunk(payload: &[u8],
  eof: bool)` API pushes framed bytes into `outbound_buf`. JS drains via
  the existing `outbound_ptr/_len/clear_outbound` triple. NAK retransmit
  lives entirely in the Rust SM (driven by inbound `EVT_NAK` events). **No
  std::time** — SM is purely event-driven; JS owns any timeout windows
  via existing setTimeout patterns. (Locked.)

- **D-09:** **Metadata blob encoding for `enter_send_mode`:** length-prefixed
  records — `<u32 file_count><for each file: u32 name_len, name (utf-8 bytes,
  already uppercase + truncated by JS), u32 size>`. JS-side helper
  `packSendMetadata(files: {name, bytes}[]) -> Uint8Array`. Files MUST already
  be CP/M-validated by JS before this call (Rust trusts the bytes). (Locked.)

- **D-10:** **Sender SM states (extending Phase 7 `SlideState` repr(u32)):**
  ```
  WaitingRdy        = 1   (existing — receiver also uses)
  SendingHeader     = 2   (RENAMED from existing "HeaderPhase" — semantic
                           overlap; receiver-side reuses; Phase 7 already
                           defines as repr(u32) = 2)
  SendingData       = 3   (RENAMED from existing "DataPhase" — same idea)
  FinPending        = 4   (existing)
  CancelPending     = 5   (existing)
  Done              = 6   (existing)
  Error             = 7   (existing)
  ```
  Phase 9 does NOT renumber existing variants; the planner verifies that
  the existing names (`HeaderPhase` / `DataPhase`) read sensibly for both
  send and recv directions. If renaming is required, Phase 9 may rename
  the variants (with corresponding boundary-pin updates) but MUST NOT
  change the `repr(u32)` values — Phase 8's JS-side `STATE_*` constants
  in `transport/slide.js` are already pinned to those values. (Locked.)

- **D-11:** **Sender SM transition table (receiver-mode rules untouched):**
  - `Idle` → `enter_send_mode(metadata)` → `WaitingRdy`
  - `WaitingRdy` (sender role) + outbound CTRL_RDY pushed → on inbound
    `EVT_RDY` → `SendingHeader` + push first header frame onto outbound
  - `SendingHeader` + on inbound `EVT_ACK(0)` → `SendingData` (or
    `FinPending` if file is empty per SLIDE-21)
  - `SendingData` + on `feed_send_chunk(payload, eof=false)` →
    `outbound_buf.extend(build_frame(seq, payload))`, seq++
  - `SendingData` + on `feed_send_chunk(payload, eof=true)` → push final
    frame + push zero-payload EOF frame (slide-rs/recv.rs:172-180 EOF
    marker convention) → state stays `SendingData` waiting for window-ACK
  - `SendingData` + on inbound `EVT_ACK(seq)` where seq matches EOF →
    if more files in metadata: → `SendingHeader` (next file); else
    push CTRL_FIN to outbound → `FinPending`
  - `SendingData` + on inbound `EVT_NAK(seq)` → push retransmit frame
    for seq onto outbound; nak_retry_count++; if > NAK_BUDGET → `Error`
  - any sender state + on inbound `EVT_CAN` → push CTRL_CAN echo →
    `CancelPending` (D-05 strict bidirectional, ADR-003)
  - `FinPending` + on inbound `CTRL_FIN` echo (`EVT_FIN`) → push
    `EVT_SESSION_COMPLETE` → `Done`
  Authority: slide-rs/send.rs:155-249 control-flow shape; slide-rs is the
  byte-for-byte reference for any ambiguity. (Locked.)

- **D-12:** **Sender event additions (extending Phase 7 framer.rs `EVT_*`):**
  ```rust
  pub const EVT_FILE_COMPLETE:    u32 = 8 << 16;   // aux = file_idx
  pub const EVT_SESSION_COMPLETE: u32 = 9 << 16;
  ```
  JS-side mirror in `www/transport/slide.js` extends the existing const
  block. Sender SM emits `EVT_FILE_COMPLETE` after each per-file
  send_data → eof → ack-of-eof; emits `EVT_SESSION_COMPLETE` after FIN
  exchange completes. Boundary-shape pin extended in
  `tests/slide_boundary_shape.rs:slide_event_constants_pinned` AND
  `tests/slide_wasm_boundary_shape.rs`. (Locked.)

### Auto-type flow + dispatcher integration

- **D-13:** **JS auto-types `B:SLIDE R\r` via existing tx-sink path; Phase 8
  wakeup matcher catches Z80's `ESC ^ S L I D E` response and switches into
  `'send'` mode (NOT `'recv'`).** New module-scope flag in
  `www/transport/slide.js` — `pendingSendSession: { metadata, fileBytes[] } |
  null` — set by a new `enterSendMode({ files })` exported function (called
  by `file-source.js` after the user confirms the rewrite modal). The
  dispatcher's wakeup-match completion clause (currently calls
  `enterRecvMode()`) becomes:
  ```
  if (pendingSendSession) {
      enterSendModeInternal(pendingSendSession);
      pendingSendSession = null;
  } else {
      enterRecvMode();
  }
  ```
  Auto-type happens IMMEDIATELY before setting `pendingSendSession`:
  `pushTxBytes(textEncoder.encode(autoSendCommand))` while owner is still
  `'terminal'` (the Phase 8 D-08 owner gate is `'slide'`-only — `'terminal'`
  pushTxBytes is allowed). The 500 ms swallow-echo filter is Phase 11
  (SLIDE-14); Phase 9 ships with visible doubling of the auto-typed command
  in the terminal output (acceptable per the deferred-section pattern in
  08-CONTEXT.md). (Locked.)

- **D-14:** **`prefs.slideAutoSendCommand` is hardcoded to `'B:SLIDE R\r'`
  in Phase 9 — no Settings UI, no prefs key.** Phase 11 introduces both the
  pref key (mirroring `prefs.js` `localEcho` pattern) and the Settings pane
  row (SLIDE-37/39). Phase 9 reads the constant from `transport/slide.js`
  module scope. Empty-string-disables semantic (SLIDE-13 acceptance) is
  realized via `if (autoSendCommand.length === 0) skipAutoType();` —
  Phase 9's hardcoded value never empties, but the code path exists so
  Phase 11 only changes the constant source, not the logic. (Locked.)

- **D-15:** **Send-pending timeout in Phase 9: NONE.** If Z80 never emits
  the wakeup signature (e.g., wrong drive, no slide.com), the `pendingSendSession`
  flag stays set indefinitely and no SLIDE session opens. User recovers by
  reloading the tab or by initiating a fresh send (which overwrites the
  pending flag). The Phase 11 SLIDE-35 chip (`[Retry] [Cancel] [Force start
  (legacy slide.com)]`) is the proper remediation; Phase 9 ships without it
  per the locked deferred-section pattern. The top-bar `[↑ Send file]`
  button is visibly disabled (`(sending…)`) while `pendingSendSession !==
  null` so the user has at least a passive signal that "something is
  waiting." (Locked.)

### Backpressure discipline (Phase 9 SC#5)

- **D-16:** **Extend `tx-sink.js` with `writeSlideFrameAwaitable(bytes:
  Uint8Array): Promise<void>`** — Promise-returning sibling to the existing
  fire-and-forget `writeSlideFrame`. Implementation:
  ```js
  export async function writeSlideFrameAwaitable(bytes) {
      if (!registeredWriter) throw new Error('[tx-sink] no writer registered');
      await registeredWriter.ready;
      await registeredWriter.write(bytes);
  }
  ```
  Mirrors PITFALLS §4 verbatim — `await writer.ready; writer.write(bytes)`
  is the legitimate idiom; chained `await writer.write` without
  `writer.ready` is the banned anti-pattern. The existing fire-and-forget
  `writeSlideFrame` stays for short control-byte writes (CTRL_RDY, CTRL_ACK,
  CTRL_CAN echo) where a 1-byte write barely benefits from `writer.ready`
  gating; the awaitable variant is used by the sender main loop for
  multi-frame data window writes. (Locked.)

- **D-17:** **Sender main-loop drain shape in `slide.js`:**
  ```
  loop {
      const len = slide.outbound_len();
      if (len === 0) break;
      const owned = drainSlideOutboundOwned();
      await txSinkRef.writeSlideFrameAwaitable(owned);
      slide.clear_outbound();
  }
  ```
  Then `feed_send_chunk(nextPayload, isEof)` to push the next frame's bytes
  into `outbound_buf`, then drain again. The Pitfall 5 slice-before-await
  discipline carries through unchanged: `drainSlideOutboundOwned()` returns
  a JS-owned Uint8Array via `view.slice()`, valid across `await
  writer.write` even if wasm memory grows. (Locked.)

### Progress feedback

- **D-18:** **Silent operation; `window.__slide` introspection accessor
  exposes `state, file_idx, total_files, bytes_in_file_done, bytes_in_file_total,
  current_filename`.** Mirrors the Phase 8 `window.__slide` precedent.
  Playwright reads via `await page.evaluate(() => window.__slide.state)`.
  Top-bar `[↑ Send file]` button is visibly disabled (`disabled` attribute
  + label change to `[↑ Send file (sending…)]`) while a session is active;
  re-enabled on `EVT_SESSION_COMPLETE` or `EVT_ERROR` or session abort.
  Phase 11 owns the floating chip (SLIDE-25/26); the introspection hook
  is the Phase 9 verification surface. (Locked.)

### Cancellation handling in send mode

- **D-19:** **Sender SM honours inbound CTRL_CAN per ADR-003 (D-05 strict
  bidirectional).** Receiver-side D-05 already echoes CTRL_CAN on EVT_CAN
  from any non-Done state; sender-side mirror: any sender state + inbound
  `EVT_CAN` → push CTRL_CAN echo to outbound → `CancelPending`. JS
  observes via `take_event_packed()`, calls `setWireOwner('terminal')`,
  resets `mode = 'terminal'`, and console-logs the abort. **No user-visible
  Cancel UI in Phase 9** — Phase 10 owns SLIDE-27 (chip Cancel button +
  Esc key). The Rust SM contract is in place so Phase 10 wiring is
  additive. (Locked.)

- **D-20:** **JS-driven cancel via `slide.cancel()` (Phase 7 D-06) is NOT
  wired to any UI in Phase 9.** The API exists at the wasm boundary
  (Phase 8 D-10) and the receiver-side test corpus exercises it (Phase 7
  Plan 03/04); Phase 9 adds no new entry point. Phase 10 wires the chip
  button + Esc key. (Locked.)

### Claude's Discretion

The following intentionally remain unlocked at the planning/research stage:

- **`<dialog>` modal CSS treatment.** Native `<dialog>` with minimal
  inline-styled chrome vs Phase 6 chip-palette aesthetics vs full-blown
  styled component. Default: minimal `<dialog>` styled like the Phase 6
  scrollback chip but full-width with a `<ul>` of rewrite/rejection rows.
  Planner picks readable layout.

- **`pendingSendSession` queue depth.** Phase 9 default = depth 1 (latest
  user-initiated send wins; second click while pending replaces the queued
  metadata). Planner may revise to "reject second click" if it surfaces
  cleaner test coverage; the user-visible difference is whether the
  second click clobbers or is silently ignored.

- **`SlideState` variant rename (`HeaderPhase` → `SendingHeader`?).**
  D-10 leaves the rename optional. Planner picks based on whether
  receiver-side code reads sensibly with the rename; if the existing
  receiver SM uses `HeaderPhase`/`DataPhase` semantically (it does, see
  Phase 7 state.rs), keeping the names + adding `enter_send_mode`-driven
  role context (via existing `SlideRole`) is the lighter touch.

- **Sender retry budget.** Receiver uses `NAK_BUDGET = 15` per
  slide-rs/recv.rs:142. Sender uses... slide-rs/send.rs:194-208 doesn't
  bound retries; it just retries the window indefinitely on NAK. Phase 9
  may match (no upper bound) or impose a sender-side `SEND_NAK_BUDGET`
  (e.g., 15 to mirror receiver). Default: match slide-rs (no budget) —
  diverging from the reference impl is a planning-time call.

- **Native test corpus split: per-file `slide_send_*.rs` vs extending
  existing `slide_torn_chunk.rs` / `slide_idempotent_reentry.rs` /
  `slide_boundary_shape.rs`.** Phase 7 used both unit `slide/tests.rs` +
  integration `tests/slide_*.rs`. Phase 9 default: new
  `tests/slide_sender.rs` for sender-side end-to-end against a mock
  receiver peer (mirroring the Phase 7 framer torn-chunk corpus pattern);
  unit-test sender SM transitions in `slide/state.rs` `#[cfg(test)] mod
  tests`. Boundary-shape extensions go into the existing two pin files
  (`tests/slide_boundary_shape.rs` for inner Rust API,
  `tests/slide_wasm_boundary_shape.rs` for wasm façade).

- **`#send-file-input` placement in DOM.** Hidden adjacent to the button
  (recommended) vs in `<form>` enclosure vs detached and appended on
  click. Default: hidden adjacent (`<input type="file" multiple hidden>`
  immediately after the button), keep the DOM tree readable.

- **Mock peer for sender Playwright tests.** Reuse the Phase 5
  `navigator.serial` mock (`tests/serial-mock.js` from Plan 05-01)
  extended with a small SLIDE-receiver bot that issues RDY → ACK(0) →
  ACK(seq) per window per slide-rs/recv.rs control flow. Default: extend
  the existing mock; do not introduce a Python subprocess test rig
  (PITFALLS §13 alternative — overkill for Phase 9 tests).

- **`packSendMetadata` location.** `www/input/file-source.js` (close to
  the source) vs `www/transport/slide.js` (close to the consumer of
  `enter_send_mode`). Default: `file-source.js` since it knows the File
  shape; `slide.js` receives a fully-baked `Uint8Array`.

- **Drag-drop overlay z-index.** Default: same z-index as the Phase 6
  scrollback chip; pointer-events: none ensures no click interference.
  Planner picks if visual layering surfaces a conflict.

- **Auto-typed-command echo in terminal.** Phase 9 ships with visible
  doubling per D-13. If the doubling is jarring during Phase 9 manual
  UAT, Claude's discretion is to pull a minimal swallow-echo filter
  forward from Phase 11 (SLIDE-14) — but only if the planner judges the
  pull-forward cost is < 30 lines and doesn't entangle with other
  Phase 11 concerns. Default: ship Phase 9 without the swallow filter.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` §Current Milestone — v1.1 FileTransfer locked scope
  (Rust core / JS shell split; SLIDE owns the wire from `ESC ^` to FIN-FIN;
  Z80 PR delivery model)
- `.planning/REQUIREMENTS.md` §SLIDE host → Z80 send (Phase 9 covers
  SLIDE-07, SLIDE-08, SLIDE-09, SLIDE-10, SLIDE-13, SLIDE-15, SLIDE-16)
- `.planning/ROADMAP.md` §Phase 9 — goal, dependencies, 5 success criteria

### v1.1 milestone research

- `.planning/research/SUMMARY.md` §3 Architecture Decisions, §5 phase boundaries
- `.planning/research/ARCHITECTURE.md` — **§1 wasm-bindgen façade for SLIDE
  (Phase 9 extends with sender-side methods); §2 byte-routing dispatch in
  the read loop (Phase 9 extends `'send'` branch); §3 TX-sink integration /
  wire-owner handoff (Phase 9 extends with `writeSlideFrameAwaitable`); §5
  drag-drop wiring (Phase 9 owns this); §9 build orchestration; Anti-Pattern
  4 (no `std::time` in Rust); Anti-Pattern 5 (multi-KB frames bypass TX ring)**
- `.planning/research/PITFALLS.md` — **§4 backpressure ignored — `writer.ready`
  discipline (BLOCKING; Phase 9's primary correctness gate);** §1 chunk-boundary
  framing (Phase 7's job; Phase 9 must not subvert when sender-mode echoes
  arrive); §3 CRC variant (Phase 7's job; sender uses identical CRC); §5
  cancellation race + ADR-003 amendment (Phase 9 sender SM honours inbound
  CAN echo); §11 echo of auto-typed `B:SLIDE R\r` (Phase 9 ships without
  swallow-echo filter; Phase 11 owns); §15 Z80-side version skew (Phase 9
  ships without fallback chip; Phase 11 owns); §17 auto-send command injection
  (Phase 9 hardcodes default; safety validation Phase 12)
- `.planning/research/STACK.md` §Recommended Stack — Additions (no new
  Rust/JS deps; locked)

### Existing project decisions

- `.planning/decisions/ADR-001-parser-strategy.md` — `vte = "=0.15"` for
  VT52 parser; relevant because the auto-type echo of `B:SLIDE R\r` in
  the terminal feed must not subvert vte's torn-chunk invariants
- `.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen attrs gated
  to `target_arch = "wasm32"` in `lib.rs` only; Phase 9's new
  `enter_send_mode` / `feed_send_chunk` exports live in the same
  `mod wasm_boundary` block as the Phase 8 `Slide` façade
- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — bidirectional
  CTRL_CAN echo contract; Phase 9 sender SM mirrors the receiver-side
  D-05 echo path on inbound `EVT_CAN`; D-19 + D-20 lock this

### Prior phase context (cross-phase consistency)

- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md` —
  Terminal façade shape, zero-copy host_reply pattern, build pipeline (Phase
  9 extends Slide façade with sender methods following the same template)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` — D-21 writer
  registration + tx-sink coupling (Phase 9 D-16 extends with
  `writeSlideFrameAwaitable`); `navigator.serial` Playwright mock pattern
  (Phase 9 reuses + extends with sender-side mock peer)
- `.planning/phases/06-daily-driver-polish-session-deployment/06-CONTEXT.md`
  — top-bar text-button pattern (Download log / Clear; Phase 9 D-01 mirrors
  for `[↑ Send file]`); `[data-scrolled-back]` attribute-driven CSS pattern
  (Phase 9 D-03 mirrors with `[data-drop-target]`); `<dialog>`-shaped modals
  (none yet — Phase 9 introduces this idiom; Phase 12 may extend for
  filename-collision UX SLIDE-36)
- `.planning/phases/07-slide-rust-core-framer-crc-state-machine/07-CONTEXT.md`
  — every D-* constraint on the Rust `Slide` struct that Phase 9 extends;
  EVT_* namespace at framer.rs:31-39 (Phase 9 adds EVT_FILE_COMPLETE +
  EVT_SESSION_COMPLETE); SlideState repr(u32) values pinned by
  `tests/slide_boundary_shape.rs` (Phase 9 must NOT renumber, may rename
  with corresponding pin updates)
- `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-CONTEXT.md`
  — D-01/D-02 wakeup matcher (Phase 9 extends with `pendingSendSession`
  branch in the wakeup-completion clause per D-13); D-08 `setWireOwner` /
  `writeSlideFrame` (Phase 9 D-16 extends with awaitable sibling); D-10
  Slide façade contract (Phase 9 extends with `enter_send_mode` /
  `feed_send_chunk`); D-11 zero-copy outbound drain mirror (Phase 9 reuses
  for sender frame egress); SC#3 in-recv mid-stream wakeup is Phase 10 —
  Phase 9 inherits that scope boundary

### Existing core crate seams (Phase 9 modifies / honours)

- `crates/bestialitty-core/src/slide/state.rs` — Phase 7 receiver SM;
  Phase 9 adds `enter_send_mode(metadata: &[u8])` + sender-mode transitions
  per D-10/D-11; **MUST keep all existing receiver-mode tests green**
- `crates/bestialitty-core/src/slide/framer.rs` — `EVT_*` constants
  (framer.rs:31-39); Phase 9 adds `EVT_FILE_COMPLETE` + `EVT_SESSION_COMPLETE`
  per D-12; **MUST keep all existing const values stable**
- `crates/bestialitty-core/src/slide/mod.rs` — module surface; Phase 9
  re-exports new sender APIs as needed
- `crates/bestialitty-core/src/lib.rs:177-285` — Phase 8 `Slide`
  `#[wasm_bindgen]` façade; Phase 9 adds `enter_send_mode` +
  `feed_send_chunk` one-line forwards sibling to existing `enter_recv_mode`
- `crates/bestialitty-core/tests/slide_boundary_shape.rs` — inner-API pin;
  Phase 9 extends with sender-API fn-pointer coercions + new EVT_*
  constants
- `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — wasm
  façade pin; Phase 9 extends mirroring the inner pin
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — invariant
  guard; Phase 9 modifies only `slide/state.rs` + `slide/framer.rs` +
  `slide/mod.rs` + `lib.rs` — must remain green; **no new `std::time`
  imports per ADR-003 + the test's enforcement**

### Existing JS shell seams (Phase 9 modifies / honours)

- `www/transport/slide.js:1-254` — Phase 8 dispatcher; Phase 9 extends
  the wakeup-completion clause per D-13, adds `'send'` mode dispatch
  branch, adds `enterSendMode({ files })` exported function consumed by
  `file-source.js`, extends EVT_*/STATE_* mirror constants per D-12
- `www/input/tx-sink.js` — Phase 8 `setWireOwner` / `writeSlideFrame` /
  `pushTxBytes` owner gate; Phase 9 adds `writeSlideFrameAwaitable` per
  D-16
- `www/input/keyboard.js` — Phase 4 keymap; Phase 9 does **not** modify
  (no chord per D-02; Phase 10 will add Esc-cancel disambiguation)
- `www/input/selection.js` — Phase 6 pointer-select; Phase 9 does **not**
  modify (drop overlay's `pointer-events: none` keeps coexistence; the
  drag-drop vs pointer-select isolation regression spec is Phase 12
  SLIDE-12)
- `www/input/file-source.js` (NEW) — owns the file-picker `click`
  handler + drag-drop event lifecycle on `#terminal-wrapper` + the
  rewrite/rejection `<dialog>` confirm modal + `validateCpmFilename` /
  `truncateCpm83` / `packSendMetadata` helpers; calls `enterSendMode`
  exported by `transport/slide.js` after user confirms
- `www/main.js:380-403` — Phase 8 `wireSlideDispatcher` boot wiring;
  Phase 9 adds `wireFileSource({ wrapperEl, sendBtn, sendInput })` after
  `wireSlideDispatcher` (file-source's `enterSendMode` reaches the
  already-wired dispatcher); Phase 9 also imports `Slide` for
  `slideCtor` injection (already done in Phase 8 — no change)
- `www/index.html` — Phase 6 top-bar; Phase 9 adds the
  `<button id="send-file-btn">↑ Send file</button>` + adjacent
  `<input type="file" multiple hidden>`, the drop-overlay div parented
  to `#terminal-wrapper`, the rewrite/rejection `<dialog>` element, and
  ~30 lines of CSS for `[data-drop-target]` + dialog chrome
- `www/state/prefs.js` — Phase 6 prefs blob; Phase 9 does **not**
  modify (D-14 — `slideAutoSendCommand` pref key is Phase 11 scope)
- `www/transport/serial.js` — Phase 5 read loop + writer registration;
  Phase 9 does **not** modify the file (the dispatcher integration was
  Phase 8's single-line edit; the writer registration coupling at
  tx-sink is unchanged)
- `www/transport/session-log.js` — Phase 6 session log; Phase 9 does
  **not** modify (session-log pause during SLIDE is Phase 11 SLIDE-33)
- `www/pkg/bestialitty_core.js` — regenerated by `scripts/build.sh`;
  Phase 9's new `Slide.enter_send_mode` / `feed_send_chunk` /
  `EVT_FILE_COMPLETE` / `EVT_SESSION_COMPLETE` exports land here
- `www/renderer/scroll-state.js:194-207` — Phase 6 chip lifecycle
  pattern; Phase 9 does **not** introduce a chip (Phase 11 owns
  SLIDE-25/26); the pattern is documented for Phase 11 reference only

### SLIDE upstream protocol & reference impls

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec
  (Phase 9 sender implements the v0.2 sender-side handshake;
  ADR-003 covers the v0.2.1 CAN amendment)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:33-56` —
  **`build_frame` and `build_header_frame` reference for D-08/D-09**
  (filename + null + LE u32 size encoding; SOF + SEQ + LEN_HI + LEN_LO
  + payload + CRC_HI + CRC_LO frame shape)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/send.rs:155-249` —
  **sender SM control flow reference for D-11** (window-ACK driven
  advance, NAK-driven retransmit, EOF marker, FIN exchange)
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py` — Python ref
  impl (cross-check for ambiguous send-side spec sections)

### Build / test orchestration

- `scripts/build.sh` — `wasm-pack build --target web` driver; Phase 9
  rebuild produces an updated `www/pkg/bestialitty_core.js` exposing
  the new `Slide` send-mode methods
- `scripts/smoke-wasm-build.sh` — Phase 2 smoke pattern; Phase 9 may
  extend to drive a minimal sender-mode happy-path

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 8 `Slide` wasm façade pattern** (`lib.rs:198-285`): exact
  template for adding `enter_send_mode` + `feed_send_chunk` one-line
  forwards. Mechanical extension; the `CoreSlide` import alias at
  lib.rs:39 already resolves the inner-name collision.
- **Phase 8 dispatcher in `transport/slide.js`** (lines 1-254):
  `dispatchInbound`'s wakeup-completion clause at lines 144-162
  becomes the integration point for D-13's `pendingSendSession` branch.
  Module-scope state pattern + `wireXxx({...})` initializer + EVT_*/STATE_*
  mirror constants are all reused.
- **Phase 8 `tx-sink.js` `writeSlideFrame`** (lines 118-126): direct
  template for D-16's `writeSlideFrameAwaitable` — same `registeredWriter`
  reference, same error-log catch pattern, just await-able.
- **Phase 7 receiver SM `slide/state.rs`** (lines 87-309): the sender SM
  mirrors the receiver shape — `outbound_buf` push pattern, `events`
  ring drain, `match (sm_state, evt)` transition table. Phase 9
  extends in-place rather than introducing a parallel struct.
- **Phase 7 framer `slide/framer.rs:33-56` `build_frame` / `build_header_frame`
  upstream references**: SLIDE Rust core's `Framer` already has the bytes
  to build outbound frames; Phase 9 sender SM calls a new
  `framer.build_frame(seq, payload) -> Vec<u8>` helper (or extends with
  a stable-pointer variant if planning surfaces a hot-path concern).
- **Phase 6 top-bar text-button pattern** (`index.html` `#top-bar` row,
  `chrome.js` button event wiring): `[Connect] [Disconnect] [Download log]
  [Clear]` — D-01's `[↑ Send file]` button slots in mechanically.
- **Phase 6 `[data-scrolled-back]` attribute-driven CSS** (`scroll-state.js`):
  D-03's `[data-drop-target]` on `#terminal-wrapper` follows the same
  CSS-attribute idiom; theme-aware via existing `--chrome-accent` and
  alpha-blend conventions.
- **Phase 5 `navigator.serial` Playwright mock** (`tests/serial-mock.js`):
  Phase 9 extends with a small SLIDE-receiver bot that issues RDY → ACK(0)
  → ACK(seq) per window per slide-rs/recv.rs control flow.
- **Phase 5 `runReadLoop` post-feed invariant** (Phase 8 D-06): the
  `dispatchInbound` post-feed sequence (sampleBell → drainHostReply →
  requestFrame → sessionLog.append) carries through Phase 9's `'send'`
  branch unchanged — the sender SM only writes outbound; inbound bytes
  during send are control bytes (RDY/ACK/NAK/CAN/FIN) routed through
  `slide.feed_chunk` exactly like recv mode.
- **Phase 7 stable-pointer Vec discipline** (OUTBOUND_RESERVE = 16,
  Vec::clear preserves capacity): sender frame egress reuses the
  existing `outbound_buf` triple. **NOTE for planner:** sender frames
  are up to FRAME_SIZE+7 = 1031 bytes per frame; 4-frame window =
  ~4 KB of outbound. The current `OUTBOUND_RESERVE = 16` was sized for
  receiver control bytes (RDY/ACK/NAK/CAN/FIN at 1-2 bytes each). Phase 9
  MUST grow `OUTBOUND_RESERVE` (or introduce a sender-specific reserve)
  to match window-size frame egress, and update the stable-pointer
  test in `slide/state.rs:tests::outbound_ptr_stable_across_feed_byte`
  + Phase 7 D-17 mirror.
- **Phase 4 `pushTxBytes` path for `B:SLIDE R\r` auto-type** (D-13):
  the existing `pushTxBytes` plus owner-gate-check (Phase 8 D-08)
  handles auto-type unmodified — owner is `'terminal'` at auto-type
  time; the gate to `'slide'` flips only after the wakeup match (D-13).

### Established Patterns

- **`#[wasm_bindgen]` attributes only in `lib.rs`** (ADR-002): Phase 9's
  `enter_send_mode` / `feed_send_chunk` go in the Phase 8 `Slide` impl
  block in `lib.rs`; the inner methods on `crate::slide::Slide` stay
  wasm-free.
- **No `std::time` in Rust core** (ADR-003 + `tests/core_02_no_browser_deps.rs`
  enforced): sender SM is event-driven; retransmit budget by count, not
  time; JS owns any timeout windows. The `core_02_no_browser_deps.rs`
  test asserts the invariant for the whole crate.
- **Module-scope JS state with `wireXxx({...})` initializers**: Phase 9's
  new `file-source.js` follows the exact pattern of `paste-pump.js`,
  `scroll-state.js`, `slide.js` (Phase 8).
- **Single-line hot-path edits in long-lived files**: Phase 9 touches
  `slide.js` more than a single line (extends the wakeup-completion
  clause with `pendingSendSession` branch + adds the `'send'` mode
  branch in `dispatchInbound`); the existing `serial.js:453` edit from
  Phase 8 stays unchanged.
- **Post-feed invariant** (Phase 3 + Phase 6 + Phase 8 D-06): preserved
  through both `'recv'` and `'send'` dispatcher branches because both
  feed inbound bytes through `slide.feed_chunk` and call the same
  drain-events + drain-outbound sequence.
- **EVT_* JS-side mirror constants** (Phase 8 `slide.js:39-47`): single
  source of truth is `tests/slide_boundary_shape.rs:slide_event_constants_pinned`
  — Phase 9 extends both the Rust EVT_* and the JS mirror in lockstep.

### Integration Points

- **`crates/bestialitty-core/src/slide/state.rs`** — Phase 9 adds
  `enter_send_mode(metadata: &[u8])` method, `feed_send_chunk(payload:
  &[u8], eof: bool)` method, and sender-mode arms in
  `handle_framer_event` (or splits into `handle_recv_event` + new
  `handle_send_event`). MUST keep all existing receiver tests green.
- **`crates/bestialitty-core/src/slide/framer.rs`** — Phase 9 adds
  `EVT_FILE_COMPLETE` + `EVT_SESSION_COMPLETE` constants. May also
  add a sender-side `build_frame_into(buf: &mut Vec<u8>, seq: u8,
  payload: &[u8])` helper if the planner finds the existing
  `build_frame` references in slide-rs prefer an alloc-free path.
- **`crates/bestialitty-core/src/lib.rs:198-285`** — Phase 9 adds
  `enter_send_mode` + `feed_send_chunk` one-line forwards to the
  Phase 8 `Slide` `#[wasm_bindgen]` façade.
- **`crates/bestialitty-core/tests/slide_boundary_shape.rs`** — Phase 9
  extends the fn-pointer pin with new methods + new EVT_* constants.
- **`crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs`** —
  same, for the wasm façade.
- **`www/transport/slide.js`** — Phase 9 extends the wakeup-completion
  clause + `dispatchInbound`'s `'send'` branch + adds `enterSendMode({
  files })` export consumed by `file-source.js`.
- **`www/input/tx-sink.js`** — Phase 9 adds `writeSlideFrameAwaitable`
  per D-16.
- **`www/input/file-source.js`** (NEW) — drag-drop event handlers on
  `#terminal-wrapper`; click handler on `#send-file-btn` triggering
  hidden `<input type="file" multiple>`; CP/M validation +
  truncation + metadata packing; `<dialog>` confirm modal handling.
- **`www/index.html`** — top-bar button + hidden file input; drop
  overlay div + CSS; `<dialog>` element + CSS.
- **`www/main.js`** — Phase 9 adds `wireFileSource({...})` boot wiring
  AFTER the existing `wireSlideDispatcher` call.
- **`scripts/build.sh`** — no change; `wasm-pack build --target web`
  picks up the new exports automatically.

</code_context>

<specifics>
## Specific Ideas

- **Top-bar visual**: `[Connect] [Disconnect] [Download log] [Clear] [↑ Send file]`
  — Unicode arrow + label, mirrors the existing text-button row's typography
  and weight exactly (no SVG, no emoji).
- **Drop overlay copy**: literal string `"Drop file(s) to send via SLIDE"` —
  matches SLIDE-09 acceptance verbatim.
- **`<dialog>` modal copy** (rough draft for planner):
  ```
  ┌────────────────────────────────────────────┐
  │ Sending 3 files via SLIDE                  │
  ├────────────────────────────────────────────┤
  │ • my-doc.txt → MY-DOC.TXT                  │
  │ • REPORT-2024.csv → REPORT-2.CSV           │
  │ • bad?file.txt — rejected: invalid char '?'│
  ├────────────────────────────────────────────┤
  │              [Don't send]  [Send 2 files]  │
  └────────────────────────────────────────────┘
  ```
  Send button label adapts to surviving file count after rejection.
- **`window.__slide` introspection shape** (Phase 9 extension of Phase 8's
  precedent):
  ```js
  window.__slide = {
      mode,                 // 'terminal' | 'recv' | 'send'
      state,                // STATE_* enum value
      file_idx,             // 0-based; -1 in idle/recv
      total_files,          // 0 in idle/recv
      bytes_in_file_done,   // sender progress
      bytes_in_file_total,  // sender progress
      current_filename,     // null in idle
  };
  ```
- **Auto-type byte sequence for `B:SLIDE R\r`**: 10 ASCII bytes via
  `pushTxBytes(new TextEncoder().encode('B:SLIDE R\r'))`. The existing
  `tx-sink.js` ring + writer-registration path handles transmission;
  the Phase 8 owner gate is `'terminal'` at this moment so pushTxBytes
  passes through unmodified. Empty-string-disables semantic is
  realized via `if (cmd.length === 0) skipAutoType()`.
- **Sender SM correctness gate**: Phase 9 SC#5 says "byte-identical
  round-trip" — the Phase 9 cargo test corpus must include a multi-KB
  binary fixture (suggested: ~3 KB of pseudo-random bytes covering 3+
  windows × 4 frames + EOF + FIN) sent through the sender SM against a
  mock receiver bot that validates incoming bytes against the original.
- **PITFALLS §4 explicit ban**: never `await writer.write(bytes)`
  without first awaiting `writer.ready`. Phase 9 D-16's
  `writeSlideFrameAwaitable` is the single legitimate idiom; the
  existing fire-and-forget `writeSlideFrame` is documented as
  "control-byte-only path."
- **Phase 9 ships with visible auto-type echo doubling** in the terminal
  output. This is intentional per D-13 — the swallow-echo filter is a
  Phase 11 concern (SLIDE-14). If manual UAT during Phase 9 finds the
  doubling jarring enough to block, the planner has Claude's discretion
  to pull a minimal swallow filter forward.

</specifics>

<deferred>
## Deferred Ideas

Out of scope for Phase 9; tracked here so they're not lost:

- **Floating SLIDE chip at `bottom: 8px; left: 8px` (file count +
  filename + N/M + percent + 2-second sliding-window throughput)** —
  Phase 11 (SLIDE-25/26).
- **User-visible Cancel button + Esc-key cancel disambiguation (slot 2
  of 4) + post-cancel "Cancelled — N of M files transferred" chip + 200/500/100/2000 ms
  cancel drain timing windows** — Phase 10 (SLIDE-27/28/30).
- **Drops during active SLIDE session rejected with chip "Transfer in
  progress — cancel first"** — Phase 11 (SLIDE-11).
- **Auto-typed `B:SLIDE R\r` 500 ms swallow-echo filter** — Phase 11
  (SLIDE-14 + PITFALLS §11).
- **`prefs.slideAutoSendCommand` pref key + Settings pane row text input
  + "show transfer summary chip" checkbox + `Compatibility mode` selector** —
  Phase 11 (SLIDE-37/39). Phase 9 hardcodes the default.
- **Auto-type "Z80 didn't respond" timeout chip with `[Retry] [Cancel]
  [Force start (legacy slide.com)]` options** — Phase 11 (SLIDE-35 +
  PITFALLS §15). Phase 9 ships without any timeout — `pendingSendSession`
  stays set indefinitely.
- **Z80 → PC receive direction (Chrome download anchor-click +
  `showDirectoryPicker` opt-in fallback + 250 ms inter-file gap; zero-byte
  / sub-frame / binary edge cases; `chunks: Uint8Array[]` + `new Blob(chunks)`
  memory-bounded reassembly)** — Phase 10 (SLIDE-18..24).
- **Mid-session re-entrant `ESC ^ S L I D E` detection + "Z80 reset
  detected; cancelling current transfer" warning chip** — Phase 10
  (SLIDE-34).
- **Session-log pause during active SLIDE session + paste-pump
  `slide.isActive()` gate + `paste-pump.cancelPaste()` on session start** —
  Phase 11 (SLIDE-33 + PITFALLS §16/§18).
- **`visibilitychange` listener best-effort CTRL_CAN on tab close** —
  Phase 11 (SLIDE-31).
- **Real `slidePumpOnPortLost` symmetric to `pastePumpOnPortLost`
  (currently a no-op stub from Phase 8)** — Phase 11 (SLIDE-32).
- **Filename collision auto-rename UX (`NAME.TXT, NAME~1.TXT, NAME~2.TXT`),
  drag-drop pointer-select isolation regression spec, auto-send command
  safety validation (alphanumeric + `:` + `\r` only) + first-use
  confirmation chip** — Phase 12 (SLIDE-12/36/38).
- **`docs/SLIDE_Z80_REQUIREMENT.md` + README "File transfer" section +
  `docs/SLIDE-UAT.md` real-hardware UAT against patched MicroBeast** —
  Phase 12 (SLIDE-40/41/42).

</deferred>

---

*Phase: 09-slide-sender-host-z80-send*
*Context gathered: 2026-05-08*
