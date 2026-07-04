---
baseline_commit: 6d13c3e1bade260c91dbcb5518571cd20ac1e9c7
---

# Story E0.1: Focus-retention helper (`retainFocus`)

Status: Done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a keyboard-first MicroBeast operator,
I want every chrome control to hand keyboard focus straight back to the terminal,
so that my keystrokes keep flowing to the Z80 even after I click a menu or change a setting.

**Covers:** NFR-1 (focus-retention primitive) · AD-10 (shared `retainFocus` helper).
**Epic:** E0 — Shared UI Primitives (enabler epic; depends on nothing). First story in the epic.

## Acceptance Criteria

**AC-1 — Helper module + button branch**
**Given** a new `www/renderer/focus.js` module exposing `retainFocus(el, restoreTarget?)` (named export, no default)
**When** `el` is a button (or button-like: `<button>`, checkbox/radio `<input>`, or any element that takes focus on click)
**Then** a `mousedown → preventDefault` listener is attached so the element never takes focus, while its own `click`/`change` handler still fires (mousedown and click are separate events; keyboard activation is unaffected because mousedown does not fire on Tab+Space/Enter).

**AC-2 — `<select>` branch**
**Given** `retainFocus(el, restoreTarget)` where `el` is a `<select>`
**When** the user changes the selection
**Then** focus is restored to `restoreTarget` (the terminal wrapper) on the select's `change` event — the `<select>` is NOT given `mousedown → preventDefault` (it needs native focus transfer to open its native picker).

**AC-3 — Proof against one existing site (no behavior change)**
**Given** one existing inline focus-retention site (per AD-10, ~18 exist today — recommended proof site: the `themeButton` `mousedown` handler in `renderer/chrome.js:147-149`, which is directly covered by `www/tests/input/focus-retention.spec.js`)
**When** it is refactored to call `retainFocus(...)` instead of its hand-written listener
**Then** its behavior is byte-identical to before — verified green by the existing `focus-retention.spec.js` suite with no test edits.

**AC-4 — Test hooks + wiring**
**Given** the module follows the `wireXxx`/component test-hook convention (AD-2)
**When** it is loaded
**Then** it exposes `__getStateForTests` (and `__resetForTests` for test isolation), is imported into `www/main.js`, and is surfaced as `window.__focus` for the Playwright chromium suite.

**Cross-cutting (applies to every chrome story; stated once):** uses only `var(--chrome-*)` tokens where styling is involved (N/A here — no markup/CSS), retains terminal focus on every control (the whole point of this story), no new dependencies / no build step, exposes `window.__xxx` + `__getStateForTests`.

## Tasks / Subtasks

- [x] **Task 1 — Create `www/renderer/focus.js`** (AC: 1, 2, 4)
  - [x] Named export `export function retainFocus(el, restoreTarget)` — no default export.
  - [x] Branch on element type: if `el.tagName === 'SELECT'` → attach `change` listener that calls `restoreTarget.focus()` (null-guard `restoreTarget`); else → attach `mousedown` listener that calls `e.preventDefault()`.
  - [x] Keep a module-scope registry of wired elements (e.g. an array or `Set`) so `__getStateForTests` can report what was retained.
  - [x] Export `__getStateForTests()` returning a snapshot (e.g. `{ retainedCount, elements }` — mirror the `slide-chip.js` shape: return copies, never live refs) and `__resetForTests()` clearing the registry.
  - [x] Zero imports — `focus.js` is a leaf helper. `restoreTarget` is passed in by the caller (AD-3 forbids importing the terminal wrapper into chrome modules).
- [x] **Task 2 — Wire into `main.js`** (AC: 4)
  - [x] `import { retainFocus, __getStateForTests as __focusGetStateForTests, __resetForTests as __focusResetForTests } from './renderer/focus.js';` (follow the aliased-import pattern already used for `slide-chip`/`file-source` at `main.js:87-127`).
  - [x] Expose `window.__focus = { __getStateForTests: __focusGetStateForTests, __resetForTests: __focusResetForTests };` alongside the other `window.__*` introspection exposures.
- [x] **Task 3 — Refactor the proof site** (AC: 3)
  - [x] In `renderer/chrome.js`, replace the hand-written `themeButton.addEventListener('mousedown', (e) => e.preventDefault());` (line 147-149) with `retainFocus(themeButton);` (import `retainFocus` from `./focus.js`).
  - [x] Preserve the surrounding `click` handler and comments verbatim — only the mousedown-preventDefault listener is relocated into the helper.
  - [x] Do NOT touch the other ~17 inline sites in this story (they migrate as their owning modules are rebuilt in E1–E7).
- [x] **Task 4 — Add unit spec** (AC: 1, 2)
  - [x] New `www/tests/input/focus-helper.spec.js` (chromium project) asserting: (a) a button wired via `retainFocus` does not steal focus on mouse click but still fires its click handler; (b) a `<select>` wired via `retainFocus` restores focus to the passed target on `change`; (c) `window.__focus.__getStateForTests()` reflects wired elements.
  - [x] Follow the existing `focus-retention.spec.js` structure (goto `/`, focus `#terminal-wrapper`, assert `toBeFocused`).
- [x] **Task 5 — Verify no regression**
  - [x] Run the full Playwright chromium suite; `focus-retention.spec.js` (all 5 tests) must stay green with zero edits.

## Dev Notes

### What this story is (and isn't)
Pure **relocation of an existing behavior into a reusable helper** — the enabler for every later epic that adds chrome controls. It creates ONE new leaf module (`renderer/focus.js`), wires it into `main.js`, and proves it by refactoring exactly ONE existing site. It does **not** migrate all ~18 sites, add markup, add CSS, or change any user-visible behavior. This is a brownfield app; there is no scaffold/init step.

### The two existing patterns the helper factors out (read these before coding)
Both branches already exist inline in the codebase — the helper must reproduce them exactly:

1. **Button branch — `mousedown → preventDefault`** (the dominant pattern, ~40 call sites). Canonical example `renderer/chrome.js:147-149` (themeButton), with the definitive explanatory comment at `chrome.js:141-149`:
   > mousedown fires BEFORE focus move; preventDefault at this phase blocks it entirely. Click handler still fires (click and mousedown are separate events). Keyboard activation (Tab + Space) is unaffected because mousedown does not fire on keyboard activation.
   Other identical sites for reference: `scroll-state.js:55-58`, `slide-chip.js:99,303`, `serial.js:244`, `session-log.js:37`, `file-source.js:109,144-158`, `main.js:867,882,909,963,972`.

2. **`<select>` branch — restore focus on `change`** (a `<select>` cannot use mousedown-preventDefault because it needs the native focus transfer to open its picker). Canonical example `renderer/chrome.js:297-305` (fontSelect), with the definitive comment at `chrome.js:300-304`:
   > `<select>` needs the native focus transfer to open its picker, so we cannot use the mousedown-preventDefault pattern that buttons and radios use; restore focus on change instead.

The helper's job is to pick the right branch by element type so callers stop hand-writing either one. Note checkboxes/radios use the **button** branch (see `main.js:867` local-echo, `main.js:882` CR/LF radios, `chrome.js:318,333` checkboxes) — only true `<select>` elements use the change-restore branch.

### Architecture constraints (hard — from ARCHITECTURE-SPINE.md)
- **AD-10** governs this story: `retainFocus(el, restoreTarget?)` branches on element type; button → `mousedown → preventDefault`; `<select>` → focus-restore-to-`restoreTarget` on `change`. `restoreTarget` = terminal wrapper, **passed by the caller** (AD-3 blocks importing it). The behavior is mandatory on every control. `[Source: ARCHITECTURE-SPINE.md#AD-10]`
- **AD-3 — Direct-import allowlist:** a chrome module may import **only** `renderer/canvas.js` setters and `state/prefs.js` directly; everything else arrives via opts. `focus.js` itself imports **nothing** (leaf helper), so it's compliant by construction, and it must not reach for `#terminal-wrapper` — callers pass it. `[Source: ARCHITECTURE-SPINE.md#AD-3]`
- **AD-1 — no build step, named exports only, native ESM.** Plain `.js` under `renderer/`, no default export. `[Source: ARCHITECTURE-SPINE.md#AD-1]`
- **AD-2 — component/test-hook shape.** Expose `window.__xxx` + `__getStateForTests` (+ `__resetForTests`) so the Playwright chromium suite can drive it. `focus.js` is a helper (like `modal.js`), not a full `wireXxx` component, so it has no `wireXxx(opts)` initializer — but it still carries the test hooks. `[Source: ARCHITECTURE-SPINE.md#AD-2, Consistency Conventions]`
- **Structural seed** already lists `renderer/focus.js  # NEW — retainFocus(el, restoreTarget?) helper (AD-10)`. `[Source: ARCHITECTURE-SPINE.md#Structural Seed]`

### Test-hook shape to mirror
Model `__getStateForTests`/`__resetForTests` on `renderer/slide-chip.js:508-545` — return **copies** (`array.slice()`, spread objects), never live module refs. In `main.js`, mirror the aliased-import + `window.__namespace = { __resetForTests, __getStateForTests }` pattern used for `window.__slideChip` (`main.js:126-127, 808-810`) and `window.__fileSource` (`main.js:102-103, 796-798`).

### Project structure notes
- New file: `www/renderer/focus.js` (matches the seed path exactly).
- New test: `www/tests/input/focus-helper.spec.js` (chromium project — `focus-retention.spec.js` already lives under `tests/input/`).
- Edits: `www/main.js` (import + `window.__focus` exposure) and `www/renderer/chrome.js` (one-line proof refactor at line 147-149).
- No `index.html` / CSS changes — this story ships no markup and no tokens.

### Regression guardrails (what must NOT break)
- `www/tests/input/focus-retention.spec.js` — all 5 tests must stay green with **no edits**. The `#theme-toggle` test (lines 5-14) directly exercises the proof-site refactor; it is your correctness oracle.
- Keyboard activation of the theme button (Tab + Space / Enter) must still toggle the theme — `mousedown` never fires on keyboard activation, so the helper must attach `mousedown` (not `pointerdown`/`focus`) exactly as the original did.
- The theme button's `click` handler (`chrome.js:135-140`, which calls `toggleTheme` + `savePrefs`) is untouched — `retainFocus` only owns the mousedown-suppression, never the action.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story E0.1] — user story + acceptance criteria.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md#AD-10] — resolved-fork decision for the shared helper.
- [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-2, #AD-3, #Consistency Conventions, #Structural Seed]
- [Source: www/renderer/chrome.js:141-149] — button-branch reference + comment.
- [Source: www/renderer/chrome.js:297-305] — `<select>`-branch reference + comment.
- [Source: www/renderer/slide-chip.js:508-545] — `__getStateForTests`/`__resetForTests` shape to mirror.
- [Source: www/main.js:87-127, 796-810] — aliased-import + `window.__namespace` exposure pattern.
- [Source: www/tests/input/focus-retention.spec.js] — the regression oracle.
- Epic/NFR context: NFR-1 (focus retention mandatory on every interactive chrome control), UX-DR9 ("Sacred" — Phase 4 D-16).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow)

### Debug Log References

- Full Playwright chromium suite is flaky under multi-worker parallelism (wasm-boot
  starvation) and under serial order-dependence: across runs the failing test varied
  (bell, auto-connect, slide-bridge, keydown-printable, slide-post-fin-forward) — all
  transport/render/keydown timing tests, never focus. Confirmed pre-existing: on a
  clean baseline (my changes stashed) the full serial suite fails identically at
  `tests/transport/slide-post-fin-forward.spec.js:47` (323 passed / 1 failed / 1 skipped),
  matching my tree (326 passed / 1 failed / 1 skipped — the +3 are the new focus tests).
- The new `focus-helper.spec.js` "test hook reflects wired elements" test was initially
  order-dependent: reading `window.__focus` immediately after `page.goto('/')` raced the
  module boot. Fixed with an in-page `page.waitForFunction` guard (tolerates
  `window.__focus` not yet existing) rather than a cross-boundary `expect.poll`. Now
  green 3/3 at `--workers=1`.
- Regression oracle `tests/input/focus-retention.spec.js` (all 5 tests, incl. the
  `#theme-toggle` proof-site test) stays green with zero edits.

### Completion Notes List

- Created `www/renderer/focus.js` — the shared `retainFocus(el, restoreTarget?)` leaf
  helper (AD-10). Zero imports (AD-3 compliant); branches on element type: `<select>` →
  restore focus to `restoreTarget` on `change`; everything else → `mousedown → preventDefault`.
  Carries `__getStateForTests` / `__resetForTests` (AD-2) returning copies, never live refs.
- Wired the test hooks into `www/main.js` as `window.__focus` using the aliased-import +
  `window.__namespace` pattern already used for `slide-chip` / `file-source`. `retainFocus`
  itself is imported by chrome modules directly (not via `main.js`), per AD-3.
- Refactored the ONE proof site (`chrome.js` `themeButton` mousedown handler) to call
  `retainFocus(themeButton)`. The `click` handler and the explanatory D-16 comment are
  preserved verbatim; only the mousedown-preventDefault listener was relocated. The other
  ~17 inline sites were intentionally left untouched (they migrate with their owning modules
  in E1–E7).
- Added `www/tests/input/focus-helper.spec.js` (chromium project) covering AC-1 (button
  branch keeps wrapper focused + still fires click), AC-2 (`<select>` restores focus on
  change), and AC-4 (`window.__focus.__getStateForTests()` reflects wired elements). Uses
  real (trusted) Playwright input so native focus-on-mousedown is genuinely exercised.
- No markup / CSS / dependency / build-step changes (cross-cutting reqs N/A here).

### File List

- `www/renderer/focus.js` (new) — shared `retainFocus` helper + test hooks.
- `www/main.js` (modified) — aliased import of focus test hooks + `window.__focus` exposure.
- `www/renderer/chrome.js` (modified) — import `retainFocus`; proof-site refactor of the
  `themeButton` mousedown handler.
- `www/tests/input/focus-helper.spec.js` (new) — unit spec for both branches + test hook.

## Change Log

- 2026-07-01 — Implemented E0.1: added `renderer/focus.js` (`retainFocus` helper + test
  hooks), wired `window.__focus` in `main.js`, refactored the `themeButton` proof site in
  `chrome.js`, and added `tests/input/focus-helper.spec.js`. Full regression suite green
  except one pre-existing, change-independent flake (`slide-post-fin-forward.spec.js:47`,
  reproduced identically on baseline). Status → review.
- 2026-07-01 — Code-review follow-up (high-effort `/code-review`). Two helper-hardening
  fixes to `focus.js`: (1) the `<select>` branch now **throws `TypeError`** when
  `restoreTarget` is omitted instead of silently dropping focus retention (was `if
  (restoreTarget) restoreTarget.focus()` — a silent NFR-1 "Sacred" regression waiting for
  the first arg-less `<select>` caller); (2) added a module-scope `WeakSet` idempotency
  guard so a repeat `retainFocus(el)` is a no-op instead of stacking duplicate listeners /
  double-counting in the registry.
- 2026-07-01 — **Scope deviation from Task 3 (approved by user).** The code-review
  "incomplete refactor" finding prompted migrating the remaining 7 hand-written
  focus-retention sites in `chrome.js` (`clearButton`, phosphor radio group,
  `clearScrollbackButton`, `fontSelect` via the `<select>` branch, `autoConnectCheckbox`,
  `showAllSerialCheckbox`, `resetPrefsButton`) to `retainFocus`. Task 3 originally scoped
  this to the ONE `themeButton` proof site, deferring the rest to E1–E7 as their owning
  modules are rebuilt. Migrating all of `chrome.js` now front-runs part of that E1–E7
  work but leaves zero inline focus-retention sites in the module. Sites in OTHER modules
  (`scroll-state.js`, `slide-chip.js`, `serial.js`, `session-log.js`, `file-source.js`,
  `main.js`) remain inline and still migrate with their owning modules. Verified green:
  all 8 focus specs (`focus-helper.spec.js` + `focus-retention.spec.js`) + 77 non-transport
  `@fast` tests; transport-spec failures under parallel load are pre-existing flakes (the
  failing set varies run-to-run and all pass in isolation). Status → Done.
