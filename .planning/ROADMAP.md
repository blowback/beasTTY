# Roadmap: BestialiTTY

## Overview

BestialiTTY is built bottom-up in six phases that mirror the Rust/wasm + JS-shell
architectural split. Correctness lives in the Rust core (Phase 1) where pure
`cargo test` feedback is fastest and the highest-risk bugs (torn-chunk parsing,
ESC Y +32 offset, wasm-boundary shape) live. The boundary itself is validated
with a tiny JS harness (Phase 2) before investing in rendering. Canvas
rendering (Phase 3) delivers the first visual terminal. Keyboard input (Phase 4)
closes the loop for local-echo testing without hardware. Web Serial transport
(Phase 5) is last because everything else can be verified without a MicroBeast
on the desk. Phase 6 turns it into a daily driver: copy/paste, scrollback UI,
session log, persistent preferences, static deployment, and a 24-hour soak.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Rust Core — Parser, Grid, Key Encoder** - Pure-Rust VT52 parser, terminal state, scrollback ring, and key encoder, all verified by `cargo test`; includes the parser-strategy spike and live MicroBeast byte capture
- [ ] **Phase 2: Wasm Boundary & Minimal JS Harness** - `wasm-pack --target web` build pipeline and a minimal JS harness that validates zero-copy, batched byte-feed boundary end-to-end
- [ ] **Phase 3: Canvas Renderer** - HiDPI canvas renderer with glyph atlas, dirty-row repaint, CRT and clean themes, visible cursor and focus, visible-bell flash
- [ ] **Phase 4: Keyboard Input** - DOM keydown capture mapping PC keyboard to VT52 bytes, local-echo mode, CR/LF override toggle, browser-shortcut handling
- [ ] **Phase 5: Web Serial Transport** - Chromium detection, port picker, cancellation-safe read loop, DTR/RTS-safe connect, auto-reconnect, paste throttling
- [ ] **Phase 6: Daily-Driver Polish, Session & Deployment** - Copy/paste, scrollback UI, session log download, persistent preferences, static deploy under permissive license, 24-hour soak

## Phase Details

### Phase 1: Rust Core — Parser, Grid, Key Encoder
**Goal**: A standalone Rust crate that correctly parses the MicroBeast's pragmatic VT52 subset, maintains an 80×24 grid with capped scrollback, and encodes PC-keyboard input to VT52 bytes — all provable via `cargo test` with zero browser involvement.
**Depends on**: Nothing (first phase)
**Requirements**: PARSER-01, PARSER-02, PARSER-03, PARSER-04, PARSER-05, PARSER-06, PARSER-07, PARSER-08, CORE-01, CORE-02
**Success Criteria** (what must be TRUE):
  1. Given a captured MicroBeast session log as raw bytes, `cargo test` proves the Rust parser produces the expected sequence of terminal-ops (cursor moves, prints, erases, BEL, identify-response)
  2. Every multi-byte VT52 sequence (ESC Y + row + col, ESC Z query) has a torn-chunk test that splits it at every internal offset and asserts identical grid state to the unsplit feed
  3. The parser-strategy decision (hand-rolled DFA vs `vte` crate) is resolved by a committed, dated ADR in the repo with a working implementation of the chosen approach
  4. A live MicroBeast capture session is recorded under `.planning/research/captures/` and its byte inventory drives which VT52 sequences the parser handles, silently no-ops (ESC F/G/=/>), or intentionally leaves alone; CR/LF convention is documented from observed behaviour
  5. The core crate has zero dependencies on `web-sys`, `js-sys::Serial*`, or any browser API — `cargo build --target x86_64-unknown-linux-gnu` and `cargo test` both succeed
**Plans**: 7 plans
  - [x] 01-01-PLAN.md — Cargo workspace + bestialitty-core crate skeleton + captures/decisions dirs (Wave 0)
  - [x] 01-02-PLAN.md — Live MicroBeast byte capture (CP/M + BASIC) or D-08 deferral (Wave 1)
  - [x] 01-03-PLAN.md — Parser-strategy spike (hand-rolled vs vte) + ADR-001 (Wave 1)
  - [x] 01-04-PLAN.md — Grid + Scrollback ring + Dirty bitmap data-layer (Wave 2)
  - [x] 01-05-PLAN.md — Production parser + Terminal + 8 fixture tests; spike removed (Wave 3)
  - [x] 01-06-PLAN.md — PC-keyboard to VT52 byte encoder (Wave 2)
  - [x] 01-07-PLAN.md — CORE-02 automated test + boundary API shape lock + fmt/clippy hygiene (Wave 4)

### Phase 2: Wasm Boundary & Minimal JS Harness
**Goal**: Prove the Rust↔JS interop shape end-to-end with the smallest possible JS surface area — batched `feed(bytes)`, zero-copy `Uint8Array` views over wasm linear memory, and a `wasm-pack --target web` build that a static site can consume directly.
**Depends on**: Phase 1
**Requirements**: CORE-03, CORE-04, CORE-05
**Success Criteria** (what must be TRUE):
  1. Running `wasm-pack build --target web` produces a `pkg/` directory that a plain HTML file loads via ES module import without a bundler step
  2. A debug harness page accepts a paste of raw VT52 bytes, calls `term.feed(bytes)` once per chunk, and renders the resulting grid as ASCII in a `<pre>` — no canvas, no Web Serial, no per-byte boundary calls
  3. The grid and dirty-row bitmap are read from JS via `new Uint8Array(wasm.memory.buffer, ptr, len)` with no allocation per frame and no JSON serialisation across the boundary
  4. Author can demonstrate in DevTools that a 64 KB byte feed crosses the boundary in a single `feed()` call, not 65,536 calls
**Plans**: 6 plans
  - [x] 02-01-PLAN.md — wasm32 toolchain + target-specific wasm-bindgen dep + CORE-02 test update + ADR-002 (Wave 1)
  - [x] 02-02-PLAN.md — pack_buf + snapshot_grid on Terminal + u32 unpackers on key.rs + native unit tests (Wave 2)
  - [x] 02-03-PLAN.md — lib.rs wasm-bindgen facade + extended boundary_api_shape.rs + wasm-pack smoke (Wave 3)
  - [x] 02-04-PLAN.md — scripts/build.sh + www/index.html + www/main.js + .gitignore rules (Wave 4)
  - [x] 02-05-PLAN.md — scripts/smoke-wasm-build.sh + www/README.md + SC-1..SC-4 checkpoint demo (Wave 5)
  - [x] 02-06-PLAN.md — SC-3 gap closure: Terminal::feed_silent + host_reply zero-copy accessors + cached views; SC-3 wording amendment (Wave 6, gap_closure)

### Phase 3: Canvas Renderer
**Goal**: A visually correct, crisp-on-HiDPI canvas terminal with both CRT and clean themes, a visible block cursor, theme-toggleable styling, font-size zoom, and visible-bell flash — driven off the Phase 2 grid view with dirty-row repainting.
**Depends on**: Phase 2
**Requirements**: RENDER-01, RENDER-02, RENDER-03, RENDER-04, RENDER-05, RENDER-06, RENDER-07, RENDER-08, RENDER-09, RENDER-10, RENDER-11, RENDER-12
**Success Criteria** (what must be TRUE):
  1. A canned VT52 byte stream (drawn from the Phase 1 capture) feeds into wasm and renders on an 80×24 canvas grid with a visible block cursor, readable on a Retina display with no blur and no font-fallback flash on first paint
  2. Author can toggle between CRT (bitmap pixel font, phosphor colour, optional scanlines/glow) and clean (JetBrains Mono, minimal chrome) themes via both a UI control and a keyboard shortcut; each theme defines its own cursor styling
  3. Phosphor colour (green / amber / white) is user-selectable in the CRT theme, and font size zoom via Ctrl +/− / Ctrl 0 scales the bitmap font by integer multipliers
  4. A BEL byte (0x07) in the input stream causes a ~100ms screen flash and a `(!)` prefix on the document title when the tab is backgrounded
  5. Focus state on the canvas is visibly distinct from unfocused state (border or cursor-style change), and resizing the window or dragging the browser between monitors of different DPR does not produce blur
**Plans**: 7 plans
  - [x] 03-01-PLAN.md — Assets foundation: hand-drawn 8×16 bitmap font + JetBrains Mono WOFF2 + OFL licence + Playwright bootstrap + VT52 fixture (Wave 1)
  - [x] 03-02-PLAN.md — Renderer core: themes.js descriptors + atlas.js glyph cache + canvas.js rAF loop + HiDPI + cursor overdraw + DPR watcher (Wave 2)
  - [x] 03-03-PLAN.md — Chrome wiring: index.html canvas-first DOM + chrome.js event wiring + main.js retrofit + Phase 3 README (Wave 3)
  - [x] 03-04-PLAN.md — Verification: 9 Playwright specs covering RENDER-01..RENDER-12 + visual-regression baseline + human UAT checkpoint (Wave 4)
  - [x] 03-05-PLAN.md — Gap closure: renderer-correctness fixes for UAT gaps 1/2/3/5/6/8 + WR-03/04/05 (wall-clock blink, snapshot-first tick, markAllRowsDirty, rasteriseBitmap scale) (Wave 1, gap_closure)
  - [x] 03-06-PLAN.md — Gap closure: keyboard-chord remap (Test 6) + focus-border visibility (Test 10)
  - [ ] 03-07-PLAN.md — Gap closure: regression specs covering every 03-05 + 03-06 fix; un-fixme grid.spec.js
**UI hint**: yes

### Phase 4: Keyboard Input
**Goal**: Map PC browser keydown events to correct VT52 byte sequences end-to-end, with local-echo and CR/LF override toggles for testing and edge-case MicroBeast software — all demonstrable without any serial hardware attached.
**Depends on**: Phase 3
**Requirements**: INPUT-01, INPUT-02, INPUT-03, INPUT-04, INPUT-05
**Success Criteria** (what must be TRUE):
  1. With local-echo enabled, typing on the canvas shows printable characters on screen; pressing each arrow key transmits exactly ESC A / B / C / D (verifiable in a TX-byte debug view)
  2. Ctrl-letter combinations transmit the correct 0x00–0x1F control byte; Ctrl-W / Ctrl-N / Ctrl-T are documented as browser-reserved with a user-visible note, and `preventDefault()` recaptures every forwarded key
  3. A local-echo toggle (default off) is exposed in the UI; flipping it changes whether typed characters appear on screen before any serial connection exists
  4. A CR/LF override toggle (LF implies CR) is exposed in the UI and correctly alters newline behaviour against the Phase 1 MicroBeast capture
  5. Canvas holds focus after clicking any toolbar button; IME composition does not double-emit characters
**Plans**: TBD
**UI hint**: yes

### Phase 5: Web Serial Transport
**Goal**: Connect to a real MicroBeast over Web Serial with sane defaults, survive unplug/replug cleanly, restore the previously-granted port on reload, and expose full serial-config overrides — with byte-safe end-to-end transport and no TextDecoder anywhere on the read path.
**Depends on**: Phase 4
**Requirements**: XPORT-01, XPORT-02, XPORT-03, XPORT-04, XPORT-05, XPORT-06, XPORT-07, XPORT-08, XPORT-09, XPORT-10, XPORT-11, PLAT-01, PLAT-02
**Success Criteria** (what must be TRUE):
  1. On a Chromium browser, author clicks Connect (MicroBeast preset pre-selected: 19200 8N1, no flow control, verified against Phase 1 capture), picks the MicroBeast port, and sees live MicroBeast output render on the canvas; typing in the terminal reaches the MicroBeast
  2. A colour-coded status indicator shows connected / disconnected / port-lost states in real time; a single Connect/Disconnect button with a stateful label handles both directions
  3. Unplugging the MicroBeast exits the read loop cleanly (via `reader.cancel()` before `port.close()`), surfaces port-lost in the UI, and replugging the same device auto-reconnects without a permission prompt (VID/PID matched); reload restores the previously-granted port via `navigator.serial.getPorts()`
  4. The serial-config UI exposes baud / data bits / stop bits / parity / flow-control overrides; pasting a large block of text into the terminal is rate-limited to serial line speed (no silent MicroBeast input-buffer overrun at 19200 baud)
  5. Loading the app in Firefox or Safari shows a polite "use a Chromium-based browser" message with no console errors and no crash; the read loop is a pure async `while(true) { await reader.read() }` that survives background-tab throttling without losing serial data
**Plans**: TBD
**UI hint**: yes

### Phase 6: Daily-Driver Polish, Session & Deployment
**Goal**: Turn the working terminal into a daily driver — copy/paste, scrollback UI, session logging with download, persistent preferences in `localStorage`, static-site deployment under a permissive license, and a 24-hour soak test confirming memory and reliability.
**Depends on**: Phase 5
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06, PREF-01, PREF-02, PLAT-03, PLAT-04, PLAT-05
**Success Criteria** (what must be TRUE):
  1. Author can select text on the canvas and copy it to the clipboard; pasting text into the terminal injects it into the serial stream at the Phase 5 rate limit; a local "clear screen" button wipes visible screen (distinct from remote ESC J) with an option to also clear scrollback
  2. Scrollback retains at least 10,000 lines of prior output, stays flat on memory across a 24-hour soak, and the viewport "sticks to bottom" while new output arrives unless the user has scrolled up
  3. Session logging auto-starts per connection to a raw byte buffer; author can download the current log mid-session without disconnecting, and again on disconnect
  4. Theme, phosphor colour, font size, last-used serial config, local-echo toggle, and CR/LF override toggle all persist across browser reloads via `localStorage`; first-open with no saved state loads sane defaults (MicroBeast preset pre-selected, one click to connect)
  5. The built app deploys as a static site to a self-hosted target (GitHub Pages / Cloudflare Pages / own domain), the public repo carries an MIT or Apache-2.0 LICENSE file, and author uses BestialiTTY as the only terminal for a full MicroBeast work session without reaching for anything else
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Rust Core — Parser, Grid, Key Encoder | 7/7 | Complete    | 2026-04-21 |
| 2. Wasm Boundary & Minimal JS Harness | 6/6 | Complete    | 2026-04-22 |
| 3. Canvas Renderer | 6/7 | Executing (gap closure 03-05, 03-06 done; 03-07 pending) | - |
| 4. Keyboard Input | 0/TBD | Not started | - |
| 5. Web Serial Transport | 0/TBD | Not started | - |
| 6. Daily-Driver Polish, Session & Deployment | 0/TBD | Not started | - |

---
*Roadmap created: 2026-04-21*
*Coverage: 54/54 v1 requirements mapped*
