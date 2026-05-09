---
status: diagnosed
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-VERIFICATION.md]
started: 2026-05-09T00:00:00Z
updated: 2026-05-09T02:00:00Z
---

## Current Test

[testing paused — 3 hardware items blocked, 1 blocker-severity issue captured]

## Tests

### 1. Re-run UAT Test 5 — modal default-focus visible border (post Plan 12-06)
expected: After a pointer-initiated drop opens the send modal, the [Send N renamed] default-focus button paints a visible green focus border (border-color = --chrome-accent computed value) — Chromium suppresses :focus-visible on programmatic .focus() following pointer-initiated interaction, but the new [data-focused="true"] CSS rule mitigates this.
result: pass

### 2. Re-run UAT Test 7 — auto-send command red border on blurred unsafe value (post Plan 12-06)
expected: With the auto-send command Settings field containing an unsafe value (e.g., contains a control character or fails the safety regex), after blurring the field the input shows a strong red border (rgb(224, 64, 64) = #e04040 = --chrome-invalid-strong). The new bumped-specificity (0,2,2,0) rule wins on specificity ALONE against the focused-input :focus-visible rule (0,2,1,0) — no source-order tiebreak required.
result: pass

### 3. UAT-12-01 — multi-file send including binary .COM file (real MicroBeast)
expected: SLIDE round-trip succeeds for a multi-file send batch including at least one binary .COM file. Bytes received on the Z80 side are byte-identical to the source. Live MicroBeast hardware with patched slide.asm required.
result: blocked
blocked_by: prior-phase
reason: "User reported: can't test this as I don't yet have modified slide.com, and I note that the Force start button does nothing so I can't test it with an old version of slide.com either. Force-start bug logged as separate gap (severity: major) — see Gaps section."

### 4. UAT-12-02 — multi-file recv including zero-byte file (real MicroBeast)
expected: SLIDE recv succeeds for a multi-file batch including at least one zero-byte file. Receiver completes cleanly without state-machine wedge. Live MicroBeast hardware with patched slide.asm required.
result: issue
reported: "OK I've now got a patched updated slide.com binary on the microbeast. I have tested it standalone, it works well. When I initiate a drag a drop file transfer, the B:SLIDE r command is not auto-typed. When I click Retry it *is* autotyped, but then the whole process hangs. If I reset the microbeast, the tty remains hung. I cannot click on Disconnect in the TTY. I am forced to reload the page and reconnect to regain control."
severity: blocker
note: "Test 4's primary truth (multi-file RECV with zero-byte) was not directly exercised — user encountered a SEND-path failure cluster that prevented reaching recv. Captured as 3-symptom blocker. Note: patched slide.com confirmed working standalone, so the failures are entirely in the browser/JS side."

### 5. UAT-12-03 — cancel mid-send (real MicroBeast)
expected: User-initiated cancel during an active send terminates the transfer cleanly on both sides. Subsequent send/recv round-trips work without restart. Live MicroBeast hardware required.
result: blocked
blocked_by: prior-phase
reason: "User reported: blocked. Cascade from Test 4 send-path failure cluster — cannot reach a stable active-send state to exercise mid-send cancel. Re-test after the Test 4 gap (auto-type miss + send hang + UI wedge) is fixed."

### 6. UAT-12-04 — cancel mid-recv Z80 echo
expected: Inherits UAT-10-01 blocked-result idiom. Currently BLOCKED on upstream github.com/blowback/slide PR. Mark as `result: blocked` once UAT runs and confirm upstream status.
result: blocked
blocked_by: third-party
reason: "Pre-existing upstream block: github.com/blowback/slide PR for Z80-side cancel-mid-recv echo support is not yet merged. Inherits UAT-10-01 idiom — re-test when the upstream patch lands."

## Summary

total: 6
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 3

## Gaps

- truth: "[Force start] inline-action button on the wakeup-required chip dispatches case 'force-start' in slide.js:358 → enterSendModeInternal, allowing the user to send a batch when the Z80 has the legacy (pre-patch) slide.com that does not emit the wakeup byte."
  status: diagnosed
  reason: "User reported: the Force start button does nothing so I can't test it with an old version of slide.com either"
  severity: major
  test: 3
  discovered_during: "UAT-12-01 (multi-file send incl. .COM) — couldn't reach the actual test because the documented escape hatch for unpatched-firmware testing is itself broken"
  scope: "Phase 11 feature surfaced via Phase 12 UAT — the bug predates Phase 12 but blocks Phase 12 hardware verification"
  root_cause: "case 'force-start' in slide.js:358-371 successfully invokes enterSendModeInternal (state machine correctly transitions to send mode + flips wire owner + writes CTRL_RDY) but never updates the chip's UI lifecycle. case 'retry' (lines 337-357) calls slideChipRef.enterAwaitingWakeup() and case 'cancel' (lines 372-394) calls slideChipRef.hide() — case 'force-start' calls neither. The chip stays pinned at lifecycle='awaiting-timeout' showing the same [Retry] [Cancel] [Force start] text as before the click. slideChipRef.enterActive() is only invoked from dispatchTerminalMode:568 after a 7-byte ESC^SLIDE wakeup match, which by definition never arrives with unpatched slide.com — so the chip can NEVER reach the 'active' lifecycle through any production code path on the force-start route. User perceives 'does nothing' because there is zero visible UI feedback. Playwright spec slide-compatibility.spec.js:269 only asserts mode === 'send' and is silent on chip lifecycle, so CI did not catch the regression."
  artifacts:
    - path: "www/transport/slide.js"
      issue: "case 'force-start' (lines 358-371) omits chip lifecycle update — peer cases 'retry' and 'cancel' both call a slideChipRef.enterX() method on success"
    - path: "www/renderer/slide-chip.js"
      issue: "handleInlineAction for 'force-start' (lines 312-352) is a pure pass-through to stateChangeObservers — chip lifecycle is wholly the dispatcher's responsibility, and the dispatcher omits it"
    - path: "www/tests/transport/slide-compatibility.spec.js"
      issue: "test at line 269 asserts dispatcher mode but not chip lifecycle, hiding the regression from CI"
  missing:
    - "After enterSendModeInternal(session) succeeds in case 'force-start', invoke slideChipRef.enterActive() (matches the wakeup-completion-clause idiom at slide.js:568 and is semantically correct — the session IS now active)"
    - "Extend slide-compatibility.spec.js:269 to assert chip lifecycle transitions out of 'awaiting-timeout' after the click, so the regression cannot recur"
  debug_session: ".planning/debug/12-force-start-button-does-nothing.md"

- truth: "On a fresh drag-drop send to a MicroBeast running patched slide.com, the auto-send command (e.g. `B:SLIDE r\\r`) is auto-typed onto the wire as the first action of enterSendMode (slide.js readAutoSendCommandBytes → pushTxBytes), so the Z80 enters slide-receive mode before the SLIDE byte stream begins."
  status: diagnosed
  reason: "User reported (with patched slide.com confirmed working standalone): When I initiate a drag and drop file transfer, the B:SLIDE r command is not auto-typed. When I click Retry it *is* autotyped, but then the whole process hangs. Note the auto-send command in user's prefs is `B:SLIDE r` (lowercase r); safety regex /^[A-Za-z0-9: ]*\\r$/ accepts it (verified inline)."
  severity: blocker
  test: 4
  symptoms:
    - "A. Initial drag-drop send: auto-send command NOT auto-typed (no `B:SLIDE r\\r` on wire). Send proceeds but Z80 isn't in receive mode → wakeup never arrives → wakeup-required chip surfaces with [Retry] [Cancel] [Force start] actions."
    - "B. After clicking [Retry], auto-send command IS auto-typed (Retry path goes through enterSendModeInternal which DOES call readAutoSendCommandBytes). But then the whole send process hangs — no progress, no completion, no error."
    - "C. While hung, the TTY/UI is wedged — even after physically resetting the MicroBeast, the [Disconnect] button is non-functional (clicking it does nothing). Only a full page reload + reconnect recovers."
  root_cause: "REVISED 2026-05-09 after instrumented hardware capture (12-DEBUG-INSTRUMENTATION.md) + slide-team consultation. The original three-cause hypothesis was largely refuted by the captured logs — actual root cause is far simpler. (A REFUTED) Stale prefsRef: capture shows prefs read live correctly (slideAutoSendCommand and slideAutoSendCommandConfirmed are both 'B:SLIDE r\\r' — the user's edited value, not the boot-time default). The user-visible 'auto-type miss' is a perception artefact: auto-typed bytes don't local-echo and CP/M's echo gets swallowed by the echo-swallow filter — bytes ARE on the wire but invisible on canvas. (B CONFIRMED — actual root cause) RTS not asserted on connect. Phase 5 D-09/D-11 (serial.js:391) actively de-asserts both DTR and RTS after port.open() to avoid a reset-pulse on CP2102N adapters. With host RTS=low for the entire session, Z80 sees CTS=low; Z80-side UART hardware auto-flow-control then BLOCKS all transmits. Boot output flowed because Z80 boot ROM doesn't enable strict flow control; once slide.com takes over, the wakeup-emit (and any other transmit) silently stalls at the Z80 UART. Confirmed by slide team (2026-05-09) — Z80-side auto-flow-control requires host RTS asserted. Captured log shows the JS side does its part perfectly: pushTxBytes → writer.write → resolved (10 bytes 'B:SLIDE r\\r'); Z80 receives + echoes the full line + emits CRLF (CP/M consumed the command); SLIDE.COM is running silently in receive mode but cannot emit ANY byte due to host-RTS-low gating. (C REFUTED) Disconnect non-functional: capture shows clean teardown — every step (setSignals, reader.cancel, writer.releaseLock, port.close) completes promptly. Original report was a one-off, not reproducible. Drop unless it recurs. (Bonus finding) Force-start (Gap 1) is the existing escape hatch for the same wedge (skip-wakeup-wait → jump to send mode). Its UI bug made it appear non-functional. Fixing Gap 1 ALONE would have given the user a workaround for Gap 2."
  scope_decision: "d3 (user choice 2026-05-09): plan two code fixes + doc updates + new Settings toggle for RTS-on-connect. Defensible because future MicroBeast variants may have RTS wired differently (the original Pitfall #12 reset concern is credible for some configurations); a toggle preserves the safe-default-RTS-low option for those users while making asserted-RTS the working default."
  artifacts:
    - path: "www/transport/serial.js"
      issue: "Line 391 — after port.open(), actively de-asserts both DTR and RTS via setSignals({ dataTerminalReady: false, requestToSend: false }). Phase 5 D-09 / D-11 documented this as a safe-default to avoid CP2102N reset-pulse via DTR/RTS-wired GPIOs. But on the MicroBeast, RTS is NOT a reset line — it's the standard hardware-flow-control RTS line going to the Z80's CTS input. With host RTS=low, Z80 sees CTS=low and Z80-side UART auto-flow-control blocks all Z80 transmits."
    - path: "www/state/prefs.js"
      issue: "Need a new pref `serialAssertRtsOnConnect` (default true) to make the new behaviour configurable for users on differently-wired Z80 hardware where RTS might be a reset line."
    - path: "www/index.html"
      issue: "Settings sub-block needs a new checkbox for the RTS-on-connect toggle, plumbed through to the new pref."
    - path: ".planning/phases/05-web-serial-transport/05-CONTEXT.md"
      issue: "D-09 and D-11 document the both-false default with Pitfall #12 rationale. Need a Phase 12.1 amendment recording the slide-team finding and the revised default (RTS asserted on connect, both de-asserted on close — DTR-as-reset concern preserved)."
    - path: "docs/SLIDE_Z80_REQUIREMENT.md"
      issue: "No mention of host-side RTS/CTS hardware flow control as a Z80 expectation. The Z80 SLIDE author needs to know that Beastty asserts RTS on connect (post-fix) and that Z80-side hardware auto-flow-control is supported / required."
  missing:
    - "Change serial.js:391 from `requestToSend: false` to read from the new pref (default true). One boolean swap, gated by `prefsRef.serialAssertRtsOnConnect ?? true`."
    - "Add `serialAssertRtsOnConnect: true` to PREFS_DEFAULTS in www/state/prefs.js and to the prefs schema/migration if one exists."
    - "Add a Settings checkbox in www/index.html under the existing serial-config block, wired through main.js to persist via savePrefs."
    - "Add a Playwright test asserting that connect() calls setSignals with requestToSend=true when the pref is default/true, and requestToSend=false when the pref is explicitly false."
    - "Update .planning/phases/05-web-serial-transport/05-CONTEXT.md D-09 / D-11 with a Phase 12.1 amendment block referencing the slide-team finding (cite this UAT)."
    - "Add a §'Hardware flow control / RTS' section to docs/SLIDE_Z80_REQUIREMENT.md describing the contract: Beastty asserts RTS on connect (post-12.1), Z80 may use this as CTS for its UART; Z80 should NOT wire RTS to a reset line."
    - "Leave the disconnect-time + beforeunload + visibility-change de-asserts UNCHANGED — those should still drive RTS=low on close (clean signalling that Beastty is going away)."
    - "DO NOT change DTR — keep it de-asserted in all paths, including connect. Phase 5 D-09's DTR-as-reset concern is more credibly applicable to DTR than to RTS, and the slide team only asked for RTS."
  debug_session: ".planning/debug/12-send-path-failure-cluster.md"
  capture_log: ".planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-DEBUG-INSTRUMENTATION.md (instrumentation reference + per-symptom decoding guide)"
  recovery_severity: "blocker per original report; root cause now clarified — Z80 transmits silently blocked at UART level due to host RTS=low; Z80 cannot emit wakeup or any other byte. Fix unblocks all Z80→host transmits."
