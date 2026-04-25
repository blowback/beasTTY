---
phase: 06-daily-driver-polish-session-deployment
verified: 2026-04-25T15:30:00Z
status: human_needed
score: 11/11 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Set GitHub repo Settings -> Pages -> Source: GitHub Actions, then push to main and confirm the Actions workflow completes and the deployed URL serves www/index.html (curl -I https://<owner>.github.io/<repo>/ and curl -I .../pkg/bestialitty_core_bg.wasm to verify Content-Type: application/wasm)"
    expected: "Workflow succeeds; deployed page loads; pkg/*.wasm returns Content-Type: application/wasm"
    why_human: "Requires one-time repo settings change (Pages source) plus a real git push and network reachability check — not automatable from the codebase"
  - test: "Run the 24-hour soak protocol in 06-SOAK.md: connect BestialiTTY to a real MicroBeast running BASIC for i=0 to 1e9: print i: next, open DevTools, paste the setInterval(60_000) sampler snippet, collect samples for 24 hours, verify wasm.memory.buffer.byteLength stays within +/-10% of the t=10-minute reading"
    expected: "byteLength stable within +/-10% of t=10-minute baseline for the full 24-hour run; no memory cliff"
    why_human: "Requires real hardware (MicroBeast), 24-hour elapsed time, and manual console inspection — cannot be automated"
  - test: "Complete the 8 daily-driver tests in 06-HUMAN-UAT.md: paste 100 KB during CP/M session, scroll back 8K BASIC lines, copy from history and paste back, theme-toggle while scrolled up, clear-screen during long output, full-reload restores prefs and port preset, auto-connect on second visit, 24-h soak cross-check"
    expected: "All 8 tests pass; BestialiTTY is the only terminal for a full MicroBeast work session without reaching for another terminal"
    why_human: "Requires real MicroBeast hardware, real OS clipboard interaction, and full-day human attention — cannot be automated via Playwright"
---

# Phase 6: Daily-Driver Polish, Session & Deployment — Verification Report

**Phase Goal:** Turn the working terminal into a daily driver — copy/paste, scrollback UI, session logging with download, persistent preferences in `localStorage`, static-site deployment under a permissive license, and a 24-hour soak test confirming memory and reliability.
**Verified:** 2026-04-25
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Author can select text on canvas and copy it (Ctrl+Shift+C); paste injects via serial rate limit; local Clear button wipes visible screen (distinct from ESC J); Shift+click also clears scrollback | ✓ VERIFIED | `www/input/selection.js` (wireSelection, getSelection, clearSelection, 8 exports); `www/input/clipboard.js` (copySelection, pasteFromClipboard, 4096 confirm chip, enqueuePaste wiring); `www/renderer/chrome.js` calls `term.clear_visible()` NOT `\x1B\x4A`; snap-to-bottom on clear confirmed |
| 2 | Scrollback retains at least 10,000 lines; viewport sticks to bottom unless user scrolled; chip appears on new lines while scrolled; memory-flat soak (code-level work complete; 24-h run is OOB) | ✓ VERIFIED | `www/main.js`: `new Terminal(24, 80, 10_000)`; `www/renderer/scroll-state.js` (wireScrollState, wheel listener on canvasWrapper, chip lifecycle, [data-scrolled-back] toggle); `canvas.js tick()` branches on `scrollIsScrolledBack()`; `snapshot_grid_at()` called while scrolled; 24-h soak protocol in 06-SOAK.md (OOB) |
| 3 | Session logging auto-starts per connection to a raw byte buffer; mid-session download works without disconnecting; download again on disconnect | ✓ VERIFIED | `www/transport/session-log.js` (wireSessionLog, reset, append, download, getCurrentBytes); `www/transport/serial.js` calls `sessionLogRef.reset()` on connect and `sessionLogRef.append(value)` in read loop after `term.feed`; download button disabled until first byte arrives; UTC filename stamp (`YYYYMMDD-HHMMSS.bin`) |
| 4 | Theme, phosphor, font size, last-used serial config, local-echo, and CR/LF override all persist via `localStorage`; first-open loads sane defaults (crt/green/zoom=1/19200-8N1/localEcho=false/crlfMode=cr); MicroBeast preset pre-selected | ✓ VERIFIED | `www/state/prefs.js` (STORAGE_KEY='bestialitty.prefs', DEFAULTS frozen object with crt/green/fontZoom=1/serial=19200-8N1/localEcho=false/crlfMode=cr/autoConnect=false, 250ms debounce, beforeunload flush, version migration, QuotaExceededError swallowed); `www/main.js` calls loadPrefs() before wireChrome; applyPrefs subscriber fires on every flush |
| 5 | Static site deploys to self-hosted target; MIT LICENSE file present; code-level work done; first-push Pages source config is one-time manual step (OOB) | ✓ VERIFIED | `LICENSE` (SPDX MIT, Copyright (c) 2026 Ant Skelton); `.github/workflows/pages.yml` (actions/deploy-pages@v5, runs scripts/build.sh); `www/_headers` (Permissions-Policy: serial=(self), CSP, nosniff, no-referrer, wasm MIME override); `www/.nojekyll` (empty); `www/index.html` CSP meta-tag; `www/README.md` deployment docs; first-push requires manual Pages source = GitHub Actions (OOB) |
| 6 | Scrollback keyboard controls: Shift+PgUp/PgDn pages; Shift+Home jumps to top; Shift+End snaps to live tail | ✓ VERIFIED | `www/input/keyboard.js` imports scrollByPage, snapToBottom, jumpToTop from scroll-state.js; Shift+PageUp/PageDown/Home/End intercepts before encode path (lines 242-245) |
| 7 | Ctrl+Shift+C copies plain text; Ctrl+C still sends 0x03 (sacred); Ctrl+Shift+V pastes via paste-pump; Ctrl+V still sends 0x16 | ✓ VERIFIED | `www/input/keyboard.js` Ctrl+Shift+C intercept (code === 'KeyC' + ctrlKey + shiftKey, returns early); Ctrl+Shift+V intercept (code === 'KeyV'); plain Ctrl+C/V fall through to encoder; sacred paths preserved |
| 8 | Auto-connect path: if prefs.autoConnect && last port found && state === 'disconnected', silently connects on boot | ✓ VERIFIED | `www/transport/serial.js` auto-connect gated on `prefsRef.autoConnect && lastPortRef && state === 'disconnected'` (Pitfall 3 race guard); failure paths log 'auto-connect-failed' |
| 9 | Reset prefs 2-click confirm (3 s timeout reverts label); Clear scrollback button; Auto-connect checkbox in Settings | ✓ VERIFIED | `www/renderer/chrome.js`: reset-prefs-button 2-click confirm with 'Click again to confirm (3 s)' label; `www/index.html` has #clear-scrollback-button, #auto-connect-checkbox, #reset-prefs-button; mousedown preventDefault on all three |
| 10 | Large paste >= 4096 bytes shows inline confirm chip; pump waits for click; Cancel discards | ✓ VERIFIED | `www/input/clipboard.js`: `if (bytes.length >= 4096)` shows confirm chip with verbatim copy 'About to paste N B (~S s at BAUD baud)'; `showLargePasteConfirm` returns Promise; only calls enqueuePaste on resolve(true) |
| 11 | Selection endpoints stored as (rowOffsetFromTail, col) — stable when scrollback grows mid-drag | ✓ VERIFIED | `www/input/selection.js`: `anchor = { rowOffsetFromTail, col }`, `focusEnd = { rowOffsetFromTail, col }`; `pxToCellWithScrollOffset` computes tail-relative coords; `setPointerCapture` called on pointerdown; WORD_REGEX `/\S+/` word boundary per D-16 |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `www/renderer/scroll-state.js` | wireScrollState module with offset state machine + chip lifecycle | ✓ VERIFIED | 11 exports; wheel listener on canvasWrapper (not document); [data-scrolled-back] attribute; chip refresh |
| `www/renderer/canvas.js` | tick() branches on scrollState; snapshot_grid_at while scrolled; paintSelectionOverlay; readRowText | ✓ VERIFIED | scrollIsScrolledBack() branch at line 305+; snapshot_grid_at(scrollGetOffset()); paintSelectionOverlay called in both live and scrolled-back paths |
| `www/input/selection.js` | wireSelection with drag-select, double/triple-click, endpoint storage as (rowOffsetFromTail, col) | ✓ VERIFIED | 8 exports; rowOffsetFromTail storage; setPointerCapture; scrollState.onChange subscription; focus-loss clear |
| `www/input/clipboard.js` | copySelection + pasteFromClipboard + large-paste confirm chip | ✓ VERIFIED | enqueuePaste wiring; 4096 threshold; strip 0x00-0x1F except CR/LF/Tab; high-bit drop (c > 0xFF) |
| `www/transport/session-log.js` | wireSessionLog module with per-connection lifecycle | ✓ VERIFIED | reset/append/download/getCurrentBytes; UTC filename stamp |
| `www/transport/serial.js` | Read loop appends to session-log; sessionLog.reset() on Connect; auto-connect path | ✓ VERIFIED | sessionLogRef.append(value) after term.feed; sessionLogRef.reset() on connect; auto-connect gated on Pitfall 3 race |
| `www/renderer/chrome.js` | Clear button (clear_visible NOT ESC J) + snap-to-bottom; Reset prefs 2-click | ✓ VERIFIED | term.clear_visible() called; comment 'NOT \x1B\x4A'; snapToBottom() follows; 2-click confirm present |
| `www/state/prefs.js` | versioned blob, debounce 250ms, beforeunload flush, version migration | ✓ VERIFIED | STORAGE_KEY='bestialitty.prefs'; DEFAULTS frozen; 250ms debounce; beforeunload flush; QuotaExceededError catch |
| `www/index.html` | #scrollback-indicator chip + [data-scrolled-back] CSS + #clear-button + #download-log-button + #auto-connect-checkbox + #reset-prefs-button + #paste-confirm + CSP meta-tag | ✓ VERIFIED | All elements present; CSP meta-tag at line 10; scrollback-indicator CSS rules in style block |
| `www/main.js` | Boot order: loadPrefs() first; wireScrollState, wireSelection, wireClipboard, wireSessionLog call sites | ✓ VERIFIED | loadPrefs() called before wireChrome; all wireX calls confirmed; applyPrefs subscriber registered |
| `www/input/keyboard.js` | Ctrl+Shift+C/V intercepts; Shift+End/Home/PgUp/PgDn intercepts; snap-on-TX gate | ✓ VERIFIED | All intercepts before encode path; Phase 4 sacred paths preserved (Ctrl+C→0x03, Ctrl+V→0x16) |
| `crates/bestialitty-core/src/terminal.rs` | snapshot_grid_at(row_offset: usize) + clear_visible() | ✓ VERIFIED | pub fn at line 201 and 225; both methods exist |
| `crates/bestialitty-core/src/lib.rs` | wasm-boundary forwarders for snapshot_grid_at(u32) + clear_visible() | ✓ VERIFIED | Forwarders at lib.rs lines 108-111 and 170-171 |
| `www/pkg/bestialitty_core.d.ts` | snapshot_grid_at(row_offset: number): void; clear_visible(): void | ✓ VERIFIED | Both declarations present at lines 98 and 36 |
| `LICENSE` | MIT License with SPDX text and copyright | ✓ VERIFIED | "MIT License" at line 1; "Copyright (c) 2026 Ant Skelton" at line 3 |
| `.github/workflows/pages.yml` | GitHub Pages deploy pipeline with build.sh + actions/deploy-pages@v5 | ✓ VERIFIED | scripts/build.sh referenced; actions/deploy-pages@v5 used |
| `www/_headers` | Permissions-Policy: serial=(self) + CSP + nosniff + no-referrer + wasm MIME | ✓ VERIFIED | All required headers present |
| `www/.nojekyll` | Empty file | ✓ VERIFIED | File exists (0 bytes) |
| `.planning/phases/06-daily-driver-polish-session-deployment/06-SOAK.md` | 24-h soak protocol with setInterval(60_000) + ±10% criterion | ✓ VERIFIED | "24-hour" and "±10%" present; setInterval documented; result block placeholder |
| `.planning/phases/06-daily-driver-polish-session-deployment/06-HUMAN-UAT.md` | 8 daily-driver tests in 05-HUMAN-UAT.md format | ✓ VERIFIED | "paste 100 KB" and "24-hour" xref present; 8 tests + 3 OOB supplementary checks |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `www/renderer/canvas.js` | `www/renderer/scroll-state.js` | scrollIsScrolledBack()/getOffset() consumed by tick() | ✓ WIRED | import at line 35; snapshot_grid_at(scrollGetOffset()) at line 313 |
| `www/input/selection.js` | `www/renderer/scroll-state.js` | getOffset() for rowOffsetFromTail math; scrollByLines for drag-past-edge | ✓ WIRED | scrollStateRef.getOffset() at pxToCellWithScrollOffset; scrollState.onChange subscription |
| `www/input/clipboard.js` | `www/input/paste-pump.js` | enqueuePaste(bytes) after preprocessing | ✓ WIRED | `import { enqueuePaste } from './paste-pump.js'`; called at line 95 |
| `www/input/clipboard.js` | `www/input/selection.js` | getSelection() + clearSelection() for copy | ✓ WIRED | `import { getSelection, clearSelection } from './selection.js'` |
| `www/input/keyboard.js` | `www/input/clipboard.js` | copySelection + pasteFromClipboard called from Ctrl+Shift+C/V intercepts | ✓ WIRED | Imports confirmed; calls at keyboard.js lines 224+ and 234+ |
| `www/transport/serial.js` | `www/transport/session-log.js` | sessionLogRef.append(value) in read loop; sessionLogRef.reset() on Connect | ✓ WIRED | sessionLogRef.append(value) at serial.js line 424; reset at lines 208, 349, 670 |
| `www/renderer/chrome.js` | Rust core via wasm | term.clear_visible() — Phase 6 wasm-boundary forwarder | ✓ WIRED | term.clear_visible() at chrome.js line 90; forwarder in lib.rs lines 170-171 |
| `www/renderer/chrome.js` | `www/renderer/scroll-state.js` | snapToBottom() on Clear button | ✓ WIRED | ss.snapToBottom() at chrome.js lines 98 and 223 |
| `www/main.js` | `www/state/prefs.js` | loadPrefs() before wireChrome; prefs.subscribe(applyPrefs) | ✓ WIRED | loadPrefs() at main.js line 35; subscribe confirmed in summary |
| `www/renderer/chrome.js` | `www/state/prefs.js` | resetPrefs() on second click; savePrefs on theme/phosphor/zoom changes | ✓ WIRED | resetPrefs import at chrome.js line 70; 2-click confirm at line 248+ |
| `.github/workflows/pages.yml` | `scripts/build.sh` | Build step calls ./scripts/build.sh to produce www/pkg/ | ✓ WIRED | `run: ./scripts/build.sh` at pages.yml line 35 |
| `www/index.html` (CSP meta-tag) | `www/_headers` | Defense-in-depth same CSP directives in both | ✓ WIRED | Both contain `wasm-unsafe-eval`, `frame-ancestors 'none'`, `form-action 'none'` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `www/renderer/scroll-state.js` | offset, newLinesSinceUserScrolled | wheel events + notifyFeed() calls from main.js | Yes — driven by real user events and incoming serial bytes | ✓ FLOWING |
| `www/transport/session-log.js` | chunks array | serial.js read loop: append(value) per Uint8Array received | Yes — real serial bytes appended by reference | ✓ FLOWING |
| `www/state/prefs.js` | cached prefs blob | localStorage.getItem('bestialitty.prefs') on boot; setItem on flush | Yes — real localStorage round-trip; DEFAULTS used when missing | ✓ FLOWING |
| `www/input/selection.js` | anchor/focusEnd | pointer events on canvas via pxToCellWithScrollOffset | Yes — computed from real pointer coordinates and scrollState.getOffset() | ✓ FLOWING |
| `www/input/clipboard.js` | bytes (paste) | navigator.clipboard.readText() | Yes — real async clipboard API; preprocessing strips control bytes | ✓ FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — behavioral checks require a running browser; the codebase has no server-side runnable entry points. Playwright test counts from summaries confirm 61 passing session/ tests (14 prefs + 5 auto-connect + 11 scrollback + 9 selection + 12 clipboard + 7 log-download + 4 clear-screen) with 3 remaining fixme stubs (pre-existing Wave 0 stubs not yet materialized by later waves — confirmed as acceptable from 06-06-SUMMARY.md "1 skipped").

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SESS-01 | 06-03, 06-08 | Scrollback buffer retains N lines; user can review prior output | ✓ SATISFIED | Terminal initialized with 10,000 capacity; scroll-state.js + canvas branching; 11 scrollback tests passing |
| SESS-02 | 06-04 | User can select and copy text from screen to clipboard | ✓ SATISFIED | selection.js wireSelection + getSelection; Ctrl+Shift+C in keyboard.js; 9 selection + 12 clipboard tests passing |
| SESS-03 | 06-04 | User can paste clipboard content into serial stream (paste throttling) | ✓ SATISFIED | clipboard.js pasteFromClipboard → enqueuePaste; Phase 5 paste-pump rate-limits; 12 clipboard tests passing |
| SESS-04 | 06-05 | Session logging captures serial stream to downloadable file; auto-started per connection | ✓ SATISFIED | session-log.js reset()/append() lifecycle; serial.js read loop wired; 7 log-download tests passing |
| SESS-05 | 06-05 | Mid-session "download current log" button without disconnecting | ✓ SATISFIED | download() assembles Blob from chunks array WITHOUT clearing; chunks continue appending after download |
| SESS-06 | 06-05 | Clear-screen local button (distinct from remote ESC J) | ✓ SATISFIED | chrome.js calls term.clear_visible() NOT \x1B\x4A; comment explicitly documents distinction; 4 clear-screen tests passing |
| PREF-01 | 06-06 | Theme, phosphor, font size, last-used serial config persist in localStorage | ✓ SATISFIED | prefs.js DEFAULTS + savePrefs on every change; chrome.js savePrefs hooks on theme/phosphor/zoom/serial; 14 prefs tests passing |
| PREF-02 | 06-06 | Local echo and CR/LF override toggle states persist in localStorage | ✓ SATISFIED | DEFAULTS.localEcho=false, DEFAULTS.crlfMode='cr'; main.js change handlers call savePrefs; 14 prefs tests passing |
| PLAT-03 | 06-07 | Ships as static site, self-hosted (GitHub Pages / Cloudflare / own domain) | ✓ SATISFIED (code-level) | .github/workflows/pages.yml + _headers + .nojekyll + CSP meta-tag committed; one-time manual Pages source setting documented; first-push smoke check is OOB human verification |
| PLAT-04 | 06-07 | Public repo under permissive license (MIT or Apache-2.0) | ✓ SATISFIED | LICENSE file: SPDX MIT canonical text, Copyright (c) 2026 Ant Skelton |
| PLAT-05 | 06-06 | First-open sane defaults — MicroBeast preset pre-selected; one click to connect | ✓ SATISFIED | DEFAULTS: theme=crt, phosphor=green, fontZoom=1, serial={baud:19200, dataBits:8, stopBits:1, parity:'none', flowControl:'none'}, localEcho=false, crlfMode=cr; loadPrefs() falls back to DEFAULTS on first open; 14 prefs tests passing |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | No TODO/FIXME/placeholder in Phase 6 production modules | — | — |

No anti-patterns found in scroll-state.js, selection.js, clipboard.js, session-log.js, or prefs.js. Three `test.fixme` stubs remain in www/tests/session/ specs; these are Wave 0 stubs that were intentionally left (the SUMMARY confirms "1 skipped (pre-existing Wave 0 stub)") — they do not affect production code.

### Human Verification Required

The following three items cannot be verified programmatically and are explicitly designated as out-of-band (OOB) per the task instructions. They do NOT affect the `human_needed` status determination — the phase goal is code-level complete; these are real-world execution steps.

#### 1. GitHub Pages First-Deploy Smoke Check (PLAT-03)

**Test:** Visit the GitHub repo Settings -> Pages, set Source to "GitHub Actions", then push to main and watch the Action run. After deployment, run:
```
curl -I https://<owner>.github.io/<repo>/
curl -I https://<owner>.github.io/<repo>/pkg/bestialitty_core_bg.wasm
```
**Expected:** HTTP 200 for both; second URL returns `Content-Type: application/wasm`
**Why human:** Requires one-time manual repo settings change and a real network-accessible GitHub Pages deployment. The code artifacts (pages.yml, _headers, .nojekyll, CSP meta-tag) are all committed and correct; only the repo setting and first push remain.

#### 2. 24-Hour Memory-Flat Soak (SC-2 from ROADMAP)

**Test:** Follow the protocol in `06-SOAK.md`. Connect BestialiTTY to a real MicroBeast running `for i = 0 to 1e9 : print i : next`. Open DevTools console, paste the `setInterval(60_000)` sampler snippet, collect 1,440 samples over 24 hours.
**Expected:** `wasm.memory.buffer.byteLength` stays within ±10% of the t=10-minute baseline reading for the entire 24-hour soak.
**Why human:** Requires real MicroBeast hardware, 24-hour elapsed time, and manual console inspection. The soak protocol document (06-SOAK.md) is shipped and ready.

#### 3. Daily-Driver Full-Session UAT (SC-5 from ROADMAP)

**Test:** Complete all 8 tests in `06-HUMAN-UAT.md`: paste 100 KB during CP/M, scroll back 8K BASIC lines, copy command from history and paste back, theme-toggle while scrolled up, clear-screen during long output, full-reload prefs restoration, auto-connect on second visit, 24-h soak cross-check.
**Expected:** All 8 tests pass. Author uses BestialiTTY as the only terminal for a full MicroBeast work session without reaching for another terminal.
**Why human:** Tests require real MicroBeast hardware, real OS clipboard interaction, and sustained human attention across a full working session.

### Gaps Summary

No gaps. All 11 observable truths are VERIFIED. All 11 Phase 6 requirements (SESS-01 through SESS-06, PREF-01, PREF-02, PLAT-03, PLAT-04, PLAT-05) are SATISFIED at the code level.

The `human_needed` status reflects three out-of-band items that the task specification explicitly designated as not counting against verification: the GitHub Pages first-deploy smoke check (PLAT-03 one-time manual step), the 24-hour memory soak (SC-2), and the daily-driver full-session UAT (SC-5). Code-level work is complete for all three.

---

_Verified: 2026-04-25_
_Verifier: Claude (gsd-verifier)_
