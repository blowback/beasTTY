---
status: complete
phase: 03-canvas-renderer
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md]
started: 2026-04-22T13:41:18Z
updated: 2026-04-22T13:56:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running web server. From www/, start fresh (python3 -m http.server 8000). Open http://localhost:8000/ in Chromium. Page loads with title "BestialiTTY", no console errors, no font fallback flash, top-bar visible with theme + phosphor controls, canvas visible below.
result: pass

### 2. 80×24 CRT Canvas Renders
expected: On default load, canvas is visible at 1280×768 CSS pixels (80 cols × 16 px × 24 rows × 32 px). CRT green phosphor (#33ff66 on near-black), scanline overlay subtly visible across canvas surface.
result: pass

### 3. Block Cursor Blinks
expected: Block cursor at top-left cell (0,0) is visible in green phosphor. Cursor blinks roughly twice per second (530 ms cycle) when canvas wrapper is focused.
result: issue
reported: "cursor visible but does not blink"
severity: major

### 4. Feed Fixture Bytes Renders Content
expected: Open Debug pane. Click "64 KB Stress" or paste text into input + click "Feed". Canvas should display the fed content (e.g. CP/M boot output, "A>" prompt). Cells should fill with green-on-black glyphs.
result: issue
reported: "cursor moves down but no text appears on Feed. 64 KB stress sends two lines of text. thereafter, Feed works properly."
severity: major

### 5. Theme Toggle Button
expected: Top-bar shows a button labelled "Clean" (the destination theme). Click it. Canvas swaps from green CRT bitmap to white-on-black JetBrains Mono vector text. Button label changes to "CRT". Phosphor radio group hides. Click again — back to CRT, label "Clean", phosphor group reappears.
result: issue
reported: "all works, but canvas content is lost on theme switch"
severity: major

### 6. Ctrl+Shift+T Keyboard Shortcut
expected: Focus the terminal wrapper (click on it). Press Ctrl+Shift+T. Theme toggles between CRT and Clean exactly as the button does. Browser does NOT reopen a closed tab (preventDefault works).
result: issue
reported: "ctrl-shift-t is used by the browser to reopen closed tabs"
severity: major

### 7. Phosphor Switching (CRT theme only)
expected: In CRT theme, click "Amber" radio. Canvas phosphor changes to amber (#ffb000 on near-black). Click "White" — switches to white. Click "Green" — back to green. Active button shows aria-pressed (visually distinct).
result: issue
reported: "buttons work but the canvas text does not change colour to match"
severity: major

### 8. Zoom In / Out / Reset
expected: Press Ctrl+= (or Ctrl++). Canvas grows by integer multiple (1280→2560 CSS px wide at 2×). Press Ctrl+- to step down. Press Ctrl+0 to reset to 1×. Browser does NOT zoom the page.
result: issue
reported: "zoom works, but the canvas text is lost"
severity: major

### 9. Zoom Clamp at 4×
expected: From 1× zoom, press Ctrl+= six times. Canvas stops growing at 4× (5120 CSS px wide). Further presses do nothing.
result: pass

### 10. Focus Indicator
expected: Click outside the terminal wrapper (e.g. on top-bar). Wrapper border becomes transparent (no visible outline). Click on wrapper. Border becomes visible in accent color. No layout shift — surrounding elements do NOT jump when focus changes.
result: issue
reported: "the border does not become visible"
severity: major

### 11. Bell Overlay Flash
expected: In Debug input, type the literal `\x07` (or paste a BEL byte sequence) and click Feed. Bell overlay flashes briefly across the canvas (~100 ms opacity pulse), then fades.
result: pass

### 12. Bell Title Prefix While Hidden
expected: Switch to a different browser tab so BestialiTTY tab is backgrounded. From a script or by pre-feeding a delayed BEL, trigger a bell while the tab is hidden. Tab title in the browser tab strip prepends "(!) " (becomes "(!) BestialiTTY"). Return to the tab — prefix is stripped, title is "BestialiTTY" again.
result: pass

### 13. Debug Pane Retained (Phase 2 SC-4 Regression)
expected: Open Debug details. Both "Feed" button and "64 KB Stress" button are present. Click "64 KB Stress". Browser console logs three [SC-4] lines including "Fed 65536 bytes in ONE feed() call". No errors.
result: pass

### 14. HiDPI Sharpness
expected: On a HiDPI / Retina display (or Chromium devtools with deviceScaleFactor 2), canvas glyphs render crisp without blur. Pixel art is pixel-perfect at integer zoom levels.
result: issue
reported: "the cursor/row height seems to be twice as tall as the actual text"
severity: minor

## Summary

total: 14
passed: 6
issues: 8
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Block cursor at top-left cell (0,0) blinks roughly twice per second (530 ms cycle) when wrapper focused"
  status: failed
  reason: "User reported: cursor visible but does not blink"
  severity: major
  test: 3
  artifacts: []
  missing: []

- truth: "Feed of arbitrary bytes paints content on canvas immediately (does not require prior 64 KB stress to prime the renderer)"
  status: failed
  reason: "User reported: cursor moves down but no text appears on Feed. 64 KB stress sends two lines of text. thereafter, Feed works properly. (matches known SC-1 / G-03-04-01 rebuildViews / reDeriveViews snapshot-timing bug — gridView is zero-length until wasm.memory.buffer identity changes, which the 64 KB stress triggers via grow)"
  severity: major
  test: 4
  artifacts: []
  missing: []

- truth: "Switching themes preserves the existing canvas content (theme swap evicts atlas + repaints all rows, not just dirty rows)"
  status: failed
  reason: "User reported: all works, but canvas content is lost on theme switch (likely: setTheme evicts atlas + requestFrame, but tick() repaints only dirty rows — clean grid of cells stays bg-painted because nothing flagged them dirty)"
  severity: major
  test: 5
  artifacts: []
  missing: []

- truth: "Ctrl+Shift+T toggles theme without triggering Chromium's 'reopen closed tab' default action (synchronous preventDefault claims the event first)"
  status: failed
  reason: "User reported: ctrl-shift-t is used by the browser to reopen closed tabs (preventDefault not effective — Chromium reopens tab instead of toggling theme; per RESEARCH Pitfall #3, this shortcut may be fundamentally unhookable in Chromium and must be remapped to a different chord)"
  severity: major
  test: 6
  artifacts: []
  missing: []

- truth: "Selecting a phosphor (Green/Amber/White) immediately recolors the rendered canvas glyphs to match the chosen palette"
  status: failed
  reason: "User reported: buttons work but the canvas text does not change colour to match (aria-pressed updates and CSS vars likely set, but canvas tiles are not re-rasterised in the new fg colour — same family as theme-switch content-loss: setPhosphor evicts atlas + requestFrame, but tick() repaints only dirty rows so old tiles stay on screen)"
  severity: major
  test: 7
  artifacts: []
  missing: []

- truth: "Zoom step (Ctrl+= / Ctrl+- / Ctrl+0) preserves existing canvas content after the resize repaints"
  status: failed
  reason: "User reported: zoom works, but the canvas text is lost (third member of the same family — zoomStep evicts atlas + resizes + re-primes + requestFrame, but tick() paints only dirty rows so existing content vanishes after the resize)"
  severity: major
  test: 8
  artifacts: []
  missing: []

- truth: "Focusing the terminal wrapper shows a visible accent-coloured border (1 px transparent in blur, accent in :focus-visible per Plan 03 D-13)"
  status: failed
  reason: "User reported: the border does not become visible (likely: :focus-visible CSS rule not applied — could be selector mismatch on terminal-wrapper, or accent custom property not bound to border-color in the focus state, or the wrapper not receiving keyboard focus despite tabindex=0)"
  severity: major
  test: 10
  artifacts: []
  missing: []

- truth: "On HiDPI display, glyph height fills the cell (CRT cellH=32 with 16-row bitmap means each source row should be doubled vertically so glyph occupies the full cell height)"
  status: failed
  reason: "User reported: the cursor/row height seems to be twice as tall as the actual text (suggests rasteriseBitmap is drawing 16-row glyph into a 32px cell at native height instead of doubling — or the cellH value is being applied without compensating glyph scaling, leaving half-empty cells)"
  severity: minor
  test: 14
  artifacts: []
  missing: []
