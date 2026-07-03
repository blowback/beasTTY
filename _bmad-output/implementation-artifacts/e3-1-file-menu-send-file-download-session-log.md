---
baseline_commit: 0af2aaffd68f80ce4adacb8aa41e50e668b1cf18
---

# Story E3.1: File menu — Send File & Download Session Log

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast operator,
I want Send File and Download Session Log in a File menu,
so that sending a program and saving a log are where I expect them.

**Covers:** FR-16 (Send File & Send modal), FR-17 (Download Session Log); UX-DR13 (Send-modal states).
**Epic:** E3 — File, Settings & Transfer Configuration. **Depends on:** E0 (`openModal`/`retainFocus` primitives), E1 (menu-bar backbone + dropdown/dispatch mechanics).

**Premise (epic-wide, confirmed — `epics.md:22-24`):** pure **relocation**. Every control keeps its exact v1.1 behavior and only moves to a new home. This is a **wiring** story, not a build-from-scratch: the File menu, both dropdown rows, the Send modal (`#send-modal`, refactored onto `openModal` in E0.2), and the session-log accumulator (`session-log.js`) **all already exist**. Nothing user-facing is redesigned — the two inert File-menu rows get wired to the existing send-picker and download paths.

**Relocation strategy — MOVE, do not duplicate.** Route the two File-menu items into the **existing** `file-source.js` send path and `session-log.js` download path via injected opts (AD-3), exactly as E2.1/E2.2/E2.3 injected `toggleConnection` / `getAdapterCount` / `openSerialConfig`. Do **not** re-implement the picker, the Send modal, the CP/M validation, or the Blob download. The legacy `#send-file-button` and `#download-log-button` remain during the E7 `#top-bar`/`<details>` coexistence window (see Task 4); this story does not delete them.

## Acceptance Criteria

Verbatim epic ACs (`epics.md` §Story E3.1, lines 438-446) decomposed and made testable. AC-1 and AC-4/AC-5 are the epic's two ACs; AC-2/AC-3/AC-6/AC-7/AC-8 make the implicit "no behavior lost" and cross-cutting requirements falsifiable.

**AC-1 — Send File… item opens the existing picker → Send modal (FR-16, AD-7/AD-8).**
**Given** the File dropdown (`index.html:1077-1085`) and its now-wired `Send File…` row
**When** the user activates `File ▸ Send File…` (click or Enter)
**Then** the same native multi-file picker the legacy `#send-file-button` opens is opened (honoring its disabled gate — inert while a SLIDE session is pending/sending/receiving or no writer is ready), the menu closes (action semantics), and picking file(s) opens the existing `#send-modal`
**And** dropping file(s) on `#terminal-wrapper` continues to open the same modal (drop path unchanged — `file-source.js:128-131, 274-299`).

**AC-2 — Send modal contents preserved verbatim (UX-DR13, FR-16 — no regression).**
**Given** the Send modal opened via either path
**When** it renders
**Then** its behavior is byte-identical to today: title `` `Sending ${n} file(s) via SLIDE` `` (`file-source.js:446`); per-file rows resolve to rewrite / unchanged / rejected / collision; every CP/M 8.3 rejection reason is verbatim (`empty filename`, `leading-dot dotfile`, `control character 0x??`, `non-ASCII byte 0x??`, `invalid CP/M character '?'` — `file-source.js:576-593`, rendered as ` — rejected: {reason}` at `:465`); when collisions exist the footer swaps to the collision variant (`Send N renamed` / `Send only first` / `Refuse batch` — `file-source.js:515`, `index.html:1549-1550`); when every file is rejected the `All files rejected — see details below.` hint (`index.html:1528-1530`, `—` = U+2014) shows and Send is disabled + labelled `Send 0 files` (`file-source.js:496-501`); and the primary `Send N files` button is default-focused (`file-source.js:541-542`).

**AC-3 — Focus retention + conditional restore preserved (NFR-1/AD-10, "Sacred").**
**Given** the wired `Send File…` row and the modal
**When** the item is activated and the modal later closes
**Then** the row uses `retainFocus` (applied by `wireDropdownItems`, `menu-bar.js:709`), so activating it leaves DOM focus on `#terminal-wrapper`; and the modal's conditional restore is preserved — `send`/`first-only` → terminal wrapper, cancel/refuse/Esc → the trigger (`file-source.js:544`). Inside the focus-trapped modal, controls are **not** individually terminal-restored (that fights the trap); restore happens only on close via `openModal`'s `restoreTo`.

**AC-4 — Download Session Log disabled until bytes exist (FR-17).**
**Given** the `Download Session Log` row (`index.html:1081-1084`) with no bytes received this connection
**When** the File menu opens
**Then** the row is disabled: `data-disabled="true"`, `aria-disabled="true"`, `title="No bytes received yet"` (verbatim, sourced from `session-log.js:26` — do NOT re-hardcode elsewhere); it is inert (a `force:true` click neither closes the menu nor throws — guarded at `menu-bar.js:722-723`), is skipped in keyboard nav (`focusableItems` filter `menu-bar.js:440`), and its `title` is announced via the aria-live region when focus lands on a neighbour row (`refreshLiveRegion`, `menu-bar.js:684-699`).

**AC-5 — Download Session Log enables on first byte and downloads the log (FR-17).**
**Given** at least one RX byte has been received this connection (`session-log.js:52-58` `totalBytes > 0`)
**When** the File menu is opened (open-time projection) **or** the first byte arrives while the File menu is already open (live projection)
**Then** the row enables: `data-disabled`/`aria-disabled` removed, `title` → `Download all bytes received this connection (.bin)` (`session-log.js:27`)
**And** activating it invokes the existing `session-log.js` `download()` (`:62-85`), producing `beastty-YYYYMMDD-HHMMSS.bin` (UTC at click time), an `application/octet-stream` Blob of the RX-only chunks (TX and SLIDE-active RX are excluded — `serial.js:527` gates `append` while a SLIDE transfer is active), and the menu closes (action semantics)
**And** a fresh Connect resets the row back to disabled (`session-log.js:44-48` `reset()`), because bytes are per-connection.

**AC-6 — Single writer + AD-3 seam (NFR-4).**
**Given** menu-bar must not import `serial.js`/`file-source.js`/`session-log.js`/`modal.js` (AD-3)
**When** the File items are wired
**Then** the send-picker entry and the download entry reach menu-bar **only** as injected `wireMenuBar` opts (`main.js:338-383`), mirroring `openSerialConfig`; `menu-bar.js` is the **sole writer** of the two File rows (it never toggles the legacy buttons); `session-log.js` remains the **sole writer** of the legacy `#download-log-button`; and the disabled↔enabled transition of the menu row is driven by a new `session-log.js` notification hook (see AC-7 / Task 3), not by menu-bar polling or a second writer. A projector that reads byte count must never re-drive any machine.

**AC-7 — session-log notification hook added (fills the one real gap).**
**Given** `session-log.js` today exposes **no** subscribe/notify hook — `setButtonState` mutates only the single injected `downloadButton` (`session-log.js:102-111`)
**When** the enable/disable state changes (first byte via `append`'s `wasEmpty` transition at `:57`; and `reset()` back to disabled at `:47`)
**Then** an added `onStateChange(enabled)` callback opt on `wireSessionLog` fires on those transitions, and `main.js` wires it to re-project the menu row (e.g. `menuBar.projectSessionLog()`), keeping `session-log.js` the sole writer of its own button and menu-bar the sole writer of its own row.

**AC-8 — Relocation hygiene + cross-cutting (NFR-2/5/6; E7 coexistence).**
**Given** the relocation
**When** the suite runs
**Then** existing coverage is repointed/extended, not deleted: `tests/session/log-download.spec.js` (legacy button oracle) stays green; `tests/input/file-source.spec.js` stays green; the disabled-row contract test (`tests/render/menu-bar.spec.js:229-255`, which already targets `#dropdown-file .menu-item[data-disabled="true"]`) is extended for the now-wired item; new coverage exercises the menu-triggered send + the menu-triggered download + the enable transition. The two File rows use only `var(--chrome-*)` tokens (no new palette/CSS beyond existing menu-item rules); no new dependencies and no build step; `Clear Screen`/`Clear Scrollback…` are **not** added to File (they live in View since E1.5 — see Project Structure Notes); and E7-retirement markers tie `#download-log-button` and `#send-file-button` to `#top-bar` removal.

## Tasks / Subtasks

- [x] **Task 1 — Wire `File ▸ Send File…` to the existing picker→modal path (AC-1, AC-2, AC-3, AC-6).**
  - [x] `index.html` — added `id="menu-send-file-item"` and `data-action="send-file"` to the `Send File…` row; removed the placeholder `<span class="caret">▸ modal</span>` (the trailing `…` signals "opens further UI"; `▸` stays reserved for radio submenus). Q1 default taken.
  - [x] `file-source.js` — added `export function openSendPicker()` honoring the same disabled gate as the `#send-file-button` click (`if (topBarSendBtnRef.disabled) return; topBarSendInputRef.click();`); does NOT call `sendInput.click()` raw. `processFiles`/`showConfirmModal` untouched.
  - [x] `menu-bar.js` — added `sendFileRef` module ref (beside `openSerialConfigRef`); assigned from `opts.sendFile`; added `if (action === 'send-file') { closeMenu(); sendFileRef?.(); return; }` beside the `serial-config` branch.
  - [x] `main.js` — injected `sendFile: openSendPicker` into `wireMenuBar({…})` (beside `openSerialConfig`); imported `openSendPicker` from `file-source.js`.
  - [x] Confirmed the conditional focus-restore (`file-source.js:544`) is unchanged — Q2 default: during E7 coexistence cancel/refuse restores to the still-present `#send-file-button`; byte-identical to today, zero new branching.

- [x] **Task 2 — Wire `File ▸ Download Session Log` + open-time projection (AC-4, AC-5, AC-6).**
  - [x] `index.html` — added `id="menu-download-log-item"` and `data-action="download-log"`; changed `data-variant="disabled"` → `data-variant="action"` (disabled state now dynamic via `data-disabled`); kept `data-disabled`/`aria-disabled`/`title="No bytes received yet"` initial state.
  - [x] `menu-bar.js` — added refs `downloadLogItemEl`, `downloadLogRef`, `getSessionLogBytesRef`, `sessionLogTooltipsRef`; discover `downloadLogItemEl` in the wire pass; assign `downloadLogRef = opts.downloadSessionLog`, `getSessionLogBytesRef = opts.getSessionLogBytes`, `sessionLogTooltipsRef = opts.sessionLogTooltips`.
  - [x] `menu-bar.js` — added `if (action === 'download-log') { closeMenu(); downloadLogRef?.(); return; }` (the `data-disabled` guard already blocks activation while disabled).
  - [x] `menu-bar.js` — added `projectSessionLog()` (inverse-polarity of `syncSubmenuDisabled`): `bytes>0` → enabled + enabled tooltip; else disabled + disabled tooltip. Reads byte count at use-time; no-throw; never re-drives session-log; re-anchors focus when the File menu is open mid-transition. Called from `projectMenuOnOpen` under `if (openMenu === 'file')`; exposed on `buildApi`.
  - [x] `main.js` — injected `downloadSessionLog: sessionLogDownload`, `getSessionLogBytes: sessionLogBytes`, and `sessionLogTooltips: SESSION_LOG_TOOLTIPS` into `wireMenuBar`.

- [x] **Task 3 — Add the session-log notification hook + live projection (AC-5, AC-7).**
  - [x] `session-log.js` — added `onStateChange` opt to `wireSessionLog`; fired from `setButtonState(enabled)` ONLY on the actual transition (guarded by `lastNotifiedEnabled`, seeded to the wire-time disabled state so init/redundant resets don't notify). Tooltip strings stay single-sourced at `:26-27`; also exported as the frozen `SESSION_LOG_TOOLTIPS` for injection (menu-bar can't import session-log — AD-3) so the row copy is never re-hardcoded (AC-4).
  - [x] `main.js` — passed `onStateChange: () => menuBar.projectSessionLog?.()` into `wireSessionLog`. `projectSessionLog` re-anchors keyboard focus when the File menu is open mid-transition (mirrors the `setChooseMicroBeastPresent` shape).

- [x] **Task 4 — Coexistence + relocation hygiene (AC-6, AC-8).**
  - [x] Left the legacy `#send-file-button` and `#download-log-button` functional; refreshed E7-retirement marker comments tying both (and the vestigial `<details id="connection">`) to `#top-bar` removal. menu-bar and session-log each stay sole writer of their own surface.
  - [x] Did **not** add `Clear Screen` / `Clear Scrollback…` to File — they live in View (E1.5). File ships with exactly the two rows.

- [x] **Task 5 — Focus retention + tokens audit (AC-3, AC-8).**
  - [x] Both rows get `retainFocus` automatically via `wireDropdownItems`; asserted `document.activeElement.id === 'terminal-wrapper'` after activating each (menu-bar + file-source specs). No new CSS/tokens; `var(--chrome-*)` only.

- [x] **Task 6 — Tests (AC-1…AC-8).**
  - [x] `tests/render/menu-bar.spec.js` — added an E3.1 describe: `Send File…` closes the menu + retains terminal focus; `Download Session Log` disabled + inert (`force:true` click keeps the menu open); enables on first RX byte via the `onStateChange` hook; `projectSessionLog()` driven directly with a live byte count.
  - [x] `tests/session/log-download.spec.js` — added a menu-triggered download case: push RX bytes via `window.__mockReaderPush`, open `file`, click `#menu-download-log-item`, assert `waitForEvent('download')` → `/^beastty-\d{8}-\d{6}\.bin$/` + byte-match; legacy `#download-log-button` cases stay green.
  - [x] `tests/input/file-source.spec.js` — added: `File ▸ Send File…` opens the native picker (captured via `waitForEvent('filechooser')`) → `#send-modal`, and retains terminal focus at activation; existing picker/drop cases stay green.
  - [x] All new tests boot-race-guard on `window.__menuBar`, open via `window.__menuBar.open('file')`, and live in the `chromium` project. Ran full suite: 429 passed / 1 skipped / 8 pre-existing flakes self-healed on retry.

## Dev Notes

### The one-paragraph mental model

The File menu, both its rows, the Send modal, the CP/M validator, and the RX session-log all already exist and work — through the **legacy** `#send-file-button` and `#download-log-button` in the retiring `#top-bar`/`<details>` chrome. This story flips the two **inert** File-dropdown rows (`index.html:1078-1084`) into live action items that drive the *same* existing code via injected opts (AD-3), and adds the one missing plumbing piece: a `session-log.js` notification so the menu row can learn the disabled→enabled transition. Everything else is preservation.

### Relocation strategy — inject-the-action (chosen), not duplicate-the-logic (rejected)

Chosen: expose a tiny `openSendPicker()` from `file-source.js` and inject the existing `download`/`getCurrentBytes` from `session-log.js` into `wireMenuBar`, exactly as E2.1 injected `toggleConnection` and E2.3 injected `openSerialConfig`. Menu-bar reaches the send/download logic only across the opts seam and stays the sole writer of its two rows. Rejected: re-implementing the picker/modal/download in menu-bar (violates AD-3, duplicates logic, forks behavior) or clicking the legacy `#send-file-button` from menu-bar (couples the new menu to a to-be-deleted element and would break at E7).

### Exact code sites (verified against `0af2aaf`)

**`www/index.html`:**
- `:1075-1085` — File `menu-group`: `#menu-file` title + `#dropdown-file`; **`Send File…` row `:1078-1080`** (add `id`+`data-action`, drop the `▸ modal` caret); **`Download Session Log` row `:1081-1084`** (add `id`+`data-action`, keep disabled attrs, variant→action).
- `:1111-1114` — Serial Configuration… row: the copy-this template for an action item that opens further UI (`data-variant="action" data-action="serial-config"`).
- `:1308-1310` — legacy `#send-file-button` (`↑ Send file`) + `#send-file-input` (hidden multi picker).
- `:1330-1339` — vestigial `<details id="connection">` holding `#port-status` + legacy `#download-log-button` (`:1336-1337`, `disabled title="No bytes received yet"`); comment `:1333-1335` already reads "E3 (File menu / SLIDE modal) relocates this."

**`www/renderer/menu-bar.js`:**
- `:56-57` `MENUS` order (`'file'` is first — no new menu to add). `:221` `export function wireMenuBar(opts = {})`. `:242-251` opts→ref assignment block (add `sendFile`/`downloadSessionLog`/`getSessionLogBytes` here). `:134` region for new refs.
- `:706-719` `wireDropdownItems` (applies `retainFocus` + click→`onItemClick` to every row — the File rows are already wired here; you only add dispatch branches). `:721-790` `onItemClick` dispatch; branch insertion point beside `:781-785` (`serial-config`). `:722-723` the `data-disabled` inert guard.
- `:664-679` `syncSubmenuDisabled` — the exact attribute-flip template for `projectSessionLog` (inverse polarity). `:881-887` `projectMenuOnOpen` — add the `openMenu === 'file'` branch. `:905-914`/`:920-934` `refreshChooseMicroBeast`/`setChooseMicroBeastPresent` — the async/no-throw + focus-reanchor shape for live-while-open enabling. `:1106-1126` `buildApi` — expose `projectSessionLog`.

**`www/transport/session-log.js`:**
- `:32-40` `wireSessionLog(opts)` (add `onStateChange`). `:44-48` `reset()`. `:52-58` `append` (`wasEmpty` transition at `:57`). `:62-85` `download()` (Blob + anchor). `:87-89` `getCurrentBytes()`. `:26-27` verbatim tooltip constants (single source of truth). `:102-111` `setButtonState` (fire `onStateChange` here). Fed by `serial.js:527` (`if (sessionLogRef && !isSlideActive()) sessionLogRef.append(value)` — the RX-only + SLIDE-paused gate).

**`www/input/file-source.js`:**
- `:64-85` `wireFileSource(opts)`. `:106-125` picker trigger + gate (`sendBtn.disabled` short-circuit) → wrap as `openSendPicker`. `:183-226` `updateButtonState` (the gate to honor). `:311-398` `processFiles` (private). `:441-546` `showConfirmModal`; title `:446`; CP/M reasons `:576-593`; send-label `:501`; collision footer `:508-526`; **`openModal` call + conditional `restoreTo` `:541-545`** (the one line the relocation must consciously carry).

**`www/main.js`:**
- `:338-383` `wireMenuBar({…})` opts (inject the three new opts). `:384` `window.__menuBar`. `:619` `wireSessionLog({ downloadButton: downloadLogBtn })` (add `onStateChange`). `:622-627` `window.__sessionLog` hooks. `:920-942` `wireFileSource({…})`. `:278` `downloadLogBtn` ref.

### What must be preserved (non-negotiable — AD-13 / FR-6 / NFR-3 / NFR-4)

- The Send modal's every state and copy string (AC-2) and its conditional focus-restore (AC-3) — the modal is untouched; only its *trigger* is added.
- The picker disabled gate (no send while a SLIDE session is pending/active or no writer) — reuse it, don't reinvent.
- Session-log is **RX-only** and **paused during an active SLIDE transfer** (`serial.js:527`); the downloaded `.bin` must reflect exactly today's bytes. `download()` does **not** clear chunks (mid-session re-download keeps accumulating). Filename is UTC-at-click.
- Legacy `#send-file-button` / `#download-log-button` keep working through E7; the legacy log button stays session-log's sole writer (menu-bar mirrors nothing here — it reads a getter and owns only its own row).
- Boot order (AD-12): `wireMenuBar` before `wireKeyboard`; polite-fail first. No `prefs.js CURRENT_VERSION` bump (no schema change).

### Modal close / returnValue contract (AD-8 policy header, `modal.js:30-44`)

`openModal` resets `returnValue=''` before each `showModal()`; an affirmative close carries a non-empty tag (`send`/`first-only`), cancel/refuse/Esc resolve `''`. `file-source.js` already maps these correctly — do not touch. No new modal is introduced by this story (the Send modal is pre-existing).

### Testing standards + codified idioms (E1 retro action #4 / E2 retro action #1)

Re-embedded here so the dev doesn't re-derive them (the "promote to a shared TESTING doc" action is still open):
- **Boot-race guard first:** `await page.waitForFunction(() => window.__menuBar && typeof window.__menuBar.__getStateForTests === 'function')`.
- **Deterministic open:** `await page.evaluate(() => window.__menuBar.open('file'))` — never a title `.click()` (a second title click toggles it shut).
- **Click a specific row:** `page.click('#dropdown-file .menu-item[data-action="send-file"]')`.
- **`force:true` on `aria-disabled` rows** to prove inertness (Playwright's actionability check honours `aria-disabled`; the row is not natively `[disabled]`): `disabled.click({ force: true })` then assert `#dropdown-file` still visible.
- **Drive a projection directly** (bypass live serial): `window.__menuBar.projectSessionLog()` after stubbing the byte-count getter, mirroring `projectConnection(state)` / `projectPrefs({…})` in the E2 specs.
- **retainFocus assertion:** after any row activation, `document.activeElement.id === 'terminal-wrapper'`.
- **Download without a real save:** `const dl = page.waitForEvent('download'); await …click(); expect((await dl).suggestedFilename()).toMatch(/^beastty-\d{8}-\d{6}\.bin$/)`; read bytes via `createReadStream()`.
- **RX injection:** `window.__mockReaderPush(new TextEncoder().encode('hello'))`; poll `window.__sessionLog.getCurrentBytes()`.
- **Projects/run:** render specs → `chromium` project; serial-machine oracles → `chromium-transport` (`fullyParallel:false`, `retries:1` — the ratified flake mask; do **not** add per-story `--workers=1`). `npm test` / `npm run test:fast` (`@fast`).

### Project Structure Notes

- **Superseded UX IA:** `EXPERIENCE.md:24-32` and `epics.md:176` list Clear Screen / Clear Scrollback under File. This is **stale** — E1.5 placed both in View (`epics.md:362-364`, "OQ1 resolved to View"), and `#clear-button` is already retired (`index.html` E1.5 comment). **Do not add Clear to File; do not duplicate the handlers.** File = exactly `Send File…` + `Download Session Log`, no divider (the IA's divider separated transfer-actions from the now-relocated clear-actions).
- **One real gap:** `session-log.js` has no notify hook today (`setButtonState` mutates only the one injected button). Adding `onStateChange` (Task 3) is the single genuinely-new bit of code; everything else is attribute/opt wiring.
- **Alignment:** new IDs are kebab-case + `menu-`-prefixed (`#menu-send-file-item`, `#menu-download-log-item`), matching `#menu-connect-item` / `#menu-serial-config-item`. Named exports only; no default exports; no new deps; no build step (AD-1).

### References

- [Source: `epics.md`#Story-E3.1 (lines 430-446)] — user story + the two epic ACs (FR-16, FR-17, UX-DR13).
- [Source: `epics.md`#Requirements-Inventory (FR-16 line 47, FR-17 line 48)] — verbatim FR text.
- [Source: `ux-designs/.../EXPERIENCE.md`#File (lines 24-32) + #Send-modal-states (164-166) + #Component-Patterns (129-131)] — File-menu IA, Send-modal footer variants, "Download Session Log" disabled-until-bytes rule, "No bytes received yet" verbatim.
- [Source: `ux-designs/.../DESIGN.md`#Components (lines 186-192)] — menu-item variants (action / disabled), token set; `▸` reserved for radio submenus.
- [Source: `architecture/.../ARCHITECTURE-SPINE.md`#AD-1/2/3/7/8/10/12] — composition-root wiring, test hooks, direct-import allowlist (menu-bar reaches serial/file-source/session-log only via opts), menu-bar owns all dropdowns, shared `openModal`, `retainFocus` sacred, boot order.
- [Source: `www/renderer/menu-bar.js:664-679, 721-790, 881-914`] — disabled-flip template, dispatch, open-time projection, async no-throw + focus re-anchor.
- [Source: `www/input/file-source.js:106-125, 441-546, 576-593`] — picker gate, Send modal build, CP/M reasons verbatim.
- [Source: `www/transport/session-log.js:26-27, 32-58, 62-89, 102-111`] — tooltip constants, wire/append/reset/download/getCurrentBytes, `setButtonState`.
- [Source: `www/transport/serial.js:520-527`] — RX-only + SLIDE-paused append gate.
- [Source: `_bmad-output/.../e2-3-serial-configuration-modal.md`] — the action-opens-further-UI analog + story format.
- [Source: `_bmad-output/.../epic-e2-retro-2026-07-03.md`, `epic-e1-retro-2026-07-02.md`] — open action items honored below.

### Flagged questions for Ant (do not block dev — recommended defaults chosen)

1. **`Send File…` caret placeholder.** The row currently renders `<span class="caret">▸ modal</span>`. **Recommended default:** remove it — `▸` is reserved for radio submenus, and the trailing `…` already signals "opens further UI" (matching `Serial Configuration…`). Rejected: keep it (visually implies a submenu that doesn't exist).
2. **Focus restore after a menu-triggered send that is cancelled.** The modal's `restoreTo` else-branch currently targets the legacy `#send-file-button` (`file-source.js:544`). Since the File menu closes on activation, there is no persistent menu trigger to return to. **Recommended default:** during E7 coexistence, keep the existing behavior (restore to the still-present `#send-file-button` on cancel/refuse; terminal wrapper on send/first-only) — byte-identical to today, zero new branching. Rejected: thread a menu-source flag to restore to the terminal wrapper on cancel — defer to E7 when `#send-file-button` is deleted and the else-branch must change anyway.
3. **Live-while-open enable.** Enabling the row the instant the first byte arrives while the File menu is held open requires the Task 3 `onStateChange` → `projectSessionLog` wire (cheap). **Recommended default:** implement it (the hook is needed for reset-to-disabled anyway). Rejected: open-time projection only (row would look stale until reclose/reopen — acceptable but worse UX for the price of one callback).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Amelia / bmad-dev-story)

### Debug Log References

None — no HALT conditions hit. Full suite green on the first run after wiring.

### Completion Notes List

- **Pure relocation, as scoped.** No user-facing behavior changed. The Send modal, CP/M validator, picker gate, and session-log accumulator are untouched; only their triggers were added. The two inert File rows are now live action items driving existing code via injected opts (AD-3), plus the one genuinely-new piece: the `session-log.js` `onStateChange` hook.
- **AD-3 seam honored throughout.** `menu-bar.js` imports neither `file-source.js` nor `session-log.js`; it reaches both only via `wireMenuBar` opts (`sendFile`, `downloadSessionLog`, `getSessionLogBytes`, `sessionLogTooltips`), mirroring `openSerialConfig`. menu-bar is the sole writer of its two File rows; session-log stays the sole writer of `#download-log-button`.
- **Tooltip single-sourcing (AC-4 resolution).** Because menu-bar cannot import session-log, the two verbatim tooltip strings are exported from `session-log.js` as the frozen `SESSION_LOG_TOOLTIPS` and injected into `wireMenuBar`. This satisfies AC-4's "do NOT re-hardcode elsewhere" while respecting AD-3 — session-log.js remains the single source of truth for the copy. (Small, deliberate refinement of Task 2's inline wording, which literally spelled the strings into the projector.)
- **onStateChange fires only on real transitions.** `lastNotifiedEnabled` is seeded to the wire-time disabled state, so the init `setButtonState(false)` and redundant resets do NOT notify; only the first-byte enable and a bytes→reset disable do. The callback is no-throw so a failing subscriber can never break the RX log accumulator.
- **Live-while-open enable (Q3 default).** `projectSessionLog` runs open-time (via `projectMenuOnOpen`) AND on the `onStateChange` hook, so a byte arriving while the File menu is held open enables the row immediately and re-anchors keyboard focus (mirrors `setChooseMicroBeastPresent`) so the highlight isn't stranded when the row joins `focusableItems()`.
- **Flagged questions:** Q1 (drop the `▸ modal` caret) — done. Q2 (cancel/refuse focus-restore during coexistence) — kept byte-identical to today (restore to `#send-file-button`); revisit at E7 when that button is deleted. Q3 (live enable) — implemented.
- **Tests:** full suite ran **429 passed / 1 skipped**. 8 tests reported flaky (all pre-existing, unrelated to E3.1 — the known wasm-boot-under-parallelism contention self-healed by the ratified `retries:1` mask; no per-story `--workers=1` needed).

### File List

- `www/index.html` — File-menu rows wired (`#menu-send-file-item` / `#menu-download-log-item`); E7-retirement markers refreshed on `#send-file-button` + `#download-log-button`.
- `www/input/file-source.js` — added `openSendPicker()` named export (gate-honoring picker entry).
- `www/transport/session-log.js` — added `onStateChange` opt + transition-only notify; exported `SESSION_LOG_TOOLTIPS`.
- `www/renderer/menu-bar.js` — File-menu refs/opts, `send-file` + `download-log` dispatch branches, `projectSessionLog()` projector (+ `projectMenuOnOpen` call + `buildApi` exposure).
- `www/main.js` — imported `openSendPicker` + `SESSION_LOG_TOOLTIPS`; injected the four File opts into `wireMenuBar`; added `onStateChange` to `wireSessionLog`.
- `www/tests/render/menu-bar.spec.js` — new E3.1 describe (4 tests).
- `www/tests/session/log-download.spec.js` — menu-triggered download test.
- `www/tests/input/file-source.spec.js` — menu-path picker→modal + focus test.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status → in-progress → review.

### Code Review

Run — **findings fixed in `6b61ba9`.** Independent `code-review` completed; the resulting fixes
were folded into the story commit `6b61ba9` ("E3.1 … + code-review fixes"). (Backfilled 2026-07-03
during the E4 retro — review was run and fixed at the time but the outcome was never recorded here.)

### Change Log

- 2026-07-03 — E3.1 implemented: File ▸ Send File… + Download Session Log wired to existing picker→modal and session-log download paths via injected opts (AD-3); added the `session-log.js` `onStateChange` hook + `SESSION_LOG_TOOLTIPS` export; 6 new tests. Status → review.
