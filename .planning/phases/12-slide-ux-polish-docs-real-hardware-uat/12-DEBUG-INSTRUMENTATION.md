---
phase: 12-slide-ux-polish-docs-real-hardware-uat
type: debug-instrumentation
status: pending-capture
added: 2026-05-09
related_gap: send-path-failure-cluster (Test 4 in 12-HUMAN-UAT.md)
debug_session: .planning/debug/12-send-path-failure-cluster.md
---

# Phase 12 — SLIDE Send-Path Diagnostic Instrumentation

This is a **temporary** instrumentation pass added to disambiguate the three send-path symptoms (auto-type miss on drop, hang after Retry, UI wedge with non-functional Disconnect). It will be removed once the gap-closure plans land.

## What was added

Two `*Dbg` helpers, one in `www/transport/slide.js` (`slideDbg`) and one in `www/transport/serial.js` (`serialDbg`). Both gate on the same opt-in flag and emit `[slide-debug]` / `[serial-debug]` prefixed `console.log` lines.

**Probe coverage:**

| Probe | Tag | What it tells us |
|---|---|---|
| `slide.js` `enterSendMode` entry | `enterSendMode:enter` | Which prefs the dispatcher sees at the moment of the drop — including `slideAutoSendCommand`, `slideAutoSendCommandConfirmed`, and `slideCompatibilityMode`. Disambiguates Symptom A's stale-prefsRef hypothesis. |
| `shouldSurfaceFirstUseConfirm` | `shouldSurfaceFirstUseConfirm` | Whether the first-use chip will surface, and *why* — the boot-time vs current value mismatch lights up here. |
| `surfaceFirstUseConfirm` | `surfaceFirstUseConfirm:enter` / `:awaiting-user-click` / `:onConfirm-fired` / `:onReset-fired` / `:fail-open-no-chip` | Whether the chip actually fired and which callback won. |
| `enterSendModeAfterFirstUseConfirm` | `:enter` / `:awaited` | Whether the awaited Promise resolved at all and to which value. |
| `readAutoSendCommandBytes` | `:enter` / `:produced` / `:UNSAFE-rejected` / `:empty-disables` | Source of `cmd`, hex of resulting bytes, safety-gate verdict. |
| `enterSendModeProceed` | `:enter` / `:metadata-packed` / `:autoSendBytes` / `:pushTxBytes-done` / `:auto-type-SKIPPED-empty` / `:pendingSendSession-set` | The synchronous happy-path. The metadata hex (32 bytes) is logged so we can cross-check the layout against the patched `slide.com` Z80-side parser. |
| `enterSendModeInternal` | `:enter` / `:slide-constructed` / `:mode=send,owner=slide` | Wakeup-completion handoff. Confirms the mode flip happened. |
| `dispatchTerminalMode` wakeup match | `dispatchTerminalMode:wakeup-match` | Confirms the 7-byte ESC^SLIDE wakeup matched and whether `pendingSendSession` was non-null at match time. |
| `handleChipInlineAction` entry | `handleChipInlineAction:enter` | Which inline-action button (`retry` / `cancel` / `force-start`) was clicked. |
| `dispatchSendMode` cycle | `:cycle-begin` / `:after-feed` / `:after-drain1` / `:after-pump` / `:after-drain2` / `:cycle-end` | Per-inbound-chunk lifecycle in send mode. State value at each step disambiguates whether the SM is making progress. |
| `drainEventsAndOutboundAwaitable` | `drainEvents:event` | Every Rust event drained — `EVT_RDY` / `EVT_ACK` / `EVT_NAK` / `EVT_DATA_FRAME` / `EVT_FILE_COMPLETE` / `EVT_SESSION_COMPLETE` / `EVT_RETRANSMIT_NEEDED`. |
| `drainSlideOutboundAwaitable` | `drainOutbound:write-pending` / `:write-resolved` | First 32 bytes (hex) of every frame on the wire + write-resolution. If a write awaits forever, we'll see `:write-pending` without a matching `:write-resolved`. |
| `pumpNextDataChunkIfReady` | `pumpNext:feed` / `pumpNext:skip` (with reason) | Whether the next 1024-byte data chunk got pushed, and if not, why. |
| `maybeExitSendMode` | `maybeExitSendMode` | State + whether exit will fire. |
| `sendDispatchTail` catch | `sendDispatchTail:CAUGHT-error` | Any rejected dispatchSendMode is logged with stack (otherwise it just silently `console.error`s and continues). |
| `serial.js` `disconnect` | `disconnect:enter` / `:awaiting-teardown` / `:teardown-resolved` / `:exit` | Whether the Disconnect button click reaches `disconnect()`, whether `teardown()` resolves, and whether the final state transition happens. |
| `serial.js` `teardown` | `teardown:enter` / `step1-setSignals-pending|done|threw` / `step2-reader-cancel-pending|done|threw` / `step3-writer-releaseLock-pending|done|threw` / `step4-port-close-pending|done|threw` / `step5-pastePumpOnPortLost` / `step5-slidePumpOnPortLost` / `:exit` | Where exactly teardown blocks. If `step4-port-close-pending` appears without `:done` or `:threw`, that's the smoking gun for Symptom C (`port.close()` waiting on a stuck `writer.write` because `writer.releaseLock()` already happened in step 3 but the underlying stream hasn't drained). |

## How to capture the log

1. **Hard reload** the page (Ctrl+Shift+R) so the rebuilt wasm + JS load fresh.
2. **Open DevTools → Console.** Set `localStorage.setItem('beastty.debug.slide', '1')` then **hard reload again** so the gate flips on at module-init time.
3. **Verify it's on:** the very first event after a SLIDE action should print a line like `[slide-debug] enterSendMode:enter ...`.
4. **Reproduce the failing scenario:**
   - Connect to MicroBeast (patched `slide.com`).
   - Drag-drop file(s) onto the terminal — you'll see the log capturing the initial drop.
   - When the `[Retry] [Cancel] [Force start]` chip appears, click `[Retry]`.
   - When the process hangs, click `[Disconnect]` (the unresponsive button).
   - When nothing happens, also click `[Connect]` again or any other UI element to see whether further events flow.
5. **Right-click the console → Save as…** to dump the full log to a text file. Or select all + copy + paste into a file.
6. **Paste the log into the next message.**

## What we'll learn from each symptom

**Symptom A (auto-type miss on drop)** — Look for these in order at the moment of drag-drop:
- `enterSendMode:enter` — what does it report for `prefs_slideAutoSendCommand` and `prefs_slideAutoSendCommandConfirmed`?
  - If `slideAutoSendCommand` is `"B:SLIDE R\\r"` (uppercase, default) instead of `"B:SLIDE r\\r"` (lowercase, what user set in Settings), that's stale-prefsRef confirmed. ✓
  - If `slideAutoSendCommand` is `"B:SLIDE r\\r"` (live value), then prefs are reading correctly and the miss is somewhere else.
- `shouldSurfaceFirstUseConfirm` — does it return `true` or `false`?
  - If `true`: chip should surface; check whether `surfaceFirstUseConfirm:onConfirm-fired` / `onReset-fired` follows. If neither fires before user gives up, it's the WR-02 leak coming back.
  - If `false`: confirmed-already path; auto-type should fire immediately via `readAutoSendCommandBytes:produced`.
- `readAutoSendCommandBytes:produced` hex — the actual bytes that should hit the wire. If `[10B] 42 3a 53 4c 49 44 45 20 72 0d` (= `B:SLIDE r\r`), that's correct.
- `pushTxBytes-done` / `pendingSendSession-set` — the synchronous happy-path landmarks.
- If you see `auto-type-SKIPPED-empty` then `readAutoSendCommandBytes` returned 0 bytes (either empty pref OR safety-rejected — `UNSAFE-rejected` would have logged separately).

**Symptom B (hang after Retry)** — After clicking `[Retry]`, the log should show:
- `handleChipInlineAction:enter action=retry`
- `readAutoSendCommandBytes:produced` for the auto-send re-emission
- Then a wave of `dispatchSendMode:cycle-begin` per inbound chunk from the Z80
- Each cycle should show `drainEvents:event kind=0x0001` (`EVT_RDY`) at minimum, then later `0x0002` (`EVT_ACK`) and `0x0008` (`EVT_FILE_COMPLETE`)
- If `dispatchSendMode:cycle-begin` fires repeatedly but `drainEvents:event` never produces an `ACK`/`FILE_COMPLETE`, the Z80 isn't acking — likely a **metadata layout mismatch** (cross-check the `enterSendModeProceed:metadata-packed` hex against the patched slide.com's expected layout).
- If `drainOutbound:write-pending` appears without a matching `:write-resolved`, the `writer.write` is stuck (kernel buffer full) — kernel-level backpressure cascade.
- If `pumpNext:skip reason="fileFullySent (await ACK)"` keeps firing, the Rust SM is correctly waiting on an ACK that's not arriving — metadata layout suspect or NAK-rewind suspect.

**Symptom C (Disconnect non-functional)** — When you click `[Disconnect]`:
- `disconnect:enter` should appear immediately. **If it doesn't, the click event isn't reaching the handler at all** — that's a totally different bug (button event listener never registered, or DOM is in a state where the click goes to a different target).
- If `disconnect:enter` fires, watch where it stalls:
  - `teardown:step1-setSignals-pending` without `:done`/`:threw`: `setSignals` blocked.
  - `teardown:step2-reader-cancel-pending` without `:done`/`:threw`: `reader.cancel()` blocked (unlikely — cancel is supposed to always resolve).
  - `teardown:step3-writer-releaseLock-*`: this is synchronous — should fire `pending` then immediately `done` or `threw`.
  - `teardown:step4-port-close-pending` without `:done`/`:threw`: **most likely culprit per the diagnosis** — `port.close()` waiting on a kernel write to drain.
- Whichever step lacks its closing `:done`/`:threw` is the exact wedge point.

## After we have the log

Paste it into the conversation. With the trace in hand we'll have ground truth for all three symptoms and can plan the gap-closure fixes precisely (targeted, not speculative).

## Removal

Once the gap-closure plans land and verify, delete:
- `slide.js` lines: `SLIDE_DEBUG` const, `slideDbg`/`slideDbgHex` helpers, every call site (search `slideDbg(`)
- `serial.js` lines: `SERIAL_DEBUG` const, `serialDbg` helper, every call site (search `serialDbg(`)
- This file (`12-DEBUG-INSTRUMENTATION.md`)

Total instrumentation footprint is ~25 sites in slide.js and ~15 in serial.js — all `slideDbg(...)` / `serialDbg(...)` calls, easy to grep + delete.
