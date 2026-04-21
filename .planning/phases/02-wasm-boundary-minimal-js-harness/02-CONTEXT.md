# Phase 2: Wasm Boundary & Minimal JS Harness - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the Rust↔JS interop shape end-to-end with the smallest possible JS
surface area. Produce a `wasm-pack build --target web` output that a plain
static HTML page consumes via ES module import — no bundler, no Web Serial,
no canvas. The harness demonstrates: batched `feed(bytes)` as a single
boundary call, zero-copy `Uint8Array` views over wasm linear memory for the
visible grid and dirty-row bitmap, and ASCII rendering of the current grid
into a `<pre>` from those views.

**In scope:** wasm-bindgen attribution on `crates/bestialitty-core/src/lib.rs`,
`wasm-pack` build pipeline, scratch pack-on-read buffer added to
`Terminal` for zero-copy grid exposure, extensions to the boundary API
shape test, updates to `tests/core_02_no_browser_deps.rs` to exempt
`lib.rs` from the "no wasm attrs" rule, a minimal static HTML/JS harness
page that drives `feed()` + reads the grid + dirty views + renders ASCII,
a local-dev serving strategy for ES-module import, and a 64 KB
single-`feed()` demonstration per SC-4.

**Out of scope:** Canvas rendering (Phase 3), any DOM key-event plumbing
beyond what a paste textarea needs (Phase 4), Web Serial (Phase 5), theme
/ glyph-atlas / CRT visuals (Phase 3), persistent preferences / deployment
(Phase 6). No refactor of Phase 1's parser, grid, scrollback, dirty, or
key modules — boundary additions only.

</domain>

<decisions>
## Implementation Decisions

### Grid exposure strategy (zero-copy Uint8Array view, SC-3)

- **D-01:** The visible grid is exposed to JS via a **scratch pack-on-read
  buffer** owned by `Terminal`. A private `pack_buf: Vec<Cell>` of length
  `visible_rows * cols` is populated by memcpy'ing from `Scrollback`'s
  `VecDeque<Row>` into a single contiguous row-major buffer. `Terminal`
  then exposes a stable pointer + byte length into this buffer. This
  preserves Phase 1's `VecDeque<Row>` layout (and its 128 passing tests)
  without refactoring scrollback, while still giving JS a single
  `(ptr, len)` pair for `new Uint8Array(wasm.memory.buffer, ptr, len)`.
- **D-02:** The pack is triggered by an **explicit** `snapshot_grid()`
  method the JS renderer calls once per frame before reading the
  `Uint8Array` view. Pairs ergonomically with the existing
  `clear_dirty()` per-frame pattern: snapshot_grid → read dirty view →
  read pack view → clear_dirty. Cost is visible at the call site rather
  than hidden inside a getter.
- **D-03:** The pack-buffer pointer is **invalidated only by
  `resize(rows, cols)`**. `feed()`, internal scroll (`push_line`),
  `resize_scrollback(cap)` do not invalidate it — `resize_scrollback`
  only affects the historical tail, not the visible region. JS derives
  the `Uint8Array` view once on construction and re-derives only after
  `resize`. Matches the D-17 invalidation contract for `grid_ptr()` /
  `dirty_ptr()` verbatim.
- **D-04:** The pack buffer lives **on `Terminal` (pure-Rust core)**, not
  in a lib.rs wasm wrapper. Keeps the snapshot path pure Rust: native
  `cargo test` can exercise it without wasm. lib.rs stays a thin
  wasm-bindgen façade over already-pure methods. Honors D-20
  (wasm attrs confined to lib.rs) without pushing stateful buffers into
  the boundary layer.

### Dirty-row bitmap exposure

- **D-05:** No new mechanism — `Dirty::as_slice()` already returns a
  single contiguous `&[u8]`. lib.rs exposes `dirty_ptr()` +
  `rows()` directly off it, matching D-17 verbatim. Zero-copy
  requirement (SC-3) is met for dirty rows by Phase 1 code as-is.

### Wasm attrs and CORE-02 test

- **D-06:** `wasm-bindgen` attributes are confined to
  `crates/bestialitty-core/src/lib.rs` (D-20). All other modules
  (`terminal.rs`, `grid.rs`, `scrollback.rs`, `dirty.rs`, `key.rs`,
  `vt52.rs`) remain wasm-free. `snapshot_grid` and its pack-buffer
  plumbing land in `terminal.rs` as plain Rust; lib.rs wraps it
  with `#[wasm_bindgen]`.
- **D-07:** `tests/core_02_no_browser_deps.rs` must be updated to
  **exempt `lib.rs` by path** from the "no wasm_bindgen / web_sys /
  js_sys" grep. Every other module still fails that test if the token
  appears. `web_sys` / `js_sys` remain forbidden everywhere (lib.rs
  included) — Phase 2 only needs `wasm_bindgen`, not browser DOM
  bindings.
- **D-08:** `wasm-bindgen` is added to `Cargo.toml` as a plain dep
  (not feature-gated). Rationale: Phase 1's
  `dependency_graph_excludes_browser_crates` test must be updated to
  allow `wasm-bindgen` specifically. The same crate still builds for
  `x86_64-unknown-linux-gnu` (native `cargo test`) because
  `#[wasm_bindgen]` is a no-op outside the wasm32 target when not
  reached, and lib.rs's wasm surface stays `cfg`-gated so native
  builds don't try to emit wasm-bindgen glue. (Planner confirms exact
  mechanism during research.)

### Boundary API additions

- **D-09:** Phase 2 extends — does not replace — the Phase 1 boundary
  surface. Every signature locked by `tests/boundary_api_shape.rs`
  stays. Phase 2 adds:
  - `snapshot_grid(&mut self)` — refreshes the pack buffer
  - `grid_ptr(&self) -> *const u8` — pointer into the pack buffer
  - `grid_byte_len(&self) -> usize` — `visible_rows * cols * sizeof(Cell)`
  - `dirty_ptr(&self) -> *const u8` — pointer into the existing
    `Dirty::bytes`
  - Packed `cursor_packed(&self) -> u32` (D-17: `(row << 16) | col`) —
    preserving Phase 1's `cursor() -> (u32, u32)` tuple accessor for
    Rust callers, adding the packed form for the wasm boundary
  - `encode_key_raw(code: u32, mods: u32) -> Vec<u8>` — matches D-17's
    `encode_key` signature; wraps `key::encode` with u32→KeyCode
    unpacking
- **D-10:** `tests/boundary_api_shape.rs` is extended with compile-time
  pins for every new method added by D-09. Any future drift in return
  type, visibility, or signature of a Phase-2-exposed wasm method fails
  this test.

### Harness scope (minimal)

- **D-11:** Harness page has four required affordances:
  1. A textarea where the user pastes raw bytes (paste literal bytes
     where possible; hex-escape syntax like `\xNN` supported for the
     control bytes that keyboards can't type).
  2. A "Feed" button that calls `term.feed(bytes)` **once** with the
     entire textarea contents as a single `Uint8Array`.
  3. A `<pre>` element that renders the current visible grid as ASCII
     by iterating the zero-copy `Uint8Array` view over the pack buffer,
     pulling the raw byte at each `ch` offset.
  4. A "64 KB stress" button that generates 65_536 bytes of plausible
     VT52 input and feeds them in a single `feed()` call, logging
     before/after timestamps so SC-4 can be verified in DevTools:
     one boundary call, not 65_536.
- **D-12:** Harness also renders the dirty-row bitmap (as a 24-byte
  row prefix next to the ASCII grid) and the cursor position + bell
  flag as small status readouts. Not aesthetically polished — Phase 3
  owns that. Purpose is purely to prove the boundary shape end-to-end.

### Project layout & dev serving

- **D-13:** Static site lives under `www/` at the repo root, matching
  ARCHITECTURE.md's recommended structure. `wasm-pack build --target web`
  writes its `pkg/` output into `www/pkg/` so the harness can
  `import init, { Terminal } from './pkg/bestialitty_core.js'` without
  a bundler. `www/pkg/` is gitignored; `www/index.html`, `www/main.js`,
  and any supporting files are tracked. A top-level `scripts/build.sh`
  wraps `wasm-pack build --target web --out-dir ../../www/pkg
  crates/bestialitty-core` for convenience.
- **D-14:** Local dev serving is **not** committed to a specific tool.
  README / harness docs mention two working options: `python3 -m
  http.server -d www` and `basic-http-server www` (Rust, single-binary,
  no Node). Either serves `/index.html` with correct MIME types for
  `.wasm` and `.js`. The author picks per session; the harness works
  identically under both. No Vite, no npm, no bundler runtime.

### Claude's Discretion

- Exact naming of the pack-buffer methods on `Terminal`
  (`snapshot_grid` / `grid_ptr` / `grid_byte_len` is the preferred
  shape but the planner may rename if a clearer convention emerges
  during research — the contract is what matters, not the names).
- How to gate wasm-bindgen glue off for native builds (cfg attribute
  on lib.rs module, `#[cfg(target_arch = "wasm32")]` on individual
  items, or a `wasm` Cargo feature). Decision lands in research /
  plan after a concrete attempt.
- Hex-escape parser for the harness textarea (regex vs hand-rolled
  state machine) — both are fine.
- Exact layout of the 64 KB stress payload (single "print lots of
  ASCII and a few ESC-Y moves" string vs a realistic CP/M-like
  byte mix). As long as it's 64 KB, a single `feed()` call, and
  the terminal state afterwards is inspectable in the harness.
- Whether the harness has "Reset terminal", "Clear dirty", "Resize"
  buttons. Useful for manual exploration but not required by any
  SC; planner picks based on effort budget.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` — architectural split (Rust pure logic + JS
  shell), wasm-bindgen + wasm-pack toolchain decision, Chromium-only
  constraint, static-site deploy, key-decisions table
- `.planning/REQUIREMENTS.md` — CORE-03, CORE-04, CORE-05 are
  in-scope for this phase; check Out-of-Scope for the "no Rust Web
  Serial" constraint that applies boundary-wide
- `.planning/ROADMAP.md` — Phase 2 goal and the four Success Criteria
  that plans must collectively satisfy

### Phase 1 deliverables (load-bearing for Phase 2)

- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md` —
  **D-17 wasm boundary shape** (zero-copy pointers, packed cursor,
  encode_key u32 inputs), **D-18 cold-path `get_grid() -> Vec<u8>`**,
  **D-19 cargo workspace + cdylib+rlib**, **D-20 cross-target reuse +
  wasm attrs confined to lib.rs**
- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-07-PLAN.md` —
  the `<interfaces>` block that Phase 2 must extend without regressing;
  boundary API shape test rationale
- `.planning/decisions/ADR-001-parser-strategy.md` — pins `vte = "=0.15"`;
  Phase 2 MUST NOT bump vte as a side-effect of adding wasm-bindgen

### Phase 1 contract tests Phase 2 must extend without regressing

- `crates/bestialitty-core/tests/boundary_api_shape.rs` — compile-time
  pin of every `pub` method on `Terminal` + `key::encode`; Phase 2
  adds pins for `snapshot_grid`, `grid_ptr`, `grid_byte_len`,
  `dirty_ptr`, `cursor_packed`, `encode_key_raw` without removing any
  existing pin
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` —
  **must be updated** to exempt `lib.rs` from the `wasm_bindgen`
  forbidden-token rule, and to allow `wasm-bindgen` specifically in
  the dependency graph. Every other forbidden token stays forbidden
  everywhere; `web-sys` / `js-sys` / `gloo-*` stay universally
  forbidden (lib.rs included)

### Stack + architecture research

- `.planning/research/ARCHITECTURE.md` — §"The Wasm Boundary Contract"
  (what crosses and how), §"Pattern 2: Zero-Copy Grid View" (stable
  pointer + `Uint8Array` view pattern), §"Recommended Project
  Structure" (`www/` layout, `wasm-pack` output into `www/pkg/`)
- `.planning/research/STACK.md` — Rust / wasm-bindgen / wasm-pack
  toolchain pins; ES-module `--target web` story; author's "do NOT
  use vte wholesale" argument already overruled by ADR-001 and
  therefore informational only at this point
- `.planning/research/PITFALLS.md` — especially Pitfall #4 (boundary
  chattiness — batched feeds, not per-byte calls), Pitfall #10
  (TextDecoder byte corruption — harness must treat input as raw
  bytes, never text-decode)
- `.planning/research/FEATURES.md` — VT52 sequence inventory for
  generating plausible 64 KB stress-test payloads

### External specs

- [wasm-bindgen Guide — `--target web`](https://rustwasm.github.io/wasm-bindgen/examples/without-a-bundler.html)
  — reference for bundler-free ES-module loading
- [wasm-pack `build --target web`](https://rustwasm.github.io/docs/wasm-pack/commands/build.html)
  — output layout and import shape
- [`js-sys` — `Uint8Array::view`](https://docs.rs/js-sys/latest/js_sys/struct.Uint8Array.html)
  — not used from Rust in this phase (D-20), but documents the
  JS-side semantics of `new Uint8Array(wasm.memory.buffer, ptr, len)`
  that Phase 2 relies on

### Decisions this phase may produce

- `.planning/decisions/ADR-002-wasm-gating.md` (provisional title) —
  if the planner lands on a non-obvious choice for how to keep
  wasm-bindgen glue out of native builds (feature flag vs cfg vs
  conditional dep), record the decision and rejected alternatives.
  Not required if the choice is a clean one-liner.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 1 shipped)

- **`crates/bestialitty-core/src/terminal.rs`** — `Terminal` struct with
  `new(rows, cols, scrollback_cap)`, `feed(&[u8]) -> Vec<u8>`,
  `cursor() -> (u32, u32)`, `rows()`, `cols()`, `bell_pending()`,
  `clear_bell()`, `dirty() -> &[u8]`, `clear_dirty()`, `grid() ->
  &Scrollback`, `resize(rows, cols)`, `resize_scrollback(n)`. Phase 2
  extends this struct in-place with `pack_buf`, `snapshot_grid`,
  `grid_ptr`, `grid_byte_len`, `cursor_packed`.
- **`crates/bestialitty-core/src/grid.rs`** — `Cell { ch: u32, fg: u8,
  bg: u8, flags: u8, _pad: u8 }` with `#[repr(C)]` and compile-time
  size+align assertions. Phase 2's zero-copy view relies on this exact
  layout — the 8-byte stride is what JS decodes off the `Uint8Array`.
  Do not modify.
- **`crates/bestialitty-core/src/dirty.rs`** — `Dirty { bytes: Vec<u8> }`
  with `as_slice() -> &[u8]` already contiguous. `dirty_ptr()` is a
  one-liner over this. Do not modify.
- **`crates/bestialitty-core/src/scrollback.rs`** — `Scrollback`
  exposes `row(idx) -> &Row` and `visible_rows() -> usize` which the
  pack loop iterates over. Read-only usage; do not modify.
- **`crates/bestialitty-core/src/key.rs`** — `KeyEvent { code:
  KeyCode, mods: Modifiers }` with `encode(KeyEvent) -> Vec<u8>`.
  `encode_key_raw(code: u32, mods: u32) -> Vec<u8>` in lib.rs unpacks
  the u32s and delegates. Do not modify key.rs itself.
- **`crates/bestialitty-core/src/lib.rs`** — currently 17 lines,
  just the module tree declaration. Phase 2 populates it with the
  wasm-bindgen surface.
- **`crates/bestialitty-core/Cargo.toml`** — `crate-type = ["cdylib",
  "rlib"]` already set (D-19); `vte = "=0.15"` pinned. Phase 2 adds
  `wasm-bindgen` as a dep.
- **`rust-toolchain.toml`** — stable + rustfmt + clippy pinned; wasm32
  target **intentionally omitted** ("Phase 2 adds it" per the existing
  comment in the file). Phase 2's first plan adds the wasm32 target.

### Established Patterns (Phase 1 that Phase 2 must honor)

- **Pure-logic modules + wasm-only lib.rs (D-20).** Phase 2 absolutely
  does not sprinkle `#[wasm_bindgen]` across terminal.rs / grid.rs /
  etc.
- **`repr(C)` POD structs for wasm-boundary types** (Cell is the
  existing example). If any new struct crosses the boundary as a
  view, it follows the same rule.
- **`Vec<u8>` returns for cold-path / rare-output APIs** (feed's
  host reply, encode's output). `encode_key_raw` follows this.
- **Compile-time boundary contract tests** (`boundary_api_shape.rs`).
  Phase 2 extends the file with new pins, does not create a new file.

### Integration Points

- **Phase 3 (canvas renderer)** consumes the scratch pack buffer and
  dirty bitmap via the `Uint8Array` views Phase 2 proves work. The
  `snapshot_grid` → read views → `clear_dirty` cadence is the pattern
  Phase 3 inherits.
- **Phase 4 (keyboard input)** calls `encode_key_raw(code, mods)` with
  u32 inputs packed from DOM KeyboardEvent; Phase 2 establishes the
  packing convention (KeyCode → u32 mapping, Modifiers bit layout).
- **Phase 5 (Web Serial)** calls `feed(bytes)` with the raw
  `Uint8Array` result from `reader.read()`. Phase 2's batched-feed
  demonstration (SC-4, 64 KB single call) is the pattern Phase 5
  inherits.

</code_context>

<specifics>
## Specific Ideas

- ARCHITECTURE.md's "`www/` is the deployable unit" phrasing captures
  exactly what the author wants — one folder you can point GitHub
  Pages at, no bundler step, wasm-pack output written directly into
  it.
- The harness is deliberately not pretty. A textarea, a pre element,
  a couple of buttons, a scrap of status readout. Phase 3 owns
  visual polish. Phase 2's job is purely to prove every bit of the
  boundary works end-to-end.
- "Prove 64 KB in one `feed()` call" (SC-4) should be a literal
  in-browser DevTools demonstration — the harness logs a
  `performance.now()` pair around one `term.feed(bigU8Array)` call,
  and DevTools' Profiler tab shows one `feed` entry, not 65_536.
- Snapshot-then-read ergonomics should feel like the existing
  Rust-side `clear_dirty()` idiom: the renderer owns the per-frame
  cadence, the core provides explicit methods rather than hiding
  side-effects in getters.

</specifics>

<deferred>
## Deferred Ideas

- **Canvas rendering / glyph atlas.** Phase 3. The harness ASCII
  `<pre>` is deliberately a dead-end — its only job is proving the
  view shape works.
- **Native shell using the same core.** D-20 keeps the possibility
  open; Phase 2 does not build it. The fact that `cargo test`
  (native, no wasm) still works after adding wasm-bindgen is the
  in-phase artefact that keeps the possibility alive.
- **Bundle-size measurement.** ADR-001 says Phase 2 owns this; it's
  a single `ls -lh www/pkg/*.wasm` output in the verification step,
  not a design concern.
- **Refactor `Scrollback` to a single contiguous `Vec<Cell>` +
  ring offset.** Considered and rejected in D-01 — the scratch pack
  buffer keeps Phase 1's tested data-layer untouched. Revisit only
  if profiling in Phase 3 shows the per-frame memcpy is a real
  bottleneck (at 80×24×8 bytes = 15 KB at 60 Hz = ≈0.9 MB/s, it
  won't be, but keep the option on the shelf).
- **`set_scrollback` / `scroll_to(offset)` boundary calls** beyond
  what Phase 1 shipped (`resize_scrollback`). Scrollback navigation
  is a Phase 6 concern; Phase 2 only needs what already exists.
- **`TextDecoderStream` on the read path.** Hard no — Phase 5's
  problem, and the answer is already "never". Harness uses raw
  bytes only, never text-decode.
- **Keyboard wiring in the harness.** DOM keydown → `encode_key_raw`
  → write-back to textarea is Phase 4's work. Phase 2 exposes
  `encode_key_raw` and tests its signature via the boundary-shape
  test, but does not wire keyboard to DOM.

</deferred>

---

*Phase: 02-wasm-boundary-minimal-js-harness*
*Context gathered: 2026-04-21*
