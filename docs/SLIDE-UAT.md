---
status: pending
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-CONTEXT.md, 12-RESEARCH.md, 12-UI-SPEC.md]
started: 2026-05-08
updated: 2026-05-08
---

# SLIDE — Real-hardware UAT (Phase 12 SLIDE-42)

> End-to-end verification of the v1.1 SLIDE FileTransfer milestone against
> a real MicroBeast Z80 with patched slide.com. Mirrors the
> `.planning/phases/10-slide-receiver-cancellation/10-HUMAN-UAT.md` format.
> All four tests are gated on the upstream `github.com/blowback/slide`
> PR landing (see Setup below); UAT-12-04 inherits the UAT-10-01
> blocked-result idiom for the CTRL_CAN echo path until the patched
> slide.asm ships.

## Setup

- Real MicroBeast hardware connected over USB serial (19200 8N1, no flow
  control — MicroBeast preset).
- **Patched `slide.com` from `github.com/blowback/slide`** (post-PR build
  that emits the `ESC ^ S L I D E` wakeup signature and echoes
  `CTRL_CAN`). Pre-PR slide.com will fail UAT-12-01..04 because the
  wakeup detection never fires; for legacy slide.com testing use Beastty
  Settings → SLIDE file transfer → Compatibility mode → "force-start"
  path (covered by `06-HUMAN-UAT.md` daily-driver tests).
- Fresh Chromium tab; localhost dev server running (`scripts/dev.sh` or
  equivalent).
- DevTools open; clear console.
- Beastty Settings:
  - Auto-send command: default `B:SLIDE R\r` (or whichever value is set
    per user preference — see SLIDE-38 first-use-confirm chip if
    non-default).
  - Save received files to folder: at user discretion
    (`showDirectoryPicker` opt-in; tested separately in
    `10-HUMAN-UAT.md` UAT-10-02).

## Tests

### UAT-12-01: Multi-file send including binary .COM (SLIDE-07, SLIDE-13, SLIDE-15, SLIDE-16, SLIDE-36)

**expected:** Beastty sends a 3-file batch (one binary `.COM`, one text
`.TXT`, one with a name that triggers the SLIDE-36 collision modal) to
the MicroBeast Z80. The auto-typed `B:SLIDE R\r` reaches the CP/M
prompt, the wakeup signature is detected, the SLIDE chip transitions
through awaiting-wakeup → active → sent-summary, and all three files
land on the Z80 drive `B:` with byte-identical content (verified via
`B:DIR` listing + a CP/M `TYPE` of the text file). The collision
modal correctly auto-renames the duplicate to `~1.TXT`.

**steps:**
1. Connect to MicroBeast at 19200 8N1.
2. Drag three files onto the Beastty terminal area:
   - `HELLO.COM` (a small CP/M `.COM` binary, e.g. a known-good HELLO
     test program)
   - `README.TXT` (any plain ASCII file)
   - `readme.txt` (a different file with a colliding 8.3 name)
3. Confirm the send modal appears showing the rewrite preview AND the
   SLIDE-36 collision row (`• README.TXT \n  ↳ README.TXT,
   README~1.TXT`).
4. Click `[Send 3 renamed]` (default focus).
5. Watch the SLIDE chip lifecycle: `awaiting-wakeup` → `active` →
   `sent-summary`.
6. After completion, on the Z80: type `B:DIR` and verify the three
   files appear: `HELLO.COM`, `README.TXT`, `README~1.TXT`.
7. Run `B:TYPE README.TXT` and verify content matches the source file.
8. Run `B:HELLO.COM` (if the binary is executable) — confirm it runs
   without CP/M complaints.

**result:** TBD (pending Z80 PR for ESC^SLIDE wakeup; see Setup blocker rationale)

### UAT-12-02: Multi-file recv including zero-byte file (SLIDE-18, SLIDE-19, SLIDE-21, SLIDE-22, SLIDE-23, SLIDE-24)

**expected:** Z80 sends a 3-file batch including (a) a zero-byte file,
(b) a sub-frame file (< 1024 bytes), (c) a 1 MB+ binary file. The
Beastty receiver chip transitions through awaiting-wakeup → active
(showing per-file progress with throughput on the 2 s sliding window) →
received-summary. All three files land in the browser Downloads tray
(or chosen folder if the FSAP toggle is on) with byte-identical
content verified via SHA-256 or `cmp`.

**steps:**
1. On the MicroBeast, prepare three test files on drive `B:`:
   - `EMPTY.TXT` (zero bytes)
   - `SHORT.TXT` (~100 bytes)
   - `BIG.BIN` (~1 MB random binary; can be generated via `B:DUMP` to a
     fixed seed)
2. From the MicroBeast prompt, run `B:SLIDE S EMPTY.TXT SHORT.TXT BIG.BIN`.
3. Watch the SLIDE chip lifecycle on Beastty: `awaiting-wakeup` →
   `active` (file count `1/3`, `2/3`, `3/3`; throughput shows `—` for
   first 2 s then KB/s).
4. After completion, verify the chip transitions to `received-summary`
   for 5 s.
5. Open the browser Downloads tray (or chosen folder); verify three
   files landed with the correct names (uppercase 8.3 form preserved
   per SLIDE-20).
6. Compare each downloaded file SHA-256 against the source on the
   MicroBeast (use `B:CRC` or another known-good hash tool, or
   recompute on the source PC). All three SHA-256 values must match.

**result:** TBD (pending Z80 PR for ESC^SLIDE wakeup; see Setup blocker rationale)

### UAT-12-03: Cancel mid-send (PC-initiated) (SLIDE-27, SLIDE-30)

**expected:** Beastty initiates a send of a multi-MB file; partway
through (after at least one full file has shipped successfully), the
user presses Esc. Beastty emits `CTRL_CAN`, settles in-flight writes
(≤ 200 ms), waits for Z80 echo (≤ 500 ms), drains for 100 ms, and
re-arms the framer. The chip shows `cancelled-summary` for 5 s. The
wire returns to a clean CP/M prompt without requiring a Z80 reset; a
follow-up `B:DIR` runs cleanly.

**steps:**
1. Drag a 5 MB binary file onto Beastty.
2. Click `[Send 1 file]`.
3. After the chip enters `active` state and progress reaches ~30%,
   press Esc.
4. Verify the chip transitions to `cancelled-summary` for 5 s.
5. Verify the SLIDE chip eventually hides; the canvas returns to
   terminal mode.
6. On the Z80, type `B:DIR` and verify the prompt responds normally
   (no hang, no echo of stale data).
7. Verify the partial file was NOT fully written: `B:DIR` shows either
   no file or a 0-byte placeholder.

**result:** TBD (pending Z80 PR for ESC^SLIDE wakeup; see Setup blocker rationale)

### UAT-12-04: Cancel mid-recv with Z80 echo verified (SLIDE-27, SLIDE-29, SLIDE-30, ADR-003)

**expected:** Z80 starts sending a multi-MB file
(`B:SLIDE S BIG.BIN`); partway through, the user presses Esc on the
host. Beastty emits `CTRL_CAN` (raw byte `0x18`); the patched slide.asm
echoes `CTRL_CAN` back within 500 ms (per ADR-003 v0.2.1 amendment);
both sides drain the wire and return to idle. The Beastty chip shows
`cancelled-summary` for 5 s; the Z80 returns to the CP/M prompt
without a hang. A follow-up `B:SLIDE S BIG.BIN` run succeeds without a
Z80 reset.

**steps:**
1. On the MicroBeast, run `B:SLIDE S BIG.BIN`.
2. After the chip enters `active` state and progress reaches ~30%,
   press Esc on the host.
3. Watch the chip lifecycle: `active` → `cancelled-summary` (5 s).
4. Verify the Z80 returns to the CP/M prompt automatically (no hang).
5. On the Z80, run `B:SLIDE S BIG.BIN` AGAIN.
6. Verify the second run completes successfully (no Z80 reset needed,
   no wire desync).

**result:** blocked (Z80 SLIDE.COM does not yet implement the v0.2.1 ADR-003 ESC^SLIDE wakeup + CTRL_CAN echo amendment; PR to github.com/blowback/slide is the gate. Inherits the UAT-10-01 blocked-result idiom; re-run after the patched slide.asm lands.)

## Summary

total: 4
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 1

## Sign-off

- Tester:
- Date:
- Pass count: 0/4
- Notes:

## Gaps

(None at scaffold time. Gaps section is filled by the human tester
after running the UAT.)
