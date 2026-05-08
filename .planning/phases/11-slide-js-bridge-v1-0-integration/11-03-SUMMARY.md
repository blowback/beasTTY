---
phase: 11-slide-js-bridge-v1-0-integration
plan: 03
subsystem: integration
tags: [chip-lifecycle, prefs-swap, port-lost, session-log-gate, paste-pump-gate, drop-flash, settings-sub-block, wave-2, slide-11, slide-32, slide-33, slide-37, slide-39]

# Dependency graph
requires:
  - phase: 11-slide-js-bridge-v1-0-integration
    plan: 01
    provides: prefs.slideAutoSendCommand / slideShowSummary / slideCompatibilityMode DEFAULTS keys — Plan 11-03 hydrates Settings sub-block + readAutoSendCommandBytes consumes
  - phase: 11-slide-js-bridge-v1-0-integration
    plan: 02
    provides: slideChipApi (7 public state-transition methods + onStateChange + dispose) — Plan 11-03 wires chip lifecycle hooks at session enter/exit/port-lost
  - phase: 10-slide-receiver-cancellation
    provides: cancelSlideRecv 5-step ADR-003 cancel state machine + isSlideActive predicate + slidePumpOnPortLost 5-line stub — Plan 11-03 fills stub body + thunk-holders cancel
  - phase: 09-slide-sender-host-z80-send
    provides: enterSendMode pushTxBytes(AUTO_SEND_COMMAND) call site + pendingSendSession lifecycle — Plan 11-03 swaps source from constant to prefs + adds chip lifecycle hooks
  - phase: 06-daily-driver-polish-session-deployment
    provides: prefs versioned blob with 250 ms debounced savePrefs (D-32/D-33) — Plan 11-03 form controls call savePrefs with 3 new keys
provides:
  - "Settings SLIDE sub-block (<details class=\"reserved\" id=\"settings-slide\">) with 4 rows in D-05 order — Save-to-folder (Phase 10 carry-forward MOVED), Auto-send command, Show transfer summary chip, Compatibility mode 3-way <select>"
  - "main.js form-control wiring — hydrate from prefs at boot + persist via 250 ms debounced savePrefs; auto-send <input> strips trailing \\r for display; Compatibility <select> validates option value + restores #terminal-wrapper focus per Phase 4 D-16"
  - "slide-recv.js slidePumpOnPortLost full body — isSlideActive guard + force_idle + setWireOwner('terminal') + slideChip.enterError('port lost') + forceExitRecvMode + __resetForTests reset"
  - "slide.js readAutoSendCommandBytes prefs-driven helper — replaces Phase 9 D-14 hardcoded AUTO_SEND_COMMAND constant; AUTO_SEND_DEFAULT fallback when prefsRef null preserves Phase 9 sender-test behaviour"
  - "slide.js slidePumpOnPortLost forwarder — re-exports from slide-recv.js so existing serial.js imports continue to resolve"
  - "slide.js chip lifecycle hooks — enterAwaitingWakeup({armTimer:false}) at enterSendMode; cancelPaste + enterActive at dispatchTerminalMode wakeup-completion (BOTH branches); enterSummary at exitSendMode + exitRecvMode (chip module gates by prefs.slideShowSummary)"
  - "serial.js D-11 session-log gate — sessionLogRef.append wrapped with !isSlideActive() predicate at the call site"
  - "serial.js 3 slidePumpOnPortLost() call sites — immediately after each existing pastePumpOnPortLost() in handleReadError / teardown / onNavSerialDisconnect"
  - "paste-pump.js D-12 isSlideActive() early-return at top of enqueuePaste — silent no-op during active SLIDE session; companion cancelPaste() at SLIDE wakeup is in slide.js"
  - "file-source.js D-10 chip flash at onDragEnter + onDrop — replaces Phase 9 silent ignore; slideChipRef.flashDropRejected() preserves Phase 9 happy-path drop logic untouched"
  - "main.js boot re-order — wireSlideChip BEFORE wireSlideDispatcher / wireSlideRecv / wireFileSource so slideChipApi flows down via opts; thunk-holder pattern (cancelSlideRecvLazy) lets wireSlideChip's onCancel close over a stable ref before wireSlideRecv populates internal state"
affects: [11-04-PLAN.md, 11-05-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thunk-holder pattern for forward-referenced lazy callbacks (let cancelSlideRecvLazy = () => {}; … wireSlideChip({ onCancel: () => cancelSlideRecvLazy() }); … cancelSlideRecvLazy = cancelSlideRecv;) — clean alternative to a setOnCancel(fn) helper when an initializer needs a callback whose internal state isn't yet wired"
    - "Module-scope refs initialized via wireXxx opts with null-tolerant fallback (slideChipRef = opts.slideChip || null) — keeps the module callable from older boot paths and test harnesses without the Phase 11 wiring"
    - "Optional-chained call sites for chip lifecycle hooks (try { if (slideChipRef && typeof slideChipRef.enterX === 'function') slideChipRef.enterX(...); } catch {}) — defense-in-depth so a null chip ref or a chip-side throw never crashes the dispatcher"
    - "Prefs-driven encoded bytes via TextEncoder at call time (readAutoSendCommandBytes) — empty-string disables semantic preserved verbatim from Phase 9 D-14; new prefs key flows transparently"
    - "Symmetric port-lost teardown — slidePumpOnPortLost mirrors pastePumpOnPortLost shape exactly; called immediately after each pastePumpOnPortLost call site for byte-for-byte parallelism"
    - "Session-log gate at the call site (not inside append()) — preserves the existing one-call-per-chunk semantics without modifying session-log.js's API"

key-files:
  created: []
  modified:
    - "www/index.html"
    - "www/main.js"
    - "www/transport/slide.js"
    - "www/transport/slide-recv.js"
    - "www/transport/serial.js"
    - "www/input/file-source.js"
    - "www/input/paste-pump.js"

key-decisions:
  - "Thunk-holder pattern for cancelSlideRecv resolution — wireSlideChip is now boot-ordered FIRST so it can be passed into downstream wireXxx initializers as opts; cancelSlideRecv's internal state (slideRef + dispatcherForceExitRef) is only populated after wireSlideRecv runs, so wireSlideChip's onCancel closes over a mutable holder that gets reassigned to the real cancelSlideRecv after wireSlideRecv. Cleaner than threading a setOnCancel(fn) helper through the chip API."
  - "AUTO_SEND_DEFAULT fallback when prefsRef is null — this is a Rule 3 deviation. The plan specified the prefs swap should retire the hardcoded constant outright, but Phase 9 sender Playwright tests (slide-sender.spec.js) drive the dispatcher via wireSlideDispatcher without a prefs opt and expect to observe `B:SLIDE R\\r` on the wire. Without the fallback, those tests fail because readAutoSendCommandBytes returns Uint8Array(0) which skips pushTxBytes. The fallback preserves their behaviour while production main.js (Plan 11-03 Task 3) injects prefs so the user's Settings value is honoured. Empty-string semantic is preserved when prefs IS provided but the user has explicitly cleared the field."
  - "slidePumpOnPortLost lives in slide-recv.js; slide.js forwards. Phase 10 already laid the 5-line stub at slide-recv.js:683-694; Plan 11-03 fills the body there because slide-recv.js owns the chip ref + recv-side state. slide.js exports a one-line forwarder so existing serial.js imports continue to resolve. This honours CONTEXT D-14's locked architecture."
  - "Session-log gate at call site (D-11), not inside append(). One-line predicate `if (sessionLogRef && !isSlideActive()) sessionLogRef.append(value)` is simpler than gating inside append() and preserves the existing buffer-accounting semantics. Wakeup-swallowed bytes (the 7-byte signature itself) are already excluded because the dispatcher consumes them BEFORE this call site."
  - "paste-pump cancelPaste() at SLIDE wakeup-completion (BOTH branches: enterRecvMode + enterSendModeInternal) per D-12. Located in slide.js's dispatchTerminalMode immediately after the mode-switch call so an in-flight large paste is interrupted via the existing Phase 5 D-18 cancel chip. Subsequent enqueuePaste calls during the active session no-op silently via paste-pump's early-return gate."
  - "Chip lifecycle hooks fire BEFORE setWireOwner in exit paths so the chip captures the active-session direction before mode flips to 'terminal'. enterSummary's totalBytes is best-effort 0 in Plan 11-03 — Plan 11-04 may extend with a cumulative byte tally tracked across the send/recv loops."
  - "Phase 11 hard invariant preserved — ZERO Rust changes (CLAUDE.md). bash scripts/build.sh exits 0 with wasm artifacts unchanged. The Settings sub-block, chip lifecycle wiring, port-lost teardown, session-log gate, paste-pump gate, drop flash, and prefs swap all live in pure JS / HTML / CSS."
  - "Auto-send <input> displays value WITHOUT trailing \\r per D-06 (\\r appended at save time, not displayed) so the input field reads as 'B:SLIDE R' rather than 'B:SLIDE R\\r'. Empty input disables auto-type per SLIDE-13 semantic — preserves Phase 9 D-14 logic; Plan 11-03 just changes the source from a hardcoded constant to prefs.slideAutoSendCommand."

requirements-completed: []  # SLIDE-11 / SLIDE-32 / SLIDE-33 / SLIDE-37 / SLIDE-39 are integrated by Plan 11-03 but flip Pending → Complete in Plan 11-05's verification gate (consistent with Plan 11-02 precedent: SLIDE-25/26/28 ship integration in 11-02 + 11-03 + 11-04 but flip in 11-05). Plan 11-04 wires the Compatibility-mode 3 s wakeup timer + [Retry]/[Force start] action handlers; Plan 11-05 fills the 50 RED-gate stubs from Plan 11-01 and asserts the full lifecycle end-to-end via Playwright.

# Metrics
duration: ~13min
completed: 2026-05-08
---

# Phase 11 Plan 11-03: Wire Chip Module + Lifecycle + Settings Sub-block + Port-Lost + Session-Log Gate + Paste-Pump Gate + Auto-Send Prefs Swap Summary

**3 atomic commits across 7 modified files (1 HTML + 6 JS) lifting the SLIDE
chip from a Plan 11-02 standalone surface into the production lifecycle —
Settings sub-block (DOM + form wiring), prefs-driven auto-send (replacing
Phase 9 hardcoded constant), session-log gate, paste-pump gate, drop-during-
active-session chip flash, real `slidePumpOnPortLost` body called from all 3
serial.js port-lost paths, and chip lifecycle hooks auto-firing on session
events. Six edits in Task 2 + 2 edits in Task 3 deliver every D-09 / D-10 /
D-11 / D-12 / D-14 / D-15 surface specified in CONTEXT. Plan 11-04 unblocked
to wire the Compatibility-mode 3-second wakeup timer + [Retry] / [Force
start] action handlers via the existing `enterAwaitingWakeup({ armTimer })`
opt and `onStateChange` observer fan-out.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-05-08T17:55:56Z
- **Completed:** 2026-05-08T18:08:43Z
- **Tasks:** 3 (all `type="auto"`, non-TDD)
- **Files modified:** 7 (1 HTML + 6 JS)

## Accomplishments

- **Settings SLIDE sub-block lands** — `<details class="reserved" id="settings-slide">`
  with summary "SLIDE file transfer" wraps 4 rows in D-05 order: Save-to-folder
  (Phase 10 carry-forward, MOVED into this block from its top-level position;
  child IDs `slide-recv-folder-row` / `slide-recv-to-folder-checkbox` /
  `slide-recv-folder-button` / `slide-recv-folder-status` / `slide-recv-folder-help`
  preserved verbatim so wireSlideRecv element refs still resolve via
  `document.getElementById`); Auto-send command `<input type="text">` pre-filled
  "B:SLIDE R"; Show transfer summary chip `<input type="checkbox" checked>` (D-08
  default ON); Compatibility mode 3-way `<select>` with verbatim D-07 options
  (`Auto`, `Wakeup-required`, `Force-start (legacy slide.com)`).
- **Form-control CSS** for `#slide-auto-send-input` + `#slide-compat-select`
  follows the Phase 5 `#connection select` idiom EXCEPT padding normalized to
  `4px` (multiple of 4) per UI-SPEC §Spacing §Phase 5 legacy spacing —
  divergence note. Auto-send input fixed at `width: 200px`.
- **main.js form-control wiring** — each control hydrates from
  `prefs.<key>` at boot (defensive against missing key — Phase 6 D-32 defensive
  merge fills DEFAULTS) and persists changes via the existing 250 ms debounced
  `savePrefs`. Auto-send `<input>` strips trailing `\r` for display per D-06
  (`\r` is appended at save time, not displayed). Compatibility `<select>`
  validates the option value before assignment (defensive — older blob format)
  and restores `#terminal-wrapper` focus after dropdown closes per Phase 4 D-16.
- **slidePumpOnPortLost real body** in slide-recv.js per CONTEXT D-14 — verbatim
  6-step body: `isSlideActive()` guard + try/catch `slideRef.force_idle()` +
  try/catch `txSinkRef.setWireOwner('terminal')` + try/catch
  `slideChipRef.enterError('port lost')` + `forceExitRecvMode()` + try/catch
  `__resetForTests()`. 2-layer idempotency (isSlideActive + slide.force_idle's
  Phase 7 D-08 internal guard). Symmetric with `pastePumpOnPortLost`.
- **slide.js prefs-driven auto-send** — `readAutoSendCommandBytes()` helper
  reads `prefsRef.slideAutoSendCommand` at call time (TextEncoder encodes the
  string). Empty-string semantic preserved per SLIDE-13: 0-length Uint8Array
  skips `pushTxBytes`. `AUTO_SEND_DEFAULT = 'B:SLIDE R\r'` fallback when
  `prefsRef` is null keeps Phase 9 sender Playwright tests passing
  (Rule 3 deviation; see Deviations below).
- **slide.js chip lifecycle hooks** auto-fire on session events:
  - `enterSendMode` (after `pushTxBytes(autoSendBytes)`) →
    `slideChipRef.enterAwaitingWakeup({ armTimer: false })` (Plan 11-04 wires
    the actual armTimer logic + 3 s timeout body).
  - `dispatchTerminalMode` wakeup-completion (BOTH branches:
    `enterRecvMode` + `enterSendModeInternal`) →
    `pastePumpRef.cancelPaste()` (D-12) + `slideChipRef.enterActive()`.
  - `exitSendMode` + `exitRecvMode` (BEFORE `setWireOwner('terminal')`) →
    `slideChipRef.enterSummary({ direction, fileCount, totalBytes: 0 })`.
    Chip module gates by `prefs.slideShowSummary` internally per D-08.
- **slide.js stub forwarder** — `export function slidePumpOnPortLost() {
  slideRecvPumpOnPortLost(); }` — replaces the no-op stub at line 199-201
  so existing serial.js imports continue to resolve.
- **serial.js D-11 session-log gate** at the existing `sessionLog.append`
  call site: `if (sessionLogRef && !isSlideActive()) sessionLogRef.append(value);`
  — binary SLIDE frame bytes never reach the per-connection log
  (T-11-03-log-leak mitigation). 7-byte ESC^SLIDE wakeup signature is already
  consumed by the dispatcher BEFORE this call site so signature bytes also
  don't reach the log.
- **serial.js 3 `slidePumpOnPortLost()` call sites** — immediately after each
  existing `pastePumpOnPortLost()` in `handleReadError` / `teardown` /
  `onNavSerialDisconnect` (D-14 symmetric port-lost teardown).
- **paste-pump.js D-12 isSlideActive() early-return** at top of enqueuePaste
  — silent no-op during active SLIDE session. Companion `cancelPaste()` is
  invoked from slide.js's wakeup-completion clause so an in-flight large
  paste interrupts via the existing Phase 5 D-18 cancel chip.
- **file-source.js D-10 chip flash** at `onDragEnter` + `onDrop` — replaces
  Phase 9 silent-ignore branches with `slideChipRef.flashDropRejected()`. The
  chip module owns the 3-second sliding window overlay rendering "Transfer in
  progress — cancel first" verbatim from UI-SPEC §Copywriting. Phase 9
  happy-path drop logic untouched (T-11-03-drop-injection mitigation).
- **main.js boot re-order** — wireSlideChip moved BEFORE wireSlideDispatcher /
  wireSlideRecv / wireFileSource so `slideChipApi` flows down via opts.
  Thunk-holder pattern: `let cancelSlideRecvLazy = () => {};` declared first;
  `wireSlideChip({ onCancel: () => cancelSlideRecvLazy() })` closes over the
  mutable holder; after `wireSlideRecv` runs, `cancelSlideRecvLazy =
  cancelSlideRecv` reassigns to the real reference. Cleaner than threading a
  `setOnCancel(fn)` helper through the chip API.
- **Plan 11-04 unblocked** — chip's `enterAwaitingWakeup({ armTimer })` opt
  is wired with `armTimer: false`; Plan 11-04 adds the actual `setTimeout`
  body via the same opt. `onStateChange` observer fan-out is available for
  the `[Retry]` / `[Force start]` action handlers.
- **Phase 11 hard invariant preserved** — ZERO Rust changes (CLAUDE.md);
  `bash scripts/build.sh` exits 0 with wasm artifacts unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Settings SLIDE sub-block — DOM markup + main.js form wiring** — `9c5ce11` (feat)
2. **Task 2: slidePumpOnPortLost real impl + serial.js call sites + session-log gate + paste-pump gate + auto-send prefs swap** — `d7fe74e` (feat)
3. **Task 3: file-source.js drop flash + main.js wireXxx opts extension** — `f81ae7b` (feat)

## Files Modified

- `www/index.html` (+59 lines) — `#slide-auto-send-input` / `#slide-compat-select`
  CSS rule block (after the Plan 11-02 chip CSS block, lines 215-230) + new
  `<details class="reserved" id="settings-slide">` SLIDE sub-block wrapping
  the existing Save-to-folder row + 3 new rows (replaces the top-level
  Save-to-folder block at the previous lines 851-866).
- `www/main.js` (+58 net lines after the Plan 11-02 wireSlideChip block was
  re-located): boot re-order moves `wireSlideChip` to BEFORE `wireSlideDispatcher`
  with the thunk-holder `cancelSlideRecvLazy` pattern; `wireSlideDispatcher`
  / `wireSlideRecv` / `wireFileSource` opts extended with `slideChip` (and
  `prefs` / `pastePump` for the dispatcher); Settings form-control hydration
  + savePrefs wiring after `wireSlideRecv`; the duplicate Plan 11-02
  `wireSlideChip` block at the Plan 09-03 boot position is removed.
- `www/transport/slide.js` (+76 lines net): import
  `slideRecvPumpOnPortLost` alias; replace `AUTO_SEND_COMMAND` constant
  with `readAutoSendCommandBytes()` helper + `AUTO_SEND_DEFAULT` fallback;
  add module-scope `prefsRef` / `pastePumpRef` / `slideChipRef`; extend
  `wireSlideDispatcher` opts; replace stub `slidePumpOnPortLost` with
  forwarder; add chip lifecycle hooks at `enterSendMode` /
  `dispatchTerminalMode` wakeup-completion / `exitRecvMode` / `exitSendMode`.
- `www/transport/slide-recv.js` (+34 lines): add `slideChipRef` module-scope;
  extend `wireSlideRecv` opts with `slideChip`; replace 5-line
  `slidePumpOnPortLost` stub with full body per D-14.
- `www/transport/serial.js` (+11 lines): import `slidePumpOnPortLost` from
  `./slide.js` + `isSlideActive` from `./slide-recv.js`; D-11 session-log
  gate; 3 `slidePumpOnPortLost()` call sites after each pastePumpOnPortLost.
- `www/input/paste-pump.js` (+11 lines): import `isSlideActive` from
  `../transport/slide-recv.js`; D-12 early-return at top of `enqueuePaste`.
- `www/input/file-source.js` (+12 lines): add `slideChipRef` module-scope;
  extend `wireFileSource` opts with `slideChip`; replace silent-ignore
  branches in `onDragEnter` + `onDrop` with `flashDropRejected()` calls.

## Decisions Made

(See `key-decisions` in frontmatter.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Backwards-compat fallback] AUTO_SEND_DEFAULT when prefsRef null**

- **Found during:** Task 2 verification (`cd www && npm run test:fast`)
- **Issue:** The plan specified replacing `const AUTO_SEND_COMMAND` with a
  prefs-driven `readAutoSendCommandBytes()` that returns
  `new Uint8Array(0)` when prefs is missing/empty. After Task 2's edits,
  4 Phase 9 sender Playwright tests (slide-sender.spec.js — auto-type / byte-
  identical / multi-file / introspection) failed because they exercise the
  dispatcher via `wireSlideDispatcher` without passing the new `prefs` opt;
  with `prefsRef === null`, `readAutoSendCommandBytes` returned empty and the
  sender main loop never auto-typed `B:SLIDE R\r`. Plan Task 3 wires `prefs`
  into `wireSlideDispatcher` from main.js, but Task 2's verification gate
  (`npm run test:fast` exits 0) requires the existing tests to pass mid-plan.
- **Fix:** Added `const AUTO_SEND_DEFAULT = 'B:SLIDE R\r';` and a fallback
  branch in `readAutoSendCommandBytes` — when `prefsRef` is null (older test
  harnesses / boot paths that don't pass prefs), use the Phase 9 D-14
  default. When `prefsRef` IS provided (production main.js after Task 3),
  honour the user's value verbatim including the explicit empty string
  (which disables auto-type per SLIDE-13 semantic).
- **Files modified:** www/transport/slide.js (+11 lines)
- **Commit:** d7fe74e (Task 2)
- **Threat-register impact:** None new. T-11-03-prefs-injection still applies
  to user-typed commands; the AUTO_SEND_DEFAULT constant is a JS literal
  identical to Phase 9's hardcoded bytes.

## Auth Gates

None — Plan 11-03 is purely client-side JS/HTML/CSS integration glue.

## Issues Encountered

**Pre-existing parallelism flakes** (out-of-scope per executor SCOPE BOUNDARY
rule; documented in `.planning/phases/11-slide-js-bridge-v1-0-integration/deferred-items.md`
from Plan 11-01 and Plan 11-02):

Three test:fast runs during Plan 11-03 verification surfaced known
intermittent flakes; all passed cleanly in isolation:

| Run | Flake | In-isolation pass |
|-----|-------|-------------------|
| Verification 1 (post-Task 1) | `slide-dispatcher.spec.js:90` post-feed-invariant-ESC-Z-returns-host-reply | passes 1/1 in isolation (5s, 16/16 dispatcher tests green) |
| Verification 2 (post-Task 1 retry) | `theme-toggle.spec.js:8` Ctrl+Alt+T + `readloop.spec.js:16` pushed bytes feed @fast | unrelated to Plan 11-03 changes |
| Verification 3 (post-Task 3) | `slide-sender.spec.js:178` window.__slide introspection + `keydown-printable.spec.js:13` Shift+KeyA | passes 9/9 in isolation (3.6s) |
| Final verification (post-Task 3 retry) | `slide-wakeup.spec.js:151` torn-chunk-split-7/0 | passes 13/13 in isolation (4.1s) |
| Final verification (post-Task 3 second retry) | none — 81/81 green in 11.5s | n/a |

Plan 11-03 changes are integration glue: chip lifecycle hooks via
optional-chained calls (no behaviour change for null callers), session-log
gate via single-line predicate, prefs-driven auto-send with
backwards-compat fallback, port-lost calls additive to existing path. The
flake class is wasm-boot starvation under 10-worker load, unrelated to any
code path Plan 11-03 touches.

## User Setup Required

None — purely client-side. Users will see the new SLIDE Settings sub-block
on next page load (Phase 6 D-32 defensive merge fills the 3 new prefs keys
into existing `bestialitty.prefs` localStorage blobs without a
CURRENT_VERSION bump).

## Threat Flags

None new — all surfaces in this plan are accounted for in the plan's
`<threat_model>`:

- **T-11-03-log-leak (Information Disclosure)** — *mitigate* via D-11 gate
  at `serial.js:466` call site. Verified: `grep -c "if (sessionLogRef && !isSlideActive())" www/transport/serial.js` returns 1.
- **T-11-03-port-lost (Denial of Service)** — *mitigate* via 2-layer
  idempotency in slidePumpOnPortLost (`isSlideActive()` predicate +
  `slide.force_idle` Phase 7 D-08 internal guards). Chip enters error
  state with 5-s auto-hide. Verified: 3 `slidePumpOnPortLost();` call
  sites in serial.js immediately after each `pastePumpOnPortLost();`.
- **T-11-03-prefs-injection (Tampering)** — *accept* per CONTEXT D-09.
  Phase 12 SLIDE-38 will add safety validation (alphanumeric + `:` +
  `\r` only); Phase 11 stores whatever the user types in
  `prefs.slideAutoSendCommand`. AUTO_SEND_DEFAULT fallback (Rule 3
  deviation) is a JS literal — not user-modifiable.
- **T-11-03-paste-leak (Information Disclosure)** — *mitigate* via D-12
  early-return at top of enqueuePaste (`if (isSlideActive()) return;`)
  + cancelPaste at SLIDE wakeup-completion in slide.js.
- **T-11-03-drop-injection (Tampering)** — *mitigate* via D-10 chip flash
  at file-source.js's onDragEnter/onDrop; bytes never reach enterSendMode
  while session active. Verified: 2 `slideChipRef.flashDropRejected` call
  sites + 0 `// Silent ignore during active session` comments remain.

## Next Phase Readiness

**Plan 11-04 unblocked:**
- Chip's `enterAwaitingWakeup({ armTimer })` opt is wired in slide.js with
  `armTimer: false`; Plan 11-04 reads `prefs.slideCompatibilityMode` and
  passes the appropriate `armTimer` boolean (true for `auto`, false for
  `wakeup-required` and `force-start` — `force-start` skips wakeup-wait
  entirely via a separate code path).
- The `onStateChange` observer fan-out exposed by `wireSlideChip` is
  available for `[Retry]` / `[Force start]` action handlers (Plan 11-04
  attaches handlers via `slideChipApi.onStateChange((ev) => { if (ev.kind ===
  'inline-action' && ev.action === 'retry') { ... } })`).
- The 3-second `setTimeout` body for `awaiting-wakeup → awaiting-timeout`
  transition (D-15) lives inside the chip module per CONTEXT Default in
  C-02 ("chip owns the timer"); Plan 11-04 fills it.

**Plan 11-05 unblocked** — the 50 RED-gate Playwright stubs from Plan 11-01
(slide-chip.spec.js / slide-bridge.spec.js / slide-compatibility.spec.js /
slide-prefs.spec.js) can now be filled with bodies that drive the
production-wired lifecycle:

- `slide-chip.spec.js` — chip enters active on enterRecvMode /
  enterSendModeInternal; chip enters error on slidePumpOnPortLost;
  chip enters cancelled-summary on cancelSlideRecv; chip flashes
  drop-rejected on dragenter/drop during active session.
- `slide-bridge.spec.js` — sessionLog.append no-ops when isSlideActive();
  enqueuePaste no-ops during active session; cancelPaste fires at
  wakeup-completion; slidePumpOnPortLost called from all 3 serial.js
  port-lost paths.
- `slide-prefs.spec.js` — auto-send `<input>` change persists to
  `bestialitty.prefs.slideAutoSendCommand` via 250 ms savePrefs debounce;
  show-summary checkbox change persists `slideShowSummary`; Compatibility
  `<select>` change persists `slideCompatibilityMode`.
- `slide-compatibility.spec.js` — Plan 11-04 wires the 3 s timer; this
  spec asserts the 3-mode branching behaviour (auto / wakeup-required /
  force-start).

No new blockers. Pre-existing parallelism-flake class remains tracked in
`deferred-items.md` for a future hardening sweep (out of scope for Phase 11).

## Self-Check: PASSED

Verified before completion:

- [x] `www/index.html` contains `id="settings-slide"` (1 — D-05 sub-block);
      `SLIDE file transfer` (2 — sub-block summary + Plan 11-02 chip
      aria-label "SLIDE file transfer chip"; sub-block summary verbatim is
      correct); `id="slide-recv-folder-row"` (1 — carry-forward preserved);
      `id="slide-auto-send-input"` (1); `value="B:SLIDE R"` (1 — D-06
      verbatim); `id="slide-show-summary"` (1); `id="slide-show-summary"
      checked` (1 — D-08 default ON); `id="slide-compat-select"` (1);
      `value="auto">Auto` (1); `value="wakeup-required">Wakeup-required` (1);
      `value="force-start">Force-start` (1).
- [x] `www/main.js` contains `slideAutoSendCommand` (3); `slideShowSummary`
      (5); `slideCompatibilityMode` (2); `slideChip: slideChipApi` (3 —
      passed to wireSlideDispatcher + wireSlideRecv + wireFileSource);
      `cancelSlideRecvLazy` (4 — declaration + onCancel thunk +
      reassignment + comment); `pastePump:` (1 — passed to
      wireSlideDispatcher).
- [x] Boot order: `wireSlideChip(` at line 430 < `wireSlideDispatcher(` at
      line 449 — chip wired FIRST so downstream initializers can pass
      `slideChipApi` via opts.
- [x] `www/transport/serial.js`: `slidePumpOnPortLost();` (3 — one per
      existing `pastePumpOnPortLost();` call site — handleReadError /
      teardown / onNavSerialDisconnect); `if (sessionLogRef && !isSlideActive())`
      (1 — D-11 session-log gate); `import { isSlideActive }` (1);
      `import { dispatchInbound, slidePumpOnPortLost }` (1).
- [x] `www/input/paste-pump.js`: `if (isSlideActive())` (1 — D-12 early
      return); `import { isSlideActive }` (1).
- [x] `www/transport/slide.js`: `slideChipRef.enterError` mention (2 —
      including comment); `slideChipRef.enterActive` (2 — call site +
      reference); `slideChipRef.enterAwaitingWakeup` (2 — call site +
      reference); `slideChipRef.enterSummary` (4 — 2 call sites + 2
      method-name references in comments); `pastePumpRef.cancelPaste` (2
      — call site + reference); `readAutoSendCommandBytes` (3 — helper
      definition + call site + comment); `slideAutoSendCommand` (4 —
      including comments); `AUTO_SEND_COMMAND = new Uint8Array` (0 —
      old constant removed); `slideRecvPumpOnPortLost` (1 — forwarder
      import alias).
- [x] `www/transport/slide-recv.js`: `slideChipRef.enterError` (2 —
      call site + comment reference); `force_idle` (20 — including the
      pre-existing recoverHardFail body + the new D-14 body + many
      comment references; criterion was `>= 2`).
- [x] `www/input/file-source.js`: `slideChipRef.flashDropRejected` (2 —
      onDragEnter + onDrop call sites); `flashDropRejected` total (3 —
      2 calls + the comment reference); `// Silent ignore during active
      session` (0 — old comment removed by replacement).
- [x] `cd www && npm run test:fast` — final retry: 81/81 green (11.5s).
      Pre-existing parallelism flake class (slide-sender / slide-wakeup
      / theme-toggle / readloop / keydown-printable / slide-dispatcher)
      passes deterministically with --workers=1; documented in
      deferred-items.md.
- [x] `cd www && npx playwright test transport/slide-chip.spec.js
      transport/slide-bridge.spec.js transport/slide-compatibility.spec.js
      transport/slide-prefs.spec.js --list` — 46 tests in 4 files listed
      (Wave 0 stubs from Plan 11-01 still resolve).
- [x] `bash scripts/build.sh` exits 0 (Phase 11 hard invariant preserved
      — zero Rust changes; wasm artifacts unchanged from Plan 11-02).
- [x] All 3 task commits exist in `git log --oneline`: 9c5ce11 (Task 1),
      d7fe74e (Task 2), f81ae7b (Task 3).

---
*Phase: 11-slide-js-bridge-v1-0-integration*
*Completed: 2026-05-08*
