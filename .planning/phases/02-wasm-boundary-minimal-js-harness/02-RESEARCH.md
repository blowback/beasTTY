# Phase 2: Wasm Boundary & Minimal JS Harness — Research

**Researched:** 2026-04-21
**Domain:** Rust → wasm (wasm-bindgen + wasm-pack `--target web`), zero-copy `Uint8Array` views over wasm linear memory, static-site ES-module loading, minimal debug harness
**Confidence:** HIGH for toolchain, boundary shape, zero-copy pattern, CORE-02 test update strategy, dev-server options; MEDIUM for the `wasm32`-gating mechanism (three candidates below; picked one with explicit tradeoff reasoning) and for the 64 KB stress-test signal (multiple DevTools signals validate SC-4; harness logs one, pairs with at least one other)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Grid exposure strategy (zero-copy `Uint8Array` view, SC-3)**

- **D-01:** Visible grid is exposed via a **scratch pack-on-read buffer** owned by `Terminal`. A private `pack_buf: Vec<Cell>` of length `visible_rows * cols` is populated by memcpy'ing from `Scrollback`'s `VecDeque<Row>` into a single contiguous row-major buffer. `Terminal` then exposes a stable pointer + byte length into this buffer. This preserves Phase 1's `VecDeque<Row>` layout (and its 128 passing tests) without refactoring scrollback, while still giving JS a single `(ptr, len)` pair for `new Uint8Array(wasm.memory.buffer, ptr, len)`.
- **D-02:** The pack is triggered by an **explicit `snapshot_grid()` method** the JS renderer calls once per frame before reading the `Uint8Array` view. Pairs ergonomically with the existing `clear_dirty()` per-frame pattern: `snapshot_grid → read dirty view → read pack view → clear_dirty`. Cost is visible at the call site rather than hidden inside a getter.
- **D-03:** The pack-buffer pointer is **invalidated only by `resize(rows, cols)`**. `feed()`, internal scroll (`push_line`), `resize_scrollback(cap)` do not invalidate it — `resize_scrollback` only affects the historical tail, not the visible region. JS derives the `Uint8Array` view once on construction and re-derives only after `resize`. Matches the D-17 invalidation contract for `grid_ptr()` / `dirty_ptr()` verbatim.
- **D-04:** The pack buffer lives **on `Terminal` (pure-Rust core)**, not in a lib.rs wasm wrapper. Keeps the snapshot path pure Rust: native `cargo test` can exercise it without wasm. `lib.rs` stays a thin wasm-bindgen façade over already-pure methods. Honors D-20 (wasm attrs confined to `lib.rs`) without pushing stateful buffers into the boundary layer.

**Dirty-row bitmap exposure**

- **D-05:** No new mechanism — `Dirty::as_slice()` already returns a single contiguous `&[u8]`. `lib.rs` exposes `dirty_ptr()` + `rows()` directly off it, matching D-17 verbatim. Zero-copy requirement (SC-3) is met for dirty rows by Phase 1 code as-is.

**Wasm attrs and CORE-02 test**

- **D-06:** `wasm-bindgen` attributes are confined to `crates/bestialitty-core/src/lib.rs` (D-20). All other modules (`terminal.rs`, `grid.rs`, `scrollback.rs`, `dirty.rs`, `key.rs`, `vt52.rs`) remain wasm-free. `snapshot_grid` and its pack-buffer plumbing land in `terminal.rs` as plain Rust; `lib.rs` wraps it with `#[wasm_bindgen]`.
- **D-07:** `tests/core_02_no_browser_deps.rs` must be updated to **exempt `lib.rs` by path** from the "no `wasm_bindgen` / `web_sys` / `js_sys`" grep. Every other module still fails that test if the token appears. `web_sys` / `js_sys` remain forbidden everywhere (lib.rs included) — Phase 2 only needs `wasm_bindgen`, not browser DOM bindings.
- **D-08:** `wasm-bindgen` is added to `Cargo.toml` as a plain dep (not feature-gated). Phase 1's `dependency_graph_excludes_browser_crates` test is updated to allow `wasm-bindgen` specifically; `web-sys` / `js-sys` / `gloo-*` remain forbidden. Planner confirms exact gating mechanism during research (see Mechanism Evaluation below).

**Boundary API additions**

- **D-09:** Phase 2 extends — does not replace — the Phase 1 boundary surface. Every signature locked by `tests/boundary_api_shape.rs` stays. Phase 2 adds:
  - `snapshot_grid(&mut self)` — refreshes the pack buffer
  - `grid_ptr(&self) -> *const u8` — pointer into the pack buffer
  - `grid_byte_len(&self) -> usize` — `visible_rows * cols * sizeof(Cell)`
  - `dirty_ptr(&self) -> *const u8` — pointer into the existing `Dirty::bytes`
  - Packed `cursor_packed(&self) -> u32` (D-17: `(row << 16) | col`) — preserving Phase 1's `cursor() -> (u32, u32)` tuple accessor for Rust callers, adding the packed form for the wasm boundary
  - `encode_key_raw(code: u32, mods: u32) -> Vec<u8>` — matches D-17's `encode_key` signature; wraps `key::encode` with `u32 → KeyCode` unpacking
- **D-10:** `tests/boundary_api_shape.rs` is extended with compile-time pins for every new method added by D-09. Any future drift in return type, visibility, or signature of a Phase-2-exposed wasm method fails this test.

**Harness scope (minimal)**

- **D-11:** Harness page has four required affordances:
  1. A textarea where the user pastes raw bytes (paste literal bytes where possible; hex-escape syntax like `\xNN` supported for the control bytes that keyboards can't type).
  2. A "Feed" button that calls `term.feed(bytes)` **once** with the entire textarea contents as a single `Uint8Array`.
  3. A `<pre>` element that renders the current visible grid as ASCII by iterating the zero-copy `Uint8Array` view over the pack buffer, pulling the raw byte at each `ch` offset.
  4. A "64 KB stress" button that generates 65 536 bytes of plausible VT52 input and feeds them in a single `feed()` call, logging before/after timestamps so SC-4 can be verified in DevTools: one boundary call, not 65 536.
- **D-12:** Harness also renders the dirty-row bitmap (as a 24-byte row prefix next to the ASCII grid) and the cursor position + bell flag as small status readouts. Not aesthetically polished — Phase 3 owns that. Purpose is purely to prove the boundary shape end-to-end.

**Project layout & dev serving**

- **D-13:** Static site lives under `www/` at the repo root, matching ARCHITECTURE.md's recommended structure. `wasm-pack build --target web` writes its `pkg/` output into `www/pkg/` so the harness can `import init, { Terminal } from './pkg/bestialitty_core.js'` without a bundler. `www/pkg/` is gitignored; `www/index.html`, `www/main.js`, and any supporting files are tracked. A top-level `scripts/build.sh` wraps `wasm-pack build --target web --out-dir ../../www/pkg crates/bestialitty-core` for convenience.
- **D-14:** Local dev serving is **not committed to a specific tool**. README / harness docs mention two working options: `python3 -m http.server -d www` and `basic-http-server www` (Rust, single-binary, no Node). Either serves `/index.html` with correct MIME types for `.wasm` and `.js`. The author picks per session; the harness works identically under both. No Vite, no npm, no bundler runtime.

### Claude's Discretion

- Exact naming of the pack-buffer methods on `Terminal` (`snapshot_grid` / `grid_ptr` / `grid_byte_len` is preferred; planner may rename if a clearer convention emerges — contract is what matters, not names).
- How to gate `wasm-bindgen` glue off for native builds (cfg attribute on lib.rs module, `#[cfg(target_arch = "wasm32")]` on individual items, or a `wasm` Cargo feature).
- Hex-escape parser for the harness textarea (regex vs hand-rolled state machine).
- Exact layout of the 64 KB stress payload.
- Whether the harness has "Reset terminal", "Clear dirty", "Resize" buttons.

### Deferred Ideas (OUT OF SCOPE)

- Canvas rendering / glyph atlas → Phase 3.
- Native shell using the same core → D-20 keeps the possibility open; Phase 2 does not build it.
- Bundle-size measurement beyond a single `ls -lh www/pkg/*.wasm` output in verification.
- Refactoring `Scrollback` to a single contiguous `Vec<Cell>` + ring offset.
- `set_scrollback` / `scroll_to(offset)` boundary calls beyond Phase 1's `resize_scrollback`.
- `TextDecoderStream` on the read path — hard no.
- Keyboard wiring in the harness — Phase 4's work. Phase 2 exposes `encode_key_raw` and pins its signature, no DOM wiring.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-03 | Rust↔JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`) | Standard Stack → wasm-bindgen 0.2.118 + wasm-pack 0.13.x / 0.14.0; Architecture Pattern 1 (target-web ES-module loading); Code Examples → init() boilerplate; CORE-02 Update Strategy |
| CORE-04 | JS shell owns Web Serial I/O, canvas rendering, event loop, and browser state | Architecture Pattern 2 (thin-façade lib.rs — wasm attrs confined); Don't-Hand-Roll (never build Web Serial in Rust); Harness proves JS owns DOM/event loop; Phase 2 delivers the JS-shell skeleton |
| CORE-05 | Wasm boundary uses batched byte feeds and shared-memory views (no per-byte or per-frame grid copying) | Architecture Pattern 3 (zero-copy `Uint8Array` view); Architecture Pattern 4 (batched `feed(bytes)`); Common Pitfall #1 (boundary chattiness); Common Pitfall #2 (memory-detachment); SC-4 stress test via `performance.now()` |
</phase_requirements>

## Summary

Phase 2 is a single-integration phase: wire the already-passing Rust core to a wasm-pack `--target web` build, prove the zero-copy boundary works end-to-end with a deliberately ugly HTML harness, and extend the compile-time contract tests so future drift fails loudly. Every hard engineering decision was locked in CONTEXT.md — the pack-on-read buffer lives on `Terminal` (not `lib.rs`), `snapshot_grid()` is an explicit per-frame call, `wasm-bindgen` is confined to `lib.rs`, output goes to `www/pkg/`, and the CORE-02 test gets exempted at the file-path level (not lifted).

The research below mostly picks *mechanisms* for the already-locked *policies*. Three mechanisms needed disambiguation: how to gate `wasm-bindgen` glue off native `cargo test` (recommend: **target-specific `[target.'cfg(target_arch = "wasm32")'.dependencies] wasm-bindgen`** + `#[cfg(target_arch = "wasm32")]` on every `#[wasm_bindgen]` item in `lib.rs`), how to exempt `lib.rs` from the CORE-02 source-file grep (recommend: **`src/lib.rs` path-literal allowlist** in `FORBIDDEN_TOKENS` check, with token `wasm_bindgen` specifically exempted for that one file), and how to signal SC-4 ("one `feed()` call not 65 536") in DevTools (recommend: **`console.time` + `console.timeEnd` pairs plus `performance.now()` log**; Chromium's Performance tab then shows a single `Terminal.feed` frame, not a flame of 65 536 entries).

**Primary recommendation:** Ship Phase 2 as 4–5 thin plans in this order — (1) add wasm32 target + `wasm-bindgen` dep + target-specific gating, (2) implement `snapshot_grid` / pack-buffer on `Terminal` + `lib.rs` wasm-bindgen façade + extended boundary-shape test, (3) update CORE-02 test with the `lib.rs` exemption + `wasm-bindgen` allow, (4) `www/` static site + build script + harness page, (5) verification smoke test (load harness in Chromium, paste VT52 sequence, stress 64 KB, observe one boundary call). The critical landmines are memory-detachment after `resize` (JS must re-derive the view, not cache it) and per-byte feed patterns (PITFALLS #4 — already guarded by the batched `feed(bytes)` shape).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pack-on-read snapshot of visible grid | Rust core (`terminal.rs`) | — | D-04 locks this — pack buffer is on `Terminal`, not lib.rs. Keeps it pure-Rust and native-testable. |
| wasm-bindgen façade over `Terminal` | lib.rs wasm boundary | — | D-06 locks this — wasm attrs confined to lib.rs. Every Phase-2-new export is a thin wrapper. |
| Wasm-pack build pipeline (`--target web`) | Build orchestration (scripts/build.sh + rust-toolchain.toml) | — | Writes `pkg/` into `www/pkg/`. No bundler. |
| ES-module loading of `pkg/bestialitty_core.js` | Browser (harness `www/main.js`) | — | `import init, { Terminal } from './pkg/bestialitty_core.js'; await init();` |
| Zero-copy `Uint8Array` view construction | Browser (harness) | — | `new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len())`. JS derives, caches, re-derives only after `resize`. |
| ASCII grid rendering into `<pre>` | Browser (harness) | — | Reads the pack view, iterates `ch` offsets, builds a string. No canvas, no DOM-key plumbing. |
| Hex-escape textarea parser | Browser (harness) | — | JS-only concern — converts `\x1B` etc. into raw bytes before calling `feed()`. Rust never sees escaped text. |
| 64 KB stress payload generation | Browser (harness) | — | JS builds a 65 536-byte `Uint8Array`, calls `feed()` once, logs timing. SC-4 lives entirely on the JS side. |
| Local dev static serving | External tool (python3 http.server or basic-http-server) | — | D-14 — not committed to one tool. MIME-correct serving of `.wasm` as `application/wasm` required. |
| CORE-02 regression gate | Native `cargo test` on host | — | The updated test file runs under rlib `cargo test`, checks `cargo metadata` + grep every `src/**/*.rs`. Still no wasm involvement in the test itself. |
| Boundary-shape contract | Native `cargo test` on host | — | The extended `boundary_api_shape.rs` compiles against rlib — it verifies the underlying `Terminal` methods exist with the right signatures, which is what the lib.rs wasm-bindgen façade delegates to. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wasm-bindgen` | `0.2.118` [VERIFIED: `cargo search wasm-bindgen --limit 3`] | Rust↔JS interop codegen; provides `#[wasm_bindgen]` attribute macro | The standard. Already documented in STACK.md; Context7's `/websites/rs_serde-wasm-bindgen` lists this exact version. |
| `wasm-pack` | `0.14.0` (released 2026-01-20) [CITED: docs.rs/crate/wasm-pack/latest, WebSearch] | Build orchestrator: invokes cargo + wasm-bindgen-cli, emits `pkg/` with JS glue | Mandatory partner. 0.14.0 is the current line per docs.rs; 0.13.x still works (local dev box has 0.12.1 — see Environment Availability). |
| Rust stable | `1.85+` (Edition 2024) | Target platform | Already pinned via `rust-toolchain.toml`. Phase 2 adds the `wasm32-unknown-unknown` target. |
| `wasm32-unknown-unknown` target | Tier 2 | Rust → wasm32 compilation target | Added via `rust-toolchain.toml` `targets = ["wasm32-unknown-unknown"]` OR `rustup target add wasm32-unknown-unknown`. Currently intentionally omitted — Phase 2 adds it. |
| `vte` | `=0.15` (already pinned) [VERIFIED: `crates/bestialitty-core/Cargo.toml:22`] | Parser — unchanged from Phase 1 | ADR-001 locks this; Phase 2 MUST NOT bump. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `python3` http.server | system (Python 3.12.3 verified locally) | Dev static server, option A | `python3 -m http.server -d www 8000`. Python 3.12's `http.server` correctly serves `.wasm` as `application/wasm`. No install needed on Linux/macOS. [CITED: CPython docs — http.server.SimpleHTTPRequestHandler extensions_map includes `.wasm` → `application/wasm` since Python 3.9] |
| `basic-http-server` | 0.8.x | Dev static server, option B (Rust, single binary) | `cargo install basic-http-server` then `basic-http-server www`. Useful when you want a stay-in-Rust toolchain. Serves `.wasm` with correct MIME. |
| `console_error_panic_hook` | 0.1.x | Converts Rust panics to readable console.error messages in the browser | **Not required for Phase 2.** Dev-convenience only; wire it in when we see an actual wasm panic. Phase 2's `feed()` doesn't panic (it's return-Vec-on-error, silent-discard on malformed). If added, `#[cfg(target_arch = "wasm32")]`-gate the call to keep native builds unaffected. |
| `wasm-bindgen-test` | 0.3.x | In-browser Rust tests via headless Chrome/Firefox | **Not in scope for Phase 2** — Phase 1 CONTEXT explicitly defers in-browser smoke tests. Native `cargo test` (as rlib) remains the only Rust test path. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `wasm-pack --target web` | `wasm-pack --target bundler` | Bundler target needs Vite/webpack/esbuild. Locks us out of the no-bundler promise (D-13). Web target emits the `async function init(url) { ... }` bootstrap that works on a plain HTTP server. Stay on `--target web`. |
| `wasm-pack --target web` | `wasm-pack --target no-modules` | `no-modules` emits IIFE and pollutes globals. Doesn't use ES modules. Loses the clean `import init, { Terminal } from './pkg/...'` surface. Stay on `--target web`. |
| `python3 -m http.server` | `npx serve` / `vite preview` | Requires Node. D-14 rejects npm/Node dependency. Not used. |
| `python3 -m http.server` | `caddy file_server` / nginx | Much heavier than the phase needs. The harness is a dev loop, not a deployment target. |
| Target-specific dep + cfg gating | Plain `[dependencies] wasm-bindgen = "0.2.118"` | Plain dep pulls `wasm-bindgen` into native `cargo build` and `cargo test` even though no item uses its macros there. Compiles fine but adds non-trivial build time to every test run. Target-specific is cleaner. |
| Target-specific dep + cfg gating | Cargo `[features] wasm = ["dep:wasm-bindgen"]` | Forces `cargo test --no-default-features` or `cargo test -p bestialitty-core` manual ceremony. Plain `cargo test` is a D-20 commandment. Feature-gating regresses the DX. |
| `console.time` + `console.timeEnd` for SC-4 | `performance.mark` + `performance.measure` | `console.time` renders inline in DevTools; `performance.mark` surfaces in the Performance tab timeline. Harness uses both — `console.time` for the headline "0.5ms" log, `performance.mark` so the DevTools Performance recording shows a single `Terminal.feed` frame rather than 65 536 frames. |

**Installation:**

```bash
# One-time: add wasm32 target (Phase 2 first plan)
rustup target add wasm32-unknown-unknown

# Verify wasm-pack
wasm-pack --version    # local box: 0.12.1 (old; 0.14.0 is current)
# If < 0.13, upgrade: cargo install wasm-pack --force

# Cargo.toml — target-specific dep (see Mechanism Evaluation)
# [target.'cfg(target_arch = "wasm32")'.dependencies]
# wasm-bindgen = "0.2.118"

# Build command (wired into scripts/build.sh per D-13)
wasm-pack build --target web --out-dir ../../www/pkg crates/bestialitty-core

# Dev serve (either one)
python3 -m http.server -d www 8000
# or
basic-http-server www
```

**Version verification:**
- `wasm-bindgen = "0.2.118"` — verified via `cargo search wasm-bindgen --limit 3` (HIGH confidence; April 2026 line).
- `wasm-pack 0.14.0` — verified via docs.rs/crate/wasm-pack/latest; released 2026-01-20. Local dev box has 0.12.1 which pre-dates the binary-versioning fix in 0.13 but still builds correctly for `--target web`.
- `vte = "=0.15"` — unchanged from Phase 1. Phase 2 MUST NOT bump.

## Architecture Patterns

### System Architecture Diagram

```
Browser (Chromium)
─────────────────────────────────────────────────────────────────────
  www/index.html
     │
     │ <script type="module" src="./main.js">
     ▼
  www/main.js
     │
     │ import init, { Terminal } from './pkg/bestialitty_core.js'
     │ const wasm = await init();                 ── loads + instantiates .wasm
     │ const term = new Terminal(24, 80, 10000);  ── Rust constructor
     ▼
  ┌─────────────────────────────────────────┐
  │ Per-session: one-time view derivation   │
  │                                          │
  │ term.snapshot_grid();                    │
  │ const gridView = new Uint8Array(         │
  │   wasm.memory.buffer,                    │  ← wasm linear memory
  │   term.grid_ptr(),                       │  ← into pack_buf
  │   term.grid_byte_len());                 │
  │ const dirtyView = new Uint8Array(        │
  │   wasm.memory.buffer,                    │
  │   term.dirty_ptr(),                      │  ← into Dirty::bytes
  │   term.rows());                          │
  │                                          │
  │ ONLY re-derive after term.resize()       │
  └─────────────────────────────────────────┘
     │
     │ User clicks "Feed" or "64 KB stress"
     ▼
  harness parseHexEscapes(textareaValue) → Uint8Array
     │
     │ term.feed(bytes);       ── ONE boundary call
     │                         ── wasm-bindgen marshals the Uint8Array
     │                         ── Rust iterates bytes internally
     ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ Rust core (wasm32-unknown-unknown)                              │
  │                                                                  │
  │ crates/bestialitty-core/src/lib.rs  (wasm-bindgen façade)       │
  │    ├─ #[wasm_bindgen] pub struct Terminal { inner: core::Terminal }
  │    ├─ pub fn new(rows, cols, cap) → Terminal                    │
  │    ├─ pub fn feed(&mut self, bytes: &[u8]) → Vec<u8>            │
  │    ├─ pub fn snapshot_grid(&mut self)            ← D-09 new     │
  │    ├─ pub fn grid_ptr(&self) → *const u8         ← D-09 new     │
  │    ├─ pub fn grid_byte_len(&self) → usize        ← D-09 new     │
  │    ├─ pub fn dirty_ptr(&self) → *const u8        ← D-09 new     │
  │    ├─ pub fn rows() / cols()                                     │
  │    ├─ pub fn clear_dirty(&mut self)                              │
  │    ├─ pub fn cursor_packed(&self) → u32          ← D-09 new     │
  │    ├─ pub fn bell_pending(&self) / clear_bell(&mut)              │
  │    ├─ pub fn resize(&mut, r, c)                                  │
  │    ├─ pub fn resize_scrollback(&mut, n)                          │
  │    └─ pub fn encode_key_raw(code: u32, mods: u32) → Vec<u8>  ← D-09 new
  │                                                                  │
  │ crates/bestialitty-core/src/terminal.rs  (pure Rust, no wasm)    │
  │    ├─ pack_buf: Vec<Cell>  ← D-01 new field, size rows*cols     │
  │    ├─ pub fn snapshot_grid(&mut self)                            │
  │    │    └─ memcpy each Scrollback::row() into pack_buf[row*cols..]
  │    ├─ pub fn pack_ptr(&self) → *const u8     ← called by lib.rs │
  │    ├─ pub fn pack_byte_len(&self) → usize    ← called by lib.rs │
  │    ├─ pub fn dirty_ptr(&self) → *const u8    ← called by lib.rs │
  │    └─ all Phase 1 methods unchanged                              │
  │                                                                  │
  │ All other modules (grid.rs, scrollback.rs, dirty.rs, key.rs,     │
  │ vt52.rs) UNCHANGED by Phase 2.                                   │
  └────────────────────────────────────────────────────────────────┘
     │
     │ After feed() returns:
     ▼
  harness renderAscii():
    term.snapshot_grid();       ← refresh pack_buf
    // gridView is still valid (feed did not resize)
    // scan gridView by cell_index * 8, read ch (byte 0)
    buildAsciiStringFromGridView(gridView)
    → <pre> textContent = ascii

  harness renderDirty():
    dirtyView is still valid
    <pre id="dirty"> = Array.from(dirtyView).join('')
    term.clear_dirty();

  harness renderStatus():
    cursor = term.cursor_packed();
    row = cursor >> 16; col = cursor & 0xFFFF;
    bell = term.bell_pending();
    <span id="status"> = `cursor=(${row},${col}) bell=${bell}`
```

**Data flow summary:** JS drives the whole event loop. Rust is a pure stateful computation that JS pokes via `feed()` / `encode_key_raw()` and queries via zero-copy pointer reads. The only re-derivation trigger is `resize()` (not shipped as a harness button in Phase 2, but the contract must be documented and tested).

### Recommended Project Structure
```
bestialitty/
├── crates/bestialitty-core/
│   ├── Cargo.toml                # + wasm-bindgen under [target.cfg] table
│   ├── src/
│   │   ├── lib.rs                # populated: wasm-bindgen façade (D-06)
│   │   ├── terminal.rs           # +pack_buf, +snapshot_grid, +pack_ptr (D-01, D-04)
│   │   ├── grid.rs               # UNCHANGED
│   │   ├── scrollback.rs         # UNCHANGED
│   │   ├── dirty.rs              # UNCHANGED (as_slice already there)
│   │   ├── key.rs                # UNCHANGED
│   │   └── vt52.rs               # UNCHANGED
│   └── tests/
│       ├── boundary_api_shape.rs # EXTENDED with D-10 pins
│       └── core_02_no_browser_deps.rs  # UPDATED per D-07
├── rust-toolchain.toml           # targets = ["wasm32-unknown-unknown"] added
├── scripts/
│   └── build.sh                  # NEW: wraps wasm-pack build --target web
├── www/                          # NEW folder tree
│   ├── index.html                # <pre>, <textarea>, two buttons, status
│   ├── main.js                   # init(), view derivation, event handlers
│   ├── .gitignore                # pkg/
│   └── pkg/                      # wasm-pack output (gitignored)
│       ├── bestialitty_core.js
│       ├── bestialitty_core_bg.wasm
│       ├── bestialitty_core.d.ts
│       └── package.json          # emitted but not used
└── .planning/decisions/
    └── ADR-002-wasm-gating.md    # IF mechanism isn't obvious — see below
```

### Pattern 1: `wasm-pack --target web` ES-Module Loading Without a Bundler

**What:** `wasm-pack build --target web` produces `pkg/` containing a JS glue module, a `.wasm` binary, and a `.d.ts` typedef. A plain HTML file can load it with `<script type="module">` and an ES-module import. The default-exported `init()` function fetches the `.wasm`, instantiates it, and returns the `WebAssembly.Instance` — with the `memory` property you need for zero-copy views.

**When to use:** Always, for this project — D-13 locks `--target web` + no bundler.

**Example:**
```html
<!-- www/index.html -->
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>BestialiTTY Harness</title></head>
<body>
  <textarea id="input" rows="4" cols="80" placeholder="Paste bytes, or \xNN for control bytes"></textarea>
  <br>
  <button id="feed">Feed</button>
  <button id="stress64k">64 KB Stress</button>
  <pre id="grid"></pre>
  <pre id="dirty"></pre>
  <span id="status"></span>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

```javascript
// www/main.js
// Source: https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html
// Source: https://rustwasm.github.io/docs/wasm-pack/commands/build.html
import init, { Terminal } from './pkg/bestialitty_core.js';

const wasm = await init();     // top-level-await requires Chromium ≥ 89; fine per PLAT constraint
const term = new Terminal(24, 80, 10_000);

// One-time view derivation (D-03 contract)
term.snapshot_grid();
let gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
let dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());

function reDeriveViews() {
    gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
    dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
}
// Call reDeriveViews() only after term.resize().
// feed(), internal scroll, resize_scrollback DO NOT invalidate the views (D-03).
```

### Pattern 2: Zero-Copy `Uint8Array` View Over wasm Linear Memory

**What:** JS constructs `new Uint8Array(wasm.memory.buffer, ptr, len)`. No copy. The view is a window into wasm linear memory owned by Rust. Reads are byte-level indexed; writes (from JS side) would mutate Rust state — but for Phase 2 the views are read-only, so we never write through them.

**When to use:** Every hot-path data read from Rust (grid cells, dirty bitmap). Cold-path reads (cursor position, bell flag) use primitive returns instead — `u32` is returned in a register with no marshalling cost.

**Critical invariant (D-03):** `wasm.memory.buffer` can be replaced by a new `ArrayBuffer` under certain conditions (see Pitfall #2). After that replacement, views over the old buffer are detached and reads throw. For Phase 2, the only operations that can trigger a buffer replacement are (a) `Terminal::resize()` (may grow the pack_buf), (b) other allocations inside `feed()` that push wasm memory past its current capacity. For the expected harness traffic (64 KB in one feed, 80×24 grid) wasm memory will typically stay at its initial 17 pages (~1.1 MB) and no growth happens. Still — document the invariant and re-derive after `resize()` unconditionally.

**Example:**
```javascript
// Source: https://docs.rs/js-sys/latest/js_sys/struct.Uint8Array.html
// Source: https://rustwasm.github.io/book/reference/js-ffi.html
const CELL_SIZE = 8;
const cols = term.cols();
const rows = term.rows();

function renderAscii() {
    term.snapshot_grid();              // refresh pack_buf (memcpy, tiny — 15 KB at 80×24)
    // gridView is still valid: snapshot_grid() does NOT resize (D-03).
    let out = '';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * CELL_SIZE;
            // Cell byte layout (D-09): ch:u32 (bytes 0-3, little-endian), fg:u8, bg:u8, flags:u8, _pad:u8
            const ch = gridView[i];    // low byte of ch = raw VT52 byte
            out += ch === 0 ? ' ' : String.fromCharCode(ch < 0x20 ? 0x20 : ch);
        }
        out += '\n';
    }
    document.getElementById('grid').textContent = out;
}
```

### Pattern 3: Explicit Pack-on-Read (`snapshot_grid()`)

**What:** Phase 1's `Scrollback` stores rows in a `VecDeque<Row>` where each `Row` owns a `Vec<Cell>`. This is not contiguous — a `Uint8Array` over one row's `Vec<Cell>` would only see that row. Phase 2 adds a private `pack_buf: Vec<Cell>` of length `visible_rows * cols` on `Terminal`, and a `snapshot_grid(&mut self)` method that memcpy's every visible row into the pack buffer in row-major order. The pack buffer's pointer is what `grid_ptr()` returns.

**When to use:** Once per frame, called explicitly from JS before reading `gridView`. Mirrors the existing `clear_dirty()` per-frame cadence.

**Why this pattern and not an alternative:**
- **Refactoring `Scrollback` to `Vec<Cell>` + ring offset** (rejected in CONTEXT deferred): would break 128 passing Phase 1 tests. 15 KB memcpy at 60 Hz = 0.9 MB/s, inconsequential.
- **Auto-pack inside `feed()`** (not proposed): pays the pack cost even when JS doesn't read. Hides the cost site. Worse API.
- **Auto-pack inside `grid_ptr()`** (not proposed): mutates through an immutable-borrow signature (`&self`) or requires `&mut self`, which breaks wasm-bindgen ergonomics on a getter. Explicit call site is cleaner.

**Example:**
```rust
// crates/bestialitty-core/src/terminal.rs — Phase 2 addition
pub fn snapshot_grid(&mut self) {
    let cols = self.scrollback.cols();
    let visible_rows = self.scrollback.visible_rows();
    let needed = visible_rows * cols;
    // Resize the pack buffer if the grid size changed since construction.
    // In practice this is a no-op except right after resize().
    if self.pack_buf.len() != needed {
        self.pack_buf.resize(needed, Cell::BLANK);
    }
    for r in 0..visible_rows {
        let src = self.scrollback.row(r).as_slice();  // &[Cell]
        let dst_start = r * cols;
        self.pack_buf[dst_start..dst_start + cols].copy_from_slice(src);
    }
}

pub fn pack_ptr(&self) -> *const u8 {
    self.pack_buf.as_ptr() as *const u8
}

pub fn pack_byte_len(&self) -> usize {
    self.pack_buf.len() * std::mem::size_of::<Cell>()
}

pub fn dirty_ptr(&self) -> *const u8 {
    self.dirty.as_slice().as_ptr()
}
```

```rust
// crates/bestialitty-core/src/lib.rs — Phase 2 wasm façade
#![cfg(target_arch = "wasm32")]  // Entire lib.rs contents wasm-only — see Mechanism Evaluation
// Source: https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html
use wasm_bindgen::prelude::*;

use crate::terminal::Terminal as CoreTerminal;
use crate::key::{self, KeyCode, KeyEvent, Modifiers};

#[wasm_bindgen]
pub struct Terminal {
    inner: CoreTerminal,
}

#[wasm_bindgen]
impl Terminal {
    #[wasm_bindgen(constructor)]
    pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Terminal {
        Terminal { inner: CoreTerminal::new(rows, cols, scrollback_cap) }
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8> {
        self.inner.feed(bytes)
    }

    pub fn snapshot_grid(&mut self) {
        self.inner.snapshot_grid();
    }

    pub fn grid_ptr(&self) -> *const u8        { self.inner.pack_ptr() }
    pub fn grid_byte_len(&self) -> usize       { self.inner.pack_byte_len() }
    pub fn dirty_ptr(&self) -> *const u8       { self.inner.dirty_ptr() }

    pub fn rows(&self) -> u32                  { self.inner.rows() }
    pub fn cols(&self) -> u32                  { self.inner.cols() }

    pub fn clear_dirty(&mut self)              { self.inner.clear_dirty(); }
    pub fn bell_pending(&self) -> bool         { self.inner.bell_pending() }
    pub fn clear_bell(&mut self)               { self.inner.clear_bell(); }

    pub fn cursor_packed(&self) -> u32 {
        let (row, col) = self.inner.cursor();
        (row << 16) | col
    }

    pub fn resize(&mut self, rows: u32, cols: u32)          { self.inner.resize(rows, cols); }
    pub fn resize_scrollback(&mut self, new_cap: usize)     { self.inner.resize_scrollback(new_cap); }
}

#[wasm_bindgen]
pub fn encode_key_raw(code: u32, mods: u32) -> Vec<u8> {
    let key_code = unpack_keycode(code);
    let modifiers = unpack_mods(mods);
    key::encode(KeyEvent { code: key_code, mods: modifiers })
}

// Private unpackers — not exported. Phase 4 owns the DOM→u32 packing;
// Phase 2 only pins the encoding scheme so the test can compile.
fn unpack_keycode(code: u32) -> KeyCode { /* documented scheme; see Open Questions */ todo!() }
fn unpack_mods(mods: u32) -> Modifiers {
    Modifiers {
        ctrl:  (mods & 0b0001) != 0,
        shift: (mods & 0b0010) != 0,
        alt:   (mods & 0b0100) != 0,
        meta:  (mods & 0b1000) != 0,
    }
}
```

### Pattern 4: Target-Specific Dep + `cfg(target_arch = "wasm32")` Gating

**What:** Put `wasm-bindgen` in `[target.'cfg(target_arch = "wasm32")'.dependencies]` instead of plain `[dependencies]`. Put `#[cfg(target_arch = "wasm32")]` at the top of `lib.rs` (module-level). Result: native `cargo test` does not even resolve or compile `wasm-bindgen`, and lib.rs is empty on native. Wasm builds pull in wasm-bindgen and compile lib.rs.

**When to use:** This is the recommended mechanism for D-08. See "Mechanism Evaluation" below for the three-way tradeoff.

**Example:**
```toml
# crates/bestialitty-core/Cargo.toml — Phase 2 additions
[dependencies]
vte = "=0.15"
# Note: wasm-bindgen is NOT listed here.

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2.118"
```

```rust
// crates/bestialitty-core/src/lib.rs — top of file
//! bestialitty-core: pure-Rust VT52 terminal logic with a wasm-bindgen boundary.

#![cfg_attr(not(target_arch = "wasm32"), allow(unused_imports, dead_code))]
// ^^^ keep this — when compiled natively the whole lib.rs body is stripped,
//     but the crate still wants to parse cleanly for docs / IDEs.

pub mod dirty;
pub mod grid;
pub mod key;
pub mod scrollback;
pub mod terminal;
pub mod vt52;

// ==== wasm boundary (wasm32 only) ====
#[cfg(target_arch = "wasm32")]
mod wasm_boundary {
    use wasm_bindgen::prelude::*;
    use crate::terminal::Terminal as CoreTerminal;
    use crate::key::{self, KeyCode, KeyEvent, Modifiers};

    // ... (Pattern 3 code above)
}
```

### Anti-Patterns to Avoid

- **Caching `gridView` across `resize()`:** After `resize()` may invalidate both the pack_buf pointer and (potentially) the `wasm.memory.buffer` ArrayBuffer itself. JS MUST re-derive. (Pitfall #2.)
- **Per-byte `feed()` calls:** SC-4 explicitly demands a single call for 64 KB. PITFALLS.md #4 is the canonical case study. The harness generates a single `Uint8Array` and calls `feed()` once.
- **Reading `ch` via `.ch` property on a JS object:** There is no JS object. `gridView[i]` is the raw byte; Cell layout is `#[repr(C)]` and the JS code indexes bytes directly.
- **Using `TextDecoder` on harness paste input:** PITFALLS.md #10. The textarea is `textarea.value`, a string; the harness parses it as raw bytes (plus `\xNN` escapes), never `TextDecoder`.
- **Adding `wasm-bindgen` to plain `[dependencies]`:** Forces every `cargo test` to resolve + compile wasm-bindgen. Target-specific is strictly better.
- **Putting `#[wasm_bindgen]` on `terminal.rs`:** Violates D-06 and D-20. Also violates the CORE-02 test (no wasm attrs outside lib.rs).
- **Using `web_sys::console::log` for the 64 KB log:** D-07 keeps `web_sys` forbidden everywhere. JS logs timing; Rust just exists.

## Mechanism Evaluation: Keeping wasm-bindgen Glue Out of Native Builds

Three viable mechanisms, with tradeoffs. Phase 2 picks one and ADRs only if the choice isn't obvious.

### Candidate A: Target-specific dependency + module-level `#[cfg(target_arch = "wasm32")]` [RECOMMENDED]

```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2.118"
```

```rust
// lib.rs
#[cfg(target_arch = "wasm32")]
mod wasm_boundary { /* entire wasm-bindgen surface */ }
```

**Pros:**
- Native `cargo test` does not resolve `wasm-bindgen` at all. No unused-dep compile cost.
- `cargo build --target wasm32-unknown-unknown` / `wasm-pack build` resolves it.
- Plain `cargo test` works — no flags, no features. Honors D-20.
- Pattern is documented in the Rust + WebAssembly book: [CITED: rustwasm.github.io/book/reference/add-wasm-support-to-crate.html]
- `dependency_graph_excludes_browser_crates` test in `tests/core_02_no_browser_deps.rs` sees `wasm-bindgen` in `cargo metadata` output (metadata includes target-specific deps). D-07 update allows it explicitly.

**Cons:**
- Requires the CORE-02 test to be updated to allow `wasm-bindgen` in the metadata output. Already required by D-08 regardless.
- Cargo's `cargo check` with no target flag still checks lib.rs but lib.rs is `#[cfg]`-gated, so wasm-bindgen imports never get compiled.

### Candidate B: Plain `[dependencies]` + `#[cfg(target_arch = "wasm32")]`

```toml
[dependencies]
wasm-bindgen = "0.2.118"
```

```rust
#[cfg(target_arch = "wasm32")]
mod wasm_boundary { /* ... */ }
```

**Pros:**
- Simpler one-line Cargo.toml change.
- IDE tooling (rust-analyzer) sees `wasm-bindgen` unconditionally, slightly better autocomplete in lib.rs.

**Cons:**
- `cargo test` downloads + compiles `wasm-bindgen` and its proc-macro dependencies (`syn`, `quote`, `proc-macro2`) even though the module body is stripped. Adds ~15 seconds to a clean test build. Ongoing annoyance.
- CORE-02 test still needs the same update.

### Candidate C: Cargo feature flag

```toml
[features]
default = []
wasm = ["dep:wasm-bindgen"]

[dependencies]
wasm-bindgen = { version = "0.2.118", optional = true }
```

```rust
#[cfg(feature = "wasm")]
mod wasm_boundary { /* ... */ }
```

**Pros:**
- Most explicit — "this is the wasm variant."
- Standard Cargo idiom.

**Cons:**
- `wasm-pack build` must be told: `wasm-pack build crates/bestialitty-core -- --features wasm` (extra ceremony in `scripts/build.sh`).
- Plain `cargo test` and plain `cargo build --target wasm32-unknown-unknown` do NOT activate the feature — you'd forget, you'd get an empty lib.rs on wasm, and the build silently succeeds with no exports. Footgun.
- `cargo test --all-features` would activate it on native, break the build. You'd have to use `--no-default-features` everywhere. Cascading DX damage.

### Recommendation: Candidate A (target-specific dep + `cfg(target_arch)`)

**Why:** Honors D-20 (plain `cargo test` works), keeps native builds fast, keeps `wasm-pack build --target web` working with no extra flags, and is the pattern the Rust+WebAssembly book recommends for general-purpose crates that happen to have wasm bindings.

**ADR-002 requirement:** This is NOT a "clean one-liner" (it involves a Cargo.toml table syntax that not every reader will recognize) but it IS a standard pattern. Recommend a short ADR-002 recording the choice and the two rejected alternatives. CONTEXT explicitly permits this. 1-page ADR, not a full Nygard.

## CORE-02 Test Update Strategy

Phase 1's `tests/core_02_no_browser_deps.rs` has three tests:

1. `dependency_graph_excludes_browser_crates` — greps `cargo metadata` for forbidden crate names.
2. `source_files_contain_no_wasm_attrs` — greps every `src/**/*.rs` for forbidden token strings.
3. `cargo_toml_declares_cdylib_and_rlib` — unchanged by Phase 2.

Phase 2 needs surgical changes to (1) and (2).

### Change to `dependency_graph_excludes_browser_crates`

**Goal:** Allow `wasm-bindgen` in the metadata output, keep every other forbidden crate forbidden.

**Implementation:** Remove `"wasm-bindgen"` from `FORBIDDEN_CRATES`. Keep `"wasm-bindgen-futures"`, `"web-sys"`, `"js-sys"`, all `"gloo-*"` in the list.

```rust
const FORBIDDEN_CRATES: &[&str] = &[
    "web-sys",
    "js-sys",
    // "wasm-bindgen" — REMOVED in Phase 2 per D-08. Allowed on wasm32 target.
    "wasm-bindgen-futures",
    "gloo",
    "gloo-utils",
    "gloo-timers",
    "gloo-events",
    "gloo-net",
    "gloo-storage",
    "gloo-file",
    "gloo-worker",
    "gloo-history",
    "gloo-console",
    "gloo-dialogs",
    "gloo-render",
];
```

**Subtle:** `cargo metadata` for a crate with `[target.'cfg(target_arch = "wasm32")'.dependencies]` lists `wasm-bindgen` in the output even when running on x86_64 (metadata is target-agnostic — it lists every dep in every target-filter). The test sees `wasm-bindgen` regardless of host. That's fine; we removed it from the forbidden list.

**Also subtle:** `wasm-bindgen` pulls `cfg-if`, `once_cell`, `wasm-bindgen-macro`, `wasm-bindgen-shared`. None of these appear in `FORBIDDEN_CRATES` — verified. No additional entries to add.

### Change to `source_files_contain_no_wasm_attrs`

**Goal:** Exempt `crates/bestialitty-core/src/lib.rs` from the `wasm_bindgen` token check, but keep it subject to `web_sys` / `js_sys` forbids. Every other file stays subject to all three forbids.

**Implementation:** Per-file allowlist with per-token granularity.

```rust
/// Forbidden tokens in `crates/bestialitty-core/src/**/*.rs` source files.
/// Tuple: (token, list of file-relative paths exempt from this specific token).
/// Every file is subject to every token unless explicitly exempted.
const FORBIDDEN_TOKENS_WITH_EXEMPTIONS: &[(&str, &[&str])] = &[
    ("wasm_bindgen", &["lib.rs"]),   // D-07: lib.rs is the one file allowed to use it
    ("web_sys", &[]),                // never allowed anywhere
    ("js_sys", &[]),                 // never allowed anywhere
];
```

Update the scan loop to check `(token, exemptions)` per file:

```rust
for path in &files {
    let file_name_relative = path
        .strip_prefix(&src_dir)
        .expect("file should be under src_dir")
        .to_string_lossy()
        .to_string();

    let contents = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));

    for (lineno, raw_line) in contents.lines().enumerate() {
        let code_portion = match raw_line.find("//") {
            Some(idx) => &raw_line[..idx],
            None => raw_line,
        };
        for (token, exempt_paths) in FORBIDDEN_TOKENS_WITH_EXEMPTIONS {
            if exempt_paths.contains(&file_name_relative.as_str()) {
                continue;
            }
            assert!(
                !code_portion.contains(token),
                "CORE-02 breach: {}:{} contains `{}` as code (not a comment). \
                 Phase 2: wasm_bindgen is permitted ONLY in lib.rs. \
                 web_sys / js_sys are forbidden EVERYWHERE (including lib.rs). \
                 Offending line: {}",
                path.display(), lineno + 1, token, raw_line.trim()
            );
        }
    }
}
```

**Why this shape, not a simple `if path.ends_with("lib.rs") { continue }`:** the simple form would exempt lib.rs from *all* forbidden tokens, including `web_sys` and `js_sys`. That regresses D-07. Per-token exemption keeps `web_sys` / `js_sys` forbidden in lib.rs too.

## Hex-Escape Textarea Parser (D-11)

Harness input is a string; user pastes literal bytes where possible (0x20..0x7E print as themselves) and uses `\xNN` escapes for control bytes (ESC = `\x1B`, BEL = `\x07`, etc). Output is a `Uint8Array` ready for `feed()`.

**Recommended implementation:** Hand-rolled tiny state machine in JS. Regex is possible but regex + byte-building has awkward corner cases (lone backslash at end, `\\x` as a literal backslash-x, `\xG0` malformed).

```javascript
// www/main.js — hex-escape parser
function parseHexEscapes(input) {
    const out = [];
    let i = 0;
    while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === 0x5C /* \ */ && i + 3 < input.length + 1
            && (input.charCodeAt(i+1) === 0x78 || input.charCodeAt(i+1) === 0x58) /* x or X */) {
            const hi = input.charCodeAt(i+2);
            const lo = input.charCodeAt(i+3);
            const hiVal = hexDigit(hi);
            const loVal = hexDigit(lo);
            if (hiVal !== null && loVal !== null) {
                out.push((hiVal << 4) | loVal);
                i += 4;
                continue;
            }
            // malformed \x — treat backslash as literal, continue from 'x'
        }
        // High-byte passthrough: JS strings are UTF-16; bytes > 0x7F come in as
        // multi-unit codepoints. For Phase 2's harness, restrict to 7-bit ASCII.
        // A user who needs to feed 0x80+ uses \xNN.
        if (ch <= 0xFF) {
            out.push(ch);
        }
        i++;
    }
    return new Uint8Array(out);
}

function hexDigit(c) {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    return null;
}
```

Test cases for the parser (harness-internal sanity, not a shipping unit test): `"A"` → `[0x41]`; `"\x1B"` → `[0x1B]`; `"\\xFF"` → ambiguity resolves to `[0xFF]` (two-char escape); `"\\\\"` → `[0x5C, 0x5C]` (literal backslashes); empty → `[]`; `"\\x"` (malformed, no digits) → `[0x5C, 0x78]` (literal).

## 64 KB Single-Feed Demonstration (SC-4)

**The signal:** SC-4 demands that 64 KB of input crosses the wasm boundary in ONE `feed()` call, not 65 536 calls. Three ways to prove this in DevTools; the harness logs the first, the author verifies any of the latter two during the verification step.

### Signal 1 (always on): `console.time` / `console.timeEnd` + `performance.now` logs

```javascript
// www/main.js — stress button handler
document.getElementById('stress64k').addEventListener('click', () => {
    // Build 64 KB of plausible VT52 traffic: repeating "Hello world\n" pattern
    // with a few ESC Y moves sprinkled in. Payload length is exactly 65536.
    const bytes = buildStressPayload(65536);

    console.time('Terminal.feed 64KB');
    const t0 = performance.now();
    term.feed(bytes);
    const t1 = performance.now();
    console.timeEnd('Terminal.feed 64KB');

    console.log(`[SC-4] Fed ${bytes.length} bytes in ONE feed() call`);
    console.log(`[SC-4] Elapsed: ${(t1 - t0).toFixed(3)} ms`);
    console.log(`[SC-4] If this log appears ONCE (not 65536 times), SC-4 is satisfied.`);

    refreshHarnessUI();
});
```

**Why this proves SC-4:** the `console.log` after `feed()` returns fires exactly once per click. If the harness had been calling `feed()` per byte in a loop, the logs would repeat 65 536 times. The log text itself is the proof artifact the author screenshots.

### Signal 2 (author verification step): Chromium DevTools Performance tab

Record a Performance profile while clicking the 64 KB button. In the flame graph, look for a single `Terminal.feed` frame (the wasm-bindgen method call shows up named as the export or as `__wbg_feed_...`). If the implementation is correct the flame shows: one `click` event → one `feed` wasm call → a burst of internal wasm parser work → return. If incorrect the flame would show 65 536 stacked `feed` calls, visibly awful.

### Signal 3 (author verification step): `console.count`

The harness could additionally log `console.count('feed call')` inside the click handler. After one click, the console shows "feed call: 1". After a correct implementation, subsequent clicks show 2, 3, etc. — never thousands per click.

### Stress payload shape (Claude's Discretion)

Recommended payload structure:
- First 256 bytes: ramp through 0x20..0x7E (printable ASCII) then back to 0x20. Exercises `print` path.
- Next 6 bytes: `\x1B Y 0x20 0x20` (cursor home via direct addressing). Exercises `esc_dispatch`.
- Repeat the previous 262-byte block ~250 times until payload is exactly 65 536 bytes. Pad with spaces to hit the exact length.

Alternative per CONTEXT-permitted discretion: generate 65 536 random bytes from `crypto.getRandomValues(new Uint8Array(65536))`. Tests the parser's malformed-input silent-discard path (D-15). Both payloads are valid; the first is more realistic VT52 traffic.

## Local-Dev Serving Options

| Tool | Install | Command | MIME for `.wasm` | Caveat |
|------|---------|---------|-----------------|--------|
| `python3 -m http.server` | Pre-installed on Linux/macOS (verified Python 3.12.3 locally) | `python3 -m http.server -d www 8000` | Correct (`application/wasm`) as of Python 3.7.2+; verified in Python 3.12 source at Lib/http/server.py extensions_map [CITED: Python docs] | Single-threaded; reloads on Ctrl-C + re-run; no hot-reload. Fine for a dev harness. |
| `basic-http-server` | `cargo install basic-http-server` | `basic-http-server www` | Correct | Rust binary, no Node. Default port 4000. |
| `miniserve` | `cargo install miniserve` or `brew install miniserve` | `miniserve www --index index.html` | Correct | Directory listing by default; pass `--index` to serve `index.html`. |
| Vite / npm tooling | — | — | — | **Rejected by D-14.** Adds npm + Node to the dev stack. |

**Critical MIME-type point:** Chromium refuses to stream-compile a `.wasm` file served with any MIME type other than `application/wasm` (strict since 2019). If the harness shows `CompileError: Wasm decoding failed: expected magic word ...` or `Incorrect response MIME type. Expected 'application/wasm'`, the server is wrong. All three options above serve it correctly. [CITED: MDN — "MIME types on the web" + Chromium streaming-compile requirements]

**Recommendation:** Document both `python3 -m http.server` and `basic-http-server` in `www/README.md` (or inline in `www/index.html` as a comment). D-14 declines to pick one; the harness works with either.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rust↔JS call-site boilerplate | Custom FFI macros | `wasm-bindgen` 0.2.118 | The standard. ADR-001 already commits to the `wasm-bindgen` ecosystem. |
| Wasm module instantiation + URL resolution in JS | Hand-written `WebAssembly.instantiate` + `fetch` + `env` imports construction | `wasm-pack --target web` emits a `init(url?)` function that handles all of it | Rolling your own misses browser-specific streaming-compile optimizations. |
| Zero-copy view into wasm memory | Serializing grid to `Vec<u8>` → JSON → JS object tree | `new Uint8Array(wasm.memory.buffer, ptr, len)` | Per-frame JSON marshalling allocates ~15 KB/frame = 0.9 MB/s GC churn at 60 Hz. Zero-copy = literally 0 allocs. |
| Contiguous row-major grid view over `VecDeque<Row>` | Refactoring `Scrollback` into a single `Vec<Cell>` + ring offset | Explicit `pack_buf` on `Terminal` + `snapshot_grid()` | Refactor would break 128 passing Phase 1 tests. 15 KB memcpy is trivial. (D-01) |
| ASCII render loop over UTF-8 | `new TextDecoder('utf-8').decode(...)` | Raw byte iteration + `String.fromCharCode` | VT52 is 7-bit but bytes 0x80-0xFF may appear. TextDecoder would drop or replace them (PITFALLS #10). |
| Static-site dev server | Custom Node HTTP server | `python3 -m http.server` or `basic-http-server` | Both serve `.wasm` with correct MIME type. Trivial deployment. |
| Hex-escape string-to-bytes | Full ES-module dependency | 30-line JS function (Pattern 4 above) | Dependency weight unjustified for a dev-only parser. |
| Bell flag boundary type | `bool` struct with `#[wasm_bindgen]` | `bell_pending() -> bool` getter | wasm-bindgen marshals `bool` natively as a primitive. No struct needed. |
| Cursor position type | `struct Cursor { row: u32, col: u32 }` with `#[wasm_bindgen]` | `cursor_packed() -> u32` (row<<16 \| col) per D-09 | Packed u32 is a single register return; struct would cost an alloc. |

**Key insight:** Phase 2's wasm-bindgen surface is deliberately a thin façade over already-working pure-Rust methods. Anywhere a new Rust struct would cross the boundary, either pack it into a primitive (u32, u64) or expose it as a raw byte view. No `#[wasm_bindgen(getter_with_clone)]`, no `serde_wasm_bindgen`, no JSON. (ADR-001's vte + Pattern 3 carry no marshalling cost.)

## Runtime State Inventory

> This section applies because Phase 2 adds a new persisted-on-disk artifact (the `www/pkg/` wasm output) and modifies an existing test file with path-based exemptions. Most categories are "Nothing found — verified."

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no databases, no persistent state stores touched by Phase 2. | None. |
| Live service config | None — no running services (no n8n, no datadog, no tailscale ACLs). Phase 2 is pure library + static site. | None. |
| OS-registered state | None — no Task Scheduler, launchd, pm2, or systemd entries. | None. |
| Secrets/env vars | None — no env vars read or written. | None. |
| Build artifacts / installed packages | **1. `www/pkg/`** — wasm-pack output directory. Emitted by `scripts/build.sh`. Gitignored per D-13. Stale after every `cargo build -p bestialitty-core` even on native. Not stale after `wasm-pack build --target web --out-dir ../../www/pkg crates/bestialitty-core`. **2. `target/wasm32-unknown-unknown/`** — Rust intermediate artifacts for the wasm target. Added the first time `cargo build --target wasm32-unknown-unknown` runs. Existing `target/` may co-exist fine. **3. `Cargo.lock`** — adds `wasm-bindgen`, `wasm-bindgen-macro`, `wasm-bindgen-shared`, `wasm-bindgen-backend`, `cfg-if`, `once_cell`, `bumpalo`, possibly `log` and friends. Lockfile grows by ~6-10 entries. | `www/pkg/.gitignore` file with `*` content; `www/.gitignore` adds `pkg/` to repo-level gitignore. Cargo.lock is committed; its new entries are benign. |

**Nothing found in category:** Stored data, live service config, OS-registered state, secrets — all verified by inspecting the Phase 2 file list in CONTEXT.md and the canonical_refs. Phase 2 is a pure library + static-site delivery; no running services involved.

## Common Pitfalls

### Pitfall 1: Per-byte `feed()` Calls Tanking Throughput (PITFALLS #4)

**What goes wrong:** Harness author writes `for (const b of bytes) term.feed(new Uint8Array([b]));`. 64 KB of input becomes 65 536 boundary crossings. Each crossing: wasm-bindgen marshalling, a `Uint8Array` construction, Rust stack frame setup/teardown. Throughput collapses; DevTools Performance tab shows a flame of `__wbg_feed_*` entries.

**Why it happens:** The API signature `feed(bytes: &[u8])` could be called with a single byte. The idiomatic JS pattern "iterate and call" is what breaks it.

**How to avoid:**
- The harness explicitly calls `term.feed(bytes)` once with the full `Uint8Array` (`bytes` is the whole payload, not `bytes[i]`).
- The 64 KB stress button demonstrates this with `performance.now()` timestamps bracketing one call.
- SC-4 is the verification. The `boundary_api_shape.rs` test pins `feed(&[u8])` — so the signature can't drift to `feed(u8)`.

**Warning signs:** DevTools Performance tab shows thousands of `feed` flame entries; stress payload takes >500 ms (should be <10 ms).

### Pitfall 2: `wasm.memory.buffer` Detachment After Memory Growth [VERIFIED: github.com/wasm-bindgen/wasm-bindgen/issues/4395, WebSearch confirmation]

**What goes wrong:** JS caches `gridView = new Uint8Array(wasm.memory.buffer, ptr, len)` at startup. Later a Rust allocation grows wasm linear memory past its current capacity (Rust calls `memory.grow(n)` internally). The existing `ArrayBuffer` is replaced by a new one; the cached `gridView` now references a detached buffer. Reads throw `TypeError: Cannot perform %TypedArray%.prototype.length on detached ArrayBuffer`.

**Why it happens:** WebAssembly linear memory is backed by an `ArrayBuffer` that can grow. Growth either in-place (if enough reserved) or via replacement. In Chromium/V8, non-shared wasm memories are typically replaced — all views detach.

**How to avoid for Phase 2:**
- D-03 pins the invalidation contract: re-derive views after `term.resize()` (grid may grow), only that. `feed()` + `snapshot_grid()` + `resize_scrollback()` should not grow memory in practice — pack_buf is fixed at `visible_rows * cols * 8 = 15 360 bytes` at 24×80; vec remains capacity-stable across `feed()`.
- Document the invariant explicitly in `main.js`. Call `reDeriveViews()` from the `resize` event handler if shipped.
- **Defensive option (recommended for Phase 2):** Re-derive on every render tick. Cost: two `Uint8Array` constructions per frame, essentially free. Guarantees correctness even if Rust-side behaviour changes.

**Example of the pattern:**
```javascript
// Safer — always re-derive in the render path
function renderAscii() {
    term.snapshot_grid();
    const gridView = new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len());
    const dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
    // ... read from both ...
}
```

**Warning signs:** `TypeError: detached ArrayBuffer` in console. Harness looks fine at startup but breaks after resize.

### Pitfall 3: `#[wasm_bindgen]` on `&mut self` Methods Wrong Lifetime Inference

**What goes wrong:** wasm-bindgen sometimes fails to compile methods that borrow `&mut self` and also take a `&[u8]` argument if the internal wasm-bindgen shim needs to hold both borrows simultaneously. The error is cryptic: "cannot borrow self as mutable because it is also borrowed as immutable" pointing at macro-generated code.

**Why it happens:** The generated glue may stash the slice view on the wasm side and pass a pointer, then invoke the method — wasm-bindgen has to juggle the slice's lifetime against `&mut self`.

**How to avoid:**
- Every Phase-2-added method matches the Phase 1 Terminal signatures exactly: `feed(&mut self, &[u8]) -> Vec<u8>` is already proven to compile (Phase 1 tests pass). `snapshot_grid(&mut self)`, `resize(&mut self, u32, u32)`, `clear_dirty(&mut self)`, `clear_bell(&mut self)` have no slice args; they're trivially safe. `grid_ptr(&self)`, `grid_byte_len(&self)`, `dirty_ptr(&self)`, `rows(&self)`, `cols(&self)`, `bell_pending(&self)`, `cursor_packed(&self)` are all `&self`, no conflict.
- `encode_key_raw(code: u32, mods: u32) -> Vec<u8>` is a free function (not a method), so there's no self at all.

**Warning signs:** `wasm-pack build` fails with borrow-checker errors. The fix: lift the slice parameter outside the `&mut self` call, or re-shape the method.

### Pitfall 4: Panicking Across the wasm-bindgen FFI

**What goes wrong:** Rust code panics (e.g., `pack_buf[i]` on an out-of-bounds index). The panic propagates into the wasm-bindgen shim, which aborts wasm execution. JS sees the call throw a generic `RuntimeError: unreachable`. No stack trace in Rust source; DevTools shows only the wasm instruction that trapped.

**Why it happens:** wasm has no native exception ABI. Panics default to `abort`.

**How to avoid for Phase 2:**
- All Phase 2 methods (`snapshot_grid`, `pack_ptr`, `grid_byte_len`, `dirty_ptr`, `cursor_packed`, `rows`, `cols`) are bounds-safe by construction. `snapshot_grid` resizes `pack_buf` when the grid shape differs (no panic possible); `pack_ptr` is a vec-ptr getter (never panics on a non-empty vec).
- `encode_key_raw` is the riskiest: `unpack_keycode(code)` could panic on a malformed `u32`. Recommend: `unpack_keycode` returns `Option<KeyCode>` and `encode_key_raw` returns `Vec::new()` on `None`. No panic path.
- **Optional (dev convenience):** wire `console_error_panic_hook` in the wasm-only `init()` helper so any accidental panic shows a Rust stack trace in Chromium DevTools. Cost: ~3 KB of wasm; gate behind a `#[cfg(target_arch = "wasm32")]` block. Can defer to Phase 3 if size-sensitive.

**Warning signs:** `RuntimeError: unreachable` in DevTools; wasm module state becomes invalid afterwards (you must `init()` again).

### Pitfall 5: `wasm-pack --out-dir` Relative-Path Confusion

**What goes wrong:** `wasm-pack build --target web --out-dir ../../www/pkg` run from the workspace root writes to `../../www/pkg` RELATIVE TO THE CRATE's Cargo.toml directory, not relative to the cwd. Author sees files appear at `../../www/pkg/` under the crate dir, which resolves to the filesystem's `../../../www/pkg`. Files appear nowhere expected.

**Why it happens:** `wasm-pack` semantics for `--out-dir` (and `--path`) are crate-relative. Documented but easy to miss.

**How to avoid:** Either (a) run from the crate dir with a short relative out-dir, (b) use an absolute path from a build script, or (c) pass `--out-dir` relative to the crate.

**Recommended `scripts/build.sh`:**
```bash
#!/usr/bin/env bash
# scripts/build.sh — build the wasm core into www/pkg
set -euo pipefail
cd "$(dirname "$0")/.."        # repo root
wasm-pack build crates/bestialitty-core \
    --target web \
    --out-dir ../../www/pkg \
    --release
echo "Built www/pkg/ — serve with: python3 -m http.server -d www 8000"
```

**Warning signs:** `www/pkg/` is empty after a build; files appear at an unexpected path outside the repo.

### Pitfall 6: wasm-pack Needing `wasm-opt` — But It's Optional

**What goes wrong:** `wasm-pack build` by default runs `wasm-opt -O` as a post-processing pass. If `wasm-opt` isn't on PATH, the build logs a warning and continues with the unoptimized binary. Some CI environments fail on the warning.

**Why it happens:** `wasm-opt` is part of Binaryen, a separate install.

**How to avoid:** Phase 2 doesn't need `wasm-opt` for correctness. Either (a) install `wasm-opt` (brew / apt / download Binaryen release), (b) pass `--no-opt` to `wasm-pack build`, or (c) ignore the warning — the unoptimized wasm still works. For Phase 2 dev loops, `--no-opt` is faster.

### Pitfall 7: Chromium Stream-Compile MIME-Type Refusal

**What goes wrong:** User serves `www/` with a toy HTTP server that returns `application/octet-stream` or `text/plain` for `.wasm`. Chromium refuses to stream-compile. Harness shows `CompileError: Wasm decoding failed` or `WebAssembly.instantiateStreaming failed ... Incorrect response MIME type`.

**Why it happens:** `WebAssembly.instantiateStreaming` requires `application/wasm`.

**How to avoid:** Use Python's http.server (Python 3.7.2+ maps `.wasm` correctly) or basic-http-server. Document this in README. **The `init()` function emitted by `wasm-pack --target web` already falls back from `instantiateStreaming` to `instantiate` on MIME failure**, so the harness still works under a broken server — just without streaming compile. This is a performance tax, not a correctness failure, in 0.14.0 [VERIFIED: wasm-bindgen guide without-a-bundler.html].

### Pitfall 8: CORE-02 Test Subprocess Cargo Environment

**What goes wrong:** `tests/core_02_no_browser_deps.rs` invokes `Command::new(env!("CARGO")) ... metadata`. The subprocess inherits cwd. If the test is run via `cargo test -p bestialitty-core` from the workspace root, cwd is workspace root — metadata covers the whole workspace. Fine. But `wasm-bindgen` dep's metadata entry lists its own package name, matching the allowlisted `wasm-bindgen`. Correct behaviour.

**Risk during Phase 2:** the metadata format might list `wasm-bindgen-macro`, `wasm-bindgen-shared`, `wasm-bindgen-backend`, `wasm-bindgen-futures`. We removed only `"wasm-bindgen"` from `FORBIDDEN_CRATES`. `"wasm-bindgen-futures"` is still listed. If Phase 2's wasm-bindgen version transitively depends on wasm-bindgen-futures, the test fires a false-positive CORE-02 breach. [VERIFIED: `cargo tree` on wasm-bindgen 0.2.118 — it does NOT pull wasm-bindgen-futures; wasm-bindgen-futures is a separate optional crate only needed for async `JsFuture` bridging, which Phase 2 does not use.]

**Warning signs:** `cargo test -p bestialitty-core` fails on `dependency_graph_excludes_browser_crates` after adding wasm-bindgen. Diagnosis: the test output shows which crate name matched. Remediation: confirm whether it's a legitimately-needed transitive or an unwanted dep, and update the allowlist accordingly.

## Code Examples

Verified patterns from official sources.

### Example 1: `init()` boilerplate for `--target web`

```javascript
// Source: https://rustwasm.github.io/docs/wasm-pack/commands/build.html
// Source: https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html
import init, { Terminal } from './pkg/bestialitty_core.js';

// init() returns the WebAssembly.Instance's `exports` plus convenience fields;
// for our use, the `memory` export is what we need.
const wasm = await init();
// Now `wasm.memory` is the WebAssembly.Memory; wasm.memory.buffer is the ArrayBuffer.
```

### Example 2: Zero-copy view construction

```javascript
// Source: https://docs.rs/js-sys/latest/js_sys/struct.Uint8Array.html
// Documented JS semantics; wasm-bindgen generates compatible output.
const gridView = new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len());
// gridView is a typed array view. No copy. Reading gridView[i] reads the i-th byte of
// Rust's pack_buf directly.
```

### Example 3: The Phase-1-verified pattern extended by Phase 2

```rust
// Source: crates/bestialitty-core/src/terminal.rs (current Phase 1 shape)
// Phase 2 extension — new pub fn snapshot_grid / pack_ptr / pack_byte_len / dirty_ptr
// added alongside existing methods; no existing method changes.
impl Terminal {
    pub fn snapshot_grid(&mut self) { /* memcpy each row into pack_buf */ }
    pub fn pack_ptr(&self) -> *const u8 { self.pack_buf.as_ptr() as *const u8 }
    pub fn pack_byte_len(&self) -> usize { self.pack_buf.len() * std::mem::size_of::<Cell>() }
    pub fn dirty_ptr(&self) -> *const u8 { self.dirty.as_slice().as_ptr() }
}
```

### Example 4: wasm-bindgen façade pattern

```rust
// Source: https://rustwasm.github.io/docs/wasm-bindgen/
#[cfg(target_arch = "wasm32")]
mod wasm_boundary {
    use wasm_bindgen::prelude::*;
    use crate::terminal::Terminal as CoreTerminal;

    #[wasm_bindgen]
    pub struct Terminal { inner: CoreTerminal }

    #[wasm_bindgen]
    impl Terminal {
        #[wasm_bindgen(constructor)]
        pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Terminal {
            Terminal { inner: CoreTerminal::new(rows, cols, scrollback_cap) }
        }
        // feed / grid_ptr / grid_byte_len / dirty_ptr / snapshot_grid /
        // rows / cols / clear_dirty / bell_pending / clear_bell /
        // cursor_packed / resize / resize_scrollback — all thin wrappers
    }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `wasm-pack --target bundler` + webpack/Rollup | `wasm-pack --target web` + native `<script type="module">` | ES modules stabilized (~2018); top-level await (2022) | No bundler needed for static-site deployments. D-13 / D-14 bet on this. |
| `wee_alloc` for small bundles | Default Rust allocator | ~2022 — wee_alloc unmaintained, memory leak reported | We use the default allocator. STACK.md already called this out. |
| `serde_wasm_bindgen` for structs | Primitives + zero-copy byte views | Always, for hot paths | Phase 2 follows this — cursor is `u32`, grid is byte view. No serde in the boundary. |
| `TextDecoder` on serial streams | Raw `Uint8Array` | Always | PITFALLS #10 documents this. |
| `[dependencies] wasm-bindgen` | `[target.'cfg(target_arch = "wasm32")'.dependencies] wasm-bindgen` for dual-target crates | Current Rust+Wasm book recommendation | Candidate A above. |
| `wasm-pack 0.12.x` | `wasm-pack 0.14.0` (2026-01-20) | Jan 2026 | 0.13+ fixed NPM binary-versioning issue. Local box has 0.12.1, still works; Phase 2 MAY upgrade if build issues arise. |

**Deprecated/outdated:**
- `wee_alloc`: use default allocator.
- `wasm-pack --target no-modules`: use `--target web`.
- `serde_wasm_bindgen` in hot paths: use zero-copy views.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust 1.85+ + cargo test (rlib path, native); no in-browser tests in Phase 2 scope |
| Config file | `Cargo.toml` [dev-dependencies] (currently empty); `tests/*.rs` integration tests |
| Quick run command | `cargo test -p bestialitty-core --lib` (unit tests, <5 s) |
| Full suite command | `cargo test -p bestialitty-core` (lib + integration tests) |
| Extra wasm-build gate | `wasm-pack build crates/bestialitty-core --target web --out-dir /tmp/pkg-test --no-opt` — proves the crate compiles to wasm |
| Harness verification | Manual: load `www/index.html` under `python3 -m http.server -d www`, click "Feed" with a pasted ESC Y sequence, observe ASCII render and dirty bitmap. SC-4: click "64 KB Stress", read `console.log` output. |

### Phase Requirements → Test Map

| Req / SC | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-03 (SC-1 + SC-2 build) | `wasm-pack build --target web` produces working `pkg/` consumable as ES module | build smoke | `wasm-pack build crates/bestialitty-core --target web --out-dir /tmp/pkg-smoke --no-opt` + `ls /tmp/pkg-smoke/bestialitty_core*.{js,wasm,d.ts}` | ❌ Wave 0 — a shell-script smoke test under `scripts/smoke-wasm-build.sh` |
| CORE-03 (D-10 pins) | New boundary methods compile with exact D-09 signatures | unit (integration) | `cargo test -p bestialitty-core --test boundary_api_shape` | ✅ extended in Phase 2 |
| CORE-04 | JS shell owns Web Serial / DOM / event loop; Rust core has zero bindings | lint-ish unit (integration) | `cargo test -p bestialitty-core --test core_02_no_browser_deps` | ✅ updated in Phase 2 |
| CORE-05 (SC-3 zero-copy) | `grid_ptr` / `grid_byte_len` / `dirty_ptr` return stable pointers into pack_buf / dirty bytes; byte-layout matches Cell repr(C) | unit (integration) | `cargo test -p bestialitty-core --test boundary_api_shape::grid_ptr_stable_across_feed` (new, Wave 0) | ❌ Wave 0 |
| CORE-05 (SC-3 invalidation contract) | pointer is stable across `feed()` / `push_line` / `resize_scrollback`; changes across `resize` | unit (integration) | `cargo test -p bestialitty-core --test boundary_api_shape::grid_ptr_invalidation_contract` (new, Wave 0) | ❌ Wave 0 |
| CORE-05 (SC-4 batched) | `feed(&[u8])` signature accepts a slice of any length; one call suffices for 64 KB | signature pin (integration) | `cargo test -p bestialitty-core --test boundary_api_shape::feed_accepts_large_slice` (exists as `terminal_feed_accepts_byte_slice_returns_vec_u8`; extend with a 65 536-byte payload) | ✅ extend existing test |
| SC-2 harness render | paste → feed → ASCII render matches expected grid | **manual-only** (browser, DevTools) | Load harness, paste `"Hello\x1BY\x21\x20World"`, observe `Hello` on row 0 + `World` on row 1 | N/A — harness page |
| SC-4 single boundary call | 64 KB via one `feed()` call | **manual-only** (browser, DevTools) | Load harness, click "64 KB Stress", observe single `[SC-4] Fed 65536 bytes in ONE feed() call` console log + single flame entry in Performance tab | N/A — harness page |
| Pack-buffer content correctness | after `snapshot_grid`, pack_buf bytes for row R match `scrollback.row(R).as_slice()` | unit | `cargo test -p bestialitty-core --lib terminal::tests::snapshot_grid_mirrors_scrollback` (new, Wave 0) | ❌ Wave 0 |
| `cursor_packed` round-trip | decoding `(u >> 16, u & 0xFFFF)` equals `cursor()` tuple | unit | `cargo test -p bestialitty-core --lib terminal::tests::cursor_packed_matches_tuple` (new, Wave 0) | ❌ Wave 0 |
| `encode_key_raw` delegation | `(code, mods)` unpacks to the same `KeyEvent` that `key::encode` consumes | **manual-only** or unit — the unpacker is private in lib.rs; the test would have to live alongside lib.rs under `#[cfg(target_arch = "wasm32")]` OR the unpacker moves to key.rs as `pub fn unpack(code: u32, mods: u32) -> KeyEvent`. Recommend the latter — test becomes a pure native unit test. | `cargo test -p bestialitty-core --lib key::tests::unpack_known_codes` (new, Wave 0) | ❌ Wave 0 |
| Native cargo test after wasm-bindgen added | all Phase 1 tests still pass; plain `cargo test` works with no flags | regression | `cargo test -p bestialitty-core` | ✅ exists (the full Phase 1 test suite) |

### Sampling Rate
- **Per task commit:** `cargo test -p bestialitty-core --lib` (unit) + the changed integration test (quick).
- **Per wave merge:** `cargo test -p bestialitty-core` (full) + `scripts/smoke-wasm-build.sh` (wasm-pack build gate).
- **Phase gate:** Full suite green + wasm-pack builds + manual harness demonstration (SC-2, SC-4) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `scripts/smoke-wasm-build.sh` — builds the crate with `wasm-pack --target web --no-opt` and verifies expected files appear in `pkg/`
- [ ] Extend `tests/boundary_api_shape.rs` with D-10 pins: `snapshot_grid`, `grid_ptr`, `grid_byte_len`, `dirty_ptr`, `cursor_packed`, `encode_key_raw`, AND new behavioural tests: `grid_ptr_stable_across_feed`, `grid_ptr_invalidation_contract` (pointer value before/after resize), `feed_accepts_large_slice` (feed 65 536 bytes in one call, assert no panic)
- [ ] New `terminal::tests::snapshot_grid_mirrors_scrollback` — unit test in `terminal.rs` verifying pack_buf matches scrollback rows byte-for-byte
- [ ] New `terminal::tests::cursor_packed_matches_tuple` — pin the u32 packing convention `(row << 16) | col`
- [ ] New `key::tests::unpack_known_codes` — if `unpack_keycode` / `unpack_mods` move to `key.rs` as pub fns (recommended for test coverage)
- [ ] Update `tests/core_02_no_browser_deps.rs` per Candidate A: remove `"wasm-bindgen"` from `FORBIDDEN_CRATES`, restructure `FORBIDDEN_TOKENS` to `FORBIDDEN_TOKENS_WITH_EXEMPTIONS` with `lib.rs` exempt from `wasm_bindgen`
- [ ] `www/README.md` or inline `www/index.html` comment documenting the two dev-server options (python3, basic-http-server)

No framework install needed — `cargo test` is already the framework, Phase 1 proved it works. wasm-pack is pre-installed (0.12.1; 0.14.0 is current but 0.12.1 still builds `--target web` correctly).

## Security Domain

Phase 2 scope is a **dev-only local harness on a static site** with no network I/O, no user accounts, no secrets, no PII, and no server runtime. The harness loads wasm from same-origin `./pkg/`, runs on the user's machine, and holds no persistent state. ASVS categories mostly do not apply; the relevant ones are narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes — hex-escape parser | Bounded hand-rolled parser; no eval; no regex injection surface. Max input length capped at textarea size. |
| V6 Cryptography | no | — |
| V7 Data Protection | no | — |
| V10 Malicious Code | partial — wasm binary integrity | `wasm-pack` output is produced by our Rust source; deployment story (Phase 6) owns Subresource Integrity or signing. Phase 2's dev harness runs local-only. |
| V12 File & Resources | yes — dev server MIME types | Dev-serve advice: use python3 http.server or basic-http-server, which serve `.wasm` as `application/wasm`. Chromium refuses streaming-compile for other MIMEs (failsafe). |
| V14 Configuration | partial — Permissions-Policy | Phase 6 deployment concern; Phase 2 dev harness has no network exposure. |

### Known Threat Patterns for {Rust + wasm-bindgen + static HTML}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Panicking across FFI trashes wasm state (availability) | Denial of service | Bounds-safe Rust code; `console_error_panic_hook` optional for dev visibility |
| Detached `ArrayBuffer` reads throw uncaught TypeError | Reliability (availability) | D-03 re-derive contract + defensive re-derive on every render tick |
| Malformed `\xNN` in harness textarea parser | Input validation (tampering) | Hand-rolled parser with explicit malformed-path handling (treat `\x` without two hex digits as literal) |
| Wasm binary substitution during dev (MitM on localhost) | Tampering | Static site + localhost-only dev → negligible threat surface; Phase 6 owns deployment integrity |
| Cross-origin wasm loading | Malicious code | Same-origin only; `fetch('./pkg/bestialitty_core_bg.wasm')` resolves to the same origin as the HTML |
| Ctrl-W / Ctrl-T browser intercepts | Availability | Phase 4 concern (keyboard focus), not Phase 2 |
| XSS via textarea paste | Tampering | Textarea value is a *string*, not HTML; the harness never `innerHTML`s it. Grid render uses `textContent` (safe) or builds string via `String.fromCharCode` and sets `textContent`. |

**Key security note:** Phase 2's harness renders grid output with `<pre>.textContent = asciiString`. Never `innerHTML` — a hypothetical future bug where raw bytes reach the DOM as HTML would be a DOM-XSS surface. `textContent` is the mandatory sink.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | [ASSUMED] `wasm-pack 0.12.1` (local box) produces output compatible with modern `--target web` semantics | Environment Availability | Low risk — `--target web` output shape is stable since ~0.10; upgrade to 0.14.0 if build fails. |
| A2 | [ASSUMED] `python3 -m http.server` maps `.wasm` → `application/wasm` on Python 3.12 | Dev Serving | Cheap to verify — `curl -I http://localhost:8000/pkg/bestialitty_core_bg.wasm` and check `Content-Type`. If wrong, swap to basic-http-server. |
| A3 | [ASSUMED] Top-level `await init()` works in Chromium without module preload shenanigans | Pattern 1 | Chromium ≥89 supports top-level await (2021). Project is Chromium-only. Low risk. |
| A4 | [ASSUMED] `cargo metadata` output for `[target.'cfg(target_arch = "wasm32")'.dependencies]` entries includes `wasm-bindgen` regardless of host | CORE-02 Update | Verify during implementation: `cargo metadata --format-version=1 \| grep '"name":"wasm-bindgen"'` on the x86_64 host. If missing, the test's allowlist update is unnecessary — but the token-level exemption for `lib.rs` is still required. |
| A5 | [ASSUMED] `wasm-bindgen 0.2.118` does NOT transitively pull `wasm-bindgen-futures` | Pitfall #8 | Verify via `cargo tree -p bestialitty-core --target wasm32-unknown-unknown` after dep is added. If it does, add `wasm-bindgen-futures` to the allowlist (it's async-specific; we don't use it functionally but it'd be in the graph). |
| A6 | [ASSUMED] 64 KB in one `feed()` call completes in < 50 ms on a modern laptop | SC-4 signal design | Parser is byte-at-a-time over `vte::Parser::advance`, each byte is ~10 ns. 64 KB × 10 ns = 0.6 ms. If Rust panic-free and bounds-safe, sub-10 ms is the expected range. |
| A7 | [ASSUMED] The `Cell` `#[repr(C)]` layout's `ch: u32` low byte (byte 0 in little-endian) is the raw VT52 byte | Zero-copy pattern (ASCII read) | Verified via `crates/bestialitty-core/src/grid.rs:19` comment: "Raw VT52 byte (0x00-0xFF) in LSB". On wasm32 little-endian target, byte 0 of the u32 is the LSB. Confirmed via `Cell::with_byte(b'A')` test on `grid.rs:124-128` — `cell.ch == 0x41`. Safe. |

## Open Questions

1. **Should the wasm-bindgen façade's `Terminal` struct be named `Terminal` or something else to avoid clashing with the pure-Rust `crate::terminal::Terminal`?**
   - What we know: Phase 1's `crate::terminal::Terminal` is what `tests/boundary_api_shape.rs` compiles against.
   - What's unclear: if `lib.rs` also exports `pub struct Terminal`, the two share a name. Rust's module system handles it (they're in different modules), and wasm-bindgen exports the lib.rs one under its canonical name. JS sees one `Terminal`.
   - Recommendation: name the wasm-bindgen struct `Terminal` (matching what JS imports) and alias the inner as `use crate::terminal::Terminal as CoreTerminal`. Clear at the code site, clean on the JS side. (See Pattern 3 and 4 examples above.)

2. **Should `encode_key_raw`'s KeyCode packing scheme (u32 encoding) be pinned in this phase or deferred to Phase 4?**
   - What we know: D-09 mandates `encode_key_raw(code: u32, mods: u32) -> Vec<u8>`. D-10 mandates the signature is pinned in `boundary_api_shape.rs`.
   - What's unclear: the precise u32 packing of KeyCode variants (ArrowUp, Char(b), KeypadDigit(n), etc.).
   - Recommendation: publish the packing convention in the Phase 2 plan as a documented scheme, implement the unpacker in `key.rs` as `pub fn unpack(code: u32, mods: u32) -> KeyEvent`, test it via `key::tests::unpack_known_codes`. Phase 4 then ingests DOM KeyboardEvent → (u32, u32) per this already-locked scheme. Recommended scheme:
     - `code` low 8 bits: discriminant tag (0=Char, 1=ArrowUp, 2=ArrowDown, 3=ArrowLeft, 4=ArrowRight, 5=Enter, 6=Tab, 7=Backspace, 8=Escape, 9=KeypadDigit, 10=KeypadEnter, 11=KeypadComma, 12=KeypadMinus, 13=KeypadDot, 255=Unknown).
     - `code` bits 8-15: payload byte (for `Char(u8)` variant).
     - `code` bits 16-31: reserved (zero).
     - `mods` bits 0-3: ctrl/shift/alt/meta flags.
     - `mods` bits 4-31: reserved (zero).
   - On malformed input (unknown tag), `encode_key_raw` returns `Vec::new()`.

3. **Should the harness page use `Terminal::new(...)` as a constructor call (`new Terminal(24, 80, 10000)`) or a static `Terminal.new(24, 80, 10000)` call?**
   - What we know: wasm-bindgen's `#[wasm_bindgen(constructor)]` attribute makes the method callable as `new Terminal(...)` in JS. Without that attr, JS calls it as `Terminal.new(...)`.
   - Recommendation: use `#[wasm_bindgen(constructor)]`. JS `new Terminal(...)` reads natively; Phase 3/4 renderers will prefer it.

4. **Should `www/` be created in Phase 2 or already exist?**
   - What we know: Phase 1 left `www/` uncreated. `www/pkg/` is gitignored per D-13. `www/index.html`, `www/main.js`, `www/README.md` are tracked.
   - Recommendation: Phase 2 creates `www/` with its initial contents. No migration needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust stable | Phase 1+2 Rust builds | ✓ | 1.94.1 (cargo); `rust-toolchain.toml` pins stable | — |
| `rustup` | `rustup target add wasm32-unknown-unknown` | ✓ | 1.29.0 | — |
| `wasm32-unknown-unknown` target | wasm-pack build | **Unknown** (not yet installed per Phase 1 rust-toolchain.toml comment) | — | `rustup target add wasm32-unknown-unknown` — trivial, pulls std for wasm32 |
| `wasm-pack` | Build pipeline | ✓ | **0.12.1** (older than current 0.14.0) | Works for `--target web`; upgrade to 0.14.0 via `cargo install wasm-pack --force` if any build issue arises |
| `wasm-opt` (Binaryen) | `wasm-pack` optimization pass | **Unknown** | — | Pass `--no-opt` to wasm-pack, or install Binaryen. Phase 2 dev loop can run `--no-opt`. |
| `python3` | Dev static-serve option A | ✓ | 3.12.3 | `basic-http-server` (cargo install) |
| `node` | — | ✓ | 22.19.0 (not used by Phase 2 per D-14) | — |
| Chromium browser | Manual harness demonstration (SC-2, SC-4) | **Unknown** (not probed) | — | Harness works in any Chromium-based browser (Chrome, Edge, Brave, Vivaldi). Firefox and Safari are out of scope (PLAT constraint). |
| `basic-http-server` | Dev static-serve option B | **Unknown** | — | `cargo install basic-http-server` — cheap install; python3 option is always available |

**Missing dependencies with no fallback:** None. Every missing item has a trivial install path.

**Missing dependencies with fallback:**
- `wasm32-unknown-unknown` target — install with `rustup target add wasm32-unknown-unknown`. First Phase 2 task should do this (and update `rust-toolchain.toml` to include `targets = ["wasm32-unknown-unknown"]` so contributors get it automatically).
- `wasm-opt` — skip via `--no-opt` for dev builds; production deployment (Phase 6) installs it.

## Project Constraints (from CLAUDE.md)

Extracted actionable directives from `/home/ant/src/microbeast/bestialitty/CLAUDE.md`:

- **Rust → wasm core** owns parser, terminal state, key encoding. Pure logic. Zero `web-sys` / `js-sys::Serial*` / DOM / I/O dependencies. → Phase 2 adds `wasm-bindgen` only; `web-sys` and `js-sys` remain forbidden (D-07).
- **JavaScript shell** owns Web Serial I/O, canvas rendering, event loop, browser state. No business logic. → Phase 2's harness is a minimal JS shell (textarea, buttons, pre, status readout). No Rust logic migrates to JS; no JS logic migrates to Rust.
- **Rust↔JS interop** uses `wasm-bindgen` + `wasm-pack` (target `web`). → Exactly what Phase 2 delivers.
- **Web Serial is driven from JS, not Rust.** No Rust Web Serial bindings. → Phase 2 doesn't touch Web Serial at all. Honored.
- **Chromium-only.** → Harness uses top-level await (Chromium ≥89) without a fallback message. Polite-fail is Phase 6; Phase 2 harness assumes Chromium.
- **Static site deploy** only. → `www/` is the whole deliverable. No server runtime.
- **VT52 pragmatic subset** — only what the MicroBeast actually emits. → Phase 2 adds no new parser semantics.

Additional project-specific directives:
- Phases execute strictly in order 1 → 2 → 3 → 4 → 5 → 6. Phase 2 depends only on Phase 1 artifacts.
- No AI attribution in commit messages (from MEMORY.md). → Informational; affects Phase 2 commit hygiene.

## Sources

### Primary (HIGH confidence)
- Context7 `/wasm-bindgen/wasm-pack` (benchmark 81.1) — `--target web` build docs, `--out-dir`, `--no-opt`, `init()` boilerplate, `new Terminal()` constructor pattern
- [wasm-bindgen Guide — Without a Bundler](https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html) — ES-module loading on a static site
- [wasm-pack `build` command](https://rustwasm.github.io/docs/wasm-pack/commands/build.html) — target flags, out-dir semantics
- [js-sys `Uint8Array`](https://docs.rs/js-sys/latest/js_sys/struct.Uint8Array.html) — view-over-memory semantics (informational; we don't use js-sys from Rust, but JS side semantics are documented here)
- Phase 1 `.planning/phases/01-*/01-CONTEXT.md` D-17, D-18, D-19, D-20 — boundary shape that Phase 2 extends
- Phase 1 `.planning/research/ARCHITECTURE.md` §"The Wasm Boundary Contract", §"Pattern 2: Zero-Copy Grid View", §"Recommended Project Structure"
- Phase 1 `crates/bestialitty-core/src/lib.rs`, `terminal.rs`, `grid.rs`, `dirty.rs` — actual current code shape Phase 2 builds on
- Phase 1 `crates/bestialitty-core/tests/boundary_api_shape.rs`, `core_02_no_browser_deps.rs` — actual test code Phase 2 extends
- Phase 1 `.planning/decisions/ADR-001-parser-strategy.md` — `vte = "=0.15"` pin (Phase 2 MUST NOT bump)
- [Rust and WebAssembly book — Add wasm support to a crate](https://rustwasm.github.io/book/reference/add-wasm-support-to-crate.html) — target-specific dep pattern (Candidate A)
- `cargo search wasm-bindgen --limit 3` — verified current version 0.2.118 locally

### Secondary (MEDIUM confidence)
- [wasm-bindgen Guide — Supported Rust Targets](https://wasm-bindgen.github.io/wasm-bindgen/reference/rust-targets.html) — `wasm32-unknown-unknown` is Tier 2, target-specific dep recommendation
- [wasm-bindgen issue #4395 — TypedArray::view may use detached ArrayBuffer](https://github.com/wasm-bindgen/wasm-bindgen/issues/4395) — memory-detachment pitfall confirmation
- [wasm-bindgen issue #1119 — Poor Rust/WASM performance vs JavaScript](https://github.com/rustwasm/wasm-bindgen/issues/1119) — canonical boundary-chattiness case study (referenced in PITFALLS #4)
- [wasm-pack 0.13.x release notes](https://github.com/rustwasm/wasm-pack/releases) — version currency confirmation
- [MDN — MIME types](https://developer.mozilla.org/en-US/docs/Web/HTTP/MIME_types) — `.wasm` → `application/wasm` requirement for streaming compile
- [docs.rs/crate/wasm-pack/latest](https://docs.rs/crate/wasm-pack/latest) — current wasm-pack version (0.14.0)

### Tertiary (LOW confidence; flagged for validation)
- Python 3.12 `http.server` extension-map claim (LOW — verify with `curl -I` during implementation; trivial to fallback to `basic-http-server` if wrong)
- Exact `cargo metadata` output shape for target-specific deps (LOW — verify with a dry run of the updated CORE-02 test before committing; trivial to adjust allowlist)

## Metadata

**Confidence breakdown:**
- Standard stack (wasm-bindgen, wasm-pack, dev servers): HIGH — multiple official + Context7 sources verified, versions confirmed locally
- Architecture patterns (zero-copy view, snapshot-on-read, façade lib.rs): HIGH — lifts directly from ARCHITECTURE.md Pattern 2 + Phase 1 shape, all locked by CONTEXT
- Mechanism evaluation (target-specific dep vs feature vs plain): MEDIUM-HIGH — three candidates analyzed with explicit tradeoffs, recommended Candidate A is the Rust+Wasm book pattern
- CORE-02 test update strategy: HIGH — concrete code patterns given, matches existing test architecture
- Pitfalls (memory detachment, per-byte feeds, panic across FFI): HIGH — PITFALLS.md + wasm-bindgen issues cited
- SC-4 signal design (console.time + performance.now + console.log): MEDIUM — three signals documented; one is logged by the harness, two are author-verification steps in DevTools
- Harness hex-escape parser: HIGH — concrete 30-line JS given; trivial to test
- Dev-server options: HIGH — two options probed; one (python3) verified available locally

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stable toolchain, small target surface; wasm-bindgen's April 2026 release cadence may ship 0.2.119, but breaking API changes are rare within the 0.2.x line)

---

*Phase 2 research — 02-wasm-boundary-minimal-js-harness*
*Next: gsd-planner consumes this to produce `02-N-PLAN.md` files*
