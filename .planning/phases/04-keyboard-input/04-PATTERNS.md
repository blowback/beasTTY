# Phase 4: Keyboard Input - Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 10 (2 new JS modules, 8 new Playwright specs, 4 modified existing files)
**Analogs found:** 10 / 10 (every new file has a strong in-tree analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `www/input/keyboard.js` (new) | controller / event-wiring module | event-driven (request-response: DOM keydown → u32 pair → wasm bytes → TX sink) | `www/renderer/chrome.js` | **exact** — both expose a `wireX(opts)` entry, attach `keydown` on `#terminal-wrapper`, call synchronous `preventDefault()` based on `e.code`/`e.ctrlKey`, and manage module-scope state updated via exported setters |
| `www/input/tx-sink.js` (new) | service / ring-buffer store | batch (circular write) + pub-sub (observer fan-out) | `www/renderer/atlas.js` (class + module-scope cache), **and** `www/main.js` host-reply-view pattern (module-scope `Uint8Array` + lazy re-derive) | **role-match + data-flow-match** — module-scope typed-array state with a public API and generation/identity guard; differs in that tx-sink is functional (module exports) not a class |
| `www/tests/input/keydown-arrows.spec.js` (new) | test | request-response (page.keyboard.press → DOM assertion) | `www/tests/render/keyboard.spec.js` + `www/tests/render/zoom.spec.js` | **exact** — same `page.keyboard.press('ArrowUp')` + `await expect(locator).toHaveText(...)` + `#terminal-wrapper.focus()` setup |
| `www/tests/input/keydown-ctrl-letters.spec.js` (new) | test | request-response | `www/tests/render/keyboard.spec.js` | **exact** |
| `www/tests/input/keydown-printable.spec.js` (new) | test | request-response | `www/tests/render/keyboard.spec.js` | **exact** |
| `www/tests/input/local-echo.spec.js` (new) | test | request-response + state-toggle | `www/tests/render/theme-toggle.spec.js` (checkbox/radio flip + downstream assertion) | **role-match** — same flip-and-assert pattern but operating on a new Settings control |
| `www/tests/input/crlf-override.spec.js` (new) | test | request-response + radio-flip | `www/tests/render/phosphor.spec.js` (3-way radio-group + CSS-property assertion) | **exact** — phosphor's 3-way radio test IS the CR/LF override test template |
| `www/tests/input/ime-composition.spec.js` (new) | test | event-driven (CompositionEvent) | `www/tests/render/bell.spec.js` (uses `page.evaluate` + `dispatchEvent(new Event(...))` because the target event has no Playwright shortcut) | **role-match** — closest example of synthesising a non-Playwright event |
| `www/tests/input/focus-retention.spec.js` (new) | test | event-driven (mousedown preventDefault) | `www/tests/render/focus.spec.js` | **exact** — same `await expect(wrapper).toBeFocused()` + click-then-assert-focus pattern |
| `www/tests/input/tx-debug-strip.spec.js` (new) | test | request-response (observer → textContent) | `www/tests/render/keyboard.spec.js` + `www/tests/render/focus.spec.js` (Debug pane open + element text readout) | **role-match** |
| `www/main.js` (modified) | boot driver | event-driven wiring | self (existing wireChrome call site) | **exact** — add one import + one call, mirror the `wireChrome({...refs})` shape |
| `www/renderer/chrome.js` (modified) | controller | event-driven | self (existing `themeButton.addEventListener('click', ...)` block) | **exact** — add `mousedown` preventDefault siblings to existing click handlers |
| `www/index.html` (modified) | config / markup | n/a | existing `<details id="debug">` block + its `#debug` CSS rule | **exact** — D-13 explicitly mirrors this pane verbatim |
| `www/playwright.config.js` (modified) | config | n/a | self (single-line `testDir` → `testMatch` extension) | **exact** |

---

## Pattern Assignments

### `www/input/keyboard.js` (controller / event-wiring — NEW)

**Analog:** `www/renderer/chrome.js` (both wire DOM listeners on `#terminal-wrapper` and expose a `wireX(opts)` entry; both use synchronous `preventDefault()` on `keydown`).

**Imports pattern** (`www/renderer/chrome.js:13-21`):
```javascript
import {
    setTheme,
    setPhosphor,
    zoomStep,
    resetZoom,
    setFocus,
    getActiveTheme,
    getActivePhosphor,
} from './canvas.js';
```

**Entry shape pattern** (`www/renderer/chrome.js:52-58`):
```javascript
export function wireChrome(opts) {
    const { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay } = opts;
    const ctx = { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay };

    // Initial paint of chrome side-effects (reflects canvas.js default state).
    applyThemeSideEffects(getActiveTheme().name, ctx);
    applyPhosphorSideEffects(getActivePhosphor(), phosphorButtons);
```
**Copy pattern:** `wireKeyboard(opts)` destructures `{ term, wasm, terminalWrapper, localEchoCheckbox, crlfRadios, txStrip, txResetButton }`; stores `ctx` for use inside closures; no module-level singleton struct.

**Synchronous-preventDefault keydown with `e.code` discipline** (`www/renderer/chrome.js:76-108`):
```javascript
terminalWrapper.addEventListener('keydown', (e) => {
    // Ctrl+Alt+T — theme toggle (RENDER-07).
    // ... (comment about Chromium reservation) ...
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault();          // SYNCHRONOUS first — RESEARCH Pitfall #3.
        toggleTheme(ctx);
        return;
    }
    // Ctrl+{+, -, 0} — integer zoom (RENDER-09 / D-10).
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
            e.preventDefault();
            zoomStep(+1);
            return;
        }
        ...
    }
    // Any other key: Phase 4 will claim character-encoding keys here.
});
```
**Copy pattern:** Phase 4's keydown listener attaches AFTER this one (added later in `main.js` ordering). Phase 4 first-line check is `if (e.defaultPrevented) return;` (D-01). Rest follows D-03 decision tree using the same `e.code === 'ArrowUp'` / `e.ctrlKey && e.code === 'KeyX'` shape.

**Module-scope state + exported setter pattern** (`www/renderer/chrome.js` + `www/renderer/canvas.js:407-412`):
```javascript
// canvas.js line 407-412 — setFocus flips module-scope bool, requestFrame reacts.
export function setFocus(focused) {
    canvasHasFocus = focused;
    if (focused) blinkStartMs = performance.now();
    needsPaint = true;
    requestFrame();
}
```
**Copy pattern:** `setLocalEcho(bool)` and `setCrlfMode(mode)` in `keyboard.js` flip `let localEcho = false;` / `let crlfMode = 'cr';` module-scope state; no localStorage (D-09); Settings checkbox/radio change listeners call these.

**Host-reply drain + bell sampling pattern to reuse for local-echo** (`www/main.js:96-147`):
```javascript
// Host-reply drain helper (zero-copy per Phase 2 02-06 pattern) ...
let hostReplyView = null;
let hostReplyBuffer = null;

function reDeriveHostReplyView() {
    if (wasm.memory.buffer !== hostReplyBuffer) {
        hostReplyView = new Uint8Array(wasm.memory.buffer, term.host_reply_ptr(), HOST_REPLY_VIEW_CAP);
        hostReplyBuffer = wasm.memory.buffer;
    }
}
...
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);                       // ONE boundary call (Pitfall #1).
    sampleBell();                           // RENDER-11 — synchronous bell sampling.
    drainHostReply('feed');
    requestFrame();                         // wake renderer.
});
```
**Copy pattern:** When `localEcho === true`, after `encode_key_raw(...)` returns bytes, call `term.feed(bytes); sampleBell(); drainHostReply('echo'); requestFrame();` — same four-step sequence, same order. Pass `sampleBell` / `drainHostReply` / `requestFrame` / `term` via `wireKeyboard(opts)` or re-import them.

**Memory-growth-safe view guard** (`www/renderer/canvas.js:43-51`):
```javascript
function rebuildViews() {
    gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
    dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
    cachedBuffer = wasm.memory.buffer;
}

function reDeriveViews() {
    if (wasm.memory.buffer !== cachedBuffer) rebuildViews();
}
```
**Copy pattern:** Apply to any view `keyboard.js` derives over `wasm.memory.buffer` in the local-echo path (e.g. if it inspects `term.host_reply_ptr()`). Identity guard before every read.

---

### `www/input/tx-sink.js` (service / ring-buffer — NEW)

**Analog (primary, module-scope state pattern):** `www/main.js:100-110` host-reply view + `www/renderer/canvas.js:37-51` gridView/dirtyView machinery — module-scope `Uint8Array` + write index + lazy re-derive on identity change.

**Analog (secondary, observer/public-API shape):** `www/renderer/atlas.js:26-72` Atlas class — shows the Map/generation-counter/public-method shape that tx-sink mirrors at module scope.

**Module-scope typed-array state** (`www/renderer/canvas.js:37-47`):
```javascript
const CELL_SIZE = 8;

let wasm = null;
let term = null;
let cachedBuffer = null;
let gridView = null;
let dirtyView = null;

function rebuildViews() {
    gridView  = new Uint8Array(wasm.memory.buffer, term.grid_ptr(),  term.grid_byte_len());
    dirtyView = new Uint8Array(wasm.memory.buffer, term.dirty_ptr(), term.rows());
    cachedBuffer = wasm.memory.buffer;
}
```
**Copy pattern:** `tx-sink.js` top-of-module declares `const RING_CAP = 1024; const ring = new Uint8Array(RING_CAP); let writeIdx = 0; let wrapped = false; const observers = [];` — allocated ONCE at module init, not inside `pushTxBytes`. No buffer-identity guard needed because the ring buffer lives in JS-owned memory, not wasm memory (note this in the file-level comment so Phase 5 swap-in doesn't confuse future readers).

**Generation / cache-invalidation pattern** (`www/renderer/atlas.js:63-67`):
```javascript
evict() {
    this.cache.clear();
    this.invCache.clear();                     // both caches flush together
    this.nonce = (this.nonce + 1) & 0xFF;
}
```
**Copy pattern:** `resetTx()` in tx-sink.js zeros the ring-buffer indices (`writeIdx = 0; wrapped = false;`), optionally clears the `Uint8Array` (`ring.fill(0)` — cheap for 1 KiB), and fires observers so the `<pre id="tx-strip">` updates to the empty-state placeholder.

**Observer / push-notification pattern (no direct analog; closest is `triggerBellFlash` + CSS class toggle):** `www/renderer/canvas.js:418-427`:
```javascript
export function triggerBellFlash() {
    const el = bellOverlayEl || document.getElementById('bell-overlay');
    if (!el) return;   // chrome may not be mounted yet during early boot
    if (bellFlashTimer !== null) clearTimeout(bellFlashTimer);
    el.classList.add('flash');
    bellFlashTimer = setTimeout(() => {
        el.classList.remove('flash');
        bellFlashTimer = null;
    }, 100);
}
```
**Copy pattern:** `registerTxObserver(fn) { observers.push(fn); }` — simple array push; `pushTxBytes(u8)` iterates `for (const fn of observers) fn();` synchronously after writing bytes to the ring. No debouncing (SC-1 requires instant visibility). No off-registration API needed in v1 (module-lifetime observers only, same as the single fixed `bellOverlayEl`).

**Public-API shape** (match `www/renderer/canvas.js:290-295 + 407-416` export conventions):
```javascript
export function requestFrame() { ... }
export function setFocus(focused) { ... }
export function getActiveTheme() { return activeTheme; }
```
**Copy pattern:** `export function pushTxBytes(bytes) { ... }`, `export function formatHexStrip(limit = 64) { ... }`, `export function registerTxObserver(fn) { ... }`, `export function resetTx() { ... }`. No default export; named exports only (matches every existing renderer module).

---

### `www/tests/input/keydown-arrows.spec.js` (test — NEW)

**Analog:** `www/tests/render/keyboard.spec.js` (exact shape match — keydown chord + state assertion).

**Imports + describe block** (`www/tests/render/keyboard.spec.js:1-6`):
```javascript
// Phase 3 Plan 04 — @fast keyboard-shortcut suite.
// Aggregates the quickest state-level shortcut checks so
// `npm run test:fast` (playwright --grep @fast) runs in under 10 s.
import { test, expect } from '@playwright/test';

test.describe('Keyboard shortcuts @fast', () => {
```
**Copy pattern:** File header with plan/req ID; `import { test, expect } from '@playwright/test';`; one `test.describe` per requirement ID (e.g. `'INPUT-02 — Arrow keys transmit ESC A/B/C/D'`); `@fast` tag on tests short enough to run in the `npm run test:fast` smoke pass.

**Keydown + state assertion** (`www/tests/render/keyboard.spec.js:7-16`):
```javascript
test('Ctrl+Alt+T toggles theme (state check only) @fast — gap #4 remap', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();

    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');
    await page.keyboard.press('Control+Alt+KeyT');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
});
```
**Copy pattern:** Navigate → focus wrapper → baseline assertion → `page.keyboard.press('ArrowUp')` → post-assertion. For TX-strip assertions add `await page.locator('#debug').evaluate((el) => { el.open = true; });` first (see tx-debug-strip template).

**Setup boilerplate for TX-aware tests** (from RESEARCH §Playwright testing patterns + `www/tests/render/keyboard.spec.js:18-37`):
```javascript
await page.goto('/');
await page.locator('#terminal-wrapper').focus();
await page.waitForFunction(() => document.getElementById('terminal').width > 0);
await page.locator('#debug').evaluate((el) => { el.open = true; });
await page.locator('#tx-reset').click();     // clears strip
await page.keyboard.press('ArrowUp');
await expect(page.locator('#tx-strip')).toHaveText('1B 41');
```
**Copy pattern:** Every TX assertion opens `#debug` first, resets TX for isolation, dispatches, then asserts exact text. Use `toHaveText('1B 41')` (D-15 format: space-separated uppercase hex pairs, newest right). No `waitForTimeout` — the observer is synchronous.

---

### `www/tests/input/keydown-ctrl-letters.spec.js` (test — NEW)

**Analog:** Same as arrows above (`www/tests/render/keyboard.spec.js`).

**Ctrl-chord + focus-retention combo** (from RESEARCH §Validation, lines 873-884):
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
**Copy pattern:** For every Ctrl-letter in A..Z minus W/N/T, assert both the TX byte (0x01..0x1A for A..Z, minus reserved gaps) AND `toBeFocused()` as the indirect preventDefault check. For Ctrl+W/N/T specifically, follow Phase 3's `Ctrl+Shift+T does NOT toggle theme` pattern (`www/tests/render/theme-toggle.spec.js:33-43`) — assert no TX strip update + no observable browser effect.

---

### `www/tests/input/keydown-printable.spec.js` (test — NEW)

**Analog:** `www/tests/render/keyboard.spec.js`.

**Printable char pattern** (use `page.keyboard.press('KeyA')` — same shape as `Control+KeyL` minus modifier):
```javascript
await page.keyboard.press('KeyA');
await expect(page.locator('#tx-strip')).toHaveText('41');
```
**Copy pattern:** Use `Shift+KeyA` for uppercase assertion (`toHaveText('41')` — D-03 e.key path: `e.key === 'A'`, byte 0x41). Assert shifted digits (`Shift+Digit1` → `!` → `21`). Cover one full row of the keyboard as a smoke, not every key.

---

### `www/tests/input/local-echo.spec.js` (test — NEW)

**Analog:** `www/tests/render/theme-toggle.spec.js` (flip-and-observe; see also the RESEARCH local-echo template on lines 887-917).

**Flip a toggle and verify downstream** (`www/tests/render/theme-toggle.spec.js:8-17`):
```javascript
test('click on #theme-toggle swaps body[data-theme] @fast', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'crt');

    await page.click('#theme-toggle');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
});
```
**Copy pattern:** Open `#settings`, `page.locator('#local-echo').check();`, then `page.keyboard.press('KeyA')` — assert grid cell contains 0x41. With echo OFF (default), same keypress leaves the grid cell unchanged. Use the harness-helper `window.__testGridView` if adding (see RESEARCH line 917) OR use a visual sample via `canvas.getContext('2d').getImageData(...)` à la `www/tests/render/cursor.spec.js:15-35`.

---

### `www/tests/input/crlf-override.spec.js` (test — NEW)

**Analog:** `www/tests/render/phosphor.spec.js` (3-way radio-group exclusivity + per-choice state assertion).

**3-way radio exclusivity** (`www/tests/render/phosphor.spec.js:13-29`):
```javascript
test('each phosphor button updates aria-pressed exclusively', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-phosphor="green"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-phosphor="amber"]')).toHaveAttribute('aria-pressed', 'false');
    ...
    await page.click('[data-phosphor="amber"]');
    await expect(page.locator('[data-phosphor="amber"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-phosphor="green"]')).toHaveAttribute('aria-pressed', 'false');
});
```
**Copy pattern:** For CR/LF radios: default `#crlf-cr` is `checked`; flip to `#crlf-lf` → press Enter → TX strip shows `0A`; flip to `#crlf-crlf` → press Enter → `0D 0A`; flip back to `#crlf-cr` → `0D`. One test per mode + one exclusivity test. Use `page.locator('#crlf-lf').check()` (native radio check API, not `click()` — same as phosphor test uses `.click()` because its buttons are `<button role="radio">`).

**Per-choice downstream assertion** (`www/tests/render/phosphor.spec.js:31-41`):
```javascript
for (const [color, hex] of Object.entries(PALETTE)) {
    await page.click(`[data-phosphor="${color}"]`);
    const cssFg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--phosphor-fg').trim(),
    );
    expect(cssFg.toLowerCase()).toBe(hex.toLowerCase());
}
```
**Copy pattern:** Iterate `[['cr', '0D'], ['lf', '0A'], ['crlf', '0D 0A']]`; `.check()` each radio; press `Enter`; assert `#tx-strip` text matches the expected bytes. Reset TX between iterations.

---

### `www/tests/input/ime-composition.spec.js` (test — NEW)

**Analog:** `www/tests/render/bell.spec.js:29-54` (custom event synthesis via `page.evaluate` + `dispatchEvent(new Event(...))` because there is no built-in Playwright shortcut for the target event — parallels the RESEARCH §Open-Question about Playwright not driving CompositionEvent directly).

**Event synthesis + state assertion** (`www/tests/render/bell.spec.js:29-54`):
```javascript
await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
});

await page.locator('#debug').evaluate((el) => { el.open = true; });
await page.fill('#input', '\\x07');
await page.click('#feed');
await page.waitForTimeout(100);

await expect(page).toHaveTitle('(!) BestialiTTY');
```
**Copy pattern:** Dispatch three events in `page.evaluate`: `new CompositionEvent('compositionstart', { data: '' })`, `new CompositionEvent('compositionupdate', { data: 'a' })`, `new CompositionEvent('compositionend', { data: 'a' })` — each targeted at `#terminal-wrapper`. Assert `#tx-strip` shows ONE `61` (single 'a' byte), not two (guards against the double-emit bug SC-5 exists to prevent). If the synthetic CompositionEvent path turns out not to drive Chromium's internal `isComposing` flag (RESEARCH Open Question 1), gate this spec with `test.skip()` and document in a sibling UAT checklist — matches Phase 3's precedent of manual UAT gaps.

---

### `www/tests/input/focus-retention.spec.js` (test — NEW)

**Analog:** `www/tests/render/focus.spec.js` (exact role match — focus assertion across click/keyboard events).

**Click-then-assert-focus pattern** (from RESEARCH §Focus retention, lines 921-935):
```javascript
test('Clicking theme button keeps focus on terminal wrapper', async ({ page }) => {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await expect(page.locator('#terminal-wrapper')).toBeFocused();

    await page.locator('#theme-toggle').click();

    await expect(page.locator('#terminal-wrapper')).toBeFocused();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'clean');
});
```
**Copy pattern:** One test per clickable control (theme button, each phosphor button, local-echo checkbox, each CR/LF radio, Reset TX button). For checkboxes/radios also assert the native toggle/check still happened (because D-16 Settings-pane wiring explicitly restores the toggle after preventDefault). Use `.click()` (mouse path) for the preventDefault assertion; add a parallel "Tab-to + Space" test per UI-SPEC §Interaction Contracts to verify keyboard activation still toggles state.

**Existing focus-attribute assertion** (`www/tests/render/focus.spec.js:22-32`):
```javascript
await wrapper.focus();
await page.waitForTimeout(50);
await expect(wrapper).toHaveAttribute('data-focused', 'true');
const focused = await wrapper.evaluate((el) => ({
    border: getComputedStyle(el).borderColor,
    width: el.offsetWidth,
    height: el.offsetHeight,
}));
expect(focused.border).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
```
**Copy pattern:** Reuse `toHaveAttribute('data-focused', 'true')` as the canonical focus check (Phase 3's gap-#7 contract — SC-5 MUST preserve it).

---

### `www/tests/input/tx-debug-strip.spec.js` (test — NEW)

**Analog:** `www/tests/render/keyboard.spec.js` setup + `www/tests/render/focus.spec.js:35-38` Debug-pane opening.

**Debug-pane-open + text-readout pattern** (`www/tests/render/focus.spec.js:35-38`):
```javascript
await page.locator('#debug').evaluate((el) => { el.open = true; });
await page.focus('#input');
```
**Copy pattern:** Open `#debug` via `.evaluate((el) => { el.open = true; })` (NOT `.click()` on summary — D-13 keeps the pane default-collapsed and we want a deterministic open). Assert initial `#tx-strip` text matches the UI-SPEC placeholder `(none yet — press any key on the terminal to see TX bytes)`; press a key; assert it updates; press Reset TX; assert placeholder returns.

---

### `www/main.js` (modified — import + call)

**Analog:** The existing `wireChrome` import + call site in the same file.

**Import pattern** (`www/main.js:14-28`):
```javascript
import init, { Terminal, encode_key_raw } from './pkg/bestialitty_core.js';
import {
    bootRenderer,
    requestFrame,
    setTheme,
    ...
    triggerBellFlash,
} from './renderer/canvas.js';
import { wireChrome } from './renderer/chrome.js';
```
**Copy pattern:** Add `import { wireKeyboard } from './input/keyboard.js';` and `import { pushTxBytes, formatHexStrip, registerTxObserver, resetTx } from './input/tx-sink.js';` (or re-export from keyboard.js and only import from there — planner's discretion, but two-file import matches the existing chrome+canvas split).

**Wiring call site** (`www/main.js:41-46`):
```javascript
const terminalWrapper = document.getElementById('terminal-wrapper');
const themeButton     = document.getElementById('theme-toggle');
const phosphorGroup   = document.getElementById('phosphor-group');
const phosphorButtons = phosphorGroup.querySelectorAll('button[data-phosphor]');
const bellOverlay     = document.getElementById('bell-overlay');
wireChrome({ terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay });
```
**Copy pattern:** Immediately AFTER `wireChrome({...})`, resolve the new DOM refs and call `wireKeyboard({ term, wasm, terminalWrapper, localEchoCheckbox, crlfRadios, txStrip, txResetButton, sampleBell, drainHostReply, requestFrame });` — Phase 4 listener attaches second so D-01 `e.defaultPrevented` short-circuit works without any explicit ordering flag. The same block also calls `registerTxObserver(() => { txStrip.textContent = formatHexStrip(64) || PLACEHOLDER; });` and wires the Reset TX button's `click` to `resetTx()`.

**Replace the smoke-log call** (`www/main.js:34-36`):
```javascript
// Smoke-exercise encode_key_raw so the export isn't dead-stripped; Phase 4 uses it.
const upEnc = encode_key_raw(1 /* tag=ArrowUp */, 0 /* no mods */);
console.log('[boot] encode_key_raw(ArrowUp, none) =', Array.from(upEnc));  // [27, 65]
```
**Copy pattern:** Delete the smoke log lines (the real keydown path exercises the export now). Keep the `encode_key_raw` import — `keyboard.js` re-imports it from `./pkg/bestialitty_core.js`.

---

### `www/renderer/chrome.js` (modified — add mousedown preventDefault)

**Analog:** The existing `themeButton.addEventListener('click', ...)` block in the same file.

**Existing click wiring** (`www/renderer/chrome.js:60-73`):
```javascript
// ==== Theme toggle button (click) ====
themeButton.addEventListener('click', () => {
    toggleTheme(ctx);
});

// ==== Phosphor radio-group (click) ====
for (const btn of phosphorButtons) {
    btn.addEventListener('click', () => {
        const color = btn.dataset.phosphor;
        if (color !== 'green' && color !== 'amber' && color !== 'white') return;
        setPhosphor(color);
        applyPhosphorSideEffects(color, phosphorButtons);
    });
}
```
**Copy pattern:** Add a `mousedown` listener IMMEDIATELY alongside each existing `click` listener, doing ONLY `e.preventDefault()`:
```javascript
themeButton.addEventListener('mousedown', (e) => { e.preventDefault(); });
for (const btn of phosphorButtons) {
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
}
```
Do NOT fold the mousedown logic into the click handler — `click` fires on keyboard activation too, where preventDefault would NOT suppress the click's action but WOULD be a no-op that reads oddly. Separate listeners make the intent obvious.

**No changes to the existing keydown chord block** — Phase 4's listener attaches separately in `keyboard.js`.

---

### `www/index.html` (modified — Settings pane + TX strip additions)

**Analog:** The existing `<details id="debug">` block + its `#debug` CSS rule (lines 133-165 and 187-201). D-13 explicitly says "mirrors the existing Debug pane's styling verbatim".

**Existing Debug CSS rule block** (`www/index.html:133-165`):
```css
/* ==== Debug details (D-15) ==== */
#debug {
    margin: 16px auto; max-width: 90ch;
    padding: 8px 16px;
    background: var(--chrome-bg);
    border: 1px solid var(--chrome-border);
    font-size: 12px;
}
#debug summary {
    cursor: pointer; font-size: 14px;
    padding: 4px 0;
}
#debug textarea { ... }
#debug button {
    font-family: inherit; font-size: 12px;
    padding: 4px 8px; margin-right: 8px; margin-top: 4px;
    background: transparent;
    color: var(--chrome-fg);
    border: 1px solid var(--chrome-border);
    cursor: pointer;
}
#debug .hint {
    color: rgba(255,255,255,0.6);
    font-size: 12px;
    margin: 4px 0;
}
```
**Copy pattern:** Paste as a new `#settings` rule block (UI-SPEC §CSS additions gives the exact text). Also reuse `.hint` styling verbatim — UI-SPEC confirms it's inherited from the existing rule at line 160.

**Existing Debug DOM block** (`www/index.html:187-201`):
```html
<details id="debug">
    <summary>Debug</summary>
    <p class="hint">...</p>
    <textarea id="input" rows="4" placeholder="..."></textarea>
    <div>
        <button id="feed" type="button">Feed</button>
        <button id="stress64k" type="button">64 KB Stress</button>
    </div>
</details>
```
**Copy pattern:** Settings pane (new `<details id="settings">`) follows the same outer shape: `<summary>Settings</summary>` then hint paragraphs and form controls. Exact inner markup is locked in UI-SPEC §Layout Contract; copy verbatim. For Debug additions: append the hint + `<pre id="tx-strip">` + `<button id="tx-reset">` immediately after the existing `#stress64k` button's wrapping `<div>` (UI-SPEC pins the insertion point).

**Default theme boot attribute** (`www/index.html:168`): `<body data-theme="crt">` — unchanged; Phase 4 does not touch theme defaults.

---

### `www/playwright.config.js` (modified — extend test discovery)

**Analog:** Self (the existing `testDir: './tests/render'` line).

**Existing test-discovery config** (`www/playwright.config.js:5-10`):
```javascript
export default defineConfig({
    testDir: './tests/render',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
```
**Copy pattern:** Replace `testDir: './tests/render'` with `testDir: './tests'` and add `testMatch: ['**/render/*.spec.js', '**/input/*.spec.js']` (or a simpler `testMatch: '**/*.spec.js'` if the planner prefers) so both directories run under `npx playwright test`. Leave `webServer`, `projects`, `expect.toHaveScreenshot`, and `deviceScaleFactor: 2` untouched — HiDPI contract carries over, and Phase 4 inherits the 1% pixel-diff tolerance for any future visual regressions.

---

## Shared Patterns

### Synchronous preventDefault on keydown

**Source:** `www/renderer/chrome.js:87` (`e.preventDefault();` on the first line of each matched chord branch — BEFORE any work).
**Apply to:** Every forwarded-key branch in `keyboard.js` (D-02). NEVER behind an `await`; NEVER after a conditional that may fall through to the browser.
```javascript
if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyT') {
    e.preventDefault();          // SYNCHRONOUS first — RESEARCH Pitfall #3.
    toggleTheme(ctx);
    return;
}
```

### Focus retention via `[data-focused]` attribute (NOT `:focus-visible`)

**Source:** `www/renderer/chrome.js:115-123` and the matching CSS in `www/index.html:103-106`.
```javascript
terminalWrapper.addEventListener('focus', () => {
    terminalWrapper.setAttribute('data-focused', 'true');
    setFocus(true);
});
terminalWrapper.addEventListener('blur', () => {
    terminalWrapper.setAttribute('data-focused', 'false');
    setFocus(false);
});
```
**Apply to:** Every focus-affecting test. Do NOT assert against `:focus-visible` — Phase 3 gap #7 locks the attribute selector. Phase 4's `mousedown` preventDefault preserves this contract because focus never leaves the wrapper in the first place.

### Module-scope cached typed-array view with identity guard

**Source:** `www/main.js:100-109` + `www/renderer/canvas.js:37-51`.
**Apply to:** Any place in `keyboard.js` or `tx-sink.js` that reads across the `wasm.memory.buffer` boundary (notably the local-echo path that calls `drainHostReply`). For the TX ring buffer itself, note in a comment that the ring is JS-owned (`new Uint8Array(1024)` — heap-allocated, no wasm backing) so no identity guard is needed; Phase 5's swap to Web Serial keeps the JS-owned allocation.

### `<details>`-pane disclosure (Phase 3 D-15)

**Source:** `www/index.html:187-201` + matching CSS at lines 133-165.
**Apply to:** The new `<details id="settings">` (D-13) and the nested `<details class="reserved">` (D-14). Default-collapsed; mirror CSS exactly (UI-SPEC §CSS additions). Tests open panes via `.evaluate((el) => { el.open = true; })` (see `www/tests/render/focus.spec.js:35`).

### Synchronous bell sampling after every `term.feed()`

**Source:** `www/main.js:128-137` (`sampleBell()`).
**Apply to:** Phase 4 local-echo fork — any time `keyboard.js` calls `term.feed(bytes)` after `encode_key_raw` returns, it MUST invoke `sampleBell()` BEFORE `drainHostReply()` BEFORE `requestFrame()`. Pass these three helpers in via `wireKeyboard({ sampleBell, drainHostReply, requestFrame, ... })` rather than re-importing, because they close over `term` already and hoisting them out of `main.js` would widen the keyboard module's surface.

### Observer / listener registration without off-deregister

**Source:** `www/renderer/canvas.js:418-427` (bell overlay — single fixed consumer, no removal API).
**Apply to:** `tx-sink.js` `registerTxObserver(fn)` — push onto array, never remove. Module lifetime == observer lifetime. Phase 5 may add removal semantics if the Web Serial writer needs them, but Phase 4 doesn't.

### Playwright test file header + describe-per-requirement

**Source:** `www/tests/render/*.spec.js` top-of-file convention:
```javascript
// Phase 3 Plan 04 — RENDER-XX — <req summary>.
// <one-line description of what this file asserts>.
import { test, expect } from '@playwright/test';

test.describe('RENDER-XX — <req summary>', () => {
    ...
});
```
**Apply to:** Every new spec in `www/tests/input/`. Use `// Phase 4 Plan NN — INPUT-XX — <req>` and `test.describe('INPUT-XX — <req>', () => {...})`. Tag short tests with `@fast` so they run under `npm run test:fast`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every file in Phase 4 has a strong in-tree analog. The two "new" surfaces (TX ring buffer and IME composition listener) each map to an adequate pattern: tx-sink pairs the module-scope Uint8Array pattern from `main.js:100-109` with the observer shape from `canvas.js:418-427`; the IME spec borrows the synthetic-event dispatch pattern from `bell.spec.js:29-54` (with the caveat, tagged in RESEARCH Open Question 1, that Playwright may not drive CompositionEvent cleanly — planner may skip the automated IME assertion and punt to manual UAT, matching Phase 3's precedent for UAT-only gaps). |

---

## Metadata

**Analog search scope:** `www/` (excluding `www/node_modules/`, `www/pkg/`, `www/test-results/`). Specifically read: `www/main.js`, `www/renderer/chrome.js`, `www/renderer/canvas.js`, `www/renderer/atlas.js`, `www/renderer/themes.js`, `www/index.html`, `www/playwright.config.js`, and every `www/tests/render/*.spec.js` file (bell, focus, keyboard, theme-toggle, phosphor, zoom, cursor).

**Files scanned:** ~15 source files + 9 spec files.

**Pattern extraction date:** 2026-04-22.

---

## PATTERN MAPPING COMPLETE

**Phase:** 4 - Keyboard Input
**Files classified:** 14 (2 new JS modules + 8 new Playwright specs + 4 modified existing files)
**Analogs found:** 14 / 14

### Coverage

- Files with exact analog: 11 (`keyboard.js`, all 3 keydown specs, crlf-override spec, focus-retention spec, main.js, chrome.js, index.html, playwright.config.js, tx-debug-strip spec — chrome.js and the render keyboard spec are one-to-one parents)
- Files with role-match analog: 3 (`tx-sink.js`, local-echo spec, ime-composition spec — role match without an exact parent)
- Files with no analog: 0

### Key Patterns Identified

- **Wire-function entry shape** (`wireChrome(opts)` → `wireKeyboard(opts)`): every DOM-event module in this repo exports a single `wireX(opts)` taking destructured DOM refs + wasm + term handles; module-scope `let` state flipped via exported setters (`setTheme`, `setPhosphor`, `setFocus` → `setLocalEcho`, `setCrlfMode`).
- **Synchronous preventDefault first, action second** (`chrome.js:87`): every forwarded-key branch calls `e.preventDefault()` on its own line BEFORE any work — honours RESEARCH Pitfall #3 and is the template Phase 4 copies for every Ctrl-letter / arrow / Enter branch.
- **Module-scope cached typed-array views with lazy re-derive** (`main.js:100-109` + `canvas.js:37-51`): the zero-copy view pattern. `tx-sink.js` applies the JS-owned variant (no identity guard; ring is heap-allocated); the local-echo path applies the wasm-backed variant (identity guard against `wasm.memory.buffer`).
- **`[data-focused]` attribute indicator** (`chrome.js:115-123` + `index.html:103-106`): Phase 3 gap-#7 contract — Phase 4 tests MUST assert against this attribute, not `:focus-visible`, and MUST NOT change the focus/blur listeners.
- **`<details>` pane mirroring** (`index.html:133-165` + `187-201`): Debug pane is the template; Settings pane is a verbatim CSS+markup copy with different IDs and inner content (D-13 / D-14 / UI-SPEC §CSS additions pin the exact text).
- **`sampleBell` → `drainHostReply` → `requestFrame` sequence** (`main.js:140-147`): the canonical post-`term.feed()` chain; local-echo MUST copy it verbatim to keep bell semantics and host-reply drains correct.
- **Playwright setup boilerplate** (`tests/render/keyboard.spec.js` + `focus.spec.js`): `page.goto('/')` → `#terminal-wrapper.focus()` → (optional) `#debug.open = true` → `page.keyboard.press(...)` → `expect(locator).toHaveText/toHaveAttribute(...)`; every Phase 4 spec follows this five-line setup.
- **3-way radio/button-group exclusivity tests** (`phosphor.spec.js`): the template for `crlf-override.spec.js` — `aria-pressed` / `.checked` loop + per-choice downstream assertion.

### File Created

`.planning/phases/04-keyboard-input/04-PATTERNS.md`

### Ready for Planning

Pattern mapping complete. Planner can now reference analog patterns directly in PLAN.md files — every new file has a concrete excerpt with line numbers to copy from.
