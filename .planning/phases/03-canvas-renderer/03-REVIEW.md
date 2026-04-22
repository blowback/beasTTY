---
phase: 03-canvas-renderer
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - www/renderer/bitmap-font.js
  - www/renderer/themes.js
  - www/renderer/atlas.js
  - www/renderer/canvas.js
  - www/renderer/chrome.js
  - www/main.js
  - www/index.html
  - www/playwright.config.js
  - www/package.json
  - www/README.md
  - www/tests/render/hidpi.spec.js
  - www/tests/render/cursor.spec.js
  - www/tests/render/theme-toggle.spec.js
  - www/tests/render/phosphor.spec.js
  - www/tests/render/zoom.spec.js
  - www/tests/render/bell.spec.js
  - www/tests/render/focus.spec.js
  - www/tests/render/keyboard.spec.js
  - www/tests/render/grid.spec.js
findings:
  critical: 0
  warning: 5
  info: 7
  total: 12
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-04-22
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 3 ships a Canvas 2D renderer that replaces the Phase 2 `<pre>` harness.
The architectural split is clean — `canvas.js` contains only rendering logic,
`chrome.js` contains only DOM event wiring, and Web Serial remains absent from
the entire Phase 3 delivery (correct; reserved for Phase 5). The Rust/wasm
boundary in `canvas.js` (`rebuildViews` / `reDeriveViews`) is a faithful
port of the Phase 2 zero-copy contract. HiDPI is handled correctly via
`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` with no `ctx.scale` misuse
(RESEARCH Anti-Pattern respected). Atlas caching, primer, and shared-nonce
eviction all look correct.

The review surfaces five warnings — none are security-critical or crashing
bugs, but several are latent correctness issues that will bite once fixtures
land (Phase 4) or refresh rates diverge from 60 Hz. Seven info-level items
are mostly maintainability concerns.

The known gap G-03-04-01 (zero-length `gridView` snapshot at boot) is
documented in the SUMMARY and is NOT re-flagged here. However, one related
ordering issue in `tick()` is flagged below as WR-01 because it is a
distinct bug that persists even after G-03-04-01 is closed.

## Warnings

### WR-01: `reDeriveViews()` called BEFORE `snapshot_grid()`, but snapshot may grow memory

**File:** `www/renderer/canvas.js:212-232`
**Issue:** `tick()` calls `reDeriveViews()` at line 215, then calls
`term.snapshot_grid()` at line 225. If `snapshot_grid()` triggers a wasm
`memory.grow` (it allocates the mirror-grid on first call — see G-03-04-01
reproducer notes), every subsequent read through `dirtyView[r]` at line 229
and `gridView[i]` inside `paintRow`/`paintCursor` is against a detached
ArrayBuffer. Chromium throws `TypeError: Cannot perform %TypedArray%.prototype
on detached ArrayBuffer` and the rAF loop dies silently. This is a distinct
issue from G-03-04-01: closing the zero-length-view gap does not fix the
ordering. Any future wasm-side allocation during a tick (e.g. scrollback
growth in Phase 4) will resurrect this bug.
**Fix:**
```js
function tick() {
    rafPending = false;
    frameCount++;

    term.snapshot_grid();                  // do this FIRST; may grow wasm memory
    reDeriveViews();                       // now re-derive if buffer detached
    // Also guard against size-change inside the snapshot:
    if (gridView.byteLength !== term.grid_byte_len()) rebuildViews();

    const rows = term.rows();
    const cols = term.cols();
    for (let r = 0; r < rows; r++) {
        if (dirtyView[r] !== 0) paintRow(r, cols);
    }
    term.clear_dirty();
    paintCursor();

    if (canvasHasFocus || needsPaint) {
        needsPaint = false;
        requestFrame();
    }
}
```

### WR-02: Cursor blink rate is hard-coded to 60 Hz (`frameCount % 64`)

**File:** `www/renderer/canvas.js:191`
**Issue:** The blink uses `(frameCount % 64) < 32` to achieve ~530 ms period
at 60 fps. On 120 Hz displays this becomes ~265 ms; on 144 Hz, ~220 ms;
and when Chromium throttles rAF to 1 Hz (backgrounded tab), the blink
counter can drift into meaninglessness. D-07 specifies a 530 ms blink
regardless of refresh rate. The fix is to gate on wall-clock time.
**Fix:**
```js
// Near module state
let blinkStartMs = performance.now();
// ... in paintCursor()
const elapsed = performance.now() - blinkStartMs;
const blinkOn = (Math.floor(elapsed / 530) & 1) === 0;
if (!blinkOn) return;
```

### WR-03: `parseHexEscapes` off-by-one bound check reads one past end-of-string

**File:** `www/main.js:56-57`
**Issue:** The condition `i + 3 < input.length + 1` simplifies to
`i + 3 <= input.length`, which permits `charCodeAt(i + 3)` when
`i + 3 === input.length` — that is, one past the last valid index.
`charCodeAt` returns `NaN` out of range and `hexDigit(NaN)` returns `null`,
so this currently fails gracefully (no crash). But the intent is clearly
"need four characters remaining from position i", which is
`i + 3 < input.length` (equivalently `i + 4 <= input.length`). The bug is
latent today; any future change to `hexDigit` that doesn't null-guard
NaN would turn this into a crash.
**Fix:**
```js
if (ch === 0x5C /* \ */
    && i + 4 <= input.length
    && (input.charCodeAt(i + 1) === 0x78 || input.charCodeAt(i + 1) === 0x58)) {
```

### WR-04: `triggerBellFlash()` timeout has no cancel — rapid bells cut each other short

**File:** `www/renderer/canvas.js:359-364`
**Issue:** Each call schedules an unconditional
`setTimeout(() => el.classList.remove('flash'), 100)`. If two bells arrive
within 100 ms (entirely possible on a noisy serial port in Phase 5), the
first timeout fires and strips the `.flash` class mid-second-flash, causing
a visible mid-flash drop. Additionally, `setTimeout` handles pile up —
minor leak, but also a user-perceptible visual glitch. Track the pending
timeout ID and cancel-then-reset.
**Fix:**
```js
let bellFlashTimer = null;
export function triggerBellFlash() {
    const el = bellOverlayEl || document.getElementById('bell-overlay');
    if (!el) return;
    if (bellFlashTimer !== null) clearTimeout(bellFlashTimer);
    el.classList.add('flash');
    bellFlashTimer = setTimeout(() => {
        el.classList.remove('flash');
        bellFlashTimer = null;
    }, 100);
}
```

### WR-05: `paintRow` hardcodes `80 *` for the row-clear rect but loops over `cols`

**File:** `www/renderer/canvas.js:158,160`
**Issue:** Line 158 clears `80 * cellW` pixels wide (hardcoded 80), but
line 160 uses `cols` (from `term.cols()`) for the glyph loop. If the grid
is ever resized to a different column count — Phase 4 may bring this in
via terminal-resize negotiation, and the wasm `Terminal::new(24, 80, ...)`
constructor already takes `cols` as a parameter — the clear rect and the
glyph loop will diverge. Either clear based on `cols` or hoist a constant.
**Fix:**
```js
function paintRow(r, cols) {
    const z = activeZoom;
    const cellW = activeTheme.cellW * z;
    const cellH = activeTheme.cellH * z;
    const rast = makeRasteriserForTheme(activeTheme);

    ctx.fillStyle = activeTheme.bg;
    ctx.fillRect(0, r * cellH, cols * cellW, cellH);   // was: 80 * cellW

    for (let c = 0; c < cols; c++) { /* ... */ }
}
```

## Info

### IN-01: `paintRow` / `paintCursor` re-allocate rasteriser closure every tick

**File:** `www/renderer/canvas.js:154,205`
**Issue:** `paintRow` calls `makeRasteriserForTheme(activeTheme)` on every
row of every paint, and `paintCursor` calls `makeInvRasteriserForTheme`
every frame. Each call returns a fresh arrow-function closure — 24 + 1 =
25 closures per paint, ~1,500/sec at 60 fps. Harmless at this scale, but
the closures are purely state-dependent on `activeTheme` / `activeZoom` /
`activeDpr`, which already trigger `atlas.evict()` when they change.
Hoist a cached pair and invalidate them in `setTheme` / `setPhosphor` /
`zoomStep` / `resetZoom` / `watchDPR`. This also removes the last
per-frame allocation from the steady-state path.
**Fix:** Cache `currentRast` and `currentInvRast` at module scope; rebuild
inside the same sites that call `atlas.evict()`.

### IN-02: `if (ch === 0 || ch < 0x20)` does not guard against `undefined`

**File:** `www/renderer/canvas.js:164,200`
**Issue:** When `gridView[i]` is `undefined` (e.g. the G-03-04-01 zero-length
view, or any future bounds-miss), the check `ch === 0 || ch < 0x20` is
`false || (undefined < 0x20)` = `false || NaN-comparison` = `false || false`.
So `ch` remains `undefined`, gets passed to `atlas.get`, is coerced to `0`
by the bit-shift, and renders as the (blank) 0x00 glyph. This masks bugs
that should surface loudly. Defensive: `if (!ch || ch < 0x20 || ch > 0x7E)`
covers undefined, null, 0, sub-printable, and >DEL in one check.
**Fix:**
```js
let ch = gridView[i];
if (!ch || ch < 0x20 || ch > 0x7E) ch = 0x20;
```

### IN-03: `visibilitychange` handler strips `(!) ` prefix even when user put it there

**File:** `www/renderer/chrome.js:126-130`
**Issue:** `if (!document.hidden && document.title.startsWith('(!) '))`
blindly slices the prefix. If a future code path (or a misbehaving
embedding context) sets the title to something starting with `(!) ` for
an unrelated reason, this strips it on the next visibility flip. Use a
sentinel module-scope flag owned by `main.js`'s `sampleBell()` instead
of pattern-matching title text.
**Fix:** Export a `hasBellPrefix` flag from `main.js` (or move the
visibilitychange listener there entirely) so the stripping is gated on
"we set this" rather than "it looks like we set this".

### IN-04: Atlas key could be built once per (theme, phosphor, zoom, dpr) batch

**File:** `www/renderer/atlas.js:36,51`
**Issue:** `(ch << 24) | ((fg & 0xFF) << 16) | ((this.nonce & 0xFF) << 8) | (zoom & 0xFF)`
computed on every `get` / `getInverted`. `fg` / `nonce` / `zoom` are all
stable for the entire paint tick. Minor micro-opt; noting only because
RESEARCH §Pitfall 6 flags per-cell work as the first target when scaling
beyond 80×24.

### IN-05: No CSP meta tag on `index.html`

**File:** `www/index.html:1-195`
**Issue:** Static-site deployment with inline `<style>`, `<script type="module">`,
and `woff2` fetch. No Content-Security-Policy meta. For a Chromium-only
daily-driver tool that accepts raw bytes from a USB serial port and
projects them onto a canvas, an explicit CSP
(`default-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'`)
would be belt-and-braces. Not a v1 blocker per CLAUDE.md scope, but
cheap insurance before public deploy.

### IN-06: `document.fonts.load` failure path logs but doesn't signal clean-theme degradation

**File:** `www/renderer/canvas.js:269-275`
**Issue:** If `document.fonts.load('14px "JetBrains Mono"')` rejects
(e.g. offline, missing file, Cloudflare 404), the code warns via
`console.warn` and continues. The clean theme then renders in fallback
monospace, silently violating SC-1 ("no font-loading flash"). Consider
either (a) disabling the clean-theme affordance in the top-bar when the
font failed, or (b) logging to a user-visible error row.

### IN-07: `bitmap-font.js` license claim is not cross-referenced in a third-party audit

**File:** `www/renderer/bitmap-font.js:7-12`
**Issue:** The header asserts "ORIGINAL creative work ... no bytes were
copied verbatim from any IBM VGA ROM, spacerace/romfont, VileR's Ultimate
Oldschool PC Font Pack". This is a legal claim, and the reviewer has no
way to verify it — comparing 2048 bytes against every published 8×16 VGA
font distribution is out of scope for a code review. Recommend committing
a one-paragraph provenance note in `assets/fonts/LICENSE-bitmap-font.txt`
(or similar) that records the authoring process (date, tool, pixel-art
editor, approximate hours) so the claim has an audit trail.

---

_Reviewed: 2026-04-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
