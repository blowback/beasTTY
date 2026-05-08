---
phase: 10-slide-receiver-cancellation
plan: 03
subsystem: slide-recv
tags: [js, slide-recv, cancel, dispatcher, keyboard, boot-wiring, adr-003]

# Dependency graph
requires:
  - phase: 10-slide-receiver-cancellation
    provides: "Plan 10-01 Rust accessors + EVT_HEADER_RECEIVED/EVT_RECV_DATA/EVT_RECV_FILE_DONE constants pinned by slide_boundary_shape.rs + slide_wasm_boundary_shape.rs; Plan 10-02 slide-recv.js skeleton (cancelSlideRecv STUB + slidePumpOnPortLost STUB + recoverHardFail STUB) + idb.js + slideRecvToFolder pref default"
  - phase: 09-slide-sender-host-z80-send
    provides: "wireSlideDispatcher boot wiring + dispatchInbound recv-mode 5-line straight-pass dispatcher + Phase 9 EVT_FILE_COMPLETE/SESSION_COMPLETE/RETRANSMIT_NEEDED constants pattern"
  - phase: 08-wasm-boundary-js-dispatcher-esc-wakeup
    provides: "dispatchTerminalMode 7-byte WAKEUP matcher template (mirror Pattern 9 used here) + setWireOwner('terminal') / writeSlideFrame / outbound-buffer drain pattern + Slide #[wasm_bindgen] facade"
  - phase: 07-slide-rust-core-framer-crc-state-machine
    provides: "slide.cancel() + slide.force_idle() idempotent operations (D-06 / D-07) + ADR-003 §3 escape hatch semantics + recv_buf accessors"
  - phase: 06-daily-driver-polish-session-deployment
    provides: "Phase 6 D-19 selection-drag-cancel arm in keyboard.js Esc chain (insertion target for the new SLIDE-cancel arm)"
  - phase: 05-web-serial-transport
    provides: "Phase 5 D-18 paste-pump cancel arm in keyboard.js Esc chain (existing slot 2 → pushed to slot 3) + tx-sink writeSlideFrame writer-locked single-byte fire-and-forget"
provides:
  - "ADR-003 §3 cancel state machine: 5-step CTRL_CAN sequence (200/500/100/2000 ms) replaces Plan 10-02 STUB"
  - "drainSlideOutboundOneShot + waitForState + forceExitRecvMode helpers in slide-recv.js"
  - "slidePumpOnPortLost real impl (T-10-port-lost mitigation; 5-line minimum per CONTEXT Discretion)"
  - "recoverHardFail 3-mode convergence real impl (T-10-hard-fail mitigation: NAK budget / port lost / wire desync)"
  - "MAX_FILE_SIZE breach hard-fail integration (slide.cancel + recoverHardFail)"
  - "slide.js dispatchRecvMode rewritten with mid-session ESC^SLIDE re-entry matcher (T-10-03 mitigation; Pattern 9 verbatim)"
  - "slide.js drainEventsAndOutbound dispatches EVT_HEADER_RECEIVED / EVT_RECV_DATA / EVT_RECV_FILE_DONE to slide-recv onRecvEvent"
  - "slide.js EVT_* mirror gains 3 new constants + EVT_NONE exported"
  - "slide.js enterRecvMode calls setSlideRecvRef(slide) per CONTEXT C-05 per-session lifecycle"
  - "slide.js __getStateForTests recv-mode branch with W1 wiring (bytes_in_file_done from window.__slideRecv)"
  - "keyboard.js Esc disambiguation chain inserts SLIDE-cancel arm BETWEEN selection-drag-cancel and paste-cancel (B2-locked comment text verbatim)"
  - "main.js wireSlideRecv boot wiring + window.__slide.cancelRecv + window.__slide.isActive + window.__slideRecv test introspection"
affects:
  - "Plan 10-04 (Settings UI): re-calls wireSlideRecv with row/toggle/folderButton/status/help DOM refs"
  - "Plan 10-05 (UAT/E2E Playwright): drives window.__slide.cancelRecv + dispatches Esc events to verify the 5-step cancel sequence end-to-end"
  - "Phase 11 SLIDE-32: replaces slidePumpOnPortLost 5-line minimum with chip-emitting logic"
  - "Phase 11 SLIDE-29: attaches visible 'Retry' chip to recoverHardFail console.error sink"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ADR-003 §3 5-step cancel sequence with Promise.race absolute-timeout escape hatch (200/500/100/2000 ms windows verbatim)"
    - "Mid-session ESC^SLIDE re-entry matcher (Pattern 9): per-byte WAKEUP matcher in PARALLEL with framer feed + idempotent reset on full match"
    - "Per-event delegation via injected onRecvEvent callback (slide.js → slide-recv.js one-way edge)"
    - "Dual __getStateForTests surface (window.__slide + window.__slideRecv) with W1 wiring pulling bytes_in_file_done across the surface"
    - "Esc disambiguation chain insertion (B2-locked comment text + locked slot position)"
    - "Two-layer cancel idempotency (cancelInFlight module-scope boolean + slide.cancel() Phase 7 D-06)"

key-files:
  created: []
  modified:
    - "www/transport/slide-recv.js — cancelSlideRecv STUB → full 5-step ADR-003 sequence + helpers + slidePumpOnPortLost real impl + recoverHardFail 3-mode convergence + MAX_FILE_SIZE breach upgrade"
    - "www/transport/slide.js — dispatchRecvMode rewritten with mid-session re-entry matcher + EVT_* mirror extension + onRecvEvent delegation + setSlideRecvRef in enterRecvMode + __getStateForTests recv-mode branch (W1 wiring)"
    - "www/input/keyboard.js — Esc disambiguation chain inserts SLIDE-cancel arm BETWEEN selection-drag-cancel and paste-cancel (B2-locked comment text verbatim)"
    - "www/main.js — wireSlideRecv boot wiring + idb imports + window.__slide.cancelRecv + window.__slide.isActive + window.__slideRecv exposure"

key-decisions:
  - "Cancel sequence timing windows VERBATIM from CONTEXT.md / ADR-003 §3 (200/500/100/2000 ms — no deviation allowed)"
  - "NEVER call reader.cancel() or port.close() in the cancel path — keeps terminal session alive (Pitfall 5 BLOCKING constraint)"
  - "B2 comment text VERBATIM — kept as a single comment line per CONTEXT lock so the plan-checker grep gate matches byte-for-byte"
  - "W1 wiring routes bytes_in_file_done across the dual __getStateForTests surface via window.__slideRecv (not via a callback registered into slide.js) — minimal coupling + cleanly testable"
  - "Mid-session re-entry matcher uses a SEPARATE recvWakeIdx + recvScratch from dispatchTerminalMode's wakeIdx so the two matchers never interfere"
  - "Port-lost handler fanout (slidePumpOnPortLost binding to serial.js's read-loop teardown) DEFERRED to Phase 11 SLIDE-32 — function exported now, binding lands then"

patterns-established:
  - "Pattern: Promise.race-wrapped absolute timeout for multi-step async sequences (cancelSlideRecv 2000 ms wraps the 5-step body)"
  - "Pattern: setTimeout-driven state poll with performance.now() time budget (waitForState 500 ms cap, 10 ms tick)"
  - "Pattern: Module-scope cancelInFlight boolean for two-layer idempotency (paired with slide.cancel() Phase 7 D-06 idempotency)"
  - "Pattern: forceExitRecvMode helper resets txSink owner + per-session bookkeeping; SM-side mode flag re-reads slide.state() on next dispatchInbound"
  - "Pattern: Per-byte mid-session re-entry matcher (verbatim Pattern 9) that runs BEFORE feedSlide so re-entry is detected before any framer state is corrupted"
  - "Pattern: Separate recvWakeIdx state when a matcher needs to run inside an already-dispatched mode (parallel to dispatchTerminalMode's wakeIdx — does not share state)"

requirements-completed: [SLIDE-27, SLIDE-29, SLIDE-30, SLIDE-34]

# Metrics
duration: 9min
completed: 2026-05-08
---

# Phase 10 Plan 03: SLIDE Cancel State Machine + Dispatcher Wiring Summary

**ADR-003 §3 5-step CTRL_CAN cancel sequence (200/500/100/2000 ms verbatim) + mid-session ESC^SLIDE re-entry matcher + Esc-disambiguation slot 2 + boot wiring complete; Phase 10 receiver safety surface ready for Plan 10-04 Settings UI and Plan 10-05 UAT.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-08T11:03:27Z (approximate)
- **Completed:** 2026-05-08T11:12:39Z (approximate)
- **Tasks:** 3
- **Files modified:** 4 (slide-recv.js, slide.js, keyboard.js, main.js)

## Accomplishments

- Replaced Plan 10-02's `cancelSlideRecv` STUB with the full ADR-003 §3 5-step sequence:
  1. `Promise.race([Promise.allSettled(inflightDownloads), delay(200)])`
  2. `slide.cancel()` pushes CTRL_CAN onto outbound + `drainSlideOutboundOneShot()`
  3. `await waitForState(STATE_DONE, 500)` for Z80 echo
  4. `await delay(100)` post-echo drain
  5. If no echo, `slide.force_idle()` escape hatch
  Cleanup via `forceExitRecvMode()`; 2000 ms `setTimeout` wraps the entire sequence as the absolute escape hatch per ADR-003 §3.
- Replaced Plan 10-02's `slidePumpOnPortLost` STUB with a 5-line real impl (T-10-port-lost mitigation).
- Replaced Plan 10-02's `recoverHardFail` STUB with a 3-mode convergence real impl (T-10-hard-fail mitigation).
- Upgraded `MAX_FILE_SIZE` breach handler in `onRecvData()` from soft reset to `slide.cancel() + recoverHardFail('file too large')` (T-10-01 full mitigation).
- Rewrote `slide.js`'s `dispatchRecvMode` from the 5-line straight-pass into the verbatim Pattern 9 mid-session ESC^SLIDE re-entry matcher (T-10-03 mitigation): per-byte matcher running in PARALLEL with framer feed; on full match → `console.warn` + `slide.force_idle()` + `exitRecvMode` + `enterRecvMode` (idempotent reset per CONTEXT C-05); bytes BEFORE wakeup feed to existing SM (last-ditch ACK), bytes AFTER feed to new SM.
- Extended `slide.js`'s `drainEventsAndOutbound` to dispatch `EVT_HEADER_RECEIVED` / `EVT_RECV_DATA` / `EVT_RECV_FILE_DONE` to `slide-recv.js`'s `onRecvEvent`.
- Added 3 new EVT_* constants (`EVT_HEADER_RECEIVED=11<<16`, `EVT_RECV_DATA=12<<16`, `EVT_RECV_FILE_DONE=13<<16`) to slide.js's JS-side mirror, pinned by Plan 10-01's `slide_boundary_shape.rs` and `slide_wasm_boundary_shape.rs`.
- Exported `EVT_NONE` from `slide.js` so future modules (and slide-recv.js) can use the empty-event sentinel without redefining it.
- Wired `setSlideRecvRef(slide)` in `slide.js`'s `enterRecvMode` per CONTEXT C-05 per-session lifecycle (slide-recv reads slideRef in `onRecvEvent` chunks accumulator + `cancelSlideRecv` 5-step CTRL_CAN).
- Added recv-mode branch to `slide.js`'s `__getStateForTests` with W1 wiring: `bytes_in_file_done` reads from `window.__slideRecv?.__getStateForTests?.()?.bytesInFileDone ?? 0` (honours CONTEXT.md's locked recv-mode shape).
- Inserted SLIDE-cancel arm into `keyboard.js`'s Esc disambiguation chain BETWEEN selection-drag-cancel (existing slot 1) and paste-cancel (existing slot 2 → 3). The inserted-code comment matches the B2-locked text byte-for-byte.
- Wired `wireSlideRecv({...})` in `main.js` AFTER `wireSlideDispatcher`; exposed `window.__slide.cancelRecv` + `window.__slide.isActive` + `window.__slideRecv` for Plan 10-05 Playwright UAT and the W1 wiring read path.

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace slide-recv.js cancelSlideRecv STUB with full 5-step CTRL_CAN sequence + slidePumpOnPortLost real impl + recoverHardFail real impl** — `2435707` (feat)
2. **Task 2: Extend slide.js dispatcher with recv-event delegation + mid-session ESC^SLIDE re-entry matcher + EVT_* mirror + setSlideRecvRef in enterRecvMode + __getStateForTests recv-mode branch (W1 wiring)** — `2d0cca0` (feat)
3. **Task 3: Insert SLIDE-cancel arm into Esc disambiguation chain in keyboard.js (B2 fix) + wire wireSlideRecv + idb + window.__slide.cancelRecv in main.js** — `e9dd3a2` (feat)

**Plan metadata:** _to be filled by final commit_ (docs: complete plan)

## Files Created/Modified

- `www/transport/slide-recv.js` — cancelSlideRecv STUB → full ADR-003 §3 5-step sequence; new helpers (drainSlideOutboundOneShot + waitForState + forceExitRecvMode); slidePumpOnPortLost + recoverHardFail STUBs replaced with real impls; MAX_FILE_SIZE breach upgraded to slide.cancel + recoverHardFail. (+139 / -10 lines)
- `www/transport/slide.js` — JS-side EVT_* mirror gains 3 new constants + EVT_NONE exported; new module-scope recvWakeIdx + recvScratch state; dispatchRecvMode rewritten with verbatim Pattern 9 mid-session re-entry matcher; drainEventsAndOutbound dispatches recv events to onRecvEvent; enterRecvMode calls setSlideRecvRef; __getStateForTests gains recv-mode branch with W1 wiring. (+119 / -5 lines)
- `www/input/keyboard.js` — slide-recv import; SLIDE-cancel arm inserted BETWEEN selection-drag-cancel and paste-cancel; B2-locked comment text verbatim. (+13 lines)
- `www/main.js` — slide-recv + idb imports; wireSlideRecv({...}) call AFTER wireSlideDispatcher; window.__slide.cancelRecv + window.__slide.isActive + window.__slideRecv exposure. (+48 lines)

## B2 Fix Verification (verbatim comment lock)

The inserted-code comment in `keyboard.js` line 228 reads exactly:
```
// Phase 10 D-disambiguation: slot 2 of 4 in the Esc-only disambiguation chain (slot 3 of 5 if Ctrl+Shift+Esc is counted). Inserted between selection-drag-cancel (existing slot 1 / chain pos 2) and paste-cancel (existing slot 2 / chain pos 4).
```
This matches the CONTEXT.md / Plan 10-03 lock byte-for-byte. `grep -c 'Phase 10 D-disambiguation: slot 2 of 4' www/input/keyboard.js` returns 1.

The post-insertion Esc disambiguation chain order is:
1. `Ctrl+Shift+Esc` clear-selection (existing — chord, NOT bare Esc)
2. `Esc + selectionIsDragging()` → `selectionCancelDrag()` (existing — Esc-only slot 1)
3. `Esc + isSlideActive()` → `cancelSlideRecv()` (NEW — Esc-only slot 2)
4. `Esc + pastePumpIsActive()` → `cancelPaste()` (existing, was Esc-only slot 2 → now slot 3)
5. `Esc` fallthrough → encode 0x1B (existing, was Esc-only slot 3 → now slot 4)

## W1 Fix Verification (dual __getStateForTests surface)

`slide.js`'s `__getStateForTests` recv-mode branch reads `bytes_in_file_done` from `window.__slideRecv?.__getStateForTests?.()?.bytesInFileDone ?? 0`. `grep -c 'window.__slideRecv' www/transport/slide.js` returns 3 (one in `__getStateForTests`, two in the head comments documenting the wiring). The W1-locked CONTEXT.md recv-mode shape is honoured.

## Decisions Made

- Cancel sequence timing windows are VERBATIM from CONTEXT.md / ADR-003 §3 (200/500/100/2000 ms). No deviation allowed.
- B2 comment text is VERBATIM — kept as a single long comment line per CONTEXT lock so the plan-checker grep gate matches byte-for-byte.
- W1 wiring routes `bytes_in_file_done` via `window.__slideRecv` (not via a callback registered into slide.js) — minimal coupling, cleanly testable, and the dual surface is intentional per the locked recv-mode shape.
- The mid-session re-entry matcher uses SEPARATE `recvWakeIdx` + `recvScratch` from `dispatchTerminalMode`'s `wakeIdx` so the two matchers never interfere when `dispatchInbound` flips between modes mid-stream.
- Port-lost handler fanout (binding `slidePumpOnPortLost` to serial.js's read-loop teardown) is DEFERRED to Phase 11 SLIDE-32 per the plan's stated scope. The function is exported and imported into main.js now (as `slideRecvPumpOnPortLost`) so Phase 11 can bind without touching this plan's surface.
- The cancel sequence's `slideRef.cancel()` and `slideRef.force_idle()` calls are guarded with `typeof === 'function'` checks because the cancel sequence may be invoked at any point in the slideRef lifecycle (per-session new Slide → free) and a defensive null/undefined-method check is cheap.

## Deviations from Plan

None - plan executed exactly as written.

The Task 3 acceptance grep `grep -c "window.__slide.cancelRecv = cancelSlideRecv"` returned 2 instead of 1 because a comment line referencing the locked grep target lives just above the actual assignment. Both occurrences are valid (the assignment + the explanatory comment) and the plan's acceptance only required `>= 1`. Same for `window.__slide.isActive = isSlideActive` and `cancelSlideRecv()` / `isSlideActive()` in keyboard.js (each appears in both an import statement and the call site).

The duplicate `cancelRecv: cancelSlideRecv` / `isActive: isSlideActive` lines that briefly existed inside the `window.__slide = { ... }` object literal during Task 3 implementation were removed in the same task before commit so the assigned form (`window.__slide.cancelRecv = cancelSlideRecv` / `window.__slide.isActive = isSlideActive`) is the single canonical wiring. This matches the CONTEXT-locked grep target style.

## Issues Encountered

- Two flaky Playwright runs during Tasks 1 and 2 verification (slide-dispatcher.spec.js `post-feed-invariant-ESC-Z-returns-host-reply @fast` once; slide-wakeup.spec.js `torn-chunk-split-1/6 @fast` once) — both passed on rerun and are documented as flake (Phase 8 Plan 04 already noted "5/8 runs flaked, post-fix 8/8 runs green" for the wakeup specs; the dispatcher spec is similar). The deterministic `npm run test:fast` gate (used as the plan's primary correctness signal) passed 81/81 on every run after each commit.
- `cargo test --workspace` stayed green at 283 tests throughout (no Rust changes in this plan).

## User Setup Required

None — no external service configuration required.

## Verification

- `bash scripts/build.sh` exits 0 after every task (W5 wasm-rebuild fix verified).
- `cargo test --workspace` passes (283 tests; same as before Plan 10-03 — no Rust changes).
- `cd www && npm run test:fast` passes 81/81 deterministically after every task commit.
- `cd www && npx playwright test slide-wakeup.spec.js slide-dispatcher.spec.js slide-sender.spec.js file-source.spec.js` passes 36/36 with retries (modulo known parallel-worker flake).
- ADR-003 §3 invariants preserved: `cancel()` / `force_idle()` / `CancelPending` semantics in state.rs unchanged; JS owns ALL timing; 200/500/100/2000 ms windows verbatim from CONTEXT.
- B1 fix retained from Plan 10-01: `slide_recv_corpus.rs` (NOT `slide_recv_edge_cases.rs`) is the recv-corpus fixture file.
- B2 fix verified: keyboard.js inserted-code comment matches the locked text byte-for-byte; arm inserted BETWEEN selection-drag-cancel (existing slot 1) and paste-cancel (existing slot 2).
- W1 fix verified: slide.js's `__getStateForTests` recv-mode branch reads `bytes_in_file_done` via `window.__slideRecv.__getStateForTests().bytesInFileDone`.
- W4 fix already-verified in Plan 10-02: `lastDownloadAt` module-scope timestamp serialises the inter-file gap.
- W5 fix verified: every task with wasm-dependent verification ran `bash scripts/build.sh`.
- No `test.skip` declarations were touched (Plan 10-05 fills them).

## Next Phase Readiness

- Plan 10-04 (Settings UI for SLIDE-recv folder picker) is unblocked — re-calls `wireSlideRecv` with non-null DOM refs once the Settings rows exist in `index.html`.
- Plan 10-05 (UAT/E2E Playwright) is unblocked — drives `window.__slide.cancelRecv()` + dispatches `Escape` keydown events + asserts the 5-step cancel sequence end-to-end via state polling and the dual `window.__slide` / `window.__slideRecv` introspection surfaces.
- Phase 11 SLIDE-32 (port-lost chip) will replace `slidePumpOnPortLost`'s 5-line minimum with chip-emitting logic; the function is exported and imported into main.js now so the binding can land without touching Plan 10-03's surface.
- Phase 11 SLIDE-29 (visible "Retry" chip) will attach to `recoverHardFail`'s `console.error` sink for the 3-mode convergence (NAK budget / port lost / wire desync).
- Phase 12 OQ-4 (real-hardware UAT requires patched slide.asm; PR to github.com/blowback/slide) — Z80-side handling of PC-sent CTRL_CAN remains the OQ-1 Phase 10 discuss-phase decision; this plan implements the JS side per ADR-003 §3 and assumes the Z80 PR will mirror the bidirectional CAN amendment.

## Self-Check: PASSED

- File `www/transport/slide-recv.js`: FOUND (modified — cancelSlideRecv full impl + helpers + STUB replacements).
- File `www/transport/slide.js`: FOUND (modified — dispatchRecvMode rewrite + EVT_* mirror + onRecvEvent delegation + setSlideRecvRef + W1 wiring).
- File `www/input/keyboard.js`: FOUND (modified — Esc-arm insertion + B2-locked comment).
- File `www/main.js`: FOUND (modified — wireSlideRecv + window.__slide.cancelRecv + window.__slideRecv).
- Commit `2435707` (Task 1 — feat slide-recv.js cancel sequence): FOUND.
- Commit `2d0cca0` (Task 2 — feat slide.js dispatcher extension): FOUND.
- Commit `e9dd3a2` (Task 3 — feat keyboard.js + main.js wiring): FOUND.

---
*Phase: 10-slide-receiver-cancellation*
*Completed: 2026-05-08*
