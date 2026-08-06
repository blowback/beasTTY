// Beastty Phase 5 — paste throttling queue (setTimeout chain).
//
// Public API: enqueuePaste, cancelPaste, isActive, onProgress, onPortLost,
//             wirePastePump, setBaudForPump, setPasteLineEnding, setPasteSpeed,
//             getPasteLineEnding, getPasteSpeed, getPasteRate.
//
// Sources:
//   - 05-CONTEXT.md D-12..D-23.
//   - 05-RESEARCH.md Pattern 4 (setTimeout chain; Pitfall 6 — 4ms clamp).
//   - 05-UI-SPEC.md §"Paste-pump UI interactions" + §"Connection pane" progress copy.
//   - Analog: www/input/tx-sink.js (module-scope state + observer fan-out).

import { pushTxBytes } from './tx-sink.js';
// getLocalEcho only. This module used to read getCrlfMode() too, so pasting was
// silently governed by Settings ▸ Enter key sends; paste now has its own line-
// ending setting and the two settings never read each other.
import { getLocalEcho } from './keyboard.js';
// Phase 11 Plan 11-03 D-12 — paste is refused during an active SLIDE session
// (SLIDE-33 / T-11-03-paste-leak mitigation). enqueuePaste no-ops while a
// transfer is running. The matching cancelPaste() is invoked at SLIDE
// wakeup-completion in www/transport/slide.js (D-12 surface 1) so an
// in-flight large paste interrupts via the existing Phase 5 D-18 cancel chip.
//
// E11 retrospective (2026-08-06) — this used to import slide-recv's
// receive-only predicate, so it refused pastes during a RECEIVE and allowed
// them during a SEND. The bytes then went to tx-sink, which drops them
// because the wire owner is 'slide' — so the user got a paste-progress chip
// advancing over a paste that transmitted nothing at all. D-12's intent was
// always "during an active SLIDE session"; now it asks the question that
// actually means that.
import { isTransferRunning } from '../transport/slide.js';

// Compile-in constants — D-14 (32B / 18ms @ 19200 targets 90% of 1920 B/s byte rate).
// CHUNK_SIZE is the FULL-SPEED write size and applies only when pasteSpeed is 0.
const CHUNK_SIZE = 32;

// The paced write size. 32 bytes written back-to-back at wire speed overruns the
// MicroBeast's 16-byte 16C550 receive FIFO however slowly we pace the average
// rate — the FIFO cannot hold the burst, so bytes are dropped inside a single
// chunk. 8 leaves the FIFO half empty with room to drain.
const PACED_CHUNK_SIZE = 8;

// A line break costs a full-screen editor (VIBE) a redraw where an ordinary
// character costs a buffer insert, so the pause after a chunk that ends in a
// terminator is longer: gapMs × 5, never below 50 ms.
const LINE_GAP_MULTIPLIER = 5;
const MIN_LINE_GAP_MS = 50;

// Accepted pasteSpeed range, in bytes/sec. 0 = full speed (see setPasteSpeed).
// The upper bound is above the byte rate of any baud the port offers, so it
// rejects nonsense from a corrupt/hand-edited prefs blob without ever rejecting
// a speed a real wire could carry — anything above the wire is clamped, not
// refused (see recomputePacing).
const MAX_PASTE_SPEED = 20000;

// The terminator each paste line-ending mode emits. `raw` is the pass-through
// mode and deliberately has no byte sequence — normaliseLineBreaks returns its
// input untouched. This table is the validator for setPasteLineEnding, and the
// menu's data-values are exactly these keys.
const PASTE_LINE_ENDINGS = Object.freeze({
    cr:   new Uint8Array([0x0D]),
    lf:   new Uint8Array([0x0A]),
    crlf: new Uint8Array([0x0D, 0x0A]),
    raw:  null,
});

// Pump state.
let baudRate = 19200;
let lineEnding = 'cr';           // prefs.pasteLineEnding — applied via setPasteLineEnding
let pasteSpeed = 240;            // prefs.pasteSpeed, bytes/sec (0 = full speed)
let chunkSize = PACED_CHUNK_SIZE;
let gapMs = 0;
let lineGapMs = 0;
let queue = new Uint8Array(0);
let cursor = 0;
let timer = null;
const progressObservers = [];

recomputePacing();               // seed chunkSize/gapMs/lineGapMs from the defaults above

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
    if (isTransferRunning()) {
        // Phase 11 Plan 11-03 D-12 — paste-pump gate during active SLIDE
        // session. Subsequent Ctrl+Shift+V attempts during the SLIDE session
        // no-op silently (no user surface — chip already says SLIDE is
        // active). The SLIDE wakeup-completion clause in slide.js calls
        // cancelPaste() so any in-flight large paste interrupts via the
        // existing Phase 5 D-18 cancel chip surface.
        return;
    }
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    // D-23 — line-break rewrite BEFORE enqueue (not mid-pump), so what sits in
    // the queue is exactly what goes on the wire and the chunker can split at
    // the real terminators.
    const rewritten = normaliseLineBreaks(bytes);
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
    // D-13 — the pacing target recomputes on baud change. Called from serial.js's
    // setLastConfig(), which is the single place the open port's config is
    // recorded, so this cannot drift out of step with the port again.
    //
    // E11 retrospective (2026-08-06) — this comment used to assert that
    // serial.js called it. Nothing did, in production or in a test, since the
    // day it was written: gapMs stayed at computeGap(19200) for the life of the
    // page regardless of the configured baud, so pasting on a slower connection
    // overran the wire the pump exists to stay under. Now actually wired.
    if (typeof baud !== 'number' || !Number.isFinite(baud) || baud <= 0) return;
    baudRate = baud;
    recomputePacing();
}

// Settings ▸ Paste line ending. Validated HERE, not in prefs.js — a stored blob
// can carry anything, and prefs.js has no field validation (the setCrlfMode
// precedent). An unknown mode is REJECTED, leaving the current value standing;
// on the boot path that is the 'cr' default, which is what "falls back to the
// default" means for a corrupt stored value.
export function setPasteLineEnding(mode) {
    if (!Object.prototype.hasOwnProperty.call(PASTE_LINE_ENDINGS, mode)) return;
    lineEnding = mode;
}

export function getPasteLineEnding() { return lineEnding; }

// Settings ▸ Paste speed, in bytes/sec. 0 means "as fast as the wire allows" —
// the pre-fix behaviour (32-byte writes at the baud-derived gap), kept for
// targets that can take it. Same reject-and-keep validation contract as
// setPasteLineEnding above.
export function setPasteSpeed(bytesPerSecond) {
    const n = Number(bytesPerSecond);
    if (!Number.isInteger(n) || n < 0 || n > MAX_PASTE_SPEED) return;
    pasteSpeed = n;
    recomputePacing();
}

export function getPasteSpeed() { return pasteSpeed; }

// The rate the pump will ACTUALLY achieve on a break-free run, in bytes/sec —
// derived from the chunk size and gap it is about to use rather than from the
// requested speed, so it already carries the wire clamp and the millisecond
// rounding. The large-paste confirm quotes this; before the pacing setting it
// estimated from baud alone, which is now wrong by an order of magnitude.
export function getPasteRate() {
    return Math.round((chunkSize / gapMs) * 1000);
}

// --- Internals ------------------------------------------------------------

// Derive chunk size + the two gaps from the current speed and baud. Called on
// every input that can change them (baud, speed) and once at module load.
function recomputePacing() {
    const wireRate = (baudRate / 10) * 0.90;   // D-13 — 90% of the 8N1 byte rate.
    if (pasteSpeed === 0) {
        // Full speed — byte-for-byte the pre-fix pump: 32-byte writes at the
        // baud-derived gap, and no special pause after a line break.
        chunkSize = CHUNK_SIZE;
        gapMs = Math.max(4, Math.round((chunkSize / wireRate) * 1000));  // floor at 4ms (Pitfall 6).
        lineGapMs = gapMs;
        return;
    }
    // Paced. The wire is still the ceiling: asking for 480 B/s on a 2400-baud
    // connection gets the 216 B/s the wire can carry, not a pump that overruns it.
    chunkSize = PACED_CHUNK_SIZE;
    const rate = Math.min(pasteSpeed, wireRate);
    gapMs = Math.max(4, Math.round((chunkSize / rate) * 1000));
    lineGapMs = Math.max(MIN_LINE_GAP_MS, gapMs * LINE_GAP_MULTIPLIER);
}

// Where the chunk starting at `start` ends (exclusive). At full speed that is
// simply the next 32-byte boundary. When paced it is the earlier of the chunk
// cap and the byte after the first line terminator — so a chunk either ends at
// a terminator or contains none, and the receiver gets a whole line's worth of
// pause to redraw before the next one arrives.
function chunkEnd(start) {
    const limit = Math.min(start + chunkSize, queue.length);
    if (pasteSpeed === 0) return limit;
    for (let i = start; i < limit; i++) {
        const b = queue[i];
        if (b !== 0x0D && b !== 0x0A) continue;
        if (b === 0x0D && queue[i + 1] === 0x0A) {
            // A CRLF terminator is two bytes and must not be split across two
            // writes. If the LF does not fit under the cap, end the chunk BEFORE
            // the CR instead — unless that would make an empty chunk (the pair
            // sits at the very start), in which case take both.
            if (i + 2 <= limit || i === start) return i + 2;
            return i;
        }
        return i + 1;
    }
    return limit;
}

function writeOneChunk() {
    timer = null;  // Allow cancel during write.
    const remaining = queue.length - cursor;
    if (remaining <= 0) {
        fireProgress('complete');
        return;
    }
    const end = chunkEnd(cursor);
    const chunk = queue.subarray(cursor, end);
    // A chunk that ends in a terminator earns the longer pause (identical to
    // gapMs at full speed, so that path is unaffected).
    const last = queue[end - 1];
    const gapAfter = (last === 0x0D || last === 0x0A) ? lineGapMs : gapMs;
    cursor = end;

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
        timer = setTimeout(writeOneChunk, gapAfter);
    } else {
        fireProgress('complete');
    }
}

// Rewrite every line break in the pasted text to the configured terminator.
//
// The break forms are \r\n, a bare \r, and a bare \n, and \r\n MUST be consumed
// as ONE break. The pre-fix version substituted per byte on \r alone, which had
// two consequences: LF-only clipboard text — the normal case on Linux — passed
// straight through as 0x0A in every mode, so the MicroBeast saw no line break at
// all; and CRLF text in 'crlf' mode came out as 0x0D 0x0A 0x0A, a doubled break.
//
// Two passes so the output is exactly sized (the pre-fix crlf branch's
// precedent): pass 1 measures, pass 2 writes. Both walk the input with the same
// three-way test, in the same order — \r\n first, then a bare terminator, then
// an ordinary byte.
function normaliseLineBreaks(bytes) {
    const term = PASTE_LINE_ENDINGS[lineEnding];
    if (!term) return bytes;                      // 'raw' — clipboard bytes untouched

    let outLen = 0;
    for (let i = 0; i < bytes.length; ) {
        if (bytes[i] === 0x0D && bytes[i + 1] === 0x0A) { outLen += term.length; i += 2; }
        else if (bytes[i] === 0x0D || bytes[i] === 0x0A) { outLen += term.length; i += 1; }
        else { outLen += 1; i += 1; }
    }

    const out = new Uint8Array(outLen);
    let w = 0;
    for (let i = 0; i < bytes.length; ) {
        if (bytes[i] === 0x0D && bytes[i + 1] === 0x0A) { out.set(term, w); w += term.length; i += 2; }
        else if (bytes[i] === 0x0D || bytes[i] === 0x0A) { out.set(term, w); w += term.length; i += 1; }
        else { out[w++] = bytes[i]; i += 1; }
    }
    return out;
}

// E11 retrospective (2026-08-06) — the pacing interval was unobservable from a
// spec, which is part of why setBaudForPump could sit dead for so long without
// anything noticing. gapMs is the whole point of this module; it should be
// readable. The paste-speed work added the rest of the pacing state for the
// same reason: chunk size, the post-terminator gap, and the two settings that
// derive them.
export function __getStateForTests() {
    return {
        gapMs,
        lineGapMs,
        chunkSize,
        lineEnding,
        speed: pasteSpeed,
        rate: getPasteRate(),
        queued: Math.max(0, queue.length - cursor),
        active: isActive(),
    };
}

function fireProgress(status, extra = {}) {
    for (const fn of progressObservers) fn({ status, ...extra });
}
