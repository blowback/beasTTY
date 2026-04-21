# Phase 1: Rust Core — Parser, Grid, Key Encoder - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or
> execution agents. Decisions are captured in CONTEXT.md — this log
> preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 01-rust-core-parser-grid-key-encoder
**Areas discussed:** Parser spike + ADR; MicroBeast capture plan;
Cell encoding + scrollback; Phase-1 scope boundaries

---

## Parser spike + ADR

### Does the parser spike run before or after the live MicroBeast capture?

| Option | Description | Selected |
|--------|-------------|----------|
| Capture first (Recommended) | Capture MicroBeast bytes, note which sequences actually appear, both spike prototypes implement those + ESC Y. Shorter spikes, both grounded in reality. | ✓ |
| Spike first | Lock parser strategy against canonical DEC-manual VT52 subset, then capture informs which handlers to prioritise. Decouples architecture decision from hardware availability. | |
| Parallel | Capture session and spike run interleaved, fold findings in as they arrive. | |

**User's choice:** Capture first — spike scope informed by observed sequences.

### What set of sequences must each spike prototype implement to be a fair comparison?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (Recommended) | ESC A/B/C/D + ESC Y row col + ESC J/K. 7 sequences. Proves state-machine shape and the one multi-byte / torn-chunk case. Fastest fair comparison. | ✓ |
| Medium with host-bound output | Minimal + ESC Z identify + ESC F/G/=/> no-ops. 12 sequences. Also validates parser → host output mechanism. | |
| Full pragmatic VT52 | All ~15 VT52 commands. Most work, but the loser is thrown away. | |

**User's choice:** Minimal — 7 sequences suffice to compare architectures.

### What decides the winner?

| Option | Description | Selected |
|--------|-------------|----------|
| Readability + extensibility (Recommended) | Author's judgment on which code is easier to reason about and extend. Both must pass identical torn-chunk tests as a floor. Dependency count is a tiebreaker. | ✓ |
| Objective metrics | LOC, binary size, bench throughput, test-count-to-confidence. | |
| Defer to benchmark only | Fewer wasm bytes after `wasm-opt -Oz` wins. | |

**User's choice:** Readability + extensibility, author's judgment.

### Where does the parser-strategy ADR live?

| Option | Description | Selected |
|--------|-------------|----------|
| `.planning/decisions/` | e.g. `.planning/decisions/ADR-001-parser-strategy.md`. Planning artefact; author-facing. | ✓ |
| `docs/adr/` (Recommended) | Standard Nygard-style community convention. Visible to repo cloners. | |
| `crates/bestialitty-core/ADR.md` | Co-located with the crate. | |

**User's choice:** `.planning/decisions/` — ADR lives alongside other planning artefacts.

---

## MicroBeast capture plan

### What tool captures the serial stream?

| Option | Description | Selected |
|--------|-------------|----------|
| minicom / tio / screen -L (Recommended) | Standard POSIX serial loggers, raw byte dump. `tio -L log.bin /dev/ttyUSB0 -b 19200` etc. | ✓ |
| Chrome-side Google Serial Terminal | googlechromelabs.github.io/serial-terminal interactively, download log. | |
| Throwaway Node/Deno capture | ~20 lines using node-serialport. In-repo tooling. | |

**User's choice:** tio / minicom / screen -L.

### What workloads must be in the capture? (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Boot + CP/M prompt + dir (Recommended) | Power-on banner, CP/M prompt, a few `dir` / `stat`. Covers CR/LF, cursor movement, basic output. | ✓ |
| Full-screen editor session | Run `ed` or equivalent, open/move/save/quit. Forces ESC Y, ESC J/K, likely BEL. Highest-value. | |
| BASIC LIST / RUN session | Confirms how BASIC handles CR/LF, syntax errors, scroll patterns. | ✓ |
| Intentional error triggers | Type garbage, Ctrl-C, provoke BEL. Documents error/BEL behaviour. | |

**User's choice:** Boot + CP/M + dir; BASIC LIST/RUN. (Full-screen editor NOT selected.)

### How are the captures stored under `.planning/research/captures/`?

| Option | Description | Selected |
|--------|-------------|----------|
| Raw .bin + per-capture README.md (Recommended) | Each session in subdir: `{bytes.bin, README.md, hexdump.txt}`. | ✓ |
| Flat directory of .bin files | One `.bin` per session at top level + single `INDEX.md`. | |
| Capture + script-replay format | Structured JSON / YAML `{bytes_hex, expected_terminal_ops, notes}`. | |

**User's choice:** Raw .bin + per-capture README.md.

### When is capture "done enough" to unblock the parser spike?

| Option | Description | Selected |
|--------|-------------|----------|
| After boot + editor session (Recommended) | Once CP/M boot + editor captured, scope is stable enough. | ✓ |
| After every listed workload | All workloads captured before spike starts. Safest. | |
| Just the boot banner | Boot alone gives CR/LF ground truth; rest after architecture chosen. | |

**User's choice:** After boot + editor session — then reconciled below.

### Reconciliation — editor in done-gate but not in workloads

| Option | Description | Selected |
|--------|-------------|----------|
| Add editor session to workloads (Recommended) | Workloads become: boot+CP/M+dir, BASIC, editor. | |
| Drop editor from the done-gate | Done-gate relaxes to: boot+CP/M + BASIC suffices. ESC Y / ESC J/K covered by hand-written torn-chunk fixtures. | ✓ |
| Capture whatever full-screen program exists | "Editor" becomes "any full-screen program that uses ESC Y". | |

**User's choice:** Drop editor from done-gate. Hand-crafted fixtures cover ESC Y / ESC J/K.
**Notes:** Reflects the author's MicroBeast usage — may not routinely run a full-screen editor. Parser can still be grounded in observed boot/CP/M/BASIC bytes plus fixture-driven torn-chunk tests.

---

## Cell encoding + scrollback

### Cell width for the grid buffer?

| Option | Description | Selected |
|--------|-------------|----------|
| 2 bytes (glyph + attr) (Recommended) | `struct Cell { ch: u8, attr: u8 }`. 10k scrollback ~ 1.6 MB. | |
| 1 byte (glyph only) | `u8` per cell. 10k scrollback ~ 800 KB. | |
| Full 8 bytes (per research) | `{ ch: u32, fg: u8, bg: u8, flags: u8, _pad: u8 }`. 10k scrollback ~ 6.4 MB. Headroom for theme-level state. | ✓ |

**User's choice:** Full 8 bytes per research recommendation.
**Notes:** User chose against my recommendation; preserves research's layout for future-proofing and theme-level per-cell flags.

### How is the glyph byte stored — raw VT52 byte or translated codepoint?

| Option | Description | Selected |
|--------|-------------|----------|
| Raw VT52 byte (Recommended) | Store byte as-it-came (0x00–0xFF). Unicode translation happens in JS renderer. | ✓ |
| Pre-translated codepoint | Parser maps bytes to Unicode before storing. Moves complexity to Rust. | |

**User's choice:** Raw VT52 byte. JS renderer owns byte → codepoint mapping.
**Notes:** Since `ch` is u32 (per D-09), upper bits are reserved for future codepoint migration if ever needed.

### Default scrollback cap?

| Option | Description | Selected |
|--------|-------------|----------|
| 10,000 lines (Recommended) | ~6.4 MB at 8-byte cell. Covers a full workday. xterm.js / VS Code default. | ✓ |
| 5,000 lines | Half the memory. | |
| 25,000 lines | ~16 MB. Long-build-log generosity. | |

**User's choice:** 10,000 lines.

### Is the scrollback cap runtime-configurable in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable via constructor arg (Recommended) | `Terminal::new(rows, cols, scrollback_cap)` + `resize_scrollback(n)`. | ✓ |
| Compile-time constant | `const SCROLLBACK_CAP: usize = 10_000;`. Simplest. | |
| Configurable at any time via setter | Repeatedly-callable setter. | |

**User's choice:** Constructor arg + `resize_scrollback` method.

---

## Phase-1 scope boundaries

### How much of the key encoder ships in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Full encoder + full test suite (Recommended) | Complete `fn encode(KeyEvent) -> Vec<u8>` in Rust with full unit tests. Phase 4 only adds JS DOM → KeyEvent packing. | ✓ |
| API + skeleton only | Signature + arrows/Ctrl-letter; edge cases in Phase 4. | |
| No key encoder until Phase 4 | Strict per traceability matrix. | |

**User's choice:** Full encoder + full test suite in Phase 1.
**Notes:** Satisfies CORE-01 intent; Phase 4's scope becomes JS wiring only.

### How do host-bound bytes (ESC Z → ESC/K identify response) get back to JS?

| Option | Description | Selected |
|--------|-------------|----------|
| Pointer-based drain API (Recommended) | `output_ptr()` + `output_len()` + `clear_output()` mirroring dirty-bitmap pattern. Zero-copy. | |
| `feed()` returns Vec<u8> | `fn feed(bytes: &[u8]) -> Vec<u8>`. Simplest shape; small allocation per feed even when output empty. | ✓ |
| Separate `drain_output() -> Vec<u8>` | Void-return `feed()`; caller polls `drain_output()`. | |

**User's choice:** `feed() -> Vec<u8>`.
**Notes:** Acceptable because VT52 host-bound output is rare (ESC Z only). Differs deliberately from the hot-path grid/dirty zero-copy pattern — cold-path APIs allocate, hot-path APIs view.

### What does the parser do with truly unexpected bytes?

| Option | Description | Selected |
|--------|-------------|----------|
| Silent discard + optional debug buffer (Recommended) | Drop byte, return to Ground. Debug-feature-flagged bounded `{offset, byte, state}` trace buffer. | ✓ |
| Silent discard only | Drop byte, no visibility. | |
| Track an error counter | `stats.malformed_seqs: u64`. | |

**User's choice:** Silent discard + optional debug buffer behind a `trace-malformed` Cargo feature.

### Test fixture format for capture-driven parser tests?

| Option | Description | Selected |
|--------|-------------|----------|
| Paired .bin + expected-ops trace (Recommended) | `session.bin` + `session.trace` (line-per-op). Test feeds bytes, records ops, diffs trace. | ✓ |
| Grid snapshot before/after | `session.bin` + `expected_grid.txt` ASCII-art final state. | |
| Both | Trace + grid snapshot combined. | |

**User's choice:** Paired `.bin` + `.trace`.

---

## Reconciliation — Wasm boundary shape

The user volunteered a simplified API sketch:

```rust
#[wasm_bindgen] pub fn feed_bytes(bytes: &[u8]);
#[wasm_bindgen] pub fn get_grid() -> Vec<u8>;   // flat (char, attrs) pairs
#[wasm_bindgen] pub fn encode_key(key: &str, modifiers: u8) -> Vec<u8>;
```

with the framing: **the Rust core is reusable across browser shell, native
shell (ratatui/SDL + libserialport), and test harness — "you write the
fiddly VT52 parser exactly once."**

### Grid API conflict: `get_grid() -> Vec<u8>` vs CORE-05 zero-copy views

| Option | Description | Selected |
|--------|-------------|----------|
| Keep zero-copy primary + ship debug get_grid (Recommended) | `grid_ptr()` + `grid_len()` + `dirty_ptr()` zero-copy for hot path. Add `get_grid() -> Vec<u8>` for debug harness + native / test-harness shells. Honours CORE-05 + user's reusability vision. | ✓ |
| Copy-only `get_grid()` | Drop CORE-05. Accept 900 KB/s at 60fps allocation cost. | |
| Zero-copy only — drop get_grid | Strict; non-browser shells implement their own copy-out on top of `grid_ptr()`. | |

**User's choice:** Zero-copy primary + convenience `get_grid()`.

### Explicit "cross-target reuse" design goal?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — crate structure supports it (Recommended) | Cargo workspace, `crates/bestialitty-core/` as cdylib+rlib. Wasm-bindgen confined to thin `lib.rs`. Core modules wasm-free. | ✓ |
| Implicit — don't make it load-bearing | Pure-logic Rust enables reuse incidentally. | |

**User's choice:** Explicit design goal — workspace structure encodes it.

---

## Claude's Discretion

Areas where the user deferred to Claude's judgment:

- Exact module boundaries within the core crate (terminal vs grid vs
  scrollback file splits)
- Per-callback naming in the winning parser approach
- Debug trace buffer shape and capacity ceiling
- Rust error type (`thiserror` vs `&'static str` vs custom enum)
- Unit test organisation (per-module vs top-level `tests/`)
- `rust-toolchain.toml` timing (Phase 1 or Phase 2)

## Deferred Ideas

- Native shell (ratatui/SDL + libserialport) — cross-target capability
  preserved, building it is out of scope for v1
- Full-screen editor capture — not gating; fold in opportunistically
- Rust-side graphics-mode glyph-to-codepoint table — renderer's job
- 1 MB dump throughput benchmark harness — verification-time, if needed
- In-browser `wasm-bindgen-test` smoke tests — Phase 2 concern
