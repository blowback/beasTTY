// Beastty Phase 5 — Web Serial transport (JS-only; no Rust bindings).
//
// Public API: renderPoliteFail, wireSerial, connectMicroBeast, requestMicroBeastPort,
// disconnect, getState, onStateChange, getWriter, toggleConnection, countMicroBeastAdapters.
//
// Epic E2 Story E2.1 (AD-15) — the connect-button DOM *projection* moved OUT of
// this module. serial.js still owns the connection STATE MACHINE (state,
// setState fan-out, onStateChange, getState) but no longer writes any Connect
// DOM. menu-bar.js subscribes to onStateChange and is now the SOLE writer of the
// Connect item / status dot / label / legacy #connect-button. toggleConnection()
// is the exported click action (its state-branch logic stays here — it reads the
// internal `state`); the out-of-band "Choose MicroBeast…" prompt is surfaced via
// the injected opts.signalConnectLabel signal, not a direct button write.
//
// Sources:
//   - 05-CONTEXT.md D-01..D-42.
//   - 05-RESEARCH.md Patterns 1-7 + Example 1.
//   - 05-UI-SPEC.md §"Polite-fail page" (exact copy for renderPoliteFail).
//   - Pitfalls #1 (reader-lock), #6 (bg-tab), #10 (byte-end-to-end), #11 (identity), #12 (DTR/RTS).
//   - Analog: www/renderer/chrome.js (wireX(opts) pattern);
//     www/renderer/canvas.js:37-51 (module-scope state).

import { registerWriter, unregisterWriter } from '../input/tx-sink.js';
import { onPortLost as pastePumpOnPortLost } from '../input/paste-pump.js';
// Phase 8 D-05 + D-06 — route inbound bytes through the SLIDE dispatcher
// instead of directly to term.feed. dispatchInbound is byte-transparent in
// terminal mode (the post-feed invariant at lines 454-462 below is unchanged).
import { dispatchInbound, slidePumpOnPortLost } from './slide.js';
// Phase 11 Plan 11-03 — D-11 session-log gate predicate at the read-loop
// append call site so binary SLIDE frame bytes never reach the per-connection
// log during an active session (T-11-03-log-leak mitigation).
import { isSlideActive } from './slide-recv.js';
// Live read of prefs.showAllSerialDevices at picker time. Cannot use the
// boot-time `prefsRef` snapshot because savePrefs replaces the cached object —
// prefsRef would still point at the original blob and miss subsequent toggles.
import { getPrefs } from '../state/prefs.js';

// Constants -----------------------------------------------------------------
const VID_MICROBEAST = 0x10c4;   // D-02 — Silicon Labs (CP2102N)
const PID_MICROBEAST = 0xea60;   // D-02 — CP2102N
// D-02 — the single MicroBeast identity predicate over a SerialPort.getInfo() result.
// getConnectionDevice() (device labelling) and countMicroBeastAdapters() (the "Choose
// MicroBeast…" gate) both call it, so a second PID / loosened match is changed in ONE
// place and can never drift between how a board is labelled and whether it counts.
const isMicroBeast = (info) =>
    !!info && info.usbVendorId === VID_MICROBEAST && info.usbProductId === PID_MICROBEAST;
const PRESET_CONFIG = Object.freeze({
    baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none',
});
const STORAGE_KEY = 'beastty.port.preset';   // D-31 — localStorage key for VID/PID persistence
const ERROR_LOG_CAP = 5;                          // D-27 — ring-of-5 newest-first
// E2.1 (AD-15) — the Connect-button label map moved to menu-bar.js's
// CONNECT_LABELS (the new sole writer). serial.js no longer projects any label.

// Module-scope state — Wave 2+ populates these via connectMicroBeast/disconnect.
let port = null;
let reader = null;
let writer = null;
let state = 'disconnected';
let lastConfig = null;
let lastPortRef = null;
let shuttingDown = false;   // Gap 1 fix — set true in beforeunload so runReadLoop's
                            // outer while(p.readable) does not re-acquire a fresh reader
                            // during tear-down. Paired with the beforeunload handler.
const stateObservers = [];
const errorLog = [];                              // D-27 — ring of last 5 entries (newest-first)

// Injected deps (filled by wireSerial, used by Wave 2+ wiring).
let term = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;
// E2.1 (AD-15) — injected signal for the out-of-band "Choose MicroBeast…" label
// (the multi-adapter guard). menu-bar.js owns the actual DOM write; serial.js
// only hands it the string. Null-guarded — a harness that omits it is inert.
let signalConnectLabelFn = null;
let connectionPane = null;
let errorLogEl = null;
// Wave 3 (D-08) — serial-config form refs:
//   { baud, dataBits, stopBits, parity, flowCtl, resetBtn, reconnectHintEl }
let serialEls = null;
// Phase 6 Plan 05 (Wave 4) — session log handle: { reset, append }. The read
// loop calls sessionLogRef.append(value) AFTER the post-feed invariant so the
// per-connection RX byte log captures every chunk that reached term.feed.
// connectMicroBeast + finishReconnect call sessionLogRef.reset() on every
// successful port.open so the connect-time UTC stamp is captured before any
// byte arrives (D-29 / D-31).
let sessionLogRef = null;
// Phase 6 Plan 06 (Wave 5) — prefs ref + persist-on-form-change. Used by the
// auto-connect path (D-34) and by the serial-config form change listener
// to persist user choices via the prefs.js debounce.
let prefsRef = null;
let savePrefsFn = null;
// E4.1 fix (#3) — pushed to the status bar when the boot getPorts() scan finds an
// already-granted MicroBeast, so a returning user sees the "…— click Connect"
// affordance the relocated #port-status used to show (serial.js no longer owns
// that DOM node — status-bar.js does).
let onBootDeviceRecognizedFn = null;
// E4.3 fix (FR-28) — fired at the end of appendErrorLog (after renderErrorLog) with
// the current errorLog.length, so the status-bar recent-errors affordance updates
// live on every error. Same imperative-push shape as onBootDeviceRecognizedFn:
// serial.js owns the mutation, main.js's closure calls statusBar.setErrorCount.
// Null-guarded — a harness that omits it is inert.
let onErrorLogChangeFn = null;
// E4.1 fix (#4) — the most-recent connect-TIME failure (open-failed / port-in-use /
// auto-connect-failed). These land in state 'disconnected', whose dot is gray by
// design (red is reserved for port-lost), so nothing visibly distinguished a failed
// Connect from idle once the D-27 pane auto-expand was removed. The status bar reads
// this via getLastConnectError() to surface the message in its readout. Cleared at
// the start of every fresh connect attempt. NOT set for port-lost (already red).
let lastConnectError = null;

// --- Public API -----------------------------------------------------------

// renderPoliteFail: full-page takeover invoked BEFORE wasm init when
// navigator.serial is undefined. Synchronous, no awaits, no fetches, no font
// loading — the polite-fail page uses system-ui per 05-UI-SPEC line 464.
//
// STATIC HTML ONLY — if extending, use textContent for user-provided strings,
// not innerHTML (threat-register T-05-02-01 mitigation).
export function renderPoliteFail() {
    document.title = 'Beastty — Chromium required';
    document.body.classList.add('polite-fail');
    document.body.innerHTML = `<h1>Beastty requires a Chromium-based browser</h1>
<p>Web Serial is a Chromium-only API. Beastty uses it to talk to your MicroBeast over USB.</p>
<p>Open Beastty in Chrome, Edge, Brave, Opera, or Arc to connect.</p>
<ul><li>Chrome 89+</li><li>Microsoft Edge 89+</li><li>Brave 1.22+</li><li>Opera 75+</li><li>Arc (any version)</li></ul>
<p><a href="https://www.chromium.org/getting-involved/download-chromium/">Download Chromium</a></p>
<p class="muted">No telemetry. No data leaves your browser. Source: github.com/{TBD-during-Phase-6}</p>`;
}

export async function wireSerial(opts) {
    const {
        term: termArg, sampleBell, drainHostReply, requestFrame,
        connectionPane: pane,
        errorLogEl: log,   // E4.1 (#8) — portStatusEl opt removed: #port-status lives in status-bar.js now
        signalConnectLabel,                  // E2.1 (AD-15) — "Choose MicroBeast…" out-of-band signal
        serialConfigEls,                     // Wave 3 (D-08) — form refs
        sessionLog,                          // Phase 6 Plan 05 — { reset, append }
        prefs,                               // Phase 6 Plan 06 (D-34) — auto-connect gate + form persist
        savePrefs,                           // Phase 6 Plan 06 — debounced persist on form change
        onBootDeviceRecognized,              // E4.1 fix — fired when the boot getPorts() scan finds a granted MicroBeast
        onErrorLogChange,                    // E4.3 (FR-28) — fired on every appendErrorLog with errorLog.length
    } = opts;
    term = termArg;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
    signalConnectLabelFn = signalConnectLabel || null;
    connectionPane = pane;
    errorLogEl = log;
    serialEls = serialConfigEls || null;
    sessionLogRef = sessionLog || null;
    prefsRef = prefs || null;
    savePrefsFn = savePrefs || null;
    onBootDeviceRecognizedFn = onBootDeviceRecognized || null;   // E4.1 fix (#3)
    onErrorLogChangeFn = onErrorLogChange || null;               // E4.3 (FR-28)

    // D-26 — connect/disconnect listeners on navigator.serial (NOT port instances).
    // Registered ONCE at wireSerial boot time. Pitfall #11 — listening on a port
    // reference is the wrong level; the port is replaced on replug.
    navigator.serial.addEventListener('connect', onNavSerialConnect);
    navigator.serial.addEventListener('disconnect', onNavSerialDisconnect);

    // D-30 (Gap 1 fix — UAT Test 3 blocker) — best-effort teardown on page unload.
    //
    // Contract note: SerialPort.close() ONLY resolves once port.readable AND
    // port.writable are unlocked — i.e. reader.releaseLock() and
    // writer.releaseLock() have been called. reader.cancel() alone is NOT enough:
    // it resolves the pending read() with { done: true } but does NOT release the
    // lock on port.readable. An earlier version of this handler called cancel()
    // and close() without the releaseLock() calls; the close() promise could
    // never resolve, stalling Chromium's renderer tear-down and surfacing as the
    // "Page unresponsive..." dialog on reload while connected.
    //
    // This handler mirrors the teardown() helper's ORDER but uses fire-and-forget
    // for every await (beforeunload has a tight browser time budget; teardown
    // awaits each step which is unsafe here). The SYNCHRONOUS releaseLock + close
    // steps are what make the contract satisfiable. If state === 'disconnected'
    // the handler is a no-op (port/reader/writer are null); safe to register
    // unconditionally.
    //
    // Paired with the read-loop tear-down guard (module flag set below, checked
    // at the top of runReadLoop's outer while) so the loop does not re-acquire
    // a fresh reader after our cancel.
    window.addEventListener('beforeunload', () => {
        shuttingDown = true;
        if (port && port.writable) {
            port.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
        }
        if (reader) {
            reader.cancel().catch(() => {});
            try { reader.releaseLock(); } catch {}
            reader = null;
        }
        if (writer) {
            try { writer.releaseLock(); } catch {}
            writer = null;
            unregisterWriter();
        }
        if (port) {
            port.close().catch(() => {});
        }
    });

    // D-05 / D-31 — on boot, read stored preset + scan getPorts() + stash match.
    // Does NOT auto-open — user clicks Connect explicitly.
    const stored = readStoredPreset();
    try {
        const ports = await navigator.serial.getPorts();
        const match = ports.find((p) => {
            const i = p.getInfo();
            const vid = stored ? stored.usbVendorId : VID_MICROBEAST;
            const pid = stored ? stored.usbProductId : PID_MICROBEAST;
            return i.usbVendorId === vid && i.usbProductId === pid;
        });
        if (match) {
            lastPortRef = match;
            // E4.1 fix (#3) — push the "device recognized, click Connect" cue to the
            // status bar (the relocated home of #port-status); serial.js no longer
            // writes any connection DOM (fix #8 removed the portStatusEl projection).
            if (onBootDeviceRecognizedFn) onBootDeviceRecognizedFn();
        }
    } catch (err) {
        console.warn('[serial] getPorts restore skipped:', err);
    }

    // Render the empty-state error log on boot (D-27).
    renderErrorLog();

    // Phase 6 Plan 06 (Wave 5) — Auto-connect path (D-34).
    // RESEARCH §Pitfall 3 — gate on `state === 'disconnected'` to avoid race
    // against a user-click. Off by default per D-36; only daily-driver users
    // who opt in via the Settings checkbox reach this branch.
    if (prefsRef && prefsRef.autoConnect === true) {
        if (lastPortRef && state === 'disconnected') {
            try {
                // Silent open — mirrors connectMicroBeast body but skips
                // requestPort() (no Chromium picker, no user gesture).
                const cfg = (prefsRef.serial && typeof prefsRef.serial.baud === 'number')
                    ? {
                        baudRate: prefsRef.serial.baud,
                        dataBits: prefsRef.serial.dataBits,
                        stopBits: prefsRef.serial.stopBits,
                        parity:   prefsRef.serial.parity,
                        flowControl: prefsRef.serial.flowControl,
                    }
                    : PRESET_CONFIG;
                await lastPortRef.open(cfg);
                // Phase 12.1 Plan 12-08 — RTS gated on prefs.serialAssertRtsOnConnect.
                await lastPortRef.setSignals({
                    dataTerminalReady: false,
                    requestToSend: (getPrefs() && getPrefs().serialAssertRtsOnConnect !== false) ? true : false,
                });
                writer = lastPortRef.writable.getWriter();
                registerWriter(writer);
                port = lastPortRef;
                lastConfig = cfg;
                if (sessionLogRef) sessionLogRef.reset();   // D-29 — fresh per-connection buffer.
                setState('connected');
                runReadLoop(lastPortRef);
            } catch (err) {
                // Pitfall 3 fall-back — log + standard "click Connect" path.
                lastConnectError = `Auto-connect failed: ${err.message}`;   // E4.1 fix (#4)
                appendErrorLog('auto-connect-failed', lastConnectError);
                setState('disconnected');   // status bar reads lastConnectError on this transition
            }
        } else if (!lastPortRef) {
            // No granted port found — user must click Connect to authorize.
            appendErrorLog('auto-connect-failed', 'Auto-connect failed — no granted port found. Click Connect to authorize.');
        }
        // If state !== 'disconnected' (a race against user-click), the
        // auto-connect is a no-op and the existing connectMicroBeast() click
        // handler owns the flow.
    }

    // E2.1 (AD-15) — the Connect-button click/mousedown wiring moved to
    // menu-bar.js (the new sole owner of every Connect surface). serial.js
    // exports toggleConnection() so the relocated wiring drives the SAME
    // state-branch logic without duplicating machine knowledge.

    // Phase 5 D-08 — serial-config form listeners (Wave 3).
    // UI-SPEC §"Connection pane form-control behaviors" — change a select and
    // if we're connected to an open port whose config no longer matches, flag
    // the user with the reconnect-required hint. Reset button snaps all 5
    // selects back to the MicroBeast preset and clears the hint.
    if (serialEls) {
        for (const el of [serialEls.baud, serialEls.dataBits, serialEls.stopBits, serialEls.parity, serialEls.flowCtl]) {
            if (!el) continue;
            el.addEventListener('change', () => {
                if (state === 'connected' && lastConfig) {
                    const current = readFormConfig();
                    const differs = (current.baudRate !== lastConfig.baudRate
                                  || current.dataBits !== lastConfig.dataBits
                                  || current.stopBits !== lastConfig.stopBits
                                  || current.parity !== lastConfig.parity
                                  || current.flowControl !== lastConfig.flowControl);
                    if (differs) showReconnectHint(); else hideReconnectHint();
                }
                // Phase 6 Plan 06 (PREF-01) — persist serial config on every change.
                // Schema mirrors prefs.serial (baud, not baudRate, etc. — match the
                // D-32 blob shape so loadPrefs round-trips cleanly).
                if (savePrefsFn) {
                    const c = readFormConfig();
                    savePrefsFn({ serial: {
                        baud: c.baudRate, dataBits: c.dataBits, stopBits: c.stopBits,
                        parity: c.parity, flowControl: c.flowControl,
                    } });
                }
            });
        }
        if (serialEls.resetBtn) {
            serialEls.resetBtn.addEventListener('click', () => snapPreset());
            // UI-SPEC §Focus retention line 576 — mousedown preventDefault keeps
            // #terminal-wrapper focused after clicking Reset.
            // E2.3 (FR-15, Task 5) — Reset now lives in #serial-config-modal's footer.
            // This preventDefault is harmless in a modal: it only suppresses mouse-focus
            // on the button (keyboard Tab still reaches it, and the native focus trap
            // keeps focus inside the dialog). Left as-is — no behavior change on click.
            serialEls.resetBtn.addEventListener('mousedown', (e) => e.preventDefault());
        }
    }

    // E2.1 (AD-15) — no initial button paint here anymore. menu-bar.js does the
    // initial disconnected paint via getConnectionState() at its own wire time.
}

// E2.1 (AD-15) — exported so the relocated menu-bar wiring drives the SAME
// D-01 stateful toggle. The state-branch logic stays here (it reads the internal
// `state`); menu-bar.js owns only the DOM click that calls this.
export async function toggleConnection() {
    // Transient states are click-inert (UI-SPEC §"Connect button pointer-events during transient states").
    if (state === 'connecting' || state === 'reconnecting') return;

    if (state === 'connected') {
        await disconnect();
        return;
    }
    // state === 'disconnected' or 'port-lost' → request + open.
    await connectMicroBeast();
}

// D-08 (Wave 3) — read serial config from the Connection-pane form. Returns
// PRESET_CONFIG when the form refs are absent (e.g. tests that don't mount the
// pane, or the tiny window during boot before wireSerial has run). Integer
// fallbacks guard against DevTools-manipulated invalid option values
// (T-05-04-01 mitigation).
function readFormConfig() {
    if (!serialEls || !serialEls.baud) return PRESET_CONFIG;
    return {
        baudRate:   parseInt(serialEls.baud.value, 10)     || 19200,
        dataBits:   parseInt(serialEls.dataBits.value, 10) || 8,
        stopBits:   parseInt(serialEls.stopBits.value, 10) || 1,
        parity:     serialEls.parity.value                 || 'none',
        flowControl: serialEls.flowCtl.value               || 'none',
    };
}

// D-08 (Wave 3) — snap all 5 form selects back to the MicroBeast preset
// (19200 / 8 / 1 / none / none). Also clears any pending reconnect-required
// hint since Reset is a user-declared "use preset" action.
function snapPreset() {
    if (!serialEls || !serialEls.baud) return;
    serialEls.baud.value     = String(PRESET_CONFIG.baudRate);
    serialEls.dataBits.value = String(PRESET_CONFIG.dataBits);
    serialEls.stopBits.value = String(PRESET_CONFIG.stopBits);
    serialEls.parity.value   = PRESET_CONFIG.parity;
    serialEls.flowCtl.value  = PRESET_CONFIG.flowControl;
    // Phase 6 Plan 06-09 (gap closure) — applyPrefs subscriber races against
    // direct .value mutations on the serial-config form. Sync the cached
    // prefs blob so the next flushPrefs cannot revert this reset. Field-name
    // translation: PRESET_CONFIG uses SerialPort.open() shape (baudRate /
    // flowControl); the prefs blob uses the persisted-form shape (baud /
    // flowControl). See plan §interfaces for the historical rationale.
    if (savePrefsFn) {
        savePrefsFn({
            serial: {
                baud: PRESET_CONFIG.baudRate,
                dataBits: PRESET_CONFIG.dataBits,
                stopBits: PRESET_CONFIG.stopBits,
                parity: PRESET_CONFIG.parity,
                flowControl: PRESET_CONFIG.flowControl,
            },
        });
    }
    hideReconnectHint();
}

// UI-SPEC line 554 — reconnect-required hint (string literal below is verbatim).
// The hint element is a <span id="serial-reconnect-hint"> provided by main.js
// via serialConfigEls.reconnectHintEl; hidden attribute flips visibility.
function showReconnectHint() {
    if (!serialEls || !serialEls.reconnectHintEl) return;
    // E2.3 (FR-15, UX-DR11) — #serial-reconnect-hint carries aria-live="polite" and
    // doubles as the modal's status region. Un-hide FIRST so the live region is in
    // the a11y tree, THEN mutate its text — a content change observed while the
    // region is present is what a polite live region announces. Populating it while
    // still [hidden] (out of the tree) and only then revealing it lands the text as
    // initial state, which screen readers do not announce.
    serialEls.reconnectHintEl.hidden = false;
    serialEls.reconnectHintEl.textContent = 'Config changed — Disconnect and Connect to apply';
}
function hideReconnectHint() {
    if (!serialEls || !serialEls.reconnectHintEl) return;
    serialEls.reconnectHintEl.hidden = true;
    serialEls.reconnectHintEl.textContent = '';
}

// D-02 — the filtered native picker. Narrows to the CP2102N MicroBeast bridge by
// default; when the user opts in via Connection → "Show all serial devices" (e.g. a
// MicroBeast clone on FTDI/CH340/CP2104, or a virtual COM port) it drops the filter
// and shows every port. Read the pref live (getPrefs()) — a boot-time snapshot would
// miss toggles. Throws on cancel / no-match (the caller maps that to a no-op).
// Exported (E4 review fix) so chooseMicroBeast can pick the NEW port while user
// activation is still fresh, BEFORE tearing the old one down — requestPort() needs
// transient activation, open() does not, so the picker must never sit behind a
// disconnect() that can stall on a wedged adapter.
export async function requestMicroBeastPort() {
    const livePrefs = getPrefs() || {};
    const requestOpts = livePrefs.showAllSerialDevices
        ? {}
        : { filters: [{ usbVendorId: VID_MICROBEAST, usbProductId: PID_MICROBEAST }] };
    return navigator.serial.requestPort(requestOpts);
}

// `preselectedPort` (E4 review fix) — when the caller has already run the picker
// (chooseMicroBeast, to keep user activation fresh across a teardown), pass the port
// here to skip requestPort() and go straight to open().
export async function connectMicroBeast(configOverride, preselectedPort) {
    lastConnectError = null;   // E4.1 fix (#4) — fresh attempt clears any prior failure cue
    setState('connecting');
    let selectedPort = preselectedPort;
    if (!selectedPort) {
        try {
            selectedPort = await requestMicroBeastPort();
        } catch (err) {
            // User cancelled picker OR no-match rejection.
            setState('disconnected');
            return;
        }
    }

    const config = configOverride || readFormConfig();
    try {
        await selectedPort.open(config);
        // Phase 5 D-11 — de-assert DTR after open (Pitfall #12).
        // Phase 12.1 Plan 12-08 — RTS gated on prefs.serialAssertRtsOnConnect
        // (default true). Asserts RTS on connect for Z80-side UART hardware
        // flow control (slide-team finding 2026-05-09). User can revert via
        // Settings checkbox for hardware where RTS is a reset line. DTR
        // remains false in all paths.
        await selectedPort.setSignals({
            dataTerminalReady: false,
            requestToSend: (getPrefs() && getPrefs().serialAssertRtsOnConnect !== false) ? true : false,
        });
        // Phase 6 Plan 05 (D-29) — fresh session-log buffer per Connect; UTC
        // stamp captured here BEFORE any byte arrives so the filename reflects
        // when the session started, not when the user clicks Download.
        if (sessionLogRef) sessionLogRef.reset();
    } catch (err) {
        // D-29 — InvalidStateError ("port is in use" / "already open") is a
        // distinct user-facing message (another Beastty tab owns the port).
        const msg = (err.message || '').toLowerCase();
        if (err.name === 'InvalidStateError' && (msg.includes('in use') || msg.includes('already open'))) {
            lastConnectError = 'MicroBeast is in use by another Beastty tab — close it to connect here.';
            appendErrorLog('port-in-use', lastConnectError);
        } else {
            lastConnectError = `Could not open port: ${err.message}`;
            appendErrorLog('open-failed', lastConnectError);
        }
        setState('disconnected');   // E4.1 fix (#4) — status bar reads lastConnectError on this transition
        return;
    }

    // Grab writer + register with tx-sink so keypresses and pastes reach the wire (D-21).
    writer = selectedPort.writable.getWriter();
    registerWriter(writer);

    port = selectedPort;
    lastPortRef = selectedPort;
    lastConfig = config;
    persistVidPid(selectedPort);    // D-31 — Wave 4 implements; Wave 2 stubs it locally.

    setState('connected');

    // Fire the read loop (no await — runs until the reader is cancelled or port.readable=null).
    runReadLoop(selectedPort);
    // Wave 3 (D-08) — config now matches the open port; clear any pending hint.
    hideReconnectHint();
}

export async function disconnect() {
    // Set shuttingDown BEFORE cancelling the reader so runReadLoop's outer
    // while(p.readable) loop sees the flag and breaks — otherwise the loop
    // re-acquires a fresh reader between cancel() resolving and port.close()
    // running, the new reader holds the lock, port.close() silently rejects,
    // and the user-clicked Disconnect appears to do nothing. (The same flag
    // also short-circuits the beforeunload teardown for the same reason.)
    shuttingDown = true;
    try {
        await teardown({ deassertSignals: true });
    } finally {
        // Restore the flag so a subsequent Connect can start a fresh read loop.
        shuttingDown = false;
    }
    setState('disconnected');
}

export function getState() { return state; }

export function onStateChange(fn) {
    stateObservers.push(fn);
    return () => {
        const idx = stateObservers.indexOf(fn);
        if (idx >= 0) stateObservers.splice(idx, 1);
    };
}

export function getWriter() { return writer; }

// E4.1 fix (#2) — the framing the LIVE port was actually opened with (lastConfig,
// a SerialPort.open() shape), formatted for the status-bar readout. The status bar
// must not derive framing from getPrefs().serial: a mid-session serial-config change
// persists to prefs immediately but only takes effect on the next open (the
// "Disconnect and Connect to apply" hint), and a reconnect re-opens with lastConfig
// — so a prefs-derived readout would misreport the real wire framing. Returns null
// when nothing is open yet (never connected), letting the caller fall back.
export function getActiveFraming() {
    if (!lastConfig) return null;
    const p = String(lastConfig.parity || 'none')[0].toUpperCase();   // 'none' → 'N'
    return `${lastConfig.baudRate} ${lastConfig.dataBits}${p}${lastConfig.stopBits}`;
}

// E4.1 fix (#4) — the most-recent connect-time failure message (or null). The status
// bar surfaces this in its readout so a failed Connect is visible again (the D-27
// pane auto-expand was removed and the disconnected dot is gray by design).
export function getLastConnectError() { return lastConnectError; }

// E4.3 (FR-28) — the current recent-error count (0..ERROR_LOG_CAP), for the status
// bar's recent-errors affordance. errorLog is observer-less, so the status bar reads
// this getter for its initial paint (0 at boot — no connect attempt has run yet) and
// is fed live updates via the injected onErrorLogChange push (see appendErrorLog).
// status-bar.js cannot import serial.js (AD-3); main.js injects this as an opt.
export function getRecentErrorCount() { return errorLog.length; }

// E4.1 fix (#7) — the ACTUAL device label for the status-bar readout: the live open
// port when connected, else the boot-scan match (lastPortRef) for the "click Connect"
// cue. Returns the canonical MicroBeast string ONLY when the port's VID/PID actually
// match — so a "Show all serial devices" connection to a non-CP2102N adapter reports
// its real VID:PID instead of being mislabelled a MicroBeast. Null when nothing is
// granted yet (the status bar falls back to its own literal). This is the single
// authoritative source of the device string; status-bar.js keeps only a harness fallback.
export function getConnectionDevice() {
    const p = port || lastPortRef;
    if (!p) return null;
    let info;
    try { info = p.getInfo(); } catch { return null; }
    if (isMicroBeast(info)) {
        return 'MicroBeast (CP2102N 10c4:ea60)';
    }
    const hex = (n) => (n == null ? '????' : n.toString(16).padStart(4, '0'));
    return `Serial device (${hex(info.usbVendorId)}:${hex(info.usbProductId)})`;
}

// E2.2 (FR-13) — count the currently-granted CP2102N MicroBeast adapters via the
// shared isMicroBeast() predicate (single source with getConnectionDevice's label).
// menu-bar.js gates "Choose MicroBeast…" on count > 1 but cannot import serial
// (AD-3), so main.js injects this as opts.getAdapterCount. No-throw: resolves to 0
// if getPorts() rejects (never blocks / breaks the menu open).
export async function countMicroBeastAdapters() {
    let ports;
    try { ports = await navigator.serial.getPorts(); } catch { return 0; }
    return ports.filter((p) => isMicroBeast(p.getInfo())).length;
}

// --- Internals ------------------------------------------------------------

// D-35 / D-36 + 05-RESEARCH Pattern 2 — pure-async read loop decoupled from rAF.
// Outer while(p.readable) re-enters on non-fatal errors; inner while(true)
// is cancellable from teardown. Pitfall #10: raw Uint8Array chunks pass
// directly to the parser via term.feed — no byte-to-string coercion on the read path.
async function runReadLoop(p) {
    while (p.readable) {
        if (shuttingDown) break;     // Gap 1 fix — paired with beforeunload handler;
                                      // prevents re-acquiring a fresh reader during unload.
        reader = p.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;                        // D-36 — cancel() resolves here
                dispatchInbound(value);                  // Phase 8 D-06 — terminal/recv mode dispatch
                sampleBellFn();                          // Phase 3 post-feed invariant
                drainHostReplyFn('serial');              // Phase 2 host-reply accessor drain
                requestFrameFn();                        // Phase 3 dirty-repaint wake
                // Phase 6 Plan 05 (D-30) — append by reference; no copy. Last
                // step in the post-feed invariant so a parser failure (very
                // rare — feed never throws) does not silently lose the bytes
                // for the log either way: the log records what reached the
                // wire, regardless of how the parser interpreted it.
                //
                // Phase 11 Plan 11-03 D-11 — session-log paused during active
                // SLIDE session (SLIDE-33 / T-11-03-log-leak mitigation). The
                // gate sits at the call site (not inside append()) so the
                // existing one-call-per-chunk semantics + buffer accounting
                // are unchanged. The 7-byte ESC^SLIDE wakeup signature is
                // already consumed by the dispatcher BEFORE this point so
                // signature bytes never reach the log either.
                if (sessionLogRef && !isSlideActive()) sessionLogRef.append(value);
            }
        } catch (err) {
            handleReadError(err);
            // Fall through to finally; outer loop re-checks p.readable.
        } finally {
            try { reader.releaseLock(); } catch { /* already released */ }
            reader = null;
        }
    }
    // p.readable is null → port is dead (fatal error or explicit close).
    try { await p.close(); } catch {}
    // Wave 4 handles port-lost transition via the disconnect event;
    // Wave 2 just lands in 'disconnected' if user initiated.
    if (state !== 'port-lost') setState('disconnected');
}

function handleReadError(err) {
    // D-28 — NetworkError from the read loop means permission was revoked
    // (e.g. user clicked "Forget device" in chrome://device-log); distinct
    // user-facing message vs. a generic read error (unplug, wire noise).
    const isPermissionRevoke = err && err.name === 'NetworkError';
    if (isPermissionRevoke) {
        appendErrorLog('permission-revoked', 'Permission revoked — click Reconnect to re-authorize');
    } else {
        appendErrorLog('read-error', `Read error — treating as port lost: ${err.message}`);
    }
    console.error('[serial] read error', err);
    setState('port-lost');
    // Phase 5 D-20 — drain any mid-paste queue when read loop fatal-errors.
    pastePumpOnPortLost();
    slidePumpOnPortLost();   // Phase 11 D-14 — symmetric SLIDE port-lost teardown.
}

// D-11 + D-36 + 05-RESEARCH Pattern 3 — cancel-before-close teardown order:
// setSignals(false,false) → cancel reader → release writer → port.close().
// Every await is try/catch'd — teardown MUST succeed even if individual steps throw.
async function teardown({ deassertSignals = true } = {}) {
    // D-11 step 1 — de-assert DTR/RTS before close (Pitfall #12, CP2102N errata).
    if (deassertSignals && port && port.writable) {
        try {
            await port.setSignals({ dataTerminalReady: false, requestToSend: false });
        } catch {
            appendErrorLog('dtr-deassert-failed',
                'Could not clear DTR/RTS before close — safe to ignore on clean unplug');
        }
    }
    // D-36 step 2 — cancel reader; pending read() resolves { done: true }.
    if (reader) {
        try { await reader.cancel(); } catch { /* ignore */ }
    }
    // Step 3 — release + unregister writer.
    if (writer) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        writer = null;
        unregisterWriter();
    }
    // Step 4 — close the port.
    if (port) {
        try { await port.close(); } catch { /* ignore */ }
    }
    // Step 5 — Phase 5 D-20 — drop any mid-paste queue.
    pastePumpOnPortLost();
    slidePumpOnPortLost();   // Phase 11 D-14 — symmetric SLIDE port-lost teardown.
    // NOTE: port variable stays set (so getPorts/VID-match still works on reconnect).
}

// State machine helper (05-RESEARCH Pattern 5). Fires observers after every transition.
function setState(s) {
    state = s;
    // E2.1 (AD-15) — no DOM projection here anymore; the observer fan-out is the
    // ONLY side effect. menu-bar.js's projectConnection subscriber owns every
    // Connect-surface write (label / dot / status / legacy button).
    for (const fn of stateObservers) fn(s);
}

// E4.1 (#8) — updatePortStatusConnected/Disconnected removed: #port-status moved to
// status-bar.js, which projects it off the same onStateChange truth. serial.js no
// longer writes any connection DOM (the device/framing readout is served via the
// getConnectionDevice/getActiveFraming getters instead).

// Error log — D-27 ring-of-5 newest-first, `HH:MM:SS code: message` format.
// Auto-expands the Connection pane on a new entry so the user sees it.
function appendErrorLog(code, message) {
    const ts = new Date().toTimeString().slice(0, 8);   // HH:MM:SS 24-hour local
    const entry = { ts, code, message };
    errorLog.unshift(entry);                             // newest-first
    if (errorLog.length > ERROR_LOG_CAP) errorLog.length = ERROR_LOG_CAP;
    renderErrorLog();
    console.error('[serial]', `${ts} ${code}: ${message}`);
    // E4.3 (FR-28, AD-6) — imperative push to the status-bar recent-errors affordance.
    // Fired AFTER renderErrorLog so the #error-log and the count never disagree; the
    // status bar holds no independent truth (this is its only feed besides the boot
    // getRecentErrorCount read). Null-guarded — inert on a harness that omits the opt.
    if (onErrorLogChangeFn) onErrorLogChangeFn(errorLog.length);
    // E2.3 (FR-15, AD-6) — the D-27 auto-expand (`connectionPane.open = true`) is
    // REMOVED. The #error-log now lives inside #serial-config-modal, and a modal must
    // never showModal() itself on every error (an error while the user is elsewhere
    // must not steal the top layer). Errors still populate #error-log (ring-of-5) and
    // trip the red-border Connect signal (menu-bar.js, unchanged) — that stays the
    // primary "something's wrong" cue. The DELIBERATE path to read the log is opening
    // Connection ▸ Serial Configuration… (and, later, the E4 status-bar recent-errors
    // affordance opens this same modal). connectionPane is now a vestigial ref (the
    // <details> pane no longer hosts the log) — left injected but no longer written.
}

function renderErrorLog() {
    if (!errorLogEl) return;
    if (errorLog.length === 0) {
        errorLogEl.textContent = '(no recent errors)';
        return;
    }
    // escapeHtml() is the trust boundary for every interpolated string before
    // innerHTML (threat-register T-05-05-01: malicious err.message injection).
    const html = errorLog.map((e) => {
        const safeMsg = escapeHtml(`${e.code}: ${e.message}`);
        const safeTs  = escapeHtml(e.ts);
        return `<span class="log-entry"><span class="log-ts">${safeTs}</span> ${safeMsg}</span>`;
    }).join('\n');
    errorLogEl.innerHTML = html;
}

function escapeHtml(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// VID/PID persistence — D-31. Writes { usbVendorId, usbProductId } to
// localStorage under STORAGE_KEY on every successful open. Boot-time
// getPorts() scan (wireSerial above) filters against the stored pair.
function persistVidPid(p) {
    try {
        const info = p.getInfo();
        if (typeof info.usbVendorId === 'number' && typeof info.usbProductId === 'number') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                usbVendorId: info.usbVendorId,
                usbProductId: info.usbProductId,
            }));
        }
    } catch (err) {
        console.warn('[serial] persistVidPid failed:', err);
    }
}

function readStoredPreset() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.usbVendorId === 'number' && typeof parsed.usbProductId === 'number') {
            return parsed;
        }
        return null;
    } catch { return null; }
}

// --- Auto-reconnect state machine (Wave 4) --------------------------------

// navigator.serial 'connect' event handler — D-24 silent auto-reconnect.
// Only re-enters from 'port-lost' (D-03 — explicit disconnect/connecting/connected
// states must not be stomped by a replug notification).
async function onNavSerialConnect(ev) {
    if (state !== 'port-lost') return;
    const stored = readStoredPreset();
    if (!stored) return;

    let ports;
    try { ports = await navigator.serial.getPorts(); } catch { return; }
    const matches = ports.filter((p) => {
        const i = p.getInfo();
        return i.usbVendorId === stored.usbVendorId && i.usbProductId === stored.usbProductId;
    });
    if (matches.length === 0) return;   // VID/PID mismatch — not our device.

    let target;
    if (matches.length === 1) {
        target = matches[0];
    } else {
        // D-25 — multiple matches: prefer lastPortRef (exact identity match).
        // T-05-05-03 — without identity match, refuse to auto-open (wrong-device guard);
        // force the user to pick (label string literal below is verbatim) + log.
        target = matches.find((p) => p === lastPortRef);
        if (!target) {
            setState('port-lost');
            // E2.1 (AD-15, AC-4) — the out-of-band "Choose MicroBeast…" label is
            // not representable by the 5-state map; hand it to menu-bar.js (the
            // sole writer) via the injected signal instead of writing the DOM here.
            // Fires AFTER setState so it overrides the port-lost 'Reconnect' label
            // the fan-out just projected (until the next setState re-projects). U+2026.
            if (signalConnectLabelFn) signalConnectLabelFn('Choose MicroBeast…');
            appendErrorLog('multiple-adapters', 'Multiple CP2102N adapters connected — pick one');
            return;
        }
    }
    await handleReconnect(target);
}

// navigator.serial 'disconnect' event handler — D-24 silent port-lost entry.
// Only transitions if the disconnected port is the one we own (or the last one we saw).
// No error log on clean unplug — the red border signal is sufficient.
function onNavSerialDisconnect(ev) {
    if (ev.target === port || ev.target === lastPortRef) {
        setState('port-lost');
        // Phase 5 D-20 — drain any mid-paste queue on hard unplug so the
        // pump stops trying to push bytes to a closed writer.
        pastePumpOnPortLost();
        slidePumpOnPortLost();   // Phase 11 D-14 — symmetric SLIDE port-lost teardown.
    }
}

// Handle a VID/PID-matched reconnect — D-04 single silent retry after 500ms on
// a transient open() rejection; second failure lands in port-lost + reopen-failed.
async function handleReconnect(target) {
    setState('reconnecting');
    try {
        await target.open(lastConfig || PRESET_CONFIG);
        // Phase 12.1 Plan 12-08 — RTS gated on prefs.serialAssertRtsOnConnect.
        await target.setSignals({
            dataTerminalReady: false,
            requestToSend: (getPrefs() && getPrefs().serialAssertRtsOnConnect !== false) ? true : false,
        });
    } catch (firstErr) {
        // D-04 — single silent retry after exactly 500ms.
        setTimeout(() => retryOpenOnce(target), 500);
        return;
    }
    await finishReconnect(target);
}

// D-04 retry — second attempt at open() after a 500ms gap. If this also fails
// the device is not cleanly ready; we surface reopen-failed (code string below)
// and land in port-lost so the user can click Reconnect explicitly.
async function retryOpenOnce(target) {
    try {
        await target.open(lastConfig || PRESET_CONFIG);
        // Phase 12.1 Plan 12-08 — RTS gated on prefs.serialAssertRtsOnConnect.
        await target.setSignals({
            dataTerminalReady: false,
            requestToSend: (getPrefs() && getPrefs().serialAssertRtsOnConnect !== false) ? true : false,
        });
    } catch (retryErr) {
        setState('port-lost');
        appendErrorLog('reopen-failed', `Reconnect failed: ${retryErr.message}`);
        return;
    }
    await finishReconnect(target);
}

async function finishReconnect(target) {
    writer = target.writable.getWriter();
    registerWriter(writer);
    port = target;
    lastPortRef = target;
    // Phase 6 Plan 05 (D-29) — reconnect is a new session per the per-connection
    // lifecycle contract; capture a fresh connect-time UTC stamp BEFORE setState
    // so the read loop's first append finds an empty buffer and a current stamp.
    if (sessionLogRef) sessionLogRef.reset();
    setState('connected');
    runReadLoop(target);
}
