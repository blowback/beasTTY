# Pitfalls Research

**Domain:** In-browser VT52 terminal emulator (Rust/wasm core + JS/Web Serial shell) as daily driver for MicroBeast Z80
**Researched:** 2026-04-21
**Confidence:** HIGH for Web Serial, wasm boundary, canvas HiDPI (verified across MDN, Chrome docs, WICG issues). MEDIUM for VT52 parser edge cases (VT52 is a small target, so most guidance is inferred from DEC manuals + related state-machine parsers). MEDIUM for daily-driver endurance (drawn from xterm.js/VSCode issue trackers and Chrome throttling docs).

## Critical Pitfalls

### Pitfall 1: The Web Serial Reader-Lock Deadlock on Disconnect

**What goes wrong:**
The JS shell calls `port.readable.getReader()` and enters a `while (true) { await reader.read() }` loop. When the MicroBeast is unplugged, or when the user clicks "Disconnect", calling `port.close()` throws because `readable` is locked to a reader; calling `reader.releaseLock()` throws because a `read()` is still pending; and the pending `read()` never resolves (there's nothing on the wire). The UI gets stuck in a half-connected state that a page reload is the only way to escape.

**Why it happens:**
The reader lock is held for the entire lifetime of the read loop, but `read()` is blocking indefinitely. Developers instinctively think "await read then release lock" — but you can't release a lock while a read is outstanding, and you can't stop the read except by cancelling the reader. WICG/serial#112 is the definitive reference for this deadlock.

**How to avoid:**
Stash the reader in a module-scoped variable at loop start. On any disconnect path (user click, `disconnect` event, error), call `reader.cancel()` *first*. That causes the pending `read()` to resolve with `{value: undefined, done: true}`, the loop exits, `reader.releaseLock()` succeeds, and `port.close()` works. Always call `cancel()` from the disconnect handler — never try to `close()` first.

**Warning signs:**
- During manual testing: unplug USB, UI says "disconnected" but reconnecting doesn't work, dev console shows "port already open" or "readable is locked".
- In code review: any `getReader()` without a matching `cancel()` path on *every* disconnect branch.
- Reload is required to recover from disconnect in manual smoke tests.

**Phase to address:**
Serial transport phase. Must have a cancellation-aware read loop from day one — retrofitting it later means rewriting the entire transport layer.

---

### Pitfall 2: Escape Sequence Split Across Chunk Boundaries

**What goes wrong:**
The MicroBeast sends `ESC Y 040 047` (direct cursor address to row 0 col 7). The OS delivers it to Web Serial as two chunks: `ESC Y 040` and `047`. If the VT52 parser is stateless per chunk — e.g., "scan for ESC, then switch on next byte" — it sees `ESC Y` plus a partial row byte, panics or emits garbage, and loses the column byte entirely. Screen corrupts. Worse: it might "work" in local testing at 9600 baud with an in-tree fake and break only on a real MicroBeast under load.

**Why it happens:**
Two related mistakes:
1. VT52 has exactly one multi-byte sequence (`ESC Y <row> <col>`) that's easy to forget when you're pattern-matching single-character escapes.
2. Web Serial chunks are *not* message-framed. Any boundary is legal. TCP programmers learn this the hard way; serial programmers sometimes don't because on slow links chunks *usually* align to commands.

**How to avoid:**
- Design the Rust parser as a byte-at-a-time state machine with explicit states (`Ground`, `Escape`, `CursorRow`, `CursorCol`). Never do "scan forward for the next byte" — always consume exactly one byte and transition. Paul Williams' state machine model (vt100.net/emu/dec_ansi_parser) is the right mental model even for VT52.
- Feed the parser byte-at-a-time from the wasm boundary — OR batch a whole chunk into the boundary call and iterate byte-at-a-time *inside* Rust (preferred — see Pitfall 4).
- Unit-test the parser with torn chunks: for every multi-byte sequence, split it at every internal offset and verify output is identical to the unsplit case.

**Warning signs:**
- Parser has any code that looks at "next byte" without a state transition in between.
- Tests pass with full-sequence input but never exercise split input.
- Visual corruption (cursor goes to wrong cell, stray characters) appears at high baud rates or bursty output but not slow output.

**Phase to address:**
Parser phase. The torn-chunk unit test is the single highest-leverage test in the whole project and must be written on day one of the parser.

---

### Pitfall 3: VT52 Cursor Addressing Byte Offset Mistake (`ESC Y` +32 bias)

**What goes wrong:**
`ESC Y <row> <col>` uses ASCII bytes offset by 040 octal (0x20, 32 decimal, the space character). Row 0 is sent as byte 040 (space). Row 1 is 041 (`!`). Row 23 is 067 (`7`). Developers frequently:
- Subtract 0x20 from the wrong byte (swap row/col order — VT52 is row-first, unlike some terminals).
- Treat the bytes as ASCII digits (`'0'` == 48, not 32) and get rows off by 16.
- Forget that the offset applies to the raw byte, not a parsed integer — so byte 0x41 (`A`) becomes row 33, not an error.
- Fail to clamp: if the MicroBeast sends bytes < 040 (bug in host software) the row/col underflow into huge values and the cursor-position state corrupts.

This exact bug has shipped in production terminal emulators — see mintty#1299 where VT52 `ESC Y` positioning was broken for years.

**Why it happens:**
VT52 is from 1975 and its encoding predates common conventions. DEC picked 040 because printable-ASCII-minus-space gives 94 valid positions, enough for 80x24. Modern developers assume "ASCII digits" or "binary" and get it wrong.

**How to avoid:**
- Read the DEC VT52 manual (vt100.net/docs/vt52-mm/chapter3.html) *before* writing the parser, not after.
- Implement as: `row = raw_byte.saturating_sub(0x20).min(MAX_ROW)` and same for col. Explicit saturation on underflow and clamp on overflow.
- Unit test with every edge: `ESC Y 0x20 0x20` → (0,0), `ESC Y 0x37 0x6F` → (23, 79), `ESC Y 0x1F 0x20` → clamped to (0,0), `ESC Y 0x7F 0x7F` → clamped to max.
- Test order: VT52 is row-then-col. Write a failing test that proves this before writing the state machine.

**Warning signs:**
- `vi`, `less`, or any full-screen MicroBeast program positions cursor in the wrong row by exactly 16 or 48 (0x30 vs 0x20 offset bug).
- Cursor "teleports off-screen" when a program tries to address the bottom of the screen.
- Bottom half of screen never gets written to.

**Phase to address:**
Parser phase. First visible end-to-end test should be running a full-screen MicroBeast program and seeing correct positioning.

---

### Pitfall 4: wasm↔JS Boundary Chattiness Tanking Performance

**What goes wrong:**
The obvious architecture — "JS reads a byte from serial, calls `wasm.feed_byte(b)`, wasm returns a render delta, JS applies it" — performs catastrophically. Every call across the JS/wasm boundary has non-trivial overhead (serialization, stack frames, memory copies). At 115200 baud that's 11.5k boundary crossings per second, plus returned objects being allocated and GC'd. Typing feels fine, but a `cat bigfile` from the MicroBeast tanks the frame rate or pegs a core.

**Why it happens:**
wasm-bindgen's idiomatic "call a function with arguments" pattern hides the boundary cost. Small functions look cheap. Training material often uses small demos where chattiness doesn't matter. See rustwasm/wasm-bindgen#1119 for a textbook example of this exact mistake tanking performance.

**How to avoid:**
- Design the wasm API in batches, not bytes: `feed_bytes(chunk: &[u8])` and `render_into(buf: &mut [u8])`. One boundary crossing per serial chunk, not per byte.
- Return render data via shared memory, not JS objects. Expose a "dirty cells" bitmap or a grid buffer in wasm linear memory, let JS read it via `Uint8Array` views on `wasm.memory.buffer`. Don't build JS objects in Rust.
- Keep string construction on the JS side. Don't allocate `String` in Rust and pass it out per-frame.
- Profile early: add a "1 MB dump" benchmark (`cat /dev/urandom | head -c 1048576` equivalent on MicroBeast) and measure throughput. Target: sustain at least 10x the configured baud rate.

**Warning signs:**
- Frame rate drops during bulk output (scrolling a long file, a directory listing).
- Chrome DevTools Performance tab shows lots of time in `__wbindgen_*` or `wasm-bindgen` glue.
- Memory growth visible during bulk output — pointing at per-byte allocations.

**Phase to address:**
Interop design phase, before writing any parser code. The boundary shape is load-bearing and expensive to change later.

---

### Pitfall 5: Canvas Rendering Goes Blurry on HiDPI

**What goes wrong:**
Terminal on a Retina MacBook or a 4K monitor looks fuzzy. Crisp bitmap phosphor aesthetic looks like mud. CRT theme has the opposite of its intended effect — the scanlines become smeared rather than sharp. Developer looks at it on their 1080p dev monitor and thinks it's fine.

**Why it happens:**
A `<canvas>` with `width="800" height="600"` at 1x DPR gets 800x600 backing pixels. At 2x DPR (Retina) that same canvas is still 800x600 backing pixels, stretched to cover a 1600x1200 CSS-pixel area — it's bilinearly upsampled by the browser. Monospace text and scanlines are exactly the kind of content where upsampling is most visible.

**How to avoid:**
- At init and on every resize: read `window.devicePixelRatio`, set `canvas.width = cssWidth * dpr` and `canvas.height = cssHeight * dpr`, set CSS width/height explicitly, and call `ctx.scale(dpr, dpr)` (or do the math yourself when drawing).
- Listen for DPR changes via `matchMedia("(resolution: ...)").addEventListener("change", ...)` — users can drag the window between monitors with different DPRs.
- Disable `imageSmoothingEnabled` for the phosphor/bitmap theme to keep pixels sharp.
- For a terminal with a fixed glyph cell, consider rendering each glyph once into an off-screen canvas at DPR-correct size and blitting — avoids repeated text-shaping and keeps pixels integer-aligned.

**Warning signs:**
- QA on any non-1x-DPR display immediately reveals blur.
- Text looks softer than native macOS/Windows terminal apps side-by-side.
- Visual regression: screenshots differ between machines.

**Phase to address:**
Rendering phase. Build the HiDPI-correct resize handler before you draw any glyphs. Retrofitting it is a rendering rewrite.

---

### Pitfall 6: Background-Tab Throttling Silently Loses Serial Data

**What goes wrong:**
User switches tabs during a long MicroBeast build/assembly. Chrome throttles the tab: `requestAnimationFrame` pauses, timers run once per minute, the render loop stops. Meanwhile the serial reader is still receiving — but if the JS pump is rAF-driven, bytes accumulate in the Web Serial internal buffer, then in a JS buffer, then eventually backpressure stalls reads. When the user switches back they see either a flood of delayed output (if everything was queued) or a hole in the session log (if the read loop stalled and the MicroBeast kept sending into the void). For a daily driver this means "I switched to my browser for 2 minutes and my build output is mangled."

**Why it happens:**
Chrome 57+ background throttling limits background timer CPU budgets to ~1% (developer.chrome.com/blog/background_tabs and blog/timer-throttling-in-chrome-88). Most web devs drive all their work from rAF because that's idiomatic for games/animations. Terminal-as-app doesn't fit that pattern — reads are I/O driven, not display driven.

**How to avoid:**
- **Decouple the serial read loop from rAF.** The read loop is `await reader.read()` forever, running independently of render. Rendering is rAF-driven, but reading is not.
- Use a separate append-only internal buffer (a ring buffer, or just a `Vec<u8>` in wasm) that the reader pushes into and the renderer drains. This way data is captured even when rendering is throttled.
- On `visibilitychange` → `visible`, trigger a catch-up render. Expect the dirty buffer to be large; make sure render-one-frame can handle it without blocking.
- For session logging (if you write to a file/`showSaveFilePicker`): flush writes on visibility change and on disconnect, not only on buffer-full — throttled tabs may never hit buffer-full.

**Warning signs:**
- Data loss after tab switch in manual testing.
- rAF callbacks appearing on the Performance timeline only when tab is active.
- Session log files have gaps corresponding to when the tab was backgrounded.
- User reports: "I left it running overnight, output is missing / garbled."

**Phase to address:**
Reliability/daily-driver hardening phase, but the architectural decision (read loop independent of render loop) must be made during transport design. Retrofitting this is a substantial refactor.

---

### Pitfall 7: Scrollback Unbounded Growth During Long Sessions

**What goes wrong:**
Author runs the emulator as their daily driver. Over a 6-hour work session they run long builds, watch logs, have `tail -f` style output. Scrollback grows without bound. At 80 cols × 1M lines × ~12 bytes/cell × cell overhead, memory hits 1-2 GB. Chrome tab OOMs, or the machine swaps, or the browser silently freezes during GC. This is the exact failure mode xterm.js#518 and related issues documented — a 160x24 × 5000 line buffer already uses ~34 MB, and it scales linearly.

**Why it happens:**
"Infinite scrollback" sounds great until it isn't. Simple data structures (array of row objects) have significant per-cell overhead. Each cell often carries color/attribute state even when the whole session is amber-on-black. Plus: in a naive implementation, the render loop may be walking the scrollback every frame for no good reason.

**How to avoid:**
- Set a default scrollback cap (say, 10000 lines = ~2.5 MB at 80 cols with tight encoding) with a clearly documented user-configurable override.
- Use a ring buffer, not a growable array. When full, oldest line is evicted in O(1).
- Encode cells tightly: `(u8 glyph, u8 attr)` is 2 bytes. For single-color VT52, arguably just `u8 glyph` + a sparse attr overlay. Don't use JS objects per cell.
- Store scrollback in wasm linear memory, not in JS objects. Keeps GC pressure near zero and memory dense.
- Never walk the full scrollback on every render — only the visible viewport.
- If session logging is a separate feature: route log writes to a file, not into scrollback. Scrollback is for scrolling; logging is for archiving.

**Warning signs:**
- Memory graph in DevTools climbs monotonically during use.
- Scrolling feels laggy after a long session (GC pauses).
- DevTools Memory snapshot shows huge arrays of small objects.
- Tab crash with "out of memory" after extended use.

**Phase to address:**
Scrollback implementation phase — decide the encoding and cap up front. Reliability hardening phase — verify 24+ hour continuous-use doesn't grow memory.

---

### Pitfall 8: Font Not Loaded When First Frame Renders

**What goes wrong:**
Page loads, wasm initializes, MicroBeast sends a welcome banner, renderer draws it — in the browser's fallback font (Times New Roman or whatever). A moment later the custom font finishes loading but the banner stays in the fallback font until it scrolls off. Looks unprofessional, breaks the retrocomputing aesthetic, and for the phosphor CRT theme it just looks broken.

**Why it happens:**
`@font-face` loads lazily — the font isn't fetched until it's actually needed. Canvas text rendering doesn't trigger the load. By the time `ctx.fillText("...", x, y)` is called, the font descriptor might exist but the actual font data hasn't arrived.

**How to avoid:**
- Before initializing the renderer, `await document.fonts.load("16px MyTermFont")` for each font actually used. Block the "ready to render" signal on font load.
- Use `document.fonts.ready` for a global "all fonts loaded" signal.
- Bundle the font with the static site (self-host) — don't rely on Google Fonts CDN (adds latency, privacy leak, external dep for a self-hosted daily driver).
- Use a `FontFace` object directly if you want precise control and explicit error handling.
- During dev: artificially delay font loading (DevTools Network tab → throttle) and verify the first render waits.

**Warning signs:**
- First few frames render in a system font, then switch.
- Layout shift at render-start when font dimensions change.
- Visual regression testing catches pre- vs post-font-load differences.

**Phase to address:**
Rendering phase. Trivial to fix if caught early, embarrassing if it ships.

---

### Pitfall 9: Browser Intercepting Critical Ctrl-Key Shortcuts

**What goes wrong:**
User is editing with `vi` or `ed` on the MicroBeast over the emulator. They press `Ctrl+W` to delete a word. Chrome closes the tab. Or `Ctrl+N` to open a new file → Chrome opens a new window. Or `Ctrl+T` to transpose → Chrome opens a new tab. Or `Ctrl+L` in emacs → Chrome focuses the URL bar. For a daily driver this is immediately disqualifying — the user loses work and trust.

**Why it happens:**
Browsers reserve some keyboard shortcuts for themselves. Calling `preventDefault()` in a `keydown` handler works for some (Ctrl+S, Ctrl+F, Ctrl+D) but does *not* work for others: Ctrl+W, Ctrl+N, Ctrl+T, Ctrl+Tab, Ctrl+Q and the whole Cmd-prefixed family on macOS are browser-exclusive unless you use the Keyboard Lock API — which only works in fullscreen. Cockpit project hit this exact issue (cockpit-project/cockpit#14545, #7956).

**How to avoid:**
- Capture keyboard events at `keydown` with `preventDefault()` for *every* key you want to forward to the MicroBeast. Do it synchronously in the handler, not in an async callback.
- Document the unrecoverable shortcuts clearly in a "Known Quirks" section of the UI. Users expect Ctrl+W to work; if it can't, tell them.
- Offer `navigator.keyboard.lock(['KeyW', 'KeyN', 'KeyT'])` when entering fullscreen mode (Keyboard Lock API — Chrome-only, works only in fullscreen). Provide an F11/"Enter Fullscreen" button so users who want Ctrl+W in vi can get it.
- Provide a chord alternative for the un-capturable cases: e.g., "Press `Esc w` to send Ctrl+W" (like tmux prefix keys). Not pretty, but functional.
- Be especially careful on macOS: Cmd+W closes the tab. Neither preventDefault nor Keyboard Lock save you. Document this.

**Warning signs:**
- User testing: any time a Ctrl-combo closes the tab.
- Keyboard layout discrepancy between OSes.
- Reports of "I lost my work when I pressed Ctrl+W."

**Phase to address:**
Keyboard input phase. Must document the constraint up front — affects feature scope (fullscreen mode, keyboard-lock support).

---

### Pitfall 10: Binary/High-Bit Bytes Corrupted by UTF-8 Decoder

**What goes wrong:**
Naive implementation: `const text = new TextDecoder('utf-8').decode(chunk); wasm.feed_string(text)`. The MicroBeast sends a byte > 0x7F — perhaps a block-drawing char from a program, perhaps a bit-flip glitch, perhaps a BEL followed by a raw byte. TextDecoder sees invalid UTF-8 and either throws (`fatal: true`) or silently replaces it with U+FFFD. Byte is lost. Parser never sees it. Worse: if a multi-byte partial sequence straddles a chunk boundary, TextDecoder holds state — and the held bytes come out "later" in the wrong chunk.

**Why it happens:**
Serial bytes aren't text. VT52 is a 7-bit protocol but the byte stream is 8-bit. Control characters are bytes, escape sequences are bytes, BEL is a byte. Treating the stream as a string is a category error that happens because TextDecoder is the "obvious" way to handle binary-to-string in the browser.

**How to avoid:**
- Pass raw bytes to wasm. Period. `Uint8Array` at the JS boundary, `&[u8]` in Rust. Never convert to `String` before feeding the parser.
- Keep the parser purely byte-oriented. ASCII printable bytes (0x20-0x7E) become glyphs; control bytes (0x00-0x1F, 0x7F) drive the state machine; high-bit bytes (0x80+) get a policy decision (drop? treat as printable box-drawing? pass through?) — but it's the *parser's* decision, not the transport's.
- Only convert to string at the *output* stage, per-glyph, when writing into the cell grid. Even there, many terminals just store the byte.

**Warning signs:**
- Missing bell/beeps (BEL 0x07 survives UTF-8 but some control bytes don't if a decoder is in fatal mode).
- Garbled output when the MicroBeast sends anything non-ASCII.
- Intermittent missing characters at chunk boundaries (the TextDecoder "holding" partial-UTF8 bug).

**Phase to address:**
Transport phase. Decide "bytes end-to-end" as a design principle before writing the read loop. Cheap to get right, expensive to undo.

---

### Pitfall 11: Serial Port Identity Mismatch on Reconnect

**What goes wrong:**
User plugs MicroBeast into USB-A port, grants permission, uses it for a while, unplugs, later plugs into USB-C port. The `disconnect` event fired, `connect` event fires for the new plug, but the SerialPort instance may be new/different (depending on USB addressing) — or worse: the user has also been tinkering with an Arduino, and when BestialiTTY auto-reconnects it picks the Arduino (same VID/PID family, different device) and dumps MicroBeast output into a surprised Arduino. Or calls `requestPort()` again and pops a modal every reconnect (annoying for a daily driver).

**Why it happens:**
The Web Serial API exposes a `SerialPort` object per device. Permissions are persisted per-origin by user grant. `getPorts()` returns already-granted ports. But matching "the port I was using before" to "the port that just reconnected" requires USB VID/PID info (`port.getInfo()`) and even then can be ambiguous if the user has two of the same device. WICG/serial#156 is the open issue on this.

**How to avoid:**
- On first connect: record `port.getInfo()` (`usbVendorId`, `usbProductId`) in `localStorage`.
- On `connect` event: find the port via `getPorts()`, match by VID/PID, check there's exactly one match. If ambiguous, prompt the user. If unambiguous, auto-reconnect silently.
- Show the matched VID/PID + name in the UI so the user can see *which* device is connected.
- Never call `requestPort()` from auto-reconnect. Only call it from an explicit user click (security + UX).
- Handle the case where `getPorts()` returns empty even after a grant — rare but happens on some platforms after certain sleep/wake cycles. Fall back to a "click to grant" prompt.

**Warning signs:**
- Auto-reconnect picks the wrong device in a multi-serial-device setup.
- Modal permission prompts appear on every reconnect.
- "Connected" state says yes but no bytes flow.

**Phase to address:**
Transport/reliability phase. If the author has only ever one serial device plugged in, this bug won't surface until they do — design for correctness from the start.

---

### Pitfall 12: DTR/RTS State Accidentally Resets MicroBeast on Connect

**What goes wrong:**
User connects. MicroBeast *resets* — they see the boot banner again, losing whatever state they had. Or it locks up because RTS went low and the MicroBeast's UART sees "stop sending" forever. Or on disconnect, DTR going low triggers a spurious event on the MicroBeast.

**Why it happens:**
On many USB-serial adapters (FTDI, CH340, CP2102, common in retrocomputing), DTR and RTS are wired to GPIOs that the retro system uses for resets or flow control. Arduino boards famously auto-reset when DTR toggles. Whether the MicroBeast does this depends on how its serial adapter is wired — and the user may not know. Default `port.open()` behavior for DTR/RTS isn't specified precisely; different OSes behave differently.

**How to avoid:**
- Explicitly set DTR and RTS state *immediately* after `port.open()`. Use `await port.setSignals({ dataTerminalReady: false, requestToSend: false })` as a safe default unless the user configures otherwise. Document this choice.
- Expose DTR/RTS state as user-configurable in the serial config UI — a MicroBeast user might actually *want* DTR-pulse-on-connect as their reset mechanism.
- Expose a "Send break" button (many retrocomputing workflows need it). Web Serial has no direct break API, so: either use `port.setSignals({ break: true })` where supported, or document the limitation. Check MDN/Chromium docs at time of implementation; this has evolved.
- On disconnect: explicitly de-assert DTR/RTS *before* close, rather than letting the close do it implicitly.

**Warning signs:**
- MicroBeast resets on connect (boot banner appears).
- MicroBeast locks up on connect (no bytes flow until power cycle).
- Behavior differs between users reporting otherwise identical setups (tell: it's OS-dependent).

**Phase to address:**
Transport phase — specifically serial config UI. Don't ship v1 without DTR/RTS control because the author's own MicroBeast might be fine but shipping this to other MicroBeast owners will surface the issue.

---

### Pitfall 13: Focus Loss Stops the World

**What goes wrong:**
User alt-tabs away to grab a doc, comes back. They start typing, but keys don't register — the terminal is visibly focused but the browser has moved focus to the URL bar or some parent element. They click the terminal; it "takes" focus; they keep typing. But during those seconds the user was confused. Worse: if the page uses a contenteditable or a hidden input for key capture, focus can land on the wrong element after alt-tab and swallow keys silently.

**Why it happens:**
Canvas itself is not focusable. You need a focus target (hidden textarea, `tabindex=0` canvas, or a wrapping div with `tabindex`). The focus management must survive tab switches, clicks on scrollback, clicks on toolbar buttons. Most naive "hidden input" implementations lose focus on any button click.

**How to avoid:**
- Use `<canvas tabindex="0">` or wrap with a `tabindex` div. Style `:focus` visibly (even a subtle outline) so the user can see focus state.
- On every button/control click in the toolbar: call `canvas.focus()` after handling the click (don't let focus stay on the button).
- On `visibilitychange` → visible: re-focus the canvas (optional, but nice for daily driver).
- On keyboard event: only handle keys when focus is on the terminal. If using a hidden input, make sure it's re-focused on toolbar interactions.
- Show the focus state explicitly in the UI — a subtle indicator that says "terminal has focus" / "click to focus". Retro terminals had a hardware-indicator light; modern replicas benefit from the equivalent.

**Warning signs:**
- Keys dropped after alt-tab or after clicking UI chrome.
- User confusion about "why isn't typing working."
- No visible focus state, or focus state inconsistent with actual keyboard behavior.

**Phase to address:**
Keyboard/UI phase. Low-tech, high-impact — catching this during UX review prevents daily-driver frustration.

---

### Pitfall 14: Full-Screen Canvas Redraw Per Byte

**What goes wrong:**
Every byte arrives → parser updates state → renderer redraws all 80×24 cells. At 115200 baud that's potentially 60fps worth of full redraws just from text, then another 60fps from rAF, and the whole screen's cell text is re-laid-out on every frame. CPU pegs, battery drains, laptop fans spin. For the CRT theme (which may layer scanlines, glow, persistence), it's worse.

**Why it happens:**
Canvas doesn't track dirty regions for you. The "easy" approach is to clear + redraw. Developers from the JS/React world may not realize that "full redraw is fast" (true for simple demos) doesn't hold at 30+ fps for text-heavy content on HiDPI.

**How to avoid:**
- Mark cells dirty during parser execution. Only redraw dirty cells.
- Pre-render glyphs into a glyph-atlas canvas (one glyph per attribute combo). Blit with `drawImage` — 10-100x faster than `fillText`.
- Decouple parser ticks from render ticks. Parser processes all pending bytes; renderer draws once per rAF.
- For effects (scanlines, glow): render them into a static off-screen overlay canvas, composite over the cell grid. Don't recompute per-frame.
- Cap render to rAF. Never render synchronously from the read loop.
- Profile at bulk-output. Target: 60fps at `cat bigfile` output without dropped frames.

**Warning signs:**
- Fan ramps up during heavy output.
- FPS drops in DevTools Performance during bulk text.
- Laptop battery dies noticeably faster than when browser is idle.
- "Feels laggy" after a long output.

**Phase to address:**
Rendering phase. Architect the dirty-region + glyph-cache pattern up front; the cost of retrofitting is a rendering rewrite.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Feed bytes one at a time across wasm boundary | Simple API, easy unit tests | Chattiness tanks throughput; rearchitecting the boundary is painful | Never — design batched from day 1 |
| `TextDecoder`-based transport | Works for ASCII, looks clean | Loses bytes; breaks on chunk boundary partial UTF-8; silently corrupts serial stream | Never for this project |
| Growable `Array` of row objects for scrollback | Easy to reason about, easy to index | 10-30x memory overhead vs tight encoding; GC pressure; OOM on long sessions | Prototyping only; rewrite before daily-driver use |
| Full canvas redraw every frame | Easy rendering code | CPU/battery drain; HiDPI blur if not careful; can't scale to CRT effects | Acceptable for first end-to-end demo; replace before shipping v1 |
| Keyboard handling via document-level listener without focus management | Catches all keys | Loses keys when focus moves; confusing UX | Never in daily-driver app |
| `JSON.stringify` for session log format | Human-readable, trivial to write | Balloons to 3-10x raw bytes; slow to flush; not a replayable format | Debug-only log; raw-byte log is the daily-driver format |
| Hardcoded 9600 baud MicroBeast preset, no UI override | Ships faster | Different MicroBeast firmware revisions use different defaults; user can't recover | Acceptable *if* UI override ships in same v1 (already in PROJECT.md scope) |
| Skip DTR/RTS control UI | Saves a config screen | MicroBeast resets unexpectedly; other users can't use at all | Never — ship with explicit control |
| Auto-reconnect without VID/PID match | Fewer clicks | Wrong device reconnects silently, data dumped into wrong serial peer | Never — always match by VID/PID |
| No scrollback cap | "Infinite" scrollback sells well | OOM on long sessions | Never — always cap with configurable override |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Web Serial `reader.read()` | Calling `port.close()` while read is pending → deadlock | Always `reader.cancel()` first, then close; keep reader reference module-scoped |
| Web Serial chunks | Assuming each chunk is a complete message | Treat as arbitrary byte stream; parser must be torn-chunk safe |
| Web Serial `setSignals()` | Not calling it on open → OS/driver default chosen, may reset device | Explicitly set DTR/RTS on open; expose in UI |
| Web Serial `disconnect` event | Listening only on the SerialPort instance | Listen on `navigator.serial` too (catches cases where the instance is swapped) |
| Web Serial `getPorts()` return | Assuming it returns a specific device | Match returned ports by VID/PID; handle empty-array case |
| wasm-bindgen `&str` arg | Thinking "string" is cheap | Each string pass does a UTF-8 encode + memory copy; batch and prefer `&[u8]` |
| wasm-bindgen returning JS objects from Rust per-frame | Looks idiomatic | GC churn; use shared memory views via `wasm.memory.buffer` |
| wasm-pack `--target bundler` for static site | Default in docs | Use `--target web` for raw ES module import on a static site; easier to self-host |
| wasm-pack async init | Blocking first render on import | `await init()` before rendering; load screen until ready |
| Canvas `ctx.font = "14px Mono"` | Calling before font is loaded | `await document.fonts.load("14px Mono")` first |
| Canvas `ctx.scale(dpr, dpr)` | Calling once at init | Re-apply on every resize and DPR change |
| `KeyboardEvent.keyCode` | Used for mapping, deprecated | Use `event.code` (physical key) for shortcuts; `event.key` for character input |
| `KeyboardEvent.preventDefault()` | In async handler | Must be synchronous in handler — async doesn't work |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-byte wasm boundary calls | CPU pegged during bulk output; GC pauses | Batch bytes; one boundary call per serial chunk | Any output >~1 KB/s sustained (so, always in practice) |
| Full-screen canvas redraw every byte | Fan ramps; FPS drops | Dirty-cell tracking + glyph atlas + decouple parse from render | Any sustained bulk output, or typing-fast |
| Scrollback as JS object array | Memory climbs; GC stalls | Tight byte encoding in wasm linear memory; ring buffer | After ~1000 lines, linearly worse after |
| Allocating a render delta object per byte | Memory climbs; GC stalls | Use shared-memory views; mutate in place | Any sustained output |
| Re-layout text on every redraw | `ctx.fillText` dominates profile | Glyph atlas / pre-rendered per-glyph canvas | Any output that scrolls |
| `ctx.clearRect` then redraw all | CPU for no reason | Dirty regions or cell-grid-only redraw | Always — avoid from day 1 |
| TextDecoder with partial-multibyte holding | Bytes appear "late" or not at all | Stay in bytes end-to-end | Chunk boundaries (so, often) |
| Session log as JS string concatenation | Memory climbs linearly with session | Stream to file handle (`showSaveFilePicker`); flush on visibility change | After ~100 KB of output |
| Rendering during background tab | Render loop stalled, data loss | Decouple reader from renderer; read loop is pure async | Any tab switch |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Auto-requesting serial permission on page load | User phishing-style bypass of intent | Only call `requestPort()` on explicit user click |
| Persisting granted-port identity in localStorage without user visibility | User doesn't know which device is being auto-connected to | Show matched VID/PID + port name in UI; let user revoke |
| Inline eval / dynamic script for escape-sequence handling | XSS-style risk if MicroBeast output is ever logged to HTML | Parser is pure bytes→grid; never treat MicroBeast output as HTML |
| Session log stored without user opt-in | Privacy: terminal sessions may contain secrets/passwords | Make session logging explicit opt-in with a visible indicator when recording |
| Pasting clipboard straight to serial | Paste may contain control chars / escape codes that surprise | Offer a "bracketed paste" mode or at least show what's being pasted for multi-line pastes |
| `unload` handler not closing serial | Device left in weird state; next session harder | Close port on `beforeunload` (best effort — browsers limit what's allowed) |
| Not scoping Permissions-Policy | Embedded iframes gain serial access | Ship with `Permissions-Policy: serial=(self)` on self-hosted deployment |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visible connection/focus state | User types, nothing happens, doesn't know why | Always-visible "connected to VID:PID" and "terminal has focus" indicators |
| Silent permission-denied | User clicks connect, nothing visible changes | Show explicit "no port selected" / "permission denied" with retry button |
| No "reset / reconnect" button | User stuck after transient error, must reload | Prominent reconnect button; one-click recovery |
| Scrollback scrolls while new output arrives | User reviewing history has it yanked away | Detect user scroll; pause auto-scroll until bottom reached again |
| No copy-paste affordance | User has to guess how to copy (Ctrl+C is a control code in terminals!) | Dedicated copy button, or Ctrl+Shift+C for copy (mimicking GNOME Terminal) |
| No way to send break | Retrocomputing workflows need it, user can't recover | Explicit "Send Break" button |
| Config lost on reload | User re-configures baud every time | Persist serial config in localStorage |
| CRT theme on low-contrast monitor unreadable | Aesthetic trumps readability | User-toggleable; default to clean modern theme |
| Font size fixed or tied to window | Unreadable on 4K / too big on laptop | User-adjustable font size (Ctrl+/- or zoom) |
| No indication of "the thing crashed" | Dead terminal looks identical to idle | Show connection errors and read-loop exceptions visibly |
| Modifier+character sent wrong on non-US layout | German/French users type wrong codes | Test with at least a couple of non-US layouts; document known quirks |

## "Looks Done But Isn't" Checklist

- [ ] **VT52 parser:** Often missing torn-chunk handling — verify by splitting every multi-byte sequence at every boundary in unit tests
- [ ] **VT52 parser:** Often missing correct `ESC Y` byte offset (0x20 bias) — verify with end-to-end test against real MicroBeast full-screen program
- [ ] **Web Serial transport:** Often missing `reader.cancel()` in disconnect path — verify by simulating unplug and confirming port can be reopened
- [ ] **Web Serial transport:** Often missing visibility-change handling — verify data continues flowing and is not lost when tab is backgrounded for minutes
- [ ] **Web Serial transport:** Often missing VID/PID-matched auto-reconnect — verify plugging into a different USB port reconnects same device
- [ ] **Web Serial transport:** Often missing DTR/RTS explicit state on open — verify MicroBeast does not reset on connect
- [ ] **Canvas rendering:** Often missing `devicePixelRatio` handling — verify crisp rendering on HiDPI displays and on window drag to external monitor
- [ ] **Canvas rendering:** Often missing font-load gate — verify first frame uses correct font (throttle network to catch this)
- [ ] **Canvas rendering:** Often missing dirty-region optimization — verify CPU stays low during bulk output
- [ ] **wasm interop:** Often missing batched API — verify throughput of at least 10× baud rate on a 1 MB dump benchmark
- [ ] **wasm interop:** Often missing shared-memory render path — verify no per-frame JS object allocations in DevTools
- [ ] **Keyboard input:** Often missing `preventDefault()` for every forwarded key — verify Ctrl+F doesn't open find, Ctrl+S doesn't save page, etc.
- [ ] **Keyboard input:** Often missing arrow-keys-in-alternate-keypad-mode — verify ESC A/B/C/D behavior after `ESC =` / `ESC >`
- [ ] **Keyboard input:** Often missing IME awareness — verify `event.isComposing` check so IME doesn't double-emit
- [ ] **Scrollback:** Often missing cap — verify 24-hour session doesn't grow memory unbounded
- [ ] **Scrollback:** Often missing "stick to bottom unless user scrolled" — verify user can scroll up to read without being yanked back
- [ ] **Session log:** Often missing flush on visibility change / disconnect — verify log file is complete after tab close / unplug
- [ ] **Focus management:** Often missing re-focus after toolbar clicks — verify typing works after clicking any UI button
- [ ] **Reliability:** Often missing 24-hour soak test — verify daily-driver endurance before declaring v1 done
- [ ] **Reliability:** Often missing break-signal control — verify `Send Break` button exists and works on real MicroBeast
- [ ] **Connection UX:** Often missing "no Chromium" polite-fail — verify Firefox/Safari shows the intended message, not a stack trace

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Reader-lock deadlock on disconnect | LOW | Add `cancel()` path; retrofit read loop to a known-safe pattern; smoke test unplug |
| Split-chunk parser bug | MEDIUM | Add torn-chunk tests for each multi-byte sequence; fix parser; regression via tests going forward |
| `ESC Y` offset bug | LOW | One-line fix if the test suite is right; major embarrassment if a user hit it first |
| wasm boundary chattiness | HIGH | Redesign API surface; likely rewrite parser entry; measure before claiming fixed |
| HiDPI blur | LOW-MEDIUM | Add DPR handling + resize handler; if rendering already non-trivial, integrate carefully to avoid double-scale bugs |
| Background-tab data loss | HIGH | Decouple read loop from render loop; this is an architecture change, not a patch |
| Unbounded scrollback OOM | MEDIUM | Add cap + ring buffer; migrate scrollback storage to wasm linear memory |
| Font not loaded | LOW | Add `await document.fonts.load()` gate before first render |
| Ctrl-key intercept | MEDIUM | `preventDefault()` audit; Keyboard Lock API integration for fullscreen; document un-capturable cases |
| UTF-8 decoder byte loss | MEDIUM | Rip out TextDecoder; switch to byte end-to-end; re-test all escape sequences |
| Wrong-device reconnect | LOW | Add VID/PID matching; manually tested with two devices |
| DTR/RTS resets device | LOW | Add `setSignals` call on open + UI toggle |
| Focus loss | LOW | Add `tabindex`, focus-on-click, focus-on-toolbar-button |
| Full-redraw performance | HIGH | Add dirty-cell + glyph atlas; likely a rendering rewrite |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Reader-lock deadlock | Transport (serial I/O) | Smoke test: unplug USB, re-plug, re-open port successfully without reload |
| Split-chunk escape sequence | Parser | Unit test: split each multi-byte VT52 sequence at every internal offset, assert identical result |
| `ESC Y` offset bug | Parser | Unit test: all edges of cursor address encoding; end-to-end test with a real MicroBeast full-screen program |
| wasm boundary chattiness | Interop design (pre-parser) | Benchmark: 1 MB dump throughput ≥ 10× baud rate; DevTools shows few boundary crossings per chunk |
| HiDPI blur | Rendering | Visual check on ≥ 2× DPR display; drag-between-monitors test |
| Background-tab data loss | Transport + reliability hardening | Switch tabs for 2+ minutes during `cat bigfile`; verify all bytes logged |
| Unbounded scrollback | Scrollback implementation | 24-hour soak test, memory graph flat |
| Font not loaded race | Rendering | DevTools network throttle → first frame is correct font |
| Ctrl-key intercept | Keyboard input | Press every likely terminal shortcut; verify Chrome doesn't hijack or document the quirk |
| UTF-8 decoder byte loss | Transport design (pre-parser) | Binary smoke test: send full 0x00-0xFF range, verify all bytes reach parser |
| Wrong-device reconnect | Transport (reliability) | Two-device test: plug MicroBeast and Arduino, unplug/replug MicroBeast, verify correct device rebound |
| DTR/RTS device reset | Transport / serial config UI | Connect → verify MicroBeast does not re-banner; test with DTR/RTS toggles in UI |
| Focus loss | Keyboard / UX | Click every toolbar button, verify typing still works; alt-tab and back, verify typing still works |
| Full-redraw performance | Rendering | Profile during bulk output; fan doesn't spin; FPS stable |
| IME double-emit | Keyboard | Test with Japanese IME enabled (even if not in daily-driver use, prevents ugly bug reports) |
| Break signal support | Transport / UX | Click "Send Break" while connected to MicroBeast; verify expected interrupt behavior |
| Session log gaps | Reliability | Back-grounded tab during long output, verify log file complete |
| Chromium-only polite fail | Deployment / landing page | Load in Firefox, Safari; verify clean message, no stack traces |

## Sources

- [WICG/serial#112 — Need method to break/terminate reader](https://github.com/WICG/serial/issues/112) — the canonical reader-lock deadlock issue
- [WICG/serial#156 — Auto-reconnecting guidance needed](https://github.com/WICG/serial/issues/156) — reconnection identity
- [WICG/serial#128 — Need to identify previously used port](https://github.com/WICG/serial/issues/128) — VID/PID matching
- [Chrome for Developers: Read from and write to a serial port](https://developer.chrome.com/docs/capabilities/serial) — official reader.cancel() pattern
- [MDN: SerialPort.setSignals()](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/setSignals) — DTR/RTS control
- [MDN: SerialPort disconnect event](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/disconnect_event)
- [MDN: Serial.requestPort()](https://developer.mozilla.org/en-US/docs/Web/API/Serial/requestPort) and [Serial.getPorts()](https://developer.mozilla.org/en-US/docs/Web/API/Serial/getPorts)
- [Web Serial API spec (WICG)](https://wicg.github.io/serial/)
- [rustwasm/wasm-bindgen#1119 — Very poor Rust/WASM performance vs JavaScript](https://github.com/rustwasm/wasm-bindgen/issues/1119) — canonical boundary-chattiness case study
- [wasm-bindgen performance guide](https://github.com/rustwasm/wasm-bindgen/blob/main/guide/src/examples/performance.md)
- [wasm-bindgen: Without a Bundler](https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html) — `--target web` deployment
- [wasm-bindgen deployment guide](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html)
- [Hacker News: Faster wasm-bindgen for high-frequency JS↔Rust calls](https://news.ycombinator.com/item?id=45664341)
- [MDN: Window.devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)
- [web.dev: High DPI Canvas](https://web.dev/articles/canvas-hidipi)
- [web.dev: Improving HTML5 Canvas performance](https://web.dev/articles/canvas-performance)
- [MDN: Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [MDN: CanvasRenderingContext2D.font](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font)
- [Chrome for Developers: Background tabs in Chrome 57](https://developer.chrome.com/blog/background_tabs) — background throttling
- [Chrome for Developers: Heavy throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [VT100.net: VT52 DECscope Maintenance Manual, Chapter 3](https://vt100.net/docs/vt52-mm/chapter3.html) — authoritative VT52 escape sequence reference
- [VT100.net: VT52 DECscope Maintenance Manual, Chapter 1](https://vt100.net/docs/vt52-mm/chapter1.html)
- [Wikipedia: VT52](https://en.wikipedia.org/wiki/VT52)
- [VT100.net: Paul Williams ANSI parser state machine](https://vt100.net/emu/dec_ansi_parser) — parser design
- [microsoft/terminal#2017 — First draft of a spec for VT52 escape sequences](https://github.com/microsoft/terminal/pull/2017)
- [microsoft/terminal: VT52 escape sequences spec](https://github.com/microsoft/terminal/blob/main/doc/specs/%23976%20-%20VT52%20escape%20sequences.md)
- [mintty#1299 — VT52 ESC Y cursor addressing broken](https://github.com/mintty/mintty/issues/1299) — real-world case of the `ESC Y` offset bug shipping
- [xterm.js#518 — Setting scrollback to infinite](https://github.com/xtermjs/xterm.js/issues/518) — scrollback memory cost data
- [xterm.js#791 — Buffer performance improvements](https://github.com/xtermjs/xterm.js/issues/791)
- [xterm.js#1518 — Prevent memory leaks when Terminal.dispose is called](https://github.com/xtermjs/xterm.js/issues/1518)
- [microsoft/vscode#155232 — Integrated terminal still leaks GPU memory](https://github.com/microsoft/vscode/issues/155232)
- [cockpit-project/cockpit#14545 — Terminal: Provide way to input Ctrl+W](https://github.com/cockpit-project/cockpit/issues/14545)
- [cockpit-project/cockpit#7956 — terminal: protect against Ctrl+W closing the tab](https://github.com/cockpit-project/cockpit/issues/7956)
- [Chrome for Developers: Keyboard Lock API](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock)
- [MDN: Element keydown event](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event)
- [MDN: KeyboardEvent.ctrlKey](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/ctrlKey)
- [Not Rocket Science: Handling IME events in JavaScript](https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/)
- [MDN: TextDecoderStream](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream) — and why it's the wrong tool for 8-bit serial
- [Terry Koziniec: Sending a BREAK signal in Serial Terminal Applications](https://www.koziniec.com/howto/2024/02/10/Sending-a-BREAK-signal-in-Terminal-Applications.html)
- [Wikipedia: Data Terminal Ready (DTR)](https://en.wikipedia.org/wiki/Data_Terminal_Ready)
- [MDN: Permissions-Policy: serial](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/serial)

---
*Pitfalls research for: in-browser VT52 terminal emulator (Rust/wasm + Web Serial) as daily driver for MicroBeast Z80*
*Researched: 2026-04-21*
