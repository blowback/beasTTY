---
phase: 04-keyboard-input
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - www/index.html
  - www/input/keyboard.js
  - www/input/tx-sink.js
  - www/main.js
  - www/playwright.config.js
  - www/renderer/chrome.js
  - www/tests/input/crlf-override.spec.js
  - www/tests/input/focus-retention.spec.js
  - www/tests/input/ime-composition.spec.js
  - www/tests/input/keydown-arrows.spec.js
  - www/tests/input/keydown-ctrl-letters.spec.js
  - www/tests/input/keydown-printable.spec.js
  - www/tests/input/local-echo.spec.js
  - www/tests/input/tx-debug-strip.spec.js
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-04-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 4 wires DOM keyboard input to the existing `encode_key_raw` wasm boundary (no Rust changes per Phase 1 D-13). The implementation is tight, well-commented, and correctly observes the documented constraints: synchronous `preventDefault` on forwarded keys, `e.code` for control keys vs `e.key` for printable, IME guard via `isComposing` flag + `e.isComposing` belt-and-braces, `mousedown` `preventDefault` on toolbar buttons for focus retention, and a JS-owned `Uint8Array(1024)` ring for TX bytes. KEY_TAG constants in `keyboard.js` line up exactly with `crates/bestialitty-core/src/key.rs:141-158`.

Findings are dominated by defensive-coding and test-quality concerns rather than correctness bugs. No critical issues were found. The four warnings flag (1) a latent mutability hazard around the `CRLF_MODES` shared `Uint8Array` references, (2) observer exception propagation that could trap state inside a keydown listener, (3) the `notify()` call on an empty `pushTxBytes` invocation, and (4) timing-based `waitForTimeout` calls in `local-echo.spec.js` that risk flakiness on slow CI. Info-level items cover string duplication of the TX strip placeholder across four files, weak assertions in one test, and a missing defensive guard in `pushTxBytes`.

Two known limitations are intentionally deferred and correctly documented in source:

1. **IME double-emit risk under real Chromium:** keyboard.js:171 guards keydown during composition, but on some Chromium versions a post-`compositionend` synthetic keydown with the committed char in `e.key` and `e.isComposing === false` would cause a double-emit. `ime-composition.spec.js` acknowledges this as RESEARCH Open Question 1 and defers to manual UAT.
2. **Performance issues are explicitly out of v1 review scope** per GSD reviewer charter.

## Warnings

### WR-01: `CRLF_MODES` shared Uint8Array references are effectively mutable

**File:** `www/input/keyboard.js:45-49`
**Issue:** `CRLF_MODES` is `Object.freeze`d, but `Object.freeze` does NOT freeze the byte contents of the Uint8Array values it holds. A future bug anywhere in the codebase that writes `CRLF_MODES.cr[0] = 0x00` (say, via a misplaced test helper, or a mis-imported const) would silently corrupt every subsequent Enter TX. Worse, `forwardBytes` line 194 assigns `outBytes = CRLF_MODES[crlfMode]` and then both pushes it to the ring AND passes it to `termRef.feed(outBytes)` — both consumers share the same buffer. `wasm-bindgen` generally copies on FFI so this is safe today, but any future code path that retains the reference (e.g., a queuing writer in Phase 5) would couple the ring and the echo path through a shared, mutable buffer.
**Fix:**
```js
// Return a fresh copy so callers cannot mutate the module-shared template.
const CRLF_MODES = Object.freeze({
    cr:   [0x0D],
    lf:   [0x0A],
    crlf: [0x0D, 0x0A],
});
// In forwardBytes:
if (wasEnter && bytes.length === 1 && bytes[0] === 0x0D && crlfMode !== 'cr') {
    outBytes = Uint8Array.from(CRLF_MODES[crlfMode]);
}
```
Or equivalently keep the Uint8Array templates but `slice()` on use: `outBytes = CRLF_MODES[crlfMode].slice();`.

### WR-02: Observer exception inside `notify()` can trap keyboard state

**File:** `www/input/tx-sink.js:63-65`
**Issue:** `notify()` iterates observers with a plain `for...of` and no try/catch. An observer throwing (e.g., `txStripEl` becomes null via a future DOM edit, or `textContent` assignment throws on a detached node) will propagate out of `pushTxBytes`, then out of `forwardBytes`, then out of the `keydown` listener. For the keydown path, `e.preventDefault()` has already been called (keyboard.js:177) so the key is not double-sent — but the browser will log the uncaught exception on every subsequent keypress, and subsequently-registered observers in the array are skipped for this tick. With only one observer today this is latent, but it gets worse the moment Phase 5 adds a Web Serial observer: a transient writer failure would prevent the Debug TX strip from updating.
**Fix:**
```js
function notify() {
    for (const fn of observers) {
        try { fn(); }
        catch (err) { console.error('[tx-sink] observer threw:', err); }
    }
}
```

### WR-03: `pushTxBytes` calls `notify()` even when given an empty Uint8Array

**File:** `www/input/tx-sink.js:25-34`
**Issue:** If `bytes.length === 0` the for-loop is a no-op but `notify()` still fires, forcing every observer to re-read/re-render for nothing. Current callers (`forwardBytes`) early-return on zero-length, so this is defensive rather than a live bug — but it couples correctness to caller discipline.
**Fix:**
```js
export function pushTxBytes(bytes) {
    const len = bytes.length;
    if (len === 0) return;
    for (let i = 0; i < len; i++) {
        ring[writeIdx] = bytes[i] & 0xFF;
        writeIdx = (writeIdx + 1) % RING_CAP;
        if (writeIdx === 0) wrapped = true;
    }
    notify();
}
```

### WR-04: `waitForTimeout` in `local-echo.spec.js` is a timing-flakiness vector

**File:** `www/tests/input/local-echo.spec.js:47,61,70,78`
**Issue:** Four places rely on `page.waitForTimeout(50)` or `(80)` to let rAF finish painting before reading `window.__testGridView()`. These are wall-clock waits, not condition waits — on a slow CI runner or under memory pressure, 50 ms is not guaranteed to cover a double-rAF + paint. Playwright documentation explicitly flags `waitForTimeout` as an anti-pattern outside of debugging. The tests already work today but become brittle as CI cost varies.
**Fix:** Replace with `waitForFunction` on the grid-view state:
```js
// Instead of: await page.waitForTimeout(80);
await page.waitForFunction(
    (expected) => window.__testGridView()[0] === expected,
    0x43,
);
```
For the negative assertions ("should NOT render"), a single `await page.waitForFunction(() => true)` + one rAF tick via `requestAnimationFrame` probe is sufficient; keep the post-condition `expect().not.toBe(...)`.

## Info

### IN-01: TX strip placeholder string duplicated across four files

**File:** `www/main.js:51`, `www/index.html:280`, `www/tests/input/focus-retention.spec.js:58`, `www/tests/input/tx-debug-strip.spec.js:4`
**Issue:** The literal `'(none yet — press any key on the terminal to see TX bytes)'` appears in four independent source files. Any copy edit to the placeholder copy must update all four. Tests would fail loudly but index.html and main.js could drift silently (the initial pre-boot render uses the HTML copy; the first observer fire replaces it with the JS copy).
**Fix:** Export `TX_STRIP_PLACEHOLDER` from `www/input/tx-sink.js` (or a small shared `constants.js`) and have `main.js` assign it to `txStripEl.textContent` at boot, removing the literal from `index.html`. Tests can import the same constant.

### IN-02: `registerTxObserver` has no deregistration path and no de-duplication

**File:** `www/input/tx-sink.js:50-52`
**Issue:** Observers can only be added, never removed. Registering the same function twice pushes two entries. Not a live concern in the single-boot main.js, but an HMR dev loop or a test that re-imports the module would accumulate observers.
**Fix:** Either return an unregister handle (`return () => { const i = observers.indexOf(fn); if (i >= 0) observers.splice(i, 1); };`) or add a guard `if (observers.includes(fn)) return;`. Low priority for a static-deploy project.

### IN-03: `pushTxBytes` lacks a null/undefined guard on `bytes`

**File:** `www/input/tx-sink.js:25-34`
**Issue:** A caller that passes `null`/`undefined` will throw on `bytes.length`. Internal callers are disciplined today, but the function is exported and may be called from a future module or a debug REPL path. A clear early return or throw with message makes misuse louder.
**Fix:**
```js
export function pushTxBytes(bytes) {
    if (!bytes || typeof bytes.length !== 'number') {
        throw new TypeError('pushTxBytes expects a Uint8Array or array-like');
    }
    // ... rest
}
```

### IN-04: `compositionupdate` listener is a no-op

**File:** `www/input/keyboard.js:145-147`
**Issue:** The handler body is an explanatory comment only (`// no-op — commit on compositionend only.`). Registering an empty listener still costs a small amount of dispatch time on every IME character and adds a stack frame in DevTools traces.
**Fix:** Delete the listener; the comment can move onto the `compositionend` registration so the intent ("we commit only at end, not during update") is preserved.

### IN-05: `e.code.length === 7` check for Numpad digits is brittle

**File:** `www/input/keyboard.js:106-108`
**Issue:** The check `e.code.startsWith('Numpad') && e.code.length === 7` assumes all Numpad digit codes are exactly 7 chars long. That happens to match `Numpad0`-`Numpad9` today, but also any 7-char `NumpadX` where X is a non-digit (e.g., future `NumpadA` would parse `0x41 - 0x30 = 0x11` before the `d >= 0 && d <= 9` guard rejects it). The guard saves us, but a more explicit check would be self-documenting.
**Fix:**
```js
// Explicit NumpadN where N is a digit:
const m = /^Numpad([0-9])$/.exec(e.code);
if (m) return KEY_TAG.KeypadDigit | (parseInt(m[1], 10) << 8);
```
Or simpler: `if (e.code && e.code.length === 7 && e.code.startsWith('Numpad')) { const d = e.code.charCodeAt(6) - 0x30; if (d >= 0 && d <= 9) return ...; }` (swap order of guards so charCode math runs only on a length-7 Numpad-prefixed string — current code already does this).

### IN-06: `tx-debug-strip.spec.js` last-64-bytes assertion is weak

**File:** `www/tests/input/tx-debug-strip.spec.js:40-42`
**Issue:** Test claims to verify "last 64 bytes" but `expect(pairs.length).toBeLessThanOrEqual(64)` would pass even if the impl regressed to `formatHexStrip(limit = 1)` and returned a single byte. There is no lower bound. Combined with `endsWith('1B 41')` this means a 1-byte or 2-byte strip would pass the test.
**Fix:** Add a lower-bound assertion:
```js
// We pressed ArrowUp 40 times → 80 bytes written; strip limit is 64 → expect exactly 64 pairs.
expect(pairs.length).toBe(64);
```
If 80 > 64 then exactly 64 is the correct expectation under the current `formatHexStrip(64)` default.

### IN-07: `ime-composition.spec.js` uses `.not.toContain('41')`

**File:** `www/tests/input/ime-composition.spec.js:70-71`
**Issue:** The negative assertion `expect(stripText).not.toContain('41')` is weaker than an exact-equal assertion. Since `setup(page)` calls `resetTx` beforehand, the ring is empty and the expected strip state is the placeholder — a stronger check would be `expect(stripText).toBe('(none yet — press any key on the terminal to see TX bytes)')`. Current form tolerates unexpected bytes as long as 0x41 is absent.
**Fix:**
```js
const stripText = await page.locator('#tx-strip').textContent();
// With isComposing set and a Shift+KeyA keydown dropped, then a compositionend
// with empty data, TX should be exactly the reset-placeholder.
expect(stripText).toBe('(none yet — press any key on the terminal to see TX bytes)');
```

---

_Reviewed: 2026-04-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
