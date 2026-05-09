// Beastty Phase 5 — Web Serial transport (JS-only; no Rust bindings).
//
// Public API: renderPoliteFail, wireSerial, connectMicroBeast, disconnect,
// getState, onStateChange, getWriter.
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

// Diagnostic instrumentation gate — Phase 12 hardware UAT root-cause work.
// Same opt-in as slide.js: `localStorage.setItem('beastty.debug.slide','1')`.
// Remove this block + serialDbg() call sites once the diagnosis lands.
const SERIAL_DEBUG = (() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('beastty.debug.slide') === '1'; }
    catch { return false; }
})();
function serialDbg(tag, payload) {
    if (!SERIAL_DEBUG) return;
    try { console.log('[serial-debug]', tag, payload === undefined ? '' : payload); } catch {}
}

// Constants -----------------------------------------------------------------
const VID_MICROBEAST = 0x10c4;   // D-02 — Silicon Labs (CP2102N)
const PID_MICROBEAST = 0xea60;   // D-02 — CP2102N
const PRESET_CONFIG = Object.freeze({
    baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none',
});
const STORAGE_KEY = 'beastty.port.preset';   // D-31 — localStorage key for VID/PID persistence
const ERROR_LOG_CAP = 5;                          // D-27 — ring-of-5 newest-first
const BUTTON_LABELS = Object.freeze({
    disconnected:  'Connect',
    connecting:    'Connecting…',          // U+2026 ellipsis
    connected:     'Disconnect',
    reconnecting:  'Reconnecting…',        // U+2026 ellipsis
    'port-lost':   'Reconnect',
});

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
let connectButton = null;
let connectionPane = null;
let portStatusEl = null;
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
        connectButton: btn, connectionPane: pane,
        portStatusEl: status, errorLogEl: log,
        serialConfigEls,                     // Wave 3 (D-08) — form refs
        sessionLog,                          // Phase 6 Plan 05 — { reset, append }
        prefs,                               // Phase 6 Plan 06 (D-34) — auto-connect gate + form persist
        savePrefs,                           // Phase 6 Plan 06 — debounced persist on form change
    } = opts;
    term = termArg;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
    connectButton = btn;
    connectionPane = pane;
    portStatusEl = status;
    errorLogEl = log;
    serialEls = serialConfigEls || null;
    sessionLogRef = sessionLog || null;
    prefsRef = prefs || null;
    savePrefsFn = savePrefs || null;

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
            if (portStatusEl) {
                portStatusEl.textContent = 'MicroBeast (CP2102N 10c4:ea60) — click Connect';
            }
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
                await lastPortRef.setSignals({ dataTerminalReady: false, requestToSend: false });
                writer = lastPortRef.writable.getWriter();
                registerWriter(writer);
                port = lastPortRef;
                lastConfig = cfg;
                if (sessionLogRef) sessionLogRef.reset();   // D-29 — fresh per-connection buffer.
                setState('connected');
                updatePortStatusConnected();
                runReadLoop(lastPortRef);
            } catch (err) {
                // Pitfall 3 fall-back — log + standard "click Connect" path.
                appendErrorLog('auto-connect-failed', `Auto-connect failed: ${err.message}`);
                setState('disconnected');
            }
        } else if (!lastPortRef) {
            // No granted port found — user must click Connect to authorize.
            appendErrorLog('auto-connect-failed', 'Auto-connect failed — no granted port found. Click Connect to authorize.');
        }
        // If state !== 'disconnected' (a race against user-click), the
        // auto-connect is a no-op and the existing connectMicroBeast() click
        // handler owns the flow.
    }

    // Connect button click handler — D-01 stateful toggle.
    connectButton.addEventListener('click', onConnectButtonClick);
    connectButton.addEventListener('mousedown', (e) => e.preventDefault());  // UI-SPEC §Focus retention line 575

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
            serialEls.resetBtn.addEventListener('mousedown', (e) => e.preventDefault());
        }
    }

    applyStateToButton();  // Set initial label + data-state=disconnected.
}

async function onConnectButtonClick() {
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
    serialEls.reconnectHintEl.textContent = 'Config changed — Disconnect and Connect to apply';
    serialEls.reconnectHintEl.hidden = false;
}
function hideReconnectHint() {
    if (!serialEls || !serialEls.reconnectHintEl) return;
    serialEls.reconnectHintEl.hidden = true;
    serialEls.reconnectHintEl.textContent = '';
}

export async function connectMicroBeast(configOverride) {
    setState('connecting');
    let selectedPort;
    try {
        // D-02 — narrow the native picker to the CP2102N MicroBeast bridge by
        // default. When the user opts in via Connection → "Show all serial
        // devices" (e.g. MicroBeast clone using FTDI/CH340/CP2104, or virtual
        // COM port), drop the filter and show every available port. Read the
        // pref live (getPrefs()) — a boot-time snapshot would miss toggles.
        const livePrefs = getPrefs() || {};
        const requestOpts = livePrefs.showAllSerialDevices
            ? {}
            : { filters: [{ usbVendorId: VID_MICROBEAST, usbProductId: PID_MICROBEAST }] };
        selectedPort = await navigator.serial.requestPort(requestOpts);
    } catch (err) {
        // User cancelled picker OR no-match rejection.
        setState('disconnected');
        return;
    }

    const config = configOverride || readFormConfig();
    try {
        await selectedPort.open(config);
        // D-11 — de-assert DTR/RTS immediately after open (Pitfall #12).
        await selectedPort.setSignals({ dataTerminalReady: false, requestToSend: false });
        // Phase 6 Plan 05 (D-29) — fresh session-log buffer per Connect; UTC
        // stamp captured here BEFORE any byte arrives so the filename reflects
        // when the session started, not when the user clicks Download.
        if (sessionLogRef) sessionLogRef.reset();
    } catch (err) {
        // D-29 — InvalidStateError ("port is in use" / "already open") is a
        // distinct user-facing message (another Beastty tab owns the port).
        const msg = (err.message || '').toLowerCase();
        if (err.name === 'InvalidStateError' && (msg.includes('in use') || msg.includes('already open'))) {
            appendErrorLog('port-in-use',
                'MicroBeast is in use by another Beastty tab — close it to connect here.');
        } else {
            appendErrorLog('open-failed', `Could not open port: ${err.message}`);
        }
        setState('disconnected');
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
    updatePortStatusConnected();

    // Fire the read loop (no await — runs until the reader is cancelled or port.readable=null).
    runReadLoop(selectedPort);
    // Wave 3 (D-08) — config now matches the open port; clear any pending hint.
    hideReconnectHint();
}

export async function disconnect() {
    serialDbg('disconnect:enter', { state, hasPort: !!port, hasReader: !!reader, hasWriter: !!writer });
    // Set shuttingDown BEFORE cancelling the reader so runReadLoop's outer
    // while(p.readable) loop sees the flag and breaks — otherwise the loop
    // re-acquires a fresh reader between cancel() resolving and port.close()
    // running, the new reader holds the lock, port.close() silently rejects,
    // and the user-clicked Disconnect appears to do nothing. (The same flag
    // also short-circuits the beforeunload teardown for the same reason.)
    shuttingDown = true;
    try {
        serialDbg('disconnect:awaiting-teardown', {});
        await teardown({ deassertSignals: true });
        serialDbg('disconnect:teardown-resolved', {});
    } finally {
        // Restore the flag so a subsequent Connect can start a fresh read loop.
        shuttingDown = false;
    }
    setState('disconnected');
    updatePortStatusDisconnected();
    serialDbg('disconnect:exit', { state });
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
    serialDbg('teardown:enter', { deassertSignals, hasPort: !!port, portWritable: !!(port && port.writable), hasReader: !!reader, hasWriter: !!writer });
    // D-11 step 1 — de-assert DTR/RTS before close (Pitfall #12, CP2102N errata).
    if (deassertSignals && port && port.writable) {
        try {
            serialDbg('teardown:step1-setSignals-pending', {});
            await port.setSignals({ dataTerminalReady: false, requestToSend: false });
            serialDbg('teardown:step1-setSignals-done', {});
        } catch (err) {
            serialDbg('teardown:step1-setSignals-threw', { msg: err && err.message });
            appendErrorLog('dtr-deassert-failed',
                'Could not clear DTR/RTS before close — safe to ignore on clean unplug');
        }
    } else {
        serialDbg('teardown:step1-skipped', { reason: !deassertSignals ? 'flag false' : (!port ? 'no port' : 'port not writable') });
    }
    // D-36 step 2 — cancel reader; pending read() resolves { done: true }.
    if (reader) {
        try { serialDbg('teardown:step2-reader-cancel-pending', {}); await reader.cancel(); serialDbg('teardown:step2-reader-cancel-done', {}); }
        catch (err) { serialDbg('teardown:step2-reader-cancel-threw', { msg: err && err.message }); }
    } else {
        serialDbg('teardown:step2-skipped', { reason: 'no reader' });
    }
    // Step 3 — release + unregister writer.
    if (writer) {
        try { serialDbg('teardown:step3-writer-releaseLock-pending', {}); writer.releaseLock(); serialDbg('teardown:step3-writer-releaseLock-done', {}); }
        catch (err) { serialDbg('teardown:step3-writer-releaseLock-threw', { msg: err && err.message }); }
        writer = null;
        unregisterWriter();
    } else {
        serialDbg('teardown:step3-skipped', { reason: 'no writer' });
    }
    // Step 4 — close the port.
    if (port) {
        try { serialDbg('teardown:step4-port-close-pending', {}); await port.close(); serialDbg('teardown:step4-port-close-done', {}); }
        catch (err) { serialDbg('teardown:step4-port-close-threw', { msg: err && err.message }); }
    } else {
        serialDbg('teardown:step4-skipped', { reason: 'no port' });
    }
    // Step 5 — Phase 5 D-20 — drop any mid-paste queue.
    serialDbg('teardown:step5-pastePumpOnPortLost', {});
    pastePumpOnPortLost();
    serialDbg('teardown:step5-slidePumpOnPortLost', {});
    slidePumpOnPortLost();   // Phase 11 D-14 — symmetric SLIDE port-lost teardown.
    serialDbg('teardown:exit', {});
    // NOTE: port variable stays set (so getPorts/VID-match still works on reconnect).
}

// State machine helper (05-RESEARCH Pattern 5). Fires observers after every transition.
function setState(s) {
    state = s;
    applyStateToButton();
    for (const fn of stateObservers) fn(s);
}

function applyStateToButton() {
    if (!connectButton) return;
    connectButton.dataset.state = state;
    connectButton.textContent = BUTTON_LABELS[state] || BUTTON_LABELS.disconnected;
}

function updatePortStatusConnected() {
    if (!portStatusEl) return;
    // UI-SPEC line 164 — verbatim copy.
    portStatusEl.textContent = 'MicroBeast (CP2102N 10c4:ea60) — 19200 8N1';
}
function updatePortStatusDisconnected() {
    if (!portStatusEl) return;
    portStatusEl.textContent = 'Not connected';
}

// Error log — D-27 ring-of-5 newest-first, `HH:MM:SS code: message` format.
// Auto-expands the Connection pane on a new entry so the user sees it.
function appendErrorLog(code, message) {
    const ts = new Date().toTimeString().slice(0, 8);   // HH:MM:SS 24-hour local
    const entry = { ts, code, message };
    errorLog.unshift(entry);                             // newest-first
    if (errorLog.length > ERROR_LOG_CAP) errorLog.length = ERROR_LOG_CAP;
    renderErrorLog();
    console.error('[serial]', `${ts} ${code}: ${message}`);
    // D-27 auto-expand on error (KEPT, intentionally asymmetric with D-17).
    // Plan 09 (Gap 2 fix) amended D-17 so paste progress does NOT auto-expand
    // the Connection pane (progress rides the sticky #top-bar instead). D-27
    // stays as-is because errors are rare + sticky + demand attention — the
    // red border on Connect button is the primary signal; the pane-expand is
    // a secondary pull-focus that is acceptable once per error.
    if (connectionPane) connectionPane.open = true;
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
            if (connectButton) connectButton.textContent = 'Choose MicroBeast…';   // U+2026
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
        await target.setSignals({ dataTerminalReady: false, requestToSend: false });
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
        await target.setSignals({ dataTerminalReady: false, requestToSend: false });
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
    updatePortStatusConnected();
    runReadLoop(target);
}
