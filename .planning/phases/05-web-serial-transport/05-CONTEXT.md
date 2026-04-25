# Phase 5: Web Serial Transport - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect to a real MicroBeast over Web Serial from JavaScript (no Rust
bindings), survive unplug/replug cleanly, restore the previously-granted
port on reload, and expose a serial-config override UI — with byte-safe
end-to-end transport (no TextDecoder on the read path), cancellation-safe
disconnect (`reader.cancel()` before `port.close()`), and a paste throttler
that prevents silent MicroBeast RX-buffer overrun at 19200 baud. Non-Chromium
browsers get a polite full-page failure. Satisfies XPORT-01..11, PLAT-01,
PLAT-02, and all five Phase 5 ROADMAP success criteria.

**In scope:**
- `www/transport/serial.js` (new module — port grant via `requestPort()`
  with MicroBeast VID/PID filter; `port.open()` with 19200 8N1 no-flow
  default; explicit DTR/RTS `setSignals({dataTerminalReady:false,
  requestToSend:false})` on open AND before every close; pure-async read
  loop `while(!cancelled){ const {value,done}=await reader.read(); if (done)
  break; term.feed(value); sampleBell(); drainHostReply('serial');
  requestFrame(); }`; write path via `writer = port.writable.getWriter()`;
  reconnect state machine listening on `navigator.serial` for
  `connect`/`disconnect` events with VID/PID-matched auto-reconnect;
  VID/PID persistence in `localStorage['bestialitty.port.preset']`;
  non-Chromium polite-fail full-page takeover before any wasm boot).
- `www/input/paste-pump.js` (new module — queue + `setTimeout`-paced
  chunker that targets ~90% of configured baud; feeds
  `tx-sink.pushTxBytes` then `writer.write(chunk)`; cancel-on-Esc and
  cancel-on-port-lost; drops queue on disconnect; applies Phase 4 CR/LF
  override before enqueueing; keypresses queue-jump between chunks).
- Extensions to `www/input/tx-sink.js` (`pushTxBytes` body swapped to
  `ring.push(bytes)` AND `writer.write(bytes)` when connected; signature
  preserved per Phase 4 D-07).
- Extensions to `www/main.js` (wire `serial.connectMicroBeast` /
  `disconnect` to the top-bar button; wire paste-pump to the new Debug
  `Paste test` button; wire `visibilitychange=visible` → `requestFrame()`
  extension in `chrome.js` OR inline; wire inline error log renderer).
- Extensions to `www/index.html` (top-bar stateful `#connect-button`;
  new `<details id="connection">` pane with port-status line, baud /
  data-bits / stop-bits / parity / flow-control form, `Reset to
  MicroBeast preset` button, paste progress region, inline error log;
  new Debug pane `<button id="paste-test">Paste test</button>`).
- Extensions to `www/renderer/chrome.js` (extend existing
  `visibilitychange` listener with `if (!document.hidden) requestFrame()`
  catch-up call — per Pitfall #6).
- `www/tests/transport/` — new Playwright suite with `navigator.serial`
  mock (stub `Serial`, `SerialPort`, `ReadableStream`, `WritableStream`,
  dispatchable `connect`/`disconnect` events via `window.__simulateUnplug`
  / `window.__simulateReplug`) covering XPORT-01..11, PLAT-01..02, and
  SC-1..SC-5.
- `05-HUMAN-UAT.md` — real-hardware checklist (open real MicroBeast port,
  type commands, unplug USB, replug, reload page, paste at 19200, polite
  fail verified in Firefox/Safari).

**Out of scope:**
- Clipboard paste wiring (Phase 6 SESS-02 / SESS-03 — Phase 5 ships the
  paste-pump module + a Debug-pane `Paste test` button that exercises it).
- Full serial-config persistence across reloads (Phase 6 PREF-01 — Phase 5
  only persists the VID/PID identity pair in `localStorage`).
- Session logging / download (Phase 6 SESS-04 / SESS-05).
- "Auto-connect on load" user preference (Phase 6 PREF-01 — Phase 5
  restores the port object via `getPorts()` but deliberately does NOT
  auto-open; user clicks Connect).
- `Send Break` button (v2-XPORT-01).
- User-configurable DTR/RTS initial-state toggles (v1 locks safe default
  false/false; add in future phase if a MicroBeast user needs DTR-as-reset).
- `BroadcastChannel` / cross-tab serial coordination (Pitfall mitigation
  is documented in Connection pane help text, no code).
- BYOB reader buffer tuning (platform-chosen chunk sizes — revisit only
  if hardware UAT shows GC churn).
- Persisting the last paste-pump cancel point / resume-across-reconnect.
- Any Rust-core changes — Phase 1 `feed_silent` + `host_reply` zero-copy
  accessors (Phase 2 Plan 06) are the only wasm surface this phase needs.

</domain>

<decisions>
## Implementation Decisions

### Connection chrome

- **D-01:** Connect/Disconnect is a **single stateful button** in the
  existing `#top-bar` (no new top-bar layout). Label cycles through
  `Connect` → `Connecting…` → `Disconnect` → `Reconnecting…` → `Reconnect`
  (the port-lost label). Border color encodes state per SC-2 ("colour-coded
  status indicator"):
  - gray (`--chrome-border`) — disconnected / initial
  - amber (`#e0b030`) — connecting or reconnecting
  - green (`--phosphor-fg` green variant, regardless of active phosphor) — connected
  - red (`#e04040`) — port-lost
  No separate colored dot; the button itself carries the full state signal.
- **D-02:** First-time port grant flow: click Connect → call
  `navigator.serial.requestPort({ filters: [{ usbVendorId: 0x10c4,
  usbProductId: 0xea60 }] })` to narrow the picker to CP2102N adapters
  (the MicroBeast's Silicon Labs chip per capture-01). User picks port →
  we call `port.open(...)` → success → store `{ usbVendorId, usbProductId }`
  pair in `localStorage['bestialitty.port.preset']`. No in-app port list;
  the native Chromium picker is the only port-selection UI.
- **D-03:** Port-lost state (USB unplug mid-session): label becomes
  `Reconnect`, border red. Background auto-reconnect runs silently via
  the `navigator.serial` `connect` event; if that fires with a matching
  VID/PID and `open()` succeeds, state flips back through amber to green
  automatically. Clicking the Reconnect button is a user-forced fallback
  that re-invokes `requestPort()` (user picks again).
- **D-04:** Auto-reconnect retry cadence on transient `open()` failure:
  **single silent retry 500ms after the `connect` event**. If that also
  fails, border stays red and the inline error log (D-26) shows the
  exception message. No exponential backoff — user-driven recovery via
  clicking Reconnect is the fallback.
- **D-05:** Page reload with a previously-granted port: boot scans
  `navigator.serial.getPorts()`, finds any matching the stored VID/PID,
  stashes the `SerialPort` reference in the transport module — but
  **does NOT auto-open**. Button shows `Connect` with gray border. User
  clicks Connect to open. Rationale: auto-open on boot would produce a
  spurious port-lost if the MicroBeast happens not to be powered when
  the page loads; requiring an explicit click preserves the "connect is
  always user-intentional" posture (also a mild security affordance).
- **D-06:** New `<details id="connection">` pane hosts: port-status
  string (shows matched VID:PID when present, e.g. `"MicroBeast (CP2102N
  10c4:ea60)"`), serial-config form (D-08), `Reset to MicroBeast preset`
  button, paste progress region (D-17), inline error log (D-26). Pane
  is default-collapsed; auto-expands during active paste OR when a new
  error lands.
- **D-07:** Pane placement: Connection pane lives **between** `#top-bar`
  and `#terminal-wrapper` in DOM order (so port status is visible without
  pushing the canvas down much when collapsed). Settings pane stays
  after the canvas, Debug pane after Settings — unchanged.
- **D-08:** Serial-config knobs exposed in v1 (XPORT-05): `baud`, `data
  bits`, `stop bits`, `parity`, `flow control`. MicroBeast-preset
  defaults: 19200 / 8 / 1 / `none` / `none` — sourced from
  `.planning/research/captures/README.md §Serial Parameters`. Plus a
  `Reset to MicroBeast preset` button that snaps every field back to
  these defaults (aligns with PLAT-05 "one click to connect").
- **D-09:** DTR/RTS default is **both false** on open. Rationale:
  Pitfall #12 documents that many USB-serial adapters (including the
  CP2102N on the MicroBeast) wire DTR/RTS to GPIOs that can reset or
  lock up the retro system; both-false is the safe universal default.
  **Not user-configurable in v1** — locked at safe defaults; a future
  phase adds UI toggles if a MicroBeast user surfaces a DTR-as-reset
  workflow.
- **D-10:** `Send Break` button: **deferred to v2-XPORT-01**. Not in
  Phase 5 scope.
- **D-11:** DTR/RTS are explicitly de-asserted by
  `port.setSignals({ dataTerminalReady: false, requestToSend: false })`
  in two places: **(a)** immediately after every `port.open()` (Pitfall #12
  safe-default on open) and **(b)** immediately before every
  `reader.cancel() + port.close()` path, including the `beforeunload`
  handler (Pitfall #12 note: "explicitly de-assert DTR/RTS before close,
  rather than letting the close do it implicitly"). One helper in
  `serial.js` owns both call sites.

### Paste throttling

- **D-12:** New module `www/input/paste-pump.js` owns the paste queue
  + timer. Public API: `enqueuePaste(bytes)` (adds bytes to queue, starts
  pump if idle), `cancelPaste()` (drains queue, clears timer), `isActive()`
  (used by keyboard.js Esc-intercept check), `onProgress(fn)` (observer
  for the Connection pane progress UI). Pump internally calls
  `tx-sink.pushTxBytes(chunk)` per chunk (D-21); `tx-sink` also writes
  to the serial writer when connected (the single coupling point). Phase
  4's `pushTxBytes` signature stays, keyboard.js unchanged.
- **D-13:** Pace target: **~90% of the configured baud rate** (byte rate
  = baud / 10 for 8N1). At 19200 8N1 that's ~1728 B/s, leaving margin
  for OS jitter, USB scheduling, and keypress bytes queue-jumping (D-19).
  Pump recomputes chunk timing when baud changes in the Connection pane.
- **D-14:** Chunk strategy: **fixed chunk size + `setTimeout` gap**.
  Computed from baud: `chunkSize = 32` bytes; `gapMs = Math.round(32 /
  (baud / 10 * 0.90) * 1000) = 18` at 19200. Simple, predictable, easy
  to verify with timing tests. Compiled-in constants in `paste-pump.js`
  (not user-tunable in v1 — see D-13 rationale re: recompute on baud
  change).
- **D-15:** What goes through the pump: **only explicit paste events**
  (Phase 5 ships the module; Phase 6 SESS-03 wires clipboard). Single
  keypresses bypass the pump entirely — `keyboard.js` still calls
  `tx-sink.pushTxBytes(bytes)` synchronously, and when connected that
  immediately issues `writer.write(bytes)`. Preserves daily-driver
  keypress feel; pump overhead never affects single keys.
- **D-16:** Phase 5 proves the pump works via a new
  `<button id="paste-test">Paste test</button>` in the Debug pane (next
  to `Feed` / `64 KB Stress`). Click routes the textarea's parsed bytes
  through `enqueuePaste` → pump → tx-sink → writer. Verifiable against
  a real MicroBeast via 05-HUMAN-UAT.md and against the Playwright mock
  writer via timing assertions (D-39).
- **D-17 (AMENDED 2026-04-23 by Plan 09 — Gap 2 fix):** Paste progress UI
  renders as a `[hidden]`-toggled flex item in `#top-bar` (which is
  `position: sticky; top: 0`), NOT inside the Connection pane. The progress
  line reads `Pasting 5120 B — 43%` with a `Cancel` button inline, and is
  visible without mutating `details.open` or causing any canvas movement.
  When the pump finishes (or is cancelled), the `[hidden]` attribute is
  restored after the existing 2 s (complete / cancelled) or 3 s
  (cancelled-port-lost) timeout. Progress text updates on every chunk write
  (~55 Hz at 32 B / 18 ms), no rAF tie-in (keeps pump independent of render
  loop per XPORT-11).

  **Rationale for amendment:** The original D-17 auto-expanded the
  Connection pane on paste start. In real-hardware UAT (05-HUMAN-UAT.md
  Test 6) the expanding pane (~250-330 px height delta) pushed the terminal
  canvas down the viewport — the user described it as "alarming lurch."
  The spec was wrong on real hardware; the fix relocates the progress UI
  to the sticky top-bar so visibility is achieved without displacement.
  Debug session: `.planning/debug/paste-auto-expands-pane-lurches-canvas.md`.

  **Contrast with D-27 (error-log auto-expand):** D-27 auto-expands the
  Connection pane when a new error is appended. D-27 is KEPT (not amended)
  because errors are rare, sticky, and demand user attention; the red
  border on the Connect button is the primary signal, the pane-expand is
  a secondary pull-focus. Pastes are frequent and transient — auto-expand
  costs more than it buys. The two behaviors are intentionally asymmetric.

  <details>
  <summary>Superseded original D-17 (kept for traceability)</summary>

  > **D-17 (original, 2026-04-22):** Paste progress UI: the Connection
  > pane shows a single line `Pasting 5120 B — 43%` with a `Cancel` button
  > next to it while the pump is active. If the Connection pane is
  > collapsed when `enqueuePaste` is called, open it automatically. When
  > the pump finishes (or is cancelled), the progress line clears and the
  > pane returns to its prior expanded/collapsed state. Progress text
  > updates on every chunk write (~55 Hz at 32B/18ms), no rAF tie-in
  > (keeps pump independent of render loop per XPORT-11).

  </details>
- **D-18:** Cancel paths: **Cancel button + Esc key**. Cancel button
  lives next to the progress line (D-17). Esc cancels **only while the
  pump is active** — `keyboard.js` checks `pastePump.isActive()` at the
  top of its Escape-keydown branch; if true, call `cancelPaste()` and
  do NOT emit the 0x1B byte (no TX). When pump is idle, Esc encodes
  normally as 0x1B (Phase 4 behaviour unchanged). Flag-gated, no
  user-visible mode indicator.
- **D-19:** Keypresses during paste **queue-jump** the pump. Pump
  internal loop: `writeOneChunk()` → `flushPendingKeypressBytes()` →
  `setTimeout(writeOneChunk, gapMs)`. Since single-key TX is 1-3 bytes
  and chunk size is 32, the keypress injection between chunks stays
  well within the 90% budget. Rationale: daily-driver feel trumps
  uniform rate limiting — a paste in flight must not make typing feel
  laggy.
- **D-20:** On port-lost mid-paste: pump's `onPortLost()` handler
  clears the queue, cancels the timer, and fires one final progress
  event with status `'cancelled-port-lost'`. Connection pane progress
  line changes to `Paste cancelled — port lost (N bytes unsent)` and
  clears after 3 seconds. No queue persistence across reconnect —
  Phase 5 treats paste as an atomic "in this session" operation.
- **D-21:** Route: `paste-pump → tx-sink.pushTxBytes → (writer.write if
  connected)`. Paste traffic flows through the same tx-sink ring buffer
  as keypresses, so the Phase 4 Debug hex strip shows paste bytes
  streaming past — one observability path for both (no special-case).
- **D-22:** Local-echo ON during paste (INPUT-04 toggle): each chunk
  the pump sends is also fed to `term.feed(chunk)` immediately after
  `writer.write(chunk)`. Screen fills at 19200-baud-paced speed,
  matching the rate the bytes actually hit the wire. Single call site
  in the pump. No pre-render of full paste, no bypass of paste pacing
  for echo.
- **D-23:** Phase 4's CR/LF override rewrite applies to paste bytes:
  if mode is `lf`, every 0x0D in the paste becomes 0x0A; if `crlf`,
  every 0x0D becomes 0x0D 0x0A. Rewrite happens **before** bytes enter
  the pump queue (not mid-pump) so chunk accounting stays predictable
  and mode-changes mid-paste don't corrupt the in-flight stream.

### Auto-reconnect & error UX

- **D-24:** Auto-reconnect visibility is **silent**. Border cycles
  red → amber → green as state transitions; label cycles Reconnect →
  Reconnecting… → Disconnect. No log line, no toast, no audible cue.
  User's "it worked" signal is typing-works-again and green border.
- **D-25:** VID/PID matching policy: on `connect` event, iterate
  `navigator.serial.getPorts()` filtering by stored
  `{ usbVendorId, usbProductId }`. If exactly one match → open
  silently. If multiple matches → prefer the exact `SerialPort` object
  reference from before disconnect (Chromium may re-use the instance;
  if it does, that's our device). If no identity match AND multiple
  VID/PID matches → border red, label becomes `Choose MicroBeast…`,
  clicking opens `requestPort()` with the VID/PID filter so user picks.
  Inline error log entry: `Multiple CP2102N adapters connected — pick one`.
- **D-26:** `connect` and `disconnect` event listeners live on
  **`navigator.serial`**, not on individual `SerialPort` instances
  (Pitfall #11 integration-gotchas: "catches cases where the instance
  is swapped"). Wired once at boot in `serial.js`.
- **D-27:** Inline error log: small region inside the Connection pane
  showing the **last 5 messages** (newest at top). Each message is a
  one-liner `{HH:MM:SS} {event-code}: {user-facing message}`. Older
  messages drop off the top (fixed ring in memory). Pane auto-expands
  when a new error arrives. Also `console.error` for DevTools. No UI
  for clearing in v1 (reload clears; drop-off reclaims over time).
- **D-28:** Permission revocation mid-session (user visits
  `chrome://settings` and revokes): treated as port-lost. `read()` or
  `write()` throws `NetworkError`; error handler triggers the full
  disconnect flow. Inline log shows
  `Permission revoked — click Reconnect to re-authorize`. Click
  Reconnect re-invokes `requestPort()` which re-prompts the user.
- **D-29:** "Port in use by another tab" (Chromium enforces
  single-tab ownership): `port.open()` throws. Error handler shows
  `MicroBeast is in use by another BestialiTTY tab — close it to connect here.`
  in the inline log. No `BroadcastChannel` cross-tab coordination —
  documented in the pane help text, not in code.
- **D-30:** `beforeunload` handler: best-effort
  `await port.setSignals({dataTerminalReady:false, requestToSend:false})`
  → `await reader.cancel()` → `await port.close()`. All awaits are
  best-effort (beforeunload has a very tight time budget); any rejection
  is swallowed. Matches Pitfall #12 note about de-asserting DTR/RTS
  before close, and Pitfall #1 reader-lock hygiene.
- **D-31:** VID/PID persistence: write
  `localStorage['bestialitty.port.preset'] = JSON.stringify({
  usbVendorId, usbProductId })` on first successful open. Read on boot
  to seed the `getPorts()` match. No UI for forgetting / managing
  stored port in v1 — user "forgets" by clicking Connect and picking a
  different port (overwrites the stored pair). Phase 6 PREF-01 extends
  this with full serial config + a visible "Forget port" control.

### Polite fail + read loop

- **D-32:** Non-Chromium detection:
  **`typeof navigator.serial === 'undefined'`**. Feature-detect only, no
  UA sniffing. Runs as the **first line** of `main.js` before any wasm
  init or canvas boot. Forward-compatible: if Firefox or Safari ever ship
  Web Serial, BestialiTTY works there with no code change.
- **D-33:** Polite-fail UI: **full-page takeover**. When detection
  fails, `main.js` calls `renderPoliteFail()` from `serial.js` which
  **replaces** the body content with a static message — no wasm init,
  no canvas boot, no font loading:
  > BestialiTTY requires a Chromium-based browser
  >
  > Web Serial API is Chromium-only (Chrome, Edge, Brave, Opera, Arc).
  > Open BestialiTTY in one of those to connect to your MicroBeast.
  >
  > [link to chromiumdash.appspot.com/releases or similar]

  Rationale: avoids wasted init (wasm + fonts + canvas are not free),
  and a demo-mode UI would mislead users into thinking the app might
  work with workarounds.
- **D-34:** Transport module layout: **single
  `www/transport/serial.js`**. Owns: polite-fail detection + rendering,
  port grant via `requestPort()`, `port.open()` / `port.close()`,
  read loop, writer, DTR/RTS helper, reconnect state machine, VID/PID
  persistence, `connect`/`disconnect` listener on `navigator.serial`,
  inline error log plumbing. Public exports: `connectMicroBeast()`,
  `disconnect()`, `getState()`, `onStateChange(fn)`, `getWriter()` (for
  paste-pump), `renderPoliteFail()`. Mirrors Phase 3 `renderer/` and
  Phase 4 `input/` convention (single main module per subsystem).
- **D-35:** Read loop shape: pure async, decoupled from rAF per
  XPORT-11.
  ```js
  async function runReadLoop() {
    reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        term.feed(value);            // Phase 2 feed_silent path
        sampleBell();                // Phase 3 BEL-while-hidden (post-feed)
        drainHostReply('serial');    // Phase 2 zero-copy accessor drain
        requestFrame();              // Wake renderer
      }
    } catch (err) {
      handleReadError(err);          // D-37
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
  ```
  Reader reference is module-scoped so the disconnect path can call
  `reader.cancel()` (Pitfall #1 exit path, D-36). `term.feed(value)`
  passes raw `Uint8Array` bytes with no `TextDecoder` (Pitfall #10).
  `sampleBell()` + `drainHostReply()` + `requestFrame()` mirror Phase 3
  Plan 03's post-feed invariant exactly — this is the pattern Phase 3
  D-17 / D-03 established and Phase 5 extends to the new term.feed
  call site.
- **D-36:** Read-loop exit is **via `reader.cancel()` only**. Disconnect
  handlers call `reader.cancel()` which causes the pending `await
  reader.read()` to resolve with `{ done: true }`; the loop falls out
  through the finally block. No shared cancelled flag. Single exit
  path per Pitfall #1.
- **D-37:** Read errors (NetworkError, BufferOverrunError, etc.):
  catch → append inline error log entry → `console.error` for DevTools
  → trigger the full port-lost flow (set state red, label Reconnect).
  Background auto-reconnect via the `connect` event handles the
  recovery path. Predictable state machine — no in-loop retry.
- **D-38:** `reader.read()` called with **no size hint** — the platform
  chooses chunks (typically 1-4 KB on USB-serial at 19200). `term.feed`
  handles any chunk size including torn escape sequences (PARSER-03
  regression-guarded). BYOB-reader buffer tuning is deferred unless
  hardware UAT shows GC churn during bulk output.
- **D-39:** Extend Phase 3's existing `visibilitychange` listener
  (currently only strips the BEL title prefix) so that on
  `!document.hidden` transitions it also calls `requestFrame()` —
  Pitfall #6 mitigation. The async read loop kept feeding `term`
  throughout the hidden period; this catch-up `requestFrame()` just
  paints the accumulated result immediately instead of waiting for
  the next natural rAF tick.

### Test strategy

- **D-40:** Phase 5 test coverage splits into (a) Playwright with a
  `navigator.serial` mock and (b) 05-HUMAN-UAT.md for real hardware.
  The mock stubs `Serial`, `SerialPort`, `ReadableStream`,
  `WritableStream`, and exposes test helpers `window.__simulateUnplug()`
  and `window.__simulateReplug()` that dispatch `disconnect` / `connect`
  events. Mirrors Phase 4's Playwright + VALIDATION.md split.
- **D-41:** Paste-pump timing tests use a mock writer that records
  `{ bytes, ts }` per `write()`. Test asserts `sum(bytes) === paste_size`
  and `total_elapsed >= 0.95 * (size / rate_target_bytes_per_sec * 1000)`.
  Uses tolerance rather than exact-timing assertions to survive Chromium
  timer jitter in CI. Fake timers NOT used — real `setTimeout` with
  tolerance matches the production path.
- **D-42:** Port-lost / reconnect tests simulate the USB unplug/replug
  cycle via `window.__simulateUnplug` / `window.__simulateReplug`.
  Playwright asserts button border color + label text + inline-log
  contents + read-loop exit + re-entry. Covers SC-3 end-to-end without
  hardware.

### Claude's Discretion

- Exact top-bar layout when the Connect button is added (whether it
  goes left of theme-toggle, right of the phosphor group, or between
  them — UI-SPEC-driven during planning).
- Exact CSS of the Connection pane — mirror Settings pane styling
  unless there's a reason not to.
- Exact string copy for the polite-fail page (message wording, link
  text, button absent or present for "Why Chromium-only?").
- Exact error-message phrasing in the inline log (short and actionable
  is the bar; exact text discovered during implementation).
- Exact DOM order inside the Connection pane (port-status line, config
  form, preset-reset button, paste progress region, error log) —
  planner picks based on visual flow.
- Whether the Connection pane shows the matched VID:PID label (e.g.
  `"MicroBeast (CP2102N 10c4:ea60)"`) or just a generic "connected".
- Minimum Chromium version to document — Chromium 89 is the floor
  (top-level-await baseline from Phase 2; Web Serial is stable there).
- Exact Playwright mock file organisation (single `mock-serial.js`
  fixture vs per-test harness — follow whichever `www/tests/input/`
  established in Phase 4).
- Chunk size tuning if hardware UAT shows the compiled-in 32 B / 18 ms
  defaults are wrong for a real MicroBeast's UART RX buffer (a one-line
  constant change).
- Whether `enqueuePaste` accepts `Uint8Array` only or also `string`
  (keep it `Uint8Array` to match `tx-sink` style, unless clipboard
  integration in Phase 6 makes string ergonomically necessary then).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` — architecture split (Rust core / JS shell,
  Web Serial driven from JS only), Chromium-only + polite-fail,
  static-site constraint, daily-driver target; Key Decisions table
  row "Web Serial driven from JS, not Rust" — validated by this phase
- `.planning/REQUIREMENTS.md` §Transport — XPORT-01..11 (all Phase 5);
  §Platform PLAT-01..02 (also Phase 5); Out-of-Scope block confirms
  Firefox / Safari support and Rust Web Serial bindings are not in scope
- `.planning/ROADMAP.md` §"Phase 5: Web Serial Transport" — goal,
  depends on Phase 4, SC-1..SC-5

### MicroBeast capture — hardware ground truth

- `.planning/research/captures/README.md` §"Serial Parameters
  (XPORT-04 verification)" — confirms 19200 / 8N1 / no flow control +
  CP2102N VID:PID `10c4:ea60`; drives D-02 (picker filter) and D-08
  (default config) directly
- `.planning/research/captures/capture-01-cpm-boot/README.md` +
  `.planning/research/captures/capture-02-basic/README.md` — byte-level
  verification that the configured params produce readable output

### Phase 1/2/3/4 deliverables load-bearing for Phase 5

- `.planning/phases/01-rust-core-parser-grid-key-encoder/01-CONTEXT.md`
  — PARSER-03 torn-chunk safety guarantee the read loop relies on
  (Web Serial chunks can split an `ESC Y row col` sequence; parser
  handles it)
- `.planning/phases/02-wasm-boundary-minimal-js-harness/02-CONTEXT.md`
  §Plan 02-06 — `Terminal::feed_silent` + `host_reply` zero-copy
  accessors; the read loop uses `term.feed(bytes)` (which internally
  dispatches feed_silent on the wasm side), `drainHostReply('serial')`
  reads host replies from the cached zero-copy view
- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` §D-17, §D-03
  (sampleBell post-feed invariant) — read loop MUST call
  `sampleBell()` + `drainHostReply()` + `requestFrame()` after every
  `term.feed(value)` to preserve BEL-while-hidden, host-reply, and
  dirty-rows-repaint semantics
- `.planning/phases/03-canvas-renderer/03-CONTEXT.md` §D-15 — Debug
  pane pattern, extended in Phase 5 with `Paste test` button
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` §D-07 — `tx-sink`
  `pushTxBytes(bytes)` signature — Phase 5 extends the body (add
  `writer.write(bytes)` when connected) without changing the signature
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` §D-10..D-12 —
  CR/LF TX-side rewrite — Phase 5 paste-pump applies the same rewrite
  (via a helper exported from `keyboard.js` or a shared module) before
  enqueueing paste bytes
- `.planning/phases/04-keyboard-input/04-CONTEXT.md` §D-13/D-14 —
  Settings pane DOM + CSS conventions Phase 5 Connection pane mirrors

### Pitfalls research (critical for Phase 5)

- `.planning/research/PITFALLS.md §Pitfall 1 — Reader-Lock Deadlock on
  Disconnect` — drives D-36 (reader.cancel() single exit path) and
  D-30 (beforeunload cancel-before-close)
- `.planning/research/PITFALLS.md §Pitfall 4 — wasm↔JS Boundary
  Chattiness` — confirms read loop passes whole chunks to
  `term.feed(value)` in one boundary call (Phase 2 already batched;
  Phase 5 must not chunk per byte)
- `.planning/research/PITFALLS.md §Pitfall 6 — Background-Tab
  Throttling Silently Loses Serial Data` — drives D-35 (pure async
  read loop decoupled from rAF) and D-39
  (visibilitychange → requestFrame catch-up)
- `.planning/research/PITFALLS.md §Pitfall 10 — Binary/High-Bit Bytes
  Corrupted by UTF-8 Decoder` — drives D-35 ("no TextDecoder" in the
  read loop, bytes end-to-end)
- `.planning/research/PITFALLS.md §Pitfall 11 — Serial Port Identity
  Mismatch on Reconnect` — drives D-02 (VID/PID filter on
  requestPort), D-05 (getPorts on reload without auto-open), D-25
  (ambiguity policy), D-26 (navigator.serial-level listeners), D-31
  (localStorage VID/PID persistence)
- `.planning/research/PITFALLS.md §Pitfall 12 — DTR/RTS State
  Accidentally Resets MicroBeast on Connect` — drives D-09 (safe
  defaults), D-11 (de-assert on open AND before every close), D-30
  (beforeunload de-assert before cancel)
- `.planning/research/PITFALLS.md §Integration Gotchas` — the
  "listen on navigator.serial too" note drives D-26

### Existing code Phase 5 integrates with

- `www/input/tx-sink.js` — `pushTxBytes` / `formatHexStrip` /
  `registerTxObserver` / `resetTx` — extended in Phase 5 to also call
  `writer.write(bytes)` when connected
- `www/input/keyboard.js` — `setLocalEcho`, `setCrlfMode`, `isComposing`
  guard — Phase 5 paste-pump uses the CR/LF mode; Esc-intercept check
  in keydown handler consumes `pastePump.isActive()`
- `www/main.js` — `sampleBell`, `drainHostReply('serial')`,
  `requestFrame` — injected into `serial.js` via a `wireSerial(opts)`
  pattern mirroring `wireKeyboard(opts)` and `wireChrome(opts)` (D-34
  module layout leaves this to planner)
- `www/main.js:40+` — `reDeriveHostReplyView()` helper — read loop
  uses this (or an equivalent) per chunk
- `www/renderer/chrome.js` — existing `visibilitychange` listener
  (currently only strips BEL title prefix); Phase 5 extends with
  `requestFrame()` on `!document.hidden` per D-39
- `www/index.html` — `#top-bar` (Connect button added); existing
  `#debug` pane pattern (Paste test button added); existing
  `#settings` pane pattern (new `#connection` pane mirrors it)

### External specs

- [Chrome for Developers: Read from and write to a serial port](https://developer.chrome.com/docs/capabilities/serial)
  — canonical `reader.cancel()` before `port.close()` pattern (D-30,
  D-36); writer.write() pattern (paste-pump); DTR/RTS via `setSignals`
- [MDN: Serial interface](https://developer.mozilla.org/en-US/docs/Web/API/Serial)
  — `requestPort(options)` filter syntax for VID/PID narrowing (D-02);
  `getPorts()` return semantics on reload (D-05)
- [MDN: SerialPort.setSignals()](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/setSignals)
  — DTR / RTS / break signal API (D-09, D-11, D-30); confirms
  `dataTerminalReady` and `requestToSend` are the correct field names
- [MDN: SerialPort connect event](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/connect_event)
  + [disconnect event](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/disconnect_event)
  — navigator.serial-level listener shape (D-26)
- [MDN: SerialPort.getInfo()](https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/getInfo)
  — returns `{usbVendorId, usbProductId}` used for stored-preset match
  (D-25, D-31)
- [WICG/serial spec](https://wicg.github.io/serial/) — authoritative
  on the Web Serial API shape
- [WICG/serial#112](https://github.com/WICG/serial/issues/112) — the
  canonical reader-lock deadlock discussion (Pitfall #1 foundation)
- [WICG/serial#156](https://github.com/WICG/serial/issues/156) — auto-
  reconnect identity guidance (Pitfall #11 foundation)
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
  — `visibilitychange` event shape (D-39 catch-up render)
- [MDN: BeforeUnloadEvent](https://developer.mozilla.org/en-US/docs/Web/API/BeforeUnloadEvent)
  — handler time-budget constraints (D-30 best-effort posture)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `www/input/tx-sink.js` (Phase 4 D-07) — `pushTxBytes(bytes)` signature
  is the single point where Phase 5 swaps in `writer.write(bytes)`.
  Zero change to keyboard.js. Also `formatHexStrip` / `resetTx` /
  `registerTxObserver` stay untouched — the Debug pane's hex strip
  continues to reflect every TX byte (keypress + paste).
- `www/main.js:140-160` — `sampleBell()` + `TITLE_PREFIX` pattern — the
  read loop MUST call `sampleBell()` after every `term.feed(value)` to
  preserve the BEL-while-hidden title prefix flow established in
  Phase 3 (survives rAF throttling because the call is synchronous
  with the feed, not rAF-scheduled).
- `www/main.js:122-137` — `reDeriveHostReplyView()` + `drainHostReply()`
  helpers — read loop reuses this (or a near-copy in `serial.js`)
  to drain any host replies the parser produced (e.g. ESC / K response
  to ESC Z).
- `www/renderer/canvas.js` `requestFrame()` export — the read loop
  calls this to wake the renderer after each fed chunk.
- `www/renderer/chrome.js` existing `visibilitychange` listener —
  Phase 5 extends it (one-line change) with a `requestFrame()` catch-up
  on `!document.hidden` per Pitfall #6.
- `www/index.html` top-bar layout + Debug/Settings `<details>` pane
  pattern — Connection pane mirrors the existing Settings pane CSS;
  top-bar Connect button reuses the existing `#top-bar button` styling
  with a new state-driven border-color rule.
- Phase 4 Playwright infrastructure at `www/tests/input/` +
  `www/playwright.config.js` + `window.__testGridView` harness —
  Phase 5 adds `www/tests/transport/` mirroring the pattern.

### Established Patterns

- **`wireX(opts)` dependency injection** (Phase 3 `wireChrome`, Phase 4
  `wireKeyboard`) — `serial.js` exposes `wireSerial(opts)` where
  `opts = { term, wasm, sampleBell, drainHostReply, requestFrame,
  connectButton, connectionPane, … }`. Keeps `serial.js` standalone-
  testable, avoids circular imports.
- **Module-scope cached Uint8Array views with buffer-identity guard**
  (Phase 2 D-03 + Phase 3 + Phase 4 TX sink) — any view into
  `wasm.memory.buffer` derived inside the read loop re-derives on
  buffer-identity change (memory growth from large feeds).
- **Framework-free JS** (Phase 2 D-14) — no React, no bundler. Phase 5
  continues: plain ES modules, imported directly.
- **`<details>` pane per concern** (Phase 3 Debug, Phase 4 Settings) —
  Phase 5 adds the Connection pane using the same disclosure pattern.
- **Synchronous `preventDefault` in keydown handlers** (Phase 4
  Pitfall #3) — paste-pump Esc-intercept stays on the Phase 4
  keydown handler's synchronous path; no async wrapping.
- **Non-rAF bell sampling + non-rAF host-reply drain** (Phase 3
  Plan 03-03 / Plan 04-02) — read loop honors the same discipline.
- **One `<pre>` hex-strip observer registered at boot in main.js**
  (Phase 4 D-15) — Phase 5's new paste progress line follows the
  same observer pattern (`paste-pump.onProgress(fn)` registered once
  in main.js).

### Integration Points

- `www/main.js` — **first line** change: `if (typeof navigator.serial
  === 'undefined') { renderPoliteFail(); return; }` before any
  `init()` or `new Terminal(...)` call. Requires importing
  `renderPoliteFail` from `./transport/serial.js` eagerly.
- `www/main.js` — new `import { wireSerial } from './transport/serial.js'`
  and `import { wireSerial } from './input/paste-pump.js'` (or
  `enqueuePaste` direct); call `wireSerial({ term, wasm, sampleBell,
  drainHostReply, requestFrame, ... })` after `wireKeyboard(...)`.
- `www/input/tx-sink.js:25` (`pushTxBytes`) — modified to also call
  `writer.write(bytes)` when a writer is registered (`serial.js`
  registers the writer via a setter exposed by tx-sink, analogous to
  `registerTxObserver`).
- `www/input/keyboard.js` Esc-keydown branch — add
  `if (pastePump.isActive()) { pastePump.cancelPaste(); return; }`
  before the normal 0x1B encode path (D-18).
- `www/index.html` — add top-bar `#connect-button`, new
  `<details id="connection">` pane between `#top-bar` and
  `#terminal-wrapper`, new Debug-pane `<button id="paste-test">`.
- `www/renderer/chrome.js` visibilitychange listener — extend with
  `if (!document.hidden) requestFrame();` (D-39).
- `www/tests/transport/` — new Playwright suite with shared mock in
  `www/tests/transport/mock-serial.js` (or wherever Phase 4
  conventions put shared harness code).
- **Phase 6 contract:** Phase 5's `connectMicroBeast()` / `disconnect()`
  + VID/PID localStorage stub is the hook Phase 6 PREF-01 builds on
  for full serial-config persistence.

</code_context>

<specifics>
## Specific Ideas

- The stateful single button is the daily-driver ergonomics anchor:
  one glance at the top-bar tells you whether the MicroBeast is on
  the line, and the button itself is the one-click recovery path.
  Colored dots and separate connection panels feel like "setup UI"
  rather than "present-moment terminal state".
- Border-color-as-state-indicator reuses existing `--chrome-border`
  token plumbing — no new DOM, no new widget, and the color cycle
  (gray → amber → green → red) is readable in both CRT and clean
  themes because it sits on the button chrome, not inside the
  phosphor palette.
- Paste progress + cancel in the Connection pane (not a toast,
  not the top-bar) because paste is an operation with a duration —
  the user is likely looking at the thing they just pasted, which
  is near the canvas; the pane expanding while paste is in flight
  is an acceptable minor distraction because it's paired with the
  act the user just took.
- Silent auto-reconnect matches the "it should feel invisible when
  it works" daily-driver standard. A toast or log line every time
  you wiggle a USB cable would be noise. The state signal is the
  button border; that's enough.
- Polite-fail as full-page takeover avoids the trap of a "demo mode"
  that's half a terminal and half a dead end — users would try to
  debug why Connect is greyed out instead of switching browsers.
  Single clean message + browser list + exit.
- The `Paste test` button in the Debug pane is the Phase 5
  equivalent of Phase 2's SC-4 64 KB Stress button: a self-serve
  verification surface that the pump works even before clipboard
  paste lands in Phase 6. Reuses existing Debug-pane muscle.
- Keypress queue-jumping in the pump is the detail that separates
  "paste works" from "paste doesn't ruin typing" — anyone who has
  used a sluggish terminal where pasting a 100-line file means
  you can't hit Ctrl+C for 20 seconds knows the shape of this bug.

</specifics>

<deferred>
## Deferred Ideas

- **`Send Break` button** — v2-XPORT-01. Some MicroBeast workflows
  need BREAK to interrupt the Z80; add the button via
  `port.setSignals({break:true})` held ~250ms when a real workload
  surfaces the need.
- **User-configurable DTR/RTS initial-state toggles** — Pitfall #12
  documented this as exposed-in-UI; Phase 5 locks the safe default
  (both false) and defers the UI to a future phase. Add if a
  MicroBeast owner reports DTR-as-reset is their intended workflow.
- **"Forget stored port" UI** — Phase 6 PREF-01 will expose full
  serial-config management including clearing the stored VID/PID
  pair.
- **Auto-connect-on-load preference** — Phase 6 PREF-01 exposes an
  "Auto-connect" toggle. Phase 5 ships the plumbing (restored port
  stash on boot) but intentionally keeps open-on-click explicit.
- **Full serial-config persistence** — Phase 6 PREF-01 stores the
  last-used baud / data bits / stop bits / parity / flow-control
  set. Phase 5 only persists the VID/PID identity pair.
- **`BroadcastChannel` cross-tab coordination** — out of scope;
  the "Port in use by another tab" message is good enough.
- **BYOB reader buffer tuning** — revisit only if hardware UAT
  shows GC churn from small platform chunks.
- **Paste pacer user tuning UI (chunk/delay sliders)** — compiled-in
  in v1; expose if a user surfaces a real MicroBeast that needs
  different numbers.
- **Large-paste confirmation prompt (threshold-based)** — chose
  "start immediately with progress + cancel" instead; revisit if
  users accidentally-paste multi-MB content regularly.
- **Toast/banner notification primitive** — not introduced in
  Phase 5 (error log inline in Connection pane suffices). Phase 6
  polish may introduce if needed.
- **"Why Chromium-only?" explainer on polite-fail page** — a link
  to a short blog post or `docs/` page explaining the Web Serial
  story. Nice but not required for v1.
- **Connection quality indicator (bytes/sec, last-packet age)** —
  polish for a future phase; overkill for a single-MicroBeast
  daily driver.
- **Audible "port lost" chime** — out of scope; the red border is
  sufficient signal.
- **Permissions-Policy header when self-hosting** (Pitfall
  documented in Security Mistakes) — a deployment/headers concern
  for Phase 6 PLAT-03 (static deploy) to handle in the hosting
  config, not in app code.

</deferred>

---

*Phase: 05-web-serial-transport*
*Context gathered: 2026-04-23*
