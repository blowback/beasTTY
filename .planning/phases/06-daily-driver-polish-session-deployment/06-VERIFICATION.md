---
phase: 06-daily-driver-polish-session-deployment
verified: 2026-04-25T18:00:00Z
status: human_needed
score: 11/11 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 11/11
  previous_verified: 2026-04-25T15:30:00Z
  gaps_closed:
    - "Top-bar chrome buttons (Connect, Clear, Clean/CRT, Green/Amber/White phosphor radios) appeared non-functional due to applyPrefs subscriber race — structurally fixed in 06-09 via: (1) snapPreset() now calls savePrefsFn({ serial: PRESET_BLOB }) to sync cached prefs blob before flushPrefs can race, and (2) flushPrefs() no longer iterates subscribers (resetPrefs remains the canonical fan-out path). Three commits: 1b71531, 68bdaec, 4c01d11."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Set GitHub repo Settings -> Pages -> Source: GitHub Actions, then push to main and confirm the Actions workflow completes and the deployed URL serves www/index.html (curl -I https://<owner>.github.io/<repo>/ and curl -I .../pkg/bestialitty_core_bg.wasm to verify Content-Type: application/wasm)"
    expected: "Workflow succeeds; deployed page loads; pkg/*.wasm returns Content-Type: application/wasm"
    why_human: "Requires one-time repo settings change (Pages source) plus a real git push and network reachability check — not automatable from the codebase"
  - test: "Run the 24-hour soak protocol in 06-SOAK.md: connect BestialiTTY to a real MicroBeast running BASIC for i=0 to 1e9: print i: next, open DevTools, paste the setInterval(60_000) sampler snippet, collect samples for 24 hours, verify wasm.memory.buffer.byteLength stays within +/-10% of the t=10-minute reading"
    expected: "byteLength stable within +/-10% of t=10-minute baseline for the full 24-hour run; no memory cliff"
    why_human: "Requires real hardware (MicroBeast), 24-hour elapsed time, and manual console inspection — cannot be automated"
  - test: "Complete the 8 daily-driver tests in 06-HUMAN-UAT.md: paste 100 KB during CP/M session, scroll back 8K BASIC lines, copy from history and paste back, theme-toggle while scrolled up, clear-screen during long output, full-reload restores prefs and port preset, auto-connect on second visit, 24-h soak cross-check. The chrome-buttons blocker (06-UAT.md Test 1) is now structurally closed by plan 06-09; re-run UAT Test 1 in Chromium to confirm before proceeding to Tests 2-7."
    expected: "All 8 tests pass; BestialiTTY is the only terminal for a full MicroBeast work session without reaching for another terminal"
    why_human: "Requires real MicroBeast hardware, real OS clipboard interaction, and full-day human attention — cannot be automated via Playwright"
---

# Phase 6: Daily-Driver Polish, Session & Deployment — Verification Report

**Phase Goal:** Turn the working terminal into a daily driver — copy/paste, scrollback UI, session logging with download, persistent preferences in `localStorage`, static-site deployment under a permissive license, and a 24-hour soak test confirming memory and reliability.
**Verified:** 2026-04-25T18:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after 06-09 gap closure (chrome-buttons race fix)

## Re-Verification Summary

The prior 2026-04-25T15:30:00Z verification (status: human_needed, score: 11/11) flagged three out-of-band human items and zero automated gaps. A subsequent UAT run (06-UAT.md) surfaced a real blocker: top-bar chrome buttons appeared non-functional in live Chromium because plan 06-06's `prefs.subscribe(applyPrefs)` caused `flushPrefs` to re-mutate DOM form controls ~250 ms after every user click, reverting the user's change. Plan 06-09 closed this structurally:

- **1b71531** — `snapPreset()` now calls `savePrefsFn({ serial: PRESET_BLOB })` to sync the cached prefs blob before the next `flushPrefs` can revert the form
- **68bdaec** — `flushPrefs()` no longer iterates subscribers; `resetPrefs()` remains the canonical subscriber fan-out (D-35 preserved)
- **4c01d11** — gap-closure plan documented

Post-fix test results per 06-09-SUMMARY.md: 168 Playwright tests pass, 1 skipped (pre-existing Wave 0 stub), 0 failed. The previously flaky `'Reset to MicroBeast preset'` transport test now passes deterministically 10/10 under `--retries=0 --repeat-each=10`. Two new no-revert regression tests added to `www/tests/session/prefs.spec.js`.

## Codebase Verification (Re-Check)

### Key structural claims verified against actual files:

**`www/state/prefs.js`** — `flushPrefs` no longer contains `for (const fn of subscribers)`. Grep over the file returns exactly **1** occurrence of that pattern, located at line 113 inside `resetPrefs()` only. The `flushPrefs()` function body (lines 80-95) ends with `// No subscriber fan-out here` comment. The `savePrefs`, `resetPrefs`, `subscribe`, `loadPrefs`, `getPrefs`, and `DEFAULTS` exports are byte-identical in name, arity, and shape.

**`www/transport/serial.js`** — `snapPreset()` (lines 302-327) contains exactly **1** call to `savePrefsFn({` within the function body. The call is gated on `if (savePrefsFn)`, passes `{ serial: { baud: PRESET_CONFIG.baudRate, dataBits, stopBits, parity, flowControl } }` with correct D-32 field-name translation (`baud` not `baudRate`), and is placed after the five `.value` mutations and before `hideReconnectHint()`.

**`www/tests/session/prefs.spec.js`** — now contains 16 tests (14 pre-existing + 2 new). The new tests at lines 223-243 (`'flushPrefs does NOT fire subscribers — no DOM revert after debounce window @fast'`) and lines 245-260 (`'phosphor DOM state survives the 250ms debounce window — no race-revert @fast'`) exercise the structural fix directly.

**`www/tests/transport/config.spec.js`** — `'Reset to MicroBeast preset button snaps all five selects to defaults'` test at line 32 exists unchanged; the production fix in `snapPreset` un-flakes it deterministically.

**Git commits** — `1b71531`, `68bdaec`, `4c01d11` confirmed in git log.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Author can select text on canvas and copy it (Ctrl+Shift+C); paste injects via serial rate limit; local Clear button wipes visible screen (distinct from ESC J); Shift+click also clears scrollback | ✓ VERIFIED | `www/input/selection.js` (wireSelection, getSelection, clearSelection, 8 exports); `www/input/clipboard.js` (copySelection, pasteFromClipboard, 4096 confirm chip, enqueuePaste wiring); `www/renderer/chrome.js` calls `term.clear_visible()` NOT `\x1B\x4A`; snap-to-bottom on clear confirmed |
| 2 | Scrollback retains at least 10,000 lines; viewport sticks to bottom unless user scrolled; chip appears on new lines while scrolled; memory-flat soak (code-level work complete; 24-h run is OOB) | ✓ VERIFIED | `www/main.js`: `new Terminal(24, 80, 10_000)`; `www/renderer/scroll-state.js` (wireScrollState, wheel listener on canvasWrapper, chip lifecycle, [data-scrolled-back] toggle); `canvas.js tick()` branches on `scrollIsScrolledBack()`; `snapshot_grid_at()` called while scrolled; 24-h soak protocol in 06-SOAK.md (OOB) |
| 3 | Session logging auto-starts per connection to a raw byte buffer; mid-session download works without disconnecting; download again on disconnect | ✓ VERIFIED | `www/transport/session-log.js` (wireSessionLog, reset, append, download, getCurrentBytes); `www/transport/serial.js` calls `sessionLogRef.reset()` on connect and `sessionLogRef.append(value)` in read loop after `term.feed`; download button disabled until first byte arrives; UTC filename stamp (`YYYYMMDD-HHMMSS.bin`) |
| 4 | Theme, phosphor, font size, last-used serial config, local-echo, and CR/LF override all persist via `localStorage`; first-open loads sane defaults (crt/green/zoom=1/19200-8N1/localEcho=false/crlfMode=cr); MicroBeast preset pre-selected | ✓ VERIFIED | `www/state/prefs.js` (STORAGE_KEY='bestialitty.prefs', DEFAULTS frozen object, 250ms debounce, beforeunload flush, version migration, QuotaExceededError swallowed); `www/main.js` calls loadPrefs() before wireChrome; applyPrefs subscriber fires on resetPrefs but NOT on flushPrefs (06-09 fix) |
| 5 | Static site deploys to self-hosted target; MIT LICENSE file present; code-level work done; first-push Pages source config is one-time manual step (OOB) | ✓ VERIFIED | `LICENSE` (SPDX MIT, Copyright (c) 2026 Ant Skelton); `.github/workflows/pages.yml` (actions/deploy-pages@v5, runs scripts/build.sh); `www/_headers` (Permissions-Policy: serial=(self), CSP, nosniff, no-referrer, wasm MIME override); `www/.nojekyll` (empty); first-push requires manual Pages source = GitHub Actions (OOB) |
| 6 | Scrollback keyboard controls: Shift+PgUp/PgDn pages; Shift+Home jumps to top; Shift+End snaps to live tail | ✓ VERIFIED | `www/input/keyboard.js` imports scrollByPage, snapToBottom, jumpToTop from scroll-state.js; Shift+PageUp/PageDown/Home/End intercepts before encode path |
| 7 | Ctrl+Shift+C copies plain text; Ctrl+C still sends 0x03 (sacred); Ctrl+Shift+V pastes via paste-pump; Ctrl+V still sends 0x16 | ✓ VERIFIED | `www/input/keyboard.js` Ctrl+Shift+C intercept (code === 'KeyC' + ctrlKey + shiftKey, returns early); Ctrl+Shift+V intercept (code === 'KeyV'); plain Ctrl+C/V fall through to encoder; sacred paths preserved |
| 8 | Auto-connect path: if prefs.autoConnect && last port found && state === 'disconnected', silently connects on boot | ✓ VERIFIED | `www/transport/serial.js` auto-connect gated on `prefsRef.autoConnect && lastPortRef && state === 'disconnected'` (Pitfall 3 race guard); failure paths log 'auto-connect-failed' |
| 9 | Reset prefs 2-click confirm (3 s timeout reverts label); Clear scrollback button; Auto-connect checkbox in Settings | ✓ VERIFIED | `www/renderer/chrome.js`: reset-prefs-button 2-click confirm with 'Click again to confirm (3 s)' label; `www/index.html` has #clear-scrollback-button, #auto-connect-checkbox, #reset-prefs-button; mousedown preventDefault on all three |
| 10 | Large paste >= 4096 bytes shows inline confirm chip; pump waits for click; Cancel discards | ✓ VERIFIED | `www/input/clipboard.js`: `if (bytes.length >= 4096)` shows confirm chip; `showLargePasteConfirm` returns Promise; only calls enqueuePaste on resolve(true) |
| 11 | Selection endpoints stored as (rowOffsetFromTail, col) — stable when scrollback grows mid-drag | ✓ VERIFIED | `www/input/selection.js`: `anchor = { rowOffsetFromTail, col }`, `focusEnd = { rowOffsetFromTail, col }`; `pxToCellWithScrollOffset` computes tail-relative coords; `setPointerCapture` called on pointerdown |

**Score:** 11/11 truths verified

### 06-09 Gap-Closure Must-Haves (Re-Checked)

| Truth | Status | Evidence |
|-------|--------|----------|
| Clicking Reset preset snaps 5 serial selects to MicroBeast preset AND survives past 300 ms (no race-revert) | ✓ VERIFIED | snapPreset() calls savePrefsFn({ serial: PRESET_BLOB }) before hideReconnectHint(); cached prefs blob stays in sync so flushPrefs is idempotent; confirmed at serial.js lines 315-326 |
| Clicking a phosphor radio flips aria-pressed AND that pressed-state survives past 300 ms | ✓ VERIFIED | flushPrefs no longer iterates subscribers; structural fix confirmed by grep (1 occurrence of subscriber loop in resetPrefs only); new regression test `'phosphor DOM state survives the 250ms debounce window'` passes 1/1 |
| Clicking theme toggle flips body[data-theme] AND survives past 300 ms | ✓ VERIFIED | Same structural fix applies uniformly to all DOM-mutating user actions; flushPrefs cannot re-apply stale cached state via applyPrefs |
| After any user-driven savePrefs(), the in-flight 250 ms flushPrefs DOES NOT re-mutate DOM form controls | ✓ VERIFIED | `grep -c 'for (const fn of subscribers)' www/state/prefs.js` returns 1 (in resetPrefs only); new test `'flushPrefs does NOT fire subscribers'` passes 1/1 |
| resetPrefs() continues to fire subscribers (D-35 in-place reset path intact) | ✓ VERIFIED | resetPrefs() at prefs.js line 110-114 retains `for (const fn of subscribers) fn(cached);` verbatim; existing 'Reset prefs button: second click' test confirms subscribers are fired |
| Existing prefs round-trip tests still pass | ✓ VERIFIED | Full suite: 168 passed, 1 skipped, 0 failed under --retries=0 (per 06-09-SUMMARY.md; independently consistent with structural changes verified in code) |
| Pre-existing flaky 'Reset to MicroBeast preset' test now runs green without retries | ✓ VERIFIED | Passes 10/10 under --retries=0 --repeat-each=10 (per 06-09-SUMMARY.md); root cause was snapPreset not syncing cached prefs blob — fixed |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `www/renderer/scroll-state.js` | wireScrollState module with offset state machine + chip lifecycle | ✓ VERIFIED | 11 exports; wheel listener on canvasWrapper; [data-scrolled-back] attribute; chip refresh |
| `www/renderer/canvas.js` | tick() branches on scrollState; snapshot_grid_at while scrolled; paintSelectionOverlay; readRowText | ✓ VERIFIED | scrollIsScrolledBack() branch; snapshot_grid_at(scrollGetOffset()); paintSelectionOverlay called in both live and scrolled-back paths |
| `www/input/selection.js` | wireSelection with drag-select, double/triple-click, endpoint storage as (rowOffsetFromTail, col) | ✓ VERIFIED | 8 exports; rowOffsetFromTail storage; setPointerCapture; scrollState.onChange subscription |
| `www/input/clipboard.js` | copySelection + pasteFromClipboard + large-paste confirm chip | ✓ VERIFIED | enqueuePaste wiring; 4096 threshold; strip 0x00-0x1F except CR/LF/Tab |
| `www/transport/session-log.js` | wireSessionLog module with per-connection lifecycle | ✓ VERIFIED | reset/append/download/getCurrentBytes; UTC filename stamp |
| `www/transport/serial.js` | Read loop appends to session-log; sessionLog.reset() on Connect; auto-connect path; snapPreset syncs cached prefs blob (06-09) | ✓ VERIFIED | sessionLogRef.append(value) after term.feed; sessionLogRef.reset() on connect; snapPreset calls savePrefsFn({ serial: PRESET_BLOB }) at lines 315-326 gated on `if (savePrefsFn)` |
| `www/renderer/chrome.js` | Clear button (clear_visible NOT ESC J) + snap-to-bottom; Reset prefs 2-click | ✓ VERIFIED | term.clear_visible() called; comment 'NOT \x1B\x4A'; snapToBottom() follows; 2-click confirm present |
| `www/state/prefs.js` | versioned blob, debounce 250ms, beforeunload flush, version migration; flushPrefs does NOT fire subscribers (06-09) | ✓ VERIFIED | STORAGE_KEY='bestialitty.prefs'; DEFAULTS frozen; 250ms debounce; beforeunload flush; QuotaExceededError catch; flushPrefs ends at saveTimer=null with comment block; subscriber loop present only in resetPrefs |
| `www/index.html` | #scrollback-indicator chip + [data-scrolled-back] CSS + all chrome elements + CSP meta-tag | ✓ VERIFIED | All elements present; CSP meta-tag; scrollback-indicator CSS rules |
| `www/main.js` | Boot order: loadPrefs() first; wireScrollState, wireSelection, wireClipboard, wireSessionLog call sites; applyPrefs subscriber registered | ✓ VERIFIED | loadPrefs() called before wireChrome; all wireX calls confirmed; applyPrefs subscriber registered |
| `www/input/keyboard.js` | Ctrl+Shift+C/V intercepts; Shift+End/Home/PgUp/PgDn intercepts; snap-on-TX gate | ✓ VERIFIED | All intercepts before encode path; Phase 4 sacred paths preserved |
| `crates/bestialitty-core/src/terminal.rs` | snapshot_grid_at(row_offset: usize) + clear_visible() | ✓ VERIFIED | pub fn at lines 201 and 225 |
| `crates/bestialitty-core/src/lib.rs` | wasm-boundary forwarders for snapshot_grid_at(u32) + clear_visible() | ✓ VERIFIED | Forwarders at lib.rs lines 108-111 and 170-171 |
| `www/pkg/bestialitty_core.d.ts` | snapshot_grid_at(row_offset: number): void; clear_visible(): void | ✓ VERIFIED | Both declarations present |
| `LICENSE` | MIT License with SPDX text and copyright | ✓ VERIFIED | "MIT License"; "Copyright (c) 2026 Ant Skelton" |
| `.github/workflows/pages.yml` | GitHub Pages deploy pipeline with build.sh + actions/deploy-pages@v5 | ✓ VERIFIED | scripts/build.sh referenced; actions/deploy-pages@v5 used |
| `www/_headers` | Permissions-Policy: serial=(self) + CSP + nosniff + no-referrer + wasm MIME | ✓ VERIFIED | All required headers present |
| `www/.nojekyll` | Empty file | ✓ VERIFIED | File exists (0 bytes) |
| `.planning/phases/06-daily-driver-polish-session-deployment/06-SOAK.md` | 24-h soak protocol with setInterval(60_000) + ±10% criterion | ✓ VERIFIED | Protocol document present with criterion |
| `.planning/phases/06-daily-driver-polish-session-deployment/06-HUMAN-UAT.md` | 8 daily-driver tests in documented format | ✓ VERIFIED | 8 tests + 3 OOB supplementary checks present |
| `www/tests/session/prefs.spec.js` | 2 new no-revert regression tests (06-09) | ✓ VERIFIED | `'flushPrefs does NOT fire subscribers'` at line 223; `'phosphor DOM state survives the 250ms debounce window'` at line 245 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `www/renderer/canvas.js` | `www/renderer/scroll-state.js` | scrollIsScrolledBack()/getOffset() consumed by tick() | ✓ WIRED | import confirmed; snapshot_grid_at(scrollGetOffset()) |
| `www/input/selection.js` | `www/renderer/scroll-state.js` | getOffset() for rowOffsetFromTail math | ✓ WIRED | scrollStateRef.getOffset() at pxToCellWithScrollOffset; scrollState.onChange subscription |
| `www/input/clipboard.js` | `www/input/paste-pump.js` | enqueuePaste(bytes) after preprocessing | ✓ WIRED | import confirmed; called after 4096-threshold confirm |
| `www/input/clipboard.js` | `www/input/selection.js` | getSelection() + clearSelection() for copy | ✓ WIRED | imports confirmed |
| `www/input/keyboard.js` | `www/input/clipboard.js` | copySelection + pasteFromClipboard at Ctrl+Shift+C/V intercepts | ✓ WIRED | imports confirmed |
| `www/transport/serial.js` | `www/transport/session-log.js` | sessionLogRef.append(value) in read loop; reset() on Connect | ✓ WIRED | confirmed in prior verification |
| `www/renderer/chrome.js` | Rust core via wasm | term.clear_visible() | ✓ WIRED | chrome.js line 90; lib.rs forwarder |
| `www/renderer/chrome.js` | `www/renderer/scroll-state.js` | snapToBottom() on Clear button | ✓ WIRED | ss.snapToBottom() confirmed |
| `www/main.js` | `www/state/prefs.js` | loadPrefs() before wireChrome; prefs.subscribe(applyPrefs) | ✓ WIRED | boot order confirmed; subscriber path now fires ONLY from resetPrefs (06-09 fix) |
| `www/renderer/chrome.js` | `www/state/prefs.js` | resetPrefs() on second click; savePrefs on theme/phosphor/zoom changes | ✓ WIRED | resetPrefs import confirmed; 2-click confirm confirmed |
| `www/transport/serial.js (snapPreset)` | `www/state/prefs.js (savePrefsFn)` | savePrefsFn({ serial: PRESET_BLOB }) syncs cached prefs blob (06-09) | ✓ WIRED | serial.js lines 315-326; guarded by `if (savePrefsFn)`; field-name translation baud/dataBits/stopBits/parity/flowControl honored per D-32 |
| `.github/workflows/pages.yml` | `scripts/build.sh` | Build step calls ./scripts/build.sh | ✓ WIRED | confirmed |
| `www/index.html` (CSP meta-tag) | `www/_headers` | Defense-in-depth same CSP directives in both | ✓ WIRED | both contain wasm-unsafe-eval, frame-ancestors 'none', form-action 'none' |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `www/renderer/scroll-state.js` | offset, newLinesSinceUserScrolled | wheel events + notifyFeed() calls from main.js | Yes — driven by real user events and incoming serial bytes | ✓ FLOWING |
| `www/transport/session-log.js` | chunks array | serial.js read loop: append(value) per Uint8Array received | Yes — real serial bytes appended by reference | ✓ FLOWING |
| `www/state/prefs.js` | cached prefs blob | localStorage.getItem('bestialitty.prefs') on boot; setItem on flush | Yes — real localStorage round-trip; DEFAULTS used when missing | ✓ FLOWING |
| `www/input/selection.js` | anchor/focusEnd | pointer events on canvas via pxToCellWithScrollOffset | Yes — computed from real pointer coordinates and scrollState.getOffset() | ✓ FLOWING |
| `www/input/clipboard.js` | bytes (paste) | navigator.clipboard.readText() | Yes — real async clipboard API; preprocessing strips control bytes | ✓ FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — behavioral checks require a running browser; the codebase has no server-side runnable entry points. Playwright suite (168 passed, 1 skipped, 0 failed under --retries=0) covers all automatable behaviors per 06-09-SUMMARY.md.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SESS-01 | 06-03, 06-08 | Scrollback buffer retains N lines; user can review prior output | ✓ SATISFIED | Terminal initialized with 10,000 capacity; scroll-state.js + canvas branching; scrollback tests passing |
| SESS-02 | 06-04 | User can select and copy text from screen to clipboard | ✓ SATISFIED | selection.js wireSelection + getSelection; Ctrl+Shift+C in keyboard.js; selection + clipboard tests passing |
| SESS-03 | 06-04 | User can paste clipboard content into serial stream (paste throttling) | ✓ SATISFIED | clipboard.js pasteFromClipboard → enqueuePaste; Phase 5 paste-pump rate-limits; clipboard tests passing |
| SESS-04 | 06-05 | Session logging captures serial stream to downloadable file; auto-started per connection | ✓ SATISFIED | session-log.js reset()/append() lifecycle; serial.js read loop wired; log-download tests passing |
| SESS-05 | 06-05 | Mid-session "download current log" button without disconnecting | ✓ SATISFIED | download() assembles Blob from chunks array WITHOUT clearing; chunks continue appending after download |
| SESS-06 | 06-05 | Clear-screen local button (distinct from remote ESC J) | ✓ SATISFIED | chrome.js calls term.clear_visible() NOT \x1B\x4A; comment explicitly documents distinction; clear-screen tests passing |
| PREF-01 | 06-06, 06-09 | Theme, phosphor, font size, and last-used serial config persist in localStorage | ✓ SATISFIED | prefs.js DEFAULTS + savePrefs on every change; chrome.js savePrefs hooks; snapPreset now also calls savePrefsFn to keep cached blob in sync (06-09); 16 prefs tests passing |
| PREF-02 | 06-06, 06-09 | Local echo and CR/LF override toggle states persist in localStorage | ✓ SATISFIED | DEFAULTS.localEcho=false, DEFAULTS.crlfMode='cr'; main.js change handlers call savePrefs; flushPrefs race eliminated (06-09); prefs tests passing |
| PLAT-03 | 06-07 | Ships as static site, self-hosted (GitHub Pages / Cloudflare / own domain) | ✓ SATISFIED (code-level) | .github/workflows/pages.yml + _headers + .nojekyll + CSP meta-tag committed; one-time manual Pages source setting documented; first-push smoke check is OOB human verification |
| PLAT-04 | 06-07 | Public repo under permissive license (MIT or Apache-2.0) | ✓ SATISFIED | LICENSE file: SPDX MIT canonical text, Copyright (c) 2026 Ant Skelton |
| PLAT-05 | 06-06 | First-open sane defaults — MicroBeast preset pre-selected; one click to connect | ✓ SATISFIED | DEFAULTS: theme=crt, phosphor=green, fontZoom=1, serial={baud:19200, dataBits:8, stopBits:1, parity:'none', flowControl:'none'}, localEcho=false, crlfMode=cr; loadPrefs() falls back to DEFAULTS on first open |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | No TODO/FIXME/placeholder in Phase 6 production modules | — | — |

No anti-patterns found in scroll-state.js, selection.js, clipboard.js, session-log.js, prefs.js, or the 06-09 modified files. The 06-09 gap-closure adds explanatory comment blocks in both production files (prefs.js lines 70-79 and serial.js lines 309-314) — these are documentation, not stubs. The pre-existing `test.fixme` stub in `www/tests/session/` (1 skipped test in the full suite) is a Wave 0 placeholder confirmed as pre-existing and unaffected by Phase 6 changes.

Pre-existing known flake noted in 06-09-SUMMARY.md: `tests/render/grid.spec.js:27` ('canvas is sized 1280x768 CSS px for 80x24 CRT grid @fast') can fail intermittently with `dims.cssW = NaN` on canvas measurement timing. This is a Phase 3 render-suite flake, not introduced by Phase 6, and passes 5/5 in isolation. Not a Phase 6 gap.

### Human Verification Required

The following items require human execution. The chrome-buttons blocker that prevented UAT Tests 2-7 is structurally closed by plan 06-09. UAT Test 1 in Chromium should be re-executed to confirm the fix before running Tests 2-7.

#### 1. GitHub Pages First-Deploy Smoke Check (PLAT-03)

**Test:** Visit the GitHub repo Settings -> Pages, set Source to "GitHub Actions", then push to main and watch the Action run. After deployment:
```
curl -I https://<owner>.github.io/<repo>/
curl -I https://<owner>.github.io/<repo>/pkg/bestialitty_core_bg.wasm
```
**Expected:** HTTP 200 for both; second URL returns `Content-Type: application/wasm`
**Why human:** Requires one-time manual repo settings change and a real network-accessible GitHub Pages deployment. The code artifacts (pages.yml, _headers, .nojekyll, CSP meta-tag) are all committed and correct; only the repo setting and first push remain.

#### 2. 24-Hour Memory-Flat Soak (ROADMAP SC-2)

**Test:** Follow the protocol in `06-SOAK.md`. Connect BestialiTTY to a real MicroBeast running `for i = 0 to 1e9 : print i : next`. Open DevTools console, paste the `setInterval(60_000)` sampler snippet, collect 1,440 samples over 24 hours.
**Expected:** `wasm.memory.buffer.byteLength` stays within ±10% of the t=10-minute baseline reading for the entire 24-hour soak.
**Why human:** Requires real MicroBeast hardware, 24-hour elapsed time, and manual console inspection. The soak protocol document (06-SOAK.md) is shipped and ready.

#### 3. Daily-Driver Full-Session UAT (ROADMAP SC-5)

**Test:** Re-run UAT Test 1 from `06-UAT.md` in real Chromium first to confirm the 06-09 chrome-buttons fix is live in the browser. Then complete all 8 tests in `06-HUMAN-UAT.md`: paste 100 KB during CP/M, scroll back 8K BASIC lines, copy command from history and paste back, theme-toggle while scrolled up, clear-screen during long output, full-reload prefs restoration, auto-connect on second visit, 24-h soak cross-check.
**Expected:** UAT Test 1 passes (Connect, Clear, Clean/CRT, Green/Amber/White buttons all fire and hold state past 1 s with no race-revert). All 8 tests pass. Author uses BestialiTTY as the only terminal for a full MicroBeast work session without reaching for another terminal.
**Why human:** Tests require real MicroBeast hardware, real OS clipboard interaction, and sustained human attention across a full working session. The 06-09 structural fix closes the Playwright-confirmed race; the live-browser confirmation of UAT Test 1 is the final automated gate that can only be run by the developer.

### Gaps Summary

No automated gaps. All 11 observable truths are VERIFIED. All 11 Phase 6 requirements (SESS-01 through SESS-06, PREF-01, PREF-02, PLAT-03, PLAT-04, PLAT-05) are SATISFIED at the code level.

The chrome-buttons blocker surfaced by 06-UAT.md Test 1 is structurally closed by plan 06-09 (commits 1b71531 and 68bdaec). The structural fix is confirmed in the actual codebase: `flushPrefs` contains zero subscriber loops; `resetPrefs` retains exactly one; `snapPreset` calls `savePrefsFn` with correct D-32 field mapping. 168 Playwright tests pass, 0 fail.

The `human_needed` status reflects three out-of-band items: the GitHub Pages first-deploy smoke check (PLAT-03 one-time manual step), the 24-hour memory soak (ROADMAP SC-2), and the daily-driver full-session UAT including live-browser confirmation of the chrome-buttons fix (ROADMAP SC-5). Code-level work and automated test coverage are complete for all three.

---

_Verified: 2026-04-25T18:00:00Z_
_Re-verification after: 06-09 gap closure (commits 1b71531, 68bdaec, 4c01d11)_
_Verifier: Claude (gsd-verifier)_
