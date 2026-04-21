# MicroBeast Capture Inventory

**Created:** 2026-04-21
**Phase:** 01-rust-core-parser-grid-key-encoder
**Purpose:** Ground Phase 1 parser scope in real-device behavior per CONTEXT D-06.

## Captures

| Dir | Workload | Status | Bytes | Date |
|-----|----------|--------|-------|------|
| `capture-01-cpm-boot/` | Boot + CP/M + `DIR` + `STAT` (×2) | captured | 797 | 2026-04-21 |
| `capture-02-basic/` | MBASIC `LIST` / `RUN` + syntax error + `SYSTEM` | captured | 760 | 2026-04-21 |

## Observed VT52 Sequence Inventory

**No ESC sequences observed in either capture.** Both the CP/M shell and BASIC-80 produce pure printable-ASCII output terminated by line endings. No cursor positioning (ESC Y), no erase (ESC J/K), no identify query (ESC Z), no reverse linefeed (ESC I), no BEL, no BS, no HT.

| Sequence | Bytes | Capture | Count | Notes |
|----------|-------|---------|-------|-------|
| _none_ | — | — | 0 | Both workloads stay in printable-ASCII + line-ending territory |

This does NOT mean the MicroBeast lacks VT52 support — just that these two workloads don't exercise it. Other programs on the disk (`VPEEK`, `ZORK1`, `KCALC`) are likely candidates for ESC-sequence-bearing captures in a future session. Phase 1's parser must still implement the full pragmatic VT52 subset because:

1. Plan 03's parser spike deliberately locks a 7-sequence minimum (ESC A/B/C/D, ESC Y, ESC J, ESC K) independent of capture findings (CONTEXT D-02).
2. Plan 04 ships handlers for every opcode in 01-RESEARCH.md's "VT52 Opcode Table"; 01-RESEARCH.md enumerates the full set from the DEC VT52 manual.
3. The captures confirm that if the MicroBeast *were* to emit VT52 sequences, the `0x1B` ESC byte would pass through unmolested by any intermediate processing (no serial adapter eating it, no tio log-file escaping it — `--log-file` writes raw bytes).

## CR/LF Convention

**The MicroBeast emits two distinct CR/LF conventions depending on program.** This is a capture-surfaced finding that reshapes PARSER-07.

| Program | Line-ending bytes | Parser effect needed |
|---------|-------------------|----------------------|
| CP/M shell + `DIR` + `STAT` (capture-01) | `0x0A` (LF only, 36×, zero CR) | LF must BOTH advance row AND reset column to 0 |
| BASIC-80 Rev. 5.2 (capture-02) | `0x0D 0x0A` (CRLF, 55 pairs; 58 CR, 55 LF) | Standard VT52: CR → col 0, LF → row advance |

**Phase 1 parser default:** `lf_implies_cr = true` (the "LF implies CR" override is ON by default).

Rationale: With override ON, both conventions work correctly:
- LF-only: LF does both effects. ✓
- CRLF: CR resets col, LF advances row and redundantly resets col (no-op). ✓

With override OFF (strict VT52), CP/M's LF-only output would stack vertically without column reset (visibly broken). Override ON is the only default that renders both captured workloads correctly.

Future-proofing: Phase 4 (INPUT-05) can expose a runtime toggle on the Terminal constructor. No workload captured so far relies on strict-VT52 LF (row-advance-only) — if a future capture surfaces one, flipping the toggle is a one-line change.

## Serial Parameters (XPORT-04 verification)

**Confirmed:** 19200 baud, 8 data bits, no parity, 1 stop bit, no flow control produces readable output on the author's MicroBeast. The XPORT-04 assumption stands. Phase 5's Web Serial transport can use these values as the default / only-supported configuration.

Adapter: Silicon Labs CP2102N USB-to-UART Bridge Controller (VID:PID `10c4:ea60`).

## Divergences from DEC VT52 Manual

- **Neither capture used any ESC sequence.** The DEC manual documents 14 single-char ESC sequences + 1 multi-byte (ESC Y row col); this session exercised zero. The gap is not a MicroBeast behavior quirk — it's a workload coverage gap. Address by capturing VPEEK / ZORK1 / KCALC (or a full-screen editor, if one is installed) in a follow-up pass.
- **CP/M shell uses LF-only line endings**, not the standard CRLF that DEC VT52 terminals expect. This is a MicroBeast firmware / CBIOS convention (possibly common to many CP/M 2.2 implementations). The parser handles this via the `lf_implies_cr = true` default.
- **BASIC-80 Rev. 5.2 [Apple CP/M Version]** — the MicroBeast's BASIC is the Microsoft port originally targeted at Apple II CP/M (1980-11-12). Worth noting because its CR/LF choice (CRLF) likely reflects Apple-side conventions rather than MicroBeast-native behavior.
- **No BEL on syntax error** — BASIC prints `Syntax error` as plain text without ringing 0x07. Phase 3's visible-bell implementation (when it ships) has no stimulus from this capture; it's still needed per PARSER-06 because Zork1 / future interactive workloads may use BEL.
- **Echo artifacts** in capture-02 (`system,\,\`, `c8 7f 27 3e`) — byproducts of MBASIC's syntax-error recovery path. Not parser-relevant; documented in `capture-02-basic/README.md` for completeness.

## Follow-up Workloads (not required for Phase 1)

When the MicroBeast is accessible again, prioritise workloads likely to emit VT52 sequences:

- **`VPEEK COM`** — memory viewer; near-certain to use `ESC Y` for cell-addressed output + `ESC J/K` for redraws
- **`ZORK1 COM`** — Infocom Z-machine; may use `ESC J` to clear status line, `ESC Y` for the "> " prompt position
- **`KCALC COM`** — calculator UI; likely ESC-heavy
- **Any text editor** (if one exists on the disk) — highest-value for ESC Y row col torn-chunk validation against real-device sequences

Each would become `capture-03-*`, `capture-04-*`, etc. None gates Phase 1 delivery (D-08).

## Consumed by

- **Plan 03 (parser-strategy spike)** — sequence inventory currently empty, so spike's minimum test set falls back to D-02's 7-sequence floor (ESC A/B/C/D, ESC Y, ESC J, ESC K) derived from DEC manual. Both hand-rolled and vte prototypes must pass the torn-chunk harness against these fixtures.
- **Plan 04 (parser core + Terminal)** — CR/LF finding drives PARSER-07 default (`lf_implies_cr = true`). Full VT52 opcode handling comes from 01-RESEARCH.md's table, not from this capture.
- **Plan 05 (fixtures + fixture_runner)** — paired `.bin + .trace` fixture generation uses DEC-manual-derived byte sequences since captures produced no ESC traffic. `capture-01/bytes.bin` and `capture-02/bytes.bin` themselves are candidates for fixture use once a "pure printable + line ending" fixture class is useful (e.g., to prove scroll-on-LF works).
- **Phase 5 (Web Serial transport)** — XPORT-04 serial params (19200 8N1 no flow control) taken from here as confirmed defaults.
- **Phase 4 (keyboard + connect)** — INPUT-05 override toggle for strict-VT52 mode becomes optional future work; default `lf_implies_cr = true` is the known-working value.
