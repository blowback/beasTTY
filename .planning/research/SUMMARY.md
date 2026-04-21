# Project Research Summary

**Project:** BestialiTTY — in-browser VT52 terminal emulator for MicroBeast Z80
**Domain:** Browser-native serial terminal (Rust/wasm core + JS shell, static site)
**Researched:** 2026-04-21
**Confidence:** HIGH (stack, architecture, pitfalls), MEDIUM-HIGH (features)

## Executive Summary

BestialiTTY is a narrow, well-scoped product: a Chromium-only static web app that speaks VT52 over Web Serial to one specific piece of hardware, with a hard Rust/wasm-core + JS-shell split baked in from the start. The research confirms this architecture is sound and has well-documented precedents (Alacritty, xterm.js, VS Code Terminal). The main technical decisions are all resolvable: the toolchain (Rust stable + wasm-bindgen 0.2.118 + wasm-pack + Vite 8 + Canvas 2D glyph atlas) is high-confidence across every source; the feature surface (a ~15-command VT52 parser, Web Serial transport, scrollback, two themes) is straightforwardly bounded; the pitfalls are all documented and avoidable if caught during the right phase.

The recommended build order is bottom-up and mirrors how Alacritty itself was built: Rust parser + terminal state first (no browser, cargo test only), then wasm build + tiny JS harness, then Canvas renderer, then keyboard input, then Web Serial transport, then polish. Each phase is independently testable, which is important for a greenfield project with no baseline to regress against. The single biggest risk is not a correctness problem — VT52 is a small protocol — but an endurance and reliability problem: the Web Serial read loop has well-known deadlock patterns on disconnect, the ESC Y cursor-addressing byte offset is the classic beginner bug, and scrollback memory growth in long sessions has sunk browser terminal apps before. All three are avoidable with discipline and the right tests in place.

One key architectural decision is unresolved by research and must be resolved in Phase 1 via a short spike: STACK.md argues strongly for a hand-rolled ~200-line VT52 DFA and against using the `vte` crate (an ANSI-shaped state machine, wrong shape for pre-ANSI VT52); ARCHITECTURE.md argues for building on `vte` and implementing only the three relevant `Perform` callbacks (print/execute/esc_dispatch), getting partial-read and sequence-cancellation correctness for free. Both positions are defensible. The resolution is a few hours of prototyping, not more research.

## Key Findings

### Recommended Stack

The toolchain is standard 2026 Rust/wasm: Rust stable (Edition 2024, 1.85+), compiled to `wasm32-unknown-unknown` via `wasm-pack 0.13.x --target web`, with `wasm-bindgen 0.2.118` for the Rust/JS boundary. The static site is built with Vite 8.0.9 and `vite-plugin-wasm` (Menci). Rendering uses HTML Canvas 2D with a pre-rasterised glyph atlas on an OffscreenCanvas. Web Serial is driven entirely from TypeScript (5.9.x). Tests: `cargo test` for Rust logic, `wasm-bindgen-test` for wasm-boundary smoke tests, Vitest for JS glue. Two fonts ship as local assets: PxPlus IBM VGA 8x16 (CRT theme, CC BY-SA 4.0) and JetBrains Mono (clean theme, OFL).

**Core technologies:**
- **Rust 1.85+ stable (Edition 2024):** wasm core language — pure logic, zero browser deps
- **wasm-bindgen 0.2.118 + wasm-pack 0.13.x:** Rust/JS interop — standard, actively maintained; pin exact version to avoid cryptic runtime mismatches
- **Vite 8.0.9 + vite-plugin-wasm (Menci):** bundler + dev server — Rolldown-based, first-class wasm support, static output
- **TypeScript 5.9.x:** JS shell type-checking — 5.9 over 6.0 for stability on a hobby project
- **HTML Canvas 2D + glyph atlas:** rendering — trivially sufficient for 80x24, no WebGL needed
- **Web Serial API (JS only):** transport — Chromium-only, no Rust bindings
- **Vitest 4.1.x:** JS tests — native Vite integration, mock `navigator.serial` via `vi.stubGlobal`

**What NOT to use:** `wee_alloc` (unmaintained, memory leak), `xterm.js` (ANSI-centric, fights VT52), `TextDecoderStream` on the serial read path (corrupts 8-bit byte streams), `vt100-rust` / `vt100_ctt` (full VT100 state, wrong tool).

### Expected Features

The v1 baseline is already committed in PROJECT.md (pragmatic VT52 parser, Web Serial transport, scrollback, copy/paste, session logging, two themes, serial presets, Rust unit tests). Research adds table-stakes items that were implicit but not enumerated, and surfaces high-ROI polish features for v1.x.

**Must have for v1 (table stakes not explicitly in PROJECT.md):**
- Connect/Disconnect button with explicit, visible connection status (color-coded)
- Visible block cursor with per-theme styling
- BEL (0x07) visual handling — screen flash + tab title indicator at minimum
- Paste throttling — at 19200 baud with no flow control, a naive paste overruns the MicroBeast input buffer silently
- ESC Z identify response (ESC / K) — required by some CP/M full-screen programs; without it they hang
- ESC F / G / = / > parsed as no-ops — prevents screen corruption on legal-but-unused sequences
- Focus indicator on the terminal canvas surface
- Sane CR/LF default (verify on real device in Phase 1)
- Chromium-only polite fail with explicit copy ("Use a Chromium-based browser")

**Should have — v1.x, high ROI:**
- Restore previously-granted port on reload via `navigator.serial.getPorts()` + VID/PID match
- Auto-reconnect on USB re-plug via `connect` event
- Persistent preferences in `localStorage` (theme, font size, serial config, bell, local echo)
- Font size zoom (Ctrl+/−, Ctrl+0) with integer multipliers for bitmap font
- Send Break button
- Scanline/phosphor intensity slider + phosphor colour choice (green/amber/white)
- Local echo toggle (default off)
- CR/LF override toggle
- Clear screen local button (distinct from ESC J)
- Mid-session log download button

**Defer to v2+:**
- Audible bell (browser autoplay constraints; low priority)
- XMODEM/YMODEM/ZMODEM file transfer (substantial separate state machine)
- Accessibility pass on the canvas surface (hard; low ROI for a personal tool)
- Settings export/import as JSON

**Anti-features (do not build):** tabs/panes, SSH/telnet/WebSocket transport, VT100/ANSI mode, 256-colour, configurable keymap editor, mouse X11-selection, Sixel/Kitty graphics.

**Critical gap — live MicroBeast capture:** which VT52 sequences the MicroBeast actually emits (especially BEL, graphics mode, alt-keypad) is not documented in the project wiki. Phase 1 must include a byte-level capture session to inform what to implement vs safely ignore. This also resolves the CR/LF default question.

### Architecture Approach

The architecture is a clean two-layer split: Rust/wasm owns the parser, terminal grid, scrollback ring, dirty-row bitmap, and key encoder — pure deterministic logic with no browser dependencies. JS owns everything the browser exposes: Web Serial I/O, Canvas rendering, DOM events, clipboard, session logging, and `localStorage` config. The wasm boundary is deliberately thin: two hot calls (`feed(bytes)` and `encode_key(code, mods)`) plus zero-copy `Uint8Array` views over wasm linear memory for the cell grid and dirty bitmap. No per-frame serialization, no serde, no JSON. Scrollback uses a `VecDeque<Row>` ring (Alacritty's model), capped at a configurable limit, living entirely in Rust. Rendering is a Canvas 2D glyph atlas with one offscreen canvas per `(glyph, fg, bg, flags)` tuple, rasterized on first use, blitted with `drawImage`; only dirty rows repaint per rAF tick. The serial read loop is decoupled from rAF to survive background-tab throttling.

**Major components:**
1. **Rust `Terminal`** — VT52 semantic layer: interprets parser callbacks as cursor moves, erases, print-char; mutates grid, marks dirty rows
2. **Rust `Grid` / `Scrollback`** — `VecDeque<Row>` ring; `Cell = { ch: u32, fg: u8, bg: u8, flags: u8, _pad: u8 }` (`repr(C)`, 8 bytes); exposed to JS via stable pointer, zero-copy
3. **Rust `KeyEncoder`** — stateless `fn encode(KeyEvent) -> Vec<u8>`; pure, trivially unit-testable without a browser
4. **JS `SerialIO`** — `port.readable.getReader()` loop with `reader.cancel()` on disconnect; tees bytes to session logger before wasm `feed()` call
5. **JS `Renderer`** — rAF loop; reads `dirtyView` + `gridView` over wasm memory; blits glyph atlas tiles; two theme descriptors (CRT + modern)
6. **JS `KeyInput`** — DOM `keydown` handler; extracts `(code, mods)` primitives; calls `encode_key()`; writes to `port.writable`
7. **JS `Config`** — `localStorage` for serial params, theme, scrollback size; never crosses into Rust

### Critical Pitfalls

1. **Reader-lock deadlock on USB disconnect** — `port.close()` while `reader.read()` is pending deadlocks forever. Fix: stash the reader in module scope; always call `reader.cancel()` first on any disconnect path, then `releaseLock()`, then `close()`. Must be correct from day one of transport code; retrofitting requires rewriting the read loop.

2. **Escape sequence torn across chunk boundaries** — Web Serial delivers arbitrary byte slices; `ESC Y <row> <col>` can arrive as `ESC Y` in one chunk and `<row><col>` in the next. Fix: byte-at-a-time state machine in Rust with explicit states (`Ground`, `Escape`, `CursorRow`, `CursorCol`). Unit-test every multi-byte sequence split at every internal offset.

3. **`ESC Y` cursor addressing +32 bias bug** — VT52 row/col bytes are offset by 0x20 (32), not 0x30 ('0'). Getting this wrong misplaces the cursor by a constant amount; has shipped in production terminal emulators (mintty#1299). Fix: `row = byte.saturating_sub(0x20).min(MAX_ROW)`. Write edge-case unit tests before the implementation.

4. **wasm boundary chattiness tanking throughput** — calling `feed_byte(b)` per byte across the JS/wasm boundary instead of `feed(chunk)` causes catastrophic overhead at 115200 baud. Fix: batch API from day one (`feed(&[u8])`); zero-copy `Uint8Array` views for grid reads rather than returning JS objects or JSON per frame.

5. **Canvas HiDPI blur** — a `<canvas>` at 1x CSS pixels on a 2x DPR display produces blurry output, fatal for the CRT bitmap aesthetic. Fix: at init and on every resize, multiply canvas dimensions by `window.devicePixelRatio`; `ctx.scale(dpr, dpr)`; listen for DPR changes on monitor drag. Disable `imageSmoothingEnabled` for the CRT theme.

**Additional high-severity pitfalls to address by phase:**
- Background-tab throttling silently loses serial data if the read loop is rAF-driven (fix: decouple read loop from render loop — an architecture decision, not a patch)
- Scrollback OOM on long sessions (fix: `VecDeque` ring cap, configurable, default ~10k lines)
- Font not loaded on first render (fix: `await document.fonts.load(...)` before renderer init)
- Browser intercepting Ctrl+W / Ctrl+N / Ctrl+T (fix: `preventDefault()` on every forwarded key; document unrecapturable cases; offer Keyboard Lock in fullscreen)
- `TextDecoder` on the serial stream corrupts 8-bit bytes (fix: bytes end-to-end; no string conversion before the parser)
- DTR/RTS toggling on connect accidentally resets the MicroBeast (fix: `setSignals({ dataTerminalReady: false, requestToSend: false })` immediately after `port.open()`; expose in config UI)

## KEY DECISION: VT52 Parser Strategy (Unresolved — Resolve in Phase 1 Spike)

**The tension:** STACK.md and ARCHITECTURE.md contradict each other on parser approach.

**STACK.md position:** Hand-roll a ~200-line VT52 DFA. The `vte` crate implements Paul Williams' ANSI/VT500 state machine, which is explicitly shaped for VT100+ grammar (CSI, OSC, DCS, SOS states). VT52 is a pre-ANSI protocol with a different and simpler grammar: ESC + single letter, plus the one multi-byte `ESC Y <row> <col>` sequence. Forcing VT52 through an ANSI DFA adds unused surface area for no benefit, and the DFA's intermediate state model (VT52 has no intermediates for single-letter sequences) creates unnecessary complexity. Pragmatic VT52 has ~12–15 commands; the complete parser fits in ~200 lines with explicit, testable states.

**ARCHITECTURE.md position:** Build on `vte` and implement only `print`, `execute`, and `esc_dispatch` callbacks; treat `csi_dispatch` / `hook` / `osc_dispatch` as no-ops. The `vte` crate handles partial reads, mid-sequence error recovery, and unexpected-byte cancellation correctly — these are genuinely hard to get right in a hand-rolled parser, and the cost of getting them wrong is silent screen corruption. The unused VT500 states are free at runtime (the state machine never enters them for VT52 input). This is how Alacritty itself is structured.

**Resolution approach:** Neither position is obviously wrong. Do NOT resolve this via further research — the information exists, the question is a code-shape judgment call. Resolve it via a **2–4 hour spike at the start of Phase 1**:

1. Implement `ESC Y` + 4–5 cursor-movement sequences using the hand-rolled DFA approach
2. Implement the same using `vte::Parser` + a minimal `Perform` impl
3. Run torn-chunk unit tests against both
4. Evaluate: which is simpler to read, reason about, and extend?
5. Pick one, document the rationale, delete the other

## Implications for Roadmap

The build order from ARCHITECTURE.md is strongly recommended: bottom-up, each phase independently testable, transport last.

### Phase 1: Rust Core — Parser, Grid, Key Encoder

**Rationale:** Zero external dependencies; hardest correctness surface; fastest feedback loop (pure `cargo test`). All the silent-corruption pitfalls (torn-chunk sequences, `ESC Y` offset, parser state model) live here. Must be solid before anything is built on top. Also the right place to run the live MicroBeast capture session and the parser strategy spike.

**Delivers:** `bestialitty-core` Rust crate: VT52 parser, `Terminal` struct, `Grid`/`Scrollback` (VecDeque ring with configurable cap), `DirtyRows` bitmap, `KeyEncoder`. Full unit test suite including torn-chunk tests for all multi-byte sequences and all `ESC Y` byte-offset edge cases.

**Key tasks:**
- Parser strategy spike — hand-rolled DFA vs `vte`-backed Perform (2–4 hours)
- Live MicroBeast byte capture to ground implementation in observed reality
- All VT52 cursor-movement, erase, and identify-response sequences
- ESC F/G/=/> explicit no-ops (tracked, not silently skipped)
- ESC Z identify response (ESC / K)
- Byte-at-a-time state machine resilient to torn chunks
- Scrollback ring with configurable cap (default 10k lines)
- BEL tracking (sets a "bell pending" flag; rendering handles the visual)

**Avoids:** Pitfalls 2 (torn chunks), 3 (ESC Y offset), 4 (boundary chattiness — boundary shape decided here)

**Research flag:** Parser strategy spike needed. Live MicroBeast capture needed. Standard patterns everywhere else.

---

### Phase 2: Wasm Build + Minimal JS Harness

**Rationale:** Validates the entire Rust/wasm build pipeline and boundary shape with minimal surface area. Shakes out `wasm-pack --target web`, `vite-plugin-wasm`, and `wasm-bindgen` version pinning before committing to a larger JS codebase.

**Delivers:** `wasm-pack build` producing `pkg/`; minimal HTML harness calling `feed(bytes)` and dumping the grid as a `<pre>` debug view. No canvas, no Web Serial. Confirms zero-copy grid pointer pattern works end-to-end.

**Key tasks:**
- Verify `wasm-bindgen` Rust crate and `wasm-bindgen-cli` version match exactly
- Verify `--target web` ES module output works with Vite 8 + vite-plugin-wasm
- Confirm zero-copy `Uint8Array` view over wasm memory works from JS
- Confirm `feed(&[u8])` batched API (not per-byte)

**Research flag:** Standard patterns. Skip phase research.

---

### Phase 3: Canvas Renderer

**Rationale:** No dependency on Web Serial or keyboard. Building next gives the first visual milestone and surfaces HiDPI, font-load, and glyph-atlas pitfalls before transport complicates debugging.

**Delivers:** `renderer/canvas.js` + `renderer/atlas.js` + theme descriptors (CRT + modern). rAF loop reading `dirtyView`/`gridView` via zero-copy views; glyph atlas for fast `drawImage`-based cell blitting; both themes; HiDPI-correct resize handler; font-load gate before first render.

**Key tasks:**
- HiDPI: `canvas.width/height = cssSize * devicePixelRatio`; `ctx.scale(dpr, dpr)`; DPR-change listener
- Font-load gate: `await document.fonts.load(...)` before first rAF tick
- Glyph atlas: offscreen canvas per `(glyph, fg, bg, flags)` tuple; evict on theme change
- Dirty-row repaint only (not full-screen redraw per frame)
- CRT scanline overlay as a static offscreen composite (not recomputed per frame)
- Disable `imageSmoothingEnabled` for CRT bitmap theme

**Avoids:** Pitfalls 5 (HiDPI blur), 8 (font load race), 14 (full-screen redraw per byte)

**Research flag:** Standard patterns (glyph atlas, dirty repaint, HiDPI) are well-documented. Skip phase research.

---

### Phase 4: Keyboard Input

**Rationale:** Independent of Web Serial. Keyboard → `encode_key()` → local echo loop is a fully self-contained testable system. Browser key-interception issues surface here with no hardware required.

**Delivers:** `input/keyboard.js` — DOM `keydown` handler extracting `(code, mods)` primitives; `term.encode_key()` wiring; local echo feedback for testing; Ctrl+C/V/A disambiguation.

**Key tasks:**
- Synchronous `preventDefault()` for every key forwarded to the terminal
- Document Ctrl+W / Ctrl+N / Ctrl+T as unrecapturable; provide workarounds
- `tabindex=0` on canvas element; re-focus after every toolbar button click
- Guard on `event.isComposing` (IME double-emit prevention)
- Arrow keys → ESC A/B/C/D; Ctrl combos → 0x01–0x1F; printable → raw byte

**Avoids:** Pitfall 9 (browser key intercept), Pitfall 13 (focus loss)

**Research flag:** Standard DOM event patterns. Skip phase research.

---

### Phase 5: Web Serial Transport

**Rationale:** Every prior phase is verifiable without hardware. Web Serial is now the only new variable — isolation means transport bugs are easy to locate.

**Delivers:** `serial.js` — port picker, `port.open()` with explicit DTR/RTS state, cancellation-aware reader loop, writer, disconnect/reconnect handling. Serial config UI (MicroBeast preset pre-selected, baud/data/stop/parity override). Session logger tee in the reader loop.

**Key tasks:**
- `reader.cancel()` before any disconnect path (reader-lock deadlock prevention)
- `reader.releaseLock()` in `finally` block
- `await port.setSignals({ dataTerminalReady: false, requestToSend: false })` immediately after `port.open()`
- Read loop decoupled from rAF (pure async `while(true) { await reader.read() }`)
- Bytes end-to-end as `Uint8Array` — no `TextDecoder` on the serial stream
- VID/PID matching via `port.getInfo()` for auto-reconnect (`navigator.serial.getPorts()`)
- `navigator.serial` `connect`/`disconnect` event listeners for USB re-plug

**Avoids:** Pitfalls 1 (reader-lock deadlock), 10 (UTF-8 byte corruption), 11 (wrong-device reconnect), 12 (DTR/RTS accidental reset)

**Research flag:** Patterns are well-documented. If unfamiliar with Web Serial, a focused 1-hour spike on the `reader.cancel()` cancellation-aware loop is worth it before writing transport code.

---

### Phase 6: Polish, Reliability, and Deployment

**Rationale:** Each feature is additive and independent. Any can be cut without breaking the core. This is the daily-driver validation phase.

**Delivers:** Copy/paste (canvas selection → grid read → clipboard); scrollback UI (scroll wheel, keyboard scroll); BEL visual flash + tab title indicator; Chromium polite-fail; `localStorage` persistent preferences; static deployment to GitHub Pages / Cloudflare Pages. Manual 24-hour soak test.

**Key tasks:**
- Paste throttling (rate-limit bytes to serial line speed)
- Scrollback "stick to bottom unless user scrolled" mode
- Session log flush on `visibilitychange` and disconnect
- 24-hour soak test confirming scrollback memory stays flat
- Reconnect button prominent in UI; one-click recovery from disconnected state
- `beforeunload` → close serial port (best effort)
- `Permissions-Policy: serial=(self)` in self-hosted deployment

**Avoids:** Pitfall 6 (background-tab data loss), Pitfall 7 (scrollback OOM)

**Research flag:** Standard browser APIs. Skip phase research.

---

### Phase Ordering Rationale

- **Bottom-up dependency order** — each phase has exactly one new dependency on the phase before it; nothing builds on unproven ground
- **Hardest correctness first** — the parser (Phase 1) is where all silent-corruption bugs live; catching them in pure `cargo test` is dramatically cheaper than debugging over live hardware in later phases
- **Transport last** — Web Serial is the only phase requiring hardware; keeping it last maximizes the value of all preceding phases as hardware-free tests
- **Live capture in Phase 1** — grounding the implementation in observed MicroBeast behavior before writing parser code is cheaper than discovering gaps after

### Research Flags

Phases needing a spike or targeted research:
- **Phase 1:** Parser strategy spike (hand-rolled DFA vs `vte` Perform) — 2–4 hours, prototype not research; see KEY DECISION section
- **Phase 1:** Live MicroBeast byte capture session — determines actual VT52 subset, CR/LF convention, BEL usage, graphics-mode usage
- **Phase 5:** Reader-cancel / DTR-RTS pattern — if Web Serial is unfamiliar, a 1-hour focused spike on the cancellation-aware loop before writing production transport code

Phases with standard patterns (skip research):
- **Phase 2:** wasm-pack + vite-plugin-wasm integration is well-documented
- **Phase 3:** Glyph atlas + HiDPI Canvas patterns are well-documented across VS Code and xterm.js writeups
- **Phase 4:** DOM keyboard events are standard
- **Phase 6:** localStorage, clipboard, Blob download are standard browser APIs

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All major components verified via official docs and Context7 (wasm-bindgen, wasm-pack, vite-plugin-wasm, Vite 8). Version pins confirmed. One MEDIUM item: TS 5.9 vs 6.0 is a conservative call, revisit if dep graph forces it. |
| Features | MEDIUM-HIGH | VT52 protocol surface is HIGH (authoritative DEC manual, Wikipedia). MicroBeast-specific behavior is MEDIUM — hardware docs exist but VT52 usage patterns are not documented; needs live-device validation in Phase 1. |
| Architecture | HIGH | Pattern is well-precedented (Alacritty, xterm.js, VS Code Terminal). Zero-copy wasm boundary approach verified via wasm-bindgen issues and practical guides. One open question (parser strategy) is a design judgment call, not an information gap. |
| Pitfalls | HIGH | Web Serial deadlocks and wasm boundary chattiness: MDN, Chrome docs, WICG spec issues. VT52 edge cases: MEDIUM — DEC manual and terminal emulator tracker issues confirm the patterns, but VT52-specific sources are sparse. |

**Overall confidence:** HIGH — the technology is well-understood, the protocol is small, the pitfalls are documented and avoidable. The main uncertainty is which VT52 commands the MicroBeast actually emits; that requires live hardware and cannot be resolved by further research.

### Gaps to Address

- **MicroBeast VT52 command inventory** — Phase 1 live capture; determines which sequences to implement vs safely no-op. Until resolved, implement the full VT52 table so nothing is left out.
- **CR/LF convention on MicroBeast** — Phase 1 live capture; determines the sane default. Implement LF-implies-CR toggle so either assumption can be corrected without a code change.
- **BEL and graphics-mode usage** — Phase 1 live capture; if graphics mode (ESC F/G) is unused, no-ops are sufficient; if used, glyph rendering rises from v2 to v1.x priority.
- **Parser strategy choice** — Phase 1 spike; 2–4 hours of prototyping, not research. See KEY DECISION section.
- **DTR/RTS behavior on the CP2102N USB-serial adapter** — Phase 5; test with real hardware. Documented in MicroBeast repo but DTR-on-connect behavior depends on OS/driver defaults.

## Sources

### Primary (HIGH confidence)
- wasm-bindgen/wasm-pack official guide — build targets, browser integration, testing
- `/menci/vite-plugin-wasm` (Context7, benchmark 90.5) — wasm-pack + Vite integration patterns
- `/wasm-bindgen/wasm-pack` (Context7, benchmark 81.1) — wasm-pack usage, `--target web`
- Chrome for Developers: Web Serial guide — reader.cancel() pattern, chunked reads, setSignals, DTR/RTS
- MDN: Web Serial API — getPorts(), connect/disconnect events, break signals
- WICG/serial spec and issues (#112 reader-lock deadlock, #156 reconnect identity)
- VT100.net: VT52 DECscope Maintenance Manual — authoritative VT52 escape sequence reference
- web.dev: High DPI Canvas — devicePixelRatio handling
- web.dev: Improving HTML5 Canvas performance — glyph atlas patterns
- rustwasm/wasm-bindgen#1119 — canonical boundary-chattiness performance case study
- xterm.js GitHub issues (#518, #791) — scrollback memory cost data
- cockpit-project/cockpit issues (#14545, #7956) — Ctrl+W browser-key-intercept problem confirmed in production
- mintty#1299 — ESC Y +32 offset bug confirmed as real-world shipped defect
- VS Code Terminal renderer writeup — glyph atlas performance data

### Secondary (MEDIUM confidence)
- MicroBeast GitHub (atoone/MicroBeast) — hardware docs confirm 16c550 UART, CP2102N, 19200 baud default; VT52 usage patterns not documented
- Codepope "Beastly" post — confirms 19200 baud, "virtual VT52" terminology
- kgober/VT52 (Windows emulator) — feature set informs user expectations
- TOS VT-52 terminal documentation (Atari TOS) — precedent for pragmatic VT52 subset decisions
- vte crate docs (docs.rs) — confirms ANSI/VT500 state machine orientation; VT52 not mentioned

### Tertiary (LOW — MicroBeast-specific, needs device validation)
- Inferred 19200 8N1 no-flow-control default from community posts and UART docs
- Inferred CR/LF convention from general serial terminal behavior — unverified on real device
- Inferred BEL and graphics-mode usage from general CP/M software patterns — unverified on real device

---
*Research completed: 2026-04-21*
*Ready for roadmap: yes*
