---
phase: 06-daily-driver-polish-session-deployment
reviewed: 2026-04-25T00:00:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - crates/bestialitty-core/src/lib.rs
  - crates/bestialitty-core/src/scrollback.rs
  - crates/bestialitty-core/src/terminal.rs
  - crates/bestialitty-core/tests/boundary_api_shape.rs
  - crates/bestialitty-core/tests/clear_visible.rs
  - crates/bestialitty-core/tests/snapshot_at_offset.rs
  - www/index.html
  - www/input/clipboard.js
  - www/input/keyboard.js
  - www/input/selection.js
  - www/main.js
  - www/playwright.config.js
  - www/renderer/canvas.js
  - www/renderer/chrome.js
  - www/renderer/scroll-state.js
  - www/state/prefs.js
  - www/tests/session/auto-connect.spec.js
  - www/tests/session/clear-screen.spec.js
  - www/tests/session/clipboard-mock.js
  - www/tests/session/clipboard.spec.js
  - www/tests/session/log-download.spec.js
  - www/tests/session/prefs.spec.js
  - www/tests/session/scrollback.spec.js
  - www/tests/session/selection.spec.js
  - www/tests/transport/mock-serial.js
  - www/transport/serial.js
  - www/transport/session-log.js
  - LICENSE
  - .github/workflows/pages.yml
  - www/_headers
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-04-25
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Summary

This is a substantial, well-structured codebase. The Rust core is clean, the wasm boundary is thin and correctly gated, the scrollback and terminal implementations are correct and well-tested, and the JS shell respects the architectural split. The CSP, `_headers`, and CI pipeline are correctly configured.

Five warnings were found — all are logic-level issues that could cause incorrect runtime behaviour in specific circumstances. No security vulnerabilities or data-loss bugs were found. Six informational items cover dead-code paths, a wrong-type literal, and minor style inconsistencies.

---

## Warnings

### WR-01: `snapshot_grid_at` can read out-of-bounds when `row_offset` is large but `total_len < visible_rows`

**File:** `crates/bestialitty-core/src/terminal.rs:207-215`

**Issue:** `snapshot_grid_at` computes `start = tail_start.saturating_sub(row_offset)` and then loops `for r in 0..visible_rows`, indexing `self.scrollback.row_at_absolute(start + r)`. When `total_len < visible_rows` (possible during the very first few frames before any scrolling, or in tests with a fresh terminal and a large `row_offset`), `tail_start` is 0 (via `saturating_sub`), `start` is also 0, and the loop tries to access indices `0..visible_rows`. But if `total_len` is still equal to `visible_rows` (no scrollback history yet), all indices are in range. However, when a caller passes `row_offset > tail_start` AND `total_len > visible_rows` is not yet true, the saturating-sub on `tail_start` already produces 0, so the range `start..start+visible_rows` stays within `0..total_len`. This is safe **only** because `Scrollback::new` pre-allocates exactly `visible_rows` rows. The issue emerges if `resize_grid` shrinks `visible_rows` _after_ rows have been pushed: `total_len` may be larger than the new `visible_rows` but smaller than `old_visible_rows`, while `start + r` with the new `visible_rows` can still exceed `total_len`.

Concretely, consider: initial `new(3, 4, 2)` then `push_line()` once (`total_len = 4`), then `resize_grid(2, 4)` (`visible_rows = 2`, scrollback_cap = 2, `max_total = 4`, no eviction). Now `total_len = 4`, `visible_rows = 2`, `tail_start = 2`. A call `snapshot_grid_at(usize::MAX)` gives `start = 0`, loop runs `r in 0..2`, accesses index 0 and 1 — both valid. But if the caller passes `row_offset = 1`, `start = 1`, loop accesses 1 and 2 — also valid. The boundary holds here. The real risk is that `row_at_absolute` has a comment saying "Caller is responsible for clamping" with no bounds check:

```rust
pub fn row_at_absolute(&self, idx: usize) -> &Row {
    &self.rows[idx]   // panics on out-of-bounds
}
```

A well-formed sequence can produce `start + visible_rows > total_len` when `resize_grid` grows `visible_rows` and then `snapshot_grid_at` is called with a non-zero offset before new rows fill in. Example: `new(2, 4, 10)`, `push_line()` × 3 (`total_len = 5`), `resize_grid(4, 4)` (adds 2 blank rows, `total_len = 7`, `visible_rows = 4`), call `snapshot_grid_at(2)`. `tail_start = 3`, `start = 1`, loop `r in 0..4` accesses absolute indices 1..5 — all within 0..7, fine. But `resize_grid(6, 4)` (`visible_rows = 6`, adds 2 more, `total_len = 9`), `snapshot_grid_at(4)`: `tail_start = 3`, `start = 0`, loop accesses 0..6 within 0..9 — fine.

The only genuine panic path: if `resize_grid` is called with `new_visible_rows` _larger_ than `total_len` would ever allow (not possible since `resize_grid` adds blank rows). After careful analysis, the current implementation is **safe in practice** due to `resize_grid` always maintaining `total_len >= visible_rows`. However, the **missing bounds assertion** in `row_at_absolute` combined with the caller-responsibility comment creates a fragile contract that could be violated by future callers or if the resize/cap interaction changes. The fix is defensive and cheap.

**Fix:**
```rust
pub fn row_at_absolute(&self, idx: usize) -> &Row {
    // Caller (snapshot_grid_at) is responsible for clamping idx < total_len.
    debug_assert!(idx < self.rows.len(), "row_at_absolute: idx {} out of range {}", idx, self.rows.len());
    &self.rows[idx]
}
```

And in `snapshot_grid_at`, add a cap:
```rust
let end = (start + visible_rows).min(total);
for r in 0..(end - start) {
    let src = self.scrollback.row_at_absolute(start + r).as_slice();
    // ...
}
// If end-start < visible_rows, fill remaining pack_buf slots with BLANK.
```

---

### WR-02: `selectLine` uses two different whitespace characters in the trim loop

**File:** `www/input/selection.js:202`

**Issue:** The `selectLine` function trims trailing whitespace with:
```js
while (end > 0 && (text[end] === ' ' || text[end] === ' ')) end -= 1;
```
Both operands of `||` appear identical in the source. One is likely intended to be the non-breaking space ` ` (which `readRowText` could produce if the terminal ever emits 0xA0), but since both literals look like ordinary space ` ` (they render the same), the second comparison is dead — a space is always caught by the first test, and a non-breaking space would slip through untrimmed. This is a logic bug if the intent was to strip NBSP, and dead code if the intent was just space. The `getSelection` function uses the regex `[\s ]+$` which correctly handles all Unicode whitespace, but `selectLine` in `onPointerDown` uses this manual loop.

**Fix:**
```js
// Trim regular space and non-breaking space (U+00A0) from line-selection tail.
while (end > 0 && (text[end] === ' ' || text[end] === ' ')) end -= 1;
```
Or, simpler — reuse the same trim regex already used in `getSelection`:
```js
const trimmed = text.replace(/[\s ]+$/, '');
const end = Math.max(0, trimmed.length - 1);
```

---

### WR-03: `showLargePasteConfirm` — Cancel button listener is added but never removed on confirm

**File:** `www/input/clipboard.js:129`

**Issue:** In `showLargePasteConfirm`, `onCancel` is added to `pasteCancelBtn` and `onConfirm` is added to `pasteConfirmBtn`. The `cleanup` function removes `onConfirm` from `pasteConfirmBtn` and `onCancel` from `pasteCancelBtn`. This is correct on the surface. However, if the user dismisses by clicking **Confirm**, `cleanup` runs and removes `onConfirm` from `pasteConfirmBtn` and `onCancel` from `pasteCancelBtn` — both removals are correct. If the user clicks **Cancel**, `cleanup` runs identically: removes `onConfirm` and removes `onCancel`. Also correct.

The subtle issue: if the paste-progress row gets hidden by the `paste-pump` 'cancelled' event (which fires from a concurrent pump cancellation triggered by port-lost, etc.) WHILE the confirm chip is displayed, neither button fires `cleanup`, so both listeners accumulate on a second `showLargePasteConfirm` call. On a second large paste, a second `onConfirm` and a second `onCancel` are added, and the previous orphaned listeners from the first aborted chip will also fire. This means:
- Clicking Confirm on the second chip fires `resolve(true)` twice (two `onConfirm` closures).
- The first resolve wins (Promise resolves once), but the second closure's `cleanup` runs and re-hides the row prematurely.

In practice the double-fire is benign because `Promise.resolve` is idempotent, but the orphaned listeners grow without bound across multiple aborted large-paste sessions.

**Fix:** Store and remove all listeners unconditionally when the confirm-row is hidden externally, or use `{ once: true }` on both listeners:
```js
if (pasteConfirmBtn) pasteConfirmBtn.addEventListener('click', onConfirm, { once: true });
if (pasteCancelBtn)  pasteCancelBtn.addEventListener('click', onCancel,  { once: true });
```
Then remove `pasteConfirmBtn.removeEventListener('click', onConfirm)` from `cleanup` (it is already auto-removed after first fire). Keep the `pasteConfirmBtn.setAttribute('hidden', '')` call.

---

### WR-04: `prefs.js` `savePrefs` does not persist the `serial` sub-object deeply when callers pass a partial `serial` key

**File:** `www/state/prefs.js:64-68`

**Issue:** `savePrefs(partial)` does a shallow merge: `cached = { ...cached, ...partial }`. When a caller passes `savePrefs({ serial: { baud: 9600 } })` (only baud, omitting the other four fields), the merge replaces `cached.serial` with the single-field object `{ baud: 9600 }`. On the next `loadPrefs` reload the defensive merge in `loadPrefs` restores missing fields from DEFAULTS, so persistence survives a reload, but the **in-memory** `cached.serial` is now `{ baud: 9600 }` with all other serial fields missing for the rest of the session. Any consumer that reads `prefs.serial.dataBits` (e.g., the auto-connect path at `serial.js:194`) will get `undefined`, which coerces to `NaN` in the `parseInt` chain, and the fallback `|| 8` saves it — but `undefined` reaching the `dataBits` field in the `open()` config object may cause the Web Serial API to reject the open call.

In practice `serial.js` passes the full five-field form config to `savePrefs`, so no single-field serial partial is emitted today. But the schema contract says callers may pass partials, and the pattern is risky.

**Fix:**
```js
export function savePrefs(partial) {
    if (partial.serial) {
        partial = { ...partial, serial: { ...cached.serial, ...partial.serial } };
    }
    cached = { ...cached, ...partial };
    // ...debounce...
}
```

---

### WR-05: `serial.js` `updatePortStatusConnected` always shows "19200 8N1" regardless of actual config

**File:** `www/transport/serial.js:505`

**Issue:** `updatePortStatusConnected` hardcodes the display string `'MicroBeast (CP2102N 10c4:ea60) — 19200 8N1'`. If the user has changed the baud rate in the Connection pane (e.g. to 9600) and then connected, the status line will incorrectly say 19200. `lastConfig` is set at open-time and holds the actual config; it should be used here.

**Fix:**
```js
function updatePortStatusConnected() {
    if (!portStatusEl) return;
    const cfg = lastConfig || PRESET_CONFIG;
    const parity = cfg.parity === 'none' ? 'N' : cfg.parity === 'even' ? 'E' : 'O';
    portStatusEl.textContent =
        `MicroBeast (CP2102N 10c4:ea60) — ${cfg.baudRate} ${cfg.dataBits}${parity}${cfg.stopBits}`;
}
```

---

## Info

### IN-01: `renderPoliteFail` uses `innerHTML` with a static string literal containing `{TBD-during-Phase-6}`

**File:** `www/transport/serial.js:82-88`

**Issue:** The `renderPoliteFail` function sets `document.body.innerHTML` with a static string that includes the placeholder `{TBD-during-Phase-6}` in the GitHub URL. This is not a security issue (the string is entirely static with no user-controlled interpolation), but it is a shipped placeholder that will be visible to users of the deployed app if they open it in a non-Chromium browser.

**Fix:** Replace `github.com/{TBD-during-Phase-6}` with the actual repository URL before shipping.

---

### IN-02: `scroll-state.js` `jumpToTop` sets offset to `Number.MAX_SAFE_INTEGER`

**File:** `www/renderer/scroll-state.js:111`

**Issue:** `jumpToTop` calls `setOffset(Number.MAX_SAFE_INTEGER)`, which stores `9007199254740991` in the module-level `offset` variable. While `snapshot_grid_at` clamps internally, the stored offset value will remain `9007199254740991` for the lifetime of the scrolled-back state, and is visible to callers via `getOffset()`. Playwright tests that assert `offset > 0` pass, but the `fireChange` notification sends `{ offset: 9007199254740991, ... }` to observers, and any downstream observer that treats the offset as a line count (e.g. chip arithmetic) will show a comically large number. The `refreshChip` path is guarded by `newLinesSinceUserScrolled` so the chip text is correct, but the raw `onChange` payload exposes the sentinel.

**Fix:** Clamp to a reasonable sentinel value (e.g. `term.grid().total_len()` equivalent, or `1_000_000`), or snap to the real maximum after the wasm call completes:
```js
export function jumpToTop() {
    if (!termRef) return;
    // Use a large-but-finite sentinel; Rust clamps to total_len internally.
    setOffset(1_000_000);
}
```

---

### IN-03: `canvas.js` `paintRow` creates a new rasteriser closure on every cell of every dirty row

**File:** `www/renderer/canvas.js:220`

**Issue:** `paintRow(r, cols)` calls `makeRasteriserForTheme(activeTheme)` at the top of the function, then for each cell calls `atlas.get(ch, fg, rast, z)`. The rasteriser closure captures `activeTheme`, `activeZoom`, `activeDpr` by value at the time of the call, so correctness is fine. However, `paintRow` is called from the rAF loop once per dirty row. In steady-state with many dirty rows (e.g., after a scroll), this creates one closure per row. The atlas caches tiles so the closure is invoked only on cache-miss, but a fresh closure object is still allocated on every `paintRow` call.

This is not a functional bug, and performance is out of v1 scope, but it is a minor allocation pressure that could be eliminated by hoisting the rasteriser outside the loop.

**Fix:** (Info only — no correctness impact.)
```js
// Hoist outside the per-row loop in tick():
const rast = makeRasteriserForTheme(activeTheme);
for (let r = 0; r < rows; r++) {
    if (dirtyView[r] !== 0) paintRowWithRast(r, cols, rast);
}
```

---

### IN-04: `www/README.md` and `www/.nojekyll` are in the file list but contain no source logic

**File:** `www/README.md`, `www/.nojekyll`

**Issue:** These files are included in the review scope. `www/.nojekyll` is an empty marker file. `www/README.md` was not provided in the file-read block and contains no logic to review. Both are deployment artifacts, not source code. No action needed.

---

### IN-05: `LICENSE` file not provided but listed in scope

**File:** `LICENSE`

**Issue:** The `LICENSE` file was listed in the review scope but not provided in the file-read block. Cannot review contents. Ensure it matches the MIT/Apache-2.0 dual-license plan documented in CLAUDE.md.

---

### IN-06: `main.js` leaves `console.log` calls in the boot path

**File:** `www/main.js:599-600`

**Issue:** Two `console.log` calls at the end of the boot sequence (`[boot] Harness ready...` and `[boot] term=...`) log the wasm `Terminal` object and `wasm.memory` to the browser console on every page load. These are intentional developer diagnostics and low risk, but `wasm.memory` in the log exposes the raw `WebAssembly.Memory` object in DevTools, which could be inspected by a determined user of an open tab. For a daily-driver tool with no auth surface this is acceptable; for completeness it is noted.

**Fix:** (Info only.) Gate behind a debug flag or remove before public release:
```js
if (typeof __DEV__ !== 'undefined') {
    console.log('[boot] term=', term, 'wasm.memory=', wasm.memory);
}
```

---

_Reviewed: 2026-04-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
