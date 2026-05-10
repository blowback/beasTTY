---
status: resolved
trigger: "Phase 12 UAT Test 12 Gap C — user changed Settings auto-send command to 'B:OLDSLIDE r' (previously 'A:SLIDE r'), dragged a file WITHOUT a page reload, and CP/M echoed 'A:SLIDE?' on the wire instead of running OLDSLIDE. Post-reload (test 14), the new value DID reach the wire (Z80 ran B:OLDSLIDE.COM correctly, just no wakeup as expected for legacy slide). Suggests slide.js readAutoSendCommandBytes reads a stale boot-time prefs snapshot rather than calling getPrefs() live at use-time."
created: 2026-05-10T19:55:00Z
updated: 2026-05-10T20:30:00Z
---

## Current Focus

hypothesis: "CONFIRMED — slide.js holds a boot-time prefsRef captured in wireSlideDispatcher (line 306: `prefsRef = prefs || null`). Multiple call sites read prefsRef.slideAutoSendCommand / slideAutoSendCommandConfirmed / slideCompatibilityMode directly. savePrefs() in www/state/prefs.js:103 reassigns `cached = { ...cached, ...partial }` — a NEW object reference — so the boot-time prefsRef now points at a stale object that no longer reflects user edits."

next_action: "Apply Plan 12-08's getPrefs()-live pattern to slide.js. Import getPrefs from ../state/prefs.js. Replace every `prefsRef.X` field read with `getPrefs() && getPrefs().X` (with null-guard). The boot-time prefsRef capture can be removed entirely since main.js's window.__prefs.live mutation (used by some tests) was a workaround for this same bug. Or, retained for null-coalescing fall-through to the default branches that already exist for older harnesses."

## Symptoms

expected: "When the user changes #slide-auto-send-input in Settings to a new SAFE value (e.g. 'B:OLDSLIDE r'), the next ↑ Send file (or drag-drop confirm) sends the NEW value to the Z80 over the wire — without requiring a page reload."

actual: "Test 12 (no reload between Settings change and send): Settings input held 'B:OLDSLIDE r' but CP/M echoed 'A:SLIDE?' (the previous value). Test 14 (post-reload): the new 'B:OLDSLIDE r' value DID reach the wire (Z80 ran legacy OLDSLIDE.COM successfully — note B:OLDSLIDE.COM is a real legacy slide.com without ESC^SLIDE wakeup per project memory project_b_oldslide_legacy.md, so the subsequent 'Waiting for z80…' pin is expected for Auto compatibility-mode against legacy slide, NOT a separate bug)."

errors: "[no console errors — silent stale-read defeat]"

reproduction: |
  1) Beastty boot from www/index.html in Chromium with a hard reload.
  2) Connect to MicroBeast.
  3) Settings → SLIDE → Auto-send command: change from default 'B:SLIDE R' to a new SAFE value (e.g. 'B:OLDSLIDE r' or 'A:SLIDE R'). Tab/click out so the change handler fires.
  4) WITHOUT reloading the page: drag a file onto the canvas. Click Confirm on first-use-confirm chip if it surfaces.
  5) Observe the Z80's response — CP/M echoes the OLD command, not the new one.
  6) Repeat with a hard reload between step 3 and step 4 — bug does NOT reproduce; new command reaches the wire.

started: "Surfaced 2026-05-10 during Phase 12 UAT re-run (test 12). Likely latent since Phase 11 (Plan 11-04 chip+prefs wiring) or Phase 12-03 (Plan 12-03 first-use confirm + use-time gate). Plan 12-08's serial.js getPrefs()-live retrofit established the canonical pattern that may not have been replicated to slide.js."

## Eliminated

- "Settings DOM hydration broken" — DOM input value DID reflect user change ('B:OLDSLIDE r' visible in Settings input post-edit per UAT report). Eliminated.
- "savePrefs not firing change handler" — debounced flush IS reaching localStorage (verified in slide-prefs.spec.js debounce test). Eliminated.
- "TextEncoder corruption mid-encode" — readAutoSendCommandBytes calls TextEncoder.encode on the cached `cmd` string; encoder is stateless. Stale string in, stale bytes out. Encoder not the cause. Eliminated.

## Evidence

- timestamp: 2026-05-10T19:55:00Z
  checked: ".planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-UAT.md (commit 2f5082b) Gaps section"
  found: "User report explicitly contrasts test 12 (no reload, OLD value sent) vs test 14 (post-reload, NEW value sent). Reload is the masking variable. Both tests dropped a real file (not a programmatic test fixture)."
  implication: "Boot-time prefs capture in the closure chain reaching readAutoSendCommandBytes is the high-probability cause. Plan 12-08's pattern in serial.js is the template fix."

- timestamp: 2026-05-10T19:55:00Z
  checked: ".planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-08-SUMMARY.md key-decisions + patterns-established"
  found: "Plan 12-08 explicitly establishes 'Live-read at use-time' as a pattern: any new pref affecting a connect-time/use-time decision MUST be read via getPrefs() at that moment, not via a boot-time prefsRef snapshot (Phase 11 WR-03 prefsRef-staleness lesson generalized). Plan 12-08 applied this to four call sites in serial.js. slide.js readAutoSendCommandBytes is a sibling use-time-decision call site that may not have received the same treatment."
  implication: "Existing within-project precedent for both the bug pattern AND the fix shape. Cross-reference target: how the four serial.js call sites read getPrefs() vs. how slide.js readAutoSendCommandBytes reads its prefs."

- timestamp: 2026-05-10T20:15:00Z
  checked: "www/transport/slide.js lines 129-145 (module state declarations) and line 306 (wireSlideDispatcher: `prefsRef = prefs || null`)"
  found: "prefsRef is module-scope let, assigned ONCE at boot from the opts.prefs argument. It captures the original loadPrefs() return reference."
  implication: "Smoking gun. Boot-time capture confirmed. No live re-read mechanism."

- timestamp: 2026-05-10T20:15:00Z
  checked: "www/state/prefs.js lines 102-106 (savePrefs)"
  found: "savePrefs(partial) executes `cached = { ...cached, ...partial }` — a fresh object literal assignment. Spread copies fields into a NEW object; module-level `cached` now references that new object. Any consumer holding the prior reference (slide.js's prefsRef) is now stale."
  implication: "The reassignment semantic is what makes a boot-time snapshot drift. main.js comment on lines 38-44 acknowledges this exact behaviour ('savePrefs() reassigns `cached` inside prefs.js to a new object'). The mitigation main.js exposes (window.__prefs.live for tests to mutate via Object.assign) only fixes Playwright, not the user's Settings change handler which calls plain savePrefs."

- timestamp: 2026-05-10T20:20:00Z
  checked: "www/transport/slide.js stale-read call sites (rg readAutoSendCommandBytes|prefsRef|getPrefs)"
  found: |
    Five separate prefsRef field reads, all stale-vulnerable:
      - line 219: `cmd = prefsRef.slideAutoSendCommand;` (readAutoSendCommandBytes)
      - line 266: `if (prefsRef.slideAutoSendCommandConfirmed === cmd) return false;` (shouldSurfaceFirstUseConfirm — first-use-confirm gate)
      - line 350: `const compatMode = (prefsRef && prefsRef.slideCompatibilityMode) || 'auto';` (handleChipInlineAction retry path)
      - lines 895-896: `const cmd = (prefsRef && prefsRef.slideAutoSendCommand !== undefined && prefsRef.slideAutoSendCommand !== null) ? prefsRef.slideAutoSendCommand : AUTO_SEND_DEFAULT;` (enterSendMode — the gate that decides if first-use-confirm should surface)
      - line 1023: `const compatMode = (prefsRef && prefsRef.slideCompatibilityMode) || 'auto';` (enterSendModeProceed — armTimer / force-start branching)
  implication: |
    Three pref fields are read stale: slideAutoSendCommand, slideAutoSendCommandConfirmed, slideCompatibilityMode.
    This DIRECTLY explains:
      • Gap C (test 12) — slideAutoSendCommand stale → old command on wire.
      • Gap B (test 8) — slideAutoSendCommandConfirmed stale → if a user changes the command (which sets Confirmed='' via the Settings change handler at main.js:610-613), prefsRef.slideAutoSendCommandConfirmed still holds the prior confirmed value, so shouldSurfaceFirstUseConfirm returns false (line 266 equality matches), skipping the chip.
      • Possibly slide-compatibility runtime change (window.__prefs.live mutation pattern in slide-compatibility.spec.js was a workaround) — production users editing the dropdown also hit a stale read on line 350/1023.
    Gap C and Gap B share the SAME root cause: stale prefsRef capture.

- timestamp: 2026-05-10T20:25:00Z
  checked: "www/transport/serial.js canonical fix pattern (lines 218, 390, 710, 729 — getPrefs()-live)"
  found: "serial.js imports getPrefs at line 27 and reads via `(getPrefs() && getPrefs().fieldName !== false) ? ...` inline at every use-time decision point (RTS gating). Plan 12-08-SUMMARY.md establishes this as the project-canonical pattern."
  implication: "Apply identical pattern to slide.js. Import getPrefs; replace each `prefsRef.X` read with `getPrefs() && getPrefs().X`. The boot-time prefsRef capture itself can either be removed (cleanest) or retained as a fallback for the prefs-omitted test harness path; the safer minimal change is to keep the prefsRef capture (preserving the no-prefs test fall-through to AUTO_SEND_DEFAULT) but consult getPrefs() FIRST on every read so live values always win."

## Resolution

root_cause: "slide.js captures a single `prefsRef` reference at wireSlideDispatcher boot time (line 306). When the user edits Settings → SLIDE → Auto-send command (or any slide pref), main.js's change handler calls savePrefs(), which in www/state/prefs.js:103 reassigns `cached = { ...cached, ...partial }` to a NEW object reference. slide.js's prefsRef still points at the original (stale) object. Five call sites — readAutoSendCommandBytes, shouldSurfaceFirstUseConfirm, handleChipInlineAction retry, enterSendMode first-use gate cmd-read, enterSendModeProceed compatMode read — therefore see boot-time values instead of the user's latest Settings edit. A page reload re-runs wireSlideDispatcher with the freshly-loaded prefs, masking the bug."

fix: "Imported getPrefs from ../state/prefs.js into www/transport/slide.js. Added a livePrefs() helper that returns getPrefs() || prefsRef || null (live read first, boot-time snapshot as fallback for test harnesses that wire opts.prefs without going through loadPrefs(), null for the no-prefs default-branch path). Replaced all 5 stale prefsRef.X reads with livePrefs()-driven reads at: readAutoSendCommandBytes (line ~219), shouldSurfaceFirstUseConfirm (line ~266), handleChipInlineAction retry path (line ~350), enterSendMode first-use gate (lines ~895-897), enterSendModeProceed compatMode (line ~1023). Mirrors the canonical Plan 12-08 pattern in serial.js."

verification: |
  - All 5 sites confirmed via `rg 'prefsRef\.' www/transport/slide.js` — only comment-block references remain (lines 70 + 223), no code reads.
  - Existing 36 SLIDE-related Playwright tests pass on first run at --workers=1 (slide-prefs + slide-autosend-safety + slide-compatibility).
  - Two NEW regression tests added to slide-autosend-safety.spec.js pinning the savePrefs() live-read contract:
    1. Gap C — savePrefs(slideAutoSendCommand) updates wire bytes without page reload (asserts mock writer receives the NEW command bytes, not the boot-time default).
    2. Gap B — savePrefs(slideAutoSendCommandConfirmed) re-arms first-use-confirm chip without reload (asserts chip lifecycle enters first-use-confirm + no auto-type bytes on wire yet).
  - Full SLIDE suite (slide-prefs + slide-autosend-safety + slide-compatibility + slide-sender + slide-collisions): 51/51 pass at --workers=1.
  - npm run test:fast at --workers=1: 81/81 pass.
  - Phase 12 zero-Rust invariant preserved: no Rust files touched.

files_changed:
  - www/transport/slide.js (5 stale prefsRef reads → livePrefs() reads + getPrefs import + livePrefs helper + 7-line comment block)
  - www/tests/transport/slide-autosend-safety.spec.js (2 new regression tests appended in a Phase 12 UAT Gap C/B section)

## Related

- gap-A (test 7): validation-hint sub-row never paints — separate diagnosis target. Not addressed by this fix.
- gap-B (test 8): first-use-confirm chip skipped — SHARES ROOT CAUSE with Gap C. The same getPrefs()-live retrofit fixes both because shouldSurfaceFirstUseConfirm reads prefsRef.slideAutoSendCommandConfirmed (line 266) which is equally stale.
- gap-D (test 12): [Cancel] no-op on active-state chip after force-start — separate diagnosis target. Not addressed by this fix.
