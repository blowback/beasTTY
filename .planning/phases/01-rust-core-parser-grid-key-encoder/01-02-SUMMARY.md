---
phase: 01-rust-core-parser-grid-key-encoder
plan: 02
status: complete
started: 2026-04-21
completed: 2026-04-21
tasks_completed: 3
tasks_total: 3
requirements_addressed: [PARSER-07]
---

# Plan 01-02 — Live MicroBeast Byte Capture — SUMMARY

## Outcome

Both captures completed successfully via Path A (live capture). Neither emitted ESC sequences — but the CR/LF findings alone resolve PARSER-07 and reshape the parser's default behavior.

## Tasks

| # | Task | Commit | Notes |
|---|------|--------|-------|
| 1 | Capture CP/M boot + DIR + STAT | `eb04a1d` | 797 bytes; **LF-only**; zero ESC; confirmed 19200 8N1 |
| 2 | Capture MBASIC LIST/RUN + syntax err | `cc56b15` | 760 bytes; **CRLF**; zero ESC; 55 CRLF pairs |
| 3 | Synthesise top-level inventory README | (in next commit) | Documents divergence + recommends `lf_implies_cr = true` default |

## Key Findings

### 1. CR/LF convention diverges by program (resolves PARSER-07)

| Program | Bytes | Convention |
|---------|-------|------------|
| CP/M shell (boot, DIR, STAT) | `0x0A` × 36, zero `0x0D` | LF-only |
| BASIC-80 Rev. 5.2 | 55 × CRLF, 3 stray CR | CRLF |

**Parser default decided:** `lf_implies_cr = true`. With the override ON, both conventions render correctly (LF-only: LF does both; CRLF: CR + LF, second reset is a no-op). Default OFF would break CP/M output visibly.

### 2. No ESC sequences in either workload

The CP/M shell + DIR + STAT and MBASIC LIST/RUN + syntax error paths emit zero `0x1B` bytes. Spike (Plan 03) and fixture generator (Plan 05) fall back to DEC-manual-derived byte sequences per D-08 — not a blocker, but the captures didn't add new inputs.

Candidates for a future follow-up capture:
- `VPEEK COM` — memory viewer, likely ESC Y / ESC J
- `ZORK1 COM` — Infocom Z-machine, likely ESC J for status line
- `KCALC COM` — calculator UI, likely ESC-heavy
- A full-screen editor (if one exists on disk)

### 3. XPORT-04 assumption confirmed

19200 baud, 8 data bits, no parity, 1 stop bit, no flow control works against the live MicroBeast. Phase 5 can use these as default / only-supported values.

Adapter: Silicon Labs CP2102N (VID:PID `10c4:ea60`).

### 4. Echo / state-machine artifacts in BASIC

`system,\,\` and `c8 7f 27 3e` sequences at the end of capture-02 are BASIC-80's syntax-error recovery path echoing stray chars. Not a parser concern; documented in `capture-02-basic/README.md` for completeness.

## Deviations

None. Path A succeeded for both captures. No deferral needed, no acceptance-criterion fudging.

## Consumed By

- **Plan 03 (spike):** minimum test set stays at D-02 7-sequence floor (no capture-derived additions).
- **Plan 04 (parser core + Terminal):** default `lf_implies_cr = true` in `Terminal::new`. `handle_lf` resets col to 0 AND advances row.
- **Plan 05 (fixtures):** fixture bytes come from DEC manual; `capture-0{1,2}/bytes.bin` may be reused as "pure printable + line ending" scroll-test fixtures.
- **Phase 5 (Web Serial):** 19200 8N1 no flow control confirmed — hard-code as default.
- **Phase 4 (INPUT-05):** runtime `lf_implies_cr` toggle is now optional future work; default is known-good.

## Files Created

- `.planning/research/captures/capture-01-cpm-boot/bytes.bin` (797 B)
- `.planning/research/captures/capture-01-cpm-boot/hexdump.txt`
- `.planning/research/captures/capture-01-cpm-boot/README.md`
- `.planning/research/captures/capture-02-basic/bytes.bin` (760 B)
- `.planning/research/captures/capture-02-basic/hexdump.txt`
- `.planning/research/captures/capture-02-basic/README.md`
- `.planning/research/captures/README.md` (top-level inventory)

## Self-Check: PASSED

All six plan-level verification bullets satisfied:

- [x] `test -d .planning/research/captures/capture-01-cpm-boot` ✓
- [x] `test -d .planning/research/captures/capture-02-basic` ✓
- [x] `test -s .planning/research/captures/README.md` ✓
- [x] Both captures took Path A (bytes.bin + hexdump.txt + README.md non-empty)
- [x] PARSER-07 resolved (CR/LF convention documented with live-hardware evidence)
- [x] Plan 03 and Plan 04 can start without re-litigating capture — findings are frozen
