# Requirements: BestialiTTY

**Defined:** 2026-04-21
**Core Value:** A modern, reliable, in-browser VT52 emulator good enough to use as a daily driver with a real MicroBeast.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Parser

- [ ] **PARSER-01**: VT52 parser covers the pragmatic subset emitted by the MicroBeast (cursor movement ESC A/B/C/D/H/I, direct addressing ESC Y, erase ESC J/ESC K)
- [ ] **PARSER-02**: ESC Y cursor addressing correctly decodes the +32 (0x20) row/column byte offset
- [ ] **PARSER-03**: Parser handles escape sequences split across serial chunk boundaries without loss
- [ ] **PARSER-04**: ESC F / ESC G / ESC = / ESC > parse as silent no-ops (no screen corruption on unhandled-but-legal sequences)
- [ ] **PARSER-05**: ESC Z identify query returns ESC / K response on the serial line
- [ ] **PARSER-06**: BEL (0x07) triggers a visible-bell signal (screen flash and/or title-bar indicator)
- [ ] **PARSER-07**: Default CR / LF handling matches MicroBeast CP/M convention (verified via live capture in phase 1)
- [ ] **PARSER-08**: Parser and state machine have Rust unit tests covering the MicroBeast subset and torn-chunk edge cases

### Core

- [ ] **CORE-01**: Rust compiled to wasm owns parser, terminal state, and key encoding — pure logic, no I/O, no DOM
- [ ] **CORE-02**: Rust core has zero bindings to Web Serial or other browser I/O APIs
- [ ] **CORE-03**: Rust↔JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`)
- [ ] **CORE-04**: JS shell owns Web Serial I/O, canvas rendering, event loop, and browser state
- [ ] **CORE-05**: Wasm boundary uses batched byte feeds and shared-memory views (no per-byte or per-frame grid copying)

### Rendering

- [ ] **RENDER-01**: Canvas-based monospace rendering at fixed 80×24 grid
- [ ] **RENDER-02**: Visible block cursor
- [ ] **RENDER-03**: Focus indicator on the terminal surface (border or cursor-style change on focus/blur)
- [ ] **RENDER-04**: CRT theme — bitmap-style pixel font, phosphor colour, optional scanlines/glow
- [ ] **RENDER-05**: Clean modern monospace theme — sharp web font, minimal chrome
- [ ] **RENDER-06**: User-toggleable theme switch between CRT and clean
- [ ] **RENDER-07**: Keyboard shortcut to toggle theme (e.g., Ctrl-Shift-T)
- [ ] **RENDER-08**: Phosphor colour choice for CRT theme (green / amber / white)
- [ ] **RENDER-09**: Font size zoom via Ctrl +/- and Ctrl 0, integer multipliers for bitmap font
- [ ] **RENDER-10**: HiDPI / devicePixelRatio rendering without blur on Retina-class displays
- [ ] **RENDER-11**: Visible-bell rendering as screen flash (~100ms) and title-bar indicator on background tabs
- [ ] **RENDER-12**: Per-theme cursor styling (CRT vs clean each define their own)

### Transport

- [ ] **XPORT-01**: Web Serial transport driven entirely from JavaScript (no Rust bindings)
- [ ] **XPORT-02**: Connect / Disconnect button with clear stateful label
- [ ] **XPORT-03**: Visible connection status indicator (connected / disconnected / port lost)
- [ ] **XPORT-04**: MicroBeast preset as the default serial configuration (19200 8N1, no flow control — verify in phase 1 live capture)
- [ ] **XPORT-05**: Serial configuration override UI for baud, data bits, stop bits, parity, flow control
- [ ] **XPORT-06**: Graceful port-disconnect recovery — read loop exits cleanly on `disconnect` event, UI surfaces the state
- [ ] **XPORT-07**: Restore previously-granted port on reload via `navigator.serial.getPorts()` without re-prompting
- [ ] **XPORT-08**: Auto-reconnect on USB re-plug via `connect` / `disconnect` event listeners
- [ ] **XPORT-09**: Paste throttling to serial line rate — prevent silent overrun at 19200 baud with no flow control
- [ ] **XPORT-10**: Disconnect uses `reader.cancel()` before `port.close()` to avoid reader-lock deadlock (WICG/serial#112)
- [ ] **XPORT-11**: Read loop is pure async and decoupled from `requestAnimationFrame` so background-tab throttling does not drop serial data

### Input

- [ ] **INPUT-01**: Standard PC keyboard maps to VT52 key codes (arrows, keypad, control keys)
- [ ] **INPUT-02**: Arrow keys transmit ESC A / ESC B / ESC C / ESC D
- [ ] **INPUT-03**: Ctrl-key combinations transmit correct control bytes (0x00–0x1F) with sensible handling of browser-reserved combos (Ctrl-W, Ctrl-N, Ctrl-T)
- [ ] **INPUT-04**: Local echo toggle, default off (MicroBeast echoes normally)
- [ ] **INPUT-05**: CR / LF override toggle for edge-case MicroBeast software

### Session

- [ ] **SESS-01**: Scrollback buffer retains N lines of prior output for review
- [ ] **SESS-02**: User can select and copy text from the screen to the clipboard
- [ ] **SESS-03**: User can paste clipboard content into the serial stream (subject to paste throttling)
- [ ] **SESS-04**: Session logging captures the serial stream to a downloadable file, auto-started per connection
- [ ] **SESS-05**: Mid-session "download current log" button without disconnecting
- [ ] **SESS-06**: Clear-screen local button (distinct from remote ESC J — wipes visible screen + optionally scrollback)

### Persistence

- [ ] **PREF-01**: Theme, phosphor colour, font size, and last-used serial config persist in `localStorage`
- [ ] **PREF-02**: Local echo and CR/LF override toggle states persist in `localStorage`

### Platform

- [ ] **PLAT-01**: Detect Chromium-based Web Serial support on load
- [ ] **PLAT-02**: Clear "use a Chromium-based browser" message on unsupported browsers — polite fail, no crash
- [ ] **PLAT-03**: Ships as a static site, self-hosted (GitHub Pages / Cloudflare Pages / own domain)
- [ ] **PLAT-04**: Public repo under a permissive license (MIT or Apache-2.0)
- [ ] **PLAT-05**: First-open sane defaults — MicroBeast preset pre-selected; one click to connect

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
| PARSER-01 | TBD | Pending |
| PARSER-02 | TBD | Pending |
| PARSER-03 | TBD | Pending |
| PARSER-04 | TBD | Pending |
| PARSER-05 | TBD | Pending |
| PARSER-06 | TBD | Pending |
| PARSER-07 | TBD | Pending |
| PARSER-08 | TBD | Pending |
| CORE-01 | TBD | Pending |
| CORE-02 | TBD | Pending |
| CORE-03 | TBD | Pending |
| CORE-04 | TBD | Pending |
| CORE-05 | TBD | Pending |
| RENDER-01 | TBD | Pending |
| RENDER-02 | TBD | Pending |
| RENDER-03 | TBD | Pending |
| RENDER-04 | TBD | Pending |
| RENDER-05 | TBD | Pending |
| RENDER-06 | TBD | Pending |
| RENDER-07 | TBD | Pending |
| RENDER-08 | TBD | Pending |
| RENDER-09 | TBD | Pending |
| RENDER-10 | TBD | Pending |
| RENDER-11 | TBD | Pending |
| RENDER-12 | TBD | Pending |
| XPORT-01 | TBD | Pending |
| XPORT-02 | TBD | Pending |
| XPORT-03 | TBD | Pending |
| XPORT-04 | TBD | Pending |
| XPORT-05 | TBD | Pending |
| XPORT-06 | TBD | Pending |
| XPORT-07 | TBD | Pending |
| XPORT-08 | TBD | Pending |
| XPORT-09 | TBD | Pending |
| XPORT-10 | TBD | Pending |
| XPORT-11 | TBD | Pending |
| INPUT-01 | TBD | Pending |
| INPUT-02 | TBD | Pending |
| INPUT-03 | TBD | Pending |
| INPUT-04 | TBD | Pending |
| INPUT-05 | TBD | Pending |
| SESS-01 | TBD | Pending |
| SESS-02 | TBD | Pending |
| SESS-03 | TBD | Pending |
| SESS-04 | TBD | Pending |
| SESS-05 | TBD | Pending |
| SESS-06 | TBD | Pending |
| PREF-01 | TBD | Pending |
| PREF-02 | TBD | Pending |
| PLAT-01 | TBD | Pending |
| PLAT-02 | TBD | Pending |
| PLAT-03 | TBD | Pending |
| PLAT-04 | TBD | Pending |
| PLAT-05 | TBD | Pending |

**Coverage:**
- v1 requirements: 54 total
- Mapped to phases: 0 (to be filled by roadmap)
- Unmapped: 54 ⚠️ (roadmap will resolve)

---
*Requirements defined: 2026-04-21*
*Last updated: 2026-04-21 after initial definition*
