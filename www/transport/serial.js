// BestialiTTY Phase 5 — Web Serial transport (JS-only; no Rust bindings).
//
// Public API: renderPoliteFail, wireSerial, connectMicroBeast, disconnect,
// getState, onStateChange, getWriter.
//
// Sources:
//   - 05-CONTEXT.md D-01..D-42.
//   - 05-RESEARCH.md Patterns 1-7 + Example 1.
//   - 05-UI-SPEC.md §"Polite-fail page" (exact copy for renderPoliteFail).
//   - Pitfalls #1 (reader-lock), #6 (bg-tab), #10 (TextDecoder), #11 (identity), #12 (DTR/RTS).
//   - Analog: www/renderer/chrome.js (wireX(opts) pattern);
//     www/renderer/canvas.js:37-51 (module-scope state).
//
// Wave 1 = SKELETON — renderPoliteFail is fully implemented; every other export
// is a stub that Waves 2-5 layer functionality onto via Edit (not rewrite).

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

    // Wave 2+ wires: navigator.serial listeners, getPorts() restore,
    // beforeunload handler, connect button click handler.
    console.log('[serial] wireSerial (skeleton) — Wave 2 implements port grant.');
}

export function connectMicroBeast(configOverride) {
    // Wave 2 implementation.
    console.warn('[serial] connectMicroBeast — stub');
}

export async function disconnect() {
    console.warn('[serial] disconnect — stub');
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
