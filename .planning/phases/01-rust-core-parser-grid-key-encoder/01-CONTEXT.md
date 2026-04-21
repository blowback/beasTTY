# Phase 1: Rust Core — Parser, Grid, Key Encoder - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

A standalone Rust crate that correctly parses the MicroBeast's pragmatic VT52
subset, maintains an 80×24 grid with capped scrollback, and encodes
PC-keyboard input to VT52 bytes — all provable via `cargo test` with zero
browser involvement. Phase 1 also delivers the live MicroBeast byte-capture
session and the parser-strategy ADR that together ground which sequences the
parser actually handles.

**In scope:** VT52 parser (pragmatic MicroBeast subset), terminal state,
80×24 grid, VecDeque-based scrollback ring, dirty-row bitmap, key encoder,
host-bound output (ESC Z identify response), full unit tests, live capture,
parser-strategy spike + ADR, Cargo workspace layout.

**Out of scope:** wasm-pack build pipeline (Phase 2), any JS code, any
browser API, Canvas rendering (Phase 3), DOM event plumbing (Phase 4), Web
Serial transport (Phase 5), polish / persistence / deployment (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Parser strategy spike + ADR

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

### Live MicroBeast capture

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
  VT52 manual. Rationale: the author's MicroBeast workflow may not
  routinely involve a full-screen editor.

### Cell encoding + scrollback

- **D-09:** Cell layout is `#[repr(C)] struct Cell { ch: u32, fg: u8,
  bg: u8, flags: u8, _pad: u8 }` — 8 bytes, naturally aligned, row-major
  grid. Matches ARCHITECTURE.md's proposal. Headroom for theme-level
  per-cell state (cursor flag, bell-highlight flag, graphics-mode flag)
  without re-laying-out the wasm boundary.
- **D-10:** The `ch` field stores the raw VT52 byte (0x00–0xFF) today.
  Upper u32 bits are reserved for a future codepoint migration if
  needed. VT52 graphics-mode glyph translation (e.g., byte 0x67 → some
  Unicode box-drawing codepoint) happens in the JS renderer lookup
  table, not in the parser. Keeps the Rust core in the pure-logic lane.
- **D-11:** Default scrollback cap is **10,000 lines** (≈ 6.4 MB at
  80 cols × 8 bytes/cell). Matches xterm.js / VS Code Terminal defaults
  and PITFALLS.md #7 guidance. Research confirms daily-driver memory
  budget has orders of magnitude of headroom at this size.
- **D-12:** Scrollback cap is runtime-configurable via constructor arg:
  `Terminal::new(rows: u32, cols: u32, scrollback_cap: usize)`.
  A `resize_scrollback(new_cap: usize)` method re-allocates and truncates
  the oldest lines if shrinking. Phase 6's UI persistence layer can call
  this without a Rust API change.

### Phase-1 scope boundaries

- **D-13:** Full key encoder ships in Phase 1 as pure Rust logic: arrow
  keys → `ESC A/B/C/D`, Ctrl-letter → `0x01`–`0x1F`, printable → raw
  byte, plus any VT52-specific keys surfaced by the capture or DEC
  manual. Exhaustive unit tests with no DOM. Phase 4's job is limited
  to JS-side DOM event → `KeyEvent` struct packing + wiring into the
  write-to-port path. This satisfies both CORE-01 ("Rust owns key
  encoding") and the pure-logic / testable-without-browser principle.
- **D-14:** Host-bound bytes (ESC Z identify response, and any future
  sequences that require a reply) are returned from `feed()`:
  `fn feed(bytes: &[u8]) -> Vec<u8>`. Returned bytes are whatever the
  parser needs to send toward the host as a side-effect of processing
  input. Rationale: VT52 reply traffic is rare (identify response only,
  typically once per session), so per-call `Vec` allocation is on a
  cold path. This differs deliberately from the hot-path grid/dirty
  views which are zero-copy.
- **D-15:** Parser behavior on unexpected bytes (bare ESC followed by
  garbage, byte in an illegal state, etc.): silent discard + return
  to `Ground` state. In debug builds (behind a `trace-malformed`
  Cargo feature), the parser pushes `{offset, byte, state}` entries
  to a bounded ring buffer accessible to the boundary layer for dev
  tooling. Release builds have zero overhead and zero output for
  malformed input.
- **D-16:** Unit test fixture format is paired
  `session.bin` + `session.trace` files. The trace is a line-per-op
  sequence of expected high-level terminal operations (e.g.
  `print 'A'`, `move_cursor(3, 7)`, `erase_to_eol`, `ring_bell`,
  `scroll_up`). Tests feed bytes into the parser, record emitted ops,
  and diff against the expected trace. Catches per-op ordering bugs as
  well as end-state bugs; reviewable on a text diff.

### Wasm boundary shape + cross-target reuse

- **D-17:** Hot-path wasm API is **zero-copy** via stable pointers into
  wasm linear memory:
  - `grid_ptr()` / `grid_byte_len()` — row-major `Cell` buffer
  - `dirty_ptr()` / `rows()` — per-row dirty bitmap
  - `clear_dirty()` — called by renderer at end of frame
  - `cursor() -> u32` — packed `(row << 16) | col`
  - `feed(bytes: &[u8]) -> Vec<u8>` — ingest + produce host-bound reply
  - `encode_key(code: u32, mods: u32) -> Vec<u8>` — stateless
  - `resize(rows, cols)` / `resize_scrollback(n)` — may invalidate
    `grid_ptr()`; JS must re-derive views after these calls
  Honours CORE-05 ("no per-byte or per-frame grid copying").
- **D-18:** Cold-path convenience API: `get_grid() -> Vec<u8>`
  (visible-region snapshot copy). For Phase 2's minimal debug harness,
  for future native / test-harness shells where the zero-copy shape
  is not needed, and for readability-oriented tests.
- **D-19:** Cargo workspace structure:
  ```
  bestialitty/
  ├── Cargo.toml                         # workspace root
  └── crates/
      └── bestialitty-core/
          ├── Cargo.toml                 # [lib] crate-type = ["cdylib", "rlib"]
          └── src/
              ├── lib.rs                 # wasm-bindgen exports (thin boundary)
              ├── terminal.rs            # VT52 semantic layer
              ├── grid.rs                # 80×24 grid, Cell layout
              ├── scrollback.rs          # VecDeque ring + resize
              ├── dirty.rs               # dirty-row bitmap
              ├── key.rs                 # KeyEvent → VT52 bytes
              └── vt52.rs                # opcode table / dispatch
  ```
  All logic modules (`terminal.rs`, `grid.rs`, `scrollback.rs`,
  `dirty.rs`, `key.rs`, `vt52.rs`) are wasm-free. `wasm-bindgen`
  attributes are confined to the thin `lib.rs` boundary module.
- **D-20:** **Cross-target reuse is an explicit design goal.** The
  same `bestialitty-core` crate backs: the browser shell (cdylib +
  wasm-bindgen + JS), a hypothetical future native shell (rlib +
  ratatui/SDL + libserialport), and the pure-Rust test harness
  (rlib + `cargo test`). Phase 1 delivery proves this by having all
  unit tests link the core as an rlib with zero wasm involvement.
  No wasm-only code paths in the core; any wasm-specific helpers
  live only in `lib.rs`.

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
- Whether to pin `rust-toolchain.toml` now or defer to Phase 2
  (either is fine; the research stack targets Rust 1.85+ stable,
  Edition 2024).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` — vision, core value, architectural split,
  constraints, key decisions table
- `.planning/REQUIREMENTS.md` — full v1 requirement list with REQ-IDs;
  PARSER-01..08, CORE-01..02 are in-scope for this phase
- `.planning/ROADMAP.md` — phase list, dependencies, success criteria;
  Phase 1 success criteria are load-bearing

### Stack + architecture research

- `.planning/research/STACK.md` — Rust/wasm toolchain, "do NOT use vte
  wholesale" argument for parser strategy, PxPlus/JetBrains Mono font
  picks, Vite 8 + vite-plugin-wasm integration
- `.planning/research/ARCHITECTURE.md` — component responsibilities,
  Cell layout proposal (`{ch: u32, fg: u8, bg: u8, flags: u8, _pad: u8}`),
  wasm-boundary call shape, dirty-row repaint pattern, Alacritty
  scrollback lineage, "build on vte::Parser + Perform" counter-argument
- `.planning/research/PITFALLS.md` — Pitfalls 2 (torn chunks),
  3 (ESC Y +32 offset bug), 4 (boundary chattiness), 7 (scrollback OOM),
  10 (TextDecoder byte corruption) all apply to this phase
- `.planning/research/FEATURES.md` — VT52 sequence inventory
  (ESC A/B/C/D, ESC Y, ESC J/K, ESC F/G/=/>, ESC Z), identify-response
  requirement, BEL visible-flash semantics
- `.planning/research/SUMMARY.md` — cross-doc synthesis, parser-strategy
  unresolved decision, per-phase research flags

### External VT52 specification

- [DEC VT52 DECscope Maintenance Manual, Chapter 3](https://vt100.net/docs/vt52-mm/chapter3.html)
  — authoritative escape-sequence reference (external URL; not in repo)
- [Paul Williams ANSI parser state machine](https://vt100.net/emu/dec_ansi_parser)
  — referenced by both parser candidates; external URL

### Decisions to be created in this phase

- `.planning/decisions/ADR-001-parser-strategy.md` — **written during
  Phase 1** after the spike; records which parser approach won and why

### Captures to be created in this phase

- `.planning/research/captures/capture-01-cpm-boot/` — boot + CP/M + `dir`
- `.planning/research/captures/capture-02-basic/` — BASIC LIST/RUN

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

None — this is a greenfield Rust crate, Phase 1 is the first code in the
repo. No existing components or patterns to honour beyond the architectural
split already locked in PROJECT.md.

### Established Patterns

None from code yet. Patterns to establish in Phase 1 that later phases must
honour:

- Pure-logic Rust core, zero browser deps, provable via `cargo test` alone
- Zero-copy wasm boundary (pointers + `Uint8Array` views) for hot paths
- `Vec<u8>` return for cold-path / rare-output APIs (e.g., `feed()`
  host-bound reply, `encode_key()` output)
- `repr(C)` POD structs for anything crossing the wasm boundary as a view
- Cargo workspace with cdylib + rlib dual crate type — enables cross-target
  reuse

### Integration Points

Phase 1 delivers the Rust core only. Integration points appear in later
phases:

- **Phase 2:** wraps the core in `wasm-pack --target web`, builds the
  boundary glue, validates zero-copy views end-to-end with a minimal JS
  harness. Phase 2 consumes `grid_ptr()` / `dirty_ptr()` / `feed()` /
  `resize()` as-designed here.
- **Phase 3:** canvas renderer reads `grid_ptr()` / `dirty_ptr()`; glyph
  atlas keys off the raw VT52 byte stored in `Cell.ch`.
- **Phase 4:** DOM keyboard handler packs `(code, mods)` and calls
  `encode_key()`; writes returned bytes to port.
- **Phase 5:** Web Serial reader loop calls `feed()` per chunk, writes
  the returned `Vec<u8>` (ESC Z reply, etc.) back to `port.writable`.
- **Phase 6:** polish layer calls `resize_scrollback(n)` when the user
  adjusts the persisted preference.

</code_context>

<specifics>
## Specific Ideas

- "You write the fiddly VT52 parser exactly once" — the Rust core is
  deliberately shell-agnostic. Same crate must back a browser shell, a
  hypothetical native shell (ratatui/SDL + libserialport), and the
  cargo-test harness. D-19 and D-20 encode this.
- Parser must be **byte-streaming** with explicit states (`Ground`,
  `Escape`, `CursorRow`, `CursorCol` if hand-rolled; equivalent states
  via `vte::Parser` if that path wins). No "scan forward for the next
  byte" patterns anywhere — every byte must transition through exactly
  one state (PITFALLS.md #2).
- `ESC Y` decoding: `row = byte.saturating_sub(0x20).min(MAX_ROW)` and
  equivalent for col; explicit saturation + clamp, both directions
  (PITFALLS.md #3; shipped as a bug in mintty for years).
- BEL handling in this phase: the parser sets a `bell_pending` flag on
  `0x07`. Reading/clearing the flag is part of the wasm boundary but
  the **visual** bell effect is Phase 3's problem. Phase 1 only owns
  the state, not the render.

</specifics>

<deferred>
## Deferred Ideas

- **Native shell** (ratatui/SDL + libserialport backing the same Rust
  core) — mentioned as an enabler for cross-target reuse, but building
  the native shell itself is out of scope for v1. Phase 1 ensures the
  *possibility* without building it.
- **Full-screen editor capture** — valuable but not gating (D-08). If
  a suitable editor workload exists on the author's MicroBeast, fold
  it in as `capture-03-*`; otherwise rely on DEC-manual-derived
  torn-chunk fixtures.
- **Rust-side graphics-mode glyph table** (VT52 byte → Unicode
  codepoint mapping) — rejected for Phase 1 (D-10). JS renderer owns
  this mapping in Phase 3; the Rust core just stores the raw byte.
- **Benchmark suite** (e.g., 1 MB dump throughput harness from
  PITFALLS.md #4) — not required for Phase 1 correctness; a
  verification-time artefact if later profiling requires it.
- **`wasm-bindgen-test` browser smoke tests** — the Rust core's tests
  run natively via `cargo test` as rlib; in-browser wasm tests belong
  in Phase 2 where the wasm-pack build exists.

</deferred>

---

*Phase: 01-rust-core-parser-grid-key-encoder*
*Context gathered: 2026-04-21*
