# Phase 4: Keyboard Input - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire DOM `keydown` events on `#terminal-wrapper` to the already-exported
wasm `encode_key_raw(code, mods) -> Vec<u8>` boundary, route the encoded
bytes to a local TX sink (Phase 5 replaces the sink with the Web Serial
writer), expose a **local-echo toggle** (default OFF) and a **CR/LF
override toggle** that alter TX-side newline behaviour, wire a
**browser-reserved Ctrl combos** user-visible note, and ensure the canvas
retains focus after clicks on top-bar buttons. Satisfies INPUT-01..05 and
the five Phase 4 ROADMAP success criteria without any Rust core changes.

**In scope:** `www/input/keyboard.js` (new module — DOM keydown/keyup
handler, KeyboardEvent → (code u32, mods u32) packer, `compositionstart` /
`compositionend` / `isComposing` IME guard, Ctrl-W/N/T documentation note);
`www/input/tx-sink.js` (new module — module-scoped `Uint8Array` ring
buffer + hex-string formatter for the Debug pane); extensions to
`www/main.js` (wire keyboard module into term + TX sink + local echo);
extensions to `www/index.html` (new `<details id="settings">` pane with the
two toggles + browser-reserved note); extensions to
`www/renderer/chrome.js` (`mousedown` preventDefault on top-bar buttons
for focus retention); additions to the existing Debug `<details>` pane
(TX byte hex strip); Playwright specs under `www/tests/input/` covering
INPUT-01..05 and SC-1..5.

**Out of scope:** Web Serial transport (Phase 5 — the TX sink stays a local
module); mode-aware keypad parsing (`ESC =` / `ESC >` — Phase 1 D-13 punted
to Phase 4 but captures show zero usage, so deferred to v2 backlog); any
change to `crates/bestialitty-core/` (Phase 1 D-13 locks Phase 4 to JS
only); localStorage persistence of toggle state (Phase 6 — PREF-02);
F1-F12 / Home / End / PgUp / PgDn / Del / Ins key handling (not in
`KeyCode` enum, silent drop); copy / paste from clipboard (Phase 6 —
SESS-02 / SESS-03); audio bell (v2-AUDIO-01); any change to the
existing theme chord, zoom chord, or focus-indicator attribute contract
from Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Keyboard event capture

- **D-01:** Keyboard input is captured via a single `keydown` listener
  attached to `#terminal-wrapper` (the tabindex=0 focusable container
  established in Phase 3), NOT on `window` or `document`. Rationale:
  clicks outside the wrapper correctly lose focus and stop forwarding
  keys; Phase 3's `[data-focused]` attribute contract (gap #7) is
  preserved. The listener lives in `www/input/keyboard.js` — a new
  module imported and wired from `www/main.js`. Phase 3's
  `www/renderer/chrome.js` keydown listener (Ctrl+Alt+T theme toggle +
  Ctrl+{+,-,0} zoom) continues to handle its own chords; Phase 4's
  listener runs SECOND (added later in wiring order) and short-circuits
  those chords by checking `e.defaultPrevented` before encoding — so
  there is exactly one `preventDefault()` per key, no double-handling.
- **D-02:** `preventDefault()` is called **synchronously at the top of
  the handler** whenever the key will be forwarded (every printable,
  every arrow, Enter/Tab/BS/ESC, every Ctrl-letter and Ctrl-symbol,
  every numpad digit/symbol). This honours RESEARCH §Pitfall 3
  ("preventDefault must be synchronous or Chromium ignores it") and
  SC-2 ("preventDefault() recaptures every forwarded key"). Unhandled
  keys (F1–F12, Home/End, PgUp/PgDn, Del, Ins, Meta/Windows key alone,
  etc.) do **NOT** get preventDefault — they pass through to the
  browser so F5 reload, Ctrl+L address bar, etc. remain usable.
- **D-03:** Character-source discipline: use `e.code` for control keys
  (ArrowUp..ArrowRight, Enter, Tab, Backspace, Escape, Numpad*), and
  `e.key` for printable characters (so shifted-1 gives "!", not "Digit1").
  Matches RESEARCH §Pitfall 10. Explicit decision tree in the handler:
  1. If `e.isComposing` → return (IME path owns the emission via
     `compositionend`).
  2. If `e.code` matches a control key → pack appropriate KeyCode tag,
     call `encode_key_raw`, consume the bytes.
  3. Else if `e.key.length === 1` and byte <= 0xFF → pack as
     `KeyCode::Char(byte)` with modifier bits, call `encode_key_raw`.
  4. Else → silent drop (no `preventDefault`), let the browser handle.

### KeyCode packing contract (consumes Phase 2 D-09 / D-12)

- **D-04:** `www/input/keyboard.js` exposes `packKeyCode(e)` and
  `packModifiers(e)` as pure functions that return the u32 pair the
  frozen `unpack_keycode` / `unpack_mods` contract in
  `crates/bestialitty-core/src/key.rs` expects. Tag values are copied
  verbatim from Phase 2 D-12 (Char=0, ArrowUp=1, ArrowDown=2,
  ArrowLeft=3, ArrowRight=4, Enter=5, Tab=6, Backspace=7, Escape=8,
  KeypadDigit=9, KeypadEnter=10, KeypadComma=11, KeypadMinus=12,
  KeypadDot=13). Mod bits: ctrl=0, shift=1, alt=2, meta=3. A single
  `KEY_TAG` const-object in `keyboard.js` mirrors the Rust-side tag
  enum — any drift fails the Playwright smoke spec that round-trips
  every tag through `encode_key_raw`.
- **D-05:** Arrow-key mapping is `e.code === 'ArrowUp'` → tag 1
  (ArrowUp), etc. Enter → tag 5; NumpadEnter → tag 10 (KeypadEnter).
  Numpad digits: `e.code === 'Numpad0'..'Numpad9'` → tag 9 +
  (digit << 8). Numpad symbols: `NumpadAdd/Subtract/Decimal` map to
  plain `KeypadMinus`/`KeypadDot` tags where `key.rs` has a match —
  `NumpadAdd` does not have a tag in Phase 1 D-13's encoder, so it
  falls through to `Char` with `e.key === '+'`. Rationale: encoder
  already emits the correct byte, no need to re-enumerate.

### IME / composition (SC-5)

- **D-06:** IME composition is handled via three listeners on
  `#terminal-wrapper`:
  1. `compositionstart` → set `isComposing` flag to true; `keydown`
     handler early-returns while this flag is true.
  2. `compositionupdate` → no-op (we commit on `compositionend` only).
  3. `compositionend` → iterate `event.data` byte-by-byte, for each
     UTF-8 byte emit `encode_key_raw(0 /* Char */ | (byte << 8), 0)`,
     push bytes to TX. Clear `isComposing` flag.
  Additionally, `keydown` handler guards on `e.isComposing` as a
  belt-and-braces check (some Chromium versions set this on the first
  post-composition keydown). Result: zero double-emit for CJK IME input;
  satisfies SC-5 "IME composition does not double-emit characters".

### TX sink (no Web Serial yet)

- **D-07:** TX bytes go to a **module-scoped circular buffer** in
  `www/input/tx-sink.js`: `Uint8Array(1024)` + write index + wrap flag.
  Public API: `pushTxBytes(u8array)` (called from `keyboard.js` after
  `encode_key_raw`), `formatHexStrip(limit = 64)` (returns
  last-N-bytes hex string, e.g. `"1B 41 1B 42 0D"`), and
  `registerTxObserver(fn)` (fires on every push — used by the Debug
  pane hex strip to refresh in near-real-time without polling).
  Phase 5 (`/gsd-plan-phase 5`) replaces the push implementation with
  `port.writable.getWriter().write(bytes)` and adds paste throttling;
  the `pushTxBytes` signature stays, so no keyboard.js changes in
  Phase 5.

### Local-echo (INPUT-04 / SC-3)

- **D-08:** Local-echo is a module-local boolean flag in
  `www/input/keyboard.js`, default **false**. When true, after
  `encode_key_raw` returns bytes, the same bytes are also fed back
  into `term.feed(bytes)` — reusing Phase 3's existing render pipeline
  (`sampleBell()` + `drainHostReply()` + `requestFrame()` pattern from
  `main.js`). When false (default), bytes go only to the TX sink.
  **Critical:** local-echo echoes TX bytes literally — pressing ArrowUp
  with echo on feeds `ESC A` into the parser, which moves the cursor
  up rather than printing glyphs. This is correct VT52 behaviour and
  matches how physical VT52 terminals with their "LOCAL" switch work.
  Users toggling local-echo expect this; the Settings pane hint line
  makes it explicit.
- **D-09:** The local-echo toggle is wired through a single
  `setLocalEcho(bool)` function exported by `keyboard.js`; the Settings
  pane checkbox calls it. No localStorage persistence — reload resets
  to false (Phase 6 PREF-02 adds persistence).

### CR/LF override (INPUT-05 / SC-4)

- **D-10:** The CR/LF override is **TX-side only** — Phase 1 D-13
  locks Phase 4 to JS-only, so we do NOT change the parser's RX-side
  LF-implies-CR behaviour (which was set via capture evidence in
  Phase 1 and is correct for both CP/M-shell LF-only and BASIC-80 CRLF
  inputs). The override controls what bytes the **Enter** key
  transmits.
- **D-11:** Three modes, exposed as a 3-way radio group in the Settings
  pane: **CR** (default, 0x0D only — matches current `encode_key_raw`
  behaviour for Enter), **LF** (0x0A only), **CRLF** (0x0D 0x0A). The
  override is applied in `keyboard.js` as a post-encode byte-rewrite:
  after `encode_key_raw` returns, if the bytes equal `[0x0D]` AND the
  key that produced them was Enter or NumpadEnter (tracked via a flag
  from the same keydown), substitute with the selected mode's bytes
  before pushing to TX. Rationale: keeps the Rust encoder frozen and
  the substitution logic localised in one place; same mechanism works
  when Phase 5 swaps the TX sink. Default CR matches both capture
  conventions (BASIC-80 receives the CR fine because its tty driver
  echoes CRLF; CP/M shell receives CR fine because its line discipline
  treats CR as line-end).
- **D-12:** CR/LF override default is **CR** (not CRLF). Rationale:
  matches the DEC VT52 spec, matches both observed MicroBeast workloads
  (Phase 1 captures 01 and 02), and preserves Phase 1 Plan 06's
  `Enter => vec![0x0D]` encoder output as the zero-config path.
  Users who hit a "every line prints twice" or "lines stack on top of
  each other" workload flip to CRLF or LF respectively.

### UI placement (D-12 from Phase 3 defines the top-bar chrome budget)

- **D-13:** Both toggles and the browser-reserved note live inside a
  new `<details id="settings">` element inserted **above** the existing
  `<details id="debug">` and **below** the `#terminal-wrapper` in
  `www/index.html`. Summary text: "Settings". Default-collapsed (like
  Debug, per Phase 3 D-15). Rationale: Phase 3 D-12 kept the top bar
  minimal (one theme button + 3-way phosphor group); adding a checkbox
  plus a 3-way radio group plus a help note would double the top bar's
  horizontal footprint. A collapsible Settings pane keeps the
  daily-driver chrome clean while making the toggles discoverable
  (they sit right below the canvas and use a standard `<details>`
  disclosure the user already met in Phase 3's Debug pane).
- **D-14:** Settings pane content (in DOM order):
  1. A `<label><input type="checkbox" id="local-echo"> Local echo</label>`
     with a small hint line: "Show typed characters on screen before
     they reach the host. Off by default; enable for bootloaders or
     self-test modes that don't echo."
  2. A `<fieldset>` with three radios for the CR/LF mode (id:
     `crlf-cr` / `crlf-lf` / `crlf-crlf`), legend "Enter key sends",
     default selected = `cr`. Hint: "CR (0x0D) matches every MicroBeast
     workload we've observed. Switch to CRLF if every line prints
     twice; LF if lines stack on top of each other."
  3. A `<details class="reserved">` inside the Settings pane containing
     the user-visible note: "Ctrl+W, Ctrl+N, Ctrl+T are claimed by
     Chromium (close tab, new window, reopen closed tab) and cannot
     be intercepted by a web page. Use Ctrl+F4, Ctrl+Shift+N, or a
     different keybinding on the MicroBeast side if you need those
     control codes. Everything from Ctrl+A through Ctrl+Z (except W,
     N, T) is forwarded normally, as are Ctrl+@, Ctrl+[, Ctrl+\\,
     Ctrl+], Ctrl+^, Ctrl+_." (Default-collapsed; the parent Settings
     pane is where discovery happens.)

### TX-byte debug view (SC-1 verifiability)

- **D-15:** The existing Phase 3 Debug `<details id="debug">` pane is
  extended with a **TX hex strip** — a `<pre id="tx-strip">` that
  `www/input/tx-sink.js` refreshes via its observer callback. Shows
  the last 64 bytes as space-separated hex pairs (e.g. `"1B 41 1B 42
  0D"`), oldest on the left, newest on the right; clears on a new
  "Reset TX" button added next to Feed / 64 KB Stress. This is the
  "TX-byte debug view" SC-1 refers to: author hits an arrow key, looks
  at the debug pane, sees the two bytes `1B 41` appear — instant
  verifiability without DevTools. The strip is hidden visually (not
  removed) when Settings is collapsed, but always updated so a quick
  toggle-open shows current state.

### Focus retention (SC-5)

- **D-16:** Top-bar buttons and the new Settings-pane toggles use
  `mousedown` preventDefault — this is the cleanest fix for "canvas
  holds focus after clicking any toolbar button" (SC-5). `mousedown`
  fires before focus transfer; calling `preventDefault()` on it
  prevents the native focus move entirely, so the terminal wrapper
  keeps focus. Alternative options (programmatic refocus in the
  click handler, `pointerdown`, custom focus trap) were considered and
  rejected: programmatic refocus creates a brief focus flicker the
  user can see; `pointerdown` doesn't cover keyboard activation of
  buttons (Space / Enter with focus already on the button is a valid
  path we don't want to break). The mousedown-preventDefault rule is
  applied in `chrome.js` for theme + phosphor buttons, and in the new
  Settings wiring for the echo checkbox, CR/LF radios, and Reset TX
  button. Keyboard activation of these same buttons (Tab-to, Space)
  still works because `mousedown` doesn't fire on keyboard activation.

### Unhandled / out-of-scope keys

- **D-17:** F1–F12, Home, End, PgUp, PgDn, Insert, Delete, PrintScreen,
  CapsLock, ScrollLock, NumLock, ContextMenu, and the Meta/Windows key
  are all **silent drop, no preventDefault**. Rationale: they are not
  in the Phase 1 `KeyCode` enum; VT52 has no canonical byte sequence
  for them; MicroBeast software does not expect them. Passing them
  through to the browser preserves F5 reload, F12 devtools, F11
  fullscreen, etc. which a daily driver needs. If a future MicroBeast
  workload surfaces a need for any of these, it's a v2 scope addition
  that requires extending the Rust `KeyCode` enum first.
- **D-18:** Mode-aware keypad (`ESC =` / `ESC >`) is **deferred to v2
  backlog**, not Phase 4. Rationale: Phase 1 D-13 handed this to
  Phase 4, but both Phase 1 captures (`capture-01-cpm-boot` and
  `capture-02-basic`) show **zero** `ESC =` / `ESC >` bytes —
  MicroBeast software does not use mode-aware keypad. Plain-ASCII
  keypad output (current encoder behaviour for `KeypadDigit(d)` →
  `b'0' + d`) is sufficient. Deferred idea recorded for v2 if a real
  workload demands it.

### Claude's Discretion

- Exact CSS styling of the new Settings `<details>` pane (matches the
  existing Debug pane's styling verbatim unless there's a reason not to).
- Whether the TX hex strip shows 32, 64, or 128 bytes — pick a value
  that fits on one line at the Debug pane's current width.
- Whether `keyboard.js` exports a single `wireKeyboard(opts)` function
  (matching the `wireChrome(opts)` pattern) or multiple small exports.
- Whether the IME `compositionend` emission uses `TextEncoder` (UTF-8
  multi-byte) or strict `charCodeAt() <= 0xFF` guard (ASCII only). VT52
  is an ASCII terminal, so the latter is adequate; the former is
  future-proof. Planner picks based on complexity vs value.
- Exact layout of the Playwright specs (one `input/` directory mirroring
  `render/`; one spec per INPUT-* requirement vs grouped specs). Follow
  Phase 3's `www/tests/render/` convention.
- Whether to add a `keyup` listener at all (none of INPUT-01..05 needs
  one; `keydown` alone covers every requirement).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` — architectural split (Rust pure logic + JS
  shell), Chromium-only, static-site constraint, daily-driver target;
  key-decisions table (no Rust changes in Phase 4 per D-13 row — the
  key encoder already ships from Phase 1)
- `.planning/REQUIREMENTS.md` §Input — INPUT-01..05 are the five
  in-scope requirements; Out-of-Scope block confirms "MicroBeast-specific
  key codes / configurable keymap remap" is not in v1
- `.planning/ROADMAP.md` §"Phase 4: Keyboard Input" — goal, depends_on
  Phase 3, five success criteria (SC-1..5)

### Phase 1 deliverables (load-bearing for Phase 4)

- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md`
  §D-13 — full key encoder shipped in Phase 1; Phase 4 is limited to
  JS-side DOM event → `KeyEvent` struct packing
- `crates/bestialitty-core/src/key.rs` — the complete `encode`,
  `unpack_keycode`, `unpack_mods` contract (with unit tests). Phase 4
  MUST NOT modify this file; it packs u32 values that unpack to the
  existing enum variants.
- `.planning/research/captures/README.md` — CR/LF convention cross-ref;
  "MicroBeast emits two distinct CR/LF conventions depending on
  program" — drives D-10..D-12 (TX-side-only override, default CR,
  3-way mode)
- `.planning/research/captures/capture-01-cpm-boot/README.md` — shell
  emits bare LF; confirms Enter→CR default is wire-compatible
- `.planning/research/captures/capture-02-basic/README.md` — BASIC-80
  emits CRLF; confirms CRLF mode is useful for BASIC-heavy sessions

### Phase 2 deliverables (boundary consumed by Phase 4)

- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md`
  §D-09 — `encode_key_raw(code: u32, mods: u32) -> Vec<u8>` signature;
  Phase 4 consumes this verbatim, no new boundary exports needed
- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md`
  §D-12 (paraphrased via the frozen tag set in key.rs) — KeyCode
  discriminant tags + modifier bits packing scheme; D-04 mirrors these
  in JS
- `crates/bestialitty-core/tests/boundary_api_shape.rs` — compile-time
  pin of `encode_key_raw`. Phase 4 must not trigger a signature change.

### Phase 3 deliverables (chrome + focus contract Phase 4 extends)

- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` §D-13 — focus
  indicator via `[data-focused="true"]` attribute selector (NOT
  `:focus-visible`); Phase 4's focus-retention fix (D-16) must preserve
  this contract
- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` §D-14 — theme
  chord is Ctrl+Alt+T (not Ctrl+Shift+T, which Chromium reserves); the
  Phase 4 keyboard handler MUST NOT shadow Ctrl+Alt+T, Ctrl+Equal/Minus/0
- `www/renderer/chrome.js` — existing `keydown` listener on
  `#terminal-wrapper` (handles Ctrl+Alt+T, Ctrl+{+/-/0}) — Phase 4's
  new handler checks `e.defaultPrevented` after chrome.js runs and
  short-circuits those chords
- `www/index.html` — `<div id="terminal-wrapper" tabindex="0">` is the
  focus target; `<details id="debug">` is the existing Debug pane that
  Phase 4 extends with a TX hex strip

### Pitfalls research directly applicable

- `.planning/research/PITFALLS.md` §Pitfall 3 — synchronous
  preventDefault; Phase 4 D-02 honours this
- `.planning/research/PITFALLS.md` §Pitfall 10 — `e.code` vs `e.key`;
  Phase 4 D-03 applies both correctly (code for control keys, key for
  printable)
- `.planning/research/PITFALLS.md` §"Keyboard input: Often missing IME
  awareness — verify `event.isComposing` check so IME doesn't
  double-emit" — Phase 4 D-06 implements the full composition lifecycle
- `.planning/research/SUMMARY.md` — "Guard on `event.isComposing`" is
  the settled pattern

### External specs

- [MDN KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code)
  — canonical list of `e.code` values for arrow keys, numpad, etc.
- [MDN Element.mousedown event](https://developer.mozilla.org/en-US/docs/Web/API/Element/mousedown_event)
  — confirms `preventDefault()` on `mousedown` prevents focus transfer
  (D-16 mechanism)
- [MDN CompositionEvent](https://developer.mozilla.org/en-US/docs/Web/API/CompositionEvent)
  — `compositionstart` / `compositionupdate` / `compositionend`
  lifecycle and the `isComposing` flag on KeyboardEvent (D-06)
- [DEC VT52 DECscope Maintenance Manual, Chapter 3](https://vt100.net/docs/vt52-mm/chapter3.html)
  — arrow-key output is ESC A/B/C/D (already encoded in Phase 1 key.rs;
  cross-ref for the Playwright spec assertions)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `crates/bestialitty-core/src/key.rs` — the complete VT52 key encoder
  with `encode(KeyEvent) -> Vec<u8>`, `unpack_keycode(u32) -> Option<KeyCode>`,
  `unpack_mods(u32) -> Modifiers`. Phase 4 wraps these via the already-
  exported wasm boundary; **zero modifications**.
- `crates/bestialitty-core/src/lib.rs` wasm façade — already exports
  `encode_key_raw(code: u32, mods: u32) -> Vec<u8>` (Phase 2 Plan 03,
  pinned by `boundary_api_shape.rs`). `www/main.js:35` already smoke-
  exercises this export with `encode_key_raw(1, 0) → [27, 65]` (ESC A)
  so it is not dead-stripped. Phase 4 replaces that boot log line with
  real DOM-driven calls.
- `www/main.js:14` — `import init, { Terminal, encode_key_raw } from
  './pkg/bestialitty_core.js'`. Phase 4 adds a
  `import { wireKeyboard } from './input/keyboard.js'` and calls it
  after `wireChrome`.
- `www/renderer/chrome.js:76-110` — existing keydown listener on
  `#terminal-wrapper` for theme + zoom chords. Phase 4's new listener
  attaches AFTER this, checks `e.defaultPrevented`, short-circuits.
  Also hosts the new `mousedown`-preventDefault wiring for the
  theme button + phosphor buttons.
- `www/renderer/chrome.js:115-122` — focus/blur listeners that set
  `[data-focused="true"]` attribute. Phase 4 preserves this verbatim;
  the mousedown-preventDefault change means focus never leaves the
  wrapper in the first place, so the blur listener fires less often
  (but still correctly when the user Tab-focuses away).
- `www/index.html:170-176` — existing `#top-bar` with theme button +
  phosphor group; Phase 4 adds `mousedown`-preventDefault wiring to
  the same elements.
- `www/index.html:187-201` — existing `<details id="debug">` Phase 3 D-15
  pane; Phase 4 extends with a `<pre id="tx-strip">` and a
  `<button id="tx-reset">Reset TX</button>`.
- `www/main.js:126-168` — existing Feed / 64 KB Stress click handlers
  with `sampleBell()` + `drainHostReply()` + `requestFrame()` pattern.
  Phase 4's local-echo path reuses this pattern (but with the TX byte
  sequence, not paste input).
- `www/main.js:127-137` — `sampleBell()` + `TITLE_PREFIX` pattern; the
  local-echo feed path MUST call `sampleBell()` after `term.feed()`
  because echoed BEL bytes should flash the canvas the same way remote
  BEL does.
- Phase 3 Playwright infrastructure at `www/tests/render/`,
  `www/playwright.config.js`, and visual baselines; Phase 4's
  `www/tests/input/` mirrors the pattern with no net new tooling.

### Established Patterns

- **Synchronous keydown chord handlers with `e.code`** (chrome.js) —
  Phase 4 continues this posture (D-02, D-03).
- **`[data-focused]` attribute for focus indicator** (Phase 3 gap #7)
  — Phase 4 does not alter this; D-16 preserves the attribute contract.
- **Module-scope cached Uint8Array views with buffer-identity guard**
  (Phase 2 D-03 + Phase 3) — Phase 4's TX sink uses the same
  "lazy re-derive on buffer identity change" pattern for its
  `host_reply` drain if local-echo is on (term.feed() may grow memory,
  invalidating any cached views).
- **Framework-free JS** (Phase 2 D-14 + Phase 3) — Phase 4 continues
  this; no React, no bundler.
- **One `<details>` pane per concern** (Phase 3 D-15 Debug pane) —
  Phase 4 adds a Settings pane following the same disclosure pattern.
- **Synchronous bell sampling after every `term.feed()`** (Phase 3
  `sampleBell()`) — Phase 4 local-echo path honours this; pattern is
  preserved for Phase 5 Web Serial too.

### Integration Points

- `www/main.js` — import `wireKeyboard` from `./input/keyboard.js` and
  call it after `wireChrome`, passing `{ term, wasm, terminalWrapper,
  localEchoCheckbox, crlfRadios, txStrip, txResetButton }`.
- `www/input/keyboard.js` — **new file** — owns the keydown listener,
  composition listeners, packKeyCode / packModifiers, local-echo logic,
  CR/LF override logic, and exports `wireKeyboard`, `setLocalEcho`,
  `setCrlfMode`.
- `www/input/tx-sink.js` — **new file** — owns the TX ring buffer,
  exports `pushTxBytes`, `formatHexStrip`, `registerTxObserver`,
  `resetTx`.
- `www/index.html` — new `<details id="settings">` with local-echo
  checkbox + CR/LF radio group + browser-reserved note; Debug pane
  gets `<pre id="tx-strip">` and `<button id="tx-reset">`.
- `www/renderer/chrome.js` — adds `mousedown` preventDefault wiring on
  theme + phosphor buttons (D-16).
- `www/tests/input/` — **new directory** — Playwright specs mirroring
  `render/` structure.
- **Phase 5 contract:** `pushTxBytes(bytes)` in `tx-sink.js` gets
  swapped to `await txWriter.write(bytes)` (chunked via paste
  throttler). Signature stays byte-array in, Promise-or-void out.

</code_context>

<specifics>
## Specific Ideas

- The TX hex strip should look like the kind of thing you see in the
  bottom of a serial-debugger app — small monospace, pale colour, just
  the last line of hex. Not a log, not a scrolling transcript. One
  glance → "yes, ESC A fired" → back to work.
- Local-echo default OFF is the right default for the MicroBeast
  specifically — CP/M line discipline echoes everything, and BASIC
  echoes everything. If the user is in the bootloader or a self-test
  mode where the MicroBeast isn't echoing, flipping local-echo on
  gives them immediate visual feedback.
- CR/LF default CR (not CRLF) because every observed MicroBeast
  workload (CP/M shell, BASIC-80) accepts CR-only Enter without
  complaint. A user landing in a workload that doesn't (hypothetical
  future BASIC-like interpreter) flips the toggle — the toggle exists
  specifically for that "it's broken, what do I do?" moment, not as a
  daily-driver decision point.
- Browser-reserved note matters because SC-2 explicitly asks for a
  "user-visible note" about Ctrl-W / Ctrl-N / Ctrl-T. The Settings
  pane hosts this naturally — users open Settings when a key "doesn't
  work" and see the note immediately.
- Focus-retention via mousedown-preventDefault feels invisible: you
  click theme, the theme flips, and you keep typing — no refocus
  flicker, no "oh wait where did focus go". This is the kind of
  daily-driver polish the roadmap's "daily driver" framing demands.

</specifics>

<deferred>
## Deferred Ideas

- **Mode-aware keypad (`ESC =` / `ESC >`)** — Phase 1 D-13 handed this
  to Phase 4, but MicroBeast captures show zero usage. Deferred to
  v2 backlog; add only if a real workload surfaces it.
- **F1–F12 / Home / End / PgUp / PgDn / Del / Ins key encoding** — not
  in Phase 1 `KeyCode` enum; VT52 has no canonical bytes for them;
  MicroBeast software does not expect them. Adding them is a v2
  scope expansion that requires the Rust core enum first.
- **Configurable keymap / MicroBeast-specific key codes** — explicit
  PROJECT.md Out-of-Scope: "Stock PC→VT52 mapping is enough for daily
  driving".
- **Send Break button** — deferred v2-XPORT-01 (requires
  `SerialPort.setSignals({break: true})` which is Phase 5 / Web
  Serial territory anyway).
- **Paste throttling + large-paste confirmation** — Phase 5 XPORT-09;
  the TX sink in Phase 4 is synchronous with no throttling because
  there is no serial link yet to overrun.
- **Local-echo / CR-LF persistence across reloads** — Phase 6 PREF-02;
  Phase 4 state is module-local only.
- **Audible bell** — v2-AUDIO-01; Phase 4 does not revisit the bell
  pipeline (Phase 3 D-08 / D-09 own it).
- **Clipboard copy/paste integration** — Phase 6 SESS-02 / SESS-03.
- **Extended modifier behaviour (Alt-prefix-ESC for Meta users, etc.)**
  — Phase 1 `key.rs` pins Alt/Meta as no-ops on printable chars with
  a regression test; changing that is a v2 scope addition.
- **Keyboard shortcut help overlay / cheat sheet** — the Settings-pane
  browser-reserved note covers the SC-2 requirement; a full overlay
  is polish for v2.

</deferred>

---

*Phase: 04-keyboard-input*
*Context gathered: 2026-04-22*
