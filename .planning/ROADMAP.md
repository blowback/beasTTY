# Roadmap: Beastty

## Overview

Beastty is built bottom-up in six phases that mirror the Rust/wasm + JS-shell
architectural split. Correctness lives in the Rust core (Phase 1) where pure
`cargo test` feedback is fastest and the highest-risk bugs (torn-chunk parsing,
ESC Y +32 offset, wasm-boundary shape) live. The boundary itself is validated
with a tiny JS harness (Phase 2) before investing in rendering. Canvas
rendering (Phase 3) delivers the first visual terminal. Keyboard input (Phase 4)
closes the loop for local-echo testing without hardware. Web Serial transport
(Phase 5) is last because everything else can be verified without a MicroBeast
on the desk. Phase 6 turns it into a daily driver: copy/paste, scrollback UI,
session log, persistent preferences, static deployment, and a 24-hour soak.

The v1.1 FileTransfer milestone (Phases 7–12) adds the SLIDE protocol on top of
the v1.0 substrate. Phases 7–8 land the Rust state machine + wasm boundary +
JS dispatcher + ESC^ wakeup. Phase 9 delivers host-initiated send (PC → Z80)
end-to-end. Phase 10 delivers Z80-initiated receive + cancellation. Phase 11
wires the JS bridge — chip UI, prefs, session-log pause, port-lost, paste-pump
gating. Phase 12 closes the milestone with UX polish, docs, and real-hardware
UAT against the patched slide.asm. The v1.0 phases (1–6) shipped and are
preserved for project history.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Rust Core — Parser, Grid, Key Encoder** - Pure-Rust VT52 parser, terminal state, scrollback ring, and key encoder, all verified by `cargo test`; includes the parser-strategy spike and live MicroBeast byte capture
- [x] **Phase 2: Wasm Boundary & Minimal JS Harness** - `wasm-pack --target web` build pipeline and a minimal JS harness that validates zero-copy, batched byte-feed boundary end-to-end
- [x] **Phase 3: Canvas Renderer** - HiDPI canvas renderer with glyph atlas, dirty-row repaint, CRT and clean themes, visible cursor and focus, visible-bell flash
- [ ] **Phase 4: Keyboard Input** - DOM keydown capture mapping PC keyboard to VT52 bytes, local-echo mode, CR/LF override toggle, browser-shortcut handling
- [ ] **Phase 5: Web Serial Transport** - Chromium detection, port picker, cancellation-safe read loop, DTR/RTS-safe connect, auto-reconnect, paste throttling
- [x] **Phase 6: Daily-Driver Polish, Session & Deployment** - Copy/paste, scrollback UI, session log download, persistent preferences, static deploy under permissive license, 24-hour soak (completed 2026-04-25)
- [x] **Phase 7: SLIDE Rust Core — Framer, CRC, State Machine** - Pure-Rust SLIDE state machine in a new `slide/` module: byte-fed framer, CRC-16-CCITT exact-match, sliding-window send/recv handshakes; all verified by native `cargo test` (completed 2026-05-06)
- [ ] **Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup** - `Slide` wasm-bindgen exports sibling to `Terminal`; JS dispatcher routes Web Serial chunks to terminal parser OR SLIDE state machine; 7-byte wakeup detected across chunk boundaries; TX writer ownership handoff
- [ ] **Phase 9: SLIDE Sender — Host → Z80 Send** - File picker + drag-drop + auto-typed `B:SLIDE R` command; CP/M filename uppercase + 8.3 truncation + character-set validation; sender-side sliding-window TX with `writer.ready` discipline
- [x] **Phase 10: SLIDE Receiver & Cancellation** - Z80 → PC end-to-end receive: per-file Chrome download (anchor-click + `showDirectoryPicker` opt-in), zero-byte/sub-frame/binary edge cases, memory-bounded chunked reassembly; CTRL_CAN cancel protocol with neutral-wire post-cancel handshake; idempotent re-entrant wakeup handling (completed 2026-05-08)
- [x] **Phase 11: SLIDE JS Bridge & v1.0 Integration** - Floating SLIDE chip (file count, percent, bytes, throughput, post-cancel summary); Settings auto-send command pref; session-log pause; paste-pump gate; visibilitychange + port-lost teardown; auto-type echo swallow + Z80-no-respond fallback chip
- [ ] **Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT** - Filename collision auto-rename UX, drag-drop vs pointer-select isolation regression, auto-send command safety validation, `docs/SLIDE_Z80_REQUIREMENT.md` + README updates, `docs/SLIDE-UAT.md` end-to-end checklist against patched MicroBeast

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
  - [x] 01-01-PLAN.md — Cargo workspace + beastty-core crate skeleton + captures/decisions dirs (Wave 0)
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
  - [x] 03-07-PLAN.md — Gap closure: regression specs covering every 03-05 + 03-06 fix; un-fixme grid.spec.js; Rule 1 auto-fix for visible cursor blink
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
**Plans**: 4 plans
  - [x] 04-01-PLAN.md — Wave 0 scaffolding: 8 Playwright stub specs + testMatch extension + `window.__testGridView` harness (Wave 1)
  - [x] 04-02-PLAN.md — Core keyboard wiring: www/input/keyboard.js + tx-sink.js + wireKeyboard call site in main.js (Wave 2)
  - [x] 04-03-PLAN.md — Settings pane DOM + Debug TX strip + chrome.js mousedown preventDefault + main.js control wiring (Wave 3)
  - [x] 04-04-PLAN.md — Fill Playwright stubs with real assertions + manual UAT checkpoint for IME + AltGraph + daily-driver feel (Wave 4)
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
**Plans**: 9 plans
  - [x] 05-01-PLAN.md — Wave 0 scaffolding: Playwright navigator.serial mock + 7 spec stubs + testMatch extension + 05-HUMAN-UAT.md skeleton (Wave 0)
  - [x] 05-02-PLAN.md — Polite-fail gate first-line + Connection pane DOM + Connect button CSS + serial.js / paste-pump.js module skeletons (Wave 1)
  - [x] 05-03-PLAN.md — Core transport: requestPort + port.open + DTR/RTS safe defaults + pure-async read loop + cancel-before-close teardown + tx-sink writer coupling (Wave 2)
  - [x] 05-04-PLAN.md — Serial-config form wiring (baud / data bits / stop bits / parity / flow control + Reset to preset) (Wave 3)
  - [x] 05-05-PLAN.md — Auto-reconnect state machine + navigator.serial event listeners + error log ring-of-5 + VID/PID localStorage persistence (Wave 4)
  - [x] 05-06-PLAN.md — Paste pump setTimeout chain + CR/LF rewrite + Esc-cancel + progress observer + Paste test button (Wave 5)
  - [x] 05-07-PLAN.md — beforeunload handler + visibilitychange catch-up + remaining specs + 05-HUMAN-UAT.md checkpoint (Wave 6)
  - [x] 05-08-PLAN.md — Gap 1 closure: beforeunload close-contract (release reader+writer locks before port.close + shuttingDown guard + lifecycle.spec.js) (Wave 7, gap_closure)
  - [x] 05-09-PLAN.md — Gap 2 closure: paste-progress relocated from Connection pane to #top-bar + D-17 amended + UI-SPEC auto-expand rules table amended (Wave 7, gap_closure)
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
  5. The built app deploys as a static site to a self-hosted target (GitHub Pages / Cloudflare Pages / own domain), the public repo carries an MIT or Apache-2.0 LICENSE file, and author uses Beastty as the only terminal for a full MicroBeast work session without reaching for anything else
**Plans**: 9 plans
  - [x] 06-01-PLAN.md — Wave 0 test scaffolding: 7 Playwright session/ stubs + clipboard mock + 2 Rust integration test stubs + testMatch extension (Wave 0)
  - [x] 06-02-PLAN.md — Rust core APIs: Terminal::snapshot_grid_at(row_offset) + Terminal::clear_visible() + lib.rs wasm forwarders + boundary-shape pin (Wave 1)
  - [x] 06-03-PLAN.md — Scroll-state module: scroll-state.js + canvas tick branching + floating chip + [data-scrolled-back] (Wave 2)
  - [x] 06-04-PLAN.md — Selection + clipboard + keyboard chord intercepts: selection.js + clipboard.js + Ctrl+Shift+C/V + Shift+End/Home/PgUp/PgDn (Wave 3)
  - [x] 06-05-PLAN.md — Session log + Download log button + top-bar Clear button + clear_visible wiring (Wave 4)
  - [x] 06-06-PLAN.md — Prefs versioned blob + Settings rows (Reset prefs / Clear scrollback / Auto connect) + boot reorder + auto-connect path (Wave 5)
  - [x] 06-07-PLAN.md — Deploy artifacts: LICENSE (MIT) + .github/workflows/pages.yml + www/_headers + www/.nojekyll + CSP meta-tag + README docs (Wave 6)
  - [x] 06-08-PLAN.md — 06-SOAK.md (24-h memory protocol) + 06-HUMAN-UAT.md (8 daily-driver tests) (Wave 7)
  - [ ] 06-09-PLAN.md — Gap closure: chrome-buttons blocker fix (snapPreset syncs cached prefs + flushPrefs no longer fires subscribers) (Wave 8, gap_closure)
**UI hint**: yes

### Phase 7: SLIDE Rust Core — Framer, CRC, State Machine
**Goal**: A pure-Rust SLIDE state machine living in a new `slide/` module, byte-fed and torn-chunk safe, with CRC-16-CCITT exact-match against the SLIDE v0.2 spec and the v0.2.1 CAN-bidirectional amendment — all verifiable by native `cargo test` with zero browser involvement and zero `Slide`-specific wasm-bindgen exports yet.
**Depends on**: Phase 6
**Requirements**: SLIDE-01, SLIDE-02, SLIDE-03, SLIDE-04
**Success Criteria** (what must be TRUE):
  1. A new `crates/beastty-core/src/slide/` module compiles and `cargo test` passes against a torn-chunk corpus that splits every SLIDE frame at every internal byte offset (mirrors the Phase 1 vt52 torn-chunk pattern); state machine never returns mid-byte
  2. CRC-16-CCITT reference vector pins exactly: `crc16_ccitt(b"123456789") == 0x29B1`; CRC covers SEQ + LEN_H + LEN_L + PAYLOAD (not SOF, not the CRC bytes); on-wire byte order is big-endian
  3. Byte-for-byte equality with the upstream `slide-rs` reference implementation's `build_frame` output is asserted on a fixed corpus of header / data / control frames
  4. The sliding-window state machine (4 frames × 1024 bytes) handles RDY / ACK / NAK / CAN / FIN / CTRL_FIN per SLIDE v0.2 plus the v0.2.1 CAN-bidirectional amendment; cancellation and idempotent re-entry are exercised in unit tests
  5. The new module has zero browser dependencies — `cargo build --target x86_64-unknown-linux-gnu` and `cargo test` both succeed; the existing `tests/core_02_no_browser_deps.rs` invariant remains green for the whole crate
**Plans**: 5 plans
  - [x] 07-01-PLAN.md — slide/ module skeleton + CRC primitive + lib.rs mod-tree + Cargo.toml D-01 audit (Wave 1)
  - [x] 07-02-PLAN.md — Framer DFA + tests_only.rs fixture pinning + slide_reference_corpus integration tests (Wave 2)
  - [x] 07-03-PLAN.md — Slide struct + SlideState + receiver SM + cancel/force_idle + module-level smokes (Wave 3)
  - [x] 07-04-PLAN.md — Integration tests: torn-chunk corpus + idempotent re-entry + Phase 8 boundary-shape pin (Wave 4)
  - [x] 07-05-PLAN.md — ADR-003 (CAN bidirectional amendment) + std::time hardening of core_02_no_browser_deps (Wave 4)

### Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup
**Goal**: Expose the Phase 7 state machine across the wasm boundary as a `Slide` struct sibling to `Terminal`; route Web Serial chunks to either the terminal parser OR the SLIDE state machine via a JS dispatcher; detect the 7-byte `ESC ^ S L I D E` wakeup robustly across chunk boundaries; hand off TX writer ownership cleanly without breaking Phase 5's writer contract.
**Depends on**: Phase 7
**Requirements**: SLIDE-05, SLIDE-06, SLIDE-17
**Success Criteria** (what must be TRUE):
  1. A new `Slide` wasm-bindgen struct lives in `lib.rs` (alongside `Terminal`) with the `feed_chunk` / outbound zero-copy accessors / state / progress / cancel exports; `wasm-pack --target web` rebuilds without breaking the existing `Terminal` boundary contract
  2. A new `www/transport/slide.js` dispatcher routes inbound Web Serial chunks to terminal parser or SLIDE based on session mode; a single-line edit in `www/transport/serial.js` (`term.feed(value)` → `dispatchInbound(value)`) is the only hot-path change in existing code
  3. The 7-byte wakeup signature `ESC ^ S L I D E` is detected across arbitrary chunk-boundary splits via a single-byte carry flag; spurious `ESC ^` emitted by a benign Z80 program in normal terminal mode does NOT trigger SLIDE entry (test harness drives both cases)
  4. `tx-sink.js` gains a `setWireOwner('slide')` handoff that silently drops `pushTxBytes` keystroke writes during an active session; SLIDE writes via a separate `writeSlideFrame` path that bypasses the keystroke ring; unit / Playwright tests prove keystrokes during a session do not corrupt the wire
  5. Detected wakeup transitions Beastty into receive mode: terminal parser is suspended, SLIDE state machine owns the wire, and `dispatchInbound` continues to feed only the bytes after the wakeup signature to the SLIDE state machine
**Plans**: 4 plans
  - [x] 08-01-PLAN.md — Wave 0 scaffolding: slide_wasm_boundary_shape.rs + 3 Playwright stub specs (Wave 1)
  - [x] 08-02-PLAN.md — Slide #[wasm_bindgen] façade in lib.rs + wasm-pack rebuild (Wave 2)
  - [x] 08-03-PLAN.md — slide.js dispatcher + tx-sink owner state + serial.js single-line edit + main.js boot wiring (Wave 3)
  - [x] 08-04-PLAN.md — Fill Wave 0 stubs with real Playwright assertions (SC#2/#3/#4/#5 verification) (Wave 4)

### Phase 9: SLIDE Sender — Host → Z80 Send
**Goal**: Deliver a complete host-initiated send path: user picks files (multi-file input or drag-drop onto the canvas), Beastty auto-types the configured `B:SLIDE R\r` command, then frames + ships the files via the Phase 7 state machine with proper `writer.ready` backpressure discipline. Filenames are auto-uppercased + truncated to CP/M 8.3 and validated for the CP/M character set before any frame leaves the wire.
**Depends on**: Phase 8
**Requirements**: SLIDE-07, SLIDE-08, SLIDE-09, SLIDE-10, SLIDE-13, SLIDE-15, SLIDE-16
**Success Criteria** (what must be TRUE):
  1. User can initiate a send via either a multi-file `<input type="file" multiple>` picker OR by dragging files onto `#terminal-wrapper`; both paths end in the same SLIDE-send entry point with the same file list shape
  2. Drag-over the canvas shows a dashed-border overlay + faint tint + "Drop file(s) to send via SLIDE" message; non-file drags (text/URL) are rejected at `dragenter` via a `dataTransfer.types.includes('Files')` filter and never show the drop overlay
  3. Beastty auto-types the configured command (default `B:SLIDE R\r`) before opening the SLIDE session; an empty configured value disables auto-type so the user can drive `slide.com` manually; the auto-type uses the Phase 5 writer contract with no double-write race
  4. Filenames are uppercased + truncated to CP/M 8.3 in JS before reaching the Rust state machine, with the rewrite surfaced to the user (`my-doc.txt → MY-DOC.TXT`); CP/M-invalid characters (`<>.,;:=?*[]`) are rejected pre-flight with a user-visible error before any frame leaves the wire
  5. Sender-side write loop uses `await writer.ready; writer.write(bytes)` discipline (never `await writer.write`); a sender-mode end-to-end test against a SLIDE-aware mock peer transfers a multi-KB binary file with byte-identical round-trip
**Plans**: 4 plans
  - [x] 09-01-PLAN.md — Rust sender SM + framer build_frame_into + EVT_FILE_COMPLETE/EVT_SESSION_COMPLETE/EVT_RETRANSMIT_NEEDED + boundary-shape pin + tests/slide_sender.rs end-to-end (Wave 1)
  - [x] 09-02-PLAN.md — Wasm façade enter_send_mode/feed_send_chunk + tx-sink writeSlideFrameAwaitable + slide.js dispatcher 'send' branch + sender main-loop drain + EVT_*/STATE_* mirror + OUTBOUND_VIEW_CAP=4128 + main.js boot wiring (Wave 2)
  - [x] 09-03-PLAN.md — file-source.js (NEW) + index.html top-bar [↑ Send file] button + drop overlay + <dialog> modal + ~50 lines CSS + main.js wireFileSource (Wave 3)
  - [x] 09-04-PLAN.md — mock-serial-slide-bot.js (NEW) + slide-sender.spec.js + file-source.spec.js + manual UAT checkpoint (Wave 4)

### Phase 10: SLIDE Receiver & Cancellation
**Goal**: Deliver a complete Z80-initiated receive path: the dispatcher hands off to the receiver, files are reassembled with bounded memory, each completed file lands as a Chrome download, and the user can cancel mid-transfer leaving the wire neutral and recoverable. Cover every edge case (zero-byte, sub-frame, binary, megabyte-scale, idempotent re-entrant wakeup) so the receiver is reliable for daily-driver use.
**Depends on**: Phase 9
**Requirements**: SLIDE-18, SLIDE-19, SLIDE-20, SLIDE-21, SLIDE-22, SLIDE-23, SLIDE-24, SLIDE-27, SLIDE-29, SLIDE-30, SLIDE-34
**Success Criteria** (what must be TRUE):
  1. Each completed file is delivered via a Chrome download (anchor-click pattern); for batches > 1 file an opt-in `showDirectoryPicker` fallback lets the user pick a directory once and saves all subsequent files there without per-file prompts; multi-file batches are staggered with ≥ 250 ms between downloads to avoid Chrome's multi-download throttle
  2. Edge-case files round-trip cleanly: zero-byte files (header → immediate EOF, no data frames), sub-frame files (< 1024 bytes, exactly one data frame + EOF), and binary content (`.COM`, `.HEX`, raw bytes) end-to-end via `Uint8Array` with no text-encoding step; received filenames retain their CP/M 8.3 uppercase form verbatim
  3. Memory stays bounded for 1 MB+ files via `chunks: Uint8Array[]` + a single `new Blob(chunks)` at session end (mirroring the Phase 6 session-log pattern); a 1 MB receive smoke test does not show O(n²) memory churn
  4. The user can cancel mid-transfer via the chip's Cancel button OR the Esc key (slot 2 of 4 in the disambiguation chain); cancel emits CTRL_CAN, settles in-flight writes (Promise.allSettled ≤ 200 ms) → CTRL_CAN → wait ≤ 500 ms for Z80 echo → drain 100 ms → re-arm framer; the wire is left neutral, never via `reader.cancel()` or `port.close()`; post-cancel a "Cancelled — N of M files transferred" chip is shown for 5 s
  5. Hard-fail recovery (CRC retries exhausted, port lost, or wire desync) cleanly resets the state machine and surfaces a chip error with a "Retry" hint; a spurious mid-stream `ESC ^ S L I D E` while a session is active is handled idempotently with a chip warning ("Z80 reset detected; cancelling current transfer") and a clean reset
**Plans**: 5 plans
  - [x] 10-01-PLAN.md — Rust SM payload extraction + EVT_HEADER_RECEIVED/EVT_RECV_DATA/EVT_RECV_FILE_DONE + boundary-shape pin + native recv corpus + 1 MB memory smoke + 6 Playwright RED-gate stubs (Wave 1)
  - [x] 10-02-PLAN.md — Wasm boundary forwards + slide-recv.js skeleton (download dispatch + ~N collision + MAX_FILE_SIZE cap, NO cancel yet) + idb.js + prefs.js DEFAULTS (Wave 2)
  - [x] 10-03-PLAN.md — slide-recv.js cancel state machine (5-step CTRL_CAN sequence + force_idle escape) + slide.js dispatchRecvMode rewrite (event delegation + mid-session ESC^SLIDE matcher) + keyboard.js Esc slot 2 insertion + main.js boot wiring + slidePumpOnPortLost minimum (Wave 3)
  - [x] 10-04-PLAN.md — Settings DOM row + CSS + showDirectoryPicker flow + 4-state runtime swap + boot-time re-permission (Wave 4)
  - [x] 10-05-PLAN.md — Mock-bot sender role + 21+ Playwright tests filling RED-gate stubs + 10-HUMAN-UAT.md + REQUIREMENTS.md flips + human-verify checkpoint (Wave 5)

### Phase 11: SLIDE JS Bridge & v1.0 Integration
**Goal**: Wire SLIDE into the existing v1.0 systems so the milestone feels native: a floating SLIDE chip mirroring the Phase 6 scrollback chip pattern (opposite corner), a Settings row for the auto-send command, session-log pause + paste-pump gating during active sessions, symmetric port-lost teardown, auto-typed-command echo swallowing, and a graceful chip prompt when a Z80 with old slide.com doesn't respond.
**Depends on**: Phase 10
**Requirements**: SLIDE-11, SLIDE-14, SLIDE-25, SLIDE-26, SLIDE-28, SLIDE-31, SLIDE-32, SLIDE-33, SLIDE-35, SLIDE-37, SLIDE-39
**Success Criteria** (what must be TRUE):
  1. A floating SLIDE chip at `bottom: 8px; left: 8px` (opposite corner from the Phase 6 scrollback chip) shows direction + filename + "File N of M" + percent + byte count, with throughput on a 2-second sliding window (showing `—` for the first 2 s); a post-cancel "Cancelled — N of M files transferred" chip auto-hides after 5 s
  2. Drops attempted during an active SLIDE session are rejected with a chip "Transfer in progress — cancel first" rather than corrupting the wire; the auto-typed command's CP/M echo is swallowed for ~500 ms via a swallow-echo filter so the typed command does not double-print
  3. Tab close mid-transfer (`visibilitychange` listener) emits a best-effort CTRL_CAN; the Phase 5 port-lost flow includes a `slidePumpOnPortLost` symmetric to `pastePumpOnPortLost`; the Phase 6 session log is paused during active SLIDE sessions (binary frame bytes do NOT pollute the RX log) and resumes on session end
  4. The user-configurable auto-send command persists in `beastty.prefs.slideAutoSendCommand` (default `B:SLIDE R\r`); a Settings pane row exposes the auto-send command (text input) + a "show transfer summary chip" checkbox + an optional `Compatibility mode` selector for legacy slide.com fallback, following the Phase 6 Settings-row pattern
  5. When auto-type completes but `ESC ^ S L I D E` does not arrive within ~3 s, a chip prompts `[Retry] [Cancel] [Force start (legacy slide.com)]` so users running pre-v0.2.1 slide.com without the wakeup signature can still complete a transfer
**Plans**: 5 plans
  - [x] 11-01-PLAN.md — Wave 0 RED-gate scaffolding: 4 Playwright stub specs + mock-bot setWakeupDelay extension + 3 prefs DEFAULTS keys (Wave 0)
  - [x] 11-02-PLAN.md — Chip module skeleton: www/renderer/slide-chip.js with 8 lifecycle states + chip DOM/CSS in index.html + main.js wireSlideChip boot wiring (Wave 1)
  - [x] 11-03-PLAN.md — Settings SLIDE sub-block + lifecycle wiring: <details> sub-block with 4 rows + slidePumpOnPortLost real impl + 3 serial.js call sites + session-log gate + paste-pump gate + drop-rejected chip flash + auto-send prefs swap + chip lifecycle hooks (Wave 2)
  - [x] 11-04-PLAN.md — Behavior states: echo-swallow.js NEW + dispatchTerminalMode integration + visibilitychange + pagehide CTRL_CAN + Compatibility-mode 3-way branch + chip awaiting-timeout state + Retry/Cancel/Force-start handlers (Wave 3)
  - [x] 11-05-PLAN.md — Wave 4 GREEN gate: fill 4 spec files with real assertions + flip 11 SLIDE-* req IDs Pending → Complete + full suite green (Wave 4)
**UI hint**: yes

### Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT
**Goal**: Close the milestone — handle the residual UX cliffs (filename collisions on send, drag-drop vs pointer-select isolation, auto-send command safety validation), document the Z80-side dependency and the user-facing protocol, and run an end-to-end UAT against a real MicroBeast with the patched `slide.asm`. After this phase, Beastty v1.1 is daily-driver-ready for SLIDE.
**Depends on**: Phase 11
**Requirements**: SLIDE-12, SLIDE-36, SLIDE-38, SLIDE-40, SLIDE-41, SLIDE-42
**Success Criteria** (what must be TRUE):
  1. Drag-drop on `#terminal-wrapper` coexists with the v1.0 pointer-select: `selection.js:onPointerDown` early-returns when the drop overlay is active; a Playwright regression spec proves no ghost selection / inverse-text artefact remains after a drop
  2. Filename collisions on send (case-insensitive + 8.3 truncation producing duplicates like three `REPORT.TXT`s) are detected in JS pre-flight; the user is prompted to auto-rename (`NAME.TXT, NAME~1.TXT, NAME~2.TXT`), refuse the batch, or send only the first colliding file
  3. The auto-send command is validated for safety — alphanumeric + `:` + `\r` only, rejecting `;`, pipes, and non-`\r` control characters; a first-use confirmation chip appears for non-default values to defend against hostile-config injection
  4. `docs/SLIDE_Z80_REQUIREMENT.md` documents the slide.asm `ESC ^ S L I D E` wakeup requirement, the v0.2.1 protocol amendment (PC-initiated CTRL_CAN with Z80 echo), the `B:SLIDE R` command convention, and links to the upstream `github.com/blowback/slide` PR; README.md gains a "File transfer" section and extended "Keyboard shortcuts" coverage of drag-drop and the file-picker
  5. `docs/SLIDE-UAT.md` (mirroring `06-HUMAN-UAT.md`) runs end-to-end against a patched MicroBeast: send a multi-file batch including a binary `.COM`, receive a multi-file batch including a zero-byte file, cancel mid-transfer in both directions, and confirm the wire returns to a clean CP/M prompt every time
**Plans**: 5 plans
  - [ ] 12-01-PLAN.md — SLIDE-12 selection.js drop-overlay early-return + 3-test regression spec (Wave 1)
  - [ ] 12-02-PLAN.md — SLIDE-36 collision detection + computeRenameScheme + modal three-action row + 8-test spec; SLIDE-12 post-drop clearSelection wiring (Wave 1)
  - [ ] 12-03-PLAN.md — SLIDE-38 isAutoSendSafe regex + use-time gate + first-use-confirm chip lifecycle + Settings invalid-state visual + 15-test spec (Wave 2)
  - [ ] 12-04-PLAN.md — SLIDE-40 docs/SLIDE_Z80_REQUIREMENT.md + SLIDE-41 README "File transfer (SLIDE)" section + keyboard shortcuts table extension (Wave 3)
  - [ ] 12-05-PLAN.md — SLIDE-42 docs/SLIDE-UAT.md mirroring 10-HUMAN-UAT.md format with 4 tests; UAT-12-04 inherits blocked-result idiom (Wave 3)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Rust Core — Parser, Grid, Key Encoder | 7/7 | Complete    | 2026-04-21 |
| 2. Wasm Boundary & Minimal JS Harness | 6/6 | Complete    | 2026-04-22 |
| 3. Canvas Renderer | 7/7 | Complete    | 2026-04-22 |
| 4. Keyboard Input | 4/4 | Complete    | 2026-04-22 |
| 5. Web Serial Transport | 7/7 | Complete    | 2026-04-23 |
| 6. Daily-Driver Polish, Session & Deployment | 8/8 | Complete    | 2026-04-25 |
| 7. SLIDE Rust Core — Framer, CRC, State Machine | 4/5 | In progress | - |
| 8. Wasm Boundary, JS Dispatcher & ESC^ Wakeup | 0/TBD | Not started | - |
| 9. SLIDE Sender — Host → Z80 Send | 0/TBD | Not started | - |
| 10. SLIDE Receiver & Cancellation | 5/5 | Complete    | 2026-05-08 |
| 11. SLIDE JS Bridge & v1.0 Integration | 4/5 | In progress | - |
| 12. SLIDE UX Polish, Docs & Real-Hardware UAT | 0/5 | Planned     | - |

---
*Roadmap created: 2026-04-21*
*Coverage v1.0: 54/54 requirements mapped (complete)*
*v1.1 phases appended: 2026-05-06*
*Coverage v1.1: 42/42 SLIDE requirements mapped*
