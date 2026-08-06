// Beastty Phase 5 — paste throttling queue (setTimeout chain).
//
// Public API: enqueuePaste, cancelPaste, isActive, onProgress, onPortLost,
//             wirePastePump, setBaudForPump, setPasteLineEnding, setPasteSpeed,
//             getPasteLineEnding, getPasteSpeed, getPasteRate,
//             getPasteBreakPauseMs, countLineBreaks, wireByteLength,
//             pacingForNextPaste.
//
// Sources:
//   - 05-CONTEXT.md D-12..D-23.
//   - 05-RESEARCH.md Pattern 4 (setTimeout chain; Pitfall 6 — 4ms clamp).
//   - 05-UI-SPEC.md §"Paste-pump UI interactions" + §"Connection pane" progress copy.
//   - Analog: www/input/tx-sink.js (module-scope state + observer fan-out).

import { pushTxBytes } from './tx-sink.js';
// getLocalEcho only. This module used to read getCrlfMode() as well, so pasting
// was silently governed by Settings ▸ Enter key sends. Paste now has its own
// line-ending setting and the two never read each other.
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

// --- Compile-in constants -------------------------------------------------

// The FULL-SPEED write size — D-14, and the pre-fix pump's only size. Applies
// when pasteSpeed is 0 and nowhere else. At 19200 baud its gap works out at
// round(32 / 1728 * 1000) = 19 ms; the header here used to claim 18 ms, which
// it never was at any baud.
const CHUNK_SIZE = 32;

// The PACED write size.
//
// What a paced paste fixes is BURST LENGTH, not arrival rate. The MicroBeast's
// 16C550 has a 16-byte receive FIFO, and a 32-byte write reaches the wire as one
// unbroken run — so the back half of that single write is dropped no matter how
// far apart the writes are spaced. The hardware capture in the bug report is
// exactly that shape: with flow control `none`, 17 clean characters arrive (a
// full 16-byte FIFO plus the one byte still in the receiver's shift register)
// and everything after it is garbage. 8 bytes leaves the FIFO half empty with
// room to drain between writes.
const PACED_CHUNK_SIZE = 8;

// INVARIANT: PACED_CHUNK_SIZE >= 2. The chunk-end scan below assumes a CRLF pair
// always fits when it starts a chunk, and a cap of 1 would make it return an
// empty chunk and loop forever. It is an invariant on the SOURCE — both operands
// are compile-in constants, so no runtime input can break it. A module-evaluation
// throw could therefore never fire, and if it somehow did it would boot the app to
// a blank page. tests/transport/paste.spec.js asserts the paced chunk size instead.

// A line break costs a full-screen editor a redraw where an ordinary character
// costs a buffer insert, so a chunk that ends in a terminator earns an extra
// pause ON TOP of its ordinary gap — four full chunks' worth of time, never
// below 50 ms. This is additive and deliberate: Paste speed is the byte rate
// BETWEEN breaks, the menu rows say so, and every duration estimate counts both
// terms.
const LINE_EXTRA_CHUNKS = 4;
const MIN_LINE_EXTRA_MS = 50;

// setTimeout's 4 ms clamp for nested timers (05-RESEARCH Pitfall 6). Asking for
// less buys nothing, so every gap floors here.
const MIN_GAP_MS = 4;

// Accepted pasteSpeed range, in bytes/sec. 0 = full speed (see setPasteSpeed).
// This bound exists only to reject nonsense from a corrupt or hand-edited prefs
// blob — it is NOT the effective ceiling. The 4 ms floor is: 8 bytes every 4 ms
// is 2000 B/s, so every paced speed from 2000 up to MAX_PASTE_SPEED delivers the
// same 2000 B/s. Speeds above the wire are clamped rather than refused (see
// effectiveRate).
const MAX_PASTE_SPEED = 20000;

// The terminator each paste line-ending mode emits. `raw` is the pass-through
// mode and deliberately has no byte sequence — normaliseLineBreaks returns its
// input untouched. This table is also the validator for setPasteLineEnding, and
// the menu's data-values are exactly these keys.
const PASTE_LINE_ENDINGS = Object.freeze({
    cr:   new Uint8Array([0x0D]),
    lf:   new Uint8Array([0x0A]),
    crlf: new Uint8Array([0x0D, 0x0A]),
    raw:  null,
});

// --- Pump state -----------------------------------------------------------

let baudRate = 19200;
let lineEnding = 'cr';           // prefs.pasteLineEnding — applied via setPasteLineEnding
let pasteSpeed = 240;            // prefs.pasteSpeed, bytes/sec (0 = full speed)

// Pacing FROZEN at enqueue for the paste currently in flight. A mid-paste switch
// to a FASTER speed — Full speed above all — must not re-pace the bytes already
// queued, or picking it during a large paste would dump the remainder on the wire
// in one burst, which is the failure this module exists to prevent. A SLOWER
// speed does reach bytes appended after the switch (see enqueuePaste). Seeded
// from the defaults above so they are never unset.
let runPaced = true;
let runChunkSize = PACED_CHUNK_SIZE;
let runRate = 240;
let runLineExtraMs = 132;
// Which line-ending mode produced the bytes now queued. displayCopy needs it:
// 'raw' promises the clipboard bytes pass through untouched, and that promise
// covers the local echo as well as the wire.
let runLineEnding = 'cr';

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

// `pacing` is an optional snapshot from pacingForNextPaste(), taken by a caller
// that already QUOTED it to the user. clipboard.js does exactly that: it takes
// one, shows the large-paste confirm, awaits it — the Settings menu is not blocked
// while the confirm is up — and hands the same snapshot back here, so the quote and
// the run cannot disagree. Everyone else takes a snapshot at this instant.
export function enqueuePaste(bytes, pacing) {
    if (isTransferRunning()) {
        // Phase 11 Plan 11-03 D-12 — paste-pump refusal during an active SLIDE
        // session. Subsequent Ctrl+Shift+V attempts during the SLIDE session
        // no-op silently (no user surface — chip already says SLIDE is
        // active). The SLIDE wakeup-completion clause in slide.js calls
        // cancelPaste() so any in-flight large paste interrupts via the
        // existing Phase 5 D-18 cancel chip surface.
        return;
    }
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const startingFresh = !isActive();
    const asked = pacing || pacingFromSettings();
    // Starting a run freezes what it asked for. Appending to a run already in
    // flight adopts the SLOWER of the two TIMING terms: a user who pastes at Full
    // speed, sees garbage, picks 60 B/s and pastes again before the first drains
    // must get the 60 B/s on the new bytes — but the reverse must never speed a run
    // up mid-flight, which is the burst freezing exists to prevent.
    const timing = startingFresh ? asked : slowerPacing(pacingOfCurrentRun(), asked);
    // D-23 — line-break rewrite BEFORE enqueue (not mid-pump), so what sits in
    // the queue is exactly what goes on the wire and the chunker can split at
    // the real terminators. The MODE always comes from `asked`, never from the
    // in-flight run: it belongs to the text being pasted, and it is the mode whose
    // wire length the caller may already have quoted.
    const rewritten = normaliseLineBreaks(bytes, asked.lineEnding);
    // Drop bytes already consumed; append new bytes.
    const remaining = queue.subarray(cursor);
    const merged = new Uint8Array(remaining.length + rewritten.length);
    merged.set(remaining, 0);
    merged.set(rewritten, remaining.length);
    queue = merged;
    cursor = 0;
    applyPacing({ ...timing, lineEnding: asked.lineEnding });
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
    // day it was written: the gap stayed at the 19200 figure for the life of the
    // page regardless of the configured baud, so pasting on a slower connection
    // overran the wire the pump exists to stay under. Now actually wired.
    if (typeof baud !== 'number' || !Number.isFinite(baud) || baud <= 0) {
        // Say so. A silent `return` is how this hook stayed dead for months in the
        // first place — nothing broke visibly, pacing just quietly stayed on the
        // 19200 figure. main.js reads baud with parseInt elsewhere, so a string
        // '9600' is a plausible mis-wire, and it must not fail quietly again.
        console.warn('[paste-pump] setBaudForPump ignored a baud that is not a positive number:', baud);
        return;
    }
    baudRate = baud;
}

// Settings ▸ Paste line ending. Validated HERE, not in prefs.js — a stored blob
// can carry anything, and prefs.js has no field validation (the setCrlfMode
// precedent). hasOwnProperty rather than `in`, so a prototype key ('toString')
// is rejected along with null and undefined. An unknown mode is REJECTED,
// leaving the current value standing; on the boot path that is the 'cr' default,
// which is what "falls back to the default" means for a corrupt stored value.
export function setPasteLineEnding(mode) {
    if (!Object.prototype.hasOwnProperty.call(PASTE_LINE_ENDINGS, mode)) return;
    lineEnding = mode;
}

export function getPasteLineEnding() { return lineEnding; }

// Settings ▸ Paste speed, in bytes/sec. 0 means "as fast as the wire allows" —
// the pre-fix behaviour (32-byte writes at the baud-derived gap), kept for
// targets that can take it.
export function setPasteSpeed(bytesPerSecond) {
    // Reject the TYPE before testing the value, and never coerce. Number(null),
    // Number(''), Number(false) and Number([]) are all 0 — every one of them
    // passes Number.isInteger and would silently select Full speed, which is the
    // one setting that turns this fix off. A stored blob can carry any of them.
    // (NaN is typeof 'number' and fails Number.isInteger, so it is caught here.)
    if (typeof bytesPerSecond !== 'number') return;
    if (!Number.isInteger(bytesPerSecond)) return;
    if (bytesPerSecond < 0 || bytesPerSecond > MAX_PASTE_SPEED) return;
    pasteSpeed = bytesPerSecond;
}

export function getPasteSpeed() { return pasteSpeed; }

// The byte rate the NEXT paste will pace to, between line breaks — the requested
// speed clamped to the wire AND to the 4 ms timer floor, or the wire itself at
// full speed. Floored at 1 so no caller can divide by zero on an absurd baud. The
// large-paste confirm quotes this; before the paste-speed setting it estimated
// from baud alone, which is now wrong by an order of magnitude at the paced default.
export function getPasteRate() {
    return reportableRate(effectiveRate(), pasteSpeed === 0 ? CHUNK_SIZE : PACED_CHUNK_SIZE);
}

// The pacing a paste enqueued RIGHT NOW would run at, as one snapshot. Callers that
// quote a duration to the user take this, show their confirm, and hand the same
// object to enqueuePaste — see enqueuePaste. While a run is in flight this is the
// slower of that run's frozen pacing and the current settings, which is exactly
// what an appended paste will get.
export function pacingForNextPaste() {
    const fresh = pacingFromSettings();
    return isActive() ? slowerPacing(pacingOfCurrentRun(), fresh) : fresh;
}

// How many bytes `bytes` becomes on the WIRE once its line breaks are rewritten to
// `mode`'s terminator. In 'crlf' every break costs two bytes where the clipboard
// spent one, so the payload is longer than the clipboard text — ~2.4% on 40-char
// lines, more on short ones. The large-paste estimate and the threshold it is
// tested against both have to count the wire copy.
export function wireByteLength(bytes, mode = lineEnding) {
    const term = PASTE_LINE_ENDINGS[mode];
    if (!term) return bytes.length;               // 'raw' — clipboard bytes untouched
    return measureNormalised(bytes, term.length);
}

// The extra pause the NEXT paste will add after each line break, in ms — 0 at
// full speed, where there is no break pause at all. The confirm estimate needs
// it because it is the larger of the two terms on short lines.
export function getPasteBreakPauseMs() {
    return pasteSpeed === 0 ? 0 : lineExtraFor(effectiveRate());
}

// How many line breaks a payload contains, counting \r\n as ONE. Exported so the
// large-paste estimate counts breaks the same way normaliseLineBreaks and the
// chunker do, rather than re-deriving the rule at the call site.
export function countLineBreaks(bytes) {
    let breaks = 0;
    for (let i = 0; i < bytes.length; ) {
        if (bytes[i] === 0x0D && bytes[i + 1] === 0x0A) { breaks += 1; i += 2; }
        else if (bytes[i] === 0x0D || bytes[i] === 0x0A) { breaks += 1; i += 1; }
        else { i += 1; }
    }
    return breaks;
}

// --- Internals ------------------------------------------------------------

// The rate a new paste would pace to: the requested speed clamped to the wire,
// or the wire itself at full speed. Asking for 480 B/s on a 2400-baud connection
// gets the 216 B/s the wire can carry, not a pump that overruns it.
function effectiveRate() {
    const wireRate = (baudRate / 10) * 0.90;   // D-13 — 90% of the 8N1 byte rate.
    return pasteSpeed === 0 ? wireRate : Math.min(pasteSpeed, wireRate);
}

// The gap owed after writing `n` bytes at `rate`. PROPORTIONAL to the bytes
// actually written, never a flat per-chunk value: a chunk truncated at a line
// terminator carries as few as one byte, and charging it a full chunk's gap is
// what turned a nominal 240 B/s into 55-155 B/s in the first attempt at this fix.
function gapForBytes(n, rate) {
    return Math.max(MIN_GAP_MS, Math.round((n / rate) * 1000));
}

// The additive post-terminator pause at `rate` — four full chunks' worth of time,
// floored at 50 ms. At 240 B/s that is 33 × 4 = 132 ms.
function lineExtraFor(rate) {
    return Math.max(MIN_LINE_EXTRA_MS, Math.round((PACED_CHUNK_SIZE / rate) * 1000) * LINE_EXTRA_CHUNKS);
}

// The rate to REPORT for a run of `chunkSize` writes at `rate`. gapForBytes floors
// every gap at MIN_GAP_MS, so real throughput can never exceed one chunk per 4 ms
// however high the requested rate: 2000 B/s paced, 8000 B/s at full speed. Full
// speed on a 115200 wire asks for 10368 B/s and gets 8000, so that is the figure
// to quote. Floored at 1 so no caller can divide by zero.
function reportableRate(rate, chunkSize) {
    return Math.max(1, Math.round(Math.min(rate, (chunkSize / MIN_GAP_MS) * 1000)));
}

// Everything about how one paste will run, captured at a single instant, from the
// CURRENT settings. Snapshotting rather than re-reading is what lets the confirm
// estimate and the run itself be the same numbers: the Settings menu stays usable
// while the confirm is up, and a speed change between the two used to leave the
// quote out by up to ~30×.
function pacingFromSettings() {
    const paced = pasteSpeed !== 0;
    const chunkSize = paced ? PACED_CHUNK_SIZE : CHUNK_SIZE;
    const rate = effectiveRate();
    return {
        paced,
        chunkSize,
        rate,
        lineExtraMs: paced ? lineExtraFor(rate) : 0,
        lineEnding,
        reportedRate: reportableRate(rate, chunkSize),
    };
}

// The in-flight run's pacing in the same shape. lineEnding is the LIVE one on
// purpose: pacing is frozen for a run, but the line-break rewrite belongs to the
// text being pasted, so bytes appended now get the mode the user has set now.
function pacingOfCurrentRun() {
    return {
        paced: runPaced,
        chunkSize: runChunkSize,
        rate: runRate,
        lineExtraMs: runLineExtraMs,
        lineEnding,
        reportedRate: reportableRate(runRate, runChunkSize),
    };
}

// The slower of two pacings. Paced is always the slower SHAPE (8-byte writes plus
// break pauses) even where the two rates tie; otherwise the lower rate wins, and
// the longer break pause breaks a tie.
function slowerPacing(a, b) {
    if (a.paced !== b.paced) return a.paced ? a : b;
    if (a.rate !== b.rate) return a.rate < b.rate ? a : b;
    return a.lineExtraMs >= b.lineExtraMs ? a : b;
}

// Install a snapshot as the pacing the pump runs at. See runPaced.
function applyPacing(p) {
    runPaced = p.paced;
    runChunkSize = p.chunkSize;
    runRate = p.rate;
    runLineExtraMs = p.lineExtraMs;
    runLineEnding = p.lineEnding;
}

function isTerminator(b) { return b === 0x0D || b === 0x0A; }

// Where the chunk starting at `start` ends (exclusive). At full speed that is
// simply the next 32-byte boundary — byte-for-byte the pre-fix chunking. When
// paced it is the earlier of the chunk cap and the byte after the first line
// terminator, so a chunk either ends at a terminator or contains none, and the
// receiver gets a whole line's worth of pause to redraw before the next arrives.
function chunkEnd(start) {
    const limit = Math.min(start + runChunkSize, queue.length);
    if (!runPaced) return limit;
    for (let i = start; i < limit; i++) {
        if (!isTerminator(queue[i])) continue;
        if (queue[i] === 0x0D && queue[i + 1] === 0x0A) {
            // A CRLF terminator is two bytes and must never be split across two
            // writes — the pause would land between the CR and its LF. If the LF
            // does not fit under the cap, end the chunk BEFORE the CR instead.
            // That cannot produce an empty chunk: a pair starting at `start`
            // always fits (PACED_CHUNK_SIZE >= 2 — the invariant stated at the top).
            return (i + 2 <= limit) ? i + 2 : i;
        }
        return i + 1;
    }
    return limit;
}

function writeOneChunk() {
    timer = null;  // Allow cancel during write.
    if (isTransferRunning()) {
        // A SLIDE transfer started AFTER this paste was enqueued — enqueuePaste
        // only asks at the door. tx-sink discards everything written while the
        // wire owner is 'slide', so carrying on would advance the progress chip
        // over bytes that never left the browser. Stop and report the remainder
        // unsent, which is what actually happened.
        cancelPaste();
        return;
    }
    const remaining = queue.length - cursor;
    if (remaining <= 0) {
        fireProgress('complete');
        return;
    }
    const start = cursor;
    const end = chunkEnd(start);
    const chunk = queue.subarray(start, end);
    const endedAtBreak = isTerminator(queue[end - 1]);
    cursor = end;

    // D-21 — route through tx-sink (which calls registeredWriter.write when connected).
    pushTxBytes(chunk);

    // D-22 — local-echo: feed the DISPLAY copy of the chunk to the term after
    // writer.write, preserving the sampleBell → drainHostReply → requestFrame
    // invariant. The display copy is not the wire copy — see displayCopy.
    if (getLocalEcho() && termRef) {
        termRef.feed(displayCopy(start, end));
        if (sampleBellFn) sampleBellFn();
        if (drainHostReplyFn) drainHostReplyFn('paste-echo');
        if (requestFrameFn) requestFrameFn();
    }

    fireProgress('chunk', { written: cursor, total: queue.length });

    if (cursor < queue.length) {
        // Proportional to the bytes just written, plus the break pause when this
        // chunk ended at a terminator (runLineExtraMs is 0 at full speed, so that
        // path keeps its flat 32-bytes-per-gap timing exactly).
        const delay = gapForBytes(chunk.length, runRate) + (endedAtBreak ? runLineExtraMs : 0);
        timer = setTimeout(writeOneChunk, delay);
    } else {
        fireProgress('complete');
    }
}

// The bytes LOCAL ECHO sees for queue[start..end). They are deliberately not the
// wire bytes: the core treats 0x0D as a column reset that leaves the row alone
// (crates/beastty-core/src/terminal.rs:364), so echoing the wire copy of a
// CR-terminated paste draws every line on top of the last — one row of overstrike
// where the user pasted twenty lines. 0x0A is the byte that both resets the
// column and advances the row, so a bare CR is SHOWN as one.
//
// A CR that is followed by an LF is left alone: the LF does the line feed itself,
// and doubling it would open a blank row. The lookahead reads the QUEUE rather
// than the chunk, so a CRLF pair split across two writes (possible at full speed,
// where the chunker does not stop at terminators) still renders as one new row.
//
// The result is always the same length as the input, and a chunk with no bare CR
// is returned as-is with no copy at all.
//
// 'raw' is exempt. That mode promises the clipboard bytes pass through untouched,
// and the echo is part of the promise: a transcript that overstrikes one row with
// bare CRs ("Loading 10%\rLoading 20%\r") is doing that on the MicroBeast, so
// showing it locally as a run of scrolling rows would be a different picture from
// the one the user is looking at on the hardware. Only the modes that REWROTE the
// breaks get the substitution — and in 'lf' there are no CRs and in 'crlf' every CR
// is followed by its LF, so 'cr' is the only mode where it changes anything.
function displayCopy(start, end) {
    if (runLineEnding === 'raw') return queue.subarray(start, end);
    let needsCopy = false;
    for (let i = start; i < end; i++) {
        if (queue[i] === 0x0D && queue[i + 1] !== 0x0A) { needsCopy = true; break; }
    }
    if (!needsCopy) return queue.subarray(start, end);
    const out = new Uint8Array(end - start);
    for (let i = start; i < end; i++) {
        out[i - start] = (queue[i] === 0x0D && queue[i + 1] !== 0x0A) ? 0x0A : queue[i];
    }
    return out;
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
function normaliseLineBreaks(bytes, mode = lineEnding) {
    const term = PASTE_LINE_ENDINGS[mode];
    if (!term) return bytes;                      // 'raw' — clipboard bytes untouched

    const out = new Uint8Array(measureNormalised(bytes, term.length));
    let w = 0;
    for (let i = 0; i < bytes.length; ) {
        if (bytes[i] === 0x0D && bytes[i + 1] === 0x0A) { out.set(term, w); w += term.length; i += 2; }
        else if (bytes[i] === 0x0D || bytes[i] === 0x0A) { out.set(term, w); w += term.length; i += 1; }
        else { out[w++] = bytes[i]; i += 1; }
    }
    return out;
}

// Pass 1 of the above, on its own so wireByteLength can size the wire copy without
// building it — and so the two can never walk the input by different rules.
function measureNormalised(bytes, termLen) {
    let n = 0;
    for (let i = 0; i < bytes.length; ) {
        if (bytes[i] === 0x0D && bytes[i + 1] === 0x0A) { n += termLen; i += 2; }
        else if (bytes[i] === 0x0D || bytes[i] === 0x0A) { n += termLen; i += 1; }
        else { n += 1; i += 1; }
    }
    return n;
}

// E11 retrospective (2026-08-06) — the pacing interval was unobservable from a
// spec, which is part of why setBaudForPump could sit dead for so long without
// anything noticing. The pacing is the whole point of this module; it should be
// readable. The paste-speed work added the rest for the same reason.
//
// gapMs and lineExtraMs describe what the NEXT paste would do at the current
// settings — gapMs for a FULL chunk, since the real gap varies with the bytes in
// each chunk. A run in flight keeps whatever it froze at enqueue.
export function __getStateForTests() {
    return {
        chunkSize: pasteSpeed === 0 ? CHUNK_SIZE : PACED_CHUNK_SIZE,
        gapMs: gapForBytes(pasteSpeed === 0 ? CHUNK_SIZE : PACED_CHUNK_SIZE, effectiveRate()),
        lineExtraMs: getPasteBreakPauseMs(),
        rate: getPasteRate(),
        lineEnding,
        speed: pasteSpeed,
        queued: Math.max(0, queue.length - cursor),
        active: isActive(),
    };
}

function fireProgress(status, extra = {}) {
    for (const fn of progressObservers) fn({ status, ...extra });
}
