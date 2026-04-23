---
phase: 05-web-serial-transport
plan: 02
subsystem: transport-ui-scaffolding
tags: [phase-5, polite-fail, ui-scaffolding, module-skeletons, wave-1]

# Dependency graph
requires:
  - phase: 05-web-serial-transport
    plan: 01
    provides: Wave 0 test scaffolding — 38 test.fixme stubs waiting for DOM/module existence
  - phase: 04-keyboard-input
    provides: www/input/ module convention + tx-sink observer pattern
  - phase: 03-canvas-renderer
    provides: wireX(opts) DI pattern (chrome.js) + canvas.js module-scope state template
provides:
  - "www/transport/ directory + www/transport/serial.js with all 7 public API exports (renderPoliteFail fully implemented; wireSerial/connectMicroBeast/disconnect/getState/onStateChange/getWriter as stubs)"
  - "www/input/paste-pump.js with all 5 public API exports as stubs plus reserved module-scope state (CHUNK_SIZE, gapMs, queue, cursor, timer, progressObservers)"
  - "Connect button DOM + CSS in #top-bar (data-state disconnected/connecting/connected/reconnecting/port-lost) with literal-hex state borders"
  - "<details id=connection> pane DOM + CSS between #top-bar and #terminal-wrapper (port-status, 5-select serial-config fieldset, reset preset button, paste-progress-row hidden, error-log pre, footer hint)"
  - "<button id=paste-test> inside Debug pane after 64 KB Stress"
  - "Full body.polite-fail CSS ruleset (20px h1, system-ui font, 48px padding, display: block override)"
  - "Polite-fail gate at www/main.js line 19 (before wasm import at line 24) — typeof navigator.serial === 'undefined' check with renderPoliteFail() + throw to abort module execution"
affects: [05-web-serial-transport Wave 2-5, 06-polish-and-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Polite-fail gate as first-line static import + synchronous feature-detect + throw-to-abort (Pattern 1 from 05-RESEARCH)"
    - "State-machine encoding via data-state attribute selectors on a single button (Pattern 5) — literal hex colors inline, no var() tokens for state signalling so connected reads universally green across phosphors"
    - "Module-skeleton-first wave convention — downstream waves Edit, never Write + Edit, which keeps diffs small and preserves the Wave N-1 file identity for reviewers"

key-files:
  created:
    - www/transport/serial.js
    - www/input/paste-pump.js
    - .planning/phases/05-web-serial-transport/05-02-SUMMARY.md
  modified:
    - www/index.html
    - www/main.js
    - www/tests/render/grid.spec.js-snapshots/crt-default-chromium-linux.png

key-decisions:
  - "Polite-fail gate MUST abort via throw (not return) — main.js has top-level await and top-level statements; a return at the top of a module is illegal, so throw Error('__polite-fail__') is the only cross-browser way to halt subsequent imports after body swap"
  - "renderPoliteFail uses static literal innerHTML, zero user input — threat-register T-05-02-01 mitigation documented as a code comment; Wave 2+ must NEVER extend with dynamic strings without switching to textContent"
  - "Connect-button[data-state=connected] uses literal hex #33ff66 NOT var(--phosphor-fg) — universal green success semantic across phosphors (UI-SPEC §Color decision point)"
  - "body.polite-fail must override the Phase 3 body flex display via 'display: block; align-items: unset' — Phase 3's body { display: flex } would otherwise break the takeover layout"
  - "Wave 1 paste-pump.js reserves CHUNK_SIZE = 32 + gapMs = 18 module-scope slots even though unused, so Wave 4 Plan 06 adds pump body via Edit at the exact same scope lines (prevents noise in the Wave 4 diff)"

requirements-completed: [PLAT-01, PLAT-02, XPORT-02, XPORT-03]

# Metrics
duration: 6min
completed: 2026-04-23
---

# Phase 5 Plan 02: Wave 1 — Polite-Fail Gate + UI Scaffolding + Module Skeletons Summary

**Polite-fail gate + all new DOM + all new CSS + two module skeletons shipped as a single wave so Wave 0 stubs can un-fixme (Wave 2+) and every downstream wave touches known file paths via Edit instead of Write + Edit.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-23T00:56:41Z
- **Completed:** 2026-04-23T01:02:23Z
- **Tasks:** 4
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- Created `www/transport/serial.js` with **full `renderPoliteFail()` implementation** (static-literal innerHTML for h1 / 2 paragraphs / 5-browser list / Chromium download link / muted footer; `document.title = 'BestialiTTY — Chromium required'`; adds `polite-fail` body class) per 05-UI-SPEC §Polite-fail page lines 596-626. All 7 public API symbols exported — renderPoliteFail (real), wireSerial + connectMicroBeast + disconnect + getState + onStateChange + getWriter (skeletons).
- Created `www/input/paste-pump.js` mirroring tx-sink.js structure. All 5 public API symbols exported — enqueuePaste, cancelPaste, isActive, onProgress, onPortLost. isActive() returns false unconditionally; onProgress(fn) stores fn in progressObservers (fires never in Wave 1). Reserved CHUNK_SIZE = 32 + gapMs = 18 + queue/cursor/timer module-scope slots so Wave 4 diff stays clean.
- Extended `www/index.html`:
  - Inserted `<button id="connect-button">` with `data-state="disconnected"` as leftmost child of `#top-bar` (UI-SPEC layout line 258 + rationale 506).
  - Inserted `<details id="connection">` between `#top-bar` and `#terminal-wrapper` (D-07 locked placement) containing port-status line with `aria-live="polite"`, 5-select serial-config fieldset (baud 300..115200 w/ 19200 selected; databits 7/8 default 8; stopbits 1/2 default 1; parity none/even/odd; flowctl none/hardware), 'Reset to MicroBeast preset' button, ownership hint, `#paste-progress-row[hidden]` with Cancel button, error-log `<pre>` with `(no recent errors)` empty state, reload-persistence hint.
  - Inserted `<button id="paste-test">` after 64 KB Stress in Debug pane (D-16).
  - Appended 150+ lines of CSS: `#connect-button[data-state="…"]` border rules with literal hex `#e0b030` (amber), `#33ff66` (green), `#e04040` (red); `#connection` pane mirror of `#settings`; `#paste-progress-row` flex layout; `#error-log` fixed-height ring with `.log-entry` / `.log-ts` micro-rules; full `body.polite-fail` ruleset (20px h1, system-ui font, 48px padding, `display: block` override of Phase 3 body flex).
- Inserted polite-fail gate as the first executable block in `www/main.js` (line 19 — before wasm import at line 24). Static `import { renderPoliteFail } from './transport/serial.js'` followed by synchronous `if (typeof navigator.serial === 'undefined') { renderPoliteFail(); throw new Error('__polite-fail__'); }` — wasm + fonts + canvas never initialise on Firefox/Safari.
- Full Playwright suite: **63 passed, 38 skipped (fixme stubs), 0 failed** after regenerating the `grid.spec.js` visual baseline (1-pixel height shift caused by the new Connection pane above the terminal wrapper under DPR rounding).

## Verification Evidence

All 4 tasks' `<done>` criteria pass:

**Task 1 — www/transport/serial.js:**
```
$ node -e "import('./www/transport/serial.js').then(m => console.log(Object.keys(m).sort().join(',')))"
connectMicroBeast,disconnect,getState,getWriter,onStateChange,renderPoliteFail,wireSerial
$ grep -c 'BestialiTTY requires a Chromium-based browser' www/transport/serial.js
1
$ grep -c 'github.com/{TBD-during-Phase-6}' www/transport/serial.js
1
$ grep -c "document.title = 'BestialiTTY — Chromium required'" www/transport/serial.js
1
$ grep -c 'polite-fail' www/transport/serial.js
2
```

**Task 2 — www/input/paste-pump.js:**
```
$ node -e "import('./www/input/paste-pump.js').then(m => { console.log(Object.keys(m).sort().join(',')); console.log('isActive=', m.isActive()); })"
cancelPaste,enqueuePaste,isActive,onPortLost,onProgress
isActive= false
$ for fn in enqueuePaste cancelPaste isActive onProgress onPortLost; do grep -c "^export function $fn" www/input/paste-pump.js; done
1 1 1 1 1
$ grep -c 'CHUNK_SIZE = 32' www/input/paste-pump.js
1
```

**Task 3 — www/index.html:**
```
$ for id in connect-button connection port-status serial-baud serial-databits serial-stopbits serial-parity serial-flowctl serial-reset-preset paste-progress-row paste-progress-text paste-cancel error-log paste-test; do
    echo "$id: $(grep -c "id=\"$id\"" www/index.html)"
  done
(every count = 1)
$ grep -c 'data-state="disconnected"' www/index.html       # 1
$ grep -c '<details id="connection">' www/index.html       # 1
$ grep -c 'aria-live="polite"' www/index.html              # 1
$ grep -c '#e0b030' www/index.html                         # 1 (amber)
$ grep -c '#33ff66' www/index.html                         # 2 (phosphor + connected state)
$ grep -c '#e04040' www/index.html                         # 1 (red port-lost)
$ grep -c 'body.polite-fail' www/index.html                # 6 (selector + 5 child rules)
$ grep -c '(no recent errors)' www/index.html              # 1
```

**Task 4 — www/main.js polite-fail gate:**
```
$ grep -n "navigator.serial" www/main.js | head -1
19:if (typeof navigator.serial === 'undefined') {
$ grep -n "import init" www/main.js
24:import init, { Terminal } from './pkg/bestialitty_core.js';
```
Gate line 19 < wasm-import line 24 (gate precedes wasm init). ≤ 20 done-criterion satisfied.

**Full Playwright suite:**
```
63 passed (8.7s)
38 skipped           # Wave 0 fixme stubs
0 failed
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Regenerate grid.spec.js visual baseline (1-pixel height shift)**
- **Found during:** Task 4 `<automated>` verification
- **Issue:** Full Playwright run reported `[chromium] › tests/render/grid.spec.js:102:3 › RENDER-01 — default CRT canvas matches visual baseline` failing with `Expected an image 1282px by 770px, received 1282px by 771px`. Snapshot dimension mismatches are rejected by Playwright regardless of `maxDiffPixelRatio: 0.02` — dimensions must match exactly.
- **Root cause:** The new `<details id="connection">` pane inserted between `#top-bar` and `#terminal-wrapper` (D-07 locked placement) changes the wrapper's Y-offset by a sub-pixel amount, which rounds to a 1-device-pixel height difference under DPR. The wrapper's own dimensions are unchanged; only its rendering position shifted.
- **Fix:** Regenerated `www/tests/render/grid.spec.js-snapshots/crt-default-chromium-linux.png` via `npx playwright test tests/render/grid.spec.js:102 --update-snapshots`. Same pattern used in Phase 3 Plan 05 gap closure.
- **Files modified:** `www/tests/render/grid.spec.js-snapshots/crt-default-chromium-linux.png`
- **Commit:** `9395a49` (bundled with Task 4's main.js change since they're both part of the same polite-fail-gate landing — the test failure was only surfaced by running the suite after Task 4 finished).

### Pre-existing Flakiness (NOT regressions)

Initial full-suite run also reported `crlf-override.spec.js:32` failing, and a second run reported `keyboard.spec.js:18` failing. **Both passed in isolation** (`npx playwright test tests/input/crlf-override.spec.js` → 4 passed; `npx playwright test tests/render/keyboard.spec.js` → 3 passed). These are pre-existing parallel-load flakes, not Wave 1 regressions. Third full-suite run was clean (63 passed).

## Threat Flags

No new threat surface introduced beyond the plan's `<threat_model>`. T-05-02-01 (tampering via dynamic innerHTML extension) is actively mitigated by a code comment at `www/transport/serial.js:44-45`: `// STATIC HTML ONLY — if extending, use textContent for user-provided strings, // not innerHTML`. T-05-02-02 (wasm load if feature-detect fails) is mitigated by the `throw new Error('__polite-fail__')` after renderPoliteFail — verified by grep line-number check that the gate precedes the wasm import.

## Known Stubs

**Intentional — Wave 1 by design.** These stubs exist to lock public API signatures before Waves 2-5 implement:

| File | Symbol | Wave 1 behaviour | Wave that implements |
|------|--------|------------------|----------------------|
| www/transport/serial.js | wireSerial | Destructures opts, logs `[serial] wireSerial (skeleton)` | Wave 2 (port grant + listener wiring) |
| www/transport/serial.js | connectMicroBeast | `console.warn` | Wave 2 |
| www/transport/serial.js | disconnect | `console.warn` | Wave 2 |
| www/transport/serial.js | getState | Returns `'disconnected'` | Wave 2 (real state machine) |
| www/transport/serial.js | onStateChange | Stores fn + returns unsubscribe fn (observer slot wired) | Wave 2 (real fire-through) |
| www/transport/serial.js | getWriter | Returns `null` | Wave 2 |
| www/input/paste-pump.js | enqueuePaste | `console.warn` | Wave 4 |
| www/input/paste-pump.js | cancelPaste | `console.warn` | Wave 4 |
| www/input/paste-pump.js | isActive | Returns `false` | Wave 4 |
| www/input/paste-pump.js | onProgress | Pushes fn into progressObservers (array slot wired) | Wave 4 (fireProgress calls) |
| www/input/paste-pump.js | onPortLost | `console.warn` | Wave 4 |

Every stub is called out in-file with a `// Wave N implementation` comment so reviewers can grep them. Wave 2 Plan 03 starts un-fixme-ing the Wave 0 `polite-fail.spec.js` + `connect.spec.js` DOM-existence stubs now that the DOM exists.

## Self-Check: PASSED

Verified artifacts:
- `www/transport/serial.js` — FOUND (94 lines, 7 exports)
- `www/input/paste-pump.js` — FOUND (51 lines, 5 exports)
- `www/index.html` — FOUND (all 14 new IDs + 3 new literal hex colors + body.polite-fail ruleset)
- `www/main.js` — FOUND (polite-fail gate at line 19, wasm import at line 24)
- `www/tests/render/grid.spec.js-snapshots/crt-default-chromium-linux.png` — FOUND (regenerated baseline)

Verified commits:
- `a393966` — FOUND (serial.js)
- `afa243c` — FOUND (paste-pump.js)
- `ef29d9e` — FOUND (index.html)
- `9395a49` — FOUND (main.js + baseline)

---

*Phase 05-web-serial-transport, Plan 02 (Wave 1).*
*Completed 2026-04-23. Wave 2 Plan 03 begins port grant + read loop implementation.*
