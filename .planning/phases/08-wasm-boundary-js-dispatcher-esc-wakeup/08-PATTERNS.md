# Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup — Pattern Map

**Mapped:** 2026-05-07
**Files analyzed:** 9 (3 modified Rust, 4 modified/new JS, 4+ test specs)
**Analogs found:** 9 / 9 (all exact role + data-flow matches in repo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `crates/bestialitty-core/src/lib.rs` (Slide façade addition) | wasm-binding facade | request-response (one-line forwards) | `crates/bestialitty-core/src/lib.rs:34-191` (existing `Terminal` façade in same `mod wasm_boundary`) | **exact** — sibling addition in the same `mod wasm_boundary` block |
| `www/transport/slide.js` (NEW) | transport / dispatcher module | event-driven (per-byte routing) + request-response (slide.feed_chunk) | `www/input/paste-pump.js` (module-scope state + `wireXxx` initializer + Uint8Array queue + injected term/sample/drain refs) | **exact** — same idiom (module-scope refs, `wireXxx({ ... })` boot init, `pushTxBytes`-equivalent calls) |
| `www/transport/serial.js:453` | transport hot-path edit | streaming (Web Serial read loop) | (self) | **edit-in-place** — single-line replacement of `term.feed(value)` → `dispatchInbound(value)` |
| `www/input/tx-sink.js` (modified — owner state + writeSlideFrame) | TX sink / writer-coupling | request-response (writer.write) + event-driven (push) | `www/input/tx-sink.js:27,46-50,78-81` (existing `registeredWriter` + Phase 5 D-21 `register/unregisterWriter` pattern) | **self** — extending the same module's existing patterns |
| `www/main.js` (boot wiring add) | composition root | sequential init | `www/main.js:321-332,357,371-389` (existing `wireKeyboard / wirePastePump / wireSessionLog / await wireSerial` boot sequence) | **exact** — drop in `wireSlideDispatcher` between `wireSessionLog` and `await wireSerial` |
| `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` (NEW) OR extension to `boundary_api_shape.rs` | compile-time API contract | n/a (compile-time fn-pointer coercion) | `crates/bestialitty-core/tests/slide_boundary_shape.rs` (Phase 7 inner-API pin) + `boundary_api_shape.rs:280-318` (Phase 2 wasm fn-pointer pin pattern) | **exact** — same fn-pointer coercion convention |
| `www/tests/transport/slide-wakeup.spec.js` (NEW) | Playwright test | event-driven mock pump | `www/tests/transport/readloop.spec.js` (uses `SERIAL_MOCK` + `__mockReaderPush`) | **exact** — same mock harness, same setup helper |
| `www/tests/transport/slide-dispatcher.spec.js` (NEW) | Playwright test | event-driven | `www/tests/transport/readloop.spec.js` + `lifecycle.spec.js` | **exact** |
| `www/tests/input/tx-sink.spec.js` (NEW or extension) | Playwright test | request-response | `www/tests/input/tx-debug-strip.spec.js` (existing input-level Playwright spec testing tx-sink-driven UI) | **role-match** — extend with a `wire-owner` describe block |

---

## Pattern Assignments

### `crates/bestialitty-core/src/lib.rs` — Slide façade addition (D-10)

**Analog:** `crates/bestialitty-core/src/lib.rs:34-191` (the existing `Terminal` façade in the same file, same `mod wasm_boundary` block).

**Module-level cfg gate** (lines 34-36 — verbatim, the `Slide` impl block goes inside this same module):
```rust
#[cfg(target_arch = "wasm32")]
mod wasm_boundary {
    use wasm_bindgen::prelude::*;
```

**Inner-type alias to avoid name collision** (line 39 — Phase 8 mirrors with `CoreSlide`; collision-resolution pattern is load-bearing per Pitfall 6):
```rust
use crate::terminal::Terminal as CoreTerminal;
// Phase 8 ADDS:
use crate::slide::Slide as CoreSlide;
```

**Constructor pattern** (lines 54-67 — `Terminal::new` is the verbatim template):
```rust
#[wasm_bindgen]
pub struct Terminal {
    inner: CoreTerminal,
}

#[wasm_bindgen]
impl Terminal {
    #[wasm_bindgen(constructor)]
    pub fn new(rows: u32, cols: u32, scrollback_cap: usize) -> Terminal {
        Terminal {
            inner: CoreTerminal::new(rows, cols, scrollback_cap),
        }
    }
```

**One-line forward pattern** (lines 77-79, 84-95 — every method body is exactly `self.inner.METHOD(args)`):
```rust
pub fn feed(&mut self, bytes: &[u8]) {
    self.inner.feed_silent(bytes);
}

pub fn host_reply_ptr(&self) -> *const u8 {
    self.inner.host_reply_ptr()
}

pub fn host_reply_len(&self) -> usize {
    self.inner.host_reply_len()
}

pub fn clear_host_reply(&mut self) {
    self.inner.clear_host_reply();
}
```

**Apply to Slide:** wrap the methods pinned by `tests/slide_boundary_shape.rs`: `new`, `enter_recv_mode`, `feed_byte`, `feed_chunk`, `take_event_packed`, `state`, `outbound_ptr`, `outbound_len`, `clear_outbound`, `cancel`, `force_idle`. The `outbound_*` triple is a verbatim mirror of the `host_reply_*` triple at lines 83-95.

---

### `www/transport/slide.js` (NEW — D-01..D-09)

**Primary analog:** `www/input/paste-pump.js` (module-scope state + injected refs + `wireXxx` initializer + Uint8Array byte queue + interaction with `tx-sink.js`).

**Module header / source attribution comment** (paste-pump.js:1-9 — Phase 8 mirrors this exact block style):
```js
// BestialiTTY Phase 5 — paste throttling queue (setTimeout chain).
//
// Public API: enqueuePaste, cancelPaste, isActive, onProgress, onPortLost, wirePastePump.
//
// Sources:
//   - 05-CONTEXT.md D-12..D-23.
//   - 05-RESEARCH.md Pattern 4 (setTimeout chain; Pitfall 6 — 4ms clamp).
//   - 05-UI-SPEC.md §"Paste-pump UI interactions" + §"Connection pane" progress copy.
//   - Analog: www/input/tx-sink.js (module-scope state + observer fan-out).
```

**Module-scope state pattern** (paste-pump.js:14-28 — locked by D-01 for `mode`, `wakeIdx`, `scratch`, `slide`, `termRef`, `txSinkRef`, `wasmRef`):
```js
// Compile-in constants — D-14 (32B / 18ms @ 19200 targets 90% of 1920 B/s byte rate).
const CHUNK_SIZE = 32;

// Pump state.
let gapMs = computeGap(19200);
let queue = new Uint8Array(0);
let cursor = 0;
let timer = null;
const progressObservers = [];

// Injected deps (wirePastePump sets these — enables D-22 local-echo from the pump).
let termRef = null;
let sampleBellFn = null;
let drainHostReplyFn = null;
let requestFrameFn = null;
```

**`wireXxx` initializer pattern** (paste-pump.js:32-38 — Phase 8 D-05 default `wireSlideDispatcher` mirrors):
```js
export function wirePastePump(opts) {
    const { term, sampleBell, drainHostReply, requestFrame } = opts;
    termRef = term;
    sampleBellFn = sampleBell;
    drainHostReplyFn = drainHostReply;
    requestFrameFn = requestFrame;
}
```

**Routing-into-tx-sink + post-feed invariant** (paste-pump.js:108-118 — directly load-bearing for `dispatchInbound`'s `'terminal'` branch which must preserve the post-feed invariant per Pitfall 1):
```js
// D-21 — route through tx-sink (which calls registeredWriter.write when connected).
pushTxBytes(chunk);

// D-22 — local-echo: feed chunk to term after writer.write, preserving
// sampleBell → drainHostReply → requestFrame invariant.
if (getLocalEcho() && termRef) {
    termRef.feed(chunk);
    if (sampleBellFn) sampleBellFn();
    if (drainHostReplyFn) drainHostReplyFn('paste-echo');
    if (requestFrameFn) requestFrameFn();
}
```

**Secondary analog — `www/renderer/scroll-state.js:12-39`** for the explicit module-scope state declaration block + `wireXxx` deconstruct + injected-deps comment style:
```js
// Module-scope state.
let offset = 0;                      // 0 = live tail; > 0 = N rows back
let trackpadAccumulator = 0;         // fractional deltaY accumulator (D-02)
let newLinesSinceUserScrolled = 0;   // chip counter (D-03)
let needsRepaint = false;            // D-08 paint-once gate
const changeObservers = [];

// Injected deps.
let termRef = null;
let canvasWrapperRef = null;
// ...

// Constants per CONTEXT D-02.
const TRACKPAD_TICK_PX = 30;
// ...

export function wireScrollState(opts) {
    const { term, canvasWrapper, indicator, indicatorText, requestFrame, markAllRowsDirty } = opts;
    termRef = term;
    // ...
}
```

**Tertiary analog — `www/transport/session-log.js:18-48`** for the simplest `wireXxx` shape with click-handler registration + state reset; Phase 8's `slidePumpOnPortLost()` Phase-11-stub follows the same export-now-implement-later precedent:
```js
// Module-scope state.
let chunks = [];
let totalBytes = 0;
let downloadBtnRef = null;

export function wireSessionLog(opts) {
    downloadBtnRef = opts.downloadButton;
    // ...
}

// D-29 — reset on each Connect.
export function reset() {
    chunks = [];
    totalBytes = 0;
    setButtonState(false);
}
```

**Test-introspection hook pattern** (main.js:154-181 — Phase 8 exposes `window.__slide` similarly for Playwright):
```js
// Test introspection (mirrors window.__testGridView precedent at main.js:55-64).
window.__scrollState = scrollState;
window.__term = term;
window.__wasm = wasm;
```

---

### `www/transport/serial.js:453` — single-line edit (D-06)

**Self-edit at the line in question** (serial.js:444-462 — only line 453 changes; the surrounding post-feed invariant block stays verbatim):
```js
async function runReadLoop(p) {
    while (p.readable) {
        if (shuttingDown) break;     // Gap 1 fix
        reader = p.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;                        // D-36 — cancel() resolves here
                term.feed(value);                        // <<< CHANGE THIS LINE TO: dispatchInbound(value);
                sampleBellFn();                          // Phase 3 post-feed invariant
                drainHostReplyFn('serial');              // Phase 2 host-reply accessor drain
                requestFrameFn();                        // Phase 3 dirty-repaint wake
                if (sessionLogRef) sessionLogRef.append(value);
            }
        } catch (err) {
            handleReadError(err);
        } finally {
            try { reader.releaseLock(); } catch { /* already released */ }
            reader = null;
        }
    }
    // ...
}
```

**Edit:**
```js
//                term.feed(value);                        // Phase 2 feed_silent; raw Uint8Array
                  dispatchInbound(value);                  // Phase 8 D-06 — routes to term.feed OR slide.feed_chunk
```

**Import addition at top of file:**
```js
import { dispatchInbound } from './slide.js';
```

The `sampleBellFn / drainHostReplyFn / requestFrameFn / sessionLogRef.append(value)` lines remain verbatim — Pitfall 1 mandates the post-feed invariant runs unchanged.

---

### `www/input/tx-sink.js` — owner state + writeSlideFrame (D-08)

**Analog (self):** `www/input/tx-sink.js:27,46-50,78-81` — the existing `registeredWriter` reference and Phase 5 D-21 `registerWriter` / `unregisterWriter` pair. Phase 8 extends the same module's existing patterns; no new file.

**Existing writer-registration coupling** (tx-sink.js:27,78-81 — verbatim, NOT modified):
```js
// Phase 5 D-21 — when a writer is registered (serial.js does this on connect),
// every pushTxBytes call ALSO writes bytes to the wire synchronously after
// appending to the ring.
let registeredWriter = null;

// (lines 78-81)
export function registerWriter(writer) { registeredWriter = writer; }
export function unregisterWriter()     { registeredWriter = null; }
```

**Existing `pushTxBytes` write-coupling** (tx-sink.js:31-51 — modify by adding the silent-drop check at the TOP of the function body, before the ring write):
```js
export function pushTxBytes(bytes) {
    // Phase 8 D-08 — INSERT HERE: silent drop during SLIDE session.
    // if (owner === 'slide') return;

    // Accept Uint8Array or plain Array<number>. Fast path for typed arrays.
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
        ring[writeIdx] = bytes[i] & 0xFF;
        writeIdx = (writeIdx + 1) % RING_CAP;
        if (writeIdx === 0) wrapped = true;
    }
    notify();

    // Phase 5 D-21 — send on the wire when connected. Fire-and-forget;
    if (registeredWriter) {
        registeredWriter.write(bytes).catch((err) => {
            console.error('[tx-sink] writer.write failed:', err);
        });
    }
}
```

**`writeSlideFrame` reuses the same `registeredWriter.write(bytes).catch(...)` shape** as Phase 5 D-21 inside `pushTxBytes` (tx-sink.js:46-50). Verbatim error-handling style:
```js
// Phase 8 D-08 NEW — bypass the keystroke ring entirely for binary frames.
export function writeSlideFrame(bytes) {
    if (!registeredWriter) {
        console.error('[tx-sink] writeSlideFrame: no writer registered');
        return;
    }
    registeredWriter.write(bytes).catch((err) => {
        console.error('[tx-sink] writeSlideFrame failed:', err);
    });
}
```

**Module-scope state add** (mirror the existing single-line `let registeredWriter = null;`):
```js
// Phase 8 D-08 — wire-owner state (default 'terminal'; 'slide' silences pushTxBytes).
let owner = 'terminal';

export function setWireOwner(o) {
    if (o !== 'terminal' && o !== 'slide') {
        throw new Error(`[tx-sink] invalid owner: ${o}`);
    }
    owner = o;
}
export function getWireOwner() { return owner; }
```

---

### `www/main.js` — boot wiring addition

**Analog:** `www/main.js:321-389` — the `wireKeyboard → wirePastePump → wireClipboard → wireSessionLog → await wireSerial` sequence.

**Existing boot sequence** (lines 321-332 — Phase 8 inserts `wireSlideDispatcher` after `wireSessionLog` and BEFORE `await wireSerial` per Pitfall 8):
```js
wireKeyboard({
    term,
    terminalWrapper,
    sampleBell,
    drainHostReply,
    requestFrame,
});

// Phase 5 Wave 5 — wire paste-pump's local-echo feed path (D-22). MUST be
// called AFTER wireKeyboard (deps are resolved) and BEFORE wireSerial so the
// pump is ready to accept bytes the instant the port opens.
wirePastePump({ term, sampleBell, drainHostReply, requestFrame });
```

**Existing import-from-pkg pattern** (line 38 — Phase 8 adds `Slide` to this import):
```js
import init, { Terminal } from './pkg/bestialitty_core.js';
// Phase 8: import init, { Terminal, Slide } from './pkg/bestialitty_core.js';
```

**Existing test-introspection pattern** (lines 154-164):
```js
window.__scrollState = scrollState;
window.__term = term;
window.__wasm = wasm;
window.__requestFrame = requestFrame;
```

**Apply to Phase 8:** insert `wireSlideDispatcher({ term, txSink: { setWireOwner, writeSlideFrame, getWireOwner }, slideCtor: Slide, wasm })` between line 357 (`wireSessionLog({ downloadButton: downloadLogBtn });`) and line 371 (`await wireSerial({...})`). Add `window.__slide = { __resetForTests, __getStateForTests, dispatchInbound };` for Playwright introspection.

---

### `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` (NEW) — or extension to `boundary_api_shape.rs`

**Primary analog:** `crates/bestialitty-core/tests/slide_boundary_shape.rs` (Phase 7's inner-API pin via fn-pointer coercion). This file IS the template — Phase 8's wasm-façade pin sibling-mirrors it.

**File header pattern** (slide_boundary_shape.rs:1-21 — Phase 8 mirrors header):
```rust
//! SLIDE boundary API shape contract — Phase 8 anticipation pin.
//!
//! Phase 8 will wrap `Slide` in `lib.rs:wasm_boundary` with feed_byte /
//! feed_chunk / outbound_ptr / outbound_len / clear_outbound / state /
//! cancel / force_idle / take_event_packed exports. If any of these
//! signatures drift — a method removed, a return type changed, a `pub`
//! accidentally narrowed to `pub(crate)` — Phase 8 will fail at the
//! wasm-pack build step with a cryptic error.
//!
//! This file pins the shape as a compile-time contract: every #[test]
//! below is a runtime fn call that only compiles if the public API matches
//! the shape stated in 07-CONTEXT.md and ARCHITECTURE.md §1. Compile
//! failure IS the intended failure mode.
//!
//! Direct mirror of crates/bestialitty-core/tests/boundary_api_shape.rs:280-318.
```

**fn-pointer coercion pattern** (slide_boundary_shape.rs:36-61 — verbatim shape; for Phase 8 the function pointers cite the *inner* `crate::slide::Slide` because the wasm façade is `#[cfg(target_arch = "wasm32")]`-gated and native `cargo test` cannot see it; fn-pointers against the inner type catch any drift the façade would otherwise hide):
```rust
#[test]
fn slide_lifecycle_methods_have_stable_signatures() {
    let _: fn(&mut Slide)              = Slide::enter_recv_mode;
    let _: fn(&mut Slide)              = Slide::cancel;
    let _: fn(&mut Slide)              = Slide::force_idle;
}

#[test]
fn slide_feed_methods_have_stable_signatures() {
    let _: fn(&mut Slide, u8) -> u32   = Slide::feed_byte;
    let _: fn(&mut Slide, &[u8]) -> u32 = Slide::feed_chunk;
    let _: fn(&mut Slide) -> u32       = Slide::take_event_packed;
}

#[test]
fn slide_outbound_accessors_have_stable_signatures() {
    let _: fn(&Slide) -> *const u8     = Slide::outbound_ptr;
    let _: fn(&Slide) -> usize         = Slide::outbound_len;
    let _: fn(&mut Slide)              = Slide::clear_outbound;
}
```

**Phase-2 wasm-façade pin pattern** (`boundary_api_shape.rs:280-318` — when the wasm façade is added to `lib.rs`, the same fn-pointer coercion applies to native types because `Slide`'s methods on the wasm side are forwards to identical-signature inner methods; a drift in EITHER side breaks compile):
```rust
#[test]
fn feed_silent_does_not_return() {
    // Compile-time pin: a future change to `feed_silent` that introduces
    // a return type (e.g. reverting to `-> Vec<u8>`) would reintroduce the
    // wasm-bindgen `.slice()` and fail the SC-3 contract. This assertion
    // fails to compile if the signature drifts.
    let _: fn(&mut Terminal, &[u8]) = Terminal::feed_silent;
}

#[test]
fn phase6_snapshot_grid_at_and_clear_visible_signatures_pinned() {
    // Phase 6 D-06 + D-26: pinned method signatures.
    let _: fn(&mut Terminal, usize) = Terminal::snapshot_grid_at;
    let _: fn(&mut Terminal) = Terminal::clear_visible;

    let mut term = Terminal::new(24, 80, 100);
    term.snapshot_grid_at(0_usize);
    term.clear_visible();
    let _ = &term;
}
```

**Decision (Claude's Discretion):** the cleaner path is to ADD a new sibling test file `tests/slide_wasm_boundary_shape.rs` that imports `bestialitty_core::slide::Slide` and pins exactly the surface the wasm façade forwards (the 11 methods named in D-10), with a header note that this file pins the wasm-façade-shape via the inner type because the façade itself is wasm32-only. Sibling-mirroring the Phase 7 file (`slide_boundary_shape.rs`) keeps grep locality clean.

---

### `www/tests/transport/slide-wakeup.spec.js` (NEW)

**Analog:** `www/tests/transport/readloop.spec.js` (Phase 5 — uses `SERIAL_MOCK` + `__mockReaderPush`). Verbatim setup helper.

**Setup helper** (readloop.spec.js:7-13 — Phase 8 reuses verbatim):
```js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}
```

**Connect + reader-ready poll + push pattern** (readloop.spec.js:17-34):
```js
test('pushed bytes feed into term.feed and render on grid @fast', async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    // Wait for the connect path + read loop to start (reader created).
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 2000 },
    ).toBe(true);
    // Push 'HELLO' through the mock reader.
    await page.evaluate(() => window.__mockReaderPush([0x48, 0x45, 0x4C, 0x4C, 0x4F]));
    // Read back from the grid — term.feed should have rendered 'HELLO' at row 0.
    await expect.poll(
        () => page.evaluate(() => {
            const g = window.__testGridView();
            return String.fromCharCode(g[0], g[8], g[16], g[24], g[32]);
        }),
        { timeout: 2000 },
    ).toBe('HELLO');
});
```

**Apply to wakeup spec:** push the 7-byte signature `[0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]` in various split-points (whole, [0,1]/[1..7], [0,3]/[3..7], etc.) and assert via `window.__slide.__getStateForTests()` that `mode === 'recv'` after the full match. Push partial-match cases `[0x1B, 0x5E, 0x41]` and assert `mode === 'terminal'` with `wakeIdx === 0` AND grid shows the bytes via `__testGridView()` (replay-on-fail preserved baseline). Push the mid-prefix retry `[0x1B, 0x5E, 0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]` and assert `mode === 'recv'` (D-02 critical clause). Use ALL 7 internal split points per Phase 1 torn-chunk corpus convention.

---

### `www/tests/transport/slide-dispatcher.spec.js` (NEW)

**Analog:** `www/tests/transport/readloop.spec.js` + `www/tests/transport/lifecycle.spec.js` (lifecycle.spec.js shows the connect-then-poll-then-clear-log pattern).

**`__mockWriterLog` introspection pattern** (lifecycle.spec.js:30-37):
```js
// Clear the lock log after setup (requestPort.open may have appended noise).
await page.evaluate(() => { window.__mockLockLog = []; });

// Connect so a port/reader/writer actually exist.
await page.locator('#connect-button').click();
await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');

// Clear again — we only care about events AFTER beforeunload fires.
await page.evaluate(() => { window.__mockWriterLog = []; });
```

**Apply to dispatcher spec:** drive a full SLIDE recv session via mock reader pushes (wakeup → slide.feed_chunk → CTRL_RDY/CTRL_ACK frames), assert via `window.__mockWriterLog` that ACK bytes were written via `writeSlideFrame`, and that during the session a `pushTxBytes([...keystroke...])` is silently dropped (no entry appended to `__mockWriterLog`). After session end (`Done`), assert `getWireOwner() === 'terminal'` and a fresh keystroke DOES land in `__mockWriterLog`. Pattern 4 (Pitfall 3 — TX owner not flipped back) is the load-bearing test.

---

### `www/tests/input/tx-sink.spec.js` (NEW or extension)

**Analog:** `www/tests/input/tx-debug-strip.spec.js` (existing input-level Playwright spec that drives keypresses and asserts on `#tx-strip` content; Phase 8 extends with a `wire-owner` describe block).

**describe-block pattern** (tx-debug-strip.spec.js:6-44):
```js
test.describe('SC-1 — TX hex strip', () => {
    test('placeholder shows before any keypress', async ({ page }) => {
        await page.goto('/');
        await page.locator('#debug').evaluate((el) => { el.open = true; });
        await expect(page.locator('#tx-strip')).toHaveText(PLACEHOLDER);
    });

    test('arrow press updates strip; Reset TX restores placeholder @fast', async ({ page }) => {
        await page.goto('/');
        await page.locator('#terminal-wrapper').focus();
        await page.waitForFunction(() => document.getElementById('terminal').width > 0);
        // ...
    });
});
```

**Apply:** add a `test.describe('SC-4 — wire-owner handoff', () => { ... })` block. Tests:
1. Default `getWireOwner() === 'terminal'`; arrow press lands in `__mockWriterLog`.
2. After `setWireOwner('slide')`: arrow press DOES NOT land in `__mockWriterLog` (silent drop).
3. After `setWireOwner('terminal')` again: next arrow press DOES land.
4. `writeSlideFrame([0x12, 0x34])` lands in `__mockWriterLog` regardless of owner state.
5. Invalid owner (`setWireOwner('garbage')`) throws.

Use `page.evaluate()` to invoke `window.__txSink.setWireOwner(...)` (add this introspection alongside `window.__slide` in main.js).

---

## Shared Patterns

### Module-scope state with `wireXxx({...})` initializer (Codebase Grain)

**Sources:**
- `www/input/paste-pump.js:14-38`
- `www/renderer/scroll-state.js:12-39`
- `www/transport/session-log.js:18-40`
- `www/input/tx-sink.js:16-27`

**Apply to:** `www/transport/slide.js` (NEW). Locked by D-01. The `wireSlideDispatcher({ term, txSink, slideCtor, wasm })` shape mirrors `wirePastePump({ term, sampleBell, drainHostReply, requestFrame })`.

```js
// Module-scope state.
let mode = 'terminal';
let wakeIdx = 0;
const scratch = new Uint8Array(6);
let slide = null;

// Injected deps.
let termRef = null;
let txSinkRef = null;
let wasmRef = null;
let SlideCtor = null;

export function wireSlideDispatcher(opts) {
    const { term, txSink, slideCtor, wasm } = opts;
    termRef = term;
    txSinkRef = txSink;
    SlideCtor = slideCtor;
    wasmRef = wasm;
}
```

### Zero-Copy Outbound Drain (Mirror of `host_reply` Triple)

**Sources:**
- `crates/bestialitty-core/src/lib.rs:83-95` (Rust side: `host_reply_ptr` / `host_reply_len` / `clear_host_reply`)
- `www/main.js:266-289` (JS side: `reDeriveHostReplyView` + `drainHostReply` pattern)

**Apply to:** the Slide façade's `outbound_ptr` / `outbound_len` / `clear_outbound` triple AND the JS-side drainSlideOutbound helper inside `transport/slide.js`. Locked by D-11.

```js
// Source: D-11 + main.js:274-289 host_reply mirror.
const HOST_REPLY_VIEW_CAP = 8;
let hostReplyView = null;
let hostReplyBuffer = null;

function reDeriveHostReplyView() {
    if (wasm.memory.buffer !== hostReplyBuffer) {
        hostReplyView = new Uint8Array(wasm.memory.buffer, term.host_reply_ptr(), HOST_REPLY_VIEW_CAP);
        hostReplyBuffer = wasm.memory.buffer;
    }
}

function drainHostReply(tag) {
    const replyLen = term.host_reply_len();
    if (replyLen > 0) {
        reDeriveHostReplyView();
        console.log(`[host_reply ${tag}]`, Array.from(hostReplyView.subarray(0, replyLen)));
        term.clear_host_reply();
    }
}
```

The Phase 8 `drainSlideOutbound` mirrors this verbatim with two differences:
1. View capacity is 16 (not 8) per Phase 7 OUTBOUND_RESERVE.
2. Bytes go to `txSink.writeSlideFrame(view.slice())` — `.slice()` is mandatory per Pitfall 5 (await-write-straddles-memory-growth).

### Compile-Time fn-Pointer Coercion for Boundary Pins

**Sources:**
- `crates/bestialitty-core/tests/boundary_api_shape.rs:286,312-313` (Phase 2 wasm-façade fn-pointer pin)
- `crates/bestialitty-core/tests/slide_boundary_shape.rs:36-61` (Phase 7 inner-API fn-pointer pin)

**Apply to:** `tests/slide_wasm_boundary_shape.rs` (NEW). Pin the 11 inner-`Slide` methods the wasm façade forwards to via fn-pointer coercion. Compile failure on signature drift IS the intended failure mode.

### Test Introspection via `window.__xxx` Hooks

**Sources:**
- `www/main.js:154-164` (`window.__scrollState`, `window.__term`, `window.__wasm`)
- `www/main.js:212` (`window.__testGridView`)
- `www/main.js:357-365` (`window.__sessionLog`)
- `www/tests/transport/mock-serial.js:13-25` (`window.__mockReaderPush`, `window.__mockWriterLog`)

**Apply to:** Phase 8 exposes `window.__slide = { __resetForTests, __getStateForTests, dispatchInbound }` and `window.__txSink = { setWireOwner, getWireOwner, writeSlideFrame }` in main.js after `wireSlideDispatcher`. Mirrors the `window.__sessionLog` precedent.

### Source-Attribution Comment Block at Top of New Files

**Sources:** every analogous file (paste-pump.js:1-9, session-log.js:1-16, scroll-state.js:1-10, tx-sink.js:1-14). All cite the relevant CONTEXT.md D-* numbers + RESEARCH.md patterns + analog files.

**Apply to:** `www/transport/slide.js`'s header should cite D-01..D-09, RESEARCH §Pattern 1+2+3+4, PITFALLS §1+§2, and the paste-pump.js / scroll-state.js analogs.

---

## No Analog Found

None. Phase 8 is integration of existing patterns; every file has a strong analog in the repo.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | — |

---

## Metadata

**Analog search scope:**
- `crates/bestialitty-core/src/` (Rust core)
- `crates/bestialitty-core/tests/` (Rust integration tests)
- `www/transport/` (JS transport layer)
- `www/input/` (JS input layer)
- `www/renderer/` (JS renderer layer — for module-scope state idiom analogs)
- `www/tests/transport/`, `www/tests/input/` (Playwright specs)

**Files scanned:** ~30 (read fully or via Grep for pattern locations).

**Pattern extraction date:** 2026-05-07

**Verification anchors (file:line citations):**
- `crates/bestialitty-core/src/lib.rs:34-191` — Terminal façade (Slide template)
- `crates/bestialitty-core/src/lib.rs:39` — `use crate::terminal::Terminal as CoreTerminal` (collision-resolution template)
- `crates/bestialitty-core/src/lib.rs:83-95` — host_reply zero-copy triple (outbound mirror)
- `crates/bestialitty-core/tests/slide_boundary_shape.rs:1-112` — Phase 7 inner-API pin (sibling-mirror template)
- `crates/bestialitty-core/tests/boundary_api_shape.rs:280-318` — Phase 2 wasm-façade fn-pointer pattern
- `www/transport/serial.js:444-477` — runReadLoop with line 453 single-line edit point
- `www/input/tx-sink.js:1-88` — full module (D-08 self-modification site)
- `www/input/paste-pump.js:1-165` — full module (slide.js primary analog)
- `www/renderer/scroll-state.js:12-77` — module-scope state + wireScrollState (slide.js secondary analog)
- `www/transport/session-log.js:1-112` — full module (slide.js tertiary analog; simplest wireXxx shape)
- `www/main.js:38,154-164,212,266-289,321-389` — boot wiring + test introspection + drainHostReply pattern
- `www/tests/transport/readloop.spec.js:1-139` — Playwright dispatcher-test template
- `www/tests/transport/lifecycle.spec.js:1-50` — `__mockWriterLog` clear-and-assert template
- `www/tests/input/tx-debug-strip.spec.js:1-44` — input-level test extension template
- `www/tests/transport/mock-serial.js:1-80` — mock harness API surface
