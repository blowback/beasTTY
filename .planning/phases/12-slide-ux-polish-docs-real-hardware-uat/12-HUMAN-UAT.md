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
  root_cause: "THREE INDEPENDENT root causes that chain into the observed cluster — A and B/C are not a single bug. (A) Stale prefsRef: prefs.js:89-92 savePrefs() reassigns cached = { ...cached, ...partial } on every write, creating a NEW object. slide.js:305 wireSlideDispatcher captures prefsRef = prefs ONCE at boot and never re-reads, so any in-session pref change made via Settings is INVISIBLE to slide.js — affects both shouldSurfaceFirstUseConfirm gate (slideAutoSendCommandConfirmed is the boot-time value forever) and the auto-send command source. STATE.md Phase 11 P11-05 diary explicitly documents this hazard. serial.js:362-364 correctly uses getPrefs() — slide.js does not. (B) JS↔patched-slide.com interop bug — most plausibly metadata frame layout (slide.js:1049 packMetadataInline) or data-frame ACK timing/multi-file boundary; user explicitly notes this is the FIRST end-to-end hardware run with the patched binary. Plan 09-04 sendDispatchTail FIFO chain swallows rejected writes via .catch(err => console.error(...)) without recovering downstream pump state. (C) Missing send-mode escape hatch in disconnect/port-lost path: slide-recv.js:678 slidePumpOnPortLost cleans up RECV mode (force_idle + setWireOwner + enterError + forceExitRecvMode); SEND mode has NO equivalent. teardown() runs while dispatchSendMode awaits writer.write that is itself suspended on writer.ready (kernel buffer full because reset Z80 isn't consuming). port.close() waits for the pending write; the Disconnect Promise chain stalls; state never transitions to 'disconnected'."
  artifacts:
    - path: "www/state/prefs.js"
      issue: "savePrefs (line 89-92) reassigns `cached` to a NEW object on every write — consumers holding a captured reference see stale values forever. The hazard root for Symptom A."
    - path: "www/transport/slide.js"
      issue: "wireSlideDispatcher (line 305) captures `prefsRef = prefs || null` at boot and never re-reads. Read sites at 877-878, 1005, 219 all see boot-time prefs. Compare to serial.js:362-364 which correctly uses getPrefs() lookup."
    - path: "www/transport/slide.js"
      issue: "packMetadataInline (line 1049) is the prime suspect for Symptom B interop bug — needs cross-checking against the patched slide.com Z80-side parser. handleChipInlineAction 'retry' case (lines 337-357) bypasses the first-use-confirm gate entirely (different path from the initial drop)."
    - path: "www/transport/slide.js"
      issue: "sendDispatchTail FIFO (lines 415-417) swallows rejected writes via .catch(err => console.error(...)) without recovering downstream pump state. maybeExitSendMode (lines 1276-1281) only exits on DONE/ERROR/CANCEL_PEND from the Rust SM — if the SM is mid-DataPhase awaiting an ACK that never arrives, this is never triggered."
    - path: "www/transport/slide-recv.js"
      issue: "slidePumpOnPortLost (line 678) is RECV-mode-only — no symmetric send-mode teardown exists. Symptom C's root."
    - path: "www/transport/serial.js"
      issue: "teardown sequence (lines 515-543) does not actively force_idle the slide instance or reject sendDispatchTail before port.close(). Pending writeSlideFrameAwaitable can hang port.close() indefinitely."
    - path: "www/main.js"
      issue: "wireSlideDispatcher boot wiring (line 496) passes the boot-time `prefs` snapshot. Fix may need to thread `getPrefs` instead."
  missing:
    - "Symptom A — Switch slide.js from a stored prefs reference to a getPrefs function injection. Replace prefsRef = prefs with getPrefs = opts.getPrefs and call getPrefs() at every read site (shouldSurfaceFirstUseConfirm, readAutoSendCommandBytes, the compatMode read in enterSendModeProceed). Add a Playwright test that drives a Settings change mid-session and asserts the next enterSendMode reads the new value."
    - "Symptom B — Hardware-side wire capture needed to disambiguate. Recommend instrumenting slide.js to log every event drained (take_event_packed) and every chunk pumped (feed_send_chunk) in send mode; user re-runs the Retry scenario and shares the console log. Cross-validate packMetadataInline output against the patched slide.com's expected metadata layout (slide-rs protocol.rs reference + Z80 PR delta)."
    - "Symptom C — Add a slideSendPumpOnPortLost (mirror of slideRecvPumpOnPortLost) that calls slide.force_idle() + setWireOwner('terminal') + clears pendingSendSession + clears currentSendCtx + resets sendDispatchTail = Promise.resolve() + sets mode = 'terminal'. Wire it into serial.js:teardown BEFORE port.close() (and into serial.js:handleReadError). Add a Playwright test that puts the dispatcher in send mode, simulates a stuck-write (mock writer.ready never resolves), and asserts disconnect() resolves within a bounded timeout."
  debug_session: ".planning/debug/12-send-path-failure-cluster.md"
  recovery_severity: "blocker — only a page reload regains UI control. No graceful escape via [Cancel], [Disconnect], or even a hard reset of the MicroBeast clears the wedge."
