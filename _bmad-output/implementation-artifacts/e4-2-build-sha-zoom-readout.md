---
baseline_commit: 85dd5b33166733ed72a51ab91f6dac436a7dd0be
---

# Story E4.2: Build SHA & zoom readout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder,
I want the build SHA and the live zoom level in the bottom status bar,
so that I can tell which build I'm running and what zoom I'm at without opening a menu or guessing.

## Context & framing (read first)

**E4.1 already built the bar; this story fills its right group.** The `#status-bar` footer, its CSS,
`status-bar.js` (the connection projector), and the wiring at the composition root all exist and shipped in
E4.1. E4.2 adds the **right-aligned group** — a `.sb-right` container holding two new fields, **build SHA**
and **zoom level** — and makes `status-bar.js` their single writer. Do **not** rebuild the bar, re-wire the
connection projector, or touch the connection field.

**E4 is build-new, not relocation.** Acceptance is defined against the spec (FR-27 / UX-DR14 / AD-6), not
against a v1.1 incumbent. The one thing that *is* a relocation: the build SHA currently renders in the
`<details id="debug">` pane (`#build-sha`, `index.html:1684`), written by `main.js`. Per EXPERIENCE.md
("Build info does NOT live in the Debug menu — it lives in Help ▸ About") and the E5.1 scope note ("Build
info does **not** live here"), that debug-pane line is a **vestige to remove** — build SHA's permanent homes
are the **status bar (this story)** and the **About modal (E6.2, not yet built)**. Follow the exact E4.1
precedent: relocate the field, delete the legacy line, leave the rest of the `<details>` for E5/E7.

**AD-6 — fed, never owned.** Both new fields hold no independent truth and are pushed **imperatively** (both
sources are observer-less — `savePrefs` does not fan out, and the build stamp is a one-shot async import):

| Field | Element | Writer | Feed |
|-------|---------|--------|------|
| Build SHA | `#status-build` (**new**, in `.sb-right`) | **`status-bar.js` (this story)** | `main.js` pushes `statusBar.setBuild(BUILD_INFO)` when the `pkg/build-info.js` dynamic import resolves. |
| Zoom level | `#status-zoom` (**new**, in `.sb-right`) | **`status-bar.js` (this story)** | `main.js`'s `pushZoom(level)` calls `statusBar.setZoom(level)` — the single sink already funnelling both the View ▸ Zoom items and the Ctrl+{=,-,0} chord. |

**The `pushZoom(level)` hook already exists and already fires from both paths.** E1.5 built it as a no-op
stub (`main.js:196-200`) that records `window.__zoomPush.{last,count}`; the View ▸ Zoom menu items
(`menu-bar.js:975`) and the Ctrl+{=,-,0} chord (`chrome.js`, via the `pushZoom` opt) both call it. This story
gives its body a real destination (`statusBar.setZoom`). **Keep the `window.__zoomPush` bookkeeping lines** —
`tests/render/view-font-zoom-clear.spec.js:143,159-163` assert them; removing them regresses E1.5.

## Acceptance Criteria

**AC-1 — Right group markup; `status-bar.js` is the sole writer of both new fields (AD-6, NFR-4, DESIGN.md).**
A `.sb-right` group is appended inside `#status-bar` (after the existing `.sb-conn` connection group), holding
`<span id="status-build">` and `<span id="status-zoom">`. Per the mockup `.sb-right`, it is `margin-left:auto`
+ `display:flex` + `gap:18px`, so it pins to the right edge; text stays the bar's `--chrome-muted` default (no
new tokens, no accent). `status-bar.js` is the **single writer** of both fields — neither holds independent
truth (AD-6). The bar renders **identically** under Console and CRT (no phosphor var, no `[data-theme]`
styling branch — AD-9).

**AC-2 — Build SHA readout, matching Help ▸ About, fed by imperative push (FR-27, UX-DR14).**
`#status-build`'s `textContent` reads `build <sha>` where `<sha>` is exactly `BUILD_INFO.sha` (the same value
`window.__buildInfo.sha` carries and Help ▸ About will render — so the two never disagree). `status-bar.js`
exposes `setBuild(info)` (the AD-6 imperative-push hook for the observer-less async build stamp); `main.js`'s
existing `import('./pkg/build-info.js')` calls `statusBar.setBuild(BUILD_INFO)` on resolve and
`statusBar.setBuild({ sha: 'unknown (unbuilt)', builtAt: null })` on `.catch` (the existing unbuilt fallback).
`#status-build`'s `title` carries `built <builtAt>` when present (mirroring the old debug-pane behavior).
`status-bar.js` **must not** `import` `pkg/build-info.js` (AD-3 allowlist — the SHA arrives via the push).
The legacy `<p class="hint">Build: <code id="build-sha">…</code></p>` line in `<details id="debug">` is
**removed**, and `main.js` no longer holds a `buildShaEl` ref or writes it (`window.__buildInfo` is retained —
About/E6.2 and the console reader still use it).

**AC-3 — Zoom readout, live, single writer, both input paths (FR-27, AD-6, UX-DR14).**
`#status-zoom`'s `textContent` reads `zoom <n>×` where `<n>` is the integer zoom level 1..4 and `×` is the
multiplication sign **U+00D7** (not the letter "x"). `status-bar.js` exposes `setZoom(level)` and is its sole
writer. `main.js`'s `pushZoom(level)` body calls `statusBar.setZoom(level)` — so activating **View ▸ Zoom In /
Out / Actual Size** *or* pressing **Ctrl+= / Ctrl+- / Ctrl+0** updates the readout live (both funnel through
the one `pushZoom` sink). The **initial** readout is painted from `getPrefs().fontZoom` at wire time (prefs.js
is in the AD-3 allowlist), so the bar is correct at boot before any zoom change; a `resetPrefs()` re-paints it
via the existing `pushZoom(p.fontZoom)` reset-setter call (`main.js:1326`). `window.__zoomPush.{last,count}`
bookkeeping is **preserved** (E1.5 specs).

**AC-4 — Test coverage (AD-2, NFR-6).**
`www/tests/render/status-bar.spec.js` is extended (or a sibling spec added) to prove:
- `#status-build` reads `build ${window.__buildInfo.sha}` once the build-info import has resolved (and the
  fallback path yields `build unknown (unbuilt)` — drive by faking the import failure only if cheap;
  otherwise assert the resolved value against `window.__buildInfo.sha`, not a hard-coded SHA).
- `#status-zoom` initial text is `zoom 1×` (default `fontZoom`), and after driving a zoom change **via a View ▸
  Zoom menu item** *and* **via the Ctrl+= chord** it reads the pushed level (e.g. `zoom 2×`) — mirror
  `view-font-zoom-clear.spec.js`'s zoom-driving.
- Exactly one `#status-build` and one `#status-zoom` exist, both inside `#status-bar .sb-right`.
- The `.sb-right` group renders identically across a `[data-theme]` flip (mirror the E4.1 CRT↔Console
  assertion).

Run the full suite; treat any wasm-boot-under-parallelism flake as the ratified `chromium-transport` +
`retries:1` mask — do **not** re-diagnose per-story.

**Cross-cutting (from epics, stated once):** uses only `var(--chrome-*)`/`var(--status-*)` tokens (NFR-2); no
new dependencies / no build step (NFR-5); `window.__statusBar` + `__getStateForTests` extended for the new
fields (NFR-6). *(NFR-1 focus-retention is not triggered — E4.2 adds no focusable controls; the errors
affordance's clickable link is E4.3.)*

## Tasks / Subtasks

- [x] **Task 1 — Add the `.sb-right` group markup + CSS** (AC-1)
  - [x] In `www/index.html`, inside `<footer id="status-bar">` (after the existing `<span class="sb-conn">…`),
        appended `<span class="sb-right"><span id="status-build">build …</span><span
        id="status-zoom">zoom 1×</span></span>`. The placeholder text avoids a layout flash before the first
        push/initial-paint (build resolves async; zoom is painted synchronously at wire time).
  - [x] Added CSS after the E4.1 `#port-status` rule: `#status-bar .sb-right { margin-left:
        auto; display: flex; gap: 18px; }` (mockup `.sb-right`). Both spans inherit the bar's `--chrome-muted`
        12px monospace — **no** new tokens, **no** accent, **no** `[data-theme]` branch (AD-9). `.sb-conn` /
        `#port-status` untouched.
- [x] **Task 2 — Add build + zoom fields to `status-bar.js`** (AC-2, AC-3)
  - [x] Grabbed `#status-build` + `#status-zoom` by id in `wireStatusBar(opts)` alongside the existing
        `#status-conn-dot`/`#port-status` grabs. Stored as module-scope `buildElRef`/`zoomElRef`, null-guarded.
  - [x] Added `setBuild(info)`: `buildElRef.textContent = \`build ${info?.sha ?? 'unknown (unbuilt)'}\``; if
        `info?.builtAt`, `buildElRef.title = \`built ${info.builtAt}\``. Null-guarded.
  - [x] Added `setZoom(level)`: `zoomElRef.textContent = \`zoom ${level}×\`` (× = U+00D7). Null-guarded; keeps a
        module-scope `lastZoom` for `__getStateForTests` introspection.
  - [x] **Initial zoom paint** inside `wireStatusBar`: `setZoom(getPrefs().fontZoom)` (prefs already imported;
        `fontZoom` default `1` → `zoom 1×`). Build keeps its placeholder until `setBuild` is pushed.
  - [x] Returned `setBuild` and `setZoom` on the `wireStatusBar` API object. Extended `__getStateForTests()` with
        `build`/`zoom`/`lastZoom`; extended `__resetForTests()` to revert build to its placeholder and re-paint
        zoom from `getPrefs().fontZoom`.
- [x] **Task 3 — Wire the two pushes at the composition root** (AC-2, AC-3)
  - [x] Gave `pushZoom(level)` a real destination: after the `window.__zoomPush` bookkeeping, added
        `if (window.__statusBar) window.__statusBar.setZoom(level);`. **Kept** the `window.__zoomPush.{last,count}`
        lines (E1.5 specs). Refreshed the stale "no-op stub … until E4" comment to the now-live push.
  - [x] Routed the build stamp into the bar: **relocated** the `import('./pkg/build-info.js')` projection block
        to just **after** `window.__statusBar = statusBar;`, calling `statusBar.setBuild(BUILD_INFO)` on resolve /
        `statusBar.setBuild({ sha: 'unknown (unbuilt)', builtAt: null })` on `.catch`. Kept the
        `window.__buildInfo = …` assignments. Deleted the `const buildShaEl` ref and both `buildShaEl` writes.
  - [x] Removed the legacy `<p class="hint">Build: <code id="build-sha">loading…</code></p>` line from
        `<details id="debug">`; left the rest of the debug pane intact (E5/E7 own it). Replaced the adjacent
        comment with a relocation note.
- [x] **Task 4 — Tests** (AC-4)
  - [x] Extended `www/tests/render/status-bar.spec.js`: asserts `#status-build` === `\`build ${window.__buildInfo.sha}\``
        after `buildReady(page)` (reads `window.__buildInfo.sha` in-page — no hard-coded SHA). Asserts
        `#status-zoom` initial `zoom 1×`; drives a zoom-in via `window.__menuBar.open('view')` +
        `[data-action="zoom-in"]` → `zoom 2×`; drives the `Ctrl+=` chord → tracks; asserts `__zoomPush.last`
        preserved. Asserts singletons + `.sb-right` containment + CRT↔Console identical.
  - [x] Ran the full suite: **485 passed, 0 hard failures** (9 flaky in the ratified `chromium-transport` project,
        all green on `retries:1`; 1 expected skip).

## Dev Notes

### Architecture compliance — the governing decisions (verbatim intent)

- **AD-6 — Status bar is fed, never owned.** `status-bar.js` holds no independent truth (single-writer per
  field), maps `source → textContent`. Fed two ways: **subscribe** for observer sources (already done for
  connection in E4.1); **imperative push** for observer-less sources — the spine names both of this story's
  fields explicitly: *"for sources with no observer (zoom in `canvas.js`, baud/serial-config in `prefs` —
  `savePrefs` does not fan out), the module that owns the mutation imperatively pushes via the status-bar API
  (`statusBar.setZoom()`, `statusBar.setConnectionInfo()`)."* Build SHA is the same shape (a one-shot async
  import stamp) → `statusBar.setBuild()`.
- **AD-3 — Direct-import allowlist.** A new chrome module may import **only** `renderer/canvas.js` setters and
  `state/prefs.js` directly. `status-bar.js` already imports `getPrefs` (used here for the initial zoom paint) —
  that is allowed. It **must not** import `pkg/build-info.js`; the SHA arrives via `setBuild`.
- **AD-1 / AD-2 — Composition-root DI; `wireXxx(opts)` + test hooks.** New API methods hang off the object
  `wireStatusBar` already returns; `window.__statusBar` is already exposed; extend `__getStateForTests` /
  `__resetForTests` for the new fields.
- **AD-9 — Neutral shell.** Only `var(--chrome-*)` tokens; the `.sb-right` group inherits the bar's muted text;
  no phosphor var, no `[data-theme]` branch. The E4.1 `#status-bar` block already pins `--chrome-bg/fg/accent`
  for CRT↔Console parity — the new group needs no extra pin.
- **AD-12 — Boot order (already satisfied).** `status-bar` is wired at the `wireChrome` seam after
  `wireMenuBar`, before `wireKeyboard` (E4.1). E4.2 adds no new wire call — it fills in two pushes on the
  existing seam.
- **Consistency conventions:** element ids kebab-case, feature-prefixed (`#status-build`, `#status-zoom`);
  visual state via text/`data-*`, never inline styles; `getPrefs()` **at use-time**. The `×` glyph is a
  literal U+00D7, not `x`.

### Exact integration points (read these files before coding)

**`www/renderer/status-bar.js` — the module to extend (already the connection projector):**
- Field grabs at `status-bar.js:147-148` (`getElementById('status-conn-dot')` / `'port-status'`) — add the
  two new grabs alongside.
- Returned API object at `status-bar.js:166-189` (`setConnectionInfo`, `showBootReady`, `projectConnection`,
  `dispose`, `__getStateForTests`, `__resetForTests`) — add `setBuild`, `setZoom`.
- `getPrefs` is already imported (`status-bar.js:30`); `getPrefs().serial` is read in `formatFraming()`
  (`:81-85`) — read `getPrefs().fontZoom` the same at-use-time way for the initial zoom paint.
- `__getStateForTests` (`:200-207`) / `__resetForTests` (`:209-215`) — extend both.

**`www/main.js` — the two pushes:**
- `pushZoom(level)` body: `main.js:196-200` (records `window.__zoomPush.{last,count}`). Add the
  `statusBar.setZoom(level)` call here; keep the bookkeeping. Injected into **both** `wireChrome` (chord,
  `main.js:359`) and `wireMenuBar` (menu items, `main.js:395`) — one edit covers both input paths.
- Build stamp: `const buildShaEl = document.getElementById('build-sha')` (`main.js:284`) + the
  `import('./pkg/build-info.js').then(…).catch(…)` block (`main.js:285-296`). Move the projection after the
  `statusBar` wire (`main.js:466-481`); swap the `buildShaEl` writes for `statusBar.setBuild(...)`; keep
  `window.__buildInfo`. Note the dynamic import's `.then` runs in a later microtask, so `const statusBar`
  (`main.js:466`) is already initialized when it fires — but relocating the block below the wire makes that
  obvious and avoids reasoning about TDZ.
- Reset re-paint: `pushZoom(p.fontZoom)` at the reset setter site (`main.js:1326`) — already there; once
  `pushZoom` calls `setZoom`, reset re-paints the readout for free. No change needed beyond Task 3.

**`www/renderer/menu-bar.js` / `www/renderer/chrome.js` — the zoom sources (do NOT modify):**
- `menu-bar.js:969-986` — View ▸ Zoom In/Out/Actual Size call `applyZoom(...)` then
  `pushZoomRef(getActiveZoom())` (`:975`); `pushZoomRef` is the injected `pushZoom`.
- `chrome.js` — the Ctrl+{=,-,0} chord calls the injected `pushZoom` opt (`:76`). Both already fire the sink;
  this story only gives the sink a destination.

**`www/state/prefs.js` — the zoom source of truth for the initial paint:**
- `DEFAULTS.fontZoom = 1` (`prefs.js:23`), integer 1..4. The defensive merge guarantees it is never undefined.
  Read `getPrefs().fontZoom` at wire time for the initial `zoom 1×`.

**`www/pkg/build-info.js` — the build stamp (do NOT import from status-bar.js):**
- `export const BUILD_INFO = { sha: "…", builtAt: "…" }` — generated by `scripts/build.sh`, gitignored,
  regenerated per build. A build that skipped `build.sh` has no file → the `.catch` fallback (`unknown
  (unbuilt)`) fires. Tests must read `window.__buildInfo.sha` in-page, never hard-code a SHA.

### UX contract — exact tokens & copy (do not paraphrase)

- Mockup reference (`mockups/key-screen-chrome.html:168-171,221-223`): the status bar's right group is
  `<span class="sb-right"><span>build 86e5662</span><span>zoom 1×</span></span>`, `.sb-right{margin-left:auto;
  display:flex;gap:18px}`. Text is the bar's muted default (no accent).
- **Build readout:** `build <sha>`. The mockup illustrates a 7-char short SHA (`86e5662`); **the spec's
  "matching Help ▸ About" wins** — render the full `BUILD_INFO.sha` (e.g. `86e56623c58d-dirty`) so the status
  bar and the About modal are guaranteed identical from one source. (See Open Questions — the truncate-to-short
  option is called out; default is full.)
- **Zoom readout:** `zoom <n>×`, n = integer 1..4, `×` = **U+00D7**. `zoom 1×` at actual size.
- Tokens (`index.html:40-54`): reuse only `--chrome-muted` (right-group text) — introduce none. Font:
  `ui-monospace, …` (the bar's existing 12px `hint` role).
- Voice/placement: build + zoom are quiet, muted, right-aligned; they never draw accent (accent is spent on
  focus/selection/primary-buttons/links only — UX-DR1).

### Testing standards

- Playwright chromium suite under `www/tests/` — extend `tests/render/status-bar.spec.js` (8 tests today).
- `ready(page)`: `await page.waitForFunction(() => window.__statusBar && typeof
  window.__statusBar.__getStateForTests === 'function')`. The build push is async — also wait for
  `window.__buildInfo` to be set before asserting `#status-build`.
- Zoom-driving idioms (carried from E1/E2/E3 — still per-story, retro action #1): `window.__menuBar.open('view')`
  to open the View menu; click `[data-action="zoom-in"]`; for the chord, dispatch `Ctrl+=`. Mirror
  `tests/render/view-font-zoom-clear.spec.js:140-163` (which already proves `pushZoom` fires from both paths
  via `window.__zoomPush`); here additionally assert `#status-zoom` text tracks.
- **Do not break `view-font-zoom-clear.spec.js`** — it reads `window.__zoomPush.{last,count}`. Keep those lines
  in `pushZoom`.
- Flake policy: `chromium-transport` project + `retries:1` is the **ratified mask** — no per-story `--workers=1`,
  no re-diagnosis of the wasm-boot-under-parallelism flake.

### Previous-story intelligence (E4.1 + E1–E3)

- **E4.1 built exactly the seam this story plugs into.** `status-bar.js` already returns an API object with an
  imperative-push hook family (`setConnectionInfo`) and a `getPrefs()`-at-use-time discipline — `setBuild` /
  `setZoom` are siblings, not new machinery. Copy the shape; don't invent a new pattern.
- **The injected-opt / DOM-projector seam has held for four epics.** Don't `import serial.js` or
  `pkg/build-info.js` from `status-bar.js`; deps arrive via opts/push at the composition root.
- **`savePrefs` does not fan out (AD-4)** — which is *why* zoom is an imperative push, not a subscription. The
  module that mutates fontZoom (menu-bar/chord → `pushZoom`) pushes at the same point it persists.
- **`pushZoom` already fires from both paths (E1.5)** — the menu item (`menu-bar.js:975`) and the chord
  (`chrome.js`). You are giving one sink a destination, not adding two call sites.
- **Relocation keeps forcing incumbent-spec edits** (E2/E3 retros). Here the cost is tiny: one debug-pane line
  removed, no test asserts `#build-sha` (grep-verified). No spec repoint needed.
- **Fill the Code Review section before marking done** (E2 action #2 / E3 action #2 / E4.1 done-gate — no story
  reaches `done` with the review section unfilled). Run the independent `code-review` workflow in a fresh
  context with a different LLM; record: N findings (severity), fixed in `<sha>`.

### Project Structure Notes

- Edits only — **no new files**: `www/renderer/status-bar.js` (add two fields + `setBuild`/`setZoom` +
  introspection), `www/index.html` (add `.sb-right` group + one CSS rule; remove the debug-pane `#build-sha`
  line), `www/main.js` (wire `pushZoom`→`setZoom`, route build stamp→`setBuild`, drop `buildShaEl`),
  `www/tests/render/status-bar.spec.js` (extend).
- No changes to `serial.js`, `menu-bar.js`, `chrome.js`, `canvas.js`, `prefs.js`, `pkg/build-info.js` — all
  already expose what this story consumes.
- No new dependencies, no build step (static ESM, Chromium ≥ 89).
- **E7 dual-chrome checklist (keep current — retro action #4):** after this story, `<details id="debug">` no
  longer holds the build line (relocated to `#status-bar`); the debug pane's remaining widgets migrate to the
  toggleable Debug panel in E5, and the `<details>` shell + `#top-bar` retire wholesale in E7. Build info's
  homes are now `#status-bar` (permanent) + About modal (E6.2).

### Scope boundaries (do NOT build here)

- **Recent-errors affordance → E4.3.** No error count, no `▲` glyph, no click-to-open-Serial-Config, no
  amber tint here. E4.3 adds a third element to `.sb-right` (or its own group) — leave room but don't build it.
- **About modal → E6.2.** Do not build the About modal; just keep `window.__buildInfo` populated so E6.2 can
  read the same stamp this story renders.
- **Do not restyle or re-wire the connection field / dot** (E4.1). No changes to `projectConnection`,
  `#port-status`, `#status-conn-dot`, or the connection CSS.
- **Do not remove `window.__zoomPush`** — E1.5's `view-font-zoom-clear.spec.js` depends on it.

### Open Questions (for Ant — non-blocking; story ships with the noted default)

1. **Build SHA length in the status bar — full vs short.** The mockup shows a 7-char short SHA (`build
   86e5662`); the spec AC says "matching Help ▸ About," and About renders the full `BUILD_INFO.sha`
   (`86e56623c58d-dirty`). **Default chosen: full SHA**, single-sourced with About so the two can't drift. If
   you'd rather the slim bar show a 7-char short form, it's a one-line `slice`/regex in `setBuild` — but then
   About must truncate identically (or the "matching" AC weakens to "same prefix"). Flag if you want short.

### References

- [Source: epics.md#Story-E4.2] — story statement + AC (FR-27; UX-DR14).
- [Source: ARCHITECTURE-SPINE.md#AD-6] status bar fed/never-owned, names `statusBar.setZoom()`/`setConnectionInfo()`
  imperative pushes for observer-less sources; [#AD-3] import allowlist; [#AD-1/#AD-2] composition-root + wireXxx
  + test hooks; [#AD-9] neutral shell; [#AD-12] boot order (already satisfied); [#Structural-Seed] "Bottom status
  bar (connection/baud/build/zoom) → renderer/status-bar.js (subscribe + imperative push)".
- [Source: DESIGN.md#Status-bar] slim bottom bar, chrome-muted text, "build SHA, and zoom level"; accent spent
  only on focus/selection/links (UX-DR1).
- [Source: EXPERIENCE.md:73,99] "Build info does NOT live in the Debug menu — it lives in Help ▸ About";
  "Status bar — connection dot + device/baud line + build SHA + zoom."
- [Source: mockups/key-screen-chrome.html:85-92,168-171,221-223] `.sb-right` composition (`margin-left:auto`,
  `gap:18px`), `build 86e5662` / `zoom 1×`.
- [Source: e4-1-connection-device-baud-readout.md] the bar + `status-bar.js` API shape this story extends.
- [Source: www/renderer/status-bar.js:30,81-85,147-148,166-189,200-215] getPrefs import, formatFraming pattern,
  field grabs, returned API, test hooks.
- [Source: www/main.js:194-200,284-296,359,395,466-481,1326] pushZoom stub, build-info import, pushZoom
  injections, statusBar wire, reset re-paint.
- [Source: www/renderer/menu-bar.js:969-986] View ▸ Zoom items → pushZoomRef(getActiveZoom()).
- [Source: www/state/prefs.js:23] `DEFAULTS.fontZoom = 1` (integer 1..4).
- [Source: www/pkg/build-info.js] `BUILD_INFO = { sha, builtAt }` (gitignored, per-build).
- [Source: www/tests/render/view-font-zoom-clear.spec.js:143,159-163] `window.__zoomPush.{last,count}` assertions
  to preserve.
- [Source: E3 retro §6 + action 3] E4 build-new framing (spec-based acceptance, not incumbent).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- Targeted run (`tests/render/status-bar.spec.js` + `tests/render/view-font-zoom-clear.spec.js`): 28 passed —
  16 status-bar (incl. 6 new E4.2) + 12 zoom (E1.5 regression guard, `window.__zoomPush` intact).
- Full suite (`npx playwright test`): 485 passed, 0 hard failures, 9 flaky (all `chromium-transport`, green on
  `retries:1` — the ratified wasm-boot-under-parallelism mask), 1 skipped (expected). ~1.7m.

### Completion Notes List

- **AC-1** — `.sb-right` group appended after `.sb-conn`, holding `#status-build` + `#status-zoom`;
  `margin-left:auto; display:flex; gap:18px`; muted default, no new tokens/accent, no `[data-theme]` branch.
  `status-bar.js` is the sole writer of both. Neutral-shell parity proven by the data-theme-flip test.
- **AC-2** — `#status-build` renders `build ${BUILD_INFO.sha}` (full SHA — the "matching Help ▸ About" default,
  single-sourced with `window.__buildInfo` so the two can't drift; `builtAt` on the `title`). `setBuild` is the
  AD-6 imperative-push hook; `main.js` pushes on the `pkg/build-info.js` import resolve and on `.catch`
  (`unknown (unbuilt)`). `status-bar.js` does **not** import build-info (AD-3). Legacy `#build-sha` debug-pane
  line + `buildShaEl` ref/writes removed; `window.__buildInfo` retained for About/E6.2 + console.
- **AC-3** — `#status-zoom` renders `zoom <n>×` (U+00D7). `setZoom` is the sole writer, fed by `main.js`'s
  `pushZoom` sink — so View ▸ Zoom In/Out/Actual Size **and** Ctrl+{=,-,0} both update it live (one sink, both
  paths). Initial paint from `getPrefs().fontZoom` at wire time (`zoom 1×`); `resetPrefs()` re-paints via the
  existing `pushZoom(p.fontZoom)`. `window.__zoomPush.{last,count}` bookkeeping preserved (E1.5).
- **AC-4** — spec extended with the four proof groups; full suite green under the ratified flake mask.
- **Open Question #1 (build SHA length):** shipped the noted default — **full SHA**, single-sourced with About.
- **Scope:** edits only, no new files, no new deps, no build step. Connection field / dot untouched (E4.1);
  no recent-errors affordance (E4.3); no About modal (E6.2).

### Code Review

Not yet run — the `review` status gate. The independent `code-review` workflow must run in a fresh context with
a **different** LLM before this story advances to `done` (done-gate: no story reaches `done` with the review
section unfilled). To be filled with: N findings (severity), fixed in `<sha>`.

### Change Log

- 2026-07-03 — E4.2 implemented: `.sb-right` group (build SHA + zoom) added to the bottom status bar;
  `status-bar.js` extended with `setBuild`/`setZoom` (single writer, AD-6 imperative push); `main.js` wires
  `pushZoom → setZoom` and routes the build stamp → `setBuild`; legacy `#build-sha` debug-pane line relocated
  to `#status-build`. Tests extended (6 new); full suite 485 passed / 0 hard failures. Status → review.

### File List

- `www/index.html` — added `.sb-right` group markup (`#status-build`, `#status-zoom`) + one CSS rule; removed
  the legacy `<code id="build-sha">` debug-pane line.
- `www/renderer/status-bar.js` — added `buildElRef`/`zoomElRef`/`lastZoom`; `setBuild`/`setZoom` writers +
  initial zoom paint; exposed both on the API; extended `__getStateForTests`/`__resetForTests`.
- `www/main.js` — `pushZoom` now pushes to `statusBar.setZoom`; relocated the `pkg/build-info.js` projection
  below the status-bar wire, feeding `statusBar.setBuild` (dropped the `buildShaEl` ref/writes; kept
  `window.__buildInfo`).
- `www/tests/render/status-bar.spec.js` — added the E4.2 build + zoom + right-group describe blocks (6 tests).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — E4.2 status → in-progress → review.
