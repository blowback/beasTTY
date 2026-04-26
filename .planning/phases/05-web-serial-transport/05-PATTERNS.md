# Phase 5: Web Serial Transport — Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 17 (2 new modules, 1 new mock fixture, 7 new Playwright specs, 5 modified files, 1 config extend, 1 new UAT doc, `www/transport/` dir create)
**Analogs found:** 17 / 17 (every file has a strong in-codebase analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `www/transport/serial.js` | new module (wireX-style subsystem) | streaming + event-driven + CRUD (localStorage) | `www/renderer/chrome.js` (wireX opts shape) + `www/renderer/canvas.js` (module-scope state, boot helper, zero-copy discipline) | exact role-match |
| `www/input/paste-pump.js` | new module (timer-driven chunker + observer) | batch streaming (setTimeout chain) | `www/input/tx-sink.js` (module-scope buffer + observer fan-out + public-API shape) | exact role-match |
| `www/tests/transport/mock-serial.js` | new test fixture (init-script stub) | inline JS string passed to `page.addInitScript` | `www/tests/input/*.spec.js` `setup(page)` helpers + `render/bell.spec.js` `page.evaluate(() => Object.defineProperty(...))` stub style | role-match (no previous init-script fixture exists) |
| `www/tests/transport/connect.spec.js` | new Playwright spec | request-response (test harness) | `www/tests/input/crlf-override.spec.js` (setup helper + describe block + `#debug.open = true` + `#tx-strip` asserts) | exact |
| `www/tests/transport/reconnect.spec.js` | new Playwright spec | event-driven (simulated unplug/replug) | `www/tests/render/bell.spec.js` (document-property stub + `dispatchEvent` + title assertion pattern) | exact |
| `www/tests/transport/config.spec.js` | new Playwright spec | form-value CRUD (reset button behaviour) | `www/tests/input/crlf-override.spec.js` (radio exclusivity asserts + default-state asserts) | exact |
| `www/tests/transport/paste.spec.js` | new Playwright spec | timing assertion + progress observer | `www/tests/input/local-echo.spec.js` (fill-then-trigger + waitForTimeout + grid-view assertion) | role-match |
| `www/tests/transport/errors.spec.js` | new Playwright spec | assertion over DOM side-effects (error log entries) | `www/tests/input/tx-debug-strip.spec.js` (text-content asserts on a `<pre>` region) | role-match |
| `www/tests/transport/polite-fail.spec.js` | new Playwright spec | DOM takeover detection | `www/tests/render/bell.spec.js` `page.evaluate` + `Object.defineProperty(document, 'hidden', …)` shim for pre-boot API stubbing | role-match |
| `www/tests/transport/readloop.spec.js` | new Playwright spec | streaming (simulated reader.push) | `www/tests/render/bell.spec.js` (visibility-hidden stub → feed-then-assert pattern) | role-match |
| `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` | manual UAT checklist (Markdown) | test plan | `.planning/phases/04-keyboard-input/04-HUMAN-UAT.md` (front-matter + Tests + Summary + Gaps sections) | exact |
| `www/input/tx-sink.js` (modify) | module extension (add `registerWriter` + writer.write on push) | CRUD extension | self (same file — body-level extension per 05-RESEARCH Example 2) | exact (self) |
| `www/input/keyboard.js` (modify) | event-handler branch insert | event-driven | self — the existing `terminalWrapper.addEventListener('keydown', …)` (lines 165-184) | exact (self) |
| `www/main.js` (modify) | boot driver (polite-fail gate + wireSerial call + DOM refs + observer registrations) | boot orchestration | self — existing `wireChrome({…})` call site (line 52) + `wireKeyboard({…})` call site (lines 169-175) + `registerTxObserver(…)` (lines 220-223) | exact (self) |
| `www/renderer/chrome.js` (modify) | one-line extension inside existing `visibilitychange` listener | event-driven | self — existing listener at lines 146-150 | exact (self) |
| `www/index.html` (modify) | DOM + CSS append (new button in `#top-bar`, new `<details id="connection">`, new Debug-pane button, new CSS block mirroring `#settings`) | static | self — existing `#top-bar` (lines 225-232), `#settings` (lines 242-262) + `#settings` CSS (lines 167-206), `#debug` (lines 265-282) | exact (self) |
| `www/playwright.config.js` (modify) | testMatch glob extension | config | self — `testMatch` array at line 7 | exact (self) |

---

## Pattern Assignments

### `www/transport/serial.js` (new module, streaming + event-driven)

**Primary analog:** `www/renderer/chrome.js` (entire file — the canonical `wireX(opts)` subsystem pattern).
**Secondary analog:** `www/renderer/canvas.js` lines 37-80 (module-scope state + zero-copy discipline + rebuild-on-identity-change).

**Imports pattern** — mirror `chrome.js` lines 13-21 import block; add `registerWriter` from tx-sink per 05-RESEARCH Example 1 (line 1010):

```js
// Header banner matching chrome.js lines 1-11 (phase/source/responsibility preamble)
// BestialiTTY Phase 5 — Web Serial transport (JS-only; no Rust bindings).
//
// Public API: renderPoliteFail, wireSerial, connectMicroBeast, disconnect,
// getState, onStateChange, getWriter.
//
// Source: 05-CONTEXT.md D-01..D-42; 05-RESEARCH.md Patterns 1-7; Pitfalls 1/10/11/12.

import { registerWriter } from '../input/tx-sink.js';
import { onPortLost as pastePumpOnPortLost } from '../input/paste-pump.js';
```

**`wireX(opts)` entry pattern** — exact copy of `chrome.js` lines 52-57 (destructure + ctx stash + wire):

```js
// chrome.js:52-57 — verbatim analog for wireSerial signature.
export function wireChrome(opts) {
    const { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay } = opts;
    const ctx = { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay };
    // Initial paint of chrome side-effects (reflects canvas.js default state).
    applyThemeSideEffects(getActiveTheme().name, ctx);
    applyPhosphorSideEffects(getActivePhosphor(), phosphorButtons);
```

Phase 5 `wireSerial(opts)` mirrors this verbatim — destructure `{ term, sampleBell, drainHostReply, requestFrame, connectButton, connectionPane, errorLogEl, statusLineEl, pastePaneEls }`, stash injected deps in module-scope lets (as `canvas.js` does with `wasm`/`term` at lines 37-39), then wire listeners.

**Module-scope state + cached-view guard** — mirror `canvas.js` lines 37-51:

```js
// canvas.js:37-51
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

function reDeriveViews() {
    if (wasm.memory.buffer !== cachedBuffer) rebuildViews();
}
```

Phase 5 `serial.js` module-scope state: `port`, `reader`, `writer`, `state`, `lastConfig`, `lastPortRef`, `stateObservers`, `errorLog`. Module-scope assignment on wire — identical shape.

**Read-loop feed → bell → drain → frame invariant** — mirror `main.js` lines 236-244 (Feed button handler):

```js
// main.js:236-244 — post-feed invariant the read loop MUST preserve.
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);                       // ONE boundary call (Pitfall #1).
    sampleBell();                           // RENDER-11 — synchronous bell sampling (NOT from rAF).
    drainHostReply('feed');
    requestFrame();                         // wake renderer — Phase 3 replacement for refreshHarnessUI().
});
```

Executor's read loop inside `runReadLoop(port)` reuses this exact 4-line sequence (`term.feed(value); sampleBell(); drainHostReply('serial'); requestFrame();`) per 05-RESEARCH Pattern 2 and 05-CONTEXT D-35. The outer `while (port.readable)` wrap comes from 05-RESEARCH Pattern 2 (not present in any current analog — it is net-new, but shaped by `main.js` post-feed discipline).

**Host-reply drain helper** — mirror `main.js` lines 114-137 (re-derive-on-buffer-identity-change pattern):

```js
// main.js:114-137
const HOST_REPLY_VIEW_CAP = 8;
let hostReplyView = null;
let hostReplyBuffer = null;

function reDeriveHostReplyView() {
    if (wasm.memory.buffer !== hostReplyBuffer) {
        hostReplyView = new Uint8Array(wasm.memory.buffer, term.host_reply_ptr(), HOST_REPLY_VIEW_CAP);
        hostReplyBuffer = wasm.memory.buffer;
    }
}
reDeriveHostReplyView();

function drainHostReply(tag) {
    const replyLen = term.host_reply_len();
    if (replyLen > 0) {
        reDeriveHostReplyView();
        console.log(`[host_reply ${tag}]`, Array.from(hostReplyView.subarray(0, replyLen)));
        term.clear_host_reply();
    }
}
```

Phase 5 note: `serial.js` does NOT redefine `drainHostReply` — it receives `drainHostReply` as an injected dep via `wireSerial(opts)` (mirrors `keyboard.js` lines 128-140 which injects the same function). One definition in `main.js`, two consumers.

**State-machine + observer fan-out** — mirror `tx-sink.js` lines 21-22 + 50-52 + 63-65 (observer pattern):

```js
// tx-sink.js:21-22, 50-52, 63-65
const observers = [];
export function registerTxObserver(fn) {
    observers.push(fn);
}
function notify() {
    for (const fn of observers) fn();
}
```

Phase 5 `stateObservers` + `onStateChange(fn)` + `setState(s) { …; stateObservers.forEach(fn => fn(s)); }` use this exact shape (05-RESEARCH Pattern 5, lines 621-626 reproduce it verbatim).

**Listener on navigator.serial (not port instance)** — no in-codebase analog (new primitive); direct copy from 05-RESEARCH Pattern 6 (lines 637-641) and 05-RESEARCH Example 1 (lines 1033-1034). D-26 locks this choice.

**Cancel-before-close teardown** — no in-codebase analog (new primitive); direct copy from 05-RESEARCH Pattern 3 (lines 436-459). D-11 + D-30 + D-36 drive the ordering.

**Polite-fail renderer** — `renderPoliteFail()` replaces `document.body.innerHTML` before any wasm init. Verbatim shape from 05-RESEARCH Pattern 1 (lines 365-377) combined with 05-UI-SPEC §"Polite-fail page" copy (UI-SPEC lines 612-625) and CSS block in UI-SPEC lines 461-493. No in-codebase analog — this executes BEFORE `bootRenderer()` ever runs.

---

### `www/input/paste-pump.js` (new module, batch streaming)

**Primary analog:** `www/input/tx-sink.js` (entire file — module-scope buffer + observer fan-out + public-API export shape).
**Secondary analog:** `www/input/keyboard.js` lines 51-76 (module-scope setters/getters + injected deps pattern).

**Header banner** — mirror `tx-sink.js` lines 1-14 (phase/source/analog preamble):

```js
// tx-sink.js:1-14 — banner template verbatim.
// BestialiTTY Phase 4 Plan 02 — TX byte ring buffer + observer fan-out.
// …
// Sources:
//   - 04-CONTEXT.md D-07 (ring shape + public API).
//   - 04-UI-SPEC.md §"Format of TX hex strip content" (…).
//   - Analog: www/renderer/canvas.js:37-51 (module-scope typed array) + …
```

Phase 5 paste-pump banner: sources = 05-CONTEXT D-12..D-23, 05-RESEARCH Pattern 4; analog = `tx-sink.js`.

**Module-scope state block** — mirror `tx-sink.js` lines 16-21:

```js
// tx-sink.js:16-21
const RING_CAP = 1024;
const ring = new Uint8Array(RING_CAP);
let writeIdx = 0;
let wrapped = false;

const observers = [];
```

Phase 5 paste-pump state: `CHUNK_SIZE = 32` (const), `gapMs` (let — recomputed per baud), `queue = new Uint8Array(0)` (let), `cursor = 0`, `timer = null`, `pendingKeypresses = []`, `progressObservers = []`. Same shape: module-scope lets above the public API, `const`s for compile-in knobs.

**Public API export shape** — mirror `tx-sink.js` lines 25-59 (grouped exports for push/format/observer/reset):

```js
// tx-sink.js:25-59 — the 4 public exports.
export function pushTxBytes(bytes) { … }
export function formatHexStrip(limit = 64) { … }
export function registerTxObserver(fn) { observers.push(fn); }
export function resetTx() { … }
```

Phase 5 paste-pump public API: `enqueuePaste(bytes)`, `cancelPaste()`, `isActive()`, `onProgress(fn)`, `onPortLost()`. Same public-first arrangement; internals (`writeOneChunk`, `flushPendingKeypresses`, `fireProgress`) go below a `// --- Internals ---` section marker matching `tx-sink.js` line 61.

**Observer fan-out (`fireProgress`)** — mirror `tx-sink.js` lines 63-65:

```js
// tx-sink.js:63-65
function notify() {
    for (const fn of observers) fn();
}
```

Phase 5 equivalent:
```js
function fireProgress(status, extra = {}) {
    for (const fn of progressObservers) fn({ status, ...extra });
}
```

**Injected deps via wire-style helper** — mirror `keyboard.js` lines 59-65 (`termRef`/`sampleBellFn`/`drainHostReplyFn`/`requestFrameFn`) + lines 128-140 (assignment in `wireKeyboard`):

```js
// keyboard.js:59-65
let termRef = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;
```

Phase 5 paste-pump needs: `termRef` (for D-22 local-echo), `sampleBellFn`, `drainHostReplyFn`, `requestFrameFn`, `getLocalEchoFn`, `getCrlfModeFn`, `pushTxBytesFn` (or direct import from tx-sink). Planner may expose `wirePastePump(opts)` OR inline-import from tx-sink + keyboard (keyboard already owns `getLocalEcho`/`getCrlfMode` getters at lines 69-76). **Recommend:** direct imports from tx-sink (`pushTxBytes`) and keyboard (`getLocalEcho`, `getCrlfMode`) — avoids a wire step for a module with no DOM.

**setTimeout-chain pump body** — no pre-existing analog; direct copy from 05-RESEARCH Pattern 4 Example (lines 539-569). Invariants to preserve per D-14/D-19/D-22:
1. `timer = null` at entry (so cancel-during-write is safe)
2. `pushTxBytes(chunk)` is the write call (D-21 single coupling point)
3. Local-echo feed + sampleBell + drainHostReply + requestFrame happens AFTER `pushTxBytes` when `getLocalEcho()` is true (D-22, identical 4-line sequence as in `main.js` Feed button lines 240-243)
4. `flushPendingKeypresses()` runs BEFORE scheduling next chunk (D-19)
5. `setTimeout(writeOneChunk, gapMs)` — self-scheduling chain (Pitfall 6)

**CR/LF rewrite before enqueue** — D-23 + 05-RESEARCH Example 4 Example lines 497-505. Implementation draws on `keyboard.js` lines 189-195 (the existing `forwardBytes` CR/LF rewrite for Enter keypresses):

```js
// keyboard.js:189-195 — existing Enter CR/LF rewrite logic.
function forwardBytes(bytes, wasEnter) {
    let outBytes = bytes;
    if (wasEnter && bytes.length === 1 && bytes[0] === 0x0D && crlfMode !== 'cr') {
        outBytes = CRLF_MODES[crlfMode];
    }
    pushTxBytes(outBytes);
    // …
}
```

Paste-pump `applyCrlfRewrite(bytes)` is stream-scale (iterate every 0x0D in `bytes`, expand per mode), not single-keypress-scale; but the `CRLF_MODES` frozen table (keyboard.js lines 45-49) SHOULD be shared via export from keyboard.js or duplicated carefully — planner picks. Recommendation: export `CRLF_MODES` + `getCrlfMode` from keyboard.js and import in paste-pump.

---

### `www/tests/transport/mock-serial.js` (new test fixture)

**Primary analog:** Playwright init-script usage is new; no Phase 4 file used `page.addInitScript`. **Shape of the mock** itself mirrors the existing stub style in `www/tests/render/bell.spec.js` lines 30-34 (inline `Object.defineProperty` on a read-only browser property):

```js
// bell.spec.js:30-34 — pre-boot property override pattern.
await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
});
```

Phase 5 mock uses `Object.defineProperty(navigator, 'serial', { value: serial, configurable: true })` inside `addInitScript` (runs BEFORE `main.js` boots, unlike `page.evaluate` which runs after). Direct copy from 05-RESEARCH Pattern 7 Example lines 704-803. No codebase analog for the full mock class hierarchy (MockReader / MockWriter / MockSerialPort / MockSerial) — it is net-new infrastructure.

**Export shape** — `export const SERIAL_MOCK = \`…\`` (backtick string passed to `page.addInitScript(SERIAL_MOCK)`) per 05-RESEARCH Pattern 7 lines 704 + 813-815. No codebase precedent. Planner files this at `www/tests/transport/mock-serial.js` next to the specs that consume it.

**Test hook exposure** — `window.__simulateUnplug`, `window.__simulateReplug`, `window.__mockReaderPush`, `window.__mockWriterLog` mirror the existing `window.__testGridView` pattern at `main.js` line 60:

```js
// main.js:60-64 — unconditional window.__ test hook pattern.
window.__testGridView = () => new Uint8Array(
    wasm.memory.buffer,
    term.grid_ptr(),
    term.grid_byte_len(),
);
```

Comment block at `main.js` lines 55-59 justifies the unconditional `window.__`-prefix convention ("Phase 4 has zero security surface … Phase 5 Web Serial will gate differently if needed"). Phase 5 mock hooks live on `window.__mock*` / `window.__simulate*` — the `__`-prefix + same-origin boundary is the existing convention.

---

### Playwright Spec Files (7 files — shared structure)

**All of:** `connect.spec.js`, `reconnect.spec.js`, `config.spec.js`, `paste.spec.js`, `errors.spec.js`, `polite-fail.spec.js`, `readloop.spec.js`.

**Primary analog:** `www/tests/input/crlf-override.spec.js` (most direct structural analog — setup helper + describe + default-state assert + value-change assert + exclusivity assert).

**Standard test-file header + imports** — verbatim from `crlf-override.spec.js` lines 1-2:

```js
// crlf-override.spec.js:1-2
// Phase 4 Plan 04 — INPUT-05 — CR/LF override alters Enter TX bytes.
import { test, expect } from '@playwright/test';
```

Phase 5 spec header template: `// Phase 5 Plan NN — {REQ-ID} — {short description}.` Then `import { test, expect } from '@playwright/test';` and (mock-consumers only) `import { SERIAL_MOCK } from './mock-serial.js';`.

**Setup helper function** — verbatim from `crlf-override.spec.js` lines 4-11:

```js
// crlf-override.spec.js:4-11
async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}
```

Phase 5 transport setup wraps `page.addInitScript(SERIAL_MOCK)` BEFORE `page.goto('/')` (per 05-RESEARCH Pattern 7 spec-usage example lines 813-816). Expand canvas-ready wait to include connection-pane if the spec needs it (`await page.locator('#connection').evaluate((el) => { el.open = true; });`).

**`test.describe` + `@fast`/`@slow` tag convention** — verbatim from `crlf-override.spec.js` lines 13-14 and `keydown-arrows.spec.js` line 13:

```js
// crlf-override.spec.js:13-14
test.describe('INPUT-05 — CR/LF override', () => {
    test('default CR mode: Enter sends 0x0D @fast', async ({ page }) => {
```

Phase 5 spec describe-block names: `test.describe('XPORT-01 — Connect to MicroBeast', …)` etc. `@fast` tag on sub-100ms tests (click + assert), `@slow` on timing tests (paste at 19200 baud ≈ 3s per 05-RESEARCH Example 5 line 1149).

**DOM state assertion** — verbatim from `crlf-override.spec.js` lines 17, 21-22, 41-45:

```js
// crlf-override.spec.js:17,21-22 — default-state + change + exclusivity asserts.
await expect(page.locator('#crlf-cr')).toBeChecked();
await page.keyboard.press('Enter');
await expect(page.locator('#tx-strip')).toHaveText('0D');

// crlf-override.spec.js:41-45
await page.locator('#crlf-lf').check();
await expect(page.locator('#crlf-lf')).toBeChecked();
await expect(page.locator('#crlf-cr')).not.toBeChecked();
```

Phase 5 `config.spec.js` asserts against `#serial-baud`, `#serial-databits`, etc. using `toHaveValue('19200')` / `toBeChecked()` as appropriate. Reset-button behaviour mirrors crlf-override.spec `toBeChecked()` exclusivity asserts.

**`@fast`-tagged simple click-and-assert** — verbatim shape from `keydown-arrows.spec.js` lines 13-17:

```js
// keydown-arrows.spec.js:13-17
test('ArrowUp pushes 0x1B 0x41 @fast', async ({ page }) => {
    await setup(page);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#tx-strip')).toHaveText('1B 41');
});
```

Phase 5 `connect.spec.js` `@fast` test:
```js
test('click Connect opens port with 19200 8N1 no flow-control @fast', async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
    // …
});
```
Direct from 05-RESEARCH Pattern 7 spec example lines 818-831.

**Simulated-event-dispatch + state-after assert** — verbatim shape from `render/bell.spec.js` lines 30-44 (document.hidden shim + visibilitychange dispatch + title assertion):

```js
// render/bell.spec.js:30-44
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

Phase 5 `reconnect.spec.js` adapts this to:
```js
await page.evaluate(() => window.__simulateUnplug());
await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'port-lost');
await page.evaluate(() => window.__simulateReplug());
await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
```
Hook names (`__simulateUnplug`/`__simulateReplug`) come from the mock (per D-42 + 05-RESEARCH Pattern 7 lines 767-790).

**Timing tolerance assertion** — new pattern for Phase 5 (no codebase analog); verbatim from 05-RESEARCH Example 5 lines 1149-1179. D-41 locks the tolerance discipline (`>= 0.95 * expectedMs`, no fake timers).

**`page.evaluate()` for deep state inspection** — verbatim from `local-echo.spec.js` lines 24-25:

```js
// local-echo.spec.js:24-25
const before = await page.evaluate(() => window.__testGridView()[0]);
// …
const after = await page.evaluate(() => window.__testGridView()[0]);
```

Phase 5 `connect.spec.js` inspects `_grantedPorts[0]._config` via `page.evaluate(() => navigator.serial._grantedPorts[0]._config)` per 05-RESEARCH Pattern 7 line 824. Same `page.evaluate(fn)` → JSON-serialisable-return shape.

**Per-spec REQ-ID mapping** (planner uses this to fill the describe-block label + ensure every requirement has a spec):

| Spec file | `describe` label | Coverage |
|-----------|-----------------|----------|
| `connect.spec.js` | `Connect to MicroBeast — XPORT-01..04 + PLAT-05 + SC-1` | first-time requestPort + open + DTR/RTS assert + VID/PID persist |
| `reconnect.spec.js` | `Reconnect lifecycle — XPORT-06..08, XPORT-10, SC-3` | unplug → port-lost state; replug → auto-reopen; 500ms retry; reload with granted port (no auto-open) |
| `config.spec.js` | `Serial config — XPORT-05 + MicroBeast preset reset` | form defaults; change-then-connect; reset button snaps to preset |
| `paste.spec.js` | `Paste pump — XPORT-09` | progress events; Cancel button; Esc cancel (D-18); CR/LF rewrite on paste (D-23); keypress queue-jump (D-19); port-lost mid-paste (D-20) |
| `errors.spec.js` | `Error log & lifecycle paths` | error log renders last 5; permission revoked (D-28); port-in-use (D-29); DTR/RTS assertion check |
| `polite-fail.spec.js` | `Polite fail — PLAT-01, PLAT-02` | navigator.serial === undefined → body-swap + title + no canvas |
| `readloop.spec.js` | `Read loop — XPORT-11 + SC-5` | visibilitychange catch-up (D-39); read-error path (D-37); backgrounded-tab data survival |

---

### `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md`

**Primary analog:** `.planning/phases/04-keyboard-input/04-HUMAN-UAT.md` (verbatim front-matter + sections).

**Front-matter block** — verbatim from `04-HUMAN-UAT.md` lines 1-7:

```yaml
---
status: complete
phase: 04-keyboard-input
source: [04-VERIFICATION.md, 04-VALIDATION.md]
started: 2026-04-22
updated: 2026-04-22
---
```

Phase 5 version:
```yaml
---
status: draft
phase: 05-web-serial-transport
source: [05-VERIFICATION.md, 05-VALIDATION.md]
started: <date>
updated: <date>
---
```

**Section skeleton** — mirror lines 9-39 (Current Test, Tests, Summary, Gaps):

```markdown
## Current Test
[testing not yet started]

## Tests

### 1. Real MicroBeast connect + type commands
expected: Power the MicroBeast, plug USB-C, click Connect, pick CP2102N in native picker, Connection pane shows "MicroBeast (CP2102N 10c4:ea60) — 19200 8N1", border green. Type "HELP" and press Enter — MicroBeast responds. No boot banner.
result: pending
reason: (fill after test)

### 2. Unplug / replug survival
…
```

**Tests list** — Phase 5 adds one test row per 05-CONTEXT.md line 55-57 (real MicroBeast connect, unplug/replug, reload-with-granted-port, paste at 19200, polite fail in Firefox/Safari). Planner fills each row with expected/result fields.

---

### `www/input/tx-sink.js` (modified)

**Self-analog** — `tx-sink.js` lines 25-34 (existing `pushTxBytes` body).

**Extension pattern** — insert two new exports AFTER existing `resetTx` (around line 59):

```js
// NEW — Phase 5 D-21 extension (05-RESEARCH Example 2 lines 1069-1092).
let registeredWriter = null;

export function registerWriter(writer) { registeredWriter = writer; }
export function unregisterWriter()     { registeredWriter = null; }
```

Modify existing `pushTxBytes` body (lines 25-34) — keep signature, append writer.write call:

```js
export function pushTxBytes(bytes) {
    // ... existing ring-buffer append logic (lines 27-33) UNCHANGED ...
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
        ring[writeIdx] = bytes[i] & 0xFF;
        writeIdx = (writeIdx + 1) % RING_CAP;
        if (writeIdx === 0) wrapped = true;
    }
    notify();

    // NEW — D-21: if writer is registered, send bytes on the wire.
    if (registeredWriter) {
        registeredWriter.write(bytes).catch((err) => {
            console.error('[tx-sink] writer.write failed:', err);
        });
    }
}
```

Direct from 05-RESEARCH Example 2 lines 1074-1092. Signature preserved per 04-CONTEXT D-07.

---

### `www/input/keyboard.js` (modified)

**Self-analog** — `keyboard.js` lines 165-184 (existing `keydown` listener).

**Extension pattern** — add Esc-while-paste-active branch IMMEDIATELY AFTER the composition guard (line 171), BEFORE the `packKeyCode` call:

```js
// keyboard.js:165-184 — existing keydown, with the D-18 insertion point marked ▼
terminalWrapper.addEventListener('keydown', (e) => {
    // D-01 — skip chords already handled by chrome.js (e.g. Ctrl+Alt+T).
    if (e.defaultPrevented) return;

    // D-06 belt-and-braces — ignore during composition.
    if (isComposing || e.isComposing) return;

    // ▼ NEW — D-18 insertion: Esc-while-pump-active cancels paste; does NOT emit 0x1B.
    if (e.code === 'Escape' && pastePumpIsActive()) {
        e.preventDefault();
        cancelPaste();
        return;
    }
    // ▲ existing code below this line unchanged:
    const code = packKeyCode(e);
    if (code < 0) return;
    // …
});
```

New import at line 22 (next to existing `pushTxBytes` import):
```js
import { pushTxBytes } from './tx-sink.js';
import { isActive as pastePumpIsActive, cancelPaste } from './paste-pump.js';   // NEW
```

Direct from 05-RESEARCH Example 3 lines 1099-1116. Nothing else in keyboard.js changes — signature of `wireKeyboard(opts)` is preserved per 04-CONTEXT D-07.

---

### `www/main.js` (modified)

**Self-analog, 5 insertion points.**

**Insertion 1 — first-line polite-fail gate** (BEFORE existing import block line 16):

```js
// NEW — Phase 5 D-32/D-33 — polite-fail gate; MUST be the first executable line.
import { renderPoliteFail } from './transport/serial.js';
if (typeof navigator.serial === 'undefined') {
    renderPoliteFail();
    throw new Error('__polite-fail__');   // abort module execution; wasm never initialises
}
```

Direct from 05-RESEARCH Pattern 1 lines 347-354. The `throw` is the 05-RESEARCH-preferred abort (comment notes "or just let module execution stop naturally" — `throw` is more explicit).

**Insertion 2 — imports + DOM refs** (append to existing import block ~line 31 and DOM query block ~line 50):

```js
// NEW imports
import { wireSerial } from './transport/serial.js';
import { enqueuePaste, onProgress as onPastePumpProgress } from './input/paste-pump.js';

// NEW DOM refs (mirror existing querySelector block at main.js:41-50)
const connectButton     = document.getElementById('connect-button');
const connectionPane    = document.getElementById('connection');
const portStatusEl      = document.getElementById('port-status');
const errorLogEl        = document.getElementById('error-log');
const pasteProgressRow  = document.getElementById('paste-progress-row');
const pasteProgressText = document.getElementById('paste-progress-text');
const pasteCancelBtn    = document.getElementById('paste-cancel');
const pasteTestBtn      = document.getElementById('paste-test');
// Serial-config form refs (D-08)
const serialBaud     = document.getElementById('serial-baud');
const serialDataBits = document.getElementById('serial-databits');
// … (5 selects + reset button)
```

**Insertion 3 — `wireSerial` call** (AFTER `wireKeyboard` block at lines 169-175 — same pattern, same opts shape):

Reference `main.js` lines 169-175:
```js
// main.js:169-175 — wireKeyboard call site, template for wireSerial.
wireKeyboard({
    term,
    terminalWrapper,
    sampleBell,
    drainHostReply,
    requestFrame,
});
```

Phase 5 adds:
```js
// NEW — Phase 5 wireSerial call; same opts-injection shape as wireKeyboard / wireChrome.
await wireSerial({
    term,
    sampleBell,
    drainHostReply,
    requestFrame,
    connectButton,
    connectionPane,
    portStatusEl,
    errorLogEl,
    // form refs for D-08:
    serialConfigEls: { baud: serialBaud, dataBits: serialDataBits, /* ... */ },
});
```

**Insertion 4 — paste-pump progress observer** (AFTER existing `registerTxObserver(…)` block at lines 220-223 — identical observer-registration pattern):

Reference `main.js` lines 220-223:
```js
// main.js:220-223 — registerTxObserver template for onPastePumpProgress.
registerTxObserver(() => {
    const hex = formatHexStrip(64);
    txStripEl.textContent = hex === '' ? TX_STRIP_PLACEHOLDER : hex;
});
```

Phase 5 adds (one observer registration mirroring shape):
```js
// NEW — D-17 paste progress observer.
onPastePumpProgress((ev) => {
    if (ev.status === 'started') {
        // D-17 auto-expand
        if (!connectionPane.open) { connectionPane.dataset.preExpansionOpen = 'false'; connectionPane.open = true; }
        pasteProgressRow.hidden = false;
    }
    if (ev.status === 'chunk') {
        const pct = Math.round(ev.written / ev.total * 100);
        pasteProgressText.textContent = `Pasting ${ev.total} B — ${pct}%`;
    }
    if (ev.status === 'complete') {
        pasteProgressText.textContent = 'Paste complete';
        setTimeout(() => { pasteProgressRow.hidden = true; restorePaneState(); }, 2000);
    }
    // ... cancelled, cancelled-port-lost cases per UI-SPEC copy
});
```

**Insertion 5 — Paste test button click handler** (AFTER existing Feed button handler at lines 237-244 — identical click-handler shape):

Reference `main.js` lines 237-244:
```js
// main.js:237-244 — Feed button handler, template for Paste test button.
document.getElementById('feed').addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    term.feed(bytes);
    sampleBell();
    drainHostReply('feed');
    requestFrame();
});
```

Phase 5 adds:
```js
// NEW — D-16 Paste test button; parses textarea via parseHexEscapes and routes through paste-pump.
pasteTestBtn.addEventListener('click', () => {
    const textarea = document.getElementById('input');
    const bytes = parseHexEscapes(textarea.value);
    enqueuePaste(bytes);
});
pasteTestBtn.addEventListener('mousedown', (e) => e.preventDefault()); // D-16 focus retention
```

**Insertion 6 — Connect button focus retention** (mousedown preventDefault; mirror existing pattern at `main.js` line 231-234 `txResetButton.addEventListener('mousedown', ...)`) — but connect-button click side of the handler lives INSIDE `wireSerial` (serial.js), not main.js. Only the mousedown-for-focus-retention lives here (or in serial.js — planner's choice; the Phase 4 precedent at main.js:231 puts it in main.js):

```js
// main.js:231-234 — tx-reset mousedown focus-retention template.
txResetButton.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resetTx();
});
```

Phase 5 may choose to put connect-button focus retention in serial.js with the rest of the button wiring, OR in main.js mirroring the Phase 4 pattern. Recommend: serial.js (keeps all button wiring co-located).

---

### `www/renderer/chrome.js` (modified)

**Self-analog** — `chrome.js` lines 146-150 (existing visibilitychange listener).

**Extension pattern** — one-line addition INSIDE the existing listener body:

```js
// chrome.js:146-150 — existing visibilitychange; Phase 5 adds line after the title-strip.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.title.startsWith('(!) ')) {
        document.title = document.title.slice(4);
    }
    // ▼ NEW — D-39: catch-up paint on foreground return (Pitfall #6 mitigation).
    if (!document.hidden) requestFrame();
});
```

`requestFrame` must be injected via `wireChrome(opts)` (currently not in the destructure at chrome.js line 53). Add it to the opts object here and to the `wireChrome(...)` call in main.js line 52. Direct from 05-RESEARCH Example 4 lines 1125-1134.

---

### `www/index.html` (modified)

**Self-analogs:**
- Top-bar button pattern — lines 225-232 (existing `<button id="theme-toggle">` + `#phosphor-group`)
- `<details>` pane pattern — lines 167-206 (existing `#settings` CSS block) and lines 242-262 (existing `#settings` DOM block)
- Debug button pattern — line 277 (existing `<button id="stress64k" type="button">`) and lines 152-159 (existing `#debug button` CSS)

**DOM insertion 1 — top-bar Connect button as first child** (reference lines 225-232, insert before `#theme-toggle`):

```html
<!-- index.html:225-232 — existing top-bar. Phase 5 prepends #connect-button. -->
<div id="top-bar">
    <!-- ▼ NEW -->
    <button id="connect-button" type="button" data-state="disconnected"
            title="Connect to MicroBeast over Web Serial">Connect</button>
    <!-- ▲ existing below -->
    <button id="theme-toggle" type="button" title="Toggle theme (Ctrl+Alt+T)">Clean</button>
    <div id="phosphor-group" role="radiogroup" aria-label="Phosphor color">…</div>
</div>
```

**DOM insertion 2 — `<details id="connection">` pane** (between `#top-bar` closing tag line 232 and `#terminal-wrapper` opening tag line 235; verbatim DOM from 05-UI-SPEC lines 270-330).

**DOM insertion 3 — Paste test button** (inside existing `<div>` at lines 275-278, after `#stress64k`):

```html
<!-- index.html:275-278 — existing Debug buttons. -->
<div>
    <button id="feed" type="button">Feed</button>
    <button id="stress64k" type="button">64 KB Stress</button>
    <button id="paste-test" type="button">Paste test</button>   <!-- NEW -->
</div>
```

**CSS insertion — mirror `#settings` block verbatim** (reference lines 167-206 of index.html):

```css
/* index.html:167-206 — existing #settings block; #connection mirrors 1:1. */
#settings {
    margin: 16px auto; max-width: 90ch;
    padding: 8px 16px;
    background: var(--chrome-bg);
    border: 1px solid var(--chrome-border);
    font-size: 12px;
}
#settings summary {
    cursor: pointer; font-size: 14px;
    padding: 4px 0;
}
/* … fieldset, legend, label, hint ... all mirror into #connection verbatim */
```

Executor swaps `#settings` → `#connection` in every selector to produce the new block (full CSS in 05-UI-SPEC lines 346-494). Phase 5 also appends the `#connect-button[data-state="..."]` selectors (UI-SPEC lines 347-363) and the `body.polite-fail` block (UI-SPEC lines 461-493) into the same `<style>` element.

---

### `www/playwright.config.js` (modified)

**Self-analog** — `playwright.config.js` line 7 (existing `testMatch` glob array).

**Extension pattern** — append one glob to the array:

```js
// playwright.config.js:7 — existing testMatch; Phase 5 appends tests/transport glob.
// BEFORE:
testMatch: ['**/render/*.spec.js', '**/input/*.spec.js'],
// AFTER:
testMatch: ['**/render/*.spec.js', '**/input/*.spec.js', '**/transport/*.spec.js'],
```

Nothing else changes in this file — `projects`, `webServer`, `expect` all work unchanged for Phase 5 specs.

---

## Shared Patterns

### Dependency Injection via `wireX(opts)` (Phase 3/4 convention — applies to serial.js)

**Source:** `www/renderer/chrome.js` lines 52-54 + `www/input/keyboard.js` lines 128-140.

**Apply to:** `www/transport/serial.js` — new `wireSerial(opts)` export.

```js
// chrome.js:52-54 + keyboard.js:128-140 — the canonical entry-point shape.
export function wireChrome(opts) {
    const { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay } = opts;
    // ...
}

export function wireKeyboard(opts) {
    const { term, terminalWrapper, sampleBell, drainHostReply, requestFrame } = opts;
    termRef = term;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
    // ...
}
```

**Rationale:** No circular imports (serial.js does not import from main.js); testable in isolation; explicit dependency surface; matches Phase 3+4 established convention.

---

### Module-Scope Observer Fan-Out (Phase 4 tx-sink convention — applies to serial.js stateObservers + paste-pump progress)

**Source:** `www/input/tx-sink.js` lines 21, 50-52, 63-65.

**Apply to:** serial.js `onStateChange` + paste-pump.js `onProgress`.

```js
// tx-sink.js:21,50-52,63-65 — canonical single-consumer observer pattern.
const observers = [];

export function registerTxObserver(fn) {
    observers.push(fn);
}

function notify() {
    for (const fn of observers) fn();
}
```

**Rationale:** One source of truth (module-scope state); many views subscribe; no DOM framework needed; Phase 4 D-15 commentary proved this shape daily-driver-stable.

---

### Focus Retention via mousedown preventDefault (Phase 4 D-16 — applies to every new button in Phase 5)

**Source:** `www/main.js` lines 231-234 (txResetButton) + `www/renderer/chrome.js` lines 70-72 (themeButton) + lines 82-84 (phosphor buttons).

**Apply to:** `#connect-button`, `#serial-reset-preset`, `#paste-cancel`, `#paste-test` — every new button in Phase 5.

```js
// main.js:231-234 + chrome.js:70-72 — the two existing invocations.
// main.js:231-234
txResetButton.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resetTx();
});

// chrome.js:70-72
themeButton.addEventListener('mousedown', (e) => {
    e.preventDefault();
});
```

**Rationale:** CONTEXT Phase 4 D-16 locks this for "click a control and keep typing" daily-driver feel. Phase 5 UI-SPEC Interaction Contracts line 573-578 re-affirms and extends to every new button (EXCEPT native `<select>` controls — those need the mousedown for dropdown open).

---

### Post-feed invariant (sampleBell → drainHostReply → requestFrame — applies to read loop and paste-pump local-echo)

**Source:** `www/main.js` lines 237-244 (Feed button) + lines 240-243 (canonical 4-call sequence).

**Apply to:**
1. serial.js read loop (after every `term.feed(value)`)
2. paste-pump.js local-echo path (after `term.feed(chunk)` in D-22)
3. keyboard.js existing local-echo path (already applies at lines 202-207 — unchanged by Phase 5)

```js
// main.js:240-243 — the 4-line sequence, CRITICAL invariant.
term.feed(bytes);
sampleBell();                // Phase 3 RENDER-11 — synchronous, NOT rAF-scheduled.
drainHostReply('feed');       // Phase 2 host-reply accessor drain.
requestFrame();               // Phase 3 dirty-repaint wake.
```

**Rationale:** Phase 3 Plan 03 established this sequence as load-bearing for BEL-while-hidden + host-reply + dirty-row repaint. Phase 5 D-35 + D-22 explicitly require preserving it at the two new `term.feed` call sites.

---

### Inline-hex-escape parsing for debug-pane paste source (Phase 2 utility — applies to Paste test button)

**Source:** `www/main.js` lines 68-95 (`parseHexEscapes` + `hexDigit` utilities).

**Apply to:** the Paste test button click handler — parses the `#input` textarea through the existing utility before enqueueing.

```js
// main.js:68-88 — parseHexEscapes utility; called by Feed + 64KB Stress + (new) Paste test.
function parseHexEscapes(input) {
    const out = [];
    let i = 0;
    while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === 0x5C /* \ */
            && i + 4 <= input.length
            && (input.charCodeAt(i + 1) === 0x78 || input.charCodeAt(i + 1) === 0x58)) {
            const hiVal = hexDigit(input.charCodeAt(i + 2));
            const loVal = hexDigit(input.charCodeAt(i + 3));
            if (hiVal !== null && loVal !== null) {
                out.push((hiVal << 4) | loVal);
                i += 4;
                continue;
            }
        }
        if (ch <= 0xFF) out.push(ch);
        i++;
    }
    return new Uint8Array(out);
}
```

**Rationale:** Phase 2 utility already in `main.js` scope; no re-export needed — Paste test handler also lives in main.js and calls `enqueuePaste(parseHexEscapes(textarea.value))`. Zero duplication.

---

### Test setup helper + DOM warmup (Phase 4 spec convention — applies to all 7 Phase 5 specs)

**Source:** `www/tests/input/crlf-override.spec.js` lines 4-11 + `www/tests/input/local-echo.spec.js` lines 7-15.

**Apply to:** every Phase 5 `*.spec.js` setup block.

```js
// crlf-override.spec.js:4-11 + local-echo.spec.js:7-15 — the canonical setup pattern.
async function setup(page) {
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__testGridView === 'function');  // if grid-view access needed
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}
```

Phase 5 transport setup adds `await page.addInitScript(SERIAL_MOCK);` BEFORE `page.goto('/')`, and may add `await page.locator('#connection').evaluate((el) => { el.open = true; });` for specs that assert on Connection-pane content.

**Rationale:** Every Phase 4 spec follows this shape. Phase 5 transport specs plus the init-script injection for the Web Serial mock. No deviation.

---

## No Analog Found

Files/patterns with no close in-codebase precedent — planner should use 05-RESEARCH.md patterns (cited inline above where they appear):

| Pattern | Reason | Source in RESEARCH |
|---------|--------|--------------------|
| Web Serial `navigator.serial.requestPort({filters})` + `port.open()` + `port.setSignals(...)` sequence | No prior Web Serial usage | 05-RESEARCH Pattern 6 + Pattern 3 |
| Outer `while (port.readable)` read-loop wrapper | No streaming API precedent in codebase | 05-RESEARCH Pattern 2 (lines 394-419) |
| `navigator.serial` `connect`/`disconnect` event listeners | New API surface | 05-RESEARCH Pattern 6 (lines 637-641) |
| `reader.cancel()` + `writer.releaseLock()` + `port.close()` teardown order | New API surface | 05-RESEARCH Pattern 3 (lines 436-459) |
| `page.addInitScript(MOCK_STRING)` for pre-boot API stubbing | Phase 4 used `page.evaluate` post-boot only | 05-RESEARCH Pattern 7 (lines 702-803) |
| Mock class hierarchy (MockReader / MockWriter / MockSerialPort / MockSerial) | No prior Playwright fixture > 20 lines | 05-RESEARCH Pattern 7 Example lines 704-803 |
| `setTimeout`-chain chunker with self-scheduling | No timing-paced module exists (Phase 3 rAF is distinct) | 05-RESEARCH Pattern 4 (lines 481-581) |
| `localStorage` read/write (VID/PID persistence) | Phase 5 introduces the first localStorage use in the codebase | 05-RESEARCH Runtime State Inventory lines 874-883; D-31 |
| Polite-fail `document.body.innerHTML` full-page replacement | New boot-time failure mode | 05-RESEARCH Pattern 1 (lines 346-378) |
| Timing tolerance assertion (`elapsed >= 0.95 * expectedMs`) | No timing tests exist in Phase 3/4 | 05-RESEARCH Example 5 (lines 1149-1179); D-41 |

Every "no analog" item has an explicit 05-RESEARCH Pattern or Example the planner can lift verbatim. No guesswork required.

---

## Metadata

**Analog search scope:**
- `www/` (all JS modules + index.html + playwright.config.js)
- `www/tests/` (all existing specs — 12 Phase 3/4 spec files)
- `.planning/phases/04-keyboard-input/04-HUMAN-UAT.md` (for the UAT doc template)

**Files scanned:** 20 (all 12 source files under www/, 11 existing spec files, 1 UAT template, plus full CONTEXT/RESEARCH/UI-SPEC for Phase 5 context)

**Pattern extraction date:** 2026-04-22

**Confidence notes for planner:**
- `serial.js` is the largest new module in Phase 5 but its shape is fully constrained by chrome.js + canvas.js + main.js patterns plus 05-RESEARCH Patterns 1-6. Zero greenfield DSL.
- `paste-pump.js` is a near-clone of tx-sink.js's module shape with the pump engine body from 05-RESEARCH Pattern 4. 
- The 7 spec files are copy-paste-and-adapt from the 8 existing `www/tests/input/*.spec.js` specs, with the init-script mock injection as the sole new primitive.
- The 5 modified source files are all one-to-six-line additive insertions; no rewrites, no signature changes (04-D-07 signature preservation re-affirmed by 05-CONTEXT D-34 and 05-RESEARCH Example 2).
