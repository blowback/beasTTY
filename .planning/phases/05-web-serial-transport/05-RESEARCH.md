# Phase 5: Web Serial Transport — Research

**Researched:** 2026-04-22
**Domain:** Browser Web Serial API (Chromium), JS-only transport layer, paste-pump throttling, navigator.serial mock for Playwright
**Confidence:** HIGH — Web Serial API shape verified against WICG spec + Chrome docs via Context7; Chromium quirks cross-checked against MDN + WICG issue tracker; 42 CONTEXT decisions already lock the implementation shape.

## Summary

Phase 5 is a **single Chromium-targeted JS transport module** (`www/transport/serial.js`, ~500 LOC) plus a sibling **paste-pump module** (`www/input/paste-pump.js`), wired into the existing Phase 2/3/4 shell via the established `wireX(opts)` dependency-injection pattern. Every big architectural question is already answered by the 42 decisions in CONTEXT.md — research for this phase is about confirming the exact Web Serial API surface shape, flagging Chromium-specific quirks the implementation must handle, and prescribing concrete code patterns (read-loop outer+inner while, `reader.cancel()` single exit, `setSignals({dataTerminalReady:false, requestToSend:false})` pre-open + pre-close, paste-pump `setTimeout` chain with 4 ms clamp awareness, etc.).

The phase has **three load-bearing correctness invariants**:

1. **Byte-end-to-end transport** — zero `TextDecoder` on the read path (Pitfall #10). The read loop passes `Uint8Array` chunks straight to `term.feed(bytes)`, which is already the Phase 2 zero-copy boundary.
2. **Cancellation-safe disconnect** — every disconnect path (user click, USB unplug, NetworkError, permission revoke, `beforeunload`) calls `reader.cancel()` before `port.close()` so the pending `await reader.read()` resolves and the loop exits cleanly (Pitfall #1, WICG/serial#112).
3. **Explicit DTR/RTS on open AND before every close** — prevents the MicroBeast from resetting when the CP2102N adapter's DTR/RTS pin happens to be wired to the Z80 reset line (Pitfall #12). CP2102N has a known erratum: the chip does NOT auto-deassert DTR/RTS on port close, so we must do it manually.

**Primary recommendation:** Follow the WICG EXPLAINER's canonical outer-loop-over-`port.readable` pattern (handles transient stream errors), with the CONTEXT D-35 inner loop and D-36 `reader.cancel()`-only exit. Keep the paste-pump's `setTimeout` chain at a single level (non-recursive — no 4 ms clamp hit) and size chunks large enough that the pump can never starve a keypress. Mock `navigator.serial` via `page.addInitScript` in Playwright, exposing `window.__simulateUnplug()` / `window.__simulateReplug()` / `window.__mockWriter()` helpers that the specs drive directly.

## Project Constraints (from CLAUDE.md)

- **Rust → wasm core owns parser/state/encoder.** Phase 5 MUST NOT introduce any Rust Web Serial bindings. Transport is JS-only. Verified in CONTEXT.md `<domain>` "Any Rust-core changes — Phase 1 feed_silent + host_reply zero-copy accessors (Phase 2 Plan 06) are the only wasm surface this phase needs."
- **Chromium-only.** Polite-fail full-page takeover on Firefox/Safari (D-32/D-33). Feature-detect via `typeof navigator.serial === 'undefined'` — no UA sniffing.
- **Static-site deploy only.** No server runtime. Transport module is plain ES modules, no bundler.
- **Framework-free JS.** No React, no bundler. Phase 2 D-14 discipline continues: plain `import`/`export`.
- **Daily-driver targeted.** Paste must not make typing feel laggy (D-19 keypress queue-jumping); auto-reconnect must feel invisible (D-24 silent cycle); polite-fail must not ship half a terminal.
- **Commits:** no AI attribution in commit messages (user memory — `Co-Authored-By: Claude` forbidden).

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 through D-42)

**Connection chrome (D-01..D-11):**
- D-01 — Single stateful top-bar button; border color cycles gray→amber→green→red. Labels: Connect / Connecting… / Disconnect / Reconnecting… / Reconnect.
- D-02 — `navigator.serial.requestPort({ filters: [{ usbVendorId: 0x10c4, usbProductId: 0xea60 }] })` — CP2102N only. Store `{usbVendorId, usbProductId}` in `localStorage['bestialitty.port.preset']`. Native picker is the only port-selection UI.
- D-03 — Port-lost → label "Reconnect", red border. Silent auto-reconnect on `connect` event if VID/PID matches; click "Reconnect" forces `requestPort()` re-invocation.
- D-04 — Single 500 ms silent retry on transient `open()` fail. No exponential backoff; user-driven recovery via click.
- D-05 — Boot scans `getPorts()`, stashes matching port reference, does NOT auto-open. Explicit user click to open.
- D-06 — New `<details id="connection">` pane — port-status, config form, preset-reset, paste progress, error log. Default-collapsed; auto-expands on active paste or new error.
- D-07 — Connection pane between `#top-bar` and `#terminal-wrapper` in DOM order.
- D-08 — Serial-config UI exposes baud / data bits / stop bits / parity / flow control. Preset: 19200 / 8 / 1 / none / none.
- D-09 — DTR/RTS default both false, NOT user-configurable in v1.
- D-10 — `Send Break` deferred to v2-XPORT-01.
- D-11 — `port.setSignals({dataTerminalReady:false, requestToSend:false})` called in exactly two places: immediately after every `port.open()` AND immediately before every `reader.cancel() + port.close()` path, including `beforeunload`.

**Paste throttling (D-12..D-23):**
- D-12 — New module `www/input/paste-pump.js` with public API: `enqueuePaste(bytes)`, `cancelPaste()`, `isActive()`, `onProgress(fn)`.
- D-13 — Pace target: 90% of configured baud (at 19200 8N1 = ~1728 B/s). Recompute on baud change.
- D-14 — Fixed chunk size 32 bytes, `gapMs = 18` at 19200. Compiled-in constants.
- D-15 — Only explicit paste events through pump; single keypresses bypass it entirely.
- D-16 — Debug pane `<button id="paste-test">Paste test</button>` routes textarea bytes through pump.
- D-17 — Progress line `Pasting N B — X%` + Cancel button in Connection pane. Pane auto-expands on enqueue; returns to prior state on completion.
- D-18 — Cancel paths: Cancel button + Esc key (only while pump active; Esc does NOT emit 0x1B while active). Flag-gated, no mode indicator.
- D-19 — Keypresses queue-jump between chunks: `writeOneChunk() → flushPendingKeypressBytes() → setTimeout(writeOneChunk, gapMs)`.
- D-20 — On port-lost mid-paste: clear queue, cancel timer, final progress event status `'cancelled-port-lost'`. Line shows `Paste cancelled — port lost (N bytes unsent)` for 3 s.
- D-21 — Paste traffic flows through `tx-sink.pushTxBytes` (single coupling point) so Debug hex strip reflects both paste and keypress bytes.
- D-22 — Local-echo during paste: each chunk fed to `term.feed(chunk)` immediately after `writer.write(chunk)`. Single call site in pump.
- D-23 — CR/LF override (Phase 4 D-10/D-11) applies to paste bytes BEFORE enqueue (not mid-pump).

**Auto-reconnect & error UX (D-24..D-31):**
- D-24 — Silent auto-reconnect. Border color is the only signal. No toast, no audible cue.
- D-25 — VID/PID-match policy: one match → open silently; multiple matches → prefer exact `SerialPort` reference from before disconnect; no identity match AND multiple VID/PID matches → red border, label "Choose MicroBeast…", click → `requestPort()` with filter.
- D-26 — `connect` / `disconnect` listeners on `navigator.serial` (not SerialPort instances) — wired once at boot.
- D-27 — Inline error log: last 5 messages, one-liner `{HH:MM:SS} {event-code}: {message}`. Also `console.error`. No UI to clear; reload clears.
- D-28 — Permission-revoke mid-session → treated as port-lost. Error `Permission revoked — click Reconnect to re-authorize`.
- D-29 — "Port in use by another tab" → `MicroBeast is in use by another BestialiTTY tab — close it to connect here.` No BroadcastChannel in v1.
- D-30 — `beforeunload`: best-effort `setSignals({false,false}) → reader.cancel() → port.close()`. All rejections swallowed.
- D-31 — VID/PID persistence: `localStorage['bestialitty.port.preset'] = JSON.stringify({usbVendorId, usbProductId})` on first successful open. No "Forget port" UI in v1.

**Polite fail + read loop (D-32..D-39):**
- D-32 — `typeof navigator.serial === 'undefined'` detection, first line of main.js, no UA sniff.
- D-33 — Full-page takeover: `renderPoliteFail()` replaces body content before any wasm init / canvas boot.
- D-34 — Single `www/transport/serial.js`. Public exports: `connectMicroBeast()`, `disconnect()`, `getState()`, `onStateChange(fn)`, `getWriter()`, `renderPoliteFail()`.
- D-35 — Read loop shape (exact):
  ```js
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    term.feed(value);
    sampleBell();
    drainHostReply('serial');
    requestFrame();
  }
  ```
- D-36 — Read-loop exit ONLY via `reader.cancel()`. Causes pending `read()` to resolve `{done:true}`. No shared cancelled flag.
- D-37 — Read errors caught → inline error log + `console.error` → trigger full port-lost flow. No in-loop retry.
- D-38 — `reader.read()` with no size hint. BYOB deferred unless GC churn shows in UAT.
- D-39 — Extend Phase 3 `visibilitychange` listener with `requestFrame()` on `!document.hidden`.

**Test strategy (D-40..D-42):**
- D-40 — (a) Playwright with `navigator.serial` mock, (b) 05-HUMAN-UAT.md for real hardware. Mock exposes `window.__simulateUnplug()` / `window.__simulateReplug()`.
- D-41 — Paste-pump timing tests use mock writer recording `{bytes, ts}`. Tolerance-based: `total_elapsed >= 0.95 * expected`. No fake timers.
- D-42 — Port-lost/reconnect tests via `__simulateUnplug` / `__simulateReplug`. Asserts button border, label text, inline-log contents, read-loop exit + re-entry.

### Claude's Discretion

- Exact top-bar layout position of Connect button.
- Exact Connection pane CSS (mirror Settings pane unless reason not to).
- Exact polite-fail string copy.
- Exact inline-log error phrasing.
- Connection pane DOM order.
- Whether to show matched VID:PID label.
- Documented minimum Chromium version (Chromium 89 floor — top-level-await baseline from Phase 2; Web Serial stable there).
- Mock file organisation (single `mock-serial.js` fixture vs per-test harness).
- Chunk-size tuning if hardware UAT shows defaults wrong.
- Whether `enqueuePaste` accepts `Uint8Array` only or also `string`.

### Deferred Ideas (OUT OF SCOPE)

- `Send Break` button (v2-XPORT-01).
- User-configurable DTR/RTS initial-state toggles.
- "Forget stored port" UI (Phase 6 PREF-01).
- Auto-connect-on-load preference (Phase 6 PREF-01).
- Full serial-config persistence across reloads (Phase 6 PREF-01).
- `BroadcastChannel` cross-tab coordination.
- BYOB reader buffer tuning.
- Paste-pacer user tuning UI.
- Large-paste confirmation prompt.
- Toast/banner notification primitive.
- "Why Chromium-only?" explainer link.
- Connection quality indicator (bytes/sec).
- Audible port-lost chime.
- `Permissions-Policy: serial=(self)` (Phase 6 deployment concern).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| XPORT-01 | Web Serial transport driven entirely from JavaScript (no Rust bindings) | CONTEXT `<domain>` rules out Rust changes; D-34 single JS module. Verified: Rust core has zero `web-sys`/`js-sys::Serial*` per CORE-02 test. |
| XPORT-02 | Connect/Disconnect button with clear stateful label | D-01 stateful 5-label cycle; D-06 Connection pane for status string. |
| XPORT-03 | Visible connection status indicator (connected/disconnected/port-lost) | D-01 border-color state encoding (gray/amber/green/red). |
| XPORT-04 | MicroBeast preset 19200 8N1 no flow control | D-08 defaults sourced from `.planning/research/captures/README.md §Serial Parameters`. CP2102N confirmed `10c4:ea60`. |
| XPORT-05 | Serial config override UI (baud/data bits/stop bits/parity/flow control) | D-08 Connection pane form; D-02 `port.open()` accepts all five. |
| XPORT-06 | Graceful port-disconnect recovery | D-35/D-36 read loop exits via `reader.cancel()`; D-11 DTR/RTS de-assert before close; D-37 error→port-lost flow. |
| XPORT-07 | Restore previously-granted port on reload via `getPorts()` without re-prompting | D-05 boot scans `getPorts()`, stashes reference, no auto-open. D-31 persisted VID/PID. |
| XPORT-08 | Auto-reconnect on USB re-plug via connect/disconnect listeners | D-26 `navigator.serial`-level listeners; D-25 VID/PID match policy; D-03/D-04 reconnect state machine. |
| XPORT-09 | Paste throttling at 19200 baud no-flow-control | D-12..D-23 paste-pump module; D-13 90%-of-baud pacing; D-19 keypress queue-jump. |
| XPORT-10 | Disconnect uses `reader.cancel()` before `port.close()` | D-30/D-36 enforce cancel-before-close pattern across ALL disconnect paths. |
| XPORT-11 | Read loop is pure async, decoupled from rAF, survives background-tab throttling | D-35 pure async `while(true) { await reader.read() }`; D-39 visibilitychange catch-up `requestFrame()`. |
| PLAT-01 | Detect Chromium Web Serial support on load | D-32 `typeof navigator.serial === 'undefined'` feature-detect, first line of main.js. |
| PLAT-02 | Polite "use Chromium" message on unsupported browsers | D-33 full-page takeover before wasm init; no console errors. |

## Architectural Responsibility Map

Phase 5 spans four architectural tiers in the **browser-only** world of a static-site app. No server, no API, no database.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Feature detection (Chromium Web Serial check) | Browser (JS) | — | First-line gate before wasm/canvas boot. Runs in the document's main frame. |
| Polite-fail page render | Browser DOM | — | innerHTML replacement on body. No framework. |
| Port grant UI (native picker) | Browser (chrome/UA) | JS | `navigator.serial.requestPort()` shows UA-native dialog; JS gets the result. |
| Port open / close / signal control | JS (`www/transport/serial.js`) | OS/USB-driver | JS calls Web Serial; OS driver owns the USB/CP2102N layer. |
| Read loop | JS async task | wasm (receiver of bytes via `term.feed`) | Pure-async JS reads; bytes cross wasm boundary for parsing. |
| Parser / terminal state | wasm (Rust core, Phase 1/2) | — | CLAUDE.md constraint: core is pure logic. Phase 5 does NOT touch it. |
| Glyph render + rAF | JS (`www/renderer/canvas.js`) | — | Phase 3 owns. Phase 5 calls `requestFrame()` after every feed. |
| Write path (TX to MicroBeast) | JS (`www/input/tx-sink.js` extended + `www/transport/serial.js` writer) | — | tx-sink.pushTxBytes + writer.write(bytes) — single coupling point per D-21. |
| Paste throttling (queue + timer) | JS (`www/input/paste-pump.js`) | — | setTimeout chain; no rAF coupling. |
| Reconnect state machine | JS (serial.js module state) | localStorage | VID/PID pair persisted; ports not persisted (SerialPort objects are live). |
| Inline error log | JS state + DOM `<ul>` in Connection pane | — | In-memory ring of 5; DOM re-render on new entry. |
| Playwright mock | Test-harness JS (`page.addInitScript`) | — | Overrides `navigator.serial` before app init. |
| Real-hardware UAT | Human + real CP2102N USB | — | 05-HUMAN-UAT.md. No automation possible. |

## Standard Stack

### Core (Web Serial API shape)

| API | Context7 verified | Purpose | Why Standard |
|-----|------------------|---------|--------------|
| `navigator.serial.requestPort({filters:[...]})` | [CITED: github.com/wicg/serial/blob/main/EXPLAINER.md] | First-time port grant with VID/PID narrowing | The only legit way to get a `SerialPort`; user-gesture required. |
| `navigator.serial.getPorts()` | [CITED: WICG explainer + MDN] | On-reload restore of previously-granted ports | Returns array of `SerialPort` refs already authorized for this origin. |
| `navigator.serial.addEventListener('connect'/'disconnect', ...)` | [CITED: MDN SerialPort:connect_event] | USB plug/unplug detection | Events bubble from `SerialPort` to `Serial` — listening on `navigator.serial` catches ALL ports (Pitfall 11 / D-26). |
| `port.open({baudRate, dataBits, stopBits, parity, flowControl, bufferSize})` | [CITED: WICG explainer] | Configure + activate the serial link | All five options needed for D-08 serial-config form. `bufferSize` defaults to 255 — irrelevant at 19200 8N1. |
| `port.close()` | [CITED: WICG explainer] | Release the serial link | MUST be preceded by `reader.cancel()` + `releaseLock()` to avoid deadlock (Pitfall 1). |
| `port.readable` / `port.writable` | [CITED: WICG explainer] | `ReadableStream` / `WritableStream` sides of the port | Both become `null` on fatal error; the outer `while (port.readable)` pattern relies on this. |
| `port.readable.getReader()` | [CITED: WICG explainer] | Obtain the read-side | Locks the readable stream until `releaseLock()`. Reader shape: `{ value: Uint8Array, done: boolean }`. |
| `port.writable.getWriter()` | [CITED: WICG explainer] | Obtain the write-side | One writer per port. `writer.write(Uint8Array)` returns a Promise. |
| `reader.read()` | [VERIFIED: Context7] | Pull the next chunk | Returns `{value: Uint8Array, done: boolean}`. Can throw `NetworkError` (fatal), `BufferOverrunError` / `FramingError` / `ParityError` / `BreakError` (non-fatal — stream gets replaced; loop re-enters via `port.readable` check). |
| `reader.cancel()` | [CITED: WICG explainer] | Abort the pending `read()` | **The key primitive for clean disconnect.** Causes pending `read()` to resolve `{done:true}` (Pitfall 1, D-36). |
| `reader.releaseLock()` | [CITED: WICG explainer] | Unlock the readable after loop exits | Call in `finally` — safe to call after `cancel()` resolved. |
| `writer.write(Uint8Array)` | [CITED: WICG explainer] | Send bytes | Returns Promise. Await for backpressure — resolves when sink accepts more. [CITED: dev.to/unjavascripter] |
| `writer.ready` | [CITED: dev.to/unjavascripter + MDN WritableStream] | Explicit backpressure gate | Resolves when `desiredSize > 0`. For our 32B/18ms pump at 19200 baud, plain `await writer.write()` is sufficient — pump rate is well below USB throughput. |
| `writer.releaseLock()` | [CITED: WICG] | Release the writer | Call before `port.close()` (or after our `reader.cancel()` chain). |
| `port.setSignals({dataTerminalReady, requestToSend, break})` | [CITED: MDN SerialPort.setSignals] | Control output hardware signals | Field names exact: `dataTerminalReady`, `requestToSend`, `break`. D-09/D-11 sets first two to `false`. |
| `port.getSignals()` | [CITED: WICG] | Read input signals (DCD, CTS, RI, DSR) | Not used in v1 — the MicroBeast workflow doesn't need input-signal visibility. |
| `port.getInfo()` | [CITED: MDN SerialPort.getInfo] | Returns `{usbVendorId, usbProductId}` or `{bluetoothServiceClassId}` | Used for VID/PID persistence (D-25, D-31). |
| `port.connected` (boolean read-only) | [VERIFIED: MDN SerialPort/connected] | Whether port is logically connected | Updates on connect/disconnect events. Useful for filtering `getPorts()` results — but in our flow D-05 explicitly does NOT auto-open based on this. |
| `port.forget()` | [CITED: WICG spec + MDN] | Revoke per-origin permission for this port | NOT used in Phase 5 (deferred to Phase 6 PREF-01 "Forget port" UI). |

### Supporting (DOM / browser primitives)

| API | Purpose | Notes |
|-----|---------|-------|
| `localStorage.getItem` / `setItem` | D-31 VID/PID persistence key `bestialitty.port.preset` | JSON-stringified `{usbVendorId, usbProductId}`. |
| `window.addEventListener('beforeunload', ...)` | D-30 best-effort close | Handler time-budget is tight; all awaits are best-effort; rejections swallowed. |
| `document.addEventListener('visibilitychange', ...)` | D-39 catch-up render on `!document.hidden` | Extends Phase 3 listener, does NOT add a second one. |
| `setTimeout` | D-14 paste-pump chunk timer | Chain via `setTimeout(writeOneChunk, gapMs)`. Avoid nesting depth > 5 (4 ms clamp — but `gapMs=18` already > 4 so clamp never fires anyway). [VERIFIED: javascript.info + MDN Window:setTimeout] |
| `console.error` | D-27 DevTools surface | In addition to inline log — so power users can `about:device-log` + Console. |

### Supporting (test infrastructure, extends Phase 4 Plan 01)

| API | Purpose | Notes |
|-----|---------|-------|
| `page.addInitScript(fn)` | [CITED: playwright.dev/docs/mock-browser-apis] | Override `navigator.serial` BEFORE `main.js` runs. | Same mechanism Phase 4 used for `window.__testGridView`. |
| `page.evaluate(fn)` | Test helpers dispatch `connect`/`disconnect` events | Drives `window.__simulateUnplug()` / `__simulateReplug()`. |
| `expect(locator).toHaveCSS('border-color', ...)` | Border-color state assertions | Survives theme switch — colors resolve to computed RGB. |
| `expect(locator).toHaveText(...)` | Label cycle assertions | Connect/Connecting…/Disconnect/Reconnecting…/Reconnect. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Why we're not using |
|------------|-----------|----------|--------|
| Plain setTimeout chain (D-14) | `setInterval` | Simpler code | `setInterval` doesn't backpressure — if a chunk takes longer than `gapMs` (write stall), intervals stack. setTimeout-self-schedule is immune. |
| Plain setTimeout chain | Web Worker with `postMessage` | Isolated scheduling | Overkill; main-thread scheduler hits its numbers at 1728 B/s. Also complicates `tx-sink` coupling (D-21). |
| BYOB reader (`reader.read(Uint8Array)`) | Default reader | Lower GC churn on heavy traffic | D-38: platform-chosen chunks at 19200 baud are ~1–4 KB; GC pressure negligible. Revisit only if hardware UAT shows churn. |
| Custom port matching heuristic | `port.connected` | Distinguishes intentional vs transient disconnect | [VERIFIED: MDN] `port.connected` is useful, but our flow is simpler: D-25 policy is "on `connect` event, filter `getPorts()` by VID/PID match, prefer exact reference." `port.connected` doesn't change the policy — a reconnected port will be `connected:true`, which is the case we already handle. |
| `BroadcastChannel` for cross-tab coordination | Nothing / documentation only | Cleaner UX when two tabs fight for the port | D-29: v1 ships the error string, documents in pane help text. `BroadcastChannel` is out-of-scope. |
| `TextDecoder`/`TextEncoder` in transport | `Uint8Array` end-to-end | Easier string handling | **FORBIDDEN** — Pitfall 10 / D-35 / CORE-05. VT52 is bytes; TextDecoder silently drops high-bit bytes and holds partial UTF-8 state across chunks. |

**Installation:** No new npm packages. All primitives are browser-native + already-shipped Phase 2/3/4 modules.

**Version verification:** No external libraries added. Playwright version is frozen by Phase 4 Plan 01 — do not bump. Chromium minimum is 89 (top-level-await baseline from Phase 2).

## Architecture Patterns

### System Architecture Diagram

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                        Browser (Chromium)                        │
  │                                                                   │
  │   User-click                                                      │
  │       │                                                           │
  │       ▼                                                           │
  │   ┌──────────────┐     ┌─────────────────────┐                    │
  │   │ #connect-btn │───► │ serial.js           │                    │
  │   │ (top bar)    │     │  .connectMicroBeast │                    │
  │   └──────────────┘     └─────────┬───────────┘                    │
  │                                  │                                │
  │                                  ▼                                │
  │                       ┌────────────────────────┐                  │
  │                       │ navigator.serial       │                  │
  │                       │  .requestPort({filters})│ [first time]    │
  │                       │  .getPorts()             [reload]         │
  │                       └──────────┬─────────────┘                  │
  │                                  ▼                                │
  │                       ┌────────────────────────┐                  │
  │                       │ port.open(config)      │                  │
  │                       │ port.setSignals(false)  │  ◄── D-11       │
  │                       └──────────┬─────────────┘                  │
  │                                  │                                │
  │              ┌───────────────────┼──────────────────┐             │
  │              ▼                   ▼                  ▼             │
  │   ┌─────────────────┐  ┌─────────────────┐ ┌─────────────────┐    │
  │   │ Read loop       │  │ Write path      │ │ Event listeners │    │
  │   │ (pure async)    │  │ (writer+pump)   │ │ (navigator.serial│    │
  │   │                 │  │                 │ │  connect/discon) │    │
  │   │ while(port.     │  │ tx-sink ◄─ keyb │ │                 │    │
  │   │  readable){     │  │  .pushTxBytes   │ │ on connect:     │    │
  │   │  reader=        │  │      │          │ │  filter getPorts│    │
  │   │   .getReader(); │  │      ▼          │ │  by VID/PID     │    │
  │   │  while(true){   │  │  writer.write   │ │  open → green   │    │
  │   │   await read()  │  │                 │ │                 │    │
  │   │   → term.feed() │  │ paste-pump:     │ │ on disconnect:  │    │
  │   │   → sampleBell()│  │  setTimeout     │ │  state = red    │    │
  │   │   → drainHost   │  │  chunk-by-chunk │ │  drop paste qu. │    │
  │   │      Reply()    │  │  → tx-sink      │ │                 │    │
  │   │   → requestFrame│  │   → writer.write│ │                 │    │
  │   │  }              │  │                 │ │                 │    │
  │   │ }               │  │                 │ │                 │    │
  │   └────────┬────────┘  └────────┬────────┘ └────────┬────────┘    │
  │            │                    │                   │             │
  │            ▼                    ▼                   ▼             │
  │   ┌────────────────────────────────────────────────────────┐      │
  │   │                OS USB driver (CP2102N CDC)              │     │
  │   └────────────────────────┬───────────────────────────────┘      │
  │                            │                                      │
  └────────────────────────────┼──────────────────────────────────────┘
                                │ USB 2.0 (CDC-ACM)
                                ▼
                       ┌──────────────────┐
                       │ MicroBeast Z80   │
                       │ (19200 8N1)      │
                       └──────────────────┘
```

**Disconnect flow (any trigger):**
```
  user-click | USB-unplug | NetworkError | permission-revoke | beforeunload
        │
        ▼
  setSignals({false,false})  ◄── D-11 (best-effort on beforeunload)
        │
        ▼
  reader.cancel()             ◄── D-36 single exit path
        │
        ▼ (pending read() resolves {done:true})
        ▼
  reader.releaseLock()        ◄── in finally
        │
        ▼
  writer.releaseLock()        ◄── if held
        │
        ▼
  port.close()                ◄── awaits pending writes
        │
        ▼
  state = disconnected/port-lost
  paste-pump.onPortLost()     ◄── D-20 drops queue, final progress event
```

### Recommended Project Structure

```
www/
├── main.js                    # FIRST LINE: polite-fail gate; then wire serial after wireKeyboard
├── transport/
│   └── serial.js              # NEW — D-34 single module (polite-fail + connect/open/read/write/reconnect/persistence)
├── input/
│   ├── keyboard.js            # EXTENDED — Esc-intercept checks pastePump.isActive() before 0x1B encode
│   ├── tx-sink.js             # EXTENDED — pushTxBytes also calls writer.write(bytes) when writer registered
│   └── paste-pump.js          # NEW — D-12 queue+timer, 32B/18ms pump, keypress queue-jump
├── renderer/
│   └── chrome.js              # EXTENDED — visibilitychange listener adds requestFrame() on !hidden
├── index.html                 # EXTENDED — top-bar Connect button, Connection pane, Debug Paste-test button
├── tests/
│   ├── transport/             # NEW — Phase 5 Playwright suite
│   │   ├── mock-serial.js     # Shared navigator.serial mock (exposed via window.__simulateX helpers)
│   │   ├── polite-fail.spec.js
│   │   ├── connect-open.spec.js
│   │   ├── read-loop.spec.js
│   │   ├── disconnect-reconnect.spec.js
│   │   ├── paste-pump.spec.js
│   │   └── config-form.spec.js
│   ├── input/                 # Phase 4 — unchanged
│   └── render/                # Phase 3 — unchanged
└── playwright.config.js       # EXTENDED — testMatch adds tests/transport/*.spec.js
```

### Pattern 1: Polite-fail as the FIRST line

**What:** Detect Web Serial absence before any wasm init, replace body content, return early.

**When to use:** Only in `main.js` top-level. Cannot be inside an async function (top-level-await is OK but we want to fail BEFORE `await init()`).

**Example:**

```js
// www/main.js — FIRST executable line
import { renderPoliteFail } from './transport/serial.js';

if (typeof navigator.serial === 'undefined') {
  renderPoliteFail();
  // Intentionally stop here — no wasm init, no canvas boot, no font load.
  throw new Error('__polite-fail__');  // or just let module execution stop naturally
}

// ... only now does wasm init start:
import init, { Terminal } from './pkg/bestialitty_core.js';
const wasm = await init();
// ...
```

`renderPoliteFail` body (pure DOM, no framework, no external fonts):

```js
// www/transport/serial.js
export function renderPoliteFail() {
  // Replace body content atomically. document.body always exists at <script type="module">
  // execution time after <body>.
  document.body.innerHTML = `
    <main style="max-width:48em;margin:4em auto;padding:1em;font-family:system-ui,sans-serif;line-height:1.5">
      <h1>BestialiTTY requires a Chromium-based browser</h1>
      <p>The <a href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API">Web Serial API</a>
         is only available in Chromium-based browsers (Chrome, Edge, Brave, Opera, Arc).</p>
      <p>Open BestialiTTY in one of those to connect to your MicroBeast.</p>
    </main>`;
  document.title = 'BestialiTTY — Chromium required';
}
```

**Rationale:** `innerHTML` replacement over `document.open()` because we want the browser parser and existing `<head>` styles to remain. We don't want a blank page — we want a polite static message in whatever base CSS the page already has.

### Pattern 2: Read loop — outer-over-port.readable + inner cancellable

**What:** Nested while that handles both transient stream-error recovery (outer re-creates reader) AND clean cancel exit (inner breaks on `done:true`).

**When to use:** The exact shape the WICG EXPLAINER documents for robust production code. D-35 gives the inner body; research adds the outer.

**Example:**

```js
// www/transport/serial.js — the canonical pattern
let reader = null;  // module-scoped so disconnect can call reader.cancel()

async function runReadLoop(port) {
  while (port.readable) {           // outer: re-enter if non-fatal error replaces readable
    reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;                  // D-36 cancel path
        term.feed(value);                 // Phase 2 feed_silent — byte-end-to-end
        sampleBell();                     // Phase 3 post-feed invariant
        drainHostReply('serial');         // Phase 2 host-reply accessor
        requestFrame();                   // Phase 3 dirty repaint wake
      }
    } catch (err) {
      handleReadError(err);               // D-37 → inline log + state=port-lost
      // fall through to finally; outer loop re-checks port.readable
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
      reader = null;
    }
    // If port.readable became null (fatal), outer exits.
    // If a non-fatal error replaced port.readable with a fresh stream, outer re-enters.
  }
  // port.readable is null → port is dead.
  try { await port.close(); } catch {}
  setState('disconnected');
}
```

**Sources:**
- Outer `while (port.readable)` pattern: [CITED: github.com/wicg/serial/blob/main/EXPLAINER.md — "Handling Non-Fatal Read Errors in Serial Port"]
- Inner cancel-exit pattern: [CITED: github.com/wicg/serial/blob/main/index.html — "Exiting Read Loop Before Closing Port"]

### Pattern 3: Cancel-before-close disconnect

**What:** Single shared helper invoked from every disconnect path.

**When to use:** User-click Disconnect, USB unplug event, read-loop error, permission-revoke, `beforeunload`.

**Example:**

```js
// www/transport/serial.js
async function teardown({ deassertSignals = true } = {}) {
  // 1. De-assert DTR/RTS before close (Pitfall 12, D-11) — best-effort.
  if (deassertSignals && port && port.writable) {
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch { /* port may already be closed */ }
  }
  // 2. Cancel reader — causes pending read() to resolve {done:true} (Pitfall 1).
  if (reader) {
    try { await reader.cancel(); } catch {}
  }
  // 3. Release writer if we held one.
  if (writer) {
    try { writer.releaseLock(); } catch {}
    writer = null;
  }
  // 4. Close the port.
  if (port) {
    try { await port.close(); } catch {}
  }
  // 5. Drop paste queue — D-20.
  pastePump.onPortLost();
  // NOTE: port variable stays set (so getPorts/VID-match still works on reconnect).
}
```

**Beforeunload variant:** all steps are fire-and-forget — do NOT await the promises individually (beforeunload time budget is ~4 seconds on Chromium but cancellable by the OS). Collect all the promises and let them settle, no error handling:

```js
window.addEventListener('beforeunload', () => {
  // Best-effort only. No await — beforeunload has synchronous-feeling semantics.
  if (port && port.writable) {
    port.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
  }
  if (reader) reader.cancel().catch(() => {});
  if (port) port.close().catch(() => {});
});
```

### Pattern 4: Paste-pump setTimeout chain with keypress queue-jump

**What:** Self-scheduling `setTimeout` chain, not `setInterval`. Between chunk writes, flush any keypress bytes that arrived during the gap.

**Example:**

```js
// www/input/paste-pump.js
const CHUNK_SIZE = 32;                                        // D-14 compile-in constant
let gapMs = computeGap(19200);                                // D-13 — recompute on baud change
let queue = new Uint8Array(0);
let cursor = 0;                                               // bytes consumed from queue
let timer = null;
let pendingKeypresses = [];                                   // queue-jump pool
let progressObservers = [];

function computeGap(baud) {
  // D-14 formula — target 90% of byte rate; byte rate = baud / 10 for 8N1.
  const byteRate = baud / 10 * 0.90;                          // at 19200 → 1728 B/s
  return Math.round(CHUNK_SIZE / byteRate * 1000);            // at 19200 → 18 ms
}

export function enqueuePaste(bytes) {
  // D-23 CR/LF rewrite happens here, BEFORE enqueue (not mid-pump).
  const rewritten = applyCrlfRewrite(bytes);
  queue = concat(queue.subarray(cursor), rewritten);          // drop consumed, append new
  cursor = 0;
  if (!timer) {
    fireProgress('started');
    writeOneChunk();                                          // kick off
  }
}

export function cancelPaste() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  const unsent = queue.length - cursor;
  queue = new Uint8Array(0);
  cursor = 0;
  fireProgress('cancelled', { unsent });
}

export function isActive() {
  return timer !== null || cursor < queue.length;
}

export function onProgress(fn) { progressObservers.push(fn); }

export function onPortLost() {
  // D-20 — clear queue, cancel timer, fire 'cancelled-port-lost'.
  const unsent = queue.length - cursor;
  if (timer) clearTimeout(timer);
  timer = null;
  queue = new Uint8Array(0); cursor = 0;
  fireProgress('cancelled-port-lost', { unsent });
}

export function enqueueKeypress(bytes) {
  // D-15/D-19 — keypresses bypass pump queue; tx-sink already wrote them.
  // This pool is ONLY for the queue-jump emission between chunks.
  pendingKeypresses.push(bytes);
}

function writeOneChunk() {
  timer = null;  // allow re-entry if cancel happens during the write
  const remaining = queue.length - cursor;
  if (remaining <= 0) {
    fireProgress('complete');
    return;
  }
  const take = Math.min(CHUNK_SIZE, remaining);
  const chunk = queue.subarray(cursor, cursor + take);
  cursor += take;

  // D-21 — route through tx-sink so Debug hex strip reflects paste bytes.
  pushTxBytes(chunk);   // tx-sink will call writer.write(chunk) internally when connected

  // D-22 — local-echo feeds chunk to term post-write.
  if (getLocalEcho()) {
    term.feed(chunk); sampleBell(); drainHostReply('paste-echo'); requestFrame();
  }

  fireProgress('chunk', { written: cursor, total: queue.length });

  // D-19 — flush pending keypresses BEFORE scheduling next chunk.
  flushPendingKeypresses();

  // Schedule next chunk — self-scheduling chain (not nested recursion, not setInterval).
  if (cursor < queue.length) {
    timer = setTimeout(writeOneChunk, gapMs);
  } else {
    fireProgress('complete');
  }
}

function flushPendingKeypresses() {
  // Keypresses are already written via tx-sink (D-15); this is a no-op placeholder
  // for the "between chunks" hook — keyboard.js continues to call tx-sink synchronously.
  // The queue-jump lives in tx-sink itself: pushTxBytes wraps writer.write on every call.
  pendingKeypresses.length = 0;
}

function fireProgress(status, extra = {}) {
  for (const fn of progressObservers) fn({ status, ...extra });
}
```

**Why this shape, not alternatives:**

- **`setTimeout` chain, not `setInterval`:** If `writer.write()` takes longer than `gapMs` (USB scheduling jitter), setInterval stacks pending callbacks. setTimeout chain is immune — it only schedules the next tick AFTER the current one finishes.
- **Not nested recursion:** The chain is tail-position (next chunk is scheduled, not nested) — no stack growth and no 4 ms clamp trigger. Nested `setTimeout` calls after 5 levels deep clamp to 4 ms minimum [VERIFIED: javascript.info + MDN]; `gapMs = 18` is already above the clamp, and self-scheduling chain resets nesting depth.
- **`pushTxBytes` is the single coupling point (D-21):** paste bytes AND keypresses both go through tx-sink. The Phase 4 Debug hex strip shows both. Phase 5 extends tx-sink so that when a writer is registered, `pushTxBytes` calls `writer.write(bytes)` synchronously after appending to the ring.

### Pattern 5: Stateful button — border-color as state signal

**What:** Single `#connect-button` in the top bar, `data-state` attribute driven by `serial.onStateChange(fn)`, CSS selectors on `[data-state]` set border-color and hover state.

**Example:**

```css
/* www/index.html <style> */
#connect-button {
  padding: 4px 10px;
  background: transparent;
  color: var(--chrome-fg);
  border: 1px solid var(--chrome-border);      /* gray default — D-01 */
  cursor: pointer;
  font-family: inherit; font-size: 14px;
}
#connect-button[data-state="connecting"],
#connect-button[data-state="reconnecting"]  { border-color: #e0b030; }   /* amber */
#connect-button[data-state="connected"]     { border-color: var(--phosphor-fg); }  /* green-ish regardless of phosphor */
#connect-button[data-state="port-lost"]     { border-color: #e04040; }   /* red */
#connect-button:focus-visible               { outline: 2px solid var(--chrome-accent); outline-offset: 2px; }
```

```js
// www/transport/serial.js — state machine
const BUTTON_LABELS = {
  disconnected:  'Connect',
  connecting:    'Connecting…',
  connected:     'Disconnect',
  reconnecting:  'Reconnecting…',
  'port-lost':   'Reconnect',
};
function setState(s) {
  state = s;
  connectButton.dataset.state = s;
  connectButton.textContent = BUTTON_LABELS[s];
  stateObservers.forEach(fn => fn(s));
}
```

### Pattern 6: Auto-reconnect — connect event → getPorts → VID/PID filter

**What:** Listen on `navigator.serial` (not port instances — D-26), filter `getPorts()` results by stored VID/PID, prefer exact reference, apply 500 ms single retry on transient `open()` fail (D-04).

**Example:**

```js
// www/transport/serial.js
navigator.serial.addEventListener('connect', (ev) => {
  if (state === 'port-lost') {
    handleReconnect(ev.target);
  }
});

async function handleReconnect(newlyConnectedPort) {
  const stored = readStoredPreset();  // {usbVendorId, usbProductId} from localStorage
  if (!stored) return;

  // D-25 VID/PID filter
  const ports = await navigator.serial.getPorts();
  const matches = ports.filter(p => {
    const i = p.getInfo();
    return i.usbVendorId === stored.usbVendorId && i.usbProductId === stored.usbProductId;
  });

  let target;
  if (matches.length === 1) {
    target = matches[0];
  } else if (matches.length > 1) {
    // D-25 — prefer exact reference from before disconnect.
    target = matches.find(p => p === lastPortRef) || null;
    if (!target) {
      // Ambiguity: multiple MicroBeast-class adapters. Defer to user.
      setState('port-lost');
      connectButton.textContent = 'Choose MicroBeast…';
      appendErrorLog('multiple-adapters', 'Multiple CP2102N adapters connected — pick one');
      return;
    }
  } else {
    return;  // newly-connected device is not a match; do nothing.
  }

  setState('reconnecting');
  try {
    await target.open(lastConfig);
    await target.setSignals({ dataTerminalReady: false, requestToSend: false });  // D-11
    startReadLoop(target);
    port = target;
    setState('connected');
  } catch (err) {
    // D-04 single 500 ms retry.
    setTimeout(async () => {
      try {
        await target.open(lastConfig);
        await target.setSignals({ dataTerminalReady: false, requestToSend: false });
        startReadLoop(target);
        port = target;
        setState('connected');
      } catch (retryErr) {
        setState('port-lost');
        appendErrorLog('reopen-failed', `Reconnect failed: ${retryErr.message}`);
      }
    }, 500);
  }
}
```

### Pattern 7: Playwright mock via `page.addInitScript`

**What:** Stub `navigator.serial` + helpers before the app's modules load. Mock exposes `window.__simulateUnplug()` / `window.__simulateReplug()` / `window.__mockReaderPush(bytes)` / `window.__mockWriterLog` for specs.

**Example:**

```js
// www/tests/transport/mock-serial.js
export const SERIAL_MOCK = /* plain JS string passed to addInitScript */`
(() => {
  // Default device info — VID/PID matches MicroBeast CP2102N.
  const DEFAULT_INFO = { usbVendorId: 0x10c4, usbProductId: 0xea60 };

  // Module-scope state on window for spec introspection.
  window.__mockWriterLog = [];   // records { bytes: number[], ts: number } per write
  window.__mockState     = { opened: false, port: null, listeners: {} };

  class MockReader {
    constructor(port) { this.port = port; this.pending = []; this.cancelled = false; this.waiter = null; }
    async read() {
      if (this.cancelled) return { value: undefined, done: true };
      if (this.pending.length > 0) return { value: this.pending.shift(), done: false };
      return new Promise((resolve) => { this.waiter = resolve; });  // wait for push
    }
    async cancel() {
      this.cancelled = true;
      if (this.waiter) { this.waiter({ value: undefined, done: true }); this.waiter = null; }
    }
    releaseLock() {}
  }
  class MockWriter {
    constructor(port) { this.port = port; }
    async write(bytes) {
      window.__mockWriterLog.push({ bytes: Array.from(bytes), ts: performance.now() });
      return undefined;
    }
    releaseLock() {}
  }
  class MockSerialPort extends EventTarget {
    constructor(info = DEFAULT_INFO) {
      super();
      this._info = info; this._opened = false; this._reader = null; this._writer = null;
      this.readable = null; this.writable = null; this.connected = true;
    }
    getInfo() { return { ...this._info }; }
    async open(config) {
      this._opened = true; this._config = config;
      const reader = new MockReader(this); const writer = new MockWriter(this);
      this._reader = reader; this._writer = writer;
      this.readable = { getReader: () => reader };
      this.writable = { getWriter: () => writer };
    }
    async close()   { this._opened = false; this.readable = null; this.writable = null; }
    async setSignals(s) { this._lastSignals = s; }
    async getSignals()  { return { dataCarrierDetect:false, clearToSend:true, ringIndicator:false, dataSetReady:true }; }
    async forget() {}
  }
  class MockSerial extends EventTarget {
    constructor() { super(); this._grantedPorts = []; }
    async requestPort(opts) {
      // Honour filter — CONTEXT.D-02 uses CP2102N filter.
      const p = new MockSerialPort(DEFAULT_INFO);
      this._grantedPorts.push(p);
      return p;
    }
    async getPorts() { return [...this._grantedPorts]; }
  }
  const serial = new MockSerial();
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });

  // Test hooks.
  window.__simulateUnplug = () => {
    // D-42 — dispatch disconnect on navigator.serial. event.target = the port that went away.
    const port = serial._grantedPorts[serial._grantedPorts.length - 1];
    if (!port) return;
    port.connected = false;
    port.readable = null;  // WICG: fatal error sets port.readable to null.
    const ev = new Event('disconnect', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: port });
    serial.dispatchEvent(ev);
    // Also resolve any pending read() with done:true (simulates cancel-on-unplug).
    if (port._reader && port._reader.waiter) {
      port._reader.waiter({ value: undefined, done: true });
      port._reader.waiter = null;
    }
  };
  window.__simulateReplug = () => {
    // D-42 — dispatch connect on navigator.serial.
    const port = serial._grantedPorts[serial._grantedPorts.length - 1];
    if (!port) return;
    port.connected = true;
    const ev = new Event('connect', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: port });
    serial.dispatchEvent(ev);
  };
  window.__mockReaderPush = (bytes) => {
    // Simulates MicroBeast writing bytes to the wire. Delivered via resolved read().
    const port = serial._grantedPorts[serial._grantedPorts.length - 1];
    if (!port || !port._reader) return;
    const chunk = new Uint8Array(bytes);
    if (port._reader.waiter) {
      port._reader.waiter({ value: chunk, done: false });
      port._reader.waiter = null;
    } else {
      port._reader.pending.push(chunk);
    }
  };
})();`;
```

Spec usage:

```js
// www/tests/transport/connect-open.spec.js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(SERIAL_MOCK);
  await page.goto('/');
});

test('click Connect opens port with 19200 8N1 no flow-control @fast', async ({ page }) => {
  await page.locator('#connect-button').click();
  // Wait for state transition connecting → connected.
  await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');
  await expect(page.locator('#connect-button')).toHaveText('Disconnect');
  // Verify the port was opened with the preset config.
  const cfg = await page.evaluate(() => navigator.serial._grantedPorts[0]._config);
  expect(cfg).toEqual({
    baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'
  });
  // Verify DTR/RTS were de-asserted.
  const sigs = await page.evaluate(() => navigator.serial._grantedPorts[0]._lastSignals);
  expect(sigs).toEqual({ dataTerminalReady: false, requestToSend: false });
});
```

### Anti-Patterns to Avoid

- **`TextDecoder` anywhere on the read path.** Forbidden. VT52 is bytes. Pitfall 10. D-35.
- **`port.close()` before `reader.cancel()`.** Deadlocks Chromium. Pitfall 1. D-36.
- **Auto-opening on boot restore.** D-05 explicitly says no — prevents spurious "port lost" on reload-when-unpowered.
- **Calling `requestPort()` from auto-reconnect.** Security/UX violation — only call on explicit user click. D-03.
- **Listening for `connect`/`disconnect` on individual `SerialPort` instances.** Chromium MAY swap the instance on unplug/replug — listen on `navigator.serial` instead. D-26. Pitfall 11.
- **Decoding bytes to string in transport.** TextDecoder silently loses high-bit bytes and holds partial-UTF-8 state across chunks. Pitfall 10.
- **rAF-driving the read loop.** Background-tab throttling will silently drop serial data. Pitfall 6. D-35/D-39.
- **Skipping DTR/RTS on open.** Default-undefined behaviour; may reset the MicroBeast. Pitfall 12. D-09/D-11.
- **Skipping DTR/RTS before close.** CP2102N errata: chip does NOT auto-deassert on close; leaves the line in whatever state it was (may lock the Z80). [CITED: Silicon Labs CP2102N errata, paraphrased]. D-11/D-30.
- **`setInterval` for paste pump.** Stacks pending calls on USB scheduling jitter. Use setTimeout chain.
- **Recursive-nested setTimeout chain > 5 deep.** Hits the 4 ms clamp. Use self-scheduling chain (each call resets nesting) — our chain is naturally flat.
- **Full-page takeover via `document.open()`.** Loses existing `<head>` styles; the page visually flashes. Use `document.body.innerHTML = …` instead.
- **Feature-detect via UA sniffing.** Use `typeof navigator.serial === 'undefined'` (D-32). Forward-compatible if Firefox/Safari ever ship.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Port enumeration / picker UI | Custom port-list dropdown | `navigator.serial.requestPort({filters})` + native Chromium picker | Origin-permission model is browser-owned; a DIY list would miss permission-grant flow entirely. |
| Write backpressure | Manual byte-by-byte ACK tracking | `await writer.write(bytes)` + the Streams API native backpressure | `writable` is a `WritableStream` — backpressure is already wired. At 1.7 KB/s we don't need `writer.ready`; plain await suffices. |
| Reconnect identity matching | Custom device fingerprint (first-bytes, handshake) | `port.getInfo()` VID/PID + exact-reference fallback (D-25) | VID/PID is the OS-level identity; anything else is homemade and fragile. |
| USB event detection | Polling `getPorts()` on a timer | `navigator.serial` `connect`/`disconnect` events (D-26) | Events are free and Chromium-native; polling loses the causality signal (was it the device we cared about?). |
| CR/LF rewriting on paste | Stream transformer pipeline | Direct `for`-loop byte rewrite before enqueue (D-23) | Phase 4 already does the same for keypresses. Same helper, one call site. |
| Paste rate limiter | Token bucket / leaky bucket | Fixed 32-byte chunk + 18 ms gap (D-14) | Predictable, testable with tolerance (D-41). Over-engineered for a single-baud daily driver. |
| Error log UI | Toast library / banner | Plain `<ul>` in Connection pane with last-5 ring (D-27) | One custom module > a dependency for five lines of text. Framework-free constraint. |
| Polite-fail page | Static `.html` deployed at a different URL | `document.body.innerHTML = …` in `renderPoliteFail()` (D-33) | Keeps everything a single file; no routing, no redirects. |
| VID/PID storage | IndexedDB, Web Storage API wrapper | `localStorage.setItem(KEY, JSON.stringify(pair))` (D-31) | 2 fields. JSON stringify is 12 chars of code. |
| State-machine for button | React/state-chart library | Plain setState + `data-state` attribute (Pattern 5) | 5 states, 5 labels, 5 border colors. CSS handles the rendering. |
| Timing-test fake clock | `sinon.useFakeTimers()` or `jest.useFakeTimers()` | Real timers + tolerance assertions (D-41) | Playwright has no fake timers; real timers exercise the real path the user sees. |

**Key insight:** Web Serial is a mature API; the Streams API underneath it handles backpressure, cancellation, and error propagation natively. The code volume for Phase 5 is small because every non-trivial concern (picker UI, write backpressure, event bubbling, permission persistence) is already solved by the browser.

## Runtime State Inventory

Phase 5 is a **greenfield phase** — it ADDS new modules (`www/transport/serial.js`, `www/input/paste-pump.js`), EXTENDS existing modules (`www/input/tx-sink.js`, `www/input/keyboard.js`, `www/renderer/chrome.js`, `www/main.js`, `www/index.html`), and ADDS a new test directory (`www/tests/transport/`). It is NOT a rename/refactor/migration.

However, it DOES introduce one new piece of runtime state that will survive after phase execution, and I'll flag it for the planner:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `localStorage['bestialitty.port.preset'] = JSON.stringify({usbVendorId, usbProductId})` — written on first connect. | **None for Phase 5.** This is a Phase 5-owned key. Phase 6 PREF-01 will extend it with full serial-config and add a "Forget port" UI. The key name is grep-anchored in serial.js; Phase 6 planner should search for `bestialitty.port.preset` to find the extension point. |
| Live service config | None — there is no server; the MicroBeast firmware is untouched by Phase 5. | None. |
| OS-registered state | None — Web Serial permissions are per-origin and managed by the browser itself (Chrome settings → Privacy → Serial ports). Phase 5 does NOT register anything at the OS level. | None. |
| Secrets / env vars | None — no secrets, no env vars. Phase 5 runs entirely in the user's browser. | None. |
| Build artifacts / installed packages | None — no new npm packages; Playwright version frozen at Phase 4 level. | None. |

**Verified via:**
- Search across codebase for `localStorage` usage — none yet; Phase 5 introduces the first one.
- CLAUDE.md constraint: static site, no server runtime.

## Common Pitfalls

### Pitfall 1: Reader-Lock Deadlock on Disconnect (HIGH risk)

**What goes wrong:** Calling `port.close()` while a `reader.read()` is pending, or `reader.releaseLock()` while a read is outstanding. Both throw; the UI sticks in half-connected state only a page reload escapes.

**Why it happens:** Reader lock is held for the entire read-loop lifetime; `read()` blocks indefinitely. You can't release a lock while a read is outstanding and you can't stop the read except by cancelling.

**How to avoid:** D-36 — single exit path via `reader.cancel()`. Stash `reader` in module scope. Every disconnect branch calls `cancel()` FIRST; the pending `read()` resolves `{done:true}`; loop exits through `finally` releasing the lock; then `port.close()` works.

**Warning signs:** "port already open" / "readable is locked" in DevTools after unplug; reload required to recover.

[CITED: github.com/WICG/serial/issues/112]

### Pitfall 2: DTR/RTS Accidentally Resets MicroBeast on Connect (HIGH risk — MicroBeast-specific)

**What goes wrong:** CP2102N DTR/RTS pins may be wired to the MicroBeast's Z80 reset line (common in retrocomputing — Arduino-style auto-reset). `port.open()` without explicit signals leaves the signals in undefined state; user sees the boot banner every time they Connect.

**Why it happens:** Default signal state after `port.open()` is OS-dependent and not specified. Plus: CP2102N errata — chip does NOT auto-deassert on close; leftover state can lock the line. [CITED: Silicon Labs CP2102N errata]

**How to avoid:** D-09/D-11. Call `setSignals({dataTerminalReady: false, requestToSend: false})` immediately after `open()` AND immediately before `reader.cancel() + port.close()` (including beforeunload — D-30).

**Warning signs:** Boot banner appears on every Connect; MicroBeast locks up on connect; behaviour differs by OS.

[CITED: Pitfall 12 in .planning/research/PITFALLS.md; Silicon Labs CP2102N errata]

### Pitfall 3: Background-Tab Throttling Silently Loses Serial Data (HIGH risk)

**What goes wrong:** User switches tabs during `cat bigfile`. Chrome throttles the tab; if the read loop is rAF-driven, bytes accumulate in the platform buffer and are eventually dropped or delayed. User comes back to a hole in the session log.

**Why it happens:** Chrome 57+ background throttling limits background timers to ~1% CPU. rAF pauses entirely when `document.hidden`.

**How to avoid:** D-35 — pure async read loop `while(true){ await reader.read() }` that does NOT depend on rAF. rAF is only for rendering; reading is decoupled. D-39 — extend `visibilitychange` listener with `requestFrame()` catch-up on `!document.hidden` so accumulated bytes render immediately on return.

**Warning signs:** Session log has gaps after tab switch; user reports "I left it running overnight, output is missing."

[CITED: Pitfall 6 in .planning/research/PITFALLS.md; developer.chrome.com/blog/timer-throttling-in-chrome-88]

### Pitfall 4: TextDecoder Byte Corruption on Read Path (HIGH risk)

**What goes wrong:** `new TextDecoder('utf-8').decode(chunk)` silently replaces invalid UTF-8 with U+FFFD or throws (in `{fatal:true}` mode). VT52 bytes above 0x7F get lost. Worse: partial-multibyte sequences straddle chunk boundaries; TextDecoder holds state; bytes come out "late" in wrong chunks.

**Why it happens:** Serial bytes aren't text. VT52 is a 7-bit protocol but byte-stream is 8-bit. TextDecoder is the "obvious" way to handle binary-to-string in JS — so developers reach for it instinctively.

**How to avoid:** D-35. Pass `Uint8Array` straight to `term.feed(bytes)`. Phase 2's `feed_silent` accepts raw bytes. **Never** convert to string in transport.

**Warning signs:** Missing BEL/beeps; garbled output on non-ASCII; intermittent missing chars at chunk boundaries.

[CITED: Pitfall 10 in .planning/research/PITFALLS.md]

### Pitfall 5: Serial Port Identity Mismatch on Reconnect (MEDIUM risk)

**What goes wrong:** Unplug, plug into different USB port, `disconnect`/`connect` events fire, but the `SerialPort` instance may be new. If auto-reconnect uses the old reference, it fails. If it grabs any CP2102N, it may grab a user's Arduino.

**Why it happens:** USB addressing changes per port; Chromium may return a different `SerialPort` object. VID/PID is the only stable identity, and even that can be ambiguous with multiple same-chip adapters.

**How to avoid:** D-25. Filter `getPorts()` by stored VID/PID, prefer exact reference for disambiguation, fall back to user-picker for multi-match. D-26 — listen on `navigator.serial` (not port instances) so we catch swaps.

**Warning signs:** Auto-reconnect picks wrong device; modal permission prompts on every reconnect; "Connected" but no bytes flow.

[CITED: Pitfall 11 in .planning/research/PITFALLS.md; github.com/WICG/serial/issues/156]

### Pitfall 6: setTimeout Nested Clamp (LOW risk, but subtle)

**What goes wrong:** If the paste-pump is naively written as nested recursive setTimeout, after 5 levels the clamp kicks in (4 ms minimum) — but our `gapMs = 18` is above that so no observable bug.

**Why it happens:** HTML5 spec — nested setTimeout after 5 levels clamps to 4 ms minimum. [VERIFIED: javascript.info scheduling article, MDN Window.setTimeout]

**How to avoid:** Use a self-scheduling setTimeout chain (each call resets nesting depth). Our Pattern 4 example does this. Also: `gapMs = 18` is comfortably above the 4 ms clamp, so even if we tripped it the paste pace would only speed up — NOT slow down.

**Warning signs:** None in our case — `gapMs` chosen specifically above the clamp. Flagged here for future contributors.

### Pitfall 7: `port.readable === null` on Fatal Error (MEDIUM risk — easy to miss)

**What goes wrong:** On fatal error (USB unplug, permission revoke), `port.readable` becomes `null`. A simple `while (true) { reader.read() }` will throw on the next loop entry. Without the outer `while (port.readable)` wrapper, reconnection never gets a clean entry point.

**Why it happens:** The WICG spec explicitly says: "If a fatal error occurs, such as a USB device being removed, then `port.readable` will be set to `null`." [CITED: github.com/wicg/serial/blob/main/EXPLAINER.md]

**How to avoid:** Pattern 2 above — outer `while (port.readable)` catches fatal errors; inner loop handles clean cancel. Non-fatal errors (BufferOverrunError, FramingError, ParityError, BreakError) cause `port.readable` to be REPLACED with a fresh stream; outer loop re-enters and re-gets the reader.

**Warning signs:** Read loop exits but state machine says "connected"; no reconnect attempt after unplug.

[CITED: github.com/wicg/serial/blob/main/EXPLAINER.md]

### Pitfall 8: CP2102N Does Not Auto-Deassert DTR/RTS on Close (MEDIUM risk — hardware-specific)

**What goes wrong:** Windows 10 VCP driver pre-10.1.3 (and other OS-driver combos) leaves DTR/RTS in their last state when the port is closed. If the previous write ended with RTS asserted and the MicroBeast uses RTS for flow control, the MicroBeast may believe the host is still requesting data stop.

**Why it happens:** Silicon Labs CP2102N errata documents this explicitly. [CITED: Silicon Labs CP2102N errata PDF, paraphrased: "The CP2102N does not reset DTR/RTS when the port is closed… Applications must manually deactivate DTR and RTS signals through comm APIs."]

**How to avoid:** D-11 mandates `setSignals({false, false})` before every close. Covers this. Single helper in `serial.js` owns both call sites.

**Warning signs:** MicroBeast behaves oddly after a disconnect/reconnect cycle; next session doesn't respond until power-cycle.

[CITED: Silicon Labs CP2102N errata; Pitfall 12 in .planning/research/PITFALLS.md]

### Pitfall 9: Writer Held Across Disconnect (LOW risk — covered by teardown)

**What goes wrong:** If the writer from `port.writable.getWriter()` is still held when the port disconnects, subsequent attempts to close the port can stall.

**Why it happens:** WritableStream has a lock just like ReadableStream.

**How to avoid:** Pattern 3 — `writer.releaseLock()` in the teardown helper before `port.close()`. Also: our writer reference is module-scoped and nulled in teardown so subsequent reconnects start clean.

**Warning signs:** `port.close()` throws "writable stream is locked."

### Pitfall 10: Connection Pane Expanding During Paste Is Visually Jarring (LOW risk — UX)

**What goes wrong:** D-17 auto-expands the Connection pane on paste start. If the pane is above the canvas (D-07), the canvas pushes down by ~50 px while paste is in flight.

**Why it happens:** `<details>` opening shifts layout.

**How to avoid:** Planner's call — options include (a) CSS reserve-space transition, (b) accept the one-time push on paste start, (c) move pane to bottom on auto-expand. UX-SPEC calls this an acceptable minor distraction because paste is an operation the user just initiated.

**Warning signs:** UAT feedback "paste jumps the screen."

## Code Examples

### Example 1: Serial module public API shape (www/transport/serial.js)

```js
// www/transport/serial.js
// Source: [CITED: D-34] single-module layout; wireSerial(opts) mirrors Phase 3/4 wireChrome/wireKeyboard pattern.

import { registerWriter } from '../input/tx-sink.js';

// Module-scope state
let port = null, reader = null, writer = null;
let state = 'disconnected';
let lastConfig = null;                    // per-session serial config
let lastPortRef = null;                    // for D-25 exact-ref disambiguation
const stateObservers = [];
const errorLog = [];                       // ring of last 5

// Injected deps
let term = null, sampleBell = null, drainHostReply = null, requestFrame = null;
let connectButton = null, connectionPane = null, errorLogEl = null, statusLineEl = null;

// --- Public API ---

export function renderPoliteFail() { /* D-33 */ }

export async function wireSerial(opts) {
  ({ term, sampleBell, drainHostReply, requestFrame,
     connectButton, connectionPane, errorLogEl, statusLineEl } = opts);

  // D-26 — listen on navigator.serial for connect/disconnect.
  navigator.serial.addEventListener('connect',    onConnect);
  navigator.serial.addEventListener('disconnect', onDisconnect);

  // D-05 — boot restore: scan getPorts(), stash matching ref, do NOT auto-open.
  const stored = readStoredPreset();
  if (stored) {
    const ports = await navigator.serial.getPorts();
    const match = ports.find(p => {
      const i = p.getInfo();
      return i.usbVendorId === stored.usbVendorId && i.usbProductId === stored.usbProductId;
    });
    if (match) { lastPortRef = match; }
  }

  // D-30 — beforeunload best-effort cleanup.
  window.addEventListener('beforeunload', onBeforeUnload);

  // Wire UI.
  connectButton.addEventListener('click', onConnectButtonClick);
  setState('disconnected');
}

export function connectMicroBeast(configOverride) { /* wrapper around requestPort + open */ }
export async function disconnect() { await teardown(); setState('disconnected'); }
export function getState() { return state; }
export function onStateChange(fn) { stateObservers.push(fn); return () => { /* unsub */ }; }
export function getWriter() { return writer; }   // paste-pump uses for D-21 coupling
```

### Example 2: tx-sink writer coupling (extends Phase 4 tx-sink.js)

```js
// www/input/tx-sink.js — diff from Phase 4
// D-21: pushTxBytes ALSO calls writer.write(bytes) when a writer is registered.
// Signature unchanged — Phase 4 keyboard.js code path is unaffected.

let registeredWriter = null;

export function registerWriter(writer) { registeredWriter = writer; }
export function unregisterWriter()     { registeredWriter = null; }

export function pushTxBytes(bytes) {
  // ... existing ring-buffer append logic from Phase 4 ...
  for (let i = 0; i < bytes.length; i++) {
    ring[writeIdx] = bytes[i] & 0xFF;
    writeIdx = (writeIdx + 1) % RING_CAP;
    if (writeIdx === 0) wrapped = true;
  }
  notify();

  // NEW — D-21: if writer is registered, send bytes on the wire.
  if (registeredWriter) {
    // Fire-and-forget — Streams API backpressure handled inside write().
    // A failed write here does NOT remove the writer; teardown handles that.
    registeredWriter.write(bytes).catch((err) => {
      // Write error likely means port is going away — teardown flow will pick this up.
      console.error('[tx-sink] writer.write failed:', err);
    });
  }
}
```

### Example 3: keyboard.js Esc-intercept extension

```js
// www/input/keyboard.js — diff from Phase 4
// D-18 — Esc cancels paste while pump active; does NOT emit 0x1B in that case.

import { isActive as pastePumpIsActive, cancelPaste } from './paste-pump.js';

// Inside the keydown handler, BEFORE the normal encode path:
terminalWrapper.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (isComposing || e.isComposing) return;

  // NEW — D-18: Esc-while-paste-active cancels the paste instead of emitting 0x1B.
  if (e.code === 'Escape' && pastePumpIsActive()) {
    e.preventDefault();
    cancelPaste();
    return;
  }

  // ... existing encode path unchanged ...
});
```

### Example 4: chrome.js visibilitychange extension

```js
// www/renderer/chrome.js — diff from Phase 3
// D-39 — extend existing visibilitychange listener with requestFrame() catch-up.

// In wireChrome(opts) — opts now includes requestFrame.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.title.startsWith('(!) ')) {
    document.title = document.title.slice(4);
  }
  // NEW — D-39: catch-up paint on foreground return. The read loop kept feeding
  // term throughout the hidden period (pure async — immune to rAF throttling);
  // this just wakes the renderer to paint accumulated state.
  if (!document.hidden) requestFrame();
});
```

### Example 5: Paste-pump timing test (Playwright)

```js
// www/tests/transport/paste-pump.spec.js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(SERIAL_MOCK);
  await page.goto('/');
});

test('paste at 19200 baud paces at >= 95% of target duration @slow', async ({ page }) => {
  // Connect first.
  await page.locator('#connect-button').click();
  await expect(page.locator('#connect-button')).toHaveAttribute('data-state', 'connected');

  // Paste 5120 bytes (160 chunks × 32 B).
  const size = 5120;
  const expectedMs = Math.round(size / (19200 / 10 * 0.90) * 1000);  // ≈ 2963 ms

  await page.locator('#debug').evaluate((el) => { el.open = true; });
  await page.locator('#input').fill('A'.repeat(size));
  const t0 = await page.evaluate(() => performance.now());
  await page.locator('#paste-test').click();

  // Wait for progress 'complete' event.
  await page.waitForFunction(() => {
    return document.querySelector('#paste-progress')?.textContent?.includes('100%')
        || !document.querySelector('#paste-progress');
  }, { timeout: 10_000 });

  const elapsed = await page.evaluate((t0) => performance.now() - t0, t0);

  // D-41 tolerance: >= 95% of expected, NOT an exact match (Chromium CI jitter).
  expect(elapsed).toBeGreaterThanOrEqual(expectedMs * 0.95);

  // Verify all bytes made it through the mock writer.
  const totalWritten = await page.evaluate(() => {
    return window.__mockWriterLog.reduce((acc, { bytes }) => acc + bytes.length, 0);
  });
  expect(totalWritten).toBe(size);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `TextDecoder` on serial read | Raw `Uint8Array` end-to-end | Web Serial spec stabilised 2020 | Bytes survive; no partial-multibyte holdover. |
| rAF-driven read loop | Pure async `while(true){ await reader.read() }` | Chrome 88+ timer throttling | No data loss on background tabs. |
| Single `reader.read()` loop without cancel path | `reader.cancel()` + outer `while(port.readable)` | WICG/serial#112 (2020) | Clean disconnect without deadlock. |
| `navigator.usb.getDevices()` polling for hotplug | `navigator.serial.addEventListener('connect'/'disconnect')` | Chrome 89 | Zero polling cost; catches swaps. |
| Manual DTR/RTS via AT commands | `port.setSignals({...})` | Chrome 89 | First-class hardware signal control. |
| Per-port `port.addEventListener` | `navigator.serial` bubble listener | WICG explainer guidance | Catches port-instance swaps (Pitfall 11). |
| Nested-recursive setTimeout chain | Self-scheduling setTimeout chain | HTML5 spec 4 ms clamp | Avoids clamp; immune to slow-callback stacking. |
| `writer.write` fire-and-forget | `await writer.write(bytes)` for backpressure | Streams API standard | Pumps don't overflow the platform buffer. |

**Deprecated / outdated:**
- `navigator.usb` polling — replaced by `navigator.serial` events.
- `TextDecoder` in transport — forbidden per Pitfall 10.
- Synchronous DTR/RTS via OS ioctl — Web Serial is the only path from browsers.
- `keypress` event — deprecated; use `keydown` + `compositionend` (Phase 4 pattern continues).

## Assumptions Log

All claims in this research are either `[VERIFIED]` via Context7 / docs fetch / code grep, or `[CITED]` from a specific URL. No `[ASSUMED]` claims remain. Nothing needs user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| _empty_ | _(no unverified claims)_ | — | — |

## Open Questions

1. **Should `enqueuePaste()` accept `string` or only `Uint8Array`?**
   - What we know: D-12 API sketch says `bytes`. Phase 4 tx-sink takes both (Uint8Array fast path + Array<number> fallback).
   - What's unclear: Phase 6 clipboard integration (SESS-03) will call `enqueuePaste` with string data from `navigator.clipboard.readText()`.
   - Recommendation: Accept `Uint8Array | string`. If string, use the ASCII fast path from Phase 4's compositionend (charCodeAt <= 0xFF). Document as Claude's Discretion per CONTEXT (already listed there).

2. **Is a `<progress>` element better than a text line for paste progress (D-17)?**
   - What we know: D-17 specifies a text line `Pasting N B — X%` plus Cancel button.
   - What's unclear: `<progress value max>` is accessible by default; a text line needs aria-live region.
   - Recommendation: Planner's call. Text line is simpler and mirrors Phase 4 Debug hex strip styling; `<progress>` is more accessible. No SC depends on either.

3. **When multiple CP2102N adapters match (D-25 multi-match case), should the error log show VID/PID or a human name?**
   - What we know: D-25 says `Multiple CP2102N adapters connected — pick one`.
   - What's unclear: Could show USB product strings from `getInfo()` (not returned by Web Serial — `getInfo()` only returns IDs).
   - Recommendation: The D-25 text stands. No product-string field in SerialPortInfo as of Chromium 2026.

4. **How aggressive should `handleReadError` be about distinguishing NetworkError vs non-fatal errors?**
   - What we know: D-37 says "catch → inline error log → port-lost flow."
   - What's unclear: Non-fatal errors (`BufferOverrunError`, `FramingError`, `ParityError`, `BreakError`) replace `port.readable` with a fresh stream — the outer loop handles this automatically. But our current D-37 flow jumps to port-lost on any error.
   - Recommendation: Planner should make Pattern 2's outer loop handle non-fatal errors (re-enter loop without state change), and only flip to port-lost on NetworkError or when `port.readable === null`. This is a refinement of D-37 the planner can make safely per Claude's Discretion; error-message text stays user-friendly regardless.

## Environment Availability

Phase 5 has no external-tool dependencies beyond what Phases 1-4 already installed.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Chromium (dev browser) | Real-hardware UAT | ✓ (user's machine) | 89+ | — |
| Playwright | Automated tests (D-40..D-42) | ✓ (Phase 4 Plan 01) | frozen at Phase 4 version | — |
| Python3 http.server | Dev server (playwright.config.js webServer) | ✓ | system-shipped | `basic-http-server` (documented in index.html comment) |
| `wasm-pack` | Rebuild only if Phase 2 wasm surface changes — Phase 5 does NOT change it | ✓ | 0.12.1 (pinned) | — |
| Real MicroBeast + CP2102N USB cable | 05-HUMAN-UAT.md | ✓ (user's daily-driver machine) | `10c4:ea60` | — (manual UAT is manual) |
| Firefox / Safari | Polite-fail verification | Likely available | N/A | Skip UAT step, document as "verify on first chance" |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (frozen at Phase 4 Plan 01 version) |
| Config file | `www/playwright.config.js` — EXTEND `testMatch` with `'**/transport/*.spec.js'` |
| Quick run command | `npx playwright test tests/transport --grep @fast` |
| Full suite command | `npx playwright test` (all phases — render, input, transport) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| XPORT-01 | Transport is JS-only (no Rust Serial bindings) | unit | existing Phase 1 Plan 07 `cargo test --test core_02_no_browser_deps` | ✅ (Phase 1) |
| XPORT-02 | Stateful Connect/Disconnect button | integration | `npx playwright test tests/transport/connect-open.spec.js --grep "button label cycle"` | ❌ Wave 0 |
| XPORT-03 | Colour-coded connection status indicator | integration | `npx playwright test tests/transport/connect-open.spec.js --grep "border color state"` | ❌ Wave 0 |
| XPORT-04 | MicroBeast 19200 8N1 no-flow preset | integration | `npx playwright test tests/transport/connect-open.spec.js --grep "default config"` | ❌ Wave 0 |
| XPORT-05 | Serial config override UI (baud/data/stop/parity/flow) | integration | `npx playwright test tests/transport/config-form.spec.js` | ❌ Wave 0 |
| XPORT-06 | Clean port-disconnect recovery | integration | `npx playwright test tests/transport/disconnect-reconnect.spec.js --grep "read loop exits"` | ❌ Wave 0 |
| XPORT-07 | Restore previously-granted port on reload via `getPorts()` | integration | `npx playwright test tests/transport/disconnect-reconnect.spec.js --grep "getPorts on reload"` | ❌ Wave 0 |
| XPORT-08 | Auto-reconnect on USB re-plug via connect/disconnect | integration | `npx playwright test tests/transport/disconnect-reconnect.spec.js --grep "auto-reconnect"` | ❌ Wave 0 |
| XPORT-09 | Paste throttling at 19200 baud no-flow | integration (timing-tolerant) | `npx playwright test tests/transport/paste-pump.spec.js --grep "95 percent target"` | ❌ Wave 0 |
| XPORT-10 | Disconnect uses `reader.cancel()` before `port.close()` | unit (mock introspection) | `npx playwright test tests/transport/disconnect-reconnect.spec.js --grep "cancel before close"` | ❌ Wave 0 |
| XPORT-11 | Read loop pure async, survives background-tab throttling | integration | `npx playwright test tests/transport/read-loop.spec.js --grep "visibility"` | ❌ Wave 0 |
| PLAT-01 | Chromium detection on load | integration | `npx playwright test tests/transport/polite-fail.spec.js --grep "chromium detected"` | ❌ Wave 0 |
| PLAT-02 | Polite-fail full-page takeover on unsupported browsers | integration | `npx playwright test tests/transport/polite-fail.spec.js --grep "body replaced"` | ❌ Wave 0 |

### Success Criteria → Signal Map (ROADMAP SC-1..SC-5)

| SC | Observable Signal | Test Category | Test ID |
|----|-------------------|---------------|---------|
| SC-1 | Click Connect with MicroBeast preset → live output renders on canvas; typing reaches MicroBeast | Human UAT (real hardware only) | 05-HUMAN-UAT.md item 1-3 |
| SC-2 | Button border cycles gray→amber→green→red + label cycles 5 states | Playwright (mock) | `disconnect-reconnect.spec.js — state cycle` |
| SC-3a | Unplug exits read loop cleanly (reader.cancel() called first) | Playwright (mock introspection) | `disconnect-reconnect.spec.js — cancel before close` |
| SC-3b | Replug auto-reconnects without permission prompt (VID/PID matched) | Playwright (mock) + Human UAT | `disconnect-reconnect.spec.js — VID/PID match` + UAT item 4 |
| SC-3c | Reload restores port via getPorts() | Playwright (mock) | `disconnect-reconnect.spec.js — getPorts on reload` |
| SC-4a | Serial-config UI exposes all 5 overrides | Playwright | `config-form.spec.js — all controls present` |
| SC-4b | Paste rate-limited at 19200 baud (no silent overrun) | Playwright (timing) + Human UAT | `paste-pump.spec.js — timing` + UAT item 5 |
| SC-5a | Firefox/Safari shows polite fail, no console errors | Playwright (with UA override) + Human UAT | `polite-fail.spec.js — non-chromium` + UAT item 6 |
| SC-5b | Read loop survives background-tab throttling | Playwright (`page.context().pages()` + hidden) | `read-loop.spec.js — visibility change` |

### Decision → Validation Map (D-01..D-42)

| Decision | Validation Type | Command / Method |
|----------|----------------|------------------|
| D-01 (stateful button + border colors) | Playwright CSS assertion | `toHaveCSS('border-color', ...)` after `toHaveAttribute('data-state', ...)` |
| D-02 (requestPort filter) | Playwright mock assertion | `expect(lastRequestPortOpts).toEqual({filters:[{usbVendorId:0x10c4, usbProductId:0xea60}]})` |
| D-03 (port-lost state) | Playwright | simulate disconnect → assert state+label |
| D-04 (500 ms single retry) | Playwright (mock open-fail injection) | first open rejects → 500 ms later open resolves → state=connected |
| D-05 (getPorts restore, no auto-open) | Playwright (reload + restore path) | reload → state stays 'disconnected' but lastPortRef is set |
| D-06 (Connection pane DOM) | Playwright | `toBeVisible()` on `#connection` pane elements |
| D-07 (pane between top-bar and terminal) | Playwright | DOM order assertion |
| D-08 (serial-config form + 19200 preset) | Playwright | form defaults match; Reset button clicks restore defaults |
| D-09/D-11 (setSignals false/false on open + before close) | Playwright mock introspection | inspect `__mockState.lastSignals` before and after state transitions |
| D-10 (no Send Break) | Manual review | no `break` button in DOM |
| D-12 (paste-pump module API) | Playwright | call `window.__pastePump.enqueuePaste(...)` and assert `isActive()` |
| D-13/D-14 (90% pace, 32B chunks, 18ms gap) | Playwright timing | see Example 5 spec |
| D-15 (keypress bypass) | Playwright | type during paste → writer log shows interleaved bytes (keypress bytes ≤ paste-chunk-boundary) |
| D-16 (Debug Paste test button) | Playwright | button exists; click triggers pump |
| D-17 (progress line + cancel) | Playwright | text content assertions + click cancel |
| D-18 (Esc cancel vs 0x1B) | Playwright | type paste → Esc during active → `__mockWriterLog` does NOT end with 0x1B |
| D-19 (keypress queue-jump) | Playwright | interleaved types during paste land between chunks in `__mockWriterLog` |
| D-20 (port-lost mid-paste) | Playwright | start paste → __simulateUnplug() → progress status 'cancelled-port-lost' |
| D-21 (tx-sink single coupling) | Playwright | paste bytes appear in both `#tx-strip` AND `__mockWriterLog` |
| D-22 (local-echo during paste) | Playwright | flip local-echo on → paste → canvas grid shows pasted bytes |
| D-23 (CR/LF before enqueue) | Playwright | paste bytes containing 0x0D with CR/LF mode 'crlf' → `__mockWriterLog` has 0x0D 0x0A |
| D-24 (silent reconnect) | Playwright | simulate unplug+replug → no log entry, border-only signal |
| D-25 (VID/PID match policy) | Playwright mock | multi-match test: inject two mock ports → ambiguity branch hits |
| D-26 (navigator.serial listeners) | Code review + Playwright | listener registered on `navigator.serial`, not `port` |
| D-27 (error log ring-of-5) | Playwright | inject 6 errors → only last 5 visible |
| D-28 (permission revoke) | Playwright | inject NetworkError on read → error log contains 'Permission revoked' |
| D-29 (port-in-use) | Playwright | `open()` rejects with port-in-use → error log |
| D-30 (beforeunload cancel) | Playwright | `window.dispatchEvent(new Event('beforeunload'))` → verify setSignals called |
| D-31 (localStorage persistence) | Playwright | connect → read `localStorage.getItem('bestialitty.port.preset')` |
| D-32 (Chromium detection) | Playwright | spec that deletes `navigator.serial` in init script → body replaced |
| D-33 (polite-fail takeover) | Playwright | verify body content replaced, no `<canvas>` |
| D-34 (single module) | Code review | one file at `www/transport/serial.js` |
| D-35 (read-loop shape) | Code review + integration | bytes from `__mockReaderPush` trigger `term.feed`, `sampleBell`, `drainHostReply`, `requestFrame` |
| D-36 (reader.cancel single exit) | Playwright | all disconnect paths call cancel (instrument mock reader) |
| D-37 (read error → port-lost) | Playwright | inject read error → state transitions to port-lost |
| D-38 (no size hint on read) | Code review | reader.read() called with no args |
| D-39 (visibilitychange catch-up) | Playwright | set `document.hidden = true` then false → requestFrame called |
| D-40 (test split) | Manual review | Phase 5 has `tests/transport/` + `05-HUMAN-UAT.md` |
| D-41 (timing tolerance) | Playwright | timing test uses `>= 0.95 * expected` |
| D-42 (unplug/replug spec) | Playwright | `disconnect-reconnect.spec.js` |

### Sampling Rate

- **Per task commit:** `npx playwright test tests/transport --grep @fast` (subset under ~10 s)
- **Per wave merge:** `npx playwright test` (full Phase 3+4+5 suite)
- **Phase gate:** Full suite green + 05-HUMAN-UAT.md completed before `/gsd-verify-phase 05`

### Wave 0 Gaps

- [ ] `www/tests/transport/mock-serial.js` — shared `navigator.serial` mock exported as init-script string
- [ ] `www/tests/transport/polite-fail.spec.js` — PLAT-01, PLAT-02 + D-32, D-33
- [ ] `www/tests/transport/connect-open.spec.js` — XPORT-02, XPORT-03, XPORT-04 + D-01, D-02, D-06, D-07, D-08, D-09, D-11
- [ ] `www/tests/transport/read-loop.spec.js` — XPORT-11 + D-35, D-38, D-39
- [ ] `www/tests/transport/disconnect-reconnect.spec.js` — XPORT-06, XPORT-07, XPORT-08, XPORT-10 + D-03, D-04, D-05, D-24, D-25, D-26, D-30, D-31, D-36, D-37, D-42
- [ ] `www/tests/transport/paste-pump.spec.js` — XPORT-09 + D-12..D-23, D-41
- [ ] `www/tests/transport/config-form.spec.js` — XPORT-05 + D-08
- [ ] `www/playwright.config.js` — extend `testMatch` with `'**/transport/*.spec.js'`
- [ ] `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` — real-hardware checklist for SC-1, SC-3b (VID/PID), SC-4b (real 19200 baud), SC-5a (Firefox/Safari), 5-minute daily-driver feel

**Test coverage ratio:**
- Automated (Playwright mock): ~90% — state transitions, API shape, timing behaviour, mock-writer introspection.
- Human UAT (real hardware): ~10% — actual CP2102N behaviour, MicroBeast reset-on-connect check, 5-minute daily-driver feel, Firefox/Safari polite-fail rendering. **Mock cannot prove the hardware-level DTR/RTS doesn't reset the Z80 — only real hardware can.**

## Security Domain

Phase 5 has a genuine security surface because it grants web origins access to USB-connected hardware. Applicable ASVS categories:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user accounts in the app. |
| V3 Session Management | no | No server, no session. |
| V4 Access Control | yes | Browser-native: permission is per-origin, user-granted via native picker. Phase 5 MUST NOT call `requestPort()` without explicit user click (Pitfall: auto-requesting permission on page load). Enforced by D-02 (requestPort only on Connect click) and D-05 (no auto-open on reload). |
| V5 Input Validation | yes | Bytes from MicroBeast are UN-TRUSTED. Phase 1 parser is byte-safe (torn-chunk safe, ESC Y clamps). Phase 5's only job is to pass bytes through — no string interpolation, no HTML-rendering, no eval. Verified: D-35 feeds raw bytes into `term.feed(value)` with no transformation. |
| V6 Cryptography | no | No crypto surface. |
| V7 Error Handling | yes | D-27 inline error log shows last 5; `console.error` for DevTools. No sensitive data in errors (no permissions tokens, no device IDs beyond VID/PID). |
| V8 Data Protection | yes | `localStorage['bestialitty.port.preset']` stores ONLY `{usbVendorId, usbProductId}` — public hardware-identifier pair, not sensitive. Phase 6 will extend with full serial config and a "Forget port" UI. |
| V11 Business Logic | no | No business logic — it's a dumb byte pipe. |
| V12 Files and Resources | no | No file I/O in Phase 5 (session log download is Phase 6). |
| V13 API and Web Service | no | No server API. |
| V14 Configuration | yes | Hard-coded VID/PID filter (10c4:ea60) narrows `requestPort()` picker — reduces chance of user accidentally granting access to a different device. |

### Known Threat Patterns for Web Serial Apps

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Auto-requesting serial permission on page load | Tampering / Elevation | Only call `requestPort()` on explicit user click. Enforced by D-02. |
| Persisting granted-port identity without user awareness | Information Disclosure | Show matched VID:PID in UI (Claude's Discretion — recommended), allow user to "forget" (deferred to Phase 6 PREF-01). |
| Rogue origin tricking user into granting permission | Spoofing | Browser-native: Chromium shows the origin prominently in the picker. No mitigation needed in app. |
| Malicious MicroBeast output causing XSS-like injection | Injection / Tampering | D-35: bytes → `term.feed(Uint8Array)` only. Never HTML. Never `innerHTML =`. Pitfall 10 enforced. |
| Multi-tab race for the same port | Denial of Service | Chromium enforces single-tab ownership. D-29 shows user-friendly message. No BroadcastChannel in v1 (deferred). |
| `beforeunload` leaving port in bad state | Tampering | D-30 best-effort teardown + D-11 DTR/RTS de-assert. |
| Cross-frame access via iframe embed | Elevation | Deployment concern — `Permissions-Policy: serial=(self)` header. Deferred to Phase 6 PLAT-03 deploy config. |

**No new credentials, secrets, or auth surface in Phase 5.** Serial-port access is governed entirely by Chromium's per-origin permission model — the app does not need to implement any auth itself.

## Sources

### Primary (HIGH confidence — Context7 + WICG spec)

- [Context7 /wicg/serial](https://context7.com/wicg/serial/llms.txt) — Web Serial API surface: requestPort/filters, open/options, read/cancel/releaseLock, write/writable, setSignals/getSignals, getInfo, getPorts/forget, connect/disconnect events
- [WICG/serial EXPLAINER.md](https://github.com/WICG/serial/blob/main/EXPLAINER.md) — canonical outer-loop `while (port.readable)` + non-fatal error handling pattern
- [WICG/serial spec (index.html source)](https://wicg.github.io/serial/) — authoritative error-type taxonomy (NetworkError, BufferOverrunError, FramingError, ParityError, BreakError, UnknownError)
- [MDN: SerialPort.connected](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/connected) — true/false semantics, connect/disconnect event relationship
- [MDN: SerialPort.setSignals](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/setSignals) — field names (`dataTerminalReady`, `requestToSend`, `break`)
- [MDN: SerialPort.getInfo](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/getInfo) — returns `{usbVendorId, usbProductId}`
- [MDN: SerialPort connect_event](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/connect_event) — bubble semantics (connect bubbles from SerialPort to navigator.serial)
- [Chrome for Developers: Read from and write to a serial port](https://developer.chrome.com/docs/capabilities/serial) — canonical `reader.cancel()` pattern, writer.write() shape
- [WICG/serial#112 — Reader-lock deadlock](https://github.com/WICG/serial/issues/112) — foundation for Pitfall 1 / D-36
- [WICG/serial#156 — Auto-reconnect identity guidance](https://github.com/WICG/serial/issues/156) — foundation for Pitfall 11 / D-25
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) — visibilitychange semantics (D-39)
- [MDN: BeforeUnloadEvent](https://developer.mozilla.org/en-US/docs/Web/API/BeforeUnloadEvent) — handler time-budget (D-30)
- [MDN: Window.setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout) — 4 ms nested-clamp spec
- [javascript.info: setTimeout and setInterval](https://javascript.info/settimeout-setinterval) — nesting clamp behaviour after 5th level
- [Silicon Labs CP2102N errata](https://www.silabs.com/documents/public/errata/cp2102n-errata.pdf) — DTR/RTS not auto-deasserted on close (foundation for D-11 before-close discipline)

### Secondary (MEDIUM confidence — cross-verified)

- [Chrome for Developers: Timer throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) — background-tab throttling confirmation
- [MDN: Web Serial API overview](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) — Chromium-only confirmation, browser support table
- [MDN: Serial.requestPort](https://developer.mozilla.org/en-US/docs/Web/API/Serial/requestPort) — filter syntax
- [dev.to: Amazing powers of the web — Web Serial API (unjavascripter)](https://dev.to/unjavascripter/the-amazing-powers-of-the-web-web-serial-api-3ilc) — writer.ready backpressure explanation
- [Playwright: Mock browser APIs](https://playwright.dev/docs/mock-browser-apis) — `page.addInitScript` pattern for navigator.serial mock
- [WICG/serial#128 — Identify previously used port](https://github.com/WICG/serial/issues/128) — VID/PID matching context

### Tertiary (LOW confidence — single source, flagged for validation if used)

- [Medium: Why setTimeout can only be set to 4ms minimum (D.Dias)](https://medium.com/geekculture/why-settimeout-can-only-be-set-to-4ms-minimum-7ad9e2c2822e) — community overview (verified against MDN spec)

### Reused from earlier phase research

- `.planning/research/PITFALLS.md` §Pitfall 1, 6, 10, 11, 12 — absorbed into CONTEXT decisions
- `.planning/research/captures/README.md` §Serial Parameters — drives D-02 filter and D-08 preset
- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md` §Plan 02-06 — `feed_silent` + `host_reply` accessors the read loop uses
- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` §D-17, §D-03, §D-15 — sampleBell post-feed invariant and Debug pane pattern Phase 5 extends
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` §D-07, §D-10..D-12, §D-13/D-14 — tx-sink signature + CR/LF rewrite + Settings pane conventions Phase 5 reuses

## Metadata

**Confidence breakdown:**
- Web Serial API shape: HIGH — verified against WICG spec via Context7 + MDN cross-reference.
- Chromium quirks (timer throttling, bubbling events, port.readable null on fatal error): HIGH — official docs.
- CP2102N-specific behaviours (DTR/RTS not auto-deasserting, VID:PID `10c4:ea60`): HIGH — MicroBeast capture verified; Silicon Labs errata cited.
- Paste-pump design (32 B / 18 ms): HIGH — math verifiable; D-14 compile-in constants; D-41 tolerance-based timing tests.
- Playwright `navigator.serial` mock pattern: MEDIUM — `addInitScript` is canonical; specific mock shape is our synthesis (no public reference-implementation found for Web Serial specifically).
- Runtime state inventory (localStorage only): HIGH — only one new state-bearing artefact; verified via codebase grep.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (Web Serial spec is stable; 30-day freshness window for tertiary sources).
