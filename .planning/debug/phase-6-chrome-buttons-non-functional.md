---
status: diagnosed
trigger: "FAIL: connect button doesn't work, Clear, Clean, Green, Amber, White buttons do not work"
created: 2026-04-25T00:00:00Z
updated: 2026-04-25T17:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "Phase 6 Plan 06-06 added an `applyPrefs(p)` subscriber that races against in-flight user-driven mutations. When `applyPrefs` runs after the 250 ms debounced `flushPrefs`, it overwrites form-control DOM (`.value` / `.checked`) with the previously-cached prefs blob — which may be stale if the user changed state via a code path that bypasses the `change` listener (the `serial-reset-preset` button in serial.js's `snapPreset()` is the proven instance: it sets DOM .value directly without calling `savePrefs`, so the 250 ms-deferred `applyPrefs` reverts it). The race is wide enough to flake at least 3 Playwright tests (config Reset preset, focus-retention phosphor, zoom preserves content). It is plausibly the same root pattern the user reports — a fast-clicking user sees a button-state revert mid-interaction and reads it as 'doesn't work'."
  confirming_evidence:
    - "Failing test: tests/transport/config.spec.js:32 'Reset to MicroBeast preset' — under full-suite parallel run, the Playwright trace shows ALL FIVE form selects revert from preset values (19200/8/1/none/none) back to the user-mutated values (9600/7/2/even/hardware) within ~250 ms of clicking Reset."
    - "Trace confirms snapPreset DOES set the values (the page renders them briefly per the timing of the awaits) but applyPrefs from the prior selectOption-driven savePrefs flush re-applies the cached.serial blob over them. snapPreset never calls savePrefs to update cached, so cached.serial still holds the stale form values."
    - "Other intermittent failures correlated with applyPrefs side effects: tests/render/zoom.spec.js#glyphs painted at 1× still painted after zoom (zoom delta racing setZoom from applyPrefs), tests/input/focus-retention.spec.js#phosphor (savePrefs side effect of click leaving aria-pressed in race window)."
    - "Phase 6 Plan 06-06 commit 4b71af5 introduced both `prefs.js` and the `applyPrefs` subscriber; pre-Phase-6 code did not have this race surface (Phase 5's bestialitty.port.preset uses no subscriber pattern)."
    - "snapPreset() at www/transport/serial.js:302-310 directly mutates serialEls.* .value with no call to savePrefs — proven gap."
  falsification_test: "Add a console.log inside applyPrefs that fires on every call, run the failing config.spec.js test under full suite, observe whether applyPrefs runs between snapPreset and the failing assertion. If applyPrefs DOES NOT run in that window, the hypothesis is wrong and the bug is elsewhere (e.g. a different async write to .value)."
  fix_rationale: "Two complementary fixes: (a) snapPreset() must call savePrefs({ serial: PRESET_SERIAL_BLOB }) so the cached blob also resets — closing the race for the reset-preset path. (b) applyPrefs MUST be defensive about not overwriting DOM values that already match — but this is a band-aid; the clean fix is (a). For the broader safety net: applyPrefs should only run on EXTERNAL changes (resetPrefs, version migration), NOT on every flushPrefs — the user's own flushPrefs originates from their own changes that already updated the DOM, so re-applying is redundant at best and racy at worst."
  blind_spots: "I have NOT been able to reproduce the exact user-reported 'buttons unresponsive' symptom under any Playwright configuration. The closest I get is the form-revert race. The user's symptom may be a different bug (CSP picker blocked? wireSerial hang?) that I have not isolated. I am proposing fixes for the proven race; if these do not resolve the user's symptom, further investigation is needed in the user's actual browser environment (DevTools console messages, screen recording of click attempts)."

## Symptoms

expected: Clicking top-bar Connect, Clear, Clean/CRT toggle, and Green/Amber/White phosphor radio buttons fires their click handlers (open serial port, clear screen, switch theme, switch phosphor color).
actual: All five top-bar buttons unresponsive in real Chromium after Phase 6. No audible/visible response. User reports no console error.
errors: (none reported by user — but Playwright tests pass under simulated synthetic .click() AND under real page.click(), so the visible failure mode is environment-specific)
reproduction:
  1. Open the BestialiTTY web app in real Chromium after Phase 6 build
  2. Click any top-bar button (Connect, Clear, Clean, Green, Amber, White)
  3. Observe: nothing happens
started: After Phase 6 execution. Phase 5 end was working (41 transport tests including reconnect.spec.js passed).

## Eliminated

- hypothesis: CSP meta-tag blocks inline event handlers OR external script execution (orchestrator scope_hint #1)
  evidence: Playwright honors CSP and the buttons still fire under page.click() with the same meta-tag CSP active. Console shows only the benign 'frame-ancestors ignored when delivered via meta' warning.
  timestamp: 2026-04-25T01:00:00Z

- hypothesis: Boot reorder regression — applyPrefs throws on partial serial blob (orchestrator scope_hint #2)
  evidence: Six stale-localStorage permutations tested (corrupt JSON, missing version, future version, autoConnect=true with no port, autoConnect with string baud, etc) — boot completes cleanly in all cases; theme-toggle works. applyPrefs is fully defensive against partial / corrupt blobs because loadPrefs() merges defaults into any partial.
  timestamp: 2026-04-25T01:00:00Z

- hypothesis: Polite-fail false-positive (orchestrator scope_hint #3)
  evidence: Real Chromium under Playwright reports `typeof navigator.serial !== 'undefined'`; body.classList does NOT contain 'polite-fail'; the polite-fail page never renders.
  timestamp: 2026-04-25T01:00:00Z

- hypothesis: wireSelection's pointerdown handler swallows clicks on top-bar buttons
  evidence: wireSelection attaches pointerdown to the canvas only (www/input/selection.js:55), not to document/window. Top-bar buttons are siblings of the canvas — their pointer events do not reach selection.js.
  timestamp: 2026-04-25T01:00:00Z

- hypothesis: terminal-wrapper overlays the top-bar in some viewports
  evidence: Tested 4 viewports (1366x768, 1920x1080, 800x600, 600x400). Top-bar has z-index:10, sticky, terminal-wrapper has z-index:auto. document.elementFromPoint at center of every top-bar button returns the button itself in all viewports.
  timestamp: 2026-04-25T01:00:00Z

## Evidence

- timestamp: 2026-04-25T01:00:00Z
  checked: Playwright diagnostic spec running synthetic .click() then real page.click() on each top-bar button against the live www/ source.
  found: All five top-bar buttons fire their click handlers under both Element.click() and page.click(). Theme toggle: data-theme flips crt→clean and label flips Clean→CRT. Phosphor amber/white/green: aria-pressed flips. Clear button: no error. Connect button: state stays 'disconnected' (Playwright has no real port — expected; the click handler fires per inspection).
  implication: JS-side listeners ARE registered. CSP meta tag does NOT block click handlers. Boot completes cleanly under Playwright (window.__term, __prefs, __scrollState, __selection, __sessionLog all defined). The user-reported failure is NOT a blanket "click handlers don't fire" — something more subtle is happening.

- timestamp: 2026-04-25T01:30:00Z
  checked: Full Playwright suite run 5 times (with retries=0 and retries=3)
  found: 1-3 tests flake intermittently. Affected specs: tests/transport/config.spec.js#Reset preset (most reliable to flake), tests/render/zoom.spec.js#zoom-preserves-content, tests/input/focus-retention.spec.js#phosphor, tests/render/phosphor.spec.js#--phosphor-fg matches palette. With retries=3, all flakes recover.
  implication: There is a real race condition affecting Phase 6 in the test suite. The pattern "click button, see expected DOM state, then DOM state reverts within ~250 ms" matches a debounce-flush race.

- timestamp: 2026-04-25T01:30:00Z
  checked: Playwright trace of the failing config.spec.js#Reset preset test
  found: At the moment of test failure, the page snapshot shows ALL FIVE serial-config selects at the user-mutated values (9600 / 7 / 2 / even / hardware) — the values the test set BEFORE clicking Reset. The Reset button DID fire (the click event reached the handler) but the DOM .value was REVERTED back to the pre-reset values within ~250 ms.
  implication: snapPreset() in www/transport/serial.js:302-310 sets serialEls.*.value directly but does NOT call savePrefs to update the cached prefs. The 250 ms debounced applyPrefs flush from the prior selectOption-driven savePrefs writes the cached.serial values BACK over the snapPreset reset, undoing it.

- timestamp: 2026-04-25T01:30:00Z
  checked: www/transport/serial.js snapPreset() vs www/state/prefs.js savePrefs() interaction
  found: The serial form change listener (serial.js:251-257) calls savePrefs({ serial: { ... } }) on every change event. snapPreset() does not. main.js applyPrefs (main.js:558-594) is registered as a subscriber via prefsSubscribe; it fires after every flushPrefs and calls serialBaud.value = String(p.serial.baud) etc. (main.js:587-593).
  implication: The race window is approximately 250 ms (the savePrefs debounce). Any user action that mutates the form via .value-only (snapPreset or any future similar caller) without calling savePrefs is vulnerable.

- timestamp: 2026-04-25T01:30:00Z
  checked: Phase 6 commit history for the introduction of this race
  found: Commit 4b71af5 "feat(06-06): prefs.js + boot reorder + Settings rows for PREF-01/PREF-02" introduced both prefs.js and the applyPrefs subscriber pattern. snapPreset() existed pre-Phase-6 (Phase 5 D-08, commit e86dff7) but pre-Phase-6 there was no applyPrefs subscriber to revert its work.
  implication: Phase 6 Plan 06-06 introduced a regression of the previously-working snapPreset() behavior.

## Resolution

root_cause: |
  Phase 6 Plan 06-06 (commit 4b71af5) introduced a `prefs.js` subscriber pattern in main.js — `applyPrefs(p)` is registered with `prefsSubscribe()` and fires after every 250 ms-debounced flush of `savePrefs`. `applyPrefs` mutates DOM form controls (.value on serial-config selects, .checked on local-echo / CR-LF radios / auto-connect, aria-pressed on phosphor buttons) by reading from the cached prefs blob.

  At the same time, Phase 5's pre-existing `snapPreset()` in www/transport/serial.js:302-310 directly mutates `serialEls.*.value` to the MicroBeast preset (19200 / 8 / 1 / none / none) without calling `savePrefs`. Because the cached prefs blob still holds whatever the user previously selected (because the change-event listener at serial.js:251-257 saved it just before they clicked Reset), the 250 ms-deferred applyPrefs flush re-applies the stale cached values back over snapPreset's reset, undoing it.

  This is reproducible in tests/transport/config.spec.js:32 'Reset to MicroBeast preset' — it flakes whenever the assertion runs ~250 ms after the selectOption-driven savePrefs schedules its flush. The Playwright trace at the failure moment shows all five selects at the pre-reset values, confirming the revert.

  Two correlated test flakes (focus-retention.spec.js#phosphor, zoom.spec.js#zoom-preserves-content) point to the same race surface — applyPrefs runs while a test is mid-interaction and overwrites the user's expected state.

  The user's reported "buttons unresponsive" symptom is a plausible — but not directly reproduced — manifestation: a fast-clicking user could see their clicks have transient visible effect that immediately reverts, reading it as "the button does not work." However, I was UNABLE to reproduce the exact "click does nothing" symptom under any Playwright configuration; the fix below addresses the proven race and is the most likely cause; if it does not resolve the user's symptom, additional in-browser DevTools investigation is needed.

fix: |
  Two-part fix (file + line + change):

  (1) FILE: www/transport/serial.js, function snapPreset() at line 302-310.
      AFTER setting serialEls.*.value, ALSO call savePrefsFn to sync cached prefs:

      ```js
      function snapPreset() {
          if (!serialEls || !serialEls.baud) return;
          serialEls.baud.value     = String(PRESET_CONFIG.baudRate);
          serialEls.dataBits.value = String(PRESET_CONFIG.dataBits);
          serialEls.stopBits.value = String(PRESET_CONFIG.stopBits);
          serialEls.parity.value   = PRESET_CONFIG.parity;
          serialEls.flowCtl.value  = PRESET_CONFIG.flowControl;
          // Phase 6 Plan 06-06 fix — applyPrefs subscriber races against direct
          // .value mutations. Sync the cached prefs blob so the next flushPrefs
          // does not revert this reset.
          if (savePrefsFn) {
              savePrefsFn({ serial: {
                  baud: PRESET_CONFIG.baudRate,
                  dataBits: PRESET_CONFIG.dataBits,
                  stopBits: PRESET_CONFIG.stopBits,
                  parity: PRESET_CONFIG.parity,
                  flowControl: PRESET_CONFIG.flowControl,
              } });
          }
          hideReconnectHint();
      }
      ```

  (2) FILE: www/main.js, function applyPrefs() at line 558-594.
      Defensive — applyPrefs should NOT touch form .value / .checked when the value already matches the DOM state. Even better, applyPrefs's PURPOSE is to react to EXTERNAL changes (resetPrefs() called from Settings UI, or version-migration on load) — not to re-confirm the user's own debounced changes.

      Reference fix — split applyPrefs into two paths:

      ```js
      // Boot path — apply prefs to canvas/keyboard state ONLY (no DOM form sync;
      // the DOM is already at HTML defaults which match the loaded prefs by contract).
      function applyPrefsToCanvas(p) {
          setTheme(p.theme);
          setPhosphor(p.phosphor);
          setZoom(p.fontZoom);
          setLocalEcho(p.localEcho);
          setCrlfMode(p.crlfMode);
      }

      // Reset path — also sync DOM form controls (used ONLY by resetPrefs()).
      function applyPrefsToDom(p) {
          applyPrefsToCanvas(p);
          document.body.setAttribute('data-theme', p.theme);
          themeButton.textContent = (p.theme === 'crt') ? 'Clean' : 'CRT';
          phosphorGroup.hidden = (p.theme !== 'crt');
          for (const btn of phosphorButtons) {
              btn.setAttribute('aria-pressed', btn.dataset.phosphor === p.phosphor ? 'true' : 'false');
          }
          if (localEchoCheckbox.checked !== p.localEcho) localEchoCheckbox.checked = p.localEcho;
          for (const radio of crlfRadios) radio.checked = (radio.value === p.crlfMode);
          const autoConnectCheckbox = document.getElementById('auto-connect-checkbox');
          if (autoConnectCheckbox) autoConnectCheckbox.checked = !!p.autoConnect;
          if (p.serial) {
              if (serialBaud)     serialBaud.value     = String(p.serial.baud);
              if (serialDataBits) serialDataBits.value = String(p.serial.dataBits);
              if (serialStopBits) serialStopBits.value = String(p.serial.stopBits);
              if (serialParity)   serialParity.value   = p.serial.parity;
              if (serialFlowCtl)  serialFlowCtl.value  = p.serial.flowControl;
          }
      }

      // Boot — apply once.
      applyPrefsToDom(prefs);

      // Subscribe — but ONLY for resetPrefs() path. flushPrefs after a normal
      // savePrefs is no-op DOM-wise (DOM was already updated by the user action
      // that triggered savePrefs); subscribing applyPrefsToDom would re-apply
      // and race. Instead, prefs.js needs a separate notify channel for
      // resetPrefs vs. flushPrefs, OR we accept that flushPrefs is silent
      // and only resetPrefs() triggers the DOM re-apply.
      ```

      A simpler alternative: change prefs.js to NOT fire subscribers on flushPrefs (the .checked/.value DOM has already been updated by the user click). ONLY fire subscribers on resetPrefs(). This eliminates the race entirely and keeps applyPrefs as a "reset to defaults" path.

      Recommended minimal fix: change www/state/prefs.js:flushPrefs to NOT iterate subscribers, AND keep resetPrefs() as the only subscriber-firing path. Then the in-flight save never reverts user-driven DOM mutations.

verification: |
  Verification plan:
  1. Apply fix (1) — snapPreset calls savePrefsFn — and re-run tests/transport/config.spec.js#Reset preset 10× under full-suite parallelism. Should pass 10/10 (was failing 1-3 in 5 in pre-fix runs).
  2. Apply fix (2) — restrict applyPrefs to only fire from resetPrefs() — and re-run the full suite 10× under retries=0. The flake count should drop to 0.
  3. Manual UAT 1 retest: real Chromium, real MicroBeast, click Connect — port picker appears, port opens, prefs persist. Click Clean — theme switches AND stays switched. Click Amber — phosphor switches AND stays. Click Green — phosphor stays Green. Click Reset preset (in Connection pane) — selects snap to defaults AND stay there.

files_changed:
  - www/transport/serial.js (snapPreset adds savePrefsFn call)
  - www/state/prefs.js (flushPrefs no longer fires subscribers; only resetPrefs does)
  - OR www/main.js (split applyPrefs into to-canvas and to-DOM paths)

specialist_hint: typescript
