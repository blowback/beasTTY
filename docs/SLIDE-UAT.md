---
status: pending
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-CONTEXT.md, 12-RESEARCH.md, 12-UI-SPEC.md]
started: 2026-05-08
updated: 2026-07-24
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

## Pull pane — drag to pull (E9 S9.3)

### UAT-E9-01: Drag a terminal selection onto the pull pane (FR-4/6/8)

**expected:** Drag-selecting filenames on the terminal canvas and dropping
them on the pull pane opens the in-pane review with the composed
`SLIDE S <names>` command; confirming types the command to the MicroBeast,
SLIDE sends the files, and they appear in the bound local folder with
fresh markers — one gesture, end to end.

**steps:**
1. Bind a local folder in the pull pane (Choose folder…) and connect to
   the MicroBeast.
2. At the CP/M prompt, run `DIR` (or otherwise get filenames on screen).
   Columnar DIR output is understood: `VPEEK    COM` composes as
   `VPEEK.COM`, and drive prefixes (`A:`) / lone `:` column separators
   are dropped. Dot-joined names from SLIDE's own transfer log/prompt
   echo work as before.
3. Drag-select one or more 8.3 names — columnar
   (`VLOAD    COM : VPEEK    COM`) or dot-joined (`GAME.COM DUMP.BIN`) —
   then press inside the highlighted selection and
   drag it onto the pull pane. Verify: the native drag initiates (no
   80×24 canvas-screenshot ghost under the cursor), the pane border
   accents, and the footer reads "⤓ Drop to pull N files".
4. Drop. Verify the review opens with the composed command and per-name
   ✓/✗ rows. Confirm with [Pull N files].
5. Watch the SLIDE transfer run; verify each file lands in the bound
   folder and the pane list refreshes with fresh markers at the top.
6. In a narrow window (pane collapsed to the rail): repeat the drag —
   verify the rail blooms the card open mid-drag without the canvas
   moving, and rail click also blooms.

**Hardware checks (deferred from S9.2/S9.3 — answers recorded 2026-07-24):**
- (a) **Separator:** ANSWERED — space-separated `SLIDE S FILE1 FILE2 …`
  works against Z80 SLIDE v0.5.x; multi-file batch pulls (up to the
  11-name cap boundary) transferred end-to-end. No comma change needed.
- (b) **`B:` prefix:** ANSWERED — bare `SLIDE S …` resolves from both
  `B>` and `A>` prompts (verified `A>slide s slide.com`, lowercase CCP
  input included). No prefix change needed.
- (c) **Line-length limit:** ANSWERED — a composed 126-char command
  (exactly at the cap: 11 names) was accepted by the CCP and the
  transfer ran.

**result:** pass (2026-07-24, real MicroBeast + Z80 SLIDE v0.5.2). The
full chain works: drag-select (incl. columnar `DIR` output → dot-joined
names), native drag origination (no canvas-screenshot ghost), pane
affordance + rail bloom, review → confirm → transfer → files land in
the bound folder with fresh markers. UAT surfaced five Beastty receiver
interop bugs against v0.5.2, all fixed + replay-tested in commit
b63217d (wakeup-signature-in-payload false re-entry, window-retransmit
intolerance, EOF-after-gap short file, boundary+EOF double-ACK stray
`^D`, chip file counters). Optional Z80-side hardening noted for the
upstream repo: `uart_flush_rx` before `send_fin` guards against control
residue on noisy-line recovery paths.

## Pull pane — reverse drag to send (E9 S9.4)

### UAT-E9-02: Drag a pane file onto the terminal to send it (FR-12)

**expected:** Dragging a file row out of the pull pane and dropping it on
the terminal sends it to the MicroBeast through file-source's send
path — drop overlay, confirm modal, auto-typed `B:SLIDE R`, wakeup,
transfer. Both transfer directions now live in-app.

*(Design note: the sanctioned `sendFiles()` fallback IS the shipped
design — the first manual checkpoint (2026-07-24) showed Chromium's
real drag loop strips a JS-constructed File from the drag data store
(it degrades to a text/plain filename), so the pane keeps the native
drag gesture and hands the stashed File to file-source's send path
directly at drop-over-wrapper. The drag→overlay→drop→modal chain has
since been re-verified through the real drag loop in instrumented
runs; this UAT's remaining job is the on-hardware transfer.)*

**steps:**
1. Bind a local folder in the pull pane (Choose folder…) with at least
   two files listed (e.g. `GAME.COM`, `DUMP.BIN`), and connect to the
   MicroBeast.
2. Press on a file's row and drag toward the terminal. Verify: the
   native drag initiates with the row itself as the drag ghost (small —
   not a screenshot of a large surface), and the cursor shows a grab
   affordance at rest over rows.
3. Drag over the terminal. Verify the existing drop overlay appears
   ("Drop file(s) to send via SLIDE").
4. Drop. Verify the send confirm modal opens listing exactly 1 file
   with the correct name.
5. Confirm the send. Watch the auto-typed `B:SLIDE R` + wakeup +
   transfer, then run `DIR` on the MicroBeast and verify the file
   landed on the device — the transferred bytes must be the file's
   real content (run it, or compare sizes), not just its name.
6. Multi-select (extension, 2026-07-24): click one row, ctrl-click a
   second (rows show the accent tint + inset line; shift-click ranges;
   clicking empty list space clears). Drag either selected row onto
   the terminal — the confirm modal must list BOTH files — confirm and
   verify both land on the device. Also check: dragging a row that is
   NOT part of the selection reselects to just that row and sends it
   alone.
6. Suspension: start a transfer (either direction), then try to drag a
   row mid-transfer — the drag must not start. Drop an OS file on the
   terminal during the same transfer — the chip flashes "Transfer in
   progress — cancel first" and refuses (unchanged S9.3-era belt).
7. Focus: after a drag that ends without a drop (release over the pane
   or press Esc), verify keystrokes still reach the Z80 (dragend
   restores `#terminal-wrapper` focus).
8. (Reads-oddly check, narrow window) Drag a row out of a bloomed card:
   the bloom staying up after the drop is expected — the next
   pointerdown outside the pane dismisses it. Note here if it feels
   wrong in practice.

**result:** pass (2026-07-24, real MicroBeast + Z80 SLIDE v0.5.2).
Single-file reverse drag confirmed first ("works great" — drag,
overlay, modal, transfer, lands on device), then multi-select drag
confirmed with the 19 KB + 24 KB pair after the UAT-E9-03 sender
fixes: both files land in one session at wire speed. Steps 6-8
(suspension chip-flash, focus-after-inert-drag, bloom edge) not
explicitly walked on hardware — all are spec-covered; note anything
odd during daily driving.

### UAT-E9-03: Multi-file send — wire-chunking interop retest

**context:** Multi-file reverse-drag on hardware (2026-07-24,
bbcbasic.com 19 KB + mbasic.com 24 KB) failed after file 1 with
"Transfer cancelled by peer" — twice, surviving the first fix round.
Full diagnosis (from reading Z80 slide.asm v0.5.2 + slide-py and
byte-exact synthetic reproduction), three defects fixed:
1. **The sender pumped ONE frame per received ACK, but slide.asm ACKs
   only once per 4-frame window** — every send ever made limped on the
   Z80's retry-timeout NAKs (one frame per ~660 ms NAK, ~4-5× slow)
   and flooded the wire with control pairs. The pump now sends full
   window-aligned bursts (slide-py's behavior; the Z80's disk-flush
   deaf windows always sit just before its window ACK, so this is
   timing-safe by construction).
2. A control pair (ACK/NAK + seq) split across serial chunks desynced
   the byte classifier; with NAK spam and a ≥24 KB file, a seq byte of
   24 (0x18 = CTRL_CAN) then read as a cancel and Beastty's mandatory
   cancel echo delivered a real CAN to the Z80 — hence "cancelled by
   peer", and only for the 24 KB file (the 19 KB file's seqs stop at
   21). Fixed with a cross-chunk seq carry.
3. Esc now cancels SEND sessions too (was recv-only — the wedge had no
   keyboard escape).

**steps:**
0. **Hard-reload Beastty first (Ctrl+Shift+R)** — module scripts cache
   heuristically off the plain static server; a soft reload can retest
   the old code.
1. Bind a folder containing two files, at least one ≥ 24 KB; connect.
2. Multi-select both (ctrl-click) and drag onto the terminal; confirm
   the 2-file send modal.
3. Verify BOTH files transfer in one session: two "Transfer complete!"
   prints, then "Session complete." and a clean `B>`; `DIR` shows both
   files with correct sizes; chip closes with the sent summary.
   **Speed is the tell that the new sender is running:** ~19 KB should
   move in roughly 11 s of wire time at 19200, not ~40 s (the old
   one-frame-per-ACK sender crawled on the Z80's retry NAKs).
4. Esc check: start another multi-file send, press Esc mid-transfer —
   the Z80 prints "Transfer cancelled by peer" and returns to `B>`, and
   the chip closes (no stuck chip).

**result:** pass (2026-07-24, real MicroBeast + Z80 SLIDE v0.5.2, after
the round-2 window-pump fix). The failing 19 KB + 24 KB pair now
transfers end-to-end in one session, and noticeably faster ("much
nippier" — the retry-NAK crutch is gone, so ALL sends including OS
drags now run at wire speed). Step 4 (Esc mid-transfer cancel) is
covered by synthetic spec but was not explicitly exercised on hardware
this run — worth a one-off press next time a send is up.

## Summary

total: 7
passed: 3
issues: 0
pending: 3
skipped: 0
blocked: 1

## Sign-off

- Tester:
- Date:
- Pass count: 0/7
- Notes:

## Gaps

(None at scaffold time. Gaps section is filled by the human tester
after running the UAT.)
