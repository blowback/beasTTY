# Phase 4: Keyboard Input - Research

**Researched:** 2026-04-22
**Domain:** DOM KeyboardEvent handling, IME composition lifecycle, focus retention, browser-reserved Ctrl combos, TX-byte verifiability, Playwright Chromium testing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Keyboard event capture**

- **D-01:** Single `keydown` listener on `#terminal-wrapper` (NOT on `window` or `document`). Lives in `www/input/keyboard.js`, imported and wired from `www/main.js`. Attaches AFTER Phase 3's `www/renderer/chrome.js` keydown listener and short-circuits on `e.defaultPrevented` so exactly one `preventDefault()` fires per key.
- **D-02:** `preventDefault()` synchronous at the top of the handler for every forwarded key (printables, arrows, Enter/Tab/BS/ESC, Ctrl-letter, Ctrl-symbol, numpad digits/symbols). Unhandled keys (F1–F12, Home/End, PgUp/PgDn, Del/Ins, Meta alone, etc.) do NOT get preventDefault — they pass through.
- **D-03:** `e.code` for control keys; `e.key` for printables. Decision tree: (1) `e.isComposing` → return; (2) control-key code → pack KeyCode tag, call `encode_key_raw`, consume bytes; (3) `e.key.length === 1` and byte ≤ 0xFF → pack `KeyCode::Char(byte)` + mod bits; (4) else silent drop (no preventDefault).

**KeyCode packing (consumes Phase 2 D-09 / D-12)**

- **D-04:** `www/input/keyboard.js` exports `packKeyCode(e)` and `packModifiers(e)` as pure functions returning u32 pairs matching `unpack_keycode` / `unpack_mods` in `key.rs`. Tag values verbatim: Char=0, ArrowUp=1, ArrowDown=2, ArrowLeft=3, ArrowRight=4, Enter=5, Tab=6, Backspace=7, Escape=8, KeypadDigit=9, KeypadEnter=10, KeypadComma=11, KeypadMinus=12, KeypadDot=13. Mod bits: ctrl=0, shift=1, alt=2, meta=3. `KEY_TAG` const mirrors Rust enum.
- **D-05:** `e.code === 'ArrowUp'` → tag 1; `Enter` → tag 5; `NumpadEnter` → tag 10; `Numpad0..9` → tag 9 + (digit << 8). `NumpadAdd` falls through to `Char('+')` because no dedicated tag exists.

**IME / composition (SC-5)**

- **D-06:** Three listeners on `#terminal-wrapper`: `compositionstart` sets flag; `compositionupdate` no-op; `compositionend` iterates `event.data` byte-by-byte, emits each via `encode_key_raw(0 | (byte << 8), 0)`, pushes to TX. `keydown` also guards on `e.isComposing` (belt-and-braces).

**TX sink (no Web Serial yet)**

- **D-07:** Module-scoped circular `Uint8Array(1024)` in `www/input/tx-sink.js` + write index + wrap flag. Public API: `pushTxBytes(u8array)`, `formatHexStrip(limit = 64)` (e.g. `"1B 41 1B 42 0D"`), `registerTxObserver(fn)`. Phase 5 swaps the implementation to `port.writable.getWriter().write(bytes)`.

**Local-echo (INPUT-04 / SC-3)**

- **D-08:** Module-local boolean in `keyboard.js`, default **false**. When true, echo TX bytes through `term.feed(bytes)` — reusing Phase 3 `sampleBell()` + `drainHostReply()` + `requestFrame()` pattern. ArrowUp echoed with echo-on feeds `ESC A` into the parser (cursor moves), matching VT52 LOCAL-switch semantics.
- **D-09:** `setLocalEcho(bool)` exported from `keyboard.js`; Settings checkbox calls it. No localStorage persistence.

**CR/LF override (INPUT-05 / SC-4)**

- **D-10:** TX-side only. RX-side LF-implies-CR parser behaviour (set via capture evidence in Phase 1) unchanged.
- **D-11:** Three modes as 3-way radio group: **CR** (0x0D, default), **LF** (0x0A), **CRLF** (0x0D 0x0A). Applied as post-encode byte-rewrite in `keyboard.js`: if bytes equal `[0x0D]` AND source key was Enter or NumpadEnter, substitute per selected mode.
- **D-12:** Default **CR**. Matches DEC VT52 spec, both Phase 1 captures, and preserves Phase 1 Plan 06 `Enter => vec![0x0D]` output as zero-config path.

**UI placement**

- **D-13:** `<details id="settings">` inserted **above** `<details id="debug">` and **below** `#terminal-wrapper` in `www/index.html`. Summary: "Settings". Default-collapsed.
- **D-14:** Settings content (DOM order):
  1. `<label><input type="checkbox" id="local-echo"> Local echo</label>` + hint line.
  2. `<fieldset>` with three radios (`crlf-cr`/`crlf-lf`/`crlf-crlf`), legend "Enter key sends", default `cr` checked + hint.
  3. Nested `<details class="reserved">` with browser-reserved note.

**TX-byte debug view (SC-1)**

- **D-15:** Extend existing `<details id="debug">` with `<pre id="tx-strip">` + `<button id="tx-reset">Reset TX</button>`. `tx-sink.js` refreshes via observer callback. Last 64 bytes as space-separated uppercase hex pairs, oldest left. Hidden visually when parent collapsed but always updated.

**Focus retention (SC-5)**

- **D-16:** `mousedown` preventDefault on top-bar buttons + Settings toggles (echo checkbox, CR/LF radios, Reset TX). Keyboard activation (Tab-to + Space/Enter) still works natively. Applied in `chrome.js` for theme + phosphor buttons; in Settings wiring for new controls.

**Unhandled keys**

- **D-17:** F1–F12, Home, End, PgUp, PgDn, Insert, Delete, PrintScreen, CapsLock, ScrollLock, NumLock, ContextMenu, Meta/Windows alone: **silent drop, no preventDefault**. Pass through to browser (F5 reload, F12 devtools, F11 fullscreen preserved).
- **D-18:** Mode-aware keypad (`ESC =` / `ESC >`) deferred to v2 backlog (captures show zero usage).

### Claude's Discretion

- Exact CSS styling of Settings `<details>` (mirrors Debug pane unless reason not to).
- TX hex strip shows 32/64/128 bytes — planner picks (D-15 pins 64).
- Whether `keyboard.js` exports single `wireKeyboard(opts)` (matches `wireChrome` pattern) vs multiple small exports.
- Whether IME `compositionend` uses `TextEncoder` (UTF-8 multi-byte) vs strict `charCodeAt() <= 0xFF` guard (ASCII only).
- Playwright spec layout (one `input/` dir mirroring `render/`; one spec per INPUT-* vs grouped).
- Whether to add a `keyup` listener (none of INPUT-01..05 needs one).

### Deferred Ideas (OUT OF SCOPE)

- Mode-aware keypad (`ESC =` / `ESC >`) → v2 backlog.
- F1–F12 / Home / End / PgUp / PgDn / Del / Ins key encoding → v2 scope expansion.
- Configurable keymap / MicroBeast-specific key codes → PROJECT.md Out-of-Scope.
- Send Break button → v2-XPORT-01.
- Paste throttling → Phase 5 XPORT-09.
- Local-echo / CR-LF persistence across reloads → Phase 6 PREF-02.
- Audible bell → v2-AUDIO-01.
- Clipboard copy/paste → Phase 6 SESS-02 / SESS-03.
- Extended modifier behaviour (Alt-prefix-ESC) → v2.
- Keyboard shortcut help overlay / cheat sheet → v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INPUT-01 | Standard PC keyboard maps to VT52 key codes (arrows, keypad, control keys) | §Standard Stack (Phase 1 `encode_key_raw` wasm boundary), §Pattern 1 (e.code vs e.key discipline), §Pattern 2 (KeyCode tag packing) |
| INPUT-02 | Arrow keys transmit ESC A / ESC B / ESC C / ESC D | §Pattern 2 (`ArrowUp` → tag 1 → encoder returns `[0x1B, 0x41]`), §Validation Architecture (Playwright keydown + TX-strip assertion) |
| INPUT-03 | Ctrl-key combos transmit correct 0x00–0x1F bytes with sensible handling of browser-reserved (Ctrl-W/N/T) | §Browser-Reserved Ctrl Combos Inventory, §Copy for Settings note, §Pattern 1 (synchronous preventDefault) |
| INPUT-04 | Local echo toggle, default off | §Pattern 3 (local-echo as post-encode fork into `term.feed`), §Common Pitfalls (local-echo ≠ echo-glyphs; it echoes TX bytes literally) |
| INPUT-05 | CR/LF override toggle for edge-case MicroBeast software | §Pattern 4 (TX-side post-encode byte-rewrite only on Enter/NumpadEnter), §Common Pitfalls (Don't change parser; don't override Ctrl-M) |
</phase_requirements>

## Summary

Phase 4 is the smallest remaining functional phase by code volume — all the hard correctness work (the Rust key encoder with 37 tests, the u32 packing contract, the wasm boundary) shipped in Phases 1 and 2. Phase 4's job is pure DOM plumbing: wire `keydown` events to the already-exported `encode_key_raw(code, mods) -> Vec<u8>`, sink the returned bytes into a local ring buffer (which Phase 5 will replace with Web Serial), and add two tiny UI toggles plus a hex-strip diagnostic. Every architectural choice is already locked in CONTEXT.md (D-01..D-18) and UI-SPEC.md. What this research adds is the verified detail that makes those decisions safe to execute.

The research confirms five load-bearing mechanics. **(1)** Synchronous `preventDefault()` is the only way to capture keys on `keydown` — any `await` before `preventDefault()` makes Chromium ignore it. **(2)** `e.code` is the right field for physical-key matching (arrow keys, Enter, numpad) and `e.key` is the right field for printable characters (so shifted-1 reads as `!` not `Digit1`). **(3)** Chromium genuinely refuses to let a web page intercept Ctrl+W, Ctrl+N, and Ctrl+T — this is security policy, not a bug; it is unchanged from training-data timeframe and has been Chromium's stance since 2010 (issue #33056). Everything else in the Ctrl-letter family (A..Z minus W, N, T plus the six Ctrl-symbols) is reliably preventable. **(4)** `mousedown` preventDefault prevents native focus transfer without affecting keyboard activation — this is MDN-documented and is the clean fix for SC-5's "canvas keeps focus after toolbar click". **(5)** IME composition in Chromium dispatches `compositionstart` before the first `keydown`, sets `isComposing=true` on every composition-phase `keydown`, and fires `compositionend` with the final composed string in `event.data` just before the final `keydown` (which also has `isComposing=true`). Guarding on `e.isComposing` in `keydown` plus emitting from `compositionend` gives exactly one TX emission per composed result.

**Primary recommendation:** Execute CONTEXT.md D-01..D-18 verbatim with the small additions in this document (the Ctrl-reserved inventory table, the TX-strip hex-format spec, the Playwright testing patterns). No new architectural decisions are needed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DOM keydown capture + preventDefault | Browser / Client (JS) | — | Only browser sees KeyboardEvent; Phase 1 D-13 locks Phase 4 to JS-only |
| KeyboardEvent → (u32 code, u32 mods) packing | Browser / Client (JS) | — | Pure JS function; Rust side owns the unpack (Phase 1 `key::unpack_keycode`/`unpack_mods`) |
| Byte encoding (ArrowUp → `[0x1B, 0x41]` etc.) | Rust / Wasm core | — | Phase 1 ships `encode_key_raw`; Phase 4 calls it, no Rust change |
| Local-echo feed into term | Browser / Client (JS) | Rust / Wasm core (via `term.feed`) | Fork-point is JS; parser is Rust; reuses Phase 2 batched feed |
| CR/LF override byte-rewrite | Browser / Client (JS) | — | Post-encode substitution; keeps Rust encoder frozen (D-10) |
| IME `compositionstart/update/end` listeners | Browser / Client (JS) | Rust / Wasm core (per-byte `encode_key_raw`) | CompositionEvent is DOM-only; emission still goes through wasm encoder |
| TX ring buffer + hex-strip formatter | Browser / Client (JS) | — | Local to JS shell; Phase 5 swaps implementation |
| Mousedown preventDefault on toolbar controls | Browser / Client (JS) | — | Focus management is browser-owned |
| Settings/Debug pane DOM | Browser / Client (JS / HTML / CSS) | — | Static DOM; no API layer |

All new code is in the JS shell. The wasm boundary is **read-only** for Phase 4 (we call exports; we don't add any). `crates/bestialitty-core/` is untouched.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none — vanilla DOM) | n/a | KeyboardEvent, CompositionEvent, mousedown, document.activeElement | Project is framework-free (PROJECT.md + Phase 2 D-14); standard DOM APIs cover 100% of Phase 4 needs [VERIFIED: www/renderer/chrome.js already uses this posture] |
| `bestialitty-core` (existing wasm module) | workspace | `encode_key_raw(code, mods)` + `term.feed(bytes)` | Already-shipped Phase 1/2 deliverable; Phase 4 consumes verbatim [VERIFIED: crates/bestialitty-core/src/key.rs:141-177 + www/main.js:14] |
| `@playwright/test` | ^1.51.0 | Playwright test runner for Chromium-only verification | Already configured in `www/package.json`; Phase 3 tests live at `www/tests/render/` [VERIFIED: www/package.json + www/playwright.config.js] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `TextEncoder` (built-in) | browser | UTF-8 encode composed IME strings to bytes | Only if Claude's-discretion choice lands on "UTF-8 multi-byte composition" path; VT52 is ASCII so `charCodeAt() <= 0xFF` guard is adequate (D-06 Claude discretion) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vanilla `addEventListener('keydown', ...)` | `KeyboardLayoutMap` (`navigator.keyboard.getLayoutMap()`) for layout-aware mapping | Not needed: VT52 encoder accepts raw `e.key` byte values + `e.code` discriminants; national-layout differences are handled by the browser before `e.key` is populated [CITED: MDN KeyboardEvent.key] |
| `document.addEventListener('keydown')` (global) | Per-element listener on `#terminal-wrapper` | D-01 locks per-element; global catches keys typed into Debug pane textarea which is wrong |
| `keypress` event | `keydown` event | `keypress` is deprecated + doesn't fire for non-printables (arrows, Enter) [CITED: MDN Element/keypress_event — deprecated as of 2018, confirmed deprecated in current MDN] |
| `input` event on a hidden `<input>` | `keydown` on tabindex=0 div | Hidden-input pattern breaks IME predictably, loses focus on any toolbar click (Pitfall 13), and fights the canvas-first DOM |
| `keyboardLock` API | Not locking | Only works in fullscreen; Phase 4 does not ship a fullscreen mode (v2 idea); the Settings-pane note covers the SC-2 requirement |

**Installation:**

```bash
# Nothing new — all dependencies present after Phase 3.
# Confirm:
cd www && node -e "require('@playwright/test')"  # should print undefined, no error
```

**Version verification:** Not applicable — no new npm packages. The only wasm-boundary export consumed is `encode_key_raw`, pinned by `crates/bestialitty-core/tests/boundary_api_shape.rs` since Phase 2 Plan 03.

## Architecture Patterns

### System Architecture Diagram

```
User keystroke
     │
     ▼
#terminal-wrapper (tabindex=0)
     │
     ├──► chrome.js keydown (Phase 3)
     │         │
     │         ├── Ctrl+Alt+T → preventDefault + toggleTheme()
     │         ├── Ctrl+{Equal,Minus,Digit0} → preventDefault + zoomStep/resetZoom
     │         └── (returns; e.defaultPrevented is now true for handled chords)
     │
     └──► keyboard.js keydown (Phase 4 — attaches SECOND)
               │
               ├── if e.defaultPrevented → return (chrome.js claimed it)
               ├── if e.isComposing → return (IME path owns emission)
               │
               ├── Decision tree:
               │     (1) Unhandled key class (F1-F12, Home/End/..., Meta alone)
               │            → return WITHOUT preventDefault (pass-through)
               │     (2) Control key via e.code (ArrowUp/..., Enter, Tab, BS, ESC,
               │         Numpad0..9, NumpadEnter, NumpadComma, NumpadDecimal,
               │         NumpadSubtract)
               │            → preventDefault (synchronous)
               │            → packKeyCode(e) + packModifiers(e) → u32 pair
               │            → encode_key_raw(code, mods) → Uint8Array
               │     (3) Printable via e.key.length === 1, byteVal ≤ 0xFF
               │            → preventDefault (synchronous)
               │            → pack as Char(byteVal) + mod bits
               │            → encode_key_raw(code, mods) → Uint8Array
               │     (4) else → silent drop (no preventDefault)
               │
               ├── CR/LF override (D-11):
               │     if sourceKey ∈ {Enter, NumpadEnter} AND bytes == [0x0D]:
               │         substitute per selected mode (CR | LF | CRLF)
               │
               └──► pushTxBytes(bytes)  (tx-sink.js)
                         │
                         ├── write into ring buffer, advance index
                         ├── fire every registered observer(bytes)
                         │       │
                         │       └── Debug pane: update #tx-strip textContent
                         │               via formatHexStrip(64)
                         │
                         └── if localEcho === true:
                                  term.feed(bytes)
                                  sampleBell()            // Phase 3 pattern
                                  drainHostReply('echo')
                                  requestFrame()

Parallel IME path:
#terminal-wrapper
     ├──► compositionstart → isComposing=true
     ├──► compositionupdate → (no-op)
     └──► compositionend →
               for each byte in event.data (ASCII guard OR TextEncoder):
                     encode_key_raw(0 | (byte << 8), 0)
                     pushTxBytes(result)
               isComposing=false

Parallel focus-retention path:
#top-bar buttons, Settings controls
     └──► mousedown → preventDefault
            (native focus transfer suppressed;
             #terminal-wrapper retains focus;
             click handler still fires and mutates state;
             for checkbox/radio/reset-button the click handler
             also programmatically sets .checked / dispatches intent)
```

### Recommended Project Structure

```
www/
├── input/                  # NEW directory (Phase 4)
│   ├── keyboard.js         # DOM keydown + composition listeners;
│   │                       # packKeyCode / packModifiers;
│   │                       # local-echo flag + setLocalEcho;
│   │                       # CR/LF mode + setCrlfMode;
│   │                       # exports wireKeyboard(opts)
│   └── tx-sink.js          # Ring buffer Uint8Array(1024);
│                           # pushTxBytes, formatHexStrip,
│                           # registerTxObserver, resetTx
├── renderer/               # Phase 3 — mostly unchanged
│   ├── chrome.js           # ADD mousedown-preventDefault on theme
│   │                       # + phosphor buttons (D-16)
│   ├── canvas.js           # unchanged
│   ├── themes.js           # unchanged
│   ├── atlas.js            # unchanged
│   └── bitmap-font.js      # unchanged
├── tests/
│   ├── render/             # Phase 3 specs (unchanged)
│   └── input/              # NEW directory (Phase 4 Playwright specs)
│       ├── keydown-arrows.spec.js        # INPUT-02 + SC-1
│       ├── keydown-ctrl-letters.spec.js  # INPUT-03 + SC-2
│       ├── keydown-printable.spec.js     # INPUT-01
│       ├── local-echo.spec.js            # INPUT-04 + SC-3
│       ├── crlf-override.spec.js         # INPUT-05 + SC-4
│       ├── ime-composition.spec.js       # SC-5 (IME half)
│       ├── focus-retention.spec.js       # SC-5 (focus half)
│       └── tx-debug-strip.spec.js        # SC-1
├── main.js                 # ADD import + wireKeyboard() call
│                           # after wireChrome()
├── index.html              # ADD <details id="settings"> above #debug;
│                           # ADD <pre id="tx-strip"> + Reset TX button
│                           # inside #debug; ADD CSS for #settings + #tx-strip
└── playwright.config.js    # EXTEND testDir to match both render/ and input/
                            # via testMatch glob
```

### Pattern 1: Synchronous preventDefault on keydown

**What:** Call `e.preventDefault()` at the TOP of the keydown handler, before any async work, for every key you want to forward. Chromium silently ignores `preventDefault()` called after an `await`, a `setTimeout`, or after returning from the handler.

**When to use:** Every keydown handler in a terminal emulator. Phase 3 `chrome.js` already follows this (line 87, line 94, line 98, line 104). Phase 4 MUST continue this posture.

**Example:**

```javascript
// www/input/keyboard.js
// Source: www/renderer/chrome.js pattern + MDN Event.preventDefault()
//   https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault
terminalWrapper.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;          // chrome.js already handled
    if (e.isComposing) return;               // IME owns this keystroke

    const tag = mapCodeToTag(e.code);         // null if unhandled
    if (tag === null) {
        // printable path OR silent-drop path
        if (e.key.length === 1 && e.key.charCodeAt(0) <= 0xFF) {
            e.preventDefault();                // SYNCHRONOUS — line 1 of branch
            const code = KEY_TAG.Char | (e.key.charCodeAt(0) << 8);
            const mods = packModifiers(e);
            const bytes = encode_key_raw(code, mods);
            forwardBytes(bytes, /* sourceKey */ null);
        }
        return;                                // pass-through for unhandled
    }

    e.preventDefault();                        // SYNCHRONOUS — before any work
    const code = packControlKey(tag, e);       // arrows / Numpad / etc.
    const mods = packModifiers(e);
    const bytes = encode_key_raw(code, mods);
    forwardBytes(bytes, tag);                  // tag passed for CR/LF override
});
```

### Pattern 2: KeyCode tag packing (JS side)

**What:** Mirror the Rust `key.rs` discriminants in a JS `KEY_TAG` const-object, then pack `(tag | payload << 8)` as the `code` u32. Modifiers pack into a separate u32.

**When to use:** The single `packKeyCode(e)` + `packModifiers(e)` pair. Tags are frozen by `key.rs::unpack_keycode`; drift breaks the boundary contract.

**Example:**

```javascript
// www/input/keyboard.js
// Tag values mirror crates/bestialitty-core/src/key.rs unpack_keycode.
// Any drift fails the Playwright smoke spec that round-trips every tag
// through encode_key_raw.
const KEY_TAG = Object.freeze({
    Char:         0,
    ArrowUp:      1,
    ArrowDown:    2,
    ArrowLeft:    3,
    ArrowRight:   4,
    Enter:        5,
    Tab:          6,
    Backspace:    7,
    Escape:       8,
    KeypadDigit:  9,
    KeypadEnter: 10,
    KeypadComma: 11,
    KeypadMinus: 12,
    KeypadDot:   13,
});

const MOD_BIT = Object.freeze({
    Ctrl:  0b0001,
    Shift: 0b0010,
    Alt:   0b0100,
    Meta:  0b1000,
});

// e.code → (tag, source-key-for-CRLF-gate) pair. Returns null for unhandled.
function mapCodeToTag(eCode) {
    switch (eCode) {
        case 'ArrowUp':         return KEY_TAG.ArrowUp;
        case 'ArrowDown':       return KEY_TAG.ArrowDown;
        case 'ArrowLeft':       return KEY_TAG.ArrowLeft;
        case 'ArrowRight':      return KEY_TAG.ArrowRight;
        case 'Enter':           return KEY_TAG.Enter;
        case 'Tab':             return KEY_TAG.Tab;
        case 'Backspace':       return KEY_TAG.Backspace;
        case 'Escape':          return KEY_TAG.Escape;
        case 'NumpadEnter':     return KEY_TAG.KeypadEnter;
        case 'NumpadDecimal':   return KEY_TAG.KeypadDot;
        case 'NumpadSubtract':  return KEY_TAG.KeypadMinus;
        case 'NumpadComma':     return KEY_TAG.KeypadComma;
        // Numpad0..9 handled inline (need payload). See packControlKey.
        // NumpadAdd, NumpadMultiply, NumpadDivide: fall through to Char
        // path (via e.key === '+' / '*' / '/'). Rationale: key.rs has no
        // KeypadAdd tag; the Char path emits the correct byte with no
        // re-enumeration.
        default: return null;
    }
}

function packModifiers(e) {
    let bits = 0;
    if (e.ctrlKey)  bits |= MOD_BIT.Ctrl;
    if (e.shiftKey) bits |= MOD_BIT.Shift;
    if (e.altKey)   bits |= MOD_BIT.Alt;
    if (e.metaKey)  bits |= MOD_BIT.Meta;
    return bits;
}

// Returns a u32 `code` with payload in bits 8-15 for Char / KeypadDigit.
function packControlKey(tag, e) {
    if (tag === KEY_TAG.KeypadDigit) {
        const digit = e.code.charCodeAt('Numpad'.length) - 0x30;  // '0'
        return tag | (digit << 8);
    }
    return tag;
}
```

### Pattern 3: Local-echo fork after encode

**What:** Local-echo is a post-encode fork: the bytes from `encode_key_raw` are always pushed to the TX sink; IF the echo flag is true, they are ALSO fed to `term.feed(bytes)` reusing the Phase 3 bell/host-reply/frame pattern.

**When to use:** One place in `keyboard.js` — the `forwardBytes` helper. The flag is a module-local boolean flipped by `setLocalEcho(bool)`.

**Example:**

```javascript
// www/input/keyboard.js — local-echo fork
// Reuses Phase 3's sampleBell + drainHostReply + requestFrame pattern
// from www/main.js:126-168.
let localEcho = false;            // default OFF per D-08

export function setLocalEcho(value) { localEcho = !!value; }

function forwardBytes(bytes, sourceKeyTag) {
    // (1) CR/LF override (D-11): only applies when Enter/NumpadEnter produced
    //     exactly [0x0D] — the Rust encoder's zero-config output.
    if ((sourceKeyTag === KEY_TAG.Enter || sourceKeyTag === KEY_TAG.KeypadEnter)
        && bytes.length === 1 && bytes[0] === 0x0D) {
        bytes = applyCrlfOverride(bytes);     // returns [0x0D], [0x0A], or [0x0D, 0x0A]
    }

    // (2) Always push to TX sink (Phase 5 will swap to Web Serial writer).
    pushTxBytes(bytes);

    // (3) Local-echo: also feed the parser.
    if (localEcho) {
        term.feed(bytes);
        sampleBell();                          // Phase 3 pattern; BEL-while-hidden
        drainHostReply('echo');                // in case parser replied (ESC Z)
        requestFrame();                        // wake renderer
    }
}
```

### Pattern 4: CR/LF override as TX-side byte-rewrite

**What:** Override is applied AFTER `encode_key_raw` returns, and only when the source key was Enter or NumpadEnter. Keeps the Rust encoder frozen (D-10).

**When to use:** One function in `keyboard.js`. Never applied to Ctrl-M (which also emits 0x0D but is a distinct intent — see Pitfall below).

**Example:**

```javascript
// www/input/keyboard.js — CR/LF TX-side rewrite
let crlfMode = 'cr';              // 'cr' | 'lf' | 'crlf'; default CR per D-12

export function setCrlfMode(mode) {
    if (mode !== 'cr' && mode !== 'lf' && mode !== 'crlf') return;
    crlfMode = mode;
}

const CRLF_BYTES = Object.freeze({
    cr:   new Uint8Array([0x0D]),
    lf:   new Uint8Array([0x0A]),
    crlf: new Uint8Array([0x0D, 0x0A]),
});

function applyCrlfOverride(bytes) {
    // Precondition (checked by caller): bytes == [0x0D] AND sourceKey was Enter.
    return CRLF_BYTES[crlfMode];
}
```

### Pattern 5: IME composition lifecycle

**What:** Set a module-scoped `isComposing` flag; `keydown` returns early while set. `compositionend` iterates `event.data` bytes and emits each through `encode_key_raw`.

**When to use:** Three listeners on `#terminal-wrapper`, set up inside `wireKeyboard`.

**Example:**

```javascript
// www/input/keyboard.js — IME lifecycle
let imeActive = false;

terminalWrapper.addEventListener('compositionstart', () => {
    imeActive = true;
});

terminalWrapper.addEventListener('compositionupdate', () => {
    // no-op: we emit on end only, not mid-composition
});

terminalWrapper.addEventListener('compositionend', (e) => {
    imeActive = false;
    const str = e.data || '';
    // ASCII-only guard (D-06 Claude discretion: VT52 is ASCII).
    // If future workloads need UTF-8, switch to `new TextEncoder().encode(str)`.
    for (let i = 0; i < str.length; i++) {
        const byte = str.charCodeAt(i);
        if (byte > 0xFF) continue;           // silent drop non-ASCII
        const bytes = encode_key_raw(KEY_TAG.Char | (byte << 8), 0);
        forwardBytes(bytes, null);
    }
});

// Inside the keydown handler:
//   if (imeActive || e.isComposing) return;   // dual guard
```

**Lifecycle evidence (from MDN + W3C UI Events + search results):**

- [CITED: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing] `isComposing` is true between `compositionstart` and `compositionend`, inclusive. Chromium follows the W3C spec ordering.
- [CITED: https://www.w3.org/TR/uievents/] Chrome and Safari dispatch events per spec; Firefox and Edge (pre-Chromium) historically differed. Bestialitty is Chromium-only, so spec ordering applies.
- **The double-emit trap** specifically happens on Safari where `keydown` for Enter that ends composition fires AFTER `compositionend` has already set `isComposing=false`. Since Phase 4 is Chromium-only, this bug does not apply — but the `imeActive` module flag is belt-and-braces protection regardless.

### Anti-Patterns to Avoid

- **Putting `preventDefault()` after `await` or inside a `.then()`.** Chromium silently ignores it. [CITED: MDN Event.preventDefault() — must be called synchronously]
- **Using `e.key` for control keys.** `e.key` of ArrowUp is the string `"ArrowUp"` (5 characters); the KeyCode test `e.key.length === 1` correctly rejects it, but explicit `e.code === 'ArrowUp'` is clearer and layout-independent. [CITED: MDN KeyboardEvent.code]
- **Using `e.keyCode` or `e.which`.** Deprecated since 2018; may return 0 for dead keys. [CITED: MDN KeyboardEvent.keyCode — deprecated]
- **Attaching keydown to `window` or `document`.** Keys typed into the Debug pane textarea would fire on `document`, and Phase 3 gap-closure explicitly locked the focus contract to `#terminal-wrapper`. D-01 is the anti-pattern-aware choice.
- **Using `keypress` event.** Deprecated, doesn't fire for non-printables (arrows, Enter, Tab).
- **Sending the CR/LF override through Ctrl-M.** Ctrl-M is the Rust encoder's `(Char('M'), ctrl=true)` path which produces `[0x0D]` via the Ctrl-letter arm, not via the Enter arm. Applying the override to Ctrl-M would break `stty erase ^H` and similar CP/M shell idioms. D-11 gate `sourceKey ∈ {Enter, NumpadEnter}` is the anti-pattern-aware choice.
- **Re-building `Uint8Array` views in the hot keydown path.** Use the already-cached views from `www/main.js` (the `hostReplyView` pattern from Phase 2 Plan 06). Local-echo `term.feed` → `drainHostReply` → re-derive only on buffer identity change.
- **Using `TextDecoder` anywhere in Phase 4.** Pitfall 10. All strings stay as byte arrays from DOM → wasm.
- **Programmatic `.focus()` in click handlers to "refix" focus.** D-16 explicitly rejected this; causes a visible flicker. `mousedown` preventDefault is invisible.
- **Adding `keyup` listeners.** D-discretion: none of INPUT-01..05 needs keyup. Adding one increases surface area (torn chord edge case — Ctrl held, Tab-switch, Ctrl-up on different element) with zero user value.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PC keyboard → VT52 byte encoding | Parallel JS-side encoder | `encode_key_raw(code, mods)` from wasm | Rust encoder has 37 unit tests (Phase 1 Plan 06); duplicating risks drift. Boundary pinned by `boundary_api_shape.rs`. |
| Cross-browser keyboard quirk handling | Normalization layer | `e.code` + `e.key` directly | Chromium-only project; `e.code` / `e.key` are stable and WHATWG-standardized |
| IME state machine | Custom composition tracker | `compositionstart`/`end` + `isComposing` | Browser already implements the state machine correctly for Chromium |
| Focus management after toolbar click | Programmatic `.focus()` in click handler | `mousedown` preventDefault | Native pattern; zero flicker; MDN-documented |
| Key-sequence buffer for multi-byte sends | Debouncer, queue, coalescer | Synchronous `pushTxBytes` per keydown | Typing is a cold path (≤10 Hz); ring buffer is all that's needed |
| Hex formatting for debug view | Elaborate hex-dump library | `byte.toString(16).padStart(2, '0').toUpperCase()` + `.join(' ')` | One-line idiom; 64-byte strings are trivially cheap to rebuild per push |
| TX buffer ring with wrap logic | A linked-list buffer, a RxJS stream | `Uint8Array(1024)` + write index + wrap flag | Fixed-size, O(1) write, O(1) read-last-N; stdlib suffices |
| Browser-reserved-key polyfill | `keyboardLock` fallback with userscript | Documentation note in Settings pane | `keyboardLock` requires fullscreen; Phase 4 does not ship fullscreen mode. SC-2 explicitly asks for a user-visible note, not interception. |
| Playwright → synthetic KeyboardEvent | Custom `page.evaluate` + `dispatchEvent` | `page.keyboard.press('Control+KeyA')` / `page.keyboard.type('abc')` | Playwright's built-in keyboard drives the full event path including `keydown`/`keypress`/`keyup` + updates `e.isComposing` state |

**Key insight:** Phase 4 is the phase where the temptation to hand-roll is strongest (keyboards feel "simple") but reality is that every wheel worth re-inventing has already been rolled. The Rust encoder is the most-tested module in the repo; the DOM APIs are stable; Playwright can drive every path. Phase 4 is glue, not logic.

## Common Pitfalls

### Pitfall 1: `preventDefault()` called asynchronously is silently ignored

**What goes wrong:** Author writes `terminalWrapper.addEventListener('keydown', async (e) => { const bytes = await encode(e); e.preventDefault(); ... })`. Chromium has already dispatched the default action (page scroll on arrow, address-bar focus on Ctrl+L) by the time the `await` resolves.

**Why it happens:** `preventDefault()` only works during the synchronous dispatch of the event. An `await` yields the event loop; the event finalizes; default action proceeds. This is a browser-API contract, not a bug.

**How to avoid:** Call `e.preventDefault()` as the first statement inside each branch that claims the key. Do all work after. Phase 3 `chrome.js` already follows this religiously (lines 87, 94, 98, 104). Phase 4 MUST keep the same posture.

**Warning signs:**
- Arrow keys scroll the page during typing.
- Ctrl+F opens the browser find bar despite Ctrl+F being in the Ctrl-letter range.
- Keys "work sometimes" — usually works for single keys, fails under modifier chords.

---

### Pitfall 2: `e.code` vs `e.key` confusion

**What goes wrong:** Handler uses `e.key === 'ArrowUp'` (works) but also `e.key === '1'` for digit capture — which breaks as soon as the user hits Shift+1, because `e.key` becomes `'!'`. Or uses `e.code === 'Digit1'` for printables, which sends `'1'` even when Shift is held.

**Why it happens:** `e.code` is the physical key (layout-independent, always returns the same string for a given key); `e.key` is the character produced (layout-aware, modifier-aware).

**How to avoid:** D-03 pins the split:
- **Control keys** (arrows, Enter, Tab, Backspace, Escape, Numpad*): match on `e.code`.
- **Printable characters**: use `e.key`, check `e.key.length === 1`, take `e.key.charCodeAt(0)`.

`e.key.length === 1` works because `e.key` for control keys is a multi-character string (`"ArrowUp"`, `"Enter"`, `"Backspace"`). Printable `e.key` is always one UTF-16 code unit for the ASCII range.

**Warning signs:**
- `!` sent as `1` (shift-1 broken) OR `1` sent as `!` (digits broken).
- German / French keyboard layouts send wrong bytes for backtick, brackets, etc.
- Numpad behaves differently than top-row digits without reason.

---

### Pitfall 3: Local-echo feeds TX bytes into the renderer literally

**What goes wrong:** User enables local echo expecting "see what I type". Presses ArrowUp. Expects `^[A` to print as two glyphs. Instead, the cursor moves up one row and nothing prints.

**Why it happens:** Local echo is byte-level, not glyph-level. `encode_key_raw(ArrowUp)` returns `[0x1B, 0x41]`. Feeding those into `term.feed` puts the parser into Escape state, then sees 'A', then executes "cursor up". This is correct VT52 LOCAL-switch behavior — a physical VT52 with its LOCAL switch on would do exactly the same thing — but users who haven't used a physical terminal find it surprising.

**How to avoid:** The Settings-pane hint line (D-14 copy, locked in UI-SPEC) explicitly says "enable for bootloaders or self-test modes that don't echo". The hint implies "byte-level loopback", not "glyph echo". If user reports confusion, point them at the hint; don't change the behavior.

**Warning signs:**
- User reports "local echo does nothing when I press arrow keys".
- User reports "Ctrl+L clears the screen even before connecting to MicroBeast" (this is correct: Ctrl+L → `0x0C` (FF) → VT52 parser on ANSI terminals would clear screen; our VT52 parser treats FF as non-ESC so it falls through — but Ctrl+J → `0x0A` LF with echo-on scrolls the screen, which is correct and surprising).

---

### Pitfall 4: IME double-emit on Chromium

**What goes wrong:** User with Japanese IME types "にほんご", presses Enter to commit. TX sink contains the bytes twice OR contains bytes for Enter AND the composed string.

**Why it happens:** During composition, `keydown` still fires for the raw keys (KeyA, KeyI, Space, etc.) AND `compositionend` fires with the composed string. If `keydown` doesn't guard on `isComposing`, the raw keys get emitted during composition. Conversely, if `compositionend` emits but `keydown` ALSO emits the Enter that committed the composition, the Enter byte `0x0D` gets appended to the composed string.

**How to avoid:** D-06 dual guard:
- `keydown` returns early if `e.isComposing` is true.
- `compositionend` emits once from `event.data`, clears the module `imeActive` flag.
- The final Enter that commits composition has `e.isComposing === true` in Chromium, so the `keydown` guard catches it.

[CITED: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing] — `isComposing` is true on the `keydown` event that triggers `compositionend` in spec-compliant browsers (Chrome + Safari per W3C UI Events; Firefox/Edge-legacy historically differed, not relevant here).

**Warning signs:**
- CJK text doubled in TX sink.
- `0x0D` Enter byte appears after IME commit when it shouldn't.
- Empty `compositionend.data` (IME cancel via Escape) → nothing emitted (correct).

---

### Pitfall 5: Torn chord (Ctrl held across focus change)

**What goes wrong:** User presses Ctrl+Shift+Tab to cycle tabs, holding Ctrl. Chromium switches tabs. Ctrl-up fires on the new tab's body element, not on `#terminal-wrapper`. Then user switches back, types a letter. Phase 4 listener fires with `e.ctrlKey === false` (correct) BUT the listener never saw the Ctrl-up transition.

**Why it happens:** Keydown/keyup firing is per-focus-target. If focus changes mid-chord, half the transitions are missing.

**How to avoid:** Phase 4 does not maintain chord state between events (no `keyup` listener, no sticky modifier tracking). Every keydown reads `e.ctrlKey`/`e.shiftKey`/etc. fresh. Torn chords are naturally safe because state is never retained. This is part of why D-18 discretion item "do not add keyup listener" is the right call.

**Warning signs:**
- None expected with the pattern above. If the planner decides to add a `keyup` listener later (e.g., for chord-release semantics), this pitfall becomes relevant.

---

### Pitfall 6: Browser-reserved Ctrl combos cannot be intercepted

**What goes wrong:** User presses Ctrl+W to delete-word-backward in a MicroBeast `vi`-alike. Chrome closes the tab. User loses their edit.

**Why it happens:** Chromium reserves Ctrl+W (close tab), Ctrl+N (new window), Ctrl+T (new tab), Ctrl+Shift+T (reopen closed tab), Ctrl+Shift+N (new incognito), Ctrl+Tab (next tab), Ctrl+Shift+Tab (prev tab), Ctrl+1..8 (tab N), Ctrl+9 (last tab), Ctrl+PgUp/PgDn (next/prev tab), Ctrl+F4 (close tab alt), plus Alt+F4, F11, etc. These are security-policy reserved — `preventDefault()` is silently ignored. [VERIFIED: Chromium issue #33056 "Ctrl keys: Ctrl-N, Ctrl-T and Ctrl-W no longer available to scripts" confirmed as WONTFIX; https://issues.chromium.org/issues/41081444]

**How to avoid:** Document the constraint in the Settings pane (D-14 copy locked). The `keyboardLock` API can intercept these only in fullscreen mode — Phase 4 does not ship fullscreen (that's a v2 idea). The user-visible note fulfils SC-2 explicitly.

**Warning signs:**
- User complains "Ctrl+W closes my tab". Correct response: point at the Settings note; suggest Ctrl+F4 or a MicroBeast-side keybinding remap.

**Verified Chromium reserved combos (as of 2026):**

| Chord | What Chromium does | Can page intercept? |
|-------|--------------------|---------------------|
| Ctrl+W | Close tab | **NO** (reserved) |
| Ctrl+Shift+W | Close window | **NO** |
| Ctrl+N | New window | **NO** |
| Ctrl+Shift+N | New incognito window | **NO** |
| Ctrl+T | New tab | **NO** |
| Ctrl+Shift+T | Reopen closed tab | **NO** (confirmed by Phase 3 Plan 06 gap #4) |
| Ctrl+Tab / Ctrl+Shift+Tab | Next/prev tab | **NO** |
| Ctrl+PgUp / Ctrl+PgDn | Next/prev tab | **NO** |
| Ctrl+1..8 | Go to tab N | **NO** |
| Ctrl+9 | Last tab | **NO** |
| F11 | Fullscreen toggle | **NO** |
| Alt+F4 | Close window (Windows) | **NO** (OS-level) |
| Cmd+W / Cmd+T / Cmd+N (macOS) | Same | **NO** (OS-level) |
| Ctrl+L | Focus address bar | YES (Chromium allows `preventDefault`) — but this means user can't recover; Phase 4 forwards Ctrl+L as `0x0C` FF |
| Ctrl+F | Find in page | YES (preventable) — forwarded as `0x06` ACK |
| Ctrl+S | Save page | YES (preventable) — forwarded as `0x13` DC3 (XOFF) |
| Ctrl+R | Reload | YES (preventable) — forwarded as `0x12` DC2 |
| Ctrl+P | Print | YES (preventable) — forwarded as `0x10` DLE |
| Ctrl+D | Bookmark | YES (preventable) — forwarded as `0x04` EOT |
| Ctrl+U | View source | YES (preventable) — forwarded as `0x15` NAK |
| Ctrl+H | History | YES (preventable) — forwarded as `0x08` BS |
| Ctrl+J | Downloads | YES (preventable) — forwarded as `0x0A` LF |
| Ctrl+O | Open file | YES (preventable) — forwarded as `0x0F` SI |
| Ctrl+A | Select all | YES (preventable) — forwarded as `0x01` SOH |
| Ctrl+C / Ctrl+V / Ctrl+X | Copy/paste/cut | YES (preventable) — but Phase 6 SESS-02/03 wants to preserve these for clipboard integration; for Phase 4 they are forwarded as `0x03`/`0x16`/`0x18` control bytes matching CP/M/Unix expectations |
| Ctrl+Z | Undo | YES (preventable) — forwarded as `0x1A` SUB (EOF on CP/M) |
| Ctrl+[ | (no default) | YES — forwarded as `0x1B` ESC |
| Ctrl+\ | (no default) | YES — forwarded as `0x1C` FS |
| Ctrl+] | (no default) | YES — forwarded as `0x1D` GS |
| Ctrl+Alt+T | (Phase 3 theme toggle) | Claimed by chrome.js |
| Ctrl+Equal / Ctrl+Minus / Ctrl+Digit0 | (Phase 3 zoom) | Claimed by chrome.js |

[VERIFIED: chrome.js:86-108 already preventDefaults Ctrl+Alt+T + zoom triad; Phase 4 keydown listener runs AFTER and short-circuits on e.defaultPrevented — so zero double-handling]

---

### Pitfall 7: `NumLock` off on numeric keypad

**What goes wrong:** User presses numpad 4 with NumLock off. Expects the byte '4'. Chromium reports `e.code === 'Numpad4'` but `e.key === 'ArrowLeft'` (because NumLock-off remaps the keypad to navigation). Phase 4 picks up the KeypadDigit tag via `e.code`, encoder emits `'4'` — but user expected arrow-left.

**Why it happens:** NumLock is OS-level state. Chromium reports both the physical key (`e.code === 'Numpad4'`) and the layout-interpreted key (`e.key === 'ArrowLeft'`).

**How to avoid:** D-05 uses `e.code` for numpad digits — this matches physical-key intent. Users with NumLock off get `'4'` from the numpad, which is arguably correct for a terminal emulator. If a user reports that numpad-arrows don't work with NumLock off, the fix is a one-line exception: check `e.key.startsWith('Arrow')` before the `Numpad0..9` branch and route to the arrow tag instead. **This is a discretion question for the planner** — Phase 1 encoder behaviour is "numpad digit always emits the digit byte", which matches every physical VT52 and every modern terminal emulator's default.

**Warning signs:**
- User with NumLock off reports "numpad doesn't move cursor".
- The fix is either: flip NumLock on (user-side), or add the `e.key.startsWith('Arrow')` exception (code-side).

---

### Pitfall 8: AltGraph on non-US layouts

**What goes wrong:** German user types AltGr+Q to get `@`. Phase 4 sees `e.altKey === true` AND `e.ctrlKey === true` (AltGr is reported as both by Chromium) AND `e.key === '@'`. If Phase 4 treats Ctrl as "control chord", it encodes `Ctrl+@` → `0x00` NUL instead of `@`.

**Why it happens:** On Windows/Linux, the AltGraph modifier is emulated as `Ctrl+Alt`. Chromium reports `e.ctrlKey === true` + `e.altKey === true` + `e.getModifierState('AltGraph') === true` when the user actually pressed AltGr.

**How to avoid:** In the Ctrl-letter branch, explicitly check `!e.getModifierState('AltGraph')` before encoding as a control byte. If AltGraph is held, route to the printable path (use `e.key`). [CITED: MDN KeyboardEvent.getModifierState]

```javascript
// Inside the Ctrl+letter / Ctrl+symbol branch:
if (e.getModifierState && e.getModifierState('AltGraph')) {
    // AltGr combo — treat as printable, not as Ctrl chord
    if (e.key.length === 1) {
        e.preventDefault();
        const bytes = encode_key_raw(KEY_TAG.Char | (e.key.charCodeAt(0) << 8), 0);
        forwardBytes(bytes, null);
    }
    return;
}
```

**Warning signs:**
- German / French / Polish users report that typing `@`, `€`, `{`, `[` sends control bytes.
- Default (US-layout) user never hits this.
- **Scope note:** CONTEXT.md does not explicitly require AltGraph correctness. This is a Claude's-discretion refinement for the planner — the MicroBeast author is US-layout (per codebase comments) so this pitfall may be deferred if it costs planning budget. Recommend spending the 4 lines of code regardless; failure mode is silent wrong-byte, hard to debug.

---

### Pitfall 9: Memory growth from `new Uint8Array` per keystroke

**What goes wrong:** Every `encode_key_raw` call allocates a `Vec<u8>` on the wasm side and wasm-bindgen copies it to a fresh JS `Uint8Array`. Push to ring buffer copies AGAIN. Hex-strip formatter allocates a string. Typing fast allocates.

**Why it happens:** Low-volume enough that GC is unlikely to stall — typing is ≤10 Hz with single-to-few-byte emissions, so <1 KB/s allocation rate. But in aggregate over hours it's measurable.

**How to avoid:** The hot path for Phase 4 is not actually hot. Phase 2 already accepted per-frame allocation for `host_reply` + `bell_pending` and it was fine at 60 Hz. At 10 Hz keystroke rate, this is a non-issue. **Do not optimize.** If Phase 6 soak test surfaces a growth curve, revisit.

**Warning signs:**
- DevTools Memory tab shows monotonic growth during long typing session. (Unlikely at <1 KB/s; GC reclaims steady-state.)

---

### Pitfall 10: CR/LF override applied to Ctrl-M

**What goes wrong:** User types Ctrl+M expecting to send 0x0D (start-of-heading in some protocols, or just "I want a CR byte"). CR/LF override is set to CRLF. Phase 4 sends 0x0D 0x0A. Protocol breaks.

**Why it happens:** Ctrl+M and Enter both produce `[0x0D]` from the Rust encoder. If the override triggers on "bytes == [0x0D]", it triggers on both. User expected the override to apply only to the Enter key.

**How to avoid:** D-11 gates the override on `sourceKey ∈ {Enter, NumpadEnter}` — NOT on byte equality. The `sourceKey` is passed into `forwardBytes` from the decision-tree branch that produced it. Ctrl-letter branch passes `null`, so the override is skipped. Implementation in Pattern 4 above.

**Warning signs:**
- User reports "Ctrl+M sends two bytes when I expect one". Correct response: it shouldn't, file as bug; check that the branch tag is plumbed through `forwardBytes` correctly.

## Runtime State Inventory

Not applicable — Phase 4 is a **greenfield feature phase**, not a rename/refactor/migration. No pre-existing runtime state needs auditing.

**Nothing found in each category** — verified by inspection:

- **Stored data:** None — Phase 4 is in-memory only (D-09 defers persistence to Phase 6 PREF-02).
- **Live service config:** None — no external services involved.
- **OS-registered state:** None — no OS-level integrations.
- **Secrets/env vars:** None — no authentication, no credentials.
- **Build artifacts:** None — no new Cargo crate, no new npm package. The wasm build from Phase 2 is unchanged (`boundary_api_shape.rs` pins prevent drift).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Chromium (for runtime) | Phase 4 app | ✓ (assumed — Chromium-only per CLAUDE.md) | 89+ for top-level-await, 94+ for Web Serial (Phase 5 concern) | — |
| `wasm-pack` (for builds) | wasm module | ✓ (confirmed Phase 1/2) | 0.12.1 pinned | — |
| Rust 1.85+ / stable | wasm module | ✓ (confirmed Phase 1) | Edition 2024 | — |
| `python3` (dev server) | Playwright tests | ✓ (Phase 3 uses `python3 -m http.server -d . 8000`) | 3.x | `basic-http-server` documented alternative |
| `@playwright/test` | Playwright tests | ✓ (installed Phase 3) | ^1.51.0 | — |
| `node` (Playwright runner) | Playwright tests | ✓ (confirmed — www/node_modules exists) | Any LTS supported by Playwright 1.51 | — |
| Phase 1 Rust encoder | `encode_key_raw` calls | ✓ (shipped) | n/a — workspace crate | — |
| Phase 2 wasm boundary | `encode_key_raw` export | ✓ (shipped + pinned by `boundary_api_shape.rs`) | n/a | — |
| Phase 3 renderer + chrome | `term.feed`, `sampleBell`, chrome.js listener | ✓ (shipped) | n/a | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright 1.51 (Chromium-only per CLAUDE.md) |
| Config file | `www/playwright.config.js` (extend testMatch to include `input/` dir) |
| Quick run command | `cd www && npm run test:fast` (runs `@fast`-tagged specs) |
| Full suite command | `cd www && npm test` (runs all specs in both `render/` and `input/` dirs) |
| Update snapshots | `cd www && npm run test:update` (for any visual-regression additions; none needed for Phase 4) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INPUT-01 | PC keyboard maps to VT52 codes (arrows, keypad, control, printable) | integration (Playwright) | `cd www && npx playwright test tests/input/keydown-printable.spec.js --project=chromium` | ❌ Wave 0 |
| INPUT-02 | Arrow keys transmit ESC A/B/C/D (verifiable in TX-byte debug view) | integration | `cd www && npx playwright test tests/input/keydown-arrows.spec.js --project=chromium` | ❌ Wave 0 |
| INPUT-03 | Ctrl-letter → 0x00-0x1F; browser-reserved Ctrl-W/N/T documented | integration | `cd www && npx playwright test tests/input/keydown-ctrl-letters.spec.js --project=chromium` | ❌ Wave 0 |
| INPUT-04 | Local echo toggle default off; flipping shows typed chars | integration | `cd www && npx playwright test tests/input/local-echo.spec.js --project=chromium` | ❌ Wave 0 |
| INPUT-05 | CR/LF override alters Enter byte sequence | integration | `cd www && npx playwright test tests/input/crlf-override.spec.js --project=chromium` | ❌ Wave 0 |
| SC-1 | TX hex strip shows `1B 41` after ArrowUp | integration | Covered by `keydown-arrows.spec.js` + `tx-debug-strip.spec.js` | ❌ Wave 0 |
| SC-2 | preventDefault captures every forwarded key; Ctrl-W/N/T note visible | integration | Covered by `keydown-ctrl-letters.spec.js` (preventDefault assertion) + DOM assertion on Settings pane note | ❌ Wave 0 |
| SC-3 | Local-echo flip shows typed chars on canvas before serial | integration | Covered by `local-echo.spec.js` (visible glyph assertion via canvas snapshot OR via `term.grid_byte_len` wasm-side read-back) | ❌ Wave 0 |
| SC-4 | CR/LF override bytes visible in TX strip (CR=1 byte; LF=1 byte; CRLF=2 bytes) | integration | Covered by `crlf-override.spec.js` | ❌ Wave 0 |
| SC-5 | Canvas holds focus after toolbar click; IME doesn't double-emit | integration | `focus-retention.spec.js` + `ime-composition.spec.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd www && npm run test:fast` — runs `@fast`-tagged specs only (Phase 4 should add `@fast` tags to the smoke-level specs: one arrow-key test, one Ctrl-letter test, one local-echo toggle test, one focus-retention test, one CR/LF toggle test). Target <15 s total.
- **Per wave merge:** `cd www && npm test` — full suite including Phase 3 regression specs.
- **Phase gate:** Full suite green (both render/ and input/) before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `www/tests/input/` directory — does not exist; create in Wave 0 plan (extend `www/playwright.config.js` testDir via `testMatch: ['**/render/*.spec.js', '**/input/*.spec.js']` OR add a second `testDir` array entry)
- [ ] `www/tests/input/keydown-arrows.spec.js` — INPUT-02 + SC-1
- [ ] `www/tests/input/keydown-ctrl-letters.spec.js` — INPUT-03 + SC-2 (preventDefault assertion)
- [ ] `www/tests/input/keydown-printable.spec.js` — INPUT-01 (printable pass-through, shifted-1, numpad)
- [ ] `www/tests/input/local-echo.spec.js` — INPUT-04 + SC-3
- [ ] `www/tests/input/crlf-override.spec.js` — INPUT-05 + SC-4
- [ ] `www/tests/input/ime-composition.spec.js` — SC-5 IME half (see Open Question 1 — Playwright IME simulation)
- [ ] `www/tests/input/focus-retention.spec.js` — SC-5 focus half (mousedown-preventDefault proof)
- [ ] `www/tests/input/tx-debug-strip.spec.js` — SC-1 hex-strip format + Reset TX button
- [ ] (No framework install needed — Phase 3 already installed Playwright)

### Playwright testing patterns for Phase 4

**Pattern: Dispatch a keydown to the tabindex=0 wrapper and verify TX bytes**

```javascript
// www/tests/input/keydown-arrows.spec.js
import { test, expect } from '@playwright/test';

test.describe('INPUT-02 — Arrow keys transmit ESC A/B/C/D', () => {
    test('ArrowUp produces 1B 41 in TX strip @fast', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);

        // Open the Debug pane so the TX strip is visible-to-assertion.
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        // Synthetic keydown via Playwright — drives the full DOM path
        // including e.code = 'ArrowUp', fires keydown/keyup, updates isComposing.
        await page.keyboard.press('ArrowUp');

        // TX strip text is synchronous-after-push (D-15 observer callback),
        // so no wait loop is needed; waitFor still adds resilience against
        // microtask scheduling.
        await expect(page.locator('#tx-strip')).toHaveText('1B 41', { timeout: 500 });
    });

    test('ArrowDown/Left/Right produce 1B 42/44/43', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.locator('#debug').evaluate((el) => { el.open = true; });

        await page.locator('#tx-reset').click();     // clears strip
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#tx-strip')).toHaveText('1B 42');

        await page.locator('#tx-reset').click();
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#tx-strip')).toHaveText('1B 44');

        await page.locator('#tx-reset').click();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tx-strip')).toHaveText('1B 43');
    });
});
```

**Pattern: Verify preventDefault fired**

```javascript
// Check that Ctrl+F did NOT open the browser find bar.
// Approach: dispatch with a listener attached in-page that records defaultPrevented.
await page.evaluate(() => {
    window.__dpRecord = [];
    const rec = (e) => { window.__dpRecord.push({ code: e.code, dp: e.defaultPrevented }); };
    document.addEventListener('keydown', rec, true);   // CAPTURE phase to see both handlers' output
});
await page.locator('#terminal-wrapper').focus();
await page.keyboard.press('Control+KeyF');
const rec = await page.evaluate(() => window.__dpRecord);
// The keydown event should have defaultPrevented=true after Phase 4's listener ran.
// Note: capture-phase listener runs BEFORE bubble-phase listeners, so dp will be
// false there. Use bubble phase OR assert downstream effect (no find bar opens).
// Easier: assert that the TX strip got the expected byte.
await expect(page.locator('#tx-strip')).toHaveText('06');   // 0x06 = ACK = Ctrl+F
```

**Alternative (recommended) for SC-2 preventDefault assertion:**

Don't test `defaultPrevented` directly (flaky because it depends on listener-phase ordering). Instead, test the **downstream effect**: the TX strip shows the expected byte. If `preventDefault` had failed, the browser would have acted (e.g., Ctrl+L would have focused the address bar, moving focus OFF `#terminal-wrapper`). Assert `document.activeElement === #terminal-wrapper` after the keydown.

```javascript
test('Ctrl+L forwards 0x0C and keeps terminal focused (preventDefault works)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.locator('#debug').evaluate((el) => { el.open = true; });

    await page.locator('#tx-reset').click();
    await page.keyboard.press('Control+KeyL');

    await expect(page.locator('#tx-strip')).toHaveText('0C');
    await expect(page.locator('#terminal-wrapper')).toBeFocused();
});
```

**Pattern: Local-echo flip (INPUT-04 / SC-3)**

```javascript
test('Local echo flip: typing "A" feeds into parser when enabled', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();

    // Default OFF: typing "A" should not print on canvas.
    const before = await page.evaluate(() => {
        // Read the visible grid's A-at-home cell via the wasm boundary.
        // (Ports into JS-side read of gridView; see Phase 2 D-01 pack-buffer
        // pattern. Test reads term.snapshot_grid + gridView[0].)
        const view = window.__testGridView;     // harness helper exposed for tests
        return view ? view[0] : 0;
    });
    await page.keyboard.press('KeyA');
    const midOff = await page.evaluate(() => window.__testGridView[0]);
    expect(midOff).toBe(before);                // unchanged — echo was off

    // Flip the toggle.
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#local-echo').check();

    // Type "A" again — should feed into parser, appear at cursor.
    await page.keyboard.press('KeyA');
    const afterOn = await page.evaluate(() => window.__testGridView[0]);
    expect(afterOn).toBe(0x41);                 // 'A' rendered
});
```

*(This test requires exposing `term.snapshot_grid` + a grid view to `window.__testGridView` during test — one-line harness helper in `main.js` gated by URL param or NODE_ENV-equivalent. Planner decides whether to add it or use a visual-regression screenshot instead.)*

**Pattern: Focus retention after mousedown (SC-5)**

```javascript
test('Clicking theme button keeps focus on terminal wrapper', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await expect(page.locator('#terminal-wrapper')).toBeFocused();

    // Click the theme button.
    await page.locator('#theme-toggle').click();

    // Terminal wrapper should STILL be focused — D-16 mousedown-preventDefault.
    await expect(page.locator('#terminal-wrapper')).toBeFocused();

    // And the theme toggle must have actually worked.
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
});
```

**Pattern: IME composition (SC-5) — Open Question: does Playwright drive CompositionEvents?**

Playwright's `page.keyboard` does NOT dispatch `compositionstart`/`compositionend` by default. For IME testing, the viable options are:

1. **`page.evaluate` + manual `dispatchEvent`**: dispatch synthetic `CompositionEvent`s directly. Works for unit-testing the listener behavior.
2. **`page.keyboard.insertText('にほんご')`**: on some Playwright versions this drives composition; verify at implementation time.
3. **Skip Playwright; rely on manual UAT**: document an IME acceptance test in `04-UAT.md` where the author verifies with a Japanese IME.

Recommended approach: use option (1) for automated regression, option (3) for the initial acceptance.

```javascript
// www/tests/input/ime-composition.spec.js
test('compositionend does not double-emit with keydown', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();

    // Simulate an IME composition ending with "ABC".
    await page.locator('#terminal-wrapper').evaluate((el) => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'A', bubbles: true }));
        el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'AB', bubbles: true }));
        el.dispatchEvent(new CompositionEvent('compositionend', { data: 'ABC', bubbles: true }));
    });

    // TX strip should show exactly "41 42 43" — one byte per composed char.
    await expect(page.locator('#tx-strip')).toHaveText('41 42 43');
});
```

**Pattern: TX-strip hex format (SC-1)**

```javascript
test('TX strip formats bytes as space-separated uppercase hex pairs', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();

    // Empty state placeholder.
    await expect(page.locator('#tx-strip')).toContainText('none yet');

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#tx-strip')).toHaveText('1B 41 1B 42');

    // Upper-case hex — 'A'-'F' not 'a'-'f'.
    const text = await page.locator('#tx-strip').textContent();
    expect(text).not.toMatch(/[a-f]/);

    // Two digits per byte — '01' not '1'.
    expect(text).toMatch(/^([0-9A-F]{2} )*[0-9A-F]{2}$/);
});
```

## Security Domain

Per `.planning/config.json`: `security_enforcement` is not explicitly set; treating as enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 4 has no auth — it's a local-only terminal emulator with no user accounts |
| V3 Session Management | no | No sessions — state is module-local in-memory |
| V4 Access Control | no | No access control — no multi-user concept |
| V5 Input Validation | **yes** | Untrusted input: raw DOM KeyboardEvent.key/code strings from user keyboard. Validation via `e.key.length === 1` guard, `e.key.charCodeAt(0) <= 0xFF` guard. Byte output pre-validated by Phase 1 Rust encoder (pinned 37 tests) |
| V6 Cryptography | no | No crypto — bytes are shipped verbatim to TX sink |
| V7 Error Handling & Logging | partial | `console.log` in main.js is unchanged. Phase 4 adds no new logging paths. `encode_key_raw` returns empty `Vec` on unknown tags (FFI-safe) |
| V8 Data Protection | no | No persisted data in Phase 4 (PREF-02 is Phase 6) |
| V9 Communication Security | no | No network — Phase 5 is Web Serial (not HTTP) |
| V13 Web Services | no | Static site, no backend |
| V14 Configuration | **yes** | CLAUDE.md constraints (Chromium-only, Rust pure logic + JS shell split, NO bundler) |

### Known Threat Patterns for Browser DOM + WASM Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via escape-sequence interpolation | Tampering | Not applicable — MicroBeast output (Phase 5) is rendered via wasm parser → canvas, never interpreted as HTML. Phase 4 output is DOM text (the Settings note) which is static HTML authored by this project, not user-controlled |
| Key-event injection via untrusted iframes | Tampering | Not applicable — static site; no embedded iframes. Phase 6 Permissions-Policy will restrict subframe access |
| Clipboard exfiltration via IME composition hijack | Information Disclosure | Phase 4 does not read or write the clipboard (Phase 6 SESS-02/03). `compositionend.data` is read-only from the IME, not from clipboard |
| Keyboard-lock abuse | Denial of Service | Phase 4 does not use `keyboardLock` API. Reserved Ctrl combos stay browser-controlled (Ctrl+W closes tab) — this is the secure-by-default posture |
| Modifier-key state confusion (AltGraph) | Tampering | Pitfall 8 mitigation: explicit `e.getModifierState('AltGraph')` guard in Ctrl-letter branch. Recommended inclusion even though non-US layout isn't in author's primary use case |
| Silent drop of unknown KeyCode tags across FFI | Availability | `encode_key_raw` returns `Vec::new()` on `None` from `unpack_keycode` (Phase 2 Plan 03 T-02-03-01) — FFI-safe, no panic crosses wasm boundary |
| Timing side-channel on key encoding | Information Disclosure | Not applicable — `encode_key_raw` is constant-time for the same input; no secret material is processed |

**Project Constraints (from CLAUDE.md) — load-bearing for Phase 4:**

| Directive | Phase 4 Compliance |
|-----------|--------------------|
| Rust → wasm core owns parser, terminal state, key encoding. Pure logic. Zero `web-sys` / `js-sys::Serial*` / DOM / I/O dependencies. | ✓ Phase 1 D-13 locks Phase 4 to JS-only; no `crates/bestialitty-core/` edits. The `encode_key_raw` export is already shipped and tested. |
| JavaScript shell owns Web Serial I/O, canvas rendering, event loop, browser state. No business logic. | ✓ Phase 4 adds `www/input/keyboard.js` (DOM events) + `www/input/tx-sink.js` (browser state). Zero Rust changes. The "business logic" of byte encoding is already in Rust; the JS shell just wires events. |
| Rust↔JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`). | ✓ Unchanged — `encode_key_raw` is already a `#[wasm_bindgen]` export. |
| Web Serial is driven from JS, not Rust. No Rust Web Serial bindings. | ✓ Not applicable to Phase 4 — Web Serial is Phase 5. TX sink is a local ring buffer with a forward-contract for Phase 5 to swap. |
| Chromium-only. Non-Chromium browsers get a polite-fail message. | ✓ Phase 4 uses Chromium-compatible DOM APIs only. Polite-fail is Phase 5 PLAT-02. |
| Static site deploy only. No server runtime. | ✓ Phase 4 adds only static JS/HTML/CSS. Playwright tests use Python's http.server (static file serving). |
| VT52 pragmatic subset — only what the MicroBeast actually emits. | ✓ Phase 4 does not add any VT52 sequences. Uses existing encoder output only. |
| NO bundler (vanilla ES modules) | ✓ Phase 4 adds ES modules under `www/input/`, imported via `<script type="module">` — no bundler. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Playwright 1.51's `page.keyboard.press('Control+KeyA')` drives both `keydown` event dispatch AND modifier state (`e.ctrlKey === true`) correctly for a tabindex=0 div focus target | §Validation Architecture testing patterns | LOW — if wrong, tests would fail with unexpected byte output; verifiable immediately in Wave 0 by running one test. [ASSUMED from Playwright docs; not verified against this specific repo]. Mitigation: Phase 3 `keyboard.spec.js` already proves `page.keyboard.press('Control+Alt+KeyT')` works for the theme chord, so this is near-verified. |
| A2 | Chromium's reserved-Ctrl list is stable across current versions (as of April 2026) | §Pitfall 6 | LOW — reserved list has been stable since 2010 (Chromium bug #33056). New reservations would be announced well before breaking. [CITED via web search: chromium.org bug tracker shows WONTFIX status] |
| A3 | `CompositionEvent` constructor works in Chromium Playwright contexts for synthetic IME testing | §Validation Architecture IME pattern | MEDIUM — if `dispatchEvent(new CompositionEvent(...))` doesn't drive the listener properly, fallback to manual UAT (per 04-UAT.md). Verifiable in Wave 0 smoke test. [ASSUMED — tested in MDN playgrounds but not this codebase] |
| A4 | `e.key.charCodeAt(0) <= 0xFF` adequately filters non-ASCII input for VT52 (ASCII-only protocol) | §Pattern 5 IME listener | LOW — VT52 is 7-bit protocol; rejecting non-ASCII in the IME path is the correct behavior. If a future capture surfaces a workload that needs UTF-8, the Claude-discretion D-06 item is the switch point (`TextEncoder` path). [CITED: VT52 DECscope manual — 7-bit protocol] |
| A5 | `mousedown` preventDefault does NOT fire on keyboard activation of buttons (Tab+Space, Tab+Enter) | §D-16 / UI-SPEC Interaction Contracts | LOW — platform-truth per MDN; verified by 2026 web search results. [CITED: MDN Event.preventDefault + multiple dev.to/stackoverflow confirmations] |

## Open Questions

1. **Does Playwright 1.51 simulate `CompositionEvent`s cleanly enough for SC-5 automated testing?**
   - What we know: `page.keyboard.press` does NOT drive composition events (they only fire for real IME input); `page.evaluate` + `new CompositionEvent` does dispatch the event but may not trigger Chromium's internal `isComposing` flag on subsequent `keydown` events.
   - What's unclear: whether the listener in `keyboard.js` can be reliably exercised without a real IME installed.
   - Recommendation: In Wave 0, write a 5-line smoke spec that dispatches a `CompositionEvent` and asserts the TX strip updates. If it works, proceed with automated IME testing. If it doesn't, document IME as manual UAT in `04-UAT.md` and have the author test once with a Japanese IME before phase sign-off.

2. **Should `NumLock`-off numpad arrows route to the Arrow tag instead of the KeypadDigit tag?**
   - What we know: D-05 uses `e.code === 'Numpad4'` → KeypadDigit(4). With NumLock off, user expectation may be ArrowLeft.
   - What's unclear: is the MicroBeast author's workflow NumLock-on or NumLock-off? (Author is on a laptop keyboard with no numpad per observable context, so likely neither.)
   - Recommendation: Planner adds a `NumLock`-state exception only if a real workload demands it. The safe default is "physical-key intent" (D-05 as written) which matches every modern terminal emulator.

3. **Should `AltGraph` handling (Pitfall 8) be in Phase 4 scope or deferred?**
   - What we know: US-layout users don't hit this. Non-US users (German, French, Polish, etc.) would silently send wrong bytes for `@`, `€`, `{`, etc.
   - What's unclear: whether any future user is non-US layout.
   - Recommendation: Spend 4 lines of code to handle it now. Failure mode is silent wrong-byte, hard to debug later. Recommend the planner include it in the printable-path decision tree.

4. **Should `keyboard.js` export a single `wireKeyboard(opts)` or multiple small exports?**
   - What we know: `chrome.js` uses `wireChrome(opts)` (one entry point); precedent exists in the codebase.
   - What's unclear: whether state-mutation helpers (`setLocalEcho`, `setCrlfMode`) should live inside `wireKeyboard`'s closure scope (returned object) or be module-level exports.
   - Recommendation: Module-level exports for the setters (cleaner for Settings-pane wiring to import and call directly); `wireKeyboard(opts)` attaches the event listeners. Matches the `setTheme`/`setPhosphor` pattern from `canvas.js`.

5. **Should the TX ring buffer be a fixed `Uint8Array(1024)` or grow dynamically?**
   - What we know: D-07 locks 1024.
   - What's unclear: nothing — 1024 bytes covers ~10 min of heavy typing; D-15 shows only the last 64; Phase 5 will replace with Web Serial writer path where a ring buffer is not needed.
   - Recommendation: Fixed 1024 as specced. No ambiguity.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `e.keyCode` / `e.which` | `e.code` / `e.key` | Deprecated ~2018; current MDN flags as legacy | D-03 already uses the current approach |
| `keypress` event | `keydown` event | `keypress` deprecated ~2018; doesn't fire for non-printables | D-01 uses `keydown` correctly |
| `TextDecoder` on raw bytes | Byte-level `Uint8Array` end-to-end | Pitfall 10 in RESEARCH.md | Phase 4 never converts to string; uses `charCodeAt()` for ASCII ranges only |
| Hidden `<input>` for key capture | tabindex=0 focusable container | Modern canvas-first apps (xterm.js pattern) | Phase 3 D-01 already established `#terminal-wrapper tabindex="0"` |
| `keyboardLock` API (fullscreen only) | Documentation note for reserved combos | Chromium policy since 2010 (#33056) | D-14 Settings note covers SC-2 |
| `:focus-visible` for focus indicator | `data-focused` attribute selector | Phase 3 Plan 06 gap #7 | Phase 4 preserves D-13 contract verbatim |

**Deprecated/outdated:**
- **`keyCode`/`which`**: Returns 0 for dead keys on some layouts; deprecated in favor of `code`/`key`. Do not use.
- **`keypress`**: Never fires for arrows, Enter, Tab, Backspace, Escape, Ctrl combos. Deprecated.
- **`onKeyDown` attribute (inline JS)**: Poor ergonomics; use `addEventListener` for cleanup paths.

## Sources

### Primary (HIGH confidence)

- [MDN: Element/keydown event](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event) — event semantics, modifier state
- [MDN: KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code) — physical-key identifier, layout-independent
- [MDN: KeyboardEvent.key](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key) — layout-aware character output
- [MDN: KeyboardEvent.isComposing](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing) — IME state guard
- [MDN: KeyboardEvent.getModifierState](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState) — AltGraph detection
- [MDN: CompositionEvent](https://developer.mozilla.org/en-US/docs/Web/API/CompositionEvent) — IME lifecycle
- [MDN: Event.preventDefault()](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault) — synchronous-call requirement
- [MDN: HTMLElement.focus()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus) — mousedown-preventDefault focus-retention pattern
- [MDN: Element/mousedown event](https://developer.mozilla.org/en-US/docs/Web/API/Element/mousedown_event) — preventDefault prevents focus transfer
- [W3C UI Events](https://www.w3.org/TR/uievents/) — composition event ordering spec
- [Playwright Keyboard docs](https://playwright.dev/docs/api/class-keyboard) — `page.keyboard.press` behavior
- [Playwright Actions docs](https://playwright.dev/docs/input) — input-event dispatch model
- [DEC VT52 DECscope Maintenance Manual, Chapter 3](https://vt100.net/docs/vt52-mm/chapter3.html) — arrow-key byte sequences (ESC A/B/C/D)
- `crates/bestialitty-core/src/key.rs` — authoritative encoder + tag contract + 37 unit tests
- `crates/bestialitty-core/tests/boundary_api_shape.rs` — compile-time pin of `encode_key_raw`
- `www/renderer/chrome.js` — existing keydown listener precedent + focus/blur handling
- `.planning/research/captures/capture-01-cpm-boot/README.md` — CR-on-Enter default evidence (LF-only workload)
- `.planning/research/captures/capture-02-basic/README.md` — CRLF workload evidence (BASIC-80)
- `.planning/research/PITFALLS.md` §Pitfalls 3, 9, 10, 13 — all directly applicable to Phase 4

### Secondary (MEDIUM confidence)

- [Chromium issue #33056 — Ctrl-W/N/T not overridable](https://issues.chromium.org/issues/41081444) — WONTFIX since 2010, confirmed in 2026 web search
- [Chromium issue #40177511 — API to request key events normally reserved](https://issues.chromium.org/issues/40177511) — `keyboardLock` API rationale
- [cockpit-project/cockpit#14545](https://github.com/cockpit-project/cockpit/issues/14545) — same problem hit in another terminal-in-browser project
- [cockpit-project/cockpit#7956](https://github.com/cockpit-project/cockpit/issues/7956) — Ctrl+W workaround discussion
- [Not Rocket Science: Handling IME events in JavaScript](https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/) — `isComposing` guard pattern
- [ProseMirror forum: Prevent focus on button click](https://discuss.prosemirror.net/t/prevent-focus-when-clicking-on-a-button/5108) — mousedown preventDefault pattern confirmed

### Tertiary (LOW — project-internal only)

- Phase 1 Plan 06 summary (STATE.md entries): confirms `encode_key_raw` behavior with 37-test suite
- Phase 3 Plan 07 summary (STATE.md entries): confirms `data-focused` attribute contract + Ctrl+Alt+T chord remap
- Phase 2 D-12: KeyCode tag frozen scheme (mirrored verbatim in D-04 of Phase 4)

## Metadata

**Confidence breakdown:**

- User constraints (CONTEXT.md): HIGH — directly quoted verbatim from CONTEXT.md
- Standard stack: HIGH — zero new dependencies; existing wasm boundary + Playwright infrastructure
- Architecture patterns: HIGH — five patterns, each with a working precedent in the existing codebase (`chrome.js` for Pattern 1; `encode_key_raw` tests for Pattern 2; `main.js` bell/host_reply flow for Pattern 3)
- Browser-reserved Ctrl combos: HIGH — cross-verified against Chromium bug tracker (WONTFIX since 2010), 2026 web search results, and Phase 3 Plan 06 empirical confirmation on Ctrl+Shift+T
- Common pitfalls: HIGH — 10 pitfalls, each with a named MDN or PITFALLS.md source
- IME lifecycle: MEDIUM — spec is HIGH confidence but Playwright automated testing of it is MEDIUM (Open Question 1)
- Validation architecture: HIGH — Playwright patterns validated in Phase 3; Wave 0 scaffolding is straightforward

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — DOM APIs are stable; reserved-key list has been stable for 16 years)

---

*Phase: 04-keyboard-input*
*Research complete: 2026-04-22*
