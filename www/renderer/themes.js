// BestialiTTY Phase 3 — theme descriptors (CONTEXT D-04 + D-05).
//
// Switching themes = single reference swap: `activeTheme = THEMES.crt; atlas.evict();`
// Switching phosphor = sub-field update + atlas evict:
//   const slot = THEMES.crt.phosphorSlots[phosphor];
//   THEMES.crt.fg = slot.fg; THEMES.crt.bg = slot.bg; THEMES.crt.accent = slot.accent;
//   THEMES.crt.cursor.fgColor = slot.fg; THEMES.crt.cursor.bgColor = slot.bg;
//   atlas.evict();
//
// Cell sizes are at 1× zoom (UI-SPEC §Spacing "exceptions" table).
// Integer zoom multiplier is applied at canvas.js resizeToTheme time.
//
// Phosphor hex values sourced from UI-SPEC §Color + RESEARCH §Phosphor Palette.
//   green: DEC VT220 P1 — DEFAULT (D-06)
//   amber: IBM 5151 / Wyse
//   white: IBM MDA P4
// Clean palette: UI-SPEC §Color (glyph #e4e8ee on bg #0f1419 with accent #7fdbca).

export const THEMES = {
    crt: {
        name: 'crt',
        // fg/bg/accent start at DEFAULT phosphor (green — D-06 reload default).
        // canvas.js setPhosphor() mutates these at runtime; CONTEXT D-05 locks
        // this as a sub-field update, not a theme swap.
        fg:     '#33ff66',
        bg:     '#0a0f0a',
        accent: '#33ff66',
        font:   null,          // bitmap — no @font-face
        rasteriser: 'bitmap',  // string tag; atlas.js dispatches to rasteriseBitmap
        cellW: 16, cellH: 32,  // 1× zoom (UI-SPEC bitmap 8×16 doubled)
        baseline: 0,           // bitmap is row-0 aligned; no baseline offset
        cursor: {
            shape: 'block',
            blink: true,
            // CRT cursor = inverted phosphor: swap fg↔bg at the cursor cell.
            // The "inverse" is implemented at cursor draw time by painting an fg
            // block then overdrawing the glyph in bgColor for the inverted effect.
            fgColor: '#33ff66',   // tracks theme.fg (mutated by setPhosphor)
            bgColor: '#0a0f0a',   // tracks theme.bg (mutated by setPhosphor)
        },
        bellFlash: { cssVar: '--bell-flash' },
        scanlines: true,
        phosphorSlots: {
            // DEC VT220 P1 — green (DEFAULT).
            green: {
                fg:     '#33ff66',
                bg:     '#0a0f0a',
                accent: '#33ff66',
            },
            // IBM 5151 / Wyse — amber.
            amber: {
                fg:     '#ffb000',
                bg:     '#140d00',
                accent: '#ffb000',
            },
            // IBM MDA P4 — white.
            white: {
                fg:     '#e8e8d8',
                bg:     '#0a0a0a',
                accent: '#e8e8d8',
            },
        },
    },
    clean: {
        name: 'clean',
        fg:     '#e4e8ee',
        bg:     '#0f1419',
        accent: '#7fdbca',
        font:   'JetBrains Mono',
        rasteriser: 'vector',
        cellW: 9, cellH: 18,    // measured from JetBrains Mono 14 px at ~1.3 line-height
        fontPx: 14,
        baseline: 0,            // textBaseline: 'top' — glyph anchors at cell top-left
        cursor: {
            shape: 'block',
            blink: true,
            fgColor: '#7fdbca',  // accent — focused-block cursor colour
            bgColor: '#0f1419',  // theme bg — glyph colour under the filled cursor
        },
        bellFlash: { cssVar: '--bell-flash' },
        scanlines: false,
        // No phosphorSlots — clean theme has no phosphor concept (D-05).
    },
};

// Default active state (D-06: reload resets to these; no localStorage in Phase 3).
export const DEFAULT_THEME_NAME = 'crt';
export const DEFAULT_PHOSPHOR = 'green';
export const DEFAULT_ZOOM = 1;  // integer 1..4 (D-10)
