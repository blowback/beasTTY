// BestialiTTY — boot driver (Phase 3 renderer + Phase 4 Plan 02 keyboard).
//
// Preserves the Phase 2 wasm boundary + harness helpers (parseHexEscapes,
// buildStressPayload, Feed button, 64 KB Stress button). Delegates rendering
// to www/renderer/canvas.js (rAF + HiDPI + glyph atlas). Wires DOM chrome
// (theme toggle, phosphor radio-group, keyboard shortcuts, focus indicator)
// via www/renderer/chrome.js. Phase 4 Plan 02 adds wireKeyboard() from
// www/input/keyboard.js — attaches AFTER wireChrome so chrome.js's keydown
// listener retains priority on Ctrl+Alt+T / Ctrl+{+,-,0} chords.
//
// Source:
//   - 03-PATTERNS.md §"www/main.js" retrofit specification.
//   - 03-CONTEXT.md D-15 (Debug details retains Phase 2 SC-4 path).
//   - 04-PATTERNS.md §"www/main.js (modified)" (wireKeyboard call site).

// Phase 5 D-32 / D-33 — polite-fail gate. MUST be the first executable block
// so wasm + fonts + canvas never load on non-Chromium browsers.
import { renderPoliteFail } from './transport/serial.js';
if (typeof navigator.serial === 'undefined') {
    renderPoliteFail();
    throw new Error('__polite-fail__');   // abort module execution; wasm never initialises
}

import init, { Terminal } from './pkg/bestialitty_core.js';
import {
    bootRenderer,
    requestFrame,
    setTheme,
    setPhosphor,
    zoomStep,
    resetZoom,
    setFocus,
    getActiveTheme,
    getActivePhosphor,
    getActiveZoom,
    triggerBellFlash,          // Plan 03 owns bell sampling; canvas.js provides the CSS helper
} from './renderer/canvas.js';
import { wireChrome } from './renderer/chrome.js';
import { wireKeyboard, setLocalEcho, setCrlfMode } from './input/keyboard.js';
import { registerTxObserver, formatHexStrip, resetTx } from './input/tx-sink.js';

// ---- init + construction (Phase 2 — unchanged) ----
const wasm = await init();                             // top-level-await: Chromium >=89
const term = new Terminal(24, 80, 10_000);             // #[wasm_bindgen(constructor)]

// ---- Phase 3 renderer + chrome wiring ----
await bootRenderer({ wasm, term });

const terminalWrapper = document.getElementById('terminal-wrapper');
const themeButton     = document.getElementById('theme-toggle');
const phosphorGroup   = document.getElementById('phosphor-group');
const phosphorButtons = phosphorGroup.querySelectorAll('button[data-phosphor]');
const bellOverlay     = document.getElementById('bell-overlay');
// Phase 4 Plan 03 — Settings pane + Debug TX strip refs.
const localEchoCheckbox = document.getElementById('local-echo');
const crlfRadios        = document.querySelectorAll('input[name="crlf"]');
const txStripEl         = document.getElementById('tx-strip');
const txResetButton     = document.getElementById('tx-reset');
const TX_STRIP_PLACEHOLDER = '(none yet — press any key on the terminal to see TX bytes)';
wireChrome({ terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay });

// ---- Phase 4 Plan 01 — test harness hook (unconditionally exposed) ----
// Plan 04-04's local-echo spec uses __testGridView() to read grid bytes back
// and assert that typed chars rendered (echo on) vs did not render (echo off,
// the Phase 4 default). Unconditionally exposed — not gated by ?test=1 —
// because Phase 4 has zero security surface (no auth, no PII, no network);
// Phase 5 Web Serial will gate differently if needed.
window.__testGridView = () => new Uint8Array(
    wasm.memory.buffer,
    term.grid_ptr(),
    term.grid_byte_len(),
);

// ---- Phase 2 harness helpers (retained verbatim for Debug pane — D-15) ----

function parseHexEscapes(input) {
    const out = [];
    let i = 0;
    while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === 0x5C /* \ */
            && i + 4 <= input.length
            && (input.charCodeAt(i + 1) === 0x78 || input.charCodeAt(i + 1) === 0x58) /* x or X */) {
            const hiVal = hexDigit(input.charCodeAt(i + 2));
            const loVal = hexDigit(input.charCodeAt(i + 3));
            if (hiVal !== null && loVal !== null) {
                out.push((hiVal << 4) | loVal);
                i += 4;
                continue;
            }
        }
        if (ch <= 0xFF) out.push(ch);
        i++;
    }
    return new Uint8Array(out);
}

function hexDigit(c) {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    return null;
}

function buildStressPayload(total) {
    const buf = new Uint8Array(total);
    let w = 0;
    while (w < total) {
        for (let b = 0x20; b <= 0x7E && w < total; b++) buf[w++] = b;
        if (w + 4 <= total) {
            buf[w++] = 0x1B;
            buf[w++] = 0x59; // 'Y'
            buf[w++] = 0x20;
            buf[w++] = 0x20;
        } else {
            while (w < total) buf[w++] = 0x20;
        }
    }
    return buf;
}

// ---- Host-reply drain helper (zero-copy per Phase 2 02-06 pattern) ----
// Derives a fresh view into wasm.memory.buffer when the buffer identity has
// shifted (memory growth). Used ONLY in the Feed / Stress click handlers;
// the renderer owns its own grid/dirty views (canvas.js re-derives them there).
const HOST_REPLY_VIEW_CAP = 8;
let hostReplyView = null;
let hostReplyBuffer = null;

function reDeriveHostReplyView() {
    if (wasm.memory.buffer !== hostReplyBuffer) {
        hostReplyView = new Uint8Array(wasm.memory.buffer, term.host_reply_ptr(), HOST_REPLY_VIEW_CAP);
        hostReplyBuffer = wasm.memory.buffer;
    }
}
reDeriveHostReplyView();

function drainHostReply(tag) {
    const replyLen = term.host_reply_len();
    if (replyLen > 0) {
        reDeriveHostReplyView();
        console.log(`[host_reply ${tag}]`, Array.from(hostReplyView.subarray(0, replyLen)));
        term.clear_host_reply();
    }
}

// ---- Bell sampling helper (RENDER-11 — synchronous post-feed path) ----
// Called AFTER every term.feed(...) invocation. Owning the bell flow here
// (instead of inside canvas.js's rAF tick) keeps the BEL-while-hidden title
// prefix immune to Chromium's ~1 Hz rAF throttling when document.hidden is true.
// The CSS overlay flash is driven by canvas.js's exported triggerBellFlash()
// which toggles a class on #bell-overlay (CSS transition handles the 100 ms timing).
const TITLE_PREFIX = '(!) ';
function sampleBell() {
    if (!term.bell_pending()) return;
    term.clear_bell();
    triggerBellFlash();                               // CSS class toggle; no rAF needed
    if (document.hidden && !document.title.startsWith(TITLE_PREFIX)) {
        document.title = TITLE_PREFIX + document.title;
    }
    // NOTE: the foreground-return "strip prefix" half is handled by the
    // visibilitychange listener registered in chrome.js wireChrome().
}

// ---- Phase 4 Plan 02 — keyboard input wiring ----
// wireKeyboard attaches its keydown + compositionstart/update/end listeners
// to #terminal-wrapper. chrome.js's keydown listener attached FIRST (inside
// wireChrome above), so Phase 4's listener runs SECOND and short-circuits on
// e.defaultPrevented for chords chrome.js already claimed (Ctrl+Alt+T,
// Ctrl+{+,-,0}). Call site sits AFTER the sampleBell / drainHostReply arrow
// functions are assigned so injected refs are defined (would TDZ if moved
// earlier). Plan 04-03 wires the Settings-pane toggles (local-echo checkbox,
// CR/LF radios, Reset TX button) and registers the TX observer against the
// Debug pane's hex-strip <pre>; Plan 04-02 leaves the observer un-registered
// so the TX strip stays at its placeholder text until Plan 04-03 adds the
// DOM element.
wireKeyboard({
    term,
    terminalWrapper,
    sampleBell,
    drainHostReply,
    requestFrame,
});

// ---- Phase 4 Plan 03 — Settings controls ----
// Local-echo toggle (INPUT-04). Default unchecked in DOM; setLocalEcho(false)
// is the default in keyboard.js. Change event fires for both mouse-click
// (after mousedown preventDefault below restores the toggle) and keyboard
// activation (Tab + Space).
localEchoCheckbox.addEventListener('change', (e) => {
    setLocalEcho(e.target.checked);
});
// D-16 — mousedown preventDefault prevents focus transfer. For a native
// <input type="checkbox">, the subsequent click event STILL toggles the
// checked state (mousedown's preventDefault only stops focus, not the
// native click-toggle), so we do NOT manually flip .checked here — the
// change listener above already fires from that native toggle. Plan 04-04
// Task 1 Rule 1 fix: an earlier version manually flipped .checked in this
// handler, which the subsequent native click then reverted, leaving the
// checkbox effectively un-togglable by mouse.
localEchoCheckbox.addEventListener('mousedown', (e) => {
    e.preventDefault();
});

// CR/LF override (INPUT-05). Radio default 'cr' per UI-SPEC (checked attr
// on #crlf-cr). Change event fires via Tab+Space or (after mousedown restore)
// mouse click.
for (const radio of crlfRadios) {
    radio.addEventListener('change', (e) => {
        if (e.target.checked) setCrlfMode(e.target.value);
    });
    // D-16 — mousedown preventDefault + explicit check + setCrlfMode.
    radio.addEventListener('mousedown', (e) => {
        e.preventDefault();
        radio.checked = true;
        // Clear sibling radios (native radio group exclusion is bypassed
        // when we set .checked programmatically after preventDefault).
        for (const other of crlfRadios) {
            if (other !== radio) other.checked = false;
        }
        setCrlfMode(radio.value);
    });
}

// TX-strip observer (D-15). Registered exactly once; fires synchronously on
// every pushTxBytes. Placeholder restored when ring is empty (after resetTx
// or before any keypress).
registerTxObserver(() => {
    const hex = formatHexStrip(64);
    txStripEl.textContent = hex === '' ? TX_STRIP_PLACEHOLDER : hex;
});

// Reset TX button — non-destructive (CONTEXT D-07, UI-SPEC Destructive states:
// "not applicable"). Click fires from both mouse (via mousedown restore) and
// keyboard (Tab + Enter/Space).
txResetButton.addEventListener('click', () => {
    resetTx();
});
txResetButton.addEventListener('mousedown', (e) => {
    e.preventDefault();                           // D-16 focus retention.
    resetTx();                                    // explicit action — mousedown suppressed native click path.
});

// ---- Feed button (Phase 2 D-11 item 2 — ONE feed call per click) ----
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);                       // ONE boundary call (Pitfall #1).
    sampleBell();                           // RENDER-11 — synchronous bell sampling (NOT from rAF).
    drainHostReply('feed');
    requestFrame();                         // wake renderer — Phase 3 replacement for refreshHarnessUI().
});

// ---- 64 KB Stress button (Phase 2 SC-4 — retained verbatim) ----
document.getElementById('stress64k').addEventListener('click', () => {
    const bytes = buildStressPayload(65536);

    console.time('Terminal.feed 64KB');
    const t0 = performance.now();
    term.feed(bytes);                       // ONE call — SC-4 verifies this.
    const t1 = performance.now();
    console.timeEnd('Terminal.feed 64KB');

    sampleBell();                           // RENDER-11 — synchronous bell sampling (NOT from rAF).
    drainHostReply('64KB');

    // SC-4 proof-artifact log lines (Phase 2 regression guard):
    console.log(`[SC-4] Fed ${bytes.length} bytes in ONE feed() call`);
    console.log(`[SC-4] Elapsed: ${(t1 - t0).toFixed(3)} ms`);
    console.log(`[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.`);

    requestFrame();
});

// ---- Boot-complete log ----
console.log('[boot] Harness ready. theme=', getActiveTheme().name, 'phosphor=', getActivePhosphor(), 'zoom=', getActiveZoom());
console.log('[boot] term=', term, 'wasm.memory=', wasm.memory);
