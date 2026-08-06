---
title: 'Command history escape hatches — chord toggle + verbatim arrow passthrough'
type: 'feature'
created: '2026-08-06'
status: 'done'
baseline_commit: '50f0ecca405367d34d9d3533fdffe795fc339934'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The ↑/↓ recall overlay fights full-screen programs on the MicroBeast — BIOS startup menus, editors — that want the arrow keys for themselves. The only escape today is a mid-session trip to Settings ▸ Command history, which is exactly the hatch `EXPERIENCE.md:324` describes.

**Approach:** Bind a chord that flips the same persisted `commandHistoryEnabled` pref the menu checkbox drives, confirmed by a brief toast. Separately, pin and document the per-keypress bypass that already works by accident: Ctrl+Shift+↑/↓ already reach the Z80 verbatim, undocumented and untested.

Two adjacent drifts, surfaced during planning and folded in at the human's request (2026-08-06): the unregistered `Ctrl+Shift+Esc` handler, and the stale `www/` inventory docs. Both are the same class of problem this change is already fixing — a chord or a module the written record doesn't know about.

## Boundaries & Constraints

**Always:**
- One notion of "active": both chords flip `commandHistoryEnabled` via `savePrefs()`. No parallel session-only state. `savePrefs` does not fan out, so the handler shows the toast itself; the Settings checkbox re-projects on next menu open.
- Chords are registered in `www/input/shortcuts.js` (predicate + `SHORTCUT_GROUPS` row), never inline in a handler. That registry is the sole source for the Help ▸ Keyboard Shortcuts modal and exists to stop precisely this drift (`shortcuts.js:4-12`).
- JS shell only. No `crates/` change — `Insert` is intercepted, never transmitted.
- Toast follows `renderer/paste-toast.js` conventions: `[hidden]` attribute for show/hide, `--chrome-*` tokens only (AD-9 — no `[data-theme]` branch, no shadow), `role="status" aria-live="polite" aria-atomic="true"` with `aria-label` rewritten alongside `textContent`, `retainFocus` (AD-10), one `wireXxx(opts)` call from main.js (AD-1).

**Ask First:**
- If Ctrl+Shift+↑ does NOT already emit `1B 41` with history enabled and non-empty. That premise is load-bearing; if it fails, this is a fix, not a pin, and the scope changes.
- If either chord proves to be swallowed by Chromium or the desktop environment before the page sees it.
- If moving `Ctrl+Shift+Esc` into the registry would change its behaviour in any way. The predicate must reproduce the inline guard exactly; this is a relocation, not a redesign.

**Never:**
- Do not change what bare ↑/↓ do at an empty prompt with history on.
- Do not add logic to the overlay's open-branch handler. `renderer/command-history.js:204` already swallows every Ctrl/Alt/Meta chord while open, which IS the required "ignored while open" behaviour.
- No status-bar readout.
- No new wasm `KeyCode` tag.
- Do not rewrite the inventory docs. Add the missing rows in the existing format and extend the lines this change makes wrong — nothing else.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Toggle off | history on; `Ctrl+Shift+Insert` | pref → false; toast "Command history off"; zero bytes on the wire | n/a |
| Toggle on | history off; `Ctrl+Alt+H` | pref → true; toast "Command history on"; zero bytes | n/a |
| Arrow bypass | history on, line empty, history non-empty; `Ctrl+Shift+↑` | `1B 41` on the wire; overlay stays closed and hidden | n/a |
| Any chord while overlay open | overlay open; either chord, or `Ctrl+Shift+↑` | swallowed by the open branch; no toggle, no toast, no bytes | n/a |
| Menu tells the truth | chord flipped it off; open Settings | checkbox renders unchecked | n/a |
| Rapid re-toggle | 3 chords inside the hide window | latest state only; timer cleared then re-armed, no stacking | n/a |
| Chord mid-SLIDE | transfer running; `Ctrl+Shift+Insert` | pref flips + toast; capture stays suspended by its own `isTransferRunning()` gate | n/a |
| Bare Insert | `Insert` with no modifiers | unchanged — silent drop, no `preventDefault` (`keyboard.js:155`) | n/a |
| Clear selection, post-move | an established selection; `Ctrl+Shift+Esc` | unchanged — selection cleared, no `0x1B` to the remote; bare Esc still reaches VT52 workloads | n/a |

</frozen-after-approval>

## Code Map

Line numbers below are pre-change (captured during planning) and shifted once the edits landed — treat them as "roughly here", not as citations.

- `www/input/shortcuts.js` — chord registry. Predicates at :26-37, groups at :43-63.
- `www/input/keyboard.js` — wrapper keydown handler. Add the intercept beside `matchCopy`/`matchPaste` (:281-293), before `packKeyCode` (:316). `Insert` silent-drops at :155. The unregistered `Ctrl+Shift+Esc` guard is at :234.
- `docs/component-inventory-www.md` — `renderer/` table :12-24, `input/` table :37-47. `docs/architecture-www.md` — `chrome.js` :42, `keyboard.js` :57. Both generated 2026-07-01 and not maintained since.
- `www/input/command-history.js` — capture engine; already owns its own prefs writes (`clear`, `trimToCap`). Gains `toggleEnabled()`.
- `www/renderer/command-history.js` — overlay. `:173` is the passthrough being pinned, `:204` the open-branch swallow. **No edits.**
- `www/renderer/paste-toast.js` — DOM/aria/timer pattern to copy; `www/renderer/confirm-toggle.js` — its 54-line factory ergonomics.
- `www/main.js` — imports ~:180, element consts ~:425, wire toast at :995, inject into `wireKeyboard` :1008-1015.
- `www/index.html` — toast markup beside `#paste-toast` (:2171-2177), CSS beside :385-422.
- `www/tests/render/shortcuts-registry.spec.js` — hard gate: a new `match` row fails the suite until `PROBES` (:22-34) and the `checked` list (:66-68) both include it.
- `www/tests/render/command-history-overlay.spec.js` — the `E8.2 AC-2 — trigger is inert otherwise` block at :109 is where the arrow pin belongs; reuse its `ready`/`seed`/`ostate`/`hex`/`hidden`/`resetTx` helpers rather than writing new ones.

## Tasks & Acceptance

**Execution:**
- [x] `www/input/shortcuts.js` -- add `matchCommandHistoryToggle` matching `Ctrl+Shift+Insert` OR `Ctrl+Alt+H`, plus a `Command history` group holding that mechanical row and an informational row (no `match`) for `Ctrl+Shift+↑/↓` -- one predicate for two chords mirrors the zoom predicates' `Equal || NumpadAdd`; the bypass has no handler to point at, which is what informational rows are for.
- [x] `www/input/shortcuts.js` + `www/input/keyboard.js` -- add `matchClearSelection` = `e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'Escape'` with an `Editing`-group row, and replace the inline guard at `keyboard.js:234` with the predicate -- byte-identical guard, relocation only; keep the existing comment block explaining why bare Esc is preserved.
- [x] `www/input/command-history.js` -- add `toggleEnabled()`: read `getPrefs()` fresh, `savePrefs({ commandHistoryEnabled: !current })`, return the new boolean -- keeps the pref mutation with the module that owns the feature's other prefs writes; still never calls `pushTxBytes` (:10-12).
- [x] `www/renderer/toast.js` -- NEW. `wireToast({ toastEl, toastTextEl })` → `{ show(text), hide, __getStateForTests, __resetForTests }`; ~2 s auto-hide, timer cleared then re-armed on every `show` -- there is no generic toast today and paste-toast is paste-specific.
- [x] `www/index.html` -- toast markup + CSS -- bottom-centre, distinct from `#paste-toast` (centre) and `#slide-chip` (top-right).
- [x] `www/main.js` -- import, element consts, `wireToast` at :995, `window.__toast` test hook, inject `toggleCommandHistory` + toast into `wireKeyboard` -- :995 sits after the engine (:756) and before `wireKeyboard` (:1008), satisfying both ordering constraints.
- [x] `www/input/keyboard.js` -- intercept `matchCommandHistoryToggle` after the paste branch: `preventDefault()`, toggle, toast, `return` -- null-guard the injected deps, matching how `captureHistory` is optional.
- [x] `www/tests/render/command-history-overlay.spec.js` -- pin the arrow bypass and the overlay-open swallow -- seed non-empty history first or the test passes for the wrong reason (empty-history gate).
- [x] `www/tests/render/command-history.spec.js` -- cover `toggleEnabled()` round-trip and persistence.
- [x] `www/tests/render/shortcuts-registry.spec.js` + `keyboard-shortcuts-modal.spec.js` -- add hit/miss probes for BOTH new predicates (`matchCommandHistoryToggle`, `matchClearSelection`) and update the expected label sets -- the registry spec hard-fails on any `match` row lacking a probe, and both specs assert exact sets.
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md` -- key-map rows (~:251), Settings-row shortcut hint (:64), Flow-6 escape-hatch prose (:324), Help-modal contents row (:85) -- the prose currently says the menu is the only way out.
- [x] `docs/architecture-www.md` (:57) + `docs/component-inventory-www.md` (:41) -- extend the `keyboard.js` chord lists with both new chords and `Ctrl+Shift+Esc`.
- [x] `docs/component-inventory-www.md` + `docs/architecture-www.md` -- diff the `www/` tree against the `renderer/`, `input/` and `state/` tables and add a row per missing module in the existing format -- known gaps: `input/shortcuts.js`, `input/command-history.js`, `renderer/command-history.js`, `renderer/confirm-toggle.js`, `renderer/pull-pane.js`, `renderer/csum.js`, the new `renderer/toast.js`, and several font tables. Add rows; do not restructure or re-date the documents.

**Acceptance Criteria:**
- Given the Help ▸ Keyboard Shortcuts modal, when opened, then a "Command history" group lists both the toggle chord and the ↑/↓ bypass — with no hand-written HTML, because the modal renders from `SHORTCUT_GROUPS`.
- Given history was toggled off by chord, when the page is reloaded, then it is still off.
- Given `cd www && npm test`, when run, then every spec passes, including the updated registry and modal label assertions.
- Given `cargo test`, when run, then it passes unchanged — this story adds no Rust.
- Given the finished inventory docs, when every module under `www/renderer/`, `www/input/` and `www/state/` is checked against them, then each one has a row.

## Spec Change Log

## Design Notes

**Why `keyboard.js` and not `chrome.js`.** Ctrl+Alt+T lives in `chrome.js` because theme is DOM chrome, and AD-13 pins that listener's boot slot. This toggle is an input-path concern whose engine is constructed at `main.js:756` — after `wireChrome` (:476). Hosting it in `keyboard.js` (wired :1008) lets the dependency be injected directly, exactly as `captureHistory` already is, with no TDZ thunk of the kind `wireMenuBar` needs at :536-538. The copy/paste chords already live there, so this is precedent, not a new pattern, and AD-13 needs no amendment.

**The arrow bypass is emergent, not written.** `renderer/command-history.js:173` bails on any modifier without `preventDefault`, and `key.rs:93` matches `(ArrowUp, _)` so modifiers never reach the bytes. Three independent "be inert" decisions happen to agree. That is exactly why it needs a test: nothing today would fail if someone tightened that guard.

## Verification

**Commands:**
- `cd www && npm test` -- expected: all Playwright chromium specs pass.
- `cd www && npx playwright test tests/render/command-history-overlay.spec.js tests/render/shortcuts-registry.spec.js tests/render/keyboard-shortcuts-modal.spec.js` -- expected: pass.
- `cargo test` -- expected: pass, unchanged.
- `cargo clippy` -- expected: clean. NOTE: `cargo fmt --check` already fails on this baseline (`lib.rs`, `slide/framer.rs`, `slide/state.rs` — deliberately aligned constants). Pre-existing and out of scope; this change touches no Rust, so the failure list must be identical before and after.

**Manual checks:**
- Real hardware, BIOS menu up: Ctrl+Shift+Insert → toast "Command history off", then ↑/↓ drive the menu. Ctrl+Alt+H → back on.
- History on, empty prompt: Ctrl+Shift+↑ moves the Z80 cursor, no overlay appears.
- Confirm neither Chromium (Ctrl+Shift+Insert is an X11 paste alias) nor the desktop environment (Ctrl+Alt+H) eats the chord before the page sees it — the one real collision risk. **Done 2026-08-06: Ant exercised both chords, the toast, and the Help modal on real hardware. Nothing was intercepted.**

## Suggested Review Order

**What the chord is, and what it changes**

- Both chords in one predicate; the comment block is where the keyboard realities live.
  [`shortcuts.js:60`](../../www/input/shortcuts.js#L60)

- The intercept. Note `preventDefault` before the deps, and the auto-repeat drop after it.
  [`keyboard.js:337`](../../www/input/keyboard.js#L337)

- The pref flip itself — one notion of "on", shared with the Settings checkbox.
  [`command-history.js:213`](../../www/input/command-history.js#L213)

- The registry row, which is also the Help modal row. No hand-written HTML.
  [`shortcuts.js:84`](../../www/input/shortcuts.js#L84)

**Telling the operator it happened**

- Clear-then-re-arm is the whole story; `savePrefs` fires no subscribers, so this is the only feedback.
  [`toast.js:81`](../../www/renderer/toast.js#L81)

- Wired between the engine and the keyboard, and injected rather than imported.
  [`main.js:1015`](../../www/main.js#L1015)

**The bypass that already worked**

- Unchanged code. This single line is why Ctrl+Shift+↑ always reached the Z80.
  [`command-history.js:173`](../../www/renderer/command-history.js#L173)

- The pin, with history seeded so only the modifier keeps the overlay shut.
  [`command-history-overlay.spec.js:154`](../../www/tests/render/command-history-overlay.spec.js#L154)

**Relocating Ctrl+Shift+Esc**

- Same five conditions, reordered; the move is what puts it in the Help modal.
  [`keyboard.js:256`](../../www/input/keyboard.js#L256)

**Tests worth reading rather than skimming**

- Seven repeats, not eight — an even count passes with or without the guard.
  [`command-history.spec.js:367`](../../www/tests/render/command-history.spec.js#L367)

- The only assertion that discriminates re-arm from stacking, and the only one reading the DOM.
  [`command-history.spec.js:395`](../../www/tests/render/command-history.spec.js#L395)

- Array probes so both chord arms are proven; `Ctrl+Shift+H` is the near-miss.
  [`shortcuts-registry.spec.js:38`](../../www/tests/render/shortcuts-registry.spec.js#L38)
