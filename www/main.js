// BestialiTTY — boot driver (Phase 3 renderer + Phase 4 Plan 02 keyboard).
//
// Preserves the Phase 2 wasm boundary + harness helpers (parseHexEscapes,
// buildStressPayload, Feed button, 64 KB Stress button). Delegates rendering
// to www/renderer/canvas.js (rAF + HiDPI + glyph atlas). Wires DOM chrome
// (theme toggle, phosphor radio-group, keyboard shortcuts, focus indicator)
// via www/renderer/chrome.js. Phase 4 Plan 02 adds wireKeyboard() from
// www/input/keyboard.js — attaches AFTER wireChrome so chrome.js's keydown
// listener retains priority on Ctrl+Alt+T / Ctrl+{+,-,0} chords.
//
// Source:
//   - 03-PATTERNS.md §"www/main.js" retrofit specification.
//   - 03-CONTEXT.md D-15 (Debug details retains Phase 2 SC-4 path).
//   - 04-PATTERNS.md §"www/main.js (modified)" (wireKeyboard call site).

// Phase 5 D-32 / D-33 — polite-fail gate. MUST be the first executable block
// so wasm + fonts + canvas never load on non-Chromium browsers.
import { renderPoliteFail } from './transport/serial.js';
if (typeof navigator.serial === 'undefined') {
    renderPoliteFail();
    throw new Error('__polite-fail__');   // abort module execution; wasm never initialises
}

// Phase 6 Plan 06 (Wave 5) — versioned prefs blob (D-32). loadPrefs() runs
// SECOND in the boot sequence (after polite-fail; before wasm init), so
// chrome / keyboard / serial all see the loaded prefs at boot rather than
// defaults. Exposed on window.__prefs for Playwright session/prefs.spec.js.
import {
    loadPrefs,
    savePrefs,
    resetPrefs,
    subscribe as prefsSubscribe,
    getPrefs,
} from './state/prefs.js';
const prefs = loadPrefs();
// Phase 11 Plan 11-05 — also expose the live `prefs` object held by main.js
// (the same reference passed into wireSlideDispatcher / wireSlideChip /
// wireSlideRecv). savePrefs() reassigns `cached` inside prefs.js to a new
// object, so window.__prefs.getPrefs() returns the LATEST cached value but
// the boot-time snapshot held by downstream wirings DOES NOT update unless
// the field is written through Object.assign on this exposed reference.
// Tests that need to drive a runtime prefs change (e.g. Compatibility mode
// 3-way branching in slide-compatibility.spec.js) mutate via this ref so
// the dispatcher picks up the change without a page reload.
window.__prefs = { savePrefs, resetPrefs, getPrefs, subscribe: prefsSubscribe, live: prefs };

import init, { Terminal, Slide } from './pkg/bestialitty_core.js';
import {
    bootRenderer,
    requestFrame,
    setTheme,
    setPhosphor,
    setFont,                   // bitmap-font swap (CRT theme); applyPrefs path
    zoomStep,
    resetZoom,
    setZoom,                   // Phase 6 Plan 06 — absolute zoom setter for applyPrefs
    setFocus,
    getActiveTheme,
    getActivePhosphor,
    getActiveZoom,
    triggerBellFlash,          // Plan 03 owns bell sampling; canvas.js provides the CSS helper
    markAllRowsDirty,          // Phase 6 Plan 03 — passed to wireScrollState for snap-to-bottom repaint
    getActiveCellSize,         // Phase 6 Plan 04 — selection / tests resolve px-cell math via this
    readRowText,               // Phase 6 Plan 04 — selection asks canvas for decoded row text
} from './renderer/canvas.js';
import { wireChrome } from './renderer/chrome.js';
import { wireScrollState } from './renderer/scroll-state.js';
import { wireSelection } from './input/selection.js';
import { wireKeyboard, setLocalEcho, setCrlfMode } from './input/keyboard.js';
import {
    registerTxObserver,
    formatHexStrip,
    resetTx,
    setWireOwner,
    getWireOwner,
    writeSlideFrame,
    writeSlideFrameAwaitable,
    isWriterReady,                         // Phase 9 WR-03 — top-bar button gate
} from './input/tx-sink.js';
import { wireSerial } from './transport/serial.js';
import {
    wireSlideDispatcher,
    dispatchInbound,
    enterSendMode as enterSlideSendMode,
    forceExitRecvMode as dispatcherForceExitRecvMode,   // Plan 10-05 Rule 1 — mode-flag sync hook
    __resetForTests as __slideResetForTests,
    __getStateForTests as __slideGetStateForTests,
} from './transport/slide.js';
import {
    enqueuePaste,
    onProgress as onPastePumpProgress,
    cancelPaste as cancelPastePump,
    isActive as pastePumpIsActive,
    wirePastePump,
} from './input/paste-pump.js';
import {
    wireFileSource,
    __resetForTests as __fileSourceResetForTests,
    __getStateForTests as __fileSourceGetStateForTests,
} from './input/file-source.js';
// Phase 10 Plan 10-03 — SLIDE recv plumbing wiring.
// wireSlideRecv slots AFTER wireSlideDispatcher; window.__slide.cancelRecv +
// window.__slide.isActive + window.__slideRecv exposure for Plan 10-04 Settings
// UI + Plan 10-05 Playwright UAT specs.
import {
    wireSlideRecv,
    cancelSlideRecv,
    isSlideActive,
    slidePumpOnPortLost as slideRecvPumpOnPortLost,
    recoverHardFail as slideRecvRecoverHardFail,
    __resetForTests as __slideRecvResetForTests,
    __getStateForTests as __slideRecvGetStateForTests,
} from './transport/slide-recv.js';
// Phase 11 Plan 11-02 — SLIDE chip module (Wave 1). wireSlideChip slots AFTER
// wireFileSource; chip lifecycle integration with the dispatcher (auto-driven
// state transitions on session start / file-complete / session-complete /
// cancel / port-lost) lands in Plan 11-03. Plan 11-04 wires the
// Compatibility-mode 3-second wakeup timer + swallow-echo filter. For now
// the chip is addressable only via window.__slideChip introspection.
import {
    wireSlideChip,
    __resetForTests as __slideChipResetForTests,
    __getStateForTests as __slideChipGetStateForTests,
} from './renderer/slide-chip.js';
import { getRecvDirHandle, setRecvDirHandle, clearRecvDirHandle } from './state/idb.js';
import { wireClipboard, copySelection, pasteFromClipboard } from './input/clipboard.js';
import {
    wireSessionLog,
    reset as sessionLogReset,
    append as sessionLogAppend,
    download as sessionLogDownload,
    getCurrentBytes as sessionLogBytes,
} from './transport/session-log.js';

// ---- init + construction (Phase 2 — unchanged) ----
const wasm = await init();                             // top-level-await: Chromium >=89
const term = new Terminal(24, 80, 10_000);             // #[wasm_bindgen(constructor)]

// ---- Phase 3 renderer + chrome wiring ----
await bootRenderer({ wasm, term });

const terminalWrapper = document.getElementById('terminal-wrapper');
const themeButton     = document.getElementById('theme-toggle');
const phosphorGroup   = document.getElementById('phosphor-group');
const phosphorButtons = phosphorGroup.querySelectorAll('button[data-phosphor]');
const bellOverlay     = document.getElementById('bell-overlay');
// Phase 4 Plan 03 — Settings pane + Debug TX strip refs.
const localEchoCheckbox = document.getElementById('local-echo');
const crlfRadios        = document.querySelectorAll('input[name="crlf"]');
const txStripEl         = document.getElementById('tx-strip');
const txResetButton     = document.getElementById('tx-reset');
const TX_STRIP_PLACEHOLDER = '(none yet — press any key on the terminal to see TX bytes)';
// Phase 5 — Connection pane DOM refs (see www/index.html Plan 02 Wave 1).
const connectButton     = document.getElementById('connect-button');
const connectionPane    = document.getElementById('connection');
const portStatusEl      = document.getElementById('port-status');
const errorLogEl        = document.getElementById('error-log');
// Phase 5 Wave 3 — serial-config form refs (D-08 / UI-SPEC §"Serial config form" DOM).
const serialBaud          = document.getElementById('serial-baud');
const serialDataBits      = document.getElementById('serial-databits');
const serialStopBits      = document.getElementById('serial-stopbits');
const serialParity        = document.getElementById('serial-parity');
const serialFlowCtl       = document.getElementById('serial-flowctl');
const serialReset         = document.getElementById('serial-reset-preset');
const serialReconnectHint = document.getElementById('serial-reconnect-hint');
// Phase 5 Wave 5 — paste UI refs (D-16 / D-17 / D-18).
const pasteProgressRow    = document.getElementById('paste-progress-row');
const pasteProgressText   = document.getElementById('paste-progress-text');
const pasteCancelBtn      = document.getElementById('paste-cancel');
const pasteTestBtn        = document.getElementById('paste-test');
// Phase 6 Plan 05 (Wave 4) — session-log download button (D-31).
const downloadLogBtn      = document.getElementById('download-log-button');
// Phase 6 Plan 05 (Wave 4) — wireChrome's Clear button needs scrollState
// which is wired below; pass a getter thunk so the click handler resolves
// the live ref at click time. scrollStateRef is set right after wireScrollState
// returns; wireChrome receives the getter, not the value.
let scrollStateRef = null;
// Phase 11 Plan 11-04 D-13 / SLIDE-31 — declare cancelSlideRecvLazy thunk-
// holder BEFORE wireChrome so chrome.js's visibilitychange + pagehide
// listeners can close over a stable reference. Phase 11 Plan 11-03's
// wireSlideChip uses the same pattern further below; the holder is
// reassigned to the real cancelSlideRecv after wireSlideRecv runs (line
// ~510). Until then, calls into cancelSlideRecvLazy() are no-ops — but
// during boot no SLIDE session can be active anyway (isSlideActive() returns
// false until enterRecvMode flips it), so the thunk is never called before
// it's bound.
let cancelSlideRecvLazy = () => { /* no-op until wireSlideRecv runs */ };

// Phase 6 Plan 06 (Wave 5) — Settings-pane new rows (Clear scrollback / Auto
// connect / Reset prefs). chrome.js owns the click handlers; main.js injects
// resetPrefs + savePrefs + prefs so the handlers can persist user choices.
//
// Phase 11 Plan 11-04 D-13 / SLIDE-31 — visibilitychange + pagehide listeners
// in chrome.js need three additional refs to emit fire-and-forget CTRL_CAN
// during active SLIDE session: isSlideActive (predicate gate),
// cancelSlideRecvLazy (thunk-holder declared above before wireSlideRecv
// runs), txSink (writeSlideFrame for the 0x18 byte). The thunk for
// cancelSlideRecv mirrors the wireSlideChip onCancel pattern from Plan
// 11-03 — the function reference is always defined but its internal state is
// only populated after wireSlideRecv runs.
wireChrome({
    terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay, requestFrame,
    term,                                       // Phase 6 Plan 05 — clear_visible / resize_scrollback
    getScrollState: () => scrollStateRef,
    prefs,                                      // Phase 6 Plan 06 — Auto connect checkbox initial state
    savePrefs,                                  // Phase 6 Plan 06 — persist Auto connect changes + theme/phosphor toggles
    resetPrefs,                                 // Phase 6 Plan 06 — Reset all preferences 2-click confirm
    isSlideActive: isSlideActive,               // Phase 11 D-13 — predicate gate for CTRL_CAN branch
    cancelSlideRecv: () => cancelSlideRecvLazy(),  // Phase 11 D-13 — thunk-holder; resolved below
    txSink: { writeSlideFrame, writeSlideFrameAwaitable },  // Phase 11 D-13 — fire-and-forget CTRL_CAN
});

// ---- Phase 6 Plan 03 (Wave 2) — wire scrollback state machine ----
// wireScrollState owns the wheel listener (attached to #terminal-wrapper),
// the trackpad accumulator, the [data-scrolled-back] attribute on
// #terminal-wrapper, and the floating "↓ N new lines" chip lifecycle.
// Slotted AFTER wireChrome so the [data-focused] focus listener registers
// first; both attribute setters operate on #terminal-wrapper without conflict.
const scrollbackIndicatorEl     = document.getElementById('scrollback-indicator');
const scrollbackIndicatorTextEl = document.getElementById('scrollback-indicator-text');
const scrollState = wireScrollState({
    term,
    canvasWrapper: terminalWrapper,
    indicator: scrollbackIndicatorEl,
    indicatorText: scrollbackIndicatorTextEl,
    requestFrame,
    markAllRowsDirty,
});
// Phase 6 Plan 05 (Wave 4) — late-bind for chrome.js's Clear button.
// wireChrome was called BEFORE wireScrollState (per RESEARCH §Architecture
// boot order); the getScrollState thunk lets the Clear handler resolve the
// live ref at click time without violating the documented module order.
scrollStateRef = scrollState;
// Test introspection (mirrors window.__testGridView precedent at main.js:55-64).
// Plan 06-04 (keyboard chord intercepts) + Plan 06-06 (selection / clipboard)
// will import scroll-state.js directly; this exposure is for Playwright tests.
window.__scrollState = scrollState;
window.__term = term;
// Phase 6 Plan 05 (Wave 4) — clear-screen.spec.js parser-state-preservation
// regression test reads host_reply via raw memory, and the rest of the suite
// drives manual feed → frame requests. Both window-only handles (no security
// surface — Phase 4 D-15 precedent).
window.__wasm = wasm;
window.__requestFrame = requestFrame;

// ---- Phase 6 Plan 04 (Wave 3) — wire selection state machine ----
// wireSelection owns pointerdown/move/up handlers on the canvas + the
// scrollback-tail-relative endpoint storage (D-17). Slotted AFTER
// wireScrollState so scrollState.onChange is available for D-19's
// "selection clears on post-drag scroll" observer.
const selection = wireSelection({
    canvas: document.getElementById('terminal'),
    scrollState,
    term,
    requestFrame,
    getCellW: () => getActiveCellSize().cellW,
    getCellH: () => getActiveCellSize().cellH,
    terminalWrapper,
    readRow: readRowText,
});
window.__selection = selection;
window.__getActiveCellSize = getActiveCellSize;

// D-19 — selection clears on theme/phosphor/zoom toggle. The theme + phosphor
// + zoom-keyboard chords land via chrome.js handlers we don't own; rather than
// thread an onChange callback through wireChrome's API, we register our own
// click listeners in capture phase to fire BEFORE the toggle handler runs.
// Selection observers don't depend on the toggle outcome — clearing pre-emptively
// is correct (the Phase 3 side-effects will repaint the canvas afterwards).
themeButton.addEventListener('click', () => selection.clearSelection(), true);
for (const btn of phosphorButtons) {
    btn.addEventListener('click', () => selection.clearSelection(), true);
}
// Ctrl+{+,-,0} zoom keyboard chord — chrome.js handles it; clear selection in
// capture phase from the wrapper.
terminalWrapper.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === 'Equal' || e.code === 'NumpadAdd'
                || e.code === 'Minus' || e.code === 'NumpadSubtract'
                || e.code === 'Digit0' || e.code === 'Numpad0') {
            selection.clearSelection();
        }
    }
}, true);

// ---- Phase 4 Plan 01 — test harness hook (unconditionally exposed) ----
// Plan 04-04's local-echo spec uses __testGridView() to read grid bytes back
// and assert that typed chars rendered (echo on) vs did not render (echo off,
// the Phase 4 default). Unconditionally exposed — not gated by ?test=1 —
// because Phase 4 has zero security surface (no auth, no PII, no network);
// Phase 5 Web Serial will gate differently if needed.
window.__testGridView = () => new Uint8Array(
    wasm.memory.buffer,
    term.grid_ptr(),
    term.grid_byte_len(),
);

// ---- Phase 2 harness helpers (retained verbatim for Debug pane — D-15) ----

function parseHexEscapes(input) {
    const out = [];
    let i = 0;
    while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === 0x5C /* \ */
            && i + 4 <= input.length
            && (input.charCodeAt(i + 1) === 0x78 || input.charCodeAt(i + 1) === 0x58) /* x or X */) {
            const hiVal = hexDigit(input.charCodeAt(i + 2));
            const loVal = hexDigit(input.charCodeAt(i + 3));
            if (hiVal !== null && loVal !== null) {
                out.push((hiVal << 4) | loVal);
                i += 4;
                continue;
            }
        }
        if (ch <= 0xFF) out.push(ch);
        i++;
    }
    return new Uint8Array(out);
}

function hexDigit(c) {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    return null;
}

function buildStressPayload(total) {
    const buf = new Uint8Array(total);
    let w = 0;
    while (w < total) {
        for (let b = 0x20; b <= 0x7E && w < total; b++) buf[w++] = b;
        if (w + 4 <= total) {
            buf[w++] = 0x1B;
            buf[w++] = 0x59; // 'Y'
            buf[w++] = 0x20;
            buf[w++] = 0x20;
        } else {
            while (w < total) buf[w++] = 0x20;
        }
    }
    return buf;
}

// ---- Host-reply drain helper (zero-copy per Phase 2 02-06 pattern) ----
// Derives a fresh view into wasm.memory.buffer when the buffer identity has
// shifted (memory growth). Used ONLY in the Feed / Stress click handlers;
// the renderer owns its own grid/dirty views (canvas.js re-derives them there).
const HOST_REPLY_VIEW_CAP = 8;
let hostReplyView = null;
let hostReplyBuffer = null;

function reDeriveHostReplyView() {
    if (wasm.memory.buffer !== hostReplyBuffer) {
        hostReplyView = new Uint8Array(wasm.memory.buffer, term.host_reply_ptr(), HOST_REPLY_VIEW_CAP);
        hostReplyBuffer = wasm.memory.buffer;
    }
}
reDeriveHostReplyView();

function drainHostReply(tag) {
    const replyLen = term.host_reply_len();
    if (replyLen > 0) {
        reDeriveHostReplyView();
        console.log(`[host_reply ${tag}]`, Array.from(hostReplyView.subarray(0, replyLen)));
        term.clear_host_reply();
    }
}

// ---- Bell sampling helper (RENDER-11 — synchronous post-feed path) ----
// Called AFTER every term.feed(...) invocation. Owning the bell flow here
// (instead of inside canvas.js's rAF tick) keeps the BEL-while-hidden title
// prefix immune to Chromium's ~1 Hz rAF throttling when document.hidden is true.
// The CSS overlay flash is driven by canvas.js's exported triggerBellFlash()
// which toggles a class on #bell-overlay (CSS transition handles the 100 ms timing).
const TITLE_PREFIX = '(!) ';
function sampleBell() {
    if (!term.bell_pending()) return;
    term.clear_bell();
    triggerBellFlash();                               // CSS class toggle; no rAF needed
    if (document.hidden && !document.title.startsWith(TITLE_PREFIX)) {
        document.title = TITLE_PREFIX + document.title;
    }
    // NOTE: the foreground-return "strip prefix" half is handled by the
    // visibilitychange listener registered in chrome.js wireChrome().
}

// ---- Phase 4 Plan 02 — keyboard input wiring ----
// wireKeyboard attaches its keydown + compositionstart/update/end listeners
// to #terminal-wrapper. chrome.js's keydown listener attached FIRST (inside
// wireChrome above), so Phase 4's listener runs SECOND and short-circuits on
// e.defaultPrevented for chords chrome.js already claimed (Ctrl+Alt+T,
// Ctrl+{+,-,0}). Call site sits AFTER the sampleBell / drainHostReply arrow
// functions are assigned so injected refs are defined (would TDZ if moved
// earlier). Plan 04-03 wires the Settings-pane toggles (local-echo checkbox,
// CR/LF radios, Reset TX button) and registers the TX observer against the
// Debug pane's hex-strip <pre>; Plan 04-02 leaves the observer un-registered
// so the TX strip stays at its placeholder text until Plan 04-03 adds the
// DOM element.
wireKeyboard({
    term,
    terminalWrapper,
    sampleBell,
    drainHostReply,
    requestFrame,
});

// Phase 5 Wave 5 — wire paste-pump's local-echo feed path (D-22). MUST be
// called AFTER wireKeyboard (deps are resolved) and BEFORE wireSerial so the
// pump is ready to accept bytes the instant the port opens.
wirePastePump({ term, sampleBell, drainHostReply, requestFrame });

// ---- Phase 6 Plan 04 (Wave 3) — wire clipboard adapter ----
// wireClipboard owns the large-paste confirm chip lifecycle (D-25) and the
// #paste-confirm focus-retention listener. The DOM refs were already resolved
// at the top of main.js (Phase 5 paste-progress block); we add #paste-confirm.
const pasteConfirmBtn = document.getElementById('paste-confirm');
wireClipboard({
    pasteProgressText,
    pasteCancelBtn,
    pasteConfirmBtn,
    pasteProgressRow,
    // Plan 06-06 (PREF-01) wires the Settings serial-config baud as the
    // authoritative source. For now the form select element is the live value.
    getBaud: () => parseInt(serialBaud.value, 10) || 19200,
});
window.__copySelection = copySelection;
window.__pasteFromClipboard = pasteFromClipboard;
// Phase 11 Plan 11-05 — expose paste-pump for slide-bridge.spec.js paste-gate
// tests. enqueuePaste no-ops while isSlideActive() returns true (Plan 11-03
// D-12 / SLIDE-33); the gate is verified by asserting writer-log absence of
// the paste bytes during an active SLIDE session.
window.__pastePump = {
    enqueuePaste,
    cancelPaste: cancelPastePump,
    isActive: pastePumpIsActive,
};

// ---- Phase 6 Plan 05 (Wave 4) — wire session log accumulator ----
// wireSessionLog owns the chunks-by-reference buffer + Blob download trigger
// (D-30 / D-31). Slotted BEFORE wireSerial so the read-loop append callback
// is bound by the time the first chunk arrives. The Connection-pane
// #download-log-button is registered here; sessionLog.reset() runs inside
// wireSerial's connectMicroBeast / finishReconnect paths.
wireSessionLog({ downloadButton: downloadLogBtn });
// Test introspection — Playwright drives append/reset/download via the spec
// to assert per-connection lifecycle without touching real Web Serial.
window.__sessionLog = {
    append: sessionLogAppend,
    reset: sessionLogReset,
    download: sessionLogDownload,
    getCurrentBytes: sessionLogBytes,
};

// Phase 11 Plan 11-03 — wire SLIDE chip FIRST (re-ordered from Plan 11-02 boot
// position so downstream initializers can pass slideChipApi into wireSlideDispatcher
// / wireSlideRecv / wireFileSource opts). Lifecycle integration with the dispatcher
// (auto-driven state transitions on session events) lands via the slideChip opt
// in wireSlideDispatcher below; Compatibility-mode 3 s wakeup timer + [Force start]
// / [Retry] action wiring lands in Plan 11-04.
//
// onCancel uses a thunk-holder pattern: cancelSlideRecv is an imported function
// reference always defined, but its internal state (slideRef, dispatcherForceExitRef)
// is only populated after wireSlideRecv runs. The thunk-holder lets us hand a
// stable closure to wireSlideChip BEFORE wireSlideRecv runs and resolve to the
// real cancelSlideRecv once it's wired below. Phase 11 Plan 11-04 hoisted the
// `let cancelSlideRecvLazy = () => {};` declaration up to before wireChrome
// so chrome.js's visibilitychange + pagehide listeners (D-13) can also close
// over the same holder; Plan 11-03's wireSlideChip below shares it.

const slideChipEl = document.getElementById('slide-chip');
const slideChipTextEl = document.getElementById('slide-chip-text');
const slideChipApi = wireSlideChip({
    chipEl: slideChipEl,
    chipTextEl: slideChipTextEl,
    getSlideState: __slideGetStateForTests,    // imported from transport/slide.js (existing)
    onCancel: () => cancelSlideRecvLazy(),     // thunk-holder — resolved after wireSlideRecv
    prefs,                                      // existing prefs object loaded at boot
});

// Phase 8 — wire SLIDE dispatcher AFTER wireSessionLog (so the post-feed
// invariant's sessionLogRef.append still sees inbound bytes — terminal mode
// is byte-transparent through dispatchInbound) and BEFORE await wireSerial
// so the dispatcher is initialized before any chunks could arrive on the
// read loop. Pitfall 8 — Slide constructor depends on `await init()` having
// resolved, which happened at main.js:79.
//
// Phase 11 Plan 11-03 — extended opts: prefs (D-09 auto-send sourced from
// prefs.slideAutoSendCommand) + pastePump (D-12 cancelPaste at SLIDE wakeup
// completion) + slideChip (D-15 chip lifecycle hooks at enterSendMode /
// enterRecvMode / exitSendMode / exitRecvMode).
wireSlideDispatcher({
    term,
    txSink: { setWireOwner, getWireOwner, writeSlideFrame, writeSlideFrameAwaitable },
    slideCtor: Slide,
    wasm,
    prefs,                                      // Phase 11 D-09 — auto-send from prefs.slideAutoSendCommand
    pastePump: { cancelPaste: cancelPastePump }, // Phase 11 D-12 — cancelPaste at SLIDE wakeup
    slideChip: slideChipApi,                    // Phase 11 — chip lifecycle hooks
});

// Phase 10 Plan 10-03 — wire SLIDE recv plumbing AFTER wireSlideDispatcher.
// Plan 10-04 fills the Settings DOM refs (rowEl / toggleEl / folderButtonEl /
// statusEl / helpEl) so the new Settings row's change/click handlers are
// installed inside wireSlideRecv (mousedown preventDefault retained for
// terminal focus per Phase 4 D-16 + Phase 6 precedent). The anchor-click
// default path still works (slideRecvToFolder=false default in prefs).
//
// Phase 11 Plan 11-03 — extended opts: slideChip (D-14 — slidePumpOnPortLost
// calls slideChipRef.enterError on port-lost teardown).
const slideRecvFolderRow        = document.getElementById('slide-recv-folder-row');
const slideRecvToFolderCheckbox = document.getElementById('slide-recv-to-folder-checkbox');
const slideRecvFolderButton     = document.getElementById('slide-recv-folder-button');
const slideRecvFolderStatus     = document.getElementById('slide-recv-folder-status');
const slideRecvFolderHelp       = document.getElementById('slide-recv-folder-help');
wireSlideRecv({
    wrapperEl: terminalWrapper,
    prefs,
    savePrefs,
    idb: { getRecvDirHandle, setRecvDirHandle, clearRecvDirHandle },
    txSink: { setWireOwner, getWireOwner, writeSlideFrame, writeSlideFrameAwaitable },
    wasm,
    slideRef: null,                  // slide.js sets via setSlideRef on each enterRecvMode
    rowEl: slideRecvFolderRow,
    toggleEl: slideRecvToFolderCheckbox,
    folderButtonEl: slideRecvFolderButton,
    statusEl: slideRecvFolderStatus,
    helpEl: slideRecvFolderHelp,
    // Plan 10-05 Rule 1 fix — slide-recv.js's forceExitRecvMode invokes this
    // to synchronously flip slide.js's module-scope `mode` flag back to
    // 'terminal' on cancel / hard-fail (without waiting for the next inbound
    // chunk to trigger maybeExitRecvMode).
    dispatcherForceExit: dispatcherForceExitRecvMode,
    slideChip: slideChipApi,         // Phase 11 D-14 — chip handle for slidePumpOnPortLost
});

// Phase 11 Plan 11-03 — resolve the thunk-holder now that cancelSlideRecv's
// internal state (slideRef + dispatcherForceExitRef) is wired by wireSlideRecv.
// Subsequent calls into cancelSlideRecvLazy() reach the real cancel state
// machine instead of no-op.
cancelSlideRecvLazy = cancelSlideRecv;

// Phase 11 Plan 11-03 — Settings SLIDE sub-block: hydrate from prefs +
// wire savePrefs (D-06 / D-07 / D-08 / D-09). Each form control hydrates
// from prefs.<key> at boot (defensive against missing key — Phase 6 D-32
// defensive merge fills DEFAULTS); listens for `change` and persists via
// the existing 250 ms debounced savePrefs (Phase 6 D-32/D-33). The
// Compatibility mode <select> change handler restores #terminal-wrapper
// focus per Phase 4 D-16 sacred. The Compatibility-mode 3-way branching
// behavior is delivered by Plan 11-04.
const slideAutoSendInput = document.getElementById('slide-auto-send-input');
const slideShowSummaryCheckbox = document.getElementById('slide-show-summary');
const slideCompatSelect = document.getElementById('slide-compat-select');

if (slideAutoSendInput) {
    // Display value WITHOUT trailing \r — D-06: \r is appended at save time, not displayed.
    const stored = prefs.slideAutoSendCommand || '';
    slideAutoSendInput.value = stored.endsWith('\r') ? stored.slice(0, -1) : stored;

    slideAutoSendInput.addEventListener('change', (e) => {
        const v = e.target.value;
        // D-06 — append \r at save time. Empty string disables auto-type per
        // SLIDE-13 semantic (preserves Phase 9 D-14 logic; Plan 11-03 swaps
        // the source from a hardcoded constant to prefs.slideAutoSendCommand).
        savePrefs({ slideAutoSendCommand: v.length === 0 ? '' : v + '\r' });
    });
}

if (slideShowSummaryCheckbox) {
    slideShowSummaryCheckbox.checked = !!prefs.slideShowSummary;
    slideShowSummaryCheckbox.addEventListener('change', (e) => {
        savePrefs({ slideShowSummary: !!e.target.checked });
    });
}

if (slideCompatSelect) {
    const v = prefs.slideCompatibilityMode || 'auto';
    if (['auto', 'wakeup-required', 'force-start'].includes(v)) {
        slideCompatSelect.value = v;
    }
    slideCompatSelect.addEventListener('change', (e) => {
        savePrefs({ slideCompatibilityMode: e.target.value });
        // Phase 4 D-16 — restore canvas focus after dropdown closes.
        if (terminalWrapper) terminalWrapper.focus();
    });
}

// Test introspection (mirrors window.__sessionLog / window.__scrollState
// precedent). Plan 08-04's Playwright specs read mode + wakeIdx via
// window.__slide.__getStateForTests(); they push reader bytes via
// window.__mockReaderPush (existing Phase 5 hook) and assert outcomes.
// Phase 9 Plan 02 — enterSendMode added so Plan 09-04 Playwright specs
// can drive the sender lifecycle programmatically without a file-source UI.
// Phase 10 Plan 10-03 — cancelRecv + isActive added for Esc-cancel UAT specs;
// window.__slideRecv exposes the recv-module test introspection separately so
// the W1 wiring (slide.js's __getStateForTests recv-mode branch reads
// bytes_in_file_done from window.__slideRecv) has a stable read path.
window.__slide = {
    __resetForTests: __slideResetForTests,
    __getStateForTests: __slideGetStateForTests,
    dispatchInbound,
    enterSendMode: enterSlideSendMode,        // Phase 9 test hook
};
// Phase 10 Plan 10-03 — explicit per-property assignment matches CONTEXT lock
// (locked grep targets `window.__slide.cancelRecv = cancelSlideRecv` and
// `window.__slide.isActive = isSlideActive`) so future plans (and the
// plan-checker grep gates) can find the wiring without parsing object literals.
window.__slide.cancelRecv = cancelSlideRecv;
window.__slide.isActive = isSlideActive;   // Phase 10 — Playwright introspection
window.__slideRecv = {
    __resetForTests: __slideRecvResetForTests,
    __getStateForTests: __slideRecvGetStateForTests,
};
// Phase 9 Plan 02 — writeSlideFrameAwaitable added so the new tx-sink Playwright
// tests (writeSlideFrameAwaitable awaits writer.ready / throws / propagates)
// can call into the sender entrypoint via window.__txSink.
// Phase 9 WR-03 — isWriterReady exported so the top-bar button gate logic
// is observable from Playwright (file-source.spec.js asserts the disabled
// state across the connect lifecycle).
window.__txSink = { setWireOwner, getWireOwner, writeSlideFrame, writeSlideFrameAwaitable, isWriterReady };

// Phase 9 Plan 03 — wire file-source AFTER wireSlideDispatcher so file-source's
// injected `enterSendMode` reaches the already-wired dispatcher. file-source
// owns the top-bar [↑ Send file] button click + hidden multi-file picker,
// the drag-drop overlay on #terminal-wrapper, the rewrite/rejection confirm
// modal, and the button-state observer. terminalWrapper was already fetched
// at main.js:100 for canvas + scrollback wiring; reuse the existing reference.
const sendFileButton           = document.getElementById('send-file-button');
const sendFileInput            = document.getElementById('send-file-input');
const sendModalDialog          = document.getElementById('send-modal');
const sendModalTitle           = document.getElementById('send-modal-title');
const sendModalList            = document.getElementById('send-modal-list');
const sendModalAllRejectedHint = document.getElementById('send-modal-all-rejected-hint');
const sendModalCancelButton    = document.getElementById('send-modal-cancel');
const sendModalSendButton      = document.getElementById('send-modal-send');

// Phase 11 Plan 11-03 — extended opts: slideChip (D-10 — flashDropRejected
// at onDragEnter + onDrop call sites when isSessionActive() returns true).
wireFileSource({
    wrapperEl: terminalWrapper,
    sendBtn: sendFileButton,
    sendInput: sendFileInput,
    modalEl: sendModalDialog,
    titleEl: sendModalTitle,
    listEl: sendModalList,
    hintEl: sendModalAllRejectedHint,
    modalCancelBtn: sendModalCancelButton,
    modalSendBtn: sendModalSendButton,
    enterSendMode: enterSlideSendMode,        // imported from transport/slide.js (Plan 09-02)
    getSlideState: __slideGetStateForTests,    // imported from transport/slide.js (Plan 09-02)
    isWriterReady,                            // Phase 9 WR-03 — gate top-bar button on writer registration
    slideChip: slideChipApi,                  // Phase 11 D-10 — chip flash on drop-during-active-session
});

// Test introspection (mirrors Phase 8 + Plan 09-02 window.__* precedent).
// Plan 09-04 Playwright specs read via window.__fileSource.__getStateForTests()
// to assert drag depth + drop-target state + modal-open state + button label.
window.__fileSource = {
    __resetForTests: __fileSourceResetForTests,
    __getStateForTests: __fileSourceGetStateForTests,
};

// Phase 11 Plan 11-02 — chip introspection for Plan 11-05 Playwright tests.
// Public state-transition methods are exposed alongside __reset/__getStateForTests
// so the slide-chip.spec.js suite can drive lifecycle states programmatically
// (the chip is not yet auto-driven by dispatcher events until Plan 11-03).
window.__slideChip = {
    __resetForTests: __slideChipResetForTests,
    __getStateForTests: __slideChipGetStateForTests,
    enterAwaitingWakeup: slideChipApi.enterAwaitingWakeup,
    enterActive: slideChipApi.enterActive,
    enterCancelledSummary: slideChipApi.enterCancelledSummary,
    enterSummary: slideChipApi.enterSummary,
    enterError: slideChipApi.enterError,
    flashDropRejected: slideChipApi.flashDropRejected,
    hide: slideChipApi.hide,
};

// Phase 5 — wire Web Serial transport. opts mirror Phase 4 wireKeyboard
// shape for sampleBell/drainHostReply/requestFrame discipline (D-35 post-feed
// invariant). await because wireSerial awaits navigator.serial.getPorts() on
// boot (D-05 restore-from-prior-grant scan).
await wireSerial({
    term,
    sampleBell,
    drainHostReply,
    requestFrame,
    connectButton,
    connectionPane,
    portStatusEl,
    errorLogEl,
    // Phase 5 Wave 3 — serial-config form refs (D-08).
    serialConfigEls: {
        baud: serialBaud,
        dataBits: serialDataBits,
        stopBits: serialStopBits,
        parity: serialParity,
        flowCtl: serialFlowCtl,
        resetBtn: serialReset,
        reconnectHintEl: serialReconnectHint,
    },
    // Phase 6 Plan 05 (Wave 4) — D-29 reset-on-Connect + D-30 read-loop append.
    sessionLog: { reset: sessionLogReset, append: sessionLogAppend },
    // Phase 6 Plan 06 (Wave 5) — auto-connect path (D-34) + serial form persist.
    prefs,
    savePrefs,
});

// ---- Phase 4 Plan 03 — Settings controls ----
// Local-echo toggle (INPUT-04). Default unchecked in DOM; setLocalEcho(false)
// is the default in keyboard.js. Change event fires for both mouse-click
// (after mousedown preventDefault below restores the toggle) and keyboard
// activation (Tab + Space).
localEchoCheckbox.addEventListener('change', (e) => {
    setLocalEcho(e.target.checked);
    savePrefs({ localEcho: e.target.checked });   // Phase 6 Plan 06 (PREF-02) — persist
});
// D-16 — mousedown preventDefault prevents focus transfer. For a native
// <input type="checkbox">, the subsequent click event STILL toggles the
// checked state (mousedown's preventDefault only stops focus, not the
// native click-toggle), so we do NOT manually flip .checked here — the
// change listener above already fires from that native toggle. Plan 04-04
// Task 1 Rule 1 fix: an earlier version manually flipped .checked in this
// handler, which the subsequent native click then reverted, leaving the
// checkbox effectively un-togglable by mouse.
localEchoCheckbox.addEventListener('mousedown', (e) => {
    e.preventDefault();
});

// CR/LF override (INPUT-05). Radio default 'cr' per UI-SPEC (checked attr
// on #crlf-cr). Change event fires via Tab+Space or (after mousedown restore)
// mouse click.
for (const radio of crlfRadios) {
    radio.addEventListener('change', (e) => {
        if (e.target.checked) {
            setCrlfMode(e.target.value);
            savePrefs({ crlfMode: e.target.value });   // Phase 6 Plan 06 (PREF-02) — persist
        }
    });
    // D-16 — mousedown preventDefault + explicit check + setCrlfMode.
    radio.addEventListener('mousedown', (e) => {
        e.preventDefault();
        radio.checked = true;
        // Clear sibling radios (native radio group exclusion is bypassed
        // when we set .checked programmatically after preventDefault).
        for (const other of crlfRadios) {
            if (other !== radio) other.checked = false;
        }
        setCrlfMode(radio.value);
        savePrefs({ crlfMode: radio.value });          // Phase 6 Plan 06 (PREF-02) — persist
    });
}

// TX-strip observer (D-15). Registered exactly once; fires synchronously on
// every pushTxBytes. Placeholder restored when ring is empty (after resetTx
// or before any keypress).
registerTxObserver(() => {
    const hex = formatHexStrip(64);
    txStripEl.textContent = hex === '' ? TX_STRIP_PLACEHOLDER : hex;
});

// Reset TX button — non-destructive (CONTEXT D-07, UI-SPEC Destructive states:
// "not applicable"). Click fires from both mouse (via mousedown restore) and
// keyboard (Tab + Enter/Space).
txResetButton.addEventListener('click', () => {
    resetTx();
});
txResetButton.addEventListener('mousedown', (e) => {
    e.preventDefault();                           // D-16 focus retention.
    resetTx();                                    // explicit action — mousedown suppressed native click path.
});

// ---- Phase 5 Plan 09 (Gap 2 fix) — paste progress observer ----
// Paste progress is surfaced in the #top-bar slot (index.html relocation),
// NOT by auto-expanding the Connection pane. Per amended D-17 (05-CONTEXT.md
// Plan 09 amendment) and the amended 05-UI-SPEC.md auto-expand rules table,
// the pump does NOT mutate the Connection pane's open state — the top-bar is
// sticky so visibility is achieved without displacing the terminal canvas.
// The connectionPane DOM ref is still passed to wireSerial so serial.js's
// D-27 error-log auto-expand path keeps working (intentionally asymmetric:
// errors are rare and sticky, paste is frequent — see amended D-17 rationale).
onPastePumpProgress((ev) => {
    if (ev.status === 'started') {
        pasteProgressRow.hidden = false;
        pasteProgressText.textContent = `Pasting ${ev.total} B — 0%`;
        return;
    }
    if (ev.status === 'chunk') {
        const pct = Math.round(ev.written / ev.total * 100);
        pasteProgressText.textContent = `Pasting ${ev.total} B — ${pct}%`;
        return;
    }
    if (ev.status === 'complete') {
        pasteProgressText.textContent = 'Paste complete';
        setTimeout(() => {
            pasteProgressRow.hidden = true;
            pasteProgressText.textContent = '';
        }, 2000);
        return;
    }
    if (ev.status === 'cancelled') {
        pasteProgressText.textContent = 'Paste cancelled';
        setTimeout(() => {
            pasteProgressRow.hidden = true;
            pasteProgressText.textContent = '';
        }, 2000);
        return;
    }
    if (ev.status === 'cancelled-port-lost') {
        pasteProgressText.textContent = `Paste cancelled — port lost (${ev.unsent} bytes unsent)`;
        setTimeout(() => {
            pasteProgressRow.hidden = true;
            pasteProgressText.textContent = '';
        }, 3000);
        return;
    }
});

// D-18 Cancel button wiring. mousedown preventDefault retains #terminal-wrapper
// focus so Esc continues to work after a mouse-click cancel (UI-SPEC §Focus retention).
pasteCancelBtn.addEventListener('click', () => cancelPastePump());
pasteCancelBtn.addEventListener('mousedown', (e) => e.preventDefault());

// D-16 — Paste test button routes textarea bytes through the pump.
// Uses parseHexEscapes so \xNN escapes produce control bytes.
pasteTestBtn.addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    enqueuePaste(bytes);
});
pasteTestBtn.addEventListener('mousedown', (e) => e.preventDefault());

// ---- Feed button (Phase 2 D-11 item 2 — ONE feed call per click) ----
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);                       // ONE boundary call (Pitfall #1).
    sampleBell();                           // RENDER-11 — synchronous bell sampling (NOT from rAF).
    drainHostReply('feed');
    requestFrame();                         // wake renderer — Phase 3 replacement for refreshHarnessUI().
});

// ---- 64 KB Stress button (Phase 2 SC-4 — retained verbatim) ----
document.getElementById('stress64k').addEventListener('click', () => {
    const bytes = buildStressPayload(65536);

    console.time('Terminal.feed 64KB');
    const t0 = performance.now();
    term.feed(bytes);                       // ONE call — SC-4 verifies this.
    const t1 = performance.now();
    console.timeEnd('Terminal.feed 64KB');

    sampleBell();                           // RENDER-11 — synchronous bell sampling (NOT from rAF).
    drainHostReply('64KB');

    // SC-4 proof-artifact log lines (Phase 2 regression guard):
    console.log(`[SC-4] Fed ${bytes.length} bytes in ONE feed() call`);
    console.log(`[SC-4] Elapsed: ${(t1 - t0).toFixed(3)} ms`);
    console.log(`[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.`);

    requestFrame();
});

// ---- Phase 6 Plan 06 (Wave 5) — pref subscribers ----
// applyPrefs re-applies the loaded prefs to chrome / canvas / keyboard state.
// Fires on every flushPrefs (after debounce) AND on resetPrefs() — the latter
// is how the Settings 'Reset all preferences' 2-click confirm restores defaults
// in-place WITHOUT a page reload (D-35). Serial config is NOT applied live —
// Phase 5 D-08 reconnect-required hint owns "config changed mid-connection."
// Auto-connect toggle takes effect on NEXT page load (D-34); no immediate connect.
function applyPrefs(p) {
    setTheme(p.theme);
    // body[data-theme] drives scanline visibility + token overrides; chrome.js
    // sets it on theme-toggle clicks but applyPrefs is called from prefsSubscribe
    // (theme-toggle button doesn't fire — e.g. Reset prefs path).
    document.body.setAttribute('data-theme', p.theme);
    // Theme-button label shows the DESTINATION theme (UI-SPEC Copywriting).
    themeButton.textContent = (p.theme === 'crt') ? 'Clean' : 'CRT';
    // Phosphor group hidden in clean theme.
    phosphorGroup.hidden = (p.theme !== 'crt');
    setPhosphor(p.phosphor);
    for (const btn of phosphorButtons) {
        btn.setAttribute('aria-pressed', btn.dataset.phosphor === p.phosphor ? 'true' : 'false');
    }
    if (p.font) {
        setFont(p.font);
        const fontSelect = document.getElementById('font-select');
        if (fontSelect && fontSelect.value !== p.font) fontSelect.value = p.font;
    }
    setZoom(p.fontZoom);
    setLocalEcho(p.localEcho);
    if (localEchoCheckbox.checked !== p.localEcho) localEchoCheckbox.checked = p.localEcho;
    setCrlfMode(p.crlfMode);
    for (const radio of crlfRadios) {
        radio.checked = (radio.value === p.crlfMode);
    }
    // Auto-connect checkbox initial / reset state — chrome.js owns the change
    // listener; applyPrefs only mirrors the stored value into the DOM so a
    // resetPrefs() (D-35) restores the unchecked default in-place.
    const autoConnectCheckbox = document.getElementById('auto-connect-checkbox');
    if (autoConnectCheckbox) autoConnectCheckbox.checked = !!p.autoConnect;
    // Show-all-serial-devices checkbox — same mirror-only pattern. The change
    // listener is wired below at boot; serial.js reads the live pref via
    // getPrefs() at requestPort time, so this checkbox does not need a click
    // to take effect on the next Connect.
    const showAllSerialCheckbox = document.getElementById('show-all-serial-devices');
    if (showAllSerialCheckbox) showAllSerialCheckbox.checked = !!p.showAllSerialDevices;
    // Serial-config form: mirror stored values so a fresh load shows the
    // persisted config in the Connection-pane form. The Phase 5 D-08
    // reconnect-required hint pattern handles live config changes.
    if (p.serial) {
        if (serialBaud)     serialBaud.value     = String(p.serial.baud);
        if (serialDataBits) serialDataBits.value = String(p.serial.dataBits);
        if (serialStopBits) serialStopBits.value = String(p.serial.stopBits);
        if (serialParity)   serialParity.value   = p.serial.parity;
        if (serialFlowCtl)  serialFlowCtl.value  = p.serial.flowControl;
    }
}
prefsSubscribe(applyPrefs);
applyPrefs(prefs);   // Apply once at boot so initial chrome state matches loaded prefs.

// ---- Boot-complete log ----
console.log('[boot] Harness ready. theme=', getActiveTheme().name, 'phosphor=', getActivePhosphor(), 'zoom=', getActiveZoom());
console.log('[boot] term=', term, 'wasm.memory=', wasm.memory);
