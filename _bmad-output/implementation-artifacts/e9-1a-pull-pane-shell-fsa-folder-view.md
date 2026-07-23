---
baseline_commit: 8f9c5465873c6545bce850a2850a53edf9c95358
---

# Story 9.1a: Local folder pane shell with file view

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast daily driver,
I want an in-app pane docked beside the terminal that shows the contents of my SLIDE-recv folder,
so that I can see where pulled files will land — without leaving Beastty or opening a native file manager.

This is the **first** story of Epic E9 (Local Folder Pull Pane). It builds the pane *shell*: a persistent, gutter-docked `wirePullPane` component that binds a local folder, lists its files, and handles the first-run / permission / empty states — plus the composition-root wiring. It deliberately does **not** build the live-refresh machinery (that is **S9.1b**) or any drop/compose/pull behavior (that is **S9.2 / S9.3**).

## Scope boundary (read first)

**IN scope (S9.1a):** FR-1, FR-2, FR-3, NFR-2, NFR-4, NFR-5 — the docked pane, one-level file list, first-run "choose folder", permission-needed state, empty state, and AD-compliant wiring + test hooks.

**OUT of scope — do NOT build here:**
- **Refresh machinery** (FR-8 three triggers, FR-9 timer guards, FR-10 diff-render) → **S9.1b**. Render the list *once* on bind/render; structure `render()` so S9.1b can call it on a trigger, but wire **no** timers, focus/visibility listeners, or diff logic yet.
- **Drop / compose / preview / inject** (FR-4/5/6/7/11) → **S9.2 / S9.3**. No drag-drop handlers, no `SLIDE S` composition, no `tx-sink` calls.
- **Reverse drag** (FR-12) → **S9.4**.

Leave clean extension points, but don't pull future FRs forward.

## Acceptance Criteria

1. **Docked in the gutter, zero terminal columns (FR-2, NFR-5, UX-DR1).** When a folder is bound and the window is wide enough, the pane renders as a persistent panel in the **right layout gutter**, beside the terminal. The 80×24 canvas is **never shrunk or reflowed** — it continues to center in the space that remains (the layout becomes a flex row `[canvas centered][pane]`, canvas still effectively `margin:auto`-centered in its area). The pane costs **no** terminal columns and never occludes a glyph.
2. **Narrow-window fallback (FR-2, UX-DR1).** When the window is too narrow to leave gutter room, the pane collapses to a thin right-edge rail (a mint file-count badge). *(Rail → bloom-open on click/drag is stubbed structurally here; full bloom interaction may be finished in S9.2/S9.3 — at minimum the rail must not steal columns and must be visibly present.)*
3. **First-run "choose folder" (FR-3).** With no folder bound, the pane shows: **"No folder chosen. Pulled files land here."** + a **[Choose folder…]** control. Choosing invokes `window.showDirectoryPicker({ mode: 'readwrite' })` and **persists the handle as SLIDE-recv's `recv_directory`** (via `idb.setRecvDirHandle`) — the pane binds the *same* handle recv uses; there is no second/separate destination. (See "v1 folder binding" in Dev Notes.)
4. **File list, one level (FR-1).** With a folder bound and permission `granted`, the pane lists that directory's **files, one level deep** (skip sub-directories for v1), each row = filename (left) + muted, tabular-numeric size (right), on the DESIGN.md `{components.pull-pane}` treatment. Rows reuse the menu-item selected-row highlight on hover.
5. **Permission-needed state (FR-9 — permission aspect only; UX-DR3).** If the bound handle's permission is not `granted`, the pane shows **"Permission needed to read this folder."** + **[Grant access]**, and **does not throw**. Granting (via user gesture → `requestPermission({ mode: 'readwrite' })`) re-reads and shows the list. *(The ~60s timer guard around this is S9.1b — not here.)*
6. **Empty state.** A bound, readable, empty folder shows **"Empty — pulled files will appear here."**
7. **Architecture compliance (NFR-2).** `renderer/pull-pane.js` is a `wireXxx(opts)` component (AD-1/AD-2): module-scope state + `wirePullPane(opts)` returning an API + private `render()` projecting state via `[hidden]`/`data-*` + `dispose()` + `__getStateForTests`/`__resetForTests`. Per AD-3 it **direct-imports only** `renderer/canvas.js` setters and `state/prefs.js`; **every other dependency** (`state/idb.js`, `renderer/focus.js` `retainFocus`, and anything else) arrives via injected `wirePullPane(opts)` from `main.js`. Styled with **`--chrome-*` tokens only** (AD-9), visually identical across CRT↔Console. Every interactive control uses `retainFocus` (AD-10). Wired at the composition root in the documented boot order (AD-12).
8. **Test hooks + spec (NFR-4).** Exposes `window.__pullPane` with `__getStateForTests()` + `__resetForTests()`. A Playwright spec `www/tests/render/pull-pane.spec.js` (chromium project) covers: first-run state, bound+listed state, permission-needed state, empty state, and that the pane consumes zero terminal columns (canvas width unchanged with pane present). Native ESM, no build step, no new dependencies.

## Tasks / Subtasks

- [x] **T1 — Static markup + gutter layout (AC: 1, 2, 4, 7)**
  - [x] Add `#pull-pane` markup to `index.html` as a sibling of `#terminal-wrapper` (NOT inside it — the pane is gutter furniture, not a canvas overlay). Include header (folder name + `↻` placeholder — inert in S9.1a), caption row, list container, footer hint, and the blank-state + rail containers, all `hidden`/`data-*`-driven.
  - [x] Turn the `<body>` centering so terminal + pane sit in a **flex row** while the canvas stays centered in its remaining space and the menu/status bars stay full-width. Verify at multiple widths the canvas size/zoom is unchanged (compare `#terminal` width with/without the pane).
  - [x] Add `--chrome-*`-only CSS for the pane per `{components.pull-pane}` (bg/border/radius `rounded/md`, list-row hover = menu-item highlight, footer hint muted, rail + badge). No phosphor vars, no `[data-theme]` branch.
  - [x] Narrow-window fallback: collapse to the edge rail (container query / width check). Rail shows the file-count badge.
- [x] **T2 — `renderer/pull-pane.js` component (AC: 3, 4, 5, 6, 7)**
  - [x] Create the module on the `scroll-state.js` / `slide-chip.js` template (see Dev Notes skeleton). Module-scope state: `{ folderName, permission, files[], view: 'first-run'|'permission'|'empty'|'list' }`. (The narrow-window `rail` is a CSS container-query presentation of whichever content view is current — not a JS state — so it composes with every bound state; see index.html + Completion Notes.)
  - [x] `wirePullPane(opts)` — accept injected deps (`idb`, `retainFocus`, DOM refs, terminal-wrapper ref for focus restore); return API `{ render, refresh, dispose, __getStateForTests, __resetForTests }` (+ `__setDirHandleForTests` test seam). (Expose `refresh` for S9.1b to call later — but do not schedule it here.)
  - [x] On wire: read `idb.getRecvDirHandle()`. If null → first-run view. If present → `queryPermission` → `granted` ? enumerate + list : permission view.
  - [x] First-run `[Choose folder…]`: `window.showDirectoryPicker({ mode:'readwrite' })` → `idb.setRecvDirHandle(handle)` → enumerate + render. Swallow `AbortError` silently (D-04 precedent).
  - [x] `[Grant access]`: `handle.requestPermission({ mode:'readwrite' })` → on `granted`, enumerate + render.
  - [x] Enumerate one level: `for await (const [name, h] of dirHandle.entries()) if (h.kind === 'file') …`; get size via `h.getFile()` then `file.size`. Sort (name asc). Render rows.
  - [x] `retainFocus` on every control (`[Choose folder…]`, `[Grant access]`) — buttons get `mousedown→preventDefault`; terminal-wrapper passed as `restoreTarget`. (No focusable list rows in S9.1a — rows are inert until S9.2 selection.)
  - [x] `render()` projects `view` + `files` onto the DOM via `[hidden]`/`data-*` only (no inline styles). `dispose()` clears listeners. `__resetForTests()` clears state + repaints first-run.
- [x] **T3 — Composition-root wiring (AC: 7)**
  - [x] Import `wirePullPane` in `main.js`; call it **after `wireStatusBar` (~main.js:576), before `wireScrollState`**, injecting: idb module (`getRecvDirHandle`/`setRecvDirHandle`), `retainFocus`, `#pull-pane` DOM root, and the terminal-wrapper ref. Assign `window.__pullPane`.
  - [x] Confirm AD-3: the module direct-imports NOTHING from other app modules; all deps (idb, retainFocus, DOM root, terminal-wrapper) arrive via opts. (It needs neither `canvas.js` nor `prefs.js` for S9.1a, so it imports neither — the allowlist permits them but they are unused.)
- [x] **T4 — Playwright spec (AC: 8)**
  - [x] `www/tests/render/pull-pane.spec.js` on the paste-toast spec pattern (SERIAL_MOCK, boot-race guard on `window.__pullPane.__getStateForTests`, `__resetForTests` in `beforeEach`, `@fast` throughout). Covers the four views + zero-column assertion + neutral-shell theme flip + focus retention + narrow-window rail. FSA states driven deterministically via the `__setDirHandleForTests` seam with an in-page fake handle; `showDirectoryPicker` stubbed for the focus test.
- [x] **T5 — Verify + mark done**
  - [x] Full suite green at parallel (retries:1 policy stands — no per-story `--workers=1` re-diagnosis; see E5 retro). 543 passed / 0 failed / 11 known contention flakes (all passed on retry, none pull-pane). The 8 pull-pane specs pass first-try.
  - [ ] Fill the Code Review section; mark story done in **both** sprint-status.yaml **and** this file's Status (run `scripts/check-story-done-consistency.py`). **Deferred to after code review** — per the dev-story workflow the story moves to `review` first; done-marking follows the code-review pass (recommended with a different LLM). This box stays open until then.

## Dev Notes

### v1 folder binding — the pane shares SLIDE-recv's folder (do not invent a second one)
The pane binds **exactly** SLIDE-recv's persisted `recv_directory` handle — one shared folder. On first-run, choosing a folder calls `showDirectoryPicker` **and** `idb.setRecvDirHandle(handle)` (the same key recv reads), so recv's incoming files land in the pane's folder with **no retarget and no mutation of recv transport state**. On load, read `idb.getRecvDirHandle()`. [Source: epics-pull-pane.md FR-1/FR-6/Additional-Requirements; ARCHITECTURE-SPINE.md AD-11.]
> **Coordination note:** `slide-recv.js`'s own `pickFolder()` (slide-recv.js:276) is module-internal (not exported) and also writes `recv_directory`. Do **not** duplicate recv's picker UI; the pane does its own `showDirectoryPicker` + `idb.setRecvDirHandle` against the same key. They stay consistent because they share the one IDB key. (A future shared helper is fine but not required for S9.1a.)

### Architecture compliance (guardrails)
- **AD-11 (amended 2026-07-23):** the pull pane is a **sanctioned** persistent in-page surface — the second one after the debug panel — **only** as gutter-docked furniture outside the 80×24 grid. The canvas is centered via `margin:auto` (`body{display:flex;flex-direction:column;align-items:center}`, `#terminal-wrapper{margin:16px auto}`), so the gutter is free real-estate. Collapse-to-rail is the narrow-window fallback, not the default. [Source: ARCHITECTURE-SPINE.md#AD-11]
- **AD-1/AD-2:** `wireXxx(opts)` shape; named exports only; no default export; no build step. Template: `renderer/scroll-state.js`, `renderer/slide-chip.js`.
- **AD-3 (import allowlist):** direct-import only `renderer/canvas.js` setters + `state/prefs.js`. Inject `state/idb.js`, `renderer/focus.js`, DOM refs, terminal-wrapper via `wirePullPane(opts)`. [Source: ARCHITECTURE-SPINE.md#AD-3]
- **AD-9:** `--chrome-*` tokens only; identical CRT↔Console; never phosphor vars or `[data-theme]` styling branches.
- **AD-10:** `retainFocus(el, restoreTarget?)` on every control (buttons → `mousedown→preventDefault`; focus-owning controls require a `restoreTarget`). [Source: renderer/focus.js:60]
- **AD-12:** wire in `main.js` boot order after `wireStatusBar` (main.js:576), before `wireScrollState` (main.js:609). [Source: main.js wiring region 410–981]

### Files to create / modify
- **NEW** `www/renderer/pull-pane.js` — the component.
- **UPDATE** `www/index.html` — add `#pull-pane` markup (sibling of `#terminal-wrapper`, per DOM at index.html:1535–1579) + `--chrome-*` CSS + the flex-row gutter layout (current: `body` flex-column center, `#terminal-wrapper{display:inline-block;margin:16px auto}`).
- **UPDATE** `www/main.js` — import + `wirePullPane({...})` at ~line 576, `window.__pullPane = …`.
- **NEW** `www/tests/render/pull-pane.spec.js` — Playwright spec.

### Component skeleton (copy the template shape)
```js
// module-scope state
let state = { folderName: null, permission: 'prompt', files: [], view: 'first-run' };
let paneEl = null, listEl = null, idbRef = null, retainFocusRef = null, wrapperRef = null;

export function wirePullPane(opts) {
  ({ paneEl, listEl, idb: idbRef, retainFocus: retainFocusRef, terminalWrapper: wrapperRef } = opts);
  // wire controls with retainFocusRef(btn) / retainFocusRef(sel, wrapperRef)
  bindFromIdb();               // async: getRecvDirHandle → view
  return { render, refresh: bindFromIdb, dispose, __getStateForTests, __resetForTests };
}
function render() { /* project state.view + state.files via [hidden]/data-* only */ }
export function __getStateForTests() { return { ...state, fileCount: state.files.length }; }
export function __resetForTests() { state = { folderName:null, permission:'prompt', files:[], view:'first-run' }; render(); }
export function dispose() { /* remove listeners */ }
```
[Source: renderer/scroll-state.js:32–165, renderer/slide-chip.js:89–523]

### APIs to reuse (verified present — do not reinvent)
- `state/idb.js:51` `async getRecvDirHandle() → Promise<FileSystemDirectoryHandle|null>` (key `recv_directory`); `:66` `async setRecvDirHandle(handle)`; `:80` `async clearRecvDirHandle()`.
- FSA folder pick: `window.showDirectoryPicker({ mode:'readwrite' })` (pattern at slide-recv.js:276; swallow `AbortError`).
- FSA permission: `handle.queryPermission({ mode:'readwrite' })` / `handle.requestPermission({ mode:'readwrite' })` → `'granted'|'prompt'|'denied'` (pattern at slide-recv.js:302).
- One-level enumeration (native, no existing helper): `for await (const [name, h] of dirHandle.entries()) if (h.kind==='file') { const f = await h.getFile(); /* f.size */ }`.
- `renderer/focus.js:60` `retainFocus(el, restoreTarget?)` — idempotent (WeakSet); focus-owning controls **require** `restoreTarget` or it throws.

### Testing standards
- Spec dir `www/tests/render/`; chromium project; `retries:1` is the ratified permanent flake policy (playwright.config.js:20–27) — do **not** add per-story `--workers=1`. [Source: E5/E6 retros]
- Boot-race guard: `await page.waitForFunction(() => window.__pullPane && typeof window.__pullPane.__getStateForTests === 'function')` before driving; `__resetForTests()` in `beforeEach`; `@fast` tag when no serial needed. [Source: www/tests/render/paste-toast.spec.js]
- For deterministic FSA states, inject a fake directory handle (a settable test seam) rather than a real picker — `showDirectoryPicker`/permission prompts can't run headless.

### Voice / microcopy (verbatim — do not paraphrase)
- Footer hint: **"Drag a filename selection here to pull"** · First-run: **"No folder chosen. Pulled files land here."** + **"Choose folder…"** · Permission: **"Permission needed to read this folder."** + **"Grant access"** · Empty: **"Empty — pulled files will appear here."** [Source: EXPERIENCE.md Voice and Tone + Pull pane states]

### Project Structure Notes
- Follows the established new-chrome-component pattern (`renderer/*.js` + `wireXxx` at the composition root + static markup in `index.html` + `www/tests` spec). Nearest precedents: **E4.1** (`status-bar.js`, a new fed component) and **E7.1** (`paste-toast.js`, a new transient in `#terminal-wrapper`). This is the **first** persistent gutter sibling of `#terminal-wrapper` — the layout flex-row change is the one genuinely new structural move; verify it doesn't disturb menu-bar/status-bar `align-self:stretch` or the canvas centering.
- No previous E9 story exists (S9.1a is first). Carry the standing conventions: mark story done in **all** places (sprint-status + front-matter); record the code-review outcome in this file; the setter-grab-bag watch (E4 #5, still `open`) — keep the pane's API lean.

### References
- [Source: epics-pull-pane.md — Story S9.1a; FR-1/2/3, NFR-2/4/5, UX-DR1/DR3]
- [Source: ARCHITECTURE-SPINE.md — AD-11 (amended), AD-1/2/3/9/10/12; Structural Seed (renderer/pull-pane.js); Capability→Architecture map]
- [Source: ux-designs/ux-beastty-2026-07-01/DESIGN.md — {components.pull-pane} token block + Components entry]
- [Source: ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md — Pull pane persistent-element entry, Component Pattern, State Pattern table, Voice/Tone, Flow 7]
- [Source: ux-designs/ux-beastty-2026-07-01/mockups/pull-pane.html — Frame A resting, Frame D first-run/permission/empty, Frame E rail]
- [Source: www/main.js:410–981 wiring; www/renderer/scroll-state.js; www/renderer/slide-chip.js; www/state/idb.js:51–92; www/transport/slide-recv.js:276–311; www/renderer/focus.js:60; www/index.html:1535–1579; www/tests/render/paste-toast.spec.js]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Code, bmad-dev-story workflow)

### Debug Log References

None — no HALT conditions triggered; implemented in a single pass.

### Completion Notes List

- **Shell only, clean extension points.** Delivered the docked pane, one-level file list, and the first-run / permission-needed / empty / list views. No refresh triggers, no timers, no focus/visibility listeners, no drop/compose/pull, no reverse drag — all deferred as scoped. `render()` is factored and `refresh` (= `bindFromIdb`) is exposed on the API so S9.1b can call it on a trigger without restructuring.
- **`view` state is content-only; `rail` is CSS.** The narrow-window rail is a `@container (max-width: 90px)` swap on `#pull-pane` (which is `container-type: inline-size`), so it composes with any content view and the badge always mirrors the file count. I deliberately did **not** make `rail` a JS `view` value (it's a responsive presentation, not a content state) — this keeps `render()` a pure content projector and the API lean (setter-grab-bag watch, E4 #5). Documented so it isn't read as an omission.
- **Zero terminal columns.** The stage is a flex row; `#terminal-wrapper` keeps `margin:16px auto` and `flex:0 0 auto` (never shrinks), so its auto margins absorb positive free space and re-center the canvas in the area left of the pane. The canvas is fixed-size, so it's never reflowed — the spec asserts `#terminal` width is byte-identical with the pane present vs removed. The pane yields first under pressure (`flex:0 1 312px`, `min-width:30px`) and collapses to the rail before it could ever steal a column.
- **One shared folder (AD-11).** The pane binds SLIDE-recv's persisted `recv_directory` handle via injected `idb.get/setRecvDirHandle` — no second destination. First-run `[Choose folder…]` writes the same key recv reads. Did not touch `slide-recv.js`'s internal `pickFolder()` (they stay consistent through the shared IDB key).
- **AD-3 strictly.** `pull-pane.js` direct-imports nothing from other app modules; idb, `retainFocus`, the `#pull-pane` root, and the terminal-wrapper all arrive via `wirePullPane(opts)`. It needs neither `canvas.js` nor `prefs.js` for S9.1a, so it imports neither (the allowlist permits them; they're simply unused here).
- **Does not throw on permission/read failure (AC-5).** `queryPermission`/`requestPermission`/`showDirectoryPicker`/`enumerate` are all wrapped; `AbortError` is swallowed (D-04). A post-`granted` read failure (folder vanished / revoked mid-read) degrades to the permission-needed view rather than throwing.
- **Test seam.** FSA picker + permission prompts can't run headless, so deterministic states are driven through `__setDirHandleForTests(fakeHandle)` with an in-page fake `FileSystemDirectoryHandle` (`name` / `queryPermission` / `requestPermission` / async-generator `entries`). The `[Choose folder…]` focus test stubs `window.showDirectoryPicker`. 8 specs, all `@fast`, pass first-try; full suite green under the ratified retries:1 policy.
- **Test-seam idb write is harmless.** In the choose-folder path a fake handle isn't structured-cloneable, so `idb.setRecvDirHandle` fails internally — but it already swallows errors (console.warn), so nothing throws and the enumerate proceeds. Playwright's per-test context isolates IndexedDB, so no cross-test leakage.

### File List

- **NEW** `www/renderer/pull-pane.js` — the pull-pane shell component (`wirePullPane`).
- **NEW** `www/tests/render/pull-pane.spec.js` — Playwright spec (8 tests, chromium project).
- **MODIFIED** `www/index.html` — `#stage` flex-row wrapper around `#terminal-wrapper` + new `#pull-pane` markup (sibling); `--chrome-*`-only pane CSS incl. the container-query rail.
- **MODIFIED** `www/main.js` — `import { wirePullPane }`; added `retainFocus` to the `focus.js` import; `wirePullPane({...})` wired after `wireStatusBar`, before `wireScrollState`; `window.__pullPane`.
- **MODIFIED** `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status ready-for-dev → in-progress → review; `last_updated`.

## Change Log

- 2026-07-23 — S9.1a implemented: docked pull-pane shell (first-run / permission / empty / list views), gutter flex-row layout (zero terminal columns), narrow-window rail, AD-3/AD-9/AD-10/AD-11/AD-12-compliant wiring, 8 Playwright specs. Status → review. (baseline `8f9c546`)

## Code Review

_(fill on completion: N findings, severity, fix sha — required before marking done per scripts/check-story-done-consistency.py)_
