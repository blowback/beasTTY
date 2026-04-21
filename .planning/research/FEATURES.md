# Feature Research

**Domain:** In-browser VT52 terminal emulator for MicroBeast Z80 retrocomputer (Web Serial, Chromium-only)
**Researched:** 2026-04-21
**Confidence:** MEDIUM-HIGH

## Scope Note (Read Before Reading Table)

v1 has **already committed** to the following — they are NOT repeated in the
tables below as "must have," they are baseline:

- Pragmatic VT52 parser (MicroBeast subset only; not DEC-strict, not ANSI, not H19)
- Web Serial transport (Chromium-only, polite fail elsewhere)
- Scrollback buffer
- Copy out / paste into the stream
- Session logging to downloadable file
- Two themes: CRT (phosphor + optional scanlines/glow) and clean monospace
- Serial preset (MicroBeast default: 19200 8N1, no flow control — inferred from
  16c550 UART docs and community posts) with baud / data / stop / parity /
  flow override
- Rust/wasm core split from JS shell
- Rust unit tests on parser and state machine

v1 has **already rejected** (out of scope, do not re-propose):

- Alternative transports (WebSocket, WebUSB, mock backend)
- MicroBeast-specific key codes / configurable keymap remapping
- Full strict DEC VT52 / ANSI / VT100 / H19
- Browser-side automated / golden-trace tests
- Firefox / Safari support
- Hosted public-URL deployment as a service

Everything below is about **what else** a daily-driver VT52 emulator needs or
benefits from, on top of that baseline — and what to deliberately keep out.

## Feature Landscape

### Table Stakes (Users Expect These)

Features a MicroBeast owner will assume just work. Missing any of these and
the emulator fails the "daily driver" test.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Connect / Disconnect button with clear state | Web Serial is an explicit-permission API — user must initiate, and must be able to tear down | LOW | Single stateful button ("Connect" → "Disconnect"); `navigator.serial.requestPort()` gated on click |
| Visible connection status (connected / disconnected / port gone) | Silent failure is the #1 complaint in every Web Serial terminal review | LOW | A small status line or color-coded indicator. Google's reference terminal uses this |
| Visible, non-confusing cursor | A VT52 screen without a cursor is unusable for command-line work | LOW | Block cursor is historically correct; blink optional. Steady-block on unfocused, blinking-block on focused is modern convention |
| Bell handling (BEL 0x07) | MicroBeast firmware can emit BEL; silently dropping it is a bug users notice the first time | LOW | At minimum: visual flash of screen / title bar. Audible bell optional and should default OFF (browser autoplay rules + annoyance) |
| VT52 cursor movement (ESC A/B/C/D/H/I) | Any screen-oriented CP/M program (`ed`, BASIC line editor, monitor) will break without these | LOW | Already in "pragmatic VT52 parser" — flagged here because it's THE core thing |
| VT52 direct cursor addressing (ESC Y row col, +32 biased) | Full-screen CP/M programs (editors, menus) are unusable without it | LOW | Note the +32 bias — it's the classic beginner bug |
| VT52 erase (ESC J end-of-screen, ESC K end-of-line) | Used by every full-screen program for redraw | LOW | Part of the parser baseline |
| Correct keyboard mapping for arrows and editing keys | Arrow keys on a PC keyboard must transmit VT52 `ESC A/B/C/D` or editors are dead | LOW | v1 spec already says "stock PC→VT52 mapping" — confirming it's table stakes |
| Ctrl-key combinations transmit correct control bytes | Ctrl-C, Ctrl-D, Ctrl-Z are reflex for any CP/M user | LOW | Standard 0x00–0x1F mapping; watch for browser-reserved combos (Ctrl-W, Ctrl-N, Ctrl-T) |
| Readable default font at a comfortable default size | First impression; a too-small or wrong-metric font reads as "toy" | LOW-MEDIUM | 80×24 must fit on a typical laptop viewport without squinting. For CRT theme use a bitmap/pixel font; for clean theme a modern monospace |
| 80×24 screen geometry | VT52 programs assume 80×24 exactly. Anything else breaks redraw | LOW | Fixed geometry, centred in viewport. Don't let window resize change the terminal size |
| Focus indicator on the terminal surface | User needs to know whether keystrokes go to the terminal or the browser chrome | LOW | Border colour change or cursor style change on focus/blur |
| Paste does not commit a mass of keystrokes silently | Pasting a long line into a naive VT52 target (19200 baud, no flow control) overruns input buffers | LOW-MEDIUM | At minimum: throttle paste to serial line rate. Ideally: confirm pastes over N bytes or containing newlines |
| Works on first open (sane defaults) | Requiring configuration before connecting is a daily-driver-killer | LOW | MicroBeast preset pre-selected; just click Connect |

### Differentiators (Polish That Makes It Feel Finished)

These are where this project earns its "finally a nice one" reputation. Each
is small on its own; together they separate a polished tool from a hobby
project.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-reconnect on USB re-plug | MicroBeast is a physical kit; USB gets bumped. `navigator.serial`'s `connect` event lets you re-open the same port without a permission prompt | LOW-MEDIUM | Listen for `connect`/`disconnect` events on the Serial object and re-open the previously-granted port |
| Persistent preferences (theme, font size, last-used serial config) | A daily driver that forgets your setup every reload is infuriating | LOW | `localStorage` for theme / font size / serial params. Not port itself — permission is per-origin but port handle isn't persistable across reloads without `getPorts()` |
| Restore previously-granted port on reload | Reload shouldn't require re-picking the port from the chooser | LOW | `navigator.serial.getPorts()` returns previously-granted ports; match against a remembered identifier (vendor/product ID) |
| Font size zoom (Ctrl +/-, Ctrl 0) | Screen-sharing, presentation, tired eyes. Every mature terminal has this | LOW | Integer multipliers preferred for bitmap font (pixel-perfect scaling). CSS `transform: scale()` on a canvas surface works |
| Visible bell as screen flash + tab title indicator | MicroBeast emits BEL on errors; a silent bell is worse than no bell | LOW | Flash screen for ~100ms; optionally add `(!)` to document.title when tab is backgrounded |
| CR/LF handling toggle | Serial devices are inconsistent about line endings. Even on the MicroBeast, different CP/M programs behave differently. Without a toggle, users see double-spaced or crammed output | LOW | Per baseline-VT52 convention: treat LF alone as "go down, same column"; CR alone as "column 1"; both = newline. But expose a toggle for "LF implies CR" as a fallback because this is the single most common "it's broken" complaint on serial-terminal GitHub issues |
| Local echo toggle (default off) | Some MicroBeast states don't echo (bootloader, monitor shortcuts). Users occasionally need local echo to see what they're typing | LOW | Standard serial-terminal feature. Default OFF (MicroBeast echoes normally); expose as a checkbox |
| Send Break button | A break signal is sometimes the only way to interrupt a wedged MicroBeast program | LOW | `SerialPort.setSignals({ break: true })`, hold ~250ms, release. Dedicated button, not a keybind (too easy to trigger by accident) |
| "Save session log" button with default-on logging | v1 already has session logging; the differentiator is starting logging automatically per connect and letting user download at any time | LOW | Auto-rotate per connect; expose a "download current log" button that doesn't disconnect |
| Graceful "port went away" recovery | USB-C cable gets wiggled; without this the page feels broken and you have to reload | LOW | On `disconnect` event: mark disconnected, stop the read loop cleanly, surface a "reconnect?" prompt. Do NOT silently retry forever |
| Scanline/phosphor intensity slider for CRT theme | v1 has CRT theme; differentiator is letting users dial it to taste without a rebuild. Full CRT effect gives headaches after an hour | LOW | 0–100% slider; also expose phosphor colour choice (green / amber / white) since those are the classic three |
| Keyboard shortcut to toggle theme | Theme switching should be a keystroke, not a menu dive | LOW | e.g. Ctrl-Shift-T or a small corner button |
| "Clear screen" button (local, not serial) | Sometimes you want a clean scrollback without disconnecting. Distinct from ESC J from the remote | LOW | Local operation: wipes visible screen + optionally scrollback. Does not send anything over serial |
| Per-theme cursor choice | CRT theme wants a blinky block that matches the aesthetic; clean theme wants a subtler cursor | LOW | Part of theme definition, not a separate user setting |
| Handle ESC F / ESC G graphics mode minimally (even if just "pass-through printable range") | MicroBeast software may emit these; an emulator that black-boxes them looks half-built | LOW-MEDIUM | Parse and ignore-but-don't-break is the minimum; rendering the math glyphs is a small bonus |
| Handle ESC = / ESC > alternate keypad mode as a no-op toggle | Some CP/M programs emit these. Don't need to actually remap the keypad; just don't treat the ESC as garbage | LOW | Parse and swallow |
| Handle ESC Z identify query with a canned reply | A program may probe with ESC Z expecting ESC / K response. Without it, some auto-detection logic upstream hangs | LOW | Reply with `ESC / K` (VT52 identify response) on the serial line |
| Error state when browser isn't Chromium | Spec'd in v1 already; quality depends on the copy — "Use a Chromium-based browser (Chrome, Edge, Brave) — this page uses Web Serial" beats a generic "not supported" | LOW | Detect `'serial' in navigator` before any UI renders |

### Anti-Features (Commonly Requested, Deliberately NOT Built)

Features that sound useful but either break the project's scope, belong in a
different tool, or fail the "daily driver on one MicroBeast" test.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Tabs / multiple concurrent sessions | Users coming from modern terminals expect tabs | Scope explosion: multiplexing, per-tab state, tab-switch keybinds. A browser already has tabs — open the site twice | Open the page in a second browser tab; permissions are per-origin so this works for free |
| Split panes / tmux-style multiplexer | Same instinct as tabs | VT52 has no concept of panes; the MicroBeast emits a single 80×24 stream. Adding panes means inventing a layer above the terminal | "Just open two tabs" |
| SSH / Telnet / raw TCP transport | Other VT52 emulators (kgober's VT52) support these | Scope creep; requires a WebSocket bridge server, which directly contradicts the static-site-only constraint | Use a different emulator for those jobs; BestialiTTY is Web Serial |
| VT100 / ANSI / Heath H19 mode | Users may want to use the same app for their Raspberry Pi serial console | Doubles the parser surface area for zero MicroBeast benefit. VT100 ≠ VT52 supersets cleanly; you end up with a worse VT100 AND a worse VT52 | Different tool for different jobs; out of scope is out of scope |
| 256-colour / truecolor support | Comes from modern terminal muscle memory | VT52 has no colour at all. The CRT theme's phosphor palette IS the colour scheme | Theme colour is a rendering choice, not a protocol feature |
| Configurable keymap / keybinding editor | "But I want Option-arrow to send ESC-b" | v1 scope explicitly excluded this. Ships stock PC→VT52 mapping. Adding a keymap UI is a settings-panel rabbit hole | Stock mapping; if it matters to one user enough, they can fork |
| Mouse selection → auto-copy + middle-click paste (X11 style) | Unix muscle memory | Conflicts with browser text-selection semantics and requires dedicated mouse event plumbing on canvas. v1 already has explicit copy/paste | Use the existing copy/paste; don't reinvent X11 selection on canvas |
| Rich-text / hyperlink detection in scrollback | Terminal.app, iTerm2, wezterm do this | VT52 output has no URLs in it in any reasonable workload — this is solving a problem MicroBeast doesn't have | None needed |
| Sixel / Kitty graphics / image protocols | Modern terminal flex features | MicroBeast never emits them; parser-state cost is not free | Don't implement |
| Command history / fuzzy recall / AI features | Warp, Ghostty marketing pages make this look essential | The MicroBeast side of the wire has its own history (CP/M `HISTORY`, BASIC `LIST`) — the emulator shouldn't layer its own | The remote side handles shell history |
| Tab completion | Same as history | Same — remote concern | Same |
| Settings synced across devices / cloud accounts | "I want my CRT scanline level on both laptops" | Requires auth + backend; violates static-site constraint | `localStorage`; export/import settings as JSON if it ever matters |
| File transfer (XMODEM / YMODEM / ZMODEM) | Classic serial-terminal feature | Non-trivial state machine, separate from VT52 parsing, and arguably a different product. Plus MicroBeast CP/M already has its own transfer paths | Out of scope for v1; consider post-validation if author actually wants it |
| Macros / scripted input replay | "I type the same boot sequence every time" | Scope creep; scripting surface. The author said daily driver, not REPL automator | Paste a multi-line block (throttled); if that's not enough, different tool |
| Bell sound file customisation | "I want the Mac Plus beep" | Browsers can't autoplay audio without user interaction; most users will want bell muted anyway | Visual bell; if audible ships, single default tone, muted by default |
| Screen-reader support for the terminal surface | General accessibility expectation | Canvas-rendered terminals are notoriously hostile to a11y. v1 target user is the author on their own MicroBeast; the bar is different from a shared tool. Worth acknowledging as a gap, not worth blocking v1 on | Document the limitation honestly; revisit if real users ask |
| "Dark mode" as a separate concept from themes | Users ask for dark mode reflexively | Both v1 themes are already dark (CRT phosphor on black; clean monospace on dark background by default). A light theme has no constituency for a terminal | Both shipped themes are dark by default. If anyone wants a light clean theme, it's one palette tweak — not a third theme |

## Feature Dependencies

```
Pragmatic VT52 parser  (already in v1)
    └── requires ──> Correct keyboard mapping (arrows send ESC A/B/C/D)
    └── requires ──> ESC Z identify response (some software probes)
    └── enhances ──> ESC F/G graphics mode (pass-through minimum)
    └── enhances ──> ESC =/> alt keypad (no-op toggle minimum)

Web Serial transport  (already in v1)
    └── requires ──> Connect/Disconnect UI
    └── requires ──> Visible connection status
    └── requires ──> Graceful port-went-away recovery
    └── enhances ──> Auto-reconnect on USB re-plug
    └── enhances ──> Restore previously-granted port on reload
    └── enhances ──> Send Break button

Scrollback + Copy/Paste  (already in v1)
    └── requires ──> Paste throttling (serial line overrun protection)
    └── enhances ──> "Clear screen" local button

Themes (CRT + clean)  (already in v1)
    └── enhances ──> Scanline/phosphor intensity slider
    └── enhances ──> Phosphor colour choice (green/amber/white)
    └── enhances ──> Theme-toggle keyboard shortcut
    └── requires ──> Per-theme cursor definition

Session logging  (already in v1)
    └── enhances ──> Auto-rotate per connection, mid-session download button

BEL handling
    └── enhances ──> Visible flash + title-bar indicator
    └── optional ──> Audible bell (default off)

Persistent preferences
    └── requires ──> localStorage schema
    └── enhances ──> Theme/font-size/serial-config all persisted
```

### Dependency Notes

- **Paste throttling is a hard requirement, not a nicety:** At 19200 baud
  with no flow control (MicroBeast default), a pasted line longer than the
  MicroBeast's input buffer gets dropped silently. This is the single most
  likely user-visible failure mode once the terminal "works."
- **`getPorts()` → auto-reconnect is a short chain:** Listing previously
  granted ports on load lets you attach without a prompt. This is the
  highest polish-per-line-of-code feature available.
- **Identify response (ESC Z → ESC / K) matters more than it looks:** Some
  CP/M full-screen programs probe to decide which escape-sequence dialect
  to use. A non-responding terminal hangs them or makes them fall back to
  line mode.

## MVP Definition

### Launch With (v1) — Baseline Already Committed

v1 baseline (from PROJECT.md), reiterated for completeness:

- [ ] Pragmatic VT52 parser covering what MicroBeast emits
- [ ] Web Serial transport (Chromium-only, polite fail elsewhere)
- [ ] Scrollback, copy/paste, session logging
- [ ] CRT and clean themes with toggle
- [ ] Serial presets with override
- [ ] Standard PC→VT52 key mapping
- [ ] Rust/wasm core + JS shell split
- [ ] Unit tests on Rust core

### Launch With (v1) — Additional Table Stakes From This Research

These are things v1 needs that weren't explicitly enumerated in PROJECT.md
but are implicit in "daily driver":

- [ ] Connect / Disconnect button with clear state — explicit UI, not a hidden menu
- [ ] Visible connection status indicator (connected / disconnected / port lost)
- [ ] Visible cursor (block, per-theme styling)
- [ ] BEL (0x07) handling — visible bell at minimum (screen/title flash)
- [ ] Focus indicator on the terminal surface
- [ ] Paste throttling to avoid overrunning the MicroBeast at 19200 baud
- [ ] Working defaults on first open (MicroBeast preset pre-selected, one click to connect)
- [ ] ESC Z identify response (ESC / K) — required by some full-screen CP/M programs
- [ ] ESC F / G / = / > parsed as no-ops (don't corrupt screen on unhandled-but-legal sequences)
- [ ] Clear "this needs Chromium" message on unsupported browsers (spec'd in v1 already — noting the copy quality matters)
- [ ] Sensible CR / LF default matching MicroBeast behaviour (verified via real device during Phase 1 research)

### Add After Validation (v1.x) — High-Polish Differentiators

Small individually, large cumulatively. Order roughly by ROI:

- [ ] Restore previously-granted port on reload via `navigator.serial.getPorts()`
- [ ] Auto-reconnect on USB re-plug via `connect` event
- [ ] Persistent preferences in `localStorage` (theme, font size, last serial config, bell audible y/n, local echo y/n)
- [ ] Font size zoom (Ctrl +/-, Ctrl 0) with integer multipliers for CRT bitmap font
- [ ] Send Break button
- [ ] Scanline / phosphor intensity slider + phosphor colour choice (green/amber/white)
- [ ] Theme-toggle keyboard shortcut
- [ ] Local echo toggle
- [ ] CR/LF handling override toggle (for edge-case MicroBeast software)
- [ ] "Clear screen" local button (distinct from ESC J)
- [ ] Mid-session "download log now" button
- [ ] Render VT52 graphics-mode glyphs (math fractions, scan lines) if any MicroBeast workload actually uses them

### Future Consideration (v2+)

Deferred unless daily-driver use surfaces a need:

- [ ] Audible bell with one default tone, muted by default
- [ ] Export/import settings as JSON
- [ ] XMODEM/YMODEM/ZMODEM file transfer (only if author personally wants it — otherwise skip)
- [ ] Accessibility pass (screen-reader compatibility; hard on canvas, unclear ROI for a personal tool)
- [ ] Printable screen-grab / snapshot as PNG

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Connect/Disconnect with visible status | HIGH | LOW | P1 |
| Visible cursor | HIGH | LOW | P1 |
| BEL visual handling | HIGH | LOW | P1 |
| Paste throttling | HIGH | LOW-MEDIUM | P1 |
| ESC Z identify response | MEDIUM-HIGH | LOW | P1 |
| Parse ESC F/G/=/> as no-ops | HIGH (avoids corruption) | LOW | P1 |
| CR/LF sane default | HIGH | LOW | P1 |
| Working first-open defaults | HIGH | LOW | P1 |
| Restore port on reload (`getPorts()`) | HIGH | LOW | P2 |
| Auto-reconnect on USB re-plug | HIGH | LOW-MEDIUM | P2 |
| Persistent preferences | MEDIUM-HIGH | LOW | P2 |
| Font size zoom | MEDIUM | LOW | P2 |
| Send Break button | MEDIUM | LOW | P2 |
| Scanline/phosphor intensity slider | MEDIUM | LOW | P2 |
| CR/LF override toggle | MEDIUM | LOW | P2 |
| Local echo toggle | MEDIUM | LOW | P2 |
| Theme-toggle shortcut | LOW-MEDIUM | LOW | P2 |
| Clear screen local button | LOW-MEDIUM | LOW | P2 |
| VT52 graphics-mode glyph rendering | LOW-MEDIUM | LOW-MEDIUM | P3 |
| Audible bell (opt-in) | LOW | LOW | P3 |
| Settings export/import | LOW | LOW | P3 |
| XMODEM/YMODEM/ZMODEM | LOW (for target user) | HIGH | P3 |

**Priority key:**
- P1: Must have for launch — daily-driver bar
- P2: Should have — the "feels finished" polish pass, probably within v1 or shortly after
- P3: Nice to have, defer until validated need

## Competitor Feature Analysis

| Feature | kgober/VT52 (Windows) | Oscilloclock VT52 | Google Serial Terminal | BestialiTTY approach |
|---------|----------------------|-------------------|------------------------|----------------------|
| Transport | Serial + telnet + raw TCP | Serial (GPS/custom) | Web Serial | Web Serial only (out of scope to add others) |
| Connection UX | F6 dialog | Hardware device | Click-to-connect, explicit button | Click-to-connect, explicit button + persisted state |
| CR/LF toggle | Swap BS/DEL; auto-repeat flag | LF+CR toggle, wrap cols/lines toggle | EOL convert checkbox | Sane default + toggle |
| Cursor hide | No | Yes | N/A | No (cursor is always visible; theme defines style) |
| Theme / CRT effect | Green CRT filter, brightness F11/F12 | Fixed 16×8 display | None | CRT + clean; scanline/phosphor slider in v1.x |
| Local echo | No (implicit) | No | Yes, checkbox | Toggle, default off |
| Break signal | No | No | "Send break" button | Button in v1 or v1.x |
| Keypad handling | Numeric keypad → VT52 keypad; PF1/PF2/PF3 on NumLock/Num/Num* | Not specified | N/A | Parse ESC =/> as no-op; stock PC keypad in v1 (remapping out of scope) |
| Scrollback | Not mentioned | No (16×8 fixed) | Yes (browser scroll) | Yes (in v1 baseline) |
| Session log | Not mentioned | No | Download button | Yes (in v1 baseline) + mid-session download button in v1.x |
| Status indicator | Implicit | Hardware LED | Colour-coded connection state | Colour-coded connection state |
| Browser | Native Win app | Hardware | Chromium | Chromium |
| Static site / no server | N/A | N/A | Yes | Yes (hard requirement) |

**Takeaway:** The niche of polished, browser-native, MicroBeast-focused VT52
emulators is empty. kgober's is the most feature-complete VT52 emulator but
is Windows-only and network-capable (scope we're explicitly declining).
Google's reference Serial Terminal has the web-serial UX right but is a
generic serial terminal with no VT52 parsing. BestialiTTY wins by being the
intersection that doesn't exist yet — the differentiation is execution
quality on a narrow scope, not a feature comparison matrix.

## Sources

- [VT52 - Wikipedia](https://en.wikipedia.org/wiki/VT52) — authoritative on escape-sequence list, graphics mode, keypad mode (HIGH confidence)
- [VT52 DECscope Maintenance Manual](https://vt100.net/docs/vt52-mm/chapter1.html) — primary source for VT52 behaviour (HIGH)
- [TOS VT-52 terminal documentation](https://freemint.github.io/tos.hyp/en/VT_52_terminal.html) — pragmatic VT52 subset as implemented in Atari TOS, useful precedent for "what to implement vs skip" (MEDIUM-HIGH)
- [kgober/VT52 on GitHub](https://github.com/kgober/VT52) — existing mature VT52 emulator, feature set informs "what users expect" (MEDIUM)
- [Oscilloclock VT52 emulator](https://oscilloclock.com/support/vt52-terminal-emulator) — embedded VT52 emulator with wrap/CR-LF/cursor toggles (MEDIUM)
- [Google Chrome Labs Serial Terminal](https://googlechromelabs.github.io/serial-terminal/) — canonical Web Serial UX reference (HIGH for Web Serial UX patterns)
- [MDN: Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) — authoritative on `getPorts()`, `connect`/`disconnect` events, break signals (HIGH)
- [MDN: SerialPort disconnect event](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/disconnect_event) — connection-loss UX semantics (HIGH)
- [Chrome for Developers: Web Serial guide](https://developer.chrome.com/docs/capabilities/serial) — canonical connect/read/write/reconnect patterns (HIGH)
- [MicroBeast GitHub](https://github.com/atoone/MicroBeast) — 16c550 UART on port 02xh, USB-C via CP2102N (HIGH for hardware); detailed VT52 behaviour specifics not documented in wiki (LOW for VT52 specifics — needs device validation in Phase 1)
- [Codepope: Beastly](https://codepope.dev/post/2023/10/beastly/) — confirms 19200 baud default, "virtual VT52" terminology (MEDIUM)
- [Bell character - Wikipedia](https://en.wikipedia.org/wiki/Bell_character) / [Visible Bell mini-HOWTO](https://tldp.org/HOWTO/pdf/Visual-Bell.pdf) — visual vs audible bell conventions (HIGH)
- [SerialTerminal.app: Line endings guide](https://serialterminal.app/articles/advanced/the-invisible-characters-understanding-line-endings-cr-lf-and-crlf) — CR/LF handling is the #1 serial-terminal confusion source (HIGH)

### Confidence Notes

- **HIGH** on VT52 protocol surface and Web Serial API behaviour — multiple authoritative sources agree
- **MEDIUM** on what MicroBeast specifically emits beyond cursor/erase — the project wiki documents hardware but not VT52 usage patterns in detail; Phase 1 should include live-device capture to resolve (e.g., does MicroBeast emit BEL? does it use graphics mode? does it set alt-keypad mode?)
- **LOW** on MicroBeast-specific CR/LF convention — inferred but not directly documented; verify on real hardware during Phase 1

### Gaps to Flag for Later Phases

1. **Live MicroBeast capture of actual escape sequences used** — determines
   exactly which VT52 subset to implement and which to safely ignore. Do
   this early in Phase 1.
2. **BEL usage in MicroBeast firmware** — confirms whether visual bell is
   actually useful or decorative.
3. **CR/LF convention in MicroBeast CP/M distribution** — determines the
   sane default.
4. **Whether any MicroBeast workload uses graphics mode or alt-keypad mode**
   — if yes, they rise from P3 to P2.

---
*Feature research for: in-browser VT52 terminal emulator for MicroBeast*
*Researched: 2026-04-21*
