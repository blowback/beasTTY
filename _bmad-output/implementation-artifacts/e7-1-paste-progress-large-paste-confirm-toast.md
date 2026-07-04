---
baseline_commit: 23d0c3c21f45520410c03f7eaf85e600722089f5
---

# Story E7.1: Paste progress & large-paste confirm toast

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator pasting a block of text,
I want paste progress and a large-paste confirmation as a small centered toast,
so that big pastes are throttled safely without a stuck row in the old top bar — and the old top bar is gone for good.

**Covers:** FR-29 (paste toast — transient centered progress + large-paste ≥4096 B confirm; no null-ref after `#top-bar` removal; AD-16), UX-DR15. **Plus the milestone's dual-chrome formal sweep** — the five-epic carry (e1 retro #5 → e2 #4 → e3 #4 → e4 #4 → e5 #2 → **e6 #1**) and the whole-branch review mandate (e6 #2).
**Epic:** E7 · Paste Toast (the **last epic**). **Depends on:** E0.1 (`renderer/focus.js` `retainFocus` — the sacred `mousedown→preventDefault` focus-retention primitive, AD-10), and the whole E1–E6 body of work whose legacy surfaces this sweep retires. This is the **first and only story of Epic E7**, so creating it flips `epic-e7` `backlog → in-progress`. The epic retrospective is `optional`.

**Premise — this is TWO jobs in one story, by explicit design (e6 retro #1).** ① Ship the **paste toast**: a new `renderer/paste-toast.js` that clones the `slide-chip.js` transient-chip precedent (zero new mechanic), drives its progress from `paste-pump.onProgress`, and hosts the large-paste (≥4096 B) confirm — rehoming the `#paste-progress-row` orphaned by `#top-bar` removal (AD-16/FR-29/UX-DR15). ② Perform the **dual-chrome formal sweep**: delete `#top-bar` and every element and JS wiring mirror-tied to it, delete the two remaining `<details>` vestiges, retire the neutral-shell pins together with the `[data-theme="crt"]` chrome override, **keep the debug panel** (the one recorded pane that stays), and consume existing single-sources rather than adding a sixth duplicated constant. Then run **one whole-branch review** over the entire `ui-rethink` tree as the last pass before milestone close. The two jobs are coupled because `#top-bar` removal is *the sweep's last act* and it is exactly what orphans the paste row — you cannot delete `#top-bar` safely until the toast has rehomed both progress and confirm.

**The load-bearing insight that makes the sweep safe.** The E1–E6 authors wrote every legacy surface as a **coexistence mirror**, not a source of truth: the menu/modal is the authoritative "SOLE writer" and every projector is already **null-guarded and fails OPEN when the legacy element is absent** (e.g. `menu-bar.js:1197` "Fail OPEN when the legacy button is absent (post-E7 / harness)"; `projectConnection` null-guards `legacyConnectBtnEl` at `:1421`). So for the *mirrored* controls the sweep is mostly deletion — remove the legacy DOM node **and** its now-dead mirror line; the guards already handle absence. The **exceptions** are the handful of legacy elements that still carry their own **unguarded `addEventListener` / ref-deref wiring in `main.js`/`chrome.js`** (the paste-cancel button, the `#local-echo` checkbox, the `#crlf-*` radios). Those throw at boot the instant their node is gone, so their JS wiring must be **deleted, not just orphaned**. Identifying and removing that JS wiring — not just the HTML — is the correctness core of the sweep.

## Acceptance Criteria

The epic's two ACs (`epics.md` §Story E7.1) — the toast-on-≥4096B-with-live-progress AC and the no-null-ref-after-`#top-bar`-removal AC — are decomposed below and joined by the sweep + review ACs the epic-level retros make mandatory for E7. AC-1/AC-2 are the two epic ACs; AC-3…AC-7 make the sweep, the preservation guarantees, the aesthetic, and the suite/review requirements falsifiable.

**AC-1 — Paste toast: centered transient with live progress + large-paste confirm (FR-29; UX-DR15; AD-16).**
**Given** a new `renderer/paste-toast.js` cloning the `slide-chip.js` transient-chip pattern, wired in `main.js` via one `wirePasteToast(opts)` call, subscribed to `paste-pump.onProgress`
**When** a paste of ≥ 4096 B is initiated
**Then** a **small, centered** toast (centered over the terminal canvas — distinct from the top-right SLIDE chip and bottom-right scrollback indicator) appears carrying a **confirm affordance** ("Paste" + "Cancel", bracketed-button style per the floating-chip precedent), and once confirmed the toast shows live progress (`Pasting {total} B — {pct}%`) that updates as `paste-pump` fires `'chunk'`, then `'Paste complete'` and auto-dismisses; `'cancelled'` / `'cancelled-port-lost'` render their messages and auto-dismiss.
**And** a paste < 4096 B pumps without a confirm step; if a sub-threshold paste surfaces progress at all it does so through the same toast (no reference to `#paste-progress-row`).
**And** the toast is the SOLE consumer of `paste-pump.onProgress` for UI (the old `main.js` inline observer is gone), and `input/clipboard.js`'s `showLargePasteConfirm` resolves its `Promise<boolean>` from the toast's confirm/cancel — not from `#paste-confirm`/`#paste-cancel` (which no longer exist).

**AC-2 — No null-reference on any paste after `#top-bar` removal (FR-29 second consequence; AD-16 "Prevents").**
**Given** `#top-bar` and `#paste-progress-row` (`#paste-progress-text`, `#paste-cancel`, `#paste-confirm`) have been removed from the DOM
**When** any paste occurs (sub-threshold, large, cancelled, port-lost) **and** at boot
**Then** no `TypeError`/null-reference is thrown anywhere in the paste path — specifically the old unguarded `main.js:1359` `pasteCancelBtn.addEventListener(...)` and the `main.js:1320-1355` `onPastePumpProgress` observer that dereferenced `pasteProgressRow`/`pasteProgressText` are **removed** (not merely null-guarded), and the `main.js:324-325`/`:1252-1290`/`:1474-1475` legacy `#local-echo`/`#crlf-*` wirings are removed so boot does not throw on their absence. `paste-pump.js`, `input/clipboard.js` (already null-safe), and `keyboard.js` Esc-cancel keep working unchanged.

**AC-3 — Dual-chrome formal sweep: `#top-bar` + the two `<details>` vestiges + the neutral-shell pins are gone; the debug panel stays (e6 retro #1; AD-7/AD-9/AD-11/AD-14).**
**Given** the coexistence window is closing
**When** the sweep runs
**Then** the following are **absent from the DOM / dead code removed**, and no live behavior regresses (each control's authoritative menu/modal surface still works):
- `<div id="top-bar">` (`index.html:1641-1675`) and its children: `#connect-button`, `#send-file-button` + `#send-file-input`, `#paste-progress-row` (+ text/cancel/confirm) — and the `#top-bar #paste-progress-row` CSS block (`index.html:~636-679`) and the `#top-bar`/button CSS (`index.html:~269-290, ~572+`).
- `<details id="connection">` (`index.html:1685-1698`) — its only live control `#download-log-button` is superseded by File ▸ Download Session Log (menu-authoritative).
- `<details id="settings">` (`index.html:1735-1795`) wholesale — `#local-echo`, the `name="crlf"` radios, the nested `<details class="reserved">`, `#auto-connect-checkbox`, `#reset-prefs-button` (+ its `chrome.js:~267-293` 2-click confirm handler).
- The neutral-shell **pins** on `#menu-bar` (`index.html:~87-99`) and `#status-bar` (`index.html:~143-159`) **together with** the `[data-theme="crt"]` **chrome override** (`index.html:~70-74`) that made them necessary — after removal, `--chrome-*` no longer flips with the terminal theme, so the pins are redundant and the chrome renders identically across CRT↔Console with no pin.
- Every orphaned coexistence-mirror line in `renderer/menu-bar.js` (`:174, 231, 416-417, 419, 793, 797, 929-931, 1189-1200, 1420-1421`), plus the legacy-mirror `legacyMirrorId` entries in its checkable-pref table (`:179-180`), reduced to their post-E7 shape.
- **KEPT (the one recorded exception):** `<details id="debug">` (`index.html:1798-1819`) stays, gated by Debug ▸ Show Debug Panel (`open` attribute + `#debug:not([open]){display:none}`, default OFF). It hosts `#input`, Feed / 64 KB Stress / Paste test, `#tx-strip`, Reset TX (AD-11/FR-23). Do NOT sweep it; do NOT rename `#debug` in this story (see Flagged Q3).

**AC-4 — Every swept control's authoritative surface still works end-to-end (no regression — the sweep must leave the system working, not just satisfy its own ACs).**
**Given** the legacy panes are gone
**Then** each relocated function is exercised via its menu/modal surface and still works: Connect/Disconnect (Connection menu), Send File… (File menu), Download Session Log (File menu, byte-gated), Local echo (Settings menu checkable), Enter-key-sends CR/LF/CRLF (Settings ▸ crlf submenu, live via `keyboard.js setCrlfMode`), Auto connect on load (Connection menu checkable), Reset all preferences (Settings ▸ Reset all preferences, its own independent 2-click machine), Browser-reserved Ctrl combinations (Settings → `#reserved-ctrl-modal`). Reset-all-preferences re-projects every menu/status surface with no stale read of a removed element (`applyPrefs`/`PREF_CONTROLS` no longer reference removed ids).

**AC-5 — Clean neutral aesthetic + cross-cutting invariants (AD-9/NFR-2; AD-10/NFR-1; AD-1/NFR-5; AD-2/NFR-6; NFR-4).**
**Given** the toast is open
**Then** it consumes **only** `var(--chrome-*)` tokens — no phosphor vars, no `[data-theme="crt"]` styling branch (do NOT copy the slide-chip's CRT special-casing at `index.html:388-391`); it retains terminal focus on every control (`retainFocus` / `mousedown→preventDefault` on the toast and its buttons — AD-10); it is a plain `.js` module under `renderer/` with **named exports only**, added to `main.js` imports + one `wireXxx(opts)` call, **no new dependency, no build step** (AD-1); it exposes `window.__pasteToast` + `__getStateForTests` (+ `__resetForTests`) for the Playwright chromium suite (AD-2/NFR-6); and it **subscribes** to `paste-pump.onProgress` without owning paste state — the pump stays the single source of truth (NFR-4). Any handler-derived text the toast surfaces is derived from a single-source, not a duplicated constant (e6 retro #3/#4).

**AC-6 — The full Playwright chromium suite stays green; paste + swept-surface specs migrated, a new `paste-toast.spec.js` added.**
**Given** the sweep removes ids that existing specs assert against
**Then** the suite is updated and green on the accepted `retries:1` mask: `tests/transport/paste.spec.js` (asserts `#paste-progress-text`, `#paste-cancel`, `#top-bar #paste-progress-row`), `tests/render/menu-bar-keyboard.spec.js:49-96` (`#paste-progress-row`/`-text`), `tests/session/clipboard.spec.js:159`, and `tests/transport/connect.spec.js:16` ("Connect button visible in top-bar") are migrated onto the new toast / menu surfaces (or the top-bar-specific assertions removed as intentionally retired — `log()` what was dropped, don't silently delete coverage). A new `tests/render/paste-toast.spec.js` (cloned from `slide-chip.spec.js`) drives the toast via `window.__pasteToast.__getStateForTests()` + programmatic progress, covering: ≥4096B confirm appears, confirm→progress→complete→auto-hide, cancel, Esc-cancel (via `keyboard.js`), port-lost, centered position, `--chrome-*`-only styling, focus retention, and no-null-ref at boot with `#top-bar` absent.

**AC-7 — Whole-branch review as the milestone's final sweep (e6 retro #2), recorded in this story.**
**Given** E7.1 is the last story of `ui-rethink`
**Then** after dev, run `code-review` scoped to the **whole `ui-rethink` working tree** (not just the E7 diff) as the last natural pass before milestone close, and record the outcome (N findings, severity, fix sha, or 0 findings) in this story's Code Review section — the done-gate `scripts/check-story-done-consistency.py` asserts the front-matter status and the Code Review section agree.

## Tasks / Subtasks

- [x] **Task 1 — Build `renderer/paste-toast.js` cloning the slide-chip transient-chip pattern (AC-1, AC-5).**
  - [x] Create `www/renderer/paste-toast.js` modeled on `renderer/slide-chip.js` (which itself clones `scroll-state.js`): module-scope `lifecycle` state + per-state data, injected deps via `wirePasteToast(opts)`, `[hidden]`-attribute toggle render, and a state-change observer fan-out. Named exports only; no default.
  - [x] `wirePasteToast({ toastEl, toastTextEl, onConfirm, onCancel })` (or similar): store refs, attach `mousedown→preventDefault` focus-retention on the toast + inline buttons (via `retainFocus` from `renderer/focus.js` — reuse, do not hand-roll), do an initial render, and **return an API object** exposing the state-entry methods + `__getStateForTests` (+ `__resetForTests`). No 250 ms tick is needed unless throughput display is wanted (paste progress arrives as discrete `'chunk'` events — prefer event-driven render over a tick; see Dev Notes).
  - [x] Render function: a `switch (lifecycle)` writing per-state text + `aria-label` and toggling `hidden`; states mirror the pump's event vocabulary — `hidden`, `confirm` (large-paste, shows [Paste][Cancel]), `pumping` (`Pasting {total} B — {pct}%`), `complete` (`Paste complete`, auto-hide ~2 s), `cancelled` (`Paste cancelled`, auto-hide ~2 s), `cancelled-port-lost` (`Paste cancelled — port lost ({unsent} bytes unsent)`, auto-hide ~3 s). Inline `[Paste]`/`[Cancel]` buttons injected + re-wired per render exactly like slide-chip's `wireInlineButtons()`.
  - [x] Add the `<button id="paste-toast">`/`<span id="paste-toast-text">` markup inside `#terminal-wrapper` (beside `#slide-chip`, `index.html:1727-1731`), `hidden aria-live="polite" aria-atomic="true"`.
  - [x] Add `#paste-toast` CSS beside `#slide-chip` (`index.html:365-413`): **centered** over the canvas (`position:absolute; left:50%; top:50%; transform:translate(-50%,-50%)` or equivalent — NOT top-right), `--chrome-bg`/`--chrome-border`/`--chrome-fg` tokens, 1px hairline, `rounded/sm` (4px), monospace, `[hidden]{display:none}`, `:focus-visible` outline `var(--chrome-accent)`, inline-button styling. **No `[data-theme="crt"]` override** (AD-9 — the slide-chip has one at `:388-391`; the toast must NOT copy it), **no box-shadow**.
- [x] **Task 2 — Wire the toast in `main.js`; route both progress AND large-paste confirm through it (AC-1, AC-2).**
  - [x] Resolve `#paste-toast`/`#paste-toast-text` refs; `const pasteToast = wirePasteToast({...})`. Import at top of `main.js`.
  - [x] **Progress path:** replace the `main.js:1320-1355` `onPastePumpProgress(...)` inline observer with `onPastePumpProgress((ev) => pasteToast.<render-from-event>(ev))` — the toast owns the DOM writes. Delete the old observer body and the `main.js:361-362` `pasteProgressRow`/`pasteProgressText` refs.
  - [x] **Confirm path:** `input/clipboard.js`'s `showLargePasteConfirm(byteCount)` (`clipboard.js:100-132`) currently resolves a `Promise<boolean>` off `#paste-confirm`/`#paste-cancel` clicks. Redirect it to the toast: either pass a toast-confirm function into `wireClipboard` (preferred — keeps `clipboard.js` DOM-agnostic), or have `wireClipboard` call `pasteToast.confirmLargePaste(byteCount, {getBaud}) → Promise<boolean>`. Remove `wireClipboard`'s `pasteProgressText/pasteCancelBtn/pasteConfirmBtn/pasteProgressRow` opts (`main.js:791-800`) and the `pasteConfirmBtn` ref (`main.js:791`).
  - [x] **Cancel wiring:** delete the unguarded `main.js:1359-1360` `pasteCancelBtn` listeners — the toast's inline [Cancel] now calls `cancelPastePump()` via its `onCancel`. Esc-cancel via `keyboard.js:242-246` is unchanged (it calls `paste-pump.cancelPaste()` directly, which fires `'cancelled'` → the toast renders it).
  - [x] Expose `window.__pasteToast` (the API object incl. `__getStateForTests`/`__resetForTests`).
- [x] **Task 3 — Sweep `#top-bar` + the paste row + Connect/Send-file legacy surfaces (AC-3, AC-4).**
  - [x] Delete `<div id="top-bar">…</div>` (`index.html:1641-1675`) including `#connect-button`, `#send-file-button`, `#send-file-input`, `#paste-progress-row`. Delete the associated CSS (`#top-bar …`, `#top-bar #paste-progress-row …`, the Connect-button-in-top-bar block).
  - [x] `renderer/menu-bar.js`: remove `legacyConnectBtnEl` (`:419`) and its writes in `projectConnection` (`:1420-1421`) and `writeConnectLabel` (`:1434`); remove the `projectSendFile` legacy-`#send-file-button` read (`:1193-1201`) so the row's disabled state derives from the file-source gate directly (it already "fails open" — confirm the menu row still gates correctly without the button); prune the `E7`/coexistence comments at `:174, 416-417, 929-931, 1189`.
  - [x] `input/file-source.js` — check its `#send-file-button`/`#top-bar` reads (`:204, 583` per grep) and remove/redirect them so the File ▸ Send File… path (menu-authoritative) is the sole trigger.
  - [x] Verify Connect/Disconnect + Send File… still work end-to-end via the menus (AC-4).
- [x] **Task 4 — Sweep `<details id="connection">` + `<details id="settings">` and their legacy JS wirings (AC-3, AC-4, AC-2).**
  - [x] Delete `<details id="connection">` (`index.html:1685-1698`); `#download-log-button` goes with it. Confirm `wireSessionLog` handles a null `downloadButton` (`main.js:824-826`, ref `:366`) — if it doesn't null-guard, add the guard or drop the opt; File ▸ Download Session Log is authoritative.
  - [x] Delete `<details id="settings">` wholesale (`index.html:1735-1795`): `#local-echo`, `name="crlf"` radios, nested `<details class="reserved">`, `#auto-connect-checkbox`, `#reset-prefs-button`.
  - [x] **Remove the legacy JS wirings (the null-throw hazard — AC-2):** `main.js:324-325` (`localEchoCheckbox`, `crlfRadios` refs) + `:1252-1290` (their `change`/`mousedown` listeners) + `:1474-1475` (the `crlfRadios` mirror loop in `applyPrefs`); the `PREF_CONTROLS` entries for `local-echo` and `auto-connect-checkbox` (`main.js:1414-1415`) that `bindPrefControl` iterates. `chrome.js:255-261` (auto-connect-checkbox wiring) + `:291` + the `:267-293` reset-prefs 2-click handler. The menu/modal surfaces (Settings checkables, `keyboard.js setLocalEcho`/`setCrlfMode`, `applyPrefs` calling those setters at `:1467`/`:1473`) remain the authoritative path.
  - [x] `renderer/menu-bar.js`: remove the crlf legacy-radio mirror (`:797`) and the `legacyMirrorId` entries for `autoConnect`/`localEcho` in the checkable table (`:179-180`); confirm `projectCheckable`/`projectAutoConnect`/`projectLocalEcho`/`crlfPanel` re-projection no longer reads a removed element.
  - [x] Verify Local echo, Enter-key-sends CR/LF/CRLF, Auto connect, Reset all preferences, Reserved-Ctrl modal all still work via their menus (AC-4), and Reset re-projects cleanly.
- [x] **Task 5 — Retire the neutral-shell pins + the `[data-theme="crt"]` chrome override (AC-3, AC-5).**
  - [x] Remove the `[data-theme="crt"]` **chrome-var override** (`index.html:~70-74` — the block that flips `--chrome-bg/fg/accent` for the old top-bar). Remove the scoped **pins** on `#menu-bar` (`index.html:~96-99`) and `#status-bar` (`index.html:~156-159`). Ensure the base `--chrome-*` values remain defined (on `:root` / the base block) so chrome still renders — the pins were *overrides of an override*; deleting both leaves the base neutral values in force.
  - [x] Visually confirm menu bar, dropdowns, modals, status bar, and the new toast render identically in CRT and Console themes (AD-9 — no theme adaptation of chrome).
  - [x] Prune the E7-retirement comments tied to the pins (`index.html:~87-95, ~145-150`) and the `status-bar.js:8` "until E7" comment.
- [x] **Task 6 — Migrate/repair tests + add `paste-toast.spec.js` (AC-6).**
  - [x] New `www/tests/render/paste-toast.spec.js` cloned from `tests/transport/slide-chip.spec.js`: drive via `window.__pasteToast.__resetForTests()` + programmatic state entry and/or real paste through `#paste-test` (`#input.fill(...)` + `#paste-test.click()`); assert `#paste-toast-text` content, `hidden` toggling/auto-hide, centered position (`getComputedStyle`), `--chrome-*`-only (no `[data-theme]` branch), `boxShadow==='none'`, inline `[Paste]`/`[Cancel]` clicks, Esc-cancel (no `0x1B` leaked to `__mockWriterLog`), port-lost via `__simulateUnplug()`, and **no console error / null-ref at boot** with `#top-bar` absent.
  - [x] Migrate the specs that assert removed ids: `tests/transport/paste.spec.js` (`#paste-progress-text`→`#paste-toast-text`; drop/replace the `#top-bar #paste-progress-row` relocation-invariant assertion at `:196`), `tests/render/menu-bar-keyboard.spec.js:49-96`, `tests/session/clipboard.spec.js:159`, `tests/transport/connect.spec.js:16` ("Connect button visible in top-bar" → assert the Connection menu Connect surface instead). Where an assertion covered a now-retired surface, replace it with the equivalent menu/toast assertion — do not just delete coverage; note any intentional drop.
  - [x] Run the full chromium suite (`npm test`) — expect green on the accepted `retries:1` / `chromium-transport` mask. No per-story `--workers=1`.
- [x] **Task 7 — Whole-branch review + close-out (AC-7).**
  - [x] Run `code-review` (high effort) scoped to the **whole `ui-rethink` working tree** — the milestone's final sweep (e6 retro #2). Apply fixes, commit, and record the outcome (findings count + severity + fix sha, or 0 findings) in the Code Review section below.
  - [x] Confirm every `E7`/`retire`/`coexistence`/`neutral-shell`/`dual-chrome` marker is cleared to zero (grep `www/` runtime for `E7`, `retire`, `coexistence` — should be empty or historical-only). This closes the five-epic carry.
  - [x] Per [[mark-story-done-all-places]]: on completion set status `done` in `sprint-status.yaml` (the `e7-1-…` row) **and** this file's front-matter/Status + `last_updated`; run `scripts/check-story-done-consistency.py`. Then flip the six open E7-carry action items (`sprint-status.yaml` e1#5/e2#4/e3#4/e4#4/e5#2, e6#1/#2/#3) to `done` as their close-outs land. The `epic-e7-retrospective` is `optional`.

## Dev Notes

### The one-paragraph mental model

Beastty has a proven "transient floating chip" seam: a static `<button>`/`<span>` inside `#terminal-wrapper`, injected by reference into a `wireXxx(opts)` initializer that owns a module-scope `lifecycle` state machine, renders by writing `.textContent`/`.innerHTML` + toggling `[hidden]`, and fans out to observers. `renderer/slide-chip.js` (537 lines) is the reference implementation; `renderer/scroll-state.js` is *its* ancestor. E7.1 clones that seam **once** as `renderer/paste-toast.js` for a **centered** paste toast that (a) subscribes to `paste-pump.onProgress` for live progress and (b) hosts the large-paste confirm that `input/clipboard.js` currently drives off `#paste-progress-row`. Then — because `#top-bar` removal is what orphaned that row — the same story deletes `#top-bar`, the two `<details>` vestiges, the neutral-shell pins + the `[data-theme="crt"]` chrome override, and every dead coexistence-mirror line, **keeping only `<details id="debug">`**. There is **no new dependency, no build step, no new primitive** — the chip mechanic already exists; the toast is a clone with a centered position and a confirm affordance.

### The paste pipeline as it is today (what the toast replaces)

Three modules, one owner:
- **`input/paste-pump.js`** (the single source of truth — do NOT change its ownership; the toast only *subscribes*). API: `wirePastePump({term,sampleBell,drainHostReply,requestFrame})`, `enqueuePaste(bytes)`, `cancelPaste()`, `isActive()`, `onProgress(fn)` (→ imported as `onPastePumpProgress`), `onPortLost()`, `setBaudForPump(baud)`. `CHUNK_SIZE=32`; `gapMs` from baud with a 4 ms floor. **No size threshold lives here.** The `onProgress` fan-out is `fireProgress(status, extra)` → observers get `{status, ...extra}`:

  | status | extra | meaning |
  |---|---|---|
  | `'started'` | `{ total }` | first chunk enqueued (total bytes) |
  | `'chunk'` | `{ written, total }` | `written` = bytes sent so far → `pct = round(written/total*100)` |
  | `'complete'` | *(none)* | drained |
  | `'cancelled'` | `{ unsent }` | user/Esc cancel |
  | `'cancelled-port-lost'` | `{ unsent }` | port unplugged mid-paste |

  There is **no `done` boolean** — completion is the discrete `'complete'` status.
- **`input/clipboard.js`** (already fully null-guarded — the confirm path survives `#top-bar` removal; only its *target elements* change). `pasteFromClipboard()` reads the clipboard, strips control bytes, and at **`clipboard.js:90`** does `if (bytes.length >= 4096) { const ok = await showLargePasteConfirm(bytes.length); if (!ok) return; }` then `enqueuePaste(bytes)`. **`4096` is a literal here, not a named constant** — consider hoisting to a shared `LARGE_PASTE_THRESHOLD` the toast/spec can import (single-source per e6 #3), but do not over-engineer. `showLargePasteConfirm` (`:100-132`) is a `Promise<boolean>` that today writes `#paste-progress-text` and reveals `#paste-confirm`/`#paste-cancel`; **redirect it to the toast** (Task 2).
- **`input/keyboard.js`** — Esc-cancel at `:242-246`: `if (pastePumpIsActive()) { e.preventDefault(); cancelPaste(); return; }`. Unchanged — it calls the pump directly; the pump fires `'cancelled'` → the toast renders it. (Esc-passthrough guard from E1.2 ensures this still fires.)

**Current DOM sink to delete:** `main.js:361-364` refs (`pasteProgressRow`, `pasteProgressText`, `pasteCancelBtn`, `pasteTestBtn` — keep `pasteTestBtn`, it lives in the debug panel which STAYS), the `main.js:1320-1355` inline observer, and the unguarded `main.js:1359-1360` cancel-button listeners (the boot-time null-throw once `#paste-cancel` is gone).

### The slide-chip precedent — what to clone (exact anatomy)

`renderer/slide-chip.js`: module docblock names `scroll-state.js` as its analog; module-scope `lifecycle` string state machine + per-state data + timer handles + injected `chipElRef`/`chipTextElRef`/callbacks + `stateChangeObservers`; `wireSlideChip(opts)` (`:89-127`) stores refs, adds `mousedown→preventDefault` on the chip (`:98-101`, "Phase 4 D-16 — sacred"), initial `refreshChip()`, a 250 ms `setInterval` tick (`:107` — **the toast may skip this**; paste progress is event-driven, not throughput-sampled), and **returns an API object** of state-entry methods + `__getStateForTests` (`:109-126`). The outer `<button id="slide-chip">`/`<span id="slide-chip-text">` are static (`index.html:1727-1731`) and injected by reference — the module never creates the outer node, only writes text + toggles `hidden`. Inline buttons are HTML strings injected into the text span + re-wired each render (`wireInlineButtons()` `:298-310`). Transient show/hide: state-entry methods set `lifecycle`, call `refreshChip()`, arm `setTimeout` auto-hides; `hide()` clears timers + resets + re-renders. Test surface: `__resetForTests()`/`__getStateForTests()` exported AND returned in the API. Wired in `main.js:853-873`, hook at `main.js:1176-1186`. **Clone this shape; change: position (centered not top-right), the confirm affordance, and event-driven (not tick-driven) progress.**

CSS to mirror: `#slide-chip` at `index.html:365-413` — but **drop the `[data-theme="crt"]` override at `:388-391`** (AD-9/NFR-2: chrome is theme-neutral; the slide-chip's CRT special-casing is exactly what AD-9 says NOT to copy). Center instead of `top:8px;right:8px`.

### The dual-chrome sweep — exact removal checklist (verified against baseline `23d0c3c`)

The authoritative mandate is **e6 retro #1** (`epic-e6-retro-2026-07-04.md:123`): "E7 = the dual-chrome formal sweep … close the retirement checklist to zero alongside the paste-toast feature; `#top-bar` removal is the sweep's last act; verify no dual-chrome ships, retire the neutral-shell pin, confirm the debug panel is the one recorded pane that stays." Every legacy surface was built as a **coexistence mirror** with the menu/modal authoritative — so most of the sweep is "delete the DOM node + its dead mirror line," and the projectors already fail-open on absence. The exceptions (own unguarded JS wiring) are called out ⚠️.

| # | Remove | Location (verify vs `23d0c3c`) | Notes |
|---|---|---|---|
| 1 | `<div id="top-bar">` container | `index.html:1641-1675` | the sweep's last act; orphans the paste row |
| 2 | `#connect-button` | `index.html:1642` | mirror; delete `menu-bar.js` `legacyConnectBtnEl` `:419`,`:1421`,`:1434` |
| 3 | `#send-file-button` + `#send-file-input` | `index.html:1662-1664` | mirror; delete `projectSendFile` legacy read `:1193-1201`; check `file-source.js:204,583` |
| 4 | `#paste-progress-row` (+text/cancel/confirm) | `index.html:1670-1674` | **replaced by the toast**; ⚠️ delete `main.js:1359` cancel listener + `:1320-1355` observer |
| 5 | `#top-bar`/paste-row CSS | `index.html:~269-290, ~572+, ~636-679` | all `#top-bar`-scoped |
| 6 | `<details id="connection">` | `index.html:1685-1698` | holds only `#download-log-button`; check `wireSessionLog` null-guard `main.js:824` |
| 7 | `<details id="settings">` wholesale | `index.html:1735-1795` | see rows 8-12 |
| 8 | `#local-echo` checkbox | `index.html:1740-1743` | ⚠️ delete `main.js:324` ref + `:1252-1290` listeners + `:1414` PREF_CONTROLS entry; menu-bar `legacyMirrorId:'local-echo'` `:180` |
| 9 | `name="crlf"` radios | `index.html:1748-1750` | ⚠️ delete `main.js:325` ref + `:1271-1290` listeners + `:1474-1475` applyPrefs mirror; menu-bar mirror `:797` |
| 10 | `<details class="reserved">` | `index.html:1759-1762` | copy already in `#reserved-ctrl-modal` (E3.3); pure delete |
| 11 | `#auto-connect-checkbox` | `index.html:1773` | ⚠️ delete `chrome.js:255-261` wiring + `main.js:1415` PREF_CONTROLS entry; menu-bar `legacyMirrorId:'auto-connect-checkbox'` `:179` |
| 12 | `#reset-prefs-button` | `index.html:1784-1787` | ⚠️ delete `chrome.js:291` + the `:267-293` 2-click handler; Settings ▸ Reset is a separate machine (stays) |
| 13 | `[data-theme="crt"]` chrome override | `index.html:~70-74` | flips `--chrome-*` for old top-bar; base neutral values stay |
| 14 | `#menu-bar` neutral-shell pin | `index.html:~87-99` | redundant once #13 gone |
| 15 | `#status-bar` neutral-shell pin | `index.html:~143-159` | redundant once #13 gone |
| 16 | menu-bar coexistence-mirror comments/lines | `menu-bar.js:174,416-417,929-931,1189` | prune to post-E7 shape |
| — | **KEEP** `<details id="debug">` | `index.html:1798-1819` | the ONE pane that stays (AD-11/FR-23; e5 exception). Do not rename `#debug` (Flagged Q3). Note `#paste-test` lives here — keep its `main.js` wiring. |

**Delete-order safety:** rehome the paste row (Tasks 1-2) BEFORE deleting `#top-bar` (Task 3), so no paste path is ever pointed at a removed element mid-implementation. After each pane deletion, run the suite to catch a missed unguarded ref immediately.

### What must be preserved (non-negotiable)

- **`paste-pump.js` stays the single source of truth** (NFR-4). The toast subscribes via `onProgress`; it must NEVER call a pump setter, re-drive the queue, or own paste state (the E1.4 "projector-never-writes-machine / double-apply" lesson, cited across menu-bar.js).
- **Focus retention is sacred** (AD-10/NFR-1). Every toast control keeps terminal focus via `mousedown→preventDefault` (reuse `retainFocus` from `focus.js`). A paste in flight must not steal focus from the canvas.
- **Esc-cancel keeps working** (E1.2 passthrough guard + `keyboard.js:242-246`). Do not touch the keyboard Esc chain; just ensure the pump's `'cancelled'` event renders on the toast.
- **Every swept control's authoritative surface still works end-to-end** (AC-4). The sweep must leave the system working, not merely satisfy E7's own ACs — Connect, Send File, Download Log, Local echo, CR/LF, Auto-connect, Reset-all, Reserved-Ctrl modal are all reachable and functional via menu/modal after their legacy panes are gone.
- **The debug panel stays** (AD-11/FR-23; the one recorded exception). `<details id="debug">` + Debug ▸ Show Debug Panel toggle + `#paste-test`/`#input`/`#tx-strip`/Reset TX. Do NOT sweep it; do NOT rename its container id in this story.
- **Neutral chrome only** (AD-9/NFR-2): `var(--chrome-*)` tokens, no phosphor vars, no `[data-theme]` styling branch on the toast, no box-shadow. After the pin/override removal, chrome must look identical CRT↔Console.
- **No new dependency, no build step, named exports only** (AD-1/NFR-5). `paste-toast.js` is plain ESM under `renderer/`, added to `main.js` imports + one `wirePasteToast` call.
- **Boot order** (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. Wire the toast where the slide-chip is wired (it has the same "ready before first paste" need — `wirePastePump` runs at `main.js:785`, so the toast's `onProgress` subscription must be registered by then, i.e. wire the toast before/at that point).

### Reuse — do NOT reinvent

- **The transient-chip mechanic is done** — clone `slide-chip.js` (+ its `scroll-state.js` ancestor). No new primitive (e6 #4 "no new mechanic").
- **Focus retention is done** — `retainFocus(el)` from `renderer/focus.js` (E0.1). Do not hand-roll `mousedown→preventDefault`.
- **The confirm flow is done** — `clipboard.js:showLargePasteConfirm` already implements the `Promise<boolean>` gate and is null-safe; just point it at the toast instead of `#paste-progress-row`.
- **The pump is done** — subscribe to `onProgress`; do not re-plumb paste.
- **Single-sources exist** (e6 #3) — if the toast reads shared state, consume `window.__buildInfo` / `BUILD_UNKNOWN_SHA` / `.conn-dot` map / `CONN_STATUS_LABELS` rather than adding a sixth duplicated constant. (The toast likely reads none of these — its only derived text is the byte count + baud from the pump/clipboard; hoist the `4096` threshold to one constant if you touch it.)
- **The projectors already fail-open** — deletion of a mirrored legacy element is safe; you remove the dead mirror line, not add guards.

### Testing standards + codified idioms (re-embedded per E5.1 Q3 — intentionally per-story)

- **Boot-race guard first:** `await page.waitForFunction(() => window.__pasteToast && typeof window.__pasteToast.__getStateForTests === 'function' && window.__pastePump)` before driving anything (dodge the `window.__*` boot race).
- **Drive the toast:** programmatically via `window.__pasteToast.__resetForTests()` + state-entry methods (slide-chip spec idiom), AND/OR a real paste through the debug **`#paste-test`** button (`#input.fill('D'.repeat(4096))` + `#paste-test.click()`) — the debug panel stays, so `#paste-test` is still the paste driver. Assert byte totals via `window.__mockWriterLog`.
- **State assertions:** `window.__pasteToast.__getStateForTests().lifecycle`; text via `page.locator('#paste-toast-text').textContent()`; inline button via `page.locator('#paste-toast button[data-action="cancel"]').click()` guarded by `expect.poll` on existence.
- **Auto-hide:** poll `document.getElementById('paste-toast').hasAttribute('hidden')` → true within the timeout.
- **Esc-cancel oracle:** `page.keyboard.press('Escape')` mid-paste, assert no `0x1B` in `__mockWriterLog` and lifecycle → `cancelled` (paste.spec.js:84-102 pattern).
- **Port-lost:** `window.__simulateUnplug()` (paste.spec.js:141).
- **No-null-ref oracle:** listen for `pageerror`/`console.error` across a boot + paste with `#top-bar` absent; assert none (this is AC-2's teeth).
- **`force:true`** on any `aria-disabled`/`[hidden]` row you must click (E1/E2 idiom). **Snap-to-bottom** as the scrollback-flush fingerprint if relevant.
- **Flake policy — the ratified permanent mask:** `chromium-transport` project, `fullyParallel:false`, `retries:1` (`playwright.config.js:20-27`). Render specs → `chromium` project under `www/tests/render/`. `npm test` / `npm run test:fast` (`@fast`). **No per-story `--workers=1`.**
- **Migrate, don't silently drop:** for each spec asserting a removed id, replace with the equivalent toast/menu assertion; where a retired surface's assertion has no successor, note the intentional drop (don't leave coverage silently gone).

### Project Structure Notes

- **One new runtime module:** `www/renderer/paste-toast.js` (clone of `slide-chip.js`). Edits: `index.html` (toast markup + CSS; large deletions per the checklist), `main.js` (wire toast, delete inline observer + legacy paste/local-echo/crlf wirings), `input/clipboard.js` (redirect confirm to toast), `renderer/menu-bar.js` (prune mirrors), `renderer/chrome.js` (delete auto-connect + reset-prefs legacy wiring), `input/file-source.js` (drop `#send-file-button`/`#top-bar` reads), plus new + migrated specs.
- **New ids** kebab-case + feature-prefixed: `#paste-toast`, `#paste-toast-text` (mirroring `#slide-chip`/`#slide-chip-text`). `window.__pasteToast` test hook.
- **This is a large, delicate diff** (a feature clone + a wide deletion sweep). The E1.1 author *deliberately shipped additively* (231 insertions, 0 deletions) to defer exactly this; E7 is where the deletions land. Delete in the checklist order (rehome first, then top-bar, then panes, then pins), running the suite between groups so a missed unguarded ref surfaces immediately rather than at the end.
- **Milestone close:** E7.1 is the last story of `ui-rethink`. After it lands and the whole-branch review is recorded, all E7 rows read `done`; the six open E7-carry action items in `sprint-status.yaml` flip to `done`; `epic-e7-retrospective` is `optional`.

### References

- [Source: `epics.md:196-199` (§Epic E7) + `:612-632` (§Story E7.1)] — user story + the two epic ACs (toast on ≥4096 B with live progress; no null-ref after `#top-bar` removal). Depends on E0.
- [Source: `epics.md:60` (FR-29), `:110` (UX-DR15), `:88` (removal work: delete `#top-bar` + three `<details>`, orphaned `#paste-progress-row`, debug markup retained), `:203-206` (cross-cutting NFR-1/2/5/6 stated once for all stories)].
- [Source: `prds/prd-beastty-2026-07-01/prd.md:484-490` (FR-29 full + testable consequences), `:560-590` (NFR-1/2/4/5/6/7 verbatim), `:114/:130` (Glossary: paste toast is Chrome → bound by chrome NFRs)].
- [Source: `architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md:146-149` (AD-16 — paste-progress + confirm rehome as a transient `slide-chip`-precedent toast, NOT status/menu bar, driven by `paste-pump.onProgress`, prevents the `onPastePumpProgress` null-ref), `:100-103` (AD-7 — menu bar replaces `#top-bar` + the three `<details>`), `:110-114` (AD-9 — neutral shell, `--chrome-*` only, no `[data-theme]` styling branch), `:121-124` (AD-11 — debug panel is the only persistent in-page chrome), `:136-139` (AD-14 — no `getElementById` on removed `#top-bar` controls in the reset path), `:180-182` (Structural Seed — `#top-bar` + 3 `<details>` removed, debug retained)].
- [Source: `ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md:100` (paste confirm relocated to a small centered toast), `:192` (large paste ≥4096 B → centered toast); `DESIGN.md:198` (floating-chip pattern — `chrome-bg`, 1px border, `rounded/sm`, bracketed inline buttons)].
- [Source: `www/input/paste-pump.js:38-103` (API), `:177-179` (`fireProgress` fan-out), statuses at `:67,78,96,116/140,135`; `:21,24,107-110` (`CHUNK_SIZE`/`gapMs`/4 ms floor)] — the pump the toast subscribes to; single source of truth.
- [Source: `www/input/clipboard.js:90` (the `4096` literal threshold), `:100-132` (`showLargePasteConfirm` — the `Promise<boolean>` confirm to redirect to the toast; already null-safe)].
- [Source: `www/main.js:361-364` (paste DOM refs), `:1320-1355` (inline `onPastePumpProgress` observer to delete), `:1359-1360` (unguarded `pasteCancelBtn` listeners — the boot null-throw), `:791-800` (`wireClipboard` opts to trim), `:324-325`/`:1252-1290`/`:1474-1475` (legacy `#local-echo`/`#crlf-*` wirings to delete), `:1409-1480` (`PREF_CONTROLS`/`applyPrefs` — drop removed-id entries), `:1467`/`:1473` (`setLocalEcho`/`setCrlfMode` — the authoritative path that STAYS), `:785` (`wirePastePump`), `:853-873`/`:1176-1186` (slide-chip wiring/hook to mirror)].
- [Source: `www/renderer/slide-chip.js:1-537`] — the transient-chip module to clone. [Source: `www/renderer/scroll-state.js`] — its ancestor. [Source: `www/renderer/focus.js` `retainFocus`] — focus-retention primitive (E0.1).
- [Source: `www/renderer/menu-bar.js:174,231,416-417,419,793,797,929-931,1189-1201,1420-1421,1434` (coexistence mirrors + `legacyConnectBtnEl`/`projectSendFile` legacy reads to prune), `:179-180` (checkable `legacyMirrorId` entries), `:1150-1151` (`projectAutoConnect`/`projectLocalEcho` — stay, authoritative)].
- [Source: `www/renderer/chrome.js:255-261` (auto-connect-checkbox legacy wiring), `:267-293` (reset-prefs 2-click handler to delete), `:291`]. [Source: `www/input/keyboard.js:94-101` (`setLocalEcho`/`setCrlfMode`/`getCrlfMode` — authoritative module state), `:242-246` (Esc paste-cancel — unchanged), `:307-316` (CR/LF rewrite + local-echo forward path)].
- [Source: `www/input/file-source.js:204,583` (`#send-file-button`/`#top-bar` reads to remove/redirect)]. [Source: `www/renderer/status-bar.js:8` ("until E7" comment to prune)].
- [Source: `www/index.html:1641-1675` (`#top-bar`), `:1670-1674` (`#paste-progress-row`), `:636-679`/`~269-290`/`~572+` (top-bar CSS), `:1685-1698` (`<details id="connection">`), `:1735-1795` (`<details id="settings">` + nested `.reserved` + auto-connect + reset-prefs), `:1798-1819` (`<details id="debug">` — KEEP), `:1727-1731`/`:365-413` (slide-chip markup + CSS to mirror), `~70-74` (`[data-theme="crt"]` chrome override), `~87-99`/`~143-159` (neutral-shell pins)].
- [Source: `www/tests/transport/paste.spec.js:1-206` (paste driver + relocation invariant `:196`), `tests/transport/slide-chip.spec.js:1-361` (the spec to clone), `tests/render/menu-bar-keyboard.spec.js:49-96`, `tests/session/clipboard.spec.js:159`, `tests/transport/connect.spec.js:16`] — specs to clone/migrate. [Source: `www/playwright.config.js:20-27` — ratified `retries:1`/`chromium-transport` flake mask].
- [Source: `sprint-status.yaml` action items — the open E7 carry: e1#5 (`:81-83`), e2#4 (`:97`), e3#4 (`:117`), e4#4 (`:133`), e5#2 (`:145`), e6#1 (`:153` — the formal-sweep instruction), e6#2 (`:157` — whole-branch review), e6#3 (`:161` — single-source guard), e6#4 (`:165` — clone slide-chip / registry-derived text)]. [Source: `epic-e6-retro-2026-07-04.md:5,44-59,104-115,123-126`; `e1-1-menu-bar-shell-dropdown-mechanics.md:22,186-187`; `e5-1-debug-menu-panel-toggle.md:14,31-37,164`] — the sweep origin, mandate, debug exception, and whole-branch-review rationale.

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **One story or split?** E7.1 is defined as a single story that ships the paste toast **and** performs the whole dual-chrome sweep — a large, delicate diff (a feature clone + ~16 removal sites across 6 files). **Recommended default:** keep it one story, per e6 retro #1 ("close the retirement checklist to zero *alongside* the paste-toast feature") and #2 (one whole-branch review as the milestone's final pass) — the sweep and the toast are coupled (`#top-bar` removal orphans the row the toast rehomes), and the retros explicitly want one closing sweep. Mitigate the size with strict delete-order (rehome → top-bar → panes → pins) and a suite run between groups. **Alternative:** split into E7.1 (toast) + E7.2 (sweep) — cleaner diffs, but re-opens the "dual-chrome shipped mid-migration" risk between the two and needs two reviews. Recommend one story.
2. **Event-driven vs. 250 ms tick for the toast.** slide-chip runs a 250 ms `setInterval` because it samples SLIDE *throughput*. Paste progress arrives as discrete `'chunk'` events with exact `written/total`. **Recommended default:** render **event-driven** (update on each `'chunk'`) — no tick, simpler, exact. **Alternative:** copy the tick for visual consistency with the SLIDE chip. Recommend event-driven; drop the tick.
3. **Debug container id — `#debug` vs `#debug-panel`.** E5.1 Q1 left open whether the kept debug pane's container id stays `#debug` or is renamed `#debug-panel`. **Recommended default:** **leave `#debug` as-is** — renaming it is out of scope for E7 (the sweep *keeps* the debug panel; ~15 existing `#debug` fixtures depend on the id, and E5.1 deliberately kept it to avoid a spec sweep). **Alternative:** rename to `#debug-panel` for clarity. Recommend leave it — don't churn the one pane that survives.
4. **Toast position + confirm affordance styling.** UX says "small centered toast" with a large-paste confirm; the floating-chip precedent uses bracketed inline `[Cancel]`/`[Paste]` buttons. **Recommended default:** centered over the canvas via `translate(-50%,-50%)`, bracketed inline buttons matching the slide-chip's `button.slide-inline` styling (renamed `paste-inline`), 4px corner, no shadow. **Alternative:** a wider banner-style toast. Recommend the compact centered chip — it matches the precedent and the "small" spec.
5. **`4096` threshold — hoist to a named constant?** It's currently a literal in `clipboard.js:90`. **Recommended default:** hoist to a single exported `LARGE_PASTE_THRESHOLD` (in `clipboard.js` or a small shared module) that the toast/spec import — satisfies the e6 #3 single-source guard cheaply. **Alternative:** leave the literal (it appears in one runtime site). Recommend hoisting only if you touch the confirm path anyway; don't manufacture a module for it.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow).

### Debug Log References

- Full Playwright suite green post-migration: `chromium` project 359 passed / 0 failed (5 pre-existing timing-flaky specs pass on the ratified `retries:1`); `chromium-transport` project 166 passed / 0 failed (flaky slide-* specs pass on retry). `npm test` runs the `chromium` project only; the full run is `npx playwright test`.
- Regenerated the CRT visual baseline (`grid.spec.js-snapshots/crt-default-chromium-linux.png`) for the legitimate 1px wrapper-height reflow (771→770) from removing `#top-bar`.

### Completion Notes List

- **Toast (Task 1-2):** `renderer/paste-toast.js` clones the slide-chip transient-chip seam (module `lifecycle` state machine + `wirePasteToast(opts)` + `[hidden]` render + `window.__pasteToast` hooks). Event-driven (no 250ms tick). The `[Paste]`/`[Cancel]` buttons are **persistent** markup children wired once — an earlier innerHTML-per-tick approach detached the button mid-click; render now only updates `textContent` + toggles `hidden`. `#paste-toast` is a `<div role="status">` (not a `<button>`, which would have nested buttons — invalid HTML). Confirm path: `clipboard.js` stays DOM-agnostic, calling injected `confirmLargePaste(byteCount,{getBaud}) → Promise<boolean>`; `4096` hoisted to `LARGE_PASTE_THRESHOLD`.
- **Sweep (Task 3-5):** deleted `#top-bar` + `<details id="connection">` + `<details id="settings">` and every mirror-tied element/CSS/JS wiring; deleted the `[data-theme="crt"]` chrome-var override + `#menu-bar`/`#status-bar` neutral-shell pins (base `--chrome-*` tokens now the sole source — AD-9). `#send-file-input` re-created programmatically (hidden, off-screen, `id` retained for test-drivability) as the picker is real machinery, not a mirror; send-gate moved to file-source module state exposed via `getSendGate()` + `__getStateForTests().sendBtnDisabled`. `<details id="debug">` kept.
- **Tests (Task 6):** migrated ~20 specs off removed ids to their menu/modal/toast equivalents (Settings-menu checkables, Connection menu, File ▸ Download Session Log, `#paste-toast`), preserving coverage (intentional drops noted inline where a surface was retired). Added `tests/render/paste-toast.spec.js`.

### File List

**Runtime (modified):** `www/index.html`, `www/main.js`, `www/input/clipboard.js`, `www/input/file-source.js`, `www/renderer/chrome.js`, `www/renderer/menu-bar.js`, `www/renderer/status-bar.js`, `www/transport/serial.js`
**Runtime (new):** `www/renderer/paste-toast.js`
**Tests (new):** `www/tests/render/paste-toast.spec.js`, `www/tests/transport/menu-helpers.js`
**Tests (migrated):** `www/tests/transport/paste.spec.js`, `connect.spec.js`, `config.spec.js`, `errors.spec.js`, `lifecycle.spec.js`, `readloop.spec.js`, `reconnect.spec.js`, `slide-*.spec.js`; `www/tests/render/menu-bar*.spec.js`, `modal-default-focus.spec.js`, `reserved-ctrl-modal.spec.js`, `serial-config-modal.spec.js`, `status-bar.spec.js`; `www/tests/session/{clipboard,log-download,prefs,scrollback,auto-connect}.spec.js`; `www/tests/input/{local-echo,crlf-override,focus-retention,keydown-ctrl-letters,file-source,tx-sink}.spec.js`
**Test baseline (regenerated):** `www/tests/render/grid.spec.js-snapshots/crt-default-chromium-linux.png`

### Change Log

| Date | Change |
|---|---|
| 2026-07-04 | Story created (create-story workflow) — Status → ready-for-dev; `epic-e7` flipped `backlog → in-progress`. |
| 2026-07-04 | Tasks 1-6 executed: centered paste toast built (`paste-toast.js`); `#top-bar` + `<details id="connection">`/`<details id="settings">` + mirror wiring + `[data-theme="crt"]` chrome override swept; ~20 specs migrated + `paste-toast.spec.js` added; full Playwright suite green. |

### Code Review

**Outcome:** high-effort adversarial review of the E7.1 change surface (the whole-branch final sweep per e6 retro #2), run as three parallel review passes over the runtime diff + new module. **3 findings** (0 CRITICAL / 0 HIGH / 1 MEDIUM / 1 LOW-MEDIUM / + comment hygiene). **All fixed in `cbfcd35`** (the implementation commit; fixes were folded in before recording per this project's convention). Full Playwright suite green after fixes: `chromium` 360 passed / 0 failed, `chromium-transport` 166 passed / 0 failed (the ratified `retries:1` flake mask absorbs pre-existing timing-sensitive slide-*/zoom/clipboard specs; no new failures).

**Pass 1 — boot null-ref / removed-element hazards (AC-2 correctness core): CLEAN.** Traced every live `getElementById`/`querySelector`/`getElementsByName` in all nine runtime files against the current `index.html`; every reference resolves, is null-guarded, or targets an element the story deliberately re-creates (`#send-file-input`). Confirmed the ~60 textual hits for removed ids are all comments. Empirically corroborated: all 526 specs boot via `page.goto('/')` and pass, so no unguarded removed-element deref throws at boot. **AC-2 holds.**

**Pass 2 — new `renderer/paste-toast.js` + wiring:**
- **[MEDIUM] Overlapping-paste clobbered the confirm + leaked its Promise.** Because progress and confirm now share one toast element, a still-pumping small paste's `'chunk'`/`'complete'` events overwrote an open large-paste confirm and, on auto-hide, left `confirmLargePaste`'s Promise unresolved — silently dropping the ≥4096 B paste. A design regression from consolidating both into one toast. **Fixed:** `handleProgress` now returns early while `lifecycle === 'confirm'` (the pump keeps running underneath; the next event re-renders once the user resolves). Regression test added (`paste-toast.spec.js` — "a large-paste confirm is not clobbered by an overlapping paste's pump events").
- **[LOW-MEDIUM] A second overlapping `confirmLargePaste` abandoned the first Promise.** **Fixed:** added `settlePendingConfirm(ok)` — a superseding confirm (and defensively `hide()`) resolves any pending confirm `false` exactly once, so no awaiting caller ever hangs.
- Verified correct (no change): persistent-button fix (no innerHTML churn), focus retention (AD-10), cancel-does-not-mutate-pump-state (NFR-4), auto-hide timer discipline, `textContent`-only writes (no XSS/format regression from dropping `escapeHtml`).

**Pass 3 — dual-chrome sweep completeness:** dead CSS, surviving `[data-theme]` chrome-var overrides, and orphaned JS all **CLEAN — zero findings** (no live selector matches a deleted node; the only `[data-theme="crt"]` rules left style terminal/phosphor overlays, not `--chrome-*`; all legacy vars/opts removed with no dangling imports). **9 stale present-tense comments** (in `main.js`, `confirm-toggle.js`, `prefs.js`, `serial.js`, `menu-bar.js`) that still described the removed legacy surfaces as live were rewritten to historical/single-surface framing — clearing the E7 marker carry to historical-only.
