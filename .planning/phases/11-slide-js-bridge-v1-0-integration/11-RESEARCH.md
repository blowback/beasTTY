# Phase 11: SLIDE JS Bridge & v1.0 Integration — Research

**Researched:** 2026-05-08
**Domain:** Browser-side integration glue (DOM, CSS, prefs, lifecycle wiring) for the SLIDE protocol stack delivered by Phases 7–10. Pure JavaScript / HTML / CSS; zero Rust changes.
**Confidence:** HIGH — every integration seam is grounded in existing committed code with line numbers; every "library" used is the browser's own DOM / Page Visibility / Storage APIs already exercised by Phases 3–10. The only MEDIUM-confidence area is OQ-5 (3 s wakeup-tail timing) which is hardware-empirical.

## Summary

Phase 11 is **integration glue, not protocol work**. The SLIDE state machine (Phases 7+9), wasm boundary (Phase 8), receiver pipeline (Phase 10), and cancel state machine (Phase 10) are all locked. Phase 11 stitches that working protocol into the v1.0 daily-driver shell:

1. **Floating chip** mirroring the Phase 6 scrollback chip (verbatim CSS pattern, opposite corner).
2. **Settings sub-block** (`<details class="reserved">`) with three new prefs rows (auto-send command, show-summary, Compatibility mode).
3. **Lifecycle wiring** — session-log pause, paste-pump gate, port-lost teardown, visibilitychange CTRL_CAN, drop-rejection chip flash.
4. **Two correctness filters** — auto-type swallow-echo (~500 ms; Pitfall 11) and Z80-no-respond timeout chip (3 s; Pitfall 15 / OQ-5).

The work is constrained by 16 locked decisions in 11-CONTEXT.md and 10 carry-forward invariants from Phases 6–10. The only LOW-confidence item is OQ-5 (whether 3 s is the right wakeup-tail timeout on real hardware — verifiable only via Phase 12 UAT).

**Primary recommendation:** Plan as a 4-wave sequence: (W0) chip module skeleton + DOM/CSS + prefs DEFAULTS, (W1) lifecycle wiring (session-log gate, paste-pump gate, port-lost, visibilitychange), (W2) chip lifecycle states (active / awaiting-wakeup / cancelled-summary / error / drop-rejected) with swallow-echo filter, (W3) Playwright coverage. Each wave's success criteria map directly to 1–4 of the 11 SLIDE-* requirement IDs.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from 11-CONTEXT.md `<decisions>`)

**D-01 — Single-line dense chip layout.** `↑ MY-DOC.TXT  2/3  47%  482 KB  12.3 KB/s  [Cancel]`. Direction arrow + 8.3 filename verbatim + N/M file index + percent + bytes done + throughput + Cancel.

**D-02 — Throughput auto-scaled units; first 2 s shows `—`.** Below 1 KB/s: `847 B/s`. 1–999 KB/s: `12.3 KB/s` (1 decimal). ≥ 1 MB/s: `1.4 MB/s`. Window: 2-second sliding sample ring `samples: { t, bytes }[]`. While `samples.length < 2` OR window age < 2000 ms → render `—`.

**D-03 — Filename verbatim from header frame.** No truncation, no ellipsis. Edge case: collision-rewritten `~N` suffix on RECV (Phase 10 D-05) — chip displays the rewritten name.

**D-04 — `[Cancel]` text button matching Phase 6 chip style.** Same typography, border, rgba(0,0,0,0.65). Click → `cancelSlideRecv()` (or sender-side equivalent). Esc-key parity preserved (slot 2 in disambiguation chain).

**D-05 — Nested `<details class="reserved">` SLIDE block** with summary `"SLIDE file transfer"`. Order: (1) Phase 10 "Save received files to a folder" row (moved from top-level); (2) Auto-send command text input; (3) Show transfer summary chip checkbox; (4) Compatibility mode `<select>`.

**D-06 — Auto-send command text input pre-filled with literal `B:SLIDE R`.** Hint text: `\r appended automatically`. Empty disables auto-type. On change: `savePrefs({ slideAutoSendCommand: input.value + '\r' })` — the `\r` is appended at save time, not displayed in the input.

**D-07 — Compatibility mode 3-way `<select>`:** `Auto` (default — auto-type + 3 s wakeup wait + timeout chip on miss), `Wakeup-required` (auto-type + indefinite wait), `Force-start (legacy slide.com)` (auto-type + skip wakeup wait entirely; jump into send mode after auto-type).

**D-08 — Show transfer summary chip checkbox; default ON.** When ON, chip stays visible 5 s after success with `Sent N files — X.X MB → MicroBeast` or `Received N files — X.X MB`. SLIDE-28 post-cancel chip is **not** governed by this checkbox.

**D-09 — New `prefs.js` DEFAULTS keys:** `slideAutoSendCommand: 'B:SLIDE R\r'`, `slideShowSummary: true`, `slideCompatibilityMode: 'auto'`. No `CURRENT_VERSION` bump — Phase 6 D-32 defensive merge fills missing fields.

**D-10 — Replace Phase 9 silent ignore with chip flash "Transfer in progress — cancel first".** In `file-source.js` `onDragEnter` (line 178) and `onDrop` (line 208): when `isSessionActive()`, call `slideChip.flashDropRejected()`. Flash lasts 3 s then reverts.

**D-11 — Session-log pause: gate at the call site.** In `serial.js` read loop, wrap `sessionLog.append(value)` with `if (!isSlideActive()) ...`.

**D-12 — Paste-pump gate: `cancelPaste()` on session start + no-op `enqueuePaste` while session active.** At SLIDE wakeup match completion (`enterRecvMode` / `enterSendMode` entry), call `pastePump.cancelPaste()`. Gate `enqueuePaste(bytes)` with `if (isSlideActive()) { return; }`.

**D-13 — Extend existing `chrome.js` visibilitychange listener; fire-and-forget single-byte CTRL_CAN.** Plus a `pagehide` listener with the same body (bfcache eviction).

**D-14 — `slidePumpOnPortLost` lives in `slide-recv.js`; `slide.js` forwards.** Body: `force_idle + setWireOwner('terminal') + slideChip.enterError('port lost') + reset()`. Wired from `serial.js` teardown / handleReadError / onNavSerialDisconnect.

**D-15 — 3-second timeout from auto-type completion.** Chip enters `awaiting-wakeup` state immediately after auto-type completes. If 3 s elapses without wakeup AND `slideCompatibilityMode === 'auto'`, chip displays `Z80 didn't respond.  [Retry]  [Cancel]  [Force start]`.

**D-16 — Compatibility mode governs whether the 3 s timer arms.** `auto` arms; `wakeup-required` no timer; `force-start` skips wakeup wait entirely.

### Carry-Forward (locked from prior context, not re-asked)

**C-01** — Chip placement `bottom: 8px; left: 8px` (opposite Phase 6 scrollback chip at `right: 8px`). Theme-aware via `--chrome-accent` (clean) and `--phosphor-fg` (CRT). Same rgba(0,0,0,0.65) background, 4px border-radius, `box-shadow: 0 2px 8px rgba(0,0,0,0.5)`.

**C-02** — Chip module `www/renderer/slide-chip.js` (sibling to `scroll-state.js`). Module-scope state with `wireSlideChip({ chipEl, getSlideState, onCancel })` initializer.

**C-03** — Auto-type swallow-echo filter: byte-for-byte match in `dispatchInbound`'s terminal branch; ~500 ms timeout. Compare against post-rewrite TX bytes (Phase 4 D-13 CR/LF-rewritten). Filter location: `www/transport/echo-swallow.js` OR inline in `slide.js` (planner picks).

**C-04** — Esc disambiguation chain slot 2 = SLIDE cancel (Phase 10). Chip Cancel = Esc.

**C-05** — `__slide` introspection shape: `{ mode, state, file_idx, total_files, bytes_in_file_done, bytes_in_file_total, current_filename }`. Chip reads on every redraw.

**C-06** — `prefs.js` versioned blob + 250 ms debounced save (Phase 6 D-32/D-33). 3 keys added to DEFAULTS only; no migration step.

**C-07** — `showDirectoryPicker` + IndexedDB FileSystemDirectoryHandle for "Save to folder" (Phase 10 D-03). Phase 11 inherits unchanged; row moves into SLIDE sub-block.

**C-08** — ADR-003 5-step cancel state machine (Phase 10). Chip Cancel hands off to existing `cancelSlideRecv()`; Phase 11 does not reimplement.

**C-09** — No `std::time` in Rust core. All Phase 11 timing in JS via `setTimeout` / `Promise.race(timeoutPromise(ms))`.

**C-10** — Per-session `new Slide()` lifecycle (Phase 8 dispatcher pattern). Chip state resets on every `new Slide()` construction.

### Claude's Discretion (planner picks)

- Chip update mechanism — observer pattern vs polling tick (default: hybrid — state-change callbacks + 250 ms refresh tick).
- Chip DOM shape — `<button>` with nested `[Cancel]` button vs `<div>` (default: `<button>`).
- Awaiting-wakeup chip layout (default: `↑ Waiting for Z80…  [Cancel]`).
- Throughput sample ring data structure (default: `Array<{ t, bytes }>` with tail-pop).
- Compatibility-mode `force-start` UX — instant skip vs 100 ms `awaiting-wakeup` flash (default: instant).
- Settings row order within SLIDE sub-block (default: D-05 order).
- Auto-send command "Reset to default" affordance (default: omit).
- Phase 9 button-state-observer cleanup at file-source.js:115 (default: leave in place).
- Chip error-state copy detail (default: `Transfer failed — {reason}.  [Retry]`).
- Awaiting-wakeup timer storage — chip module vs dispatcher (default: chip module).

### Deferred Ideas (OUT OF SCOPE)

- Filename collision auto-rename on SEND (Phase 12 SLIDE-36).
- Drag-drop vs pointer-select isolation regression spec (Phase 12 SLIDE-12).
- Auto-send command safety validation (Phase 12 SLIDE-38).
- `docs/SLIDE_Z80_REQUIREMENT.md`, README "File transfer" section, `docs/SLIDE-UAT.md` (Phase 12).
- ETA / NAK counter / pre-send confirm / open-downloads link / backgrounded-tab redraw skip / preset dropdown (P2 differentiators).
- Animated `…` ellipsis or countdown in awaiting-wakeup (minor polish).
- `[Reset]` button next to auto-send command input (minor polish).
- Phase 9 button-state observer cleanup (Claude's Discretion deferral).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SLIDE-11** | Drops during active SLIDE session rejected with chip "Transfer in progress — cancel first" | §Architecture Patterns Pattern 6; D-10; existing `file-source.js:178/208` |
| **SLIDE-14** | Auto-typed command's CP/M echo swallowed for ~500 ms via swallow-echo filter | §Architecture Patterns Pattern 7; C-03; PITFALLS §11 |
| **SLIDE-25** | Floating chip at `bottom: 8px; left: 8px` showing direction + filename + N/M + percent + bytes | §Architecture Patterns Pattern 1; D-01, C-01 |
| **SLIDE-26** | Throughput on 2-second sliding window; first 2 s shows `—` | §Architecture Patterns Pattern 2; D-02 |
| **SLIDE-28** | Post-cancel chip "Cancelled — N of M files transferred" for 5 s | §Architecture Patterns Pattern 1 lifecycle states; D-08 |
| **SLIDE-31** | `visibilitychange` listener emits best-effort CTRL_CAN | §Architecture Patterns Pattern 4; D-13; PITFALLS §6 |
| **SLIDE-32** | Phase 5 port-lost flow includes `slidePumpOnPortLost` symmetric to `pastePumpOnPortLost` | §Architecture Patterns Pattern 5; D-14; existing `slide-recv.js:683-690` stub |
| **SLIDE-33** | Session-log paused + paste-pump gated during active SLIDE session | §Architecture Patterns Pattern 3; D-11, D-12; PITFALLS §16, §18 |
| **SLIDE-35** | "Z80 didn't respond" timeout chip with `[Retry] [Cancel] [Force start]` | §Architecture Patterns Pattern 8; D-15, D-16; PITFALLS §15 |
| **SLIDE-37** | Auto-send command persisted in `prefs.slideAutoSendCommand`; default `B:SLIDE R\r` | §Standard Stack prefs blob; D-09, C-06 |
| **SLIDE-39** | Settings pane SLIDE sub-block (auto-send + show-summary + Compatibility mode) | §Architecture Patterns Pattern 9; D-05, D-06, D-07, D-08 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Rust → wasm core ownership:** Parser, terminal state, key encoding. Pure logic. **Phase 11 makes ZERO Rust changes** (the wasm boundary contract is locked from Phase 10).
- **JS shell ownership:** Web Serial I/O, canvas rendering, event loop, browser state. Phase 11 work is exclusively in `www/`.
- **Web Serial driven from JS, not Rust.** Already established; Phase 11 inherits.
- **Chromium-only.** All browser APIs Phase 11 uses (`<details>`, `visibilitychange`, `pagehide`, `<select>`) are universally available at the Chromium 89+ floor set by Web Serial.
- **Static site deploy only.** No new runtime dependencies; no new build steps.
- **VT52 pragmatic subset.** Phase 11 modifies SLIDE-related code paths; the VT52 parser path is untouched (the swallow-echo filter sits BEFORE `term.feed` per C-03).
- **No AI attribution in commit messages** (per user MEMORY): never add Co-Authored-By.
- **Wasm rebuild requires hard reload** (per user MEMORY): not relevant — Phase 11 has no Rust changes, so no `scripts/build.sh` invocation is required (though parity runs are still acceptable per CONTEXT.md `<canonical_refs>` build/test orchestration note).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Floating chip DOM + CSS rendering | Browser / Client (DOM + CSS) | — | Pure presentation layer; theme-aware via CSS custom properties. |
| Chip lifecycle state machine | Browser / Client (JS module) | — | Module-scope state in `www/renderer/slide-chip.js`; mirrors `scroll-state.js`. |
| Throughput sliding-window sampling | Browser / Client (JS) | — | `setTimeout` + `Date.now()`; no protocol concern. |
| Auto-send command persistence | Browser / Client (`localStorage`) | — | Phase 6 D-32 versioned prefs blob; defensive merge fills new fields. |
| Compatibility mode `<select>` | Browser / Client (DOM `<select>`) | — | Standard form control; persisted via prefs. |
| Settings DOM placement | Browser / Client (HTML `<details>`) | — | Phase 4 D-13/D-14 Settings pane; Phase 11 adds nested `<details class="reserved">`. |
| Session-log pause predicate | Browser / Client (JS — read loop) | — | Single-line edit at `serial.js` `sessionLog.append(value)` site. |
| Paste-pump gate | Browser / Client (JS — paste-pump) | — | Single-line `if (isSlideActive())` early-return in `enqueuePaste`. |
| `visibilitychange` CTRL_CAN | Browser / Client (Page Visibility API) | — | Best-effort fire-and-forget; D-13. |
| `pagehide` CTRL_CAN | Browser / Client (pagehide event) | — | Bfcache-safe complement to visibilitychange. |
| Port-lost teardown (`slidePumpOnPortLost`) | Browser / Client (JS — slide-recv module) | — | Symmetric to `pastePumpOnPortLost`; lives in `slide-recv.js`. |
| Auto-type swallow-echo filter | Browser / Client (JS — dispatcher) | — | Sits BEFORE wakeup matcher in `dispatchInbound`'s terminal branch. |
| Z80-no-respond timeout chip | Browser / Client (JS — chip module) | — | `setTimeout(3000)` armed at auto-type completion; chip module owns the timer. |
| Drop-during-session chip flash | Browser / Client (JS — chip module + file-source.js) | — | `slideChip.flashDropRejected()` called from `file-source.js:178/208`. |

**SLIDE protocol / wasm boundary** does NOT appear in this map: Phase 11 makes zero Rust or wasm-bindgen changes. The wasm boundary is locked from Phase 10.

## Standard Stack

### Core (no new dependencies)

| Library / API | Version / Source | Purpose | Why Standard |
|---------------|------------------|---------|--------------|
| **Browser DOM** | Chromium 89+ baseline | Chip DOM creation + Settings pane rows | Already used by Phases 3, 4, 6, 9, 10. `<button>`, `<details>`, `<input type="text">`, `<input type="checkbox">`, `<select>` all exercised. [VERIFIED: codebase grep — `<details>` at index.html:790; `<button id="scrollback-indicator">` at index.html:776] |
| **Page Visibility API** | Chromium 33+ (universally Chromium 89+) | `visibilitychange` listener for CTRL_CAN best-effort emit | Phase 3 BEL-prefix handler at `chrome.js:210` already uses; Phase 11 D-13 extends the same listener body. [VERIFIED: codebase grep] |
| **`pagehide` event** | All modern browsers | Bfcache-safe fallback when `visibilitychange` doesn't fire | MDN documents `pagehide` as the spec-guaranteed signal for bfcache eviction. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event] |
| **CSS custom properties** | Chromium 49+ | Theme-aware chip styling via `--chrome-accent` and `--phosphor-fg` | Phase 6 D-03 chip pattern; verbatim mirror for Phase 11. [VERIFIED: codebase grep — `var(--chrome-accent)` at index.html:147] |
| **CSS `[hidden]` attribute** | Chromium 4+ | Show/hide toggle without `display: none` JS toggling | Phase 6 D-03 chip pattern (`#scrollback-indicator[hidden] { display: none; }`). [VERIFIED: codebase grep — index.html:157] |
| **`localStorage` versioned blob** | Phase 6 D-32 | Prefs persistence (250 ms debounced save) | Existing `bestialitty.prefs` blob; Phase 11 adds 3 keys to DEFAULTS only. [VERIFIED: codebase grep — `prefs.js:18-30, 50, 66`] |
| **IndexedDB FileSystemDirectoryHandle** | Phase 10 D-03 | Phase 10 "Save to folder" row (carry-forward only) | Inherited unchanged from Phase 10; Phase 11 only moves the row into the SLIDE sub-block. [VERIFIED: codebase grep — `idb.js`] |
| **HTMLDetailsElement** | Chromium 12+ | Nested `<details class="reserved">` SLIDE block | Phase 6 Settings-pane `<details>` idiom; Phase 11 nests one inside it. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/HTMLDetailsElement] |
| **HTMLSelectElement** | Universal | Compatibility mode 3-way `<select>` | Standard form control; no library needed. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement] |

### Supporting (existing modules Phase 11 wires into)

| Module | Purpose | When Phase 11 Touches It |
|--------|---------|--------------------------|
| `www/renderer/scroll-state.js` | Phase 6 chip pattern | Read-only template — `slide-chip.js` mirrors its module shape verbatim. |
| `www/transport/slide.js` | Phase 8 dispatcher + Phase 9 sender + Phase 10 recv-mode events | Modify: D-09 prefs source for AUTO_SEND_COMMAND; D-12 paste-pump cancel at wakeup completion; D-14 forward `slidePumpOnPortLost`; chip subscription. |
| `www/transport/slide-recv.js` | Phase 10 receiver pipeline + cancel state machine | Modify: D-14 fill `slidePumpOnPortLost` body. |
| `www/transport/serial.js` | Phase 5 read loop + port-lost teardown | Modify: D-11 wrap `sessionLog.append(value)`; add `slidePumpOnPortLost()` calls at lines 496/527/670. |
| `www/input/file-source.js` | Phase 9 drag-drop + send button | Modify: D-10 replace silent-ignore branches with `slideChip.flashDropRejected()`. |
| `www/input/paste-pump.js` | Phase 5 paste pump | Modify: D-12 add `isSlideActive()` early-return in `enqueuePaste`. |
| `www/state/prefs.js` | Phase 6 versioned prefs blob | Modify: D-09 add 3 DEFAULTS keys. |
| `www/renderer/chrome.js` | Phase 3 visibilitychange + chrome wiring | Modify: D-13 extend visibilitychange listener; add pagehide listener. |
| `www/main.js` | Boot wiring | Modify: import + call `wireSlideChip(...)` after `wireSlideRecv` and `wireSlideDispatcher`; chip observer registration; expose `__slideChip` for Playwright. |
| `www/index.html` | DOM + CSS | Modify: chip element + chip CSS + Settings SLIDE sub-block. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hybrid observer + 250 ms tick | Pure 100 ms polling tick | Slightly higher idle CPU; cleaner test surface (no observer setup needed). Locked to default per C-02. |
| `Array<{ t, bytes }>` for throughput samples | `CircularBuffer` / fixed ring | Sample count is bounded at 4/sec × 2 s = 8 entries steady-state — array is fine. |
| `<button id="slide-chip">` | `<div id="slide-chip">` with inner `<button>` | Phase 6 chip uses `<button>` (focusable, click-targetable). Phase 11 default: same. |
| Echo-swallow inline in `slide.js` | New `www/transport/echo-swallow.js` module | Inline keeps `dispatchInbound` self-contained; module separates concerns. Locked as Claude's Discretion (C-03). |
| Chip owns awaiting-wakeup timer | Dispatcher (`slide.js`) owns timer + emits event | Chip ownership matches Phase 6 chip pattern (`scroll-state.js` owns `newLinesSinceUserScrolled`). Default: chip owns. |

**Installation:** No new packages. Phase 11 is pure HTML/CSS/JS using the browser's own APIs.

**Version verification:** N/A — no new packages. Existing dev-time deps (`@playwright/test`) unchanged from Phase 10.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 11 INTEGRATION LAYER                           │
│                                                                              │
│  ┌──────────────────┐         ┌──────────────────┐                          │
│  │ index.html       │         │ chrome.js        │                          │
│  │ • #slide-chip    │         │ • visibilitychange (extends Phase 3)        │
│  │ • SLIDE sub-     │         │ • pagehide listener (NEW)                   │
│  │   block in       │         └────────┬─────────┘                          │
│  │   Settings pane  │                  │                                    │
│  └────────┬─────────┘                  │ best-effort CTRL_CAN                │
│           │                            │ + slide.cancel()                    │
│           │ DOM refs                   │                                    │
│           ▼                            ▼                                    │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐              │
│  │ slide-chip.js (NEW)     │  │ slide.js / slide-recv.js     │              │
│  │ • lifecycle states:     │  │ • Phase 8/9/10 (locked)      │              │
│  │   hidden / active /     │◀─┤ • D-09 prefs source for      │              │
│  │   awaiting-wakeup /     │  │   AUTO_SEND_COMMAND          │              │
│  │   cancelled-summary /   │  │ • D-12 pastePump.cancelPaste │              │
│  │   error /               │  │   at wakeup completion       │              │
│  │   drop-rejected-flash   │  │ • D-14 slidePumpOnPortLost   │              │
│  │ • throughput ring       │  │   real impl in slide-recv.js │              │
│  │ • 250 ms refresh tick   │  │ • C-03 swallow-echo filter   │              │
│  │ • 3 s wakeup timer      │  │   in dispatchInbound         │              │
│  └────────┬────────────────┘  └──────────────────────────────┘              │
│           │ subscribe(__slide)              ▲                               │
│           │                                 │ port-lost calls               │
│           │                                 │                               │
│           │       ┌─────────────────────────┴─────────────┐                 │
│           │       │ serial.js (Phase 5)                   │                 │
│           │       │ • read loop:                          │                 │
│           │       │   if (!isSlideActive())               │                 │
│           │       │     sessionLog.append(value)          │                 │
│           │       │ • teardown / handleReadError /        │                 │
│           │       │   onNavSerialDisconnect:              │                 │
│           │       │     slidePumpOnPortLost()             │                 │
│           │       └───────────────────────────────────────┘                 │
│           │                                                                 │
│           │ chip flash on drop-rejected                                     │
│           ▼                                                                 │
│  ┌─────────────────────────┐  ┌──────────────────────────┐                  │
│  │ file-source.js (Phase 9)│  │ paste-pump.js (Phase 5)  │                  │
│  │ • D-10 onDragEnter/Drop │  │ • D-12 enqueuePaste:     │                  │
│  │   silent → chip flash   │  │   if (isSlideActive())   │                  │
│  └─────────────────────────┘  │     return;              │                  │
│                                └──────────────────────────┘                 │
│                                                                              │
│  ┌─────────────────────────────┐  ┌──────────────────────────┐              │
│  │ prefs.js (Phase 6)          │  │ Settings sub-block       │              │
│  │ • DEFAULTS:                 │◀─┤ (in index.html)          │              │
│  │   slideAutoSendCommand      │  │ • text input + change ev │              │
│  │   slideShowSummary          │  │ • checkbox + change ev   │              │
│  │   slideCompatibilityMode    │  │ • <select> + change ev   │              │
│  │ • 250 ms debounced save     │  │ • Save-to-folder (Ph 10) │              │
│  └─────────────────────────────┘  └──────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data flow during a happy-path SEND session:**

1. User clicks `↑ Send file` (Phase 9) → file picker → `enterSendMode({ files })`.
2. `enterSendMode` calls `pushTxBytes(prefs.slideAutoSendCommand)` (D-09 swap from Phase 9 hardcoded constant).
3. `slide-chip` enters `awaiting-wakeup` state; arms 3 s timer (if `slideCompatibilityMode === 'auto'`).
4. Swallow-echo filter pushes the auto-typed bytes into a ring with 500 ms expiry; CP/M echoes them back; filter consumes silently.
5. CP/M loads `slide.com`; emits `ESC ^ S L I D E` wakeup.
6. Dispatcher wakeup matcher fires → `enterSendModeInternal()` → `slide-chip` cancels 3 s timer, transitions to `active`.
7. Chip subscribes to `__slide` introspection: redraws on state-change events + 250 ms tick (throughput).
8. Throughput ring samples `bytes_in_file_done` every 250 ms; first 2 s shows `—`.
9. Session completes → chip transitions to `cancelled-summary` state if cancelled, or `summary` state if `slideShowSummary` is true; auto-hides after 5 s.

### Recommended Project Structure

```
www/
├── renderer/
│   ├── scroll-state.js          # Phase 6 — read-only template for slide-chip.js
│   ├── chrome.js                # MODIFIED: D-13 visibilitychange + pagehide
│   └── slide-chip.js            # NEW — chip module (~150 LOC)
├── transport/
│   ├── serial.js                # MODIFIED: D-11 session-log gate; slidePumpOnPortLost call sites
│   ├── slide.js                 # MODIFIED: D-09 prefs source; D-12 paste-pump cancel; D-14 forward; C-03 swallow-echo (or new echo-swallow.js)
│   ├── slide-recv.js            # MODIFIED: D-14 slidePumpOnPortLost real body
│   └── echo-swallow.js          # NEW (optional per C-03) — ~50 LOC
├── input/
│   ├── file-source.js           # MODIFIED: D-10 chip flash replaces silent ignore
│   └── paste-pump.js            # MODIFIED: D-12 isSlideActive() gate in enqueuePaste
├── state/
│   └── prefs.js                 # MODIFIED: D-09 three new DEFAULTS keys
├── main.js                      # MODIFIED: wireSlideChip + observer registration
├── index.html                   # MODIFIED: chip DOM + chip CSS + Settings SLIDE sub-block
└── tests/transport/
    ├── slide-chip.spec.js              # NEW — chip lifecycle states
    ├── slide-bridge.spec.js            # NEW — session-log pause + paste-pump gate + visibilitychange + port-lost
    ├── slide-compatibility.spec.js     # NEW — 3-way Compatibility mode
    ├── slide-prefs.spec.js             # NEW — Settings persistence
    └── mock-serial-slide-bot.js        # MODIFIED: wakeup-delay injection for timeout-chip tests
```

### Pattern 1: Floating Chip (`slide-chip.js`) — module-scope state with lifecycle states

**What:** Module-scope state machine. Single source of truth for chip render. Mirrors Phase 6 `scroll-state.js` shape verbatim.

**When to use:** Phase 11 chip; SLIDE-25, SLIDE-26, SLIDE-28.

**Source:** Verbatim mirror of `www/renderer/scroll-state.js:194-207` (Phase 6 `refreshChip()`).

```js
// www/renderer/slide-chip.js (NEW)
// Mirrors scroll-state.js module-scope state pattern.

let chipEl = null;
let cancelBtnEl = null;
let onCancelFn = null;
let getSlideStateFn = null;

// Lifecycle state — exactly one is active at any moment.
// 'hidden' | 'awaiting-wakeup' | 'awaiting-wakeup-timeout' | 'active' |
// 'cancelled-summary' | 'summary' | 'error' | 'drop-rejected-flash'
let lifecycle = 'hidden';

// Throughput sample ring — 2 s sliding window (D-02).
const samples = [];   // { t: number, bytes: number }
let firstSampleT = 0;

// Module-scope timers (each represents one of the chip's auto-actions).
let refreshTickHandle = null;       // 250 ms tick for throughput updates
let wakeupTimeoutHandle = null;     // 3 s timer (D-15)
let summaryAutoHideHandle = null;   // 5 s auto-hide for summary states (D-08, SLIDE-28)
let dropRejectedRevertHandle = null;// 3 s revert for drop-rejected flash (D-10)

export function wireSlideChip({ chipEl: el, cancelBtnEl: btn, getSlideState, onCancel }) {
    chipEl = el;
    cancelBtnEl = btn;
    getSlideStateFn = getSlideState;
    onCancelFn = onCancel;

    cancelBtnEl.addEventListener('click', () => onCancelFn && onCancelFn());
    cancelBtnEl.addEventListener('mousedown', (e) => e.preventDefault());  // Phase 4 D-16

    // Subscribe to dispatcher state-change events (registered from main.js).
    // Plus a 250 ms tick for throughput updates between state events.
    refreshTickHandle = setInterval(refreshChip, 250);

    refreshChip();
}

export function enterAwaitingWakeup(autoSendCmd) {
    clearAllTimers();
    lifecycle = 'awaiting-wakeup';
    refreshChip();
    // D-15 / D-16 — arm 3 s timer iff Compatibility mode === 'auto'.
    // (Compatibility mode read by caller; chip just receives a flag.)
    if (autoSendCmd.armTimer) {
        wakeupTimeoutHandle = setTimeout(() => {
            lifecycle = 'awaiting-wakeup-timeout';
            refreshChip();
        }, 3000);
    }
}

export function enterActive() {
    if (wakeupTimeoutHandle) { clearTimeout(wakeupTimeoutHandle); wakeupTimeoutHandle = null; }
    lifecycle = 'active';
    samples.length = 0;
    firstSampleT = Date.now();
    refreshChip();
}

export function enterError(reason) { /* lifecycle = 'error'; auto-hide 5 s */ }
export function enterCancelledSummary({ done, total }) { /* lifecycle = 'cancelled-summary'; auto-hide 5 s */ }
export function enterSummary({ direction, fileCount, totalBytes }) { /* D-08 — gated by prefs.slideShowSummary; auto-hide 5 s */ }
export function flashDropRejected() { /* lifecycle = 'drop-rejected-flash'; revert in 3 s (D-10) */ }
export function hide() { lifecycle = 'hidden'; chipEl.setAttribute('hidden', ''); }

function refreshChip() {
    if (lifecycle === 'hidden') {
        chipEl.setAttribute('hidden', '');
        return;
    }
    chipEl.removeAttribute('hidden');

    if (lifecycle === 'active') {
        const st = getSlideStateFn();          // __slide introspection
        if (st && st.mode !== 'terminal') {
            updateThroughputSamples(Date.now(), st.bytes_in_file_done);
            const arrow = st.mode === 'send' ? '↑' : '↓';
            const pct = st.bytes_in_file_total
                ? Math.round((st.bytes_in_file_done / st.bytes_in_file_total) * 100)
                : 0;
            const bytes = formatBytes(st.bytes_in_file_done);
            const tput = formatThroughput();
            // D-01 single-line dense:
            renderActiveChip(arrow, st.current_filename, st.file_idx + 1, st.total_files, pct, bytes, tput);
        }
    } else if (lifecycle === 'awaiting-wakeup') {
        renderText('↑ Waiting for Z80…', /* showCancel */ true);
    } else if (lifecycle === 'awaiting-wakeup-timeout') {
        renderText('Z80 didn\'t respond.', /* showButtons */ ['Retry', 'Cancel', 'Force start']);
    } else if (lifecycle === 'cancelled-summary') {
        // D-08 / SLIDE-28 — `Cancelled — N of M files transferred`
    } // ... etc
}

function updateThroughputSamples(t, bytes) {
    samples.push({ t, bytes });
    while (samples.length > 0 && samples[0].t < t - 2000) samples.shift();
}

function formatThroughput() {
    if (samples.length < 2) return '—';
    const dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
    if (dt < 2.0) return '—';   // first 2 s
    const dbytes = samples[samples.length - 1].bytes - samples[0].bytes;
    const bps = dbytes / dt;
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function clearAllTimers() {
    if (wakeupTimeoutHandle) clearTimeout(wakeupTimeoutHandle);
    if (summaryAutoHideHandle) clearTimeout(summaryAutoHideHandle);
    if (dropRejectedRevertHandle) clearTimeout(dropRejectedRevertHandle);
    wakeupTimeoutHandle = null;
    summaryAutoHideHandle = null;
    dropRejectedRevertHandle = null;
}

// Test introspection for Playwright.
export function __getStateForTests() {
    return { lifecycle, sampleCount: samples.length, hasWakeupTimeout: wakeupTimeoutHandle !== null };
}
```

### Pattern 2: Throughput Sliding Window (D-02)

**What:** 2-second sliding window over `{ t, bytes }` samples; sampled at 250 ms tick.

**When to use:** SLIDE-26 throughput display.

**Sample cadence rationale:** 250 ms tick = 4 samples/sec; 2-second window = ~8 samples steady-state. Cleanup is `Array.shift()` from head once on each tick (O(8) — negligible). At 19200 baud peak ≈ 1.9 KB/s — even an ETA-noisy 100 ms tick would be fine; 250 ms balances CPU vs latency-of-display. Phase 5 D-39 backgrounded-tab serial throttling is independent — chip already invisible while tab is hidden.

**Why not a CircularBuffer:** 8-entry array with one `shift()` per tick is well below any allocation hot-path concern. CircularBuffer adds module surface for zero cost difference.

**First-2-seconds rule:** Render `—` while either (a) `samples.length < 2`, OR (b) `samples[last].t - samples[0].t < 2000`. Both conditions guard against noisy initial estimates (a 100 KB chunk arriving in chunk 1 would otherwise show as 100 KB / 0.001 s = 100 MB/s).

### Pattern 3: Session-Log + Paste-Pump Gating via `isSlideActive()` (D-11, D-12)

**What:** Single-line `if (!isSlideActive())` predicate at the gate site.

**When to use:** SLIDE-33 (session-log + paste-pump suspension during active SLIDE session).

**Critical lifecycle question — see §Open Questions OQ-LC-1.** `isSlideActive()` returns `true` iff `slideRef !== null && state ∉ {Idle, Done, Error}`. This means:
- During the **wakeup-pending window** (after auto-type completes, before wakeup arrives) — `slideRef` is **NOT YET CONSTRUCTED** (slide.js's `pendingSendSession` is set but `new Slide()` happens in `enterSendModeInternal` only after wakeup match). So `isSlideActive() === false` during wakeup-pending.
- This is **probably correct** for D-11 (session log): the bytes between auto-type and wakeup are CP/M echo + slide.com banner — legitimately terminal output that SHOULD go to the log.
- This is **probably correct** for D-12 (paste-pump): a user could legitimately paste text into a CP/M shell DURING the wakeup wait (e.g., to abort).
- This is **correct** for D-13 (visibilitychange CTRL_CAN): no active session = no need to send CAN.

But planner should **explicitly verify** this matches the intent of D-11/D-12/D-13 with the user via discuss-phase if there's any ambiguity. Default behavior is sound.

```js
// www/transport/serial.js (read loop, modified)
const value = (await reader.read()).value;
if (value) {
    dispatchInbound(value);
    if (!isSlideActive()) sessionLog.append(value);   // D-11
}
```

```js
// www/input/paste-pump.js (modified)
export function enqueuePaste(bytes) {
    if (isSlideActive()) return;   // D-12 silent no-op
    // ... existing path
}
```

### Pattern 4: `visibilitychange` + `pagehide` CTRL_CAN (D-13)

**What:** Best-effort fire-and-forget single-byte CTRL_CAN emission on tab close / bfcache eviction.

**When to use:** SLIDE-31.

**Source:** Extension of `www/renderer/chrome.js:210` Phase 3 visibilitychange listener.

```js
// www/renderer/chrome.js (extended)
document.addEventListener('visibilitychange', () => {
    // Existing Phase 3/5 BEL-prefix + foreground-paint logic ...
    if (document.visibilityState === 'hidden' && isSlideActive()) {
        try { slide.cancel(); } catch {}
        try { txSinkRef.writeSlideFrame(new Uint8Array([0x18])); } catch {}
    }
});
window.addEventListener('pagehide', () => {
    if (isSlideActive()) {
        try { slide.cancel(); } catch {}
        try { txSinkRef.writeSlideFrame(new Uint8Array([0x18])); } catch {}
    }
});
```

**Best-effort means:** the byte may not reach the wire if the tab is being torn down — that's acceptable per PITFALLS §6 documentation. The duplicate-call guard is automatic: `slide.cancel()` is idempotent (Phase 7 D-06); the second call no-ops because state is already `CancelPending`.

### Pattern 5: `slidePumpOnPortLost` (D-14)

**What:** Symmetric to `pastePumpOnPortLost`; fills the existing Phase 10 stub at `slide-recv.js:683-690`.

**When to use:** SLIDE-32.

```js
// www/transport/slide-recv.js (D-14 full body — replaces 5-line stub)
export function slidePumpOnPortLost() {
    if (!isSlideActive()) return;
    try { slideRef.force_idle(); } catch {}    // Phase 7 D-08 escape hatch
    try { txSinkRef.setWireOwner('terminal'); } catch {}
    slideChip.enterError('port lost');           // 5-second auto-hide
    reset();                                     // module-scope state reset
}

// www/transport/slide.js (line 199 — forwarder updated)
export function slidePumpOnPortLost() {
    slideRecv.slidePumpOnPortLost();
}

// www/transport/serial.js (existing pastePumpOnPortLost call sites at 496/527/670)
pastePumpOnPortLost();
slidePumpOnPortLost();   // NEW — Phase 11 D-14
```

### Pattern 6: Drop-Rejected Chip Flash (D-10)

**What:** 3-second flash state on the SLIDE chip; replaces Phase 9's silent ignore in `file-source.js:178-183, 207-211`.

**When to use:** SLIDE-11.

```js
// www/input/file-source.js (modified)
function onDragEnter(ev) {
    if (!hasFiles(ev.dataTransfer)) return;
    if (isSessionActive()) {
        ev.preventDefault();
        slideChip.flashDropRejected();   // D-10 — replaces silent return
        return;
    }
    // ... existing accept path
}

function onDrop(ev) {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    if (isSessionActive()) {
        slideChip.flashDropRejected();   // D-10
        return;
    }
    // ... existing accept path
}
```

```js
// www/renderer/slide-chip.js (relevant excerpt)
export function flashDropRejected() {
    if (dropRejectedRevertHandle) clearTimeout(dropRejectedRevertHandle);
    const prevLifecycle = lifecycle;
    lifecycle = 'drop-rejected-flash';
    refreshChip();
    dropRejectedRevertHandle = setTimeout(() => {
        // Revert to the prior lifecycle state if still active.
        if (lifecycle === 'drop-rejected-flash') {
            lifecycle = prevLifecycle;
            refreshChip();
        }
        dropRejectedRevertHandle = null;
    }, 3000);
}
```

### Pattern 7: Auto-Type Swallow-Echo Filter (C-03)

**What:** Byte-for-byte match against a swallow buffer with 500 ms expiry; sits BEFORE the wakeup matcher in `dispatchInbound`'s terminal branch.

**When to use:** SLIDE-14.

**Data structure:** A simple FIFO array (or Uint8Array ring) of typed bytes with a single expiry timestamp covering the whole buffer (vs per-byte timestamps).

**Algorithm:**

```js
// www/transport/echo-swallow.js (NEW, ~50 LOC; or inline in slide.js)
let swallowBuf = [];          // pending bytes the swallow filter expects to match against
let swallowExpiry = 0;         // Date.now() + 500 when swallowBuf is populated; 0 when empty/expired

// Called by slide.js when auto-typing.
export function pushTypedBytes(bytes) {
    // Append to swallow buffer; reset expiry.
    for (const b of bytes) swallowBuf.push(b);
    swallowExpiry = Date.now() + 500;
}

// Called from dispatchInbound's terminal branch BEFORE the wakeup matcher.
// Returns the bytes that should be forwarded to term.feed (with matched echoes consumed).
export function filterInboundForEcho(value) {
    if (swallowBuf.length === 0) return value;
    if (Date.now() > swallowExpiry) {
        // Expired — flush remaining swallow buffer to term.feed.
        const flushed = new Uint8Array(swallowBuf);
        swallowBuf.length = 0;
        const out = new Uint8Array(flushed.length + value.length);
        out.set(flushed, 0);
        out.set(value, flushed.length);
        return out;
    }
    // Byte-for-byte match against swallow buffer head.
    const out = [];
    for (const b of value) {
        if (swallowBuf.length > 0 && swallowBuf[0] === b) {
            swallowBuf.shift();        // matched — silently consumed
        } else if (swallowBuf.length > 0) {
            // Mismatch mid-buffer — flush remaining swallow buffer + this byte.
            for (const sb of swallowBuf) out.push(sb);
            swallowBuf.length = 0;
            out.push(b);
        } else {
            out.push(b);
        }
    }
    return new Uint8Array(out);
}
```

**Edge cases:**
- **Local-echo on (Phase 4 D-12):** typed bytes already painted on screen via local-echo; CP/M's echo is a duplicate. Swallow consumes the duplicate. No action needed in the filter — local-echo path is independent (paints synchronously on TX).
- **CR/LF mode (Phase 4 D-13):** TX bytes go through CR/LF rewrite. The swallow buffer is populated with **post-rewrite bytes** (the actual wire bytes). CP/M echoes what arrived. Match is byte-for-byte. Filter is mode-transparent.
- **Wakeup matcher interaction:** the filter runs FIRST; the wakeup matcher runs on the filtered output. If the wakeup arrives during the 500 ms window, the wakeup bytes (`ESC ^ S L I D E`) won't match the typed bytes (`B : S L I D E ' ' R \r`) at the head of the swallow buffer — first byte mismatch (`ESC` vs `B`) flushes the swallow buffer to `term.feed`, then the wakeup matcher sees the unaltered bytes. ✓
- **Mismatch mid-buffer:** if CP/M echoes 3 of the 10 bytes, then sends an unrelated byte, the filter flushes the remaining 7 typed bytes + the unrelated byte to `term.feed`. The terminal sees a partial duplicate but this is the safer failure mode (vs silently swallowing all subsequent inbound).

**Inline-vs-module choice:** Default to `www/transport/echo-swallow.js` as a separate ~50 LOC module — keeps `dispatchInbound` self-contained, gives Playwright a clean import target for unit tests, matches the project's module-scope pattern.

### Pattern 8: Z80-No-Respond Timeout Chip (D-15, D-16)

**What:** 3 s timer armed at auto-type completion; if wakeup arrives → cancel timer, transition to active; if 3 s elapses → render timeout chip with `[Retry] [Cancel] [Force start]` buttons.

**When to use:** SLIDE-35.

**Branching by Compatibility mode (D-16):**

```
user clicks Send → auto-type completes → branch on prefs.slideCompatibilityMode:
  case 'force-start':
    skip wakeup wait; enterSendModeInternal(pendingSendSession) immediately
  case 'wakeup-required':
    chip enters 'awaiting-wakeup' state (no timer, no timeout chip)
  case 'auto' (default):
    chip enters 'awaiting-wakeup' state; 3 s timer arms;
    on timeout, chip enters 'awaiting-wakeup-timeout' state
```

**Where the branch lives — see §Open Questions OQ-CM-1 and §Code Examples below.** Default: branch in `slide.js` at the auto-type completion site, BEFORE calling `slideChip.enterAwaitingWakeup()`. The chip module receives a precomputed flag: "should I arm the 3 s timer?". Keeps mode-policy logic centralized in dispatcher.

```js
// www/transport/slide.js (relevant — modified enterSendMode)
export function enterSendMode({ metadata, fileBytes }) {
    // ... existing first-click-wins guard, etc.

    const cmd = bytesFromAutoSendCommand(prefs.slideAutoSendCommand);
    if (cmd.length > 0) {
        echoSwallow.pushTypedBytes(cmd);   // C-03 swallow-echo arm
        pushTxBytes(cmd);
    }

    if (prefs.slideCompatibilityMode === 'force-start') {
        // D-16 force-start — skip wakeup wait entirely.
        enterSendModeInternal({ metadata, fileBytes });
        return;
    }

    pendingSendSession = { metadata, fileBytes };
    slideChip.enterAwaitingWakeup({
        armTimer: prefs.slideCompatibilityMode === 'auto'   // D-16
    });
}
```

**Retry / Cancel / Force-start button semantics from the timeout chip:**
- `[Retry]` — re-emit the auto-type command (push to swallow + push to wire); re-arm 3 s timer.
- `[Cancel]` — clear `pendingSendSession`, hide chip, return mode to `terminal`.
- `[Force start]` — call `enterSendModeInternal(pendingSendSession)` directly; equivalent to flipping Compatibility mode to `force-start` for this one session.

### Pattern 9: Settings Sub-Block (`<details class="reserved">`) — D-05

**What:** Nested `<details>` inside the Settings `<details>` pane. Exact verbatim CSS class `reserved` mirrors the existing `details.reserved` styling at stylesheet line 298.

**When to use:** SLIDE-39.

```html
<!-- www/index.html — inside #settings <details> pane, after existing toggle rows -->
<details class="reserved">
  <summary>SLIDE file transfer</summary>

  <!-- Phase 10 D-02 row, MOVED here (was top-level previously) -->
  <div class="settings-row">
    <input type="checkbox" id="slide-recv-to-folder">
    <label for="slide-recv-to-folder">Save received files to a folder</label>
    <button id="slide-recv-folder-button" type="button">Choose folder…</button>
    <span id="slide-recv-folder-status">No folder selected</span>
  </div>

  <!-- D-06 auto-send command -->
  <div class="settings-row">
    <label for="slide-auto-send-command">Auto-send command</label>
    <input type="text" id="slide-auto-send-command" value="B:SLIDE R">
    <p class="hint"><code>\r</code> appended automatically</p>
  </div>

  <!-- D-08 show summary -->
  <div class="settings-row">
    <input type="checkbox" id="slide-show-summary" checked>
    <label for="slide-show-summary">Show transfer summary chip</label>
  </div>

  <!-- D-07 Compatibility mode -->
  <div class="settings-row">
    <label for="slide-compatibility-mode">Compatibility mode</label>
    <select id="slide-compatibility-mode">
      <option value="auto">Auto</option>
      <option value="wakeup-required">Wakeup-required</option>
      <option value="force-start">Force-start (legacy slide.com)</option>
    </select>
  </div>
</details>
```

**JS wiring (in `main.js` or Settings-specific module):**

```js
// Mirrors Phase 4/6 Settings pattern — change events fire savePrefs.
const autoSendCmdInput = document.getElementById('slide-auto-send-command');
autoSendCmdInput.value = (prefs.slideAutoSendCommand ?? 'B:SLIDE R\r').replace(/\r$/, '');
autoSendCmdInput.addEventListener('change', () => {
    savePrefs({ slideAutoSendCommand: autoSendCmdInput.value + '\r' });   // D-06 — \r appended at save
});
// ... show-summary + Compatibility mode similarly
```

### Anti-Patterns to Avoid

- **Sharing the Phase 6 `#scrollback-indicator` element with SLIDE chip.** Different click handlers, different visibility logic, different content shape. Phase 11 creates a separate `<button id="slide-chip">` element. (PITFALLS §14, ARCHITECTURE Anti-Pattern 3.)
- **Putting the awaiting-wakeup timer in dispatcher (`slide.js`).** The timer's lifetime is the chip's awaiting-wakeup state; co-locating with the chip module keeps the cleanup logic in one place. (Default per Claude's Discretion.)
- **Using `display: none` to hide the chip via JS toggling.** Use the `[hidden]` attribute + CSS rule (`#slide-chip[hidden] { display: none; }`). Mirrors Phase 6.
- **Writing chip CSS in JS.** All chip styling lives in `index.html`'s `<style>` block. JS only toggles `[hidden]` and sets `textContent` / `innerHTML`. Theme-awareness via CSS custom properties; zero theme JS in chip module.
- **Reading prefs synchronously inside the chip's 250 ms tick.** Prefs are debounced-saved (Phase 6 D-33) but reads are cheap (in-memory `cached` blob). Chip can read freely; planner verifies in spec.
- **Adding a `CURRENT_VERSION` bump for the 3 new prefs keys.** Phase 6 D-32 defensive merge fills missing fields from DEFAULTS automatically. Bumping would require a migration step for zero benefit. (D-09 explicitly forbids the bump.)
- **Running `slide.cancel()` synchronously inside the visibilitychange listener WITHOUT a try-catch.** wasm-bindgen panics propagate as JS exceptions; if the slide instance was already freed, the panic would prevent the `writeSlideFrame(0x18)` from firing. Both calls MUST be in independent `try-catch` blocks per D-13.
- **Inline-string-concatenating the chip text in JS.** `textContent` is fine for plain text; for the active-state chip (`↑ MY-DOC.TXT  2/3  47%  482 KB  12.3 KB/s`), use `textContent` with template-string formatting. **Do NOT use `innerHTML`** unless rendering the existing Phase 6 `<span aria-hidden="true">↓</span>` pattern (verbatim in scroll-state.js:201).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chip module shape | Custom observer pattern | Verbatim mirror of `scroll-state.js` (module-scope state + `wireXxx({...})` initializer + `[hidden]` toggle) | Phase 6 chip is the proven daily-driver template; keeps Phase 11 chip indistinguishable in style. |
| Throughput sliding window | Custom CircularBuffer / RingBuffer class | Plain `Array<{ t, bytes }>` with `push` + `shift` | At 4 samples/sec × 2 s = 8 entries, allocation cost is negligible. CircularBuffer adds module surface for zero gain. |
| Prefs versioning | Custom migration framework | Phase 6 defensive merge (`{ ...DEFAULTS, ...parsed, ... }` at prefs.js:66) | Already handles additive fields transparently. Migrations are reserved for renames/removals. |
| Settings pane row markup | Custom Settings DSL | Phase 4 D-13 / D-14 `<details>` + `.settings-row` HTML idiom | Existing CSS rules cover spacing, typography, `details.reserved` styling. |
| `[hidden]` toggle | `display: none` JS toggling | `chipEl.toggleAttribute('hidden', isHidden)` + `#chip[hidden] { display: none; }` CSS rule | Phase 6 D-03 pattern; preserves `pointer-events: none` semantics implicitly. |
| Throughput formatting | Custom unit-formatting library | Inline `formatBytes` / `formatThroughput` functions (~10 lines each) | One-off project-specific format; library would be overkill. |
| `visibilitychange` listener registration | Custom abstraction | Use `document.addEventListener('visibilitychange', ...)` directly, extending Phase 3's existing listener body | Phase 3 already owns the listener; Phase 11 adds a second branch. |
| `pagehide` handler | Custom bfcache abstraction | `window.addEventListener('pagehide', ...)` with same body as visibilitychange | Standard browser event; MDN documents it as the bfcache-safe complement. |
| Auto-type swallow buffer | Custom byte-deque library | Plain JS `Array` with `push`/`shift` + a single `swallowExpiry: number` timestamp | Buffer length is bounded at ≤ 10 bytes (auto-send command); allocation cost is irrelevant. |
| Compatibility mode branching | Custom strategy pattern | A single `switch` (or 3-arm `if/else if/else`) at the auto-type completion site in `slide.js` | Three modes; one branch site; nothing to abstract. |

**Key insight:** Phase 11 is integration glue. Every module shape, persistence pattern, event-listener idiom, and CSS pattern already exists in the codebase from Phases 3–10. Phase 11 wires them together; building **anything** custom is a code smell.

## Runtime State Inventory

> Phase 11 is **not a rename / refactor / migration phase**. It adds new code paths (chip module, swallow filter, timeout chip), wires them into existing seams, and adds 3 prefs keys. There is no string rename, no string replacement, no schema migration, no service config change. Per the researcher protocol, this section is included for completeness but reports zero items in each category.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified by grep across `.planning/`, `www/`, `crates/`. No SLIDE-related data lives in any datastore (the 250 ms-debounced prefs blob is JSON in `localStorage`; new keys are additive per D-09). | None |
| Live service config | None — there are no external services. The Z80-side `slide.com` is referenced only by the auto-send command string, which is user-configurable per D-06 and stored in prefs. | None |
| OS-registered state | None — BestialiTTY is a static web app served from `www/`. No OS task / service / launchd / systemd registrations exist. | None |
| Secrets / env vars | None — Phase 11 introduces no secret material. The auto-send command default `B:SLIDE R\r` is a plain CP/M shell command, not credentialed. | None |
| Build artifacts / installed packages | None — Phase 11 makes zero Rust changes; `www/pkg/` (the wasm-pack output) is unaffected. `scripts/build.sh` may still be run for parity (per CONTEXT.md `<canonical_refs>`) but is not strictly required. | None |

## Common Pitfalls

### Pitfall 1: `isSlideActive()` returns `false` during the wakeup-pending window

**What goes wrong:** The user has clicked Send → auto-type has been pushed onto the wire → `pendingSendSession` is set in `slide.js`, but `slide` (the wasm Slide instance) is still null because `enterSendModeInternal` only fires when the wakeup matches. During this window, `isSlideActive()` returns `false`. If a planner expects D-11 (session-log gate) / D-12 (paste-pump gate) / D-13 (visibilitychange CTRL_CAN) to fire during this window, they will be surprised.

**Why it happens:** `isSlideActive()` is implemented as `slideRef !== null && state ∉ {Idle, Done, Error}` — it checks the wasm instance, not the dispatcher's "intent to enter SLIDE mode soon" state.

**How to avoid:** Confirm that the existing semantic is correct (sessions during wakeup-pending are still terminal-mode CP/M echo + slide.com banner — those bytes SHOULD be logged and pasting SHOULD work). If a stricter semantic is needed, planner must introduce a `isSessionPending()` predicate that returns true when `pendingSendSession !== null` OR `slideRef !== null`. Default for Phase 11: keep `isSlideActive()` semantic; document the wakeup-pending window in code comments.

**Warning signs:** Test failures asserting "session log empty during entire send flow" when the test starts the timer at click-Send rather than at wakeup-match.

### Pitfall 2: 250 ms throughput tick lags during heavy outbound

**What goes wrong:** During a sender-mode session, `dispatchSendMode` is async fire-and-forget per chunk. If a chunk burst arrives during a tick window, the tick's read of `__slide.bytes_in_file_done` may show a stale value. The chip's throughput display jitters.

**Why it happens:** The 250 ms tick is sampled from a `setInterval` in the chip module; it reads `__slide` introspection. The sender main loop updates `bytes_in_file_done` asynchronously.

**How to avoid:** Accept this — at 19200 baud peak ≈ 1.9 KB/s, the per-tick byte delta is ≤ 475 bytes. Display jitter is bounded. Don't try to synchronize the tick with the sender — it's not worth the complexity for a 2-second-window display. Document in chip module comments.

**Warning signs:** Throughput display oscillates between two values during fast send. Acceptable per FEATURES.md TS-9 honesty bar ("not precise").

### Pitfall 3: Compatibility mode `force-start` skips the swallow-echo filter window

**What goes wrong:** `force-start` mode skips the wakeup wait entirely; auto-type completes → immediately enter send mode. But CP/M's echo of the auto-type bytes hasn't arrived yet; once we're in send mode, the echo bytes flow into the SLIDE state machine (which expects ACK/NAK/RDY, not `B:SLIDE R\n`).

**Why it happens:** `force-start` was designed for legacy slide.com that doesn't emit a wakeup; the assumption is that `slide.com` is already running and ready to receive frames. But the user still types `B:SLIDE R\r` to start it, and CP/M still echoes.

**How to avoid:** Two options for the planner:
1. **Document `force-start` as "user must clear the auto-send command first"** — the user who picks `force-start` is presumably running pre-v0.2.1 slide.com and knows to set `slideAutoSendCommand: ''` (empty disables auto-type per D-06). Then there's no echo to confuse.
2. **Apply the swallow-echo filter even in `force-start`** — the filter runs in `dispatchInbound`'s terminal branch, but in send mode bytes don't go through the terminal branch. Counter-intuitive: `force-start` enters send mode immediately, so the swallow filter never gets a chance.

**Recommendation:** Plan as Option 1 (document; rely on user to clear auto-send for legacy slide.com). The `[Force start]` button on the timeout chip explicitly skips the wakeup wait but the auto-type has ALREADY completed by the time the chip is shown — the echo (if any) has already drained or is captured by the dispatcher's terminal branch BEFORE entering send mode. So the timeout-chip-`[Force start]` path is fine; only the Settings-locked `force-start` mode has the issue, and only when auto-send is non-empty.

**Warning signs:** SLIDE state machine errors immediately after sending in `force-start` mode with a non-empty auto-send command.

### Pitfall 4: Drop-rejected flash overlapping with active session redraws

**What goes wrong:** User drops a file mid-session → `flashDropRejected()` sets `lifecycle = 'drop-rejected-flash'` for 3 s. During those 3 s, the chip module's 250 ms refresh tick reads `__slide` and tries to render the active state, overwriting the rejection message.

**Why it happens:** Two writers to chip lifecycle: the explicit `flashDropRejected` call AND the refresh tick.

**How to avoid:** Two options:
1. The 250 ms tick reads `lifecycle` and respects it — only renders `active` content if `lifecycle === 'active'`. The drop-rejected flash's revert timer (3 s) flips lifecycle back to `active` after the flash, then the next tick renders the active content again.
2. Render the drop-rejected message as an overlay/prefix to the active content, not a replacement: `Transfer in progress — cancel first  ↑ MY-DOC.TXT  2/3  47%  482 KB`.

**Recommendation:** Option 1. Single source of truth for what's currently displayed = `lifecycle`. The refresh tick branches on `lifecycle`; rendering is a pure function of state. Matches the Phase 6 `refreshChip()` pattern.

**Warning signs:** The drop-rejected message disappears within 250 ms of being shown.

### Pitfall 5: `slidePumpOnPortLost` race with active wakeup matcher

**What goes wrong:** Port disconnects while the wakeup matcher has consumed 5 of 7 wakeup bytes and is waiting for byte 6. `slidePumpOnPortLost` fires; calls `slideRef.force_idle()` — but `slideRef` is null because `new Slide()` hasn't been created yet (created on full wakeup match). The `try/catch` swallows it silently.

**Why it happens:** Wakeup matching state lives in `slide.js` (`wakeIdx`, `scratch`); the actual `slideRef` is created only on full match.

**How to avoid:** `slidePumpOnPortLost` MUST also reset `wakeIdx = 0` and `scratch.fill(0)` (or call `__resetForTests`-equivalent). Otherwise, after reconnect, a stale `wakeIdx` value could spuriously match the next wakeup. Add this to D-14's body:

```js
export function slidePumpOnPortLost() {
    if (!isSlideActive()) {
        // Even if no active session, reset wakeup matcher state defensively.
        slide.__resetWakeupMatcher();   // exported from slide.js — clears wakeIdx + scratch
        return;
    }
    // ... rest of D-14 body
}
```

**Warning signs:** After USB unplug + replug mid-wakeup, the next session fails to enter recv mode because the matcher consumed the wakeup signature with a stale `wakeIdx`.

### Pitfall 6: Settings change race with active session

**What goes wrong:** User opens Settings mid-session and changes `slideAutoSendCommand` or `slideCompatibilityMode`. The 250 ms-debounced save fires; `cached` prefs are updated. Next session uses new value. But the **current** session's auto-type was already pushed; the timeout chip's behavior was decided at auto-type completion.

**Why it happens:** Prefs are read at decision points (auto-type composition, timer-arm decision), not subscribed to.

**How to avoid:** Document this as expected behavior — settings changes apply to the next session, not the in-flight one. The chip module reads `prefs.slideShowSummary` at session-end (when deciding whether to show the summary chip), so toggling that mid-session affects the closing chip — that's fine. Compatibility mode and auto-send are per-session-start decisions.

**Warning signs:** User reports "I changed Compatibility mode but it didn't take effect until I retried."

## Code Examples

Verified patterns from the existing codebase. All sources are project files; line numbers reference the committed code at the time of research.

### Example 1: Phase 6 chip module shape (mirror target for Phase 11 `slide-chip.js`)

```js
// Source: www/renderer/scroll-state.js:194-207 (Phase 6 chip refresh)
function refreshChip() {
    if (!indicatorElRef || !indicatorTextElRef) return;
    if (offset > 0 && newLinesSinceUserScrolled > 0) {
        const n = newLinesSinceUserScrolled;
        const unit = n === 1 ? 'new line' : 'new lines';
        const formatted = n.toLocaleString();
        indicatorTextElRef.innerHTML = `<span aria-hidden="true">↓</span> ${formatted} ${unit}`;
        indicatorElRef.setAttribute('aria-label', `${formatted} ${unit} below — click to scroll to live output`);
        indicatorElRef.removeAttribute('hidden');
    } else {
        indicatorElRef.setAttribute('hidden', '');
    }
}
```

### Example 2: Phase 6 chip CSS (mirror target — only `right: 8px` becomes `left: 8px`)

```css
/* Source: www/index.html:138-164 (Phase 6 #scrollback-indicator) */
#scrollback-indicator {
  position: absolute;
  bottom: 8px;
  right: 8px;        /* ← Phase 11 #slide-chip changes this to: left: 8px; */
  z-index: 5;
  font-family: inherit;
  font-size: 12px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.65);
  color: var(--chrome-accent);
  border: 1px solid var(--chrome-accent);
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
[data-theme="crt"] #scrollback-indicator {
  color: var(--phosphor-fg);
  border-color: var(--phosphor-fg);
}
#scrollback-indicator[hidden] { display: none; }
```

### Example 3: Phase 3 visibilitychange listener (extension target for D-13)

```js
// Source: www/renderer/chrome.js:210-215 (Phase 3 BEL prefix listener)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.title.startsWith('(!) ')) {
        document.title = document.title.slice(4);
    }
    if (!document.hidden && requestFrame) requestFrame();
    // Phase 11 D-13 — additional branch: if hidden && isSlideActive(),
    // try slide.cancel() + try writeSlideFrame([0x18]).
});
```

### Example 4: Phase 6 prefs DEFAULTS shape (extension target for D-09)

```js
// Source: www/state/prefs.js:18-30 (Phase 6 + Phase 10 DEFAULTS)
const CURRENT_VERSION = 1;
const DEFAULTS = Object.freeze({
    version: CURRENT_VERSION,
    // ... existing fields ...
    slideRecvToFolder: false,    // Phase 10
    // Phase 11 D-09 ADDS:
    slideAutoSendCommand: 'B:SLIDE R\r',
    slideShowSummary: true,
    slideCompatibilityMode: 'auto',
});
```

### Example 5: Phase 5 paste-pump cancel pattern (mirror for D-12)

```js
// Source: www/input/paste-pump.js (Phase 5 D-18)
export function cancelPaste() {
    // ... settles in-flight writes, clears queue ...
}
// Phase 11 D-12 invocation:
//   import { cancelPaste } from '../input/paste-pump.js';
//   // At wakeup match completion in slide.js:
//   cancelPaste();
```

### Example 6: Phase 5 `pastePumpOnPortLost` symmetric template (mirror for D-14)

```js
// Source: www/input/paste-pump.js
export function pastePumpOnPortLost() { /* ... */ }
// Source: www/transport/serial.js:496, 527, 670 — call sites
pastePumpOnPortLost();
// Phase 11 D-14 ADDS at each site:
slidePumpOnPortLost();
```

### Example 7: Phase 4 mousedown preventDefault (mirror for chip Cancel button)

```js
// Source: www/renderer/scroll-state.js:55-57 (Phase 6 chip click)
indicator.addEventListener('click', () => snapToBottom());
indicator.addEventListener('mousedown', (e) => {
    e.preventDefault();   // Phase 4 D-16 focus-retention — sacred.
});
```

### Example 8: Compatibility mode branch (D-15, D-16 — Phase 11 NEW)

```js
// www/transport/slide.js — within enterSendMode after auto-type push.
const cmd = bytesFromAutoSendCommand(prefs.slideAutoSendCommand);
if (cmd.length > 0) {
    echoSwallow.pushTypedBytes(cmd);
    pushTxBytes(cmd);
}

if (prefs.slideCompatibilityMode === 'force-start') {
    // D-16 — skip wakeup wait entirely; jump into send mode after auto-type.
    enterSendModeInternal({ metadata, fileBytes });
    return;
}

pendingSendSession = { metadata, fileBytes };
slideChip.enterAwaitingWakeup({
    armTimer: prefs.slideCompatibilityMode === 'auto'   // 'wakeup-required' = no timer; 'auto' = 3 s
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 9 silent ignore on drag/drop during active session | Chip flash "Transfer in progress — cancel first" (D-10) | Phase 11 SLIDE-11 | User-visible feedback; replaces silent failure mode. |
| Phase 9 hardcoded `B:SLIDE R\r` constant in `slide.js` | Prefs-sourced `prefs.slideAutoSendCommand` (D-06, D-09) | Phase 11 SLIDE-37 | User-configurable; empty disables auto-type. |
| Phase 10 "Save to folder" row at top-level Settings pane | Moved into nested `<details class="reserved">` SLIDE block (D-05) | Phase 11 SLIDE-39 | Visual grouping; Settings stays scannable. |
| Phase 5 BEL-only visibilitychange listener | Extended with SLIDE CTRL_CAN best-effort emit (D-13) | Phase 11 SLIDE-31 | Tab-close mid-transfer no longer leaves wire in undefined state. |
| Phase 8 `slidePumpOnPortLost` no-op stub | Real impl: `force_idle + setWireOwner('terminal') + chip.enterError + reset` (D-14) | Phase 11 SLIDE-32 | Symmetric with `pastePumpOnPortLost`; recoverable port-lost mid-session. |
| Phase 6 session-log captures all RX bytes unconditionally | Gated by `if (!isSlideActive())` predicate (D-11) | Phase 11 SLIDE-33 | Binary frame bytes don't pollute the RX log. |
| Phase 5 paste-pump always accepts `enqueuePaste` | Gated by `if (!isSlideActive())` early-return (D-12) | Phase 11 SLIDE-33 | Pastes during active session silently no-op. |

**Deprecated / outdated:**
- Phase 9 `AUTO_SEND_COMMAND` `Uint8Array` constant in `slide.js:155` — replaced by `prefs.slideAutoSendCommand` lookup (D-09).
- Phase 9 silent-ignore branches in `file-source.js:178-183, 207-211` — replaced by `slideChip.flashDropRejected()` (D-10).
- Phase 8 `slidePumpOnPortLost` no-op at `slide.js:199-201` — forwards to real impl in `slide-recv.js` (D-14).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Browser fires `pagehide` reliably for bfcache eviction in Chromium 89+ | Standard Stack table | Low — MDN documents pagehide as the spec-guaranteed signal; BestialiTTY is Chromium-only. If wrong, `visibilitychange` covers most cases anyway. [CITED: MDN] |
| A2 | The Phase 6 D-32 defensive merge (`{ ...DEFAULTS, ...parsed, ... }` at prefs.js:66) handles all three new keys (`slideAutoSendCommand`, `slideShowSummary`, `slideCompatibilityMode`) without any migration step | D-09, C-06 | Low — verified by reading prefs.js:66 ([VERIFIED: codebase grep]) and the explicit Phase 10 D-03 precedent (`slideRecvToFolder` added without bump). |
| A3 | The 3 s wakeup-tail timeout default (D-15, D-16) is appropriate for real Z80 hardware | OQ-5 from STATE.md / SUMMARY OQ-5 | Medium — hardware-empirical; verifiable only via Phase 12 UAT against patched MicroBeast. Compatibility mode `wakeup-required` is the escape hatch if 3 s proves too short. [ASSUMED — to be verified Phase 12] |
| A4 | The 500 ms swallow-echo timeout (C-03) is enough to cover CP/M's echo round-trip at 19200 baud | C-03 | Low-Medium — at 19200 baud, 10 bytes round-trip in ~5 ms wire time + CP/M echo latency (~10 ms typical). 500 ms is 10x margin. If too short on a slow Z80, planner can extend to 1000 ms. [ASSUMED — based on round-trip math] |
| A5 | The 250 ms refresh tick is fine while idle (chip hidden) | Pattern 2 | Low — `setInterval(250 ms)` while idle costs ~0 CPU on Chromium; the tick is a `function refreshChip()` that returns immediately when `lifecycle === 'hidden'`. Phase 5 D-39 backgrounded-tab handling is independent. [VERIFIED: pattern reasoning] |
| A6 | `__slide` introspection (`bytes_in_file_done`, `bytes_in_file_total`, `current_filename`) is read-only and safe to read from a `setInterval` callback without locking | C-05 | Low — JS is single-threaded; no race. Verified by Phase 9/10 chip-less tests already reading `__slide` for assertions. [VERIFIED: codebase grep] |
| A7 | `Document.dispatchEvent(new Event('visibilitychange'))` correctly mimics tab close in Playwright tests | §Validation Architecture | Medium — Phase 6 readloop.spec.js precedent uses this pattern. Playwright doesn't have a built-in "close tab while keeping handle" — the dispatchEvent approach is the standard workaround. If it fails, fall back to `page.close()` + cross-page state assertion. [ASSUMED — Phase 6 precedent suggests it works] |
| A8 | 16-bit packing of `__slide.state` enum values stays stable through Phase 11 | Pattern 1 chip subscribes to `__slide` | Low — Phase 11 makes zero Rust changes; the wasm boundary contract is locked. Boundary-shape Rust integration test (`tests/slide_wasm_boundary_shape.rs`) pins the values. [VERIFIED: locked Phase 8 pin] |
| A9 | `visibilitychange` + `pagehide` both fire on real Chromium tab-close (vs. only one) | D-13, Pattern 4 | Low — both registering with the same body is idempotent (slide.cancel is idempotent). If one doesn't fire, the other catches; if both fire, the second is a safe no-op. [CITED: MDN documents both events; [ASSUMED] that both fire — needs Playwright verification] |
| A10 | Settings pane `<details class="reserved">` styling is already generic enough to nest | D-05 | Low — the `.reserved` class is a single styled class (line 298 per CONTEXT.md); nesting works because CSS specificity is the same regardless of nesting depth. [VERIFIED: codebase grep] |

**Note for planner / discuss-phase:** Items A3, A4, A7, A9 are MEDIUM-confidence assumptions. Of these, A3 (3 s wakeup tail) is the only one with user-visible impact during Phase 11 — the other three are test-time assumptions. A3 is locked per D-15/D-16 to 3 s with Compatibility mode as escape hatch; if user wants a different default, surface in discuss-phase.

## Open Questions

These are not research gaps — they are decisions that the planner / discuss-phase should make explicit.

### OQ-LC-1: Does `isSlideActive()` cover the wakeup-pending window?

- **What we know:** `isSlideActive()` returns `true` iff `slideRef !== null && state ∉ {Idle, Done, Error}`. In sender mode, `slideRef` is created in `enterSendModeInternal` on full wakeup match — NOT at click-Send. Between click-Send and wakeup match (the "wakeup-pending window"), `isSlideActive() === false`. See `slide.js:155, 305, 472` and `slide-recv.js:341-360`.
- **What's unclear:** Is this the intended semantic for D-11 (session-log gate), D-12 (paste-pump gate), and D-13 (visibilitychange CTRL_CAN)? If yes, document. If no, planner needs to add an `isSessionPending()` predicate that also covers `pendingSendSession !== null`.
- **Recommendation:** Default behavior is **correct** — bytes in the wakeup-pending window are CP/M echo + slide.com banner, which legitimately should reach the session log; pastes are still meaningful (user might paste an Esc to abort). Lock this as the Phase 11 semantic; add code comments at each gate site explicitly stating it.

### OQ-CM-1: Where does Compatibility-mode `force-start` branching live?

- **What we know:** Three modes: `auto` / `wakeup-required` / `force-start` (D-07). `force-start` skips the wakeup wait entirely.
- **What's unclear:** Does the branch live in `slide.js` (at auto-type completion site) or in `file-source.js` (before calling `enterSendMode`)?
- **Recommendation:** Branch in `slide.js`'s `enterSendMode` after the auto-type push (Code Example 8). Keeps mode-policy logic centralized in dispatcher; `file-source.js` stays mode-agnostic. The chip module receives a precomputed `armTimer` flag.

### OQ-CHIP-1: Should the chip element be created in JS or declared in HTML?

- **What we know:** Phase 6 `#scrollback-indicator` is declared in `index.html:776-779` (HTML-first); Phase 9 drop overlay is also HTML-first (`index.html:785-787`).
- **What's unclear:** For Phase 11 `#slide-chip`, follow the same HTML-first pattern, or create the element in JS at `wireSlideChip` time?
- **Recommendation:** **HTML-first** — keeps markup grep-able, matches Phases 6 + 9, and the chip module just takes `chipEl` as an injected dependency. `wireSlideChip({ chipEl, cancelBtnEl, getSlideState, onCancel })` consumes pre-existing DOM. (Plan 06-03 Wave 2 + scroll-state.js precedent.)

### OQ-CHIP-2: Hybrid observer + 250 ms tick vs pure-polling vs pure-observer?

- **What we know:** Hybrid is locked as Claude's Discretion default (C-02 `<decisions>` block). 250 ms tick handles throughput; observer handles state transitions (mode change, file_idx change, EVT_FILE_COMPLETE / EVT_RECV_FILE_DONE).
- **What's unclear:** Does the planner have a preference based on test-surface considerations?
- **Recommendation:** **Hybrid** — pure-polling at 100 ms wastes CPU when chip is hidden; pure-observer needs a self-scheduling `setTimeout` chain for throughput updates which is more complex. Hybrid matches the natural data flow: state events are sparse (every few seconds), throughput needs sub-second updates.

### OQ-EE-1: Echo-swallow filter inline in `slide.js` or new module?

- **What we know:** C-03 explicitly leaves this to the planner. Default per CONTEXT.md `<decisions>`: "Filter location: a new `www/transport/echo-swallow.js` module called from `dispatchInbound`'s terminal-branch byte loop, before the wakeup matcher; or inline in `slide.js` as module-scope state."
- **What's unclear:** Either is fine; readability tradeoff.
- **Recommendation:** **Separate module `www/transport/echo-swallow.js`**. ~50 LOC. Keeps `dispatchInbound` self-contained, gives Playwright a clean unit-test target, matches the project's module pattern.

### OQ-CHIP-3: Awaiting-wakeup chip layout?

- **What we know:** Default per CONTEXT.md Claude's Discretion: `↑ Waiting for Z80…  [Cancel]` (compact, mirrors active layout).
- **What's unclear:** Add an animated `…` ellipsis or countdown (`2 s remaining`)? Both deferred per CONTEXT.md.
- **Recommendation:** **Static `…`**. Ship the simpler design; Phase 12 UAT can surface if users want the countdown.

### OQ-EE-2: Does the swallow-echo filter need to handle local-echo?

- **What we know:** Phase 4 D-12 supports local-echo. When local-echo is on, typed bytes are painted on the screen via local-echo (synchronous TX path) AND echoed back by CP/M.
- **What's unclear:** The swallow-echo filter swallows the CP/M echo, leaving only the local-echo painted. But what if local-echo is OFF? Then the user sees nothing for the auto-type duration, and the swallow consumes the CP/M echo silently — the user gets zero feedback that the auto-type happened.
- **Recommendation:** This is correct behavior — when local-echo is off, the user is in a normal CP/M shell session where typing the auto-send command would normally be invisible (until CP/M echoes). The chip's `awaiting-wakeup` state IS the user feedback. Document in `echo-swallow.js` head comment.

### OQ-VC-1: visibilitychange + pagehide both registering — duplicate calls?

- **What we know:** D-13 registers BOTH listeners with the same body. `slide.cancel()` is idempotent (Phase 7 D-06).
- **What's unclear:** On a real Chromium tab close, does ONE event fire or both? If both, is there a race?
- **Recommendation:** **Both registering is fine.** `slide.cancel()` is idempotent; `txSinkRef.writeSlideFrame(0x18)` is fire-and-forget (no await); a duplicate write is harmless. Playwright test should verify exactly-one CTRL_CAN appears in the writer log when `visibilitychange` is dispatched (the second handler's call hits an already-CancelPending state and the second `writeSlideFrame` is a no-op via the idempotency check inside `slide.cancel()`).

## Environment Availability

> Phase 11 has zero external dependencies beyond what Phases 1–10 already require. The Chromium runtime + `npx playwright test` are the entire environment. Per the researcher protocol, this section reports verified tooling.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Chromium browser | Page Visibility / pagehide / `<details>` / `<select>` | ✓ (universal — Web Serial floor 89+) | 89+ | — |
| `localStorage` | Phase 6 prefs blob | ✓ (universal) | — | — |
| `setTimeout` / `setInterval` | Chip refresh tick + 3 s wakeup timer + 5 s summary auto-hide | ✓ (universal) | — | — |
| `navigator.serial` mock (`mock-serial.js`) | Playwright test setup | ✓ (Phase 5 / 9 / 10 already established) | — | — |
| `mock-serial-slide-bot.js` | Playwright SLIDE protocol mock | ✓ (Phase 9 / 10 established; Phase 11 extends with wakeup-delay injection) | — | — |
| `@playwright/test` | Playwright runner | ✓ (Phase 3 onwards) | latest pinned | — |
| `bash scripts/build.sh` | Wasm rebuild | Not strictly required (zero Rust changes) | — | Skip — Phase 11 has no Rust deltas |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**Skip condition:** Phase 11 is purely code/config changes within `www/`. No external dependency probing is required.

## Validation Architecture

Per `.planning/config.json` `workflow.nyquist_validation: true` — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (`@playwright/test`) — Chromium-only project |
| Config file | `www/playwright.config.js` |
| Quick run command | `cd www && npm run test:fast` |
| Full suite command | `cd www && npm run test:fast` (no separate full-suite split) |
| Native Rust suite | `cargo test --workspace` (parity — Phase 11 has zero Rust changes; expect 283/283 unchanged) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLIDE-11 | Drops during active SLIDE session show chip "Transfer in progress — cancel first" | Playwright integration | `cd www && npx playwright test tests/transport/slide-chip.spec.js -g "drop-rejected-flash"` | ❌ Wave 0 — `slide-chip.spec.js` |
| SLIDE-14 | Auto-typed command's CP/M echo swallowed for ~500 ms | Playwright integration | `cd www && npx playwright test tests/transport/slide-bridge.spec.js -g "swallow-echo"` | ❌ Wave 0 — `slide-bridge.spec.js` |
| SLIDE-25 | Floating chip layout with direction + filename + N/M + percent + bytes | Playwright integration | `cd www && npx playwright test tests/transport/slide-chip.spec.js -g "active.*layout"` | ❌ Wave 0 |
| SLIDE-26 | Throughput on 2-second sliding window; first 2 s shows `—` | Playwright integration | `cd www && npx playwright test tests/transport/slide-chip.spec.js -g "throughput"` | ❌ Wave 0 |
| SLIDE-28 | Post-cancel chip "Cancelled — N of M files transferred" for 5 s | Playwright integration | `cd www && npx playwright test tests/transport/slide-chip.spec.js -g "cancelled-summary"` | ❌ Wave 0 |
| SLIDE-31 | `visibilitychange` listener emits best-effort CTRL_CAN | Playwright integration | `cd www && npx playwright test tests/transport/slide-bridge.spec.js -g "visibilitychange"` | ❌ Wave 0 |
| SLIDE-32 | `slidePumpOnPortLost` symmetric to `pastePumpOnPortLost` | Playwright integration | `cd www && npx playwright test tests/transport/slide-bridge.spec.js -g "port-lost"` | ❌ Wave 0 |
| SLIDE-33 | Session-log paused + paste-pump gated during active SLIDE | Playwright integration | `cd www && npx playwright test tests/transport/slide-bridge.spec.js -g "session-log\\|paste-pump"` | ❌ Wave 0 |
| SLIDE-35 | "Z80 didn't respond" timeout chip with `[Retry] [Cancel] [Force start]` | Playwright integration | `cd www && npx playwright test tests/transport/slide-compatibility.spec.js -g "timeout-chip"` | ❌ Wave 0 — `slide-compatibility.spec.js` |
| SLIDE-37 | Auto-send command persisted in `prefs.slideAutoSendCommand` | Playwright integration | `cd www && npx playwright test tests/transport/slide-prefs.spec.js -g "auto-send"` | ❌ Wave 0 — `slide-prefs.spec.js` |
| SLIDE-39 | Settings pane SLIDE sub-block with auto-send + show-summary + Compatibility | Playwright integration | `cd www && npx playwright test tests/transport/slide-prefs.spec.js -g "sub-block\\|compatibility-mode"` | ❌ Wave 0 |
| Compat — Auto mode | 3 s timer + timeout chip on miss | Playwright | `slide-compatibility.spec.js -g "auto-mode"` | ❌ Wave 0 |
| Compat — Wakeup-required | No timer; indefinite wait | Playwright | `slide-compatibility.spec.js -g "wakeup-required"` | ❌ Wave 0 |
| Compat — Force-start | Skip wakeup wait | Playwright | `slide-compatibility.spec.js -g "force-start"` | ❌ Wave 0 |

### Six Nyquist Dimensions for Phase 11

1. **Coverage (≥ 11 SLIDE-* req IDs):** SLIDE-11/14/25/26/28/31/32/33/35/37/39 — every requirement maps to ≥ 1 Playwright test (table above). Plus 3 Compatibility-mode behavioral tests.
2. **Behavioral (chip state transitions):** chip lifecycle states `hidden / awaiting-wakeup / awaiting-wakeup-timeout / active / cancelled-summary / summary / error / drop-rejected-flash` — at least one transition test per state (entry + exit) in `slide-chip.spec.js`.
3. **Boundary (pre-existing semantics):** `slidePumpOnPortLost` Phase 8 / Phase 10 stub semantics MUST be preserved as forwards (D-14); a regression test confirms the function symbol is callable from `serial.js` teardown without throwing.
4. **Integration (paste-pump + session-log + visibilitychange wiring):** 4 distinct test files: `slide-chip.spec.js` (lifecycle), `slide-bridge.spec.js` (wiring), `slide-compatibility.spec.js` (mode), `slide-prefs.spec.js` (persistence) — covers the 4 integration surfaces.
5. **Concurrency (chip render + dispatcher events + Settings change):** test that mid-session Settings change does NOT affect the in-flight session (Pitfall 6); test that drop-rejected-flash + 250 ms refresh tick don't race (Pitfall 4).
6. **Failure (port-lost mid-session, Z80-no-respond timeout, session-end during summary auto-hide):** `slide-bridge.spec.js` includes port-lost teardown; `slide-compatibility.spec.js` includes timeout chip; `slide-chip.spec.js` includes summary-state interruption (e.g., user opens new session before 5 s auto-hide expires).

### Sampling Rate
- **Per task commit:** `cd www && npx playwright test tests/transport/slide-chip.spec.js tests/transport/slide-bridge.spec.js tests/transport/slide-compatibility.spec.js tests/transport/slide-prefs.spec.js` (Phase 11-specific suite, ~30 s).
- **Per wave merge:** `cd www && npm run test:fast` (full suite — verifies no regression in Phases 4/5/6/8/9/10 specs).
- **Phase gate:** Full Playwright suite green + `cargo test --workspace` parity (283/283 unchanged) before `/gsd-verify-work`.

### Wave 0 Gaps (test infrastructure to land first)
- [ ] `www/tests/transport/slide-chip.spec.js` — chip lifecycle states (covers SLIDE-11, SLIDE-25, SLIDE-26, SLIDE-28).
- [ ] `www/tests/transport/slide-bridge.spec.js` — bridge wiring (covers SLIDE-14, SLIDE-31, SLIDE-32, SLIDE-33).
- [ ] `www/tests/transport/slide-compatibility.spec.js` — Compatibility mode (covers SLIDE-35).
- [ ] `www/tests/transport/slide-prefs.spec.js` — Settings persistence (covers SLIDE-37, SLIDE-39).
- [ ] Mock-bot extension in `mock-serial-slide-bot.js` — `setWakeupDelay(ms)` helper that injects N ms delay before emitting `ESC ^ S L I D E` (drives `awaiting-wakeup-timeout` and Compatibility-mode tests).
- [ ] (No new Rust test infrastructure needed — Phase 11 has zero Rust changes.)

### Test-design notes specific to Phase 11

**Mock-bot wakeup-delay injection:** add a `mockSlideBot.setWakeupDelay(ms)` method that, when `pushSlideHostWakeup()` is called, defers the wakeup byte emission by `ms`. Tests for `awaiting-wakeup` (no timeout / under-3s) use 1500 ms; tests for `awaiting-wakeup-timeout` use 3500 ms. Tests for `Wakeup-required` mode use 5000 ms (verify chip stays in `awaiting-wakeup` indefinitely). Tests for `Force-start` mode set delay to `Infinity` (never emit) and verify the chip transitions to `active` regardless.

**`visibilitychange` test pattern:** `await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));`. Then assert `__mockWriterLog` contains `0x18`. This pattern is precedent from Phase 5/6 readloop.spec.js (visibility-change paint catch-up tests). [ASSUMED — A7] If `Object.defineProperty` on visibilityState doesn't work in Chromium under Playwright, fall back to reading `document.hidden = true` via Object.defineProperty + dispatchEvent.

**`pagehide` test pattern:** `await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));`. Same writer log assertion. (Direct dispatch is reliable for `Event`-typed events.)

**Drop-rejected flash test pattern:** start a SLIDE recv session via `mockSlideBot.queueSendFiles(...)` + `pushSlideHostWakeup()`; while session is active, simulate a `drop` event on `#terminal-wrapper` via `dispatchEvent(new DragEvent('drop', { dataTransfer: ... }))`. Assert chip text contains `Transfer in progress — cancel first` and reverts to active layout after 3 s.

**Throughput sliding window test pattern:** drive the bot to send a 200 KB file with steady cadence; sample chip text via `expect.poll` at t=0, t=1.5 s, t=2.5 s, t=4 s. Assert: t=0 → `—`; t=1.5 s → `—`; t=2.5 s → matches `\d+(\.\d+)? (B|KB|MB)/s`; t=4 s → similar. Tolerance: ±50% on throughput value (chip is honesty-bar per FEATURES TS-9).

**Session-log gate test pattern:** start a SLIDE session; verify `window.__sessionLog.totalBytes` does NOT increase by the per-frame byte count during data-frame arrival. Compare pre-session and post-session values; the delta should equal only the wakeup-pending bytes (CP/M echo + slide.com banner) plus zero session-log bytes during the active state.

**Paste-pump gate test pattern:** during active SLIDE session, call `window.__pastePump.enqueuePaste(new Uint8Array([0x41, 0x42]))` and assert `window.__mockWriterLog` does NOT contain `0x41` or `0x42` (paste was no-op'd).

**Port-lost test pattern:** start SLIDE session; trigger `serial.handleReadError(new Error('Port lost'))` via `__resetForTests`-equivalent or by making the mock's reader throw. Assert chip transitions to `error` state with text `Transfer failed — port lost`; assert `window.__slide.__getStateForTests().mode === 'terminal'` post-teardown.

**Compatibility-mode persistence test:** set `prefs.slideCompatibilityMode = 'wakeup-required'` via `savePrefs`; reload page; assert the `<select>` shows `wakeup-required` selected. Mirrors Phase 6 prefs-roundtrip pattern.

## Security Domain

Per `.planning/config.json` — `security_enforcement` is not explicitly set; default is enabled. Phase 11 has minimal security surface (it's a pure JS integration phase on top of an already-ASVS-reviewed Phase 5 transport + Phase 6 prefs + Phase 9/10 SLIDE protocol). Categories that DO apply:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — local-only static web app |
| V3 Session Management | no | N/A — no server session |
| V4 Access Control | no | N/A — local-only |
| **V5 Input Validation** | **yes** | Auto-send command pref accepts user-typed text. Phase 11 stores it as-is per D-09. **Phase 12 SLIDE-38** adds the safety validation pass (alphanumeric + `:` + `\r` only) — explicitly out of scope for Phase 11. Document this defer-to-Phase-12 in code comments. |
| V6 Cryptography | no | N/A — SLIDE protocol uses CRC-16 (integrity, not authenticity); no crypto in Phase 11 |
| V7 Error Handling | yes | Error chip displays `reason` strings (`'port lost'`, `'CRC retries exhausted'`, etc.) — these are internal codes, not user input, and don't surface PII. |
| V8 Data Protection | yes | Prefs blob in `localStorage` includes auto-send command — could contain a CP/M filename pattern. Phase 6 D-32 already handles localStorage protection (Chromium origin-isolated). Phase 11 doesn't add new sensitive data. |
| V14 Configuration | yes | Three new prefs keys with documented defaults; defensive merge per Phase 6 D-32 ensures no runtime crash on missing/malformed values. |

### Known Threat Patterns for Phase 11 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hostile auto-send command injection (e.g., `B:RM *.* ; SLIDE R\r`) | Tampering | **Deferred to Phase 12 SLIDE-38** per CONTEXT.md `<deferred>` block. Phase 11 stores whatever user types; Phase 12 adds validation + first-use confirmation chip. Document this surface in code comments at the prefs save site. |
| Malicious file content via drag-drop (e.g., a .COM file containing CP/M shell exploit) | Tampering | Out of scope — BestialiTTY is a transport, not a file-content sandbox. The user explicitly chose to send the file. SLIDE protocol doesn't interpret content. |
| Race-condition on chip lifecycle (e.g., port-lost during summary auto-hide) | Repudiation / Tampering | Pitfall 4 + Pitfall 5 documented in §Common Pitfalls; chip module's `clearAllTimers` ensures stale timers don't fire after teardown. |
| `localStorage` quota exhaustion (forcing prefs save to fail) | Denial of Service | Phase 6 D-32 already handles via try/catch; Phase 11 inherits unchanged. |
| Cross-origin file drop (drag-drop from another tab) | Tampering | Phase 9 D-04 silent rejection at `dragenter` for non-file drags via `dataTransfer.types.includes('Files')` is preserved. Phase 11 only adds the chip-flash for in-session drops; same-origin/cross-origin filtering is upstream. |

## Sources

### Primary (HIGH confidence)
- Codebase grep — verified file paths, line numbers, existing patterns:
  - `www/renderer/scroll-state.js:194-207` (chip pattern)
  - `www/index.html:138-164` (chip CSS), `776-779` (chip element), `790` (`<details>`), `298` (`details.reserved`)
  - `www/state/prefs.js:18-30, 50-66` (DEFAULTS + defensive merge)
  - `www/transport/slide.js:155, 199, 305, 472` (auto-send constant, port-lost stub, branch points)
  - `www/transport/slide-recv.js:341-360, 683-690` (`isSlideActive`, port-lost stub)
  - `www/transport/serial.js:496, 527, 670` (port-lost call sites)
  - `www/renderer/chrome.js:210-215` (visibilitychange listener)
  - `www/input/file-source.js:115, 169, 178, 207` (silent-ignore branches, button-state observer)
  - `www/input/paste-pump.js` (Phase 5 cancelPaste pattern)
- `.planning/phases/11-slide-js-bridge-v1-0-integration/11-CONTEXT.md` (D-01..D-16, C-01..C-10, Claude's Discretion, deferred)
- `.planning/REQUIREMENTS.md` §SLIDE floating chip + cancellation (SLIDE-25/26/28); §SLIDE integration (SLIDE-11/14/31/32/33/35); §SLIDE settings & persistence (SLIDE-37/39)
- `.planning/research/PITFALLS.md` §6, §11, §14, §15, §16, §18 (the Phase 11-mapped pitfalls)
- `.planning/research/ARCHITECTURE.md` §3 TX-sink, §4 prefs, §6 chip lifecycle, §7 cancellation, Anti-Pattern 4 (no `std::time`)
- `.planning/research/SUMMARY.md` Ph E mapping; OQ-5 wakeup tail
- `.planning/research/FEATURES.md` TS-3/4/8/11/12/13/14/17/21/26 (P0/P1)

### Secondary (MEDIUM confidence)
- MDN Page Visibility API — `visibilitychange` event semantics (universal Chromium support)
- MDN `pagehide` event — bfcache eviction signal
- MDN HTMLDetailsElement — `<details class="reserved">` styling
- MDN HTMLSelectElement — Compatibility mode `<select>`
- Phase 6 06-CONTEXT.md D-03 (chip pattern), D-32/D-33 (prefs)
- Phase 10 10-CONTEXT.md D-01..D-03 (Save-to-folder), D-15 (no chip in Phase 10), C-06 (Esc disambiguation)
- ADR-003 (`.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md`) — CTRL_CAN bidirectional contract

### Tertiary (LOW confidence — flagged in Assumptions Log)
- 3 s wakeup-tail timeout — hardware-empirical (A3, OQ-5)
- 500 ms swallow-echo — round-trip math (A4)
- Playwright `dispatchEvent('visibilitychange')` mimics tab close — Phase 6 readloop.spec.js precedent (A7)
- Both `visibilitychange` and `pagehide` fire on real Chromium tab close (A9)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every API verified against MDN + codebase usage; no new packages; only existing browser primitives.
- Architecture: HIGH — every integration seam grounded in existing committed code with line numbers; mirror targets identified.
- Pitfalls: HIGH — Phase 11-relevant pitfalls explicitly named in PITFALLS.md and traced to D-* decisions; lifecycle gap (OQ-LC-1) surfaced as research finding.
- Validation Architecture: HIGH — 11 SLIDE-* req IDs each map to a named test in 4 spec files; 6 Nyquist dimensions each have a concrete test pattern.
- Open Questions: MEDIUM — 8 questions surfaced; defaults proposed for each; planner / discuss-phase resolves before locking.

**Research date:** 2026-05-08

**Valid until:** 2026-06-07 (30 days; stable browser APIs, locked CONTEXT.md, no upstream deps changing)
