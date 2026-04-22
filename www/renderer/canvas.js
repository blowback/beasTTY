// BestialiTTY Phase 3 — Canvas 2D renderer (rAF + dirty-row repaint + HiDPI).
//
// Source: RESEARCH §Complete rAF Loop Skeleton + §Pattern 1 (HiDPI) +
//         §Pattern 5 (cursor) + §Pitfall 9 (font force-load) + CONTEXT D-03..D-15.
// Preserves Phase 2 D-03 zero-copy contract verbatim — cachedBuffer identity
// guard in rebuildViews() / reDeriveViews() (see www/main.js:35-54 for analog).
//
// Public API: bootRenderer, requestFrame, setTheme, setPhosphor, zoomStep,
// resetZoom, setFocus, getActiveTheme, getActivePhosphor, getActiveZoom,
// triggerBellFlash. No runtime exports beyond these — Plan 03's chrome.js
// consumes them by name.
//
// rAF tick is PAINT-ONLY — it does not sample bell state, does not clear
// bell state, and does not mutate the browser tab title. Those responsibilities
// live in main.js (Plan 03) via the synchronous feed-completion path, which
// decouples bell semantics from Chromium's ~1 Hz rAF throttling when the
// document is hidden. canvas.js exposes triggerBellFlash() as a helper that
// main.js / chrome.js may call directly.

import {
    THEMES,
    DEFAULT_THEME_NAME,
    DEFAULT_PHOSPHOR,
    DEFAULT_ZOOM,
} from './themes.js';
import {
    Atlas,
    rasteriseBitmap,
    rasteriseVector,
    primeAscii,
} from './atlas.js';

// ---- Phase 2 zero-copy contract (D-03 — verbatim from www/main.js:35-54) ----

const CELL_SIZE = 8;   // Cell #[repr(C)] size assert in grid.rs

let wasm = null;
let term = null;
let cachedBuffer = null;
let gridView = null;
let dirtyView = null;

function rebuildViews() {
    gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
    dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
    cachedBuffer = wasm.memory.buffer;
}

function reDeriveViews() {
    if (wasm.memory.buffer !== cachedBuffer) rebuildViews();
}

// Mark every row dirty so the next tick() repaints the entire grid. Called
// after atlas.evict() from setTheme / setPhosphor / zoomStep / resetZoom /
// watchDPR — otherwise the dirty-row optimisation leaves the canvas blank
// (atlas flushed + dirty-bitmap still all-zero → paint loop paints nothing).
// UAT gaps 3, 5, 6 all share this root cause.
function markAllRowsDirty() {
    if (!dirtyView) return;
    const rows = dirtyView.length;
    for (let r = 0; r < rows; r++) dirtyView[r] = 1;
}

// ---- Module-local renderer state ----

let canvas = null;
let ctx = null;
let atlas = null;

let activeTheme = THEMES[DEFAULT_THEME_NAME];   // D-06 default: crt
let activePhosphor = DEFAULT_PHOSPHOR;           // D-06 default: green
let activeZoom = DEFAULT_ZOOM;                    // D-06 default: 1
let activeDpr = 1;

let frameCount = 0;
let rafPending = false;
let needsPaint = false;
let canvasHasFocus = false;
let bellOverlayEl = null;    // resolved lazily — chrome.js may add #bell-overlay after boot
let bellFlashTimer = null;   // outstanding setTimeout handle for bell-overlay class reset (WR-04 fold)
let blinkStartMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();

// ---- HiDPI resize (RESEARCH §Pattern 1) ----

function resizeToTheme() {
    const z = activeZoom;
    const cellW = activeTheme.cellW * z;
    const cellH = activeTheme.cellH * z;
    const cssW = cellW * 80;
    const cssH = cellH * 24;
    activeDpr = window.devicePixelRatio || 1;

    canvas.width  = Math.round(cssW * activeDpr);
    canvas.height = Math.round(cssH * activeDpr);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';

    // ctx state is reset by canvas.width/height assignment (RESEARCH Pitfall #2).
    // Re-establish — NEVER ctx.scale (Anti-Pattern).
    ctx.setTransform(activeDpr, 0, 0, activeDpr, 0, 0);
    ctx.imageSmoothingEnabled = (activeTheme.name === 'crt' ? false : true);
    ctx.textBaseline = 'top';
    if (activeTheme.font) {
        ctx.font = `${activeTheme.fontPx}px "${activeTheme.font}", ui-monospace, monospace`;
    }

    // Paint the theme bg over the entire canvas so any non-dirty cells that
    // persisted from the previous theme vanish.
    ctx.fillStyle = activeTheme.bg;
    ctx.fillRect(0, 0, cssW, cssH);
}

// DPR change detection (monitor drag / zoom) — RESEARCH §Pattern 1 watchDPR.
// Uses one-shot matchMedia listener that self-re-registers for the NEW DPR
// after firing.
function watchDPR() {
    const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener('change', () => {
        if (atlas) atlas.evict();
        markAllRowsDirty();                                                    // repaint entire grid at new DPR
        resizeToTheme();
        needsPaint = true;
        requestFrame();
        watchDPR();   // re-register for the new DPR
    }, { once: true });
}

// ---- Atlas helpers ----

function makeRasteriserForTheme(theme) {
    const z = activeZoom;
    const dpr = activeDpr;
    if (theme.rasteriser === 'bitmap') {
        return (ch, _fg) => rasteriseBitmap(ch, theme.fg, theme.bg, theme.cellW * z, theme.cellH * z, z, dpr);
    } else {
        return (ch, _fg) => rasteriseVector(ch, theme.fg, theme.bg, theme.cellW * z, theme.cellH * z, theme.fontPx * z, dpr);
    }
}

// Build an inverted-rasteriser closure for the current theme.
// Called by paintCursor() via atlas.getInverted(ch, fg, invRasteriser, zoom).
// All OffscreenCanvas allocation happens INSIDE atlas.js (rasteriseBitmap/Vector).
// After the first cursor-on frame at each (theme, phosphor, zoom, DPR), the
// atlas returns a cached tile — zero OffscreenCanvas allocations per tick.
function makeInvRasteriserForTheme(theme) {
    const z = activeZoom;
    const dpr = activeDpr;
    if (theme.rasteriser === 'bitmap') {
        return (ch, _fg) => rasteriseBitmap(ch, theme.cursor.bgColor, theme.cursor.fgColor, theme.cellW * z, theme.cellH * z, z, dpr);
    } else {
        return (ch, _fg) => rasteriseVector(ch, theme.cursor.bgColor, theme.cursor.fgColor, theme.cellW * z, theme.cellH * z, theme.fontPx * z, dpr);
    }
}

function initAtlas() {
    atlas = new Atlas();
    const rast = makeRasteriserForTheme(activeTheme);
    // Prime in a microtask so first rAF paint isn't GPU-upload-blocked.
    queueMicrotask(() => primeAscii(atlas, /*fg=*/1, rast, activeZoom));
}

// ---- Paint ----

function paintRow(r, cols) {
    const z = activeZoom;
    const cellW = activeTheme.cellW * z;
    const cellH = activeTheme.cellH * z;
    const rast = makeRasteriserForTheme(activeTheme);

    // Clear the row band first (row bg) so dirty repaint overwrites old content.
    ctx.fillStyle = activeTheme.bg;
    ctx.fillRect(0, r * cellH, cols * cellW, cellH);

    for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * CELL_SIZE;
        // ch is u32 LE — for printable ASCII only the low byte matters.
        let ch = gridView[i];
        if (ch === 0 || ch < 0x20) ch = 0x20;   // Blank non-printables as space (D-01 bitmap).
        const fg = 1;                             // VT52 is monochrome; single-fg palette index.
        const tile = atlas.get(ch, fg, rast, z);
        ctx.drawImage(tile, c * cellW, r * cellH, cellW, cellH);
    }
}

function paintCursor() {
    const z = activeZoom;
    const cellW = activeTheme.cellW * z;
    const cellH = activeTheme.cellH * z;
    const packed = term.cursor_packed();
    const row = packed >>> 16;
    const col = packed & 0xFFFF;
    const x = col * cellW;
    const y = row * cellH;

    if (!canvasHasFocus) {
        // Blurred: steady 1 px outlined block (D-07 / UI-SPEC Cursor table).
        // Uses ctx.strokeRect — no atlas allocation, no OffscreenCanvas.
        ctx.strokeStyle = activeTheme.cursor.fgColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
        return;
    }

    // Focused: 530 ms blink gated by wall-clock time (D-07) — immune to rAF
    // throttling and monitor refresh rate. Uses performance.now() to avoid
    // system-clock jumps. Cycle: 530 ms ON, 530 ms OFF (total period 1060 ms).
    const elapsed = performance.now() - blinkStartMs;
    const blinkOn = (Math.floor(elapsed / 530) & 1) === 0;
    if (!blinkOn) return;

    // Focused-on: block-fill + inverted-glyph overdraw.
    ctx.fillStyle = activeTheme.cursor.fgColor;
    ctx.fillRect(x, y, cellW, cellH);

    const i = (row * term.cols() + col) * CELL_SIZE;
    let ch = gridView[i];
    if (ch === 0 || ch < 0x20) ch = 0x20;
    // Inverted tile is fetched from Atlas.invCache (RESEARCH §Open Questions Q3).
    // After first call per (theme, phosphor, zoom, DPR), this is a pure Map lookup +
    // drawImage — zero OffscreenCanvas allocation. Atlas.evict() flushes invCache
    // alongside cache whenever theme / phosphor / zoom / DPR changes.
    const invRast = makeInvRasteriserForTheme(activeTheme);
    const invTile = atlas.getInverted(ch, /*fg=*/1, invRast, z);
    ctx.drawImage(invTile, x, y, cellW, cellH);
}

// ---- rAF tick (RESEARCH §Complete rAF Loop Skeleton — verbatim shape) ----

function tick() {
    rafPending = false;
    frameCount++;

    // SNAPSHOT FIRST — term.snapshot_grid() may call wasm memory.grow on its
    // first invocation (or any time scrollback grows), which detaches any
    // Uint8Array view backed by the old wasm.memory.buffer. Deriving views
    // BEFORE the snapshot would leave gridView / dirtyView detached for this
    // frame (Chromium throws TypeError, rAF dies silently) — WR-01 in 03-REVIEW.
    term.snapshot_grid();

    // Re-derive if the snapshot's memory.grow swapped the backing buffer.
    reDeriveViews();

    // Defensive: if grid_byte_len has changed (first-snapshot path: 0 → 15360,
    // or any future wasm-side resize), fully rebuild views. Closes the
    // zero-length-gridView-at-boot path G-03-04-01 for good.
    if (gridView.byteLength !== term.grid_byte_len()) {
        rebuildViews();
    }

    // NOTE: bell sampling, tab-title prefix, and overlay flash are OWNED BY
    // main.js (Plan 03) via the synchronous feed-completion path. The rAF tick
    // deliberately does NOT sample the bell latch, does NOT clear it, and does
    // NOT mutate the browser tab title — this decouples bell semantics from
    // Chromium's ~1 Hz rAF throttling when the document is hidden, which would
    // otherwise make the BEL-while-hidden UAT test flaky.

    // Dirty-row repaint.
    const rows = term.rows();
    const cols = term.cols();
    for (let r = 0; r < rows; r++) {
        if (dirtyView[r] !== 0) paintRow(r, cols);
    }
    term.clear_dirty();

    // Cursor as overdraw (always — cheap at 80×24; uses atlas.getInverted so
    // steady-state allocation is zero after the first cursor frame).
    paintCursor();

    // Self-reschedule (D-07 + RESEARCH Pitfall #4). Also self-reschedule
    // unconditionally if focused so the cursor's next blink-toggle frame fires.
    if (canvasHasFocus || needsPaint) {
        needsPaint = false;
        requestFrame();
    }
}

export function requestFrame() {
    if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(tick);
    }
}

// ---- Public API ----

export async function bootRenderer(opts) {
    wasm = opts.wasm;
    term = opts.term;
    rebuildViews();

    canvas = document.getElementById('terminal');
    if (!canvas) throw new Error('[renderer] <canvas id="terminal"> not found');
    ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[renderer] Canvas 2D context unavailable (Chromium-only)');
    bellOverlayEl = document.getElementById('bell-overlay');  // may be null during boot; chrome.js creates it

    // Font-ready gate (RESEARCH §Pitfall 9 + §Font-Ready Gate for First Paint).
    // Force-loads JetBrains Mono so document.fonts.ready actually waits for it —
    // otherwise the first paint in the clean theme shows the fallback monospace
    // because the browser only fetches @font-face declarations when first used.
    try {
        await document.fonts.load('14px "JetBrains Mono"');
    } catch (err) {
        console.warn('[renderer] JetBrains Mono load failed; fallback in use.', err);
    }
    await document.fonts.ready;
    const hasJetBrains = document.fonts.check('14px "JetBrains Mono"');
    console.log('[renderer] font status: JetBrains Mono =', hasJetBrains);

    // Visibility-change handling for the bell title prefix is OWNED BY chrome.js /
    // main.js (Plan 03) — canvas.js does not listen for visibilitychange. This
    // keeps the renderer module DOM-chrome-agnostic and decouples bell semantics
    // from rAF throttling.

    activeDpr = window.devicePixelRatio || 1;
    initAtlas();
    resizeToTheme();
    watchDPR();
    requestFrame();
    console.log('[renderer] boot OK theme=', activeTheme.name, 'phosphor=', activePhosphor, 'zoom=', activeZoom, 'dpr=', activeDpr);
}

export function setTheme(name) {
    if (!(name in THEMES)) return;
    // Same-value short-circuit (REVIEW warning 3): clicking the already-active
    // theme button must NOT evict the atlas, mark every row dirty, re-prime
    // ASCII, or re-dispatch a rAF — the visible result would be an unnecessary
    // full-grid repaint flicker. Guard intent: identity-click = no-op.
    if (activeTheme && name === activeTheme.name) return;
    activeTheme = THEMES[name];
    // Entering CRT: restore last-selected phosphor (D-05 — phosphor is CRT-only).
    if (name === 'crt') applyPhosphorToTheme(activePhosphor);
    atlas.evict();
    markAllRowsDirty();                                                        // gap #3 — mark every row dirty so the full grid repaints
    resizeToTheme();
    queueMicrotask(() => primeAscii(atlas, 1, makeRasteriserForTheme(activeTheme), activeZoom));
    needsPaint = true;
    requestFrame();
}

function applyPhosphorToTheme(color) {
    if (!(color in THEMES.crt.phosphorSlots)) return;
    const slot = THEMES.crt.phosphorSlots[color];
    THEMES.crt.fg     = slot.fg;
    THEMES.crt.bg     = slot.bg;
    THEMES.crt.accent = slot.accent;
    THEMES.crt.cursor.fgColor = slot.fg;
    THEMES.crt.cursor.bgColor = slot.bg;
    activePhosphor = color;
    // CSS custom properties for Plan 03 chrome — keeps top-bar in sync.
    if (typeof document !== 'undefined') {
        const root = document.documentElement;
        root.style.setProperty('--phosphor-fg', slot.fg);
        root.style.setProperty('--phosphor-bg', slot.bg);
    }
}

export function setPhosphor(color) {
    if (activeTheme.name !== 'crt') return;
    // Same-value short-circuit (REVIEW warning 3): clicking the already-active
    // phosphor button must NOT trigger an atlas evict + full-grid repaint.
    if (color === activePhosphor) return;
    applyPhosphorToTheme(color);
    atlas.evict();
    markAllRowsDirty();                                                        // gap #5 — recolour every rendered glyph on next paint
    queueMicrotask(() => primeAscii(atlas, 1, makeRasteriserForTheme(activeTheme), activeZoom));
    needsPaint = true;
    requestFrame();
}

export function zoomStep(delta) {
    const z = Math.max(1, Math.min(4, activeZoom + delta));
    if (z === activeZoom) return;
    activeZoom = z;
    atlas.evict();
    markAllRowsDirty();                                                        // gap #6 — repaint all content at new cell size
    resizeToTheme();
    queueMicrotask(() => primeAscii(atlas, 1, makeRasteriserForTheme(activeTheme), activeZoom));
    needsPaint = true;
    requestFrame();
}

export function resetZoom() {
    if (activeZoom === 1) return;
    activeZoom = 1;
    atlas.evict();
    markAllRowsDirty();                                                        // gap #6 — same as zoomStep
    resizeToTheme();
    queueMicrotask(() => primeAscii(atlas, 1, makeRasteriserForTheme(activeTheme), activeZoom));
    needsPaint = true;
    requestFrame();
}

export function setFocus(focused) {
    canvasHasFocus = focused;
    if (focused) blinkStartMs = performance.now();
    needsPaint = true;
    requestFrame();
}

export function getActiveTheme() { return activeTheme; }
export function getActivePhosphor() { return activePhosphor; }
export function getActiveZoom() { return activeZoom; }

export function triggerBellFlash() {
    const el = bellOverlayEl || document.getElementById('bell-overlay');
    if (!el) return;   // chrome may not be mounted yet during early boot
    if (bellFlashTimer !== null) clearTimeout(bellFlashTimer);
    el.classList.add('flash');
    bellFlashTimer = setTimeout(() => {
        el.classList.remove('flash');
        bellFlashTimer = null;
    }, 100);
}
