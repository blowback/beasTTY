# BestialiTTY

## What This Is

BestialiTTY is an in-browser VT52 terminal emulator for the MicroBeast Z80
retrocomputer. It runs as a static web app, connects to a MicroBeast over Web
Serial, and is intended to be usable as a daily-driver terminal for real
hands-on-keyboard MicroBeast work.

## Core Value

A modern, reliable, in-browser VT52 emulator good enough to use as a daily
driver with a real MicroBeast — nothing else matters if that doesn't hold.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] VT52 emulation covering the pragmatic subset actually emitted by the
      MicroBeast and the software run on it (not strict DEC VT52, not ANSI).
- [ ] Rust → wasm core responsible for parser, terminal state, and key
      encoding — pure logic, no I/O, no transport concerns.
- [ ] JS shell responsible for Web Serial I/O, canvas rendering, event loop,
      and browser state.
- [ ] Web Serial transport driven entirely from JS (no Rust bindings to Web
      Serial).
- [ ] Rust↔JS interop via `wasm-bindgen` + `wasm-pack`.
- [ ] Keyboard input: map standard PC browser key events to VT52 key codes
      (arrows, keypad, control keys).
- [ ] Two rendering themes shipped in v1 with a user toggle: a classic CRT
      look (bitmap-style font, phosphor colour, optional scanlines/glow) and a
      clean modern monospace look.
- [ ] Scrollback buffer for reviewing output above the current screen.
- [ ] Copy text out of the screen and paste into the serial stream.
- [ ] Session logging — capture the serial stream to a downloadable file.
- [ ] Serial configuration: MicroBeast preset is the default, with overrides
      available for baud / data bits / stop bits / parity / flow control.
- [ ] Chromium-only fully supported; non-Chromium browsers show a clear "use
      a Chromium-based browser" message without crashing.
- [ ] Ships as a static site the author self-hosts (GitHub Pages / Cloudflare
      Pages / own domain).
- [ ] Unit tests in Rust covering the parser and terminal state machine.
- [ ] Permissive open-source license (MIT or Apache-2.0) on a public repo.

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Rust bindings to Web Serial — author's judgment: the ecosystem is brittle
  and the JS API is the path of least pain; Rust stays pure logic.
- Firefox / Safari support — Web Serial is Chromium-only and no polyfill
  gives an acceptable experience; handled by polite fail instead.
- Full strict DEC VT52 conformance — only what the MicroBeast and its
  software actually emit matters; over-scoping here trades effort for nothing.
- ANSI / VT100 / Heath H19 extension support — MicroBeast doesn't emit them;
  add only if a real workload demands it.
- MicroBeast-specific key codes or configurable keymap remapping in v1 —
  stock PC→VT52 mapping is enough for daily driving.
- Golden-trace regression harness / browser-side automated tests — unit
  tests plus daily-driver use are the bar for v1.
- Shareable public URL as a hosted service — self-hosting is enough; a
  public deployment can happen later without changing the build.
- Alternative transports (WebSocket bridge, WebUSB, mock backend) — Web
  Serial direct is the only v1 transport.

## Context

- Target device: MicroBeast, a Z80-based retrocomputer that only supports
  VT52 terminal emulation.
- The author's motivation is scratching a personal itch: existing VT52
  emulators are scarce and none of them are pleasant to use day-to-day.
- Architectural principle: keep Rust in the pure-logic lane and JS in the
  I/O / rendering / browser lane. This bounds complexity on both sides and
  avoids entangling the wasm core with brittle browser APIs.
- "Done" is defined experientially: the author plugs into their MicroBeast
  and uses BestialiTTY as their daily driver without reaching for anything
  else.
- Greenfield project — no existing code in this repo.

## Constraints

- **Tech stack**: Rust (compiled to wasm) + JavaScript + HTML Canvas.
  Rust covers parsing, terminal state, and key encoding; JS covers
  Web Serial, rendering, and event loop.
- **Tech stack**: `wasm-bindgen` + `wasm-pack` for Rust↔JS interop.
- **Platform**: Chromium-based browsers only (Web Serial requirement).
  Non-Chromium handled by a polite fail-fast message.
- **Transport**: Web Serial must be driven from JavaScript — no Rust
  bindings to Web Serial.
- **Deployment**: Static files only. No server runtime in v1.
- **Licensing**: Permissive open source (MIT or Apache-2.0) on publish.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rust/wasm core, JS shell | Clean separation: Rust is pure logic (easy to test, portable), JS handles everything the browser exposes (I/O, rendering, events). | — Pending |
| Web Serial driven from JS, not Rust | Rust Web Serial bindings are considered brittle/unmaintained by the author; going through JS is the path of least pain. | — Pending |
| `wasm-bindgen` + `wasm-pack` | Standard, well-trodden toolchain for Rust↔JS with codegen'd glue; pairs well with static-site bundlers. | — Pending |
| Pragmatic VT52 subset only | Only what the MicroBeast and its software emit matters; over-scoping to DEC VT52 / ANSI / H19 trades effort for nothing. | — Pending |
| Chromium-only + polite fail on others | Web Serial is Chromium-only; pluggable transport abstraction isn't worth the design cost for a personal daily driver. | — Pending |
| Classic CRT *and* clean modern themes in v1 | Both are cheap on top of canvas rendering and the author wants both available without a later retrofit. | — Pending |
| Permissive license (MIT / Apache-2.0) | VT52 emulators are rare; low-friction licensing maximises usefulness to other MicroBeast owners. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-21 after initialization*
