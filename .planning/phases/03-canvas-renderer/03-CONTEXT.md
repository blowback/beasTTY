# Phase 3: Canvas Renderer - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Render the Phase 2 zero-copy grid view onto an HTML `<canvas>` with two themes
(CRT + clean), a visible block cursor, user-selectable phosphor color in CRT,
keyboard-only integer font-size zoom, visible-bell screen flash + background-tab
title indicator, and HiDPI-safe output. Drive painting from the Phase 2
`snapshot_grid` → `pack_ptr` zero-copy `Uint8Array` view, repainting only
dirty rows.

**In scope:** www/renderer/canvas.js (rAF loop, dirty-row repaint, HiDPI
sizing, cursor rendering), www/renderer/atlas.js (per-(ch, fg, theme) glyph
cache over OffscreenCanvas), www/renderer/themes.js (CRT + clean theme
descriptors, phosphor palette), www/renderer/bitmap-font.js (hand-drawn
8x16 ASCII glyph Uint8Array table), www/assets/fonts/jetbrains-mono-*.woff2
self-hosted, a minimal top-bar chrome (theme toggle button + phosphor
selector visible only in CRT), focus-indicator border on the canvas
container, Ctrl+Shift+T / Ctrl +/−/0 keyboard shortcuts, BEL-triggered CSS
overlay flash + `document.hidden`-aware title prefix, retirement of the
pre-text `<pre>` grid + dirty readout, relocation of the Phase 2 textarea +
Feed + 64 KB Stress into a collapsible Debug section below the canvas.

**Out of scope:** Keyboard input → wasm key encoding (Phase 4), Web Serial
(Phase 5), copy/paste (Phase 6), scrollback UI (Phase 6), localStorage
persistence of theme/phosphor/zoom (Phase 6 — PREF-01), scanline/phosphor
intensity slider (v2-RENDER-01), VT52 graphics-mode glyphs (v2-RENDER-02),
phosphor *glow* / bloom / shader effects, font color customisation beyond
the three phosphor presets, any change to the Phase 1 Rust core or
Phase 2 wasm boundary (the renderer consumes D-01..D-03 verbatim).

</domain>

<decisions>
## Implementation Decisions

### Font strategy

- **D-01:** CRT theme bitmap font is a **hand-drawn 8×16 ASCII glyph table**
  shipped as a `Uint8Array` (128 glyphs × 8 bytes = ~1 KB before code; ~4 KB
  with module wrapper) in `www/renderer/bitmap-font.js`. Each glyph is 8 bits
  wide × 16 rows tall, MSB-left. Sourced from a public-domain 8×16 ROM
  (IBM VGA ROM font is the standard reference — MIT-compatible). Zero network
  fetch; zero font-loading flash; pixel-perfect scaling via integer
  multipliers.
- **D-02:** Clean theme font is **JetBrains Mono Regular**, self-hosted as a
  subset WOFF2 at `www/assets/fonts/jetbrains-mono-regular.woff2`, declared
  via `@font-face` with `font-display: block` (wait up to 3 s, then fall
  back to `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`).
  `block` over `swap` specifically to satisfy ROADMAP SC-1 — "no
  font-fallback flash on first paint". No CDN. No Google Fonts.
- **D-03:** **One unified glyph atlas** caches `(ch, fg, theme)` →
  `OffscreenCanvas` pre-rasterised tiles. Two rasteriser functions sit
  behind it: `rasteriseBitmap(ch, fg)` blits the 8×16 `Uint8Array` row
  patterns into an OffscreenCanvas at the current zoom multiplier;
  `rasteriseVector(ch, fg)` uses `ctx.fillText` with JetBrains Mono. Dirty-row
  repaint + `drawImage` loop is shared across both. **Atlas is evicted on
  theme change, phosphor change, or zoom change** — three coarse-grained
  invalidation events, each infrequent.

### Theme architecture

- **D-04:** Themes are defined as **plain JS object descriptors** in
  `www/renderer/themes.js`, exporting a `THEMES` map keyed by name
  (`"crt"` and `"clean"`). Each descriptor carries `{fg, bg, accent, font,
  rasteriser, cellW, cellH, baseline, cursor: {shape, blink, fgColor,
  bgColor}, bellFlash: {cssVar}, scanlines: boolean, phosphorSlots?}`.
  Switching themes is a single reference swap + `atlas.evict()`. Zero CSS
  coupling for the canvas itself; tiny CSS helpers exist only for the
  overlay chrome (top bar, bell overlay, focus border).
- **D-05:** **CRT theme has a nested `phosphorColor: 'green' | 'amber' | 'white'`**
  enum (D-08 requirement), with three pre-computed `{fg, bg, accent}`
  palettes. Switching phosphor is a sub-field update + atlas evict — not
  a full theme swap. Clean theme has no phosphor concept.
- **D-06:** Selected theme, phosphor, and zoom **live as module-local JS
  state** in the renderer — no `localStorage` persistence in Phase 3.
  Reloading the page resets to the default (CRT / green / 1×). Phase 6
  (PREF-01) is the phase that adds localStorage. Explicitly avoiding
  duplication.

### Cursor

- **D-07:** **Block cursor, blink ON when focused (530 ms rate — classic
  DEC VT cadence, matches xterm/gnome-terminal), steady outlined block
  when blurred.** Both themes use a block shape; fg/bg colors differ per
  theme (CRT: inverted phosphor; clean: accent color swapped with bg).
  The blink phase is advanced by the rAF render loop (`frameCount % N` →
  on/off toggle) — no CSS animation, no separate timer, no work when the
  canvas isn't being repainted.

### Bell & background indicator

- **D-08:** **BEL is rendered as a CSS overlay div** (`position: absolute`,
  covers the canvas, `pointer-events: none`) with opacity pulsed via a
  CSS transition: `opacity: 0.7` on BEL, then transition back to `0`
  over ~100 ms. The overlay's background color is a CSS variable
  (`--bell-flash`) set per theme. Zero canvas damage, zero atlas
  eviction, theme-aware, decoupled from the render loop.
- **D-09:** **`(!)` title-bar prefix is appended ONLY when `document.hidden`
  is true at the moment BEL fires.** A `visibilitychange` listener clears
  the prefix when the tab returns to the foreground (`document.hidden ===
  false`). Exact mechanism: track an in-flight `hasPendingBell` boolean,
  set title to `"(!) " + originalTitle` on BEL-while-hidden, reset to
  `originalTitle` on visibility change. Matches ROADMAP SC-3 wording
  "title-bar indicator on background tabs".

### Zoom

- **D-10:** **Integer multipliers 1×–4×**, adjusted exclusively via
  keyboard: `Ctrl +` grows by 1 (capped at 4), `Ctrl −` shrinks by 1
  (floored at 1), `Ctrl 0` resets to 1. **No UI button** — honors
  ROADMAP SC-3 wording "font size zoom via Ctrl +/−/ Ctrl 0". Default is
  1× on both HiDPI and non-HiDPI displays (DPR handles crispness, zoom
  handles real-estate). Zoom change evicts the atlas and rebuilds cached
  tiles at the new pixel dimensions.

### CRT aesthetics

- **D-11:** **Fixed subtle scanlines, no slider, no glow.** Scanlines
  are a CSS `linear-gradient` on a second overlay div
  (`background: repeating-linear-gradient(0deg, transparent 0px,
  transparent 1px, rgba(0,0,0,0.15) 1px, rgba(0,0,0,0.15) 2px)`),
  active only when `THEMES.crt` is selected. v2-RENDER-01 (slider)
  stays v2. No phosphor glow — `shadowBlur` / `text-shadow` would kill
  per-glyph rasterisation budget and require a compositing pass we do
  not need for v1.

### Canvas chrome

- **D-12:** **Minimal top bar above the canvas**: one theme-toggle button
  ("CRT" / "Clean" label showing the *other* theme — click switches to
  it), one 3-way phosphor selector (radio-group or segmented control:
  green / amber / white) that is **visible only when the CRT theme is
  active** (hidden via `display:none` in clean theme). Zoom stays
  keyboard-only. No status line, no cursor-position readout, no bell
  toggle — those are Phase 2 harness concerns, not daily-driver chrome.
- **D-13:** **Focus indicator = 1 px theme-accent border on the canvas
  wrapper div** when the canvas has focus + cursor blink ON (D-07).
  Blurred state = 1 px *transparent* border of the same width (so layout
  doesn't reflow) + steady outlined block cursor. Accent color differs
  per theme (CRT: phosphor-color; clean: a neutral theme accent).
  Matches RENDER-03 "border or cursor-style change".
- **D-14:** **Theme toggle keyboard shortcut is `Ctrl+Shift+T`** per the
  ROADMAP SC-2 example. Wired via a keydown listener on the canvas
  container that calls `preventDefault()` — this recaptures the key
  even though Chromium's default "reopen closed tab" takes priority
  when focus is elsewhere.

### Phase 2 harness

- **D-15:** **The pre-text `<pre id="grid">` + `<pre id="dirty">` + status
  span are removed** (the canvas replaces them). **The textarea +
  "Feed" + "64 KB Stress" buttons move behind a collapsible `<details>`
  element labelled "Debug"** positioned below the canvas. Purpose: keep
  the Phase 2 SC-4 64 KB stress test and the hex-escape Feed path
  runnable for demonstrations until Phase 5 replaces the feed source
  with Web Serial. Default-collapsed so the page looks like a clean
  terminal on load.

### Claude's Discretion

- Exact CRT phosphor palette RGB values (green/amber/white triplets) —
  Claude picks period-authentic values (e.g., DEC VT220 green, Wyse
  amber, IBM MDA white) researched during planning.
- Which specific public-domain 8×16 ROM the bitmap font is drawn from
  (IBM VGA, Amiga Topaz, EGA). License must be clearly public domain
  or MIT/Apache-2.0 compatible. If Claude can't find a clean source,
  hand-draw the 128 printable ASCII glyphs directly.
- Cell size multiplier at 1× zoom (if CRT font is 8×16 native, does
  "1×" mean 8×16 CSS pixels or 16×32?). Needs to satisfy "readable at
  80×24 on typical laptop without squinting" (FEATURES.md) — Claude
  picks after prototyping.
- Exact CSS for the top-bar chrome (layout, spacing, typography) —
  as long as it's minimal and theme-consistent.
- Whether OffscreenCanvas is used in a Worker (not needed for 80×24
  budget) or in the main thread (simpler; sufficient).
- How the theme-toggle button's label updates when theme switches
  (React-style re-render vs direct `.textContent` mutation) — JS shell
  is framework-free, so direct DOM is the default.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & requirements
- `.planning/PROJECT.md` — Chromium-only, Rust-core/JS-shell split, daily-driver target, ship both CRT and clean themes in v1
- `.planning/REQUIREMENTS.md` §RENDER-01..RENDER-12 — full acceptance criteria for this phase
- `.planning/REQUIREMENTS.md` §v2-RENDER-01, §v2-RENDER-02 — explicitly deferred work (scanline slider; graphics-mode glyphs)
- `.planning/ROADMAP.md` §"Phase 3: Canvas Renderer" — goal, depends_on, five success criteria

### Architecture & boundary
- `.planning/research/ARCHITECTURE.md` §"Pattern 3: Dirty-Row Repaint with Glyph Atlas" — locks Canvas 2D + per-(ch,fg,bg) atlas + dirty-row repaint + rAF
- `.planning/research/ARCHITECTURE.md` §"Recommended Project Structure" — `www/renderer/{canvas.js, atlas.js, themes.js}` layout
- `.planning/research/PITFALLS.md` §"Pitfall 5: Canvas Rendering Goes Blurry on HiDPI" — DPR-aware backing store + CSS size separation; MUST be honored for RENDER-10
- `.planning/research/PITFALLS.md` §"Pitfall 2: Escape Sequence Split Across Chunk Boundaries" — not directly about rendering, but confirms the renderer never interprets bytes; it only reads grid cells

### Feature baseline
- `.planning/research/FEATURES.md` §"Baseline daily-driver essentials" — block cursor, bell handling, focus indicator, 80×24 fixed geometry, readable default font
- `.planning/research/FEATURES.md` §"Differentiators" — per-theme cursor, keyboard-shortcut theme toggle, phosphor color choice, font-size zoom, visible-bell flash — these ARE the Phase 3 spec

### Upstream decisions consumed by this phase
- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md` §decisions D-01..D-03 — `pack_ptr` zero-copy grid view + `snapshot_grid()` contract + invalidate-only-on-resize rule
- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-06-SUMMARY.md` — cached-view pattern (`cachedBuffer` identity guard) the renderer extends; deferred-sources rationale for pre-text harness retirement
- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-VERIFICATION.md` — SC-3 amended contract; Phase 3 inherits the "wasm-boundary zero-alloc" expectation and kills the pre-text allocation sources (#2, #3, #5) by replacing the pre-text grid

### Architecture decisions (ADRs)
- `.planning/decisions/ADR-001-parser-strategy.md` — vte-based parser (no rendering impact, context only)
- `.planning/decisions/ADR-002-wasm-gating.md` — `#[cfg(target_arch = "wasm32")]` gating of lib.rs (no rendering impact, context only)

### Capture data (optional but useful for visual test fixtures)
- `.planning/research/captures/capture-01-cpm-boot/` — real MicroBeast byte stream for SC-1 rendering demo
- `.planning/research/captures/capture-02-basic/` — additional test fixture

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `www/main.js:40-55` — existing `let cachedBuffer` + `rebuildViews()` +
  `reDeriveViews()` pattern. The Phase 3 renderer extends this: same
  guard, just adds `cellsView` over `pack_ptr` and re-derives on theme
  / phosphor / zoom change (which don't swap the buffer but do invalidate
  atlas tiles).
- `www/main.js:126-170` — working Feed / 64 KB Stress click handlers +
  `parseHexEscapes` + hex-escape textarea parsing. These move into the
  Debug `<details>` section mostly as-is; the renderAscii/renderDirty
  paths go away.
- `crates/bestialitty-core/src/lib.rs` wasm façade — already exports
  `snapshot_grid`, `grid_ptr`, `grid_byte_len`, `dirty_ptr`, `rows`,
  `cols`, `clear_dirty`, `bell_pending`, `clear_bell`, `cursor_packed`,
  `host_reply_ptr/len/clear`. Phase 3 consumes these verbatim; **no
  boundary additions are needed**.
- `Cell` layout: `#[repr(C)]` 8-byte struct with `ch: u32, fg: u8,
  bg: u8, flags: u8, pad: u8` — compile-time pinned by assertions in
  `grid.rs`. JS reads row-major `pack_buf` as a stride-8 `Uint8Array`.

### Established Patterns
- **Module-scope cached Uint8Array views with buffer-identity guard**
  (Phase 2 D-03 + 02-06): Phase 3 renderer MUST continue this. All
  canvas-render hot-path reads go through `gridView` / `dirtyView`,
  re-derived only on `wasm.memory.buffer` replacement.
- **Single boundary call per user action** (Pitfall 4): one `feed()`
  per serial chunk, one `snapshot_grid()` per frame; no per-byte or
  per-cell calls.
- **Framework-free JS** (PROJECT.md + Phase 2 D-14): no React, no Vue,
  no bundler. Vanilla ES modules, DOM APIs, CSS. Phase 3 continues this
  posture.
- **Pure-Rust core rule** (PROJECT.md + Phase 2 D-06/D-07): renderer is
  entirely JS — no Rust changes in Phase 3.

### Integration Points
- `www/index.html` — replace `<pre id="grid">` + `<pre id="dirty">` +
  `#status` with `<div id="terminal-wrapper"><div id="top-bar">...</div>
  <canvas id="terminal"></canvas><div id="bell-overlay"></div>
  <div id="scanlines"></div></div>` plus the collapsible Debug `<details>`
  below. `<style>` block gets CSS variables for theme colors + the
  `@font-face` declaration.
- `www/main.js` — retains the existing `import init, { Terminal }` +
  `await init()` + `cachedBuffer` guard; replaces the `renderAscii` /
  `renderDirty` functions with a call into the new `renderer/canvas.js`
  rAF loop.
- `www/renderer/*.js` — **new directory** for `canvas.js`, `atlas.js`,
  `themes.js`, `bitmap-font.js`. Imported by `main.js` as ES modules.
- `www/assets/fonts/jetbrains-mono-regular.woff2` — **new asset**,
  self-hosted, subset to printable ASCII + box-drawing only (the VT52
  pragmatic subset).
- `www/.gitignore` already ignores `pkg/`; `www/assets/fonts/*` stays
  tracked.

</code_context>

<specifics>
## Specific Ideas

- CRT cursor should feel like a DEC VT100 block cursor — inverted
  phosphor, 530 ms blink when focused (the exact "breathing" cadence
  the user remembers from real hardware), steady outlined block when
  blurred.
- Clean theme aesthetic is "modern JetBrains/iTerm" — minimal chrome,
  no skeuomorphism, block cursor in accent color, no scanlines, no
  glow.
- CRT scanlines should be subtle enough to use for hours without
  eye strain. A ~15% opacity every-other-line CSS gradient is the
  target — not the heavy "Fallout terminal" aesthetic.
- Phosphor colors: green ≈ DEC VT220 P1 phosphor (#33ff66 ballpark),
  amber ≈ IBM 5151 / Wyse amber (#ffb000 ballpark), white ≈ IBM MDA
  P4 phosphor (#e8e8e8 slightly warm). Claude finalises during planning.
- Top bar is the ONLY chrome. No right sidebar, no bottom status bar,
  no floating help button. Canvas fills the viewport vertically below
  the top bar with the 80×24 grid centred.

</specifics>

<deferred>
## Deferred Ideas

- **Scanline/phosphor intensity slider** — explicitly v2 (v2-RENDER-01).
  Not part of Phase 3 scope.
- **VT52 graphics-mode glyphs** (ESC F / ESC G math fractions, scan
  lines) — explicitly v2 (v2-RENDER-02). Phase 1 parser already
  no-ops these; Phase 3 does not render them.
- **Phosphor glow / bloom effects** — considered and rejected for
  v1 cost/benefit. Revisit in v2 if WebGL rewrite happens.
- **Custom phosphor color picker** (arbitrary hex) — considered and
  rejected. Three named presets (green/amber/white) match RENDER-08
  exactly; arbitrary hex is scope creep.
- **Audible bell** — FEATURES.md flags as default-OFF differentiator;
  deferred to at least Phase 6. Phase 3 only handles the visible bell.
- **Cursor-style user preference** (block vs underline vs bar) — v1
  cursor is block per theme (D-07). User-selectable cursor shape is
  not in any v1 requirement; add to v2 backlog if requested.
- **Font-size fractional zoom** — rejected (D-10). Would break
  pixel-perfect bitmap scaling. Integer-only.
- **UI zoom buttons** — rejected (D-10). Keyboard-only per SC-3.
- **localStorage persistence** — explicitly Phase 6 (PREF-01). Do not
  implement in Phase 3.
- **Selection / copy on canvas** — Phase 6 (SESS-01). Phase 3 canvas
  does not need mouse-event plumbing.

</deferred>

---

*Phase: 03-canvas-renderer*
*Context gathered: 2026-04-22*
