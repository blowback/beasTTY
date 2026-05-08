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

// Phase 9 — pushTxBytes is needed for the auto-typed B:SLIDE R\r command in
// enterSendMode. The owner is 'terminal' at the time of call (Pitfall 3
// order-critical: pushTxBytes BEFORE pendingSendSession assignment) so the
// owner gate at tx-sink.js:50 lets these bytes through to the writer.
import { pushTxBytes } from '../input/tx-sink.js';

// EVT_* — packed (kind << 16) | aux. JS unpacks via (evt >>> 16) for kind,
// (evt & 0xFFFF) for aux. AUTHORITY: crates/bestialitty-core/tests/slide_boundary_shape.rs:slide_event_constants_pinned
// + crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs (Plan 08-01 pin
// + Plan 09-02 extension for the sender constants).
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
// Phase 9 EVT_* mirror additions — pinned by
// crates/bestialitty-core/tests/slide_boundary_shape.rs and
// crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs (Plan 09-02
// boundary-shape pin extension). Drift here vs the Rust-side enum fails
// both pin tests at native cargo test time before reaching JS.
const EVT_FILE_COMPLETE     = 8  << 16;   // aux = file_idx of the file just acked
const EVT_SESSION_COMPLETE  = 9  << 16;   // aux = 0; emitted on FIN exchange completion
const EVT_RETRANSMIT_NEEDED = 10 << 16;   // aux = seq the receiver NAK'd

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
// Phase 9 D-08: grown from 16 to 4128 in lockstep with Rust OUTBOUND_RESERVE
// in slide/state.rs. The two constants must move together; the Rust-side
// test outbound_ptr_stable_across_sender_window_pushes proves the Rust
// reserve is sufficient, and this view cap matches it (4 max-size frames at
// 1030 bytes each + 8 bytes slack = 4128).
const OUTBOUND_VIEW_CAP = 4128;

// ===== Phase 9 sender-mode state =====

// Phase 9 D-13/D-15 — pending send session set by enterSendMode({ files }).
// Consumed by the wakeup-completion clause in dispatchTerminalMode.
// Depth 1 per CONTEXT Claude's-Discretion default: second click while
// pending replaces the queued metadata.
let pendingSendSession = null;  // { metadata: Uint8Array, fileBytes: Uint8Array[] } | null

// Phase 9 — active send-mode context. Populated by enterSendModeInternal;
// mutated by pumpNextDataChunkIfReady as bytes flow out.
let currentSendCtx = null;       // { fileBytes: Uint8Array[], currentFileIdx, sentBytesInFile } | null

// Phase 9 Plan 09-04 Rule 1 fix — serialise concurrent dispatchSendMode
// invocations. The serial.js read loop calls dispatchInbound synchronously per
// inbound chunk, but dispatchSendMode is async (multi-step await drain → pump
// → await drain). Without serialisation, two inbound chunks arriving in
// rapid succession (the bot ACKs each frame inline of writer.write under
// Playwright's microtask scheduling) cause two dispatchSendMode invocations
// to BOTH read `slide.outbound_len()` BEFORE either calls clear_outbound,
// each slicing the same outbound bytes and writing them to the wire — the
// second pump+drain duplicates the data frame. The fix is a depth-1 promise
// chain: each dispatchSendMode awaits the previous tail before running, so
// every feed → drain → pump → drain → maybeExit cycle is atomic with
// respect to the outbound buffer + sender SM state.
let sendDispatchTail = Promise.resolve();

// Phase 9 D-14 hardcoded auto-send command. Phase 11 SLIDE-37 makes
// this prefs-driven via prefs.slideAutoSendCommand. The empty-string-
// disables code path in enterSendMode is preserved below for that
// future plug-in. Bytes: B : S L I D E ' ' R \r
const AUTO_SEND_COMMAND = new Uint8Array([
    0x42, 0x3A, 0x53, 0x4C, 0x49, 0x44, 0x45, 0x20, 0x52, 0x0D
]);

// SLIDE wire frame size — slide-rs/protocol.rs FRAME_SIZE (1024 bytes
// per data frame). Used to chunk fileBytes into per-frame payloads.
const FRAME_SIZE = 1024;

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
    } else if (mode === 'send') {
        // Phase 9: dispatcher-driven sender main loop (Pitfall 4
        // RECOMMENDED FIX). dispatchSendMode is async; fire-and-forget here
        // — dispatchInbound's caller (serial.js read loop) does not await,
        // and dispatchSendMode handles its own awaits internally so backpressure
        // and ordering are preserved within the per-chunk lifecycle.
        //
        // Plan 09-04 Rule 1 fix — chain via sendDispatchTail so concurrent
        // chunks are processed strictly in arrival order (FIFO). Without
        // this, two chunks arriving during the same microtask burst race
        // on slide.outbound_len() / slide.clear_outbound() and duplicate
        // the outbound data frames on the wire.
        sendDispatchTail = sendDispatchTail.then(() => dispatchSendMode(value)).catch((err) => {
            console.error('[slide.js] dispatchSendMode failed:', err);
        });
    }
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
    // Phase 9 additions — wipe any pending or active send-mode state.
    pendingSendSession = null;
    currentSendCtx = null;
    // Plan 09-04 Rule 1 fix — reset the dispatch-tail chain so a stale
    // promise from a prior session does not block the next one.
    sendDispatchTail = Promise.resolve();
}
export function __getStateForTests() {
    // Phase 9 D-18 — extended introspection. Phase 8's three fields preserved;
    // sender-mode fields appear only when slide+ctx are populated so receiver
    // tests that read this struct see exactly the Phase 8 shape.
    const baseState = {
        mode,
        wakeIdx,
        hasSlide: slide !== null,
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
            // file-source.js (Plan 09-03) holds names; expose via a wireFileSource
            // -> slide.js callback in that plan. null until wired.
            current_filename: null,
        };
    }
    return baseState;
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
                // wire order), then transition to recv OR send mode.
                if (pending.length) {
                    termRef.feed(new Uint8Array(pending));
                    pending.length = 0;
                }
                // Phase 9 D-13 — branch on pendingSendSession. Auto-typed
                // B:SLIDE R\r set this earlier (in enterSendMode) and the
                // Z80 SLIDE program that subsequently launched is now
                // emitting the wakeup. Consume the pending session and
                // transition to send mode rather than recv.
                if (pendingSendSession) {
                    enterSendModeInternal(pendingSendSession);
                    pendingSendSession = null;
                } else {
                    enterRecvMode();
                }
                wakeIdx = 0;
                // Forward chunk tail to slide (Pitfall 2 — value.subarray(i + 1)
                // skips the matched 7-byte signature).
                const tail = value.subarray(i + 1);
                if (tail.length) {
                    if (mode === 'send') {
                        // Phase 9: dispatcher-driven sender main loop
                        // (Pitfall 4 fix). Async; fire-and-forget — caller
                        // (serial.js read loop) does not await, and the
                        // sender SM's drain/pump cycle handles ordering.
                        //
                        // Plan 09-04 Rule 1 fix — same FIFO chain as
                        // dispatchInbound's send branch.
                        sendDispatchTail = sendDispatchTail.then(() => dispatchSendMode(tail)).catch((err) => {
                            console.error('[slide.js] dispatchSendMode tail failed:', err);
                        });
                    } else {
                        // Phase 8 receiver-mode tail handling unchanged.
                        feedSlide(tail);
                        drainEventsAndOutbound();
                        maybeExitRecvMode();
                    }
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

// ===== Phase 9 sender-mode internals =====

/// Public entry point — called by file-source.js (Plan 09-03) after the
/// user confirms the rewrite/rejection modal. Sets pendingSendSession
/// (depth 1 — second click clobbers per CONTEXT Claude's-Discretion).
/// Auto-types `B:SLIDE R\r` synchronously while owner is 'terminal'
/// (Pitfall 3 — order critical: pushTxBytes BEFORE pendingSendSession).
///
/// `files` shape: `[{ name: string, bytes: Uint8Array }, ...]`. Names are
/// packed into the metadata blob via packMetadataInline; raw byte arrays
/// are kept in fileBytes for the sender pump + NAK retransmit (Pitfall 6
/// Option A — JS holds the ground-truth payload, re-feeds on NAK).
export function enterSendMode({ files }) {
    // Plan 09-02 ships the metadata packer co-located with slide.js for
    // self-containment (file-source.js doesn't exist yet at the end of
    // this plan). Plan 09-03 will move packMetadataInline to file-source.js
    // (per CONTEXT Claude's-Discretion default) and import it here.
    const metadata = packMetadataInline(files);
    const fileBytes = files.map((f) => f.bytes);

    // Phase 9 Pitfall 3 ORDER CRITICAL:
    //   1. pushTxBytes(AUTO_SEND_COMMAND) while owner is 'terminal'
    //   2. THEN set pendingSendSession.
    // Owner stays 'terminal' until the wakeup match flips it in
    // enterSendModeInternal — by that point the auto-type bytes are
    // already on the wire. Reversing this order would silently drop the
    // auto-type bytes (owner === 'slide' silent-drop in pushTxBytes at
    // tx-sink.js:50).
    if (AUTO_SEND_COMMAND.length > 0) {
        pushTxBytes(AUTO_SEND_COMMAND);
    }
    // (else: empty-string-disables semantic — Phase 11 SLIDE-37 plug-in.)

    pendingSendSession = { metadata, fileBytes };
}

/// Pack files-with-names into the CONTEXT D-09 little-endian length-prefixed
/// metadata blob: `<u32 file_count>` followed by per-file
/// `<u32 name_len><name bytes><u32 size>`. Sender SM's enter_send_mode
/// parses this exact layout (verified in Plan 09-01 unit tests).
function packMetadataInline(files) {
    const enc = new TextEncoder();
    const nameBytesArr = files.map((f) => enc.encode(f.name));
    const totalLen = 4 + nameBytesArr.reduce((acc, nb) => acc + 4 + nb.length + 4, 0);
    const buf = new Uint8Array(totalLen);
    const dv = new DataView(buf.buffer);
    let cursor = 0;
    dv.setUint32(cursor, files.length, true /* LE */); cursor += 4;
    for (let i = 0; i < files.length; i++) {
        const nb = nameBytesArr[i];
        dv.setUint32(cursor, nb.length, true); cursor += 4;
        buf.set(nb, cursor); cursor += nb.length;
        dv.setUint32(cursor, files[i].bytes.length, true); cursor += 4;
    }
    return buf;
}

/// Internal — called from the wakeup-completion clause in dispatchTerminalMode.
/// Mirror of enterRecvMode: news a Slide, calls slide.enter_send_mode(metadata),
/// populates currentSendCtx, sets txSinkRef.setWireOwner('slide'), mode='send',
/// kicks an initial drain so the CTRL_RDY pushed by enter_send_mode reaches
/// the wire promptly.
function enterSendModeInternal({ metadata, fileBytes }) {
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
    slide.enter_send_mode(metadata);
    currentSendCtx = {
        fileBytes,
        currentFileIdx: 0,
        sentBytesInFile: 0,
    };
    // D-09 — synchronous handoff. mode + owner flipped together; Pitfall 3.
    txSinkRef.setWireOwner('slide');
    mode = 'send';
    // Initial CTRL_RDY was pushed by enter_send_mode — drain it immediately.
    // Pitfall 4: dispatcher-driven serialization is not yet active because
    // no inbound chunk has arrived yet; spawn a microtask drain so the
    // RDY byte reaches the wire before the Z80 starts emitting frames.
    //
    // Plan 09-04 Rule 1 fix — chain the initial drain through
    // sendDispatchTail so the next inbound chunk's dispatchSendMode waits
    // for this drain to finish (clear_outbound) before reading
    // outbound_len. Without this chain, the very first inbound chunk's
    // dispatchSendMode could race the initial drain and double-write
    // the CTRL_RDY byte.
    sendDispatchTail = sendDispatchTail.then(() => drainSlideOutboundAwaitable()).catch((err) => {
        console.error('[slide.js] enterSendModeInternal initial drain failed:', err);
    });
}

function exitSendMode() {
    // Mirror of exitRecvMode — synchronous handoff back to terminal mode.
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    currentSendCtx = null;
    // Slide instance is left in Done/Error state until the next
    // enterSendModeInternal / enterRecvMode replaces it (mirror of
    // exitRecvMode lifecycle comment).
}

/// Pitfall 4 RECOMMENDED FIX — dispatcher-driven serialization.
/// Mirrors dispatchRecvMode for the 'send' branch but with awaitable
/// drains so PITFALLS §4 backpressure is respected on multi-frame writes.
///
/// Per-chunk lifecycle (RESEARCH §"Pattern: dispatcher-driven sender main loop"):
///   1. feedSlide(value)                       — SM consumes RDY/ACK/NAK/CAN/FIN
///   2. await drainEventsAndOutboundAwaitable() — pull events, await frame writes
///   3. pumpNextDataChunkIfReady()              — if DataPhase, push next FRAME_SIZE chunk
///   4. await drainEventsAndOutboundAwaitable() — drain again (step 3 added bytes)
///   5. maybeExitSendMode()                     — exit on Done/Error/CancelPending
async function dispatchSendMode(value) {
    feedSlide(value);
    await drainEventsAndOutboundAwaitable();
    pumpNextDataChunkIfReady();
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();
}

/// Drain SLIDE events + outbound bytes; the awaitable variant uses
/// writeSlideFrameAwaitable so backpressure is gated per PITFALLS §4.
/// Handles Phase 9 EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE /
/// EVT_RETRANSMIT_NEEDED in addition to the Phase 8 receiver-mode events
/// (drained as no-ops here — receiver attaches handlers via Phase 10).
async function drainEventsAndOutboundAwaitable() {
    if (!slide) return;
    while (true) {
        const evt = slide.take_event_packed();
        if (evt === EVT_NONE) break;
        const kind = evt & 0xFFFF_0000;
        const aux  = evt & 0xFFFF;
        if (kind === EVT_FILE_COMPLETE) {
            // SM has just emitted EVT_FILE_COMPLETE | file_idx and pushed
            // the next file's header onto outbound (or transitioned to
            // FinPending if this was the last file). Advance the JS-side
            // cursor so pumpNextDataChunkIfReady reads from the right file.
            if (currentSendCtx) {
                currentSendCtx.currentFileIdx = aux + 1;
                currentSendCtx.sentBytesInFile = 0;
            }
        } else if (kind === EVT_SESSION_COMPLETE) {
            // SM is in Done; final FIN exchange completed. Don't exit here
            // — let maybeExitSendMode handle it AFTER the outbound drain
            // below (so any final ACK byte still on outbound_buf reaches
            // the wire before we flip the owner back to terminal).
        } else if (kind === EVT_RETRANSMIT_NEEDED) {
            // Pitfall 6 Option A: re-feed the requested seq's payload chunk.
            // The SM rewound current_seq to aux; we re-compute the chunk
            // for that seq from currentSendCtx.fileBytes — JS holds the
            // ground-truth payload, so retransmit is a clean re-derivation
            // rather than a buffered copy.
            const ctx = currentSendCtx;
            if (ctx) {
                const file = ctx.fileBytes[ctx.currentFileIdx];
                if (file) {
                    // seq=1 → offset 0; seq=2 → offset FRAME_SIZE; etc.
                    // Note: seq is u8 (wraps at 256). For files > 255 frames
                    // (~256 KB) this simple mapping needs SM-driven seq
                    // tracking; out of scope for Phase 9 hardware UAT will
                    // surface scope.
                    const seq = aux;
                    const chunkStart = (seq - 1) * FRAME_SIZE;
                    const chunkEnd = Math.min(chunkStart + FRAME_SIZE, file.length);
                    if (chunkStart < file.length) {
                        const payload = file.subarray(chunkStart, chunkEnd);
                        const isEof = chunkEnd === file.length;
                        slide.feed_send_chunk(payload, isEof);
                    }
                }
            }
        }
        // EVT_ACK / EVT_NAK / EVT_RDY / EVT_FIN / EVT_CAN — no JS action;
        // SM internalises the transitions and produces outbound bytes that
        // drainSlideOutboundAwaitable below pushes to the wire.
    }
    // Drain outbound — await each write per PITFALLS §4.
    await drainSlideOutboundAwaitable();
}

/// Awaitable mirror of drainSlideOutbound.
/// Pitfall 5: slice() the view BEFORE awaiting writer.write so the
/// JS-owned copy is valid even if wasm memory grows during the await.
async function drainSlideOutboundAwaitable() {
    if (!slide) return;
    while (true) {
        const len = slide.outbound_len();
        if (len === 0) break;
        // Pitfall 4 — re-derive the view if memory.buffer grew/detached.
        if (wasmRef.memory.buffer !== outboundBuffer) {
            outboundBuffer = wasmRef.memory.buffer;
            outboundView = new Uint8Array(outboundBuffer, slide.outbound_ptr(), OUTBOUND_VIEW_CAP);
        }
        // Pitfall 5 — slice to JS-owned buffer BEFORE await writer.write
        // so a concurrent memory growth doesn't strand the byte serialization.
        const owned = new Uint8Array(outboundView.subarray(0, len));
        await txSinkRef.writeSlideFrameAwaitable(owned);
        slide.clear_outbound();
    }
}

/// If SM is in DataPhase and current file has remaining bytes, push the
/// next FRAME_SIZE chunk via slide.feed_send_chunk. Called every dispatchSendMode
/// cycle; no-op when the SM is mid-await on an ACK or all bytes have been fed.
function pumpNextDataChunkIfReady() {
    if (!slide || !currentSendCtx) return;
    const st = slide.state();
    // STATE_DATA_PHASE = 3 (per slide_boundary_shape.rs:slide_state_enum_repr_u32_pinned).
    if (st !== STATE_DATA_PHASE) return;
    const ctx = currentSendCtx;
    const file = ctx.fileBytes[ctx.currentFileIdx];
    if (!file) return;
    if (ctx.sentBytesInFile >= file.length) return;   // SM is mid-await on ACK
    const chunkStart = ctx.sentBytesInFile;
    const chunkEnd = Math.min(chunkStart + FRAME_SIZE, file.length);
    const payload = file.subarray(chunkStart, chunkEnd);
    const isEof = chunkEnd === file.length;
    slide.feed_send_chunk(payload, isEof);
    ctx.sentBytesInFile = chunkEnd;
}

/// Mirror of maybeExitRecvMode for sender mode. Exits to terminal mode on
/// Done / Error / CancelPending so the next keystroke reaches the wire
/// without owner='slide' silent-dropping it.
function maybeExitSendMode() {
    if (!slide) return;
    const st = slide.state();
    if (st === STATE_DONE || st === STATE_ERROR || st === STATE_CANCEL_PEND) {
        exitSendMode();
    }
}
