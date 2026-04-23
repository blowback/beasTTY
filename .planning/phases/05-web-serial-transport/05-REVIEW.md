---
phase: 05-web-serial-transport
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - www/index.html
  - www/input/paste-pump.js
  - www/input/tx-sink.js
  - www/input/keyboard.js
  - www/main.js
  - www/playwright.config.js
  - www/renderer/chrome.js
  - www/tests/transport/mock-serial.js
  - www/tests/transport/config.spec.js
  - www/tests/transport/connect.spec.js
  - www/tests/transport/errors.spec.js
  - www/tests/transport/paste.spec.js
  - www/tests/transport/polite-fail.spec.js
  - www/tests/transport/readloop.spec.js
  - www/tests/transport/reconnect.spec.js
  - www/transport/serial.js
findings:
  critical: 0
  warning: 6
  info: 8
  total: 14
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-04-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 5 delivers the Web Serial transport layer along with the paste pump, polite-fail gate, and an extensive Playwright mock-serial test harness. The architecture cleanly respects the CLAUDE.md hard constraint ("Web Serial driven from JS, not Rust") and every pitfall from the research phase is explicitly addressed (reader.cancel before close, DTR/RTS safe defaults, navigator.serial-level connect/disconnect listeners, pure-async read loop decoupled from rAF, 4ms clamp on the paste-pump setTimeout chain).

Overall code quality is high. The review surfaced no Critical issues. There are six Warnings (the most substantive being an invalid `configOverride` contract in `connectMicroBeast`, a stale state transition where the read loop can stomp a `port-lost` state back to `disconnected` on a subsequent natural close, an `unregisterWriter()` omission on auto-reconnect paths that take the retry branch and never call teardown, and a paste-pump completion path that can fire `'complete'` twice). Eight Info items call out smaller polish concerns (unused imports, a TDZ risk pattern, docstring drift, test flakiness vectors).

## Warnings

### WR-01: `connectMicroBeast(configOverride)` parameter is documented but never wired

**File:** `www/transport/serial.js:227`
**Issue:** The public export `connectMicroBeast` accepts an optional `configOverride` argument and selects it over `readFormConfig()` on line 242, but no caller in the codebase passes anything. `onConnectButtonClick()` (the only internal caller) invokes `connectMicroBeast()` with zero arguments, and main.js does not re-export the function. The parameter is dead code or an incomplete API — either add a test that exercises it (e.g. for programmatic reconnect after config-hint dismissal) or drop it to avoid misleading future callers who might assume the override path is tested.
**Fix:** Either wire it up from the reset-preset path or remove:
```js
// Option A — remove the parameter entirely:
export async function connectMicroBeast() {
    setState('connecting');
    // ...
    const config = readFormConfig();
    // ...
}
// Option B — add a Playwright spec that calls connectMicroBeast({baudRate: 9600, ...})
// via page.evaluate() to lock the override contract.
```

### WR-02: `runReadLoop` can stomp `port-lost` state set by the disconnect listener

**File:** `www/transport/serial.js:322-327`
**Issue:** When `navigator.serial` fires `disconnect`, `onNavSerialDisconnect` calls `setState('port-lost')`. Independently, the read loop's inner `await reader.read()` resolves `{ done: true }` (because the mock / real platform cancels the pending read on unplug), which breaks the inner loop, and on the next iteration `p.readable` is null so the outer loop exits and hits:
```js
if (state !== 'port-lost') setState('disconnected');
```
The guard is correct only if `onNavSerialDisconnect` fired FIRST. There is no ordering guarantee between the disconnect event dispatch and the microtask resolving the pending read. If the read-loop's microtask wins the race, the loop sets state to `'disconnected'` and then the disconnect listener overwrites it with `'port-lost'` (still fine). But on paths where the read loop simply completes naturally after a `reader.cancel()` during a user-initiated `disconnect()`, the loop also calls `setState('disconnected')` — which is redundant with `disconnect()`'s own `setState('disconnected')` on line 281 but harmless. The real issue is the asymmetry: the loop only cares about the `port-lost` case but treats every other state as reachable from a clean exit. Consider also preserving `'connected'` / `'reconnecting'` sentinel states that a mid-reconnect raceable path could expose.
**Fix:** Only set state if we're still in a transient read-loop-owning state:
```js
// Only transition to 'disconnected' from states where the read loop is the owner:
if (state === 'connected' || state === 'reconnecting') {
    setState('disconnected');
}
// 'port-lost' is preserved (disconnect listener owns it); 'disconnected'
// / 'connecting' means teardown already set the correct target state.
```

### WR-03: `handleReconnect` / `retryOpenOnce` do not call `teardown()` before re-opening

**File:** `www/transport/serial.js:517-543`
**Issue:** When the disconnect listener sets `state='port-lost'` without calling `teardown()`, the previous `writer`, `reader`, and `port` references remain live in module scope. `onNavSerialConnect` then routes to `handleReconnect(target)`, which calls `target.open(lastConfig)` and `target.writable.getWriter()` without first: (a) `unregisterWriter()` on the old writer, (b) awaiting `reader.cancel()` on the old reader, or (c) closing the old port. If the platform has not fully torn down the OS-side lock on the old port yet (e.g. very fast unplug→replug on the same USB hub port where the underlying handle lingered), this can leak a live writer reference in `tx-sink`'s `registeredWriter`, and `pushTxBytes` would attempt to write to the dead writer. The current `tx-sink.pushTxBytes` catch-block logs but does not unregister — so every keystroke logs a stack for the duration of the session.
**Fix:** Before the `open()` call, clean up stale refs:
```js
async function handleReconnect(target) {
    // Clean out any stale refs from the port-lost transition.
    if (writer) { try { writer.releaseLock(); } catch {} writer = null; unregisterWriter(); }
    if (reader) { try { await reader.cancel(); } catch {} reader = null; }
    // port reference may be the same or different from `target`; do not close
    // the dead handle here (the platform already invalidated it on disconnect).
    setState('reconnecting');
    // ...existing body
}
```

### WR-04: Paste-pump `'complete'` progress can fire twice on exact-chunk-boundary payloads

**File:** `www/input/paste-pump.js:99-127`
**Issue:** `writeOneChunk()` fires `'complete'` on line 101 when it re-enters with `remaining <= 0`, and also on line 125 when `cursor >= queue.length` after writing the final chunk. For most paste sizes only the line-125 path runs, but if `enqueuePaste` is called with an empty `bytes` array AND the queue is also empty, `fireProgress('started', …)` fires (line 52's guard uses `cursor < queue.length` which is false for empty, so this specific bug path is avoided) — however, `cancelPaste()`'s early-return guard on line 58 (`if (timer === null && cursor >= queue.length) return;`) is inconsistent with `isActive()` (line 67 uses OR, cancel uses AND-negated). After a `'complete'` event is fired naturally, if the UI calls `cancelPaste()` during the 2-second display window, the `timer===null && cursor >= queue.length` guard catches it and returns early — correct. But an explicit `enqueuePaste(new Uint8Array(0))` call after completion will reach line 51: the condition `!timer && cursor < queue.length` is false (queue empty), so nothing fires — silent no-op. Subtle, but a zero-byte enqueue should probably fire `'started' { total: 0 }` → `'complete'` for UI symmetry.
**Fix:** Early-return for empty paste:
```js
export function enqueuePaste(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const rewritten = applyCrlfRewrite(bytes);
    if (rewritten.length === 0 && cursor >= queue.length) {
        // Empty paste onto idle pump — emit started→complete for UI symmetry.
        fireProgress('started', { total: 0 });
        fireProgress('complete');
        return;
    }
    // ...existing merge logic
}
```

### WR-05: `tx-sink.pushTxBytes` never unregisters the writer on repeated `.write()` failures

**File:** `www/input/tx-sink.js:46-50`
**Issue:** The comment explicitly says "A failed write here does NOT unregister the writer; the serial.js teardown path handles lifecycle on port-lost." This is fine when the failure coincides with a port-lost event (disconnect listener fires, serial.js calls `unregisterWriter()`). But the Web Serial spec allows `writer.write()` to reject with `InvalidStateError` or a `TypeError` when the underlying stream is errored but the navigator.serial `disconnect` event has not yet fired (platform race on some Chromium versions, per Pitfall #11 territory). In that window, every subsequent keystroke routes through `pushTxBytes`, hits the still-registered writer, and logs another error. There is no backpressure relief and no UX signal to the user. The ring keeps growing.
**Fix:** Unregister on persistent failure:
```js
let writerErrored = false;
if (registeredWriter && !writerErrored) {
    registeredWriter.write(bytes).catch((err) => {
        console.error('[tx-sink] writer.write failed:', err);
        writerErrored = true;
        registeredWriter = null;  // prevent subsequent spam until re-registered
    });
}
// Reset writerErrored in registerWriter():
export function registerWriter(writer) { registeredWriter = writer; writerErrored = false; }
```

### WR-06: `errors.spec.js` "multiple CP2102N adapters" test asserts UI text after async dispatch without awaiting state transition source

**File:** `www/tests/transport/errors.spec.js:97-115`
**Issue:** The test calls `window.__simulateUnplug()`, asserts `data-state="port-lost"`, then mutates `navigator.serial._grantedPorts` directly to inject two new mock ports, and dispatches a synthetic `connect` event. The assertion sequence is racy because:
1. `onNavSerialConnect` is async (`await navigator.serial.getPorts()`)
2. `getPorts()` on the mock returns `[...this._grantedPorts]` — a snapshot — so the await microtask reads whatever `_grantedPorts` is when the microtask runs
3. The test mutates `_grantedPorts` synchronously BEFORE dispatching, so the snapshot should see both new ports — but the mock's `_grantedPorts` mutation happens between `__simulateUnplug` (which sets `port.connected=false` and `port.readable=null`) and the dispatch. If the handler reads `getPorts()` in a microtask that runs AFTER the dispatch returns but BEFORE the direct assignment, the test flaps.

In practice this test passes because `page.evaluate` serializes the block, but the ordering is fragile — a future refactor that adds any microtask to `__simulateUnplug` (e.g. awaiting a cancel) would break it silently.
**Fix:** Split the evaluate into ordered steps with explicit awaits:
```js
await page.evaluate(() => window.__simulateUnplug());
await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'port-lost');
await page.evaluate(() => {
    const Mock = navigator.serial._grantedPorts[0].constructor;
    navigator.serial._grantedPorts = [
        new Mock({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
        new Mock({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
    ];
});
await page.evaluate(() => {
    const ev = new Event('connect', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: navigator.serial._grantedPorts[0] });
    navigator.serial.dispatchEvent(ev);
});
```

## Info

### IN-01: `CRLF_MODES` re-export in paste-pump is a workaround for the linter

**File:** `www/input/paste-pump.js:12, 160`
**Issue:** The comment "CRLF_MODES re-export suppresses the 'unused import' linter warning" indicates that the import is imported-but-unused and the re-export is a hack. `applyCrlfRewrite` uses `getCrlfMode()` and does NOT reference `CRLF_MODES` at all. If the intention was to share a single frozen table between keyboard.js and paste-pump.js, the current implementation reads the `mode` string and rebuilds the rewrite inline — never consulting the `CRLF_MODES` values. Either use `CRLF_MODES[mode]` to look up the delimiter (for `'cr'` and `'lf'` single-char cases), or drop the import.
**Fix:** Drop the unused import and its re-export, or actually use the table:
```js
// Drop:
import { getLocalEcho, getCrlfMode } from './keyboard.js';
// (remove CRLF_MODES from the import list and remove the re-export on line 160)
```

### IN-02: `readFormConfig` docstring says "tiny window during boot before wireSerial has run" but the function is only called from `connectMicroBeast`

**File:** `www/transport/serial.js:189-198`
**Issue:** The docstring claims the PRESET_CONFIG fallback is needed "during the tiny window during boot before wireSerial has run." But `readFormConfig` has no external callers — it is only invoked from `connectMicroBeast` (line 242) and from the per-select `change` listener (lines 151). Both call sites run AFTER wireSerial completes. The fallback is really for the "test mounts serial.js without mounting the form" path, which is a different justification. Minor doc drift.
**Fix:** Clarify the docstring to reflect the real intent:
```js
// Returns PRESET_CONFIG when the form refs are absent (e.g. tests that bypass
// wireSerial's full opts object, or a future refactor that lets the module be
// imported without a DOM). Integer fallbacks guard DevTools-manipulated values.
```

### IN-03: `parseInt(x, 10) || 19200` pattern silently coerces `0` to the fallback

**File:** `www/transport/serial.js:192-194`
**Issue:** `parseInt(serialEls.baud.value, 10) || 19200` returns 19200 if the parsed value is 0 or NaN. 0 is not a legal baud, so this is "wrong for the right reason," but the intent is to guard against NaN; a DevTools user who inserts `<option value="0">` gets a silent fallback instead of an error. Not exploitable — T-05-04-01 threat register covers this — but the pattern is a code smell.
**Fix:** Explicit NaN check:
```js
const baud = Number.parseInt(serialEls.baud.value, 10);
baudRate: Number.isFinite(baud) && baud > 0 ? baud : 19200,
```

### IN-04: Auto-reconnect path never re-runs `persistVidPid` so a user who manually picks a second MicroBeast during `'multiple-adapters'` errors loses the persisted VID/PID update

**File:** `www/transport/serial.js:500, 545-553`
**Issue:** `finishReconnect` registers the writer, sets state to connected, and starts the read loop. It does NOT call `persistVidPid(target)`. If the user ever goes through the "Choose MicroBeast…" manual-disambiguate flow (not yet wired — it just logs and sets label text), they would eventually click the Connect button, which re-routes through `connectMicroBeast` and DOES call `persistVidPid`. So this is latent, not a live bug. Flag for Phase 6 when the "Choose MicroBeast…" flow is wired.
**Fix:** Add `persistVidPid(target)` to `finishReconnect` for symmetry, or add a note in 05-06-PLAN referencing this line.

### IN-05: `runReadLoop` never logs when `p.readable` becomes null outside an explicit teardown

**File:** `www/transport/serial.js:303-328`
**Issue:** When the outer `while (p.readable)` condition becomes false (fatal error: the platform set `readable` to null), no error-log entry is appended. The `handleReadError` catch-block fires only on `reader.read()` rejection; a platform-driven `readable = null` transition between read calls would silently exit the loop with no user-facing signal. Real Chromium does fire a `disconnect` event in this case, so `onNavSerialDisconnect` drives the state transition — but the dual-path (read loop exits AND disconnect listener fires) means redundant `setState('port-lost')` calls, each of which triggers `applyStateToButton` and fires every observer. Harmless but chatty.
**Fix:** Guard `setState` to skip redundant transitions:
```js
function setState(s) {
    if (state === s) return;     // idempotent
    state = s;
    applyStateToButton();
    for (const fn of stateObservers) fn(s);
}
```

### IN-06: `applyCrlfRewrite` does an unnecessary second pass for `'crlf'` mode

**File:** `www/input/paste-pump.js:142-155`
**Issue:** The first pass counts 0x0D bytes to size the output buffer; the second pass copies. This is O(2n). An upper-bound allocation (`bytes.length * 2`) with a `.subarray(0, w)` at the end is O(n) and almost always faster in V8 (the allocator is bumper-cheap and the shrink is a slice-not-copy). Scope note: Performance is out of v1 scope per review rules, so this is Info, not Warning.
**Fix:** One-pass with upper-bound alloc:
```js
const out = new Uint8Array(bytes.length * 2);
let w = 0;
for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0D) { out[w++] = 0x0D; out[w++] = 0x0A; }
    else { out[w++] = bytes[i]; }
}
return out.subarray(0, w);
```

### IN-07: Test helper `mock-serial.js` defines `origOpen` but never uses it

**File:** `www/tests/transport/readloop.spec.js:46-47`
**Issue:** Inside the `reader.read called with no size hint` test: `const origOpen = navigator.serial.constructor.prototype; // noop` — this is dead code with a self-mocking comment. Harmless, but confusing to maintainers.
**Fix:** Delete the line; the polling-interval approach below is the actual instrumentation.

### IN-08: `renderPoliteFail` uses `innerHTML` with a static string, but the comment says "use textContent for user-provided strings"

**File:** `www/transport/serial.js:64-73`
**Issue:** The current content is 100% static, so innerHTML is safe. The inline comment ("if extending, use textContent for user-provided strings, not innerHTML — threat-register T-05-02-01 mitigation") is correct guidance. However, the `github.com/{TBD-during-Phase-6}` placeholder is marked in braces — if a future change pulls that from a config file and interpolates with template literals, the static-string property is lost. Recommend making the contract harder to violate:
**Fix:** Build the DOM with `document.createElement` / `textContent`, eliminating the innerHTML path entirely:
```js
export function renderPoliteFail() {
    document.title = 'BestialiTTY — Chromium required';
    document.body.classList.add('polite-fail');
    document.body.replaceChildren();   // clear
    const h1 = document.createElement('h1');
    h1.textContent = 'BestialiTTY requires a Chromium-based browser';
    document.body.append(h1);
    // ...etc; textContent for every user-visible string
}
```

---

_Reviewed: 2026-04-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
