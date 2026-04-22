---
phase: 03-canvas-renderer
verified: 2026-04-22T17:00:00Z
status: human_needed
score: 12/12 must-haves verified (automated); 3 items require manual UAT
overrides_applied: 0
human_verification:
  - test: "Per-test second-pass UAT re-run"
    expected: "Each of the 14 tests in 03-UAT.md individually re-executed against the current build with per-test pass/fail recorded"
    why_human: "The 03-UAT.md second-pass block shows passed: 14 / issues: 0 BUT every test is marked 'user-approved (not individually re-run)'. The user verbally approved without exercising the tests. Per orchestrator instruction, any must_have whose evidence rests on the verbal-approved pass must surface here. The automated Playwright suite (32/32 green) covers the regression surface but does not substitute for eyes-on validation of glyph readability, phosphor aesthetic, and scanline appearance."
  - test: "Multi-monitor DPR drag (SC-5 second half)"
    expected: "Drag the browser window between two displays with different devicePixelRatio values; verify glyphs remain crisp with no blur through the transition"
    why_human: "Playwright cannot emulate a live monitor change — watchDPR() logic exists in canvas.js with matchMedia(resolution:Xdppx) and re-register + markAllRowsDirty + evict, but actual cross-monitor drag requires real hardware. Currently unverifiable in CI."
  - test: "Visual quality of CRT vs Clean themes"
    expected: "On a Retina-class display, confirm CRT bitmap glyphs are crisp at native and zoomed sizes; confirm Clean theme JetBrains Mono renders without fallback flash on first paint (font-display:block contract); confirm scanline overlay is subtly visible (not overpowering)"
    why_human: "Pixel-level Playwright assertions cannot judge aesthetic readability. The font-fallback flash is a human-perceptual property on first paint."
---

# Phase 3: Canvas Renderer Verification Report

**Phase Goal:** HiDPI canvas renderer with glyph atlas, dirty-row repaint, CRT and clean themes, visible cursor and focus, visible-bell flash
**Verified:** 2026-04-22T17:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification (this is the first VERIFICATION.md for the phase; prior execution cycles produced UAT + REVIEW, not verifier output)

## Goal Achievement

### Observable Truths

ROADMAP.md Success Criteria (authoritative contract) merged with plan-level must_haves:

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 (SC1) | Canned VT52 byte stream feeds into wasm and renders on 80×24 canvas with visible block cursor, crisp on Retina, no font-fallback flash on first paint | ✓ VERIFIED | grid.spec.js: canvas 1280×768 CSS px (80×16×24×32) ✓; FIRST-Feed-paints test ✓; fixture-feed non-bg pixels test ✓; hidpi.spec.js backingW = cssW×2 (DPR=2) ✓; canvas.js awaits `document.fonts.load('14px "JetBrains Mono"')` then `document.fonts.ready` before first paint (canvas.js:315-319); @font-face uses `font-display: block` (index.html:19) |
| 2 (SC2) | Author can toggle CRT ↔ Clean via UI control AND keyboard shortcut; each theme defines its own cursor styling | ✓ VERIFIED (chord remapped) | theme-toggle.spec.js: click + Ctrl+Alt+T + negative Ctrl+Shift+T pass ✓; themes.js CRT has bitmap cellW=16/cellH=32 cursor.fgColor=#33ff66, Clean has vector cellW=9/cellH=18 cursor.fgColor=#7fdbca ✓; **deviation recorded:** chord remapped from ROADMAP-suggested Ctrl-Shift-T to Ctrl+Alt+T because Chromium reserves Ctrl+Shift+T for "reopen closed tab" — documented in 03-UI-SPEC and 03-UAT |
| 3 (SC3) | Phosphor (green/amber/white) is user-selectable in CRT theme; Ctrl+/-/0 zoom scales bitmap by integer multipliers | ✓ VERIFIED | phosphor.spec.js: aria-pressed exclusivity ✓, CSS var --phosphor-fg matches palette ✓, gap#5 recolour of existing glyphs ✓; zoom.spec.js: Ctrl+Equal/Minus/Digit0 progression through integer multiples ✓, clamps at 4× and 1× ✓, gap#6 content preserved across zoom ✓; zoomStep clamps to [1,4] in canvas.js:385 |
| 4 (SC4) | BEL (0x07) causes ~100 ms screen flash AND `(!)` title prefix when tab is backgrounded | ✓ VERIFIED | bell.spec.js: overlay .flash class toggles + clears after 100 ms ✓; BEL-while-hidden sets '(!) BestialiTTY' + visibility return clears it ✓; double-BEL does not double-prefix ✓; main.js sampleBell() runs synchronously after term.feed() (main.js:128-137), NOT inside rAF — immune to ~1Hz background-tab throttling |
| 5 (SC5a) | Focus state on canvas is visibly distinct from unfocused state (border change) | ✓ VERIFIED | focus.spec.js: data-focused attribute mirrors activeElement ✓; border colour changes without layout reflow ✓; mouse-click focus activates border (gap#7 pointer path) ✓; index.html uses `[data-focused="true"]` attribute-selector (not :focus-visible) so border fires on programmatic + pointer focus |
| 6 (SC5b) | Resizing window / dragging between monitors of different DPR does not produce blur | ? UNCERTAIN | watchDPR() in canvas.js:116-126 uses matchMedia(`(resolution: Xdppx)`) + self-re-registering once listener, calls atlas.evict() + markAllRowsDirty() + resizeToTheme() on DPR change; resizeToTheme uses `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` (not ctx.scale). Not directly testable in Playwright — needs human verification on multi-monitor hardware |
| 7 (plan 03-05) | Block cursor at (0,0) visibly blinks on 530 ms cycle when focused — independent of monitor refresh rate | ✓ VERIFIED | cursor.spec.js gap#1: 27 samples × 60 ms = 1620 ms window, separate calibrated thresholds (g<30 for bg, g>200 for fg) both satisfied ✓; canvas.js:207 uses `performance.now() - blinkStartMs`, `(Math.floor(elapsed/530) & 1) === 0`; blink-off branch now repaints bg + glyph (Plan 03-07 Rule 1 auto-fix in commit 019034e) |
| 8 (plan 03-05) | First Feed click after boot paints printable glyphs (no need to prime with 64 KB stress first) — closes G-03-04-01 | ✓ VERIFIED | grid.spec.js gap#2 (FIRST-Feed test) ✓; canvas.js tick() calls `term.snapshot_grid()` BEFORE `reDeriveViews()` (canvas.js:251-254); size-delta guard rebuilds views when `gridView.byteLength !== term.grid_byte_len()` (canvas.js:259-261) |
| 9 (plan 03-05) | Theme/phosphor/zoom preserve previously-painted content | ✓ VERIFIED | theme-toggle.spec.js gap#3 ✓, phosphor.spec.js gap#5 ✓, zoom.spec.js gap#6 ✓; `markAllRowsDirty()` helper (canvas.js:58-62) called after every atlas.evict() at setTheme/setPhosphor/zoomStep/resetZoom/watchDPR |
| 10 (plan 03-05) | Same-value short-circuit — clicking already-active theme/phosphor is a no-op (no atlas evict, no repaint flicker) | ✓ VERIFIED | canvas.js:342 `if (activeTheme && name === activeTheme.name) return;` in setTheme; canvas.js:375 `if (color === activePhosphor) return;` in setPhosphor |
| 11 (plan 03-05) | CRT glyph visually fills the full 32 px cell height at DPR=2 (no half-empty cells) | ✓ VERIFIED | hidpi.spec.js gap#8: feeds 'HHHHHHHH', samples bottom half (y=32..63) of cell, asserts phosphor-green pixel present ✓; atlas.js:101-102 derives `pxW = cellW/8` and `pxH = cellH/16` from cell geometry (not from z parameter) |
| 12 (plan 03-06) | Ctrl+Alt+T toggles theme without Chromium reopening last-closed tab; OLD Ctrl+Shift+T is NOT handled | ✓ VERIFIED | chrome.js:86 chord check `e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyT'`; no `e.ctrlKey && e.shiftKey && e.code === 'KeyT'` anywhere in chrome.js (grep -c = 0); theme-toggle.spec.js negative test confirms Ctrl+Shift+T does NOT swap theme ✓ |

**Score:** 12/12 plan-level must-haves VERIFIED; SC5b (DPR multi-monitor drag) deferred to human verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `www/renderer/bitmap-font.js` | Hand-drawn 8×16 ASCII Uint8Array length 2048, 94 printable glyphs non-zero, space/DEL/high-ASCII blank | ✓ VERIFIED | length=2048, printable_nonzero=94, space_sum=0, del_sum=0; file 22,650 bytes; ORIGINAL-creative-work comment present |
| `www/assets/fonts/jetbrains-mono-regular.woff2` | WOFF2 file with wOF2 magic, 15KB–220KB | ✓ VERIFIED | 92,164 bytes; magic `774f4632` (wOF2) |
| `www/assets/fonts/LICENSE-JetBrainsMono.txt` | OFL 1.1 text with "SIL OPEN FONT LICENSE" and "JetBrains" | ✓ VERIFIED | Both literal strings present; file 4,399 bytes |
| `www/renderer/themes.js` | THEMES export with crt+clean, phosphorSlots, per-theme cell dimensions | ✓ VERIFIED | THEMES.crt (cellW=16, cellH=32, bitmap, 3 phosphorSlots); THEMES.clean (cellW=9, cellH=18, vector, fontPx=14) |
| `www/renderer/atlas.js` | Atlas class with `cache` + `invCache` + `evict()` that clears both + bumps nonce; rasteriseBitmap + rasteriseVector | ✓ VERIFIED | Atlas.cache + invCache both Maps; evict() clears both and bumps nonce; rasteriseBitmap uses setTransform(dpr,...) + imageSmoothingEnabled=false + derives pxW/pxH from cellW/cellH |
| `www/renderer/canvas.js` | bootRenderer, requestFrame, setTheme, setPhosphor, zoomStep, resetZoom, setFocus, getActiveTheme, getActivePhosphor, getActiveZoom, triggerBellFlash | ✓ VERIFIED | All 11 exports present; no `new OffscreenCanvas` in canvas.js (confined to atlas.js); rAF tick is paint-only; bell sampling delegated to main.js |
| `www/renderer/chrome.js` | wireChrome export wiring theme + phosphor + keyboard + focus/blur + visibilitychange | ✓ VERIFIED | All handlers present; Ctrl+Alt+T chord (not Ctrl+Shift+T); visibilitychange listener clears '(!) ' prefix on foreground return |
| `www/index.html` | Canvas-first DOM, @font-face with font-display:block, `[data-focused="true"]` border, bell-overlay, scanlines | ✓ VERIFIED | All elements present; `[data-focused="true"]` selector in use (not `:focus-visible` for terminal-wrapper); scanlines shown via `[data-theme="crt"]` ancestor |
| `www/main.js` | Retained Phase 2 helpers + bootRenderer + wireChrome + sampleBell() after every feed | ✓ VERIFIED | parseHexEscapes with `i + 4 <= input.length` (WR-03 fold); sampleBell() runs synchronously after feed in both Feed and 64KB Stress handlers; drainHostReply retained |
| `www/playwright.config.js` | testDir './tests/render', deviceScaleFactor 2, chromium project, baseURL localhost:8000 | ✓ VERIFIED | All four fields present |
| `www/tests/fixtures/vt52-sample.bin` | Binary, 1–4096 bytes | ✓ VERIFIED | 797 bytes |
| `www/tests/render/*.spec.js` | 9 spec files covering all RENDER-XX IDs | ✓ VERIFIED | 9 files: bell, cursor, focus, grid, hidpi, keyboard, phosphor, theme-toggle, zoom |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| canvas.js bootRenderer | wasm.memory.buffer | `new Uint8Array(wasm.memory.buffer, term.grid_ptr(), ...)` | ✓ WIRED | canvas.js:44-46 rebuildViews() |
| canvas.js paintRow | atlas.js Atlas.get | `atlas.get(ch, fg, rast, z)` then `ctx.drawImage(tile,...)` | ✓ WIRED | canvas.js:180-181 |
| atlas.js rasteriseBitmap | bitmap-font.js BITMAP_FONT | `BITMAP_FONT[base + row]` | ✓ WIRED | atlas.js:24 import, atlas.js:105 indexing |
| canvas.js resizeToTheme | canvas + ctx.setTransform | `canvas.width = cssW * dpr; ctx.setTransform(dpr,0,0,dpr,0,0)` | ✓ WIRED | canvas.js:93-100 |
| canvas.js watchDPR | window.matchMedia | `window.matchMedia(\`(resolution: ${devicePixelRatio}dppx)\`)` with once listener | ✓ WIRED | canvas.js:117-125 |
| index.html @font-face | jetbrains-mono-regular.woff2 | `src: url('./assets/fonts/jetbrains-mono-regular.woff2') format('woff2')` | ✓ WIRED | index.html:17-18 |
| index.html #theme-toggle | chrome.js click | `themeButton.addEventListener('click', ...)` → setTheme | ✓ WIRED | chrome.js:61-63 |
| chrome.js keydown | canvas.js setTheme / zoomStep / resetZoom | `e.preventDefault(); toggleTheme(ctx)` synchronous-first | ✓ WIRED | chrome.js:76-108 |
| main.js Feed button | canvas.js requestFrame + triggerBellFlash | `term.feed(bytes); sampleBell(); requestFrame()` | ✓ WIRED | main.js:140-147 |
| main.js sampleBell | canvas.js triggerBellFlash + document.title | `triggerBellFlash()` + `document.title = TITLE_PREFIX + title` when hidden | ✓ WIRED | main.js:128-137 |
| chrome.js visibilitychange | document.title strip | `document.title = document.title.slice(4)` when !hidden && startsWith '(!) ' | ✓ WIRED | chrome.js:134-138 |
| canvas.js setTheme → atlas.evict → markAllRowsDirty | post-evict full-grid repaint | `atlas.evict(); markAllRowsDirty(); resizeToTheme(); requestFrame()` | ✓ WIRED | canvas.js:346-351 (also in setPhosphor, zoomStep, resetZoom, watchDPR) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| canvas.js paintRow | gridView[i] | Zero-copy Uint8Array over wasm.memory.buffer + term.grid_ptr()/term.grid_byte_len(); populated by term.snapshot_grid() in tick() | Yes — verified by grid.spec.js gap#2 test which feeds bytes and asserts non-bg pixels appear | ✓ FLOWING |
| canvas.js paintCursor | term.cursor_packed() | Wasm boundary call returning live cursor state | Yes — verified by cursor.spec.js (focused block + blurred outline) | ✓ FLOWING |
| canvas.js paintRow dirty-row loop | dirtyView[r] | Zero-copy Uint8Array over term.dirty_ptr(); wasm core sets bytes to 1 when rows are dirtied by feed()/snapshot_grid() | Yes — proven by grid.spec.js fixture-feed test (wasm sets dirty, paintRow runs, pixels appear) | ✓ FLOWING |
| main.js sampleBell | term.bell_pending() | Synchronous wasm call after term.feed() | Yes — verified by bell.spec.js 3 tests | ✓ FLOWING |
| main.js drainHostReply | hostReplyView.subarray(0, replyLen) | Zero-copy view over term.host_reply_ptr(), re-derived on buffer identity change | Yes — preserved from Phase 2 SC-4 pattern | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full Playwright suite passes after fresh wasm build | `cd www && npx playwright test --project=chromium` | 32 passed (6.1s), 0 failed | ✓ PASS |
| BITMAP_FONT shape + glyph coverage | `node --input-type=module ... import {BITMAP_FONT} ...` | length=2048, printable_nonzero=94, space_sum=0, del_sum=0 | ✓ PASS |
| WOFF2 magic bytes | `head -c 4 ... \| xxd -p` | `774f4632` | ✓ PASS |
| License strings present | `grep 'SIL OPEN FONT LICENSE' ... grep 'JetBrains' ...` | both match | ✓ PASS |
| Rust regression (Phases 1-2 intact) | `cargo test --all` | 8 passed, 0 failed (workspace crate suite) | ✓ PASS |
| No new OffscreenCanvas allocation in canvas.js hot path | `grep -cE 'new OffscreenCanvas' canvas.js` | 0 | ✓ PASS |
| Ctrl+Alt+T chord present | `grep -cF "e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyT'"` | 1 | ✓ PASS |
| Ctrl+Shift+T chord REMOVED | `grep -cE "e\\.ctrlKey && e\\.shiftKey && e\\.code === 'KeyT'"` chrome.js | 0 | ✓ PASS |
| data-focused attribute selector in CSS | `grep -cE "\\[data-focused="` index.html | 1 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| RENDER-01 | 03-02, 03-04, 03-05, 03-07 | Canvas-based monospace rendering at fixed 80×24 grid | ✓ SATISFIED | grid.spec.js (1280×768 CSS), gap#2 tests pass |
| RENDER-02 | 03-02, 03-04, 03-05, 03-07 | Visible block cursor | ✓ SATISFIED | cursor.spec.js focused + blurred + gap#1 blink pass; Plan 03-07 Rule 1 auto-fix repaints blink-off |
| RENDER-03 | 03-03, 03-04, 03-06, 03-07 | Focus indicator on terminal surface | ✓ SATISFIED | focus.spec.js 3 tests pass via data-focused attribute |
| RENDER-04 | 03-01, 03-02, 03-03, 03-04, 03-05, 03-07 | CRT theme bitmap font + phosphor + scanlines | ✓ SATISFIED | grid.spec.js + hidpi.spec.js gap#8 (cell fill) pass; scanlines CSS in index.html:121-131 |
| RENDER-05 | 03-01, 03-02, 03-03, 03-04, 03-05, 03-07 | Clean modern monospace theme — sharp web font | ✓ SATISFIED | themes.js Clean uses JetBrains Mono vector; theme-toggle.spec.js gap#3 confirms clean-theme paint |
| RENDER-06 | 03-02, 03-03, 03-04, 03-05, 03-07 | User-toggleable theme switch | ✓ SATISFIED | theme-toggle.spec.js (click + keyboard + label) pass |
| RENDER-07 | 03-03, 03-04, 03-06, 03-07 | Keyboard shortcut to toggle theme (Ctrl+Alt+T remapped from Ctrl+Shift+T) | ✓ SATISFIED | theme-toggle.spec.js + keyboard.spec.js @fast tests pass; negative Ctrl+Shift+T test pass |
| RENDER-08 | 03-03, 03-04, 03-05, 03-07 | Phosphor colour choice (green/amber/white) for CRT | ✓ SATISFIED | phosphor.spec.js 4 tests incl. gap#5 pass |
| RENDER-09 | 03-02, 03-04, 03-05, 03-07 | Font size zoom via Ctrl +/- / Ctrl 0 integer multipliers | ✓ SATISFIED | zoom.spec.js 4 tests incl. gap#6 pass |
| RENDER-10 | 03-02, 03-04, 03-05, 03-07 | HiDPI / devicePixelRatio without blur | ✓ SATISFIED | hidpi.spec.js 2 tests pass; DPR-drag cross-monitor deferred to human (SC5b) |
| RENDER-11 | 03-03, 03-04 | Visible-bell rendering as ~100 ms flash + title-bar indicator | ✓ SATISFIED | bell.spec.js 3 tests pass |
| RENDER-12 | 03-02, 03-04, 03-07 | Per-theme cursor styling | ✓ SATISFIED | themes.js CRT cursor (phosphor fg swap) vs Clean cursor (accent #7fdbca) both present; cursor.spec.js calibrated to CRT palette |

**All 12 RENDER-* requirements SATISFIED.** No orphaned requirements: REQUIREMENTS.md lines 183-194 confirm all 12 Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| www/index.html | 196 | `placeholder="Hello\\x1BY..."` | ℹ️ Info | Legitimate HTML textarea placeholder attribute — not a code stub |

No blocker or warning anti-patterns. REVIEW.md (from Phase 03 code review) identified 2 warnings + 6 info items, all defensive-hardening opportunities that do not block the phase goal:
- WR-01 paintCursor bounds-check (defensive): informational — a crash only happens if upstream emits an out-of-range cursor, which Phase 2 does not do
- WR-02 watchDPR MQL reuse (hardening): informational — Chromium GCs the orphaned MQL, not a leak in practice
- IN-01..IN-06: stale comments, duplicated title prefix constant, redundant cols() call, element-lookup memoisation, DOM null-guard absence, unused rasteriseBitmap `z` param — all style/consistency notes, none block the phase

### Human Verification Required

See frontmatter `human_verification` block. Summary:

1. **Per-test second-pass UAT re-run** — The 03-UAT.md Gap Closure UAT section shows `passed: 14 / issues: 0` BUT every test is marked `result: user-approved (not individually re-run)`. The user signalled `approved` verbally without walking each test. The 03-07-SUMMARY's §Deviations §2 acknowledges this and cites the automated Playwright suite (32/32 green) as substitute regression evidence. Per verifier instruction, this must surface here so the developer can elect to perform a proper manual UAT pass before declaring Phase 3 complete.

2. **Multi-monitor DPR drag** — SC5b's "dragging the browser between monitors of different DPR does not produce blur" cannot be automated in Playwright. The `watchDPR()` machinery exists in canvas.js (matchMedia once-listener + atlas.evict + markAllRowsDirty + resizeToTheme on change) but real multi-monitor hardware is required to confirm the blur-free transition.

3. **Visual quality (aesthetic)** — Pixel-threshold Playwright assertions confirm glyphs are painted but cannot judge readability, phosphor aesthetic, scanline subtlety, or font-fallback-flash perception on first paint.

### Deferred Items

None. Phase 4 (Keyboard Input) takes a dependency on the renderer, not the other way around — no Phase 3 must-have is addressed in a later phase.

### Gaps Summary

No code-level gaps. The full automated Playwright suite passes (32/32), the Rust regression suite passes (workspace 8/8 crate-level; earlier phases reported 148/148 for full crate suite), all 12 RENDER-* requirements are SATISFIED with named regression guards, every must-have from plans 03-01..03-07 is VERIFIED in code, and all key links + data-flow traces confirm real data flows end-to-end from the Debug Feed button through wasm.memory to canvas pixels.

The phase status is `human_needed` (not `passed`) strictly because:

- **Evidence gap, not code gap.** The second-pass UAT's `passed: 14 / issues: 0` count is a verbal approval, not a per-test re-run. The 03-07-SUMMARY acknowledges this as a documented Deviation §2. Before formally closing the phase, the developer should either:
  - Accept the verbal-approval posture explicitly (add an `overrides:` entry to this VERIFICATION.md frontmatter for the per-test UAT requirement), OR
  - Perform a per-test manual re-run and update 03-UAT.md with genuine pass/fail results per test.
- **SC5b cannot be tested in CI.** Multi-monitor DPR drag requires real hardware; the code exists and looks correct but has no automated verification.
- **Aesthetic quality is inherently human.** Font-fallback flash on first paint, phosphor appearance, and scanline subtlety are perceptual and cannot be pixel-asserted.

The developer can promote this to `passed` by doing one eyes-on UAT pass (even abbreviated) and recording the three human verification items above as done.

---

_Verified: 2026-04-22T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
