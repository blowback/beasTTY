---
phase: 05-web-serial-transport
plan: 04
subsystem: serial-config
tags: [phase-5, serial-config, preset-reset, xport-05, wave-3]

# Dependency graph
requires:
  - phase: 05-web-serial-transport
    plan: 03
    provides: Wave 2 — connectMicroBeast / disconnect / runReadLoop / teardown / wireSerial(opts) skeleton + tx-sink register/unregisterWriter
  - phase: 05-web-serial-transport
    plan: 02
    provides: Connection pane DOM (5 <select>s + Reset button) + CSS that Wave 3 un-locks via form-listener wiring
  - phase: 05-web-serial-transport
    plan: 01
    provides: Wave 0 config.spec.js — 5 test.fixme stubs unlocked by this plan + SERIAL_MOCK _grantedPorts[0]._config introspection hook
provides:
  - "www/transport/serial.js — readFormConfig() + snapPreset() + showReconnectHint/hideReconnectHint helpers; wireSerial destructures serialConfigEls; change listeners on 5 <select>s flag 'Config changed — Disconnect and Connect to apply' when connected && current !== lastConfig; Reset button + mousedown preventDefault (UI-SPEC line 576); connectMicroBeast now uses configOverride || readFormConfig() as the config source; hideReconnectHint() at end of successful connect to reconcile form with the live port"
  - "www/index.html — <span id='serial-reconnect-hint' class='hint' hidden> between the serial-config fieldset and Reset button; amber #e0b030 CSS rule matching the connecting/reconnecting border signal; [hidden] selector collapses visibility"
  - "www/main.js — 7 new DOM refs (serial-baud / serial-databits / serial-stopbits / serial-parity / serial-flowctl / serial-reset-preset / serial-reconnect-hint) + wireSerial opts.serialConfigEls pass-through"
  - "Playwright transport suite grows 9 → 14 passing: 5 previously-fixme config tests cover baud default, preset-default quartet, reset-button snap, connected-mutation hint, connect-honors-form-values (via mock _config introspection)"
affects:
  - "05-web-serial-transport Wave 4 (plan 05) — auto-reconnect + localStorage persistence — can reuse the readFormConfig() path on the silent retry 500ms later; the hint behavior is already wave-4-safe"
  - "05-web-serial-transport Wave 5 (plan 06) — paste-pump baud-aware timing — will compute its chunk gap from readFormConfig().baudRate rather than PRESET_CONFIG.baudRate"
  - "Phase 6 PREF-01 — full serial-config persistence — the readFormConfig/snapPreset API is the natural hook; PREF-01 just adds localStorage round-trip around the form values at boot/change"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "readFormConfig() / snapPreset() — form-as-source-of-truth pattern; the DOM <select>s hold the authoritative config and serial.js reads on demand (no mirrored in-memory config state to drift out of sync)"
    - "Reconnect-required hint as passive amber <span> (no disabled selects, no blocking modal) — mutation while connected is allowed but flagged; the hint is the entire feedback surface; user retains agency to disconnect+reconnect on their own cadence"
    - "parseInt(…, 10) || fallback defensive coercion for form reads — T-05-04-01 mitigation against DevTools-manipulated invalid option values; native <select>s only offer the fixed option set so fallbacks are defense-in-depth"
    - "hideReconnectHint() at the tail of successful connectMicroBeast — when a fresh open reconciles the form with the live port, any pending hint is automatically cleared without a dedicated observer subscription; same principle as snapPreset's hint-clear"

key-files:
  created:
    - .planning/phases/05-web-serial-transport/05-04-SUMMARY.md
  modified:
    - www/transport/serial.js
    - www/index.html
    - www/main.js
    - www/tests/transport/config.spec.js

key-decisions:
  - "Source of truth is the DOM form, not a mirrored in-memory config object — readFormConfig() parses on every connect; simpler than dual-write + drift detection, and aligns with Phase 6 PREF-01's future localStorage round-trip pattern (read-from-DOM on use, write-to-DOM on boot)"
  - "hideReconnectHint() at the END of successful connectMicroBeast (after runReadLoop is fired) — not at setState('connected') — because lastConfig is assigned before setState, and the hint's 'differs' check compares readFormConfig() to lastConfig; clearing at the success tail is the latest valid point where the form and live port are guaranteed to match"
  - "UI-SPEC line 554 hint string 'Config changed — Disconnect and Connect to apply' pinned via grep (count = 1 in serial.js) — initial attempt quoted the text in a comment; collapsed the comment to a paraphrase ('reconnect-required hint; string literal below is verbatim') so the single code occurrence stays the only authoritative source of the copy. Matches the Plan 05-03 TextDecoder-comment-hygiene precedent."
  - "Test 4 (connected-mutation hint) uses await expect(hint).toBeVisible() + toHaveText(...) rather than peeking at the internal showReconnectHint call count — contract-based verification, not implementation-coupled; Wave 4's reconnect-required-during-reconnecting variant will be a straightforward extension of the same assertion shape"
  - "Change listeners attached to all 5 selects (not just baud) even though Test 4 only exercises baud — the hint contract says 'changing a select while connected' which must apply to every knob; the loop over [baud, dataBits, stopBits, parity, flowCtl] attaches identical handlers; tests 1/2/3/5 cover the non-baud selects indirectly via the preset-restore and connect-honors-values paths"

requirements-completed: [XPORT-05]

# Metrics
duration: 5min
completed: 2026-04-23
---

# Phase 5 Plan 04: Wave 3 — Serial-Config Form Wiring Summary

**Connection pane form controls now drive `port.open(config)` directly — baud / data bits / stop bits / parity / flow control, all read from the DOM on every Connect, snappable back to MicroBeast preset (19200 / 8 / 1 / none / none) via a single button, with an amber "Config changed — Disconnect and Connect to apply" hint when the user mutates a select mid-session.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-23T01:18:57Z
- **Completed:** 2026-04-23T01:24:00Z
- **Tasks:** 3 (no checkpoints; fully autonomous)
- **Files modified:** 4 (1 SUMMARY created, 4 modified)
- **Commits:** 3 feat/test commits + this docs commit

## Accomplishments

### Task 1 — `www/transport/serial.js` form-config wiring (commit `6b93049`)

- Added module-scope `serialEls` slot (destructured via `serialConfigEls` in `wireSerial` opts). Refs shape: `{ baud, dataBits, stopBits, parity, flowCtl, resetBtn, reconnectHintEl }`.
- **`readFormConfig()`**: returns `{ baudRate, dataBits, stopBits, parity, flowControl }` parsed from the 5 selects. `parseInt(…, 10) || fallback` (T-05-04-01 mitigation) + string literal fallbacks for parity/flowControl. Gracefully returns `PRESET_CONFIG` when `serialEls` is absent (e.g. boot before wireSerial, or tests that skip the pane).
- **`snapPreset()`**: snaps all 5 selects to `String(PRESET_CONFIG.baudRate)` / etc., plus `hideReconnectHint()` at the end (Reset = declared "use preset"; any pending hint is stale).
- **`showReconnectHint()` / `hideReconnectHint()`**: flip `serialEls.reconnectHintEl.hidden` and set verbatim UI-SPEC copy `'Config changed — Disconnect and Connect to apply'`. No-op when hint element is absent.
- **Change listeners** attached to all 5 selects inside `wireSerial`: on `change`, if `state === 'connected' && lastConfig` and any of the 5 fields differs, fire `showReconnectHint()`; otherwise `hideReconnectHint()` (self-clearing if the user flips back to the live config).
- **Reset button wiring**: `click` → `snapPreset()`; `mousedown preventDefault` for focus retention (UI-SPEC line 576).
- **`connectMicroBeast`**: `const config = configOverride || PRESET_CONFIG` → `const config = configOverride || readFormConfig()`. The only logic change in connectMicroBeast — the rest of the Wave 2 body (requestPort / open / setSignals / register writer / runReadLoop) stays verbatim.
- **Tail clear**: `hideReconnectHint()` at the end of the success path (after `runReadLoop(selectedPort)` is fired). Whenever a fresh open reconciles the form with the live port, any pending hint disappears automatically.

### Task 2 — `www/index.html` + `www/main.js` DOM refs (commit `e86dff7`)

- **index.html**: inserted `<span id="serial-reconnect-hint" class="hint" hidden></span>` between `</fieldset>` and the `<button id="serial-reset-preset">`. CSS block added after the `#connection .hint` rule — `display: block; color: #e0b030; font-size: 12px; margin: 4px 0;` plus `[hidden] { display: none; }` so the span collapses to zero visual space when inactive. Amber (#e0b030) matches the connecting/reconnecting border signal — "action required, not an error".
- **main.js**: 7 new refs — `serialBaud`, `serialDataBits`, `serialStopBits`, `serialParity`, `serialFlowCtl`, `serialReset`, `serialReconnectHint`.
- **main.js**: `wireSerial({ … })` opts block extended with `serialConfigEls: { baud, dataBits, stopBits, parity, flowCtl, resetBtn, reconnectHintEl }` (keys match the destructure in `wireSerial`).
- All 7 IDs already existed in index.html from Plan 02 Wave 1; this task just bridges them into the serial.js module.

### Task 3 — 5 un-fixme'd `config.spec.js` tests (commit `a38bfd2`)

- **Test 1** — `baud select defaults to 19200` — simple `toHaveValue('19200')` assertion after `setup(page)` opens the pane.
- **Test 2** — `databits/stopbits/parity/flowctl defaults match MicroBeast preset` — 4 `toHaveValue` assertions in one test against `8 / 1 / none / none`.
- **Test 3** — `Reset to MicroBeast preset button snaps all five selects to defaults` — moves all 5 selects away from preset (`9600 / 7 / 2 / even / hardware`), clicks `#serial-reset-preset`, asserts all 5 snapped back. Exercises `snapPreset()` end-to-end.
- **Test 4** — `changing baud while connected shows Config changed hint` — clicks Connect, waits for `data-state="connected"`, asserts hint is hidden, mutates baud to 9600, asserts hint visible AND has verbatim text `'Config changed — Disconnect and Connect to apply'`. Exercises the change-listener branch.
- **Test 5** — `connect honors non-default config values` — changes baud to 9600 AND parity to even BEFORE clicking Connect, then introspects `navigator.serial._grantedPorts[0]._config` (mock records last config passed to `open()`) and asserts the 5 fields match `{9600, 8, 1, 'even', 'none'}`. Confirms `readFormConfig()` actually flows into `port.open(config)`.

## Task Commits

Each task was committed atomically:

1. **Task 1: readFormConfig + snapPreset + reconnect-required hint wiring in serial.js** — `6b93049` (feat)
2. **Task 2: serial-reconnect-hint span + serialConfigEls DOM refs** — `e86dff7` (feat)
3. **Task 3: un-fixme 5 config.spec.js tests for XPORT-05 + D-08** — `a38bfd2` (test)

**Plan metadata:** to be attached in the final docs commit below.

## Files Created/Modified

- `www/transport/serial.js` — +79 / -1 lines. Form-config wiring (readFormConfig/snapPreset/hint helpers/change listeners); configOverride fallback now reads from DOM.
- `www/index.html` — +11 / -0 lines. `<span id="serial-reconnect-hint">` + amber CSS rule + `[hidden]` collapse.
- `www/main.js` — +18 / -0 lines. 7 new getElementById refs + serialConfigEls opt on wireSerial.
- `www/tests/transport/config.spec.js` — +40 / -9 lines. 5 test.fixme → real tests.
- `.planning/phases/05-web-serial-transport/05-04-SUMMARY.md` — NEW (this file).

## Decisions Made

- **Form-as-source-of-truth:** `readFormConfig()` parses DOM on every connect rather than maintaining a shadow in-memory config that the change listeners would sync. Simpler, no dual-write drift risk, and Phase 6 PREF-01's localStorage round-trip will seed the form once at boot and read from it thereafter — same pattern.
- **Tail clear in connectMicroBeast (not setState):** the "hint should disappear after reconcile" semantics depend on `lastConfig` being assigned before the check; placing `hideReconnectHint()` at the success-path tail (after `runReadLoop(selectedPort)` is fired) guarantees the form and the live port match at hint-clear time. Clearing at `setState('connected')` would run before `lastConfig = config` and miss the mid-transition window where `readFormConfig() !== lastConfig` briefly.
- **Amber CSS literal (#e0b030), not var(--phosphor-fg):** matches the connecting/reconnecting Connect-button border; the hint and the border are both "action required" surfaces, so a shared literal amber reads as one semantic. Not phosphor-themed — the hint is chrome, not glyph content.
- **Change listeners on ALL 5 selects (not just baud):** contract says "changing a select while connected"; the single-test-exercises-baud pattern is a spec-level choice (baud is load-bearing — telecom `19200 8N1`), but the code path must cover every knob or a user mutating parity-while-connected would silently miss the hint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `Config changed — Disconnect and Connect to apply` grep-count hygiene**
- **Found during:** Task 1 `<done>` verification.
- **Issue:** Initial draft of `showReconnectHint` had the UI-SPEC copy in BOTH a comment ("UI-SPEC line 554 — \"Config changed — Disconnect and Connect to apply\".") AND the code (`serialEls.reconnectHintEl.textContent = 'Config changed …'`). Plan's done-criterion requires grep-count = 1 for this exact string; the duplicate in the comment made count = 2.
- **Root cause:** Same pattern as Plan 05-03's TextDecoder-comment-hygiene issue — quoting load-bearing strings in comments breaks grep-anchored done-criteria.
- **Fix:** Rewrote the comment to paraphrase without literal quoting — `// UI-SPEC line 554 — reconnect-required hint (string literal below is verbatim).` Semantic fidelity preserved; grep hygiene restored (count = 1, only the code occurrence).
- **Files modified:** `www/transport/serial.js`
- **Commit:** `6b93049` (bundled with Task 1's main wiring — same logical unit).

---

**Total deviations:** 1 auto-fixed (1 Rule 1 hygiene bug, same shape as Plan 05-03's TextDecoder comment — a known recurring pattern across phase 5 where grep-anchored done-criteria and human-readable comments can collide)

**Impact on plan:** Zero scope creep. No architectural changes. Hygiene fix only.

## Issues Encountered

- **Pre-existing flake on `www/tests/render/phosphor.spec.js`** observed on one of the full-suite runs during Task 1 verification. Stashing my changes and re-running the phosphor spec alone showed 4/4 passing — confirming it's a pre-existing parallel-test-runner flake, NOT caused by my changes. The same spec passed 4/4 on the post-Task-2 and post-Task-3 full-suite runs. Flaky behavior is out of scope per the executor's Scope Boundary rule and left alone; if it becomes persistent, Phase 6 polish should chase it down.

## Verification Evidence

### Task 1 done criteria — all pass
```
$ grep -c '^function readFormConfig'               www/transport/serial.js   # 1
$ grep -c '^function snapPreset'                   www/transport/serial.js   # 1
$ grep -c 'showReconnectHint'                      www/transport/serial.js   # 2  (>= 2)
$ grep -c 'hideReconnectHint'                      www/transport/serial.js   # 4  (>= 2)
$ grep -c 'Config changed — Disconnect and Connect to apply' www/transport/serial.js  # 1
$ grep -c 'configOverride || readFormConfig()'     www/transport/serial.js   # 1
```

### Task 2 done criteria — all pass
```
$ grep -c 'id="serial-reconnect-hint"'  www/index.html   # 1
$ grep -c '#serial-reconnect-hint'      www/index.html   # 2  (>= 2 CSS selectors)
$ grep -c "getElementById('serial-baud')"            www/main.js   # 1
$ grep -c "getElementById('serial-databits')"        www/main.js   # 1
$ grep -c "getElementById('serial-stopbits')"        www/main.js   # 1
$ grep -c "getElementById('serial-parity')"          www/main.js   # 1
$ grep -c "getElementById('serial-flowctl')"         www/main.js   # 1
$ grep -c "getElementById('serial-reset-preset')"    www/main.js   # 1
$ grep -c "getElementById('serial-reconnect-hint')"  www/main.js   # 1
$ grep -c 'serialConfigEls: {'                        www/main.js   # 1
```

### Task 3 done criteria — all pass
```
$ grep -c 'test.fixme' www/tests/transport/config.spec.js    # 0
$ grep -c "test('"     www/tests/transport/config.spec.js    # 5
```

### Playwright suite
```
$ cd www && npx playwright test tests/transport/config.spec.js
  5 passed             # was 5 fixme

$ cd www && npx playwright test tests/transport
  14 passed, 24 skipped # 6 connect + 2 readloop + 1 reconnect + 5 config = 14

$ cd www && npx playwright test                    # full suite
  77 passed, 24 skipped, 0 failed     (was 72 + 29 fixme before this plan)
```

## Threat Flags

No new threat surface beyond the plan's `<threat_model>`. All 3 STRIDE mitigations in the register map to code artifacts in this wave:

| Threat ID | Disposition | Mitigation code site |
|-----------|-------------|---------------------|
| T-05-04-01 (Tampering — malformed <select> values via DevTools) | mitigate | `readFormConfig()` uses `parseInt(…, 10) || fallback` (serial.js:163-170); native <select>s only offer the fixed option set; DevTools-manipulated invalid strings fall through to the preset default |
| T-05-04-02 (Elevation — unrelated device at 300 baud) | accept | VID/PID filter from Plan 05-03 (requestPort `filters: [{usbVendorId:0x10c4, usbProductId:0xea60}]`) unchanged; baud/config changes only affect the already-granted MicroBeast port, no cross-device leak |
| T-05-04-03 (Info Disclosure — hint text leaks device info) | accept | Hint text is a compile-time literal (`'Config changed — Disconnect and Connect to apply'`); the config values shown in the UI are user-entered; no device secrets in the surface |

## Known Stubs

None introduced by this wave. Wave 2's stubs (`persistVidPid` body, `appendErrorLog` naive-replace, Wave-4 reconnect path) remain as documented in the Plan 05-03 SUMMARY.

## Next Phase Readiness

- Wave 4 (Plan 05) — auto-reconnect + localStorage persistence — can reuse `readFormConfig()` on the silent 500ms retry path (D-04). The hint-clear-on-connect-success semantics are already reconnect-safe.
- Wave 5 (Plan 06) — paste-pump — will compute its chunk gap from `readFormConfig().baudRate` rather than `PRESET_CONFIG.baudRate` once the pump lands. Until then, Wave 3's changes are a pure feature-add with zero coupling to the pump.
- Phase 6 PREF-01 — full serial-config persistence — the `readFormConfig`/`snapPreset` API is the natural hook. PREF-01 adds a localStorage round-trip at boot (seed the form) and change (write the form values); no signature change to serial.js needed.

## Self-Check: PASSED

Verified artifacts:
- `www/transport/serial.js` — FOUND (348 lines — was 294, +54 net). All 6 Task 1 done-criteria grep checks pass.
- `www/index.html` — FOUND (1 new span, 1 new CSS rule block + [hidden] override; both Task 2 grep checks pass).
- `www/main.js` — FOUND (7 new DOM refs + serialConfigEls opt; all 10 Task 2 grep checks pass).
- `www/tests/transport/config.spec.js` — FOUND (5 runnable tests + 0 fixme; both Task 3 grep checks pass).
- `.planning/phases/05-web-serial-transport/05-04-SUMMARY.md` — FOUND (this file).

Verified commits:
- `6b93049` — FOUND (Task 1 serial.js form wiring).
- `e86dff7` — FOUND (Task 2 index.html + main.js DOM refs).
- `a38bfd2` — FOUND (Task 3 un-fixme'd config.spec.js).

Full Playwright suite: `77 passed, 24 skipped, 0 failed`. Transport suite: `14 passed, 24 skipped`.

---

*Phase 05-web-serial-transport, Plan 04 (Wave 3).*
*Completed 2026-04-23. Wave 4 Plan 05 picks up with auto-reconnect + localStorage VID/PID persistence.*
