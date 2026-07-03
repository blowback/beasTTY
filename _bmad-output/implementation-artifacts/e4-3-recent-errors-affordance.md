---
baseline_commit: 25ebd37e61dbf74e34f2267b62bc5b5e16765821
---

# Story E4.3: Recent-errors affordance

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator recovering from a port loss,
I want a recent-errors affordance in the bottom status bar,
so that I can see at a glance that something went wrong and jump straight to the error log without hunting through menus.

## Context & framing (read first)

**This is the last field in the E4 status bar — the third and final element in `#status-bar`.** E4.1 built the
bar + the connection group (`.sb-conn`); E4.2 built the right group (`.sb-right` — build SHA + zoom). E4.3 adds
the **recent-errors affordance**: a live error-count readout (`▲ N recent errors`) that sits **between**
`.sb-conn` and `.sb-right`, tints **amber only when errors exist**, and **opens the existing Serial
Configuration modal on click** (the modal that hosts `#error-log`). Do **not** rebuild the bar, re-wire the
connection projector, or touch the build/zoom right group.

**E4 is build-new, not relocation (E3 retro action #3).** Acceptance is defined against the spec
(FR-28 / UX-DR14 / AD-6), not against a v1.1 incumbent. There is no pre-existing status-bar error affordance to
relocate — the error *data* already exists (serial.js's `errorLog` ring-of-5, populated since E2.3), but the
status-bar *surface* is new here.

**The data source already exists; this story only surfaces + feeds it.** `transport/serial.js` keeps a private
`errorLog` array (ring of the last 5 entries, `ERROR_LOG_CAP = 5`, newest-first). Every error path calls the
single mutator `appendErrorLog(code, message)` (`serial.js:660`), which renders the newest-first list into
`#error-log` (the `<pre>` inside `#serial-config-modal`). Today nothing exposes a **count** or fires when the
log changes. E4.3 adds exactly that: a count getter for the initial paint and an imperative-push callback fired
on every append — then a status-bar field that renders the count and, on click, calls the **existing**
`openSerialConfig()` opener verbatim.

**AD-6 — fed, never owned.** The affordance holds no independent truth. It is fed the observer-less `errorLog`
via **imperative push**, exactly mirroring the E4.1 `onBootDeviceRecognized` precedent (serial.js fires an
injected callback → main.js closure → status-bar setter). It must **not** import `serial.js` or `modal.js`
(AD-3); the count feed and the modal opener both arrive through `wireStatusBar` opts.

| Field | Element | Writer | Feed |
|-------|---------|--------|------|
| Recent errors | `#status-errors` (**new**, between `.sb-conn` and `.sb-right`) | **`status-bar.js` (this story)** | `main.js` injects `onErrorLogChange:(n)=>statusBar.setErrorCount(n)` into `wireSerial`; `serial.js`'s `appendErrorLog` fires it with `errorLog.length`. Initial paint reads the injected `getRecentErrorCount` (0 at boot). |

**NFR-1 (focus retention, "Sacred") is triggered for the first time in the status bar.** E4.1/E4.2 added **no**
focusable controls; E4.3 adds the bar's **first interactive control** (the clickable affordance). Per AD-10 it
**must** use the shared `retainFocus(el)` helper so clicking it never steals keyboard focus from the terminal.
This is the one genuinely new concern this story introduces over E4.2 — do not skip it.

## Acceptance Criteria

**AC-1 — Affordance markup; `status-bar.js` is its sole writer (AD-6, NFR-4, DESIGN.md).**
A single focusable `#status-errors` control is added inside `#status-bar`, positioned **between** the existing
`.sb-conn` group and the `.sb-right` group (so the flex row reads: connection · errors · [margin-left:auto]
build/zoom — matching the mockup). It renders `▲ <n> recent error(s)` where `▲` is **U+25B2** (BLACK
UP-POINTING TRIANGLE) and `<n>` is the live count. `status-bar.js` is the **single writer** of this field (AD-6
— it holds no independent truth). The bar renders **identically** under Console and CRT (no phosphor var, no
`[data-theme]` branch — AD-9).

**AC-2 — Live count, fed by imperative push; amber only when errors exist (FR-28, UX-DR14, AD-6).**
`status-bar.js` exposes `setErrorCount(n)` (the AD-6 imperative-push hook for the observer-less `errorLog`).
Its `textContent` reads `▲ 0 recent errors` at boot (default, count 0) and updates live to the current count
each time an error is appended (e.g. `▲ 1 recent error`). The field is tinted with **`var(--status-amber)`
only while the count > 0**; at 0 it is the bar's `var(--chrome-muted)` default — amber means "action required,
not error" (DESIGN.md), spent here only when there is something to see. Amber vs muted is toggled via a
`data-*` attribute (e.g. `data-has-errors`), **never** an inline style. The initial paint reads the injected
`getRecentErrorCount()` (0 at boot; serial.js has not run any connect attempt yet), so the field is correct at
first paint without waiting for a push.

**AC-3 — Click opens the Serial Configuration modal, reusing E2.3 verbatim (FR-28, AD-8, AD-3).**
Activating `#status-errors` (mouse click or keyboard) calls the **existing** `openSerialConfig()` opener —
injected into `wireStatusBar` opts (status-bar.js must **not** import `modal.js`/`serial.js` — AD-3). That
opener (`main.js:233`) was explicitly shaped "so E4's status-bar recent-errors affordance can reuse it
verbatim": it `openModal`s `#serial-config-modal` with `initialFocus = #serial-baud`, `restoreTo =
terminalWrapper`. The `#error-log` the user came to read lives inside that modal. No new opener, no bespoke
focus target — reuse the one that exists.

**AC-4 — Focus retention on the bar's first interactive control (NFR-1, AD-10, UX-DR9 "Sacred").**
`#status-errors` uses the shared `retainFocus(el)` helper (`renderer/focus.js`) so a **mouse click** never
transfers keyboard focus off the terminal (the button branch: `mousedown → preventDefault`; the click handler
still fires and opens the modal). On modal **close**, focus round-trips to the terminal via the opener's
`restoreTo = terminalWrapper` (E2.3, unchanged). Net: opening the log via the affordance and closing it leaves
focus back on `#terminal-wrapper`, and keystrokes never stall.

**AC-5 — Test coverage (AD-2, NFR-6).**
`www/tests/render/status-bar.spec.js` is extended (E4.3 describe blocks) to prove:
- Initial `#status-errors` reads `▲ 0 recent errors`, `data-has-errors` is falsey, computed colour is the muted
  default (not amber), and there is **exactly one**, inside `#status-bar`, **not** inside `.sb-right`.
- Driving a **real** error (reuse the E2.3 seam: override `p.open` to throw, then click `#connect-button` —
  see `tests/render/serial-config-modal.spec.js:145-160`) flips the field to `▲ 1 recent error`,
  `data-has-errors="true"`, and the computed colour to `var(--status-amber)` (`#e0b030`).
- Clicking `#status-errors` opens `#serial-config-modal` (dialog visible) with focus on `#serial-baud`
  (proving the E2.3 opener was reused), and `#error-log` inside shows the appended error.
- Focus retention: after opening **and closing** the modal via the affordance, `document.activeElement` is
  `#terminal-wrapper`; and `window.__focus.__getStateForTests()` registers `#status-errors` (button branch).
- The affordance renders identically across a `[data-theme]` flip (mirror the E4.1/E4.2 CRT↔Console assertion).

Run the full suite; treat any wasm-boot-under-parallelism flake as the ratified `chromium-transport` +
`retries:1` mask — do **not** re-diagnose per-story.

**Cross-cutting (from epics, stated once):** uses only `var(--chrome-*)`/`var(--status-*)` tokens (NFR-2); no
new dependencies / no build step (NFR-5); `window.__statusBar` + `__getStateForTests` extended for the new
field (NFR-6).

## Tasks / Subtasks

- [x] **Task 1 — Add the `#status-errors` affordance markup + CSS** (AC-1, AC-2)
  - [x] In `www/index.html`, inside `<footer id="status-bar">`, insert **between** the `.sb-conn` span and the
        `.sb-right` span: `<button type="button" id="status-errors">▲ 0 recent errors</button>` (`▲` = U+25B2).
        The placeholder text avoids a layout flash before the initial paint. Use a `<button>` for native
        keyboard activation + focusability (do not use a bare `<span>` with `role`/`tabindex` — a real button
        is the AD-10 focus-helper's happy path and gives free Enter/Space).
  - [x] Add CSS after the `.sb-right` rule. Reset the native button chrome so it reads as inline bar text:
        `#status-bar #status-errors { appearance: none; -webkit-appearance: none; background: none; border: 0;
        padding: 0; margin: 0; font: inherit; color: var(--chrome-muted); cursor: pointer; }` and the amber
        state: `#status-bar #status-errors[data-has-errors="true"] { color: var(--status-amber); }`. **No** new
        tokens, **no** `[data-theme]` branch (AD-9). `.sb-conn` / `.sb-right` / `#port-status` untouched. (The
        `#status-bar gap: 16px` already spaces it from its neighbours.)
- [x] **Task 2 — Add the errors field + click wiring to `status-bar.js`** (AC-1, AC-2, AC-3, AC-4)
  - [x] Import `retainFocus` from `./focus.js` (the AD-10 shared helper — the same import chrome.js uses; update
        the module header's "imports ONLY state/prefs.js" note to include the AD-10 focus helper).
  - [x] Grab `#status-errors` by id in `wireStatusBar(opts)` alongside the existing grabs; store as
        module-scope `errorsElRef`, null-guarded.
  - [x] Destructure two new opts: `openSerialConfig` (the E2.3 opener) and `getRecentErrorCount` (serial's count
        getter); store as `openSerialConfigFn` / `getRecentErrorCountFn`, null-guarded.
  - [x] Add `setErrorCount(n)`: coerce `const c = n | 0`; `errorsElRef.textContent = \`▲ ${c} recent ${c === 1
        ? 'error' : 'errors'}\``; `errorsElRef.dataset.hasErrors = c > 0 ? 'true' : 'false'`. Null-guarded.
  - [x] Wire the click: a named module handler `() => { if (openSerialConfigFn) openSerialConfigFn(); }` added
        to `errorsElRef`. **Mirror the `connUnsub` re-wire discipline** — remove the prior click listener (keep
        its ref) before adding, so an idempotent re-wire never stacks duplicate openers. Then `retainFocus(
        errorsElRef)` (button branch — no `restoreTarget` needed; `retainFocus` is idempotent via its own
        WeakSet, so a re-wire is a safe no-op there).
  - [x] **Initial paint** inside `wireStatusBar`: `setErrorCount(getRecentErrorCountFn ? getRecentErrorCountFn()
        : 0)` (0 at boot). Do it near the E4.2 initial zoom paint.
  - [x] Return `setErrorCount` on the `wireStatusBar` API object. Extend `__getStateForTests()` with `errors`
        (the textContent) + `hasErrors` (the dataset flag); extend `__resetForTests()` to revert the field to
        `▲ 0 recent errors` / `data-has-errors="false"`.
- [x] **Task 3 — Expose the count + change-feed in `serial.js`** (AC-2)
  - [x] Add `export function getRecentErrorCount() { return errorLog.length; }` near `getLastConnectError`
        (`serial.js:510`).
  - [x] Add an injected `onErrorLogChange` opt to `wireSerial` (destructure + `onErrorLogChangeFn = onErrorLogChange
        || null`, mirroring `onBootDeviceRecognized`). Fire it at the end of `appendErrorLog` **after**
        `renderErrorLog()`: `if (onErrorLogChangeFn) onErrorLogChangeFn(errorLog.length);`. Do not change the
        ring-cap logic or the `#error-log` render.
- [x] **Task 4 — Wire the feed + opener at the composition root** (AC-2, AC-3)
  - [x] Add `getRecentErrorCount` to the `serial.js` import in `main.js` (`main.js:87`).
  - [x] In the `wireStatusBar({...})` call (`main.js:466`), inject `openSerialConfig` (already defined at
        `main.js:233`) and `getRecentErrorCount`.
  - [x] In the `wireSerial({...})` call (`main.js:1133`), inject `onErrorLogChange: (count) =>
        statusBar.setErrorCount(count)` — `statusBar` is already in scope (mirror the adjacent
        `onBootDeviceRecognized: () => statusBar.showBootReady()` at `main.js:1166`).
- [x] **Task 5 — Tests** (AC-5)
  - [x] Extend `www/tests/render/status-bar.spec.js` with the E4.3 describe blocks (initial state, amber-on-error
        via the E2.3 open-throw seam, click-opens-modal-focused-on-baud, focus round-trip, singleton +
        containment, CRT↔Console identical). Reuse the existing `ready(page)` helper; drive the error exactly as
        `serial-config-modal.spec.js:145-160` does.
  - [x] Run the full suite; record the count and any `chromium-transport` flakes healed by `retries:1`.

## Dev Notes

### Architecture compliance — the governing decisions (verbatim intent)

- **AD-6 — Status bar is fed, never owned.** `status-bar.js` holds no independent truth (single-writer per
  field). The `errorLog` is an **observer-less** source (like zoom, build, boot-device) → **imperative push**:
  "the module that owns the mutation imperatively pushes via the status-bar API … at the same point it calls the
  setter." serial.js owns `appendErrorLog`; it fires the injected `onErrorLogChange`, and main.js's closure
  calls `statusBar.setErrorCount`. This is the **exact** shape of E4.1's `onBootDeviceRecognized →
  statusBar.showBootReady` — copy it, don't invent.
- **AD-3 — Direct-import allowlist.** A new chrome module may import **only** `renderer/canvas.js` setters and
  `state/prefs.js` directly — *plus* the shared leaf helpers the spine mandates (`focus.js`/`retainFocus`,
  AD-10; `modal.js`/`openModal`, AD-8), which are how chrome units are *supposed* to compose (chrome.js already
  imports `focus.js`). So importing `retainFocus` is compliant; importing `serial.js` or `modal.js` is **not** —
  the count feed (`onErrorLogChange`/`getRecentErrorCount`) and the modal opener (`openSerialConfig`) both
  arrive via `wireStatusBar` opts, injected by main.js.
- **AD-8 — Modal helper.** `openSerialConfig()` already wraps `openModal(#serial-config-modal, { initialFocus:
  #serial-baud, restoreTo: terminalWrapper })`. Reuse it verbatim; do not hand-roll a `.showModal()`.
- **AD-10 — Shared `retainFocus`.** Mandatory on **every** new interactive chrome control. `#status-errors` is a
  button → the `mousedown → preventDefault` branch (no `restoreTarget` argument). Without this, clicking the
  affordance steals focus from the terminal — a silent "Sacred" (NFR-1/UX-DR9) regression.
- **AD-9 — Neutral shell.** Only `var(--chrome-*)`/`var(--status-*)` tokens; no phosphor var, no `[data-theme]`
  branch. The `#status-bar` block already pins `--chrome-bg/fg/accent` for CRT↔Console parity — the new field
  needs no extra pin.
- **AD-12 — Boot order (already satisfied).** `status-bar` is wired at the `wireChrome` seam after `wireMenuBar`,
  before `wireKeyboard` (E4.1), and **before** `await wireSerial` — so `const statusBar` (`main.js:466`) is in
  scope when the `wireSerial` opts closure references it (same as `onBootDeviceRecognized`). E4.3 adds no new
  wire call.
- **Consistency conventions:** element ids kebab-case, feature-prefixed (`#status-errors`); visual state via
  text/`data-*`, never inline styles; getters read **at use-time**. `▲` is a literal U+25B2, not `^`.

### Exact integration points (read these files before coding)

**`www/renderer/status-bar.js` — the module to extend:**
- Header comment (`:1-27`) states "imports ONLY state/prefs.js" — update to add the AD-10 focus helper.
- Field grabs at `status-bar.js:177-180` (`status-conn-dot` / `port-status` / `status-build` / `status-zoom`) —
  add `errorsElRef = document.getElementById('status-errors')` alongside.
- Opts destructure at `:168-174` — add `openSerialConfig`, `getRecentErrorCount`.
- The `connUnsub` drop-before-resubscribe idiom (`:187-193`) is the pattern to mirror for the click listener's
  idempotent re-wire.
- Initial-paint block (`:196-201`, zoom pre-paint) — add the initial `setErrorCount` paint here.
- Returned API object (the `return { … setBuild, setZoom, dispose, __getStateForTests, __resetForTests }`) — add
  `setErrorCount`.
- `__getStateForTests` / `__resetForTests` — extend both (add `errors` + `hasErrors`; reset to the 0/false
  placeholder).
- `setBuild`/`setZoom` (`:148-163`) are the sibling writers to copy the shape from (null-guard, `dataset`/text
  only).

**`www/transport/serial.js` — the count getter + change feed:**
- `errorLog` is declared at `:60`; `ERROR_LOG_CAP = 5` at `:45`; `appendErrorLog` at `:660-676` is the **single**
  mutator (every error path routes through it — `open-failed`, `port-in-use`, `auto-connect-failed`,
  `permission-revoked`, `read-error`, `multiple-adapters`, `reopen-failed`, `dtr-deassert-failed`). Fire the
  callback once, at the end, after `renderErrorLog()`.
- `wireSerial` opts destructure at `:120-131`; injected-dep assignments at `:132-143` (`onBootDeviceRecognizedFn`
  is the precedent to copy). Add `onErrorLogChange`.
- Getters cluster at `:482-536` (`getState`, `getActiveFraming`, `getLastConnectError`, `getConnectionDevice`) —
  add `getRecentErrorCount` here.

**`www/main.js` — the composition root:**
- serial.js import at `:87` — add `getRecentErrorCount`.
- `openSerialConfig` defined at `:233` (zero-arg opener; comment at `:230` already anticipates this reuse).
- `wireStatusBar({...})` at `:466-482` — add `openSerialConfig` + `getRecentErrorCount` opts.
- `wireSerial({...})` at `:1133`, with `onBootDeviceRecognized: () => statusBar.showBootReady()` at `:1166` —
  add `onErrorLogChange: (count) => statusBar.setErrorCount(count)` right beside it.

**`www/index.html` — the markup + CSS:**
- Status-bar footer markup at `:1995-2010`; the comment at `:2005` ("E4.3's recent-errors affordance slots in
  here later") marks the **exact** insertion point — between `.sb-conn` and `.sb-right`.
- Status-bar CSS block at `:154-190`; add the `#status-errors` rules after the `.sb-right` rule (`:178`).
- Tokens at `:50-54`: `--chrome-muted` (rgba .6) and `--status-amber` (`#e0b030`) already exist — reuse, add
  none.

### UX contract — exact tokens & copy (do not paraphrase)

- Mockup reference (`mockups/key-screen-chrome.html:170`): `<span class="errlink">▲ 0 recent errors</span>`,
  placed between `.sb-device` (connection) and `.sb-right` (build/zoom). `.errlink{color:var(--status-amber)}`
  in the mock is the **errors-present** styling — **the spec wins**: default is muted `--chrome-muted`, amber
  **only** when count > 0 (FR-28 "amber when errors are present"; DESIGN.md amber = "action required, not
  error", not a permanent tint).
- **Copy:** `▲ <n> recent error(s)`. `▲` = **U+25B2**. Pluralise: `1 recent error`, else `N recent errors`
  (default; see Open Questions if you'd rather match the mock's always-plural literal).
- **Always visible, including at 0.** The affordance shows the live count at all times (the mock's
  "Not connected" variant omits it only as an abbreviated illustration; FR-28's own example is the 0-count form
  "0 recent errors"). It is **not** hidden when the count is 0.
- Tokens: reuse only `--chrome-muted` (default) + `--status-amber` (errors). Introduce none (NFR-2). Font:
  `font: inherit` (the bar's 12px monospace `hint` role).
- Voice/placement: quiet and muted until something breaks; amber is the single "look here" cue. Accent
  (`--chrome-accent`) is **not** used — accent is spent on focus/selection/primary-buttons/links (UX-DR1); the
  errors cue is status-amber, not accent.

### Testing standards

- Playwright chromium suite under `www/tests/` — extend `tests/render/status-bar.spec.js` (E4.1 + E4.2 tests
  today; add an E4.3 group).
- `ready(page)`: `await page.waitForFunction(() => window.__statusBar && typeof
  window.__statusBar.__getStateForTests === 'function')` (existing helper in the spec).
- **Drive a real error** (do not fake the DOM): reuse the E2.3 seam verbatim —
  `tests/render/serial-config-modal.spec.js:145-160` overrides `navigator.serial.requestPort` so the returned
  port's `open` throws, then clicks `#connect-button`; `appendErrorLog('open-failed', …)` fires → the count
  becomes 1 → your `onErrorLogChange` push updates `#status-errors`. `tests/transport/errors.spec.js` has more
  error-code seams if you want a second entry.
- Amber assertion: compare `getComputedStyle(el).color` to the `--status-amber` rgb (`rgb(224, 176, 48)`); at 0
  it must equal the muted default (`rgba(255, 255, 255, 0.6)`), not amber.
- Focus assertions: `window.__focus.__getStateForTests()` (from `renderer/focus.js`) lists retained elements;
  the round-trip proof is `document.activeElement === #terminal-wrapper` after opening+closing the modal via the
  affordance.
- Flake policy: `chromium-transport` project + `retries:1` is the **ratified mask** — no per-story `--workers=1`,
  no re-diagnosis of the wasm-boot-under-parallelism flake.

### Previous-story intelligence (E4.1 + E4.2 + E1–E3)

- **E4.1 built the `onBootDeviceRecognized → showBootReady` push you are copying.** serial.js fires an injected
  callback; main.js's closure calls a status-bar setter; the two modules never import each other. `setErrorCount`
  is the same shape as `showBootReady`/`setBuild`/`setZoom` — a null-guarded setter on the returned API, fed at
  the composition root. Don't build new machinery.
- **E4.2 explicitly left this seam open.** Its scope-boundary note: "Recent-errors affordance → E4.3 … E4.3 adds
  a third element to `.sb-right` (or its own group) — leave room but don't build it," and "NFR-1 focus-retention
  is not triggered — E4.2 adds no focusable controls; the errors affordance's clickable link is E4.3." → **This
  story is where NFR-1/AD-10 first bites in the status bar.** The mockup places the affordance as its **own
  span between `.sb-conn` and `.sb-right`**, not inside `.sb-right` — follow the mockup.
- **The injected-opt / DOM-projector seam has held for four epics.** Don't `import serial.js`/`modal.js` from
  `status-bar.js`; deps arrive via opts/push.
- **`openSerialConfig` was designed for exactly this reuse** (`main.js:230` comment). Do not add a second opener
  or a bespoke focus target — the AC's "focused appropriately (reusing E2.3)" means *reuse it as-is* (baud
  focus).
- **Fill the Code Review section before marking done** (E2 action #2 / E3 action #2 / E4.1 done-gate — no story
  reaches `done` with the review section unfilled). Run the independent `code-review` workflow in a fresh
  context with a different LLM; record: N findings (severity), fixed in `<sha>`.

### Project Structure Notes

- Edits only — **no new files**: `www/index.html` (add the `#status-errors` button + 2 CSS rules),
  `www/renderer/status-bar.js` (add the errors field + `setErrorCount` + click wiring + `retainFocus` +
  introspection; new import of `retainFocus`), `www/transport/serial.js` (add `getRecentErrorCount` +
  `onErrorLogChange` fire), `www/main.js` (inject 3 opts across two wire calls; extend one import),
  `www/tests/render/status-bar.spec.js` (extend).
- No changes to `menu-bar.js`, `chrome.js`, `canvas.js`, `prefs.js`, `modal.js`, `focus.js`,
  `#serial-config-modal` markup, or `#error-log` — all already expose what this story consumes.
- No new dependencies, no build step (static ESM, Chromium ≥ 89).
- **E7 dual-chrome checklist (keep current — retro action #4):** E4.3 adds no `<details>`/`#top-bar`
  dependency; it plugs into `#status-bar` only. The `#error-log` it links to already lives in
  `#serial-config-modal` (moved out of the `<details id="connection">` pane in E2.3). After E4.3 the E4 status
  bar is **feature-complete** (connection · errors · build · zoom); `epic-e4-retrospective` is `optional`.

### Scope boundaries (do NOT build here)

- **Do not restyle or re-wire the connection field / dot** (E4.1) or the build/zoom right group (E4.2). No
  changes to `projectConnection`, `#port-status`, `#status-conn-dot`, `#status-build`, `#status-zoom`, or their
  CSS.
- **Do not change the `#error-log` render, the ring-cap (5), or the error copy/codes** in serial.js — only add a
  count getter + a change-feed callback. `appendErrorLog`'s existing behavior (render + `console.error`) is
  unchanged.
- **Do not build a new modal or a bespoke error view.** The affordance opens the **existing**
  `#serial-config-modal` via the **existing** `openSerialConfig()`. `#error-log` is already inside it.
- **Do not auto-open the modal on error.** E2.3 deliberately removed the D-27 auto-expand — an error while the
  user is elsewhere must never steal the top layer. The affordance is the *deliberate* path; the red-border
  Connect signal (menu-bar, unchanged) stays the primary "something's wrong" cue.
- **Do not add `aria-live` to the affordance** by default (see Open Questions) — it duplicates the amber cue and
  could be noisy; the count is available on focus and the connection region already announces.

### Open Questions (for Ant — non-blocking; story ships with the noted default)

1. **Count-feed shape — getter + push vs push-only.** Default chosen: **inject both** `getRecentErrorCount`
   (initial paint) **and** `onErrorLogChange` (live push), mirroring the connection field's `getConnectionState`
   + `onConnectionStateChange` split — most symmetric + most testable. Since `status-bar` wires before
   `wireSerial` and `errorLog` is empty at boot, a push-only variant with a hard `▲ 0 recent errors` initial
   paint would also work; the getter is the robustness/symmetry choice (survives idempotent re-wire after
   errors, lets tests assert initial state deterministically). Flag if you'd rather drop the getter.
2. **Modal focus on open — reuse baud focus vs focus the error log.** Default chosen: **reuse `openSerialConfig`
   verbatim** (focus `#serial-baud`), per the AC's "reusing E2.3" and the opener's stated intent. Alternative:
   a variant that scrolls/focuses toward `#error-log` (a `<pre>`, not natively focusable — would need
   `tabindex="-1"` + `.focus()`), so a user arriving *from the errors affordance* lands on the log rather than
   the top of the form. Non-blocking; flag if you want the log-focused variant.
3. **Pluralisation — "1 recent error" vs mock's always-plural.** Default chosen: **proper pluralisation**
   (`1 recent error` / `N recent errors`). The mock only ever shows the 0-count plural. One-line change if you
   prefer the literal always-plural form.
4. **Visibility at 0 — always shown vs hidden until first error.** Default chosen: **always visible** showing the
   live count (incl. 0), per FR-28's `▲ 0 recent errors` example. Flag if you'd rather it appear only once an
   error exists.

### References

- [Source: epics.md#Story-E4.3] — story statement + AC (FR-28; UX-DR14).
- [Source: epics.md:59] FR-28 — "Recent-errors affordance — live count + `▲` glyph + label (amber when errors);
  opens Serial Config modal. *(E4)*"; [epics.md:109] UX-DR14 status-bar composition (fed, holds no independent
  truth).
- [Source: ARCHITECTURE-SPINE.md#AD-6] status bar fed/never-owned, imperative push for observer-less sources;
  [#AD-3] import allowlist; [#AD-8] `openModal` helper; [#AD-10] shared `retainFocus`; [#AD-9] neutral shell;
  [#AD-12] boot order (already satisfied).
- [Source: DESIGN.md:136,195,210] amber (`#e0b030` / `--status-amber`) = "action required, not error"; slim
  status bar, `chrome-muted` text; accent reserved for focus/selection/links (UX-DR1).
- [Source: mockups/key-screen-chrome.html:90-92,170,222-223] `.errlink` between `.sb-device` and `.sb-right`;
  `▲ 0 recent errors`.
- [Source: e4-2-build-sha-zoom-readout.md] the `.sb-right` group + `status-bar.js` API shape this story extends,
  and its scope note reserving the errors affordance for E4.3.
- [Source: e4-1-connection-device-baud-readout.md] the `onBootDeviceRecognized → showBootReady` imperative-push
  precedent this story copies for the error feed.
- [Source: www/renderer/status-bar.js:1-27,148-201] header import note, `setBuild`/`setZoom` sibling writers,
  field grabs, opts destructure, initial paint, `connUnsub` re-wire idiom, returned API + test hooks.
- [Source: www/renderer/focus.js:60-88] `retainFocus(el, restoreTarget?)` — button branch (`mousedown →
  preventDefault`), idempotent WeakSet guard; `__getStateForTests` registry.
- [Source: www/transport/serial.js:45,60,120-143,482-536,660-676] `ERROR_LOG_CAP`, `errorLog`, `wireSerial`
  opts + `onBootDeviceRecognizedFn` precedent, getters cluster, `appendErrorLog` single mutator.
- [Source: www/main.js:87,230-240,466-482,1133,1166] serial import, `openSerialConfig` opener + reuse comment,
  `wireStatusBar` call, `wireSerial` call + `onBootDeviceRecognized` sibling.
- [Source: www/index.html:50-54,154-190,1995-2010] tokens, status-bar CSS, footer markup + the E4.3 insertion
  comment.
- [Source: www/tests/render/serial-config-modal.spec.js:145-160] the `p.open`-throws error-driving seam to reuse;
  [www/tests/render/status-bar.spec.js] the spec to extend.
- [Source: E3 retro §6 + action 3] E4 build-new framing (spec-based acceptance, not incumbent).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- Full Playwright suite: **498 passed, 1 skipped, 3 flaky** (healed on retry). The 3 flaky specs
  (`theme-toggle`, transport `lifecycle`, transport `slide-autosend-safety`) are the ratified
  `chromium-transport` + `retries:1` wasm-boot-under-parallelism mask — none touch E4.3 code and none were
  re-diagnosed per the story's flake policy.
- `tests/render/status-bar.spec.js` in isolation: 23 passed (16 existing E4.1/E4.2 + 7 new E4.3).

### Completion Notes List

- **AC-1** — Added a single focusable `<button id="status-errors">` inside `#status-bar`, positioned **between**
  `.sb-conn` and `.sb-right` (its own top-level bar child, not nested in the right group), rendering
  `▲ <n> recent error(s)` (`▲` = U+25B2). `status-bar.js` is the sole writer. Native button chrome reset to read
  as inline muted bar text; no `[data-theme]` branch (AD-9) — proven identical across a theme flip.
- **AC-2** — Added `setErrorCount(n)` (AD-6 imperative-push hook): coerces `n | 0`, pluralises 1 vs N, and
  toggles `data-has-errors` (never inline style). CSS tints `var(--status-amber)` only while
  `data-has-errors="true"`; muted `var(--chrome-muted)` at 0. Initial paint reads the injected
  `getRecentErrorCount()` (0 at boot).
- **AC-3** — Click reuses the injected E2.3 `openSerialConfig()` verbatim (focus → `#serial-baud`,
  restoreTo → terminal). `status-bar.js` imports neither `modal.js` nor `serial.js` (AD-3); both the opener and
  the count getter arrive via `wireStatusBar` opts.
- **AC-4** — `retainFocus(errorsElRef)` on the button (AD-10, the bar's first interactive control — mousedown →
  preventDefault branch). Click re-wire mirrors the `connUnsub` drop-before-resubscribe discipline so an
  idempotent re-wire never stacks duplicate openers. Round-trip proven: open+close via the affordance leaves
  focus on `#terminal-wrapper`.
- **AC-5** — Extended `status-bar.spec.js` with E4.3 describe blocks (initial 0/muted/singleton/containment,
  amber-on-real-error via the E2.3 open-throw seam, click-opens-modal-focused-on-baud + `#error-log` populated,
  focus round-trip + button-branch registry, CRT↔Console parity). `__getStateForTests`/`__resetForTests`
  extended with `errors` + `hasErrors`.
- **serial.js** — Added `getRecentErrorCount()` getter and the injected `onErrorLogChange` opt, fired at the end
  of `appendErrorLog` (after `renderErrorLog`) with `errorLog.length`. Ring-cap logic and the `#error-log` render
  are unchanged.
- **main.js** — Extended the serial import with `getRecentErrorCount`; injected `openSerialConfig` +
  `getRecentErrorCount` into `wireStatusBar`, and `onErrorLogChange: (count) => statusBar.setErrorCount(count)`
  into `wireSerial` (beside the `onBootDeviceRecognized` sibling).
- No new files, no new dependencies, no build step, no new tokens (reused `--chrome-muted` / `--status-amber`).

### File List

- `www/index.html` — added the `#status-errors` button between `.sb-conn` and `.sb-right`; added 2 CSS rules
  (button reset + amber `data-has-errors="true"` state).
- `www/renderer/status-bar.js` — new `retainFocus` import; errors field refs/opts; `setErrorCount(n)`; click
  wiring + re-wire discipline + `retainFocus`; initial paint; `setErrorCount` on the API; extended
  `__getStateForTests`/`__resetForTests`; updated header import note.
- `www/transport/serial.js` — added `getRecentErrorCount()`; added `onErrorLogChange` opt + fire in
  `appendErrorLog`.
- `www/main.js` — extended serial import; injected `openSerialConfig` + `getRecentErrorCount` into
  `wireStatusBar`; injected `onErrorLogChange` into `wireSerial`.
- `www/tests/render/status-bar.spec.js` — added the E4.3 describe blocks + selectors/colour constants.

### Code Review

Run — **findings fixed in `8d2795e`.** Independent `code-review` workflow completed before the story advanced
to `done`; the resulting fixes were folded into the story commit `8d2795e` (touched `menu-bar.js` +
`serial.js` beyond base scope). (Backfilled 2026-07-03 during the E4 retro — the review was run and fixed at
the time but the outcome was never recorded here; see E4 retro §4.)

### Change Log

- 2026-07-03 — Story context created (bmad-create-story). Status → ready-for-dev.
- 2026-07-03 — Implemented E4.3 recent-errors affordance (Tasks 1–5): `#status-errors` button + CSS, `status-bar.js`
  `setErrorCount` + click/`retainFocus` wiring, `serial.js` `getRecentErrorCount` + `onErrorLogChange` feed,
  `main.js` composition-root wiring, and 7 new Playwright tests. Full suite 498 passed / 1 skipped / 3 ratified
  flakes. Status → review.
