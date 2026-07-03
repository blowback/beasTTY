---
baseline_commit: 63f5b245a8e09c261eb41ef1fb818476b224a234
---

# Story E2.3: Serial Configuration modal

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want a Serial Configuration modal for baud and flow settings plus a recent-errors log,
so that I can tune the port and diagnose a lost connection in one place.

**Covers:** FR-15 (Serial Configuration modal); UX-DR10 (verbatim hardware-literate microcopy), UX-DR11 (a11y floor). **Epic:** E2 · Connection & Serial Configuration. **Depends on:** E0 (`openModal`, `retainFocus` — done), E1 (menu-bar shell — done), E2.1/E2.2 (Connection menu items — done).

**Premise (epic-wide, confirmed — same as E2.1/E2.2):** this is a **relocation** story, not a build-from-scratch. Every serial-config control, its `<option>` set, its verbatim copy, its persist/apply behavior, the reconnect-required hint, and the `#error-log` ring **already exist and work today** inside the legacy `<details id="connection">` pane (`index.html:1205–1272`), wired by `serial.js` via injected `serialConfigEls`/`errorLogEl` refs. E2.3 **moves that exact control set into a new `openModal`-driven `<dialog>`**, re-styled onto the neutral `--chrome-*` token system (AD-9), opened from the existing "Serial Configuration…" menu item (`index.html:993–995`, currently an inert placeholder). **No change to the serial state machine, the config read/apply timing ("takes effect on next Connect"), the prefs schema, or the verbatim copy.**

**Relocation strategy — MOVE, do not duplicate (recommended default; flagged Q1).** Because `serial.js` reads a **single** injected ref set by element **id** (`getElementById('serial-baud')`, etc. in `main.js`), the cleanest, single-source approach is to **move the same-id elements** out of the `<details>` pane and into the `<dialog>`. The refs still resolve (ids unchanged) → near-zero `serial.js` change. This produces **one** home for serial config (no dual-chrome, no lockstep — the opposite of a duplicate-and-mirror), which is exactly what E1 retro action #5 ("dual-chrome is never shipped mid-migration") wants. See Dev Notes §"Relocation strategy" for the alternative (duplicate+mirror, rejected) and Q1.

## Acceptance Criteria

Verbatim epic ACs (`epics.md` §Story E2.3, lines 415–424) decomposed and made testable. AC-1/AC-9 are the epic's two ACs; AC-2…AC-8 make the implicit "every control/copy is preserved verbatim, apply-timing unchanged, the log/reconnect behaviors survive the move, focus round-trips, no regressions" requirements falsifiable.

**AC-1 — The modal opens from the Connection menu via `openModal`, menu closes, focus round-trips (FR-15, AD-8, AD-3).**
Given the Connection menu is open and its "Serial Configuration…" item (`index.html:993–995`),
When the user activates it,
Then the dropdown **closes** (`window.__menuBar.getOpenMenu() === null`) and a `<dialog id="serial-config-modal">` opens via the shared `openModal(dialogEl, {initialFocus, restoreTo})` helper (top-layer `showModal()`, native scrim + focus-trap); and on close (Close button **or** Esc) focus is restored to `#terminal-wrapper` per the helper's `restoreTo`. The modal opener is injected into `wireMenuBar` opts (AD-3 — menu-bar must not import `modal.js`/`serial.js`), mirroring E1.5's `confirmClearScrollback`.

**AC-2 — The modal hosts all five serial selects with their exact option sets, moved verbatim (FR-15).**
Given the open modal,
Then it exposes `#serial-baud` (300/1200/2400/4800/9600/**19200 default**/38400/57600/115200), `#serial-databits` (7/**8**), `#serial-stopbits` (**1**/2), `#serial-parity` (**none→"None"**/even→"Even"/odd→"Odd"), `#serial-flowctl` (**none→"None"**/hardware→"Hardware (RTS/CTS)") — **same ids, same `<option value>`s, same selected defaults** as the legacy pane (`index.html:1211–1248`), so `serial.js`'s injected refs and `readFormConfig()` keep working unchanged. Each select's `.value` is set from `getPrefs().serial.*` on boot/reset by the existing `applyPrefs` mirror.

**AC-3 — The two toggles + Reset button are present with their verbatim hint copy (FR-15, UX-DR10).**
Given the open modal,
Then it exposes `#show-all-serial-devices` (checkbox, default **unchecked**) with its verbatim hint ("Off by default — the picker only lists the Silicon Labs CP2102N…Takes effect on the next Connect click."), `#serial-assert-rts-on-connect-checkbox` (checkbox, default **checked**) with its verbatim RTS/CTS hardware explanation ("On by default. The MicroBeast's Z80 UART uses host-side RTS as its CTS input for hardware auto-flow-control — without this, Z80→PC transmits…Takes effect on the next Connect click."), and `#serial-reset-preset` ("Reset to MicroBeast preset") — all with the **same ids** so their existing `change`/`click` wiring (chrome.js / main.js / serial.js) resolves after the move. Copy is byte-for-byte identical to `index.html:1256, 1261, 1251`.

**AC-4 — The default hint, single-tab note, and Recent-errors log are present verbatim (FR-15, UX-DR10, UX-DR11).**
Given the open modal,
Then it shows the hint "MicroBeast default is 19200 8N1, no flow control. Single-tab ownership is enforced by Chromium — close any other Beastty tab that holds this port first." (verbatim, `index.html:1266`), and a Recent-errors log `<pre id="error-log">` that defaults to "(no recent errors)" and renders `HH:MM:SS code: message` entries newest-first (unchanged `renderErrorLog()` behavior). The `#error-log` **id is preserved** so `serial.js`'s `errorLogEl` ref and ring-of-5 population keep working.

**AC-5 — Changing a serial value while connected surfaces the reconnect hint (FR-15 — epic AC-2).**
Given the port is `connected` and the modal is open,
When the user changes any of the five selects to a value differing from the live connection's config,
Then the hint "Config changed — Disconnect and Connect to apply" appears (`#serial-reconnect-hint`, unchanged `showReconnectHint()` string literal `serial.js:363`); and Reset-to-preset or reverting the change clears it. This is the existing `serial.js:263–284` listener — it must keep firing after the elements move (same ids, same injected `reconnectHintEl` ref).

**AC-6 — The error-log auto-expand is neutralized; errors accumulate silently in the modal (FR-15, AD-6).**
Given `appendErrorLog()` currently force-opens the `<details>` pane (`serial.js:618` `connectionPane.open = true`),
When an error is logged after the log lives in a modal,
Then that force-open is **removed/neutralized** (a modal must not `showModal()` itself on every error). Errors still populate `#error-log` (ring-of-5, red-border Connect signal unchanged); the **deliberate** path to view them is opening the modal (and, later, the E4 status-bar recent-errors affordance, which opens this same modal — out of scope here but the seam must not be blocked). No throw when `connectionPane` is absent/vestigial.

**AC-7 — Neutral-shell styling + modal-appropriate focus, aria-live status region (NFR-2/AD-9, UX-DR11, NFR-1).**
Given the modal markup,
Then it uses **only** `var(--chrome-*)` tokens (no legacy `2px 4px` pane padding, no phosphor/`[data-theme]` branch): dialog `rounded/lg` (8px), buttons `rounded/md` (6px), inputs on `field-bg` `rounded/sm` (4px), **no drop shadow** (native scrim is the only elevation), max-width ~90ch. It has an `aria-live="polite"` status region (may reuse/relocate `#port-status`-style semantics or a dedicated region — see Dev Notes). Controls inside the focus-trapped modal do **not** restore focus-to-terminal on change (that fights the trap); focus returns to `#terminal-wrapper` only on close via `openModal`'s `restoreTo`. `[data-focused]` (not `:focus-visible`) drives any chrome highlight.

**AC-8 — Footer = Reset (secondary) + Close; no in-modal Connect button (FR-15; OQ4 default).**
Given the modal footer,
Then it contains "Reset to MicroBeast preset" (`#serial-reset-preset`, secondary/bordered per DESIGN.md:194 — **not** the mock's ghost) which resets in-place and does **not** close the modal, and a "Close" affordance (`<form method="dialog">` submit, resolves `''`, or an explicit `.close()`); Esc also closes. **No primary "Connect" button** in the modal for this story (epic AC names only "Reset + close"; the mock's Connect is PRD Open Question 4 — flagged Q2). `initialFocus` = the Baud select (`#serial-baud`) or Close; `restoreTo` = `#terminal-wrapper`.

**AC-9 — Legacy pane serial-config surface retired to the modal; no incumbent behavior lost; suite green (FR-6, NFR-3, NFR-4, AD-12).**
Given the move,
Then the legacy `<details id="connection">` pane no longer hosts the moved controls (its serial `<fieldset>`, reset, both checkboxes + hints, default/single-tab hint, `#error-log` and label move out); `#port-status` and `#download-log-button` (E3-owned) may remain in the thin vestigial pane until E7/E3. Exactly **one** set of serial-config controls exists (no dual-chrome, no dual-state — NFR-4). No `prefs.js` schema change / no `CURRENT_VERSION` bump. Boot order untouched (`wireMenuBar` before `wireKeyboard`; polite-fail first). The full Playwright chromium suite passes (`npm test`), including `session/auto-connect.spec.js`, the serial-config persist/reconnect-hint oracles, and any spec that referenced the old pane control locations (**update, don't delete coverage**).

## Tasks / Subtasks

- [x] **Task 1 — Add the `<dialog id="serial-config-modal">` markup, moving the controls verbatim (AC-1..AC-4, AC-7, AC-8).**
  - [x] Add a new `<dialog id="serial-config-modal" aria-labelledby="serial-config-modal-title">` beside `#clear-scrollback-confirm` (end of body), with `<header><h2 id="serial-config-modal-title">Serial Configuration</h2></header>`, a `.modal-body`, and a `<footer>`.
  - [x] **Moved** (cut from the `<details id="connection">` pane, pasted into the dialog body) the five `<select>` labels + options, `#serial-reconnect-hint`, `#serial-reset-preset` (→ footer), `#show-all-serial-devices` + its hint, `#serial-assert-rts-on-connect-checkbox` + its RTS/CTS hint, the "MicroBeast default…single-tab ownership…" hint, and the "Recent errors" label + `<pre id="error-log">`. Every id, `<option value>`, and copy string is byte-for-byte identical (locked by the AC-2/AC-3/AC-4 spec assertions).
  - [x] Footer: `#serial-reset-preset` as a secondary bordered button (`type="button"`, does not close), + a Close control via `<form method="dialog"><button id="serial-config-close" value="close">Close</button></form>`. **No Connect button** (Q2 — recommended default taken).
  - [x] `aria-live="polite"` status region: `#serial-reconnect-hint` carries it (it doubles as the modal's live status — the "Config changed…" hint is exactly the dynamic status that warrants announcement; avoids a dead always-empty region).
  - [x] Gave the "Serial Configuration…" menu item `id="menu-serial-config-item"` + `data-action="serial-config"` and dropped its `▸ modal` caret (matches the Clear Scrollback… modal-opener convention).
  - [x] Left `<details id="connection">` as a thin vestige holding only `#port-status`, `#download-log-button` (+comment), and the persistence footnote — retired in E7/E3.

- [x] **Task 2 — Style the dialog on neutral `--chrome-*` tokens (AC-7; NFR-2/AD-9, UX-DR5/6).**
  - [x] Added scoped CSS for `#serial-config-modal` (dialog `rounded/lg` 8px, `chrome-bg`/`chrome-fg`/`chrome-border`; **no** `box-shadow` — scrim-only elevation, asserted; max-width 90ch; scrollable `.modal-body`), fieldset on the chrome border, selects on `field-bg` `rounded/sm` (4px, **not** the legacy 2px 4px) with `chrome-accent` focus ring, labels 13px/500, hints 12px `chrome-muted`, footer buttons `rounded/md` (6px) bordered, `[data-focused="true"]` default-focus border. Mirrors the `#send-modal` conventions incl. the `:not([open])` display guard.
  - [x] Removed the now-dead `#connection fieldset/legend/label/select` rules (they only styled the moved elements). `#error-log` + `.log-entry`/`.log-ts` and `#serial-reconnect-hint` amber are top-level id selectors that still apply inside the modal (kept as-is).

- [x] **Task 3 — Wire the menu item → `openSerialConfig()` opener (AC-1; AD-3, AD-8).**
  - [x] `main.js`: defined `openSerialConfig()` next to `confirmClearScrollback` — grabs `#serial-config-modal`, returns `openModal(el, { initialFocus: #serial-baud, restoreTo: terminalWrapper })`, null-guarded (returns `Promise.resolve('')` when absent).
  - [x] Injected `openSerialConfig` into the `wireMenuBar({...})` opts block (alongside `confirmClearScrollback`, `toggleConnection`, `chooseMicroBeast`).
  - [x] `menu-bar.js`: added `openSerialConfigRef` opt + a dedicated `action === 'serial-config'` branch in `onItemClick` (`closeMenu(); openSerialConfigRef?.();`) — NOT routed through `runViewAction`.

- [x] **Task 4 — Neutralize the error-log auto-expand; keep the ref plumbing valid after the move (AC-6, AC-9).**
  - [x] Removed `serial.js:618` `connectionPane.open = true;` and rewrote the D-27 comment (log now lives in the modal; a modal must not self-open on every error; E4 status-bar affordance is the deliberate open path). Errors still populate `#error-log` + trip the red Connect signal (verified by the unchanged `errors.spec.js` oracles + the new AC-6 spec).
  - [x] Verified the `main.js` DOM refs still `getElementById` cleanly after the move (elements are in the DOM at boot even while the `<dialog>` is closed). `connectionPane` is now a vestigial ref — left injected (no throw), no longer written.
  - [x] Confirmed `applyPrefs`'s serial mirror still sets `.value` on the moved selects/checkboxes by id (config.spec.js default-value oracles stay green).

- [x] **Task 5 — Focus semantics inside the modal (AC-7; NFR-1/AD-10 nuance).**
  - [x] Dropped `retainFocus(showAllSerialCheckbox)` in `chrome.js` (Q3 recommended default) — inside the focus-trapped modal the terminal is inert behind the scrim, so terminal-restore is both meaningless and wrong. The `change→savePrefs` wiring is unchanged. Left the Reset-button `mousedown→preventDefault` (`serial.js`) — harmless in a modal (documented in-code). Assert-RTS had no `retainFocus`, so nothing to change there.
  - [x] `initialFocus` (`#serial-baud`) gets `data-focused="true"` before `.focus()` via `openModal`; Esc/Close both resolve and restore focus to `#terminal-wrapper` (asserted).

- [x] **Task 6 — Tests (AC-1…AC-9).**
  - [x] New spec `www/tests/render/serial-config-modal.spec.js` (chromium project, 15 tests) — open via `window.__menuBar.open('connection')` → click `[data-action="serial-config"]`; asserts `toBeVisible()`, `getOpenMenu()===null`, `openDialogId`, focus round-trip on Close/Esc, all five selects + both toggles + Reset + `#error-log` + verbatim hint strings, Reset-without-close, connected reconnect-hint + clear-on-reset, silent-error-accumulation (no auto-open), no drop shadow, aria-live region, initial focus, no Connect button, and one-surface/pane-retirement.
  - [x] **Updated** existing specs that reached the controls via the pane: `config.spec.js` (open the modal for interactions; connect via the top-bar mirror with the modal closed), `errors.spec.js` (open the modal for the one visibility assertion; content asserts read textContent while closed), and corrected the stale auto-expand comment in `session/auto-connect.spec.js`. No coverage deleted — repointed.
  - [x] Regression: full suite `npx playwright test` (both projects) → **427 passed, 1 skipped, 0 failed** (4 pre-existing boot-under-load flakes in `view-theme-phosphor.spec.js` self-healed on retry; that spec is green in isolation — 14/14).

## Dev Notes

### The one-paragraph mental model

Everything the *behavior* needs already exists and is wired in `serial.js` via injected refs read **by element id**: the five selects (`readFormConfig` at connect time — "takes effect on next Connect"), the `change`-listener that persists `prefs.serial` + shows the reconnect hint while connected, the Reset-to-preset `snapPreset`, the `showAllSerialDevices`/`serialAssertRtsOnConnect` prefs (read **live** via `getPrefs()` in the requestPort/open paths), and the `#error-log` ring-of-5. E2.3 **relocates the same-id DOM elements** from the legacy `<details id="connection">` pane into a new `openModal`-driven `<dialog>`, re-styled onto neutral chrome tokens, opened from the existing "Serial Configuration…" menu item. Because the ids don't change, `main.js`'s `getElementById` refs and `serial.js`'s wiring keep resolving — the *only* code changes are: (a) menu wiring (`openSerialConfig` opt + `serial-config` dispatch branch), (b) neutralizing the `connectionPane.open=true` error auto-expand (a modal can't/shouldn't self-open), and (c) NOT retaining-focus-to-terminal on the modal's controls (the trap + `restoreTo`-on-close handle focus). This is the same "menu-bar is a projector fed by injected opts; serial reached only via opts" shape as E2.1/E2.2.

### Relocation strategy — MOVE (chosen), not duplicate+mirror (rejected) — Q1

- **Chosen (recommended): MOVE the same-id controls into the `<dialog>`.** `serial.js` reads a **single** injected `serialConfigEls`/`errorLogEl` set keyed by id. Moving the elements (ids intact) means those refs resolve unchanged → near-zero `serial.js` change, **one** source of truth (NFR-4), and **no dual-chrome** — which is precisely what E1 retro action #5 wants ("dual-chrome is never shipped mid-migration"). The `<dialog>` is in the DOM at boot even while closed, so boot-time `getElementById` + `applyPrefs` `.value` sets work fine.
- **Rejected: duplicate + two-way mirror (the E2.2 auto-connect pattern, scaled up).** E2.2 mirrored **one** checkbox because the menu row was a genuinely *new parallel* affordance. Here we'd be duplicating 5 selects + 2 checkboxes + reset + hint + error-log, with `serial.js` still reading the *legacy* set — forcing modal→pane mirroring on every change AND pane→modal re-derive on open, plus a second `#error-log`. That is fragile dual-state (violates NFR-4) and literally ships dual-chrome. Only choose this if Ant wants the legacy pane's serial section to stay fully functional until E7 (see Q1).

### Exact code sites (verified against `63f5b24`)

**`www/index.html`:**
- "Serial Configuration…" menu item — `:993–995`. Bare placeholder: `class="menu-item" data-variant="action"`, **no id, no data-action**, caret text literally `▸ modal`. Task 1 adds `id="menu-serial-config-item"` + `data-action="serial-config"`.
- Legacy `<details id="connection">` pane — `:1205–1272`. Move sources: selects `:1211–1248`; `#serial-reconnect-hint` `:1250`; `#serial-reset-preset` `:1251`; `#show-all-serial-devices`+hint `:1252–1256`; `#serial-assert-rts-on-connect-checkbox`+RTS/CTS hint `:1257–1261`; default/single-tab hint `:1266`; "Recent errors" + `#error-log` `:1268–1269`. **Stay in pane:** `#port-status` `:1207`, `#download-log-button` `:1262–1265` (E3), persistence note `:1271`.
- Existing modal templates to copy: `#send-modal` `:1456–1485` (imperative `.close(tag)`), `#clear-scrollback-confirm` `:1492–1502` (`<form method="dialog">` — **the closer template**). Relevant CSS: `#connection`/selects `:552–694`, `#serial-reconnect-hint` amber `:611–620`, `#error-log`/`.log-entry`/`.log-ts` `:678–694`.

**`www/renderer/modal.js`** (do not modify — consume as-is):
- `openModal(dialogEl, {initialFocus, restoreTo}) → Promise<returnValue>` — `:61`. Resets `returnValue=''` before every `showModal()` (`:98`), sets `data-focused` before `.focus()` (`:104–106`), resolves raw `returnValue` and focuses `restoreTo` on close (`:71–84`). **returnValue-reset policy header `:30–44` names E2.3 explicitly** — non-destructive form modal, so default-focus a form control/primary (not forced to Cancel). `window.__modal.__getStateForTests()` → `{openCount, lastReturnValue, openDialogId}` (`:113–125`).

**`www/renderer/menu-bar.js`** (AD-3: may import only `canvas.js` + `prefs.js`; serial/modal via opts):
- Opts intake ~`:221–246` (add `openSerialConfigRef`); `onItemClick` dispatch `:716–776`, `data-action` read `:758`, `connect-toggle` `:759` / `choose-microbeast` `:767` branches — **add `serial-config` here**. `runViewAction` `:795–816` (E1.5 `clear-scrollback` modal-open template at `:804–810` — mirror the `closeMenu()` then `ref?.()` shape, but in `onItemClick`, not here). `confirmClearScrollbackRef` precedent `:130`.

**`www/main.js`:**
- `openModal` import `:145–149`. `confirmClearScrollback()` opener `:205–212` (**the template** for `openSerialConfig`). `wireMenuBar({...})` opts block `~:317–358` (add `openSerialConfig`). `window.__menuBar` `:359`. Serial-config DOM refs `:244–250`, `serialAssertRtsCheckbox` `~:822`, `errorLogEl`/`connectionPane`/`portStatusEl` `:240–242`. `wireSerial({... serialConfigEls, connectionPane, errorLogEl})` `~:964–992`. `applyPrefs` serial mirror `~:1188–1213`. `terminalWrapper` `:167`. *(Line numbers drifted since E2.2 — re-confirm against HEAD before editing.)*

**`www/transport/serial.js`** (minimal change — keep the machine untouched):
- Injected `serialEls`/`errorLogEl`/`connectionPane` — declared `~:71–75`, assigned from opts `~:116–128`. `PRESET_CONFIG` `:41–43`. Config-change listener + persist `:263–284`. Reset wiring `:285–290`. `readFormConfig` `:317–326`. `snapPreset` `:331–356`. Reconnect hint `showReconnectHint`/`hideReconnectHint` `:361–370` (verbatim string `:363`). `appendErrorLog` `:605–619` (**`:618` auto-expand — Task 4 removes**). `renderErrorLog` `:621–635` (`'(no recent errors)'` `:624`). Public exports unchanged (`toggleConnection` `:300`, `getState` `:459`, `onStateChange` `:461`, `countMicroBeastAdapters` `:476`, …).

**`www/state/prefs.js`** (no change — no schema bump):
- `serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }` (`:24` — key is **`baud`** not baudRate; **`flowControl`**). `showAllSerialDevices: false` (`:28`). `serialAssertRtsOnConnect: true` (`:45`). `CURRENT_VERSION = 1` (`:16` — **do not bump**). Defensive `serial` merge `:94`. `savePrefs` does **not** fan out subscribers (AD-4).

**`www/renderer/chrome.js`:** `#show-all-serial-devices` wired `:252–259` (`change → savePrefs({showAllSerialDevices})` + boot mirror + `retainFocus`). *(The `retainFocus` here restores focus to the terminal on change — acceptable in the always-visible pane, but see Task 5: inside a modal this is wrong. Since the checkbox id is unchanged, chrome.js's handler still fires; decide whether to leave it (a checkbox toggle restoring terminal focus mid-modal is jarring) or guard it. Recommended: for a checkbox in a modal, drop the terminal-restore — focus should stay in the modal until close.)* `#serial-assert-rts-on-connect-checkbox` is wired in **`main.js:~822–829`** (not chrome.js) with an `applyPrefs` mirror `~:1199–1200` — same focus nuance applies.

### What must be preserved (non-negotiable — AD-13/FR-6/NFR-3/NFR-4)

- **Every id** (`serial-baud`, `serial-databits`, `serial-stopbits`, `serial-parity`, `serial-flowctl`, `serial-reset-preset`, `serial-reconnect-hint`, `show-all-serial-devices`, `serial-assert-rts-on-connect-checkbox`, `error-log`) — the whole minimal-change strategy depends on ids surviving the move.
- **Every `<option value>` and selected default** (AC-2) and **every verbatim copy string** (AC-3/AC-4) — byte-for-byte.
- **Config apply timing**: config takes effect on the **next Connect** (`readFormConfig` at open time); there is **no live re-apply**. Do not "helpfully" apply on change.
- The `serial.js` state machine, `PRESET_CONFIG`, live `getPrefs()` reads for `showAllSerialDevices`/`serialAssertRtsOnConnect`, the DTR-always-false / assert-RTS `setSignals` logic, and the `prefs.serial` blob shape (`baud`/`flowControl`) — read-only here.
- The reconnect-hint string `'Config changed — Disconnect and Connect to apply'` (`serial.js:363`) and its connected-only trigger.
- The `#error-log` ring-of-5, newest-first `HH:MM:SS code: message` render, `escapeHtml` trust boundary, and `'(no recent errors)'` empty state.
- Focus retention **on close** (NFR-1/AD-10 "Sacred") via `openModal`'s `restoreTo: terminalWrapper` — but **not** per-control terminal-restore inside the trapped modal (Task 5).
- Boot order (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. No `prefs.js` `CURRENT_VERSION` bump.

### aria-live status region (UX-DR11)

FR-15/NFR-7 require an `aria-live` status region in the modal. The legacy `#port-status` (`aria-live="polite"`, written by `serial.js` `updatePortStatus*`) stays in the vestigial pane (it feeds nothing modal-specific). Recommended: add a **dedicated** `<p class="hint" aria-live="polite">` region inside the modal for config/status announcements (e.g. the reconnect hint could double as the live region, or a small status line). Do not move `#port-status` itself (E4 status bar and `serial.js` write it). Keep it simple — a polite region that the reconnect hint / future error surfacing can announce into satisfies the floor. Flag if a richer status contract is wanted (not in the epic AC).

### Modal close / returnValue contract (AD-8 policy header, `modal.js:30–44`)

This modal is a **live-settings** surface: changes persist immediately (existing `change → savePrefs` listeners) and apply on next Connect. There is **no affirmative "apply" action** to confirm. So:
- **Close** (button or Esc) just dismisses → `openModal` resolves `''`; the caller (`openSerialConfig`) ignores the return value (nothing to act on). Use `<form method="dialog"><button value="close">Close</button></form>` for a free native close, or a plain button calling `.close()`.
- **Reset** is `type="button"` (NOT a `method="dialog"` submit) so it resets in-place without closing.
- Per policy clause #4, destructive modals default-focus the safe choice; this modal is **non-destructive**, so default-focus the first form control (`#serial-baud`) or Close — either is compliant.

### Testing standards + codified idioms (E1 retro action #4)

- **Project:** chromium. New spec under `www/tests/render/` (light `chromium` project, `playwright.config.js:33–51`); serial-machine oracles live in `chromium-transport` (`fullyParallel:false`, `retries:1` — the ratified flake fix; no per-story `--workers=1`). Run: `npm test` (full) / `npm run test:fast` (`@fast`).
- **Boot-race guard:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')` and `typeof window.__modal === 'object'` before driving.
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('connection'))` — NOT a title `.click()`. Then `page.click('#dropdown-connection .menu-item[data-action="serial-config"]')`.
- **Assert modal open + menu closed:** `await expect(page.locator('#serial-config-modal')).toBeVisible()`; `window.__menuBar.getOpenMenu() === null`.
- **Focus restore on close:** click `#serial-config-modal form[method=dialog] button` (or press Esc) → assert `document.activeElement.id === 'terminal-wrapper'` (idiom `modal-default-focus.spec.js`, `view-font-zoom-clear.spec.js:205–236`).
- **Reconnect-hint oracle:** seed a connected mock (`SERIAL_MOCK` + granted port), open modal, change `#serial-baud`, assert `#serial-reconnect-hint` visible + text; click `#serial-reset-preset`, assert hidden.
- **Error-log:** assert `#error-log` text is `(no recent errors)` initially and that populating via the serial mock renders an entry — **drop any assertion on `connectionPane.open`** (removed in Task 4).
- **`<dialog>` unit patterns:** `modal.spec.js` drives a throwaway dialog; `window.__modal.__getStateForTests().openDialogId === 'serial-config-modal'` after open.

### Project Structure Notes

- **No new module** (mirrors E2.2). E2.3 = `index.html` markup move + CSS + a small `openSerialConfig()` in `main.js` + one `menu-bar.js` dispatch branch/opt + neutralizing one `serial.js` line + a spec. `serial.js` keeps owning the control wiring via the same injected refs. Aligns with the Structural Seed (`ARCHITECTURE-SPINE.md:178–194`): the Serial Config modal is a `<dialog>` + `openModal`, governed by AD-8/AD-3/AD-9.
- **AD-3 respected:** `menu-bar.js` reaches the modal only via the injected `openSerialConfig` opt; `main.js` owns `openModal`. No new imports into `menu-bar.js`.
- **NFR-5:** no new dependencies, no build step; plain ESM.
- **Variances to track:** (1) the `<details id="connection">` pane becomes a thin vestige (`#port-status` + `#download-log-button`) after this story — full retirement is E7 (`#top-bar`/`<details>`, E1 retro action #5) / E3 (Download Session Log); leave a marker comment. (2) The E4 status-bar recent-errors affordance will open **this** modal — keep the opener (`openSerialConfig`) shaped so E4 can reuse it (it already is: a zero-arg opener returning the `openModal` promise).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story-E2.3 (lines 407–424)] — story statement + the two epic ACs (modal field inventory; connected→config-change reconnect hint).
- [Source: `epics.md`#FR-15 (line 46), #UX-DR10 (105), #UX-DR11 (106)] — modal field list; verbatim hardware-literate microcopy; a11y floor.
- [Source: `.../prds/prd-beastty-2026-07-01/prd.md`#FR-15 (lines 305–320)] — testable consequences: selects/toggles/Reset/hint/single-tab note/`#error-log`; verbatim RTS/CTS; footer Reset+close (+ `[NOTE FOR PM]` in-modal Connect = **Open Question 4**); mid-session "Config changed…" hint; aria-live + focus round-trip.
- [Source: `.../prds/.../reconcile-mock.md` (lines 22–41)] — footer button set (Reset/Close/**Connect**) unspecified in FR = OQ4; full single-tab hint sentence; recent-errors affordance format (E4).
- [Source: `.../prds/.../reconcile-ux.md` (lines 35–51, 71–77, 101–104)] — single-tab note; marquee RTS/CTS string; error-log "(no recent errors)" + muted-timestamp prefix; "Config changed…" mid-session scope.
- [Source: `.../architecture/.../ARCHITECTURE-SPINE.md`#AD-8 (105–108)] — `openModal(dialogEl,{initialFocus,restoreTo})→Promise`; every modal a static `<dialog>` + `showModal()`/`close(tag)`; content-build stays in caller.
- [Source: `ARCHITECTURE-SPINE.md`#AD-3 (80–83), #AD-4 (85–88), #AD-5 (90–93), #AD-6 (95–98), #AD-9 (110–114), #AD-10 (116–119), #AD-15 (141–144), Structural-Seed (178–194), Cap→Arch map (204)] — import allowlist (serial/modal via opts); prefs single-source; federated state subscribed; status fed-not-owned + error affordance opens modal; neutral chrome tokens; retainFocus; Connect single-writer; module layout.
- [Source: `.../architecture/.../EPIC-SPLIT.md` (41–47)] — E2 Serial Config modal via `openModal`; baud pushed imperatively to status bar (E4); error-log surfaces; depends on E0+E1.
- [Source: `.../ux-designs/.../DESIGN.md` (71–91, 127–132, 154–178, 192–196)] — modal tokens (`chrome-bg/fg/border/muted`, `field-bg`), type roles, rounding lg/md/sm, no-shadow/scrim-only elevation, max-width 90ch, primary/secondary buttons, "Reset to MicroBeast preset" = secondary bordered.
- [Source: `.../ux-designs/.../EXPERIENCE.md` (87, 111–114, 130, 147, 170, 200–204, 237–238)] — modal inventory ("Serial Configuration / NEW"); verbatim hint + RTS/CTS + "Config changed…" copy; focus-trap/restore/Esc/default-focus; error-log default + timestamp prefix; a11y floor; port-loss flow opening the modal.
- [Source: `www/index.html:993–995` (menu item), `1205–1272` (legacy pane — move sources), `1456–1485` (send-modal), `1492–1502` (clear-scrollback = `<form method="dialog">` template), `552–694` (pane/log CSS)].
- [Source: `www/renderer/modal.js:9–44` (contract + returnValue policy naming E2.3), `61–125` (impl + test hooks)].
- [Source: `www/renderer/menu-bar.js:130, 221–246, 716–776, 795–816` (confirmClearScrollback precedent; opts; onItemClick dispatch; runViewAction modal-open template)].
- [Source: `www/main.js:145–149, 205–212, 244–250, 317–358, 822–829, 964–992, 1188–1213` (openModal import; confirmClearScrollback opener template; serial refs; wireMenuBar opts; assert-RTS wiring; wireSerial; applyPrefs mirror)].
- [Source: `www/transport/serial.js:41–43, 263–290, 317–356, 361–370, 605–635` (PRESET; config-change+persist listener; readFormConfig/snapPreset; reconnect hint verbatim; error-log + `:618` auto-expand to remove)].
- [Source: `www/state/prefs.js:16, 24, 28, 45, 94` (CURRENT_VERSION no-bump; serial defaults; showAll; assertRTS; defensive merge)].
- [Source: `www/renderer/chrome.js:252–259` (show-all checkbox wiring + retainFocus nuance)].
- [Source: `_bmad-output/implementation-artifacts/e2-2-auto-connect-toggle-choose-microbeast.md`] — injected-opt + coexistence precedent; menu-driven test idioms; `#top-bar`/`<details>` E7 retirement variance.
- [Source: `www/tests/render/modal.spec.js`, `modal-default-focus.spec.js`, `view-font-zoom-clear.spec.js:205–236`, `menu-bar-connection-config.spec.js`; `www/tests/transport/errors.spec.js`, `mock-serial.js`; `www/playwright.config.js:33–51`] — modal + menu-open + focus-restore + error-log idioms; projects/scripts.

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **Relocation strategy — MOVE vs duplicate+mirror.** Recommended **MOVE the same-id controls into the `<dialog>`** (single source, no dual-chrome, near-zero `serial.js` change; the legacy pane's serial section retires now, `#port-status`/`#download-log` stay for E7/E3). Alternative: **duplicate + two-way mirror** (E2.2 pattern) if you want the legacy `<details>` pane's serial section to stay fully functional until E7 — costs dual-state (5 selects + 2 checkboxes + reset + log) and literally ships dual-chrome. Which?
2. **In-modal primary "Connect" button (PRD Open Question 4).** Recommended **omit it** — the epic AC names only "Reset to MicroBeast preset + close", and an in-modal Connect adds a second connect entry point that must honor the AD-15 single-writer contract (extra scope). Config applies on next Connect anyway, and Connect lives in the Connection menu (FR-12). Add it only if you want the mock's footer — and if so it must route through the injected single-writer `toggleConnection`, never a direct serial call. Include it?
3. **Per-control focus behavior inside the modal.** Recommended **no terminal-restore on change** for the modal's selects/checkboxes (fights the focus trap; focus returns to the terminal on Close via `restoreTo`). This means guarding/dropping the `retainFocus` terminal-restore that `chrome.js:252–259` (show-all) and `main.js:~822` (assert-RTS) currently apply, since those ids now live in a modal. OK, or keep the legacy per-control restore?

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, dev-story workflow)

### Debug Log References

None — no blocking failures. The one full-suite anomaly (4 flaky tests in
`view-theme-phosphor.spec.js`) is the documented boot-under-load contention
(E1 retro action #1): they timed out on `waitForFunction(window.__menuBar)` under
10-worker parallelism, then passed on the ratified `retries: 1`. Confirmed a
pre-existing flake, not a regression — the spec is 14/14 green in isolation
(`--workers=2`), and it is untouched by this story.

### Completion Notes List

- **Relocation, not a rebuild.** Every serial-config control moved verbatim (ids,
  `<option>` sets, copy strings) from `<details id="connection">` into the new
  `<dialog id="serial-config-modal">`. Because `serial.js` reads its refs by element
  id and `main.js` does `getElementById`, the serial state machine, persist/apply
  timing, `PRESET_CONFIG`, and prefs schema are **unchanged** — no `CURRENT_VERSION`
  bump. Net code delta: menu wiring + one removed `serial.js` line + one dropped
  `chrome.js` `retainFocus` + CSS + markup + tests.
- **Three flagged questions resolved with the story's recommended defaults:**
  - **Q1 → MOVE** the same-id controls (single source of truth, no dual-chrome —
    exactly what E1 retro action #5 wants). Rejected the duplicate+mirror alternative.
  - **Q2 → OMIT** the in-modal Connect button (epic AC names only Reset + close;
    avoids a second single-writer entry point). Footer = Reset (secondary, in-place)
    + Close (`<form method="dialog">`).
  - **Q3 → DROP** per-control terminal-restore inside the modal (removed the show-all
    checkbox's `retainFocus`); focus round-trips to `#terminal-wrapper` on close via
    `openModal`'s `restoreTo`.
- **AC-6 (silent errors):** removed the D-27 `connectionPane.open = true` auto-expand —
  a modal must not `showModal()` itself on every error. Errors still fill the ring-of-5
  and trip the red Connect signal; the deliberate view path is opening the modal (and,
  later, the E4 status-bar affordance, which reuses the zero-arg `openSerialConfig`).
- **aria-live (UX-DR11):** `#serial-reconnect-hint` carries `aria-live="polite"` — it
  is the modal's genuine dynamic status, so it doubles as the live region (no dead
  always-empty region). `#port-status` stays in the vestige pane (E4-owned).
- **Verification:** new 15-test spec (all AC), updated `config.spec.js`/`errors.spec.js`,
  corrected a stale comment in `auto-connect.spec.js`. Full suite 427 passed / 0 failed.
  Visual sanity-checked via screenshot (neutral tokens, no shadow, correct layout).

### File List

- `www/index.html` — menu item (`#menu-serial-config-item` + `data-action`); moved
  serial-config controls out of `<details id="connection">` into new
  `<dialog id="serial-config-modal">`; added modal CSS (neutral `--chrome-*` tokens,
  no shadow); removed dead `#connection` fieldset/select rules.
- `www/main.js` — `openSerialConfig()` opener; injected into `wireMenuBar` opts.
- `www/renderer/menu-bar.js` — `openSerialConfigRef` opt + `serial-config` dispatch branch.
- `www/transport/serial.js` — removed the `connectionPane.open = true` error auto-expand
  (comment rewritten); documented the Reset-button `mousedown` choice.
- `www/renderer/chrome.js` — dropped `retainFocus(showAllSerialCheckbox)` (now in a modal).
- `www/tests/render/serial-config-modal.spec.js` — **new** (15 tests, AC-1…AC-9).
- `www/tests/transport/config.spec.js` — open the modal for form interactions.
- `www/tests/transport/errors.spec.js` — open the modal for the log-visibility assertion.
- `www/tests/session/auto-connect.spec.js` — corrected the stale auto-expand comment.

### Change Log

- 2026-07-03 — Implemented E2.3: relocated the Serial Configuration surface from the
  legacy `<details id="connection">` pane into an `openModal`-driven
  `<dialog id="serial-config-modal">` on neutral chrome tokens, wired from
  Connection ▸ Serial Configuration…; neutralized the error-log auto-expand;
  modal-appropriate focus. Q1/Q2/Q3 resolved with recommended defaults. Full suite green.
