# Phase 11: SLIDE JS Bridge & v1.0 Integration — Pattern Map

**Mapped:** 2026-05-08
**Files analyzed:** 14 (6 NEW, 8 MODIFIED)
**Analogs found:** 14 / 14 (every file has at least a role-match analog already in the tree)

> Phase 11 is integration glue — every NEW file has a strong sibling already in
> the codebase (scroll-state.js for the chip; slide-recv-settings.spec.js for
> Settings tests; slide-cancel.spec.js for chip-lifecycle Playwright). Every
> MODIFIED file's edit has a precedent (pastePumpOnPortLost call sites mirror
> verbatim; visibilitychange BEL prefix listener body extends 1:1; prefs
> DEFAULTS keys append to a frozen object). Planner should copy excerpts
> verbatim and adapt names — there is **no novel architecture** in this phase.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `www/renderer/slide-chip.js` (NEW) | renderer / chip module | event-driven + 250 ms tick | `www/renderer/scroll-state.js` | exact (verbatim mirror per CONTEXT C-02) |
| `www/transport/echo-swallow.js` (NEW, optional) | transport / inbound filter | byte-for-byte transform | `www/transport/slide.js:283-358` (wakeup matcher in dispatchTerminalMode) | role-match (filter sibling; same dispatcher branch) |
| `www/tests/transport/slide-chip.spec.js` (NEW) | test / Playwright spec | request-response + state poll | `www/tests/transport/slide-cancel.spec.js` | exact (chip lifecycle assertions over the same mock-bot) |
| `www/tests/transport/slide-bridge.spec.js` (NEW) | test / Playwright spec | session-log + paste + visibilitychange + port-lost | `www/tests/transport/slide-cancel.spec.js` (cancel + port-lost), `www/tests/transport/paste.spec.js` (paste-pump) | exact for the cancel/port-lost half; role-match for the visibilitychange half |
| `www/tests/transport/slide-compatibility.spec.js` (NEW) | test / Playwright spec | 3-way mode behavior | `www/tests/transport/slide-recv-settings.spec.js` | exact (Settings-driven branching with `__pickerStub`-style timing tweaks) |
| `www/tests/transport/slide-prefs.spec.js` (NEW) | test / Playwright spec | DOM-form persistence | `www/tests/transport/slide-recv-settings.spec.js` | exact |
| `www/index.html` (MODIFIED) | DOM + CSS | static markup | `www/index.html:138-164` (#scrollback-indicator chip CSS) + `www/index.html:819-822` (`<details class="reserved">`) + `www/index.html:852-866` (Phase 10 Save-to-folder row) | exact (verbatim mirror with corner flip) |
| `www/state/prefs.js` (MODIFIED) | state / persistence | CRUD (DEFAULTS extension) | `www/state/prefs.js:18-30` itself (Phase 10 `slideRecvToFolder` precedent) | exact |
| `www/transport/slide.js` (MODIFIED) | transport / dispatcher | request-response + state machine | self (existing `enterSendMode` at line 537; `slidePumpOnPortLost` stub at 199) | exact (4 surgical edits inside an already-wired module) |
| `www/transport/slide-recv.js` (MODIFIED) | transport / receiver | event-driven (cancel state machine) | self (`slidePumpOnPortLost` stub at 688) + `recoverHardFail` at 708 | exact |
| `www/transport/serial.js` (MODIFIED) | transport / Web Serial | streaming read loop + teardown | self (`pastePumpOnPortLost` calls at 496/527/670) | exact (mirror by adding parallel calls) |
| `www/input/file-source.js` (MODIFIED) | input / drag-drop + picker | event-driven | self (existing `isSessionActive()` helper at 169 + the silent-ignore branches at 178/208) | exact |
| `www/input/paste-pump.js` (MODIFIED) | input / pump | streaming TX | self (`enqueuePaste` at 40 + `onPortLost` at 74) | exact |
| `www/renderer/chrome.js` (MODIFIED) | renderer / chrome wiring | event-driven | self (`document.addEventListener('visibilitychange', …)` at 210) | exact (extend body in place) |
| `www/main.js` (MODIFIED) | boot / wiring | request-response | self (`wireSlideRecv({…})` at 427; `window.__slide.cancelRecv = cancelSlideRecv` at 467) | exact |
| `www/tests/transport/mock-serial-slide-bot.js` (MODIFIED) | test / mock | byte-for-byte simulation | self (`bot` state object at 121; `setRole` API at 197) | exact |

---

## Pattern Assignments

### `www/renderer/slide-chip.js` (NEW — chip module, event-driven)

**Analog:** `www/renderer/scroll-state.js` (213 lines total — mirror this shape verbatim per CONTEXT C-02)

**Module-scope state pattern** (`scroll-state.js:11-29`):
```js
// Module-scope state.
let offset = 0;                      // 0 = live tail; > 0 = N rows back
let trackpadAccumulator = 0;
let newLinesSinceUserScrolled = 0;   // chip counter
let needsRepaint = false;
const changeObservers = [];

// Injected deps.
let termRef = null;
let canvasWrapperRef = null;
let indicatorElRef = null;
let indicatorTextElRef = null;
let requestFrameFn = null;
let markAllRowsDirtyFn = null;
```

**`wireXxx({...})` initializer pattern** (`scroll-state.js:32-77`):
```js
export function wireScrollState(opts) {
    const { term, canvasWrapper, indicator, indicatorText, requestFrame, markAllRowsDirty } = opts;
    termRef = term;
    canvasWrapperRef = canvasWrapper;
    indicatorElRef = indicator;
    indicatorTextElRef = indicatorText;
    requestFrameFn = requestFrame;
    markAllRowsDirtyFn = markAllRowsDirty || null;

    // Chip click — snap to bottom (D-04 trigger 1).
    if (indicator) {
        indicator.addEventListener('click', () => { snapToBottom(); });
        indicator.addEventListener('mousedown', (e) => {
            e.preventDefault();   // Phase 4 D-16 focus-retention pattern — sacred.
        });
    }

    // Initial state.
    refreshAttribute();
    refreshChip();

    return {
        getOffset, isScrolledBack, scrollByLines, scrollByPage,
        snapToBottom, jumpToTop, notifyFeed, onChange,
        consumeNeedsRepaint, requestRepaint, dispose,
    };
}
```

**`[hidden]` toggle render pattern** (`scroll-state.js:194-207` — the contract Phase 11 mirrors):
```js
function refreshChip() {
    if (!indicatorElRef || !indicatorTextElRef) return;
    if (offset > 0 && newLinesSinceUserScrolled > 0) {
        // 06-UI-SPEC §Copywriting verbatim singular/plural rule.
        const n = newLinesSinceUserScrolled;
        const unit = n === 1 ? 'new line' : 'new lines';
        const formatted = n.toLocaleString();
        indicatorTextElRef.innerHTML = `<span aria-hidden="true">↓</span> ${formatted} ${unit}`;
        indicatorElRef.setAttribute('aria-label', `${formatted} ${unit} below — click to scroll to live output`);
        indicatorElRef.removeAttribute('hidden');
    } else {
        indicatorElRef.setAttribute('hidden', '');
    }
}
```

**Observer fan-out pattern** (`scroll-state.js:145-151, 209-213`) — chip subscribes to dispatcher state changes:
```js
export function onChange(fn) {
    changeObservers.push(fn);
    return () => {
        const i = changeObservers.indexOf(fn);
        if (i >= 0) changeObservers.splice(i, 1);
    };
}

function fireChange() {
    for (const fn of changeObservers) {
        fn({ offset, isScrolledBack: offset > 0, newLines: newLinesSinceUserScrolled });
    }
}
```

**Adaptation for slide-chip.js:**
- Replace `offset / newLinesSinceUserScrolled` with `lifecycle` enum (`'hidden' | 'awaiting-wakeup' | 'awaiting-wakeup-timeout' | 'active' | 'cancelled-summary' | 'summary' | 'error' | 'drop-rejected-flash'`).
- Replace `wheel` listener with a 250 ms `setInterval(refreshChip, 250)` for throughput tick (CONTEXT D-02 + Claude's Discretion default hybrid).
- Replace `onChange` exporter with state-transition exports: `enterAwaitingWakeup({ armTimer })`, `enterActive()`, `enterError(reason)`, `enterCancelledSummary({ done, total })`, `enterSummary({ direction, fileCount, totalBytes })`, `flashDropRejected()`, `hide()`.
- Module-scope timer handles: `refreshTickHandle`, `wakeupTimeoutHandle` (D-15 3 s), `summaryAutoHideHandle` (5 s), `dropRejectedRevertHandle` (3 s).

---

### `www/transport/echo-swallow.js` (NEW, optional per C-03 — inbound byte filter)

**Analog:** `www/transport/slide.js:278-358` (the `dispatchTerminalMode` wakeup matcher — same byte-loop shape)

**Byte-loop with prefix-match + replay-on-mismatch pattern** (`slide.js:283-358`):
```js
function dispatchTerminalMode(value) {
    const pending = [];
    let i = 0;
    while (i < value.length) {
        const b = value[i];
        if (b === WAKEUP[wakeIdx]) {
            // Capture for potential replay (max 6 bytes; the 7th match commits...).
            if (wakeIdx < 6) scratch[wakeIdx] = b;
            wakeIdx++;
            if (wakeIdx === 7) {
                if (pending.length) {
                    termRef.feed(new Uint8Array(pending));
                    pending.length = 0;
                }
                /* ...transition to recv/send... */
                return;
            }
        } else {
            // Mismatch — replay swallowed prefix to pending in original order.
            if (wakeIdx > 0) {
                for (let k = 0; k < wakeIdx; k++) pending.push(scratch[k]);
                wakeIdx = 0;
                if (b === WAKEUP[0]) { scratch[0] = b; wakeIdx = 1; }
                else { pending.push(b); }
            } else {
                pending.push(b);
            }
        }
        i++;
    }
    if (pending.length) termRef.feed(new Uint8Array(pending));
}
```

**Adaptation for echo-swallow.js (PITFALLS §11 prescription, CONTEXT C-03):**
- Replace static `WAKEUP[7]` with a dynamic FIFO `swallowBuf: number[]` populated by `pushAutoTypedBytes(bytes)` at auto-type time (called from `slide.js:enterSendMode` right after `pushTxBytes(AUTO_SEND_COMMAND)` at line 592).
- Add a 500 ms timer arming on push; on expiry, flush remaining `swallowBuf` to `term.feed`.
- Export `consumeIfMatch(byte) -> bool` for `dispatchTerminalMode` to call BEFORE the wakeup matcher: if buffer non-empty AND `swallowBuf[0] === byte`, shift and return true (swallow); else flush remaining buffer to `pending` (caller's array) and return false.
- Module-scope state mirrors `slide.js:120-135` — keep the same private-vars-plus-`wireXxx`-plus-`reset` shape.

---

### `www/tests/transport/slide-chip.spec.js` (NEW — chip lifecycle Playwright)

**Analog:** `www/tests/transport/slide-cancel.spec.js` (192 lines, `slide-cancel — Esc + programmatic + timing windows`)

**Mock-bot setup pattern** (`slide-cancel.spec.js:13-35`):
```js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}

async function commonReset(page) {
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide.__resetForTests();
        window.__slideRecv.__resetForTests();
        window.__mockWriterLog.length = 0;
        window.__mockSlideBot.reset();
        window.__mockSlideBot.setRole('send');
    });
}
```

**Mid-stream entry helper pattern** (`slide-cancel.spec.js:41-59`):
```js
async function enterMidStream(page, fileSize) {
    await page.evaluate((size) => {
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) bytes[i] = i & 0xFF;
        window.__mockSlideBot.send.pauseAfterFirstWindow = true;
        window.__mockSlideBot.queueSendFiles([{ name: 'BIG.BIN', bytes }]);
        window.__mockSlideBot.pushSlideHostWakeup();
    }, fileSize);
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 5000 },
    ).toBe('recv');
    await page.evaluate(() => window.__mockSlideBot.startSendSession());
    await expect.poll(
        () => page.evaluate(() => window.__slideRecv.__getStateForTests().bytesInFileDone > 0),
        { timeout: 5000 },
    ).toBe(true);
}
```

**Adaptation for slide-chip.spec.js:**
- Reuse `setup` + `commonReset` + `enterMidStream` verbatim.
- Add `expect.poll(() => page.locator('#slide-chip').isVisible())` style assertions for each lifecycle state.
- For `awaiting-wakeup-timeout` test: use the new `setWakeupDelay(ms)` mock-bot extension (delay > 3000 with `slideCompatibilityMode === 'auto'`); assert chip text matches `Z80 didn't respond.  [Retry]  [Cancel]  [Force start]`.
- For `cancelled-summary`: trigger cancel via `await page.locator('#slide-chip button[data-action="cancel"]').click()`, then poll chip text matches `Cancelled — N of M files transferred`, then poll `[hidden]` attribute returns within 5 s.
- For `drop-rejected-flash`: while `enterMidStream` is active, dispatch a synthetic dragenter; poll chip text contains `Transfer in progress — cancel first`.

---

### `www/tests/transport/slide-bridge.spec.js` (NEW — session-log pause + paste-pump gate + visibilitychange + port-lost)

**Analog:** `www/tests/transport/slide-cancel.spec.js` (port-lost half) + `www/tests/transport/paste.spec.js` (paste-pump cancel half)

**Session-log assertion pattern** — read via `window.__sessionLog.getCurrentBytes()` (already exposed at `main.js:400`):
```js
const before = await page.evaluate(() => window.__sessionLog.getCurrentBytes().length);
// ...drive bytes through during active SLIDE...
const after = await page.evaluate(() => window.__sessionLog.getCurrentBytes().length);
expect(after).toBe(before);   // session log paused during active SLIDE (D-11)
```

**Visibilitychange dispatch pattern** (Playwright supports synthesizing visibility changes via `page.evaluate`):
```js
await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
});
// Then assert: __mockWriterLog contains [0x18] CTRL_CAN frame within 250 ms (D-13 fire-and-forget).
await expect.poll(() => ctrlCanInWriterLog(page), { timeout: 1000 }).toBe(true);
```

The `ctrlCanInWriterLog` helper from `slide-cancel.spec.js:61-67` is reusable verbatim:
```js
function ctrlCanInWriterLog(page) {
    return page.evaluate(() =>
        window.__mockWriterLog.some((entry) =>
            entry.bytes && entry.bytes.some((b) => b === 0x18),
        ),
    );
}
```

**Port-lost teardown pattern** — `slide-cancel.spec.js` already covers `slidePumpOnPortLost` invocation; copy the `enterMidStream` → simulate port disconnect → assert `mode === 'terminal'` flow.

---

### `www/tests/transport/slide-compatibility.spec.js` (NEW — 3-way mode behavior)

**Analog:** `www/tests/transport/slide-recv-settings.spec.js` (199 lines)

**Settings-driven test scaffolding** (`slide-recv-settings.spec.js:80-104`):
```js
async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(PICKER_STUB);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#settings').evaluate((el) => { el.open = true; });
}

test.describe('slide-recv-settings — toggle row state machine', () => {
    test.beforeEach(async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            window.__slideRecv.__resetForTests();
            const cb = document.getElementById('slide-recv-to-folder-checkbox');
            if (cb && cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
    });
```

**Adaptation for slide-compatibility.spec.js:**
- 3 sub-tests: `auto` (default — chip arms 3 s timer; on bot delay > 3000 ms, chip enters `awaiting-wakeup-timeout`), `wakeup-required` (no timer; chip stays in `awaiting-wakeup` indefinitely), `force-start` (skip wakeup wait — chip enters `active` immediately on auto-type completion).
- Drive the `<select>`: `await page.locator('#slide-compat-select').selectOption('wakeup-required')` then click Send and assert chip behavior.
- Mock-bot extension `setWakeupDelay(ms)` (added in this phase to `mock-serial-slide-bot.js`) — delays `pushSlideHostWakeup` by `ms` after `setRole('send')` is invoked.

---

### `www/tests/transport/slide-prefs.spec.js` (NEW — Settings persistence)

**Analog:** `www/tests/transport/slide-recv-settings.spec.js` verbatim — same structure, asserting localStorage `bestialitty.prefs` key contains the three new fields after DOM events.

**Persistence assertion pattern** (uses the already-debounced 250 ms save from `prefs.js:86`):
```js
// Set DOM, dispatch change, wait debounce, read localStorage.
await page.locator('#slide-auto-send-input').fill('A:RUN PROG.COM');
await page.locator('#slide-auto-send-input').dispatchEvent('change');
await page.waitForTimeout(300);   // 250 ms debounce + 50 ms slack
const blob = await page.evaluate(() => JSON.parse(localStorage.getItem('bestialitty.prefs')));
expect(blob.slideAutoSendCommand).toBe('A:RUN PROG.COM\r');   // D-06 — \r appended at save
```

---

### `www/index.html` (MODIFIED — chip DOM + chip CSS + Settings sub-block)

**Analog 1 — chip CSS** (`index.html:138-164`, the verbatim mirror target):
```css
/* ==== Floating "↓ N new lines" chip (Phase 6 D-03) ==== */
#scrollback-indicator {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 5;
  font-family: inherit;
  font-size: 12px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.65);
  color: var(--chrome-accent);
  border: 1px solid var(--chrome-accent);
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
[data-theme="crt"] #scrollback-indicator {
  color: var(--phosphor-fg);
  border-color: var(--phosphor-fg);
}
#scrollback-indicator[hidden] { display: none; }
#scrollback-indicator:focus-visible {
  outline: 2px solid var(--chrome-accent);
  outline-offset: 2px;
}
#scrollback-indicator:hover {
  background: rgba(0, 0, 0, 0.8);
}
```

**Adaptation for `#slide-chip`:** copy the rule-block verbatim, replace `right: 8px` with `left: 8px`, replace selector with `#slide-chip`. Per UI-SPEC Layout add `max-width: calc(100% - 16px - 288px)` and `white-space: nowrap` (overflow tolerated). Inner `[Cancel] [Retry] [Force start]` buttons use `padding: 0 4px` and inherit chip color/font-size.

**Analog 2 — chip DOM element** (`index.html:776-779`):
```html
<button id="scrollback-indicator" type="button" hidden
        title="Click to scroll to live output" aria-label="0 new lines below">
  <span id="scrollback-indicator-text"><span aria-hidden="true">↓</span> 0 new lines</span>
</button>
```

**Adaptation:** add `<button id="slide-chip" type="button" hidden aria-live="polite" aria-atomic="true" aria-label="SLIDE file transfer chip"><span id="slide-chip-text"></span></button>` as a sibling of `#scrollback-indicator` inside `#terminal-wrapper` (the `</div>` closing `#terminal-wrapper` is at line 788; insert before line 788).

**Analog 3 — `<details class="reserved">` Settings sub-block** (`index.html:819-822`):
```html
<details class="reserved">
  <summary>Browser-reserved Ctrl combinations</summary>
  <p class="hint">Ctrl+W, Ctrl+N, Ctrl+T are claimed by Chromium ...</p>
</details>
```

**CSS rule the new sub-block inherits** (`index.html:298-305`):
```css
#settings details.reserved {
  margin-top: 8px;
  border: 1px solid var(--chrome-border);
  padding: 4px 8px;
}
#settings details.reserved summary {
  font-size: 13px;
  ...
}
```

**Analog 4 — Phase 10 Save-to-folder row to MOVE** (`index.html:851-866`):
```html
<hr class="settings-divider" />
<div class="settings-row" id="slide-recv-folder-row">
  <label for="slide-recv-to-folder-checkbox" title="...">
    <input type="checkbox" id="slide-recv-to-folder-checkbox">
    Save received files to a folder
  </label>
  <div class="settings-row-action">
    <button id="slide-recv-folder-button" type="button"
            title="Toggle the checkbox first">Choose folder…</button>
    <span id="slide-recv-folder-status" class="hint">No folder selected</span>
  </div>
  <p class="hint" id="slide-recv-folder-help">
    Received files land in your Downloads folder. Toggle this to pick a fixed destination.
  </p>
</div>
```

**Adaptation:** wrap this row + 3 new rows (auto-send `<input>`, show-summary `<input type="checkbox">`, Compatibility mode `<select>`) inside a new `<details class="reserved" id="settings-slide"><summary>SLIDE file transfer</summary>...</details>` that replaces the existing top-level row at lines 851-866.

**Analog 5 — `<select>` styling reuse** (`index.html:366-376`):
```css
#connection select {
  font-family: inherit; font-size: 13px;
  background: var(--chrome-bg);
  color: var(--chrome-fg);
  border: 1px solid var(--chrome-border);
  padding: 2px 4px;
}
#connection select:focus-visible {
  border-color: var(--chrome-accent);
  outline: none;
}
```

**Adaptation per UI-SPEC Spacing §"Phase 5 legacy spacing — divergence note":** new rules `#slide-compat-select, #slide-auto-send-input` mirror this idiom EXCEPT padding normalizes to `4px` (multiple-of-4) and the `<input type="text">` adds `width: 200px`.

---

### `www/state/prefs.js` (MODIFIED — DEFAULTS extension, D-09)

**Analog:** self at lines 18-30 (the existing `DEFAULTS` `Object.freeze`)

**Existing pattern with Phase 10's precedent for adding a new key** (`prefs.js:18-30`):
```js
const DEFAULTS = Object.freeze({
    version: CURRENT_VERSION,
    theme: 'crt',
    phosphor: 'green',
    font: 'modern',
    fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false,
    crlfMode: 'cr',
    autoConnect: false,
    showAllSerialDevices: false,
    slideRecvToFolder: false,    // Phase 10 — CONTEXT D-02 (default OFF; toggle in Settings pane lands in Plan 10-04)
});
```

**Defensive merge invariant** (`prefs.js:66`) — Phase 11 relies on this for backwards-compat:
```js
cached = { ...DEFAULTS, ...parsed, serial: { ...DEFAULTS.serial, ...(parsed.serial || {}) } };
```

**Adaptation:** append three keys to the `Object.freeze({...})` literal:
```js
slideAutoSendCommand: 'B:SLIDE R\r',          // Phase 11 — D-09 (SLIDE-37)
slideShowSummary: true,                       // Phase 11 — D-09 (D-08 default ON)
slideCompatibilityMode: 'auto',               // Phase 11 — D-09 ('auto' | 'wakeup-required' | 'force-start')
```

No `CURRENT_VERSION` bump (D-09: defensive merge at line 66 fills missing fields). `IDB_ONLY_FIELDS` at line 40 stays untouched.

---

### `www/transport/slide.js` (MODIFIED — 4 surgical edits)

**Analog:** self — every edit has a precise insertion point already documented.

**Edit 1: D-09 swap source for AUTO_SEND_COMMAND** (replace constant at `slide.js:155-157`):

Current:
```js
const AUTO_SEND_COMMAND = new Uint8Array([
    0x42, 0x3A, 0x53, 0x4C, 0x49, 0x44, 0x45, 0x20, 0x52, 0x0D
]);
```

Adaptation: read `prefs.slideAutoSendCommand` at call time inside `enterSendMode` (`slide.js:537-597`); preserve the empty-string-disables semantic at line 591 (`if (AUTO_SEND_COMMAND.length > 0)`). Plumb `prefs` through via a new `wireSlideDispatcher` opt (current shape at line 165-171). Encode the string at call time: `new TextEncoder().encode(prefs.slideAutoSendCommand)`.

**Edit 2: D-12 paste-pump cancel at wakeup completion** — inside `dispatchTerminalMode` (`slide.js:296-310`) right after the `enterRecvMode()` / `enterSendModeInternal()` call (line 309 / 306):
```js
// Phase 11 D-12 — paste-pump gate.
pastePump.cancelPaste();   // injected via wireSlideDispatcher opts
```

**Edit 3: D-14 forward `slidePumpOnPortLost` to `slide-recv.js`** — replace the no-op stub at `slide.js:199-201`:

Current:
```js
export function slidePumpOnPortLost() {
    // No-op until Phase 11.
}
```

Adaptation: import the real impl from `slide-recv.js` and re-export, OR call into it:
```js
import { slidePumpOnPortLost as slideRecvPumpOnPortLost } from './slide-recv.js';
export function slidePumpOnPortLost() { slideRecvPumpOnPortLost(); }
```

**Edit 4: chip lifecycle hooks** — call sites are at `enterSendMode` (after `pushTxBytes(AUTO_SEND_COMMAND)` at line 592) → `slideChip.enterAwaitingWakeup({ armTimer: prefs.slideCompatibilityMode === 'auto' })`; at `enterSendModeInternal` / `enterRecvMode` (lines 625, 472) → `slideChip.enterActive()`; at `exitSendMode` / `exitRecvMode` (lines 653, 489) → `slideChip.enterSummary({...})` if `prefs.slideShowSummary`, else `slideChip.hide()`.

---

### `www/transport/slide-recv.js` (MODIFIED — fill `slidePumpOnPortLost` body, D-14)

**Analog:** self at lines 683-694 (existing 5-line stub) + `recoverHardFail` at lines 708-719

**Existing 5-line stub** (`slide-recv.js:683-694`):
```js
// slidePumpOnPortLost — port lost mid-recv (T-10-port-lost).
// CONTEXT Discretion default: 5-line minimum (force_idle + console.warn +
// forceExitRecvMode). Phase 11 SLIDE-32 will replace with chip-emitting logic.
// Without this real impl, port loss leaves SM stuck in DataPhase; with it,
// the next reload + reconnect starts cleanly.
export function slidePumpOnPortLost() {
    if (slideRef && typeof slideRef.force_idle === 'function') {
        slideRef.force_idle();
    }
    console.warn('[slide-recv] port lost — force_idle + setWireOwner(terminal)');
    forceExitRecvMode();
}
```

**Symmetric `recoverHardFail` pattern to mirror** (`slide-recv.js:708-719`):
```js
export function recoverHardFail(reason) {
    console.error(`[slide-recv] hard-fail: ${reason}; resetting`);
    drainSlideOutboundOneShot();
    if (slideRef && typeof slideRef.force_idle === 'function') {
        slideRef.force_idle();
    }
    forceExitRecvMode();
}
```

**Adaptation per CONTEXT D-14:**
```js
export function slidePumpOnPortLost() {
    if (!isSlideActive()) return;
    try { if (slideRef && typeof slideRef.force_idle === 'function') slideRef.force_idle(); } catch {}
    try { txSinkRef.setWireOwner('terminal'); } catch {}
    slideChip.enterError('port lost');   // 5-second auto-hide (D-14)
    forceExitRecvMode();   // Plan 10-05 Rule 1 fix — flips slide.js mode synchronously
    __resetForTests();     // mirror reset() in CONTEXT body — clears recv buffers
}
```

`isSlideActive` already exists at `slide-recv.js:341-352`; `forceExitRecvMode` is the existing helper (called by `recoverHardFail` at line 718 + `cancelSlideRecv` paths).

---

### `www/transport/serial.js` (MODIFIED — 3 call-site additions, D-11 + D-14 wiring)

**Analog:** self at lines 496, 527, 670 (the three existing `pastePumpOnPortLost()` call sites).

**Pattern to mirror** (`serial.js:483-497`):
```js
function handleReadError(err) {
    // D-28 — NetworkError from the read loop means permission was revoked...
    const isPermissionRevoke = err && err.name === 'NetworkError';
    if (isPermissionRevoke) {
        appendErrorLog('permission-revoked', 'Permission revoked — click Reconnect to re-authorize');
    } else {
        appendErrorLog('read-error', `Read error — treating as port lost: ${err.message}`);
    }
    console.error('[serial] read error', err);
    setState('port-lost');
    // Phase 5 D-20 — drain any mid-paste queue when read loop fatal-errors.
    pastePumpOnPortLost();
}
```

**Pattern at `serial.js:521-528` (teardown):**
```js
    // Step 5 — Phase 5 D-20 — drop any mid-paste queue.
    pastePumpOnPortLost();
```

**Pattern at `serial.js:665-671` (onNavSerialDisconnect):**
```js
function onNavSerialDisconnect(ev) {
    if (ev.target === port || ev.target === lastPortRef) {
        setState('port-lost');
        // Phase 5 D-20 — drain any mid-paste queue on hard unplug...
        pastePumpOnPortLost();
    }
}
```

**Adaptation:** add `slidePumpOnPortLost();` immediately AFTER each `pastePumpOnPortLost();` call, with import from `../transport/slide.js` (which forwards per Edit 3 above). Existing import at `serial.js:15`:
```js
import { onPortLost as pastePumpOnPortLost } from '../input/paste-pump.js';
```

becomes additionally:
```js
import { slidePumpOnPortLost } from './slide.js';
```

**D-11 session-log gate edit** at `serial.js:466`:

Current:
```js
if (sessionLogRef) sessionLogRef.append(value);
```

Adaptation:
```js
if (sessionLogRef && !isSlideActive()) sessionLogRef.append(value);
```

with import: `import { isSlideActive } from './slide-recv.js';`

---

### `www/input/file-source.js` (MODIFIED — D-10 chip flash; optional poller cleanup)

**Analog:** self at lines 169-220 (`isSessionActive` helper + `onDragEnter`/`onDrop` silent-ignore branches)

**Existing silent-ignore branches to replace** (`file-source.js:176-183, 206-211`):
```js
function onDragEnter(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) {
        // UI-SPEC §Drag-drop during active SLIDE session — Phase 9 silently
        // ignores. Phase 11 SLIDE-11 will add the "Transfer in progress —
        // cancel first" chip. Don't preventDefault; don't set the attribute.
        return;
    }
    ev.preventDefault();
    dragDepth++;
    if (dragDepth === 1) {
        setDropTarget(true);
    }
}

function onDrop(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) {
        // Silent ignore during active session.
        return;
    }
    /* ... */
}
```

**Adaptation per D-10:**
```js
function onDragEnter(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) {
        slideChip.flashDropRejected();   // Phase 11 D-10 / SLIDE-11
        return;
    }
    /* ...rest unchanged... */
}

function onDrop(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) {
        slideChip.flashDropRejected();   // Phase 11 D-10
        return;
    }
    /* ...rest unchanged... */
}
```

`slideChip` is injected via a new `wireFileSource` opt; current opts shape at lines 39-53.

**Optional poller cleanup (Claude's Discretion, default leave-in-place):** the `setInterval(updateButtonState, 200)` at line 116 may be replaced with an observer subscription on the chip module if planner judges the test surface clean.

---

### `www/input/paste-pump.js` (MODIFIED — D-12 isSlideActive gate)

**Analog:** self at lines 40-55 (`enqueuePaste`)

**Existing entry point pattern** (`paste-pump.js:40-55`):
```js
export function enqueuePaste(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    // D-23 — CR/LF rewrite BEFORE enqueue (not mid-pump).
    const rewritten = applyCrlfRewrite(bytes);
    // Drop bytes already consumed; append new bytes.
    const remaining = queue.subarray(cursor);
    const merged = new Uint8Array(remaining.length + rewritten.length);
    merged.set(remaining, 0);
    merged.set(rewritten, remaining.length);
    queue = merged;
    cursor = 0;
    if (!timer && cursor < queue.length) {
        fireProgress('started', { total: queue.length });
        writeOneChunk();
    }
}
```

**Adaptation per D-12:** add early-return at top of `enqueuePaste` and import `isSlideActive`:
```js
import { isSlideActive } from '../transport/slide-recv.js';

export function enqueuePaste(bytes) {
    if (isSlideActive()) {
        // Phase 11 D-12 — paste-pump gate during active SLIDE session.
        return;
    }
    /* ...rest unchanged... */
}
```

The `cancelPaste()` export at line 57 is already used by `slide.js` Edit 2 — no change to paste-pump's API.

---

### `www/renderer/chrome.js` (MODIFIED — D-13 visibilitychange + pagehide)

**Analog:** self at lines 200-215 (existing `visibilitychange` listener)

**Existing listener body** (`chrome.js:200-215`):
```js
// ==== Visibility-change listener — clears '(!) ' title prefix on foreground return ====
// The add-prefix half lives in main.js (synchronous after term.feed when document.hidden).
// This is the ONLY visibilitychange listener in Phase 3 — canvas.js does not listen.
// Phase 5 D-39 — additive: catch-up paint on foreground return (Pitfall #6).
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.title.startsWith('(!) ')) {
        document.title = document.title.slice(4);
    }
    if (!document.hidden && requestFrame) requestFrame();
});
```

**Adaptation per D-13:** extend the SAME listener body and add a sibling `pagehide` listener with the same SLIDE branch (no title prefix work — page is leaving):
```js
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.title.startsWith('(!) ')) {
        document.title = document.title.slice(4);
    }
    if (!document.hidden && requestFrame) requestFrame();
    // Phase 11 D-13 — fire-and-forget CTRL_CAN on hide during active SLIDE session.
    if (document.visibilityState === 'hidden' && isSlideActive()) {
        try { cancelSlideRecv(); } catch {}
        try { txSink.writeSlideFrame(new Uint8Array([0x18])); } catch {}
    }
});

// Phase 11 D-13 — pagehide is the bfcache-safe complement to visibilitychange.
window.addEventListener('pagehide', () => {
    if (isSlideActive()) {
        try { cancelSlideRecv(); } catch {}
        try { txSink.writeSlideFrame(new Uint8Array([0x18])); } catch {}
    }
});
```

`isSlideActive`, `cancelSlideRecv`, `txSink` (with `writeSlideFrame`) are injected via new `wireChrome` opts; existing opts shape at `chrome.js:58-76`.

---

### `www/main.js` (MODIFIED — `wireSlideChip` boot wiring + observers)

**Analog:** self at lines 416-445 (`wireSlideRecv` boot block) + lines 457-472 (window.__slide test exposure)

**Boot pattern to mirror** (`main.js:422-445`):
```js
const slideRecvFolderRow        = document.getElementById('slide-recv-folder-row');
const slideRecvToFolderCheckbox = document.getElementById('slide-recv-to-folder-checkbox');
const slideRecvFolderButton     = document.getElementById('slide-recv-folder-button');
const slideRecvFolderStatus     = document.getElementById('slide-recv-folder-status');
const slideRecvFolderHelp       = document.getElementById('slide-recv-folder-help');
wireSlideRecv({
    wrapperEl: terminalWrapper,
    prefs,
    savePrefs,
    idb: { getRecvDirHandle, setRecvDirHandle, clearRecvDirHandle },
    txSink: { setWireOwner, getWireOwner, writeSlideFrame, writeSlideFrameAwaitable },
    wasm,
    slideRef: null,
    rowEl: slideRecvFolderRow,
    toggleEl: slideRecvToFolderCheckbox,
    folderButtonEl: slideRecvFolderButton,
    statusEl: slideRecvFolderStatus,
    helpEl: slideRecvFolderHelp,
    dispatcherForceExit: dispatcherForceExitRecvMode,
});
```

**Test introspection pattern** (`main.js:467-472`):
```js
window.__slide.cancelRecv = cancelSlideRecv;
window.__slide.isActive = isSlideActive;   // Phase 10 — Playwright introspection
window.__slideRecv = {
    __resetForTests: __slideRecvResetForTests,
    __getStateForTests: __slideRecvGetStateForTests,
};
```

**Adaptation:** insert AFTER `wireFileSource` (line 496-509) and BEFORE the existing `window.__fileSource` assignment:
```js
const slideChipEl = document.getElementById('slide-chip');
const slideChipTextEl = document.getElementById('slide-chip-text');
wireSlideChip({
    chipEl: slideChipEl,
    chipTextEl: slideChipTextEl,
    getSlideState: __slideGetStateForTests,         // imported from transport/slide.js
    onCancel: cancelSlideRecv,                       // imported from transport/slide-recv.js
    prefs,
});
window.__slideChip = {
    __resetForTests: __slideChipResetForTests,
    __getStateForTests: __slideChipGetStateForTests,
};
```

Plus extend `wireSlideDispatcher` opts (line 409-414) to pass `prefs` and `slideChip` references; extend `wireFileSource` opts (line 496-509) to pass `slideChip`; extend `wireChrome` opts (line ~150) to pass `isSlideActive`, `cancelSlideRecv`, `txSink`. Existing wiring is the template — new fields just append to existing `{...}` opts objects.

---

### `www/tests/transport/mock-serial-slide-bot.js` (MODIFIED — `setWakeupDelay(ms)` extension)

**Analog:** self at lines 121-244 (the `bot` state + test-public API)

**Existing API extension pattern** (`mock-serial-slide-bot.js:197-235`):
```js
setRole(r) { bot.role = r; },
enable()  { bot.enabled = true; },
disable() { bot.enabled = false; },
setInjectNakOnSeq(seq) {
    bot.injectNakOnSeq = seq;
    bot.nak_already_injected = false;
},
setInjectCanAfterFirstDataFrame() {
    bot.injectCanAfterFirstDataFrame = true;
    bot.can_already_injected = false;
},
pushSlideWakeup() {
    const wakeBytes = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);
    window.__mockReaderPush(wakeBytes);
},
pushSlideHostWakeup() {
    const wakeBytes = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);
    window.__mockReaderPush(wakeBytes);
},
```

**Adaptation:** add `wakeupDelayMs: 0` field to `bot.send` state object (line 140-162; reset at line 193); add `setWakeupDelay(ms)` to API:
```js
setWakeupDelay(ms) { bot.send.wakeupDelayMs = ms | 0; },
```

Hook into `pushSlideHostWakeup` to honour the delay:
```js
pushSlideHostWakeup() {
    const wakeBytes = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]);
    if (bot.send.wakeupDelayMs > 0) {
        setTimeout(() => window.__mockReaderPush(wakeBytes), bot.send.wakeupDelayMs);
    } else {
        window.__mockReaderPush(wakeBytes);
    }
},
```

---

## Shared Patterns

### Module-scope state + `wireXxx({...})` initializer + injected deps

**Source:** `www/renderer/scroll-state.js:11-77`, `www/input/paste-pump.js:14-38`, `www/transport/slide-recv.js:132-340`, `www/input/file-source.js:20-117`

**Apply to:** `www/renderer/slide-chip.js` (verbatim mirror); `www/transport/echo-swallow.js` (if extracted as a module)

**Concrete shape:**
```js
// Module-scope state.
let stateA = ...;
let stateB = ...;

// Injected deps (set by wireXxx).
let depX = null;
let depY = null;

export function wireXxx(opts) {
    const { x, y, ... } = opts;
    depX = x;
    depY = y;
    // event listener registration, initial paint, etc.
    return { /* public methods */ };
}

export function __resetForTests() { /* zero out state */ }
export function __getStateForTests() { /* read-only snapshot */ }
```

---

### `[hidden]` attribute toggle (NOT `display: none` in JS)

**Source:** `www/index.html:157` (`#scrollback-indicator[hidden] { display: none; }`); `www/renderer/scroll-state.js:194-207`

**Apply to:** `www/renderer/slide-chip.js` chip lifecycle states; chip CSS rule `#slide-chip[hidden] { display: none; }`.

```js
// SHOW
chipEl.removeAttribute('hidden');
// HIDE
chipEl.setAttribute('hidden', '');
```

---

### `mousedown preventDefault` for focus retention

**Source:** `www/renderer/scroll-state.js:55-57`, `www/renderer/chrome.js:107, 124, 138, 263, 278, 306`, `www/input/file-source.js:76`

**Apply to:** every new chrome interaction in Phase 11 — chip outer button, chip inner `[Cancel]` / `[Retry]` / `[Force start]` buttons, `<select>` change handler restore-focus, `<input type="text">` blur handler.

```js
btn.addEventListener('click', () => { /* action */ });
btn.addEventListener('mousedown', (e) => {
    e.preventDefault();   // Phase 4 D-16 — focus retention; sacred.
});
```

For `<select>` (which needs native focus to open):
```js
select.addEventListener('change', (e) => {
    /* action */
    if (terminalWrapper) terminalWrapper.focus();   // restore after dropdown closes
});
```

---

### Theme-aware CSS via custom properties (no JS theme switching)

**Source:** `www/index.html:138-156` (chip rule + `[data-theme="crt"]` override)

**Apply to:** `#slide-chip` CSS — same `var(--chrome-accent)` clean / `var(--phosphor-fg)` CRT split; same `rgba(0, 0, 0, 0.65)` background literal; same 4px border-radius / 1px border / `box-shadow`.

```css
#slide-chip {
  /* default (clean theme) */
  color: var(--chrome-accent);
  border: 1px solid var(--chrome-accent);
  /* ...other rules... */
}
[data-theme="crt"] #slide-chip {
  color: var(--phosphor-fg);
  border-color: var(--phosphor-fg);
}
```

---

### `savePrefs({ key: value })` debounced 250 ms

**Source:** `www/state/prefs.js:83-87`; consumer pattern at `www/renderer/chrome.js:115, 135, 163-176, 244, 261, 276`

**Apply to:** every Phase 11 Settings row — auto-send `<input>` change, show-summary checkbox change, Compatibility mode `<select>` change.

```js
input.addEventListener('change', (e) => {
    savePrefs({ slideAutoSendCommand: e.target.value + '\r' });   // D-06 \r append at save
});
checkbox.addEventListener('change', (e) => {
    savePrefs({ slideShowSummary: e.target.checked });
});
select.addEventListener('change', (e) => {
    savePrefs({ slideCompatibilityMode: e.target.value });
});
```

---

### Test introspection via `window.__moduleName.__getStateForTests()`

**Source:** `www/main.js:457-479` (window.__slide / window.__slideRecv / window.__sessionLog / window.__txSink / window.__fileSource); reset/get pattern from every transport module's `__resetForTests` / `__getStateForTests` exports.

**Apply to:** `www/renderer/slide-chip.js` — export `__resetForTests` (clear lifecycle, samples ring, all timer handles) and `__getStateForTests` (return `{ lifecycle, throughputBytesPerSec, samples, dropRejectedUntil, hasWakeupTimer }`); attach via `window.__slideChip = {...}` in `main.js`.

Mock-bot extension `setWakeupDelay(ms)` follows the `setRole(r)` pattern verbatim.

---

### Symmetric port-lost teardown — `xxxPumpOnPortLost`

**Source:** `www/input/paste-pump.js:74-82`; call sites at `www/transport/serial.js:496, 527, 670`

**Apply to:** `slidePumpOnPortLost` exported from `slide-recv.js`, forwarded by `slide.js`, called from the same three serial.js sites immediately after each `pastePumpOnPortLost()`.

```js
// In paste-pump.js (the canonical pattern):
export function onPortLost() {
    if (!isActive()) return;
    if (timer) { clearTimeout(timer); timer = null; }
    const unsent = Math.max(0, queue.length - cursor);
    queue = new Uint8Array(0);
    cursor = 0;
    fireProgress('cancelled-port-lost', { unsent });
}
```

```js
// In slide-recv.js (Phase 11 fill):
export function slidePumpOnPortLost() {
    if (!isSlideActive()) return;
    try { slideRef && slideRef.force_idle(); } catch {}
    try { txSinkRef.setWireOwner('terminal'); } catch {}
    slideChip.enterError('port lost');
    forceExitRecvMode();
    /* clear module-scope buffers */
}
```

---

### Mock-bot setup in Playwright (verbatim across all 4 new spec files)

**Source:** `www/tests/transport/slide-cancel.spec.js:13-35`, `slide-recv-settings.spec.js:80-104`

**Apply to:** all four NEW spec files (chip / bridge / compatibility / prefs) — the `setup()` + `commonReset()` helpers are essentially copy-paste from `slide-cancel.spec.js`. The `PICKER_STUB` variant from `slide-recv-settings.spec.js` is needed only by spec files that also exercise the Save-to-folder row inside the new SLIDE sub-block.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| _(none)_ | — | — | Every Phase 11 file has at least a role-match analog already in the tree. Phase 11 is integration glue, not greenfield architecture. |

---

## Metadata

**Analog search scope:** `www/renderer/`, `www/transport/`, `www/input/`, `www/state/`, `www/tests/transport/`, `www/index.html`, `www/main.js`
**Files scanned:** ~25 (15 production modules + 10 spec files)
**Pattern extraction date:** 2026-05-08
