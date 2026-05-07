// BestialiTTY Phase 8 — SLIDE dispatcher + 7-byte ESC^ wakeup matcher.
//
// Public API:
//   - dispatchInbound(value: Uint8Array)     — called by serial.js:453 in lieu of term.feed
//   - wireSlideDispatcher({ term, txSink, slideCtor, wasm }) — boot-time init
//   - slidePumpOnPortLost()                   — Phase 11 stub; exported now so wiring is additive
//   - __resetForTests()                        — Playwright test introspection
//   - __getStateForTests()                     — Playwright test introspection
//
// Sources:
//   - 08-CONTEXT.md D-01 (match-index counter), D-02 (replay-on-fail with
//     re-process current byte from idx=0), D-03 (VT52 ESC^ auto-copy lore),
//     D-04 (sniff in JS not Rust), D-05 (dispatchInbound routing shape),
//     D-06 (single-line edit at serial.js:453), D-07 (recv-mode is straight
//     pass-through; Phase 10 owns re-entry detection), D-08 (tx-sink owner),
//     D-09 (synchronous setWireOwner handoff), D-10 (Slide façade contract),
//     D-11 (zero-copy outbound drain mirror of host_reply triple).
//   - 08-RESEARCH.md §Pattern 1 (matcher state machine), §Pattern 2 (TX owner
//     handoff), §Pattern 3 (Slide façade), §Pattern 4 (zero-copy drain).
//   - 08-RESEARCH.md §Pitfall 1 (post-feed invariant), Pitfall 2 (chunk-tail
//     off-by-one), Pitfall 3 (TX owner not flipped back), Pitfall 4 (memory
//     growth invalidates view), Pitfall 5 (slice before await write),
//     Pitfall 7 (EVT_* JS mirror authority is tests/slide_boundary_shape.rs),
//     Pitfall 8 (boot order: construct after init()).
//   - ARCHITECTURE.md §1 (wasm-bindgen façade), §2 (byte-routing dispatch in
//     read loop), §3 (TX-sink integration / wire-owner handoff).
//   - Analog: www/input/paste-pump.js (module-scope state + wireXxx initializer
//             + Uint8Array queue + injected term/sample/drain refs).
//   - Analog: www/renderer/scroll-state.js (module-scope state declaration block).
//   - Analog: www/transport/session-log.js (simplest wireXxx + reset shape).

// EVT_* — packed (kind << 16) | aux. JS unpacks via (evt >>> 16) for kind,
// (evt & 0xFFFF) for aux. AUTHORITY: crates/bestialitty-core/tests/slide_boundary_shape.rs:slide_event_constants_pinned
// + crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs (Plan 08-01 pin).
// A Rust-side renumber that didn't update both pin files is caught by
// cargo test; Plan 08-04's Playwright dispatcher harness drives a CTRL_RDY
// byte and asserts the reported event kind matches EVT_RDY for orthogonal
// drift detection.
const EVT_NONE        = 0;
const EVT_RDY         = 1 << 16;       // 0x00010000
const EVT_ACK         = 2 << 16;
const EVT_NAK         = 3 << 16;
const EVT_FIN         = 4 << 16;
const EVT_CAN         = 5 << 16;
const EVT_DATA_FRAME  = 6 << 16;
const EVT_CRC_ERROR   = 7 << 16;

// SlideState repr(u32) mirror.
const STATE_IDLE          = 0;
const STATE_WAITING_RDY   = 1;
const STATE_HEADER_PHASE  = 2;
const STATE_DATA_PHASE    = 3;
const STATE_FIN_PENDING   = 4;
const STATE_CANCEL_PEND   = 5;
const STATE_DONE          = 6;
const STATE_ERROR         = 7;

// 7-byte wakeup signature: ESC ^ S L I D E (D-01).
const WAKEUP = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);

// Module-scope state.
let mode = 'terminal';                   // 'terminal' | 'recv' | 'send' (send = Phase 9 scope)
let wakeIdx = 0;                         // D-01 match-index counter (0..7)
const scratch = new Uint8Array(6);       // D-02 backing buffer; max 6 bytes (the 7th match
                                         // commits to recv mode and is never replayed)
let slide = null;                        // per-session new Slide() (CoreSlide via wasm)

// Injected deps (wireSlideDispatcher sets these).
let termRef = null;
let txSinkRef = null;     // { setWireOwner, getWireOwner, writeSlideFrame }
let SlideCtor = null;     // the wasm-imported Slide class
let wasmRef = null;       // for memory.buffer access in drainSlideOutbound

// Cached outbound view (re-derived on memory growth — Pitfall 4 mirror of
// main.js:reDeriveHostReplyView at lines 274-279).
let outboundBuffer = null;
let outboundView = null;
const OUTBOUND_VIEW_CAP = 16;            // matches Phase 7 OUTBOUND_RESERVE

// --- Public API -----------------------------------------------------------

export function wireSlideDispatcher(opts) {
    const { term, txSink, slideCtor, wasm } = opts;
    termRef = term;
    txSinkRef = txSink;
    SlideCtor = slideCtor;
    wasmRef = wasm;
}

export function dispatchInbound(value) {
    if (mode === 'terminal') {
        dispatchTerminalMode(value);
    } else if (mode === 'recv') {
        dispatchRecvMode(value);
    }
    // mode === 'send' is Phase 9 scope; absent branch is correct for Phase 8.
}

// Phase 11 stub — exported now so port-lost wiring in serial.js teardown is
// purely additive. Phase 11 will: cancel any in-flight session, force_idle,
// hide chip. Phase 8 — no chip yet, no-op is safe.
export function slidePumpOnPortLost() {
    // No-op until Phase 11.
}

// Test introspection (mirrors window.__scrollState / window.__sessionLog
// precedent at main.js:154-164, 360-365). Used by Plan 08-04 Playwright
// specs to assert mode + wakeIdx state directly.
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
}
export function __getStateForTests() {
    return { mode, wakeIdx, hasSlide: slide !== null };
}

// --- Internals ------------------------------------------------------------

function dispatchTerminalMode(value) {
    // Pending bytes that should reach term.feed at end-of-chunk (or sooner if
    // a wakeup match flushes them). Using a JS Array + .push is safe at the
    // chunk granularity; a Uint8Array preallocation would micro-optimize a
    // hot path that's already 1.9 KB/s peak — irrelevant.
    const pending = [];
    let i = 0;
    while (i < value.length) {
        const b = value[i];
        if (b === WAKEUP[wakeIdx]) {
            // Capture for potential replay (max 6 bytes; the 7th match commits
            // to recv mode and is never replayed).
            if (wakeIdx < 6) scratch[wakeIdx] = b;
            wakeIdx++;
            if (wakeIdx === 7) {
                // Full match — flush any benign bytes BEFORE the wakeup in
                // this chunk to term.feed FIRST (so the terminal sees them in
                // wire order), then transition to recv mode.
                if (pending.length) {
                    termRef.feed(new Uint8Array(pending));
                    pending.length = 0;
                }
                enterRecvMode();
                wakeIdx = 0;
                // Forward chunk tail to slide (Pitfall 2 — value.subarray(i + 1)
                // skips the matched 7-byte signature).
                const tail = value.subarray(i + 1);
                if (tail.length) {
                    feedSlide(tail);
                    // After feeding the tail, drain events + outbound + check
                    // for session end (defensive — extremely unlikely the
                    // recv session completes within the same chunk as wakeup,
                    // but the code path mirrors dispatchRecvMode for correctness).
                    drainEventsAndOutbound();
                    maybeExitRecvMode();
                }
                return;
            }
            // else: byte SWALLOWED for now (waiting for next byte).
        } else {
            // Mismatch — replay swallowed prefix to pending in original order.
            if (wakeIdx > 0) {
                for (let k = 0; k < wakeIdx; k++) pending.push(scratch[k]);
                wakeIdx = 0;
                // D-02 critical clause: re-process current byte from idx=0.
                if (b === WAKEUP[0]) {
                    scratch[0] = b;
                    wakeIdx = 1;
                    // current byte SWALLOWED (captured for next iteration).
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

// D-07 — straight pass-through; Phase 10 owns re-entry detection.
function dispatchRecvMode(value) {
    feedSlide(value);
    drainEventsAndOutbound();
    maybeExitRecvMode();
}

function feedSlide(bytes) {
    slide.feed_chunk(bytes);
}

function drainEventsAndOutbound() {
    // Drain events to a no-op in Phase 8 (RESEARCH §Open Question 4
    // recommendation — bounded ring; Phase 10 attaches the chip event handler).
    while (slide.take_event_packed() !== EVT_NONE) { /* drain */ }
    drainSlideOutbound();
}

function drainSlideOutbound() {
    const len = slide.outbound_len();
    if (len === 0) return;
    // Pitfall 4 — re-derive the view if memory.buffer detached/grew. Mirror
    // of main.js:reDeriveHostReplyView at lines 274-279.
    if (wasmRef.memory.buffer !== outboundBuffer) {
        outboundBuffer = wasmRef.memory.buffer;
        outboundView = new Uint8Array(outboundBuffer, slide.outbound_ptr(), OUTBOUND_VIEW_CAP);
    }
    // Pitfall 5 — slice to JS-owned buffer BEFORE await writer.write so a
    // subsequent memory growth doesn't strand the byte serialization.
    const owned = new Uint8Array(outboundView.subarray(0, len));
    txSinkRef.writeSlideFrame(owned);
    slide.clear_outbound();
}

function maybeExitRecvMode() {
    const st = slide.state();
    if (st === STATE_DONE || st === STATE_ERROR) {
        exitRecvMode();
    }
}

function enterRecvMode() {
    // Per-session new Slide() (Claude's Discretion default — no Slide::reset()
    // singleton optimization; ~1 KB allocation per session is irrelevant at
    // SLIDE's session cadence).
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
    slide.enter_recv_mode();
    // D-09 — synchronous handoff. Pitfall 3 — flip both mode and owner in
    // the same helper to prevent half-state.
    txSinkRef.setWireOwner('slide');
    mode = 'recv';
}

function exitRecvMode() {
    // D-09 — synchronous handoff. mode + owner flipped together; Pitfall 3.
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    // Slide instance lifecycle: leave the Done/Error instance non-null until
    // the next enterRecvMode replaces it (subsequent feed_byte/feed_chunk on
    // a Done state are no-ops in the SM per Phase 7 state.rs:128-131).
    // Phase 8 doesn't reset the cached outboundView/outboundBuffer — they
    // were derived for THIS instance and would be invalidated by the next
    // new Slide() anyway; drainSlideOutbound's wasmRef.memory.buffer check
    // catches any change.
}
