---
baseline_commit: 06ee9fa8e1c9d6f2c2703734df49ec53ffe5b712
---

# Story E2.2: Auto-connect toggle & Choose MicroBeast

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator with possibly several adapters,
I want an auto-connect toggle and a way to pick which board,
so that reconnecting is one step and multiple CP2102N adapters don't ambiguously connect.

**Covers:** FR-13 (Choose MicroBeast), FR-14 (Auto-connect toggle). **Epic:** E2 · Connection & Serial Configuration. **Depends on:** E0, E1 (done), E2.1 (done).

**Premise (epic-wide, confirmed — same as E2.1):** this is a **wiring/relocation** story, not a build-from-scratch. The `autoConnect` pref, its default (`false`), the boot-time auto-connect path, and the CP2102N VID/PID detection **already exist and work** in `serial.js` + the legacy `<details>` Connection pane. E2.2 makes the **menu-bar** Connection items drive those existing mechanisms: the checkable "Auto-connect on load" row persists `prefs.autoConnect`, and the currently-disabled "Choose MicroBeast…" placeholder becomes a live, adapter-count-gated item. No change to the serial state machine, the auto-connect boot logic, or the pref schema. The legacy pane checkbox (`#auto-connect-checkbox`) **coexists** until `#top-bar`/`<details>` retire in E7 (E1 retro open action #5).

## Acceptance Criteria

Verbatim epic ACs (`epics.md` §Story E2.2, lines 389–405), decomposed and made testable. AC-1/AC-2 are the epic's two ACs; AC-3…AC-7 make the implicit "persists the existing pref / stays in lockstep with the coexisting checkbox / detection is live / no regressions" requirements falsifiable.

**AC-1 — Auto-connect toggle flips the boolean pref, keeps the menu open, reflects the check (FR-14, AD-7, AD-4).**
Given the Connection menu is open and the "Auto-connect on load" checkable row (`index.html:990–993`),
When the user activates it,
Then it toggles `prefs.autoConnect` via `savePrefs({ autoConnect: <new> })` (AD-4 — no other pref key touched), the **menu stays open** (checkable semantics — no `closeMenu()`), and the row's `data-checked` + `aria-checked` + leading `.check` glyph (`✓`/``) flip in lockstep with the new value (`syncCheckGlyph`).

**AC-2 — Choose MicroBeast… presence tracks the live CP2102N adapter count (FR-13).**
Given the Connection menu,
When it opens **and** more than one CP2102N adapter (VID `0x10c4` / PID `0xea60`) is currently granted (`navigator.serial.getPorts()` filtered by VID/PID → count > 1),
Then the "Choose MicroBeast…" item is **present** (actionable); and when exactly one or zero matching adapters are present, the item is **absent** (see Dev Notes §"Absent vs shown-disabled" for the chosen mechanism). Detection is async and must not throw or block the menu open (no-throw, boot-race-guarded).

**AC-3 — Auto-connect row reflects the persisted value at every entry point (FR-14, AD-14 reset re-projection).**
Given `prefs.autoConnect` (default `false`),
When the menu-bar wires at boot, when the Connection menu **opens** (read-at-use, mirroring `projectViewOnOpen`), and when `resetPrefs()` fires (the `menuBar.projectPrefs` subscriber, `main.js:1209`),
Then the row's `data-checked`/glyph is **derived from `getPrefs().autoConnect`** — never from the hardcoded `data-checked="true"` placeholder literal. The placeholder literal must be corrected so a fresh page (default `false`) shows the row **unchecked**.

**AC-4 — Lockstep with the coexisting legacy pane checkbox (FR-6, NFR-3 — no incumbent behavior lost).**
Given the legacy `#auto-connect-checkbox` (`chrome.js:237–244`) still exists during the E7 coexistence window and `savePrefs` does **not** fire subscribers (AD-4),
When the user toggles auto-connect **in the menu**, the legacy checkbox's `checked` updates to match (menu→pane mirror), and when the user toggles the **legacy checkbox**, the menu row re-derives correctly the next time the Connection menu opens (pane→menu via AC-3's open re-derive).
Both surfaces always agree on `prefs.autoConnect`; neither silently diverges in-session.

**AC-5 — Choose MicroBeast… drives the existing filtered device picker (FR-13).**
Given the "Choose MicroBeast…" item is present and activated,
When the user clicks it,
Then it invokes the existing CP2102N-filtered `requestPort` connect flow (the same picker `connectMicroBeast()` opens), letting the user pick which board, and closes the menu (action semantics). It reaches `serial.js` via an **injected opt** (AD-3 — serial is not directly importable by menu-bar). See Dev Notes §"Choose MicroBeast… click behavior" for the disconnect-first nuance.

**AC-6 — Focus retention + cross-cutting invariants (NFR-1/AD-10 "Sacred"; NFR-2/AD-9; NFR-5; NFR-6).**
Both new/live rows retain terminal focus on click (`retainFocus` — already applied to every `.menu-item` at `wireDropdownItems`); after a click `document.activeElement.id === 'terminal-wrapper'`. Uses only `var(--chrome-*)` tokens; no new dependencies / no build step; `window.__menuBar` + `__getStateForTests` unchanged (extend, don't break). No serial state machine change; no `prefs.js` schema change (no `CURRENT_VERSION` bump).

**AC-7 — Suite stays green; boot order preserved (FR-6, AD-12).**
The full Playwright chromium suite passes (`npm test`). The existing auto-connect boot specs (`session/auto-connect.spec.js`), multi-adapter branch (`transport/errors.spec.js:87–114`), and the checkable-glyph test (`menu-bar.spec.js:199–210` — **must be updated**, it hardcodes `data-checked` starting `'true'`) all pass. Boot order untouched: `wireMenuBar` before `wireKeyboard`; polite-fail first.

## Tasks / Subtasks

- [x] **Task 1 — Wire the Auto-connect checkable row to persist `prefs.autoConnect` (AC-1, AC-6).**
  - [x] Give the row a stable hook: add `id="menu-autoconnect-item"` to `index.html`. Corrected the hardcoded `data-checked="true"`/`aria-checked="true"` → `"false"` (driven by prefs at wire time / open — AC-3).
  - [x] In `onItemClick`'s `checkable` branch: after flipping `data-checked` + `syncCheckGlyph`, persist via the generic `data-pref` seam — added `data-pref="autoConnect"` to the row and `const prefKey = item.getAttribute('data-pref'); if (prefKey) savePrefs({ [prefKey]: next });`. Reusable for E3 Settings checkables. Still `return;` (no `closeMenu()`) — menu stays open (AC-1).
  - [x] Mirror onto the coexisting legacy `#auto-connect-checkbox` in the same handler (AC-4 menu→pane), guarded to `prefKey === 'autoConnect'`, with an E7 `#top-bar` retirement marker comment (same pattern as E2.1's `#connect-button` mirror).

- [x] **Task 2 — Re-derive the Auto-connect row from prefs on open + on reset (AC-3, AC-4 pane→menu).**
  - [x] Generalized `projectViewOnOpen` → `projectMenuOnOpen()` (both call sites `toggleMenu`/`openMenuNamed` updated). It handles `openMenu === 'connection'` by calling `projectAutoConnect()` (reads `getPrefs().autoConnect` at USE-TIME, sets `data-checked` + `syncCheckGlyph`; no setter; no-throw; idempotent) + `refreshChooseMicroBeast()`.
  - [x] Extended `projectPrefs(prefs)` to call `projectAutoConnect(p)` **before** the View-dropdown early-return, so a View-less harness still gets the auto-connect reset re-projection (AD-14). Read-at-use, no-throw, idempotent, never a setter.
  - [x] Initial paint: `projectAutoConnect()` called once during `wireMenuBar` (alongside the E2.1 `projectConnection` paint) so the row is correct before the first open.

- [x] **Task 3 — Make "Choose MicroBeast…" adapter-count-gated + actionable (AC-2, AC-5).**
  - [x] Rewired the placeholder in `index.html`: `id="menu-choose-microbeast-item"`, `data-action="choose-microbeast"`, removed `data-variant="disabled"`/`data-disabled`/`aria-disabled`/`title`, starts `hidden`. **Also added CSS** `#menu-bar .menu-item[hidden] { display: none; }` — the `.menu-item { display:flex }` rule outranks the UA `[hidden]{display:none}` (same reason `.dropdown[hidden]`/`.submenu[hidden]` re-declare it); story's "no new CSS" assumption was wrong. Caught by a failing test.
  - [x] Added `export async function countMicroBeastAdapters()` to `serial.js` (reuses the VID/PID predicate; no-throw → `0` on reject) + updated the public-API header. Injected into `wireMenuBar` opts from `main.js` as `getAdapterCount: countMicroBeastAdapters`.
  - [x] On Connection-menu open, `refreshChooseMicroBeast()` kicks off the async count with a stale-guard (`if (openMenu === 'connection') setChooseMicroBeastPresent(n > 1)`), wrapped in `Promise.resolve().then(...).catch(() => {})` (no-throw, boot-race-guarded). `setChooseMicroBeastPresent` toggles the `hidden` attribute + calls `reconcileFocusedRow()`.
  - [x] Added a dedicated `action === 'choose-microbeast'` branch in `onItemClick` (alongside `connect-toggle`) → `chooseMicroBeastRef()` then `closeMenu()`. Injected `chooseMicroBeast: () => connectMicroBeast()` from `main.js`. Recommended default (no disconnect-first) per §"Choose MicroBeast… click behavior".

- [x] **Task 4 — `focusableItems` must skip `[hidden]` rows (AC-2 correctness).**
  - [x] Added `.filter((el) => !el.hasAttribute('hidden'))` to `focusableItems()`. `reconcileFocusedRow()` (called by `setChooseMicroBeastPresent`) clamps the index so the row appearing/disappearing between opens keeps nav valid.

- [x] **Task 5 — Tests (AC-1…AC-7).**
  - [x] **Updated** `menu-bar.spec.js`: the checkable-glyph test (was asserting a `'true'` start) now asserts default-`false` → toggle-on (glyph + aria + menu-stays-open + `getPrefs().autoConnect` persisted) → toggle-off. Also fixed the `aria-checked` test (default false now) and repointed the two Connection-disabled-row tests (`disabled is muted…`, `disabled exposes aria-disabled`) to the File ▸ Download Session Log placeholder, since Connection no longer has a disabled row.
  - [x] Updated `menu-bar-keyboard.spec.js`: the skip-inert-rows test now asserts the **hidden** Choose MicroBeast row is skipped (was disabled); the aria-live disabled-reason test repointed to File ▸ Download Session Log.
  - [x] New spec `www/tests/render/menu-bar-connection-config.spec.js` (chromium project): toggle persists + mirrors `#auto-connect-checkbox` (AC-1/AC-4 menu→pane + pane→menu on next open); reset re-projection via `projectPrefs({autoConnect:false})` (AC-3); Choose MicroBeast hidden with ≤1 / present with >1 granted adapter (AC-2, seeded via `_grantedPorts` + `__preGrantPort`); click invokes the injected picker (mock `requestPort` grows `_grantedPorts`) + closes the menu (AC-5); focus retention after both clicks (AC-6).
  - [x] Regression: full suite via `npx playwright test` (both `chromium` + `chromium-transport` projects) — 410 passed, 0 failed. `session/auto-connect.spec.js`, `transport/errors.spec.js:87` (multi-adapter), `menu-bar-prefs.spec.js` all green (re-confirmed deterministically in isolation). The 6 flaky reruns were all pre-existing slide/paste transport flakes, untouched by E2.2.

## Dev Notes

### The one-paragraph mental model

Everything the *behavior* needs already exists: `prefs.autoConnect` (default `false`, `prefs.js:27`) gates a working silent auto-open at boot (`serial.js:204–248`), and CP2102N adapters are detectable via `navigator.serial.getPorts()` filtered on VID `0x10c4`/PID `0xea60` (predicate at `serial.js:673–677`). What's missing is **menu wiring**. E2.2 (a) points the checkable "Auto-connect on load" row at `savePrefs({autoConnect})` (keeping the menu open — checkable semantics) and keeps it in lockstep with the coexisting legacy `#auto-connect-checkbox`; and (b) turns the disabled "Choose MicroBeast…" placeholder into a live item that is present iff `getPorts()` shows >1 matching adapter, and on click reuses the existing filtered `requestPort` picker. This is the same "menu-bar is a DOM projector fed by an injected seam" shape as E2.1 — no serial state machine change, no pref schema change.

### Exact code sites (verified against `06ee9fa`)

**`www/index.html` — the Connection dropdown (`#dropdown-connection`, lines 973–994):**
- `#menu-connect-item` (Connect/Disconnect, E2.1-owned) — `:977–980`. Do not touch.
- Choose MicroBeast… placeholder — `:981–984`, currently `data-variant="disabled" data-disabled="true" aria-disabled="true" title="Connect first to choose a device"`. Task 3 rewires this.
- `<div class="menu-sep">` — `:985`. Serial Configuration… (E2.3) — `:986–988`. `<div class="menu-sep">` — `:989`.
- Auto-connect checkable — `:990–993`, `data-variant="checkable" data-checked="true"` (hardcoded — **wrong**, must derive from prefs; Task 1).
- Legacy coexistence checkbox `#auto-connect-checkbox` lives in the `<details>` Connection pane (`index.html:1329–1330`; wired in `chrome.js:237–244`), retires with `#top-bar` in E7.

**`www/renderer/menu-bar.js`:**
- Imports (AD-3 allowlist) — `:40–54`: `focus.js`, `prefs.js` (`getPrefs, savePrefs` at `:47`), `canvas.js`. **Serial arrives only via opts** (E2.1 injected `onConnectionStateChange`/`getConnectionState`/`toggleConnection`).
- `wireDropdownItems` — `:664–677`; `onItemClick` dispatch — `:679–713`. Checkable branch (toggle + keep-open, no persist yet) — `:689–694`. The `connect-toggle` action branch (E2.1) — `:703–708` is the pattern to mirror for `choose-microbeast`.
- `runViewAction` switch — `:732–753` (add `choose-microbeast` here, or a dedicated branch).
- `syncCheckGlyph` — `:755–764` (single source of truth = `data-checked` → `aria-checked` + `.check` glyph).
- `projectViewOnOpen` — `:802–804`; called from `toggleMenu:777`, `openMenuNamed:790`. The open re-derive seam to mirror for Connection (Task 2).
- `projectPrefs(prefs)` — `:891–923`; **note the early-return on `viewDropdown` absence at `:894`** — Task 2 must not gate the Connection projection behind it.
- `focusableItems` — `:401–408` (Task 4: add `[hidden]` filter).
- `wireMenuBar` opts intake + DOM discovery + initial paint — `:203–306`; `buildApi` — `:971–991` (expose any new test seam if a spec needs it).

**`www/transport/serial.js`:**
- VID/PID constants — `:39–40`. `connectMicroBeast()` (filtered `requestPort`) — `:372–439`. `getPorts()` filter predicate to reuse — `:673–677` (inside `onNavSerialConnect`). Auto-connect boot path (unchanged) — `:204–248`. Public exports — `:98,109,300,372,441,459,461,469`. Add `countMicroBeastAdapters` here (Task 3).

**`www/main.js`:**
- `wireMenuBar({...})` opts block — `:317–339` (add `getAdapterCount`, `chooseMicroBeast`). `window.__menuBar` — `:340`.
- `applyPrefs(p)` mirrors `#auto-connect-checkbox` — `:1167–1168` (the pane's boot/reset mirror; leave as-is). `prefsSubscribe(menuBar.projectPrefs)` — `:1209`, `menuBar.projectPrefs(prefs)` — `:1210`.
- Import `connectMicroBeast, countMicroBeastAdapters` from serial (extend the existing E2.1 import that already brings `onStateChange, getState, toggleConnection`).

### Absent vs shown-disabled — the "Choose MicroBeast…" visibility mechanism (decision — recommended default chosen; flagged for Ant)

The epic AC says the item is **"present" / "absent"** based on adapter count. The codebase's established convention for conditional rows is **disable-in-place** (`data-disabled`, `syncSubmenuDisabled` for the CRT-only Phosphor/Font rows), NOT hide. Two faithful readings:
- **Chosen (recommended): true absence via the `hidden` attribute.** Matches the AC wording literally ("absent"), and matches EXPERIENCE.md's "Only present when multiple CP2102N adapters" (`:40`). Cost: `focusableItems` must learn to skip `[hidden]` (Task 4) — a small, correct generalization. A native `[hidden]` button is `display:none`, so no new CSS is needed.
- **Rejected: shown-but-disabled** (keep the row visible, `data-disabled=true` when ≤1). Reuses existing nav machinery untouched, but contradicts the AC's "absent" and leaves a permanently-greyed row for the common single-adapter case (noise). Also, DESIGN.md's "disabled items are announced with their reason" would require inventing reason copy for the normal case.

If Ant prefers shown-disabled, the change is: skip Task 4, and in Task 3 flip `data-disabled` instead of `hidden` (and give it a `title` reason). Flagged below.

### Choose MicroBeast… click behavior (decision — the epic ACs don't specify it)

The two epic ACs for E2.2 only constrain the item's **presence** and the auto-connect **toggle** — neither specifies what clicking "Choose MicroBeast…" *does*. An item that does nothing is wrong, so this story defines it. **Recommended:** clicking invokes the existing CP2102N-filtered `requestPort` picker (`connectMicroBeast()`), which is precisely the native "choose which board" affordance, and is legal from a click (user gesture). Open nuance: if the port is **already connected**, a bare `connectMicroBeast()` opens a second port without closing the first. Recommended handling: if `getConnectionState() === 'connected'`, `disconnect()` first, then `connectMicroBeast()` — or simply let `connectMicroBeast` run (it targets a *different* adapter, so the old one stays open on its own tab-owned writer). **Simplest safe default: inject `chooseMicroBeast: () => connectMicroBeast()`** and flag the connected-state nuance to Ant; do not build a bespoke port-list submenu (`getInfo()` exposes no human-readable label, so a custom picker would be worse UX than Chromium's native one). This preserves the E2.1 "pure relocation / reuse the existing serial path" premise.

### Lockstep with the coexisting pane checkbox (AC-4 — why the mirror is needed)

`savePrefs` deliberately does **not** fire subscribers (only `resetPrefs()` does — AD-4). So a menu toggle updates `prefs.autoConnect` and the menu glyph, but the legacy `#auto-connect-checkbox` in the still-present `<details>` pane would go stale in-session. This is the exact "dual-chrome must not disagree mid-migration" concern E1 retro action #5 tracks. Fix is symmetric: **menu→pane** — the menu handler writes `#auto-connect-checkbox.checked` (Task 1); **pane→menu** — the pane's existing `savePrefs` (chrome.js:241) plus the menu's open re-derive (Task 2) means the next Connection-menu open reflects the pane change. Both read the single source of truth (`prefs.autoConnect`); neither owns a second copy. The mirror line retires with `#top-bar` in E7 (leave the marker comment).

### What must be preserved (non-negotiable — AD-13/FR-6/NFR-3)

- The `serial.js` auto-connect boot path (`:204–248`), state machine, VID/PID constants, and `onNavSerialConnect` multi-adapter guard — **read-only** here. Do not change *when* auto-connect fires ("takes effect on next page load" — `main.js:1136`).
- The `prefs.js` schema and `CURRENT_VERSION` (no bump — `autoConnect` already exists; D-32 defensive merge unaffected).
- Focus retention on every row (NFR-1/AD-10 "Sacred").
- Boot order (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first.
- Checkable-keeps-open semantics (AD-7) — the toggle must NOT close the menu.

### Testing standards + codified idioms (E1 retro action #4 — menu-driven test idioms)

- **Project:** chromium. New spec under `www/tests/render/` runs the light `chromium` project (`playwright.config.js:33–51`); serial-machine oracles live in `chromium-transport` (`fullyParallel:false`, `retries:1` — the ratified flake fix; no per-story `--workers=1`). Run: `npm test` (full) / `npm run test:fast` (`@fast`).
- **Boot-race guard:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')` before driving.
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('connection'))` — NOT a title `.click()` (toggles a still-open menu shut).
- **Prefs seeding:** `localStorage.setItem('beastty.prefs', JSON.stringify({...autoConnect:true}))` via `page.addInitScript` BEFORE `goto` (idiom `session/auto-connect.spec.js:31–46`).
- **Multi-adapter seeding:** `SERIAL_MOCK` + push two VID/PID-matching ports into `navigator.serial._grantedPorts` (`transport/errors.spec.js:100–103`); set `window.__preGrantPort` before the mock IIFE reads it.
- **Menu stays open assertion:** `window.__menuBar.getOpenMenu() === 'connection'` after a checkable click.
- **Check-glyph lockstep:** assert `data-checked` + `.check` textContent (`✓`/``) + `aria-checked` move together (`menu-bar.spec.js:199–210`).
- **`retainFocus` assertion:** `document.activeElement.id === 'terminal-wrapper'` after driving (`menu-bar-keyboard.spec.js:155–157`).
- **`force:true`** on any `[hidden]`/`aria-disabled` row to prove inertness.

### Project Structure Notes

- No new module — extends `renderer/menu-bar.js`, adds one `serial.js` export (`countMicroBeastAdapters`), edits `main.js` opts + `index.html`, adds/updates specs. Aligns with the Structural Seed (`ARCHITECTURE-SPINE.md:174–194`).
- AD-3 respected: menu-bar reaches serial **only** via injected opts (`getAdapterCount`, `chooseMicroBeast`); `savePrefs`/`getPrefs` are the sanctioned direct imports.
- No new dependencies, no build step (NFR-5); plain ESM named exports; single `wireXxx(opts)` seam.
- **Variances to track:** (1) the `#auto-connect-checkbox` menu→pane mirror is a temporary dual-chrome affordance — retire with `#top-bar` in E7 (E1 retro action #5, `sprint-status.yaml:80–83`); (2) the generic `data-pref` checkable-persist path introduced here is the reusable seam for Settings ▸ Local echo / Enter-key-sends (E3) — codify it (E1 retro action #4).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story-E2.2 (lines 389–405)] — story statement + the two epic ACs.
- [Source: `epics.md`#FR-13, #FR-14 (lines 43–46, 128–129)] — Choose MicroBeast (multi-adapter, present-when->1) + auto-connect toggle (checkable, persisted).
- [Source: `.../architecture/.../ARCHITECTURE-SPINE.md`#AD-7 (100–103)] — menu-bar owns all dropdowns; **checkable items keep the menu open**; verbatim relocated handlers.
- [Source: `ARCHITECTURE-SPINE.md`#AD-4 (85–88), #AD-3 (80–83), #AD-14 (136–139), #AD-9 (110–114), #AD-15 (141–144), #AD-12 (126–129)] — prefs single-source/direct-call; import allowlist (serial via opts); reset re-projection; chrome tokens; Connect single-writer; boot order.
- [Source: `.../ux-designs/.../EXPERIENCE.md` (lines 34–43, 125–129)] — Connection menu inventory + item order (Choose MicroBeast below Connect; Auto-connect last below the 2nd divider); checkable = "menu stays OPEN on toggle".
- [Source: `.../ux-designs/.../DESIGN.md` (lines 186–191)] — checkable = leading check glyph when on ("Auto-connect on load ✓").
- [Source: `www/transport/serial.js:39–40, 204–248, 372–439, 673–677`] — VID/PID; auto-connect boot path; filtered requestPort; multi-adapter predicate.
- [Source: `www/state/prefs.js:15, 18–58 (autoConnect:27)`] — `beastty.prefs` blob; `autoConnect:false` default; `savePrefs`/`getPrefs`/`resetPrefs`/`subscribe` API; no `CURRENT_VERSION` bump.
- [Source: `www/renderer/menu-bar.js:40–54, 401–408, 664–713, 755–764, 802–804, 891–923, 971–991`] — imports, focusableItems, item dispatch/checkable branch, syncCheckGlyph, open re-derive, projectPrefs, API.
- [Source: `www/renderer/chrome.js:237–244`] — legacy `#auto-connect-checkbox` change → `savePrefs({autoConnect})` (the coexisting incumbent to keep in lockstep).
- [Source: `www/main.js:317–339, 1167–1168, 1209–1210`] — wireMenuBar opts seam; pane checkbox mirror; projectPrefs subscription.
- [Source: `www/index.html:973–994 (Choose MicroBeast 981–984; Auto-connect 990–993)`, `1329–1330`] — Connection dropdown rows + legacy pane checkbox.
- [Source: `_bmad-output/implementation-artifacts/e2-1-connect-disconnect-single-writer-menu-item.md`] — the coexistence-mirror + injected-seam precedent; "Choose MicroBeast…" label preservation.
- [Source: `www/tests/render/menu-bar.spec.js:199–210`, `menu-bar-connection.spec.js`, `menu-bar-prefs.spec.js`; `www/tests/session/auto-connect.spec.js`; `www/tests/transport/{errors,mock-serial}.js`] — idioms to reuse + the glyph test to update + oracles to keep green.
- [Source: `www/playwright.config.js:33–51`, `www/package.json`] — chromium/chromium-transport projects; test scripts.

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **Choose MicroBeast… presence mechanism** — recommended **true absence via `[hidden]`** (faithful to the AC's "absent"; requires the small `focusableItems` `[hidden]` filter, Task 4). Alternative: shown-but-disabled (reuses nav machinery but contradicts "absent" and greys the row in the common single-adapter case). Which?
2. **Choose MicroBeast… click when already connected** — recommended `chooseMicroBeast: () => connectMicroBeast()` (fresh filtered picker; a second adapter opens independently). Should it instead `disconnect()` first, or switch the active connection? (Epic ACs are silent on the click action entirely.)
3. **Auto-connect menu↔pane lockstep during coexistence** — recommended the menu→pane mirror + open re-derive (both surfaces always agree). Acceptable, or should the legacy pane checkbox be treated as read-only / hidden earlier than E7?

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Dev Story workflow / Amelia)

### Debug Log References

- Two `menu-bar-connection-config.spec.js` adapter-count tests failed initially. Root cause 1: `page.addInitScript(fn, a, b)` only accepts ONE arg, so the extra-port seeding count was `undefined` — no second port seeded. Fixed by passing a single options object. Root cause 2 (the real code gap): a `[hidden]` `.menu-item` was still `display:flex` because `#menu-bar .menu-item { display:flex }` outranks the UA `[hidden]{display:none}` rule — the row was hidden-in-attribute but visible-on-screen. Fixed by adding `#menu-bar .menu-item[hidden] { display: none; }` (matching the existing `.dropdown[hidden]`/`.submenu[hidden]` pattern). The story's "a native [hidden] button is display:none, so no new CSS is needed" note was incorrect for `.menu-item`.

### Completion Notes List

- **Recommended defaults taken (all 3 flagged questions):** (1) Choose MicroBeast… presence via true `[hidden]` absence + `focusableItems` `[hidden]` filter; (2) `chooseMicroBeast: () => connectMicroBeast()` (no disconnect-first when already connected); (3) menu→pane mirror + open re-derive keeps both auto-connect surfaces in lockstep during the E7 coexistence window. None block; Ant can flip any.
- **Generic `data-pref` checkable-persist seam** introduced (Task 1) is the reusable path for E3 Settings ▸ Local echo / Enter-key-sends — the checkable branch stays generic, the pref key rides on the row.
- **No serial state-machine / `prefs.js` schema change** (no `CURRENT_VERSION` bump — `autoConnect` already existed). Serial reached only via injected opts (AD-3): `getAdapterCount`, `chooseMicroBeast`. Auto-connect boot path untouched.
- **Variance to track for E7:** the `#auto-connect-checkbox` menu→pane mirror line is a temporary dual-chrome affordance (marker comment left in `menu-bar.js`), retires with `#top-bar` (E1 retro open action #5).
- **Tests:** full suite `npx playwright test` (both projects) → 410 passed, 0 failed, 1 skipped, 6 flaky (all pre-existing slide/paste transport flakes, passed on retry). New spec: 6/6. AC-7 named oracles re-confirmed green in isolation.

### File List

- `www/index.html` — Auto-connect row (`id`, `data-pref="autoConnect"`, `data-checked/aria-checked="false"`); Choose MicroBeast… row (`id`, `data-action`, `hidden`, removed disabled attrs); new `.menu-item[hidden]` CSS rule.
- `www/renderer/menu-bar.js` — checkable branch persists via `data-pref` + mirrors legacy checkbox; new opts (`getAdapterCount`/`chooseMicroBeast`) + DOM refs; `projectAutoConnect` / `refreshChooseMicroBeast` / `setChooseMicroBeastPresent`; `projectViewOnOpen` → `projectMenuOnOpen` (connection handling); `projectPrefs` auto-connect re-projection (pre-View-guard); `focusableItems` `[hidden]` filter; `choose-microbeast` click branch; initial `projectAutoConnect()` paint.
- `www/transport/serial.js` — new `export async function countMicroBeastAdapters()`; public-API header updated.
- `www/main.js` — import `connectMicroBeast`, `countMicroBeastAdapters`; inject `getAdapterCount` + `chooseMicroBeast` into `wireMenuBar`.
- `www/tests/render/menu-bar-connection-config.spec.js` — NEW (6 tests, AC-1…AC-6).
- `www/tests/render/menu-bar.spec.js` — updated 3 tests (checkable-glyph, aria-checked, 2× disabled-row repointed to File menu).
- `www/tests/render/menu-bar-keyboard.spec.js` — updated 2 tests (skip-hidden nav, aria-live disabled-reason repointed to File menu).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions (in-progress → review).
- `_bmad-output/implementation-artifacts/e2-2-auto-connect-toggle-choose-microbeast.md` — this story (task checkboxes, Dev Agent Record).

### Change Log

- 2026-07-02 — E2.2 implemented: Auto-connect checkable persists `prefs.autoConnect` (generic `data-pref` seam) + mirrors legacy `#auto-connect-checkbox`; Choose MicroBeast… is now `[hidden]`-gated on the live CP2102N adapter count (>1) and drives the existing filtered picker. Added `serial.countMicroBeastAdapters`, `.menu-item[hidden]` CSS, `focusableItems` `[hidden]` skip. Tests: +1 new spec (6), 5 existing tests updated. Full suite green (410 passed).
