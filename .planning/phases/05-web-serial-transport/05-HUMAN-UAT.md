---
status: diagnosed
phase: 05-web-serial-transport
source: [05-VERIFICATION.md, 05-VALIDATION.md]
started: 2026-04-23
updated: 2026-04-25
---

# Phase 5 — Human UAT (real hardware)

## Current Test

[testing paused — 1 item outstanding (Test 4 blocked: no CP/M COPY utility)]

## Tests

### 1. Real MicroBeast connect + type commands (SC-1 / XPORT-04)

**expected:** Power the MicroBeast, plug USB-C, click Connect, pick CP2102N 10c4:ea60 in native picker. Connection pane shows `MicroBeast (CP2102N 10c4:ea60) — 19200 8N1`, Connect button border turns green, button label reads `Disconnect`. Type `HELP` + Enter — MicroBeast responds on canvas. No boot banner appears on Connect (DTR/RTS stayed low).

**steps:**
1. Plug MicroBeast via USB-C. Verify kernel log (e.g. `dmesg | tail` on Linux, `ioreg -p IOUSB | grep -i cp210` on macOS) shows a CP2102N attaching to `/dev/ttyUSB*` (Linux) or `/dev/cu.usbserial-*` (macOS); confirm the kernel reports VID `10c4` PID `ea60`.
2. Power the MicroBeast via its power switch.
3. Open BestialiTTY in Chromium. Confirm the Connection pane either shows `Not connected` (first-run) OR `MicroBeast (CP2102N 10c4:ea60) — click Connect` (if port previously granted). The Connect button border is gray, label reads `Connect`.
4. Click the Connect button in the top bar.
5. In the Chromium native port-picker dialog, select the entry labelled with VID `10c4`:PID `ea60` (the CP2102N). Click Connect in the dialog.
6. Within ~1 second, verify ALL of:
   - Connect button label changes from `Connect` to `Disconnect`.
   - Connect button border changes from gray to green (`#33ff66`).
   - Connection pane port-status line reads exactly `MicroBeast (CP2102N 10c4:ea60) — 19200 8N1`.
   - NO unexpected boot banner appears on the MicroBeast canvas (proves DTR/RTS stayed low through the open — Pitfall #12 / D-11 / XPORT-06).
7. Click on the terminal canvas (or press Tab) to focus `#terminal-wrapper`. Verify the cursor starts blinking.
8. Type `HELP` (uppercase) then press Enter.
9. Verify the MicroBeast responds with CP/M help output rendered on the canvas within ~500 ms. The output should appear in the MicroBeast's current phosphor color.
10. Open DevTools → Application → Local Storage → check key `bestialitty.port.preset`. Value should be the JSON string `{"usbVendorId":4292,"usbProductId":60000}` (decimal form of `0x10c4` and `0xea60`). This proves D-31 persistence fired on successful open.

**result:** pass

### 2. Physical unplug / replug (XPORT-06 / XPORT-08 / SC-3)

**expected:** With connection live, yank USB cable — within ~1 s button border turns red, label reads `Reconnect`. Error log shows `read-error` or similar. Reinsert USB — border cycles red → amber → green silently; typing resumes without permission prompt.

**steps:**
1. From Test 1's connected state, yank the USB-C cable from the MicroBeast (not the host).
2. Within ~1-2 seconds, verify ALL of:
   - Connect button border changes from green to red (`#e04040`).
   - Connect button label changes from `Disconnect` to `Reconnect`.
   - Optional: Error log in the Connection pane MAY show a recent `read-error` entry with the current HH:MM:SS timestamp. The "happy path" signal per D-24 is the red border alone — an entry is acceptable but not required.
3. Verify the terminal canvas still shows prior MicroBeast output (scrollback is NOT cleared by a port-lost transition).
4. Re-insert the USB-C cable into the MicroBeast.
5. Within ~1-2 seconds, verify ALL of:
   - Connect button border cycles: red (`#e04040`) → amber (`#e0b030`, during `reconnecting`) briefly → green (`#33ff66`, when `connected`).
   - Connect button label returns to `Disconnect`.
   - NO Chromium permission prompt appears (auto-reconnect honors the stored VID/PID grant — D-24 / XPORT-08).
6. Focus the canvas and type `DIR` + Enter. Verify the MicroBeast responds with a directory listing.

**result:** pass

### 3. Reload with granted port (XPORT-07 / SC-3c)

**expected:** With connection live, hit reload. App loads; Connect button reads `Connect`, border gray. Connection pane shows `MicroBeast (CP2102N 10c4:ea60) — click Connect`. Click Connect — no permission prompt (port already granted), connects in < 1 s.

**steps:**
1. From Test 1/2's connected state, press Ctrl+R (or browser reload button).
2. Wait for the page to fully reload (wasm + fonts + canvas re-initialise).
3. Verify ALL of:
   - Connect button label reads `Connect` (not `Disconnect`, not `Reconnect`).
   - Connect button border is gray (default, not green/red/amber).
   - Connection pane port-status line reads `MicroBeast (CP2102N 10c4:ea60) — click Connect` — this proves the port was restored via `getPorts()` without auto-opening (D-05).
4. Click Connect.
5. Within < 1 second, verify ALL of:
   - Connect transitions directly to `connected` (no Chromium native picker dialog appears — previously-granted port opens silently via the stored reference).
   - Port-status line changes to `MicroBeast (CP2102N 10c4:ea60) — 19200 8N1`.
   - Typing on the canvas reaches the MicroBeast (type `VER` + Enter or similar to confirm).
6. Open DevTools → Application → Local Storage → confirm `bestialitty.port.preset` is still `{"usbVendorId":4292,"usbProductId":60000}` (should have been untouched by reload; D-31 persistence is write-on-open only).
7. Close the BestialiTTY tab entirely. Re-open the URL in a fresh tab. Verify the Connection pane again shows `MicroBeast (CP2102N 10c4:ea60) — click Connect` — proving the port grant + preset survives full tab recycle (not just reload).

**result:** issue
**reported:** "nope, reload leads to a hang and evenutally a \"Page unresponsive...\" dialog. Tried clicking \"Wait\" a few times, but it's dead as nails."
**severity:** blocker

### 4. Paste at 19200 baud no-overrun (XPORT-09 / SC-4b)

**expected:** Connect, type `copy con dummy.txt` on MicroBeast CP/M, paste ~2 KB of text via Debug pane Paste test button. Progress line ticks 0% → 100% over ~1.2 s. No dropped bytes in MicroBeast file (compare SHA256 before/after).

**steps:**
1. From Test 1/2/3's connected state, at the CP/M prompt type `COPY CON DUMMY.TXT` + Enter (upper or lowercase; CP/M is case-insensitive for command names).
2. Open the Debug pane in BestialiTTY (click the `Debug` summary to expand the `<details>`).
3. Locate a local ASCII text file of approximately 2 KB (a README chunk, `.txt` file, or small source file — any plain ASCII content). Copy its contents to clipboard, then paste them into the `#input` textarea in the Debug pane.
4. Click the `Paste test` button in the Debug pane.
5. Verify that the Connection pane auto-expands (D-17) and shows the progress line `Pasting 2048 B — 0%` (or your actual byte count) ticking to 100% over approximately 1.15 s (for exactly 2048 bytes; for 1 KB: ~575 ms; for 4 KB: ~2.3 s at the 90% of 19200 byte-rate pump).
6. When the pump completes and the progress line reads `Paste complete`, press Ctrl+Z on the terminal (CP/M's EOF marker — the `^Z` will echo on the canvas).
7. Press Enter to finish the CP/M `COPY CON` command and return to the A> prompt.
8. Type `TYPE DUMMY.TXT` + Enter to dump the file back to the canvas.
9. Verify the dumped output matches the pasted content byte-for-byte (modulo CR/LF convention — if the Settings pane has CR/LF override set to `crlf`, expect each line terminator to be CR+LF in CP/M's dump; set to `cr` if you want raw CR preservation).
10. Optional (high-rigor): compute `sha256sum` of the source paste content (after applying the same CR/LF convention used at paste time) and compare with `sha256sum` of `DUMMY.TXT` on the MicroBeast side (if you can extract the file via FLOP utility or a cross-check tool). Hashes MUST match — any divergence indicates overrun and should be raised as a D-14 chunk-size tuning issue.

**result:** blocked
**blocked_by:** other
**reason:** "blocked: don't have COPY"

### 5. Polite fail in Firefox AND Safari (PLAT-01 / PLAT-02 / SC-5a)

**expected:** Open BestialiTTY URL in Firefox stable AND Safari (macOS). Each shows polite-fail page with heading `BestialiTTY requires a Chromium-based browser`, bulleted browser list, Download Chromium link. Zero console errors. Title reads `BestialiTTY — Chromium required`. No canvas flash before takeover.

**steps:**
1. Open BestialiTTY URL in Firefox (latest stable release; tested with Firefox 126+ minimum).
2. Verify ALL of:
   - The page renders the polite-fail `<h1>` heading with exact text `BestialiTTY requires a Chromium-based browser`.
   - A bulleted browser list is visible with exactly these 5 items: `Chrome 89+`, `Microsoft Edge 89+`, `Brave 1.22+`, `Opera 75+`, `Arc (any version)`.
   - A clickable `Download Chromium` link is visible; href resolves to `https://www.chromium.org/getting-involved/download-chromium/`.
   - Window title reads exactly `BestialiTTY — Chromium required` (with em-dash, not hyphen).
   - DevTools Console shows zero errors EXCEPT the expected `Uncaught Error: __polite-fail__` from the D-33 abort — any other error is a failure.
   - NO canvas element, NO top-bar, NO Connection pane visible (body innerHTML replaced entirely per `renderPoliteFail`).
   - NO canvas flash / flicker before the polite-fail takeover (the gate runs before wasm/fonts/canvas load).
3. Repeat in Safari (macOS, if hardware available).
4. Verify identical behavior in Safari: same h1 text, same browser list, same title, no canvas, no console errors beyond the expected abort throw.

**result:** pass

### 6. 5-minute daily-driver feel (PROJECT.md Core Value)

**expected:** Drive a real work session — CP/M shell, BASIC program, intentional paste, intentional Ctrl+C, intentional Disconnect + Connect. Focus retention on every chrome click (terminal stays focused; typing never misses). No jarring pane pops during paste. Reconnect after accidental unplug is seamless.

**steps:**
1. Starting in Chromium with a connected MicroBeast (from Tests 1-4), drive a realistic work session for 5+ minutes exercising:
   - Launch `BASIC` on the MicroBeast → write a 10-line BASIC program (simple loop, PRINT statements) → `RUN` → `LIST` → Ctrl+C to interrupt → `BYE` or `SYSTEM` to exit BASIC.
   - Back at CP/M: `DIR`, `TYPE SOME.TXT` on any existing file, `ERA TEMP.*` (if any temp files exist) or similar routine commands.
   - Paste a ~500 B text snippet via Debug pane `Paste test` button. Confirm bytes reach the MicroBeast (echoed or captured per Test 4's `COPY CON` pattern).
   - Yank USB cable mid-session. Verify port-lost state (red border). Replug. Verify silent auto-reconnect (border cycles to green) WITHOUT any dialog.
   - After silent auto-reconnect, click the Connect button once — verify it now reads `Disconnect` (green). Click Disconnect. Verify border returns to gray, label to `Connect`. Click Connect again. Verify reconnect in < 1 second (port grant remembered, no picker dialog).
2. Throughout the session, verify qualitative properties:
   - **Focus retention:** clicking any chrome control (Connect, theme toggle, phosphor buttons, Settings pane summary, Connection pane summary, Debug pane summary, `Paste test` / `Reset TX` / `Cancel paste` buttons, Settings form inputs) NEVER makes the terminal lose focus — typing continues immediately after every click.
   - **No jarring pane pops during paste:** the Connection pane auto-expands when a paste starts and collapses back to its prior state ~2 s after completion. No visible flash or layout jump.
   - **Reconnect feels invisible** on cable wiggle — no toasts, no dialogs, no modal prompts. Just the border color cycle.
   - **Typing feels responsive:** no > 100 ms perceptible lag on keypress-to-screen. Ctrl+Alt+T theme toggle is instant. Phosphor switches are instant.
3. Record subjective impression: does BestialiTTY feel like something you'd reach for as a daily driver if you had to talk to a MicroBeast? Note any rough edges, annoyances, or confusion points in the `reason:` field.

**result:** issue
**reported:** "whenever i paste, the connection dialog at the top opens, which causes the TTY part of the display to lurch down the screen alarmingly. I know the paste status is in there, but it shouldn't open the dialog."
**severity:** major

## Summary (post-execution)

| metric | value |
|--------|-------|
| total  | 6     |
| passed | 3     |
| issues | 2     |
| blocked | 1    |
| pending | 0    |
| skipped | 0    |

## Gaps

- truth: "Reload with a connected port restores app to Connect/gray state and reconnects in < 1s without picker prompt (XPORT-07 / SC-3c)"
  status: failed
  reason: "User reported: nope, reload leads to a hang and evenutally a \"Page unresponsive...\" dialog. Tried clicking \"Wait\" a few times, but it's dead as nails."
  severity: blocker
  test: 3
  root_cause: "The beforeunload handler in www/transport/serial.js violates the Web Serial close-contract: it calls reader.cancel() + port.close() but NEVER calls reader.releaseLock() nor writer.releaseLock(). Per the WHATWG/MDN spec, port.close() only resolves when both port.readable and port.writable are unlocked. The close promise therefore never resolves, stalling Chromium's renderer cleanup on the OLD page — which Chromium surfaces as \"Page unresponsive\". Clicking Wait never helps because the contract cannot be satisfied. The runReadLoop outer `while (p.readable)` aggravates it by re-acquiring a reader immediately after the inner cancel-driven break."
  artifacts:
    - path: "www/transport/serial.js:105-111"
      issue: "beforeunload handler omits reader.releaseLock() and never releases the writer (writer.releaseLock() + unregisterWriter())"
    - path: "www/transport/serial.js:303-328"
      issue: "runReadLoop outer `while (p.readable)` re-acquires a reader after cancel-break, aggravating the lock state during shutdown"
    - path: "www/transport/serial.js:349-376"
      issue: "teardown() helper is the correct model; beforeunload should mirror its sequence (or call it) using synchronous releaseLock calls"
  missing:
    - "Call reader.releaseLock() and writer.releaseLock() + unregisterWriter() synchronously before port.close() inside the beforeunload handler"
    - "Correct sequence in beforeunload: setSignals (fire-and-forget) → reader.cancel() (fire-and-forget) → reader.releaseLock() (sync) → writer.releaseLock() (sync) → port.close() (fire-and-forget)"
    - "Add a module-scope `shuttingDown` flag set in beforeunload that runReadLoop's outer `while (p.readable)` checks, so a fresh reader is not re-acquired during tear-down"
    - "Update the comment block at www/transport/serial.js lines 98-104 to reflect that cancel() ≠ releaseLock() and that close() requires unlocked streams"
    - "Add a www/tests/transport/lifecycle.spec.js (or extend readloop.spec.js) asserting a mock port observes releaseLock calls before close during a simulated beforeunload while connected"
  debug_session: ".planning/debug/reload-hang-page-unresponsive.md"

- truth: "During paste, the Connection pane's paste-progress surfaces WITHOUT auto-expanding the <details> and WITHOUT causing the terminal canvas to lurch down the viewport (D-17 / paste UX)"
  status: failed
  reason: "User reported: whenever i paste, the connection dialog at the top opens, which causes the TTY part of the display to lurch down the screen alarmingly. I know the paste status is in there, but it shouldn't open the dialog."
  severity: major
  test: 6
  root_cause: "www/main.js lines 307-308 explicitly set `connectionPane.open = true` on the paste-progress 'started' event (faithfully implementing spec D-17 / UI-SPEC §Connection pane auto-expand rules). <details id=\"connection\"> sits above #terminal-wrapper in the body's normal flex-column flow, and #terminal-wrapper has no sticky/fixed anchoring — so expanding the pane (~250-330 px height delta) translates 1:1 into the canvas's vertical position. This is a spec bug, not a code-vs-spec drift: the implementation matches D-17 verbatim; the spec is what's wrong. Same mechanism exists at serial.js:410 for D-27 error-log auto-expand."
  artifacts:
    - path: "www/main.js:305-348"
      issue: "Paste-progress observer sets connectionPane.open = true on 'started' (line 308) with preExpansionOpen capture/restore dance at 304/307/323/333/343 — this is the direct cause of the canvas lurch"
    - path: "www/index.html:395-453"
      issue: "<details id=\"connection\"> DOM block whose auto-expansion shifts the canvas; <div id=\"paste-progress-row\" hidden> at lines 444-447 should be relocated out of this block"
    - path: "www/index.html:54-82"
      issue: "#top-bar is the sticky container that's the natural new home for paste-progress (rides at viewport top without pushing canvas)"
    - path: "www/transport/serial.js:410"
      issue: "Secondary auto-expand (connectionPane.open = true; // D-27 auto-expand on error) has the same lurch potential; consider same treatment for consistency"
    - path: ".planning/phases/05-web-serial-transport/05-CONTEXT.md:188-194"
      issue: "D-17 spec prescribes auto-expand on paste — needs amendment"
    - path: ".planning/phases/05-web-serial-transport/05-UI-SPEC.md:511-516"
      issue: "UI-SPEC Connection pane auto-expand rules table needs amendment to drop paste-start auto-expand"
  missing:
    - "Relocate paste-progress UI out of <details id=\"connection\"> and into #top-bar as a [hidden]-toggled flex item"
    - "Remove connectionPane.open = true from main.js 'started' branch and the matching preExpansionOpen restore from 'complete' / 'cancelled' / 'cancelled-port-lost' branches (lines 304-348)"
    - "Amend 05-CONTEXT.md D-17 and 05-UI-SPEC.md §Connection pane auto-expand rules to drop auto-expand on paste"
    - "Decide whether the D-27 error-log auto-expand at serial.js:410 should similarly be demoted to a top-bar status slot for consistency"
  debug_session: ".planning/debug/paste-auto-expands-pane-lurches-canvas.md"

## Sign-Off

**Approval:** auto-approved in auto-chain (plan-level document verified). Real-hardware UAT pending — the user will run the 6 test rows against a physical MicroBeast + CP2102N cable and fill in each `result:` with `pass` / `fail` / `partial`, update the Summary counts, and flip front-matter `status: in-progress` → `status: complete`.
