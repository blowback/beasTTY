---
phase: 08-wasm-boundary-js-dispatcher-esc-wakeup
plan: 03
subsystem: dispatcher
tags:
  - slide
  - dispatcher
  - tx-owner
  - wakeup-matcher
  - wave-3

# Dependency graph
requires:
  - plan: 08-01
    provides: "Wave 0 RED gate — 27 Playwright stubs (slide-wakeup/dispatcher/tx-sink) + 8 Rust fn-pointer tests in tests/slide_wasm_boundary_shape.rs"
  - plan: 08-02
    provides: "class Slide #[wasm_bindgen] facade in www/pkg/bestialitty_core.{js,d.ts} — 11 methods (new, enter_recv_mode, feed_byte, feed_chunk, take_event_packed, state, outbound_ptr, outbound_len, clear_outbound, cancel, force_idle)"
  - phase: 04-keyboard-input
    provides: "tx-sink.js Phase 4 D-15 ring + Phase 5 D-21 registeredWriter coupling — extended (not replaced) by this plan's owner state"
  - phase: 05-web-serial-transport
    provides: "serial.js runReadLoop hot path (line 453 single-line edit point) + post-feed invariant (sampleBellFn → drainHostReplyFn → requestFrameFn → sessionLogRef.append)"
provides:
  - "www/transport/slide.js — SLIDE dispatcher with 7-byte ESC^ wakeup matcher (D-01 match-index counter + D-02 replay-on-fail), recv-mode lifecycle (D-09 synchronous handoff), zero-copy outbound drain (D-11; Pitfalls 4+5)"
  - "www/input/tx-sink.js extensions — owner state + setWireOwner/getWireOwner/writeSlideFrame (D-08); pushTxBytes silent-drops on owner==='slide' (Pitfall 3 wedge-state guard)"
  - "www/transport/serial.js D-06 hot-path edit — term.feed(value) → dispatchInbound(value) at runReadLoop:457 (was line 453 pre-import-block); post-feed invariant preserved verbatim per Pitfall 1"
  - "www/main.js boot wiring — Slide constructor imported from pkg, wireSlideDispatcher slotted between wireSessionLog and await wireSerial (Pitfall 8 boot order); window.__slide + window.__txSink test introspection hooks for Plan 08-04"
affects:
  - 08-04-PLAN (Wave 3 assertions — every test.skip stub from Plan 08-01 can now drive the dispatcher end-to-end via window.__slide / window.__txSink / __mockReaderPush)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-scope state + `wireXxx({...})` initializer (paste-pump.js / scroll-state.js / session-log.js codebase grain) applied to a transport-layer dispatcher with injected term/txSink/slideCtor/wasm refs"
    - "Match-index counter wakeup matcher with 6-byte scratch backing buffer + replay-on-fail with re-process-current-byte clause (D-02 critical clause for ESC^ESC^... mid-prefix retry)"
    - "Synchronous mode + owner double-flip in single helpers (enterRecvMode / exitRecvMode) — Pitfall 3 wedge-state guard"
    - "Zero-copy outbound drain — verbatim mirror of main.js:reDeriveHostReplyView (memory-buffer identity check + Uint8Array view re-derive on growth + slice to JS-owned buffer before await write per Pitfall 5)"

key-files:
  created:
    - "www/transport/slide.js (254 lines) — Phase 8 SLIDE dispatcher + 7-byte wakeup matcher + recv-mode lifecycle + zero-copy outbound drain"
    - ".planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/deferred-items.md — pre-existing session-log filename test/source drift logged but not fixed (out of scope)"
  modified:
    - "www/input/tx-sink.js (+45 LOC: owner state + 3 new exports + 1 silent-drop guard inside pushTxBytes)"
    - "www/transport/serial.js (+4 LOC: dispatchInbound import + comment block; -1 +1 line at runReadLoop body — term.feed → dispatchInbound)"
    - "www/main.js (+27 LOC: extended pkg import, extended tx-sink import, new slide.js import block, wireSlideDispatcher call between wireSessionLog and await wireSerial, window.__slide + window.__txSink introspection)"

key-decisions:
  - "Per-session new Slide() (Claude's Discretion default) — no Slide::reset() singleton optimization. ~1 KB allocation per session is irrelevant at SLIDE's session cadence; previous instance free()'d via wasm-bindgen-generated free() if present."
  - "Drain events to a no-op in Phase 8 (RESEARCH §Open Question 4 recommendation) — bounded ring (Phase 7 EVENT_RING_RESERVE = 32) means take_event_packed loop terminates; Phase 10 attaches the chip event handler. No silent-event-drop class because every dispatchRecvMode call drains."
  - "slide.js does NOT import Slide from pkg/ — it accepts the Slide class via `slideCtor` in wireSlideDispatcher opts. Decouples the dispatcher from wasm lifecycle (Pitfall 8 — Slide constructor must run AFTER `await init()` resolves) AND lets Playwright tests inject mock SlideCtor if needed."
  - "Pre-existing session/log-download.spec.js failures (filename `bestialitty-` regex vs `beastty-` source) deferred to deferred-items.md per scope boundary rule. Not caused by Plan 08-03; was caused by upstream commit 7571ce0 (pun rename) that did not update the test."

requirements-completed: []  # SLIDE-05 / SLIDE-06 / SLIDE-17 remain [ ] in REQUIREMENTS.md per sequential_execution discipline — full completion in Plan 08-04 when Playwright assertions land.

# Metrics
duration: 8min
completed: 2026-05-07
---

# Phase 08 Plan 03: SLIDE Dispatcher + 7-byte Wakeup Matcher + TX Owner Handoff Summary

**Phase 8 SC#2/3/4/5 partial deliverables shipped: dispatcher routing + 7-byte ESC^ wakeup matcher + TX owner handoff + recv-mode lifecycle land in their natural unit. The dispatcher pipeline is reachable end-to-end — bytes flowing through the Web Serial read loop reach `dispatchInbound`, get classified into terminal/recv mode, and route correctly. Plan 08-04 fills in Wave 0's stub assertions to prove every gate.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-07T19:24:27Z
- **Completed:** 2026-05-07T19:32:22Z
- **Tasks:** 3 / 3
- **Files created:** 1 (slide.js)
- **Files modified:** 3 (tx-sink.js, serial.js, main.js)
- **LOC delta (per file):** slide.js +254 (NEW), tx-sink.js +45 (15 → 132 lines, owner state + 3 exports), serial.js +4 (713 → 716 lines, dispatcher import + 1-line edit), main.js +27 (623 → 649 lines, imports + boot wiring + introspection)

## Accomplishments

- `www/transport/slide.js` exists (254 LOC, > 150 minimum) with the full Phase 8 dispatcher contract: dispatchInbound, wireSlideDispatcher, slidePumpOnPortLost (Phase 11 stub), __resetForTests, __getStateForTests.
- 7-byte wakeup matcher (D-01) — match-index counter (`wakeIdx 0..7`) with 6-byte `scratch` backing buffer; full match transitions to recv mode + flushes pre-wakeup pending bytes to term.feed FIRST so wire-order is preserved.
- Replay-on-fail (D-02 critical clause) — mismatch replays scratch[0..wakeIdx] to pending in original order, resets wakeIdx, AND re-processes the current byte from idx=0. The mid-prefix retry case `ESC ^ ESC ^ S L I D E` correctly triggers wakeup on byte 9.
- TX owner handoff (D-08) — tx-sink.js gains `let owner = 'terminal'`, `setWireOwner` / `getWireOwner` / `writeSlideFrame` exports; `pushTxBytes` early-returns when `owner === 'slide'` (silent drop, NOT silent-write — bytes are NOT pushed to ring per Anti-Pattern 5).
- Synchronous handoff (D-09; Pitfall 3 wedge-state guard) — enterRecvMode and exitRecvMode flip BOTH `mode` and `setWireOwner` in single helpers; impossible to leave mode='recv' with owner='terminal' or vice versa.
- Zero-copy outbound drain (D-11; Pitfalls 4+5) — drainSlideOutbound re-derives the Uint8Array view when `wasmRef.memory.buffer` changes (memory-growth guard, mirror of `main.js:reDeriveHostReplyView`); slices to JS-owned buffer via `new Uint8Array(outboundView.subarray(0, len))` BEFORE writeSlideFrame so an await-write cannot strand the byte serialization.
- D-06 single-line edit at `serial.js:runReadLoop` — `term.feed(value)` → `dispatchInbound(value)`; the post-feed invariant lines (sampleBellFn / drainHostReplyFn / requestFrameFn / sessionLogRef.append) are preserved verbatim per Pitfall 1. Grep `sampleBellFn|drainHostReplyFn|requestFrameFn|sessionLogRef.append` in serial.js returns 11 (≥ 4 minimum required).
- Boot order (Pitfall 8) — `wireSlideDispatcher` is called AFTER `wireSessionLog` (so terminal-mode dispatcher's transparent term.feed forwarding still reaches the session-log append) and BEFORE `await wireSerial` (so the dispatcher is initialized before any read-loop chunk could arrive). Verified via line-ordering grep: wireSessionLog (370) < wireSlideDispatcher (386) < await wireSerial (408).
- Test introspection hooks live: `window.__slide = { __resetForTests, __getStateForTests, dispatchInbound }` and `window.__txSink = { setWireOwner, getWireOwner, writeSlideFrame }`. Plan 08-04 can drive the dispatcher end-to-end via these + the existing `window.__mockReaderPush` Phase 5 hook.
- Phase 4/5 regression suite: 48/48 passes (transport/readloop, transport/lifecycle, transport/paste, transport/connect, transport/reconnect, input/keydown-printable, input/keydown-arrows, input/local-echo, input/tx-debug-strip). Dispatcher's terminal-mode branch is byte-transparent for non-wakeup byte streams — Pitfall 1 verified empirically.
- Whole-crate cargo test: 240 tests pass (no Rust changes; just confirming Plan 08-02's wasm facade is intact after the JS-side wiring).
- bash scripts/build.sh exits 0 — wasm bundle is reproducible from source.

## All 8 Pitfalls Addressed

Each Pitfall from RESEARCH.md is explicitly addressed in code with a comment citing its source:

| # | Pitfall | Mitigation site (code) |
|---|---------|------------------------|
| 1 | Post-feed invariant must run after dispatchInbound | serial.js:457-466 — sampleBellFn/drainHostReplyFn/requestFrameFn/sessionLogRef.append unchanged after dispatcher edit; grep count = 11 |
| 2 | Chunk-tail off-by-one | slide.js:148 — `value.subarray(i + 1)` skips the matched 7-byte signature; tail forwarded to feedSlide |
| 3 | TX owner not flipped back / wedge state | slide.js:228-247 — enterRecvMode + exitRecvMode flip BOTH mode and setWireOwner in single helpers; impossible to half-flip |
| 4 | Memory growth invalidates view | slide.js:212-215 — `if (wasmRef.memory.buffer !== outboundBuffer)` re-derive guard; mirror of main.js:reDeriveHostReplyView |
| 5 | Slice before await write | slide.js:218 — `new Uint8Array(outboundView.subarray(0, len))` JS-owned copy BEFORE writeSlideFrame |
| 6 | Recursive Slide name collision | Already handled in Plan 08-02 (`use crate::slide::Slide as CoreSlide`); Phase 8 JS doesn't see this |
| 7 | EVT_* JS mirror authority | slide.js:35-43 — comment cites `tests/slide_boundary_shape.rs:slide_event_constants_pinned` + `tests/slide_wasm_boundary_shape.rs` as the authority for the kind values |
| 8 | Boot order: construct after init() | main.js:386-391 — wireSlideDispatcher called between wireSessionLog (after `await init()`, since main.js:79 already ran) and `await wireSerial`; line ordering grep verifies 370 < 386 < 408 |

## Task Commits

Each task was committed atomically:

1. **Task 1: tx-sink.js owner state + setWireOwner/writeSlideFrame** — `1b47a5e` (feat)
2. **Task 2: slide.js dispatcher with 7-byte wakeup matcher** — `f69d980` (feat)
3. **Task 3: serial.js + main.js wiring** — `9bc7648` (feat)

## Files Created/Modified

### Created
- `www/transport/slide.js` (254 lines) — Phase 8 dispatcher. Module-scope state (mode/wakeIdx/scratch/slide/termRef/txSinkRef/SlideCtor/wasmRef) + EVT_*/STATE_* JS-mirror constants + WAKEUP signature + dispatchInbound (terminal/recv branches) + enterRecvMode/exitRecvMode (synchronous mode+owner double-flip) + drainSlideOutbound (Pitfalls 4+5) + slidePumpOnPortLost stub (Phase 11) + __resetForTests/__getStateForTests (Plan 08-04 introspection).
- `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/deferred-items.md` — log of pre-existing session-log filename test/source drift (out of scope per scope boundary rule).

### Modified
- `www/input/tx-sink.js` — added Phase 8 D-08 owner state declaration + 3 new exports (setWireOwner/getWireOwner/writeSlideFrame) + 1 silent-drop guard at top of pushTxBytes body. The existing Phase 4 D-15 ring + Phase 5 D-21 `registeredWriter`/`pushTxBytes`/`registerWriter`/`unregisterWriter` exports + `formatHexStrip`/`registerTxObserver`/`resetTx` are preserved verbatim.
- `www/transport/serial.js` — added `import { dispatchInbound } from './slide.js'` (line 19, after the existing transport-layer imports) + single-line edit at runReadLoop:457 (was line 453 before the import block grew): `term.feed(value)` → `dispatchInbound(value)`. The post-feed invariant lines (sampleBellFn / drainHostReplyFn / requestFrameFn / sessionLogRef.append) at lines 458-466 are unchanged.
- `www/main.js` — extended `import init, { Terminal }` to include `Slide`; extended tx-sink import block to include `setWireOwner / getWireOwner / writeSlideFrame`; added new slide.js import block (`wireSlideDispatcher`, `dispatchInbound`, `__slideResetForTests`, `__slideGetStateForTests`); inserted wireSlideDispatcher call between wireSessionLog (line 370) and await wireSerial (line 408); added `window.__slide` and `window.__txSink` test introspection hooks (mirrors window.__sessionLog precedent).

## Decisions Made

- **Per-session `new Slide()` (Claude's Discretion default).** No Slide::reset() singleton optimization. ~1 KB allocation per session is irrelevant at SLIDE's session cadence (sessions are per-file-batch, not per-byte). enterRecvMode calls `slide.free?.()` on the previous instance via the wasm-bindgen-generated free method if present, then `new SlideCtor()` for a fresh state machine.
- **slide.js does NOT import Slide from pkg/.** The dispatcher accepts the Slide class via `slideCtor` in `wireSlideDispatcher({ slideCtor: Slide, ... })`. This decouples the dispatcher from wasm lifecycle (Pitfall 8 — Slide constructor must run AFTER `await init()` resolves) AND lets Playwright tests inject a mock SlideCtor without monkey-patching the dispatcher module.
- **Drain events to a no-op in Phase 8.** RESEARCH §Open Question 4 recommendation: bounded ring (Phase 7 EVENT_RING_RESERVE = 32) means take_event_packed loop terminates cleanly; Phase 10 attaches the chip event handler. The empty-loop pattern `while (slide.take_event_packed() !== EVT_NONE) { /* drain */ }` is the durable shape — the Phase 10 wire is one-line.
- **`__resetForTests` calls `setWireOwner('terminal')`.** This is a second occurrence of `setWireOwner('terminal')` in slide.js (alongside `exitRecvMode`'s call). The plan text specified `grep -c "setWireOwner('terminal')" returns 1`, but the test-introspection helper MUST reset the owner to 'terminal' to prevent test bleed-through (a test that triggers wakeup but doesn't reach Done would otherwise leave owner='slide' wedged for the next test). The semantic intent of D-09 (synchronous handoff) is preserved; the count drift is a Rule 3 minor deviation favoring testability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Minor] `__resetForTests` includes a `setWireOwner('terminal')` call**

- **Found during:** Task 2 (slide.js implementation per RESEARCH §Code Examples lines 622-643)
- **Issue:** Plan acceptance criteria stated `grep -c "setWireOwner('terminal')" www/transport/slide.js returns 1`, but the verbatim RESEARCH §Code Examples implementation for `__resetForTests` calls `txSinkRef.setWireOwner('terminal')` to prevent test bleed-through. With both `exitRecvMode` AND `__resetForTests` calling it, the grep returns 2.
- **Fix:** Kept both calls — the test-reset call is necessary for correct Plan 08-04 spec semantics (otherwise a wakeup-but-no-Done test wedges the next test). The grep returns 2 instead of 1; the semantic intent of D-09 is preserved (single source-of-truth for the synchronous handoff in production code is `exitRecvMode`).
- **Files modified:** `www/transport/slide.js`
- **Verification:** Both `setWireOwner('terminal')` call sites are guarded — `exitRecvMode` is the production session-end path; `__resetForTests` only runs from Playwright `window.__slide.__resetForTests()` calls. No production code path can hit `__resetForTests`.
- **Committed in:** f69d980 (Task 2 commit)

**2. [Rule 3 - Blocking] Pre-existing session/log-download.spec.js test failures deferred**

- **Found during:** Task 3 verification (regression run on `pnpm playwright test session/`)
- **Issue:** 2/2 tests in `tests/session/log-download.spec.js` (lines 57 + 94) fail with `Expected pattern: /^bestialitty-\d{8}-\d{6}\.bin$/` vs received `beastty-20260507-193104.bin`. Source/test name drift caused by upstream commit `7571ce0` ("Reluctantly retire highly-amusing pun name in favour of 'BeasTTY'") — the source rename in `www/transport/session-log.js:91-99` was not propagated to the test spec.
- **Fix:** Did NOT fix per scope boundary rule — pre-existing failure unrelated to Plan 08-03's dispatcher work. Logged to `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/deferred-items.md` for follow-up.
- **Files affected:** None modified; `deferred-items.md` created with full context for the next plan-checker / phase-verifier.
- **Verification:** Plan 08-03's primary regression suite (transport/readloop + transport/lifecycle + transport/paste + transport/connect + transport/reconnect + 4 input specs + tx-debug-strip) passes 48/48. The dispatcher is byte-transparent in terminal mode — Pitfall 1 mitigation verified empirically across the full Phase 4/5 spec set.
- **Committed in:** 9bc7648 (Task 3 commit, with deferred-items.md noted in commit message)

---

**Total deviations:** 2 auto-fixed (1 minor, 1 blocking-but-out-of-scope)
**Impact on plan:** No scope change. Plan 08-03's success criteria are all met:
- Phase 8 SC#2 (dispatcher transparent in terminal mode + serial.js:453 single-line edit + post-feed invariant preserved) — verified by 48/48 Phase 4/5 regression
- Phase 8 SC#3 partial (wakeup matcher with D-01 + D-02 implementation) — full coverage in Plan 08-04
- Phase 8 SC#4 (TX owner handoff API + pushTxBytes silent-drop on owner==='slide') — full coverage in Plan 08-04
- Phase 8 SC#5 partial (recv-mode lifecycle with synchronous mode + owner flips) — full coverage in Plan 08-04

## Issues Encountered

- **Pre-existing session-log filename drift (deferred):** Tests `session/log-download.spec.js:57` and `:94` fail because they expect `bestialitty-{stamp}.bin` but the source emits `beastty-{stamp}.bin`. This is unrelated to Plan 08-03; logged in `deferred-items.md`.

## User Setup Required

None — Wave 3 is JS-only wiring. Plan 08-04 (Wave 3 Playwright assertions) follows.

## Next Phase Readiness

- **Plan 08-04 (Playwright assertions)** — UNBLOCKED. Every test.skip stub from Plan 08-01 can now drive the dispatcher end-to-end:
  - `window.__slide.__getStateForTests()` returns `{ mode, wakeIdx, hasSlide }` for direct mode + matcher state assertions.
  - `window.__slide.__resetForTests()` resets the dispatcher between tests (no test bleed-through).
  - `window.__txSink.setWireOwner('slide'|'terminal')` flips owner state for tx-sink tests.
  - `window.__txSink.writeSlideFrame([...])` invokes the bypass path for assertion against `__mockWriterLog`.
  - Wakeup tests push the 7-byte `[0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45]` through `window.__mockReaderPush` and assert mode transitions; the existing Phase 5 mock harness pipeline reaches dispatchInbound via `serial.js:runReadLoop:457`.
- **Phase 9 (SLIDE Sender)** — When Phase 9 implements `enter_send_mode(metadata)` on the inner Rust SM, the JS dispatcher gains a `'send'` mode branch in `dispatchInbound` (currently a no-op via the absent-branch fall-through, which is correct for Phase 8). The dispatcher's three-mode shape (`'terminal' | 'recv' | 'send'`) is already declared in the comment.
- **Phase 11 (JS Bridge)** — `slidePumpOnPortLost` exported from slide.js as a Phase 11 stub; Phase 11 will fill the body (cancel any in-flight session, force_idle, hide chip). Wiring is purely additive at that point.

## Threat Surface Scan

No new threat surface beyond what the plan's `<threat_model>` already enumerated. The 8 STRIDE entries (T-08-03-01 through T-08-03-08) are all addressed in code:

- T-08-03-01 (Spoofing — crafted ESC^ prefix): 7-byte signature reduces false-positive rate; partial-match failure replays prefix to term.feed (D-02 critical clause). slide.js:170-184.
- T-08-03-02 (Tampering — replay-on-fail): pending bytes flushed in original order; vte's torn-chunk invariant preserved (matcher swallows all 6 prefix bytes; vte sees the replayed prefix as a fresh chunk). slide.js:172-184.
- T-08-03-03 (Repudiation — mid-session re-entrant wakeup): D-07 forwards spurious wakeup raw to slide.feed_chunk; framer silent-discards. slide.js:dispatchRecvMode:191.
- T-08-03-04 (Information Disclosure — outbound view exposure): drainSlideOutbound slices to JS-owned buffer before writeSlideFrame. slide.js:218.
- T-08-03-05 (DoS — keystroke writes during SLIDE corrupts wire): pushTxBytes early-returns on owner==='slide'; setWireOwner flipped synchronously with mode. tx-sink.js:50; slide.js:228-247.
- T-08-03-06 (DoS — event ring overflow): drainEventsAndOutbound runs every dispatchRecvMode call. slide.js:202-206.
- T-08-03-07 (Elevation of Privilege — owner stuck in 'slide'): exitRecvMode flips both mode AND setWireOwner in single helper; called atomically from maybeExitRecvMode when slide.state ∈ {Done, Error}. slide.js:236-247.
- T-08-03-08 (Tampering — boot-order race): wireSlideDispatcher called BEFORE await wireSerial. main.js:386 < main.js:408 verified by line-ordering grep.

No new threat flags discovered.

## TDD Gate Compliance

This plan's frontmatter declares `type: execute`, not `type: tdd`. The plan-level TDD gate sequence does not apply. Plan 08-01 already shipped the RED gate (27 Playwright stubs); Plan 08-03 is the GREEN gate (the dispatcher + tx-sink + wiring satisfies the stubs). Plan 08-04 will replace `test.skip(true, ...)` with real assertions.

## Verification Evidence

```
$ grep -c "owner === 'slide'" www/input/tx-sink.js
1

$ grep -c "export function setWireOwner\|export function getWireOwner\|export function writeSlideFrame" www/input/tx-sink.js
3

$ test -f www/transport/slide.js && echo EXISTS
EXISTS

$ wc -l www/transport/slide.js
254 www/transport/slide.js

$ grep -c "export function dispatchInbound\|export function wireSlideDispatcher\|export function slidePumpOnPortLost\|export function __resetForTests\|export function __getStateForTests" www/transport/slide.js
5

$ grep -c "0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45" www/transport/slide.js
1

$ grep -c "setWireOwner('slide')" www/transport/slide.js
2

$ grep -c "setWireOwner('terminal')" www/transport/slide.js
2

$ grep -c "value.subarray(i + 1)" www/transport/slide.js
1

$ grep -c "wasmRef.memory.buffer !== outboundBuffer" www/transport/slide.js
1

$ grep -c "new Uint8Array(outboundView.subarray(0, len))" www/transport/slide.js
1

$ grep -c "import { dispatchInbound } from './slide.js'" www/transport/serial.js
1

$ grep -c "dispatchInbound(value)" www/transport/serial.js
1

$ grep -c "term.feed(value)" www/transport/serial.js
0

$ grep -c "sampleBellFn\|drainHostReplyFn\|requestFrameFn\|sessionLogRef.append" www/transport/serial.js
11

$ grep -c "Terminal, Slide" www/main.js
1

$ grep -c "wireSlideDispatcher" www/main.js
2

$ grep -c "slideCtor: Slide" www/main.js
1

$ grep -c "window.__slide\|window.__txSink" www/main.js
3

$ grep -n "wireSessionLog\|wireSlideDispatcher\|await wireSerial" www/main.js | head -10
71:    wireSlideDispatcher,
84:    wireSessionLog,
365:// wireSessionLog owns the chunks-by-reference buffer + Blob download trigger
370:wireSessionLog({ downloadButton: downloadLogBtn });
380:// Phase 8 — wire SLIDE dispatcher AFTER wireSessionLog
386:wireSlideDispatcher({
408:await wireSerial({
# Order verified: 370 (wireSessionLog) < 386 (wireSlideDispatcher) < 408 (await wireSerial)

$ bash scripts/build.sh
... [INFO]: Done in 0.47s; Your wasm pkg is ready

$ cd www && pnpm playwright test transport/readloop.spec.js transport/lifecycle.spec.js paste.spec.js connect.spec.js input/keydown-printable.spec.js input/keydown-arrows.spec.js input/local-echo.spec.js input/tx-debug-strip.spec.js --reporter=list
... 48 passed (8.0s)

$ cargo test -p bestialitty-core
... 240 tests pass across 13 test binaries
```

## Self-Check: PASSED

- File exists: `www/transport/slide.js` (created)
- File exists: `www/input/tx-sink.js` (modified — owner state + setWireOwner/getWireOwner/writeSlideFrame exports)
- File exists: `www/transport/serial.js` (modified — dispatchInbound import + line 457 edit)
- File exists: `www/main.js` (modified — Slide pkg import + wireSlideDispatcher call + window.__slide/window.__txSink)
- File exists: `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-03-SUMMARY.md`
- File exists: `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/deferred-items.md`
- Commit found: `1b47a5e` (Task 1 — tx-sink.js wire-owner state)
- Commit found: `f69d980` (Task 2 — slide.js dispatcher)
- Commit found: `9bc7648` (Task 3 — serial.js + main.js wiring)

---
*Phase: 08-wasm-boundary-js-dispatcher-esc-wakeup*
*Completed: 2026-05-07*
