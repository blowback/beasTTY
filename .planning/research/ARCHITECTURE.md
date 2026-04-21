# Architecture Research

**Domain:** In-browser VT52 terminal emulator (Rust/wasm core + JS/Canvas shell, Web Serial transport)
**Researched:** 2026-04-21
**Confidence:** HIGH

## Executive Summary

The project has a hard architectural split baked into its requirements: Rust/wasm owns
*pure logic* (parser, terminal state, key encoding), JS owns everything the browser
exposes (Web Serial I/O, Canvas rendering, event loop, DOM). This research tries to
answer the concrete questions that fall out of that split: what crosses the boundary,
how often, how scrollback is laid out, how rendering stays at 60fps, and what order to
build things in.

The short version:

- **Parser:** build on top of the `vte` crate (Paul Williams' VT500 state machine). It
  already handles partial sequences, re-entry, and graceful unknown-sequence recovery —
  pay that cost zero times. Implement `Perform` on a `Terminal` struct that owns the
  grid.
- **Grid + scrollback:** live entirely in Rust. A VecDeque-backed ring (à la Alacritty)
  is the proven structure. JS never sees grid cells as JS values — it reads them as
  byte views into wasm linear memory.
- **Wasm boundary:** two hot calls only — `feed(bytes)` (serial → parser) and
  `encode_key(event)` (key event → VT52 bytes). Rendering reads the dirty-row bitmap and
  the cell buffer via *zero-copy `Uint8Array` views* into wasm memory — no per-frame
  serialisation, no `serde_wasm_bindgen`, no JSON.
- **Rendering:** Canvas 2D with a per-glyph offscreen-canvas atlas. Only dirty rows get
  repainted each frame; `requestAnimationFrame` drives the loop. No WebGL in v1 — a
  VT52 is 80x24 cells (at most), which Canvas 2D with a glyph atlas handles trivially.
- **Transport:** raw `port.readable.getReader()` (NOT TextDecoderStream — VT52 escape
  sequences must not be interpreted as UTF-8 before parsing). Session logging is a tee
  inside the reader loop *before* bytes cross the wasm boundary.
- **Build order:** Rust parser + terminal with CLI/Node harness → JS canvas renderer
  over a fake buffer → wire Rust to JS → add Web Serial last. Each phase is independently
  testable.

## Standard Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Browser (Chromium only)                         │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      JS Shell (src/js/*.js)                       │  │
│  │                                                                    │  │
│  │  ┌────────────┐    ┌────────────┐    ┌─────────────────────────┐ │  │
│  │  │ SerialIO   │    │ KeyInput   │    │  Renderer (Canvas 2D)   │ │  │
│  │  │  (reader   │    │  (DOM      │    │  - glyph atlas          │ │  │
│  │  │   loop,    │    │   key      │    │  - dirty-row repaint    │ │  │
│  │  │   writer)  │    │   events)  │    │  - theme (CRT / modern) │ │  │
│  │  └──────┬─────┘    └──────┬─────┘    └───────────┬─────────────┘ │  │
│  │         │ bytes           │ keyevent              │ reads grid     │  │
│  │         ▼                 ▼                       │                │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │            Wasm Boundary (wasm-bindgen glue)                  │ │  │
│  │  │  feed(ptr,len) → void     encode_key(evt) → Uint8Array       │ │  │
│  │  │  grid_ptr() → *const Cell  dirty_rows_ptr() → *const u8      │ │  │
│  │  │  cursor() → (row,col)      clear_dirty()                     │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                 Rust Core (compiled → wasm32)                     │  │
│  │                                                                    │  │
│  │  ┌──────────┐   ┌─────────────┐   ┌──────────────────────────┐   │  │
│  │  │ vte::    │──▶│ Terminal    │──▶│ Grid<Cell> + Scrollback  │   │  │
│  │  │ Parser   │   │ : Perform   │   │ (VecDeque<Row>)          │   │  │
│  │  │ (VT500   │   │ (state      │   │ + DirtyRows bitmap       │   │  │
│  │  │  SM)     │   │  machine)   │   │                          │   │  │
│  │  └──────────┘   └─────────────┘   └──────────────────────────┘   │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────┐                              │  │
│  │  │ KeyEncoder (KeyEvent → VT52 bytes)│                              │  │
│  │  └──────────────────────────────────┘                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                ▲                                        │
└────────────────────────────────┼────────────────────────────────────────┘
                                 │
                    bytes over  │ Web Serial
                                 ▼
                          ┌─────────────┐
                          │ MicroBeast  │
                          │    (Z80)    │
                          └─────────────┘
```

### Component Responsibilities

| Component | Side | Responsibility |
|-----------|------|----------------|
| `SerialIO` | JS | Open `SerialPort`, loop on `reader.read()`, push raw bytes into wasm via `feed()`. Own disconnect/reconnect. Tee bytes to session-log buffer before wasm call. |
| `KeyInput` | JS | Capture `keydown`/`keypress` on the canvas container. Pre-filter browser shortcuts (Ctrl+C copy vs Ctrl+C to terminal). Pass a small struct to `encode_key()`. Write returned bytes to `port.writable`. |
| `Renderer` | JS | On each `rAF` tick, ask wasm which rows are dirty. Paint only those rows using the glyph atlas. Apply active theme. Clear the dirty bitmap. |
| `ClipboardBridge` | JS | Translate canvas selection (row/col ranges from JS-side selection state) to text by reading wasm cell buffer, copy to `navigator.clipboard`. On paste, feed characters to `encode_key()` as synthetic input. |
| `SessionLogger` | JS | Accumulate bytes in a growing `Uint8Array` (or chunks + Blob). Expose "download" action. Lives in JS because File/Blob APIs do. |
| `Config` | JS | Serial params, theme selection, scrollback size. Persisted in `localStorage`. Passed to Rust via `resize()` / `set_scrollback()`. |
| `vte::Parser` | Rust | VT500 state machine. Dependency; not our code. Drives `Perform` callbacks. |
| `Terminal` (impl `Perform`) | Rust | VT52 semantic layer. Interprets `esc_dispatch('A')` as cursor-up, `esc_dispatch('Y')` as cursor-addressing, `print(c)` as put-char-at-cursor, etc. Mutates grid; marks rows dirty. |
| `Grid` / `Scrollback` | Rust | `VecDeque<Row>` where `Row = [Cell; COLS]` and `Cell = { ch: u32, fg: u8, bg: u8, flags: u8 }`. Visible region is a slice of the back of the deque; scrollback is the front. Laid out as a contiguous `Vec<Cell>` for easy JS view. |
| `DirtyRows` | Rust | Fixed-length `[u8; MAX_ROWS]` bitmap (one byte per row for alignment). Set by `Terminal` mutations, read+cleared by JS renderer. |
| `KeyEncoder` | Rust | Stateless `fn encode(evt: KeyEvent) -> Vec<u8>`. Handles arrow keys (`ESC A/B/C/D`), keypad, Ctrl combos, printable chars. Pure logic; trivial to unit-test. |

## Recommended Project Structure

```
bestialitty/
├── Cargo.toml                   # workspace root
├── crates/
│   └── bestialitty-core/        # Rust/wasm library
│       ├── Cargo.toml           # cdylib + rlib
│       └── src/
│           ├── lib.rs           # wasm-bindgen exports (boundary surface)
│           ├── terminal.rs      # Terminal struct, impl vte::Perform
│           ├── grid.rs          # Grid<Cell>, Row, Cell layout
│           ├── scrollback.rs    # VecDeque ring; resize logic
│           ├── dirty.rs         # Dirty-row tracking
│           ├── key.rs           # KeyEvent → VT52 bytes
│           └── vt52.rs          # VT52 opcode table / dispatch
├── www/                         # Static site (what gets deployed)
│   ├── index.html
│   ├── main.js                  # App bootstrap; wires components
│   ├── serial.js                # SerialIO: reader/writer loop, disconnect
│   ├── renderer/
│   │   ├── canvas.js            # Renderer: rAF loop, dirty-row paint
│   │   ├── atlas.js             # Glyph atlas (offscreen canvases)
│   │   └── themes.js            # CRT + modern theme descriptors
│   ├── input/
│   │   ├── keyboard.js          # DOM events → wasm key events
│   │   └── clipboard.js         # Copy from grid, paste as input
│   ├── logging.js               # Session logger (byte tee + download)
│   ├── config.js                # localStorage settings UI
│   ├── pkg/                     # wasm-pack output (gitignored)
│   └── assets/
│       └── fonts/               # Bitmap / monospace font files
├── tests/
│   └── (Rust unit tests live under each module; no JS tests in v1)
└── scripts/
    └── build.sh                 # wasm-pack build --target web → www/pkg
```

### Structure Rationale

- **`crates/bestialitty-core/`:** isolated Cargo package keeps the wasm crate independent
  of any host build system. `cdylib` for the wasm output, `rlib` so Rust-side tests can
  link it without going through wasm.
- **`www/` is the deployable unit:** everything under `www/` maps 1:1 to what ships to
  GitHub Pages / Cloudflare Pages. `wasm-pack build --target web` writes into
  `www/pkg/` so the static site has a single source tree with no bundler step.
- **`renderer/` and `input/` subfolders:** the two hot paths that will grow the most
  (theme tweaks, glyph caching rules, paste handling quirks). Giving them their own
  folders now prevents `js/` from becoming a flat mess later.
- **No `src/shared/` or TypeScript types shared between sides:** the wasm boundary *is*
  the type boundary. Rust has its types; JS treats wasm outputs as `Uint8Array` views
  and primitive numbers. No type-sharing layer to drift.

## The Wasm Boundary Contract

This is the single most important design surface. Get it wrong and the terminal either
allocates garbage every frame or stutters on 9600-baud input.

### What Crosses (And How)

| Call | Direction | Data | Frequency | Copy? |
|------|-----------|------|-----------|-------|
| `feed(ptr, len)` | JS → Rust | Raw bytes from serial | Per serial read (~10-100/sec) | **Zero-copy**: JS writes into a wasm-owned buffer, Rust reads in place. |
| `encode_key(code, mods)` → `Uint8Array` | JS → Rust → JS | Numeric key descriptor in; short byte array out | Per keystroke (~10/sec peak) | Tiny — 1-5 bytes. Copy cost irrelevant. |
| `grid_ptr()` → `*const Cell` | Rust → JS | Pointer into wasm linear memory | Once per renderer init + after resize | Zero-copy view via `new Uint8Array(memory.buffer, ptr, len)`. |
| `dirty_rows_ptr()` → `*const u8` | Rust → JS | Pointer to dirty bitmap | Once per renderer init | Zero-copy view. |
| `cursor()` → `u32` (packed row<<16\|col) | Rust → JS | Cursor position | Once per frame | Tiny — returned in a register, no copy. |
| `clear_dirty()` | JS → Rust | none | Once per frame | n/a |
| `resize(rows, cols)` | JS → Rust | Two u32s | On window resize | n/a. May invalidate grid pointer — JS must re-fetch. |
| `set_scrollback(n)` / `scroll_to(offset)` | JS → Rust | u32 | On user action | n/a. May reallocate — re-fetch pointer. |

### What Must NOT Cross

- **The grid as a JS array or JSON.** 80×24×~8 bytes = ~15KB; copying into JS 60 times a
  second is 900KB/s of pointless allocation. Use `Uint8Array` views.
- **Serde-serialised structs.** `serde_wasm_bindgen` is fine for one-shot config calls,
  but never in hot paths.
- **`DamageRect` or per-cell diffs as objects.** The dirty-row bitmap is one byte per
  row — 24 bytes total for a VT52 screen. The renderer reads it directly.
- **Web Serial types.** Rust never sees `SerialPort`. This is a hard constraint and the
  whole reason for the split.
- **JS `KeyboardEvent` objects.** JS extracts the three things that matter
  (`{ key, ctrl, alt, shift, meta, keyCode }`) into a small struct of primitives. Rust
  never reaches into a JS object.
- **Strings from Web Serial.** Do not wrap the serial stream in `TextDecoderStream`.
  VT52 escape sequences are *bytes*, not UTF-8 text. Decoding them as text before
  parsing breaks `ESC Y row+32 col+32` (cursor addressing) and any high-bit bytes.

### Boundary Call Shape (Rust side)

```rust
// crates/bestialitty-core/src/lib.rs

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Terminal {
    parser: vte::Parser,
    state: TerminalState, // owns grid, scrollback, dirty bitmap
}

#[wasm_bindgen]
impl Terminal {
    #[wasm_bindgen(constructor)]
    pub fn new(rows: u32, cols: u32) -> Terminal { /* ... */ }

    /// Feed raw bytes. `ptr` points into wasm linear memory filled by JS.
    /// Hot path: called per serial read, up to hundreds of times per second.
    pub fn feed(&mut self, ptr: *const u8, len: usize) {
        // SAFETY: JS holds the wasm memory alive for the duration of this call.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        for &b in bytes {
            self.parser.advance(&mut self.state, b);
        }
    }

    /// Pointer to the packed cell buffer. Layout: `[Cell; rows * cols]` in row-major order.
    /// Stable until the next `resize()` or `set_scrollback()`.
    pub fn grid_ptr(&self) -> *const u8 { self.state.grid.as_ptr() as *const u8 }
    pub fn grid_byte_len(&self) -> usize { self.state.grid.byte_len() }

    pub fn dirty_ptr(&self) -> *const u8 { self.state.dirty.as_ptr() }
    pub fn clear_dirty(&mut self) { self.state.dirty.clear(); }

    pub fn cursor(&self) -> u32 { (self.state.cursor.row << 16) | self.state.cursor.col }

    /// Accepts a packed key descriptor; returns the VT52 byte sequence to transmit.
    pub fn encode_key(&self, code: u32, mods: u32) -> Vec<u8> {
        key::encode(KeyEvent::unpack(code, mods))
    }
}
```

### Boundary Call Shape (JS side)

```js
// www/main.js
import init, { Terminal } from './pkg/bestialitty_core.js';

const wasm = await init();
const term = Terminal.new(24, 80);

// Buffer for incoming serial bytes. Reused across reads — no per-read allocation.
const FEED_BUF_PTR = term.__wbg_feed_buf_ptr(); // or allocate once via a helper
// Alternative pattern: allocate a scratch Uint8Array and let `feed` accept it via
// wasm-bindgen's automatic slice marshalling. The zero-copy version is strictly a
// win only if you measure churn in allocation.

// Grid view — CRITICAL: re-fetch after resize / scrollback reconfig.
let gridView = new Uint8Array(wasm.memory.buffer, term.grid_ptr(), term.grid_byte_len());
let dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());

function onSerialChunk(chunk) {
  sessionLogger.append(chunk);       // tee BEFORE wasm
  term.feed(chunk);                  // wasm-bindgen copies chunk into wasm memory
}

function onFrame() {
  for (let r = 0; r < term.rows(); r++) {
    if (dirtyView[r]) renderer.paintRow(r, gridView);
  }
  term.clear_dirty();
  requestAnimationFrame(onFrame);
}
```

## Architectural Patterns

### Pattern 1: Parser + Performer (from vte crate)

**What:** The `vte` crate implements Paul Williams' VT500 state machine as a pure byte
parser. It does nothing semantic — it just calls back into a user-provided `Perform`
trait when it recognises an action (print char, execute C0, dispatch ESC sequence,
dispatch CSI sequence). Our VT52 `Terminal` struct implements `Perform` and interprets
each callback in VT52 terms.

**When to use:** Always, for this project. Do not write your own parser. Paul Williams'
state machine handles partial reads, mid-sequence errors, unexpected bytes, and
cancellation correctly — getting any of those wrong is a silent-corruption bug.

**Trade-offs:** `vte` is an ANSI/VT100 parser; VT52 is much simpler. You're using
maybe 30% of its capability. That's fine — the unused paths are free at runtime
because the state machine just never enters them. The subset of `Perform` callbacks
you actually need: `print`, `execute` (for C0 controls like CR/LF/BS), and
`esc_dispatch` (for VT52's `ESC X` single-char commands). `csi_dispatch`, `hook`, `put`,
`unhook`, `osc_dispatch` can be no-ops.

**Example:**
```rust
impl vte::Perform for TerminalState {
    fn print(&mut self, c: char) {
        self.grid.put(self.cursor, c);
        self.dirty.mark(self.cursor.row);
        self.advance_cursor();
    }
    fn execute(&mut self, byte: u8) {
        match byte {
            0x08 => self.backspace(),       // BS
            0x0A => self.line_feed(),       // LF
            0x0D => self.carriage_return(), // CR
            0x07 => self.ring_bell(),       // BEL
            _ => {}                          // ignore unknown C0
        }
    }
    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, byte: u8) {
        match byte {
            b'A' => self.cursor_up(),
            b'B' => self.cursor_down(),
            b'C' => self.cursor_right(),
            b'D' => self.cursor_left(),
            b'H' => self.cursor_home(),
            b'J' => self.erase_to_end_of_screen(),
            b'K' => self.erase_to_end_of_line(),
            b'Y' => self.begin_cursor_addressing(), // then captures 2 more bytes in its own mini-state
            // ... full VT52 table
            _ => {}
        }
    }
}
```

### Pattern 2: Zero-Copy Grid View

**What:** Rust owns a contiguous `Vec<Cell>` laid out row-major. Cell is a `repr(C)`
POD: `{ ch: u32, fg: u8, bg: u8, flags: u8, _pad: u8 }` (8 bytes, naturally aligned).
JS reads grid state by constructing a `Uint8Array` directly over wasm linear memory at
`grid_ptr()`. No copy, no serialisation, no allocation per frame.

**When to use:** This is the right default for hot-path reads of fixed-size state
from Rust. The alternative (copy via `Vec<u8>` → JS `Uint8Array`) is fine for
infrequent reads but a death trap at frame rate.

**Trade-offs:** The view is invalidated if wasm memory grows (resize, scrollback
expansion). JS must re-fetch `grid_ptr()` after any operation that may reallocate. We
make this explicit by returning new pointers from `resize()` / `set_scrollback()` and
documenting "after these calls, re-derive the view."

**Example:**
```rust
#[repr(C)]
pub struct Cell { pub ch: u32, pub fg: u8, pub bg: u8, pub flags: u8, _pad: u8 }
// sizeof(Cell) == 8
```
```js
const CELL_SIZE = 8;
function cellAt(view, row, col, cols) {
  const i = (row * cols + col) * CELL_SIZE;
  return {
    ch: view[i] | (view[i+1] << 8) | (view[i+2] << 16) | (view[i+3] << 24),
    fg: view[i+4],
    bg: view[i+5],
    flags: view[i+6],
  };
}
```

### Pattern 3: Dirty-Row Repaint with Glyph Atlas

**What:** Renderer maintains an offscreen-canvas atlas: one small canvas per
`(glyph, fg, bg, flags)` tuple, pre-rasterised on first use. To paint a row, for each
cell the renderer looks up the atlas entry and `drawImage`s it at `(col * cellW, row * cellH)`.
Only rows flagged dirty are repainted; everything else persists on the main canvas
between frames.

**When to use:** Always, for any canvas terminal. `fillText` per cell per frame is the
well-documented slow path (benchmarks show 5-45x speedups from moving to a cached-glyph
model — VS Code Terminal, Windows Terminal, xterm.js all confirm this).

**Trade-offs:** Atlas grows with the number of distinct `(glyph, fg, bg, flags)`
combinations in use. For VT52 with a 128-char repertoire, two colours (fg/bg), and 2-3
flag bits (bold/inverse/underline), worst case is ~128 × 3 × 8 = 3072 entries at
`cellW × cellH ≈ 9×16 = 144` pixels each = ~440KB. Trivial. Evict on theme change.

**Example:**
```js
// renderer/atlas.js
const cache = new Map();
function getGlyph(ch, fg, bg, flags) {
  const key = (ch << 16) | (fg << 8) | bg; // plus flags packed in
  let tile = cache.get(key);
  if (!tile) {
    tile = document.createElement('canvas');
    tile.width = cellW; tile.height = cellH;
    const ctx = tile.getContext('2d');
    ctx.fillStyle = theme.bg(bg); ctx.fillRect(0, 0, cellW, cellH);
    ctx.fillStyle = theme.fg(fg); ctx.font = theme.font;
    ctx.fillText(String.fromCharCode(ch), 0, theme.baseline);
    cache.set(key, tile);
  }
  return tile;
}
```

### Pattern 4: Reader-Loop with Tee for Session Logging

**What:** The JS serial reader loop is the single choke point through which all
received bytes flow. It does three things in order: (1) append chunk to the session
log, (2) hand chunk to wasm via `feed()`, (3) loop. Session logging does not belong in
Rust — the File/Blob download mechanism is pure browser.

**When to use:** Always for session logging. This is also the natural place for a
debug byte-dump panel, connection stats, and any future instrumentation.

**Trade-offs:** Memory grows unboundedly with session length. Mitigation: buffer as a
list of `Uint8Array` chunks (avoid re-concatenation), cap with a configurable ring
(discard oldest or refuse new when over limit), offer "download and clear." Appending
each chunk is O(1).

**Example:**
```js
async function serialReaderLoop(port, term, logger) {
  const reader = port.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      logger.append(value);      // tee here
      term.feed(value);          // wasm-bindgen copies `value` into wasm memory
    }
  } catch (err) { onSerialError(err); }
  finally { reader.releaseLock(); }
}
```

### Pattern 5: Scrollback as Part of the Grid, Not Separate

**What:** Following Alacritty's model, scrollback isn't a distinct structure from the
visible grid. The grid is a `VecDeque<Row>`. The visible region is the last N rows;
everything before that is scrollback. "Scroll up by K lines" means "the visible region
is now rows `len - N - K..len - K`." New lines push onto the back; when total length
exceeds max scrollback, rows pop from the front.

**When to use:** Always. Keeping scrollback unified with the grid simplifies LF/scroll
behaviour and makes search/copy operations uniform. The alternative — visible grid +
separate scrollback ring — requires copying rows between them on scroll, which is both
more code and slower.

**Trade-offs:** The cell byte-buffer exposed to JS must be re-derived when the visible
region changes (scroll up/down). This means `grid_ptr()` / `grid_byte_len()` return the
*current visible slice*, not the full deque. Renderer always calls `grid_ptr()` per
frame (it's a pointer read, not a copy) rather than caching the view across scroll
operations. Or: expose both "full grid ptr" and "visible offset" and let JS index; the
former is simpler.

## Data Flow

### Inbound: Serial Bytes → Screen

```
MicroBeast (Z80)
    │
    │  bytes over UART @ 9600 baud (~1KB/s typical, bursts higher)
    ▼
SerialPort.readable.getReader()
    │
    │  Uint8Array chunks (~64-4096 bytes)
    ▼
serialReaderLoop()
    │
    ├──▶ sessionLogger.append(chunk)         [tee]
    │
    ▼
term.feed(chunk)                              [wasm boundary]
    │
    │  wasm-bindgen marshals chunk into wasm linear memory
    ▼
vte::Parser.advance(byte) × N                 [Rust side]
    │
    │  state-machine callbacks
    ▼
Terminal.print() / execute() / esc_dispatch()
    │
    ├──▶ grid[cursor.row][cursor.col] = Cell{...}
    ├──▶ dirty[cursor.row] = 1
    └──▶ cursor advances / wraps / scrolls
    │
    │  (on scroll: push_back new empty row; pop_front if over capacity;
    │              mark all visible rows dirty)
    │
    ▼
(control returns to JS after chunk processed)

──── rAF tick ────

renderer.onFrame()
    │
    │  reads dirtyView[r] for r in 0..rows
    ▼
for each dirty row r:
    │
    │  reads gridView[r*cols*8 .. (r+1)*cols*8]
    ▼
    atlas.getGlyph(ch, fg, bg, flags) → HTMLCanvasElement
    ctx.drawImage(tile, col*cellW, r*cellH)
    │
    ▼
term.clear_dirty()
requestAnimationFrame(onFrame)
```

### Outbound: Keystroke → Serial

```
DOM KeyboardEvent (keydown)
    │
    │  { key, code, ctrlKey, altKey, shiftKey }
    ▼
keyboard.handle(event)
    │
    │  filter browser shortcuts (Ctrl+C/V/A handling)
    │  pack into u32 code + u32 mods
    ▼
term.encode_key(code, mods)                   [wasm boundary]
    │
    │  pure function; no state mutation
    ▼
KeyEncoder::encode(KeyEvent) -> Vec<u8>
    │
    │  e.g. ArrowUp → [0x1B, 0x41]    (ESC A)
    │       Ctrl+A  → [0x01]
    │       'a'     → [0x61]
    ▼
Uint8Array (1-5 bytes)
    │
    ▼
port.writable.getWriter().write(bytes)
    │
    │  tee: sessionLogger.append(bytes, direction: 'tx')  [optional]
    ▼
MicroBeast receives
```

### Resize / Scrollback Reconfiguration

```
Window resize event (or user changes scrollback size in config)
    │
    ▼
compute new (rows, cols) from canvas pixel size / cellW / cellH
    │
    ▼
term.resize(rows, cols)                       [may reallocate grid]
    │
    ▼
JS discards old gridView / dirtyView
    │
    ▼
gridView = new Uint8Array(memory.buffer, term.grid_ptr(), term.grid_byte_len())
dirtyView = new Uint8Array(memory.buffer, term.dirty_ptr(), rows)
    │
    ▼
force full-screen repaint
```

## Scaling Considerations

This is a single-user desktop application that talks to one serial port, not a service.
"Scale" here means "can it keep up with the data rates and input patterns the user will
actually throw at it."

| Scale | Behaviour |
|-------|-----------|
| 9600 baud steady (~960 bytes/sec) | Trivial. Parser does maybe 30μs of work per chunk. |
| 115200 baud burst (~11KB/sec peak) | Comfortable. One `feed()` per ~8KB chunk = ~1-2ms total per chunk on mid-range hardware. |
| Long-running session, 1M-line scrollback | VecDeque grows to bounded size then caps. Scrolling is O(1) for index changes; paint is O(visible rows). |
| Window resize | Worst case reallocates grid; full repaint on next frame. One-shot cost. |

### Scaling Priorities

1. **First bottleneck (imagined):** per-frame allocation churn from crossing the wasm
   boundary with JS values. *Fix: zero-copy views, never serialise grid state.*
2. **Second bottleneck (imagined):** `fillText` per cell per frame. *Fix: glyph atlas
   with offscreen canvases.*
3. **Third bottleneck (real, if it arrives):** dirty-row paint when a program clears
   the screen and redraws full content (e.g., `vi` refresh). *Fix: the dirty bitmap
   already handles this — all 24 rows flip to dirty, still only one paint pass.*

Actual profiling required before optimising any further. For 80×24 cells and VT52
content rates, this architecture has orders of magnitude of headroom.

## Anti-Patterns

### Anti-Pattern 1: Decoding Serial as UTF-8 Before Parsing

**What people do:** Wrap `port.readable` in `TextDecoderStream` because strings feel
nicer to work with.
**Why it's wrong:** VT52's cursor-addressing sequence is `ESC Y row+32 col+32` — the
row and column bytes are *not* text. They're 7-bit values encoded as bytes in the
range 0x20–0x7F. `TextDecoderStream` will happily mangle any byte that doesn't look
like ASCII/UTF-8. Even for all-ASCII content, introducing a string layer loses byte
boundaries and makes the logger lie about what hit the wire.
**Do this instead:** Keep the stream as bytes end-to-end. `reader.read()` returns
`Uint8Array`. Pass bytes to wasm. Log bytes. Decode to text only at the renderer, where
you're already per-cell.

### Anti-Pattern 2: Copying Grid State Across the Wasm Boundary Every Frame

**What people do:** Define a `get_grid()` function that returns `Vec<Cell>` (or worse,
a serde-serialised JSON blob), call it every `rAF`, iterate the resulting JS array.
**Why it's wrong:** 80×24×8 bytes = 15KB. At 60fps, that's ~900KB/sec of allocation
and garbage collection pressure for data that hasn't changed. On a slow laptop this
alone can drop you to 30fps.
**Do this instead:** Expose a stable pointer (`grid_ptr()`) and read a `Uint8Array`
view directly over wasm memory. Zero allocation per frame. Only re-derive the view
after `resize()` / reconfig.

### Anti-Pattern 3: Rust-Side Rendering Plans

**What people do:** Build a "render description" struct in Rust — a list of
`(row, col, glyph, style)` tuples — and pass it to JS per frame "because the Rust
side already knows what changed."
**Why it's wrong:** That's the grid plus overhead. The dirty bitmap + cell buffer
already tells you exactly what changed at zero marshalling cost. A render description
is a second representation of the same information.
**Do this instead:** Rust marks dirty rows; JS diffs what it wants to paint (usually
"paint the whole row"). Keep Rust in the pure-logic lane; rendering decisions are JS's.

### Anti-Pattern 4: Letting DOM Events Reach Rust

**What people do:** Pass the `KeyboardEvent` or wrap parts of it via
`serde_wasm_bindgen` into a struct on the Rust side.
**Why it's wrong:** Drags browser details into Rust. Breaks unit-testability (Rust
tests can't synthesise `KeyboardEvent`). Couples key encoding to whatever shape the DOM
event has this year.
**Do this instead:** JS extracts exactly the four values we care about
(`key` as a keycode int, `ctrl`, `alt`, `shift` packed as bits). Rust `KeyEvent` is a
plain struct of primitives, trivially constructible in tests.

### Anti-Pattern 5: Web Serial Config in Rust

**What people do:** Put baud / parity / stop-bits in a Rust config struct and pass it
down.
**Why it's wrong:** Only JS calls `port.open({ baudRate, ... })`. Rust has no reason
to know the serial parameters. Bringing them across the wasm boundary is ceremony.
**Do this instead:** Serial config lives in JS config state (`localStorage`), passed
directly to `port.open()`. Rust never sees it.

### Anti-Pattern 6: Holding the Reader Lock Forever

**What people do:** Acquire `port.readable.getReader()` at startup, loop on `read()`
until forever.
**Why it's wrong:** You can't close the port, change baud, or reconnect on disconnect
while the lock is held. Disconnect events leave the loop in an awkward state.
**Do this instead:** The reader loop is wrapped in try/finally that calls
`reader.releaseLock()` on error/done. Top-level `disconnect` event triggers
re-acquisition once reconnected. Any config change tears the loop down and restarts.

## Build Order Implications

This is the single most useful thing to get right for a greenfield phased build.
Each phase produces something testable on its own; each depends only on what came
before.

### Phase 1: Rust Parser + Terminal (No Browser At All)

**What's built:** `vte::Parser` + `Terminal: Perform` + `Grid` + `KeyEncoder`. Compiled
as a regular Rust library. Unit tests in Rust covering the parser state machine
(already handled by vte — just verify our `Perform` implementation), the VT52 opcode
table, the grid mutation rules, and key encoding.

**How to verify:** Pure `cargo test`. A test fixture reads a byte stream from a
fixture file ("feed `b"hello\x1B[Aworld"`, assert grid state matches expected"). Key
encoding tests are pure `fn encode(key) -> Vec<u8>`.

**Why first:** This is the only piece that has zero external dependencies — no
browser, no serial, no canvas. It's also where correctness is hardest to get right, so
it deserves the most attention and the tightest feedback loop.

### Phase 2: Wasm Build + Tiny JS Harness

**What's built:** `wasm-pack build --target web` produces `pkg/`. A minimal
`harness.html` loads wasm, calls `feed(bytes)` from a button, dumps the grid as
text via a debug method.

**How to verify:** Load page, paste bytes, see ASCII-art grid render in a `<pre>` tag.
No canvas yet. No Web Serial yet.

**Why second:** Confirms the boundary works end-to-end with real wasm before committing
to rendering. Shakes out build / deploy / `--target web` issues while the surface is
still tiny.

### Phase 3: Canvas Renderer Over the Wasm Grid

**What's built:** `renderer/canvas.js`, `renderer/atlas.js`, theme descriptors. `rAF`
loop reads `dirtyView` / `gridView` and paints. A "fake input" button feeds a canned
stream of VT52 bytes to drive visual testing.

**How to verify:** Paste a VT52 sequence (from a MicroBeast log or handcrafted), see
it render correctly. Test both themes. Test resize. Test scrollback with a long
feed-in.

**Why third:** Renderer is independent of input and transport; the only dependency is
"there's a grid in wasm I can read." This phase is where you get the satisfying
"oh it actually looks like a terminal" moment, which is motivation fuel for the
remaining phases.

### Phase 4: Keyboard Input → Wasm → Mock Output

**What's built:** `input/keyboard.js`, DOM event handling, `term.encode_key()` wiring.
Rather than sending bytes to a serial port (no port yet), bytes go to a `<pre>` panel
or are echoed back into `term.feed()` (local echo mode — great for development and
coincidentally required for testing).

**How to verify:** Type in the terminal, see characters echoed, arrow keys produce
`ESC A/B/C/D`, Ctrl combos produce the right control bytes. All testable without any
hardware.

**Why fourth:** Independent of Web Serial. Adding Web Serial on top is now just
"replace the mock output with a real writer."

### Phase 5: Web Serial Transport

**What's built:** `serial.js`: port picker, `port.open()`, reader loop with
`reader.read()` → `term.feed()`, writer for `term.encode_key()` output, disconnect /
reconnect handling. Serial config UI.

**How to verify:** Plug in a real MicroBeast (or any serial echo device, or a second
computer running `minicom`). Connect, type, see output.

**Why fifth:** Every piece before this was independently verifiable. By the time
Web Serial lands, the only new thing being tested is the transport itself —
isolation when something breaks.

### Phase 6: Polish Features

**What's built:** Session logging (tee in the reader loop). Copy/paste (selection
state in JS, read grid cells on copy, feed on paste). Scrollback UI (scroll wheel,
shift-up/down). Chromium detection + polite fail message. Persisted config.

**How to verify:** Manual end-to-end use with the MicroBeast. This is the "daily
driver" validation phase.

**Why last:** Each of these is additive and independent. Any can be cut or deferred
without breaking the core.

### Where Each v1 Feature Plugs In

| v1 Feature | Phase | Component |
|------------|-------|-----------|
| VT52 parsing | 1 | `Terminal: Perform` in Rust |
| Key encoding | 1 | `KeyEncoder` in Rust |
| Rust unit tests | 1 | `cargo test` in Rust crate |
| Canvas rendering | 3 | `renderer/canvas.js` |
| Two themes (CRT / modern) | 3 | `renderer/themes.js` |
| Keyboard input | 4 | `input/keyboard.js` |
| Web Serial transport | 5 | `serial.js` |
| Serial config override | 5 | `config.js` + serial open call |
| Session logging | 6 | `logging.js` (tee in reader loop) |
| Copy/paste | 6 | `input/clipboard.js` (reads grid view; feeds paste via key encoder) |
| Scrollback | 6 | Extends Grid in Rust; scroll UI in JS; already structural from phase 1 |
| Chromium-only fail | 6 | Feature-detect `navigator.serial` on boot |
| Static deploy | 6 | `scripts/build.sh`; `www/` → GitHub Pages |

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Web Serial API (`navigator.serial`) | Feature-detect on boot; request port via user gesture; hold port instance in JS module scope | Chromium-only. No polyfill. Disconnect = `SerialPort.ondisconnect`. |
| File download (session log) | Construct `Blob` from accumulated chunks; `URL.createObjectURL` + temp `<a download>` click | No server. Pure browser. |
| Clipboard (copy/paste) | `navigator.clipboard.writeText` / `readText` (latter may need user gesture) | Paste triggers synthesised text input fed through `encode_key()`. |
| `localStorage` (config) | Read on boot, write on config change | Small payload (serial params, theme, scrollback size). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| JS `SerialIO` ↔ JS `SessionLogger` | Direct function call (`logger.append(chunk)`) in reader loop | Tee point. |
| JS `SerialIO` ↔ Rust `Terminal` | `term.feed(bytes)` via wasm-bindgen | Hot path. Chunk marshalling. |
| Rust `Terminal` ↔ Rust `Grid` | Direct struct field access | Single-crate internals. |
| JS `Renderer` ↔ Rust state | Zero-copy `Uint8Array` views over wasm memory | Hot path. Re-derived on resize. |
| JS `KeyInput` ↔ Rust `KeyEncoder` | `term.encode_key(code, mods)` returns `Uint8Array` | Cold path (~10 calls/sec). |
| JS `KeyInput` ↔ JS `SerialIO` | `port.writable.getWriter().write(bytes)` | Cold path. |
| JS `ClipboardBridge` ↔ Rust state | Reads grid view to produce text; calls `encode_key()` repeatedly for paste | Paste feeds through the normal input path. |
| JS `Config` ↔ JS `SerialIO` | Passes `{ baudRate, dataBits, ... }` to `port.open()` | Rust never sees this. |

## Sources

- [vte crate docs (Alacritty) — Perform trait](https://docs.rs/vte/latest/vte/trait.Perform.html) — HIGH
- [vte crate on crates.io](https://crates.io/crates/vte) — HIGH
- [Alacritty Grid docs](https://docs.rs/alacritty_terminal/latest/alacritty_terminal/grid/struct.Grid.html) — HIGH
- [Joe Wilm on Alacritty scrollback (VecDeque)](https://jwilm.io/blog/alacritty-lands-scrollback/) — HIGH
- [Alacritty scrollback PR #657](https://github.com/alacritty/alacritty/pull/657) — HIGH
- [wasm-bindgen guide — without-a-bundler](https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html) — HIGH
- [wasm-bindgen guide (full)](https://rustwasm.github.io/docs/wasm-bindgen/) — HIGH
- [js-sys Uint8Array::view (zero-copy into wasm memory)](https://docs.rs/js-sys/latest/js_sys/struct.Uint8Array.html) — HIGH
- [wasm-bindgen issue #2741 — minimizing copying](https://github.com/rustwasm/wasm-bindgen/issues/2741) — MEDIUM
- [A practical guide to WebAssembly memory (Radu Matei)](https://radu-matei.com/blog/practical-guide-to-wasm-memory/) — MEDIUM
- [Web Serial API spec (WICG)](https://wicg.github.io/serial/) — HIGH
- [Chrome Developers — Read/write to a serial port](https://developer.chrome.com/docs/capabilities/serial) — HIGH
- [MDN — SerialPort.readable](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/readable) — HIGH
- [MDN — ReadableStream.getReader](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/getReader) — HIGH
- [VT52 DECscope Maintenance Manual — Chapter 1](https://vt100.net/docs/vt52-mm/chapter1.html) — HIGH
- [VT52 on Wikipedia](https://en.wikipedia.org/wiki/VT52) — MEDIUM
- [xterm.js architecture overview (DeepWiki)](https://deepwiki.com/xtermjs/xterm.js/1-overview) — MEDIUM
- [VS Code Terminal canvas renderer perf writeup](https://code.visualstudio.com/blogs/2017/10/03/terminal-renderer) — HIGH
- [Warp — Kerning and Glyph Atlases](https://www.warp.dev/blog/adventures-text-rendering-kerning-glyph-atlases) — MEDIUM
- [Windows Terminal Atlas Engine (DeepWiki)](https://deepwiki.com/microsoft/terminal/3.2-atlas-engine) — MEDIUM
- [Mirko Sertic — tuning HTML5 Canvas fillText](https://www.mirkosertic.de/blog/2015/03/tuning-html5-canvas-filltext/) — MEDIUM

---
*Architecture research for: in-browser VT52 terminal emulator (Rust/wasm + JS + Canvas + Web Serial)*
*Researched: 2026-04-21*
