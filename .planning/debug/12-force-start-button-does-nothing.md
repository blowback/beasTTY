---
status: diagnosed
trigger: "Force start button does nothing — chip's [Force start] inline-action click does not dispatch enterSendModeInternal, blocking pre-patch slide.com testing path"
created: 2026-05-09T13:00:00Z
updated: 2026-05-09T13:30:00Z
---

## Current Focus

hypothesis: "case 'force-start' in handleChipInlineAction successfully transitions the dispatcher to send-mode but never updates the chip's UI lifecycle. The chip remains stuck in 'awaiting-timeout' showing [Retry][Cancel][Force start] AFTER the click. With no visual feedback, no auto-type (force-start is the no-auto-type branch by design), and no inbound bytes from the unpatched-slide.com Z80, the user perceives the click as a no-op."
test: "Static analysis of www/transport/slide.js handleChipInlineAction case 'force-start' (lines 358-371) compared to peer cases."
expecting: "Confirmed — case 'force-start' calls enterSendModeInternal(session) but never invokes any slideChipRef.enterX() method. Compare to case 'retry' (calls enterAwaitingWakeup), case 'cancel' (calls hide). The Compatibility-mode 'force-start' branch in enterSendMode (lines 1006-1023) calls enterAwaitingWakeup({armTimer:false}) but is a separate code path; the button-click handler is missing this call."
next_action: "Diagnosis complete. Write findings."

## Symptoms

expected: "[Force start] inline-action button on the wakeup-required chip dispatches case 'force-start' in slide.js:358 → enterSendModeInternal, allowing the user to send a batch when the Z80 has the legacy (pre-patch) slide.com that does not emit the wakeup byte."
actual: "the Force start button does nothing so I can't test it with an old version of slide.com either"
errors: "None reported (no console errors, no auto-type, no send progress)"
reproduction: "Test 3 in 12-HUMAN-UAT.md. Real MicroBeast running unpatched slide.com (no wakeup byte emission). Drag-drop send initiated → wakeup-required chip surfaces with [Retry] [Cancel] [Force start] actions → click [Force start] → nothing happens."
started: "2026-05-09 during Phase 12 hardware UAT. Button added in Phase 11 Plan 11-04 D-15."

## Eliminated

- hypothesis: "Click event doesn't reach the inner button due to nested-button HTML invalidity"
  evidence: "Playwright spec www/tests/transport/slide-compatibility.spec.js:269 ([Force start] click jumps directly into send mode without waiting for wakeup) PASSES — confirmed by running the spec. Click events DO reach the inner button. UI-SPEC line 157 explicitly acknowledges nested <button> is invalid HTML5 but Chromium accepts it."
  timestamp: 2026-05-09T13:15:00Z

- hypothesis: "pendingSendSession is null when force-start is clicked, so the if(pendingSendSession) guard at line 364 silently fails"
  evidence: "Exhaustive search: pendingSendSession is only nulled in case 'force-start' itself, case 'cancel', __resetForTests (test only), wakeup-completion in dispatchTerminalMode (only on full ESC^SLIDE match), and the Compatibility-mode 'force-start' branch (only when prefs.slideCompatibilityMode === 'force-start', which would skip awaiting-* states entirely). None of these would fire in the user's scenario (legacy slide.com never emits wakeup, user didn't click cancel, mode is 'auto'). pendingSendSession SHOULD be set when force-start is clicked. Even if it weren't, the symptom would still be 'does nothing' so this is observationally indistinguishable, but the more likely explanation is the missing chip lifecycle update below."
  timestamp: 2026-05-09T13:20:00Z

- hypothesis: "WR-02 firstUseConfirmPending sentinel (commit 1200af7) blocks re-entry"
  evidence: "Sentinel is only set in enterSendMode and only checked at the top of enterSendMode itself — does not affect handleChipInlineAction's case 'force-start' branch."
  timestamp: 2026-05-09T13:22:00Z

- hypothesis: "Refresh tick (250ms refreshChip) destroys buttons and races with user click"
  evidence: "While the refresh tick does replace the buttons every 250ms via innerHTML, this is synchronous and re-attaches handlers immediately. Even if a click straddled a refresh, this would cause intermittent failure — but the user reports consistent 'does nothing'. Also Retry button uses identical wiring and works (per Test 4). Refresh-tick race would affect Retry equally."
  timestamp: 2026-05-09T13:25:00Z

## Evidence

- timestamp: 2026-05-09T13:10:00Z
  checked: "www/renderer/slide-chip.js handleInlineAction (lines 312-352)"
  found: "force-start has NO internal handler in chip.js — falls through if/else chain. Click handler ONLY emits 'inline-action' event to stateChangeObservers via the unconditional for-loop fan-out at lines 349-351."
  implication: "The chip's role for force-start is purely to surface the click to the dispatcher. The dispatcher in slide.js is responsible for ALL behaviour including any chip lifecycle update."

- timestamp: 2026-05-09T13:12:00Z
  checked: "www/transport/slide.js handleChipInlineAction (lines 335-396)"
  found: "case 'force-start' (lines 358-371) reads pendingSendSession, nulls it, calls enterSendModeInternal(session) inside try/catch. Returns. NEVER calls any slideChipRef method."
  implication: "After the click, the chip's lifecycle remains 'awaiting-timeout' (set by the wakeup-timer expiry at chip.js line 377 BEFORE the click)."

- timestamp: 2026-05-09T13:14:00Z
  checked: "Comparison to peer cases — case 'retry' (lines 337-357) and case 'cancel' (lines 372-394)"
  found: |
    - case 'retry' (success path): calls slideChipRef.enterAwaitingWakeup({ armTimer }) at line 353. Chip visibly resets to 'awaiting-wakeup' lifecycle (text: '↑ Waiting for Z80…').
    - case 'cancel' (success path): calls slideChipRef.hide() at line 387. Chip visibly disappears.
    - case 'force-start' (success path): calls NEITHER. Chip stays in 'awaiting-timeout' lifecycle.
  implication: "Asymmetric chip-lifecycle handling. force-start is the only case that produces no visible UI feedback after a successful click."

- timestamp: 2026-05-09T13:16:00Z
  checked: "www/transport/slide.js enterSendMode Compatibility-mode 'force-start' branch (lines 1006-1023)"
  found: "When user sets prefs.slideCompatibilityMode === 'force-start' (Settings dropdown), enterSendMode calls slideChipRef.enterAwaitingWakeup({ armTimer: false }) at line 1014, then microtask-schedules enterSendModeInternal. The chip transitions to 'awaiting-wakeup' lifecycle (text: '↑ Waiting for Z80… [Cancel]'). Even this static-mode branch never calls enterActive() — but at least the chip changes."
  implication: "Two different force-start code paths (Compatibility-mode static vs button-click dynamic) have inconsistent chip-lifecycle handling. Neither calls enterActive(); the static-mode path at least changes lifecycle to 'awaiting-wakeup'. The button-click path doesn't touch the chip at all."

- timestamp: 2026-05-09T13:18:00Z
  checked: "Search for slideChipRef.enterActive() callers in www/transport/slide.js"
  found: "enterActive is called from EXACTLY ONE site: dispatchTerminalMode line 568 (after a 7-byte ESC^SLIDE wakeup match completes). It is never called from enterSendModeInternal nor from any of the force-start paths."
  implication: "There is no code path in send-mode that transitions the chip to 'active' lifecycle EXCEPT the natural wakeup-arrival path. With unpatched slide.com on Z80 (the entire reason force-start exists), there is NO wakeup. Therefore the chip cannot reach 'active' lifecycle through any production code path."

- timestamp: 2026-05-09T13:22:00Z
  checked: "Playwright spec slide-compatibility.spec.js:269 [Force start] click test"
  found: "The Playwright test only asserts mode === 'send' after the click. It does NOT assert any chip lifecycle transition. So the test passes even though the chip remains stuck in 'awaiting-timeout'."
  implication: "Test coverage gap. The behaviour matches the test contract, but the test contract does not match the user-perceived contract (which expects visible UI feedback)."

- timestamp: 2026-05-09T13:25:00Z
  checked: "User-perceived symptoms vs internal state after force-start click"
  found: |
    With legacy unpatched slide.com on real MicroBeast:
    - Click reaches handleChipInlineAction('force-start') via observer fan-out.
    - pendingSendSession is read & cleared, enterSendModeInternal(session) runs.
    - new Slide() constructed; slide.enter_send_mode(metadata) puts CTRL_RDY in outbound.
    - txSinkRef.setWireOwner('slide'), mode = 'send'.
    - Initial drain via sendDispatchTail writes the CTRL_RDY byte to the wire.
    - Z80 (running unpatched slide.com that DOES still receive correctly per the gap report) WOULD see the CTRL_RDY byte. Whether it responds depends on the legacy version's protocol handling.
    - Chip lifecycle: STILL 'awaiting-timeout'. UI text unchanged: "Z80 didn't respond.  [Retry]  [Cancel]  [Force start]".
    - User perception: "Force start does nothing" — NO visual feedback on the click.
  implication: "Even when the dispatcher state machine successfully transitions to send-mode and writes bytes to the wire, the user sees zero UI change. The chip's stale text effectively masks the success of the click. If the Z80 then doesn't drive the protocol forward (legacy slide.com may have its own quirks), there is no subsequent event to update the chip either."

## Resolution

root_cause: "case 'force-start' in www/transport/slide.js:handleChipInlineAction (lines 358-371) successfully invokes enterSendModeInternal(session) — flipping mode='send', wire owner='slide', and writing CTRL_RDY — but **never updates the chip's UI lifecycle**. The chip remains stuck in 'awaiting-timeout' showing the same [Retry][Cancel][Force start] text as before the click. There is also no code path in slide.js that transitions the chip to 'active' lifecycle from a send-mode entry that bypasses the wakeup matcher (slideChipRef.enterActive() is only called from dispatchTerminalMode line 568 after a successful 7-byte ESC^SLIDE wakeup match). With unpatched slide.com (the use case force-start exists for), no wakeup ever arrives, so the chip can NEVER transition to 'active' through any production code path. The user perceives the click as a no-op because there is zero visible feedback."

fix: ""

verification: ""

files_changed: []
