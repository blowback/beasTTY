---
baseline_commit: 40b6a71fb094ed832beb265cb2810bdd456b418e
---

# Story E1.4: View menu — Theme & Phosphor

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want to switch the terminal theme and phosphor colour from the View menu,
so that I can go full-retro without the chrome itself changing.

**Covers:** FR-7 (theme selection via radio submenu; Ctrl+Alt+T toggles; canvas changes, chrome does not), FR-8 (phosphor selection Green/Amber/White, enabled only under CRT; shown-but-disabled + announced under Console); NFR-2 (neutral non-adaptive shell); UX-DR2 (chrome renders identically across Console↔CRT). **AD-7** (menu-bar owns menu-item actions; relocate the same `canvas` setter + `savePrefs` the old handler called; `applyThemeSideEffects`'s phosphor *hiding* becomes menu-item **enable/disable**), **AD-9** (neutral shell; theme-driven enable/disable is behavioral and permitted — Phosphor shown-but-`data-disabled` off-CRT, replacing the old `applyThemeSideEffects` hide), **AD-3** (import allowlist), **AD-4** (prefs SSOT), **AD-14** (reset re-projection — this story fills the theme/phosphor half of the `projectPrefs` seam stood up in E1.3).
**Depends on:** E1.1 (`menu-bar.js` shell + `#dropdown-view` markup) — **done**; E1.2 (keyboard nav + `openSubmenu` routing hook) — **done**; E1.3 (`projectPrefs` reset seam, `applyPrefs` decomposition, boot order) — **done**; E0.1 (`retainFocus`) — **done**.

## ⚠️ Scope Decision — READ FIRST (theme + phosphor migrate to the View menu; this is the FIRST real submenu)

This is the story where the **incumbent `#theme-toggle` button and `#phosphor-group` radio buttons finally leave `chrome.js`/`#top-bar` and become live View-menu submenus** — the point E1.3 deferred to here ("theme + phosphor → **E1.4**", E1.3 Scope pin #1). Five scope pins:

1. **Build the second-level radio submenu mechanic.** Today `openSubmenu(item)` is a bare `return;` no-op (`menu-bar.js:328-330`) and the `Theme`/`Phosphor` rows in `#dropdown-view` are structural `data-variant="radio-submenu"` placeholders with a `▸` caret but **no child panel** (`index.html:980-987`). This story implements the actual submenu panels (CRT/Console for Theme; Green/Amber/White for Phosphor) + the open/close/keyboard mechanic. **This is the app's first working submenu** — E1.5 (Font) reuses the exact mechanic, so build it general.

2. **Remove the incumbent theme/phosphor controls and their mirrors — this story owns that.** `main.js applyPrefs` carries an explicit hand-off note (`main.js:1076-1078`): "when a later epic relocates a control into the menu bar (**E1.4 theme/phosphor** …) it owns removing the mirror here at the same time." So E1.4 deletes the `#theme-toggle` button + `#phosphor-group` markup (`index.html:1084-1089`), their `chrome.js` click wiring (`:115-142`) + `applyThemeSideEffects`/`applyPhosphorSideEffects` helpers (`:44-62`), their `applyPrefs` DOM mirrors (`main.js:1080-1085`), the module-scope consts (`main.js:163-165`), the `wireChrome` opts (`main.js:240`), and the D-19 selection-clear capture listeners (`main.js:324-333`, rehomed — see AC-5). **`#top-bar` itself is NOT removed** (it still holds `#font-select` for E1.5 + `#clear-button`; deletion completes in E7). Only the theme + phosphor controls leave it.

3. **The Ctrl+Alt+T theme chord STAYS in `chrome.js` (AD-13, E1.3 SACRED).** Do **not** move the chord. But its `toggleTheme` helper currently calls `applyThemeSideEffects` (which manipulates the now-removed button/phosphor-group DOM) — slim `toggleTheme` so it drives only the surviving side-effects (see the "two theme writers" note in Dev Notes). After the chord fires, the menu re-projects on its next open (read-at-use, AD-4) — no cross-module notify needed.

4. **Phosphor CRT-gating is behavioral enable/disable, NOT hiding (AD-9).** The old `applyThemeSideEffects` *hid* `#phosphor-group` in Console theme (`chrome.js:48-49`). AD-9 replaces that: the Phosphor submenu is **shown but `data-disabled`** (`chrome-muted`, no hover fill, skipped in nav + **announced disabled** via the `#menu-bar-live` region) whenever Theme ≠ CRT. `canvas.setPhosphor` is already a no-op off-CRT (`canvas.js:513`), so disabling is the correct guard, not a second gate.

5. **Font, Zoom, and the View ▸ Clear item are OUT of scope (E1.5).** `projectPrefs` fills **only** its theme + phosphor half this story; the font/zoom half of its body stays a documented no-op for E1.5 (`menu-bar.js:492-495`). Do **not** wire Font, Zoom, or Clear here.

**One-line summary:** E1.4 = build the radio-submenu mechanic + wire View ▸ Theme (Console (Clean)/CRT) and View ▸ Phosphor (Green/Amber/White) to `setTheme`/`setPhosphor` + `savePrefs`, disable Phosphor off-CRT (announced), fill the theme/phosphor half of `projectPrefs`, and retire the incumbent `#theme-toggle`/`#phosphor-group` — while the Ctrl+Alt+T chord, the `data-theme` scanline attribute, and the (soon-to-move) `#font-row` CRT-gating all survive intact.

## What must NOT be lost (FR-6 / NFR-3 carry-over — pin these before you delete anything)

Deleting the incumbent controls is where behavior silently dies. Three incumbent side-effects rode inside `applyThemeSideEffects` (`chrome.js:44-55`); when you remove that helper you must **re-home, not drop**, the ones whose owning control has not moved yet:

- **`document.body.setAttribute('data-theme', name)`** — drives the CRT scanline CSS layer (RENDER-04 / D-11). Set by `applyThemeSideEffects` (`chrome.js:46`) **and** `applyPrefs` (`main.js:1066`). This is a **canvas/render** side-effect of *every* theme change (chord, menu, boot, reset). **Recommended:** push it into `canvas.setTheme(name)` at the very top — after the `if (!(name in THEMES)) return;` guard (`canvas.js:478`) but **before** the same-value short-circuit (`:479`) — so all three callers get it for free and it still fires on the boot no-op (`setTheme('crt')` when `activeTheme` is already `crt`). Then drop the separate `body.setAttribute` from `applyPrefs` and the chord. This makes `setTheme` the single writer of the scanline attribute.
- **`#font-row` CRT-gating** — `applyThemeSideEffects` hid `#font-row` in Console theme (`chrome.js:50-51`). Font does **not** relocate until E1.5, so its incumbent CRT-gated visibility must survive E1.4. Re-home this as a small injected `onThemeChange(name)` callback (provided by `main.js`, `document.getElementById('font-row')?.hidden = (name !== 'crt')`) that BOTH the menu theme action and the chord invoke, and that runs at boot. Mark it verbatim `// TEMPORARY — E1.5 relocates Font; delete this font-row gate then.` (Note: the *end-state* redesign makes Font always-available per EXPERIENCE.md View IA :51 — but that is E1.5's call; E1.4 preserves the incumbent behavior.)
- **`#theme-toggle` label + `#phosphor-group` `aria-pressed`** — these mirror the *removed* controls, so they legitimately **die** with them (they do not re-home). The menu's radio check glyphs are the new state display.

The two theme/zoom chords, focus indicator, visibilitychange BEL-title-strip + repaint, and pagehide/visibilitychange SLIDE `CTRL_CAN` safety in `chrome.js` are untouched (E1.3 SACRED set) — **do not go near them** beyond slimming `toggleTheme`.

## Acceptance Criteria

1. **View ▸ Theme radio submenu switches the canvas theme; the chrome does not change (FR-7; NFR-2; UX-DR2; AD-7).**
   **Given** the View ▸ Theme submenu (`Console (Clean)` · `CRT`) opened from the `#dropdown-view` Theme row
   **When** the user selects a theme (or presses **Ctrl+Alt+T** to toggle)
   **Then** `menu-bar.js` calls `canvas.setTheme(name)` + `savePrefs({ theme: name })` (the exact setter+persist the old `#theme-toggle` handler called, relocated verbatim — `chrome.js:116-123`), the `data-theme` scanline attribute updates, the active radio's leading check glyph (`✓` in the `.check` span, `chrome-accent`) moves to the chosen row, and the choice persists across reload
   **And** the `#menu-bar`, dropdowns, and every `--chrome-*`-tokened surface render **byte-identically** before and after the switch — no scanlines, glow, or phosphor tint reaches the chrome (NFR-2/UX-DR2; verified by a chrome-appearance assertion across both themes).

2. **View ▸ Phosphor radio submenu applies phosphor under CRT; shown-but-disabled + announced under Console (FR-8; AD-9).**
   **Given** the View ▸ Phosphor submenu (`Green` · `Amber` · `White`)
   **When** Theme = CRT
   **Then** selecting a phosphor calls `canvas.setPhosphor(color)` + `savePrefs({ phosphor: color })` (relocated verbatim from `chrome.js:132-139`), the active radio check glyph moves, the canvas repaints in the chosen phosphor, and the choice persists
   **And when** Theme = Console (Clean), the Phosphor **parent row** is `data-disabled` (`chrome-muted`, no hover fill), `aria-disabled="true"`, **skipped** in keyboard nav, and **announced** with its reason via `#menu-bar-live` (e.g. "Phosphor — CRT theme only") — replacing the old `applyThemeSideEffects` phosphor-group *hide* (AD-9), never opening its submenu while disabled.

3. **Phosphor enable/disable tracks the live theme, including mid-menu (AD-9).**
   **Given** the View menu is open and the user switches Theme within the Theme submenu
   **When** they pick CRT
   **Then** the previously-disabled Phosphor row becomes live in the same interaction (no menu close/reopen needed)
   **And when** they pick Console (Clean) while the Phosphor submenu happens to be open, the Phosphor submenu collapses and its parent row returns to `data-disabled` — projected by the theme-select handler, not by a page reload.

4. **`projectPrefs` re-projects theme + phosphor on reset, idempotently and without throwing (AD-14; AD-4).**
   **Given** `menu-bar.js.projectPrefs(prefs)` — the reset subscriber whose theme/phosphor body E1.3 left as a no-op (`menu-bar.js:492-495`)
   **When** `resetPrefs()` fires (or it is called at boot, `main.js:1145`)
   **Then** it projects `p.theme` onto the Theme submenu's active-radio check glyph and `p.phosphor` onto the Phosphor submenu's, and re-derives the Phosphor row's `data-disabled` from `p.theme` — reading prefs **at use-time** (passed blob → `getPrefs()` fallback), **never** calling a canvas setter (that stays `applyPrefs`'s single-writer job), **never** writing top-level open/close state (`render()` remains the sole writer), and **never** throwing on absent DOM
   **And** calling `projectPrefs` twice yields identical DOM (idempotent); the font/zoom half of the body remains the documented E1.5 no-op.

5. **Incumbent controls retired; no behavior lost; single-writer + null-safety preserved (FR-6; NFR-3; AD-14).**
   **Given** the migration is complete
   **When** the app boots and on `resetPrefs()`
   **Then** `#theme-toggle` and `#phosphor-group` are **absent** from the DOM; `applyThemeSideEffects`/`applyPhosphorSideEffects` and the theme/phosphor click wiring are **gone** from `chrome.js` (grep-clean: no `getElementById('theme-toggle')` / `phosphor-group` / `aria-pressed` phosphor loop remains outside tests); `applyPrefs` no longer references `themeButton`/`phosphorGroup`/`phosphorButtons` and still calls `setTheme`/`setPhosphor` exactly once each on the reset path (AD-14 single-writer intact, no `null` throw)
   **And** the surviving incumbent side-effects still fire on **every** theme change and at boot: `data-theme` scanline attribute (via `setTheme`), `#font-row` CRT-gating (via the injected `onThemeChange`), and the D-19 selection-clear (rehomed onto the theme/phosphor menu actions via an injected `clearSelection` opt — matching the incumbent click-driven behavior; the chord is unchanged) — nothing regresses (`window.getSelection()` cleared on a menu theme/phosphor change; `#font-row` hidden in Console).

6. **Submenu keyboard + focus mechanic works and is retained (FR-3 carry-over; UX-DR8; UX-DR9; NFR-7).**
   **Given** a `radio-submenu` parent row (Theme or Phosphor)
   **When** the user presses Enter / → (or clicks) on it
   **Then** `openSubmenu(item)` opens the child panel (`[hidden]`/`data-*`, never inline styles), moves focus to the active (or first) radio, and `[data-focused="true"]` drives the row highlight (not `:focus-visible`); ↑/↓ move between radios, Enter/click selects, and **← or Esc** collapse the submenu back to the parent level (Esc does not fall through to the terminal while a submenu is open — the E1.2 guard still consumes it)
   **And** every submenu row uses `retainFocus` (terminal focus never stolen — "Sacred", D-16/AD-10), and a disabled Phosphor parent is skipped by ↑/↓ nav.

7. **No regression; suite green; test hooks intact (FR-6; NFR-6; AD-2).**
   **Given** the migration + submenu mechanic are in place
   **When** the full Playwright chromium suite runs
   **Then** the incumbent theme/phosphor oracles — retargeted onto the menu path — stay green (theme applies+persists, phosphor applies+persists under CRT, Phosphor disabled+announced under Console, Ctrl+Alt+T chord still toggles), and the SACRED `chrome.js` oracles (chords, focus indicator, bell title-strip, SLIDE cancel-on-hide, polite-fail) stay green — judged by **named oracles in isolation** (`--workers=1`) where the pre-existing parallel-load/wasm-boot flake interferes (E0 action item #1)
   **And** `window.__menuBar.__getStateForTests()` still exposes the E1.1/E1.2/E1.3 shape plus any additive submenu introspection, and new/extended specs cover AC-1..AC-6.

## Tasks / Subtasks

- [x] **Task 1 — Centralize the `data-theme` scanline attribute in `canvas.setTheme` (AC: 1, 5) — do FIRST; it de-risks every later deletion**
  - [x] 1.1 In `canvas.js setTheme(name)`, add `document.body.setAttribute('data-theme', name);` immediately after the invalid-name guard and **before** the same-value short-circuit, so it fires even when the theme is unchanged (boot `setTheme('crt')` no-op still sets the attribute). Guarded with `typeof document !== 'undefined'` (mirrors `applyPhosphorToTheme`) + a RENDER-04/D-11 comment.
  - [x] 1.2 **(GREEN)** Confirmed `theme-toggle.spec.js` + `phosphor.spec.js` stay green with the attribute now set by the setter.

- [x] **Task 2 — Build the radio-submenu mechanic + Theme/Phosphor panels (AC: 1, 2, 6)**
  - [x] 2.1 **Markup (`index.html`):** Theme + Phosphor parent rows wrapped in `.submenu-group`, each with a `<div class="submenu" role="menu" data-submenu-panel="…" hidden>` holding `role="menuitemradio"` buttons (`data-value` `clean`/`crt`; `green`/`amber`/`white`), leading `.check` span + `.lbl` — labels verbatim `Console (Clean)`, `CRT`; `Green`, `Amber`, `White`. Parent rows carry `data-submenu` + `aria-haspopup`/`aria-expanded`. Added right-flyout `.submenu` CSS (only `--chrome-*` tokens, 1px `chrome-border`, `rounded.md`, no drop shadow). Font stays a bare placeholder (E1.5).
  - [x] 2.2 **Open/close (`menu-bar.js`):** real `openSubmenu(item)` (resolves the panel via `data-submenu`, toggles, shows via `[hidden]`, sets `aria-expanded`, focuses active-else-first radio) + `closeSubmenu()`. New `openSubmenuPanel`/`submenuFocusIndex` module state — a DISTINCT layer; `render()` stays sole writer of top-level open/close. Submenu collapses on every top-level change (toggle/open/close/dispose/reset).
  - [x] 2.3 **Keyboard (`menu-bar.js`):** submenu branch in `onMenuKeydown` — ↑/↓ move radios, Enter/→ select, ←/Esc collapse ONE level (Esc consumed by the guard, never reaches the terminal). Disabled Phosphor parent skipped by top-level nav (filtered from `focusableItems`). `retainFocus` on every submenu row via `wireDropdownItems`.
  - [x] 2.4 **Select handlers (`menu-bar.js`):** `onRadioSelect` — Theme → `setTheme` + `savePrefs({theme})` + glyph + `onThemeChange` + `clearSelection?.()` + re-derive Phosphor disabled (AC-3); Phosphor → `setPhosphor` + `savePrefs({phosphor})` + glyph + `clearSelection?.()`. Imports `setTheme,setPhosphor` from `canvas.js` + `savePrefs` from `state/prefs.js`. Radio select keeps the menu open.

- [x] **Task 3 — Retire `#theme-toggle` + `#phosphor-group` from `chrome.js` and `index.html` (AC: 1, 2, 5)**
  - [x] 3.1 **(RED→GREEN)** Retargeted `theme-toggle.spec.js` + `phosphor.spec.js` onto the menu path (Ctrl+Alt+T chord assertion kept). Repointed `selection.spec.js`, `scrollback.spec.js`, `focus-retention.spec.js`, `menu-bar.spec.js`, `prefs.spec.js` onto the menu (or chord) — all green before markup deletion.
  - [x] 3.2 In `chrome.js`, slimmed `toggleTheme()` → `setTheme` + `onThemeChangeRef` + `savePrefsRef({theme})` (chord now persists too). Deleted `applyThemeSideEffects`, `applyPhosphorSideEffects`, `labelFor`, the theme-button click block, the phosphor click loop, and the initial paint. Dropped `themeButton`/`phosphorButtons`/`phosphorGroup` + `ctx`; added the `onThemeChange` opt; removed now-unused `setPhosphor`/`getActivePhosphor` imports. Ctrl+Alt+T chord + 4 SACRED behaviors untouched. Grep-clean.
  - [x] 3.3 In `index.html`, deleted the `#theme-toggle` button + `#phosphor-group` div + the orphaned `#phosphor-group` CSS. `#top-bar`, `#font-select`, `#clear-button` left in place. Layout sane.

- [x] **Task 4 — Decompose `main.js`: remove mirrors, rehome side-effects, wire the menu (AC: 3, 4, 5)**
  - [x] 4.1 Removed the `themeButton`/`phosphorGroup`/`phosphorButtons` consts (the `phosphorGroup.querySelectorAll` would have thrown on null once markup was gone), their `wireChrome` args, and the theme/phosphor D-19 capture listeners (zoom-chord D-19 kept).
  - [x] 4.2 In `applyPrefs`, deleted the `themeButton.textContent` / `phosphorGroup.hidden` / `phosphorButtons aria-pressed` mirrors and the redundant `body.setAttribute('data-theme')` (now `setTheme`'s job). Kept the single-writer `setTheme`/`setPhosphor`; added `onThemeChange(p.theme)` for the boot/reset font-row gate.
  - [x] 4.3 Defined one `onThemeChange(name)` helper (`#font-row` gate, `// TEMPORARY — E1.5 relocates Font`), injected into `wireChrome` (chord) + `wireMenuBar` (menu). Injected `clearSelection: () => selection.clearSelection()` into `wireMenuBar` (thunk — `selection` late-binds).
  - [x] 4.4 Filled `menu-bar.js projectPrefs` — projects `p.theme`/`p.phosphor` onto the submenu check glyphs + re-derives Phosphor `data-disabled`/`aria-disabled` from `p.theme`. Idempotent, no-throw, no canvas setters, no open/close writes, read-at-use. Font/zoom half left as the E1.5 no-op. Also called on View-menu open (`projectViewOnOpen`) so a chord-while-closed re-projects on next open.

- [x] **Task 5 — Tests + no-behavior-lost regression audit (AC: 1-7)**
  - [x] 5.1 New spec `tests/render/view-theme-phosphor.spec.js` covers (a)-(g): theme apply+persist+glyph, chrome byte-identical Console↔CRT, Phosphor disabled+announced+not-enterable under Console, mid-menu theme→CRT live-enable + collapse-on-disable + chord-while-closed read-at-use, `projectPrefs` idempotent + `resetPrefs()` re-projection, submenu keyboard (open/nav/collapse, Esc-not-terminal, `retainFocus`), `#font-row` gate, D-19 phosphor selection-clear.
  - [x] 5.2 Retargeted incumbent oracles (`theme-toggle`, `phosphor`) on the menu path + kept the Ctrl+Alt+T chord assertion; ran the SACRED set (`zoom`, `render/focus`, `bell`, `transport/slide-cancel`, `transport/polite-fail`, `menu-bar`, `menu-bar-keyboard`, `boot-order`, `menu-bar-prefs`, `clear-screen`) in isolation (`--workers=1`) — 62 green.
  - [x] 5.3 Full chromium suite: 384 passed, 1 pre-existing skip; the only failures were the known parallel-load/wasm-boot flake (E0 action item #1 — a shifting set that all pass `--workers=1`), no E1.4 regression. Grep-audit clean: `menu-bar.js` imports only `focus.js` + `state/prefs.js` (`getPrefs`,`savePrefs`) + `canvas.js` (`setTheme`,`setPhosphor`); `render()` sole top-level open/close writer; named exports only; listeners via `trackListener`; `chrome.js` grep-clean of theme-toggle/phosphor DOM.

## Dev Notes

### Developer context — what this story IS (and is NOT)

- **IS:** the theme+phosphor **View-menu wiring + control retirement**. Four concrete deliverables: (1) the **first real radio-submenu mechanic** (panels + open/close + keyboard + `retainFocus`), reused by E1.5; (2) **relocate** the theme + phosphor actions from `chrome.js` buttons to menu-item selects (same `setTheme`/`setPhosphor` + `savePrefs`, per AD-7); (3) **Phosphor enable/disable** driven by the live theme (AD-9), replacing the old hide; (4) **fill** the theme/phosphor half of the `projectPrefs` reset seam E1.3 stood up. Plus retiring `#theme-toggle`/`#phosphor-group` and re-homing the side-effects that ride along (`body[data-theme]`, `#font-row` gate, D-19 selection-clear).
- **IS NOT:** touching the Ctrl+Alt+T / zoom chords beyond slimming `toggleTheme` (chords stay in `chrome.js`, AD-13); removing `#top-bar` or `#font-select`/`#clear-button` (E1.5/E7); wiring Font, Zoom, or View ▸ Clear (E1.5); touching the four SACRED `chrome.js` behaviors; making the **chrome** theme-adaptive (NFR-2 forbids it — chrome stays neutral across the switch). **Do not front-run E1.5** (font/zoom half of `projectPrefs` stays a no-op; the E0 retro flagged repeated front-running — keep the diff to theme+phosphor).

### The single highest-risk clause: two theme writers, one truth (AD-4 / AD-7 / AD-13)

After this story, **two** live paths mutate the theme by architecture: the **Ctrl+Alt+T chord** (stays in `chrome.js`, AD-13) and the **View ▸ Theme menu** (new, AD-7). Both call `setTheme` + `savePrefs` — this duplication is *intended* (AD-13 pins chords in `chrome.js`; AD-7 relocates the menu action) and safe because `setTheme` is idempotent (same-value short-circuit, `canvas.js:479`) and `savePrefs` merges (`prefs.js:111`). The subtle part is **keeping the menu's displayed state correct after a chord fire**:

- `savePrefs` does **not** fire subscribers (AD-4, `prefs.js:117`), so the chord will not push an update into the menu. **Solution: project at use-time.** The menu re-derives its Theme/Phosphor check + disabled state from `getPrefs()` whenever the View menu opens (and via `projectPrefs` on reset). Because `savePrefs` updates `cached` **synchronously** before its 250 ms debounce (`prefs.js:111-115`), `getPrefs()` reflects a chord change immediately — so the next View-menu open is already correct. **Do not** add a `chrome.js → menu-bar` notify edge (it would violate AD-3 and re-introduce cross-module coupling). Factor the projection into one internal helper called by both `projectPrefs` (reset) and the View-open path.
- **Do NOT let `projectPrefs` or the open-path projection call `setTheme`/`setPhosphor`.** Reading state to paint check glyphs must never re-apply the canvas setter — that is `applyPrefs`'s single-writer job on reset and the select-handler's job on user action. Mixing them re-creates the AD-14 double-apply race. [Source: ARCHITECTURE-SPINE.md#AD-4 (:85-88), #AD-14 (:136-139)]

### Neutral shell is a hard constraint — the chrome must not react to the theme (NFR-2 / UX-DR2 / AD-9)

The whole point of Flow 3 (EXPERIENCE.md:227-232): "the canvas gains scanlines and green phosphor; **the chrome does not change at all**." AD-9 forbids new chrome from reading phosphor vars or branching on `[data-theme]` **for styling**; the menu bar/dropdowns/submenus consume **only** `var(--chrome-*)` (`chrome-bg #1e242c`, `chrome-fg #e4e8ee`, `chrome-accent #7fdbca`, `chrome-border`, `chrome-muted`). The permitted theme-coupling is **behavioral enable/disable** (Phosphor `data-disabled` off-CRT) — not styling. **Never** reuse phosphor green/amber decoratively in the submenu (`#33ff66` reads as "connected", amber as "action required" — DESIGN.md:148). AC-1's "chrome byte-identical across themes" assertion is the guardrail. [Source: ARCHITECTURE-SPINE.md#AD-9 (:110-114); DESIGN.md (:116,:148,:204,:206); EXPERIENCE.md (:229,:232)]

### Phosphor is CRT-only — disable, don't hide (AD-9 / FR-8)

Incumbent: `applyThemeSideEffects` set `phosphorGroup.hidden = (newTheme !== 'crt')` (`chrome.js:48-49`). AD-9 replaces the *hide* with *shown-but-`data-disabled`*: `chrome-muted` text, no hover fill (DESIGN.md:191), skipped in nav, **announced disabled** via `#menu-bar-live` (EXPERIENCE.md:201,:204 — "the Phosphor ▸ radio submenu, disabled (and announced disabled) unless Theme = CRT"). `canvas.setPhosphor` already early-returns off-CRT (`canvas.js:513`) — so the disable is the *only* gate needed; do not add a second guard in the handler. Disabling (vs hiding) keeps the control discoverable so users learn phosphor exists but is CRT-gated. [Source: ARCHITECTURE-SPINE.md#AD-9 (:114); DESIGN.md (:191); EXPERIENCE.md (:129,:201,:204)]

### Exact labels + values (verbatim — do not paraphrase)

- **Theme submenu:** `Console (Clean)` (value `clean`), `CRT` (value `crt`). Use `Console (Clean)` (EXPERIENCE.md:49 canonical) — **not** the abbreviated `Console` (DESIGN.md:190). Pref key `theme`, default `'crt'` (`prefs.js:19`). Canvas keys: `THEMES` = `{ crt, clean }`.
- **Phosphor submenu:** `Green` (value `green`), `Amber` (value `amber`), `White` (value `white`). Pref key `phosphor`, default `'green'` (`prefs.js:20`). Canvas keys: `THEMES.crt.phosphorSlots` = `{ green, amber, white }`.
- **Ctrl+Alt+T** shortcut hint (right-aligned, `chrome-muted`) may be shown on the Theme parent row (DESIGN.md:188 lists `Ctrl+Alt+T` as an example hint). The concrete chord binding lives in `chrome.js:148` — the architecture spine does **not** define it, so cite the source, not the spine. [Source: EXPERIENCE.md (:49-50,:184); DESIGN.md (:190); prefs.js:18-24; canvas.js:477-523]

### Radio-submenu visual/behavioral spec

- Parent row: `data-variant="radio-submenu"`, a `▸` `.caret` (`chrome-muted`), `aria-haspopup`/`aria-expanded`. Child radios: leading `.check` span (14px, `chrome-accent`) showing `✓` on the active row; highlighted row fills `chrome-accent` bg / `chrome-bg` text on hover/focus (DESIGN.md:187-189; mock `.mi`/`.check` classes, key-screen-chrome.html:61-69). Selecting one **deselects siblings** (EXPERIENCE.md:128) and **keeps the menu open** (AD-7 checkable/radio semantics). `[data-focused="true"]` drives the highlight — **not** `:focus-visible` (under-fires in Chromium; UX-DR8, EXPERIENCE.md:178,:203). Panel: `chrome-bg`, 1px `chrome-border`, `rounded.md` (6px), **no drop shadow** (UX-DR5). [Source: DESIGN.md (:59-70,:187-191); EXPERIENCE.md (:125,:128,:178,:203); key-screen-chrome.html (:61-69)]
- Reuse the existing `.menu-item` mechanics: `syncCheckGlyph` (`menu-bar.js:386-395`) already projects `data-checked` → `aria-checked` + `.check` text; `wireDropdownItems`/`onItemClick` (`:357-384`) already route `radio-submenu` rows to `openSubmenu`. You are filling `openSubmenu` and adding the child-panel + select layer, not rebuilding the item machinery.

### Reuse — do NOT reinvent

- **Theme/phosphor action logic already exists verbatim** — copy the semantics from `chrome.js:116-123` (`setTheme` + `savePrefs({theme})`) and `chrome.js:132-139` (`setPhosphor` + `savePrefs({phosphor})`). Do not rewrite the canvas calls; relocate them (AD-7 "relocated verbatim").
- **The Clear-action wiring from E1.3** (`menu-bar.js:103-142` — `clearScreen`/`wireClearButtons` via `trackListener` + `retainFocus`, module-scope refs `:62-64`) is the exact template for wiring a View action to real behavior. Mirror its structure for the theme/phosphor selects.
- **`projectPrefs` seam + docblock** (`menu-bar.js:467-496`) already specifies the contract (read-at-use, no-throw, idempotent, no canvas setters, no open/close writes) and names E1.4 as the theme/phosphor filler — fill it, don't redesign it.
- **`syncCheckGlyph`** (`:386-395`) for the check glyph; **`retainFocus`** (`:40`) + **`trackListener`** (`:81-84`) for every new row.
- **Subscriber + boot-call precedent** — `main.js:1133-1145` already registers `prefsSubscribe(menuBar.projectPrefs)` and calls it at boot. No new registration needed; your `projectPrefs` body just does more now.
- **`getScrollState`/thunk-style late-bind** — not needed here (no scroll dependency), but the opt-injection pattern (`onThemeChange`, `clearSelection`) mirrors how E1.3 threaded `term`/`getScrollState` into `wireMenuBar`.

### Existing code being touched (read before editing)

- **`www/renderer/chrome.js`** — **slimmed** this story. *Current:* theme-toggle button click (`:115-129`), phosphor click loop (`:131-142`), `applyThemeSideEffects` (`:44-55`, sets `body[data-theme]` + hides `#phosphor-group`/`#font-row` + button label), `applyPhosphorSideEffects` (`:57-62`, aria-pressed), `toggleTheme` (`:64-69`), initial paint (`:104-106`), Ctrl+Alt+T chord (`:144-159`, **SACRED — stays**). *Changes:* delete the button/phosphor wiring + both side-effect helpers + initial paint; slim `toggleTheme` to `setTheme`+`onThemeChange`+`savePrefs`; drop `themeButton`/`phosphorButtons`/`phosphorGroup` opts; add an `onThemeChange` opt for the chord's font-row gate. *Preserve:* the four SACRED behaviors + the Ctrl+Alt+T chord's persist behavior.
- **`www/renderer/menu-bar.js`** — **owned/extended**. *Current:* E1.1 shell + E1.2 keyboard + E1.3 clear-actions/`projectPrefs` seam; imports `focus.js` + `getPrefs` (`:40-44`); `openSubmenu` no-op (`:328-330`); `render()` sole top-level writer (`:428-451`); `projectPrefs` theme/phosphor no-op (`:487-496`). *Adds:* submenu open/close/keyboard/select mechanic, theme/phosphor select handlers, `setTheme`/`setPhosphor`/`savePrefs` imports, filled `projectPrefs` theme/phosphor body, new opts (`onThemeChange`, `clearSelection`). *Preserve:* E1.2 keydown/Esc-guard path; `render()` stays sole **top-level** open/close writer (submenu is a separate state layer).
- **`www/main.js`** — *Changes:* remove `themeButton`/`phosphorGroup`/`phosphorButtons` consts (`:163-165`), their `wireChrome` args (`:240`), the D-19 capture listeners (`:324-333`); strip the theme/phosphor DOM mirrors + `body[data-theme]` from `applyPrefs` (`:1066,:1080-1085`) keeping `setTheme`/`setPhosphor` (single-writer); add `onThemeChange`/`clearSelection` opts to `wireMenuBar` (`:265-271`); add the `onThemeChange` helper. *Preserve:* boot order, `applyPrefs` single-writer per canvas setter, the `prefsSubscribe(menuBar.projectPrefs)` + boot call (`:1133-1145`).
- **`www/renderer/canvas.js`** — *Change:* add `body[data-theme]` set at the top of `setTheme` (`:477-479`). *Preserve:* `setTheme`/`setPhosphor` guards + short-circuits; `setPhosphor`'s CRT-only early-return (`:513`).
- **`www/index.html`** — *Changes:* add Theme/Phosphor submenu panels under `#dropdown-view` (`:980-987`); delete `#theme-toggle`/`#phosphor-group` (`:1084-1089`) + orphaned CSS (`:211-219`). *Preserve:* `#top-bar`, `#font-select`, `#clear-button`; the `.menu-item`/`.check`/`.caret` CSS (`:146-174`).
- **`www/state/prefs.js`** — **not modified**; read `DEFAULTS` (`:18-24`), `savePrefs` (`:111-115`), `getPrefs` (`:171-173`), `subscribe`/`resetPrefs` (`:157-169`) to understand the read/write/fan-out you use.

### Architecture compliance (hard guardrails)

- **AD-7 (menu-bar owns actions, relocated verbatim):** theme/phosphor menu-item actions call the **same** `canvas` setter + `savePrefs` the old handler called; `applyThemeSideEffects`'s phosphor *hiding* becomes menu-item **enable/disable** (not relocated as-is). [Source: ARCHITECTURE-SPINE.md#AD-7 (:100-103)]
- **AD-9 (neutral shell + behavioral enable/disable):** submenus use only `--chrome-*`; no `[data-theme]` styling branch; Phosphor `data-disabled` off-CRT replaces the hide. [Source: #AD-9 (:110-114)]
- **AD-3 (import allowlist):** `menu-bar.js` may import **only** `renderer/canvas.js` setters (`setTheme`, `setPhosphor`) + `state/prefs.js` (`getPrefs`, `savePrefs`). Everything else (`onThemeChange`, `clearSelection`) via `wireMenuBar` opts. **Flag (spine ambiguity):** AD-3 prose (:83) lists `savePrefs` as opts-injected, but the mermaid graph edge `menu -->|direct import OK| prefs` (:57) and AD-4 (:88) treat `prefs.js` as directly importable — the graph is authoritative; `menu-bar.js` already imports `getPrefs` directly (E1.3), so adding `savePrefs` is consistent. Do **not** import `keyboard.js`/`slide*`/`serial*`. [Source: #AD-3 (:80-83); #AD-4 (:85-88)]
- **AD-4 (prefs SSOT):** write via `savePrefs(partial)`; read via `getPrefs()` at use-time (never cache); `savePrefs` doesn't fire subscribers; `subscribe` fires only on `resetPrefs()`. [Source: #AD-4 (:85-88)]
- **AD-14 (reset ownership + single-writer):** `applyPrefs` keeps exactly one `setTheme`/`setPhosphor` call each on reset; `projectPrefs` re-projects menu DOM only (no canvas setters), idempotent, no-throw. [Source: #AD-14 (:136-139)]
- **AD-13 (chrome.js retained + slimmed):** chords stay; only the theme/phosphor **menu actions** leave `chrome.js` — the four SACRED behaviors remain. [Source: #AD-13 (:131-134)]
- **AD-10 / NFR-1 ("Sacred"):** `retainFocus` on every new submenu row; nav never steals terminal focus. [Source: EXPERIENCE.md (:178)]

### Testing requirements

- **Framework:** Playwright, **chromium project**; specs at `www/tests/{render,session,transport}/*.spec.js`; server `python3 -m http.server -d . 8000`, `baseURL http://localhost:8000/`. [Source: playwright.config.js]
- **Boot-race guard:** gate on `window.__menuBar` / `window.__prefs` via `page.waitForFunction` before driving (E1.1/E1.2/E1.3 pattern).
- **Named oracles = the correctness contract (FR-6/NFR-3):** retarget `theme-toggle.spec.js` + `phosphor.spec.js` onto the menu path (keep the Ctrl+Alt+T chord assertion); keep the SACRED set green (`zoom`, `render/focus`, `bell`, `transport/slide-cancel`, `transport/polite-fail`, `menu-bar`, `menu-bar-keyboard`, `boot-order`, `menu-bar-prefs`, `clear-screen`). Assert the *downstream effect* (canvas theme applied, phosphor color on the wire/CSS var, `body[data-theme]`, selection cleared, `#font-row` hidden) — not just internal state.
- **New coverage (E1.4 slice):** theme apply+persist+chrome-unchanged; phosphor apply+persist under CRT + disabled+announced under Console + not-enterable; mid-menu theme→CRT enables Phosphor live; `projectPrefs` idempotent/no-throw + `resetPrefs()` re-projects theme+phosphor+disabled; submenu keyboard (open/nav/collapse, Esc not reaching terminal) + `retainFocus`.
- **Flake protocol (E0 action item #1):** judge regressions by named oracles in isolation (`--workers=1`); the paste/readloop/slide-chip connect-handshake trio is the known parallel-load flake, not this story. [Source: e1-3 Debug Log; epic-e0-retro-2026-07-01.md #1]

### Previous-story intelligence (E1.3 → E1.2 → E1.1 → E0)

- **E1.3 stood up exactly the seam you fill.** `menu-bar.js.projectPrefs` (`:487-496`) is a registered `prefsSubscribe` subscriber with a no-op theme/phosphor body and a comment naming E1.4 as the filler; `applyPrefs` was decomposed + null-guarded so removing controls won't crash reset (E1.3 forward-proofed `themeButton`/`phosphorGroup`/`phosphorButtons` mirrors with `if (…)` guards — you now delete those guarded blocks entirely). The boot order + chord priority are pinned by `boot-order.spec.js`; **do not reorder wiring.** [Source: e1-3 Completion Notes; menu-bar.js:487-496]
- **E1.3 kept theme/phosphor controls live "for now" and explicitly deferred them here** ("theme + phosphor → **E1.4**"). This is the hand-off. [Source: e1-3 Scope Decision #1]
- **E1.2 owns the keydown/Esc-guard layer you extend for submenu nav** — one `keydown` on `#terminal-wrapper` via `trackListener`, Esc closes+`preventDefault` when open / early-returns when closed. Your submenu ←/Esc collapse must stay inside that guard (Esc must not fall through to the terminal while a submenu is open). [Source: e1-2 Completion Notes]
- **Recurring scope-drift caution (E0.1→E1.3):** front-running has bitten this epic twice. Fill **only** theme + phosphor; leave the font/zoom half of `projectPrefs` a no-op and don't wire Font/Zoom/Clear. [Source: e1-3 Dev Notes; epic-e0-retro-2026-07-01.md]
- **Flake convention (E0 #1):** named oracles `--workers=1`. Neutral-shell pin: any new submenu CSS stays token-safe, no `[data-theme]`/phosphor branch.

### Git intelligence

Recent commits are the E1/E0 backbone (`implement E1.3: chrome.js decomposition…`, `E1.2 keyboard nav`, `E1.1 menu-bar shell`, `E0.2 openModal`, `E0.1 retainFocus`). Established patterns to mirror: **named exports; `wireXxx(opts)` shape; `window.__xxx` + `__getStateForTests` hooks; `data-*`/`[hidden]` state (never inline styles); `trackListener` for dispose; `retainFocus` on every control; test-first with named oracles judged `--workers=1`; atomic per-task commits.** This story is a **relocation + new-mechanic** — keep the theme/phosphor action logic byte-identical to `chrome.js`, and prove no incumbent side-effect (`data-theme`, `#font-row` gate, D-19 selection-clear) died in the move. Baseline: `40b6a71` (`implement E1.3`).

### Project Structure Notes

- Aligns with the `renderer/` module convention + composition-root seam. **No new module** — the submenu mechanic + theme/phosphor actions live inside the existing `menu-bar.js`; `chrome.js` shrinks; `canvas.js` gains one line. **No new import edge** beyond AD-3-permitted `menu-bar.js` → `canvas.js` setters (`setTheme`/`setPhosphor`) + `state/prefs.js` (`savePrefs`, already imports `getPrefs`).
- **Known variance (intentional, carried from E1.1/E1.3):** `#top-bar` still coexists with `#menu-bar` after this story (it keeps `#font-select` + `#clear-button`); only `#theme-toggle`/`#phosphor-group` leave it. `#top-bar` deletion completes in E7.
- **Deferred, by design:** Font submenu + Zoom items + View ▸ Clear wiring (E1.5); the `#font-row` CRT-gate is preserved as a temporary bridge, deleted when E1.5 relocates Font.

### References

- [Source: epics.md#Story-E1.4 (:326-342)] — story text + ACs (FR-7 theme, FR-8 phosphor CRT-gated).
- [Source: epics.md — FR-7 (:38), FR-8 (:39); NFR-2 (:68); UX-DR2 (:97); premise "pure relocation" (:22)]
- [Source: ARCHITECTURE-SPINE.md — AD-7 (:100-103, menu-bar owns actions, `applyThemeSideEffects` hide→enable/disable), AD-9 (:110-114, neutral shell + Phosphor `data-disabled` off-CRT), AD-13 (:131-134, chords stay), AD-14 (:136-139, reset single-writer + `projectPrefs`), AD-3 (:80-83, import allowlist), AD-4 (:85-88, prefs SSOT), AD-5 (:90-93)]
- [Source: EPIC-SPLIT.md#E1 (:31-39)] — View menu items incl. "Phosphor (shown-but-`data-disabled` in Console per AD-9)".
- [Source: DESIGN.md — radio submenu (:190), disabled variant (:191), checkable leading check (:189), action highlight (:187-188), menu-item/dropdown-panel tokens (:59-70), `--chrome-*` palette (:9-13), neutral shell (:116,:148,:204,:206), phosphor color table (:143-146)]
- [Source: EXPERIENCE.md — View IA (:45-53, Theme :49 `Console (Clean)·CRT`, Phosphor :50 `Green·Amber·White`), radio-submenu rule (:128), disabled rule (:129), Flow 3 chrome-unchanged (:227-232), Ctrl+Alt+T (:184), `[data-focused]` (:125,:178,:203), sacred focus retention (:178), phosphor radiogroup + announced-disabled (:201,:204), keyboard nav (:202)]
- [Source: www/renderer/chrome.js — theme button (:115-129), phosphor loop (:131-142), `applyThemeSideEffects` (:44-55), `applyPhosphorSideEffects` (:57-62), `toggleTheme` (:64-69), `labelFor` (:30-33), initial paint (:104-106), ctx (:95), Ctrl+Alt+T chord SACRED (:144-159)]
- [Source: www/renderer/canvas.js — setTheme (:477-493, add `body[data-theme]` at :478-479), setPhosphor CRT-only (:512-523,:513), applyPhosphorToTheme (:495-510), getActiveTheme/getActivePhosphor (:587-589)]
- [Source: www/renderer/menu-bar.js — imports (:40-44), wireMenuBar/opts (:146-204), MENUS (:47), render sole-writer (:428-451), renderFocus (:456-465), wireDropdownItems (:357-366), onItemClick (:368-384), openSubmenu no-op (:328-330), syncCheckGlyph (:386-395), projectPrefs seam + docblock (:467-496), buildApi (:500-512), __getStateForTests (:528-539), clearScreen/wireClearButtons template (:103-142), trackListener (:81-84), module refs (:62-64)]
- [Source: www/main.js — theme/phosphor consts (:162-166), canvas imports (:52-59), wireChrome call (:239-250), wireMenuBar call (:265-271), D-19 selection-clear (:324-333), applyPrefs theme/phosphor (:1064-1092), migration comment naming E1.4 (:1076-1078), prefsSubscribe(menuBar.projectPrefs)+boot call (:1133-1145)]
- [Source: www/state/prefs.js — DEFAULTS theme/phosphor (:18-24), savePrefs (:111-115), getPrefs (:171-173), subscribe (:163-169), resetPrefs (:157-161), export DEFAULTS (:210)]
- [Source: www/index.html — #theme-toggle + #phosphor-group (:1084-1089), #phosphor-group CSS (:211-219), #dropdown-view placeholders (:978-1001), .menu-item/.check/.caret/.menu-sep CSS (:146-174)]
- [Source: e1-3-…md — projectPrefs seam handoff, applyPrefs decomposition, boot-order pin, flake protocol; epic-e0-retro-2026-07-01.md — action item #1 (flake) & front-run caution]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Amelia / Dev Story workflow)

### Debug Log References

- **Test-helper race (not a code bug):** the first `selectTheme` helper opened the View menu via a title *click*. Because a radio select keeps the menu open (AD-7), a second `selectTheme` re-clicking the title *toggled it shut* → the parent row went not-visible and the click timed out. Fixed the helper to open via `window.__menuBar.open('view')` (deterministic) and click the parent+radio (real path). Same fix applied across all retargeted specs.
- **gap#3 focus:** switching to the chord for the theme flip failed because clicking `#feed` moves focus off `#terminal-wrapper` (the chord's keydown target). Retargeted gap#3 to the focus-independent menu path.
- **`#font-row` visibility:** the gate sets the `.hidden` *property*, but `#font-row` also lives inside a collapsed Settings `<details>`, so `toBeVisible()` was the wrong oracle. Asserted the `.hidden` property directly.
- **Flake protocol (E0 #1):** two full-suite runs failed a *different* set of specs (8 then 4 — paste/slide-bridge/slide-recv/reconnect/grid/file-source/slide-autosend/prefs-reset), none touching theme/phosphor/menu; every one passed `--workers=1`. Judged flake, not regression, per the named-oracle-in-isolation convention.

### Completion Notes List

- **All 7 ACs satisfied.** First real radio-submenu mechanic built (panels + open/close + keyboard + `retainFocus`), View ▸ Theme / Phosphor wired to the verbatim-relocated `setTheme`/`setPhosphor` + `savePrefs` (AD-7), Phosphor shown-but-`data-disabled`+announced off-CRT (AD-9), `projectPrefs` theme/phosphor half filled (AD-14), incumbent `#theme-toggle`/`#phosphor-group` retired.
- **Surviving side-effects re-homed, none lost:** `body[data-theme]` centralised into `setTheme` (single writer, fires on the boot no-op); `#font-row` CRT-gate via the shared `onThemeChange` helper (chord + menu + boot/reset), marked TEMPORARY for E1.5; D-19 selection-clear rehomed onto the Theme/Phosphor menu actions via injected `clearSelection` (chord unchanged — it never cleared selection).
- **Two-theme-writers handled per Dev Notes:** the Ctrl+Alt+T chord (chrome.js, AD-13) and the View ▸ Theme menu (AD-7) both `setTheme`+`savePrefs`. The chord now persists too (story-requested). No `chrome.js → menu-bar` notify edge (AD-3): the menu re-derives from `getPrefs()` on every View-menu open (`projectViewOnOpen`) — `savePrefs` updates `cached` synchronously so the next open is correct. Reading state never calls a canvas setter (no AD-14 double-apply).
- **AD-3 clean:** `menu-bar.js` imports only `focus.js` + `state/prefs.js` (`getPrefs`,`savePrefs`) + `canvas.js` (`setTheme`,`setPhosphor`). No `keyboard.js`/`slide*`/`serial*`. Named exports only; all listeners via `trackListener`; `render()` remains the sole top-level open/close writer (submenu is a separate `openSubmenuPanel` layer).
- **Scope held:** Font/Zoom/View ▸ Clear + the font/zoom half of `projectPrefs` left as the documented E1.5 no-op. `#top-bar`/`#font-select`/`#clear-button` retained (E1.5/E7). No front-running.
- **Tests:** 62 SACRED oracles green (`--workers=1`); retargeted incumbent oracles green; new `view-theme-phosphor.spec.js` (14 tests) green; full suite 384 passed / 1 pre-existing skip, only the known flake failing (all pass in isolation).

### File List

- `www/renderer/canvas.js` — `setTheme` now sets `body[data-theme]` (single writer, pre-short-circuit).
- `www/renderer/menu-bar.js` — radio-submenu mechanic (open/close/keyboard/select), `onRadioSelect`/`setRadioChecked`/`syncPhosphorDisabled`, filled `projectPrefs` + `projectViewOnOpen`, `setTheme`/`setPhosphor`/`savePrefs` imports, `onThemeChange`/`clearSelection` opts, submenu introspection in `__getStateForTests`.
- `www/renderer/chrome.js` — slimmed `toggleTheme()`; deleted `applyThemeSideEffects`/`applyPhosphorSideEffects`/`labelFor` + theme-button + phosphor wiring + initial paint; added `onThemeChange`/`savePrefs` module refs; trimmed imports.
- `www/main.js` — removed theme/phosphor consts + `wireChrome` args + D-19 capture listeners + `applyPrefs` mirrors + redundant `body[data-theme]`; added `onThemeChange` helper; injected `onThemeChange`/`clearSelection` into `wireMenuBar`.
- `www/index.html` — View ▸ Theme/Phosphor submenu panels + `.submenu` CSS; deleted `#theme-toggle`/`#phosphor-group` markup + orphaned CSS.
- `www/tests/render/theme-toggle.spec.js` — retargeted onto View ▸ Theme (chord assertions kept).
- `www/tests/render/phosphor.spec.js` — retargeted onto View ▸ Phosphor (Console → `data-disabled`, not hidden).
- `www/tests/render/view-theme-phosphor.spec.js` — **new** — full E1.4 AC-1..AC-6 slice.
- `www/tests/render/menu-bar.spec.js` — AC-5 neutral-shell test uses the chord.
- `www/tests/input/focus-retention.spec.js` — theme/phosphor focus-retention via the menu.
- `www/tests/session/selection.spec.js` — D-19 theme selection-clear via the menu.
- `www/tests/session/scrollback.spec.js` — theme-switch-keeps-offset via the menu.
- `www/tests/session/prefs.spec.js` — phosphor debounce + reset re-projection via the menu.

## Change Log

| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2026-07-02 | 0.1 | Story drafted — comprehensive context engineering. Scope: build the first real radio-submenu mechanic + wire View ▸ Theme (Console (Clean)/CRT) and View ▸ Phosphor (Green/Amber/White) to `setTheme`/`setPhosphor`+`savePrefs` (AD-7 verbatim relocation), Phosphor shown-but-`data-disabled`+announced off-CRT (AD-9), fill the theme/phosphor half of the `projectPrefs` reset seam (AD-14), and retire `#theme-toggle`/`#phosphor-group`. Explicitly preserves the surviving incumbent side-effects (`body[data-theme]` scanline attr → centralized into `setTheme`; `#font-row` CRT-gate as a temporary E1.5 bridge; D-19 selection-clear rehomed onto the menu actions) and keeps the Ctrl+Alt+T chord in `chrome.js` (AD-13). Font/Zoom/Clear + the font/zoom half of `projectPrefs` deferred to E1.5. | Amelia (create-story) |
| 2026-07-02 | 1.0 | Story implemented + all ACs verified. Built the radio-submenu mechanic (panels/open-close/keyboard/`retainFocus`), wired View ▸ Theme & Phosphor (AD-7 verbatim `setTheme`/`setPhosphor`+`savePrefs`), Phosphor shown-but-`data-disabled`+announced off-CRT with live re-derivation (AD-9/AC-3), centralised `body[data-theme]` into `setTheme`, filled `projectPrefs` + added `projectViewOnOpen` read-at-use (AD-14/AD-4), retired `#theme-toggle`/`#phosphor-group`, re-homed the `#font-row` gate + D-19 selection-clear, kept the Ctrl+Alt+T chord in `chrome.js` (AD-13). New `view-theme-phosphor.spec.js` + retargeted incumbent oracles; SACRED set + full suite green modulo the known E0 flake. Status → review. | Amelia (Dev Story) |
| 2026-07-02 | 1.1 | Code-review fixes. (1) Fixed stale open View menu after the Ctrl+Alt+T chord: `onThemeChange` (main.js) is now the single shared post-theme hook and re-projects the menu via `projectPrefs`, with `chrome.js` `toggleTheme` persisting before invoking it so the re-projection reads fresh prefs — an already-open menu no longer keeps a stale theme ✓ / stale-enabled Phosphor (AD-9). (2) `onRadioSelect` now `refreshLiveRegion()`s after `syncPhosphorDisabled` so the disabled reason re-announces immediately. (3) `openNeighbour` no longer double-renders (new `focusFirstRow` path on `openMenuNamed`). (4) Extracted shared `nextWrappedIndex`/`clearFocused` helpers to dedup the top-level/submenu nav idioms. Added a "chord while menu OPEN" regression test. Full affected suites green. Status → done. | Code review |
