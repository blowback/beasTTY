// Beastty Phase 4 Plan 02 — DOM keydown → VT52 byte forwarder.
//
// Attaches AFTER www/renderer/chrome.js's keydown listener (main.js wires
// chrome.js first, then keyboard.js). Short-circuits on e.defaultPrevented
// so Phase 3's Ctrl+Alt+T and Ctrl+{+,-,0} chords stay owned by chrome.js.
//
// Sources:
//   - 04-CONTEXT.md D-01 (single listener on #terminal-wrapper)
//   - 04-CONTEXT.md D-02 (synchronous preventDefault — Pitfall #3)
//   - 04-CONTEXT.md D-03 (e.code for control keys, e.key for printable)
//   - 04-CONTEXT.md D-04/D-05 (KeyCode tag table + arrow/numpad mapping)
//   - 04-CONTEXT.md D-06 (compositionstart/update/end + isComposing guard)
//   - 04-CONTEXT.md D-08/D-09 (local-echo flag, default false)
//   - 04-CONTEXT.md D-10/D-11/D-12 (CR/LF TX-side rewrite, default CR)
//   - 04-CONTEXT.md D-17 (F1-F12 / Home/End / PgUp/PgDn / Del/Ins / Meta
//     alone — silent drop, NO preventDefault)
//   - crates/beastty-core/src/key.rs:141-175 (KEY_TAG values + mod bits)
//   - www/renderer/chrome.js (wireX(opts) entry pattern, synchronous
//     preventDefault discipline)

import { encode_key_raw } from '../pkg/beastty_core.js';
import { pushTxBytes } from './tx-sink.js';
import { isActive as pastePumpIsActive, cancelPaste } from './paste-pump.js';
// Phase 10 Plan 10-03 — SLIDE-cancel arm in the Esc disambiguation chain.
// isSlideActive() is the gate; cancelSlideRecv() runs the ADR-003 §3 5-step
// CTRL_CAN sequence (200/500/100/2000 ms). Inserted BETWEEN the existing
// selection-drag-cancel arm (Phase 6 D-19) and paste-cancel arm (Phase 5 D-18)
// per CONTEXT.md §"Esc disambiguation slot" lock.
import { isSlideActive, cancelSlideRecv } from '../transport/slide-recv.js';
// Phase 6 Plan 04 (Wave 3) — clipboard + selection + scroll-state intercepts.
import { copySelection, pasteFromClipboard } from './clipboard.js';
import {
    isDragging as selectionIsDragging,
    cancelDrag as selectionCancelDrag,
    clearSelection as selectionClear,
} from './selection.js';
import {
    isScrolledBack as scrollIsScrolledBack,
    scrollByPage,
    snapToBottom,
    jumpToTop,
} from '../renderer/scroll-state.js';

// D-04 — frozen KeyCode tag table (mirrors crates/beastty-core/src/key.rs:141-159).
// Any drift silently produces wrong TX bytes; the Wave 3 Playwright suite
// catches drift via exact-byte assertions.
const KEY_TAG = Object.freeze({
    Char:         0,
    ArrowUp:      1,
    ArrowDown:    2,
    ArrowLeft:    3,
    ArrowRight:   4,
    Enter:        5,
    Tab:          6,
    Backspace:    7,
    Escape:       8,
    KeypadDigit:  9,
    KeypadEnter:  10,
    KeypadComma:  11,
    KeypadMinus:  12,
    KeypadDot:    13,
});

// D-11 — CR/LF modes. Default D-12 = 'cr'.
// Phase 5 D-23 — exported so paste-pump can reuse the identical table.
export const CRLF_MODES = Object.freeze({
    cr:   new Uint8Array([0x0D]),
    lf:   new Uint8Array([0x0A]),
    crlf: new Uint8Array([0x0D, 0x0A]),
});

// --- Module-scope state --------------------------------------------------
// Flipped via exported setters (analogous to canvas.js setFocus pattern).
let localEcho = false;
let crlfMode = 'cr';

// IME guard (D-06). `isComposing` is our own flag; we also check
// e.isComposing on every keydown as belt-and-braces.
let isComposing = false;

// Deps injected via wireKeyboard(opts) so this module does not import from
// main.js (avoids circular imports and keeps keyboard.js testable).
let termRef = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;

// --- Public setters/getters ----------------------------------------------

export function setLocalEcho(value) { localEcho = !!value; }
export function getLocalEcho() { return localEcho; }

export function setCrlfMode(mode) {
    if (mode !== 'cr' && mode !== 'lf' && mode !== 'crlf') return;
    crlfMode = mode;
}
export function getCrlfMode() { return crlfMode; }

// --- Phase 6 helper — pure-modifier-key detection ------------------------

// Pure modifier-key keydowns (Shift/Ctrl/Alt/Meta press without a chord) do
// not produce TX bytes and must NOT trigger the D-04 snap-on-TX gate while
// scrolled back. Without this guard, pressing the leading modifier of a chord
// like Shift+PageDown snaps the viewport before the second key arrives,
// leaving D-01 broken.
function isPureModifierKey(code) {
    return code === 'ShiftLeft' || code === 'ShiftRight'
        || code === 'ControlLeft' || code === 'ControlRight'
        || code === 'AltLeft' || code === 'AltRight'
        || code === 'MetaLeft' || code === 'MetaRight';
}

// --- Key-event packing (D-04, D-05) --------------------------------------

// Returns u32 code or -1 for "unhandled / silent drop".
export function packKeyCode(e) {
    // D-03 step 2: control keys by e.code.
    switch (e.code) {
        case 'ArrowUp':     return KEY_TAG.ArrowUp;
        case 'ArrowDown':   return KEY_TAG.ArrowDown;
        case 'ArrowLeft':   return KEY_TAG.ArrowLeft;
        case 'ArrowRight':  return KEY_TAG.ArrowRight;
        case 'Enter':       return KEY_TAG.Enter;
        case 'Tab':         return KEY_TAG.Tab;
        case 'Backspace':   return KEY_TAG.Backspace;
        case 'Escape':      return KEY_TAG.Escape;
        case 'NumpadEnter': return KEY_TAG.KeypadEnter;
        case 'NumpadDecimal': return KEY_TAG.KeypadDot;
        case 'NumpadSubtract': return KEY_TAG.KeypadMinus;
        case 'NumpadComma': return KEY_TAG.KeypadComma;
        // D-17 silent drop (NO preventDefault handled at caller):
        case 'F1': case 'F2': case 'F3': case 'F4': case 'F5': case 'F6':
        case 'F7': case 'F8': case 'F9': case 'F10': case 'F11': case 'F12':
        case 'Home': case 'End': case 'PageUp': case 'PageDown':
        case 'Insert': case 'Delete':
        case 'PrintScreen': case 'CapsLock': case 'ScrollLock': case 'NumLock':
        case 'ContextMenu': case 'MetaLeft': case 'MetaRight':
            return -1;
    }
    // D-05 NumpadDigit: payload digit in bits 8-15.
    if (e.code && e.code.startsWith('Numpad') && e.code.length === 7) {
        const d = e.code.charCodeAt(6) - 0x30;
        if (d >= 0 && d <= 9) return KEY_TAG.KeypadDigit | (d << 8);
    }
    // D-03 step 3: printable char — e.key path (e.g. Shift+Digit1 → '!').
    if (e.key && e.key.length === 1) {
        const b = e.key.charCodeAt(0);
        if (b <= 0xFF) return KEY_TAG.Char | (b << 8);
    }
    return -1; // unhandled
}

// Returns u32 mods with bit layout from key.rs:165-168.
export function packModifiers(e) {
    return (e.ctrlKey  ? 0b0001 : 0)
         | (e.shiftKey ? 0b0010 : 0)
         | (e.altKey   ? 0b0100 : 0)
         | (e.metaKey  ? 0b1000 : 0);
}

// --- Wire entry ----------------------------------------------------------

export function wireKeyboard(opts) {
    const {
        term,
        terminalWrapper,
        sampleBell,
        drainHostReply,
        requestFrame,
    } = opts;
    termRef = term;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;

    // --- Composition (IME) listeners — D-06 -----------------------------
    terminalWrapper.addEventListener('compositionstart', () => {
        isComposing = true;
    });
    terminalWrapper.addEventListener('compositionupdate', () => {
        // no-op — commit on compositionend only.
    });
    terminalWrapper.addEventListener('compositionend', (e) => {
        isComposing = false;
        const data = e.data || '';
        // ASCII fast path (D-06 footnote: VT52 is ASCII; planner picks the
        // strict ASCII guard over TextEncoder per "Claude's Discretion").
        for (let i = 0; i < data.length; i++) {
            const b = data.charCodeAt(i);
            if (b <= 0xFF) {
                const bytes = encode_key_raw(KEY_TAG.Char | (b << 8), 0);
                if (bytes.length > 0) forwardBytes(bytes, /* wasEnter */ false);
            }
            // Non-ASCII code points are silently dropped — VT52 has no codepath
            // for them; if a future workload needs UTF-8 TX, extend here.
        }
    });

    // --- keydown listener — D-01/D-02/D-03 ------------------------------
    terminalWrapper.addEventListener('keydown', (e) => {
        // D-01 — skip chords already handled by chrome.js (e.g. Ctrl+Alt+T).
        if (e.defaultPrevented) return;

        // D-06 belt-and-braces — ignore during composition (some Chromium
        // versions set isComposing on first post-commit keydown).
        if (isComposing || e.isComposing) return;

        // Ctrl+Shift+Esc — clear an established (non-dragging) selection
        // without sending 0x1B to the remote. Bare Esc is preserved for VT52
        // workloads (CP/M, vi, MicroBeast TUIs); the chord is unambiguously
        // UI-only and Chromium does not reserve it on a focused page.
        if (e.code === 'Escape' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            selectionClear();
            return;
        }

        // Phase 6 D-19 — Esc cancels in-flight selection drag (PRIORITY:
        // before paste-cancel). 06-UI-SPEC §Esc key disambiguation locks the
        // priority order: 1) selection drag cancel (UI-only, no remote effect),
        // 2) paste cancel (Phase 5 D-18), 3) encode 0x1B to remote.
        if (e.code === 'Escape' && selectionIsDragging()) {
            e.preventDefault();
            selectionCancelDrag();
            return;
        }

        // Phase 10 D-disambiguation: slot 2 of 4 in the Esc-only disambiguation chain (slot 3 of 5 if Ctrl+Shift+Esc is counted). Inserted between selection-drag-cancel (existing slot 1 / chain pos 2) and paste-cancel (existing slot 2 / chain pos 4).
        if (e.code === 'Escape' && isSlideActive()) {
            e.preventDefault();
            cancelSlideRecv();
            return;
        }

        // Phase 5 D-18 — Esc while paste pump is active cancels the paste AND
        // suppresses 0x1B. When pump is idle, Esc encodes normally (Phase 4
        // behaviour unchanged).
        if (e.code === 'Escape' && pastePumpIsActive()) {
            e.preventDefault();
            cancelPaste();
            return;
        }

        // Phase 6 D-21 — Ctrl+Shift+C copies. Ctrl+C (no Shift) still encodes
        // 0x03 via the encode path below. Chromium reserves Ctrl+Shift+C for
        // DevTools inspector; the standard preventDefault mitigation suffices
        // when DevTools is closed (UAT confirms).
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyC') {
            e.preventDefault();
            copySelection();
            return;
        }

        // Phase 6 D-22 — Ctrl+Shift+V pastes. Ctrl+V (no Shift) still encodes
        // 0x16 (SYN) via the encode path below.
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyV') {
            e.preventDefault();
            pasteFromClipboard();
            return;
        }

        // Phase 6 D-01 / D-05 — Shift+PgUp / Shift+PgDn / Shift+End / Shift+Home
        // scroll. Plain PgUp/PgDn/End/Home pass through (silent drop per Phase 4
        // D-17 since packKeyCode returns -1 for those).
        if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (e.code === 'PageUp')   { e.preventDefault(); scrollByPage(+1); return; }
            if (e.code === 'PageDown') { e.preventDefault(); scrollByPage(-1); return; }
            if (e.code === 'End')      { e.preventDefault(); snapToBottom();   return; }
            if (e.code === 'Home')     { e.preventDefault(); jumpToTop();      return; }
        }

        // Phase 6 D-04 — any TX-producing keypress while scrolled-back snaps
        // to live tail. Gate runs AFTER all Phase 6 intercepts above (which
        // return early so non-TX chords like Shift+End never reach this gate)
        // but BEFORE the encode path so the snap is synchronous with the byte.
        // Skip pure modifier-key keydowns (ShiftLeft/Right, ControlLeft/Right,
        // AltLeft/Right, MetaLeft/Right) — those don't produce TX bytes and
        // would otherwise snap-to-bottom the moment the user starts a chord.
        if (scrollIsScrolledBack() && !isPureModifierKey(e.code)) {
            snapToBottom();
        }

        const code = packKeyCode(e);
        if (code < 0) return;                        // D-17 silent drop, NO preventDefault.

        const mods = packModifiers(e);
        e.preventDefault();                          // D-02 — SYNCHRONOUS first.

        const bytes = encode_key_raw(code, mods);
        if (bytes.length === 0) return;              // unknown tag arm, zero-length

        const wasEnter = (code === KEY_TAG.Enter) || (code === KEY_TAG.KeypadEnter);
        forwardBytes(bytes, wasEnter);
    });
}

// --- Forward path (CR/LF rewrite + local-echo) --------------------------

function forwardBytes(bytes, wasEnter) {
    // D-10/D-11 — TX-side CR/LF rewrite only when Enter/NumpadEnter was the
    // cause AND encoder emitted exactly [0x0D]. Leaves every other byte untouched.
    let outBytes = bytes;
    if (wasEnter && bytes.length === 1 && bytes[0] === 0x0D && crlfMode !== 'cr') {
        outBytes = CRLF_MODES[crlfMode];
    }

    pushTxBytes(outBytes);

    // D-08 — local-echo: mirror the TX bytes through the parser so they
    // render on the canvas. Matches Phase 3's sampleBell → drainHostReply →
    // requestFrame sequence (www/main.js:140-147).
    if (localEcho && termRef) {
        termRef.feed(outBytes);
        if (sampleBellFn) sampleBellFn();
        if (drainHostReplyFn) drainHostReplyFn('echo');
        if (requestFrameFn) requestFrameFn();
    }
}
