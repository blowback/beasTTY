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
    setActiveFont as atlasSetActiveFont,
    getActiveFontId as atlasGetActiveFontId,
} from './atlas.js';
// Phase 6 Plan 03 (Wave 2) — scrollback state machine. tick() branches on
// scrollIsScrolledBack(); paintCursor() early-returns while scrolled.
import {
    isScrolledBack as scrollIsScrolledBack,
    getOffset as scrollGetOffset,
    consumeNeedsRepaint as scrollConsumeNeedsRepaint,
} from './scroll-state.js';
// Phase 6 Plan 04 (Wave 3) — selection overlay. Late-bound import so canvas.js
// stays loadable in test contexts where selection.js is not yet wired.
import { getActiveRange as selectionGetActiveRange } from '../input/selection.js';

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
//
// Phase 6 Plan 03 — exported so scroll-state.js can call it on snap-to-bottom
// (offset > 0 → 0). Without this the live grid would not repaint until a row
// changed, leaving the previously-painted scrollback view on screen.
export function markAllRowsDirty() {
    if (!dirtyView) return;
    const rows = dirtyView.length;
    for (let r = 0; r < rows; r++) dirtyView[r] = 1;
}

// Phase 6 Plan 04 (Wave 3) — readRowText decodes a single grid row at a
// scrollback-tail-relative offset into an ASCII string. selection.js calls
// this for word boundaries (double-click) and full-row text (triple-click,
// copy). Lives here because canvas.js owns gridView + the snapshot lifecycle.
//
// Strategy: the tail-relative coord T maps into the LIVE viewport at row R =
// (visibleRows - 1) - T (when T < visibleRows). For currently-visible rows we
// read directly from snapshot_grid() — this is the common case. Rows in
// scrollback (T >= visibleRows AND scrollback non-empty) require
// snapshot_grid_at(T - (visibleRows - 1)) so the row at offset T lands at the
// bottom of the snapshot. canvas.js's tick() re-snapshots on the next rAF, so
// any in-test snapshot side effect is transient.
export function readRowText(rowOffsetFromTail) {
    if (!term) return '';
    const cols = term.cols();
    const visibleRows = term.rows();
    let viewportRow;
    if (rowOffsetFromTail < visibleRows) {
        // Currently-visible (live tail viewport).
        term.snapshot_grid();
        viewportRow = (visibleRows - 1) - rowOffsetFromTail;
    } else {
        // Row lives in scrollback above the visible window. Snapshot the
        // window ending at this offset; the row lands at bottom (visibleRows-1).
        term.snapshot_grid_at(rowOffsetFromTail - (visibleRows - 1));
        viewportRow = visibleRows - 1;
    }
    reDeriveViews();
    if (gridView.byteLength !== term.grid_byte_len()) rebuildViews();
    let s = '';
    for (let c = 0; c < cols; c++) {
        const idx = (viewportRow * cols + c) * CELL_SIZE;
        const byte = gridView[idx];
        s += (byte === 0 || byte < 0x20) ? ' ' : String.fromCharCode(byte);
    }
    return s;
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
        // Cell.flags lives at byte offset 6 (per grid.rs #[repr(C)] layout).
        // Bit 2 of flags = graphics_mode: byte was written under ESC F, remap
        // 0x60..0x7F to the special graphics-set font positions 0..0x1F.
        let ch = gridView[i];
        const flags = gridView[i + 6];
        if ((flags & 0x04) && ch >= 0x60 && ch <= 0x7F) {
            ch = ch - 0x60;
        } else if (ch === 0 || ch < 0x20) {
            ch = 0x20;                            // Blank non-printables as space (D-01 bitmap).
        }
        const fg = 1;                             // VT52 is monochrome; single-fg palette index.
        const tile = atlas.get(ch, fg, rast, z);
        ctx.drawImage(tile, c * cellW, r * cellH, cellW, cellH);
    }
}

// Track the cell paintCursor last drew into so cursor motion that doesn't
// write a character at the OLD position (CR, LF, ESC Y, etc.) doesn't leave
// a ghost block. The dirty-row pipeline only repaints rows Rust marked dirty,
// and Rust dirties on print, not on cursor motion — so without this trail we
// rely on something later (a print, a scroll-induced full-grid dirty) to wipe
// the stale block, which can take many seconds in the first 24 lines.
let prevCursorRow = -1;
let prevCursorCol = -1;

function paintCursor() {
    // Phase 6 D-09 — cursor hidden while scrolled up. The cursor lives at a
    // row in the live grid (offset 0); when scrolled up, painting it would
    // place a cursor at a row that the user is not viewing, which is misleading.
    if (scrollIsScrolledBack()) return;

    const z = activeZoom;
    const cellW = activeTheme.cellW * z;
    const cellH = activeTheme.cellH * z;
    const packed = term.cursor_packed();
    const row = packed >>> 16;
    const col = packed & 0xFFFF;
    const x = col * cellW;
    const y = row * cellH;

    // Erase a ghost cursor at the previous position if we've moved. Read the
    // underlying glyph from gridView and repaint over the stale cursor block.
    if (prevCursorRow !== -1
            && (prevCursorRow !== row || prevCursorCol !== col)
            && prevCursorRow < term.rows() && prevCursorCol < term.cols()) {
        const pi = (prevCursorRow * term.cols() + prevCursorCol) * CELL_SIZE;
        let pch = gridView[pi];
        const pflags = gridView[pi + 6];
        if ((pflags & 0x04) && pch >= 0x60 && pch <= 0x7F) {
            pch = pch - 0x60;
        } else if (pch === 0 || pch < 0x20) {
            pch = 0x20;
        }
        const px = prevCursorCol * cellW;
        const py = prevCursorRow * cellH;
        ctx.fillStyle = activeTheme.bg;
        ctx.fillRect(px, py, cellW, cellH);
        const rast = makeRasteriserForTheme(activeTheme);
        const tile = atlas.get(pch, /*fg=*/1, rast, z);
        ctx.drawImage(tile, px, py, cellW, cellH);
    }
    prevCursorRow = row;
    prevCursorCol = col;

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

    const i = (row * term.cols() + col) * CELL_SIZE;
    let ch = gridView[i];
    const cellFlags = gridView[i + 6];
    if ((cellFlags & 0x04) && ch >= 0x60 && ch <= 0x7F) {
        ch = ch - 0x60;                         // Graphics-mode remap (same logic as paintRow).
    } else if (ch === 0 || ch < 0x20) {
        ch = 0x20;
    }

    if (!blinkOn) {
        // Blink-OFF: erase the previously-painted cursor block by repainting the
        // cell's underlying glyph on theme bg. Without this the block stays on
        // screen because no row is dirty (dirty-row optimisation skips paintRow
        // for this row on subsequent ticks). [03-07 Rule 1 fix — regression gap #1]
        ctx.fillStyle = activeTheme.bg;
        ctx.fillRect(x, y, cellW, cellH);
        const rast = makeRasteriserForTheme(activeTheme);
        const tile = atlas.get(ch, /*fg=*/1, rast, z);
        ctx.drawImage(tile, x, y, cellW, cellH);
        return;
    }

    // Focused-on: block-fill + inverted-glyph overdraw.
    ctx.fillStyle = activeTheme.cursor.fgColor;
    ctx.fillRect(x, y, cellW, cellH);

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

    // Phase 6 D-07 — branch on scroll state.
    //   offset == 0  →  Phase 3 live-tail snapshot_grid()
    //   offset >  0  →  windowed snapshot_grid_at(offset)
    // SNAPSHOT FIRST — term.snapshot_grid* may call wasm memory.grow on its
    // first invocation (or any time scrollback grows), which detaches any
    // Uint8Array view backed by the old wasm.memory.buffer. Deriving views
    // BEFORE the snapshot would leave gridView / dirtyView detached for this
    // frame (Chromium throws TypeError, rAF dies silently) — WR-01 in 03-REVIEW.
    const scrolledBack = scrollIsScrolledBack();
    if (scrolledBack) {
        term.snapshot_grid_at(scrollGetOffset());
    } else {
        term.snapshot_grid();
    }

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

    const rows = term.rows();
    const cols = term.cols();

    if (scrolledBack) {
        // Phase 6 D-08 — paint-once-then-idle while scrolled. Skip dirty-row
        // pipeline because historical rows can't change. consumeNeedsRepaint
        // returns true exactly once per scroll-state change (paint-once gate);
        // subsequent ticks while scrolled-back are no-ops.
        if (scrollConsumeNeedsRepaint()) {
            for (let r = 0; r < rows; r++) paintRow(r, cols);
        }
        // Phase 6 Plan 04 (Wave 3) — selection works across history (D-17).
        // Paint the overlay AFTER the row paint so inverted glyphs sit on top
        // of the historical grid render.
        paintSelectionOverlay();
        // Phase 6 D-09 — cursor hidden while scrolled up (paintCursor early-returns).
        // Phase 6 D-10 — BEL viewport flash suppressed while scrolled up. The
        // bell flash is triggered from main.js's sampleBell() which calls
        // triggerBellFlash() — that function reads scrollIsScrolledBack() and
        // skips the overlay class toggle when scrolled (title prefix unchanged).
        // Do NOT clear_dirty — the live grid is still accumulating dirty rows
        // and we want them to flush via the normal Phase 3 path on snap-to-bottom.
        return;
    }

    // Phase 3 live path — unchanged.
    // Dirty-row repaint.
    for (let r = 0; r < rows; r++) {
        if (dirtyView[r] !== 0) paintRow(r, cols);
    }
    term.clear_dirty();

    // Phase 6 Plan 04 (Wave 3) — selection overlay at live tail. Painted
    // BEFORE paintCursor so the cursor inversion still wins on cell collision.
    paintSelectionOverlay();

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

// Phase 6 Plan 06 (Wave 5) — absolute setter used by prefs.subscribe(applyPrefs).
// zoomStep(+/-1) is delta-relative and would never converge to a stored
// fontZoom from arbitrary current state; applyPrefs needs an absolute path.
// Same clamp + side-effects as zoomStep; same-value short-circuit per the
// chrome.js REVIEW warning 3 pattern (no atlas thrash on identity apply).
export function setZoom(z) {
    const clamped = Math.max(1, Math.min(4, z | 0));
    if (clamped === activeZoom) return;
    activeZoom = clamped;
    atlas.evict();
    markAllRowsDirty();
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

// Switch the active bitmap font (CRT theme). Same-value short-circuit + full
// atlas flush + reprime + repaint, mirroring setTheme / setPhosphor.
// Only affects the bitmap rasteriser; vector (clean theme) is font-agnostic.
export function setFont(id) {
    if (id === atlasGetActiveFontId()) return;
    if (!atlasSetActiveFont(id)) return;
    atlas.evict();
    markAllRowsDirty();
    queueMicrotask(() => primeAscii(atlas, 1, makeRasteriserForTheme(activeTheme), activeZoom));
    needsPaint = true;
    requestFrame();
}

export function getActiveFont() { return atlasGetActiveFontId(); }

export function getActiveTheme() { return activeTheme; }
export function getActivePhosphor() { return activePhosphor; }
export function getActiveZoom() { return activeZoom; }

// Phase 6 Plan 04 — exposed so wireSelection / Playwright tests can resolve
// the current cell-size in CSS pixels (cellW * activeZoom × cellH * activeZoom).
export function getActiveCellSize() {
    return {
        cellW: activeTheme.cellW * activeZoom,
        cellH: activeTheme.cellH * activeZoom,
    };
}

// Phase 6 Plan 04 (Wave 3) — paint the selection overlay using inverted glyphs
// (D-20). Reuses atlas.getInverted, the exact code path Phase 3 paintCursor
// already exercises — zero new render primitives. Selection works at both the
// live tail and within scrolled-back history (D-17), so this is called from
// BOTH branches of tick().
//
// Stale-overlay erase: the dirty-row tick loop only repaints rows Rust marked
// dirty, so cells that USED to be inverted but no longer are will keep their
// inverted overdraw forever. Track which visible rows the previous overlay
// touched and repaint them from gridView before painting the new overlay.
let prevSelectionVisibleRows = new Set();

export function paintSelectionOverlay() {
    const range = selectionGetActiveRange();
    const cols = term.cols();
    const visibleRows = term.rows();

    // Discover which rows the new overlay will touch (cheap — bounded by
    // selection extent, and the iterator is fresh each call).
    const newRows = new Set();
    if (range) {
        for (const cell of range.cells()) {
            if (cell.row >= 0 && cell.row < visibleRows) newRows.add(cell.row);
        }
    }

    // Erase prior overlay on EVERY row that had selection last frame, even if
    // the new overlay also touches that row. Skipping the repaint when the row
    // is in both sets leaves the previous frame's wider inversion underneath
    // (e.g. select a full line, then drag a sub-range inside it — without
    // unconditional repaint, the whole line stays inverted because the new
    // narrow inverted overdraw doesn't cancel the old wide one).
    for (const r of prevSelectionVisibleRows) {
        paintRow(r, cols);
    }

    prevSelectionVisibleRows = newRows;
    if (!range) return;

    // Paint the inverted overdraw for the current selection.
    const z = activeZoom;
    const cellW = activeTheme.cellW * z;
    const cellH = activeTheme.cellH * z;
    const invRast = makeInvRasteriserForTheme(activeTheme);
    for (const cell of range.cells()) {
        const { row, col } = cell;
        if (row < 0 || row >= visibleRows || col < 0 || col >= cols) continue;
        const idx = (row * cols + col) * CELL_SIZE;
        let ch = gridView[idx];
        const flags = gridView[idx + 6];
        if ((flags & 0x04) && ch >= 0x60 && ch <= 0x7F) {
            ch = ch - 0x60;          // graphics-mode remap (matches paintRow / paintCursor)
        } else if (ch === 0 || ch < 0x20) {
            ch = 0x20;
        }
        const tile = atlas.getInverted(ch, /*fg=*/1, invRast, z);
        ctx.drawImage(tile, col * cellW, row * cellH, cellW, cellH);
    }
}

export function triggerBellFlash() {
    // Phase 6 D-10 — suppress viewport flash while scrolled up. The rows
    // causing the BEL aren't in view, so flashing those rows is misleading.
    // Title prefix (the document.title (!) decoration) lives in main.js's
    // sampleBell and is unaffected — only the visible overlay is gated here.
    if (scrollIsScrolledBack()) return;
    const el = bellOverlayEl || document.getElementById('bell-overlay');
    if (!el) return;   // chrome may not be mounted yet during early boot
    if (bellFlashTimer !== null) clearTimeout(bellFlashTimer);
    el.classList.add('flash');
    bellFlashTimer = setTimeout(() => {
        el.classList.remove('flash');
        bellFlashTimer = null;
    }, 100);
}
