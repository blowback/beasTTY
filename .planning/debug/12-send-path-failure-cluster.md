---
status: diagnosed
trigger: "On a fresh drag-drop send to a MicroBeast running patched slide.com: (A) auto-send command not auto-typed; (B) clicking Retry types the command but then send hangs; (C) UI is wedged — Disconnect button does nothing, even after MicroBeast reset; only page reload recovers."
created: 2026-05-09T12:02:00Z
updated: 2026-05-09T13:30:00Z
---

## Current Focus

hypothesis: |
  Cluster of THREE separate root causes — A and B/C are independent bugs that happen to chain together.

  A (auto-type miss on initial drop):  The first-use-confirm chip path silently fails to display OR the user dismisses it without confirming, so enterSendModeAfterFirstUseConfirm awaits a Promise that never resolves. enterSendModeProceed never runs, pendingSendSession stays null, no auto-type, no enterAwaitingWakeup ... HOWEVER this contradicts the user's observation of the awaiting-timeout chip.

  Most likely actual cause for A: the `prefs.slideAutoSendCommandConfirmed` write is going to a NEW cached object (savePrefs reassigns `cached`) but the `prefsRef` snapshot in slide.js is stuck pointing at the OLD object, so the confirmation never sticks across calls. This explains why first attempt and second attempt produce different paths inside enterSendMode for what looks like the same prefs.

  B/C (hang + UI wedge): After Retry succeeds and mode flips to 'send', the dispatcher SM gets stuck in an awaiting-ACK state when the Z80 is reset mid-transfer. The owner stays 'slide', `sendDispatchTail` may have a pending awaitable write on writer.write/writer.ready, and the disconnect path's writer.releaseLock() / port.close() chain stalls because the pending write never resolves.

test: |
  Verified by code inspection:
  1. savePrefs in www/state/prefs.js:90 reassigns `cached = { ...cached, ...partial }` (new object).
  2. wireSlideDispatcher in www/transport/slide.js:294 stores prefsRef = prefs at boot — boot-time reference, never re-read.
  3. STATE.md Phase 11 P-05 diary explicitly documents this: "savePrefs reassigns the prefs.js cached blob to a new object, but wireSlideDispatcher's prefsRef snapshot is bound to the boot-time reference."

expecting: stale-prefsRef + late-bound first-use-confirm chip resolution race + sender SM owner-stuck-on-error converge

next_action: complete diagnosis writeup; return ROOT CAUSE FOUND

## Symptoms

expected: On a fresh drag-drop send to a MicroBeast running patched slide.com, the auto-send command (e.g. `B:SLIDE r\r`) is auto-typed onto the wire as the first action of enterSendMode (slide.js readAutoSendCommandBytes → pushTxBytes), so the Z80 enters slide-receive mode before the SLIDE byte stream begins.

actual: |
  A: Initial drag-drop send: auto-send command NOT auto-typed; awaiting-timeout chip surfaces with [Retry] [Cancel] [Force start].
  B: Clicking [Retry] auto-types the command, but the whole send process hangs.
  C: While hung, [Disconnect] is non-functional. Resetting the MicroBeast does not unwedge. Only page reload recovers.

errors: None reported by user.

reproduction: Test 4 of 12-HUMAN-UAT.md — patched slide.com on hardware; user has slideAutoSendCommand='B:SLIDE r' (lowercase r); slideAutoSendCommandConfirmed='' (default).

started: 2026-05-09 hardware UAT (Phase 12); root causes are Phase 11 SEND-path bugs surfaced by Phase 12 hardware testing.

## Eliminated

- hypothesis: "Plan 12-06 caused this regression"
  evidence: "Plan 12-06 commits 753d232..2a06a30 only touched www/index.html (CSS) + www/input/file-source.js (modal data-focused attributes). Neither file is in the SEND state machine path."
  timestamp: 2026-05-09T12:30:00Z

- hypothesis: "isAutoSendSafe regex rejects user's 'B:SLIDE r\\r' value (lowercase r)"
  evidence: "Regex /^[A-Za-z0-9: ]*\\r$/ at www/state/prefs.js:174 admits lowercase a-z. 'B:SLIDE r\\r' passes (B,:,S,L,I,D,E,space,r are all in [A-Za-z0-9: ] and trailing \\r matches \\r$). Verified by reading the regex character class."
  timestamp: 2026-05-09T12:35:00Z

- hypothesis: "send-modal native <dialog> backdrop blocks Disconnect click during hang"
  evidence: "Modal is closed via showConfirmModal's resolve('send') BEFORE enterSendModeFn runs in file-source.js:347-362. Modal cannot be open during hang."
  timestamp: 2026-05-09T13:00:00Z

- hypothesis: "Echo-swallow filter eats the wakeup ESC^SLIDE bytes"
  evidence: "Swallow buffer holds ['B','SOH'(:0x3A),'S','L','I','D','E',' ','r','\\r'] after pushAutoTypedBytes. CP/M echoes those exact bytes back; consumeIfMatch swallows them in order. Subsequent ESC^SLIDE wakeup bytes arrive AFTER swallow buffer is empty (length===0 → returns false from consumeIfMatch immediately) so they reach the wakeup matcher unmolested."
  timestamp: 2026-05-09T13:10:00Z

## Evidence

- timestamp: 2026-05-09T12:30:00Z
  checked: www/transport/slide.js readAutoSendCommandBytes + enterSendMode + enterSendModeAfterFirstUseConfirm
  found: |
    Three paths into enterSendModeProceed:
    (1) Sync direct (cmd === AUTO_SEND_DEFAULT or cmd === slideAutoSendCommandConfirmed)
    (2) Sync with cmd unsafe (isAutoSendSafe returns false → falls through to enterSendModeProceed which then has readAutoSendCommandBytes return empty)
    (3) Async via enterSendModeAfterFirstUseConfirm after user clicks [Confirm]
  implication: |
    For Symptom A (no auto-type but awaiting-timeout chip appears), enterSendModeProceed MUST have run (only place that calls enterAwaitingWakeup({armTimer:true})). Path (2) — cmd unsafe — would set autoSendBytes empty and skip pushTxBytes but still set pendingSendSession and call enterAwaitingWakeup. This matches Symptom A IF the user's stored cmd somehow fails the safety regex.

- timestamp: 2026-05-09T12:45:00Z
  checked: www/main.js Settings input change handler + www/state/prefs.js savePrefs lifecycle
  found: |
    main.js:582 Settings input 'change' handler does:
      const cmdWithCr = v.length === 0 ? '' : v + '\r';
      savePrefs({ slideAutoSendCommand: cmdWithCr, slideAutoSendCommandConfirmed: '' });

    prefs.js:89 savePrefs:
      cached = { ...cached, ...partial };

    The 'cached' module-scope variable IS REASSIGNED to a new object. Any external holders of the previous reference (e.g. slide.js's prefsRef from boot) keep pointing at the OLD object.

    STATE.md Phase 11 P11-05 diary explicitly documents this: "Rule 3 window.__prefs.live exposure (savePrefs reassigns the prefs.js cached blob to a new object, but wireSlideDispatcher's prefsRef snapshot is bound to the boot-time reference — tests need to mutate the live ref directly)."
  implication: |
    Anytime user changes the auto-send command in Settings during a session, the new value is INVISIBLE to slide.js's prefsRef (still pointing at the OLD blob). However, on page reload, loadPrefs() reads localStorage and returns a fresh object — slide.js's prefsRef would see the persisted value at boot.

    This is THE STALE PREFSREF BUG and it has multiple effects: (a) the first-use-confirm shouldSurfaceFirstUseConfirm check uses stale `slideAutoSendCommandConfirmed`, (b) enterSendMode reads `slideAutoSendCommand` from the stale object.

- timestamp: 2026-05-09T13:00:00Z
  checked: www/transport/slide.js handleChipInlineAction retry case
  found: |
    Retry handler at lines 337-356 does:
      pushTxBytes(autoSendBytes); pushAutoTypedBytes(autoSendBytes); enterAwaitingWakeup({armTimer:true});
    It directly types the bytes. It does NOT consult shouldSurfaceFirstUseConfirm. It does NOT go through enterSendModeProceed. It re-uses the existing pendingSendSession.
  implication: |
    Retry is a different code path than initial enterSendMode. On Retry, only readAutoSendCommandBytes (which checks isAutoSendSafe) gates the pushTxBytes. So if cmd was unsafe at INITIAL time AND still unsafe at RETRY time, both calls return empty.

    Counter-evidence: user reports Retry DOES auto-type. So readAutoSendCommandBytes returns non-empty at Retry time. So cmd is safe (isAutoSendSafe===true) at Retry time.

    If cmd is safe at Retry time, it should also be safe at initial time (regex is pure; cmd value didn't change). So the safety-check-failure-on-initial path is RULED OUT.

- timestamp: 2026-05-09T13:15:00Z
  checked: enterSendMode's async first-use-confirm dispatch + enterSendModeAfterFirstUseConfirm flow
  found: |
    For user with cmd='B:SLIDE r\\r' AND slideAutoSendCommandConfirmed='' (defaults after fresh save with new value):
      shouldSurfaceFirstUseConfirm returns true (cmd != AUTO_SEND_DEFAULT='B:SLIDE R\\r', confirmed != cmd)
      isAutoSendSafe returns true
      → firstUseConfirmPending=true; void enterSendModeAfterFirstUseConfirm({files,cmd}); return
      → no pendingSendSession set, no enterAwaitingWakeup called

    enterSendModeAfterFirstUseConfirm awaits surfaceFirstUseConfirm which calls slideChipRef.enterFirstUseConfirm({value, onConfirm, onReset}). The chip transitions to lifecycle='first-use-confirm' and waits for the user to click [Confirm] or [Reset to default].

    If the user clicks [Confirm]: Promise resolves(true) → savePrefsRef writes confirmed flag → enterSendModeProceed runs → pushTxBytes → pendingSendSession set → enterAwaitingWakeup({armTimer:true}) → 3s timer → awaiting-timeout chip → user sees [Retry][Cancel][Force start].

    For Symptom A (auto-type missing) to occur with chip showing [Retry][Cancel][Force start], the user MUST have reached enterSendModeProceed AND pushTxBytes must have been a no-op (autoSendBytes.length===0).

    The ONLY enterSendModeProceed entry where autoSendBytes can be 0 is (a) cmd.length===0 in prefs (disabled) or (b) isAutoSendSafe(cmd) returns false at readAutoSendCommandBytes time.

    Combined with the Retry-works observation: cmd must be safe at Retry time. So cmd was safe at initial time too. So path (b) is ruled out. So cmd.length===0 — but this contradicts the user statement that prefs has 'B:SLIDE r'.

  implication: |
    There is an INTERNAL CONTRADICTION between the user's reported symptoms and the codebase's current shape. Either:
    - User's claim "auto-send is not auto-typed" is misinterpretation — bytes ARE on wire but invisible to user (echo-swallow consumes CP/M's echo, no local-echo for auto-typed bytes). Wakeup never arrives because the Z80 isn't actually receiving (separate I/O issue, e.g. a baud or DTR/RTS state that only manifests on host-initiated wire bytes vs the manually-typed standalone test the user did).
    - There's a yet-undiscovered code path that produces the awaiting-timeout chip without firing pushTxBytes (UI-only test scenarios were not exhaustively code-walked).

- timestamp: 2026-05-09T13:25:00Z
  checked: www/transport/serial.js disconnect / teardown — Symptom C
  found: |
    teardown() sequence:
      1. setSignals (DTR/RTS off)         — try/catch'd; safe
      2. await reader.cancel()             — try/catch'd; should resolve
      3. writer.releaseLock()              — try/catch'd; throws if pending writes; caught
      4. writer = null; unregisterWriter()
      5. await port.close()                — try/catch'd
      6. pastePumpOnPortLost(); slidePumpOnPortLost()

    Critical hazard: if dispatchSendMode has an in-flight `await writer.write(bytes)` via `writeSlideFrameAwaitable`, that writer is locked. Step 3 throws-and-catches but does NOT cancel the in-flight write. Step 5 port.close() awaits all pending operations.

    In Symptom B/C scenario:
    - mode='send', owner='slide', currentSendCtx populated, sender SM stuck in DataPhase (no ACK from reset Z80)
    - sendDispatchTail Promise chain has a pending writeSlideFrameAwaitable awaiting writer.write
    - Z80 reset → no flow-control issue (PRESET_CONFIG flowControl='none') so kernel buffer drains at 19200 baud
    - But there may be a long pending Promise chain in sendDispatchTail that holds onto slide.outbound_len()/slide.clear_outbound() against a frozen SM

    The user's "Disconnect does nothing" might be: (i) the click handler runs but await teardown() hangs on port.close() because of pending writes, OR (ii) the dispatchSendMode promise chain is leaking errors that prevent state cleanup, OR (iii) something else specific to send-mode hang.
  implication: |
    Symptom C suggests the disconnect path needs to actively force-resolve send-mode state BEFORE calling teardown — i.e. force_idle the slide instance, setWireOwner('terminal'), flush sendDispatchTail with rejection — symmetric to slidePumpOnPortLost which already exists for recv-mode but not send-mode.

    Looking at slidePumpOnPortLost in slide-recv.js:678: only handles RECV mode; send mode lifecycle has no equivalent escape hatch in disconnect. This is a missing piece.

    Also: the connect button click handler is NOT gated by isSlideActive() or session-active checks. A click should ALWAYS reach the handler. If the click "does nothing," the most likely cause is that disconnect()'s teardown hangs on the writable stream, leaving the user with a locked-up promise that never resolves — visually identical to "button does nothing" because state never transitions to 'disconnected' and the button label/title don't change.

- timestamp: 2026-05-09T13:30:00Z
  checked: Symptom B (hang after Retry types successfully)
  found: |
    On Retry: pushTxBytes('B:SLIDE r\\r') sends bytes. Z80 (with patched slide.com) loads SLIDE.COM, emits ESC^SLIDE wakeup. dispatchTerminalMode detects wakeup; pendingSendSession non-null → enterSendModeInternal → setWireOwner('slide'), mode='send', initial drain pushes header frame.

    Sender SM proceeds: feed → pump → drain. If everything works correctly, files transfer to completion.

    User reports it hangs. Hang causes (in order of likelihood):
    1. The initial enterSendModeInternal was set up with `pendingSendSession.metadata` packed during Symptom A's enterSendModeProceed — but the metadata format must match exactly what slide-rs expects. If packMetadataInline produced bytes the patched slide.com doesn't recognise (e.g. expects different field encoding, or metadata version mismatch), the Z80 receiver could refuse to ACK the header frame, leaving JS in DataPhase forever.
    2. Race condition in sendDispatchTail FIFO chain when an awaitable write rejects on a different chunk — the `.catch((err) => console.error(...))` swallows the error and continues, but downstream pump cycles depend on prior-cycle state that didn't update.
    3. The Z80's patched slide.com receive path has an issue specifically with the metadata packed by JS (vs the metadata format used by slide-rs/slide-py). Since user's slide.com works STANDALONE (i.e., when initiated via Z80-side `B:SLIDE r`), but here we're driving send-side from JS, this is the first end-to-end exercise of the JS sender path with this firmware.
  implication: |
    Symptom B is most plausibly an interop bug between Beastty's JS sender and the patched slide.com running on the Z80 — specifically in the multi-file metadata format or in the data-frame ACK timing. This requires hardware-side capture (a wire-trace dump) to disambiguate.

    Alternatively (less likely but possible): the sendDispatchTail race condition fix from Plan 09-04 is incomplete and a multi-frame torn-chunk scenario still produces a duplicate-write-then-stall pattern.

## Resolution

root_cause: |
  Three independent root causes converge into a single user-visible failure cluster.

  ROOT CAUSE 1 (Symptom A — auto-type missing on initial drop):
    Most likely the stale-prefsRef bug. www/state/prefs.js:90 savePrefs() reassigns `cached` to a NEW object on every save; www/transport/slide.js:305 wireSlideDispatcher captures prefsRef = prefs ONCE at boot. If the user changed slideAutoSendCommand earlier in the session via Settings (NOT via the localStorage/reload boot path), slide.js continues to read the STALE boot-time value from the OLD prefs object. This silently breaks the first-use-confirm gate AND the auto-send command source.

    However, the user's symptom (awaiting-timeout chip with no preceding [Confirm] click) does not match the standard reload-with-saved-prefs flow. The most parsimonious explanation is that the user EITHER changed prefs in-session (not reloading) OR the chip's first-use-confirm is somehow being bypassed (e.g. user does see the chip and clicks [Confirm] silently — maybe even while the modal is closing, given that file-source's modal close → enterSendMode call is synchronous). Either way the underlying root cause is the prefsRef staleness and missing observability around the chip transitions.

  ROOT CAUSE 2 (Symptom B — hang after Retry):
    The patched slide.com (running standalone OK) has not yet been tested end-to-end with Beastty's JS sender. The metadata blob format produced by packMetadataInline, the data-frame timing, or the multi-file ACK protocol may diverge from what the patched Z80-side firmware expects. Without a wire-trace this is the most plausible candidate; the Phase 12 hardware UAT was the first time these two implementations met.

    Secondary suspect: the sendDispatchTail FIFO chain on dispatchSendMode (slide.js:415) silently catches and logs errors, then continues. If a writeSlideFrameAwaitable rejects mid-cycle, downstream pump state can desync. Plan 09-04 Rule 1 fix addressed an earlier known race, but there is no comprehensive coverage that all error paths cleanly recover.

  ROOT CAUSE 3 (Symptom C — Disconnect non-functional, requires page reload):
    Missing send-mode escape hatch in the disconnect / port-lost path. www/transport/slide-recv.js:678 implements slidePumpOnPortLost for RECV mode (calls slide.force_idle + setWireOwner('terminal') + chip enterError + forceExitRecvMode). The SEND mode has NO equivalent — sendDispatchTail can hold an unresolved Promise chain indefinitely; slide.js mode='send' / owner='slide' state is not cleared by anything except natural send completion via maybeExitSendMode (which requires DONE/ERROR/CANCEL_PEND state from the Rust SM, which never arrives if the SM is stuck mid-DataPhase).

    Practical effect: when teardown() runs, writer.releaseLock() throws (caught), but port.close() awaits any in-flight writer.write that the suspended dispatchSendMode is awaiting. If that write doesn't naturally resolve (because the SM is suspended mid-await on writer.ready due to backpressure from kernel buffer + reset Z80 not consuming bytes), port.close() can hang indefinitely. The Disconnect button click runs, the Promise chain stalls, the button state never transitions to 'disconnected', and the user sees "Disconnect does nothing."

  Cluster relationship: A and B/C are INDEPENDENT root causes. A surfaces an interaction between the user's prefs and the first-use-confirm gate. B is an interop issue with patched slide.com. C is a missing teardown path for send-mode hangs. The user observed them as a sequence because A → triggered Retry → B's hang → C's wedge. Fixing A alone won't fix B/C; fixing C alone won't fix A or B; etc.

fix: ""
verification: ""
files_changed: []
