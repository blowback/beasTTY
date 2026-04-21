// BestialiTTY Phase 2 harness driver.
//
// - Loads the wasm-pack --target web output at ./pkg/bestialitty_core.js.
// - Constructs one long-lived Terminal(24, 80, 10_000).
// - Derives Uint8Array views over wasm linear memory (D-03 contract).
// - Renders the ASCII grid + dirty bitmap + cursor/bell status.
// - Feed button: one feed() call per click — never per-byte (Pitfall #1).
// - 64 KB Stress button: builds 65_536 bytes and calls feed() ONCE. SC-4.
//
// See .planning/phases/02-wasm-boundary-minimal-js-harness/02-RESEARCH.md
// Patterns 1-3 and §Hex-Escape Textarea Parser / §64 KB Single-Feed
// Demonstration for the derivation of every section below.

import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js';

// ---- init + construction ----------------------------------------------

const wasm = await init();                             // top-level-await: Chromium >=89
const term = new Terminal(24, 80, 10_000);             // #[wasm_bindgen(constructor)]

// Smoke-exercise encode_key_raw so the export isn't dead-stripped; Phase 4
// will wire DOM keydown to it. Logging here also proves the export works.
const upEnc = encode_key_raw(1 /* tag=ArrowUp */, 0 /* no mods */);
console.log('[boot] encode_key_raw(ArrowUp, none) =', Array.from(upEnc));  // [27, 65] = ESC A

// ---- zero-copy view derivation (D-03) ---------------------------------

const CELL_SIZE = 8;   // matches Cell #[repr(C)] size assert in grid.rs

// One-time derivation. Re-derive after term.resize() OR on every render
// tick as a defensive guard against wasm ArrayBuffer detachment (Pitfall #2).
let gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
let dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());

function reDeriveViews() {
    gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
    dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
}

// ---- renderers ---------------------------------------------------------

function renderAscii() {
    term.snapshot_grid();
    reDeriveViews();   // defensive (Pitfall #2) — cheap (two Uint8Array ctors)
    const rows = term.rows();
    const cols = term.cols();
    let out = '';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * CELL_SIZE;
            const ch = gridView[i];   // ch LSB at byte offset 0 (little-endian u32)
            // Non-printables render as space (Phase 3 owns glyph translation).
            out += (ch === 0 || ch < 0x20) ? ' ' : String.fromCharCode(ch);
        }
        out += '\n';
    }
    // Use textContent — never the HTML-parsing sink (XSS guard per RESEARCH §Security Domain).
    document.getElementById('grid').textContent = out;
}

function renderDirty() {
    // Join bytes as digits so dirty rows show as '1' and clean as '0'.
    document.getElementById('dirty').textContent = Array.from(dirtyView).join('');
    term.clear_dirty();
}

function renderStatus() {
    const packed = term.cursor_packed();
    const row = packed >>> 16;
    const col = packed & 0xFFFF;
    const bell = term.bell_pending();
    document.getElementById('status').textContent =
        `cursor=(${row},${col}) bell=${bell}`;
}

function refreshHarnessUI() {
    renderAscii();
    renderDirty();
    renderStatus();
}

// ---- hex-escape parser (RESEARCH §Hex-Escape Textarea Parser) ---------

function parseHexEscapes(input) {
    const out = [];
    let i = 0;
    while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === 0x5C /* \ */
            && i + 3 < input.length + 1
            && (input.charCodeAt(i + 1) === 0x78 || input.charCodeAt(i + 1) === 0x58) /* x or X */) {
            const hiVal = hexDigit(input.charCodeAt(i + 2));
            const loVal = hexDigit(input.charCodeAt(i + 3));
            if (hiVal !== null && loVal !== null) {
                out.push((hiVal << 4) | loVal);
                i += 4;
                continue;
            }
            // malformed \x — fall through and treat backslash as literal.
        }
        if (ch <= 0xFF) out.push(ch);
        i++;
    }
    return new Uint8Array(out);
}

function hexDigit(c) {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;           // 0-9
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;      // A-F
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;      // a-f
    return null;
}

// ---- Feed button (D-11 item 2 — ONE feed call per click) --------------

document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);                     // ONE boundary call regardless of length
    refreshHarnessUI();
});

// ---- 64 KB Stress button (D-11 item 4 — SC-4 signal) ------------------

function buildStressPayload(total) {
    const buf = new Uint8Array(total);
    let w = 0;
    while (w < total) {
        // 95 bytes: printable ASCII ramp 0x20..0x7E
        for (let b = 0x20; b <= 0x7E && w < total; b++) buf[w++] = b;
        // 4 bytes: ESC Y 0x20 0x20 (cursor to (0, 0) via +32 offset)
        if (w + 4 <= total) {
            buf[w++] = 0x1B;
            buf[w++] = 0x59; // 'Y'
            buf[w++] = 0x20;
            buf[w++] = 0x20;
        } else {
            // Pad the tail with spaces to hit the exact total.
            while (w < total) buf[w++] = 0x20;
        }
    }
    return buf;
}

document.getElementById('stress64k').addEventListener('click', () => {
    const bytes = buildStressPayload(65536);

    console.time('Terminal.feed 64KB');
    const t0 = performance.now();
    term.feed(bytes);                     // ONE call — this is what SC-4 verifies.
    const t1 = performance.now();
    console.timeEnd('Terminal.feed 64KB');

    // SC-4 proof-artifact log lines (author screenshots these for verification):
    console.log(`[SC-4] Fed ${bytes.length} bytes in ONE feed() call`);
    console.log(`[SC-4] Elapsed: ${(t1 - t0).toFixed(3)} ms`);
    console.log(`[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.`);

    refreshHarnessUI();
});

// ---- initial paint ----------------------------------------------------

refreshHarnessUI();                       // blank grid + all-clean dirty initially
console.log('[boot] Harness ready. Terminal=', term, 'wasm.memory=', wasm.memory);
