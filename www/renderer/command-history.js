// Beastty Epic E8 Story E8.2 — command-history recall overlay (the visible half).
//
// E8.1 built the invisible engine (input/command-history.js — the line mirror +
// persisted store). This module builds the VISIBLE surface: a floating overlay
// that opens on ↑/↓ at an empty prompt, filters (multi-term AND) → navigates →
// Tab-copies → edits locally → Enter-sends. It is the ONLY place in E8 that emits
// bytes to the wire (on Enter, via the injected pushTxBytes, reusing the engine's
// commit()); everything else stays observation-only.
//
// Amended per the E8 retro §6 (2026-07-24) hardware feedback, superseding the
// E8.2 AC text where they conflict:
//   (i)   the list displays oldest→newest top→bottom — newest sits at the BOTTOM,
//         beside the edit line (internal state stays newest-first; only the
//         render order and the ↑/↓ mapping flip);
//   (ii)  Enter sends the highlighted entry as-is when the edit line is EMPTY,
//         or when ↑/↓ moved the highlight since the text last changed (filter →
//         arrow → Enter picks the selection); untouched-highlight typed text
//         still wins (type a fresh command → Enter sends what was typed);
//   (iii) ←/→ with an EMPTY edit line copy the highlight into the edit line
//         (same as Tab); with text present they move the caret as before;
//   (iv)  the legend reads "↑↓ select · Tab edit · Enter send · Esc cancel".
//
// THE INTERCEPTION MODEL (the crux — see the story Dev Notes).
// Beastty keeps focus on #terminal-wrapper at all times; every keydown fires
// there. This overlay is a PASSIVE visual layer with a FAKE caret (a <div> +
// .cur span — NOT a real <input>), exactly like the menu bar. It registers ONE
// keydown listener on #terminal-wrapper, wired in main.js in the AD-12 slot AFTER
// the E8.1 engine and BEFORE wireKeyboard (mirroring renderer/menu-bar.js). When
// the overlay acts it calls e.preventDefault(); keyboard.js's handler then
// short-circuits on e.defaultPrevented (keyboard.js:213) so the same keystroke
// never reaches the encode/forward path. This is why "nothing is transmitted
// while editing" (NFR-2) is STRUCTURAL, not a runtime check: while open the
// overlay preventDefaults every key, so keyboard.js never encodes a byte.
//
// Direct-import allowlist (AD-3): renderer/focus.js (retainFocus — sibling, the
// paste-toast precedent) and state/prefs.js (getPrefs — the commandHistoryEnabled
// read, AD-4 read-at-use-time). The engine (input/command-history.js), tx-sink,
// and keyboard.js are NEVER imported here — their API (isLineEmpty / getHistory /
// commit / pushTxBytes / getCrlfMode) arrives via wireCommandHistoryOverlay opts.
//
// AD-1: no build step, native ESM, named exports only (no default).
// AD-2: window.__commandHistoryOverlay test hooks (wired in main.js).
//
// Sources:
//   - _bmad-output/planning-artifacts/epics-command-history.md#Story E8.2 (ACs).
//   - www/renderer/paste-toast.js — the transient-renderer pattern this clones.
//   - www/renderer/menu-bar.js:515-573 — the #terminal-wrapper keydown-interception
//     precedent (open-vs-closed preventDefault discipline).
//   - www/input/keyboard.js:70-74,106,211-314 — CRLF_MODES/getCrlfMode + the
//     defaultPrevented short-circuit this overlay relies on.

import { retainFocus } from './focus.js';
import { getPrefs } from '../state/prefs.js';

// ====== Terminator table (AC-7) ======
// Mirrors keyboard.js's CRLF_MODES (:70-74) exactly. AD-3 forbids importing
// keyboard.js from a renderer, so the 3-entry table is kept inline (dev discretion
// per the Dev Notes) — small and self-contained. getCrlfMode arrives via opts.
const CRLF_TERM = Object.freeze({
    cr:   [0x0D],
    lf:   [0x0A],
    crlf: [0x0D, 0x0A],
});

// ====== Module-scope lifecycle + per-open state ======

let isOpenState = false;      // overlay open/closed

// Per-open state (reset on every open/close).
let baseHistory = [];         // snapshot of getHistory() taken at open (newest-first)
let filtered = [];            // baseHistory narrowed by the current AND filter
let highlight = 0;            // index into `filtered` of the highlighted row
let navigated = false;        // ↑/↓ moved the highlight since the text last changed
let editText = '';            // the fake edit line's contents
let caretIndex = 0;           // caret position within editText (0..editText.length)

// Injected deps (set by wireCommandHistoryOverlay).
let panelEl = null;           // #command-history-overlay
let wrapperEl = null;         // #terminal-wrapper (keydown target)
let countEl = null;           // .ch-count (aria-live caption)
let listEl = null;            // .ch-list (role=listbox)
let entryEl = null;           // .ch-entry (toggles .ch-placeholder)
let txtEl = null;             // .ch-txt (role=combobox, holds the fake caret)

let isLineEmptyFn = null;     // engine: mirror.length === 0
let getHistoryFn = null;      // engine: fresh newest-first copy of the store
let commitFn = null;          // engine: shared dedup + cap + persist
let pushTxBytesFn = null;     // tx-sink: the SOLE wire emission in E8
let getCrlfModeFn = null;     // keyboard: 'cr' | 'lf' | 'crlf'
let getWireOwnerFn = null;    // tx-sink: 'terminal' | 'slide' — suspend the trigger mid-SLIDE

let keydownHandler = null;    // the registered listener (for dispose)

// ====== Wire entry (composition-root DI — AD-1/AD-2) ======

export function wireCommandHistoryOverlay(opts) {
    const {
        overlayEl, terminalWrapper,
        isLineEmpty, getHistory, commit, pushTxBytes, getCrlfMode, getWireOwner,
    } = opts;

    panelEl = overlayEl || null;
    wrapperEl = terminalWrapper || null;
    isLineEmptyFn = isLineEmpty || null;
    getHistoryFn = getHistory || null;
    commitFn = commit || null;
    pushTxBytesFn = pushTxBytes || null;
    getCrlfModeFn = getCrlfMode || null;
    getWireOwnerFn = getWireOwner || null;

    // Cache the child element refs once (they are static markup, never rebuilt —
    // only .ch-list innerHTML is regenerated per render).
    if (panelEl) {
        countEl = panelEl.querySelector('.ch-count');
        listEl = panelEl.querySelector('.ch-list');
        entryEl = panelEl.querySelector('.ch-entry');
        txtEl = panelEl.querySelector('.ch-txt');
    }

    // AD-10 — focus retention: a mousedown on the panel must never blur
    // #terminal-wrapper (which would kill the interception model — the keydown
    // listener lives on the wrapper). The panel is a plain <div>, so retainFocus
    // takes the mousedown→preventDefault branch (no restoreTarget needed).
    if (panelEl) retainFocus(panelEl);

    // AD-12 — register the single keydown listener on #terminal-wrapper. main.js
    // calls this AFTER wireCommandHistory (engine) and BEFORE wireKeyboard, so
    // this handler runs before keyboard.js's and its preventDefault reaches
    // keyboard.js as e.defaultPrevented (the short-circuit at keyboard.js:213).
    // Registered after menu-bar's handler, so an open menu claims ↑/↓ first (the
    // closed branch bails on e.defaultPrevented).
    if (wrapperEl) {
        keydownHandler = onKeydown;
        wrapperEl.addEventListener('keydown', keydownHandler);
    }

    // Start hidden + rendered clean.
    if (panelEl) panelEl.setAttribute('hidden', '');

    return {
        open,
        close,
        isOpen: () => isOpenState,
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

// ====== The single keydown handler (AC-1…AC-8) ======

function onKeydown(e) {
    // A menu (or chrome.js) already claimed this event — leave it entirely.
    // While CLOSED this means ↑/↓ belong to an open menu; while OPEN it should
    // not happen (the overlay is the top interceptor once open), but bail anyway.
    if (e.defaultPrevented) return;

    // IME safety — mirror keyboard.js:217 / menu-bar.js:517. A composition-phase
    // keydown (or the first post-commit keydown Chromium marks isComposing) must
    // not be intercepted, or the overlay would act on it and desync the IME.
    if (e.isComposing) return;

    if (!isOpenState) { onKeydownClosed(e); return; }
    onKeydownOpen(e);
}

// --- Closed branch (AC-1 trigger, AC-2 inert passthrough) ---
function onKeydownClosed(e) {
    // Only bare ↑/↓ can open the overlay. Any modifier chord (incl. Shift — a bare
    // Shift+Arrow must reach keyboard.js untouched, matching menu-bar.js:521), or
    // any other key, passes through untouched (NO preventDefault) so keyboard.js
    // encodes it as usual — the trigger must be inert for everything else (FR-8/9/10).
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    // Suspended while a SLIDE transfer owns the wire — mirror the E8.1 engine's
    // slide-suspend (input/command-history.js capture()). Return WITHOUT
    // preventDefault. Without this the overlay could open mid-transfer and
    // Enter-"send" a command whose bytes tx-sink silently drops (owner==='slide'),
    // while commit() still recorded it as sent — a phantom entry for a send that
    // never left the machine.
    if (typeof getWireOwnerFn === 'function' && getWireOwnerFn() === 'slide') return;

    // AC-1 gate: enabled + empty prompt + non-empty history. Read prefs fresh
    // (AD-4). If ANY condition fails, return WITHOUT preventDefault so the arrow
    // forwards to the MicroBeast as its normal VT52 cursor bytes (AC-2).
    const prefs = getPrefs();
    if (prefs && prefs.commandHistoryEnabled === false) return;
    if (typeof isLineEmptyFn === 'function' && !isLineEmptyFn()) return;
    const hist = (typeof getHistoryFn === 'function') ? getHistoryFn() : [];
    if (!hist || hist.length === 0) return;

    e.preventDefault();
    open(hist);
}

// --- Open branch (AC-3…AC-8) ---
function onKeydownOpen(e) {
    // A Ctrl/Alt/Meta chord while open is swallowed without acting: it keeps NFR-2
    // structural (no byte leaks to the wire) AND stops a modified chord — e.g.
    // Ctrl+Enter, Alt+Tab, Ctrl+ArrowLeft — from being misread as a plain
    // send/copy/navigate. Shift passes through: it yields the shifted printable
    // below, and Shift+Enter/Tab behave as their bare form.
    if (e.ctrlKey || e.altKey || e.metaKey) { e.preventDefault(); return; }

    switch (e.key) {
        // The list renders oldest→newest top→bottom (retro tweak i), and
        // `highlight` indexes the newest-first `filtered` array — so visually-up
        // (older) is a HIGHER index and visually-down (newer) a lower one.
        case 'ArrowUp':    e.preventDefault(); moveHighlight(+1); return;
        case 'ArrowDown':  e.preventDefault(); moveHighlight(-1); return;
        case 'ArrowLeft':  e.preventDefault(); arrowEdit(-1);     return;
        case 'ArrowRight': e.preventDefault(); arrowEdit(+1);     return;
        case 'Backspace':  e.preventDefault(); backspace();       return;
        case 'Tab':        e.preventDefault(); copyHighlight();   return;
        case 'Enter':      e.preventDefault(); sendAndClose();    return;
        case 'Escape':     e.preventDefault(); close();           return;
        default:
            // A printable single character inserts at the caret and re-filters
            // live (AC-6). Ctrl/Alt/Meta chords already returned above; Shift is
            // fine here — it yields the shifted char in e.key.
            if (e.key.length === 1) {
                e.preventDefault();
                insertChar(e.key);
                return;
            }
            // Any other key while open (function keys, stray chords, bare
            // modifiers) is swallowed so it can never leak to the wire — the
            // structural NFR-2 guarantee. No-op beyond the preventDefault.
            e.preventDefault();
            return;
    }
}

// ====== Open / close lifecycle ======

// Public open(): snapshot the history, reset the edit line, show + render. The
// optional `hist` arg lets the trigger pass the array it already fetched (avoids
// a second getHistory() read); callers/tests may also call open() with no arg.
function open(hist) {
    baseHistory = Array.isArray(hist)
        ? hist.slice()
        : ((typeof getHistoryFn === 'function') ? getHistoryFn() : []);
    editText = '';
    caretIndex = 0;
    recompute();
    isOpenState = true;
    if (panelEl) panelEl.removeAttribute('hidden');
    render();
}

// Public close(): hide + reset all per-open state. Emits nothing (Esc-close and
// the post-send close both route here; the send happens BEFORE close()).
function close() {
    isOpenState = false;
    if (panelEl) panelEl.setAttribute('hidden', '');
    baseHistory = [];
    filtered = [];
    highlight = 0;
    navigated = false;
    editText = '';
    caretIndex = 0;
}

// ====== Edit-line + filter operations (AC-3…AC-6) ======

// AC-3 — split the edit text on whitespace into AND terms; a command matches iff
// every term is a case-insensitive substring (order-independent). Empty edit text
// → the full history. Resets the highlight to the newest match (the bottom row).
function recompute() {
    const terms = editText.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
        filtered = baseHistory.slice();
    } else {
        const lowered = terms.map((t) => t.toLowerCase());
        filtered = baseHistory.filter((cmd) => {
            const lc = cmd.toLowerCase();
            return lowered.every((t) => lc.includes(t));
        });
    }
    highlight = 0;
    // A text change resets selection intent: Enter goes back to sending the
    // typed text until the user arrows the list again (retro tweak ii).
    navigated = false;
}

// AC-4 — move the highlight within the CURRENTLY filtered list, clamped at both
// ends (no wrap). Navigation never re-filters or moves the caret. `delta` is in
// newest-first index space (+1 = older = visually up — see the ArrowUp mapping).
// Any ↑/↓ press with rows visible (even one clamped at an edge) is an explicit
// selection — it flips Enter to send the highlight (retro tweak ii).
function moveHighlight(delta) {
    if (filtered.length === 0) return;
    highlight = clamp(highlight + delta, 0, filtered.length - 1);
    navigated = true;
    render();
}

// Retro tweak iii — ←/→ on an EMPTY edit line grab the highlighted entry (same
// as Tab); once the edit line has text they move the caret as before (AC-6).
function arrowEdit(delta) {
    if (editText.length === 0 && filtered.length > 0) { copyHighlight(); return; }
    moveCaret(delta);
}

// AC-6 — move the caret within the edit text (local only; never re-filters).
function moveCaret(delta) {
    caretIndex = clamp(caretIndex + delta, 0, editText.length);
    render();
}

// AC-6 — delete the char before the caret + re-filter live.
function backspace() {
    if (caretIndex === 0) return;
    editText = editText.slice(0, caretIndex - 1) + editText.slice(caretIndex);
    caretIndex -= 1;
    recompute();
    render();
}

// AC-6 — insert a printable char at the caret + re-filter live.
function insertChar(ch) {
    editText = editText.slice(0, caretIndex) + ch + editText.slice(caretIndex);
    caretIndex += 1;
    recompute();
    render();
}

// AC-5 — Tab copies the highlighted row into the edit line (caret to end), ready
// to edit; the list stays visible and re-filters to the copied text (the live
// edit-drives-filter model). Tab on an empty / no-match list is a no-op.
function copyHighlight() {
    if (filtered.length === 0) return;
    editText = filtered[highlight];
    caretIndex = editText.length;
    recompute();
    render();
}

// ====== Enter-send (AC-7, AC-11) — the SOLE wire emission in E8 ======

function sendAndClose() {
    // Precedence (retro tweak ii + same-day refinement): the highlighted entry
    // is sent when the edit line is empty OR the user arrowed the list since
    // the text last changed (filter → ↑/↓ → Enter picks the selection). Typed
    // text with an untouched highlight wins — a freshly keyed command sends
    // as typed even when it happens to match a stored one. No-rows (no-match
    // filter) always sends the typed text; both-empty (unreachable via the UI —
    // the overlay only opens on non-empty history) sends the bare terminator.
    const useHighlight = filtered.length > 0 && (editText.length === 0 || navigated);
    const text = useHighlight ? filtered[highlight] : editText;

    // Build the ASCII bytes (printable-domain edit line — charCodeAt is identity
    // for 0x20–0x7E, exactly what the engine appends) followed by the configured
    // terminator (getCrlfMode → CR / LF / CRLF, the keyboard.js table). This
    // reproduces "type the line then Enter" byte-for-byte.
    const mode = (typeof getCrlfModeFn === 'function') ? getCrlfModeFn() : 'cr';
    const term = CRLF_TERM[mode] || CRLF_TERM.cr;
    const bytes = new Uint8Array(text.length + term.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xFF;
    bytes.set(term, text.length);

    // Order: send → close → commit. Emit ONCE via the injected pushTxBytes (the
    // overlay is the sole emitter — do NOT route through keyboard.js, which would
    // double-encode and re-enter the E8.1 capture hook).
    if (typeof pushTxBytesFn === 'function') pushTxBytesFn(bytes);
    close();
    // Commit only a non-empty line: commit('') would store '' (the engine's
    // commit does not itself reject empty — only commitMirror does), breaking
    // E8.1's "empty lines never stored" invariant. A bare Enter therefore sends
    // just the terminator and stores nothing.
    if (text.length > 0 && typeof commitFn === 'function') commitFn(text);
}

// ====== Render ======

function render() {
    if (!panelEl) return;

    const total = baseHistory.length;
    const isFiltering = editText.trim().length > 0;

    // Caption (aria-live) — filtered shows "{n} of {total} match" (single
    // "match"); unfiltered shows "{total} commands".
    if (countEl) {
        countEl.textContent = isFiltering
            ? `${filtered.length} of ${total} match`
            : `${total} commands`;
    }

    // List band — rows, or an empty-state message.
    if (listEl) {
        if (filtered.length === 0) {
            const msg = total === 0
                ? 'No history yet — commands you send will appear here'
                : 'No matching commands';
            listEl.innerHTML = `<div class="ch-empty">${esc(msg)}</div>`;
        } else {
            // Retro tweak i — render oldest→newest top→bottom, so the newest
            // entry (filtered[0]) is the BOTTOM row, beside the edit line. Row
            // ids stay keyed to the newest-first index (aria-activedescendant
            // and the highlight are index-based, not position-based).
            let html = '';
            for (let i = filtered.length - 1; i >= 0; i--) {
                const sel = i === highlight;
                html += `<div class="ch-row${sel ? ' sel' : ''}" role="option"`
                    + ` id="ch-opt-${i}" aria-selected="${sel ? 'true' : 'false'}">`
                    + `<span class="mark" aria-hidden="true">›</span>`
                    + `<span class="ch-row-txt">${esc(filtered[i])}</span>`
                    + `</div>`;
            }
            listEl.innerHTML = html;
        }
    }

    // Edit line — render editText with the fake caret at caretIndex, or the muted
    // placeholder when empty.
    if (entryEl && txtEl) {
        if (editText.length === 0) {
            entryEl.classList.add('ch-placeholder');
            txtEl.innerHTML = 'type to filter…<span class="cur"></span>';
        } else {
            entryEl.classList.remove('ch-placeholder');
            const before = esc(editText.slice(0, caretIndex));
            const after = esc(editText.slice(caretIndex));
            txtEl.innerHTML = `${before}<span class="cur"></span>${after}`;
        }
        // aria-activedescendant tracks the highlighted option (best-effort — see
        // the a11y honesty note; the live caption is the dependable AT signal).
        txtEl.setAttribute('aria-activedescendant',
            filtered.length > 0 ? `ch-opt-${highlight}` : '');
    }

    // Keep the highlighted row in view within the scrollable list band.
    if (listEl && filtered.length > 0) {
        const selRow = listEl.querySelector('.ch-row.sel');
        if (selRow && typeof selRow.scrollIntoView === 'function') {
            selRow.scrollIntoView({ block: 'nearest' });
        }
    }
}

// ====== Helpers ======

function clamp(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
}

// Escape the four HTML-significant chars so command strings that contain <, >, &,
// or " (e.g. `10 PRINT "HELLO FROM Z80"`) render as text, not markup.
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// wireXxx shape parity (AD-2) — detach the listener so a disposed overlay holds
// nothing on #terminal-wrapper.
function dispose() {
    if (wrapperEl && keydownHandler) {
        wrapperEl.removeEventListener('keydown', keydownHandler);
    }
    keydownHandler = null;
    close();
}

// ====== Test introspection (window.__* pattern) ======

function __getStateForTests() {
    return {
        isOpen: isOpenState,
        editText,
        caretIndex,
        highlight,
        navigated,
        total: baseHistory.length,
        filtered: filtered.slice(),
        caption: countEl ? countEl.textContent : '',
    };
}

function __resetForTests() {
    close();
}
