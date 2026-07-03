---
baseline_commit: c8435bba22e7abdf561af41bc4db348ad19dab04
---

# Story E3.3: Settings menu — Reset All Preferences & Reserved-Ctrl info

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want a guarded reset and an explanation of browser-claimed Ctrl combos,
so that I can start clean deliberately and understand why some Ctrl keys don't reach the Z80.

**Covers:** FR-21 (Browser-reserved Ctrl combinations info modal), FR-22 (Reset All Preferences — inline 2-click confirm, idempotent re-projection on reset).
**Epic:** E3 · File, Settings & Transfer Configuration. **Depends on:** E0 (`openModal`/`retainFocus` primitives — done), E1.1 (menu-bar shell + `#dropdown-settings` + `data-action` dispatch — done), E1.2 (keyboard nav + Esc-guard — done), E1.3 (the `projectPrefs` reset-re-projection subscriber, AD-14 — done), E2.3 (the "action row → injected `openModal` opener" pattern, the exact template for FR-21 — done), E3.1/E3.2 (the two prior Settings/File relocation stories that filled this dropdown — done).

**Premise (epic-wide, confirmed — `epics.md:22-24`):** pure **relocation**. Every control keeps its exact v1.1 behavior and only moves to a new home. Both behaviors this story relocates **already exist and work today** inside the legacy `<details id="settings">` pane:

- **FR-22 (Reset All Preferences)** — the 2-click confirm (`Reset all preferences` ↔ `Click again to confirm (3 s)`, a 3-second disarm timer, second-click commits `resetPrefs()`) lives verbatim in **`chrome.js:267-293`**, driving `#reset-prefs-button` (`index.html:1469`). `resetPrefs()` (`prefs.js:157-161`) already fans out to subscribers, and `menu-bar.js`'s `projectPrefs` (`:1184`) is **already** a registered `prefsSubscribe` subscriber (`main.js:1276-1277`) that idempotently re-projects every menu row on reset (E1.3/E1.4/E1.5/E2.2/E3.2 filled its body). So the reset re-projection the AC demands **is already in place** — this story only adds the menu **trigger**.
- **FR-21 (Reserved-Ctrl info)** — the exact copy lives verbatim in the legacy `<details class="reserved">` (`index.html:1449-1451`). This story moves that one paragraph into a new `openModal`-driven `<dialog>`, re-styled onto neutral `--chrome-*` tokens (AD-9), and opens it from a new Settings menu row.

**Relocation strategy — trigger-the-existing-path, do not duplicate.** FR-22 injects the already-imported `resetPrefs` into `wireMenuBar` (it is imported in `main.js:31` and already injected into `wireChrome:321` — this story adds it to the `wireMenuBar` opts too) and adds a **dedicated dispatch branch** that runs the 2-click confirm **in the menu item itself** (the row's `.lbl` swaps, the menu stays open between clicks). FR-21 creates one new `<dialog id="reserved-ctrl-modal">` + a `main.js openReservedCtrl()` opener injected exactly like `openSerialConfig` (E2.3), and a new Settings row wired through the existing `onItemClick` `data-action` seam. The legacy `#reset-prefs-button`, `chrome.js:267-293`, and `<details class="reserved">` all **remain** during the E7 `#top-bar`/`<details>` coexistence window — this story does not delete them.

## Acceptance Criteria

Verbatim epic ACs (`epics.md` §Story E3.3, lines 466-482) decomposed and made testable. AC-1/AC-4 are the epic's two ACs (Reset 2-click; reserved-Ctrl modal); AC-2/AC-3/AC-5/AC-6/AC-7 make the implicit "disarm on every close path / re-projection actually fires / verbatim copy / focus round-trips / no regression" requirements falsifiable.

**AC-1 — Reset All Preferences arms on first activation and commits on the second within the window (FR-22; AD-4, AD-14).**
**Given** the Settings menu is open and the "Reset all preferences" row (`index.html:1291-1293`, now given `id="menu-reset-prefs-item"` + `data-action="reset-prefs"`)
**When** the user activates it once (click **or** Enter)
**Then** the row's `.lbl` text swaps `Reset all preferences` → `Click again to confirm (3 s)` (verbatim, same two constants as `chrome.js:274-275`), a 3-second disarm timer arms, and the **menu stays open** (this row does **not** `closeMenu()` on the first activation — the confirm prompt must remain visible, unlike a normal action item)
**And when** the user activates it a **second time before the timer fires**, `menu-bar.js` calls the injected `resetPrefs()` (AD-3 — reached via opts, not imported), the disarm state clears, and the menu closes (the destructive action has committed — action semantics now apply)
**And when** the timer elapses with no second activation, the label reverts to `Reset all preferences` and the arm clears (idempotent — re-arming works cleanly).

**AC-2 — Reset re-projects every prefs-driven menu row without throwing, single-writer preserved (FR-22; AD-14, AD-4, NFR-4).**
**Given** `resetPrefs()` has committed (AC-1) and fans out to its two subscribers (`main.js:1276-1277`)
**When** the fan-out runs
**Then** `applyPrefs` (the first subscriber) re-applies the **canvas + live keyboard** defaults (theme/phosphor/font/zoom canvas setters + `setLocalEcho`/`setCrlfMode` + legacy pane DOM — each canvas setter invoked from exactly one place, AD-14 single-writer) **and** `menuBar.projectPrefs` (the second subscriber) idempotently re-projects **only its own menu DOM**: Connection ▸ Auto-connect glyph → unchecked, Settings ▸ Local echo glyph → unchecked, Enter-key-sends radio → CR, View ▸ Theme/Phosphor/Font radios → defaults, no-throw when a menu is absent (`projectPrefs:1184-1229` — **already implemented; this AC asserts it fires from the menu-triggered reset, not that new projection code is written**). `projectPrefs` never calls a canvas or keyboard setter (that is `applyPrefs`'s single-writer job).

**AC-3 — The confirm disarms on EVERY path that hides the Settings dropdown mid-confirm (FR-22 — correctness, no stale prompt).**
**Given** the Reset row is armed (first activation done, timer running, `.lbl` shows `Click again to confirm (3 s)`)
**When** the Settings dropdown is dismissed **without** a second activation — Esc (`menu-bar.js:428`), click-away (`:326`), **or** switching to another menu title (`openMenuNamed:960`, which sets `openMenu` directly and **bypasses** `closeMenu()`)
**Then** the disarm timer is cleared and the `.lbl` reverts to `Reset all preferences`, so re-opening Settings never shows a stale `Click again to confirm (3 s)` prompt
**And** the disarm is wired into **both** `closeMenu()` (`:1084`) **and** `openMenuNamed()` (`:960`) — calling a shared `disarmResetConfirm()` idempotently from each (re-entering Settings fresh also disarms any residue). No pending `setTimeout` survives a menu close (no leaked timer re-labels a closed row).

**AC-4 — Browser-reserved Ctrl combinations… opens an info modal via `openModal`, menu closes, focus round-trips (FR-21; AD-8, AD-3).**
**Given** the Settings menu is open and a new "Browser-reserved Ctrl combinations…" row (`data-variant="action"` + `data-action="reserved-ctrl"`)
**When** the user activates it (click or Enter)
**Then** the dropdown **closes** (`getOpenMenu() === null`) and a `<dialog id="reserved-ctrl-modal">` opens via the shared `openModal(dialogEl, {initialFocus, restoreTo})` helper (top-layer `showModal()`, native scrim + focus-trap); the opener is injected into `wireMenuBar` opts as `openReservedCtrl` (AD-3 — menu-bar must not import `modal.js`), mirroring E2.3's `openSerialConfig`
**And** on close (Close button **or** Esc) focus is restored to `#terminal-wrapper` per the helper's `restoreTo`; the modal is non-destructive so `initialFocus` is the Close button (policy clause #4, `modal.js:41-42` — no destructive default to guard, so Close is a compliant safe default).

**AC-5 — The reserved-Ctrl modal copy is byte-for-byte the legacy paragraph (FR-21, UX-DR10 verbatim microcopy).**
**Given** the open reserved-Ctrl modal
**Then** its body contains the verbatim paragraph from `index.html:1451` — `"Ctrl+W, Ctrl+N, Ctrl+T are claimed by Chromium (close tab, new window, reopen closed tab) and cannot be intercepted by a web page. Use Ctrl+F4, Ctrl+Shift+N, or a different keybinding on the MicroBeast side if you need those control codes. Everything from Ctrl+A through Ctrl+Z (except W, N, T) is forwarded normally, as are Ctrl+@, Ctrl+[, Ctrl+\, Ctrl+], Ctrl+^, Ctrl+_."` — reproduced exactly (including the `Ctrl+\`, `Ctrl+]`, `Ctrl+^`, `Ctrl+_` run and the parenthetical), plus a header (`<h2>` title, e.g. "Browser-reserved Ctrl combinations") and a Close affordance. No copy is paraphrased or re-worded.

**AC-6 — Neutral-shell styling + focus retention (NFR-2/AD-9; NFR-1/AD-10 "Sacred"; UX-DR5/6).**
**Given** the reserved-Ctrl modal markup
**Then** it uses **only** `var(--chrome-*)` tokens (no phosphor/`[data-theme]` branch): dialog `rounded/lg` (8px), **no drop shadow** (native scrim is the only elevation), reasonable max-width, monospace type; it reuses the `#serial-config-modal` conventions established in E2.3 (incl. the `:not([open])` display guard). The new Reset and reserved-Ctrl rows retain terminal focus on activation (`retainFocus` is already applied to every `.menu-item` by `wireDropdownItems:775-788`) — after any activation `document.activeElement.id === 'terminal-wrapper'` (for reset's first click, the menu stays open but focus still round-trips to the terminal). `[data-focused]` (not `:focus-visible`) drives any chrome highlight.

**AC-7 — Coexistence, single-writer, boot order, suite green (FR-6, NFR-3, NFR-4, AD-12).**
**Given** the relocation
**When** the suite runs
**Then** the legacy `#reset-prefs-button` + its `chrome.js:267-293` 2-click handler and the legacy `<details class="reserved">` **stay functional** through the E7 coexistence window (each carries/gets an E7-retirement marker); the menu Reset confirm and the legacy button confirm are **independent** self-contained 2-click machines (no lockstep needed — neither mirrors the other's transient armed state, unlike the E2.2/E3.2 pref checkboxes; only the shared `resetPrefs()` outcome matters, and it re-projects both surfaces' persisted state via `applyPrefs`/`projectPrefs`). `menu-bar.js` imports neither `modal.js` nor gains a `resetPrefs` import — both arrive via opts (AD-3). No `prefs.js` schema change / no `CURRENT_VERSION` bump. Boot order untouched (`wireMenuBar` before `wireKeyboard`; polite-fail first). The full Playwright chromium suite passes; new coverage exercises the arm→commit, arm→disarm-on-each-close-path, the reset re-projection firing from the menu, and the reserved-Ctrl modal open/close/verbatim-copy/focus-restore.

## Tasks / Subtasks

- [x] **Task 1 — Wire the Reset row's inline 2-click confirm to the injected `resetPrefs` (AC-1, AC-2, AC-7).**
  - [x] `index.html` — add `id="menu-reset-prefs-item"` + `data-action="reset-prefs"` to the existing Reset stub row (`:1291-1293`). Leave the `.lbl` initial text `Reset all preferences`.
  - [x] `menu-bar.js` — add a `resetPrefsRef` module ref (beside `openSerialConfigRef`/`sendFileRef`); assign from `opts.resetPrefs` (null-guarded). **Do NOT add `resetPrefs` to the `prefs.js` import** — AD-3 lists it as opts-injected (contrast the direct `getPrefs`/`savePrefs` import). Add the two label constants `RESET_PREFS_IDLE_LABEL = 'Reset all preferences'` / `RESET_PREFS_CONFIRM_LABEL = 'Click again to confirm (3 s)'` (verbatim from `chrome.js:274-275`) + a module-scope `resetPrefsConfirmTimer = null`.
  - [x] `menu-bar.js onItemClick` — add a `if (action === 'reset-prefs') { … return; }` branch (before the generic `if (action) runViewAction` fallthrough at `:885`) that replicates the `chrome.js:278-291` toggle **against the row's `.lbl`**: first activation → set `.lbl` to CONFIRM label + arm a 3s `setTimeout` that reverts + clears the timer, **and does NOT `closeMenu()`** (menu stays open); second activation while armed → `clearTimeout`, `resetPrefsRef?.()`, revert `.lbl`, then `closeMenu()` (the destructive commit closes the menu).
  - [x] `main.js` — inject `resetPrefs` into the `wireMenuBar({…})` opts block (beside `openSerialConfig`). It is already imported (`:31`) and already injected into `wireChrome` (`:321`).

- [x] **Task 2 — Disarm the confirm on every Settings-dropdown-hide path (AC-3).**
  - [x] `menu-bar.js` — add `disarmResetConfirm()`: if `resetPrefsConfirmTimer !== null`, `clearTimeout` + null it + revert the `#menu-reset-prefs-item` `.lbl` to IDLE (all lookups guarded/no-throw; idempotent — safe to call when not armed).
  - [x] `menu-bar.js` — call `disarmResetConfirm()` at the top of **both** `closeMenu()` (`:1084`, covers Esc + click-away + post-action close) **and** `openMenuNamed()` (`:960`, covers switching to another menu title, which sets `openMenu` directly and bypasses `closeMenu`). Re-entering Settings fresh disarms any residue.

- [x] **Task 3 — Add the reserved-Ctrl `<dialog>` + its menu row + injected opener (AC-4, AC-5, AC-6).**
  - [x] `index.html` — add a new Settings row **before** the Reset row (EXPERIENCE.md order: reserved-Ctrl, then Reset last as the most-consequential): `<button … data-variant="action" data-action="reserved-ctrl"><span class="check"></span><span class="lbl">Browser-reserved Ctrl combinations…</span></button>` (trailing `…` = "opens further UI", matching `Serial Configuration…`; no `▸` caret — that's radio-submenu-only). Consider a `menu-sep` grouping so the two info/destructive rows read as a distinct block (see Q3).
  - [x] `index.html` — add `<dialog id="reserved-ctrl-modal" aria-labelledby="reserved-ctrl-modal-title">` beside `#serial-config-modal` (end of body), with `<header><h2 id="reserved-ctrl-modal-title">Browser-reserved Ctrl combinations</h2></header>`, a `.modal-body` holding a `<p class="hint">` with the **verbatim** paragraph from `:1451` (AC-5), and a `<footer>` with a Close control via `<form method="dialog"><button value="close">Close</button></form>`.
  - [x] `index.html` — add scoped CSS only if the modal needs anything beyond the shared modal rules; prefer reusing the `#serial-config-modal` selectors/tokens (no new palette; `rounded/lg`; no `box-shadow`). An info modal is body-copy + Close, so this should be near-zero new CSS.
  - [x] `main.js` — define `openReservedCtrl()` next to `openSerialConfig` (`:228`): grab `#reserved-ctrl-modal`, return `openModal(el, { initialFocus: <close button>, restoreTo: terminalWrapper })`, null-guarded (return `Promise.resolve('')` when absent).
  - [x] `main.js` — inject `openReservedCtrl` into `wireMenuBar({…})` opts.
  - [x] `menu-bar.js` — add `openReservedCtrlRef` opt + a `if (action === 'reserved-ctrl') { closeMenu(); openReservedCtrlRef?.(); return; }` branch in `onItemClick` (mirror the `serial-config` branch at `:861-865`).

- [x] **Task 4 — Coexistence + relocation hygiene (AC-7).**
  - [x] Leave `#reset-prefs-button` + `chrome.js:267-293` and `<details class="reserved">` functional; add/refresh E7-retirement markers tying all three (with `#top-bar`) to E7 removal. The two Reset confirm machines stay independent (no armed-state mirror).
  - [x] Do **not** touch `applyPrefs` (`main.js:1204-1277` region) or `projectPrefs` (`menu-bar.js:1184`) reset-re-projection logic — it already fires on the menu-triggered reset (AC-2). Do **not** add SLIDE rows (E3.4).

- [x] **Task 5 — Tests (AC-1…AC-7).**
  - [x] New spec `www/tests/render/menu-bar-settings-reset.spec.js` (chromium project): arm (one click → `.lbl` = confirm label, `getOpenMenu()==='settings'`) → commit (second click → `resetPrefs` ran, menu closed); arm → wait >3s → label reverts; arm → Esc → reopen shows idle label; arm → click-away → idle; arm → switch to another title → idle; reset re-projection: seed non-default prefs, open Settings, arm+commit, assert `getPrefs()` back to `DEFAULTS` **and** the Local echo / auto-connect / crlf menu glyphs re-projected (drive `projectPrefs` fires via the real subscriber). Assert `document.activeElement.id==='terminal-wrapper'` after each activation.
  - [x] Extend/add `www/tests/render/reserved-ctrl-modal.spec.js` (or fold into the settings spec): open via `window.__menuBar.open('settings')` → click `[data-action="reserved-ctrl"]`; assert `#reserved-ctrl-modal` visible + `getOpenMenu()===null` + `window.__modal.__getStateForTests().openDialogId==='reserved-ctrl-modal'`; assert the body text contains the verbatim substring (incl. `Ctrl+\`); Close + Esc both restore focus to `#terminal-wrapper`; no drop shadow.
  - [x] Regression: full suite (`npm test`) green. Use the codified idioms (boot-race guard, deterministic `window.__menuBar.open`, `force:true` where needed). Do **not** add per-story `--workers=1` — the ratified `retries:1` mask handles the known boot-under-parallelism flakes.

## Dev Notes

### The one-paragraph mental model

Both behaviors already work through the **legacy** `<details id="settings">` pane: `#reset-prefs-button` runs a 2-click confirm in `chrome.js:267-293` calling `resetPrefs()`, and `<details class="reserved">` holds the reserved-Ctrl paragraph. `resetPrefs()` already fans out, and `menu-bar.js`'s `projectPrefs` is **already** the subscriber that re-projects every menu row on reset (E1.3 stood it up; E1.4/E1.5/E2.2/E3.2 filled it). So E3.3 is a **triggering + relocation** story with **zero new state**: (a) give the inert Reset stub row a `data-action` and a dedicated `onItemClick` branch that runs the *same* 2-click confirm against the row's `.lbl` and calls the injected `resetPrefs`; (b) disarm that confirm on every path that hides the Settings dropdown; (c) move the reserved-Ctrl paragraph into a new `openModal`-driven `<dialog>` opened from a new action row, exactly as E2.3 did for Serial Config. The only genuinely-new code is one `reset-prefs` dispatch branch (+ its disarm helper) and one `reserved-ctrl` opener/branch/`<dialog>`.

### ⚠️ The two correctness traps

1. **The Reset row is NOT a normal action item.** A normal `data-action` row `closeMenu()`s immediately (`onItemClick:885-886`). The Reset row must **stay open on the first activation** so the `Click again to confirm (3 s)` prompt is visible, and only `closeMenu()` on the **committing** second activation. Put the branch **before** the generic `if (action) runViewAction(...)` fallthrough so it never leaks into `runViewAction` (which has no `reset-prefs` case and would just `closeMenu()` — killing the confirm). This is a deliberate third menu-item behavior alongside "action closes" / "checkable+radio keep open".
2. **Disarm must cover the menu-switch path, which bypasses `closeMenu()`.** `openMenuNamed:960` sets `openMenu = key` **directly** (it does not route through `closeMenu`), so hooking disarm only into `closeMenu()` would leave a stale `Click again to confirm (3 s)` label (and a live `setTimeout` that reverts a *closed* row) when the user arms Reset then clicks the View title. Wire `disarmResetConfirm()` into **both** `closeMenu()` and `openMenuNamed()`. A leaked timer that fires after close is otherwise harmless (it reverts a hidden row) but re-opening Settings before it fires shows the stale prompt — the observable bug.

### Reset re-projection is ALREADY solved — do not rebuild it (AC-2)

`resetPrefs()` → `subscribe` fan-out → two subscribers registered in `main.js` (`:1276-1277`): `applyPrefs` (canvas + live keyboard setters + legacy pane DOM, single-writer per AD-14) and `menuBar.projectPrefs` (menu DOM only, never a setter). `projectPrefs` (`menu-bar.js:1184-1229`) already re-projects auto-connect, local echo, crlf radio, theme/phosphor/font radios, and re-derives disabled states — idempotent + no-throw, reads prefs at use-time. **This story writes no new projection code.** AC-2 is a *regression assertion* that the existing re-projection fires when the reset is triggered from the menu (it will, because the trigger is `resetPrefs()` regardless of who calls it). The zoom half is a deliberate no-op in `projectPrefs` (zoom has no persistent menu DOM; the reset zoom→status push lives at `applyPrefs`'s `setZoom` site).

### Exact code sites (verified against `c8435bb`)

**`www/index.html`:**
- `:1250-1295` — Settings `menu-group`: `#menu-settings` + `#dropdown-settings`. Local echo `:1259-1262` (E3.2), Enter-key-sends submenu `:1270-1289` (E3.2), `menu-sep` `:1290`, **Reset stub `:1291-1293`** (`data-variant="action"`, **no id, no data-action** — Task 1 adds them). Add the reserved-Ctrl row before the Reset row (Task 3).
- `:1111-1127` — Connection ▸ Serial Configuration… row (`data-variant="action" data-action="serial-config"`) — the copy-this template for the reserved-Ctrl action row.
- **Legacy coexistence (retire in E7):** `<details id="settings">` `:1430`; `#local-echo` `:1436`; `#crlf-*` `:1443-1445`; **`<details class="reserved">` + verbatim paragraph `:1449-1451`** (FR-21 move source); `#auto-connect-checkbox` `:1463`; **`#reset-prefs-button` `:1469`** (FR-22 legacy button; handler is in `chrome.js`, not here).
- Existing `<dialog>` templates: `#serial-config-modal` `:1637+` (E2.3 — the neutral-token modal template + CSS to reuse); `#clear-scrollback-confirm` `:1613` (`<form method="dialog">` closer template); `#send-modal` `:1577`.

**`www/renderer/chrome.js` (read-only reference — the incumbent behavior to replicate, do NOT delete):**
- `:267-293` — the D-35 2-click confirm: `RESET_PREFS_IDLE_LABEL` (`:274`), `RESET_PREFS_CONFIRM_LABEL` (`:275`), `resetPrefsConfirmTimer` (`:276`), the click toggle (`:278-291`), `retainFocus` (`:292`). `resetPrefs` arrives via `wireChrome` opts (`:82`), NOT imported directly by chrome.js — the same AD-3 discipline menu-bar must follow.

**`www/renderer/menu-bar.js` (AD-3: imports ONLY `focus.js`, `state/prefs.js` [`getPrefs`/`savePrefs`], `canvas.js`; `resetPrefs`/`modal` opener arrive via opts):**
- `wireMenuBar(opts)` intake + ref-assignment block (add `resetPrefsRef`, `openReservedCtrlRef`; add the two label constants + `resetPrefsConfirmTimer`).
- `onItemClick` dispatch `:790-887`; existing `data-action` branches: `connect-toggle` `:844`, `choose-microbeast` `:852`, `serial-config` `:861` (**mirror this for `reserved-ctrl`**), `send-file` `:869`, `download-log` `:878`, generic `if (action) runViewAction` fallthrough `:885`. **Insert the `reset-prefs` branch and the `reserved-ctrl` branch before `:885`.**
- `closeMenu()` `:1084-1091` — add `disarmResetConfirm()` at top. `openMenuNamed()` `:960-967` — add `disarmResetConfirm()` at top.
- `wireDropdownItems` `:775-788` (applies `retainFocus` + `onItemClick` to every row automatically — the two new rows are covered). `buildApi` `:1277-1302` (optionally expose the reset-confirm state for tests, e.g. a getter, mirroring `projectConnection`). `__getStateForTests` `:1322`.

**`www/renderer/modal.js` (do not modify — consume as-is):**
- `openModal(dialogEl, {initialFocus, restoreTo}) → Promise<returnValue>` `:61`. returnValue-reset policy header `:30-44`: an info modal is **non-destructive** → default-focus the Close button; Esc/Close resolve `''` and the caller ignores the return. `window.__modal.__getStateForTests()` → `{openCount, lastReturnValue, openDialogId}`.

**`www/main.js`:**
- `:31` `resetPrefs` import (already present). `:32` `subscribe as prefsSubscribe`. `:207-212` `confirmClearScrollback()` + `:228` `openSerialConfig()` (**the template** for `openReservedCtrl`). `:340-397` `wireMenuBar({…})` opts block (inject `resetPrefs` + `openReservedCtrl`). `:309-321` `wireChrome({… resetPrefs …})` (the legacy button's injection — leave it). `:1276-1277` the two `prefsSubscribe` subscribers (`applyPrefs` + `menuBar.projectPrefs`) — leave both. `terminalWrapper` ref (used as `restoreTo`).

**`www/state/prefs.js` (no change — no schema bump):**
- `resetPrefs()` `:157-161` (`cached = structuredClone(DEFAULTS)`, removes the storage key, fires subscribers). `subscribe` `:163` (fires **only** on `resetPrefs`, per AD-4). `CURRENT_VERSION = 1` `:16` — **do not bump**. `savePrefs` does not fan out.

### What must be preserved (non-negotiable — AD-13 / FR-6 / NFR-3 / NFR-4)

- The reset behavior is `resetPrefs()` — a full replace-with-`DEFAULTS` + fan-out. This story only changes *which UI* calls it; the reset semantics, the two subscribers, and the AD-14 single-writer division (applyPrefs owns setters, projectPrefs owns menu DOM) are read-only here.
- The 2-click confirm copy (`Reset all preferences` / `Click again to confirm (3 s)`) and the 3-second window are byte/timing-identical to `chrome.js:274-284`.
- The reserved-Ctrl paragraph is verbatim from `index.html:1451` (AC-5) — including the `Ctrl+\`, `Ctrl+]`, `Ctrl+^`, `Ctrl+_` run.
- Legacy `#reset-prefs-button` + `chrome.js` handler + `<details class="reserved">` keep working through E7; the menu Reset and legacy button Reset are **independent** confirm machines (no armed-state lockstep — only the persisted `resetPrefs()` outcome is shared, and it re-projects both surfaces).
- Focus retention on close (NFR-1/AD-10 "Sacred") via `openModal`'s `restoreTo: terminalWrapper`; the menu rows retain terminal focus on activation (`wireDropdownItems`).
- Boot order (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. No `prefs.js CURRENT_VERSION` bump.

### Reuse — do NOT reinvent

- **The 2-click confirm logic exists verbatim in `chrome.js:267-293`** — replicate its shape (idle/confirm labels + 3s timer + `resetPrefsConfirmTimer === null` gate) against the menu row's `.lbl`. Do not invent a new confirm mechanism. (The one difference: the menu must disarm on close — a pane button has no "close" event.)
- **The action-opens-modal pattern is done (E2.3, `serial-config` branch `:861-865` + `openSerialConfig` `main.js:228`).** The reserved-Ctrl modal is the exact same shape: injected zero-arg opener returning the `openModal` promise, a `closeMenu(); ref?.()` dispatch branch, a neutral-token `<dialog>` reusing `#serial-config-modal` CSS. Copy it.
- **`openModal` + the `<form method="dialog">` closer are done (E0.2 / clear-scrollback / serial-config).** The info modal needs only body copy + Close — the simplest possible consumer of the helper.

### Absent behaviors — deliberately NOT in this story

- **No menu↔pane lockstep for the armed state.** Unlike E2.2 auto-connect / E3.2 local-echo (which mirror a persisted *checkbox* across surfaces during coexistence), the Reset confirm's armed label is **transient UI state**, not a pref — there is nothing to persist or mirror. Each surface runs its own 2-click. Only `resetPrefs()`'s outcome is shared (via `applyPrefs`/`projectPrefs`), so both surfaces show reset *defaults* automatically. Do not add an armed-state mirror.
- **No new projection code for reset.** `projectPrefs` already re-projects on fan-out (AC-2). Do not write a `projectReset` or touch `projectPrefs`.
- **No SLIDE rows / Compatibility mode.** That is E3.4 (`#dropdown-settings` gets no SLIDE content here).
- **No confirm-modal variant for Reset.** The IA brief floated "2-click OR small confirm modal" (`inventory-and-ia-brief.md:74`); the epic AC and PRD FR-22 (`prd.md:395-400`) lock it to **inline 2-click, not a modal**. Do not build a Reset confirm dialog.

### Testing standards + codified idioms (E1 retro action #4 / E2 retro action #1 — still open, re-embedded)

- **Boot-race guard first:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')` (and `typeof window.__modal === 'object'` before driving the modal).
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('settings'))` — never a title `.click()`.
- **Click a row:** `page.click('#dropdown-settings .menu-item[data-action="reset-prefs"]')` / `[data-action="reserved-ctrl"]`.
- **Arm/commit assertions:** after click 1, assert the row's `.lbl` textContent === `'Click again to confirm (3 s)'` and `window.__menuBar.getOpenMenu() === 'settings'`; after click 2, assert `getOpenMenu() === null` and `window.__prefs.getPrefs()` back to defaults.
- **Timer disarm:** the 3s window is real time — either wait it out (`await page.waitForTimeout(3100)`) for the timeout-revert test, or (preferred for the close-path tests) don't wait: arm, then Esc/click-away/switch-title, reopen, assert idle label. Keep the real-timeout test to one case to bound wall-clock.
- **Reset re-projection oracle:** `page.addInitScript(() => localStorage.setItem('beastty.prefs', JSON.stringify({ version:1, localEcho:true, autoConnect:true, crlfMode:'lf', /* … */ })))` before goto, then arm+commit and assert both `getPrefs()` defaults AND the menu glyphs (`#menu-local-echo-item[data-checked]`, the crlf radio, `#auto-connect-checkbox`-mirror) re-projected.
- **Modal idioms (E2.3):** `window.__modal.__getStateForTests().openDialogId === 'reserved-ctrl-modal'`; Close via `#reserved-ctrl-modal form[method=dialog] button` or Esc → assert `document.activeElement.id === 'terminal-wrapper'`; assert no `box-shadow`.
- **retainFocus:** `document.activeElement.id === 'terminal-wrapper'` after each row activation.
- **Projects/run:** render specs → `chromium` project; the flake mask is `chromium-transport` `fullyParallel:false` `retries:1`. `npm test` / `npm run test:fast` (`@fast`). No per-story `--workers=1`.

### Project Structure Notes

- **No new module** — extends `renderer/menu-bar.js` (one dispatch branch + disarm helper for reset; one dispatch branch + opener ref for reserved-Ctrl), injects two opts via `main.js` (`resetPrefs`, `openReservedCtrl`), adds one `<dialog>` + one menu row + `id`/`data-action` on the Reset stub in `index.html`, adds specs. `chrome.js`/`prefs.js`/`modal.js` unmodified.
- **New IDs** kebab-case + `menu-`-prefixed: `#menu-reset-prefs-item` (matches `#menu-local-echo-item`), `#reserved-ctrl-modal` / `#reserved-ctrl-modal-title` (matches `#serial-config-modal`). Named exports only; no default exports; no new deps; no build step (AD-1).
- **DOM order (EXPERIENCE.md `:63-65`):** Browser-reserved Ctrl combinations… **then** Reset All Preferences… last (most-consequential last — matches the legacy pane's "action-scope gradient" comment `index.html:1456`). Place the reserved-Ctrl row before the Reset row.
- **E7 coexistence:** `#reset-prefs-button` (+ its `chrome.js` handler) and `<details class="reserved">` join the E7 dual-chrome retirement checklist (E1 retro action #5 / E2 retro action #4). Leave marker comments. After E3.3 + E3.4, `<details id="settings">` is fully shadowed by the Settings menu and retires wholesale in E7.

### References

- [Source: `epics.md`#Story-E3.3 (lines 466-482)] — user story + the two epic ACs (FR-21 reserved-Ctrl modal; FR-22 inline 2-click reset + idempotent re-projection).
- [Source: `epics.md`#FR-21 (line 52), #FR-22 (line 53)] — verbatim FR text (info modal Ctrl+W/N/T + alternatives; 2-click "Click again to confirm (3 s)" + idempotent re-projection).
- [Source: `.../prds/prd-beastty-2026-07-01/prd.md`#FR-21 (388-393), #FR-22 (395-400)] — reserved-combos modal lists Ctrl+W/N/T + alternatives; reset is inline 2-click **not a modal**, first click arms, second within window resets, timeout disarms.
- [Source: `.../ux-designs/.../EXPERIENCE.md` (lines 63-65, 92, 189-191)] — Settings IA order (reserved-Ctrl small info modal, then Reset inline 2-click "not a modal"); the reserved-combos shortcut table copy.
- [Source: `.../ux-designs/.../DESIGN.md` (lines 192-196)] — modal dialog tokens (chrome-bg/border, rounded/lg, no shadow, scrim-only elevation); "Reset confirm (optionally)" as a modal is **overridden** by FR-22's inline-2-click lock.
- [Source: `.../ux-designs/.../.working/inventory-and-ia-brief.md` (72-74)] — legacy sources: reserved-Ctrl was `<details class="reserved">`; reset was `#reset-prefs-button`; the "2-click OR modal" option (resolved to 2-click by FR-22).
- [Source: `.../architecture/.../ARCHITECTURE-SPINE.md`#AD-3 (80-83), #AD-4 (85-88), #AD-8 (105-108), #AD-9 (110-114), #AD-10 (116-119), #AD-12 (126-129), #AD-14 (136-139)] — import allowlist (`resetPrefs`/modal opener via opts), prefs SSOT + `subscribe` fires only on `resetPrefs`, `openModal` contract, neutral chrome tokens, retainFocus sacred, boot order, reset re-projection single-writer ownership.
- [Source: `www/renderer/chrome.js:267-293`] — the incumbent 2-click confirm to replicate (labels, 3s timer, `resetPrefs()` on second click); `resetPrefs` via `wireChrome` opts (`:82`).
- [Source: `www/renderer/menu-bar.js:790-887` (onItemClick dispatch + `serial-config` template `:861-865`), `:960-967` (openMenuNamed — bypasses closeMenu), `:1084-1091` (closeMenu), `:775-788` (wireDropdownItems retainFocus), `:1184-1229` (projectPrefs reset re-projection — already implemented), `:1277-1302` (buildApi), `:1322` (__getStateForTests)].
- [Source: `www/renderer/modal.js:9-44` (contract + returnValue policy — non-destructive info modal default-focuses Close), `:61-125` (impl + test hooks)].
- [Source: `www/main.js:31` (resetPrefs import), `:207-228` (confirmClearScrollback/openSerialConfig opener templates), `:309-321` (wireChrome resetPrefs injection), `:340-397` (wireMenuBar opts — inject resetPrefs + openReservedCtrl), `:1276-1277` (the two prefsSubscribe subscribers)].
- [Source: `www/state/prefs.js:16` (CURRENT_VERSION no-bump), `:157-161` (resetPrefs replace+fanout), `:163` (subscribe fires only on reset)].
- [Source: `www/index.html:1291-1293` (Reset stub row), `1449-1451` (verbatim reserved-Ctrl paragraph — FR-21 move source), `1469` (legacy #reset-prefs-button), `1111-1127` (serial-config action-row template), `1637+` (#serial-config-modal template + CSS to reuse), `1613` (clear-scrollback `<form method="dialog">` closer)].
- [Source: `_bmad-output/.../e2-3-serial-configuration-modal.md`] — the action-row→injected-`openModal`-opener pattern (the exact FR-21 template) + neutral-token modal CSS + focus-round-trip test idioms.
- [Source: `_bmad-output/.../e3-1-file-menu-send-file-download-session-log.md`, `e3-2-settings-menu-local-echo-enter-key-sends.md`] — the two prior Settings/File relocation stories; injected-opt discipline; `#dropdown-settings` current markup; open action items honored.

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **Close the menu after a confirmed reset?** **Recommended default:** yes — on the committing (second) activation, run `resetPrefs()` then `closeMenu()` (action complete → action semantics; the disarm-on-close reverts the label, and `projectPrefs` re-projects the now-visible-on-reopen defaults). Rejected: keep the menu open showing re-projected defaults (novel behavior for a committed action; the incumbent pane button has no menu to keep open, so there's no precedent to preserve). One-line change if Ant prefers keep-open.
2. **`resetPrefs` via opts vs direct import.** `menu-bar.js` already imports `getPrefs`/`savePrefs` from `prefs.js`, so importing `resetPrefs` from the same module would "work". **Recommended default:** inject via `wireMenuBar` opts anyway — `ARCHITECTURE-SPINE.md:83` explicitly lists `resetPrefs` among the opts-injected set (contrast the direct `getPrefs`/`savePrefs`), and `wireChrome` already receives it this way (`main.js:321`). Keeps the reset *trigger* explicit at the composition root. Rejected: direct import (violates the documented AD-3 split for no gain).
3. **Grouping / separators for the two new-ish rows.** The Settings dropdown currently has one `menu-sep` before Reset. **Recommended default:** place `Browser-reserved Ctrl combinations…` after that existing `menu-sep`, with `Reset all preferences` last (so the block reads: Local echo · Enter-key-sends ▸ | reserved-Ctrl · Reset). Optionally add a second `menu-sep` before Reset to set the destructive action apart. Rejected: no separators (reset sits flush against the info row — less clear the two differ in consequence). Cosmetic; dev's call within this default.
4. **Reserved-Ctrl modal title text.** The legacy `<summary>` reads `Browser-reserved Ctrl combinations` (no `…`); the menu row carries the `…`. **Recommended default:** modal `<h2>` = `Browser-reserved Ctrl combinations` (no ellipsis — the `…` belongs on the *trigger*, matching Serial Configuration… → "Serial Configuration"). One-line change if Ant wants the ellipsis in the title.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code dev-story workflow)

### Debug Log References

- One regression from the relocation: `menu-bar.spec.js:141` (E1.1) clicked `#dropdown-settings .menu-item[data-variant="action"]` expecting a plain action-closes row. E3.3 added a second action row (reserved-Ctrl) and changed Reset to a stay-open 2-click confirm, so that locator became ambiguous / no longer closes on first click. Repointed the assertion at `[data-action="reserved-ctrl"]` (the genuine action-closes row now). No product-code change.

### Completion Notes List

- **FR-22 (Reset All Preferences)** — the inert Settings ▸ Reset stub row now runs an inline 2-click confirm (a THIRD menu-item behaviour) against its own `.lbl`, replicating the legacy `chrome.js:278-291` D-35 machine verbatim (same two labels, same 3s window) and committing the injected `resetPrefs()` on the second activation. First activation keeps the menu open; second closes it (action semantics). `disarmResetConfirm()` clears the confirm on **every** Settings-dropdown-hide path — wired into `closeMenu()` (Esc / click-away / post-action), `openMenuNamed()` (keyboard ←/→ switch), and `toggleMenu()` (title-click switch — the real click path; the story called out `openMenuNamed`, but a title click routes through `toggleMenu`, which likewise bypasses `closeMenu`, so both are hooked). No leaked timer re-labels a closed row.
- **FR-21 (Reserved-Ctrl info)** — the verbatim reserved-Ctrl paragraph relocated from `<details class="reserved">` into a new `openModal`-driven `<dialog id="reserved-ctrl-modal">`, opened from a new Settings ▸ Browser-reserved Ctrl combinations… action row (mirrors E2.3's serial-config injected-opener pattern). Non-destructive info modal → initialFocus = Close; restoreTo = terminalWrapper. Styled on neutral `--chrome-*` tokens (compact subset of the `#serial-config-modal` CSS — no shadow, 8px corner, `:not([open])` guard).
- **AC-2 reset re-projection** — confirmed the existing `projectPrefs` subscriber re-projects Local echo / auto-connect / crlf menu DOM when the reset is triggered from the menu; no new projection code (verified by test, not rebuilt).
- **AD-3 discipline** — `menu-bar.js` imports neither `prefs.resetPrefs` nor `modal.js`; both arrive via `wireMenuBar` opts. No `prefs.js` schema change / no `CURRENT_VERSION` bump.
- **Coexistence** — legacy `#reset-prefs-button` + `chrome.js:267-293` and `<details class="reserved">` left functional with E7-retirement markers; the two Reset confirm machines are independent (no armed-state mirror). The legacy button's own confirm/timeout test (`prefs.spec.js:208`) still passes.
- **Q1–Q4 flagged questions** — took all four recommended defaults: (Q1) commit closes the menu; (Q2) `resetPrefs` via opts; (Q3) reserved-Ctrl after the existing `menu-sep`, plus a second `menu-sep` before Reset; (Q4) modal `<h2>` = "Browser-reserved Ctrl combinations" (no ellipsis).
- **Tests** — 16 new specs across two files, all green; full suite 289 passed / 0 failed / 1 skipped (pre-existing). The 3 View-Font flakes seen on the first run are the known boot-under-parallelism flakes masked by `retries:1` (passed clean on re-run); no per-story `--workers=1`.

### File List

- `www/index.html` — Reset row `id`/`data-action`; new reserved-Ctrl action row + `menu-sep`; new `#reserved-ctrl-modal` `<dialog>` + CSS block; E7-retirement markers on legacy `<details class="reserved">` + `#reset-prefs-button`.
- `www/renderer/menu-bar.js` — `resetPrefsRef`/`openReservedCtrlRef` opts + label constants + `resetPrefsConfirmTimer`; `reset-prefs` + `reserved-ctrl` `onItemClick` branches; `disarmResetConfirm()` helper wired into `closeMenu()`/`openMenuNamed()`/`toggleMenu()`.
- `www/main.js` — `openReservedCtrl()` opener; injected `resetPrefs` + `openReservedCtrl` into `wireMenuBar` opts.
- `www/tests/render/menu-bar-settings-reset.spec.js` — new (FR-22 arm/commit/disarm-on-every-path/re-projection/retainFocus).
- `www/tests/render/reserved-ctrl-modal.spec.js` — new (FR-21 open/close/focus/verbatim/styling).
- `www/tests/render/menu-bar.spec.js` — updated one E1.1 assertion to target the reserved-Ctrl action row (Reset is no longer a plain action-closes row).
- `www/state/prefs.js` — (review fix #3) exported `RESET_PREFS_IDLE_LABEL` / `RESET_PREFS_CONFIRM_LABEL` (single-sourced reset-confirm labels).
- `www/renderer/chrome.js` — (review fix #3) imports the two label constants from prefs.js instead of re-declaring them.

### Code Review

<!-- E2 retro action #2: record review outcome here — e.g. "N findings, fixed in <sha>". -->
Reviewed 2026-07-03 (high-effort, 8 finder angles + verify). **4 findings, all fixed** in the working tree:
1. **[correctness, low]** Armed reset-confirm state (`resetPrefsConfirmTimer` + mutated `.lbl`) was cleared on the three dropdown-hide paths but not at lifecycle boundaries — a `wireMenuBar()` re-wire while armed (within 3s) could leave the module armed so the next single Reset click commits `resetPrefs()` without the 2-click confirm; leaked timer mutated a torn-down row. Not reachable in the single-wire shipping config, but a real invariant hole + test-isolation leak. Fixed: `disarmResetConfirm()` now runs in the `wireMenuBar` re-init block, `dispose()`, and `__resetForTests()`.
2. **[cleanup]** `#reserved-ctrl-modal` CSS duplicated ~9 rule blocks from `#serial-config-modal`. Fixed: hoisted the shared neutral-modal chrome to a `.chrome-modal` class on both `<dialog>`s; per-modal `#id` blocks keep only `max-width` (+ serial-config's form-control rules). `#send-modal` (which has a shadow / different tokens) deliberately left out of the shared class.
3. **[cleanup]** `RESET_PREFS_*_LABEL` were duplicated verbatim in `chrome.js` and `menu-bar.js`. Fixed: single-sourced as exports from `prefs.js` (the reset SSOT), imported by both.
4. **[cleanup]** Reset row DOM wasn't cached like sibling projected rows. Fixed: cached `resetPrefsItemEl` at wire time; `disarmResetConfirm()`/arm read the cached ref.

Two angle-B extras (legacy-button↔menu cross-disarm; staying armed while toggling other Settings rows) were **refuted** — `resetPrefs()` is idempotent (a stray re-trigger is harmless) and both are documented as intended. Conventions angle: no CLAUDE.md/AD-3 violations. Full suite green after fixes (284 passed / 0 failed / 1 skipped; reset spec 24/24 in isolation).

### Change Log

- 2026-07-03 — E3.3 story created (ready-for-dev): Settings ▸ Reset All Preferences (FR-22, inline 2-click confirm triggering injected `resetPrefs`, disarm on every close path) + Browser-reserved Ctrl combinations… (FR-21, verbatim copy relocated into an `openModal`-driven `<dialog>`). Reset re-projection reuses the existing `projectPrefs` subscriber (already implemented). 4 flagged questions with recommended defaults.
- 2026-07-03 — E3.3 implemented (→ review): wired the Reset row's inline 2-click confirm to injected `resetPrefs` with `disarmResetConfirm()` on all three hide paths (closeMenu / openMenuNamed / toggleMenu); relocated the reserved-Ctrl paragraph into `#reserved-ctrl-modal` (injected `openReservedCtrl` opener + new Settings action row). Took all four Q defaults. 16 new specs; full suite 289 passed / 0 failed / 1 skipped. Updated one E1.1 test (`menu-bar.spec.js`) whose Settings action-row locator the relocation made ambiguous.
- 2026-07-03 — Code-review fixes (4 findings, all resolved): (1) clear the armed reset-confirm at lifecycle boundaries (`wireMenuBar` re-init + `dispose()` + `__resetForTests()`) so a re-wire-while-armed can't commit `resetPrefs()` on a single click / leak a timer; (2) hoist shared modal chrome to a `.chrome-modal` class (de-dup `#reserved-ctrl-modal` vs `#serial-config-modal` CSS); (3) single-source `RESET_PREFS_*_LABEL` from `prefs.js`; (4) cache `resetPrefsItemEl` at wire time. Touches `prefs.js` + `chrome.js` in addition to the E3.3 files. Full suite green (284 passed / 0 failed / 1 skipped; reset spec 24/24 in isolation).
