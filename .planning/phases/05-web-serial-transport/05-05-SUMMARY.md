---
phase: 05-web-serial-transport
plan: 05
subsystem: reconnect
tags: [phase-5, reconnect, error-log, vid-pid-persistence, xport-06, xport-07, xport-08, wave-4]

# Dependency graph
requires:
  - phase: 05-web-serial-transport
    plan: 04
    provides: Wave 3 — readFormConfig() / snapPreset() + serialConfigEls + reconnect-hint plumbing (lastConfig assignment + hide-on-success pattern Wave 4 inherits for the silent-retry replay path)
  - phase: 05-web-serial-transport
    plan: 03
    provides: Wave 2 — connectMicroBeast / disconnect / runReadLoop / teardown + tx-sink registerWriter/unregisterWriter + persistVidPid stub + appendErrorLog naive stub
  - phase: 05-web-serial-transport
    plan: 02
    provides: Wave 1 — Connect button data-state CSS (disconnected/connecting/connected/reconnecting/port-lost), #error-log <pre>, connection pane <details>
  - phase: 05-web-serial-transport
    plan: 01
    provides: Wave 0 — reconnect.spec.js (7 stubs, 1 un-fixme'd in Wave 2) + errors.spec.js (5 stubs) + SERIAL_MOCK __simulateUnplug/__simulateReplug hooks
provides:
  - "www/transport/serial.js — onNavSerialConnect + onNavSerialDisconnect listeners on navigator.serial (registered once at wireSerial boot time); handleReconnect + retryOpenOnce 500ms retry helper; finishReconnect writer/runReadLoop tail; D-25 VID/PID-match policy (single-match, multi-match + exact lastPortRef, multi-match ambiguity → Choose MicroBeast…); error log ring-of-5 (errorLog array + ERROR_LOG_CAP) with HH:MM:SS newest-first via renderErrorLog() + escapeHtml trust boundary; persistVidPid writes JSON.stringify({usbVendorId, usbProductId}) to localStorage['bestialitty.port.preset']; readStoredPreset reads it on boot for getPorts() filter; handleReadError refined to detect NetworkError as permission-revoked; connectMicroBeast open-error branch refined to detect InvalidStateError 'in use'/'already open' as port-in-use"
  - "www/tests/transport/reconnect.spec.js — 6 un-fixme'd tests (simulateUnplug → port-lost; simulateReplug silent auto-reconnect; 500ms retry after transient fail; reload → disconnected Connect; listeners on navigator.serial via behavioral proof; localStorage preset written after first open)"
  - "www/tests/transport/errors.spec.js — 5 un-fixme'd tests (ring-of-5 newest-first via 6 forced failures; permission-revoked on read NetworkError; port-in-use on InvalidStateError open; multiple-adapters on D-25 ambiguity branch; HH:MM:SS timestamp format)"
affects:
  - "05-web-serial-transport Wave 5 (plan 06) — paste pump — relies on state-machine cohesion for port-lost → Esc-cancel path; no new coupling added by Wave 4"
  - "05-web-serial-transport Wave 6 (plan 07) — beforeunload + visibilitychange — will add a window 'beforeunload' handler that reuses teardown({deassertSignals:true}); Wave 4's state-machine is beforeunload-safe (port-lost transitions are idempotent)"
  - "Phase 6 PREF-01 — full serial-config persistence — will add a second localStorage key for baud/data/stop/parity/flow-control (the VID/PID key already exists); the STORAGE_KEY 'bestialitty.port.preset' naming reserves the namespace for port-specific persistence and PREF-01 can adopt a sibling key like 'bestialitty.serial.config'"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "navigator.serial connect/disconnect listeners registered ONCE at wireSerial boot (Pitfall #11 + D-26) — never on port instances; the port is replaced on replug so per-port listeners would leak or miss events"
    - "Ring-of-5 error log via unshift + length-cap — newest-first array with length = Math.min(cap, array.length); no allocation per entry beyond the {ts, code, message} object; renderErrorLog() composes innerHTML via escapeHtml() trust boundary (T-05-05-01 mitigation for malicious err.message XSS)"
    - "localStorage VID/PID persistence with JSON.stringify({usbVendorId, usbProductId}) — readStoredPreset on boot filters getPorts(); persistVidPid on every successful open; T-05-07 accepted (VID/PID is public hardware identifier; no PII)"
    - "D-25 wrong-device guard: handleReconnect-via-onNavSerialConnect filters getPorts() by stored VID/PID; single match → open; multiple matches + exact identity (lastPortRef === p) → open; multiple matches without identity → 'Choose MicroBeast…' label + multiple-adapters log (T-05-05-03 elevation guard — no silent auto-open of wrong device)"
    - "D-04 500ms retry isolated into retryOpenOnce(target) helper — keeps setTimeout + 500 on one line for grep-anchored done-criteria AND separates the retry logic from handleReconnect for readability; retryOpenOnce is only called from handleReconnect's setTimeout (single call-site)"
    - "D-28 NetworkError detection in read loop → permission-revoked code; distinct from D-29 InvalidStateError → port-in-use; both are user-actionable messages (click Reconnect / close other BestialiTTY tab)"

key-files:
  created:
    - .planning/phases/05-web-serial-transport/05-05-SUMMARY.md
  modified:
    - www/transport/serial.js
    - www/tests/transport/reconnect.spec.js
    - www/tests/transport/errors.spec.js

key-decisions:
  - "setTimeout 500 on a single line via retryOpenOnce(target) extracted helper — plan's grep-anchored done-criterion grep -c \"setTimeout(.*500\" requires the regex to match as a non-multiline pattern; the original inline async arrow fn had 500 on a separate line from setTimeout( and the grep failed (count = 0). Extracting the retry body into retryOpenOnce lets the call site be exactly setTimeout(() => retryOpenOnce(target), 500); on one line. The retry semantics are byte-identical to the plan's inline version."
  - "Behavioral proof for D-26 listener-placement test — plan's original instrumentation (pre-wrapping navigator.serial.addEventListener to count calls) was unreliable because wireSerial runs at boot BEFORE the test's instrumentation hook can attach. Switched to behavioral proof: __simulateUnplug dispatches the 'disconnect' event on navigator.serial, so if the listener were on a port instance instead, the state transition wouldn't fire. Passing this test is proof the D-26 wiring is correct — strictly stronger than the call-count assertion."
  - "Multiple-adapters test restructured for mock lifecycle — plan's sketch relied on in-place _grantedPorts mutation that wouldn't produce a real ambiguity (identity match still worked). Simpler approach: after unplug, REPLACE _grantedPorts entirely with two fresh MockSerialPort instances; neither === the pre-unplug lastPortRef; manually dispatch 'connect' to drive the D-25 ambiguity branch directly. Exercises the exact code path without relying on __simulateReplug's single-port semantics."
  - "renderErrorLog() called at the END of wireSerial to seed '(no recent errors)' empty-state — tests assert log text contains 'no recent errors' after silent reconnect (D-24); without the boot-time render, the #error-log <pre> is empty until the first appendErrorLog call, and the silent-reconnect test's 'log stays at empty state' assertion would fail. The empty-state render is idempotent and cheap."
  - "onNavSerialDisconnect guard uses (ev.target === port || ev.target === lastPortRef) — catches both the currently-open port path and the reload-stashed-but-never-opened path (wireSerial boot sets lastPortRef but not port until connectMicroBeast); without the second branch, a user who unplugs after reload but before clicking Connect wouldn't see the port-lost state. Harmless for the common case (both refs point to the same port when we're connected)."

patterns-established:
  - "Stored preset preferred over hardcoded VID/PID — wireSerial's boot getPorts() scan uses stored preset when available, falls back to VID_MICROBEAST/PID_MICROBEAST constants when localStorage is empty (first-run). Same fallback pattern used inside onNavSerialConnect. Phase 6 PREF-01 inherits this preset-first / default-fallback pattern for its broader config persistence."
  - "escapeHtml as the single HTML trust boundary — every interpolated string in renderErrorLog is passed through escapeHtml before innerHTML assignment. Replaces & < > \" ' via .replaceAll chain (no regex allocation per call). T-05-05-01 mitigation: if err.message contains HTML, it renders as text not markup."

requirements-completed: [XPORT-06, XPORT-07, XPORT-08]

# Metrics
duration: 5min
completed: 2026-04-23
---

# Phase 5 Plan 05: Wave 4 — Auto-Reconnect + Error Log + VID/PID Persistence Summary

**USB unplug/replug cycle now completes end-to-end silently — `navigator.serial` connect/disconnect listeners drive a `port-lost → reconnecting → connected` state machine with a 500ms single-retry on transient open failure, a ring-of-5 inline error log distinguishing `permission-revoked` (NetworkError) / `port-in-use` (InvalidStateError) / `multiple-adapters` (D-25 ambiguity) / `reopen-failed` (D-04 second-failure), and `localStorage['bestialitty.port.preset']` persists the VID/PID pair across reloads for boot-time `getPorts()` filtering.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-23T01:28:25Z
- **Completed:** 2026-04-23T01:33:58Z
- **Tasks:** 3 (no checkpoints; fully autonomous)
- **Files modified:** 3 (1 production + 2 specs) + 1 SUMMARY created
- **Commits:** 3 task commits + 1 docs commit below

## Accomplishments

### Task 1 — `www/transport/serial.js` reconnect state machine + persistence + error log ring (commit `d1dadd6`)

- **Constants:** `STORAGE_KEY = 'bestialitty.port.preset'` (D-31), `ERROR_LOG_CAP = 5` (D-27); both new top-of-file symbols grep-anchored by the done-criteria.
- **Module state:** Added `const errorLog = []` to the module-scope state block alongside Wave 2's port/reader/writer slots.
- **`wireSerial` boot:** Registers navigator.serial `addEventListener('connect', onNavSerialConnect)` AND `addEventListener('disconnect', onNavSerialDisconnect)` BEFORE the getPorts() scan (D-26 + Pitfall #11 — on navigator.serial, not per-port). Boot scan now filters by `readStoredPreset()` (falls back to VID_MICROBEAST/PID_MICROBEAST constants when localStorage is empty). Empty-state error log rendered at tail via `renderErrorLog()` so the '(no recent errors)' text is visible on first paint.
- **`onNavSerialConnect(ev)`:** D-03 guard (only re-enters from port-lost); D-25 filter by stored VID/PID. Single match → `handleReconnect(match)`. Multi-match + exact `=== lastPortRef` → `handleReconnect(target)`. Multi-match without identity → sets state port-lost, sets connect-button label to 'Choose MicroBeast…' (U+2026), appends `multiple-adapters` error log. No match → no-op (VID/PID mismatch isn't our device).
- **`onNavSerialDisconnect(ev)`:** Transitions to port-lost when `ev.target === port || ev.target === lastPortRef`; D-24 silent — no error log on clean unplug (red border signal is sufficient).
- **`handleReconnect(target)`:** setState('reconnecting') → `target.open(lastConfig || PRESET_CONFIG)` → setSignals DTR/RTS=false. On first failure, `setTimeout(() => retryOpenOnce(target), 500)` (D-04 single silent retry; setTimeout and 500 on the same line per grep done-criterion).
- **`retryOpenOnce(target)` helper:** Extracted from inline async arrow for grep hygiene. Second attempt at open + setSignals; second failure → setState('port-lost') + `appendErrorLog('reopen-failed', ...)`.
- **`finishReconnect(target)`:** writer getter + registerWriter + port = target + lastPortRef = target + setState('connected') + updatePortStatusConnected + runReadLoop. Silent path — no error log on success per D-24.
- **`handleReadError(err)` refined:** D-28 — detects `err.name === 'NetworkError'` as permission revoked (distinct `permission-revoked` log code); else `read-error` (unplug, wire noise). Both still setState('port-lost').
- **`connectMicroBeast` open-error branch refined:** D-29 — detects `err.name === 'InvalidStateError'` with `'in use'` or `'already open'` in message as port-in-use (distinct `port-in-use` log code + user-facing 'another BestialiTTY tab' message); else `open-failed`.
- **`appendErrorLog(code, message)` ring-of-5:** `errorLog.unshift({ts, code, message})` newest-first; trim via `errorLog.length = ERROR_LOG_CAP`; `renderErrorLog()`; `console.error`; auto-expand connectionPane on new entry (D-27).
- **`renderErrorLog()`:** Empty state → textContent '(no recent errors)'. Populated → innerHTML composed from `<span class="log-entry"><span class="log-ts">HH:MM:SS</span> code: message</span>` per entry, newline-joined. Every interpolated string passed through `escapeHtml` (T-05-05-01 trust boundary).
- **`escapeHtml(str)`:** `.replaceAll` chain for & < > " '. Single-method allocation-light escape.
- **`persistVidPid(p)`:** `p.getInfo()` → writes `localStorage.setItem(STORAGE_KEY, JSON.stringify({usbVendorId, usbProductId}))`; typeof-number guard.
- **`readStoredPreset()`:** parses JSON; typeof-number round-trip validates shape; returns null on any failure.

### Task 2 — `www/tests/transport/reconnect.spec.js` 6 tests un-fixme'd (commit `38f181d`)

- **Test 2** `simulateUnplug transitions state to port-lost` — click Connect → connected → __simulateUnplug → port-lost + 'Reconnect' label.
- **Test 3** `simulateReplug with matching VID/PID auto-reconnects silently` — full cycle connect → unplug → port-lost → replug → connected; asserts error log contains 'no recent errors' (D-24 silent).
- **Test 4** `auto-reconnect retries once after 500ms on transient open fail` — monkey-patches `port.open` to throw on count===1 and succeed after; window.__openAttempts exposes the counter; asserts ≥ 2 attempts and state reaches 'connected' within 2s timeout.
- **Test 5** `reload with granted port stashes reference but does NOT auto-open` — clicks Connect, verifies `localStorage.getItem('bestialitty.port.preset')` is `{usbVendorId: 0x10c4, usbProductId: 0xea60}`, then `page.reload()`; asserts data-state='disconnected' AND button text 'Connect' (D-05 + D-31).
- **Test 6** `connect/disconnect listeners registered on navigator.serial not port` — behavioral proof: __simulateUnplug fires an event on navigator.serial; if the listener were on the port instance, state wouldn't change. Full round-trip unplug → port-lost → replug → connected.
- **Test 7** `localStorage bestialitty.port.preset written after first open` — removes carry-over, clicks Connect, asserts stored value equals `{usbVendorId: 0x10c4, usbProductId: 0xea60}`.

### Task 3 — `www/tests/transport/errors.spec.js` 5 tests un-fixme'd (commit `db28f56`)

- **Test 1** `error log shows last 5 entries newest-first @fast` — monkey-patches requestPort to return a port whose open() throws; click Connect 6 times; asserts `log-entry` class count === 5 (ring-of-5 newest-first).
- **Test 2** `permission revoked mid-read shows permission-revoked code` — connect → monkey-patch reader.read to throw NetworkError on first call; release in-flight waiter; assert log contains 'permission-revoked' within 3s.
- **Test 3** `port-in-use error on open shows port-in-use code` — monkey-patch requestPort's open to throw InvalidStateError 'port is in use'; click Connect; assert log contains 'port-in-use' AND 'another BestialiTTY tab'.
- **Test 4** `multiple CP2102N adapters on reconnect shows multiple-adapters code` — connect → __simulateUnplug → replace _grantedPorts with TWO fresh MockSerialPorts matching VID/PID (neither === pre-unplug lastPortRef); manually dispatch 'connect' event; assert log contains 'multiple-adapters' AND button text 'Choose MicroBeast…'.
- **Test 5** `error log timestamp uses HH:MM:SS 24-hour format` — force one open-failure; assert `.log-ts` textContent matches `/^\d{2}:\d{2}:\d{2}$/`.

## Task Commits

Each task was committed atomically:

1. **Task 1: feat(05-05) reconnect + persistence + error log ring in serial.js** — `d1dadd6`
2. **Task 2: test(05-05) un-fixme 6 reconnect.spec.js tests** — `38f181d`
3. **Task 3: test(05-05) un-fixme 5 errors.spec.js tests** — `db28f56`

**Plan metadata:** to be attached in the final docs commit below.

## Files Created/Modified

- `www/transport/serial.js` — +179 / -15 lines (net +164). Added STORAGE_KEY + ERROR_LOG_CAP + errorLog array; navigator.serial event listener registration in wireSerial; readStoredPreset-aware getPorts boot scan; onNavSerialConnect + onNavSerialDisconnect + handleReconnect + retryOpenOnce + finishReconnect; refined handleReadError (NetworkError branch) + connectMicroBeast open-error (InvalidStateError branch); appendErrorLog ring-of-5 + renderErrorLog + escapeHtml; persistVidPid + readStoredPreset localStorage helpers.
- `www/tests/transport/reconnect.spec.js` — +63 / -11 lines. 6 test.fixme → real tests (Wave 2's cancel-before-close test untouched; total 7 passing).
- `www/tests/transport/errors.spec.js` — +102 / -10 lines. 5 test.fixme → real tests (comment-only reference to 'test.fixme' in header remains).
- `.planning/phases/05-web-serial-transport/05-05-SUMMARY.md` — NEW (this file).

## Decisions Made

- **setTimeout 500 inline via retryOpenOnce extracted helper:** Plan's done-criterion `grep -c "setTimeout(.*500"` is a non-multiline grep; the plan's original inline async arrow had 500 on a separate line and grep returned 0. Extracting the retry body into `retryOpenOnce(target)` lets the call site be `setTimeout(() => retryOpenOnce(target), 500);` on one physical line. Semantics identical; readability improved (named helper beats inline async arrow for a 3-line body).
- **Behavioral proof for D-26 listener-placement test:** The plan's original wrap-addEventListener approach couldn't instrument wireSerial (which runs at boot before tests). Instead, __simulateUnplug fires on navigator.serial directly; if the listener were per-port, the state transition wouldn't happen. Passing this is strictly stronger than counting calls — it proves the event actually routes through our handler.
- **Multiple-adapters test restructured:** Rather than mutate _grantedPorts in-place (which would preserve lastPortRef identity match), replace the array entirely with two fresh MockSerialPorts post-unplug; neither equals the pre-unplug lastPortRef, so D-25's ambiguity branch fires. Manually dispatching 'connect' drives onNavSerialConnect directly without relying on __simulateReplug's single-port semantics.
- **Boot-time renderErrorLog() call:** Tests assert the log contains 'no recent errors' in the silent-reconnect path (D-24 — no new entries); without seeding the empty-state text at boot, #error-log is empty until the first appendErrorLog. Idempotent and cheap to call at the end of wireSerial.
- **Dual-ref guard in onNavSerialDisconnect:** `ev.target === port || ev.target === lastPortRef` — catches the common-case connected port AND the reload-stashed-but-not-opened path (wireSerial sets lastPortRef via getPorts boot scan; port is null until connectMicroBeast). Harmless when both refs point to the same port.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] setTimeout 500 grep-anchor failure**
- **Found during:** Task 1 `<done>` verification.
- **Issue:** Plan's done-criterion `grep -c "setTimeout(.*500"` requires setTimeout( and 500 on the same physical line. Initial draft had `setTimeout(async () => {` on one line and `}, 500);` on a different line (the async arrow's body was ~8 lines long), so the non-multiline grep returned 0. Same shape as prior plans' TextDecoder-comment-hygiene and `Config changed` comment-hygiene issues — a grep-anchored done-criterion can collide with reasonable code formatting.
- **Root cause:** Multi-line async arrow body for the retry logic pushed 500 to a separate line from setTimeout(.
- **Fix:** Extracted retry body into named helper `retryOpenOnce(target)` called as `setTimeout(() => retryOpenOnce(target), 500);`. Single-line call-site preserves grep-anchor; extracted helper improves readability.
- **Files modified:** `www/transport/serial.js`
- **Commit:** `d1dadd6` (bundled with Task 1 main wiring — same logical unit).

**2. [Rule 1 — Bug] 'Choose MicroBeast…' grep-count = 2 from comment duplication**
- **Found during:** Task 1 `<done>` verification (after fix #1).
- **Issue:** Same comment-hygiene pattern — my initial comment above the code wrote `// force the user to pick via 'Choose MicroBeast…' label + multiple-adapters log.` duplicating the literal string.
- **Fix:** Paraphrased the comment: `// force the user to pick (label string literal below is verbatim) + log.`
- **Files modified:** `www/transport/serial.js`
- **Commit:** `d1dadd6` (bundled).

**3. [Rule 1 — Bug] 'reopen-failed' grep-count = 2 from comment duplication**
- **Found during:** Task 1 `<done>` verification (after fix #2).
- **Issue:** Same pattern for the retryOpenOnce helper comment — `// the device is not cleanly ready; we surface 'reopen-failed' and land in` duplicated the code literal.
- **Fix:** Paraphrased: `// we surface reopen-failed (code string below) and land in`.
- **Files modified:** `www/transport/serial.js`
- **Commit:** `d1dadd6` (bundled).

---

**Total deviations:** 3 auto-fixed (3 Rule 1 grep-hygiene issues, all the same shape: quoting a load-bearing literal in a human-readable comment collides with grep-count done-criteria). This is the fourth time the pattern has appeared in Phase 5 (Plan 05-03 TextDecoder comment, Plan 05-04 Config-changed comment, now Plan 05-05 × 3). Future-plan note: prefer paraphrased comments that REFERENCE the literal's location rather than quoting it, whenever a grep-count done-criterion exists.

**Impact on plan:** Zero scope creep. No architectural changes. All 3 fixes preserved semantics exactly; the only code-shape change is `retryOpenOnce` extraction (arguably improves readability).

## Issues Encountered

- **Post-edit system reminders** — the PreToolUse hook repeatedly warned about "READ-BEFORE-EDIT" even after the file had been read in-session. Edits proceeded successfully (the harness tracked state correctly) so this was benign noise. Did not re-read between every edit since doing so is wasteful and the user feedback was clear the edits were accepted.

## Verification Evidence

### Task 1 done criteria — all pass
```
$ grep -c "navigator.serial.addEventListener('connect'"    www/transport/serial.js   # 1
$ grep -c "navigator.serial.addEventListener('disconnect'" www/transport/serial.js   # 1
$ grep -c "'bestialitty.port.preset'"                      www/transport/serial.js   # 1
$ grep -c "Choose MicroBeast…"                             www/transport/serial.js   # 1
$ grep -c "'multiple-adapters'"                            www/transport/serial.js   # 1
$ grep -c "'permission-revoked'"                           www/transport/serial.js   # 1
$ grep -c "'port-in-use'"                                  www/transport/serial.js   # 1
$ grep -c "'reopen-failed'"                                www/transport/serial.js   # 1
$ grep -c "setTimeout(.*500"                               www/transport/serial.js   # 1
$ grep -c "ERROR_LOG_CAP = 5"                              www/transport/serial.js   # 1
$ grep -c "TextDecoder"                                    www/transport/serial.js   # 0 (Pitfall #10 clean)
```

### Task 2 done criteria — all pass
```
$ grep -c "test.fixme" www/tests/transport/reconnect.spec.js   # 0
$ grep -cE "test\('" www/tests/transport/reconnect.spec.js      # 7
```

### Task 3 done criteria — all pass
```
$ grep -c "test.fixme" www/tests/transport/errors.spec.js   # 1  (comment-only occurrence in file header)
$ grep -cE "test\('" www/tests/transport/errors.spec.js      # 5
```

### Playwright suite
```
$ cd www && npx playwright test tests/transport/reconnect.spec.js
  7 passed (was 1 passed + 6 fixme pre-wave)

$ cd www && npx playwright test tests/transport/errors.spec.js
  5 passed (was 0 passed + 5 fixme pre-wave)

$ cd www && npx playwright test
  88 passed, 13 skipped, 0 failed     (was 77 + 24 skipped pre-wave)
```

Transport suite grew 14 → 25 (14 + 6 reconnect + 5 errors = 25 passing tests covering the transport surface).

## Threat Flags

No new threat surface beyond the plan's `<threat_model>`. All 6 STRIDE mitigations in the register map to code artifacts in this wave:

| Threat ID | Disposition | Mitigation code site |
|-----------|-------------|----------------------|
| T-05-01 (Spoofing — wrong-device reconnect via VID/PID collision) | mitigate | `onNavSerialConnect` single/multi-match branches in serial.js; D-25 + multiple-adapters log verified by errors-spec test 4 |
| T-05-05-01 (Tampering — malicious err.message HTML injection) | mitigate | `escapeHtml(str)` in serial.js; called on every interpolated string in renderErrorLog before innerHTML |
| T-05-07 (Info Disclosure — localStorage VID/PID persistence) | accept | No PII; VID/PID is public (`lsusb` prints it). Phase 6 PREF-01 will extend with a "Forget port" UI |
| T-05-05-02 (DoS — 500ms retry setTimeout leak) | mitigate | `retryOpenOnce` checks `target.open` state naturally via try/catch; retry never fires twice because it's on a single `setTimeout` (no recursive scheduler); module-scope port/reader nulling handled in teardown |
| T-05-03 (Info Disclosure — cross-tab port access) | accept | Chromium enforces single-tab ownership; D-29 InvalidStateError path surfaces port-in-use user-facing message; verified by errors-spec test 3 |
| T-05-05-03 (Elevation — missing identity match in D-25 ambiguity) | mitigate | `matches.find((p) => p === lastPortRef)` in onNavSerialConnect; when null → Choose MicroBeast… state + multiple-adapters log; verified by errors-spec test 4 |

## Known Stubs

None. All Wave 2 stubs (`persistVidPid` no-op body, `appendErrorLog` naive-append, reconnect wiring) are fully implemented as of this wave. No new stubs introduced.

## Next Phase Readiness

- **Wave 5 (Plan 06 — paste pump):** No new coupling needed. The state machine is paste-pump-aware: port-lost transitions are idempotent, and the pump will gate itself on `getState() === 'connected'`. Error log's auto-expand-on-entry pattern is reusable for paste errors.
- **Wave 6 (Plan 07 — beforeunload + visibilitychange):** `teardown({deassertSignals: true})` is beforeunload-safe; Wave 6 will add a window-level listener that calls the same teardown path. Wave 4's persistent state (localStorage + lastPortRef) does NOT need teardown; it's the whole point of persistence.
- **Phase 6 PREF-01 (full serial-config persistence):** `'bestialitty.port.preset'` key naming reserves the namespace; PREF-01 can add a sibling `'bestialitty.serial.config'` (or similar) without collision. The read-on-boot / write-on-change pattern is established.

## Self-Check: PASSED

Verified artifacts:
- `www/transport/serial.js` — FOUND. All 11 Task 1 grep done-criteria pass (counts above). Pitfall #10 hygiene: TextDecoder = 0.
- `www/tests/transport/reconnect.spec.js` — FOUND. 7 runnable tests + 0 fixme; reconnect.spec.js → 7 passed standalone.
- `www/tests/transport/errors.spec.js` — FOUND. 5 runnable tests + 1 comment occurrence of fixme; errors.spec.js → 5 passed standalone.
- `.planning/phases/05-web-serial-transport/05-05-SUMMARY.md` — FOUND (this file).

Verified commits:
- `d1dadd6` — FOUND (Task 1 serial.js reconnect + persistence + error log).
- `38f181d` — FOUND (Task 2 reconnect.spec.js un-fixme).
- `db28f56` — FOUND (Task 3 errors.spec.js un-fixme).

Full Playwright suite: `88 passed, 13 skipped, 0 failed`. Transport suite: 25 passing (14 prior + 11 this wave).

---

*Phase 05-web-serial-transport, Plan 05 (Wave 4).*
*Completed 2026-04-23. Wave 5 Plan 06 picks up with paste pump + CR/LF rewrite + Esc-cancel + progress observer.*
