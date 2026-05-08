---
phase: 11-slide-js-bridge-v1-0-integration
plan: 02
subsystem: renderer
tags: [chip, lifecycle, throughput, sliding-window, mirror, scroll-state, theme-aware, wave-1, slide-25, slide-26, slide-28]

# Dependency graph
requires:
  - phase: 06-daily-driver-polish-session-deployment
    provides: Phase 6 D-03 floating-chip pattern (#scrollback-indicator) — Plan 11-02 mirrors verbatim with right→left flip
  - phase: 09-slide-sender-host-z80-send
    provides: __slide.__getStateForTests introspection accessor (Phase 9 D-18) — Plan 11-02 chip subscribes as data source
  - phase: 10-slide-receiver-cancellation
    provides: cancelSlideRecv 5-step ADR-003 cancel state machine — Plan 11-02 chip [Cancel] hands off
  - phase: 11-slide-js-bridge-v1-0-integration
    plan: 01
    provides: prefs.slideShowSummary DEFAULTS key — Plan 11-02 enterSummary() consumes for D-08 gating
provides:
  - "www/renderer/slide-chip.js — chip module with 8 lifecycle states (hidden / awaiting-wakeup / awaiting-timeout / active / cancelled-summary / sent-summary / received-summary / error + drop-rejected-flash overlay) + 250 ms refresh tick + observer fan-out"
  - "#slide-chip + #slide-chip-text DOM in index.html — mirror partner of #scrollback-indicator at bottom: 8px; left: 8px"
  - "#slide-chip CSS rule block (49 lines) verbatim mirror of Phase 6 chip CSS with right→left flip + max-width formula preventing scrollback overlap + .slide-inline rules for [Cancel]/[Retry]/[Force start]"
  - "window.__slideChip introspection (9 keys: __reset/__getStateForTests + 7 public state-transition methods) for Plan 11-05 Playwright tests"
affects: [11-03-PLAN.md, 11-04-PLAN.md, 11-05-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chip module mirrors www/renderer/scroll-state.js shape verbatim per CONTEXT C-02 (module-scope state + wireXxx initializer + [hidden] toggle render + observer fan-out)"
    - "Chip CSS mirrors www/index.html:138-164 (#scrollback-indicator) verbatim with right: 8px → left: 8px per Pitfall 14 chip-collision policy"
    - "Throughput sliding-window — 2-second sample ring with auto-scaled units (B/s under 1 KB/s, KB/s under 1 MB/s, MB/s above); first 2 s shows '—' until samples.length >= 2 AND ageMs >= 2000"
    - "Two-space token separators in chip dense layout (UI-SPEC §Layout token separators verbatim)"
    - "Theme-aware via CSS custom properties — var(--chrome-accent) clean / var(--phosphor-fg) CRT (zero theme JS in chip module)"
    - "escapeHtml() applied to filename + reason tokens before innerHTML — T-11-02-xss-filename mitigation"

key-files:
  created:
    - "www/renderer/slide-chip.js"
    - ".planning/phases/11-slide-js-bridge-v1-0-integration/11-02-SUMMARY.md"
  modified:
    - "www/index.html"
    - "www/main.js"

key-decisions:
  - "Chip outer is <button> + nested <button class=\"slide-inline\"> per UI-SPEC §Layout — preserves Phase 6 chip-pattern verbatim and Tab-focusable for keyboard users; outer click is a no-op in Phase 11 (only inner buttons fire actions)"
  - "Phase 4 D-16 mousedown preventDefault sacred — applied to chip outer + every inner button so canvas keeps focus through chrome interaction (verbatim from scroll-state.js:55-57 idiom)"
  - "Throughput sample ring is unbounded Array<{t, bytes}> with tail-trim on each push — bounded in practice to ~8 entries steady-state at 4 samples/sec × 2 s window per CONTEXT specifics; T-11-02-throughput-overflow accepted"
  - "Drop-rejected flash takes precedence over active-state render — refreshChip() checks lifecycle === 'active' && Date.now() < dropRejectedUntil BEFORE the lifecycle switch; sliding 3-second window per UI-SPEC"
  - "enterSummary() honors prefs.slideShowSummary gate (D-08) by calling hide() when false; cancelled-summary chip ALWAYS shows for 5 s on cancel regardless of checkbox state per D-08 + UI-SPEC §Copywriting"
  - "Chip is addressable in Plan 11-02 only via window.__slideChip — Plan 11-03 wires automatic dispatcher hooks (enterRecvMode → enterActive, EVT_SESSION_COMPLETE → enterSummary, cancelSlideRecv → enterCancelledSummary, etc.); Plan 11-04 adds Compatibility-mode 3-second wakeup timer + swallow-echo filter"
  - "Phase 11 hard invariant preserved — ZERO Rust changes (CLAUDE.md): bash scripts/build.sh exit 0 with wasm artifacts unchanged; chip module is pure JS"

requirements-completed: []  # Plan 11-02 lands the chip surface (DOM + CSS + module + boot wiring) but does NOT yet drive lifecycle transitions from session events. SLIDE-25 / SLIDE-26 / SLIDE-28 flip Pending → Complete in Plan 11-05 (verification gate) after Plan 11-03 (dispatcher integration) and Plan 11-04 (Compatibility timer + swallow-echo) complete the production integration.

# Metrics
duration: 6min
completed: 2026-05-08
---

# Phase 11 Plan 11-02: SLIDE Chip Surface (DOM + CSS + Module + Boot Wiring) Summary

**~387-line chip module + 56 lines of chip CSS / DOM in index.html + 41-line boot wiring in main.js — surfaces the SLIDE chip end-to-end as a renderable, programmatically-driven UI element with 8 lifecycle states, theme-aware styling, sliding-window throughput, and full Playwright introspection. Chip is functionally complete as a render surface; auto-driven lifecycle integration with the dispatcher lands in Plan 11-03.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-08T17:43:58Z
- **Completed:** 2026-05-08T17:50:26Z
- **Tasks:** 3 (all `type="auto"`, non-TDD)
- **Files modified:** 3 (1 new module + 2 modified files)

## Accomplishments

- New `www/renderer/slide-chip.js` (387 lines) implements all 8 lifecycle states (hidden / awaiting-wakeup / awaiting-timeout / active / cancelled-summary / sent-summary / received-summary / error) plus a drop-rejected-flash overlay that takes precedence over the active render for a sliding 3-second window.
- Mirror-target shape verbatim from `www/renderer/scroll-state.js`: module-scope state + injected deps + `wireSlideChip({...})` initializer + `[hidden]` toggle render + `onStateChange` observer fan-out + `__resetForTests` / `__getStateForTests` test introspection.
- Throughput formatter (D-02) auto-scales B/s / KB/s / MB/s on a 2-second sliding sample ring; first 2 s renders `—` placeholder until `samples.length >= 2 AND ageMs >= 2000`.
- Active-state renderer emits the verbatim D-01 dense layout: `arrow filename N/M percent% bytes throughput [Cancel]` with two-space token separators.
- Verbatim UI-SPEC copy strings for every state (8 of 8): `Waiting for Z80…`, `Z80 didn't respond.`, `Cancelled — N of M files transferred`, `Sent N file(s) — X.X MB → MicroBeast`, `Received N file(s) — X.X MB`, `Transfer failed — {reason}`, `Transfer in progress — cancel first`.
- New chip CSS in `www/index.html` (49 CSS lines, immediately after the `#scrollback-indicator` rule block) verbatim mirrors the Phase 6 chip rules with `right: 8px` → `left: 8px` per Pitfall 14 chip-collision policy. Includes theme-aware `[data-theme="crt"]` override, `[hidden]` display toggle, `:focus-visible` outline, `:hover` background-darken, and `.slide-inline` button rules for nested `[Cancel]`/`[Retry]`/`[Force start]` affordances. The `max-width: calc(100% - 16px - 288px)` formula prevents overlap with `#scrollback-indicator`.
- New chip DOM (`<button id="slide-chip"> <span id="slide-chip-text"> </button>`) inserted as a sibling of `#scrollback-indicator` inside `#terminal-wrapper`. ARIA: `aria-live="polite"` + `aria-atomic="true"` per UI-SPEC §Accessibility for polite screen-reader announcements on lifecycle transitions.
- `main.js` boot wiring: `wireSlideChip({...})` slotted AFTER `wireFileSource` (Plan 09-03 boot position), injects existing `__slideGetStateForTests` / `cancelSlideRecv` / `prefs` deps. `window.__slideChip` exposed with 9 keys (2 introspection + 7 public state-transition methods) for Plan 11-05 Playwright tests.
- Phase 11 hard invariant preserved: ZERO Rust changes — `bash scripts/build.sh` exits 0; wasm artifacts unchanged.
- Plan 11-03 / 11-04 / 11-05 unblocked: dispatcher can call into `slideChipApi.enterAwaitingWakeup` / `enterActive` / `enterCancelledSummary` / `enterSummary` / `enterError` / `flashDropRejected` / `hide` and Plan 11-05 can drive lifecycle states programmatically via `window.__slideChip`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create www/renderer/slide-chip.js chip module** — `6bbab36` (feat)
2. **Task 2: Add chip DOM + chip CSS to www/index.html** — `e83c551` (feat)
3. **Task 3: Wire wireSlideChip into main.js + window.__slideChip exposure** — `8692a75` (feat)

## Files Created/Modified

### Created

- `www/renderer/slide-chip.js` (387 lines) — chip module with 8 lifecycle states, sliding-window throughput, observer fan-out, test introspection.

### Modified

- `www/index.html` — +56 lines: 49 lines of `#slide-chip` CSS rules (after `#scrollback-indicator` rule block at line 164) + 7-line `<button id="slide-chip">` DOM element inserted inside `#terminal-wrapper` as sibling to `#scrollback-indicator`.
- `www/main.js` — +41 lines: import block from `./renderer/slide-chip.js`, `wireSlideChip({...})` boot block after `wireFileSource`, `window.__slideChip` introspection exposure.

## Decisions Made

- **Chip outer is `<button>` + nested `<button class="slide-inline">` per UI-SPEC.** Preserves Phase 6 chip-pattern verbatim (chip itself is Tab-focusable) and provides accessible affordances for `[Cancel]` / `[Retry]` / `[Force start]`. Outer chip click is a no-op in Phase 11 — only inner buttons fire actions per CONTEXT D-04. Nested-button HTML is technically invalid per the Content Model spec but Chromium accepts it; we ship for Chromium-only per CLAUDE.md.
- **Phase 4 D-16 mousedown preventDefault is sacred.** Applied to chip outer + every inner button so canvas keeps focus through chip interaction. Verbatim from `scroll-state.js:55-57` idiom.
- **Throughput sliding window is `Array<{t, bytes}>` with tail-trim on each push.** Bounded in practice to ~8 entries steady-state at 4 samples/sec × 2 s window per CONTEXT specifics. T-11-02-throughput-overflow risk accepted (sample ring trims on every push).
- **Drop-rejected flash takes precedence over active-state render.** `refreshChip()` checks `lifecycle === 'active' && Date.now() < dropRejectedUntil` BEFORE the lifecycle switch — alternate copy "Transfer in progress — cancel first" replaces the active-state content for a sliding 3-second window. Subsequent `flashDropRejected()` calls re-extend the window per UI-SPEC.
- **`enterSummary()` honors `prefs.slideShowSummary` gate per D-08.** When prefs absent OR `slideShowSummary === false`, immediately calls `hide()` rather than showing summary text. Cancelled-summary chip is NOT gated by this checkbox — it always shows for 5 s on cancel per D-08 + UI-SPEC §Copywriting.
- **Chip is addressable in Plan 11-02 only via `window.__slideChip`.** Plan 11-03 wires automatic dispatcher hooks (`enterRecvMode` → `enterActive`, `EVT_SESSION_COMPLETE` → `enterSummary`, `cancelSlideRecv` → `enterCancelledSummary`, port-lost teardown → `enterError`); Plan 11-04 adds the Compatibility-mode 3-second wakeup timer + swallow-echo filter.
- **Phase 11 hard invariant preserved — ZERO Rust changes per CLAUDE.md.** `crates/` untouched. wasm boundary unchanged. `bash scripts/build.sh` runs the parity build (no-op for the Rust → wasm artifacts) and exits 0.
- **`escapeHtml()` applied to filename + reason tokens before `innerHTML`.** T-11-02-xss-filename mitigation per threat model — CP/M 8.3 filenames are bounded char set but defensive escaping is cheap; reason strings come from a small fixed map but escaping is applied uniformly for hygiene.

## Deviations from Plan

None — plan executed exactly as written. The plan-as-written rendered `Transfer failed — ${lastReason}` without `escapeHtml()` on `lastReason`; I applied `escapeHtml()` defensively at the render site (T-11-02-xss-filename's threat-register entry already applies the same protection to `filename`; reason strings come from a fixed JS-internal map but escaping for consistency is hygiene-only and matches the threat model's "defensive escaping is cheap" rationale). This is a hardening addition — no behavioral change for any in-spec input.

## Issues Encountered

**Pre-existing parallelism flakes** (out-of-scope per executor SCOPE BOUNDARY rule; documented in `.planning/phases/11-slide-js-bridge-v1-0-integration/deferred-items.md` from Plan 11-01):

Two test:fast runs during Plan 11-02 verification surfaced known intermittent flakes; all passed cleanly in isolation:

| Run | Flake | In-isolation pass |
|-----|-------|-------------------|
| Verification 1 (post-Task 2) | `slide-sender.spec.js:54` picker click flow + `theme-toggle.spec.js:8` click swap | both pass in isolation |
| Verification 2 (post-Task 3, full plan re-verify) | `slide-dispatcher.spec.js:90` post-feed-invariant-ESC-Z-returns-host-reply | passes 1/1 in isolation (788 ms) |

These are the same parallelism-flake class documented in Plan 11-01 (slide-dispatcher / slide-wakeup / slide-sender). Plan 11-02 changes are purely additive: new chip module file (no production callers), new DOM element (initially `hidden` — invisible to existing tests), new boot wiring (executes once at boot — no shared state with the flaky specs). The flake class is wasm-boot starvation under 10-worker load, unrelated to any code path Plan 11-02 touches.

**Smoke check observation:** Boot console shows the pre-existing CSP frame-ancestors warning (`The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.`). This is a defense-in-depth posture from Phase 6 deployment plan (`<meta http-equiv="Content-Security-Policy">` for GH Pages where headers are unavailable). Browser correctly ignores `frame-ancestors` from `<meta>` and uses the actual response header path on Cloudflare/Netlify. Pre-existing, out of scope for Plan 11-02.

## User Setup Required

None — no external service configuration required. Chip is purely client-side JS / HTML / CSS.

## Threat Flags

None new — all chip-related surfaces are accounted for in the plan's `<threat_model>` (T-11-02-xss-filename mitigated via `escapeHtml()`; T-11-02-bell-overlap accepted; T-11-02-throughput-overflow accepted with sample-ring trim; T-11-02-stale-cancel mitigated via Phase 10 ADR-003 idempotency).

## Next Phase Readiness

Plan 11-03 unblocked: dispatcher can call into `slideChipApi.enterAwaitingWakeup({armTimer})` (after `pushTxBytes(AUTO_SEND_COMMAND)` in `enterSendMode`), `enterActive()` (at `enterRecvMode` / `enterSendModeInternal`), `enterCancelledSummary({done, total})` (at `cancelSlideRecv` completion), `enterSummary({direction, fileCount, totalBytes})` (at `EVT_SESSION_COMPLETE` / `EVT_RECV_FILE_DONE` exit-mode boundary), `enterError(reason)` (at `slidePumpOnPortLost` / `recoverHardFail`), `flashDropRejected()` (at `file-source.js` drag/drop while session active), and `hide()` (at any explicit teardown).

Plan 11-04 unblocked: chip's `enterAwaitingWakeup({armTimer})` opt is already designed to receive Compatibility-mode-driven timer arming; Plan 11-04 wires the 3-second `setTimeout` body that transitions `awaiting-wakeup` → `awaiting-timeout` and the `[Retry]` / `[Force start]` action handlers via the `onStateChange` observer fan-out (`{kind: 'inline-action', action}` events).

Plan 11-05 unblocked: `window.__slideChip` exposes all 7 public state-transition methods so Playwright tests can drive lifecycle states programmatically before Plan 11-03 wires the automatic transitions; the `slide-chip.spec.js` 11 stubs match the test names verbatim from Plan 11-01's RED-gate scaffolding.

No new blockers. Pre-existing parallelism-flake class remains tracked in `deferred-items.md` for a future hardening sweep (out of scope for Phase 11).

## Self-Check: PASSED

Verified before completion:

- [x] `www/renderer/slide-chip.js` exists (15 KB / 387 lines)
- [x] File contains all 12 expected exports (`wireSlideChip` + 7 public state-transition methods + `__resetForTests` + `__getStateForTests` + `dispose` + `onStateChange`) — verified via `node -e "import('./renderer/slide-chip.js').then(m => Object.keys(m))"`
- [x] All 8 lifecycle state strings present (>=6 required)
- [x] All 6 verbatim UI-SPEC copy strings present (`Cancelled — ${done} of ${total} files transferred`, `Waiting for Z80`, `Z80 didn't respond`, `Transfer in progress — cancel first`, `Transfer failed — `, `→ MicroBeast`)
- [x] `www/index.html` contains `#slide-chip` (7 occurrences ≥ 6 required), `id="slide-chip"` (1), `id="slide-chip-text"` (1), `left: 8px` (2 — chip + drop-overlay), `aria-live="polite"` (2), `aria-atomic="true"` (1), `slide-inline` (2), `rgba(0, 0, 0, 0.65)` (4 — chip + scrollback chip + their hover backgrounds)
- [x] CSS block sits within `<style>` (lines 168-211 inside the style block 27-708)
- [x] DOM element sits within `#terminal-wrapper` (line 839 inside wrapper 815-844)
- [x] `www/main.js` contains import from `./renderer/slide-chip.js` (1), `wireSlideChip(` (1), `window.__slideChip` (3), `getElementById('slide-chip')` (1), `getElementById('slide-chip-text')` (1)
- [x] `cd www && npm run test:fast` exits 0 on retry (81/81 green; pre-existing parallelism flakes documented in deferred-items.md)
- [x] `bash scripts/build.sh` exits 0 (Phase 11 hard invariant — zero Rust changes — preserved; wasm artifacts unchanged from Plan 11-01)
- [x] `cd www && npx playwright test transport/slide-chip.spec.js --list` exits 0 (Wave 0 stubs still listed: 11 tests)
- [x] Boot smoke (Playwright headless): `await page.locator('#slide-chip').count()` returns 1; chip has `hidden` attribute on initial paint; `window.__slideChip` exposes all 9 expected keys (2 introspection + 7 public state-transition methods); only pre-existing CSP `<meta>` warning in console
- [x] All commits exist in git log: `6bbab36` (Task 1), `e83c551` (Task 2), `8692a75` (Task 3)

---
*Phase: 11-slide-js-bridge-v1-0-integration*
*Completed: 2026-05-08*
