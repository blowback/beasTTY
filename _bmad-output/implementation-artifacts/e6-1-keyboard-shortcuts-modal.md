---
baseline_commit: 4397b82ee7919c29173c91b139db73d50a03d3d3
---

# Story E6.1: Keyboard Shortcuts modal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new Beastty user,
I want a keyboard-shortcuts reference,
so that I can discover Ctrl+Alt+T, the zoom shortcuts, copy/paste, Esc-cancel, and the reserved Ctrl combos.

**Covers:** FR-24 (Keyboard Shortcuts modal — lists Ctrl+Alt+T, zoom shortcuts, copy/paste, Esc-cancel, and the reserved combos; AD-8).
**Epic:** E6 · Help Menu. **Depends on:** E0.2 (the shared `openModal` helper — `renderer/modal.js`), E1.1 (the menu-bar shell + the `#dropdown-help` "Keyboard Shortcuts…" placeholder row, `index.html:1527-1529`), E1.2 (keyboard nav + Esc-passthrough guard). **Does NOT depend on** E2/E3/E4/E5 — E6 depends on E0+E1 only (`sprint-status.yaml:45`, `epics.md` §Epic E6). This is the **first story of Epic E6** (epic flips backlog → in-progress on story creation).

**Premise — this is a near-verbatim clone of the E3.3 reserved-ctrl modal, with a shortcut table instead of one paragraph.** The whole modal seam already exists and has shipped three times (E2.3 Serial Config, E3.3 reserved-Ctrl info, E3.4 SLIDE). E6.1 adds a **fourth static-content `<dialog>`** on the identical rails: a `<dialog id="keyboard-shortcuts-modal" class="chrome-modal">`, a Help-menu action row (`data-action="keyboard-shortcuts"`), one table entry in the menu-bar action→opener map, and one zero-arg `openKeyboardShortcuts()` opener in `main.js` injected into `wireMenuBar`. The `#reserved-ctrl-modal` (E3.3) is the exact analog — a non-destructive **info** modal (body copy + Close), so `initialFocus` = the Close button and the caller ignores the `returnValue`. The action→opener table in `menu-bar.js:935-939` even names this story as the next entry ("a new modal e.g. Help ▸ About/E6.2 is one entry").

**The one-sentence shape.** Clone `#reserved-ctrl-modal` → `#keyboard-shortcuts-modal`, replace the single `<p class="hint">` with an aligned shortcut table whose content is single-sourced from `EXPERIENCE.md:180-192`, wire the pre-stubbed Help row, add one opener + one map entry, reuse the shared `.chrome-modal` chrome, and add a `keyboard-shortcuts-modal.spec.js` cloned from `reserved-ctrl-modal.spec.js`. **Zero new mechanic** — no `modal.js` change, no new pref, no state, no build step.

## Acceptance Criteria

The epic's single AC (`epics.md` §Story E6.1) — "Help ▸ Keyboard Shortcuts… opens a modal listing all shortcuts and opens/closes via `openModal`" — decomposed into falsifiable ACs. AC-1/AC-2 are the epic AC's two halves (opens-via-openModal + lists-the-shortcuts); AC-3…AC-5 make the implicit info-modal / aesthetic / suite-green requirements testable.

**AC-1 — Help ▸ Keyboard Shortcuts… closes the dropdown, then opens `#keyboard-shortcuts-modal` via `openModal` (FR-24; AD-8, AD-7, AD-3).**
**Given** the Help menu is open and the "Keyboard Shortcuts…" row (`index.html:1527-1529`, now given `data-action="keyboard-shortcuts"`)
**When** the user activates it (click or Enter)
**Then** it takes the shared modal-opener action path (`menu-bar.js:929-944`): `closeMenu()` runs first (dropdown closes; `window.__menuBar.getOpenMenu() === null`), then the injected `openKeyboardShortcuts()` opener opens the dialog via the shared `openModal` helper (`window.__modal.__getStateForTests().openDialogId === 'keyboard-shortcuts-modal'`), shown with `showModal()` so it gets the top layer + native `::backdrop` + native focus trap. `menu-bar.js` opens it **only** through the injected `openKeyboardShortcuts` opt — it must not import `modal.js` (AD-3).

**AC-2 — The modal lists ALL five required shortcut groups, single-sourced from EXPERIENCE.md (FR-24).**
**Given** the modal is open
**When** it renders
**Then** the body lists — at minimum — every shortcut FR-24 enumerates: **Ctrl+Alt+T** (toggle theme Console↔CRT), the **zoom shortcuts** (Ctrl+= Zoom In / Ctrl+- Zoom Out / Ctrl+0 Actual Size), **copy/paste** (Ctrl+Shift+C copy selection / Ctrl+Shift+V paste — large paste ≥4096 B → paste-confirm toast), **Esc-cancel** (cancel in-flight SLIDE / close topmost modal / dismiss confirm), and the **reserved Ctrl combos** (Ctrl+W / Ctrl+N / Ctrl+T claimed by Chromium, with their alternatives). Each shortcut is paired with its action. Content is **code-accurate** — every combo matches its real handler (see Dev Notes §"The shortcut content" for the reconciliation with EXPERIENCE.md and the exact handler sites): Ctrl+Alt+T → `chrome.js:132` (`toggleTheme`); zoom → `chrome.js:137-158` (`zoomStep`/`resetZoom`); copy/paste → `keyboard.js:248/256` (`Ctrl+Shift+C`/`Ctrl+Shift+V`); Esc → the E1.2 passthrough + `keyboard.js:208-242` cancel chain.

**AC-3 — Non-destructive info modal: Close + Esc semantics and focus round-trip (AD-8 returnValue policy #4; NFR-1/AD-10).**
**Given** the modal is open
**Then** `initialFocus` is the Close button — it carries `data-focused="true"` and is `document.activeElement` on open (policy #4: no destructive default to guard, so Close is the compliant safe default). Closing via the footer `<form method="dialog">` submit **and** via Esc both hide the dialog and resolve `'close'`/`''`; the opener ignores the `returnValue` (nothing to apply). On close, `restoreTo` returns focus to `#terminal-wrapper` (`document.activeElement.id === 'terminal-wrapper'`), so keystrokes resume flowing to the canvas.

**AC-4 — Clean-modal aesthetic on neutral `--chrome-*` tokens (AD-9; DESIGN.md; [[clean-modal-aesthetic]]).**
**Given** the modal is open
**Then** it uses the **clean aligned-row look** (shortcut on one side, action on the other — the `.chrome-modal` aligned-row family from the mock, NOT a transplanted verbose panel), reuses the shared `.chrome-modal` chrome (`index.html:956-1010`), consumes **only** `var(--chrome-*)` tokens — no phosphor vars, no `[data-theme="crt"]` branch (chrome stays visually identical across CRT↔Console), has **no `box-shadow`** (the `::backdrop` scrim is the sole elevation — UX-DR5), and an 8px (`rounded/lg`) corner. Matches `#reserved-ctrl-modal`/`#serial-config-modal`.

**AC-5 — Cross-cutting invariants + suite stays green (NFR-1/AD-10; AD-3; AD-12; FR-6/NFR-3).**
The Keyboard Shortcuts row retains terminal focus on click (`retainFocus` is already applied to every `.menu-item` by `wireDropdownItems` — do not re-add it). `menu-bar.js` gains **no new import** (the opener arrives only as a `wireMenuBar` opt). No new dependency, no build step (AD-1). `window.__menuBar` + `window.__modal` test hooks are extended-not-broken. Boot order preserved (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. The full Playwright chromium suite passes, plus a new `tests/render/keyboard-shortcuts-modal.spec.js` (cloned from `reserved-ctrl-modal.spec.js`) covering: open-from-menu + dropdown-closes + `openDialogId`, initial-focus-on-Close, Close→focus-restore, Esc→focus-restore, the required shortcut content, no-box-shadow, and 8px corner. **About Beastty… (E6.2) is out of scope** — leave its stub row (`index.html:1530-1532`) untouched.

## Tasks / Subtasks

- [x] **Task 1 — Add the `#keyboard-shortcuts-modal` `<dialog>` markup (AC-2, AC-3, AC-4).**
  - [x] `www/index.html` — added `<dialog id="keyboard-shortcuts-modal" class="chrome-modal" aria-labelledby="keyboard-shortcuts-modal-title">` immediately after `#reserved-ctrl-modal`, cloning its header + `<footer><form method="dialog"><button id="keyboard-shortcuts-close" value="close">Close</button></form></footer>` shape verbatim.
  - [x] Header `<h2 id="keyboard-shortcuts-modal-title">Keyboard Shortcuts</h2>`.
  - [x] Body — aligned two-column `.shortcut-row` rows (kbd left / action right) transcribed from `EXPERIENCE.md:180-192`, lightly grouped under five subheads (Display / Zoom / Editing / Cancel / Reserved Ctrl combinations — Q2 recommended default). Code-accurate (Ctrl+Shift+C/V for copy/paste, not bare Ctrl+C/V); the reserved combos list names + alternatives and point at Settings ▸ Browser-reserved Ctrl combinations… rather than transcribing E3.3's paragraph a third time (Q3). A copy comment cites the EXPERIENCE.md SSOT + each real handler site.
- [x] **Task 2 — Wire the pre-stubbed Help row (AC-1).**
  - [x] `www/index.html` — the "Keyboard Shortcuts…" `menu-item` now carries `id="menu-keyboard-shortcuts-item"` + `data-action="keyboard-shortcuts"`; the `<span class="caret">▸ modal</span>` was removed. Kept `data-variant="action"`, the `…`, and the empty `.check` span. About row (E6.2) left untouched.
- [x] **Task 3 — Add the opener + injection in `main.js` (AC-1, AC-3).**
  - [x] `www/main.js` — used the current `makeModalOpener` helper (the codebase refactored `openReservedCtrl` into it since the story was drafted): `const keyboardShortcutsModalEl = …; const openKeyboardShortcuts = makeModalOpener(keyboardShortcutsModalEl, 'keyboard-shortcuts-close');` — same `initialFocus: Close` + `restoreTo: terminalWrapper` contract, harness-safe (`Promise.resolve('')` when the node is absent).
  - [x] Injected `openKeyboardShortcuts,` into the `wireMenuBar({…})` opts block, beside `openReservedCtrl`.
- [x] **Task 4 — Add the menu-bar plumbing (AC-1, AC-5).**
  - [x] `www/renderer/menu-bar.js` — added `let openKeyboardShortcutsRef = null;` (beside `openReservedCtrlRef`); `openKeyboardShortcutsRef = opts.openKeyboardShortcuts || null;` in the opts intake; and `'keyboard-shortcuts': openKeyboardShortcutsRef,` to the action→opener table. No import added (AD-3).
- [x] **Task 5 — Style the modal (AC-4).**
  - [x] `www/index.html` `<style>` — added `#keyboard-shortcuts-modal[open] { max-width: 64ch; }` beside the `#reserved-ctrl-modal[open]` specifics, plus `.shortcut-group` (muted subhead) and `.shortcut-row` (flex space-between; `kbd` on `--field-bg`/`--chrome-border`, action muted). All color/border/backdrop inherit from shared `.chrome-modal`. No `box-shadow`; no phosphor vars; no `[data-theme]` branch.
- [x] **Task 6 — Test (AC-1, AC-2, AC-3, AC-4, AC-5).**
  - [x] `www/tests/render/keyboard-shortcuts-modal.spec.js` — cloned `reserved-ctrl-modal.spec.js`: `ready(page)` boot-race guard; `window.__menuBar.open('help')` then `page.click('#dropdown-help .menu-item[data-action="keyboard-shortcuts"]')`; asserts `getOpenMenu() === null`, `openDialogId === 'keyboard-shortcuts-modal'`, initial focus on `#keyboard-shortcuts-close` (+ `data-focused="true"`), Close-button and Esc both close + restore focus to `#terminal-wrapper`, every required FR-24 shortcut string present, `boxShadow === 'none'`, `borderTopLeftRadius === '8px'`. 7 tests, all pass.
  - [x] Ran the full chromium suite (`npm test`) — 338 passed / 1 skipped / 0 failed (6 pre-existing boot-race/transport flakes passed on the accepted `retries:1` retry).

## Dev Notes

### The one-paragraph mental model

Beastty already has a shared, four-times-proven modal seam. A "static info modal reached from a menu" is: (1) a `<dialog class="chrome-modal">` in `index.html`; (2) a menu row with `data-action="…"`; (3) one entry in the `menu-bar.js:935-939` action→opener table; (4) a zero-arg `openXxx()` in `main.js` that calls `openModal(dialogEl, { initialFocus, restoreTo })` and is injected into `wireMenuBar`. E6.1 does exactly this for a **Keyboard Shortcuts** dialog. The nearest existing twin is `#reserved-ctrl-modal` (E3.3) — also a non-destructive info modal (body copy + Close). Copy its structure; swap the single paragraph for the shortcut table. There is **no** `modal.js` change, **no** new pref/state, **no** build step.

### Content: reconcile EXPERIENCE.md against the real handlers — the handlers WIN for combos

`EXPERIENCE.md:180-192` is the canonical *list of what to show*, but two of its rows are written generically and must be rendered **code-accurate** in a shortcuts reference (a user reads this modal to learn the exact keys):
- EXPERIENCE.md says **"Copy/paste — System copy."** The real bindings are **`Ctrl+Shift+C` → `copySelection()`** (`keyboard.js:248`) and **`Ctrl+Shift+V` → `pasteFromClipboard()`** (`keyboard.js:256`) — *bare* Ctrl+C/Ctrl+V encode 0x03/0x16 (SYN) to the remote, so showing "Ctrl+C/Ctrl+V" would be wrong. Show the `Ctrl+Shift+…` combos.
- **Ctrl+Alt+T** is a **theme toggle** (Console↔CRT), NOT "new terminal" — `chrome.js:132` (chord) → `chrome.js:51 toggleTheme` (the one chord that stays in `chrome.js`, AD-13).
- **Zoom** — `chrome.js:137-158` binds `Ctrl+=`/`Ctrl+NumpadAdd` → `zoomStep(+1)`, `Ctrl+-`/`Ctrl+NumpadSubtract` → `zoomStep(-1)`, `Ctrl+0`/`Ctrl+Numpad0` → `resetZoom()` (impl in `canvas.js:531/560`).
- **Esc-cancel** priority chain — `keyboard.js:208-242`: `Ctrl+Shift+Esc` clears selection; bare Esc cancels selection-drag → active SLIDE recv → in-flight paste → else encodes 0x1B (VT52). Plus the E1.2 menu-bar passthrough (`menu-bar.js:366` — Esc closes an open menu first).
- **Reserved combos** — single-sourced verbatim string at `#reserved-ctrl-modal .modal-body .hint` (`index.html:1912`); see Q3 before duplicating.

Add a comment in the markup citing `EXPERIENCE.md:180-192` **and** these handler sites so a future edit knows where the truth lives.

### The shortcut content (code-accurate)

| Shortcut | Action |
|---|---|
| Ctrl+Alt+T | Toggle theme (Console ↔ CRT) |
| Ctrl+= | Zoom In |
| Ctrl+- | Zoom Out |
| Ctrl+0 | Actual Size (zoom 1×) |
| Ctrl+Shift+C | Copy selection |
| Ctrl+Shift+V | Paste (large paste ≥4096 B → paste-confirm toast) |
| Esc | Cancel in-flight SLIDE / close topmost modal / dismiss confirm |
| Shift+PgUp / PgDn / Home / End | Scroll scrollback (optional — nice-to-have, `keyboard.js:265-269`) |
| Ctrl+A…Ctrl+Z (except W/N/T) | Forwarded to MicroBeast as control codes |
| Ctrl+W / Ctrl+N / Ctrl+T | Claimed by Chromium — cannot be intercepted; use Ctrl+F4 / Ctrl+Shift+N / a different keybinding |
| Ctrl+@ Ctrl+[ Ctrl+\ Ctrl+] Ctrl+^ Ctrl+_ | Forwarded normally |

FR-24's five named groups (Ctrl+Alt+T, zoom, copy/paste, Esc-cancel, reserved combos) are all present — keep those explicit. The `Ctrl+A…Z` / punctuation rows can be folded to one line if the table gets long; the Shift+scroll row is optional (not named by FR-24).

### ⚠️ Note — content overlap with the reserved-Ctrl modal (single-sourcing decision)

The reserved-Ctrl combos already appear verbatim in `#reserved-ctrl-modal` (E3.3, reached from Settings). FR-24 **also** requires them in the Keyboard Shortcuts modal (Help). This is intentional duplication across two different surfaces — do **not** try to share a DOM node between the two dialogs (they open independently). Keep the phrasing consistent with the E3.3 copy (`index.html:1912`) so a reader who sees both isn't confused. See Q3.

### Exact code sites (verified against `4397b82`)

**`www/index.html`:**
- `:1524-1533` — the **Help** `menu-group`: `#menu-help` title + `#dropdown-help`. The **"Keyboard Shortcuts…" row `:1527-1529`** (`data-variant="action"`, `▸ modal` caret, empty `.check`) — add `data-action="keyboard-shortcuts"`. The **"About Beastty…" row `:1530-1532`** — leave for E6.2.
- `:1907-1922` — **`#reserved-ctrl-modal`** — the clone template (header + `.modal-body` + `<footer><form method="dialog"><button id="reserved-ctrl-close" value="close">Close</button></form></footer>`). `:1489-1490` — the E3.3 action-row (`data-action="reserved-ctrl"`) shape.
- `:956-1010` — shared **`.chrome-modal`** chrome (`:966 :not([open]){display:none}`, `:969 [open]` layout, `:984 ::backdrop` scrim, `:987 header`, `:992 h2`, `:1001 .modal-body`). `:1192-1197` — the `#reserved-ctrl-modal[open]{max-width:70ch}` specifics block (add a sibling `#keyboard-shortcuts-modal[open]` here).

**`www/main.js`:**
- `:248-256` — **`openReservedCtrl`** (clone this exactly) + `:141-160`/`:214-215` `openModal` import. `:268-281` — `openSlideConfig` (second precedent). `terminalWrapper` is already in scope (used by every opener).
- `:385-475` — the `wireMenuBar({…})` opts block; `:465` `openReservedCtrl` is the sibling to add beside. `:458`-ish `window.__menuBar`. `:476`+ `wireChrome` runs AFTER `wireMenuBar`, BEFORE `wireKeyboard` (AD-12 — don't disturb).

**`www/renderer/menu-bar.js`:**
- `:57` `MENUS = ['file','connection','view','settings','debug','help']` (help already in the loop; the discovery loop already wires `#menu-help`/`#dropdown-help`).
- `:175` `openReservedCtrlRef = null` (add `openKeyboardShortcutsRef` beside). `:322` opts intake (`openReservedCtrlRef = opts.openReservedCtrl || null;`). `:935-939` the **action→opener table** — add `'keyboard-shortcuts': openKeyboardShortcutsRef`. `:940-944` the shared dispatch (`closeMenu(); modalOpener?.();`).
- **AD-3 import guard:** `menu-bar.js` must not import `modal.js` — the opener comes via opts only.

**`www/renderer/modal.js`:** unchanged. Contract: `openModal(dialogEl, { initialFocus, restoreTo }) → Promise<returnValue>`; `showModal()` gives the top layer + native `::backdrop` + native focus trap (do NOT hand-roll a trap); `returnValue` reset to `''` before every open so Esc/backdrop resolves `''`; surfaced as `window.__modal` (`__getStateForTests().openDialogId`).

### What must be preserved (non-negotiable — AD-3 / AD-8 / AD-9 / AD-12 / FR-6)

- **`menu-bar.js` adds no import** — `openKeyboardShortcuts` is injected (AD-3). The opener lives in `main.js` (which owns `openModal`).
- **Info-modal contract** — `initialFocus` = Close, `restoreTo` = `terminalWrapper`, caller ignores `returnValue` (AD-8 policy #4). Esc/backdrop resolve `''`; do not add an affirmative branch.
- **Neutral chrome only** — `var(--chrome-*)`, no phosphor vars, no `[data-theme]` branch, no `box-shadow` (AD-9, UX-DR5). Reuse `.chrome-modal`; don't fork its chrome.
- **Boot order** (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. No build step; no new dependency.
- **E6.2 untouched** — do not implement or restyle the About row/modal in this story.

### Reuse — do NOT reinvent

- **The modal seam is done (E2.3/E3.3/E3.4).** Clone `#reserved-ctrl-modal` + `openReservedCtrl` + the E3.3 action-row + the one map entry. The `menu-bar.js:935-939` table comment literally anticipates this ("a new modal … is one entry, not another copy-pasted branch").
- **The test is done (E3.3).** `reserved-ctrl-modal.spec.js` is the near-exact clone for `keyboard-shortcuts-modal.spec.js` — same `ready()` guard, same menu-open-then-click, same focus/Esc/no-shadow/8px assertions. Swap ids `reserved-ctrl` → `keyboard-shortcuts`, menu `settings` → `help`, and the content assertions.
- **The `.chrome-modal` styling is done.** Only a `max-width` + the shortcut two-column row layout are modal-specific.

### Testing standards + codified idioms (re-embedded per E5.1 Q3 — intentionally per-story)

- **Boot-race guard first:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function' && typeof window.__modal === 'object' && window.__modal !== null)`.
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('help'))` — never a title `.click()`.
- **Activate the row:** `await page.click('#dropdown-help .menu-item[data-action="keyboard-shortcuts"]')`.
- **Dropdown-closed assertion:** `window.__menuBar.getOpenMenu() === null` after activation (action semantics).
- **Modal-opened assertion:** `window.__modal.__getStateForTests().openDialogId === 'keyboard-shortcuts-modal'` and `expect(page.locator('#keyboard-shortcuts-modal')).toBeVisible()`.
- **Focus:** `document.activeElement.id === 'keyboard-shortcuts-close'` on open (+ `data-focused="true"`); `=== 'terminal-wrapper'` after Close **and** after Esc.
- **Content:** assert each FR-24 group's string is present in `.modal-body` (Ctrl+Alt+T, Ctrl+=, Ctrl+-, Ctrl+0, Esc, Ctrl+W/N/T, Copy/Paste).
- **Aesthetic:** `getComputedStyle(dialog).boxShadow === 'none'`; `borderTopLeftRadius === '8px'`.
- **`retainFocus`:** `document.activeElement.id === 'terminal-wrapper'` — but note the row-click immediately opens the modal, so this is really covered by the initial-focus/restore assertions.
- **Projects/run:** render specs → `chromium` project; the flake mask is `chromium-transport` `fullyParallel:false` `retries:1`. `npm test` / `npm run test:fast` (`@fast`). No per-story `--workers=1`.

### Project Structure Notes

- **No new runtime module.** Edits: `index.html` (dialog markup + row `data-action` + CSS), `main.js` (opener + injection), `menu-bar.js` (ref + opts + map entry), one new spec. Matches the E3.3 footprint.
- **New ids** kebab-case + feature-prefixed: `#keyboard-shortcuts-modal`, `#keyboard-shortcuts-modal-title`, `#keyboard-shortcuts-close` (mirroring `#reserved-ctrl-modal` / `-title` / `-close`). Named exports only; no default exports; no new deps; no build step (AD-1).
- **E7 note:** this is a NEW menu/modal surface (no legacy pane to retire), so it does not touch the E7 dual-chrome retirement checklist.

### References

- [Source: `epics.md` §Story E6.1 + §Epic E6] — user story + the single epic AC (FR-24; opens/closes via `openModal`); Epic E6 depends on E0, E1.
- [Source: `prds/prd-beastty-2026-07-01/prd.md:420-431` (§4.7 Help Menu / FR-24)] — Help menu hosts two reference modals (AD-8); FR-24 lists Ctrl+Alt+T, zoom shortcuts, copy/paste, Esc-cancel, and the reserved combos.
- [Source: `ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md:75-90` (§Help) + `:180-192` (§Interaction Primitives — Keyboard shortcuts table)] — **the content SSOT**: the full shortcut table transcribed above; Help ▸ Keyboard Shortcuts… = "Modal listing all shortcuts."
- [Source: `ux-designs/ux-beastty-2026-07-01/DESIGN.md:192-193`] — modal dialog on `chrome-bg`, 1px `chrome-border`, `rounded/lg`, monospace, header/body/footer; Keyboard Shortcuts listed as a hosted modal. `:131,:137` — `chrome-muted` shortcut hints; red reserved for port-lost/security only.
- [Source: `ux-designs/.../mockups/key-screen-chrome.html:94-117`] — the clean modal aesthetic (aligned `.field` rows, header/body/footer) — the target look ([[clean-modal-aesthetic]]).
- [Source: `architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md` — AD-8 (`:105-108`), AD-9 (`:110-113`), AD-3 (import allowlist), AD-12 (boot order)] — one shared `openModal` helper; every config modal a native `<dialog>` opened via `showModal()`/closed via `close(tag)`; chrome uses only `--chrome-*` tokens; Keyboard Shortcuts + About are `<dialog>` + `openModal` (`:206`).
- [Source: `www/renderer/modal.js:9-51,61-109`] — the pinned `openModal` contract + returnValue policy (#4: non-destructive default-focus safe choice); `showModal()` native trap/backdrop; `window.__modal` test hook.
- [Source: `www/main.js:248-256`] — `openReservedCtrl` (the exact opener to clone); `:268-281` `openSlideConfig`; `:385-475` `wireMenuBar` opts (`:465` `openReservedCtrl`).
- [Source: `www/renderer/menu-bar.js:175, 322, 929-944`] — `openReservedCtrlRef`; opts intake; the **action→opener table** (add one entry) + shared `closeMenu(); modalOpener?.()` dispatch. AD-3: no `modal.js` import.
- [Source: `www/index.html:1524-1533` (Help menu + stubs), `:1907-1922` (`#reserved-ctrl-modal` clone template), `:956-1010` (`.chrome-modal` shared chrome), `:1192-1197` (`#reserved-ctrl-modal[open]` specifics)].
- [Source: `www/tests/render/reserved-ctrl-modal.spec.js`] — the spec to clone (menu-open→click, `openDialogId`, initial-focus-on-Close, Close/Esc focus-restore, no-box-shadow, 8px corner).
- [Source: the real shortcut handlers the modal content must agree with — `www/renderer/chrome.js:132` (Ctrl+Alt+T chord) → `:51 toggleTheme` (AD-13); `chrome.js:137-158` (zoom chords) → `www/renderer/canvas.js:531 zoomStep`/`:560 resetZoom`; `www/input/keyboard.js:248 copySelection (Ctrl+Shift+C)`/`:256 pasteFromClipboard (Ctrl+Shift+V)`/`:208-242 Esc-cancel chain`/`:265-269 Shift-scroll`; `www/renderer/menu-bar.js:366` (Esc menu-passthrough)].
- [Source: `_bmad-output/.../e3-3-settings-menu-reset-all-preferences-reserved-ctrl-info.md`] — the reserved-Ctrl info-modal story (this story's closest precedent).

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **Modal width.** **Recommended default:** `#keyboard-shortcuts-modal[open] { max-width: 70ch }` (same as `#reserved-ctrl-modal`) — a shortcut table is body-copy-shaped, not a config form. Widen only if the two-column rows wrap awkwardly.
2. **Table grouping / markup.** **Recommended default:** render the shortcuts as aligned two-column rows (shortcut left, action right — the `.chrome-modal .field` alignment family) under 4–5 light subheads (Display · Zoom · Editing · Cancel · Reserved) for scannability, matching the clean aligned-row aesthetic. **Alternative:** one flat `<dl>`/table with no subheads (simpler, slightly denser). Recommend the lightly-grouped aligned rows — it reads best and matches the mock, without becoming a verbose panel ([[clean-modal-aesthetic]]).
3. **Reserved-combo copy duplication with `#reserved-ctrl-modal` (the codebase single-sources this string emphatically).** The exact reserved-Ctrl paragraph is tested byte-identical across surfaces (`reserved-ctrl-modal.spec.js:84-88` asserts `details.reserved > p.hint` still matches the modal copy), so adding a **third** verbatim copy in the Shortcuts modal creates a new sync liability. FR-24 nonetheless requires the reserved combos to appear here. **Recommended default:** in the Shortcuts modal, list the combo *names* + one-line alternatives (Ctrl+W/N/T → Ctrl+F4 / Ctrl+Shift+N / a different keybinding) — enough to satisfy FR-24's "lists … the reserved combos" — and add a one-line pointer "See Settings ▸ Browser-reserved Ctrl combinations… for details," rather than transcribing the full E3.3 paragraph a third time. **Alternative:** restate the full paragraph verbatim, matching `index.html:1912` exactly (accept the third sync point). Do **not** share a DOM node between the two dialogs either way. Recommend names+pointer.
4. **Should the Shortcuts modal show a `▸ Settings ▸ …` cross-reference?** **Recommended default:** no — keep it a flat reference; cross-navigation between modals is out of scope for FR-24.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- `npx playwright test --project=chromium keyboard-shortcuts-modal` → 7 passed.
- `npm test` (full chromium suite) → 338 passed / 1 skipped / 0 failed; 6 flaky (pre-existing boot-race/transport specs — keydown-printable, local-echo, tx-debug-strip, grid visual baseline — all passed on the accepted `retries:1` retry, unrelated to this change).

### Completion Notes List

- Fourth static-content `<dialog>` on the shared modal seam, cloned from `#reserved-ctrl-modal` (E3.3). **Zero new mechanic**: no `modal.js` change, no new pref/state, no build step, no new dependency.
- **Deviation from Dev Notes (verified, benign):** the story described cloning a hand-written `openReservedCtrl` in `main.js`, but the codebase has since refactored all openers into a shared `makeModalOpener(modalEl, initialFocusId, onOpen)` helper. Followed the live pattern — `openKeyboardShortcuts = makeModalOpener(keyboardShortcutsModalEl, 'keyboard-shortcuts-close')` — which yields the identical `openModal(el, { initialFocus: Close, restoreTo: terminalWrapper })` contract and the same harness-safe `Promise.resolve('')` no-markup guard. Same behaviour, less code.
- **Content code-accuracy (AC-2):** copy/paste rendered as `Ctrl+Shift+C` / `Ctrl+Shift+V` (verified against `input/keyboard.js:248/256`; bare Ctrl+C/V encode control codes to the remote). Ctrl+Alt+T verified as a theme toggle (`renderer/chrome.js` chord → `toggleTheme`), not "new terminal". A markup comment cites the `EXPERIENCE.md:180-192` SSOT plus every real handler site.
- **Q-decisions (recommended defaults taken):** Q1 → `max-width: 64ch` (slightly narrower than reserved-ctrl's 70ch — the two-column rows are compact). Q2 → lightly-grouped aligned rows under five subheads. Q3 → reserved combos listed by name + alternatives with a one-line pointer to Settings ▸ Browser-reserved Ctrl combinations…, avoiding a third verbatim copy of the E3.3 paragraph. Q4 → no cross-nav; flat reference.
- **Invariants held:** `menu-bar.js` gains no import (AD-3) — the opener arrives only via `wireMenuBar` opts. Info-modal contract (initialFocus = Close, `returnValue` ignored — AD-8 policy #4). Neutral `--chrome-*` chrome only, no phosphor vars, no `box-shadow` (AD-9/UX-DR5), 8px corner. Boot order untouched (AD-12). E6.2 About row/modal left alone.

### File List

- `www/index.html` — new `#keyboard-shortcuts-modal` `<dialog>` markup; Help ▸ Keyboard Shortcuts… row given `id`/`data-action` and caret removed; `#keyboard-shortcuts-modal` CSS specifics (max-width + `.shortcut-group`/`.shortcut-row`/`kbd`/`.act`).
- `www/main.js` — `keyboardShortcutsModalEl` + `openKeyboardShortcuts` opener; injected into the `wireMenuBar` opts.
- `www/renderer/menu-bar.js` — `openKeyboardShortcutsRef` declaration, opts intake, and `'keyboard-shortcuts'` entry in the action→opener table.
- `www/tests/render/keyboard-shortcuts-modal.spec.js` — new spec (7 tests), cloned from `reserved-ctrl-modal.spec.js`.

### Change Log

| Date | Change |
|---|---|
| 2026-07-04 | E6.1 implemented — Help ▸ Keyboard Shortcuts… opens `#keyboard-shortcuts-modal` via the shared `openModal` seam; code-accurate shortcut reference single-sourced from EXPERIENCE.md; 7 new tests; full chromium suite green. Status → review. |
| 2026-07-04 | Code review run (high effort, whole-branch); E6.1's own modal clean; 4 findings on adjacent E3/E4 surfaces fixed in the same commit; suite green. Status → done. |

### Code Review

`code-review` (high effort — 3 correctness + 3 cleanup + altitude + conventions angles across 5 finder agents + adversarial verify) run 2026-07-04 over the whole `ui-rethink` working tree (the E6.1 modal plus the E3/E4 surfaces it sits on).

**E6.1's own code: 0 correctness findings.** The `#keyboard-shortcuts-modal` is a clean clone of `#reserved-ctrl-modal` on the shared `.chrome-modal` rails; the injected `openKeyboardShortcuts` opener and the `menu-bar.js` action→opener map entry hold AD-3/AD-8/AD-9/AD-12. Finder E raised two **design-level, non-defect** observations that were **intentionally accepted**: the shortcut combos are static HTML rather than derived from the live handlers, and the leading markup comment cites `file:line` SSOT locations that can rot — both are the story's deliberate approach (static reference + SSOT comment; Q3 single-sourcing decision), and deriving combos from handlers is out of scope for a static help modal.

**4 findings on adjacent E3/E4 surfaces — all fixed in this commit:**
1. `status-bar.js` — returning-user "MicroBeast — click Connect" cue was lost when the native port picker is cancelled (`bootDeviceReady` cleared on the transient `connecting` state); now cleared only on `connected`.
2. `status-bar.js` — `dispose()` left the `#status-errors` click listener attached (surface not fully inert after teardown); now removed there too.
3. `menu-bar.js` — the Reset 2-click disarm-guard sat *after* the `disabled` early-return, so a click on a disabled row while armed left the confirm armed; moved before it so any click path disarms.
4. `menu-bar.js` — extracted a shared `setRowDisabled()` helper (the `data-disabled`+`aria-disabled`+`title` triple was hand-copied across `projectSessionLog`/`projectSendFile`/`syncSubmenuDisabled`).

**Refuted / not fixed (with reason):** `main.js` `chooseMicroBeast`'s `await disconnect()` — refuted: `teardown()` wraps `setSignals`/`reader.cancel()`/`port.close()` in try/catch, so `disconnect()` cannot reject and the reconnect always proceeds. `slide-recv.js` removed focus-restore — speculative future path; every current path goes through `openModal`'s `restoreTo: terminalWrapper`. Status-bar zoom pre-paint clamp — cosmetic, self-correcting on the boot `pushZoom`, explicitly documented as a pre-paint.

Suite after the fixes: full chromium `render` + `transport` + `session` green (pre-existing bell/cursor/boot-race visual flakes pass on the accepted `retries:1`).
