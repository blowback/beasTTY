---
baseline_commit: f46288685440b7ae6c5e16688d9939f2a6941918
---

# Story E3.4: SLIDE File Transfer modal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want a SLIDE File Transfer modal for receive-to-folder, auto-send, and confirmation settings,
so that I control transfer behavior without a hanging pane — and understand which chip states my choices trigger.

**Covers:** FR-20 (SLIDE File Transfer modal); UX-DR12 (SLIDE chip 10-state lifecycle — *referenced, unchanged*), UX-DR10 (verbatim microcopy), UX-DR11 (a11y floor). **Epic:** E3 · File, Settings & Transfer Configuration. **Depends on:** E0 (`openModal`, `retainFocus` — done), E1 (menu-bar shell + `chrome.js` decomposition — done), E3.1/E3.2/E3.3 (File & Settings menus — done). Governed by **AD-8, AD-4, AD-5, AD-3, AD-1, AD-9, AD-2, AD-10** (ARCHITECTURE-SPINE.md).

**Premise (epic-wide, confirmed — same as E2.3/E3.1/E3.2/E3.3):** this is a **relocation** story, not a build-from-scratch. Every SLIDE-transfer control, its `<option>` set, its verbatim copy, its persist/apply behavior, its validation cue, and the folder-chooser flow **already exist and work today** inside the legacy nested `<details class="reserved" id="settings-slide">` pane (`index.html:1600–1663`), wired by inline handlers in `main.js` (`:795–892`, `:1282`) and by `wireSlideRecv()` (`main.js:760–779` → `transport/slide-recv.js`). E3.4 **moves that exact control set into a new `openModal`-driven `<dialog id="slide-config-modal">`**, re-styled onto the neutral `--chrome-*` token system with the clean aligned-row look, opened from a **new** "SLIDE File Transfer…" item in the Settings menu. **No change to the SLIDE state machine (`slide.js`), the chip lifecycle (`slide-chip.js`), the recv module (`slide-recv.js`), the prefs schema, the auto-send wire-safety gate, or the verbatim copy.**

**Relocation strategy — MOVE, do not duplicate (recommended default; flagged Q1).** Every SLIDE control is reached by element **id** (`getElementById('slide-auto-send-input')`, `slide-show-summary`, `slide-confirm-transfers-checkbox`, `slide-compat-select`, and the five `wireSlideRecv` refs). The cleanest, single-source approach is to **move the same-id elements** out of the `<details>` pane and into the `<dialog>`. The refs still resolve (ids unchanged) → **near-zero JS change**, **one** home for SLIDE config (no dual-chrome, no lockstep mirror). This is exactly what E1-retro action #5 ("dual-chrome is never shipped mid-migration") wants, and what E2.3 chose. The `<dialog>` is in the DOM at boot even while closed, so boot-time `getElementById`, the boot-hydration listeners, `wireSlideRecv`, and the `applyPrefs` reset mirror all keep working. See Dev Notes §"Relocation strategy".

## Acceptance Criteria

Epic ACs (`epics.md` §Story E3.4, lines 492–501) decomposed and made testable. AC-1/AC-9 are the epic's two ACs; AC-2…AC-8 make the implicit "every control/copy/pref-key/gate is preserved verbatim, the folder-chooser + validation cue survive the move, focus round-trips, no regressions" requirements falsifiable.

**AC-1 — The modal opens from the Settings menu via `openModal`, menu closes, focus round-trips (FR-20, AD-8, AD-3).**
Given the Settings menu is open,
When the user activates a **new** "SLIDE File Transfer…" item (`#menu-slide-config-item`, `data-action="slide-config"`),
Then the dropdown **closes** (`window.__menuBar.getOpenMenu() === null`) and `<dialog id="slide-config-modal">` opens via the shared `openModal(dialogEl, {initialFocus, restoreTo})` helper (top-layer `showModal()`, native scrim + focus-trap); and on close (Close button **or** Esc) focus is restored to `#terminal-wrapper` per the helper's `restoreTo`. The opener is injected into `wireMenuBar` opts (AD-3 — menu-bar must **not** import `modal.js`/`slide*.js`), mirroring E3.3's `openReservedCtrl` and E2.3's `openSerialConfig`.

**AC-2 — The modal hosts the Save-received-files-to-folder row verbatim, and the folder chooser still works (FR-20, UX-DR10).**
Given the open modal,
Then it exposes `#slide-recv-folder-row` containing `#slide-recv-to-folder-checkbox` (label "Save received files to a folder", with its verbatim `title="When enabled, files received via SLIDE land in a folder you pick…"`), `#slide-recv-folder-button` ("Choose folder…", `title="Toggle the checkbox first"`), `#slide-recv-folder-status` ("No folder selected" default), and `#slide-recv-folder-help` ("Received files land in your Downloads folder. Toggle this to pick a fixed destination.") — **same ids, same copy** as `index.html:1605–1618`. `wireSlideRecv`'s injected refs (`rowEl/toggleEl/folderButtonEl/statusEl/helpEl`, `main.js:768–772`) resolve after the move; toggling the checkbox enables the button and `showDirectoryPicker` (`slide-recv.js:268–286`) is reachable (behavior unchanged, verified by `slide-recv-settings.spec.js`).

**AC-3 — The Auto-send command row + its validation cue move verbatim and stay wired (FR-20, UX-DR10).**
Given the open modal,
Then it exposes `#slide-auto-send-row` with label "Auto-send command:", `#slide-auto-send-input` (`value="B:SLIDE R"`, `autocomplete="off" spellcheck="false"`), the static hint `\r appended automatically`, and the hidden validation hint `#slide-auto-send-validation-hint` ("Auto-send command unsafe — disabled.", `hidden`) — **same ids, same copy** as `index.html:1623–1633`. The boot-hydration + `change` handler in `main.js:800–860` (strips/re-adds trailing `\r`, sets `data-invalid`/`aria-invalid`, toggles the validation hint via `isAutoSendSafe`, re-arms `slideAutoSendCommandConfirmed`) keeps working unchanged after the move (same ids).

**AC-4 — The Show-summary and Confirm-transfers toggles move verbatim, with defaults preserved (FR-20).**
Given the open modal,
Then it exposes `#slide-show-summary` (checkbox, default **checked**, label "Show transfer summary chip", `index.html:1638–1639`) and `#slide-confirm-transfers-checkbox` (checkbox, default **checked**, label "Confirm file transfers", plus its verbatim help "When off, drops and picker selections begin transferring immediately. Filename collisions are auto-renamed.", `index.html:1648–1651`). Their boot-hydration + `change→savePrefs` handlers (`main.js:863–880`) and the `applyPrefs` reset mirror for `slideConfirmTransfers` (`main.js:1282–1283`) keep working (same ids).

**AC-5 — The Compatibility-mode select moves verbatim with its exact option set (FR-20).**
Given the open modal,
Then it exposes `#slide-compat-select` (label "Compatibility mode:") with `<option>`s **verbatim**: `auto`→"Auto", `wakeup-required`→"Wakeup-required", `force-start`→"Force-start (legacy slide.com)" (`index.html:1655–1661`). Its boot-hydration + `change` handler (`main.js:882–892`, which also restores terminal focus on change) keeps working (same id, same `<option value>`s).

**AC-6 — The prefs the modal writes gate the *unchanged* SLIDE chip lifecycle (FR-20, UX-DR12, AD-5).**
Given the modal edits **preferences only** (via `savePrefs`), never SLIDE lifecycle state,
Then the pref→state gating remains exactly as today: `slideShowSummary` gates `sent-summary`/`received-summary` chip states (`slide-chip.js enterSummary` bails when false); `slideCompatibilityMode` governs the wakeup-timeout (`auto`→3s `awaiting-timeout` arms; `wakeup-required`/`force-start`→no timer, dispatcher-computed `armTimer`); `slideConfirmTransfers` gates the `first-use-confirm` path in `input/file-source.js`; `slideAutoSendCommand` (+`…Confirmed`) drives `first-use-confirm`. **The chip's 10 states and `slide-chip.js`/`slide.js` are NOT modified** — only which fire, gated by these prefs (specified in EXPERIENCE.md #State Patterns). No behavior of the chip changes as a result of this story.

**AC-7 — Neutral-shell styling + clean aligned-row look + modal-appropriate focus + aria-live (NFR-2/AD-9, UX-DR5/6, NFR-1/AD-10).**
Given the modal markup,
Then its `<dialog>` carries `class="chrome-modal"` (reusing the shared E3.3 chrome, `index.html:925–1000`), adds only its own `max-width`/`.field` form-control rules, uses **only** `var(--chrome-*)` tokens (no phosphor/`[data-theme]` branch, no legacy `2px 4px` pane padding), **no drop shadow** (native scrim is the only elevation — asserted), rows laid out as `.field` (label-left/control-right) + `.field.check` (checkbox-before-label) matching the Serial Config modal's clean aligned-row look. It has an `aria-live="polite"` status region (the `#slide-recv-folder-status` folder-status line is the natural live target — it carries genuine dynamic status). Controls inside the focus-trapped modal do **not** restore focus-to-terminal on `change` (that fights the trap — but the *existing* `slideCompatSelect` change-handler terminal-restore must be reviewed, see Task 5 / Q3); focus returns to `#terminal-wrapper` only on close via `restoreTo`. `[data-focused]` (not `:focus-visible`) drives any chrome highlight.

**AC-8 — Footer = Close; no destructive/reset button; `initialFocus` set (FR-20; Q2/Q4 defaults).**
Given the modal footer,
Then it contains a "Close" affordance (`<form method="dialog"><button id="slide-config-close" value="close">Close</button></form>`, resolves `''`, caller ignores); Esc also closes. **No "Reset to defaults" button** for this story (the epic AC names only the field set; SLIDE has no preset-reset analog — flagged Q2). `initialFocus` = `#slide-recv-to-folder-checkbox` (first form control, mirrors E2.3's first-select focus) **or** the Close button — both compliant; the modal is non-destructive so the returnValue-reset policy (`modal.js:30–44`) does not force a Cancel default. `restoreTo` = `#terminal-wrapper`.

**AC-9 — Legacy `#settings-slide` sub-pane retired to the modal; no incumbent behavior lost; suite green (FR-6, NFR-3, NFR-4, AD-12).**
Given the move,
Then the nested `<details id="settings-slide">` sub-block (+ its preceding `<hr class="settings-divider">`) no longer hosts the moved controls; because *all* five rows move (nothing stays behind, unlike E2.3's `#port-status`), the now-empty `#settings-slide` sub-details + its `<hr>` are **removed** (flagged Q5 — recommended). The parent `<details id="settings">` pane (local-echo, CRLF radios) remains a thin vestige until E7. Exactly **one** set of SLIDE controls exists (no dual-chrome, no dual-state — NFR-4). No `prefs.js` schema change / no `CURRENT_VERSION` bump. Boot order untouched (`wireMenuBar` before `wireKeyboard`; polite-fail first). The full Playwright chromium suite passes (`npm test`), including every SLIDE spec (`transport/slide-*.spec.js`) and the two specs that referenced the old pane locations (`transport/slide-prefs.spec.js`, `transport/slide-recv-settings.spec.js`) — **update, don't delete coverage** (repoint them to open the modal via the menu instead of expanding the `<details>`).

## Tasks / Subtasks

- [x] **Task 1 — Add the `<dialog id="slide-config-modal">` markup, moving the controls verbatim (AC-1..AC-5, AC-7, AC-8).**
  - [x] Add a new `<dialog id="slide-config-modal" class="chrome-modal" aria-labelledby="slide-config-modal-title">` beside `#reserved-ctrl-modal` (end of body, `index.html:~1862`), with `<header><h2 id="slide-config-modal-title">SLIDE File Transfer</h2></header>` (no trailing `…` on the heading), a `<div class="modal-body">`, and a `<footer>`.
  - [x] **Move** (cut from `<details id="settings-slide">`, paste into the dialog body, in DOM order) the five rows: `#slide-recv-folder-row` (checkbox + Choose-folder button + status + help), `#slide-auto-send-row` (label + input + static hint + hidden validation hint), `#slide-show-summary-row`, `#slide-confirm-transfers-row` (+ help), `#slide-compat-row` (label + select). Every **id**, `<option value>`, `title=`, and copy string is byte-for-byte identical (locked by AC-2..AC-5 spec assertions — including `value="B:SLIDE R"`, "Force-start (legacy slide.com)", "\r appended automatically", "Auto-send command unsafe — disabled.").
  - [x] Re-layout each row as a `.field` / `.field.check` aligned row (label-left/control-right; checkbox-before-label) to match the Serial Config clean look — the row **wrappers'** classes/structure may change, but the **inner control ids + copy do not**. Keep `#slide-auto-send-validation-hint` as a live-toggled element (still `hidden` by default; `main.js`/`slide.js` toggle it).
  - [x] Footer: Close only — `<form method="dialog"><button id="slide-config-close" value="close">Close</button></form>`. **No Reset button** (Q2 default taken).
  - [x] `aria-live="polite"` on the folder-status region (`#slide-recv-folder-status`) — it doubles as the modal's dynamic status.
  - [x] Remove the now-empty `<details id="settings-slide">` and its preceding `<hr class="settings-divider">` (Q5 default). Leave `<details id="settings">` parent as-is (E7).

- [x] **Task 2 — Add the "SLIDE File Transfer…" Settings menu item (AC-1).**
  - [x] In `#dropdown-settings` (`index.html:1337–1398`), add `<button id="menu-slide-config-item" class="menu-item" type="button" role="menuitem" data-variant="action" data-action="slide-config">` with `<span class="check"></span><span class="lbl">SLIDE File Transfer…</span>` (trailing `…` on the row label; **no** `▸` caret — that is reserved for radio submenus). Place it after "Enter key sends" and before "Browser-reserved Ctrl combinations…" (EXPERIENCE.md order: transfer config with the other settings; info/reset stay last). Confirm placement with the E3.3 rows.
  - [x] `wireDropdownItems` auto-applies `retainFocus` + `onItemClick` to the new row (no per-row wiring needed).

- [x] **Task 3 — Style the dialog on neutral `--chrome-*` tokens + `.field` rows (AC-7; NFR-2/AD-9).**
  - [x] Reuse the shared `.chrome-modal` class (E3.3 review fix #2 — hoisted chrome). Add **only** `#slide-config-modal`-specific rules: `max-width` (~90ch) and any `.field`/`.field.check` form-control rules not already shared (mirror the Serial Config modal's field CSS; single-source shared rules where possible per E3.3 review fix #2). **No `box-shadow`** (scrim-only elevation — asserted). Inputs/select on `field-bg` `rounded/sm` (4px), buttons `rounded/md` (6px), dialog `rounded/lg` (8px).
  - [x] Remove now-dead `#settings-slide` CSS that only styled the moved sub-block (`index.html:358–374` `#settings-slide` form-control rules; recv-folder inline action-row rules `:465–478` if not shared; keep the SLIDE-38 `.validation-hint`/`[data-invalid]` rules `:868–902` — they are id/attribute selectors that still apply inside the modal; verify they don't depend on a `#settings-slide` ancestor selector, and if they do, re-scope to `#slide-config-modal`).

- [x] **Task 4 — Wire the menu item → `openSlideConfig()` opener (AC-1; AD-3, AD-8).**
  - [x] `main.js`: define `openSlideConfig()` next to `openReservedCtrl` (`:244`) — grab `#slide-config-modal`, return `openModal(el, { initialFocus: #slide-recv-to-folder-checkbox, restoreTo: terminalWrapper })`, null-guarded (`if (!el) return Promise.resolve('')`).
  - [x] Inject `openSlideConfig` into the `wireMenuBar({...})` opts block (alongside `openSerialConfig`, `openReservedCtrl`, `confirmClearScrollback`).
  - [x] `menu-bar.js`: add an `openSlideConfigRef` module ref (beside `openSerialConfigRef`/`openReservedCtrlRef`), assign it null-guarded from `opts.openSlideConfig` in the wire pass, and add a dedicated `action === 'slide-config'` branch in `onItemClick` (`closeMenu(); openSlideConfigRef?.(); return;`) **before** the generic `runViewAction` fallthrough — mirror the `serial-config` (`:897`) and `reserved-ctrl` (`:922`) branches. **Do not** route through `runViewAction`.

- [x] **Task 5 — Preserve focus/wiring semantics after the move (AC-6, AC-7, AC-9; NFR-1/AD-10 nuance).**
  - [x] Verify all boot-time `getElementById` refs (`main.js:755–759` recv row; `:795–798` auto-send/show-summary/confirm/compat) and the `applyPrefs` reset mirror (`:1270–1283`) still resolve after the move (elements are in the DOM at boot even while `<dialog>` is closed). No code change expected — assert by test.
  - [x] **Review the `slideCompatSelect` change-handler terminal-restore (`main.js:882–892`)**: inside a focus-trapped modal, restoring focus to the terminal on `change` fights the trap (E2.3 dropped an in-modal `retainFocus` for exactly this reason). Recommended default (Q3): drop/neuter the in-modal terminal-restore for the compat select while the control lives in the modal; the `change→savePrefs` write is unchanged. Keep the `<select>` covered by `retainFocus` semantics only insofar as the trap + `restoreTo`-on-close own focus. Document the decision in-code.
  - [x] Confirm `wireSlideRecv`'s own focus retention on the folder button (`main.js:749–751` note — `mousedown preventDefault` retained inside `wireSlideRecv`) is harmless inside the modal (as the serial Reset button was) — leave it, document.

- [x] **Task 6 — Tests (AC-1…AC-9).**
  - [x] New spec `www/tests/render/slide-config-modal.spec.js` (chromium project) — open via `window.__menuBar.open('settings')` → click `#dropdown-settings .menu-item[data-action="slide-config"]`; assert `toBeVisible()`, `getOpenMenu()===null`, `window.__modal.__getStateForTests().openDialogId === 'slide-config-modal'`, focus round-trip on Close/Esc (`document.activeElement.id === 'terminal-wrapper'`), all five rows present with verbatim ids/copy/option-set, initial focus, no drop shadow (computed `box-shadow`), aria-live region, no Reset button, `#settings-slide` removed (one-surface assertion).
  - [x] **Update** `www/tests/transport/slide-prefs.spec.js` and `www/tests/transport/slide-recv-settings.spec.js`: they currently reach the controls by expanding `<details id="settings-slide">`; repoint them to open the modal via the menu (or via `window.__menuBar.open('settings')` + the action row) before interacting. Do **not** delete coverage. Confirm `slide-chip.spec.js`, `slide-confirm-pref.spec.js`, `slide-autosend-safety.spec.js`, `slide-compatibility.spec.js`, `slide-wakeup.spec.js` still pass unchanged (they drive prefs/state, not the pane DOM — but grep each for `#settings-slide`/`settings-slide` and repoint if any reference the pane).
  - [x] Regression: full suite `npm test` (both `chromium` + `chromium-transport` projects). Do **not** add per-story `--workers=1`; rely on the ratified `chromium-transport` (`fullyParallel:false`, `retries:1`) mask for the known wasm-boot flakes — note any as pre-existing.

## Dev Notes

### The one-paragraph mental model

Everything the *behavior* needs already exists and is wired **by element id**: the auto-send input's boot-hydration + `change` handler + SLIDE-38 validation cue (`main.js:800–860`), the show-summary / confirm-transfers checkboxes (`:863–880`) with the `applyPrefs` reset mirror (`:1282`), the compat select (`:882–892`), and the Save-to-folder row driven by `wireSlideRecv` (`:760–779` → `transport/slide-recv.js`, folder chooser `showDirectoryPicker`). The prefs these write are read **lazily** by `slide-chip.js` (via a live `prefsRef`) and by `slide.js`/`file-source.js` to gate the *unchanged* 10-state chip lifecycle. E3.4 **relocates the same-id DOM elements** from the nested `<details id="settings-slide">` pane into a new `openModal`-driven `<dialog>`, re-styled onto neutral chrome tokens with the clean aligned-row look, opened from a new "SLIDE File Transfer…" Settings item. Because the ids don't change, every `getElementById` ref, boot listener, `wireSlideRecv` ref, and reset mirror keeps resolving — the *only* code changes are: (a) menu wiring (`openSlideConfig` opt + `slide-config` dispatch branch), and (b) reviewing the compat-select in-modal terminal-restore (fights the focus trap). Same "menu-bar is a projector fed by injected opts; slide reached only via opts" shape as E2.3/E3.3.

### Relocation strategy — MOVE (chosen), not duplicate+mirror (rejected) — Q1

- **Chosen (recommended): MOVE the same-id controls into the `<dialog>`.** All SLIDE controls are reached by a single id-keyed ref set (inline `getElementById` in `main.js` + injected `wireSlideRecv` refs). Moving the elements (ids intact) means those refs resolve unchanged → near-zero JS change, **one** source of truth (NFR-4), **no dual-chrome** (E1-retro action #5). The `<dialog>` is in the DOM at boot even while closed, so boot-time hydration + `applyPrefs` `.checked`/`.value` sets + `wireSlideRecv` wiring all work.
- **Rejected: duplicate + two-way mirror.** Duplicating 3 checkboxes + 1 input + 1 select + the folder row, with the inline handlers still reading the *legacy* set, forces modal↔pane mirroring on every change + a second folder-chooser wiring. Fragile dual-state (violates NFR-4) and literally ships dual-chrome. Only choose this if Ant wants the legacy `#settings-slide` pane to stay fully functional until E7 (see Q1) — not recommended.

### Exact code sites (verified against `f462886`)

**`www/index.html`** (1881 lines):
- Move source — nested `<details class="reserved" id="settings-slide">`: `:1600–1663` (preceded by `<hr class="settings-divider">` `:1600`). Rows: recv-folder `:1605–1618`; auto-send `:1623–1633`; show-summary `:1636–1640`; confirm-transfers `:1646–1652`; compat `:1655–1662`.
- Settings dropdown `#dropdown-settings`: `:1337–1398` (local-echo `:1344`; enter-key-sends submenu; reserved-ctrl row `:1383`; reset-prefs row `:1394`). Add the new `#menu-slide-config-item` row here.
- Existing modal templates to copy: `#serial-config-modal` `:1759–1851` (the clean aligned-row analog), `#reserved-ctrl-modal` `:1862+` (closest opener analog). Shared `.chrome-modal` CSS: `:925–1000`. `#reserved-ctrl-modal` specifics: `:1137–1141`. SLIDE-38 validation CSS: `:868–902`; `#settings-slide` form-control CSS `:358–374`; recv-folder action-row CSS `:465–478`.

**`www/main.js`** (1311 lines):
- Openers: `confirmClearScrollback` `:207`, `openSerialConfig` `:228`, `openReservedCtrl` `:244` (the analog — grabs modal el, `openModal(el,{initialFocus,restoreTo})`, null-guarded). Add `openSlideConfig` next to these.
- `wireMenuBar` opts block: inject `openSlideConfig` alongside `openSerialConfig`/`openReservedCtrl`.
- SLIDE recv refs + `wireSlideRecv`: `:755–779`. Inline SLIDE settings wiring: auto-send `:795`/`:800–860`, show-summary `:796`/`:863–868`, confirm-transfers `:797`/`:875–880`, compat `:798`/`:882–892`. `applyPrefs` SLIDE reset mirror: `:1282–1283` (confirm-transfers). `prefsSubscribe(applyPrefs)` + `applyPrefs(prefs)` at boot: `:1298–1300`.
- Test hooks: `window.__menuBar` `:424`, `window.__slide` `:919`, `window.__slideRecv`, `window.__modal` (from `modal.js`), `window.__prefs` `:46`.

**`www/renderer/modal.js`** (consume as-is): `openModal(dialogEl, {initialFocus, restoreTo}) → Promise<returnValue>` `:61`; returnValue-reset policy header `:30–44`; `__getStateForTests()` → `{openCount, lastReturnValue, openDialogId}` `:113–125`.

**`www/renderer/menu-bar.js`** (AD-3: may import only `focus.js`, `state/prefs.js`, `canvas.js`; slide/modal via opts): dispatch branches — `serial-config` `:897`, `reserved-ctrl` `:922`, `reset-prefs` `:937`. Add `slide-config` branch beside them. `wireDropdownItems` auto-applies `retainFocus` + `onItemClick`.

**`www/state/prefs.js`** (NOT under renderer/): pref keys + defaults — `slideRecvToFolder:false`, `slideAutoSendCommand:'B:SLIDE R\r'` (trailing real `\r`), `slideShowSummary:true`, `slideCompatibilityMode:'auto'`, `slideAutoSendCommandConfirmed:''`, `slideConfirmTransfers:true`. Directory handle lives in IndexedDB (`state/idb.js`), stripped from the blob (`IDB_ONLY_FIELDS`). `isAutoSendSafe(cmd)` (regex `/^[A-Za-z0-9: ]*\r$/`) — visual cue only; real wire-safety gate is `slide.js readAutoSendCommandBytes`. **No `CURRENT_VERSION` bump** (no schema change).

**Untouched (out of scope — subscribe/gate only, per AD-5):** `www/renderer/slide-chip.js` (10-state lifecycle, reads `prefsRef` lazily), `www/transport/slide.js` (state machine, auto-send wire-safety, wakeup-timeout arming), `www/transport/slide-recv.js` (folder chooser — reached via `wireSlideRecv` refs), `www/input/file-source.js` (confirm-transfers gate, Send modal). The `pagehide`/`visibilitychange` SLIDE `CTRL_CAN` tab-hide safety stays in `chrome.js` (AD-13) — do not touch.

### Prefs pattern (SSOT — AD-4/AD-5)

`savePrefs(partial)` merges + persists (250 ms debounced) but does **NOT** fan out subscribers; the same change-handler that saves also applies synchronously (already true for every SLIDE handler). `resetPrefs()` is the only thing that fires `subscribe` → both `applyPrefs` (re-syncs SLIDE `.checked`/`.value` by id) and `menuBar.projectPrefs` (menu glyphs only) re-project idempotently. Read prefs at use-time (`getPrefs()`); never cache the ref across a save. The modal edits *preferences*, never live SLIDE lifecycle state (AD-5).

### Testing idioms (codified — E1/E2 retros)

- Boot-race guard first: `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')` (+ `typeof window.__modal === 'object'` before driving the modal).
- Deterministic open: `await page.evaluate(() => window.__menuBar.open('settings'))` — NEVER a title `.click()` (second click toggles shut). Click the row: `page.click('#dropdown-settings .menu-item[data-action="slide-config"]')`.
- Modal open + menu closed: `expect(page.locator('#slide-config-modal')).toBeVisible()` + `openDialogId==='slide-config-modal'` + `getOpenMenu()===null`.
- Focus round-trip: close via `#slide-config-close` or Esc → `document.activeElement.id==='terminal-wrapper'`.
- No drop shadow: assert computed `box-shadow: none` (styling contract).
- Repointing the two pane specs: replace the `<details>` expand with the menu-open path; the child-id interactions stay identical (ids unchanged).
- Run `npm test` (full) / `npm run test:fast` (`@fast`). No `--workers=1` — trust `chromium-transport` + `retries:1`.

### Clean-modal aesthetic (matching key-screen-chrome.html)

Per the user's standing note (memory: clean modal aesthetic) and recent commits (`b5f1be1` aligned-row look, `3a51011` ⓘ tooltips open upward, `e8bb7d5` Reset rename): modals match `key-screen-chrome.html` — aligned `.field` rows, **not** transplanted verbose panes. Build the SLIDE modal clean from the start (don't ship the verbose pane markup then polish it later). Preserve verbatim copy while adopting the aligned layout. **Note:** the mockup contains no SLIDE modal — the Serial Config modal is the structural analog. If you convert the verbose inline `.hint` help text (folder-help, confirm-transfers help) into ⓘ `.field-tip` tooltips (opening upward per `3a51011`), preserve the exact copy — but the `#slide-auto-send-validation-hint` MUST stay an inline live-toggled element (JS unhides it), not a tooltip. See Q4.

### Project Structure Notes

- No new `renderer/` module (AD-1 satisfied trivially): E3.4 adds a `<dialog>` + a menu row + one opener + one dispatch branch. Named exports only, no default exports, no new deps, no build step.
- Element ids kebab-case + feature-prefixed; modal children share the `slide-config` / existing `slide-*` prefixes. Visual state via `data-*`/`[hidden]`, never inline styles.
- **Detected variance:** the SLIDE controls carry Phase-10/11/12 provenance comments and their own bespoke CSS; when moving, keep the comments' intent but reconcile the aesthetic to the shared `.chrome-modal`/`.field` system (as E2.3 did for serial). The auto-send `data-invalid`/`aria-invalid` + validation-hint machinery is load-bearing (SLIDE-38) — preserve it exactly.

### References

- [Source: epics.md#Story-E3.4] (lines 484–501) — user story + 2 epic ACs; FR-20, UX-DR12.
- [Source: prds/prd-beastty-2026-07-01/prd.md#FR-20] — SLIDE File Transfer modal requirement.
- [Source: architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md] — AD-8 (openModal), AD-4/AD-5 (prefs SSOT / federated state), AD-3 (import allowlist), AD-1/AD-12 (wiring/boot order), AD-2 (test hooks), AD-10 (retainFocus), AD-9 (neutral shell), AD-13 (chrome.js keeps SLIDE tab-hide safety).
- [Source: architecture/…/EPIC-SPLIT.md#E3] (lines 49–55) — E3.4 = SLIDE modal via openModal; governs AD-7/AD-8/AD-4; depends on E0+E1; test bar "each toggle writes the right pref; SLIDE modal fields persist".
- [Source: ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md#State-Patterns] (lines 149–162) — the 10-state chip lifecycle + pref gating (referenced, unchanged).
- [Source: ux-designs/…/DESIGN.md#Components] — modal container spec, neutral tokens, rounding/elevation.
- [Source: www/index.html:1600–1663] — the exact controls being relocated (verbatim copy source of truth).

## Previous Story Intelligence (E2.3 / E3.1 / E3.3)

- **E2.3 (Serial Config modal)** is the near-identical precedent: MOVE same-id controls into a `.chrome-modal` `<dialog>`, opener injected into `wireMenuBar`, dedicated dispatch branch, neutralize any behavior that force-opens a pane, drop in-modal terminal-restore that fights the trap. Copy its shape.
- **E3.3 review fixes to pre-empt:** (1) clear any transient/armed state in `wireMenuBar` re-init + `dispose()` + `__resetForTests()` — *this story adds no armed/timer state, so likely N/A, but verify*; (2) **put `class="chrome-modal"` on the dialog and add near-zero new CSS** — the shared chrome is already hoisted; (3) single-source any duplicated string constants (export a frozen object, inject via opts — menu-bar can't import); (4) cache projected DOM refs at wire time.
- **E3.3/E2.3 process:** fill the `## Code Review` section in this file with the outcome (N findings, fixed in `<sha>`) — E2-retro action #2. On completion, set Status to done in **both** this file's front-matter **and** `sprint-status.yaml` (+ `last_updated`) — E2-retro action #5 / memory: mark-story-done-all-places.
- **Flagged-questions convention:** dev takes the recommended defaults unless Ant says otherwise; record which in Completion Notes.

## Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **Q1 — Relocation strategy:** MOVE same-id controls into the dialog (recommended, matches E2.3) vs duplicate+mirror. **Default: MOVE.**
2. **Q2 — Footer:** Close-only (recommended — SLIDE has no preset-reset analog; epic AC lists only the fields) vs add a "Reset SLIDE settings to defaults" button. **Default: Close-only.**
3. **Q3 — Compat-select in-modal terminal-restore:** the existing `slideCompatSelect` change-handler restores terminal focus on `change` (`main.js:882–892`); inside a focus-trapped modal that fights the trap (E2.3 removed an analogous one). **Default: neuter the in-modal terminal-restore; `restoreTo`-on-close owns focus.** (The `change→savePrefs` write is unchanged.)
4. **Q4 — Hints vs ⓘ tooltips:** convert the verbose inline `.hint` help (folder-help, confirm-transfers help) into upward-opening ⓘ `.field-tip` tooltips (matches the polished Serial modal, cleaner) vs keep inline `.modal-hint` text. Either preserves verbatim copy. `#slide-auto-send-validation-hint` stays inline+live-toggled regardless. **Default: adopt ⓘ tooltips for the two help paragraphs, keep the static "\r appended automatically" + validation hint inline.**
5. **Q5 — Empty sub-pane:** since all five rows move, remove the now-empty `<details id="settings-slide">` + its `<hr class="settings-divider">` (recommended — nothing stays behind) vs leave an empty vestige for E7. **Default: remove the empty sub-block; leave the parent `#settings` pane for E7.**

## Project Context Reference

- CLAUDE.md — Rust→wasm core owns parser/terminal/keys; **JS shell owns Web Serial, canvas, event loop, browser state** (this story is pure JS-shell chrome). Chromium-only. Static-site deploy, no build step.
- `.planning/` is the GSD source of truth; this epic (E3) is the BMM "Chrome Redesign" milestone under `_bmad-output/`. Premise: pure relocation — controls keep exact v1.1 behavior, only move home.
- Standing conventions: `var(--chrome-*)` tokens only (NFR-2/AD-9); `retainFocus` on every chrome control (NFR-1/AD-10); `window.__xxx` + `__getStateForTests` (NFR-6/AD-2); no new deps / no build step (NFR-5/AD-1).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- Full suite: `npx playwright test` (both `chromium` + `chromium-transport` projects) → **476 passed, 1 skipped, 2 flaky (self-healed on retry)**. The two flakes are the known wasm-boot-under-parallelism class the ratified `retries:1` mask covers: the pre-existing `menu-bar.spec.js` aria-disabled flake, and one `slide-prefs.spec.js` boot-wait timeout. Confirmed pre-existing/contention (not a defect in the new `openSlideModal` helper): `--repeat-each=3` in isolation showed the same self-healing single flake; the existing `terminal.width>0` boot-wait already gated the same boot point, so no new flake surface was added. No per-story `--workers=1`.
- New spec `tests/render/slide-config-modal.spec.js` → 15/15 pass.

### Completion Notes List

Pure relocation, MOVE strategy (no dual-chrome). Every SLIDE control moved verbatim (same ids / copy / option-sets) from the retired `<details id="settings-slide">` pane into `#slide-config-modal`, opened from a new Settings ▸ **SLIDE File Transfer…** item. Only new JS is the opener + one dispatch branch; the SLIDE state machine / chip / recv module / prefs schema are untouched (AD-5, no `CURRENT_VERSION` bump).

**Flagged questions — all recommended defaults taken:**
- **Q1 (MOVE vs duplicate):** MOVE the same-id controls into the dialog. Refs (`getElementById` + `wireSlideRecv`) resolve unchanged; one source of truth (NFR-4).
- **Q2 (footer):** Close-only, no Reset button.
- **Q3 (compat-select in-modal terminal-restore):** neutered the `slideCompatSelect` change→`terminalWrapper.focus()` (fought the focus trap; `restoreTo`-on-close owns focus). `change→savePrefs` unchanged. It was the ONLY SLIDE change-handler doing an in-modal terminal-restore (show-summary/confirm/auto-send never did).
- **Q4 (hints vs ⓘ tooltips):** adopted upward-opening ⓘ `.field-tip` tooltips for the two verbose help paragraphs (folder-help + confirm-transfers help), keeping the exact copy. The dynamic `#slide-recv-folder-help` (wireSlideRecv swaps hintToggleOff/On) works as a tooltip because the always-visible `#slide-recv-folder-status` line carries the live state (and is the `aria-live="polite"` region). The static "\r appended automatically" hint and the SLIDE-38 `#slide-auto-send-validation-hint` stay **inline** (the latter is JS live-toggled, not a tooltip).
- **Q5 (empty sub-pane):** removed the now-empty `<details id="settings-slide">` + its preceding `<hr class="settings-divider">`; parent `<details id="settings">` left as an E7 vestige.

**E3.3 review-fixes pre-empted:** (2) shared `.chrome-modal` chrome reused; the aligned-row `.field`/`.field.check`/`.field-info`/`.field-tip` rules were **hoisted from `#serial-config-modal` to `.chrome-modal`** (single-source — E3.3 fix #2) so both modals share one definition (added `input[type="text"]` styling for the auto-send input; `.modal-body` flex-column hoisted too). (1) No armed/timer state added, so no `dispose()`/re-init clearing needed. The SLIDE-38 `[data-invalid]` CSS was re-anchored from `#settings-slide` to `#slide-config-modal` (2 ids → wins on specificity alone; the old `[data-theme]` hack retired). Dead `#settings-slide` form-control CSS + `.settings-row-action` recv-folder CSS removed.

**Test repointing (Task 6):** the 6 specs that expanded the `<details id="settings-slide">` pane were repointed. Specs whose tests interact with the SLIDE settings DOM open the modal via the menu (`window.__menuBar.open('settings')` → `[data-action="slide-config"]`): `slide-prefs` (+ its two structural tests rewritten to assert the modal, not the pane), `slide-recv-settings`, `slide-recv-fsap` (opened in `pickFolderAndToggle`, AFTER the `beforeEach` `#connect-button` click), `slide-confirm-pref` (Test 3 only), `slide-autosend-safety` (per-test in the input-manipulation tests only — `setup()` stays modal-free so `setupConnected()`'s top-bar `#connect-button` click isn't made inert by an open dialog). `slide-compatibility` touches no SLIDE control, so its pane-expand was simply dropped. `keydown-ctrl-letters`'s `:not(#settings-slide)` qualifier still resolves the remaining reserved pane — unchanged.

### File List

- `www/index.html` — added `<dialog id="slide-config-modal">` (5 rows moved verbatim into the clean aligned-row layout, ⓘ tooltips for the two help paragraphs) + new `#menu-slide-config-item` Settings row; removed the `<details id="settings-slide">` sub-pane + its `<hr>`; hoisted `.field*`/`.field-info`/`.field-tip`/`.modal-body`-flex CSS to `.chrome-modal`; added `#slide-config-modal` specifics (width, `.field-control`, `.field-action`); re-scoped SLIDE-38 `[data-invalid]` CSS; removed dead `#settings-slide` + `.settings-row-action` CSS.
- `www/main.js` — added `openSlideConfig()` opener + injected it into `wireMenuBar`; neutered the `slideCompatSelect` change-handler in-modal terminal-restore (Q3).
- `www/renderer/menu-bar.js` — added `openSlideConfigRef` module ref + wire-time assignment + the `slide-config` dispatch branch in `onItemClick`.
- `www/tests/render/slide-config-modal.spec.js` — **new**; 15 tests covering AC-1…AC-9.
- `www/tests/transport/slide-prefs.spec.js` — repointed setup to the modal; rewrote the two structural pane tests to assert `#slide-config-modal`.
- `www/tests/transport/slide-recv-settings.spec.js` — repointed setup to the modal.
- `www/tests/transport/slide-recv-fsap.spec.js` — open the modal in `pickFolderAndToggle` (after connect); dropped the pane-expand from `setup`.
- `www/tests/transport/slide-confirm-pref.spec.js` — repointed the checkbox round-trip test to the modal.
- `www/tests/transport/slide-autosend-safety.spec.js` — kept `setup()` modal-free; open the modal per input-manipulation test.
- `www/tests/transport/slide-compatibility.spec.js` — dropped the unused pane-expand.

## Change Log

- 2026-07-03 — E3.4 implemented: relocated the SLIDE transfer controls from the `<details id="settings-slide">` pane into an `openModal`-driven `#slide-config-modal` opened from Settings ▸ SLIDE File Transfer…; all recommended flagged-question defaults taken; hoisted shared `.chrome-modal .field*` CSS; repointed 6 transport specs + added a new render spec. Full suite green (476 passed / 1 skipped; 2 known-flake retries). Status → review.

## Code Review

_Pending — record outcome here (N findings, fixed in `<sha>`) after `code-review`._
