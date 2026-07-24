---
baseline_commit: 474cf650d09305d9703b85cac7f285421934aca1
---

# Story E8.3: Settings surfaces — enable, size & clear

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want Settings controls to turn command history off, cap its size, and clear it,
So that I can defer to apps that need the arrow keys, bound how much is kept, and wipe history when I want.

## Acceptance Criteria

1. **Settings rows present** — Given the Settings menu, when I open it, then it shows `Command history` (checkable, default ON), `Command history size ▸` (radio submenu 50/100/200/500, default 100), and `Clear command history…`, all styled as existing menu items with `--chrome-*` tokens (FR-19, FR-20, UX-DR2, AD-7, AD-9).
2. **Enable toggle** — Given the `Command history` toggle, when I switch it off, then capture stops and ↑/↓ pass straight through to the MicroBeast; switching it on resumes capture; the choice persists across reloads via `savePrefs` (FR-19, FR-9, AD-4). The stored history is kept while off — only capture/trigger stop.
3. **Size presets** — Given the `Command history size` submenu, when I select a preset, then the store cap updates **immediately** (dropping oldest beyond the new cap) and the choice persists; the radio reflects the active value (FR-20, AD-4).
4. **Clear with confirm** — Given `Clear command history…`, when I invoke it and confirm the deliberate-friction prompt "Clear command history? This can't be undone.", then the store is emptied and persisted; a subsequent ↑/↓ at an empty prompt is a no-op (empty history) (FR-21, FR-10, UX-DR3). Cancel/Esc/backdrop leave history untouched.
5. **Reset re-projection** — Given Reset All Preferences (existing E3 action), when it fires, then the menu re-projects its command-history rows (enable checked, size radio on 100) idempotently from prefs, per the reset-subscriber contract (AD-14).

## Tasks / Subtasks

- [x] Task 1: Settings-menu markup in `www/index.html` (AC: 1)
  - [x] After the Enter-key-sends `.submenu-group` (closes at `index.html:1531`) and before the SLIDE File Transfer… comment block that starts at `:1532` (keep that comment attached to its `#menu-slide-config-item` button), insert per the EXPERIENCE.md Settings IA: `<div class="menu-sep"></div>`, then the three command-history rows, then a second `<div class="menu-sep"></div>` before SLIDE File Transfer….
  - [x] Checkable row: `<button id="menu-command-history-item" class="menu-item" type="button" role="menuitemcheckbox" data-variant="checkable" data-pref="commandHistoryEnabled" data-checked="true" aria-checked="true"><span class="check">✓</span><span class="lbl">Command history</span></button>` — starts checked because the prefs default is `true` (contrast the Local-echo template at `:1482`, whose default is false); re-derived from prefs at wire-time / on open / on reset regardless.
  - [x] Size radio submenu: clone the crlf `.submenu-group` template (`index.html:1512-1531`) with `data-submenu="cmdhistory-size"`, label `Command history size`, panel `data-submenu-panel="cmdhistory-size"` / `aria-label="Command history size"`, radio children `data-value="50"|"100"|"200"|"500"` with labels `50` / `100` / `200` / `500`; `100` starts `data-checked="true"` + ✓ glyph (the default).
  - [x] Action row: `<button id="menu-clear-cmd-history-item" class="menu-item" type="button" role="menuitem" data-variant="action" data-action="clear-cmd-history"><span class="check"></span><span class="lbl">Clear command history…</span></button>` — trailing … = "opens further UI"; no ▸ caret (reserved for radio submenus).
  - [x] No new CSS: rows reuse `.menu-item` / `.submenu` styles; AD-9 neutral `--chrome-*` tokens only.
- [x] Task 2: Confirm dialog markup in `www/index.html` (AC: 4)
  - [x] Mirror `#clear-scrollback-confirm` (`index.html:1781-1796`) exactly in shape: `<dialog id="clear-cmd-history-confirm" aria-labelledby="clear-cmd-history-confirm-title">` with `<header><h2 id="clear-cmd-history-confirm-title">Clear command history?</h2></header>`, `<p>This can't be undone.</p>` (verbatim UX-DR3 microcopy, split title/body like the precedent), and `<form method="dialog">` with `<button id="clear-cmd-history-confirm-ok" type="submit" value="confirm">Clear command history</button>` + `<button id="clear-cmd-history-confirm-cancel" type="submit" value="cancel">Cancel</button>`.
  - [x] Keep it terse (title + one line + two buttons) — matches the established clean-modal aesthetic; no extra panels or hints beyond the precedent's shape. Reuses existing `<dialog>` CSS; no new styles.
- [x] Task 3: Engine `trimToCap()` in `www/input/command-history.js` (AC: 3)
  - [x] Add a `trimToCap()` function next to `clear()` (`:172-173`): read `getPrefs()` fresh; clamp `commandHistorySize` to a positive integer exactly as `commit()` does (`:150` region, defensive against corrupt prefs); if `commandHistory.length` exceeds the cap, `savePrefs({ commandHistory: history.slice(0, cap) })` (store is newest-first, so slicing from the front keeps newest and drops oldest); no-op otherwise.
  - [x] Export it from the `wireCommandHistory` API object (alongside `clear` at `:69`). Engine-owned per AD-5 — menu code never touches the store shape.
- [x] Task 4: menu-bar.js wiring (AC: 1, 2, 3, 4, 5)
  - [x] Module-scope element refs (near `crlfPanelEl`, `menu-bar.js:163`): `commandHistoryItemEl` (`#menu-command-history-item`) and `cmdHistorySizePanelEl` (`.submenu[data-submenu-panel="cmdhistory-size"]`), both resolved in `wireMenuBar` where `crlfPanelEl` is (`:481`).
  - [x] Injected refs (near `confirmClearScrollbackRef`, `:126`): `confirmClearCommandHistoryRef` and, for the post-confirm action and the size trim, `clearCommandHistoryRef` + `trimCommandHistoryRef`; assign from opts where `confirmClearScrollbackRef` is assigned (`:341`).
  - [x] `CHECKABLE_PREF_EFFECTS` (`:194`): add `commandHistoryEnabled: {}` — NO live setter. (The lookup is `if (effect) effect.apply?.(next)` at `:949-950`, so the empty entry is convention matching `autoConnect`/`stripCtrlLogs`, not a functional dependency.) The engine's capture path and the overlay trigger both read `getPrefs()` at use-time (engine `:86`-region early-return; overlay enabled check), so the toggle takes effect on the next keystroke with zero extra plumbing. The generic checkable branch (`:946-950`) then handles persist + glyph + menu-stays-open untouched.
  - [x] `onRadioSelect` (`:772`): add a `group === 'cmdhistory-size'` branch after `crlf` (`:807-818`): `const size = Number(value); if (Number.isInteger(size) && size > 0) { savePrefs({ commandHistorySize: size }); trimCommandHistoryRef?.(); setRadioChecked(panel, value); }` — persist first so `trimToCap()`'s fresh `getPrefs()` sees the new cap (AD-4: `savePrefs` patches the in-memory blob synchronously; only localStorage flush is debounced). No live setter, not a D-19 selection-clear trigger, no CRT-conditional disable.
  - [x] Action dispatch: add `case 'clear-cmd-history':` inside `runViewAction`'s switch (`:1052`, reached via `onItemClick`'s fallthrough at `:1032`), mirroring `case 'clear-scrollback'` (`:1060-1064`): `closeMenu(); if (confirmClearCommandHistoryRef) { confirmClearCommandHistoryRef().then((ok) => { if (ok) clearCommandHistoryRef?.(); }); }`. Do NOT use the `modalOpener` table (`:982-993`) — it fires openers blind and cannot run the confirm-then-clear promise chain.
  - [x] Projection: add `function projectCommandHistory(prefs) { projectCheckable(commandHistoryItemEl, 'commandHistoryEnabled', prefs); }` beside `projectStripCtrl` (`:1176`); call it plus `if (cmdHistorySizePanelEl && p.commandHistorySize) setRadioChecked(cmdHistorySizePanelEl, String(p.commandHistorySize))` in BOTH `projectPrefs` (`:1372`, with the other Settings checkables) and the `openMenu === 'settings'` branch of `projectMenuOnOpen` (`:1125`). Note `setRadioChecked` compares `data-value` strings — always project `String(p.commandHistorySize)`. AC-5 then needs no new reset code: `main.js` already subscribes `menuBar.projectPrefs` to the reset fan-out.
- [x] Task 5: main.js opener + injection (AC: 3, 4)
  - [x] `confirmClearCommandHistory()` mirroring `confirmClearScrollback` (`main.js:229-238`): resolve `#clear-cmd-history-confirm` at boot; missing markup → `Promise.resolve(true)` (don't break the feature); `openModal(el, { initialFocus: <cancel button>, restoreTo: terminalWrapper }).then((rv) => rv === 'confirm')` — Cancel default-focused (safe choice on a destructive action; modal.js policy), Esc/backdrop resolve `''` → cancel.
  - [x] Inject into the `wireMenuBar` opts (`:446-…`, beside `confirmClearScrollback` at `:461`): `confirmClearCommandHistory`, `clearCommandHistory: () => commandHistory.clear()`, `trimCommandHistory: () => commandHistory.trimToCap()`. **Must be thunks**: `wireMenuBar` (`:446`) runs before `const commandHistory = wireCommandHistory({})` (`:593`), so a direct `commandHistory.clear` reference at opts-build time would throw (TDZ). The thunks only dereference on click, long after boot.
- [x] Task 6: Playwright coverage — new spec `www/tests/render/menu-bar-command-history.spec.js` (AC: 1-5)
  - [x] Follow `menu-bar-settings.spec.js` patterns (boot guard on `window.__menuBar` + `window.__prefs`, plus `window.__commandHistory` from the E8.1 spec's `ready()`).
  - [x] AC-1: open Settings; assert the three rows exist with correct variants/roles/labels, toggle checked, size submenu opens with `100` checked.
  - [x] AC-2: click the toggle → `data-checked`/`aria-checked` flip, menu stays open, `getPrefs().commandHistoryEnabled === false`; then assert capture inert (feed keystrokes via `window.__commandHistory.capture` as in `command-history.spec.js` `typeStr()`, Enter commits nothing) and ↑ at empty prompt does not open the overlay (`window.__commandHistoryOverlay.isOpen() === false`, arrow forwarded — reuse the E8.2 overlay spec's passthrough assertions/`window.__txSink`); toggle back on → capture resumes.
  - [x] AC-3: seed >50 entries via `window.__commandHistory.commit(...)`, select `50` → `getPrefs().commandHistorySize === 50` AND `getHistory().length === 50` immediately with newest retained; radio glyph moved; menu stays open.
  - [x] AC-4: seed entries; click `Clear command history…` → menu closes, dialog opens with Cancel focused; cancel path leaves history intact; confirm path → `getHistory()` empty, `getPrefs().commandHistory` empty, focus back on `#terminal-wrapper`; ↑ afterwards is a no-op (overlay stays closed).
  - [x] AC-5: flip toggle off + size to 500, run `window.__prefs.resetPrefs()` (pattern: `menu-bar-settings-reset.spec.js`), assert rows re-project to checked + 100. (Reset also restores `commandHistory: []` from DEFAULTS — assert history empty after reset is fine to include, but the AC only demands menu re-projection.)
  - [x] Run the full suite (`npm test` in `www/`); known pre-existing parallel-boot flake (E1-documented) may need `--workers=1` to confirm an isolated file — do not chase it as a regression.

## Dev Notes

### Why this story is small and where the pieces already are

E8.1/E8.2 left E8.3 fully plumbed. **Do not add pref keys, do not touch keyboard.js, the overlay, or the wasm core.**

- Prefs already exist (`www/state/prefs.js:58-67`): `commandHistoryEnabled: true`, `commandHistorySize: 100`, `commandHistory: []` — all top-level DEFAULTS, defensive spread-merge, `CURRENT_VERSION` deliberately NOT bumped. E8.3 adds **no** new keys and no migration.
- The engine (`www/input/command-history.js`) already exports `clear()` (`:172-173`, literally commented "E8.3 — clear all history") and reads `commandHistoryEnabled`/`commandHistorySize` fresh from `getPrefs()` at use-time, so the toggle and size take live effect with no setter (prefs.js comments say so verbatim: "Toggle lands in E8.3 Settings", "an E8.3 change applies on the next Enter").
- The only engine change is the new `trimToCap()` (Task 3), because AC-3 requires the trim **at selection time**, not at next commit.
- The menu system already supports all three row variants (checkable / radio-submenu / action) — E8.3 reuses them verbatim; no new menu mechanics. Keyboard nav, submenu open/close, aria-live announcements, and `retainFocus` are all generic over `data-submenu`/`data-submenu-panel`/`.menu-item` (`menu-bar.js:601-608`, `:680-684`, `:896-909`) and pick up static rows at wire-time — zero per-panel code, no need to touch `onMenuKeydown`.

### Architecture constraints (binding)

- **AD-3 import allowlist**: `menu-bar.js` imports only `canvas.js` setters + `state/prefs.js` (+ sibling helpers `focus.js`/`confirm-toggle.js`). It must NOT import `input/command-history.js` or `modal.js` — the confirm opener and the clear/trim actions arrive as injected `wireMenuBar` opts, exactly like `confirmClearScrollback` / `openReservedCtrl`.
- **AD-4 prefs**: write `savePrefs(partialPatch)` at the mutation site; read `getPrefs()` at use-time; never cache across a save. `savePrefs` does not fan out — subscribers fire only on `resetPrefs()`.
- **AD-5 federated state**: the engine owns the history store. Menu code calls injected engine functions; it never reshapes `prefs.commandHistory` itself.
- **AD-7 menu semantics**: checkable + radio keep the menu (and submenu) open; the clear action closes the menu, then confirms.
- **AD-9**: neutral `--chrome-*` tokens only; no `[data-theme]` branches, no new palette, no shadow.
- **AD-10**: menu rows get `retainFocus` from the existing `wireDropdownItems` pass — no new focus code. The confirm modal's focus round-trip is `openModal`'s `restoreTo: terminalWrapper`.
- **AD-14 reset**: `menuBar.projectPrefs` is already a reset subscriber (`main.js:1526` region). Adding the two projections inside `projectPrefs` IS the reset story; write no bespoke reset handler.
- **NFR-3 inert-when-off**: satisfied structurally — the toggle only writes the pref; the engine's early-return does the rest. Do not add interception.

### Current state of each file touched (read these before editing)

| File | Today | E8.3 change | Preserve |
|---|---|---|---|
| `www/index.html:1474-1566` | Settings dropdown: Local echo, Wrap long lines, Strip ctrl codes (checkables), Enter key sends ▸ (crlf submenu `:1512-1531`), SLIDE File Transfer… `:1539`, sep, Browser-reserved Ctrl…, sep, Reset all preferences | Insert sep + 3 rows + sep between `:1531` and `:1539`; add `#clear-cmd-history-confirm` dialog near `#clear-scrollback-confirm` (`:1786`) | Existing row ids/attrs; the E3.3 reset row's inline 2-click confirm is untouched |
| `www/renderer/menu-bar.js` | `onItemClick` `:911` (checkable branch `:934-952` generic via `data-pref`; action cases from `:1048`); `onRadioSelect` `:772` if/else by `data-submenu-panel` group; `setRadioChecked` `:824`; `projectCheckable` `:1153` + per-row wrappers `:1164-1176`; `projectMenuOnOpen` `:1125`; `projectPrefs` `:1372`; injected refs `:120-126` assigned `:337-341`; `CHECKABLE_PREF_EFFECTS` `:194` | Element refs, 3 injected refs, effects-table entry, `cmdhistory-size` radio branch, `clear-cmd-history` action case, projection wrapper + 2 projection call sites | `crlf`/theme/phosphor/font branches byte-identical; reset 2-click machinery (`resetConfirm`, `:230`) untouched; checkable branch itself unchanged (it's generic) |
| `www/input/command-history.js` | `capture` classifier, `isLineEmpty`, `getHistory` (defensive copy), `commit` (dedup + clamp cap at `:150` region), `clear` `:173`; API object `:60-75` | Add `trimToCap()` + export | `commit()` does NOT guard empty strings (overlay guards) — don't "fix"; classifier byte logic (keypad/IME/SLIDE fixes from the E8.2 review) untouched |
| `www/main.js` | `confirmClearScrollback` `:229-238`; `wireMenuBar` opts `:446-…` (incl. `confirmClearScrollback` `:461`); `wireCommandHistory` `:593`; overlay `:605`; `wireKeyboard` `:833`; prefs subscribers `:1515-1527` | Add `confirmClearCommandHistory` beside its precedent; 3 opts entries (2 as thunks — see TDZ note in Task 5) | Boot order (AD-12) unchanged — no wiring moves |

### Details that will bite if missed

1. **Thunk injection (TDZ)** — `wireMenuBar` runs (`main.js:446`) ~150 lines before `commandHistory` exists (`:593`). Inject `() => commandHistory.clear()` / `() => commandHistory.trimToCap()`, never bare references.
2. **Immediate trim on size select** — AC-3's "updates immediately" is the one behavior E8.1 did not pre-build. `savePrefs({ commandHistorySize })` first, `trimCommandHistoryRef?.()` second (fresh `getPrefs()` sees the new cap). Store is newest-first: `slice(0, cap)` drops the oldest.
3. **String vs number** — radio `data-value` is a string, the pref is a number. Convert with `Number()` + `Number.isInteger(size) && size > 0` on write; project with `String(p.commandHistorySize)` (`setRadioChecked` compares `data-value` strings).
4. **Persist ≠ apply doesn't apply here** — unlike `localEcho`/`crlfMode`, there is deliberately NO live setter for either pref (engine reads at use-time). `CHECKABLE_PREF_EFFECTS.commandHistoryEnabled = {}` mirrors `stripCtrlLogs`/`autoConnect`. Do not invent a setter or a prefs subscriber in the engine.
5. **Toggle off keeps the store** — disabling stops capture/trigger only; `prefs.commandHistory` survives so re-enabling restores recall. Only `Clear command history…` (and Reset, via DEFAULTS `commandHistory: []`) wipes it.
6. **Confirm pattern is the MODAL one** — Clear Scrollback (`openModal` + Cancel default focus), NOT the Reset row's inline 2-click confirm. UX-DR2 names the Clear-Scrollback pattern explicitly. Esc/backdrop → `''` → treated as cancel; only `rv === 'confirm'` clears.
7. **Menu close ordering** — mirror `case 'clear-scrollback'`: `closeMenu()` BEFORE opening the modal, so the dropdown isn't left open under the dialog.
8. **Divider placement** — EXPERIENCE.md Settings IA groups the three command-history rows between dividers (after Enter-key-sends, before SLIDE File Transfer…). Today there is no sep between crlf and SLIDE; E8.3 introduces both seps around its block.
9. **Reset wipes history too** — `resetPrefs()` restores DEFAULTS including `commandHistory: []`. That is pre-existing E8.1 behavior, not something E8.3 adds or must prevent.

### Previous story intelligence (E8.1 / E8.2)

- Both stories passed review with fixes now living in `input/command-history.js` (keypad-digit capture via wire byte, Shift+Arrow trigger exclusion, SLIDE suspend via `getWireOwner()`, IME guard, modified-chord swallow). E8.3 must not disturb the classifier.
- Test approach that worked: programmatic `capture({ e, code, mods, bytes, wasEnter })` feeds via `window.__commandHistory` (fast, deterministic) + a few real-keyboard presses for the trigger path; `window.__txSink.formatHexStrip()` to assert wire bytes; `seed()` via `commit()`.
- Known flake: parallel-boot starvation makes isolated new spec files flaky under default workers (E8.1 hit 9/17, E8.2 hit 3/18); serialize (`--workers=1`) to confirm an isolated file, and keep the spec's `ready()` light (don't wait on the encoder unless the test sends real keys).
- 36-test command-history suite (`command-history.spec.js` 18, incl. the keypad-digit regression test added in E8.2 review + `command-history-overlay.spec.js` 18) is green — keep it that way; E8.3's engine change is additive only.

### Web/library research

None needed: vanilla ES modules, native `<dialog>`, Playwright — all patterns proven in-repo (E3.2/E3.3/E1.5 precedents). No external dependencies are added or upgraded.

### Project Structure Notes

- No new modules and no new `wireXxx` call: E8.3 extends `menu-bar.js` (menu surfaces), `input/command-history.js` (one engine function), `index.html` (markup), `main.js` (one opener + three opts). AD-7 makes this the required shape — "one module `renderer/menu-bar.js` owns the bar + all dropdowns" — so Settings rows belong in the existing menu component, not a new module.
- New test file `www/tests/render/menu-bar-command-history.spec.js` follows the existing `menu-bar-settings*.spec.js` naming.
- Naming keeps the established conventions: `data-action="clear-cmd-history"`, `data-submenu="cmdhistory-size"`, dialog `clear-cmd-history-confirm` with `-ok`/`-cancel`/`-title` suffixes (mirrors `clear-scrollback-confirm`).

### References

- [Source: _bmad-output/planning-artifacts/epics-command-history.md#Story E8.3] — story + ACs; FR-9/10/19/20/21; UX-DR2/DR3
- [Source: _bmad-output/planning-artifacts/prds/prd-beastty-2026-07-22/prd.md#FR-19/FR-20/FR-21] — defaults (enabled, 100), preset submenu decision, clear action
- [Source: _bmad-output/planning-artifacts/architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md#AD-3/AD-4/AD-5/AD-7/AD-9/AD-10/AD-14] — binding constraints above
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md#Information Architecture ▸ Settings] — row order, labels, divider grouping, Clear-Scrollback confirm pattern
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md#Voice and Tone] — "Clear command history? This can't be undone."
- [Source: www/renderer/menu-bar.js:772-829 (onRadioSelect/setRadioChecked), :911-1064 (onItemClick + clear-scrollback case), :1125-1176 (projection), :194 (CHECKABLE_PREF_EFFECTS)]
- [Source: www/index.html:1474-1566 (Settings dropdown), :1781-1796 (clear-scrollback-confirm dialog)]
- [Source: www/state/prefs.js:58-67 (command-history DEFAULTS)]
- [Source: www/input/command-history.js:60-75 (API object), :150 (cap clamp), :172-173 (clear)]
- [Source: www/main.js:229-238 (confirmClearScrollback), :446/:461 (wireMenuBar opts), :593 (wireCommandHistory), :1515-1527 (prefs subscribers)]
- [Source: _bmad-output/implementation-artifacts/e8-1-command-capture-engine-line-mirror-history-store.md / e8-2-recall-overlay-trigger-filter-edit-send.md — Dev Agent Records (test patterns, flake handling, review fixes)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — BMad Dev Story workflow.

### Debug Log References

- Full Playwright suite (`npx playwright test --project=chromium`): **413 passed, 1 skipped, 4 flaky** (all flakes recovered on retry). The flakes are the pre-existing E1-documented parallel-boot starvation (`modal.spec.js` `window.__modal` `waitForFunction` timeout, `keyboard.spec.js` zoom, `menu-bar.spec.js:309` Connection ▸ Auto-connect aria-checked) — none in this story's files; not chased as regressions per Task 6.
- New spec in isolation (`menu-bar-command-history.spec.js --workers=1`): 6/6 green; the one first-run flake (AC-4 confirm) passed 5/5 on `--repeat-each=5`, consistent with the documented boot flake, not a defect.

### Completion Notes List

- **No new pref keys, no keyboard.js / overlay / wasm changes** — E8.1/E8.2 left the feature fully plumbed (prefs default `commandHistoryEnabled: true`, `commandHistorySize: 100`, `commandHistory: []`; engine reads them fresh at use-time). E8.3 is purely the Settings surface + one engine helper.
- **AC-1** — three rows added to the Settings dropdown between two new `.menu-sep` dividers (after Enter-key-sends, before SLIDE File Transfer…): a checkable `Command history` (starts checked ✓), a `Command history size ▸` radio submenu (50/100/200/500, 100 default-checked), and a `Clear command history…` action row. No new CSS — all reuse `.menu-item` / `.submenu` + neutral `--chrome-*` tokens (AD-9).
- **AC-2** — the toggle has NO live setter (`CHECKABLE_PREF_EFFECTS.commandHistoryEnabled = {}`, matching `stripCtrlLogs`/`autoConnect`): the generic checkable branch persists + flips the glyph, and the engine's use-time `getPrefs()` read + the overlay trigger pick it up on the next keystroke. Verified capture goes inert and ↑ forwards ESC A when off, and resumes when back on. The stored history survives an off toggle.
- **AC-3** — new engine `trimToCap()` (next to `clear()`); `onRadioSelect`'s `cmdhistory-size` branch persists `commandHistorySize` FIRST then calls `trimCommandHistoryRef?.()` so the fresh `getPrefs()` sees the new cap. Store is newest-first, so `slice(0, cap)` keeps the newest and drops the oldest — trim is immediate at selection time. String↔number handled (`Number()` + `Number.isInteger && > 0` on write; `String()` on project).
- **AC-4** — `clear-cmd-history` action case mirrors `clear-scrollback`: `closeMenu()` first, then the injected `confirmClearCommandHistory` modal (Cancel default-focused via `openModal({ initialFocus, restoreTo: terminalWrapper })`), clearing only on `rv === 'confirm'`. Cancel/Esc/backdrop leave history untouched. `clear`/`trim` injected as **thunks** (TDZ — `wireMenuBar` runs before `wireCommandHistory`).
- **AC-5** — no bespoke reset code: added the toggle + size projections inside `projectPrefs` (already a `prefsSubscribe` reset subscriber via `main.js:1550`) and the `settings` branch of `projectMenuOnOpen`, plus the wire-time initial paint. `resetPrefs()` re-projects checked + 100 idempotently.
- **Architecture**: AD-3 import allowlist honoured — `menu-bar.js` gained no imports (confirm opener + clear/trim thunks all arrive via `wireMenuBar` opts); AD-5 — the engine owns the store, menu code only calls injected engine functions.

### File List

- `www/index.html` — Settings dropdown: 2 `.menu-sep` + 3 command-history rows (toggle, size radio submenu, clear action); new `#clear-cmd-history-confirm` `<dialog>` mirroring `#clear-scrollback-confirm`.
- `www/input/command-history.js` — added `trimToCap()` + exported it from the `wireCommandHistory` API.
- `www/renderer/menu-bar.js` — element refs (`commandHistoryItemEl`, `cmdHistorySizePanelEl`); injected refs (`confirmClearCommandHistoryRef`, `clearCommandHistoryRef`, `trimCommandHistoryRef`) + opts assignment; `CHECKABLE_PREF_EFFECTS.commandHistoryEnabled`; wire-time discovery + initial paint; `onRadioSelect` `cmdhistory-size` branch; `runViewAction` `clear-cmd-history` case; `projectCommandHistory` wrapper + projections in `projectMenuOnOpen` (settings) and `projectPrefs`.
- `www/main.js` — `confirmClearCommandHistory()` opener; 3 `wireMenuBar` opts (`confirmClearCommandHistory`, `clearCommandHistory`/`trimCommandHistory` thunks).
- `www/tests/render/menu-bar-command-history.spec.js` — **new** — Playwright spec covering AC-1…AC-5 (6 tests).

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-23 | 1.0 | E8.3 implemented — Settings ▸ Command history enable toggle, size presets (50/100/200/500) with immediate trim, and Clear… modal confirm. New engine `trimToCap()`; menu-bar wiring + projections; new Playwright spec (6 tests). Full suite 413 passed. Status → review. | Amelia (Dev) |
| 2026-07-23 | 1.1 | Code review run — 0 correctness bugs, 3 cleanups folded into `c1706d0`. Status → done. (Code Review section backfilled 2026-07-24 — E8 retro action #1.) | Amelia (Dev) |

### Code Review

**Outcome:** review of the Settings surfaces + engine `trimToCap()`; **0
correctness bugs** — consistent with the story reusing generic, proven menu
mechanics wholesale (checkable / radio-submenu / action rows, the
Clear-Scrollback confirm pattern). **3 cleanups applied**, folded into the
implementation commit `c1706d0` before recording, per this project's
convention. Suite green after cleanups (413 passed / 1 skipped on `retries:1`;
4 pre-existing documented flakes recovered, none in this story's files).

- **Cap clamp shared via `capOf()`** across `commit()` and the new
  `trimToCap()` — one clamp rule instead of two drifting copies.
- **Size-radio re-derive folded into `projectCommandHistory()`** so the three
  projection call sites (wire-time, menu-open, reset) no longer duplicate it.
- **5 new comments reworded** off the global banned-vocabulary list.

*(Backfilled 2026-07-24. The review ran between "Status → review" and the story
commit on 2026-07-23; its outcome lived only in the `c1706d0` commit message
until the E8 retro flagged the missing section.)*
