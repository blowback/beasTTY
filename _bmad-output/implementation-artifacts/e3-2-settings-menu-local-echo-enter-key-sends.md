---
baseline_commit: 6b61ba9e89ec1239a3e2acbe6af30c21061f2fbe
---

# Story E3.2: Settings menu — Local echo & Enter-key-sends

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want local-echo and Enter-key behavior in a Settings menu,
so that I can match my MicroBeast software's line-ending expectations.

**Covers:** FR-18 (Local echo toggle — checkable, persisted), FR-19 (Enter key sends — CR/LF/CRLF radio submenu).
**Epic:** E3 · File, Settings & Transfer Configuration. **Depends on:** E0 (`retainFocus`), E1.1 (menu-bar shell + `#dropdown-settings` placeholder rows), E1.2 (keyboard nav + Esc-guard), E1.4 (radio-submenu mechanic `openSubmenu`/`onRadioSelect`/`setRadioChecked`), E1.5 (Font = the 3rd radio submenu, the exact "fill a bare parent row + add an `onRadioSelect` branch" template), E2.2 (the generic `data-pref` checkable-persist seam, built **explicitly for this story**).

**Premise (epic-wide, confirmed — `epics.md:22-24`):** pure **relocation**. Every control keeps its exact v1.1 behavior and only moves to a new home. Both behaviors — local-echo (`keyboard.js` echoes TX bytes through the parser) and Enter-key CR/LF/CRLF rewrite (`keyboard.js` `CRLF_MODES`) — **already exist and work**, driven today by the legacy `<details id="settings">` pane (`#local-echo` checkbox + `#crlf-*` radios) wired in `main.js`. Both prefs (`localEcho: false`, `crlfMode: 'cr'`) already exist in `prefs.js`. This is a **wiring** story: point the two un-wired Settings-menu placeholder rows at the *same* live keyboard setters + `savePrefs` the legacy handlers call.

**Relocation strategy — inject-the-setter (chosen), not import-the-module (blocked), not persist-only (a bug).** `menu-bar.js` may import **only** `canvas.js` + `prefs.js` (AD-3) — it **cannot** import `keyboard.js`. So `setLocalEcho`/`setCrlfMode` reach menu-bar as **injected `wireMenuBar` opts** (exactly as E2.1 injected `toggleConnection`, E2.3 `openSerialConfig`, E3.1 `sendFile`). **The single most important correctness point:** persisting alone (`savePrefs`) is **not enough** — `savePrefs` does **not** fire subscribers (AD-4), so the *live* `keyboard.js` module state only changes if you also call the setter. The incumbent handler calls **both** `setLocalEcho(v)` **and** `savePrefs({localEcho:v})` (`main.js:1043-1046`); the menu must do the same, or the toggle will look like it worked (glyph flips) but have zero effect until reload. The legacy `#local-echo` / `#crlf-*` controls **coexist** until `#top-bar`/`<details>` retire in E7 (E1 retro open action #5) — keep them in lockstep with a menu→pane mirror.

## Acceptance Criteria

Verbatim epic ACs (`epics.md` §Story E3.2, lines 448-464) decomposed and made testable. AC-1/AC-2 are the epic's two ACs; AC-3…AC-7 make the implicit "the setting actually takes effect / persists / stays in lockstep with the coexisting legacy control / no regression" requirements falsifiable.

**AC-1 — Local echo toggle flips the pref, applies live, keeps the menu open, reflects the check (FR-18; AD-7, AD-4).**
**Given** the Settings menu is open and the "Local echo" checkable row (`index.html:1253-1256`, now given `id="menu-local-echo-item"` + `data-pref="localEcho"`)
**When** the user activates it (click or Enter)
**Then** it toggles `prefs.localEcho` via the generic `data-pref` seam `savePrefs({ localEcho: <next> })` (AD-4 — no other key touched), **and** calls the injected `setLocalEcho(<next>)` so the live `keyboard.js` echo path (`keyboard.js:312`) takes effect **immediately** (no reload), the **menu stays open** (checkable semantics — no `closeMenu()`), and the row's `data-checked` + `aria-checked` + leading `.check` glyph (`✓`/``) flip in lockstep via `syncCheckGlyph`
**And** with local echo ON, a typed character is echoed once to the canvas (mirrored through `term.feed`); with it OFF, typed characters are not locally echoed. (Same for pasted input — `paste-pump.js:128` reads `getLocalEcho()` at use-time, so the one setter covers both keyboard and paste.)

**AC-2 — Enter-key-sends radio submenu persists + applies the chosen line ending (FR-19; AD-7, AD-4).**
**Given** the Settings ▸ "Enter key sends" radio submenu (the bare parent row `index.html:1257-1259` filled with a child panel of three `menuitemradio` rows — `CR (0x0D)` value `cr` · `LF (0x0A)` value `lf` · `CRLF (0x0D 0x0A)` value `crlf`)
**When** the user selects one (click or ↑/↓+Enter)
**Then** `menu-bar.js` calls the injected `setCrlfMode(value)` (updating live `keyboard.js` state at `:75`) **and** `savePrefs({ crlfMode: value })`, the active radio's check glyph moves to the chosen row (siblings deselected via `setRadioChecked`), the choice persists across reload, and the menu (and submenu) **stay open** (radio semantics, AD-7)
**And** thereafter pressing Enter transmits exactly the chosen bytes: `cr`→`[0x0D]`, `lf`→`[0x0A]`, `crlf`→`[0x0D,0x0A]` (via `keyboard.js:303-305` `CRLF_MODES[crlfMode]`; paste path matches via `paste-pump.js:146`). `data-value` on each radio is the exact mode id (`cr`/`lf`/`crlf`) that `setCrlfMode`'s validator accepts (`keyboard.js:94`).

**AC-3 — Both rows re-derive from prefs at every entry point: wire, open, reset (FR-18/FR-19; AD-14, AD-4).**
**Given** `prefs.localEcho` (default `false`) and `prefs.crlfMode` (default `'cr'`)
**When** the menu-bar wires at boot, when the Settings menu **opens** (read-at-use, mirroring `projectMenuOnOpen`'s `connection` branch), and when `resetPrefs()` fires (the `menuBar.projectPrefs` subscriber)
**Then** the Local echo row's `data-checked`/glyph is derived from `getPrefs().localEcho`, and the Enter-key submenu's active radio is derived from `getPrefs().crlfMode` (via `setRadioChecked`) — never from a hardcoded literal. A fresh page shows Local echo **unchecked** and the **CR** radio checked. `projectPrefs` must project these **before** the View-dropdown early-return (mirroring E2.2's auto-connect placement) so a View-less harness still gets the reset re-projection. Read at use-time, no-throw, idempotent, never a setter into `keyboard.js` (that stays `applyPrefs`'s single-writer job — AC-6).

**AC-4 — Lockstep with the coexisting legacy pane controls (FR-6, NFR-3 — no incumbent behavior lost).**
**Given** the legacy `#local-echo` checkbox (`index.html:1406`) and `#crlf-*` radios (`index.html:1413-1415`) still exist during the E7 coexistence window, wired in `main.js` (`:1043-1046`, `:1062-1081`), and `savePrefs` does **not** fire subscribers (AD-4)
**When** the user toggles Local echo / picks an Enter-key mode **in the menu**, the matching legacy control updates to agree (menu→pane mirror: `#local-echo.checked = next`; the three `#crlf-*` radios' `.checked` set to `value===radio.value`); **and when** the user changes the **legacy** control, the menu row re-derives correctly the next time the Settings menu opens (pane→menu via AC-3's open re-derive)
**And** because both the menu handler and the legacy handler call the same live setter (`setLocalEcho`/`setCrlfMode`) + `savePrefs`, the *behavior* never diverges even mid-session — only the two surfaces' visible check state is what the mirror keeps aligned. The mirror lines carry an E7-retirement marker.

**AC-5 — Focus retention + cross-cutting invariants (NFR-1/AD-10 "Sacred"; NFR-2/AD-9; NFR-5; NFR-6).**
Both rows (and the three radios) retain terminal focus on click — `retainFocus` is already applied to every `.menu-item` by `wireDropdownItems`; after any activation `document.activeElement.id === 'terminal-wrapper'`. The new submenu panel + rows use only `var(--chrome-*)` tokens and the existing `.submenu`/`.menu-item`/`.check`/`.caret` CSS (no new palette, no new CSS — the E1.4/E1.5 submenu styles are reused). No new dependencies, no build step; `window.__menuBar` + `__getStateForTests` extended not broken. **No `prefs.js` schema change / no `CURRENT_VERSION` bump** (`localEcho` + `crlfMode` already exist).

**AC-6 — Single-writer + AD-3 seam preserved (NFR-4; AD-3, AD-14).**
`menu-bar.js` must **not** import `keyboard.js` — `setLocalEcho`/`setCrlfMode` arrive **only** as injected `wireMenuBar` opts (from `main.js`, which already imports them at `:72`). On **reset**, `applyPrefs` remains the **single writer** of live `keyboard.js` state (`setLocalEcho(p.localEcho)` `main.js:1221`, `setCrlfMode(p.crlfMode)` `:1223`) **and** of the legacy pane DOM (`:1222`, `:1224-1226`) — leave those lines untouched. `menu-bar.js projectPrefs` re-projects **only its own two menu rows' DOM** (check glyph / radio check), never a keyboard setter and never the legacy DOM. No behavior gets two writers.

**AC-7 — Suite stays green; existing stub specs updated; boot order preserved (FR-6, AD-12).**
The full Playwright chromium suite passes. The specs that already target the (previously un-wired) Settings placeholder rows are **updated**, not deleted: `tests/render/menu-bar.spec.js:144-149` and `tests/render/menu-bar-keyboard.spec.js:194-199` currently exercise `#dropdown-settings .menu-item[data-variant="checkable"]` as a bare glyph-toggle — they must pass against the now pref-backed row (glyph flip **plus** `getPrefs().localEcho` persistence + `setLocalEcho` applied). New coverage exercises the Enter-key radio submenu (persist + `getCrlfMode()` + Enter-byte assertion), the menu↔pane lockstep, and reset re-projection. Boot order untouched: `wireMenuBar` before `wireKeyboard`; polite-fail first.

## Tasks / Subtasks

- [x] **Task 1 — Wire the Local echo checkable row to persist + apply `localEcho` (AC-1, AC-4, AC-6).**
  - [x] `index.html` — added `id="menu-local-echo-item"` + `data-pref="localEcho"` to the Local echo row.
  - [x] `menu-bar.js` — inject `setLocalEcho` opt → module ref `setLocalEchoRef` (null-guarded), in the `wireMenuBar` opts block beside the E2.2/E3.1 refs.
  - [x] `menu-bar.js` — in the generic checkable branch, after `savePrefs({ [prefKey]: next })`, added the `localEcho` side-effect beside the `autoConnect` mirror: `setLocalEchoRef?.(next)` (live apply) + `#local-echo` legacy mirror (E7 marker). Still `return;` (menu stays open).
  - [x] `main.js` — inject `setLocalEcho` into `wireMenuBar({…})`.

- [x] **Task 2 — Build the Enter-key-sends radio submenu (fill the bare parent, add the `crlf` branch) (AC-2, AC-4, AC-6).**
  - [x] `index.html` — wrapped the bare parent in a `.submenu-group`; parent got `data-submenu="crlf"` + `aria-haspopup`/`aria-expanded`; added the `data-submenu-panel="crlf"` panel with three `menuitemradio` rows (`cr`/`lf`/`crlf`, byte-annotated labels verbatim from the legacy `#crlf-*`). Default check = CR. Reused existing `.submenu` CSS (no new CSS).
  - [x] `menu-bar.js` — inject `setCrlfMode` → `setCrlfModeRef`. Added the `else if (group === 'crlf')` branch in `onRadioSelect`: setter + `savePrefs` + `setRadioChecked` + the `input[name="crlf"]` legacy mirror (E7 marker). No `clearSelection`, no disabled gating.
  - [x] `main.js` — inject `setCrlfMode` into `wireMenuBar`.

- [x] **Task 3 — Re-derive both rows on open + on reset (AC-3).**
  - [x] `menu-bar.js` — added `projectLocalEcho(prefs)` (clone of `projectAutoConnect`): read-at-use, no-throw, idempotent, no setter.
  - [x] `menu-bar.js` — `projectMenuOnOpen()` gained the `openMenu === 'settings'` branch: `projectLocalEcho()` + `setRadioChecked(crlfPanelEl, getPrefs().crlfMode)`.
  - [x] `menu-bar.js` — `projectPrefs(prefs)` re-projects `projectLocalEcho(p)` + crlf radio **before** the `viewDropdown` early-return (E2.2 placement precedent). Cached `crlfPanelEl`.
  - [x] `menu-bar.js` — `projectLocalEcho()` called once at `wireMenuBar` initial paint (beside `projectAutoConnect()`); `localEchoItemEl`/`crlfPanelEl` discovered by id/data.

- [x] **Task 4 — Coexistence + relocation hygiene (AC-4, AC-6).**
  - [x] Legacy `#local-echo` + `#crlf-*` controls and their `main.js` handlers left functional; the two menu→pane mirror lines carry E7-retirement markers. `applyPrefs` (`main.js:1221-1226`) untouched — still the single writer of live keyboard state + legacy DOM on reset.
  - [x] Did **not** wire the `Reset all preferences` row or add SLIDE/reserved-Ctrl rows (E3.3/E3.4). Settings ships exactly Local echo + Enter-key-sends.

- [x] **Task 5 — Tests (AC-1…AC-7).**
  - [x] **Updated** `tests/render/menu-bar.spec.js:141` + `tests/render/menu-bar-keyboard.spec.js:191` (the Settings-checkable stub tests): kept the glyph/aria/menu-open assertions, extended to assert `getPrefs().localEcho` persisted + `window.__keyboardState.getLocalEcho()` applied (persist ≠ apply). Added `window.__keyboardState = { getLocalEcho, getCrlfMode }` read-only hook in `main.js` (mirrors `window.__canvasState`).
  - [x] **New spec** `tests/render/menu-bar-settings.spec.js` (chromium project, 7 tests): Local echo toggle persist + `#local-echo` mirror + live echo of a keystroke (grid) + OFF-again; Enter-key radio persist + `#crlf-*` mirror + Enter transmits chosen bytes (`#tx-strip` oracle, `lf`/`crlf`/default-`cr`); reset re-projection via `projectPrefs(...)` + real `resetPrefs()` subscriber; focus retention after each activation.
  - [x] Regression: `npm test` (chromium) → 267 passed / 0 failed (6 known focus-boot flakes passed on retry, 1 skipped); `chromium-transport` → 171 passed. New spec 7/7 clean. No `--workers=1` used.

## Dev Notes

### The one-paragraph mental model

Both behaviors already work through the **legacy** `<details id="settings">` pane: `#local-echo` → `setLocalEcho` + `savePrefs`, `#crlf-*` radios → `setCrlfMode` + `savePrefs`, both wired in `main.js`. The two prefs (`localEcho`, `crlfMode`) already exist. E3.2 flips the two **un-wired** Settings-**menu** placeholder rows into live controls driving the *same* `keyboard.js` setters (reached via injected opts, since AD-3 blocks importing `keyboard.js`) + `savePrefs`, keeps them in lockstep with the coexisting legacy controls, and re-derives them from prefs on open/reset. Local echo reuses the ready-made E2.2 `data-pref` checkable seam; Enter-key-sends is the **4th** radio submenu, built from the E1.5 "fill a bare parent + add an `onRadioSelect` branch" template. **Zero new mechanic, zero new pref, zero schema change** — the only genuinely-new code is two `onRadioSelect`/checkable side-effect branches + a `projectLocalEcho` clone.

### ⚠️ The one correctness trap — persist ≠ apply

`savePrefs` **does not fire subscribers** (AD-4; only `resetPrefs` does). The E2.2 generic `data-pref` seam does `savePrefs({[key]:next})` and nothing else — that was fine for `autoConnect` (its effect is boot-time only, no live setter). **`localEcho` and `crlfMode` have live effect**, so the menu MUST also call `setLocalEcho`/`setCrlfMode` in the same handler, exactly as the incumbent `main.js` handlers do (`:1044`+`:1045`, `:1065`+`:1066`). If you only `savePrefs`, the glyph flips and the pref persists, but nothing changes until the next reload (when `applyPrefs` calls the setter) — a silent, easy-to-miss bug. One setter call covers **both** keyboard-typed and pasted input, because `paste-pump.js` reads `getLocalEcho()`/`getCrlfMode()` from `keyboard.js` module state at use-time.

### Exact code sites (verified against `6b61ba9`)

**`www/index.html`:**
- `:1250-1265` — Settings `menu-group`: `#menu-settings` title + `#dropdown-settings`. **Local echo row `:1253-1256`** (checkable stub — add `id`+`data-pref`). **Enter key sends row `:1257-1259`** (bare `radio-submenu` parent, NO `data-submenu`/panel — fill it). `menu-sep` `:1260`. Reset row `:1261-1263` (E3.3 — do not touch).
- `:1149-1163` (Theme) / `:1192-1216` (Font) — the copy-this radio-submenu-group markup template (parent `data-submenu` + `.submenu` panel with `menuitemradio` rows).
- `:1136-1137` — wired Auto-connect checkable (`id`+`data-pref="autoConnect"`) — the copy-this template for the Local echo row.
- **Legacy coexistence controls** (retire with `#top-bar` in E7): `#local-echo` checkbox `:1406`; `#crlf-cr/lf/crlf` radios `:1413-1415`, all inside `<details id="settings">` `:1400`.

**`www/renderer/menu-bar.js`:**
- `:235` `wireMenuBar(opts)`; opts intake + ref assignment block (add `setLocalEcho`/`setCrlfMode` refs); DOM element caching (~`:360`, add `#menu-local-echo-item` + crlf panel refs); initial-paint region (add `projectLocalEcho()`).
- `:640-675` `onRadioSelect` — dispatch on `data-submenu-panel`; add the `crlf` branch after the `font` branch (`:666-673` is the exact shape: setter + `savePrefs` + `setRadioChecked`).
- `:680-685` `setRadioChecked`; `:879-888` `syncCheckGlyph` (single source of truth = `data-checked`).
- `:761-783` generic checkable branch — add the `localEcho` side-effect beside the `autoConnect` mirror (`:778-781`).
- `:928-937` `projectMenuOnOpen` — add the `settings` branch. `:943-948` `projectAutoConnect` — clone as `projectLocalEcho`.
- `:1113-1139` `projectPrefs` — add localEcho + crlf projection **before** the `viewDropdown` early-return (E2.2 placement precedent).
- **AD-3 import guard:** `menu-bar.js` imports ONLY `focus.js`, `state/prefs.js` (`getPrefs`/`savePrefs`), `canvas.js`. Do **not** add a `keyboard.js` import — the setters come via opts.

**`www/input/keyboard.js` (read-only — the behavior to drive, do NOT modify):**
- `:66-70` `CRLF_MODES` (`cr`/`lf`/`crlf` → byte arrays). `:74-75` module state. `:90-91` `setLocalEcho`/`getLocalEcho`. `:93-97` `setCrlfMode` (validates `cr`/`lf`/`crlf`) / `getCrlfMode`. `:303-305` Enter-byte rewrite. `:312-317` local-echo feed.

**`www/input/paste-pump.js` (read-only — proves one setter covers paste too):**
- `:12` imports `getLocalEcho`/`getCrlfMode`/`CRLF_MODES`. `:128-133` paste local-echo. `:144-166` paste CR/LF rewrite.

**`www/main.js`:**
- `:72` `import { wireKeyboard, setLocalEcho, setCrlfMode } from './input/keyboard.js'` (already imported — just inject into `wireMenuBar`).
- `wireMenuBar({…})` opts block (inject `setLocalEcho`, `setCrlfMode`). `window.__menuBar`.
- `:237-238` legacy refs (`localEchoCheckbox`, `crlfRadios`). `:1043-1046` / `:1055-1057` local-echo change + mousedown handlers. `:1062-1081` crlf change + mousedown handlers. `:1221-1226` `applyPrefs` reset single-writer (setters + legacy DOM mirror) — **leave untouched**.

### What must be preserved (non-negotiable — AD-13 / FR-6 / NFR-3 / NFR-4)

- The `keyboard.js` behavior + `CRLF_MODES` table are **read-only** — this story only changes *which UI* calls the exported setters.
- Local echo is applied identically for keyboard **and** paste (single `keyboard.js` state, read at use-time by `paste-pump.js`). One `setLocalEcho` call is sufficient and correct.
- `setCrlfMode`'s validator (`keyboard.js:94`) silently ignores anything other than `cr`/`lf`/`crlf` — the radio `data-value`s must be exactly those ids.
- Legacy `#local-echo` / `#crlf-*` keep working through E7; `applyPrefs` stays the single writer of live keyboard state + legacy DOM on reset (`main.js:1221-1226`). The menu-bar mirrors the legacy DOM in-session but never on the reset path (that's `applyPrefs`'s job).
- Boot order (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. No `prefs.js CURRENT_VERSION` bump (no schema change).
- Checkable/radio keep-menu-open semantics (AD-7) — neither the Local echo toggle nor a radio pick may `closeMenu()`.

### Reuse — do NOT reinvent

- **`data-pref` checkable seam is done (E2.2, `menu-bar.js:761-783`)** — built explicitly for this story (E2 retro §6, `epic-e2-retro-2026-07-03.md:83`). Local echo needs only `id`+`data-pref` on the row + a `localEcho` side-effect branch (setter + mirror) beside the `autoConnect` one. Do not build a new toggle path.
- **Radio-submenu mechanic is done (E1.4/E1.5)** — `openSubmenu`/`closeSubmenu`/`submenuItems`/`onRadioSelect`/`setRadioChecked`/`panelForParent`. Enter-key-sends needs only the child-panel markup + a `crlf` branch in `onRadioSelect` — `panelForParent` resolves `data-submenu="crlf"` automatically once the panel exists. Do not build a new submenu layer. (E1.5 §Scope pin 1 is the exact "bare parent row → fill it" precedent — Font was in the same state this Enter-key row is in now.)
- **`projectAutoConnect` (`:943-948`) is the exact template for `projectLocalEcho`.** Same shape: read pref at use-time → `data-checked` + `syncCheckGlyph`, no-throw, idempotent.
- **The menu→pane mirror is done (E2.2, `:778-781`).** Clone the `autoConnect` legacy-checkbox mirror for `#local-echo`; the crlf radios mirror is the same idea over three `input[name="crlf"]` radios.

### Absent decision — no CRT-gating for Enter-key-sends (contrast Font)

Font is `data-disabled` off-CRT (E1.5, because it's a no-op on the vector renderer). Enter-key-sends has **no such gate** — line endings apply on every theme. Do **not** add `syncSubmenuDisabled`/`syncFontDisabled`-style gating to the crlf submenu. It is always live.

### Testing standards + codified idioms (E1 retro action #4 / E2 retro action #1 — still open, re-embedded)

- **Boot-race guard first:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')`.
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('settings'))` — never a title `.click()`.
- **Click a checkable / radio:** `page.click('#dropdown-settings .menu-item[data-pref="localEcho"]')`; open the crlf parent (`[data-submenu="crlf"]`) then click a radio (`[data-value="lf"]`).
- **Menu-stays-open assertion:** `window.__menuBar.getOpenMenu() === 'settings'` after a checkable/radio activation.
- **Check-glyph / radio lockstep:** assert `data-checked` + `.check` textContent (`✓`/``) + `aria-checked` move together (`menu-bar.spec.js:199-210` glyph idiom).
- **Pref persistence:** `await page.evaluate(() => window.__prefs.getPrefs().localEcho)` / `.crlfMode`.
- **Live-apply assertion:** local-echo → type a key, assert one echoed glyph on the canvas grid (`__testGridView()` per `main.js:471`); crlf → drive Enter and capture TX bytes via the same hook the incumbent `keyboard`/`paste-pump` oracles use.
- **`retainFocus` assertion:** `document.activeElement.id === 'terminal-wrapper'` after any activation.
- **Prefs seeding before goto:** `page.addInitScript(() => localStorage.setItem('beastty.prefs', JSON.stringify({...})))` (single options arg — the E2.2 debug-log gotcha: `addInitScript(fn, a, b)` passes only one arg).
- **Projects/run:** render specs → `chromium` project; the flake mask is `chromium-transport` `fullyParallel:false` `retries:1`. `npm test` / `npm run test:fast` (`@fast`).

### Project Structure Notes

- **No new module** — extends `renderer/menu-bar.js`, injects two setters via `main.js` opts, fills `index.html` markup, adds/updates specs. `keyboard.js`/`paste-pump.js`/`prefs.js` unmodified.
- **New IDs** kebab-case + `menu-`-prefixed: `#menu-local-echo-item` (matching `#menu-autoconnect-item`); the crlf submenu uses `data-submenu="crlf"`/`data-submenu-panel="crlf"` (matching the `name="crlf"`/`#crlf-*`/`CRLF_MODES` convention). Named exports only; no default exports; no new deps; no build step (AD-1).
- **Superseded IA note:** EXPERIENCE.md `:62-65` lists more Settings rows (SLIDE File Transfer…, Browser-reserved Ctrl…, Reset All Preferences…). Those are **E3.3/E3.4** — the current `#dropdown-settings` shell has only Local echo + Enter-key-sends + a Reset stub. This story wires exactly the first two; do not front-run E3.3/E3.4.
- **E7 coexistence:** two new menu→pane mirror lines (`#local-echo`, `#crlf-*`) join the E7 dual-chrome retirement checklist (E1 retro action #5 / E2 retro action #4). Leave marker comments.

### References

- [Source: `epics.md`#Story-E3.2 (lines 448-464)] — user story + the two epic ACs (FR-18, FR-19).
- [Source: `epics.md`#FR-18 (line 49), #FR-19 (line 50)] — verbatim FR text (Local echo checkable+persisted; Enter-key radio CR/LF/CRLF).
- [Source: `ux-designs/.../EXPERIENCE.md`#Settings (lines 55-65), #Component-Patterns (checkable :127, radio-submenu :128)] — Settings IA (`Local echo ✓` was `#local-echo`; `Enter key sends ▸ CR/LF/CRLF` was "crlf radios"); checkable = menu stays open; radio = mutual exclusion.
- [Source: `ux-designs/.../DESIGN.md`#Components (lines 184-193)] — checkable leading-check glyph ("Local echo ✓"); radio submenu `▸` (names Enter-key-sends); tokens; `field-bg`.
- [Source: `architecture/.../ARCHITECTURE-SPINE.md`#AD-3 (:80-83), #AD-4 (:85-88), #AD-7 (:100-103), #AD-10 (:116-119), #AD-12 (:126-129), #AD-14 (:136-139)] — import allowlist (keyboard reached via opts), prefs SSOT (`savePrefs` no fan-out), menu-bar owns dropdowns / checkable-keeps-open, retainFocus sacred, boot order, reset re-projection single-writer.
- [Source: `www/input/keyboard.js:66-70, 74-75, 90-97, 303-305, 312-317`] — `CRLF_MODES`; `localEcho`/`crlfMode` state; setters/getters/validator; Enter-byte rewrite; local-echo feed.
- [Source: `www/input/paste-pump.js:12, 128-133, 144-166`] — paste path reads `getLocalEcho`/`getCrlfMode` at use-time (one setter covers both).
- [Source: `www/state/prefs.js:15-16, 25-26`] — `beastty.prefs` / `CURRENT_VERSION=1`; `localEcho:false`, `crlfMode:'cr'` defaults; `savePrefs` no fan-out, `resetPrefs` fans out.
- [Source: `www/renderer/menu-bar.js:640-675, 680-685, 761-783, 879-888, 928-948, 1113-1139`] — `onRadioSelect`, `setRadioChecked`, generic checkable+`data-pref`+autoConnect-mirror, `syncCheckGlyph`, `projectMenuOnOpen`, `projectAutoConnect`, `projectPrefs`.
- [Source: `www/main.js:72, 237-238, 1043-1046, 1055-1057, 1062-1081, 1221-1226`] — keyboard-setter imports; legacy refs; incumbent change/mousedown handlers; `applyPrefs` reset single-writer.
- [Source: `www/index.html:1250-1265` (Settings menu), `1136-1137` (Auto-connect template), `1149-1163`/`1192-1216` (Theme/Font submenu template), `1400-1416` (legacy pane controls)].
- [Source: `_bmad-output/.../e2-2-auto-connect-toggle-choose-microbeast.md`] — the `data-pref` checkable-persist seam + menu→pane mirror precedent (built for this story).
- [Source: `_bmad-output/.../e1-5-view-menu-font-zoom-clear.md`] — the "fill a bare radio-submenu parent + add an `onRadioSelect` branch" template (Font); no-D-19/no-gating contrast.
- [Source: `_bmad-output/.../e3-1-file-menu-send-file-download-session-log.md`, `epic-e2-retro-2026-07-03.md`] — injected-opt relocation shape; E3-readiness (§6: `data-pref` seam ready); open action items honored.
- [Source: `www/tests/render/menu-bar.spec.js:144-149`, `menu-bar-keyboard.spec.js:194-199`] — existing Settings-stub specs to update to pref-backed assertions.

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **CRLF radio label.** EXPERIENCE.md `:60` / epic AC write the third option as bare `CRLF`; the legacy radio (`index.html:1415`) and its CR/LF siblings show bytes (`CR (0x0D)`, `LF (0x0A)`, `CRLF (0x0D 0x0A)`). **Recommended default:** `CRLF (0x0D 0x0A)` — parallel with CR/LF (which both show bytes) and byte-identical to the legacy v1.1 label (pure-relocation premise). Rejected: bare `CRLF` (loses the byte hint the other two rows carry). One-line change if Ant prefers bare.
2. **Menu↔pane lockstep during coexistence.** **Recommended default:** menu→pane mirror (`#local-echo` + `#crlf-*`) + pane→menu open-re-derive, matching E2.2's auto-connect treatment (both surfaces always agree in-session). Rejected: no mirror (behavior still correct via shared setter, but the stale legacy checkbox/radio could confuse during the E7 window). Retires with `#top-bar`.
3. **`data-submenu` key name for Enter-key-sends.** **Recommended default:** `"crlf"` (matches `name="crlf"`/`#crlf-*`/`CRLF_MODES`). Alternative: `"enter-key"` (matches the visible label). `crlf` keeps the whole feature's vocabulary consistent with the existing code.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow)

### Debug Log References

None — no HALT conditions hit. Suite green on first full run (known focus-boot flakes passed on retry via `retries:1`, per the flake protocol; no per-story `--workers=1`).

### Completion Notes List

- Pure **wiring** story as scoped: the two Settings-menu placeholder rows now drive the SAME `keyboard.js` setters (`setLocalEcho`/`setCrlfMode`) the legacy `#local-echo`/`#crlf-*` controls call, reached via injected `wireMenuBar` opts (AD-3 — `keyboard.js` is NOT imported by `menu-bar.js`). No `keyboard.js` / `paste-pump.js` / `prefs.js` change; no schema/`CURRENT_VERSION` bump; no new CSS; no new deps.
- **Correctness trap honored (persist ≠ apply):** both handlers call the injected setter AND `savePrefs` — `savePrefs` does not fan out (AD-4), so persisting alone would flip the glyph but leave the live echo/CR-LF path unchanged until reload. Verified live by the new spec (typed-char grid echo; Enter-byte `#tx-strip` assertion).
- **Reuse, not reinvent:** Local echo rode the ready-made E2.2 `data-pref` checkable seam (`id`+`data-pref` + a `localEcho` side-effect branch). Enter-key-sends is the 4th radio submenu, built from the E1.5 "fill a bare parent + add an `onRadioSelect` branch" template — `panelForParent` resolves `data-submenu="crlf"` automatically. `projectLocalEcho` clones `projectAutoConnect`.
- **Coexistence:** menu→pane mirrors for `#local-echo` and the three `input[name="crlf"]` radios carry E7-retirement markers. `applyPrefs` (`main.js:1221-1226`) left untouched — still the single writer of live keyboard state + legacy DOM on reset. `projectPrefs` re-projects only the two menu rows' DOM, never a setter.
- **Q1/Q2/Q3 recommended defaults taken:** byte-annotated `CRLF (0x0D 0x0A)` label (parallel with CR/LF, verbatim from legacy); menu→pane mirror + pane→menu open-re-derive lockstep; `data-submenu="crlf"` key name.
- Added `window.__keyboardState = { getLocalEcho, getCrlfMode }` (read-only, mirrors `window.__canvasState`) so tests can assert the LIVE keyboard state actually changed — the direct proof of persist ≠ apply.

### File List

- `www/index.html` (modified — Local echo `id`+`data-pref`; Enter-key-sends radio submenu markup)
- `www/renderer/menu-bar.js` (modified — `setLocalEchoRef`/`setCrlfModeRef` + DOM refs; opts intake; `localEcho` checkable side-effect; `crlf` `onRadioSelect` branch; `projectLocalEcho`; `projectMenuOnOpen` settings branch; `projectPrefs` re-projection; initial paint)
- `www/main.js` (modified — inject `setLocalEcho`/`setCrlfMode` into `wireMenuBar`; import + expose `window.__keyboardState`)
- `www/tests/render/menu-bar.spec.js` (modified — extended the checkable stub test with persist + apply assertions)
- `www/tests/render/menu-bar-keyboard.spec.js` (modified — extended the keyboard-activate checkable stub test with persist + apply assertions)
- `www/tests/render/menu-bar-settings.spec.js` (new — 7 specs covering AC-1…AC-5)

### Code Review

`code-review` (high effort, 8 finder angles) run on 2026-07-03. **0 correctness bugs, 0 convention violations.** 5 cleanup/altitude findings (all maintainability, none blocking): per-pref `if` ladder in `onItemClick`, `projectLocalEcho`/`projectAutoConnect` duplication, crlf projection duplicated across open+reset paths, double `getPrefs()` per Settings open, unconditional `onStateChange` fire. None applied — deferred as non-blocking cleanup. Story marked done.

### Change Log

- 2026-07-03 — E3.2 implemented: Settings ▸ Local echo (FR-18) + Enter key sends (FR-19) wired to live `keyboard.js` setters via injected opts + `savePrefs`, with menu→pane lockstep and open/reset re-projection. 6 files touched (3 src, 3 test; 1 new spec). Suite green (chromium 267, transport 171). Status → review.
