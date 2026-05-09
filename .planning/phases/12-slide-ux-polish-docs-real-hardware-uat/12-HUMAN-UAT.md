---
status: partial
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-VERIFICATION.md]
started: 2026-05-09T00:00:00Z
updated: 2026-05-09T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Re-run UAT Test 5 — modal default-focus visible border (post Plan 12-06)
expected: After a pointer-initiated drop opens the send modal, the [Send N renamed] default-focus button paints a visible green focus border (border-color = --chrome-accent computed value) — Chromium suppresses :focus-visible on programmatic .focus() following pointer-initiated interaction, but the new [data-focused="true"] CSS rule mitigates this.
result: [pending]

### 2. Re-run UAT Test 7 — auto-send command red border on blurred unsafe value (post Plan 12-06)
expected: With the auto-send command Settings field containing an unsafe value (e.g., contains a control character or fails the safety regex), after blurring the field the input shows a strong red border (rgb(224, 64, 64) = #e04040 = --chrome-invalid-strong). The new bumped-specificity (0,2,2,0) rule wins on specificity ALONE against the focused-input :focus-visible rule (0,2,1,0) — no source-order tiebreak required.
result: [pending]

### 3. UAT-12-01 — multi-file send including binary .COM file (real MicroBeast)
expected: SLIDE round-trip succeeds for a multi-file send batch including at least one binary .COM file. Bytes received on the Z80 side are byte-identical to the source. Live MicroBeast hardware with patched slide.asm required.
result: [pending]

### 4. UAT-12-02 — multi-file recv including zero-byte file (real MicroBeast)
expected: SLIDE recv succeeds for a multi-file batch including at least one zero-byte file. Receiver completes cleanly without state-machine wedge. Live MicroBeast hardware with patched slide.asm required.
result: [pending]

### 5. UAT-12-03 — cancel mid-send (real MicroBeast)
expected: User-initiated cancel during an active send terminates the transfer cleanly on both sides. Subsequent send/recv round-trips work without restart. Live MicroBeast hardware required.
result: [pending]

### 6. UAT-12-04 — cancel mid-recv Z80 echo
expected: Inherits UAT-10-01 blocked-result idiom. Currently BLOCKED on upstream github.com/blowback/slide PR. Mark as `result: blocked` once UAT runs and confirm upstream status.
result: [blocked]

## Summary

total: 6
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 1

## Gaps
