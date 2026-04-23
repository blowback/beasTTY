// BestialiTTY Phase 5 — Web Serial transport (JS-only; no Rust bindings).
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

// Constants -----------------------------------------------------------------
const VID_MICROBEAST = 0x10c4;   // D-02 — Silicon Labs (CP2102N)
const PID_MICROBEAST = 0xea60;   // D-02 — CP2102N
const PRESET_CONFIG = Object.freeze({
    baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none',
});
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
const stateObservers = [];

// Injected deps (filled by wireSerial, used by Wave 2+ wiring).
let term = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;
let connectButton = null;
let connectionPane = null;
let portStatusEl = null;
let errorLogEl = null;

// --- Public API -----------------------------------------------------------

// renderPoliteFail: full-page takeover invoked BEFORE wasm init when
// navigator.serial is undefined. Synchronous, no awaits, no fetches, no font
// loading — the polite-fail page uses system-ui per 05-UI-SPEC line 464.
//
// STATIC HTML ONLY — if extending, use textContent for user-provided strings,
// not innerHTML (threat-register T-05-02-01 mitigation).
export function renderPoliteFail() {
    document.title = 'BestialiTTY — Chromium required';
    document.body.classList.add('polite-fail');
    document.body.innerHTML = `<h1>BestialiTTY requires a Chromium-based browser</h1>
<p>Web Serial is a Chromium-only API. BestialiTTY uses it to talk to your MicroBeast over USB.</p>
<p>Open BestialiTTY in Chrome, Edge, Brave, Opera, or Arc to connect.</p>
<ul><li>Chrome 89+</li><li>Microsoft Edge 89+</li><li>Brave 1.22+</li><li>Opera 75+</li><li>Arc (any version)</li></ul>
<p><a href="https://www.chromium.org/getting-involved/download-chromium/">Download Chromium</a></p>
<p class="muted">No telemetry. No data leaves your browser. Source: github.com/{TBD-during-Phase-6}</p>`;
}

export async function wireSerial(opts) {
    const {
        term: termArg, sampleBell, drainHostReply, requestFrame,
        connectButton: btn, connectionPane: pane,
        portStatusEl: status, errorLogEl: log,
    } = opts;
    term = termArg;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
    connectButton = btn;
    connectionPane = pane;
    portStatusEl = status;
    errorLogEl = log;

    // D-05 — on boot, scan getPorts() and stash any matching port reference.
    // Does NOT auto-open — user clicks Connect explicitly.
    try {
        const ports = await navigator.serial.getPorts();
        const match = ports.find((p) => {
            const i = p.getInfo();
            return i.usbVendorId === VID_MICROBEAST && i.usbProductId === PID_MICROBEAST;
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

    // Connect button click handler — D-01 stateful toggle.
    connectButton.addEventListener('click', onConnectButtonClick);
    connectButton.addEventListener('mousedown', (e) => e.preventDefault());  // UI-SPEC §Focus retention line 575

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

export async function connectMicroBeast(configOverride) {
    setState('connecting');
    let selectedPort;
    try {
        // D-02 — filter-narrowed native picker (literal VID/PID so grep-anchored
        // done-criteria can verify the CP2102N identity without indirection).
        selectedPort = await navigator.serial.requestPort({
            filters: [{ usbVendorId: 0x10c4, usbProductId: 0xea60 }],
        });
    } catch (err) {
        // User cancelled picker OR no-match rejection.
        setState('disconnected');
        return;
    }

    const config = configOverride || PRESET_CONFIG;
    try {
        await selectedPort.open(config);
        // D-11 — de-assert DTR/RTS immediately after open (Pitfall #12).
        await selectedPort.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch (err) {
        appendErrorLog('open-failed', `Could not open port: ${err.message}`);
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
}

export async function disconnect() {
    await teardown({ deassertSignals: true });
    setState('disconnected');
    updatePortStatusDisconnected();
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
        reader = p.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;                        // D-36 — cancel() resolves here
                term.feed(value);                        // Phase 2 feed_silent; raw Uint8Array
                sampleBellFn();                          // Phase 3 post-feed invariant
                drainHostReplyFn('serial');              // Phase 2 host-reply accessor drain
                requestFrameFn();                        // Phase 3 dirty-repaint wake
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
    appendErrorLog('read-error', `Read error — treating as port lost: ${err.message}`);
    console.error('[serial] read error', err);
    // Wave 4 transitions to port-lost + triggers reconnect flow. Wave 2 just logs.
    setState('port-lost');
}

// D-11 + D-36 + 05-RESEARCH Pattern 3 — cancel-before-close teardown order:
// setSignals(false,false) → cancel reader → release writer → port.close().
// Every await is try/catch'd — teardown MUST succeed even if individual steps throw.
async function teardown({ deassertSignals = true } = {}) {
    // D-11 step 1 — de-assert DTR/RTS before close (Pitfall #12, CP2102N errata).
    if (deassertSignals && port && port.writable) {
        try {
            await port.setSignals({ dataTerminalReady: false, requestToSend: false });
        } catch (err) {
            appendErrorLog('dtr-deassert-failed',
                'Could not clear DTR/RTS before close — safe to ignore on clean unplug');
        }
    }
    // D-36 step 2 — cancel reader; pending read() resolves { done: true }.
    if (reader) {
        try { await reader.cancel(); } catch {}
    }
    // Step 3 — release + unregister writer.
    if (writer) {
        try { writer.releaseLock(); } catch {}
        writer = null;
        unregisterWriter();
    }
    // Step 4 — close the port.
    if (port) {
        try { await port.close(); } catch {}
    }
    // Step 5 — Wave 4 calls pastePump.onPortLost() here; Wave 2 leaves it for Wave 4.
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

// Error log helper (stub — Wave 4 owns the ring of 5; Wave 2 just appends one line).
function appendErrorLog(code, message) {
    const ts = new Date().toTimeString().slice(0, 8);
    const line = `${ts} ${code}: ${message}`;
    console.error('[serial]', line);
    if (!errorLogEl) return;
    // Wave 4 swaps this for a proper last-5 ring. Wave 2 naive append (one line).
    errorLogEl.textContent = line;
}

// VID/PID persistence stub (Wave 4 implements the localStorage write; Wave 2 no-ops
// to keep the call graph stable so Wave 4 lands via Edit not a new call-site).
function persistVidPid(p) {
    // Wave 4 Plan 05 — localStorage.setItem('bestialitty.port.preset', JSON.stringify(...))
    // Wave 2 leaves this as a no-op to keep the function-call graph stable.
}
