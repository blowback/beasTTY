# Phase 1: Rust Core — Parser, Grid, Key Encoder - Research

**Researched:** 2026-04-21
**Domain:** Pure-Rust VT52 parser + 80x24 grid + capped scrollback + PC→VT52 key encoder,
provable via `cargo test` with zero browser involvement
**Confidence:** HIGH (stack, VT52 protocol, wasm-boundary shape, cell layout, torn-chunk
pattern, scrollback model), MEDIUM (exact current vte crate version), MEDIUM-LOW
(MicroBeast-specific VT52 inventory — resolved only by Phase 1's live capture)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

These are locked decisions from `/gsd-discuss-phase`. The planner MUST honor them.
Research expands detail inside these decisions; it does NOT reopen them.

### Locked Decisions

**Parser strategy spike + ADR:**
- **D-01:** Live MicroBeast byte capture runs **before** the parser-strategy
  spike. Spike scope is informed by the observed sequence inventory.
- **D-02:** Spike compares two prototypes: a hand-rolled VT52 DFA
  (STACK.md recommendation) vs building on `vte::Parser` + a minimal
  `Perform` impl (ARCHITECTURE.md recommendation). Each prototype implements
  the same minimal 7-sequence set: `ESC A/B/C/D` (cursor moves), `ESC Y row
  col` (the multi-byte / torn-chunk case), `ESC J` (erase-to-end-of-screen),
  `ESC K` (erase-to-end-of-line).
- **D-03:** Winner is chosen by readability + extensibility (author's
  judgment on which code is easier to reason about and extend). Floor
  condition: both prototypes must pass the identical torn-chunk test suite
  before subjective comparison. Dependency count (vte = one extra crate)
  is a tiebreaker, not the primary criterion.
- **D-04:** Parser-strategy ADR lives at
  `.planning/decisions/ADR-001-parser-strategy.md` (Nygard-style; committed
  and dated; records the decision, context, and reasons for rejecting the
  alternative).

**Live MicroBeast capture:**
- **D-05:** Capture tool is a standard POSIX serial logger (`tio`,
  `minicom`, or `screen -L`). Output is raw bytes. No in-repo capture
  tooling required for Phase 1.
- **D-06:** Workloads captured:
  1. Boot banner → CP/M prompt → a few `dir` / `stat` commands
     (grounds CR/LF convention, basic cursor movement, printable output,
     XPORT-04's serial-params assumption of 19200 8N1 no flow control).
  2. BASIC `LIST` / `RUN` session (surfaces differences in how BASIC
     handles CR/LF, syntax errors, scroll patterns).
- **D-07:** Capture layout under `.planning/research/captures/`:
  one subdirectory per session (`capture-01-cpm-boot/`,
  `capture-02-basic/`, etc.); each subdirectory contains `bytes.bin`
  (raw capture), `README.md` (serial params, workload run, notable
  observations, CR/LF convention findings), and `hexdump.txt` (reviewable
  annotated hex).
- **D-08:** Capture done-gate: boot + BASIC captures unblock the parser
  spike. Full-screen-editor coverage (the highest-value capture for
  `ESC Y` / `ESC J/K`) does **not** gate the phase — those sequences
  are covered by hand-crafted torn-chunk fixtures written from the DEC
  VT52 manual.

**Cell encoding + scrollback:**
- **D-09:** Cell layout is `#[repr(C)] struct Cell { ch: u32, fg: u8,
  bg: u8, flags: u8, _pad: u8 }` — 8 bytes, naturally aligned, row-major.
- **D-10:** `ch` stores the raw VT52 byte (0x00–0xFF) today; upper u32 bits
  reserved for future codepoint migration. Graphics-mode glyph translation
  is JS's problem (Phase 3), not Rust's.
- **D-11:** Default scrollback cap is **10,000 lines**.
- **D-12:** Scrollback cap is runtime-configurable via constructor arg:
  `Terminal::new(rows: u32, cols: u32, scrollback_cap: usize)`; a
  `resize_scrollback(new_cap: usize)` method re-allocates and truncates.

**Phase-1 scope boundaries:**
- **D-13:** Full key encoder ships in Phase 1 as pure Rust logic with
  exhaustive unit tests. Phase 4 only packs DOM events into `KeyEvent`.
- **D-14:** Host-bound bytes (ESC Z identify response, future replies)
  are returned from `feed()`: `fn feed(bytes: &[u8]) -> Vec<u8>`.
- **D-15:** Parser behavior on unexpected bytes: silent discard + return
  to `Ground`. In debug builds (behind a `trace-malformed` Cargo feature),
  push `{offset, byte, state}` entries to a bounded ring buffer. Release
  builds have zero overhead.
- **D-16:** Unit test fixture format is paired `session.bin` +
  `session.trace` files. Trace is a line-per-op sequence of expected
  high-level terminal operations. Tests diff emitted ops against expected.

**Wasm boundary shape + cross-target reuse:**
- **D-17:** Hot-path wasm API is zero-copy via stable pointers:
  `grid_ptr()`, `grid_byte_len()`, `dirty_ptr()`, `rows()`,
  `clear_dirty()`, `cursor() -> u32`, `feed(bytes) -> Vec<u8>`,
  `encode_key(code, mods) -> Vec<u8>`, `resize(rows, cols)`,
  `resize_scrollback(n)`.
- **D-18:** Cold-path convenience API: `get_grid() -> Vec<u8>`
  (visible-region snapshot copy) — for debug harness, native shells,
  and readability-oriented tests.
- **D-19:** Cargo workspace structure with `crates/bestialitty-core/`
  containing `lib.rs` (wasm-bindgen exports only), `terminal.rs`,
  `grid.rs`, `scrollback.rs`, `dirty.rs`, `key.rs`, `vt52.rs`. Logic
  modules are wasm-free; wasm-bindgen attrs confined to `lib.rs`.
- **D-20:** **Cross-target reuse is an explicit design goal.** Same
  crate backs browser shell (cdylib + wasm-bindgen), hypothetical native
  shell (rlib + ratatui/SDL), and pure-Rust test harness (rlib + cargo
  test). Phase 1 proves this by having all unit tests link as rlib
  with zero wasm involvement.

### Claude's Discretion

- Exact module-boundary choices inside the core crate (e.g., whether
  `terminal.rs` and `grid.rs` merge, whether `dirty.rs` folds into
  `grid.rs`).
- Naming of individual parser callbacks / methods (if the `vte::Perform`
  path wins in the spike).
- Exact structure of the `trace-malformed` debug buffer entries and its
  capacity ceiling.
- Specific Rust error type choice (`thiserror` enum vs `&'static str` vs
  a custom `Result<_, ParseError>`).
- Internal testing layout (per-module `#[cfg(test)]` blocks vs top-level
  `tests/` dir vs both).
- Whether to pin `rust-toolchain.toml` now or defer to Phase 2.

### Deferred Ideas (OUT OF SCOPE)

- **Native shell** (ratatui/SDL + libserialport) — design only; no build.
- **Full-screen editor capture** — fold in if available, otherwise skip.
- **Rust-side graphics-mode glyph table** — Phase 3 / JS concern.
- **Benchmark suite** (1 MB throughput harness) — not required for Phase 1 correctness.
- **`wasm-bindgen-test` browser smoke tests** — belongs in Phase 2.

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PARSER-01 | VT52 parser covers pragmatic subset (ESC A/B/C/D/H/I, ESC Y, ESC J/K) | Complete sequence inventory in "VT52 Opcode Table" below (authoritative from vt100.net chapter 2/3 + Wikipedia) |
| PARSER-02 | ESC Y +32 offset decodes correctly | "ESC Y Decoding" section gives the `saturating_sub(0x20).min(MAX)` formula + test edges |
| PARSER-03 | Parser handles sequences split across chunk boundaries | "Torn-Chunk Test Harness" section gives the systematic split-at-every-offset pattern |
| PARSER-04 | ESC F/G/=/> parse as silent no-ops | Listed in "VT52 Opcode Table" with "no-op" disposition; noted as graphics-mode-enter/exit and alt-keypad-enter/exit |
| PARSER-05 | ESC Z identify returns ESC / K on the serial line | Listed in "VT52 Opcode Table"; implemented via `feed()` return `Vec<u8>` per D-14 |
| PARSER-06 | BEL (0x07) triggers visible-bell signal | Parser sets `bell_pending` flag; Phase 1 owns state, Phase 3 owns render (per `<specifics>` in CONTEXT) |
| PARSER-07 | Default CR/LF handling matches MicroBeast | Resolved by live capture (D-05, D-06); default posture is "CR alone → col 0; LF alone → row +1 same col" per baseline VT52 convention, toggle added in Phase 4 |
| PARSER-08 | Parser and state machine have Rust unit tests covering MicroBeast subset + torn-chunk | "Validation Architecture" section below specifies the test framework + requirement-to-test map |
| CORE-01 | Rust/wasm owns parser + terminal state + key encoding; pure logic, no I/O, no DOM | Architecture module layout (D-19) enforces logic-in-core, wasm-bindgen-in-lib-rs-only |
| CORE-02 | Rust core has zero bindings to Web Serial or browser I/O | Dependency list below excludes `web-sys`, `js-sys::Serial*`; CI check `cargo build --target x86_64-unknown-linux-gnu` enforces it |

</phase_requirements>

---

## Summary

Phase 1 builds a greenfield Rust library (`bestialitty-core`) that is a pure logic
implementation of a VT52 terminal: an 80×24 grid with capped scrollback, a
byte-streaming parser for the pragmatic MicroBeast VT52 subset, and a PC-keyboard→VT52
byte encoder. The entire crate must build and test on `x86_64-unknown-linux-gnu` with
zero browser dependencies — wasm concerns are Phase 2's; this phase proves the crate
is cross-target by *only* running it as a native rlib under `cargo test`.

The two high-risk surfaces are (a) the VT52 `ESC Y` multi-byte cursor-addressing
sequence, whose +0x20 offset encoding has shipped as a bug in production terminals
(mintty#1299), and (b) sequences torn across chunk boundaries, which a correct
byte-streaming state machine handles trivially but a naive "scan forward for next byte"
parser breaks catastrophically. Both are addressed by the same architectural discipline:
a byte-at-a-time state machine with explicit states (`Ground`, `Escape`, `CursorRow`,
`CursorCol`), saturation+clamp arithmetic on `ESC Y` bytes, and a systematic
torn-chunk test harness that splits every multi-byte sequence at every internal offset
and asserts identical end state to the unsplit feed.

Two unresolved design choices are explicit in CONTEXT.md and researched here:
(1) hand-rolled DFA vs `vte::Parser`+`Perform` — resolved by a 2-4 hour spike against
an identical 7-sequence test suite (D-02/03/04), with the committed ADR at
`.planning/decisions/ADR-001-parser-strategy.md`; (2) live MicroBeast byte capture
workflow — resolved by `tio` (verified present on this machine: v2.7) running the
CP/M boot + BASIC workloads and producing the D-07 capture layout.

**Primary recommendation:** Run the live capture FIRST (unblocks the spike, grounds
the VT52 inventory, verifies XPORT-04's 19200 8N1 no-flow-control assumption), then
the parser-strategy spike against hand-crafted torn-chunk fixtures, then commit ADR-001,
then build the rest of the core crate against the fixture-driven test plan below.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| VT52 byte parsing | Rust core | — | Pure logic, branch-heavy, testable without a browser; CORE-01 requires this |
| Terminal state (cursor, modes, scroll region) | Rust core | — | Pure logic coupled to parser; same testability argument |
| 80×24 grid | Rust core | — | `Vec<Cell>` layout exposed zero-copy to JS; heap-resident, stable pointer, no DOM |
| Scrollback ring (VecDeque of rows) | Rust core | — | Alacritty-lineage data structure; O(1) push/pop; pure logic |
| Dirty-row bitmap | Rust core | — | Byte-per-row array mutated by parser, read+cleared by JS renderer |
| Key encoding (PC keycode → VT52 bytes) | Rust core | — | Stateless pure function; D-13 puts it in Phase 1 so Phase 4 only does DOM→struct packing |
| Host-bound reply bytes (ESC Z → ESC / K) | Rust core | — | Returned from `feed()` Vec<u8> per D-14; JS writes to port.writable |
| Malformed-byte tracing | Rust core (feature-gated) | — | `trace-malformed` Cargo feature; dev-only ring buffer; release has zero overhead per D-15 |
| Byte transport (Web Serial) | — | JS shell (Phase 5) | Project constraint: Web Serial from JS only; CORE-02 forbids Rust bindings |
| Canvas rendering | — | JS shell (Phase 3) | Rendering is I/O; JS owns it |
| Glyph translation (graphics-mode byte → Unicode) | — | JS renderer (Phase 3) | D-10 explicitly puts this table in JS |
| DOM keyboard events | — | JS shell (Phase 4) | Browser APIs stay in JS |
| Bell visual effect | — | JS renderer (Phase 3) | Rust flips `bell_pending`; JS reads + animates |

---

## Project Constraints (from CLAUDE.md)

- **Rust → wasm core** owns parser, terminal state, key encoding. Pure logic. Zero
  `web-sys` / `js-sys::Serial*` / DOM / I/O dependencies.
- **wasm-bindgen + wasm-pack (target `web`)** is the locked interop toolchain
  (Phase 2 concern, but crate layout must support it: `[lib] crate-type = ["cdylib", "rlib"]`).
- **Chromium-only.** No Firefox/Safari polyfill work.
- **Static site deploy only.** No server runtime — no networked fetch in tests.
- **VT52 pragmatic subset** — only what MicroBeast emits. Not strict DEC VT52. Not ANSI. Not H19.
- Phases execute strictly in order. Phase 1 is first; no prior phase artifacts exist.
- Parser strategy is explicitly called out as unresolved-at-phase-start by CLAUDE.md;
  resolution is a spike + ADR, not more research.

All Phase 1 plans MUST comply with these constraints. Any plan that adds a browser dep,
a non-Chromium target, a strict-VT52 or ANSI sequence, or a server-requiring test setup
violates CLAUDE.md and must be rejected by plan-check.

---

## Standard Stack

### Core (Phase 1 only — Phase 2+ adds more)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Rust stable | **1.94.1** (present on this machine, VERIFIED; Rust 1.85+ is the floor for Edition 2024 per CONTEXT) | Language for parser, state, key encoding | Standard for wasm cores; pure-logic lane requires only std |
| Edition 2024 | — | Cargo.toml `edition = "2024"` | Stable since Rust 1.85 (Feb 2025); current on 1.94.1. [CITED: blog.rust-lang.org/2025/02/20] |
| `vte` crate | **0.15.0** (docs.rs-verified current), MSRV unknown | Only if `vte::Parser`+`Perform` path wins the D-02 spike | Alacritty's parser; implements Paul Williams DFA; handles partial reads, intermediates, OSC/CSI/DCS correctly. `advance(performer, &[u8])` is byte-slice-based [CITED: docs.rs/vte] |
| `thiserror` | 1.x (discretionary per D "Claude's Discretion") | Optional error type ergonomics | Only if parser error surface is wide enough to justify; else `&'static str` is fine |

### Phase-1-specific dev tooling

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `cargo` | 1.94.1 | Build + test | [VERIFIED: present on this machine] |
| `rustc` | 1.94.1 | Compile | [VERIFIED: present on this machine] |
| `rustup` | 1.29.0 | Toolchain pin (optional — D "Claude's Discretion" allows deferring to Phase 2) | [VERIFIED: present] |
| `rustfmt` / `clippy` | bundled | Style + lints | Standard; no special config needed for Phase 1 |
| `tio` | 2.7 | Live MicroBeast serial capture (D-05) | [VERIFIED: present at /usr/bin/tio] |
| `minicom` | 2.9 | Fallback serial capture (D-05 alternative) | [VERIFIED: present at /usr/bin/minicom] |
| `xxd` / `hexdump` | system | Produce `hexdump.txt` annotated hex (D-07) | [VERIFIED: both present] |

### Packages NOT needed for Phase 1

| Package | Reason NOT in Phase 1 | When it arrives |
|---------|-----------------------|-----------------|
| `wasm-bindgen` | Phase 1 builds as rlib; no wasm involvement per D-20 | Phase 2 (wasm boundary) |
| `wasm-pack` | No wasm-pack build in Phase 1 | Phase 2 |
| `js-sys`, `web-sys` | Explicitly forbidden by CORE-01/-02 | Never (at crate-root level); only in `lib.rs` wasm-bindgen scaffolding added in Phase 2 |
| `wee_alloc` / `lol_alloc` | No allocator swap needed; default allocator fine for pure-logic core | Never, or later if wasm bundle size pressure justifies |
| `serde` / `serde-wasm-bindgen` | No structured-data interop needed yet | Add only if/when the API shape needs it (likely never for Phase 1) |

### Installation (Phase 1 scope)

No installation required beyond what's already present on this machine. If `vte` wins
the spike, add to `crates/bestialitty-core/Cargo.toml`:

```toml
[dependencies]
vte = "0.15"  # VERIFY CURRENT at plan time via `cargo search vte` or crates.io
```

### Version verification at plan time

Before writing the plan, run:
```bash
cargo search vte --limit 1    # confirm latest vte version
rustc --version               # confirm Rust channel + edition 2024 support
```

**Version caveat on `vte`:** docs.rs reports 0.15.0 as "latest" [CITED: docs.rs/vte],
while the alacritty/vte README still shows 0.13.0 (Nov 2023). This is most likely a
README-lag issue. Plan-time `cargo search` resolves it.

### Alternatives considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled DFA (STACK.md) | `vte::Parser` + `Perform` (ARCHITECTURE.md) | D-02 spike resolves; no prior decision |
| `thiserror` | `&'static str` / custom `Result` | Discretionary per CONTEXT |
| `VecDeque<Row>` scrollback | Flat `Vec<Cell>` + ring indices | VecDeque is Alacritty-lineage and idiomatic; flat-vec is uglier arithmetic for no win at 10k-line cap |
| Byte-per-row dirty bitmap | Bit-per-row `Vec<u64>` / bitvec | Byte-per-row is byte-aligned (zero-copy Uint8Array view from JS is trivial), 24 bytes at 80×24 is unmeasurable memory, and read/write is a single byte op |
| `Vec<u8>` host-bound reply | Static lookup table / slice return | Vec is cold-path-only per D-14 (identify response, basically once per session) |

---

## VT52 Opcode Table (authoritative)

Verified against vt100.net/docs/vt52-mm chapters 2 & 3 (DEC VT52 DECscope Maintenance
Manual) and Wikipedia VT52 entry. [CITED: vt100.net/docs/vt52-mm/chapter2.html,
vt100.net/docs/vt52-mm/chapter3.html, en.wikipedia.org/wiki/VT52]

### C0 control bytes (executed in Ground state)

| Byte | Name | Effect | Phase 1 disposition |
|------|------|--------|---------------------|
| 0x07 | BEL (CTRL-G) | Audible bell on real VT52 | Set `bell_pending` flag; Phase 3 renders visible flash |
| 0x08 | BS (CTRL-H) | Cursor left one position | Decrement cursor column; clamp at 0 |
| 0x09 | HT (CTRL-I) | Move to next tab stop | Move col to next multiple of 8, clamped to cols-1 |
| 0x0A | LF (CTRL-J) | Cursor down one line | Row += 1; at bottom, scroll up; column unchanged per default VT52 convention |
| 0x0D | CR (CTRL-M) | Cursor to column 0 | Column = 0; row unchanged per default VT52 convention |
| 0x1B | ESC | Enter Escape state | State transition only; do not emit |
| other C0 | — | Undefined on VT52 | Silent discard (D-15) |

**CR/LF convention note:** Default VT52 is LF → "down same column", CR → "left margin same row",
CRLF → newline. The MicroBeast CP/M convention is verified via live capture in this phase
(PARSER-07). CLAUDE.md explicitly lists this as a Phase 1 dependency to surface.
[CITED: vt100.net/docs/vt52-mm/chapter2.html; en.wikipedia.org/wiki/VT52]

### Single-character escape sequences

| Sequence | Bytes | Effect | Phase 1 disposition |
|----------|-------|--------|---------------------|
| ESC A | 1B 41 | Cursor up one line; no scroll at top | Decrement row; clamp at 0 |
| ESC B | 1B 42 | Cursor down one line; no scroll at bottom per DEC | Increment row; clamp at rows-1 |
| ESC C | 1B 43 | Cursor right one column | Increment col; clamp at cols-1 |
| ESC D | 1B 44 | Cursor left one column | Decrement col; clamp at 0 |
| ESC H | 1B 48 | Cursor home (0,0) | Row = col = 0 |
| ESC I | 1B 49 | Reverse linefeed: cursor up, scroll down if at top | Decrement row OR scroll grid down at top |
| ESC J | 1B 4A | Erase to end of screen (cursor + below) | Clear cells from cursor to end; mark affected rows dirty |
| ESC K | 1B 4B | Erase to end of line | Clear cells in current row from cursor to end; mark row dirty |
| ESC F | 1B 46 | Enter graphics mode | Silent no-op per D-10 and PARSER-04; flag may be tracked for Phase 3 |
| ESC G | 1B 47 | Exit graphics mode | Silent no-op per D-10 and PARSER-04 |
| ESC = | 1B 3D | Enter alternate-keypad mode | Silent no-op per PARSER-04 (Phase 4 key encoder may track mode) |
| ESC > | 1B 3E | Exit alternate-keypad mode | Silent no-op per PARSER-04 |
| ESC Z | 1B 5A | Identify terminal | Emit reply `ESC / K` = `1B 2F 4B` via `feed()` return `Vec<u8>` per D-14 |
| ESC [ | 1B 5B | Enter hold-screen mode | Silent no-op (not in PARSER-04 list but safest disposition; flag for future if MicroBeast uses it) |
| ESC \ | 1B 5C | Exit hold-screen mode | Silent no-op (same) |

### Multi-byte escape sequences

| Sequence | Bytes | Effect | Phase 1 disposition |
|----------|-------|--------|---------------------|
| ESC Y row col | 1B 58 r c | Direct cursor addressing | See "ESC Y Decoding" below — CRITICAL path for PARSER-02 and torn-chunk (PARSER-03) |

### ESC Y Decoding (PARSER-02, the bug that shipped in mintty)

The row and column bytes are each sent **with a +0x20 (32, SPACE) bias**.
[CITED: vt100.net/docs/vt52-mm/chapter2.html, en.wikipedia.org/wiki/VT52]

Row/col mapping (0-indexed internally):
- Byte 0x20 (SPACE) → row 0 (or col 0 — VT52 sends row first, per manual)
- Byte 0x21 → row 1
- Byte 0x37 (`7`) → row 23 (last row of 24-row screen)
- Byte 0x20+79 = 0x6F (`o`) → col 79 (last col of 80-col screen)

Wikipedia and some secondary sources describe this as "+31 to 1-indexed positions",
which is algebraically equivalent: `raw_byte = 1-indexed_pos + 31 = 0-indexed_pos + 32`.
[CITED: en.wikipedia.org/wiki/VT52] Store as 0-indexed inside the parser; report as
0-indexed in test traces to make diffs readable.

**Saturation + clamp formula (PITFALLS.md #3):**

```rust
fn decode_esc_y_byte(raw: u8, max: u32) -> u32 {
    let offset = raw.saturating_sub(0x20) as u32;
    offset.min(max)
}

// Usage:
let row = decode_esc_y_byte(raw_row, (ROWS - 1) as u32);
let col = decode_esc_y_byte(raw_col, (COLS - 1) as u32);
```

**Required unit-test edges (PARSER-02):**

| Input | Expected row | Rationale |
|-------|-------------:|-----------|
| `ESC Y 0x20 0x20` | (0, 0) | Base case — top-left |
| `ESC Y 0x37 0x6F` | (23, 79) | Max valid — bottom-right on 80×24 |
| `ESC Y 0x1F 0x1F` | (0, 0) | Underflow — saturation pins to 0 |
| `ESC Y 0x7F 0x7F` | (23, 79) | Overflow — clamp pins to max |
| `ESC Y 0x20 0x6F` | (0, 79) | Row min, col max |
| `ESC Y 0x37 0x20` | (23, 0) | Row max, col min |

**Common bugs to assert against:**
1. Confusing `0x20` (space) with `0x30` (`'0'`) — would give row-off-by-16 on the whole
   bottom half of the screen.
2. Swapping row/col order — DEC manual is unambiguous: row first.
3. Treating bytes as ASCII digits instead of raw-byte-minus-0x20.
4. Allocating i/o-signed arithmetic that UB-panics on underflow instead of saturating.

### Torn-Chunk Test Harness (PARSER-03)

The single highest-leverage test in Phase 1. Splits every multi-byte sequence at every
internal offset and asserts identical end state to the unsplit feed.

**Pattern (Rust):**

```rust
fn assert_identical_across_splits<T: Terminal>(bytes: &[u8], make: impl Fn() -> T, assert_eq_state: impl Fn(&T, &T)) {
    let mut baseline = make();
    baseline.feed(bytes);

    for split in 1..bytes.len() {
        let (a, b) = bytes.split_at(split);
        let mut torn = make();
        torn.feed(a);
        torn.feed(b);
        assert_eq_state(&baseline, &torn);
    }
}

#[test]
fn esc_y_torn_every_offset() {
    let seq = b"\x1BY\x23\x45";  // ESC Y row=3 col=37
    assert_identical_across_splits(seq, || Terminal::new(24, 80, 10_000), eq_state);
}

#[test]
fn esc_z_identify_torn() {
    // ESC Z is a single-byte-after-ESC sequence; splits are ESC | Z.
    let seq = b"\x1BZ";
    assert_identical_across_splits(seq, || Terminal::new(24, 80, 10_000), eq_state);
}
```

**Required torn-chunk tests (minimum set):**
- `ESC A`, `ESC B`, `ESC C`, `ESC D`, `ESC H`, `ESC I`, `ESC J`, `ESC K`, `ESC Z`
  (split at ESC|letter)
- `ESC Y <r> <c>` (split at ESC|Y_rc, ESC_Y|rc, ESC_Y_r|c) — 3 internal splits
- `ESC F/G/=/>` (split at ESC|letter)
- Runs of printable bytes interleaved with ESC sequences: `Hello\x1BAWorld` split at
  every offset (8 internal splits); asserts the ESC in the middle doesn't eat the `A`
  after ESC_A's completion

**State comparison:** Write `eq_state(a, b)` to compare grid contents, cursor position,
`bell_pending`, dirty bitmap, and the accumulated host-bound reply buffer. A shallow
`#[derive(PartialEq)]` on the state struct is the cleanest approach.

---

## Architecture Patterns

### System Architecture Diagram (Phase 1 data flow only)

```
     ┌────────────────────────────────────────────┐
     │            bestialitty-core (rlib)          │
     │                                              │
     │   feed(bytes) ─┐                             │
     │                ▼                             │
     │   ┌──────────────────────┐                  │
     │   │ Parser state machine │                  │
     │   │  Ground → Escape →   │                  │
     │   │   CursorRow →        │                  │
     │   │    CursorCol →       │                  │
     │   │     Ground (loop)    │                  │
     │   └──────┬───────────────┘                  │
     │          │ semantic ops (print, execute,    │
     │          │ esc_dispatch)                    │
     │          ▼                                   │
     │   ┌──────────────────────┐                  │
     │   │ Terminal (state)     │                  │
     │   │  - cursor (row,col)  │                  │
     │   │  - modes (kp/gfx)    │                  │
     │   │  - bell_pending      │                  │
     │   │  - host_reply buffer │                  │
     │   └───┬───────┬──────────┘                  │
     │       │       │                              │
     │       ▼       ▼                              │
     │  ┌────────┐ ┌─────────────┐                 │
     │  │ Grid   │ │ DirtyRows   │                 │
     │  │ Vec<   │ │ [u8; ROWS]  │                 │
     │  │ Cell>  │ │ 1=dirty     │                 │
     │  │ +      │ │             │                 │
     │  │ Scroll │ │             │                 │
     │  │ (VecD) │ │             │                 │
     │  └────────┘ └─────────────┘                 │
     │                                              │
     │   encode_key(code, mods) ──► Vec<u8>         │
     │   ┌──────────────────────┐                  │
     │   │ KeyEncoder (stateless)│                 │
     │   │  arrows → ESC A/B/C/D │                 │
     │   │  ctrl-X → 0x01..0x1F │                 │
     │   │  printable → raw u8  │                 │
     │   └──────────────────────┘                  │
     │                                              │
     └────────────────────────────────────────────┘
            ▲ rlib link                    ▲ rlib link
            │                               │
    ┌───────┴──────────────┐      ┌────────┴──────────────┐
    │ cargo test (Phase 1) │      │ wasm-bindgen lib.rs    │
    │ all unit tests       │      │ (Phase 2 — not now)    │
    └──────────────────────┘      └────────────────────────┘
```

### Recommended Crate Structure (per D-19)

```
bestialitty/
├── Cargo.toml                         # workspace root
├── rust-toolchain.toml                # optional; D "Claude's Discretion"
├── crates/
│   └── bestialitty-core/
│       ├── Cargo.toml                 # [lib] crate-type = ["cdylib", "rlib"]
│       │                              # [features] default = []
│       │                              # trace-malformed = []
│       └── src/
│           ├── lib.rs                 # wasm-bindgen exports (THIN boundary)
│           │                          # In Phase 1 this is effectively empty;
│           │                          # Phase 2 adds wasm-bindgen attrs here.
│           ├── terminal.rs            # VT52 semantic layer; owns Grid+Scrollback+Dirty
│           ├── grid.rs                # 80×24 Cell layout, Row, Cell repr(C)
│           ├── scrollback.rs          # VecDeque ring + resize logic
│           ├── dirty.rs               # Dirty-row bitmap (byte-per-row)
│           ├── key.rs                 # KeyEvent → VT52 bytes; stateless
│           └── vt52.rs                # Parser state machine + opcode dispatch
└── .planning/
    ├── decisions/
    │   └── ADR-001-parser-strategy.md  # D-04; written in this phase
    └── research/
        └── captures/                   # D-07; created in this phase
            ├── capture-01-cpm-boot/
            │   ├── bytes.bin
            │   ├── README.md
            │   └── hexdump.txt
            └── capture-02-basic/
                ├── bytes.bin
                ├── README.md
                └── hexdump.txt
```

### Cargo.toml exact shape (workspace + core crate)

**Root `Cargo.toml`:**
```toml
[workspace]
members = ["crates/bestialitty-core"]
resolver = "3"   # Edition-2024 default; explicit avoids diagnostics
```

**`crates/bestialitty-core/Cargo.toml`:**
```toml
[package]
name = "bestialitty-core"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"  # floor for Edition 2024
license = "MIT OR Apache-2.0"

[lib]
crate-type = ["cdylib", "rlib"]

[features]
default = []
trace-malformed = []  # per D-15: dev-only ring buffer

[dependencies]
# Phase 1: empty or only vte if spike picks vte path.
# vte = "0.15"  # UNCOMMENT only after D-02 spike if vte wins

[dev-dependencies]
# Any Phase 1 test helpers. Keep minimal; pure std preferred.
```

**`rust-toolchain.toml` (optional, Claude's Discretion):**
```toml
[toolchain]
channel = "stable"
# channel = "1.85" pins exact; "stable" tracks latest
components = ["rustfmt", "clippy"]
# targets intentionally omitted; wasm32 target is Phase 2's concern
```

[CITED: rust-lang.github.io/rustup/overrides.html for rust-toolchain.toml syntax]

### Pattern 1: Byte-Streaming State Machine (required regardless of D-02 outcome)

**What:** Parser consumes exactly one byte per loop iteration and transitions to
exactly one successor state. Never looks ahead. Never rewinds.

**When to use:** Every byte the parser sees, forever. This is the core discipline that
makes PARSER-03 (torn chunks) fall out for free.

**Example — hand-rolled DFA path (one of the two spike prototypes):**

```rust
// vt52.rs

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,      // normal printable + C0 processing
    Escape,      // just saw 0x1B, awaiting letter
    CursorRow,   // just saw ESC Y, awaiting row byte
    CursorCol(u8), // just saw ESC Y <row>, awaiting col byte
}

pub struct Parser { state: State }

impl Parser {
    pub fn new() -> Self { Self { state: State::Ground } }

    pub fn feed<T: Terminal>(&mut self, term: &mut T, bytes: &[u8]) {
        for &b in bytes {
            self.state = match self.state {
                State::Ground => match b {
                    0x1B => State::Escape,
                    0x07..=0x0D | 0x08 => { term.execute_c0(b); State::Ground }
                    0x20..=0x7E => { term.print(b); State::Ground }
                    _ => State::Ground, // D-15: silent discard
                },
                State::Escape => match b {
                    b'A' => { term.cursor_up();   State::Ground }
                    b'B' => { term.cursor_down(); State::Ground }
                    b'C' => { term.cursor_right();State::Ground }
                    b'D' => { term.cursor_left(); State::Ground }
                    b'H' => { term.cursor_home(); State::Ground }
                    b'I' => { term.reverse_lf();  State::Ground }
                    b'J' => { term.erase_to_end_of_screen(); State::Ground }
                    b'K' => { term.erase_to_end_of_line();   State::Ground }
                    b'Y' => State::CursorRow,
                    b'Z' => { term.emit_identify_reply(); State::Ground }
                    b'F' | b'G' | b'=' | b'>' | b'[' | b'\\' => State::Ground, // no-op
                    _ => State::Ground, // D-15
                },
                State::CursorRow => State::CursorCol(b),
                State::CursorCol(r) => {
                    let row = (r.saturating_sub(0x20) as u32).min(term.rows() - 1);
                    let col = (b.saturating_sub(0x20) as u32).min(term.cols() - 1);
                    term.move_cursor(row, col);
                    State::Ground
                }
            };
        }
    }
}
```

**Example — vte-based path (the other spike prototype):**

```rust
use vte::{Parser, Perform, Params};

pub struct TerminalPerform { /* owns grid, cursor, bell_pending, host_reply */ }

impl Perform for TerminalPerform {
    fn print(&mut self, c: char) { self.grid.put(self.cursor, c as u8); self.advance_cursor(); }
    fn execute(&mut self, byte: u8) {
        match byte {
            0x07 => self.bell_pending = true,
            0x08 => self.cursor_left_clamped(),
            0x0A => self.line_feed(),
            0x0D => self.carriage_return(),
            _ => {}
        }
    }
    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, byte: u8) {
        match byte {
            b'A' => self.cursor_up(),
            b'B' => self.cursor_down(),
            b'C' => self.cursor_right(),
            b'D' => self.cursor_left(),
            b'H' => self.cursor_home(),
            b'I' => self.reverse_lf(),
            b'J' => self.erase_to_end_of_screen(),
            b'K' => self.erase_to_end_of_line(),
            b'Z' => self.host_reply.extend_from_slice(b"\x1B/K"),
            b'F' | b'G' | b'=' | b'>' | b'[' | b'\\' => {}, // no-op per PARSER-04
            _ => {}, // D-15
        }
    }
    // Unused callbacks are no-ops (default impl or empty):
    fn csi_dispatch(&mut self, _p: &Params, _i: &[u8], _ig: bool, _a: char) {}
    fn hook(&mut self, _p: &Params, _i: &[u8], _ig: bool, _a: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_term: bool) {}
}

// CRITICAL: vte 0.15 does NOT handle ESC Y's two trailing bytes as an esc_dispatch.
// vte treats ESC Y <r> <c> as: esc_dispatch with byte='Y' THEN two separate print()
// calls for <r> and <c>. The Perform impl must be stateful: after esc_dispatch for
// 'Y', switch into an "awaiting cursor args" sub-state and consume the next two
// `print` callbacks as row+col — NOT paint them. This is the single tricky bit of
// the vte path and a major spike deliverable.
```

**Spike deliverable:** Both implementations pass the identical torn-chunk test suite
(all 9 single-letter sequences + all 3 internal splits of ESC Y + mixed runs). Author
reads both; picks winner per D-03 (readability+extensibility); writes ADR-001.

### Pattern 2: Grid + Scrollback as Single VecDeque

**What:** Alacritty's model. `VecDeque<Row>` grows on LF at bottom; front is evicted
when total length exceeds cap. Visible region is the last `rows` entries.

**When to use:** Default choice for this phase. Scalar indexing is cheap; no copy on
scroll; bounded by cap.

**Cell layout (D-09):**
```rust
#[repr(C)]
#[derive(Clone, Copy, PartialEq)]
pub struct Cell {
    pub ch: u32,     // 4 bytes — raw VT52 byte in LSB; upper bits reserved
    pub fg: u8,      // 1 byte  — palette index (not used in Phase 1; keep 0)
    pub bg: u8,      // 1 byte  — palette index (not used in Phase 1; keep 0)
    pub flags: u8,   // 1 byte  — cursor, bell-highlight, graphics-mode reserved
    _pad: u8,        // 1 byte  — alignment
}
// size_of::<Cell>() == 8, align_of == 4
```

**Row type:** `pub struct Row(pub [Cell; COLS_MAX])` if cols is compile-time constant,
OR `pub struct Row(pub Vec<Cell>)` if runtime-sized (simpler given resize support per D-17).
Recommend the Vec form — resize support is a Phase 1 requirement via `resize(rows, cols)`.

**Scrollback structure (D-11, D-12):**
```rust
pub struct Scrollback {
    rows: VecDeque<Row>,
    cols: usize,
    scrollback_cap: usize,  // D-11 default 10_000; D-12 runtime configurable
    visible_rows: usize,    // e.g. 24
}

impl Scrollback {
    pub fn new(visible_rows: usize, cols: usize, scrollback_cap: usize) -> Self {
        let mut rows = VecDeque::with_capacity(visible_rows);
        for _ in 0..visible_rows { rows.push_back(Row::blank(cols)); }
        Self { rows, cols, scrollback_cap, visible_rows }
    }

    pub fn push_line(&mut self) {
        self.rows.push_back(Row::blank(self.cols));
        while self.rows.len() > self.visible_rows + self.scrollback_cap {
            self.rows.pop_front();
        }
    }

    pub fn resize_scrollback(&mut self, new_cap: usize) {
        self.scrollback_cap = new_cap;
        while self.rows.len() > self.visible_rows + new_cap {
            self.rows.pop_front();
        }
    }
}
```

**Memory budget (verified):** 10k lines × 80 cols × 8 bytes/cell = 6.4 MB. Comfortably
within any daily-driver budget. [CITED: PITFALLS.md #7] Actual allocation varies by
VecDeque growth strategy; plan-time empirical check with `cargo test` + a memory probe
is sufficient.

### Pattern 3: Dirty Bitmap (byte-per-row for zero-copy JS alignment)

```rust
pub struct DirtyRows(Vec<u8>);  // 1 byte per row; 1=dirty, 0=clean

impl DirtyRows {
    pub fn new(rows: usize) -> Self { Self(vec![0; rows]) }
    pub fn mark(&mut self, row: usize) { self.0[row] = 1; }
    pub fn mark_all(&mut self) { for b in &mut self.0 { *b = 1; } }
    pub fn clear(&mut self) { for b in &mut self.0 { *b = 0; } }
    pub fn as_slice(&self) -> &[u8] { &self.0 }
}
```

Byte-per-row over bit-per-row rationale: Phase 2's zero-copy JS view is
`new Uint8Array(memory.buffer, dirty_ptr, rows)` — direct byte indexing, no shifts.
24 bytes total at 80×24 is unmeasurable.

### Pattern 4: Key Encoder (pure, stateless, no DOM)

```rust
// key.rs

#[repr(u32)]
#[derive(Clone, Copy, PartialEq)]
pub enum KeyCode {
    // Printable char
    Char(u8),       // ASCII codepoint
    // Arrows
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    // Navigation / editing (minimal VT52 set)
    Enter, Tab, Backspace, Escape,
    // Keypad in alt-mode (Phase 1 doesn't track mode; emits plain chars)
    KeypadDigit(u8),  // 0-9
    KeypadEnter, KeypadComma, KeypadMinus, KeypadDot,
}

bitflags::bitflags! {  // or hand-rolled u32 if you prefer to avoid bitflags dep
    pub struct Modifiers: u32 {
        const CTRL  = 1 << 0;
        const SHIFT = 1 << 1;
        const ALT   = 1 << 2;
        const META  = 1 << 3;
    }
}

pub struct KeyEvent { pub code: KeyCode, pub mods: Modifiers }

pub fn encode(evt: KeyEvent) -> Vec<u8> {
    use KeyCode::*;
    match (evt.code, evt.mods.contains(Modifiers::CTRL)) {
        (ArrowUp,    _) => vec![0x1B, b'A'],
        (ArrowDown,  _) => vec![0x1B, b'B'],
        (ArrowRight, _) => vec![0x1B, b'C'],
        (ArrowLeft,  _) => vec![0x1B, b'D'],
        (Enter, _)      => vec![0x0D],          // CR; CR/LF toggle is Phase 4's problem
        (Tab, _)        => vec![0x09],
        (Backspace, _)  => vec![0x08],
        (Escape, _)     => vec![0x1B],
        (Char(c), true) if c.is_ascii_alphabetic() => {
            // Ctrl-letter → 0x01..0x1A (Ctrl-A = 0x01, Ctrl-Z = 0x1A)
            vec![c.to_ascii_uppercase() - b'@']
        }
        (Char(c), true) if c == b'@' || (b'['..=b'_').contains(&c) => {
            // Ctrl-@ = 0x00, Ctrl-[ = 0x1B, Ctrl-\ = 0x1C, Ctrl-] = 0x1D,
            // Ctrl-^ = 0x1E, Ctrl-_ = 0x1F
            vec![c - b'@']
        }
        (Char(c), _) => vec![c],
        (KeypadDigit(d), _) => vec![b'0' + d],  // Phase 1 does NOT track ESC =/>; Phase 4 can
        (KeypadEnter, _)    => vec![0x0D],
        (KeypadComma, _)    => vec![b','],
        (KeypadMinus, _)    => vec![b'-'],
        (KeypadDot, _)      => vec![b'.'],
    }
}
```

**Exhaustive tests (PARSER-08 + D-13):**
- Every Ctrl-letter A..Z → 0x01..0x1A
- Every Ctrl-symbol (@, [, \, ], ^, _) → 0x00..0x1F boundary values
- Every arrow → ESC letter
- Every printable ASCII 0x20..0x7E → unchanged
- Enter/Tab/BS/Esc → correct C0 byte

### Anti-Patterns to Avoid

- **Scan-forward parsing.** Any code that reads "the next byte" without a state transition in between breaks torn-chunk handling. PITFALLS.md #2. Hard rule: one byte consumed → exactly one state transition → loop.
- **Per-byte `Vec` allocation in `feed()`.** `feed()` gets a `&[u8]`; keep it a borrow. The only `Vec<u8>` allocation in the hot path is the host-bound reply, which is typically empty (returned as an empty Vec).
- **Unsigned arithmetic without saturation on ESC Y.** Any `byte - 0x20` where `byte < 0x20` is a silent wrap in `u32::wrapping_sub` or a panic in debug/subtract overflow checked mode. PITFALLS.md #3. Use `saturating_sub`.
- **Rust error types that leak into the wasm ABI.** Phase 2 would have to unwrap them anyway. Keep parser errors internal; surface via `trace-malformed` ring (D-15) or `Result<(), ()>` return values at boundary, not enum variants.
- **Reading "next byte" from a sub-slice inside esc_dispatch (vte path).** vte calls esc_dispatch for the `Y` byte and then delivers the row/col bytes as `print` callbacks. Must keep a Perform-level sub-state machine for the ESC Y case.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ANSI/VT100 parser state machine | Your own Paul Williams DFA | `vte` crate (IF D-02 spike picks vte) | Full VT500 grammar including CSI/OSC/DCS/SOS is non-trivial; vte has years of edge-case fixes. Does NOT apply to a pragmatic VT52-only DFA, which is ~50 states and trivially hand-rolled — that's what D-02 decides. |
| VecDeque | Custom ring buffer over a Vec | `std::collections::VecDeque` | std, well-optimized, O(1) push/pop both ends, no unsafe |
| Bitflags | Hand-roll u32 with const masks | `bitflags` crate (if bringing a dep is OK) | Very small convenience; hand-rolled is also fine — discretionary |
| Saturating arithmetic | Custom overflow checks | `u8::saturating_sub`, `u32::min` from std | Built-in, branch-predictable, compiles to `SUBS`+`SELECT` |
| Torn-chunk-test helper | Write one assertion at a time | The systematic `assert_identical_across_splits` helper | Write ONCE, use for every multi-byte sequence. This is the shape that catches Pitfall #2. |
| Hexdump annotation | Hand-format hex bytes for capture docs | `xxd -c 16` (verified present) | Canonical output format; reviewable on diff |

**Key insight:** The "don't hand-roll" call for THIS phase is narrow because the
CONTEXT locks out a lot of hand-rolling that would otherwise be questionable
(graphics-mode glyph tables, scrollback UI, persistence). The genuine spike is
`vte` vs hand-rolled DFA for the VT52 subset — and the spike's purpose is to decide
that trade-off empirically, not by research.

---

## Runtime State Inventory

N/A — Phase 1 is greenfield. No existing runtime state, stored data, live services,
OS registrations, secrets, or build artifacts to migrate. The repo is empty of code
at Phase 1 start; `./CLAUDE.md`, `.planning/`, and the `.claude/` directories are
the only existing files.

---

## Common Pitfalls (Phase 1 scope: PITFALLS.md #2, #3, #4, #7, #10)

### Pitfall 1: ESC Sequence Split Across Chunk Boundaries (PITFALLS.md #2)

**What goes wrong:** MicroBeast sends `ESC Y 0x20 0x27`. OS delivers as `ESC Y 0x20`
then `0x27`. Stateless-per-chunk parser sees `ESC Y` + partial row → panics or emits
garbage.
**Root cause:** Web Serial chunks are not message-framed; VT52's one multi-byte
sequence (`ESC Y row col`) is easy to overlook.
**How to avoid:** Byte-at-a-time state machine with explicit states (done via Pattern 1
above). Batch-feed via `feed(&[u8])` but iterate byte-by-byte *inside* the function
(avoids boundary chattiness per PITFALLS.md #4 while preserving correctness).
**Warning signs:** Tests pass with full-sequence input but never exercise split
input; visual corruption appears at high baud rates only.
**Phase 1 mitigation:** `assert_identical_across_splits` helper + required torn-chunk
test list in Pattern 1. PARSER-03 verification.

### Pitfall 2: ESC Y +32 Offset Bug (PITFALLS.md #3; real-world: mintty#1299)

**What goes wrong:** Getting the 0x20 bias wrong (using 0x30 / ASCII digits / negative
arithmetic). Cursor teleports; bottom of screen never written.
**Root cause:** VT52 predates common encoding conventions; `0x20` offset is easy to
mix with 0x30 (`'0'`).
**How to avoid:** `saturating_sub(0x20).min(MAX)` formula in decode fn. Edge-case
unit tests in the PARSER-02 edge table BEFORE writing the parser itself (TDD).
**Warning signs:** `vi`/`ed`/full-screen programs position cursor off by exactly 16 or 48.
**Phase 1 mitigation:** Write the 6-edge unit test from "ESC Y Decoding" before any
parser code. PARSER-02 verification.

### Pitfall 3: wasm Boundary Chattiness (PITFALLS.md #4)

**What goes wrong:** API shaped as per-byte `feed_byte(b)` creates 11.5k boundary
crossings/sec at 115200 baud.
**Root cause:** Intuitive API shape; wasm-bindgen makes small calls look cheap.
**How to avoid:** Boundary is `feed(bytes: &[u8]) -> Vec<u8>` — one call per chunk.
Iteration is internal to the Rust parser.
**Warning signs:** In Phase 2, DevTools shows many `__wbindgen_*` calls per chunk.
**Phase 1 mitigation:** The `feed(&[u8])` signature is locked in D-14/D-17. Phase 1
must not expose a `feed_byte` variant. Benchmark (optional per "Deferred Ideas")
confirms in Phase 2.

### Pitfall 4: Scrollback OOM on Long Sessions (PITFALLS.md #7)

**What goes wrong:** Naive growable array fills memory during 6+ hour session.
**Root cause:** No cap; per-JS-object overhead on JS-resident scrollback.
**How to avoid:** D-11/D-12 already cap at 10k lines default, runtime configurable.
`VecDeque::pop_front` on cap-exceeded is O(1).
**Warning signs:** Memory graph climbs monotonically; GC pauses.
**Phase 1 mitigation:** Unit test that feeds > 10k LFs and asserts
`scrollback.rows.len() <= visible + cap`; asserts oldest-line eviction order.
PARSER-08 coverage extension.

### Pitfall 5: TextDecoder Byte Corruption (PITFALLS.md #10)

**What goes wrong:** If a later phase wraps input in `TextDecoderStream`, VT52's
`ESC Y 0x20 0x27` gets mangled (0x20 is whitespace-normalized, high bytes replaced
with U+FFFD).
**Root cause:** Serial is bytes, not text; UTF-8 decoder holds state across partial
multi-byte sequences.
**How to avoid:** Phase 1 enforces `feed(&[u8])` signature. No `String` parameters
anywhere in the public crate surface. Ensures Phase 5 transport has no easy way to
insert a TextDecoder without explicitly widening the API.
**Warning signs:** Missing high-bit bytes; garbled output only on specific chunk
boundaries.
**Phase 1 mitigation:** API signature enforcement; lint/code-review during plan.

### Pitfall 6 (Phase-1-specific): Parser Not Wiring Into `cargo test` As rlib

**What goes wrong:** Crate-type accidentally set to `["cdylib"]` only; `cargo test`
can't link the tests because there's no rlib output, or tests pull in wasm-bindgen
which can't target native.
**Root cause:** Copy-paste from wasm-pack guide which typically shows only `cdylib`.
**How to avoid:** `[lib] crate-type = ["cdylib", "rlib"]` per D-19. Cargo compiles
both for `cargo test`. No `wasm_bindgen_test` in Phase 1.
**Warning signs:** `cargo test` produces "cannot find function" linker errors; Phase 5
success criterion #5 (`cargo build --target x86_64-unknown-linux-gnu && cargo test`)
fails.
**Phase 1 mitigation:** CI job runs both commands; first integration test is an empty
`#[test]` fn proving the crate links as rlib.

### Pitfall 7 (Phase-1-specific): vte Version API Drift

**What goes wrong:** `vte::Parser::advance(performer, &[u8])` in 0.15 vs older
per-byte `advance(performer, u8)` in very old vte versions. Hand-rolled prototype
works differently.
**Root cause:** vte API changed across major versions.
**How to avoid:** At plan time, `cargo search vte --limit 1` to confirm current
version. Pin with `vte = "=0.15.x"` in Cargo.toml. [CITED: docs.rs/vte/latest]
**Warning signs:** Compiler error on `advance` call signature; cryptic type mismatches.
**Phase 1 mitigation:** Plan task "Verify vte version + pin" must run before
prototyping in the vte path of the spike.

---

## Code Examples

Verified patterns. Several are drawn from ARCHITECTURE.md patterns already researched
for this project; re-emitted here with Phase 1 scope.

### Example 1: `feed` signature with host-bound reply (D-14, D-17)

```rust
// src/terminal.rs

pub struct Terminal {
    parser: Parser,
    grid: Grid,
    scrollback: Scrollback,
    dirty: DirtyRows,
    cursor: Cursor,
    modes: Modes,  // graphics-mode flag, keypad-mode flag; all no-op in Phase 1
    bell_pending: bool,
    host_reply: Vec<u8>,  // accumulator per feed() call
}

impl Terminal {
    pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Self { /* ... */ }

    /// Hot path. Processes bytes, mutates state, accumulates host-bound reply
    /// (currently only used by ESC Z → ESC / K).
    /// Returns bytes the JS shell must write to port.writable.
    /// Return is typically empty; one-shot reply on rare sequences.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8> {
        self.host_reply.clear();  // reused; amortized zero allocation after first call
        self.parser.feed(self, bytes);
        std::mem::take(&mut self.host_reply)
    }

    pub fn bell_pending(&self) -> bool { self.bell_pending }
    pub fn clear_bell(&mut self) { self.bell_pending = false; }
    pub fn cursor(&self) -> (u32, u32) { (self.cursor.row, self.cursor.col) }

    pub fn resize(&mut self, rows: u32, cols: u32) { /* ... */ }
    pub fn resize_scrollback(&mut self, new_cap: usize) { /* ... */ }
}
```

### Example 2: Paired fixture test (D-16)

**`tests/fixtures/basic/session.bin`** (hex): `48 65 6C 6C 6F 0A 1B 59 23 45 41`

**`tests/fixtures/basic/session.trace`**:
```
print 'H'
print 'e'
print 'l'
print 'l'
print 'o'
line_feed
move_cursor(3, 37)
print 'A'
```

**Loader:**
```rust
// tests/fixture_runner.rs

use std::fs;

fn run_fixture(name: &str) {
    let bin = fs::read(format!("tests/fixtures/{name}/session.bin")).unwrap();
    let trace_expected = fs::read_to_string(format!("tests/fixtures/{name}/session.trace")).unwrap();

    let mut term = RecordingTerminal::new(24, 80, 10_000);
    term.feed(&bin);

    let trace_actual = term.emitted_ops_trace();
    assert_eq!(trace_actual.trim(), trace_expected.trim(), "trace mismatch for {name}");
}

#[test] fn fixture_basic() { run_fixture("basic"); }
#[test] fn fixture_esc_y_all_edges() { run_fixture("esc_y_edges"); }
#[test] fn fixture_torn_esc_y() { run_fixture("torn_esc_y"); }
// ... one per fixture dir
```

**Why paired format:** Diffs are reviewable in plain text. Adding a test = writing
two files, no Rust code. Catches per-op ordering bugs, not just end-state equivalence.

### Example 3: Torn-chunk systematic harness (PARSER-03)

Shown in Pattern 1 above; see "Torn-Chunk Test Harness".

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full VT100/ANSI parser for any terminal | Scoped to actually-used dialect | Alacritty `vte` design, ~2018 | Cuts parser surface by 80%+ for VT52 |
| Per-byte boundary call | Batched `feed(&[u8])` across wasm ABI | rustwasm/wasm-bindgen#1119 discussion, ~2019 | 10-100× throughput at cost of internal iteration — no real tradeoff |
| JS object per cell / JSON round-trip | Zero-copy `Uint8Array` views over wasm memory | wasm-bindgen guides, js-sys `Uint8Array::view` | Eliminates per-frame GC pressure |
| Rust Edition 2021 | Rust Edition 2024 | Stabilized in Rust 1.85 (Feb 2025) [CITED: blog.rust-lang.org/2025/02/20] | Use Edition 2024 for new crates |
| vte 0.13.x `advance` per-byte | vte 0.15 `advance(performer, &[u8])` byte-slice | vte 0.15.0 release | Matches our batched API shape natively; no glue needed [CITED: docs.rs/vte/latest/vte/struct.Parser.html] |

**Deprecated / outdated:**
- `wee_alloc`: unmaintained, known memory leak. [CITED: wee_alloc repo] Default
  allocator is correct for Phase 1 (pure-logic core; no bundle-size pressure because
  we're not even producing wasm yet).
- Strict DEC VT52 conformance outside MicroBeast scope: explicit project non-goal
  per CLAUDE.md.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Default VT52 CR/LF convention is "CR → col 0 same row; LF → row+1 same col; CRLF → newline" | VT52 Opcode Table / C0 control bytes | MEDIUM — MicroBeast may differ (CP/M tradition often is LF-implies-CR). Resolved by D-06 live capture. |
| A2 | `vte` 0.15.0 is the current latest at plan time | Standard Stack | LOW — docs.rs says 0.15 but crates.io page didn't render; verify via `cargo search vte` at plan start. If 0.13 is actually current, the `advance` signature differs and spike plan must account for it. |
| A3 | `vte`'s ESC Y handling via esc_dispatch + two subsequent print callbacks is current-version accurate | Pattern 1 / vte-based code example | MEDIUM — vte's exact dispatch of multi-byte-after-ESC has varied. Spike must verify by running the torn-chunk test suite against the vte prototype BEFORE committing to the path. |
| A4 | MicroBeast uses the standard VT52 subset documented in DEC manual ch.2/3 | VT52 Opcode Table | HIGH if wrong; MitigatIon is D-06 live capture which grounds the inventory before the spike. |
| A5 | 10,000-line scrollback at 80 cols × 8 bytes = 6.4 MB is within budget on a daily-driver browser session | Pattern 2 / scrollback | LOW — xterm.js/VS Code Terminal validate similar sizes. Soak test is Phase 6 concern. |
| A6 | `rust-toolchain.toml` syntax `channel = "stable"` + optional `channel = "1.85"` works on rustup 1.29 | Cargo.toml structure | LOW — verified against rustup official docs. [CITED: rust-lang.github.io/rustup/overrides.html] |
| A7 | `tio -b 19200 -d 8 -p none -s 1 -f none -L --output-mode hex /dev/ttyUSB0` is the correct capture invocation | Live Capture Workflow | LOW — verified against Debian manpage. Exact device path (`/dev/ttyUSB0`, `/dev/ttyACM0`, `/dev/tty.usbserial-*`) varies by OS and adapter; D-05 lets author adapt. |

All other claims in this research are VERIFIED against named sources or explicitly
locked by CONTEXT.md. The Assumptions Log should be reviewed by the planner before
locking the plan; A1, A3, A4 in particular need live-capture resolution *during*
Phase 1 (they're the reason D-06's capture comes before the spike).

---

## Open Questions (RESOLVED)

All five items below were resolvable from decisions already locked in CONTEXT.md
(D-01..D-20) and the phase requirements. Recorded here for traceability; none
block planning or execution.

1. **MicroBeast CR/LF convention** — **RESOLVED.**
   Phase 1 parser ships with standard VT52 behaviour (CR = return-to-col-0, LF =
   advance-row). Plan 02 records the observed convention in
   `capture-01-cpm-boot/README.md`. If the capture is deferred per D-08, the
   default is still correct; Phase 4 owns the optional "LF implies CR" toggle
   (INPUT-05) — not a Phase 1 concern.

2. **Whether MicroBeast ever emits ESC F/G graphics-mode sequences** — **RESOLVED.**
   PARSER-04 locks silent no-op for `ESC F / G / = / >` in Phase 1 regardless
   of live-capture outcome. If usage surfaces later, Phase 3's JS glyph renderer
   owns the lookup table; the Rust core stays unchanged.

3. **Whether `bell_pending` needs to be a counter or a boolean** — **RESOLVED.**
   Boolean for Phase 1 (CONTEXT.md "Claude's Discretion" explicitly allows this).
   Phase 3 renderer can debounce. Trivially upgradable if later required.

4. **Exact `vte` crate current version** — **RESOLVED.**
   Plan 03 Task 1 (vte-path spike prototype) runs `cargo search vte` live and
   pins the resolved version in the spike's Cargo.toml; ADR-001 records the
   version used. No up-front answer required at plan time.

5. **Should the `trace-malformed` buffer capacity be a compile-time const or
   runtime-configurable?** — **RESOLVED.**
   Compile-time `const MALFORMED_RING_CAP: usize = 256;` (CONTEXT.md "Claude's
   Discretion"). Feature-gated, default-off; release builds have zero overhead.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (cargo + rustc) | All Phase 1 build + test | yes | 1.94.1 (> floor 1.85) | — |
| rustup | optional toolchain pin | yes | 1.29.0 | hand-install toolchain; hobby project is fine without rustup pin |
| cargo edition 2024 support | Edition 2024 | yes (Rust ≥ 1.85) | built-in on 1.94.1 | — |
| `tio` | D-05 live capture | yes | 2.7 | `minicom` (also present) or `screen -L` |
| `minicom` | D-05 fallback | yes | 2.9 | `screen` (present as built-in on most *nix; verified NOT present in PATH here) |
| `screen` | D-05 third fallback | **no** | — | Two primary options already present |
| `xxd` | D-07 hexdump.txt | yes | system | `hexdump` (also present) |
| `hexdump` | D-07 hexdump.txt alt | yes | system | `od -An -v -t x1` (present) |
| MicroBeast hardware | D-06 live capture | unknown (author's desk) | — | Fall back to DEC-manual-derived torn-chunk fixtures for parser (D-08 explicitly allows this); flag live-capture as "do when MicroBeast is accessible" |
| USB-serial adapter (CP2102N) | D-06 live capture | unknown | — | Same — D-08 allows defer |
| wasm-pack | Phase 2, NOT Phase 1 | yes (0.12.1) | 0.12.1 (older than Stack research's 0.13.x) | Flag for Phase 2 planner: may need `cargo install wasm-pack` upgrade then |

**Missing dependencies with no fallback:**
- MicroBeast hardware + USB-serial adapter: blocks D-06 live capture. Per D-08, parser
  work does NOT gate on this — hand-crafted torn-chunk fixtures derived from the DEC
  manual cover the parser test surface. Planner should structure the phase so capture
  is an early optional stream, and parser work proceeds in parallel using DEC-fixture
  data.

**Missing dependencies with fallback:**
- `screen -L` is not in PATH; `tio` or `minicom` is the primary path. No action
  required.

**Flag for Phase 2:** `wasm-pack 0.12.1` is present; STACK.md targets `0.13.x`. Phase 2
planning needs a version-check/upgrade task.

---

## Validation Architecture

Nyquist validation is enabled for this project (config.json has
`workflow.nyquist_validation: true`). Phase 1 is pure Rust logic with no browser
involvement, so the full validation surface is `cargo test`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust built-in test harness, Rust 1.94.1) |
| Config file | none beyond `Cargo.toml` `[dev-dependencies]` section |
| Quick run command | `cargo test -p bestialitty-core` |
| Full suite command | `cargo test --all --all-features` |
| CI build sanity | `cargo build --target x86_64-unknown-linux-gnu --all` (Phase 1 success criterion #5) |
| Format check | `cargo fmt --check` |
| Lint | `cargo clippy --all -- -D warnings` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PARSER-01 | ESC A/B/C/D/H/I cursor movement | unit | `cargo test -p bestialitty-core cursor_movement` | ❌ Wave 0 |
| PARSER-01 | ESC Y direct addressing (integration with cursor model) | unit | `cargo test -p bestialitty-core esc_y` | ❌ Wave 0 |
| PARSER-01 | ESC J erase-to-end-of-screen | unit | `cargo test -p bestialitty-core esc_j_erase` | ❌ Wave 0 |
| PARSER-01 | ESC K erase-to-end-of-line | unit | `cargo test -p bestialitty-core esc_k_erase` | ❌ Wave 0 |
| PARSER-02 | ESC Y +32 offset edge cases (6-row table) | unit | `cargo test -p bestialitty-core esc_y_offset_edges` | ❌ Wave 0 |
| PARSER-03 | Torn-chunk equivalence (`assert_identical_across_splits`) | unit | `cargo test -p bestialitty-core torn_chunk` | ❌ Wave 0 |
| PARSER-04 | ESC F/G/=/> silent no-ops | unit | `cargo test -p bestialitty-core noop_sequences` | ❌ Wave 0 |
| PARSER-05 | ESC Z returns `ESC / K` reply via `feed()` return Vec | unit | `cargo test -p bestialitty-core identify_response` | ❌ Wave 0 |
| PARSER-06 | BEL (0x07) sets `bell_pending` flag | unit | `cargo test -p bestialitty-core bell_flag` | ❌ Wave 0 |
| PARSER-07 | Default CR/LF behavior matches captured MicroBeast session | fixture-driven unit | `cargo test -p bestialitty-core fixture_cpm_boot` | ❌ Wave 0 (requires D-06 capture first, but can use DEC-manual fixture as placeholder) |
| PARSER-08 | Full parser test suite green | meta | `cargo test -p bestialitty-core` | ❌ Wave 0 |
| CORE-01 | Crate builds as rlib with zero wasm-bindgen involvement | build | `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` | ❌ Wave 0 |
| CORE-02 | No `web-sys` / `js-sys::Serial*` in dependency tree | static | `cargo tree -p bestialitty-core \| grep -Eq 'web-sys\|js-sys' && exit 1 \|\| exit 0` | ❌ Wave 0 |

Additional scrollback + key-encoder tests (PARSER-08 extension):

| Behavior | Test Type | Automated Command |
|----------|-----------|-------------------|
| Scrollback cap enforcement (feed > cap lines, assert eviction) | unit | `cargo test -p bestialitty-core scrollback_cap` |
| `resize_scrollback` shrinks via front-eviction | unit | `cargo test -p bestialitty-core resize_scrollback_shrink` |
| Key encoder: every Ctrl-letter → 0x01..0x1A | unit | `cargo test -p bestialitty-core encode_ctrl_letters` |
| Key encoder: arrows → ESC A/B/C/D | unit | `cargo test -p bestialitty-core encode_arrows` |
| Key encoder: printable pass-through | unit | `cargo test -p bestialitty-core encode_printable` |
| Paired fixture format runs | integration (fixture dir) | `cargo test --test fixture_runner` |

### Sampling Domain and Nyquist Floor

- **Sampling domain:** the set of all byte streams the MicroBeast can emit. Finite-ish
  in practice: 256 byte values × a small opcode table with one 3-byte sequence (ESC Y)
  and a handful of 2-byte sequences.
- **Critical frequency (Nyquist floor):** to catch torn-chunk bugs we must test every
  multi-byte sequence split at every internal offset. For `ESC Y <r> <c>` this is
  N-1 = 3 splits (split-after-0, split-after-1, split-after-2) plus the unsplit case.
  For every 2-byte sequence (`ESC A` etc.) it is 1 split (split-after-ESC). For 11
  single-after-ESC sequences + 1 three-byte sequence that's 11 + 3 = 14 torn-chunk
  invariants minimum. Plus the 6-edge ESC Y offset table. Plus fixture-driven tests
  from D-06 captures.
- **Key encoder coverage:** exhaustive by construction — 26 Ctrl-letters, 6 Ctrl-symbols,
  4 arrows, 4 navigation keys, 10 keypad digits, printable ASCII range. ~70 distinct
  encode calls × a small modifier set. Table-driven fits a single test fn.
- **Grid/scrollback coverage:** state-transition + boundary cases. Cursor at top+ESC A
  = stay; cursor at bottom+LF = scroll; push > cap rows = oldest evicted; resize rows
  expanded = bottom rows are blank, not uninitialized.

### Per-task / per-wave sampling rate

- **Per task commit:** `cargo test -p bestialitty-core` (quick; < 5 seconds for a
  pure-logic crate this size).
- **Per wave merge:** `cargo test --all --all-features` + `cargo fmt --check`
  + `cargo clippy --all -- -D warnings` + `cargo build --target x86_64-unknown-linux-gnu`.
- **Phase gate:** Full suite green before `/gsd-verify-work`; ADR-001 committed;
  captures committed under `.planning/research/captures/` OR D-08 justification
  documented.

### Wave 0 Gaps (must be created before Wave 1 implementation tasks can start)

- [ ] `crates/bestialitty-core/Cargo.toml` — crate skeleton with `cdylib + rlib`
- [ ] `crates/bestialitty-core/src/lib.rs` — empty module tree / re-exports
- [ ] `crates/bestialitty-core/tests/fixture_runner.rs` — fixture loader harness
- [ ] `crates/bestialitty-core/tests/fixtures/` — directory; one fixture subdirectory
      per test case; at minimum: `esc_y_edges/`, `noop_sequences/`, `identify_reply/`,
      `basic_print/`, `bell/`, `erase_j/`, `erase_k/`, `torn_esc_y_01/`, `torn_esc_y_12/`
- [ ] Workspace `Cargo.toml` root
- [ ] (Optional) `rust-toolchain.toml`
- [ ] `.planning/decisions/` directory
- [ ] `.planning/research/captures/` directory

Test framework itself is built into `cargo`; no install needed.

---

## Security Domain

Per config.json, `security_enforcement` is not explicitly set. Phase 1 is a pure-Rust
pure-logic crate with no network, no file-system writes (beyond test fixtures read from
disk), no secrets, no crypto, and no user input crossing trust boundaries. Most ASVS
categories do not apply.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | N/A — no auth surface |
| V3 Session Management | no | N/A — no sessions |
| V4 Access Control | no | N/A — single-user local library |
| V5 Input Validation | yes (bounded) | Parser treats ALL input bytes as data; saturation+clamp on ESC Y offsets prevents byte-integer underflow/overflow; explicit state machine prevents scan-forward CVE patterns |
| V6 Cryptography | no | N/A — no crypto in this phase |
| V8 Error Handling | yes | Parser uses silent-discard policy on malformed input (D-15); `trace-malformed` feature gates dev tracing; no panic on untrusted byte streams |
| V12 File and Resources | partial | Test fixture loader reads fixed-path files from the repo; no user-controlled paths |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Integer overflow/underflow on byte arithmetic | Tampering | `saturating_sub`, `min(MAX)` clamps; explicit typing as `u32` after coercion; no `as i32` downcasts |
| Infinite loop on malformed input | DoS | Bounded state machine: every byte transitions to exactly one successor state in O(1); no "scan forward" patterns |
| Stack overflow from deeply nested sequences | DoS | State machine has depth 2 (Ground → Escape → CursorRow → CursorCol) — no recursion, no unbounded stack growth |
| Memory exhaustion via scrollback | DoS | D-11/D-12: scrollback cap enforced on every `push_line` via `pop_front` loop |
| Memory exhaustion via host-reply accumulation | DoS | `host_reply` Vec is cleared at start of every `feed()` call; only ESC Z appends (3 bytes); bounded |
| Panic-on-invalid-input crashing the crate | DoS | Never `unwrap()` / `expect()` on byte-stream-derived indices; always use saturation+clamp |
| Malicious Cargo dependency compromise | Supply chain | Minimal deps (only `vte` or zero); pin exact version in Cargo.lock; plan-time check with `cargo tree` |

---

## Sources

### Primary (HIGH confidence)

- [DEC VT52 DECscope Maintenance Manual, Chapter 2 — escape sequence behavior](https://vt100.net/docs/vt52-mm/chapter2.html) — authoritative single-byte and multi-byte ESC sequences; ESC Y bias; ESC Z identify response
- [DEC VT52 DECscope Maintenance Manual, Chapter 3 — keypad and control keys](https://vt100.net/docs/vt52-mm/chapter3.html) — alternate keypad mode, keypad control keys
- [Paul Williams ANSI parser (VT100.net)](https://vt100.net/emu/dec_ansi_parser) — state-machine model referenced by both parser candidates in the spike
- [docs.rs/vte — current Perform trait + Parser::advance API](https://docs.rs/vte/latest/vte/trait.Perform.html) — verified vte 0.15.0 API
- [docs.rs/vte/latest/vte/struct.Parser.html](https://docs.rs/vte/latest/vte/struct.Parser.html) — confirmed `advance(&mut self, performer, &[u8])` signature
- [crates.io/crates/vte](https://crates.io/crates/vte) — crate page (version page didn't render in fetch; plan-time `cargo search` is authoritative)
- [Alacritty/vte on GitHub](https://github.com/alacritty/vte) — source + README (README lags at 0.13.0; likely not updated since latest release)
- [wasm-bindgen/wasm-pack on Context7](https://context7.com/wasm-bindgen/wasm-pack) — not needed for Phase 1 but referenced by ARCHITECTURE.md
- [Rust 1.85 release announcement — Edition 2024 stabilization](https://blog.rust-lang.org/2025/02/20/Rust-1.85.0/) — confirms Edition 2024 available on stable from 1.85 forward
- [rustup overrides documentation](https://rust-lang.github.io/rustup/overrides.html) — rust-toolchain.toml syntax verified
- [Debian manpage for tio(1)](https://manpages.debian.org/testing/tio/tio.1.en.html) — verified tio invocation flags for D-06 capture

### Secondary (MEDIUM confidence)

- [Wikipedia — VT52](https://en.wikipedia.org/wiki/VT52) — cross-reference for ESC Y encoding (+31 1-indexed = +32 0-indexed)
- [mintty#1299 — VT52 ESC Y cursor addressing broken](https://github.com/mintty/mintty/issues/1299) — real-world example of the +32 offset bug shipping; cited in PITFALLS.md #3
- [rustwasm/wasm-bindgen#1119 — boundary chattiness](https://github.com/rustwasm/wasm-bindgen/issues/1119) — cited in PITFALLS.md #4; relevant to D-14 API shape
- [Alacritty scrollback PR #657](https://github.com/alacritty/alacritty/pull/657) — VecDeque<Row> scrollback precedent
- [xterm.js#518 — infinite scrollback memory cost](https://github.com/xtermjs/xterm.js/issues/518) — cited in PITFALLS.md #7

### Tertiary (LOW confidence — MicroBeast-specific, needs D-06 live capture)

- MicroBeast 19200 8N1 no-flow-control default (inferred from community posts and
  16c550 UART docs; XPORT-04 says "verify in Phase 1 live capture")
- MicroBeast CR/LF convention — unverified; resolved by D-06
- Whether MicroBeast programs ever emit ESC F/G graphics mode — unverified

### In-repo research documents (load-bearing)

- `/home/ant/src/microbeast/bestialitty/.planning/research/STACK.md` — "do NOT use vte wholesale" argument
- `/home/ant/src/microbeast/bestialitty/.planning/research/ARCHITECTURE.md` — "use vte::Parser + Perform" argument, cell layout, wasm-boundary shape
- `/home/ant/src/microbeast/bestialitty/.planning/research/PITFALLS.md` — #2 torn chunks, #3 ESC Y offset, #4 boundary chattiness, #7 scrollback OOM, #10 TextDecoder
- `/home/ant/src/microbeast/bestialitty/.planning/research/FEATURES.md` — VT52 sequence inventory, identify-response, BEL semantics
- `/home/ant/src/microbeast/bestialitty/.planning/research/SUMMARY.md` — cross-doc synthesis, explicit parser-strategy unresolved decision

---

## Metadata

**Confidence breakdown:**
- Standard stack (Rust stable, Edition 2024, optional vte 0.15): HIGH — all versions
  verified on this machine or against docs.rs + rustup/crate registries.
- Architecture patterns (byte-streaming state machine, VecDeque scrollback, byte-per-row
  dirty bitmap, zero-copy grid pointer): HIGH — Alacritty / xterm.js / VS Code Terminal
  precedent + in-repo ARCHITECTURE.md alignment.
- VT52 opcode table: HIGH — cross-verified against vt100.net chapters 2/3, Wikipedia,
  microsoft/terminal's VT52 spec, and DEC manual PDF.
- ESC Y decoding formula: HIGH — mintty#1299 documents the canonical bug, formula is
  standard saturation+clamp arithmetic.
- Torn-chunk test harness shape: HIGH — standard property-style testing pattern; the
  novel part is the systematic split-at-every-offset loop, which is trivially correct.
- Spike winner prediction: N/A by design — the spike exists because neither STACK.md
  nor ARCHITECTURE.md position is obviously wrong. Research cannot pick; only prototyping
  + reading the code can.
- Live capture workflow: HIGH — `tio` verified present with the exact flags documented
  in the Debian manpage.
- MicroBeast-specific VT52 subset: MEDIUM-LOW — resolved only by D-06 captures, which
  are a Phase 1 deliverable, not a Phase 1 prerequisite.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stack is stable; only `vte` current version
warrants a re-check at plan time given the version-lag note)
