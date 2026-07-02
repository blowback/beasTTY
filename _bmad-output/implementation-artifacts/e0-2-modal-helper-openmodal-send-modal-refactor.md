---
baseline_commit: a32e6d1c2dcead44ef63a9d4a0d474672f74bf01
---

# Story E0.2: Modal helper (`openModal`) + Send-modal refactor

Status: Done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want every dialog to open, close, trap focus, and restore focus the same way,
so that configuration modals feel consistent and never leave focus stranded off the terminal.

**Covers:** `openModal` primitive (AD-8) · FR-16 (Send-modal refactor proof case) · UX-DR13.
**Epic:** E0 — Shared UI Primitives (enabler epic; depends on nothing). Second and final story in the epic; follows E0.1 (`retainFocus`), which is Done.

## Acceptance Criteria

**AC-1 — Helper module + pinned contract**
**Given** a new `www/renderer/modal.js` module exposing `openModal(dialogEl, { initialFocus, restoreTo }) → Promise<returnValue>` (named export, no default)
**When** `openModal` is called with a `<dialog>` element
**Then** it opens the dialog via `dialogEl.showModal()` (top layer, native `::backdrop`, native focus trap — **do not** hand-roll a focus-trap loop; `showModal()` already traps), sets `data-focused="true"` on the `initialFocus` element **before** calling `initialFocus.focus()` (the attribute drives the visible focus border; Chromium suppresses `:focus-visible` after a programmatic focus that follows a pointer-initiated path — see Dev Notes), and returns a Promise.

**AC-2 — Close resolves to raw returnValue + focus restore**
**Given** an open modal wired by `openModal`
**When** the dialog closes (any path: `close(tag)`, backdrop click that calls `close(...)`, or Esc)
**Then** the Promise resolves to the **raw** `dialogEl.returnValue` string (the caller maps `'' → null`, not the helper), the `data-focused` attribute set in AC-1 is cleared (set to `"false"`) on the `initialFocus` element, and focus moves to the `restoreTo` target (null-guarded — `restoreTo?.focus?.()`). The `close` listener is one-shot (removed after firing).

**AC-3 — `restoreTo` expresses the conditional restore without per-caller reinvention**
**Given** `restoreTo` may be either an `Element` **or** a callback `(returnValue) => Element | null`
**When** the dialog closes
**Then** if `restoreTo` is a function it is called with the raw `returnValue` and its result is focused; if it is an element that element is focused; if it is nullish, no restore occurs. This is the mechanism that lets `file-source.js` restore to the terminal wrapper on `send`/`first-only` and to the trigger button otherwise (AD-8), with the branch logic living in the caller.

**AC-4 — Send-modal refactored onto `openModal`, behavior byte-identical**
**Given** the existing `#send-modal` flow in `www/input/file-source.js` (`showConfirmModal`)
**When** it is refactored to drive open/close/focus through `openModal`
**Then** every existing behavior is preserved exactly:
- Default focus target: collision-present → `#send-modal-send-renamed`; no-collision → `#send-modal-send` (passed as `initialFocus`).
- Focus restore: `returnValue === 'send' || returnValue === 'first-only'` → `#terminal-wrapper`; else (`'cancel'`, `'refuse'`, `''`) → the top-bar Send-file trigger button (passed as the `restoreTo` callback).
- The resolved action still drives `processFiles`: `'send'` → `applyCollisionRenames`, `'first-only'` → `applyFirstOnlyFilter`, `'cancel'`/`'refuse'`/`''`/null → bail.
- Content-building (title text, `<li>` rows, all-rejected hint, footer button visibility/label/disabled toggles) **stays in `file-source.js`** — the helper owns only open/close/focus (AD-8: "Content-building stays in the caller").
- The cancel button, the three collision-action buttons, and the backdrop-click handler keep calling `dialogEl.close(tag)` directly (they are caller-owned close *triggers*, not helper concerns).

**AC-5 — Test hooks + wiring (AD-2 / NFR-6)**
**Given** the component/test-hook convention
**When** `modal.js` loads
**Then** it exposes `__getStateForTests` (and `__resetForTests` for isolation) returning **copies never live refs**, is imported into `www/main.js` (aliased), and is surfaced as `window.__modal` for the Playwright chromium suite. `openModal` itself is imported **directly** by `file-source.js` from `../renderer/modal.js` (leaf helper — the same pattern by which `chrome.js` imports `retainFocus` from `./focus.js`), **not** injected through `wireFileSource` opts.

**AC-6 — No regression (correctness oracles must stay green with no edits)**
**Given** the existing suite
**When** the refactor lands
**Then** these specs pass unchanged (they exercise exactly the open/close/focus behavior being relocated):
- `www/tests/render/modal-default-focus.spec.js` — both tests: (1) `[Send N renamed]` gets `data-focused="true"` on collision-mode open via the production file-input path; (2) closing via `[Refuse batch]` clears `data-focused` to `"false"`. **This is the primary oracle.**
- `www/tests/input/file-source.spec.js` — modal-open, rewrite/rejection rows, all-files-rejected Send-disabled, closed-state-not-visible.
- `www/tests/transport/slide-collisions.spec.js`, `www/tests/transport/slide-confirm-pref.spec.js` — collision three-action flow and the confirm-disabled skip-modal path.

**Cross-cutting (applies to every chrome story; stated once):** uses only `var(--chrome-*)` tokens where styling is involved (N/A here — this story ships **no markup and no CSS**; the `#send-modal` markup already exists), retains terminal focus (the restore-to-wrapper path is the whole point), no new dependencies / no build step, exposes `window.__xxx` + `__getStateForTests`.

## Tasks / Subtasks

- [x] **Task 1 — Create `www/renderer/modal.js`** (AC: 1, 2, 3, 5)
  - [x] Named export `export function openModal(dialogEl, { initialFocus, restoreTo } = {})` — no default export (AD-1).
  - [x] Return `new Promise((resolve) => { ... })`. Inside: register a one-shot `close` listener (`{ once: true }` or manual `removeEventListener` in the handler), then `dialogEl.showModal()`, then (if `initialFocus`) `initialFocus.setAttribute('data-focused','true')` **before** `initialFocus.focus()`.
  - [x] `close` handler: read `const rv = dialogEl.returnValue;` → clear `data-focused` on `initialFocus` (`initialFocus?.setAttribute('data-focused','false')`) → resolve restore target: `const target = typeof restoreTo === 'function' ? restoreTo(rv) : restoreTo;` → `target?.focus?.()` → `resolve(rv)`.
  - [x] Do **not** build a manual focus trap — `showModal()` traps focus natively. Do **not** add backdrop-click or Esc wiring here (native `<dialog>` + caller own those).
  - [x] Test hooks: `__getStateForTests()` returns a serialisable snapshot (e.g. `{ openCount, lastReturnValue, openDialogId }`, copies only) and `__resetForTests()` clears that module-scope state. Mirror the `focus.js` / `slide-chip.js` shape (return copies, never live DOM refs).
  - [x] Zero imports beyond nothing required — `modal.js` is a leaf helper (AD-3): it receives `dialogEl`/`initialFocus`/`restoreTo` from the caller and must never `getElementById('terminal-wrapper')` itself.
- [x] **Task 2 — Wire test hooks into `main.js`** (AC: 5)
  - [x] Aliased import mirroring the E0.1 focus block (`main.js:133-136`): `import { __getStateForTests as __modalGetStateForTests, __resetForTests as __modalResetForTests } from './renderer/modal.js';`
  - [x] Expose `window.__modal = { __resetForTests: __modalResetForTests, __getStateForTests: __modalGetStateForTests };` alongside `window.__focus` (`main.js:830-833`).
  - [x] Do **not** add `openModal` to the `wireFileSource({...})` opts — `file-source.js` imports it directly (see Task 3).
- [x] **Task 3 — Refactor `showConfirmModal` in `file-source.js` onto `openModal`** (AC: 4)
  - [x] Add `import { openModal } from '../renderer/modal.js';` at the top (join the existing `import { getPrefs } from '../state/prefs.js';`).
  - [x] Keep all content-building in `showConfirmModal` **unchanged** through the footer-toggle block (`file-source.js:436-521`) — title, list rows, collision rows, all-rejected hint, button visibility/label/disabled.
  - [x] Replace the `return new Promise((resolve) => { ... showModal(); ... })` block (`file-source.js:523-566`) with a single `return openModal(modalElRef, { initialFocus, restoreTo })` where:
    - `initialFocus = collisionsPresent ? (sendRenamedBtnRef || cancelBtnRef) : (sendBtnRef || cancelBtnRef)` (verbatim from `file-source.js:554-556`).
    - `restoreTo = (rv) => (rv === 'send' || rv === 'first-only') ? wrapperElRef : topBarSendBtnRef` (verbatim from the `file-source.js:540-544` conditional).
  - [x] `processFiles` already does `const action = await showConfirmModal(...)` then `if (!action || action === 'refuse') return;` (`file-source.js:377-378`). Since `openModal` resolves to the raw `returnValue` (`''` for Esc), the `!action` guard maps `'' → return` correctly — **preserve `showConfirmModal`'s external contract** (it must still resolve to the tagged string / falsy exactly as today). If you keep `showConfirmModal` returning `openModal`'s promise directly, confirm the empty-string case still bails.
  - [x] Leave the caller-owned close triggers in `wireFileSource` untouched: cancel/send/renamed/first-only/refuse button `.close(tag)` handlers (`file-source.js:129-159`), and the backdrop-click `.close('cancel')` (`file-source.js:162-168`).
  - [x] Re: the old three-button `data-focused="false"` clear in the deleted `onClose` (`file-source.js:529-534`) — `openModal` now clears `data-focused` only on the element it set (`initialFocus`). Verify this satisfies `modal-default-focus.spec.js` test 2 (it closes via `[Refuse batch]` and asserts `#send-modal-send-renamed` → `data-focused="false"`; in collision mode `initialFocus` **is** `#send-modal-send-renamed`, so it is cleared). The extra clears of `cancelBtnRef`/`sendBtnRef` were defensive and are not needed once the helper always clears exactly the element it focused — but **run the oracle to confirm** before removing them.
- [x] **Task 4 — Add unit spec `www/tests/render/modal.spec.js`** (AC: 1, 2, 3)
  - [x] chromium project. Use a throwaway `<dialog>` (append to `document.body` in the page) or drive the real `#send-modal`. Assert: (a) `openModal` sets `data-focused="true"` on `initialFocus` before focus; (b) on `close('X')` the promise resolves to `'X'` and `data-focused` becomes `"false"`; (c) `restoreTo` as a function is called with the returnValue and its returned element receives focus; (d) `restoreTo` as an element receives focus; (e) `window.__modal.__getStateForTests()` reflects an open/close.
  - [x] Follow the `focus-helper.spec.js` / `modal-default-focus.spec.js` structure (`page.goto('/')`, `#terminal-wrapper` focus, `waitForFunction` guard for `window.__modal` boot — see E0.1's boot-race lesson in Dev Notes).
- [x] **Task 5 — Verify no regression** (AC: 6)
  - [x] Run the chromium suite. `modal-default-focus.spec.js` (both tests), `file-source.spec.js`, `slide-collisions.spec.js`, `slide-confirm-pref.spec.js` must stay green with **zero edits**.
  - [x] Expect the pre-existing parallel-load flake (documented in E0.1 — reproduces on a clean baseline; the failing set varies run-to-run and all pass in isolation). Confirm your failing set matches baseline; it is change-independent.

## Dev Notes

### What this story is (and isn't)
Two moves: (1) **extract** the open/close/focus mechanics that today live inline in `file-source.js`'s `showConfirmModal` into a reusable leaf helper `renderer/modal.js`, and (2) **prove** it by refactoring the one existing `<dialog>` caller (`#send-modal`) onto it with **no behavior change** (AD-8, FR-16, Epic E0 premise: "pure relocation — every control keeps its exact v1.1 behavior"). It creates ONE new leaf module + ONE new spec, edits `main.js` (test-hook wiring) and `file-source.js` (the refactor). It ships **no markup and no CSS** — `#send-modal` and its styles already exist in `index.html`. It does **not** touch the SLIDE state machine, CP/M validation, collision logic, or any content-building. `#send-modal` is the **only** `<dialog>`/`showModal()` caller in the codebase today — the future Serial Config / SLIDE / Shortcuts / About modals (E2, E3, E6) will consume `openModal`, so getting the contract right here is load-bearing.

### The `openModal` contract — exact shape (AD-8, pinned)
`openModal(dialogEl, { initialFocus, restoreTo }) → Promise<returnValue>`
- **`dialogEl`** — the `<dialog>` element. Opened via `showModal()` (top layer + native `::backdrop` + native focus trap). The caller owns building its content and wiring its close triggers.
- **`initialFocus`** — element to focus on open. Helper sets `data-focused="true"` on it **before** `.focus()`, and clears it to `"false"` on close. The caller decides which element this is (it varies: collision → `[Send N renamed]`, else → `[Send N files]`).
- **`restoreTo`** — `Element | ((returnValue) => Element | null) | null`. On close the helper focuses the resolved target. The callback form is what makes `file-source.js`'s conditional restore expressible without the helper knowing about SLIDE actions.
- **Resolves to** the **raw** `dialogEl.returnValue` string (may be `''`). Mapping `'' → null` and switching on the tag is the **caller's** job (`processFiles` already does `!action` + `=== 'refuse'`).

Order of operations in the helper (match the current inline flow at `file-source.js:523-566`):
1. register one-shot `close` listener → 2. `showModal()` → 3. `data-focused="true"` on `initialFocus` → 4. `initialFocus.focus()`.
On close: read `returnValue` → clear `data-focused` on `initialFocus` → focus `restoreTo` target → resolve.

### Why `data-focused` (not `:focus-visible`) — do not "simplify" this away
Chromium suppresses `:focus-visible` after a **programmatic** `.focus()` that follows a **pointer-initiated** path (the file-picker dismissal fires `change` → `processFiles` → `showModal` → `.focus()`, all pointer-rooted). The visible focus border is painted by the `#send-modal footer button[data-focused="true"]` CSS rule (`index.html:747`), so the attribute **must** be set before `.focus()` and cleared on close. This exact gap was diagnosed in Phase 12 (`.planning/debug/12-uat-focus-ring-missing.md`) and is guarded by `modal-default-focus.spec.js`. `[data-focused]`-driven highlight is also the project-wide convention (UX-DR8, AD-2 Consistency table). `[Source: www/tests/render/modal-default-focus.spec.js; www/index.html:744-749]`

### Native `<dialog>.returnValue` gotcha (watch-out, not a mandated change)
`showModal()` does **not** reset `returnValue`; only `close(tag)` sets it. Esc runs the cancel algorithm and closes **without** changing `returnValue`, so `returnValue` can be **stale from the previous open**. Current send-modal behavior inherits this latent edge (Esc after a prior `send` could resolve stale `'send'`); it is **out of scope** here (pure relocation). If you choose to make `openModal` reset `dialogEl.returnValue = ''` before `showModal()` as a defensive default for the future modals, it is strictly safer and does **not** break the send-modal oracles (every send-modal button path sets an explicit `returnValue`, and no test exercises "Esc after prior send"). Decide deliberately; if in doubt, replicate today's behavior exactly (no reset) to honor the byte-identical premise, and note the deferral.

### What moves vs. what stays (the refactor boundary)
| Concern | Home after refactor |
| --- | --- |
| `showModal()` call, set/clear `data-focused` on `initialFocus`, `close`→resolve, focus restore | **`modal.js` (`openModal`)** |
| Title text, `<li>` row building (rewrite/unchanged/rejected/collision), all-rejected hint, footer button visibility/label/disabled | **`file-source.js` (unchanged)** |
| Deciding `initialFocus` (collision vs not) and the `restoreTo` branch (send/first-only → wrapper else trigger) | **`file-source.js`** (passed into `openModal`) |
| Cancel / Send / Send-renamed / First-only / Refuse `.close(tag)` handlers + backdrop-click `.close('cancel')` | **`file-source.js` `wireFileSource` (unchanged)** — caller-owned close triggers |
| Mapping `returnValue`/`'' → action`, `applyCollisionRenames`/`applyFirstOnlyFilter`, `enterSendMode` | **`file-source.js` `processFiles` (unchanged)** |

### Architecture constraints (hard — from ARCHITECTURE-SPINE.md)
- **AD-8** governs this story: one shared `openModal(dialogEl, {initialFocus, restoreTo}) → Promise<returnValue>`; all config modals are native `<dialog>` opened via `showModal()`, closed via `close(tag)`; resolves to the raw `returnValue` tag; `initialFocus` sets `data-focused` before `.focus()`; `restoreTo` names post-close focus (wrapper **or** trigger) so the send-modal conditional restore is expressible without per-caller reinvention; content-building stays in the caller; `send-modal` is refactored onto it. `[Source: ARCHITECTURE-SPINE.md#AD-8]`
- **AD-3 — Direct-import allowlist:** a chrome module may import only `renderer/canvas.js` setters and `state/prefs.js` directly; everything else via opts. `modal.js` imports **nothing** (leaf helper, compliant by construction) and must never reach for `#terminal-wrapper` — the caller passes `restoreTo`. `openModal` is itself directly importable by callers (the E0.1 precedent: `chrome.js` imports `retainFocus` from `./focus.js`; `file-source.js` will import `openModal` from `../renderer/modal.js`). `[Source: ARCHITECTURE-SPINE.md#AD-3; www/renderer/chrome.js:28]`
- **AD-1 — no build step, named exports only, native ESM.** Plain `.js` under `renderer/`, no default export. `[Source: ARCHITECTURE-SPINE.md#AD-1]`
- **AD-2 — component/test-hook shape.** Expose `window.__xxx` + `__getStateForTests` (+ `__resetForTests`). `modal.js` is a **helper** (like `focus.js`), not a full `wireXxx(opts)` component, so it has no initializer — but it carries the test hooks and is surfaced as `window.__modal` in `main.js`. `[Source: ARCHITECTURE-SPINE.md#AD-2, Consistency Conventions]`
- **Structural seed** already lists `renderer/modal.js  # NEW — openModal(el,{initialFocus,restoreTo}) helper (AD-8)` and `input/file-source.js  # send-modal refactored onto openModal helper (AD-8)`. `[Source: ARCHITECTURE-SPINE.md#Structural Seed]`

### Test-hook shape to mirror
Model `__getStateForTests`/`__resetForTests` on `www/renderer/focus.js` (E0.1) and `renderer/slide-chip.js:508-545` — return **copies** (spread/slice), never live module or DOM refs (they cross the Playwright `evaluate` boundary). In `main.js`, mirror the E0.1 aliased-import + `window.__modal = { __resetForTests, __getStateForTests }` pattern used for `window.__focus` (`main.js:133-136, 830-833`).

### Project structure notes
- New file: `www/renderer/modal.js` (matches the seed path exactly).
- New test: `www/tests/render/modal.spec.js` (chromium project — sibling of `modal-default-focus.spec.js`).
- Edits: `www/main.js` (aliased import + `window.__modal` exposure) and `www/input/file-source.js` (import `openModal`; replace the inline `new Promise(...showModal()...)` block).
- No `index.html` / CSS changes — `#send-modal` markup (`index.html:1116-1145`) and its styles (`index.html:655-810`) already exist and are untouched.

### Regression guardrails (what must NOT break)
- **`www/tests/render/modal-default-focus.spec.js` (both tests) — the primary correctness oracle.** Test 1: collision-mode open (via `setInputFiles('#send-file-input', [FILE_A, FILE_B])`) must paint `data-focused="true"` on `#send-modal-send-renamed` and border-color `rgb(51,255,102)`. Test 2: closing via `[Refuse batch]` must clear it to `"false"`. Your `openModal` set-before-focus and clear-on-close logic is exactly what these assert. **No test edits allowed.**
- `www/tests/input/file-source.spec.js` — modal opens on drop/picker, rows render, all-rejected disables Send, closed dialog not visible.
- `www/tests/transport/slide-collisions.spec.js` + `slide-confirm-pref.spec.js` — the three-action collision footer and the `slideConfirmTransfers=false` skip-modal path (which never calls `showConfirmModal`, so it must remain untouched by the refactor).
- The `#send-modal` returns focus to `#terminal-wrapper` on `send`/`first-only` and to `#send-file-button` (top-bar trigger, `topBarSendBtnRef`) otherwise — this conditional is the reason `restoreTo` accepts a callback (AC-3). Getting it wrong strands focus off the terminal (an NFR-1 "Sacred" violation).
- Keyboard vs pointer: the modal opens via a pointer-rooted path; the helper must not assume keyboard focus. Native `showModal()` trap + `data-focused` attribute cover both.

## Previous Story Intelligence (E0.1 — `retainFocus`, Done)

Directly reusable patterns and traps from the sibling helper story (same epic, same conventions):
- **Leaf-helper precedent established.** E0.1 shipped `renderer/focus.js` as a zero-import leaf helper with `__getStateForTests`/`__resetForTests` and no `wireXxx` initializer; `main.js` surfaces it as `window.__focus` (aliased import at `main.js:133-136`, exposure at `main.js:830-833`), and `chrome.js` imports `retainFocus` directly. **`modal.js` is the exact same shape** — copy the wiring pattern verbatim. `[Source: www/renderer/focus.js; www/main.js:133-136, 830-833]`
- **Test hooks return copies, never live refs** (E0.1 `__getStateForTests` returns `elements.map(r => ({...r}))`). Do the same for `window.__modal`.
- **Boot-race lesson (important for Task 4).** E0.1's test that read `window.__focus` immediately after `page.goto('/')` raced module boot. Fix: an in-page `page.waitForFunction(() => typeof window.__modal === 'object' && window.__modal !== null)` guard (as `modal-default-focus.spec.js`'s `setup()` already does for `window.__fileSource`) — **not** a cross-boundary `expect.poll`. `[Source: e0-1 Debug Log; www/tests/render/modal-default-focus.spec.js setup()]`
- **Fail-loud on missing required args** (E0.1 code-review hardening): the `<select>` branch throws `TypeError` when `restoreTarget` is omitted rather than silently dropping focus retention. Apply the same instinct here — a modal with no `initialFocus`/`restoreTo` should degrade sensibly (both are optional per the contract: no `initialFocus` → no focus set; no `restoreTo` → no restore), but never silently strand focus when a caller clearly intended a restore.
- **Idempotency guard** (E0.1 added a `WeakSet` so repeat `retainFocus(el)` is a no-op). `openModal` is invoked per-open (not per-element wiring), so a registry guard is not needed — but ensure the `close` listener is **one-shot** so repeated opens don't stack listeners (the current inline code removes the listener inside `onClose`; preserve that).
- **Suite flakiness is pre-existing and change-independent.** The full chromium suite is flaky under multi-worker parallelism (wasm-boot starvation); `slide-post-fin-forward.spec.js:47` fails identically on a clean baseline. Judge regressions by running the named oracles in isolation / `--workers=1`, not by a green full-suite run. `[Source: e0-1 Debug Log]`

## Git Intelligence

- **`a32e6d1`** (HEAD, baseline) "add shared retainFocus helper (E0.1) and migrate chrome.js focus retention" — the immediately-prior story; established the leaf-helper + `window.__*` wiring pattern this story reuses. E0.1 also migrated all of `chrome.js`'s inline focus sites (an approved scope deviation), so `chrome.js` now has zero inline focus-retention — do not expect to touch it here.
- **`6d13c3e`** "add build SHA to debug panel", **`86e5662`/`333b32d`** SLIDE cancel/recv fixes — SLIDE transport work adjacent to `file-source.js`'s `enterSendMode` handoff; none touch the modal open/close path. The `enterSendModeFn({ files })` handoff in `processFiles` is stable and out of scope.
- Commit convention: short imperative lowercase title, story tag in parens where relevant (e.g. "(E0.1)"). Follow it for the E0.2 commit.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story E0.2] — user story + acceptance criteria (the source ACs expanded above).
- [Source: ARCHITECTURE-SPINE.md#AD-8] — `openModal` contract (the governing decision).
- [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-2, #AD-3, #Consistency Conventions, #Structural Seed] — module shape, import allowlist, seed paths.
- [Source: www/input/file-source.js:432-567] — `showConfirmModal`: the exact inline open/close/focus block to extract (lines 523-566) and the content-building to keep (436-521).
- [Source: www/input/file-source.js:129-168] — caller-owned `.close(tag)` triggers (cancel/send/renamed/first-only/refuse + backdrop) that stay put.
- [Source: www/input/file-source.js:377-393] — `processFiles`' `await showConfirmModal(...)` + action switch (external contract to preserve).
- [Source: www/renderer/focus.js; www/main.js:133-136, 830-833] — E0.1 leaf-helper + `window.__*` wiring pattern to mirror.
- [Source: www/renderer/chrome.js:28] — direct-import precedent (`import { retainFocus } from './focus.js';`).
- [Source: www/index.html:1116-1145] — `#send-modal` markup (unchanged); [Source: www/index.html:744-749] — `[data-focused="true"]` focus-border CSS rule.
- [Source: www/tests/render/modal-default-focus.spec.js] — the primary regression oracle (Phase 12 focus-ring gap).
- [Source: www/tests/input/file-source.spec.js, www/tests/transport/slide-collisions.spec.js, www/tests/transport/slide-confirm-pref.spec.js] — supporting oracles.
- Epic/NFR context: FR-16 (Send-modal proof case), UX-DR13 (send-modal states/copy), NFR-1 / UX-DR9 (focus retention "Sacred"), NFR-6 (test hooks).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad Dev Story workflow)

### Debug Log References

- Baseline oracle `tests/render/modal-default-focus.spec.js` — 2 passed **before** any change (confirmed the primary oracle was green pre-refactor).
- Post-change targeted run (`modal.spec.js` + `modal-default-focus.spec.js`, `--workers=1`) — 7 passed.
- Post-change supporting oracles (`file-source.spec.js`, `slide-collisions.spec.js`, `slide-confirm-pref.spec.js`, `--workers=1`) — 22 passed.
- Full chromium suite (default parallel) — 323 passed / 1 skipped / **9 failed**. The 9 failures were scattered across unrelated subsystems (`ime-composition`, `scrollback`, `prefs`, `paste`, `slide-prefs`, and one `file-source` case) — the wasm-boot-starvation parallel flake documented in E0.1, not the modal path.
- Confirmation run of the 9 flaky specs at `--workers=1` — 60 passed / 1 skipped (intentional `test.skip`). All change-independent; judged per the story's "run named oracles in isolation" guidance.

### Completion Notes List

- **Two moves, no behavior change:** (1) extracted the inline open/close/focus mechanics from `file-source.js`'s `showConfirmModal` into a new zero-import leaf helper `www/renderer/modal.js` (`openModal`), and (2) refactored `#send-modal` — the only `<dialog>` in the codebase — onto it. Ships no markup and no CSS.
- **Contract (AD-8):** `openModal(dialogEl, { initialFocus, restoreTo }) → Promise<returnValue>`. Opens via `showModal()` (native top-layer + `::backdrop` + focus trap — no hand-rolled trap); sets `data-focused="true"` on `initialFocus` **before** `.focus()`; one-shot `close` listener (`{ once: true }`) reads the **raw** `returnValue`, clears `data-focused` on the element it lit, resolves the `restoreTo` target (callback form invoked with the raw `returnValue`; element form focused directly; nullish → no restore), then resolves the promise with the raw `returnValue`.
- **`data-focused` clears simplified:** the old `onClose` defensively cleared `data-focused` on three footer buttons; `openModal` now clears exactly the one element it focused (`initialFocus`). In collision mode `initialFocus` **is** `#send-modal-send-renamed`, so `modal-default-focus.spec.js` test 2 stays green — confirmed by running the oracle.
- **External contract preserved:** `showConfirmModal` now returns `openModal`'s promise, which resolves to `''` (not `null`) on Esc; `processFiles`' existing `!action` guard maps `'' → bail` unchanged, so the send-modal flow is byte-identical.
- **`returnValue` reset deferred (deliberate):** `openModal` does **not** reset `dialogEl.returnValue` before `showModal()`. This preserves today's exact behavior (the latent "Esc inherits stale returnValue" edge is unchanged) to honor the pure-relocation premise; the defensive reset is left for the future config modals to adopt if desired (documented in the module header).
- **Wiring mirrors E0.1:** `modal.js` is a leaf helper with `__getStateForTests`/`__resetForTests` (copies only: `{ openCount, lastReturnValue, openDialogId }`), surfaced as `window.__modal` in `main.js`; `file-source.js` imports `openModal` **directly** (not via `wireFileSource` opts), exactly as `chrome.js` imports `retainFocus`.

### File List

- `www/renderer/modal.js` — NEW: `openModal` leaf helper + test hooks (AD-8).
- `www/tests/render/modal.spec.js` — NEW: unit spec for `openModal` (5 tests, chromium).
- `www/main.js` — MODIFIED: aliased import of `modal.js` test hooks + `window.__modal` exposure.
- `www/input/file-source.js` — MODIFIED: import `openModal`; replaced the inline `new Promise(...showModal()...)` block in `showConfirmModal` with a single `openModal(...)` call.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story status ready-for-dev → in-progress → review.

### Change Log

| Date | Change |
| --- | --- |
| 2026-07-01 | Implemented E0.2 — created `renderer/modal.js` (`openModal`, AD-8), wired `window.__modal` in `main.js`, refactored `file-source.js` `showConfirmModal` onto `openModal` (behavior byte-identical), added `tests/render/modal.spec.js`. All named oracles green; story → review. |
