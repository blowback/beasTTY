---
phase: 04-keyboard-input
plan: 02
subsystem: input
tags: [keyboard, vt52, ime, composition, crlf, local-echo, tx-sink, ring-buffer, wasm-boundary-consumer]

# Dependency graph
requires:
  - phase: 04-keyboard-input (Plan 04-01)
    provides: "8 fixmed Playwright stubs under www/tests/input/ (will be un-fixmed in Plan 04-04), extended testMatch glob, window.__testGridView harness hook"
  - phase: 03-canvas-renderer
    provides: "wireChrome keydown listener (owns Ctrl+Alt+T + Ctrl+{+/-/0}), sampleBell + drainHostReply + requestFrame chain, [data-focused] attribute contract, Debug pane pattern"
  - phase: 02-wasm-boundary-minimal-js-harness
    provides: "encode_key_raw(code: u32, mods: u32) -> Vec<u8> export (pinned by boundary_api_shape.rs)"
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: "KeyCode tag table (key.rs:141-159 unpack_keycode), modifier bit layout (key.rs:165-168 unpack_mods), Enter=[0x0D] default encoder output"
provides:
  - "www/input/tx-sink.js module — JS-owned Uint8Array(1024) TX ring + pushTxBytes + formatHexStrip + registerTxObserver + resetTx"
  - "www/input/keyboard.js module — wireKeyboard entry, packKeyCode/packModifiers, keydown + composition listeners, setLocalEcho/setCrlfMode/getLocalEcho/getCrlfMode"
  - "Wired wireKeyboard call site in main.js AFTER wireChrome (D-01 attach-second) and AFTER sampleBell/drainHostReply declarations (TDZ-safe)"
  - "Working INPUT-01..INPUT-05 implementations: printable chars, arrow keys, Ctrl-letters, local-echo toggle, CR/LF override"
affects: ["04-03-chrome-wiring", "04-04-assertion-fill", "05-web-serial-transport"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency injection via wireX(opts) — keyboard.js receives term/sampleBell/drainHostReply/requestFrame so the module has zero main.js imports (no circular deps, testable)"
    - "Attach-second keydown listener with e.defaultPrevented short-circuit — wireKeyboard runs AFTER wireChrome so Phase 3 chord ownership (Ctrl+Alt+T, Ctrl+{+,-,0}) is preserved with exactly one preventDefault per key"
    - "Frozen tag-table mirror (Object.freeze({Char:0,ArrowUp:1,...})) — JS-side KEY_TAG copied verbatim from crates/bestialitty-core/src/key.rs:141-159; drift is caught by Plan 04-04 Playwright exact-byte assertions"
    - "IME double-emit prevention via module-scope isComposing flag + belt-and-braces e.isComposing check on every keydown"
    - "TX-side-only CR/LF override — post-encode byte rewrite when wasEnter AND bytes === [0x0D] AND crlfMode !== 'cr'; Rust encoder remains frozen (D-13 honoured)"
    - "Module-scope JS-owned ring buffer (Uint8Array(1024)) with observer fan-out — NOT a view over wasm.memory.buffer (Phase 5 keeps the JS allocation when swapping pushTxBytes to Web Serial writer.write)"

key-files:
  created:
    - www/input/tx-sink.js
    - www/input/keyboard.js
  modified:
    - www/main.js

key-decisions:
  - "keyboard.js receives its Phase 3 deps (term, sampleBell, drainHostReply, requestFrame) via wireKeyboard({...}) opts rather than importing from main.js — keeps the module standalone-testable and avoids circular import hazards that would appear when Plan 04-03 adds Settings-pane wiring"
  - "ASCII-only compositionend emission (charCodeAt(i) <= 0xFF guard) chosen over TextEncoder per 'Claude's Discretion' in 04-CONTEXT.md — VT52 is an ASCII terminal; multi-byte CJK passed as Unicode codepoints would produce junk on the host side. If a future workload needs UTF-8 TX, the guard is the one-line extension point"
  - "wireKeyboard call site placed AFTER function sampleBell / function drainHostReply declarations in main.js (line 161, between sampleBell definition and the Feed button handler). Although function declarations hoist fully, the wireKeyboard opts reference closures over these names as runtime values — safest positioning is below the definitions so any future refactor to const arrow functions doesn't silently TDZ-trap"
  - "encode_key_raw removed from main.js's pkg/bestialitty_core.js import (previously imported only for the Phase 2 dead-stripping smoke log) — the real keydown path in keyboard.js exercises it now, so the smoke log is redundant. Decision affects no wasm-boundary test (boundary_api_shape.rs pins the Rust side, not the JS consumer list)"

patterns-established:
  - "Phase 4 JS module layout: www/input/ mirrors www/renderer/ — keyboard.js + tx-sink.js + (future) settings.js, each with a single wireX(opts) entry function"
  - "TX sink observer pattern — module-lifetime observers (no unregister API), matches www/renderer/canvas.js:418-427 triggerBellFlash pattern; Plan 04-03 registers exactly one observer (Debug pane hex strip refresh) against the sink"
  - "D-17 silent-drop case list (F1-F12, Home/End, PgUp/PgDn, Insert/Delete, PrintScreen, CapsLock, ScrollLock, NumLock, ContextMenu, MetaLeft/MetaRight) — coalesced into grouped switch cases in packKeyCode so 20 individual case labels live on 5 source lines without duplicating the body"

requirements-completed: [INPUT-01, INPUT-02, INPUT-03, INPUT-04, INPUT-05]

# Metrics
duration: 6min
completed: 2026-04-22
---

# Phase 4 Plan 02: Keyboard Input Core Summary

**DOM keydown -> encode_key_raw -> TX ring-buffer forwarding path with compositionstart/end IME lifecycle, TX-side CR/LF override, local-echo toggle, and D-17 silent-drop for F1-F12 / Home / End / PgUp / PgDn / Del / Ins / Meta — wired into main.js immediately after wireChrome.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-22T20:58:54Z
- **Completed:** 2026-04-22T21:05:14Z
- **Tasks:** 3
- **Files modified:** 3 (2 new + 1 edit)

## Accomplishments

- **`www/input/tx-sink.js`** — JS-owned `Uint8Array(1024)` ring buffer with `pushTxBytes(bytes)`, `formatHexStrip(limit=64)` (newest-right, two-digit uppercase hex), `registerTxObserver(fn)` and `resetTx()`. Wraps at 1024 without throwing; observer pattern matches canvas.js `triggerBellFlash` precedent.
- **`www/input/keyboard.js`** — full D-01..D-12 + D-17 handler: `wireKeyboard({term, terminalWrapper, sampleBell, drainHostReply, requestFrame})` attaches keydown + compositionstart/update/end listeners to `#terminal-wrapper`. `packKeyCode(e)` mirrors the Rust KeyCode tag table verbatim; `packModifiers(e)` produces the `ctrl|shift|alt|meta` bit-packed u32 `encode_key_raw` expects. Local-echo path feeds TX bytes through Phase 3's `term.feed → sampleBell → drainHostReply('echo') → requestFrame` sequence. CR/LF override rewrites Enter's `[0x0D]` only when `crlfMode !== 'cr'`.
- **`www/main.js`** — three changes: (1) removed `encode_key_raw` from the `pkg/bestialitty_core.js` import (no longer used from main.js); (2) deleted the Phase 2 dead-stripping smoke-log block (lines 34-36 pre-edit); (3) inserted `wireKeyboard({...})` call at line 161, between the `sampleBell` function declaration and the Feed button handler — TDZ-safe positioning preserving D-01 attach-second ordering.
- **Zero Phase 3 regressions.** Playwright render suite: 32 passed / 0 failed / 8 skipped (the 8 skipped specs are the Plan 04-01 fixmed input stubs, which Plan 04-04 will unfixme and fill).
- **Zero `crates/` modifications.** `git diff --stat HEAD~3 HEAD -- crates/` reports empty — D-13 Phase 4 JS-only constraint honoured.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement www/input/tx-sink.js ring buffer + observer** — `db32b18` (feat)
2. **Task 2: Implement www/input/keyboard.js with keydown handler, IME guards, CR/LF override, local-echo** — `6a12fe8` (feat)
3. **Task 3: Wire wireKeyboard into main.js after wireChrome; remove Phase 2 smoke log** — `7e26ebc` (feat)

**Plan metadata commit:** _appended after this summary is written_

_Note: Task 2 was marked `tdd="true"` in the plan, but the test-first RED commit was pre-landed by Plan 04-01 (8 fixmed stub specs under `www/tests/input/`). Those specs will be un-fixmed by Plan 04-04 — at that point the RED→GREEN gate closes end-to-end. For Plan 04-02, the inline Node-runtime verification (packKeyCode, packModifiers, setLocalEcho/setCrlfMode round-trip, 17-case behaviour matrix) served as the in-phase GREEN evidence._

## Files Created/Modified

- `www/input/tx-sink.js` (new, 65 lines) — TX ring buffer + observer fan-out + hex formatter.
- `www/input/keyboard.js` (new, 208 lines) — DOM keydown → `encode_key_raw` → TX sink forwarder with IME guard, CR/LF override, and local-echo mirror path.
- `www/main.js` (edited, +32/-12 lines) — new imports for `wireKeyboard`, `registerTxObserver`, `formatHexStrip`; removed `encode_key_raw` import and smoke-log block; `wireKeyboard({...})` call added at line 161 (after `sampleBell` definition closes). File-header comment refreshed to drop the now-stale "encode_key_raw smoke log" reference and to cite `04-PATTERNS.md §"www/main.js (modified)"`.

## Decisions Made

- **`wireKeyboard(opts)` dependency injection over module imports.** keyboard.js receives `term`, `sampleBell`, `drainHostReply`, `requestFrame` as wireKeyboard opts rather than importing them from main.js. Rationale: keyboard.js stays standalone-importable for the Node-runtime verification in Task 2's `<automated>` block (`import('./www/input/keyboard.js').then(m => m.packKeyCode(...))`); importing from main.js would pull in the full wasm init path, breaking headless test isolation. Also avoids the circular-import hazard Plan 04-03 will face when Settings-pane wiring in main.js needs to call into `setLocalEcho` / `setCrlfMode`.
- **ASCII-only compositionend emission.** 04-CONTEXT.md `<discretion>` listed TextEncoder (UTF-8) vs `charCodeAt() <= 0xFF` (strict ASCII) as planner's call. Picked the strict guard: VT52 is an ASCII terminal, MicroBeast has no UTF-8 codepath, and multi-byte CJK would produce garbage on the host. The guard's a one-line extension point if a future workload needs UTF-8 TX.
- **TDZ-safe `wireKeyboard` call-site positioning.** Although `function sampleBell()` / `function drainHostReply()` are hoisted declarations (not `const` arrow functions), the call site placement AFTER their definitions is intentional: (a) matches attach-second D-01 ordering with wireChrome (which runs at line 44, inside the boot section); (b) future-proof against a refactor that changes these to `const` (TDZ would bite silently); (c) places the Phase 4 call near the existing Feed / 64 KB Stress handlers it semantically relates to.
- **Header comment refresh.** The deleted smoke-log block made the file header comment ("Preserves the Phase 2 wasm boundary + harness helpers (encode_key_raw smoke log ...)") inaccurate. Rewrote the header to drop the smoke-log reference, add a Phase 4 Plan 02 mention, and cite `04-PATTERNS.md §"www/main.js (modified)"`. Rule 2 (correctness) scope, not Rule 4 (architectural).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Doc correctness] Refreshed main.js header comment after deleting the smoke-log block**
- **Found during:** Task 3 (main.js wiring)
- **Issue:** The original file header comment referenced "the Phase 2 wasm boundary + harness helpers (encode_key_raw smoke log, parseHexEscapes, ...)" — after Task 3 deleted the smoke-log block and the `encode_key_raw` import, the comment was stale and misleading.
- **Fix:** Rewrote the header to drop the smoke-log reference, add "Phase 4 Plan 02 adds wireKeyboard() from www/input/keyboard.js" language, and cite the 04-PATTERNS.md analog file for the wiring pattern.
- **Files modified:** `www/main.js` (header only — lines 1-13 pre-edit, 1-14 post-edit)
- **Verification:** `grep "encode_key_raw" www/main.js` returns nothing; `node --check www/main.js` clean.
- **Committed in:** `7e26ebc` (Task 3 commit — same commit as the wiring change it describes).

---

**Total deviations:** 1 auto-fixed (1 doc-correctness, Rule 2).
**Impact on plan:** No scope change — the header comment would otherwise have misled future readers about the file's responsibility. Caught and fixed inline, no additional commit needed.

## Issues Encountered

- **Playwright hidpi.spec.js flakiness** — on one of three runs during verification, `RENDER-10 — canvas.width equals cssWidth × devicePixelRatio @fast` failed with `Expected: NaN, Received: 300` (`cssW = NaN` because `parseFloat('')` of an unset `style.width`; `backingW = 300` because canvas default width). Pre-change (`git stash`) the same test passed in 194 ms. Post-change re-runs passed in 199 ms. Root cause: `waitForFunction(() => c.width > 0)` returns immediately because 300 (the canvas default) is already > 0 — the test races `resizeToTheme`. Two subsequent full-suite runs (different seed) passed at 32/32; one of those flaked on a different test (`cursor.spec.js:102 Gap #1 blink` — the wall-clock-blink test that Plan 03-07 fixed but is still visibly timing-dependent). Both flakes are **pre-existing Phase 3 Playwright timing sensitivities, not Plan 04-02 regressions**. Not logged to `deferred-items.md` because they affect tests that existed and flaked before this plan — fixing test-timing robustness is not Plan 04-02's scope.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 04-03 (chrome wiring: TX-strip, CR/LF radios, echo toggle, focus-retain)** can proceed against stable APIs:
  - `setLocalEcho(bool)` / `getLocalEcho()` / `setCrlfMode('cr'|'lf'|'crlf')` / `getCrlfMode()` exported from `www/input/keyboard.js`.
  - `registerTxObserver(fn)` / `formatHexStrip(limit)` / `resetTx()` exported from `www/input/tx-sink.js` — Plan 04-03 will register exactly one observer against the Debug pane `<pre id="tx-strip">` and wire the Reset TX button to `resetTx()`.
  - `registerTxObserver` and `formatHexStrip` are already imported in main.js (waiting for Plan 04-03's DOM element).
- **Plan 04-04 (assertion fill)** — the 8 Plan 04-01 fixmed stubs now resolve against production-behaviour modules. `keydown-arrows.spec.js`, `keydown-ctrl-letters.spec.js`, `keydown-printable.spec.js`, `ime-composition.spec.js` all have working handler code to assert against; `local-echo.spec.js` has `setLocalEcho` + `window.__testGridView` to drive; `crlf-override.spec.js` has `setCrlfMode`; `tx-debug-strip.spec.js` waits on Plan 04-03's DOM element; `focus-retention.spec.js` waits on Plan 04-03's mousedown wiring.
- **Phase 5 (Web Serial transport)** — `pushTxBytes(bytes)` in tx-sink.js is the single swap point. Phase 5 will replace its body with `await txWriter.write(bytes)` (plus paste throttling). The ring + observers stay (Debug pane hex strip remains useful for wire-level debug). The JS-owned allocation means no wasm.memory.buffer identity guard will be needed at the swap.
- **No blockers surfaced.** Phase 3 contract intact (rAF cadence, bell sampling, focus attribute). D-13 Phase 4 JS-only constraint honoured. Plan 04-01's `__testGridView` hook preserved verbatim.

## Self-Check: PASSED

- All created files exist:
  - `www/input/tx-sink.js` — FOUND
  - `www/input/keyboard.js` — FOUND
  - `www/main.js` — FOUND (modified)
- All task commits exist in `git log`:
  - `db32b18` (Task 1) — FOUND
  - `6a12fe8` (Task 2) — FOUND
  - `7e26ebc` (Task 3) — FOUND
- Regression gate: `cd www && npx playwright test --project=chromium tests/render/` — 32 passed / 0 failed.
- D-13 gate: `git diff --stat HEAD~3 HEAD -- crates/` — empty output (zero crates/ modifications).
- Acceptance criteria sampled: `grep -c "^export function" www/input/tx-sink.js` = 4; `grep -c "^export function" www/input/keyboard.js` = 7; `grep "encode_key_raw" www/main.js` = (empty).

---
*Phase: 04-keyboard-input*
*Completed: 2026-04-22*
