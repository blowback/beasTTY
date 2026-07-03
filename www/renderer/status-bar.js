// Beastty Epic E4 Story E4.1 — bottom status bar: connection projector.
//
// A new chrome surface (FR-26) that is FED, NEVER OWNED (AD-6). It holds no
// independent truth: the one true connection state lives in transport/serial.js's
// state machine; this module SUBSCRIBES via wireStatusBar opts and projects
// state → frozen label map → #port-status textContent + #status-conn-dot
// [data-state]. It is the single writer of its own two DOM fields (NFR-4),
// coexisting with menu-bar.js (#menu-conn-dot) and — until E7 — nothing else,
// all reading the same serial.onStateChange truth.
//
// Follows the www/renderer/scroll-state.js / www/renderer/slide-chip.js template
// (AD-2): module-scope state + injected …Ref vars + wireStatusBar(opts) → API +
// private projectConnection(state) + dispose() + __getStateForTests/__resetForTests.
//
// Direct-import allowlist (AD-3): this module imports ONLY state/prefs.js. Every
// other dependency (onConnectionStateChange, getConnectionState) arrives through
// wireStatusBar opts, injected by main.js at the composition root (AD-1) — it must
// NOT import serial.js, menu-bar.js, or slide-chip.js.
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

import { getPrefs, CONN_STATUS_LABELS } from '../state/prefs.js';

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
// mirrors serial.js's canonical MicroBeast string (the boot scan / stock adapter case).
const DEVICE_LABEL = 'MicroBeast (CP2102N 10c4:ea60)';

// ====== Module-scope state ======

// Injected deps (set by wireStatusBar).
let dotElRef = null;              // #status-conn-dot
let textElRef = null;             // #port-status
let onConnectionStateChangeFn = null;   // = serial.onStateChange
let getConnectionStateFn = null;        // = serial.getState
let getConnectionFramingFn = null;      // = serial.getActiveFraming (fix #2 — live open-config framing)
let getConnectionErrorFn = null;        // = serial.getLastConnectError (fix #4 — connect-failure cue)
let getConnectionDeviceFn = null;       // = serial.getConnectionDevice (fix #7 — actual device label)

// Subscription closure returned by onConnectionStateChange — dropped in dispose()
// and before an idempotent re-wire (mirror menu-bar.js:394).
let connUnsub = null;

// Last state projected — kept for setConnectionInfo() re-projection + test
// introspection.
let lastState = 'disconnected';

// fix (#3) — set true when serial's boot getPorts() scan recognizes an already-
// granted MicroBeast (pushed via showBootReady). While true AND disconnected, the
// readout shows the "…— click Connect" affordance. Cleared on the first transition
// away from 'disconnected' so post-connect disconnects show the plain idle label.
let bootDeviceReady = false;

// ====== Baud/framing composition (prefs read AT USE-TIME — never cached across a
// savePrefs; AD-4 — savePrefs does not fan out) ======

// Build the `19200 8N1` segment from getPrefs().serial. The defensive merge in
// prefs.js guarantees .serial and its fields are never undefined (prefs.js:94).
// NB the prefs blob uses `baud` (SerialPort.open() uses `baudRate` — a different
// schema; read `baud` here, serial.js:41-43).
function formatFraming() {
    const { baud, dataBits, parity, stopBits } = getPrefs().serial;
    const p = String(parity || 'none')[0].toUpperCase();   // 'none' → 'N'
    return `${baud} ${dataBits}${p}${stopBits}`;
}

// ====== Projection (the sole writer of #status-conn-dot + #port-status) ======

// state → dot [data-state] (CSS drives the discrete colour) + #port-status text.
// `connected` composes the device/baud line; every other state maps through the
// shared CONN_STATUS_LABELS (unknown → disconnected fallback). Null-guarded + no-throw +
// idempotent (mirrors menu-bar.js projectConnection); NEVER re-drives the serial
// machine (reading state must not call a serial setter).
function projectConnection(state) {
    lastState = state;
    // Any transition away from 'disconnected' clears the boot cue: once connected,
    // later disconnects show the plain idle label (matches the pre-relocation
    // #port-status behavior).
    if (state !== 'disconnected') bootDeviceReady = false;
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
        return `${deviceLabel()} — ${framing}`;   // em-dash U+2014
    }
    if (state === 'disconnected') {
        const err = getConnectionErrorFn ? getConnectionErrorFn() : null;
        if (err) return err;
        if (bootDeviceReady) return `${deviceLabel()} — click Connect`;
        return CONN_STATUS_LABELS.disconnected;
    }
    return CONN_STATUS_LABELS[state] || CONN_STATUS_LABELS.disconnected;
}

// ====== wireStatusBar initializer (composition-root DI — AD-1/AD-2) ======

export function wireStatusBar(opts) {
    const {
        onConnectionStateChange,   // = serial.onStateChange (observer source)
        getConnectionState,        // = serial.getState (sync initial read)
        getConnectionFraming,      // = serial.getActiveFraming (fix #2)
        getConnectionError,        // = serial.getLastConnectError (fix #4)
        getConnectionDevice,       // = serial.getConnectionDevice (fix #7)
    } = opts || {};

    // Grab the two owned fields by id (mirror how menu-bar.js grabs #menu-conn-dot).
    dotElRef = document.getElementById('status-conn-dot');
    textElRef = document.getElementById('port-status');
    onConnectionStateChangeFn = onConnectionStateChange || null;
    getConnectionStateFn = getConnectionState || null;
    getConnectionDeviceFn = getConnectionDevice || null;
    getConnectionFramingFn = getConnectionFraming || null;
    getConnectionErrorFn = getConnectionError || null;

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

    return {
        // AD-6 imperative-push hook: observer-less sources (a baud/serial-config
        // change in prefs — savePrefs does NOT fan out) call this to re-project the
        // current state, re-reading getPrefs().serial. Full modal wiring is out of
        // scope for E4.1; the primary path is the prefs read on each `connected`
        // projection (a mid-session baud change lands on the next connect). This is
        // just the hook so E4.2+/the serial-config modal can push on demand.
        setConnectionInfo() { projectConnection(lastState); },
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
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

// ====== Lifecycle ======

function dispose() {
    if (connUnsub) { connUnsub(); connUnsub = null; }
}

// ====== Test introspection (matches the scroll-state/slide-chip pattern) ======

export function __getStateForTests() {
    return {
        state: lastState,
        dotState: dotElRef ? dotElRef.dataset.state : null,
        text: textElRef ? textElRef.textContent : null,
        hasSubscription: connUnsub !== null,
    };
}

export function __resetForTests() {
    if (connUnsub) { connUnsub(); connUnsub = null; }
    lastState = 'disconnected';
    bootDeviceReady = false;
    if (dotElRef) dotElRef.dataset.state = 'disconnected';
    if (textElRef) textElRef.textContent = CONN_STATUS_LABELS.disconnected;
}
