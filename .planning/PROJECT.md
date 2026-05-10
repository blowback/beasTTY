# Beastty

## What This Is

Beastty is an in-browser VT52 terminal emulator for the MicroBeast Z80
retrocomputer. It runs as a static web app, connects to a MicroBeast over Web
Serial, and is intended to be usable as a daily-driver terminal for real
hands-on-keyboard MicroBeast work.

## Core Value

A modern, reliable, in-browser VT52 emulator good enough to use as a daily
driver with a real MicroBeast — nothing else matters if that doesn't hold.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] Rust → wasm core responsible for parser, terminal state, and key
      encoding — pure logic, no I/O, no transport concerns. *(Validated in
      Phase 1: Rust core parser/grid/key-encoder; Phase 2: WASM boundary)*
- [x] Rust↔JS interop via `wasm-bindgen` + `wasm-pack`. *(Validated in Phase
      2: WASM boundary + minimal JS harness)*
- [x] Two rendering themes shipped in v1 with a user toggle: a classic CRT
      look (bitmap-style font, phosphor colour, optional scanlines/glow) and a
      clean modern monospace look. *(Validated in Phase 3: Canvas Renderer —
      CRT bitmap with phosphor toggle and Clean JetBrains-Mono vector theme,
      switchable via UI button or Ctrl+Alt+T)*
- [x] Keyboard input: map standard PC browser key events to VT52 key codes
      (arrows, keypad, control keys). *(Validated in Phase 4: Keyboard Input —
      DOM keydown wired to Rust `encode_key_raw`, arrow keys transmit ESC A/B/C/D,
      Ctrl-letter → 0x00–0x1F, local-echo toggle + 3-way CR/LF override in
      Settings pane, IME `isComposing` guard, mousedown-preventDefault focus
      retention on all chrome controls)*
- [x] VT52 emulation covering the pragmatic subset emitted by the MicroBeast.
      *(Validated across Phase 1 parser + Phase 2 wasm boundary + Phase 5 live
      transport — torn-chunk safe, captures-driven test corpus.)*
- [x] JS shell responsible for Web Serial I/O, canvas rendering, event loop, and
      browser state. *(Validated in Phase 3: canvas renderer; Phase 4: keyboard;
      Phase 5: Web Serial transport.)*
- [x] Web Serial transport driven entirely from JS (no Rust bindings).
      *(Validated in Phase 5: navigator.serial requestPort/getPorts/connect/
      disconnect events, cancellation-safe read loop, paste throttling.)*
- [x] Scrollback buffer for reviewing output above the current screen.
      *(Validated in Phase 6: 10,000-line ring in Rust core, JS-side
      `wheel`/Shift+PgUp/Shift+PgDn navigation, floating "↓ N new lines" chip,
      [data-scrolled-back] subtle border tint, snap-to-bottom on TX/paste/
      reconnect.)*
- [x] Copy text out of the screen and paste into the serial stream.
      *(Validated in Phase 6: drag-select line-wrapped + double-click word +
      triple-click line, inverted-glyph rendering via atlas.getInverted,
      Ctrl+Shift+C/Ctrl+Shift+V intercepts that preserve sacred Ctrl+C→0x03 /
      Ctrl+V→0x16 paths, large-paste 4096-byte confirm chip.)*
- [x] Session logging — capture the serial stream to a downloadable file.
      *(Validated in Phase 6: per-connection raw-byte chunks accumulator,
      mid-session Blob download with `beastty-{YYYYMMDD-HHMMSS}.bin`
      filename, RX-only — TX never logged.)*
- [x] Serial configuration: MicroBeast preset default with overrides.
      *(Validated in Phase 5: 19200 8N1 no-flow preset, full baud/data bits/
      stop bits/parity/flow control form, Reset to MicroBeast preset button;
      Phase 6 persists last-used config to localStorage.)*
- [x] Chromium-only with polite-fail on non-Chromium browsers.
      *(Validated in Phase 5: feature-detect via `typeof navigator.serial`,
      full-page takeover with browser list, no wasm/canvas init on detection
      failure.)*
- [x] Ships as a static site the author self-hosts.
      *(Validated in Phase 6: `.github/workflows/pages.yml` with
      actions/deploy-pages@v5; `www/_headers` best-effort Permissions-Policy +
      CSP for Cloudflare/Netlify; `<meta http-equiv="Content-Security-Policy">`
      defense-in-depth fallback for GH Pages; `.nojekyll`; deploy URL
      reachability test deferred to first-push human UAT.)*
- [x] Unit tests in Rust covering parser and terminal state machine.
      *(Validated across Phase 1: 8 fixture tests + 20 torn-chunk tests; Phase 2:
      boundary API shape; Phase 6: snapshot_grid_at + clear_visible parser
      preservation gate. Total: 162+ Rust tests green.)*
- [x] Permissive open-source license on a public repo.
      *(Validated in Phase 6: SPDX MIT canonical text, Copyright 2026 Ant
      Skelton, repo root `LICENSE` file.)*
- [x] Bidirectional file transfer over the Web Serial wire (PC ↔ Z80) via
      the SLIDE protocol — picker + drag-drop send, anchor-click +
      directory-picker receive, cancellation, chip UI.
      *(Validated in v1.1 milestone, Phases 7–12: pure-Rust state machine
      in `slide/` module with CRC-16-CCITT + sliding window + RDY/ACK/NAK/
      CAN/FIN; JS dispatcher + 7-byte `ESC ^ S L I D E` wakeup matcher;
      anchor-click-by-default + opt-in `showDirectoryPicker` for batches;
      ADR-003 5-step cancel sequence; Compatibility-mode 3-way pref for
      legacy slide.com fallback; 42 SLIDE-* requirements all complete.)*

### Active

<!-- Current scope. Building toward these. -->

No active milestone. v1.0 (MVP) and v1.1 (SLIDE FileTransfer) both shipped — see
`## Current State` below and `.planning/MILESTONES.md`. Use `/gsd-new-milestone`
to scope the next milestone.

v2 candidates (not yet committed to a milestone) live in
`.planning/REQUIREMENTS.md` under `## v2 Requirements`:

- v2-RENDER-01 — Scanline / phosphor intensity slider for CRT theme
- v2-RENDER-02 — VT52 graphics-mode glyphs (math fractions, scan lines)
- v2-XPORT-01 — Send Break button
- v2-AUDIO-01 — Audible bell (one default tone, muted by default)
- v2-SESS-01 — Settings export / import as JSON

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
  and uses Beastty as their daily driver without reaching for anything
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
| Rust/wasm core, JS shell | Clean separation: Rust is pure logic (easy to test, portable), JS handles everything the browser exposes (I/O, rendering, events). | Validated through Phase 3 |
| Web Serial driven from JS, not Rust | Rust Web Serial bindings are considered brittle/unmaintained by the author; going through JS is the path of least pain. | — Pending (Phase 5) |
| `wasm-bindgen` + `wasm-pack` | Standard, well-trodden toolchain for Rust↔JS with codegen'd glue; pairs well with static-site bundlers. | Validated in Phase 2 |
| Pragmatic VT52 subset only | Only what the MicroBeast and its software emit matters; over-scoping to DEC VT52 / ANSI / H19 trades effort for nothing. | Validated in Phase 1 (parser) |
| Chromium-only + polite fail on others | Web Serial is Chromium-only; pluggable transport abstraction isn't worth the design cost for a personal daily driver. | — Pending (Phase 5) |
| Classic CRT *and* clean modern themes in v1 | Both are cheap on top of canvas rendering and the author wants both available without a later retrofit. | Validated in Phase 3 |
| Theme toggle chord remapped to Ctrl+Alt+T | Chromium reserves Ctrl+Shift+T for "reopen closed tab"; Ctrl+Alt+T avoids the collision while staying ergonomically close. | Decided in Phase 3 (UAT gap #4) |
| Focus border driven by `[data-focused]` attribute (not `:focus-visible`) | `:focus-visible` only fires on keyboard focus in Chromium; an attribute-based selector populated by chrome.js fires on programmatic and pointer focus too. | Decided in Phase 3 (UAT gap #7) |
| CR/LF override is TX-side only (JS post-encode rewrite); default CR; 3 modes (CR/LF/CRLF) | Phase 1 D-13 locks Phase 4 to JS-only; default CR matches both Phase 1 captures (CP/M shell + BASIC-80); 3-way covers both observed failure modes. | Validated in Phase 4 |
| `mousedown` preventDefault on top-bar and Settings controls | Retains canvas focus across all chrome clicks without a visible refocus flicker; preserves native keyboard activation (Tab + Space). | Validated in Phase 4 |
| Browser-reserved Ctrl combos (W/N/T) documented via user-visible note | Chromium issue #33056 confirms these are genuinely unpreventable from a web page; the correct mitigation is a discoverable note in the Settings pane, not API acrobatics. | Validated in Phase 4 |
| Permissive license (MIT / Apache-2.0) | VT52 emulators are rare; low-friction licensing maximises usefulness to other MicroBeast owners. | Validated in Phase 6 (MIT) |
| Web Serial driven from JS, not Rust | Rust Web Serial bindings are considered brittle/unmaintained; going through JS is the path of least pain. | Validated in Phase 5 |
| Chromium-only + polite fail on others | Web Serial is Chromium-only; pluggable transport abstraction isn't worth the design cost. | Validated in Phase 5 |
| Pure-Rust SLIDE state machine in `slide/` module, JS shell owns wire bytes | Mirrors v1.0 architectural seam (Rust = pure logic, JS = I/O); CRC + state-machine logic stays portable + native-testable. | Validated in v1.1 (Phases 7–12) |
| 7-byte wakeup signature `ESC ^ S L I D E` (vs 2-byte `ESC ^`) | Reduces false-positive collisions on benign Z80 output that might emit `ESC ^` for unrelated reasons. | Validated in v1.1 (Phase 8 dispatcher tests) |
| ADR-003: SLIDE v0.2.1 CAN-bidirectional amendment | SLIDE v0.2 spec didn't define PC-initiated CTRL_CAN with Z80 echo; required for clean wire-neutral cancel. Upstream PR target: github.com/blowback/slide. | Validated in v1.1 (Phase 10 cancel state machine + force_idle escape hatch) |
| Per-file anchor-click download default; `showDirectoryPicker` opt-in for batches > 1 file | One user gesture saves all subsequent files into the chosen folder; ≥ 250 ms inter-file gap dodges Chrome multi-download throttling. | Validated in v1.1 (Phase 10) |
| Compatibility-mode 3-way pref (`auto` / `wakeup-required` / `force-start`) | Lets users running pre-v0.2.1 `slide.com` (no wakeup signature) still complete a transfer; `auto` arms a 3 s timer post-auto-type and prompts `[Retry] [Cancel] [Force start]`. | Validated in v1.1 (Phase 11 + 12 UAT-fix) |
| RTS-on-connect prefs gate (`serialAssertRtsOnConnect: true` default) | Real-hardware UAT showed RTS-as-reset interfering with Z80 connect handshake on some MicroBeasts; pref allows opting out without breaking default Phase 5 behaviour. | Validated in v1.1 (Phase 12.8 hardware UAT) |

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

## Current State

**v1.1 SLIDE FileTransfer milestone shipped 2026-05-10.** Phases 7–12 (28 plans,
42 SLIDE-* requirements, all complete). Bidirectional file transfer over Web Serial
landed end-to-end: pure-Rust state machine, JS dispatcher, host-initiated send via
picker + drag-drop, Z80-initiated receive via Chrome downloads, floating chip with
ADR-003 5-step cancel, Compatibility-mode fallback for legacy slide.com.

**v1.0 MVP shipped (informal) 2026-04-25.** Phases 1–6 (54 v1 requirements, all
complete). Was never formally archived at the time; recorded retroactively as
historical context during v1.1 milestone close.

Both milestones used as a daily driver throughout v1.1 development — the v1.0
out-of-band sign-offs (24-h soak, daily-driver UAT, GitHub Pages first-deploy smoke
check) have effectively been validated by continuous use, though the formal protocol
checklists were never re-run.

**Codebase shape:** Rust workspace 283 tests green; www/ Playwright suite green at
`--workers=4` (some 10-worker parallelism flakes documented per phase deferred-items).
No structural technical debt. The Rust core remains pure-logic with the v1.0 boundary
contract intact; v1.1 added a sibling `Slide` wasm-bindgen struct without disturbing
`Terminal`.

**Pending real-hardware UAT:** `docs/SLIDE-UAT.md` end-to-end against patched
MicroBeast — gated on upstream `github.com/blowback/slide` PR merge. Out-of-band.

## Next Milestone

No active milestone. Use `/gsd-new-milestone` to scope the next one. v2 candidates
listed under `### Active` above and in `.planning/REQUIREMENTS.md`.

---
*Last updated: 2026-05-10 after v1.1 SLIDE FileTransfer milestone close*
