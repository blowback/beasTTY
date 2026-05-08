# Phase 10: SLIDE Receiver & Cancellation — Pattern Map

**Mapped:** 2026-05-08
**Files analyzed:** 16 (8 modified, 8 new)
**Analogs found:** 16 / 16 (one new file — `idb.js` — is a category-first IndexedDB module; closest in-repo analog is the simplest `wireXxx` module, with browser-API call patterns drawn from MDN cited in 10-RESEARCH.md)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `crates/bestialitty-core/src/slide/state.rs` | model (state machine) | byte-fed transform + event emission | same file (Phase 7 receiver SM + Phase 9 sender extension at `state.rs:386-461`) | exact (in-place extension) |
| `crates/bestialitty-core/src/slide/framer.rs` | model (constants) | declarative | same file (Phase 9 EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE / EVT_RETRANSMIT_NEEDED additions at `framer.rs:40-43`) | exact |
| `crates/bestialitty-core/src/lib.rs` | wasm boundary façade | one-line forwards | same file `mod wasm_boundary` Slide impl at `lib.rs:198-313` (especially Phase 9 `enter_send_mode` / `feed_send_chunk` / `send_current_file_idx` forwards at lines 286-312) | exact |
| `crates/bestialitty-core/tests/slide_boundary_shape.rs` | test (compile-time pin) | fn-pointer coercion | same file Phase 9 `slide_send_methods_have_stable_signatures` at lines 50-59 + `slide_event_constants_pinned` Phase 9 extension at lines 107-113 | exact |
| `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` | test (compile-time pin) | fn-pointer coercion | same file Phase 9 mirror at lines 49-64 + 115-126 | exact |
| `crates/bestialitty-core/tests/slide_recv_payload.rs` (NEW) | test (unit) | drive SM + read recv accessors | `tests/slide_torn_chunk.rs` (outbound_snapshot helper + `Slide::new() + enter_recv_mode + feed_chunk` driver shape) | role-match |
| `crates/bestialitty-core/tests/slide_recv_corpus.rs` (NEW) | test (corpus) | end-to-end recv with fixtures | `tests/slide_torn_chunk.rs` (fixture-driven SM corpus) + `tests/slide_sender.rs` (mock-peer cross-validation pattern) | exact |
| `crates/bestialitty-core/tests/slide_torn_chunk.rs` | test (existing corpus) | extend with new fixtures | self (Phase 7 ship) | exact |
| `www/transport/slide-recv.js` (NEW) | service (per-mode I/O) | event-driven (SLIDE events → per-file accumulator → Blob → download) | `www/transport/session-log.js` (chunks/Blob/anchor-click) + `www/transport/slide.js` `dispatchSendMode` async per-chunk lifecycle (lines 527-533) + `www/input/file-source.js` (module-scope state + wireXxx initializer + injected deps) | exact (composite) |
| `www/transport/slide.js` | controller (dispatcher) | byte routing + mode-state authority | same file `dispatchTerminalMode` 7-byte matcher at lines 229-310 + `dispatchRecvMode` straight-pass stub at lines 312-317 | exact (in-place extension) |
| `www/state/idb.js` (NEW) | utility (storage adapter) | request-response (open DB + get/put/delete one key) | `www/state/prefs.js` (module-scope `cached`, lazy init, try/catch swallow + console.warn) — NOTE: prefs uses localStorage; idb.js uses IndexedDB so storage primitive is browser-native (MDN-documented) | role-match (storage primitive differs) |
| `www/state/prefs.js` | utility (DEFAULTS extension) | declarative | same file Phase 6 DEFAULTS block at lines 18-29 | exact (one-line addition) |
| `www/input/keyboard.js` | controller (input dispatch) | event-driven (keydown chain) | same file Phase 5 D-18 paste-cancel arm at lines 222-229 (insertion template) + Phase 6 D-19 selection-cancel arm at lines 216-220 | exact (in-place insertion) |
| `www/index.html` | view (Settings DOM + CSS) | declarative | same file Phase 6 `auto-connect-checkbox` Settings row at lines 819-825 + `clear-scrollback-button` row at 815-818 + Phase 6 `.settings-row button` CSS at lines 232-250 | exact |
| `www/main.js` | controller (boot wiring) | declarative wireXxx calls | same file Phase 8 `wireSlideDispatcher` at lines 388-399 + Phase 9 `wireFileSource` at lines 421-449 + Phase 6 `wireSessionLog` at lines 372-386 | exact |
| `www/tests/transport/slide-recv.spec.js` (NEW) | test (Playwright e2e) | mock bot driver + assertion | `www/tests/transport/slide-sender.spec.js` (Phase 9 setup + `__mockSlideBot.reset` + `__mockReaderPush` + introspection assertions) | exact |
| `www/tests/transport/slide-cancel.spec.js` (NEW) | test (Playwright e2e) | cancel sequence + state assertion | `www/tests/transport/slide-sender.spec.js` setup + `slide-dispatcher.spec.js` mode-introspection patterns | exact |
| `www/tests/transport/mock-serial-slide-bot.js` | test infrastructure (extension) | event-driven role-gated SM | self (Phase 9 receiver-role bot at lines 60-283) — Phase 10 adds sender-role state machine | exact (in-place extension) |

## Pattern Assignments

### `crates/bestialitty-core/src/slide/state.rs` (model, byte-fed transform + event emission)

**Analog:** same file (Phase 7 receiver SM transition arms at lines 466-555; Phase 9 sender-role gate at lines 386-461)

**Imports pattern** (existing file — no new imports for Phase 10 if recv events stay in-module; if a new `parse_header_payload` helper is added, it lives inline in the same module):
```rust
// state.rs:18-26 — existing imports verbatim
use std::collections::VecDeque;
use super::framer::{
    Framer, EVT_NONE, EVT_RDY, EVT_ACK, EVT_NAK, EVT_FIN, EVT_CAN,
    EVT_DATA_FRAME, EVT_CRC_ERROR,
    EVT_FILE_COMPLETE, EVT_SESSION_COMPLETE, EVT_RETRANSMIT_NEEDED,
    CTRL_RDY, CTRL_ACK, CTRL_NAK, CTRL_FIN, CTRL_CAN,
    build_frame_into,
};
```
Phase 10 adds `EVT_HEADER_RECEIVED, EVT_RECV_DATA, EVT_RECV_FILE_DONE` to this `use` block (and to `framer.rs` const declarations) when new events land.

**Stable-pointer accessor triple — copy verbatim shape from outbound triple at `state.rs:355-367`:**
```rust
// state.rs:355-367 — existing outbound triple (THE TEMPLATE for recv triple)
pub fn outbound_ptr(&self) -> *const u8 {
    self.outbound_buf.as_ptr()
}
pub fn outbound_len(&self) -> usize {
    self.outbound_buf.len()
}
pub fn clear_outbound(&mut self) {
    self.outbound_buf.clear();
}
```
**Phase 10 mirror** (per RESEARCH §Pattern 1 default option (b)):
```rust
pub fn recv_ptr(&self) -> *const u8 { self.recv_buf.as_ptr() }
pub fn recv_len(&self) -> usize { self.recv_buf.len() }
pub fn clear_recv(&mut self) { self.recv_buf.clear(); }
pub fn recv_filename_ptr(&self) -> *const u8 { self.recv_filename.as_ptr() }
pub fn recv_filename_len(&self) -> usize { self.recv_filename.len() }
pub fn recv_file_size(&self) -> u32 { self.recv_file_size }
```

**`Slide` struct field-extension pattern — copy from existing `outbound_buf` declaration at `state.rs:108-117`:**
```rust
// state.rs:108-117 — existing field block (extension template)
outbound_buf: Vec<u8>,
events: VecDeque<u32>,
send_ctx: Option<SendCtx>,
```
Phase 10 adds:
```rust
recv_buf: Vec<u8>,                  // pre-reserved FRAME_SIZE = 1024
recv_filename: Vec<u8>,             // pre-reserved 16 (CP/M 8.3 + null + slack)
recv_file_size: u32,
recv_file_idx: u32,                 // 0-based; advances per EVT_HEADER_RECEIVED
```
Initialise in `Slide::new()` at lines 120-131 alongside `outbound_buf: Vec::with_capacity(OUTBOUND_RESERVE)`.

**SM-arm extension pattern — copy from `state.rs:480-498` (HeaderPhase EVT_DATA_FRAME arm) + `state.rs:509-535` (DataPhase arm):**
```rust
// state.rs:480-498 — existing HeaderPhase arm (THE TEMPLATE for header-payload extraction)
(SlideState::HeaderPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
    if aux == 0 {
        // Header validated by application layer; for the SM,
        // seq=0 marker is sufficient. ACK and advance to DataPhase.
        self.outbound_buf.push(CTRL_ACK);
        self.outbound_buf.push(0);
        self.expected_seq = 1;
        self.nak_retry_count = 0;
        self.sm_state = SlideState::DataPhase;
    } else {
        self.sm_state = SlideState::Error;
    }
}
```
**Phase 10 extension shape** — see RESEARCH Example 1 (lines 921-961). Insert payload-parse + recv_filename/recv_file_size population BEFORE the existing `outbound_buf.push(CTRL_ACK)` so JS sees `EVT_HEADER_RECEIVED` ahead of state-transition events.

**SM-arm extension for DataPhase (recv payload stash) — RESEARCH Example 2 (lines 963-1005). Insert `recv_buf.clear() + extend_from_slice` + `events.push_back(EVT_RECV_DATA | aux)` BEFORE the existing per-window ACK push at `state.rs:521-530`. Insert `events.push_back(EVT_RECV_FILE_DONE)` BEFORE the loop-to-HeaderPhase at `state.rs:514-520`.

**MUST NOT change existing ACK/NAK timing or counts** (CONTEXT canonical-refs note) — Phase 7 cargo tests at `state.rs:584-` pin those.

**Cancel/force_idle pattern (already implemented; Phase 10 calls these from JS):**
```rust
// state.rs:329-348 — D-06 idempotent cancel + force_idle escape hatch
pub fn cancel(&mut self) {
    if matches!(self.sm_state, SlideState::CancelPending | SlideState::Done | SlideState::Error) {
        return;
    }
    self.outbound_buf.push(CTRL_CAN);
    self.sm_state = SlideState::CancelPending;
}
pub fn force_idle(&mut self) {
    self.sm_state = SlideState::Done;
    self.outbound_buf.clear();
}
```
Phase 10 does NOT modify `cancel()` / `force_idle()` — these are the Phase 7 D-06 contract that Phase 10 CONSUMES from JS.

---

### `crates/bestialitty-core/src/slide/framer.rs` (model, declarative constants)

**Analog:** same file Phase 9 EVT_* extension at lines 40-43

**Pattern (constants block at framer.rs:31-43):**
```rust
// framer.rs:31-43 — existing EVT_* block (THE TEMPLATE)
pub const EVT_NONE:       u32 = 0;
pub const EVT_RDY:        u32 = 1 << 16;
pub const EVT_ACK:        u32 = 2 << 16;  // aux = seq
pub const EVT_NAK:        u32 = 3 << 16;  // aux = seq
pub const EVT_FIN:        u32 = 4 << 16;
pub const EVT_CAN:        u32 = 5 << 16;
pub const EVT_DATA_FRAME: u32 = 6 << 16;  // aux = seq
pub const EVT_CRC_ERROR:  u32 = 7 << 16;  // aux = seq
// ===== Phase 9 sender extensions =====
pub const EVT_FILE_COMPLETE:    u32 = 8 << 16;   // aux = file_idx
pub const EVT_SESSION_COMPLETE: u32 = 9 << 16;
pub const EVT_RETRANSMIT_NEEDED: u32 = 10 << 16;  // aux = seq
```
**Phase 10 extension** (planner picks final names + numbers; suggested per RESEARCH):
```rust
// ===== Phase 10 receiver extensions =====
pub const EVT_HEADER_RECEIVED: u32 = 11 << 16;   // aux = file_idx
pub const EVT_RECV_DATA:       u32 = 12 << 16;   // aux = seq
pub const EVT_RECV_FILE_DONE:  u32 = 13 << 16;   // aux = file_idx (or 0)
```
Numbering rule (from Phase 9 comment): "must NOT shift any existing 0..7 value" — the pin tests at `slide_boundary_shape.rs:107-113` and `slide_wasm_boundary_shape.rs:115-126` enforce this.

---

### `crates/bestialitty-core/src/lib.rs` (wasm boundary façade, one-line forwards)

**Analog:** same file `mod wasm_boundary` Slide impl at lines 203-313

**Pattern (existing forwards at lib.rs:255-312):**
```rust
// lib.rs:255-269 — existing outbound triple forwards (THE TEMPLATE)
pub fn outbound_ptr(&self) -> *const u8 {
    self.inner.outbound_ptr()
}
pub fn outbound_len(&self) -> usize {
    self.inner.outbound_len()
}
pub fn clear_outbound(&mut self) {
    self.inner.clear_outbound();
}
```

**Phase 9 sender forwards at lib.rs:286-312 — exact insertion-style template:**
```rust
// lib.rs:286-312 — Phase 9 send-mode forwards (verbatim insertion shape)
pub fn enter_send_mode(&mut self, metadata: &[u8]) {
    self.inner.enter_send_mode(metadata);
}
pub fn feed_send_chunk(&mut self, payload: &[u8], eof: bool) {
    self.inner.feed_send_chunk(payload, eof);
}
pub fn send_current_file_idx(&self) -> u32 {
    self.inner.send_current_file_idx()
}
```
**Phase 10 mirror** (six new one-line forwards, alphabetised next to `outbound_*`):
```rust
pub fn recv_ptr(&self) -> *const u8 { self.inner.recv_ptr() }
pub fn recv_len(&self) -> usize { self.inner.recv_len() }
pub fn clear_recv(&mut self) { self.inner.clear_recv(); }
pub fn recv_filename_ptr(&self) -> *const u8 { self.inner.recv_filename_ptr() }
pub fn recv_filename_len(&self) -> usize { self.inner.recv_filename_len() }
pub fn recv_file_size(&self) -> u32 { self.inner.recv_file_size() }
```
ADR-002: gate stays `#[cfg(target_arch = "wasm32")] mod wasm_boundary`. No new imports needed (CoreSlide already in scope at line 39).

---

### `crates/bestialitty-core/tests/slide_boundary_shape.rs` (test, fn-pointer pin)

**Analog:** same file Phase 9 extension at lines 50-59 + 107-113

**Pattern (existing fn-pointer pin block at lines 50-59):**
```rust
// slide_boundary_shape.rs:50-59 — Phase 9 sender-method pin (THE TEMPLATE)
#[test]
fn slide_send_methods_have_stable_signatures() {
    let _: fn(&mut Slide, &[u8])       = Slide::enter_send_mode;
    let _: fn(&mut Slide, &[u8], bool) = Slide::feed_send_chunk;
    let _: fn(&Slide) -> u32           = Slide::send_current_file_idx;
}
```
**Phase 10 extension** — add a sibling test:
```rust
#[test]
fn slide_recv_payload_methods_have_stable_signatures() {
    let _: fn(&Slide) -> *const u8     = Slide::recv_ptr;
    let _: fn(&Slide) -> usize         = Slide::recv_len;
    let _: fn(&mut Slide)              = Slide::clear_recv;
    let _: fn(&Slide) -> *const u8     = Slide::recv_filename_ptr;
    let _: fn(&Slide) -> usize         = Slide::recv_filename_len;
    let _: fn(&Slide) -> u32           = Slide::recv_file_size;
}
```

**EVT_* const pin extension pattern (lines 107-113):**
```rust
// slide_boundary_shape.rs:107-113 — Phase 9 sender-EVT pin (THE TEMPLATE)
assert_eq!(EVT_FILE_COMPLETE     >> 16, 8);
assert_eq!(EVT_SESSION_COMPLETE  >> 16, 9);
assert_eq!(EVT_RETRANSMIT_NEEDED >> 16, 10);
assert_eq!(EVT_FILE_COMPLETE     & 0xFFFF, 0);
assert_eq!(EVT_SESSION_COMPLETE  & 0xFFFF, 0);
assert_eq!(EVT_RETRANSMIT_NEEDED & 0xFFFF, 0);
```
Phase 10 appends three more `assert_eq!` lines for `EVT_HEADER_RECEIVED >> 16, 11` etc., updating the import list at `slide_boundary_shape.rs:22-27`.

**Runtime reachability test extension at lines 148-176:** follow the Phase 9 pattern (`let mut slide2 = Slide::new(); ... <call new methods>`) — no further commentary needed.

---

### `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` (test, fn-pointer pin — wasm side)

**Analog:** sibling-mirror of `slide_boundary_shape.rs` — same shape, same content delta. Phase 10 extends both files in lockstep. See "EVT_* mirror invariant" in CONTEXT — Rust pin (this file + sibling) and JS-side mirror in `transport/slide.js:49-64` are the three legs.

---

### `crates/bestialitty-core/tests/slide_recv_payload.rs` (NEW; test, unit)

**Analog:** `crates/bestialitty-core/tests/slide_torn_chunk.rs` (driver shape) + `tests/slide_idempotent_reentry.rs` (drain_events helper)

**Imports + helpers pattern (slide_torn_chunk.rs:1-25):**
```rust
// slide_torn_chunk.rs:1-25 — driver helpers (THE TEMPLATE)
use bestialitty_core::slide::tests_only::*;

fn outbound_snapshot(slide: &Slide) -> Vec<u8> {
    let len = slide.outbound_len();
    if len == 0 {
        return Vec::new();
    }
    unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), len).to_vec() }
}
```
Phase 10 mirrors this with `recv_snapshot(slide)` and `recv_filename_string(slide)` helpers using the new triple.

**`drain_events` helper (slide_idempotent_reentry.rs:17-23):**
```rust
fn drain_events(slide: &mut Slide) -> usize {
    let mut count = 0usize;
    while slide.take_event_packed() != EVT_NONE {
        count += 1;
    }
    count
}
```
Phase 10 needs a variant that COLLECTS events (returns `Vec<u32>`) so the test can assert event order: EVT_HEADER_RECEIVED arrives BEFORE the first EVT_RECV_DATA in the same chunk (RESEARCH Assumption A7).

**Test body shape (mirror of `slide_torn_chunk.rs:97-115` `torn_header_test_txt`):**
```rust
#[test]
fn recv_zero_byte_file_completes_with_empty_chunks() {
    let mut s = Slide::new();
    s.enter_recv_mode();
    s.feed_chunk(&[CTRL_RDY]);
    // Header for zero-byte file → immediate EOF marker
    // [drive header frame + EOF data frame]
    // Assert: recv_filename matches, recv_file_size == 0, EVT_RECV_FILE_DONE emitted
}
```

---

### `crates/bestialitty-core/tests/slide_recv_corpus.rs` (NEW; test, end-to-end corpus)

**Analog:** `tests/slide_torn_chunk.rs` (fixture-driven SM corpus) + `tests/slide_sender.rs` (mock-peer cross-validation pattern; PITFALLS §13)

**Mock sender bot pattern (Phase 10 may need a Rust-side mock SENDER bot to cross-validate the receiver — INVERSE of `tests/slide_sender.rs`'s mock receiver). Skeleton from `tests/slide_sender.rs:53-100`:**
```rust
// slide_sender.rs:55-96 — MockReceiver state struct (THE TEMPLATE for MockSender)
#[derive(Clone, Copy, PartialEq, Eq)]
enum BotInjectMode {
    None,
    NakOnFirstFrame,
    CanMidStream,
}
struct MockReceiver {
    mode: BotInjectMode,
    received_files: Vec<Vec<u8>>,
    received_filenames: Vec<Vec<u8>>,
    parse_buf: Vec<u8>,
    nak_already_injected: bool,
    can_already_injected: bool,
    fin_observed: bool,
    rdy_emitted: bool,
    awaiting_retransmit: Option<u8>,
}
```
Phase 10 mirror would be `MockSender { files: Vec<(Vec<u8>, Vec<u8>)>, /* (name, payload) */ ack_observed_seqs: Vec<u8>, ... }` — but per CONTEXT canonical-refs the recv corpus mainly drives PRODUCTION receiver SM with HAND-BUILT fixtures from `slide-rs/protocol.rs`, not a separate bot. The planner picks: native cargo corpus may be just fixture-driven (no bot) since the mock-sender complexity lives in `www/tests/transport/mock-serial-slide-bot.js`.

**Helper: pseudo_random_bytes (slide_sender.rs:37-48):**
```rust
fn pseudo_random_bytes(len: usize) -> Vec<u8> {
    // Deterministic pseudo-random — xorshift32 seeded with fixed seed
    let mut out = Vec::with_capacity(len);
    let mut state: u32 = 0xdeadbeef;
    for _ in 0..len {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        out.push((state & 0xFF) as u8);
    }
    out
}
```
**Reuse verbatim** for the 1 MB fixture (CONTEXT — 1 MB+ memory smoke).

**`pack_metadata` helper (slide_sender.rs:25-35):**
```rust
fn pack_metadata(files: &[(&str, u32)]) -> Vec<u8> {
    let mut m = Vec::new();
    m.extend_from_slice(&(files.len() as u32).to_le_bytes());
    for (name, size) in files {
        let nb = name.as_bytes();
        m.extend_from_slice(&(nb.len() as u32).to_le_bytes());
        m.extend_from_slice(nb);
        m.extend_from_slice(&size.to_le_bytes());
    }
    m
}
```
For Phase 10's recv corpus the analog is `build_header_frame(name, size) -> Vec<u8>` — see `slide-rs/protocol.rs:47-56` referenced in canonical-refs; produce a SLIDE-spec-compliant header frame as a hand-built byte sequence to feed the receiver SM.

---

### `crates/bestialitty-core/tests/slide_torn_chunk.rs` (existing; extend)

**Analog:** self. Phase 10 adds `recv`-flavoured fixtures (zero-byte, sub-frame, binary, max-payload variations) to the fixture list at `slide_torn_chunk.rs:97-215`, following the existing `assert_identical_across_splits` and `assert_identical_across_log_splits` test idioms.

**Existing test pattern verbatim (lines 97-105):**
```rust
#[test]
fn torn_header_test_txt() {
    assert_identical_across_splits(
        &[CTRL_RDY],
        FIXTURE_HEADER_TEST_TXT,
        "FIXTURE_HEADER_TEST_TXT",
    );
}
```
Phase 10 adds parallel tests for: zero-byte file (header + EOF marker only), sub-frame file (1 data frame + EOF), binary `.COM` payload (high-byte fixture), 1 MB+ multi-frame stream.

---

### `www/transport/slide-recv.js` (NEW; service, event-driven)

**Analog 1 (per-file accumulator + Blob + anchor-click):** `www/transport/session-log.js` (entire file, 111 LOC)

**Imports pattern (session-log.js:1-17):** verbatim header-comment idiom (sources, decisions referenced).

**Module-scope state pattern (session-log.js:18-27):**
```js
// session-log.js:18-27 — module-scope state declaration block
let chunks = [];
let totalBytes = 0;
let downloadBtnRef = null;

const TOOLTIP_DISABLED = 'No bytes received yet';
const TOOLTIP_ENABLED = 'Download all bytes received this connection (.bin)';
```
**Phase 10 mirror:**
```js
let currentFile = null;     // { name, totalBytes, chunks: Uint8Array[], bytesDone }
let inflightDownloads = []; // Promise[] for cancel-time settle (PITFALLS §5)
let cancelInFlight = false; // idempotent cancel guard
let sessionFolderFallback = false;  // D-04 picker dismissal stays-fallen-back-for-this-session
let prefsRef = null;
let txSinkRef = null;
let slideRef = null;        // injected from slide.js
let wasmRef = null;
```

**`wireXxx({...})` initializer pattern (session-log.js:32-40):**
```js
// session-log.js:32-40 — wireSessionLog({ downloadButton }) — THE TEMPLATE
export function wireSessionLog(opts) {
    downloadBtnRef = opts.downloadButton;
    if (downloadBtnRef) {
        downloadBtnRef.addEventListener('click', download);
        downloadBtnRef.addEventListener('mousedown', (e) => e.preventDefault());
    }
    setButtonState(false);
}
```
**Phase 10 mirror:** `wireSlideRecv({ wrapperEl, prefs, idb, slide, txSink, wasm, folderButton, folderToggle, statusSpan })` — mounts Settings-row event listeners + caches injected refs. Idempotent across `__resetForTests()` calls (Phase 8 dispatcher precedent).

**Anchor-click download pattern (session-log.js:62-85) — copy verbatim, parameterise filename:**
```js
// session-log.js:62-85 — Blob + URL.createObjectURL + synthetic <a>.click() (THE TEMPLATE)
export function download() {
    if (totalBytes === 0) return;
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameForNow();
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
```
**Phase 10 mirror** (RESEARCH Pattern 3, slide-recv.js):
```js
function downloadViaAnchor(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;        // CP/M name verbatim from recv_filename
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
```
Shared `URL.revokeObjectURL` 5-second delay is the existing Phase 6 hygiene defense; reuse the literal `5000` once and reference via comment (Phase 5 grep-hygiene rule: "single authoritative source").

**Analog 2 (zero-copy view drain + Pitfall 4 re-derive + Pitfall 5 slice-before-await):** `www/transport/slide.js` `drainSlideOutbound` at lines 330-344

**Pitfall 4 + 5 pattern (slide.js:330-344):**
```js
// slide.js:330-344 — outbound view drain (THE TEMPLATE for recv view drain)
function drainSlideOutbound() {
    const len = slide.outbound_len();
    if (len === 0) return;
    // Pitfall 4 — re-derive the view if memory.buffer detached/grew.
    if (wasmRef.memory.buffer !== outboundBuffer) {
        outboundBuffer = wasmRef.memory.buffer;
        outboundView = new Uint8Array(outboundBuffer, slide.outbound_ptr(), OUTBOUND_VIEW_CAP);
    }
    // Pitfall 5 — slice to JS-owned buffer BEFORE await writer.write
    const owned = new Uint8Array(outboundView.subarray(0, len));
    txSinkRef.writeSlideFrame(owned);
    slide.clear_outbound();
}
```
**Phase 10 mirror — `sliceRecvBytesToOwned()` helper:**
```js
let recvBuffer = null, recvView = null;
const RECV_VIEW_CAP = 1024;   // FRAME_SIZE in framer.rs
function sliceRecvBytesToOwned() {
    const len = slideRef.recv_len();
    if (len === 0) return new Uint8Array(0);
    if (wasmRef.memory.buffer !== recvBuffer) {
        recvBuffer = wasmRef.memory.buffer;
        recvView = new Uint8Array(recvBuffer, slideRef.recv_ptr(), RECV_VIEW_CAP);
    }
    const owned = new Uint8Array(recvView.subarray(0, len));   // copy BEFORE any await
    slideRef.clear_recv();
    return owned;
}
```
Same Pitfall 4 re-derive guard, same Pitfall 5 slice-before-await discipline. Mirror separately for `recv_filename` view (cap = 16: 8.3 + null + slack).

**Analog 3 (async per-chunk lifecycle + cancel sequence):** `www/transport/slide.js` `dispatchSendMode` at lines 527-533 + RESEARCH Pattern 8 verbatim

**Async per-chunk pattern (slide.js:527-533):**
```js
// slide.js:527-533 — dispatcher-driven async chunk lifecycle (THE TEMPLATE)
async function dispatchSendMode(value) {
    feedSlide(value);
    await drainEventsAndOutboundAwaitable();
    pumpNextDataChunkIfReady();
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();
}
```
Phase 10's `cancelSlideRecv()` is the sole async function in `slide-recv.js` (per-chunk recv path is SYNC — feed/drain/payload-pump are synchronous; the cancel sequence with `await Promise.race + delay` is the async island per RESEARCH Anti-Pattern note "Synchronous `await` inside `dispatchInbound`").

**Cancel-sequence verbatim pattern — RESEARCH §Pattern 8 (lines 595-643):** the planner copies this 5-step sequence into `slide-recv.js` verbatim. Critical: `slide.cancel()` is idempotent (D-06); `cancelInFlight` guard makes JS-side `cancelSlideRecv()` also idempotent. 2-second `Promise.race` wraps the entire body (ADR-003 §3 escape hatch).

**Analog 4 (module-scope state + injected deps + `__resetForTests` test introspection):** `www/input/file-source.js` lines 20-66 + `www/transport/slide.js:184-225`

**`__resetForTests` pattern (slide.js:184-200):**
```js
// slide.js:184-200 — test introspection reset (THE TEMPLATE)
export function __resetForTests() {
    mode = 'terminal';
    wakeIdx = 0;
    if (slide) {
        if (typeof slide.free === 'function') slide.free();
        slide = null;
    }
    if (txSinkRef && typeof txSinkRef.setWireOwner === 'function') {
        txSinkRef.setWireOwner('terminal');
    }
    pendingSendSession = null;
    currentSendCtx = null;
    sendDispatchTail = Promise.resolve();
}
```
Phase 10's slide-recv mirror clears `currentFile`, `inflightDownloads`, `cancelInFlight`, `sessionFolderFallback`, and revokes any object URLs left from the prior test. Exposed via `window.__slideRecv` in `main.js` (mirror of Phase 9's `window.__fileSource`).

**Analog 5 (`window.__slide` introspection extension — Phase 9 D-18 shape):** `slide.js:201-225`

**Phase 9 introspection at slide.js:201-225 (THE TEMPLATE for Phase 10 recv-mode fields):**
```js
export function __getStateForTests() {
    const baseState = {
        mode, wakeIdx, hasSlide: slide !== null,
        hasPendingSendSession: pendingSendSession !== null,
    };
    if (slide && currentSendCtx) {
        return {
            ...baseState,
            state: slide.state(),
            file_idx: currentSendCtx.currentFileIdx,
            total_files: currentSendCtx.fileBytes.length,
            bytes_in_file_done: currentSendCtx.sentBytesInFile,
            bytes_in_file_total: currentSendCtx.fileBytes[currentSendCtx.currentFileIdx]?.length ?? 0,
            current_filename: null,
        };
    }
    return baseState;
}
```
Phase 10 extends with a sibling `if (slide && mode === 'recv') return { ..., current_filename, bytes_in_file_done: currentFile?.bytesDone ?? 0, bytes_in_file_total: currentFile?.totalBytes ?? 0, recv_to_folder, cancelRecv: cancelSlideRecv };` clause. CONTEXT §"`window.__slide` recv-mode shape" specifies exact field set.

---

### `www/transport/slide.js` (controller; in-place extension)

**Analog:** self — `dispatchTerminalMode` 7-byte matcher at lines 229-310 (template for mid-session re-entry matcher per CONTEXT Claude's Discretion default option (a)) + `dispatchRecvMode` straight-pass stub at lines 312-317.

**Pattern (existing matcher at slide.js:229-310) — THE TEMPLATE for Phase 10 mid-session re-entry detection:**
```js
// slide.js:229-310 — dispatchTerminalMode 7-byte ESC^SLIDE matcher (verbatim shape)
function dispatchTerminalMode(value) {
    const pending = [];
    let i = 0;
    while (i < value.length) {
        const b = value[i];
        if (b === WAKEUP[wakeIdx]) {
            if (wakeIdx < 6) scratch[wakeIdx] = b;
            wakeIdx++;
            if (wakeIdx === 7) {
                // Full match — flush benign bytes BEFORE wakeup ...
                // Then enterSendModeInternal OR enterRecvMode based on pendingSendSession.
                // Forward chunk tail (Pitfall 2 — value.subarray(i+1)).
                ...
            }
        } else {
            if (wakeIdx > 0) {
                for (let k = 0; k < wakeIdx; k++) pending.push(scratch[k]);
                wakeIdx = 0;
                if (b === WAKEUP[0]) { scratch[0] = b; wakeIdx = 1; }
                else { pending.push(b); }
            } else { pending.push(b); }
        }
        i++;
    }
    if (pending.length) termRef.feed(new Uint8Array(pending));
}
```
**Phase 10 dispatchRecvMode extension** — RESEARCH Pattern 9 (lines 656-721): walk byte-by-byte, run matcher in parallel with framer feed. On match: feed bytes BEFORE the signature to the current SM (last-ditch ACKs), drain events+outbound, console.warn ("Z80 reset detected"), `slide.force_idle()`, `exitRecvMode()`, `enterRecvMode()`, then forward bytes AFTER the signature to the new SM. **Note** RESEARCH Open Question 4: planner has Discretion to keep matcher inline (~25 LOC duplication) OR extract to `wakeupMatcher.js` helper module. Default = inline.

**Existing dispatchRecvMode stub at slide.js:312-317 — REPLACED by Phase 10:**
```js
// slide.js:312-317 — current 5-line straight-pass (REPLACED by Phase 10)
function dispatchRecvMode(value) {
    feedSlide(value);
    drainEventsAndOutbound();
    maybeExitRecvMode();
}
```

**`drainEventsAndOutbound` extension at slide.js:323-328** — Phase 10 adds switch on event kind to delegate `EVT_HEADER_RECEIVED / EVT_RECV_DATA / EVT_RECV_FILE_DONE` to `slide-recv.js`'s `onRecvEvent(evt)`. Today's body drains-to-no-op:
```js
function drainEventsAndOutbound() {
    while (slide.take_event_packed() !== EVT_NONE) { /* drain */ }
    drainSlideOutbound();
}
```
Phase 10 replaces the no-op drain with a switch comparable to Phase 9's awaitable variant at `slide.js:540-606`.

**Mode introspection extension** — `__getStateForTests` at lines 201-225 gains the recv-mode branch (see §slide-recv.js Analog 5 above).

---

### `www/state/idb.js` (NEW; utility, IndexedDB storage)

**Analog (closest match for module shape):** `www/state/prefs.js` — module-scope cached state, lazy init, try/catch swallow with `console.warn` logging.

**Module shape pattern (prefs.js:31-33 module-scope + 35-64 loadPrefs lazy init):**
```js
// prefs.js:31-33 — module-scope cache (THE TEMPLATE for dbPromise)
let cached = null;
let saveTimer = null;
const subscribers = [];

// prefs.js:35-64 — loadPrefs with defensive try/catch + fallback to defaults
export function loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            cached = structuredClone(DEFAULTS);
            return cached;
        }
        ...
    } catch (err) {
        console.warn('[prefs] load failed; falling back to defaults', err);
        cached = structuredClone(DEFAULTS);
        return cached;
    }
}
```

**`flushPrefs` swallow-then-warn pattern (prefs.js:82-97):**
```js
// prefs.js:82-97 — quota / SecurityError swallow with console.warn (THE TEMPLATE)
function flushPrefs() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
    } catch (err) {
        if (err && err.name === 'QuotaExceededError') {
            console.warn('[prefs] Could not persist preferences (storage quota). In-memory only.');
        } else {
            console.warn('[prefs] Could not persist preferences:', err);
        }
    }
    saveTimer = null;
}
```
**Phase 10 idb.js pattern (RESEARCH Example 4 lines 1067-1130):**
```js
// www/state/idb.js — minimal IndexedDB wrapper for FileSystemDirectoryHandle
const DB_NAME = 'bestialitty-handles';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY_RECV_DIR = 'recv_directory';

let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

export async function getRecvDirHandle() {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(KEY_RECV_DIR);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('[idb] getRecvDirHandle failed:', e);
        return null;
    }
}
// setRecvDirHandle / clearRecvDirHandle: same shape with `readwrite` tx + put / delete.
```

**Header-comment + sources block — copy from session-log.js:1-16 / prefs.js:1-13** (verbatim style: source CONTEXT + UI-SPEC + RESEARCH references).

---

### `www/state/prefs.js` (utility; one-line DEFAULTS extension)

**Analog:** self, lines 18-29.

**Pattern (prefs.js:18-29):**
```js
// prefs.js:18-29 — DEFAULTS frozen literal (THE TEMPLATE)
const DEFAULTS = Object.freeze({
    version: CURRENT_VERSION,
    theme: 'crt',
    phosphor: 'green',
    font: 'modern',
    fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false,
    crlfMode: 'cr',
    autoConnect: false,
    showAllSerialDevices: false,
});
```
**Phase 10 addition:** insert `slideRecvToFolder: false,` (boolean) before the closing brace. Per CONTEXT D-02 + UI-SPEC §"Toggle persistence", DO NOT bump `CURRENT_VERSION` from 1 to 2 — the existing defensive merge `cached = { ...DEFAULTS, ...parsed, ... }` at `prefs.js:55` fills missing fields automatically. Schema is field-additive-safe.

`slideRecvDirectoryHandle` is NOT in this DEFAULTS blob — it lives in IndexedDB only (handles are not JSON-roundtrippable).

---

### `www/input/keyboard.js` (controller, in-place insertion at lines 222-229)

**Analog:** same file Phase 5 D-18 paste-cancel arm at lines 222-229 (the canonical insertion template).

**Pattern (keyboard.js:212-229):**
```js
// keyboard.js:212-220 — Phase 6 D-19 selection-cancel arm (slot 1; existing)
if (e.code === 'Escape' && selectionIsDragging()) {
    e.preventDefault();
    selectionCancelDrag();
    return;
}

// keyboard.js:222-229 — Phase 5 D-18 paste-cancel arm (slot 2; THE TEMPLATE for SLIDE-cancel slot insertion)
if (e.code === 'Escape' && pastePumpIsActive()) {
    e.preventDefault();
    cancelPaste();
    return;
}
```
**Phase 10 insertion** — new arm BETWEEN selection-drag-cancel (line 220) and paste-cancel (line 222), per CONTEXT §"Esc disambiguation slot" and UI-SPEC §"Esc-cancel contract":
```js
// Phase 10 — Esc cancels active SLIDE recv session (slot 2; pushes paste to slot 3)
if (e.code === 'Escape' && isSlideActive()) {
    e.preventDefault();
    cancelSlideRecv();
    return;
}
```
**Imports addition** — at the top of `keyboard.js` (alongside line 23 `import { isActive as pastePumpIsActive, cancelPaste } from './paste-pump.js';`):
```js
import { isSlideActive, cancelSlideRecv } from '../transport/slide-recv.js';
```
Note: `isSlideActive` returns true for `mode === 'recv'` AND `state` not in {Idle, Done, Error}. Phase 10 implements the recv branch; per RESEARCH lines 1049-1054 the same accessor naturally extends to `mode === 'send'` later (Phase 11 chip Cancel button).

---

### `www/index.html` (view; Settings DOM + CSS extension)

**Analog:** same file Phase 6 `auto-connect-checkbox` Settings row at lines 819-825 + Phase 6 `.settings-row button` CSS at lines 232-250.

**DOM pattern (index.html:819-825):**
```html
<!-- index.html:819-825 — Phase 6 auto-connect Settings row (THE TEMPLATE) -->
<div class="settings-row">
  <label for="auto-connect-checkbox">
    <input type="checkbox" id="auto-connect-checkbox">
    Auto connect on load
  </label>
  <p class="hint">When enabled, BestialiTTY silently opens the previously-granted MicroBeast port on each page load. Off by default. On open failure, falls back to the standard "click Connect" flow with the failure logged.</p>
</div>
```

**Phase 10 row** — see UI-SPEC §"New DOM structure" (lines 374-400). Verbatim DOM:
```html
<hr class="settings-divider" />
<div class="settings-row" id="slide-recv-folder-row">
  <label for="slide-recv-to-folder-checkbox"
         title="When enabled, files received via SLIDE land in a folder you pick. Otherwise they download to your browser's Downloads folder.">
    <input type="checkbox" id="slide-recv-to-folder-checkbox">
    Save received files to a folder
  </label>
  <div class="settings-row-action">
    <button id="slide-recv-folder-button" type="button"
            title="Toggle the checkbox first">Choose folder…</button>
    <span id="slide-recv-folder-status" class="hint">No folder selected</span>
  </div>
  <p class="hint" id="slide-recv-folder-help">
    Received files land in your Downloads folder. Toggle this to pick a fixed destination.
  </p>
</div>
```
Insertion point: **bottom of `<details id="settings">`**, AFTER the existing `Reset all preferences` row at line 829 (UI-SPEC §"Element ordering" justification). Add a `<hr class="settings-divider" />` immediately before it (mirrors the Phase 6 divider at line 814 separating Phase 4 rows from Phase 6 prefs-block).

**CSS extension pattern (index.html:225-250):**
```css
/* index.html:225-250 — Phase 6 .settings-row CSS block (THE TEMPLATE — REUSED VERBATIM) */
.settings-divider {
    border: 0;
    border-top: 1px solid var(--chrome-border);
    margin: 16px 0 8px 0;
}
.settings-row {
    margin: 8px 0;
}
.settings-row button {
    font-family: inherit; font-size: 13px;
    padding: 4px 8px;
    background: transparent;
    color: var(--chrome-fg);
    border: 1px solid var(--chrome-border);
    cursor: pointer;
}
.settings-row button:focus-visible {
    border-color: var(--chrome-accent);
    outline: none;
}
.settings-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
```
**Phase 10 — single new CSS block (~10 LoC) per UI-SPEC §"CSS additions":**
```css
/* ==== Phase 10 — SLIDE recv-to-folder Settings row inline action ==== */
.settings-row .settings-row-action {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 0 24px;   /* 24px left indent matches checkbox-text alignment */
}
.settings-row .settings-row-action .hint {
    margin: 0;
}
```
Disabled-state for `[Choose folder…]` reuses existing `.settings-row button:disabled`. **Zero new design tokens.**

---

### `www/main.js` (controller; boot wiring)

**Analog:** same file Phase 8 `wireSlideDispatcher` at lines 388-399 + Phase 9 `wireFileSource` at lines 421-449 + Phase 6 `wireSessionLog` at lines 372-386.

**Boot wiring template (main.js:388-419):**
```js
// main.js:388-399 — Phase 8 wireSlideDispatcher (THE TEMPLATE — boot order critical)
wireSlideDispatcher({
    term,
    txSink: { setWireOwner, getWireOwner, writeSlideFrame, writeSlideFrameAwaitable },
    slideCtor: Slide,
    wasm,
});

// main.js:407-412 — Phase 9 window.__slide test introspection (THE TEMPLATE)
window.__slide = {
    __resetForTests: __slideResetForTests,
    __getStateForTests: __slideGetStateForTests,
    dispatchInbound,
    enterSendMode: enterSlideSendMode,
};
```

**Phase 10 wiring — new block** (insert AFTER `wireSlideDispatcher` and BEFORE `wireFileSource`, since slide-recv.js depends on slide.js exports):
```js
import {
    wireSlideRecv,
    cancelSlideRecv,
    isSlideActive,
    __resetForTests as __slideRecvResetForTests,
} from './transport/slide-recv.js';
import { getRecvDirHandle, setRecvDirHandle, clearRecvDirHandle } from './state/idb.js';

// Phase 10 — wire SLIDE recv plumbing AFTER wireSlideDispatcher.
const slideRecvFolderRow      = document.getElementById('slide-recv-folder-row');
const slideRecvToFolderCheckbox = document.getElementById('slide-recv-to-folder-checkbox');
const slideRecvFolderButton   = document.getElementById('slide-recv-folder-button');
const slideRecvFolderStatus   = document.getElementById('slide-recv-folder-status');

wireSlideRecv({
    wrapperEl: terminalWrapper,
    prefs,
    savePrefs,
    idb: { getRecvDirHandle, setRecvDirHandle, clearRecvDirHandle },
    txSink: { setWireOwner, writeSlideFrame, writeSlideFrameAwaitable },
    wasm,
    rowEl: slideRecvFolderRow,
    toggleEl: slideRecvToFolderCheckbox,
    folderButtonEl: slideRecvFolderButton,
    statusEl: slideRecvFolderStatus,
});

// Extend window.__slide with cancelRecv (CONTEXT __slide recv-mode shape)
window.__slide.cancelRecv = cancelSlideRecv;
window.__slideRecv = { __resetForTests: __slideRecvResetForTests };
```
**Phase 6 mousedown-preventDefault focus-retention pattern (main.js:506-508 + 548-551):** apply to `slide-recv-to-folder-checkbox` and `slide-recv-folder-button`. UI-SPEC §"Focus retention on Phase 10 control click" specifies: rely on native click toggle for the checkbox; mousedown preventDefault for the button + post-picker `terminalWrapperEl.focus()` restore.

---

### `www/tests/transport/slide-recv.spec.js` (NEW; Playwright e2e)

**Analog:** `www/tests/transport/slide-sender.spec.js` (full file, 217 LOC).

**Setup helper pattern (slide-sender.spec.js:23-30):**
```js
// slide-sender.spec.js:23-30 — Playwright setup with SERIAL_MOCK + MOCK_SERIAL_SLIDE_BOT
async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}
```
**`beforeEach` reset block (slide-sender.spec.js:34-52):**
```js
// slide-sender.spec.js:34-52 — beforeEach setup + state reset (THE TEMPLATE)
test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide.__resetForTests();
        window.__fileSource.__resetForTests();
        window.__mockWriterLog.length = 0;
        window.__mockSlideBot.reset();
    });
});
```
Phase 10 mirror adds `window.__slideRecv.__resetForTests()` to the reset block + `window.__mockSlideBot.setRole('send')` to switch the bot to sender-role.

**Round-trip assertion pattern (slide-sender.spec.js:107-145):** Phase 10 mirror — drive a 23-byte test file through the bot-as-sender, push wakeup via a new `__mockSlideBot.pushSlideHostWakeupAndStartSend(files)`, poll `window.__slide.__getStateForTests().mode === 'terminal'` (post-recv), then assert the **downloaded file** matches by intercepting `URL.createObjectURL` calls (Playwright pattern: spy on `Blob` creation pre-anchor-click) OR by leaning on the Folder-save toggle ON path with a mock `FileSystemDirectoryHandle` stub.

**Test layout (Phase 10 spec coverage matrix):**
- `single file anchor-click round-trip` — toggle OFF, default
- `single file folder-save round-trip` — toggle ON, mocked `showDirectoryPicker`
- `multi-file batch — 250 ms inter-file gap` — assert anchor-click timing
- `zero-byte file (SLIDE-21)` — chunks = [], Blob = 0 bytes
- `sub-frame file < 1024 B (SLIDE-22)` — single data frame + EOF
- `binary file .COM (SLIDE-23)` — Uint8Array round-trip
- `1 MB+ memory smoke (SLIDE-24)` — `performance.memory.usedJSHeapSize` delta < 5×
- `mid-session ESC^SLIDE re-entry (SLIDE-34)` — Z80 reset detected, clean re-entry
- `__slide.__getStateForTests recv-mode introspection` — current_filename / bytes_in_file_done / bytes_in_file_total

### `www/tests/transport/slide-cancel.spec.js` (NEW; Playwright e2e)

**Analog:** same setup template as slide-recv.spec.js. Coverage:
- `Esc during recv cancels session (SLIDE-27)` — Esc keypress → CTRL_CAN on wire → mode returns to 'terminal'
- `programmatic cancelRecv()` — `await window.__slide.cancelRecv()` — same outcome
- `cancel timing windows` — assert ≤ 200 ms in-flight settle, ≤ 500 ms echo wait, ≤ 100 ms drain
- `force_idle escape hatch` — bot doesn't echo CTRL_CAN; assert force_idle fires at 2000 ms
- `hard-fail recovery (SLIDE-29)` — bot injects 16 CRC errors; SM transitions to Error; mode returns to 'terminal'

---

### `www/tests/transport/mock-serial-slide-bot.js` (extension; sender role)

**Analog:** self — Phase 9 receiver-role bot at lines 60-283.

**Existing Phase 9 receiver-role pattern (mock-serial-slide-bot.js:60-92):**
```js
// mock-serial-slide-bot.js:60-92 — receiver-role bot state + reset (THE TEMPLATE)
const bot = {
    enabled: true,
    received_files: [],
    received_filenames: [],
    parse_buf: [],
    rdy_emitted: false,
    fin_observed: false,
    injectNakOnSeq: null,
    nak_already_injected: false,
    injectCanAfterFirstDataFrame: false,
    can_already_injected: false,
    first_data_frame_seen: false,
    framesObserved: 0,
    reset() {
        bot.enabled = true;
        bot.received_files = [];
        ...
    },
};
```
**Phase 10 extension** — add `role: 'recv' | 'send'` parameter; sender-role state machine mirrors `slide-rs/src/send.rs:155-249`. Per RESEARCH Pitfall 8 — this is a FOURTH independent implementation (production Rust receiver SM ↔ Phase 10 native Rust corpus ↔ existing Phase 9 JS recv-bot ↔ Phase 10 JS send-bot). All four must agree on every wire byte.

**Sender-role bot API (Phase 10 additions):**
```js
bot.role = 'recv';   // existing default
bot.setRole(role)              // 'recv' | 'send'
bot.queueSendFiles(files)      // [{ name: string, bytes: Uint8Array }]
bot.startSendSession()         // emits CTRL_RDY → header → data window → EOF → next file → CTRL_FIN
```
Drainage logic mirrors slide-rs/src/send.rs sliding-window protocol (WIN_SIZE=4 per Phase 7 `state.rs:29`). NAK rewind via `awaiting_retransmit` mirror.

---

## Shared Patterns

### EVT_* mirror invariant (CRITICAL — three-leg pin)

**Sources:** `crates/bestialitty-core/src/slide/framer.rs:31-43` (Rust authority), `crates/bestialitty-core/tests/slide_boundary_shape.rs:91-114` (cargo-test pin), `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs:97-127` (cargo-test pin), `www/transport/slide.js:49-64` (JS-side mirror).

**Apply to:** Every `EVT_*` constant Phase 10 adds (`EVT_HEADER_RECEIVED`, `EVT_RECV_DATA`, `EVT_RECV_FILE_DONE`).

**Three-leg discipline (Phase 8 + Phase 9 precedent):**
1. Add to `framer.rs` const block.
2. Add to BOTH `slide_boundary_shape.rs` and `slide_wasm_boundary_shape.rs` `slide_event_constants_pinned` tests.
3. Add to JS-side mirror in `transport/slide.js` lines 49-64. Numbering MUST match: Rust `13 << 16` ↔ JS `13 << 16` exactly.

### Pitfall 4 + Pitfall 5 — view re-derive + slice-before-await

**Source:** `www/transport/slide.js:333-341` (outbound triple consumer)

**Apply to:** `slide-recv.js` recv triple consumer (`recv_ptr / recv_len / clear_recv`) AND recv-filename triple consumer.

```js
// THE TEMPLATE — invariant for any pointer-based zero-copy view
if (wasmRef.memory.buffer !== <viewBuffer>) {
    <viewBuffer> = wasmRef.memory.buffer;
    <view> = new Uint8Array(<viewBuffer>, slide.recv_ptr(), <CAP>);
}
const owned = new Uint8Array(<view>.subarray(0, len));   // copy BEFORE any await
slide.clear_recv();
```
The 4th-leg test for this discipline lives in the native cargo `slide_torn_chunk` corpus (proves the Rust pointer is stable). The JS-side guard catches `wasm.memory` growth; both ends fail-fast on drift.

### `wireXxx({...})` initializer + injected deps

**Sources:** `www/transport/session-log.js:32-40` (simplest), `www/transport/slide.js:143-149` (Phase 8 dispatcher), `www/input/file-source.js:39-117` (Phase 9 most complex).

**Apply to:** `wireSlideRecv()` in `www/transport/slide-recv.js`.

Idiom: module-scope refs assigned ONCE at boot; `__resetForTests` clears state but keeps refs; Playwright tests reset state per test via `window.__xxx.__resetForTests()`. Avoids circular imports between `transport/slide.js` ↔ `transport/slide-recv.js` (slide-recv.js gets the `slide` instance via injection, not import).

### Module-scope `__resetForTests` + `__getStateForTests`

**Source:** `www/transport/slide.js:184-225`.

**Apply to:** `slide-recv.js` (test introspection on `window.__slideRecv`) AND extends existing `slide.js __getStateForTests` to add the recv-mode branch.

### Phase 4 D-16 mousedown-preventDefault focus retention

**Sources:** `www/transport/session-log.js:36-37`, `www/main.js:506-508` (localEcho checkbox), `www/main.js:548-551` (txReset button), `www/input/file-source.js:75-76` (sendBtn).

**Apply to:** `#slide-recv-to-folder-checkbox` AND `#slide-recv-folder-button`. UI-SPEC §"Focus retention on Phase 10 control click" specifies: native click toggles checkbox state (do NOT pre-flip in mousedown — Phase 4 Plan 04-04 Rule 1 fix); button click invokes `showDirectoryPicker()` async, restore `#terminal-wrapper` focus on picker dismiss/resolve.

### Anchor-click download (Phase 6 D-31)

**Source:** `www/transport/session-log.js:62-85`.

**Apply to:** `slide-recv.js` `downloadViaAnchor(filename, blob)` for the toggle-OFF / fallback path. Single 5000 ms `URL.revokeObjectURL` literal — avoid duplicating in comments (Phase 5 grep-hygiene rule from Plan 05-08).

### `chunks: Uint8Array[]` + `new Blob` memory-bounded reassembly (Phase 6 D-30)

**Source:** `www/transport/session-log.js:18-66` (per-connection accumulator) + Phase 6 PITFALLS §12 mitigation.

**Apply to:** `slide-recv.js` per-file `currentFile.chunks` accumulator. RESET to `[]` at every header boundary (Pitfall 6 — never share chunks across files).

### No `std::time` in Rust core (ADR-003 + Phase 7 D-08)

**Source:** `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` (line 70-74 specifies `("std::time", &[])` — zero exemptions).

**Apply to:** Phase 10's `state.rs` extension. The 200 / 500 / 100 / 2000 ms cancel windows live in JS only (`slide-recv.js cancelSlideRecv`). Rust SM is event-driven; CancelPending silent-drain consumes bytes until CTRL_CAN echo OR JS calls `force_idle()`. The cargo test gate fails loudly on any new `std::time` import.

### `[data-*]` attribute discipline (Phase 6 D-13 / Phase 9 [data-drop-target] precedent)

**Source:** `www/renderer/scroll-state.js` `[data-scrolled-back]` + Phase 9 `[data-drop-target]`.

**Apply to:** Phase 10 does NOT add a new `[data-*]` attribute. UI-SPEC §"Justification for not adding a `[data-recv-active]` attribute" locks this — no in-canvas overlay during recv (the canvas is suspended; bytes flow through SLIDE SM); attributes drive visible CSS only, not state introspection (state lives in `window.__slide`).

### Hard-reload requirement (MEMORY.md `project_wasm_cache_workflow`)

**Apply to:** Plans that modify `lib.rs` or `state.rs` (i.e., Wave 1 and Wave 2 in the suggested wave structure). The new wasm exports (`recv_ptr` / `recv_len` / `clear_recv` / `recv_filename_ptr` / `recv_filename_len` / `recv_file_size`) require `bash scripts/build.sh` followed by Ctrl+Shift+R hard reload. Plans MUST flag this in the acceptance step so the next-wave executor doesn't run against stale wasm.

### No AI attribution in commit messages (MEMORY.md feedback)

**Apply to:** every commit message in Phase 10. Never add `Co-Authored-By: Claude` / `Co-Authored-By: Anthropic` / mention Claude / Anthropic.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All 16 files have a strong analog in the codebase. `www/state/idb.js` is "first IndexedDB use" but the module shape (lazy init, try/catch swallow + `console.warn`, module-scope cached promise) is a clean transposition of `www/state/prefs.js`. The IndexedDB primitive itself is browser-native (MDN-documented + RESEARCH Example 4 supplies verbatim code). |

## Metadata

**Analog search scope:**
- `crates/bestialitty-core/src/slide/` (state.rs, framer.rs, crc.rs, mod.rs)
- `crates/bestialitty-core/src/lib.rs` (wasm_boundary mod)
- `crates/bestialitty-core/tests/` (slide_boundary_shape.rs, slide_wasm_boundary_shape.rs, slide_torn_chunk.rs, slide_sender.rs, slide_idempotent_reentry.rs, slide_reference_corpus.rs, core_02_no_browser_deps.rs)
- `www/transport/` (slide.js, session-log.js, serial.js)
- `www/state/` (prefs.js)
- `www/input/` (keyboard.js, file-source.js, paste-pump.js, tx-sink.js)
- `www/main.js`, `www/index.html`
- `www/tests/transport/` (mock-serial-slide-bot.js, slide-sender.spec.js, slide-dispatcher.spec.js, slide-wakeup.spec.js)

**Files scanned:** 22

**Pattern extraction date:** 2026-05-08
