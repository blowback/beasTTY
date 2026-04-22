# Phase 3: Canvas Renderer — Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 10 (2 modify, 8 create)
**Analogs found in codebase:** 4 in-repo analogs / 10 files — 6 files are greenfield (first canvas renderer in the project); for those, `www/main.js` supplies the Phase 2 zero-copy pattern and RESEARCH.md §Patterns 1-8 supply the canonical renderer shape.

The dominant in-repo analog is **`www/main.js:38-54` + `:56-96`** — the cachedBuffer identity-guard, `rebuildViews()` / `reDeriveViews()` pair, and per-frame cell-stride decode loop. Every new renderer file either *extends* this pattern (`canvas.js`) or *composes* with it (`atlas.js`, `themes.js`, `bitmap-font.js`). The Phase 2 wasm façade in `crates/bestialitty-core/src/lib.rs:33-172` is the verbatim consumption contract — Phase 3 adds zero Rust changes.

---

## File Classification

| New/Modified File | Action | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `www/renderer/canvas.js` | CREATE | renderer / rAF driver | event-driven + request-response (FFI read) | `www/main.js:38-96` (cachedBuffer + renderAscii + stride decode) | role-match (extends pattern) |
| `www/renderer/atlas.js` | CREATE | cache / glyph service | request-response (lookup + lazy rasterise) | `www/main.js:38-54` (module-scope cache + identity-guard re-derive) | role-match (cache shape) |
| `www/renderer/themes.js` | CREATE | config / descriptor module | n/a (plain data) | no in-repo JS analog; **03-RESEARCH.md §D-04 descriptor shape** | no-analog (use RESEARCH) |
| `www/renderer/bitmap-font.js` | CREATE | asset / data blob module | n/a (static Uint8Array export) | no in-repo analog; **03-RESEARCH.md §Pattern 2 + §Licensing Notes** | no-analog (hand-authored) |
| `www/renderer/chrome.js` (implied by RESEARCH §Recommended Project Structure) | CREATE (optional split) | event wiring / DOM chrome | event-driven (keydown, click, visibilitychange) | `www/main.js:132-194` (click handlers + `document.getElementById` pattern) | role-match |
| `www/assets/fonts/jetbrains-mono-regular.woff2` | CREATE (asset) | static binary asset | n/a | no analog — first asset in `www/assets/` | no-analog |
| `www/assets/fonts/LICENSE-JetBrainsMono.txt` | CREATE (asset) | license text | n/a | repo-root license posture (MIT/Apache-2.0 plan in PROJECT.md); OFL 1.1 text from upstream | no-analog |
| `www/index.html` | MODIFY | static HTML (DOM + inline CSS) | DOM event-driven | current `www/index.html` (the `<style>` + `<script type="module">` shape) | exact (self-extension) |
| `www/main.js` | MODIFY | browser shell (boot + Debug wiring) | event-driven + FFI | current `www/main.js:14-24, 38-54, 132-194` (retained almost verbatim) | exact (self-extension) |
| `www/README.md` | MODIFY | docs | n/a | current `www/README.md` (H2 + fenced code blocks + SC checklist) | exact (self-extension) |

**Greenfield note:** The `www/renderer/` directory does not exist yet. Every file under it is a first-of-its-kind in this repo. `www/main.js` is the only JS file in the repo today; it is the analog for *both* the view-handling pattern (extended into `canvas.js`) and the DOM-wiring pattern (extended into `chrome.js` / `main.js` debug section).

---

## Pattern Assignments

### `www/renderer/canvas.js` (renderer, rAF driver)

**Analog:** `www/main.js:38-96` (Phase 2 cachedBuffer + renderAscii + stride-decode loop)

**Zero-copy view guard — copy verbatim idiom from `www/main.js:35-54`:**
```javascript
// Source: www/main.js:35-54 (Phase 2 D-03 contract, extended in Phase 3)
const CELL_SIZE = 8;             // matches Cell #[repr(C)] size assert in grid.rs
const HOST_REPLY_VIEW_CAP = 8;   // matches Vec::with_capacity(8) in Terminal::new

let cachedBuffer  = null;
let gridView      = null;
let dirtyView     = null;
let hostReplyView = null;

function rebuildViews() {
    gridView      = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),       term.grid_byte_len());
    dirtyView     = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(),      term.rows());
    hostReplyView = new Uint8Array(wasm.memory.buffer, term.host_reply_ptr(), HOST_REPLY_VIEW_CAP);
    cachedBuffer  = wasm.memory.buffer;
}

function reDeriveViews() {
    if (wasm.memory.buffer !== cachedBuffer) rebuildViews();
}
```

**Constraint:** Phase 3 MUST preserve this identity-guard. The `reDeriveViews()` call runs at the top of every rAF tick as a cheap identity compare; it only re-allocates views when `wasm.memory.buffer` is replaced (memory growth / detachment). Closes SC-3 source #4 per `02-06-SUMMARY.md`.

**Cell stride decode — copy shape from `www/main.js:58-75` (renderAscii):**
```javascript
// Source: www/main.js:58-75 — iterate rows/cols, read ch at byte offset 0 of 8-byte cell
term.snapshot_grid();
reDeriveViews();
const rows = term.rows();
const cols = term.cols();
for (let r = 0; r < rows; r++) {
    if (!dirtyView[r]) continue;           // Phase 3: skip clean rows (Pattern: dirty-row repaint)
    for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * CELL_SIZE;
        const ch = gridView[i];            // ch LSB at byte offset 0 (little-endian u32)
        const fg = gridView[i + 4];        // fg byte — Phase 3 uses; Phase 2 ignored
        // Phase 3: atlas.get(ch, fg, theme, zoom) → OffscreenCanvas tile → drawImage(tile, c*cellW, r*cellH)
    }
}
term.clear_dirty();                        // same cadence as Phase 2 main.js:81
```

**rAF loop skeleton — follow RESEARCH §"Complete rAF Loop Skeleton" (lines 698-759):**
```javascript
// Source: 03-RESEARCH.md Pattern 5 + Pattern 7 + CONTEXT D-07 + PITFALLS #4
let frameCount = 0;
let needsPaint = false;
let rafPending = false;
let canvasHasFocus = false;

function requestFrame() {
    if (!rafPending) { rafPending = true; requestAnimationFrame(tick); }
}

function tick() {
    rafPending = false;
    frameCount++;
    reDeriveViews();                         // Phase 2 guard — extended

    if (term.bell_pending()) {               // bell first — drives CSS overlay + title prefix
        triggerBellFlash(bellOverlayEl);
        if (document.hidden && !hasPendingBell) {
            document.title = '(!) ' + ORIGINAL_TITLE;
            hasPendingBell = true;
        }
        term.clear_bell();
    }

    term.snapshot_grid();
    for (let r = 0; r < term.rows(); r++) {
        if (dirtyView[r]) paintRow(r, term.cols());
    }
    term.clear_dirty();
    paintCursor(ctx, term, activeTheme, frameCount);   // overdraw, no dirty coupling

    if (canvasHasFocus || needsPaint) {
        needsPaint = false;
        requestFrame();                     // keep blinking when focused; one-more when queued
    }
}
```

**HiDPI resize — follow RESEARCH §Pattern 1 (lines 261-307):**
```javascript
// Source: 03-RESEARCH.md Pattern 1 + web.dev/articles/canvas-hidipi
function resizeToTheme(theme, zoom) {
    const cssW = theme.cellW * 80 * zoom;
    const cssH = theme.cellH * 24 * zoom;
    const dpr = window.devicePixelRatio;
    canvas.width  = Math.round(cssW * dpr);   // backing store in device px
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width  = cssW + 'px';        // CSS size stays in CSS px
    canvas.style.height = cssH + 'px';
    // ctx state reset by canvas.width/height assignment — re-establish:
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // IDEMPOTENT — never use ctx.scale
    ctx.imageSmoothingEnabled = (theme.name === 'crt' ? false : true);
    ctx.textBaseline = 'top';
    atlas.evict();                            // tiles sized to old dpr/zoom/theme
}
```

**DPR-change watcher — follow RESEARCH §Pattern 1 watchDPR (lines 275-293):**
```javascript
// Source: MDN Window.devicePixelRatio, cross-verified with web.dev canvas-hidipi
function watchDPR() {
    const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener('change', () => {
        resizeToTheme(activeTheme, activeZoom);
        watchDPR();                           // re-register for the new DPR (listener self-removes via {once:true})
    }, { once: true });
}
watchDPR();
```

**Font-ready gate — follow RESEARCH §"Font-Ready Gate for First Paint" (lines 793-813):**
```javascript
// Source: 03-RESEARCH.md Pattern 3 + MDN Font Loading API + PITFALLS #9
async function bootRenderer() {
    try { await document.fonts.load('14px "JetBrains Mono"'); }
    catch (err) { console.warn('[renderer] JetBrains Mono load failed', err); }
    await document.fonts.ready;
    initAtlas();
    resizeToTheme(activeTheme, activeZoom);
    requestFrame();
}
```

**Cursor overdraw — follow RESEARCH §Pattern 5 (lines 418-443):**
```javascript
// Source: 03-RESEARCH.md Pattern 5 + CONTEXT D-07 (530ms blink, inverted phosphor)
function paintCursor(ctx, term, theme, frameCount) {
    const packed = term.cursor_packed();
    const row = packed >>> 16;                // Phase 2 convention: (row << 16) | col
    const col = packed & 0xFFFF;
    const x = col * theme.cellW;
    const y = row * theme.cellH;

    if (!canvasHasFocus) {
        ctx.strokeStyle = theme.cursor.fgColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, theme.cellW - 1, theme.cellH - 1);
        return;
    }
    const blinkOn = (frameCount % 64) < 32;   // 530ms at 60fps ≈ 32 frames
    if (!blinkOn) return;
    ctx.fillStyle = theme.cursor.fgColor;
    ctx.fillRect(x, y, theme.cellW, theme.cellH);
    // Inverted-phosphor glyph on top — see Open Question 3 in RESEARCH (globalCompositeOperation path)
}
```

**XSS guard — preserve the `textContent` rule from `www/main.js:74` and `:79`, `:88`:** The renderer never touches `.innerHTML`. Canvas glyph paths are image-only (no HTML sink); any chrome text updates (theme-button label, Debug summary) use `.textContent` exclusively, matching Phase 2.

**Anti-patterns (from RESEARCH §Anti-Patterns lines 518-529) — DO NOT:**
- `ctx.scale(dpr, dpr)` per resize — use `setTransform` (idempotent).
- `ctx.fillText` per cell per frame — atlas `drawImage` path only.
- Full canvas clear + full redraw every tick — dirty-row repaint only.
- Mutate `dirtyView` from JS — Rust owns it; JS only reads and calls `term.clear_dirty()`.
- `Date.now()` for blink cadence — use `frameCount` or `performance.now()` delta.
- `setTimeout(() => e.preventDefault(), 0)` — must be synchronous (Pitfall #3).
- Listen for `navigator.keyboard.lock(...)` — fullscreen-only, out of scope.

---

### `www/renderer/atlas.js` (glyph cache)

**Analog:** `www/main.js:38-54` (module-scope cache + identity-guard re-derive) — same *shape* (module-local Map, explicit evict, lazy population on miss), not same *content*.

**Atlas class — follow RESEARCH §Pattern 4 (lines 382-405):**
```javascript
// Source: 03-RESEARCH.md Pattern 4, adapted for D-03 key shape
export class Atlas {
    constructor() {
        this.cache = new Map();
        this.nonce = 0;                       // increments on every evict; keys miss after eviction even if clear() skipped
    }
    get(ch, fg, rasteriser, zoom) {
        const key = (ch << 24) | (fg << 16) | (this.nonce << 8) | zoom;
        let tile = this.cache.get(key);
        if (!tile) {
            tile = rasteriser(ch, fg);        // Pattern 2 (bitmap) or Pattern 3 (vector) from RESEARCH
            this.cache.set(key, tile);
        }
        return tile;
    }
    evict() {
        this.cache.clear();
        this.nonce = (this.nonce + 1) & 0xFF;
    }
}
```

**Bitmap rasteriser — follow RESEARCH §Pattern 2 (lines 325-346):**
```javascript
// Source: 03-RESEARCH.md Pattern 2 + MDN OffscreenCanvas
export function rasteriseBitmap(ch, fgColor, bgColor, cellW, cellH, z, dpr) {
    const tile = new OffscreenCanvas(cellW * dpr, cellH * dpr);
    const ctx = tile.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.fillStyle = fgColor;
    const base = (ch & 0x7F) * 16;            // 16 bytes per glyph; mask to printable ASCII
    for (let row = 0; row < 16; row++) {
        const bits = BITMAP_FONT[base + row];
        for (let col = 0; col < 8; col++) {
            if (bits & (0x80 >> col)) ctx.fillRect(col * z, row * z, z, z);
        }
    }
    return tile;
}
```

**Vector rasteriser — follow RESEARCH §Pattern 3 (lines 348-370):**
```javascript
// Source: 03-RESEARCH.md Pattern 3 — must run AFTER await document.fonts.ready
export function rasteriseVector(ch, fgColor, bgColor, cellW, cellH, fontPx, dpr) {
    const tile = new OffscreenCanvas(cellW * dpr, cellH * dpr);
    const ctx = tile.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.font = `${fontPx}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = fgColor;
    ctx.fillText(String.fromCharCode(ch), 0, 0);
    return tile;
}
```

**Primer (Pitfall #1 — first drawImage slow until GPU texture uploaded):** After `atlas.evict()`, iterate printable ASCII (0x20–0x7E) inside a `queueMicrotask` and force rasterisation so the next rAF tick's `drawImage` calls are primed. See RESEARCH §Pitfall 1 (lines 562-570).

---

### `www/renderer/themes.js` (theme descriptors)

**Analog:** none in-repo. Use **RESEARCH-locked shape from CONTEXT D-04** and **03-UI-SPEC §Color**.

**Descriptor shape (from CONTEXT D-04):**
```javascript
// Source: 03-CONTEXT.md D-04 + 03-UI-SPEC.md §Color + §Phosphor palette
// One-line theme-switch: `activeTheme = THEMES.crt; atlas.evict();`
export const THEMES = {
    crt: {
        name: 'crt',
        fg: null,                             // derived from phosphor[phosphorColor].fg
        bg: null,                             // derived from phosphor[phosphorColor].bg
        accent: null,                         // derived from phosphor[phosphorColor].accent
        font: null,                           // bitmap — no font-family
        rasteriser: 'bitmap',                 // string tag; atlas.js dispatches to rasteriseBitmap
        cellW: 16, cellH: 32,                 // at 1× zoom (native 8x16 doubled — UI-SPEC §Spacing)
        baseline: 0,                          // bitmap is row-0 aligned
        cursor: { shape: 'block', blink: true, fgColor: null, bgColor: null },  // inverted-phosphor
        bellFlash: { cssVar: '--bell-flash' },
        scanlines: true,
        phosphorSlots: {
            green: { fg: '#33ff66', bg: '#0a0f0a', accent: '#33ff66' },   // DEC VT220 P1
            amber: { fg: '#ffb000', bg: '#140d00', accent: '#ffb000' },   // IBM 5151 / Wyse
            white: { fg: '#e8e8d8', bg: '#0a0a0a', accent: '#e8e8d8' },   // IBM MDA P4
        },
    },
    clean: {
        name: 'clean',
        fg: '#e4e8ee',
        bg: '#0f1419',
        accent: '#7fdbca',
        font: 'JetBrains Mono',
        rasteriser: 'vector',
        fontPx: 14,                           // base; zoom multiplies per UI-SPEC §Spacing
        cellW: 9, cellH: 18,                  // at 1× zoom — measured post document.fonts.ready
        baseline: 0,                          // textBaseline='top' means glyph top-left is origin
        cursor: { shape: 'block', blink: true, fgColor: '#7fdbca', bgColor: '#0f1419' },
        bellFlash: { cssVar: '--bell-flash' },
        scanlines: false,
    },
};
```

**CSS-variable sync (chrome colors) — UI-SPEC §Color "Chrome-specific color tokens":**
Each theme switch updates CSS custom properties on `:root` (or `#terminal-wrapper`): `--chrome-bg`, `--chrome-fg`, `--chrome-accent`, `--chrome-border`, `--bell-flash`, `--scanline-color`. The scanline overlay (`#scanlines`) toggles visibility via a `data-theme="crt"` attribute, not via direct `display:none` JS mutation (keeps CSS as the source-of-truth for chrome visuals).

---

### `www/renderer/bitmap-font.js` (8×16 ASCII glyph Uint8Array)

**Analog:** none in-repo. **License path is load-bearing** — follow RESEARCH §Licensing Notes (lines 903-915).

**Export shape (from CONTEXT D-01):**
```javascript
// Source: 03-CONTEXT.md D-01 + 03-RESEARCH.md §Licensing Notes
// Hand-drawn from scratch using IBM VGA 8×16 visual shape as reference.
// 128 glyphs × 16 rows × 1 byte per row (8 bits wide, MSB-left). Indexed by
// ASCII codepoint: BITMAP_FONT[ch * 16 + row] gives the 8-bit row pattern.
// Only 0x20-0x7E are meaningful; other rows are zero (blank).
//
// Legal: this array is ORIGINAL creative work — no binary was copied from
// IBM VGA ROM, spacerace/romfont, or VileR's Ultimate Oldschool Font Pack.
// The IBM VGA public-domain claim is contested (see spacerace/romfont
// README); CC-BY-SA fonts (VileR) are incompatible with MIT/Apache-2.0.
// Hand-drawn Uint8Array ships under the project's MIT/Apache-2.0 license.
export const BITMAP_FONT = new Uint8Array([
    // 0x00-0x1F: blank (control chars — renderer renders as space)
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // ... 32 more zero rows ...

    // 0x20 (space): 16 zero rows
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 0x21 '!': hand-drawn 8×16 glyph
    0b00000000, 0b00000000, 0b00011000, 0b00011000,
    0b00011000, 0b00011000, 0b00011000, 0b00011000,
    0b00011000, 0b00000000, 0b00011000, 0b00011000,
    0b00000000, 0b00000000, 0b00000000, 0b00000000,
    // ... 0x22 '"' through 0x7E '~' ...
    // 0x7F-0xFF: blank
]);
```

**Construction approach (RESEARCH §Licensing Notes + §Open Questions #5):**
- Reference a 1600%-zoomed screenshot of `Mx437_IBM_VGA_8x16.ttf` rendered at 16 px — visually referenced only, binary NEVER copied.
- Hand-type hex bytes per row, one row at a time.
- Scope: 95 printable ASCII (0x20–0x7E) only — no high-ASCII, no box-drawing, no graphics-mode (v2-RENDER-02).
- Effort estimate: 4–8 hours for 95 glyphs.
- High-risk ambiguous glyphs per RESEARCH Open Q#5: `@`, `$`, `&`, `~`, `{`, `}`, `|`.

---

### `www/renderer/chrome.js` (event wiring — implied by RESEARCH §Recommended Project Structure line 254)

**Analog:** `www/main.js:132-194` (click handlers + `document.getElementById` pattern) — same DOM-wiring shape.

**Click-handler pattern to copy from `www/main.js:132-147`:**
```javascript
// Source: www/main.js:132-147 — pure addEventListener shape, no framework
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);                         // ONE boundary call (Pitfall #4)
    // ... host_reply drain ...
    refreshHarnessUI();
});
```

**Phase 3 extends with keyboard + theme/phosphor buttons** — follow RESEARCH §"Keyboard Shortcut Capture" (lines 818-842):
```javascript
// Source: 03-RESEARCH.md §Keyboard Shortcut Capture + Pitfall 3 (synchronous preventDefault)
// + Pitfall 10 (e.code not e.key for physical bindings)
wrapper.setAttribute('tabindex', '0');
wrapper.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
        e.preventDefault();                   // SYNCHRONOUS first line — never deferred
        toggleTheme();
        return;
    }
    if (e.ctrlKey && !e.shiftKey) {
        if (e.code === 'Equal' || e.code === 'NumpadAdd')     { e.preventDefault(); zoomStep(+1); return; }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract'){ e.preventDefault(); zoomStep(-1); return; }
        if (e.code === 'Digit0' || e.code === 'Numpad0')      { e.preventDefault(); resetZoom(); return; }
    }
    // Phase 4 will add character-encoding here.
});
```

**Bell overlay — follow RESEARCH §Pattern 7 (lines 456-470):**
```javascript
// Source: 03-RESEARCH.md Pattern 7 + CONTEXT D-08
function triggerBellFlash(overlayEl) {
    overlayEl.classList.add('flash');
    setTimeout(() => overlayEl.classList.remove('flash'), 100);
}
```

**Title prefix (D-09) — follow RESEARCH §Pattern 7 lines 475-496:**
```javascript
// Source: MDN Page Visibility API + CONTEXT D-09
const ORIGINAL_TITLE = document.title;
let hasPendingBell = false;

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && hasPendingBell) {
        document.title = ORIGINAL_TITLE;
        hasPendingBell = false;
    }
});
// (the BEL handler inside tick() sets hasPendingBell + title when document.hidden — see canvas.js)
```

---

### `www/assets/fonts/jetbrains-mono-regular.woff2` (asset)

**Analog:** none — first asset in `www/assets/`.

**Source-of-truth:** https://github.com/JetBrains/JetBrainsMono/releases — download the TTF, subset via `pyftsubset ... --unicodes="U+0020-007E"` → ~15-30 KB WOFF2. RESEARCH §Standard Stack + §Licensing Notes lock this.

**If pyftsubset unavailable:** Ship full WOFF2 (~200 KB — acceptable for v1 per RESEARCH §Environment Availability "Missing dependencies with fallback"; note in SUMMARY as v1.x optimisation).

---

### `www/assets/fonts/LICENSE-JetBrainsMono.txt` (license text)

**Analog:** none. OFL 1.1 full text + JetBrains attribution, copied verbatim from upstream `LICENSE` file in the JetBrainsMono repo.

**Required by:** RESEARCH §Licensing Notes action item (line 915).

---

### `www/index.html` (MODIFY — replace Phase 2 `<pre>` harness with canvas DOM)

**Analog:** current `www/index.html` — the `<!DOCTYPE>`, `<meta charset>`, `<style>`, `<script type="module">` skeleton stays. The body changes.

**Preserve from current `www/index.html:1-15`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>BestialiTTY</title>              <!-- drops "Phase 2 Harness" per UI-SPEC -->
  <!-- Dev serve comment block retained; mention canvas instead of <pre> -->
  <style>
    /* ... */
  </style>
</head>
<body>
  <!-- body content changes — see below -->
  <script type="module" src="./main.js"></script>
</body>
</html>
```

**Remove from current `www/index.html:30-51`:** the `<h1>Phase 2 Harness</h1>`, the `<p class="hint">`, the textarea, the two buttons, and the `<pre id="grid">` + `<pre id="dirty">` + `<span id="status">` triad **at the top level**. These relocate into the `<details>` Debug pane (D-15).

**New DOM structure — follow UI-SPEC §Layout Contract (lines 236-261):**
```html
<body>
  <div id="top-bar">
    <button id="theme-toggle">Clean</button>
    <div id="phosphor-group" role="radiogroup" aria-label="Phosphor color">
      <button data-phosphor="green" aria-pressed="true">Green</button>
      <button data-phosphor="amber" aria-pressed="false">Amber</button>
      <button data-phosphor="white" aria-pressed="false">White</button>
    </div>
  </div>

  <div id="terminal-wrapper" tabindex="0">
    <canvas id="terminal" tabindex="-1"></canvas>
    <div id="bell-overlay"></div>
    <div id="scanlines"></div>
  </div>

  <details id="debug">
    <summary>Debug</summary>
    <p class="hint">Paste raw bytes, or use <code>\xNN</code> escapes for control bytes
       (e.g., <code>\x1B</code> = ESC, <code>\x07</code> = BEL). Click <b>Feed</b>
       to send bytes through the wasm VT52 parser in ONE boundary call.
       Click <b>64 KB Stress</b> to demonstrate SC-4.</p>
    <textarea id="input" rows="4" placeholder="Hello\x1BY\x21\x20World"></textarea>
    <button id="feed">Feed</button>
    <button id="stress64k">64 KB Stress</button>
  </details>

  <script type="module" src="./main.js"></script>
</body>
```

**Preserve copy verbatim (UI-SPEC §Copywriting Contract):** The textarea placeholder `Hello\x1BY\x21\x20World`, the Feed / 64 KB Stress labels, and the hint paragraph text (minus the removed "observe the single DevTools Performance entry" aside — retained per UI-SPEC to maintain Phase 2 verification continuity).

**Inline CSS additions (UI-SPEC §Color + §Spacing + RESEARCH Pitfall #7 on @font-face URL):**
```css
/* Source: 03-UI-SPEC.md §Color + 03-RESEARCH.md Pitfall #7 (resolve relative to HTML) */
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/jetbrains-mono-regular.woff2') format('woff2');
  font-display: block;                        /* NOT swap — satisfies ROADMAP SC-1 */
  font-weight: 400;
}

:root {
  --chrome-bg: #1e242c;
  --chrome-fg: #e4e8ee;
  --chrome-accent: #7fdbca;
  --chrome-border: rgba(255,255,255,0.08);
  --bell-flash: rgba(255,255,255,0.7);
  --scanline-color: rgba(0,0,0,0.15);
}
[data-theme="crt"] {
  --chrome-bg: #0a0a0a;
  --chrome-fg: var(--phosphor-fg, #33ff66);
  --chrome-accent: var(--phosphor-fg, #33ff66);
}

#terminal-wrapper {
  border: 1px solid transparent;              /* Pattern 8 — no reflow on focus */
  position: relative;                         /* for absolute-positioned overlays */
}
#terminal-wrapper:focus-visible {
  border-color: var(--chrome-accent);
  outline: none;                              /* suppress UA default */
}

#bell-overlay {
  position: absolute; inset: 0;
  pointer-events: none;                       /* Pitfall #8 — required on EVERY overlay */
  background: var(--bell-flash);
  opacity: 0;
  transition: opacity 100ms ease-out;         /* Pattern 7 */
}
#bell-overlay.flash { opacity: 0.7; }

#scanlines {
  position: absolute; inset: 0;
  pointer-events: none;                       /* Pitfall #8 */
  display: none;                              /* CRT theme toggles this */
  background: repeating-linear-gradient(0deg,
    transparent 0px, transparent 1px,
    var(--scanline-color) 1px, var(--scanline-color) 2px);
}
[data-theme="crt"] #scanlines { display: block; }
```

**Anti-pattern — DO NOT:** Put `@font-face` in an external stylesheet unless the URL is made origin-absolute (RESEARCH Pitfall #7). Inline `<style>` in `index.html` resolves `./assets/fonts/...` relative to the HTML — correct.

---

### `www/main.js` (MODIFY — retain init + view scaffolding; replace pre-text renderers with renderer/canvas.js)

**Analog:** current `www/main.js` — self-extension.

**Preserve VERBATIM from current `www/main.js`:**
- **Lines 14-24** (init + Terminal construction + encode_key_raw smoke): move comments, keep the `import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js'` + `const wasm = await init();` + `const term = new Terminal(24, 80, 10_000);` + the boot-log line exactly.
- **Lines 35-54** (CELL_SIZE const + cachedBuffer + gridView/dirtyView/hostReplyView + `rebuildViews()` + `reDeriveViews()`): move INTO `www/renderer/canvas.js` as module-local state; `main.js` only keeps the `await init()` + `new Terminal(...)` + the initial `rebuildViews()` call.
- **Lines 98-128** (`parseHexEscapes` + `hexDigit`): retain in-place — still used by the Debug Feed button.
- **Lines 132-147** (Feed click handler): retain as-is inside the Debug section wiring. The handler now additionally calls `renderer.requestFrame()` (or sets `needsPaint = true`) so the canvas picks up the newly-fed bytes.
- **Lines 151-194** (`buildStressPayload` + stress64k handler): retain as-is. Same note: add `renderer.requestFrame()` at the end to trigger a canvas repaint after `term.feed(bytes)`.
- **Line 198** initial paint call is replaced by `renderer.bootRenderer()` (async — awaits document.fonts.ready).
- **Line 199** `[boot] Harness ready` log is retained.

**Remove (no longer needed):**
- Lines 58-75 (`renderAscii()`) — canvas replaces it.
- Lines 77-81 (`renderDirty()`) — the dirty `<pre>` is gone.
- Lines 83-90 (`renderStatus()`) — the status span is gone.
- Lines 92-96 (`refreshHarnessUI()`) — replaced by `renderer.requestFrame()`.

**New top-of-file shape (sketch):**
```javascript
// Source: self-extension of www/main.js + 03-CONTEXT.md D-15
import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js';
import { bootRenderer, requestFrame } from './renderer/canvas.js';
import { THEMES } from './renderer/themes.js';

const wasm = await init();
const term = new Terminal(24, 80, 10_000);
const upEnc = encode_key_raw(1, 0);
console.log('[boot] encode_key_raw(ArrowUp, none) =', Array.from(upEnc));

// Phase 3: renderer owns the grid/dirty views and the rAF loop.
await bootRenderer({ wasm, term });

// Phase 2 Debug pane retained — wire Feed + 64 KB Stress as before.
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);
    // ... host_reply drain (lines 138-145 unchanged) ...
    requestFrame();                           // Phase 3: wake canvas
});

// ... stress64k handler (unchanged, plus requestFrame() at the end) ...
// ... parseHexEscapes + hexDigit + buildStressPayload (unchanged) ...

console.log('[boot] Harness ready. Terminal=', term, 'wasm.memory=', wasm.memory);
```

**XSS guard (continuity with Phase 2 main.js:74, :79, :88):** Any new chrome text mutation (theme button label, phosphor selected state) uses `.textContent`, never `.innerHTML`. No new text-node sinks other than the theme-button label.

---

### `www/README.md` (MODIFY — Phase 3 section)

**Analog:** current `www/README.md` — same H2 + fenced code blocks + SC-checklist shape.

**Preserve:** H1 (rename to "BestialiTTY"), build section (`./scripts/build.sh`), serve section (Python / basic-http-server), troubleshooting, Files-in-this-directory table.

**Add:** Phase 3 SC section (SC-1..SC-5 from ROADMAP §Phase 3); note on Playwright bootstrap (if Wave 0 installs it); note on new `www/renderer/` and `www/assets/fonts/` directories in the Files table.

---

## Shared Patterns

### Zero-copy view identity guard (applies to: `canvas.js`)

**Source:** `www/main.js:35-54` — cachedBuffer + `rebuildViews()` + `reDeriveViews()`.
**Apply to:** `canvas.js` — same pattern, same CELL_SIZE = 8, same identity compare. The renderer MUST NOT hold a view object created before the latest `wasm.memory.buffer` (Phase 2 Pitfall #2). Extend with additional views if needed (e.g., a `pack_buf` stride-iterating view — currently just `gridView` suffices).

### Single boundary call per user action (applies to: every new handler)

**Source:** `www/main.js:135` (Feed handler calls `term.feed(bytes)` ONCE regardless of length) + Phase 2 Pitfall #4.
**Apply to:** Renderer's per-frame `term.snapshot_grid()` (ONE call — not per-row, not per-cell). Theme/phosphor/zoom handlers never call `feed()` at all. All state mutations touch the boundary exactly once per user action.

### `textContent` never `innerHTML` (applies to: all DOM writes)

**Source:** `www/main.js:74` (`document.getElementById('grid').textContent = out`) + RESEARCH §Security Domain.
**Apply to:** Theme button label update, phosphor selected state, Debug text — every DOM text mutation uses `.textContent`. No new `.innerHTML` sinks anywhere in Phase 3.

### Module-scope state, no framework (applies to: every `renderer/*.js`)

**Source:** `www/main.js` — module-level `let cachedBuffer = null`, `let gridView = null`, etc. Vanilla ES modules, no React state, no stores.
**Apply to:** `canvas.js` (frameCount, needsPaint, rafPending, canvasHasFocus, activeTheme, activeZoom), `atlas.js` (cache Map, nonce), `themes.js` (const THEMES = {...}), `chrome.js` (wrapper/button element refs). Cross-module communication via **exported functions + events**, never globals.

### Vanilla ES module imports (applies to: every new JS file)

**Source:** `www/main.js:14` — `import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js';`
**Apply to:** Phase 3 adds `import { bootRenderer, requestFrame } from './renderer/canvas.js';` etc. No bundler, no transform step. Relative paths only. Browser ESM resolution.

### Zero per-byte allocation (applies to: rAF tick)

**Source:** Phase 2 SC-3 + `02-06-SUMMARY.md` — "zero-alloc steady state."
**Apply to:** The rAF tick body MUST NOT allocate: no `new Array(80)`, no `Array.from(view)` per row, no `String.fromCharCode(...)`.join() per row (the Phase 2 `renderAscii` did — it gets DELETED for exactly this reason). All paint work is in-place `drawImage` + typed-array reads.

### Comment style — reference decisions + research (applies to: new JS)

**Source:** Every Phase 2 file (`www/main.js`, `crates/bestialitty-core/src/lib.rs`) references D-NN decisions and Pitfall #N numbers in comments; this is the project's established style.
**Apply to:** Every new `renderer/*.js` — reference D-01..D-15 from CONTEXT, Pattern N / Pitfall N from RESEARCH, and the wasm façade contract from `lib.rs:42-52`. Makes downstream reading trace back to decisions.

### Phase 2 Debug harness retention (applies to: `index.html`, `main.js`)

**Source:** CONTEXT D-15 — "textarea + Feed + 64 KB Stress move behind a collapsible `<details>` labelled 'Debug' below the canvas."
**Apply to:** The existing Phase 2 UAT verification path (Phase 2 SC-2 / SC-4 in `www/README.md`) must keep working — the Feed click flow, the 64 KB stress log lines, the host_reply drain — all retained verbatim inside `<details>Debug</details>`. Phase 5 replaces feed source with Web Serial, not Phase 3.

---

## No Analog Found

Files with no close match in the repo — use RESEARCH.md + cited external refs:

| File | Role | Data Flow | Substitute Reference |
|---|---|---|---|
| `www/renderer/canvas.js` | rAF renderer | event-driven | 03-RESEARCH.md §"Complete rAF Loop Skeleton" + §Pattern 1 (HiDPI) + §Pattern 5 (cursor) + §Pattern 8 (focus) |
| `www/renderer/atlas.js` | glyph cache | request-response | 03-RESEARCH.md §Pattern 4 (atlas class) + §Pattern 2 (bitmap rasteriser) + §Pattern 3 (vector rasteriser) |
| `www/renderer/themes.js` | descriptor module | plain data | 03-CONTEXT.md D-04 descriptor shape + 03-UI-SPEC.md §Color §Phosphor palette |
| `www/renderer/bitmap-font.js` | data blob | plain data | 03-CONTEXT.md D-01 + 03-RESEARCH.md §Licensing Notes (hand-draw from scratch — no binary copy) |
| `www/renderer/chrome.js` (if split) | event wiring | event-driven | 03-RESEARCH.md §"Keyboard Shortcut Capture" + §Pattern 7 (bell overlay) — wiring style from www/main.js:132-194 |
| `www/assets/fonts/jetbrains-mono-regular.woff2` | static asset | n/a | https://github.com/JetBrains/JetBrainsMono/releases → pyftsubset to ASCII subset |
| `www/assets/fonts/LICENSE-JetBrainsMono.txt` | license text | n/a | upstream OFL 1.1 LICENSE file in JetBrainsMono repo |

**Reason for no analog:** Phase 1–2 shipped Rust + a minimal JS harness only. The `renderer/`, `assets/fonts/` directories do not exist yet. Phase 3 is the bootstrap of the canvas-rendering layer and the asset-hosting layer. MDN / web.dev / CONTEXT / UI-SPEC / RESEARCH are the authoritative templates for this first pass; subsequent phases will copy from these Phase-3 files as *their* analogs.

**Playwright test bootstrap** (from RESEARCH §Validation Architecture §Wave 0 Gaps): `www/package.json`, `www/playwright.config.js`, `www/tests/render/*.spec.js`, `www/tests/render/baselines/*.png`, `www/tests/fixtures/vt52-sample.bin` — all greenfield; planner should scope a Wave-0 bootstrap plan that installs `@playwright/test`, runs `npx playwright install chromium`, and writes the per-requirement spec files. No existing test-runner config in the repo.

---

## Metadata

**Analog search scope:**
- `www/**` — full tree (index.html, main.js, README.md, .gitignore, pkg/)
- `crates/bestialitty-core/src/**` — lib.rs read for wasm façade contract; terminal/grid read for Cell layout
- `.planning/phases/02-*/02-PATTERNS.md` — format template for this document
- `.planning/phases/02-*/02-CONTEXT.md` — Phase 2 D-01..D-03 grid-view contract
- Repo-wide `ls` for `renderer/`, `assets/`, `tests/` under `www/` — all confirmed absent

**Files scanned:** 7 code files + 4 planning docs (CONTEXT, RESEARCH, UI-SPEC, Phase 2 PATTERNS) + the two Phase 2 source-of-truth files (main.js, lib.rs).

**Pattern extraction date:** 2026-04-22

**Key insight:** Phase 3 is a *renderer-layer bootstrap* built on a *Phase-2-locked zero-copy grid view*. The single most-important in-repo pattern is `www/main.js:35-54` — the cachedBuffer + `rebuildViews()` / `reDeriveViews()` guard. Every new renderer file either extends that pattern directly (`canvas.js`) or sits alongside it without breaking it (`atlas.js`, `themes.js`, `bitmap-font.js`). The second-most-important external contract is `crates/bestialitty-core/src/lib.rs:53-155` — the wasm façade that Phase 3 consumes verbatim with zero Rust changes.
