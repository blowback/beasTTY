---
phase: 09-slide-sender-host-z80-send
plan: 03
subsystem: ui
tags:
  - js
  - dom
  - ui
  - drag-drop
  - dialog
  - file-api
  - cp-m-validation
  - phase-9
dependency_graph:
  requires:
    - phase-9-plan-02 (transport/slide.js enterSendMode + tx-sink writeSlideFrameAwaitable + main.js boot wiring exposing window.__slide.enterSendMode + __slideGetStateForTests)
    - phase-8 (wireSlideDispatcher boot order — Plan 09-03 wires file-source AFTER wireSlideDispatcher)
    - phase-6 (top-bar text-button pattern for [↑ Send file]; [data-scrolled-back] attribute idiom mirrored as [data-drop-target])
    - phase-4 (D-16 mousedown preventDefault focus retention pattern)
    - phase-3 (CSS custom property tokens --chrome-bg/fg/accent/border + [data-focused] attribute idiom)
  provides:
    - Top-bar [↑ Send file] button + adjacent hidden multi-file <input> in #top-bar
    - #drop-overlay div parented to #terminal-wrapper; visibility toggled via [data-drop-target] attribute
    - <dialog id="send-modal"> rewrite/rejection confirm modal (native browser <dialog>)
    - ~120 lines CSS extending index.html style block (drop overlay, modal, top-bar disabled rule)
    - www/input/file-source.js (NEW, ~430 lines) with 6 exports — wireFileSource + 3 pure functions + 2 test introspection
    - validateCpmFilename / truncateCpm83 / packSendMetadata as testable pure-function exports
    - Drag-drop event lifecycle on #terminal-wrapper (4 handlers + dragDepth counter Pitfall 8)
    - showConfirmModal Promise-returning native <dialog> flow with focus restoration + click-outside dismiss
    - Button-state observer (200ms setInterval) toggling top-bar button disabled + label per window.__slide state
    - main.js boot wiring: wireFileSource AFTER wireSlideDispatcher; window.__fileSource exposed for Plan 09-04 Playwright introspection
  affects:
    - 09-04 Playwright sender suite (will assert picker click → modal → enterSendMode flow + drag-drop overlay + non-file silent rejection + all-rejected disabled-Send state)
    - 11-* (SLIDE-11 chip "Transfer in progress — cancel first" replaces silent-ignore-during-active-session; SLIDE-14 swallow-echo filter; SLIDE-25/26 floating chip will read file_idx/total_files/bytes_in_file_done/bytes_in_file_total introspection that already exists)
    - 12-* (SLIDE-36 collision rename UX layered on showConfirmModal; SLIDE-12 drag-drop vs pointer-select isolation regression spec)
tech-stack:
  added: []
  patterns:
    - dependency-injection initializer (paste-pump.js / scroll-state.js precedent extended to Phase 9)
    - drag-drop dragDepth counter for nested-children dragenter/dragleave noise (Pitfall 8)
    - silent rejection at dragenter for non-file drags (D-04 — dataTransfer.types.includes('Files'))
    - native <dialog>.showModal() Promise-wrapped flow with returnValue 'send' / 'cancel'
    - click-outside-to-dismiss via dialog click event target === dialog (browser top-layer pattern)
    - focus restoration on modal close (#terminal-wrapper if sent, top-bar button if cancelled)
    - 200ms setInterval polling getSlideState() for button-state observer (replaces event-bus design)
    - [data-drop-target="true"] CSS attribute idiom on #terminal-wrapper (mirror of [data-focused] / [data-scrolled-back])
    - native <dialog>::backdrop styling + <dialog> top-layer stacking (Chromium-only; PROJECT.md polite-fail covers older browsers)
    - per-theme alpha tint via paired RGB literals (clean rgba(127,219,202,0.10) + crt rgba(51,255,102,0.10))
key-files:
  created:
    - www/input/file-source.js
  modified:
    - www/index.html
    - www/main.js
decisions:
  - Plan 09-03 implements CONTEXT D-01 (top-bar text button), D-03 (drop overlay), D-04 (silent non-file rejection), D-05 (<dialog> confirm modal), D-06 (CP/M-invalid set), D-07 (8.3 truncation), D-09 (metadata blob format), D-18 (button-state observer) verbatim from UI-SPEC §Copywriting + §Layout
  - All UI copy strings copied verbatim from 09-UI-SPEC.md §Copywriting — NO paraphrasing. Verified by grep: "Drop file(s) to send via SLIDE", "Don't send", "All files rejected — see details below.", "↑ Send file", "(sending…)", "Transfer in progress — wait for completion", "Send 0 files", "Sending {N} file{s} via SLIDE"
  - All UI-SPEC LOCKED CSS values copied verbatim — drop overlay 2px dashed accent border, 10% accent tint per-theme RGB literals, modal max-width 560px / max-height 60vh, ::backdrop rgba(0,0,0,0.65), <li> 12px / 1.5 line-height (sub-4 exception), muted reason rgba(255,255,255,0.6), top-bar button:disabled (NEW :disabled rule)
  - file-source.js uses dependency injection (enterSendMode + getSlideState passed via wireFileSource opts) instead of module-level imports — mirrors paste-pump.js pattern; enables test mocks; main.js owns the cross-module composition
  - Native <dialog> Esc-cancel comes free; no page-level Esc listener added in Phase 9 (Phase 10 Esc-cancel-disambiguation chain layers on top per T-09-03-04 disposition)
  - Button-state observer is 200ms setInterval (not event-driven) — chosen because the existing wireSlideDispatcher mode-flip path doesn't emit a JS-side event; Phase 11's chip lifecycle may add one. setInterval(200ms) is cheap (~5 polls/s) and event-loop-friendly.
  - dragDepth counter starts at 0; increment on dragenter (only set [data-drop-target] on transition 0→1); decrement on dragleave (only remove on transition 1→0); reset to 0 on drop. Pitfall 8 standard idiom.
  - Modal initial focus on Cancel button (UI-SPEC §Interaction safer-default) — prevents accidental Send on Enter key; user must Tab to Send to confirm.
  - Click-outside-to-dismiss check: `e.target === modalElRef` works because the native <dialog>'s click event bubbles up from internal children with non-dialog targets; only direct backdrop clicks land on the dialog element itself (browser top-layer behavior).
  - Focus restoration on modal close: `wrapperEl.focus()` if user clicked Send (ready to type), `topBarSendBtn.focus()` if user cancelled (so they can re-engage). UI-SPEC §Focus retention.
  - Files with leading-dot rejected as "leading-dot dotfile" (CP/M doesn't permit; matches D-07).
  - Surrogate pair handling in validateCpmFilename: high surrogate (0xD800-0xDBFF) > 0x80, so the >=0x80 check rejects the first half — correct outcome (no surrogate pair filename can survive validation).
  - validateCpmFilename uses charCodeAt (UTF-16 code unit) for the >=0x80 check which differs from "byte >= 0x80 in UTF-8 encoding". This is intentional and is documented in the function's JSDoc — it actually rejects MORE strings than a pure UTF-8 byte check would (any non-ASCII codepoint goes via UTF-16 codes 0x80-0xFFFF, all > 0x7F), which is the desired safe behavior for CP/M.
  - packSendMetadata uses TextEncoder for name bytes — even though validateCpmFilename has already constrained names to pure ASCII (codepoints 0x20-0x7F), TextEncoder is the canonical UTF-8 encoder and emits the same single-byte sequence for ASCII, so no behavior change. This sets up Phase 12 if multibyte filenames ever become permissible.
metrics:
  duration: 12min
  completed: 2026-05-08
  tasks_completed: 3
  commits: 3 (3 feat — no test commits because TDD per-task RED gate is "the dependency it consumes (Plan 09-02 surface) is already shipped", so each task committed as a single feat with its own acceptance grep checks)
  files_changed: 3 (1 created — www/input/file-source.js; 2 modified — www/index.html + www/main.js)
  tests_added: 0 net-new automated tests (Plan 09-04 Wave 0 backlog owns input/file-source.spec.js + transport/slide-sender.spec.js — see VALIDATION ❌ W0 markers); pure-function smoke verification via node --input-type=module REPL during Task 2 confirms validateCpmFilename / truncateCpm83 / packSendMetadata correctness inline
requirements-completed: []
---

# Phase 9 Plan 03: File-source UI — picker + drag-drop + CP/M validation + confirm modal

**Native top-bar `[↑ Send file]` button + `<input type="file" multiple>` picker + `[data-drop-target]` drag-drop overlay on `#terminal-wrapper` + `<dialog>` rewrite/rejection confirm modal, all driven by a NEW 430-line `www/input/file-source.js` module owning event lifecycle + CP/M 8.3 validation/truncation + D-09 metadata packing + button-state observer.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-08T01:14:00Z (after reading plan + UI-SPEC + RESEARCH + 09-02 SUMMARY)
- **Completed:** 2026-05-08T01:22:00Z
- **Tasks:** 3 (all autonomous — Task 1 + 2 + 3)
- **Files modified:** 3 (1 created — `www/input/file-source.js`; 2 modified — `www/index.html` + `www/main.js`)

## Accomplishments

- Top-bar `[↑ Send file]` button + hidden multi-file input wired into `#top-bar` between `#clear-button` and `#theme-toggle` per UI-SPEC §Layout frequency-gradient ordering. The `↑` is U+2191 UPWARDS ARROW; the disabled-state suffix `(sending…)` uses U+2026 ellipsis (matches Phase 5 `Connecting…` convention). Tooltip pair locked verbatim from UI-SPEC §Copywriting.
- Drag-drop overlay div parented to `#terminal-wrapper`, hidden by default, visible when `[data-drop-target="true"]` attribute set on the wrapper. CSS uses 2px dashed `var(--chrome-accent)` border + 10% accent tint with paired per-theme RGB literals (clean `rgba(127,219,202,0.10)` + CRT `rgba(51,255,102,0.10)`). Centered text `Drop file(s) to send via SLIDE` matches REQUIREMENTS SLIDE-09 verbatim. `pointer-events: none` keeps pointer-select working underneath when no drag is in progress.
- Native `<dialog id="send-modal">` element appended before `</body>` with title/list/hint/footer scaffolding. CSS sets `max-width: 560px`, `max-height: 60vh`, `::backdrop rgba(0,0,0,0.65)`, `<li>` 12px / 1.5 line-height (sub-4 exception per UI-SPEC §Spacing), muted reason `rgba(255,255,255,0.6)`. All locked UI-SPEC §Color values verbatim.
- `www/input/file-source.js` (NEW, 430 lines) with 6 exports: `wireFileSource`, `validateCpmFilename`, `truncateCpm83`, `packSendMetadata`, `__resetForTests`, `__getStateForTests`. Pure functions verified via `node --input-type=module` smoke during Task 2 — UI-SPEC verbatim error strings produced (`"invalid CP/M character '?'"`, `"control character 0x05"`, `"non-ASCII byte 0xe9"`, `"empty filename"`, `"leading-dot dotfile"`); CP/M 8.3 truncation correct for all 6 RESEARCH test cases; D-09 metadata layout verified at byte level.
- Drag-drop handlers (4 listeners on `#terminal-wrapper`) with `dragDepth` counter (Pitfall 8) for nested-children noise; D-04 silent rejection at dragenter for non-file drags via `dataTransfer.types.includes('Files')`. `isSessionActive()` short-circuits during pendingSendSession or `mode==='send'` (UI-SPEC §Drag-drop during active SLIDE session — Phase 9 silent ignore; Phase 11 SLIDE-11 chip layers on top).
- `showConfirmModal` Promise-returning native `<dialog>` flow: builds `<li>` rows with `.orig` / `.rewritten` / `.reason` classes; sets `hint.hidden = false` + `sendBtn.disabled = true` + `sendBtn.textContent = "Send 0 files"` for all-rejected (n=0) state; initial focus on Cancel button (UI-SPEC §Interaction safer default); focus restoration on close (`#terminal-wrapper.focus()` if Send confirmed, `top-bar-button.focus()` if cancelled).
- Button-state observer (200ms `setInterval`) reads `getSlideState()` and toggles top-bar button `disabled` + `textContent` + `title` when `pendingSendSession` is set OR `mode === 'send'` per UI-SPEC §Top-bar button state machine. Re-enables when state returns to `terminal`.
- `main.js` boot wiring: multi-line import for `wireFileSource` + reset/getState helpers from `./input/file-source.js`; 8 `getElementById` calls for the new Phase 9 DOM refs; `wireFileSource({...})` call AFTER `wireSlideDispatcher({...})` (line 432 follows line 393) so file-source's injected `enterSendMode` reaches the already-wired dispatcher; `window.__fileSource = { __resetForTests, __getStateForTests }` exposed for Plan 09-04 Playwright introspection.

## Task Commits

Each task committed atomically:

1. **Task 1: index.html DOM + CSS additions** — `14c7148` (feat)
2. **Task 2: NEW www/input/file-source.js** — `67fb108` (feat)
3. **Task 3: main.js boot wiring** — `d76bcb5` (feat)

## Files Created/Modified

- `www/index.html` (modified) — Top-bar `[↑ Send file]` button + adjacent `<input type="file" multiple hidden>` slotted between `#clear-button` and `#theme-toggle`. `<div id="drop-overlay" aria-hidden="true">` appended to `#terminal-wrapper` after `#scrollback-indicator`. `<dialog id="send-modal" aria-labelledby="send-modal-title">` with title/list/hint/footer appended before `</body>`. ~120 lines CSS appended to existing inline style block — all UI-SPEC §Color/§Typography/§Spacing locked tokens verbatim.
- `www/input/file-source.js` (created, 430 lines) — Public exports: `wireFileSource`, `validateCpmFilename`, `truncateCpm83`, `packSendMetadata`, `__resetForTests`, `__getStateForTests`. Module-scope state: dragDepth, ref slots for wrapper/picker/modal/title/list/hint/cancel/send/enterSendModeFn/getSlideStateFn/buttonStateInterval. Wires picker click + change, drag-drop on wrapper (4 listeners), modal cancel/send/click-outside, button-state observer (200ms setInterval).
- `www/main.js` (modified) — Multi-line import block (mirrors paste-pump.js / slide.js style); 8 `document.getElementById` calls for Phase 9 DOM refs; `wireFileSource({...})` call AFTER `wireSlideDispatcher`; `window.__fileSource` introspection export.

## Decisions Made

- **DI pattern over module imports.** `file-source.js` accepts `enterSendMode` + `getSlideState` via `wireFileSource` opts rather than `import`-ing them directly from `transport/slide.js`. Mirrors `paste-pump.js`'s `sampleBell` / `drainHostReply` / `requestFrame` injection pattern; enables test mocks; keeps `file-source.js` decoupled from the slide.js / wasm pkg boot order.
- **Button-state observer is `setInterval` polling, not event-driven.** The existing `wireSlideDispatcher` mode-flip path doesn't emit a JS-side event (Phase 8 D-09 mode flip is synchronous SM-internal). 200ms polling is cheap and avoids retrofitting an event bus. Phase 11's chip lifecycle may add a proper observer pattern.
- **Click-outside-to-dismiss via `e.target === modalElRef`.** Native `<dialog>` click events bubble from internal children with non-dialog targets; only direct backdrop clicks land on the dialog element itself. Avoids per-element coordinate math (PointerEvent.clientX/Y vs dialog getBoundingClientRect).
- **Initial modal focus on Cancel (not Send).** UI-SPEC §Interaction safer-default — prevents accidental Send on Enter key; user must Tab once to confirm. Matches OS-native dialog UX where the "neutral" choice is keyboard-default.
- **Focus restoration asymmetric on close.** `wrapperEl.focus()` if Send confirmed (user is ready to type into the terminal — auto-typed `B:SLIDE R\r` will appear; subsequent typing should reach the terminal). `topBarSendBtn.focus()` if cancelled (user can re-engage by retrying). UI-SPEC §Focus retention.
- **`dragDepth` counter idiom.** dragenter/dragleave fire for child elements as well as the wrapper itself (browser quirk); naive `setAttribute(...)` would oscillate during a drag. Counter increments only on transition 0→1 (set attribute) and decrements only on transition 1→0 (remove attribute); drop resets to 0. Pitfall 8 standard idiom.
- **Surrogate pair handling correct by accident.** `validateCpmFilename` uses `charCodeAt` (UTF-16 code unit). High surrogates (0xD800-0xDBFF) and low surrogates (0xDC00-0xDFFF) both exceed the `>= 0x80` threshold, so any astral character (e.g., emoji codepoints encoded as surrogate pairs) gets rejected on the first surrogate. Correct outcome (CP/M cannot represent astral chars; reject early).
- **Reason strings exactly match UI-SPEC modal rejection items.** No paraphrasing. `"control character 0x{HH}"`, `"non-ASCII byte 0x{HH}"`, `"invalid CP/M character '{ch}'"`, `"leading-dot dotfile"`, `"empty filename"` — all verified by smoke test.
- **`packSendMetadata` uses TextEncoder + DataView.** TextEncoder for name bytes (canonical UTF-8 encoder; for the constrained ASCII output of validateCpmFilename, equivalent to charCodeAt single-byte writes). DataView for LE u32 file_count + name_len + size — `setUint32(offset, value, true)` is the standard idiom. No `Buffer` import (browser-side; no Node dependency).

## Deviations from Plan

None — plan executed exactly as written. All 3 tasks completed cleanly; no Rule 1/2/3/4 deviations needed.

The Task 3 acceptance criterion `grep -c 'import.*wireFileSource' www/main.js returns 1` would not match my multi-line import block (which is the established style for paste-pump.js, slide.js, tx-sink.js — all multi-line imports in main.js). The semantic intent (wireFileSource is imported) is clearly satisfied — the import statement spans lines 84-89 and is verified by `grep -Pzo '(?s)import\s*\{[^}]*wireFileSource[^}]*\}\s*from'`. This is a planning-time grep precision issue, not an implementation issue. All 11 other Task 3 grep checks pass exactly as specified.

## Issues Encountered

The `npm run test:fast` run after Task 2 surfaced one transient failure on `tests/transport/slide-dispatcher.spec.js:134:5 SLIDE-05 dispatcher routing recv-mid-stream-wakeup-passthrough` — same parallel-execution flake pattern logged in 09-02 SUMMARY for `tests/input/focus-retention.spec.js`. The test passed in isolation (`npx playwright test ... -g "recv-mid-stream-wakeup-passthrough"` → 1/1 green) and on the immediately subsequent full re-run (65/65 green). Logged as inherited cross-spec parallel flake, not a Plan 09-03 regression. Final verification runs (Task 3) show 65/65 green deterministically.

## User Setup Required

None — no external service configuration required.

**Hard-reload requirement (per MEMORY.md `project_wasm_cache_workflow`):** Plan 09-03 changes are JS + HTML + CSS only — no wasm rebuild needed. A soft reload picks up the new file-source.js + index.html + main.js. (Plan 09-02 did require hard-reload for the new `enter_send_mode` / `feed_send_chunk` wasm exports; Plan 09-03 does not.)

## Pitfalls Addressed

- **Pitfall 8 (dragDepth counter for nested-children dragenter/dragleave noise):** `dragDepth` increments on dragenter (set `[data-drop-target]` only on 0→1 transition); decrements on dragleave (remove only on 1→0); reset to 0 on drop. Without this, naive setAttribute(...) would oscillate as the drag passes over child elements (`#bell-overlay`, `#scanlines`, `#scrollback-indicator`).
- **Pitfall 3 (auto-type order-critical) — MITIGATED UPSTREAM IN 09-02:** Plan 09-03's `enterSendMode({ files })` call lands in `transport/slide.js`'s already-shipped function, which (per Plan 09-02 line 379 vs 383) calls `pushTxBytes(AUTO_SEND_COMMAND)` BEFORE `pendingSendSession = { metadata, fileBytes }`. Plan 09-03 does not need to re-verify; the ordering is locked at the slide.js layer.
- **D-04 silent rejection at dragenter for non-file drags:** `isFileDrag(ev)` (returns true ONLY when `dataTransfer.types.includes('Files')`) is the first guard in every drag handler. Non-file drags (text, URL, HTML, JSON, iframe) never preventDefault and never set `[data-drop-target]`. Verified by inspection of the four handlers.
- **T-09-03-01 filename injection structurally closed:** Plan 09-02's `transport/slide.js` auto-types the static literal `B:SLIDE R\r` ONLY; filenames travel via the SLIDE protocol header frame AFTER handshake. Plan 09-03's `validateCpmFilename` adds defense-in-depth via the CP/M-invalid set + control-character check, but the structural separation in 09-02 is the primary mitigation.
- **T-09-03-02 CP/M-invalid character bypass:** `validateCpmFilename` rejects null bytes (codepoint 0x00 < 0x20), UTF-8 multi-byte high bytes (codepoint >= 0x80), and the explicit CP/M-invalid set. Rejection happens BEFORE the modal is shown — the surviving array is reduced; `enterSendMode` receives ONLY validated names.
- **T-09-03-04 modal Esc-cancel:** Native `<dialog>` Esc-cancel is built-in browser behavior — fires `cancel` event on the dialog and closes via `dialog.close('')`. No page-level Esc listener added. Plan 09-04 Playwright will assert Esc closes the modal as cancel.
- **T-09-03-05 drop during active SLIDE session:** `onDrop` / `onDragEnter` / `onDragOver` / `onDragLeave` all check `isSessionActive()` BEFORE preventDefault and BEFORE setting `[data-drop-target]`. During an active session, drops are silently consumed.

## Self-Check: PASSED

- File `www/input/file-source.js` exists (430 lines) — verified
- File `www/index.html` modified (now 864 lines, was 698) — verified
- File `www/main.js` modified (now 699 lines, was 657) — verified
- Commits `14c7148` (Task 1), `67fb108` (Task 2), `d76bcb5` (Task 3) all present in `git log` — verified
- `grep -c 'id="send-file-button"' www/index.html` → 1 (verified)
- `grep -c '↑ Send file' www/index.html` → 3 (≥1 — verified; 1 button label + 2 in CSS comments)
- `grep -c 'data-drop-target' www/index.html` → 3 (≥1 CSS attribute selector — verified)
- `grep -c "Drop file(s) to send via SLIDE" www/index.html` → 1 (verified)
- `grep -c "Don't send" www/index.html` → 1 (verified)
- `grep -c 'export function wireFileSource' www/input/file-source.js` → 1 (verified)
- `grep -c 'export function validateCpmFilename' www/input/file-source.js` → 1 (verified)
- `grep -c 'export function truncateCpm83' www/input/file-source.js` → 1 (verified)
- `grep -c 'export function packSendMetadata' www/input/file-source.js` → 1 (verified)
- `grep -c 'wireFileSource' www/main.js` → 2 (≥2 import + call — verified)
- Multi-line import: `import { wireFileSource, ... } from './input/file-source.js'` block at lines 84-89 — verified
- `wireFileSource({` at line 432 follows `wireSlideDispatcher({` at line 393 (ORDER OK) — verified
- `cd www && npm run test:fast`: 65/65 green — verified
- `cargo test --workspace`: 258/258 green — verified
- `bash scripts/build.sh`: exits 0 — verified
- Pure-function smoke (node --input-type=module): all 4 functions return expected outputs including UI-SPEC verbatim error strings — verified

## Plan 09-04 Unblocked

Plan 09-04 (Playwright sender Wave-3 test suite + assertions for SLIDE-07/08/09/10/13/15/16) can now begin. The DOM + JS surface it asserts against is in place:

- `[↑ Send file]` button at `#send-file-button` with `:disabled` styling
- `<input type="file" multiple>` at `#send-file-input`
- `[data-drop-target]` attribute idiom on `#terminal-wrapper` with overlay reveal
- `<dialog id="send-modal">` with `#send-modal-title` / `#send-modal-list` / `#send-modal-all-rejected-hint` / `#send-modal-cancel` / `#send-modal-send`
- `window.__fileSource.__getStateForTests()` returns `{ dragDepth, dropTargetActive, modalOpen, sendBtnDisabled, sendBtnLabel }` for assertions
- `window.__fileSource.__resetForTests()` clears state for spec-isolation
- `window.__slide.enterSendMode({ files })` already wired via Plan 09-02
- `window.__slide.__getStateForTests()` already exposes `mode` / `hasPendingSendSession` / `file_idx` / `total_files` / `bytes_in_file_done` / `bytes_in_file_total`

The 6 SLIDE-* requirements (SLIDE-07, SLIDE-08, SLIDE-09, SLIDE-10, SLIDE-15, SLIDE-16) remain Pending — Plan 09-03 ships the UI surface; Plan 09-04 will flip them to Complete via the Playwright e2e gate.

The mock SLIDE-receiver bot extension in `www/tests/transport/mock-serial-slide-bot.js` is the primary Plan 09-04 Wave 0 dependency (per VALIDATION.md). The bot will issue `RDY → ACK(0) → ACK(seq) → FIN` echo sequences against `window.__mockReaderPush` so Playwright can assert byte-identical round-trip.

---
*Phase: 09-slide-sender-host-z80-send*
*Plan: 03*
*Completed: 2026-05-08*
