---
phase: 05-web-serial-transport
verified: 2026-04-25T00:35:00Z
status: human_needed
score: 5/5 roadmap success criteria verified (13/13 requirement IDs — automated portion)
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5 (automated) with 2 UAT-discovered blockers/majors
  gaps_closed:
    - "Reload with a connected port hangs Chromium with 'Page unresponsive' — closed by Plan 05-08 (beforeunload close-contract; reader+writer locks released before port.close + shuttingDown guard); automated regression in lifecycle.spec.js (2 tests)"
    - "Paste auto-expands Connection pane and lurches canvas down ~250-330 px — closed by Plan 05-09 (#paste-progress-row relocated to sticky #top-bar; preExpansionOpen + connectionPane.open mutations removed); automated regression in paste.spec.js (1 test)"
  gaps_remaining: []
  outstanding_human_items:
    - "UAT Test 3 real-hardware re-run pending after Plan 05-08 fix (reload while connected to physical MicroBeast — must not show Page unresponsive)"
    - "UAT Test 6 real-hardware re-run pending after Plan 05-09 fix (paste must not displace canvas; pane stays collapsed; progress text rides top-bar)"
    - "UAT Test 4 still blocked by missing CP/M COPY utility on the user's MicroBeast image — environmental, not a code defect"
    - "UAT Test 5 (Polite-fail in Firefox AND Safari) — Firefox confirmed pass; Safari requires macOS hardware not available to verifier"
    - "Daily-driver feel — qualitative subjective UX properties (out-of-band)"
  regressions: []
  test_count_delta:
    before: 38 transport tests passing
    after: 41 transport tests passing (+3 from Plan 05-08 lifecycle.spec.js × 2 + Plan 05-09 paste.spec.js × 1)
human_verification:
  - test: "Real MicroBeast connect + type commands (SC-1 / XPORT-04)"
    expected: "Power MicroBeast, click Connect, pick CP2102N 10c4:ea60. Border turns green. Type HELP — MicroBeast responds on canvas. No DTR/RTS reset banner."
    why_human: "Requires physical MicroBeast hardware + CP2102N USB-C cable; exercises real driver stack; DTR/RTS-stay-low verified only against real Z80 reset line."
    status: passed (UAT 2026-04-25)
  - test: "Physical unplug / replug cycle (XPORT-06, XPORT-08, SC-3)"
    expected: "Yank USB → border red, label Reconnect within ~1s. Replug → silent red→amber→green cycle, no permission prompt; typing resumes."
    why_human: "Requires physical USB unplug/replug; navigator.serial dispatches real connect/disconnect events only from hardware, not programmatic simulation."
    status: passed (UAT 2026-04-25)
  - test: "Reload with granted port (XPORT-07, SC-3c)"
    expected: "Ctrl+R preserves port grant. Connection pane shows 'MicroBeast (CP2102N 10c4:ea60) — click Connect'. Click opens silently, no Chromium picker. NO 'Page unresponsive' dialog."
    why_human: "Exercises Chromium's persistent port-grant storage (outside localStorage) across tab lifecycle; cannot be simulated in a mock."
    status: pending real-hardware re-run after Plan 05-08 fix
  - test: "Paste at 19200 baud no-overrun (XPORT-09, SC-4b)"
    expected: "COPY CON on MicroBeast, paste ~2 KB via Debug pane Paste test. Progress 0%→100% over ~1.2s. SHA256 pasted == SHA256 received."
    why_human: "Verifies the pump's byte-rate target against the MicroBeast's real UART RX buffer; overrun only detectable with real hardware ground-truth."
    status: blocked (no CP/M COPY utility on user's MicroBeast image — environmental)
  - test: "Polite fail in Firefox AND Safari (PLAT-01, PLAT-02, SC-5a)"
    expected: "Open URL in Firefox + Safari. Polite-fail h1, browser list, Download Chromium link. Zero non-abort console errors. No canvas flash."
    why_human: "Playwright is Chromium-only in this project; true non-Chromium verification requires opening the URL in actual Firefox and Safari builds."
    status: passed (Firefox confirmed in UAT 2026-04-25; Safari requires macOS hardware)
  - test: "5-minute daily-driver feel (PROJECT.md Core Value) — paste UX revisit after Plan 05-09"
    expected: "Drive real work session: BASIC loop, CP/M commands, paste, intentional unplug/replug, Ctrl+C. Focus retention, no pane pops, reconnect feels invisible, typing responsive. Paste must not lurch canvas."
    why_human: "Subjective qualitative UX properties — 'feels responsive', 'no jarring pops', 'daily-driver-worthy' — cannot be automated."
    status: pending real-hardware re-run after Plan 05-09 fix
---

# Phase 5: Web Serial Transport — Verification Report

**Phase Goal:** Connect to a real MicroBeast over Web Serial with sane defaults, survive unplug/replug cleanly, restore the previously-granted port on reload, and expose full serial-config overrides — with byte-safe end-to-end transport and no TextDecoder anywhere on the read path.

**Verified:** 2026-04-22T00:00:00Z (initial); re-verified 2026-04-25T00:35:00Z (after Plans 05-08, 05-09)
**Status:** human_needed
**Re-verification:** Yes — after gap closure (Plans 05-08, 05-09)

---

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Click Connect (MicroBeast preset 19200 8N1, no flow control), pick port, see live output, typing reaches MicroBeast | VERIFIED (automated portion) | `requestPort` filter `{ usbVendorId: 0x10c4, usbProductId: 0xea60 }` at serial.js:234; preset defaults 19200/8/1/none/none hard-coded at PRESET_CONFIG serial.js:20-22 AND as HTML `selected` attrs at index.html:408-438; `term.feed(value)` inside read loop at serial.js:310; writer registered to tx-sink at serial.js:263; real-hardware echo pending human UAT item 1 |
| SC-2 | Colour-coded status indicator (connected/disconnected/port-lost); single stateful Connect/Disconnect button | VERIFIED | Single button `#connect-button` at index.html:384; label table BUTTON_LABELS at serial.js:25-31 cycles Connect/Connecting…/Disconnect/Reconnecting…/Reconnect; border colors at index.html:227-236 encode gray (disconnected)/amber (connecting,reconnecting)/green #33ff66 (connected)/red #e04040 (port-lost); `applyStateToButton` at serial.js:385-389 sets `data-state` attribute |
| SC-3 | Unplug → clean read-loop exit via `reader.cancel()` before `port.close()`; port-lost UI; replug auto-reconnects via VID/PID match; reload restores port via `getPorts()` | VERIFIED (automated portion) | Teardown order at serial.js:349-376: setSignals → reader.cancel() (line 361) → writer release → port.close() (line 371); `navigator.serial.addEventListener('connect'/'disconnect')` at serial.js:95-96; `getPorts()` on boot at serial.js:117 (no auto-open — D-05); `localStorage['bestialitty.port.preset']` written by `persistVidPid` at serial.js:441-452; reconnect state machine `onNavSerialConnect` at serial.js:472-501; real-hardware auto-reconnect pending human UAT items 2-3 |
| SC-4 | Serial-config UI exposes baud/data bits/stop bits/parity/flow control; paste rate-limited to serial speed (no overrun at 19200) | VERIFIED (automated portion) | 5 `<select>` elements in Connection pane at index.html:399-438 (baud/databits/stopbits/parity/flowctl); `readFormConfig` at serial.js:189-198 reads form before open; paste-pump.js:14-94 with CHUNK_SIZE=32, gapMs computed as 90% of baud byte rate (D-13/D-14); Esc cancel interception at keyboard.js:178-182; real-hardware no-overrun pending human UAT item 4 |
| SC-5 | Firefox/Safari polite fail no crash; read loop pure async survives background-tab throttling without losing serial data | VERIFIED (automated portion) | `typeof navigator.serial === 'undefined'` check at main.js:19 (first executable line after import); `renderPoliteFail()` at serial.js:64-73 replaces body innerHTML; read loop at serial.js:303-328 is pure async `while(p.readable){ while(true){ await reader.read() } }` — NOT rAF-driven; `requestFrame()` call at line 313 is a wake signal to the renderer, not a scheduling driver; `visibilitychange` catch-up at chrome.js:152-157; real-browser polite-fail pending human UAT item 5 |

**Score:** 5/5 ROADMAP success criteria verified at the automated level. Real-hardware UAT items are documented and auto-approved-in-auto-chain pending physical MicroBeast session.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `www/transport/serial.js` | Full serial transport (553 lines) — connect/disconnect, read loop, reconnect state machine, DTR/RTS discipline, polite-fail, VID/PID persistence | VERIFIED | 553 lines; exports `wireSerial`, `renderPoliteFail`, `connectMicroBeast`, `disconnect`, `getState`, `onStateChange`, `getWriter`; all public surface implemented |
| `www/input/paste-pump.js` | setTimeout chain pump with 32B chunks, 90% baud pacing, CR/LF rewrite, port-lost drain, local-echo | VERIFIED | 164 lines; exports `enqueuePaste`, `cancelPaste`, `isActive`, `onProgress`, `onPortLost`, `wirePastePump`, `setBaudForPump`, `CRLF_MODES`; `writeOneChunk` implements setTimeout chain with 4ms floor (Pitfall #6) |
| `www/input/tx-sink.js` (extended) | `pushTxBytes` also calls `writer.write()` when writer registered; `registerWriter`/`unregisterWriter` exports | VERIFIED | Lines 46-50 fire `registeredWriter.write(bytes).catch(...)` when registered; `registerWriter` line 80, `unregisterWriter` line 81 |
| `www/input/keyboard.js` (extended) | Esc-intercept branch calls `cancelPaste()` when pump active | VERIFIED | Lines 178-182 check `pastePumpIsActive()` and short-circuit 0x1B emission while paste running |
| `www/main.js` (extended) | Polite-fail first line; wireSerial + wirePastePump wiring; paste progress observer; all DOM refs | VERIFIED | Lines 18-22 polite-fail gate; line 202 wireKeyboard; line 213 wirePastePump; lines 219-238 wireSerial; lines 305-348 paste-progress observer |
| `www/index.html` (extended) | `#connect-button` in top-bar; `<details id="connection">` pane with 5 config selects; `#paste-test` button in debug; connect button state-color CSS; polite-fail CSS | VERIFIED | Line 384 connect button; line 395 connection pane; line 499 paste-test button; lines 222-238 connect button CSS; lines 346-378 polite-fail CSS |
| `www/renderer/chrome.js` (extended) | visibilitychange calls `requestFrame()` on `!document.hidden` | VERIFIED | Line 156 `if (!document.hidden && requestFrame) requestFrame()` inside existing single listener |
| `www/tests/transport/*` | 7 spec files + mock-serial.js; zero test.fixme markers | VERIFIED | 7 .spec.js files + mock-serial.js present; `grep "^\\s*test\\.fixme"` returns 0 matches; 38 live transport tests pass (5.4s total) |
| `.planning/phases/05-web-serial-transport/05-HUMAN-UAT.md` | 6 real-hardware UAT test rows with step-by-step instructions | VERIFIED | 6 test headings (Test 1-6) with 40 numbered steps total; status `in-progress`; all auto-approved-in-auto-chain pending real hardware |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `main.js` top | `renderPoliteFail` | eager import + `typeof navigator.serial === 'undefined'` | WIRED | main.js:18-22 — import on line 18, check on 19, call on 20, throw on 21 |
| `serial.js:connectMicroBeast` | `navigator.serial.requestPort` | filter `{ usbVendorId: 0x10c4, usbProductId: 0xea60 }` | WIRED | serial.js:233-235 — literal VID/PID in filter object |
| `serial.js:runReadLoop` | `term.feed` | `await reader.read() → term.feed(value) → sampleBell → drainHostReply → requestFrame` | WIRED | serial.js:307-313 — exact post-feed invariant sequence preserved |
| `serial.js:teardown` | `reader.cancel()` BEFORE `port.close()` | Step 2 before Step 4 in teardown helper | WIRED | serial.js:361 (cancel) → 371 (close); beforeunload path serial.js:109→110 same order |
| `serial.js:wireSerial` | `navigator.serial.addEventListener('connect'/'disconnect')` | Registered on navigator.serial, NOT on port instance | WIRED | serial.js:95-96 — listeners on `navigator.serial` (Pitfall #11 compliance) |
| `serial.js:handleReconnect` | VID/PID-matched silent auto-open | `getPorts()` → VID/PID filter → prefer `lastPortRef` → `open()` → `setSignals(false,false)` | WIRED | serial.js:472-501 `onNavSerialConnect` and 517-553 handleReconnect/finishReconnect |
| `serial.js:persistVidPid` | `localStorage['bestialitty.port.preset']` | `setItem(STORAGE_KEY, JSON.stringify({usbVendorId, usbProductId}))` | WIRED | serial.js:441-452 |
| `tx-sink.js:pushTxBytes` | `registeredWriter.write(bytes)` | Synchronous after ring append; fire-and-forget catch | WIRED | tx-sink.js:46-50 |
| `paste-pump.js:writeOneChunk` | `tx-sink.pushTxBytes` | Single coupling point; writer.write fires via tx-sink | WIRED | paste-pump.js:109 `pushTxBytes(chunk)` |
| `keyboard.js:keydown Escape` | `paste-pump.cancelPaste` | Esc-intercept when `pastePumpIsActive() === true`; short-circuits 0x1B | WIRED | keyboard.js:178-182 |
| `serial.js:teardown` | `paste-pump.onPortLost` | teardown step 5 drains queue on port-lost | WIRED | serial.js:374 `pastePumpOnPortLost()` |
| `window.beforeunload` | serial teardown best-effort chain | `setSignals → reader.cancel → port.close` each `.catch(()=>{})` | WIRED | serial.js:105-111 |
| `document.visibilitychange` | `requestFrame()` catch-up | `!document.hidden` branch inside existing chrome.js listener | WIRED | chrome.js:152-157 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|---------|
| Read loop (serial.js) | `value` from `reader.read()` | Web Serial API port.readable stream | Yes (real hardware) / mock stream in tests | FLOWING (test harness proven; hardware pending UAT) |
| Paste pump | `queue` | `enqueuePaste(bytes)` argument | Yes — feeds Debug-pane textarea bytes via `parseHexEscapes` (main.js:357-361) | FLOWING |
| Connect button state | `state` variable in serial.js | `setState()` driven by connect/disconnect listeners + user click | Yes — multiple test cases assert data-state transitions | FLOWING |
| Error log | `errorLog` ring | `appendErrorLog(code, msg)` on real error paths (read error, open error, multi-adapter) | Yes — test errors.spec.js asserts all code paths append entries | FLOWING |
| VID/PID persistence | `localStorage.getItem(STORAGE_KEY)` | `persistVidPid(p)` on successful open | Yes — reconnect.spec.js:141 asserts `{"usbVendorId":4292,"usbProductId":60000}` written after open | FLOWING |
| Port-status text | `portStatusEl.textContent` | `updatePortStatusConnected/Disconnected` on state change | Yes — verbatim UI-SPEC copy | FLOWING |
| Serial config form → port.open | `config` from `readFormConfig()` | 5 select elements at connect time | Yes — config.spec.js un-fixme'd with live assertions | FLOWING |

### Behavioral Spot-Checks

Transport Playwright suite run (38 tests, transport/ only):

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All transport tests pass | `npx playwright test tests/transport/ --reporter=list` | `38 passed (5.4s)` | PASS |
| Zero test.fixme markers | `grep "^\\s*test\\.fixme" www/tests/transport/*` | 0 matches | PASS |
| Zero TextDecoder on read path | `grep "TextDecoder" www/` | 0 matches (across entire www/) | PASS |
| Connect button label table cycles expected states | Source inspection serial.js:25-31 | All 5 state labels present | PASS |
| Connection pane DOM | `grep "details id=\"connection\"" www/index.html` | Match on index.html:395 | PASS |
| VID/PID literals | `grep "0x10c4\\|0xea60" www/transport/serial.js` | 4+ matches including requestPort filter and constants | PASS |
| Reader.cancel before port.close | Both beforeunload path (serial.js:109→110) and teardown path (361→371) | Correct order in BOTH paths | PASS |
| setSignals called after open AND before close | serial.js:246 (post-open), 353 (pre-close), 107 (beforeunload) | All 3 call sites confirmed | PASS |

### Requirements Coverage

Every requirement ID declared in this phase cross-referenced against REQUIREMENTS.md and implementation evidence:

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| XPORT-01 | 05-01, 05-03 | Web Serial transport driven entirely from JavaScript (no Rust bindings) | SATISFIED | www/transport/serial.js is pure JS; zero Rust bindings; crate `bestialitty-core` has no web-sys/js-sys::Serial imports |
| XPORT-02 | 05-01, 05-02, 05-03 | Connect / Disconnect button with clear stateful label | SATISFIED | Single `#connect-button`; BUTTON_LABELS cycles 5 states; `applyStateToButton` updates textContent |
| XPORT-03 | 05-01, 05-02, 05-03 | Visible connection status indicator (connected / disconnected / port lost) | SATISFIED | Connect button border color encodes 4 states; port-status line shows VID:PID+config when connected |
| XPORT-04 | 05-01, 05-03 | MicroBeast preset default (19200 8N1, no flow control) | SATISFIED | PRESET_CONFIG and HTML `selected` attrs both lock 19200/8/1/none/none |
| XPORT-05 | 05-01, 05-04 | Serial configuration override UI (baud/data bits/stop bits/parity/flow control) | SATISFIED | 5 select elements in Connection pane; `readFormConfig()` reads form; `snapPreset()` resets; config.spec.js 5 live tests |
| XPORT-06 | 05-01, 05-05, 05-07 | Graceful port-disconnect recovery — read loop exits cleanly on disconnect event | SATISFIED | `onNavSerialDisconnect` sets port-lost; read loop exits via cancel single path; pastePump.onPortLost drains queue |
| XPORT-07 | 05-01, 05-05, **05-08** | Restore previously-granted port on reload via `navigator.serial.getPorts()` | SATISFIED | wireSerial boot calls getPorts() filters by stored VID/PID; stashes match as lastPortRef; does NOT auto-open (D-05). Plan 05-08 fixed reload-hang on connected ports (Streams API close-contract). |
| XPORT-08 | 05-01, 05-05 | Auto-reconnect on USB re-plug via `connect` / `disconnect` event listeners | SATISFIED | navigator.serial listeners registered once at wireSerial; onNavSerialConnect auto-opens matching VID/PID when state==port-lost |
| XPORT-09 | 05-01, 05-06, **05-09** | Paste throttling to serial line rate (no overrun at 19200) | SATISFIED | paste-pump.js CHUNK_SIZE=32 with gapMs = 90% of baud byte rate; keypresses queue-jump between chunks; 9 paste tests pass (8 original + 1 Gap 2 regression). Plan 05-09 fixed paste-progress UI lurch. |
| XPORT-10 | 05-01, 05-03, **05-08** | Disconnect uses `reader.cancel()` before `port.close()` | SATISFIED | Teardown step 2 (cancel) → step 4 (close); beforeunload same order; reconnect.spec.js:16 asserts order. Plan 05-08 added releaseLock-before-close; lifecycle.spec.js asserts. |
| XPORT-11 | 05-01, 05-03, 05-07 | Read loop is pure async, decoupled from rAF | SATISFIED | runReadLoop is `while(p.readable){ while(true){ await reader.read() } }` — no rAF scheduling; requestFrame() is wake-only; visibilitychange catch-up at chrome.js preserves invariant |
| PLAT-01 | 05-01, 05-02, 05-07 | Detect Chromium-based Web Serial support on load | SATISFIED | `typeof navigator.serial === 'undefined'` check at main.js:19 (first executable line) |
| PLAT-02 | 05-01, 05-02, 05-07 | Clear "use Chromium-based browser" message on unsupported browsers — polite fail, no crash | SATISFIED | renderPoliteFail() replaces body innerHTML with heading + browser list + download link; polite-fail.spec.js 3 live tests |

**Orphaned requirements:** None. Every requirement ID from REQUIREMENTS.md §Transport and §Platform rows flagged as "Phase 5" is accounted for by at least one plan's `requirements:` field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| www/transport/serial.js | 72 | `github.com/{TBD-during-Phase-6}` placeholder in polite-fail HTML | INFO | Expected — Phase 6 PLAT-03 will populate public repo URL; static string today, not user-visible harm |
| www/input/paste-pump.js | 12, 160 | `CRLF_MODES` imported-but-unused, re-exported "to suppress linter" | INFO | Dead code smell flagged in 05-REVIEW IN-01; no functional impact |
| www/transport/serial.js | 227 | `connectMicroBeast(configOverride)` parameter never wired from a caller | INFO | 05-REVIEW WR-01; API surface has a dead branch — not a stub, just unused |
| www/transport/serial.js | 322-327 | Read-loop exit can stomp port-lost → disconnected in a race | INFO | 05-REVIEW WR-02; advisory — idempotent setState guard would harden |
| www/transport/serial.js | 517-543 | handleReconnect/retryOpenOnce do not clean stale writer/reader before reopen | INFO | 05-REVIEW WR-03; latent edge case; `teardown` in the normal path covers it |
| www/input/paste-pump.js | 99-127 | 'complete' progress can fire twice on empty paste edge case | INFO | 05-REVIEW WR-04; UI symmetry; not a correctness bug |
| www/input/tx-sink.js | 46-50 | Writer.write failure does not unregister registeredWriter | INFO | 05-REVIEW WR-05; log-spam risk on platform-race edge case |
| www/tests/transport/errors.spec.js | 97-115 | multiple-adapters test has fragile microtask ordering | INFO | 05-REVIEW WR-06; passes but would silently break if __simulateUnplug adds an await |

**Zero blocker anti-patterns.** All REVIEW warnings are advisory (INFO-severity here) — none prevent the phase goal from being achieved. Documented in 05-REVIEW.md with recommended fixes; deferred to Phase 6 polish if not needed for daily-driver.

### Pitfall Audit

| Pitfall | Check | Result |
|---------|-------|--------|
| #1 Reader-lock deadlock | `reader.cancel()` MUST appear before `port.close()` in every teardown path | PASS — teardown path serial.js:361→371; beforeunload path serial.js:109→110; both orders correct |
| #6 Background-tab throttling | Read loop MUST NOT be rAF-driven | PASS — runReadLoop is pure async `while(await reader.read())`; requestFrame is only called AFTER each chunk to wake renderer; visibilitychange catch-up at chrome.js:156 |
| #10 TextDecoder on read path | `grep TextDecoder` must return 0 matches | PASS — `grep "TextDecoder" www/` returns 0 matches across entire www/ |
| #11 VID/PID match | Listeners on `navigator.serial`, not port instance; getPorts filter | PASS — serial.js:95-96 on `navigator.serial`; `onNavSerialConnect` filters by stored VID/PID (serial.js:479-482) |
| #12 DTR/RTS on open AND before close | `setSignals({dataTerminalReady:false, requestToSend:false})` at both sites | PASS — serial.js:246 (after open), 353 (before close in teardown), 107 (before close in beforeunload), 521, 536 (reconnect paths) |

### Human Verification Required

6 items require physical MicroBeast hardware or non-Chromium browsers. All 6 are documented with step-by-step instructions in `05-HUMAN-UAT.md` and carry `result: auto-approved-in-auto-chain (pending real-hardware UAT)` tags. They are surfaced here verbatim:

#### 1. Real MicroBeast connect + type commands (SC-1 / XPORT-04)

**Test:** Power MicroBeast, plug CP2102N over USB-C, click Connect, pick CP2102N 10c4:ea60 in native picker, type `HELP` + Enter.
**Expected:** Within ~1s: button label "Disconnect", border green, port-status "MicroBeast (CP2102N 10c4:ea60) — 19200 8N1". No unexpected boot banner on canvas (DTR/RTS stayed low). `HELP` output renders within ~500ms. localStorage key `bestialitty.port.preset` = `{"usbVendorId":4292,"usbProductId":60000}`.
**Why human:** Physical MicroBeast + CP2102N required; exercises real USB driver stack; DTR/RTS-stay-low verified only against real Z80 reset line.

#### 2. Physical unplug / replug (XPORT-06 / XPORT-08 / SC-3)

**Test:** With connection live, yank USB-C from MicroBeast. Replug after ~3s.
**Expected:** Within ~1-2s of unplug: border red, label "Reconnect". Within ~1-2s of replug: border cycles red → amber → green silently; label returns to "Disconnect"; NO Chromium permission prompt.
**Why human:** Physical USB unplug/replug; navigator.serial dispatches real connect/disconnect only from hardware (Playwright simulated via __simulateUnplug/__simulateReplug covers code path but not driver-stack timing).

#### 3. Reload with granted port (XPORT-07 / SC-3c)

**Test:** With connection live, press Ctrl+R. After reload, click Connect.
**Expected:** After reload: label "Connect", border gray, port-status "MicroBeast (CP2102N 10c4:ea60) — click Connect". Click Connect: transitions to connected WITHOUT Chromium picker dialog appearing. Fresh-tab re-open preserves the same state.
**Why human:** Exercises Chromium's persistent port-grant storage across tab lifecycle; not simulable in mock.

#### 4. Paste at 19200 baud no-overrun (XPORT-09 / SC-4b)

**Test:** From connected state, type `COPY CON DUMMY.TXT` on CP/M. Paste ~2 KB text via Debug-pane Paste test button. Terminate with Ctrl+Z + Enter. `TYPE DUMMY.TXT` to verify.
**Expected:** Progress line "Pasting 2048 B — 0%" ticks to 100% over ~1.15s. Dumped file matches pasted content byte-for-byte (modulo CR/LF convention). Optional: SHA256 hashes match.
**Why human:** Verifies pump's byte-rate target against MicroBeast's real UART RX buffer; overrun detectable only with real hardware ground-truth.

#### 5. Polite fail in Firefox AND Safari (PLAT-01 / PLAT-02 / SC-5a)

**Test:** Open BestialiTTY URL in Firefox (stable) AND Safari (macOS, if hardware available).
**Expected:** Both show h1 `BestialiTTY requires a Chromium-based browser`, 5-item browser bullet list, Download Chromium link → `https://www.chromium.org/getting-involved/download-chromium/`, title `BestialiTTY — Chromium required`. Zero console errors except expected `__polite-fail__` abort throw. No canvas flash.
**Why human:** Playwright is Chromium-only in this project; true non-Chromium verification requires actual Firefox and Safari builds.

#### 6. 5-minute daily-driver feel (PROJECT.md Core Value)

**Test:** Drive a realistic 5-minute work session: launch BASIC, write 10-line program, RUN/LIST/Ctrl+C/exit; CP/M commands (DIR, TYPE, ERA); paste 500 B; mid-session USB yank → replug; Disconnect → Connect.
**Expected:** Focus retention on every chrome click. No jarring pane pops during paste. Reconnect feels invisible. Typing responsive (<100ms keypress-to-screen). Subjective: "daily-driver-worthy".
**Why human:** Qualitative UX properties cannot be automated.

### Gaps Summary

**No automated gaps.** Every ROADMAP Success Criterion is verifiable at the automated level against the current codebase; every Playwright test passes (38/38 transport tests in 5.4s); every pitfall mitigation (Pitfalls #1, #6, #10, #11, #12) is confirmed present at the exact code site; every requirement ID (XPORT-01..11, PLAT-01, PLAT-02) has implementation evidence.

**Code review findings are advisory, not blocking.** 05-REVIEW.md surfaced 0 Critical, 6 Warning, 8 Info items. None of the 6 Warnings prevent goal achievement — they flag edge cases (empty-paste UI symmetry, stale-writer cleanup on rapid replug, an unused `configOverride` parameter, log-spam on writer.write failure, and test ordering fragility). Documented with recommended fixes for Phase 6 polish if they surface in real use.

**Known intermittent test flakes** (noted in 05-07-SUMMARY): parallel-run timing flakes on `ime-composition.spec.js`, `paste.spec.js:32` 95%-timing gate, `bell.spec.js` — all pass in isolation and on re-run; pre-existing to Phase 5 and not introduced by Phase 5 code.

**6 human-verification items pending real-hardware session.** The 05-HUMAN-UAT.md document is plan-level complete (6 test rows, 40 numbered steps, UI-SPEC literal strings verbatim, zero placeholders). Real MicroBeast session will run out-of-band; status transitions from `in-progress` → `complete` on full pass.

### Phase 5 Readiness for Phase 6

- `connectMicroBeast()` / `disconnect()` + VID/PID localStorage stub are stable hooks for Phase 6 PREF-01 (full serial-config persistence).
- `enqueuePaste(bytes)` is the stable API Phase 6 SESS-03 (clipboard paste) will reuse.
- `setBaudForPump(baud)` is available for Phase 6 baud-change persistence.
- Read loop and transport module are framework-free plain ES modules; nothing blocks static-site deploy (PLAT-03) in Phase 6.

---

_Verified: 2026-04-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_

---

## Re-verification after gap closure (Plans 05-08, 05-09)

**Re-verified:** 2026-04-25T00:35:00Z
**Mode:** Re-verification — focused on gap-closure correctness + regression check on the broader phase
**Verdict:** **PASS-WITH-FOLLOWUPS** — both gaps closed at the code level; Plan 05-08 + Plan 05-09 satisfy their must_haves; the phase as a whole continues to satisfy all 5 ROADMAP success criteria at the automated level. Two real-hardware re-runs (UAT Test 3 + Test 6) remain as outstanding human-verification items for the user; their pending status does not block the phase verdict because the underlying root causes are eliminated in source and have automated regression tests.

### Context

Initial verification (2026-04-22) flagged the phase as `human_needed` with 6 real-hardware UAT items. The user ran the UAT against a physical MicroBeast on 2026-04-25 and reported back via `05-HUMAN-UAT.md`:

| UAT Test | Initial result | Severity |
|----------|----------------|----------|
| 1. Real MicroBeast connect + type | pass | — |
| 2. Physical unplug / replug | pass | — |
| 3. Reload with granted port | **issue** | blocker |
| 4. Paste at 19200 baud no-overrun | blocked (no CP/M COPY) | environmental |
| 5. Polite fail in Firefox + Safari | pass (Firefox; Safari unavailable) | — |
| 6. 5-minute daily-driver feel | **issue** | major |

Plan 05-08 (Wave 7 gap_closure) addressed Test 3. Plan 05-09 (Wave 7 gap_closure) addressed Test 6. Both shipped on 2026-04-25 with their own SUMMARYs.

### Plan 05-08 must_have verification (Gap 1 closure — beforeunload close-contract)

| must_have | Status | Evidence |
|-----------|--------|----------|
| Pressing Ctrl+R while connected reloads the page without "Page unresponsive" dialog | VERIFIED (code) — pending real-hardware re-run | Root cause eliminated in www/transport/serial.js: beforeunload handler now satisfies the WHATWG/MDN Streams API close-contract. Real-hardware confirmation is UAT Test 3 outstanding. |
| beforeunload handler releases reader and writer locks SYNCHRONOUSLY before port.close() | VERIFIED | serial.js:122-140 — beforeunload handler now performs: `shuttingDown = true` → `setSignals(false,false).catch()` → `reader.cancel().catch()` → `reader.releaseLock()` (sync, in try/catch) → `reader = null` → `writer.releaseLock()` (sync) → `writer = null` → `unregisterWriter()` → `port.close().catch()`. The two synchronous releaseLock calls satisfy the contract; close() can resolve. |
| Outer while(p.readable) in runReadLoop does NOT re-acquire a fresh reader during shutdown — shuttingDown guard short-circuits | VERIFIED | serial.js:332-335 — `while (p.readable)` body begins with `if (shuttingDown) break;`. Module-scope `let shuttingDown = false` declared at serial.js:40-42. |
| Playwright lifecycle spec asserts release-before-close ordering against instrumented mock | VERIFIED | www/tests/transport/lifecycle.spec.js — 2 tests both passing (verified by `npx playwright test tests/transport/lifecycle.spec.js`). Test 1 asserts `reader-release < close`, `writer-release < close`, `reader-cancel < reader-release`. Test 2 asserts `reader-release` count is exactly 1 after beforeunload (proves shuttingDown guard prevented re-acquisition). |
| Mock instrumentation hook on releaseLock + close | VERIFIED | www/tests/transport/mock-serial.js — `window.__mockLockLog = []` declared at module-scope (line 37); MockReader.cancel pushes 'reader-cancel' (line 53); MockReader.releaseLock pushes 'reader-release' (line 58); MockWriter.releaseLock pushes 'writer-release' (line 69); MockSerialPort.close pushes 'close' (line 96). |

**Grep invariants (Plan 05-08 done-criteria):**

| Invariant | Required | Actual | Status |
|-----------|----------|--------|--------|
| `grep -c "shuttingDown" www/transport/serial.js` | == 3 | 3 | PASS |
| `grep -c "reader.releaseLock" www/transport/serial.js` | >= 3 | 3 | PASS |
| `grep -c "writer.releaseLock" www/transport/serial.js` | >= 2 | 3 | PASS |
| `grep -c "unregisterWriter" www/transport/serial.js` | >= 2 | 3 | PASS |

**Commits:** `2550085` (fix), `a5afb9b` (test), `f38dbdc` (docs).

### Plan 05-09 must_have verification (Gap 2 closure — paste auto-expand / canvas lurch)

| must_have | Status | Evidence |
|-----------|--------|----------|
| When paste starts, Connection pane <details> does NOT auto-open | VERIFIED | www/main.js:308-343 paste observer body — zero `connectionPane.open` mutations across all 5 status branches (started/chunk/complete/cancelled/cancelled-port-lost). `preExpansionOpen` variable removed entirely. Asserted in paste.spec.js:170-204 Gap 2 regression test (`expect(page.locator('#connection')).not.toHaveAttribute('open', /.*/)` both during and after the 4 KB paste). |
| When paste starts, terminal canvas does NOT shift vertically | VERIFIED (code) — pending real-hardware visual confirmation | DOM relocation eliminates the root cause: `<div id="paste-progress-row">` now lives inside `<div id="top-bar">` (index.html:414-417). `#top-bar` is `position: sticky; top: 0` so the progress row rides at the viewport top without displacing the canvas. Indirect Playwright assertion: `paste.spec.js:196` confirms `#top-bar #paste-progress-row` count === 1. |
| Paste progress text visible in #top-bar (not Connection pane) | VERIFIED | index.html structure shows the row inside `#top-bar` block (verified via `grep -n "paste-progress-row\|top-bar" www/index.html`). CSS at index.html:310-335 scoped with `#top-bar` prefix sets `display: flex; margin-left: auto; white-space: nowrap` for the new context. |
| Cancel button remains click-reachable during paste | VERIFIED | `<button id="paste-cancel">` co-located with progress text inside `#paste-progress-row`; main.js:347 wires click handler `cancelPastePump()`; mousedown preventDefault preserves canvas focus (main.js:348). |
| Paste status copy preserved verbatim ('Paste complete', 'Paste cancelled', 'Paste cancelled — port lost (N bytes unsent)') | VERIFIED | main.js:320, 328, 336 — exact UI-SPEC strings retained per Copywriting Contract; em-dash U+2014 in the cancelled-port-lost string. |
| D-27 error-log auto-expand kept with documented asymmetry rationale | VERIFIED | serial.js:441-447 — comment block now explicitly explains the intentional D-17 / D-27 asymmetry; `connectionPane.open = true` assignment unchanged at line 447. The asymmetry is also documented in the amended D-17 rationale paragraph in 05-CONTEXT.md. |
| Spec artifacts amended (05-CONTEXT.md D-17, 05-UI-SPEC.md auto-expand rules) | VERIFIED | 05-CONTEXT.md:188-220 — D-17 has `(AMENDED 2026-04-23 by Plan 09 — Gap 2 fix)` header, rationale paragraph citing UAT Test 6 + the debug session, D-27 contrast paragraph, and `<details>` block preserving the original D-17 verbatim. 05-UI-SPEC.md:512 marks the paste-start row `[SUPERSEDED BY PLAN 09 — see amended D-17]`; line 570 paste-pump UI interactions table updated to drop the auto-expand mention. |

**Grep invariants (Plan 05-09 done-criteria):**

| Invariant | Required | Actual | Status |
|-----------|----------|--------|--------|
| `grep -c "preExpansionOpen" www/main.js` | == 0 | 0 | PASS |
| `grep -c "connectionPane\.open =" www/main.js` | == 0 | 0 | PASS |
| `grep -c "AMENDED 2026-04-23 by Plan 09" .planning/phases/05-web-serial-transport/05-CONTEXT.md` | >= 1 | 1 | PASS |
| `grep -c "SUPERSEDED BY PLAN 09" .planning/phases/05-web-serial-transport/05-UI-SPEC.md` | >= 1 | 1 | PASS |
| `#paste-progress-row` inside `#top-bar` block (DOM regex) | true | true | PASS |
| `#paste-progress-row` NOT inside `<details id="connection">` block | true | true | PASS |
| Plan 05-08 invariants preserved (shuttingDown × 3, reader.releaseLock × 3, writer.releaseLock × 3, unregisterWriter × 3) | true | all 3s | PASS |

**Commits:** `ceac705` (DOM), `f894620` (observer + spec test), `b3e2b3d` (spec amendments), `2300683` (docs).

### Regression check on the broader phase

| Concern | Result |
|---------|--------|
| Full transport test suite | **41 passed** (8.2s) — `npx playwright test tests/transport/ --reporter=list`. 38 pre-Plan-08 + 2 lifecycle.spec.js + 1 paste.spec.js Gap 2 regression. Zero failures. Zero `test.fixme` markers. |
| Pitfall #1 (reader-lock deadlock — cancel before close) | PASS (preserved). teardown path serial.js:391-399 keeps cancel→releaseLock→close order; beforeunload path serial.js:127-139 now ALSO satisfies it (cancel→releaseLock→close, with sync releaseLock per Streams contract). |
| Pitfall #6 (background-tab throttling — read loop pure-async, not rAF) | PASS (preserved). runReadLoop at serial.js:332-359 unchanged in shape; only added `if (shuttingDown) break;` guard at the top of the outer while. |
| Pitfall #10 (no TextDecoder on read path) | PASS (preserved). `grep "TextDecoder" www/transport/ www/main.js www/input/` returns 0 matches in our source code. |
| Pitfall #11 (navigator.serial listeners, not port-instance) | PASS (preserved). serial.js:98-99 unchanged. |
| Pitfall #12 (DTR/RTS de-assert on open AND close) | PASS (preserved). Open path serial.js:275, teardown path serial.js:384, beforeunload path serial.js:125, reconnect paths serial.js:558+573 — all 5 sites intact. |
| Polite-fail gate (PLAT-01, PLAT-02) | PASS. main.js:18-22 first-line check + renderPoliteFail unchanged; polite-fail.spec.js 4 tests still passing. |
| Read-loop streaming → term.feed invariant (XPORT-11, SC-5b) | PASS. serial.js:336-352 outer while + inner while + post-feed sample/drain/requestFrame sequence preserved; readloop.spec.js 4 tests passing. |
| VID/PID persistence + auto-reconnect (XPORT-07, XPORT-08) | PASS. reconnect.spec.js 6 tests passing; localStorage write at serial.js:478-490 unchanged; navigator.serial event listeners at 98-99 unchanged. |
| Paste pump correctness (XPORT-09, SC-4b) | PASS. paste.spec.js 9 tests passing (8 pre-existing + 1 Gap 2 regression). Pump still chunks 32B at 90% baud byte-rate; Esc cancel still intercepts; CR/LF rewrite still applied; port-lost drain still fires. |

### Outstanding items (real-hardware re-runs awaiting user)

These are NOT new gaps — they are the user-side closure step for the two gaps that Plans 05-08 and 05-09 fixed at the code level:

1. **UAT Test 3 (Reload with granted port)** — User must re-run on physical MicroBeast: connect, then Ctrl+R. Should reload cleanly with NO "Page unresponsive" dialog. Plan 05-08 lifecycle.spec.js asserts the close-contract ordering against a mock; only physical hardware can prove the end-to-end browser unload flow doesn't deadlock. Expected outcome: 05-HUMAN-UAT.md Test 3 `result: issue` flips to `pass`.

2. **UAT Test 6 (Daily-driver feel — paste UX)** — User must re-run on physical MicroBeast: trigger a paste during a real session and visually confirm (a) progress text appears in the top-bar (upper-right), (b) Connection pane stays collapsed, (c) terminal canvas does not move vertically. Plan 05-09 paste.spec.js asserts the proximate cause (`connectionPane.open === false`) and the relocation invariant (`#top-bar #paste-progress-row` count === 1) but cannot directly assert "canvas pixel position did not change between two screenshots." Expected outcome: 05-HUMAN-UAT.md Test 6 `result: issue` flips to `pass`.

3. **UAT Test 4 (Paste no-overrun on 2 KB)** — Still **blocked** by environmental factor: user's MicroBeast image lacks the CP/M COPY utility needed to capture pasted bytes back as a file for SHA256 comparison. Not a Phase 5 code defect; possible work-arounds: ship a different target program that echoes bytes (e.g. raw COM file written to a buffer), or defer to Phase 6 polish where a dedicated "paste capture" utility could be authored. Recommend tracking as a Phase-6 follow-up todo, not a Phase-5 blocker.

4. **UAT Test 5 (Polite-fail in Safari)** — Firefox confirmed pass on 2026-04-25. Safari requires macOS hardware not currently available; identical code path as Firefox so the risk of a Safari-specific failure is low (the polite-fail gate is `typeof navigator.serial === 'undefined'`, and Safari does not implement the Web Serial API on any version). Recommend tracking as a Phase-6 polish step if a Mac becomes available.

5. **Daily-driver feel (qualitative)** — Out-of-band; subjective. The user's open response on Test 6 was "alarming lurch" caused by the now-fixed paste behavior; a re-run after Plan 05-09 should yield a positive subjective impression, but this is unreviewable in code.

### Verdict

**PASS-WITH-FOLLOWUPS.**

- Both gap-closure plans (05-08 and 05-09) satisfy their `must_haves` at the code level; both ship automated regression tests; both ship spec amendments where applicable.
- Phase 5 as a whole continues to satisfy all 5 ROADMAP success criteria; all 13 declared requirement IDs (XPORT-01..11, PLAT-01, PLAT-02) are SATISFIED with code evidence; zero blocker anti-patterns; all 5 pitfalls remain mitigated.
- The full transport test suite went from 38 passing → 41 passing across the two gap-closure plans, with zero pre-existing test regressions.
- Two real-hardware UAT re-runs (Test 3 + Test 6) remain outstanding for the user; their pending status does NOT regress the phase verdict because the source-code root causes have been eliminated and the automated regression coverage is the strongest substitute available short of a hardware-in-the-loop CI rig.
- One environmental UAT block (Test 4 — no CP/M COPY) and one platform-availability UAT (Test 5 Safari) are noted as Phase-6 polish follow-ups, not Phase-5 defects.

**Recommendation:** Phase 5 may close. Phase 6 inherits a transport surface with no known close-contract violations, no known UI/UX regressions vs the original Phase 5 plan, and the amended D-17 / D-27 asymmetry as the canonical contract for any future status-indicator UI work. The four follow-ups above belong on the Phase-6 backlog rather than gating Phase 5 closure.

---

_Re-verified: 2026-04-25T00:35:00Z_
_Verifier: Claude (gsd-verifier)_
