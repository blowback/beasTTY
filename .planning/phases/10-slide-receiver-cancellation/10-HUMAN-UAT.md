---
status: partial
phase: 10-slide-receiver-cancellation
source: [10-VALIDATION.md, 10-CONTEXT.md, 10-UI-SPEC.md, 10-RESEARCH.md]
started: 2026-05-08
updated: 2026-05-08
---

# Phase 10 — Daily-Driver Human UAT

These tests close ROADMAP Phase 10 success criteria from the daily-driver
perspective. Each one exercises a flow that automated Playwright tests
cannot fully replicate: real-hardware Z80 cancel echo timing, browser
FileSystemDirectoryHandle persistence across actual restart, Chrome's
multi-download throttle threshold under realistic load, and the 1 MB+
qualitative UX feel.

This document is OUT-OF-BAND. `/gsd-verify-phase 10` does NOT block on
these tests; the developer runs them on their schedule and updates the
result lines below post-run.

## Setup

- Fresh Chromium tab; localhost dev server running (`scripts/dev.sh`).
- DevTools open; clear console.
- (Optional but recommended) MicroBeast hardware connected for the
  real-hardware UAT-10-01 + UAT-10-05 (SLIDE-27 cancel echo + UAT-10-06
  multi-file). Mock-bot suffices for UAT-10-02, UAT-10-03, UAT-10-04.

## Tests

### UAT-10-01: Real-hardware Z80 cancel echo timing (SLIDE-27)

**expected:** Pressing Esc mid-recv on a real MicroBeast Z80 produces a
visible canvas-unfreeze within 2 s, the wire returns to a clean CP/M
prompt with no error glyphs, and the Z80 SLIDE sender side actually
honours the CTRL_CAN echo (i.e. `B:SLIDE S FILE.TXT` aborts cleanly
rather than hanging the Z80).
**steps:**
1. Connect to MicroBeast at 19200 8N1.
2. From the MicroBeast prompt, run `B:SLIDE S BIGFILE.BIN` (a file
   ≥ 8 KB so the cancel lands mid-data-window, not at EOF).
3. As soon as the canvas shows the recv chip + first data frame
   indicator, press Esc.
4. Observe: canvas should unfreeze within 2 s; the recv chip clears;
   prompt returns to CP/M `B>`; no console errors.
5. Run `B:SLIDE S BIGFILE.BIN` a second time — confirm Z80 side is not
   stuck (it must accept the new send command immediately).
**result:** blocked (Z80 SLIDE.COM does not yet implement the v0.2.1 ADR-003 ESC^SLIDE wakeup + CTRL_CAN echo amendment; PR to github.com/blowback/slide is a Phase 12 deliverable per REQUIREMENTS.md SLIDE-40. Re-run after the patched slide.asm lands.)

### UAT-10-02: FileSystemDirectoryHandle persistence across browser restart

**expected:** Picking a folder via `Choose folder…` once, fully closing
the Chromium browser (not just reload — full Quit + relaunch), and
reopening BestialiTTY shows Chrome's persistent-permission re-prompt
dialog (one-click Allow), then state-string returns to
`Saving to: {folder name}` without re-picking.
**steps:**
1. Open Settings → expand `Save received files to a folder` row.
2. Toggle on. Click `Choose folder…`. Pick `~/Downloads/MicroBeast`.
3. Verify state-string is `Saving to: MicroBeast`.
4. Quit Chromium fully (Cmd+Q on macOS; Alt+F4 + ensure no windows
   remain on Linux/Windows).
5. Relaunch Chromium. Open BestialiTTY.
6. Observe: Chrome's persistent-permission dialog should appear with
   one-click Allow option (Chrome 122+ behaviour).
7. Click Allow. Open Settings → verify state-string is
   `Saving to: MicroBeast` (no re-pick required).
8. Edge case: in step 6, click Block instead. Verify state-string
   becomes `⚠ Permission needed for MicroBeast` and button label is
   `Re-allow folder…`.
**result:** pass/fail (TBD)

### UAT-10-03: Settings toggle visual feel (locked copy + state machine)

**expected:** All four state-strings + three button labels render
verbatim per 10-UI-SPEC.md §"Copywriting Contract"; transitions feel
crisp, not laggy.
**steps:**
1. Expand Settings; locate `Save received files to a folder` row.
2. State (a) — toggle off: verify status is `No folder selected`,
   button is dimmed (disabled).
3. Toggle on. State (b): verify status is
   `⚠ Pick a folder before next transfer` (U+26A0 bare, NOT U+FE0F
   variant), button is `Choose folder…` (with U+2026 ellipsis).
4. Click `Choose folder…`. Pick any folder. State (c): verify status
   is `Saving to: {folder name}`, button is `Change folder…`.
5. Toggle off. State (a): verify status returns to
   `No folder selected`, button dimmed. (Handle is preserved
   internally — toggling back on jumps straight to state c.)
6. Toggle on. Verify status is `Saving to: {folder name}` (state c —
   handle preserved across toggle, NOT re-prompted).
**result:** pass/fail (TBD)

### UAT-10-04: Toggle off keeps handle (no re-pick on re-toggle)

**expected:** With a folder picked (state c), toggling off then on
again does NOT re-prompt for showDirectoryPicker; the previously
chosen folder is preserved and state c is restored automatically.
**steps:**
1. Toggle on + pick `~/Downloads/MicroBeast`. Verify state c.
2. Toggle off. Verify state a.
3. Toggle on. Verify state c (NOT state b — no re-pick).
4. Drive a recv via mock-bot or real Z80; verify the file lands in
   `~/Downloads/MicroBeast` (the previously chosen folder).
**result:** pass/fail (TBD)

### UAT-10-05: Multi-download Chrome throttle threshold (SLIDE-19 anchor-click)

**expected:** Driving a multi-file batch (≥ 5 files) via the
anchor-click path (toggle off) does NOT trigger Chrome's multi-download
throttle dialog (`Allow this site to download multiple files?`). The
SLIDE-19 250 ms inter-file gap is sufficient for Chrome's heuristic.
**steps:**
1. Toggle the folder option OFF (anchor-click path).
2. Drive a 5-file batch via mock-bot (or real Z80 SLIDE send of 5
   files). Use varied sizes (e.g. 10 B, 1 KB, 1 KB, 100 B, 5 KB).
3. Observe: 5 files appear in the Chrome Downloads tray sequentially,
   each ≥ 250 ms apart. NO permission prompt appears.
4. If Chrome DOES prompt for multi-download permission, mark FAIL and
   note Chrome version; the SLIDE-19 gap may need to be extended.
**result:** pass/fail (TBD)

### UAT-10-06: 1 MB+ daily-driver UX feel (SLIDE-24)

**expected:** Receiving a 1 MB+ file feels responsive: the recv chip
updates progress smoothly, the canvas does NOT freeze for ≥ 100 ms at
any point, and the file lands byte-identical with no truncation.
**steps:**
1. Toggle off (anchor-click) for the cleanest baseline.
2. Drive a 1 MB+ recv. Mock-bot path: at the DevTools console:
   ```js
   const bot = window.__mockSlideBot;
   const big = new Uint8Array(1024 * 1024);
   for (let i = 0; i < big.length; i++) big[i] = i & 0xFF;
   bot.reset();
   bot.setRole('send');
   bot.queueSendFiles([{ name: 'BIG.BIN', bytes: big }]);
   bot.pushSlideHostWakeup();
   setTimeout(() => bot.startSendSession(), 200);
   ```
   Real-hardware path: Z80 sends a 1 MB file via `B:SLIDE S BIG.BIN`.
3. Observe progress chip; confirm it updates at frame boundaries (not
   stuck at 0% then jumps to 100%).
4. After completion, open the downloaded `BIG.BIN`; assert size is
   exactly 1,048,576 bytes; spot-check byte at offset 256 is `0x00`,
   offset 257 is `0x01`, etc. (the modulo-256 ramp from step 2).
5. Subjective: did the canvas remain interactive (cursor blink,
   keystrokes received) throughout the recv? PASS only if yes.
**result:** pass/fail (TBD)

## Summary

total: 6
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 1

## Sign-off

- Tester: __
- Date: __
- Pass count: __ / 6
- Notes: __

## Gaps

(None known — populate post-UAT if any test reveals an unwritten requirement.)
