---
phase: 06-daily-driver-polish-session-deployment
plan: 05
subsystem: state
tags: [session-log, blob-download, clear-screen, web-serial-readloop, chrome-button]

# Dependency graph
requires:
  - phase: 06-daily-driver-polish-session-deployment
    provides: Terminal::clear_visible + resize_scrollback wasm-boundary forwarders — Plan 06-02
  - phase: 06-daily-driver-polish-session-deployment
    provides: scroll-state.snapToBottom — Plan 06-03
  - phase: 05-web-serial-transport
    provides: serial.js read loop + connectMicroBeast/finishReconnect lifecycle hooks
  - phase: 03-canvas-renderer
    provides: chrome.js wireChrome opts pattern + #top-bar button styling
provides:
  - www/transport/session-log.js — RX-only chunks-by-reference accumulator with Blob download
  - chrome.js Clear button click handler (term.clear_visible + Shift+click clears scrollback)
  - serial.js read-loop append + reset-on-Connect / reset-on-Reconnect
  - #download-log-button (Connection pane) + #clear-button (top-bar)
  - window.__sessionLog + window.__wasm + window.__requestFrame test handles
affects: [06-06 prefs subscription, 06-07 deploy/license, 06-08 24-h soak]

# Tech tracking
tech-stack:
  added:
    - "Blob constructor + URL.createObjectURL + synthetic anchor click — D-31 download mechanism"
  patterns:
    - "RX-only per-connection log lifecycle — chunks pushed by reference; Blob assembly + 5s deferred URL revoke at download time only"
    - "Late-bound dependency injection via getter thunk (getScrollState in wireChrome opts) — preserves documented module boot order without forcing wireChrome to be called after wireScrollState"
    - "Connect-time UTC stamp captured BEFORE setState('connected') so the filename reflects when the session started, not when the user clicks Download"
    - "Direct Rust API call (term.clear_visible) bypasses the parser — JS does NOT feed a fabricated ESC J; Plan 06-02 Test 4 is the Rust-side gate, clear-screen.spec.js Test 3 is the JS-side regression gate"

key-files:
  created:
    - www/transport/session-log.js
  modified:
    - www/transport/serial.js
    - www/renderer/chrome.js
    - www/main.js
    - www/index.html
    - www/tests/session/log-download.spec.js
    - www/tests/session/clear-screen.spec.js

key-decisions:
  - "session-log.js storage strategy: module-scope chunks: Uint8Array[] + totalBytes counter (D-30); chunks pushed by reference, no copy until Blob assembly at download time. Per-connection lifecycle (D-29) — fresh array on every successful port.open(). RX-only (D-28) — TX never enters this module."
  - "session-log connect-stamp captured INSIDE connectMicroBeast / finishReconnect, BEFORE setState('connected') — the filename UTC stamp reflects session START not download click. sessionLogRef.reset() landed AFTER setSignals(false,false) and BEFORE setState in BOTH connect paths."
  - "Read-loop append placed AFTER requestFrameFn() — last in the post-feed invariant. A parser failure (very rare) does not silently lose bytes for the log either way; the log records what reached the wire regardless of how the parser interpreted it. Existing post-feed ordering (term.feed → sampleBell → drainHostReply → requestFrame) preserved verbatim."
  - "Clear button uses late-bound scrollState resolution via a getScrollState getter thunk in wireChrome opts. Without this, the documented boot order (wireChrome runs BEFORE wireScrollState per RESEARCH §Architecture) would force a reorder that ripples through other call sites. The thunk is resolved at click time, when scrollStateRef has long since been assigned."
  - "Clear button calls term.clear_visible() directly — NEVER term.feed of \\x1B\\x4A. D-26 contract preserved: the remote VT52 state machine never sees a fabricated escape. clear-screen.spec.js Test 3 is the regression gate (puts parser in EscState, clicks Clear, then feeds 'Z' — host_reply MUST contain ESC / K, proving parser state was not stomped)."
  - "Shift+click cycles resize_scrollback(0) then resize_scrollback(10000) — drops the historical ring then re-creates it at the Phase 1 D-12 default cap. Both branches snap to live tail (D-04 trigger) + request a frame so the user does not end up reading an empty scrolled-back viewport."

patterns-established:
  - "Late-bound dependency injection via getter thunk for cross-module deps that violate the documented boot order"
  - "Module-scope ref + reset()/append() pair for per-connection lifecycle modules — mirrors www/input/tx-sink.js but without ring-buffer semantics (logs grow unbounded; 24-h soak validates v1 cap)"
  - "Connect-time stamp captured INSIDE the production path's success branch (NOT in main.js wiring) so identity vs. UI-trigger distinction is preserved — same convention used by Phase 5 D-31 VID/PID persistVidPid"

requirements-completed: [SESS-04, SESS-05, SESS-06]

# Metrics
duration: 35min
completed: 2026-04-25
---

# Phase 6 Plan 05: Wave 4 Session Log + Clear Screen Summary

**RX-only per-connection session log with synthetic-anchor Blob download (filename = bestialitty-{YYYYMMDD-HHMMSS}.bin from connect-time UTC stamp), and a top-bar Clear button that calls the Rust direct-clear API (clear_visible — Plan 06-02 wasm forwarder) instead of feeding ESC J, with Shift+click cycling resize_scrollback(0)→(10000) for full-history wipe.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-04-25T14:15Z
- **Completed:** 2026-04-25T14:50Z
- **Tasks:** 2 (with 2 TDD RED→GREEN cycles)
- **Files created:** 1 (www/transport/session-log.js, 110 LOC)
- **Files modified:** 5 (serial.js, chrome.js, main.js, index.html, plus 2 spec files)

## Accomplishments

- session-log.js (110 LOC, 5 exports) — wireSessionLog, reset, append, download, getCurrentBytes. Module-scope chunks-by-reference array (D-30); Blob constructor at download time only; 5-second deferred URL.revokeObjectURL hygiene step. Tooltip strings and filename grammar are verbatim from 06-UI-SPEC.
- Read-loop append landed AFTER requestFrameFn() in serial.js — last in the post-feed invariant, preserves the existing ordering (term.feed → sampleBell → drainHostReply → requestFrame → sessionLog.append).
- Per-connection lifecycle wired in BOTH paths: connectMicroBeast (initial Connect) and finishReconnect (Wave 4 silent reconnect). sessionLogRef.reset() captures the connect-time UTC stamp BEFORE setState('connected') so it precedes any byte arrival.
- Connection-pane #download-log-button — disabled with tooltip 'No bytes received yet' until first byte; enabled with tooltip 'Download all bytes received this connection (.bin)' thereafter. mousedown preventDefault retains canvas focus (Phase 4 D-16 sacred).
- Top-bar #clear-button placed between #connect-button and #theme-toggle per UI-SPEC §Element ordering. NO new CSS — inherits #top-bar button rules.
- Clear button click handler in chrome.js — plain click calls termArg.clear_visible() (Phase 6 Plan 02 wasm forwarder, NOT \\x1B\\x4A); Shift+click also cycles resize_scrollback(0)→(10000); both branches snap to live tail + request a frame.
- Late-bound scrollState resolution via getScrollState thunk in wireChrome opts — preserves the documented boot order (wireChrome before wireScrollState per RESEARCH §Architecture) without rippling reorder through other call sites.
- 7/7 log-download.spec.js tests passing.
- 4/4 clear-screen.spec.js tests passing.
- Phase 5 transport suite: 41/41 (regression-free).

## Task Commits

1. **Task 1 RED — un-fixme 7 log-download.spec.js stubs + #download-log-button DOM/CSS** — `9370588` (test)
2. **Task 1 GREEN — session-log.js + main.js wiring + serial.js read-loop append** — `47923a9` (feat)
3. **Task 2 RED — un-fixme 4 clear-screen.spec.js stubs + #clear-button DOM + window.__wasm/__requestFrame exposure** — `a2800b3` (test)
4. **Task 2 GREEN — chrome.js Clear button handler + main.js getScrollState thunk** — `6ee9d76` (feat)
5. **Refactor — paraphrase clear_visible comment per grep-hygiene rule** — `c2938f8` (refactor)

## Files Created/Modified

- `www/transport/session-log.js` (NEW, 110 LOC) — module-scope chunks + totalBytes + connectStartIso + downloadBtnRef. 5 exports: wireSessionLog, reset, append, download, getCurrentBytes. Verbatim tooltip strings (TOOLTIP_DISABLED, TOOLTIP_ENABLED) per UI-SPEC. filenameFromConnectStart helper builds bestialitty-{YYYYMMDD-HHMMSS}.bin from the connect-time UTC stamp using getUTC{FullYear,Month,Date,Hours,Minutes,Seconds}.
- `www/transport/serial.js` (modified) — sessionLogRef module-scope let; wireSerial opts destructure adds sessionLog; connectMicroBeast calls sessionLogRef.reset() inside the open-success branch BEFORE setState('connected'); finishReconnect mirrors the call; read-loop body adds `if (sessionLogRef) sessionLogRef.append(value);` AFTER requestFrameFn().
- `www/renderer/chrome.js` (modified) — wireChrome opts destructure adds term + getScrollState; Clear button click handler calls termArg.clear_visible() then optionally cycles resize_scrollback(0)/resize_scrollback(10000) on Shift+click, then snaps to bottom + requests a frame; mousedown preventDefault retains focus.
- `www/main.js` (modified) — imports wireSessionLog + reset/append/download/getCurrentBytes from session-log.js; downloadLogBtn DOM ref; wireSessionLog({ downloadButton }) before wireSerial; window.__sessionLog test handle; wireSerial opts gain sessionLog: { reset, append }; wireChrome opts gain term + getScrollState getter thunk; scrollStateRef late-bound after wireScrollState returns; window.__wasm + window.__requestFrame exposed for clear-screen.spec.js parser-state test + grid-fill helpers.
- `www/index.html` (modified) — #clear-button between #connect-button and #theme-toggle in #top-bar; #download-log-button after #serial-reset-preset in <details id="connection">; CSS rule for #download-log-button:disabled (opacity + cursor hint).
- `www/tests/session/log-download.spec.js` (Wave 0 stubs un-fixmed) — 7 tests covering connect → push bytes → download flow, button enable/disable, mid-session download, filename format, per-connection lifecycle.
- `www/tests/session/clear-screen.spec.js` (Wave 0 stubs un-fixmed) — 4 tests: visible-grid wipe / scrollback intact, Shift+click also wipes scrollback, parser-state preservation gate (clear_visible does NOT feed ESC J), snap-to-bottom on click.

## Decisions Made

- **Append placement at the end of the post-feed invariant:** `term.feed → sampleBell → drainHostReply → requestFrame → sessionLog.append`. Documented in serial.js comment block. The log records what reached the wire, not what the parser interpreted. If a future plan extends the post-feed sequence with a new step, the rule is "session-log.append stays last."
- **Connect-stamp captured inside connectMicroBeast's success branch (BEFORE setState('connected')):** Mirrors Phase 5 D-31 persistVidPid placement. The UI signals "connected" only after the log buffer has been initialized, so Playwright's wait-for-data-state-connected gate is sufficient to drive append() / getCurrentBytes() assertions deterministically.
- **finishReconnect ALSO calls sessionLogRef.reset():** Reconnect is treated as a new session per the per-connection lifecycle contract (D-29) — even though port-lost → silent-reconnect feels continuous to the user, the filename grammar requires a fresh stamp because the read-loop interruption may have lost bytes that the new buffer cannot reconstruct. Documented as a key decision so Plan 06-08 UAT does not re-propose "preserve log across silent reconnect."
- **Late-bound getScrollState thunk in wireChrome opts:** Phase 6 RESEARCH §Architecture documents wireChrome as step 5 and wireScrollState as step 7 of the boot sequence. Reordering would force a cascade through other deps (wireKeyboard at step 6 sits between them and consumes both). The getter thunk resolves the live ref at click time, decoupling registration order from resolution order. Pattern documented for future plans that hit similar boot-order tension.
- **Verbatim tooltip + filename strings as module constants:** session-log.js declares TOOLTIP_DISABLED, TOOLTIP_ENABLED at module scope so they appear EXACTLY ONCE in code. Phase 5 grep-hygiene rule (5 prior occurrences) is the precedent: comments paraphrase the literals so grep-count done-criteria stay clean. Same rule applied to the 5000 ms revoke delay comment after the initial implementation.
- **Test exposure of window.__wasm + window.__requestFrame:** Required for the clear-screen parser-state-preservation test (reads host_reply via raw wasm.memory.buffer) and the grid-fill helpers (forces a frame request after feed). Mirrors the Phase 4 D-15 precedent that __testGridView is unconditionally exposed because Phase 4 has zero security surface; Phase 6 inherits the rationale.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's clear-screen.spec.js test referenced host_reply_byte_len() which does not exist on the wasm boundary**
- **Found during:** Task 2 RED — `host_reply_byte_len` is not declared in pkg/bestialitty_core.d.ts; the actual API is `host_reply_len()` (Phase 2 Plan 02-06 zero-copy boundary).
- **Issue:** Plan's verbatim test body called `window.__term.host_reply_byte_len()` which would have thrown TypeError ("not a function") at runtime, masking any real assertion.
- **Fix:** Test body now calls `window.__term.host_reply_len()` per the Phase 2 D-03 canonical name. Also added a `term.clear_host_reply()` precondition before the bare-ESC feed so the assertion targets THIS Z's reply, not whatever leftover the boot path produced.
- **Files modified:** www/tests/session/clear-screen.spec.js
- **Verification:** Test 3 (parser-state preservation) passes; reply array reads [0x1B, 0x2F, 0x4B] — proves clear_visible did NOT consume the parser's EscState.
- **Committed in:** a2800b3 (Task 2 RED).

**2. [Rule 3 - Blocking] window.__wasm and window.__requestFrame were not exposed for the clear-screen parser-state test**
- **Found during:** Task 2 RED — test code reads `window.__wasm.memory.buffer` to construct a Uint8Array view over host_reply bytes, but main.js only exposed __testGridView, __term, __scrollState, __selection, __sessionLog (post-Task-1).
- **Issue:** Without __wasm exposed, `new Uint8Array(window.__wasm.memory.buffer, ptr, len)` would throw "Cannot read properties of undefined". Same gap for __requestFrame which the grid-fill helper calls after feed.
- **Fix:** Added `window.__wasm = wasm; window.__requestFrame = requestFrame;` in main.js right after the existing window.__term assignment. Documented as zero-security-surface per Phase 4 D-15 precedent.
- **Files modified:** www/main.js
- **Committed in:** a2800b3 (Task 2 RED).

**3. [Rule 1 - Bug] grep-count = 1 invariant for "term.clear_visible" violated by an introductory comment**
- **Found during:** Task 2 GREEN acceptance verification — initial comment block referenced `term.clear_visible()` literally, making the chrome.js grep return 2 hits instead of the acceptance-required 1.
- **Issue:** Phase 5 grep-hygiene rule (5 prior occurrences in this project) requires comments to paraphrase load-bearing literals when a grep-count done-criterion exists. The 6th occurrence in this project.
- **Fix:** Paraphrased the comment to "the Rust direct-clear API (call site below is the single authoritative source)" so the call site at line 79 is the sole grep hit.
- **Files modified:** www/renderer/chrome.js
- **Committed in:** c2938f8 (refactor — separate from the Task 2 GREEN commit so the rationale is recorded as a pattern).

### Other Notes

- **clear-screen.spec.js Test 3 passed during the RED phase:** Documented in the RED commit message. The parser-state-preservation assertion is a regression test — it passes today because there's no click handler (no parser mutation) AND it must keep passing after GREEN (because clear_visible is a direct Rust API that bypasses the parser). Both branches are correct; the test is doing exactly what it should.
- **Acceptance criterion `getUTCFullYear|...| wc -l` returns 6:** The plan expected 6 because the spec form has 6 UTC accessors. My implementation places all 6 in a single template-literal expression on 2 lines, so `grep -n` counts 2 line matches. The behavior IS correct (each of the 6 accessors is called); the criterion's wc -l metric is mismatched against the implementation's line layout. The session-log.js code reviewer should compare the 6 method names character-by-character, not by line count. Filed as a Note rather than a Deviation because no code change was needed.

**Total deviations:** 3 auto-fixed (1 Rule 1 spec bug, 1 Rule 3 blocking issue, 1 Rule 1 grep-hygiene fix).
**Impact on plan:** All three were latent issues in the plan's verbatim test/code shapes; the production behavior the plan describes is preserved end-to-end.

## Issues Encountered

- **Parallel Playwright runs occasionally flake when running `tests/render/ tests/input/ tests/transport/ tests/session/` together** — each suite passes 100% in isolation, and re-running the same combined invocation produces a different failing test (or zero) each time. Symptom is consistent with http.server contention under high parallelism. Not introduced by this plan; not a regression. Plan 06-04's SUMMARY also reported 142 passed across the same combined invocation, so the suites individually compose correctly. No action required for this plan; could be addressed by lowering Playwright's worker count in CI.
- **Test 4 of clear-screen ("clear-screen is a snap-to-bottom trigger when user is scrolled up") needed `\\r\\n` line terminators in the feed string** — the original `\\n`-only payload did not advance the cursor through enough rows to register as scroll-eligible content; switching to `\\r\\n` mirrors what the MicroBeast actually emits and makes the row-count predictable. Adopted the pattern in all four tests.

## Test Counts (Wave 4 deliverables)

- log-download.spec.js: 7/7 passing.
- clear-screen.spec.js: 4/4 passing.
- Phase 5 transport suite: 41/41 passing (regression-free).
- Phase 3 render suite: 32/32 passing standalone (one flaky run under combined parallelism, passes on retry).
- Phase 4 input suite: 31/31 passing.
- Wave 0..3 session suites: 43/43 passing standalone (3 fixme deferred — visual regressions for BEL no-flash + cursor-hidden + 1 future test).

## Threat Flags

None — all five threats in the Plan 06-05 register are mitigated as designed:
- T-06-05-01 DoS via long sessions: chunks pushed by reference; 24-h soak (Plan 06-08) validates real RX volume.
- T-06-05-02 Information disclosure: intentional (the feature). User-initiated download.
- T-06-05-03 Tampering via fake ESC J: term.clear_visible() bypasses parser; clear-screen.spec.js Test 3 is the regression gate.
- T-06-05-04 Path-traversal in filename: filenameFromConnectStart uses Date formatting only; no user input.
- T-06-05-05 Blob URL leak: 5s deferred revokeObjectURL; URLs are origin-scoped.

No new network endpoints, schema changes, or auth paths introduced.

## Self-Check: PASSED

- File `www/transport/session-log.js` exists with 5 exports.
- File `www/index.html` contains both `id="clear-button"` (line 484) and `id="download-log-button"` (line 542).
- Commits `9370588`, `47923a9`, `a2800b3`, `6ee9d76`, `c2938f8` all in `git log`.
- `grep -n "sessionLogRef\\.append\\|sessionLog\\.append" www/transport/serial.js` returns ≥ 1 hit.
- `grep -n "sessionLogRef\\.reset\\|sessionLog\\.reset" www/transport/serial.js` returns 3 hits (comment doc + 2 call sites in connectMicroBeast and finishReconnect).
- `grep -n "term\\.clear_visible\\|termArg\\.clear_visible" www/renderer/chrome.js` returns 1 hit (call site at line 79).
- 7/7 + 4/4 Wave 4 tests green.

## Next Phase Readiness

- **Wave 5 unblocked:** Plan 06-06 (PREF-01/PREF-02 — versioned localStorage prefs blob + auto-connect) can subscribe to chrome.js setters now. The boot-order pattern (late-bound scrollStateRef) is the template for any future cross-module deps that violate the documented order.
- **Plan 06-07 unblocked:** GitHub Pages deploy + LICENSE work has zero dependency on this plan; can run in parallel with Wave 5 if desired.
- **Plan 06-08 (24-h soak) gating fact:** session-log.js is the memory-growth surface. The 24-h soak protocol's `performance.memory` + `wasm.memory.buffer.byteLength` sampler will run with the log accumulator active; the chunks-by-reference invariant means RAM growth tracks RX volume linearly with no copy-pressure spike until the user clicks Download.

---
*Phase: 06-daily-driver-polish-session-deployment*
*Completed: 2026-04-25*
