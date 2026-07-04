---
baseline_commit: df6bc9504f2ff1595fc4f9d4fbce327c6b1616c7
---

# Story E5.1: Debug menu & panel toggle

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder,
I want to toggle an in-page debug panel from a Debug menu,
so that the debug widgets are available on demand but out of the way by default.

**Covers:** FR-23 (Show Debug Panel toggle — checkable, default OFF; panel hosts `#input`, Feed / 64 KB Stress / Paste test, TX-strip, Reset TX; AD-11).
**Epic:** E5 · Debug Menu & In-Page Debug Panel. **Depends on:** E1.1 (menu-bar shell + the `#dropdown-debug` "Show Debug Panel" placeholder row), E1.2 (keyboard nav + Esc-guard), E2.2 (the generic `data-pref` checkable-persist seam — `menu-bar.js:847-881`), E3.2 (the "checkable with a LIVE side-effect via an injected setter" template — Local echo). **Does NOT depend on E4** (E5 depends on E1 only — `epics.md:189`); E4.2 already did E5's one prerequisite (moved `#build-sha` out of the debug pane — see below).

**Premise — a THIRD mode: relocate-and-KEEP (not relocate-and-delete, not build-new).** E0–E3 removed legacy `<details>` panes; E4 built new status-bar chrome. E5 is the **one surface that stays in-page** (AD-11): the debug widgets (`#input`, Feed / 64 KB Stress / Paste test, TX-strip `<pre>`, Reset TX) are **relocated but kept**, now gated behind a Debug ▸ Show Debug Panel checkable (default OFF) instead of the native `<details>` disclosure. Plan acceptance against **still-works-after-move**: every widget must remain functional after the container changes. This is the **one pane that survives the E7 dual-chrome sweep** (E4 retro §6 / action #7 — it relocates behind the Debug menu and stays; it does not retire).

**The one-sentence shape.** This is the `localEcho` story again, minus a submenu and minus a legacy-checkbox mirror: a **new persisted boolean pref** (`showDebugPanel`, default `false`) rides the ready-made E2.2 `data-pref` checkable seam; because it has a **LIVE DOM effect** (show/hide the panel), the menu handler must ALSO call an injected setter (persist ≠ apply — AD-4); `applyPrefs` becomes the single writer of the panel's visibility on boot/reset; and `menu-bar.projectDebugPanel` re-derives only the ROW GLYPH on open/reset. The only genuinely-new work beyond wiring is (a) adding the pref default, (b) converting the widgets' `<details>` container into a menu-toggled default-hidden panel, and (c) one setter closure + one checkable side-effect branch + one `projectCheckable` wrapper.

## Acceptance Criteria

Verbatim epic ACs (`epics.md` §Story E5.1, lines 562-578) decomposed and made testable. AC-1/AC-2 are the epic's two ACs; AC-3…AC-7 make the implicit "persists / applies live / re-derives on reset / no widget regression / suite stays green" requirements falsifiable.

**AC-1 — Show Debug Panel toggle shows/hides the panel, persists, keeps the menu open, reflects the check (FR-23; AD-11, AD-7, AD-4).**
**Given** the Debug menu is open and the "Show Debug Panel" checkable row (`index.html:1502-1505`, now given `id="menu-debug-panel-item"` + `data-pref="showDebugPanel"`)
**When** the user activates it (click or Enter)
**Then** it toggles `prefs.showDebugPanel` via the generic `data-pref` seam `savePrefs({ showDebugPanel: <next> })` (AD-4 — no other key touched), **and** calls the injected `setDebugPanelVisible(<next>)` so the in-page debug panel shows/hides **immediately** via `[hidden]`/`data-*`/`open` (no reload), the **menu stays open** (checkable semantics — no `closeMenu()`), and the row's `data-checked` + `aria-checked` + leading `.check` glyph (`✓`/``) flip in lockstep via `syncCheckGlyph`.

**AC-2 — The panel hosts ONLY the debug widgets; they still work after the move; build info is NOT here (FR-23; AD-11).**
**Given** the panel is shown
**When** it renders
**Then** it contains ONLY the `#input` textarea, the Feed (`#feed`) / 64 KB Stress (`#stress64k`) / Paste test (`#paste-test`) buttons, the TX-strip `<pre id="tx-strip">`, and Reset TX (`#tx-reset`) — **all still functional** after relocation (Feed parses+feeds bytes, 64 KB Stress runs the SC-4 payload, Paste test enqueues, typing on the terminal updates `#tx-strip`, Reset TX clears it)
**And** build info does **NOT** live here — `#build-sha` was already relocated to the status bar `#status-build` in E4.2 (see the standing comment at `index.html:1700-1702`); do **not** re-add any build identifier to the panel.

**AC-3 — Default OFF ⇒ COMPLETELY INVISIBLE; the row + panel re-derive from prefs at every entry point: wire, open, reset (FR-23; AD-11, AD-14, AD-4).**
**Given** `prefs.showDebugPanel` (default `false`)
**When** the menu-bar wires at boot, when the Debug menu **opens** (read-at-use), and when `resetPrefs()` fires (the `menuBar.projectPrefs` subscriber)
**Then** the row's `data-checked`/glyph is derived from `getPrefs().showDebugPanel` via `projectDebugPanel` (never from the HTML `data-checked="false"` literal), and the **panel's visibility** is derived from the same pref by `applyPrefs` (single writer — AC-6). When OFF the panel is **completely invisible — NO on-screen furniture at all**: no `<summary>`/"Debug" disclosure triangle, no empty bordered container box, nothing (the container generates no box — `display:none`, not merely a collapsed-but-present element). A fresh page shows the row **unchecked** and **zero** debug furniture on screen; after a reload with the pref ON, the page boots with the row checked and the panel shown (`applyPrefs(prefs)` runs once at boot — `main.js:1434`). `projectDebugPanel` must project **before** the View-dropdown early-return in `projectPrefs` (the E2.2/E3.2 placement precedent) so a View-less harness still gets the reset re-projection.

**AC-4 — No legacy mirror needed; the native `<details>` disclosure is fully suppressed as furniture (FR-6, NFR-3 — no incumbent behavior lost, one behavior deliberately retired).**
**Given** the widgets currently live in `<details id="debug"><summary>Debug</summary>…</details>` (`index.html:1697-1719`), whose native summary-click was the old show/hide and whose closed state still paints a "Debug" triangle + box on the page
**When** the Debug menu becomes the toggle
**Then** the `<summary>` disclosure is **no longer a user-facing control and paints nothing** (the menu is the sole toggle — the stray in-page "Debug" triangle the redesign exists to remove must not remain, in EITHER the on or off state), and there is **no coexisting legacy checkbox to mirror** (unlike E3.2's `#local-echo`) — so `menu-bar.js` adds **no** menu→pane mirror line for this pref. Every child widget id (`#input`/`#feed`/`#stress64k`/`#paste-test`/`#tx-strip`/`#tx-reset`) is **preserved verbatim** so the `main.js` widget handlers (`:1224-1332`) are untouched.

**AC-5 — Focus + cross-cutting invariants (NFR-1/AD-10 "Sacred"; NFR-2/AD-9; NFR-5; NFR-6).**
The "Show Debug Panel" row retains terminal focus on click — `retainFocus` is already applied to every `.menu-item` by `wireDropdownItems`; after activation `document.activeElement.id === 'terminal-wrapper'`. **Do NOT add `retainFocus` to the incumbent debug widgets** (`#input`/`#feed`/etc.) — they are relocated verbatim, not new chrome; the `#input` textarea is meant to take focus for typing (pure relocation — no focus-behavior change). The panel container uses only `var(--chrome-*)` tokens (DESIGN.md `debug-panel`: `field-bg` bg, `chrome-fg` text, 1px `chrome-border`, `rounded/sm`); no phosphor vars, no `[data-theme]` branch (AD-9). No new dependencies, no build step. `window.__menuBar` + `__getStateForTests` extended not broken.

**AC-6 — Single-writer + AD-3 seam preserved (NFR-4; AD-3, AD-14).**
`menu-bar.js` must **not** import any panel/module — `setDebugPanelVisible` arrives **only** as an injected `wireMenuBar` opt. On **reset/boot**, `applyPrefs` is the **single writer** of the panel's live visibility (`setDebugPanelVisible(p.showDebugPanel)`), placed on the `main.js applyPrefs` reset path beside `setLocalEcho(p.localEcho)` (`:1368`). `menu-bar.js projectDebugPanel` re-projects **only its own row's DOM** (check glyph / aria), never the panel node. No behavior gets two writers: the panel visibility is written by exactly the injected setter (from the menu handler on toggle, from `applyPrefs` on reset/boot).

**AC-7 — Suite stays green; the debug-widget fixtures + specs are updated for the container change; boot order preserved (FR-6, AD-12).**
The full Playwright chromium suite passes. **This is the story's main regression surface:** ~15 existing specs reveal the debug widgets via `page.locator('#debug').evaluate(el => el.open = true)` and then drive `#input`/`#tx-strip`/`#tx-reset` as byte-injection oracles (see Dev Notes §"The regression surface"). Whatever container mechanism is chosen (Q1), **every one of those fixture call sites must still reveal the widgets** — verified by a green suite, not by inspection. `tx-debug-strip.spec.js` (the direct test of the widgets) gets a menu-driven reveal. A **new** spec `menu-bar-debug.spec.js` (modeled on `menu-bar-settings.spec.js`) covers: default OFF (row unchecked + panel hidden), toggle shows the panel + persists + keeps the menu open + glyph/aria lockstep, toggle again hides it, reset re-projection via `projectPrefs({ showDebugPanel: true })` + a real `resetPrefs()`, focus retention, and one widget-still-works assertion after the move. Boot order untouched: `wireMenuBar` before `wireKeyboard`; polite-fail first. **No `prefs.js CURRENT_VERSION` bump** (new boolean field rides the defensive merge — see Dev Notes).

## Tasks / Subtasks

- [x] **Task 1 — Add the `showDebugPanel` pref default (AC-3, AC-7).**
  - [x] `state/prefs.js` — added `showDebugPanel: false` to the frozen `DEFAULTS` object, beside `localEcho`/`autoConnect`. `CURRENT_VERSION` NOT bumped — `loadPrefs`'s defensive spread-merge fills the missing key for existing stored blobs.

- [x] **Task 2 — Make the widgets' container completely invisible until enabled, menu-driven (AC-2, AC-3, AC-4). Q1 RESOLVED — see Q1 for the exact mechanism.**
  - [x] `index.html` — kept the element `<details id="debug">` and drive visibility off the `open` attribute, preserving every child widget id verbatim (`#input`/`#feed`/`#stress64k`/`#paste-test`/`#tx-strip`/`#tx-reset`) and the `.hint` copy. Kept the E4.2 comment — build info stays out.
  - [x] `index.html` CSS — added the two visibility rules: `#debug summary { display: none; }` (native disclosure paints nothing; menu is the sole toggle) and `#debug:not([open]) { display: none; }` (off ⇒ zero on-screen furniture; setting `open` reveals it). Converted the open-panel styling to DESIGN.md `debug-panel` tokens (`var(--field-bg)` bg, `var(--chrome-fg)` text, 1px `var(--chrome-border)`, `border-radius: 4px` = rounded/sm) — replacing the hardcoded hex.
  - [x] `setDebugPanelVisible(v)` drives `debugEl.open = v` (Task 3) — preserves the ~30 `el.open = true` fixtures verbatim (green suite confirms).

- [x] **Task 3 — Wire the checkable row to persist + apply `showDebugPanel` (AC-1, AC-6).**
  - [x] `index.html` — added `id="menu-debug-panel-item"` + `data-pref="showDebugPanel"` to the "Show Debug Panel" row, matching the `#menu-local-echo-item` template.
  - [x] `main.js` — defined `const debugEl = document.getElementById('debug'); const setDebugPanelVisible = (v) => { if (debugEl) debugEl.open = v; };` (single writer of the panel's live visibility) and injected it into `wireMenuBar({…})` beside `setLocalEcho`.
  - [x] `menu-bar.js` — destructured `setDebugPanelVisibleRef = opts.setDebugPanelVisible || null` beside `setLocalEchoRef`. In the generic checkable branch, after `savePrefs`, added the `showDebugPanel` side-effect `setDebugPanelVisibleRef?.(next)` beside the `localEcho` one. No legacy mirror (AC-4). Still `return;` (menu stays open).

- [x] **Task 4 — Re-derive the row on wire/open/reset; apply the panel on reset/boot (AC-3, AC-6).**
  - [x] `menu-bar.js` — added `projectDebugPanel(prefs) { projectCheckable(debugPanelItemEl, 'showDebugPanel', prefs); }` (clone of `projectLocalEcho`); discover `debugPanelItemEl = document.getElementById('menu-debug-panel-item')` + initial `projectDebugPanel()` in the wire-time paint region.
  - [x] `menu-bar.js` — `projectMenuOnOpen()`: added `if (openMenu === 'debug') projectDebugPanel();`.
  - [x] `menu-bar.js` — `projectPrefs(p)`: added `projectDebugPanel(p)` before the `viewDropdown` early-return.
  - [x] `main.js` — `applyPrefs(p)`: added `setDebugPanelVisible(p.showDebugPanel)` beside `setLocalEcho(p.localEcho)` — single writer of the panel on reset/boot. `applyPrefs(prefs)` at boot applies the initial panel state (verified by the persisted-ON reload spec).

- [x] **Task 5 — Tests (AC-1…AC-7).**
  - [x] **Updated the direct widget fixture**: `tx-debug-strip.spec.js` now reveals the panel via the menu (`revealDebugPanel` local helper) instead of `#debug`.open — proving the real user path. The other ~30 `el.open = true` sites are left verbatim (still valid: visibility keys off the `open` attribute — no sweep needed, per resolved Q1). Q3 resolved: no shared `www/tests/helpers/` extraction forced (intentionally per-story).
  - [x] **New spec** `tests/render/menu-bar-debug.spec.js` (chromium project), modeled on `menu-bar-settings.spec.js`: default OFF ⇒ completely invisible (`#debug`/`#input`/`#debug summary` all hidden + row unchecked); toggle → panel visible (`#input` visible, `#debug` has `open`) + `getPrefs().showDebugPanel === true` + menu stays open + glyph/aria lockstep; toggle again → hidden; reset re-projection via `projectPrefs({ showDebugPanel: true })` + a real `resetPrefs()` (row AND panel restored); `retainFocus` after activation; Feed `#input` → grid oracle (widget still works after move); persisted-ON survives reload.
  - [x] Regression: `chromium` 335 passed / 1 skipped (2 flaky, passed on retry — known boot-race) + `chromium-transport` 169 passed (2 flaky, passed on retry — known transport flakes). Flake protocol followed (`retries:1`; no `--workers=1`).

## Dev Notes

### The one-paragraph mental model

The debug widgets already work — they're wired ad-hoc in `main.js` by id (`#feed`/`#stress64k`/`#paste-test`/`#tx-reset`/`#input`/`#tx-strip`), inside a leftover `<details id="debug">` whose native `<summary>` is today's show/hide. E5.1 (a) adds a **new persisted boolean** `showDebugPanel` (default OFF), (b) turns the widgets' container into a **menu-toggled, default-hidden panel** (retiring the `<summary>` as the toggle), and (c) wires the pre-existing Debug ▸ "Show Debug Panel" placeholder row to persist the pref (E2.2 `data-pref` seam) **and** apply it live via an injected `setDebugPanelVisible` setter (E3.2 template). `applyPrefs` owns the panel's visibility on boot/reset (single writer); `menu-bar.projectDebugPanel` owns only the row glyph. **Zero new mechanic** — it's `localEcho` with a different side-effect and no legacy mirror.

### ⚠️ Correctness trap #1 — persist ≠ apply

`savePrefs` **does not fire subscribers** (AD-4; only `resetPrefs` does). The generic `data-pref` seam does `savePrefs({[key]:next})` and nothing else — fine for `autoConnect` (boot-time only). **`showDebugPanel` has a LIVE effect** (the panel must show/hide now), so the menu handler MUST also call `setDebugPanelVisible(next)` in the same branch, exactly as `localEcho` calls `setLocalEchoRef?.(next)` (`menu-bar.js:875`). Persisting alone flips the glyph and survives reload but leaves the panel unchanged until the next `applyPrefs` — a silent bug.

### ⚠️ Correctness trap #2 — the regression surface (the big one for this story)

The debug widgets double as **byte-injection test fixtures** across the suite. ~15 specs reveal them with `await page.locator('#debug').evaluate((el) => { el.open = true; });` then `page.fill('#input', …)` / assert `#tx-strip` / click `#tx-reset`. Known sites (verified against `df6bc95`):

- `tests/render/tx-debug-strip.spec.js` — the **direct** test of these widgets (`el.open=true` at `:9,:17,:30`).
- `tests/render/bell.spec.js` (×3), `tests/render/focus.spec.js` (×3), `tests/render/grid.spec.js` (×2), `tests/render/menu-bar-keyboard.spec.js` (×2), `tests/render/menu-bar-settings.spec.js` (×2, at `:102,:137` — reveals `#tx-strip` as the Enter-byte oracle), `tests/render/zoom.spec.js`, `tests/render/phosphor.spec.js`, `tests/render/hidpi.spec.js`, `tests/render/cursor.spec.js`, `tests/render/theme-toggle.spec.js`.
- Plus `#input`-referencing specs under `tests/input/` and `tests/transport/` (e.g. `local-echo.spec.js`, `crlf-override.spec.js`, `keydown-*.spec.js`, `ime-composition.spec.js`, `transport/paste.spec.js`).

**If the container stops being a `<details>` (or defaults to `[hidden]`), `el.open = true` becomes a no-op and `page.fill('#input', …)` times out on a hidden element — the suite goes red.** Whatever Q1 mechanism is chosen, either (a) keep `el.open` working, or (b) sweep every site to a menu/pref-driven reveal (ideally a shared `revealDebugPanel(page)` helper). Grep before you start: `grep -rn "#debug'" www/tests/` and `grep -rln "el.open = true" www/tests/`.

### Exact code sites (verified against `df6bc95`)

**`www/index.html`:**
- `:1499-1507` — Debug `menu-group`: `#menu-debug` title + `#dropdown-debug`. **"Show Debug Panel" row `:1502-1505`** (checkable stub — no `id`, no `data-pref`; add both).
- `:1431-1434` — `#menu-local-echo-item` checkable (the copy-this row template: `role="menuitemcheckbox"` + `data-variant="checkable"` + `data-pref` + `data-checked`/`aria-checked` + leading `<span class="check">`). `:1308-1311` — `#menu-autoconnect-item` (same shape).
- `:1697-1719` — **`<details id="debug">`** container: `<summary>Debug</summary>` `:1699`; the E4.2 build-info-relocated comment `:1700-1702`; `#input` `:1710`; `#feed`/`#stress64k`/`#paste-test` `:1712-1714`; `#tx-strip` `:1717`; `#tx-reset` `:1718`.
- `:452-483` — `#debug` / `#debug summary` / `#debug textarea` / `#debug button` / `#debug .hint` / `#debug code` CSS (rework for the new container). `:558` — `#tx-strip` CSS (id-scoped, keep). `:216` — the `.dropdown[hidden]{display:none}` convention; the app-wide `[hidden]` idiom (e.g. `#paste-progress-row[hidden]` `:644`) is the model if you go `[hidden]`.

**`www/renderer/menu-bar.js`:**
- `:57` `const MENUS = ['file','connection','view','settings','debug','help']` (Debug already in the loop; the discovery loop `:333-344` already wires `#menu-debug`/`#dropdown-debug`).
- `~:306` opts intake block — add `setDebugPanelVisibleRef = opts.setDebugPanelVisible || null;` (beside `setLocalEchoRef` `:306`).
- `~:403-427` initial-paint region — discover `debugPanelItemEl` + call `projectDebugPanel()` (beside `autoConnectItemEl`/`localEchoItemEl` discovery + `projectAutoConnect()`/`projectLocalEcho()`).
- `:847-881` generic checkable branch — add the `showDebugPanel` side-effect (`setDebugPanelVisibleRef?.(next)`) beside `localEcho` (`:875`). No mirror.
- `:1081-1092` `projectCheckable` + `projectAutoConnect`/`projectLocalEcho` wrappers — add `projectDebugPanel`.
- `:1057-1074` `projectMenuOnOpen` — add the `debug` branch.
- `projectPrefs(p)` (the reset subscriber) — add `projectDebugPanel(p)` before the `viewDropdown` early-return.
- **AD-3 import guard:** `menu-bar.js` imports ONLY `focus.js`, `state/prefs.js`, `canvas.js` (`:47`). Do **not** import the panel/keyboard — the setter comes via opts.

**`www/main.js`:**
- `:376-457` `wireMenuBar({…})` opts block (inject `setDebugPanelVisible`; `:444` `setLocalEcho` is the sibling). `:458` `window.__menuBar`.
- `:285-286,:314` widget refs (`txStripEl`/`txResetButton`/`pasteTestBtn`); `:1224-1332` widget handlers (TX observer, Reset TX, Paste test, Feed, 64 KB Stress) — **leave untouched** (they key off ids that are preserved).
- `:1341+` `applyPrefs(p)` — add `setDebugPanelVisible(p.showDebugPanel)` (beside `setLocalEcho(p.localEcho)` `:1368`). `:1433-1434` `prefsSubscribe(applyPrefs); applyPrefs(prefs);` (reset + boot). `:1444` `prefsSubscribe(menuBar.projectPrefs)`.

**`www/state/prefs.js`:**
- `:16` `CURRENT_VERSION = 1` (do NOT bump). `:18-58` `DEFAULTS` (add `showDebugPanel:false`). `:33-35,:42-44` the "add a boolean field without a version bump" precedent. `:89,:94` defensive merge. `savePrefs` no fan-out; `resetPrefs`/migration fan out.

### What must be preserved (non-negotiable — AD-11 / FR-6 / NFR-3 / NFR-4)

- **Every debug-widget id** (`#input`/`#feed`/`#stress64k`/`#paste-test`/`#tx-strip`/`#tx-reset`) verbatim → `main.js:1224-1332` handlers untouched. The widgets stay **functional after the move** (AC-2).
- **Build info does NOT return to the panel** — E4.2 relocated `#build-sha` to `#status-build`; the `:1700-1702` comment records it (EXPERIENCE.md `:73`). Don't re-add it.
- **Single-writer:** `applyPrefs` owns panel visibility on reset/boot; the menu handler owns it on toggle (both via the ONE injected setter). `projectDebugPanel` touches only the row glyph — never the panel node (AD-14).
- Boot order (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. No `CURRENT_VERSION` bump.
- Checkable keep-menu-open semantics (AD-7) — the toggle must not `closeMenu()`.

### Reuse — do NOT reinvent

- **`data-pref` checkable seam is done (E2.2, `menu-bar.js:847-881`).** Show Debug Panel needs only `id`+`data-pref` on the row + a `showDebugPanel` side-effect branch (setter call) beside `localEcho`. No new toggle path.
- **`projectCheckable`/`projectLocalEcho` (`:1081-1092`) is the exact template for `projectDebugPanel`.** Same shape: read pref at use-time → `data-checked` + `syncCheckGlyph`, no-throw, idempotent, no setter.
- **The injected-setter-with-live-effect pattern is done (E3.2 localEcho).** `setDebugPanelVisible` is injected exactly like `setLocalEcho`; the only difference is it lives as a `main.js` closure over the panel node (there is no owning module) rather than an import from `keyboard.js`.
- **No submenu, no radio, no legacy mirror, no CRT-gating.** Simpler than E3.2.

### Testing standards + codified idioms (E1 retro #4 / E2 #1 / E3 #1 / E4 — still open, re-embedded; see Q3 for the extraction call)

- **Boot-race guard first:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')` (plus `window.__prefs.getPrefs`).
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('debug'))` — never a title `.click()`.
- **Click the checkable:** `page.click('#dropdown-debug .menu-item[data-pref="showDebugPanel"]')`.
- **Menu-stays-open assertion:** `window.__menuBar.getOpenMenu() === 'debug'` after the toggle.
- **Glyph/aria lockstep:** assert `data-checked` + `.check` textContent (`✓`/``) + `aria-checked` move together (`menu-bar.spec.js` glyph idiom).
- **Pref persistence:** `await page.evaluate(() => window.__prefs.getPrefs().showDebugPanel)`.
- **Invisible-when-OFF assertion (Ant's requirement):** `await expect(page.locator('#debug')).toBeHidden()` on a fresh page (the container is `display:none` via `#debug:not([open])`), and no visible "Debug" summary.
- **Panel-visible-when-ON assertion:** `toBeVisible()` on `#input` after the toggle, `#debug` carries the `open` attribute, and `#input` is fillable.
- **Reset re-projection:** drive `window.__menuBar.projectPrefs({ showDebugPanel: true })` directly AND a real `window.__prefs.resetPrefs()` (asserts the subscriber path + `applyPrefs` panel single-writer).
- **`retainFocus`:** `document.activeElement.id === 'terminal-wrapper'` after activating the row.
- **Prefs seeding before goto:** `page.addInitScript(() => localStorage.setItem('beastty.prefs', JSON.stringify({...})))` (single options arg — the E2.2 `addInitScript(fn,a,b)` one-arg gotcha).
- **Projects/run:** render specs → `chromium` project; flake mask is `chromium-transport` `fullyParallel:false` `retries:1`. `npm test` / `npm run test:fast` (`@fast`). No per-story `--workers=1`.

### Project Structure Notes

- **No new runtime module required** — extends `renderer/menu-bar.js`, adds a `main.js` setter closure + opt, adds a `prefs.js` default, converts the `index.html` container, adds/updates specs. (Q3 flags an optional tiny `renderer/debug-panel.js` if AD-2 module-purity is preferred over a `main.js` closure.)
- **New id** kebab-case + `menu-`-prefixed: `#menu-debug-panel-item` (matching `#menu-local-echo-item`). Container id per Q1 (`#debug` kept, or `#debug-panel`). Named exports only; no default exports; no new deps; no build step (AD-1).
- **E7 note:** the debug panel is the **one pane that does NOT retire** in the E7 dual-chrome sweep — it relocates behind the Debug menu and stays (E4 retro action #7). Record this on the E7 checklist so the panel is not swept with `#top-bar`/`<details>`.

### References

- [Source: `epics.md`#Story-E5.1 (lines 562-578)] — user story + the two epic ACs (FR-23, AD-11).
- [Source: `epics.md`#FR-23 (line 54)] — verbatim FR (Show Debug Panel checkable, default OFF; panel hosts `#input`, Feed/64KB Stress/Paste test, TX-strip, Reset TX).
- [Source: `ux-designs/.../EXPERIENCE.md`#Debug (lines 67-73), #Persistent-in-page (lines 94-98), #Component-Patterns (checkable :127, Debug panel :132)] — Show Debug Panel checkable default OFF; panel holds ONLY the debug widgets; build info in Help ▸ About not here; checkable = menu stays open.
- [Source: `ux-designs/.../DESIGN.md`#Components (lines 197), #tokens (debug-panel :100-104, field-bg :132), #Persistent (line 167)] — in-page debug panel: `field-bg` bg, 1px `chrome-border`, `rounded/sm`; hidden by default; toggled from Debug ▸ Show Debug Panel.
- [Source: `architecture/.../ARCHITECTURE-SPINE.md`#AD-11 (:121-124), #AD-3 (:80-83), #AD-4 (:85-88), #AD-7 (:100-103), #AD-10 (:116-119), #AD-12 (:126-129), #AD-14 (:136-139)] — debug panel is the only persistent in-page chrome (toggled `[hidden]`/`data-*`, default hidden); import allowlist; prefs SSOT (savePrefs no fan-out); checkable-keeps-open; retainFocus sacred; boot order; reset single-writer.
- [Source: `www/state/prefs.js:16, 18-58, 89, 94`] — `CURRENT_VERSION=1` (no bump); `DEFAULTS` (add `showDebugPanel:false`); defensive spread-merge fills new boolean fields.
- [Source: `www/renderer/menu-bar.js:47, 57, 306, 403-427, 847-881, 1057-1074, 1081-1092, projectPrefs`] — import allowlist; MENUS incl. debug; opts intake; initial paint; generic checkable branch (localEcho side-effect at :875); projectMenuOnOpen; projectCheckable/projectLocalEcho; projectPrefs.
- [Source: `www/main.js:285-286, 314, 376-457, 444, 1224-1332, 1341+/1368, 1433-1434, 1444`] — widget refs; widget handlers (leave untouched); wireMenuBar opts (inject beside setLocalEcho); applyPrefs single-writer + boot apply; prefs subscribers.
- [Source: `www/index.html:452-483, 558, 1499-1507, 1697-1719`] — `#debug` CSS; `#tx-strip` CSS; Debug menu + stub row; `<details id="debug">` container + widgets.
- [Source: `_bmad-output/.../e3-2-settings-menu-local-echo-enter-key-sends.md`] — the checkable-with-live-injected-setter template (persist ≠ apply); projectLocalEcho clone; testing-idioms block.
- [Source: `_bmad-output/.../e2-2-auto-connect-toggle-choose-microbeast.md`] — the generic `data-pref` checkable-persist seam.
- [Source: `_bmad-output/.../epic-e4-retro-2026-07-03.md` §6 / action #7] — E5 = "relocate-and-keep" third mode; still-works-after-move; the one pane that survives E7; E4.2 already moved `#build-sha` out.
- [Source: `www/tests/render/menu-bar-settings.spec.js`] — the model spec (checkable toggle: API-open, glyph/aria, persist, reset re-projection, retainFocus). `www/tests/render/tx-debug-strip.spec.js` + the `#debug`.open fixture sites — the specs to update for the container change.

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **Container mechanism — ✅ RESOLVED by Ant (2026-07-04): the panel must be COMPLETELY INVISIBLE — no on-screen furniture at all (no summary triangle, no empty box) — until enabled in the menu.**
   **Chosen mechanism (delivers full invisibility AND zero fixture churn):** keep the element as `<details id="debug">`; add `#debug summary { display: none }` (menu is the sole toggle) **and** `#debug:not([open]) { display: none }` (the whole container generates no box when off — this is what makes it fully invisible, vs. a closed `<details>` which still paints its summary + box). `setDebugPanelVisible(v)` drives `debugEl.open = v`; `applyPrefs` sets it OFF by default at boot. Because visibility keys off the `open` attribute, every existing `page.locator('#debug').evaluate(el => el.open = true)` fixture (~15 sites) keeps revealing the widgets verbatim — no spec sweep; only `tx-debug-strip.spec.js` gains a menu-driven test. `open` is attribute-driven (not an inline style, not phosphor-coupled), so it honors AD-11's intent; the deliberate deviation from AD-11's literal `[hidden]/data-*` (using `open` + `:not([open])` instead) is documented here so review reads it as intentional.
   **Rejected alternative — convert to `<div id="debug-panel" hidden>` + a shared `revealDebugPanel(page)` helper + sweep all ~15 `#debug`.open fixtures:** produces the identical visible result but is a broad, flake-prone spec churn on a pure-relocation story. Only revisit if a reviewer insists on the literal `[hidden]` mechanism.
2. **Persistence.** **Recommended default:** persist `showDebugPanel` across reload (rides the `data-pref` seam; consistent with every other checkable). A reload with it ON re-shows the panel. **Alternative:** session-only (always OFF at boot) — defensible for a builder tool, but it breaks the uniform `data-pref` treatment and needs a special-case (don't project the pref into the panel at boot). Recommend persist.
3. **Codified test-idioms extraction — "last call" (5 epics: E1 #4 / E2 #1 / E3 #1 / E4).** The idioms block above is re-embedded for immediate use. Now that Q1 is resolved to the zero-fixture-churn mechanism (no spec sweep, so no natural extraction trigger), **recommended default: formally close the action as intentionally per-story** and stop listing it in retros — do not force a `www/tests/helpers/` extraction that E5.1 doesn't need. (Ant may still elect the extraction if he wants the shared helper regardless; it's a one-time refactor independent of this feature.) Either way, resolve it here rather than carrying it a sixth time.
4. **Optional `renderer/debug-panel.js` module (AD-2 purity).** **Recommended default:** none — `setDebugPanelVisible` as a `main.js` closure is sufficient and mirrors how `applyPrefs` already owns widget DOM; the test hook is the panel's own attribute + `window.__prefs`. **Alternative:** a tiny `wireDebugPanel({panelEl})` module exposing `window.__debugPanel.__getStateForTests` for strict AD-2 conformance. Recommend the closure (proportionate to a show/hide).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Amelia / bmad-dev-story)

### Debug Log References

None — no HALT conditions triggered. Regression flakes (2 in `chromium`, 2 in `chromium-transport`) all passed on the first retry and are the pre-existing wasm-boot-under-parallelism / transport flakes documented in the sprint retro action items, not regressions from this story.

### Completion Notes List

- **Zero new mechanic — `localEcho` minus the legacy mirror.** `showDebugPanel` (new persisted boolean, default OFF) rides the E2.2 generic `data-pref` checkable seam; because it has a LIVE DOM effect it also calls an injected `setDebugPanelVisible` setter in the same branch (persist ≠ apply — AD-4). `applyPrefs` is the single writer of the panel's visibility on boot/reset; `menu-bar.projectDebugPanel` re-derives only the row glyph. No new runtime module.
- **Q1 mechanism (completely-invisible-when-off + zero fixture churn) delivered as designed.** Kept `<details id="debug">` and gated visibility on the `open` attribute via two CSS rules (`#debug summary { display:none }` + `#debug:not([open]) { display:none }`). Because visibility keys off `open`, all ~30 existing `page.locator('#debug').evaluate(el => el.open = true)` fixtures kept revealing the widgets verbatim — the full suite stayed green with NO spec sweep. Only `tx-debug-strip.spec.js` was converted to a menu-driven reveal (the direct test of the widgets now exercises the real user path).
- **Widgets preserved verbatim** — every child id (`#input`/`#feed`/`#stress64k`/`#paste-test`/`#tx-strip`/`#tx-reset`) unchanged, so the `main.js` widget handlers were untouched; the "Feed → grid" spec proves they still work after the move.
- **Panel styling moved to DESIGN.md `debug-panel` tokens** (`--field-bg` bg, `--chrome-fg` text, 1px `--chrome-border`, `border-radius:4px` = rounded/sm), replacing hardcoded hex — satisfies AC-5's "only `var(--chrome-*)` tokens".
- **No `CURRENT_VERSION` bump** — the new boolean rides `loadPrefs`'s defensive spread-merge; the persisted-ON reload spec proves an older-shape blob boots the panel correctly.
- **Q2 → persist across reload** (rides the `data-pref` seam, consistent with every other checkable). **Q3 → codified-idioms carry closed as intentionally per-story** (no forced `tests/helpers/` extraction — Q1's zero-sweep mechanism removed the natural trigger). **Q4 → `main.js` closure** over the panel node, no separate `debug-panel.js` module (proportionate to a show/hide).
- **E7 note:** the debug panel is the ONE pane that does NOT retire in the E7 dual-chrome sweep — it relocated behind the Debug menu and stays. To be recorded on the E7 retirement checklist so it is not swept with `#top-bar`/`<details>`.

### Code Review

`code-review` (high effort — 8 finder angles + adversarial verify, 2 independent finder agents + manual pass) run 2026-07-04 on the E5.1 working-tree diff: **0 findings / clean.** Verified: the core mechanism (`#debug` is a `<details>`, `setDebugPanelVisible` drives `.open` → reflects to `[open]`, `#debug:not([open])` hides it fully); boot ordering (`debugEl` defined before `wireMenuBar`/boot `applyPrefs`; `wireMenuBar` before `wireKeyboard`); single-writer split (panel = injected setter only; `projectDebugPanel` = row glyph only); reset fan-out to both subscribers; all four `--field-bg`/`--chrome-fg`/`--chrome-muted`/`--chrome-border` vars resolve readably in slate + crt; and the ~15 preserved `el.open = true` fixtures still reveal the widgets. One non-blocking note (not a defect): `revealDebugPanel` in `tx-debug-strip.spec.js` toggles rather than sets — safe under Playwright's fresh per-test context; would only be fragile if `storageState`/context reuse were introduced.

### File List

- `www/state/prefs.js` — added `showDebugPanel: false` to `DEFAULTS` (Task 1).
- `www/index.html` — Show Debug Panel row given `id` + `data-pref`; `#debug` CSS reworked (two visibility rules + DESIGN.md tokens); `<details id="debug">` container/widgets kept verbatim (Tasks 2, 3).
- `www/main.js` — `debugEl` + `setDebugPanelVisible` closure; injected into `wireMenuBar`; `applyPrefs` single-writer call (Tasks 3, 4).
- `www/renderer/menu-bar.js` — `setDebugPanelVisibleRef`/`debugPanelItemEl` refs + intake; discovery + initial paint; checkable side-effect; `projectDebugPanel` wrapper; `projectMenuOnOpen` debug branch; `projectPrefs` reset re-projection (Tasks 3, 4).
- `www/tests/input/tx-debug-strip.spec.js` — converted to a menu-driven reveal (Task 5).
- `www/tests/render/menu-bar-debug.spec.js` — NEW spec covering AC-1…AC-7 (Task 5).

### Change Log

- 2026-07-04 — E5.1 implemented: Debug ▸ Show Debug Panel checkable (default OFF) toggles the in-page debug panel via a new persisted `showDebugPanel` pref (generic `data-pref` seam) + injected `setDebugPanelVisible` live setter; `applyPrefs` single-writer on boot/reset; `menu-bar.projectDebugPanel` re-derives the row. Panel is completely invisible when off (no summary/box). Widgets relocated verbatim. New `menu-bar-debug.spec.js`; `tx-debug-strip.spec.js` menu-driven. Suite green (`chromium` 335 pass, `chromium-transport` 169 pass). Status → review.
