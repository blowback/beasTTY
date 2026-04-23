---
phase: 05-web-serial-transport
plan: 07
subsystem: transport
tags: [phase-5, wave-6, lifecycle, beforeunload, visibilitychange, human-uat, polite-fail]

# Dependency graph
requires:
  - phase: 05-web-serial-transport
    provides: "Waves 0-5 — tx-sink, serial.js pure-async read loop, setSignals discipline, navigator.serial connect/disconnect wiring, paste-pump"
  - phase: 03-canvas-renderer
    provides: "chrome.js visibilitychange listener + wireChrome(opts) DI pattern; requestFrame export from canvas.js"
provides:
  - "beforeunload best-effort teardown chain (D-30) — setSignals(DTR=false, RTS=false) -> reader.cancel -> port.close with catch(()=>{}) at every step"
  - "visibilitychange catch-up paint on foreground return (D-39) — additive to Phase 3's BEL-prefix-strip listener"
  - "requestFrame threaded through wireChrome opts — defensively-optional"
  - "All 5 remaining Playwright fixmes un-fixme'd (2 readloop + 3 polite-fail) — zero test.fixme markers left in www/tests/transport/"
  - "05-HUMAN-UAT.md filled with 40 numbered steps across 6 test rows — complete step-by-step instructions for real-hardware UAT"
  - "Auto-approved human-verify checkpoint in auto-chain mode — real-hardware UAT pending out-of-band"
affects: [06-polish-and-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "beforeunload best-effort teardown — fire-and-forget catch(()=>{}) at every step; intentionally bypasses the shared teardown() helper because beforeunload has a tight browser time budget"
    - "visibilitychange additive extension — single listener in app, two concerns (BEL-prefix strip + catch-up paint) handled in one callback body"
    - "Defensive DI — requestFrame in wireChrome opts is optional (falsy guard) so tests that call wireChrome without it still work"
    - "Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined }) — polite-fail test setup because plain `delete navigator.serial` is a no-op in real Chromium (property is non-configurable getter)"

key-files:
  created:
    - ".planning/phases/05-web-serial-transport/05-07-SUMMARY.md — this file"
  modified:
    - "www/transport/serial.js — beforeunload handler registered inside wireSerial (D-30)"
    - "www/renderer/chrome.js — visibilitychange listener extended with requestFrame catch-up; wireChrome opts destructure extended with requestFrame (D-39)"
    - "www/main.js — requestFrame passed into wireChrome opts"
    - "www/tests/transport/readloop.spec.js — 2 fixme tests converted to live assertions (visibilitychange catch-up + read error -> port-lost)"
    - "www/tests/transport/polite-fail.spec.js — 3 fixme tests converted to live assertions (body replace, title, no canvas)"
    - ".planning/phases/05-web-serial-transport/05-HUMAN-UAT.md — 6 test rows filled with 40 numbered steps; status draft -> in-progress; Summary section added"

key-decisions:
  - "beforeunload bypasses the shared teardown() helper intentionally — teardown awaits each step, and beforeunload's browser time budget cannot afford that latency. This is the ONLY code path that bypasses teardown; the choice is called out in the source comment so future refactors don't collapse the two paths."
  - "requestFrame in wireChrome opts is defensively-optional (`if (!document.hidden && requestFrame) requestFrame()` — falsy guard) so tests that call wireChrome without requestFrame fall back to Phase 3 BEL-prefix-only behavior. This keeps the chrome.js module standalone-testable."
  - "Polite-fail setup uses `Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined })` instead of the plan's original `delete navigator.serial` — the delete is a silent no-op in real Chromium because navigator.serial is a non-configurable getter. The prototype-override approach matches the `typeof navigator.serial === 'undefined'` check in main.js D-32/D-33."
  - "Task 4 human-verify checkpoint auto-approved under `workflow._auto_chain_active=true`. Each of the 6 test rows marked with `result: auto-approved-in-auto-chain (pending real-hardware UAT)` rather than a fake `pass`, so the document honestly signals that the plan-level UAT doc is verified complete but the real-hardware session remains pending. The user will run the 6 real-hardware tests against a physical MicroBeast + CP2102N out-of-band and fill in the real `pass/fail/partial` results at that time."

patterns-established:
  - "Task-4 honest auto-chain signalling — human-verify checkpoints that depend on real hardware the agent cannot reach MUST record `auto-approved-in-auto-chain (pending real-hardware UAT)` not `pass`. The plan verifies the UAT document is ready; the real checklist run happens later with the human at the desk."
  - "chrome-side extension of an existing listener — preserve the Phase 3 invariant of 'exactly ONE visibilitychange listener in the app' by augmenting the callback body, never registering a second listener"
  - "Playwright setup hardening — Object.defineProperty on Navigator.prototype is the real-Chromium equivalent of the delete-property pattern that works in JSDOM/Firefox"

requirements-completed: [XPORT-06, XPORT-11, PLAT-01, PLAT-02]

# Metrics
duration: ~6min
completed: 2026-04-23
---

# Phase 05 Plan 07: Wave 6 — Lifecycle Hardening + Human UAT Summary

**Lifecycle hardening: beforeunload best-effort teardown chain (D-30) landed inside wireSerial; visibilitychange listener in chrome.js extended with requestFrame catch-up (D-39) while preserving Phase 3's single-listener invariant. All 5 remaining Playwright fixmes un-fixme'd (2 readloop + 3 polite-fail); zero test.fixme markers in www/tests/transport/. 05-HUMAN-UAT.md filled with 40 numbered steps across 6 real-hardware test rows. Task 4 checkpoint auto-approved in auto-chain mode with honest `auto-approved-in-auto-chain (pending real-hardware UAT)` signalling.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-23T02:50:00Z (approx — based on git commit timestamps)
- **Completed:** 2026-04-23T02:58:00Z
- **Tasks:** 4 (3 auto + 1 human-verify checkpoint auto-approved)
- **Files modified:** 6

## Accomplishments

- **beforeunload handler (D-30):** Inside `wireSerial(opts)`, added a `window.addEventListener('beforeunload', ...)` that fires `port.setSignals(DTR=false, RTS=false) -> reader.cancel() -> port.close()` with `.catch(() => {})` at every step. Fire-and-forget; Chromium may terminate mid-promise but DTR/RTS is requested to drop before the process dies. No-op when port/reader are null (state === 'disconnected' path).
- **visibilitychange catch-up (D-39):** Extended chrome.js's existing visibilitychange listener (the Phase 3 BEL-prefix-strip handler) with `if (!document.hidden && requestFrame) requestFrame()`. Wakes the renderer to paint accumulated bytes when the tab returns to foreground, bypassing Chromium's ~1 Hz rAF throttle on hidden tabs. Preserved the Phase 3 invariant of exactly ONE visibilitychange listener in the app.
- **wireChrome opts expansion:** requestFrame threaded in via opts destructure; main.js passes it explicitly; chrome.js treats it as defensively-optional (`if (requestFrame)` guard).
- **5 Playwright fixmes un-fixme'd:**
  - `readloop.spec.js:visibilitychange !hidden triggers requestFrame catch-up` — dispatches hidden→push→visible sequence, asserts `HI` appears on the grid after catch-up paint fires, state stays `connected`.
  - `readloop.spec.js:read error transitions state to port-lost` — monkey-patches MockReader.read to throw NetworkError once, expects `data-state=port-lost` + `permission-revoked` entry in error log (D-28).
  - `polite-fail.spec.js` (3 tests: body replace, title, no canvas) — setup uses `Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined })` because `delete navigator.serial` is a no-op in real Chromium.
- **05-HUMAN-UAT.md complete:** 6 test rows with 40 numbered steps total. Each step cites exact UI-SPEC literal strings to verify (button labels, port-status copy, progress line format, polite-fail h1, etc.). Status flipped from `draft` to `in-progress`.
- **Full Playwright suite:** 101 passed / 0 failed / 0 skipped in clean run. (Pre-existing parallel-run timing flakes on paste@19200 95% gate and bell overlay spec observed intermittently — passed in isolation and on subsequent re-run; noted as known Wave 5 phenomenon.)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add beforeunload handler + visibilitychange catch-up** — `bdfac66` (feat)
2. **Task 2: Un-fixme readloop + polite-fail tests** — `1f69c63` (test)
3. **Task 3: Fill 05-HUMAN-UAT.md with step-by-step instructions** — `f07070d` (docs)
4. **Task 4: Auto-approve human-verify checkpoint in auto-chain mode** — `8a667d6` (docs)

**Plan metadata:** pending final commit (docs: complete 05-07 plan)

## Files Created/Modified

- `www/transport/serial.js` — beforeunload handler added inside wireSerial (AFTER the navigator.serial connect/disconnect listener registration, BEFORE the getPorts() restore block). All three steps wrapped in `.catch(() => {})`. Comment documents why this is the one code path that bypasses the shared teardown helper.
- `www/renderer/chrome.js` — wireChrome opts destructure extended with `requestFrame`; visibilitychange callback body extended with `if (!document.hidden && requestFrame) requestFrame()`. Comment notes D-39 catch-up rationale + Pitfall #6 mitigation.
- `www/main.js` — `wireChrome({...})` call site now includes `requestFrame` alongside the Phase 3 chrome refs.
- `www/tests/transport/readloop.spec.js` — 2 test.fixme converted to test with real assertions (visibility catch-up HI rendering + NetworkError read-error triggering port-lost).
- `www/tests/transport/polite-fail.spec.js` — 3 test.fixme converted to test; setup hardened with Navigator.prototype getter override + pageerror filter for the expected `__polite-fail__` throw.
- `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` — 40 numbered steps across 6 test rows (10/6/7/10/4/3 steps per test respectively); front-matter `draft -> in-progress`; Summary + Sign-Off sections expanded.

## Decisions Made

- beforeunload intentionally bypasses teardown() — documented in source comment so future refactors don't collapse the two paths.
- requestFrame in wireChrome opts is defensively-optional — keeps chrome.js standalone-testable.
- Polite-fail test setup uses prototype getter override, not `delete navigator.serial` — the delete is a no-op in real Chromium (non-configurable getter).
- Task 4 auto-approved with honest `auto-approved-in-auto-chain (pending real-hardware UAT)` result strings — distinguishes plan-level document verification from physical-hardware checklist execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Polite-fail test setup `delete navigator.serial` was a no-op in real Chromium**
- **Found during:** Task 2 Part B (polite-fail tests)
- **Issue:** The plan's reference setup `await page.addInitScript(() => { delete navigator.serial; });` failed silently in headless Chromium because `navigator.serial` is a non-configurable getter on `Navigator.prototype`. Result: `typeof navigator.serial === 'undefined'` in main.js evaluated to `false`, the polite-fail gate never fired, and all 3 tests failed asserting missing h1/title/absent-canvas.
- **Fix:** Changed setup to `Object.defineProperty(Navigator.prototype, 'serial', { configurable: true, get: () => undefined })` with an `Object.defineProperty(navigator, 'serial', ...)` fallback. This makes the `typeof` check see `undefined` as required by D-32/D-33. Also added `page.on('pageerror', (err) => { if (err.message.includes('__polite-fail__')) return; throw err; })` to filter the expected abort throw from Playwright's default page-error trap.
- **Files modified:** www/tests/transport/polite-fail.spec.js
- **Commit:** 1f69c63

## Issues Encountered

- Pre-existing parallel-run timing flakes on `paste.spec.js:32 paste at 19200 baud paces >= 95% of expected duration @slow` and `bell.spec.js:8 BEL byte triggers #bell-overlay.flash class momentarily`. Both pass in isolation and on re-run; noted in 05-06-SUMMARY.md as a known pre-existing issue not introduced by Wave 5/6 changes. No code change warranted — flakes are parallel-scheduler contention, not logic bugs.

## User Setup Required

**Real-hardware UAT session pending.** When the user sits down with a physical MicroBeast + CP2102N USB-C cable in Chromium, they should run the 6 test rows in `05-HUMAN-UAT.md` in order (Test 1 first — SC-1 end-to-end, then 2-3 reconnect variants, then 4 paste overrun, then 5 polite-fail in Firefox+Safari, then 6 five-minute daily-driver feel). Each test row has a `**result:**` field currently set to `auto-approved-in-auto-chain (pending real-hardware UAT)` — the user should overwrite each with `pass` / `fail` / `partial` and a concrete reason, update the Summary section counts, and flip front-matter `status: in-progress` → `status: complete` on full pass.

## Next Phase Readiness

- All 4 XPORT requirements mentioned in this plan (XPORT-06 hardening, XPORT-11 end, PLAT-01/02) are satisfied at the automated level.
- Phase 5 is ready for `/gsd-verify-phase 05` — the verifier will confirm all 38+ Playwright tests pass (actually 101 tests in suite now with Phase 3/4 inclusion), all SC-* criteria have automated anchors, and the 05-HUMAN-UAT.md document is structurally complete.
- Phase 6 PREF-01 (baud-rate preference persistence) can now call `setBaudForPump(baud)` from paste-pump.js on config change — stable API since Wave 5.
- Phase 6 SESS-03 (clipboard-paste) can reuse `enqueuePaste(bytes)` directly — same public API; Ctrl+V replaces the Debug-pane textarea.

## Known Stubs

None. All beforeunload, visibilitychange, and polite-fail code paths are fully wired to real behaviors. The `requestFrame` defensively-optional guard in chrome.js is not a stub — it is a deliberate DI affordance for tests.

---
*Phase: 05-web-serial-transport*
*Completed: 2026-04-23*

## Self-Check: PASSED

All files created/modified verified present:
- www/transport/serial.js: FOUND (beforeunload handler inside wireSerial)
- www/renderer/chrome.js: FOUND (visibilitychange catch-up + requestFrame destructure)
- www/main.js: FOUND (requestFrame passed into wireChrome)
- www/tests/transport/readloop.spec.js: FOUND (2 live tests, zero fixme)
- www/tests/transport/polite-fail.spec.js: FOUND (3 live tests, zero fixme; Navigator.prototype getter override)
- .planning/phases/05-web-serial-transport/05-HUMAN-UAT.md: FOUND (6 rows, 40 numbered steps, status=in-progress)
- .planning/phases/05-web-serial-transport/05-07-SUMMARY.md: FOUND (this file)

All task commits verified in git log:
- bdfac66: FOUND (Task 1 — feat: beforeunload + visibilitychange)
- 1f69c63: FOUND (Task 2 — test: un-fixme 5 Playwright tests)
- f07070d: FOUND (Task 3 — docs: fill 05-HUMAN-UAT.md)
- 8a667d6: FOUND (Task 4 — docs: auto-approve checkpoint in auto-chain)

All success criteria met:
- [x] 4 tasks executed (3 auto committed + 1 checkpoint auto-approved)
- [x] beforeunload handler calls setSignals + cancel + close best-effort
- [x] visibilitychange listener calls requestFrame on !hidden transitions
- [x] requestFrame threaded through wireChrome opts (defensively-optional)
- [x] Zero remaining test.fixme markers in www/tests/transport/
- [x] 05-HUMAN-UAT.md has 40 step-by-step instructions across 6 test rows
- [x] Human-verify checkpoint auto-approved in auto-chain mode (honest signalling)
- [x] Full Playwright suite 101 passed / 0 failed in clean run
- [x] Phase 5 ready for /gsd-verify-phase 05
