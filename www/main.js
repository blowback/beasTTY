// Beastty — boot driver (Phase 3 renderer + Phase 4 Plan 02 keyboard).
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
    isAutoSendSafe,                 // Phase 12 SLIDE-38 — Settings input validation cue
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

import init, { Terminal, Slide } from './pkg/beastty_core.js';
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
    getActiveFont,             // E1.5 — surfaced on window.__canvasState for the font oracle
    triggerBellFlash,          // Plan 03 owns bell sampling; canvas.js provides the CSS helper
    markAllRowsDirty,          // Phase 6 Plan 03 — passed to wireScrollState for snap-to-bottom repaint
    getActiveCellSize,         // Phase 6 Plan 04 — selection / tests resolve px-cell math via this
    readRowText,               // Phase 6 Plan 04 — selection asks canvas for decoded row text
} from './renderer/canvas.js';
import { wireChrome } from './renderer/chrome.js';
import { wireMenuBar } from './renderer/menu-bar.js';
import { wireStatusBar } from './renderer/status-bar.js';
import { wireScrollState } from './renderer/scroll-state.js';
import { wireSelection } from './input/selection.js';
import { wireKeyboard, setLocalEcho, setCrlfMode, getLocalEcho, getCrlfMode } from './input/keyboard.js';
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
// E2.1 (AD-15, AD-3) — serial reaches menu-bar ONLY via wireMenuBar opts (like
// term/getScrollState), never a direct menu-bar import. main.js is the composition
// root that hands onStateChange/getState/toggleConnection across the seam.
import { wireSerial, onStateChange, getState, toggleConnection, connectMicroBeast, requestMicroBeastPort, disconnect, countMicroBeastAdapters, getActiveFraming, getLastConnectError, getConnectionDevice, getRecentErrorCount } from './transport/serial.js';
import {
    wireSlideDispatcher,
    dispatchInbound,
    enterSendMode as enterSlideSendMode,
    forceExitRecvMode as dispatcherForceExitRecvMode,   // Plan 10-05 Rule 1 — mode-flag sync hook
    __resetForTests as __slideResetForTests,
    __getStateForTests as __slideGetStateForTests,
    __isAutoSendSafeForTests as __slideIsAutoSendSafeForTests,   // Phase 12 SLIDE-38
    cancelSlideSend,                                              // Phase 12 UAT Gap D — send-side cancel
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
    openSendPicker,                                          // E3.1 (FR-16) — File ▸ Send File… picker entry (injected into wireMenuBar)
    computeRenameScheme as fileSourceComputeRenameScheme,   // Phase 12 SLIDE-36 — pure helper for Playwright tests
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
// Epic E0 Story E0.1 (AD-10) — shared focus-retention helper. retainFocus is
// imported directly by the chrome modules that own controls (see chrome.js);
// main.js only surfaces its test hooks as window.__focus for the Playwright
// chromium suite.
import {
    __getStateForTests as __focusGetStateForTests,
    __resetForTests as __focusResetForTests,
} from './renderer/focus.js';
// Epic E0 Story E0.2 (AD-8) — shared openModal helper. openModal is imported
// directly by the modules that own dialogs (see file-source.js); main.js only
// surfaces its test hooks as window.__modal for the Playwright chromium suite.
import {
    openModal,                 // E1.5 — Clear Scrollback… deliberate-friction confirm (FR-11)
    __getStateForTests as __modalGetStateForTests,
    __resetForTests as __modalResetForTests,
} from './renderer/modal.js';
import { getRecvDirHandle, setRecvDirHandle, clearRecvDirHandle } from './state/idb.js';
import { wireClipboard, copySelection, pasteFromClipboard } from './input/clipboard.js';
import {
    wireSessionLog,
    reset as sessionLogReset,
    append as sessionLogAppend,
    download as sessionLogDownload,
    getCurrentBytes as sessionLogBytes,
    SESSION_LOG_TOOLTIPS,                       // E3.1 (AC-4) — single-sourced tooltip copy injected into wireMenuBar
} from './transport/session-log.js';

// ---- init + construction (Phase 2 — unchanged) ----
const wasm = await init();                             // top-level-await: Chromium >=89
const term = new Terminal(24, 80, 10_000);             // #[wasm_bindgen(constructor)]

// ---- Phase 3 renderer + chrome wiring ----
await bootRenderer({ wasm, term });

const terminalWrapper = document.getElementById('terminal-wrapper');
// Epic E1 Story E1.4 — #theme-toggle / #phosphor-group retired to the View menu
// (menu-bar.js owns the actions now, AD-7). Their module consts, wireChrome
// args, applyPrefs mirrors, and D-19 capture listeners are all removed with
// them. Epic E1 Story E1.5 — #font-select + the two Clear buttons are likewise
// retired to the View menu; #top-bar keeps Connect (E2) / Send file (E3) / the
// paste-progress row (E7) until #top-bar is removed in E7.
const bellOverlay     = document.getElementById('bell-overlay');
// Epic E1 Story E1.4 — the shared post-theme hook for the theme-change sites that
// do NOT fan out to prefs subscribers: the Ctrl+Alt+T chord (via wireChrome) and
// the View ▸ Theme menu action (via wireMenuBar). savePrefs does not notify
// subscribers, so without this a chord fired while View is open would leave a
// stale theme ✓ / stale-enabled Phosphor+Font (AD-9 violation). It re-derives the
// View menu so an ALREADY-OPEN menu reflects the new theme (Theme ✓ moves,
// Phosphor AND Font disabled state). The applyPrefs boot/reset path does NOT call
// this — resetPrefs()/boot re-project via the dedicated menuBar.projectPrefs
// subscriber instead (one projection per fan-out). Every caller persists via
// savePrefs BEFORE invoking this, and savePrefs updates the cached blob
// synchronously (AD-4), so projectPrefs()'s getPrefs() read already reflects the
// new theme. projectPrefs is idempotent and no-ops when View is absent.
function onThemeChange() {
    menuBar.projectPrefs();
}
// Epic E1 Story E1.5 (FR-10 / AD-6) — imperative zoom→status-bar push hook. E4.2
// gave it a live destination: it pushes the level to status-bar.js's #status-zoom
// readout. It also records the last pushed level (+ a call count) on
// window.__zoomPush so the Playwright suite can prove the hook fires from BOTH the
// View ▸ Zoom items and the Ctrl+{=,-,0} chord (view-font-zoom-clear.spec.js) —
// those bookkeeping lines MUST stay (E1.5 specs assert them). The window.__statusBar
// guard keeps a pushZoom fired before the bar is wired (a boot applyPrefs) harmless.
window.__zoomPush = { last: null, count: 0 };
function pushZoom(level) {
    window.__zoomPush.last = level;
    window.__zoomPush.count += 1;
    if (window.__statusBar) window.__statusBar.setZoom(level);   // E4.2 (AD-6) — live #status-zoom
}
// Epic E1 Story E1.5 (FR-11) — Clear Scrollback… deliberate-friction confirm.
// menu-bar.js owns the wipe (clearScrollback); main.js owns the modal so modal.js
// stays out of menu-bar's import set (AD-3). Cancel is default-focused (Enter is
// the safe choice on a destructive action); focus restores to the terminal on
// close (NFR-1). Resolves true ONLY when the user confirms ('confirm' returnValue).
const clearScrollbackConfirmEl = document.getElementById('clear-scrollback-confirm');
function confirmClearScrollback() {
    if (!clearScrollbackConfirmEl) return Promise.resolve(true);   // no markup — don't break the feature
    const cancelBtn = document.getElementById('clear-scrollback-confirm-cancel');
    return openModal(clearScrollbackConfirmEl, {
        initialFocus: cancelBtn,
        restoreTo: terminalWrapper,
    }).then((rv) => rv === 'confirm');
}
// Epic E2 Story E2.3 (FR-15, AD-8, AD-3) — Serial Configuration modal opener,
// injected into wireMenuBar (menu-bar.js must not import modal.js/serial.js). The
// controls inside #serial-config-modal are the SAME id-keyed elements serial.js
// already wires via serialConfigEls — this opener only surfaces the <dialog>. It is
// a non-destructive live-settings modal: changes persist immediately (existing
// change→savePrefs listeners) and apply on the next Connect, so there is no
// affirmative "apply" — Close/Esc resolve 'close'/'' and the caller ignores the
// returnValue (nothing to act on). initialFocus = the Baud select (first form
// control — compliant with the modal.js returnValue policy for non-destructive
// modals); restoreTo = terminalWrapper (focus round-trips on close, NFR-1/AD-10).
// Shaped as a zero-arg opener returning the openModal promise so E4's status-bar
// recent-errors affordance can reuse it verbatim.
// The three chrome modals (Serial Configuration / Reserved-Ctrl info / SLIDE File
// Transfer) share ONE opener contract, injected into wireMenuBar (menu-bar.js must
// not import modal.js): null-guard to a resolved '' on a harness with no markup,
// focus a named control on open, and round-trip focus to #terminal-wrapper on close
// (NFR-1/AD-10). initialFocus is looked up by id at call time (id-keyed markup); the
// non-destructive returnValue ('close'/'') is ignored by every caller. `onOpen` runs
// just before showModal for the modals that need a pre-open sync. A shared factory
// keeps the contract in one place (a fourth modal — E6.2 Help ▸ About — is one line).
function makeModalOpener(modalEl, initialFocusId, onOpen) {
    return () => {
        if (!modalEl) return Promise.resolve('');   // no markup — harness; don't throw
        if (onOpen) onOpen();
        return openModal(modalEl, {
            initialFocus: document.getElementById(initialFocusId),
            restoreTo: terminalWrapper,
        });
    };
}
// E2.3 — Serial Configuration modal; initialFocus = Baud (first form control).
const serialConfigModalEl = document.getElementById('serial-config-modal');
const openSerialConfig = makeModalOpener(serialConfigModalEl, 'serial-baud');
// E3.3 (FR-21) — Reserved-Ctrl info modal; initialFocus = Close (no destructive default).
const reservedCtrlModalEl = document.getElementById('reserved-ctrl-modal');
const openReservedCtrl = makeModalOpener(reservedCtrlModalEl, 'reserved-ctrl-close');
// E6.1 (FR-24) — Keyboard Shortcuts info modal; initialFocus = Close (no destructive default).
const keyboardShortcutsModalEl = document.getElementById('keyboard-shortcuts-modal');
const openKeyboardShortcuts = makeModalOpener(keyboardShortcutsModalEl, 'keyboard-shortcuts-close');
// E3.4 (FR-20) — SLIDE File Transfer modal; initialFocus = Save-to-folder checkbox.
// onOpen re-projects the auto-send validity cue from the LIVE stored command (not the
// boot snapshot — the hint lives in this modal and the use-time gate fires while closed).
const slideConfigModalEl = document.getElementById('slide-config-modal');
const openSlideConfig = makeModalOpener(slideConfigModalEl, 'slide-recv-to-folder-checkbox',
    () => syncAutoSendValidity(getPrefs()?.slideAutoSendCommand || ''));
// Phase 4 Plan 03 — Settings pane + Debug TX strip refs.
const localEchoCheckbox = document.getElementById('local-echo');
const crlfRadios        = document.querySelectorAll('input[name="crlf"]');
const txStripEl         = document.getElementById('tx-strip');
const txResetButton     = document.getElementById('tx-reset');
const TX_STRIP_PLACEHOLDER = '(none yet — press any key on the terminal to see TX bytes)';
// E5.1 (FR-23, AD-11, AD-14) — the in-page debug panel is the ONE persistent chrome
// element toggled from Debug ▸ Show Debug Panel. main.js owns the panel node (no
// separate module — AD-2 proportionality; a show/hide over a DOM node menu-bar may
// not import). setDebugPanelVisible is the SINGLE writer of the panel's live
// visibility: injected into wireMenuBar (called from the checkable toggle) AND called
// by applyPrefs on boot/reset. With the #debug:not([open]) CSS, open=false ⇒ fully
// invisible. It is also what keeps every `el.open = true` test fixture working verbatim.
const debugEl = document.getElementById('debug');
const setDebugPanelVisible = (v) => { if (debugEl) debugEl.open = v; };
// E4.2 — the build-info import/projection block relocated below the status-bar
// wire (it now feeds #status-build via statusBar.setBuild); see after
// `window.__statusBar = statusBar`. window.__buildInfo is still set there for the
// console reader + Help ▸ About (E6.2).
// Phase 5 — Connection pane DOM refs (see www/index.html Plan 02 Wave 1).
// E2.1 (AD-15) — the #connect-button ref moved to menu-bar.js (the sole writer +
// click owner via its own getElementById); main.js no longer holds it.
const connectionPane    = document.getElementById('connection');
// E4.1 (AD-15) — #port-status relocated into #status-bar, now owned solely by
// status-bar.js. serial.js no longer projects it, so main.js no longer fetches it
// or passes it to wireSerial. serial.js's dead updatePortStatus* writers were
// removed (E4.1 review fix #8); the device/framing readout is served to the status
// bar via the getConnectionDevice/getActiveFraming getters instead.
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
    terminalWrapper, bellOverlay, requestFrame,
    // Epic E1 Story E1.3 (AD-13) — the two Clear buttons moved OUT of chrome.js
    // into menu-bar.js, so `term` / `getScrollState` no longer belong here.
    // `requestFrame` STAYS (the visibilitychange catch-up repaint still uses it).
    // Epic E1 Story E1.4 (AD-13) — theme/phosphor controls retired to the View
    // menu; only the Ctrl+Alt+T / zoom chords stay here. onThemeChange re-projects
    // the open View menu after the chord (E1.5 removed its #font-row hide-gate).
    onThemeChange,                              // E1.4 — re-project the open View menu after the chord
    pushZoom,                                   // E1.5 (AD-6) — feed the status bar from the zoom chord
    prefs,                                      // Phase 6 Plan 06 — Auto connect checkbox initial state
    savePrefs,                                  // Phase 6 Plan 06 — persist Auto connect + the Ctrl+Alt+T chord theme change
    resetPrefs,                                 // Phase 6 Plan 06 — Reset all preferences 2-click confirm
    isSlideActive: isSlideActive,               // Phase 11 D-13 — predicate gate for CTRL_CAN branch
    cancelSlideRecv: () => cancelSlideRecvLazy(),  // Phase 11 D-13 — thunk-holder; resolved below
    txSink: { writeSlideFrame, writeSlideFrameAwaitable },  // Phase 11 D-13 — fire-and-forget CTRL_CAN
});

// ---- Epic E1 Story E1.1 — menu-bar shell ----
// Wired at the wireChrome seam (AD-12), AFTER wireChrome and BEFORE
// wireKeyboard, so chrome.js's #terminal-wrapper keydown listener still
// registers ahead of keyboard.js and its defaultPrevented short-circuit keeps
// winning on chords. menu-bar.js registers NO keydown handler this story
// (Esc-passthrough guard + keyboard nav are E1.2), so paste-cancel / SLIDE-
// cancel are unaffected. The bar is additive — it COEXISTS with #top-bar and
// the <details> panes (Scope Decision); nothing incumbent is removed here.
// Epic E1 Story E1.3 (AD-13) — menu-bar.js is now the sole owner of the two
// incumbent Clear buttons, so it receives the same term / getScrollState /
// requestFrame opts chrome.js used to hold. getScrollState is a THUNK because
// scrollState is wired below (scrollStateRef late-binds at :282), after this
// call — the Clear handlers resolve the live ref at click time.
const menuBar = wireMenuBar({
    terminalWrapper,
    term,
    getScrollState: () => scrollStateRef,
    requestFrame,
    // Epic E1 Story E1.4 — View ▸ Theme re-projects the menu (shared onThemeChange
    // hook), and Theme/Phosphor/Zoom actions clear the selection (D-19 rehomed).
    // clearSelection is a thunk: `selection` is wired further below, so the live
    // ref resolves at click time (same late-bind pattern as getScrollState).
    onThemeChange,
    clearSelection: () => selection.clearSelection(),
    // Epic E1 Story E1.5 — View ▸ Zoom pushes the new level to the status bar
    // (E4 consumer; no-op stub now), and View ▸ Clear Scrollback… runs the
    // deliberate-friction confirm before the wipe (main.js owns the modal, AD-3).
    pushZoom,
    confirmClearScrollback,
    // Epic E2 Story E2.3 (FR-15, AD-3/AD-8) — Connection ▸ Serial Configuration…
    // opens the #serial-config-modal. main.js owns openModal (modal.js stays out of
    // menu-bar's import set), so the opener is injected like confirmClearScrollback.
    openSerialConfig,
    // Epic E3 Story E3.1 (FR-16/FR-17, AD-3) — File ▸ Send File… and Download
    // Session Log. sendFile opens the existing picker→#send-modal path;
    // downloadSessionLog / getSessionLogBytes are session-log's existing exports;
    // sessionLogTooltips single-sources the row's tooltip copy (AC-4). menu-bar
    // reaches file-source + session-log ONLY across this seam (it imports neither).
    sendFile: openSendPicker,
    downloadSessionLog: sessionLogDownload,
    getSessionLogBytes: sessionLogBytes,
    sessionLogTooltips: SESSION_LOG_TOOLTIPS,
    // Epic E2 Story E2.1 (AD-15) — the Connect item is now menu-bar-owned. Inject
    // the serial machine's subscribe/read/toggle so menu-bar can be the sole
    // writer of every Connect surface without importing serial.js (AD-3).
    onConnectionStateChange: onStateChange,
    getConnectionState: getState,
    toggleConnection,
    // Epic E2 Story E2.2 (AD-3, FR-13/FR-14) — the adapter-count gate for
    // "Choose MicroBeast…" and the filtered picker it opens, injected across the
    // same seam (menu-bar cannot import serial). getAdapterCount is async +
    // no-throw; chooseMicroBeast reuses the same filtered picker (requestMicroBeastPort).
    getAdapterCount: countMicroBeastAdapters,
    // Disconnect-first when already connected (§"Choose MicroBeast… click
    // behavior" open Q#2): a bare connectMicroBeast() while connected would open a
    // second port and leak the old writer/read loop when a different board is
    // picked. Tearing the existing connection down first makes "choose which board"
    // a clean switch.
    //
    // Ordering matters: requestPort() needs transient user activation (Chromium
    // ~5 s) but open() does not, so run the PICKER FIRST — while the click's
    // activation is still fresh — then fully await the teardown, then open the
    // already-chosen port. This keeps a single linear sequence (no teardown racing
    // the connect over shared module state), so a stalled port.close() can never
    // leave a gray "Not connected" over a live port, and a cancelled picker leaves
    // the existing connection untouched (nothing is torn down until the user has
    // actually chosen a new board).
    chooseMicroBeast: async () => {
        let selectedPort;
        try {
            selectedPort = await requestMicroBeastPort();
        } catch (err) {
            return;   // picker cancelled / no match — keep the current connection
        }
        if (getState() === 'connected') await disconnect();
        connectMicroBeast(undefined, selectedPort);
    },
    // Epic E3 Story E3.2 (FR-18/FR-19, AD-3) — Settings ▸ Local echo / Enter-key-sends
    // drive the SAME keyboard.js live setters the legacy #local-echo / #crlf-* controls
    // call. Injected (menu-bar cannot import keyboard.js — AD-3); persist ≠ apply, so the
    // menu handler calls the setter AND savePrefs, exactly as the legacy handlers do.
    setLocalEcho,
    setCrlfMode,
    // Epic E5 Story E5.1 (FR-23, AD-3/AD-11) — Debug ▸ Show Debug Panel drives the
    // panel's live visibility. Injected (menu-bar owns no panel node and may not import
    // one — AD-3); persist ≠ apply, so the menu handler calls this setter AND savePrefs.
    setDebugPanelVisible,
    // Epic E3 Story E3.3 (FR-21/FR-22, AD-3) — Settings ▸ Reset all preferences drives
    // the SAME resetPrefs() the legacy #reset-prefs-button calls (already imported :31,
    // already injected into wireChrome :321); Browser-reserved Ctrl combinations… opens
    // the #reserved-ctrl-modal via openModal. Both injected (menu-bar imports neither
    // prefs.resetPrefs nor modal.js — AD-3).
    resetPrefs,
    openReservedCtrl,
    // Epic E6 Story E6.1 (FR-24, AD-3/AD-8) — Help ▸ Keyboard Shortcuts… opens the
    // #keyboard-shortcuts-modal via openModal. Injected like openReservedCtrl (menu-bar
    // imports neither modal.js nor this opener — AD-3).
    openKeyboardShortcuts,
    // Epic E3 Story E3.4 (FR-20, AD-3/AD-8) — Settings ▸ SLIDE File Transfer… opens the
    // #slide-config-modal via openModal. Injected like openSerialConfig / openReservedCtrl
    // (menu-bar imports neither modal.js nor slide*.js — AD-3).
    openSlideConfig,
});
window.__menuBar = menuBar;   // Playwright hook (mirrors window.__scrollState / window.__modal)

// ---- Epic E4 Story E4.1 (FR-26, AD-6/AD-12) — wire the bottom status bar ----
// A connection projector fed by the same serial.onStateChange truth as menu-bar
// (AD-5); single writer of #status-conn-dot + #port-status. Slotted at the
// wireChrome seam AFTER wireMenuBar and BEFORE wireKeyboard (AD-12). serial's
// onStateChange/getState arrive via opts (AD-3 — status-bar.js never imports
// serial.js). The E4.2 build/zoom readout will hang its own hooks off this.
const statusBar = wireStatusBar({
    onConnectionStateChange: onStateChange,
    getConnectionState: getState,
    // E4.1 fix (#2) — the connected readout's framing must be the framing the LIVE
    // port was opened with, not getPrefs().serial (which can diverge after an
    // in-session serial-config change awaiting reconnect). serial.js owns lastConfig.
    getConnectionFraming: getActiveFraming,
    // E4.1 fix (#4) — surface the most-recent connect-time failure in the readout so
    // a failed Connect is visible (the D-27 pane auto-expand was removed; the
    // disconnected dot is gray by design). serial.js owns the message.
    getConnectionError: getLastConnectError,
    // E4.1 fix (#7) — the device label reflects the ACTUAL connected/granted adapter
    // (canonical only on a real CP2102N match), not a hardcoded MicroBeast string.
    getConnectionDevice,
    // E4.3 (FR-28, AD-8/AD-3) — the recent-errors affordance opens the EXISTING Serial
    // Configuration modal (which hosts #error-log) by reusing openSerialConfig verbatim
    // (defined above, focus → #serial-baud, restoreTo → terminalWrapper), and reads
    // getRecentErrorCount for its initial paint. status-bar.js imports neither
    // modal.js nor serial.js (AD-3) — both arrive here as injected opts.
    openSerialConfig,
    getRecentErrorCount,
});
window.__statusBar = statusBar;   // Playwright hook (mirrors window.__menuBar)

// E4.2 (FR-27, AD-6) — route the build stamp into the status bar's #status-build
// (its permanent home, alongside Help ▸ About/E6.2 — no longer the Debug pane).
// build-info.js is emitted by scripts/build.sh into pkg/ (gitignored, regenerated
// per build); loaded dynamically with a fallback so a build that skipped build.sh
// (raw wasm-pack per www/README.md) still boots — the stamp just reads "unbuilt".
// Relocated below the statusBar wire so `statusBar` is initialized when the import
// resolves (a later microtask); status-bar.js must NOT import build-info (AD-3) —
// the SHA arrives via this imperative setBuild push. window.__buildInfo is retained
// for the console reader + Help ▸ About (E6.2), which read the SAME stamp.
import('./pkg/build-info.js')
    .then(({ BUILD_INFO }) => {
        window.__buildInfo = BUILD_INFO;
        statusBar.setBuild(BUILD_INFO);
    })
    .catch(() => {
        // One fallback object, fed to both readers (console + Help ▸ About via
        // __buildInfo, and the bar via setBuild) so the "unbuilt" wording can never
        // drift between them.
        const fallback = { sha: 'unknown (unbuilt)', builtAt: null };
        window.__buildInfo = fallback;
        statusBar.setBuild(fallback);
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
// Epic E1 Story E1.5 — read-only canvas state for the View ▸ Font / Zoom oracles
// (mirrors the window.__prefs read pattern; never a live DOM ref).
window.__canvasState = { getActiveFont, getActiveZoom, getActiveTheme, getActivePhosphor };
// Epic E3 Story E3.2 — read-only keyboard state for the Settings ▸ Local echo /
// Enter-key-sends oracles (mirrors window.__canvasState). Lets a test assert the
// LIVE keyboard.js module state actually changed (persist ≠ apply — the setter, not
// just savePrefs, ran); never a setter surface.
window.__keyboardState = { getLocalEcho, getCrlfMode };

// D-19 — selection clears on theme/phosphor/zoom change. Epic E1 Story E1.4 —
// the theme/phosphor D-19 capture listeners on #theme-toggle / #phosphor-group
// are GONE with those controls; the View ▸ Theme / Phosphor menu actions now
// clear the selection via the injected clearSelection opt (wireMenuBar above),
// matching the incumbent click-driven behavior. The Ctrl+Alt+T chord is
// unchanged (it never cleared the selection). The zoom keyboard chord below is
// still owned by chrome.js, so its D-19 capture listener stays here.
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
// E3.1 (AC-5/AC-7) — onStateChange re-projects the File ▸ Download Session Log
// menu row on the first-byte enable and the reset-to-disabled. menuBar is defined
// above (:338), so the ref exists; projectSessionLog reads the live byte count
// itself (the enabled arg is unused here). Keeps session-log the sole writer of
// its button and menu-bar the sole writer of its row.
wireSessionLog({
    downloadButton: downloadLogBtn,
    onStateChange: () => menuBar.projectSessionLog?.(),
});
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
    // Phase 12 UAT Gap D — chip [Cancel] dispatches by current SLIDE mode.
    // Send-side cancel (cancelSlideSend) was previously absent — onCancel
    // routed only to cancelSlideRecv whose !isSlideActive() guard
    // short-circuits in send mode, leaving force-start (and any
    // wakeup-completion) active-state cancels as dead buttons.
    onCancel: () => {
        const state = __slideGetStateForTests();
        if (state && state.mode === 'send') {
            cancelSlideSend();   // imported from transport/slide.js (resolved at module load)
        } else {
            cancelSlideRecvLazy();   // thunk-holder — resolved after wireSlideRecv
        }
    },
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
    savePrefs,                                  // Phase 12 SLIDE-38 — first-use-confirm chip writes
                                                //   slideAutoSendCommandConfirmed on [Confirm] /
                                                //   resets prefs on [Reset to default]
    wrapperEl: terminalWrapper,                 // Phase 12 UAT Niggle 1 — refocus terminal-wrapper
                                                //   after cancelSlideSend so [data-focused] border re-paints
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
const slideConfirmTransfersCheckbox = document.getElementById('slide-confirm-transfers-checkbox');
const slideCompatSelect = document.getElementById('slide-compat-select');

// Phase 12 SLIDE-38 / E4.2 review — project an auto-send command's safety onto its
// input cue (#slide-auto-send-input [data-invalid]/[aria-invalid]) and the inline
// validation hint. Single source for all four sync sites (boot hydration, the input
// change handler, applyPrefs on reset, AND openSlideConfig) so the three formerly
// hand-copied toggles can't drift. Re-projecting on modal OPEN is what makes the
// diagnostic reachable when it matters: the hint lives inside #slide-config-modal, so
// the use-time gate that fires during a receive (slide.js, modal closed) is never seen
// live — but any user who opens Settings ▸ SLIDE File Transfer to inspect/fix the
// command now always sees its current unsafe state. `cmdWithCr` is the stored form
// (trailing \r included); isAutoSendSafe is no-throw-wrapped so a validator error
// never blocks the paint. Visual ONLY — never blocks savePrefs (save-time validation
// is forbidden; slide.js readAutoSendCommandBytes is the wire-safety boundary).
function syncAutoSendValidity(cmdWithCr) {
    const inputEl = document.getElementById('slide-auto-send-input');
    const hintEl = document.getElementById('slide-auto-send-validation-hint');
    let safe = true;
    try { safe = isAutoSendSafe(cmdWithCr); } catch { safe = true; }
    if (inputEl) {
        if (safe) {
            inputEl.removeAttribute('data-invalid');
            inputEl.removeAttribute('aria-invalid');
        } else {
            inputEl.setAttribute('data-invalid', 'true');
            inputEl.setAttribute('aria-invalid', 'true');
        }
    }
    if (hintEl) hintEl.hidden = safe;
}

if (slideAutoSendInput) {
    // Display value WITHOUT trailing \r — D-06: \r is appended at save time, not displayed.
    const stored = prefs.slideAutoSendCommand || '';
    slideAutoSendInput.value = stored.endsWith('\r') ? stored.slice(0, -1) : stored;

    // Phase 12 SLIDE-38 — boot-time data-invalid sync. If the persisted value
    // is unsafe (e.g. user reloaded after typing a bad command in a previous
    // session), set the visual cue immediately on first paint so the user sees the
    // rejection state without waiting for a Send-file click (UAT Gap A — hint too).
    syncAutoSendValidity(stored);

    slideAutoSendInput.addEventListener('change', (e) => {
        const v = e.target.value;
        // D-06 — append \r at save time. Empty string disables auto-type per
        // SLIDE-13 semantic (preserves Phase 9 D-14 logic; Plan 11-03 swaps
        // the source from a hardcoded constant to prefs.slideAutoSendCommand).
        const cmdWithCr = v.length === 0 ? '' : v + '\r';

        // Phase 12 SLIDE-38 — Settings input visual cue (12-UI-SPEC §E). Visual
        // ONLY — savePrefs below still persists an unsafe value (save-time
        // validation is forbidden; slide.js readAutoSendCommandBytes is the wire
        // boundary). UAT Gap A wants the hint on blur too, not just at use-time.
        syncAutoSendValidity(cmdWithCr);

        // Persist + re-arm first-use confirmation (any change to the auto-send
        // command resets slideAutoSendCommandConfirmed to '' so the next
        // session-start surfaces the chip per 12-UI-SPEC §C transition table).
        savePrefs({
            slideAutoSendCommand: cmdWithCr,
            slideAutoSendCommandConfirmed: '',
        });
    });
}

if (slideShowSummaryCheckbox) {
    slideShowSummaryCheckbox.checked = !!prefs.slideShowSummary;
    slideShowSummaryCheckbox.addEventListener('change', (e) => {
        savePrefs({ slideShowSummary: !!e.target.checked });
    });
}

// v1.1 polish (260513-grs Task 2) — Confirm file transfers boot mirror + change listener.
// Default ON preserves Phase 9/12 modal flow. When toggled OFF, www/input/file-source.js
// processFiles skips showConfirmModal entirely (collisions auto-rename via the
// SLIDE-36 applyCollisionRenames helper). Defensive `!== false` matches the
// slideAssertRtsOnConnect / slideShowSummary precedent.
if (slideConfirmTransfersCheckbox) {
    slideConfirmTransfersCheckbox.checked = (prefs.slideConfirmTransfers !== false);
    slideConfirmTransfersCheckbox.addEventListener('change', (e) => {
        savePrefs({ slideConfirmTransfers: !!e.target.checked });
    });
}

if (slideCompatSelect) {
    const v = prefs.slideCompatibilityMode || 'auto';
    if (['auto', 'wakeup-required', 'force-start'].includes(v)) {
        slideCompatSelect.value = v;
    }
    slideCompatSelect.addEventListener('change', (e) => {
        savePrefs({ slideCompatibilityMode: e.target.value });
        // E3.4 (Q3) — the compat select now lives inside the focus-trapped
        // #slide-config-modal. The Phase 4 D-16 terminal-restore-on-change was
        // dropped here: restoring focus to #terminal-wrapper mid-modal fights the
        // native <dialog> focus trap (E2.3 removed an analogous in-modal restore for
        // the same reason). Focus returns to the terminal only on close, via the
        // openModal restoreTo. The change→savePrefs write is unchanged.
    });
}

// Phase 12.1 Plan 12-08 — assert-RTS-on-connect Settings checkbox
// (default true; gates connect-time setSignals.requestToSend in
// www/transport/serial.js). Boot value mirrors prefs; change persists
// via savePrefs. Read live by serial.js's getPrefs() at every
// port.open() — no reconnect-required hint needed because the next
// Connect click picks up the new value.
const serialAssertRtsCheckbox = document.getElementById('serial-assert-rts-on-connect-checkbox');
if (serialAssertRtsCheckbox) {
    // Boot-time mirror — DEFAULTS is true so an unset/older blob shows checked.
    serialAssertRtsCheckbox.checked = (prefs.serialAssertRtsOnConnect !== false);
    serialAssertRtsCheckbox.addEventListener('change', (e) => {
        savePrefs({ serialAssertRtsOnConnect: !!e.target.checked });
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
    __isAutoSendSafeForTests: __slideIsAutoSendSafeForTests,   // Phase 12 SLIDE-38
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
// Phase 12 SLIDE-36 — three-action button row (collision-mode footer).
const sendModalSendRenamedButton = document.getElementById('send-modal-send-renamed');
const sendModalFirstOnlyButton   = document.getElementById('send-modal-first-only');
const sendModalRefuseButton      = document.getElementById('send-modal-refuse');

// Phase 11 Plan 11-03 — extended opts: slideChip (D-10 — flashDropRejected
// at onDragEnter + onDrop call sites when isSessionActive() returns true).
// Phase 12 SLIDE-36 — three new modal action buttons (collision-mode footer).
// Phase 12 SLIDE-12 — clearSelectionFn (post-drop ghost-clear; companion to
// Plan 12-01's selection.js early-return). The closure captures the existing
// `selection` const wired further up the boot flow (line ~251 wireSelection
// return value); ordering invariant — wireSelection MUST run before
// wireFileSource so the local is bound when the closure is created.
// try/catch wrapper is mandatory: if selection.clearSelection throws (e.g.,
// during teardown in tests), the drop should still complete (T-12-10).
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
    // Phase 12 SLIDE-36 — three new modal buttons (hidden by default;
    // file-source.js toggles visibility at modal-open time based on
    // collisionRows.length > 0).
    modalSendRenamedBtn: sendModalSendRenamedButton,
    modalFirstOnlyBtn:   sendModalFirstOnlyButton,
    modalRefuseBtn:      sendModalRefuseButton,
    // Phase 12 SLIDE-12 — post-drop selection clear.
    clearSelectionFn: () => { try { selection.clearSelection(); } catch { /* ignore */ } },
    // E3.1 review fix (#6) — re-project the File ▸ Send File… menu row whenever the
    // send gate flips, so it stays correct while the File menu is held open (mirrors
    // the Download Session Log row's session-log onStateChange hook). menuBar is
    // defined above (:380), so the ref exists.
    onSendGateChange: () => menuBar.projectSendFile?.(),
});

// Test introspection (mirrors Phase 8 + Plan 09-02 window.__* precedent).
// Plan 09-04 Playwright specs read via window.__fileSource.__getStateForTests()
// to assert drag depth + drop-target state + modal-open state + button label.
window.__fileSource = {
    __resetForTests: __fileSourceResetForTests,
    __getStateForTests: __fileSourceGetStateForTests,
    // Phase 12 SLIDE-36 — pure helper exposed for Playwright unit-style tests
    // (slide-collisions.spec.js 12-collision / 100-collision / no-extension cases).
    computeRenameScheme: fileSourceComputeRenameScheme,
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

// Epic E0 Story E0.1 (AD-10) — retainFocus test-hook introspection for the
// focus-helper.spec.js chromium suite.
window.__focus = {
    __resetForTests: __focusResetForTests,
    __getStateForTests: __focusGetStateForTests,
};

// Epic E0 Story E0.2 (AD-8) — openModal test-hook introspection for the
// modal.spec.js chromium suite.
window.__modal = {
    __resetForTests: __modalResetForTests,
    __getStateForTests: __modalGetStateForTests,
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
    // Epic E2 Story E2.1 (AD-15) — serial.js no longer writes any Connect DOM, so
    // it no longer receives connectButton. The multi-adapter "Choose MicroBeast…"
    // out-of-band label is surfaced through menu-bar (the sole writer) via this
    // signal instead of a direct button write (AC-4).
    signalConnectLabel: menuBar.signalConnectLabel,
    connectionPane,
    // E4.1 (AD-15) — portStatusEl dropped: #port-status is now owned by status-bar.js
    // (fed by the same onStateChange). serial.js's dead updatePortStatus* writers were
    // removed (E4.1 review fix #8).
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
    // E4.1 fix (#3) — when the boot getPorts() scan finds an already-granted
    // MicroBeast, show the "…— click Connect" cue in the status bar (statusBar is
    // wired above, so the ref exists by the time this async boot scan runs).
    onBootDeviceRecognized: () => statusBar.showBootReady(),
    // E4.3 (FR-28, AD-6) — imperative push to the status-bar recent-errors affordance
    // on every appendErrorLog. Mirrors onBootDeviceRecognized: serial.js owns the
    // errorLog mutation and fires this; the closure calls statusBar.setErrorCount
    // (statusBar is wired above, so the ref exists by the time an error can fire).
    onErrorLogChange: (count) => statusBar.setErrorCount(count),
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
// Checkbox / select DOM mirrors, applied on the boot + resetPrefs() fan-out. Driven
// by a TABLE (not a hand-written line per control) so adding a pref to DEFAULTS can't
// silently skip its reset mirror — the exact drift the E3.4 "review fix #5" block had
// to patch after four SLIDE-modal controls were added to DEFAULTS but not to applyPrefs
// (a reset then defaulted the blob while the controls kept showing — and re-persisting —
// stale values). Only pure DOM mirrors live here; the live-effect setters
// (theme/phosphor/font/zoom/localEcho/debug-panel/crlf) stay explicit in applyPrefs.
//   kind 'bool'        → el.checked = !!p[key]
//   kind 'boolDefault' → el.checked = p[key] !== false   (default-ON prefs)
//   kind 'select'      → el.value   = p[key]  when it is one of `allowed`
const PREF_CONTROL_MIRRORS = [
    { id: 'local-echo',                            key: 'localEcho',                kind: 'bool' },
    { id: 'auto-connect-checkbox',                 key: 'autoConnect',              kind: 'bool' },
    { id: 'show-all-serial-devices',               key: 'showAllSerialDevices',     kind: 'bool' },
    { id: 'serial-assert-rts-on-connect-checkbox', key: 'serialAssertRtsOnConnect', kind: 'boolDefault' },
    { id: 'slide-confirm-transfers-checkbox',      key: 'slideConfirmTransfers',    kind: 'boolDefault' },
    { id: 'slide-recv-to-folder-checkbox',         key: 'slideRecvToFolder',        kind: 'bool' },
    { id: 'slide-show-summary',                    key: 'slideShowSummary',         kind: 'bool' },
    { id: 'slide-compat-select',                   key: 'slideCompatibilityMode',   kind: 'select',
      allowed: ['auto', 'wakeup-required', 'force-start'] },
];
function applyControlMirrors(p) {
    for (const m of PREF_CONTROL_MIRRORS) {
        const el = document.getElementById(m.id);
        if (!el) continue;   // control absent (harness / not-yet-mounted) — skip, no throw
        if (m.kind === 'bool') el.checked = !!p[m.key];
        else if (m.kind === 'boolDefault') el.checked = p[m.key] !== false;
        else if (m.kind === 'select' && m.allowed.includes(p[m.key])) el.value = p[m.key];
    }
}

// applyPrefs re-applies the loaded prefs to chrome / canvas / keyboard state.
// Fires on every flushPrefs (after debounce) AND on resetPrefs() — the latter
// is how the Settings 'Reset all preferences' 2-click confirm restores defaults
// in-place WITHOUT a page reload (D-35). Serial config is NOT applied live —
// Phase 5 D-08 reconnect-required hint owns "config changed mid-connection."
// Auto-connect toggle takes effect on NEXT page load (D-34); no immediate connect.
function applyPrefs(p) {
    setTheme(p.theme);   // AD-14 single-writer; also sets body[data-theme] (E1.4 Task 1, canvas.js)
    // Epic E1 Story E1.3 (AD-14) — decomposition: single-writer per canvas
    // setter. Each canvas setter (setTheme/setPhosphor/setFont/setZoom) is
    // called from EXACTLY ONE place on this reset path (menu-bar.projectPrefs
    // owns the View menu projection and must never call a canvas setter, so no
    // double-apply race).
    // Epic E1 Story E1.4 — the #theme-toggle label + #phosphor-group mirrors and
    // the redundant body[data-theme] set are GONE (setTheme is the single writer
    // of the scanline attr now). The View menu's Theme/Phosphor/Font check glyphs
    // + disabled state are re-projected on this reset/boot path by the dedicated
    // menuBar.projectPrefs prefs subscriber (registered below) — NOT re-triggered
    // here, so projectPrefs runs exactly once per fan-out.
    setPhosphor(p.phosphor);
    // Epic E1 Story E1.5 — #font-select retired to the View menu. setFont stays
    // the single-writer on reset (AD-14); the Font submenu radio + its disabled
    // state are re-projected by menuBar.projectPrefs (the second prefs subscriber),
    // NOT here (projectPrefs must never call a canvas setter).
    if (p.font) setFont(p.font);
    setZoom(p.fontZoom);
    // E1.5/E4.2 (AD-6) — feed the status bar the CLAMPED applied level, not the raw
    // stored pref: canvas.setZoom clamps to [1,4] but loadPrefs does not, so a
    // corrupt/hand-edited/future-schema fontZoom (e.g. 6 or 0) would render the
    // terminal at the clamped level while the readout showed the raw one. Read it
    // back from getActiveZoom() so the readout and the render can never disagree
    // (matches the chord path, which already pushes getActiveZoom()).
    pushZoom(getActiveZoom());
    setLocalEcho(p.localEcho);
    // E5.1 (AC-3/AC-6) — applyPrefs is the SINGLE writer of the debug panel's live
    // visibility on the reset/boot path (the menu toggle owns it on click). At boot
    // (applyPrefs(prefs) below) this applies the default OFF ⇒ fully invisible; on
    // resetPrefs() fan-out it restores OFF. menuBar.projectPrefs re-derives only the row.
    setDebugPanelVisible(p.showDebugPanel);
    setCrlfMode(p.crlfMode);
    for (const radio of crlfRadios) {
        radio.checked = (radio.value === p.crlfMode);
    }
    // Pure checkbox / select DOM mirrors — driven by the PREF_CONTROL_MIRRORS table
    // (defined above applyPrefs) so every mirrored control is restored on the boot +
    // resetPrefs() fan-out without a hand-written line each (the drift the E3.4 review
    // fix #5 had to patch). Covers local-echo, auto-connect, show-all-serial-devices,
    // assert-RTS, confirm-transfers, and the three SLIDE-modal controls. chrome.js /
    // keyboard.js own the change listeners; applyPrefs only mirrors the stored value.
    applyControlMirrors(p);
    // slide-auto-send-input is NOT a pure mirror (strips the trailing \r + re-syncs the
    // validity cue), so it stays explicit below.
    const slideAutoSendRef = document.getElementById('slide-auto-send-input');
    if (slideAutoSendRef) {
        // Display value strips the trailing \r (appended at save time — D-06), mirroring
        // the boot hydration above.
        const cmd = p.slideAutoSendCommand || '';
        slideAutoSendRef.value = cmd.endsWith('\r') ? cmd.slice(0, -1) : cmd;
        // Re-sync the SLIDE-38 validity cue so a reset to the (safe) default clears any
        // stale [data-invalid] border + hint left by a previously-typed unsafe command.
        syncAutoSendValidity(cmd);
    }
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

// Epic E1 Story E1.3 (AD-14) — register menu-bar.js as a SECOND prefs
// subscriber. resetPrefs() fans out to both: applyPrefs re-applies canvas +
// chrome state (single-writer per canvas setter), menuBar.projectPrefs
// re-projects the View submenu's menu DOM. The two never fight — projectPrefs
// touches only View *item* state, never a canvas setter (AD-14 no double-apply).
// A no-op today (View submenus are placeholders — E1.4/E1.5 fill the body), but
// the subscription + idempotent/no-throw contract lands now. Called once at
// boot for parity with applyPrefs(prefs) above.
prefsSubscribe(menuBar.projectPrefs);
menuBar.projectPrefs(prefs);

// ---- Boot-complete log ----
console.log('[boot] Harness ready. theme=', getActiveTheme().name, 'phosphor=', getActivePhosphor(), 'zoom=', getActiveZoom());
console.log('[boot] term=', term, 'wasm.memory=', wasm.memory);
