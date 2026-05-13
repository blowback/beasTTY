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
import { onRecvEvent, setSlideRef as setSlideRecvRef, isSlideActive, slidePumpOnPortLost as slideRecvPumpOnPortLost } from './slide-recv.js';
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
import { isAutoSendSafe, getPrefs } from '../state/prefs.js';
// Phase 12 SLIDE-38 — re-export the pure helper so main.js can attach it to
// window.__slide.__isAutoSendSafeForTests alongside the existing __slide
// introspection surface (Phase 8/9/10 pattern: every test-observable knob
// lives under window.__slide). The Playwright safety spec drives the helper
// directly via window.__slide.__isAutoSendSafeForTests(input).
export { isAutoSendSafe as __isAutoSendSafeForTests };

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
// dispatchInbound flips between modes mid-stream). Pattern 9 verbatim from
// 10-RESEARCH.md — on full match, slide.force_idle + exitRecvMode + enterRecvMode
// (T-10-03 mitigation: idempotent reset per CONTEXT C-05).
let recvWakeIdx = 0;
const recvScratch = new Uint8Array(6);

// Injected deps (wireSlideDispatcher sets these).
let termRef = null;
let txSinkRef = null;     // { setWireOwner, getWireOwner, writeSlideFrame }
let SlideCtor = null;     // the wasm-imported Slide class
let wasmRef = null;       // for memory.buffer access in drainSlideOutbound
// Phase 11 Plan 11-03 — additional injected deps for D-09 / D-12 / chip lifecycle.
let prefsRef = null;      // { slideAutoSendCommand, slideShowSummary, slideCompatibilityMode }
let pastePumpRef = null;  // { cancelPaste } — D-12 paste-pump gate at SLIDE wakeup completion
let slideChipRef = null;  // { enterActive, enterAwaitingWakeup, enterFirstUseConfirm, ... }
// Phase 12 SLIDE-38 — savePrefs reference for first-use-confirm gate. Used to
// (a) write slideAutoSendCommandConfirmed = current value when the user clicks
// [Confirm], and (b) reset slideAutoSendCommand + slideAutoSendCommandConfirmed
// to AUTO_SEND_DEFAULT when the user clicks [Reset to default]. Optional —
// older boot paths / test harnesses without savePrefs threaded through still
// observe the same fail-open behaviour as Phase 11.
let savePrefsRef = null;
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
//      (AUTO_SEND_DEFAULT, 'auto' compatMode) cover the null path.
function livePrefs() {
    return getPrefs() || prefsRef || null;
}

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

// Phase 12 WR-02 — sentinel guarding the async first-use-confirm window.
// When `shouldSurfaceFirstUseConfirm(cmd)` returns true, enterSendMode
// dispatches enterSendModeAfterFirstUseConfirm asynchronously and returns
// without setting pendingSendSession. During the chip-display window the
// existing `pendingSendSession !== null` first-click-wins guard does not
// fire, so a second enterSendMode call could spawn a second coroutine
// awaiting the same chip Promise. The chip's enterFirstUseConfirm clears
// prior callbacks on re-entry, leaving the first coroutine's Promise
// unresolved (T-12-07-style leak). This sentinel is set true before the
// async dispatch and cleared on every exit path of
// enterSendModeAfterFirstUseConfirm and in __resetForTests.
let firstUseConfirmPending = false;

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

// Phase 11 Plan 11-03 D-09 — auto-send command sourced from prefs at call
// time (replaces the Phase 9 D-14 hardcoded constant). The empty-string-
// disables semantic per SLIDE-13 is preserved verbatim — readAutoSendCommandBytes
// returns a zero-length Uint8Array when prefsRef.slideAutoSendCommand is the
// explicit empty string, and the call site in enterSendMode skips pushTxBytes
// when length === 0.
//
// When prefsRef is null (boot order: tests / older harnesses that did not
// extend wireSlideDispatcher with the Plan 11-03 prefs opt), fall back to
// the Phase 9 D-14 default `B:SLIDE R\r` so existing Playwright sender tests
// keep observing the auto-type bytes on the wire. Production main.js boot
// passes prefs (Plan 11-03 Task 3) so this fallback only matters in tests.
//
// Bytes are encoded at call time via TextEncoder so a user-edited command
// string (e.g. "A:RUN PROG.COM\r" via the Plan 11-03 Settings sub-block)
// flows through unchanged. Phase 12 SLIDE-38 will add safety validation
// (alphanumeric + `:` + `\r` only); Phase 11 stores whatever the user types.
const AUTO_SEND_DEFAULT = 'B:SLIDE R\r';
function readAutoSendCommandBytes() {
    // Live read so post-Settings-change values reach the wire without a reload
    // (Phase 12 UAT Gap C — see livePrefs() block above).
    const p = livePrefs();
    let cmd;
    if (p) {
        // prefs available — honour the user's value verbatim (including the
        // explicit empty string which disables auto-type).
        cmd = p.slideAutoSendCommand;
        if (cmd === undefined || cmd === null) cmd = AUTO_SEND_DEFAULT;
    } else {
        // No prefs available — use Phase 9 default for backwards compatibility.
        cmd = AUTO_SEND_DEFAULT;
    }
    if (cmd.length === 0) return new Uint8Array(0);
    // Phase 12 SLIDE-38 use-time hard gate (T-12-03). Validate before placing
    // bytes on the wire. Failure path returns zero-length Uint8Array (matches
    // SLIDE-13 disabled-auto-type semantic — caller's `length === 0` skip
    // covers it without a separate code path), fires chip enterError if the
    // chip is wired, and surfaces the validation hint + data-invalid attribute
    // on the Settings DOM (defense-in-depth UX feedback).
    if (!isAutoSendSafe(cmd)) {
        console.error('[slide] Auto-send command failed safety check; auto-type skipped:',
                      JSON.stringify(cmd));
        if (slideChipRef && typeof slideChipRef.enterError === 'function') {
            try { slideChipRef.enterError('auto-send command unsafe — fix in Settings'); } catch {}
        }
        try {
            const inputEl = document.getElementById('slide-auto-send-input');
            if (inputEl) {
                inputEl.setAttribute('data-invalid', 'true');
                inputEl.setAttribute('aria-invalid', 'true');
            }
            const hintEl = document.getElementById('slide-auto-send-validation-hint');
            if (hintEl) hintEl.hidden = false;
        } catch { /* ignore — DOM may not exist in tests */ }
        return new Uint8Array(0);
    }
    const out = new TextEncoder().encode(cmd);
    return out;
}

// Phase 12 SLIDE-38 — first-use-confirm gate helpers. shouldSurfaceFirstUseConfirm
// is the predicate (cmd is non-default AND user has not yet confirmed this exact
// value); surfaceFirstUseConfirm wraps the chip API in a Promise so enterSendMode
// can `await` the user's [Confirm] / [Reset to default] click.
//
// Pitfall 6 (12-RESEARCH.md): the first-use chip surfaces ONLY at session start
// (entry to enterSendMode), never during a Settings input change. The chip
// lifecycle module (slide-chip.js) sits in 'first-use-confirm' until either
// callback resolves the Promise — once resolved, slide.js proceeds with
// enterAwaitingWakeup OR aborts the send.
function shouldSurfaceFirstUseConfirm(cmd) {
    if (cmd === AUTO_SEND_DEFAULT) return false;
    // Live read — Settings change handler resets slideAutoSendCommandConfirmed
    // to '' on every edit; a stale prefsRef snapshot would still hold the prior
    // confirmed value and skip the chip (Phase 12 UAT Gap B).
    const p = livePrefs();
    if (!p) return false;
    if (p.slideAutoSendCommandConfirmed === cmd) return false;
    return true;
}

function surfaceFirstUseConfirm(cmd) {
    return new Promise((resolve) => {
        // Fail-open if chip isn't wired (test harnesses without slideChip opt
        // get Phase 9/10/11 behaviour: command flows directly to wire after
        // safety gate). This preserves Phase 9/10/11 sender Playwright tests
        // that drive enterSendMode without a chip and lets unit-style
        // safety-only spec runs work without the chip plumbing.
        if (!slideChipRef || typeof slideChipRef.enterFirstUseConfirm !== 'function') {
            resolve(true);
            return;
        }
        slideChipRef.enterFirstUseConfirm({
            value: cmd,
            onConfirm: () => { resolve(true); },
            onReset:   () => { resolve(false); },
        });
    });
}

// SLIDE wire frame size — slide-rs/protocol.rs FRAME_SIZE (1024 bytes
// per data frame). Used to chunk fileBytes into per-frame payloads.
const FRAME_SIZE = 1024;

// --- Public API -----------------------------------------------------------

export function wireSlideDispatcher(opts) {
    const { term, txSink, slideCtor, wasm, prefs, pastePump, slideChip, savePrefs, wrapperEl } = opts;
    termRef = term;
    txSinkRef = txSink;
    SlideCtor = slideCtor;
    wasmRef = wasm;
    // Phase 11 Plan 11-03 — additional refs for D-09 (prefs.slideAutoSendCommand),
    // D-12 (pastePump.cancelPaste at SLIDE wakeup completion), chip lifecycle
    // hooks (enterActive / enterAwaitingWakeup / enterSummary). All optional —
    // null callers (older boot paths, test harnesses) get the same Phase 9/10
    // behaviour through the optional-chained call sites below.
    prefsRef = prefs || null;
    pastePumpRef = pastePump || null;
    slideChipRef = slideChip || null;
    // Phase 12 SLIDE-38 — savePrefs ref for first-use-confirm gate (writes
    // slideAutoSendCommandConfirmed on [Confirm], resets to default on
    // [Reset to default]). Optional — fail-open if not threaded through.
    savePrefsRef = (typeof savePrefs === 'function') ? savePrefs : null;
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
    // Phase 12 WR-02 — clear the first-use-confirm in-flight sentinel so
    // a fresh test run is not blocked by a stranded flag from a prior run.
    firstUseConfirmPending = false;
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
            file_idx: slide.recv_current_file_idx(),
            total_files: 0,                                    // unknown until FIN — CONTEXT note
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
                // gated separately by the isSlideActive() early-return in
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

    let matchEnd = -1;
    for (let i = 0; i < value.length; i++) {
        const b = value[i];
        if (b === WAKEUP[recvWakeIdx]) {
            if (recvWakeIdx < 6) recvScratch[recvWakeIdx] = b;
            recvWakeIdx++;
            if (recvWakeIdx === 7) {
                matchEnd = i;
                recvWakeIdx = 0;
                break;
            }
        } else {
            if (recvWakeIdx > 0) {
                if (b === WAKEUP[0]) {
                    recvScratch[0] = b;
                    recvWakeIdx = 1;
                } else {
                    recvWakeIdx = 0;
                }
            }
        }
    }
    if (matchEnd >= 0) {
        // Bytes BEFORE the wakeup go to the existing SM (last-ditch ACK).
        // matchEnd points at the last byte of the 7-byte signature; the
        // signature occupies indices [matchEnd-6 .. matchEnd] inclusive.
        // Phase 10 review WR-01 — when the 7-byte signature spans chunks
        // (recvWakeIdx > 0 going INTO this chunk), matchEnd can be 0..5,
        // making (matchEnd - 6) negative. Uint8Array.subarray(0, -N) interprets
        // the negative end as `length + end` and returns the chunk's leading
        // bytes — which are the trailing bytes of the wakeup signature, NOT
        // benign pre-wakeup data. Clamp to 0 so signature-spanning chunks
        // produce an empty `before` slice (the leading bytes are part of the
        // matched signature and are correctly discarded).
        const beforeEnd = Math.max(0, matchEnd - 6);
        const before = value.subarray(0, beforeEnd);
        if (before.length) {
            feedSlide(before);
            drainEventsAndOutbound();
        }
        console.warn('[slide.js] mid-session ESC^SLIDE detected — Z80 reset; re-entering recv mode');
        if (slide && typeof slide.force_idle === 'function') slide.force_idle();
        exitRecvMode();
        enterRecvMode();
        // Bytes AFTER the wakeup feed to the new SM.
        const tail = value.subarray(matchEnd + 1);
        if (tail.length) {
            feedSlide(tail);
            drainEventsAndOutbound();
            maybeExitRecvMode();
        }
        return;
    }
    // No re-entry — normal recv path.
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
        const stBefore = slide.state();
        if (stBefore === STATE_DONE || stBefore === STATE_ERROR) {
            // Already Done before this byte — bytes from here on are tail.
            recvDoneAt = i - 1;
            break;
        }
        slide.feed_byte(value[i]);
        const stAfter = slide.state();
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
    // Per-session new Slide() (Claude's Discretion default — no Slide::reset()
    // singleton optimization; ~1 KB allocation per session is irrelevant at
    // SLIDE's session cadence).
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
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
    // Phase 10 review WR-02 — clear slide-recv's slideRef so it cannot
    // dereference the stale Slide after the next enterRecvMode's slide.free()
    // frees its wasm memory (RESEARCH Pitfall 4 — wasm-bindgen panics across
    // FFI are uncatchable; null the ref instead). The recv module's
    // isSlideActive / cancelSlideRecv are defensive against a null ref.
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

    // Phase 12 WR-02 — first-use-confirm-in-flight guard. When the async
    // chip path is awaiting the user's [Confirm]/[Reset to default] click
    // pendingSendSession is still null (it is only set in
    // enterSendModeProceed after confirmation). Without this sentinel a
    // second enterSendMode call would slip past the pendingSendSession
    // check, spawn a second enterSendModeAfterFirstUseConfirm coroutine,
    // re-enter the chip (clearing the first coroutine's onConfirm/onReset
    // callbacks) and leak the first coroutine's surfaceFirstUseConfirm
    // Promise unresolved.
    if (firstUseConfirmPending) {
        console.warn('[slide.js] enterSendMode: first-use confirm already in progress; ignoring duplicate enterSendMode');
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

    // Phase 12 SLIDE-38 — first-use confirmation gate.
    // Pitfall 6 (12-RESEARCH.md): the gate runs ONLY at session START (here,
    // before any auto-type bytes hit the wire), never during a Settings
    // input change event. The cmd is read raw (pre-encoding) so the
    // exact-string equality check against AUTO_SEND_DEFAULT and
    // slideAutoSendCommandConfirmed works correctly. The use-time safety
    // gate inside readAutoSendCommandBytes already rejects unsafe values;
    // this gate ONLY runs for safe but non-default values that have not
    // been confirmed yet. autoSendBytes.length === 0 (SLIDE-13 disabled OR
    // safety-rejected) skips the gate entirely.
    // Live read — Settings change handler updates slideAutoSendCommand on
    // every edit; stale prefsRef snapshot caused Gap C/B (post-Settings-change
    // value never reaching this gate without a reload).
    const enterSendModePrefs = livePrefs();
    const cmd = (enterSendModePrefs && enterSendModePrefs.slideAutoSendCommand !== undefined && enterSendModePrefs.slideAutoSendCommand !== null)
        ? enterSendModePrefs.slideAutoSendCommand
        : AUTO_SEND_DEFAULT;
    if (cmd.length > 0 && shouldSurfaceFirstUseConfirm(cmd)) {
        // Re-validate at gate time: if the value is unsafe, we never want to
        // surface a confirmation chip for it (the use-time hard gate inside
        // readAutoSendCommandBytes will already reject + show the validation
        // hint). Only safe-but-non-default values get the confirmation chip.
        if (isAutoSendSafe(cmd)) {
            // Async path — defer to the first-use confirmation chip and let
            // the user's [Confirm] / [Reset to default] click drive the rest.
            // pendingSendSession is NOT set until after the user confirms,
            // so a second enterSendMode invocation during the chip-displayed
            // window cannot rely on the `pendingSendSession !== null`
            // first-click-wins guard. Phase 12 WR-02 — set
            // firstUseConfirmPending = true BEFORE the async dispatch so
            // the explicit guard at the top of enterSendMode rejects any
            // duplicate call until enterSendModeAfterFirstUseConfirm
            // clears it on every exit path.
            firstUseConfirmPending = true;
            void enterSendModeAfterFirstUseConfirm({ files, cmd });
            return;
        }
    }

    enterSendModeProceed({ files, cmd });
}

// Phase 12 SLIDE-38 — async branch entered when the first-use chip needs
// to surface for a non-default + not-yet-confirmed auto-send command.
// Awaits the user's click; on [Confirm] proceeds with the normal Phase 9/11
// send flow (writes slideAutoSendCommandConfirmed first); on [Reset to
// default] resets prefs and aborts the send (user must click Send file
// again). On the 30 s defensive timeout the awaiting Promise is left
// unresolved and this function never returns — flagged as a Phase 12.1
// cleanup in 12-03-SUMMARY.md (T-12-07).
async function enterSendModeAfterFirstUseConfirm({ files, cmd }) {
    let confirmed;
    try {
        confirmed = await surfaceFirstUseConfirm(cmd);
    } catch {
        confirmed = false;
    }
    // Phase 12 WR-02 — clear the in-flight sentinel BEFORE any further
    // dispatch so subsequent enterSendMode invocations are not refused
    // after the chip has resolved (whether the user confirmed, reset to
    // default, or surfaceFirstUseConfirm threw).
    firstUseConfirmPending = false;
    if (!confirmed) {
        // User clicked [Reset to default] — restore prefs and abort. User
        // must click ↑ Send file again to proceed with the default value.
        try {
            if (typeof savePrefsRef === 'function') {
                savePrefsRef({
                    slideAutoSendCommand: AUTO_SEND_DEFAULT,
                    slideAutoSendCommandConfirmed: AUTO_SEND_DEFAULT,
                });
            }
        } catch {}
        return;
    }
    // User clicked [Confirm]. Record the confirmation against the exact
    // string so the chip won't surface again for this value (re-arms only
    // when the user changes the auto-send command in Settings).
    try {
        if (typeof savePrefsRef === 'function') {
            savePrefsRef({ slideAutoSendCommandConfirmed: cmd });
        }
    } catch {}
    enterSendModeProceed({ files, cmd });
}

// Phase 12 SLIDE-38 — extracted from enterSendMode so both the synchronous
// happy path (default value or already-confirmed non-default) AND the
// post-first-use-confirm async path share the same auto-type + chip +
// pendingSendSession sequence. cmd is passed through (raw string from prefs)
// — readAutoSendCommandBytes will re-read prefs internally, applying the
// use-time safety gate.
function enterSendModeProceed({ files /* cmd */ }) {
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

    pendingSendSession = { metadata, fileBytes };

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

// Phase 12 UAT Gap D fix (.planning/debug/slide-active-cancel-broken.md).
// cancelSlideSend mirrors slide-recv.js cancelSlideRecv but for send mode.
// Wired into the chip's [Cancel] button via main.js's mode-dispatching
// onCancel callback. Without this, force-start (and any wakeup-completion)
// active-state cancellation was a dead button — chip stayed visible until
// page reload because main.js routed onCancel only to cancelSlideRecv,
// whose !isSlideActive() guard short-circuits in send mode (slide-recv.js
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

function sendCancelDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSendState(targetState, timeoutMs) {
    return new Promise((resolve) => {
        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const tick = () => {
            if (slide && slide.state() === targetState) return resolve(true);
            if (now() - start >= timeoutMs) return resolve(false);
            setTimeout(tick, 10);
        };
        tick();
    });
}

function forceExitSendMode() {
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

    // v1.1 polish 260513-grs Task 3 — post-FIN tail forwarding (send side).
    //
    // When the Z80's CTRL_FIN echo lands in the same wire chunk as trailing
    // console text (e.g. slide.com's `Session complete.` from msg_done_session),
    // the SLIDE SM transitions to Done on the FIN byte and the Rust
    // state.rs:347-349 early-return SILENTLY DROPS every subsequent byte.
    // exitSendMode flips mode back to 'terminal' but those post-FIN bytes are
    // already lost — the user sees the SLIDE chip vanish without the Z80's
    // post-transfer summary ever reaching the terminal.
    //
    // Approach: when the SM is in STATE_FIN_PENDING entering this chunk, feed
    // byte-by-byte and capture the index at which the SM transitions to
    // STATE_DONE / STATE_ERROR. The bytes AFTER that index are the post-FIN
    // tail. After the existing drain/pump/drain/exit cycle has fired, if mode
    // has flipped back to 'terminal' and we have a captured tail, forward
    // it to termRef.feed. For any other entry state, keep the existing
    // single-feed_chunk fast path (the tail-capture overhead is irrelevant
    // for those — Done isn't imminent).
    let postFinTail = null;
    const entryState = slide ? slide.state() : -1;
    if (entryState === STATE_FIN_PENDING) {
        let doneAt = -1;
        for (let i = 0; i < value.length; i++) {
            slide.feed_byte(value[i]);
            const st = slide.state();
            if (st === STATE_DONE || st === STATE_ERROR) {
                doneAt = i;
                break;
            }
        }
        if (doneAt >= 0 && doneAt < value.length - 1) {
            postFinTail = value.subarray(doneAt + 1);
        }
        // If the chunk ended without a Done transition (FIN echo spans chunks),
        // no tail to capture — existing flow handles the next chunk normally.
    } else {
        feedSlide(value);
    }
    await drainEventsAndOutboundAwaitable();
    pumpNextDataChunkIfReady();
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();
    // After maybeExitSendMode, if we captured a post-FIN tail and the mode
    // has indeed flipped back to terminal, forward the trailing bytes to the
    // VT52 parser. Defensive mode check: if cancellation or error landed us
    // in a different state, drop the tail (safer than feeding to a half-state
    // terminal). termRef may be null in early-boot edge cases; guard.
    if (postFinTail && mode === 'terminal' && postFinTail.length > 0 && termRef) {
        try {
            termRef.feed(new Uint8Array(postFinTail));
        } catch (e) {
            console.error('[slide.js] post-FIN tail forward (send) threw:', e);
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
    if (ctx.sentBytesInFile >= file.length) return;
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
