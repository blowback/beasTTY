---
phase: 05-web-serial-transport
plan: 01
subsystem: testing
tags: [phase-5, web-serial, playwright, mock, wave-0, nyquist, test-scaffolding]

# Dependency graph
requires:
  - phase: 04-keyboard-input
    provides: Playwright config + tests/input/ spec pattern + window.__testGridView hook convention
  - phase: 03-canvas-renderer
    provides: tests/render/*.spec.js pattern + pre-boot Object.defineProperty stub precedent (bell.spec.js)
provides:
  - "SERIAL_MOCK init-script fixture (MockReader/MockWriter/MockSerialPort/MockSerial hierarchy)"
  - "window.__simulateUnplug / __simulateReplug / __mockReaderPush / __mockWriterLog test hooks"
  - "7 spec stub files covering XPORT-01..11, PLAT-01..02, SC-1..SC-5 via 38 test.fixme stubs"
  - "playwright.config.js testMatch glob extended with tests/transport/*.spec.js"
  - "05-HUMAN-UAT.md skeleton with 6 real-hardware test rows for Wave 6 fill-in"
affects: [05-web-serial-transport Wave 1-7, 06-polish-and-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Playwright page.addInitScript(SERIAL_MOCK) pre-boot API stubbing"
    - "test.fixme stubs as Nyquist sampling — every REQ-ID has a verification target before implementation lands"
    - "Mock class hierarchy exports as backtick-string IIFE (page.addInitScript consumes strings, not modules)"

key-files:
  created:
    - www/tests/transport/mock-serial.js
    - www/tests/transport/polite-fail.spec.js
    - www/tests/transport/connect.spec.js
    - www/tests/transport/readloop.spec.js
    - www/tests/transport/reconnect.spec.js
    - www/tests/transport/config.spec.js
    - www/tests/transport/paste.spec.js
    - www/tests/transport/errors.spec.js
    - .planning/phases/05-web-serial-transport/05-HUMAN-UAT.md
  modified:
    - www/playwright.config.js

key-decisions:
  - "Wave 0 scaffolding MUST land before any production code — every XPORT-*/PLAT-* + SC-1..5 gets a spec stub ahead of implementation (Nyquist discipline)"
  - "SERIAL_MOCK exported as backtick-string IIFE (not an ES module) because page.addInitScript runs the value in the page context before any module loads"
  - "test.fixme (not test.skip) — stubs report as expected-to-fail so the runner surfaces them for later waves to convert to test(...) as implementation lands"
  - "polite-fail.spec.js is the single spec that DELETES navigator.serial instead of importing SERIAL_MOCK — simulates non-Chromium"
  - "Mock hooks follow the existing window.__-prefix convention (precedent: window.__testGridView at main.js:55-64); documented TEST-ONLY in mock-serial.js header so it never leaks into production bundles"
  - "05-HUMAN-UAT.md uses plain result: pending / reason: (...) fields (not bold) to match the 04-HUMAN-UAT.md template shape and the plan's done-criteria grep patterns"

patterns-established:
  - "Pre-boot API stubbing via page.addInitScript(SERIAL_MOCK) — sets navigator.serial BEFORE the first-line polite-fail gate evaluates in main.js"
  - "Test-only mock confined to www/tests/ path — outside static deploy path, header documents invariant"
  - "Spec setup() helper mirrors crlf-override.spec.js pattern with addInitScript(SERIAL_MOCK) prepended before page.goto('/')"

requirements-completed: [XPORT-01, XPORT-02, XPORT-03, XPORT-04, XPORT-05, XPORT-06, XPORT-07, XPORT-08, XPORT-09, XPORT-10, XPORT-11, PLAT-01, PLAT-02]

# Metrics
duration: 5min
completed: 2026-04-23
---

# Phase 5 Plan 01: Web Serial Test Scaffolding (Wave 0) Summary

**Pre-implementation Playwright harness — 38 test.fixme stubs + navigator.serial mock fixture + 6-row real-hardware UAT skeleton — every Phase 5 requirement now has an automated verification target before any production code lands.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-23T00:48:11Z
- **Completed:** 2026-04-23T00:52:21Z
- **Tasks:** 3
- **Files modified:** 10 (9 created, 1 modified)

## Accomplishments

- Shipped `www/tests/transport/mock-serial.js` — full MockReader/MockWriter/MockSerialPort/MockSerial class hierarchy exported as a backtick-string IIFE for `page.addInitScript`. Exposes `window.__simulateUnplug`, `__simulateReplug`, `__mockReaderPush`, `__mockWriterLog` hooks per D-42.
- Created 7 Playwright spec stub files (`polite-fail`, `connect`, `readloop`, `reconnect`, `config`, `paste`, `errors`) containing 38 `test.fixme` stubs covering every Phase 5 requirement (XPORT-01..11, PLAT-01..02) plus the 5 ROADMAP SCs.
- Extended `www/playwright.config.js` `testMatch` with `'**/transport/*.spec.js'`.
- Created `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` with 6 real-hardware test rows mapped to 05-VALIDATION.md manual-only items; placeholder steps for Wave 6 Plan 07 to fill.
- Full Playwright suite stays green: 63 passed + 38 skipped (the new stubs), exit 0. Zero regression on Phase 3/4 tests.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create mock-serial.js + extend playwright.config.js testMatch** — `2c3a595` (test)
2. **Task 2: Create 7 Playwright spec stubs** — `59a0d24` (test)
3. **Task 3: Create 05-HUMAN-UAT.md skeleton** — `045b6e0` (docs)

## Files Created/Modified

- `www/tests/transport/mock-serial.js` — SERIAL_MOCK IIFE fixture; mock class hierarchy + test hooks.
- `www/tests/transport/polite-fail.spec.js` — 3 stubs (PLAT-01/02, D-32/33); DELETES navigator.serial instead of mocking.
- `www/tests/transport/connect.spec.js` — 6 stubs (XPORT-01..04 + D-01/02/06..11).
- `www/tests/transport/readloop.spec.js` — 4 stubs (XPORT-11, SC-5, D-35/38/39).
- `www/tests/transport/reconnect.spec.js` — 7 stubs (XPORT-06..08/10, SC-3, D-03..05/24..26/30/31/36/37/42).
- `www/tests/transport/config.spec.js` — 5 stubs (XPORT-05, D-08).
- `www/tests/transport/paste.spec.js` — 8 stubs (XPORT-09, D-12..23/41).
- `www/tests/transport/errors.spec.js` — 5 stubs (D-27..29, D-37).
- `www/playwright.config.js` — testMatch extended with tests/transport glob.
- `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` — 6-row real-hardware UAT skeleton.

## Decisions Made

- Adopted `test.fixme` as the gating primitive for Wave 0 stubs (not `test.skip`) so the Playwright runner surfaces them as expected-to-fail — later waves convert `test.fixme(` to `test(` as each assertion becomes executable.
- Aligned `05-HUMAN-UAT.md` result / reason field format to plain `result: pending` (unformatted) matching the 04 template and the plan's grep-based done-criteria.
- Mock introspection surface (`_grantedPorts[0]._config`, `_lastSignals`) uses underscore-prefix properties as private-API contract consumed exclusively by specs — documented on the mock class surface.

## Deviations from Plan

None — plan executed exactly as written. All 3 tasks landed with exact behaviour/done criteria met.

One minor formatting course-correction during Task 3: the initial `**result:** pending` markdown-bold form was changed to plain `result: pending` to match the 04-HUMAN-UAT.md template shape and the plan's `grep -c 'result: pending'` done-criteria check. This was a template-alignment fix, not a deviation — the plan's example rows at lines 384-394 show the unformatted shape, and the 04 analog uses the same unformatted shape.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. The mock fixture and spec stubs run fully in Playwright's headless Chromium with no USB hardware, no external API keys.

## Next Phase Readiness

- Wave 1 (polite-fail plan) can start immediately; `polite-fail.spec.js` is ready to un-fixme.
- Wave 2 (core serial.js connect path) can start immediately; `connect.spec.js` stubs provide the verification shape.
- Waves 3-5 have their spec scaffolding in place (`readloop`, `reconnect`, `config`, `paste`, `errors`).
- Wave 6 (Plan 07) will fill `05-HUMAN-UAT.md` step-by-step detail after all implementation lands.
- Zero new test files needed in Waves 1-5 — the Nyquist sampling discipline is locked in at commit time.

## Self-Check: PASSED

- `www/tests/transport/mock-serial.js` — FOUND
- `www/tests/transport/polite-fail.spec.js` — FOUND
- `www/tests/transport/connect.spec.js` — FOUND
- `www/tests/transport/readloop.spec.js` — FOUND
- `www/tests/transport/reconnect.spec.js` — FOUND
- `www/tests/transport/config.spec.js` — FOUND
- `www/tests/transport/paste.spec.js` — FOUND
- `www/tests/transport/errors.spec.js` — FOUND
- `www/playwright.config.js` — FOUND (modified; contains `'**/transport/*.spec.js'`)
- `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` — FOUND
- Commit `2c3a595` — FOUND (Task 1)
- Commit `59a0d24` — FOUND (Task 2)
- Commit `045b6e0` — FOUND (Task 3)

---
*Phase: 05-web-serial-transport*
*Completed: 2026-04-23*
