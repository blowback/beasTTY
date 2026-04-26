// BestialiTTY Phase 3 — glyph atlas with OffscreenCanvas-backed tiles.
//
// Source: RESEARCH §Pattern 4 (Atlas class) + §Pattern 2 (bitmap rasteriser)
//         + §Pattern 3 (vector rasteriser) + CONTEXT D-03 (key + evict policy)
//         + PATTERNS.md §"www/renderer/atlas.js" (per-task verbatim shapes).
//
// Key shape: (ch << 24) | (fg << 16) | (nonce << 8) | zoom
//   - ch:   7-bit printable ASCII (0x20..0x7E); upper bits zero.
//   - fg:   8-bit palette index (for VT52 with no colour, always a fixed value —
//           use a single nonzero byte per theme variant to keep keys distinct
//           across phosphor changes even if nonce increment is skipped by bug).
//   - nonce: 8-bit atlas generation — incremented on every evict().
//   - zoom:  8-bit integer 1..4 (D-10).
//
// Evict on: theme change, phosphor change, zoom change, DPR change.
// Not LRU — full flush; worst-case cache is ~4 MB at 4× zoom + 2× DPR (trivial).
//
// The Atlas exposes a primary cache (`this.cache`) and a sibling cache
// (`this.invCache`) for inverted-phosphor cursor tiles (RESEARCH §Open
// Questions Q3 RESOLUTION). Both caches share the same `nonce` so any
// theme/phosphor/zoom/DPR change flushes them together — the focused-block
// cursor is always consistent with the current grid colouring.

import { BITMAP_FONT } from './bitmap-font.js';
import { VT52_ROM_FONT } from './vt52-rom-font.js';
import { INSIGBYTE_FONT } from './insigbyte-font.js';

// Font registry: id → 2048-byte glyph table (128 chars × 16 rows).
// Adding a font: import its Uint8Array and register it here. No other change
// in this file is needed — rasteriseBitmap reads activeFont, not BITMAP_FONT.
const FONTS = Object.freeze({
    'modern':    BITMAP_FONT,     // hand-drawn 8×16, project default (Phase 3 D-01)
    'vt52':      VT52_ROM_FONT,   // original DEC VT52 character ROM, expanded to 16-row footprint
    'insigbyte': INSIGBYTE_FONT,  // Insigbyte Bold 8×8, MicroBeast-adjacent
});

export const FONT_IDS = Object.freeze(Object.keys(FONTS));
export const DEFAULT_FONT_ID = 'modern';

let activeFont = FONTS[DEFAULT_FONT_ID];
let activeFontId = DEFAULT_FONT_ID;

export function setActiveFont(id) {
    if (!(id in FONTS)) return false;
    activeFont = FONTS[id];
    activeFontId = id;
    return true;
}

export function getActiveFontId() {
    return activeFontId;
}

export class Atlas {
    constructor() {
        this.cache    = new Map();   // primary glyph tiles (fg-on-bg)
        this.invCache = new Map();   // inverted cursor tiles (bg-on-fg) — Q3 RESOLUTION
        this.nonce    = 0;           // byte-wrapped; incremented per evict; shared across both caches
    }

    // Primary tile lookup. On miss, calls `rasteriser(ch, fg)` (a closure built
    // in canvas.js over the active theme + zoom + dpr) and caches the result.
    get(ch, fg, rasteriser, zoom) {
        const key = (ch << 24) | ((fg & 0xFF) << 16) | ((this.nonce & 0xFF) << 8) | (zoom & 0xFF);
        let tile = this.cache.get(key);
        if (!tile) {
            tile = rasteriser(ch, fg);
            this.cache.set(key, tile);
        }
        return tile;
    }

    // Inverted-tile sub-atlas — keyed identically to `get` but lives in a separate Map so the
    // focused-block cursor can overdraw without colliding with the primary-tile keyspace.
    // See RESEARCH §Open Questions Q3 RESOLUTION: caches inverted glyphs so paintCursor()
    // allocates ZERO OffscreenCanvas objects in steady state after the first cursor frame
    // at each (theme, phosphor, zoom, DPR).
    getInverted(ch, fg, invRasteriser, zoom) {
        const key = (ch << 24) | ((fg & 0xFF) << 16) | ((this.nonce & 0xFF) << 8) | (zoom & 0xFF);
        let tile = this.invCache.get(key);
        if (!tile) {
            tile = invRasteriser(ch, fg);   // closure that calls rasteriseBitmap/Vector with fg↔bg swapped
            this.invCache.set(key, tile);
        }
        return tile;
    }

    // Full-flush eviction: clears both primary and inverted caches and bumps
    // the shared nonce so any stale key from a lingering closure is guaranteed
    // to miss on its next `get` / `getInverted` call.
    evict() {
        this.cache.clear();
        this.invCache.clear();                     // both caches flush together
        this.nonce = (this.nonce + 1) & 0xFF;
    }

    size() {
        return this.cache.size + this.invCache.size;
    }
}

// Bitmap rasteriser (RESEARCH §Pattern 2, PATTERNS.md verbatim).
// Returns an OffscreenCanvas tile sized cellW*dpr × cellH*dpr, with the glyph
// for codepoint `ch` drawn in `fgColor` over a `bgColor` fill. The glyph is
// sourced from BITMAP_FONT[(ch & 0x7F) * 16 + row] — the 0x7F mask silently
// folds any 8th-bit ch to low-7 ASCII (blanks to zero-byte rows in the
// bitmap — VT52 pragmatic subset renders only printable ASCII).
//
// `z` (zoom multiplier) is preserved in the signature for call-site
// compatibility with canvas.js but is unused — zoom is folded into the cellW
// and cellH the caller already multiplied. The scale is derived from
// cellW/cellH vs the fixed 8×16 source geometry instead. See gap #8 fix.
export function rasteriseBitmap(ch, fgColor, bgColor, cellW, cellH, z, dpr) {
    const tile = new OffscreenCanvas(cellW * dpr, cellH * dpr);
    const ctx = tile.getContext('2d');
    ctx.imageSmoothingEnabled = false;                 // pixel-perfect CRT upscale (D-11)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);            // NEVER ctx.scale (RESEARCH Anti-Pattern)
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.fillStyle = fgColor;

    // The native glyph is 8 cols × 16 rows. The target cell at 1× zoom is
    // cellW × cellH = 16 × 32 CSS pixels (UI-SPEC §Spacing "CRT cell size at
    // 1× zoom" — bitmap doubled from native 8×16 for laptop readability).
    // That makes each source pixel a 2×2 CSS-pixel square at z=1, scaled by
    // `z` for zoom multiplier. Deriving the scale from cellW/cellH instead of
    // hard-coding `z` keeps rasteriseBitmap correct even if cell geometry
    // changes in the future.
    const pxW = cellW / 8;                              // 16/8 = 2 at z=1; 32/8 = 4 at z=2
    const pxH = cellH / 16;                             // 32/16 = 2 at z=1; 64/16 = 4 at z=2
    const base = (ch & 0x7F) * 16;                      // 16 bytes per glyph; mask to ASCII
    for (let row = 0; row < 16; row++) {
        const bits = activeFont[base + row];
        for (let col = 0; col < 8; col++) {
            if (bits & (0x80 >> col)) {                 // MSB-left bit test
                ctx.fillRect(col * pxW, row * pxH, pxW, pxH);
            }
        }
    }
    return tile;
}

// Vector rasteriser (RESEARCH §Pattern 3, PATTERNS.md verbatim).
// MUST run AFTER document.fonts.ready — canvas.js gates this via bootRenderer.
// `fontPx` is the CSS font-size in pixels; the tile's pixel dimensions are
// cellW*dpr × cellH*dpr.
export function rasteriseVector(ch, fgColor, bgColor, cellW, cellH, fontPx, dpr) {
    const tile = new OffscreenCanvas(cellW * dpr, cellH * dpr);
    const ctx = tile.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);            // NEVER ctx.scale
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.font = `${fontPx}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = fgColor;
    ctx.fillText(String.fromCharCode(ch), 0, 0);
    return tile;
}

// Primer (RESEARCH §Pitfall 1): after atlas.evict(), force first drawImage
// for every printable ASCII so subsequent rAF ticks don't pay the GPU-texture
// upload cost. Call from canvas.js inside queueMicrotask(() => { ... }) after
// evict(), resizeToTheme, or theme/phosphor/zoom change.
export function primeAscii(atlas, fg, rasteriser, zoom) {
    for (let ch = 0x20; ch <= 0x7E; ch++) {
        atlas.get(ch, fg, rasteriser, zoom);
    }
}
