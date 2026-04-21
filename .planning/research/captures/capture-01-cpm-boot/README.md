# Capture 01: CP/M Boot + `DIR` / `STAT`

**Captured:** 2026-04-21
**Tool:** tio 2.7
**Device:** /dev/ttyUSB0
**Adapter:** Silicon Labs CP2102N USB-to-UART Bridge Controller (VID:PID `10c4:ea60`)

## Serial Parameters

- Baud: 19200
- Data bits: 8
- Parity: none
- Stop bits: 1
- Flow control: none

Confirmed — 19200 8N1 no flow control produces readable output. XPORT-04 assumption holds for the MicroBeast at these params.

## Workload

1. Started `tio --log --log-file bytes.bin /dev/ttyUSB0` against the MicroBeast.
2. Power-cycled the MicroBeast.
3. Captured boot banner → CP/M `A>` prompt.
4. Ran: `dir`
5. Ran: `stat`
6. Ran: `dir` (second time)
7. Stopped tio with `Ctrl-T q`.

Capture size: 797 bytes.

## CR/LF Convention Observation

**MicroBeast CP/M emits LF-only (0x0A) with NO CR (0x0D).**

- LF count: 36
- CR count: 0
- CRLF sequences (0x0D 0x0A): 0

Representative bytes from the boot banner (hexdump offset 0x00):

```
4f 4b 0a 4b 65 79 62 6f 61 72 64 20 4f 4b 0a 4d   OK.Keyboard OK.M
69 63 72 6f 42 65 61 73 74 20 73 74 61 72 74 69   icroBeast starti
6e 67 2e 2e 2e 0a                                 ng....
```

Every line ending is a bare `0x0A` with no preceding `0x0D`.

**Parser implication (PARSER-07):** Standard VT52 treats LF as row-advance only (column unchanged) and expects a separate CR (0x0D) for column reset. The MicroBeast's CP/M assumes LF = full newline (column reset + row advance). The Rust parser must apply the **"LF implies CR" override** (CONTEXT.md D-15 alluded to this; Phase 4's INPUT-05 was supposed to own the override toggle — but the capture shows the default must be ON for MicroBeast, not OFF).

Recommendation: Phase 1 parser defaults `lf_implies_cr = true` for the MicroBeast shell. Phase 4 can add a runtime toggle if a workload surfaces a program that emits CRLF (BASIC / Zork may — see Capture 02).

## Sequence Inventory

**Zero ESC sequences observed in this capture.**

- ESC (0x1B) count: 0
- BEL (0x07) count: 0
- BS (0x08) count: 0
- HT (0x09) count: 0

The CP/M shell + `DIR` + `STAT` workload emits pure printable ASCII + LF. No cursor moves, no erases, no identify queries.

This does NOT mean the MicroBeast never emits ESC sequences — just that this workload doesn't exercise them. MBASIC, Zork1, or a full-screen editor (if one exists in the `dir` listing) would likely emit cursor-positioning sequences. Capture 02 (BASIC) will test that.

Programs visible in the `dir` output worth noting for future captures:
- `MBASIC COM` — BASIC interpreter (Capture 02 workload)
- `KCALC COM` — calculator (may use ESC Y for layout)
- `ZORK1 COM` + `ZORK1 DAT` — Infocom Z-machine; Zork1 text rendering may use ESC J / ESC K for prompts
- `VPEEK COM` — memory viewer; likely uses cursor positioning
- `SIEVE COM` — sieve of Eratosthenes; probably pure text

## Notable Observations

- **Boot banner is terse and text-only:** `OK\nKeyboard OK\nMicroBeast starting...\nDetected PIO\nDetected Display 1/2\nDetected Display 2/2\nDetected RTC\n\nCheck RTC\nClock speed  8,0Mhz\nLED Off\nFormat RAM disk\nCheck RTC\nRestored 732 sectors OK\n\nA>\n` — useful baseline for Phase 5 reconnect tests.
- **European decimal separator:** "8,0Mhz" uses comma, not period. Doesn't affect parser but notable for UX.
- **`A>` prompt has no trailing space** — watch for cursor placement if the parser renders the prompt at the wrong column.
- **Two `A>dir` invocations** give Plan 04 two independent fixture samples of the same workload for drift detection.
- **No DTR-induced reset:** The capture starts with `OK\n` (the first line of a real boot), not a mid-program state. Phase 5 will need to revisit DTR-on-open (RESEARCH Pitfall 12) but for capture purposes the boot was clean.
- **No BS / HT / BEL:** The CP/M shell doesn't emit backspace (even for line editing — delete char may be handled host-side), doesn't use tabs, doesn't ring the bell on errors. Phase 3's bell-flash is dormant for this workload.

## Files

- `bytes.bin` — raw 797-byte capture
- `hexdump.txt` — annotated `xxd -c 16` output
- `README.md` — this file
