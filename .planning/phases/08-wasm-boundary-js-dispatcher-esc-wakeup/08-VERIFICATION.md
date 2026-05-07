---
phase: 08-wasm-boundary-js-dispatcher-esc-wakeup
verified: 2026-05-07T21:05:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup — Verification Report

**Phase Goal:** Slide wasm-bindgen exports sibling to Terminal; JS dispatcher routes Web Serial chunks to terminal parser OR SLIDE state machine; 7-byte wakeup detected across chunk boundaries; TX writer ownership handoff
**Verified:** 2026-05-07T21:05:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `Slide` `#[wasm_bindgen]` struct lives in `lib.rs:wasm_boundary` sibling to `Terminal`, with 11 one-line-forwarding methods, and wasm-pack rebuilds without breaking the existing Terminal contract | ✓ VERIFIED | `lib.rs` lines 177-285: `pub struct Slide { inner: CoreSlide }` with `#[wasm_bindgen]` impl block; `use crate::slide::Slide as CoreSlide` at line 39; 11 methods each a one-line `self.inner.METHOD(args)` forward; `cargo test -p bestialitty-core --test slide_wasm_boundary_shape` → 8 passed; `cargo test -p bestialitty-core --test boundary_api_shape` still green |
| 2 | `www/transport/slide.js` dispatcher exports `dispatchInbound`, `wireSlideDispatcher`, `slidePumpOnPortLost`, `__resetForTests`, `__getStateForTests`; `serial.js:runReadLoop` calls `dispatchInbound(value)` (not `term.feed`); post-feed invariant unchanged | ✓ VERIFIED | `slide.js` 254 lines with all 5 exports; `serial.js` line 457: `dispatchInbound(value)` — `grep -c "term.feed(value)"` returns 0; post-feed invariant lines (sampleBellFn / drainHostReplyFn / requestFrameFn / sessionLogRef.append) at lines 458-466 unchanged |
| 3 | 7-byte wakeup `ESC ^ S L I D E` detected across arbitrary chunk-boundary splits; spurious `ESC ^` does NOT trigger SLIDE entry | ✓ VERIFIED | `slide.js`: D-01 `wakeIdx` counter + D-02 `scratch[6]` replay buffer implemented; all 7 torn-chunk split tests pass; benign `ESC ^ A` and `ESC ^ S L X` partial-match tests pass with matcher state reset; reprocess-from-idx-0 (`ESC ^ ESC ^ S L I D E`) test passes — 13/13 wakeup Playwright tests green |
| 4 | `tx-sink.js` gains `setWireOwner('slide')` that silently drops `pushTxBytes`; SLIDE writes via `writeSlideFrame` that bypasses the keystroke ring; invalid owner throws | ✓ VERIFIED | `tx-sink.js` line 50: `if (owner === 'slide') return;`; lines 105-126: `setWireOwner` with validation throw, `getWireOwner`, `writeSlideFrame` that writes direct via `registeredWriter`; 6/6 tx-sink Playwright tests green |
| 5 | Detected wakeup transitions BestialiTTY into receive mode: terminal parser suspended, SLIDE owns wire, `dispatchInbound` feeds bytes after signature to SLIDE only | ✓ VERIFIED | `slide.js`: `enterRecvMode()` flips `mode='recv'` AND `setWireOwner('slide')` synchronously (D-09 Pitfall-3 guard); `value.subarray(i + 1)` skips signature bytes (Pitfall-2 off-by-one); `dispatchRecvMode` straight pass-through (D-07); 7 dispatcher routing Playwright tests cover pass-through + recv lifecycle + session-end double-flip |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `crates/bestialitty-core/src/lib.rs` | Phase 8 `Slide` `#[wasm_bindgen]` façade alongside Terminal | ✓ VERIFIED | `pub struct Slide` with 11 methods present at lines 177-285; `use crate::slide::Slide as CoreSlide` alias resolves name collision |
| `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` | Compile-time fn-pointer pin for 11 Phase 8 wasm-façade methods + EVT_* + SlideState repr(u32) | ✓ VERIFIED | 8 `#[test]` functions covering constructor, lifecycle methods, feed methods, state accessor, outbound accessors, SlideState repr, EVT_* constants, and runtime callable check |
| `www/transport/slide.js` | SLIDE dispatcher: 7-byte wakeup matcher + terminal/recv routing + zero-copy outbound drain | ✓ VERIFIED | 254 lines; `WAKEUP = new Uint8Array([0x1B, 0x5E, 0x53, 0x4C, 0x49, 0x44, 0x45])`; D-01 `wakeIdx` counter; D-02 `scratch` backing buffer + replay; D-11 zero-copy drain with Pitfall-4 memory-growth guard |
| `www/input/tx-sink.js` | Phase 8 wire-owner handoff extensions | ✓ VERIFIED | `let owner = 'terminal'` at line 42; `setWireOwner` / `getWireOwner` / `writeSlideFrame` exports at lines 105-126; `pushTxBytes` early-return guard at line 50 |
| `www/transport/serial.js` | Single-line D-06 edit: `term.feed(value)` → `dispatchInbound(value)` | ✓ VERIFIED | Line 457: `dispatchInbound(value)`; `grep -c "term.feed(value)"` returns 0; import `{ dispatchInbound }` from `'./slide.js'` at line 19 |
| `www/main.js` | Boot wiring: `wireSlideDispatcher` called after `wireSessionLog` and before `await wireSerial`; `window.__slide` + `window.__txSink` introspection hooks | ✓ VERIFIED | `wireSlideDispatcher` call at line 386; order: line 370 (wireSessionLog) < 386 (wireSlideDispatcher) < 408 (await wireSerial); `window.__slide` and `window.__txSink` assigned at lines 397-402 |
| `www/tests/transport/slide-wakeup.spec.js` | 13 real wakeup assertions covering all 7 splits + benign + D-02 critical clause | ✓ VERIFIED | 13 `test(...)` functions, 0 `test.skip`; full-match, 6 torn-chunk splits, benign-ESC^A, benign-mid-match-X, reprocess-from-idx-0, isolated-caret, isolated-ESC |
| `www/tests/transport/slide-dispatcher.spec.js` | 7 dispatcher routing assertions covering SC#2/SC#5 | ✓ VERIFIED | 7 `test(...)` functions, 0 `test.skip`; terminal pass-through, post-feed BEL, post-feed ESC-Z, recv-mode routing, D-07 mid-stream passthrough, Pitfall-2 chunk-tail, session-end |
| `www/tests/input/tx-sink.spec.js` | 6 wire-owner handoff assertions covering SC#4 | ✓ VERIFIED | 6 `test(...)` functions, 0 `test.skip`; default-owner, silent-drop, restore, writeSlideFrame bypass, writeSlideFrame via writer, invalid-owner throws |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib.rs:wasm_boundary` | `crates/bestialitty-core/src/slide/state.rs` | `use crate::slide::Slide as CoreSlide; self.inner.METHOD()` | ✓ WIRED | `grep "use crate::slide::Slide as CoreSlide"` returns 1; all 11 method bodies confirmed one-line forwards |
| `www/transport/serial.js:runReadLoop` | `www/transport/slide.js` | `import { dispatchInbound } from './slide.js'` at line 19; called at line 457 | ✓ WIRED | `grep -c "dispatchInbound(value)"` returns 1; `grep -c "term.feed(value)"` returns 0 — the old call is gone |
| `www/transport/slide.js` | `www/input/tx-sink.js` | `txSinkRef.setWireOwner('slide'|'terminal')` in `enterRecvMode`/`exitRecvMode`; `txSinkRef.writeSlideFrame(owned)` in `drainSlideOutbound` | ✓ WIRED | `grep -c "setWireOwner"` returns 4 in slide.js (2 production + 2 reset paths); `grep -c "writeSlideFrame"` returns 1 |
| `www/main.js` | `www/transport/slide.js` | `import { wireSlideDispatcher, ... }` + `wireSlideDispatcher({ term, txSink, slideCtor: Slide, wasm })` | ✓ WIRED | `grep -c "wireSlideDispatcher"` returns 2 in main.js (import + call); `slideCtor: Slide` passes the wasm-imported class |
| `www/tests/transport/slide-wakeup.spec.js` | `www/transport/slide.js` | `window.__slide.__getStateForTests()` / `window.__slide.__resetForTests()` | ✓ WIRED | Tests drive the dispatcher via `window.__mockReaderPush`; introspect state via `window.__slide`; all 13 tests pass |

### Data-Flow Trace (Level 4)

Phase 8 does not render dynamic data to a UI component — the dispatcher routes bytes to the Rust state machine. The relevant data flows are:

| Data Flow | Source | Produces Real Data | Status |
|-----------|--------|-------------------|--------|
| Web Serial bytes → `dispatchInbound` → `termRef.feed` (terminal mode) | `serial.js:runReadLoop` reads from `reader.read()` | Yes — live byte stream | ✓ FLOWING |
| Web Serial bytes → `dispatchInbound` → `slide.feed_chunk` (recv mode) | Same read loop, after `mode === 'recv'` | Yes — live byte stream | ✓ FLOWING |
| `slide.outbound_ptr/len` → `drainSlideOutbound` → `writeSlideFrame` | Wasm memory buffer, zero-copy view | Yes — real SM output | ✓ FLOWING |
| `pushTxBytes` silent-drop during `owner === 'slide'` | `tx-sink.js` owner state | Real owner state | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Rust boundary shape pin (8 tests) | `cargo test -p bestialitty-core --test slide_wasm_boundary_shape` | 8 passed | ✓ PASS |
| Rust slide lib tests (36 tests) | `cargo test -p bestialitty-core --lib slide` | 36 passed | ✓ PASS |
| Phase 8 Playwright suite (26 tests) | `pnpm playwright test transport/slide-wakeup.spec.js transport/slide-dispatcher.spec.js input/tx-sink.spec.js` | 26 passed (4.5-5.2s) | ✓ PASS |
| No test.skip stubs remaining | `grep -c "test.skip"` across 3 spec files | 0 each | ✓ PASS |
| D-06 single-line edit complete | `grep -c "term.feed(value)" www/transport/serial.js` | 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SLIDE-05 | 08-01, 08-02, 08-03, 08-04 | JS dispatcher routes chunks to terminal parser OR SLIDE based on session mode; detects 7-byte wakeup across chunk boundaries | ✓ SATISFIED | `www/transport/slide.js:dispatchInbound`; REQUIREMENTS.md `[x]` + traceability table "Complete"; 7 dispatcher tests pass |
| SLIDE-06 | 08-01, 08-02, 08-03, 08-04 | TX writer ownership handoff — `setWireOwner('slide')` blocks `pushTxBytes`; `writeSlideFrame` bypasses keystroke ring | ✓ SATISFIED | `tx-sink.js` lines 42-126; REQUIREMENTS.md `[x]` + traceability "Complete"; 6 tx-sink tests pass |
| SLIDE-17 | 08-01, 08-02, 08-03, 08-04 | BestialiTTY detects 7-byte wakeup `ESC ^ S L I D E` and enters receive mode | ✓ SATISFIED | `slide.js` D-01+D-02 matcher; REQUIREMENTS.md `[x]` + traceability "Complete"; 13 wakeup tests pass (all 7 internal splits + benign + D-02 critical clause) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `www/transport/slide.js` | 100-103 | `slidePumpOnPortLost` is a no-op stub | ℹ️ Info | Intentional Phase 11 placeholder; explicitly exported now for additive wiring later; commented as such |

No blockers or warnings found. The `slidePumpOnPortLost` no-op is the only stub and is an intentional Phase 11 scope deferral documented in both the context file and the code comment.

### Human Verification Required

None. All Phase 8 success criteria are verified programmatically via cargo tests and Playwright assertions.

### Gaps Summary

No gaps. All 5 success criteria are met:

1. **SC#1 (Wasm boundary):** `Slide` `#[wasm_bindgen]` struct with 11 methods in `lib.rs:wasm_boundary`; compile-time pin in `tests/slide_wasm_boundary_shape.rs` (8 tests pass); wasm-pack bundle regenerated exposing `class Slide`.

2. **SC#2 (Dispatcher):** `www/transport/slide.js` with `dispatchInbound`; single-line edit at `serial.js:457`; post-feed invariant preserved; terminal-mode byte-transparent (Pitfall 1); boot order correct (D-09 / Pitfall 8).

3. **SC#3 (Wakeup detection):** D-01 match-index counter + D-02 replay-on-fail with re-process-current-byte clause; all 7 torn-chunk splits pass; spurious `ESC ^` non-trigger verified; D-02 critical clause (`ESC ^ ESC ^ S L I D E`) verified.

4. **SC#4 (TX handoff):** `tx-sink.js` owner state + `setWireOwner` + `writeSlideFrame` + `pushTxBytes` silent-drop guard; synchronous handoff (D-09 Pitfall-3 wedge prevention).

5. **SC#5 (Recv mode entry):** `enterRecvMode` / `exitRecvMode` flip both `mode` and wire-owner atomically; `dispatchRecvMode` straight pass-through (D-07); session-end double-flip verified by Playwright.

---

_Verified: 2026-05-07T21:05:00Z_
_Verifier: Claude (gsd-verifier)_
