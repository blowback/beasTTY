// Beastty Epic E4 Story E4.1 — bottom status bar: connection projector.
//
// A new chrome surface (FR-26) that is FED, NEVER OWNED (AD-6). It holds no
// independent truth: the one true connection state lives in transport/serial.js's
// state machine; this module SUBSCRIBES via wireStatusBar opts and projects
// state → frozen label map → #port-status textContent + #status-conn-dot
// [data-state]. It is the single writer of its own two DOM fields (NFR-4),
// coexisting with menu-bar.js (#menu-conn-dot) — the two dots that render the
// same serial state, both reading the same serial.onStateChange truth. (E7.1 —
// the old #top-bar #connect-button that also read this state is gone.)
//
// Follows the www/renderer/scroll-state.js / www/renderer/slide-chip.js template
// (AD-2): module-scope state + injected …Ref vars + wireStatusBar(opts) → API +
// private projectConnection(state) + dispose() + __getStateForTests/__resetForTests.
//
// Direct-import allowlist (AD-3): this module imports state/prefs.js AND the shared
// AD-10 focus helper (renderer/focus.js — retainFocus, mandatory on every new
// interactive chrome control, the same import chrome.js uses; E4.3 adds the bar's
// first focusable control). Every other dependency (onConnectionStateChange,
// getConnectionState, and — E4.3 — openSerialConfig/getRecentErrorCount) arrives
// through wireStatusBar opts, injected by main.js at the composition root (AD-1) —
// it must NOT import serial.js, modal.js, menu-bar.js, or slide-chip.js.
//
// Sources:
//   - ARCHITECTURE-SPINE.md #AD-6 (fed/never-owned), #AD-5 (subscribe to federated
//     state), #AD-3 (import allowlist), #AD-1/#AD-2 (composition-root + wireXxx
//     shape), #AD-9 (neutral shell), #AD-12 (boot order), #AD-15 (serial DOM
//     projection injected out — precedent).
//   - EXPERIENCE.md #Status-bar (per-state text, connected-line format, aria-live).
//   - DESIGN.md #Status-bar (four discrete dot colours, snap-never-animate).
//   - Analog: www/renderer/menu-bar.js:387-401 (subscribe + initial paint),
//     :1369-1377 (projectConnection), :63-82 (frozen CONN_STATUS_LABELS).

import { getPrefs, CONN_STATUS_LABELS, MICROBEAST_DEVICE_LABEL, BUILD_UNKNOWN_SHA, formatFraming as composeFraming } from '../state/prefs.js';
import { retainFocus } from './focus.js';   // E4.3 (AD-10) — the bar's first interactive control

// ====== Frozen label maps ======

// E4.1 review fix (#9) — the non-connected state → text map is single-sourced in
// prefs.js and shared with menu-bar.js's #menu-conn-label projector, so the two
// connection surfaces can never drift. `connected` is composed dynamically (device
// + baud/framing) so this projector reads only the four non-connected entries from
// CONN_STATUS_LABELS (the shared map also carries connected → 'Connected', which
// this module never reads because composeText handles 'connected' explicitly).

// The device segment of the `connected` (and boot "click Connect") line is normally
// injected from serial.js's getConnectionDevice() — the ACTUAL connected/granted
// device, so a "Show all serial devices" connection to a non-CP2102N adapter is not
// mislabelled as a MicroBeast (fix #7). This literal is only the FALLBACK for the
// no-serial harness path (projectConnection driven directly with no port open); it
// reuses serial.js's canonical MicroBeast string via the shared prefs.js export
// (MICROBEAST_DEVICE_LABEL) so the two can never drift (the boot scan / stock adapter case).
const DEVICE_LABEL = MICROBEAST_DEVICE_LABEL;

// ====== Module-scope state ======

// Injected deps (set by wireStatusBar).
let dotElRef = null;              // #status-conn-dot
let textElRef = null;             // #port-status
// E4.2 — the right-group fields (FR-27). status-bar.js is their single writer
// (AD-6); both hold no independent truth and arrive via imperative push:
// setBuild (one-shot async build stamp) / setZoom (the pushZoom sink).
let buildElRef = null;            // #status-build
let zoomElRef = null;             // #status-zoom
// E4.3 — the recent-errors affordance (FR-28). status-bar.js is its single writer
// (AD-6, holds no independent truth): the count arrives via imperative push
// (setErrorCount, fed from serial.js's observer-less errorLog through main.js) and
// the click reuses the injected E2.3 opener. Both deps arrive via wireStatusBar
// opts — status-bar.js imports neither serial.js nor modal.js (AD-3).
let errorsElRef = null;           // #status-errors (the clickable affordance)
let openSerialConfigFn = null;    // = main.js openSerialConfig (the E2.3 opener, AD-8)
let getRecentErrorCountFn = null; // = serial.getRecentErrorCount (initial-paint read)
let onConnectionStateChangeFn = null;   // = serial.onStateChange
let getConnectionStateFn = null;        // = serial.getState
let getConnectionFramingFn = null;      // = serial.getActiveFraming (fix #2 — live open-config framing)
let getConnectionErrorFn = null;        // = serial.getLastConnectError (fix #4 — connect-failure cue)
let getConnectionDeviceFn = null;       // = serial.getConnectionDevice (fix #7 — actual device label)

// Subscription closure returned by onConnectionStateChange — dropped in dispose()
// and before an idempotent re-wire (mirror menu-bar.js:394).
let connUnsub = null;

// E4.3 — the #status-errors click listener, kept so an idempotent re-wire can drop
// it before re-adding (mirrors the connUnsub drop-before-resubscribe discipline) —
// a re-wire must never stack duplicate openers. retainFocus is separately idempotent
// (its own WeakSet), so its mousedown handler needs no such bookkeeping.
let errorsClickHandler = null;

// Last state projected — read by showBootReady() (re-project only while disconnected)
// and exposed via __getStateForTests for introspection.
let lastState = 'disconnected';

// fix (#3) — set true when serial's boot getPorts() scan recognizes an already-
// granted MicroBeast (pushed via showBootReady). While true AND disconnected, the
// readout shows the "…— click Connect" affordance. Cleared on the 'connected'
// transition (NOT the transient 'connecting') so post-connect disconnects show the
// plain idle label while a cancelled picker keeps the cue.
let bootDeviceReady = false;

// ====== Baud/framing composition (prefs read AT USE-TIME — never cached across a
// savePrefs; AD-4 — savePrefs does not fan out) ======

// Build the `19200 8N1` segment from getPrefs().serial. The defensive merge in
// prefs.js guarantees .serial and its fields are never undefined (prefs.js:94).
// NB the prefs blob uses `baud` (SerialPort.open() uses `baudRate` — a different
// schema; read `baud` here, serial.js:41-43).
function formatFraming() {
    // Guard getPrefs() → null (prefs not yet loaded, e.g. a harness driving
    // projectConnection('connected') before loadPrefs()). projectConnection is
    // documented no-throw, so degrade to '' rather than dereferencing null.serial —
    // every other getPrefs() read in this module (setZoom) is likewise `?.`-guarded.
    const serial = getPrefs()?.serial;
    if (!serial) return '';
    // Shared pure formatter (prefs.js) — the prefs blob uses `baud`; serial.js's
    // live path maps `baudRate` onto the same helper so both format identically.
    return composeFraming(serial);
}

// ====== Projection (the sole writer of #status-conn-dot + #port-status) ======

// state → dot [data-state] (CSS drives the discrete colour) + #port-status text.
// `connected` composes the device/baud line; every other state maps through the
// shared CONN_STATUS_LABELS (unknown → disconnected fallback). Null-guarded + no-throw +
// idempotent (mirrors menu-bar.js projectConnection); NEVER re-drives the serial
// machine (reading state must not call a serial setter).
function projectConnection(state) {
    lastState = state;
    // Clear the boot cue only once we ACTUALLY connect — never on the transient
    // 'connecting'. Clearing on 'connecting' dropped the returning-user cue when the
    // native port picker was cancelled (connecting → disconnected, lastConnectError
    // cleared at connect entry), leaving a bare 'Not connected' over a still-granted,
    // still-connectable adapter until reload. A successful connect still clears it, so
    // post-connect disconnects show the plain idle label (pre-relocation behavior).
    if (state === 'connected') bootDeviceReady = false;
    if (dotElRef) dotElRef.dataset.state = state;
    if (textElRef) textElRef.textContent = composeText(state);
}

// The device label for the connected / boot-ready lines: the ACTUAL device from
// serial.js (fix #7 — a "Show all serial devices" connection to a non-CP2102N
// adapter must not be mislabelled as a MicroBeast), falling back to the canonical
// literal only when the seam is absent (harness).
function deviceLabel() {
    return (getConnectionDeviceFn && getConnectionDeviceFn()) || DEVICE_LABEL;
}

// state → readout text. Precedence handled per state:
//   connected    → device + live open-config framing (fix #2/#7)
//   disconnected → connect-failure message (fix #4) > boot "click Connect" cue
//                  (fix #3) > 'Not connected'
//   other        → shared CONN_STATUS_LABELS (unknown → disconnected fallback)
function composeText(state) {
    if (state === 'connected') {
        // Prefer the framing the live port was ACTUALLY opened with (injected from
        // serial.js's lastConfig); fall back to the prefs-derived string only when
        // that seam is absent (harness) — never let a mid-session prefs change that
        // hasn't been applied to the port misreport the wire framing.
        const framing = (getConnectionFramingFn && getConnectionFramingFn()) || formatFraming();
        // Omit the dash when framing is unavailable (prefs not loaded) so the readout
        // never shows a dangling "MicroBeast — ". em-dash U+2014.
        return framing ? `${deviceLabel()} — ${framing}` : deviceLabel();
    }
    if (state === 'disconnected') {
        const err = getConnectionErrorFn ? getConnectionErrorFn() : null;
        if (err) return err;
        if (bootDeviceReady) return `${deviceLabel()} — click Connect`;
        return CONN_STATUS_LABELS.disconnected;
    }
    return CONN_STATUS_LABELS[state] || CONN_STATUS_LABELS.disconnected;
}

// ====== Right group: build SHA + zoom (E4.2, FR-27 — the sole writer of
// #status-build + #status-zoom; both fed by imperative push, AD-6) ======

// Build SHA readout — fed the one-shot async build stamp (main.js pushes on the
// pkg/build-info.js import resolve; status-bar.js must NOT import it — AD-3). Text
// is the FULL BUILD_INFO.sha so the bar and Help ▸ About render one source and
// never disagree; the builtAt timestamp goes on the title (mirrors the old debug
// pane). Null-guarded so the no-markup harness path never throws.
function setBuild(info) {
    if (!buildElRef) return;
    buildElRef.textContent = `build ${info?.sha ?? BUILD_UNKNOWN_SHA}`;
    if (info?.builtAt) buildElRef.title = `built ${info.builtAt}`;
}

// Zoom readout — fed by main.js's pushZoom sink (View ▸ Zoom items AND the
// Ctrl+{=,-,0} chord both funnel here). `level` is the integer 1..4 (main.js
// pushes the CLAMPED getActiveZoom(), so this never renders an out-of-range
// stored value); `×` is the multiplication sign U+00D7 (never the letter x).
// Null-guarded. The DOM text is the single store of the level — tests read it
// via __getStateForTests().zoom (no separate mirror to drift).
function setZoom(level) {
    if (!zoomElRef) return;
    zoomElRef.textContent = `zoom ${level}×`;
}

// Best-effort pre-paint of the stored zoom before main.js's authoritative
// pushZoom(getActiveZoom()) lands. loadPrefs does NOT clamp fontZoom, so a corrupt or
// hand-edited value (e.g. 0 or 6) must be clamped to the canvas's [1,4] range here —
// `?? 1` alone let a falsy 0 through and rendered an impossible "zoom 0×". Mirrors the
// canvas clamp so the pre-paint never shows a level the terminal cannot display.
const ZOOM_MIN = 1, ZOOM_MAX = 4;
function prefsZoomLevel() {
    const raw = getPrefs()?.fontZoom;
    const n = Number.isFinite(raw) ? Math.round(raw) : ZOOM_MIN;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

// ====== Recent-errors affordance (E4.3, FR-28 — the sole writer of #status-errors;
// fed by imperative push off serial.js's observer-less errorLog, AD-6) ======

// setErrorCount(n) — the AD-6 imperative-push hook. serial.js's appendErrorLog fires
// main.js's closure, which calls this with errorLog.length; the initial paint reads
// the injected getRecentErrorCount (0 at boot). Renders `▲ <n> recent error(s)`
// (▲ = U+25B2), pluralising 1 vs N, and tints amber ONLY while count > 0 via the
// data-has-errors attribute (never an inline style — DESIGN.md: amber = "action
// required, not error", spent only when there is something to see). Null-guarded so
// the no-markup harness path never throws; the count is coerced (`n | 0`) so a stray
// null/undefined/string push lands as 0, not NaN.
function setErrorCount(n) {
    if (!errorsElRef) return;
    const c = n | 0;
    errorsElRef.textContent = `▲ ${c} recent ${c === 1 ? 'error' : 'errors'}`;
    errorsElRef.dataset.hasErrors = c > 0 ? 'true' : 'false';
}

// ====== wireStatusBar initializer (composition-root DI — AD-1/AD-2) ======

export function wireStatusBar(opts) {
    const {
        onConnectionStateChange,   // = serial.onStateChange (observer source)
        getConnectionState,        // = serial.getState (sync initial read)
        getConnectionFraming,      // = serial.getActiveFraming (fix #2)
        getConnectionError,        // = serial.getLastConnectError (fix #4)
        getConnectionDevice,       // = serial.getConnectionDevice (fix #7)
        openSerialConfig,          // E4.3 — the E2.3 modal opener (AD-8); reused verbatim on click
        getRecentErrorCount,       // E4.3 — serial.getRecentErrorCount for the initial paint
    } = opts || {};

    // Grab the owned fields by id (mirror how menu-bar.js grabs #menu-conn-dot).
    dotElRef = document.getElementById('status-conn-dot');
    textElRef = document.getElementById('port-status');
    buildElRef = document.getElementById('status-build');   // E4.2 right group
    zoomElRef = document.getElementById('status-zoom');      // E4.2 right group
    errorsElRef = document.getElementById('status-errors');  // E4.3 recent-errors affordance
    onConnectionStateChangeFn = onConnectionStateChange || null;
    getConnectionStateFn = getConnectionState || null;
    getConnectionDeviceFn = getConnectionDevice || null;
    getConnectionFramingFn = getConnectionFraming || null;
    getConnectionErrorFn = getConnectionError || null;
    openSerialConfigFn = openSerialConfig || null;           // E4.3
    getRecentErrorCountFn = getRecentErrorCount || null;     // E4.3

    // Drop any prior subscription BEFORE re-subscribing so an idempotent re-wire
    // never double-registers projectConnection (mirror menu-bar.js:394). connUnsub
    // is a serial closure, not a tracked DOM listener.
    if (connUnsub) { connUnsub(); connUnsub = null; }
    if (onConnectionStateChangeFn) {
        connUnsub = onConnectionStateChangeFn(projectConnection);
    }
    // Initial paint (AD-1). status-bar wires after wireSerial's boot scan but the
    // machine starts 'disconnected', so the first paint is Not connected / gray.
    projectConnection(getConnectionStateFn ? (getConnectionStateFn() || 'disconnected') : 'disconnected');

    // E4.2 — best-effort initial zoom paint from prefs (AD-3 allowlist — getPrefs
    // is imported), so the bar shows the stored level before the authoritative push
    // rather than flashing the placeholder across the `await wireSerial` that sits
    // between this wire and main.js's boot applyPrefs. This is a PRE-paint only:
    // main.js's pushZoom(getActiveZoom()) at boot AND every resetPrefs() feeds the
    // CLAMPED, applied level and is the source of truth (canvas clamps to [1,4],
    // this raw read does not). `?? 1` keeps it crash-safe if getPrefs() is null
    // (loadPrefs not yet run) — it must not abort the wire. Build has no synchronous
    // source, so its placeholder holds until main.js pushes setBuild on import.
    setZoom(prefsZoomLevel());

    // E4.3 — the recent-errors affordance. Drop the prior click listener before
    // re-adding (mirror the connUnsub drop-before-resubscribe idiom) so an idempotent
    // re-wire never stacks duplicate openers; then retainFocus so a MOUSE click never
    // transfers keyboard focus off the terminal (AD-10/NFR-1 — the button branch:
    // mousedown → preventDefault, the click handler still fires and opens the modal).
    // retainFocus is idempotent via its own WeakSet, so a re-wire is a safe no-op there.
    if (errorsElRef) {
        if (errorsClickHandler) errorsElRef.removeEventListener('click', errorsClickHandler);
        errorsClickHandler = () => { if (openSerialConfigFn) openSerialConfigFn(); };
        errorsElRef.addEventListener('click', errorsClickHandler);
        retainFocus(errorsElRef);   // button branch — no restoreTarget needed
    }
    // Initial paint (AD-1) — read the injected count getter (0 at boot; serial.js has
    // run no connect attempt yet), so the field is correct at first paint without
    // waiting for a push. Falls back to 0 when the getter seam is absent (harness).
    setErrorCount(getRecentErrorCountFn ? getRecentErrorCountFn() : 0);

    return {
        // fix (#3) — serial's boot getPorts() scan calls this (via main.js) when it
        // recognizes an already-granted MicroBeast, so a returning user sees the
        // "…— click Connect" cue instead of a bare "Not connected". Only re-paints
        // while disconnected (a live connection's readout must win).
        showBootReady() {
            bootDeviceReady = true;
            if (lastState === 'disconnected') projectConnection('disconnected');
        },
        // Expose the projection so tests can drive discrete states deterministically
        // (incl. the transient connecting/reconnecting labels) without racing a live
        // serial handshake — mirrors menu-bar.js's projectConnection test seam.
        projectConnection,
        // E4.2 (AD-6) imperative-push hooks for the two observer-less right-group
        // sources: setBuild for the one-shot async build stamp, setZoom for the
        // pushZoom sink (both View items + the Ctrl chord). main.js is the caller.
        setBuild,
        setZoom,
        // E4.3 (AD-6) imperative-push hook for the observer-less errorLog: main.js's
        // closure calls this with errorLog.length on every appendErrorLog.
        setErrorCount,
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

// ====== Lifecycle ======

function dispose() {
    if (connUnsub) { connUnsub(); connUnsub = null; }
    // E4.3 — drop the recent-errors click opener too, so a disposed bar is fully
    // inert (a bare dispose() with no re-wire otherwise leaves the affordance still
    // opening the serial-config modal). Mirrors the wire-time drop-before-re-add;
    // retainFocus's mousedown handler is idempotent (its own WeakSet) and harmless.
    if (errorsClickHandler && errorsElRef) {
        errorsElRef.removeEventListener('click', errorsClickHandler);
        errorsClickHandler = null;
    }
}

// ====== Test introspection (matches the scroll-state/slide-chip pattern) ======

export function __getStateForTests() {
    return {
        state: lastState,
        dotState: dotElRef ? dotElRef.dataset.state : null,
        text: textElRef ? textElRef.textContent : null,
        hasSubscription: connUnsub !== null,
        // E4.2 right group
        build: buildElRef ? buildElRef.textContent : null,
        zoom: zoomElRef ? zoomElRef.textContent : null,
        // E4.3 recent-errors affordance
        errors: errorsElRef ? errorsElRef.textContent : null,
        hasErrors: errorsElRef ? errorsElRef.dataset.hasErrors : null,
    };
}

export function __resetForTests() {
    if (connUnsub) { connUnsub(); connUnsub = null; }
    lastState = 'disconnected';
    bootDeviceReady = false;
    if (dotElRef) dotElRef.dataset.state = 'disconnected';
    if (textElRef) textElRef.textContent = CONN_STATUS_LABELS.disconnected;
    // E4.2 — build reverts to its placeholder (no synchronous source); zoom
    // re-paints from prefs (mirrors the crash-safe initial wire-time paint).
    if (buildElRef) buildElRef.textContent = 'build …';
    setZoom(prefsZoomLevel());
    // E4.3 — revert the errors field to its 0/false placeholder.
    setErrorCount(0);
}
