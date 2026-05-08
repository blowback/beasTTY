---
phase: 11-slide-js-bridge-v1-0-integration
plan: 04
subsystem: integration
tags: [echo-swallow, visibilitychange, pagehide, ctrl-can, compatibility-mode, wakeup-timer, retry-force-start, wave-3, slide-14, slide-31, slide-35, slide-39]

# Dependency graph
requires:
  - phase: 11-slide-js-bridge-v1-0-integration
    plan: 01
    provides: prefs.slideCompatibilityMode DEFAULTS key + setWakeupDelay mock-bot extension — Plan 11-04 reads slideCompatibilityMode at enterSendMode call time + Plan 11-05 will use the mock-bot delay to drive timeout chip tests
  - phase: 11-slide-js-bridge-v1-0-integration
    plan: 02
    provides: slide-chip module with enterAwaitingWakeup({armTimer}) opt + onStateChange observer fan-out + handleInlineAction routing for Retry/Cancel/Force-start — Plan 11-04 fills the timer body + dispatcher handler
  - phase: 11-slide-js-bridge-v1-0-integration
    plan: 03
    provides: slideChipApi flowing into wireSlideDispatcher opts + thunk-holder cancelSlideRecvLazy + Settings sub-block 3-way <select> + chip lifecycle hooks at enterSendMode — Plan 11-04 extends with prefs-driven 3-way branching, registers chip onStateChange observer in dispatcher, and shares cancelSlideRecvLazy with chrome.js for the visibilitychange/pagehide branches
  - phase: 09-slide-sender-host-z80-send
    provides: enterSendMode + pushTxBytes auto-type + pendingSendSession lifecycle — Plan 11-04 adds pushAutoTypedBytes call alongside pushTxBytes + force-start path consumes pendingSendSession synchronously
  - phase: 10-slide-receiver-cancellation
    provides: cancelSlideRecv 5-step ADR-003 cancel state machine + isSlideActive predicate — Plan 11-04 chrome.js fire-and-forget visibilitychange/pagehide branches consume both
  - phase: 04-keyboard-input
    provides: D-13 CR/LF mode rewrite (TX bytes go through Phase 4 D-13 rewrite before pushTxBytes) — Plan 11-04 echo-swallow filter compares against post-rewrite TX bytes (what actually went on the wire), so CR/LF mode is transparent
provides:
  - "www/transport/echo-swallow.js NEW (~115 LOC) — byte-for-byte FIFO swallow filter with 500 ms timeout (CONTEXT C-03 / PITFALLS §11). 6 exports: wireEchoSwallow / pushAutoTypedBytes / consumeIfMatch / flushPending / __resetForTests / __getStateForTests. Module-scope state mirrors slide-recv.js / paste-pump.js shape. Mismatch OR 500 ms expiry flushes remaining buffer to term.feed (no byte loss)."
  - "slide.js dispatchTerminalMode integration — echoSwallowConsumeIfMatch invoked BEFORE the wakeup matcher in the byte loop (CONTEXT C-03 ordering invariant). pushAutoTypedBytes fired in enterSendMode immediately after pushTxBytes(autoSendBytes) so swallow buffer aligns with what went on the wire."
  - "slide.js Compatibility-mode 3-way branch in enterSendMode (CONTEXT D-16) — 'auto' (armTimer:true → 3 s timer), 'wakeup-required' (armTimer:false → indefinite wait), 'force-start' (armTimer:false + microtask-scheduled enterSendModeInternal → skip wakeup wait). Defaulting to 'auto' on missing/unknown prefs values."
  - "slide-chip.js wakeupTimeoutHandle module-scope state + WAKEUP_TIMEOUT_MS = 3000 — enterAwaitingWakeup arms the 3 s setTimeout when opts.armTimer === true; on expiry transitions lifecycle 'awaiting-wakeup' → 'awaiting-timeout' (chip displays Z80 didn't respond + bracketed buttons via existing refreshChip case). enterActive / hide / __resetForTests all call clearWakeupTimer for correct lifecycle. __getStateForTests exposes hasWakeupTimer."
  - "slide.js handleChipInlineAction handler + onStateChange observer registration in wireSlideDispatcher — routes chip 'inline-action' events for Retry / Cancel / Force-start. Retry re-emits auto-type via pushTxBytes + pushAutoTypedBytes + re-arms enterAwaitingWakeup honouring current Compat mode. Force-start consumes pendingSendSession + jumps directly to enterSendModeInternal. Cancel for awaiting-* lifecycle clears pendingSendSession + hides chip; active-session cancel routes through the chip's onCancel callback (Plan 11-03)."
  - "chrome.js visibilitychange listener extension (CONTEXT D-13) — fire-and-forget try/catch CTRL_CAN best-effort branch fires when document.visibilityState === 'hidden' AND isSlideActive() returns true: cancelSlideRecv() + writeSlideFrame([0x18]). No await — best-effort per PITFALLS §6."
  - "chrome.js pagehide listener (D-13) — bfcache-safe complement to visibilitychange with the same SLIDE branch body. Required because pagehide is the spec-guaranteed signal for bfcache eviction where visibilitychange may not fire."
  - "main.js wireChrome opts extension — isSlideActive (predicate gate from slide-recv.js, already imported), cancelSlideRecv (thunk-holder cancelSlideRecvLazy hoisted before wireChrome so D-13 branches close over the same shared holder Plan 11-03 wireSlideChip uses), txSink (writeSlideFrame + writeSlideFrameAwaitable for the 0x18 byte)."
  - "main.js cancelSlideRecvLazy hoisted from below wireSlideChip up to before wireChrome — both consumers (chrome.js + wireSlideChip) close over the same mutable holder; reassignment to cancelSlideRecv after wireSlideRecv runs reaches both paths."

affects: [11-05-PLAN.md, 12-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Byte-for-byte FIFO filter with module-scope state + setTimeout-based expiry (echo-swallow.js) — analog of paste-pump's queue/cursor pattern but for inbound bytes; mismatch OR expiry flushes residual buffer to term.feed for byte-loss-free behaviour"
    - "Filter-before-matcher composition in dispatchTerminalMode byte loop — swallow filter sits at strictly earlier point than wakeup matcher; the two are orthogonal so no replay/coupling logic needed (CONTEXT C-03 ordering invariant)"
    - "3-way branching on prefs.slideCompatibilityMode with defensive 'auto' default — read at call time inside enterSendMode (not cached at boot) so user changes to the Settings <select> take effect on the next session start"
    - "Observer fan-out for chip inline-actions — chip emits 'inline-action' events through stateChangeObservers; dispatcher consumes via onStateChange registration. Decouples chip surface from dispatcher logic; mirrors scroll-state.js onChange/fireChange precedent"
    - "Microtask-scheduled mode transition for force-start — Promise.resolve().then() defers enterSendModeInternal so the pushTxBytes auto-type bytes clear the local ring before owner flips to 'slide' (Pitfall 3 ordering invariant preserved)"
    - "Thunk-holder forward-reference shared across two wireXxx initializers — cancelSlideRecvLazy hoisted before wireChrome so both chrome.js D-13 listeners and wireSlideChip onCancel close over the same mutable holder; reassignment after wireSlideRecv runs reaches both consumers atomically"
    - "Two-layer try/catch defensive wrapping — outer guard around the entire SLIDE branch + inner per-call try/catch (cancelSlideRecv vs writeSlideFrame). Best-effort means: errors during page teardown must NOT propagate (PITFALLS §6)"

key-files:
  created:
    - "www/transport/echo-swallow.js"
  modified:
    - "www/transport/slide.js"
    - "www/renderer/slide-chip.js"
    - "www/renderer/chrome.js"
    - "www/main.js"

key-decisions:
  - "Echo-swallow filter extracted as separate module www/transport/echo-swallow.js (CONTEXT C-03 — planner's choice between separate module vs inline state). Separate module gives clean test surface (Plan 11-05 can drive consumeIfMatch + pushAutoTypedBytes directly via window.__echoSwallow if exposed, though Plan 11-04 keeps the module internal — exposure deferred to Plan 11-05 if needed). The dispatcher byte loop's call site is a single line, preserving the existing wakeup-matcher logic verbatim."
  - "Compatibility-mode 3-way branch reads prefs.slideCompatibilityMode at call time inside enterSendMode — defensive default 'auto' on missing/unknown values. Re-checked inside handleChipInlineAction's retry path so a user changing the Settings <select> between original Send click and Retry click sees the new mode honoured."
  - "Force-start branch consumes pendingSendSession in enterSendMode synchronously (clearing pendingSendSession before the microtask-scheduled enterSendModeInternal) so the wakeup-completion clause in dispatchTerminalMode's byte loop won't fire a duplicate enterSendModeInternal when a stray ESC^SLIDE arrives mid-startup. Same pattern in handleChipInlineAction's force-start branch (chip Force-start button after timeout)."
  - "Chip's onCancel callback (Plan 11-03 wireSlideChip) handles cancel for active sessions via the Phase 10 5-step cancelSlideRecv state machine. handleChipInlineAction's cancel case ONLY handles awaiting-wakeup / awaiting-timeout lifecycles (no active session yet). Disambiguation via slideChipRef.__getStateForTests().lifecycle inspection rather than introducing a separate slide.js-side lifecycle variable — keeps the chip module the single source of truth for lifecycle."
  - "cancelSlideRecvLazy thunk-holder hoisted from below wireSlideChip up to before wireChrome. Both chrome.js D-13 visibilitychange/pagehide branches AND wireSlideChip onCancel close over the same mutable holder; reassignment to cancelSlideRecv after wireSlideRecv runs reaches both paths atomically. The original Plan 11-03 declaration was below wireSlideChip — Plan 11-04 hoists it without breaking Plan 11-03's wiring (the second-position let declaration was removed and replaced with a comment pointing back to the hoisted declaration)."
  - "visibilitychange + pagehide branches use double-call safety (cancelSlideRecv + writeSlideFrame both fire). cancelSlideRecv internalises its own CTRL_CAN emission via slide.cancel(); writeSlideFrame is a last-ditch direct-to-wire call in case the SM has already transitioned past CancelPending. Phase 10 D-15 cancelInFlight guard makes this idempotent (T-11-04-vis mitigation)."
  - "WAKEUP_TIMEOUT_MS = 3000 lives in slide-chip.js (chip owns the timer per CONTEXT C-02 default — 'chip owns the timer matches Phase 6 chip ownership of newLinesSinceUserScrolled'). Dispatcher only signals armTimer via the existing enterAwaitingWakeup({armTimer}) opt; no setTimeout in slide.js."
  - "Phase 11 hard invariant preserved — ZERO Rust changes (CLAUDE.md). bash scripts/build.sh exits 0 with wasm artifacts unchanged. All Plan 11-04 work is JS (echo-swallow.js NEW + slide.js / slide-chip.js / chrome.js / main.js modifications)."

requirements-completed: []  # SLIDE-14 / SLIDE-31 / SLIDE-35 / SLIDE-39 are integrated by Plan 11-04 but flip Pending → Complete in Plan 11-05's verification gate (consistent with Plan 11-02/11-03 precedent: chip + lifecycle ship in 11-02 + 11-03 + 11-04 but flip in 11-05). Plan 11-05 fills the 50 RED-gate stubs from Plan 11-01 and asserts the full lifecycle end-to-end via Playwright with the mock-bot setWakeupDelay extension driving timeout-chip behaviour.

# Metrics
duration: ~10min
completed: 2026-05-08
---

# Phase 11 Plan 11-04: Echo-Swallow + Visibilitychange/Pagehide CTRL_CAN + Compatibility-Mode 3-Way Timer Summary

**Three correctness gates land — byte-for-byte SLIDE-14 echo-swallow filter
sitting BEFORE the wakeup matcher in dispatchTerminalMode (no double-print of
CP/M's auto-type echo), SLIDE-31 fire-and-forget CTRL_CAN best-effort emission
on visibilitychange + pagehide (bfcache-safe), and SLIDE-35/SLIDE-39
Compatibility-mode 3-way governance of the 3-second wakeup-timeout chip with
[Retry] / [Cancel] / [Force start] inline action handlers wired through the
chip's onStateChange observer fan-out. 1 NEW file (echo-swallow.js, 115 LOC)
+ 4 modified (slide.js / slide-chip.js / chrome.js / main.js). Plan 11-05's
50 RED-gate stubs now have implementations behind every assertion path.**

## Performance

- **Duration:** ~10 min (3 atomic commits)
- **Started:** 2026-05-08T18:16:20Z
- **Completed:** 2026-05-08T18:25:55Z
- **Tasks:** 3 (all `type="auto"`, non-TDD)
- **Files created:** 1 (echo-swallow.js)
- **Files modified:** 4 (slide.js / slide-chip.js / chrome.js / main.js)

## Accomplishments

- **Echo-swallow filter (SLIDE-14)** — `www/transport/echo-swallow.js` NEW
  ~115 LOC. Byte-for-byte FIFO swallow buffer + 500 ms `setTimeout` expiry.
  6 exports per CONTEXT C-03 / PITFALLS §11. `wireEchoSwallow({term})` injects
  the term ref so `flushPending` can forward unmatched bytes via `term.feed`.
  `pushAutoTypedBytes(bytes)` arms the buffer with TX bytes;
  `consumeIfMatch(byte)` returns true if the byte was swallowed (do NOT
  forward) or false (continue through dispatcher → wakeup matcher → term.feed).
  Mismatch OR 500 ms expiry flushes remaining buffer to term.feed (preserves
  any echo that didn't fully match — no byte loss). `__resetForTests` +
  `__getStateForTests` for Plan 11-05 Playwright introspection.
- **slide.js dispatchTerminalMode integration** —
  `echoSwallowConsumeIfMatch(b)` invoked at the TOP of the byte loop body,
  BEFORE the existing `if (b === WAKEUP[wakeIdx])` check (CONTEXT C-03
  ordering invariant). The two paths are orthogonal — swallow filter consumes
  echo bytes silently; wakeup matcher consumes the 7-byte ESC^SLIDE
  signature. No interaction.
- **slide.js enterSendMode integration** — `pushAutoTypedBytes(autoSendBytes)`
  fires immediately AFTER `pushTxBytes(autoSendBytes)` so the swallow buffer
  aligns with what went on the wire. CR/LF mode (Phase 4 D-13) applies
  before pushTxBytes; the same post-rewrite bytes feed both sinks. Empty-
  string-disables semantic skips this naturally.
- **slide.js wireSlideDispatcher init** — `wireEchoSwallow({term})` called
  once during dispatcher init (single source of truth for the term ref).
- **slide-chip.js Compatibility-mode 3 s timer (D-15)** — `wakeupTimeoutHandle`
  module-scope state + `WAKEUP_TIMEOUT_MS = 3000`. `enterAwaitingWakeup`
  honours `opts.armTimer` — when true, arms a 3 s `setTimeout` that
  transitions `lifecycle` from `'awaiting-wakeup'` to `'awaiting-timeout'`
  on expiry (chip displays "Z80 didn't respond.  [Retry]  [Cancel]  [Force
  start]" via existing `refreshChip` `awaiting-timeout` case from Plan
  11-02). `enterActive` clears the timer (wakeup arrived in time). `hide` +
  `__resetForTests` clear the timer (correct lifecycle + test isolation).
  `__getStateForTests` exposes `hasWakeupTimer` for Playwright
  introspection.
- **slide.js Compatibility-mode 3-way branch (D-16)** — `enterSendMode`
  reads `prefsRef.slideCompatibilityMode` at call time (defaulting to
  `'auto'` on null/unknown) and branches:
  - `'auto'` (default) → `enterAwaitingWakeup({armTimer:true})` — 3 s
    timer arms; wakeup matcher arms; if wakeup arrives in time, chip
    transitions to `active` via `dispatchTerminalMode`'s wakeup-completion
    clause (Plan 11-03). If 3 s elapses without wakeup, chip transitions to
    `awaiting-timeout` (`Z80 didn't respond.  [Retry]  [Cancel]  [Force
    start]`).
  - `'wakeup-required'` → `enterAwaitingWakeup({armTimer:false})` — no
    timer; chip stays in `awaiting-wakeup` until the 7-byte signature
    arrives or the user clicks Cancel.
  - `'force-start'` → `enterAwaitingWakeup({armTimer:false})` then a
    microtask-scheduled `enterSendModeInternal(session)` consumes
    `pendingSendSession` synchronously and skips wakeup wait entirely.
- **slide.js handleChipInlineAction (D-15)** — registered inside
  `wireSlideDispatcher` via `slideChipRef.onStateChange(evt => ...)`. Routes
  chip 'inline-action' events:
  - `'retry'` → re-emit auto-type via `pushTxBytes` +
    `pushAutoTypedBytes`; re-arm `enterAwaitingWakeup` honouring current
    Compat mode.
  - `'force-start'` → consume `pendingSendSession` +
    `enterSendModeInternal`. Microtask-free here (post-timeout path —
    pushTxBytes ring is already drained).
  - `'cancel'` (awaiting-* lifecycle only) → clear `pendingSendSession` +
    `slideChipRef.hide()`. Active-session cancel routes through the
    chip's `onCancel` callback (Plan 11-03 — `cancelSlideRecv` 5-step
    ADR-003 state machine).
- **chrome.js visibilitychange + pagehide (D-13)** — `wireChrome` opts
  extended with `isSlideActive`, `cancelSlideRecv`, `txSink`. Module-scope
  refs gate the SLIDE branch on null so older boot paths and tests retain
  pre-Phase-11 behaviour. visibilitychange listener body extended with
  fire-and-forget CTRL_CAN best-effort branch (try/catch wrappers prevent
  error propagation during page teardown per PITFALLS §6). pagehide
  listener registered with the same body for bfcache-safe coverage. Both
  fire `cancelSlideRecvRef()` + `txSinkRef.writeSlideFrame(new
  Uint8Array([0x18]))` — double-call safety (Phase 10 D-15 cancelInFlight
  guard makes it idempotent).
- **main.js cancelSlideRecvLazy hoisted before wireChrome** — both
  chrome.js D-13 branches and Plan 11-03's `wireSlideChip` close over the
  same mutable holder; reassignment to `cancelSlideRecv` after
  `wireSlideRecv` runs reaches both consumers atomically. Original
  declaration was below `wireSlideChip`; Plan 11-04 hoists it and replaces
  the second-position `let` with a comment.
- **main.js wireChrome opts extension** — `isSlideActive: isSlideActive` +
  `cancelSlideRecv: () => cancelSlideRecvLazy()` thunk + `txSink: {
  writeSlideFrame, writeSlideFrameAwaitable }`.
- **Phase 11 hard invariant preserved** — ZERO Rust changes (CLAUDE.md);
  `bash scripts/build.sh` exits 0 with wasm artifacts unchanged.
- **Plan 11-05 unblocked** — every Wave 0 stub assertion path (chip
  awaiting-timeout transition, retry/force-start handlers, swallow filter
  byte consumption, visibilitychange CTRL_CAN, pagehide CTRL_CAN,
  Compatibility-mode branching) is now implemented.

## Task Commits

Each task was committed atomically:

1. **Task 1: Echo-swallow filter for SLIDE auto-type echo (SLIDE-14)** — `a653977` (feat)
2. **Task 2: visibilitychange + pagehide CTRL_CAN listeners (SLIDE-31)** — `ef7669c` (feat)
3. **Task 3: Compatibility-mode 3-way branch + 3 s wakeup timer (SLIDE-35/SLIDE-39)** — `74a5ed7` (feat)

## Files Created/Modified

- `www/transport/echo-swallow.js` (NEW, ~115 LOC) — byte-for-byte FIFO
  swallow filter with 500 ms timeout. 6 exports for the dispatcher integration
  + Playwright introspection. Module head comment documents CONTEXT C-03 /
  PITFALLS §11 / Phase 4 D-13 CR/LF interaction verbatim.
- `www/transport/slide.js` (+~125 lines net) — import echo-swallow.js;
  `wireEchoSwallow({term})` in `wireSlideDispatcher`;
  `echoSwallowConsumeIfMatch(b)` BEFORE wakeup matcher in
  `dispatchTerminalMode` byte loop; `pushAutoTypedBytes(autoSendBytes)`
  alongside `pushTxBytes` in `enterSendMode`; Compatibility-mode 3-way
  branch in `enterSendMode` (replaces single `enterAwaitingWakeup({armTimer:
  false})` call); `handleChipInlineAction` + `slideChipRef.onStateChange`
  registration in `wireSlideDispatcher`.
- `www/renderer/slide-chip.js` (+~30 lines) — `wakeupTimeoutHandle` +
  `WAKEUP_TIMEOUT_MS = 3000` module-scope state; `enterAwaitingWakeup`
  honours `opts.armTimer` (3 s `setTimeout` arms when true); `clearWakeupTimer`
  helper called from `enterActive` / `hide` / `__resetForTests`;
  `__getStateForTests` exposes `hasWakeupTimer`.
- `www/renderer/chrome.js` (+~50 lines) — module-scope `isSlideActiveRef` /
  `cancelSlideRecvRef` / `txSinkRef`; `wireChrome` opts extended with the
  three injected refs; visibilitychange listener body extended with
  fire-and-forget CTRL_CAN branch; pagehide listener registered with the
  same body.
- `www/main.js` (+~25 lines, -~5 lines net) — `cancelSlideRecvLazy` thunk-
  holder hoisted to before `wireChrome`; original declaration replaced with
  comment; `wireChrome` opts extended with `isSlideActive`, `cancelSlideRecv`
  thunk, `txSink`.

## Decisions Made

(See `key-decisions` in frontmatter.)

## Deviations from Plan

None — plan executed exactly as written. Plan's `<action>` blocks specified
the exact module-scope structure, the exact integration points, and the
exact handler patterns; this executor copied each one verbatim with one
minor naming clarification (using the existing `cancelSlideRecvLazy`
thunk-holder from Plan 11-03 rather than introducing a parallel
`cancelSlideRecvForChromeJsLazy` — both Plan 11-03's `wireSlideChip` and
Plan 11-04's `wireChrome` close over the same shared holder, and the
single reassignment after `wireSlideRecv` resolves both paths atomically).

The plan's Edit 2 in Task 3 included a fallback comment "Use whichever
pattern fits the existing slide.js shape" for the cancel inline-action
handler when slide.js's local `lifecycle` variable doesn't exist — the
executor selected the `slideChipRef.__getStateForTests().lifecycle`
inspection variant per the plan's explicit fallback guidance, which is the
correct path because slide.js does NOT track its own session lifecycle
variable (the chip module is the single source of truth).

## Auth Gates

None — Plan 11-04 is purely client-side JS integration glue.

## Issues Encountered

**Pre-existing parallelism flakes** (out-of-scope per executor SCOPE
BOUNDARY rule; documented in
`.planning/phases/11-slide-js-bridge-v1-0-integration/deferred-items.md`
from Plan 11-01 / Plan 11-02 / Plan 11-03):

`cd www && npm run test:fast` runs surfaced known intermittent flakes; all
passed cleanly with `--workers=1`:

| Verification run | Flake | In-isolation pass |
|------------------|-------|-------------------|
| Task 1 verification 1 | input/tx-debug-strip.spec.js + input/tx-sink.spec.js (timeouts on `_reader` poll under 10-worker load) | Passes 81/81 with --workers=1 |
| Task 1 verification 2 | transport/slide-wakeup.spec.js benign-isolated-caret | Same flake class |
| Task 1 verification 3 | input/tx-sink.spec.js setWireOwner-restores-keystroke-write | Same flake class |
| Task 2 verification | input/file-source.spec.js drop triggers picker-equivalent flow | Passes 81/81 with --workers=1 |
| Task 3 verification | transport/lifecycle.spec.js Gap 1 beforeunload close-contract | Passes 1/1 in isolation (323ms) |

The flake class is wasm-boot starvation under 10-worker parallel load —
unrelated to any code path Plan 11-04 touches. `npx playwright test
--workers=1 --grep="@fast"` returns 81/81 green deterministically; this was
the verification path used for the Task 1, Task 2, and Task 3 acceptance
gates.

## Threat Flags

None new — all surfaces in this plan are accounted for in the plan's
`<threat_model>`:

- **T-11-04-echo (Tampering)** — *mitigate* via 500 ms timeout +
  byte-for-byte match in echo-swallow.js. Mismatch flushes remaining buffer
  to term.feed (preserves any echo that didn't fully match — no byte loss).
  Verified: `grep -c 'SWALLOW_TIMEOUT_MS = 500' www/transport/echo-swallow.js`
  returns 1; mismatch path calls `flushPending()` before returning false.
- **T-11-04-vis (Repudiation)** — *mitigate* via `isSlideActive()` predicate
  gate at the top of both visibilitychange and pagehide branches. Phase 10
  D-15 `cancelInFlight` guard makes the double-call (cancelSlideRecv +
  writeSlideFrame) idempotent.
- **T-11-04-no-resp (Repudiation — user clicks Force-start during mid-stream
  send)** — *mitigate* via Compatibility-mode help text per CONTEXT D-07
  ('for pre-v0.2.1 slide.com'); Phase 12 SLIDE-42 UAT covers real-hardware
  verification. Plan 11-04 implements the inline button; Phase 12 documents
  the safety semantics.
- **T-11-04-timer-leak (Resource Exhaustion)** — *mitigate* via
  `clearWakeupTimer` called from `enterActive` (wakeup arrived), `hide`
  (user cancelled), `__resetForTests` (test isolation), and inside
  `enterAwaitingWakeup` itself (each new arming clears any prior — defensive
  re-arm).
- **T-11-04-pagehide-bfcache (Repudiation)** — *mitigate* via pagehide
  listener mirroring visibilitychange body verbatim. Z80 sees CTRL_CAN if
  the browser flushes the wire before unload.

## User Setup Required

None — purely client-side. Users will see the new behaviour automatically
on next page load:

- Auto-typed `B:SLIDE R\r` (or user-customised value from Settings) no
  longer double-prints when the Z80 echoes it back.
- Closing the tab during an active SLIDE session emits a CTRL_CAN to the
  Z80 (best-effort).
- Compatibility mode `auto` (default) shows a 3 s wakeup timeout chip with
  Retry / Cancel / Force-start buttons if the Z80 doesn't respond.
- Compatibility mode `wakeup-required` waits indefinitely for ESC^SLIDE.
- Compatibility mode `force-start` skips the wakeup wait entirely.

## Self-Check: PASSED

Verified before completion:

- [x] `www/transport/echo-swallow.js` exists.
- [x] `grep -c 'export function wireEchoSwallow' www/transport/echo-swallow.js` returns 1.
- [x] `grep -c 'export function pushAutoTypedBytes' www/transport/echo-swallow.js` returns 1.
- [x] `grep -c 'export function consumeIfMatch' www/transport/echo-swallow.js` returns 1.
- [x] `grep -c 'export function flushPending' www/transport/echo-swallow.js` returns 1.
- [x] `grep -c 'export function __resetForTests' www/transport/echo-swallow.js` returns 1.
- [x] `grep -c 'export function __getStateForTests' www/transport/echo-swallow.js` returns 1.
- [x] `grep -c 'SWALLOW_TIMEOUT_MS = 500' www/transport/echo-swallow.js` returns 1.
- [x] `grep -c 'echoSwallowConsumeIfMatch' www/transport/slide.js` returns >= 1 (2 — import alias + call site).
- [x] `grep -c 'pushAutoTypedBytes' www/transport/slide.js` returns >= 1 (3 — import + enterSendMode + retry handler).
- [x] `grep -c "from './echo-swallow.js'" www/transport/slide.js` returns 1.
- [x] `grep -c "addEventListener('pagehide'" www/renderer/chrome.js` returns 1.
- [x] `grep -c "0x18" www/renderer/chrome.js` returns 4 (2 comments + 2 call sites; criterion was 2 minimum for the writeSlideFrame branches).
- [x] `grep -c "isSlideActiveRef" www/renderer/chrome.js` returns 5 (declaration + opts assign + visibilitychange guard + pagehide guard + comment).
- [x] `grep -c "cancelSlideRecvRef" www/renderer/chrome.js` returns 4 (declaration + opts assign + 2 call sites).
- [x] `grep -c "txSinkRef" www/renderer/chrome.js` returns 4 (declaration + opts assign + 2 call sites).
- [x] `grep -c "isSlideActive: isSlideActive" www/main.js` returns 1.
- [x] `grep -c 'wakeupTimeoutHandle' www/renderer/slide-chip.js` returns 7 (declaration + arm + clear helper + getState + handles + comments + reset).
- [x] `grep -c 'WAKEUP_TIMEOUT_MS = 3000' www/renderer/slide-chip.js` returns 1.
- [x] `grep -c "lifecycle = 'awaiting-timeout'" www/renderer/slide-chip.js` returns 1.
- [x] `grep -c 'clearWakeupTimer' www/renderer/slide-chip.js` returns 5 (helper + 4 call sites).
- [x] `grep -c "compatMode === 'force-start'" www/transport/slide.js` returns 1.
- [x] `grep -c "compatMode === 'wakeup-required'" www/transport/slide.js` returns 1.
- [x] `grep -c 'slideCompatibilityMode' www/transport/slide.js` returns 4 (3 comments + 1 read site, both enterSendMode and retry handler).
- [x] `grep -c 'onStateChange' www/transport/slide.js` returns 2 (registration call + comment).
- [x] `grep -c "case 'retry':" www/transport/slide.js` returns 1.
- [x] `grep -c "case 'force-start':" www/transport/slide.js` returns 1.
- [x] `cd www && npx playwright test --workers=1 --grep="@fast"` 81/81 green
      deterministically (parallelism flakes documented in deferred-items.md).
- [x] `cd www && npx playwright test transport/slide-chip.spec.js
      transport/slide-bridge.spec.js transport/slide-compatibility.spec.js
      transport/slide-prefs.spec.js --list` — 46 tests in 4 files (Wave 0
      stubs from Plan 11-01 still resolve; Plan 11-05 fills bodies).
- [x] `bash scripts/build.sh` exits 0 (Phase 11 hard invariant preserved —
      zero Rust changes; wasm artifacts unchanged).
- [x] All 3 task commits exist in `git log --oneline`: a653977 (Task 1),
      ef7669c (Task 2), 74a5ed7 (Task 3).

## Next Phase Readiness

**Plan 11-05 unblocked** — every behaviour the Wave 0 stubs assert against
is now implemented:

- **slide-chip.spec.js** — chip enters `awaiting-timeout` after 3 s when
  `armTimer:true`; chip exposes `hasWakeupTimer` for assertion; Retry /
  Cancel / Force-start inline buttons fire 'inline-action' events.
- **slide-bridge.spec.js** — visibilitychange + pagehide listeners write
  0x18 to the wire when `isSlideActive()` is true; auto-type echo is
  consumed silently for ~500 ms; mismatch / timeout flushes residual buffer
  to term.feed.
- **slide-compatibility.spec.js** — 3-way branch behaviour observable via
  the chip lifecycle (auto arms timer → awaiting-timeout on miss; wakeup-
  required no timer → stays awaiting-wakeup; force-start skips wakeup wait
  → goes directly to send mode).
- **slide-prefs.spec.js** — already covered by Plan 11-03's Settings sub-
  block wiring; Plan 11-04 doesn't change prefs schema.

**Phase 11 hard invariant preserved** — ZERO Rust changes (CLAUDE.md);
`bash scripts/build.sh` exits 0 with wasm artifacts unchanged from Plan
11-03.

No new blockers. Pre-existing parallelism-flake class remains tracked in
`deferred-items.md` for a future hardening sweep (out of scope for Phase
11).

---
*Phase: 11-slide-js-bridge-v1-0-integration*
*Completed: 2026-05-08*
