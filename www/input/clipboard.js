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

import { enqueuePaste } from './paste-pump.js';
import { getSelection, clearSelection } from './selection.js';

// --- Injected deps -------------------------------------------------------

let pasteProgressTextEl = null;
let pasteCancelBtn = null;
let pasteConfirmBtn = null;
let pasteProgressRow = null;
let baudGetter = null;

// --- Public wire entry ---------------------------------------------------

export function wireClipboard(opts) {
    pasteProgressTextEl = opts.pasteProgressText;
    pasteCancelBtn = opts.pasteCancelBtn;
    pasteConfirmBtn = opts.pasteConfirmBtn;
    pasteProgressRow = opts.pasteProgressRow;
    baudGetter = opts.getBaud || (() => 19200);

    // Phase 4 D-16 — focus retention on the new chrome control.
    if (pasteConfirmBtn) {
        pasteConfirmBtn.addEventListener('mousedown', (e) => e.preventDefault());
    }
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

    // D-25 — large-paste confirm chip.
    if (bytes.length >= 4096) {
        const ok = await showLargePasteConfirm(bytes.length);
        if (!ok) return;
    }
    // CR/LF rewrite happens INSIDE paste-pump.enqueuePaste (Phase 5 D-23).
    enqueuePaste(bytes);
}

// --- Large-paste confirm chip --------------------------------------------

function showLargePasteConfirm(byteCount) {
    return new Promise((resolve) => {
        const baud = baudGetter();
        const seconds = Math.ceil((byteCount * 10) / baud);   // 10 bits / byte at 8N1
        const formattedN = byteCount.toLocaleString();
        // Verbatim copy from 06-UI-SPEC §Large-paste inline confirm chip.
        if (pasteProgressTextEl) {
            pasteProgressTextEl.textContent = `About to paste ${formattedN} B (~${seconds} s at ${baud} baud).`;
        }
        if (pasteProgressRow) pasteProgressRow.removeAttribute('hidden');
        if (pasteConfirmBtn) pasteConfirmBtn.removeAttribute('hidden');
        if (pasteCancelBtn) pasteCancelBtn.removeAttribute('hidden');

        const cleanup = () => {
            if (pasteConfirmBtn) {
                pasteConfirmBtn.removeEventListener('click', onConfirm);
                pasteConfirmBtn.setAttribute('hidden', '');
            }
            if (pasteCancelBtn) {
                pasteCancelBtn.removeEventListener('click', onCancel);
            }
            // Hide the progress row when neither button is committed yet; the
            // paste-pump 'started' progress event will re-show it on confirm.
            if (pasteProgressRow) pasteProgressRow.setAttribute('hidden', '');
            if (pasteProgressTextEl) pasteProgressTextEl.textContent = '';
        };
        const onConfirm = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        if (pasteConfirmBtn) pasteConfirmBtn.addEventListener('click', onConfirm);
        if (pasteCancelBtn) pasteCancelBtn.addEventListener('click', onCancel);
    });
}
