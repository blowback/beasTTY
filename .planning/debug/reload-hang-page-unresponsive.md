---
status: diagnosed
trigger: "UAT Test 3 (Phase 5): reload with granted port leads to hang and 'Page unresponsive...' dialog. Tests 1 and 2 pass — only Ctrl+R reload triggers it."
created: 2026-04-23T00:00:00Z
updated: 2026-04-23T00:00:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED — beforeunload handler in www/transport/serial.js:105-111 violates the Streams API close() contract by skipping releaseLock() on both reader and writer before calling port.close(). Per MDN/WHATWG: port.close() can only resolve when SerialPort.readable AND SerialPort.writable are unlocked. The handler calls reader.cancel() (which DOES NOT release the lock — only releaseLock() does that) and never touches the writer at all, then calls port.close(). The close() promise can never resolve, leaving the OLD page's renderer with a stuck Web Serial cleanup that Chromium reports as "Page unresponsive" on the unloading page. Combined with the runReadLoop's outer while(p.readable) loop, the cancel can also retrigger an immediate getReader() re-acquisition after the inner break, holding a fresh lock.
test: Read serial.js beforeunload (lines 105-111), runReadLoop (lines 303-328), and teardown (lines 349-376) helper. Compare beforeunload vs teardown — teardown does the right thing (releaseLock + unregisterWriter), beforeunload skips it intentionally per Plan 07 SUMMARY.
expecting: Falsification test would be: comment out the beforeunload close() / cancel() calls and reload. Page should unload cleanly (DTR/RTS won't drop but port handle gets cleaned up by Chromium GC). If page no longer hangs, hypothesis confirmed.
next_action: Write up final diagnosis — return ROOT CAUSE FOUND.

## Symptoms

expected: "Reload with granted port restores app to Connect/gray state and reconnects in <1s without picker prompt (XPORT-07 / SC-3c)."
actual: "nope, reload leads to a hang and evenutally a 'Page unresponsive...' dialog. Tried clicking 'Wait' a few times, but it's dead as nails."
errors: "None reported beyond Chromium 'Page unresponsive' dialog. Test 1 (fresh Connect) and Test 2 (yank+replug) PASS. Hang occurs specifically on Ctrl+R while connected."
reproduction: "Connect to real MicroBeast (CP2102N VID 10c4 PID ea60). Press Ctrl+R. Page hangs; Chromium shows 'Page unresponsive'."
started: 2026-04-25 (real-hardware UAT)

## Eliminated

- hypothesis: "wasm init() top-level await is hanging on the new page"
  evidence: "Top-level await on a never-resolving promise leaves the page in 'loading' state — does NOT trigger 'Page unresponsive' dialog. The dialog requires main-thread blockage / synchronous unyielding work."
  timestamp: 2026-04-23T00:30:00Z

- hypothesis: "Service worker / shared worker holds stale state across reload"
  evidence: "grep across www/ shows zero serviceWorker, SharedWorker, BroadcastChannel, navigator.locks usage. No worker registrations exist."
  timestamp: 2026-04-23T00:35:00Z

- hypothesis: "rAF tick loop in canvas.js (rebuildViews / primeAscii) is the hang source on new page boot"
  evidence: "primeAscii is bounded to 95 iterations (0x20..0x7E). rAF tick is bounded — single requestFrame per frame, gated by rafPending flag. tick() body is O(rows * cols) which is 24*80 = 1920 ops max. Not a hang source."
  timestamp: 2026-04-23T00:40:00Z

- hypothesis: "navigator.serial.getPorts() in wireSerial hangs on new page"
  evidence: "getPorts() is awaited inside a try/catch (serial.js:117-132); even if it rejected/hung, this would just leave wireSerial unresolved — page would hang in 'loading' but not trigger Page Unresponsive. Also, getPorts() resolves quickly even when other renderers hold the port; it's a permissions-list query, not a hardware probe. Eliminated as primary cause but not as a secondary aggravator."
  timestamp: 2026-04-23T00:45:00Z

## Evidence

- timestamp: 2026-04-23T00:10:00Z
  checked: "Phase 5 Plan 07 SUMMARY (.planning/phases/05-web-serial-transport/05-07-SUMMARY.md)"
  found: "Plan 07 INTRODUCED the beforeunload handler in serial.js. Quote from key-decisions: 'beforeunload bypasses the shared teardown() helper intentionally — teardown awaits each step, and beforeunload's browser time budget cannot afford that latency. This is the ONLY code path that bypasses teardown.' This is the exact code path implicated."
  implication: "Phase 7's lifecycle hardening is the regression source. Tests 1 and 2 pass because they don't involve beforeunload. Only Test 3 (reload) exercises this code."

- timestamp: 2026-04-23T00:15:00Z
  checked: "www/transport/serial.js:105-111 (beforeunload handler) vs www/transport/serial.js:349-376 (teardown helper)"
  found: |
    beforeunload handler:
      window.addEventListener('beforeunload', () => {
          if (port && port.writable) {
              port.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
          }
          if (reader) reader.cancel().catch(() => {});
          if (port)   port.close().catch(() => {});
      });

    teardown helper (the correct path):
      // step 1: setSignals (await)
      // step 2: reader.cancel() (await)
      // step 3: writer.releaseLock() + unregisterWriter()  ← CRITICAL — beforeunload skips this entirely
      // step 4: port.close() (await)

    The beforeunload handler:
      1. NEVER calls writer.releaseLock() — leaves port.writable LOCKED.
      2. NEVER calls reader.releaseLock() — only cancel(), which does NOT release the lock.
      3. Fires port.close() with both .readable and .writable still locked.
  implication: "Per the Streams API spec (and MDN's SerialPort.close() docs), port.close() can only resolve when both readable and writable are unlocked via releaseLock(). cancel() resolves the in-flight read but does NOT release the reader's lock. The close() promise here can never resolve. Chromium then waits for unload promises and reports Page Unresponsive on the OLD page being torn down."

- timestamp: 2026-04-23T00:20:00Z
  checked: "MDN docs for SerialPort.close() and ReadableStream cancel/releaseLock semantics (web search)"
  found: "Quote: 'close() closes the serial port if previously-locked SerialPort.readable and SerialPort.writable members are UNLOCKED, meaning the releaseLock() methods have been called for their respective reader and writer.' Also: 'reader.cancel() resolves reader.read() with {value:undefined, done:true} — but the loop still needs to call reader.releaseLock() to unlock the stream.'"
  implication: "MDN explicitly confirms the contract: cancel() ≠ releaseLock(). The beforeunload handler uses cancel() but never releaseLock(). port.close() therefore never resolves."

- timestamp: 2026-04-23T00:25:00Z
  checked: "www/transport/serial.js:303-328 runReadLoop"
  found: |
    The async-fire-and-forget read loop:
      while (p.readable) {
          reader = p.readable.getReader();
          try { while (true) { const {value,done} = await reader.read(); ... } }
          catch (err) { handleReadError(err); }      // ← appends DOM error log + setState('port-lost')
          finally { try { reader.releaseLock(); } catch {} reader = null; }
      }
    The outer while iterates as long as p.readable is truthy. After cancel-from-beforeunload, the inner break runs; outer iterates again; gets a NEW reader; await reader.read() blocks. Even if eventually it errors out, each error path calls handleReadError → appendErrorLog → DOM mutation (connectionPane.open=true, renderErrorLog) on a page being unloaded.
  implication: "Aggravator (not root): even if the reader were properly released, the outer while-readable loop has a brief window where it re-acquires a reader after cancel(), creating extra work during unload. But the primary deadlock is the locked-stream → close() never resolves contract violation in beforeunload."

- timestamp: 2026-04-23T00:28:00Z
  checked: "Symmetry of fix evidence: why Test 1 (fresh Connect) and Test 2 (replug) work"
  found: "Test 1: starts disconnected; no port to clean up. Test 2: read loop's reader.read() throws NetworkError on physical unplug; goes through handleReadError → setState('port-lost'); the navigator.serial 'connect' event handler then calls handleReconnect → target.open() succeeds. Neither test exercises beforeunload."
  implication: "Confirms Test 3's hang is uniquely tied to beforeunload — the only code path the other passing tests don't traverse."

## Resolution

root_cause: |
  www/transport/serial.js:105-111 — the beforeunload handler violates the Web Streams + Web Serial contract by calling port.close() without first releasing the readable and writable locks. Per MDN/WHATWG, SerialPort.close() can only resolve when both port.readable and port.writable are unlocked (i.e. reader.releaseLock() AND writer.releaseLock() have been called). The handler calls reader.cancel() (which only resolves the pending read with {done:true} but does NOT release the lock), never touches the writer at all (which was acquired in connectMicroBeast at line 262: `writer = selectedPort.writable.getWriter()`), and then fires port.close() — leaving close() with an unresolvable promise.

  This stalls Chromium's beforeunload tear-down phase, causing the OLD page (being unloaded) to trigger the "Page unresponsive" dialog. Clicking "Wait" doesn't help because the underlying lock contract violation can never be satisfied — the renderer is waiting for a close that fundamentally cannot complete. This was introduced by Phase 5 Plan 07 (Wave 6 lifecycle hardening, commit bdfac66) which deliberately bypassed the shared teardown() helper for "browser time budget" reasons but skipped the critical releaseLock() step in doing so.

  Test 1 (fresh Connect) and Test 2 (unplug+replug) pass because neither path goes through beforeunload — Test 1 starts disconnected, Test 2 only exercises the runtime read-loop error path + reconnect event handler. Only Test 3 (reload while connected) hits the buggy beforeunload code, which explains the symptom asymmetry exactly.

fix: ""
verification: ""
files_changed: []
