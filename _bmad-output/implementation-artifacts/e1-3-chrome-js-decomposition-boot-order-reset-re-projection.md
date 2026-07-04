---
baseline_commit: b8e7708d4b4e89f6eb1d29b2e343bb4add14c503
---

# Story E1.3: `chrome.js` decomposition, boot order & reset re-projection

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder,
I want every incumbent `chrome.js` behavior rehomed and the reset path decomposed,
so that the redesign loses no existing behavior and reset never throws on a removed control.

**Covers:** FR-6 (no incumbent behavior lost — `chrome.js` decomposition), FR-30 (polite-fail precedence, incumbent); NFR-3 (no behavior loss), NFR-8 (boot order preserved). **AD-13** (chrome.js decomposed, retained + slimmed), **AD-12** (boot order load-bearing), **AD-14** (reset re-projection ownership), AD-4/AD-5 (prefs single source + federated subscription), AD-1/AD-2 (composition-root + `wireXxx` shape).
**Depends on:** E1.1 (`menu-bar.js` shell) — **done**; E1.2 (menu-bar keydown layer) — **done/review**; E0.1 (`retainFocus`) — **done** (already applied to every `chrome.js` control).

## ⚠️ Scope Decision — READ FIRST (seam + no-loss harness + Clear relocation; NO `#top-bar` removal, NO View-menu wiring)

This is the **plumbing / "no behavior lost" backbone** story. It is deliberately **lighter than it first reads** — E0.1 already migrated every inline focus site out of `chrome.js` (E0 retro action item #3), so focus-retention rehoming is **not** re-planned here. Four scope pins, decided from the architecture spine (AD-12/13/14) against the real E1→E7 sequencing:

1. **`#top-bar` and the three `<details>` panes are NOT removed in this story.** Their controls have no new home until later epics: theme + phosphor → **E1.4**; font, zoom items, View ▸ Clear item → **E1.5**; Connect + serial config → **E2**; Settings (local-echo, Enter-key, Reset prefs, SLIDE) → **E3**; Debug widgets → **E5**; paste-progress-row → **E7**. `#top-bar` can only be *deleted* once its **last** control leaves (E7). E1.3 keeps every incumbent control **live and working** — that is the whole point of FR-6/NFR-3. (This continues the known variance from E1.1's Scope Decision.)

2. **The View-menu submenu panels and the View ▸ Clear menu item are NOT wired here.** Theme/Phosphor/Font submenu panels + real actions are **E1.4/E1.5**; the View ▸ Clear placeholder row (`dropdown-view`, `data-variant="action"`, label "Clear") stays **inert** until E1.5. Do **not** build submenu panels or wire the Clear menu item — that is the exact front-run the E0 retro warned about (E0.1 already front-ran part of this story once).

3. **What DOES move to `menu-bar.js` (AD-13, verbatim): only the Clear / Clear-scrollback handler *logic*.** `menu-bar.js` becomes the single owner of the two incumbent clear buttons (`#clear-button` in `#top-bar`, `#clear-scrollback-button` under the Settings `<details>` region): their click wiring **leaves `chrome.js`** and is re-registered by `menu-bar.js`, routed through one internal `clearScreen({ alsoScrollback })` / `clearScrollback()` action. The incumbent buttons keep working identically (no behavior lost); E1.5 later points the View ▸ Clear menu item at the **same** action. Nothing else moves out of `chrome.js`.

4. **The reset re-projection is a SEAM in this story, filled in later.** `menu-bar.js` registers as a `prefsSubscribe` subscriber exposing an **idempotent, never-throwing** `projectPrefs(prefs)`. Because the View theme/phosphor/font/zoom submenus don't render real state yet (E1.4/E1.5), `projectPrefs` today touches only existing menu DOM and is effectively a safe no-op — but the **subscription + idempotence contract lands now** so that the instant E1.4/E1.5 add View state, `resetPrefs()` already re-projects it cleanly. `main.js applyPrefs` is decomposed for single-writer + null-safety in the same pass.

**One-line summary:** E1.3 = pin the boot order + relocate the two Clear handlers to `menu-bar.js` + stand up the `prefsSubscribe` re-projection seam + decompose `applyPrefs` + a regression harness proving **every** incumbent `chrome.js` behavior still fires. It removes nothing the user can see and wires no new user action.

## What stays in `chrome.js` (SACRED — do NOT move; AD-13)

Per AD-13 verbatim, `wireChrome` is **retained, slimmed** — these four responsibilities keep their current home and must still fire after this story:

- **Theme/zoom keyboard chords** — the single `#terminal-wrapper` `keydown` listener (Ctrl+Alt+T theme toggle; Ctrl+= / Ctrl+- / Ctrl+0 zoom), at the same boot slot **before** `wireKeyboard` (`chrome.js:167-205`).
- **Focus indicator** — focus/blur → `setFocus(true/false)` + `[data-focused]` on `#terminal-wrapper` (`chrome.js:207-224`).
- **visibilitychange BEL-title-strip + catch-up repaint** — strips the `'(!) '` title prefix on foreground return and calls `requestFrame()` (`chrome.js:235-239`). (The *add-prefix* half lives in `main.js sampleBell` — unchanged.)
- **pagehide / visibilitychange SLIDE `CTRL_CAN` wire-safety** — fire-and-forget `0x18` on tab-hide/pagehide during an active SLIDE session (`chrome.js:240-271`).

Also **retained in `chrome.js` for now** (they migrate with their *owning* menu in later epics, NOT here): theme-toggle button click + label (E1.4), phosphor button clicks (E1.4), font `<select>` (E1.5), Auto-connect checkbox (E2), Show-all-serial checkbox (E2), Reset-prefs 2-click confirm (E3). **Do not touch these in E1.3.** Only the two Clear buttons move.

## Acceptance Criteria

1. **No incumbent `chrome.js` behavior is lost; only Clear handlers move (FR-6; NFR-3; AD-13).**
   **Given** `chrome.js` is slimmed (retained, not deleted)
   **When** the app runs
   **Then** the theme chord (Ctrl+Alt+T), the zoom chords (Ctrl+= / Ctrl+- / Ctrl+0), the focus indicator (focus/blur → `setFocus` + `[data-focused]`), the visibilitychange BEL-title-strip + catch-up repaint, and the pagehide/visibilitychange SLIDE `CTRL_CAN` (`0x18`) wire-safety **all still fire exactly as before**
   **And** the **only** handler logic removed from `chrome.js` is the `#clear-button` and `#clear-scrollback-button` click wiring, which now lives in `menu-bar.js` (verified by grep: no `clear_visible` / `resize_scrollback` / `getElementById('clear-…')` remains in `chrome.js`).

2. **Clear / Clear-scrollback relocated to `menu-bar.js` with identical behavior (FR-6; AD-13).**
   **Given** the two incumbent buttons still present in the DOM (`#clear-button`, `#clear-scrollback-button`)
   **When** the user clicks Clear (plain), Clear (Shift+click), or Clear scrollback
   **Then** `menu-bar.js` is the sole owner of both listeners and routes them through one internal action: plain Clear calls `term.clear_visible()`; Shift+click **also** cycles `term.resize_scrollback(0) → resize_scrollback(10000)`; Clear-scrollback cycles `resize_scrollback(0) → 10000`; each then calls `scrollState.snapToBottom()` (via the live getter) and `requestFrame()`
   **And** `retainFocus` is applied to both buttons (terminal focus retained), and behavior is byte-identical to the pre-move `chrome.js` handlers (the incumbent clear specs stay green).

3. **Boot order preserved and pinned (FR-30; NFR-8; AD-12).**
   **Given** the boot sequence in `main.js`
   **When** the app initializes
   **Then** the polite-fail check runs **first** and aborts before wasm (`throw '__polite-fail__'`) when `navigator.serial` is undefined (FR-30 unchanged), and `wireMenuBar` remains wired **after** `wireChrome` and **before** `wireKeyboard`, so the `#terminal-wrapper` `keydown` listener order stays `chrome → menu-bar → keyboard` and chord keys still win via the `defaultPrevented` short-circuit
   **And** a regression spec asserts this ordering (chords reach `chrome.js` first; a bare menu-nav key never swallows a chord) so a future reorder fails loudly.

4. **`menu-bar.js` is a `prefsSubscribe` subscriber that re-projects idempotently without throwing (AD-14; AD-4/AD-5).**
   **Given** `menu-bar.js` exposes an idempotent `projectPrefs(prefs)` and is registered as a `prefsSubscribe` subscriber (the composition root registers it, mirroring `applyPrefs`)
   **When** `resetPrefs()` fires (the only trigger that fans out prefs subscribers)
   **Then** `menu-bar.js.projectPrefs(defaults)` runs, re-projecting whatever View theme/phosphor/font/zoom menu state it owns **without throwing** — and because the real submenus are not wired yet, today it is a safe no-op that touches only existing menu DOM (the body is filled by E1.4/E1.5)
   **And** calling `projectPrefs` twice in a row yields the same DOM (idempotent), and it reads prefs at use-time (`getPrefs()` / the passed blob) — it never caches a stale prefs ref (AD-4).

5. **`main.js applyPrefs` decomposed — single-writer per canvas setter, null-safe on reset (AD-14).**
   **Given** `applyPrefs(p)` is the reset/boot re-application path
   **When** it runs at boot and on `resetPrefs()`
   **Then** each canvas setter (`setTheme` / `setPhosphor` / `setFont` / `setZoom`) is invoked from **exactly one place** on the reset path, and **every** `getElementById` DOM-mirror lookup inside `applyPrefs` is null-guarded so the function never throws if a `#top-bar`/`<details>` control is absent (forward-proofing the later removals — no control is removed in this story)
   **And** `resetPrefs()` restores defaults in-place with **no** page reload and **no** thrown error, chrome + canvas state matching the defaults, and the menu-bar `projectPrefs` subscriber having fired.

6. **No regression; suite green; test hooks intact (FR-6; NFR-3; AD-2; NFR-6).**
   **Given** the decomposition + seam are in place
   **When** the full Playwright chromium suite runs
   **Then** every incumbent oracle stays green — clear-screen, theme toggle (click + Ctrl+Alt+T), zoom (chords), phosphor, focus indicator, bell/visibilitychange title-strip, SLIDE cancel-on-hide, polite-fail — judged by **named oracles in isolation** (`--workers=1`) where the pre-existing parallel-load/wasm-boot flake interferes (E0 action item #1)
   **And** `window.__menuBar.__getStateForTests()` still exposes the E1.1/E1.2 shape plus any new introspection (e.g. `projectPrefs` reachable), and a new/extended spec covers AC-1..AC-5.

## Tasks / Subtasks

- [x] **Task 1 — Pin boot order + polite-fail with a regression spec (AC: 3) — do FIRST; it is a pure safety net before you move code**
  - [x] 1.1 Confirm (no code change expected) that `main.js` boot order is: polite-fail check (`main.js:19-22`, `throw '__polite-fail__'`) → `loadPrefs` → `await init()` → `wireChrome` (`main.js:239`) → `wireMenuBar` (`main.js:259`) → … → `wireKeyboard` (`main.js:450`). If any of these are out of order, STOP and flag — the story assumes they are correct today. **Confirmed in order; no code change.**
  - [x] 1.2 **(RED→GREEN)** Add/extend a spec (`tests/render/menu-bar-keyboard.spec.js` or a new `tests/render/boot-order.spec.js`) asserting: (a) with a menu **closed**, Ctrl+Alt+T still toggles theme and Ctrl+= still zooms (chord reaches `chrome.js` first — proves `menu-bar` didn't swallow it); (b) `polite-fail.spec.js` (existing, `tests/transport/`) stays green (FR-30 abort-before-wasm). Use the `window.__menuBar` boot-race guard (`page.waitForFunction`). **Added `tests/render/boot-order.spec.js` (4 tests, incl. a chord-wins-while-menu-open ordering proof + a polite-fail-before-wasm assertion).**

- [x] **Task 2 — Relocate Clear / Clear-scrollback from `chrome.js` to `menu-bar.js` (AC: 1, 2) — the only handler move in this story**
  - [x] 2.1 **(RED)** In `tests/session/clear-screen.spec.js` (or a companion), assert the incumbent buttons still work **after** the move: `#clear-button` click → visible grid cleared; `#clear-button` Shift+click → visible + scrollback cleared + snap-to-bottom; `#clear-scrollback-button` click → scrollback cleared + snap-to-bottom. (These likely already exist — run them first as the green baseline, then keep them green through the refactor.) **`#clear-button` tests already existed; added a `Clear scrollback (Settings)` describe (2 tests) — no `#clear-scrollback-button` coverage existed before. Green pre- and post-move.**
  - [x] 2.2 **(GREEN)** Add a `menu-bar.js` internal action, e.g. `clearScreen({ alsoScrollback })` and `clearScrollback()`, that calls `termRef.clear_visible()` / `termRef.resize_scrollback(0) → resize_scrollback(10000)`, then `getScrollState()?.snapToBottom()` and `requestFrame?.()`. Source `term`, `getScrollState` (a **thunk** — scrollState is wired *after* menu-bar in `main.js`, so resolve the live ref at click time, mirroring `chrome.js:130` / `main.js:242`), and `requestFrame` from `wireMenuBar(opts)`. Register the two button click listeners via the existing `trackListener` (so `dispose()` detaches them), applying `retainFocus` to each button (AD-10). **Done — `clearScreen`/`clearScrollback` + `wireClearButtons()` in menu-bar.js.**
  - [x] 2.3 Update `main.js`'s `wireMenuBar({ terminalWrapper })` call (`main.js:259`) to pass `{ terminalWrapper, term, getScrollState: () => scrollStateRef, requestFrame }`. Then **remove** the two clear-button blocks from `chrome.js` (`chrome.js:111-136` and `:273-288`) and drop the now-unused `term`/`getScrollState` from `wireChrome`'s destructure **only if** nothing else in `chrome.js` still uses them (grep first — `term`/`getScrollState` are used only by the two clear blocks today, so they can leave `wireChrome`; `requestFrame` is still used by the visibilitychange repaint, so it **stays** in `wireChrome`). Update the `wireChrome({...})` call site (`main.js:239-249`) accordingly. **Done — grep confirmed `termArg`/`getScrollState` were sole-consumed by the clear blocks; `requestFrame` retained.**
  - [x] 2.4 Grep-audit: no `clear_visible` / `resize_scrollback` / `getElementById('clear-button')` / `getElementById('clear-scrollback-button')` remains in `chrome.js`; they exist exactly once, in `menu-bar.js`. Confirm the clear specs stay green in isolation (`--workers=1`). **Grep clean (only comments mention clear); clear specs green `--workers=1`.**

- [x] **Task 3 — Stand up the `prefsSubscribe` re-projection seam in `menu-bar.js` (AC: 4)**
  - [x] 3.1 Add an exported/`API`-surfaced `projectPrefs(prefs)` to `menu-bar.js`: idempotent, never-throwing, reads values from the passed blob (or `getPrefs()` at use-time — **never** cache a prefs ref, AD-4). Today it re-projects only View menu state that exists; since the theme/phosphor/font/zoom submenus are placeholders (E1.4/E1.5), it is a safe no-op that touches only present DOM. Add a short comment naming E1.4/E1.5 as the fillers of the body. Expose it on the `menu-bar` API object (returned from `wireMenuBar`) so `main.js` can register it and tests can call it. **Done — `export function projectPrefs(prefs)` + on `buildApi()`; imports `getPrefs` from prefs.js (AD-3).**
  - [x] 3.2 In `main.js`, register the subscriber next to the existing `prefsSubscribe(applyPrefs)` (`main.js:1113`): `prefsSubscribe(menuBar.projectPrefs)` (and call `menuBar.projectPrefs(prefs)` once at boot for parity with `applyPrefs(prefs)` at `:1114`). Decide the prefs-access path: **recommended** — inject nothing new; `menu-bar.js` may `import { getPrefs } from '../state/prefs.js'` directly (AD-3 explicitly permits `menu-bar.js` → `prefs.js`), or read from the `prefs` blob passed to `projectPrefs`. Do **not** thread `savePrefs` here (no writes in this story). **Done — registered + boot-call parity; chose the `import getPrefs` path; no `savePrefs` threaded.**
  - [x] 3.3 **(RED→GREEN)** Spec: call `window.__menuBar.projectPrefs(somePrefs)` twice → asserts no throw and identical resulting menu DOM (idempotent). Drive `window.__prefs.resetPrefs()` → assert the subscriber ran (e.g. a spy/observable side effect, or simply that no error was thrown and menu state is consistent). Keep the assertion honest to the no-op reality — the strong idempotence/no-throw contract is what E1.4/E1.5 will rely on. **Added `tests/render/menu-bar-prefs.spec.js` (3 tests: reachable, idempotent+no-throw incl. bare use-time call, resetPrefs drives it without corrupting open/close state).**

- [x] **Task 4 — Decompose `main.js applyPrefs` for single-writer + null-safety (AC: 5)**
  - [x] 4.1 Audit `applyPrefs` (`main.js:1053-1112`): confirm each canvas setter (`setTheme`, `setPhosphor`, `setFont`, `setZoom`) is called from **exactly one place** on the reset path (it is today — verify no duplicate call sneaks in via the menu-bar seam; `menu-bar.projectPrefs` must **not** call canvas setters, only project menu DOM — canvas setters remain owned by `applyPrefs`, avoiding the AD-14 double-apply race). **Confirmed single-writer; `projectPrefs` calls no canvas setter.**
  - [x] 4.2 Null-guard **every** `getElementById` DOM-mirror inside `applyPrefs` so it never throws when a control is absent. Most are already guarded (`if (fontSelect)`, `if (autoConnectCheckbox)`, …); harden the currently-unguarded direct-property mirrors — `themeButton.textContent`, `phosphorGroup.hidden`, the `phosphorButtons` loop, `localEchoCheckbox.checked`, the `crlfRadios` loop, and the `serialBaud`/`serialDataBits`/… form mirrors — with presence checks (`if (themeButton)`, `if (phosphorGroup)`, `if (localEchoCheckbox)`, etc.) so the later `#top-bar`/`<details>` removals (E1.4→E7) can't turn `applyPrefs` into a boot/reset crash. **No control is removed in this story** — this is forward-proofing only; behavior is unchanged. **Guarded `themeButton`/`phosphorGroup`/`phosphorButtons` loop/`localEchoCheckbox`/`crlfRadios` loop. (Serial form mirrors were already `if (…)`-guarded.)**
  - [x] 4.3 **(GREEN)** Spec: drive `window.__prefs.resetPrefs()` → assert no throw, defaults applied (theme reset, phosphor reset, zoom reset), and (belt-and-braces) that a hand-removed control does not crash reset — e.g. `document.getElementById('font-select').remove()` then `resetPrefs()` → still no throw (simulates the E1.5 removal early). Keep this spec as the AD-14 guardrail for downstream epics. **Added 2 tests to `tests/session/prefs.spec.js` (`E1.3 AC-5 …` describe): defaults-in-place no-throw + hand-removed-control no-throw.**

- [x] **Task 5 — No-behavior-lost regression harness + compliance audit (AC: 1, 6)**
  - [x] 5.1 Assemble/confirm the named-oracle set that pins the four SACRED `chrome.js` behaviors post-slim: theme toggle (`theme-toggle.spec.js` — click + Ctrl+Alt+T), zoom (`zoom.spec.js` — chords), phosphor (`phosphor.spec.js`), focus indicator (`focus.spec.js` in `tests/render`), bell/visibilitychange title-strip (`bell.spec.js`), SLIDE cancel-on-hide (`slide-cancel.spec.js`), polite-fail (`polite-fail.spec.js`). Run each in isolation (`--workers=1`) and record green. **All named oracles green `--workers=1`.**
  - [x] 5.2 Run the full chromium suite. For any failure, re-run the offending spec `--workers=1` to separate a real regression from the pre-existing parallel-load/wasm-boot flake (E0 action item #1). The **named** oracles above are the correctness contract. **Full suite: 370 passed, 1 skipped, 3 parallel-only failures (paste/readloop/slide-chip connect-handshake) — all green in isolation → confirmed the E0 flake, not a regression.**
  - [x] 5.3 Grep-audit compliance: `chrome.js` no longer references the clear buttons (Task 2.4); `menu-bar.js` imports only `focus.js` (+ optionally `prefs.js` per AD-3) — **no** import of `keyboard.js`/`canvas.js`-clear/`slide*`; `menu-bar.js` state stays module-scope; `render()` remains the sole writer of open/close DOM state (`projectPrefs` must not fight it — it projects only View item check/label state, which those rows don't have yet); named exports only; new listeners attached via `trackListener`. Confirm `window.__menuBar`/`window.__prefs` API shapes are unchanged except the additive `projectPrefs`. **Audit clean: menu-bar.js imports `focus.js` + `prefs.js` only; named exports only; all wiring via `trackListener`; `render()` sole open/close writer; `__menuBar` additive `projectPrefs`, `__prefs` unchanged.**

## Dev Notes

### Developer context — what this story IS (and is NOT)

- **IS:** the **decomposition + no-loss backbone**. Four concrete deliverables: (1) **pin** boot order & polite-fail with a regression spec (mostly already true — you are locking it, not moving it); (2) **relocate** the two Clear handlers from `chrome.js` into `menu-bar.js` (the *only* AD-13 handler move), keeping the incumbent buttons byte-identical; (3) **stand up** the `prefsSubscribe` re-projection **seam** in `menu-bar.js` (idempotent, no-throw `projectPrefs`, no-op body today); (4) **decompose** `main.js applyPrefs` for single-writer + null-safety. Plus a regression harness proving every SACRED `chrome.js` behavior survives.
- **IS NOT:** removing `#top-bar` / the `<details>` panes (their controls migrate with their owning menus — E1.4/E1.5/E2/E3/E5/E7); wiring the View submenu panels or the View ▸ Clear menu item (E1.4/E1.5); touching `serial.js`'s connect projection (E2/AD-15); moving theme/phosphor/font/auto-connect/reset-prefs handlers out of `chrome.js` (they migrate with their menus later). **Do not front-run E1.4/E1.5** — the E0 retro flagged that E0.1 already front-ran part of this story once; keep the diff tight.

### The single highest-risk clause: "no behavior lost" while slimming `chrome.js` (FR-6 / AD-13)

`chrome.js` is a dense, load-bearing file (theme/zoom chords, focus indicator, two visibility/pagehide SLIDE-safety branches, BEL title-strip, plus the controls that stay for now). The failure mode is a **silent** loss — e.g. removing the Clear blocks and accidentally taking `requestFrame` out of `wireChrome`'s destructure (it is still needed by the visibilitychange repaint at `chrome.js:239`), or a clear button that no longer snaps-to-bottom because the `getScrollState` thunk wasn't threaded. Mitigations:

- **Move only the two Clear blocks** (`chrome.js:111-136` `#clear-button`; `chrome.js:273-288` `#clear-scrollback-button`). Everything else in `wireChrome` stays put. `requestFrame` **remains** a `wireChrome` opt (visibilitychange uses it); `term` and `getScrollState` can leave `wireChrome` **only** because the two clear blocks are their sole consumers — grep to confirm before deleting from the destructure.
- **The `getScrollState` thunk pattern is mandatory and subtle.** `scrollState` is wired at `main.js:270`, *after* both `wireChrome` (`:239`) and `wireMenuBar` (`:259`). So `menu-bar.js` must receive `getScrollState: () => scrollStateRef` (a thunk resolving the live ref at click time), exactly as `chrome.js` does today (`chrome.js:130`, `main.js:242`, late-bound at `main.js:282`). Passing the value directly would capture `null`. [Source: chrome.js:74-84,130; main.js:215,242,270-282]
- **Judge by named oracles in isolation.** The full parallel suite flakes on wasm-boot starvation (E0 action item #1). A shifting parallel-failure set is **not** a regression from this story. Run the SACRED oracles `--workers=1`. [Source: e1-2 Debug Log; epic-e0-retro-2026-07-01.md #1]

### Boot order is load-bearing and already correct — you are pinning it, not building it (AC-3 / AD-12)

`main.js` already boots in the AD-12 order: polite-fail first (`:19-22`, aborts before `await init()` at `:156`), then `wireChrome` (`:239`) → `wireMenuBar` (`:259`) → `wireKeyboard` (`:450`). The three `#terminal-wrapper` `keydown` listeners attach in that order and each short-circuits on `e.defaultPrevented`, so chords reach `chrome.js` first and the terminal Esc chain reaches `keyboard.js` last (the E1.2 mechanism). **Do not reorder any wiring.** Your job is a regression spec that makes a future reorder fail loudly. [Source: main.js:19-22,156,239,259,450; chrome.js:167-205; ARCHITECTURE-SPINE.md#AD-12,#AD-13]

### The reset re-projection seam — subscription + idempotence now, body later (AC-4 / AD-14)

AD-14: `menu-bar.js` "registers as a `prefsSubscribe` subscriber and idempotently re-projects its own theme/phosphor/font/zoom menu state on reset." The prefs subscription (`state/prefs.js`) fires subscribers **only** on `resetPrefs()` — `savePrefs` does **not** fire them (AD-4). `resetPrefs()` sets `cached = DEFAULTS` and calls every subscriber with the fresh blob (`prefs.js:157-161`). `main.js` already registers `applyPrefs` as the one subscriber (`main.js:1113`); this story adds `menuBar.projectPrefs` as a second.

The division of labor is critical to avoid the AD-14 **double-apply race**: **`applyPrefs` owns the canvas setters** (`setTheme`/`setPhosphor`/`setFont`/`setZoom`) — exactly one call site each. **`menuBar.projectPrefs` owns only the View *menu* DOM projection** (check glyphs / active-radio / zoom label on the View submenu rows). Today those rows are placeholders with no real state, so `projectPrefs` is a safe no-op — but standing up the subscription + the idempotent/no-throw contract **now** means E1.4 (theme/phosphor) and E1.5 (font/zoom) only fill the body, and `resetPrefs()` already re-projects the menu the moment they do. Read prefs at use-time (`getPrefs()` or the passed blob) — never cache the ref across a save (AD-4: `savePrefs` reassigns `cached`). [Source: state/prefs.js:111-171; main.js:1046-1114; ARCHITECTURE-SPINE.md#AD-4,#AD-14]

> **Identifier note (reconciled):** the architecture spine names the prefs reset-subscription both `subscribe()` (AD-4) and `prefsSubscribe` (AD-14). They are the same function — `state/prefs.js` exports `subscribe`, which `main.js` imports as `prefsSubscribe` (`main.js:32`). This story uses `prefsSubscribe` for the import alias and `subscribe`/`getPrefs`/`resetPrefs` for the raw exports.

### `applyPrefs` decomposition — single-writer + forward-proofing null-safety (AC-5 / AD-14)

`applyPrefs` (`main.js:1053-1112`) is *already* close to the AD-14 target: each canvas setter is called once, and most DOM mirrors are null-guarded (`if (fontSelect)`, `if (autoConnectCheckbox)`, `if (showAllSerialCheckbox)`, `if (serialAssertRtsCheckboxRef)`, `if (p.serial)`). The remaining unguarded direct-property mirrors — `themeButton.textContent`, `phosphorGroup.hidden`, the `phosphorButtons` loop, `localEchoCheckbox.checked`, the `crlfRadios` loop — are fetched from module-scope consts at boot (`main.js:163-169`) and would throw if the element were absent. Guard them (`if (themeButton) …`, etc.) so the later removals (E1.4 removes `#theme-toggle`/`#phosphor-group`; E1.5 removes `#font-select`; E3 removes local-echo/crlf) cannot turn `applyPrefs` into a boot/reset crash — the exact failure AD-14 exists to prevent. **This is forward-proofing; no control is removed here and no observable behavior changes.** Keep `menuBar.projectPrefs` out of the canvas-setter business — that's the single-writer guarantee. [Source: main.js:162-171,1053-1114; ARCHITECTURE-SPINE.md#AD-14]

### Architecture compliance (hard guardrails)

- **AD-13 (chrome.js retained + slimmed):** `wireChrome` is **not deleted**; only Clear/Clear-scrollback handlers leave it. Theme/zoom chords, focus indicator, visibilitychange BEL-strip + repaint, pagehide/visibilitychange SLIDE `CTRL_CAN` all **stay**. No behavior may fall through unassigned. [Source: ARCHITECTURE-SPINE.md#AD-13 (:131-134); structural seed :190-191]
- **AD-12 / NFR-8 (boot order):** polite-fail first (abort before wasm); `menu-bar` after `wireChrome`, before `wireKeyboard`. Do not reorder. [Source: ARCHITECTURE-SPINE.md#AD-12 (:126-129)]
- **AD-14 (reset ownership):** `menu-bar.js` is a `prefsSubscribe` subscriber, idempotent + no-throw; `applyPrefs` decomposed, single-writer per canvas setter, null-safe on removed controls. [Source: ARCHITECTURE-SPINE.md#AD-14 (:136-139)]
- **AD-4 (prefs single source):** write via `savePrefs` (n/a this story — no writes), read via `getPrefs()` at use-time, never cache the ref; subscribers fire only on `resetPrefs()`. [Source: ARCHITECTURE-SPINE.md#AD-4 (:85-88)]
- **AD-1 / AD-2 (composition-root + `wireXxx` shape):** the composition root (`main.js`) wires the new `menu-bar` opts and registers the subscriber; `menu-bar.js` keeps module-scope state + `render()` + `dispose()` + `__getStateForTests`; expose test hooks on `window.__menuBar`. Named exports only, no build step. [Source: ARCHITECTURE-SPINE.md#AD-1 (:70-73), #AD-2 (:75-78)]
- **AD-3 (import allowlist):** `menu-bar.js` may import only `renderer/canvas.js` setters + `state/prefs.js` directly; everything else via opts. This story needs `term`/`getScrollState`/`requestFrame` **via opts** (not imports) and may `import { getPrefs } from '../state/prefs.js'` for the seam. Do **not** import `keyboard.js` / `slide*` / `paste-pump.js`. [Source: ARCHITECTURE-SPINE.md#AD-3; menu-bar.js:40]
- **AD-10 / NFR-1 ("Sacred"):** `retainFocus` on both relocated Clear buttons; nav path never steals terminal focus. [Source: chrome.js:135,287]

### Reuse — do NOT reinvent

- **Clear logic already exists verbatim** — copy the semantics from `chrome.js:120-136` (`#clear-button`: `clear_visible` + Shift→`resize_scrollback(0)→10000` + `snapToBottom` + `requestFrame`) and `chrome.js:279-288` (`#clear-scrollback-button`). Fold both into one `menu-bar.js` action pair; do not rewrite the wasm calls.
- **`getScrollState` thunk pattern** — mirror `chrome.js:130` + `main.js:242,282`. `menu-bar` gets `getScrollState: () => scrollStateRef`.
- **`trackListener` / `retainFocus`** — already in `menu-bar.js` (`:68`, imported `:40`). Register the clear buttons through `trackListener` so `dispose()` detaches them; `retainFocus(button)` for focus retention.
- **Subscriber registration precedent** — `main.js:1113` `prefsSubscribe(applyPrefs)` + `applyPrefs(prefs)` at boot (`:1114`). Add `prefsSubscribe(menuBar.projectPrefs)` alongside; call `menuBar.projectPrefs(prefs)` once at boot.
- **`resetPrefs()` mechanics** — `prefs.js:157-161` already fans out to subscribers; you are adding a subscriber, not changing the fan-out.
- **Boot-race guard in specs** — gate on `window.__menuBar` / `window.__prefs` via `page.waitForFunction` (E1.1/E1.2 pattern, `menu-bar.spec.js:25-28`).

### Existing code being touched (read before editing)

- **`www/renderer/chrome.js`** — **slimmed** this story. *Current state:* one file wiring theme/zoom chords (`:167-205`), focus indicator (`:207-224`), visibilitychange BEL-strip + repaint + SLIDE `CTRL_CAN` (`:235-257`), pagehide SLIDE `CTRL_CAN` (`:266-271`), the two Clear buttons (`:111-136`, `:273-288`), plus theme/phosphor/font/auto-connect/show-all/reset-prefs controls that **stay for now**. *This story changes:* removes **only** the two Clear blocks and (if grep-clean) the `term`/`getScrollState` opts; keeps `requestFrame` (visibilitychange needs it). *Must preserve:* all four SACRED behaviors + every still-present control handler.
- **`www/renderer/menu-bar.js`** — **owned/extended** this story. *Current state:* E1.1 shell + E1.2 keyboard layer; imports only `focus.js`; `wireMenuBar(opts)` takes `{ terminalWrapper }`; state module-scope; `render()` sole writer of open/close DOM; `__getStateForTests`/`__resetForTests`/`dispose`. *This story adds:* `clearScreen`/`clearScrollback` actions + their button wiring (via `trackListener`+`retainFocus`), an idempotent `projectPrefs(prefs)` on the API, new opts (`term`, `getScrollState`, `requestFrame`), and optionally `import { getPrefs } from '../state/prefs.js'`. *Must preserve:* the E1.2 keydown/Esc-guard path untouched; `render()` stays the sole open/close writer (`projectPrefs` projects only View item state, which is empty today).
- **`www/main.js`** — *This story changes:* the `wireChrome({...})` call (`:239-249`, drop `term`/`getScrollState`) and the `wireMenuBar({ terminalWrapper })` call (`:259`, add `term`/`getScrollState`/`requestFrame`); add `prefsSubscribe(menuBar.projectPrefs)` + a boot-time `menuBar.projectPrefs(prefs)` next to `:1113-1114`; harden the unguarded `applyPrefs` DOM mirrors (`:1053-1112`). *Must preserve:* boot order (`:239`/`:259`/`:450`), `scrollStateRef` late-bind (`:282`), `applyPrefs` single-writer per canvas setter.
- **`www/index.html`** — **not modified** (no markup added/removed this story). `#clear-button` (`:1074`, in `#top-bar`) and `#clear-scrollback-button` (`:1241`, under the Settings `<details>` region) stay put; only their JS ownership moves. Do **not** remove `#top-bar`/`<details>`.
- **`www/state/prefs.js`** — **not modified**; read `subscribe`/`resetPrefs`/`getPrefs`/`DEFAULTS` (`:157-171,18`) to understand the fan-out you're subscribing to.

### Testing requirements

- **Framework:** Playwright, **chromium project**; `testDir: ./tests`; specs at `www/tests/{render,session,transport}/*.spec.js`; server `python3 -m http.server -d . 8000`, `baseURL http://localhost:8000/`. [Source: playwright.config.js]
- **Boot-race guard:** gate on `window.__menuBar` / `window.__prefs` with `page.waitForFunction` before driving (E1.1/E1.2 pattern).
- **Cover (E1.3 slice):** (1) boot-order/chord-priority (chord reaches `chrome.js` with menu closed; polite-fail abort green); (2) Clear/Clear-scrollback still work post-move (visible clear, Shift+also-scrollback, snap-to-bottom); (3) `projectPrefs` idempotent + no-throw, `resetPrefs()` fires it; (4) `applyPrefs` no-throw on reset incl. a hand-removed control; (5) the SACRED-behavior oracle set stays green.
- **Named oracles = the correctness contract (FR-6/NFR-3):** `clear-screen.spec.js`, `theme-toggle.spec.js`, `zoom.spec.js`, `phosphor.spec.js`, `render/focus.spec.js`, `bell.spec.js`, `transport/slide-cancel.spec.js`, `transport/polite-fail.spec.js`. Don't just assert internal state — assert the *downstream effect* (grid cleared, title prefix stripped, `0x18` on the wire).
- **Flake protocol (E0 action item #1):** judge regressions by named oracles in isolation (`--workers=1`). The full parallel suite's shifting wasm-boot failure set is not a regression from this story. [Source: e1-2 Debug Log; epic-e0-retro-2026-07-01.md]

### Previous-story intelligence (E1.1 → E1.2 → E0)

- **E1.2 shipped the keyboard layer this story sits beneath** — one `keydown` on `#terminal-wrapper` via `trackListener`, Esc passthrough guard (close+`preventDefault` when open; silent early-return when closed), `focusedIndex` nav, `openSubmenu` no-op hook. `window.__menuBar` = `{ open, close, getOpenMenu, dispose, __getStateForTests, __resetForTests }`. **Do not disturb this path** — your additions (`clearScreen`/`clearScrollback`/`projectPrefs`) are orthogonal. [Source: e1-2 Completion Notes]
- **E0 retro action item #3 (this story, verbatim):** "`chrome.js` already has zero inline focus sites (migrated in E0.1) so the work isn't re-planned." Confirmed — `chrome.js` uses `retainFocus` everywhere (`:135,152,164,287,305,318,333,361`). **Focus-retention rehoming is NOT part of E1.3.** [Source: epic-e0-retro-2026-07-01.md #3; chrome.js]
- **E0 retro action item #1 (flake):** standing convention — judge regressions by named oracles `--workers=1`. Apply throughout.
- **Scope-boundary caution (recurring E0.1→E1.3 drift):** E0.1 front-ran E1.3's focus migration once already. Resist front-running E1.4/E1.5 — do **not** build View submenu panels, do **not** wire the View ▸ Clear item, do **not** remove `#top-bar`.
- **Neutral-shell pin:** `#menu-bar` pins neutral `--chrome-*` values; any new code stays token-safe and adds no `[data-theme]`/phosphor branch.

### Git intelligence

Recent commits are the E1/E0 backbone (`add keyboard navigation + Esc-passthrough guard (E1.2)`, `add menu-bar shell + dropdown mechanics (E1.1)`, `add shared openModal helper (E0.2)`, `add shared retainFocus helper (E0.1)`). Established patterns to mirror: **named exports; `wireXxx(opts)` shape; `window.__xxx` + `__getStateForTests` hooks; `data-*`/`[hidden]` state (never inline styles); `trackListener` for dispose; the `getScrollState` late-bind thunk; test-first with named oracles; atomic per-task commits.** This story is a **relocation + seam** — keep the diff tight and additive, and prove no behavior moved by accident. Baseline: `b8e7708` (`mark story E1-2 done`).

### Project Structure Notes

- Aligns with the `renderer/` module convention and the composition-root seam. **No new module** — the Clear actions + `projectPrefs` seam live inside the existing `menu-bar.js`; `chrome.js` shrinks. **No new import edge** except the AD-3-permitted `menu-bar.js` → `state/prefs.js` (for `getPrefs`), if you choose that over reading the passed blob.
- **Known variance (intentional, carried from E1.1):** `#top-bar` + the three `<details>` panes still coexist with `#menu-bar`; this story keeps them **live** (their controls are rehomed in E1.4/E1.5/E2/E3/E5/E7). `#top-bar` deletion completes only in E7.
- **Deferred, by design:** View submenu panels + View ▸ Clear item (E1.4/E1.5); theme/phosphor/font/auto-connect/reset-prefs handler migration (E1.4/E1.5/E2/E3); `serial.js` connect projection (E2); paste toast (E7).

### References

- [Source: epics.md#Story-E1.3 (:303-324)] — story text + ACs (FR-6 no-loss, FR-30 polite-fail).
- [Source: epics.md — FR-6 (:37), FR-30 (:61); NFR-3 (:69), NFR-8 (:74); Additional Requirements — chrome.js decomposition (:85), reset path decomposition (:87), removal work (:88)]
- [Source: ARCHITECTURE-SPINE.md — AD-13 (:131-134, chrome.js retained+slimmed, Clear→menu-bar), AD-12 (:126-129, boot order), AD-14 (:136-139, reset re-projection), AD-4 (:85-88, prefs SSOT), AD-5 (:90-93, federated subscribe), AD-1 (:70-73), AD-2 (:75-78), AD-3 (:80-83); structural seed (:190-191)]
- [Source: www/renderer/chrome.js — clear buttons (:111-136, :273-288); SACRED: chords (:167-205), focus indicator (:207-224), visibilitychange BEL+repaint+SLIDE (:235-257), pagehide SLIDE (:266-271); getScrollState thunk (:74-84,130)]
- [Source: www/renderer/menu-bar.js — wireMenuBar/opts (:82-128), trackListener (:68), retainFocus import (:40), render sole-writer (:350-375), API (:393-402), __getStateForTests (:418-429)]
- [Source: www/main.js — polite-fail (:19-22), boot order wireChrome/wireMenuBar/wireKeyboard (:239,:259,:450), scrollStateRef thunk (:215,:242,:282), applyPrefs (:1053-1112), prefsSubscribe(applyPrefs)+boot call (:1113-1114), applyPrefs DOM-mirror consts (:162-171)]
- [Source: www/state/prefs.js — subscribe (:163), resetPrefs fan-out (:157-161), getPrefs (:171), DEFAULTS (:18)]
- [Source: www/index.html — #top-bar + #clear-button (:1066-1097), View dropdown placeholders incl. "Clear" action row, #settings + #clear-scrollback-button]
- [Source: e1-2-…md — keyboard layer + flake protocol; epic-e0-retro-2026-07-01.md — action items #1 (flake) & #3 (focus sites already migrated)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Amelia / Dev Story workflow)

### Debug Log References

- **Green baseline (pre-change), `--workers=1`:** clear-screen, theme-toggle, zoom, phosphor, render/focus, menu-bar, menu-bar-keyboard, polite-fail → 53 passed.
- **Post-relocation, `--workers=1`:** clear-screen (6, incl. 2 new clear-scrollback), menu-bar, menu-bar-keyboard, boot-order (4 new), theme-toggle, zoom, focus → 52 passed.
- **Seam + null-safety, `--workers=1`:** menu-bar-prefs (3 new) → 3 passed; prefs (18, incl. 2 new AD-14 guardrails) → 18 passed.
- **SACRED oracles, `--workers=1`:** bell (title-strip on visibility return) + slide-cancel (CTRL_CAN) → 9 passed.
- **Full chromium suite (parallel):** 370 passed, 1 skipped, **3 failed** — `transport/paste`, `transport/readloop`, `transport/slide-chip`, all connect-handshake `expect.poll` timeouts under 10 concurrent contexts. Re-ran all three `--workers=1` → **24 passed**. Confirmed the pre-existing parallel-load/wasm-boot flake (E0 retro action item #1), **not** a regression from E1.3 (none of the three touch chrome.js/menu-bar/applyPrefs).

### Completion Notes List

- **AD-13 handler move (only one this story):** the `#clear-button` and `#clear-scrollback-button` click handlers left `chrome.js` and are now solely owned by `menu-bar.js` (`clearScreen({ alsoScrollback })` / `clearScrollback()` + `wireClearButtons()`), wired via `trackListener` (dispose-safe) with `retainFocus` (AD-10). Semantics copied verbatim — byte-identical behavior; incumbent clear specs stay green. The `getScrollState` **thunk** pattern was preserved (scrollState late-binds after menu-bar in `main.js`), so snap-to-bottom resolves the live ref at click time.
- **`chrome.js` slimmed, not deleted:** the four SACRED behaviors (theme/zoom chords, focus indicator, visibilitychange BEL-strip + catch-up repaint, pagehide/visibilitychange SLIDE `CTRL_CAN`) are untouched. `requestFrame` **stays** a `wireChrome` opt (visibilitychange needs it); only `term`/`getScrollState` left the destructure (grep-confirmed sole-consumed by the clear blocks).
- **Reset re-projection seam (AD-14):** `menu-bar.js.projectPrefs(prefs)` is registered as a second `prefsSubscribe` subscriber alongside `applyPrefs`. It reads prefs at use-time (passed blob → `getPrefs()` fallback), never caches (AD-4), never throws, and is idempotent. Body is a safe no-op today (View submenus are E1.4/E1.5 placeholders) but the subscription + contract land now. Division of labour is enforced: `applyPrefs` owns the canvas setters (single-writer), `projectPrefs` owns only View menu-item DOM — no double-apply race; `render()` stays the sole writer of open/close state.
- **`applyPrefs` forward-proofed (AD-14):** every direct-property DOM mirror (`themeButton`, `phosphorGroup`, `phosphorButtons` loop, `localEchoCheckbox`, `crlfRadios` loop) is now null-guarded so a later epic's control removal (E1.4/E1.5/E3) can't crash boot/reset. No control removed this story — behavior unchanged; guardrail spec simulates the removal early.
- **Scope honored:** no `#top-bar`/`<details>` removal; no View submenu panels or View ▸ Clear wiring; no theme/phosphor/font/auto-connect/reset-prefs handler migration. Diff kept tight and additive (E0 retro front-run caution respected).

### File List

- `www/renderer/chrome.js` — removed the two Clear-button blocks + `term`/`getScrollState` opts (kept `requestFrame`); replaced with a relocation note.
- `www/renderer/menu-bar.js` — added `clearScreen`/`clearScrollback`/`wireClearButtons` + `term`/`getScrollState`/`requestFrame` opts; added `import { getPrefs }`; added idempotent `projectPrefs(prefs)` seam + on `buildApi()`.
- `www/main.js` — moved `term`/`getScrollState` from `wireChrome` to `wireMenuBar` (thunk); registered `prefsSubscribe(menuBar.projectPrefs)` + boot-call parity; null-guarded `applyPrefs` DOM mirrors.
- `www/tests/render/boot-order.spec.js` — **new**: boot-order/chord-priority + polite-fail-before-wasm regression pin (AC-3).
- `www/tests/render/menu-bar-prefs.spec.js` — **new**: `projectPrefs` idempotent/no-throw + resetPrefs fan-out (AC-4).
- `www/tests/session/clear-screen.spec.js` — added `Clear scrollback (Settings)` describe (2 tests) pinning `#clear-scrollback-button` post-move (AC-1/AC-2).
- `www/tests/session/prefs.spec.js` — added `E1.3 AC-5 …` describe (2 tests): reset defaults-in-place + hand-removed-control no-throw (AC-5).

## Change Log

| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2026-07-02 | 0.1 | Story drafted — comprehensive context engineering. Scope pinned to the decomposition backbone: relocate the two Clear handlers to `menu-bar.js` (only AD-13 handler move), stand up the idempotent `prefsSubscribe` re-projection seam (`projectPrefs`, no-op body today, filled by E1.4/E1.5), decompose `main.js applyPrefs` (single-writer + null-safety), and a regression harness pinning all SACRED `chrome.js` behaviors + boot order. Explicitly NOT removing `#top-bar`/`<details>` and NOT wiring the View menu (deferred to E1.4/E1.5/E2/E3/E5/E7). E0 action item #3 honored (focus sites already migrated in E0.1). | Amelia (create-story) |
| 2026-07-02 | 1.0 | Story implemented (all 5 tasks). Relocated `#clear-button`/`#clear-scrollback-button` handlers `chrome.js` → `menu-bar.js` (byte-identical, `getScrollState` thunk + `retainFocus` + `trackListener`); slimmed `chrome.js` keeping the four SACRED behaviors + `requestFrame`; stood up the idempotent no-throw `projectPrefs` reset seam as a second `prefsSubscribe` subscriber; null-guarded every `applyPrefs` DOM mirror (single-writer preserved). Added `boot-order.spec.js` + `menu-bar-prefs.spec.js` and extended `clear-screen.spec.js` + `prefs.spec.js`. Named oracles green in isolation; full suite 370 passed / 3 parallel-only flakes (E0 action item #1, green `--workers=1`). Status → review. | Amelia (dev-story) |
