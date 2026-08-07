// Paste settings modal — the three paste controls and the throughput they add up to.
//
// Settings ▸ Paste settings… opens #paste-config-modal (main.js openPasteConfig →
// the shared openModal helper). This module owns what is INSIDE it: the change
// handlers and the projection. The dialog's open/close/focus/Esc mechanics are
// modal.js's, unchanged (AD-8).
//
// The three settings were radio submenus under Settings until the paste-text-loss
// change grouped them here. Everything the submenus got right is re-derived, not
// redesigned:
//
//   PERSIST ≠ APPLY. savePrefs does not fan out (AD-4), so every change handler
//   calls the paste-pump setter AND savePrefs. One without the other means either a
//   control that forgets on reload or a control that moves while the next paste
//   still uses the old value.
//
//   PROJECT FROM THE PUMP, NOT THE PREF. project() reads the pump's live getters, so
//   a control can never show a value the next paste is not going to use. A pref the
//   pump REJECTED (a chunk of '' or the string '8') leaves the pump on its default
//   while the pref says otherwise; a pref the pump ACCEPTED but this modal does not
//   offer (setPasteChunk takes any integer 1..4096; the select offers six) has no
//   option to select. Both are true by construction here: the rejected value projects
//   the default, which IS live, and the accepted-but-unoffered one selects nothing —
//   the honest rendering of "the live value is not on this menu".
//
// AD-1: no build step, native ESM, named exports only.
// AD-3: the pump's setters/getters are INJECTED (a renderer module may not import
//       input/*). prefs.js is a direct import, as it is in menu-bar.js.

import { savePrefs } from '../state/prefs.js';
// The one rounding rule for a throughput figure, shared with the paste chip and the
// large-paste confirm — see renderer/paste-rate.js.
import { formatThroughput } from './paste-rate.js';

// ====== Module-scope refs (set by wirePasteConfig) ======

let modalEl = null;
let lineEndingSelectEl = null;
let chunkSelectEl = null;
let pauseSelectEl = null;
let throughputValueEl = null;

// Injected paste-pump setters and getters. All optional: a harness that omits them
// keeps the persist half working and leaves the live apply inert (the menu-bar
// precedent).
let setPasteLineEndingRef = null;
let setPasteChunkRef = null;
let setPastePauseMsRef = null;
let getPasteLineEndingRef = null;
let getPasteChunkRef = null;
let getPastePauseMsRef = null;
let getPasteThroughputRef = null;   // derived (chunk ÷ pause); null = no pacing limit at all
let getPasteFlowControlRef = null;  // 'hardware' means the two cadence rows are not in force

// Tracked listeners, so an idempotent re-wire never stacks change handlers (the
// menu-bar trackListener precedent, minus the generality it does not need here).
let tracked = [];

// serial.js's onStateChange has no unsubscribe that this module could hold, so the
// subscription is taken exactly once however many times wirePasteConfig runs.
let connectionSubscribed = false;

// ====== Wiring ======

export function wirePasteConfig(opts = {}) {
    removeTrackedListeners();

    setPasteLineEndingRef = opts.setPasteLineEnding || null;
    setPasteChunkRef = opts.setPasteChunk || null;
    setPastePauseMsRef = opts.setPastePauseMs || null;
    getPasteLineEndingRef = opts.getPasteLineEnding || null;
    getPasteChunkRef = opts.getPasteChunk || null;
    getPastePauseMsRef = opts.getPastePauseMs || null;
    getPasteThroughputRef = opts.getPasteThroughput || null;
    getPasteFlowControlRef = opts.getPasteFlowControl || null;

    // The readout's third state — "wire speed (flow control)" — is a fact about the
    // OPEN PORT, not about the two rows, so it goes stale the moment the connection
    // does. project() runs on open, which covers a modal opened after a disconnect;
    // this covers a modal that was already open when the port went away, which would
    // otherwise sit there claiming the pacing is off long after it came back on.
    // Subscribed once at wire time, before the first project() below.
    if (typeof opts.onConnectionChange === 'function' && !connectionSubscribed) {
        connectionSubscribed = true;
        opts.onConnectionChange(() => projectThroughput());
    }

    // Discovered by id, like every other modal's controls. Every ref is null-guarded
    // downstream so the no-markup render harness never throws.
    modalEl = document.getElementById('paste-config-modal');
    lineEndingSelectEl = document.getElementById('paste-line-ending-select');
    chunkSelectEl = document.getElementById('paste-chunk-select');
    pauseSelectEl = document.getElementById('paste-pause-select');
    throughputValueEl = document.getElementById('paste-throughput-value');

    // Line ending — apply + persist. The pump's validator accepts exactly the four
    // <option> values (cr/lf/crlf/raw), so no conversion is needed here.
    track(lineEndingSelectEl, 'change', () => {
        const value = lineEndingSelectEl.value;
        setPasteLineEndingRef?.(value);
        savePrefs({ pasteLineEnding: value });
        project();
    });

    // Chunk size — an <option> value is a string and the pref is a number, so convert
    // and validate before either half (the cmdhistory-size branch is the incumbent
    // shape). The pump validates again at its own door; this guard keeps a nonsense
    // value out of the stored blob in the first place.
    track(chunkSelectEl, 'change', () => {
        const chunk = Number(chunkSelectEl.value);
        if (!Number.isInteger(chunk) || chunk < 1) return;
        setPasteChunkRef?.(chunk);
        savePrefs({ pasteChunk: chunk });
        project();
    });

    // Pause — same shape, except 0 is a LEGAL value here ("no pause at all"), so the
    // guard is >= 0 rather than > 0.
    track(pauseSelectEl, 'change', () => {
        const pause = Number(pauseSelectEl.value);
        if (!Number.isInteger(pause) || pause < 0) return;
        setPastePauseMsRef?.(pause);
        savePrefs({ pastePauseMs: pause });
        project();
    });

    project();   // initial paint from the pump, before the modal is ever opened

    return { project, __getStateForTests };
}

// ====== Projection ======

// Re-derive every control and the readout from the pump's LIVE values. Called at
// wire time, on every open (main.js passes this as openModal's onOpen, so it runs
// just before showModal), and after any change here.
//
// Never calls a pump setter: a projector that writes the machine it reads is the
// E1.4 double-apply lesson. applyPrefs stays the single writer on boot and reset.
export function project() {
    if (getPasteLineEndingRef && lineEndingSelectEl) {
        lineEndingSelectEl.value = String(getPasteLineEndingRef());
    }
    if (getPasteChunkRef && chunkSelectEl) {
        // A live value the select does not offer leaves selectedIndex at -1, which
        // shows blank. That is deliberate: selecting the nearest option would put the
        // control on a value the pump is not using.
        chunkSelectEl.value = String(getPasteChunkRef());
    }
    if (getPastePauseMsRef && pauseSelectEl) {
        pauseSelectEl.value = String(getPastePauseMsRef());
    }
    projectThroughput();
}

// The readout under the two cadence rows. Three things it can say, and the third is
// why it exists at all:
//
//   "≈ N B/s"                   — the two rows are in force and this is what they
//                                 add up to.
//   "wire speed"                — the pause is 0, so there is no pacing limit and the
//                                 wire is the only ceiling, which is not a bytes/sec
//                                 figure this module can know.
//   "wire speed (flow control)" — the open port is handshaking, so the pump does not
//                                 pace at ALL and the two rows above are simply not in
//                                 force. They keep their values — they are still the
//                                 user's settings, and they apply again the moment a
//                                 bare port is opened — so without this the modal would
//                                 show a pause the next paste is going to ignore. A
//                                 setting that is silently ignored is the defect this
//                                 whole change keeps re-learning; the readout carries
//                                 the reason.
function projectThroughput() {
    if (!throughputValueEl) return;
    if (getPasteFlowControlRef && getPasteFlowControlRef() === 'hardware') {
        throughputValueEl.textContent = 'wire speed (flow control)';
        return;
    }
    const rate = getPasteThroughputRef ? getPasteThroughputRef() : null;
    throughputValueEl.textContent =
        (rate == null) ? 'wire speed' : `≈ ${formatThroughput(rate)} B/s`;
}

// ====== Listener tracking ======

function track(el, type, fn) {
    if (!el) return;
    el.addEventListener(type, fn);
    tracked.push({ el, type, fn });
}

function removeTrackedListeners() {
    for (const { el, type, fn } of tracked) el.removeEventListener(type, fn);
    tracked = [];
}

// ====== Test introspection (the window.__* pattern across the project) ======

export function __getStateForTests() {
    return {
        hasMarkup: !!modalEl,
        open: !!(modalEl && modalEl.open),
        lineEnding: lineEndingSelectEl ? lineEndingSelectEl.value : null,
        chunk: chunkSelectEl ? chunkSelectEl.value : null,
        pauseMs: pauseSelectEl ? pauseSelectEl.value : null,
        throughput: throughputValueEl ? throughputValueEl.textContent : null,
    };
}
