---
phase: 03-canvas-renderer
plan: 05
subsystem: ui
tags: [renderer-correctness, canvas, atlas, blink, snapshot-ordering, hidpi, gap-closure]

# Dependency graph
requires:
  - phase: 03-canvas-renderer
    provides: canvas.js rAF loop, atlas.js dual-cache, main.js harness + bell sampling (Plans 03-01..03-04)
provides:
  - "Wall-clock 530 ms cursor blink in canvas.js paintCursor() (independent of rAF throttling and monitor refresh rate)"
  - "Snapshot-first tick() ordering + grid_byte_len() size-delta guard so first-snapshot memory.grow never leaves gridView detached (closes G-03-04-01)"
  - "markAllRowsDirty() helper called from setTheme / setPhosphor / zoomStep / resetZoom / watchDPR — canvas content preserved across theme/phosphor/zoom/DPR changes"
  - "Same-value short-circuit guards in setTheme and setPhosphor — identity-click is a no-op (no atlas evict, no repaint flicker)"
  - "rasteriseBitmap derives per-pixel scale from cellW/cellH vs 8×16 source geometry so 8×16 glyph fills the 16×32 cell at any zoom (closes Test 14)"
  - "Cancellable bell-flash timer (clearTimeout on re-entry) — WR-04 fold"
  - "paintRow clears row-band using cols * cellW (not hard-coded 80 * cellW) — WR-05 fold"
  - "parseHexEscapes bound tightened to i + 4 <= input.length — WR-03 fold, behaviour byte-identical"
affects: [03-06-PLAN, 03-07-PLAN, 04-keyboard-input, 05-web-serial-transport]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wall-clock blink gating via performance.now() + (Math.floor(elapsed / 530) & 1) === 0"
    - "Snapshot-first rAF tick: term.snapshot_grid() BEFORE reDeriveViews() to survive wasm memory.grow detach"
    - "Size-delta view rebuild: rebuildViews() when gridView.byteLength !== term.grid_byte_len()"
    - "Post-evict full-grid invalidation via markAllRowsDirty() — paired with every atlas.evict() call site"
    - "Same-value short-circuit at the top of setTheme/setPhosphor — identity-click = no-op"
    - "Bitmap rasteriser derives scale from cellW/cellH vs fixed 8×16 source (not from `z` parameter)"

key-files:
  created: []
  modified:
    - "www/renderer/canvas.js — wall-clock blink, snapshot-first tick, markAllRowsDirty, short-circuit guards, cancellable bell timer, cols-based row clear"
    - "www/renderer/atlas.js — rasteriseBitmap vertical-scale fix (pxW/pxH from cellW/cellH)"
    - "www/main.js — parseHexEscapes bound tightened (WR-03)"

key-decisions:
  - "Blink cadence gated by performance.now() wall clock (not frameCount) — immune to rAF throttling and monitor refresh rate"
  - "rasteriseBitmap derives pxW = cellW / 8 and pxH = cellH / 16 from cell geometry, not from `z` — `z` parameter preserved in signature for call-site compatibility but unused"
  - "markAllRowsDirty() is the canonical post-atlas-evict repaint trigger; every atlas.evict() call site must pair with it"
  - "Same-value short-circuit (identity-click = no-op) is a pre-atlas.evict() guard, not a post-evict optimisation — avoids needless atlas churn + repaint flicker"
  - "snapshot_grid() must run BEFORE reDeriveViews() in tick() — wasm memory.grow on first snapshot detaches any view derived before it"

patterns-established:
  - "atlas.evict() → markAllRowsDirty() → resizeToTheme() → primeAscii() → requestFrame() — the canonical post-invalidation sequence"
  - "triggerBellFlash() owns its own cancellable timer; re-entry clears the prior handle before adding .flash class"
  - "Wall-clock time gates (performance.now() deltas) preferred over frameCount-based cadences for any UX timing (blink, flash, throttle)"

requirements-completed: [RENDER-01, RENDER-02, RENDER-04, RENDER-05, RENDER-06, RENDER-08, RENDER-09, RENDER-10]

# Metrics
duration: 6min
completed: 2026-04-22
---

# Phase 03 Plan 05: Renderer Gap-Closure Summary

**Six UAT renderer-correctness gaps + three latent warnings closed via surgical JS edits to canvas.js, atlas.js, and main.js — cursor now blinks on wall-clock time, first Feed paints immediately, theme/phosphor/zoom preserve content, and CRT glyphs fill the full 16×32 cell at any DPR.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-22T14:58:41Z
- **Completed:** 2026-04-22T15:05:04Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **Cursor blinks** on a wall-clock 530 ms cycle via `performance.now()` — independent of rAF throttling and monitor refresh rate. `setFocus(true)` resets `blinkStartMs` so focus-gain always begins in the ON half (UAT Test 3 closed).
- **First Feed paints immediately** after boot — `tick()` now calls `term.snapshot_grid()` BEFORE `reDeriveViews()` and has a defensive `rebuildViews()` fallback when `gridView.byteLength !== term.grid_byte_len()`. Closes G-03-04-01 zero-length-gridView-at-boot (UAT Test 4).
- **Theme toggle preserves content** — new `markAllRowsDirty()` helper is called immediately after `atlas.evict()` in `setTheme`, paired with a same-value short-circuit so clicking the currently-active theme button is a no-op (UAT Test 5).
- **Phosphor switch recolours all glyphs** — same `markAllRowsDirty()` call in `setPhosphor`, plus same-value short-circuit on identity clicks (UAT Test 7).
- **Zoom preserves content** — `markAllRowsDirty()` after `atlas.evict()` in both `zoomStep` and `resetZoom`, so post-resize repaint covers the full grid (UAT Test 8).
- **CRT glyph fills the full 16×32 cell** — `rasteriseBitmap` now derives `pxW = cellW / 8` and `pxH = cellH / 16` from the cell geometry instead of the `z` zoom multiplier, so the 8×16 source fills the 16×32 target at any DPR (UAT Test 14).
- **Opportunistic latent folds:** WR-03 (`parseHexEscapes` bound tightened from `i + 3 < input.length + 1` to `i + 4 <= input.length`), WR-04 (cancellable bell-flash timer), WR-05 (`paintRow` clears `cols * cellW` not `80 * cellW`).

## Task Commits

Each task was committed atomically:

1. **Task 1: wall-clock blink + snapshot-first tick + markAllRowsDirty + short-circuit guards** — `e14bd6a` (fix)
2. **Task 2: scale CRT bitmap glyph vertically (rasteriseBitmap pxW/pxH)** — `0b96863` (fix)
3. **Task 3: parseHexEscapes bound tightening (WR-03)** — `0c3b1da` (fix)

**Plan metadata:** _pending final metadata commit — covers this SUMMARY.md, STATE.md, ROADMAP.md_

## Files Created/Modified

- `www/renderer/canvas.js` — Wall-clock cursor blink (`blinkStartMs` + `performance.now()` gate in `paintCursor()`), snapshot-first `tick()` with `grid_byte_len()` size-delta rebuild guard, new `markAllRowsDirty()` helper called from 5 invalidation sites (setTheme / setPhosphor / zoomStep / resetZoom / watchDPR), same-value short-circuit guards in `setTheme` and `setPhosphor`, cancellable bell-flash timer in `triggerBellFlash`, `paintRow` row-clear switched from `80 * cellW` to `cols * cellW`.
- `www/renderer/atlas.js` — `rasteriseBitmap` per-pixel scale derived from `cellW / 8` and `cellH / 16` (glyph fills full cell at any zoom / DPR). `z` parameter kept in signature for call-site compatibility but unused; documented inline.
- `www/main.js` — `parseHexEscapes` bound changed from `i + 3 < input.length + 1` to `i + 4 <= input.length` (byte-identical output for all existing inputs; tightens an algebraically-equivalent but semantically-weaker condition).

## Decisions Made

- **Wall-clock blink over frameCount blink:** `performance.now()` cadence is immune to rAF throttling (Chromium drops rAF to ~1 Hz when the tab is hidden) and to monitor refresh rate (120 Hz monitors would blink twice as fast with `frameCount % 64`). 530 ms ON / 530 ms OFF cycle preserved from D-07.
- **Snapshot-first tick ordering:** `term.snapshot_grid()` may trigger wasm `memory.grow` on its first call, detaching any `Uint8Array` view derived from the pre-grow buffer. Calling snapshot_grid BEFORE reDeriveViews — and following it with a `gridView.byteLength !== term.grid_byte_len()` size-delta guard — closes both the first-boot and any-future-resize paths.
- **`markAllRowsDirty` vs alternative fixes:** Rather than teaching the wasm core to mark rows dirty on cell-count or palette change, do it JS-side after every `atlas.evict()`. Keeps the Rust surface narrow (D-17) and the invalidation policy visible at each call site.
- **Same-value short-circuit as a _pre-evict_ guard:** Placed at the top of `setTheme` / `setPhosphor` so identity-click is literally a `return` — no atlas churn, no repaint, no rAF dispatch. REVIEW warning 3.
- **rasteriseBitmap scale derivation:** Using `cellW / 8` and `cellH / 16` makes the glyph fill the cell regardless of what the caller passes for `z`. Future cell-geometry tweaks (e.g., 1.5× scale) will "just work" without touching the rasteriser.
- **`z` parameter retained in rasteriseBitmap signature:** All five call sites in `canvas.js` pass `z`; changing the signature would be a larger cross-file edit than is justified for a gap-closure plan. Inline comment documents the unused-but-retained status.

## Deviations from Plan

None — all three tasks executed exactly as specified. The only adjustment was a doc-level typo in Task 3's automated verify block (the plan's expected `len=13` vs actual `len=14` for `Hello\x1BY\x21\x20World`); the byte list in the same block (14 bytes: 72,101,108,108,111,27,89,33,32,87,111,114,108,100) and the prose description ("5 ASCII + ESC + Y + 0x21 + 0x20 + 5 ASCII" = 14 bytes) both correctly specify 14. Verified pre-fix vs post-fix behaviour is byte-identical across all test inputs (`Hello\x1BY\x21\x20World`, `\x07`, `\x1B`, `abc`, `a\x`, `a\x4`, empty string) — pure bound tightening, no behaviour change.

## Issues Encountered

None. All automated verify grep checks and syntax checks passed first-try. Existing Playwright suite (23 passed + 1 `test.fixme`) stays green — the `test.fixme` for "default CRT green paints fixture bytes" is a known un-`fixme`-in-Plan-03-07 artifact and is out of scope for this plan.

## Verification Results

Task-level automated verification (all passed):

- `performance.now()` appears >=2 times in canvas.js with blinkStartMs/elapsed context — **3 matches** ✓
- Zero `frameCount % 64` / `frameCount % 32` matches — **0** ✓
- `markAllRowsDirty` appears at declaration + 5 call sites — **6 total** (1 decl + 5 calls) ✓
- `term.snapshot_grid()` line is before first `reDeriveViews()` line in `tick()` — **snapshot=238, reDerive=241** ✓
- `gridView.byteLength !== term.grid_byte_len()` size-delta guard present — **1** ✓
- `cols * cellW` present, `80 * cellW` absent — **1 / 0** ✓
- `bellFlashTimer` appears >=3 times — **4** ✓
- `name === activeTheme.name` short-circuit present in setTheme — **1** ✓
- `color === activePhosphor` short-circuit present in setPhosphor — **1** ✓
- `const pxW = cellW / 8` and `const pxH = cellH / 16` present in atlas.js — **1 / 1** ✓
- Old `col * z, row * z, z, z` fillRect gone — **0** ✓
- rasteriseBitmap signature unchanged — **preserved** ✓
- atlas.js imports cleanly — **ok function** ✓
- main.js `i + 3 < input.length + 1` gone — **0** ✓
- main.js `i + 4 <= input.length` present — **1** ✓
- parseHexEscapes pre-fix vs post-fix byte-identical for all tested inputs — **all-match=true** ✓

Plan-level Playwright regression (`npx playwright test --project=chromium`): 23 passed + 1 skipped (the pre-existing `test.fixme`), same as post-03-04 baseline. No regressions.

Syntax checks: `node --check` passes on all three modified files.

## User Setup Required

None — pure in-repo JS edits; no dependencies added, no env vars, no external services.

## Next Phase Readiness

- **Plan 03-06 (keyboard chord + focus border remap):** Independent of this plan's changes; proceeds with Tests 6 and 10 unchanged.
- **Plan 03-07 (regression specs):** Has the full surface for adding Playwright regressions covering every gap closed here. The existing `test.fixme` in `grid.spec.js` ("default CRT green paints fixture bytes") is expected to pass now — un-`fixme` it in Plan 03-07 as proof of gap #2 closure.
- **Phase verification:** `/gsd-verify-phase 03` should now mark Tests 3, 4, 5, 7, 8, 14 as passed (contingent on human re-UAT once Plans 03-06 and 03-07 also land).

## Self-Check: PASSED

- `www/renderer/canvas.js` — exists, modified, committed in `e14bd6a` ✓
- `www/renderer/atlas.js` — exists, modified, committed in `0b96863` ✓
- `www/main.js` — exists, modified, committed in `0c3b1da` ✓
- Commit `e14bd6a` exists in git log ✓
- Commit `0b96863` exists in git log ✓
- Commit `0c3b1da` exists in git log ✓
- All must_haves.truths verifiable via grep patterns in must_haves.key_links ✓
- All must_haves.artifacts `contains` markers present in named files ✓

---
*Phase: 03-canvas-renderer*
*Completed: 2026-04-22*
