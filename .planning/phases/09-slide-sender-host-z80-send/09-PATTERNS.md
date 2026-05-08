# Phase 9: SLIDE Sender — Host → Z80 Send — Pattern Map

**Mapped:** 2026-05-08
**Files analyzed:** 14 (5 NEW + 9 MODIFIED)
**Analogs found:** 14 / 14

This document is a verbatim-template pattern map for Phase 9. Every plan task should
reference one of the analog excerpts below to keep planning mechanical. Excerpt
line numbers are pinned against repo-current files at the time this map was made;
the planner should re-grep before quoting verbatim into PLAN files but the analog
file/section identity is the load-bearing artefact.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/bestialitty-core/tests/slide_sender.rs` (NEW) | rust integration test | event-driven SM | `crates/bestialitty-core/tests/slide_torn_chunk.rs` | exact (slide-namespace, integration scope) |
| `www/input/file-source.js` (NEW) | JS module / wireXxx initializer | event-driven (drag-drop, picker) | `www/input/paste-pump.js` (module-scope state + wireXxx + injected deps) + `www/renderer/scroll-state.js` (event listeners on `#terminal-wrapper`) | exact (paste-pump for shape, scroll-state for wrapper-event idiom) |
| `www/tests/transport/slide-sender.spec.js` (NEW) | Playwright e2e | request-response over mock wire | `www/tests/transport/slide-dispatcher.spec.js` | exact (same dispatcher seam, same setup helper) |
| `www/tests/input/file-source.spec.js` (NEW) | Playwright unit (DOM + module) | event-driven | `www/tests/transport/slide-wakeup.spec.js` (per-test `__resetForTests` shape) + `www/tests/input/tx-sink.spec.js` (input-namespace) | role-match |
| `www/tests/transport/mock-serial-slide-bot.js` (NEW) | test fixture (extension) | wire bot | `www/tests/transport/mock-serial.js` (the SERIAL_MOCK IIFE this extends) | exact |
| `crates/bestialitty-core/src/slide/state.rs` (MODIFY) | Rust SM | event-driven SM | self — extend the existing receiver-mode SM in place per CONTEXT D-08/D-11 | self-extension |
| `crates/bestialitty-core/src/slide/framer.rs` (MODIFY) | Rust DFA + constants | byte-fed | self — append two `EVT_*` constants + optional `build_frame_into` helper | self-extension |
| `crates/bestialitty-core/src/lib.rs` (MODIFY) | wasm façade | one-line forwards | self — extend the Phase 8 `Slide` `#[wasm_bindgen]` impl block at lines 198-285 | self-extension |
| `crates/bestialitty-core/tests/slide_boundary_shape.rs` (MODIFY) | fn-pointer pin | compile-time contract | self | self-extension |
| `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` (MODIFY) | fn-pointer pin (wasm façade mirror) | compile-time contract | self | self-extension |
| `www/transport/slide.js` (MODIFY) | JS dispatcher | event-driven | self — extend the Phase 8 dispatcher at lines 90-254 | self-extension |
| `www/input/tx-sink.js` (MODIFY) | TX I/O sink | request-response (writer.ready + writer.write) | self — sibling-add `writeSlideFrameAwaitable` next to `writeSlideFrame` at lines 118-126 | self-extension |
| `www/index.html` (MODIFY) | DOM + CSS | static | self — append button + hidden file input + drop overlay div + `<dialog>` + ~30 lines CSS following the `[data-scrolled-back]` idiom at lines 122-132 and the `#scrollback-indicator` chip at lines 138-164 | self-extension |
| `www/main.js` (MODIFY) | boot wiring | composition root | self — add `wireFileSource({...})` after `wireSlideDispatcher` at lines 386-402 | self-extension |

---

## Pattern Assignments

### 1. `crates/bestialitty-core/src/slide/state.rs` — sender SM extension

**Analog:** self — the existing receiver SM at `state.rs:87-309` is the verbatim template. Phase 9 extends in-place per CONTEXT D-08/D-11.

**Imports pattern** (state.rs:18-24 — verbatim, extend with `EVT_ACK` + `EVT_NAK` so sender match arms can name them):

```rust
use std::collections::VecDeque;

use super::framer::{
    Framer, EVT_NONE, EVT_RDY, EVT_FIN, EVT_CAN,
    EVT_DATA_FRAME, EVT_CRC_ERROR,
    CTRL_RDY, CTRL_ACK, CTRL_NAK, CTRL_FIN, CTRL_CAN,
};
```

Phase 9 add: `EVT_ACK`, `EVT_NAK`, and the two new `EVT_FILE_COMPLETE`, `EVT_SESSION_COMPLETE` — the latter two come from Phase 9's framer.rs additions (see §2 below).

**Constants pattern** (state.rs:26-39 — Phase 9 grows `OUTBOUND_RESERVE` per CONTEXT §"Existing Code Insights" ¶7):

```rust
/// SLIDE v0.2 sliding window size (slide-rs/protocol.rs:12-13).
const WIN_SIZE: u8 = 4;

/// Maximum CRC-error retry count before SM transitions to Error
/// (slide-rs/recv.rs:142).
const NAK_BUDGET: u32 = 15;

/// Outbound buffer pre-reserve (RDY+ACK+seq+NAK+seq+CAN+FIN ≤ 7 bytes;
/// 16 = 9 bytes headroom for stable-pointer discipline). Vec::clear()
/// preserves capacity → subsequent push() reuses allocation → outbound_ptr()
/// is stable across feed_byte calls in steady state (Phase 1 D-17 mirror).
const OUTBOUND_RESERVE: usize = 16;
```

**Phase 9 grow** to `4128` (4 frames × (4 header + 1024 payload + 2 CRC) = 4120, +8 headroom). The
mirror `OUTBOUND_VIEW_CAP = 16` in `www/transport/slide.js:78` must be grown in lockstep.

**Struct shape pattern** (state.rs:64-85 — verbatim; Phase 9 may add private sender-mode fields like `sender_seq: u8`, `sender_window: [Option<Vec<u8>>; WIN_SIZE]`, `metadata: Option<SendMetadata>`, `current_file_idx: usize`, `bytes_in_file_done: usize`, `bytes_in_file_total: u32` — internal, not pinned by boundary tests):

```rust
pub struct Slide {
    framer: Framer,
    sm_state: SlideState,
    #[allow(dead_code)]
    role: SlideRole,
    expected_seq: u8,
    nak_retry_count: u32,
    outbound_buf: Vec<u8>,
    events: VecDeque<u32>,
}
```

**Mode-entry method pattern** (state.rs:100-105 — `enter_recv_mode` is the verbatim template for `enter_send_mode(metadata: &[u8])`):

```rust
/// Transition Idle → WaitingRdy as receiver (Phase 8 dispatcher calls this
/// after consuming the wakeup signature). Receiver-only in Phase 7.
pub fn enter_recv_mode(&mut self) {
    self.role = SlideRole::Receiver;
    self.sm_state = SlideState::WaitingRdy;
}
```

Phase 9 mirror (skeleton — planner fills body):

```rust
/// Transition Idle → WaitingRdy as sender. JS calls this AFTER
/// `B:SLIDE R\r` is auto-typed and the wakeup match consumes the Z80's
/// ESC^SLIDE response. The metadata blob format is per CONTEXT D-09
/// (length-prefixed records: <u32 file_count><for each: u32 name_len,
/// name bytes (already CP/M-validated by JS), u32 size>).
pub fn enter_send_mode(&mut self, metadata: &[u8]) {
    self.role = SlideRole::Sender;
    self.sm_state = SlideState::WaitingRdy;
    // Parse metadata into self.metadata field …
}
```

**Match-arm transition pattern** (state.rs:218-307 — `handle_framer_event`'s `match (self.sm_state, evt)` table is the verbatim template). The sender adds these arms per CONTEXT D-11:

The bidirectional CAN echo at state.rs:209-216 already handles inbound CAN from any non-Done state for the receiver and is **the verbatim template** the sender SM must reuse without modification — it covers the sender-side CAN echo path automatically.

The receiver `WaitingRdy + EVT_RDY` arm (state.rs:220-224):

```rust
(SlideState::WaitingRdy, EVT_RDY) => {
    // Echo CTRL_RDY back per spec §Startup Handshake.
    self.outbound_buf.push(CTRL_RDY);
    self.sm_state = SlideState::HeaderPhase;
}
```

is the template for the sender's `WaitingRdy (Sender) + EVT_RDY` arm — sender pushes CTRL_RDY then advances to `HeaderPhase` AND pushes the first header frame onto outbound (using the framer's `build_frame` helper — see §2).

**`feed_byte` shape pattern** (state.rs:116-145 — Phase 9 keeps the existing receiver `feed_byte` body unchanged and adds a sibling `feed_send_chunk(payload, eof)` per CONTEXT D-08):

```rust
pub fn feed_byte(&mut self, b: u8) -> u32 {
    if self.sm_state == SlideState::CancelPending {
        if b == CTRL_CAN { /* … */ return EVT_CAN; }
        return EVT_NONE;
    }
    if matches!(self.sm_state, SlideState::Done | SlideState::Error) {
        return EVT_NONE;
    }
    let evt = self.framer.step(b);
    if evt == EVT_NONE { return EVT_NONE; }
    self.handle_framer_event(evt);
    self.events.push_back(evt);
    evt
}
```

Phase 9 sender API skeleton:

```rust
/// Push the next data-frame payload onto outbound_buf. Called by JS
/// from the dispatcher's send-mode loop AFTER receiving an ACK that
/// advances the window. `eof=true` signals "this is the last chunk
/// of the current file; emit the zero-payload EOF frame after this one"
/// per slide-rs/recv.rs:172-180 EOF marker convention.
pub fn feed_send_chunk(&mut self, payload: &[u8], eof: bool) {
    // Build frame, push onto outbound_buf, increment seq, update progress …
}
```

**Test-corpus idiom** (state.rs:317-549 — `#[cfg(test)] mod tests`). The receiver test fixtures use this exact `s_recv()` helper:

```rust
fn s_recv() -> Slide {
    let mut slide = Slide::new();
    slide.enter_recv_mode();
    slide
}
```

Phase 9 mirror in the same module:

```rust
fn s_send(metadata: &[u8]) -> Slide {
    let mut slide = Slide::new();
    slide.enter_send_mode(metadata);
    slide
}
```

Reference test names (use as templates for sender-side variants) — state.rs:344-549:
- `enter_recv_mode_transitions_to_waiting_rdy` → `enter_send_mode_transitions_to_waiting_rdy`
- `recv_rdy_echoed` → `send_rdy_received_pushes_header_frame`
- `header_acks_seq_0` → `header_ack_advances_to_data_phase`
- `data_phase_per_window_ack_at_win_size_4` → `send_data_phase_advances_window_on_ack`
- `seq_mismatch_naks_with_expected` → `send_nak_retransmits_window`
- `eof_frame_loops_to_header` → `send_eof_advances_to_next_file_or_fin`
- `peer_can_during_data_phase_echoes_and_transitions` — keep as-is, sender SM inherits
  the receiver bidirectional-CAN clause at state.rs:209-216 verbatim
- `outbound_ptr_stable_across_feed_byte` → `outbound_ptr_stable_across_sender_window_pushes`
  (per VALIDATION row "OUTBOUND_RESERVE growth")

---

### 2. `crates/bestialitty-core/src/slide/framer.rs` — EVT_* constant additions + optional helper

**Analog:** self — append to the constant block at framer.rs:31-39 (verbatim layout):

```rust
// ===== Packed events: (kind << 16) | aux. Mirrors lib.rs:152-155 cursor_packed. =====
pub const EVT_NONE:       u32 = 0;
pub const EVT_RDY:        u32 = 1 << 16;
pub const EVT_ACK:        u32 = 2 << 16;  // aux = seq
pub const EVT_NAK:        u32 = 3 << 16;  // aux = seq
pub const EVT_FIN:        u32 = 4 << 16;
pub const EVT_CAN:        u32 = 5 << 16;
pub const EVT_DATA_FRAME: u32 = 6 << 16;  // aux = seq
pub const EVT_CRC_ERROR:  u32 = 7 << 16;  // aux = seq
```

Phase 9 append (per CONTEXT D-12):

```rust
pub const EVT_FILE_COMPLETE:    u32 = 8 << 16;   // aux = file_idx
pub const EVT_SESSION_COMPLETE: u32 = 9 << 16;
```

The VALIDATION row also names `EVT_RETRANSMIT_NEEDED`; planner decides whether the sender SM emits a JS-observable retransmit event or handles retransmit entirely internally. Default per CONTEXT Claude's-Discretion §"Sender retry budget": follow slide-rs/send.rs:194-208 (no JS-observable retransmit event needed — the SM retransmits silently).

**Frame-builder helper pattern** — slide-rs/protocol.rs:33-44 is the upstream byte-for-byte reference:

```rust
pub fn build_frame(seq: u8, payload: &[u8]) -> Vec<u8> {
    let length = payload.len();
    let mut crc_data = vec![seq, (length >> 8) as u8, (length & 0xFF) as u8];
    crc_data.extend_from_slice(payload);
    let crc = crc16_ccitt(&crc_data);

    let mut frame = vec![SOF, seq, (length >> 8) as u8, (length & 0xFF) as u8];
    frame.extend_from_slice(payload);
    frame.push((crc >> 8) as u8);
    frame.push((crc & 0xFF) as u8);
    frame
}
```

Phase 9 alloc-free variant (per CONTEXT §"Existing Code Insights" ¶5 — pushes directly into `outbound_buf`):

```rust
/// Build a SLIDE wire frame in place: [SOF][SEQ][LEN_H][LEN_L][PAYLOAD][CRC_H][CRC_L].
/// Pushes 7 + payload.len() bytes onto `out`. Caller must ensure `out`
/// has reserved capacity to stay within the OUTBOUND_RESERVE stable-pointer
/// budget (Phase 9 grows the budget to 4128 bytes per state.rs comment).
pub fn build_frame_into(out: &mut Vec<u8>, seq: u8, payload: &[u8]) {
    // … push SOF, seq, len_hi, len_lo, payload bytes, then CRC bytes
    //   (CRC scope: [seq, len_hi, len_lo, ...payload] — NOT including SOF,
    //    NOT including CRC bytes themselves; framer.rs:1-10 documents this).
}
```

The `build_header_frame` shape (slide-rs/protocol.rs:47-56) is the byte-encoding
reference for the per-file header that Phase 9's sender SM emits at
`SendingHeader` entry: null-terminated filename + 4-byte LE size, all wrapped in
seq=0 frame. The metadata blob from JS already contains the validated filename
and size; the SM unpacks them and calls `build_frame_into(out, 0, &header_payload)`.

---

### 3. `crates/bestialitty-core/src/lib.rs` — wasm façade extension

**Analog:** self — Phase 8 `Slide` `#[wasm_bindgen]` block at lib.rs:198-285 is the verbatim template. ADR-002 forbids `#[wasm_bindgen]` outside this file.

**One-line forward pattern** (lib.rs:217-219, 230-233 — verbatim template):

```rust
/// Enter receiver mode — call once per session after `new Slide()`.
pub fn enter_recv_mode(&mut self) {
    self.inner.enter_recv_mode();
}

/// Feed a byte chunk through the framer. ONE boundary call per Web
/// Serial chunk (RESEARCH Anti-Pattern: per-byte FFI through
/// feed_byte in the recv hot path).
pub fn feed_chunk(&mut self, bytes: &[u8]) -> u32 {
    self.inner.feed_chunk(bytes)
}
```

Phase 9 additions (add inside the same `impl Slide` block, sibling to `enter_recv_mode` and `feed_chunk`):

```rust
/// Enter sender mode — call once per session after `new Slide()`.
/// The metadata blob format is per CONTEXT D-09 (length-prefixed records).
/// JS's `packSendMetadata(files)` in `www/input/file-source.js` produces
/// the exact byte layout `enter_send_mode` expects.
pub fn enter_send_mode(&mut self, metadata: &[u8]) {
    self.inner.enter_send_mode(metadata);
}

/// Push the next data-frame payload onto outbound_buf. ONE boundary call
/// per send-loop iteration. `eof=true` triggers the zero-payload EOF frame.
pub fn feed_send_chunk(&mut self, payload: &[u8], eof: bool) {
    self.inner.feed_send_chunk(payload, eof);
}
```

The `outbound_ptr` / `outbound_len` / `clear_outbound` triple at lib.rs:255-269 is **not modified** — sender frame egress reuses the existing receiver-side zero-copy drain.

---

### 4. `crates/bestialitty-core/tests/slide_boundary_shape.rs` — fn-pointer pin extension

**Analog:** self — verbatim template at slide_boundary_shape.rs:42-47:

```rust
#[test]
fn slide_feed_methods_have_stable_signatures() {
    let _: fn(&mut Slide, u8) -> u32   = Slide::feed_byte;
    let _: fn(&mut Slide, &[u8]) -> u32 = Slide::feed_chunk;
    let _: fn(&mut Slide) -> u32       = Slide::take_event_packed;
}
```

Phase 9 add a new sibling test in the same file:

```rust
#[test]
fn slide_send_methods_have_stable_signatures() {
    // Phase 9 sender API surface — fn-pointer coercion catches signature
    // drift at compile time (mirror of slide_feed_methods_have_stable_signatures).
    let _: fn(&mut Slide, &[u8])         = Slide::enter_send_mode;
    let _: fn(&mut Slide, &[u8], bool)   = Slide::feed_send_chunk;
}
```

Plus extend `slide_event_constants_pinned` at slide_boundary_shape.rs:79-94 with:

```rust
assert_eq!(EVT_FILE_COMPLETE    >> 16, 8);
assert_eq!(EVT_SESSION_COMPLETE >> 16, 9);
```

Update the `use` block at slide_boundary_shape.rs:22-26 to include the two new constants.

---

### 5. `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — mirror extension

**Analog:** self — sibling-mirror of slide_boundary_shape.rs. Phase 9 mirrors the
exact same additions from §4 above into this file. The two pin files are
designed to drift in lockstep (the file-level doc comment at lines 1-19 says so).

---

### 6. `www/transport/slide.js` — dispatcher extension

**Analog:** self — extend in-place. The Phase 8 dispatcher at lines 1-254 is the verbatim template.

**Module-scope state pattern** (slide.js:62-78):

```js
// Module-scope state.
let mode = 'terminal';                   // 'terminal' | 'recv' | 'send'
let wakeIdx = 0;
const scratch = new Uint8Array(6);
let slide = null;

// Injected deps (wireSlideDispatcher sets these).
let termRef = null;
let txSinkRef = null;
let SlideCtor = null;
let wasmRef = null;

// Cached outbound view (re-derived on memory growth — Pitfall 4 mirror).
let outboundBuffer = null;
let outboundView = null;
const OUTBOUND_VIEW_CAP = 16;
```

Phase 9 additions per CONTEXT D-13/D-14:

```js
// Phase 9 — pending send queue depth 1 (Claude's Discretion default per
// CONTEXT). Set by enterSendMode({ files }), consumed by the wakeup-completion
// clause in dispatchTerminalMode.
let pendingSendSession = null;     // { metadata: Uint8Array, fileBytes: Uint8Array[] } | null

// Phase 9 hardcoded; Phase 11 SLIDE-37 makes this prefs-driven.
const AUTO_SEND_COMMAND = new Uint8Array([0x42, 0x3A, 0x53, 0x4C, 0x49, 0x44, 0x45, 0x20, 0x52, 0x0D]);  // "B:SLIDE R\r"

// Phase 9 — extend EVT_* mirror per slide_boundary_shape.rs §4.
const EVT_FILE_COMPLETE    = 8 << 16;
const EVT_SESSION_COMPLETE = 9 << 16;
```

**`OUTBOUND_VIEW_CAP` growth** (slide.js:78): `16` → `4128` to match the new Rust-side `OUTBOUND_RESERVE` per state.rs §1 above.

**`dispatchInbound` routing pattern** (slide.js:90-97 — Phase 9 unblocks the `'send'` branch):

```js
export function dispatchInbound(value) {
    if (mode === 'terminal') {
        dispatchTerminalMode(value);
    } else if (mode === 'recv') {
        dispatchRecvMode(value);
    }
    // mode === 'send' is Phase 9 scope; absent branch is correct for Phase 8.
}
```

Phase 9 — add:

```js
} else if (mode === 'send') {
    dispatchSendMode(value);
}
```

`dispatchSendMode` mirrors `dispatchRecvMode` (slide.js:189-194) — both feed inbound
bytes through `slide.feed_chunk` and call the same drain-events + drain-outbound
sequence (per CONTEXT §"Existing Code Insights" ¶8). The sender-mode loop adds
post-event handling for `EVT_ACK` (advance window) and `EVT_FILE_COMPLETE`
(push next file's data via `feed_send_chunk`).

**Wakeup-completion clause** (slide.js:140-162 — verbatim template):

```js
if (wakeIdx === 7) {
    if (pending.length) {
        termRef.feed(new Uint8Array(pending));
        pending.length = 0;
    }
    enterRecvMode();
    wakeIdx = 0;
    const tail = value.subarray(i + 1);
    if (tail.length) {
        feedSlide(tail);
        drainEventsAndOutbound();
        maybeExitRecvMode();
    }
    return;
}
```

Phase 9 D-13 modification — branch on `pendingSendSession`:

```js
if (wakeIdx === 7) {
    if (pending.length) {
        termRef.feed(new Uint8Array(pending));
        pending.length = 0;
    }
    if (pendingSendSession) {
        enterSendModeInternal(pendingSendSession);
        pendingSendSession = null;
    } else {
        enterRecvMode();
    }
    wakeIdx = 0;
    // … tail forwarding identical to Phase 8.
}
```

**`enterRecvMode` / `exitRecvMode` pattern** (slide.js:230-254 — the verbatim template for `enterSendModeInternal` / `exitSendMode`):

```js
function enterRecvMode() {
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
    slide.enter_recv_mode();
    txSinkRef.setWireOwner('slide');
    mode = 'recv';
}

function exitRecvMode() {
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
}
```

Phase 9 sender mirror:

```js
function enterSendModeInternal({ metadata, fileBytes }) {
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
    slide.enter_send_mode(metadata);
    txSinkRef.setWireOwner('slide');
    mode = 'send';
    // … additionally: kick off the send-loop driver that calls
    //     feed_send_chunk → drainSlideOutboundOwned → writeSlideFrameAwaitable
}

function exitSendMode() {
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    // re-enable the [↑ Send file] button (Phase 9 D-18 progress feedback).
}
```

**`drainSlideOutbound` zero-copy pattern** (slide.js:207-221 — verbatim, but Phase 9
must also expose an awaitable variant):

```js
function drainSlideOutbound() {
    const len = slide.outbound_len();
    if (len === 0) return;
    if (wasmRef.memory.buffer !== outboundBuffer) {
        outboundBuffer = wasmRef.memory.buffer;
        outboundView = new Uint8Array(outboundBuffer, slide.outbound_ptr(), OUTBOUND_VIEW_CAP);
    }
    const owned = new Uint8Array(outboundView.subarray(0, len));   // Pitfall 5 — slice before await
    txSinkRef.writeSlideFrame(owned);
    slide.clear_outbound();
}
```

Phase 9 awaitable variant (used by the send-mode loop per CONTEXT D-17):

```js
async function drainSlideOutboundAwaitable() {
    const len = slide.outbound_len();
    if (len === 0) return;
    if (wasmRef.memory.buffer !== outboundBuffer) {
        outboundBuffer = wasmRef.memory.buffer;
        outboundView = new Uint8Array(outboundBuffer, slide.outbound_ptr(), OUTBOUND_VIEW_CAP);
    }
    const owned = new Uint8Array(outboundView.subarray(0, len));
    await txSinkRef.writeSlideFrameAwaitable(owned);
    slide.clear_outbound();
}
```

**Public exports — wireSlideDispatcher pattern** (slide.js:82-88 — verbatim template):

```js
export function wireSlideDispatcher(opts) {
    const { term, txSink, slideCtor, wasm } = opts;
    termRef = term;
    txSinkRef = txSink;
    SlideCtor = slideCtor;
    wasmRef = wasm;
}
```

Phase 9 add a new sibling export:

```js
/// Called by file-source.js after the user confirms the rewrite modal.
/// Sets pendingSendSession (depth 1; second click clobbers per CONTEXT
/// Claude's-Discretion default). Auto-types `B:SLIDE R\r` synchronously
/// while owner is still 'terminal' (gate in tx-sink.js permits this).
export function enterSendMode({ files }) {
    const metadata = packSendMetadata(files);   // (or passed in pre-packed)
    const fileBytes = files.map((f) => f.bytes);
    pendingSendSession = { metadata, fileBytes };
    // Auto-type B:SLIDE R\r (D-13). pushTxBytes is owner-gated; owner is
    // 'terminal' until the wakeup match flips it (D-13).
    if (AUTO_SEND_COMMAND.length > 0) {
        pushTxBytes(AUTO_SEND_COMMAND);
    }
}
```

(Note: `pushTxBytes` would need to be imported from `../input/tx-sink.js` — Phase 8
slide.js doesn't import it because the dispatcher previously only sent SLIDE frames.
Adding the import is the additive single-line edit.)

**Test-introspection pattern** (slide.js:106-122 — verbatim template):

```js
export function __resetForTests() {
    mode = 'terminal';
    wakeIdx = 0;
    if (slide) { /* free */ slide = null; }
    if (txSinkRef && typeof txSinkRef.setWireOwner === 'function') {
        txSinkRef.setWireOwner('terminal');
    }
}
export function __getStateForTests() {
    return { mode, wakeIdx, hasSlide: slide !== null };
}
```

Phase 9 — extend `__resetForTests` to clear `pendingSendSession`; extend
`__getStateForTests` per CONTEXT §"Specifics" — `window.__slide` introspection
shape with `state, file_idx, total_files, bytes_in_file_done, bytes_in_file_total,
current_filename`. The Rust-side `Slide` getters expose those values; JS just
forwards.

---

### 7. `www/input/tx-sink.js` — `writeSlideFrameAwaitable` sibling

**Analog:** self — verbatim sibling-add next to `writeSlideFrame` at tx-sink.js:118-126.

**Existing fire-and-forget pattern** (tx-sink.js:118-126):

```js
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

Phase 9 awaitable sibling (CONTEXT D-16 — exact body):

```js
export async function writeSlideFrameAwaitable(bytes) {
    if (!registeredWriter) {
        throw new Error('[tx-sink] writeSlideFrameAwaitable: no writer registered');
    }
    await registeredWriter.ready;
    await registeredWriter.write(bytes);
}
```

**PITFALLS §4 explicit ban** — never `await writer.write(bytes)` without first
awaiting `writer.ready`. The body above is the **single legitimate idiom**.

---

### 8. `www/input/file-source.js` (NEW) — module template

**Analog:** `www/input/paste-pump.js` for the module shape; `www/renderer/scroll-state.js` for the wrapper-event listener idiom.

**Module header pattern** (paste-pump.js:1-12 — verbatim template):

```js
// BestialiTTY Phase 5 — paste throttling queue (setTimeout chain).
//
// Public API: enqueuePaste, cancelPaste, isActive, onProgress, onPortLost, wirePastePump.
//
// Sources:
//   - 05-CONTEXT.md D-12..D-23.
//   - 05-RESEARCH.md Pattern 4 (setTimeout chain; Pitfall 6 — 4ms clamp).
//   - 05-UI-SPEC.md §"Paste-pump UI interactions" + §"Connection pane" progress copy.
//   - Analog: www/input/tx-sink.js (module-scope state + observer fan-out).
```

**Module-scope state pattern** (paste-pump.js:16-29):

```js
const CHUNK_SIZE = 32;
let gapMs = computeGap(19200);
let queue = new Uint8Array(0);
let cursor = 0;
let timer = null;
const progressObservers = [];

// Injected deps (wirePastePump sets these — enables D-22 local-echo from the pump).
let termRef = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;
```

Phase 9 file-source.js mirror:

```js
// CP/M-invalid character set (CONTEXT D-06).
const CPM_INVALID_CHARS = new Set(['<','>',',',';',':','=','?','*','[',']']);

// Module-scope state.
let dragDepth = 0;        // dragenter/dragleave can fire multiple times across child elements
let modalElRef = null;
let pendingFiles = null;  // { rewrites: [], rejections: [] }

// Injected deps (wireFileSource sets these).
let wrapperElRef = null;
let sendBtnRef = null;
let sendInputRef = null;
let enterSendModeFn = null;   // imported from transport/slide.js
```

**`wireXxx({...})` initializer pattern** (paste-pump.js:32-38):

```js
export function wirePastePump(opts) {
    const { term, sampleBell, drainHostReply, requestFrame } = opts;
    termRef = term;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
}
```

Phase 9 mirror:

```js
export function wireFileSource(opts) {
    const { wrapperEl, sendBtn, sendInput, dialogEl, enterSendMode } = opts;
    wrapperElRef = wrapperEl;
    sendBtnRef = sendBtn;
    sendInputRef = sendInput;
    modalElRef = dialogEl;
    enterSendModeFn = enterSendMode;

    // Picker click handler — opens hidden file input.
    sendBtn.addEventListener('click', () => sendInput.click());
    // Phase 4 D-16 sacred — focus retention.
    sendBtn.addEventListener('mousedown', (e) => e.preventDefault());

    // Picker change handler.
    sendInput.addEventListener('change', onPickerChange);

    // Drag-drop handlers on #terminal-wrapper (CONTEXT D-03/D-04).
    wrapperEl.addEventListener('dragenter', onDragEnter);
    wrapperEl.addEventListener('dragover', onDragOver);
    wrapperEl.addEventListener('dragleave', onDragLeave);
    wrapperEl.addEventListener('drop', onDrop);
}
```

**Wrapper-event listener pattern** (scroll-state.js:42-58 — verbatim template for
how to attach an event listener with `pointer-events: none` overlay coexistence):

```js
canvasWrapper.addEventListener('wheel', onWheel, { passive: false });
```

Phase 9 file-source.js mirror — the drag-drop listeners are attached the same way
on the wrapper. CONTEXT D-04 says "On every dragenter/dragover, check
`dataTransfer.types.includes('Files')`; if false, never set `data-drop-target`
and never `preventDefault()`."

**`[data-scrolled-back]` attribute toggle pattern** (scroll-state.js:185-192 — verbatim template for `[data-drop-target]`):

```js
function refreshAttribute() {
    if (!canvasWrapperRef) return;
    if (offset > 0) {
        canvasWrapperRef.setAttribute('data-scrolled-back', 'true');
    } else {
        canvasWrapperRef.removeAttribute('data-scrolled-back');
    }
}
```

Phase 9 mirror:

```js
function setDropTarget(active) {
    if (!wrapperElRef) return;
    if (active) {
        wrapperElRef.setAttribute('data-drop-target', 'true');
    } else {
        wrapperElRef.removeAttribute('data-drop-target');
    }
}
```

**CP/M validation + truncation helpers** (Phase 9 owns these; per CONTEXT D-06/D-07):

```js
export function validateCpmFilename(name) {
    if (name.length === 0) return { ok: false, reason: 'empty filename' };
    if (name.startsWith('.'))   return { ok: false, reason: 'leading-dot dotfile' };
    for (const ch of name) {
        const code = ch.codePointAt(0);
        if (code >= 0x80) return { ok: false, reason: `non-ASCII byte 0x${code.toString(16)}` };
        if (code <  0x20) return { ok: false, reason: `control byte 0x${code.toString(16)}` };
        if (CPM_INVALID_CHARS.has(ch)) return { ok: false, reason: `invalid CP/M character '${ch}'` };
    }
    return { ok: true, reason: null };
}

export function truncateCpm83(name) {
    const upper = name.toUpperCase();
    const lastDot = upper.lastIndexOf('.');
    if (lastDot < 0) return upper.slice(0, 8);                 // no extension
    const base = upper.slice(0, lastDot).slice(0, 8);
    const ext  = upper.slice(lastDot + 1).slice(0, 3);
    return ext.length > 0 ? `${base}.${ext}` : base;
}

export function packSendMetadata(files) {
    // CONTEXT D-09 layout:
    //   <u32 file_count>
    //   for each file:
    //     <u32 name_len><name bytes (utf-8 / ASCII; already uppercased + 8.3-truncated)>
    //     <u32 size>
    // Returns Uint8Array.
}
```

---

### 9. `www/index.html` — top-bar button + drop overlay + `<dialog>` + CSS

**Analog:** self — extend in-place per these existing patterns.

**Top-bar button pattern** (index.html:517-538 — verbatim template):

```html
<div id="top-bar">
    <button id="connect-button" type="button" data-state="disconnected"
            title="Connect to MicroBeast over Web Serial">Connect</button>
    <button id="clear-button" type="button"
            title="Clear visible screen (Shift+click also clears scrollback)">Clear</button>
    <button id="theme-toggle" type="button" title="Toggle theme (Ctrl+Alt+T)">Clean</button>
    <!-- … phosphor radio-group, paste-progress-row … -->
</div>
```

Phase 9 add (sibling of `#clear-button`, per CONTEXT D-01):

```html
<button id="send-file-btn" type="button"
        title="Send file(s) to the MicroBeast via SLIDE">↑ Send file</button>
<input id="send-file-input" type="file" multiple hidden>
```

The `[Connect] [Disconnect] [Download log] [Clear] [↑ Send file]` row in CONTEXT
§"Specifics" suggests slot order. Note that Phase 6 lists `[Disconnect]` as
top-bar but the current index.html has Connect's `data-state` toggle handle both
states; Phase 9 doesn't add a Disconnect button.

**Drop overlay div** — parented to `#terminal-wrapper` (index.html:606-617 — verbatim parent block):

```html
<div id="terminal-wrapper" tabindex="0">
    <canvas id="terminal" tabindex="-1"></canvas>
    <div id="bell-overlay"></div>
    <div id="scanlines"></div>
    <button id="scrollback-indicator" type="button" hidden …>…</button>
</div>
```

Phase 9 add inside the wrapper, after `#scrollback-indicator`:

```html
<div id="drop-overlay" aria-hidden="true">
    <span class="drop-label">Drop file(s) to send via SLIDE</span>
</div>
```

The literal string `"Drop file(s) to send via SLIDE"` is verbatim from CONTEXT
§"Specifics" (matches SLIDE-09 acceptance).

**`<dialog>` element** — append after the `<details id="settings">` block (or anywhere in `<body>`); planner picks the slot:

```html
<dialog id="send-confirm-dialog">
    <h3 id="send-confirm-title">Sending N files via SLIDE</h3>
    <ul id="send-confirm-list"></ul>
    <div class="dialog-buttons">
        <button id="send-confirm-cancel" type="button">Don't send</button>
        <button id="send-confirm-go" type="button">Send N files</button>
    </div>
</dialog>
```

(Modal copy verbatim from CONTEXT §"Specifics" §"`<dialog>` modal copy".)

**CSS — `[data-drop-target]` mirror of `[data-scrolled-back]`** (index.html:122-132 — verbatim template):

```css
/* ==== [data-scrolled-back] border tint on #terminal-wrapper (Phase 6 D-13) ==== */
#terminal-wrapper[data-scrolled-back="true"] {
    border-color: color-mix(in srgb, var(--chrome-accent) 40%, transparent);
}
[data-theme="crt"] #terminal-wrapper[data-scrolled-back="true"] {
    border-color: color-mix(in srgb, var(--phosphor-fg) 40%, transparent);
}
```

Phase 9 mirror:

```css
/* ==== [data-drop-target] dashed border + tint while a file drag is over the
       wrapper (Phase 9 D-03; mirror of Phase 6 [data-scrolled-back] idiom) ==== */
#terminal-wrapper[data-drop-target="true"] {
    border-style: dashed;
    border-color: var(--chrome-accent);
    background-color: color-mix(in srgb, var(--chrome-accent) 10%, transparent);
}
[data-theme="crt"] #terminal-wrapper[data-drop-target="true"] {
    border-color: var(--phosphor-fg);
    background-color: color-mix(in srgb, var(--phosphor-fg) 10%, transparent);
}

/* Drop overlay — inside #terminal-wrapper, displayed when [data-drop-target] is set. */
#drop-overlay {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    pointer-events: none;        /* CONTEXT D-03 — pointer-select keeps working */
    z-index: 5;                  /* same as #scrollback-indicator */
}
#terminal-wrapper[data-drop-target="true"] #drop-overlay {
    display: flex;
}
#drop-overlay .drop-label {
    font-family: inherit;
    font-size: 14px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.65);
    color: var(--chrome-accent);
    border: 1px solid var(--chrome-accent);
    border-radius: 4px;
}
[data-theme="crt"] #drop-overlay .drop-label {
    color: var(--phosphor-fg);
    border-color: var(--phosphor-fg);
}
```

The chip-palette aesthetic is verbatim from `#scrollback-indicator` at index.html:138-164.

Dialog CSS — minimal shape (planner picks readable layout per CONTEXT
§Claude's-Discretion §"`<dialog>` modal CSS treatment"):

```css
#send-confirm-dialog {
    /* native <dialog> centers via the browser; no manual positioning needed */
    border: 1px solid var(--chrome-accent);
    background: var(--chrome-bg);
    color: var(--chrome-fg);
    padding: 16px;
    max-width: 560px;
}
#send-confirm-dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
#send-confirm-list { list-style: none; padding: 0; margin: 0; }
#send-confirm-list li { padding: 4px 0; font-family: monospace; font-size: 13px; }
#send-confirm-list li.rejected { color: #c0392b; }
.dialog-buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
```

---

### 10. `www/main.js` — wireFileSource boot wiring

**Analog:** self — `wireSlideDispatcher` call site at main.js:386-402 is the verbatim template.

**Boot-wiring pattern** (main.js:386-402 — verbatim template):

```js
// Phase 8 — wire SLIDE dispatcher AFTER wireSessionLog (so the post-feed
// invariant's sessionLogRef.append still sees inbound bytes — terminal mode
// is byte-transparent through dispatchInbound) and BEFORE await wireSerial
// so the dispatcher is initialized before any chunks could arrive on the
// read loop. Pitfall 8 — Slide constructor depends on `await init()` having
// resolved, which happened at main.js:79.
wireSlideDispatcher({
    term,
    txSink: { setWireOwner, getWireOwner, writeSlideFrame },
    slideCtor: Slide,
    wasm,
});

// Test introspection (mirrors window.__sessionLog / window.__scrollState
// precedent).
window.__slide = {
    __resetForTests: __slideResetForTests,
    __getStateForTests: __slideGetStateForTests,
    dispatchInbound,
};
window.__txSink = { setWireOwner, getWireOwner, writeSlideFrame };
```

Phase 9 add immediately after — per CONTEXT §"Existing JS shell seams" ¶`www/main.js`:

```js
// Phase 9 — wire file-source AFTER wireSlideDispatcher so file-source.js can
// import enterSendMode from transport/slide.js. The wrapper element + button
// + hidden file input + <dialog> are already in the DOM.
const sendFileBtn   = document.getElementById('send-file-btn');
const sendFileInput = document.getElementById('send-file-input');
const sendDialog    = document.getElementById('send-confirm-dialog');
wireFileSource({
    wrapperEl: terminalWrapper,
    sendBtn: sendFileBtn,
    sendInput: sendFileInput,
    dialogEl: sendDialog,
    enterSendMode: enterSlideSendMode,    // imported from transport/slide.js
});
```

The `import { enterSendMode } from './transport/slide.js';` line goes alongside
the existing slide.js import block at main.js:70-75; alias to `enterSlideSendMode`
to avoid name collision with `wireSlideDispatcher`'s callsite.

Augment `window.__slide` with the new introspection fields per CONTEXT
§"Specifics" §"`window.__slide` introspection shape":

```js
window.__slide = {
    __resetForTests: __slideResetForTests,
    __getStateForTests: __slideGetStateForTests,
    dispatchInbound,
    enterSendMode: enterSlideSendMode,    // Phase 9 test hook
};
```

---

### 11. `crates/bestialitty-core/tests/slide_sender.rs` (NEW) — sender integration test

**Analog:** `crates/bestialitty-core/tests/slide_torn_chunk.rs` for the test corpus shape. `slide_idempotent_reentry.rs` for the per-test test naming + outbound_snapshot helper.

**Imports + helpers** (slide_torn_chunk.rs:1-21 — verbatim template):

```rust
//! SLIDE torn-chunk corpus.
//!
//! …docstring rationale…

use bestialitty_core::slide::tests_only::*;

fn outbound_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.outbound_len();
    if len == 0 { return Vec::new(); }
    unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), len).to_vec() }
}
```

Phase 9 mirror header:

```rust
//! SLIDE sender corpus — Phase 9 SC#5 byte-identical round-trip + multi-file
//! + zero-byte + NAK retransmit + inbound CAN echo against a mock SLIDE
//! receiver peer.

use bestialitty_core::slide::tests_only::*;

fn outbound_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.outbound_len();
    if len == 0 { return Vec::new(); }
    unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), len).to_vec() }
}

/// Drive a sender-mode Slide through one full file's send loop:
///   - feed CTRL_RDY (peer says go)
///   - drain header frame, emit ACK(0)
///   - feed payload chunks via feed_send_chunk + ACK each window
///   - feed EOF + ACK
///   - assert outbound bytes are byte-identical to slide-rs build_frame()
///     for the same payload.
fn drive_send_session(payload: &[u8], filename: &str) -> Vec<u8> { /* … */ }
```

**Test-name template** (per CONTEXT §"Existing Code Insights" + VALIDATION row Phase 9 SC#5):

```rust
#[test] fn end_to_end_single_file() { /* SC#5 byte-identical round-trip */ }
#[test] fn end_to_end_multi_file() { /* file-loop + EVT_FILE_COMPLETE */ }
#[test] fn end_to_end_zero_byte_file() { /* SLIDE-21 empty file edge case */ }
#[test] fn nak_triggers_retransmit() { /* slide-rs/send.rs:194-208 mirror */ }
#[test] fn mid_send_can_echoes_and_aborts() { /* CONTEXT D-19 + ADR-003 */ }
#[test] fn fin_after_all_files_acks_session_complete() { /* CONTEXT D-11 §FIN exchange */ }
```

---

### 12. `www/tests/transport/slide-sender.spec.js` (NEW) — Playwright sender flow

**Analog:** `www/tests/transport/slide-dispatcher.spec.js` (verbatim setup helper + setWireOwner reset; same dispatcher seam Phase 9 extends).

**File header** (slide-dispatcher.spec.js:1-19 — verbatim):

```js
// BestialiTTY Phase 8 Plan 04 (Wave 3) — dispatcher routing Playwright assertions.
// …

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
```

**Setup helper** (slide-dispatcher.spec.js:21-27 — verbatim template):

```js
async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}
```

**Per-test reset pattern** (slide-dispatcher.spec.js:31-44 — verbatim):

```js
test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide.__resetForTests();
        window.__mockWriterLog = [];
    });
});
```

Phase 9 add: `await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);` after the
`SERIAL_MOCK` init script — installs the SLIDE-receiver bot on the mock writer
log so the bot can ACK/NAK frames the dispatcher writes.

**Test names** (covering VALIDATION rows for SLIDE-07, SLIDE-13, Phase 9 SC#5):

```js
test('picker click flow @fast', /* SLIDE-07 */ …);
test('auto-type B:SLIDE R\\r before wakeup match @fast', /* SLIDE-13 */ …);
test('byte-identical round-trip — single file via mock SLIDE-receiver bot @fast', /* SC#5 */ …);
test('multi-file send completes via mock receiver bot @fast', …);
test('NAK retransmit driven by mock bot recovers @fast', …);
test('window.__slide introspection reports state + progress @fast', /* D-18 */ …);
```

---

### 13. `www/tests/input/file-source.spec.js` (NEW) — Playwright file-source flow

**Analog:** `www/tests/transport/slide-wakeup.spec.js` for the per-test reset shape; `www/tests/input/tx-sink.spec.js` for the input-namespace placement.

**Setup + test layout pattern** (slide-wakeup.spec.js:23-50 — verbatim template).

**Test names** (covering VALIDATION rows for SLIDE-08, SLIDE-09, SLIDE-10, SLIDE-15, SLIDE-16):

```js
test('drag-drop overlay shows on dragenter @fast', /* SLIDE-09 */ …);
test('overlay visible — [data-drop-target] attribute set @fast', …);
test('non-file rejection — silent at dragenter @fast', /* SLIDE-10 */ …);
test('drop triggers picker-equivalent flow @fast', /* SLIDE-08 */ …);
test('modal rewrite — uppercased + 8.3 truncation surfaced @fast', /* SLIDE-15 */ …);
test('modal rejection — invalid CP/M character listed @fast', /* SLIDE-16 */ …);
test('all-files-rejected disables Send button @fast', …);
```

**Drag-drop simulation helper pattern** — Playwright's `dispatchEvent` on the
locator with synthetic `DataTransfer`. Plan must include a snippet (no existing
analog in the repo for synthetic file drops; see Playwright docs; planner
provides exact snippet):

```js
async function dragFileToWrapper(page, filename, content) {
    const dataTransfer = await page.evaluateHandle(({ name, body }) => {
        const dt = new DataTransfer();
        const file = new File([body], name, { type: 'text/plain' });
        dt.items.add(file);
        return dt;
    }, { name: filename, body: content });
    await page.locator('#terminal-wrapper').dispatchEvent('dragenter', { dataTransfer });
    await page.locator('#terminal-wrapper').dispatchEvent('dragover',  { dataTransfer });
    await page.locator('#terminal-wrapper').dispatchEvent('drop',      { dataTransfer });
}
```

---

### 14. `www/tests/transport/mock-serial-slide-bot.js` (NEW) — extension to mock-serial.js

**Analog:** `www/tests/transport/mock-serial.js` — Phase 9 extension extends the existing
`SERIAL_MOCK` IIFE shape. The bot is a sibling test fixture: Playwright loads
both via `page.addInitScript()`.

**Shape pattern** (mock-serial.js:1-30 — verbatim file header + SERIAL_MOCK export pattern):

```js
// BestialiTTY Phase 5 Plan 01 (Wave 0) — Web Serial mock fixture.
//
// TEST-ONLY. Never imported from www/main.js or any production module.
// The exported SERIAL_MOCK string is passed to `page.addInitScript()` so the
// IIFE runs in the page context BEFORE any module loads — this is how the
// mock replaces `navigator.serial` before main.js's polite-fail gate evaluates.
//
// …

export const SERIAL_MOCK = `
(() => {
  // … module-scope state on window for spec introspection …
})();`;
```

Phase 9 sibling — extends `MockWriter.write` (mock-serial.js:62-71) to:
1. Parse incoming SLIDE frames (SOF + SEQ + LEN + payload + CRC).
2. Auto-emit ACK(seq) for every accepted frame via `__mockReaderPush` after a configurable per-frame delay.
3. Auto-emit RDY at session start (when first frame is seen).
4. Auto-emit FIN echo when CTRL_FIN is observed.

```js
export const MOCK_SERIAL_SLIDE_BOT = `
(() => {
  // Hook MockWriter.write to also drive the SLIDE-receiver bot side.
  // Assumes SERIAL_MOCK has already installed navigator.serial.
  if (!navigator.serial || !navigator.serial._grantedPorts) {
    console.error('[mock-slide-bot] SERIAL_MOCK must run first');
    return;
  }
  window.__mockSlideBot = {
    enabled: false,
    nakOnSeq: null,                  // when set, bot NAKs this seq once then resumes
    framesObserved: [],
    enable() { this.enabled = true; },
    disable() { this.enabled = false; },
  };

  // Patch — wrap MockWriter so test code can intercept.
  // (Or: install a frame parser that reads __mockWriterLog incrementally and
  //  pushes ACK/NAK back via __mockReaderPush.)
  // …
})();`;
```

**ACK/NAK injection via `__mockReaderPush`** is the existing hook at mock-serial.js:176-187 — the bot calls it after parsing each outbound frame.

---

## Shared Patterns

### Authentication / Authorization
None — there are no auth surfaces in this project. The Phase 8 wire-owner gate
(`'terminal'` vs `'slide'`) at `tx-sink.js:42` is the closest analog and Phase 9
inherits it unchanged.

### Error Handling
**Source:** `www/input/tx-sink.js:67-70, 122-125` (catch + console.error)
**Apply to:** `writeSlideFrameAwaitable` — CONTEXT D-16 says the awaitable variant
THROWS instead of swallowing (callers `await` and want the rejection). The
fire-and-forget `writeSlideFrame` keeps the catch.

```js
// fire-and-forget (existing — unchanged):
registeredWriter.write(bytes).catch((err) => {
    console.error('[tx-sink] writeSlideFrame failed:', err);
});
// awaitable (new — let the rejection propagate):
await registeredWriter.ready;
await registeredWriter.write(bytes);
```

### State machine drift detection
**Source:** `crates/bestialitty-core/tests/slide_boundary_shape.rs:42-94`
**Apply to:** Every Phase 9 Rust API addition — extend the fn-pointer pin
in BOTH `slide_boundary_shape.rs` and `slide_wasm_boundary_shape.rs` (their
sibling-mirror contract is documented at `slide_wasm_boundary_shape.rs:1-19`).

```rust
// fn-pointer coercion: catches signature drift at compile time.
let _: fn(&mut Slide, &[u8]) = Slide::enter_send_mode;
let _: fn(&mut Slide, &[u8], bool) = Slide::feed_send_chunk;
```

### Module-scope state + `wireXxx({…})` initializer
**Source:** `www/input/paste-pump.js:16-38` and `www/transport/slide.js:62-88`
**Apply to:** `www/input/file-source.js` (NEW) — every new JS module in this
project follows the pattern.

### EVT_*/STATE_* JS-side mirror constants
**Source:** `crates/bestialitty-core/tests/slide_boundary_shape.rs:slide_event_constants_pinned`
(authority) + `www/transport/slide.js:39-56` (mirror)
**Apply to:** Phase 9's two new EVT_* constants — extend the Rust pin AND the
JS mirror in lockstep. Per CONTEXT §"Established Patterns" ¶5: "single source of
truth is `slide_boundary_shape.rs`."

### Post-feed invariant (sampleBell → drainHostReply → requestFrame → sessionLog.append)
**Source:** `www/transport/slide.js:189-194` (`dispatchRecvMode`)
**Apply to:** Phase 9's `dispatchSendMode` — same chain because both feed inbound
bytes through `slide.feed_chunk`. Per CONTEXT §"Existing Code Insights" ¶8 the
chain "carries through Phase 9's `'send'` branch unchanged."

### `await writer.ready; await writer.write(bytes)` discipline
**Source:** PITFALLS §4 (research doc) + CONTEXT D-16
**Apply to:** Sender main loop only (CONTEXT D-17). The single legitimate
expansion is in `writeSlideFrameAwaitable` (§7 above); fire-and-forget
`writeSlideFrame` stays for control-byte writes.

### Stable-pointer outbound buffer discipline
**Source:** `crates/bestialitty-core/src/slide/state.rs:33-37` (`OUTBOUND_RESERVE = 16`)
**Apply to:** Phase 9 grows to `4128` (per CONTEXT §"Existing Code Insights" ¶7).
The mirror `OUTBOUND_VIEW_CAP` in `www/transport/slide.js:78` must be grown in
lockstep. Add a new test
`outbound_ptr_stable_across_sender_window_pushes` in `state.rs::tests` per
VALIDATION row.

---

## No Analog Found

None. Every Phase 9 file has a strong analog in the existing codebase. The
two file types where the analogs are weakest:

| File | Role | Reason / Mitigation |
|---|---|---|
| `www/tests/transport/mock-serial-slide-bot.js` | extension to mock-serial.js | The bot is novel — no existing test in the repo parses outbound SLIDE frames. The analog is `mock-serial.js`'s shape; the parser logic is novel and the planner sources it from `slide-rs/protocol.rs:111-196` (`recv_frame`) translated to JS. |
| `<dialog>` modal in `index.html` | new DOM idiom | No `<dialog>` element exists yet in the repo. Per CONTEXT §"Prior phase context" ¶ Phase 6: "<dialog>-shaped modals (none yet — Phase 9 introduces this idiom; Phase 12 may extend for filename-collision UX SLIDE-36)." Native browser `<dialog>` + minimal CSS is the planner-default. |

---

## Metadata

**Analog search scope:**
- `crates/bestialitty-core/src/` (Rust core)
- `crates/bestialitty-core/tests/` (Rust integration tests)
- `www/` (JS shell, excluding `node_modules` and `pkg`)
- `www/tests/` (Playwright specs and fixtures)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/` (upstream reference impl)

**Files scanned for analog selection:**
- `crates/bestialitty-core/src/slide/state.rs` (550 lines — receiver SM + tests; the verbatim template for §1)
- `crates/bestialitty-core/src/slide/framer.rs` (333 lines — DFA + EVT_* constants; verbatim template for §2)
- `crates/bestialitty-core/src/slide/mod.rs` (42 lines — re-exports)
- `crates/bestialitty-core/src/slide/tests.rs` (82 lines — module-level smokes)
- `crates/bestialitty-core/src/slide/tests_only.rs` (121 lines — fixture corpus)
- `crates/bestialitty-core/src/lib.rs` (303 lines — wasm façade; verbatim template for §3)
- `crates/bestialitty-core/tests/slide_boundary_shape.rs` (112 lines — verbatim template for §4)
- `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` (118 lines — sibling-mirror template for §5)
- `crates/bestialitty-core/tests/slide_torn_chunk.rs` (216 lines — verbatim template for §11)
- `crates/bestialitty-core/tests/slide_idempotent_reentry.rs` (123 lines — re-entry test naming)
- `www/transport/slide.js` (254 lines — Phase 8 dispatcher; verbatim template for §6)
- `www/input/tx-sink.js` (133 lines — verbatim template for §7)
- `www/input/paste-pump.js` (165 lines — verbatim template for §8 module shape)
- `www/renderer/scroll-state.js` (213 lines — verbatim template for `[data-drop-target]` idiom in §8/§9)
- `www/transport/session-log.js` (111 lines — wireXxx + reset shape)
- `www/index.html` (698 lines — verbatim template for §9 — top-bar + chip + wrapper-children patterns)
- `www/main.js` (649 lines — verbatim template for §10 — boot wiring)
- `www/tests/transport/mock-serial.js` (188 lines — verbatim template for §14)
- `www/tests/transport/slide-dispatcher.spec.js` (195 lines — verbatim template for §12)
- `www/tests/transport/slide-wakeup.spec.js` (306 lines — per-test reset template)
- `www/tests/input/tx-sink.spec.js` (read for namespace placement)
- `www/renderer/chrome.js` (button event-wiring patterns at lines 92-107)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` (244 lines — upstream byte-encoding reference for §2)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/send.rs` lines 155-249 (sender-SM control-flow reference for §1 D-11)

**Pattern extraction date:** 2026-05-08
