---
phase: 03-canvas-renderer
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - www/renderer/canvas.js
  - www/renderer/atlas.js
  - www/main.js
  - www/renderer/chrome.js
  - www/index.html
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
status: issues_found
---

# Phase 3: Code Review Report (Gap-Closure)

**Reviewed:** 2026-04-22
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found (2 warning, 6 info)

## Summary

Gap-closure review for phase 03 plans 03-05 (renderer correctness), 03-06
(chrome wiring), and 03-07 Rule-1 auto-fix (paintCursor blink-off repaint).
The five files under review constitute the JS shell surface (renderer,
atlas, chrome wiring, boot driver, HTML scaffold) and contain no business
logic that belongs in the Rust core — the architecture split is respected.

Specific deltas all look correct and defensive:

- `canvas.js`: the wall-clock cursor blink via `performance.now()` with a
  530 ms gate is sound; snapshot-first `tick()` ordering with the
  size-delta rebuild guard closes the G-03-04-01 boot-path hazard;
  `markAllRowsDirty()` is called on every path that evicts the atlas; the
  same-value short-circuit guards in `setTheme` / `setPhosphor` correctly
  prevent wasted full-grid repaints; the cancellable `bellFlashTimer`
  correctly handles overlapping bell events; the `paintCursor` blink-off
  repaint (cell bg + glyph) is the minimal correct fix for the "cursor
  stuck on" regression.
- `atlas.js`: the 2x vertical bitmap scale is derived from `cellW / cellH`
  vs the fixed 8x16 source, which is future-proof and avoids hard-coding
  `z`.
- `main.js`: the `parseHexEscapes` off-by-one fix
  (`i + 4 <= input.length`) is correct — when `i = input.length - 4`, the
  last index read is `i + 3 = input.length - 1`.
- `chrome.js`: the Ctrl+Alt+T remapping with `!e.shiftKey && !e.metaKey`
  guards against the Alt+Shift+T "pin tab" collision; `data-focused`
  attribute management is symmetric across focus/blur listeners.
- `index.html`: the attribute-driven focus border
  (`[data-focused="true"]`) correctly bypasses Chromium's
  `:focus-visible` keyboard-only heuristic, which is the stated reason
  for the change.

Findings below are secondary observations, not blockers on the three
gap-closure plans. No Critical issues found. The two Warnings are
defensive-hardening opportunities; the six Info items are
style / consistency notes.

## Warnings

### WR-01: paintCursor does not bounds-check cursor row/col before indexing gridView

**File:** `www/renderer/canvas.js:189-212`
**Issue:** `paintCursor()` reads `term.cursor_packed()` and unpacks it
into `row` and `col`, then computes
`const i = (row * term.cols() + col) * CELL_SIZE` and reads
`gridView[i]`. There is no assertion that `row < term.rows()` or
`col < term.cols()`. If the Rust side ever emits an out-of-range cursor
position (bug upstream, or transient during a resize), `gridView[i]`
returns `undefined`, and the subsequent `ch === 0 || ch < 0x20` test
evaluates to `false` for `undefined` (because `undefined === 0` is false
and `undefined < 0x20` is false, since NaN comparisons return false).
`ch` then stays `undefined`, propagates into `atlas.get(ch, 1, rast, z)`
where it is used as a Map key (works — `undefined` is a valid key) and
in `ch & 0x7F` inside `rasteriseBitmap` (coerces `undefined` to `NaN`,
then to `0` via the bitwise op — draws glyph 0). The visible symptom
would be a cursor painted over an all-zero-byte glyph at position (0,0)
of the bitmap table, which is blank. Not a crash, but silent data
corruption that would mask an upstream bug.
**Fix:** Add a defensive bounds check early in `paintCursor`:
```javascript
const rows = term.rows();
const cols = term.cols();
if (row >= rows || col >= cols) return;   // upstream invariant violation
const i = (row * cols + col) * CELL_SIZE;
```
Using the locally cached `cols` also avoids the redundant second
`term.cols()` wasm call on the hot path.

### WR-02: watchDPR re-registers without releasing prior MediaQueryList reference

**File:** `www/renderer/canvas.js:116-126`
**Issue:** Each invocation of `watchDPR()` allocates a fresh
`MediaQueryList` via `window.matchMedia(...)` and registers a
`{ once: true }` `change` listener on it. After the listener fires, the
callback recursively calls `watchDPR()` again, allocating another MQL.
The `{ once: true }` option auto-removes the listener, but the MQL
object itself is not explicitly released. The arrow-function closure
inside `addEventListener` captures `atlas`, `markAllRowsDirty`,
`resizeToTheme`, `requestFrame`, and recursively `watchDPR` itself, so
every MQL retains a sizeable closure chain until GC. Over hundreds of
DPR changes (pathological — e.g., a user dragging between three
monitors) this can momentarily pin multiple closures. Not a leak in
practice because Chromium will GC once unreferenced, but flagging as
hardening for the multi-monitor-drag edge case.
**Fix:** Promote the MQL to module-level state and reuse it across
registrations:
```javascript
let dprMql = null;
function watchDPR() {
    if (dprMql) dprMql.onchange = null;
    dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMql.addEventListener('change', () => {
        if (atlas) atlas.evict();
        markAllRowsDirty();
        resizeToTheme();
        needsPaint = true;
        requestFrame();
        watchDPR();
    }, { once: true });
}
```

## Info

### IN-01: Stale "Ctrl+Shift+T" comment after chord remap to Ctrl+Alt+T

**File:** `www/renderer/chrome.js:140`
**Issue:** The comment above `terminalWrapper.focus()` at boot reads
`"Auto-focus the wrapper at boot so cursor blinks and Ctrl+Shift+T works
immediately."` — but the chord was deliberately remapped to Ctrl+Alt+T
(per the detailed comment at lines 77-85). The stale comment will
mislead future readers.
**Fix:** Replace `Ctrl+Shift+T` with `Ctrl+Alt+T` in the comment at
line 140.

### IN-02: Title-prefix string duplicated between main.js and chrome.js

**File:** `www/renderer/chrome.js:135-137` and `www/main.js:127`
**Issue:** `main.js` defines `const TITLE_PREFIX = '(!) ';` and uses it
to prepend to `document.title`. `chrome.js` line 135 hardcodes the
literal `'(!) '` in `document.title.startsWith('(!) ')` and line 136
uses `document.title.slice(4)` (magic number 4 = length of `'(!) '`).
Any future change to the prefix (e.g., to `'[BELL] '`) requires edits in
two files with different magic numbers, which is error-prone.
**Fix:** Export `TITLE_PREFIX` from a shared module (a new
`www/renderer/constants.js`, or inline into `chrome.js` since it is the
consumer of the strip-prefix half and re-import into main.js) and use
`.slice(TITLE_PREFIX.length)`.

### IN-03: paintCursor makes a redundant `term.cols()` wasm call per frame

**File:** `www/renderer/canvas.js:210`
**Issue:** `paintCursor()` calls `term.cols()` to compute the gridView
index. `tick()` already captured `cols` in a local at line 272 but does
not pass it to `paintCursor()`. Each wasm-boundary call is cheap but not
free; on a 120 Hz monitor in focused state this runs 120 times per
second. Minor — listed for consistency with the pattern used in
`paintRow`, which takes `cols` as a parameter.
**Fix:** Either pass `cols` as a parameter to `paintCursor(cols)` or
accept the redundancy and add a comment. Parameter-passing keeps the
wasm-boundary call count bounded and matches the `paintRow(r, cols)`
signature.

### IN-04: triggerBellFlash does not memoise the fallback element lookup

**File:** `www/renderer/canvas.js:419`
**Issue:** Line 419 falls back to
`document.getElementById('bell-overlay')` when `bellOverlayEl` is null.
On a fallback hit, the resolved element is not cached back into
`bellOverlayEl`, so every subsequent bell flash during a session that
missed the boot-time lookup pays the `getElementById` cost again. Minor
— bells are rare — but the idiom is inconsistent with typical lazy-init
patterns.
**Fix:**
```javascript
const el = bellOverlayEl || (bellOverlayEl = document.getElementById('bell-overlay'));
if (!el) return;
```

### IN-05: main.js assumes chrome elements exist; throws opaque TypeError on null

**File:** `www/main.js:41-46`
**Issue:** `document.getElementById('phosphor-group')` returns `null`
if the element is missing; the next line
`phosphorGroup.querySelectorAll(...)` then throws
`TypeError: Cannot read properties of null (reading 'querySelectorAll')`,
which is an opaque error for anyone debugging a partial DOM (e.g., a
template-forked index.html). `bootRenderer` already has a clear
error-message path for `<canvas id="terminal">` missing
(canvas.js:305); the chrome wiring lacks the equivalent.
**Fix:** Add explicit guards before dereferencing:
```javascript
const terminalWrapper = document.getElementById('terminal-wrapper');
const themeButton     = document.getElementById('theme-toggle');
const phosphorGroup   = document.getElementById('phosphor-group');
const bellOverlay     = document.getElementById('bell-overlay');
if (!terminalWrapper) throw new Error('[main] #terminal-wrapper missing');
if (!themeButton)     throw new Error('[main] #theme-toggle missing');
if (!phosphorGroup)   throw new Error('[main] #phosphor-group missing');
const phosphorButtons = phosphorGroup.querySelectorAll('button[data-phosphor]');
```

### IN-06: Bitmap rasteriser leaves unused parameter `z` in signature

**File:** `www/renderer/atlas.js:85`
**Issue:**
`rasteriseBitmap(ch, fgColor, bgColor, cellW, cellH, z, dpr)` takes `z`
as a parameter but derives the scale from `cellW / cellH` instead
(lines 101-102), making `z` effectively dead. The comment at lines
82-84 notes this is intentional for "call-site compatibility" but the
parameter still shows up to linters/IDEs as unused and invites reader
confusion about which source of truth determines scale.
**Fix:** Remove `z` from the signature and update both call sites in
`canvas.js` (`makeRasteriserForTheme` and `makeInvRasteriserForTheme`
at lines 134 and 149), or rename to `_z` to signal intentional non-use.
The first option is cleaner since the callers construct closures that
pass `z` anyway — no external contract is broken.

---

_Reviewed: 2026-04-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
