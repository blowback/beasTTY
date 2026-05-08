# Requirements: BestialiTTY

**Defined:** 2026-04-21
**Core Value:** A modern, reliable, in-browser VT52 emulator good enough to use as a daily driver with a real MicroBeast.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Parser

- [x] **PARSER-01
**: VT52 parser covers the pragmatic subset emitted by the MicroBeast (cursor movement ESC A/B/C/D/H/I, direct addressing ESC Y, erase ESC J/ESC K)
- [x] **PARSER-02
**: ESC Y cursor addressing correctly decodes the +32 (0x20) row/column byte offset
- [x] **PARSER-03
**: Parser handles escape sequences split across serial chunk boundaries without loss
- [x] **PARSER-04
**: ESC F / ESC G / ESC = / ESC > parse as silent no-ops (no screen corruption on unhandled-but-legal sequences)
- [x] **PARSER-05
**: ESC Z identify query returns ESC / K response on the serial line
- [x] **PARSER-06
**: BEL (0x07) triggers a visible-bell signal (screen flash and/or title-bar indicator)
- [x] **PARSER-07
**: Default CR / LF handling matches MicroBeast CP/M convention (verified via live capture in phase 1)
- [x] **PARSER-08
**: Parser and state machine have Rust unit tests covering the MicroBeast subset and torn-chunk edge cases

### Core

- [x] **CORE-01
**: Rust compiled to wasm owns parser, terminal state, and key encoding — pure logic, no I/O, no DOM
- [x] **CORE-02
**: Rust core has zero bindings to Web Serial or other browser I/O APIs
- [x] **CORE-03
**: Rust↔JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`)
- [x] **CORE-04
**: JS shell owns Web Serial I/O, canvas rendering, event loop, and browser state
- [x] **CORE-05
**: Wasm boundary uses batched byte feeds and shared-memory views (no per-byte or per-frame grid copying)

### Rendering

- [x] **RENDER-01
**: Canvas-based monospace rendering at fixed 80×24 grid
- [x] **RENDER-02
**: Visible block cursor
- [x] **RENDER-03
**: Focus indicator on the terminal surface (border or cursor-style change on focus/blur)
- [x] **RENDER-04
**: CRT theme — bitmap-style pixel font, phosphor colour, optional scanlines/glow
- [x] **RENDER-05
**: Clean modern monospace theme — sharp web font, minimal chrome
- [x] **RENDER-06
**: User-toggleable theme switch between CRT and clean
- [x] **RENDER-07
**: Keyboard shortcut to toggle theme (e.g., Ctrl-Shift-T)
- [x] **RENDER-08
**: Phosphor colour choice for CRT theme (green / amber / white)
- [x] **RENDER-09
**: Font size zoom via Ctrl +/- and Ctrl 0, integer multipliers for bitmap font
- [x] **RENDER-10
**: HiDPI / devicePixelRatio rendering without blur on Retina-class displays
- [x] **RENDER-11
**: Visible-bell rendering as screen flash (~100ms) and title-bar indicator on background tabs
- [x] **RENDER-12
**: Per-theme cursor styling (CRT vs clean each define their own)

### Transport

- [x] **XPORT-01
**: Web Serial transport driven entirely from JavaScript (no Rust bindings)
- [x] **XPORT-02
**: Connect / Disconnect button with clear stateful label
- [x] **XPORT-03
**: Visible connection status indicator (connected / disconnected / port lost)
- [x] **XPORT-04
**: MicroBeast preset as the default serial configuration (19200 8N1, no flow control — verify in phase 1 live capture)
- [x] **XPORT-05
**: Serial configuration override UI for baud, data bits, stop bits, parity, flow control
- [x] **XPORT-06
**: Graceful port-disconnect recovery — read loop exits cleanly on `disconnect` event, UI surfaces the state
- [x] **XPORT-07
**: Restore previously-granted port on reload via `navigator.serial.getPorts()` without re-prompting
- [x] **XPORT-08
**: Auto-reconnect on USB re-plug via `connect` / `disconnect` event listeners
- [x] **XPORT-09
**: Paste throttling to serial line rate — prevent silent overrun at 19200 baud with no flow control
- [x] **XPORT-10
**: Disconnect uses `reader.cancel()` before `port.close()` to avoid reader-lock deadlock (WICG/serial#112)
- [x] **XPORT-11
**: Read loop is pure async and decoupled from `requestAnimationFrame` so background-tab throttling does not drop serial data

### Input

- [x] **INPUT-01
**: Standard PC keyboard maps to VT52 key codes (arrows, keypad, control keys)
- [x] **INPUT-02
**: Arrow keys transmit ESC A / ESC B / ESC C / ESC D
- [x] **INPUT-03
**: Ctrl-key combinations transmit correct control bytes (0x00–0x1F) with sensible handling of browser-reserved combos (Ctrl-W, Ctrl-N, Ctrl-T)
- [x] **INPUT-04
**: Local echo toggle, default off (MicroBeast echoes normally)
- [x] **INPUT-05
**: CR / LF override toggle for edge-case MicroBeast software

### Session

- [x] **SESS-01

**: Scrollback buffer retains N lines of prior output for review
- [x] **SESS-02

**: User can select and copy text from the screen to the clipboard
- [x] **SESS-03

**: User can paste clipboard content into the serial stream (subject to paste throttling)
- [x] **SESS-04

**: Session logging captures the serial stream to a downloadable file, auto-started per connection
- [x] **SESS-05

**: Mid-session "download current log" button without disconnecting
- [x] **SESS-06

**: Clear-screen local button (distinct from remote ESC J — wipes visible screen + optionally scrollback)

### Persistence

- [x] **PREF-01

**: Theme, phosphor colour, font size, and last-used serial config persist in `localStorage`
- [x] **PREF-02

**: Local echo and CR/LF override toggle states persist in `localStorage`

### Platform

- [x] **PLAT-01
**: Detect Chromium-based Web Serial support on load
- [x] **PLAT-02
**: Clear "use a Chromium-based browser" message on unsupported browsers — polite fail, no crash
- [x] **PLAT-03
**: Ships as a static site, self-hosted (GitHub Pages / Cloudflare Pages / own domain)
- [x] **PLAT-04
**: Public repo under a permissive license (MIT or Apache-2.0)
- [x] **PLAT-05

**: First-open sane defaults — MicroBeast preset pre-selected; one click to connect

## v1.1 Requirements (FileTransfer milestone)

Browser-side SLIDE protocol — Rust core state machine + JS shell file API + drag-drop.
Architecture, table-stakes, and pitfalls grounded in `.planning/research/{STACK,FEATURES,ARCHITECTURE,PITFALLS,SUMMARY}.md`.

### SLIDE protocol — Rust framer + state machine + wasm boundary

- [x] **SLIDE-01
**: Rust core implements byte-fed SLIDE state machine in a new `slide/` module, exposed via wasm-bindgen `Slide` struct sibling to `Terminal`
- [x] **SLIDE-02
**: Frame parser handles arbitrary Web Serial chunk boundaries (torn-chunk safe across SOF/SEQ/LEN/PAYLOAD/CRC); native `cargo test` torn-chunk corpus green
- [x] **SLIDE-03
**: CRC-16-CCITT matches SLIDE v0.2 spec exactly (poly 0x1021, init 0xFFFF, big-endian on wire, covers SEQ+LEN_H+LEN_L+PAYLOAD); reference vector `crc16_ccitt(b"123456789") == 0x29B1`; byte-for-byte equality with slide-rs `build_frame` fixtures
- [x] **SLIDE-04
**: Sliding-window state machine (4 frames × 1024 bytes) handles RDY / ACK / NAK / CAN / FIN / CTRL_FIN per SLIDE v0.2 plus the v0.2.1 CAN-bidirectional amendment
- [x] **SLIDE-05**: JS dispatcher (`transport/slide.js:dispatchInbound`) routes Web Serial chunks to terminal parser OR SLIDE state machine based on session mode; detects 7-byte wakeup `ESC ^ S L I D E` across chunk boundaries via single-byte carry flag
- [x] **SLIDE-06**: TX writer ownership handoff — `tx-sink.js:setWireOwner('slide')` blocks `pushTxBytes` keystroke writes during active session; SLIDE writes via separate `writeSlideFrame` path that bypasses the keystroke ring

### SLIDE host → Z80 send

- [x] **SLIDE-07**: User can initiate file send via a multi-file picker (`<input type="file" multiple>`)
- [x] **SLIDE-08**: User can initiate file send by drag-and-drop onto `#terminal-wrapper`
- [x] **SLIDE-09**: Drag-over visual feedback shows dashed-border overlay + faint tint + "Drop file(s) to send via SLIDE" message
- [x] **SLIDE-10**: Non-file drags (text/URL) rejected at `dragenter` via `dataTransfer.types.includes('Files')` filter
- [x] **SLIDE-11
**: Drops during an active SLIDE session rejected with chip "Transfer in progress — cancel first"
- [ ] **SLIDE-12**: Drag-drop coexists with v1.0 pointer-select — `selection.js:onPointerDown` early-returns when drop overlay is active
- [x] **SLIDE-13**: BestialiTTY auto-types configured command (default `B:SLIDE R\r`) before opening session; configurable via Settings; empty string disables auto-type
- [x] **SLIDE-14
**: Auto-typed command's CP/M echo is swallowed for ~500 ms via swallow-echo filter so the typed command doesn't double-print in the terminal
- [x] **SLIDE-15**: Filenames auto-uppercased + truncated to CP/M 8.3 in JS before reaching the Rust state machine; chip displays the rewrite (`my-doc.txt → MY-DOC.TXT`)
- [x] **SLIDE-16**: CP/M filename validation rejects characters CP/M doesn't allow (`<>.,;:=?*[]`); error chip surfaces before session opens

### SLIDE Z80 → PC receive

- [x] **SLIDE-17**: BestialiTTY detects 7-byte wakeup `ESC ^ S L I D E` emitted by patched slide.com and enters receive mode
- [x] **SLIDE-18
**: Each completed file delivered via Chrome download (anchor-click); `showDirectoryPicker` opt-in fallback for batches > 1 file (one user gesture saves all subsequent files into the chosen folder)
- [x] **SLIDE-19**: Multi-file batches stagger downloads with ≥ 250 ms inter-file gap to avoid Chrome multi-download throttling
- [x] **SLIDE-20
**: Received files retain their CP/M 8.3 uppercase names verbatim
- [x] **SLIDE-21
**: Empty (zero-byte) files transfer cleanly — header → immediate EOF; no data frames
- [x] **SLIDE-22
**: Sub-frame files (< 1024 bytes) transfer cleanly — single data frame + EOF
- [x] **SLIDE-23
**: Binary content (`.COM`, `.HEX`, raw bytes) round-trips via `Uint8Array` end-to-end with no text-encoding step
- [x] **SLIDE-24
**: Receive memory stays bounded for 1 MB+ files via `chunks: Uint8Array[]` + `new Blob(chunks)` (NOT naive concatenation)

### SLIDE floating chip + cancellation

- [x] **SLIDE-25
**: Floating SLIDE chip at `bottom: 8px; left: 8px` (opposite corner from scrollback chip) shows direction + filename + "File N of M" + percent + byte count
- [x] **SLIDE-26
**: Chip throughput display uses 2-second sliding window; first 2 seconds show `—`
- [x] **SLIDE-27
**: Chip Cancel button emits CTRL_CAN, drains wire, restores parser; Esc key (slot 2 of 4 in the disambiguation chain) is equivalent
- [x] **SLIDE-28
**: Post-cancel chip shows "Cancelled — N of M files transferred" for 5 seconds then auto-hides
- [x] **SLIDE-29
**: Hard-fail recovery — CRC retries exhausted, port lost, or wire desync → chip shows error with "Retry" hint; state machine resets cleanly
- [x] **SLIDE-30
**: Cancel mid-frame leaves wire neutral (Promise.allSettled in-flight writes ≤ 200 ms → CTRL_CAN → wait ≤ 500 ms for Z80 echo → drain 100 ms → re-arm framer); never calls `reader.cancel()` or `port.close()`

### SLIDE integration with existing v1.0 systems

- [x] **SLIDE-31
**: Tab close mid-transfer — `visibilitychange` listener emits best-effort CTRL_CAN; partial-file recovery documented in human-UAT
- [x] **SLIDE-32
**: Phase 5 port-lost flow includes SLIDE pump (`slidePumpOnPortLost` symmetric with `pastePumpOnPortLost`) in `serial.js` teardown / `handleReadError` / `onNavSerialDisconnect`
- [x] **SLIDE-33
**: Session-log append paused during active SLIDE session (binary frame bytes don't pollute the RX log); resumes on session end
- [x] **SLIDE-34
**: Spurious mid-stream `ESC ^ S L I D E` while session is active → chip warning "Z80 reset detected; cancelling current transfer" + clean reset (idempotent state-machine entry)
- [x] **SLIDE-35
**: Auto-type "Z80 didn't respond" timeout (~3 s) chip with `[Retry] [Cancel] [Force start (legacy slide.com)]` options for users running pre-v0.2.1 slide.com without wakeup signature
- [ ] **SLIDE-36**: Filename collisions on send (case-insensitive + 8.3 truncation produces duplicates) detected in JS pre-flight; user prompted to auto-rename (`NAME.TXT, NAME~1.TXT, NAME~2.TXT`), refuse, or send-only-first

### SLIDE settings & persistence

- [x] **SLIDE-37
**: User-configurable auto-send command persists in `bestialitty.prefs.slideAutoSendCommand`; default `B:SLIDE R\r`; empty string = disabled
- [ ] **SLIDE-38**: Auto-send command validated for safety — alphanumeric + `:` + `\r` only; rejects `;`, pipes, non-`\r` control characters; first-use confirmation chip for non-default values
- [x] **SLIDE-39
**: Settings pane exposes auto-send command (text input) + "show transfer summary chip" checkbox + optional `Compatibility mode` selector for legacy slide.com fallback, following the Phase 6 Settings-row pattern

### SLIDE Z80 coordination & docs

- [ ] **SLIDE-40**: `docs/SLIDE_Z80_REQUIREMENT.md` documents (a) the slide.asm `ESC ^ S L I D E` wakeup requirement, (b) the v0.2.1 protocol amendment (PC-initiated CTRL_CAN with Z80 echo), (c) the `B:SLIDE R` command convention, (d) links to the upstream `github.com/blowback/slide` PR
- [ ] **SLIDE-41**: README.md "Keyboard shortcuts" section extended with drag-drop and file-picker references; new "File transfer" section documents the SLIDE protocol summary and links to SPEC-v0.2.1
- [ ] **SLIDE-42**: Real-hardware UAT protocol (`docs/SLIDE-UAT.md` mirroring `06-HUMAN-UAT.md`) for end-to-end verification against patched MicroBeast

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Rendering polish

- **v2-RENDER-01**: Scanline / phosphor intensity slider (0–100%) for CRT theme
- **v2-RENDER-02**: Render VT52 graphics-mode glyphs (math fractions, scan lines) when MicroBeast workloads actually use them

### Transport polish

- **v2-XPORT-01**: Send Break button (`SerialPort.setSignals({break:true})` held ~250ms)

### Audio

- **v2-AUDIO-01**: Audible bell, one default tone, muted by default

### Session extras

- **v2-SESS-01**: Settings export / import as JSON

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Rust bindings to Web Serial | Brittle / unmaintained; JS transport is the committed path |
| Firefox / Safari support | Web Serial is Chromium-only; polite fail covers this |
| Strict DEC VT52 conformance beyond MicroBeast needs | Over-scoping; only what MicroBeast emits matters |
| ANSI / VT100 / Heath H19 extensions | MicroBeast doesn't emit them; doubles parser surface for zero benefit |
| MicroBeast-specific key codes / configurable keymap remap | Stock PC→VT52 mapping is enough for daily driving |
| Browser-side automated / golden-trace tests | Rust unit tests + daily-driver use are the v1 bar |
| Shareable public-URL hosted service | Self-hosting is enough; deploy target is a build artefact, not a product |
| Alternative transports (WebSocket bridge, WebUSB, mock backend) | Web Serial direct is the only v1 transport |
| Tabs / multiple concurrent sessions | Scope explosion; browser already has tabs |
| Split panes / tmux-style multiplexing | VT52 has no pane concept; MicroBeast emits one 80×24 stream |
| SSH / Telnet / raw TCP transport | Requires a bridge server; violates static-site constraint |
| 256-colour / truecolor | VT52 has no colour; theme palette is the colour story |
| Mouse selection → auto-copy + middle-click paste | Conflicts with browser text-selection semantics; explicit copy/paste covers the need |
| Rich-text / hyperlink detection in scrollback | MicroBeast output has no URLs |
| Sixel / Kitty graphics / image protocols | MicroBeast never emits them |
| Command history / fuzzy recall / AI features | The remote side owns history (CP/M / BASIC) |
| Tab completion | Same — remote concern |
| Cloud-synced settings | Violates static-site constraint |
| XMODEM / YMODEM / ZMODEM file transfer | Non-trivial separate state machine; CP/M has its own transfer paths |
| Macros / scripted input replay | Scope creep; paste-a-block covers simple cases |
| Bell sound file customisation | Single tone if audible ships at all |
| Screen-reader support on canvas | Documented limitation; revisit if real users ask |
| Separate "dark mode" concept | Both shipped themes are already dark |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PARSER-01 | Phase 1 | Complete |
| PARSER-02 | Phase 1 | Complete |
| PARSER-03 | Phase 1 | Complete |
| PARSER-04 | Phase 1 | Complete |
| PARSER-05 | Phase 1 | Complete |
| PARSER-06 | Phase 1 | Complete |
| PARSER-07 | Phase 1 | Complete |
| PARSER-08 | Phase 1 | Complete |
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 2 | Complete |
| CORE-04 | Phase 2 | Complete |
| CORE-05 | Phase 2 | Complete |
| RENDER-01 | Phase 3 | Complete (G-03-04-01 closed in Plan 03-05 — snapshot-first tick + grid_byte_len guard; regression-guarded by grid.spec.js `gap #2` tests in Plan 03-07) |
| RENDER-02 | Phase 3 | Complete (visible block cursor + wall-clock blink restored by Plan 03-07 Rule 1 auto-fix to paintCursor blink-off branch; regression-guarded by cursor.spec.js `gap #1`) |
| RENDER-03 | Phase 3 | Complete (focus indicator via `data-focused` attribute-selector CSS in Plan 03-06; regression-guarded by focus.spec.js `gap #7` tests in Plan 03-07) |
| RENDER-04 | Phase 3 | Complete (content-feed path restored in Plan 03-05; regression-guarded by grid.spec.js and hidpi.spec.js `gap #8` in Plan 03-07) |
| RENDER-05 | Phase 3 | Complete (theme swap preserves content via markAllRowsDirty in Plan 03-05; regression-guarded by theme-toggle.spec.js `gap #3` in Plan 03-07) |
| RENDER-06 | Phase 3 | Complete |
| RENDER-07 | Phase 3 | Complete (chord remapped to Ctrl+Alt+T in Plan 03-06 — Ctrl+Shift+T is Chromium-reserved; regression-guarded by theme-toggle.spec.js + keyboard.spec.js `gap #4` in Plan 03-07) |
| RENDER-08 | Phase 3 | Complete (phosphor switch recolours existing glyphs via markAllRowsDirty in Plan 03-05; regression-guarded by phosphor.spec.js `gap #5` in Plan 03-07) |
| RENDER-09 | Phase 3 | Complete (zoom preserves content via markAllRowsDirty in Plan 03-05; regression-guarded by zoom.spec.js `gap #6` in Plan 03-07) |
| RENDER-10 | Phase 3 | Complete (HiDPI glyph fills full cell via rasteriseBitmap pxW/pxH derivation in Plan 03-05; regression-guarded by hidpi.spec.js `gap #8` in Plan 03-07) |
| RENDER-11 | Phase 3 | Complete |
| RENDER-12 | Phase 3 | Complete (per-theme cursor styling — regression-guarded by cursor.spec.js blink-cycle sampling against phosphor palette) |
| XPORT-01 | Phase 5 | Pending |
| XPORT-02 | Phase 5 | Pending |
| XPORT-03 | Phase 5 | Pending |
| XPORT-04 | Phase 5 | Pending |
| XPORT-05 | Phase 5 | Pending |
| XPORT-06 | Phase 5 | Pending |
| XPORT-07 | Phase 5 | Pending |
| XPORT-08 | Phase 5 | Pending |
| XPORT-09 | Phase 5 | Pending |
| XPORT-10 | Phase 5 | Pending |
| XPORT-11 | Phase 5 | Pending |
| INPUT-01 | Phase 4 | Pending |
| INPUT-02 | Phase 4 | Pending |
| INPUT-03 | Phase 4 | Pending |
| INPUT-04 | Phase 4 | Pending |
| INPUT-05 | Phase 4 | Pending |
| SESS-01 | Phase 6 | Complete |
| SESS-02 | Phase 6 | Complete |
| SESS-03 | Phase 6 | Complete |
| SESS-04 | Phase 6 | Complete |
| SESS-05 | Phase 6 | Complete |
| SESS-06 | Phase 6 | Complete |
| PREF-01 | Phase 6 | Complete |
| PREF-02 | Phase 6 | Complete |
| PLAT-01 | Phase 5 | Pending |
| PLAT-02 | Phase 5 | Pending |
| PLAT-03 | Phase 6 | Complete |
| PLAT-04 | Phase 6 | Complete |
| PLAT-05 | Phase 6 | Complete |
| SLIDE-01 | Phase 7 | Complete |
| SLIDE-02 | Phase 7 | Complete |
| SLIDE-03 | Phase 7 | Complete |
| SLIDE-04 | Phase 7 | Complete |
| SLIDE-05 | Phase 8 | Complete |
| SLIDE-06 | Phase 8 | Complete |
| SLIDE-07 | Phase 9 | Complete |
| SLIDE-08 | Phase 9 | Complete |
| SLIDE-09 | Phase 9 | Complete |
| SLIDE-10 | Phase 9 | Complete |
| SLIDE-11 | Phase 11 | Complete |
| SLIDE-12 | Phase 12 | Pending |
| SLIDE-13 | Phase 9 | Complete |
| SLIDE-14 | Phase 11 | Complete |
| SLIDE-15 | Phase 9 | Complete |
| SLIDE-16 | Phase 9 | Complete |
| SLIDE-17 | Phase 8 | Complete |
| SLIDE-18 | Phase 10 | Complete |
| SLIDE-19 | Phase 10 | Complete |
| SLIDE-20 | Phase 10 | Complete (verbatim except on filename collision — `~N` suffix per CONTEXT D-05/D-06; see 10-CONTEXT.md D-07) |
| SLIDE-21 | Phase 10 | Complete |
| SLIDE-22 | Phase 10 | Complete |
| SLIDE-23 | Phase 10 | Complete |
| SLIDE-24 | Phase 10 | Complete |
| SLIDE-25 | Phase 11 | Complete |
| SLIDE-26 | Phase 11 | Complete |
| SLIDE-27 | Phase 10 | Complete |
| SLIDE-28 | Phase 11 | Complete |
| SLIDE-29 | Phase 10 | Complete |
| SLIDE-30 | Phase 10 | Complete |
| SLIDE-31 | Phase 11 | Complete |
| SLIDE-32 | Phase 11 | Complete |
| SLIDE-33 | Phase 11 | Complete |
| SLIDE-34 | Phase 10 | Complete |
| SLIDE-35 | Phase 11 | Complete |
| SLIDE-36 | Phase 12 | Pending |
| SLIDE-37 | Phase 11 | Complete |
| SLIDE-38 | Phase 12 | Pending |
| SLIDE-39 | Phase 11 | Complete |
| SLIDE-40 | Phase 12 | Pending |
| SLIDE-41 | Phase 12 | Pending |
| SLIDE-42 | Phase 12 | Pending |

**Coverage:**
- v1.0 requirements: 54 total (54 mapped, 100% — all complete)
- v1.1 requirements: 42 total (42 mapped, 100%)
- Grand total: 96 requirements (96 mapped, 100%)

**Per-phase counts:**
- Phase 1 (Rust Core): 10 requirements
- Phase 2 (Wasm Boundary): 3 requirements
- Phase 3 (Canvas Renderer): 12 requirements
- Phase 4 (Keyboard Input): 5 requirements
- Phase 5 (Web Serial Transport): 13 requirements
- Phase 6 (Polish & Deployment): 11 requirements
- Phase 7 (SLIDE Rust Core): 4 requirements
- Phase 8 (Wasm Boundary, Dispatcher, Wakeup): 3 requirements
- Phase 9 (SLIDE Sender): 7 requirements
- Phase 10 (SLIDE Receiver & Cancellation): 11 requirements
- Phase 11 (SLIDE JS Bridge & Integration): 11 requirements
- Phase 12 (SLIDE UX Polish, Docs & UAT): 6 requirements

---
*Requirements defined: 2026-04-21*
*Last updated: 2026-05-06 — 42 SLIDE-* requirements mapped to Phases 7–12 by roadmapper (v1.1 FileTransfer milestone)*
