---
title: 'Settings ▸ Wrap long lines (optional autowrap at column 80)'
type: 'feature'
created: '2026-07-04'
baseline_commit: '8c5f8bad3172dc90a72bec7fce86cdf5470c93ff'
status: 'done'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When the cursor reaches the last column (col 79 of an 80-col terminal), further printable characters overstrike col 79 — text past the right edge is lost. The MicroBeast has no autowrap; some users want the terminal to continue onto the next line instead.

**Approach:** Add a persisted Settings ▸ "Wrap long lines" checkable toggle (default OFF, preserving today's clamp behavior). When ON, the Rust core performs **deferred (pending-wrap) autowrap**: after a char is written to the last column the cursor parks there with a latch; the wrap to column 0 of the next line happens only when the *next printable* character arrives, so an exactly-80-column line followed by CR/LF produces **no** spurious blank line (xterm/VT100 semantics). This is the first pref that reaches the wasm core, via a new `Terminal.set_wrap(bool)` setter injected into the menu through `wireMenuBar` opts (AD-3 — menu-bar.js must not import the core).

## Boundaries & Constraints

**Always:**
- Deferred wrap (pending-wrap latch), NOT immediate wrap — a printed char to the last col parks the cursor; the row advance fires on the next printable, using the existing scroll-aware `line_feed()` + `cursor_col = 0`.
- The `pending_wrap` latch is cleared by **every** cursor-repositioning operation (see Code Map for the exhaustive site list). BEL and mode toggles do NOT reposition the cursor and must NOT clear it.
- Default OFF: with `wrapLongLines = false`, `print()` behaves byte-for-byte as today (overstrike/clamp at col 79). `pending_wrap` is never armed when wrap is off.
- `wasm_bindgen` attributes live in `lib.rs` only; the core method is plain Rust in `terminal.rs` (enforced by `tests/core_02_no_browser_deps.rs`).
- `applyPrefs` (main.js) stays the single writer of live core state on boot/reset (`term.set_wrap(p.wrapLongLines)`); menu-bar.js only persists + projects its own row DOM.
- Reuse the generic checkable seam: `data-pref` row + `CHECKABLE_PREF_EFFECTS` entry + a `projectCheckable` wrapper. Zero new mechanic, zero new CSS, no `prefs.js` `CURRENT_VERSION` bump (defensive spread-merge, same precedent as `showDebugPanel`).

**Ask First:**
- Any change to the *default* (staying OFF is assumed) or to the wrap *timing* (deferred is locked by the user's decision on 2026-07-04).

**Never:**
- No immediate/eager wrap. No importing the core into menu-bar.js. No new pref schema version. No autowrap semantics on CR/LF/HT/BS themselves — those only clear the latch. No touching the SLIDE/keyboard/canvas paths.

## I/O & Edge-Case Matrix

Terminal is 80 cols wide; "last col" = 79. Assume wrap ON unless noted.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wrap OFF (default) | 82 printable chars from col 0 | Chars 1–80 fill cols 0–79; chars 81,82 overstrike col 79 (today's behavior, unchanged) | N/A |
| Deferred wrap | 80 chars fill row r; then one more printable `X` | 80th char at (r,79), latch armed; `X` triggers `line_feed()`+col 0 → `X` at (r+1, 0) | N/A |
| No spurious blank line | 80 chars fill row r; then CR then LF | CR clears latch + col→0; LF advances one row. Cursor at (r+1,0); row r+1 is blank, NO extra blank between | N/A |
| Wrap at bottom row | Cursor on last visible row at col 79 latched; next printable | `line_feed()` scrolls via `scrollback.push_line()` (same as LF at bottom); char lands at (last,0) | N/A |
| Latch cleared by move | 80 chars fill row r (latch armed); then ESC A (cursor up) then printable `Y` | ESC A clears latch + moves up; `Y` overstrikes/writes at the moved position, NO wrap | N/A |
| BEL does not clear | 80 chars (latch armed); then BEL (0x07); then printable `Z` | BEL rings, cursor unmoved, latch survives; `Z` wraps to (r+1,0) | N/A |
| Toggle off mid-latch | Latch armed; `set_wrap(false)` called | Latch cleared immediately; subsequent print overstrikes col 79 | N/A |

</frozen-after-approval>

## Code Map

- `crates/beastty-core/src/terminal.rs` -- `struct Terminal` (`:17-41`, add `wrap: bool` + `pending_wrap: bool`); `new` (`:44-62`, init both false); `print` (`:262-287` — the change: consume latch at top, arm it instead of clamp at bottom); `set_wrap` (new, plain Rust `pub fn`, model on `enter_graphics_mode` `:398`). **Latch-clear sites (all cursor repositions):** `resize` `:165-166`, `clear_visible` `:235-236`, `execute_c0` BS `:297` / HT `:303` / LF `:308-309` / CR `:313`, `cursor_up` `:322`, `cursor_down` `:328`, `cursor_right` `:335`, `cursor_left` `:340`, `cursor_home` `:344-347`, `reverse_lf` `:348-361`, `move_cursor` `:389-390`. Reference primitive: `line_feed` `:419-432`.
- `crates/beastty-core/src/lib.rs` -- wasm façade `Terminal` (`:55-175`); add one-line `#[wasm_bindgen] pub fn set_wrap(&mut self, on: bool) { self.inner.set_wrap(on); }` next to `resize` `:159-161`.
- `www/state/prefs.js` -- `DEFAULTS` (`:20+`), add `wrapLongLines: false`; NO `CURRENT_VERSION` bump.
- `www/main.js` -- `term` `:180`; `applyPrefs(p)` — add `term.set_wrap(p.wrapLongLines)` (single-writer); `wireMenuBar({...})` opts — inject `setWrap: (v) => term.set_wrap(v)`.
- `www/renderer/menu-bar.js` -- `setWrapRef` module let (model on `setLocalEchoRef` `:160`); opts intake (`:354`); `wrapLinesItemEl` + discovery/initial-paint (`:468-470`); `CHECKABLE_PREF_EFFECTS` add `wrapLongLines: { apply: (next) => setWrapRef?.(next) }` (`:185-189`); `projectWrapLines` wrapper (`:1140-1141`); `projectMenuOnOpen` settings branch (`:1116-1120`); `projectPrefs` before the View guard (`:1355`).
- `www/index.html` -- `#dropdown-settings` (`:1338`); add the checkable row after Local echo `:1348`.
- Tests: `crates/beastty-core/src/terminal.rs` `#[cfg(test)] mod tests` (`:435+`); `www/tests/render/menu-bar-settings.spec.js`.

## Tasks & Acceptance

**Execution:**
- [x] `crates/beastty-core/src/terminal.rs` -- Added `wrap`/`pending_wrap` fields + `set_wrap`; rewrote `print()` to consume the latch at the top and arm it (instead of clamping) at the last column; cleared `pending_wrap` at all 13 cursor-reposition sites (resize, clear_visible, BS/HT/LF/CR, cursor_up/down/left/right/home, reverse_lf, move_cursor) -- core behavior.
- [x] `crates/beastty-core/src/lib.rs` -- Added the `set_wrap` wasm forward next to `resize` -- JS→core seam.
- [x] `crates/beastty-core/src/terminal.rs` (tests) -- 7 unit tests covering the full I/O matrix: overstrike when off, deferred wrap on, no-blank-line on CR/LF, scroll-at-bottom wrap, latch cleared by a cursor move, BEL preserves latch, toggle-off clears latch. `cargo test -p beastty-core` → 173 passed.
- [x] `www/state/prefs.js` -- Added `wrapLongLines: false` to DEFAULTS (no `CURRENT_VERSION` bump) -- persistence.
- [x] `www/main.js` -- `term.set_wrap(!!p.wrapLongLines)` in `applyPrefs` (single-writer); injected `setWrap: (v) => term.set_wrap(!!v)` into `wireMenuBar` -- single-writer + injection.
- [x] `www/renderer/menu-bar.js` -- `setWrapRef`, opts intake, element discovery + initial paint, `CHECKABLE_PREF_EFFECTS` entry, `projectWrapLines`, open + reset re-projection -- toggle wiring (plugs into the generic `data-pref` checkable handler automatically).
- [x] `www/index.html` -- Checkable "Wrap long lines" row (`id="menu-wrap-lines-item"`, `data-pref="wrapLongLines"`) after Local echo -- the control.
- [x] `www/tests/render/menu-bar-settings.spec.js` -- 4 specs: toggle persists + applies live (proven behaviorally — feed 81 chars through `window.__term` and assert the cursor wrapped), default-OFF overstrike, toggle-off re-applies, reset re-projection. Also updated `menu-bar.spec.js` + `menu-bar-keyboard.spec.js` (the bare `[data-variant="checkable"]` Settings selector was no longer unique → retargeted to `#menu-local-echo-item`). Full chromium suite: 366 passed / 0 failed.

**Acceptance Criteria:**
- Given wrap is OFF (default), when 82 chars are printed from col 0, then cols 0–79 hold the first 80 chars and the last two overstrike col 79 (unchanged today's behavior).
- Given wrap is ON and a row is filled to col 79, when the next printable char arrives, then it appears at column 0 of the following row (scrolling if at the bottom).
- Given wrap is ON and a row is filled to exactly 80 chars, when CR then LF follow, then the cursor lands at col 0 one row down with NO extra blank line inserted.
- Given the latch is armed, when any cursor-move command (CR/LF/BS/HT/cursor arrows/home/ESC Y/reverse-LF) fires, then the next printable does NOT wrap; when BEL fires, the latch survives and the next printable DOES wrap.
- Given the Settings menu is open, when "Wrap long lines" is activated, then `prefs.wrapLongLines` persists, `term.set_wrap` is applied live (no reload), the glyph/aria/`data-checked` flip in lockstep, the menu stays open, and terminal focus is retained.
- Given `resetPrefs()` fires, when `projectPrefs` runs, then the row re-derives to unchecked and `term.set_wrap(false)` is applied via `applyPrefs`.

## Spec Change Log

- 2026-07-04 — Three-reviewer adversarial pass (blind hunter / edge-case hunter / acceptance auditor, Opus). Verdict: **no bugs, faithful to spec, no loopback.** Edge-case hunter cross-checked every cursor-mutating site in `terminal.rs` against the `vt52.rs` dispatch table and confirmed the latch-clear set is exhaustive (ESC J/K erase correctly do NOT clear — they don't reposition, matching DECAWM). Only action taken: patched in 2 more per-op latch-clear tests (row-changing ESC A, direct-address ESC Y) per the acceptance auditor's "representative not exhaustive" note. `cargo test -p beastty-core` → 175 passed.

## Design Notes

**Deferred-wrap shape in `print()`** (pseudo — keep the existing graphics-mode write body unchanged):

```rust
pub(crate) fn print(&mut self, byte: u8) {
    let cols = self.scrollback.cols() as u32;
    if self.wrap && self.pending_wrap {   // consume latch BEFORE computing row/col
        self.line_feed();
        self.cursor_col = 0;
        self.pending_wrap = false;
    }
    // ... existing bounds-safe cell write at (cursor_row, cursor_col) ...
    self.dirty.mark(self.cursor_row as usize);
    if self.cursor_col + 1 < cols {
        self.cursor_col += 1;
    } else if self.wrap {
        self.pending_wrap = true;         // arm — do NOT advance yet (deferred)
    }                                     // else: clamp (overstrike), unchanged
}
```

`set_wrap`: `self.wrap = on; if !on { self.pending_wrap = false; }`.

Every cursor-reposition method gets `self.pending_wrap = false;`. The list is exhaustive and stable because VT52 is a frozen pragmatic subset — no new cursor commands are expected (grep of all `cursor_col/row =` writes confirmed the site list). Test hook: add a read-only `getWrap()` (or feed-and-read-grid) so the Playwright spec can prove persist ≠ apply, mirroring the existing `window.__keyboardState`.

## Verification

**Commands:**
- `cargo test -p beastty-core` -- expected: all core unit tests pass incl. the new wrap tests.
- `./scripts/build.sh` -- expected: wasm rebuilds into `www/pkg/` with no errors (required for the JS layer to see `set_wrap`).
- `cd www && npm test` -- expected: full chromium Playwright suite green, including the new Wrap-long-lines specs.

## Suggested Review Order

**Deferred-wrap core (the risk)**

- Start here — the deferred latch: consume at the top, arm (not advance) at the last column.
  [`terminal.rs:295`](../../crates/beastty-core/src/terminal.rs#L295)
- The `else if self.wrap` arm — where a last-column char parks instead of clamping.
  [`terminal.rs:323`](../../crates/beastty-core/src/terminal.rs#L323)
- `set_wrap` — toggling off drops any armed latch.
  [`terminal.rs:189`](../../crates/beastty-core/src/terminal.rs#L189)
- The invariant: `pending_wrap` + all 13 cursor-reposition clear sites (grep confirms exhaustive).
  [`terminal.rs:33`](../../crates/beastty-core/src/terminal.rs#L33)

**JS→core seam (AD-3)**

- The one wasm export, next to `resize`.
  [`lib.rs:170`](../../crates/beastty-core/src/lib.rs#L170)
- `applyPrefs` — single writer of core wrap state on boot/reset.
  [`main.js:1435`](../../www/main.js#L1435)
- Injected setter closure — menu never imports the core.
  [`main.js:521`](../../www/main.js#L521)

**Toggle wiring (generic checkable seam)**

- One table entry routes the pref to the live setter (persist ≠ apply).
  [`menu-bar.js:196`](../../www/renderer/menu-bar.js#L196)
- The pref default — no `CURRENT_VERSION` bump (defensive spread-merge).
  [`prefs.js:27`](../../www/state/prefs.js#L27)
- The checkable row itself.
  [`index.html:1355`](../../www/index.html#L1355)

**Tests**

- Core I/O matrix — 9 wrap unit tests (overstrike, defer, no-blank-line, scroll, latch clears, BEL, toggle-off).
  [`terminal.rs:925`](../../crates/beastty-core/src/terminal.rs#L925)
- UI wiring — toggle proven behaviorally by feeding the real core and reading the cursor.
  [`menu-bar-settings.spec.js:197`](../../www/tests/render/menu-bar-settings.spec.js#L197)
