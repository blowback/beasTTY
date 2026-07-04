---
baseline_commit: c3663a45fba6e8e856ae31887507465a09bd3a69
---

# Story E1.1: Menu bar shell + dropdown mechanics

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want a classic desktop-style menu bar with working dropdowns rendered at the top of the app,
so that the controls start moving to where a desktop-app user expects them and the page begins to feel less cluttered — without losing any existing functionality mid-migration.

**Covers:** FR-1, FR-2, FR-5; NFR-2, NFR-5, NFR-6; UX-DR1, UX-DR4, UX-DR5, UX-DR6, UX-DR7, UX-DR8, UX-DR9.
**Depends on:** E0 (`retainFocus`, `openModal` — only `retainFocus` is used here).

## ⚠️ Scope Decision — READ FIRST (coexist, do NOT delete `#top-bar`/`<details>` yet)

The epic's original E1.1 acceptance criteria included *"`#top-bar` and the three `<details>` panes are absent from the DOM."* **That clause is deliberately deferred** (decision by Ant, project lead, 2026-07-01).

**Why:** the three `<details>` panes host controls owned by *later* stories/epics — `#connection` → **E2**, `#settings` → **E3**, `#debug` → **E5**. Only View-menu functions (theme/phosphor/font/zoom/clear) migrate within E1 (E1.3–E1.5). Deleting the panes now would strip connect / serial-config / settings / debug from the running app and break ~40 Playwright specs — violating the non-negotiable rule that *a story must leave the system working end-to-end*.

**This story therefore ships the menu-bar SHELL alongside the incumbent `#top-bar` + `<details>` panes.** Each old surface is removed by the story that migrates its function (View → E1.3–E1.5; Connection → E2; Settings → E3; Debug → E5), with final orphan cleanup when the last consumer moves. E1.1 renders the six-menu bar, dropdown mechanics, the four menu-item **variant renderings** (structural placeholders — real wiring lands in later stories), and the right-aligned connection-status **placeholder** dot+label.

## Acceptance Criteria

1. **Menu-bar shell renders (FR-1).**
   **Given** a new `renderer/menu-bar.js` wired at the `wireChrome` seam (before `wireKeyboard`)
   **When** the app loads for a Chromium user
   **Then** a sticky **~32px** bar shows **File · Connection · View · Settings · Debug · Help** left-to-right, with a **right-aligned connection status dot + label placeholder** (gray dot, "Not connected").
   **And** the incumbent `#top-bar` and the three `<details>` panes remain present and fully functional (coexist — see Scope Decision; their removal is deferred to the migrating stories, and is NOT asserted here).

2. **Dropdown open / move / click-away mechanics (FR-2).**
   **Given** the menu bar is rendered
   **When** the user clicks a title, then a second title, then clicks away
   **Then** the first click opens that dropdown, the second **moves** the open menu to the new title, and the click-away closes it — expressed **only** via `data-*` / `[hidden]`, **never inline styles**.
   **And** a checkable item, when clicked, keeps its menu **open** (menu closes only on an action item, Esc, or click-away).

3. **Four menu-item variants render per DESIGN.md (FR-5).**
   **Given** the four menu-item variants (action, checkable, radio submenu, disabled) rendered as placeholders in the dropdowns
   **When** each is rendered
   **Then** it matches DESIGN.md: **action** row highlights with a **solid `chrome-accent` fill + `chrome-bg` text** on hover/focus; **with-shortcut-hint** shows the label left and a `chrome-muted` shortcut right; **checkable** shows a leading check glyph when on; **radio submenu** uses `▸`; **disabled** is `chrome-muted`, has **no hover fill**, and carries a `title` tooltip.
   **And** every interactive control registers `retainFocus` (E0.1), the highlight is driven by **`[data-focused="true"]`** (NOT `:focus-visible`), and **only `var(--chrome-*)` / `var(--status-*)` tokens** are used.

4. **No regression — the shell adds a surface, removes nothing (NFR-3 spirit).**
   **Given** the menu bar coexists with the incumbent chrome
   **When** the app runs and the full Playwright suite executes
   **Then** every incumbent behavior still fires (theme toggle, connect, serial config, clear, font, phosphor, auto-connect, reset, debug panel) and the suite stays green — judged by the named oracles in isolation (`--workers=1`) where the pre-existing parallel-load flake interferes.

5. **Neutral, non-adaptive shell (NFR-2; UX-DR1/2/4/5/6).**
   **Given** the new chrome CSS
   **When** the terminal theme toggles Console ↔ CRT
   **Then** the menu bar and dropdowns render **identically** — no `[data-theme]` styling branch, no phosphor vars; depth is tone + 1px `chrome-border` hairlines only (**no drop shadows**); rounding is `md` 6px (dropdown panels) / `sm` 4px (menu-item highlight); type is the monospace stack (titles 14px, labels 13px/500, hints 12px `chrome-muted`).

6. **Testability + Esc non-interference (NFR-6; NFR-8 boundary).**
   **Given** AD-2 module conventions
   **When** the module is wired
   **Then** it exposes `window.__menuBar` + `__getStateForTests` (+ `__resetForTests`) and a new `tests/render/menu-bar.spec.js` covers ACs 1–3.
   **And** E1.1 registers **no `Esc` / keydown handler** (full keyboard nav + Esc-passthrough guard are E1.2) — so `keyboard.js` paste-cancel and SLIDE-cancel are unaffected by this story.

## Tasks / Subtasks

- [x] **Task 1 — Add menu-bar markup + CSS to `index.html`, coexisting with `#top-bar` (AC: 1, 3, 5)**
  - [x] 1.1 Confirm the `--chrome-*` and `--status-*` tokens already exist in `index.html` `:root` (DESIGN.md says they are reused verbatim). If any are missing, add them with the DESIGN values: `--chrome-bg:#1e242c; --chrome-fg:#e4e8ee; --chrome-accent:#7fdbca; --chrome-border:rgba(255,255,255,.08); --chrome-muted:rgba(255,255,255,.6); --field-bg:#0f1419;` and status `--status-green:#33ff66; --status-amber:#e0b030; --status-red:#e04040; --status-gray:rgba(255,255,255,.4);`.
  - [x] 1.2 Add a sticky **~32px** `#menu-bar` (before/above the incumbent `#top-bar`) with six `<button>` titles (`#menu-file … #menu-help`, feature-prefixed kebab IDs) and a right-aligned status region (`#menu-conn-dot` gray + `#menu-conn-label` "Not connected"). The status dot is the single intentional circle (border-radius 50%).
  - [x] 1.3 Add six `[hidden]` dropdown panels (`#dropdown-file … #dropdown-help`), each with placeholder `.menu-item` rows that **demonstrate all four variants** (action, with-shortcut-hint, checkable, radio-submenu `▸`, disabled) using `data-variant` / `data-checked` / `data-disabled` attributes and the mockup's child structure (`.check` / `.lbl` / `.hint` / `.caret`). These are structural placeholders — not wired to canvas setters this story.
  - [x] 1.4 Add scoped CSS in the `index.html` `<style>` using **only** `var(--chrome-*)` / `var(--status-*)`: 32px bar, 1px `chrome-border` bottom hairline, dropdown panel `border-radius:6px` (md) + 1px hairline + **no `box-shadow`**, menu-item `border-radius:4px` (sm); highlight `` .menu-item:hover, .menu-item[data-focused="true"] { background:var(--chrome-accent); color:var(--chrome-bg); } `` (solid fill — spec beats the mock's translucent fill); disabled `[data-disabled="true"]` muted + `:hover{background:none}`; monospace type roles. **No `[data-theme]` branch, no `:focus-visible`, no phosphor vars.**

- [x] **Task 2 — Create `renderer/menu-bar.js` (`wireMenuBar`) and wire it at the seam (AC: 1, 4, 6)**
  - [x] 2.1 **(RED)** Write failing `tests/render/menu-bar.spec.js`: bar shows the six titles in order + status placeholder; `window.__menuBar` and `__getStateForTests()` exist (use a `waitForFunction` guard on `window.__menuBar` to dodge the known test boot-race, per E0.1).
  - [x] 2.2 **(GREEN)** Implement `export function wireMenuBar(opts)` following the `slide-chip.js`/`scroll-state.js` template (AD-2): module-scope state, `wireMenuBar(opts)` returning an API, a private `render()` that toggles `[hidden]`/`data-*` (never inline styles), `dispose()`, `__getStateForTests`, `__resetForTests`. **Named export only.** Per AD-3 it may import `canvas.js` setters + `prefs.js` directly; everything else (here just `terminalWrapper`) arrives via `opts`.
  - [x] 2.3 Add the import + a single `wireMenuBar({ terminalWrapper })` call in `main.js` **at the `wireChrome` seam, before `wireKeyboard`** (AD-12). Expose `window.__menuBar` for tests (mirror the `window.__modal` / `window.__prefs` pattern).
  - [x] 2.4 Confirm the new spec passes.

- [x] **Task 3 — Dropdown open/move/click-away mechanics (AC: 2)**
  - [x] 3.1 **(RED)** Failing specs: click a title → its panel loses `[hidden]` and the title gets `data-open="true"`; click a second title → open menu moves (only one panel visible); click-away (document click outside the bar) → all closed; assert **no inline `style` attribute** is ever set for open/close.
  - [x] 3.2 **(GREEN)** Wire `click` on each title to toggle the open menu; track the open menu in module state + `#menu-bar[data-active-menu]`; register a document `click` (capture or bubbling) that closes when the target is outside the bar. All visual state via `[hidden]` + `data-*`.
  - [x] 3.3 Apply `retainFocus(titleButton)` to every title (buttons → `mousedown→preventDefault`, no `restoreTarget` needed) so opening a menu never steals terminal focus.
  - [x] 3.4 Checkable placeholder items toggle `data-checked` and **keep the menu open**; action placeholders close the menu. Confirm specs pass.

- [x] **Task 4 — Four menu-item variant behavior + focus highlight (AC: 3)**
  - [x] 4.1 **(RED)** Failing specs: action row shows accent highlight on `[data-focused="true"]`; checkable renders leading check only when `data-checked="true"`; radio submenu shows `▸`; disabled is muted, has `title` tooltip, and its `:hover` sets no background; confirm `retainFocus` registered on interactive rows and highlight is attribute-driven (toggle `[data-focused]` in the test, assert computed background = accent).
  - [x] 4.2 **(GREEN)** Implement variant rendering: apply `data-variant`, manage `data-checked`/`data-disabled`, set `title` on disabled rows, ensure disabled rows are inert (no toggle/close). Drive highlight purely off `[data-focused="true"]` + `:hover`.
  - [x] 4.3 Confirm specs pass.

- [x] **Task 5 — Coexistence / no-regression gate (AC: 4)**
  - [x] 5.1 Run the full Playwright chromium suite. For any failure, re-run the offending spec in isolation with `--workers=1` to separate real regressions from the pre-existing parallel-load/wasm-boot flake (E0 action item #1).
  - [x] 5.2 Verify `#top-bar` and all three `<details>` panes are still present and wired (grep confirms no deletions); the menu bar is additive only.
  - [x] 5.3 Load the app and confirm incumbent controls still work: theme toggle, phosphor, font, clear, connect, serial config, auto-connect, reset, debug panel.

- [x] **Task 6 — Compliance + Esc-safety audit (AC: 5, 6)**
  - [x] 6.1 Grep the new CSS/JS: only `var(--chrome-*)`/`var(--status-*)` colors; **no** `[data-theme]` branch, **no** `box-shadow`, **no** `:focus-visible`, **no** phosphor vars, **no** inline styles for state.
  - [x] 6.2 Confirm `__getStateForTests` / `__resetForTests` shape and `window.__menuBar`.
  - [x] 6.3 Confirm E1.1 registers **no** `keydown`/`Esc` handler (grep `menu-bar.js`); paste-cancel + SLIDE-cancel behavior is untouched (full Esc-passthrough guard is E1.2).

## Dev Notes

### Developer context — what this story is (and is NOT)

- **IS:** the menu-bar *shell* — sticky 32px bar, six titles, click-driven dropdown open/move/click-away via `data-*`/`[hidden]`, the four menu-item **variant renderings** as placeholders, a status dot+label **placeholder**, `retainFocus` on controls, `[data-focused]` highlight, `--chrome-*` tokens, test hooks + one spec.
- **IS NOT:** keyboard navigation / Esc guard (**E1.2**), `chrome.js` decomposition + boot/reset re-projection (**E1.3**), View-menu real actions Theme/Phosphor/Font/Zoom/Clear (**E1.4/E1.5**), Connection single-writer + live status dot (**E2/E4**), Settings/SLIDE/session-log (**E3**), Debug-panel toggle (**E5**), Help modals (**E6**). **Do not** delete `#top-bar` or the `<details>` panes (see Scope Decision).

### Architecture compliance (hard guardrails)

- **AD-1 / NFR-5:** plain `.js` under `renderer/`, static markup in `index.html`, added to `main.js` imports + one `wireMenuBar(opts)` call. **Named exports only, no default export.** No new dependencies, no build step (native ESM, Chromium ≥ 89). [Source: ARCHITECTURE-SPINE.md#AD-1 (:70-73); epics.md#NFR-5]
- **AD-2 / NFR-6:** follow the `scroll-state.js` / `slide-chip.js` template — module-scope state + `wireXxx(opts)` → API + private `render()` toggling `[hidden]`/`data-*` + `dispose()` + `__getStateForTests`; expose `window.__menuBar` in `main.js`. [Source: ARCHITECTURE-SPINE.md#AD-2 (:75-78)]
- **AD-3 (direct-import allowlist):** `menu-bar.js` may import **only** `renderer/canvas.js` setters and `state/prefs.js` directly. Everything else arrives via `wireMenuBar` opts. For this shell story the only opt needed is `terminalWrapper` (passed to `retainFocus` where a `<select>` restore target is ever required — titles/buttons don't need it). [Source: ARCHITECTURE-SPINE.md#AD-3 (:80-83)]
- **AD-7:** `menu-bar.js` owns the bar + every dropdown. Open/active state is `data-*`/`[hidden]` only; click-away closes; **checkable items keep the menu open**. (The Esc early-return-without-`preventDefault` guard that AD-7 also mandates is implemented in **E1.2**, not here — E1.1 simply registers no Esc handler at all.) [Source: ARCHITECTURE-SPINE.md#AD-7 (:100-103)]
- **AD-9 / NFR-2 / UX-DR1/2:** new chrome consumes **only** `var(--chrome-*)` tokens for color/border/background; must **not** read phosphor vars or branch on `[data-theme="crt"]` for styling. Renders identically across CRT↔Console. Do **not** copy the floating-chip CRT special-casing (`index.html:162-165,198-201`). [Source: ARCHITECTURE-SPINE.md#AD-9 (:110-114)]
- **AD-12 / NFR-8:** wire `menu-bar` where `wireChrome` is today (the seam, ~`main.js:238`; architecture cites `main.js:223`), **before `wireKeyboard`** (`main.js:438`), so the terminal keydown listener's `defaultPrevented` short-circuit still wins on chords. Polite-fail gate stays first. [Source: ARCHITECTURE-SPINE.md#AD-12 (:126-129)]
- **AD-10 / NFR-1 / UX-DR9 ("Sacred"):** every new interactive control keeps terminal focus via `retainFocus` — buttons get `mousedown→preventDefault`. [Source: ARCHITECTURE-SPINE.md#AD-10 (:116-119)]
- **Boundary:** `menu-bar.js` is pure chrome/DOM projection — **no business logic**, no independent truth (Rust/wasm owns terminal logic; JS modules own their state; the menu bar subscribes/relocates, never duplicates). For E1.1 the items are placeholders, so no setters are called yet. [Source: ARCHITECTURE-SPINE.md#Scope (:7,29); AD-5 (:90-93)]

### Reuse — do NOT reinvent

- **`retainFocus(el, restoreTarget?)`** — `www/renderer/focus.js:37` (E0.1). Idempotent (WeakSet). Button/checkbox/radio → attaches `mousedown→preventDefault` (no `restoreTarget`). `<select>` → **requires** `restoreTarget` or it **throws `TypeError`** (`focus.js:47-49`) and restores focus on `change`. Usage precedent: `chrome.js:152` `retainFocus(themeButton)`; `chrome.js:305` `retainFocus(fontSelect, terminalWrapper)`.
- **`--chrome-*` / `--status-*` tokens** already in `index.html` `:root` (DESIGN.md:118 — "reuse the existing `:root` tokens; do not introduce a new palette"). Verify before adding.
- **Module template:** copy the shape of `renderer/slide-chip.js` / `renderer/scroll-state.js` (module-scope state, `wireXxx`, `render()`, `__getStateForTests`, `__resetForTests`).
- **`openModal` (E0.2, `modal.js:45`)** — NOT needed in E1.1 (no modals here); listed only so you don't re-solve modal opening in a later menu story.

### File structure requirements

- **NEW:** `www/renderer/menu-bar.js` (named `wireMenuBar` + test hooks).
- **NEW:** `www/tests/render/menu-bar.spec.js`.
- **UPDATE `www/index.html`:** add `#menu-bar` markup + six `[hidden]` dropdown panels + scoped CSS in the existing `<style>`. **Leave `#top-bar` (`index.html:822-851`) and the `<details>` panes (`#connection` :854-921, `#settings` :958-1085, `#debug` :1088-1110) intact.** IDs: feature-prefixed kebab (`#menu-view`, `#dropdown-view`, `#menu-conn-dot`) — avoid collisions with existing `#connection`/`#settings`/`#debug`/`#port-status`.
- **UPDATE `www/main.js`:** import + `wireMenuBar({ terminalWrapper })` at the seam before `wireKeyboard`; expose `window.__menuBar`. `terminalWrapper` is already resolved at `main.js:161`.

### Existing code being touched (read before editing)

- **`www/renderer/chrome.js`** — sole export `wireChrome(opts)` (`:71`). **Not modified this story** (its decomposition is E1.3). Its keydown chords (`:168-205`), focus indicator (`:210-224`), and visibility/SLIDE safety (`:235-271`) must keep running — the new menu bar must not register a competing wrapper-keydown listener.
- **`www/main.js`** — boot order: polite-fail (`:18-22`) → prefs (`:36`) → wasm/`Terminal` (`:155`) → `bootRenderer` (`:159`) → DOM refs (`:161-165`) → **`wireChrome` seam (`:238-248`)** → `wireScrollState`/`wireSelection` → **`wireKeyboard` (`:438-444`)**. Insert `wireMenuBar` in the seam window (after `wireChrome`, before `wireKeyboard`). `applyPrefs` (`:1041-1100`) + `prefsSubscribe(applyPrefs)` (`:1101`) are untouched (reset re-projection is E1.3).
- **`www/state/prefs.js`** — `getPrefs()` (`:171`, read at use-time), `savePrefs(partial)` (`:111`, 250ms debounce, does **not** fire subscribers), `subscribe` (`:163`, fires only on `resetPrefs`). Not needed for placeholder items but this is the pref idiom for later wiring.

### Testing requirements

- **Framework:** Playwright, **chromium project**; `testDir: ./tests`; specs `www/tests/{render,input,transport,session}/*.spec.js`; server `python3 -m http.server -d . 8000`, `baseURL http://localhost:8000/`. Put the new spec at `www/tests/render/menu-bar.spec.js`. [Source: playwright.config.js]
- **Cover (E1.1 slice):** shell renders 6 titles + status placeholder; dropdown open/move/click-away via `data-*`/`[hidden]` with no inline styles; the four variant renderings + `[data-focused]`-driven highlight + `retainFocus`; test hooks present.
- **Boot-race guard:** gate on `window.__menuBar` with `page.waitForFunction` before driving it (E0.1 learning — avoids the `window.__*` boot race).
- **Flake protocol (E0 action item #1):** the full parallel suite is flaky from wasm-boot starvation (e.g. `slide-post-fin-forward.spec.js` fails on a clean baseline). **Judge regressions by named oracles in isolation (`--workers=1`)** — do not treat a varying parallel-load failure set as a regression caused by this story.

### Previous-story intelligence (Epic E0)

- E0 shipped the two leaf primitives this epic imports: `retainFocus` (E0.1) and `openModal` (E0.2), each proven against a live caller, zero behavior change. NFR-1 focus-retention floor established. [Source: epic-e0-retro-2026-07-01.md]
- **`retainFocus` was hardened in code review:** it now **throws `TypeError`** if a `<select>` is passed without a `restoreTarget`, and guards duplicate listeners with a `WeakSet`. Pass `terminalWrapper` for any `<select>`; buttons need nothing.
- **Test-first with named oracles paid off** — the named spec is the correctness contract; keep new specs byte-stable.
- **`chrome.js` already has zero inline focus sites** (all 7 migrated early in E0.1). Relevant to E1.3 planning, not E1.1 — do not re-plan that work. [Source: retro action item #3]
- **Scope-boundary caution:** E0.1 drifted by front-running E1.3 work. For E1.1, resist migrating `<details>`/`#top-bar` controls — that is exactly the deferred work per the Scope Decision above.

### Git intelligence

Recent commits are all E0 backbone: `add shared openModal helper (E0.2) and refactor send-modal onto it`, `add shared retainFocus helper (E0.1) and migrate chrome.js focus retention`, `add build SHA to debug panel`. Established patterns to mirror: **zero-import leaf helpers, named exports, `wireXxx(opts)` shape, `window.__xxx` + `__getStateForTests` hooks, test-first with a dedicated named spec, atomic per-task commits.**

### Project Structure Notes

- Aligns with the `renderer/` module convention and the `main.js` composition-root wiring seam. New IDs are feature-prefixed kebab-case per SPINE conventions (`#menu-*`, `#dropdown-*`).
- **Known variance (documented, intentional):** the coexist decision means the running app temporarily shows BOTH the incumbent `#top-bar`/`<details>` chrome AND the new menu bar. This is expected during the E1→E2/E3/E5 migration and is resolved as each surface's function moves. Menu-bar dropdown items are inert placeholders this story.
- **Spec-vs-mock divergences (spec wins):** bar height 32px (mock 34px); menu-item highlight is solid `chrome-accent` fill + `chrome-bg` text (mock uses translucent `rgba(127,219,202,.14)`); **no** drop shadows / dot glow (mock has them — forbidden by UX-DR5); state via `data-*`/`[hidden]`, never the mock's inline `style="left:56px"`.

### References

- [Source: epics.md#Story-E1.1 (:259-281)] — story text + original ACs (removal clause deferred per Scope Decision).
- [Source: epics.md — FR-1/FR-2/FR-5 (:32-36); NFR-2/5/6/8 (:68-74); UX-DR1/4/5/6/7/8/9 (:96-104); Removal work (:88)]
- [Source: ARCHITECTURE-SPINE.md — AD-1 (:70-73), AD-2 (:75-78), AD-3 (:80-83), AD-7 (:100-103), AD-9 (:110-114), AD-10 (:116-119), AD-12 (:126-129); Consistency Conventions (:153-161); Structural seed (:178-194)]
- [Source: EPIC-SPLIT.md — E1 definition (:31-39); cross-cutting rules (:80-82)]
- [Source: DESIGN.md — menu-bar (:54-58,163,184), tokens (:8-13,118,127-132), type (:31-44), variants (:59-66,186-191), rounding (:45-48,175-180), elevation (:171,212), non-adaptive (:116,206)]
- [Source: EXPERIENCE.md — dropdown/variant behavior (:125-129), `[data-focused]` (:125,178,203), focus retention (:133,178)]
- [Source: mockups/key-screen-chrome.html — concrete markup/CSS target (:38-69,134-152); throwaway ref, spec wins on conflict]
- [Source: focus.js:37 (`retainFocus`); modal.js:45 (`openModal`); slide-chip.js / scroll-state.js (module template); playwright.config.js (test setup)]
- [Source: epic-e0-retro-2026-07-01.md — E0 learnings, flake protocol, retainFocus hardening]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Amelia / bmad-dev-story)

### Debug Log References

- Full parallel Playwright suite flaked on the pre-existing wasm-boot starvation issue (E0 retro action item #1). Two runs failed a *shifting* set of specs (run 1: menu-bar×2, theme-toggle, auto-connect, clear-screen, slide-compatibility; run 2: connect, slide-autosend-safety, slide-bridge×2, slide-cancel). **Every** failing spec passed when re-run in isolation with `--workers=1`, confirming no regression from this story — judged by named oracles per the flake protocol.

### Completion Notes List

- **Menu-bar shell shipped additively** — six titles (File · Connection · View · Settings · Debug · Help), click-driven dropdown open/move/click-away via `[hidden]` + `data-*` (zero inline styles), the four menu-item variant placeholders (action / with-shortcut-hint / checkable / radio-submenu / disabled), and the right-aligned gray "Not connected" status placeholder. Incumbent `#top-bar` + all three `<details>` panes remain intact (`git diff` = **231 insertions, 0 deletions** across index.html + main.js).
- **Non-adaptive shell (AC-5) — key design tension resolved:** the existing `:root` makes `--chrome-bg/fg/accent` theme-adaptive via a `[data-theme="crt"]` block (for the OLD `#top-bar`). Using those tokens raw would have made the menu bar flip with the terminal theme, violating "renders identically." Resolved by **pinning the neutral static values on `#menu-bar`** (a scoped custom-property override, NOT a `[data-theme]` styling branch) — dropdowns inherit the pin as nested descendants. Verified by a test that toggles Console↔CRT and asserts identical bar/title backgrounds. The pin is retired in E1.3+ when `#top-bar` (and the `[data-theme]` chrome override) go away.
- **Full-width layout fix:** `<body>` is a centering flex column (`index.html:212`), so a bare flex child shrink-wraps and centres (bar was 575px wide, centred, with the terminal canvas overlapping its sides). Added `align-self: stretch` so the bar fills the cross axis; locked with a geometry assertion (bar spans body width, status right-aligned).
- **Tokens added to `:root`:** `--chrome-muted`, `--field-bg`, and the four discrete `--status-*` dot colors (were absent; `--chrome-bg/fg/accent/border` already existed).
- **AD compliance verified by grep:** named export only (no default), zero inline-style writes, only `focus.js` imported (AD-3 allowlist), no `keydown`/`Esc` handler registered (Esc-passthrough guard is E1.2), and the new CSS block has no `[data-theme]` selector / `box-shadow` / `:focus-visible` / phosphor var (all such strings appear only in explanatory comments). The only literal colors are the three sanctioned neutral-pin values.
- **`retainFocus` (E0.1)** applied to every title + every menu-item button; verified opening a menu leaves `document.activeElement` on `#terminal-wrapper`.
- **Test hooks:** `window.__menuBar` exposes `{ open, close, getOpenMenu, dispose, __getStateForTests, __resetForTests }`. New spec `tests/render/menu-bar.spec.js` = **14 tests covering ACs 1-3 + AC-5**, green in isolation across repeated runs.
- **Deferred as designed (NOT in this story):** keyboard nav + Esc guard (E1.2); `chrome.js` decomposition (E1.3); real View actions (E1.4/E1.5); live connection status (E2/E4); Settings/SLIDE (E3); Debug-panel toggle (E5); Help modals (E6). Dropdown items are inert placeholders — no canvas/prefs setters wired.

### File List

- **NEW** `www/renderer/menu-bar.js` — `wireMenuBar(opts)` + dropdown mechanics + test hooks (named exports only).
- **NEW** `www/tests/render/menu-bar.spec.js` — 14 Playwright specs (ACs 1-3, AC-5, coexistence, focus retention).
- **MODIFIED** `www/index.html` — added `--chrome-muted` / `--field-bg` / `--status-*` tokens to `:root`; added `#menu-bar` markup (6 titles + 6 dropdown panels + status placeholder) before `#top-bar`; added scoped menu-bar CSS. No deletions.
- **MODIFIED** `www/main.js` — imported `wireMenuBar`; called it at the `wireChrome` seam (before `wireKeyboard`); exposed `window.__menuBar`.

## Change Log

| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2026-07-01 | 0.1 | Story drafted — comprehensive context engineering; E1.1 removal clause deferred to a coexist approach per project-lead decision. | Amelia (create-story) |
| 2026-07-01 | 1.0 | Implemented menu-bar shell + dropdown mechanics + four variant placeholders + status placeholder. Added neutral-shell tokens; pinned neutral values on `#menu-bar` for AC-5 non-adaptive rendering; `align-self:stretch` for full-width layout. New `menu-bar.js` + 14-test spec; wired at the `wireChrome` seam with `window.__menuBar`. All ACs met; no incumbent regressions (parallel failures are the pre-existing wasm-boot flake, all green in isolation). | Amelia (dev-story) |
