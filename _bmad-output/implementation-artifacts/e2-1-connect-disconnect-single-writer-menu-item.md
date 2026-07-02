---
baseline_commit: 275d8f906b49dbd2827239602e2ef3081375f992
---

# Story E2.1: Connect / Disconnect single-writer menu item

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want one Connect/Disconnect item that always reflects the true connection state,
so that the menu and status never disagree about whether I'm connected.

**Covers:** FR-12; NFR-4 (AD-15, AD-5). **Epic:** E2 · Connection & Serial Configuration. **Depends on:** E0, E1 (both `done`).

**Premise (epic-wide, confirmed):** pure relocation — every control keeps its exact v1.1 behavior and only moves to a new home. The `serial.js` connection **state machine is not touched**; only its *DOM projection* of the Connect button moves out. Any behavior change would be a separate future FR, out of scope here.

## Acceptance Criteria

Verbatim epic ACs (`epics.md` §Story E2.1, lines 378–387), decomposed and made testable. AC-1/AC-2 are the epic's two ACs; AC-3…AC-7 make the implicit "no behavior lost / no double-write / matches the dot" requirements falsifiable.

**AC-1 — Projection injected out; menu-bar is sole writer (FR-12, AD-15).**
Given `serial.js`'s connect-button DOM projection is injected out (the `state` machine + `onStateChange` fan-out + `getState()` unchanged; the button ref becomes optional/null-guarded),
When the connection state changes,
Then `menu-bar.js` is the **sole** writer of the Connect item and projects the state via a frozen label map — **Connect · Connecting… · Disconnect · Reconnecting… · Reconnect** (`Connecting…`/`Reconnecting…` use the literal U+2026 ellipsis),
And no write to the Connect DOM originates in `serial.js` anymore (no double-write), and the Connect item label always matches the status dot's `data-state`.

**AC-2 — Actions drive the unchanged serial path (FR-12).**
Given the user activates Connect / Disconnect / Reconnect (by menu item, and by the legacy `#connect-button` during the coexistence window — see Dev Notes §Coexistence),
When the action fires,
Then it drives the existing `serial.js` connect/disconnect path unchanged (transient states `connecting`/`reconnecting` are click-inert; `connected` → `disconnect()`; `disconnected`/`port-lost` → `connectMicroBeast()`) — pure relocation of the DOM wiring only.

**AC-3 — Status dot + label mirror state (FR-12, NFR-9, UX-DR3).**
Given the right-aligned menu-bar connection status placeholder (`#menu-conn-dot` + `#menu-conn-label`, `index.html:1134–1139`),
When the state changes,
Then `#menu-conn-dot`'s `data-state` snaps to a **discrete** color — gray `disconnected` · amber `connecting`/`reconnecting` · green `connected` · red `port-lost` — never animated/transitioned, red reserved for `port-lost` only, and `#menu-conn-label` reflects the state (see §Copy for the per-state label map),
And `menu-bar.js` is the sole writer of both `#menu-conn-dot` and `#menu-conn-label`.

**AC-4 — No incumbent behavior lost (FR-6, NFR-3): multi-adapter "Choose MicroBeast…" prompt preserved.**
Given the incumbent multi-adapter guard (`serial.js:678–683`) that today sets the button text to `Choose MicroBeast…` (U+2026) while entering `port-lost`,
When that guard fires (multiple CP2102N adapters, no identity match),
Then the Connect item (and coexistence button) still surfaces the verbatim `Choose MicroBeast…` label — the projection injection must not silently drop this out-of-band label (it is not representable by the 5-state map). See Dev Notes §"Choose MicroBeast…" for the required mechanism.

**AC-5 — Focus retention intact (NFR-1, AD-10, "Sacred").**
Given the Connect menu item and the coexistence button,
When the user clicks either,
Then terminal focus is never stolen (`retainFocus` / `mousedown→preventDefault`), and after the click `document.activeElement.id === 'terminal-wrapper'`.

**AC-6 — Cross-cutting invariants (stated once in `epics.md:203–206`).**
Uses only `var(--chrome-*)` / `var(--status-*)` tokens (NFR-2 — status colors are semantic, permitted); no new dependencies / no build step (NFR-5); `menu-bar.js` continues to expose `window.__menuBar` + `__getStateForTests` (NFR-6). `dispose()` unsubscribes the `onStateChange` subscriber; idempotent re-wire does not double-subscribe.

**AC-7 — Suite stays green (FR-6, AD-12).**
The full Playwright chromium suite passes (`npm test`), including the transport-project specs that use `#connect-button[data-state]` / label as the serial state-machine oracle. Boot order preserved: `menu-bar` wired before `wireKeyboard` (chords still win); polite-fail still first.

## Tasks / Subtasks

- [x] **Task 1 — Inject the DOM projection out of `serial.js`, keep the machine intact (AC-1, AC-2, AC-4).**
  - [x] Remove the DOM-projection code from `serial.js`: delete `applyStateToButton` (`serial.js:564–568`) and its two call sites — the `applyStateToButton()` line inside `setState` (`serial.js:560`, keep `state = s;` and the observer fan-out `serial.js:558–562`) and the initial-paint call at `serial.js:284`.
  - [x] Move `BUTTON_LABELS` (`serial.js:37–43`) OUT of `serial.js` — it becomes `menu-bar.js`'s connect label map (Task 2). Delete it from `serial.js`.
  - [x] Remove the click/mousedown wiring from `serial.js` (`serial.js:243–244`). **Export the toggle action** so the wiring can relocate without duplicating machine logic: rename `onConnectButtonClick` (`serial.js:287–297`) to an exported `toggleConnection()` (`export async function toggleConnection()`) — its `state`-branch logic stays in `serial.js` (it reads the internal `state`). Add it to the public-API header comment (`serial.js:3–4`).
  - [x] Make the `connectButton` ref optional/null-guarded per AD-15: keep the `connectButton: btn` opt intake (`serial.js:105,116`) tolerant of `undefined`; remove the direct button write at the multi-adapter guard (`serial.js:680`) and replace it with an injected, null-guarded signal (see Task 4 / §"Choose MicroBeast…").
  - [x] **Do NOT touch:** `state` (`serial.js:49`), `setState`'s `state = s;` + fan-out, `onStateChange` (`:448–454`), `getState` (`:446`), `stateObservers` (`:55`), `connectMicroBeast`/`disconnect`, or any transition site.
- [x] **Task 2 — Make `menu-bar.js` the sole writer: add the connect projection (AC-1, AC-3).**
  - [x] Add a frozen label map at module top (mirror `serial.js` `BUTTON_LABELS` verbatim, incl. U+2026): `const CONNECT_LABELS = Object.freeze({ disconnected:'Connect', connecting:'Connecting…', connected:'Disconnect', reconnecting:'Reconnecting…', 'port-lost':'Reconnect' });` and a `const CONN_STATUS_LABELS` for `#menu-conn-label` (see §Copy).
  - [x] Add a private `projectConnection(state)` — the **sole writer** of: the Connect menu item (`.lbl` text ← `CONNECT_LABELS[state]`; `dataset.state ← state`), `#menu-conn-dot` (`dataset.state ← state`), `#menu-conn-label` (`textContent ← CONN_STATUS_LABELS[state]`), and the coexistence `#connect-button` (see Task 3). Guard every lookup (no-throw on absent DOM, mirroring `projectPrefs`'s contract, `menu-bar.js:805–837`). It must **never** call a serial setter / connect / disconnect (reading state must not re-drive the machine — the E1.4 double-apply lesson, retro `:60–63`).
  - [x] Give the Connect item a stable hook: add `id="menu-connect-item"` + `data-action="connect-toggle"` to the placeholder button (`index.html:967–969`). Wire its click through the existing item path (`onItemClick` → a `connect-toggle` branch calling the injected `toggleConnection` then `closeMenu()`), OR bind directly — either way it must fire `toggleConnection` and close the menu (action semantics). `retainFocus(item)` is already applied to every `.menu-item` at `menu-bar.js:590` — no extra call needed.
  - [x] Subscribe inside `wireMenuBar`: `connUnsub = opts.onConnectionStateChange?.(projectConnection)` and do an initial `projectConnection(opts.getConnectionState?.() ?? 'disconnected')`. Store `connUnsub` in module scope; call it at the top of `wireMenuBar` (idempotent re-wire) and in `dispose()` (`menu-bar.js:855–866`) so re-wire never double-subscribes (AC-6).
- [x] **Task 3 — Coexistence: keep `#connect-button` a valid oracle until E7 (AC-2, AC-7).**
  - [x] In `projectConnection`, also project onto the legacy `#connect-button` (label `.textContent` + `dataset.state`) — null-guarded — so the ~8 transport/session specs that read `#connect-button[data-state]` stay green without churn. Wire the legacy button's click → `toggleConnection` and `mousedown→preventDefault` inside `menu-bar.js` (it moved out of `serial.js`).
  - [x] Leave a single retirement marker comment tying the coexistence-mirror lines to E7 `#top-bar` removal (retro open action #5, `sprint-status.yaml:80–83`).
- [x] **Task 4 — Wire the seam in `main.js` (AC-1, AC-7).**
  - [x] Extend the serial import (`main.js:83`) to also import `onStateChange`, `getState`, `toggleConnection`.
  - [x] Pass them into the existing `wireMenuBar({...})` opts block (`main.js:313–329`) as `onConnectionStateChange: onStateChange`, `getConnectionState: getState`, `toggleConnection`. (Injection-via-opts, not direct import — AD-3 allowlist is canvas+prefs only.)
  - [x] Stop passing `connectButton` into `wireSerial` (or pass `undefined`) — `main.js:940`. Keep the `#connect-button` DOM element ref for the coexistence wiring if `menu-bar` needs it via opts, or let `menu-bar` `getElementById` it (matching how it discovers `#menu-conn-dot`).
  - [x] Boot-order note: `wireMenuBar` (`main.js:313`) runs before `wireSerial` (`main.js:935`). Subscribing early is safe — `stateObservers`/`state` exist at module-eval; the subscriber captures the first `setState` fired during `wireSerial`, and the initial `getState()` read yields `'disconnected'` → `Connect`/gray. Do **not** reorder wiring.
- [x] **Task 5 — CSS for the dot's discrete states (AC-3, AC-6).**
  - [x] Add `#menu-conn-dot[data-state]` color rules mirroring `#connect-button` (`index.html:534–537`): `connecting`,`reconnecting` → `var(--status-amber)`; `connected` → `var(--status-green)`; `port-lost` → `var(--status-red)`; default/`disconnected` → `var(--status-gray)` (already the base, `index.html:128–132`). No transitions (discrete snap, UX-DR3).
- [x] **Task 6 — Preserve "Choose MicroBeast…" (AC-4).**
  - [x] Replace `serial.js:680` direct write with a null-guarded injected signal, e.g. `opts.signalConnectLabel?.('Choose MicroBeast…')`. Implement `signalConnectLabel(label)` in `menu-bar.js` (passed via `wireMenuBar` opts from `main.js`) to write that override label to the Connect item + coexistence button until the next `setState` fan-out re-projects. (See §"Choose MicroBeast…" for rationale + the flagged alternative.)
- [x] **Task 7 — Tests (AC-1…AC-7).**
  - [x] New spec `www/tests/render/menu-bar-connection.spec.js` (chromium project): assert the Connect item label + `data-state` and the dot/label track state across `disconnected→connecting→connected→…→port-lost→reconnecting`, driven via `window.__menuBar.open('connection')` + a mock-serial transition. Assert label ↔ dot lockstep (AC-1/AC-3) using the `data-*` idiom (`menu-bar.spec.js:199–210`).
  - [x] Assert focus retention after a Connect click (`document.activeElement.id === 'terminal-wrapper'`, idiom `menu-bar-keyboard.spec.js:155–157`).
  - [x] Verify the existing transport/session oracles still pass unchanged (`transport/connect.spec.js`, `reconnect.spec.js`, `lifecycle.spec.js`, `session/auto-connect.spec.js`, `session/log-download.spec.js`) — they read `#connect-button[data-state]`, kept valid by Task 3. Run the FULL suite (`npm test`), not just `@fast`.

## Dev Notes

### The one-paragraph mental model

`serial.js` owns the connection **state machine** and already broadcasts every transition through `onStateChange(fn)` (fired inside `setState`, `serial.js:558–562`). Today `serial.js` *also* projects that state onto `#connect-button` via `applyStateToButton` — that's the DOM projection AD-15 says must move. This story cuts the projection out of `serial.js` and makes `menu-bar.js` the **sole writer** of every Connect surface (new menu item, `#menu-conn-dot`, `#menu-conn-label`, and — during coexistence — the legacy `#connect-button`), by subscribing to `onStateChange` and mapping `state → frozen label map + data-state`. The machine, `onStateChange`, and `getState()` are untouched. This is the canonical AD-5/AD-6/AD-15 "fed, single-writer, no second source of truth" shape.

### Exact code sites (verified against the current tree)

**`www/transport/serial.js`** (state machine — do not alter the machine):
- States (`serial.js:49`, `:37–43`): `disconnected | connecting | connected | reconnecting | port-lost`. Initial `state = 'disconnected'`.
- `onStateChange(fn)` — `serial.js:448–454`; pushes `fn` into `stateObservers` (`:55`), returns an unsubscribe closure. Fires with the single new-state string.
- `getState()` — `serial.js:446`.
- `setState(s)` — `serial.js:558–562`: `state = s; applyStateToButton(); for (const fn of stateObservers) fn(s);`. **Delete only the `applyStateToButton()` line.**
- `BUTTON_LABELS` — `serial.js:37–43` (move to `menu-bar.js`).
- `applyStateToButton` — `serial.js:564–568` (writes `dataset.state` + `textContent`; delete, incl. initial call at `:284`).
- Click/mousedown wiring — `serial.js:243–244` (relocate to `menu-bar.js`).
- `onConnectButtonClick` (toggle logic) — `serial.js:287–297` (rename → export `toggleConnection()`; keep the `state` branching in `serial.js`).
- Multi-adapter out-of-band write — `serial.js:680` (`connectButton.textContent = 'Choose MicroBeast…'`; replace with injected signal, Task 6).
- `wireSerial` opts intake — `serial.js:103–116` (`connectButton: btn` → `connectButton = btn`); make null-tolerant.

**`www/renderer/menu-bar.js`** (the new sole writer — zero serial awareness today):
- Imports (AD-3 allowlist) `menu-bar.js:40–54`: `focus.js`, `prefs.js`, `canvas.js` only — serial arrives via **opts**, never a direct import.
- `wireMenuBar(opts = {})` — `menu-bar.js:164`; reads opts at `:168–184`, idempotent (`removeTrackedListeners()` at `:167`), discovers DOM by convention (`menu-${key}`/`dropdown-${key}`), `render()` at `:231`, returns `buildApi()`.
- Item dispatch — `onItemClick` `menu-bar.js:602–627`; `data-action` items route to `runViewAction` (`:624`). Add a `connect-toggle` action branch (or a dedicated bind). `retainFocus(item)` applied to every item at `:590`.
- `render()` — `menu-bar.js:731–754` is the **sole writer of open/close** state; your `projectConnection` is a *separate* projection (label/dot/state), and must never write open/close state.
- `projectPrefs` — `menu-bar.js:805–837`: the exact contract to mirror (read-at-use, no-throw, idempotent, never call a setter). Connection state is **not a pref**, so `projectConnection` does **not** ride `projectPrefs` (which only fires on `resetPrefs()`); it rides the `onStateChange` subscription + an initial paint.
- `buildApi()` — `menu-bar.js:841–853`; `dispose()` — `:855–866` (add `connUnsub?.()`); `__getStateForTests` — `:870–889`.

**`www/main.js`** (composition root):
- Serial import — `main.js:83` (`import { wireSerial } …`); extend with `onStateChange, getState, toggleConnection`.
- `wireMenuBar({...})` opts — `main.js:313–329`; add `onConnectionStateChange`, `getConnectionState`, `toggleConnection`, `signalConnectLabel` handled inside menu-bar. `window.__menuBar = menuBar` at `:330`.
- `wireSerial({...})` — `main.js:935–959`; stop passing `connectButton` (`:940`).
- Boot order: `wireMenuBar` `:313` → `wireKeyboard` `:520` → `wireSerial` `:935`; `prefsSubscribe(menuBar.projectPrefs)` `:1195`.

**`www/index.html`:**
- Connect item placeholder (bare action, **no id, no `data-action`**) — `index.html:967–969`. Add `id` + `data-action`.
- Status placeholder — `#menu-conn-dot` (`:1137`, `aria-hidden="true"`, gray-only) + `#menu-conn-label` (`:1138`, text `Not connected`), `index.html:1134–1139`.
- Dot CSS — `index.html:128–132`; status tokens `--status-green/amber/red/gray` — `index.html:51–54`; precedent `[data-state]` dot-color rules to copy — `#connect-button` `index.html:534–537`.
- Legacy coexistence button — `#connect-button` inside `#top-bar` — `index.html:1156–1158` (retires with `#top-bar` in E7, `:1172–1173`).

### Coexistence — the load-bearing decision (read before coding)

`#top-bar` and its `#connect-button` are **not removed** in E2.1 — full deletion is deferred to **E7** (E1 retro open action #5, `sprint-status.yaml:80–83`; markup note `index.html:1172–1173`). `#connect-button[data-state]` + its label are the **proven serial state-machine oracle** across the transport/session suite: `transport/connect.spec.js:16–97`, `transport/reconnect.spec.js:34–146`, `transport/lifecycle.spec.js:33–71`, `session/auto-connect.spec.js:59–107`, `session/log-download.spec.js`, `session/clipboard.spec.js:39–41`, `menu-bar-keyboard.spec.js:47–48`.

**Chosen approach (recommended): coexistence-mirror.** `menu-bar.js` (now the sole writer) projects state onto **both** the new surfaces **and** the legacy `#connect-button`, and owns the legacy button's click. Rationale: keeps the diff tiny (`serial.js` + `menu-bar.js` + `main.js` + `index.html` + one new spec), preserves every incumbent test untouched, honors AD-15 single-writer (only `menu-bar` writes the button now, not `serial.js`), and lets `#top-bar` retire cleanly in E7 by deleting the mirror lines. It does *not* re-introduce a second writer — `serial.js` no longer writes any Connect DOM.
**Rejected alternative: retarget every `#connect-button` assertion onto the menu item.** Churns ~8 specs — several in the flaky-prone `chromium-transport` project — couples serial-machine tests to menu-bar chrome, and enlarges the blast radius against the pure-relocation premise. (Surfaced as a flagged question below in case Ant prefers the clean-cut.)

### "Choose MicroBeast…" — the out-of-band label (AC-4)

`serial.js:678–683` handles the multi-adapter case: multiple CP2102N adapters, no identity match → `setState('port-lost')` **and** button text `Choose MicroBeast…` (U+2026). The label is *not* in the 5-state map, so moving the projection out will drop it unless preserved. FR-6/NFR-3 ("no incumbent behavior lost") make preservation mandatory here.
**Required mechanism:** replace the direct write with a null-guarded injected signal (`opts.signalConnectLabel?.('Choose MicroBeast…')`) that `menu-bar.js` renders onto the Connect item + coexistence button until the next `setState` re-projects. This keeps single-writer (menu-bar owns the DOM write; serial only passes the string). The `Choose MicroBeast…` *menu item* (FR-13, `index.html:970–973`, currently `data-disabled`) is E2.2's job — E2.1 only preserves the incumbent button-label prompt, it does not build the multi-adapter picker.

### Copy (verbatim-sourced where it exists; one gap flagged)

- Connect item label map — verbatim from `serial.js:37–43`: `Connect · Connecting… · Disconnect · Reconnecting… · Reconnect` (U+2026, not three dots). This is canonical and must not be paraphrased.
- `#menu-conn-label` per-state text — verbatim-sourced: `disconnected → 'Not connected'` (placeholder + EXPERIENCE.md idle), `connecting → 'Connecting…'`, `reconnecting → 'Reconnecting…'` (EXPERIENCE.md state table `:141–145`). `connected` and `port-lost` menu-bar-label wording are **not** verbatim-specified (EXPERIENCE.md leaves the compact top-bar label under-specified vs the E4 bottom status bar which owns the device/baud line). **Default:** `connected → 'Connected'`, `port-lost → 'Connection lost'`. Flagged for Ant below. Colors are governed strictly (DESIGN.md `:134–138`): red is reserved for `port-lost` + security only.

### What must be preserved (non-negotiable — from AD-13/FR-6/NFR-3)

- The `serial.js` state machine, `onStateChange`, `getState`, `stateObservers`, every `setState(...)` transition site, and `onConnectButtonClick`'s state-branch semantics (as the exported `toggleConnection`).
- Focus retention on every Connect surface (NFR-1/AD-10 "Sacred", D-16).
- Boot order (AD-12): `menu-bar` before `wireKeyboard`; polite-fail first. Do not reorder `main.js` wiring.
- Discrete status colors, never animated (UX-DR3, NFR-9).

### Testing standards + codified idioms (E1 retro action #4 — codify for E2, `sprint-status.yaml:76–79`)

- **Project:** chromium only. New spec under `www/tests/render/` runs in the light `chromium` project (`playwright.config.js:33–51`); the `#connect-button` oracles live in `chromium-transport` (`fullyParallel:false`, `retries:1` — the post-E1 flake fix; no per-story `--workers=1` needed). Run: `npm test` (full) / `npm run test:fast` (`@fast` grep).
- **Boot-race guard:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')` before driving (`menu-bar.spec.js:23–28`).
- **Deterministic menu-open idiom:** `await page.evaluate(() => window.__menuBar.open('connection'))` — NOT a title `.click()` (which toggles a still-open menu shut). (`view-theme-phosphor.spec.js:26–30`.)
- **`force:true` on `aria-disabled` rows** to prove inertness (`menu-bar.spec.js:235–241`).
- **`data-focused` (not `:focus-visible`) drives highlight** — assert via attribute (`menu-bar.spec.js:183–185`); terminal keeps real DOM focus (Chromium under-fires `:focus-visible` here).
- **`retainFocus` assertion:** `document.activeElement.id === 'terminal-wrapper'` after driving (`menu-bar-keyboard.spec.js:155–157`).
- **Label ↔ state lockstep idiom** to mirror for Connect (`menu-bar.spec.js:199–210`, `:281–290`): flip state, assert `.lbl` text + `data-state` + any ARIA move together.
- **Introspection:** `window.__menuBar.__getStateForTests()` for `openMenu`/`focusedLabel` rather than brittle DOM.
- Existing status-placeholder assertion to update (it hard-codes gray + "Not connected"): `menu-bar.spec.js:60–68` — once the dot is live, adjust or gate it to the initial `disconnected` state.

### Project Structure Notes

- No new module — this story extends `renderer/menu-bar.js`, slims `transport/serial.js`, edits `main.js` + `index.html`, and adds one spec. Aligns with the Structural Seed (`ARCHITECTURE-SPINE.md:174–194`).
- AD-3 dependency direction respected: serial reaches menu-bar **only** via `main.js` opts injection (like `term`/`getScrollState`), never a direct import.
- No new dependencies, no build step (NFR-5): plain ESM, named exports, one `wireXxx(opts)` seam.
- **Variance to track:** the coexistence-mirror onto `#connect-button` is a temporary dual-chrome affordance; it must retire with `#top-bar` in E7 (leave the marker comment). This is the exact "dual-chrome never shipped mid-migration" concern in E1 retro action #5.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story-E2.1 (lines 370–387)] — story statement + the two epic ACs.
- [Source: `_bmad-output/planning-artifacts/epics.md`#FR-12, #NFR-4 (lines 43, 70)] — FR/NFR coverage.
- [Source: `.../architecture/.../ARCHITECTURE-SPINE.md`#AD-15 (lines 141–144)] — Connect item single writer; projection injected out of serial.js.
- [Source: `ARCHITECTURE-SPINE.md`#AD-5 (lines 90–93), #AD-6 (95–98), #AD-7 (100–103), #AD-3 (80–83), #AD-9 (110–114), #AD-12 (126–129)] — federated-subscribe, fed-not-owned, menu ownership, import allowlist, neutral shell, boot order.
- [Source: `.../ux-designs/.../EXPERIENCE.md` (lines 34–46, 137–147, 208–239)] — Connection menu inventory + connection state-machine table + connect flows.
- [Source: `.../ux-designs/.../DESIGN.md` (lines 14–17, 96–99, 134–138, 196)] — four discrete status-dot tokens; red reserved for port-lost/security.
- [Source: `www/transport/serial.js:37–43, 243–244, 284, 287–297, 446–454, 558–568, 678–683`] — the projection to move + the machine to preserve.
- [Source: `www/renderer/menu-bar.js:40–54, 164–232, 590, 602–627, 805–837, 855–889`] — wiring shape, item dispatch, projectPrefs contract, dispose, test hooks.
- [Source: `www/main.js:83, 313–330, 935–959`] — import + wireMenuBar/wireSerial seams.
- [Source: `www/index.html:51–54, 128–132, 534–537, 967–969, 1134–1139, 1156–1173`] — tokens, dot CSS, Connect item + status placeholders, legacy button.
- [Source: `_bmad-output/implementation-artifacts/epic-e1-retro-2026-07-02.md`] & [`sprint-status.yaml:76–83`] — codify menu test idioms (action #4); track dual-chrome to E7 (action #5).
- [Source: `www/tests/render/menu-bar.spec.js`, `view-theme-phosphor.spec.js`, `menu-bar-keyboard.spec.js`; `www/tests/transport/{connect,reconnect,lifecycle}.spec.js`; `www/tests/session/auto-connect.spec.js`] — idioms to reuse + oracles to keep green.
- [Source: `www/playwright.config.js:33–51`, `www/package.json:7–11`] — chromium/chromium-transport projects; test scripts.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Amelia / bmad-dev-story)

### Debug Log References

- `node --check` on serial.js / menu-bar.js / main.js — all OK after the refactor.
- `npx playwright test` (all projects) — 396 passed, 1 skipped. The `chromium-transport`
  `#connect-button[data-state]`/label oracles (connect/reconnect/lifecycle/errors/auto-connect/
  log-download) stayed green unchanged via the Task 3 coexistence mirror — including
  `errors.spec.js:114` "Choose MicroBeast…" (now driven by the injected `signalConnectLabel`).
- `npm test` (chromium project, AC-7 literal gate) — 233 passed, 1 skipped.
- New spec `menu-bar-connection.spec.js` — 9/9 passing in isolation across repeated runs.
- Flake note: a subset of specs (incl. two of the new ones) are marked flaky-but-passed under
  full 9-worker parallelism — the documented wasm-boot contention the E1 retro fixed with
  `retries:1` (playwright.config.js:27). Same class as the pre-existing phosphor/modal/keyboard
  flakes; not a logic failure (the affected new tests are pure `projectConnection` projections
  and pass every time in isolation). Consistent with the ratified flake protocol.

### Completion Notes List

- **AC-1/AC-3 (sole writer):** `serial.js` no longer writes any Connect DOM. `applyStateToButton`
  + `BUTTON_LABELS` deleted; `setState` now only fans out to `stateObservers`. `menu-bar.js`'s new
  `projectConnection(state)` is the single writer of the Connect item (`.lbl` + `data-state`),
  `#menu-conn-dot` (`data-state`), `#menu-conn-label` (`textContent`), and the coexistence
  `#connect-button`. Frozen `CONNECT_LABELS` (moved verbatim, incl. U+2026) + `CONN_STATUS_LABELS`.
- **AC-2 (unchanged serial path):** `onConnectButtonClick` → exported `toggleConnection()` (state
  branching unchanged, reads internal `state`). The `#menu-connect-item` (`data-action=connect-toggle`)
  and the relocated `#connect-button` click both call it via menu-bar; menu closes on the item action.
- **AC-3 (discrete dot):** `#menu-conn-dot[data-state]` CSS mirrors `#connect-button` (amber transient,
  green connected, red port-lost only), no transition — discrete snap.
- **AC-4 ("Choose MicroBeast…"):** `serial.js:680` direct write replaced by `opts.signalConnectLabel?.(…)`;
  `menu-bar.js` renders the override onto the Connect action surfaces (dot/status label keep port-lost).
- **AC-5 (focus retention):** every `.menu-item` already gets `retainFocus`; the relocated
  `#connect-button` gets `retainFocus` in menu-bar. Both clicks leave `activeElement === #terminal-wrapper`.
- **AC-6 (lifecycle):** `connUnsub` stored; called at the top of `wireMenuBar` (idempotent re-wire) and
  in `dispose()` so the `onStateChange` subscriber never double-registers. `window.__menuBar` /
  `__getStateForTests` unchanged. Only `var(--chrome-*)`/`var(--status-*)` tokens; no new deps / build step.
- **AC-7 (suite + boot order):** full suite green; boot order untouched (`wireMenuBar` still before
  `wireKeyboard`; polite-fail first). `main.js` injects `onStateChange`/`getState`/`toggleConnection`
  via `wireMenuBar` opts (AD-3 — no serial import in menu-bar) and stops passing `connectButton` to
  `wireSerial`; the now-dead `connectButton` const was removed (menu-bar self-discovers `#connect-button`).
- **Coexistence:** retirement markers left tying the `#connect-button` mirror lines to E7 `#top-bar`
  removal (E1 retro open action #5).
- **Flagged defaults (both ratified with Ant / per story):** coexistence-mirror approach chosen;
  `connected → 'Connected'` / `port-lost → 'Connection lost'` status wording.

### File List

- `www/transport/serial.js` (modified) — removed DOM projection (applyStateToButton, BUTTON_LABELS,
  click/mousedown wiring, initial paint); exported `toggleConnection()`; added `signalConnectLabel`
  opt intake + module signal; multi-adapter guard now signals the label instead of writing the button.
- `www/renderer/menu-bar.js` (modified) — added `CONNECT_LABELS`/`CONN_STATUS_LABELS`, `projectConnection`,
  `signalConnectLabel`, connection opts + DOM refs, subscription + initial paint, `connect-toggle`
  action branch, legacy `#connect-button` click/retainFocus wiring, `connUnsub` in re-wire + `dispose()`,
  API exposes `projectConnection` + `signalConnectLabel`.
- `www/index.html` (modified) — Connect item `id="menu-connect-item"` + `data-action="connect-toggle"`
  + `data-state`; `#menu-conn-dot[data-state]` discrete colour rules.
- `www/main.js` (modified) — import `onStateChange`/`getState`/`toggleConnection`; inject via `wireMenuBar`
  opts; pass `signalConnectLabel: menuBar.signalConnectLabel` to `wireSerial`; drop `connectButton`.
- `www/tests/render/menu-bar-connection.spec.js` (new) — 9 tests covering AC-1…AC-6.

### Change Log

- 2026-07-02 — E2.1 implemented: Connect-button DOM projection injected out of `serial.js`; `menu-bar.js`
  is now the sole writer of every Connect surface (menu item, status dot + label, coexistence
  `#connect-button`) via `projectConnection` fed by `onStateChange`. `toggleConnection()` exported;
  "Choose MicroBeast…" preserved via injected `signalConnectLabel`. New render spec added; full suite green.
