// BestialiTTY Phase 5 — paste throttling queue (setTimeout chain).
//
// Public API: enqueuePaste, cancelPaste, isActive, onProgress, onPortLost.
//
// Sources:
//   - 05-CONTEXT.md D-12..D-23 (public API, pacing, CR/LF, port-lost, local-echo).
//   - 05-RESEARCH.md Pattern 4 (setTimeout chain with self-scheduling);
//     Pitfall 6 (nested 4ms clamp).
//   - Analog: www/input/tx-sink.js (module-scope state + observer pattern).
//
// Wave 1 = SKELETON ONLY — all exports return sensible defaults. Wave 4
// Plan 06 implements the pump body, chunk timer, and CR/LF rewrite.

const CHUNK_SIZE = 32;               // D-14 compile-in constant (reserved; not used in Wave 1)
let gapMs = 18;                       // D-14 — computed at 19200 8N1 (reserved; not used)
let queue = new Uint8Array(0);       // D-12 — bytes awaiting transmission (reserved)
let cursor = 0;                       // bytes consumed from queue (reserved)
let timer = null;                     // setTimeout handle (reserved)
const progressObservers = [];         // fan-out — D-17 Connection pane hooks this

// --- Public API -----------------------------------------------------------

export function enqueuePaste(bytes) {
    // Wave 4 implementation — for now, log and do nothing.
    console.warn('[paste-pump] enqueuePaste stub; bytes.length =', bytes.length);
}

export function cancelPaste() {
    // Wave 4 implementation.
    console.warn('[paste-pump] cancelPaste stub');
}

export function isActive() {
    // Wave 4: return (timer !== null) || (cursor < queue.length).
    return false;
}

export function onProgress(fn) {
    progressObservers.push(fn);
}

export function onPortLost() {
    // Wave 4: clear queue + fire final progress event.
    console.warn('[paste-pump] onPortLost stub');
}

// --- Internals -----------------------------------------------------------

function fireProgress(status, extra = {}) {
    for (const fn of progressObservers) fn({ status, ...extra });
}
