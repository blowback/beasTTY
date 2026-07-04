---
baseline_commit: 3dc1e93d761d3d170f88331cf63228038d99a652
---

# Story E6.2: About Beastty modal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a privacy-conscious user,
I want an About modal with build and privacy info,
so that I can confirm the build and that no data leaves my browser.

**Covers:** FR-25 (About Beastty modal — build SHA + builtAt, privacy line verbatim, source link `TBD`, Chromium note; AD-8), UX-DR10.
**Epic:** E6 · Help Menu. **Depends on:** E0.2 (the shared `openModal` helper — `renderer/modal.js`), E1.1 (menu-bar shell + the `#dropdown-help` "About Beastty…" placeholder row, `index.html:1582-1584`), E1.2 (keyboard nav + Esc-passthrough guard), **E4.2** (the `window.__buildInfo` global — `{sha, builtAt}` — deliberately kept alive and single-sourced with `#status-build` *for exactly this modal*, `main.js:499-511`), and **E6.1** (the immediate clone template — `#keyboard-shortcuts-modal` + `openKeyboardShortcuts`). This is the **last story of Epic E6** (`sprint-status.yaml`); the epic already read `in-progress` since E6.1, so no epic-status flip on creation. The epic retrospective is `optional`.

**Premise — this is a FIFTH static-content `<dialog>` on the shared modal seam, cloned from E6.1's `#keyboard-shortcuts-modal`, with ONE new wrinkle: the build SHA + builtAt are DYNAMIC.** The whole modal seam has shipped four times (E2.3 Serial Config, E3.3 reserved-Ctrl info, E3.4 SLIDE, E6.1 Keyboard Shortcuts). E6.2 adds a `<dialog id="about-modal" class="chrome-modal">` on the identical rails: a Help-menu action row (`data-action="about"`), one entry in the `menu-bar.js:966-971` action→opener map, one zero-arg `openAbout()` opener in `main.js` injected into `wireMenuBar`. Like `#reserved-ctrl-modal`/`#keyboard-shortcuts-modal` it is a **non-destructive info modal** (body copy + Close), so `initialFocus` = the Close button and the caller ignores `returnValue` (AD-8 policy #4). The `menu-bar.js` map comment literally names this story as its next entry ("a new modal (e.g. Help ▸ About/E6.2) is one entry, not another copy-pasted branch").

**The ONE thing that differs from E6.1.** E6.1 was 100% static markup. E6.2's build SHA + builtAt are **read from `window.__buildInfo` at open time** — so `openAbout` uses the `makeModalOpener(el, focusId, onOpen)` **third arg** (exactly as `openSlideConfig` does, `main.js:263-264`) to project the live stamp into the modal's SHA/builtAt fields just before `showModal()`. This is a **use-time projection**, not a boot snapshot: the stamp arrives via an async import that resolves after boot, and the About row is reached at use-time, so read `window.__buildInfo` in `onOpen` and render it — never bake the SHA into static HTML. **Everything else is a clone** — no `modal.js` change, no new pref/state, no build step, no new dependency.

**The four content blocks (FR-25 / UX-DR10, single-sourced):**
1. **Build SHA + builtAt** — from `window.__buildInfo` (`{sha, builtAt}` — the SAME object `#status-build` renders, `status-bar.js:179-183`). Must match the status bar exactly (one source, never disagree).
2. **Privacy line, VERBATIM** — `No telemetry. No data leaves your browser.` — reused from the polite-fail page (`transport/serial.js:129`, the SSOT for this string).
3. **Source link** — a literal `TBD` placeholder (per FR-25/UX-DR10 — Ant sets the real URL later; do NOT invent one).
4. **Chromium-requirement note** — one line matching the polite-fail framing ("Beastty requires a Chromium-based browser; Web Serial is a Chromium-only API").

## Acceptance Criteria

The epic's single AC (`epics.md` §Story E6.2) — "Help ▸ About Beastty… shows the build SHA + builtAt, 'No telemetry. No data leaves your browser.' verbatim, a source link (literal `TBD`), and the Chromium note" — decomposed into falsifiable ACs. AC-1/AC-2 are the epic AC's two halves (opens-via-openModal + shows-the-four-blocks); AC-3…AC-5 make the implicit info-modal / aesthetic / suite-green requirements testable.

**AC-1 — Help ▸ About Beastty… closes the dropdown, then opens `#about-modal` via `openModal` (FR-25; AD-8, AD-7, AD-3).**
**Given** the Help menu is open and the "About Beastty…" row (`index.html:1582-1584`, now given `id="menu-about-item"` + `data-action="about"`)
**When** the user activates it (click or Enter)
**Then** it takes the shared modal-opener action path (`menu-bar.js:960-976`): `closeMenu()` runs first (dropdown closes; `window.__menuBar.getOpenMenu() === null`), then the injected `openAbout()` opener opens the dialog via the shared `openModal` helper (`window.__modal.__getStateForTests().openDialogId === 'about-modal'`), shown with `showModal()` (top layer + native `::backdrop` + native focus trap). `menu-bar.js` opens it **only** through the injected `openAbout` opt — it must NOT import `modal.js` (AD-3).

**AC-2 — The modal shows all four required content blocks, single-sourced (FR-25; UX-DR10).**
**Given** the modal is open
**When** it renders
**Then** the body contains, at minimum:
- **Build SHA** — renders `window.__buildInfo.sha` EXACTLY (the same value `#status-build` shows via `status-bar.js:181`; assert against `window.__buildInfo.sha` read in-page, never a hard-coded SHA — the stamp is gitignored/regenerated per build). On the unbuilt fallback (`{sha: 'unknown (unbuilt)', builtAt: null}`) it shows `unknown (unbuilt)` and does not throw.
- **builtAt** — renders `window.__buildInfo.builtAt` when present; when `null` (unbuilt) the Built row is gracefully absent or shows `—` (no literal "null"/"undefined").
- **Privacy line VERBATIM** — the exact string `No telemetry. No data leaves your browser.` (byte-identical to `transport/serial.js:129`).
- **Source link** — the literal text `TBD` (placeholder; not a live URL, not a dead `href`).
- **Chromium-requirement note** — text stating Beastty requires a Chromium-based browser (Web Serial is Chromium-only).

**AC-3 — Non-destructive info modal: Close + Esc semantics and focus round-trip (AD-8 returnValue policy #4; NFR-1/AD-10).**
**Given** the modal is open
**Then** `initialFocus` is the Close button — it carries `data-focused="true"` and is `document.activeElement` on open (policy #4: no destructive default to guard, so Close is the compliant safe default). Closing via the footer `<form method="dialog">` submit **and** via Esc both hide the dialog and resolve `'close'`/`''`; the opener ignores the `returnValue` (nothing to apply). On close, `restoreTo` returns focus to `#terminal-wrapper` (`document.activeElement.id === 'terminal-wrapper'`), so keystrokes resume flowing to the canvas.

**AC-4 — Clean-modal aesthetic on neutral `--chrome-*` tokens (AD-9; DESIGN.md; [[clean-modal-aesthetic]]).**
**Given** the modal is open
**Then** it uses the **clean aligned-row look** (build/built as label-left/value-right aligned rows — the `.chrome-modal` aligned-row family from the mock, NOT a transplanted verbose panel; prose lines for privacy/source/Chromium), reuses the shared `.chrome-modal` chrome (`index.html:956-1010`), consumes **only** `var(--chrome-*)` tokens — no phosphor vars, no `[data-theme="crt"]` branch (chrome stays visually identical across CRT↔Console), has **no `box-shadow`** (the `::backdrop` scrim is the sole elevation — UX-DR5), and an 8px (`rounded/lg`) corner. Matches `#keyboard-shortcuts-modal`/`#reserved-ctrl-modal`/`#serial-config-modal`.

**AC-5 — Cross-cutting invariants + suite stays green (NFR-1/AD-10; AD-3; AD-12; FR-6/NFR-3).**
The About row retains terminal focus on click (`retainFocus` is already applied to every `.menu-item` by `wireDropdownItems` — do NOT re-add it). `menu-bar.js` gains **no new import** (the opener arrives only as a `wireMenuBar` opt). No new dependency, no build step (AD-1). `window.__menuBar` + `window.__modal` test hooks are extended-not-broken. Boot order preserved (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. The full Playwright chromium suite passes, plus a new `tests/render/about-modal.spec.js` (cloned from `keyboard-shortcuts-modal.spec.js`) covering: open-from-menu + dropdown-closes + `openDialogId`, initial-focus-on-Close, Close→focus-restore, Esc→focus-restore, the four content blocks (build SHA single-sourced against `window.__buildInfo.sha`, verbatim privacy line, literal `TBD`, Chromium note), no-box-shadow, and 8px corner. **This is the FINAL E6 story — after it lands, all E6 development_status rows read `done`; the epic-e6 retrospective is `optional`.**

## Tasks / Subtasks

- [x] **Task 1 — Add the `#about-modal` `<dialog>` markup (AC-2, AC-3, AC-4).**
  - [x] `www/index.html` — add `<dialog id="about-modal" class="chrome-modal" aria-labelledby="about-modal-title">` immediately after `#keyboard-shortcuts-modal` (`index.html:1997-2028`), cloning its header + `<footer><form method="dialog"><button id="about-close" value="close">Close</button></form></footer>` shape verbatim.
  - [x] Header `<h2 id="about-modal-title">About Beastty</h2>`.
  - [x] Body — the four content blocks:
    - Two aligned rows (label left / value right, mirroring `.shortcut-row`) with **id'd value spans** for the dynamic push: `<span id="about-build-sha">…</span>` and `<span id="about-built-at">…</span>`. Leave the value spans empty (or a neutral placeholder) in static HTML — `onOpen` fills them (Task 3). Label the SHA row "Build" and the timestamp row "Built".
    - A `<p class="hint">` with the **verbatim** privacy string `No telemetry. No data leaves your browser.` (copy byte-for-byte from `transport/serial.js:129`).
    - A source row: label "Source" + value `TBD` (literal text; not an `<a href>` — Ant sets the URL later). A markup comment marks where the real link goes.
    - A `<p class="hint">` Chromium-requirement note (mirror the polite-fail wording, `transport/serial.js:124-125`).
    - A markup comment cites the SSOTs: `window.__buildInfo` (fed by `main.js:499-511`, same object as `#status-build`), the privacy string SSOT (`transport/serial.js:129`), and FR-25/UX-DR10.
- [x] **Task 2 — Wire the pre-stubbed Help row (AC-1).**
  - [x] `www/index.html` — the "About Beastty…" `menu-item` (`index.html:1582-1584`) gains `id="menu-about-item"` + `data-action="about"`; **remove** the `<span class="caret">▸ modal</span>` (a `…` action row has no ▸ caret — that glyph is reserved for radio submenus; mirror what E6.1 did to the Keyboard Shortcuts row). Keep `data-variant="action"`, the `…`, and the empty `.check` span.
- [x] **Task 3 — Add the opener + injection in `main.js` (AC-1, AC-2, AC-3).**
  - [x] `www/main.js` — beside `openKeyboardShortcuts` (`main.js:256-258`): `const aboutModalEl = document.getElementById('about-modal');` and `const openAbout = makeModalOpener(aboutModalEl, 'about-close', projectAboutBuild);` — the **third arg** `onOpen` is the new wrinkle (mirrors `openSlideConfig`, `main.js:263-264`).
  - [x] Define `projectAboutBuild()` (a small `main.js`-local sink, next to the opener): read `window.__buildInfo` (fall back to `{sha: 'unknown (unbuilt)', builtAt: null}` if it hasn't resolved yet), then write `#about-build-sha`.textContent = the sha and project `#about-built-at` from `builtAt` (empty/`—`/hidden when null). Null-guard every `getElementById` (harness has no markup — never throw). This is the SINGLE writer of the modal's dynamic fields; it single-sources from the same `window.__buildInfo` the status bar reads, so About and the bar never disagree.
  - [x] Inject `openAbout,` into the `wireMenuBar({…})` opts block, beside `openKeyboardShortcuts` (`main.js:452`).
- [x] **Task 4 — Add the menu-bar plumbing (AC-1, AC-5).**
  - [x] `www/renderer/menu-bar.js` — add `let openAboutRef = null;` (beside `openKeyboardShortcutsRef`, `:195`); `openAboutRef = opts.openAbout || null;` in the opts intake (beside `:350`); and `'about': openAboutRef,` to the action→opener table (`:966-971`). **No import added** (AD-3).
- [x] **Task 5 — Style the modal (AC-4).**
  - [x] `www/index.html` `<style>` — add `#about-modal[open] { max-width: … }` beside the `#keyboard-shortcuts-modal[open]` block (`:1199-1243`). Reuse the `.shortcut-row` aligned-row family for the build/built rows if it fits, OR add a minimal `#about-modal .about-row` mirroring it (label left / value right, `space-between`). All color/border/backdrop inherit from shared `.chrome-modal`. **No `box-shadow`; no phosphor vars; no `[data-theme]` branch.**
- [x] **Task 6 — Test (AC-1..AC-5).**
  - [x] `www/tests/render/about-modal.spec.js` — clone `keyboard-shortcuts-modal.spec.js`: `ready(page)` boot-race guard **extended to also wait for `window.__buildInfo`** (like `status-bar.spec.js:196` — the build push is async); `window.__menuBar.open('help')` then `page.click('#dropdown-help .menu-item[data-action="about"]')`; assert `getOpenMenu() === null`, `openDialogId === 'about-modal'`, initial focus on `#about-close` (+ `data-focused="true"`), Close-button and Esc both close + restore focus to `#terminal-wrapper`, `#about-build-sha` text === `window.__buildInfo.sha` read in-page (single-source, never hard-coded), the verbatim privacy string present, literal `TBD` present, the Chromium note present, `boxShadow === 'none'`, `borderTopLeftRadius === '8px'`.
  - [x] Run the full chromium suite (`npm test`) — expect green on the accepted `retries:1` mask.

## Dev Notes

### The one-paragraph mental model

Beastty has a shared, four-times-proven "static info modal reached from a menu" seam: (1) a `<dialog class="chrome-modal">` in `index.html`; (2) a menu row with `data-action="…"`; (3) one entry in the `menu-bar.js:966-971` action→opener table; (4) a zero-arg `openXxx()` in `main.js` that calls `openModal(dialogEl, { initialFocus, restoreTo })` and is injected into `wireMenuBar`. E6.2 does exactly this for an **About Beastty** dialog. The nearest twin is `#keyboard-shortcuts-modal` (E6.1) — also a non-destructive info modal (body copy + Close). Copy its structure. There is **no** `modal.js` change, **no** new pref/state, **no** build step. **The single deviation from a pure clone:** the build SHA + builtAt are dynamic, so `openAbout` passes an `onOpen` callback (`makeModalOpener`'s third arg) that reads `window.__buildInfo` and writes the two value spans just before the dialog shows.

### The DYNAMIC build fields — the one new mechanic (read `window.__buildInfo` at open time)

`window.__buildInfo` is set in `main.js:499-511` by an async `import('./pkg/build-info.js')`:
```js
import('./pkg/build-info.js')
    .then(({ BUILD_INFO }) => { window.__buildInfo = BUILD_INFO; statusBar.setBuild(BUILD_INFO); })
    .catch(() => { const fallback = { sha: 'unknown (unbuilt)', builtAt: null };
                   window.__buildInfo = fallback; statusBar.setBuild(fallback); });
```
- Shape: `{ sha: string, builtAt: string | null }`. `pkg/build-info.js` is emitted by `scripts/build.sh` into `pkg/` (**gitignored, regenerated per build**) — a raw `wasm-pack` build (per `www/README.md`) skips it, so the `.catch` fallback `{sha: 'unknown (unbuilt)', builtAt: null}` is the path most test runs and dev servers take. **Your `onOpen` and your test must both handle the fallback.**
- **Single-source it.** The status bar renders `build ${info.sha}` and puts `built ${info.builtAt}` on the element title (`status-bar.js:179-183`). The About modal reads the SAME `window.__buildInfo` so the two surfaces can never drift — FR-25 and PRD `:464` require "the same SHA shown in Help ▸ About." Do NOT re-import `build-info.js` into the modal path and do NOT snapshot at boot — read `window.__buildInfo` fresh in `onOpen`.
- **Why `onOpen`, not boot projection:** the import resolves a microtask/two after boot; the modal is opened at use-time (well after that). `onOpen` (the `makeModalOpener` third arg, `main.js:240-249` — "runs just before showModal for the modals that need a pre-open sync") is the exact seam `openSlideConfig` already uses for its use-time validity re-projection. Follow that precedent.

### The four content blocks — exact copy + SSOTs

| Block | Content | SSOT |
|---|---|---|
| Build SHA | `window.__buildInfo.sha` (e.g. a short git SHA; or `unknown (unbuilt)`) | `main.js:499-511`; matches `#status-build` (`status-bar.js:181`) |
| builtAt | `window.__buildInfo.builtAt` (ISO-ish timestamp; `null` when unbuilt → `—`/hidden) | same object |
| Privacy line | **verbatim:** `No telemetry. No data leaves your browser.` | `transport/serial.js:129` (polite-fail page) |
| Source link | literal `TBD` (Ant sets the real URL later) | FR-25 / UX-DR10 (`prd.md:438-439`, `EXPERIENCE.md:80`) |
| Chromium note | Beastty requires a Chromium-based browser; Web Serial is a Chromium-only API | `transport/serial.js:124-125` (polite-fail wording) |

**Privacy line is byte-identical, intentional cross-surface duplication.** The polite-fail page (`serial.js:129`) rewrites `document.body.innerHTML` *before* wasm ever loads and only on non-Chromium browsers — so no shared DOM node between it and the About modal is possible (same situation as the reserved-Ctrl duplication E6.1 handled). Copy the string verbatim; keep the phrasing identical so a reader who sees both isn't confused. **Note:** `serial.js:129` currently appends `Source: github.com/{TBD-during-Phase-6}` to the same line — the About modal's source value is the FR-25-specified literal `TBD` (a cleaner placeholder), NOT that `{TBD-during-Phase-6}` string. Render `TBD`.

### Exact code sites (verified against `3dc1e93`)

**`www/index.html`:**
- `:1570-1586` — the **Help** `menu-group`: `#menu-help` + `#dropdown-help`. The **"About Beastty…" row `:1582-1584`** (`data-variant="action"`, `▸ modal` caret, empty `.check`) — add `id="menu-about-item"` + `data-action="about"`, **remove the caret**. (The "Keyboard Shortcuts…" row `:1578-1581` is the exact shape to mirror — it already has `id` + `data-action`, no caret.)
- `:1997-2028` — **`#keyboard-shortcuts-modal`** (the clone template: header + `.modal-body` + `<footer><form method="dialog"><button id="keyboard-shortcuts-close" value="close">Close</button></form></footer>`). Add `#about-modal` right after it. `:1959-1974` — `#reserved-ctrl-modal` (the simpler prose-only precedent).
- `:956-1010` — shared **`.chrome-modal`** chrome (`:966 :not([open]){display:none}`, `:969 [open]` layout, `:984 ::backdrop` scrim, `:987 header`, `:992 h2`, `:1001 .modal-body`). `:1199-1243` — the `#keyboard-shortcuts-modal[open]{max-width:64ch}` + `.shortcut-group`/`.shortcut-row` specifics block (add a sibling `#about-modal[open]` here).

**`www/main.js`:**
- `:240-249` — **`makeModalOpener(modalEl, initialFocusId, onOpen)`** — the shared factory. The `onOpen` third arg "runs just before showModal for the modals that need a pre-open sync" — this is E6.2's seam for the build projection.
- `:256-258` — `openKeyboardShortcuts` (clone this exactly for the static parts). `:263-264` — `openSlideConfig = makeModalOpener(slideConfigModalEl, 'slide-recv-to-folder-checkbox', () => syncAutoSendValidity(…))` — **the precedent for passing an `onOpen`**. `terminalWrapper` is already in scope (used by every opener).
- `:499-511` — the `window.__buildInfo` import/fallback block (the source your `projectAboutBuild` reads). Do NOT touch it; just read the global it sets.
- `:368-462` — the `wireMenuBar({…})` opts block; `:452` `openKeyboardShortcuts` is the sibling to add `openAbout` beside. `:463`+ `wireChrome` runs AFTER `wireMenuBar`, BEFORE `wireKeyboard` (AD-12 — don't disturb).

**`www/renderer/menu-bar.js`:**
- `:57`-ish `MENUS` includes `'help'` (the discovery loop already wires `#menu-help`/`#dropdown-help`).
- `:195` `openKeyboardShortcutsRef = null` (add `openAboutRef` beside). `:350` opts intake (`openKeyboardShortcutsRef = opts.openKeyboardShortcuts || null;`). `:966-971` the **action→opener table** — add `'about': openAboutRef`. `:972-976` the shared dispatch (`closeMenu(); modalOpener?.();`).
- **AD-3 import guard:** `menu-bar.js` must NOT import `modal.js` — the opener comes via opts only.

**`www/renderer/status-bar.js`:**
- `:179-183` `setBuild(info)` renders `build ${info?.sha ?? 'unknown (unbuilt)'}` and `title = built ${info.builtAt}`. Read this to match About's rendering to the bar (single source). Do NOT import status-bar into the modal path — both read `window.__buildInfo` independently.

**`www/transport/serial.js`:**
- `:121-129` `renderPoliteFail()` — the SSOT for both the verbatim privacy line (`:129`) and the Chromium-requirement wording (`:124-125`). Copy the strings; do NOT share the function (it's a full-body takeover that runs pre-wasm).

**`www/renderer/modal.js`:** unchanged. Contract: `openModal(dialogEl, { initialFocus, restoreTo }) → Promise<returnValue>`; `showModal()` gives the top layer + native `::backdrop` + native focus trap (do NOT hand-roll a trap); `returnValue` reset to `''` before every open so Esc/backdrop resolves `''`; surfaced as `window.__modal` (`__getStateForTests().openDialogId`).

### What must be preserved (non-negotiable — AD-3 / AD-8 / AD-9 / AD-12 / FR-6)

- **`menu-bar.js` adds no import** — `openAbout` is injected via `wireMenuBar` opts (AD-3). The opener lives in `main.js` (which owns `openModal` + reads `window.__buildInfo`).
- **Info-modal contract** — `initialFocus` = Close, `restoreTo` = `terminalWrapper`, caller ignores `returnValue` (AD-8 policy #4). Esc/backdrop resolve `''`; do not add an affirmative branch.
- **Single-source the build stamp** — read `window.__buildInfo`; match `#status-build`; never re-import `build-info.js` into the modal, never hard-code a SHA. FR-25 / PRD `:464` require About's SHA == the bar's SHA.
- **Privacy line verbatim** — byte-identical to `serial.js:129`. Source value is the literal `TBD` (FR-25).
- **Neutral chrome only** — `var(--chrome-*)`, no phosphor vars, no `[data-theme]` branch, no `box-shadow` (AD-9, UX-DR5). Reuse `.chrome-modal`; don't fork its chrome.
- **Boot order** (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. No build step; no new dependency.

### Reuse — do NOT reinvent

- **The modal seam is done (E2.3/E3.3/E3.4/E6.1).** Clone `#keyboard-shortcuts-modal` + `openKeyboardShortcuts` + the E6.1 action-row + the one map entry. The `menu-bar.js:963` comment literally anticipates E6.2 ("a new modal (e.g. Help ▸ About/E6.2) is one entry").
- **The `onOpen` projection pattern is done (E3.4).** `openSlideConfig` (`main.js:263-264`) already passes a use-time `onOpen` to `makeModalOpener` — copy that shape; your callback reads `window.__buildInfo` instead of prefs.
- **The build stamp is done (E4.2).** `window.__buildInfo` + `status-bar.js:setBuild` already single-source the SHA. Read the global; do not rebuild the plumbing.
- **The test is done (E6.1).** `keyboard-shortcuts-modal.spec.js` is the near-exact clone for `about-modal.spec.js` — same `ready()` guard, same menu-open-then-click, same focus/Esc/no-shadow/8px assertions. Extend `ready()` to also await `window.__buildInfo` (idiom from `status-bar.spec.js:196`); swap ids and content assertions.
- **The `.chrome-modal` + `.shortcut-row` styling is done.** Only a `max-width` + (optionally) an `.about-row` alias are modal-specific.

### Testing standards + codified idioms (re-embedded per E5.1 Q3 — intentionally per-story)

- **Boot-race guard first, extended for the async build push:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function' && typeof window.__modal === 'object' && window.__modal !== null && window.__buildInfo && typeof window.__buildInfo.sha === 'string')`. (The `window.__buildInfo` clause is the E6.2-specific addition — mirrors `status-bar.spec.js:196`.)
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('help'))` — never a title `.click()`.
- **Activate the row:** `await page.click('#dropdown-help .menu-item[data-action="about"]')`.
- **Dropdown-closed assertion:** `window.__menuBar.getOpenMenu() === null` after activation (action semantics).
- **Modal-opened assertion:** `window.__modal.__getStateForTests().openDialogId === 'about-modal'` and `expect(page.locator('#about-modal')).toBeVisible()`.
- **Focus:** `document.activeElement.id === 'about-close'` on open (+ `data-focused="true"`); `=== 'terminal-wrapper'` after Close **and** after Esc.
- **Build single-source (the E6.2-specific assertion):** `const sha = await page.evaluate(() => window.__buildInfo.sha); await expect(page.locator('#about-build-sha')).toHaveText(sha);` — read the SHA in-page; NEVER hard-code it (gitignored/regenerated). This proves About == the bar. (In CI/dev without `pkg/build-info.js`, `sha === 'unknown (unbuilt)'` — the assertion still holds against the fallback.)
- **Content:** assert `.modal-body` contains the verbatim `No telemetry. No data leaves your browser.`, the literal `TBD`, and the Chromium note string.
- **Aesthetic:** `getComputedStyle(dialog).boxShadow === 'none'`; `borderTopLeftRadius === '8px'`.
- **Projects/run:** render specs → `chromium` project; the flake mask is `chromium-transport` `fullyParallel:false` `retries:1`. `npm test` / `npm run test:fast` (`@fast`). No per-story `--workers=1`.

### Project Structure Notes

- **No new runtime module.** Edits: `index.html` (dialog markup + row `id`/`data-action` + CSS), `main.js` (opener + `projectAboutBuild` sink + injection), `menu-bar.js` (ref + opts + map entry), one new spec. Matches the E6.1 footprint plus the small `projectAboutBuild` sink.
- **New ids** kebab-case + feature-prefixed: `#about-modal`, `#about-modal-title`, `#about-close`, `#about-build-sha`, `#about-built-at`, `#menu-about-item` (mirroring `#keyboard-shortcuts-modal` / `-title` / `-close`). Named exports only; no default exports; no new deps; no build step (AD-1).
- **E7 note:** this is a NEW menu/modal surface (no legacy pane to retire), so it does not touch the E7 dual-chrome retirement checklist. (Build info's legacy home — the old Debug pane `#build-sha` — was already relocated to `#status-build` in E4.2; About is its OTHER home, not a relocation.)
- **Epic close-out:** E6.2 is the last E6 story. After it's `done`, run `epic-e6-retrospective` only if desired (`optional`). Per [[mark-story-done-all-places]], mark done in sprint-status.yaml AND the story front-matter + `last_updated`.

### References

- [Source: `epics.md` §Story E6.2 + §Epic E6] — user story + the single epic AC (FR-25; build SHA + builtAt, verbatim privacy line, `TBD` source, Chromium note); Epic E6 depends on E0, E1 (NOT E5).
- [Source: `prds/prd-beastty-2026-07-01/prd.md:433-439` (§FR-25) + `:464` (SHA matches Help ▸ About) + `:614` (source link `TBD` open question)] — the About modal spec: build SHA + builtAt, "No telemetry. No data leaves your browser." verbatim from the polite-fail line, literal `TBD` source, Chromium note.
- [Source: `ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md:73` (build info lives in Help ▸ About, not Debug) + `:80` (About row spec — verbatim privacy line, `TBD` source, Chromium note) + `:117` (privacy line reused from polite-fail)] — UX-DR10; content SSOT for the About row.
- [Source: `ux-designs/ux-beastty-2026-07-01/DESIGN.md:192`] — modal dialog on `chrome-bg`, 1px `chrome-border`, `rounded/lg`, monospace, header/body/footer; About Beastty listed as a hosted modal.
- [Source: `ux-designs/.../mockups/key-screen-chrome.html` (aligned `.field` rows + ⓘ tooltips)] — the clean-modal aesthetic target ([[clean-modal-aesthetic]]).
- [Source: `architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md` — AD-8 (`:105-108`), AD-9, AD-3 (import allowlist), AD-12 (boot order); `:206` "Keyboard Shortcuts + About modals — `<dialog>` + `openModal`"] — one shared `openModal` helper; chrome uses only `--chrome-*` tokens.
- [Source: `www/renderer/modal.js`] — the pinned `openModal` contract + returnValue policy (#4: non-destructive default-focus safe choice); `showModal()` native trap/backdrop; `window.__modal` test hook.
- [Source: `www/main.js:240-249` (`makeModalOpener` incl. the `onOpen` third arg), `:256-258` (`openKeyboardShortcuts` — clone), `:263-264` (`openSlideConfig` — the `onOpen` precedent), `:499-511` (`window.__buildInfo` import/fallback — the build source), `:368-462` (`wireMenuBar` opts; `:452` `openKeyboardShortcuts`)].
- [Source: `www/renderer/menu-bar.js:195, 350, 966-976`] — `openKeyboardShortcutsRef`; opts intake; the **action→opener table** (add `'about'`) + shared `closeMenu(); modalOpener?.()` dispatch. AD-3: no `modal.js` import.
- [Source: `www/renderer/status-bar.js:179-183`] — `setBuild(info)` renders `build ${info.sha}` + `built ${info.builtAt}` title; the single-source About must match.
- [Source: `www/transport/serial.js:121-129`] — `renderPoliteFail()`: the SSOT for the verbatim privacy line (`:129`) and the Chromium-requirement wording (`:124-125`).
- [Source: `www/index.html:1570-1586` (Help menu + About stub), `:1997-2028` (`#keyboard-shortcuts-modal` clone template), `:956-1010` (`.chrome-modal` shared chrome), `:1199-1243` (`#keyboard-shortcuts-modal[open]` + `.shortcut-row` specifics)].
- [Source: `www/tests/render/keyboard-shortcuts-modal.spec.js`] — the spec to clone. [Source: `www/tests/render/status-bar.spec.js:190-215`] — the `window.__buildInfo` await + single-source SHA assertion idiom (E4.2).
- [Source: `_bmad-output/.../e6-1-keyboard-shortcuts-modal.md`] — the immediate precedent story (same seam). [Source: `epic-e5-retro-2026-07-04.md:117-129`] — E6 prep note (About is pre-wired via `window.__buildInfo`; verbatim privacy line + `TBD` source + Chromium note; clean-modal aesthetic).

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **builtAt display + null handling.** **Recommended default:** show two aligned rows — "Build" → `sha`, "Built" → `builtAt` — and when `builtAt` is `null` (unbuilt / no `pkg/build-info.js`), render the Built value as `—` (em dash) rather than hiding the row, so the layout is stable. The SHA row always shows (`unknown (unbuilt)` on the fallback). **Alternative:** omit the Built row entirely when `null`. Recommend the `—` — it's calmer and testable.
2. **Source link markup.** **Recommended default:** render "Source" → literal text `TBD` (a plain `<span>`, NOT an `<a>`), with a markup comment `<!-- E6.2: replace TBD with <a href="…"> when Ant sets the repo URL -->`. FR-25/UX-DR10 say "literal `TBD` placeholder until set" — a dead `<a href="TBD">` would be worse than plain text. **Alternative:** a disabled-looking `<a>` with no href. Recommend plain text.
3. **ⓘ tooltips (clean-modal aesthetic mentions "aligned rows + ⓘ tooltips").** **Recommended default:** NO ⓘ tooltips — About's content is self-explanatory prose + two labelled rows; the `.field-info` ⓘ pattern (`index.html:1923`) exists for terse form controls that need expansion, which About has none of. Aligned rows satisfy the aesthetic. **Alternative:** add a ⓘ on "Build" explaining "matches the status-bar build readout." Recommend none — don't manufacture a tooltip.
4. **Modal width.** **Recommended default:** `#about-modal[open] { max-width: 56ch }` — About is shorter/narrower than the shortcut table (64ch); a couple of rows + three short lines. Widen only if the Chromium note wraps awkwardly. **Alternative:** match 64ch. Recommend 56ch.
5. **Chromium note wording.** **Recommended default:** one line, e.g. "Requires a Chromium-based browser (Web Serial is a Chromium-only API)." — echoes `serial.js:124-125` without transcribing the whole polite-fail page. **Alternative:** the full two-sentence polite-fail copy. Recommend the one-liner — the full page only shows on unsupported browsers; here it's a footnote.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (dev-story workflow).

### Debug Log References

- `npx playwright test --project=chromium tests/render/about-modal.spec.js` → 9 passed.
- `npx playwright test --project=chromium` (full suite) → 345 passed, 1 skipped, 0 failed (8 flaky = failed-once-then-passed on the accepted `retries:1` mask; no hard failures).

### Completion Notes List

- **Pure clone of the E6.1 seam + one dynamic wrinkle.** Added `<dialog id="about-modal" class="chrome-modal">` immediately after `#keyboard-shortcuts-modal`, wired the pre-stubbed Help ▸ About Beastty… row (`data-action="about"`, caret removed), added `openAbout` + one `menu-bar.js` map entry. No `modal.js` change, no new pref/state, no build step, no new dependency, no new import in `menu-bar.js` (AD-3 held).
- **Dynamic build fields via `onOpen` (the deviation).** `openAbout = makeModalOpener(aboutModalEl, 'about-close', projectAboutBuild)` — the 3rd-arg `onOpen` mirrors `openSlideConfig`. `projectAboutBuild()` reads `window.__buildInfo` fresh at open time (fallback `{sha:'unknown (unbuilt)', builtAt:null}`), writes `#about-build-sha` and `#about-built-at` (`—` when `builtAt` null). Single-sourced with `#status-build` — both read the same `window.__buildInfo`, so About and the bar can never drift. Every `getElementById` null-guarded (no-markup harness never throws).
- **Four content blocks, single-sourced (AC-2).** Build SHA + builtAt (dynamic), privacy line `No telemetry. No data leaves your browser.` byte-identical to `transport/serial.js:129`, literal `TBD` source (plain `<span>`, not an `<a>`; markup comment marks where the real URL goes), one-line Chromium note echoing the polite-fail framing.
- **Info-modal contract (AC-3).** `initialFocus` = Close (`data-focused="true"` + `document.activeElement` on open); Close-submit and Esc both close and `restoreTo` `#terminal-wrapper`; opener ignores `returnValue` (AD-8 policy #4).
- **Clean-modal aesthetic (AC-4).** New `#about-modal[open]{max-width:56ch}` + `.about-row` aligned label-left/value-right rows (mirrors `.shortcut-row`); reuses shared `.chrome-modal` + `.hint`; only `var(--chrome-*)` tokens, no phosphor vars, no `[data-theme]` branch, no `box-shadow`, 8px corner.
- **Flagged questions resolved to the recommended defaults:** (1) `—` for null builtAt (stable layout), (2) plain-text `TBD` (no dead href), (3) no ⓘ tooltips, (4) 56ch width, (5) one-line Chromium note.
- **New spec** `tests/render/about-modal.spec.js` cloned from `keyboard-shortcuts-modal.spec.js`, `ready()` extended to await `window.__buildInfo` (async build push idiom). Build SHA asserted against `window.__buildInfo.sha` read in-page (never hard-coded). AC-5 verified: suite green.

### File List

- `www/index.html` — added `#about-modal` `<dialog>` markup; gave the About row `id="menu-about-item"` + `data-action="about"` and removed the `▸ modal` caret; added `#about-modal[open]` + `.about-row` CSS.
- `www/main.js` — added `aboutModalEl`, `projectAboutBuild()` sink, `openAbout` opener; injected `openAbout` into `wireMenuBar` opts.
- `www/renderer/menu-bar.js` — added `openAboutRef`, its opts intake, and the `'about'` entry in the action→opener table (no new import).
- `www/tests/render/about-modal.spec.js` — new spec (9 tests, AC-1..AC-5).

### Change Log

| Date | Change |
|---|---|
| 2026-07-04 | Story created (create-story workflow) — Status → ready-for-dev. |
| 2026-07-04 | Implemented About Beastty modal (dev-story): `#about-modal` `<dialog>` cloned from E6.1, `data-action="about"` Help row, `openAbout` + `projectAboutBuild` dynamic build projection in `main.js`, `menu-bar.js` map entry, `#about-modal`/`.about-row` CSS, new `about-modal.spec.js` (9 tests). Full chromium suite green (345 passed / 0 failed). Status → review. |

### Code Review

`code-review` (high effort — 3 correctness + 3 cleanup + altitude + conventions angles across 8 finder agents + 1-vote recall-biased verify) run 2026-07-04 over the whole `ui-rethink` working tree (the E6.2 About modal plus the E3/E4/E6 surfaces it sits on). Fixes committed in `7bfc733`; this commit records the outcome + flips status.

**E6.2's own code: 0 correctness findings.** `#about-modal` is a clean clone of `#keyboard-shortcuts-modal` on the shared `.chrome-modal` rails; `projectAboutBuild` reads the single-sourced `window.__buildInfo` (AD-3/AD-8/AD-9 hold). Conventions angle clean (no Rust/JS split violation).

**8 findings → fixed in `7bfc733`:**
1. `serial.js` (correctness) — the recent-errors ring was never cleared, so the amber "▲ N recent errors" status-bar cue was monotonic and stayed lit the whole session after a transient error had resolved. Now cleared on a successful Connect (mirrors the per-Connect session-log reset).
2. `input/file-source.js` (correctness) — the send-file gate had no synchronous init (200 ms poll only) and shipped enabled, so a boot-window click (top-bar or File ▸ Send File…) could fire the picker with no writer. Button now ships `disabled`; `wireFileSource` runs one synchronous `updateButtonState`.
3. `main.js` (correctness) — `chooseMicroBeast` fired `connectMicroBeast()` as an un-caught floating promise; restored the `.catch(()=>{})` guard the refactor dropped (a throw before its internal `try` — e.g. a `setState('connecting')` observer — surfaces as unhandledrejection + aborts the board switch). NB: E6.1 refuted this on the `await disconnect()` path; the reachable case is the pre-`try` observer.
4. `status-bar.js` (correctness) — pre-paint used raw `getPrefs().fontZoom` (`?? 1` lets a stored `0` through → "zoom 0×"); now clamped to [1,4]. E6.1 accepted this as cosmetic; fixed properly this pass.
5. `status-bar.js` (cleanup) — deleted the dead `setConnectionInfo()` method (no caller).
6. `prefs.js`/`main.js`/`status-bar.js` (cleanup) — single-sourced the `"unknown (unbuilt)"` build stamp as `BUILD_UNKNOWN_SHA` across the three readers.
7. `index.html` (cleanup) — shared `.conn-dot` class so `#menu-conn-dot` + `#status-conn-dot` can't drift on the state→colour map.
8. **#7 shortcut registry (altitude — the item E6.1 accepted as static HTML):** new `input/shortcuts.js` is the single source for the chord predicates AND the modal display. `chrome.js` (theme/zoom) + `keyboard.js` (copy/paste) match via its predicates; `main.js` renders the modal body from the same groups; `shortcuts-registry.spec.js` pins each label to its predicate. The Help modal can no longer misinform on a chord rebind.

**Surfaced → dropped in verify / not fixed (with reason):**
- Python guard regex over-capture (`check-story-done-consistency.py`) — refuted: `### Code Review` is always followed by a `### ` sibling (File List / Change Log) or EOF, so the `(?=^###\s|\Z)` lookahead can't over-capture given the template shape.
- Stale `lastConnectError` masking the boot cue — refuted: the error/boot-cue precedence is intentional + documented, and the value is cleared at the start of the next connect attempt.
- #6 duplicated `projectConnection` — addressed in substance by the shared `.conn-dot` map (#7 sibling) + the already-shared `CONN_STATUS_LABELS`; the two projector bodies now differ only in genuinely per-surface DOM writes, so a shared factory would add indirection for negative clarity.
- #10 checkable-pref knowledge split across 3 registries — **deferred**: merging it would violate AD-3 (menu-bar.js may not import the live setters it receives injected). Left as-is; the tables are already table-driven.

Suite after fixes: full chromium suite green — **355 passed / 1 skipped / 0 failed**.
