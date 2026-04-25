---
status: draft
phase: 06-daily-driver-polish-session-deployment
source: [06-VALIDATION.md, 06-CONTEXT.md, 06-SOAK.md]
started: TBD
updated: TBD
---

# Phase 6 — Daily-Driver Human UAT

These tests close ROADMAP Phase 6 SC-1, SC-3, SC-4, SC-5 from the user's perspective. Each test exercises a daily-driver flow that automated Playwright tests cannot fully replicate (real hardware, real OS clipboard, real network deploy, real human attention). The 24-hour soak (Test 8) cross-references 06-SOAK.md.

This document is OUT-OF-BAND. `/gsd-verify-phase 06` does NOT block on these tests; the user runs them on their schedule and updates the result lines below post-run.

## Tests

### 1. Paste 100 KB during a real CP/M session (SESS-03 / SC-1)
**expected:** A 100 KB clipboard payload pastes into the MicroBeast at the rate-limited paste-pump speed; the MicroBeast input buffer does NOT overflow; the inline confirm chip appears (≥ 4096-byte threshold) before any byte hits the wire.
**steps:**
1. Connect to the MicroBeast running CP/M at the default 19200 8N1.
2. Open a CP/M editor (e.g. WordStar or `ED`).
3. Generate a 100 KB plain-text payload (lorem ipsum or `head -c 100000 /dev/urandom | base64` — alphanumeric only).
4. Copy the payload to the OS clipboard.
5. Press Ctrl+Shift+V.
6. Confirm chip should appear: `About to paste 100,000 B (~52 s at 19200 baud).` Click Paste.
7. Watch the canvas — bytes should stream into the editor at ~19200 baud (~52 seconds total).
8. After completion, scroll back through the inserted text — verify no garbled characters, no dropped bytes.
**result:** pass/fail (TBD)

### 2. Scroll back through 8K lines of BASIC output (SESS-01 / SC-2)
**expected:** Scrollback retains 8K lines (within the 10K cap); wheel + Shift+PgUp navigate smoothly; theme toggle while scrolled-up keeps the row offset (D-13); cursor is hidden while scrolled (D-09); chip shows accurate count.
**steps:**
1. Run a BASIC `for i = 0 to 8000 : print i : next` on the MicroBeast.
2. Wait until the loop completes.
3. Scroll up via mouse wheel — verify smooth 3-line/notch increments (D-02).
4. Press Shift+PgUp — verify 24-line jumps.
5. Press Shift+Home — verify jump to top of scrollback.
6. While scrolled up, toggle theme via Ctrl+Alt+T — verify viewport stays at the same row offset (D-13).
7. Press Shift+End — verify snap to live tail.
**result:** pass/fail (TBD)

### 3. Copy a command from history and paste it back (SESS-02 / SESS-03 / SC-1)
**expected:** Drag-select on canvas paints inverted glyphs; Ctrl+Shift+C copies plain text; Ctrl+Shift+V pastes back into the MicroBeast.
**steps:**
1. With CP/M prompt visible, scroll up to a previously-typed command (e.g. `DIR`).
2. Drag-select the command via mouse.
3. Verify selection paints as inverted glyphs.
4. Press Ctrl+Shift+C.
5. Verify selection clears (D-19).
6. Paste into a separate text editor (TextEdit / Notepad / etc.) — verify content matches.
7. Snap to live tail (Shift+End or click chip).
8. Press Ctrl+Shift+V.
9. Verify the text is sent to the MicroBeast (echoed back at the prompt).
**result:** pass/fail (TBD)

### 4. Theme toggle while scrolled up (RENDER-06 / SESS-01 / D-13)
**expected:** Toggling between CRT and clean themes while scrolled up keeps the row offset; the same scrolled-up rows re-paint with the new theme's colors.
**steps:**
1. Generate enough scrollback (Test 2's BASIC loop suffices).
2. Scroll up to row offset ~50.
3. Press Ctrl+Alt+T (theme toggle).
4. Verify viewport offset stays at 50; cells repaint with new theme colors; selection (if any) clears.
5. Press Ctrl+Alt+T again (toggle back).
6. Verify same-offset preservation.
**result:** pass/fail (TBD)

### 5. Clear-screen before / during long output (SESS-06 / D-26)
**expected:** Clear button wipes the visible 80×24 grid via the `Terminal::clear_visible()` Rust API (NOT ESC J); Shift+click also wipes scrollback; mid-output clear does NOT corrupt incoming bytes.
**steps:**
1. Start a `for i = 0 to 1000 : print i : next` BASIC loop.
2. While the loop is mid-stream, click the top-bar Clear button.
3. Verify the visible grid wipes; output continues (next line appears at row 0); scrollback is INTACT (scroll up to verify earlier numbers still there).
4. Wait for the loop to finish.
5. Shift+click Clear.
6. Verify scrollback is also wiped (snap to bottom; empty grid; scrollback empty).
**result:** pass/fail (TBD)

### 6. Full reload restores prefs + port preset (PREF-01 / PREF-02 / PLAT-05 / D-32 / D-36)
**expected:** Theme + phosphor + zoom + serial config + localEcho + crlfMode all persist across reload via `bestialitty.prefs`; port permission persists via `bestialitty.port.preset` (Phase 5 D-31 — separate key).
**steps:**
1. Start fresh: clear browser site data for the BestialiTTY origin.
2. Visit the deployed URL.
3. Verify defaults (D-36): CRT theme, green phosphor, fontZoom=1, MicroBeast preset (19200 8N1 none none), localEcho off, crlfMode=cr, autoConnect=off.
4. Click Connect → port picker → select MicroBeast.
5. Customize: toggle to clean theme, switch to amber phosphor, Ctrl++ to zoom 2x, enable local echo, change crlfMode radio to LF.
6. Wait 1 second (debounce flush).
7. Hard-refresh (Ctrl+Shift+R).
8. Verify ALL customizations persist.
**result:** pass/fail (TBD)

### 7. Auto-connect on second visit (D-34 / PLAT-05)
**expected:** With `prefs.autoConnect=true` AND a previously-granted port, the page silently calls `connectMicroBeast()` after wasm + canvas boot; no port picker; no user click.
**steps:**
1. Continuing from Test 6 (port previously granted).
2. Open Settings pane → check "Auto connect on load".
3. Wait for debounce flush (1 s).
4. Hard-refresh.
5. Verify Connect button transitions through `Connecting…` → `Disconnect` automatically; no port picker shown; live MicroBeast output streams in.
6. Optional: disable Auto connect → reload → verify Connect stays in "Connect" (gray) state until clicked.
**result:** pass/fail (TBD)

### 8. 24-hour soak (SC-2 / D-40 — see 06-SOAK.md)
**expected:** Memory-flat across 24 hours; pass criterion in 06-SOAK.md.
**steps:**
1. Follow 06-SOAK.md protocol verbatim.
2. Capture the sampler output post-run.
3. Verify primary criterion (byteLength stable within ±10% after first 10 min).
4. Append result to 06-SOAK.md `## Result` section.
**result:** pass/fail (TBD — soak runs out-of-band)

## Out-of-band manual checks (also from 06-VALIDATION.md)

These are SHORT (< 5 min) manual verifications that ride alongside the 8 main tests:

### A. Real-clipboard handshake (SESS-02 / SESS-03)
**expected:** Playwright clipboard mocks bypass Chromium's user-gesture requirement; one round-trip with the real OS clipboard proves the read-permission grant flow.
**steps:** Open Chromium with no prior site permission for the deployed URL → drag-select on canvas → Ctrl+Shift+C → confirm clipboard contains expected text via OS paste-buffer reader (e.g. `xclip -o`) → Ctrl+Shift+V → confirm bytes hit the wire.

### B. GitHub Pages first-deploy headers (PLAT-03)
**expected:** After first push to main, the deployed `index.html` returns `Content-Type: text/html` and `pkg/*.wasm` returns `Content-Type: application/wasm`.
**steps:** `curl -I https://<user>.github.io/bestialitty/` and `curl -I https://<user>.github.io/bestialitty/pkg/<filename>.wasm` — confirm both headers. If wasm is served as `text/html` (historical GH Pages bug), document the fallback in README.

### C. CSP defense-in-depth check (PLAT-03)
**expected:** Loading the deployed page → DevTools → check that `script-src 'self' 'wasm-unsafe-eval'` is enforced.
**steps:** Open DevTools Console → attempt to inject `<script src="data:text/javascript,console.log('xss')"></script>` via DOM manipulation → verify CSP blocks it (Console error: "Refused to load the script ...").

---

*Phase: 06-daily-driver-polish-session-deployment*
*Document version: draft (UAT pending)*
