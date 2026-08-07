// Beastty Phase 5 — paste throttling queue (setTimeout chain).
//
// Public API: enqueuePaste, cancelPaste, isActive, onProgress, onPortLost,
//             wirePastePump, setPasteLineEnding, setPasteChunk, setPastePauseMs,
//             setPasteFlowControl, getPasteLineEnding, getPasteChunk,
//             getPastePauseMs, getPasteFlowControl, getPasteThroughput,
//             wireByteLength, pacingForNextPaste.
//
// Sources:
//   - 05-CONTEXT.md D-12..D-23.
//   - 05-RESEARCH.md Pattern 4 (setTimeout chain).
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

// --- How this module paces, and why it paces that way ---------------------
//
// Two settings, both plain physical facts about the wire:
//
//   Paste chunk size — how many bytes are handed to the writer back-to-back.
//   Paste pause      — how long the receiver is left idle between chunks.
//
// Throughput is a CONSEQUENCE of the two (chunk ÷ pause), never a setting, and
// nothing in this module looks at what the bytes ARE. Chunks are a fixed size
// whatever they contain, every pause is the same length, and a line break is an
// ordinary byte.
//
// Hardware finding, real MicroBeast, pasting an ~800 B Forth block into VIBE.
//
//   2026-08-06 — with RTS/CTS at full speed the paste arrives CORRECT, so the
//   firmware handshakes and the wire is not the problem when flow control is on.
//   With flow control `none` the paste failed IDENTICALLY at 60, 120 and
//   240 B/s, which at the time read as "the loss is inside the burst".
//
//   2026-08-07 — it is not. Sweeping the two controls found the ceiling:
//   1 B / 200 ms (5 B/s) delivers the block intact; 1 B / 100 ms and
//   2 B / 200 ms (both 10 B/s) both only nearly work. TWO DIFFERENT CHUNK SIZES
//   AT THE SAME THROUGHPUT BEHAVE THE SAME, so throughput governs and burst size
//   does not. The three failures of 2026-08-06 were identical because 60, 120 and
//   240 B/s are all 10-50x over a ~5-8 B/s ceiling, and everything that far over
//   capacity looks equally destroyed. The chunk-size control was still needed —
//   the old rate-only model could not express a rate this low — but it is not the
//   mechanism. This module makes NO claim about the receiving UART's FIFO
//   configuration; it is unconfirmed, and no longer matters to the design.
//
// 5 B/s means ~2 min 40 s for that same 800 B block, against under a second with
// RTS/CTS. Applying it to a handshaken port would be absurd, so it is not applied
// to one: see setPasteFlowControl. Hardware handshaking throttles per byte, which
// is strictly better than anything this module can do.

// --- Compile-in constants -------------------------------------------------

// Accepted ranges, wide enough to be a nonsense filter and nothing more. They
// exist only to reject a corrupt or hand-edited prefs blob; the menu offers a
// far narrower set (1..32 bytes, 0..200 ms), and a stored value the pump accepts
// but the menu does not offer simply ticks nothing (see menu-bar.js
// projectPasteSettings).
const MAX_PASTE_CHUNK = 4096;
const MAX_PASTE_PAUSE_MS = 60000;

// The shape a paste runs at when pacing does not apply — a full 32-byte chunk
// with no pause, which is byte-for-byte what the pump did before any of this was
// added. Used on a port opened with hardware flow control, where the receiver
// throttles per byte and real hardware confirms a full-speed paste arrives
// correct. Not a setting and not on any menu: it is the ABSENCE of pacing.
const UNPACED_CHUNK = 32;
const UNPACED_PAUSE_MS = 0;

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

let lineEnding = 'cr';           // prefs.pasteLineEnding — applied via setPasteLineEnding
let pasteChunk = 1;              // prefs.pasteChunk, bytes written back-to-back
let pastePauseMs = 200;          // prefs.pastePauseMs, idle time between chunks

// The flow control the OPEN port was opened with, pushed here by serial.js's
// setLastConfig. 'hardware' turns pacing off entirely; everything else — 'none',
// an unrecognised string, and the boot state of having never connected — paces.
// See setPasteFlowControl.
let portFlowControl = 'none';

// Pacing FROZEN at enqueue for the paste currently in flight. A mid-paste switch
// to a FASTER cadence must not re-pace the bytes already queued, or picking a big
// chunk during a large paste would dump the remainder on the wire in one burst,
// which is the failure this module exists to prevent. A SLOWER cadence does reach
// bytes appended after the switch (see enqueuePaste). Seeded from the defaults
// above so they are never unset.
let runChunkSize = 1;
let runPauseMs = 200;
// Whether the in-flight run is unpaced BECAUSE the port is handshaking, as
// opposed to unpaced because the user picked a pause of 0. Frozen with the rest
// of the snapshot so a mid-paste reconnect cannot change the reason a run is
// running the way it is. Only the UI reads it — the pump itself needs nothing
// beyond the chunk size and the pause.
let runBypassedByFlowControl = false;
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
    // flight adopts the SLOWER of the two cadences: a user who pastes, sees
    // garbage, drops the chunk size and pastes again before the first drains must
    // get the smaller chunk on the new bytes — but the reverse must never speed a
    // run up mid-flight, which is the burst freezing exists to prevent.
    const timing = startingFresh ? asked : slowerPacing(pacingOfCurrentRun(), asked);
    // D-23 — line-break rewrite BEFORE enqueue (not mid-pump), so what sits in
    // the queue is exactly what goes on the wire. The MODE always comes from
    // `asked`, never from the in-flight run: it belongs to the text being pasted,
    // and it is the mode whose wire length the caller may already have quoted.
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

// Settings ▸ Paste chunk size, in bytes written back-to-back. 1 is the most
// conservative cadence the menu offers and the default.
//
// Reject the TYPE before testing the value, and never coerce. Number(null),
// Number(''), Number(false) and Number([]) are all 0 — every one of them passes
// Number.isInteger, and a stored blob can carry any of them. (NaN is typeof
// 'number' and fails Number.isInteger, so it is caught here too.)
export function setPasteChunk(bytes) {
    if (typeof bytes !== 'number') return;
    if (!Number.isInteger(bytes)) return;
    if (bytes < 1 || bytes > MAX_PASTE_CHUNK) return;
    pasteChunk = bytes;
}

export function getPasteChunk() { return pasteChunk; }

// Settings ▸ Paste pause, in ms of idle time between chunks. 0 is a legal value
// meaning "no pause at all" — the writer is fed continuously and the wire is the
// only limit — so the range test is >= 0, not > 0. The value is passed to
// setTimeout exactly as given: a pause below the browser's nested-timer
// resolution is honoured as far as the platform allows rather than silently
// floored, because a floor would make the setting a lie.
//
// Same type-before-value rule as setPasteChunk, and it matters more here: 0 is
// legal, so a coerced null would land on the one value that turns pacing off.
export function setPastePauseMs(ms) {
    if (typeof ms !== 'number') return;
    if (!Number.isInteger(ms)) return;
    if (ms < 0 || ms > MAX_PASTE_PAUSE_MS) return;
    pastePauseMs = ms;
}

export function getPastePauseMs() { return pastePauseMs; }

// The flow control of the port that is currently open, pushed from serial.js's
// setLastConfig — the ONE place the open port's config is recorded. Call it with
// null on disconnect.
//
// Only 'hardware' means anything here, and it means "do not pace at all". The
// receiver handshakes per byte, which is strictly better than any fixed cadence
// this module can impose, and real hardware confirms a full-speed paste over
// RTS/CTS arrives correct. Applying the measured 5 B/s working point to a
// handshaken port would turn a sub-second paste into nearly three minutes for no
// benefit whatsoever.
//
// EVERYTHING ELSE is recorded as 'none' and paces: the literal 'none', a value
// this module does not recognise, and the boot state of never having connected.
// The asymmetry is deliberate — pacing a connection that does not need it costs
// time, while not pacing one that does costs data.
//
// This is a hook of exactly the shape setBaudForPump had: a setter in here that
// only serial.js calls. That one shipped with a comment claiming serial.js called
// it while NOTHING did, in production or in a test, for months. The wiring is
// therefore proved by a test rather than asserted by a comment — see
// tests/transport/paste.spec.js, "the hook serial.js pushes through is live",
// which fails if the setLastConfig call is deleted.
export function setPasteFlowControl(fc) {
    portFlowControl = (fc === 'hardware') ? 'hardware' : 'none';
}

export function getPasteFlowControl() { return portFlowControl; }

// The throughput the two controls ADD UP TO, in bytes/sec — displayed, never set.
// null when there is no pacing limit at all and the wire is the only ceiling —
// either because the pause is 0 or because the open port is handshaking; callers
// render that as "wire speed" rather than inventing a number, and read
// getPasteFlowControl() to say WHICH of the two reasons it is. Floored at 1 so no
// caller can divide by zero.
export function getPasteThroughput() {
    return pacingFromSettings().throughput;
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

// --- Internals ------------------------------------------------------------

// Throughput for a (chunk, pause) pair. null = unpaced (see getPasteThroughput).
function throughputOf(chunk, pauseMs) {
    if (pauseMs <= 0) return null;
    return Math.max(1, Math.round((chunk / pauseMs) * 1000));
}

// Everything about how one paste will run, captured at a single instant, from the
// CURRENT settings. Snapshotting rather than re-reading is what lets the confirm
// estimate and the run itself be the same numbers: the Settings menu stays usable
// while the confirm is up, and a change between the two used to leave the quote
// out by up to ~30×.
//
// A handshaking port takes the UNPACED shape whatever the two settings hold. The
// settings are not consulted, not clamped and not modified — they stay exactly as
// the user left them, ready for the next bare connection — so the only thing that
// must never happen is the UI quoting them as if they were in force. That is what
// bypassedByFlowControl is for; every reader of this snapshot that shows the user
// a number reads it too.
function pacingFromSettings() {
    if (portFlowControl === 'hardware') {
        return {
            chunk: UNPACED_CHUNK,
            pauseMs: UNPACED_PAUSE_MS,
            lineEnding,
            throughput: null,
            bypassedByFlowControl: true,
        };
    }
    return {
        chunk: pasteChunk,
        pauseMs: pastePauseMs,
        lineEnding,
        throughput: throughputOf(pasteChunk, pastePauseMs),
        bypassedByFlowControl: false,
    };
}

// The in-flight run's pacing in the same shape. lineEnding is the LIVE one on
// purpose: pacing is frozen for a run, but the line-break rewrite belongs to the
// text being pasted, so bytes appended now get the mode the user has set now.
function pacingOfCurrentRun() {
    return {
        chunk: runChunkSize,
        pauseMs: runPauseMs,
        lineEnding,
        throughput: throughputOf(runChunkSize, runPauseMs),
        bypassedByFlowControl: runBypassedByFlowControl,
    };
}

// The slower of two pacings, by the throughput the pair adds up to. An unpaced
// snapshot (throughput null — a pause of 0, or a handshaking port) is always the
// FASTER of any pair, so it can never be adopted mid-run. On a tie the smaller
// chunk wins: equal throughput by two chunk sizes measured the same on hardware,
// so neither is better, and the smaller burst is the more conservative guess.
function slowerPacing(a, b) {
    const ta = a.throughput === null ? Infinity : a.throughput;
    const tb = b.throughput === null ? Infinity : b.throughput;
    if (ta !== tb) return ta < tb ? a : b;
    return a.chunk <= b.chunk ? a : b;
}

// Install a snapshot as the pacing the pump runs at. See runChunkSize.
function applyPacing(p) {
    runChunkSize = p.chunk;
    runPauseMs = p.pauseMs;
    runBypassedByFlowControl = !!p.bypassedByFlowControl;
    runLineEnding = p.lineEnding;
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
    // Every chunk is exactly the configured size except the last, which is the
    // remainder. No scan, no terminator special case: nothing here may key off
    // what the bytes are.
    const end = Math.min(start + runChunkSize, queue.length);
    const chunk = queue.subarray(start, end);
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
        // The same pause after every chunk, whatever the chunk carried.
        timer = setTimeout(writeOneChunk, runPauseMs);
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
// than the chunk, so a CRLF pair split across two writes — which happens at any
// chunk size, the default of 1 included — still renders as one new row.
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

// E11 retrospective (2026-08-06) — the pacing was unobservable from a spec, which
// is part of why a dead pacing hook could sit there for months without anything
// noticing. The pacing is the whole point of this module; it should be readable.
//
// These describe what the NEXT paste would do. A run in flight keeps whatever it
// froze at enqueue.
//
// chunkSize / pauseMs are the EFFECTIVE pair — what the next paste would actually
// write at — so on a handshaking port they report the unpaced shape rather than
// the two settings, which are not in force. The settings themselves stay readable
// through getPasteChunk / getPastePauseMs, and flowControl says which is which.
export function __getStateForTests() {
    const p = pacingFromSettings();
    return {
        chunkSize: p.chunk,
        pauseMs: p.pauseMs,
        throughput: p.throughput,
        flowControl: portFlowControl,
        bypassedByFlowControl: p.bypassedByFlowControl,
        lineEnding,
        queued: Math.max(0, queue.length - cursor),
        active: isActive(),
    };
}

function fireProgress(status, extra = {}) {
    for (const fn of progressObservers) fn({ status, ...extra });
}
