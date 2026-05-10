---
status: resolved
trigger: "Phase 12 UAT Test 12 Gap D — after clicking [Force start] in Compatibility-mode 'Wakeup-required' against a target that does NOT speak SLIDE (e.g. running B:OLDSLIDE.COM, a legacy slide.com without ESC^SLIDE wakeup), Plan 12-07's enterActive() call transitions the chip to the active 'sending file' state. But the chip then pins indefinitely and the [Cancel] button on the active-state chip does NOT work — clicking it has no observable effect. User reports 'I can't get rid of it' — only a page reload recovers. Re-confirmed 2026-05-10 after Gap C/B fix landed: 'the \"Force restart\" still fails, and I still can't click \"Cancel\" on the file transfer progress.'"
created: 2026-05-10T20:50:00Z
updated: 2026-05-10T21:30:00Z
---

## Current Focus

hypothesis: |
  ROOT CAUSE FOUND. The active-state chip's [Cancel] click takes TWO branches
  inside the chip's handleInlineAction (slide-chip.js:312-352), both of which
  no-op when the active state was reached through send-mode (force-start OR
  normal wakeup-completion):

    Branch 1 — onCancelFn() callback (slide-chip.js:314):
      Wired in main.js:481 to `cancelSlideRecvLazy()` →
      `cancelSlideRecv()` (slide-recv.js:595). The very first guard at
      slide-recv.js:597 is `if (!isSlideActive()) return;`. isSlideActive
      reads slide-recv.js's module-local `slideRef`, which is set ONLY by
      `setSlideRef(slide)` from `enterRecvMode` in slide.js (line ~unknown
      — recv-mode entry). The send-mode entry path
      (`enterSendModeInternal` slide.js:1131-1157) NEVER calls setSlideRef.
      So in send mode, slide-recv.js's slideRef is still null, isSlideActive
      returns false, and cancelSlideRecv returns immediately. NO CTRL_CAN
      pushed. NO state machine reset. NO chip hide.

    Branch 2 — stateChangeObservers fan-out (slide-chip.js:349-351):
      Routes to `handleChipInlineAction('cancel')` in slide.js:424-446.
      That handler reads chipState.lifecycle and ONLY clears
      pendingSendSession + calls slideChipRef.hide() when lifecycle is
      'awaiting-wakeup' OR 'awaiting-timeout'. The `else` branch is a
      comment that says "Active sessions: chip's onCancel callback handles
      via cancelSlideRecv (5-step ADR-003 state machine)" — but the chip's
      onCancel callback is wired to recv-side cancel ONLY, see Branch 1.
      Active-with-send-mode falls through to a return with NOTHING done.

  Net effect: both branches no-op when the chip is in 'active' lifecycle
  during a SEND-direction session. The chip remains visible. The send-side
  Slide instance keeps trying to drive a send to a non-listening peer.
  Only a page reload recovers.

  Important scope expansion: this bug is NOT specific to force-start. It
  affects ALL send-mode active-chip cancels — including those reached via
  normal ESC^SLIDE wakeup-completion (slide.js:601-602 calls
  enterSendModeInternal too). Force-start just made it observable in UAT
  because in normal wakeup-completion the user typically lets the transfer
  complete rather than clicking Cancel. The user's "broken from force-start
  only" framing is a reproduction artifact, not a fundamental scope limit.

next_action: "Implement fix: (1) add a `cancelSlideSend` export in slide.js that calls slide.cancel() (the Rust state.rs:382 boundary already pushes CTRL_CAN and transitions to CancelPending), drains outbound, calls force_idle() as escape-hatch parallel to cancelSlideRecv's structure, then exitSendMode-equivalent (setWireOwner('terminal') + clear currentSendCtx + hide chip + clear pendingSendSession). (2) update main.js:481 onCancel to dispatch to cancelSlideSend OR cancelSlideRecvLazy based on slide.js mode. (3) update slide.js handleChipInlineAction case 'cancel' to additionally handle lifecycle === 'active' (defensive — chip's onCancel callback should be the primary path now). (4) add regression test in slide-compatibility.spec.js extending the [Force start] assertion to drive [Cancel] post-active-transition and assert chip hidden + send mode cleanly exits. (5) optional belt-and-braces: also add a recv-mode + send-mode cancel parity test in slide-chip.spec.js so the existing recv-only test gains a send-mode sibling. Atomic commits per Plan 12-07 shape (one fix commit + one test commit, OR one combined commit if test is bundled with fix). Commit policy: NO AI attribution."

## Symptoms

expected: "After clicking [Force start] on the awaiting-timeout chip and the chip transitioning to active state (Plan 12-07's verified fix), clicking [Cancel] on the active-state chip dismisses the chip, aborts the in-flight transfer (writes CTRL_CAN to wire if there's a peer), and returns Beastty to terminal mode."

actual: "After Force-start → chip enters active state → [Cancel] click has no observable effect. Chip stays visible. User must reload the page to recover. Repeats deterministically: 'If I repeat the process, exactly the same result.'"

errors: "[no console errors reported by user — silent dead-button defeat]"

reproduction: |
  1) Hard-reload Beastty (Ctrl+Shift+R) and connect to MicroBeast.
  2) Set Settings → SLIDE → Compatibility mode = "Wakeup required".
  3) Settings → SLIDE → Auto-send command = anything that runs on Z80 but DOES NOT emit ESC^SLIDE wakeup. Easiest: 'B:OLDSLIDE r' if user has the legacy program; otherwise any non-existent CP/M command works (e.g. 'B:NONEXIST r') — Z80 will print 'NONEXIST?' and prompt-back, no wakeup byte.
  4) Drop a file onto the canvas.
  5) Click Confirm on first-use-confirm chip if surfaced.
  6) Wait for the 3-second WAKEUP_TIMEOUT — chip shows [Retry] [Cancel] [Force start].
  7) Click [Force start]. Chip transitions to active 'sending file' state (Plan 12-07's enterActive() fires).
  8) Click [Cancel] on the active-state chip — NOTHING HAPPENS. Chip stays visible. No wire activity (probably). Cannot proceed.

started: "Surfaced 2026-05-10 during Phase 12 UAT (test 12). Likely latent since Plan 12-07 introduced the enterActive() call from case 'force-start' (commit 68a1c27). Plan 12-07 added a chip-lifecycle assertion ('lifecycle === active') but no test for the [Cancel] inline-action AFTER the force-start enterActive() — only the awaiting-timeout-state Cancel was tested. The bug is in fact older — Plan 11-04 wired onCancel = cancelSlideRecv with no send-mode counterpart, so the same dead-button defect existed for normal wakeup-completion since Phase 11; UAT just never exercised it because real transfers complete before the user clicks Cancel."

## Eliminated

- Hypothesis (a) "wire-side state in some half-set cancellation-resistant
  state": ELIMINATED. The wire and Slide instance are in a perfectly
  serviceable state — Slide is in WaitingRdy or DataPhase as appropriate;
  slide.cancel() (Rust state.rs:382) would push CTRL_CAN cleanly. The
  problem is upstream — the JS cancel pathway never reaches slide.cancel()
  at all.

- Hypothesis (b) "dispatcher Promise hasn't resolved/rejected so cancel
  signal has nowhere to go": ELIMINATED. There is no dispatcher Promise
  involved in the cancel path. The chip's onCancel is a synchronous
  function call to cancelSlideRecv. The bug is structural: the wrong
  function (recv-side cancel) is called for send-side state.

## Evidence

- timestamp: 2026-05-10T20:50:00Z
  checked: ".planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-UAT.md (Gap D)"
  found: "Gap D notes that test 14 the user did successfully click [Cancel] on the awaiting-wakeup-Confirm chip ('I click cancel. If I repeat the process, exactly the same result'). So the [Cancel] inline-action handler on the awaiting-* state DOES work — the failure is specific to the active state reached via the force-start enterActive() path."
  implication: "Bug is scoped to: chip lifecycle = 'active' AND state was reached via force-start (not via normal wakeup-completion). The cancel inline-action handler on the active-state chip in this specific entry path is broken."

- timestamp: 2026-05-10T20:50:00Z
  checked: ".planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-07-SUMMARY.md test coverage"
  found: "Plan 12-07 added a regression test asserting `lifecycle === 'active'` after [Force start] click in slide-compatibility.spec.js — but no follow-up assertion on what happens when [Cancel] is clicked AFTER that transition. The test scope was 'click jumps directly into send mode without waiting for wakeup', not 'and cancel still works from there'."
  implication: "Test coverage gap. Worth adding a regression that drives [Cancel] on the post-force-start active chip and asserts dismissal."

- timestamp: 2026-05-10T21:25:00Z
  checked: "www/transport/slide.js:367-448 handleChipInlineAction"
  found: "case 'cancel' branch only acts when chip lifecycle is 'awaiting-wakeup' OR 'awaiting-timeout' (line 435). For 'active' lifecycle the code falls through to a comment 'Active sessions: chip's onCancel callback handles via cancelSlideRecv (5-step ADR-003 state machine)' followed by `return` (line 443-445). No hide(), no clearing of pendingSendSession, no slide.cancel() call."
  implication: "When the chip is in 'active' lifecycle, this branch is a no-op. The contract assumption is that onCancelFn (wired in main.js) handles active sessions — but that wiring goes to cancelSlideRecv only."

- timestamp: 2026-05-10T21:26:00Z
  checked: "www/main.js:475-481 wireSlideChip onCancel wiring"
  found: "onCancel: () => cancelSlideRecvLazy(). cancelSlideRecvLazy is reassigned to the imported cancelSlideRecv after wireSlideRecv runs (line 548). There is NO send-side cancel symbol — no cancelSlideSend export anywhere in the codebase (verified via grep over www/)."
  implication: "The chip's onCancel is hard-wired to recv-side cancel only. Any active session reached via send-mode entry has no working cancel path."

- timestamp: 2026-05-10T21:27:00Z
  checked: "www/transport/slide-recv.js:595-636 cancelSlideRecv body"
  found: "Line 597: `if (!isSlideActive()) return;` — early exit when no recv session is active. isSlideActive (line 357-365) reads the module-local slideRef, which is populated only by setSlideRef (line 342-344). setSlideRef is called only from enterRecvMode in slide.js, never from enterSendModeInternal. Therefore in send mode, slide-recv.js sees slideRef === null, isSlideActive → false, cancelSlideRecv → no-op."
  implication: "Even if the chip's onCancel WAS the right path semantically, the recv-side cancel function refuses to act on a send-direction session. The architectural separation between recv-side state (slide-recv.js) and send-side state (slide.js) means the recv-side cancel function genuinely has no view of the send-side Slide instance to cancel."

- timestamp: 2026-05-10T21:28:00Z
  checked: "www/transport/slide.js:1131-1157 enterSendModeInternal — does it call setSlideRef?"
  found: "No. enterSendModeInternal creates a fresh Slide via SlideCtor() and assigns it to module-local `slide` in slide.js. It calls `txSinkRef.setWireOwner('slide')` and `slide.enter_send_mode(metadata)` but never `setSlideRef(slide)` to expose the instance to slide-recv.js. By design — the send-side state machine is owned by slide.js, not slide-recv.js."
  implication: "Confirms the architectural split. The fix must add a SEND-SIDE cancel symbol in slide.js that operates on slide.js's `slide` reference, mirroring the structure of cancelSlideRecv but tracking send-mode lifecycle (currentSendCtx + mode='send' + setWireOwner('terminal')). The chip onCancel wiring in main.js then needs to dispatch to send-or-recv based on slide.js's mode."

- timestamp: 2026-05-10T21:29:00Z
  checked: "www/transport/slide.js:601-622 normal wakeup-completion path"
  found: "On ESC^SLIDE wakeup match with pendingSendSession set (the normal Compatibility-mode='Auto' / 'Force-start' path with a real SLIDE-speaking peer), slide.js calls `enterSendModeInternal(pendingSendSession)` followed by `slideChipRef.enterActive()` — exactly the same code as the force-start chip-action handler at lines 411-422."
  implication: "The dead-Cancel bug is NOT scoped to force-start. Any send-direction session — including those entered via normal wakeup-completion — has the same broken Cancel button on the active chip. UAT just never exercised it because real transfers complete before the user thinks to cancel. The fix must cover BOTH entry points (single fix in cancel pathway covers both)."

- timestamp: 2026-05-10T21:30:00Z
  checked: "crates/beastty-core/src/slide/state.rs:382-398 Rust cancel()/force_idle()"
  found: "slide.cancel() is direction-agnostic — pushes CTRL_CAN to outbound_buf and transitions to CancelPending. Idempotent (early returns on CancelPending/Done/Error). slide.force_idle() is the 2 s escape hatch — sets state to Done and clears outbound_buf. Both work fine for send-direction sessions."
  implication: "Zero Rust changes needed. The fix is pure JS: add a send-side wrapper that calls slide.cancel() + drains outbound + waits for echo + force_idle on timeout, mirroring slide-recv.js:cancelSlideRecv structure. Phase 12 zero-Rust invariant preserved."

- timestamp: 2026-05-10T21:30:00Z
  checked: "www/tests/transport/slide-chip.spec.js test('inline [Cancel] click hands off to cancelSlideRecv')"
  found: "Existing test at line 137-163 enters the chip 'active' lifecycle via enterMidStream — which uses window.__mockSlideBot.queueSendFiles + pushSlideHostWakeup, putting Beastty into RECV mode (mode === 'recv', line 70-72 verifies this). The test then asserts CTRL_CAN appears on the wire after [Cancel] click. There is NO equivalent test for active-state cancel during SEND mode."
  implication: "Test coverage gap is broader than just slide-compatibility.spec.js. The active-state cancel path was tested only for recv direction. A new send-mode active-state cancel test (or extending the existing slide-compatibility.spec.js [Force start] test) closes the gap."

## Resolution

root_cause: |
  The active-state chip's [Cancel] button has no working handler when the
  chip is in send-direction. The chip emits cancel through TWO paths and
  BOTH no-op for send mode:

    1. onCancelFn callback → main.js wires to cancelSlideRecvLazy →
       cancelSlideRecv (slide-recv.js:595) → first guard `if
       (!isSlideActive()) return;` exits because slide-recv.js's slideRef
       is null in send mode (only set by enterRecvMode, never by
       enterSendModeInternal).

    2. stateChangeObservers fan-out → slide.js handleChipInlineAction case
       'cancel' (line 424-446) → only acts when chip lifecycle is
       'awaiting-wakeup' OR 'awaiting-timeout'; falls through to bare
       `return` for 'active' lifecycle, expecting onCancelFn to handle it
       (which it doesn't, see #1).

  This dead-Cancel defect is NOT scoped to force-start — it equally
  affects active sessions reached via normal ESC^SLIDE wakeup-completion.
  Plan 11-04 introduced the asymmetry when it wired onCancel to
  cancelSlideRecv only, with no send-mode counterpart. UAT failed to
  catch it because typical transfers complete before the user clicks
  Cancel; force-start (against a non-SLIDE peer) is the first scenario
  that strands the user in send-mode active without progress.

fix: |
  Add a send-side cancel path in slide.js, parallel to slide-recv.js's
  cancelSlideRecv:

    Step 1 — Export `cancelSlideSend()` from slide.js. Body mirrors
      cancelSlideRecv's 5-step shape adapted for send:

      a. Guard: `if (mode !== 'send' || !slide) return;` — analogous to
         isSlideActive() check.
      b. Idempotency: `if (cancelSendInFlight) return; cancelSendInFlight = true;`
         (new module-scope flag).
      c. Absolute timeout (2 s setTimeout) → force_idle + cleanup +
         clearCancelSendInFlight, mirroring CANCEL_ABSOLUTE_TIMEOUT_MS.
      d. Step body:
         - `slide.cancel()` — Rust pushes CTRL_CAN, transitions to
           CancelPending.
         - Drain outbound (reuse drainSlideOutboundAwaitable — it already
           awaits per-frame writes through writeSlideFrameAwaitable).
         - Wait up to 500 ms for state === Done (Z80 echo). Reuse
           waitForState pattern from slide-recv.js (or duplicate inline).
         - Drain 100 ms post-echo (delay).
         - If !echoArrived: `slide.force_idle()`.
         - clearTimeout(absoluteTimeout).
         - exitSendMode() (existing function — flips wire owner to
           terminal, clears currentSendCtx, fires enterSummary). NOTE:
           exitSendMode currently fires enterSummary which advertises the
           transfer as 'sent' — for a cancel we want enterCancelledSummary
           instead. Plumb a `direction: 'cancelled'` or skip the summary
           and fire enterCancelledSummary directly.
         - In cleanup, also clear pendingSendSession defensively.
      e. finally: `cancelSendInFlight = false;`.

    Step 2 — main.js: change onCancel from
        `() => cancelSlideRecvLazy()`
      to a dispatcher:
        `() => { if (slideMode() === 'send') cancelSlideSendLazy();
                  else cancelSlideRecvLazy(); }`
      where slideMode() is a thin getter exposed from slide.js (already
      partially exposed via __getStateForTests().mode — promote a
      minimal `getMode()` export). cancelSlideSendLazy is the thunk-holder
      pattern mirroring cancelSlideRecvLazy: declared as no-op early,
      reassigned after wireSlideDispatcher.

    Step 3 — slide.js handleChipInlineAction case 'cancel': add a
      `lc === 'active'` branch that calls cancelSlideSend() directly
      (defensive parity with the wakeup-* states clearing
      pendingSendSession). NOTE: with the main.js onCancel dispatcher
      fix in Step 2, the chip's onCancelFn already calls cancelSlideSend
      first, so this stateChangeObservers fan-out branch becomes a
      backup. Either implement it or document the no-op as intentional.

    Step 4 — Tests:
      - Extend slide-compatibility.spec.js force-start test: after
        asserting lifecycle === 'active', click [Cancel] and assert
        (a) chip hidden, (b) CTRL_CAN (0x18) appears on the wire,
        (c) mode flips back to 'terminal', (d) pendingSendSession null.
      - Add slide-chip.spec.js test: send-mode active-state cancel
        parity (mirror the existing recv-mode cancel test using a
        send-direction harness — drop a file, let mock bot reply with
        ESC^SLIDE so Beastty enters send mode, then drive [Cancel]).

    Atomic commits per Plan 12-07 shape:
      - Commit 1: fix (cancelSlideSend export, main.js dispatcher,
        handleChipInlineAction defensive branch).
      - Commit 2: tests (slide-compatibility.spec.js extension +
        slide-chip.spec.js send-mode parity test).
    OR combined into one commit if user prefers single-commit mirror of
    the Gap C/B fix (commit 153aaed).

    Commit policy: NO AI attribution.

verified_by: "Pending — fix not yet applied. After fix lands, verification path: (1) extended Playwright slide-compatibility.spec.js test passes (CTRL_CAN on wire, chip hidden, mode === 'terminal' post-cancel from force-start active state), (2) new slide-chip.spec.js send-mode-cancel test passes, (3) all existing slide-recv cancel tests still pass (no regression in recv direction), (4) manual UAT re-run of Test 12 with B:OLDSLIDE.COM target confirms [Cancel] now dismisses the active chip post-force-start."

## Related

- gap-A (test 7): validation-hint sub-row never paints — separate diagnosis target. Not addressed.
- gap-C (test 12 stale auto-send): RESOLVED in commit 153aaed.
- gap-B (test 8 first-use-confirm chip skipped): RESOLVED in commit 153aaed.
- Plan 11-04 SLIDE-39 chip lifecycle wiring: this is the plan that introduced the onCancel = cancelSlideRecv-only asymmetry. The fix here closes the unwritten Plan 11-04 corner case.
