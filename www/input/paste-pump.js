// BestialiTTY Phase 5 — paste throttling queue (setTimeout chain).
//
// Public API: enqueuePaste, cancelPaste, isActive, onProgress, onPortLost, wirePastePump.
//
// Sources:
//   - 05-CONTEXT.md D-12..D-23.
//   - 05-RESEARCH.md Pattern 4 (setTimeout chain; Pitfall 6 — 4ms clamp).
//   - 05-UI-SPEC.md §"Paste-pump UI interactions" + §"Connection pane" progress copy.
//   - Analog: www/input/tx-sink.js (module-scope state + observer fan-out).

import { pushTxBytes } from './tx-sink.js';
import { getLocalEcho, getCrlfMode, CRLF_MODES } from './keyboard.js';

// Compile-in constants — D-14 (32B / 18ms @ 19200 targets 90% of 1920 B/s byte rate).
const CHUNK_SIZE = 32;

// Pump state.
let gapMs = computeGap(19200);
let queue = new Uint8Array(0);
let cursor = 0;
let timer = null;
const progressObservers = [];

// Injected deps (wirePastePump sets these — enables D-22 local-echo from the pump).
let termRef = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;

// --- Public API -----------------------------------------------------------

export function wirePastePump(opts) {
    const { term, sampleBell, drainHostReply, requestFrame } = opts;
    termRef = term;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
}

export function enqueuePaste(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    // D-23 — CR/LF rewrite BEFORE enqueue (not mid-pump).
    const rewritten = applyCrlfRewrite(bytes);
    // Drop bytes already consumed; append new bytes.
    const remaining = queue.subarray(cursor);
    const merged = new Uint8Array(remaining.length + rewritten.length);
    merged.set(remaining, 0);
    merged.set(rewritten, remaining.length);
    queue = merged;
    cursor = 0;
    if (!timer && cursor < queue.length) {
        fireProgress('started', { total: queue.length });
        writeOneChunk();
    }
}

export function cancelPaste() {
    if (timer === null && cursor >= queue.length) return;
    if (timer) { clearTimeout(timer); timer = null; }
    const unsent = Math.max(0, queue.length - cursor);
    queue = new Uint8Array(0);
    cursor = 0;
    fireProgress('cancelled', { unsent });
}

export function isActive() {
    return timer !== null || cursor < queue.length;
}

export function onProgress(fn) {
    progressObservers.push(fn);
}

export function onPortLost() {
    // D-20 — mid-paste port-lost drains the queue and fires a dedicated status.
    if (!isActive()) return;
    if (timer) { clearTimeout(timer); timer = null; }
    const unsent = Math.max(0, queue.length - cursor);
    queue = new Uint8Array(0);
    cursor = 0;
    fireProgress('cancelled-port-lost', { unsent });
}

export function setBaudForPump(baud) {
    // Wave 5 opportunistic recompute. Called from serial.js on config-driven connect.
    // D-13 — pace target recomputes on baud change.
    gapMs = computeGap(baud);
}

// --- Internals ------------------------------------------------------------

function computeGap(baud) {
    const byteRate = (baud / 10) * 0.90;   // D-13 — 90% of 8N1 byte rate.
    return Math.max(4, Math.round((CHUNK_SIZE / byteRate) * 1000));  // floor at 4ms (Pitfall 6).
}

function writeOneChunk() {
    timer = null;  // Allow cancel during write.
    const remaining = queue.length - cursor;
    if (remaining <= 0) {
        fireProgress('complete');
        return;
    }
    const take = Math.min(CHUNK_SIZE, remaining);
    const chunk = queue.subarray(cursor, cursor + take);
    cursor += take;

    // D-21 — route through tx-sink (which calls registeredWriter.write when connected).
    pushTxBytes(chunk);

    // D-22 — local-echo: feed chunk to term after writer.write, preserving
    // sampleBell → drainHostReply → requestFrame invariant.
    if (getLocalEcho() && termRef) {
        termRef.feed(chunk);
        if (sampleBellFn) sampleBellFn();
        if (drainHostReplyFn) drainHostReplyFn('paste-echo');
        if (requestFrameFn) requestFrameFn();
    }

    fireProgress('chunk', { written: cursor, total: queue.length });

    if (cursor < queue.length) {
        timer = setTimeout(writeOneChunk, gapMs);
    } else {
        fireProgress('complete');
    }
}

function applyCrlfRewrite(bytes) {
    // D-23 — mode 'cr' = passthrough; 'lf' = 0x0D → 0x0A; 'crlf' = 0x0D → 0x0D 0x0A.
    const mode = getCrlfMode();
    if (mode === 'cr') return bytes;

    if (mode === 'lf') {
        const out = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            out[i] = (bytes[i] === 0x0D) ? 0x0A : bytes[i];
        }
        return out;
    }

    // mode === 'crlf' — expansion. First pass: count 0x0D bytes to size the output.
    let crCount = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0D) crCount += 1;
    const out = new Uint8Array(bytes.length + crCount);
    let w = 0;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x0D) {
            out[w++] = 0x0D;
            out[w++] = 0x0A;
        } else {
            out[w++] = bytes[i];
        }
    }
    return out;
}

// CRLF_MODES re-export suppresses the "unused import" linter warning and makes
// the table identity visible from this module for any future diagnostic/test.
export { CRLF_MODES };

function fireProgress(status, extra = {}) {
    for (const fn of progressObservers) fn({ status, ...extra });
}
