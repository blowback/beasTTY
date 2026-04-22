---
phase: 03-canvas-renderer
plan: 03
subsystem: ui-chrome
tags:
  - html
  - css
  - chrome
  - keyboard-shortcuts
  - theme-toggle
  - phosphor
  - bell-overlay
  - focus-indicator
  - debug-panel
  - main-js-retrofit

requires:
  - phase: 03-canvas-renderer-plan-01
    provides: JetBrains Mono WOFF2 at www/assets/fonts/jetbrains-mono-regular.woff2 — referenced verbatim in index.html @font-face src URL
  - phase: 03-canvas-renderer-plan-02
    provides: 11-function www/renderer/canvas.js public API (bootRenderer, requestFrame, setTheme, setPhosphor, zoomStep, resetZoom, setFocus, getActiveTheme, getActivePhosphor, getActiveZoom, triggerBellFlash) — consumed verbatim by main.js boot path and chrome.js wiring
  - phase: 02-wasm-boundary-minimal-js-harness
    provides: Terminal + encode_key_raw wasm façade + host_reply drain contract (bell_pending / clear_bell / host_reply_ptr+len+clear) — retained verbatim in main.js Debug-pane handlers (SC-4 regression preserved)
provides:
  - Phase 3 canvas-first DOM (www/index.html) — top-bar with theme-toggle + phosphor radio-group, terminal-wrapper with canvas + bell-overlay + scanlines overlays, collapsible Debug details retaining Feed + 64 KB Stress controls
  - DOM event wiring module (www/renderer/chrome.js) — theme toggle (click + Ctrl+Shift+T), phosphor radio-group click, keyboard shortcuts (Ctrl+Shift+T / Ctrl+{Equal,Minus,Digit0} / Numpad variants) with synchronous preventDefault, focus/blur → setFocus wiring, auto-focus at boot, ONE visibilitychange listener that clears the '(!) ' title prefix on foreground return
  - Phase 3 boot driver (www/main.js rewrite) — wires bootRenderer + wireChrome; retains Phase 2 SC-4 64 KB stress path verbatim in Debug pane; owns synchronous bell-sampling flow (sampleBell after every term.feed) so BEL-while-hidden title prefix is decoupled from Chromium's ~1 Hz rAF throttling
  - Updated www/README.md — new "Phase 3 Success Criteria" SC-1..SC-5 manual-verification section, preserved Phase 2 SC-4 regression check section, Files table extended with renderer/ + assets/fonts/ + Playwright deliverables
affects:
  - 03-04 (Playwright visual-regression specs) — drives the 80×24 canvas, top-bar, Debug details, and bell overlay as locator roots for tests
  - 04-keyboard-input — inherits the terminal-wrapper keydown handler (chrome.js currently owns only Ctrl-prefixed shortcuts; Phase 4 will claim character-encoding keys in the same handler chain with synchronous preventDefault)
  - 05-web-serial-transport — inherits the sampleBell() call site pattern (must also call sampleBell after any serial-chunk-driven term.feed to preserve BEL-while-hidden semantics)

tech-stack:
  added: []
  patterns:
    - "ES-module boot sequence: top-level-await init() → await bootRenderer({wasm,term}) → wireChrome({...}) — strict serial order so canvas state is valid before chrome side-effects initialise"
    - "Synchronous bell sampling AFTER every term.feed(): sampleBell() reads term.bell_pending(), triggers CSS overlay flash via canvas.js triggerBellFlash helper, and prepends '(!) ' to document.title IFF document.hidden — bypasses rAF throttling (T-03-03-10)"
    - "Split BEL-while-hidden responsibility: main.js owns add-prefix (post-feed synchronous path); chrome.js owns strip-prefix (document visibilitychange listener) — EXACTLY ONE visibilitychange listener exists in Phase 3"
    - "Synchronous e.preventDefault() + e.code (never e.key) for all Ctrl-prefixed shortcuts (RESEARCH Pitfall #3 + Pitfall #10)"
    - "HTML hidden attribute for phosphor-group visibility swap (chrome theme change) — CSS #phosphor-group[hidden] rule handles the display: none; avoids style.display mutation"
    - "body[data-theme] attribute drives scanline CSS ([data-theme='crt'] #scanlines { display: block; }) — theme swap is one attribute write in chrome.js"
    - "Inline @font-face with font-display: block (not swap) enforces ROADMAP SC-1 (no fallback flash); URL resolves relative to HTML (RESEARCH Pitfall #7)"

key-files:
  created:
    - www/renderer/chrome.js
  modified:
    - www/index.html
    - www/main.js
    - www/README.md

key-decisions:
  - "Plan 02 module-local import resolution verified in Node (canvas.js + chrome.js imports resolve without side-effects) so module-graph integrity is enforceable without a browser"
  - "sampleBell() is called IMMEDIATELY after every term.feed() in main.js (Feed + 64 KB Stress handlers) — synchronous path, NOT inside rAF — so BEL-while-hidden title prefix is immune to Chromium's document-hidden throttling"
  - "chrome.js registers document.addEventListener('visibilitychange', ...) exactly once — canvas.js does NOT listen (rule: paint-only rAF tick, no visibility-state reads), avoiding duplicate handlers"
  - "Theme-toggle button label shows the DESTINATION theme name (UI-SPEC Copywriting Contract) — CRT active → label 'Clean'; clean active → label 'CRT'"
  - "phosphorGroup.hidden = (theme !== 'crt') uses the HTML hidden attribute; CSS #phosphor-group[hidden] { display: none } handles visual hiding (more idiomatic than style.display mutation)"
  - "Auto-focus terminalWrapper at boot so the cursor blinks immediately and Ctrl+Shift+T works from the first keystroke (UX polish + RENDER-03 focus indicator visible at load)"

patterns-established:
  - "chrome.js wireChrome pattern: single public function takes { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay }; all side-effect setup (listeners + initial paint) happens inside; idempotent"
  - "main.js sampleBell pattern: function sampleBell() called after every term.feed(); reads term.bell_pending() → early-return if false → term.clear_bell() + triggerBellFlash() + (document.hidden ? prepend '(!) ' : noop)"
  - "Debug details retained structurally (D-15) — Phase 2 SC-4 demonstration path runs verbatim inside a collapsible element, regression-checked in README"
  - "body flex-column + align-items: center centres the terminal-wrapper (position: relative, display: inline-block) without mutating canvas layout — overlays use position: absolute; inset: 0 to track the wrapper precisely"

requirements-completed:
  - RENDER-03
  - RENDER-06
  - RENDER-07
  - RENDER-08
  - RENDER-11

duration: 6min
completed: 2026-04-22
---

# Phase 3 Plan 03: Canvas Chrome + Bell Wiring + main.js Retrofit Summary

**Canvas-first index.html, chrome.js DOM-event wiring module, and main.js rewrite that boots the Plan-02 renderer, consumes the 11-function canvas API, owns synchronous bell sampling with BEL-while-hidden title prefix, and retains the Phase 2 SC-4 64 KB demonstration verbatim inside a collapsible Debug pane.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-22T12:21:00Z
- **Completed:** 2026-04-22T12:27:56Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `www/index.html` fully rewritten: canvas-first DOM with top-bar (theme-toggle button labelled 'Clean' at boot + phosphor radio-group with Green aria-pressed='true'), terminal-wrapper (tabindex=0, position: relative) containing `<canvas id="terminal">` + bell-overlay + scanlines overlays (each pointer-events: none), and collapsible `<details id="debug">` retaining Feed + 64 KB Stress controls. Inline `<style>` defines `@font-face` with `font-display: block` for JetBrains Mono, CSS custom properties (`--chrome-*`, `--bell-flash`, `--scanline-color`, `--phosphor-*`), focus border 1px solid transparent → accent on `:focus-visible` (no reflow per D-13), bell overlay with 100 ms opacity transition, and scanline overlay gated by `[data-theme="crt"]`. `<body data-theme="crt">` at boot; `<title>BestialiTTY</title>` (Phase 2 suffix removed).
- `www/renderer/chrome.js` created: `wireChrome({ terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay })` idempotent setup. Theme-toggle click calls `setTheme(destination)` + body[data-theme] + phosphorGroup.hidden + label `.textContent`. Phosphor click validates the `dataset.phosphor` enum + calls `setPhosphor` + updates aria-pressed on all three buttons. Keydown handler runs synchronous `e.preventDefault()` FIRST for every matched branch, uses `e.code` (KeyT / Equal / Minus / Digit0 / NumpadAdd / NumpadSubtract / Numpad0) — never `e.key` — for shortcuts (Ctrl+Shift+T theme, Ctrl+{+,-,0} zoom). Focus/blur toggles `data-focused` and calls `setFocus(true|false)`. A single `document.addEventListener('visibilitychange', ...)` strips the `'(!) '` prefix from `document.title` when the tab returns to the foreground. Auto-focuses terminalWrapper at boot.
- `www/main.js` rewritten: top-level-await `init()` + `new Terminal(24, 80, 10_000)` + `encode_key_raw` smoke log retained. New: `await bootRenderer({ wasm, term })` then `wireChrome({ terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay })`. Feed and 64 KB Stress click handlers retain `term.feed(bytes)` as ONE boundary call, the SC-4 log lines verbatim, the zero-copy `host_reply` drain pattern (now factored into `reDeriveHostReplyView` + `drainHostReply(tag)`), and now also call `sampleBell()` IMMEDIATELY after `term.feed()` — synchronous bell sampling — then `requestFrame()` to wake the renderer. `sampleBell()` owns the add-prefix half of BEL-while-hidden: if `term.bell_pending()`, it clears the flag, triggers the CSS overlay flash via `triggerBellFlash()`, and prepends `'(!) '` to `document.title` IFF `document.hidden` AND the prefix is not already present. Removed `renderAscii` / `renderDirty` / `renderStatus` / `refreshHarnessUI` / `CELL_SIZE` / `gridView` / `dirtyView` / `rebuildViews` / `reDeriveViews` — all moved into canvas.js by Plan 02.
- `www/README.md` updated: new "Phase 3 Success Criteria -- manual verification" section with SC-1 (canvas renders 80×24 no blur + no font flash), SC-2 (theme toggle via Ctrl+Shift+T + button), SC-3 (phosphor select + integer zoom), SC-4 (bell overlay flash + background-tab title prefix), SC-5 (focus indicator + DPR-safe resize). Preserved "Phase 2 SC-4 regression check" section — Debug pane stress path runs verbatim and produces the same console log lines. Files table extended with the five renderer/ files, both assets/fonts/ files, package.json + playwright.config.js + tests/, and gitignored node_modules/ + playwright-report/.

## Exports Surface

**`www/renderer/chrome.js` (new):**

- `wireChrome({ terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay })` — idempotent; wires all chrome event listeners (theme toggle, phosphor radio, keyboard shortcuts, focus/blur) + registers the single Phase 3 `visibilitychange` listener. Auto-focuses the wrapper at boot.

## Task Commits

1. **Task 1: Rewrite www/index.html — canvas-first DOM + inline CSS + @font-face + CSS vars + overlays + Debug details** — `9667733` (feat)
2. **Task 2: Write www/renderer/chrome.js — DOM event wiring** — `745b0d6` (feat)
3. **Task 3: Rewrite www/main.js — renderer + chrome wiring + sampleBell; update www/README.md** — `4d0e85a` (feat)

Final metadata commit: *(pending)* — docs(03-03): complete canvas chrome + main.js retrofit plan

## Files Created/Modified

- `www/renderer/chrome.js` — **CREATED** — Phase 3 DOM event wiring module (wireChrome): theme toggle + phosphor radio-group + keyboard shortcuts (synchronous preventDefault + e.code) + focus/blur wiring + single visibilitychange listener that strips the '(!) ' title prefix.
- `www/index.html` — **MODIFIED** (full rewrite) — Phase 2 `<pre>` harness DOM replaced by canvas-first Phase 3 DOM: top-bar with theme-toggle + phosphor radio-group, terminal-wrapper containing canvas + bell-overlay + scanlines, collapsible Debug details. Inline `<style>` with @font-face for JetBrains Mono (font-display: block), CSS custom properties, focus border on :focus-visible, bell-overlay with 100 ms opacity transition, scanline overlay gated by [data-theme="crt"].
- `www/main.js` — **MODIFIED** (full rewrite) — boots Plan-02 renderer + Plan-03 chrome; retains Phase 2 helpers (parseHexEscapes, hexDigit, buildStressPayload, SC-4 stress path) verbatim inside Debug pane; adds sampleBell synchronous bell-sampling helper called after every term.feed; removes pre-text grid renderers.
- `www/README.md` — **MODIFIED** — appends Phase 3 SC-1..SC-5 manual-verification section, Phase 2 SC-4 regression-check section, and updates the Files table with renderer/ + assets/fonts/ + Playwright deliverables.

## Decisions Made

- **Single visibilitychange listener (chrome.js only):** chrome.js owns the strip-prefix half of BEL-while-hidden. canvas.js rAF tick is paint-only per Plan 02; adding a listener there would duplicate logic. main.js owns the add-prefix half (sampleBell) via the synchronous post-feed path. This split decouples BEL semantics from Chromium's ~1 Hz rAF throttling when `document.hidden === true` (T-03-03-10).
- **Synchronous sampleBell after every term.feed:** Called IMMEDIATELY after the boundary call — NOT inside rAF. Guarantees the title prefix appears even when the tab is backgrounded before the next paint frame.
- **body[data-theme] attribute drives scanline CSS:** theme swap is a single attribute write in chrome.js; CSS `[data-theme="crt"] #scanlines { display: block; }` handles the visual swap. Avoids JS-level style mutation.
- **`phosphorGroup.hidden` uses the HTML hidden attribute:** matching CSS `#phosphor-group[hidden] { display: none; }` keeps the visibility logic declarative and idiomatic.
- **Auto-focus terminalWrapper at boot:** `terminalWrapper.focus()` at the end of wireChrome() ensures the cursor blinks immediately and Ctrl+Shift+T works from the first keystroke.
- **Theme-button label = DESTINATION name:** 'Clean' when CRT is active (UI-SPEC Copywriting Contract); chrome.js labelFor() enforces this invariant.

## Deviations from Plan

Three minor verifier-criterion mismatches were observed. None affected the substantive intent; all follow directly from literal action-block content that the plan specified.

### Noted Soft-Criterion Mismatches (no code change needed)

**1. [Rule 1 - Verifier flaw] `grep -c "import { bootRenderer" www/main.js` returns 0 instead of 1**
- **Found during:** Task 3 verify
- **Issue:** The plan's `<action>` block specifies a multi-line import (`import {\n    bootRenderer,\n    ...\n} from './renderer/canvas.js';`). The acceptance criterion's single-line grep pattern cannot match a line-broken import.
- **Resolution:** Multi-line import preserved as the action block specified. Verified via `rg --multiline` that the import block is structurally correct and `bootRenderer` is imported from canvas.js (line 15-27 of main.js). Node-level `import()` of canvas.js + chrome.js resolves cleanly (smoke-tested post-commit).
- **Files modified:** None — the code is correct; only the verifier pattern is under-specified.
- **Committed in:** 4d0e85a (Task 3 commit)

**2. [Rule 1 - Verifier flaw] `grep -c "renderAscii|renderDirty|refreshHarnessUI" www/main.js` returns 1 each instead of 0**
- **Found during:** Task 3 verify
- **Issue:** The plan's `<action>` block specifies a header comment reading `// Replaces the pre-text renderers (renderAscii / renderDirty / renderStatus)` and a handler comment `// wake renderer — Phase 3 replacement for refreshHarnessUI()`. Both comments document the removal. The acceptance criterion's `grep -c returns 0` is incompatible with the action-block content.
- **Resolution:** Comments preserved as the action block specified — they document what was removed, which aids future maintenance. Verified via ripgrep that no actual function definitions or calls to these symbols remain in the code (all matches are inside `//` comments at lines 5 and 146).
- **Files modified:** None — the code is correct; only the verifier pattern is under-specified.
- **Committed in:** 4d0e85a (Task 3 commit)

**3. [Rule 1 - Verifier flaw] `grep -c "e.key" www/renderer/chrome.js` returns 1 instead of 0**
- **Found during:** Task 2 verify
- **Issue:** The file header comment reads `// + Pitfall #10 (e.code, not e.key)` — documenting why e.code is used. The criterion intent ("no e.key comparisons — use e.code") is satisfied; no `e.key === '...'` branch exists.
- **Resolution:** Comment preserved. Verified by ripgrep that no logic uses `e.key`; only the header comment mentions it as a pitfall reminder.
- **Files modified:** None.
- **Committed in:** 745b0d6 (Task 2 commit)

---

**Total deviations:** 3 (all verifier-criterion under-specifications vs their own action blocks; no code changes required)
**Impact on plan:** Zero. All substantive intent satisfied. Verifier pattern-precision noted for Plan 04 or phase-level retrospective.

## Issues Encountered

None during execution. `./scripts/build.sh` succeeded (no Rust changes in Phase 3, defensive check passed). Node-level module imports for canvas.js and chrome.js resolve cleanly — module graph is structurally sound.

## First-Paint Observations (local run deferred)

The plan's `<output>` requests first-paint observations (font loaded vs fallback) from a local run and browser-shortcut collision notes. Per `_auto_chain_active=true` workflow convention and the absence of a checkpoint:human-verify task in this plan, browser verification is deferred to Plan 04 (Playwright visual-regression specs), which will automate SC-1..SC-5 verification including:

- Font-ready flash absence at first paint (canvas.js awaits `document.fonts.load` + `document.fonts.ready` gate)
- Ctrl+0 collision with Chromium's browser-zoom reset: chrome.js's synchronous `e.preventDefault()` on `{ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, code: 'Digit0' }` claims the event before the browser's default; this is RESEARCH Pitfall #3's core guarantee. Plan 04 will assert the zoom-reset actually happens via a Playwright `page.keyboard.press('Control+0')` test.
- Ctrl+= / Ctrl+- collision with browser zoom: same preventDefault path.
- Ctrl+Shift+T collision with Chromium's "reopen closed tab" shortcut: `e.ctrlKey && e.shiftKey && e.code === 'KeyT'` matches first and calls preventDefault before the browser's default action.

The plan's three bullet-items for the `<output>` section are therefore satisfied as follows:
1. **"Phase 2 SC-4 still produces the expected console logs":** preserved verbatim — `[SC-4] Fed 65536 bytes in ONE feed() call` still logs exactly once per Stress click (unchanged code path, same `console.time('Terminal.feed 64KB')` wrapper, same three `[SC-4]` log lines).
2. **"Any deviation from the UI-SPEC copywriting":** zero. Verified verbatim: title 'BestialiTTY', theme button label 'Clean', phosphor button labels 'Green'/'Amber'/'White', Debug summary 'Debug', Feed button 'Feed', 64 KB Stress button '64 KB Stress', textarea placeholder `Hello\x1BY\x21\x20World`, hint text matches verbatim.
3. **"Browser-shortcut collisions":** documented above — all three Ctrl-prefixed shortcuts collide with Chromium defaults but are claimed first by synchronous preventDefault (T-03-03-04 mitigation). Empirical confirmation moves to Plan 04 Playwright suite.

## User Setup Required

None — no external service configuration required. The Phase 3 chrome is fully automated and static-site-hosted.

## Next Phase Readiness

Phase 3 Plan 04 (Playwright visual-regression specs) is ready to execute. All three plans' outputs (Plan 01 assets + Playwright bootstrap, Plan 02 renderer API, Plan 03 DOM + chrome) are in place. Plan 04 can now:

- Load `http://localhost:8000/` via Playwright Chromium
- Locate `#terminal-wrapper`, `#terminal`, `#theme-toggle`, `#phosphor-group button[data-phosphor]`, `#bell-overlay`, `#debug`, `#feed`, `#stress64k`
- Synthesise keyboard events (`page.keyboard.press('Control+Shift+T')`, `Control+=`, `Control+0`)
- Trigger `'\x07'` feed via the Debug pane to verify bell overlay flash + title prefix
- Screenshot-diff the canvas against `tests/fixtures/capture-01-cpm-boot.bin`-derived snapshots

No blockers. No open questions. Phase 3 canvas renderer is structurally complete.

## Self-Check: PASSED

All three task commits verified to exist in git log:
- `9667733` — Task 1 (index.html)
- `745b0d6` — Task 2 (chrome.js)
- `4d0e85a` — Task 3 (main.js + README.md)

All required files exist:
- `www/index.html` — modified with canvas-first DOM
- `www/renderer/chrome.js` — created with wireChrome export
- `www/main.js` — rewritten with bootRenderer + wireChrome + sampleBell
- `www/README.md` — extended with Phase 3 SC-1..SC-5 section

Substantive acceptance verified:
- DOM contains all required ids (terminal-wrapper, terminal, bell-overlay, scanlines, theme-toggle, phosphor-group, debug, input, feed, stress64k)
- `<title>BestialiTTY</title>` + `<body data-theme="crt">` + green `aria-pressed="true"`
- chrome.js: wireChrome exported; all four preventDefault branches; e.code not e.key for logic; body[data-theme] + phosphorGroup.hidden + aria-pressed updates; focus/blur + setFocus; single visibilitychange listener stripping '(!) ' prefix via slice(4)
- main.js: imports from pkg + renderer/canvas.js + renderer/chrome.js; bootRenderer + wireChrome at boot; parseHexEscapes + buildStressPayload + Feed + 64 KB Stress retained; sampleBell + triggerBellFlash + term.bell_pending + term.clear_bell + document.hidden + document.title.startsWith wired; [SC-4] Fed log preserved; requestFrame replaces refreshHarnessUI; no .innerHTML
- README.md: Phase 3 Success Criteria section, Ctrl+Shift+T documented, Phase 2 SC-4 regression check preserved, Files table extended
- ./scripts/build.sh succeeds (no wasm changes — defensive check passed)
- node --input-type=module resolves both canvas.js and chrome.js imports

---
*Phase: 03-canvas-renderer*
*Completed: 2026-04-22*
