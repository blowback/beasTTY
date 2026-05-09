---
status: partial
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-VERIFICATION.md]
started: 2026-05-09T00:00:00Z
updated: 2026-05-09T01:00:00Z
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
  status: failed
  reason: "User reported: the Force start button does nothing so I can't test it with an old version of slide.com either"
  severity: major
  test: 3
  discovered_during: "UAT-12-01 (multi-file send incl. .COM) — couldn't reach the actual test because the documented escape hatch for unpatched-firmware testing is itself broken"
  scope: "Phase 11 feature surfaced via Phase 12 UAT — the bug predates Phase 12 but blocks Phase 12 hardware verification"
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
  debug_session: ""

- truth: "On a fresh drag-drop send to a MicroBeast running patched slide.com, the auto-send command (e.g. `B:SLIDE r\\r`) is auto-typed onto the wire as the first action of enterSendMode (slide.js readAutoSendCommandBytes → pushTxBytes), so the Z80 enters slide-receive mode before the SLIDE byte stream begins."
  status: failed
  reason: "User reported (with patched slide.com confirmed working standalone): When I initiate a drag and drop file transfer, the B:SLIDE r command is not auto-typed. When I click Retry it *is* autotyped, but then the whole process hangs. Note the auto-send command in user's prefs is `B:SLIDE r` (lowercase r); safety regex /^[A-Za-z0-9: ]*\\r$/ accepts it (verified inline)."
  severity: blocker
  test: 4
  symptoms:
    - "A. Initial drag-drop send: auto-send command NOT auto-typed (no `B:SLIDE r\\r` on wire). Send proceeds but Z80 isn't in receive mode → wakeup never arrives → wakeup-required chip surfaces with [Retry] [Cancel] [Force start] actions."
    - "B. After clicking [Retry], auto-send command IS auto-typed (Retry path goes through enterSendModeInternal which DOES call readAutoSendCommandBytes). But then the whole send process hangs — no progress, no completion, no error."
    - "C. While hung, the TTY/UI is wedged — even after physically resetting the MicroBeast, the [Disconnect] button is non-functional (clicking it does nothing). Only a full page reload + reconnect recovers."
  hypotheses:
    - "Symptom A: enterSendMode may be taking the shouldSurfaceFirstUseConfirm branch (user has set lowercase `B:SLIDE r` so prefs.slideAutoSendCommand !== AUTO_SEND_DEFAULT and slideAutoSendCommandConfirmed !== cmd) — but the chip's first-use-confirm callbacks may be silently dropping or the branch is bypassing the auto-type. Worth checking whether `slideAutoSendCommandConfirmed` is being persisted correctly after a [Confirm] click (Plan 12-06's data-focused changes did not touch this code, but the WR-02 fix in commit 1200af7 added a firstUseConfirmPending sentinel that may interact with this)."
    - "Symptom B: enterSendModeInternal proceeds and pushes auto-send bytes, but a downstream state-machine guard (e.g. waiting for a wakeup that already arrived during the failed first attempt) keeps the dispatcher in awaiting-wakeup forever. The dispatcher's owner flip from 'terminal' → 'slide' may be sticking after the Retry."
    - "Symptom C: pendingSendSession stays non-null even when the dispatcher is wedged → isSessionActive() returns true → terminal click handlers all early-return → Disconnect button click event handler may itself be guarded by 'no active session' or by the same hang-blocked event loop. Could also be that the disconnect path tries to drain a tx queue that is itself stalled."
  artifacts: []   # Filled by diagnosis — likely www/transport/slide.js (state machine), www/main.js (Disconnect wiring), www/state/prefs.js (slideAutoSendCommandConfirmed persistence)
  missing: []     # Filled by diagnosis
  debug_session: ""
  recovery_severity: "blocker — only a page reload regains UI control. No graceful escape via [Cancel], [Disconnect], or even a hard reset of the MicroBeast clears the wedge."
