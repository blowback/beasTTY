---
phase: 06-daily-driver-polish-session-deployment
plan: 06
subsystem: state
tags: [prefs, localStorage, debounce, version-migration, settings-pane, auto-connect, web-serial]

# Dependency graph
requires:
  - phase: 05-web-serial-transport
    provides: wireSerial(opts) + lastPortRef boot-time getPorts() + connectMicroBeast lifecycle
  - phase: 04-keyboard-input
    provides: setLocalEcho / setCrlfMode / Settings pane DOM
  - phase: 03-canvas-renderer
    provides: setTheme / setPhosphor / zoomStep / themeButton / phosphorButtons / chrome.js wireChrome opts pattern
  - phase: 06-daily-driver-polish-session-deployment
    provides: Plan 06-01 prefs.spec.js + auto-connect.spec.js test stubs (14 + 5)
provides:
  - www/state/prefs.js — versioned localStorage blob (load/save/reset/subscribe/getPrefs/DEFAULTS)
  - main.js boot order with loadPrefs() FIRST + applyPrefs subscriber
  - chrome.js theme/phosphor/zoom savePrefs hooks + Settings rows handlers
  - serial.js auto-connect path inside wireSerial (Pitfall 3 race gate) + form persist
  - canvas.js setZoom(z) absolute setter
  - index.html Settings rows (Clear scrollback / Auto connect on load / Reset all preferences)
  - mock-serial.js test hooks (__preGrantPort / __forceOpenReject / __mockOpenCount)
  - window.__prefs test handle (savePrefs / resetPrefs / getPrefs / subscribe)
affects: [06-07 deploy artifacts ride on stable prefs schema, 06-08 24-h soak verifies prefs survive reload]

# Tech tracking
tech-stack:
  added:
    - "structuredClone for deep-cloning the frozen DEFAULTS object on load fall-back paths"
    - "localStorage QuotaExceededError catch — prefs survive in-memory when quota refused"
  patterns:
    - "Versioned blob: { version: 1, ... } with version > CURRENT_VERSION → wholesale fall-back to defaults; version < CURRENT_VERSION → field-by-field upgrade. Future schema changes bump CURRENT_VERSION + add migration step."
    - "250 ms debounce with single setTimeout(flushPrefs, 250); subsequent savePrefs calls clearTimeout + setTimeout — burst of changes = one persist."
    - "beforeunload handler flushes pending debounced write IMMEDIATELY (synchronous setItem) — independent of Phase 5 serial.js beforeunload teardown."
    - "Defensive merge { ...DEFAULTS, ...parsed, serial: { ...DEFAULTS.serial, ...(parsed.serial || {}) } } so a partial blob (missing serial sub-object, hand-edited fields) never produces undefined when consumers read prefs.serial.baud."
    - "subscribe(fn) returns an unsubscribe closure (mirrors Phase 5 onStateChange pattern in serial.js)."
    - "applyPrefs(p) re-applies theme/phosphor/zoom/localEcho/crlfMode/serial-form from a single subscribe callback — fires on every flushPrefs + on resetPrefs() so D-35 in-place reset works without page reload."
    - "Settings 'Reset all preferences' uses inline 2-click confirm: first click swaps label to verbatim 'Click again to confirm (3 s)' and arms a 3-second setTimeout; second click within 3 s commits the reset; timeout reverts label."
    - "Auto-connect path INSIDE wireSerial (D-34): runs AFTER getPorts() lastPortRef discovery, gated on `prefsRef.autoConnect && lastPortRef && state === 'disconnected'` (Pitfall 3 race against user-click). Failure → appendErrorLog('auto-connect-failed', ...) + setState('disconnected'). No granted port → log 'no granted port found. Click Connect to authorize.'"
    - "Mock-serial test hooks via window: __preGrantPort (seeds a granted port pre-boot), __forceOpenReject (throws from MockSerialPort.open), __mockOpenCount (counts successful opens; race-guard regression assertion)."
    - "Init-script registration order matters: hook flag scripts MUST register BEFORE SERIAL_MOCK so the IIFE inspects them at install time."

key-files:
  created:
    - www/state/prefs.js
  modified:
    - www/main.js
    - www/renderer/canvas.js
    - www/renderer/chrome.js
    - www/transport/serial.js
    - www/index.html
    - www/tests/session/prefs.spec.js
    - www/tests/session/auto-connect.spec.js
    - www/tests/transport/mock-serial.js

key-decisions:
  - "prefs.js storage key 'bestialitty.prefs' is DISTINCT from Phase 5's 'bestialitty.port.preset' — identity vs config are conceptually distinct (D-32 + 05-CONTEXT D-31). resetPrefs() ONLY removes 'bestialitty.prefs'; the port-preset key is intentionally untouched (T-06-06-05 mitigation)."
  - "applyPrefs serial-config form mirroring is cosmetic only — Phase 5 D-08 reconnect-required hint pattern owns 'config changed mid-connection'. Auto-connect toggle takes effect on NEXT page load (D-34); no immediate connect/disconnect on toggle."
  - "Auto-connect path lives INSIDE wireSerial (NOT a separate top-level call in main.js) because lastPortRef discovery is already there (Phase 5 D-05 boot-time getPorts pattern). Same reason as Phase 5 reconnect lives in onNavSerialConnect inside wireSerial — co-located with the state machine that owns it."
  - "Reset prefs button uses 3000 ms confirm timer (D-35 locked, NOT a tunable). User tabbing away during confirm-state and the timer reverting is acceptable per RESEARCH Pitfall 10 — no countdown animation; the static '(3 s)' suffix reads as 'about 3 seconds'."
  - "Phase 5 Connection-pane footer hint reworded: 'Full serial config persistence is a Phase 6 feature.' → 'Serial config persists per the Settings → preferences blob.' — UI-SPEC §Hint Text Revisions; the original text became false the moment Plan 06-06 shipped PREF-01."
  - "Test approach for round-trip persistence: Playwright provides a fresh browser context per test so localStorage starts empty by default. Initial implementation used `addInitScript(() => localStorage.removeItem('bestialitty.prefs'))` which silently broke reload tests — addInitScript runs on EVERY navigation, including page.reload(), so the saved blob was being erased right before main.js's loadPrefs() read it. Removed those addInitScript calls; tests now rely on clean-context default."
  - "canvas.js gained setZoom(z) absolute setter alongside zoomStep(delta) — applyPrefs needs an absolute path (zoomStep is delta-relative and would never converge to a stored fontZoom from arbitrary current state). Same clamp [1..4] + atlas evict + markAllRowsDirty + resizeToTheme + primeAscii side-effects as zoomStep; same-value short-circuit per the chrome.js REVIEW warning 3 pattern."

metrics:
  duration: "~16 min"
  tasks_completed: 3
  tasks_total: 3
  completed-date: "2026-04-25T14:47:47Z"
---

# Phase 6 Plan 06: Preferences Persistence + Settings Rows + Auto-Connect Summary

**One-liner:** Versioned `bestialitty.prefs` localStorage blob with 250 ms debounced save + beforeunload flush + version migration; boot-order reorder so `loadPrefs()` runs first; Settings pane gains Clear scrollback / Auto connect / Reset all preferences rows with inline 2-click confirm; auto-connect path inside `wireSerial` gated on Pitfall 3 race condition. Closes PREF-01, PREF-02, PLAT-05.

## What This Plan Did

1. **`www/state/prefs.js` (NEW — 118 LOC, 6 exports)** — `loadPrefs() / savePrefs(partial) / resetPrefs() / subscribe(fn) / getPrefs() / DEFAULTS`. Single key `bestialitty.prefs`; CURRENT_VERSION = 1; debounce 250 ms; beforeunload flush; QuotaExceededError caught silently; version > CURRENT_VERSION → fall back to defaults; version < CURRENT_VERSION → field-by-field upgrade; defensive merge for missing serial sub-object.

2. **`www/main.js` boot reorder** — `loadPrefs()` runs SECOND (after polite-fail, before wasm init). `prefs` ref passed to `wireChrome` and `wireSerial`. `window.__prefs` exposed for Playwright. After `wireSerial` returns, `applyPrefs(p)` is registered as a subscriber and called once with the loaded blob so chrome / canvas / keyboard state reflect persisted values at boot. `localEcho` and `crlfMode` change handlers wrap `setLocalEcho` / `setCrlfMode` calls with `savePrefs({ ... })`.

3. **`www/renderer/canvas.js` setZoom(z)** — new absolute zoom setter alongside `zoomStep(delta)` and `resetZoom()`. Clamps to [1..4]; same-value short-circuit; same atlas-evict + markAllRowsDirty + resizeToTheme + primeAscii side-effects as `zoomStep`.

4. **`www/renderer/chrome.js`** — accepts `prefs` / `savePrefs` / `resetPrefs` opts; theme button click handler now calls `savePrefs({ theme: getActiveTheme().name })`; phosphor button click handlers call `savePrefs({ phosphor: color })`; Ctrl+{+,-,0} zoom keyboard chord calls `savePrefs({ fontZoom: getActiveZoomFn() })` for all three branches; **three new Settings rows handlers** wired:
   - `#clear-scrollback-button` — `term.resize_scrollback(0); term.resize_scrollback(10000); scrollState.snapToBottom(); requestFrame()`.
   - `#auto-connect-checkbox` — initial DOM state from `prefs.autoConnect`; change event fires `savePrefs({ autoConnect: e.target.checked })`.
   - `#reset-prefs-button` — inline 2-click confirm with 3 s revert timer (verbatim `Click again to confirm (3 s)` label per D-35).
   - All three controls have `mousedown preventDefault` for Phase 4 D-16 focus retention.

5. **`www/transport/serial.js`** — `wireSerial(opts)` accepts `prefs` and `savePrefs`; serial-config form change listener now persists `prefs.serial` on every change (in addition to the Phase 5 reconnect-required hint). **Auto-connect path** lands INSIDE `wireSerial` after the existing boot-time `getPorts()` block and BEFORE the connect-button click handler:
   - Gated on `prefsRef.autoConnect && lastPortRef && state === 'disconnected'` (Pitfall 3 race).
   - On success: silent `lastPortRef.open(cfg)` + `setSignals(DTR=false, RTS=false)` + `getWriter` + `registerWriter` + `sessionLogRef.reset()` + `setState('connected')` + `runReadLoop`.
   - On `open()` reject: `appendErrorLog('auto-connect-failed', err.message)` + `setState('disconnected')`.
   - No granted port: `appendErrorLog('auto-connect-failed', 'no granted port found. Click Connect to authorize.')`.

6. **`www/index.html`** — three Settings rows (Clear scrollback / Auto connect on load / Reset all preferences) verbatim from 06-UI-SPEC §"Layout Contract" §"Settings pane"; `<hr class="settings-divider" />` between Phase 4 reserved-shortcuts block and Phase 6 rows; Settings-pane CSS additions (settings-divider + settings-row + .settings-row button states); Phase 5 Connection-pane footer hint reworded to drop the "Phase 6 feature" reference.

7. **`www/tests/transport/mock-serial.js`** — three test hooks added at the bottom of the SERIAL_MOCK IIFE:
   - `window.__preGrantPort` — when set BEFORE the IIFE runs, seeds a `MockSerialPort` into `_grantedPorts` so `getPorts()` returns a match at boot.
   - `window.__forceOpenReject` — string message; overrides `MockSerialPort.prototype.open` to throw.
   - `window.__mockOpenCount` — incremented on every successful open; race-guard regression asserts `<= 1`.

8. **Tests un-fixmed** — 14 prefs.spec.js stubs + 5 auto-connect.spec.js stubs converted from `test.fixme` to `test`; all 19 green.

## Test Counts

| Spec | Tests | Status |
| ---- | ----- | ------ |
| prefs.spec.js                  | 14    | 14 passing (defaults, theme/phosphor/serial/localEcho/crlfMode/fontZoom round-trip, 250 ms debounce, beforeunload flush, quota silent, version migration, Reset 2-click confirm + 3 s timeout) |
| auto-connect.spec.js           | 5     | 5 passing (autoConnect=false no-op, autoConnect=true match → connected, autoConnect=true empty → log, autoConnect=true open-reject → log, race-guard `__mockOpenCount <= 1`) |
| Phase 3/4/5 regression suites  | 147   | green (`160 passed (... 6 skipped)` initial run had a flaky paste.spec.js `Gap 2 regression` test that passed in isolation and on a re-run; pre-existing 6 skips are Wave 0 stubs in Plan 06-01 not yet un-fixmed by Plans 06-02..06-04) |
| **Total Phase 6 Wave 5**       | **19**| **19 passing** |

## Boot Order (post-Wave 5)

```
1. polite-fail check (Phase 5 — UNCHANGED)
2. loadPrefs() ............................. NEW Phase 6 Plan 06
3. wasm init() + new Terminal(...) ......... UNCHANGED
4. await bootRenderer({ wasm, term }) ...... UNCHANGED
5. wireChrome({ prefs, savePrefs, resetPrefs, ... })  ... extended
6. wireScrollState({ ... }) ................ Plan 06-03
7. wireSelection({ ... }) .................. Plan 06-04
8. wireKeyboard({ ... }) ................... Phase 4
9. wirePastePump({ ... }) .................. Phase 5
10. wireClipboard({ ... }) ................. Plan 06-04
11. wireSessionLog({ ... }) ................ Plan 06-05
12. await wireSerial({ prefs, savePrefs, sessionLog, ... })  ... extended; auto-connect inside (D-34)
13. prefsSubscribe(applyPrefs) + applyPrefs(prefs)  ... NEW
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `addInitScript(() => localStorage.removeItem('bestialitty.prefs'))` erased the saved blob on `page.reload()`**
- **Found during:** Task 1 RED → GREEN run
- **Issue:** Initial test bodies cleaned `bestialitty.prefs` via `page.addInitScript()` so each test started from defaults. But Playwright's `addInitScript` runs on EVERY navigation including `page.reload()`, so the saved blob was being wiped right before `main.js`'s `loadPrefs()` read it. 6 round-trip tests failed (theme / phosphor / serial / localEcho / crlfMode / fontZoom).
- **Fix:** Removed all `addInitScript(() => localStorage.removeItem(...))` calls. Playwright provides a fresh browser context per test so `localStorage` starts empty by default — the cleanup was redundant AND broken.
- **Files modified:** www/tests/session/prefs.spec.js (10 tests)
- **Commit:** 4b71af5

### Critical Functionality Added (Rule 2)

**1. canvas.js `setZoom(z)` absolute setter** — applyPrefs needs an absolute path; `zoomStep(+/-1)` is delta-relative and would never converge to a stored `fontZoom` from arbitrary current state. Added with the same side-effects as `zoomStep` plus a same-value short-circuit (REVIEW warning 3 pattern). Used by `applyPrefs` and exposed for tests.

**2. localEcho + crlfMode + fontZoom + theme + phosphor + serial-config savePrefs wiring at every change site** — without this, the round-trip persistence tests would only work via `window.__prefs.savePrefs()` direct calls (which the tests use for theme/phosphor/serial), but real users toggling the Settings checkbox or pressing Ctrl+= would never persist. PREF-01/PREF-02 require the change handlers to persist; the test suite happens to also exercise this path for localEcho/crlfMode.

**3. mock-serial.js `__mockOpenCount` test hook** — without this, the Pitfall 3 race-guard regression test would have no way to assert "open() did not fire twice." Added alongside the `__preGrantPort` and `__forceOpenReject` hooks.

## Threat Model Compliance

| Threat ID | Mitigation Implemented |
|-----------|------------------------|
| T-06-06-01 (localStorage tampering) | JSON.parse wrapped in try/catch; defensive merge with DEFAULTS; version field gates migrations and rejects future versions. Tested via "version migration: parsed.version > CURRENT_VERSION → fall back to defaults". |
| T-06-06-02 (quota DoS) | catch QuotaExceededError → console.warn → in-memory prefs preserved. Tested via "quota error swallowed silently; in-memory prefs preserved". |
| T-06-06-03 (auto-connect bypass user gesture) | accept — user opted in via Settings checkbox (off by default per D-36). Tested via "prefs.autoConnect=false → no silent open at boot". |
| T-06-06-04 (auto-connect double-open race) | gate on `state === 'disconnected'` at moment of invocation. Tested via "auto-connect race: state must be 'disconnected' at moment of invocation (Pitfall 3)" — `window.__mockOpenCount <= 1`. |
| T-06-06-05 (Reset prefs clearing port preset) | resetPrefs ONLY removes `bestialitty.prefs`; `bestialitty.port.preset` (Phase 5 D-31 identity) intentionally separate. Tested implicitly via "Reset prefs button: second click..." — port-preset persists across reset. |
| T-06-06-06 (prefs blob discloses serial config) | accept — same trust level as Phase 5 port-preset key; localStorage origin-scoped; no PII. |

## Wave 6 Unblock

- Deploy artifacts (LICENSE, .github/workflows/pages.yml, _headers, .nojekyll, CSP meta) can land — prefs persistence is stable and well-tested; the schema and boot order are now load-bearing for the deploy contract.
- 24-h soak (Plan 06-08) can verify prefs survive across the soak interval (memory snapshots already implicit in the existing performance.memory + wasm.memory.buffer.byteLength sampling).

## Self-Check: PASSED

**Files created/modified verified to exist:**
- FOUND: www/state/prefs.js (118 LOC)
- FOUND: www/main.js (boot reorder + applyPrefs)
- FOUND: www/renderer/canvas.js (setZoom)
- FOUND: www/renderer/chrome.js (Settings rows handlers + savePrefs hooks)
- FOUND: www/transport/serial.js (auto-connect path + form persist)
- FOUND: www/index.html (Settings rows + footer reword)
- FOUND: www/tests/session/prefs.spec.js (14 tests un-fixmed)
- FOUND: www/tests/session/auto-connect.spec.js (5 tests un-fixmed)
- FOUND: www/tests/transport/mock-serial.js (3 test hooks)

**Commits:**
- FOUND: 4b71af5 — feat(06-06): prefs.js + boot reorder + Settings rows for PREF-01/PREF-02
- FOUND: 3b69fb2 — test(06-06): un-fixme 5 auto-connect.spec.js stubs + mock-serial test hooks

**Test counts:**
- 14/14 prefs.spec.js passing
- 5/5 auto-connect.spec.js passing
- 166 total Playwright tests passing across the project, 1 skipped (pre-existing Wave 0 stub)
