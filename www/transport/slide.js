// Beastty Phase 8 — SLIDE dispatcher + 7-byte ESC^ wakeup matcher.
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
// Phase 9 WR-02/WR-03 — getWireOwner + isWriterReady are imported for the
// defensive entry checks in `enterSendMode` (refuse to queue a send when
// the wire is owned by an active SLIDE session, or no writer is registered).
import { pushTxBytes, getWireOwner, isWriterReady } from '../input/tx-sink.js';
// Phase 10 Plan 10-03 — receiver event delegation + per-session lifecycle ref
// + Esc-disambiguation gate (slide-recv.js owns the recv chunks accumulator,
// download dispatch, and cancel state machine). Pre-Phase-10 the dispatcher
// drained recv events to no-op; Plan 10-03 routes EVT_HEADER_RECEIVED /
// EVT_RECV_DATA / EVT_RECV_FILE_DONE through onRecvEvent, and re-issues
// setSlideRef on every enterRecvMode so slide-recv has the live wasm Slide.
import { onRecvEvent, setSlideRef as setSlideRecvRef, isRecvSessionActive, slidePumpOnPortLost as slideRecvPumpOnPortLost, notifyRecvStateTransition } from './slide-recv.js';
// Phase 11 Plan 11-04 SLIDE-14 — auto-type echo swallow filter (CONTEXT C-03).
// Sits BEFORE the wakeup matcher in dispatchTerminalMode's byte loop. After
// the host auto-types a command (e.g. "B:SLIDE R\r"), CP/M echoes those bytes
// back; this filter consumes them byte-for-byte for ~500 ms so the local-echo
// painted version (Phase 4 D-12) doesn't get double-printed by CP/M's echo.
import {
    wireEchoSwallow,
    pushAutoTypedBytes,
    consumeIfMatch as echoSwallowConsumeIfMatch,
} from './echo-swallow.js';
// Phase 12 SLIDE-38 — use-time auto-send safety gate. The pure helper lives
// in prefs.js for testability + to keep the regex in one canonical location.
// Hard-gates at readAutoSendCommandBytes BEFORE TextEncoder.encode so unsafe
// values never reach the wire (T-12-03 mitigation).
// getPrefs() is the live-read entry point — Plan 12-08's pattern (mirrored
// from www/transport/serial.js:27). savePrefs() in prefs.js reassigns the
// module-level `cached` to a new object on every change, so a boot-time
// snapshot held in slide.js's prefsRef captures only the original blob and
// misses subsequent Settings edits. Reading via getPrefs() at use-time
// (readAutoSendCommandBytes, shouldSurfaceFirstUseConfirm, enterSendMode
// compatMode dispatch) closes the Phase 12 UAT Gap C/B cluster
// (.planning/debug/slide-stale-auto-send-cmd.md): old auto-send command
// reaching the wire after Settings change without a page reload, AND the
// first-use-confirm chip being skipped because the stale prefsRef.confirmed
// equality compare matched against the previous value.
import { slideProgramPath, getPrefs } from '../state/prefs.js';
// The pull pane and the Settings row need the same composed program path, so
// it lives in prefs.js (one canonical grammar) and is re-exported here for the
// __slide test surface — every test-observable knob lives under window.__slide.
export { slideProgramPath as __slideProgramPathForTests };

// EVT_* — packed (kind << 16) | aux. JS unpacks via (evt >>> 16) for kind,
// (evt & 0xFFFF) for aux. AUTHORITY: crates/beastty-core/tests/slide_boundary_shape.rs:slide_event_constants_pinned
// + crates/beastty-core/tests/slide_wasm_boundary_shape.rs (Plan 08-01 pin
// + Plan 09-02 extension for the sender constants).
// A Rust-side renumber that didn't update both pin files is caught by
// cargo test; Plan 08-04's Playwright dispatcher harness drives a CTRL_RDY
// byte and asserts the reported event kind matches EVT_RDY for orthogonal
// drift detection.
export const EVT_NONE = 0;
const EVT_RDY         = 1 << 16;       // 0x00010000
const EVT_ACK         = 2 << 16;
const EVT_NAK         = 3 << 16;
const EVT_FIN         = 4 << 16;
const EVT_CAN         = 5 << 16;
const EVT_DATA_FRAME  = 6 << 16;
const EVT_CRC_ERROR   = 7 << 16;
// Phase 9 EVT_* mirror additions — pinned by
// crates/beastty-core/tests/slide_boundary_shape.rs and
// crates/beastty-core/tests/slide_wasm_boundary_shape.rs (Plan 09-02
// boundary-shape pin extension). Drift here vs the Rust-side enum fails
// both pin tests at native cargo test time before reaching JS.
const EVT_FILE_COMPLETE     = 8  << 16;   // aux = file_idx of the file just acked
const EVT_SESSION_COMPLETE  = 9  << 16;   // aux = 0; emitted on FIN exchange completion
const EVT_RETRANSMIT_NEEDED = 10 << 16;   // aux = seq the receiver NAK'd
// Phase 10 receiver extensions — pinned by
// crates/beastty-core/tests/slide_boundary_shape.rs (and wasm sibling).
// Plan 10-01 added the Rust-side enum values; Plan 10-03 mirrors them here so
// drainEventsAndOutbound can route per-event to slide-recv.js's onRecvEvent.
const EVT_HEADER_RECEIVED = 11 << 16;   // aux = file_idx (0-based)
const EVT_RECV_DATA       = 12 << 16;   // aux = seq
const EVT_RECV_FILE_DONE  = 13 << 16;   // aux = file_idx of file just completed

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

// Phase 10 — mid-session ESC^SLIDE re-entry matcher state (separate from
// dispatchTerminalMode's wakeIdx so the two matchers don't interfere when
// dispatchInbound flips between modes mid-stream). On full match,
// slide.force_idle + exitRecvMode + enterRecvMode (T-10-03 mitigation:
// idempotent reset per CONTEXT C-05). The matcher only advances on
// framer-idle bytes (see dispatchRecvMode) — matched prefix bytes are fed
// to the SM as idle no-ops, so no replay scratch buffer is needed.
let recvWakeIdx = 0;

// E9 pull-pane batch hint — how many files the confirmed `SLIDE S …` command
// requested. The SLIDE protocol never announces batch size, so this hint is
// the ONLY source for the chip's "N/M" total on the recv side (device-typed
// sessions have no hint and the chip shows the bare index). Set by main.js
// from the pane's confirm (setExpectedRecvFiles); consumed by the next recv
// session within a 30 s window (an aborted pull must not mislabel a later
// manual session); cleared at exitRecvMode.
let expectedRecvFiles = 0;
let expectedRecvFilesTs = 0;
const EXPECTED_RECV_FILES_TTL_MS = 30_000;

export function setExpectedRecvFiles(n) {
    expectedRecvFiles = (Number.isInteger(n) && n > 0) ? n : 0;
    expectedRecvFilesTs = Date.now();
}

// Injected deps (wireSlideDispatcher sets these).
let termRef = null;
let txSinkRef = null;     // { setWireOwner, getWireOwner, writeSlideFrame }
let SlideCtor = null;     // the wasm-imported Slide class
let wasmRef = null;       // for memory.buffer access in drainSlideOutbound
// Phase 11 Plan 11-03 — additional injected deps for D-09 / D-12 / chip lifecycle.
let prefsRef = null;      // { slideProgramDrive, slideProgramName, slideAutoStart, slideShowSummary, slideCompatibilityMode }
let pastePumpRef = null;  // { cancelPaste } — D-12 paste-pump gate at SLIDE wakeup completion
let slideChipRef = null;  // { enterActive, enterAwaitingWakeup, enterError, ... }
// Phase 12 UAT Niggle 1 — terminal-wrapper element ref for focus restore
// after cancelSlideSend. Without this, hiding the chip leaves the browser's
// focus on a now-display:none button so it falls back to <body>; clicking
// the canvas can't restore the [data-focused] border because selection.js's
// onPointerDown calls preventDefault, blocking the native focus shift to
// the wrapper. Programmatic .focus() in forceExitSendMode fires the focus
// event the wrapper's chrome.js listener uses to set data-focused="true".
let wrapperElRef = null;

// Phase 12 UAT Gap C/B fix (.planning/debug/slide-stale-auto-send-cmd.md).
// livePrefs() returns the always-current cached prefs blob. Order:
//   1. getPrefs() — live read of the module-level `cached` object in prefs.js,
//      which savePrefs() updates on every Settings change.
//   2. prefsRef — boot-time snapshot from wireSlideDispatcher opts. Retained
//      ONLY as a fallback for test harnesses that wire { prefs: customObj }
//      without going through loadPrefs() (so getPrefs() returns null).
//   3. null — caller must guard. Existing default branches at the call sites
//      (the shipped default path, 'auto' compatMode) cover the null path.
function livePrefs() {
    return getPrefs() || prefsRef || null;
}

// Cached outbound view (re-derived on memory growth — Pitfall 4 mirror of
// main.js:reDeriveHostReplyView at lines 274-279). Also invalidated on every
// new SlideCtor() in enterRecvMode / enterSendModeInternal: the cache is
// keyed off `slide.outbound_ptr()` from the PREVIOUS instance, and a new
// Slide allocates a fresh outbound_buf at a different wasm-heap address
// when the prior instance was leaked (e.g. forceExitSendMode/forceExitRecvMode
// null the JS ref without calling slide.free()). The memory.buffer-identity
// check below only catches wasm memory growth, not new-instance address drift.
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

// The bytes Beastty auto-types at the CCP to start SLIDE in receive mode
// before a send. v2 composes them from where SLIDE.COM lives
// (prefs.slideProgramDrive + slideProgramName) and appends the direction
// letter ' R' plus the CR itself — the user no longer states either. The pull
// pane composes ' S' from the same path, which is the point of storing a
// location rather than a command line.
//
// Returns a zero-length Uint8Array — the caller's `length === 0` skip covers
// it without a separate code path — in three cases:
//   - auto-start is off (the user starts SLIDE on the device by hand);
//   - prefs are unavailable AND no fallback applies (tests without the prefs opt
//     still get the shipped default, so existing sender specs keep observing
//     auto-typed bytes);
//   - the stored location fails its grammar. That is the T-12-03 use-time hard
//     gate: the Settings controls cannot produce an invalid value, but a
//     hand-edited or corrupt blob can, and nothing unvalidated reaches the wire.
const AUTO_SEND_DEFAULT_PATH = 'A:SLIDE.COM';
const AUTO_SEND_DIRECTION = ' R\r';

function readAutoSendCommandBytes() {
    // Live read so post-Settings-change values reach the wire without a reload
    // (Phase 12 UAT Gap C — see livePrefs() block above).
    const p = livePrefs();
    // No prefs available (boot order: tests / older harnesses that did not pass
    // the prefs opt) — use the shipped default for backwards compatibility.
    if (!p) return new TextEncoder().encode(AUTO_SEND_DEFAULT_PATH + AUTO_SEND_DIRECTION);
    if (p.slideAutoStart === false) return new Uint8Array(0);
    const path = slideProgramPath(p);
    if (path === null) {
        console.error('[slide] SLIDE.COM location failed validation; auto-start skipped:',
                      JSON.stringify(`${p.slideProgramDrive}${p.slideProgramName}`));
        if (slideChipRef && typeof slideChipRef.enterError === 'function') {
            try { slideChipRef.enterError('SLIDE.COM location invalid — fix in Settings'); } catch {}
        }
        // Defense-in-depth UX feedback on the Settings DOM (mirrors the change
        // handler's cue, for the hand-edited-blob path that never fires one).
        try {
            const inputEl = document.getElementById('slide-program-name');
            if (inputEl) {
                inputEl.setAttribute('data-invalid', 'true');
                inputEl.setAttribute('aria-invalid', 'true');
            }
            const hintEl = document.getElementById('slide-program-validation-hint');
            if (hintEl) hintEl.hidden = false;
        } catch { /* ignore — DOM may not exist in tests */ }
        return new Uint8Array(0);
    }
    return new TextEncoder().encode(path + AUTO_SEND_DIRECTION);
}

// SLIDE wire frame size — slide-rs/protocol.rs FRAME_SIZE (1024 bytes
// per data frame). Used to chunk fileBytes into per-frame payloads.
const FRAME_SIZE = 1024;
// Mirror of slide.asm WIN_SIZE (sliding window: the Z80 receiver ACKs once
// per WIN_SIZE frames; its FLUSH_SIZE — the disk-flush threshold that makes
// it briefly deaf — is WIN_SIZE × FRAME_SIZE, always just before that ACK).
const WIN_SIZE = 4;

// --- Public API -----------------------------------------------------------

export function wireSlideDispatcher(opts) {
    const { term, txSink, slideCtor, wasm, prefs, pastePump, slideChip, wrapperEl } = opts;
    termRef = term;
    txSinkRef = txSink;
    SlideCtor = slideCtor;
    wasmRef = wasm;
    // Phase 11 Plan 11-03 — additional refs for D-09 (the SLIDE.COM location),
    // D-12 (pastePump.cancelPaste at SLIDE wakeup completion), chip lifecycle
    // hooks (enterActive / enterAwaitingWakeup / enterSummary). All optional —
    // null callers (older boot paths, test harnesses) get the same Phase 9/10
    // behaviour through the optional-chained call sites below.
    prefsRef = prefs || null;
    pastePumpRef = pastePump || null;
    slideChipRef = slideChip || null;
    // Phase 12 UAT Niggle 1 — wrapper element ref for focus restore after
    // cancelSlideSend. Optional — fail-open if not threaded through.
    wrapperElRef = wrapperEl || null;
    // Phase 11 Plan 11-04 SLIDE-14 — wire the echo-swallow filter once during
    // dispatcher init (CONTEXT C-03). The filter is module-scope state inside
    // echo-swallow.js; wireEchoSwallow injects the term ref so flushPending can
    // forward unmatched bytes via term.feed.
    wireEchoSwallow({ term });

    // Phase 11 Plan 11-04 D-15 — register chip state-change observer for the
    // Retry / Cancel / Force-start inline actions emitted from the
    // awaiting-timeout state. The chip emits 'inline-action' events through
    // stateChangeObservers when the user clicks one of the bracketed buttons;
    // dispatcher consumes them here. Cancel is also wired through the chip's
    // onCancel callback (Plan 11-03), so the cancel branch here only handles
    // the awaiting-* lifecycle case (no active session yet).
    if (slideChipRef && typeof slideChipRef.onStateChange === 'function') {
        slideChipRef.onStateChange((evt) => {
            if (!evt || evt.kind !== 'inline-action') return;
            handleChipInlineAction(evt.action);
        });
    }
}

// Phase 11 Plan 11-04 D-15 — handle Retry / Cancel / Force-start inline
// actions from the chip's awaiting-timeout state.
function handleChipInlineAction(action) {
    switch (action) {
        case 'retry':
            // Re-emit the auto-type and restart the 3 s wakeup timer. The
            // pendingSendSession is preserved across retry — only the wakeup
            // wait restarts. Honours the current Compatibility mode for
            // armTimer (re-checking prefsRef in case the user changed the
            // Settings dropdown between the original click and the retry).
            if (pendingSendSession) {
                const autoSendBytes = readAutoSendCommandBytes();
                if (autoSendBytes.length > 0) {
                    try { pushTxBytes(autoSendBytes); } catch {}
                    try { pushAutoTypedBytes(autoSendBytes); } catch {}
                }
                // Live read — user may have changed Compatibility mode in
                // Settings between original click and Retry click.
                const compatModeRetry = livePrefs();
                const compatMode = (compatModeRetry && compatModeRetry.slideCompatibilityMode) || 'auto';
                const armTimer = compatMode === 'auto';
                try {
                    if (slideChipRef && typeof slideChipRef.enterAwaitingWakeup === 'function') {
                        slideChipRef.enterAwaitingWakeup({ armTimer });
                    }
                } catch {}
            }
            return;
        case 'force-start':
            // Skip wakeup wait; jump directly into send mode (equivalent to
            // having Compatibility mode set to 'force-start' for this one
            // session — CONTEXT D-15 verbatim semantic). Consume the pending
            // session here so the wakeup-completion clause in
            // dispatchTerminalMode does not also fire.
            //
            // Phase 12.1 Plan 12-07 — chip lifecycle update missing in original
            // Plan 11-04 implementation. Without this call the chip stayed
            // pinned at 'awaiting-timeout' AFTER the click, with zero visible
            // user feedback (gap diagnosed in
            // .planning/debug/12-force-start-button-does-nothing.md). Mirrors
            // the wakeup-completion enterActive() idiom in dispatchTerminalMode
            // (slide.js search "Phase 11 Plan 11-03 — chip lifecycle hook:
            // session active." for the reference call site). Wrapped in its own
            // try/catch so a chip-method exception does not break the
            // dispatcher; the existing outer try only guards
            // enterSendModeInternal.
            if (pendingSendSession) {
                const session = pendingSendSession;
                pendingSendSession = null;
                try {
                    enterSendModeInternal(session);
                    if (slideChipRef && typeof slideChipRef.enterActive === 'function') {
                        slideChipRef.enterActive();
                    }
                } catch (err) {
                    console.error('[slide.js] force-start (chip) enterSendModeInternal failed:', err);
                }
            }
            return;
        case 'cancel': {
            // The chip's onCancel (wired in main.js) handles cancel for active
            // sessions via the Phase 10 5-step cancelSlideRecv state machine.
            // For awaiting-wakeup / awaiting-timeout states (no active session
            // yet — pendingSendSession is queued but enterSendModeInternal
            // hasn't fired), cancel means clear pendingSendSession and hide
            // the chip. Inspect the chip's lifecycle to disambiguate.
            const chipState = (slideChipRef && typeof slideChipRef.__getStateForTests === 'function')
                ? slideChipRef.__getStateForTests()
                : null;
            const lc = chipState ? chipState.lifecycle : null;
            if (lc === 'awaiting-wakeup' || lc === 'awaiting-timeout') {
                pendingSendSession = null;
                try {
                    if (slideChipRef && typeof slideChipRef.hide === 'function') {
                        slideChipRef.hide();
                    }
                } catch {}
            } else if (lc === 'active') {
                // Phase 12 UAT Gap D — active-state cancel must dispatch
                // by mode. main.js's onCancel is the primary path but
                // belt-and-braces here so the inline-action observer fan-out
                // also reaches the right handler when the chip's own
                // onCancelFn somehow short-circuits.
                if (mode === 'send') {
                    void cancelSlideSend();
                }
                // Recv-mode active cancel is still handled exclusively via
                // main.js's onCancel → cancelSlideRecv path (Phase 10/11
                // contract preserved). Do not double-fire here.
            }
            return;
        }
    }
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

// Phase 11 Plan 11-03 D-14 — forward to the real impl in slide-recv.js.
// Existing serial.js imports of slidePumpOnPortLost from this module continue
// to resolve unchanged; the implementation lives in slide-recv.js (the chip
// + reset behaviour is recv-side state). Symmetric with pastePumpOnPortLost
// as wired into serial.js teardown / handleReadError / onNavSerialDisconnect.
export function slidePumpOnPortLost() {
    slideRecvPumpOnPortLost();
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
    // E9 — clear the pull-pane batch hint.
    expectedRecvFiles = 0;
    expectedRecvFilesTs = 0;
    // E11 S11.4 — no cancel has happened in the next spec's session, and no
    // waiter may survive into it.
    lastCancelEchoArrived = null;
    abandonPendingSendStateWait();
}
/// Cheap production predicate for "a send session currently owns the wire".
/// Callers on hot paths (e.g. the Escape keydown arm) use this instead of
/// __getStateForTests, whose full snapshot can cross into wasm.
export function isSendActive() {
    return mode === 'send';
}

/// THE answer to "is a SLIDE transfer running right now?", in EITHER
/// direction. If that is your question, call this and nothing else.
///
/// Added by the E11 retrospective (2026-08-06) to end a recurring defect
/// rather than work around it a seventh time. Before this, every caller
/// hand-rolled the composite from two or three parts, and the versions had
/// drifted into four shapes across the codebase:
///
///   - `isRecvSessionActive()` alone           — blind to every SEND session
///   - `... || getWireOwner() === 'slide'` — misses the pending-send window
///   - the full three-part `hasPendingSendSession || mode ... || wire owner`
///   - `getWireOwner() === 'slide'` alone — misses the pending-send window
///
/// Six sites got their variant right and one did not, which left the
/// tab-close teardown blind to sends (fixed in b9827ab). The four parts, and
/// why each is needed — remove any one and a real window opens up:
///
///   1. mode === 'send' / 'recv' — a session the dispatcher is actively in.
///   2. pendingSendSession — the window after the SLIDE command has been
///      auto-typed but before the Z80's wakeup flips `mode`. Bytes are
///      already committed; the wire is spoken for.
///   3. isRecvSessionActive() — a receive the wasm state machine still holds.
///      Not redundant with (1): the dispatcher can leave recv mode while
///      slide-recv is still settling its final writes.
///   4. wire owner === 'slide' — the tx-sink's own view. Set across both
///      enterRecvMode and enterSendModeProceed, so it covers the moments
///      either side of a mode flip.
///
/// Deliberately cheap: no wasm crossing except isRecvSessionActive()'s
/// already-guarded state() read, so it is safe on keydown-hot paths.
///
/// Want one direction specifically — e.g. to choose WHICH cancel to call?
/// Then you want isSendActive() or slide-recv's isRecvSessionActive(), and
/// you should say in a comment why the direction matters. keyboard.js's Esc
/// chain is the worked example.
export function isTransferRunning() {
    if (mode === 'send' || mode === 'recv') return true;
    if (pendingSendSession !== null) return true;
    if (isRecvSessionActive()) return true;
    return getWireOwner() === 'slide';   // direct tx-sink import (:39), not txSinkRef
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
        expectedRecvFiles,               // E9 batch hint (specs assert set/clear)
        lastCancelEchoArrived,           // E11 S11.4 — did the peer echo CTRL_CAN?
    };
    if (slide && currentSendCtx) {
        return {
            ...baseState,
            state: slide.state(),
            file_idx: currentSendCtx.currentFileIdx,
            total_files: currentSendCtx.fileBytes.length,
            bytes_in_file_done: currentSendCtx.sentBytesInFile,
            bytes_in_file_total: currentSendCtx.fileBytes[currentSendCtx.currentFileIdx]?.length ?? 0,
            // UAT-E9-04 (ii) — names now ride the send session (fileNames in
            // pendingSendSession → currentSendCtx), so the chip shows the
            // current file in the send direction too.
            current_filename: currentSendCtx.fileNames[currentSendCtx.currentFileIdx] ?? null,
        };
    }
    // Phase 10 Plan 10-03 — recv-mode introspection (CONTEXT §"window.__slide
    // recv-mode shape"). W1 wiring: bytes_in_file_done is owned by slide-recv
    // module (currentFile.bytesDone counter). Read via window.__slideRecv
    // getter to honour CONTEXT.md's locked recv-mode shape (where
    // bytes_in_file_done is a meaningful counter, not always 0).
    if (slide && mode === 'recv') {
        const slideRecvState = (typeof window !== 'undefined' && window.__slideRecv && typeof window.__slideRecv.__getStateForTests === 'function')
            ? window.__slideRecv.__getStateForTests()
            : {};
        const recvFilenameLen = slide.recv_filename_len();
        let currentFilename = slideRecvState.currentFilename ?? null;
        if (!currentFilename && recvFilenameLen > 0) {
            const buf = new Uint8Array(wasmRef.memory.buffer, slide.recv_filename_ptr(), 16);
            const slice = buf.subarray(0, recvFilenameLen);
            currentFilename = new TextDecoder('latin1').decode(slice);
        }
        return {
            ...baseState,
            state: slide.state(),
            // recv_current_file_idx() counts headers SEEN (the SM post-
            // increments at header parse), so mid-file it is already 1-based.
            // The chip renders `file_idx + 1` (matching the send side's
            // 0-based send_current_file_idx()), so normalise to 0-based-
            // current here — otherwise a single-file pull displays "2/…".
            file_idx: Math.max(0, slide.recv_current_file_idx() - 1),
            // The protocol never announces batch size; the only source is the
            // E9 pull-pane hint (0 when the session wasn't pane-initiated —
            // the chip then shows the bare index).
            total_files: expectedRecvFiles,
            bytes_in_file_done: slideRecvState.bytesInFileDone ?? 0,   // W1 wiring
            bytes_in_file_total: slide.recv_file_size(),
            current_filename: currentFilename,
            recv_to_folder: slideRecvState.recvToFolder ?? false,
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

        // Phase 11 Plan 11-04 SLIDE-14 — swallow auto-typed echo BEFORE wakeup
        // matcher (CONTEXT C-03). If the swallow buffer is non-empty and the
        // current byte matches the buffer head, the byte is consumed silently
        // (CP/M's echo of the auto-typed command is a duplicate of what the
        // local-echo painted — see Phase 4 D-12). On mismatch OR 500 ms expiry,
        // the filter flushes its remaining buffer to term.feed (preserves any
        // echo that didn't fully match — no byte loss) and lets this byte
        // continue through the wakeup matcher.
        if (echoSwallowConsumeIfMatch(b)) {
            i++;
            continue;
        }

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
                // Phase 11 Plan 11-03 D-12 — paste-pump gate at SLIDE wakeup
                // completion. In-flight large paste is interrupted via the
                // existing Phase 5 D-18 cancel chip (`Paste cancelled`).
                // Subsequent enqueuePaste calls during the active session are
                // refused separately by the isTransferRunning() early-return in
                // www/input/paste-pump.js (Edit 6 of this plan).
                try {
                    if (pastePumpRef && typeof pastePumpRef.cancelPaste === 'function') {
                        pastePumpRef.cancelPaste();
                    }
                } catch {}
                // Phase 11 Plan 11-03 — chip lifecycle hook: session active.
                try {
                    if (slideChipRef && typeof slideChipRef.enterActive === 'function') {
                        slideChipRef.enterActive();
                    }
                } catch {}
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

// Phase 10 — Plan 10-03 — recv-mode dispatcher with mid-session ESC^SLIDE
// re-entry matcher (Pattern 9 verbatim from 10-RESEARCH.md / T-10-03 mitigation).
// Walks bytes byte-by-byte running the 7-byte wakeup matcher in PARALLEL with
// the framer feed. On match → console.warn + slide.force_idle() + exitRecvMode +
// enterRecvMode (idempotent reset per CONTEXT C-05). Bytes BEFORE the wakeup
// feed to the existing SM (last-ditch ACK opportunity); bytes AFTER feed to a
// fresh SM. Pattern mirrors dispatchTerminalMode (lines 229-310) for consistency.
function dispatchRecvMode(value) {
    // Defensive: dispatchRecvMode is synchronous (unlike dispatchSendMode's
    // async-chained path), but if mode flipped to 'terminal' between
    // dispatchInbound's mode-read and this call (e.g., a re-entrant
    // call path or future refactor), forward the chunk straight to the
    // terminal parser so trailing bytes never get silent-dropped by a
    // Done-state SM. Mirror of the dispatchSendMode async-chain guard.
    if (mode !== 'recv') {
        if (value && value.length > 0 && termRef) {
            try {
                termRef.feed(new Uint8Array(value));
            } catch (e) {
                console.error('[slide.js] dispatchRecvMode post-session forward threw:', e);
            }
        }
        return;
    }

    // Mid-session ESC^SLIDE re-entry matcher; it advances only on bytes the
    // framer sees BETWEEN frames (framer idle). A wakeup signature INSIDE a
    // frame payload is file content, not a Z80 reset — slide.com literally
    // carries its own wakeup_sig bytes, and the unconditional matcher tore
    // the session down mid-transfer the moment frame 1 replayed them (real
    // hardware, 2026-07-24), dumping the rest of the stream to the terminal
    // and stranding the wire owner on 'slide'. A genuine reset normally
    // emits the signature on an otherwise-quiet line where the framer is
    // idle. Known trade-off: a reset landing mid-frame parks the framer
    // non-idle (it has no byte timeout), so that replayed signature is eaten
    // as payload and re-entry does not fire — recovery is the documented
    // Esc cancel (cancelSlideRecv's 2 s force_idle escape hatch). (Old wasm
    // without framer_idle() falls back to always-idle — the old
    // unconditional behavior.)
    //
    // The matcher is folded into the byte-walk below; matched prefix bytes
    // are still fed to the SM — in framer-idle state the signature bytes
    // (none of which are SOF or a CTRL byte) are no-ops, so no replay
    // bookkeeping is needed.
    //
    // v1.1 polish 260513-grs Task 3 — post-FIN tail forwarding (recv side).
    // When the Z80's own CTRL_FIN arrives in the same chunk as trailing
    // terminal text, the Rust SM transitions to Done on the FIN byte and
    // state.rs:347-349 silently drops every subsequent byte (same root cause
    // as the send side). Feed byte-by-byte and capture the tail at the Done
    // transition; after maybeExitRecvMode flips mode back to 'terminal',
    // forward the tail to termRef.feed.
    //
    // Pre-FIN state on recv side is broader than send (state.rs ~line 609:
    // recv transitions Done from HeaderPhase on EVT_FIN), so the predicate
    // is just "any transition to Done while bytes remain in the chunk".
    // The byte-walk is uniformly applied — single feed_byte calls are roughly
    // equivalent to feed_chunk on a 1-byte slice and recv-mode chunks are
    // typically short (line-buffered or small Z80 writes), so the perf
    // overhead is negligible.
    let recvPostFinTail = null;
    let recvDoneAt = -1;
    for (let i = 0; i < value.length; i++) {
        const b = value[i];
        const stBefore = slide.state();
        if (stBefore === STATE_DONE || stBefore === STATE_ERROR) {
            // Already Done before this byte — bytes from here on are tail.
            recvDoneAt = i - 1;
            break;
        }
        // Only bytes that match the signature head or continue a partial
        // match can touch the matcher (including its non-idle reset), so
        // skip the per-byte JS→wasm framer_idle() crossing for everything
        // else — mid-transfer that is virtually every payload byte.
        if (b === WAKEUP[recvWakeIdx] || recvWakeIdx > 0) {
            const framerIdle = (typeof slide.framer_idle === 'function')
                ? slide.framer_idle()
                : true;
            if (framerIdle) {
                if (b === WAKEUP[recvWakeIdx]) {
                    recvWakeIdx++;
                    if (recvWakeIdx === 7) {
                        recvWakeIdx = 0;
                        console.warn('[slide.js] mid-session ESC^SLIDE detected — Z80 reset; re-entering recv mode');
                        // Settle the old SM (the already-fed signature-prefix
                        // bytes were framer-idle no-ops), then swap in a fresh
                        // session. Later bytes in this chunk feed the new SM.
                        // Preserve the pane's batch-total hint across the
                        // teardown — exitRecvMode zeroes it, but the resumed
                        // session is the same user-initiated pull and should
                        // keep its 'N/M' chip labelling (enterRecvMode's TTL
                        // check still guards a genuinely stale hint).
                        const savedExpected = expectedRecvFiles;
                        const savedExpectedTs = expectedRecvFilesTs;
                        drainEventsAndOutbound();
                        if (slide && typeof slide.force_idle === 'function') slide.force_idle();
                        exitRecvMode();
                        expectedRecvFiles = savedExpected;
                        expectedRecvFilesTs = savedExpectedTs;
                        enterRecvMode();
                        continue;   // this byte was the signature's last — consumed
                    }
                } else if (recvWakeIdx > 0) {
                    recvWakeIdx = (b === WAKEUP[0]) ? 1 : 0;
                }
            } else if (recvWakeIdx > 0) {
                // The framer entered a frame — any partial signature was noise.
                recvWakeIdx = 0;
            }
        }
        slide.feed_byte(b);
        const stAfter = slide.state();
        // E11 S11.4 — settle slide-recv's cancel Step 3 wait on the transition
        // itself, carrying the state VALUE. It must hang off this point, not
        // off drainEventsAndOutbound: while the SM is in CancelPending it
        // consumes bytes and emits NO events at all (ADR-003 §4), so the echo
        // produces nothing for the event drain to see. It also has to run
        // before maybeExitRecvMode below, which nulls slide-recv's ref.
        // No-ops unless a cancel wait is actually pending.
        notifyRecvStateTransition(stAfter);
        if (stAfter === STATE_DONE || stAfter === STATE_ERROR) {
            recvDoneAt = i;
            break;
        }
    }
    if (recvDoneAt >= 0 && recvDoneAt < value.length - 1) {
        recvPostFinTail = value.subarray(recvDoneAt + 1);
    }
    drainEventsAndOutbound();
    maybeExitRecvMode();
    if (recvPostFinTail && mode === 'terminal' && recvPostFinTail.length > 0 && termRef) {
        try {
            termRef.feed(new Uint8Array(recvPostFinTail));
        } catch (e) {
            console.error('[slide.js] post-FIN tail forward (recv) threw:', e);
        }
    }
}

function feedSlide(bytes) {
    slide.feed_chunk(bytes);
}

function drainEventsAndOutbound() {
    // Phase 10 Plan 10-03 — extended to dispatch on EVT_HEADER_RECEIVED /
    // EVT_RECV_DATA / EVT_RECV_FILE_DONE. Earlier phases drained events to
    // no-op; the recv-mode dispatcher now routes per-event to slide-recv.js's
    // onRecvEvent. Other events (EVT_RDY/ACK/NAK/FIN/CAN/DATA_FRAME/CRC_ERROR
    // and the Phase 9 sender-mode events) drain to no-op here — the sender
    // path uses drainEventsAndOutboundAwaitable (the awaitable mirror).
    let evt;
    while ((evt = slide.take_event_packed()) !== EVT_NONE) {
        const kind = evt & 0xFFFF_0000;
        if (kind === EVT_HEADER_RECEIVED || kind === EVT_RECV_DATA || kind === EVT_RECV_FILE_DONE) {
            onRecvEvent(evt);
        }
    }
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
    // E9 batch hint TTL — a pull confirmed long ago (Z80 errored, user walked
    // away) must not label this session with a stale total.
    if (expectedRecvFiles && Date.now() - expectedRecvFilesTs > EXPECTED_RECV_FILES_TTL_MS) {
        expectedRecvFiles = 0;
    }
    // Per-session new Slide() (Claude's Discretion default — no Slide::reset()
    // singleton optimization; ~1 KB allocation per session is irrelevant at
    // SLIDE's session cadence).
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
    // The new Slide's outbound_buf is at a different wasm-heap address than
    // any cached view. Force re-derive on the next drain.
    outboundBuffer = null;
    outboundView = null;
    slide.enter_recv_mode();
    // Phase 10 Plan 10-03 — give slide-recv module the live instance per
    // CONTEXT C-05 per-session lifecycle. slide-recv reads slideRef in
    // onRecvEvent (chunks accumulator) + cancelSlideRecv (5-step CTRL_CAN).
    setSlideRecvRef(slide);
    // D-09 — synchronous handoff. Pitfall 3 — flip both mode and owner in
    // the same helper to prevent half-state.
    txSinkRef.setWireOwner('slide');
    mode = 'recv';
}

function exitRecvMode() {
    // Phase 11 Plan 11-03 — chip lifecycle hook: summary on successful exit
    // (D-08 — gated by prefs.slideShowSummary inside the chip module).
    // Plan 11-04 may extend with cumulative byte tally; for now totalBytes is
    // best-effort 0 (the chip's enterSummary renders "Received N files — X.X MB"
    // and Plan 11-04 can wire a real cumulative counter from slide-recv module
    // state). Fired BEFORE setWireOwner so the chip captures the active-session
    // direction before mode flips back to 'terminal'.
    try {
        if (slideChipRef && typeof slideChipRef.enterSummary === 'function') {
            slideChipRef.enterSummary({
                direction: 'received',
                fileCount: 1,
                totalBytes: 0,
            });
        }
    } catch {}
    // D-09 — synchronous handoff. mode + owner flipped together; Pitfall 3.
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    // E9 batch hint is per-session — never carries past the session it labeled.
    expectedRecvFiles = 0;
    // Phase 10 review WR-02 — clear slide-recv's slideRef so it cannot
    // dereference the stale Slide after the next enterRecvMode's slide.free()
    // frees its wasm memory (RESEARCH Pitfall 4 — wasm-bindgen panics across
    // FFI are uncatchable; null the ref instead). The recv module's
    // isRecvSessionActive / cancelSlideRecv are defensive against a null ref.
    setSlideRecvRef(null);
    // Slide instance lifecycle: leave the Done/Error instance non-null until
    // the next enterRecvMode replaces it (subsequent feed_byte/feed_chunk on
    // a Done state are no-ops in the SM per Phase 7 state.rs:128-131).
    // Phase 8 doesn't reset the cached outboundView/outboundBuffer — they
    // were derived for THIS instance and would be invalidated by the next
    // new Slide() anyway; drainSlideOutbound's wasmRef.memory.buffer check
    // catches any change.
}

// Plan 10-05 Rule 1 fix — slide-recv.js's cancel sequence flips the wire
// owner back to 'terminal' but it cannot reach into slide.js's module-scope
// `mode` variable. Without this, after a programmatic cancel the dispatcher
// stays in 'recv' mode and routes subsequent inbound bytes to dispatchRecvMode
// (which then needs an inbound chunk to call maybeExitRecvMode). The cleanest
// fix is to export an idempotent `forceExitRecvMode` that slide-recv.js
// invokes from its own forceExitRecvMode() helper. mode + owner stay locked
// together (Pitfall 3 / D-09 synchronous handoff invariant).
export function forceExitRecvMode() {
    if (mode === 'recv' || mode === 'send') {
        if (txSinkRef && typeof txSinkRef.setWireOwner === 'function') {
            txSinkRef.setWireOwner('terminal');
        }
        mode = 'terminal';
    }
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
    // Phase 9 WR-05 — first-click-wins. If a pendingSendSession is already
    // queued (the 200ms button-disable poll has not yet caught up to the
    // first click's state change), refuse to push auto-type bytes a second
    // time. Otherwise two rapid clicks would auto-type `B:SLIDE R\rB:SLIDE
    // R\r` (20 bytes), the Z80's CCP would execute SLIDE twice, and only
    // the first ESC^SLIDE wakeup would consume `pendingSendSession` — the
    // second SLIDE invocation would be fielded as recv-mode (a phantom
    // recv session the user did not initiate). Phase 11 SLIDE-35 owns the
    // user-visible chip; for Phase 9 a console.warn keeps the failure
    // observable.
    if (pendingSendSession !== null) {
        console.warn('[slide.js] enterSendMode: send already pending; ignoring duplicate click');
        return;
    }

    // Phase 9 WR-02 — refuse if the wire is owned by an active SLIDE
    // session (mode === 'recv' or 'send'). pushTxBytes at tx-sink.js:50
    // would silently drop the auto-type bytes (`owner === 'slide'`),
    // pendingSendSession would be set with no wakeup ever arriving, and
    // the user would see "I clicked Send and nothing happened." The
    // file-source button-state observer also blocks this path now (WR-02
    // updateButtonState extension), but the defense-in-depth check here
    // catches programmatic callers (window.__slide.enterSendMode).
    const owner = getWireOwner();
    if (owner !== 'terminal') {
        console.warn(`[slide.js] enterSendMode: wire owner is '${owner}'; refusing to queue send`);
        return;
    }

    // Phase 9 WR-03 — refuse if no writer is registered (i.e., the user
    // clicked Send before clicking Connect). Auto-type bytes would
    // accumulate in the local ring but never reach the wire; the wakeup
    // would never arrive; pendingSendSession would wait forever.
    if (!isWriterReady()) {
        console.error('[slide.js] enterSendMode: no writer registered; aborting (click Connect first)');
        return;
    }

    enterSendModeProceed({ files });
}

// The auto-type + chip + pendingSendSession sequence. Kept separate from
// enterSendMode's refusal checks so the ORDER-CRITICAL block below reads on
// its own. readAutoSendCommandBytes reads prefs internally, applying the
// use-time validation gate.
function enterSendModeProceed({ files }) {
    // Plan 09-02 ships the metadata packer co-located with slide.js for
    // self-containment (file-source.js doesn't exist yet at the end of
    // this plan). Plan 09-03 will move packMetadataInline to file-source.js
    // (per CONTEXT Claude's-Discretion default) and import it here.
    const metadata = packMetadataInline(files);
    const fileBytes = files.map((f) => f.bytes);

    // Phase 9 Pitfall 3 ORDER CRITICAL:
    //   1. pushTxBytes(autoSendBytes) while owner is 'terminal'
    //   2. THEN set pendingSendSession.
    // Owner stays 'terminal' until the wakeup match flips it in
    // enterSendModeInternal — by that point the auto-type bytes are
    // already on the wire. Reversing this order would silently drop the
    // auto-type bytes (owner === 'slide' silent-drop in pushTxBytes at
    // tx-sink.js:50).
    //
    // Phase 11 Plan 11-03 D-09 — auto-send sourced from prefs (replaces the
    // Phase 9 D-14 hardcoded constant). Empty-string disables auto-type per
    // SLIDE-13 semantic — preserved verbatim.
    const autoSendBytes = readAutoSendCommandBytes();
    if (autoSendBytes.length > 0) {
        pushTxBytes(autoSendBytes);
        // Phase 11 Plan 11-04 SLIDE-14 — arm the echo-swallow filter with the
        // post-rewrite TX bytes. CP/M echoes what it received (which is what
        // went on the wire); CR/LF mode (Phase 4 D-13) applies before
        // pushTxBytes, so the same bytes feed both sinks and the swallow
        // buffer is aligned with the inbound echo. Empty-string-disables
        // semantic skips this naturally — autoSendBytes.length === 0 leaves
        // the filter idle (no swallow buffer arming when no auto-type fired).
        pushAutoTypedBytes(autoSendBytes);
    }
    // (else: empty-string-disables semantic — preserved from Phase 9 D-14.)

    // UAT-E9-04 niggle (ii) — carry the (post-rewrite) filenames so the chip
    // can show the current file during a send. Names were previously dropped
    // here and __getStateForTests hardcoded current_filename: null (a Phase 9
    // "until wired" leftover).
    pendingSendSession = { metadata, fileBytes, fileNames: files.map((f) => f.name) };

    // Phase 11 Plan 11-04 D-16 — Compatibility mode 3-way branch governs how
    // the wakeup wait is handled. prefs.slideCompatibilityMode comes from the
    // Settings sub-block (Plan 11-03 D-05); the default 'auto' is applied
    // defensively when prefs are missing or contain an unknown value.
    //
    //   - 'auto' (default): auto-type + 3 s wakeup wait + timeout chip on
    //     miss. Chip arms the 3-second setTimeout (D-15) inside slide-chip.js.
    //   - 'wakeup-required': auto-type + indefinite wait for wakeup. Chip
    //     stays in awaiting-wakeup; user has Esc / Cancel as the only exit
    //     (suitable for modern slide.com that always emits ESC ^ S L I D E).
    //   - 'force-start' (legacy slide.com): auto-type + skip wakeup wait
    //     entirely. Chip surfaces awaiting-wakeup briefly, then a microtask-
    //     scheduled enterSendModeInternal jumps directly into send mode (no
    //     wakeup matcher arm).
    // Live read — Settings change handler updates slideCompatibilityMode on
    // every edit; stale prefsRef would route Auto/Wakeup/Force-start branching
    // off the boot-time value.
    const compatModeProceed = livePrefs();
    const compatMode = (compatModeProceed && compatModeProceed.slideCompatibilityMode) || 'auto';
    if (compatMode === 'force-start') {
        // CONTEXT D-07 / D-16 — skip wakeup wait. Chip enters awaiting-wakeup
        // briefly so the user sees the auto-type land, then we transition to
        // send mode. The microtask-scheduled enterSendModeInternal allows the
        // pushTxBytes auto-type bytes to clear the local ring before owner
        // flips to 'slide' — Pitfall 3 ordering invariant preserved.
        try {
            if (slideChipRef && typeof slideChipRef.enterAwaitingWakeup === 'function') {
                slideChipRef.enterAwaitingWakeup({ armTimer: false });
            }
        } catch {}
        const session = pendingSendSession;
        pendingSendSession = null;
        Promise.resolve().then(() => {
            try { enterSendModeInternal(session); } catch (err) {
                console.error('[slide.js] force-start enterSendModeInternal failed:', err);
            }
        });
    } else if (compatMode === 'wakeup-required') {
        // CONTEXT D-07 / D-16 — auto-type + indefinite wait for wakeup.
        // Chip displays "↑ Waiting for Z80…  [Cancel]" until the 7-byte
        // wakeup arrives or the user cancels. No timeout chip ever surfaces.
        try {
            if (slideChipRef && typeof slideChipRef.enterAwaitingWakeup === 'function') {
                slideChipRef.enterAwaitingWakeup({ armTimer: false });
            }
        } catch {}
    } else {
        // CONTEXT D-07 / D-16 — 'auto' default: auto-type + 3 s wakeup wait
        // + timeout chip on miss. Chip arms the 3 s setTimeout in
        // slide-chip.js's enterAwaitingWakeup(armTimer:true).
        try {
            if (slideChipRef && typeof slideChipRef.enterAwaitingWakeup === 'function') {
                slideChipRef.enterAwaitingWakeup({ armTimer: true });
            }
        } catch {}
    }
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
function enterSendModeInternal({ metadata, fileBytes, fileNames }) {
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
    // The new Slide's outbound_buf is at a different wasm-heap address than
    // any cached view. Force re-derive on the next drain.
    outboundBuffer = null;
    outboundView = null;
    slide.enter_send_mode(metadata);
    sendCtrlSeqPending = false;   // fresh framer — no cross-chunk seq owed (UAT-E9-03)
    currentSendCtx = {
        fileBytes,
        fileNames: fileNames || [],   // UAT-E9-04 (ii) — chip filename source
        currentFileIdx: 0,
        sentBytesInFile: 0,
        // True while a pumped window (or EOF frame) awaits its ACK. The pump
        // refuses to push the next window until the drain loop observes the
        // ACK (or a NAK's retransmit event), so a chunk that carries no
        // completed ACK — a split ACK's lone control byte, console text,
        // line noise — cannot advance the sender past the Z80's ACK cadence.
        windowAckOwed: false,
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

// Phase 12 UAT Gap D fix (.planning/debug/slide-active-cancel-broken.md).
// cancelSlideSend mirrors slide-recv.js cancelSlideRecv but for send mode.
// Wired into the chip's [Cancel] button via main.js's mode-dispatching
// onCancel callback. Without this, force-start (and any wakeup-completion)
// active-state cancellation was a dead button — chip stayed visible until
// page reload because main.js routed onCancel only to cancelSlideRecv,
// whose !isRecvSessionActive() guard short-circuits in send mode (slide-recv.js
// never sees a slideRef in send sessions).
//
// 5-step ADR-003 dance, 2 s absolute timeout escape:
//   1. settle in-flight pump (200 ms)
//   2. slide.cancel() pushes CTRL_CAN to outbound; drain to wire
//   3. wait up to 500 ms for Z80 echo (state transitions Done)
//   4. drain 100 ms post-echo
//   5. if no echo, force_idle escape hatch + forceExitSendMode
const SEND_CANCEL_INFLIGHT_TIMEOUT_MS = 200;
const SEND_CANCEL_ECHO_WAIT_MS = 500;
const SEND_CANCEL_DRAIN_MS = 100;
const SEND_CANCEL_ABSOLUTE_TIMEOUT_MS = 2000;
let sendCancelInFlight = false;

// E11 S11.4 — observability for the Step 3 echo wait. `true` when the Z80's
// CTRL_CAN echo settled the wait, `false` when the 500 ms budget expired,
// `null` before any cancel in this page session. Specs read it through
// __getStateForTests to tell "the peer answered" apart from "we gave up",
// which the mode flag alone cannot express (both land in 'terminal').
let lastCancelEchoArrived = null;

// UAT-E9-03 (2026-07-24, real-hardware multi-file send) — a lone ACK/NAK
// control byte at a chunk boundary parks the Rust framer in AfterAckOrNak
// awaiting the seq byte, which arrives as the FIRST byte of the NEXT chunk.
// That seq is raw binary (any 0x00-0xFF) and usually NOT a control value, so
// the stateless classifier in dispatchSendMode misrouted it to the terminal:
// the ACK never completed, the SM never advanced, no next-file header was
// sent, and the session wedged with the Z80 polling .file_loop silently.
// The EOF ACK is the split-prone one — slide.asm prints "Transfer complete!"
// right behind it, so chunk boundaries land inside the pair. This flag
// carries the obligation across chunks; cleared on session entry/exit.
let sendCtrlSeqPending = false;

function sendCancelDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// waitForSendState — symmetric twin of slide-recv.js's waitForState (both were
// created as mirrors in 728cbfe). Resolves when the SM transitions to
// targetState, or false when timeoutMs expires.
//
// E11 S11.4 — this used to poll every 10 ms against a deadline. Chromium floors
// a hidden tab's chained timers at ~1 s while performance.now() keeps real
// time, so the poll collapsed to one or two samples and the Z80's published
// ~500 ms echo budget was never sampled; at chain depth >= 5 (which a poll loop
// is by construction) intensive throttling aligns timers to ~1-minute buckets
// and the 2 s absolute timeout force-idles a healthy session. One non-chained
// deadline can only be made to fire LATE by a clamp, which is the safe
// direction. The transition itself is reported by notifySendStateTransition
// from the inbound byte-walk.
let pendingSendStateWaiter = null;

// Same module as the dispatcher, so no export is needed here (the recv twin
// needs one because its dispatcher lives in this file).
function notifySendStateTransition(stateValue) {
    const waiter = pendingSendStateWaiter;
    if (!waiter) return;
    if (stateValue === waiter.targetState) waiter.settle(true);
}

function abandonPendingSendStateWait() {
    if (pendingSendStateWaiter) pendingSendStateWaiter.settle(false);
}

function waitForSendState(targetState, timeoutMs) {
    return new Promise((resolve) => {
        // Synchronous first check — the CAN echo can already have been fed
        // during the await drainSlideOutboundAwaitable() in Step 2.
        if (slide && slide.state() === targetState) {
            resolve(true);
            return;
        }
        const waiter = { targetState, settle: null };
        let settled = false;
        const deadline = setTimeout(() => waiter.settle(false), timeoutMs);
        waiter.settle = (matched) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);          // a leaked timer would outlive the session
            if (pendingSendStateWaiter === waiter) pendingSendStateWaiter = null;
            resolve(matched);
        };
        pendingSendStateWaiter = waiter;
    });
}

function forceExitSendMode() {
    abandonPendingSendStateWait();   // E11 S11.4 — `slide` is nulled below
    // Quick exit on cancel — does NOT call enterSummary (which advertises
    // "Sent N files"). Hides the chip, releases wire owner, clears send
    // context. Mirror of slide-recv.js forceExitRecvMode.
    try {
        if (slideChipRef && typeof slideChipRef.hide === 'function') slideChipRef.hide();
    } catch {}
    try {
        if (txSinkRef && typeof txSinkRef.setWireOwner === 'function') txSinkRef.setWireOwner('terminal');
    } catch {}
    mode = 'terminal';
    currentSendCtx = null;
    pendingSendSession = null;
    sendCtrlSeqPending = false;   // UAT-E9-03 — never carry a seq owed into the next session
    // Free the WASM Slide struct before dropping the JS ref so the next
    // SlideCtor() can reuse the freed allocation. Without this the leaked
    // struct keeps its outbound_buf bytes intact at the old wasm-heap
    // address (Vec::clear preserves capacity bytes), and a stale cached
    // outboundView in drainSlideOutbound* would read those bytes on the
    // next session — observed by Z80 slide.com as a leading CTRL_CAN.
    try {
        if (slide && typeof slide.free === 'function') slide.free();
    } catch {}
    slide = null;
    // Phase 12 UAT Niggle 1 — restore focus to terminal-wrapper so the
    // [data-focused] border re-paints. Without this, focus stayed on the
    // hidden chip's [Cancel] button → browser dropped to <body> →
    // wrapper's focus event never fired → data-focused stayed false.
    try {
        if (wrapperElRef && typeof wrapperElRef.focus === 'function') {
            wrapperElRef.focus();
        }
    } catch {}
}

export async function cancelSlideSend() {
    if (sendCancelInFlight) return;
    if (mode !== 'send' || !slide) {
        // Defensive: no active send session. Clear any queued pending session
        // and hide the chip. Covers the race against a still-pending
        // enterSendMode that hasn't flipped mode yet.
        pendingSendSession = null;
        try {
            if (slideChipRef && typeof slideChipRef.hide === 'function') slideChipRef.hide();
        } catch {}
        return;
    }
    sendCancelInFlight = true;
    // Clear the previous cancel's answer up front — otherwise a cancel that
    // never reaches its Step 3 assignment (it threw, or __resetForTests cut it
    // short) leaves the LAST cancel's `true` standing and a reader concludes
    // "the peer echoed" about a cancel that was never answered.
    lastCancelEchoArrived = null;

    const absoluteTimeout = setTimeout(() => {
        console.warn('[slide.js] send-cancel absolute timeout (2s); force_idle');
        try {
            if (slide && typeof slide.force_idle === 'function') slide.force_idle();
        } catch {}
        forceExitSendMode();
    }, SEND_CANCEL_ABSOLUTE_TIMEOUT_MS);

    try {
        // Step 1 — settle window for any pending dispatchSendMode pump.
        await sendCancelDelay(SEND_CANCEL_INFLIGHT_TIMEOUT_MS);
        // Step 2 — push CTRL_CAN onto outbound (Rust state.rs:382 boundary).
        if (slide && typeof slide.cancel === 'function') {
            slide.cancel();
        }
        try { await drainSlideOutboundAwaitable(); } catch {}
        // Step 3 — wait up to 500 ms for Z80 echo (state Done).
        const echoArrived = await waitForSendState(STATE_DONE, SEND_CANCEL_ECHO_WAIT_MS);
        lastCancelEchoArrived = echoArrived;   // E11 S11.4 observability
        // E11 S11.4 — the 2 s hatch guards a HUNG cancel; once the peer has
        // echoed, all that remains is a fixed local drain. It has to be
        // disarmed here because a hidden tab floors every setTimeout at ~1 s:
        // Step 1's 200 ms and Step 4's 100 ms alone then stretch to ~2 s and
        // trip the hatch on a perfectly healthy cancel — force-idling the
        // session and printing a failure that did not happen. The 2000 ms
        // value is unchanged and still guards the no-echo path in full.
        if (echoArrived) clearTimeout(absoluteTimeout);
        // Step 4 — drain 100 ms post-echo.
        await sendCancelDelay(SEND_CANCEL_DRAIN_MS);
        // Step 5 — escape hatch.
        if (!echoArrived && slide && typeof slide.force_idle === 'function') {
            slide.force_idle();
        }
        clearTimeout(absoluteTimeout);
        forceExitSendMode();
    } catch (e) {
        clearTimeout(absoluteTimeout);
        console.error('[slide.js] send-cancel sequence threw:', e);
        try {
            if (slide && typeof slide.force_idle === 'function') slide.force_idle();
        } catch {}
        forceExitSendMode();
    } finally {
        sendCancelInFlight = false;
    }
}

function exitSendMode() {
    // Phase 11 Plan 11-03 — chip lifecycle hook: summary on successful exit
    // (D-08 — gated by prefs.slideShowSummary inside the chip module).
    // Fired BEFORE setWireOwner so the chip captures the active-session
    // direction before mode flips back to 'terminal'. fileCount is read from
    // pendingSendSession.fileBytes.length when available; currentSendCtx has
    // already been mutated as files completed and may be null at the
    // last-file-completed exit boundary. Plan 11-04 can extend with a
    // cumulative byte tally tracked across the send loop.
    try {
        if (slideChipRef && typeof slideChipRef.enterSummary === 'function') {
            const fileCount = currentSendCtx ? currentSendCtx.fileBytes.length : 1;
            slideChipRef.enterSummary({
                direction: 'sent',
                fileCount,
                totalBytes: 0,
            });
        }
    } catch {}
    // Mirror of exitRecvMode — synchronous handoff back to terminal mode.
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    currentSendCtx = null;
    sendCtrlSeqPending = false;   // UAT-E9-03 — never carry a seq owed into the next session
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
    // Async-chain race: dispatchInbound queued us with `mode === 'send'`
    // captured at call time, but the sendDispatchTail FIFO may have run a
    // prior chunk's dispatchSendMode in between and flipped `mode` to
    // 'terminal' via exitSendMode. If so, this chunk is post-session — the
    // Z80's trailing text (e.g. `Session complete.` from slide.asm's
    // msg_done_session) following the FIN echo in a SEPARATE wire chunk.
    // Forward straight to the terminal parser; without this, feedSlide would
    // call slide.feed_chunk on a Done-state SM which state.rs:347-349 silent-
    // drops, and the user never sees the post-transfer summary on screen.
    if (mode !== 'send') {
        if (value && value.length > 0 && termRef) {
            try {
                termRef.feed(new Uint8Array(value));
            } catch (e) {
                console.error('[slide.js] dispatchSendMode post-session forward threw:', e);
            }
        }
        return;
    }

    // v1.1 polish 260513-grs Task 3 (revised) — JS-side classifier for
    // send-mode inbound bytes.
    //
    // PRIOR ATTEMPT (STATE_FIN_PENDING byte-walk) only handled the FIN echo
    // + tail boundary, but slide.asm prints `msg_done` ("Transfer complete!")
    // via BDOS C_WRITESTR between the EOF ACK and the FIN echo — those bytes
    // arrive while the SM is in FinPending and hit the Rust framer's Idle
    // arm, which silent-discards everything that isn't a recognised control
    // byte (framer.rs Idle `_ => EVT_NONE`). Same applies to msg_done_session
    // ("Session complete.") that arrives in a separate chunk WHILE SM is still
    // FinPending (FIN not yet echoed back).
    //
    // Real fix: in SEND MODE, the Z80 is the receiver — it NEVER sends
    // SLIDE frames (no SOF). Its inbound vocabulary is exactly:
    //   - CTRL_RDY (0x11)  — handshake response
    //   - CTRL_ACK + seq   — frame ack (2 bytes)
    //   - CTRL_NAK + seq   — retransmit request (2 bytes)
    //   - CTRL_FIN (0x04)  — session end echo
    //   - CTRL_CAN (0x18)  — peer-initiated cancel
    // Everything else IS BY DEFINITION terminal console output from BDOS
    // C_WRITESTR (msg_done, msg_done_session, msg_cancelled, error
    // messages, etc.). Classify in JS, feed only protocol bytes to the
    // Rust SM, accumulate terminal bytes for term.feed at end-of-chunk.
    //
    // The control-byte values (0x04 / 0x06 / 0x11 / 0x15 / 0x18) are all
    // non-printable ASCII control characters — none appear in normal
    // BDOS WRITESTR output, so the heuristic is unambiguous.
    const CTRL_RDY = 0x11;
    const CTRL_ACK = 0x06;
    const CTRL_NAK = 0x15;
    const CTRL_FIN = 0x04;
    const CTRL_CAN = 0x18;
    const SOF     = 0x01;  // defensive — Z80 in recv-session shouldn't emit
    const terminalBytes = [];
    let i = 0;
    if (sendCtrlSeqPending && value.length > 0) {
        // The previous chunk ended on a lone ACK/NAK; the framer is parked in
        // AfterAckOrNak and THIS chunk's first byte is the seq. Feed it
        // unconditionally — it is protocol, never console text, whatever its
        // value (the old classifier dropped e.g. seq 0x14 here — UAT-E9-03).
        slide.feed_byte(value[0]);
        sendCtrlSeqPending = false;
        i = 1;
    }
    while (i < value.length) {
        const b = value[i];
        if (b === CTRL_ACK || b === CTRL_NAK) {
            // 2-byte sequence: control + seq. Feed both atomically.
            slide.feed_byte(b);
            if (i + 1 < value.length) {
                slide.feed_byte(value[i + 1]);
                i += 2;
            } else {
                // Lone ACK/NAK at chunk end — the seq byte spans chunks.
                // framer.AfterAckOrNak holds across the boundary; flag the
                // obligation so the next chunk's first byte is fed as the
                // seq instead of being classified (UAT-E9-03).
                sendCtrlSeqPending = true;
                i += 1;
            }
        } else if (b === CTRL_RDY || b === CTRL_FIN || b === CTRL_CAN || b === SOF) {
            slide.feed_byte(b);
            i += 1;
        } else {
            // Non-control byte during a SLIDE session = terminal console
            // output from the Z80 (BDOS C_WRITESTR). Route to term.feed.
            terminalBytes.push(b);
            i += 1;
        }
    }
    // E11 S11.4 — settle the cancel Step 3 wait on the transition this chunk
    // produced (the CAN echo is fed in the walk above). Same reason as the
    // recv side: in CancelPending the SM emits no events (ADR-003 §4), so the
    // event drain below would never see it. Resolving a promise is safe inside
    // the sendDispatchTail chain — it settles on a microtask, and nothing new
    // is awaited here.
    // pendingSendStateWaiter is read first so the ordinary send path pays no
    // extra JS→wasm state() crossing per inbound chunk.
    if (pendingSendStateWaiter && slide) notifySendStateTransition(slide.state());
    await drainEventsAndOutboundAwaitable();
    pumpNextDataChunkIfReady();
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();
    // Forward any terminal-classified bytes captured during the byte-walk
    // to the VT52 parser. termRef may be null in early-boot edge cases; guard.
    if (terminalBytes.length > 0 && termRef) {
        try {
            termRef.feed(new Uint8Array(terminalBytes));
        } catch (e) {
            console.error('[slide.js] terminal byte forward (send) threw:', e);
        }
    }
}

// Inter-file delay before pushing the next file's header onto the wire.
// After a file completes, slide.com on the Z80 prints `\r\nTransfer
// complete!\r\n` via per-byte BDOS calls and then closes the file via
// BDOS F_CLOSE — neither operation reads the UART. The MicroBeast UART's
// hardware FIFO (typically 16 bytes) is smaller than a header frame
// (~13-25 bytes), so any header pushed during this window risks losing
// the SOF byte to FIFO overflow, which leaves the Z80 polling .file_loop
// forever and Beastty stuck in HeaderPhase. Mirrors the defensive
// `thread::sleep(500ms)` slide-rs uses post-header-ACK in send.rs.
const INTER_FILE_HEADER_DELAY_MS = 500;

function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/// Drain SLIDE events + outbound bytes; the awaitable variant uses
/// writeSlideFrameAwaitable so backpressure is gated per PITFALLS §4.
/// Handles Phase 9 EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE /
/// EVT_RETRANSMIT_NEEDED in addition to the Phase 8 receiver-mode events
/// (drained as no-ops here — receiver attaches handlers via Phase 10).
async function drainEventsAndOutboundAwaitable() {
    if (!slide) return;
    let sawFileCompleteWithMoreFiles = false;
    while (true) {
        const evt = slide.take_event_packed();
        if (evt === EVT_NONE) break;
        const kind = evt & 0xFFFF_0000;
        const aux  = evt & 0xFFFF;
        if ((kind === EVT_ACK || kind === EVT_RETRANSMIT_NEEDED) && currentSendCtx) {
            // A completed ACK (or a NAK's rewind) releases the window debt:
            // the pump may push the next window this dispatch cycle. Header
            // and EOF ACKs also land here — clearing an already-clear flag
            // is harmless.
            currentSendCtx.windowAckOwed = false;
        }
        if (kind === EVT_FILE_COMPLETE) {
            // SM has just emitted EVT_FILE_COMPLETE | file_idx and pushed
            // the next file's header onto outbound (or transitioned to
            // FinPending if this was the last file). Advance the JS-side
            // cursor so pumpNextDataChunkIfReady reads from the right file.
            if (currentSendCtx) {
                currentSendCtx.currentFileIdx = aux + 1;
                currentSendCtx.sentBytesInFile = 0;
                if (currentSendCtx.currentFileIdx < currentSendCtx.fileBytes.length) {
                    sawFileCompleteWithMoreFiles = true;
                }
            }
        } else if (kind === EVT_SESSION_COMPLETE) {
            // SM is in Done; final FIN exchange completed. Don't exit here
            // — let maybeExitSendMode handle it AFTER the outbound drain
            // below (so any final ACK byte still on outbound_buf reaches
            // the wire before we flip the owner back to terminal).
        } else if (kind === EVT_RETRANSMIT_NEEDED) {
            // Phase 9 WR-01 — window-rewind retransmit (slide-rs/send.rs:194-208
            // mirror). On NAK(seq=aux), the Rust SM rewinds `current_seq` to
            // `aux`. The JS pump must re-feed every frame from `aux` forward
            // through end-of-file so the receiver sees the full window again
            // (slide-rs's contract: NAK rejects the window starting at `aux`;
            // the receiver silently drops post-NAK frames until it observes
            // the retransmit at the requested seq).
            //
            // Earlier behaviour (re-feed only the single seq's chunk) papered
            // over the divergence because the native test bot's
            // `awaiting_retransmit` latch silently dropped post-NAK frames.
            // Real slide.com hardware will see seq drift if we do not rewind
            // the JS-side cursor; the next pump cycle resends from
            // `sentBytesInFile` forward.
            //
            // Note: seq is u8 (slide-rs convention; wraps at 256). For files
            // > 255 frames (~256 KB) this simple mapping needs SM-driven
            // wrap-epoch tracking — see IN-05 (out of scope for Phase 9;
            // hardware UAT in Phase 12 will surface real-world scope).
            const ctx = currentSendCtx;
            if (ctx) {
                const file = ctx.fileBytes[ctx.currentFileIdx];
                if (file) {
                    const seq = aux;
                    const chunkStart = (seq - 1) * FRAME_SIZE;
                    if (chunkStart < file.length) {
                        // Rewind JS-side cursor to the NAKed seq's chunk start.
                        // pumpNextDataChunkIfReady (called later in the same
                        // dispatchSendMode cycle) reads `sentBytesInFile` and
                        // resumes sending forward from here, walking through
                        // every frame in the rewound window naturally.
                        // Do NOT call feed_send_chunk directly — let the
                        // natural pump cycle handle each frame so per-frame
                        // seq accounting stays consistent with the SM's
                        // `current_seq` (which the Rust SM already reset to
                        // `aux` in the EVT_NAK handler at state.rs:392-394).
                        ctx.sentBytesInFile = chunkStart;
                    }
                }
            }
        }
        // EVT_ACK / EVT_NAK / EVT_RDY / EVT_FIN / EVT_CAN — no JS action;
        // SM internalises the transitions and produces outbound bytes that
        // drainSlideOutboundAwaitable below pushes to the wire.
    }
    // Inter-file breathing room. The next file's header is currently sitting
    // in slide.outbound_buf; if we drain it immediately, the Z80 hasn't yet
    // returned from msg_done print + close_file and its UART RX FIFO will
    // overflow on the header bytes. Holding the bytes JS-side for 500 ms
    // mirrors slide-rs/send.rs's defensive post-header-ACK sleep.
    if (sawFileCompleteWithMoreFiles) {
        await sleepMs(INTER_FILE_HEADER_DELAY_MS);
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
///
/// Phase 9 WR-04 — the file index is read from the Rust SM via
/// `slide.send_current_file_idx()`, which is the single source of truth.
/// `currentSendCtx.currentFileIdx` is still maintained by the EVT_FILE_COMPLETE
/// handler for the introspection accessor (`__getStateForTests`), but the
/// pump no longer depends on JS-side cursor accuracy. This closes the
/// fragile transient where a multi-file boundary's two ACKs landed in
/// distinct chunks and the JS-side cursor could disagree with the SM's
/// `send_ctx.current_file_idx`.
function pumpNextDataChunkIfReady() {
    if (!slide || !currentSendCtx) return;
    const st = slide.state();
    // STATE_DATA_PHASE = 3 (per slide_boundary_shape.rs:slide_state_enum_repr_u32_pinned).
    if (st !== STATE_DATA_PHASE) return;
    const ctx = currentSendCtx;
    // WR-04 — authoritative cursor from Rust SM.
    const fileIdx = slide.send_current_file_idx();
    const file = ctx.fileBytes[fileIdx];
    if (!file) return;
    // UAT-E9-03 — pump a full WINDOW per dispatch, not one frame. slide.asm's
    // receiver ACKs once per WIN_SIZE frames (plus once for the EOF), so a
    // one-frame pump left the Z80 waiting for the rest of the window until
    // its per-byte retry timeout NAKed it along — every send crawled on that
    // retry crutch (~4-5× slow) and flooded the wire with NAK/ACK control
    // pairs, the desync surface behind the cancelled-by-peer failure (a
    // desynced classifier reading a seq byte of 0x18 — any file ≥ 24 KB has
    // frame seq 24 — as CTRL_CAN echoes a cancel straight to the Z80).
    // One window per ACK mirrors slide-py's reference sender, and every Z80
    // disk flush stays covered by its own ACK-wait: FLUSH_SIZE == WIN_SIZE ×
    // FRAME_SIZE, so the flush always lands just before the window ACK.
    // Stop at window-boundary seqs (seq ≡ 0 mod WIN_SIZE) so a NAK-rewind
    // resend re-aligns with the Z80's ACK cadence instead of drifting.
    // Outbound stays ≤ OUTBOUND_VIEW_CAP: 4 frames + EOF marker = 4126.
    //
    // windowAckOwed latches after each window (and after the EOF frame) and
    // is cleared only when the drain loop sees the ACK / retransmit event.
    // Without it, ANY dispatch cycle — a split ACK's first half, console
    // text, line noise — pumped the next window while the previous one was
    // still un-ACKed, running the sender ahead of the Z80's cadence and
    // uncovering its disk-flush deaf window.
    if (ctx.windowAckOwed) return;
    while (ctx.sentBytesInFile < file.length) {
        const chunkStart = ctx.sentBytesInFile;
        const chunkEnd = Math.min(chunkStart + FRAME_SIZE, file.length);
        const payload = file.subarray(chunkStart, chunkEnd);
        const isEof = chunkEnd === file.length;
        slide.feed_send_chunk(payload, isEof);
        ctx.sentBytesInFile = chunkEnd;
        const seqJustSent = Math.floor(chunkStart / FRAME_SIZE) + 1;
        if (isEof || seqJustSent % WIN_SIZE === 0) {
            ctx.windowAckOwed = true;
            break;
        }
    }
}

/// Mirror of maybeExitRecvMode for sender mode. Exits to terminal mode on
/// Done / Error / CancelPending so the next keystroke reaches the wire
/// without owner='slide' silent-dropping it.
function maybeExitSendMode() {
    if (!slide) return;
    // E11 S11.4 follow-up — while cancelSlideSend is running, IT owns the exit
    // (Step 5 → forceExitSendMode, with the 2 s hatch behind it). Without this
    // guard the CancelPending arm below fires on the first inbound chunk that
    // lands after slide.cancel() — an in-flight ACK, or slide.asm's
    // `msg_cancelled` text — flipping mode to 'terminal'. The peer's CTRL_CAN
    // echo then arrives with mode already 'terminal', so dispatchInbound routes
    // it to dispatchTerminalMode and the SM never sees it: the Step 3 wait
    // times out, lastCancelEchoArrived reads false and force_idle runs on a
    // cancel the Z80 answered perfectly. It also stopped a cancelled transfer
    // reporting "Sent N files" via exitSendMode's summary. The recv twin
    // (maybeExitRecvMode) never had the CancelPending arm, which is why only
    // the send side lost its echo.
    if (sendCancelInFlight) return;
    const st = slide.state();
    if (st === STATE_DONE || st === STATE_ERROR || st === STATE_CANCEL_PEND) {
        exitSendMode();
    }
}
