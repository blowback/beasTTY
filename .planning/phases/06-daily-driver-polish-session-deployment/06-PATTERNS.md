# Phase 6: Daily-Driver Polish, Session & Deployment — Pattern Map

**Mapped:** 2026-04-25
**Files analyzed:** 28 (3 new Rust modules + 2 new Rust test files; 5 new JS modules + 1 new state directory; 6 modified JS modules; 1 modified HTML; 7 new Playwright specs + 1 new mock fixture; 1 modified playwright.config.js; 1 new GitHub Action workflow; 1 LICENSE; 1 `.nojekyll`; 1 `_headers`; 1 `06-SOAK.md`; 1 `06-HUMAN-UAT.md`)
**Analogs found:** 28 / 28 (every file has a strong in-codebase analog or a binding research excerpt)

---

## File Classification

### Rust core

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/bestialitty-core/src/scrollback.rs` (modify — add `row_at_absolute`) | state | CRUD (read accessor) | self — existing `row(visible_idx)` accessor at scrollback.rs:107-112 | exact (self) |
| `crates/bestialitty-core/src/terminal.rs` (modify — add `snapshot_grid_at`, `clear_visible`) | state | transform (snapshot pack into pre-allocated buffer) + CRUD (clear cells) | self — existing `snapshot_grid` (terminal.rs:179-193) + existing `erase_to_end_of_screen` (terminal.rs:309-324) for the cell-mutation pattern | exact (self) |
| `crates/bestialitty-core/src/lib.rs` (modify — façade for `snapshot_grid_at` + `clear_visible`) | config (wasm boundary) | request-response (one-line forwarder) | self — existing one-line forwarders `snapshot_grid` (lib.rs:99-101), `resize_scrollback` (lib.rs:152-154) | exact (self) |
| `crates/bestialitty-core/tests/snapshot_at_offset.rs` (new) | test | request-response (Rust unit assertions) | `crates/bestialitty-core/tests/boundary_api_shape.rs` (Phase 1/2 — pinned-API integration test pattern) | exact role-match |
| `crates/bestialitty-core/tests/clear_visible.rs` (new) | test | request-response | same as above | exact role-match |

### JS — new modules

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `www/renderer/scroll-state.js` (new) | state + observer | event-driven (wheel, keydown) → state machine → observer fan-out | `www/input/paste-pump.js` (module-scope state + `wireX(opts)` injection + observer registry); `www/renderer/canvas.js` `setFocus`/`requestFrame` for state→render coupling | exact role-match |
| `www/input/selection.js` (new) | state + observer | pointer event-driven (down/move/up) | `www/input/paste-pump.js` (observer/state shape); `www/renderer/chrome.js` lines 88-141 (DOM listener pattern + `setPointerCapture` is research-supplied) | role-match (closest event-handler analog) |
| `www/input/clipboard.js` (new) | adapter (thin wrapper) | request-response (async clipboard) | `www/input/paste-pump.js` `enqueuePaste()` consumer + `wireX(opts)` injection pattern | exact role-match |
| `www/transport/session-log.js` (new) | state | streaming (push-by-reference chunks → assemble Blob on demand) | `www/input/tx-sink.js` (module-scope ring + observer pattern, growable buffer) | role-match |
| `www/state/prefs.js` (new — also creates `www/state/` directory) | state + observer (versioned localStorage blob) | CRUD (load/save/reset) + event (subscribe) | `www/transport/serial.js` lines 478-502 (`persistVidPid` / `readStoredPreset` localStorage pattern) for storage I/O; `www/input/paste-pump.js` for observer registry shape | role-match |

### JS — modified modules

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `www/renderer/canvas.js` (modify — branch `tick()` on scroll-state; selection overlay; hide cursor when scrolled) | render | streaming (rAF) | self — existing `tick()` (canvas.js:242-288), `paintCursor()` (canvas.js:185-238), `markAllRowsDirty()` (canvas.js:58-62) | exact (self) |
| `www/renderer/atlas.js` (no change — selection consumes existing API) | render | request-response | self — `getInverted` at atlas.js:50-58 already shipped for Phase 3 cursor inversion; Phase 6 reuses verbatim | exact (self) |
| `www/renderer/chrome.js` (modify — Settings rows + top-bar Clear + visibilitychange already present) | event-handler | event-driven | self — existing `wireChrome` body, especially the keydown branch (chrome.js:88-122) and visibilitychange listener (chrome.js:152-157) | exact (self) |
| `www/input/keyboard.js` (modify — Ctrl+Shift+C / Ctrl+Shift+V / Shift+End/Home/PgUp/PgDn intercepts) | event-handler | event-driven | self — existing keydown listener (keyboard.js:167-195), Esc-while-paste-active gate (keyboard.js:178-182) | exact (self) |
| `www/input/paste-pump.js` (no change — Phase 6 calls existing public API) | adapter | event-driven | self — `enqueuePaste`, `cancelPaste`, `isActive`, `setBaudForPump`, `onProgress` all already shipped | exact (self) |
| `www/transport/serial.js` (modify — read loop appends to session-log; auto-connect path) | transport | streaming | self — read loop at serial.js:332-359 (post-feed invariant), boot-time `getPorts()` at serial.js:142-161 | exact (self) |
| `www/main.js` (modify — boot order reorder, loadPrefs first, wire new modules, auto-connect path) | boot | orchestration | self — existing boot sequence (main.js:49-238) | exact (self) |
| `www/index.html` (modify — DOM additions + CSS rule blocks) | static | static | self — existing top-bar (index.html:405-418), Connection pane (index.html:421-474), Settings pane (index.html:484-504), `#paste-progress-row` (index.html:414-417), CSS for `#settings`/`#connection`/`#top-bar` (index.html:54-336) | exact (self) |

### Tests + fixtures

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `www/tests/session/scrollback.spec.js` (new) | test | event-driven (wheel/keydown synth) | `www/tests/transport/connect.spec.js` setup() helper + `test.fixme` stub pattern (Phase 5 Wave 0) | exact role-match |
| `www/tests/session/selection.spec.js` (new) | test | pointer-event synth | `www/tests/input/keydown-printable.spec.js` setup pattern + Phase 5 mock-serial init-script pattern | role-match |
| `www/tests/session/clipboard.spec.js` (new) | test | clipboard mock + paste-pump assertion | `www/tests/transport/paste.spec.js` (mock writer log + post-paste byte-stream assertion) | exact role-match |
| `www/tests/session/clear-screen.spec.js` (new) | test | grid-readback assertion | `www/tests/render/grid.spec.js` (grid-byte assertions via `__testGridView`) | role-match |
| `www/tests/session/log-download.spec.js` (new) | test | mock-serial chunk push + Blob download capture | `www/tests/transport/readloop.spec.js` (`__mockReaderPush` pattern) | role-match |
| `www/tests/session/prefs.spec.js` (new) | test | localStorage CRUD + reload | `www/tests/transport/connect.spec.js` (localStorage assertions) | role-match |
| `www/tests/session/auto-connect.spec.js` (new) | test | mock-serial getPorts() pre-grant + boot assertion | `www/tests/transport/connect.spec.js` + `www/tests/transport/reconnect.spec.js` | role-match |
| `www/tests/session/clipboard-mock.js` (new fixture) | test fixture | inline IIFE injected via `page.addInitScript` | `www/tests/transport/mock-serial.js` (Phase 5 D-40 — exact `SERIAL_MOCK` shape) | exact role-match |
| `www/playwright.config.js` (modify — add `**/session/*.spec.js` to testMatch) | config | static | self — existing `testMatch` array at playwright.config.js:7 | exact (self) |

### Build / deploy / docs

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `LICENSE` (new) | doc / metadata | static | none in repo — SPDX MIT canonical text from RESEARCH.md "Sources" link | research-supplied (no codebase analog) |
| `.github/workflows/pages.yml` (new) | CI config | YAML pipeline | none in repo — full template provided in RESEARCH.md §Pattern 6 (lines 884-939) | research-supplied |
| `www/_headers` (new) | hosting config | static | none in repo — Cloudflare/Netlify format documented in RESEARCH.md §Sources / §Don't Hand-Roll | research-supplied (best-effort fallback) |
| `www/.nojekyll` (new) | hosting config | static (empty file) | none — RESEARCH.md §Pattern 6 line 924: `touch www/.nojekyll` | research-supplied |
| `www/index.html` `<meta http-equiv="Content-Security-Policy">` (insert into existing `<head>`) | static | static | RESEARCH.md §Code Examples lines 1356-1373 (verbatim CSP meta-tag) | research-supplied |
| `.planning/phases/06-daily-driver-polish-session-deployment/06-SOAK.md` (new) | doc | manual UAT protocol | `.planning/phases/04-keyboard-input/04-VALIDATION.md` (validation document structure) + `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` (front-matter + tests + result format) | role-match |
| `.planning/phases/06-daily-driver-polish-session-deployment/06-HUMAN-UAT.md` (new) | doc | manual UAT checklist | `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` (canonical exact analog) | exact role-match |

---

## Pattern Assignments

### `crates/bestialitty-core/src/scrollback.rs` (state, CRUD)

**Analog:** self — existing `row(visible_idx)` accessor at scrollback.rs:107-112.

**Existing accessor pattern** (scrollback.rs:107-118 — verbatim):

```rust
/// Index into the visible region (0 = topmost visible row).
pub fn row(&self, visible_idx: usize) -> &Row {
    let total = self.rows.len();
    let start = total.saturating_sub(self.visible_rows);
    &self.rows[start + visible_idx]
}

pub fn row_mut(&mut self, visible_idx: usize) -> &mut Row {
    let total = self.rows.len();
    let start = total.saturating_sub(self.visible_rows);
    &mut self.rows[start + visible_idx]
}
```

**Phase 6 addition** — new `row_at_absolute(idx)` accessor that indexes the underlying VecDeque without the visible-window math (RESEARCH §Code Examples lines 1203-1207, called from terminal.rs's new `snapshot_grid_at`). Verbatim shape to add:

```rust
/// Direct VecDeque index (0 = oldest retained row, total_len-1 = newest).
/// Caller (terminal::snapshot_grid_at) is responsible for clamping idx to
/// `< self.rows.len()`.
pub fn row_at_absolute(&self, idx: usize) -> &Row {
    &self.rows[idx]
}
```

**Notable deviation:** The new accessor takes an absolute VecDeque index, NOT a visible-window-relative index. Phase 6's `snapshot_grid_at` does the offset arithmetic in `terminal.rs` (which has the `visible_rows` + `total_len` context).

---

### `crates/bestialitty-core/src/terminal.rs` (state, transform + CRUD)

**Analog:** self — existing `snapshot_grid` (terminal.rs:179-193) + `erase_to_end_of_screen` (terminal.rs:309-324).

**Pack-buffer snapshot pattern** (terminal.rs:179-193 — verbatim, the template for `snapshot_grid_at`):

```rust
pub fn snapshot_grid(&mut self) {
    let cols = self.scrollback.cols();
    let visible_rows = self.scrollback.visible_rows();
    let needed = visible_rows * cols;
    // Resize the pack buffer if the grid size changed since last snapshot.
    // In steady state this is a no-op; only `resize()` changes `needed`.
    if self.pack_buf.len() != needed {
        self.pack_buf.resize(needed, Cell::BLANK);
    }
    for r in 0..visible_rows {
        let src = self.scrollback.row(r).as_slice();
        let dst_start = r * cols;
        self.pack_buf[dst_start..dst_start + cols].copy_from_slice(src);
    }
}
```

**Phase 6 — `snapshot_grid_at(row_offset)`** (RESEARCH §Code Examples lines 1190-1211 — verbatim):

```rust
/// Snapshot the visible_rows-tall window starting `row_offset` rows BACK from
/// the live tail. Out-of-range clamps to total - visible_rows (CONTEXT D-06).
/// Reuses pack_buf — no new memory layout. Pointer remains stable across this
/// call (matches snapshot_grid contract from D-03).
pub fn snapshot_grid_at(&mut self, row_offset: usize) {
    let cols = self.scrollback.cols();
    let visible_rows = self.scrollback.visible_rows();
    let total = self.scrollback.total_len();
    // Live tail viewport starts at total - visible_rows. Offset N moves it
    // back by N rows (capped so we never read before row 0).
    let tail_start = total.saturating_sub(visible_rows);
    let start = tail_start.saturating_sub(row_offset);
    let needed = visible_rows * cols;
    if self.pack_buf.len() != needed {
        self.pack_buf.resize(needed, Cell::BLANK);
    }
    for r in 0..visible_rows {
        let src = self.scrollback.row_at_absolute(start + r).as_slice();
        let dst_start = r * cols;
        self.pack_buf[dst_start..dst_start + cols].copy_from_slice(src);
    }
}
```

**Cell-mutation pattern** (terminal.rs:309-324 — verbatim, template for `clear_visible`):

```rust
pub(crate) fn erase_to_end_of_screen(&mut self) {
    let cols = self.scrollback.cols();
    let visible_rows = self.scrollback.visible_rows();
    let cursor_row = self.cursor_row as usize;
    let cursor_col = self.cursor_col as usize;
    self.scrollback.row_mut(cursor_row).clear_from(cursor_col);
    self.dirty.mark(cursor_row);
    for r in (cursor_row + 1)..visible_rows {
        for c in 0..cols {
            self.scrollback.row_mut(r).as_mut_slice()[c] = Cell::BLANK;
        }
        self.dirty.mark(r);
    }
}
```

**Phase 6 — `clear_visible()`** (RESEARCH §Code Examples lines 1234-1244 — verbatim):

```rust
/// Wipes every visible-region cell to BLANK + marks all rows dirty.
/// Cursor goes home (0,0). Parser state untouched — D-26 explicitly
/// says "remote state machine never sees a fake escape."
pub fn clear_visible(&mut self) {
    let cols = self.scrollback.cols();
    for row in self.scrollback.visible_mut() {
        for cell in row.0.iter_mut() {
            *cell = Cell::BLANK;
        }
    }
    let _ = cols;   // cols only retained for dimensional symmetry; clear is per-cell
    self.dirty.mark_all();
    self.cursor_row = 0;
    self.cursor_col = 0;
}
```

**Notable deviations:**
- `snapshot_grid_at` uses `row_at_absolute` (Phase 6 new scrollback accessor) rather than the visible-window `row(r)` used by `snapshot_grid`.
- `clear_visible` is a `pub` (not `pub(crate)`) method because `lib.rs`'s wasm boundary forwards it; the existing `pub(crate)` parser dispatch methods (e.g. `erase_to_end_of_screen`) are NOT reachable from JS.
- `clear_visible` does NOT touch `parser` state — the existing `Parser` field is untouched by design (D-26).

---

### `crates/bestialitty-core/src/lib.rs` (config, request-response forwarders)

**Analog:** self — existing one-line forwarders for `snapshot_grid` (lib.rs:99-101) and `resize_scrollback` (lib.rs:152-154).

**One-line forwarder pattern** (lib.rs:99-101 + lib.rs:152-154 — verbatim):

```rust
/// Refresh the pack buffer. Call once per frame before reading
/// `grid_ptr()` / `grid_byte_len()` (D-02).
pub fn snapshot_grid(&mut self) {
    self.inner.snapshot_grid();
}

// ...

pub fn resize_scrollback(&mut self, new_cap: usize) {
    self.inner.resize_scrollback(new_cap);
}
```

**Phase 6 additions** (RESEARCH §Code Examples lines 1218-1225 — verbatim, slot inside the existing `#[wasm_bindgen] impl Terminal { … }` block):

```rust
/// Snapshot a scrollback window starting `row_offset` rows back from the live
/// tail. row_offset = 0 → identical to snapshot_grid() (D-06).
pub fn snapshot_grid_at(&mut self, row_offset: u32) {
    self.inner.snapshot_grid_at(row_offset as usize);
}

/// CONTEXT D-26 — direct grid mutation, NOT feeding ESC J. Parser state untouched.
pub fn clear_visible(&mut self) {
    self.inner.clear_visible();
}
```

**Notable deviations:**
- JS-side type for `row_offset` is `u32` (not `usize`) — wasm-bindgen marshals `u32` directly without a host-call thunk. Internal cast to `usize` is free at the wasm32 boundary.
- Both methods slot AFTER the existing `resize_scrollback` (lib.rs:152) to keep grouping consistent (snapshot APIs together, mutation APIs together).

---

### `crates/bestialitty-core/tests/snapshot_at_offset.rs` (test, request-response)

**Analog:** `crates/bestialitty-core/tests/boundary_api_shape.rs` (Phase 1/2 pinned-API integration test).

**Existing pattern** (boundary_api_shape.rs:152-167 — verbatim, template for the new test):

```rust
#[test]
fn terminal_snapshot_and_pointer_methods_have_stable_return_types() {
    // Phase 2 D-10: every new method on crate::terminal::Terminal is pinned.
    // Drift in `&mut self` / `&self` / return type / arg count fails the build.
    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid(); // &mut self, no args, no return

    let _ptr: *const u8 = term.pack_ptr(); // D-09 pack pointer (lib.rs exposes as grid_ptr())
    let _len: usize = term.pack_byte_len(); // D-09 pack byte length
    let _dptr: *const u8 = term.dirty_ptr(); // D-09 dirty bitmap pointer

    assert_eq!(
        _len,
        24 * 80 * 8,
        "pack_byte_len must equal rows * cols * size_of::<Cell>() (size_of = 8 per grid.rs const_assert)"
    );
}
```

**Phase 6 test scaffolding** (multiple #[test] fns in the same file):
1. `snapshot_grid_at_zero_matches_snapshot_grid` — call both, compare `pack_byte_len` + first row bytes.
2. `snapshot_grid_at_clamps_oversized_offset` — push 100 lines, call `snapshot_grid_at(usize::MAX)`, assert no panic + first visible row matches the OLDEST retained row.
3. `snapshot_grid_at_returns_historical_window` — push 50 lines with markers `0..50`, call `snapshot_grid_at(10)`, assert pack_buf rows match the markers `[total-visible-10..total-10]`.
4. `pack_ptr_stable_across_snapshot_grid_at` — D-03 mirror; call `snapshot_grid_at(N)` repeatedly, assert pointer identity.

**Imports header** (boundary_api_shape.rs:21-22):

```rust
use bestialitty_core::terminal::Terminal;
```

**Notable deviation:** This test file lives in `tests/` (integration), not `src/terminal.rs::tests` (unit), so it tests the public surface that wasm-bindgen will see — same discipline as `boundary_api_shape.rs`.

---

### `crates/bestialitty-core/tests/clear_visible.rs` (test, request-response)

**Analog:** same as `snapshot_at_offset.rs` — `boundary_api_shape.rs` shape.

**Required tests** (RESEARCH §Validation Architecture line 1519: `cargo test clear_visible_does_not_invoke_parser`):
1. `clear_visible_wipes_visible_grid` — fill 24×80 with 'X', call `clear_visible`, assert every visible cell is `Cell::BLANK`.
2. `clear_visible_marks_all_rows_dirty` — `term.clear_dirty(); term.clear_visible();` then assert every byte of `term.dirty()` is 1.
3. `clear_visible_homes_cursor` — move cursor to (15, 40) via ESC Y, call `clear_visible`, assert cursor at (0, 0).
4. `clear_visible_does_not_invoke_parser` — feed `\x1B` to put parser in `Esc` state, call `clear_visible`, then feed `J` (which would be `erase_to_end_of_screen`) — assert that the J completes the existing escape (parser state was preserved). This is the load-bearing assertion for D-26's "parser state machine never sees a fake escape."
5. `clear_visible_does_not_touch_scrollback` — push 50 historical lines, call `clear_visible`, assert `term.grid().total_len() == visible_rows + 50` (history retained).

---

### `www/renderer/scroll-state.js` (state + observer, event-driven)

**Primary analog:** `www/input/paste-pump.js` (module-scope state + `wireX(opts)` injection + observer registry).
**Secondary analog:** `www/renderer/canvas.js` lines 79-82 / 290-295 (state-coupled rAF dispatch).

**Module header pattern** (paste-pump.js:1-13 — adapt verbatim):

```js
// BestialiTTY Phase 6 — scrollback offset state machine + wheel/key listener.
//
// Public API: wireScrollState, scrollByLines, snapToBottom, jumpToTop,
// notifyFeed, isScrolledBack, getOffset, onChange.
//
// Sources:
//   - 06-CONTEXT.md D-01..D-15.
//   - 06-RESEARCH.md §Pattern 1 (scroll-state module surface, lines 552-605).
//   - Analog: www/input/paste-pump.js (module-scope state + observer fan-out).
```

**Module-scope state** (paste-pump.js:15-28 — adapt verbatim):

```js
// Pump state.
let gapMs = computeGap(19200);
let queue = new Uint8Array(0);
let cursor = 0;
let timer = null;
const progressObservers = [];

// Injected deps (wirePastePump sets these — enables D-22 local-echo from the pump).
let termRef = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;
```

**Phase 6 scroll-state module-scope** (Phase 6 specific — derived from RESEARCH §Pattern 1 lines 562-595):

```js
// Scroll-state state.
let offset = 0;                           // 0 = live tail; > 0 = N rows back
let trackpadAccumulator = 0;              // fractional deltaY accumulator
let newLinesSinceUserScrolled = 0;        // chip counter
const changeObservers = [];

// Injected deps.
let termRef = null;
let canvasWrapperRef = null;
let indicatorElRef = null;
let requestFrameFn = null;
```

**`wireX(opts)` entry shape** (paste-pump.js:32-38 — adapt verbatim):

```js
export function wirePastePump(opts) {
    const { term, sampleBell, drainHostReply, requestFrame } = opts;
    termRef = term;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
}
```

**Wheel handler** (RESEARCH §Code Examples lines 1252-1268 — verbatim):

```js
canvasWrapper.addEventListener('wheel', (ev) => {
  ev.preventDefault();   // claim — D-12 chrome panes never see it
  let lines;
  if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    // Mouse — Linux & Windows-default deliver line deltas
    lines = (ev.shiftKey ? 24 : 3) * Math.sign(ev.deltaY);
  } else {
    // Trackpad / hi-res mouse — accumulate raw pixels
    trackpadAccumulator += ev.deltaY;
    lines = 0;
    while (Math.abs(trackpadAccumulator) >= 30) {
      lines += 3 * Math.sign(trackpadAccumulator);
      trackpadAccumulator -= 30 * Math.sign(trackpadAccumulator);
    }
  }
  if (lines !== 0) scrollBy(-lines);   // up-wheel = +offset
}, { passive: false });   // we preventDefault; cannot be passive
```

**Observer fan-out** (paste-pump.js:162-164 — adapt verbatim):

```js
function fireProgress(status, extra = {}) {
    for (const fn of progressObservers) fn({ status, ...extra });
}
```

Phase 6 equivalent: `function fireChange() { for (const fn of changeObservers) fn({ offset, isScrolledBack: offset > 0, newLines: newLinesSinceUserScrolled }); }`.

**`[data-scrolled-back]` attribute** mirrors Phase 3 `[data-focused]` (chrome.js:127-134):

```js
terminalWrapper.addEventListener('focus', () => {
    terminalWrapper.setAttribute('data-focused', 'true');
    setFocus(true);
});
```

Phase 6: in scroll-state's offset setter, call `canvasWrapperRef.setAttribute('data-scrolled-back', String(offset > 0))`.

**Notable deviations:**
- Wheel listener uses `{ passive: false }` because we `preventDefault()` (RESEARCH §Pitfall + State of the Art table — Chromium 73+ defaults wheel listeners to passive on document/body but not on element targets; explicit non-passive is documentation-only).
- Trackpad accumulator threshold: **30 px** per CONTEXT D-02 (RESEARCH §Pitfall 2: raise to 50 if real-trackpad UAT shows overscroll).
- Snap-to-bottom triggers (D-04): single `snapToBottom()` exported helper called by chip click, Shift+End, keyboard.js (any TX keypress), paste-pump start, serial.js reconnect, chrome.js Clear-scrollback button.

---

### `www/input/selection.js` (state + observer, pointer event-driven)

**Primary analog:** `www/input/paste-pump.js` (module-scope state shape).
**Secondary analog:** `www/renderer/chrome.js` lines 88-141 (DOM listener registration pattern, focus listener pairing).

**Module-scope state** (Phase 6 specific — derived from RESEARCH §Pattern 2 lines 615-651):

```js
let anchor = null;              // { rowOffsetFromTail, col } — D-17
let focusEnd = null;            // { rowOffsetFromTail, col }
let dragging = false;
let lastClickTs = 0;
let clickCount = 0;             // for double/triple-click — D-16
const selectionObservers = [];

// Injected deps.
let canvasRef = null;
let scrollStateRef = null;
let cellWFn = null;             // returns activeTheme.cellW * activeZoom
let cellHFn = null;
let requestFrameFn = null;
```

**Pointer-down handler with capture** (RESEARCH §Code Examples lines 1276-1283 — verbatim):

```js
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  dragging = true;
  anchor = focus = pxToCellWithScrollOffset(ev);
  notifySelectionChange();
});
```

**Pointer-move with auto-scroll** (RESEARCH §Code Examples lines 1285-1294 — verbatim):

```js
canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  focus = pxToCellWithScrollOffset(ev);
  // D-18 — drag-past-edge auto-scroll
  const r = canvas.getBoundingClientRect();
  if (ev.clientY < r.top) scrollState.scrollByLines(+1);
  else if (ev.clientY > r.bottom && scrollState.isScrolledBack()) scrollState.scrollByLines(-1);
  notifySelectionChange();
  requestFrame();
});
```

**Pointer-up + lostpointercapture** (RESEARCH §Code Examples lines 1296-1305 — verbatim):

```js
canvas.addEventListener('pointerup', (ev) => {
  dragging = false;
});

canvas.addEventListener('lostpointercapture', () => {
  dragging = false;
  // selection persists; D-19 will clear it on focus loss
});
```

**Esc-cancel pattern** mirrors keyboard.js's existing Esc-while-paste-active gate (keyboard.js:178-182 — verbatim shape):

```js
// Phase 5 D-18 — Esc while paste pump is active cancels the paste AND
// suppresses 0x1B. When pump is idle, Esc encodes normally (Phase 4
// behaviour unchanged).
if (e.code === 'Escape' && pastePumpIsActive()) {
    e.preventDefault();
    cancelPaste();
    return;
}
```

Phase 6 selection equivalent (in keyboard.js's keydown handler, BEFORE the existing Esc-paste gate so paste cancel still wins when both are active OR after — planner picks):

```js
// Esc cancels in-flight selection drag (D-19).
if (e.code === 'Escape' && selection.isDragging()) {
    e.preventDefault();
    selection.cancelDrag();
    return;
}
```

**Selection-clear-on-X observers** (D-19): selection module subscribes to scroll-state changes (post-drag), theme/phosphor/zoom changes (via canvas.js — needs new export?), and focus loss on `#terminal-wrapper`. Subscription registration mirrors `paste-pump.js`'s `onProgress` shape.

**Notable deviations:**
- Coordinate system: `(rowOffsetFromTail, col)` — RESEARCH Pitfall 4 + 7 explicitly mandate scrollback-tail-relative storage so the anchor stays valid when scrollback grows mid-drag.
- `pxToCellWithScrollOffset` is a NEW shared helper (RESEARCH §Don't Hand-Roll table — "shared `pxToCell(clientX, clientY)` helper that uses canvas's `cellW`/`cellH`"). The cleanest landing spot: export from `canvas.js` so both `selection.js` and `scroll-state.js` consume it. This is research recommendation #2 (RESEARCH §Open Questions Q2).
- Word-boundary regex for double-click: `/\S+/` (CONTEXT §Claude's Discretion + RESEARCH §Pattern 2 commentary) — matches the obvious "non-whitespace run" definition.

---

### `www/input/clipboard.js` (adapter, request-response)

**Primary analog:** `www/input/paste-pump.js` `enqueuePaste` consumer + Phase 5 `wireX(opts)` injection.

**Module imports** (mirror keyboard.js:21-23 + paste-pump.js:11-12):

```js
import { enqueuePaste } from './paste-pump.js';
import { getCrlfMode, CRLF_MODES } from './keyboard.js';
import { getSelection, clearSelection } from './selection.js';
```

**copySelection** (RESEARCH §Pattern 3 lines 674-686 — verbatim):

```js
// D-21 / D-23 — Copy
export async function copySelection() {
  const sel = getSelection();   // returns null OR { rows: string[] } — already trimmed per line
  if (!sel || sel.rows.length === 0) return;   // empty-selection no-op (no clipboard write)
  const text = sel.rows.join('\n');             // \n line endings; no trailing \n on single line
  try {
    await navigator.clipboard.writeText(text);
    // D-19 — successful copy clears selection
    clearSelection();
  } catch (err) {
    // Permissions-Policy may block; rare in same-origin static site context
    console.warn('[clipboard] copy failed:', err);
  }
}
```

**pasteFromClipboard** (RESEARCH §Pattern 3 lines 688-716 — verbatim):

```js
// D-22 / D-24 — Paste
export async function pasteFromClipboard() {
  let text;
  try {
    text = await navigator.clipboard.readText();   // keydown counts as transient activation
  } catch (err) {
    console.warn('[clipboard] read failed:', err);
    return;
  }
  // D-24 — encode as bytes (ASCII; high-bit kept as-is, user's responsibility)
  let bytes = new Uint8Array(text.length);
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Strip 0x00-0x1F except CR (0x0D), LF (0x0A), Tab (0x09)
    if (c < 0x20 && c !== 0x0D && c !== 0x0A && c !== 0x09) continue;
    if (c > 0xFF) continue;   // Outside Latin-1; drop
    bytes[w++] = c;
  }
  bytes = bytes.subarray(0, w);
  // D-25 — large-paste confirm chip
  if (bytes.length >= 4096) {
    const ok = await showLargePasteConfirm(bytes.length);
    if (!ok) return;
  }
  // CR/LF rewrite happens INSIDE paste-pump.enqueuePaste (Phase 5 D-23) —
  // do NOT double-rewrite here.
  enqueuePaste(bytes);
}
```

**Large-paste confirm UI** — research-supplied; uses the existing Phase 5 `#paste-progress-row` + new `#paste-confirm` button (UI-SPEC line 488-504). The `showLargePasteConfirm(byteCount)` helper returns a Promise that resolves on Cancel-or-Paste click. Locked copy: `About to paste 100,234 B (~52 s at 19200 baud). [Cancel] [Paste]` (CONTEXT D-25 — exact format).

**Notable deviations:**
- High-bit drop (`c > 0xFF`): RESEARCH says "high-bit kept as-is, user's responsibility" (verbatim from D-24), but the verified excerpt drops `c > 0xFF` (i.e. above Latin-1) — this is correct. Latin-1 is preserved; UTF-16 high-surrogate handling is out of scope for VT52.
- CRLF rewrite is NOT done in `clipboard.js` — `paste-pump.js` already does it inside `enqueuePaste` (paste-pump.js:42-43, the `applyCrlfRewrite(bytes)` call). Double-rewriting would corrupt byte streams that already include literal CRs.

---

### `www/transport/session-log.js` (state, streaming)

**Primary analog:** `www/input/tx-sink.js` (module-scope ring + observer pattern, growable buffer).

**Module-scope state** (RESEARCH §Pattern 4 lines 734-737 — verbatim):

```js
let chunks = [];
let totalBytes = 0;
let connectStartIso = null;
```

Compare to `tx-sink.js:16-21` (analog):

```js
const RING_CAP = 1024;
const ring = new Uint8Array(RING_CAP);
let writeIdx = 0;
let wrapped = false;
const observers = [];
```

**reset / append / download** (RESEARCH §Pattern 4 lines 739-775 — verbatim):

```js
// D-29 — reset on each Connect
export function reset() {
  chunks = [];
  totalBytes = 0;
  connectStartIso = new Date().toISOString();
}

// D-30 — append by reference; no copy
export function append(uint8) {
  chunks.push(uint8);
  totalBytes += uint8.byteLength;
}

// D-31 — synthetic anchor click
export function download() {
  if (totalBytes === 0) return;
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromConnectStart(connectStartIso);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation so the download has time to start (browser-specific)
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function filenameFromConnectStart(iso) {
  // D-31 — bestialitty-{YYYYMMDD-HHMMSS}.bin (UTC stamp from connect time)
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}` +
                `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `bestialitty-${stamp}.bin`;
}
```

**Wiring point** (serial.js read loop at serial.js:332-359 — POST-feed invariant; Phase 6 adds ONE line):

```js
// Existing read loop body (serial.js:339-345 — verbatim):
const { value, done } = await reader.read();
if (done) break;
term.feed(value);                        // Phase 2 feed_silent; raw Uint8Array
sampleBellFn();                          // Phase 3 post-feed invariant
drainHostReplyFn('serial');              // Phase 2 host-reply accessor drain
requestFrameFn();                        // Phase 3 dirty-repaint wake
sessionLog.append(value);                // PHASE 6 ADDITION (D-30) — push by reference
```

**Notable deviations:**
- Filename uses **UTC** time per CONTEXT D-31 + RESEARCH §Open Questions Q4: `bestialitty-20260425-143052.bin`.
- `URL.revokeObjectURL` deferred 5 seconds (RESEARCH §Pattern 4 commentary — "some browsers stall the download if revoked too soon"). Chromium handles correctly but the 5s delay is hygiene defense.
- No cap, no rotation in v1 (CONTEXT D-30 + RESEARCH §Pattern 4 memory note: "24-h session at MicroBeast cadence ≈ 5 MB raw — trivial").

---

### `www/state/prefs.js` (state + observer, CRUD + event)

**Primary analog:** `www/transport/serial.js` lines 478-502 (`persistVidPid` / `readStoredPreset` localStorage I/O pattern).

**Existing localStorage I/O pattern** (serial.js:478-502 — verbatim, the template for prefs.js's load/save):

```js
function persistVidPid(p) {
    try {
        const info = p.getInfo();
        if (typeof info.usbVendorId === 'number' && typeof info.usbProductId === 'number') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                usbVendorId: info.usbVendorId,
                usbProductId: info.usbProductId,
            }));
        }
    } catch (err) {
        console.warn('[serial] persistVidPid failed:', err);
    }
}

function readStoredPreset() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.usbVendorId === 'number' && typeof parsed.usbProductId === 'number') {
            return parsed;
        }
        return null;
    } catch { return null; }
}
```

**Phase 6 module body** (RESEARCH §Pattern 5 lines 798-874 — verbatim — adopt as-is):

```js
const STORAGE_KEY = 'bestialitty.prefs';
const CURRENT_VERSION = 1;

const DEFAULTS = Object.freeze({
  version: CURRENT_VERSION,
  theme: 'crt', phosphor: 'green', fontZoom: 1,
  serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
  localEcho: false, crlfMode: 'cr', autoConnect: false,
});

let cached = null;
let saveTimer = null;
const subscribers = [];

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { cached = structuredClone(DEFAULTS); return cached; }
    let parsed = JSON.parse(raw);
    if (typeof parsed.version !== 'number' || parsed.version > CURRENT_VERSION) {
      parsed = structuredClone(DEFAULTS);
    } else if (parsed.version < CURRENT_VERSION) {
      parsed = { ...DEFAULTS, ...parsed, version: CURRENT_VERSION };
    }
    cached = { ...DEFAULTS, ...parsed, serial: { ...DEFAULTS.serial, ...(parsed.serial || {}) } };
    return cached;
  } catch (err) {
    console.warn('[prefs] load failed; falling back to defaults', err);
    cached = structuredClone(DEFAULTS);
    return cached;
  }
}

export function savePrefs(partial) {
  cached = { ...cached, ...partial };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPrefs, 250);   // D-33 debounce
}

function flushPrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      console.warn('[prefs] quota exceeded; cannot persist');
    }
  }
  saveTimer = null;
  for (const fn of subscribers) fn(cached);
}

window.addEventListener('beforeunload', () => {
  if (saveTimer) { clearTimeout(saveTimer); flushPrefs(); }
});

export function resetPrefs() {
  cached = structuredClone(DEFAULTS);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const fn of subscribers) fn(cached);
}

export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i >= 0) subscribers.splice(i, 1);
  };
}
```

**Notable deviations:**
- `STORAGE_KEY = 'bestialitty.prefs'` — DISTINCT from Phase 5's `'bestialitty.port.preset'` (CONTEXT D-32 + RESEARCH §Pattern 5 closing note: identity vs config separation).
- Debounce window: **250 ms** per CONTEXT D-33 (NOT a tunable; locked).
- `beforeunload` flush is INDEPENDENT of Phase 5's `beforeunload` (serial.js:122-140) — both listeners fire; no ordering dependency.
- Quota error swallowed silently (RESEARCH §Pitfall 5: SecurityError in incognito = same path).

---

### `www/renderer/canvas.js` (modify — branch tick on scroll-state; selection overlay; cursor hide)

**Analog:** self — existing `tick()` (canvas.js:242-288), `paintCursor()` (canvas.js:185-238), `markAllRowsDirty()` (canvas.js:58-62).

**Existing `tick()` body** (canvas.js:242-288 — verbatim, the integration point):

```js
function tick() {
    rafPending = false;
    frameCount++;

    // SNAPSHOT FIRST — term.snapshot_grid() may call wasm memory.grow on its
    // first invocation (or any time scrollback grows), which detaches any
    // Uint8Array view backed by the old wasm.memory.buffer. Deriving views
    // BEFORE the snapshot would leave gridView / dirtyView detached for this
    // frame (Chromium throws TypeError, rAF dies silently) — WR-01 in 03-REVIEW.
    term.snapshot_grid();

    // Re-derive if the snapshot's memory.grow swapped the backing buffer.
    reDeriveViews();

    // Defensive: if grid_byte_len has changed (first-snapshot path: 0 → 15360,
    // or any future wasm-side resize), fully rebuild views.
    if (gridView.byteLength !== term.grid_byte_len()) {
        rebuildViews();
    }

    // Dirty-row repaint.
    const rows = term.rows();
    const cols = term.cols();
    for (let r = 0; r < rows; r++) {
        if (dirtyView[r] !== 0) paintRow(r, cols);
    }
    term.clear_dirty();

    // Cursor as overdraw (always — cheap at 80×24; uses atlas.getInverted so
    // steady-state allocation is zero after the first cursor frame).
    paintCursor();
    // ...
}
```

**Phase 6 branch** (per CONTEXT D-07 / D-08 / D-09 / D-13 + RESEARCH architecture diagram lines 391-403):

```js
function tick() {
    rafPending = false;
    frameCount++;

    // PHASE 6 BRANCH (D-07): if scrolled back, snapshot the windowed view.
    if (scrollState.isScrolledBack()) {
        term.snapshot_grid_at(scrollState.getOffset());
    } else {
        term.snapshot_grid();
    }
    reDeriveViews();
    if (gridView.byteLength !== term.grid_byte_len()) rebuildViews();

    // PHASE 6 (D-08): paint-once-then-idle while scrolled back. Skip dirty-row
    // pipeline and paint all 24 rows ONCE on scroll-state change. Subsequent
    // ticks while scrolled back paint nothing (rows are immutable history).
    const rows = term.rows();
    const cols = term.cols();
    if (scrollState.isScrolledBack()) {
        if (scrollState.consumeNeedsRepaint()) {
            for (let r = 0; r < rows; r++) paintRow(r, cols);
        }
        // Selection overlay (D-20) — paint inverted glyphs over selected cells.
        paintSelectionOverlay();
        // (D-09) — skip cursor paint when scrolled back.
        return;   // do NOT clear_dirty — live grid still accumulating
    }

    // Phase 3 path — unchanged.
    for (let r = 0; r < rows; r++) {
        if (dirtyView[r] !== 0) paintRow(r, cols);
    }
    term.clear_dirty();
    paintSelectionOverlay();   // Selection works at live tail too (D-17 — across boundary).
    paintCursor();
    // ... rest of existing tick() body unchanged.
}
```

**`markAllRowsDirty()` reuse** (canvas.js:58-62 — verbatim, called by `setTheme` / `setPhosphor` / `zoomStep` per CONTEXT D-13):

```js
function markAllRowsDirty() {
    if (!dirtyView) return;
    const rows = dirtyView.length;
    for (let r = 0; r < rows; r++) dirtyView[r] = 1;
}
```

Phase 6: scroll-state subscribes to theme/phosphor/zoom changes via canvas.js's existing setters (already calls `markAllRowsDirty()` inside each setter). When scrolled back, the chrome.js / canvas.js setter additionally calls `scrollState.requestRepaint()` so the next tick re-paints all 24 rows under the new style (CONTEXT D-13).

**`paintSelectionOverlay()` — NEW exported helper** (RESEARCH §Open Questions Q2 RECOMMENDATION):

```js
// Phase 6 — paints inverted-glyph cells for the active selection range.
// Selection module computes the (rowOffset, col) range; canvas converts to
// visible-row at paint time using the current scroll offset.
export function paintSelectionOverlay() {
    const range = selection.getActiveRange();   // null if no selection
    if (!range) return;
    const z = activeZoom;
    const cellW = activeTheme.cellW * z;
    const cellH = activeTheme.cellH * z;
    const invRast = makeInvRasteriserForTheme(activeTheme);
    for (const { row, col, ch } of range.cells()) {
        // Same call shape as paintCursor's inverted overdraw (canvas.js:235-237):
        const tile = atlas.getInverted(ch, /*fg=*/1, invRast, z);
        ctx.drawImage(tile, col * cellW, row * cellH, cellW, cellH);
    }
}
```

**Notable deviations:**
- D-09 cursor-hide: simple `return` before `paintCursor()` when `scrollState.isScrolledBack()`. The Phase 3 blink state (`blinkStartMs`) is not destroyed; it just stops being read. Re-shows on snap-to-bottom because the next `tick()` falls through to the Phase 3 path.
- D-08 paint-once: `scrollState.consumeNeedsRepaint()` returns true exactly once per scroll-state change; subsequent calls return false. This is the "paint 24 rows ONCE then idle" guard.
- The `return` in the scrolled-back branch INTENTIONALLY skips `term.clear_dirty()` — the live grid keeps accumulating dirty rows that will be flushed when the user snaps back to live tail (so the grid is consistent at that moment).

---

### `www/renderer/atlas.js` (no change)

**Analog:** self — `getInverted` at atlas.js:50-58 (Phase 3 cursor inversion, reused for Phase 6 selection per CONTEXT D-20).

**Existing `getInverted` API** (atlas.js:50-58 — verbatim, the function selection.js / canvas.js consume):

```js
getInverted(ch, fg, invRasteriser, zoom) {
    const key = (ch << 24) | ((fg & 0xFF) << 16) | ((this.nonce & 0xFF) << 8) | (zoom & 0xFF);
    let tile = this.invCache.get(key);
    if (!tile) {
        tile = invRasteriser(ch, fg);
        this.invCache.set(key, tile);
    }
    return tile;
}
```

**Phase 6 contract:** Phase 6 imposes ZERO changes on atlas.js. The selection overlay calls the existing `getInverted` once per selected cell. invCache (atlas.js:29) shares nonce with the primary cache (atlas.js:30), so atlas.evict() flushes both together (theme/phosphor/zoom change wipes selection tiles automatically — CONTEXT D-19 selection-clear-on-toggle is enforced upstream by selection.js, but the cached tiles are also flushed cleanly).

---

### `www/renderer/chrome.js` (modify — Settings rows + top-bar Clear + visibilitychange)

**Analog:** self — existing `wireChrome` body, especially the click handler block (chrome.js:60-72) and visibilitychange listener (chrome.js:152-157).

**Existing button click pattern** (chrome.js:60-72 — verbatim, template for new buttons):

```js
themeButton.addEventListener('click', () => {
    toggleTheme(ctx);
});
themeButton.addEventListener('mousedown', (e) => {
    e.preventDefault();
});
```

**Phase 6 — top-bar Clear button** (D-26 + UI-SPEC §Top-bar Clear button copy):

```js
clearButton.addEventListener('click', (e) => {
    term.clear_visible();                       // D-26 — direct Rust API; NOT \x1B\x4A
    if (e.shiftKey) term.resize_scrollback(0);  // Shift+click also clears scrollback
    if (e.shiftKey) term.resize_scrollback(10000);
    scrollState.snapToBottom();                 // D-04 trigger
    requestFrame();
});
clearButton.addEventListener('mousedown', (e) => e.preventDefault());
```

**Phase 6 — Settings 'Clear scrollback' button** (D-15):

```js
clearScrollbackButton.addEventListener('click', () => {
    term.resize_scrollback(0);
    term.resize_scrollback(10000);
    scrollState.snapToBottom();   // D-04 trigger
    requestFrame();
});
clearScrollbackButton.addEventListener('mousedown', (e) => e.preventDefault());
```

**Phase 6 — Auto connect checkbox** (D-34):

```js
autoConnectCheckbox.addEventListener('change', (e) => {
    savePrefs({ autoConnect: e.target.checked });
});
autoConnectCheckbox.addEventListener('mousedown', (e) => e.preventDefault());
```

**Phase 6 — Reset prefs button (2-click confirm)** (D-35 + UI-SPEC §Reset all preferences):

```js
let resetPrefsConfirmTimer = null;
resetPrefsButton.addEventListener('click', () => {
    if (resetPrefsConfirmTimer === null) {
        // First click — arm 3-second confirm.
        resetPrefsButton.textContent = 'Click again to confirm (3 s)';
        resetPrefsConfirmTimer = setTimeout(() => {
            resetPrefsButton.textContent = 'Reset all preferences';
            resetPrefsConfirmTimer = null;
        }, 3000);
    } else {
        // Second click within 3 s — commit.
        clearTimeout(resetPrefsConfirmTimer);
        resetPrefsConfirmTimer = null;
        resetPrefs();
        // Re-apply defaults in-place (D-35 — no page reload).
        // applyPrefs(loadPrefs()) — wired via prefs.subscribe() in main.js.
        resetPrefsButton.textContent = 'Reset all preferences';
    }
});
resetPrefsButton.addEventListener('mousedown', (e) => e.preventDefault());
```

**Existing visibilitychange listener** (chrome.js:152-157 — verbatim, Phase 6 may extend to flush prefs on hide):

```js
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.title.startsWith('(!) ')) {
        document.title = document.title.slice(4);
    }
    if (!document.hidden && requestFrame) requestFrame();
});
```

Phase 6 prefs.js handles its own beforeunload flush; no extension needed here.

**Notable deviations:**
- `mousedown preventDefault` is REQUIRED on every new chrome control per Phase 4 D-16 + Phase 5 D-39 focus retention pattern. Skipping it breaks the "after click, terminal is still focused" UX.
- Reset confirm timer: **3 seconds** per CONTEXT D-35 (NOT a tunable; locked). RESEARCH §Pitfall 10 documents the "user tabs away, button reverts" failure mode — accept it (CSS animation could later highlight countdown but is "Claude's Discretion").

---

### `www/input/keyboard.js` (modify — Ctrl+Shift+C / Ctrl+Shift+V / Shift+End/Home/PgUp/PgDn intercepts)

**Analog:** self — existing keydown listener (keyboard.js:167-195) + Esc-while-paste-active gate (keyboard.js:178-182).

**Existing keydown body** (keyboard.js:167-195 — verbatim, the integration point):

```js
terminalWrapper.addEventListener('keydown', (e) => {
    // D-01 — skip chords already handled by chrome.js (e.g. Ctrl+Alt+T).
    if (e.defaultPrevented) return;

    // D-06 belt-and-braces — ignore during composition.
    if (isComposing || e.isComposing) return;

    // Phase 5 D-18 — Esc while paste pump is active cancels the paste AND
    // suppresses 0x1B. When pump is idle, Esc encodes normally (Phase 4
    // behaviour unchanged).
    if (e.code === 'Escape' && pastePumpIsActive()) {
        e.preventDefault();
        cancelPaste();
        return;
    }

    const code = packKeyCode(e);
    if (code < 0) return;                        // D-17 silent drop, NO preventDefault.

    const mods = packModifiers(e);
    e.preventDefault();                          // D-02 — SYNCHRONOUS first.

    const bytes = encode_key_raw(code, mods);
    if (bytes.length === 0) return;

    const wasEnter = (code === KEY_TAG.Enter) || (code === KEY_TAG.KeypadEnter);
    forwardBytes(bytes, wasEnter);
});
```

**Phase 6 inserts** (BEFORE the `packKeyCode(e)` line, AFTER the Esc-paste gate):

```js
// Phase 6 D-21 — Ctrl+Shift+C copies. Ctrl+C (no Shift) still encodes 0x03.
if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyC') {
    e.preventDefault();
    copySelection();   // imported from './clipboard.js'
    return;
}

// Phase 6 D-22 — Ctrl+Shift+V pastes. Ctrl+V (no Shift) still encodes 0x16.
if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyV') {
    e.preventDefault();
    pasteFromClipboard();   // imported from './clipboard.js'
    return;
}

// Phase 6 D-01 / D-05 — Shift+PgUp / Shift+PgDn / Shift+End / Shift+Home scroll.
// Plain PgUp/PgDn/End/Home pass through (silent drop per Phase 4 D-17).
if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.code === 'PageUp')   { e.preventDefault(); scrollState.scrollByPage(+1); return; }
    if (e.code === 'PageDown') { e.preventDefault(); scrollState.scrollByPage(-1); return; }
    if (e.code === 'End')      { e.preventDefault(); scrollState.snapToBottom();   return; }
    if (e.code === 'Home')     { e.preventDefault(); scrollState.jumpToTop();      return; }
}

// Phase 6 D-04 — any TX keypress while scrolled back snaps to live tail.
// Gate runs BEFORE the encode path so the snap is synchronous with the byte.
if (scrollState.isScrolledBack()) {
    scrollState.snapToBottom();
}
```

**Phase 6 import additions** (add to keyboard.js's existing imports at lines 21-23):

```js
import { copySelection, pasteFromClipboard } from './clipboard.js';
import * as scrollState from '../renderer/scroll-state.js';
```

**Notable deviations:**
- The intercepts go BEFORE `packKeyCode(e)` so they fire synchronously without consuming the encoder path. The plain Ctrl+C / Ctrl+V paths (no Shift) are NOT touched — they continue through `packKeyCode` → `encode_key_raw` → `forwardBytes` exactly as Phase 4 shipped, producing 0x03 and 0x16 respectively (CONTEXT D-21/D-22 sacred).
- Plain `End`, `Home`, `PageUp`, `PageDown` continue to silent-drop per Phase 4 D-17 (`packKeyCode` returns -1 for those; the existing `if (code < 0) return;` line is the silent-drop gate). No behavior change.
- The "snap on TX keypress" check goes AFTER the intercepts but BEFORE the encode path — keypresses that ARE TX (printable chars, Enter, arrows) snap; intercepted Shift+PgUp/Shift+End/Ctrl+Shift+C don't (they `return` first).

---

### `www/transport/serial.js` (modify — read loop appends to session-log; auto-connect path)

**Analog:** self — read loop at serial.js:332-359 (post-feed invariant) + boot-time getPorts() at serial.js:142-161.

**Read-loop modification** (one new line after `requestFrameFn()`):

```js
// Existing serial.js:339-345 — Phase 6 adds ONE line.
const { value, done } = await reader.read();
if (done) break;
term.feed(value);
sampleBellFn();
drainHostReplyFn('serial');
requestFrameFn();
sessionLogRef.append(value);   // PHASE 6 (D-30) — push by reference, no copy
```

**`sessionLogRef` is injected via `wireSerial({ sessionLog })`** — extends the existing `wireSerial(opts)` destructure at serial.js:78-93.

**Phase 5 boot-time getPorts pattern** (serial.js:142-161 — verbatim, the template for Phase 6 auto-connect):

```js
const stored = readStoredPreset();
try {
    const ports = await navigator.serial.getPorts();
    const match = ports.find((p) => {
        const i = p.getInfo();
        const vid = stored ? stored.usbVendorId : VID_MICROBEAST;
        const pid = stored ? stored.usbProductId : PID_MICROBEAST;
        return i.usbVendorId === vid && i.usbProductId === pid;
    });
    if (match) {
        lastPortRef = match;
        if (portStatusEl) {
            portStatusEl.textContent = 'MicroBeast (CP2102N 10c4:ea60) — click Connect';
        }
    }
} catch (err) {
    console.warn('[serial] getPorts restore skipped:', err);
}
```

**Phase 6 auto-connect addition** — inside `wireSerial`, AFTER the existing block above, BEFORE `connectButton.addEventListener('click', ...)`:

```js
// Phase 6 D-34 — auto-connect if pref enabled AND a port matches.
// RESEARCH §Pitfall 3 — gate on `state === 'disconnected'` to avoid race.
if (prefsRef && prefsRef.autoConnect && lastPortRef && state === 'disconnected') {
    // Silent open — same path as connectMicroBeast() but skips requestPort().
    try {
        await lastPortRef.open(lastConfig || PRESET_CONFIG);
        await lastPortRef.setSignals({ dataTerminalReady: false, requestToSend: false });
        writer = lastPortRef.writable.getWriter();
        registerWriter(writer);
        port = lastPortRef;
        sessionLogRef.reset();    // Phase 6 D-29 — new buffer per Connect
        setState('connected');
        updatePortStatusConnected();
        runReadLoop(lastPortRef);
    } catch (err) {
        // RESEARCH §Pitfall 3 fall-back — log + standard "click Connect" path.
        appendErrorLog('auto-connect-failed', `Auto-connect failed: ${err.message}`);
        setState('disconnected');
    }
}
```

**`sessionLog.reset()` call site additions:**
- Inside `connectMicroBeast` after successful `selectedPort.open(config)` — D-29 "new buffer on each successful port.open()."
- Inside `finishReconnect` (serial.js:582-590) — same rationale.

**Notable deviations:**
- Auto-connect path is INSIDE `wireSerial` (boot-time) rather than separately wired, because the `lastPortRef` discovery is already there (Phase 5 D-05 path).
- `prefsRef.autoConnect` defaults to `false` (CONTEXT D-34 + D-36) — first-open is a no-op for auto-connect.
- `sessionLogRef.reset()` is called BEFORE `setState('connected')` so the connect-time UTC stamp is captured before any byte arrives (D-31 filename uses connect-time stamp).

---

### `www/main.js` (modify — boot order reorder, loadPrefs first, wire new modules)

**Analog:** self — existing boot sequence (main.js:49-238).

**Existing boot order** (main.js:49-238 — verbatim summary):

```js
// 1. Polite-fail check (Phase 5 — main.js:18-22 — UNCHANGED).
// 2. wasm init() + new Terminal(...) — main.js:50-51.
// 3. await bootRenderer({ wasm, term }) — main.js:54.
// 4. wireChrome(...) — main.js:85.
// 5. wireKeyboard(...) — main.js:202-208.
// 6. wirePastePump(...) — main.js:213.
// 7. await wireSerial(...) — main.js:219-238.
// 8. ... Settings observers (TX, local-echo, CR/LF radio) — main.js:241-297.
// 9. Paste-progress observer — main.js:308-343.
```

**Phase 6 boot order** (RESEARCH §Architecture diagram lines 460-473 — verbatim):

```js
// 1. polite-fail check (Phase 5 — UNCHANGED)
// 2. loadPrefs()                                     ← NEW Phase 6
// 3. wasm init() + new Terminal(...) — UNCHANGED
// 4. await bootRenderer({ wasm, term }) — UNCHANGED
// 5. wireChrome({ prefs, ... })                       ← extended with prefs
// 6. wireKeyboard({ prefs, ... })                     ← extended with prefs
// 7. wireScrollState({ term, canvasWrapper, prefs })  ← NEW Phase 6
// 8. wireSelection({ canvas, scrollState, ... })      ← NEW Phase 6
// 9. wireSessionLog()                                 ← NEW Phase 6
// 10. await wireSerial({ term, prefs, sessionLog })   ← extended with sessionLog + prefs
// 11. wirePrefs({ savePrefs })                        ← NEW: installs subscribers
// 12. if prefs.autoConnect: handled inside wireSerial above (Pitfall 3 gate).
```

**`prefs.subscribe(applyPrefs)` wiring** (RESEARCH §Pattern 5 + §Established Patterns "One observer registered at boot in main.js"):

```js
// Phase 6 — install pref subscribers ONCE at boot. Mirrors main.js:283-286
// (registerTxObserver one-shot pattern).
prefs.subscribe((p) => {
    setTheme(p.theme);
    setPhosphor(p.phosphor);
    setZoom(p.fontZoom);
    setLocalEcho(p.localEcho);
    setCrlfMode(p.crlfMode);
    // serial config: applied on next Connect, NOT live (matches Phase 5 D-08
    // reconnect-required hint for live config changes).
});
// Apply once at boot so initial chrome state matches loaded prefs.
prefs.subscribe(applyOnceAtBoot);
```

**Notable deviations:**
- `loadPrefs()` MUST run BEFORE `wireChrome` (which currently sets defaults from `themes.js` `DEFAULT_THEME_NAME`). Phase 6 reads `prefs.theme` and passes to `wireChrome({ initialTheme: prefs.theme, ... })` — minor `wireChrome` extension.
- `wirePastePump` (existing main.js:213) stays where it is — Phase 6 doesn't change it.
- The order `wireScrollState → wireSelection → wireSessionLog → wireSerial` is critical: serial.js's `wireSerial` consumes `sessionLog` (must exist) and `prefs` (must be loaded); selection consumes `scrollState`; chrome.js's Clear button consumes `scrollState.snapToBottom`.

---

### `www/index.html` (modify — DOM additions + CSS rule blocks + CSP meta)

**Analog:** self — existing top-bar (index.html:405-418), Connection pane (index.html:421-474), Settings pane (index.html:484-504).

**Phase 5 button-in-top-bar pattern** (index.html:406-407 — verbatim, template for Clear button):

```html
<button id="connect-button" type="button" data-state="disconnected"
        title="Connect to MicroBeast over Web Serial">Connect</button>
```

**Phase 6 — Clear button** (UI-SPEC §Top-bar Clear button — slot between Connect and theme-toggle per UI-SPEC line 515):

```html
<button id="clear-button" type="button"
        title="Clear visible screen (Shift+click also clears scrollback)">Clear</button>
```

**Phase 6 — Settings rows** (UI-SPEC §Settings pane DOM order lines 350-366 — verbatim):

```html
<hr class="settings-divider" />
<div class="settings-row">
  <button id="clear-scrollback-button" type="button" title="Clear all stored history (no shortcut — deliberate friction)">Clear scrollback</button>
  <p class="hint">Wipes the 10,000-line history. Visible screen is unaffected. Snaps to live tail if you're scrolled up.</p>
</div>
<div class="settings-row">
  <label for="auto-connect-checkbox">
    <input type="checkbox" id="auto-connect-checkbox">
    Auto connect on load
  </label>
  <p class="hint">When enabled, BestialiTTY silently opens the previously-granted MicroBeast port on each page load. Off by default. On open failure, falls back to the standard "click Connect" flow with the failure logged.</p>
</div>
<div class="settings-row">
  <button id="reset-prefs-button" type="button" title="Restore default theme, phosphor, font zoom, serial config, and toggles">Reset all preferences</button>
  <p class="hint">Clears your saved preferences. Port permission and connection state are not affected.</p>
</div>
```

**Phase 6 — Connection pane Download log button** (UI-SPEC §Connection-pane Download log button — slot near `Reset to MicroBeast preset` at index.html:467):

```html
<button id="download-log-button" type="button" disabled
        title="No bytes received yet">Download log</button>
```

**Phase 6 — Floating chip inside #terminal-wrapper** (UI-SPEC line 377-381 — verbatim):

```html
<button id="scrollback-indicator" type="button" hidden
        title="Click to scroll to live output" aria-label="0 new lines below">
  <span id="scrollback-indicator-text"><span aria-hidden="true">↓</span> 0 new lines</span>
</button>
```

**Phase 6 — Large-paste confirm button inside #paste-progress-row** (UI-SPEC line 488-504):

```html
<!-- Add to existing #paste-progress-row, AFTER #paste-cancel: -->
<button id="paste-confirm" type="button" hidden>Paste</button>
```

**CSS additions** — entire block from UI-SPEC §CSS additions (lines 395-505 — verbatim). Slot AFTER existing `#serial-reconnect-hint` block (index.html:299-308) but BEFORE the polite-fail block (index.html:362-394).

**CSP meta-tag** (RESEARCH §Code Examples lines 1356-1373 — verbatim, slot in `<head>` AFTER the existing `<meta name="viewport">` at index.html:5):

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'wasm-unsafe-eval';
               style-src 'self' 'unsafe-inline';
               img-src 'self' data:;
               font-src 'self';
               connect-src 'self';
               base-uri 'self';
               form-action 'none';
               frame-ancestors 'none'">
```

**Notable deviations:**
- `frame-ancestors 'none'` is INERT in the meta-tag (RESEARCH note: meta-tag CSP cannot enforce `frame-ancestors`; `_headers` carries that). Listed for documentation completeness — when the same site is served on Cloudflare Pages or self-hosted (where `_headers` works), the directive becomes effective.
- Hint text revision: replace Phase 5 footer hint at index.html:473 from `Full serial config persistence is a Phase 6 feature.` to `Serial config persists per the Settings → preferences blob.` (UI-SPEC §Settings-pane hint text revisions, line 525-527).

---

### `www/tests/session/*.spec.js` (test, request-response with mock fixtures)

**Analog:** `www/tests/transport/connect.spec.js` (Phase 5 setup() helper + describe block + test.fixme stub pattern from Wave 0).

**setup() helper** (connect.spec.js:6-13 — verbatim, the template for Phase 6 setup):

```js
async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}
```

**Phase 6 — session/setup helper** (each spec file's local helper):

```js
async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(CLIPBOARD_MOCK);   // Phase 6 — only specs that need it
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}
```

**test.fixme Wave 0 stub pattern** (transport/readloop.spec.js style):

```js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.describe('SESS-01 — Scrollback navigation', () => {
    test.fixme('wheel scrolls offset; chip appears @fast', async ({ page }) => {
        // TODO: live in Wave 2 when scroll-state.js + chip DOM land.
    });
    test.fixme('Shift+PgUp pages back; Shift+PgDn pages forward', async ({ page }) => {});
    test.fixme('Shift+End snaps to bottom; Shift+Home jumps to top', async ({ page }) => {});
    // etc...
});
```

**Test → spec mapping** (RESEARCH §Validation Architecture lines 1505-1529):

| Spec | Requirement IDs | Sample test names |
|---|---|---|
| `scrollback.spec.js` | SESS-01 | `wheel scrolls offset` / `Shift+PgUp pages back` / `Shift+End snaps` / `Shift+Home jumps` / `chip shows N new lines instantly` / `theme toggle keeps offset` |
| `selection.spec.js` | SESS-02 | `drag-select inverts glyphs` / `double-click selects word` / `triple-click selects line` / `selection clears on scroll` / `Esc cancels in-flight drag` |
| `clipboard.spec.js` | SESS-02, SESS-03 | `Ctrl+Shift+C copies plain text` / `Ctrl+C still sends 0x03` / `Ctrl+Shift+V pastes via paste-pump` / `Ctrl+V still sends 0x16` / `large-paste >= 4096 B confirm chip` / `paste preprocessing strips control bytes` |
| `clear-screen.spec.js` | SESS-06 | `top-bar Clear wipes 80x24 grid` / `Shift+click Clear also wipes scrollback` / `clear does NOT feed ESC J` (asserts cursor home + dirty all + parser unchanged) |
| `log-download.spec.js` | SESS-04, SESS-05 | `auto-start per Connect; chunks accumulate` / `download produces correct Blob` / `mid-session download captures so-far + appends continue` / `filename uses connect-time UTC stamp` |
| `prefs.spec.js` | PREF-01, PREF-02, PLAT-05 | `first-load applies D-36 defaults` / `theme persists across reload` / `savePrefs debounced 250 ms` / `reset prefs 2-click confirm` / `localEcho + crlfMode persist` |
| `auto-connect.spec.js` | PLAT-05, D-34 | `prefs.autoConnect=false → no silent open` / `prefs.autoConnect=true + getPorts match → silent open` / `auto-connect race against user click — no double open` (RESEARCH Pitfall 3) |

**Test for `clear_visible_does_not_feed_ESC_J`** — RESEARCH §Validation Architecture line 1519 mandates this Rust unit test:

```rust
// In crates/bestialitty-core/tests/clear_visible.rs:
#[test]
fn clear_visible_does_not_invoke_parser() {
    // Put parser in mid-escape state; verify clear_visible doesn't disturb it.
    let mut term = Terminal::new(24, 80, 100);
    term.feed(b"\x1B");                // Parser is now in EscState
    term.clear_visible();              // Direct mutation — must NOT touch parser
    // Now feed 'J' — would erase from cursor to end of screen IF parser
    // remembered its EscState. (clear_visible just put the cursor at home.)
    term.feed(b"J");
    // Assert that the J was treated as the second byte of ESC J — i.e. the
    // parser state was preserved across clear_visible.
    // After ESC J at cursor (0,0), entire visible region is BLANK (which
    // clear_visible already made BLANK). The marker is dirty bitmap state
    // before/after — clear_visible already marked all dirty; the ESC J would
    // also mark all dirty. We use a more direct check:
    // ... assertions to be filled in by executor; the load-bearing assertion
    // is "the byte 'J' after clear_visible was consumed by an active escape
    // sequence, not printed as the literal character 'J'."
    //
    // Simpler concrete check: feed `\x1B`, clear_visible, feed `Z` (ESC Z =
    // identify reply), assert host_reply contains the [0x1B, b'/', b'K']
    // identify bytes.
}
```

**Notable deviations:**
- All Phase 6 specs are Wave 0 stubs (`test.fixme`) initially, un-fixmed wave-by-wave as modules land. This is the Phase 5 Wave 0 pattern (CONTEXT §Established Patterns).
- The `__testGridView` global (main.js:93-97) is consumed by `clear-screen.spec.js` for grid-byte assertions — already shipped in Phase 4.

---

### `www/tests/session/clipboard-mock.js` (new fixture)

**Analog:** `www/tests/transport/mock-serial.js` — Phase 5 D-40 SERIAL_MOCK pattern (mock-serial.js:30-164).

**Existing SERIAL_MOCK shape** (mock-serial.js:30-164 — verbatim, the template):

```js
export const SERIAL_MOCK = `
(() => {
  const DEFAULT_INFO = { usbVendorId: 0x10c4, usbProductId: 0xea60 };
  window.__mockWriterLog = [];
  window.__mockState = { opened: false, port: null, listeners: {} };

  class MockReader { /* ... */ }
  class MockWriter { /* ... */ }
  class MockSerialPort extends EventTarget { /* ... */ }
  class MockSerial extends EventTarget { /* ... */ }

  const serial = new MockSerial();
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });

  // Test hooks — D-42.
  window.__simulateUnplug = () => { /* ... */ };
  window.__mockReaderPush = (bytes) => { /* ... */ };
})();`;
```

**Phase 6 CLIPBOARD_MOCK** (mirrors the SERIAL_MOCK shape, exposes test hooks):

```js
export const CLIPBOARD_MOCK = `
(() => {
  // Module-scope state on window for spec introspection.
  window.__clipboardContents = '';
  window.__mockClipboardLog = [];   // records { op, payload, ts } per call

  const mock = {
    async writeText(text) {
      window.__mockClipboardLog.push({ op: 'writeText', payload: text, ts: performance.now() });
      window.__clipboardContents = String(text);
    },
    async readText() {
      window.__mockClipboardLog.push({ op: 'readText', payload: null, ts: performance.now() });
      return window.__clipboardContents;
    },
  };

  Object.defineProperty(navigator, 'clipboard', { value: mock, configurable: true });

  // Test hooks.
  window.__setClipboardContents = (text) => { window.__clipboardContents = String(text); };
  window.__getClipboardContents = () => window.__clipboardContents;
})();`;
```

**Spec usage** (mirrors transport/connect.spec.js's SERIAL_MOCK init):

```js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';
import { CLIPBOARD_MOCK } from './clipboard-mock.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(CLIPBOARD_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
}
```

**Notable deviations:**
- Uses `Object.defineProperty(navigator, 'clipboard', { value: mock, configurable: true })` — exactly mirrors mock-serial.js:123 for `navigator.serial`.
- `__clipboardContents` is a string (not a Uint8Array) because the API surface is text-only; Phase 6's `pasteFromClipboard` does the bytes encoding internally.

---

### `www/playwright.config.js` (modify — testMatch glob extension)

**Analog:** self — `testMatch` array at playwright.config.js:7.

**Existing testMatch** (playwright.config.js:7 — verbatim):

```js
testMatch: ['**/render/*.spec.js', '**/input/*.spec.js', '**/transport/*.spec.js'],
```

**Phase 6 extension** (one-line change):

```js
testMatch: ['**/render/*.spec.js', '**/input/*.spec.js', '**/transport/*.spec.js', '**/session/*.spec.js'],
```

---

### `LICENSE` (new — repo root)

**Analog:** none in repo. Source: SPDX MIT canonical text per CONTEXT D-38 + RESEARCH §Sources `https://spdx.org/licenses/MIT.html`.

**Verbatim content** (RESEARCH-supplied + CONTEXT D-38 — substitute author and year):

```
MIT License

Copyright (c) 2026 <author>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Notable deviations:**
- `<author>` placeholder — RESEARCH §Assumptions Log A2 flags this for user confirmation in plan-phase. Default if unconfirmed: the value of `git config user.name` at commit time, or "BestialiTTY contributors".
- Year is **2026** (CONTEXT D-38 + 06-CONTEXT.md gathered date 2026-04-25).

---

### `.github/workflows/pages.yml` (new)

**Analog:** none in repo. Source: RESEARCH §Pattern 6 lines 884-939 (verbatim).

**Verbatim content** (RESEARCH §Pattern 6 — adopt as-is):

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Allow only one concurrent deployment
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/configure-pages@v5

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown

      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

      - name: Build wasm
        run: ./scripts/build.sh

      - name: Add .nojekyll
        run: touch www/.nojekyll

      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./www

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

**Notable deviations:**
- Action versions are pinned: `actions/checkout@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v5` (RESEARCH lines 348-352 — VERIFIED on 2026-04-25).
- The `path: ./www` in upload-pages-artifact uploads the whole `www/` directory (which contains `pkg/` after `./scripts/build.sh` runs). RESEARCH §Assumptions Log A3 flags the prerequisite: repo Pages settings must be "Deploy from a GitHub Action" — surface this in plan-phase.

---

### `www/_headers` (new — best-effort hosting config)

**Analog:** none in repo. Source: RESEARCH §Sources `https://developers.cloudflare.com/pages/configuration/headers/` + RESEARCH security domain table line 1597.

**Verbatim content** (RESEARCH-supplied; uses Cloudflare `_headers` syntax):

```
/*
  Permissions-Policy: serial=(self)
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'

/pkg/*.wasm
  Content-Type: application/wasm
```

**Notable deviations:**
- File lives at `www/_headers` (not repo root) — Cloudflare Pages reads `_headers` from the deployed directory.
- GitHub Pages **ignores this file entirely** (RESEARCH §Don't Hand-Roll table + §Sources GitHub Community 54257). The CSP is duplicated as `<meta http-equiv>` in `index.html` for the GitHub Pages deploy path; `frame-ancestors` won't work via meta-tag, but accept that limitation per RESEARCH security analysis lines 1597-1599.
- The `/pkg/*.wasm Content-Type: application/wasm` line is hygiene — GitHub Pages auto-serves `.wasm` correctly per RESEARCH §Sources tertiary source (validated by `curl -I` UAT step in 06-HUMAN-UAT.md).

---

### `www/.nojekyll` (new — empty file)

**Analog:** none. Source: RESEARCH §Pattern 6 line 924 (`touch www/.nojekyll`) + GitHub Docs link.

**Content:** Empty (zero bytes).

**Purpose:** Disables Jekyll processing on GitHub Pages (would otherwise refuse to serve files starting with `_` like `_headers`). The workflow YAML touches this at deploy time, but committing it explicitly is also fine and avoids a missing-file race on the first push.

---

### `www/index.html` `<meta http-equiv="Content-Security-Policy">` (insert)

**Analog:** none in existing index.html `<head>`. Source: RESEARCH §Code Examples lines 1356-1373 (verbatim).

Already covered in the `www/index.html (modify)` row above — see the "CSP meta-tag" subsection.

---

### `06-SOAK.md` (new — phase doc)

**Analog:** `.planning/phases/04-keyboard-input/04-VALIDATION.md` (validation-doc structure) + `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` (front-matter pattern).

**Front-matter pattern** (05-HUMAN-UAT.md:1-7 — verbatim shape):

```markdown
---
status: complete
phase: 05-web-serial-transport
source: [05-VERIFICATION.md, 05-VALIDATION.md]
started: 2026-04-23
updated: 2026-04-25
---
```

**Phase 6 SOAK structure** (CONTEXT D-40 + RESEARCH §Pitfall 9 + §Sources `performance.memory`):

```markdown
---
status: draft
phase: 06-daily-driver-polish-session-deployment
source: [06-CONTEXT.md D-40, 06-RESEARCH.md §Pitfall 9]
started: TBD
updated: TBD
---

# Phase 6 — 24-Hour Soak Protocol

## Setup

- Real MicroBeast hardware running a script that emits ~1 line/sec of mixed CP/M output for 24 h.
- Suggested script: BASIC `for i = 0 to 1e9 : print i : next` running at terminal-readable speed (CONTEXT §Claude's Discretion).
- BestialiTTY connected, browser tab open, mix of foreground + background tab time per RESEARCH §Pitfall 9.

## Sampling

- `setInterval(60_000, sampler)` — NOT requestAnimationFrame (RESEARCH §Pitfall 9: rAF throttles to ~1 Hz on hidden tabs; setInterval continues at 1 Hz when throttled, still close to 60 s).
- Each sample records: `performance.memory.usedJSHeapSize`, `performance.memory.totalJSHeapSize`, `wasm.memory.buffer.byteLength`, `chunks.length`, `totalBytes`, ISO timestamp.
- Samples written to `console.log` for grep-extraction post-run.

## Pass Criteria

- `wasm.memory.buffer.byteLength` stable within ±10% of initial after the first 10 minutes (CONTEXT D-40).
- No monotonic growth pattern in `usedJSHeapSize` past steady-state.
- `chunks.length` grows linearly (1 chunk per RX bytes received — by design, D-30); not unbounded growth from leak.

## Result

[to be filled by executor]
```

**Notable deviations:**
- Sampling uses `setInterval` per RESEARCH §Pitfall 9 — NOT requestAnimationFrame (would throttle on hidden tabs).
- Pass threshold ±10% per CONTEXT D-40 (NOT a tunable; locked).
- `performance.memory` fallback documented per RESEARCH §Assumptions Log A7 (Chromium may remove the API; `wasm.memory.buffer.byteLength` is the primary signal).

---

### `06-HUMAN-UAT.md` (new — daily-driver checklist)

**Analog:** `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` (canonical exact analog).

**Verbatim front-matter** (05-HUMAN-UAT.md:1-7 — adapt to Phase 6):

```markdown
---
status: draft
phase: 06-daily-driver-polish-session-deployment
source: [06-VERIFICATION.md, 06-VALIDATION.md]
started: TBD
updated: TBD
---
```

**Test structure** (05-HUMAN-UAT.md format — `## Tests` with `### N. Title (REQ-ID)` + `**expected:** … **steps:** 1. … **result:** pass/fail`).

**Required tests** (CONTEXT line 94-98):
1. Paste 100 KB during a real CP/M session.
2. Scroll back through 8K lines of BASIC output.
3. Copy a command from history and paste it back.
4. Theme toggle while scrolled up — viewport keeps offset.
5. Clear-screen before / during long output.
6. Full reload restores prefs + port preset.
7. Auto-connect on second visit.
8. 24-hour soak (cross-references 06-SOAK.md).

---

## Shared Patterns

### `wireX(opts)` dependency injection

**Source:** `www/renderer/chrome.js` (chrome.js:52-57), `www/input/keyboard.js` (keyboard.js:130-141), `www/input/paste-pump.js` (paste-pump.js:32-38), `www/transport/serial.js` (serial.js:78-93).

**Apply to:** `www/renderer/scroll-state.js` (NEW), `www/input/selection.js` (NEW), `www/input/clipboard.js` (NEW), `www/transport/session-log.js` (NEW), `www/state/prefs.js` (NEW).

**Verbatim shape** (paste-pump.js:32-38):

```js
export function wirePastePump(opts) {
    const { term, sampleBell, drainHostReply, requestFrame } = opts;
    termRef = term;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
}
```

Every new Phase 6 module follows this exact shape: opts destructure → assign to module-scope `let` references. Tests dispose by re-importing fresh module instances per page (Playwright's `page.goto()` resets module state).

---

### `mousedown preventDefault` focus retention

**Source:** `www/renderer/chrome.js` lines 70-72 (verbatim).

**Apply to:** Every NEW Phase 6 chrome control (Clear button, Download log button, Clear scrollback button, Auto connect checkbox, Reset prefs button, Paste confirm button, scrollback indicator chip).

**Verbatim:**

```js
themeButton.addEventListener('mousedown', (e) => {
    e.preventDefault();
});
```

Phase 4 D-16 + Phase 5 footnote: this is the established convention. Skipping it breaks the "after click, terminal is still focused" UX. RESEARCH §Pitfall 1 (Shift+End focus loss) confirms it.

---

### Module-scope cached Uint8Array views with buffer-identity guard

**Source:** `www/renderer/canvas.js` lines 37-51 (`rebuildViews` / `reDeriveViews`).

**Apply to:** Any NEW Phase 6 code that reads wasm-side memory through a `Uint8Array` view (`scroll-state.js` if it reads `term.snapshot_grid_at` output directly — but it doesn't; canvas.js owns the view). Phase 6 has no NEW wasm-view consumer; the existing `gridView` / `dirtyView` in canvas.js suffice.

**Verbatim** (canvas.js:43-51):

```js
function rebuildViews() {
    gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
    dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
    cachedBuffer = wasm.memory.buffer;
}

function reDeriveViews() {
    if (wasm.memory.buffer !== cachedBuffer) rebuildViews();
}
```

Phase 6's `snapshot_grid_at` does NOT introduce a new pointer — it writes into the SAME `pack_buf` (Rust side) that `snapshot_grid` writes into. The pointer-stability contract from Phase 2 D-03 carries through (RESEARCH §Code Examples line 1188-1189: "Pointer remains stable across this call (matches snapshot_grid contract from D-03).").

---

### Post-feed invariant for term.feed callers

**Source:** `www/main.js` lines 360-367 (Feed button) + `www/transport/serial.js` lines 339-344 (read loop) + `www/input/paste-pump.js` lines 113-118 (local-echo).

**Apply to:** Phase 6's `serial.js` read-loop addition (sessionLog.append) — drops INTO the post-feed block, AFTER `requestFrame()`.

**Verbatim** (serial.js:339-344):

```js
term.feed(value);
sampleBellFn();
drainHostReplyFn('serial');
requestFrameFn();
// Phase 6 (D-30) — append to session log AFTER the post-feed invariant.
sessionLogRef.append(value);
```

The append goes LAST so a `term.feed`-induced exception (e.g. parser bug) doesn't leave a half-logged byte stream. SessionLog append is non-throwing (just `chunks.push(value)`).

---

### Inline confirmation buttons (no modals)

**Source:** Phase 6 D-25 (large-paste warn) + Phase 6 D-35 (reset-prefs confirm) — pattern shared across both. Architecture: button text changes for N seconds, second click commits, timeout reverts.

**Apply to:** `www/renderer/chrome.js` reset-prefs button + `www/input/clipboard.js` large-paste confirm chip.

**Skeleton** (Phase 6-specific; no direct codebase analog — closest sibling is Phase 5 D-08 hint show/hide at serial.js:245-254 for transient inline state, but the click-to-confirm timer is new):

```js
let confirmTimer = null;
button.addEventListener('click', () => {
    if (confirmTimer === null) {
        button.textContent = 'Click again to confirm (3 s)';
        confirmTimer = setTimeout(() => {
            button.textContent = 'Reset all preferences';
            confirmTimer = null;
        }, 3000);
    } else {
        clearTimeout(confirmTimer);
        confirmTimer = null;
        commitAction();
    }
});
```

**Notable deviation from RESEARCH §Pitfall 10:** the 3 s window is locked (CONTEXT D-35); the Pitfall 10 user-confusion mitigation is "CSS animation showing countdown" — left to "Claude's Discretion" per CONTEXT.

---

### Per-spec inline `setup()` helper

**Source:** `www/tests/transport/connect.spec.js` lines 6-13 + `www/tests/input/keydown-printable.spec.js` lines 4-11.

**Apply to:** Every Phase 6 spec under `www/tests/session/`.

**Verbatim shape** (connect.spec.js:6-13):

```js
async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}
```

Phase 6 setup() additions per spec:
- All session/* specs: `await page.addInitScript(SERIAL_MOCK);` (mock-serial is needed to drive the read loop or block actual port access).
- clipboard.spec.js + paste-from-clipboard.spec.js: `await page.addInitScript(CLIPBOARD_MOCK);` (Phase 6's clipboard mock fixture).
- prefs.spec.js: NO mocks — uses real localStorage; tests run against `/?test=1` if test-gating becomes needed.

---

## No Analog Found

**None.** Every Phase 6 file has either a strong codebase analog (in-repo) or a verbatim research excerpt (RESEARCH.md §Pattern 1-6 + §Code Examples) that the executor can paste directly. The build/deploy artifacts (LICENSE, pages.yml, _headers, .nojekyll) have no codebase analog by definition (greenfield repo metadata) but the canonical content is research-supplied verbatim.

---

## Metadata

**Analog search scope:**
- `crates/bestialitty-core/src/` (7 Rust modules)
- `crates/bestialitty-core/tests/` (3 integration test files)
- `www/` (main.js, index.html, playwright.config.js)
- `www/input/` (keyboard.js, paste-pump.js, tx-sink.js)
- `www/renderer/` (canvas.js, chrome.js, atlas.js, themes.js, bitmap-font.js)
- `www/transport/` (serial.js)
- `www/tests/transport/` (Phase 5 mock-serial + 9 specs)
- `www/tests/input/` (Phase 4 — 8 specs)
- `www/tests/render/` (Phase 3 — 9 specs)
- `scripts/` (build.sh, smoke-wasm-build.sh)
- `.planning/phases/04-*/04-VALIDATION.md`, `.planning/phases/05-*/05-HUMAN-UAT.md`, `.planning/phases/05-*/05-PATTERNS.md`

**Files scanned:** ~50 source + test files + 5 phase-doc analogs.

**Pattern extraction date:** 2026-04-25.
