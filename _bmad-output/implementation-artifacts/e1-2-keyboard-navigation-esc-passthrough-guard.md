---
baseline_commit: 4cb52a3c5f2cfa0c31abc1fba7abc80d8246b056
---

# Story E1.2: Keyboard navigation + Esc passthrough guard

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a keyboard-first MicroBeast operator,
I want to drive the whole menu system from the keyboard without stealing Esc from the terminal,
so that I never touch the mouse and in-flight SLIDE / paste cancels still work.

**Covers:** FR-3 (full keyboard navigation), FR-4 (Esc passthrough guard); NFR-7 (keyboard operability). AD-7 (Esc early-return-without-`preventDefault`), AD-12 (boot-order / `defaultPrevented` listener chain).
**Depends on:** E1.1 (`menu-bar.js` shell + dropdown open/close state machine + markup) — **done**. E0.1 (`retainFocus`) — done, already applied to every title/item by E1.1.

## ⚠️ Scope Decision — READ FIRST (nav mechanics only; no submenu panels, no real actions)

This story adds the **keyboard layer** on top of the E1.1 shell. It does **not** build submenu panels and does **not** wire any menu item to a canvas/prefs setter.

1. **Submenu panels do not exist yet.** The View / Settings dropdowns contain `data-variant="radio-submenu"` rows (Theme, Phosphor, Font, Enter-key-sends) that are **inert `▸` placeholders** — there is no second-level panel in the DOM. The real submenus land in **E1.4 / E1.5**. Therefore the FR-3 clause *"Enter/→ open a submenu"* is implemented in E1.2 as a **submenu-open hook / protocol seam**: pressing Enter or → on a `radio-submenu` row is a **structural no-op that keeps the menu open** (never closes it, never throws), leaving a single documented call site for E1.4/E1.5 to attach a real submenu panel. Do **not** invent submenu panels here.

2. **"Closes one level" has one level today.** With no submenus, the only open level is the dropdown itself. Esc (menu open) → close the dropdown. When E1.4/E1.5 add submenus, Esc will close the submenu first, then the dropdown — E1.2 must express "close one level" so that extension is natural, but only the dropdown level exists to close now.

3. **Item activation reuses E1.1 semantics verbatim.** Enter on an **action** item fires the (still-placeholder) action and closes the menu; Enter on a **checkable** item toggles `data-checked` and **keeps the menu open**; Enter/→ on a **radio-submenu** row is the no-op hook (1); a **disabled** item is inert and never receives focus. Real per-item actions are E1.4/E1.5, E2, E3, E5 — unchanged by this story.

4. **No behavior change to the incumbent `#top-bar` / `<details>` chrome.** They still coexist (retired later per E1.1's Scope Decision). This story touches only `menu-bar.js`, the menu-bar keydown path, and a new spec.

## Acceptance Criteria

1. **Full keyboard navigation of the menu bar (FR-3; NFR-7).**
   **Given** the menu bar is rendered and a dropdown is open (or a title is the active menu)
   **When** the user presses ←/→, ↑/↓, Enter/→, or Esc
   **Then** **←/→ move between menus** (open the previous/next menu, wrapping at the ends), **↑/↓ move the focused item** within the open dropdown, **Enter** activates the focused item (action fires+closes; checkable toggles+stays open; radio-submenu invokes the submenu-open hook and stays open), **→** on a radio-submenu row invokes the same submenu-open hook, and **Esc** closes one level (see AC-3).
   **And** the focused item is indicated **only** by the `[data-focused="true"]` attribute (the E1.1 highlight) — the code **never** calls `.focus()` / `.blur()` on a title or item, so terminal focus is retained (NFR-1, "sacred").

2. **Disabled items are skipped and announced (FR-3; NFR-7; UX-DR7).**
   **Given** a dropdown containing a `data-disabled="true"` item (e.g. File ▸ Download Session Log, Connection ▸ Choose MicroBeast…)
   **When** the user moves ↑/↓ through the list
   **Then** the disabled item is **skipped** in the focus order (never becomes `[data-focused]`) and Enter/→ on it is inert
   **And** its reason is **announced** — the existing `title` reason string is surfaced to assistive tech via an `aria-live` (polite) region owned by `menu-bar.js` when navigation lands next to / passes it (pragmatic announcement, not a per-keystroke spam).

3. **Esc closes one level when a dropdown is open, and passes through otherwise (FR-4; AD-7).**
   **Given** the menu-bar Esc handler
   **When** Esc is pressed **with a dropdown open**
   **Then** it closes the dropdown (one level) **and** calls `e.preventDefault()` — so `keyboard.js`'s Esc chain (selection-drag-cancel → SLIDE-cancel → paste-cancel → encode `0x1B`) does **not** also fire (it short-circuits on `e.defaultPrevented`).
   **And when** Esc is pressed **with no dropdown open**, the handler **early-returns without `preventDefault`** (and without any other side effect), so `keyboard.js` receives the Esc and paste-cancel / SLIDE-cancel / selection-cancel / `0x1B` encoding all still work exactly as before.

4. **Listener ordering is load-bearing and preserved (AD-12; NFR-8).**
   **Given** the menu-bar keydown listener is attached to `#terminal-wrapper` (the same target as `chrome.js` and `keyboard.js`)
   **When** a key is pressed
   **Then** the invocation order is **`chrome.js` chords → `menu-bar` nav → `keyboard.js` terminal**, because `menu-bar` is wired **after** `wireChrome` and **before** `wireKeyboard` (unchanged E1.1 seam) and all three short-circuit on `e.defaultPrevented`
   **And** chord keys (Ctrl+Alt+T, Ctrl+=, Ctrl+-, Ctrl+0) still reach `chrome.js` first and are never swallowed by menu nav, and non-Esc keys pressed while **no** menu is open are **not** `preventDefault`ed by `menu-bar` (they pass to `keyboard.js` untouched).

5. **No regression; suite green (NFR-3).**
   **Given** the keyboard layer is added
   **When** the full Playwright chromium suite runs
   **Then** every incumbent behavior still fires (Esc paste-cancel, Esc SLIDE-cancel, Esc selection-cancel, bare-Esc `0x1B` encode when idle, Ctrl+Shift+Esc selection-clear, all chords) and the suite stays green — judged by named oracles in isolation (`--workers=1`) where the pre-existing parallel-load/wasm-boot flake interferes (E0 action item #1).

6. **Testability (AD-2; NFR-6).**
   **Given** AD-2 module conventions
   **When** the module is wired
   **Then** `window.__menuBar.__getStateForTests()` additionally exposes the **focused-item index** (or focused item key) and the open-menu state so specs can assert nav position without real DOM focus, and a new (or extended) `tests/render/menu-bar-keyboard.spec.js` covers ACs 1–3 (nav, disabled-skip, Esc guard both branches).

## Tasks / Subtasks

- [x] **Task 1 — Add a menu-bar keydown listener on `#terminal-wrapper`, wired in the existing seam (AC: 1, 4)**
  - [x] 1.1 In `wireMenuBar(opts)`, register a `keydown` listener on `terminalWrapperRef` (already passed as `opts.terminalWrapper`, stored at `menu-bar.js:39,66`). Attach it via the existing `trackListener(...)` helper (`menu-bar.js:48`) so `dispose()` / idempotent re-wire detach it too. **Do not** change the `main.js` wiring order — `wireMenuBar` already sits after `wireChrome` (`main.js:259`) and before `wireKeyboard` (`main.js:450`); that ordering *is* the guard (AC-4).
  - [x] 1.2 Guard the handler: `if (e.defaultPrevented) return;` **first** (chords handled by `chrome.js` already `preventDefault`ed — mirror `keyboard.js:202`). Ignore events carrying modifier keys you don't own (let Ctrl/Alt/Meta chords fall through to `keyboard.js`); nav keys are bare ←/→/↑/↓/Enter/Esc.
  - [x] 1.3 The handler dispatches on `e.key` / `e.code`: `ArrowLeft`/`ArrowRight` → move between menus; `ArrowUp`/`ArrowDown` → move focused item; `Enter` → activate focused item; `ArrowRight` on a radio-submenu row → submenu-open hook; `Escape` → the AC-3 guard. Every branch that acts on an **open** menu must `e.preventDefault()`; the no-menu-open path must **not**.

- [x] **Task 2 — Esc passthrough guard (AC: 3, 4) — do this before nav polish; it is the highest-risk clause**
  - [x] 2.1 **(RED)** Write failing specs in `tests/render/menu-bar-keyboard.spec.js`: (a) open a menu, press Esc → dropdown closes AND a probe confirms `defaultPrevented` was set (e.g. attach a capturing `keydown` probe, or assert the paste/SLIDE cancel oracle did **not** fire); (b) with **no** menu open, press Esc → assert the menu-bar did **not** `preventDefault` (the Esc reaches `keyboard.js`; verify via an existing Esc oracle such as paste-cancel or bare-Esc encode, or a probe reading `e.defaultPrevented === false` after the menu-bar listener).
  - [x] 2.2 **(GREEN)** Implement the Esc branch: `if (e.code === 'Escape') { if (openMenu === null) return; /* no preventDefault */ closeMenu(); e.preventDefault(); return; }`. **The early-return when `openMenu === null` must have zero side effects** — this is the FR-4 contract that keeps paste-cancel/SLIDE-cancel/selection-cancel alive (`keyboard.js:212-242`).
  - [x] 2.3 Confirm the two Esc specs pass, then run the incumbent Esc oracles in isolation: `tests/input/*paste-cancel*`, `tests/**/*slide-cancel*`, selection-cancel, and any bare-Esc-encode spec — all must stay green (`--workers=1`).

- [x] **Task 3 — ←/→ between menus + ↑/↓ within a dropdown, skipping disabled (AC: 1, 2)**
  - [x] 3.1 **(RED)** Failing specs: with View open, ArrowRight opens Settings (and wraps Help→File); ArrowLeft opens the previous menu; ArrowDown moves `[data-focused]` to the next **enabled** item; ArrowUp moves back; a `data-disabled="true"` row is **never** `[data-focused]`. Assert via `__getStateForTests()` focused index/key AND the DOM `[data-focused]` attribute; assert **no** element received real DOM focus (`document.activeElement` stays `#terminal-wrapper`).
  - [x] 3.2 **(GREEN)** Add module state `focusedIndex` (or focused key) reset to a sane default when a menu opens (first enabled item, or none). ←/→ call the existing `openMenuNamed(key)` with the wrapped neighbour from `MENUS` (`menu-bar.js:31,144`) and reset `focusedIndex` to the first enabled item of the newly opened menu. ↑/↓ walk the dropdown's `.menu-item` rows, **skipping** any with `data-disabled="true"`, and set `[data-focused="true"]` on exactly one (clear it from the previous). Drive highlight purely via the attribute — reuse E1.1's `#menu-bar .menu-item[data-focused="true"]` CSS (`index.html:157`); **never** call `.focus()`.
  - [x] 3.3 Extend `render()` (or add a focused-item projection helper) so `[data-focused]` is a pure function of `focusedIndex` + `openMenu`, cleared on close — keeping "render is the only place that mutates open/close DOM state" (`menu-bar.js:156`). Closing a menu clears all `[data-focused]`.

- [x] **Task 4 — Enter / → item activation + submenu-open hook (AC: 1)**
  - [x] 4.1 **(RED)** Failing specs: Enter on an **action** row closes the menu (reuse the E1.1 `onItemClick` action path); Enter on a **checkable** row toggles `data-checked` and **keeps** the menu open; Enter/→ on a **radio-submenu** row keeps the menu open and does **not** throw (submenu-open hook is a no-op placeholder).
  - [x] 4.2 **(GREEN)** Route Enter and → (for radio-submenu) through the **existing** `onItemClick(item)` (`menu-bar.js:114`) applied to the currently-focused item — do **not** duplicate the variant logic. Add a single named seam (e.g. `openSubmenu(item)` that is currently a no-op `return;`) so E1.4/E1.5 have one obvious attach point. Disabled focused item + Enter/→ = inert (guaranteed because disabled rows are never focusable per Task 3).
  - [x] 4.3 Confirm specs pass.

- [x] **Task 5 — Disabled-item announcement via aria-live (AC: 2)**
  - [x] 5.1 Add a visually-hidden `aria-live="polite"` region owned by `menu-bar.js` (either a small static node in `index.html` under `#menu-bar`, e.g. `#menu-bar-live`, or created/managed by the module — prefer static markup per the AD-2 "static markup in index.html" convention). Use only `var(--chrome-*)`-safe hiding (`clip`/`sr-only` pattern; no new palette).
  - [x] 5.2 When navigation passes a disabled item's neighbour (or the user attempts to focus one), write the disabled row's `title` reason into the live region so it is announced. Keep it debounced/coalesced — do not write on every keystroke. Confirm with a spec that the live region's text equals the disabled item's `title` after the relevant nav.

- [x] **Task 6 — Test hooks + no-regression + compliance audit (AC: 5, 6)**
  - [x] 6.1 Extend `__getStateForTests()` (`menu-bar.js:205`) to include `focusedIndex` (and/or focused item key) alongside `openMenu`; keep `__resetForTests()` clearing it. Confirm `window.__menuBar` still exposes the same API shape plus any new introspection.
  - [x] 6.2 Run the full Playwright chromium suite. For any failure, re-run the offending spec with `--workers=1` to separate a real regression from the pre-existing parallel-load/wasm-boot flake (E0 action item #1). The **named** Esc oracles are the correctness contract.
  - [x] 6.3 Grep-audit `menu-bar.js`: the new keydown path calls **no** `.focus()`/`.blur()` on titles/items; the Esc no-menu path has **no** `preventDefault` and no side effects; only `data-*`/`[hidden]` express state (no inline styles); named exports only; still imports only `focus.js` (AD-3 — no new direct imports). Confirm the listener is attached via `trackListener` so `dispose()` detaches it.

## Dev Notes

### Developer context — what this story is (and is NOT)

- **IS:** the keyboard layer over the E1.1 shell — a `keydown` listener on `#terminal-wrapper` that, **when a dropdown is open**, moves between menus (←/→, wrapping), moves the focused item (↑/↓, skipping disabled), activates items (Enter, reusing E1.1 variant semantics), exposes a submenu-open **hook** (Enter/→ on radio-submenu, no-op for now), announces disabled reasons via `aria-live`, and — critically — implements the **Esc passthrough guard** (close+`preventDefault` when open; silent early-return when closed). All focus is attribute-driven (`[data-focused]`); real DOM focus never leaves the terminal.
- **IS NOT:** submenu panels or their contents (**E1.4/E1.5**); any real canvas/prefs action (**E1.4/E1.5, E2, E3, E5**); `chrome.js` decomposition / boot-reset re-projection (**E1.3**); live connection status (**E2/E4**); modals (**E6**, via `openModal`). Do **not** call `.focus()` on menu items, do **not** delete `#top-bar`/`<details>`, do **not** add direct imports beyond `focus.js`.

### The single highest-risk clause: the Esc passthrough guard (FR-4 / AD-7)

This is the reason the story exists and the one thing most likely to regress silently. The mechanism is a **`defaultPrevented` listener chain on `#terminal-wrapper`**:

```
#terminal-wrapper keydown listeners, in attach order (all short-circuit on e.defaultPrevented):
  1. chrome.js   (wired at main.js:239)  → theme/zoom chords; preventDefault + return on a chord, else pass through
  2. menu-bar.js (wired at main.js:259)  → THIS STORY. Esc: if a dropdown is open → closeMenu() + preventDefault;
                                            if none open → early-return, NO preventDefault, NO side effect.
  3. keyboard.js (wired at main.js:450)  → Esc chain: `if (e.defaultPrevented) return;` (keyboard.js:202),
                                            then selection-drag-cancel → SLIDE-cancel → paste-cancel → encode 0x1B
                                            (keyboard.js:212-242).
```

- **Menu open + Esc:** menu-bar closes the dropdown and `preventDefault`s → `keyboard.js` sees `defaultPrevented` and returns → the terminal Esc chain does **not** fire. Correct: the menu consumed Esc.
- **No menu + Esc:** menu-bar early-returns without touching the event → `keyboard.js` runs its full Esc chain (paste-cancel, SLIDE-cancel, selection-cancel, or `0x1B` to the Z80). **This is the passthrough. If the early-return path ever calls `preventDefault` or has a side effect, you break in-flight paste/SLIDE cancel — the exact regression FR-4 forbids.**
- Same-target + attach-order is what guarantees ordering; **do not** move the `wireMenuBar` call in `main.js` and **do not** attach the listener to `document` or `window` (that would change ordering vs `keyboard.js` and can capture events when the terminal isn't focused). Attach to `terminalWrapperRef`. [Source: keyboard.js:200-242; chrome.js:167-205; main.js:239/259/450; ARCHITECTURE-SPINE.md#AD-7,#AD-12]

### Why focus stays on the terminal — nav is attribute-driven, not DOM-focus-driven

E1.1 applied `retainFocus` to every title and item (`mousedown → preventDefault`), so clicking a menu never moves focus — `#terminal-wrapper` keeps it. That same fact powers keyboard nav: because focus never leaves the terminal, its keydown listeners (including this new menu-bar one) receive every keystroke. The menu-bar therefore tracks a **focused-item index in module state** and reflects it with `[data-focused="true"]` on exactly one row. **Do not** call `element.focus()` to navigate — that would move focus off the terminal, violate NFR-1 ("focus retention is sacred", UX-DR9), and defeat the whole ordering guarantee. The E1.1 highlight CSS (`#menu-bar .menu-item[data-focused="true"]`, `index.html:157-165`) already renders the accent fill; you only need to move the attribute. [Source: menu-bar.js:79,104-111 (retainFocus sites); EXPERIENCE.md:125,178,203; UX-DR8/UX-DR9]

### Architecture compliance (hard guardrails)

- **AD-7 (menu ownership + Esc semantics):** `menu-bar.js` owns the bar and all dropdowns; the **Esc handler must early-return without `preventDefault` when no dropdown is open**, closing + `preventDefault`ing only when one is open. This story implements exactly that clause (E1.1 deliberately registered no Esc handler at all). [Source: ARCHITECTURE-SPINE.md#AD-7 (:100-103)]
- **AD-12 / NFR-8 (boot order load-bearing):** the terminal keydown listener's `defaultPrevented` short-circuit must keep winning on chords; `menu-bar` stays wired after `wireChrome`, before `wireKeyboard`. Do not reorder. [Source: ARCHITECTURE-SPINE.md#AD-12 (:126-129); main.js:239,259,450]
- **AD-2 / NFR-6:** keep the `wireXxx(opts)` shape; state stays module-scope; `render()` remains the single writer of open/close DOM state; expose focused-index via `__getStateForTests`; detach listeners in `dispose()`. [Source: ARCHITECTURE-SPINE.md#AD-2 (:75-78); menu-bar.js:156-217]
- **AD-3 (direct-import allowlist):** `menu-bar.js` may import only `renderer/canvas.js` setters + `state/prefs.js`; everything else via opts. This story needs **no new imports** — it already has `terminalWrapper` from opts and `retainFocus` from `focus.js`. Do not import `keyboard.js`, `paste-pump.js`, or `slide*.js`. [Source: ARCHITECTURE-SPINE.md#AD-3 (:80-83); menu-bar.js:28]
- **AD-10 / NFR-1 ("Sacred"):** never steal terminal focus — no `.focus()` in the nav path. [Source: ARCHITECTURE-SPINE.md#AD-10 (:116-119)]
- **Visual state:** `data-*` + `[hidden]` only, never inline styles (AD-9 consistency conventions). [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions (:157)]

### Reuse — do NOT reinvent

- **Open/close state machine already exists** — `toggleMenu`/`openMenuNamed`/`closeMenu`/`render` (`menu-bar.js:139-177`). ←/→ call `openMenuNamed(neighbourKey)`; Esc calls `closeMenu()`. Do not write a second open/close path.
- **Item activation already exists** — `onItemClick(item)` (`menu-bar.js:114-129`) encodes the action/checkable/radio-submenu/disabled semantics. Route Enter/→ through it; do not duplicate variant branching.
- **`MENUS` array** (`menu-bar.js:31`) is the left-to-right order — compute ←/→ neighbours (with wrap) from it.
- **Listener tracking** — `trackListener` / `removeTrackedListeners` (`menu-bar.js:48-58`) so the new keydown is disposed and idempotent-rewire-safe. Use it; do not `addEventListener` directly.
- **`[data-focused]` highlight CSS** — `index.html:154-165` already styles it. Only move the attribute.
- **`retainFocus`** — already applied by E1.1 to titles + items (`menu-bar.js:79,104`); nothing to re-apply.

### Existing code being touched (read before editing)

- **`www/renderer/menu-bar.js`** (owned by this story) — the E1.1 shell. Key seams: `wireMenuBar` (`:62`) registers title/item click listeners and the click-away; `wireDropdownItems` (`:103`) + `onItemClick` (`:114`) hold variant semantics; `toggleMenu`/`openMenuNamed`/`closeMenu` (`:139-154`) + `render()` (`:156-177`) are the open/close machine; `__getStateForTests` (`:205`). **Currently registers NO keydown handler** (by E1.1 design) — this story adds exactly one, on `terminalWrapperRef`.
- **`www/input/keyboard.js`** — the downstream Esc consumer. Its wrapper keydown starts at `:200` with `if (e.defaultPrevented) return;` (`:202`), then the Esc chain: Ctrl+Shift+Esc selection-clear (`:212`), selection-drag-cancel (`:222`), SLIDE-cancel (`:229`), paste-cancel (`:238`). **Do not modify keyboard.js** — the guard works purely by menu-bar setting/not-setting `defaultPrevented` upstream. Read it only to know exactly which behaviors your early-return must preserve.
- **`www/renderer/chrome.js`** — wrapper keydown at `:168` handles chords (Ctrl+Alt+T `:179`, zoom). It `preventDefault`s chords and passes everything else through. **Not modified this story** (decomposition is E1.3). Your handler runs after it and must respect its `defaultPrevented` output.
- **`www/main.js`** — `wireMenuBar({ terminalWrapper })` at `:259`, exposed as `window.__menuBar` at `:260`, sitting between `wireChrome` (`:239`) and `wireKeyboard` (`:450`). **No `main.js` change is required** unless you add a static `aria-live` node (that goes in `index.html`, not `main.js`). `terminalWrapper` is resolved at `main.js:162`.
- **`www/index.html`** — menu-bar markup at `:933-1010+`: titles `#menu-<key>`, panels `#dropdown-<key>`, rows `.menu-item[data-variant=…][data-disabled=…][data-checked=…]` with `.check`/`.lbl`/`.hint`/`.caret` children. Disabled rows carry a `title` reason (e.g. `:941` "No bytes received yet", `:954` "Connect first to choose a device"). If you add an `aria-live` region, add it here under `#menu-bar` with the `sr-only`/clip hiding idiom.

### Testing requirements

- **Framework:** Playwright, **chromium project**; `testDir: ./tests`; specs at `www/tests/{render,input,transport,session}/*.spec.js`; server `python3 -m http.server -d . 8000`, `baseURL http://localhost:8000/`. New spec: `www/tests/render/menu-bar-keyboard.spec.js` (or extend `menu-bar.spec.js`). [Source: playwright.config.js]
- **Boot-race guard:** gate on `window.__menuBar` with `page.waitForFunction` before driving it (the E0.1/E1.1 pattern — see `menu-bar.spec.js:25-28`).
- **Cover (E1.2 slice):** ←/→ menu movement (+ wrap); ↑/↓ item movement skipping disabled (assert via `__getStateForTests` focused index **and** `[data-focused]`, and that `document.activeElement` stays `#terminal-wrapper`); Enter/→ activation per variant (reuse E1.1 oracles); **both Esc branches** (open→close+prevented; closed→passthrough); disabled announcement text in the live region.
- **Esc-passthrough oracles (the correctness contract):** don't just assert `defaultPrevented` — assert the *downstream effect*. For the passthrough branch, drive an existing Esc consumer (start a paste and confirm bare Esc cancels it with **no** menu open) so a future refactor that accidentally swallows Esc fails loudly. For the consume branch, confirm the same consumer does **not** fire when a menu is open.
- **Flake protocol (E0 action item #1):** the full parallel suite flakes from wasm-boot starvation. **Judge regressions by named oracles in isolation (`--workers=1`)** — a shifting parallel-load failure set is not a regression from this story. [Source: e1-1 Debug Log; epic-e0-retro-2026-07-01.md]

### Previous-story intelligence (E1.1 + E0)

- **E1.1 shipped the shell this story extends** — six titles, click-driven open/move/click-away via `[hidden]`+`data-*` (zero inline styles), four variant placeholders, gray "Not connected" status placeholder, and — by explicit design — **no keydown/Esc handler** (deferred here). `window.__menuBar` = `{ open, close, getOpenMenu, dispose, __getStateForTests, __resetForTests }`. [Source: e1-1 Completion Notes]
- **E1.1 test-first with named oracles paid off**; keep new specs byte-stable and gate on `window.__menuBar`.
- **Scope-boundary caution (repeated E0.1→E1.3 drift lesson):** resist front-running E1.4/E1.5 — do **not** build submenu panels or wire real actions. The radio-submenu Enter/→ path is a documented no-op hook only.
- **`retainFocus` hardening (E0 review):** it throws `TypeError` on a `<select>` without a `restoreTarget`; irrelevant here (no new controls), but do not pass a `<select>` to it without `terminalWrapper`.
- **Neutral-shell pin (E1.1):** `#menu-bar` pins neutral `--chrome-*` values (not a `[data-theme]` branch); retired in E1.3+. Any new node (aria-live region) must stay token-safe and add no `[data-theme]`/phosphor styling.

### Git intelligence

Recent commits are the E1/E0 backbone: `add menu-bar shell + dropdown mechanics (E1.1)`, `add shared openModal helper (E0.2)`, `add shared retainFocus helper (E0.1)`. Established patterns to mirror: **named exports, `wireXxx(opts)` shape, `window.__xxx` + `__getStateForTests` hooks, `data-*`/`[hidden]` state (never inline styles), listener tracking for dispose, test-first with a dedicated named spec, atomic per-task commits.** This story adds one keydown listener and one spec — keep the diff tight and additive.

### Project Structure Notes

- Aligns with the `renderer/` module convention and the composition-root seam. No new module, no new import edge — the keyboard layer lives inside the existing `menu-bar.js`. The only possible `index.html` addition is a token-safe `aria-live` region under `#menu-bar`.
- **Known variance (intentional, from E1.1):** `#top-bar` + the three `<details>` panes still coexist with the new bar during the E1→E2/E3/E5 migration. Unchanged by this story.
- **Deferred, by design:** submenu panels + real actions (E1.4/E1.5), `chrome.js` decomposition/reset (E1.3), live status (E2/E4), modals (E6). The submenu-open hook is the single seam left for E1.4/E1.5.

### References

- [Source: epics.md#Story-E1.2 (:283-301)] — story text + ACs (FR-3 keyboard nav, FR-4 Esc guard).
- [Source: epics.md — FR-3 (:34), FR-4 (:35), NFR-7 (:73); UX-DR7 (:102), UX-DR8 (:103), UX-DR9 (:104)]
- [Source: ARCHITECTURE-SPINE.md — AD-7 (:100-103, Esc early-return-without-preventDefault), AD-12 (:126-129, boot order), AD-2 (:75-78), AD-3 (:80-83), AD-10 (:116-119); Consistency Conventions (:153-161)]
- [Source: EXPERIENCE.md — menu/dropdown keyboard nav (:125), checkable/radio/disabled behavior (:127-129), Esc row (:188), focus management + tab order + disabled announced (:202-204), focus retention "sacred" (:178)]
- [Source: www/renderer/menu-bar.js — E1.1 shell: state (:31-58), wireMenuBar (:62-96), wireDropdownItems/onItemClick (:103-129), open/close machine (:139-177), render (:156-177), __getStateForTests (:205)]
- [Source: www/input/keyboard.js — wrapper keydown + `defaultPrevented` guard (:200-202), Esc chain selection/SLIDE/paste cancel (:212-242)]
- [Source: www/renderer/chrome.js — wrapper keydown chords (:167-205)]
- [Source: www/main.js — wireChrome (:239), wireMenuBar seam + window.__menuBar (:259-260), wireKeyboard (:450); terminalWrapper (:162)]
- [Source: www/index.html — menu-bar markup + variants + disabled `title` reasons (:933-1010), `[data-focused]` highlight CSS (:154-165)]
- [Source: www/tests/render/menu-bar.spec.js — spec patterns, boot-race guard (:25-28)]
- [Source: e1-1-menu-bar-shell-dropdown-mechanics.md — shell scope, flake protocol, retainFocus notes; epic-e0-retro-2026-07-01.md — E0 learnings]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Amelia / dev-story workflow)

### Debug Log References

- New spec `tests/render/menu-bar-keyboard.spec.js` run against the unmodified (handler-less) E1.1 shell first → **10 fail / 1 pass** (RED confirmed; the lone pass is the weak "no menu open" guard). After implementation → **13/13 pass**.
- Incumbent Esc oracles in isolation (`--workers=1`): `menu-bar.spec.js` + `paste.spec.js` + `slide-cancel.spec.js` + `selection.spec.js` → **38/38 pass** (paste-cancel, SLIDE-cancel, selection-drag-cancel all green — the FR-4 correctness contract).
- Arrow-encoding + chord passthrough (`keydown-arrows.spec.js`, `keyboard.spec.js`, `theme-toggle.spec.js`, `zoom.spec.js`) → **17/17 pass** (bare arrows/Enter still reach `keyboard.js`; Ctrl+Alt+T / Ctrl+=/-/0 still reach `chrome.js`).
- Full chromium suite → 352 passed / 7 failed / 1 skipped. The 7 failures (`connect`, `readloop`, `reconnect`, `slide-chip` — none touching menu-bar/Esc/keydown) are the pre-existing parallel-load/wasm-boot flake (E0 action item #1); re-run in isolation `--workers=1` → **29/29 pass**, confirming no regression from this story.

### Completion Notes List

- Added the keyboard layer entirely inside `www/renderer/menu-bar.js` — **one** `keydown` listener on `#terminal-wrapper`, attached via the existing `trackListener` in the E1.1 seam (no `main.js` change; ordering chrome → menu-bar → keyboard preserved, AC-4).
- **Esc passthrough guard (AC-3 / AD-7, highest risk):** `if (e.key === 'Escape') { if (openMenu === null) return; closeMenu(); e.preventDefault(); return; }`. The no-menu-open branch early-returns with **zero** side effects and **no** `preventDefault` — verified by a downstream oracle (bare Esc with no menu open still cancels an in-flight paste) and its inverse (Esc with a menu open closes the dropdown and does **not** cancel the paste).
- **Nav (AC-1/AC-2):** `focusedIndex` indexes the open menu's *focusable* (non-disabled) rows, so disabled rows are skipped by construction and can never be `[data-focused]`. `←/→` open the wrapped neighbour from `MENUS`; `↑/↓` move focus; `Enter`/`→` route through the existing `onItemClick` (no variant logic duplicated). `[data-focused]` is a pure projection via a new `renderFocus()` inside `render()`; closing clears it. **No `.focus()`/`.blur()` anywhere** — `document.activeElement` stays `#terminal-wrapper` throughout (NFR-1 "sacred", verified in spec).
- **Submenu-open hook (E1.4/E1.5 seam):** `openSubmenu(item)` is a documented no-op; Enter/→ on a `radio-submenu` row keeps the menu open and never throws. No submenu panels built (scope respected).
- **Disabled announcement (AC-2):** static `#menu-bar-live` `aria-live="polite"` region added under `#menu-bar` (sr-only clip idiom, no palette tokens). `refreshLiveRegion()` writes the disabled neighbour's `title` reason when focus lands beside it, coalesced (only rewritten on change — not per-keystroke).
- **Test hooks (AC-6):** `__getStateForTests()` now returns `focusedIndex` + `focusedLabel`; `__resetForTests()` clears them and the live region. Public `window.__menuBar` API shape unchanged.
- Compliance audit (AC guardrails) clean: no `.focus()`/`.blur()` in code, imports only `./focus.js` (AD-3), no inline styles (state via `data-*`/`[hidden]`), named exports only, listener attached via `trackListener` so `dispose()` detaches it.

### File List

- `www/renderer/menu-bar.js` — modified: added the E1.2 keyboard layer (keydown listener, Esc passthrough guard, `←/→`/`↑/↓` nav, Enter/→ activation via `onItemClick`, `openSubmenu` hook, `refreshLiveRegion`, `renderFocus` focus projection, `focusedIndex` state, extended `__getStateForTests`/`__resetForTests`/`dispose`).
- `www/index.html` — modified: added the visually-hidden `#menu-bar-live` `aria-live` region under `#menu-bar` and the token-neutral `.sr-only` CSS rule.
- `www/tests/render/menu-bar-keyboard.spec.js` — new: covers ACs 1–4 + 6 (Esc guard both branches with paste downstream oracle, `←/→` wrap, `↑/↓` disabled-skip + focus-retention, Enter/→ per variant, aria-live announcement, `focusedIndex` hook).

## Change Log

| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2026-07-01 | 0.1 | Story drafted — comprehensive context engineering. Keyboard nav + Esc passthrough guard over the E1.1 shell; submenu panels and real actions explicitly deferred to E1.4/E1.5 (radio-submenu Enter/→ = no-op hook). Esc guard mechanism (defaultPrevented chain on #terminal-wrapper) and focus-retention-via-attribute documented as the two highest-risk clauses. | Amelia (create-story) |
| 2026-07-01 | 1.0 | Implemented the keyboard layer in `menu-bar.js` (one keydown listener on `#terminal-wrapper` via `trackListener`, no `main.js` change): Esc passthrough guard (close+preventDefault when open; silent early-return when closed — verified by paste downstream oracle), `←/→` menu movement with wrap, `↑/↓` focus movement skipping disabled (attribute-driven, no `.focus()`), Enter/→ activation via existing `onItemClick` + no-op `openSubmenu` hook, disabled-reason `aria-live` announcement (`#menu-bar-live` + `.sr-only`), and `focusedIndex` test hook. New spec `menu-bar-keyboard.spec.js` (13 tests) all green; incumbent Esc oracles + chords + arrow-encoding green in isolation; full-suite failures confirmed as pre-existing wasm-boot flake. Status → review. | Amelia (dev-story) |
