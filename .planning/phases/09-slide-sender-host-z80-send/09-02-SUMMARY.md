---
phase: 09-slide-sender-host-z80-send
plan: 02
subsystem: slide-sender-wasm-boundary-and-js-shell
tags:
  - rust
  - wasm-bindgen
  - js
  - dispatcher
  - tx-sink
  - phase-9
requirements:
  partial:
    - SLIDE-13
dependency_graph:
  requires:
    - 09-01 sender Rust core (enter_send_mode + feed_send_chunk + EVT_FILE_COMPLETE/SESSION_COMPLETE/RETRANSMIT_NEEDED + OUTBOUND_RESERVE = 4128)
    - phase-8 wasm boundary (lib.rs:wasm_boundary Slide façade) — extended in this plan
    - phase-8 JS dispatcher (www/transport/slide.js) — extended in this plan
    - phase-8 tx-sink owner gate (www/input/tx-sink.js) — extended in this plan
  provides:
    - Wasm-bindgen Slide.enter_send_mode + Slide.feed_send_chunk (one-line forwards per ADR-002)
    - Boundary-shape mirror pin tests/slide_wasm_boundary_shape.rs (sender fn-pointer + 3 new EVT_* asserts)
    - tx-sink writeSlideFrameAwaitable export with PITFALLS §4 backpressure idiom
    - slide.js enterSendMode public entry + dispatchSendMode + drainSlideOutboundAwaitable + pumpNextDataChunkIfReady
    - slide.js EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE / EVT_RETRANSMIT_NEEDED mirror constants
    - slide.js OUTBOUND_VIEW_CAP = 4128 (lockstep with Rust OUTBOUND_RESERVE)
    - main.js boot wiring window.__slide.enterSendMode + window.__txSink.writeSlideFrameAwaitable
  affects:
    - 09-03 file-source.js (will call enterSendMode({ files }) after rewrite/rejection modal)
    - 09-04 Playwright sender suite (will assert auto-type-before-wakeup + per-file pump + EVT_*/STATE_* surfaces)
    - 10-* receiver phase (D-13 wakeup-completion clause shape now branches on pendingSendSession; receiver path remains unchanged)
tech-stack:
  added: []
  patterns:
    - one-line wasm-bindgen forwards in lib.rs (ADR-002 single-rule, no logic in façade)
    - dispatcher-driven sender main loop (Pitfall 4 RECOMMENDED FIX) — feed → drain → pump → drain → maybeExit
    - awaitable backpressure idiom (await writer.ready; await writer.write) — PITFALLS §4 single legitimate pattern
    - depth-1 pendingSendSession with last-write-wins clobbering (CONTEXT Claude's-Discretion default)
    - JS-holds-payload NAK retransmit (Pitfall 6 Option A — re-derive chunk from fileBytes on EVT_RETRANSMIT_NEEDED)
    - slice-before-await outbound view (Pitfall 5 — new Uint8Array(view.subarray(0, len)) BEFORE await writer.write)
    - lockstep OUTBOUND_RESERVE / OUTBOUND_VIEW_CAP at 4128 (Pitfall 1 — Rust pin test absorbs 4 max frames; JS view cap matches)
    - module-private packMetadataInline in slide.js (Plan 09-03 will move to file-source.js)
key-files:
  created: []
  modified:
    - crates/bestialitty-core/src/lib.rs
    - crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs
    - www/input/tx-sink.js
    - www/tests/input/tx-sink.spec.js
    - www/transport/slide.js
    - www/main.js
decisions:
  - Plan 09-02 implements CONTEXT D-13 / D-14 / D-16 / D-17 / D-18 verbatim
  - lib.rs façade body is two one-line forwards into self.inner.enter_send_mode(metadata) and self.inner.feed_send_chunk(payload, eof) — ADR-002 single-rule
  - Boundary-shape pin lives in tests/slide_wasm_boundary_shape.rs (mirror of slide_boundary_shape.rs Plan 09-01 pin)
  - writeSlideFrameAwaitable bypasses owner gate (mirror of writeSlideFrame Phase 8 pattern) — sender's own writes are not subject to the silent-drop owner gate
  - Sender entry point wraps depth-1 pendingSendSession; auto-type uses pushTxBytes (NOT setWireOwner('slide') first) per Pitfall 3 order-critical
  - packMetadataInline lives in slide.js for Plan 09-02 self-containment; Plan 09-03 will move to file-source.js (per CONTEXT Claude's-Discretion default)
  - dispatchSendMode is async + fire-and-forget from dispatchInbound (mirrors Phase 8 dispatchRecvMode shape but with awaitable drain steps)
  - Wakeup-completion clause uses guarded if/else — pendingSendSession branch consumes the queued metadata, else fall through to enterRecvMode (Phase 8 receiver path preserved verbatim)
  - Tail-handling block in dispatchTerminalMode now branches on mode === 'send' (post-flip) — receiver tail forwarding via feedSlide+drainEventsAndOutbound+maybeExitRecvMode unchanged
metrics:
  duration: 9min
  completed: 2026-05-08
  tasks_completed: 3
  commits: 4 (1 test pin + 3 feat)
  files_changed: 6 (all modified)
  tests_added: 4 Rust assertions (1 fn-pointer pin + 3 EVT_* asserts) + 3 Playwright tests
---

# Phase 9 Plan 02: Sender Wasm Boundary + JS Plumbing Summary

**One-liner:** Phase 9's JS-shell glue plan — wasm-bindgen `Slide.enter_send_mode` + `Slide.feed_send_chunk` one-line forwards in `lib.rs`, boundary-shape mirror pin, `writeSlideFrameAwaitable` PITFALLS §4 idiom in tx-sink, and a 340-line slide.js extension delivering `enterSendMode({ files })` + `dispatchSendMode` + per-file pump + EVT_*/STATE_* mirrors + `OUTBOUND_VIEW_CAP = 4128` so an external test can drive a SLIDE sender lifecycle programmatically with no UI.

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-08T01:00:20Z
- **Completed:** 2026-05-08T01:09:25Z
- **Tasks:** 3 (all autonomous, all TDD)
- **Files modified:** 6 (no files created)

## Accomplishments

- Wasm boundary in `lib.rs:wasm_boundary` extended with two one-line forwards (`enter_send_mode` + `feed_send_chunk`) — `www/pkg/bestialitty_core.d.ts` now exports `enter_send_mode(metadata: Uint8Array): void` and `feed_send_chunk(payload: Uint8Array, eof: boolean): void`.
- Boundary-shape mirror in `tests/slide_wasm_boundary_shape.rs` extended with the new sender fn-pointer pin (`slide_send_methods_have_stable_signatures`) and three new EVT_* assertions (>>16 = 8/9/10) so any drift fails native cargo test before wasm-pack would.
- `writeSlideFrameAwaitable` exported from `www/input/tx-sink.js` with the verbatim `await writer.ready; await writer.write(bytes)` PITFALLS §4 idiom; throws (not log+return) on no-writer, and rejection propagates so the sender main loop can transition the SM to Error.
- `www/transport/slide.js` extended with the full sender plumbing (depth-1 `pendingSendSession`, `enterSendMode({ files })` public entry, dispatcher-driven sender main loop `dispatchSendMode`, awaitable drain, per-file pump, NAK retransmit, EVT_*/STATE_* mirror constants, `OUTBOUND_VIEW_CAP = 4128`, `__resetForTests` + `__getStateForTests` Phase 9 D-18 introspection extensions).
- `www/main.js` boot wiring extended so `window.__slide.enterSendMode` and `window.__txSink.writeSlideFrameAwaitable` are reachable from Plan 09-04 Playwright `page.evaluate()`.

## Task Commits

Each task committed atomically:

1. **Task 1 (RED):** Boundary-shape mirror — `9cb8c0c` (test)
2. **Task 1 (GREEN):** Wasm façade forwards — `04ff1b0` (feat)
3. **Task 2:** writeSlideFrameAwaitable + Playwright tests — `5293964` (feat)
4. **Task 3:** slide.js sender plumbing + main.js boot wiring — `2277839` (feat)

_Note: Task 1 is a single TDD task; the test file was already passing against the Plan 09-01 inner API (the `enter_send_mode` / `feed_send_chunk` methods exist on `crate::slide::Slide`). The "RED" gate for Task 1 was really `bash scripts/build.sh` proving the new methods land in `.d.ts` only after the lib.rs edit — verified after the GREEN commit._

## Files Created/Modified

- `crates/bestialitty-core/src/lib.rs` — Two one-line `#[wasm_bindgen]` forwards inside the existing `impl Slide` block (sibling to `enter_recv_mode` and `feed_chunk`). ADR-002 single-rule preserved.
- `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — Mirror extension of Plan 09-01's pins on `tests/slide_boundary_shape.rs`: import the three new EVT_* constants, add `slide_send_methods_have_stable_signatures` fn-pointer pin, extend `slide_event_constants_pinned_for_phase_8_jsmirror` with three new EVT_* asserts, extend `slide_phase8_wasm_facade_surface_runtime_callable` with sender API runtime-reachability check.
- `www/input/tx-sink.js` — Append `export async function writeSlideFrameAwaitable(bytes)` after the existing `writeSlideFrame`. Existing `writeSlideFrame` / owner gate / `pushTxBytes` / `setWireOwner` UNCHANGED.
- `www/tests/input/tx-sink.spec.js` — Append a new `test.describe('SLIDE-13 — writeSlideFrameAwaitable backpressure idiom')` block with 3 tests covering happy-path, no-writer-throw, and writer-reject-propagation.
- `www/transport/slide.js` — Largest change (340 lines): EVT_* mirror additions, `pushTxBytes` import, `OUTBOUND_VIEW_CAP` 16→4128, Phase 9 module-scope state (`pendingSendSession`, `currentSendCtx`, `AUTO_SEND_COMMAND`, `FRAME_SIZE`), `dispatchInbound` 'send' branch, wakeup-completion-clause D-13 branch, tail-handling 'send' branch, new exports + functions (`enterSendMode`, `packMetadataInline`, `enterSendModeInternal`, `exitSendMode`, `dispatchSendMode`, `drainEventsAndOutboundAwaitable`, `drainSlideOutboundAwaitable`, `pumpNextDataChunkIfReady`, `maybeExitSendMode`), `__resetForTests` + `__getStateForTests` D-18 extensions.
- `www/main.js` — Import `enterSendMode as enterSlideSendMode` + `writeSlideFrameAwaitable`. Pass `writeSlideFrameAwaitable` in `wireSlideDispatcher.txSink` opts. Add `enterSendMode: enterSlideSendMode` to `window.__slide`. Add `writeSlideFrameAwaitable` to `window.__txSink`.

## Verification Results

| Command | Result |
|---------|--------|
| `cargo test --workspace` | **258 tests, all green** (165 lib + 20 + 5 + 3 + 8 + 11 + 6 + 13 + 6 + 8 + 9 + 4) |
| `cargo test --test core_02_no_browser_deps` | **3/3 green** (no `std::time` / `web_sys` / `js_sys` introduced; lib.rs wasm-bindgen exemption preserved) |
| `cargo test --test slide_wasm_boundary_shape` | **9/9 green** (8 prior + 1 new `slide_send_methods_have_stable_signatures`) |
| `bash scripts/build.sh` | **exits 0**; `www/pkg/bestialitty_core.d.ts` gains `enter_send_mode(metadata: Uint8Array): void` + `feed_send_chunk(payload: Uint8Array, eof: boolean): void`; `www/pkg/bestialitty_core.js` gains `slide_enter_send_mode` + `slide_feed_send_chunk` wasm-export wrappers |
| `cd www && npm run test:fast` | **65/65 green** (Phase 8 dispatcher / wakeup / tx-sink existing specs + 3 new writeSlideFrameAwaitable tests) |
| `cd www && npx playwright test ... -g writeSlideFrameAwaitable` | **3/3 green** in isolation (happy path + no-writer-throw + writer-reject-propagation) |

**Acceptance-criteria grep checks (all PASS):**
- `grep -c 'pub fn enter_send_mode' crates/bestialitty-core/src/lib.rs` → 1
- `grep -c 'pub fn feed_send_chunk' crates/bestialitty-core/src/lib.rs` → 1
- `grep -c 'self.inner.enter_send_mode' crates/bestialitty-core/src/lib.rs` → 1
- `grep -c 'self.inner.feed_send_chunk' crates/bestialitty-core/src/lib.rs` → 1
- `grep -c 'slide_send_methods_have_stable_signatures' crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` → 2
- `grep -c 'EVT_FILE_COMPLETE' crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` → 4
- `grep -c 'enter_send_mode' www/pkg/bestialitty_core.d.ts` → 2
- `grep -c 'feed_send_chunk' www/pkg/bestialitty_core.d.ts` → 2
- `grep -c 'export async function writeSlideFrameAwaitable' www/input/tx-sink.js` → 1
- `grep -c 'export function writeSlideFrame(' www/input/tx-sink.js` → 1 (existing fire-and-forget UNCHANGED)
- `grep -c 'export function enterSendMode' www/transport/slide.js` → 1
- `grep -c 'function enterSendModeInternal' www/transport/slide.js` → 1
- `grep -c 'function exitSendMode' www/transport/slide.js` → 1
- `grep -c 'async function dispatchSendMode' www/transport/slide.js` → 1
- `grep -c 'async function drainSlideOutboundAwaitable' www/transport/slide.js` → 1
- `grep -c 'function pumpNextDataChunkIfReady' www/transport/slide.js` → 1
- `grep -c 'function maybeExitSendMode' www/transport/slide.js` → 1
- `grep -c 'OUTBOUND_VIEW_CAP = 4128' www/transport/slide.js` → 1
- `grep -c 'pendingSendSession' www/transport/slide.js` → 12 (≥5)
- `grep -c 'currentSendCtx' www/transport/slide.js` → 17 (≥4)
- `grep -c "if (mode === 'send')" www/transport/slide.js` → 2
- `grep -c 'enterSendModeInternal(pendingSendSession)' www/transport/slide.js` → 1
- `grep -c 'pushTxBytes(AUTO_SEND_COMMAND)' www/transport/slide.js` → 2 (1 call site + 1 comment)
- `grep -c 'enterSendMode as enterSlideSendMode' www/main.js` → 1
- `grep -c 'writeSlideFrameAwaitable' www/main.js` → 5 (≥2)
- `grep -c 'enterSendMode: enterSlideSendMode' www/main.js` → 1

**Pitfall 3 order-critical inspection:** Line 379 (`pushTxBytes(AUTO_SEND_COMMAND)`) appears BEFORE line 383 (`pendingSendSession = { metadata, fileBytes }`) in `enterSendMode`. Reverse-order would silently drop the auto-type bytes via the owner='slide' gate; the wakeup match could then never trigger because `B:SLIDE R\r` never reached the Z80.

## Decisions Made

- **lib.rs forwards are mechanical, no logic.** ADR-002 single-rule: `pub fn METHOD(args) { self.inner.METHOD(args); }`. wasm-bindgen automatically maps `&[u8]` → `Uint8Array` and `bool` → `boolean` in TypeScript.
- **`writeSlideFrameAwaitable` throws on no-writer; `writeSlideFrame` logs+returns.** The fire-and-forget primitive serves short control-byte writes (CTRL_RDY, CTRL_ACK, CTRL_CAN echo) where backpressure gating is not load-bearing; the awaitable primitive serves multi-frame data window writes where the sender main loop wants to know about port-lost / EPIPE so it can transition the SM to Error rather than silently stalling.
- **`writeSlideFrameAwaitable` bypasses the owner gate.** Like the existing `writeSlideFrame`, the awaitable variant is the sender's own write path; gating it on `owner === 'slide'` would deadlock the SM (sender writes blocked by the same flag the sender just set).
- **`packMetadataInline` lives in slide.js for Plan 09-02 self-containment.** Plan 09-03 introduces file-source.js; per CONTEXT Claude's-Discretion default, the packer will move to file-source.js. Until then, slide.js owns the LE blob construction (`<u32 file_count>` + per-file `<u32 name_len><name><u32 size>`).
- **`AUTO_SEND_COMMAND` is a hardcoded const Uint8Array.** D-14 LOCKED. Phase 11 SLIDE-37 makes it prefs-driven via `prefs.slideAutoSendCommand`; the empty-string-disables code path (`if (AUTO_SEND_COMMAND.length > 0) pushTxBytes(...)`) is preserved here for that future plug-in. Threat-model T-09-02-01 references this as the substantive defense surface.
- **`dispatchSendMode` is async + fire-and-forget from `dispatchInbound`.** Mirror of `dispatchRecvMode` but with awaitable drain steps. The async chain inside `dispatchSendMode` (`feedSlide → await drain → pumpNextDataChunkIfReady → await drain → maybeExitSendMode`) preserves serialization within a single inbound RX chunk; cross-chunk concurrency is impossible because the read loop in serial.js awaits each chunk before reading the next.
- **JS holds the ground-truth payload for NAK retransmit (Pitfall 6 Option A).** On `EVT_RETRANSMIT_NEEDED | seq`, JS re-derives the chunk for that seq from `currentSendCtx.fileBytes[idx]` rather than relying on a buffered Rust-side copy. This keeps the Rust SM's outbound buffer at exactly 4 frames (Pitfall 1 reserve) without needing additional retransmit slots.
- **Wakeup-completion clause uses if/else, not else-if.** `if (pendingSendSession) enterSendModeInternal(...); else enterRecvMode();`. Simpler control flow than else-if, and Phase 8's receiver-mode test specs continue to exercise the `else` branch unchanged.

## Deviations from Plan

None — plan executed exactly as written. All TDD cycles (RED/GREEN) ran clean; no auto-fixes needed; no Rule 1/2/3/4 deviations.

The two `npm run test:fast` runs surfaced a pre-existing flake in `tests/input/focus-retention.spec.js` (theme-toggle test failed with `data-theme="crt"` instead of `"clean"` — pre-existing parallel-execution / localStorage prefs pollution unrelated to Plan 09-02 changes). Re-running the full suite produced 65/65 green; the new tx-sink writeSlideFrameAwaitable tests pass deterministically in isolation. Logged as inherited flake, not a Plan 09-02 regression.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

**Hard-reload requirement (per MEMORY.md `project_wasm_cache_workflow`):** After `bash scripts/build.sh`, dev-server users MUST hard-reload the browser tab (Ctrl+Shift+R) to pick up the new wasm exports. Soft reload serves stale wasm — Slide.enter_send_mode / Slide.feed_send_chunk would be `undefined` even though the source has been rebuilt. This applies to anyone resuming dev work on this branch.

## Pitfalls Addressed

- **Pitfall 1 (OUTBOUND_RESERVE / OUTBOUND_VIEW_CAP lockstep):** Both at 4128 bytes (4 max-size frames * 1030 + 8 byte slack). Plan 09-01's `outbound_ptr_stable_across_sender_window_pushes` test proves the Rust reserve absorbs 4 frames without realloc; this plan's `OUTBOUND_VIEW_CAP = 4128` matches it.
- **Pitfall 3 (auto-type order-critical):** `pushTxBytes(AUTO_SEND_COMMAND)` line 379 BEFORE `pendingSendSession = { metadata, fileBytes }` line 383 in `enterSendMode`. Reverse order would silently drop the auto-type bytes (owner='slide' silent-drop in pushTxBytes). Verified by line-number inspection.
- **Pitfall 4 (dispatcher-driven serialization):** No parallel sender main loop. `dispatchSendMode` is the sole driver, mirroring `dispatchRecvMode`. The async chain (feed → drain → pump → drain → maybeExit) runs serially per inbound RX chunk.
- **Pitfall 5 (slice-before-await):** `drainSlideOutboundAwaitable` calls `new Uint8Array(view.subarray(0, len))` (slice copy) BEFORE `await writer.write(owned)`. A concurrent wasm memory growth would not strand the byte serialization.
- **Pitfall 6 (NAK retransmit Option A):** JS holds `currentSendCtx.fileBytes`; on `EVT_RETRANSMIT_NEEDED | seq`, the handler re-derives the chunk via `(seq - 1) * FRAME_SIZE` and re-feeds via `slide.feed_send_chunk(payload, isEof)`. Bounds-checked via `if (chunkStart < file.length)` (T-09-02-04 mitigation).

## Self-Check: PASSED

- File `crates/bestialitty-core/src/lib.rs` exists and contains `pub fn enter_send_mode` + `pub fn feed_send_chunk` (verified)
- File `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` exists and contains `slide_send_methods_have_stable_signatures` (verified)
- File `www/input/tx-sink.js` exists and contains `export async function writeSlideFrameAwaitable` (verified)
- File `www/transport/slide.js` exists and contains `export function enterSendMode` + `OUTBOUND_VIEW_CAP = 4128` + all required functions (verified)
- File `www/main.js` exists and exposes `window.__slide.enterSendMode` + `window.__txSink.writeSlideFrameAwaitable` (verified)
- Commits `9cb8c0c` (test), `04ff1b0` (feat), `5293964` (feat), `2277839` (feat) all present in `git log` (verified)
- `cargo test --workspace` exits 0 — 258 tests green (verified)
- `cargo test --test slide_wasm_boundary_shape` exits 0 — 9/9 green (verified)
- `cargo test --test core_02_no_browser_deps` exits 0 — 3/3 green (verified)
- `bash scripts/build.sh` exits 0 — `.d.ts` contains both new methods (verified)
- `cd www && npm run test:fast` exits 0 — 65/65 green (verified — pre-existing focus-retention flake passes on retry)
- New writeSlideFrameAwaitable Playwright tests (3) all green in isolation (verified)
- All acceptance-criteria grep counts pass (verified above)
- Pitfall 3 order-critical line ordering verified by inspection

## Plan 09-03 Unblocked

Plan 09-03 (file-source.js sender dispatcher + drag-drop UI) can now begin. The JS-side primitives it needs are all live:
- `window.__slide.enterSendMode({ files })` — pass `[{ name, bytes }, ...]` to kick off a session
- `window.__txSink.writeSlideFrameAwaitable(bytes)` — backpressure-gated send (used internally by slide.js's drain)
- `slide.enter_send_mode(metadata)` + `slide.feed_send_chunk(payload, eof)` — wasm-bindgen surface for any custom drivers
- `__getStateForTests()` exposes Phase 9 D-18 introspection (`state`, `file_idx`, `total_files`, `bytes_in_file_done`, `bytes_in_file_total`) for Plan 09-04 Playwright assertions

The `packMetadataInline` helper currently lives in slide.js for self-containment; Plan 09-03 will move it to file-source.js per CONTEXT Claude's-Discretion default and import it from there. The slide.js public surface (`enterSendMode({ files })`) is stable and will not change.

Plan 09-04 Playwright sender suite needs the Plan 09-04-specific MockReceiver bot extension (echo handler that returns CTRL_RDY → ACK(0) → ACK(eof_seq) → FIN sequences). All the surface it asserts against (`window.__slide.enterSendMode`, `window.__mockWriterLog`, `window.__mockReaderPush`, `window.__slide.__getStateForTests`) is in place after this commit.

---
*Phase: 09-slide-sender-host-z80-send*
*Plan: 02*
*Completed: 2026-05-08*
