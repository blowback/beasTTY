---
baseline_commit: 921d5dc77534be022e10c17d204550a0292d2e57
---

# Story E8.1: Command capture engine — line mirror & history store

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want Beastty to quietly remember the commands I send (reconstructed from what I type),
so that they are available to recall later — without changing how typing works today.

**Covers:** FR-1…FR-6, FR-20 (size cap), FR-21 (persistence) — the invisible **capture engine**. NFR-1 (JS-shell only), NFR-2 (observe-never-emit), NFR-3 (inert when off), NFR-4 (persistence/degrade).
**Epic:** E8 · Command History. This is the **first story of Epic E8**, so creating it flips `epic-e8` `backlog → in-progress`. Retrospective is `optional`.
**Depends on:** finished E0–E7 chrome only — `state/prefs.js` (AD-4) and `input/tx-sink.js` `getWireOwner()` (AD-5). **No UI** in this story: the recall overlay is E8.2, the Settings menu is E8.3. E8.1 must stand alone and be exercised via test hooks (`window.__commandHistory.__getStateForTests()`), not a visible surface.

**Premise.** Beastty is a **character-by-character passthrough** terminal — every keydown is encoded by the wasm core and pushed to the wire; the MicroBeast does all echo and line editing (Beastty holds no line buffer). This story adds the first piece of "command history": a JS-shell **line mirror** that reconstructs the current input line from outbound keystrokes, and a **history store** (persisted in prefs) that it commits to on each Enter. It is pure observation — it **never emits a byte** (NFR-2). The overlay (E8.2) and Settings (E8.3) build on the API this story exposes.

**The one seam that makes "typed-only" free.** Typed keystrokes flow through `keyboard.js`'s keydown handler → `forwardBytes()` (`www/input/keyboard.js:297,303`). **Paste** flows through `paste-pump.js` → `pushTxBytes` on a *different* path that never touches `forwardBytes`. So a capture hook placed at the `forwardBytes` choke point sees **typed keystrokes only** and naturally excludes paste — satisfying PRD OQ-4 ("do not capture pasted lines") for free, with no paste-detection logic.

## Acceptance Criteria

**AC-1 — Line mirror reconstructs the typed line; commits on Enter (FR-1, FR-3, FR-5; NFR-2).**
**Given** a new engine module `www/input/command-history.js` wired in `main.js` and fed each typed keystroke from `keyboard.js`'s `forwardBytes` choke point (`keyboard.js:297/303`)
**When** command history is enabled and the operator types `DIR` then presses Enter (any `crlfMode` — CR/LF/CRLF)
**Then** the module's line mirror accumulates `D`,`I`,`R`, and on the Enter terminator (`wasEnter`) commits `DIR` to the history store as the **newest** entry and resets the mirror to empty
**And** the module emits **zero** bytes to the wire — it only observes (`__getStateForTests()` shows the mirror/store; no `pushTxBytes` call originates here).

**AC-2 — Corrections tracked: Backspace pops, Ctrl-U/Ctrl-X clear (FR-2).**
**Given** the operator is typing a line
**When** they press **Backspace** (encoded `0x08`, `KEY_TAG.Backspace`) — the mirror pops its last character; **and when** they press **Ctrl-U** (`0x15`) or **Ctrl-X** (`0x18`) — the mirror clears entirely
**Then** a typo'd-then-corrected line commits corrected (e.g. type `DIRR`, Backspace, Enter → stores `DIR`; type `MISTAKE`, Ctrl-U, `DIR`, Enter → stores only `DIR`)
**And** keystrokes that are not printable/Backspace/Ctrl-U/Ctrl-X/Enter (arrows, Esc, Tab, other Ctrl combos, function keys) leave the mirror unchanged (fancier in-line editing is explicitly not tracked — a rare cosmetic mismatch never affects the wire).

**AC-3 — Empty lines never stored; duplicates collapse to newest (FR-3, FR-4).**
**Given** the history store
**When** Enter is pressed on an empty mirror → nothing is committed; **and when** a command equal to an existing entry is committed → the store holds a single copy **moved to newest** (exact-string, case-sensitive), not a duplicate
**Then** e.g. sending `DIR`, `LIST`, `DIR` yields store `[DIR, LIST]` (newest-first), not `[DIR, LIST, DIR]`.

**AC-4 — Capture suspended during SLIDE; inert when disabled (FR-6, NFR-3; AD-5).**
**Given** the capture hook fires at the keyboard level (before the tx-sink SLIDE gate)
**When** a SLIDE transfer is active (`tx-sink.getWireOwner() === 'slide'`) → the engine captures nothing; **and when** `commandHistoryEnabled` is `false` → the engine's capture path early-returns doing no work
**Then** neither SLIDE-period keystrokes nor any keystroke while disabled reaches the mirror or store, and typing behaves byte-for-byte as it does today.

**AC-5 — Size cap enforced; oldest dropped (FR-20).**
**Given** `commandHistorySize` (default 100) read from prefs at commit-time
**When** committing an (N+1)th distinct command where the store already holds N = the cap
**Then** the oldest entry (tail) is dropped and the store holds exactly N newest entries.

**AC-6 — Persistence across reloads; safe degrade (FR-21, NFR-4; AD-4).**
**Given** history is stored in `prefs.commandHistory` via `savePrefs` (the existing debounced localStorage mechanism)
**When** the page reloads → the store is restored from persisted prefs; **and when** stored prefs are absent or corrupt → the store degrades to empty (`[]`) and never throws (guaranteed by the existing `prefs.js` defensive merge, line 107, + the load try/catch, lines 115–121)
**And** an existing user whose stored prefs predate this feature loads with the three new keys defaulted (`commandHistoryEnabled:true`, `commandHistorySize:100`, `commandHistory:[]`) via the same merge.

**AC-7 — Public API + test hooks for E8.2/E8.3 (FR-5; AD-1/AD-2).**
**Given** the engine is a `wireCommandHistory(opts)` module returning an API object (mirroring `renderer/status-bar.js`'s shape)
**Then** it exposes at minimum: `capture(info)` (the keystroke feed passed into `wireKeyboard`), `isLineEmpty()` (mirror empty → drives E8.2's trigger, FR-5), `getHistory()` (newest-first array → E8.2's list), `commit(str)` (shared dedup+cap+persist path → E8.2's Enter-send reuses it), `clear()` (→ E8.3), plus `__getStateForTests()` and `__resetForTests()`
**And** `window.__commandHistory` is set for the Playwright chromium suite (mirrors `window.__statusBar`/`window.__menuBar`).

**AC-8 — Suite stays green on `retries:1`; new engine spec added.**
**Given** the accepted flake policy (`playwright.config.js:20-27` — chromium-transport + `retries:1`, no per-story `--workers=1`)
**Then** the full suite stays green, and a new `www/tests/**/command-history.spec.js` drives `window.__commandHistory.__getStateForTests()` + programmatic capture to cover AC-1…AC-6: commit-on-terminator, Backspace/Ctrl-U/Ctrl-X, empty-line guard, dedup-to-newest, SLIDE-suspend, disabled-inert, size-cap eviction, and reload persistence (seed `localStorage['beastty.prefs']`, reload, assert restore; corrupt blob → empty).

## Tasks / Subtasks

- [x] **Task 1 — Add the three prefs keys (AC-5, AC-6).**
  - [x] In `www/state/prefs.js` `DEFAULTS` (lines 18–71) add `commandHistoryEnabled: true`, `commandHistorySize: 100`, `commandHistory: []`. The existing defensive merge (`{ ...DEFAULTS, ...parsed, serial:{...} }`, line 107) auto-fills these for pre-existing stored blobs — no migration/version bump needed (confirm `commandHistory` is a top-level array so it merges by replacement, not the nested-object path).
- [x] **Task 2 — Build `www/input/command-history.js` (the engine) (AC-1…AC-7).**
  - [x] New module, **named exports only**, placed in `input/` (sibling to `keyboard.js`/`tx-sink.js`). Direct imports allowed: `getPrefs, savePrefs` from `../state/prefs.js` (AD-4) and `getWireOwner` from `./tx-sink.js` (AD-5, sibling — the `keyboard.js:22` precedent for a sibling input-layer import). No wasm/Rust import (NFR-1).
  - [x] Module-scope **mirror**: a transient string (NOT persisted). Not derived from `getPrefs()`.
  - [x] `export function wireCommandHistory(opts)` — returns the AC-7 API object. Store nothing it can read at use-time; read `getPrefs()` fresh each time (AD-4: never cache the ref across a `savePrefs`).
  - [x] `capture(info)` — the keystroke classifier. `info` carries `{ e, code, mods, bytes, wasEnter }` (see Task 3). Logic: early-return if `getPrefs().commandHistoryEnabled === false` OR `getWireOwner() === 'slide'` (AC-4). Else classify: `wasEnter` → `commitMirror()`; Backspace (`code === KEY_TAG.Backspace` or `bytes[0] === 0x08`) → pop; `bytes[0] === 0x15 || bytes[0] === 0x18` (Ctrl-U/Ctrl-X) → clear mirror; a printable single char (Char tag, no ctrl/alt/meta, byte `0x20–0x7E`) → append `e.key` (length-1) to the mirror; anything else → no-op.
  - [x] `commitMirror()` → if mirror non-empty, call `commit(mirror)`, then clear the mirror. Empty mirror → no-op (AC-3).
  - [x] `commit(str)` (shared path, also used by E8.2) — read `const p = getPrefs()`; build `next = [str, ...p.commandHistory.filter(c => c !== str)]` (dedup, newest-first, exact/case-sensitive — AC-3); cap: `next = next.slice(0, getPrefs().commandHistorySize)` (AC-5); `savePrefs({ commandHistory: next })`.
  - [x] `isLineEmpty()` → `mirror.length === 0` (FR-5, AC-7). `getHistory()` → `getPrefs().commandHistory` (newest-first). `clear()` → `savePrefs({ commandHistory: [] })` (E8.3). `__getStateForTests()` → `{ mirror, history: getPrefs().commandHistory, enabled, size }`. `__resetForTests()` → clear mirror (+ optionally reset history for tests).
- [x] **Task 3 — Add the capture hook to `keyboard.js` (AC-1, AC-2).**
  - [x] Add an optional `captureHistory` dep to `wireKeyboard(opts)` (destructure at `keyboard.js:167-174`; module-scope `let captureHistoryFn = null;` beside `termRef` at `:85-90`; assign in the wire body). Mirror the existing injected-dep idiom exactly (`termRef`, `sampleBellFn`, …).
  - [x] Call it at the choke point. Cleanest: inside `forwardBytes` is wrong (loses `e`/`code`) — instead call in the keydown handler right after `forwardBytes(bytes, wasEnter)` at `keyboard.js:297`, e.g. `if (captureHistoryFn) captureHistoryFn({ e, code, mods, bytes, wasEnter });` (all four are in scope there — see Dev Notes). Guard with the null-check so E8.1 wiring is optional and the suite passes if unwired.
  - [x] Do **not** alter the existing encode/forward/local-echo behavior — the hook is additive and observation-only.
- [x] **Task 4 — Wire it in `main.js` (AC-1, AC-4, AC-7).**
  - [x] Import `wireCommandHistory` from `./input/command-history.js`. Call it in the boot sequence **after `wireStatusBar` (~line 575) and before `wireKeyboard` (~line 794)** — AD-12 slot. `const commandHistory = wireCommandHistory({});` then `window.__commandHistory = commandHistory;`.
  - [x] Pass its capture method into keyboard: add `captureHistory: commandHistory.capture` to the existing `wireKeyboard({...})` opts object (`main.js:794-800`).
- [x] **Task 5 — Tests (AC-8).**
  - [x] New `www/tests/**/command-history.spec.js` (follow an existing hook-driven spec, e.g. status-bar/menu-bar specs, for `window.__*` + `__getStateForTests` patterns). Cover AC-1…AC-6 via programmatic `window.__commandHistory.capture({...})` calls and `localStorage['beastty.prefs']` seeding for reload persistence. Run the full suite; keep it green on `retries:1` (no `--workers=1`).

## Dev Notes

### The passthrough model (why this engine exists)
Beastty sends every keystroke straight to the wire; the MicroBeast echoes and line-edits. There is **no local line buffer** today. This engine adds a *shadow* line mirror purely to reconstruct "what command did the user just send," so history/recall becomes possible without changing the wire behavior. **NFR-2 is the hard invariant: this module observes and persists; it must never call `pushTxBytes` or otherwise emit bytes.** (E8.2's overlay is what will send bytes, on Enter, reusing `commit()`.)

### Capture seam — exact facts (keyboard.js)
- **Single choke point:** every typed keystroke reaches `forwardBytes(bytes, wasEnter)` exactly once (`www/input/keyboard.js:303`), called from the keydown handler at `:297`. Paste does **not** pass here (paste-pump.js → `pushTxBytes` directly), so hooking here is typed-only. [Source: keyboard.js:204-322]
- **In scope at `:293-297`:** `e` (KeyboardEvent), `code` (u32 tag from `packKeyCode`), `mods` (u32), `bytes` (encoded Uint8Array), `wasEnter` (`code === KEY_TAG.Enter || code === KEY_TAG.KeypadEnter`, `:296`). Call the hook here — do **not** move it into `forwardBytes` (which only receives `bytes, wasEnter`). [Source: keyboard.js:287-298]
- **KEY_TAG enum** (`keyboard.js:51-66`): `Char:0, ArrowUp:1, ArrowDown:2, ArrowLeft:3, ArrowRight:4, Enter:5, Tab:6, Backspace:7, Escape:8, KeypadDigit:9, KeypadEnter:10, …`.
- **Control-key encodings** (`crates/beastty-core/src/key.rs`): Backspace → `0x08` (always BS, not DEL; `key.rs:101`); Ctrl-letter → `upper − 0x40` so Ctrl-U → `0x15`, Ctrl-X → `0x18` (`key.rs:106-107`); Enter/KeypadEnter → `0x0D` (`key.rs:99,123`); arrows → `ESC A/B/C/D` (`key.rs:93-96`). The **Delete** key returns `-1` (silent drop, never sent) — so only Backspace matters for "pop." [Source: keyboard.js:139]
- **Enter terminator & crlfMode:** `wasEnter` is the terminator signal regardless of `crlfMode`; the CR→CR/LF/CRLF rewrite happens in `forwardBytes` (`:307-308`) and is irrelevant to capture (commit on `wasEnter`). `crlfMode` default `'cr'`; `CRLF_MODES` at `keyboard.js:70-74`.

### Prefs pattern — exact facts (state/prefs.js)
- `getPrefs()` (`:232-234`) returns the live `cached` blob; `savePrefs(partial)` (`:124-128`) shallow-merges + debounces a 250 ms localStorage flush and does **not** fire subscribers; `resetPrefs()` (`:218-222`) deep-clones DEFAULTS, clears storage, and **is the only subscriber fan-out**. **AD-4 rule:** read `getPrefs()` at use-time, never cache the ref across a `savePrefs` (it reassigns `cached`). [Source: prefs.js:124-234, main.js:40-47]
- `DEFAULTS` is at `prefs.js:18-71` (current keys: theme, phosphor, font, fontZoom, serial{…}, localEcho, crlfMode, wrapLongLines, stripCtrlLogs, autoConnect, showDebugPanel, …). Storage key `'beastty.prefs'` (`:15`), whole-blob `JSON.stringify` (`:142`). Absent/corrupt → `structuredClone(DEFAULTS)` (`:90-92, 115-121`); defensive merge fills missing keys (`:107`). Arrays serialize fine; enforce the size cap in the consumer (prefs.js imposes none).
- **Live enable/size with zero extra wiring:** read `getPrefs().commandHistoryEnabled` / `.commandHistorySize` at use-time. When E8.3 flips them via `savePrefs`, the engine picks the change up on the next keystroke automatically — **no setter injection needed** (unlike `setLocalEcho`/`setCrlfMode`, which exist only because `keyboard.js` reads module-scope copies in a hot path).

### Composition/boot order — exact facts (main.js)
- Sequence: `wireChrome` (~410) → `wireMenuBar` (~428) → `wireStatusBar` (~554) → `wireKeyboard` (~794). AD-12: chrome/menu keydown listeners must register **before** `wireKeyboard` so `defaultPrevented` short-circuits win. `wireCommandHistory` slots in the ~575–794 gap so its `.capture` exists to pass into `wireKeyboard`. [Source: main.js:410-800]
- `wireStatusBar` is the template for the wireXxx shape: `(opts)` → destructure → grab refs/deps → subscribe/init → `return { …publicMethods, dispose, __getStateForTests, __resetForTests }`. Direct imports there are only `state/prefs.js` + `renderer/focus.js`. [Source: status-bar.js:34-35,229-318]
- `main.js` already imports `getWireOwner` (and friends) from `./input/tx-sink.js` (`:79-88`) — but the engine can import `getWireOwner` directly as a sibling (the `keyboard.js:22` precedent), which is simpler than threading it through opts. `pushTxBytes` is **not** needed by E8.1 (no emission).

### tx-sink SLIDE gate (FR-6)
`getWireOwner()` returns `'terminal'` (default) or `'slide'` (`tx-sink.js:42,114-120`); during `'slide'`, `pushTxBytes` early-returns (`:50`). Because the capture hook is upstream of that gate, the **engine must itself check `getWireOwner() === 'slide'` and skip** — otherwise it would record keystrokes typed during a transfer (AC-4).

### Known limitation (acceptable, document in code)
The mirror does not model remote-side line aborts (e.g. Ctrl-C making the MicroBeast discard the line) or exotic in-line editing. Worst case: a stored entry is cosmetically off, or the mirror shows non-empty when the remote line is empty (so ↑ won't open the overlay until the user clears it). Never a wire effect. Matches FR-2's "fancier editing not tracked."

### Project Structure Notes
- **NEW:** `www/input/command-history.js` (engine). Placed in `input/` beside `keyboard.js`/`tx-sink.js`/`paste-pump.js` — it is input-layer federated state, not a renderer. The E8.2 **overlay** will be a separate `www/renderer/command-history.js` (transient-renderer, `paste-toast.js` precedent) — do not build it here.
- **UPDATE:** `www/state/prefs.js` (3 DEFAULTS keys), `www/input/keyboard.js` (additive `captureHistory` hook), `www/main.js` (import + `wireCommandHistory` + pass `.capture` into `wireKeyboard`).
- **Naming:** story-file/test naming follows the `e8-1-…` convention; test hook `window.__commandHistory` follows `window.__statusBar`/`__menuBar`.
- **No build step, no new dependency, no Rust/wasm change** (NFR-1, NFR-6).

### References
- [Source: _bmad-output/planning-artifacts/epics-command-history.md#Story E8.1] — ACs, FR coverage
- [Source: _bmad-output/planning-artifacts/prds/prd-beastty-2026-07-22/prd.md] — FR-1…6, 20, 21; OQ-4 (paste not captured); NFR-1/2/3/4
- [Source: _bmad-output/planning-artifacts/architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md] — AD-1/2 (wireXxx), AD-3 (import allowlist), AD-4 (prefs), AD-5 (getWireOwner), AD-12 (boot order)
- [Source: www/input/keyboard.js:51-66,167-178,287-322] — KEY_TAG, wireKeyboard opts, choke point
- [Source: www/input/tx-sink.js:42,50,114-120] — SLIDE owner gate
- [Source: www/state/prefs.js:15,18-71,107,124-234] — DEFAULTS, merge, save/get/reset
- [Source: www/main.js:410-800] — boot order + wireKeyboard call site
- [Source: www/renderer/status-bar.js:34-35,229-318] — wireXxx template shape

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- Isolated-file run first attempt: 9/17 flaky (all recovered on `retries:1`); every
  failure was the boot `waitForFunction(window.__commandHistory)` timing out. Running
  `--workers=1` (serialized): 17/17 pass in 4.7 s with zero errors — confirming pure
  parallel-boot starvation (the documented E1 flake), not a module defect. In the FULL
  suite my spec passed cleanly (not in the flaky list); suite = 545 passed / 0 failed /
  1 skipped / 18 flaky-recovered — the pre-existing boot-under-parallelism flake spread
  across grid/menu-bar/transport specs, which `retries:1` is designed to mask (AC-8).

### Completion Notes List

- **Engine (Task 2).** `www/input/command-history.js` — a `wireCommandHistory(opts)`
  module (AD-2 shape) with a module-scope transient line mirror and a shared
  `commit()` path. Imports only `getPrefs`/`savePrefs` (AD-4) and `getWireOwner`
  (AD-5); no wasm/Rust import (NFR-1); **no `pushTxBytes`** — the NFR-2 observe-only
  invariant holds structurally (the byte-emitter is simply not imported).
- **Capture hook (Task 3).** Additive optional `captureHistory` dep on `wireKeyboard`,
  called right after `forwardBytes` at `keyboard.js:297` where `e/code/mods/bytes/
  wasEnter` are all in scope (the reason it lives in the handler, not inside
  `forwardBytes`). Null-guarded so wiring stays optional. Paste never reaches this
  point (paste-pump → `pushTxBytes`), so the hook is typed-only for free (OQ-4).
- **Classification.** Backspace/Ctrl-U/Ctrl-X detected by encoded byte (`0x08`/`0x15`/
  `0x18`) so they work regardless of key-vs-code path; printables gated on Char tag +
  no Ctrl/Alt/Meta + single-char `e.key` + byte `0x20–0x7E`. All other keys are no-ops.
- **Live enable/size (AD-4).** Read fresh from `getPrefs()` at use-time — an E8.3
  toggle applies on the next keystroke with zero setter injection.
- **Prefs (Task 1).** Three top-level DEFAULTS keys ride the existing defensive
  spread-merge; `commandHistory: []` is a top-level array so it merges by replacement.
  No `CURRENT_VERSION` bump, no migration (same precedent as `showDebugPanel` etc.).
- **Wiring (Task 4).** `wireCommandHistory({})` slotted in the AD-12 gap after
  `wireStatusBar`, before `wireKeyboard`; `window.__commandHistory` exposed; `.capture`
  passed into `wireKeyboard`.
- **Tests (Task 5).** `www/tests/render/command-history.spec.js` (17 tests) covers
  AC-1…AC-6 via programmatic `capture({...})` feeds plus one real-keyboard test that
  proves the choke-point hook is genuinely wired end-to-end. SLIDE-suspend drives
  `window.__txSink.setWireOwner('slide')`; persistence seeds `localStorage['beastty.prefs']`
  and reloads (incl. corrupt-blob and pre-feature-blob degrade paths).
- **Scope.** No visible surface (per story) — the recall overlay is E8.2, Settings is
  E8.3, both building on this API. Known limitation documented in-code: the mirror does
  not model remote-side line aborts or exotic in-line editing (never a wire effect).

### File List

- `www/state/prefs.js` — UPDATE: three DEFAULTS keys (`commandHistoryEnabled`,
  `commandHistorySize`, `commandHistory`).
- `www/input/command-history.js` — NEW: the capture engine.
- `www/input/keyboard.js` — UPDATE: additive optional `captureHistory` hook at the
  `forwardBytes` choke point.
- `www/main.js` — UPDATE: import + `wireCommandHistory` wire + `window.__commandHistory`
  + `captureHistory` passed into `wireKeyboard`.
- `www/tests/render/command-history.spec.js` — NEW: AC-1…AC-6 spec (17 tests).

## Change Log

- 2026-07-22 — Implemented E8.1 command capture engine (line mirror + persisted
  history store), keyboard.js capture hook, main.js wiring, and command-history spec.
  Full suite green on `retries:1` (545 passed / 0 failed). Status → review.
