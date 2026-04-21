# Capture 02: BASIC-80 `LIST` / `RUN` / Syntax Error

**Captured:** 2026-04-21
**Tool:** tio 2.7
**Device:** /dev/ttyUSB0
**Adapter:** Silicon Labs CP2102N USB-to-UART Bridge Controller (VID:PID `10c4:ea60`)
**BASIC version:** BASIC-80 Rev. 5.2 [Apple CP/M Version] (Microsoft, 1980-11-12)

## Serial Parameters

Same as capture-01: 19200 8N1 no flow control. Confirmed on live hardware.

## Workload

At the `A>` prompt:
1. `mbasic` → BASIC-80 loaded; 30579 bytes free; `Ok` prompt
2. Entered:
   ```
   10 FOR I=1 TO 25
   20 PRINT I; " MicroBeast"
   30 NEXT I
   ```
3. `LIST` — echoed the 3-line program
4. `RUN` — 25 lines of `N  MicroBeast` output (forces at least one terminal scroll)
5. `PRINF "OOPS"` — intentional syntax error; BASIC replies `Syntax error`
6. `system` (mistyped variant first, then `SYSTEM`) — BASIC's exit command; back to CP/M `A>`
7. Stopped tio with `Ctrl-T q`

Capture size: 760 bytes.

## CR/LF Convention Observation — DIVERGENCE FROM CAPTURE-01

**BASIC-80 emits CRLF (0x0D 0x0A) at every line ending. CP/M shell (capture-01) emitted LF-only. Same hardware, different convention.**

Count summary:
- LF (0x0A): 55
- CR (0x0D): 58
- CRLF (0D 0A) pairs: 55
- LFCR (0A 0D) pairs: 4 (these are artifacts of consecutive CRLFs in error-print paths)

Representative bytes at the BASIC banner (offset 0x0D):

```
00000000: 0d 0d 0a 41 3e 6d 62 61 73 69 63 0d 0d 0a 3a 0d    ...A>mbasic...:.
00000010: 0a 0d 0a 0d 0a 42 41 53 49 43 2d 38 30 20 52 65    .....BASIC-80 Re
```

Every line terminator is `0x0D 0x0A`. The `0x0D 0x0D 0x0A` at offset 0x00 is user-input echo (local CR) followed by BASIC's own CRLF on the new line.

**Resolution of PARSER-07 (cross-referencing capture-01):**

The MicroBeast emits two distinct CR/LF conventions depending on which program runs:

| Program | Line-ending bytes | Semantic |
|---------|-------------------|----------|
| CP/M shell (banner, DIR, STAT) | `0x0A` (LF only) | LF must reset col AND advance row (full newline) |
| BASIC-80 (MBASIC) | `0x0D 0x0A` (CRLF) | Standard VT52: CR → col 0, LF → row advance |

The Rust parser must work correctly for **both** conventions. The safe default is:

- **`LF (0x0A)` → advance row AND reset column to 0** (the "LF implies CR" override, default `ON`)
- **`CR (0x0D)` → reset column to 0** (standard VT52)

With `lf_implies_cr = true`:
- LF-only (CP/M): works — LF does both effects, column resets as expected.
- CRLF (BASIC): works — CR resets col, then LF advances row and redundantly resets col (no-op since already at 0).

Recommendation for Phase 1 core: default `lf_implies_cr = true` in the Terminal constructor. A runtime toggle (Phase 4 / INPUT-05 territory) can flip it to strict-VT52 mode if a later workload surfaces a program that uses bare LF for "advance row without column reset" (none observed in these two captures).

## Sequence Inventory

**Zero ESC sequences observed.**

- ESC (0x1B): 0
- BEL (0x07): 0
- BS (0x08): 0
- HT (0x09): 0

Even BASIC's RUN with a 25-line loop and visible scroll emits no cursor-positioning sequences. Scroll is implicit (the terminal scrolls when CRLF pushes content past the last visible row). No ESC J, no ESC Y, no ESC I (reverse LF).

Syntax-error handling (`PRINF "OOPS"` → `Syntax error`) is plain text. No BEL, no visual marker.

## Notable Observations

- **BASIC-80 Rev. 5.2 "Apple CP/M Version"** — the MicroBeast's BASIC is the Microsoft port originally written for Apple II CP/M. Relevant because this version's I/O paths may have Apple-specific quirks (e.g., using CRLF because Apple's CP/M did).
- **Echo quirk at offset 0x2D0:** `system,\,\<CR><LF>` — BASIC echoed my `SYSTEM` command with unexpected `\` characters. Possibly artifact of the `PRINF "OOPS"` syntax error leaving parser state; harmless for Phase 1. Phase 4 may revisit if the parser core surfaces any anomaly from this capture.
- **Weird byte sequence at offset 0x2DC:** `c8 7f 27 3e` (`È<DEL>'>`). Looks like a MBASIC internal prompt-change state. Harmless — printable 0xC8 would render as extended-ASCII `È` in a CP437/ISO-8859-1 glyph table (Phase 3 concern), and 0x7F (DEL) is traditionally discarded by terminals.
- **30579 bytes free** — BASIC has plenty of room; the 3-line program doesn't stress it.
- **No DTR reset on entering BASIC** — the capture flows `A>mbasic` → `BASIC-80 Rev. 5.2` → `Ok` without any boot-banner re-emission. MBASIC loads in-place.
- **Scroll is "free":** 25 CRLFs in the RUN output produced 25 new lines with no explicit scroll command. The terminal is expected to naturally scroll when the cursor advances past the last visible row (Phase 1 `terminal.rs` must implement this in its LF / advance-row handling).

## Files

- `bytes.bin` — raw 760-byte capture
- `hexdump.txt` — annotated `xxd -c 16` output
- `README.md` — this file
