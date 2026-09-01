// Beastty Phase 6 Plan 04 (Wave 3) — clipboard adapter (copy / paste).
//
// Public API: wireClipboard, copySelection, pasteFromClipboard.
//
// Sources:
//   - 06-CONTEXT.md D-19 (successful copy clears selection),
//                  D-21 (Ctrl+Shift+C copy / Ctrl+C → 0x03 sacred),
//                  D-22 (Ctrl+Shift+V paste / Ctrl+V → 0x16 sacred),
//                  D-23 (copy format: trim trailing ws, '\n' line endings),
//                  D-24 (paste preprocessing: strip 0x00-0x1F except CR/LF/Tab),
//                  D-25 (large-paste >= 4096 inline confirm chip).
//   - 06-RESEARCH.md §Pattern 3 + §Code Examples lines 1308-1335.
//   - 06-PATTERNS.md §"www/input/clipboard.js" (verbatim copySelection +
//                    pasteFromClipboard bodies).
//   - 06-UI-SPEC.md §"Large-paste inline confirm chip" — verbatim copy:
//                    `About to paste {N} B (~{S} s at {BAUD} baud).`
//
// CR/LF rewrite is NOT done here — paste-pump.enqueuePaste already applies it
// per Phase 5 D-23. Double-rewriting would corrupt streams.

import { enqueuePaste, wireByteLength, pacingForNextPaste } from './paste-pump.js';
import { getSelection, clearSelection } from './selection.js';

// D-25 — large-paste confirm threshold (bytes). Epic E7 Story E7.1 (e6 retro #3
// single-source guard) — hoisted from an inline literal to one exported constant
// the paste toast / spec import, so the "when to confirm" line is defined once.
export const LARGE_PASTE_THRESHOLD = 4096;

// --- Injected deps -------------------------------------------------------

// E7.1 (FR-29 / AD-16) — the large-paste confirm is DOM-agnostic here: it calls
// the injected confirmLargePaste (backed by renderer/paste-toast.js), which
// returns a Promise<boolean>. The retired #paste-progress-row's
// #paste-confirm/#paste-cancel are gone; clipboard.js holds no paste DOM refs.
let confirmLargePasteFn = null;

// --- Public wire entry ---------------------------------------------------

export function wireClipboard(opts) {
    // confirmLargePaste(byteCount, pacing) → Promise<boolean>. A harness that omits
    // it falls back to auto-confirm (true) so a large paste is never silently stuck
    // awaiting a confirm surface that isn't wired. `pacing` is the pump snapshot the
    // run itself will use — see below.
    confirmLargePasteFn = opts.confirmLargePaste || (() => Promise.resolve(true));
}

// --- D-21 / D-23 — Copy --------------------------------------------------

export async function copySelection() {
    const sel = getSelection();
    if (!sel || sel.rows.length === 0) return;   // empty-selection no-op (D-21).
    // Trim trailing-whitespace cells per row already handled in selection.js;
    // single-line selections produce no trailing '\n' because rows.join('\n')
    // does not append one.
    const text = sel.rows.join('\n');
    if (text.length === 0) return;
    try {
        await navigator.clipboard.writeText(text);
        clearSelection();   // D-19 — successful copy clears selection.
    } catch (err) {
        console.warn('[clipboard] copy failed:', err);
    }
}

// --- D-22 / D-24 — Paste -------------------------------------------------

export async function pasteFromClipboard() {
    let text;
    try {
        text = await navigator.clipboard.readText();
    } catch (err) {
        console.warn('[clipboard] read failed:', err);
        return;
    }
    if (!text) return;
    // D-24 — encode as bytes; strip 0x00-0x1F except CR (0x0D) / LF (0x0A) /
    // Tab (0x09); drop chars > 0xFF (outside Latin-1).
    const encoded = new Uint8Array(text.length);
    let w = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x20 && c !== 0x0D && c !== 0x0A && c !== 0x09) continue;
        if (c > 0xFF) continue;
        encoded[w++] = c;
    }
    const bytes = encoded.subarray(0, w);
    if (bytes.length === 0) return;

    // ONE pacing snapshot governs the estimate AND the run. The confirm is awaited
    // and the Settings menu stays usable underneath it, so re-reading the pump after
    // the await could pace the paste at a cadence the user was never quoted — the
    // menu's extremes are 32 bytes with no pause and 1 byte every 200 ms.
    // enqueuePaste takes the same object.
    const pacing = pacingForNextPaste();
    // Count the bytes that actually go on the WIRE, not the clipboard bytes: in
    // 'crlf' every break becomes two bytes, so the payload is longer than the
    // clipboard text. Both the threshold test and the quoted size use it.
    const wireLength = wireByteLength(bytes, pacing.lineEnding);

    // D-25 — large-paste confirm gate (E7.1 — resolved off the paste toast).
    if (wireLength >= LARGE_PASTE_THRESHOLD) {
        // The estimate is (writes - 1) × pause, and nothing about it depends on what
        // the bytes are — the pump pauses the same amount after every chunk, line
        // break or not, so the wire length and the cadence are the whole story.
        const ok = await confirmLargePasteFn(wireLength, pacing);
        if (!ok) return;
    }
    // The line-break rewrite happens INSIDE paste-pump.enqueuePaste (Phase 5 D-23).
    enqueuePaste(bytes, pacing);
}
