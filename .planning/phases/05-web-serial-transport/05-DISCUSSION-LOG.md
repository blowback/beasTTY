# Phase 5: Web Serial Transport - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 05-web-serial-transport
**Areas discussed:** Connection chrome, Paste throttling, Auto-reconnect & error UX, Polite fail + read loop

---

## Connection chrome

### Q: How should Connect/Disconnect surface in the UI?

| Option | Description | Selected |
|--------|-------------|----------|
| Single stateful button in top-bar (Recommended) | One button in `#top-bar` whose label changes: 'Connect' → 'Connecting…' → 'Disconnect' → 'Reconnecting…'. Matches SC-2 literal wording. Keeps one-click daily-driver posture. | ✓ |
| Button + adjacent colored status dot | Button as above, plus a 12px circle next to it showing connection state (gray=disconnected, amber=connecting, green=connected, red=port-lost). Makes state unambiguous at a glance. | |
| Button in top-bar, status indicator elsewhere | Connect button in top-bar, status indicator (dot + text) in a new Connection pane or status line below the canvas. Separates action from state. | |

**User's choice:** Single stateful button in top-bar.

### Q: Where does the serial-config UI live?

| Option | Description | Selected |
|--------|-------------|----------|
| New `<details id='connection'>` pane (Recommended) | A new collapsible pane above or beside Settings. Holds port picker button, connect button (or just status), full serial config, MicroBeast preset reset button. Connection concerns live in one place; default-collapsed for daily-driver cleanliness. | ✓ |
| Extend Settings pane | Add a `<fieldset>` for serial config inside the existing Settings pane. Keeps the chrome count down but mixes keyboard concerns with transport concerns. | |
| Top-bar inline for MicroBeast preset, advanced config in details | Baud/preset visible in top-bar; rarely-changed knobs hidden behind an 'Advanced' `<details>`. | |

**User's choice:** New `<details id='connection'>` pane.

### Q: Which serial-config knobs ship in Phase 5 v1?

| Option | Description | Selected |
|--------|-------------|----------|
| Baud + data bits + stop bits + parity + flow control (Recommended — XPORT-05) | The five fields XPORT-05 names. MicroBeast preset fills them as 19200 / 8 / 1 / none / none. User can override any. | ✓ |
| DTR and RTS initial-state toggles | Per Pitfall #12. Default both false on open. Exposed as two checkboxes so users whose MicroBeast uses DTR/RTS for reset can configure it. | |
| 'Send Break' button | v2-XPORT-01 is the deferred bucket, but some MicroBeast workflows need BREAK. Adding a button calling `port.setSignals({break: true})` for ~250ms is ~10 lines. Defer to v2 unless you want it now. | |
| 'Reset to MicroBeast preset' button | Single button restores 19200 8N1 no-flow, DTR=false, RTS=false. Makes recovery from config-fiddling trivial — aligns with PLAT-05 'one click to connect'. | ✓ |

**User's choice (multi):** Baud/data/stop/parity/flow-control + Reset to MicroBeast preset. NOT DTR/RTS toggles; NOT Send Break.

### Q: What does the port-picker flow look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Click Connect → native Chromium picker → chosen port stored (Recommended) | Pressing Connect (first time) calls `navigator.serial.requestPort()` with the MicroBeast VID/PID filter to narrow the picker list. Port is remembered via `getPorts()` for future reloads. No in-app port list. | ✓ |
| Separate 'Choose port…' button + 'Connect' button | Choose-port opens the Chromium picker; Connect opens the already-picked port. Two clicks instead of one on first-time setup. | |
| In-app port list populated from `getPorts()` | Show all previously-granted ports in a dropdown; 'Add port…' at the bottom triggers `requestPort()`. More complex, more power. | |

**User's choice:** Click Connect → native Chromium picker → chosen port stored.

### Q: Since you picked single-button (no separate dot), how should color appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Button border color changes (Recommended) | Button border: gray (disconnected) / amber (connecting/reconnecting) / green (connected) / red (port-lost). Label changes in parallel. No new DOM. | ✓ |
| Button background tint | Subtle background tint of button changes per state. More visible; may fight CRT/clean palettes. | |
| Add a small dot INSIDE the button label | Label becomes '● Connect' etc. with the ● colored per state. | |

**User's choice:** Button border color changes.

### Q: What does the button show when the USB cable is yanked mid-session?

| Option | Description | Selected |
|--------|-------------|----------|
| Label → 'Reconnect', border red, auto-retry in background (Recommended) | Label reads 'Reconnect' with red border. The auto-reconnect path runs silently via the connect event; if that fires and succeeds, state flips back to green/Disconnect. Click Reconnect is a user-forced `requestPort()` fallback. | ✓ |
| Label → 'Port lost — click to reconnect' | More explicit label. Longer text may push other top-bar chrome around. | |
| Button disabled + status text below it | Button disables; separate status line under the top-bar says 'Port lost. Reconnect a MicroBeast to resume.' Requires new DOM. | |

**User's choice:** Label 'Reconnect', red border, silent auto-retry.

---

## Paste throttling

### Q: At 19200 baud, what line-rate target should the pacer aim for?

| Option | Description | Selected |
|--------|-------------|----------|
| ~90% of line rate (Recommended) | Target ~1728 bytes/sec. Safe margin for OS jitter, USB scheduling, and occasional bursty keypresses landing alongside paste data. | ✓ |
| 100% of line rate | Target 1920 bytes/sec. Any jitter risks MicroBeast's receive ring overflowing (no flow control). | |
| ~50% of line rate | Very conservative; pastes feel slower. | |

**User's choice:** ~90% of line rate.

### Q: What chunk/delay strategy?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed chunk + setTimeout gap (Recommended) | E.g. write 32 bytes, wait 18ms, repeat. Simple, predictable, easy to verify with timing tests. | ✓ |
| Byte-at-a-time with per-byte delay | One byte per setTimeout(0.52ms). Browser timer clamps likely defeat pacing on background tabs. | |
| `writer.write()` with await + drain backpressure | Relies on Web Serial backpressure; Chromium may buffer internally, defeating throttle at the device. | |

**User's choice:** Fixed chunk + setTimeout gap.

### Q: What's the UX for a large paste?

| Option | Description | Selected |
|--------|-------------|----------|
| No threshold — start sending immediately, show 'Pasting… N%' inline (Recommended) | Any paste starts the pump immediately. A progress line appears ('Pasting 5120 B — 43%') near the Connect button. A Cancel affordance stops the pump. | ✓ |
| Confirmation prompt above a threshold | Pastes > 1 KB show 'Paste 5120 B? That will take ~3 s.' OK/Cancel dialog before starting. | |
| Silent — no progress, no cancel, no dialog | Simplest, but a 50 KB paste locks out input for 30s with no feedback. | |

**User's choice:** No threshold, inline progress.

### Q: Where does the throttling logic live?

| Option | Description | Selected |
|--------|-------------|----------|
| New `paste-pump.js` module that feeds tx-sink (Recommended) | `www/input/paste-pump.js` owns the queue + timer. `tx-sink.pushTxBytes` stays synchronous for single keypresses; the pump enqueues paste bytes and drains them in chunks via `pushTxBytes`. | ✓ |
| Inside `tx-sink.js`, make `pushTxBytes` async-paced | Turn `pushTxBytes` into an async fn that auto-throttles. Simpler API surface; couples keypress TX to the pump's event loop. | |
| Inside the transport module (serial.js) | Transport handles throttling internally via `writer.write()` buffering. | |

**User's choice:** New `paste-pump.js` module feeding tx-sink.

### Q: What sources of TX bytes go through the pump?

| Option | Description | Selected |
|--------|-------------|----------|
| Only actual paste events (Recommended) | Clipboard paste (Phase 6 SESS-03 will hook this). Single keypresses still go through tx-sink → writer directly. Phase 5 ships the pump + TX-path split; clipboard paste wiring is Phase 6. | ✓ |
| All TX goes through the pump | Every `writer.write()` call is queued. Uniform behavior but adds latency to every keystroke. | |
| Paste + any write > 16 bytes | Heuristic: threshold split. Single-byte keypresses bypass. | |

**User's choice:** Only actual paste events.

### Q: Where does the 'Pasting… N%' indicator live?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in Connection pane (Recommended) | Text + progress appears inside the `<details id='connection'>` pane. Expands pane open while pasting if collapsed. Cancel button next to it. | ✓ |
| Top-bar status line (right-aligned) | Small text right of the phosphor buttons. Fights for horizontal space. | |
| Transient toast/banner near canvas | Most visible but introduces a new UI primitive the codebase doesn't have. | |

**User's choice:** Inline in Connection pane.

### Q: How does cancel work?

| Option | Description | Selected |
|--------|-------------|----------|
| Cancel button + Esc key (Recommended) | Small 'Cancel' button next to progress indicator; pressing Esc while pump active also cancels. Esc is otherwise a normal VT52 key; while pump is active Esc gets intercepted. | ✓ |
| Cancel button only | No keyboard shortcut. Users must click cancel. | |
| No cancel — paste runs to completion | Start simple; add cancel later if huge pastes turn out problematic. | |

**User's choice:** Cancel button + Esc key.

### Q: If the port disconnects mid-paste, what happens to queued bytes?

| Option | Description | Selected |
|--------|-------------|----------|
| Drop queued bytes; pump halts (Recommended) | On disconnect, pump clears its queue and cancels the timer. Progress shows 'Paste cancelled — port lost'. Resume requires a fresh paste after reconnect. | ✓ |
| Preserve queue across reconnect | Queued bytes survive disconnect; when auto-reconnect succeeds, pump resumes. Risk: bytes intended for session A end up in session B. | |
| Preserve queue, but prompt before resuming | 'Paste was interrupted with N bytes remaining. Resume?' dialog on reconnect. | |

**User's choice:** Drop queued bytes; pump halts.

### Q: Phase 6 wires clipboard. How does Phase 5 prove the pump works?

| Option | Description | Selected |
|--------|-------------|----------|
| Debug-pane 'Paste test' button that feeds synthetic bytes (Recommended) | A new button in Debug pane takes the textarea's bytes and routes them through the pump to the writer. Verifiable at 19200 against a real MicroBeast or a Playwright mock. | ✓ |
| Expose pump API on window for Playwright only | `window.__pastePump(bytes)` callable from Playwright. No user-visible surface. | |
| Wire existing Debug textarea's Feed button to route through pump when connected | Conditional behavior risks confusion. | |

**User's choice:** Debug-pane 'Paste test' button.

### Q: If the user types a key while a paste is in flight, what happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Keypresses queue-jump the pump (Recommended) | Pump writes chunk → flush any pending single-key bytes → next chunk. Keeps keyboard feel responsive. | ✓ |
| Keypresses also go through the pump queue | Uniform rate limiting. A keypress during a 5KB paste may wait seconds. | |
| Keypresses ignored while paste runs | Simplest but surprising — user taps Esc expecting to cancel, nothing happens. | |

**User's choice:** Keypresses queue-jump.

### Q: Esc is a valid VT52 key in daily-driver use. How does 'Esc cancels paste' coexist with 'Esc goes to MicroBeast'?

| Option | Description | Selected |
|--------|-------------|----------|
| Esc cancels ONLY while pump is active (Recommended) | Pump sets a flag while running. Keyboard handler checks the flag: flag set → Esc cancels pump (does NOT transmit); flag clear → Esc encodes as normal (0x1B sent). Transparent state. | ✓ |
| Esc always sends 0x1B; Cancel button only | Esc never cancels paste — cancel is mouse-only. Preserves Phase 4 Esc semantics perfectly. | |
| Double-Esc cancels | First Esc to host, second cancels. Complex; timing-sensitive. | |

**User's choice:** Esc cancels only while pump is active (flag-gated).

### Q: Should the pacer's chunk size and delay be user-configurable, or compiled-in constants?

| Option | Description | Selected |
|--------|-------------|----------|
| Compiled-in constants (Recommended) | Constants in `paste-pump.js` derived from 'target 90% of configured baud'. When baud changes, pump recomputes. No UI. | ✓ |
| Expose pacer under Connection > Advanced | Two fields: 'Paste chunk (bytes)' and 'Paste gap (ms)'. Power users can tune. | |
| Single 'paste speed' slider (Slow/Normal/Fast) | Slow=50%, Normal=90%, Fast=100% of baud. One knob, three presets. | |

**User's choice:** Compiled-in constants.

### Q: If local-echo is ON while pasting, what renders?

| Option | Description | Selected |
|--------|-------------|----------|
| Echo each chunk as it's sent, paced with the pump (Recommended) | Local echo mirrors what's on the wire. If user has echo ON, terminal fills at 19200 baud visually — matches the MicroBeast's own echo behavior. Single call site: pump writes chunk → if echo on, term.feed(chunk). | ✓ |
| Echo the full paste immediately, pace only the wire | Canvas shows all bytes instantly; wire sees them slowly. Visual gets ahead of host. | |
| Suppress local echo during paste | No echo while pump runs, even if toggle is on. | |

**User's choice:** Echo each chunk as sent, paced with pump.

### Q: Does paste traffic go through the Phase 4 tx-sink?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — pump → tx-sink → writer (Recommended) | Every chunk the pump sends calls `pushTxBytes(chunk)`, then `writer.write(chunk)`. Debug pane's hex strip shows paste bytes streaming past — same observability Phase 4 established. | ✓ |
| Pump bypasses tx-sink, writes directly | Debug hex strip shows only keypress bytes; paste bytes skip the ring. | |
| Pump calls tx-sink, but tx-sink's ring has a 'paste suppress' mode | Complexity without clear benefit. | |

**User's choice:** Yes — pump → tx-sink → writer.

### Q: Does the Phase 4 CR/LF override apply to pasted text?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — same post-encode rewrite runs on paste bytes (Recommended) | If CR/LF mode is 'lf', every 0x0D in the paste becomes 0x0A. Consistent TX-side normalization. Rewrite happens BEFORE bytes enter the pump queue. | ✓ |
| No — paste bytes go through as-is | Paste is 'give me exactly what I sent'. But then Phase 4 override only affects typed Enter, which is inconsistent. | |

**User's choice:** Yes — rewrite applies to paste.

### Q: How often does the 'Pasting… N%' indicator refresh?

| Option | Description | Selected |
|--------|-------------|----------|
| On every chunk write (Recommended) | At 32 bytes/18 ms, progress updates ~55 Hz. DOM textContent write. | ✓ |
| On rAF (throttled to display refresh) | Smoother but couples pump to render. | |
| Every 100ms via setInterval | Fewer updates; progress feels jumpy for small pastes. | |

**User's choice:** On every chunk write.

---

## Auto-reconnect & error UX

### Q: When the MicroBeast is replugged and VID/PID matches, how visible should the reconnect be?

| Option | Description | Selected |
|--------|-------------|----------|
| Silent — border flips red → amber → green, no text (Recommended) | Auto-reconnect just happens. Label cycles Reconnect → Reconnecting… → Disconnect. No log line, no toast. | ✓ |
| Silent + a one-line log in Connection pane | As above, plus 'Reconnected @ 10:42:15' in a small log. | |
| Brief toast banner | 'MicroBeast reconnected' banner near canvas for ~2s. New UI primitive. | |

**User's choice:** Silent — border flips only.

### Q: If the stored VID/PID matches more than one connected port, what happens on auto-reconnect?

| Option | Description | Selected |
|--------|-------------|----------|
| Pick the one matching full `getInfo()` (Recommended) | Match on `usbVendorId` + `usbProductId` first; if >1 match, require EXACT SerialPort identity match against the stored reference. Otherwise fall through to prompt. | ✓ |
| Refuse to auto-reconnect when ambiguous; prompt user | Border stays red, label 'Choose MicroBeast…', clicking opens `requestPort()` filtered to that VID/PID. | |
| Pick the first match silently | Simple but risks connecting to wrong device. | |

**User's choice:** Pick the one matching full `getInfo()`.

### Q: How does the 'port lost' state surface beyond the button?

| Option | Description | Selected |
|--------|-------------|----------|
| Button only — red border + 'Reconnect' label (Recommended) | Phase 5 chrome stays minimal. Auto-reconnect retries silently. Matches one-stateful-button choice. | ✓ |
| Button + inline status text in Connection pane | 'Port lost at 10:42. Waiting for device…'. Useful for debugging intermittent USB issues. | |
| Button + audible bell on port-lost | Visible-bell flash on disconnect. Reuses Phase 3 bell pipeline. | |

**User's choice:** Button only.

### Q: Where do real errors show up?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline status line inside Connection pane + `console.error` (Recommended) | Errors append to a small error region in Connection pane (last 5 messages, timestamped). Pane auto-expands on new error. | ✓ |
| `console.error` only — no in-app surface | Developers open DevTools. Opaque to daily-driver user. | |
| Toast notifications for errors | New UI primitive; risk of toast spam. | |

**User's choice:** Inline + `console.error`.

### Q: On page reload with a previously-granted port, what happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Restore port via `getPorts()`, but DON'T auto-open (Recommended) | Boot scans `getPorts()`, matches stored VID/PID, stashes the SerialPort object. Button label shows 'Connect' (gray border) — user clicks to open. | ✓ |
| Restore AND auto-open on boot | Boot → `getPorts()` → match → open immediately → green. Fast daily-driver but spurious port-lost if MicroBeast isn't powered. | |
| Restore AND auto-open, but only if user preference says so | Phase 6 PREF-01 adds an 'Auto-connect' toggle; Phase 5 ships plumbing. | |

**User's choice:** Restore but don't auto-open.

### Q: When auto-reconnect fails (device appears but open() throws), what's the retry cadence?

| Option | Description | Selected |
|--------|-------------|----------|
| Single silent retry, then surface failure (Recommended) | One quiet retry 500ms after the `connect` event. If that fails, border stays red + inline error shows the message. | ✓ |
| Exponential backoff: 500ms, 1s, 2s, 5s, then stop | Handles transient USB enumeration delays gracefully. More complex. | |
| No silent retry — first failure is the failure | Simplest; user drives recovery. | |

**User's choice:** Single silent retry, then surface.

### Q: What if the user has BestialiTTY open in two tabs?

| Option | Description | Selected |
|--------|-------------|----------|
| Whichever tab clicks Connect wins; other tab shows 'Port in use' | Second tab's `open()` throws with 'Port in use'. Surface in error region. Acceptable — Chrome enforces this. | ✓ |
| Document it in the browser-reserved note, no explicit handling (Recommended) | Add a line to the Connection pane help. Don't code special UX. | |
| Use `BroadcastChannel` to coordinate ownership across tabs | Tabs elect one owner; others show 'Connected in another tab'. Elegant but complex. | |

**User's choice:** Whichever tab clicks Connect wins (no coordination, document in help).

### Q: How many error messages does the inline log hold?

| Option | Description | Selected |
|--------|-------------|----------|
| Last 5, newest at top, oldest drops off (Recommended) | Fixed ring. Enough to see a pattern in intermittent issues without the pane ballooning. | ✓ |
| Last 20 | More audit trail. Pane grows tall. | |
| Unbounded, scrollable | Full history in-session. | |

**User's choice:** Last 5, newest at top.

### Q: Where do the connect/disconnect event listeners live?

| Option | Description | Selected |
|--------|-------------|----------|
| `navigator.serial` level (Recommended) | Per Pitfall #11: listen on `navigator.serial` too (catches cases where the instance is swapped). Single pair of listeners wired once at boot. | ✓ |
| On the current SerialPort instance only | Simpler but misses swaps per Pitfall #11. | |
| Both | Belt-and-braces. Risk of double-handling. | |

**User's choice:** `navigator.serial` level.

### Q: User revokes serial permission via `chrome://settings` mid-session. What happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as port-lost + surface error (Recommended) | `disconnect` event fires or read/write throws `NetworkError`. Border goes red; error log shows 'Permission revoked — reconnect to re-authorize'. | ✓ |
| Silent degrade to disconnected | Border gray, label 'Connect'. User has to figure out why reconnecting doesn't work. | |
| Detect via Permissions API and show explicit banner | Heavier; Permissions API for serial isn't widely supported. | |

**User's choice:** Treat as port-lost + surface error.

### Q: If another tab opens the same port AFTER this tab is connected, what happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as disconnect, surface error, attempt reconnect (Recommended) | `read()` and `write()` error out. Treat like port-lost. Error message surfaces 'Port in use by another tab'. | ✓ |
| No special handling — inherit the port-lost flow | Just let the error surface as generic port-lost. | |
| Release port on `visibilitychange=hidden` to avoid conflict | Would hurt background data capture (Pitfall #6). | |

**User's choice:** Treat as disconnect + surface error + attempt reconnect.

### Q: On tab close (`beforeunload`), should the port be explicitly closed?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — best-effort `await reader.cancel() + port.close()` (Recommended) | Pitfall #12 note + Pitfall #1 reader-lock hygiene. Even partial execution helps. | |
| Yes, but also de-assert DTR/RTS first | Per Pitfall #12: explicitly de-assert DTR/RTS before close. Makes MicroBeast state predictable. | ✓ |
| No — let the browser handle it | Browser tears down resources on tab close. Relies on OS-level cleanup. | |

**User's choice:** Yes, de-assert DTR/RTS first, then cancel + close.

### Q: How is the VID/PID identity persisted for reconnect matching?

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage at Phase 5 (no UI) — Phase 6 adds visibility (Recommended) | `serial.js` writes `{usbVendorId, usbProductId}` to localStorage under 'bestialitty.port.preset'. Phase 6 PREF-01 extends. No UI for managing it in Phase 5. | ✓ |
| In-memory only — re-prompt picker on every reload | No persistence. `getPorts()` returns already-granted ports but we don't know WHICH was 'ours'. | |
| localStorage + visible 'Forget this port' button in Connection pane | Adds a button. Scope-adjacent to Phase 6 PREF-01. | |

**User's choice:** localStorage at Phase 5 (no UI).

### Q: When does DTR/RTS get de-asserted to false/false?

| Option | Description | Selected |
|--------|-------------|----------|
| On open AND before every close (Recommended) | `setSignals({dataTerminalReady: false, requestToSend: false})` immediately after `open()` (Pitfall #12 safe default), and again before `reader.cancel() + port.close()` on any disconnect path. Maximum predictability. | ✓ |
| On open only; rely on close to reset signals | Simpler code path. Browser/OS behavior on close is unspecified. | |
| On open only; never explicit close-time de-assert | Whatever the adapter defaults to, we don't fight. | |

**User's choice:** On open AND before every close.

---

## Polite fail + read loop

### Q: How do we detect non-Chromium browsers without Web Serial?

| Option | Description | Selected |
|--------|-------------|----------|
| Feature-detect `navigator.serial` (Recommended) | `typeof navigator.serial === 'undefined'` → polite fail. Forward-compatible. Matches MDN guidance. Zero UA sniffing. | ✓ |
| Feature-detect + UA sniff Chromium explicitly | Belt-and-braces for weird embedded browsers. | |
| UA sniff only | Fragile, goes stale. | |

**User's choice:** Feature-detect `navigator.serial`.

### Q: What does the polite-fail UI look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Full-page takeover, replaces entire app (Recommended) | Boot checks; if no `navigator.serial`, replace body content with 'BestialiTTY requires a Chromium-based browser' page + browser list. Don't boot wasm/canvas. | ✓ |
| Banner at top; app still loads (read-only) | Banner says 'Web Serial unavailable — demo mode'. Canvas renders, Feed button still works. | |
| Single full-page warning, no app underneath, no browser links | Minimal: 'Use a Chromium-based browser.' Abrupt. | |

**User's choice:** Full-page takeover.

### Q: Where does the read loop live, and what shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Pure async in `serial.js`, feed→bell→drain→requestFrame per chunk (Recommended) | Standard pattern from Phase 3 / Pitfall #6. Decoupled from rAF. `sampleBell()` mirrors Phase 3 post-feed invariant. | ✓ |
| Read loop pushes into wasm ring buffer, renderer drains in rAF | Per Pitfall #6 'reader pushes, renderer drains'. More complex — requires new wasm boundary. Phase 2/3 existing pipeline already handles bulk feed well. | |
| Pure async, synchronous `term.feed()` per chunk, NO `requestFrame()` | The dirty-rows renderer picks up on its own rAF tick. May introduce a frame of latency. | |

**User's choice:** Pure async feed→bell→drain→requestFrame.

### Q: When `reader.read()` throws, how does the loop handle it?

| Option | Description | Selected |
|--------|-------------|----------|
| Log + treat as disconnect, trigger port-lost flow (Recommended) | catch → error log + `console.error` → disconnect path (cancel + close + red border + 'Reconnect'). Relies on `connect` event to re-arm. | ✓ |
| Log + retry `read()` in-loop (don't exit) | Handle transient errors. Risk: permanent errors become infinite spin. | |
| Exit loop silently on any error | Simplest. State machine doesn't know why reads stopped. | |

**User's choice:** Log + treat as disconnect.

### Q: On `visibilitychange=visible`, should we trigger a catch-up render?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — `requestFrame()` on `visibilitychange=visible` (Recommended) | Phase 3's `chrome.js` already listens. Extend: when document becomes visible, `requestFrame()` so accumulated bytes paint immediately. | ✓ |
| No — rely on next rAF tick | First post-visibility paint catches up. Slight delay. | |
| Trigger `rebuildViews + requestFrame` | Paranoid path. Phase 2/3 already handles buffer-identity check. | |

**User's choice:** Yes — `requestFrame()` on visible.

### Q: Do we pass a size hint to `reader.read()`?

| Option | Description | Selected |
|--------|-------------|----------|
| Let the platform choose (Recommended) | `await reader.read()` with no args. Chromium returns whatever OS delivered. `term.feed()` handles any size. | ✓ |
| Provide buffer size hint (e.g. 4096) | Uses BYOB reader. Predictable chunk sizes; slightly lower GC churn. More ceremony. | |

**User's choice:** Let platform choose.

### Q: How does the read loop know to exit?

| Option | Description | Selected |
|--------|-------------|----------|
| `reader.cancel()` causes `read()` to resolve with `done=true` (Recommended) | Single exit path per Pitfall #1. Disconnect handler calls `reader.cancel()` — loop's await returns `{done:true}` and falls out naturally. | ✓ |
| Shared 'cancelled' flag + `reader.cancel()` | Flag + cancel. Defensive; Pitfall #1 says cancel() is sufficient. | |

**User's choice:** `reader.cancel()` only.

### Q: What's the module structure for the transport layer?

| Option | Description | Selected |
|--------|-------------|----------|
| `www/transport/serial.js` single module (Recommended) | One module owns: port grant, open/close, read loop, writer, DTR/RTS, reconnect state machine, VID/PID persistence, polite-fail detection. Exports `connectMicroBeast` / `disconnect` / `getState` / `onStateChange`. Mirrors Phase 3 `www/renderer/` and Phase 4 `www/input/` conventions. | ✓ |
| Split: `transport/serial.js` + `transport/reconnect.js` + `transport/polite-fail.js` | Smaller files. More inter-module coordination. | |
| `www/serial/` directory with `port.js`, `read-loop.js`, `reconnect.js`, `paste-pump.js` | Full decomposition. | |

**User's choice:** Single `www/transport/serial.js` module.

### Q: What's the test strategy for Phase 5?

| Option | Description | Selected |
|--------|-------------|----------|
| Playwright mocks `navigator.serial` + hardware UAT checkpoint (Recommended) | Playwright specs mock `navigator.serial` (stub `Serial`, `SerialPort`, `ReadableStream`, `WritableStream`) to exercise state machine logic. Human UAT document (05-HUMAN-UAT.md) covers real-hardware workflows. Matches Phase 4 precedent. | ✓ |
| Unit tests for state machine only + manual UAT everything else | Extract reconnect logic into a pure JS state machine module, unit test that. | |
| Playwright launches with Chromium flags exposing Web Serial + loopback adapter | Use `--enable-features=SerialApi` and a null-modem loopback. Realistic but requires special CI setup. | |

**User's choice:** Playwright mocks + hardware UAT.

### Q: How do we verify the paste-pump's rate limiting in tests?

| Option | Description | Selected |
|--------|-------------|----------|
| Mock writer records timestamps; assert inter-chunk delay >= target (Recommended) | Mock writer records `{bytes, ts}`. Test feeds a 1 KB paste, asserts total timing with tolerance. Tolerates system jitter. | ✓ |
| Mock `performance.now` + fake timers to assert exact timings | Deterministic but tightly couples test to pump internals. | |
| Skip rate test in CI, verify on hardware UAT | Too flaky to assert timing in headless Chromium. | |

**User's choice:** Mock writer records timestamps.

### Q: How do we simulate unplug/replug in Playwright?

| Option | Description | Selected |
|--------|-------------|----------|
| Mock `navigator.serial` dispatches `disconnect/connect` events on demand (Recommended) | Test helper: `window.__simulateUnplug()` fires `disconnect`; `window.__simulateReplug()` fires `connect` with the same mock port. | ✓ |
| Hardware-only (no automated unplug simulation) | Human UAT physically unplugs. Works but slow; not regression-guarded. | |

**User's choice:** Mock dispatches events via `window.__simulate*`.

---

## Claude's Discretion

- Exact top-bar layout when the Connect button is added (position relative to theme-toggle and phosphor group).
- Exact CSS of the Connection pane (mirror Settings pane unless reason otherwise).
- Exact string copy for polite-fail page and inline error log.
- Exact DOM order inside Connection pane.
- Whether to show matched VID:PID label in Connection pane.
- Minimum Chromium version to document (floor: Chromium 89 from Phase 2).
- Playwright mock file organization.
- Chunk-size tuning if hardware UAT disagrees with compiled-in 32B/18ms.
- Whether `enqueuePaste` accepts Uint8Array only or also string.

## Deferred Ideas

- Send Break button (v2-XPORT-01)
- DTR/RTS user-configurable UI (deferred — safe defaults locked)
- Port-forgetting UI (Phase 6 PREF-01)
- Full serial-config persistence (Phase 6 PREF-01)
- Auto-connect-on-load preference (Phase 6 PREF-01)
- BroadcastChannel cross-tab coordination (document in help instead)
- BYOB reader buffer tuning (only if UAT shows GC churn)
- Paste pacer user tuning UI (compiled-in for v1)
- Large-paste confirmation prompt (using progress + cancel instead)
- Toast/banner notification primitive (inline error log suffices)
- "Why Chromium-only?" explainer page
- Connection quality indicator (bytes/sec)
- Audible port-lost chime
- Permissions-Policy header (deployment concern, Phase 6 PLAT-03)
