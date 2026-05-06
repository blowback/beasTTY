# ARCHITECTURE Research — SLIDE FileTransfer (v1.1) Integration

**Domain:** Browser-side file-transfer protocol integrated into existing Rust-core / JS-shell terminal emulator
**Researched:** 2026-05-06
**Confidence:** HIGH (every integration point grounded in code; line numbers cited)

---

## Executive Summary

Every SLIDE concern lands on an existing seam — none of the v1.1 work requires architectural change. The Rust core grows one new module (`slide`) plus six wasm-bindgen exports on a new `Slide` struct (kept distinct from `Terminal` so the existing pure-logic invariants are untouched). The JS shell grows one new `transport/slide.js` module that owns the byte-routing dispatch + auto-send command emission, plus one new `input/file-source.js` module for File API + drag-drop, plus a small chip controller `renderer/slide-chip.js`. The existing `serial.js` read loop receives a single dispatch shim around its `term.feed(value)` call (the only line that fundamentally changes in any existing file). The TX writer is shared via a new tx-sink "owner" handoff. Cancellation and port-lost reuse the Phase 5 patterns verbatim.

The Z80 side gets one ergonomic change (`ESC ^` prefix) delivered via a separate PR to `github.com/blowback/slide` — this milestone documents the dependency and links the PR; it does not vendor or submodule the asm.

**Build order is dependency-driven:** Rust SLIDE state machine → wasm-bindgen exports → JS dispatch shim → File API source → chip + drag-drop → settings prefs → cancellation/port-lost wiring → Z80 PR → end-to-end UAT.

---

## System Overview — Two Modes, Same Wire

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            JS SHELL (browser)                                 │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ keyboard.js │   │ paste-pump.js│   │ file-source  │   │  slide-chip    │  │
│  │  (chord)    │   │  (queue)     │   │  (NEW)       │   │  (NEW)         │  │
│  └──────┬──────┘   └──────┬───────┘   └──────┬───────┘   └────────┬───────┘  │
│         │ pushTxBytes     │ pushTxBytes      │                    │          │
│         ▼                 ▼                  ▼                    ▼          │
│  ┌────────────────────────────────────┐  ┌──────────────────────────────┐    │
│  │       tx-sink.js  (modified)       │  │   transport/slide.js (NEW)   │    │
│  │   + owner handoff: 'terminal' |    │◀─┤  • mode: idle | send | recv  │    │
│  │   'slide' (slide bypasses ring)    │  │  • dispatchByte(b) router    │    │
│  └────────────────┬───────────────────┘  │  • slide.feed_byte(b)        │    │
│                   │                      │  • slide.take_outbound_chunk │    │
│                   ▼                      │  • drains writer             │    │
│  ┌──────────────────────────────────┐    └──────────────────────────────┘    │
│  │   transport/serial.js (modified) │            ▲                           │
│  │   • runReadLoop:                 │            │  routes bytes             │
│  │     dispatchInbound(value)       │────────────┘  during SLIDE             │
│  │   • single writer reference      │                                        │
│  └────────────────┬─────────────────┘                                        │
└───────────────────┼──────────────────────────────────────────────────────────┘
                    │  reader/writer       wasm-bindgen ABI
                    ▼                              ▲
┌──────────────────────────────────────────────────┼───────────────────────────┐
│                              RUST CORE (wasm)    │                           │
│   ┌─────────────────────────┐         ┌──────────┴────────────────────┐      │
│   │ Terminal (existing)     │         │ Slide (NEW; distinct struct)  │      │
│   │ • parser DFA            │         │ • framer (CRC-16-CCITT)       │      │
│   │ • grid + scrollback     │         │ • SM: idle/wait_rdy/...       │      │
│   │ • host_reply ring       │         │ • outbound_buf (drain target) │      │
│   │ • feed_silent(bytes)    │         │ • feed_byte(b) → events       │      │
│   └─────────────────────────┘         │ • progress + state accessors  │      │
│                                        └───────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key principle:** SLIDE owns the wire from `ESC ^` to the second FIN. Terminal parser is bypassed during a session — `dispatchInbound` is the only branch point, and it is single-writer (no race on owner state).

---

## 1. Wasm-Bindgen Façade for SLIDE State Machine

### Existing seam
`crates/bestialitty-core/src/lib.rs:33-190` — single `mod wasm_boundary` block, gated by `#[cfg(target_arch = "wasm32")]`. Per `lib.rs:13-15` and the `tests/core_02_no_browser_deps.rs` invariant: **wasm-bindgen attributes live in this file only**. New façade exports go here.

### New code (Rust)
- **New struct in lib.rs**, sibling to `Terminal`: `#[wasm_bindgen] pub struct Slide { inner: crate::slide::Slide }`.
- **New module** `crates/bestialitty-core/src/slide/` (mod.rs + framer.rs + crc.rs + state.rs + tests). Pure logic — no wasm tokens, exercised by native `cargo test` exactly like `terminal.rs`. Add `pub mod slide;` to `lib.rs:16-21` mod tree.

### Concrete export surface

| Export | Purpose | Mirrors |
|---|---|---|
| `new Slide()` | Allocate state machine in idle | `Terminal::new` (lib.rs:60-66) |
| `enter_send_mode(metadata: &[u8])` | Switch SM to WaitingRdy (sender role); store file headers (packed `{name_len, name, size}` records) | New |
| `enter_recv_mode()` | Switch SM to WaitingRdy (receiver role) | New |
| `feed_byte(b: u8) -> u32` | Drive SM with one inbound byte; returns packed `(event_kind << 16) | aux` | Mirrors `Terminal::feed` cadence |
| `feed_chunk(bytes: &[u8]) -> u32` | **Hot path** — avoids per-byte FFI cost on data frames | Pattern from `Terminal::feed_silent` (terminal.rs:90-96) |
| `outbound_ptr() / _len() / clear_outbound()` | Stable pointer into outbound_buf Vec for zero-copy egress | `host_reply_ptr/_len/clear_host_reply` (lib.rs:83-95) |
| `state() -> u32` | Returns SlideState enum tag for chip rendering | New |
| `progress_packed() -> u32` | `(file_idx << 24) | (pct << 16) | bytes_in_window` — single u32 vs three FFI calls | Same compaction as `cursor_packed` (lib.rs:152-155) |
| `cancel()` | Push CAN frame into outbound_buf; transition to CancelPending | New |
| `current_file_metadata_ptr/_len()` | Receive-mode: caller-side gets filename + size | `host_reply_ptr/_len` mirror |
| `take_received_file_chunk(buf: &mut [u8]) -> usize` | Receive-mode: drain reassembled file bytes (zero-copy via wasm.memory.buffer view) | New |

### State enum (Rust → JS as u32)

```rust
#[repr(u32)]
pub enum SlideState {
    Idle = 0,
    WaitingRdy = 1,
    SendingHeader = 2,
    SendingData = 3,
    WaitingAck = 4,
    ReceivingHeader = 5,
    ReceivingData = 6,
    FinPending = 7,
    CancelPending = 8,
    Done = 9,
    Error = 10,
}
```

### Event packing (feed_byte/feed_chunk return)

```
bits 31..16 = event kind  (0=none, 1=ready, 2=ack, 3=nak, 4=fin, 5=can,
                            6=header_complete, 7=file_complete, 8=session_complete,
                            9=error, 10=outbound_pending — JS must drain)
bits 15..0  = aux         (seq number, file index, error code)
```

JS pattern:
```js
const evt = slide.feed_byte(b);
const kind = evt >>> 16;
const aux  = evt & 0xFFFF;
if (kind === EVT_OUTBOUND_PENDING) drainOutbound();
if (kind === EVT_FILE_COMPLETE) saveFile(aux);
if (kind === EVT_SESSION_COMPLETE) exitSlideMode();
if (kind === EVT_ERROR) handleSlideError(aux);
```

### Build implication
Wasm rebuild via `scripts/build.sh`. JS imports `Slide` from `./pkg/bestialitty_core.js` — pkg bindings regenerate from `lib.rs`. **Build order: Rust changes first, `wasm-pack` rebuild, then JS import compiles.**

---

## 2. Byte-Routing Dispatch in the Read Loop

### Existing seam
`www/transport/serial.js:444-477` — `runReadLoop(p)`. The hot line is **line 453**: `term.feed(value);`. Currently every inbound chunk goes unconditionally to the terminal parser.

### Proposed dispatch — NEW module `www/transport/slide.js`

Not in Rust core (Rust never sees `ESC ^` because it's the trigger to bypass Rust's terminal parser); not inline in `serial.js` (serial.js stays Web-Serial-lifecycle-only).

```js
// www/transport/slide.js  (NEW)
import { Slide } from '../pkg/bestialitty_core.js';

let mode = 'terminal';   // 'terminal' | 'send' | 'recv'
let slide = null;
let termRef = null;
let writerRef = null;

export function dispatchInbound(value) {
    if (mode === 'terminal') {
        const idx = findEscCaret(value);
        if (idx === -1) {
            termRef.feed(value);
            return;
        }
        if (idx > 0) termRef.feed(value.subarray(0, idx));
        enterRecvMode();
        const tail = value.subarray(idx + 2);
        if (tail.length) feedSlide(tail);
        return;
    }
    feedSlide(value);
}

function feedSlide(bytes) {
    const evt = slide.feed_chunk(bytes);
    // drain events, handle each, drain outbound
    drainOutbound();
    if (slide.state() === STATE_DONE || slide.state() === STATE_ERROR) {
        exitSlideMode();
    }
}
```

### `ESC ^` detector — pre-parser sniff in JS

**Pre-parser sniff in JS** (NOT a Rust callback). Rationale:
- The terminal parser already accumulates partial escape sequences across chunk boundaries. If we routed ALL bytes to Rust and let Rust callback on `ESC ^`, the partial-escape accumulator would already have consumed the ESC, and we'd need a Rust-side "abort current escape, resync as SLIDE" path. Invasive.
- A pre-parser sniff in JS is a 2-byte literal scan — `findEscCaret` is a 5-line tight loop.
- **Edge case**: `ESC` at end of chunk N, `^` at start of chunk N+1. Module-scope `lastByteWasEscPending` flag carries state.

### What changes in serial.js
Single-line edit at `serial.js:453`:
```js
// BEFORE: term.feed(value);
// AFTER:  dispatchInbound(value);
```

### Drain-back when SLIDE finishes
When `slide.state() === Done` and there are residual bytes in the chunk, `dispatchInbound` switches mode back to `'terminal'` and feeds the residual to `termRef.feed(residual)`.

---

## 3. TX-Sink Integration — Sharing the Writer

### Existing seam
`www/input/tx-sink.js:27-51` — `pushTxBytes(bytes)` writes to internal ring + `registeredWriter.write(bytes)`. Writer registered/unregistered by `serial.js:392, 516, 702`.

### Decision: introduce a "wire owner" handoff in tx-sink

**pushTxBytes gates on owner; SLIDE writes through tx-sink via a new export.** Preserves the Phase 5 invariant that `serial.js` is the sole holder of the actual writer reference.

```js
// www/input/tx-sink.js  (modified)
let owner = 'terminal';    // 'terminal' | 'slide'

export function setWireOwner(o) { owner = o; }
export function getWireOwner() { return owner; }

export function pushTxBytes(bytes) {
    if (owner === 'slide') return;   // silent drop — chip messaging shows "Transfer in progress"
    // ... existing path unchanged
}

// NEW SLIDE-only path — bypasses TX ring (which is for keystrokes only).
export function writeSlideFrame(bytes) {
    if (registeredWriter) registeredWriter.write(bytes).catch(/* error log */);
}
```

### What changes
- **tx-sink.js:** + owner state + setWireOwner + writeSlideFrame; pushTxBytes early-returns when owner === 'slide' (~15 lines).
- **slide.js:** calls `setWireOwner('slide')` at session start; `setWireOwner('terminal')` at end. Calls `writeSlideFrame(bytes)` for protocol frames.
- **paste-pump.js:** **NO changes needed.** It calls `pushTxBytes`, which silently drops. Pre-emptive: slide.js calls `pastePump.cancelPaste()` at session start.
- **keyboard.js:** **NO changes needed.** pushTxBytes gate handles it.

### Why not "SLIDE calls writer.write directly through tx-sink"?
Would need `getWriter` export exposing raw writer outside `serial.js`, breaking Phase 5 D-21 contract.

---

## 4. Floating Chip Controller — Two Chips Coexisting

### Existing seam
`www/renderer/scroll-state.js:194-207` — `refreshChip()`. Phase 6 scrollback chip at `position: absolute; bottom: 8px; right: 8px;` inside `#terminal-wrapper` (CSS at `www/index.html:138-164`).

### Public API of the existing pattern
1. DOM element with `[hidden]` attribute + absolute positioning (CSS).
2. Module-scope refs.
3. Refresh function called when state changes; toggles `hidden` + sets `textContent`.
4. Click handler triggers UI action.
5. `mousedown preventDefault` for focus retention (Phase 4 D-16).

### Recommendation: separate element + opposite corners

**Don't share** the scrollback chip element. Reasons:
- Different click affordances (snap-to-bottom vs cancel transfer).
- They genuinely can show simultaneously (user scrolls back during transfer to inspect output).
- Top-bar isn't ideal for SLIDE — needs Cancel + multi-line status that doesn't fit horizontal layout.

**Stack at opposite corners**:
- Scrollback chip: `bottom: 8px; right: 8px;` (right = "viewport state", mirrors scrollbar).
- SLIDE chip: `bottom: 8px; left: 8px;` (left = "wire state").

### New module: `www/renderer/slide-chip.js`

```js
// Mirror of scroll-state.js's chip lifecycle pattern.
let chipEl = null;
let textEl = null;
let cancelBtnEl = null;
let onCancelFn = null;

export function wireSlideChip({ chip, text, cancelBtn, onCancel }) {
    chipEl = chip; textEl = text; cancelBtnEl = cancelBtn; onCancelFn = onCancel;
    cancelBtn.addEventListener('click', () => onCancelFn());
    cancelBtn.addEventListener('mousedown', (e) => e.preventDefault());
}

export function showSlideStatus({ direction, fileIdx, totalFiles, currentFilename, pct, bytesDone, bytesTotal }) {
    const verb = direction === 'send' ? 'Sending' : 'Receiving';
    textEl.textContent = `${verb} ${currentFilename} (${fileIdx}/${totalFiles}) — ${pct}% (${bytesDone}/${bytesTotal} B)`;
    chipEl.removeAttribute('hidden');
}

export function hideSlideChip() {
    if (chipEl) chipEl.setAttribute('hidden', '');
}
```

---

## 5. Drag-Drop Wiring

### Existing seam
- Selection drag: `www/input/selection.js` registers pointerdown/move/up on the canvas. Primary mouse button.
- No drag-drop listeners exist anywhere yet.

### Collision risk: LOW

Browser drag-drop events (`dragenter`, `dragover`, `drop`) fire on file-from-OS drags; they do NOT fire from internal pointer drags (selection). Different event families:

| Event | Fires from |
|---|---|
| `pointerdown/move/up` | Internal mouse interaction (selection drag) |
| `dragenter/over/drop` | External file source from OS file manager |

Chromium fires `dragstart` for internal-element drag (which selection.js doesn't trigger because it uses pointer events, not draggable=true). Safe coexistence.

### Where to attach
**`#terminal-wrapper`** (the parent of canvas). Reasons:
- Drop-zone visual feedback reads better on the wrapper than on canvas pixels.
- Selection's pointer listeners are on `#terminal` (the canvas). Different element → zero listener overlap.

### NEW module: `www/input/file-source.js`

```js
import { enterSendMode } from '../transport/slide.js';

export function wireFileSource({ wrapperEl }) {
    wrapperEl.addEventListener('dragenter', onDragEnter);
    wrapperEl.addEventListener('dragover', onDragOver);
    wrapperEl.addEventListener('dragleave', onDragLeave);
    wrapperEl.addEventListener('drop', onDrop);
}

function onDragOver(ev) {
    ev.preventDefault();   // required for drop to fire
    wrapperEl.setAttribute('data-drop-target', 'true');
}

async function onDrop(ev) {
    ev.preventDefault();
    wrapperEl.removeAttribute('data-drop-target');
    const files = Array.from(ev.dataTransfer.files);
    if (files.length === 0) return;
    const fileData = await Promise.all(files.map(async (f) => ({
        name: f.name.toUpperCase().slice(0, 12),
        bytes: new Uint8Array(await f.arrayBuffer()),
    })));
    enterSendMode(fileData);
}
```

### CSS guard
`#terminal-wrapper[data-drop-target="true"] { outline: 2px dashed var(--chrome-accent); }` (~3 lines).

---

## 6. Settings + Prefs Integration

### Decision: defensive merge, not version bump

`prefs.js:55` already does the right thing for new fields: `cached = { ...DEFAULTS, ...parsed, serial: ... }`. New top-level fields are picked up automatically.

Version bumps reserved for **renames or removals**. Adding `slideAutoSendCommand` and `slideAutoSendEnabled` is purely additive.

### New fields in DEFAULTS
```js
const DEFAULTS = Object.freeze({
    version: CURRENT_VERSION,
    // ... existing fields
    slideAutoSendCommand: 'B:SLIDE R',
    slideAutoSendEnabled: true,
});
```

### UI placement: Settings pane

- Settings pane already hosts behavioral toggles (local-echo, CR/LF mode). Auto-send command is behavioral.
- Connection pane hosts wire-level config (baud, parity). Auto-send isn't wire-level.

### What changes
- **prefs.js:** 2 new lines.
- **www/index.html:** 2 new rows in Settings pane (~12 lines).
- **main.js:** new event listeners following the localEcho pattern (main.js:402-405).
- **applyPrefs subscriber:** mirror stored values into DOM elements.

---

## 7. Cancellation Propagation

### Reference pattern
`www/input/paste-pump.js:57-64` — `cancelPaste()`. Esc disambiguation order from Phase 6 Plan 04.

### SLIDE cancel sequence (end-to-end)
1. User clicks Cancel chip button → `slide-chip.js` fires `onCancel`.
2. slide.js calls `slide.cancel()` (Rust). Rust pushes CAN frame, transitions SM to `CancelPending`.
3. slide.js drains outbound → CAN frame goes through `writeSlideFrame()`.
4. Z80 receives CAN → per protocol response, sends ACK or stops. (Open question — see below.)
5. slide.js read loop continues feeding bytes during cancel window.
6. Rust SM in CancelPending → on inbound ACK or after timeout transitions to Idle, emits EVT_SESSION_COMPLETE.
7. slide.js handleEvent → `setWireOwner('terminal')`, `hideSlideChip()`.

### Abort timeout: 2-second timeout in JS, not Rust

Reasons:
- Rust core is synchronous (no `std::time` in wasm; would violate `tests/core_02_no_browser_deps.rs`).
- JS owns the event loop. `setTimeout(2000)` is the natural place.

```js
function startCancel() {
    slide.cancel();
    drainOutbound();
    cancelTimer = setTimeout(() => {
        appendErrorLog('slide-cancel-timeout', 'Transfer cancel timed out — wire may be desynced');
        forceExitSlideMode();
    }, 2000);
}

function forceExitSlideMode() {
    if (cancelTimer) { clearTimeout(cancelTimer); cancelTimer = null; }
    setWireOwner('terminal');
    mode = 'terminal';
    hideSlideChip();
    slide = null;
}
```

### Resync protocol if wire is in unknown state: passive recovery

After force-exit:
- JS treats inbound bytes as terminal output again.
- Z80 SLIDE.COM either times out and returns to CP/M shell, OR keeps sending frames forever (defensive: terminal parser silently discards 0x01 SOF as unknown C0).
- Wire eventually quiesces. User presses MicroBeast hardware Reset if needed.

**No active "magic resync byte" protocol.** SLIDE v0.2 spec doesn't define one; inventing one would diverge from cross-tool compatibility (slide-rs, slide-py).

### Esc disambiguation (Phase 6 Plan 04 pattern)

Add SLIDE cancel to keyboard.js Esc handler order:
1. Selection-drag cancel (existing)
2. **SLIDE cancel (NEW)**
3. Paste cancel (existing)
4. Encode 0x1B (existing)

---

## 8. Phase 5 Port-Lost Integration

### Symmetric SLIDE port-lost path

```js
// serial.js — modified handleReadError, onNavSerialDisconnect, teardown
pastePumpOnPortLost();
slidePumpOnPortLost();   // NEW — slide.js exports this
```

### slide.js export

```js
export function slidePumpOnPortLost() {
    if (mode === 'terminal') return;
    if (cancelTimer) { clearTimeout(cancelTimer); cancelTimer = null; }
    forceExitSlideMode();
    showSlideStatus({ status: 'port-lost', message: 'Transfer aborted — port lost' });
    setTimeout(() => hideSlideChip(), 3000);
}
```

---

## 9. Build Orchestration — Where Files Live

### New Rust source files

```
crates/bestialitty-core/src/
├── slide/                       # NEW module
│   ├── mod.rs                   # public surface, re-exports
│   ├── crc.rs                   # CRC-16-CCITT (poly 0x1021, init 0xFFFF)
│   ├── framer.rs                # SOF/SEQ/LEN/CRC frame build + parse
│   ├── state.rs                 # SlideState enum, SM transitions
│   └── tests.rs                 # native cargo test
├── lib.rs                       # MODIFIED: + pub mod slide; + Slide wasm wrapper
```

### New JS source files

```
www/
├── transport/
│   ├── serial.js                # MODIFIED: line 453 uses dispatchInbound
│   └── slide.js                 # NEW — protocol orchestration + dispatch
├── input/
│   ├── tx-sink.js               # MODIFIED: + setWireOwner / writeSlideFrame
│   ├── keyboard.js              # MODIFIED: + Esc → slide cancel disambiguation
│   ├── file-source.js           # NEW — drag-drop + file picker
├── renderer/
│   └── slide-chip.js            # NEW — chip lifecycle for SLIDE progress
├── state/
│   └── prefs.js                 # MODIFIED: + slideAutoSendCommand fields
└── main.js                      # MODIFIED: + boot wiring for new modules
```

### Build dependency graph

```
1. Rust slide module (crc.rs → framer.rs → state.rs → mod.rs → tests pass)
        ↓
2. wasm-bindgen exports added to lib.rs
        ↓
3. scripts/build.sh → www/pkg/bestialitty_core.js regenerated
        ↓
4. JS imports Slide from pkg (transport/slide.js compiles)
        ↓
5. transport/slide.js + tx-sink.js modifications
        ↓
6. serial.js single-line edit
        ↓
7. input/file-source.js + renderer/slide-chip.js
        ↓
8. prefs.js + Settings UI rows
        ↓
9. main.js wiring
        ↓
10. End-to-end Playwright tests
        ↓
11. Z80 PR merged + SLIDE.COM rebuilt + real-hardware UAT
```

---

## 10. Z80 Source Ownership (slide.asm `ESC ^` Change)

### Recommendation: Separate PR, linked from milestone documentation

**NOT a submodule. NOT a vendor copy.**

| Option | Verdict |
|---|---|
| **git submodule** | Reject — bestialitty needs Z80 toolchain to build; CI complexity |
| **Vendor copy** | Reject — drift risk; vendored copy goes stale silently |
| **Separate PR + doc reference** | **Accept** — each repo owns its concerns |
| **Documentation note only** | Reject — defeats v1.1's goal |

### Concrete delivery
1. **In bestialitty repo** — add `docs/SLIDE_Z80_REQUIREMENT.md` documenting the dependency + tracking PR link.
2. **PR upstream to blowback/slide** — single small change to slide.asm.
3. **In bestialitty's PROJECT.md** — note the dependency.

### Graceful degradation
- "Z80-initiated receive" gracefully degrades if Z80 hasn't been patched: `ESC ^` sniff just doesn't fire.
- PC→Z80 (host-initiated send) works on stock unmodified SLIDE.COM because BestialiTTY initiates with a typed command.

---

## Component Responsibilities Matrix

| Component | Type | Lines (est) |
|---|---|---|
| `slide/crc.rs` | NEW Rust | ~40 |
| `slide/framer.rs` | NEW Rust | ~120 |
| `slide/state.rs` | NEW Rust | ~200 |
| `slide/mod.rs` | NEW Rust | ~80 |
| `slide/tests.rs` | NEW Rust | ~150 |
| `lib.rs` | MODIFIED Rust | +80 |
| `transport/slide.js` | NEW JS | ~250 |
| `transport/serial.js` | MODIFIED JS | +5 |
| `input/tx-sink.js` | MODIFIED JS | +15 |
| `input/file-source.js` | NEW JS | ~80 |
| `input/keyboard.js` | MODIFIED JS | +8 |
| `renderer/slide-chip.js` | NEW JS | ~50 |
| `state/prefs.js` | MODIFIED JS | +2 |
| `main.js` | MODIFIED JS | +30 |
| `index.html` | MODIFIED | +60 |
| `docs/SLIDE_Z80_REQUIREMENT.md` | NEW docs | ~30 |

**Total**: 6 new files + 7 modified files. Modifications are surgical; no refactoring of existing logic.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Putting SLIDE state machine in Terminal struct
Coupling Terminal's invariants (parser, grid) with SLIDE's invariants (sliding window, CRC) makes both harder to test.
**Do instead:** Sibling `Slide` struct in its own module, with its own wasm-bindgen wrapper.

### Anti-Pattern 2: Routing SLIDE bytes through term.feed first
vt52::Parser is a state machine — once it sees ESC, it accumulates the next byte. There's no clean rewind path.
**Do instead:** Pre-parser sniff in JS at `dispatchInbound`.

### Anti-Pattern 3: SLIDE shares the Phase 6 scrollback chip element
Different click handlers, different visibility logic, different content shape.
**Do instead:** Separate `#slide-chip` element, opposite corner.

### Anti-Pattern 4: SLIDE state in Rust uses any time-related logic
Rust core is wasm — no `std::time::Instant`. Any time logic violates the no-browser-deps invariant.
**Do instead:** All timers live in JS. Rust SM is purely event-driven.

### Anti-Pattern 5: SLIDE writes through pushTxBytes
pushTxBytes appends to the Phase 4 D-15 TX ring. Per-keystroke ring semantics aren't right for multi-KB binary frames.
**Do instead:** Separate `writeSlideFrame` path that bypasses the TX ring.

### Anti-Pattern 6: Vendoring slide.asm into bestialitty
bestialitty is a static web app with no Z80 toolchain. Vendoring imports a build dependency it doesn't need.
**Do instead:** Doc-only dependency on upstream PR.

---

## Open Questions (for v1.1 planning)

1. **CAN frame ACK behavior in SLIDE v0.2** — The spec covers FIN and ACK/NAK/RDY but not explicit CAN handling. JS-side timeout becomes the primary mechanism if Z80 CAN response is unspecified.

2. **`feed_byte` vs `feed_chunk` cost trade-off** — One FFI call per byte is acceptable for control bytes (sparse) but expensive for data frames (dense). Recommend `feed_chunk` as the hot path.

3. **Filename character set for received files** — Recommend passing through verbatim (Chrome download API sanitizes); document that received filenames are uppercase 8.3.

4. **Multi-tab safety** — Phase 5 D-29 'port-in-use' handling already covers; no new concern.

---

## Confidence Assessment

| Area | Confidence | Reason |
|---|---|---|
| Wasm boundary additions | HIGH | Mirror existing Terminal pattern verbatim |
| Read-loop dispatch | HIGH | Single-line edit at known location |
| TX writer sharing | HIGH | Existing tx-sink owner state is a clean addition |
| Chip controller | HIGH | Phase 6 scroll-state chip is the proven template |
| Drag-drop | HIGH | Browser drag-drop well-trodden; collision risk verified to be zero |
| Prefs integration | HIGH | Defensive merge already handles additive fields |
| Cancellation | MEDIUM | Open question on Z80 CAN behavior; mechanism itself is sound |
| Port-lost | HIGH | Symmetric extension of Phase 5 D-20 paste-pump pattern |
| Build orchestration | HIGH | Same flow as Phase 2 wasm-bindgen → Phase 3 JS imports |
| Z80 source ownership | HIGH | Standard cross-repo coordination pattern |

**Overall: HIGH** — every integration point lands on an existing seam with a known pattern.

---

## Files Referenced

- `.planning/PROJECT.md` (v1.1 milestone definition)
- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` (protocol spec)
- `crates/bestialitty-core/src/lib.rs` (wasm boundary, lines 33-190)
- `crates/bestialitty-core/src/terminal.rs` (Terminal pattern reference)
- `www/transport/serial.js` (read loop at line 453, teardown at 498-525, port-lost at 661-668)
- `www/input/tx-sink.js` (writer sharing at 27-51)
- `www/input/paste-pump.js` (cancellation pattern at 57-82)
- `www/renderer/scroll-state.js` (chip lifecycle at 194-207)
- `www/state/prefs.js` (DEFAULTS at 18-29, defensive merge at 55)
- `www/main.js` (boot order reference)
- `www/index.html` (chip CSS at 138-164, paste-progress at 400-438)
