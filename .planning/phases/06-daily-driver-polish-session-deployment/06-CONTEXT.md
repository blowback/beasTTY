# Phase 6: Daily-Driver Polish, Session & Deployment - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the working terminal (Phases 1–5) into a daily driver: scrollback UI on
top of the existing 10,000-line Rust ring, canvas-rendered selection with
copy/paste keyboard ergonomics that don't collide with Phase 4's Ctrl+C/Ctrl+V
encoding, a local clear-screen distinct from remote `ESC J`, per-connection
session logging downloadable mid-session, persistent preferences (theme,
phosphor, font-zoom, serial config, local-echo, CR/LF mode, optional
auto-connect) under a single versioned `localStorage` blob, and a static-site
deploy to GitHub Pages under MIT license. Closes SESS-01..06, PREF-01,
PREF-02, PLAT-03, PLAT-04, PLAT-05 and all five Phase 6 ROADMAP success
criteria including the 24-hour soak.

**In scope:**
- New Rust core API: `Terminal::snapshot_grid_at(row_offset: usize)` + thin
  `lib.rs` wasm façade — exposes any contiguous `visible_rows`-tall window
  starting `row_offset` rows back from the live tail (offset 0 = live).
- `www/renderer/scroll-state.js` (new module — owns `scrollOffset`,
  `isScrolledBack`, wheel/key event listeners, accumulator for fractional
  trackpad deltaY, snap-to-bottom triggers, `newLinesSinceUserScrolled`
  counter for the floating chip).
- Extensions to `www/renderer/canvas.js` — branch on `scroll-state` to call
  `snapshot_grid_at(scrollOffset)` instead of `snapshot_grid()` when scrolled
  up; skip dirty-row pipeline while scrolled-up (paint-once-then-idle); hide
  cursor while scrolled-up; consume scroll-state for `[data-scrolled-back]`
  attribute on `#terminal-wrapper`.
- Extensions to `www/renderer/atlas.js` — selection paint reuses existing
  `getInverted()` (Phase 3 D-02) for inverted-glyph cells.
- New `www/input/selection.js` — pointerdown/move/up state machine,
  cell-coordinate math (px → row/col), word/line double/triple-click logic,
  drag-past-edge auto-scroll integration with `scroll-state.js`.
- New `www/input/clipboard.js` — `copySelection()` (decodes selected cell
  range to plain text, trims trailing whitespace per line, `\n` line
  endings, `navigator.clipboard.writeText`); `pasteFromClipboard()`
  (`navigator.clipboard.readText` → CR/LF rewrite per Phase 4 mode → strip
  non-printable except CR/LF/Tab → `enqueuePaste(bytes)`); large-paste
  threshold check (`>= 4096` bytes) emits an inline confirm chip in the
  paste-progress region before any byte goes on the wire.
- Extensions to `www/input/keyboard.js` — Ctrl+Shift+C copy intercept,
  Ctrl+Shift+V paste intercept, Shift+End/Shift+Home/Shift+PgUp/Shift+PgDn
  scroll-state intercept, snap-to-bottom on first keypress while scrolled
  back. Plain Ctrl+C / Ctrl+V / End / Home / PgUp / PgDn semantics
  unchanged (still go to remote).
- New `www/transport/session-log.js` — per-connection raw-byte buffer
  (wasm-side accumulator OR JS-side `Uint8Array`-of-`Uint8Array` chunks +
  total-bytes counter), `download()` (assembles `Blob`, triggers anchor
  click), reset-on-Connect, drop-on-Disconnect (after optional download).
- Extensions to `www/transport/serial.js` — read loop appends to
  `session-log` after every `term.feed(value)`. Existing
  `bestialitty.port.preset` localStorage key untouched.
- New `www/state/prefs.js` — `loadPrefs()` (reads `bestialitty.prefs` JSON,
  applies version migration if `version < CURRENT_VERSION`),
  `savePrefs(partial)` (debounced merge + persist), `resetPrefs()`,
  `subscribe(fn)` (notifies UI on change). Schema:
  ```js
  { version: 1,
    theme: 'crt' | 'clean',
    phosphor: 'green' | 'amber' | 'white',
    fontZoom: 1 | 2 | 3 | 4,
    serial: { baud, dataBits, stopBits, parity, flowControl },
    localEcho: false,
    crlfMode: 'cr' | 'lf' | 'crlf',
    autoConnect: false }
  ```
- Extensions to `www/main.js` — call `loadPrefs()` first; pass loaded values
  to `wireChrome` / `wireKeyboard` / `wireSerial`. On change events, call
  `savePrefs({ … })`. If `prefs.autoConnect && getPorts() finds match` and
  no auto-connect failure flag set: call `connectMicroBeast()` silently
  after wasm + canvas boot.
- Extensions to `www/renderer/chrome.js` — Settings pane gains: 'Reset all
  preferences' button with inline 2-click confirm; 'Clear scrollback'
  button (calls `term.resize_scrollback(0)` then back to 10000); 'Auto
  connect on load' checkbox. Top-bar gains: 'Clear' button (Shift+click =
  also clear scrollback). Connection pane gains: 'Download log' button.
- Extensions to `www/index.html` — add 'Clear' top-bar button, Settings
  pane 'Reset prefs' / 'Clear scrollback' / 'Auto connect' rows, Connection
  pane 'Download log' button, floating chip element for
  scroll-back-new-lines indicator.
- Build / deploy:
  - `LICENSE` file at repo root: MIT (2026 © project author).
  - `.github/workflows/pages.yml` — on push to main, run
    `scripts/build.sh` → publish `www/` to gh-pages branch (or
    `/docs` folder, planner picks the simpler convention).
  - `www/README.md` deploy-target documentation.
  - `06-SOAK.md` — 24-hour soak protocol document, memory-measurement
    procedure (`performance.memory` + `wasm.memory.buffer.byteLength`
    samples every 60 s for 24 h), pass criteria.
- `06-HUMAN-UAT.md` — daily-driver checklist (paste 100 KB during a real
  CP/M session, scroll back through 8K lines of BASIC output, copy a
  command from history and paste it back, theme toggle while scrolled up,
  clear-screen before / during long output, full reload restores prefs +
  port preset, auto-connect on second visit).

**Out of scope:**
- Search-in-scrollback (`Ctrl+F` substring find) — deferred to v2; daily-
  driver bar is "scroll up and read", not "find substring."
- Persisting scrollback contents across reload — in-memory only;
  reload starts fresh.
- Persisting selection state across scroll or theme/zoom — selection
  clears on any scroll, theme, or zoom event.
- Cross-tab `BroadcastChannel` log sharing — single tab owns one log.
- Asciinema `.cast` log format — raw `.bin` only in v1. Add `.cast`
  export later if review-tooling demand surfaces.
- Logging TX (typed bytes / paste bytes) — only RX from MicroBeast is
  logged. TX is implicit in the remote echo.
- Per-connection log retention beyond the current connection — new
  Connect discards prior log (after the user has had the chance to
  download it).
- User-tunable scrollback cap UI — 10K is hardcoded.
- Toast / banner notification primitive — inline confirm in the
  paste-progress chip (large-paste warn) and the existing Phase 5
  Connection-pane error log are sufficient.
- Right-click context menu paste — Ctrl+Shift+V is the single paste
  shortcut; right-click could be added later if discoverability is a
  problem.
- Settings export/import (JSON) — `v2-SESS-01`, deferred.
- Audible bell — `v2-AUDIO-01`, deferred.
- Configurable keymap remap — out of scope per PROJECT.md.
- DTR/RTS user toggles — deferred from Phase 5; still deferred.
- Send Break button — `v2-XPORT-01`, deferred.

</domain>

<decisions>
## Implementation Decisions

### Scrollback navigation

- **D-01:** Scroll input model: **wheel + Shift+PgUp/Shift+PgDn**. Mouse
  wheel hovered over `#terminal-wrapper` scrolls back/forward.
  Shift+PgUp/Shift+PgDn for keyboard. Plain PgUp/PgDn pass through to
  remote (preserves CP/M / BASIC software that maps them).
- **D-02:** Wheel sensitivity: **3 lines per notch** for mouse wheel
  (`deltaMode = DOM_DELTA_LINE`). **Shift+wheel** = one page (24 lines)
  per notch. Trackpad (`deltaMode = DOM_DELTA_PIXEL`) accumulates raw
  `deltaY` and emits a 3-line tick when accumulator crosses ~30 px;
  accumulator resets on each emitted tick. Avoids jittery sub-pixel
  scrolling without locking out smooth trackpad feel.
- **D-03:** Stick-to-bottom: while scrolled up, **viewport stays put**
  while new output arrives. A floating chip near the bottom-right of
  the canvas reads `↓ N new lines` (theme-aware colors: phosphor-fg in
  CRT, ink in clean). Indicator appears **instantly on the 1st new
  line** while scrolled up (no debounce).
- **D-04:** Snap-to-bottom triggers (any of these): clicking the
  floating chip; pressing Shift+End; pressing any key that produces
  TX (i.e. typing); pasting (clipboard or `Paste test`); MicroBeast
  reconnect after port-lost (Phase 5 D-03 path); `term.resize_scrollback(0)`
  call from the Settings 'Clear scrollback' button (D-15). Wheel-down
  while scrolled up scrolls toward live; the snap is implicit when
  `scrollOffset == 0`.
- **D-05:** Jump-to-top shortcut: **Shift+Home** jumps to top of
  scrollback (`scrollOffset = scrollback_len`). Mirrors Shift+End.
- **D-06:** Snapshot API: add **`Terminal::snapshot_grid_at(row_offset:
  usize)`** to the Rust core + thin wasm-bindgen wrapper. Reuses the
  existing `pack_buf` + `snapshot_grid` machinery (Phase 2 Plan 02-02 +
  02-03) so no new memory layout. JS call: `term.snapshot_grid_at(0)`
  for live (equivalent to current `snapshot_grid()`); `term.snapshot_grid_at(N)`
  for `N` rows back. Out-of-range `row_offset` clamps to
  `min(row_offset, scrollback_len)` — never panics. JS-side parsing of
  cell layout is forbidden (Architecture: Rust owns logic).
- **D-07:** Snapshot cadence while scrolled up: **on scroll-state
  change + on every `term.feed` while scrolled up**. The viewport-row
  content is static (history is immutable) but the indicator counter
  needs to tick on every fed chunk that contains line breaks. Implementation
  detail: read loop calls `scrollState.notifyFeed(value)` after every
  `term.feed(value)` and the indicator counter increments locally;
  scroll-state-change re-derives the viewport.
- **D-08:** Repaint optimization while scrolled up: **paint all 24
  rows once on scroll-state change, then idle**. Skip dirty-row
  pipeline because historical rows can't change. rAF loop continues
  for the floating chip animation only (or use a single `requestAnimationFrame`
  for chip update, not the full grid). Re-enabled on snap-to-bottom.
- **D-09:** Cursor handling while scrolled up: **hide entirely**. The
  cursor lives at a row in the live grid (offset 0); when scrolled up,
  paint no cursor. Re-shows on snap-to-bottom. Phase 3 cursor-blink
  state is paused, not destroyed.
- **D-10:** BEL while scrolled up: **title prefix only, no viewport
  flash**. Phase 3 `(¡)`-prefix-on-backgrounded-tab path (D-17)
  unchanged. Visible-bell flash skipped while scrolled up (the rows
  causing the bell aren't in view, so flashing those rows is misleading).
- **D-11:** Wheel-while-paste: **wheel scrolls viewport, paste
  continues uninterrupted**. Phase 5 paste-pump runs independently of
  render state. Esc still cancels paste (Phase 5 D-18); wheeling does
  not. User can wheel back to history while a long paste streams,
  then snap to bottom to see the result.
- **D-12:** Wheel over chrome panes (`#settings`, `#debug`,
  `#connection`): **wheel scrolls pane content, never scrollback**.
  The wheel listener is attached to `#terminal-wrapper`, not the
  document — events that bubble from inside a `<details>` pane don't
  reach it.
- **D-13:** Theme/phosphor/font-zoom toggles while scrolled up: **keep
  the current row offset**. Re-paint the same scrolled-up viewport
  with new style. User keeps reading. Phase 3 `markAllRowsDirty()` is
  called before re-paint (already established pattern).
- **D-14:** Scroll-up persistence: **none**. Page reload clears
  scrollback contents and resets viewport to live tail. Preferences
  (theme, etc.) persist via `bestialitty.prefs`; session content does not.
- **D-15:** Clear scrollback control: **Settings pane button 'Clear
  scrollback'** — calls `term.resize_scrollback(0)` then back to
  `10_000`. No keyboard shortcut (deliberate friction). If the user is
  scrolled up when they click it, **snap to bottom in the same
  action** (D-04 trigger).

### Selection, copy, paste

- **D-16:** Selection model: **drag-select line-wrapped + double-click
  word + triple-click line**. Pointerdown captures cell coordinates
  (px → grid col/row); pointermove extends the anchor→focus pair;
  pointerup commits the selection. Double-click selects the
  whitespace-bounded run of non-space chars under cursor (a 'word').
  Triple-click selects the entire row.
- **D-17:** Selection across history boundary: **selection works
  across both live grid and scrollback rows**. Internally selection
  endpoints are stored as `(scrollback_row_offset_from_live_tail, col)`
  pairs — stable identifiers regardless of viewport offset during the
  drag. Selection clears on any scroll-state change after the drag
  completes (D-19), but extends naturally during an in-flight drag.
- **D-18:** Drag-past-edge auto-scroll: **drag past top edge of canvas
  scrolls viewport up at ~3 lines/sec while drag is held above; drag
  past bottom while at live tail is a no-op; drag past bottom while
  scrolled up scrolls forward toward live**. Selection extends as
  viewport moves.
- **D-19:** Selection lifecycle: **selection clears on any scroll
  (post-drag), any theme/phosphor/font-zoom toggle, any focus loss on
  the canvas, and any successful copy**. Esc during an in-flight drag
  cancels the in-progress selection.
- **D-20:** Selection rendering: **inverted glyphs (swap fg/bg per
  cell)** via Phase 3 atlas `getInverted()`. Zero new render code; the
  inversion path that paints the focused cursor is reused for
  selection cells. CRT theme: phosphor inverted with bg. Clean theme:
  ink/paper inverted.
- **D-21:** Copy keyboard shortcut: **Ctrl+Shift+C copies; Ctrl+C
  always sends 0x03**. Phase 4 keyboard binding for plain Ctrl+C
  (interrupt-the-remote) is sacred. Ctrl+Shift+C is intercepted by
  `keyboard.js` → calls `clipboard.copySelection()`. Empty selection +
  Ctrl+Shift+C = no-op (no clipboard write, no error).
- **D-22:** Paste keyboard shortcut: **Ctrl+Shift+V pastes; Ctrl+V
  always sends 0x16 (SYN)**. Symmetric with D-21. Ctrl+Shift+V →
  `clipboard.pasteFromClipboard()` → `paste-pump.enqueuePaste(bytes)`
  after preprocessing.
- **D-23:** Copy format: **plain text, trailing whitespace trimmed
  per line, '\n' line endings**. Selection cells decoded to ASCII.
  Trailing spaces (right-padding) stripped per line. Single-line
  selection: no trailing '\n'. Standard terminal copy behavior;
  pasting into another app gives clean text.
- **D-24:** Paste preprocessing: **CR/LF rewrite per Phase 4 mode +
  strip non-printable except CR/LF/Tab**. Sequence: clipboard text
  → encode as bytes (treat as ASCII; bytes > 0x7F kept as-is, user's
  responsibility) → strip 0x00–0x1F except 0x09/0x0A/0x0D → apply
  Phase 4 D-13 CR/LF rewrite (`crlfMode` from prefs) → enqueue.
  Reuses the `CRLF_MODES` export pattern Phase 5 D-23 already shares.
- **D-25:** Large-paste warning: **inline confirm chip in the
  paste-progress region for `bytes >= 4096`**. Chip text:
  `About to paste 100,234 B (~52 s at 19200 baud). [Cancel] [Paste]`.
  Pump does not start until user clicks Paste. Cancel clears the
  pending bytes; no clipboard re-read needed. Below threshold, paste
  starts immediately (Phase 5 progress UI is sufficient).
- **D-26:** Clear-screen control (SESS-06): **top-bar button
  'Clear'**. Plain click wipes the visible 80×24 grid (distinct from
  remote `ESC J` — implementation calls a new `Terminal::clear_visible()`
  Rust API, not feeding `\x1b\x4a` into the parser, so remote
  state-machine never sees a fake escape). **Shift+click also clears
  scrollback** (`resize_scrollback(0)` + back to 10000).

### Session log

- **D-27:** Log content: **raw bytes only, `.bin` extension**. Plain
  concatenation of all RX bytes from the read loop. No timestamps, no
  framing, no metadata. Pipe through any VT52 viewer or `xxd`
  /`hexdump` for inspection. Matches success criterion 'raw byte
  buffer'.
- **D-28:** Log direction: **RX only**. Bytes from MicroBeast → us.
  TX (typing, paste) is not logged. The remote echo proves what was
  sent; capturing TX would add ambiguity to the byte stream without
  consistent value.
- **D-29:** Log lifecycle: **per-connection**. New buffer allocated
  on each successful `port.open()` (or rather, on the first
  post-Connect `term.feed`). Prior log discarded when a new connection
  starts. User download mid-session via the 'Download log' button at
  any time without disconnecting — captures everything received so far
  and continues appending.
- **D-30:** Log buffer strategy: **growable JS-side
  array-of-Uint8Array chunks plus total-bytes counter**. Each
  `read()` chunk is pushed by reference (no copy, no concat). On
  download: `new Blob(chunks, { type: 'application/octet-stream' })`
  triggers a synthetic anchor click. Memory cost: equal to RX volume.
  No cap, no rotation in v1; the 24-h soak validates that real
  MicroBeast RX volume per session fits comfortably in browser memory.
- **D-31:** Download UX: **Connection pane button 'Download log'**.
  Lives in the Phase 5 `<details id="connection">` pane (next to
  serial-config form / port-status). Filename:
  `bestialitty-{YYYYMMDD-HHMMSS}.bin` where the timestamp is the
  connect-time UTC stamp (i.e. when the current log started). Button
  enabled whenever `currentLogBytes > 0`; disabled state shows tooltip
  'No bytes received yet'.

### Preferences & first-open

- **D-32:** localStorage schema: **single key `bestialitty.prefs`
  containing a versioned JSON blob**. Schema:
  ```json
  { "version": 1,
    "theme": "crt",
    "phosphor": "green",
    "fontZoom": 1,
    "serial": {
      "baud": 19200, "dataBits": 8, "stopBits": 1,
      "parity": "none", "flowControl": "none"
    },
    "localEcho": false,
    "crlfMode": "cr",
    "autoConnect": false }
  ```
  Phase 5's `bestialitty.port.preset` (VID/PID identity) stays as a
  separate key — identity vs config are conceptually distinct (user
  'forgets port' separately from 'resets prefs'). Migration handler
  reads `version`; if older, applies field-by-field upgrades and
  re-saves. v1 = current shape; future schema changes bump version.
- **D-33:** Preference save cadence: **debounced 250 ms after the
  last change**. Theme toggle, phosphor change, baud change, etc.
  fire `savePrefs({ key: value })`; the helper merges into the
  in-memory prefs object and schedules a single `setItem` 250 ms
  later. Burst of changes = one persist at the end. On
  `beforeunload` flush immediately.
- **D-34:** Auto-connect-on-load: **off by default; toggle in
  Settings pane**. When `prefs.autoConnect && getPorts() finds
  matching VID/PID`: silent `port.open()` after wasm + canvas boot,
  no user click. On open failure, fall back to standard 'click
  Connect' flow with the failure logged in the inline error log
  (Phase 5 D-27). Off by default preserves Phase 5 D-05 'Connect is
  always user-intentional' for new users; daily-driver users opt in.
- **D-35:** Reset prefs UX: **Settings pane button 'Reset all
  preferences' with inline 2-click confirm**. First click changes
  text to 'Click again to confirm (3 s)'; second click within 3 s
  clears `bestialitty.prefs` and reloads defaults in-place (no page
  reload — `wireChrome` / `wireKeyboard` accept the reset prefs and
  re-apply). Port preset (Phase 5 `bestialitty.port.preset`) and
  the live connection state untouched. Timeout returns the button
  to its plain label.
- **D-36:** First-open defaults (PLAT-05): on first load with no
  `bestialitty.prefs` key: theme=crt, phosphor=green, fontZoom=1,
  serial=MicroBeast preset (19200 8N1 none none), localEcho=false,
  crlfMode=cr, autoConnect=false. Connection pane shows the preset
  pre-filled (already Phase 5 D-08 behavior). Click Connect → port
  picker → MicroBeast filter (Phase 5 D-02) → connected. One click
  total assuming the port has been previously granted to the
  origin — for first-ever visit, the user gets one Chromium
  port-picker prompt then one Connect click on subsequent visits.

### Deployment & license

- **D-37:** Deploy target: **GitHub Pages** via a GitHub Action
  (`.github/workflows/pages.yml`). On push to main, the action runs
  `scripts/build.sh` (which already produces `www/pkg/`), then
  publishes the `www/` directory. Whether via the gh-pages branch or
  the `/docs` folder convention is left to the planner — both work;
  pick the simpler path. URL: `https://<user>.github.io/bestialitty/`
  initially; custom-domain CNAME possible later without code change.
- **D-38:** License: **MIT**. Single `LICENSE` file at repo root, MIT
  text with `2026 © <author>` copyright line. No NOTICE file (Apache
  convention). Rationale: VT52 emulators are rare and the goal is
  maximum reuse-friction for other MicroBeast owners — MIT is the
  most permissive common license. Apache-2.0's patent grant is
  unnecessary for a VT52 emulator (no patentable territory).
- **D-39:** CSP / Permissions-Policy headers: **deferred to deployment
  configuration, not app code**. GitHub Pages can serve a `_headers`
  file (or equivalent CDN config); the planner adds a `www/_headers`
  with a recommended `Permissions-Policy` allowing `serial=(self)`
  and CSP that permits the wasm `unsafe-eval` requirement. If GitHub
  Pages doesn't honor `_headers`, document the fallback in the
  README for users who self-host on Cloudflare Pages or similar.

### Soak protocol

- **D-40:** 24-hour soak (success criterion 2): **memory-flat across
  24 hours of continuous output**. Protocol document in
  `06-SOAK.md`. Test setup: real MicroBeast running a script that
  emits ~1 line/sec of mixed CP/M output (not synthetic — the real
  hardware is the truth) for 24 h. Sample `performance.memory`
  (when available — Chromium-only) and `wasm.memory.buffer.byteLength`
  every 60 s into the session log; post-run review confirms no
  monotonic growth past initial steady-state. Pass: byteLength
  stable within ±10% of initial after the first 10 minutes; no
  unbounded growth pattern.

### Claude's Discretion

- Exact CSS of the floating 'N new lines' chip (border-radius,
  drop-shadow vs phosphor-glow, animation on appear/disappear).
- Exact pixel threshold for trackpad deltaY accumulator (~30 px is
  the ballpark; planner picks the final value based on testing on a
  real trackpad).
- Whether the floating chip uses `pointer-events: none` while
  invisible (probably yes).
- Wheel listener attachment point (`#terminal-wrapper` vs `<canvas>`
  vs `document` with target check) — planner picks based on Phase 3
  focus-handling code.
- Exact word-boundary regex for double-click (`/\S+/` is the obvious
  call; planner verifies against a few real CP/M / BASIC outputs).
- Whether to pre-allocate the `chunks: Uint8Array[]` array in the
  session-log module (probably no — push-on-demand is fine for the
  v1 chunk volume).
- Settings-pane DOM order for the new rows (Reset prefs, Clear
  scrollback, Auto connect) — planner picks based on Phase 4 D-14.
- Exact timestamp format in the download filename (`YYYYMMDD-HHMMSS`
  vs `YYYY-MM-DDTHH-MM-SS`) — both work; planner picks the one that
  matches existing convention.
- gh-pages branch vs `/docs` folder for GitHub Pages deploy —
  planner picks based on simplicity in `pages.yml`.
- Soak script content on the MicroBeast — anything that emits
  reasonable RX volume; the planner can spec a 'BASIC `for i = 0
  to 1e9 : print i : next` loop running at terminal-readable speed'
  if no other workload is handy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` — architecture split (Rust core / JS shell),
  daily-driver target, MIT/Apache-2.0 license plan, Chromium-only,
  static-site constraint, "done is defined experientially" framing
- `.planning/REQUIREMENTS.md` §Session (SESS-01..06), §Persistence
  (PREF-01, PREF-02), §Platform (PLAT-03, PLAT-04, PLAT-05) — Phase 6
  requirements; Out-of-scope block confirms Settings export/import
  (v2) and Audible bell (v2) deferred
- `.planning/ROADMAP.md` §"Phase 6: Daily-Driver Polish, Session &
  Deployment" — goal, depends on Phase 5, SC-1..SC-5 including
  the 24-hour soak

### Phase 1/2/3/4/5 deliverables load-bearing for Phase 6

- `crates/bestialitty-core/src/scrollback.rs` — Phase 1 D-11/D-12;
  the 10K-line `Scrollback` ring + `push_line` + `resize_scrollback`
  Phase 6 builds on. Phase 6 adds `snapshot_grid_at(row_offset)` here
  (or in `terminal.rs` + façade in `lib.rs`).
- `crates/bestialitty-core/src/terminal.rs` — `Terminal` owns the
  `Scrollback`; current `snapshot_grid()` exposes only the visible
  region. Phase 6 adds `snapshot_grid_at(row_offset)` reusing the
  same `pack_buf` machinery.
- `crates/bestialitty-core/src/lib.rs` §`mod wasm_boundary` — the
  wasm-bindgen façade (Phase 2 D-06/D-20). Phase 6 extends with a
  thin `snapshot_grid_at(row_offset: u32)` wrapper following the
  same one-line forwarder pattern.
- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md`
  §D-11/D-12 — scrollback default cap and `resize_scrollback` API
  Phase 6 exposes via the Settings 'Clear scrollback' button (D-15)
- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md`
  §Plan 02-06 — `feed_silent` + `host_reply` + `pack_buf` zero-copy
  pattern Phase 6's `snapshot_grid_at` reuses
- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` §D-02
  (atlas.getInverted), §D-17 (sampleBell post-feed), §[data-focused]
  attribute pattern (Phase 3 Plan 03-06) — selection rendering
  reuses getInverted (D-20), scroll-state mirrors data-focused
  pattern as `[data-scrolled-back]` (D-13/D-19)
- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` §RENDER-09 —
  font-zoom integer-multiplier path Phase 6's prefs persist
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` §D-07 —
  `pushTxBytes` signature (extended in Phase 5; Phase 6 leaves it
  alone but consumes the writer it routes through)
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` §D-13/D-14 —
  Settings pane DOM + CSS conventions Phase 6 extends with
  Reset / Clear scrollback / Auto connect rows
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` §CR/LF — the
  `CRLF_MODES` export Phase 5 D-23 already shares; Phase 6 paste
  preprocessing reuses the same table (D-24)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` §D-12..D-23
  — paste-pump module (`enqueuePaste`, `cancelPaste`, `isActive`,
  `setBaudForPump`, `onProgress`); Phase 6 SESS-03 wires
  clipboard → `enqueuePaste` (D-22, D-24)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` §D-31 —
  `bestialitty.port.preset` localStorage stub; stays separate from
  the Phase 6 `bestialitty.prefs` blob (D-32)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` §D-08 —
  MicroBeast preset (19200 8N1 none none) Phase 6 first-open
  defaults align with (D-36)
- `.planning/phases/05-web-serial-transport/05-CONTEXT.md` §"Deferred
  Ideas" — confirms Phase 5's deferred items are exactly Phase 6's
  scope (auto-connect, full pref persistence, Forget port,
  Permissions-Policy)

### Pitfalls research (relevant to Phase 6)

- `.planning/research/PITFALLS.md §Pitfall 6 — Background-Tab
  Throttling Silently Loses Serial Data` — the 24-h soak (D-40)
  must explicitly include backgrounded-tab time; Phase 5 D-39
  visibilitychange-catch-up is the existing mitigation
- `.planning/research/PITFALLS.md §Pitfall 11 — Serial Port Identity
  Mismatch on Reconnect` — confirms the Phase 5 D-31 VID/PID identity
  pair stays separate from preferences (Phase 6 D-32)
- `.planning/research/PITFALLS.md §Security Mistakes /
  Permissions-Policy` — Phase 6 D-39 deferred to hosting config
- `.planning/research/PITFALLS.md` (general) — read for any
  long-running-tab memory pitfalls relevant to D-30 log buffer
  growth and D-40 soak

### Existing code Phase 6 integrates with

- `www/main.js` — first-line polite-fail (Phase 5 D-32) unchanged;
  Phase 6 calls `loadPrefs()` second, before `wireChrome` /
  `wireKeyboard` / `wireSerial`. New: scroll-state init, selection
  module init, clipboard module init, session-log init, prefs
  subscription wiring.
- `www/renderer/canvas.js` — Phase 6 branches `tick()` on
  `scrollState.isScrolledBack`: snapshot_grid_at(scrollOffset),
  selection inversion overlay (D-20), skip dirty-row pipeline
  (D-08), hide cursor (D-09).
- `www/renderer/atlas.js` — `getInverted()` reused for selection
  cells (D-20). No API change.
- `www/renderer/chrome.js` — extends visibilitychange listener
  (already Phase 5 D-39); adds Settings rows (Reset prefs / Clear
  scrollback / Auto connect); adds top-bar 'Clear' button.
- `www/renderer/themes.js` — Phase 6 imports color tokens for the
  floating chip + scroll-back canvas border tint.
- `www/input/keyboard.js` — Phase 6 adds intercepts for
  Ctrl+Shift+C, Ctrl+Shift+V, Shift+End, Shift+Home,
  Shift+PgUp/Shift+PgDn; plain Ctrl+C / Ctrl+V / End / Home /
  PgUp / PgDn unchanged.
- `www/input/paste-pump.js` — Phase 6 calls existing `enqueuePaste`
  + `cancelPaste` + `isActive` + `setBaudForPump`. No internal
  changes; D-25 large-paste warn is the only new wrapper at the
  call site.
- `www/input/tx-sink.js` — unchanged. Selection / clipboard / log
  flow does not touch tx-sink.
- `www/transport/serial.js` — Phase 6 read loop appends to
  session-log after `term.feed(value)`. `bestialitty.port.preset`
  localStorage usage unchanged. `connectMicroBeast` /
  `disconnect` API unchanged.
- `www/index.html` — adds: top-bar 'Clear' button; Connection
  pane 'Download log' button; Settings pane 'Reset prefs' /
  'Clear scrollback' / 'Auto connect on load' rows; floating
  chip element (`<div id="scrollback-indicator" hidden>`).
- `www/tests/` — Phase 6 adds a `www/tests/session/` Playwright
  suite: scrollback navigation, selection / copy / paste,
  clear-screen, prefs persistence, log download, soak protocol
  (sampling — full 24 h is human UAT). Mirrors Phase 5
  `www/tests/transport/`.
- `scripts/build.sh` — exists from Phase 2 Plan 02-04; Phase 6
  GitHub Action invokes it.

### Spec / external docs

- [MDN: Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
  — `navigator.clipboard.writeText` / `readText` ergonomics; user-
  gesture requirement for `readText`; Permissions-Policy
  `clipboard-read` / `clipboard-write`
- [MDN: WheelEvent](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent)
  + [DOM_DELTA constants](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode)
  — D-02 trackpad vs mouse-wheel disambiguation
- [MDN: PointerEvent](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent)
  — D-16 drag-select implementation primitives
- [MDN: localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
  + [Storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
  — D-32 schema sizing; quota error handling on `setItem`
- [MDN: URL.createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL)
  + [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
  — D-30 / D-31 download mechanism
- [GitHub Pages docs](https://docs.github.com/en/pages)
  + [actions/deploy-pages](https://github.com/actions/deploy-pages)
  — D-37 deployment pipeline shape
- [SPDX MIT license text](https://spdx.org/licenses/MIT.html) —
  D-38 LICENSE file content
- [Cloudflare `_headers` syntax (or equivalent)](https://developers.cloudflare.com/pages/configuration/headers/)
  — D-39 fallback documentation reference
- [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
  — D-40 soak protocol's backgrounded-tab measurement

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `crates/bestialitty-core/src/scrollback.rs` — `Scrollback`
  already stores HISTORICAL rows up to `scrollback_cap` plus the
  visible region; Phase 6 just needs an accessor that exposes a
  windowed view at an arbitrary offset.
- `crates/bestialitty-core/src/lib.rs §wasm_boundary` — Phase 2
  one-line forwarder pattern is the template for the new
  `snapshot_grid_at(row_offset)` façade method.
- `www/renderer/atlas.js` `getInverted(ch, theme, phosphor, …)` —
  Phase 3 D-02 produces an inverted-glyph variant for the focused
  cursor. Phase 6 selection rendering (D-20) reuses this exact path
  per cell — no new render code.
- `www/renderer/chrome.js` `[data-focused]`-attribute pattern
  (Phase 3 Plan 03-06) — Phase 6 mirrors with `[data-scrolled-back]`
  on `#terminal-wrapper`. Same CSS pattern, different attribute.
- `www/input/paste-pump.js` `enqueuePaste(bytes)` /
  `cancelPaste()` / `isActive()` / `onProgress(fn)` /
  `setBaudForPump(baud)` — Phase 5 shipped these as the public
  surface specifically anticipating Phase 6 SESS-03. Phase 6
  clipboard module is a thin adapter feeding bytes into
  `enqueuePaste`.
- `www/input/keyboard.js` `CRLF_MODES` export + Phase 4 D-13
  CR/LF rewrite logic — Phase 6 paste preprocessing reuses the
  same map (D-24); a small refactor may extract the rewrite to a
  shared util.
- `www/input/keyboard.js` Esc-intercept gate
  (Phase 5 D-18: `if (pastePump.isActive()) cancelPaste(); return;`)
  — Phase 6 selection-cancel-on-Esc mirrors this gate pattern.
- Phase 5 `bestialitty.port.preset` localStorage key + boot-time
  `getPorts()` match — Phase 6 D-34 auto-connect builds the
  silent-open path on top of this.
- Phase 5 `<details id="connection">` pane — Phase 6 D-31 adds the
  'Download log' button to it; Phase 5 already established the
  pattern of putting connection-related controls there.
- `www/main.js` `sampleBell()` + `drainHostReply('serial')` +
  `requestFrame()` post-feed invariant (Phase 3 D-17) — Phase 6
  read-loop session-log append happens **after** these, in the same
  synchronous block (`term.feed(value); sampleBell();
  drainHostReply(); requestFrame(); sessionLog.append(value);`).
- `scripts/build.sh` (Phase 2 Plan 02-04) — produces `www/pkg/`;
  GitHub Action invokes it and ships `www/`.

### Established Patterns

- **`wireX(opts)` dependency injection** (Phase 3 / 4 / 5) — the
  new `wireSelection(opts)`, `wireSessionLog(opts)`,
  `wirePrefs(opts)`, `wireScrollState(opts)` modules follow the
  same shape: dependencies in via `opts`, return a public API with
  `dispose()` for tests.
- **Module-scope cached Uint8Array views with buffer-identity guard**
  (Phase 2 D-03) — `snapshot_grid_at` consumers must respect
  buffer-identity changes (memory.grow can move backing); the
  existing canvas.js `reDeriveViews()` helper is the model.
- **Framework-free JS / plain ES modules** (Phase 2 D-14) —
  preserved.
- **`<details>` pane per concern** — Phase 6 adds rows inside the
  existing Settings and Connection panes; no new panes.
- **`mousedown preventDefault` on chrome controls to retain canvas
  focus** (Phase 4 Plan 04-03) — Phase 6 new buttons (Clear,
  Download log, Reset prefs, Clear scrollback, Auto connect)
  follow this pattern verbatim.
- **One observer registered at boot in main.js** (Phase 4 D-15) —
  Phase 6 adds: `prefs.subscribe(applyPrefs)`,
  `scrollState.onChange(updateIndicator)`,
  `selection.onChange(maybeUpdateClipboardEnable)`. All registered
  once at boot.
- **Inline confirmation buttons (no modals)** — Phase 6 D-25
  large-paste warn and D-35 reset-prefs confirm both follow this
  pattern (button text changes for N seconds, second click
  commits). Avoids modal infrastructure.
- **Per-spec inline setup() helper** (Phase 4 Plan 04-04) —
  Phase 6 `www/tests/session/` mirrors.

### Integration Points

- `www/main.js` boot sequence (post Phase 5):
  1. polite-fail check (unchanged)
  2. `loadPrefs()` → `prefs` object available
  3. wasm `init()` (unchanged)
  4. `new Terminal(rows=24, cols=80, scrollback_cap=10000)` (unchanged)
  5. `wireChrome({ prefs, ... })`
  6. `wireKeyboard({ prefs, ... })`
  7. `wireScrollState({ term, canvas, prefs, ... })`
  8. `wireSelection({ canvas, scrollState, ... })`
  9. `wireSessionLog({ ... })`
  10. `wireSerial({ term, prefs, sessionLog, scrollState, ... })`
  11. `wirePrefs({ savePrefs })` — installs subscribers
  12. If `prefs.autoConnect` and stored port matches → silent
      `connectMicroBeast()`
- `www/transport/serial.js` read loop — one new line:
  `sessionLog.append(value)` after the existing post-feed
  invariant.
- `www/renderer/canvas.js` `tick()` — branch on
  `scrollState.isScrolledBack` early; if true,
  `snapshot_grid_at(scrollState.offset)` and skip dirty-row pipeline.
- `www/input/keyboard.js` keydown handler — three new branches
  (Ctrl+Shift+C, Ctrl+Shift+V, Shift+{End,Home,PgUp,PgDn}) before
  the existing encode path.
- Repo root `LICENSE` (new), `.github/workflows/pages.yml` (new),
  `www/_headers` (new), `06-SOAK.md` (new at phase end).

</code_context>

<specifics>
## Specific Ideas

- The "stay where you are + floating chip" stick-to-bottom is the
  daily-driver crux: scrollback is for reading history, and any
  pull-back-to-bottom that disrupts that reading defeats the
  feature. The chip is the lightest possible "FYI new output"
  signal that still respects the user's attention.
- The Ctrl+Shift+C / Ctrl+Shift+V convention is what every modern
  terminal does, so it's the path of least surprise for a daily
  driver. Plain Ctrl+C/Ctrl+V staying as 0x03/0x16 keeps the
  terminal pure for the remote.
- Selection-as-inverted-glyphs reuses an already-shipped Phase 3
  code path (`atlas.getInverted` for the focused cursor). Zero new
  rendering primitives. CRT phosphor-on-black inverts to
  black-on-phosphor, which reads beautifully in both themes.
- Per-connection log + filename-with-connect-timestamp matches the
  "session" framing — each Connect is a new working session, the
  log is a faithful transcript of that session, and the user knows
  which file came from which session by the timestamp.
- Single versioned `bestialitty.prefs` blob is the right granularity:
  one read on boot, one write per debounced change, atomic, easy
  to migrate. Keeping `bestialitty.port.preset` (VID/PID identity)
  separate respects that "forget my port" is a different action
  from "reset my preferences."
- GitHub Pages + MIT is the lowest-friction deploy + license combo.
  Pages is built into every GitHub repo; MIT is the most-copyable
  license. A VT52 emulator for an obscure retrocomputer should
  remove every barrier to use and modification by other MicroBeast
  owners.
- The 24-hour soak is the single experiment that proves "daily
  driver" status. Synthetic generators don't replicate real
  MicroBeast cadence; the only test is a real MicroBeast running
  for 24 hours with `performance.memory` sampling. The byteLength
  invariant (stable within ±10% after 10 min) is the testable
  hypothesis.

</specifics>

<deferred>
## Deferred Ideas

- **Search-in-scrollback** (Ctrl+F substring find) — defer to v2.
  Daily-driver bar is "scroll up and read"; search has its own
  design surface (regex, case, wraparound, incremental highlight)
  that warrants real workload demand before implementation.
- **Asciinema `.cast` log export** — raw `.bin` is sufficient for v1;
  add `.cast` export later if review-tooling demand surfaces.
- **TX (typed bytes / paste bytes) logging** — RX-only is the v1
  contract; debugging tools may want TX later but v1 doesn't need
  it.
- **Cross-tab `BroadcastChannel` log sharing** — out of scope; one
  tab owns one log.
- **Settings export/import (JSON)** — `v2-SESS-01`. Shipped prefs
  schema + `LICENSE` make this trivial when needed.
- **Audible bell** — `v2-AUDIO-01`. Visible flash + title prefix
  cover the v1 case.
- **Right-click context menu paste** — Ctrl+Shift+V suffices; add
  if discoverability becomes a real complaint.
- **Per-connection log retention beyond current connection** —
  user downloads or it's gone. Multi-session retention adds storage
  + indexing UI for unclear value.
- **Asciinema `.cast` export** — duplicate of bullet above; included
  for completeness.
- **DTR/RTS user toggles** — deferred from Phase 5; remains deferred
  until a MicroBeast workflow surfaces a need.
- **Send Break button** — `v2-XPORT-01`.
- **Configurable keymap remap** — out of scope per PROJECT.md.
- **User-tunable scrollback cap UI** — 10K is hardcoded.
- **Toast / banner notification primitive** — inline confirms
  (D-25 large-paste, D-35 reset-prefs) and Phase 5's Connection-pane
  error log are sufficient for v1.
- **Word-boundary regex in Settings** — the whitespace-bounded
  `\S+` definition (D-16) ships hardcoded.
- **Custom CSP / Permissions-Policy in app code** — D-39 defers to
  hosting config; revisit only if GitHub Pages doesn't honor
  `_headers`.

</deferred>

---

*Phase: 06-daily-driver-polish-session-deployment*
*Context gathered: 2026-04-25*
