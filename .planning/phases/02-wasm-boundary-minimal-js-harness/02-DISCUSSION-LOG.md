# Phase 2: Wasm Boundary & Minimal JS Harness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or
> execution agents. Decisions are captured in 02-CONTEXT.md — this log
> preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 02-wasm-boundary-minimal-js-harness
**Mode:** discuss (interactive)
**Areas discussed:** Grid exposure strategy

---

## Gray Areas Offered (user-selected a subset)

| Area | Selected |
|------|----------|
| Grid exposure strategy | ✓ |
| Wasm feature gating | |
| Harness input + scope | |
| Project layout + dev server | |

Four gray areas were generated from ROADMAP SC-1..SC-4 and from the
tension between Phase 1's `VecDeque<Row>` scrollback layout and Phase
2 SC-3's zero-copy `Uint8Array` requirement. The user selected a
single area (Grid exposure strategy) and deferred the rest to Claude's
Discretion or to planner research.

---

## Grid exposure strategy

### Q1: How should Terminal expose the visible grid to JS as a zero-copy view?

| Option | Description | Selected |
|--------|-------------|----------|
| Scratch pack-on-read buffer | Terminal owns a private `Vec<Cell>` sized `visible_rows*cols`. `grid_ptr()` triggers a memcpy from VecDeque rows into this buffer, returns its stable pointer. One O(rows*cols) copy per frame (~15KB memcpy — well under 1ms). View invalidated only on resize. Minimum disruption to Phase 1 code. | ✓ |
| Per-row pointers | Expose `row_ptr(r) -> *const u8` and `row_byte_len()`. JS makes 24 separate Uint8Array views. Zero copies ever. 24 boundary calls per frame (cheap — register-sized returns). View re-fetch needed on any scrolling mutation since row order inside the deque changes. | |
| Refactor visible grid to contiguous `Vec<Cell>` | Rework Scrollback: split visible (single `Vec<Cell>`, row-major) from history (`VecDeque<Row>`). True zero-copy, but biggest Phase-1 code change; risks breaking 128 existing tests and the `boundary_api_shape.rs` contract. | |
| Defer to Phase 3, use cold-path in Phase 2 | Phase 2 harness uses the already-planned cold-path `get_grid() -> Vec<u8>` (D-18) for its ASCII `<pre>`. Zero-copy pointers land in Phase 3. Means Phase 2 does NOT fully satisfy SC-3 as written. | |

**User's choice:** Scratch pack-on-read buffer (Recommended)
**Notes:** Preserves Phase 1's tested data layer. 15 KB memcpy at 60 Hz = ≈0.9 MB/s, far below any measurable cost budget.

---

### Q2: Where should the scratch pack buffer live?

| Option | Description | Selected |
|--------|-------------|----------|
| In Terminal core (Recommended) | Add a private `pack_buf: Vec<Cell>` field on Terminal. Expose `pub fn grid_snapshot_ptr(&mut self) -> *const u8` on Terminal. Stays pure Rust — no wasm leakage. lib.rs boundary just re-exports. Native cargo test can exercise the pack path directly. | ✓ |
| In a lib.rs wasm wrapper struct | lib.rs defines `#[wasm_bindgen] struct WasmTerminal { inner: Terminal, pack_buf: Vec<Cell> }`. Terminal core stays untouched. Cost: needs public accessors on Terminal to iterate visible rows, native tests can't use the same pack path. | |
| Free function in lib.rs taking `&mut Terminal + &mut [Cell]` | No new struct field anywhere. JS-side holds the buffer pointer, needs wasm-bindgen gymnastics to return a stable pointer for a JS-allocated buffer. | |

**User's choice:** In Terminal core (Recommended)
**Notes:** D-20 ("wasm attrs confined to lib.rs") is a rule about **attributes**, not about where state lives. Stateful buffers that are pure Rust belong in the pure-Rust layer.

---

### Q3: When does the pack (memcpy) run?

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit `snapshot_grid()` call from JS (Recommended) | JS-side renderer calls `term.snapshot_grid()` once per frame before reading the Uint8Array view. Matches the existing `clear_dirty()` ergonomics. Pairs naturally: snapshot → read dirty-row bitmap → read pack buffer → clear_dirty. | ✓ |
| Lazy pack inside `grid_ptr()` getter | `grid_ptr()` packs on every call. JS never sees the cost explicitly. Feels cleaner from the JS side, but hides a memcpy inside a getter — surprising if called multiple times per frame. | |
| Eager pack inside `feed()` after mutations | `feed()` updates the pack buffer incrementally for every dirty row. JS reads the buffer as authoritative at any time. Cost: tangles core mutation paths with the pack buffer. | |

**User's choice:** Explicit `snapshot_grid()` call from JS (Recommended)
**Notes:** Per-frame cadence is the renderer's concern, core provides explicit methods. Matches Phase 1's `clear_dirty()` pattern.

---

### Q4: What's the invalidation contract for the pack-buffer pointer?

| Option | Description | Selected |
|--------|-------------|----------|
| Only resize() invalidates (Recommended) | Pointer stays stable across feed(), scrolling, snapshot_grid() calls, and resize_scrollback() (scrollback_cap affects history only). Only resize(rows, cols) reallocates the pack buffer. Matches D-17 `grid_ptr()` contract verbatim. | ✓ |
| Every mutation potentially invalidates | Treat every feed / snapshot_grid / resize* as potentially invalidating. JS refreshes the Uint8Array view at the start of every frame. More conservative. | |
| Ptr never changes after Terminal::new() — resize pre-allocates | Terminal::new reserves a pack_buf with capacity for some ceiling (e.g. max supported rows * cols). Strictest invariant but forces picking a max-rows/max-cols ceiling now. | |

**User's choice:** Only resize() invalidates (Recommended)
**Notes:** `resize_scrollback` only touches the historical tail — visible-region layout doesn't change, so pack buffer stays valid. Matches D-17 exactly.

---

### Final area gate

| Option | Description | Selected |
|--------|-------------|----------|
| More questions about Grid exposure | Drill into API signatures, 64KB stress test plumbing, interaction with `boundary_api_shape.rs` contract test | |
| I'm ready for context | Three decisions are enough for planner/researcher; leave remaining implementation details as Claude's Discretion | ✓ |

**User's choice:** I'm ready for context

---

## Claude's Discretion

- Exact naming of the pack-buffer methods on Terminal (`snapshot_grid` / `grid_ptr` / `grid_byte_len` is the preferred shape; planner may rename during research).
- How to gate wasm-bindgen glue off for native builds (cfg attribute on lib.rs module, `#[cfg(target_arch = "wasm32")]` on individual items, or a `wasm` Cargo feature).
- Hex-escape parser for the harness textarea (regex vs hand-rolled state machine).
- Exact layout of the 64 KB stress payload.
- Whether the harness has "Reset terminal", "Clear dirty", "Resize" buttons.

## Deferred Ideas (not discussed in depth)

- **Wasm feature gating** — left as Claude's Discretion / planner research.
- **Harness input + scope details** — locked by D-11/D-12 but exact wiring left to planner.
- **Project layout + dev server** — locked by D-13/D-14 (www/ layout per ARCHITECTURE.md, Python or basic-http-server for local serving; no bundler).
- **Key encoder boundary shape** — `encode_key_raw(code: u32, mods: u32) -> Vec<u8>` locked by D-09; exact u32 encoding of KeyCode enum left to planner.
