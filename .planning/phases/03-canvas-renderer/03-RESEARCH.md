# Phase 3: Canvas Renderer — Research

**Researched:** 2026-04-22
**Domain:** HiDPI-correct HTML `<canvas>` 2D renderer for an 80×24 VT52 terminal, consuming a Phase 2 zero-copy `Uint8Array` grid view, with CRT + clean themes, bitmap + vector glyph atlases, CSS-overlay bell + scanlines, block cursor, keyboard-only integer zoom.
**Confidence:** HIGH for canvas/DPR/atlas/font-loading patterns (Context7-quality MDN + web.dev + xterm.js + VS Code sources cross-verified); MEDIUM for bitmap-font licensing (public-domain claims are contested — mitigation recommended); MEDIUM for visual-regression strategy (Playwright is the obvious fit but nothing is installed yet).

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Font strategy**
- **D-01:** CRT theme bitmap font is a hand-drawn 8×16 ASCII glyph table shipped as a `Uint8Array` (128 glyphs × 8 bytes = ~1 KB) in `www/renderer/bitmap-font.js`. Each glyph is 8 bits wide × 16 rows tall, MSB-left. Sourced from a public-domain 8×16 ROM reference; hand-drawn if no clean-licensed source is found.
- **D-02:** Clean theme font is JetBrains Mono Regular, self-hosted as a subset WOFF2 at `www/assets/fonts/jetbrains-mono-regular.woff2`, declared via `@font-face` with `font-display: block` (3 s block, then fallback to `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`). `block` over `swap` specifically to satisfy ROADMAP SC-1 — no font-fallback flash on first paint. No CDN. No Google Fonts.
- **D-03:** One unified glyph atlas caches `(ch, fg, theme)` → `OffscreenCanvas` pre-rasterised tiles. Two rasteriser functions — `rasteriseBitmap(ch, fg)` and `rasteriseVector(ch, fg)` — share a dirty-row repaint + `drawImage` loop. Atlas is evicted on theme change, phosphor change, or zoom change (three coarse-grained invalidation events).

**Theme architecture**
- **D-04:** Themes are plain JS object descriptors in `www/renderer/themes.js`, exporting a `THEMES` map keyed by `"crt"` and `"clean"`. Each descriptor: `{fg, bg, accent, font, rasteriser, cellW, cellH, baseline, cursor: {shape, blink, fgColor, bgColor}, bellFlash: {cssVar}, scanlines: boolean, phosphorSlots?}`. Switching themes = single reference swap + `atlas.evict()`.
- **D-05:** CRT theme has nested `phosphorColor: 'green' | 'amber' | 'white'` enum with three pre-computed `{fg, bg, accent}` palettes. Switching phosphor = sub-field update + atlas evict. Clean theme has no phosphor concept.
- **D-06:** Selected theme, phosphor, and zoom live as **module-local JS state** — no `localStorage` in Phase 3 (Phase 6 PREF-01 owns that). Reload resets to defaults (CRT / green / 1×).

**Cursor**
- **D-07:** Block cursor, blink ON when focused (**530 ms rate** — classic DEC VT cadence), steady outlined block when blurred. Both themes use a block shape; fg/bg differ per theme. Blink phase driven by rAF `frameCount % N` — no CSS animation, no separate timer, no work when canvas isn't repainting.

**Bell & background indicator**
- **D-08:** BEL is a CSS overlay div (`position: absolute`, covers canvas, `pointer-events: none`) pulsed via CSS transition: `opacity: 0.7` on BEL, then transition back to `0` over ~100 ms. Background color = CSS var `--bell-flash` set per theme. Zero canvas damage, zero atlas eviction.
- **D-09:** `(!)` title prefix is appended only when `document.hidden === true` at the moment BEL fires. `visibilitychange` listener clears the prefix on return. Track via `hasPendingBell` boolean: set title to `"(!) " + originalTitle` on BEL-while-hidden, reset on visibility return.

**Zoom**
- **D-10:** Integer multipliers 1×–4× via keyboard only: `Ctrl +` +1 (cap 4), `Ctrl −` −1 (floor 1), `Ctrl 0` reset to 1. Default is 1×. Zoom change evicts atlas and rebuilds tiles at new pixel dimensions.

**CRT aesthetics**
- **D-11:** Fixed subtle scanlines, no slider, no glow. Scanlines are a CSS `repeating-linear-gradient` on a second overlay div, active only in CRT. No phosphor glow (shadowBlur / text-shadow rejected on cost grounds).

**Canvas chrome**
- **D-12:** Minimal top bar: one theme-toggle button labelled with the destination theme name; one 3-way phosphor radio-group (green / amber / white) visible only in CRT (`display:none` in clean). Zoom stays keyboard-only.
- **D-13:** Focus indicator = 1 px theme-accent border on `#terminal-wrapper` when focused + cursor blink ON. Blurred = 1 px *transparent* border of same width (no reflow) + steady outlined block cursor.
- **D-14:** Theme toggle keyboard shortcut = `Ctrl+Shift+T` (keydown listener on canvas container with `preventDefault()`).

**Phase 2 harness**
- **D-15:** Pre-text `<pre id="grid">` + `<pre id="dirty">` + status span removed (canvas replaces them). Textarea + Feed + 64 KB Stress move behind a collapsible `<details>` labelled "Debug" below the canvas. Default-collapsed.

### Claude's Discretion

- Exact CRT phosphor palette RGB triplets (green / amber / white) — researcher-picked period-authentic values.
- Which specific public-domain 8×16 ROM the bitmap font is drawn from (IBM VGA, Amiga Topaz, EGA). License must be clearly permissive-compatible. Hand-draw if no clean source.
- Cell size multiplier at 1× zoom (CRT native is 8×16; "1×" means 16×32 CSS pixels per UI-SPEC).
- Exact top-bar CSS layout / spacing / typography — as long as minimal + theme-consistent.
- OffscreenCanvas in a Worker vs main thread (main thread is sufficient for 80×24).
- Theme-toggle button label update mechanism (React-style re-render vs direct `.textContent`) — direct DOM is the framework-free default.

### Deferred Ideas (OUT OF SCOPE)

- **v2-RENDER-01:** Scanline / phosphor intensity slider.
- **v2-RENDER-02:** VT52 graphics-mode glyphs.
- Phosphor glow / bloom / shader effects.
- Custom phosphor color picker (arbitrary hex).
- Audible bell (at least Phase 6).
- Cursor-style user preference (block vs underline vs bar).
- Font-size fractional zoom.
- UI zoom buttons.
- `localStorage` persistence (Phase 6 PREF-01).
- Selection / copy on canvas (Phase 6 SESS-01).

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RENDER-01 | Canvas-based monospace rendering at fixed 80×24 grid | §Standard Stack (Canvas 2D), §Pattern 1 (fixed-geometry grid + DPR-aware sizing) |
| RENDER-02 | Visible block cursor | §Pattern 5 (cursor-as-overdraw), §Cursor timing (530 ms blink via rAF frameCount) |
| RENDER-03 | Focus indicator on the terminal surface (border or cursor-style change) | §Pattern 8 (1 px outline + transparent-blurred border, no reflow), §Focus & keyboard capture |
| RENDER-04 | CRT theme — bitmap-style pixel font, phosphor colour, optional scanlines/glow | §Pattern 2 (bitmap-to-OffscreenCanvas blit), §Pattern 6 (CSS scanline overlay), §Phosphor palette |
| RENDER-05 | Clean modern monospace theme — sharp web font, minimal chrome | §Pattern 3 (JetBrains Mono subset + `document.fonts.ready`), §Pattern 4 (atlas for vector glyphs) |
| RENDER-06 | User-toggleable theme switch between CRT and clean | §Theme switching (reference swap + atlas evict) |
| RENDER-07 | Keyboard shortcut to toggle theme (Ctrl-Shift-T) | §Keyboard shortcut recapture, §Pitfall 3 (preventDefault synchronous) |
| RENDER-08 | Phosphor colour choice for CRT theme (green / amber / white) | §Phosphor palette (RGB triplets), §Theme switching |
| RENDER-09 | Font size zoom via Ctrl +/− and Ctrl 0, integer multipliers | §Integer zoom + atlas evict, §Keyboard shortcut recapture |
| RENDER-10 | HiDPI / devicePixelRatio rendering without blur on Retina | §Pattern 1 (DPR-aware backing store + setTransform), §DPR change detection via `matchMedia` |
| RENDER-11 | Visible-bell screen flash (~100ms) + title-bar indicator on background tabs | §Pattern 7 (CSS overlay opacity transition), §document.hidden title prefix |
| RENDER-12 | Per-theme cursor styling | §Cursor contract (CRT inverted-phosphor vs clean accent-block; CONTEXT D-07 / UI-SPEC Cursor table) |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Chromium-only.** Use only APIs Chromium supports (OffscreenCanvas, `matchMedia((resolution: ...))`, `document.fonts.ready`, CSS `font-display: block`). No polyfills.
- **JavaScript shell owns rendering.** No Rust changes in this phase. Renderer consumes wasm façade verbatim.
- **Framework-free.** Vanilla ES modules + DOM APIs + hand-authored CSS. No React, Vue, Svelte, bundlers, or component libraries.
- **No CDN.** JetBrains Mono WOFF2 is self-hosted at `www/assets/fonts/`. Bitmap font ships as inline `Uint8Array`.
- **Static site.** Everything under `www/` deploys as-is to GitHub Pages / Cloudflare Pages.
- **Zero-copy wasm boundary.** Extend the Phase 2 `cachedBuffer` identity-guard pattern (see `www/main.js:38-54`). Views are re-derived only when `wasm.memory.buffer` is replaced.
- **Pragmatic VT52 subset.** Printable ASCII (0x20–0x7E) + control handling (CR/LF/BS/BEL) + ESC Y / ESC A/B/C/D/H/I / ESC J / ESC K. No VT100, no ANSI, no VT52 graphics-mode glyphs (v2).

---

## Summary

Phase 3 builds a framework-free Canvas 2D renderer that consumes the Phase 2 zero-copy grid view. The work is dominated by four concerns: (1) getting HiDPI right so a Retina / 4K user sees pixel-crisp bitmap CRT output; (2) getting the glyph atlas right so per-frame text rendering doesn't trash perf; (3) getting font loading right so the first frame uses the correct font (Phase 1 capture tests are only useful if SC-1 holds); (4) getting the rAF loop right so idle-but-focused (cursor blink only) doesn't burn a CPU while background-tab handling still fires the `(!)` title prefix correctly.

Every architectural decision has been pre-locked in CONTEXT.md (D-01 through D-15). The research below is prescriptive — it tells the planner *exactly* which API to call, which DPR formula to apply, which font-licensing pitfall to avoid, and which tests to write.

**Primary recommendation:** Use Canvas 2D with `setTransform(dpr, 0, 0, dpr, 0, 0)` for HiDPI (not `scale()` — idempotent under resize); one `OffscreenCanvas` atlas keyed by `(ch, fg, theme, zoom, dpr)` with full-flush eviction on theme/phosphor/zoom/DPR change; `document.fonts.ready.then(...)` gate on first paint; single rAF loop that self-reschedules only when `needsPaint` is true or cursor-blink-due; CSS overlay divs for bell + scanlines (no canvas damage); **hand-draw the 8×16 bitmap glyphs from scratch based on IBM VGA *shape reference*** (do not copy any existing bitmap verbatim — the IBM VGA public-domain claim is contested in the romfont repo itself, and independent re-drawing is the only safe path for an MIT/Apache-2.0 project).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rasterise glyph from bitmap Uint8Array | Browser / Client (Main thread, OffscreenCanvas) | — | OffscreenCanvas is cheap to allocate per glyph; main thread sufficient for 80×24. No Worker needed (CONTEXT D-03 Claude's Discretion). |
| Rasterise glyph from vector font | Browser / Client (Main thread, OffscreenCanvas + `fillText`) | — | `fillText` must happen after `document.fonts.ready`. Same atlas path as bitmap. |
| Read wasm grid bytes | Browser / Client (Uint8Array view) | Rust / wasm core (owner of pack_buf) | Zero-copy view over `wasm.memory.buffer` (Phase 2 D-03). Renderer never mutates. |
| Frame loop / cursor blink | Browser / Client (rAF) | — | Single rAF loop with `needsPaint` flag + `frameCount` for blink phase. Self-quiesces when idle + blink-not-due. |
| Theme switching | Browser / Client (JS module state + CSS vars) | — | Reference-swap in themes.js + `atlas.evict()` + CSS variable update for chrome. No re-render framework. |
| Bell visual flash | Browser / Client (CSS overlay div + opacity transition) | — | Decoupled from canvas layer entirely. Zero atlas damage. |
| Bell title prefix when hidden | Browser / Client (visibilitychange listener + document.title) | — | One-shot sticky prefix; cleared on return to visible. |
| Scanlines | Browser / Client (CSS repeating-linear-gradient overlay) | — | CSS-only; active only when `theme === "crt"`. |
| Focus indicator | Browser / Client (CSS :focus-visible on wrapper + border) | — | 1 px border on wrapper; same width transparent when blurred (no reflow). |
| Keyboard shortcut capture | Browser / Client (keydown on wrapper, `preventDefault()`) | — | Only when canvas container has focus. When focus is elsewhere, browser shortcuts win. |
| Font subsetting / packaging | Build-time (pyftsubset or glyphhanger) | — | One-time script-generated WOFF2 checked into `www/assets/fonts/`. Not a runtime concern. |
| Visual regression | Build / CI (Playwright `toHaveScreenshot` — Chromium-only) | — | Canvas snapshots with `deviceScaleFactor: 2` for HiDPI verification. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Canvas 2D (built-in) | — | Primary rendering context for both themes | Sufficient for 80×24 cells; WebGL is overkill; xterm.js `addon-canvas` proves this works for a production terminal `[CITED: github.com/xtermjs/xterm.js/issues/935]` |
| OffscreenCanvas (built-in) | — | Glyph atlas tiles (per-glyph pre-rasterisation) | `drawImage` from an OffscreenCanvas is ~5–45× faster than `fillText` per cell per frame `[CITED: code.visualstudio.com/blogs/2017/10/03/terminal-renderer]`; xterm.js / Windows Terminal / VS Code all do this |
| `document.fonts` (CSS Font Loading API) | — | Gate first canvas paint on font-ready | `document.fonts.ready` Promise resolves when all `@font-face` rules have loaded; without it, first paint uses fallback and flashes to web font mid-session `[VERIFIED: MDN Font Loading API]` |
| JetBrains Mono Regular | 2.304 (current release as of 2026-04) | Clean-theme vector font | OFL 1.1 licence — compatible with MIT/Apache-2.0 project distribution `[CITED: github.com/JetBrains/JetBrainsMono/blob/master/README.md]` |
| `matchMedia((resolution: Xdppx))` | — | Detect DPR change (monitor drag) | MediaQueryList `change` event fires when user drags between monitors with different DPR; the query must be re-registered when new DPR takes effect `[CITED: MDN Window.devicePixelRatio]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pyftsubset (fontTools) | fontTools ≥ 4.x | Build-time WOFF2 subsetting | One-shot script to generate `jetbrains-mono-regular.woff2` from the upstream TTF. Ship the resulting WOFF2, not the toolchain `[CITED: fonttools.readthedocs.io]` |
| Playwright | 1.51+ (current as of 2026-04) | Visual regression + keyboard-shortcut tests | `expect(page).toHaveScreenshot()` with `deviceScaleFactor: 2` for HiDPI check; `page.keyboard.press('Control+Shift+T')` for shortcut recapture; Chromium-only (matches project constraint) `[CITED: playwright.dev/docs/test-snapshots]` |
| Node 22 (already installed) | v22.19.0 | Run Playwright + build scripts | Probed via `command -v node` — already present `[VERIFIED: local env]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Canvas 2D | WebGL / WebGPU | Overkill for 80×24; adds shader pipeline; rejected by CONTEXT and ARCHITECTURE.md §Pattern 3. Consider for v2 if ever needed. |
| OffscreenCanvas in Worker | OffscreenCanvas on main thread | Worker helps only when main thread is blocked on other work (which Phase 3 isn't). CONTEXT D-03 Claude's Discretion leans main-thread. |
| `font-display: swap` | `font-display: block` | `swap` allows fallback flash (violates ROADMAP SC-1). `block` hides text for ≤3 s then falls back — paired with `document.fonts.ready` gate, the canvas first paint simply waits (≤3 s max). |
| Ready-made bitmap font file (PC Screen Font / .psf) | Hand-drawn `Uint8Array` glyph table | CONTEXT D-01 locks inline Uint8Array. Avoids the IBM-VGA-font licensing minefield (see Licensing Notes). |
| Playwright | Cypress / WebdriverIO | Playwright has native HiDPI emulation (`deviceScaleFactor`) and `toHaveScreenshot` with configurable diff thresholds. Cypress has weaker Chromium-DPR story. |
| CSS scanlines | Canvas post-pass scanlines | CSS overlay is cheaper (GPU-composited), decouples from atlas. CONTEXT D-11 locks CSS path. |

**Installation (per phase):**

```bash
# For visual regression testing (Phase 3 adds Playwright; no runtime deps)
npm init -y                    # creates package.json if absent
npm install --save-dev @playwright/test
npx playwright install chromium
```

**Version verification (run at plan time — training data is ~6 months stale):**

```bash
npm view @playwright/test version   # confirm current; expect ~1.51+
```

JetBrains Mono has no npm package. Grab from https://github.com/JetBrains/JetBrainsMono/releases (OFL 1.1), pick the variable or Regular TTF, then pyftsubset to `.woff2`. [VERIFIED: GitHub repo README, OFL 1.1 licence]

## Architecture Patterns

### System Architecture Diagram

```
             [MicroBeast byte stream]                       (Phase 5 — not yet)
                       │
                       ▼
             ┌───────────────────┐
             │  term.feed(bytes) │                          Phase 2 boundary (wasm)
             └────────┬──────────┘
                      │ mutates wasm-owned pack_buf + dirty bitmap + bell_pending
                      ▼
            wasm.memory.buffer (linear memory)
                      │
                      │  zero-copy Uint8Array views (cachedBuffer identity guard)
                      ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                       renderer/canvas.js (rAF)                       │
  │                                                                       │
  │  per tick:                                                            │
  │   1. reDeriveViews()        — guard; rebuilds only on buffer swap    │
  │   2. if bell_pending:       — consume flag, trigger CSS overlay flash│
  │        ├── apply .bell-flash class to #bell-overlay                  │
  │        ├── if document.hidden: title = '(!) ' + originalTitle        │
  │        └── term.clear_bell()                                         │
  │   3. term.snapshot_grid()   — refresh pack_buf                       │
  │   4. for each dirty row:                                             │
  │        ├── for each cell: paint via atlas.get(ch, fg, theme)         │
  │        │     └── drawImage(tile, col*cellW, row*cellH) (DPR-scaled)  │
  │        └── mark row not-dirty locally                                │
  │   5. paint cursor on top of cursor cell (overdraw; cheap)            │
  │   6. term.clear_dirty()                                              │
  │   7. if (needsPaint || cursorBlinkDue): requestAnimationFrame(tick)  │
  └──────────────────────┬────────────────────────────────────────────────┘
                         │
                         ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                       renderer/atlas.js                              │
  │                                                                       │
  │  Map<key, OffscreenCanvas>                                            │
  │   key = (ch << 24) | (fg << 16) | (themeNonce << 8) | zoom            │
  │   miss → theme.rasteriser(ch, fg) creates OffscreenCanvas tile        │
  │   evict() = atlas.clear() on theme/phosphor/zoom/DPR change           │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │           Event inputs (drive needsPaint=true + wake rAF)           │
  │                                                                       │
  │   ┌── visibilitychange ─── clear '(!) ' prefix on return             │
  │   ├── matchMedia(resolution) ─── DPR change → resize + evict atlas   │
  │   ├── resize (window) ─── (no-op — 80×24 is fixed geometry)          │
  │   ├── keydown on #terminal-wrapper ─── Ctrl+Shift+T / Ctrl+/-/0      │
  │   ├── click theme button ─── toggle theme + evict + reset zoom?      │
  │   ├── click phosphor radio ─── set phosphor + evict                  │
  │   └── focus / blur on #terminal-wrapper ─── toggle cursor style      │
  └─────────────────────────────────────────────────────────────────────┘

  DOM layering (top to bottom):
     #bell-overlay   (z-index: 2, pointer-events: none)
     #scanlines      (z-index: 1, pointer-events: none, CRT only)
     #terminal       (the <canvas>)
     #terminal-wrapper (focus border + tabindex=0 host)
     #top-bar (theme button + phosphor radio-group)
     <details>Debug</details>
```

### Recommended Project Structure

```
www/
├── index.html                           # replaces Phase 2 <pre> harness DOM
├── main.js                              # Phase 2 harness retained; now calls into renderer/
├── renderer/                            # new in Phase 3
│   ├── canvas.js                        # rAF loop, DPR sizing, cursor compose, paint dispatch
│   ├── atlas.js                         # (ch,fg,theme,zoom,dpr) → OffscreenCanvas cache
│   ├── themes.js                        # THEMES = {crt, clean}, phosphor palettes, CSS var sync
│   ├── bitmap-font.js                   # Uint8Array[128*16] + rasteriseBitmap(ch, fg)
│   └── chrome.js                        # top-bar button/radio wiring + keyboard shortcuts + bell overlay
├── assets/
│   └── fonts/
│       └── jetbrains-mono-regular.woff2 # subset WOFF2, self-hosted (OFL 1.1)
└── pkg/                                 # wasm-pack output (gitignored) — Phase 2
```

### Pattern 1: HiDPI-Correct Canvas Sizing (RENDER-10)

**What:** The canvas backing store is sized in *device pixels* (`cellW * 80 * dpr × cellH * 24 * dpr`); the CSS size stays in *CSS pixels* (`cellW * 80 × cellH * 24`). Every draw operation is scaled by `dpr` via `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` applied once per resize, not via `ctx.scale(dpr, dpr)` applied per frame.

**When to use:** On init, on window resize (moot for fixed 80×24 but include for safety), and on DPR change (monitor drag).

**Why `setTransform` over `scale`:** `scale(dpr, dpr)` *multiplies* the current transform. If you accidentally call it twice, the transform is now dpr²-scaled. `setTransform(dpr, 0, 0, dpr, 0, 0)` is idempotent — calling it twice has the same effect as calling it once. This is the pattern xterm.js and VS Code Terminal use [CITED: web.dev/articles/canvas-hidipi].

**Crucial gotcha:** `ctx.font` is reset to the default (`"10px sans-serif"`) every time `canvas.width` or `canvas.height` is mutated. You MUST set `ctx.font`, `ctx.fillStyle`, `ctx.textBaseline`, `imageSmoothingEnabled` etc. *after* resize, not before [CITED: MDN CanvasRenderingContext2D.font]. The atlas handles this automatically because each OffscreenCanvas is sized once at creation — but the main canvas is re-sized on DPR change, so its context state must be re-established.

**DPR change detection pattern** (monitor drag):

```javascript
// Source: MDN Window.devicePixelRatio, cross-verified with web.dev canvas-hidipi
function watchDPR(onDPRChange) {
  let mql;
  const register = () => {
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener('change', () => {
      // Fires ONCE when DPR changes; re-register with the new DPR.
      onDPRChange(window.devicePixelRatio);
      register();
    }, { once: true });
  };
  register();
}

watchDPR((newDpr) => {
  resizeCanvasToDPR(canvas, ctx, cssWidth, cssHeight, newDpr);
  atlas.evict();   // tiles were rasterised at old dpr
  requestFrame();
});
```

**Example:**

```javascript
// Source: web.dev/articles/canvas-hidipi, MDN Window.devicePixelRatio
function resizeCanvasToDPR(canvas, ctx, cssWidth, cssHeight, dpr) {
  canvas.width  = Math.round(cssWidth  * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width  = cssWidth  + 'px';
  canvas.style.height = cssHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // idempotent; safe to call on every resize
  ctx.imageSmoothingEnabled = false;        // CRT theme — pixel-perfect bitmap scaling
  // NOTE: ctx.font / fillStyle must be reapplied AFTER resize — they were reset by setting canvas.width.
}
```

### Pattern 2: Bitmap Glyph Rasterisation into an OffscreenCanvas (RENDER-04)

**What:** For the CRT theme, each glyph is 8 bits × 16 rows in a `Uint8Array`. To rasterise glyph `ch` at foreground color `fg` and zoom multiplier `z`:

1. Create `new OffscreenCanvas(cellW * dpr, cellH * dpr)` where `cellW = 8 * z` and `cellH = 16 * z` in CSS px.
2. Get 2D context, `imageSmoothingEnabled = false`, `setTransform(dpr, 0, 0, dpr, 0, 0)`.
3. Fill background (phosphor bg) covering the whole tile.
4. For each of 16 rows: read the row byte from the Uint8Array; for each of 8 bits (MSB-left): if set, `fillRect(x*z, y*z, z, z)` with phosphor fg.

**Why `fillRect` over `putImageData`:** `fillRect` with `imageSmoothingEnabled = false` is the cleanest integer-zoom path. `putImageData` forces RGBA conversion + a 1:1 pixel write per bit; at 2× zoom you'd need a 16×32 intermediate buffer. `fillRect` with `z`-sized pixels does the upsampling in one call per bit. For 128 glyphs × ~50% ink coverage × ~64 bits per glyph ≈ 4000 fillRects at theme load — runs in <5 ms total.

**When to use:** Every CRT cell, every zoom level, every phosphor variant. Cached per `(ch, fg, zoom, theme, dpr)` in the atlas — rasterise once, `drawImage` forever.

**Example:**

```javascript
// Source: MDN OffscreenCanvas, Canvas 2D API
export function rasteriseBitmap(ch, fgColor, bgColor, cellW, cellH, z, dpr) {
  const tile = new OffscreenCanvas(cellW * dpr, cellH * dpr);
  const ctx = tile.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, cellW, cellH);

  ctx.fillStyle = fgColor;
  const base = (ch & 0x7F) * 16;   // 16 bytes per glyph; mask to printable ASCII
  for (let row = 0; row < 16; row++) {
    const bits = BITMAP_FONT[base + row];
    for (let col = 0; col < 8; col++) {
      if (bits & (0x80 >> col)) ctx.fillRect(col * z, row * z, z, z);
    }
  }
  return tile;   // bitmap: tile.transferToImageBitmap() would free the canvas, but we keep the ctx
}
```

### Pattern 3: Vector Glyph Rasterisation with Font-Ready Gate (RENDER-05)

**What:** For the clean theme, each glyph is rendered into its OffscreenCanvas via `ctx.fillText(ch, 0, baseline)` with JetBrains Mono. The font MUST be loaded before the first `fillText` call — otherwise the browser silently uses the fallback, and after the font loads mid-session the atlas still holds the fallback-rendered tiles.

**When to use:** Every clean-theme cell. Gate first paint on `document.fonts.ready`. On font-load failure (network offline + cache miss), fall back to the declared `@font-face` fallback chain and rasterise with those metrics — accept that SC-1 "no font-fallback flash" is satisfied in the happy path and that a cold-cache offline load is explicitly not tested.

**Pattern — first-paint gate:**

```javascript
// Source: MDN CSS Font Loading API, web.dev Font Best Practices
// CSS: @font-face { font-family: 'JetBrains Mono'; src: url('./assets/fonts/jetbrains-mono-regular.woff2') format('woff2'); font-display: block; }
//
// NOTE: `font-display: block` hides text for up to 3 s; if the WOFF2 hasn't loaded by then, the fallback
// chain ('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace') is used. Paired with
// `document.fonts.ready` before first paint, the canvas simply waits up to 3 s — no fallback flash.

async function startRenderer() {
  await document.fonts.ready;   // resolves once ALL @font-face declarations have loaded OR timed out
  // Now safe to call ctx.fillText('A', 0, baseline) with font: '14px "JetBrains Mono", ui-monospace'
  initAtlas();
  requestAnimationFrame(tick);
}
```

**Caveat on `font-display: block`:** `block` causes a ~3 s *invisible* block period during which text is reserved but not painted. Since our canvas isn't painting text directly (it paints OffscreenCanvas tiles via `drawImage`), the `document.fonts.ready` Promise is the real gate. `font-display: block` still matters for the top-bar chrome (which uses `ui-monospace` fallback — see UI-SPEC — so is unaffected in practice) and for layout-stability guarantees on any future non-canvas text [CITED: web.dev/articles/font-best-practices, debugbear.com font layout shift].

### Pattern 4: Glyph Atlas with Explicit Full-Flush Eviction (CONTEXT D-03)

**What:** A `Map` keyed by packed `(ch, fg, themeNonce, zoom)` storing `OffscreenCanvas` tiles. `atlas.get(ch, fg)` looks up and rasterises on miss. `atlas.evict()` is a full `Map.clear()` — not LRU, not partial.

**When to use:** Every paint. Evict on theme change, phosphor change, zoom change, DPR change. These four events are rare and coarse-grained; LRU is unnecessary complexity. Worst-case cache size at 1× zoom is 128 glyphs × 1 fg (monochrome VT52) × 1 theme × 1 zoom × 1 dpr = 128 tiles × (8×16) = ~16 KB of canvas data. At 4× zoom + 2× DPR: 128 × (64×128) = ~4 MB — still trivial.

**Key design:** `themeNonce` increments on every theme/phosphor change so lookups after the change miss naturally. Combined with `atlas.evict()` calling `map.clear()`, the effect is belt-and-braces: lookups always miss after eviction (from the clear), and even if eviction didn't fire the nonce would cause misses.

**Example:**

```javascript
// Source: Pattern 3 from ARCHITECTURE.md, adapted for D-03 key shape
export class Atlas {
  constructor() {
    this.cache = new Map();
    this.nonce = 0;
  }
  get(ch, fg, rasteriser, zoom) {
    const key = (ch << 24) | (fg << 16) | (this.nonce << 8) | zoom;
    let tile = this.cache.get(key);
    if (!tile) {
      tile = rasteriser(ch, fg);   // Pattern 2 or 3
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

### Pattern 5: Cursor as Cheap Per-Frame Overdraw (RENDER-02, D-07)

**What:** After painting the dirty rows, paint the cursor on top of the cursor cell every frame, regardless of whether that row is dirty. The cursor cell is re-painted twice (once via the normal row loop, once as cursor) — which at 80×24 with `drawImage` is ≤1 ms per frame.

**Why per-frame overdraw beats "mark cursor cell dirty":** If the cursor cell is marked dirty every 530 ms (blink cadence), then every half-second the atlas look-up + dirty-bit flip fires; worse, any state carried by dirty (like Phase 2 `clear_dirty`) is complicated by a row that's "half dirty". Overdrawing the cursor on top of the normal paint is simpler: the cursor is always freshly painted, always correct, never interacts with dirty state, never evicts atlas tiles.

**Blink cadence:** 530 ms is one half-cycle (on-for-530, off-for-530, period = 1060 ms). At 60 fps, one half-cycle = ~32 frames. Use `frameCount % 64 < 32` for on, `>= 32` for off — computed from a monotonic counter, no `Date.now()`.

**Blink-drives-idle-wake:** When nothing else needs painting, the renderer must still wake every 530 ms to flip the blink. Cheapest pattern: if `idle && focused`, schedule via `setTimeout(tick, msUntilNextBlink)`; if `idle && blurred`, don't schedule at all — blurred cursor is steady (CONTEXT D-07). This beats a free-running rAF that uses a full 16 ms / frame even when doing nothing.

**Example:**

```javascript
// Source: CONTEXT D-07 + Pattern 3 dirty-row extension
function paintCursor(ctx, term, theme, frameCount) {
  const packed = term.cursor_packed();
  const row = packed >>> 16;
  const col = packed & 0xFFFF;
  const x = col * theme.cellW;
  const y = row * theme.cellH;

  if (!canvasHasFocus) {
    // Blurred: steady 1 px outline
    ctx.strokeStyle = theme.cursor.fgColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, theme.cellW - 1, theme.cellH - 1);
    return;
  }
  // Focused: block with 530 ms blink
  const blinkOn = (frameCount % 64) < 32;   // at 60 fps
  if (!blinkOn) return;
  ctx.fillStyle = theme.cursor.fgColor;
  ctx.fillRect(x, y, theme.cellW, theme.cellH);
  // Re-paint glyph on top in bgColor for inverted-phosphor effect
  const tile = atlas.get(readChAt(row, col), theme.cursor.bgColor, theme.rasteriserInverted, zoom);
  ctx.drawImage(tile, x, y);
}
```

### Pattern 6: CSS Scanline Overlay (RENDER-04, D-11)

**What:** A `<div id="scanlines">` positioned absolutely over the canvas (same wrapper), `pointer-events: none`, with `background: repeating-linear-gradient(0deg, transparent 0px, transparent 1px, rgba(0,0,0,0.15) 1px, rgba(0,0,0,0.15) 2px)`. Class `scanlines-on` toggles `display: block` / `display: none` based on theme.

**Why CSS over canvas post-pass:** The canvas stays focused on glyph work; the overlay is GPU-composited by the browser for free. Changes with theme via one class toggle — zero canvas damage, zero atlas eviction, zero JS cost per frame.

**HiDPI interaction:** The scanlines themselves render in CSS pixels, so on a 2× DPR display each "scanline" is 2 device pixels thick. This is acceptable for a "subtle scanline" aesthetic (the UI-SPEC says "subtle enough to use for hours"). If you wanted physical-pixel scanlines you'd need to multiply the gradient stops by `devicePixelRatio` via CSS custom properties set from JS — but CONTEXT D-11 locks the CSS path and "pin to physical pixels" is not a requirement.

### Pattern 7: Bell Overlay with CSS Transition (RENDER-11, D-08)

**What:** A `<div id="bell-overlay">` over the canvas with `position: absolute; pointer-events: none; background-color: var(--bell-flash); opacity: 0; transition: opacity 100ms ease-out;`. On BEL: set `opacity: 0.7` via class toggle (or direct style); one `setTimeout(100 ms)` to remove the class. The CSS `transition` handles the fade back automatically.

**Why class toggle over CSSOM direct manipulation:** Class toggle is readable, theme-scoped via CSS custom properties (different `--bell-flash` per theme), and has zero layout side-effects. Web Animations API is overkill for a single-shot opacity transition.

**Pattern:**

```javascript
// Source: CSS transitions + requestAnimationFrame hand-off
// CSS:
//   #bell-overlay { opacity: 0; transition: opacity 100ms ease-out; background: var(--bell-flash); }
//   #bell-overlay.flash { opacity: 0.7; }
function triggerBellFlash(overlayEl) {
  overlayEl.classList.add('flash');
  setTimeout(() => overlayEl.classList.remove('flash'), 100);
}
```

**Title prefix (D-09) — one-shot sticky:**

```javascript
// Source: MDN Page Visibility API
const ORIGINAL_TITLE = document.title;
let hasPendingBell = false;

function onBellFired() {
  triggerBellFlash(overlayEl);
  if (document.hidden && !hasPendingBell) {
    document.title = '(!) ' + ORIGINAL_TITLE;
    hasPendingBell = true;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && hasPendingBell) {
    document.title = ORIGINAL_TITLE;
    hasPendingBell = false;
  }
});
```

Race-condition note: if BEL fires while `document.hidden === true`, *then* the user switches back, *then* another BEL fires while now-visible — the second BEL should NOT set the prefix (user is looking). The guard `document.hidden &&` handles this correctly. The `hasPendingBell` flag prevents the prefix from being set twice (e.g., a burst of BELs during a background tab session shouldn't produce `(!) (!) (!) BestialiTTY`) [VERIFIED: pattern synthesised from MDN + CONTEXT D-09].

### Pattern 8: Focus Indicator Without Layout Reflow (RENDER-03, D-13)

**What:** `#terminal-wrapper { border: 1px solid transparent; }` in the base state. `#terminal-wrapper:focus-visible { border-color: var(--chrome-accent); }` when focused. The 1 px border is always there — only the color changes on focus. Zero layout shift.

**Why border over outline:** `outline` is outside the element's box model and doesn't affect layout either, but `outline` with a custom radius / thickness has historically been less consistent across Chromium versions. A 1-px border with matching-width transparent fallback is the xterm.js-style pattern and is boringly reliable.

**Focus capture:** The `#terminal-wrapper` div has `tabindex="0"` so it can receive focus. The canvas itself has `tabindex="-1"` (focusable by script via `.focus()`, not by tab). Clicking anywhere in the wrapper focuses the wrapper (natural); the renderer's `focus` / `blur` event listeners on the wrapper drive the cursor state.

```css
/* Source: MDN :focus-visible + CONTEXT D-13 */
#terminal-wrapper {
  border: 1px solid transparent;
  /* No outline — matches CONTEXT spec for minimal chrome. */
}
#terminal-wrapper:focus-visible {
  border-color: var(--chrome-accent);
  outline: none;   /* suppress browser default */
}
```

### Anti-Patterns to Avoid

- **`ctx.scale(dpr, dpr)` on every resize.** Cumulative (each call multiplies). Use `setTransform(dpr, 0, 0, dpr, 0, 0)` — idempotent.
- **`ctx.fillText` per cell per frame.** 5–45× slower than the atlas `drawImage` path [CITED: code.visualstudio.com/blogs/2017/10/03/terminal-renderer]. Always rasterise-once, blit-forever.
- **Full canvas clear + full redraw on every rAF tick.** Dirty-row repaint (Phase 2 already provides the dirty bitmap). Unpainted rows persist across frames.
- **Per-byte `term.feed()` calls.** Phase 2 already locks single-call-per-chunk (Pitfall #4). Phase 3 inherits this automatically — we never touch `feed` in the renderer.
- **Rasterising vector fonts before `document.fonts.ready`.** Silently uses fallback metrics; atlas permanently wrong until evicted.
- **Using `Date.now()` for blink cadence.** Jitter across frames. Use `frameCount` or `performance.now()` delta.
- **Mutating the dirty bitmap from JS.** Only Rust mutates; JS reads + calls `term.clear_dirty()`. Don't write into the Uint8Array view.
- **Copying grid cells into JS objects.** The cell layout is `{ ch: u32 LE, fg, bg, flags, pad }` at stride 8. Read bytes directly from the view; never `new Cell(...)`.
- **Using `.innerHTML` anywhere in the renderer.** `textContent` only (Phase 2 main.js already follows this — XSS guard).
- **Listening for `navigator.keyboard.lock(...)`.** That's fullscreen-only and out of scope (v2 idea in PITFALLS #9). Phase 3 accepts "some browser shortcuts are un-recapturable when focus is elsewhere".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HiDPI detection on monitor drag | Polling `window.devicePixelRatio` on rAF | `matchMedia('(resolution: Xdppx)')` with one-shot `change` listener | Fires exactly once per transition; no per-frame cost |
| Font-ready gating | `setTimeout(() => paint(), 500)` | `await document.fonts.ready` | Deterministic; Chrome guarantees Promise resolution when all `@font-face` have settled (loaded or timed out per `font-display`) |
| WOFF2 font subsetting | Ship the whole 200 KB JetBrains Mono variable font | `pyftsubset ... --unicodes="U+0020-007E"` → ~15-30 KB | One-time build-time cost; shrinks the only network fetch by 10× |
| Bell screen flash animation | JS setInterval fading opacity manually | CSS `transition: opacity 100ms` + class toggle | GPU-composited; zero JS work; theme-scoped via CSS vars |
| Background-tab notification | Timer polling | `visibilitychange` event + `document.hidden` | Spec-guaranteed semantics; no busy-wait |
| Cursor blink timer | `setInterval(530, toggleCursor)` | `frameCount % N` inside rAF | Zero timers; dies with the renderer; no drift |
| Glyph atlas LRU | Any eviction strategy | Full `Map.clear()` on theme/phosphor/zoom change | 4 MB peak cache size at 4× zoom + 2× DPR is trivial; LRU is gratuitous complexity |
| Visual regression | Hand-capture `toDataURL()` + pixel diff | Playwright `expect(page).toHaveScreenshot()` | Handles threshold tuning, baseline management, mask regions, CI integration |
| Bitmap font license clearance | Copy IBM VGA ROM binary verbatim | Hand-draw 128 glyphs from scratch using IBM-VGA *shape reference* | See Licensing Notes — IBM VGA "public domain" claim is contested in the romfont repo itself |
| Detecting own focus state | Track via `document.activeElement` on every frame | `focus` / `blur` event listeners + boolean state var | Events fire exactly on transition; no polling |

**Key insight:** Every one of these "don't hand-roll" cases has a browser-native mechanism that's simpler, correct by construction, and less code than any hand-rolled equivalent. The pattern is: subscribe to the event, react. Not: poll, detect, react.

## Runtime State Inventory

*(This phase is a greenfield addition — Phase 3 introduces new directories and files, but doesn't rename anything. No migration concerns. Included for completeness per the research protocol.)*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no databases, no localStorage in Phase 3 (CONTEXT D-06 defers to Phase 6) | None |
| Live service config | None | None |
| OS-registered state | None — no scheduled tasks, no systemd, no pm2 | None |
| Secrets / env vars | None — static site, no auth, no external service | None |
| Build artifacts | `www/pkg/` wasm-pack output already gitignored (Phase 2); **new:** `www/assets/fonts/jetbrains-mono-regular.woff2` checked into repo (not gitignored). Node_modules if Playwright is installed — must add to `.gitignore` | Add `node_modules/` and `playwright-report/` to `.gitignore` at repo root or inside `www/` |

## Common Pitfalls

### Pitfall 1: First `drawImage` from OffscreenCanvas Is Slow Until Primed

**What goes wrong:** The first `drawImage` from a freshly-created OffscreenCanvas triggers a GPU texture upload. On a 4K screen during theme switch (full atlas repopulation), this can spike into 20–40 ms for the first frame.

**Why it happens:** The 2D context lives on the CPU; `drawImage` pushes the source to the GPU lazily on first blit.

**How to avoid:** After `atlas.evict()`, do a warm-up pass — iterate all printable ASCII (0x20–0x7E) and force rasterisation off-frame (e.g., in a `queueMicrotask`). The next rAF tick's `drawImage` calls are then already-primed.

**Warning signs:** Theme toggle causes a visible ~40 ms hitch. First paint after page load is ~20 ms longer than subsequent frames.

### Pitfall 2: `ctx.font` / `fillStyle` Reset After Canvas Resize

**What goes wrong:** Setting `canvas.width` or `canvas.height` resets the 2D context to default state — `ctx.font` becomes `"10px sans-serif"`, `ctx.fillStyle` becomes `"#000000"`, `imageSmoothingEnabled` becomes `true`.

**Why it happens:** Spec-mandated. Canvas element reset on any dimension change [CITED: MDN CanvasRenderingContext2D].

**How to avoid:** Set context state *after* resize. Keep a `applyThemeContext(ctx)` function that applies all required state (font, fillStyle, imageSmoothingEnabled, setTransform) and call it after every resize including the DPR-change path.

**Warning signs:** Glyphs rendered with wrong font after DPR change. Image smoothing re-enables (blurry CRT) after window drag.

### Pitfall 3: `preventDefault()` Must Be Synchronous in `keydown`

**What goes wrong:** If `preventDefault()` is called asynchronously (e.g., inside a `setTimeout(0)` or an `await`-ed function continuation), the browser has already processed the default action. Ctrl+0 zooms the browser; Ctrl+Shift+T reopens closed tab.

**Why it happens:** The browser's synchronous event dispatch returns after the handler function returns. Any deferred work is too late.

**How to avoid:** Call `preventDefault()` on the very first line of the keydown handler for any key we claim. Do the theme switch / zoom change / etc. after.

```javascript
// Source: MDN KeyboardEvent.preventDefault, PITFALLS #9
wrapper.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'T') {
    e.preventDefault();   // SYNCHRONOUS — do this first
    toggleTheme();
  } else if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
    e.preventDefault();
    zoomIn();
  } else if (e.ctrlKey && (e.key === '-' || e.key === '_')) {
    e.preventDefault();
    zoomOut();
  } else if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    resetZoom();
  }
  // Otherwise — let the browser have the key (and Phase 4 will claim keystrokes separately)
});
```

**Warning signs:** Zoom shortcut zooms the browser chrome instead of the terminal. Ctrl+Shift+T reopens a closed tab.

### Pitfall 4: Background-Tab rAF Throttles to 1 Hz (Chrome 88+)

**What goes wrong:** Cursor blink pauses in background tabs (visual), BEL-while-hidden title prefix can be delayed if the BEL arrives via a rAF-gated path.

**Why it happens:** Chrome throttles background-tab rAF to 1 Hz and JS timers to once per minute after 5 minutes idle [CITED: developer.chrome.com/blog/timer-throttling-in-chrome-88].

**How to avoid:**
- Cursor blink pausing in background is fine — user isn't looking.
- BEL detection MUST come from a path that runs outside rAF. The `bell_pending` flag is set by wasm when `term.feed(bytes)` is called. Since Phase 2's `feed` is called from a user-triggered click (harness) or from Web Serial's read loop (Phase 5), neither is rAF-gated. The renderer's role is: if rAF is running, read `bell_pending` at tick start; if not, do not rely on rAF for bell detection — the `feed` call site should check `bell_pending` and trigger the title-prefix update synchronously before returning.
- In Phase 3 specifically: the Debug `<details>` Feed button is click-driven, so BEL from that path updates the title synchronously. A real MicroBeast-backed BEL (Phase 5) arrives via Web Serial's pure-async read loop and doesn't depend on rAF either (PITFALLS #6 — "decouple read loop from rAF"). Phase 3 just needs to verify the visibility-title hook survives a backgrounded tab.

**Warning signs:** Background tab with MicroBeast burst output doesn't show `(!)` in the title until you return to the tab. (If this happens: BEL detection is rAF-gated. Move it to the `feed` call site.)

### Pitfall 5: JetBrains Mono Subset Metrics Don't Match Fallback Metrics

**What goes wrong:** You measure JetBrains Mono cell width with `ctx.measureText('M').width` at first paint, cache it. User is offline, WOFF2 load times out, fallback font kicks in — now every cell is the wrong width. 80-col grid wraps or truncates.

**Why it happens:** Fallback fonts (Menlo, Consolas, SFMono-Regular) have different advance widths at the same pixel size.

**How to avoid:**
- Measure in an OffscreenCanvas at init *before* rasterising any cells, and ONLY after `document.fonts.ready`.
- If fallback is active (`document.fonts.check('14px "JetBrains Mono"')` returns false), re-measure and size cells to the fallback metrics. Accept that the rendered result won't be pixel-identical to the JetBrains Mono design, but it will be geometrically consistent.
- Pin `font-family: 'JetBrains Mono', ui-monospace, ...` in the `@font-face` AND in the `ctx.font` string — so the fallback chain is consistent.

**Warning signs:** On slow-network first load, grid geometry is off for a few seconds, then snaps. Visual-regression tests with network throttled fail intermittently.

### Pitfall 6: OffscreenCanvas Memory Not Reclaimed Until GC

**What goes wrong:** Every zoom step change or theme change evicts the atlas. On a loop of zoom in / zoom out, the renderer burns through atlases. JavaScript GC doesn't reclaim OffscreenCanvas memory proactively — it's backed by GPU resources held by the browser until reference count hits zero *and* GC has run.

**Why it happens:** Atlases are JS `Map` values. `map.clear()` drops references — but if any closure retains the old OffscreenCanvas (e.g., an in-flight `drawImage` that's still on the render-pipeline queue), it won't be collected.

**How to avoid:**
- Don't hold `Map` values in closures outside the atlas module.
- Prefer local variables inside the render loop (`const tile = atlas.get(...)`) — these are stack-scoped and drop immediately.
- The absolute worst case (4 MB × N unreclaimed atlases) is still negligible for the life of a session; do NOT complicate the code for this unless profiling shows a real leak.

**Warning signs:** Chrome Task Manager shows GPU memory climbing on repeated theme toggle. (Verify by stress test: 100 theme toggles and check GPU memory is bounded.)

### Pitfall 7: `@font-face` URL Must Resolve Relative to CSS, Not HTML

**What goes wrong:** CSS at `www/index.html` (inline `<style>`) with `@font-face { src: url('./assets/fonts/...'); }` resolves relative to the *HTML document*, which is fine. If the CSS is later extracted to `www/styles.css`, the same URL resolves relative to the CSS file — and breaks.

**How to avoid:** Use `url('/assets/fonts/jetbrains-mono-regular.woff2')` (absolute from origin root) if the static site is always served from `www/` as the doc root. Otherwise use inline CSS in `index.html` as CONTEXT §code_context implies (`<style>` block in index.html gets the `@font-face`).

**Warning signs:** Font shows 404 in DevTools Network tab; canvas renders in fallback metrics.

### Pitfall 8: `pointer-events: none` Required on Every Overlay

**What goes wrong:** Without `pointer-events: none` on `#bell-overlay` and `#scanlines`, the overlays absorb clicks / keydown / focus — the canvas wrapper never gets them.

**How to avoid:** Both overlays MUST have `pointer-events: none` in CSS. The UI-SPEC table confirms this.

**Warning signs:** Clicking the terminal doesn't focus it. Keyboard shortcuts don't work. Debug: temporarily set `pointer-events: auto` on overlays and confirm clicks are absorbed there.

### Pitfall 9: `document.fonts.ready` Resolves Too Early if No `@font-face` Ever Fetched

**What goes wrong:** If the page has a `@font-face` but Chromium decides the font isn't required for the initial layout (e.g., the fallback handles it), `document.fonts.ready` can resolve before the WOFF2 has started loading. First rAF paints with fallback metrics; the WOFF2 finishes loading a few seconds later; tiles cache permanently with fallback.

**How to avoid:** Force-load the font explicitly before `document.fonts.ready`:

```javascript
// Source: MDN CSS Font Loading API
await document.fonts.load('14px "JetBrains Mono"');   // forces the load
await document.fonts.ready;   // in case there are other @font-face rules
initAtlas();
```

This guarantees the WOFF2 is fetched and parsed before the atlas is built.

**Warning signs:** First paint uses fallback font *every* reload; WOFF2 loads but atlas was built in the meantime.

### Pitfall 10: Keyboard Event `key` vs `code` Confusion

**What goes wrong:** `e.key` is the character produced (affected by Shift, layout). `e.code` is the physical key. For "Ctrl+Shift+T": `e.key === 'T'` (uppercase because Shift is held), `e.code === 'KeyT'`. Using `e.key === 't'` won't match when Shift is held.

**How to avoid:**
- For **shortcut keys** (physical bindings — Ctrl+Shift+T, Ctrl+0, Ctrl+-): use `e.code === 'KeyT'`, `e.code === 'Digit0'`, `e.code === 'Minus'`.
- For **character input** (future Phase 4): use `e.key` for the character + `e.code` for arrow / function keys.

**Warning signs:** Ctrl+Shift+T doesn't work (because you checked `e.key === 't'` and Shift made it `'T'`).

## Code Examples

Verified patterns from official sources + CONTEXT-locked decisions.

### Complete rAF Loop Skeleton

```javascript
// Source: Synthesised from Pattern 5 + Pattern 7 + CONTEXT D-07 + PITFALLS #4 / #6
let frameCount = 0;
let needsPaint = false;
let rafPending = false;
let canvasHasFocus = false;

function requestFrame() {
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(tick);
  }
}

function tick() {
  rafPending = false;
  frameCount++;

  // 1. Reconcile views (guard against wasm.memory.buffer swap — Phase 2 pattern)
  reDeriveViews();

  // 2. Bell — consume any pending bell (drives the CSS overlay + title prefix)
  if (term.bell_pending()) {
    triggerBellFlash(bellOverlayEl);
    if (document.hidden && !hasPendingBell) {
      document.title = '(!) ' + ORIGINAL_TITLE;
      hasPendingBell = true;
    }
    term.clear_bell();
  }

  // 3. Dirty-row repaint
  term.snapshot_grid();
  const rows = term.rows();
  const cols = term.cols();
  for (let r = 0; r < rows; r++) {
    if (dirtyView[r]) paintRow(r, cols);
  }
  term.clear_dirty();

  // 4. Cursor as overdraw
  paintCursor(ctx, term, activeTheme, frameCount);

  // 5. Self-reschedule only if there's reason to
  if (canvasHasFocus) {
    // Focused: keep blinking — wake every ~530 ms
    requestFrame();   // rAF handles the cadence at 60 fps; consider setTimeout for battery
  } else if (needsPaint) {
    // Not focused but repaint queued (e.g., theme change) — one more frame
    needsPaint = false;
    requestFrame();
  }
  // Otherwise: idle. Wake on next event (keydown, click, feed, visibility, DPR, etc.)
}

// Event wiring
wrapper.addEventListener('focus', () => { canvasHasFocus = true;  needsPaint = true; requestFrame(); });
wrapper.addEventListener('blur',  () => { canvasHasFocus = false; needsPaint = true; requestFrame(); });
feedButton.addEventListener('click', () => { /* ... feed ... */ needsPaint = true; requestFrame(); });
```

### HiDPI Resize with DPR-Change Listener

```javascript
// Source: Pattern 1 + MDN devicePixelRatio + web.dev canvas-hidipi
function resizeToTheme(theme, zoom) {
  const cssW = theme.cellW * 80 * zoom;
  const cssH = theme.cellH * 24 * zoom;
  const dpr = window.devicePixelRatio;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  // ctx state reset by canvas.width/height assignment — re-establish:
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = (theme.name === 'crt' ? false : true);
  ctx.font = `${theme.fontPx}px "${theme.font}", ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  atlas.evict();   // tiles sized to old dpr/zoom/theme
  needsPaint = true;
  requestFrame();
}

function watchDPR() {
  const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mql.addEventListener('change', () => {
    resizeToTheme(activeTheme, activeZoom);
    watchDPR();   // re-register for the new DPR
  }, { once: true });
}
watchDPR();
```

### Font-Ready Gate for First Paint

```javascript
// Source: Pattern 3 + MDN Font Loading API + PITFALLS #9
async function bootRenderer() {
  // Force-load the clean-theme font so `document.fonts.ready` has something to wait for.
  try {
    await document.fonts.load('14px "JetBrains Mono"');
  } catch (err) {
    console.warn('[renderer] JetBrains Mono load failed; will use fallback', err);
  }
  await document.fonts.ready;

  // Verify the font actually landed (may have fallen back via font-display: block after 3 s).
  const hasJetBrains = document.fonts.check('14px "JetBrains Mono"');
  console.log('[renderer] font status: JetBrains Mono =', hasJetBrains);

  initAtlas();
  resizeToTheme(activeTheme, activeZoom);
  requestFrame();
}
```

### Keyboard Shortcut Capture

```javascript
// Source: Pattern 3 / Pitfall 10 / CONTEXT D-14
wrapper.setAttribute('tabindex', '0');   // make wrapper focusable
wrapper.addEventListener('keydown', (e) => {
  // Theme toggle
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
    e.preventDefault();
    toggleTheme();
    return;
  }
  // Zoom
  if (e.ctrlKey && !e.shiftKey) {
    if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      e.preventDefault(); zoomStep(+1); return;
    }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      e.preventDefault(); zoomStep(-1); return;
    }
    if (e.code === 'Digit0' || e.code === 'Numpad0') {
      e.preventDefault(); resetZoom(); return;
    }
  }
  // Phase 4 will add the full character-encoding path here — out of scope for Phase 3.
});
```

### Reading a Cell from the Zero-Copy View

```javascript
// Source: Phase 2 D-03 + Phase 2 main.js:63-70 + Cell #[repr(C)] layout
// Cell stride: 8 bytes — ch (u32 LE) | fg (u8) | bg (u8) | flags (u8) | pad (u8)
const CELL_SIZE = 8;
function readCell(gridView, cols, row, col) {
  const i = (row * cols + col) * CELL_SIZE;
  // ch is u32 LE; for printable ASCII only the low byte matters.
  const ch = gridView[i] | (gridView[i + 1] << 8) | (gridView[i + 2] << 16) | (gridView[i + 3] << 24);
  const fg = gridView[i + 4];
  const bg = gridView[i + 5];
  const flags = gridView[i + 6];
  return { ch, fg, bg, flags };
}
```

## Phosphor Palette — Researcher-Finalised RGB Values

CONTEXT.md Claude's Discretion: pick period-authentic values. UI-SPEC already locks these; this section is the rationale.

| Variant | Foreground | Background | Accent | Provenance |
|---------|------------|------------|--------|------------|
| Green (P1, default) | `#33ff66` | `#0a0f0a` | `#33ff66` | DEC VT220 shipped with a P1 green phosphor (~525 nm). The `#33ff66` reflects the *perceived* green of a P1 phosphor on a dark CRT, boosted slightly from a pure `#00ff00` (too clinical) toward `#33ff66` which matches retrocomputing-community screenshots of well-maintained VT220 tubes. `[ASSUMED]` The PCjs project settled on `#09CC50` for IBM 5151 green [CITED: pcjs.org/blog/2018/11/15/]; our choice is close but slightly warmer. |
| Amber (P3) | `#ffb000` | `#140d00` | `#ffb000` | IBM 5151 amber + Wyse terminal amber. Classic "amber monochrome" on CRT is ~585 nm — `#ffb000` is the community-consensus hex. `[ASSUMED]` |
| White (P4) | `#e8e8d8` | `#0a0a0a` | `#e8e8d8` | IBM MDA P4 phosphor was a slightly warm white (not pure `#ffffff`). `#e8e8d8` has a hint of cream that matches period photos. `[ASSUMED]` |

**Action required before Phase 3 ships:** These values are researcher-picked from community-consensus ballpark ranges. The UI-SPEC already committed to them. If a user tests them side-by-side with a real CRT and finds them jarring, revisit as a v1.x tweak — not a blocker.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ctx.scale(dpr, dpr)` once | `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` per resize | ~2015 with Canvas 2D settling | Idempotent; safe under repeated resize |
| `@font-face { font-display: auto }` default | Explicit `font-display: swap` or `block` | Chrome 60 (2017) | User controls the FOIT vs FOUT tradeoff |
| Separate `requestAnimationFrame` shim | Native `requestAnimationFrame` | ~2012+ | No polyfill needed in Chromium-only app |
| Canvas text rendering via `fillText` each frame | OffscreenCanvas atlas + `drawImage` | VS Code Terminal 2017, xterm.js 2018 | 5–45× faster, battery savings |
| `@font-face` without `document.fonts.ready` gate | Explicit `await document.fonts.ready` before first use | CSS Font Loading API stable 2018 | Deterministic first paint |
| `KeyboardEvent.keyCode` | `KeyboardEvent.code` + `.key` | `.keyCode` deprecated ~2017 | Layout-independent; non-US keyboards |
| DPR change via resize listener (assuming DPR follows size) | `matchMedia('(resolution: ...)')` dedicated listener | Mid-2010s standardization | Fires on monitor drag without resize |

**Deprecated / outdated:**
- `ctx.webkitBackingStorePixelRatio` — never shipped to standard; ignore if seen in old Canvas tutorials.
- `@font-face { font-display: auto }` — browser-specific behaviour, prefer explicit `block`/`swap`/`fallback`.
- Canvas `document.write` font injection — use `@font-face` + `document.fonts.ready`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | IBM VGA 8×16 ROM font cannot safely be copied verbatim into an MIT/Apache-2.0 project; hand-drawing is required | Licensing Notes | LOW — CONTEXT D-01 already locks the "hand-drawn Uint8Array" path; this assumption reinforces that choice rather than changing it. If Planner/User is comfortable with CC-BY-SA (e.g., VileR's Ultimate Oldschool PC Font Pack), an alternative path exists — but it would change the project's overall license strategy. |
| A2 | The three phosphor hex triplets (`#33ff66`, `#ffb000`, `#e8e8d8`) are period-authentic-enough | §Phosphor Palette | LOW — aesthetic preference; v1.x tweakable |
| A3 | Main-thread OffscreenCanvas is sufficient for 80×24 — Worker not needed | §Pattern 4, CONTEXT D-03 Claude's Discretion | LOW — if a measurable frame-drop appears during theme toggle / heavy output, move atlas rasterisation to a Worker with `transferControlToOffscreen` |
| A4 | `font-display: block` + `document.fonts.ready` + force-load via `document.fonts.load(...)` is enough to guarantee no fallback flash | §Pattern 3 | MEDIUM — on extremely slow networks the 3 s `block` window expires and fallback kicks in; ROADMAP SC-1 says "no font-fallback flash on first paint", which is satisfied in the happy path. Acceptance: document the edge case in SUMMARY. |
| A5 | Background-tab rAF throttling doesn't prevent BEL title prefix from firing, because `feed()` is called from a user-click or Web Serial async path (not rAF) | §Pitfall 4 | MEDIUM — if Phase 5's read loop ends up rAF-gated by mistake, BEL-while-hidden could be delayed. Planner should confirm Phase 5 design keeps read loop independent of rAF (PITFALLS #6). |
| A6 | Playwright's `deviceScaleFactor: 2` emulation gives the same canvas-paint results as a real 2× DPR display | §Validation Architecture | MEDIUM — Playwright's Chromium matches real Chromium behaviour in principle; confirmed by official docs. If visual-regression baselines drift between local dev on a 2× Retina and CI's headless 2× emulation, pin both to the same `deviceScaleFactor` + `colorScheme`. |
| A7 | `visibilitychange` fires reliably when Chromium backgrounds a tab (no intermittent misses) | §Pitfall 4, §Pattern 7 | LOW — API is standard and Chromium-tested for years. Known webview quirk (electron#28677) is for embedded webviews, not Chromium top-level tabs. |
| A8 | Cursor blink cadence of 530 ms is "the classic DEC VT cadence" | §Pattern 5 | LOW — CONTEXT D-07 asserts it, and xterm/gnome-terminal use this same cadence; widely-accepted retrocomputing convention. |

## Licensing Notes (critical for Phase 3 planning)

**IBM VGA 8×16 font — DO NOT copy the binary:**
- `spacerace/romfont` README explicitly questions whether IBM released the VGA font to public domain. Quote: "I doubt IBM would release a font to public domain. Does this mean, qemu relied on claims by package creator and now they use an illegal copy?" `[CITED: github.com/spacerace/romfont/blob/master/README.md]`
- VileR's "Ultimate Oldschool PC Font Pack" (Px437 / Mx437 IBM VGA 8x16 reconstructions) is CC-BY-SA 4.0 — **incompatible with MIT / Apache-2.0 project distribution** (CC-BY-SA is copyleft). `[CITED: int10h.org/oldschool-pc-fonts/readme/]`
- **Safe path (CONTEXT D-01 locked):** Hand-draw the 128 printable ASCII glyphs (0x20–0x7E) from scratch, using the IBM VGA *visual shape* as reference (not binary copy). The resulting Uint8Array is original creative work by the author and ships under the project's MIT/Apache-2.0 license. "From scratch" means: look at a rendered glyph image, decide pixel placement per row by eye, type hex. This is ~4-8 hours of work for 95 printable ASCII glyphs at 8×16.
- **Abridged alternative:** Only 7-bit ASCII 0x20–0x7E is needed for VT52's MicroBeast subset (95 glyphs — no box-drawing, no high-ASCII, no extended Latin). That cuts ~25% of the work vs. full 128-char set.

**JetBrains Mono — safe to ship:**
- OFL 1.1 licence. Compatible with MIT/Apache-2.0 project distribution. Requires attribution in a LICENSE / NOTICE file. Ship the WOFF2 directly. `[CITED: github.com/JetBrains/JetBrainsMono README.md]`
- Action: Subset to printable ASCII (U+0020–007E) via `pyftsubset` to reduce WOFF2 size to ~15-30 KB from the original ~200 KB.

**Action item for planner:** Include a `www/assets/fonts/LICENSE-JetBrainsMono.txt` containing the full OFL 1.1 text with JetBrains attribution as part of the ship pipeline.

## Open Questions (RESOLVED)

1. **Should Phase 3 install Playwright + write visual-regression tests, or defer to Phase 6?**
   - **RESOLVED (2026-04-22):** Install Playwright in Phase 3. Plan 01 (Wave 0) bootstraps `www/package.json` + `www/playwright.config.js`; Plan 04 writes 9 specs covering all 12 RENDER-XX IDs. Cursor-blink region is masked in baselines to avoid flake.

2. **When CRT zoom is at 4×, atlas tiles are 32×64 CSS px × 2 DPR = 64×128 device px = ~32 KB per tile × 95 printable ASCII = ~3 MB. Is this a concern?**
   - **RESOLVED (2026-04-22):** Not a concern for the daily-driver Chromium-desktop target. No pre-optimisation. If field telemetry surfaces issues post-v1, revisit with worker-based atlas or LRU — deferred.

3. **Should the cursor's inverted-phosphor rendering reuse the existing glyph tile, or require a second atlas with swapped fg/bg?**
   - **RESOLVED (2026-04-22):** Planner chose a hybrid — `paintCursor()` renders the inverted cell per-frame via a small cached inverted-tile sub-atlas keyed by `(ch, cursor_nonce)`. This eliminates per-frame `new OffscreenCanvas` allocation and keeps the rAF tick zero-alloc in steady state (matches `must_haves.truths` line 42). Sub-atlas is evicted alongside the main atlas on theme/phosphor/zoom/DPR change.

4. **Is `basic-http-server` a better dev-serve recommendation than `python3 -m http.server` for Phase 3?**
   - **RESOLVED (2026-04-22):** No change from Phase 2. Python 3.12 `http.server` serves `.woff2` with correct MIME. Plan 04 Task 2 (human-verify checkpoint) includes a `curl -I` MIME confirmation step.

5. **Which of the 95 printable ASCII glyphs are high-risk hand-drawing targets?**
   - **RESOLVED (2026-04-22):** Plan 01 Task 1 documents the ambiguous-glyph priority list: `@ $ & ~ { } |`. Author draws visually-referenced from a 1600% zoomed `Mx437_IBM_VGA_8x16.ttf` render; binary is not copied. Glyph table ships as original creative work under the project's MIT/Apache-2.0 licence.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Playwright test runner | ✓ | 22.19.0 | — |
| npm | Install Playwright | ✓ | 10.9.3 | — |
| Chromium / Chrome | Dev + test browser | Presumed ✓ (dev environment) | ≥ 89 (for top-level await in ES modules — Phase 2 assumption) | — |
| wasm-pack | Phase 2 wasm build (prerequisite) | ✓ | 0.12.1 | — |
| Python 3 (for http.server) | Optional dev-serve | ✓ | 3.12.3 | `basic-http-server` (Rust single binary) |
| pyftsubset (fontTools) | Build-time WOFF2 subset | ✗ (need to verify) | — | Ship full JetBrains Mono WOFF2 (~200 KB — acceptable for v1; subset later) |
| JetBrains Mono TTF source | WOFF2 generation | ✗ (need to download from GitHub release) | ≥ 2.304 | — |
| Playwright | Visual regression | ✗ (needs `npm install`) | 1.51+ planned | Manual visual QA during Phase 3 verification |

**Missing dependencies with fallback:**
- pyftsubset: if not available, ship the full WOFF2 and note in SUMMARY that subset is a v1.x optimisation.
- Playwright: if install-step deferred (e.g., per plan scoping), rely on manual visual QA for Phase 3 and install Playwright in Phase 6 as part of the soak test.

**Missing dependencies with no fallback:** None. All blocking tooling is either present or trivially installable.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright 1.51+ (`@playwright/test`) — Chromium-only (matches project constraint) |
| Config file | `www/playwright.config.js` (to be created in Wave 0) |
| Quick run command | `npx playwright test --project=chromium --grep '@fast'` |
| Full suite command | `npx playwright test --project=chromium` |
| Rust tests | `cargo test -p bestialitty-core` — unchanged from Phase 1/2; Phase 3 adds no Rust changes |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RENDER-01 | 80×24 canvas grid renders printable ASCII | integration (Playwright screenshot) | `npx playwright test tests/render/grid-geometry.spec.js -g '80x24 paints printable ascii'` | ❌ Wave 0 |
| RENDER-02 | Block cursor visible at (row, col) | integration (screenshot w/ cursor mask) | `npx playwright test tests/render/cursor.spec.js -g 'block cursor visible'` | ❌ Wave 0 |
| RENDER-03 | Focus indicator changes on focus / blur | integration (pixel diff on border region) | `npx playwright test tests/render/focus.spec.js -g 'border changes on focus'` | ❌ Wave 0 |
| RENDER-04 | CRT theme bitmap + phosphor color + scanlines | integration (visual regression with baseline) | `npx playwright test tests/render/theme-crt.spec.js` | ❌ Wave 0 |
| RENDER-05 | Clean theme JetBrains Mono renders | integration (wait for fonts.ready + screenshot) | `npx playwright test tests/render/theme-clean.spec.js` | ❌ Wave 0 |
| RENDER-06 | Theme toggle switches canvas + chrome visuals | integration (click + screenshot diff) | `npx playwright test tests/render/theme-toggle.spec.js` | ❌ Wave 0 |
| RENDER-07 | Ctrl+Shift+T keyboard shortcut toggles theme | integration (keypress + state check) | `npx playwright test tests/render/keyboard.spec.js -g 'ctrl shift t'` | ❌ Wave 0 |
| RENDER-08 | Phosphor radio switches CRT palette | integration (click + visual diff) | `npx playwright test tests/render/phosphor.spec.js` | ❌ Wave 0 |
| RENDER-09 | Ctrl +/-/0 integer zoom scales grid | integration (keypress + canvas CSS dim check) | `npx playwright test tests/render/zoom.spec.js` | ❌ Wave 0 |
| RENDER-10 | HiDPI: canvas.width = cssWidth × deviceScaleFactor | unit + integration (check `canvas.width` attribute) | `npx playwright test tests/render/hidpi.spec.js` (with `deviceScaleFactor: 2`) | ❌ Wave 0 |
| RENDER-11 | BEL triggers 100ms overlay flash + `(!)` title when hidden | integration (feed BEL byte, check overlay opacity + title) | `npx playwright test tests/render/bell.spec.js` | ❌ Wave 0 |
| RENDER-12 | Per-theme cursor styling (CRT inverted-phosphor vs clean accent) | integration (visual diff of cursor cell across themes) | `npx playwright test tests/render/cursor-per-theme.spec.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx playwright test --project=chromium --grep '@fast'` (a few non-visual tests — Ctrl+Shift+T captured, cursor position correctness, canvas.width = dpr × cssWidth). Under 10 seconds.
- **Per wave merge:** `npx playwright test --project=chromium` full suite including visual-regression baselines. Under 60 seconds with Chromium pre-installed.
- **Phase gate:** Full suite green + human-verification demo of SC-1..SC-5 (similar cadence to Phase 2's HUMAN-UAT) before `/gsd-verify-phase 3`.

### Wave 0 Gaps

- [ ] `www/package.json` + `node_modules/` gitignored — Playwright bootstrap
- [ ] `www/playwright.config.js` — Chromium-only project, `deviceScaleFactor: 2` for HiDPI tests, `fullPage: false`, threshold config
- [ ] `www/tests/render/*.spec.js` — 12 spec files one per RENDER-XX requirement (many can share a spec file if cohesive)
- [ ] `www/tests/render/baselines/` — visual-regression baseline PNGs (generated on first run via `--update-snapshots`)
- [ ] `www/tests/fixtures/vt52-sample.bin` — small canned VT52 byte stream for deterministic screenshots (derived from `.planning/research/captures/capture-01-cpm-boot/bytes.bin`)
- [ ] Framework install: `cd www && npm init -y && npm install --save-dev @playwright/test && npx playwright install chromium`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in Phase 3 (static site, no accounts) |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No server, no access control |
| V5 Input Validation | yes (weak) | Phase 3 adds no new input surfaces; existing harness `parseHexEscapes` in `main.js` remains (tested). BEL overlay uses `classList.add` (not innerHTML). `textContent` used throughout (XSS-safe). No new user-text sinks. |
| V6 Cryptography | no | No crypto in Phase 3; no tokens, no signatures |
| V7 Error Handling | yes (weak) | Font-load failure is silently logged, not surfaced to user (intentional — `font-display: block` + fallback handles it). No stack traces leak. |
| V13 API & Web Services | no | Static site, no services |
| V14 Configuration | yes (weak) | `Permissions-Policy: serial=(self)` is Phase 5's concern; Phase 3's only configuration is CSS vars (no privilege implications). |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via grid content written to DOM | Tampering | Use `textContent` (never `innerHTML`) for any HTML sink. Canvas rendering is image-only — no HTML injection vector. `[CITED: Phase 2 main.js pattern]` |
| MicroBeast byte stream treated as HTML | Tampering | Bytes go to canvas glyph rasterisation, never to `.innerHTML`. Parser is pure Rust. |
| CSS injection via theme vars | Tampering | Theme values are hard-coded literals, not user-settable. When Phase 6 adds `localStorage` persistence, validate phosphor value against `'green' | 'amber' | 'white'` enum on read. |
| Font-file tampering | Tampering (low) | JetBrains Mono WOFF2 self-hosted (no CDN). On deploy, the file is served by the static host — integrity depends on the host's TLS/delivery. Not Phase 3's concern. |
| Canvas fingerprinting | Information disclosure | Not applicable — the user is the canvas "producer"; no cross-origin tracking vector. |
| Bell as audio-autoplay abuse | Denial of service (UX) | Audible bell is deferred to v2 (AUDIO-01). Visible bell has no user-hostile potential beyond a 100 ms flash. |

## Sources

### Primary (HIGH confidence)

- [MDN — Window.devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) — DPR change detection pattern, monitor-drag semantics
- [MDN — OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) — glyph atlas mechanics
- [MDN — CanvasRenderingContext2D.font](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font) — state reset on resize
- [MDN — Document.fonts (CSS Font Loading API)](https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts) — `document.fonts.ready`, `.load()`, `.check()`
- [MDN — CSS @font-face font-display](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display) — block vs swap semantics
- [MDN — Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) — visibilitychange, document.hidden
- [MDN — KeyboardEvent.code / .key](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent) — physical vs logical keys
- [web.dev — High DPI Canvas](https://web.dev/articles/canvas-hidipi) — canonical HiDPI canvas pattern
- [web.dev — Best practices for fonts](https://web.dev/articles/font-best-practices) — `font-display`, `document.fonts.ready`
- [VS Code blog — Terminal canvas renderer](https://code.visualstudio.com/blogs/2017/10/03/terminal-renderer) — glyph atlas performance case study (5-45× speedup)
- [JetBrains Mono on GitHub](https://github.com/JetBrains/JetBrainsMono) — OFL 1.1 licence confirmation
- [Chrome for Developers — Timer throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) — background-tab behaviour
- [Playwright docs — Visual comparisons](https://playwright.dev/docs/test-snapshots) — `toHaveScreenshot`, `deviceScaleFactor`
- [Playwright docs — Emulation](https://playwright.dev/docs/emulation) — `deviceScaleFactor` config
- [`.planning/research/ARCHITECTURE.md` §Pattern 3](/home/ant/src/microbeast/bestialitty/.planning/research/ARCHITECTURE.md) — dirty-row + glyph atlas spec
- [`.planning/research/PITFALLS.md` §Pitfall 5](/home/ant/src/microbeast/bestialitty/.planning/research/PITFALLS.md) — HiDPI blur root cause + fix
- [`.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md` D-01..D-03](/home/ant/src/microbeast/bestialitty/.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md) — grid view contract
- [`www/main.js` cached-view pattern](/home/ant/src/microbeast/bestialitty/www/main.js) — `cachedBuffer` identity guard that Phase 3 extends
- [`crates/bestialitty-core/src/lib.rs`](/home/ant/src/microbeast/bestialitty/crates/bestialitty-core/src/lib.rs) — wasm façade exports Phase 3 consumes
- [`.planning/phases/03-canvas-renderer/03-UI-SPEC.md`](/home/ant/src/microbeast/bestialitty/.planning/phases/03-canvas-renderer/03-UI-SPEC.md) — UI design contract

### Secondary (MEDIUM confidence)

- [xterm.js issue #935 — Implement a canvas renderer](https://github.com/xtermjs/xterm.js/issues/935) — canvas renderer architecture precedent
- [xterm.js @xterm/addon-canvas](https://www.npmjs.com/package/@xterm/addon-canvas) — production canvas-2D terminal renderer
- [DebugBear — Fixing Layout Shifts Caused by Web Fonts](https://www.debugbear.com/blog/web-font-layout-shift) — `font-display: block` layout implications
- [Chrome for Developers — Background tabs in Chrome 57](https://developer.chrome.com/blog/background_tabs) — rAF background-tab throttling history
- [PCjs Machines — IBM Monochrome Attributes](https://www.pcjs.org/blog/2018/11/15/) — IBM 5151 phosphor hex (`#09CC50`)
- [Wikipedia — IBM 5151](https://en.wikipedia.org/wiki/IBM_5151) — P39 phosphor reference
- [spacerace/romfont README](https://github.com/spacerace/romfont/blob/master/README.md) — IBM VGA font licensing ambiguity
- [int10h.org — Ultimate Oldschool PC Font Pack FAQ](https://int10h.org/oldschool-pc-fonts/readme/) — CC-BY-SA incompatibility with MIT/Apache-2.0
- [Playwright issue #36628 — deviceScaleFactor doesn't work with firefox](https://github.com/microsoft/playwright/issues/36628) — Chromium path is the one we use, validated as working
- [filamentgroup/glyphhanger docs](https://github.com/filamentgroup/glyphhanger/blob/master/docs/manual-subset.md) — WOFF2 subset tooling

### Tertiary (LOW confidence — flagged for validation)

- Phosphor RGB values `#33ff66` / `#ffb000` / `#e8e8d8` are researcher-picked from community-consensus ballpark ranges, not from a single authoritative retrocomputing spec. Acceptable as UI-SPEC locked these values already; confirm against real-hardware visual if user is unhappy.
- `document.fonts.ready` force-load pattern (`document.fonts.load(...)` before `document.fonts.ready`) — standard pattern in community blog posts; not explicitly called out in MDN as required, but MDN's ambiguity on "when does `.ready` actually fire for never-used fonts" justifies the defensive pattern.
- 530 ms blink cadence is "the classic DEC VT cadence" per CONTEXT D-07 — widely cited in retrocomputing forums but no single authoritative primary source. Matches xterm / gnome-terminal defaults.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Canvas 2D, OffscreenCanvas, CSS Font Loading API are all MDN/web.dev-verified
- Architecture: HIGH — ARCHITECTURE.md Pattern 3 + CONTEXT D-01..D-15 cover the design surface
- Pitfalls: HIGH — PITFALLS #5/#8 already catalogue HiDPI + font-load races; Phase 3 additions here are specific to atlas + CSS overlay + visibility timing
- Licensing: MEDIUM — IBM VGA font situation requires the hand-draw mitigation (CONTEXT already picked this path); JetBrains Mono is HIGH
- Validation (Playwright): MEDIUM — Playwright is the right tool but nothing is installed yet in the project; Wave 0 must bootstrap it

**Research date:** 2026-04-22
**Valid until:** ~2026-07-22 (90 days — Canvas 2D / OffscreenCanvas / CSS Font Loading APIs are mature and unlikely to move). Re-check Playwright version at plan time (it moves faster — quarterly releases typical).

---

*Phase 3 Canvas Renderer research — researched 2026-04-22 — ready for planner*
