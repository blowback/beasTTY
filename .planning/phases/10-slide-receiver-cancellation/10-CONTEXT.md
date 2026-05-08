# Phase 10: SLIDE Receiver & Cancellation - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver Z80 → PC end-to-end receive: the dispatcher hands off to the Phase 7
receiver SM, files are reassembled with bounded memory, each completed file
lands as a Chrome download, and the user can cancel mid-transfer leaving the
wire neutral and recoverable. Cover every edge case (zero-byte, sub-frame,
binary, megabyte-scale, idempotent re-entrant `ESC^SLIDE`) so the receiver
is reliable for daily-driver use.

**In scope:** Rust→JS plumbing to surface received filename + per-frame
payload bytes (receiver SM today ACKs frames but does not expose the bytes
via the wasm boundary); new `www/transport/slide-recv.js` (or extension to
`www/transport/slide.js`) owning the per-file `chunks: Uint8Array[]`
accumulator + `new Blob(chunks)` assembly + Chrome-download dispatch
(anchor-click vs `showDirectoryPicker` per the Settings toggle); new
Settings pane row `[ ] Save received files to a folder` + `[Choose folder…]`
button with `FileSystemDirectoryHandle` persistence to IndexedDB; new
prefs keys `slideRecvToFolder` (boolean) + `slideRecvDirectoryHandle`
(IndexedDB-backed handle); Esc-key SLIDE cancel slot 2/4 in the existing
disambiguation chain (`keyboard.js` lines 202–227); cancellation drain
protocol per PITFALLS §5 (200ms `Promise.allSettled` settle → CTRL_CAN
echo → 500ms Z80-echo wait → 100ms drain → re-arm framer; 2s absolute
timeout triggers `force_idle()` per ADR-003); idempotent re-entrant
`ESC^SLIDE` detection during active recv session (SLIDE-34); hard-fail
recovery on CRC budget exhaustion / port lost / wire desync (SLIDE-29);
edge-case round-trip tests for zero-byte / sub-frame / binary
(`.COM` / `.HEX`) / 1 MB+ files; `window.__slide` introspection
extension for receiver-mode (current_filename, bytes_in_file_done,
bytes_in_file_total); Playwright mock-receiver bot extension (Phase 9's
mock-serial-slide-bot.js gains a sender role).

**Out of scope:** Floating SLIDE chip (`bottom: 8px; left: 8px`) with
file count / percent / bytes / 2-second sliding-window throughput +
post-cancel "Cancelled — N of M files transferred" 5-second auto-hide
chip — Phase 11 (SLIDE-25, SLIDE-26, SLIDE-28); chip Cancel button — Phase
11 (SLIDE-27 chip surface); session-log pause + paste-pump
`slide.isActive()` gate — Phase 11 (SLIDE-33); `visibilitychange`
best-effort CTRL_CAN on tab close — Phase 11 (SLIDE-31); real
`slidePumpOnPortLost` symmetric to `pastePumpOnPortLost` (currently a
no-op stub from Phase 8) — Phase 11 (SLIDE-32); auto-type "Z80 didn't
respond" timeout chip with `[Retry] [Cancel] [Force start]` — Phase
11 (SLIDE-35); auto-send command pref + Settings row — Phase 11
(SLIDE-37, SLIDE-39); send-side filename-collision auto-rename UX
(`NAME~1.TXT` etc.), drag-drop pointer-select isolation regression spec,
auto-send command safety validation — Phase 12 (SLIDE-12, SLIDE-36,
SLIDE-38); `docs/SLIDE_Z80_REQUIREMENT.md` + README + UAT docs — Phase
12 (SLIDE-40, SLIDE-41, SLIDE-42).

</domain>

<decisions>
## Implementation Decisions

### Multi-file download flow

- **D-01: User-controlled "Save received files to a folder" toggle gates
  ALL recv sessions (single file + batch).** Off (default) = always
  anchor-click + 250ms inter-file gap (SLIDE-19 carry-forward). On =
  showDirectoryPicker on first activation; subsequent files write via
  `FileSystemFileHandle.createWritable()`. Single mental model — toggle
  state determines path, file count does not. (Locked.)

- **D-02: Toggle UI lives in the Settings pane as a row + adjacent
  `[Choose folder…]` button.** Mirrors the Phase 4 / Phase 6 Settings-row
  idiom (label + checkbox + optional inline action). New `prefs.js` keys:
  `slideRecvToFolder: false` (boolean default) and
  `slideRecvDirectoryHandle: null` (FileSystemDirectoryHandle, persisted
  to IndexedDB — NOT to `localStorage`, which can't store the handle).
  Pulls one Settings row forward from Phase 11; the rest of the SLIDE
  Settings block (auto-send command text input, show-summary checkbox,
  Compatibility-mode selector — SLIDE-37/39) stays Phase 11. (Locked.)

- **D-03: Directory persists across page reloads via IndexedDB.** Store
  the FileSystemDirectoryHandle (which is structuredClone-compatible per
  the File System Access API spec) in an IndexedDB object store created
  by the prefs subsystem. On reload, re-request permission via
  `handle.requestPermission({ mode: 'readwrite' })` — Chrome shows a
  one-click "Allow" dialog for previously-granted handles; if denied,
  treat as off (toggle stays on but next file falls through to
  anchor-click and the "Choose folder…" button re-arms). Pulls IndexedDB
  into v1.1 — currently unused; the planner sizes the surface area
  (suggest: a tiny `www/state/idb.js` module exposing
  `getRecvDirHandle()` / `setRecvDirHandle(handle)`). (Locked.)

- **D-04: Picker dismissal during a session falls back to anchor-click
  for the remainder of that session; toggle stays on; no re-prompt.**
  If the user cancels the showDirectoryPicker (or denies permission on
  reload), continue the in-flight transfer using the anchor-click
  fallback path. Do not emit CTRL_CAN. Do not re-prompt the picker on
  the next file boundary. The Settings toggle remains "on" — next recv
  session re-attempts the picker. (Locked.)

- **D-05: Filename collision policy: append `~N` suffix
  (`REPORT.TXT → REPORT~1.TXT → REPORT~2.TXT → …`).** Mirrors the Phase
  12 SLIDE-36 send-side auto-rename convention for visual / behavioral
  consistency across send and recv collision UX. Algorithm: try
  base name verbatim → on `FileSystemDirectoryHandle.getFileHandle({
  create: false })` resolving (file exists) → bump suffix → retry.
  Insertion point: between base and last `.` (so `REPORT.TXT` →
  `REPORT~1.TXT`, `NOEXT` → `NOEXT~1`, `MY.TAR.GZ` → `MY.TAR~1.GZ`).
  (Locked.)

- **D-06: Suffix retry budget: keep going up to `~999` then fall
  through to anchor-click for that single file.** A `~999` collision
  count is implausible in any real workflow but provides a hard ceiling
  so the loop can't run forever on a hostile filesystem. After 999
  failures, route the offending file through the anchor-click path
  (the file still lands in the user's downloads folder, not their
  chosen recv folder); subsequent files in the same batch continue
  attempting the directory path normally. (Locked.)

- **D-07: SLIDE-20 acceptance ("Received files retain their CP/M 8.3
  uppercase names verbatim") is annotated with a collision-exception
  clause.** Verbatim applies when the target name does not collide.
  On collision, the `~N` suffix is the lesser evil vs silent
  overwrite (data loss) or skip-and-warn (broken UX without the Phase
  11 chip). The planner adds a one-line note to REQUIREMENTS.md
  SLIDE-20 referencing this CONTEXT decision so later auditors
  understand the divergence. (Locked.)

### Carry-forward (locked from prior context, not re-asked)

- **C-01:** Anchor-click + 250ms inter-file gap is the toggle-OFF /
  fallback download path. SLIDE-19. Mirror of Phase 6 session-log
  download anchor pattern.
- **C-02:** `chunks: Uint8Array[]` + `new Blob(chunks, { type:
  'application/octet-stream' })` for memory-bounded per-file
  reassembly. SLIDE-24 + Phase 6 session-log mirror.
- **C-03:** Bidirectional CTRL_CAN echo + `force_idle()` 2-second
  escape hatch per ADR-003. Receiver SM already implements
  CancelPending semantics (Phase 7 D-05/D-06/D-07).
- **C-04:** 7-byte `ESC ^ S L I D E` wakeup signature per Phase 8 D-01.
- **C-05:** Per-session `new Slide()` lifecycle; no singleton reset
  optimization (Phase 8 dispatcher pattern).
- **C-06:** No floating SLIDE chip in Phase 10; tests assert progress
  via `window.__slide` introspection (Phase 9 D-18 precedent).
- **C-07:** No `std::time` in Rust core (ADR-003 + ADR-002 +
  `tests/core_02_no_browser_deps.rs`). All cancel timing windows
  live in JS.

### Claude's Discretion

The following remain unlocked at the planning stage; the planner picks
based on research + codebase fit:

- **Recv data API shape (Rust → JS surfacing of filename + per-frame
  payload bytes).** The receiver SM today consumes header / data frames
  and pushes ACK bytes onto `outbound_buf`, but does not surface the
  received payload to JS. Three options for the planner:
  (a) New events `EVT_HEADER_RECEIVED` (aux = file_idx; JS reads
  filename via a new `take_recv_metadata()` accessor) +
  `EVT_DATA_RECEIVED` (aux = seq; JS reads bytes via a new
  `take_recv_payload()` accessor) — symmetric to the existing
  `EVT_DATA_FRAME` packing convention.
  (b) `recv_ptr() / recv_len() / clear_recv()` accessor triple
  mirroring the existing `outbound_ptr/_len/clear_outbound` triple
  (zero-copy view; per-frame; JS slices before await per Pitfall 5).
  (c) Hybrid: `EVT_FILE_COMPLETE` event (mirror of Phase 9 sender-side)
  with a `take_recv_blob()` returning the assembled Uint8Array per
  file. Defers chunk accumulation to Rust.
  Default expectation: option (b) for symmetry with the proven
  outbound triple, plus a new `EVT_HEADER_RECEIVED` event so JS
  knows when the filename is available. Researcher confirms via
  slide-rs/recv.rs:172-180 (EOF marker convention) and the Phase 7
  state.rs:480-547 receive arms.

- **Mid-session re-entrant `ESC^SLIDE` detection (SLIDE-34).** Two
  options:
  (a) JS-side wakeup matcher in `dispatchRecvMode` running in parallel
  with the framer feed (mirror of `dispatchTerminalMode`'s 7-byte
  wakeup matcher in `transport/slide.js:229-310`). On match: emit a
  console warning ("Z80 reset detected"), call `slide.force_idle()`,
  exit recv mode, then re-enter via `enterRecvMode()`. Phase 11 wires
  the visible chip.
  (b) Rust framer extension: detect `ESC^SLIDE` inside the framer's
  byte-fed state machine; emit a new `EVT_REENTRY_DETECTED` event;
  state.rs handles by transitioning to a new `Reentering` state that
  re-arms cleanly.
  Default: option (a). The dispatcher already has the matcher logic
  for terminal-mode entry; reusing it in recv-mode is ~20 LOC and
  keeps the Rust SM agnostic to wakeup semantics (which are a JS
  dispatch-layer concern per ARCHITECTURE.md §2 byte-routing).

- **Cancel UX in Phase 10 (pre-chip).** Phase 11 owns the floating
  chip with the visible Cancel button. Phase 10 ships with:
  (a) Esc-key cancel only (slot 2/4 in the existing disambiguation
  chain — see "Esc disambiguation slot" below);
  (b) `window.__slide.cancelRecv()` programmatic accessor for
  Playwright assertions.
  No top-bar button. The `[↑ Send file]` (Phase 9) button stays the
  only top-bar SLIDE control. Default: ship Phase 10 with Esc-only;
  the absence of a visible Cancel button during recv is acceptable
  per the deferred-section pattern (Phase 11 SLIDE-27 lands the chip).

- **Esc disambiguation slot for SLIDE-cancel.** Per ROADMAP Phase 10
  goal text "Esc key (slot 2 of 4)". The current chain in
  `www/input/keyboard.js:202-227` is: 1) selection drag cancel, 2)
  paste cancel, 3) encode 0x1B to remote. Phase 10 inserts SLIDE
  cancel as new slot 2, pushing paste to slot 3 and 0x1B to slot 4:
  ```
  1. Ctrl+Shift+Esc — clear selection (existing)
  2. Esc + selection-dragging  → cancel selection drag (existing)
  3. Esc + slide.isActive()    → cancel SLIDE session (NEW)
  4. Esc + pastePump.isActive  → cancel paste (existing, was slot 3)
  5. Esc fallthrough           → encode 0x1B (existing, was slot 4)
  ```
  Default: this insertion order. Researcher / planner verifies the
  guard ordering keeps every existing UAT path green.

- **Cancel timing windows.** PITFALLS §5 + ADR-003 specify:
  - 200ms `Promise.allSettled()` for in-flight `writer.write` settle
  - CTRL_CAN echo via `tx-sink.writeSlideFrame` (single byte 0x18)
  - 500ms wait for Z80 CTRL_CAN echo
  - 100ms drain window (continue `reader.read` + `slide.feed_chunk`
    but events ignored — silent drain in CancelPending state per
    state.rs:284 D-07 implementation)
  - 2000ms absolute timeout → `slide.force_idle()` (escape hatch
    per ADR-003 Decision §3)
  Default: ship these values verbatim. Researcher / planner has
  Claude's Discretion to widen any window if real-hardware UAT
  during Phase 12 surfaces a slow-Z80 case.

- **Hard-fail recovery (SLIDE-29).** Three failure modes converge:
  (1) NAK_BUDGET exhausted → SM transitions to `SlideState::Error`
  (Phase 7 state.rs:392-406 + state.rs:540-543);
  (2) port lost → `slidePumpOnPortLost` from Phase 8 stub (currently
  no-op) gains a real implementation that calls `slide.force_idle()`
  + emits a console warning;
  (3) wire desync (e.g., framer in mid-byte when CAN arrives) →
  CancelPending silent-drain handles this in Rust (D-07 implementation).
  All three converge on: exit recv mode, set wire owner back to
  'terminal', console.error the failure mode, leave the door open
  for a fresh recv session via the next wakeup. Phase 11 attaches
  the visible chip with the "Retry" hint (SLIDE-29 chip surface).

- **Receiver test mock — extension to Phase 9's
  `tests/mock-serial-slide-bot.js`.** The Phase 9 bot acts as a SLIDE
  *receiver* against BestialiTTY's *sender*. Phase 10 needs the
  inverse: the bot acts as a *sender*, BestialiTTY is *receiver*.
  Default: extend the same file (single bot module with a `role`
  parameter — `'recv'` or `'send'`); add a sender-role state machine
  that issues RDY → header frame → data frames → EOF → FIN per
  slide-rs/send.rs:155-249. PITFALLS §13 three-way drift detection
  remains active (production Rust SM ↔ Phase 9 mock-receiver-bot
  ↔ Phase 10 mock-sender-bot — all CRC-validated).

- **`www/transport/slide-recv.js` vs in-place extension to
  `www/transport/slide.js`.** The Phase 8 dispatcher
  (`transport/slide.js`) is already 670+ LOC after Phase 9. Phase 10
  could:
  (a) Extend `slide.js` further with recv-mode plumbing (filename
  pump, chunks accumulator, download dispatch);
  (b) Split out a sibling `slide-recv.js` (dispatcher imports +
  delegates) for clarity.
  Default: option (b). The dispatcher should remain the byte-routing
  + mode-state authority; per-mode I/O lives in sibling files
  (analog to `paste-pump.js` vs `tx-sink.js`).

- **prefs.js key naming + IndexedDB store layout.** Default:
  `slideRecvToFolder: false` (boolean, in DEFAULTS), and
  `slideRecvDirectoryHandle` lives in IndexedDB under store
  `bestialitty-handles` key `recv_directory` (NOT in DEFAULTS, NOT
  in the structuredClone-versioned blob — handles can't roundtrip
  through JSON). Planner picks the exact store/key names + version
  number for the IndexedDB schema.

- **Suffix-insertion algorithm precise spec.** Default: split on
  last `.`; insert `~N` immediately before the last dot; if no dot
  in name, append `~N` at end. Edge cases (planner finalises):
  empty extension (`REPORT.` → `REPORT~1.`), only-extension
  (`.PROFILE` is invalid CP/M anyway, defer), pre-existing tilde in
  source name (`MY~FILE.TXT` → `MY~FILE~1.TXT` — accept the visual
  oddity; CP/M filenames don't normally include `~`).

- **Per-frame download trigger timing (anchor-click path).** When
  is the Blob assembled and the anchor-click fired?
  Default: at EOF data frame ACK (after the SM transitions
  `DataPhase → HeaderPhase` for the next file, or `→ Done` if last
  file). The Blob is constructed once from the accumulated
  `chunks: Uint8Array[]`, the anchor-click fires synchronously,
  and the chunks array is reset for the next file. The 250ms gap
  is enforced via a JS-side `setTimeout` between consecutive
  `<a>.click()` calls.

- **Edge-case test corpus.** Default: extend
  `crates/bestialitty-core/tests/slide_torn_chunk.rs` with
  zero-byte / sub-frame / binary fixtures driven through the
  receiver SM in native cargo test; add Playwright specs
  (`slide-recv.spec.js` + `slide-cancel.spec.js`) for end-to-end
  download + cancel coverage. 1 MB+ memory smoke test in Playwright
  asserts no O(n²) growth via `performance.memory.usedJSHeapSize`
  delta sampling (mirror of Phase 6 SOAK pattern at coarse
  granularity — the full 24-h memory soak is Phase 6's).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` §Current Milestone — v1.1 FileTransfer locked
  scope (Z80 → PC receive, anchor-click + showDirectoryPicker opt-in
  fallback, terminal parser fully suspended during SLIDE session)
- `.planning/REQUIREMENTS.md` §SLIDE Z80 → PC receive (Phase 10 covers
  SLIDE-18, SLIDE-19, SLIDE-20, SLIDE-21, SLIDE-22, SLIDE-23, SLIDE-24,
  SLIDE-27, SLIDE-29, SLIDE-30, SLIDE-34)
- `.planning/ROADMAP.md` §Phase 10 — goal, dependencies, 5 success
  criteria

### v1.1 milestone research

- `.planning/research/SUMMARY.md` §3 Architecture Decisions, §4 BLOCKING
  pitfalls (P5 cancellation race, P10 download throttle, P12 memory),
  §5 phase boundaries, §6 OQ-3 (download throttle resolution — locked
  to anchor-click + showDirectoryPicker opt-in)
- `.planning/research/ARCHITECTURE.md` — **§1 wasm-bindgen façade for
  Slide (Phase 10 extends with recv-mode payload accessors); §2
  byte-routing dispatch in the read loop (Phase 10 extends `dispatchRecvMode`
  with mid-session re-entry detection); §3 TX-sink integration / wire-owner
  handoff (Phase 10 reuses for cancel echo); §7 cancellation propagation;
  §9 build orchestration; Anti-Pattern 4 (no `std::time` in Rust)**
- `.planning/research/PITFALLS.md` — **§5 cancellation race + ADR-003
  amendment (BLOCKING; Phase 10's primary correctness gate);** §9
  re-entrant `ESC^` mid-session (HIGH; SLIDE-34); §10 Chrome download
  throttling (HIGH; resolved via showDirectoryPicker opt-in);
  §12 memory growth on large file receive (MEDIUM; `chunks:
  Uint8Array[]` + Blob); §6 tab close mid-transfer (HIGH; Phase 11
  scope but Phase 10's cancel API is the foundation); §16 SLIDE bytes
  in session log (LOW; Phase 11 owns the pause)
- `.planning/research/STACK.md` §Recommended Stack — Additions (no
  new Rust/JS deps; File System Access API is built-in to
  Chromium 86+, well below Web Serial's 89+ floor)

### Existing project decisions

- `.planning/decisions/ADR-001-parser-strategy.md` — `vte = "=0.15"`;
  irrelevant to Phase 10's recv path but locked context for the
  whole codebase
- `.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen attrs
  gated to `target_arch = "wasm32"` in `lib.rs` only; Phase 10's
  new recv-payload accessors live in the same `mod wasm_boundary`
  block as Phase 8/9 Slide façade methods
- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` —
  **bidirectional CTRL_CAN echo contract; idempotent `cancel()` /
  `force_idle()` API; CancelPending silent-drain semantics. Phase 10
  is the consumer of every clause in this ADR.**

### Prior phase context (cross-phase consistency)

- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` — D-21
  writer registration + tx-sink coupling (Phase 10 reuses for
  CTRL_CAN echo write); D-18 Esc-cancel paste-pump priority (Phase 10
  inserts SLIDE-cancel as new slot 2, pushing paste to slot 3); the
  port-lost handler shape (Phase 10 wires real `slidePumpOnPortLost`
  vs Phase 8 stub)
- `.planning/phases/06-daily-driver-polish-session-deployment/06-CONTEXT.md`
  — D-31 session-log download anchor-click pattern (Phase 10's per-file
  download mirror); `chunks: Uint8Array[]` + Blob memory pattern
  (Phase 10 reuses verbatim per SLIDE-24); top-bar text-button row
  (Phase 10 does NOT add a button — chip is Phase 11)
- `.planning/phases/07-slide-rust-core-framer-crc-state-machine/07-CONTEXT.md`
  — **D-05/D-06/D-07 cancel semantics (already implemented in
  state.rs); D-08 ADR-003 deliverable; receiver SM transition table
  (state.rs:466-555) is the contract Phase 10 extends with payload
  accessors**
- `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-CONTEXT.md`
  — D-01/D-02 wakeup matcher (Phase 10 reuses pattern for mid-session
  re-entry detection per SLIDE-34); D-08 `setWireOwner` contract
  (Phase 10 calls `setWireOwner('terminal')` after recv exit); D-10
  Slide façade contract (Phase 10 extends with `take_recv_payload` /
  `take_recv_metadata` or `recv_ptr/_len/clear_recv` triple); D-11
  zero-copy outbound drain mirror (Phase 10's recv accessors mirror
  the same triple convention if option (b) is chosen); SC#3 in-recv
  mid-stream wakeup explicitly deferred to Phase 10
- `.planning/phases/09-slide-sender-host-z80-send/09-CONTEXT.md` —
  D-12 EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE (Phase 10 reuses
  the receiver-side equivalents — same constants apply or get
  named EVT_RECV_FILE_COMPLETE if the planner judges the
  send/recv overload confusing); D-16 `writeSlideFrameAwaitable`
  (Phase 10's CTRL_CAN echo uses the existing fire-and-forget
  `writeSlideFrame` since CAN is a 1-byte control write); D-18
  `window.__slide` introspection shape (Phase 10 extends with
  receiver-mode fields: `current_filename`, `bytes_in_file_done`,
  `bytes_in_file_total`); the Phase 9 mock-serial-slide-bot.js
  (Phase 10 extends with a sender role)

### Existing core crate seams (Phase 10 modifies / honours)

- `crates/bestialitty-core/src/slide/state.rs:466-555` — Phase 7
  receiver SM transition arms (`WaitingRdy → HeaderPhase → DataPhase
  → HeaderPhase`/`Done`). Phase 10 adds payload-extraction accessors
  + EVT_HEADER_RECEIVED / EVT_RECV_DATA emit calls (or recv buffer
  push) after the existing ACK pushes. **MUST NOT change existing
  ACK/NAK timing or counts** — Phase 7 native cargo tests pin those.
- `crates/bestialitty-core/src/slide/state.rs:284-303` —
  CancelPending silent-drain implementation; Phase 10 verifies it
  handles the post-CTRL_CAN-echo drain window correctly (no events
  emitted while in CancelPending; only CTRL_CAN echo wakes us)
- `crates/bestialitty-core/src/slide/state.rs:329-360` — `cancel()`
  + `force_idle()` API; Phase 10 calls these from the JS cancel path
- `crates/bestialitty-core/src/slide/framer.rs:31-48` — `EVT_*`
  constants; Phase 10 adds receive-side events as needed (planner
  picks naming) and extends both boundary-shape pin files
- `crates/bestialitty-core/src/lib.rs` — Slide `#[wasm_bindgen]`
  façade; Phase 10 adds one-line forwards for new recv-payload
  accessors (mirror of the Phase 8/9 send-side extension pattern)
- `crates/bestialitty-core/tests/slide_boundary_shape.rs` +
  `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` —
  Phase 10 extends both with the new recv-mode fn-pointer pins +
  any new EVT_* constants
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` —
  invariant guard; Phase 10 modifies only `slide/` + `lib.rs` —
  must remain green; **no new `std::time` imports**

### Existing JS shell seams (Phase 10 modifies / honours)

- `www/transport/slide.js:1-672` — Phase 8/9 dispatcher; Phase 10
  extends `dispatchRecvMode` (currently a 5-line straight-pass
  function at lines 313-317) with mid-session re-entry detection +
  per-frame payload extraction calls (or delegates payload handling
  to a new sibling `slide-recv.js` per Claude's Discretion default)
- `www/transport/slide-recv.js` (NEW, recommended) — owns the
  `chunks: Uint8Array[]` accumulator per file; the
  `assembleAndDownloadFile(filename, chunks)` dispatch (anchor-click
  vs `FileSystemFileHandle.createWritable()` based on
  `prefs.slideRecvToFolder`); the 250ms inter-file gap enforcement;
  the suffix-collision retry loop
- `www/state/prefs.js` — Phase 6 prefs blob; Phase 10 adds
  `slideRecvToFolder: false` to DEFAULTS; `slideRecvDirectoryHandle`
  is NOT in the JSON-stringified blob (it's a FileSystemDirectoryHandle
  which can't JSON-roundtrip)
- `www/state/idb.js` (NEW, recommended) — IndexedDB-backed handle
  store; ~30 lines exposing `getRecvDirHandle()` + `setRecvDirHandle(handle)`
- `www/input/keyboard.js:202-227` — Esc disambiguation chain;
  Phase 10 inserts SLIDE-cancel as new slot 2 (pushing paste to slot
  3 and 0x1B to slot 4)
- `www/input/tx-sink.js` — Phase 8 `setWireOwner` / `writeSlideFrame`;
  Phase 10 reuses both unmodified (`writeSlideFrame` is the
  legitimate path for the 1-byte CTRL_CAN echo)
- `www/main.js` — Phase 8/9 boot wiring; Phase 10 adds
  `wireSlideRecv({ wrapperEl, prefs, idb })` after `wireSlideDispatcher`
- `www/index.html` — Phase 4 Settings pane; Phase 10 adds the
  `[ ] Save received files to a folder` row + `[Choose folder…]`
  button + ~10 lines of CSS
- `www/renderer/scroll-state.js:194-207` — Phase 6 chip lifecycle
  pattern; Phase 10 does **not** introduce a chip (Phase 11 owns
  SLIDE-25/26/28); pattern documented for Phase 11 reference
- `www/transport/serial.js` — Phase 5 read loop; Phase 10 does **not**
  modify (the dispatcher integration was Phase 8's single-line edit
  at line 453; the dispatcher routes to `dispatchRecvMode` which is
  where Phase 10 work lands)
- `www/transport/session-log.js` — Phase 6 session log; Phase 10
  does **not** modify (session-log pause during SLIDE is Phase 11
  SLIDE-33)

### SLIDE upstream protocol & reference impls

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec
  (Phase 10 receiver implements the v0.2 receive-side handshake;
  ADR-003 covers the v0.2.1 CAN amendment)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` —
  reference impl (CRC, frame builder, `recv_control` single-byte
  CAN consumption at line 104)
- **`/home/ant/src/microbeast/SLIDE/slide-rs/src/recv.rs:172-180`** —
  EOF marker convention (zero-payload data frame); Phase 10's
  per-file boundary detection
- **`/home/ant/src/microbeast/SLIDE/slide-rs/src/recv.rs:206-212`** —
  per-window ACK timing (every WIN_SIZE=4 frames); already
  implemented in state.rs:521-535
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py:64-71` —
  Python ref impl single-byte CAN consumption (cross-validation)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:47-56` —
  `build_header_frame` — null-terminated filename + 4-byte
  little-endian size; Phase 10 parses this same shape on receive

### Browser API references

- File System Access API — `showDirectoryPicker`,
  `FileSystemDirectoryHandle.getFileHandle({ create: true })`,
  `FileSystemFileHandle.createWritable()`,
  `handle.requestPermission({ mode: 'readwrite' })`. Chromium-only;
  aligns with v1.0 Chromium-only stance
- IndexedDB — `FileSystemDirectoryHandle` is structuredClone-compatible
  per spec; survives `IDBObjectStore.put`. Re-permission required on
  next page load; Chrome shows one-click Allow for previously-granted
  handles
- Anchor-click download convention — `URL.createObjectURL(blob)` +
  synthetic `<a download="NAME">.click()` + `URL.revokeObjectURL`
  (mirror of `www/transport/session-log.js` Phase 6 implementation)

### Build / test orchestration

- `scripts/build.sh` — `wasm-pack build --target web` driver; Phase 10
  rebuild produces an updated `www/pkg/bestialitty_core.js` exposing
  the new recv-mode `Slide` accessors / events
- `crates/bestialitty-core/tests/slide_torn_chunk.rs` — Phase 7
  torn-chunk corpus; Phase 10 extends with zero-byte / sub-frame /
  binary / 1MB+ fixtures
- `www/tests/mock-serial-slide-bot.js` — Phase 9 mock; Phase 10
  extends with a sender role for end-to-end recv tests
- Hard-reload requirement (Ctrl+Shift+R) for picking up new wasm
  exports per `MEMORY.md` `project_wasm_cache_workflow`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 7 receiver SM** (`crates/bestialitty-core/src/slide/state.rs:466-555`):
  Already handles RDY → HeaderPhase → DataPhase → HeaderPhase / Done
  transitions, per-window ACKs, NAK retransmit budget, CancelPending
  silent-drain. Phase 10 wires the byte-extraction layer ON TOP OF
  this contract — no SM logic changes required for the basic recv path.
- **Phase 7 framer `take_payload()`** (`slide/framer.rs`): Phase 10's
  recv-payload accessor calls into this existing function (or surfaces
  it via the wasm boundary if option (b) is chosen).
- **Phase 8 dispatcher matcher state** (`transport/slide.js:229-310`):
  exact template for D-08 / mid-session re-entry detection — same
  WAKEUP signature, same wakeIdx counter, same scratch buffer pattern.
  Phase 10 either reuses inline in `dispatchRecvMode` or extracts
  to a shared `wakeupMatcher.js` helper.
- **Phase 8 zero-copy outbound triple** (`outbound_ptr / outbound_len
  / clear_outbound`): Phase 10's recv-payload accessor (option (b))
  mirrors this exact triple, including the Pitfall 4 memory-growth
  re-derive guard at `slide.js:335-337` and the Pitfall 5
  slice-before-await discipline at `slide.js:341`.
- **Phase 6 session-log download anchor pattern** (`transport/session-log.js`):
  the toggle-OFF / fallback path uses this verbatim — `URL.createObjectURL`,
  synthetic `<a>.click()`, revoke after click. Phase 10's per-file download
  is structurally identical, just driven once per file rather than once per
  user-Download-button click.
- **Phase 6 `chunks: Uint8Array[]` accumulator** (`transport/session-log.js`):
  the per-file recv accumulator is a direct mirror — append by reference
  on each frame, materialise Blob at EOF.
- **Phase 5 Esc-cancel chain** (`input/keyboard.js:202-227`): Phase 10's
  SLIDE-cancel arm slots in as new step 3 in the existing
  selection-cancel → paste-cancel → 0x1B chain.
- **Phase 9 `window.__slide` introspection** (`transport/slide.js:201-225`):
  Phase 10 extends the same accessor shape with receiver-mode fields
  (`current_filename`, `bytes_in_file_done`, `bytes_in_file_total`).
- **Phase 9 mock-serial-slide-bot** (`www/tests/mock-serial-slide-bot.js`):
  bidirectional bot with role gate; Phase 10 adds the sender-role state
  machine (RDY → header → data window → EOF → next-file → FIN).
- **Phase 9 sender main-loop drain shape** (`transport/slide.js:527-533`
  `dispatchSendMode`): Phase 10's recv-mode payload pump follows the
  same per-chunk lifecycle (feed → drain events + outbound → maybe
  exit) modulo the payload-extraction step.

### Established Patterns

- **`#[wasm_bindgen]` only in `lib.rs`** (ADR-002): Phase 10's new
  recv accessors go in the existing `mod wasm_boundary` block as
  one-line forwards.
- **No `std::time` in Rust core** (ADR-003 + `core_02_no_browser_deps.rs`
  enforced): all cancel timing windows are JS `setTimeout` /
  `Promise.race(timeoutPromise(ms))`.
- **Module-scope JS state with `wireXxx({...})` initializers**:
  the new `slide-recv.js` (and `idb.js` if extracted) follow the
  exact pattern of `paste-pump.js` / `scroll-state.js` / `slide.js`
  / `file-source.js`.
- **EVT_* mirror invariant**: Rust EVT_* constants in
  `slide/framer.rs` + `state.rs` are pinned by
  `tests/slide_boundary_shape.rs:slide_event_constants_pinned` AND
  `tests/slide_wasm_boundary_shape.rs`; the JS-side mirror in
  `transport/slide.js:49-64` is the third leg. Phase 10 extends all
  three in lockstep.
- **Per-session `new Slide()` lifecycle** (Phase 8 dispatcher pattern):
  recv mode constructs a fresh Slide on wakeup; mid-session re-entry
  detection per SLIDE-34 calls `force_idle()` on the existing instance
  then constructs a new one (vs `Slide::reset()` singleton — rejected
  by Phase 8 for the same simplicity reason that applies here).
- **`[data-*]` attribute-driven CSS** (Phase 3 `[data-focused]` /
  Phase 6 `[data-scrolled-back]` / Phase 9 `[data-drop-target]`):
  Phase 10 does NOT add a new attribute (no chip, no UI surface);
  the toggle UI is a vanilla `<input type="checkbox">` in the
  Settings pane.

### Integration Points

- **`crates/bestialitty-core/src/slide/state.rs`** — Phase 10 adds
  `take_recv_payload()` / `take_recv_metadata()` accessors (or
  recv-buffer extension; planner picks per Claude's Discretion);
  MUST keep all existing receiver tests green.
- **`crates/bestialitty-core/src/slide/framer.rs`** — Phase 10 may
  add new EVT_* constants (planner names + numbers them per
  Phase 8/9 numbering convention); MUST keep all existing const
  values stable.
- **`crates/bestialitty-core/src/lib.rs`** — Phase 10 adds
  one-line forwards for the new recv-mode methods to the
  Phase 8/9 Slide `#[wasm_bindgen]` façade.
- **`crates/bestialitty-core/tests/slide_boundary_shape.rs`** —
  Phase 10 extends the fn-pointer pin with new methods + new
  EVT_* constants (if any).
- **`crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs`** —
  same, for the wasm façade.
- **`www/transport/slide.js`** — Phase 10 extends `dispatchRecvMode`
  (today a straight pass-through) with payload extraction +
  mid-session re-entry detection (or thin delegation to
  `slide-recv.js`).
- **`www/transport/slide-recv.js`** (NEW) — owns the per-file
  `chunks: Uint8Array[]` accumulator + Blob assembly + download
  dispatch (anchor vs FileSystemFileHandle) + 250ms gap enforcement
  + `~N` collision suffix retry.
- **`www/state/prefs.js`** — Phase 10 adds `slideRecvToFolder: false`
  to DEFAULTS.
- **`www/state/idb.js`** (NEW) — IndexedDB store for the
  FileSystemDirectoryHandle; tiny module, ~30 lines.
- **`www/input/keyboard.js`** — Phase 10 inserts SLIDE-cancel arm
  as new slot 2 in the Esc disambiguation chain (pushing paste to
  slot 3 and 0x1B to slot 4).
- **`www/index.html`** — Phase 10 adds the `[ ] Save received files
  to a folder` Settings row + `[Choose folder…]` button + ~10
  lines of CSS.
- **`www/main.js`** — Phase 10 adds `wireSlideRecv({...})` boot
  wiring AFTER `wireSlideDispatcher`.

</code_context>

<specifics>
## Specific Ideas

- **Settings pane row layout** (rough draft for planner — exact
  copy decided in Phase 11 chip work, but Phase 10 ships a
  functional row):
  ```
  [ ] Save received files to a folder
       [Choose folder…]   No folder selected
  ```
  When toggled on AND a directory has been chosen:
  ```
  [x] Save received files to a folder
       [Change folder…]   Saving to: ~/Downloads/MicroBeast
  ```
  When toggled on AND no directory chosen:
  ```
  [x] Save received files to a folder
       [Choose folder…]   ⚠ Pick a folder before next transfer
  ```
  When toggled on AND directory permission denied on reload:
  ```
  [x] Save received files to a folder
       [Re-allow folder…] ⚠ Permission needed for ~/Downloads/MicroBeast
  ```
- **`window.__slide` recv-mode shape** (extension of Phase 9):
  ```js
  window.__slide = {
      mode,                  // 'terminal' | 'recv' | 'send'
      state,                 // STATE_* enum value
      file_idx,              // 0-based; -1 in idle
      total_files,           // 0 in idle/recv-mode-pre-FIN (we don't
                             //   know the count until FIN arrives)
      bytes_in_file_done,    // running count of received payload bytes
      bytes_in_file_total,   // from header frame's LE u32 size field
      current_filename,      // from header frame's null-terminated name
                             //   field; null in idle / pre-header
      recv_to_folder,        // boolean — current effective state
                             //   (toggle ON + permission granted)
      cancelRecv,            // function() — programmatic cancel for
                             //   Playwright; calls slide.cancel()
  };
  ```
- **`~N` suffix algorithm pseudocode** (planner finalises):
  ```js
  async function ensureUnique(dir, name) {
      const dot = name.lastIndexOf('.');
      const [base, ext] = dot > 0
          ? [name.slice(0, dot), name.slice(dot)]
          : [name, ''];
      for (let n = 0; n <= 999; n++) {
          const candidate = n === 0 ? name : `${base}~${n}${ext}`;
          try {
              await dir.getFileHandle(candidate, { create: false });
              // exists — try next
          } catch (e) {
              if (e.name === 'NotFoundError') return candidate;
              throw e;
          }
      }
      return null;  // fall back to anchor-click
  }
  ```
- **Cancel sequence pseudocode** (PITFALLS §5 + ADR-003 verbatim):
  ```js
  async function cancelRecv() {
      cancelRequested = true;
      // 1. Settle in-flight writes (200ms cap).
      await Promise.race([
          Promise.allSettled(inflightWrites),
          delay(200),
      ]);
      // 2. Push CTRL_CAN to outbound (single byte 0x18 via existing
      //    fire-and-forget writeSlideFrame).
      slide.cancel();              // pushes CTRL_CAN to outbound_buf
      drainSlideOutbound();        // 1-byte writeSlideFrame
      // 3. Wait up to 500ms for Z80 echo (CancelPending silent-drain).
      const echoArrived = await waitForCancelPendingExit(500);
      // 4. Drain 100ms post-echo.
      await delay(100);
      // 5. If echo never arrived (stock slide.com without v0.2.1),
      //    force_idle escape hatch per ADR-003.
      if (!echoArrived) slide.force_idle();
      // 6. Re-arm — exit recv mode, owner back to terminal.
      txSinkRef.setWireOwner('terminal');
      mode = 'terminal';
      // 2-second absolute timeout enforced via Promise.race wrapping
      // the entire sequence.
  }
  ```
- **Edge case — zero-byte file** (SLIDE-21): receiver SM handles
  this via the existing `(SlideState::HeaderPhase, EVT_FIN)` arm
  at state.rs:494-498 if the sender sends FIN immediately after
  ACK(header), OR via the existing zero-payload EOF marker at
  state.rs:514-520 if the sender sends an empty data frame.
  Phase 10's per-file path receives `chunks = []` and assembles
  `new Blob([])` — produces a 0-byte file via the chosen download
  path. No SM changes; just verify in Phase 10's edge-case tests.
- **Edge case — sub-frame file** (SLIDE-22): receiver SM handles
  via the same zero-payload EOF marker after the single data frame.
  Phase 10's per-file path receives `chunks = [<bytes>]`, single
  Blob materialisation. No SM changes.
- **Edge case — binary (`.COM`, `.HEX`)** (SLIDE-23): no
  text-encoding step anywhere in the recv path. `chunks: Uint8Array[]`
  carries raw bytes; `new Blob(chunks, { type:
  'application/octet-stream' })` preserves bytes verbatim.
  Anchor-click downloads with `download="MYAPP.COM"` attribute.
- **1 MB+ memory smoke test**: Playwright spec drives the mock
  sender bot to produce a 1 MB file (1024 × 1024 random bytes),
  asserts `performance.memory.usedJSHeapSize` delta stays under
  ~3× the file size (Blob assembly + URL.createObjectURL overhead);
  asserts no O(n²) growth via the Phase 6 SOAK pattern at coarse
  granularity (single sample at start + end, not the full 24-h
  protocol).

</specifics>

<deferred>
## Deferred Ideas

Out of scope for Phase 10; tracked here so they're not lost:

- **Floating SLIDE chip at `bottom: 8px; left: 8px`** with file
  count + filename + N/M + percent + 2-second sliding-window
  throughput — Phase 11 (SLIDE-25, SLIDE-26).
- **Chip Cancel button as the primary user-visible cancel
  surface** — Phase 11 (SLIDE-27 chip). Phase 10 ships with
  Esc-key + `window.__slide.cancelRecv()` only.
- **Post-cancel "Cancelled — N of M files transferred" 5-second
  auto-hide chip** — Phase 11 (SLIDE-28).
- **Hard-fail recovery chip with "Retry" hint** — Phase 11
  (SLIDE-29 chip surface). Phase 10 ships with console.error
  only; the SM cleanup is the Phase 10 deliverable.
- **Drops during active SLIDE session rejected with
  "Transfer in progress — cancel first" chip** — Phase 11
  (SLIDE-11).
- **Auto-typed `B:SLIDE R\r` 500ms swallow-echo filter** —
  Phase 11 (SLIDE-14).
- **`prefs.slideAutoSendCommand` text input + `slideShowSummary`
  checkbox + `Compatibility mode` selector** — Phase 11
  (SLIDE-37, SLIDE-39). Phase 10's `slideRecvToFolder` is the
  ONLY Settings-pane SLIDE row that lands in Phase 10; the rest
  of the Settings block is Phase 11.
- **Auto-type "Z80 didn't respond" timeout chip with
  `[Retry] [Cancel] [Force start (legacy slide.com)]`** —
  Phase 11 (SLIDE-35). Phase 10's `force_idle()` after the 2s
  cancel-absolute-timeout is the closest analog but applies
  only to cancel-in-flight, not to wakeup-never-arrived.
- **Session-log pause + paste-pump `slide.isActive()` gate +
  paste-pump.cancelPaste() on session start** — Phase 11
  (SLIDE-33).
- **`visibilitychange` listener best-effort CTRL_CAN on tab close** —
  Phase 11 (SLIDE-31).
- **Real `slidePumpOnPortLost` (currently a no-op stub from Phase 8)
  symmetric to `pastePumpOnPortLost`** — Phase 11 (SLIDE-32).
  Phase 10 may pull this forward minimally if the cancel-on-port-lost
  path needs it; the planner has Claude's Discretion to implement
  a 5-line port-lost handler in Phase 10 if it materialises naturally
  out of the cancel work, OR defer entirely to Phase 11.
- **Filename collision UX on SEND (`NAME~1.TXT` etc.)** — Phase 12
  (SLIDE-36). Phase 10's `~N` collision suffix on RECV is the recv-side
  mirror; the send-side version detects collisions in JS pre-flight
  before the SLIDE session opens (different layer, different UX).
- **Drag-drop pointer-select isolation regression spec** — Phase 12
  (SLIDE-12).
- **Auto-send command safety validation (alphanumeric + `:` + `\r`
  only) + first-use confirmation chip** — Phase 12 (SLIDE-38).
- **`docs/SLIDE_Z80_REQUIREMENT.md` + README "File transfer" section +
  `docs/SLIDE-UAT.md` real-hardware UAT against patched
  MicroBeast** — Phase 12 (SLIDE-40, SLIDE-41, SLIDE-42).
- **DI-1 ETA, DI-2 NAK counter, DI-7 pre-send confirm chip,
  DI-13 open-downloads link, DI-14 backgrounded-tab redraw skip,
  DI-15 auto-send command preset dropdown** — P2 differentiators
  per FEATURES.md; ship if Phase 11 / 12 implementation goes
  smoothly. Phase 10 does not pull any forward.

</deferred>

---

*Phase: 10-slide-receiver-cancellation*
*Context gathered: 2026-05-08*
