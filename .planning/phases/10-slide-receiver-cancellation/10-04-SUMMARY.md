---
phase: 10-slide-receiver-cancellation
plan: 04
subsystem: ui
tags:
  - js
  - dom
  - ui
  - settings
  - file-system-access
  - indexeddb
  - showDirectoryPicker
  - prefs

# Dependency graph
requires:
  - phase: 10-slide-receiver-cancellation/10-02
    provides: idb.js (getRecvDirHandle/setRecvDirHandle), prefs.slideRecvToFolder DEFAULT, slide-recv.js skeleton wireSlideRecv null-tolerant DOM refs
  - phase: 10-slide-receiver-cancellation/10-03
    provides: cancel state machine + Esc disambiguation + boot wireSlideRecv with null DOM refs
  - phase: 06-daily-driver-polish-session-deployment
    provides: .settings-row CSS pattern, savePrefs/loadPrefs lifecycle, Phase 6 defensive merge for missing-field-additive prefs schema
  - phase: 04-keyboard-input
    provides: D-16 mousedown preventDefault focus-retention rule
provides:
  - Settings pane row "[ ] Save received files to a folder" + "[Choose folder…]" button + state-string span + hint paragraph
  - 4-state runtime swap (a) toggle off / (b) toggle on no folder / (c) toggle on granted / (d) toggle on denied
  - showDirectoryPicker click flow with handle persistence in IndexedDB
  - boot-time queryPermission probe + state (c)/(d) reflection on first paint
  - state (d) → (c) requestPermission shortcut (no picker dialog when handle is cached but pending)
  - LOCKED VERBATIM COPY constants (frozen object) for all UI strings — single source of truth
  - SLIDE-18 (Chrome download path PLUS opt-in folder save) — user-visible folder-save now operational
  - SLIDE-20 (filename verbatim + collision exception annotation) — UI surfaces handle.name verbatim
affects:
  - phase 10-05 (UAT/E2E — Playwright specs assert COPY constants byte-for-byte against rendered DOM)
  - phase 11-slide-js-bridge (Settings-row pattern + COPY frozen object pattern reused for slideAutoSendCommand / slideShowSummary / Compatibility mode rows)
  - phase 12-slide-uat (real-hardware UAT checklist mentions browser-owned chrome — showDirectoryPicker, requestPermission)

# Tech tracking
tech-stack:
  added: []  # framework-free; reuses showDirectoryPicker / IndexedDB already in scope
  patterns:
    - "LOCKED VERBATIM COPY frozen object: every UI string lives in a top-of-module Object.freeze({...}) so executor + plan-checker grep gates can find each string by symbolic name; no string-literal drift across renderers"
    - "4-state Settings row state machine driven by (toggle.checked, hasHandle, currentPermission) tuple; pure renderSettingsRow() function with no side effects beyond DOM textContent/disabled/title writes"
    - "Boot-time hydration: queryPermission probe (no user gesture) on cached IDB handle → render state (c) or (d) on first paint; user must click [Re-allow folder…] to escalate to requestPermission inside an explicit gesture handler"
    - "State (d) → (c) requestPermission shortcut: button click first tries requestPermission on the cached handle; only falls through to showDirectoryPicker if request fails"

key-files:
  created: []
  modified:
    - www/index.html (37 LoC: hr.settings-divider + div.settings-row#slide-recv-folder-row + ~10 LoC CSS for .settings-row .settings-row-action flex layout)
    - www/transport/slide-recv.js (197 net-new LoC: COPY object + renderSettingsRow + onToggleChange + onFolderButtonClick + pickFolder + requestPermissionAndUpdate + bootHandleHydration + wireSlideRecv DOM-handler installation)
    - www/main.js (6 net-new LoC: 5 document.getElementById lookups + non-null DOM refs in wireSlideRecv call)

key-decisions:
  - "COPY constants frozen at top of module — Object.freeze prevents accidental mutation; functions for state strings that interpolate handle.name (stateSavingTo, statePermissionDenied) keep the COPY object the single source of truth for VERBATIM strings"
  - "U+2026 ellipsis character used in 'Choose folder…' / 'Change folder…' / 'Re-allow folder…' (NOT three ASCII dots); U+26A0 bare warning sign in 'Pick a folder before next transfer' / 'Permission needed for {name}' (NOT U+FE0F variant emoji form)"
  - "Boot-time queryPermission first (Chrome 122+ guidance — does not need user gesture); requestPermission deferred to button click (state d → c shortcut) — never called outside an explicit user gesture handler"
  - "Picker dismissal D-04 silent fall-back: AbortError swallowed without console.error or state change; non-AbortError logged via console.warn"
  - "Decoupled toggle/button: toggle change handler does NOT auto-trigger pickFolder per UI-SPEC §Settings-row state machine — user clicks the button explicitly so transition (b) happens on user gesture not on toggle flip"
  - "downloadToFolder cachedHandle preference (cachedHandle || idbRef.getRecvDirHandle()) preserved from Plan 10-02 — Plan 10-04's pickFolder + bootHandleHydration populate cachedHandle so downloadToFolder doesn't re-hit IndexedDB on every file"
  - "Phase 9 send-button gating already covers recv mode via file-source.js:129 (st?.mode === 'recv') — no edit required (UI-SPEC §Active recv session — visible-element contract verified)"
  - "prefs schema NOT bumped — Phase 6 defensive merge `cached = { ...DEFAULTS, ...parsed }` at prefs.js:55 fills missing slideRecvToFolder field with `false` (Plan 10-02 already added the DEFAULT); UI-SPEC §Toggle persistence acknowledges this option"
  - "wrapperElRef alias used (existing Plan 10-02 module-scope variable) instead of introducing a new terminalWrapperElRef — keeps module-scope variable count constant"

patterns-established:
  - "LOCKED VERBATIM COPY pattern: every user-visible string lives in a top-of-module `const COPY = Object.freeze({ key: 'value', ... })` object; renderers reference COPY.key, never inline string literals; plan-checker greps COPY.* references and asserts each value byte-for-byte against the spec"
  - "State machine row pattern: pure renderSettingsRow() reads (toggleEl.checked, hasHandle, currentPermission) and writes button.textContent + button.disabled + button.title + statusEl.textContent + helpEl.textContent — single function covers all 4 runtime states with one if/elif/elif/else cascade"
  - "Boot hydration pattern: bootHandleHydration() called from wireSlideRecv tail — orchestrates IDB read → queryPermission probe → renderSettingsRow without requiring a user gesture; safe with null DOM refs (renderSettingsRow no-ops on null)"
  - "User-gesture preserved requestPermission: requestPermission only called inside a click handler (onFolderButtonClick state d → c arm) or after showDirectoryPicker resolution; queryPermission used everywhere else"

requirements-completed:
  - SLIDE-18
  - SLIDE-20

# Metrics
duration: 5min
completed: 2026-05-08
---

# Phase 10 Plan 04: SLIDE Recv-to-Folder Settings UI Summary

**Settings pane gains a 4-state SLIDE recv-to-folder toggle row with showDirectoryPicker integration, IndexedDB handle persistence, and Chrome 122+ permission re-request flow — making the folder-save path operationally usable for the first time.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-08T11:17:50Z
- **Completed:** 2026-05-08T11:23:30Z
- **Tasks:** 3
- **Files modified:** 3 (www/index.html, www/transport/slide-recv.js, www/main.js)

## Accomplishments

- Settings pane has the new `.settings-row#slide-recv-folder-row` block at the bottom of `<details id="settings">`, after `Reset all preferences`, separated by a fresh `<hr class="settings-divider" />` per UI-SPEC §"Element ordering" (this row leads a new SLIDE-features block that Phase 11 will extend).
- All 5 element IDs from UI-SPEC §"New DOM structure" present: `slide-recv-folder-row` / `slide-recv-to-folder-checkbox` / `slide-recv-folder-button` / `slide-recv-folder-status` / `slide-recv-folder-help`. ~10 LoC CSS for `.settings-row .settings-row-action` flex layout, no new design tokens.
- LOCKED VERBATIM COPY frozen object in slide-recv.js holds all 4 button labels (Choose folder… / Change folder… / Re-allow folder…), 4 tooltips, 4 state strings (with U+26A0 bare warning glyph for states b/d), 2 hint paragraph variants. Verified U+2026 ellipsis (NOT three ASCII dots) and U+26A0 bare (NOT U+FE0F variant emoji `⚠️`).
- `renderSettingsRow()` pure renderer covers all 4 runtime states (a/b/c/d) with a single if/elif/elif/else cascade reading `(toggleEl.checked, hasHandle, currentPermission)` tuple. `onToggleChange` updates prefs + savePrefs + renders. `onFolderButtonClick` implements the state (d) → (c) requestPermission shortcut before falling through to `pickFolder`.
- `pickFolder()` calls `showDirectoryPicker({ mode: 'readwrite' })`, persists handle to IndexedDB, transitions to state (c). Picker dismissal (AbortError) D-04 silent fall-back — no console.error, no state change. Terminal focus restored via `wrapperElRef.focus()` on every settle (resolve OR reject).
- `bootHandleHydration()` boot-time orchestrator: reads IndexedDB → calls `queryPermission` (no user gesture required per Chrome 122+ guidance) → renders state (c) or (d). Triggered automatically from wireSlideRecv tail.
- main.js wires all 5 Settings DOM refs into the existing wireSlideRecv call from Plan 10-03 (replacing null placeholders). Phase 9 send-button gating verified — file-source.js:129 already covers `st?.mode === 'recv'`, no edit required.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Settings DOM block + CSS to www/index.html** - `6755dac` (feat)
2. **Task 2: Extend slide-recv.js with renderSettingsRow + pickFolder + bootHandleHydration + DOM event handlers** - `94422ee` (feat)
3. **Task 3: Wire 5 Settings DOM refs into wireSlideRecv from main.js** - `02d8e71` (feat)

## Files Created/Modified

- `www/index.html` — 37 LoC added: `<hr class="settings-divider" />` + `<div class="settings-row" id="slide-recv-folder-row">` block (5 element IDs, locked verbatim copy for state-(a) defaults: button label `Choose folder…`, status `No folder selected`, hint paragraph "Received files land in your Downloads folder. Toggle this to pick a fixed destination."); ~10 LoC CSS rule block for `.settings-row .settings-row-action` flex layout (display: flex; align-items: center; gap: 8px; margin: 4px 0 0 24px) + nested `.hint` margin reset.
- `www/transport/slide-recv.js` — 197 net-new LoC: top-of-module `COPY = Object.freeze({...})` constants block (~20 LoC); `renderSettingsRow` (~36 LoC pure renderer); `onToggleChange` (~5 LoC); `onFolderButtonClick` (~24 LoC, includes state d → c shortcut); `pickFolder` (~25 LoC); `requestPermissionAndUpdate` (~12 LoC); `bootHandleHydration` (~17 LoC); wireSlideRecv extended (~15 LoC) to install change/click/mousedown listeners + bootHandleHydration tail call.
- `www/main.js` — 6 net-new LoC: 5 `document.getElementById` lookups for the new Settings DOM refs; replacement of `rowEl: null, toggleEl: null, ...` placeholder with the live refs in the existing wireSlideRecv call.

## Decisions Made

- **COPY constants frozen object as single source of truth.** All user-visible strings live in `Object.freeze({ buttonChooseFolder: 'Choose folder…', ... })`. Functions (stateSavingTo, statePermissionDenied) wrap the interpolation patterns so the COPY object stays the one place the verbatim text appears.
- **Glyph rules verified.** `Choose folder…` ends with U+2026 (single ellipsis character); `⚠ Pick a folder before next transfer` and `⚠ Permission needed for {name}` use U+26A0 bare (NOT U+FE0F variant emoji `⚠️`). `grep -c $'\xe2\x9a\xa0\xef\xb8\x8f' www/index.html www/transport/slide-recv.js` returns 0 in both.
- **State (d) → (c) requestPermission shortcut.** Button click handler first tries `cachedHandle.requestPermission({ mode: 'readwrite' })` if currentPermission !== 'granted'. On 'granted', skip the picker dialog entirely. On 'prompt'/'denied', fall through to `showDirectoryPicker`. Saves the user one extra click when the previously-chosen folder just needs permission renewal.
- **Boot path uses queryPermission, button click uses requestPermission.** Chrome 122+ guidance: queryPermission is gesture-free (safe to call from boot orchestrator); requestPermission must be called from inside an explicit user-gesture handler. bootHandleHydration probes via queryPermission only — escalation deferred to user clicking [Re-allow folder…].
- **Picker dismissal D-04 silent fall-back.** AbortError swallowed without console.error; only non-AbortError errors (very rare) are console.warn'd. State stays at (b) so user can retry without the row reflecting an error.
- **Decoupled toggle/button per UI-SPEC §Settings-row state machine.** onToggleChange does NOT auto-trigger pickFolder. Toggle flip from (a) → (b) just enables the button; user clicks it to enter the picker. Two-step flow lets users toggle off without a folder permission UX side-effect.
- **Phase 9 send-button gating verified pre-existing.** file-source.js:129 already reads `isReceiving = st?.mode === 'recv'` and disables the [↑ Send file] button during recv too — no 1-line edit needed (UI-SPEC §"Active recv session — visible-element contract" satisfied as-is).
- **prefs schema NOT bumped.** Phase 6 defensive merge `cached = { ...DEFAULTS, ...parsed }` at prefs.js:55 already fills the slideRecvToFolder field with `false` for legacy localStorage blobs (Plan 10-02 added the DEFAULT). UI-SPEC §"Toggle persistence" recommended this approach over a version bump.
- **wrapperElRef reuse.** Existing module-scope `wrapperElRef` from Plan 10-02 used for terminal focus restoration; no new variable introduced (initially generated `terminalWrapperElRef` but corrected to wrapperElRef before any commit — see Auto-fix #1 below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] terminalWrapperElRef vs existing wrapperElRef name collision**
- **Found during:** Task 2 (slide-recv.js extension)
- **Issue:** Plan 10-04's task action step 1.a suggested adding a new module-scope `terminalWrapperElRef` variable; the existing module already had `wrapperElRef` from Plan 10-02 holding the same value. Two variables for the same DOM ref would have caused subtle bugs if one was updated and the other not.
- **Fix:** Used the existing `wrapperElRef` for terminal focus restore in `pickFolder()` finally block and in `onFolderButtonClick`'s state d → c arm; did NOT introduce a duplicate variable.
- **Files modified:** www/transport/slide-recv.js (focus calls reference `wrapperElRef.focus()` not `terminalWrapperElRef.focus()`)
- **Verification:** `grep -c terminalWrapperElRef www/transport/slide-recv.js` returns 0; `grep -c wrapperElRef.focus www/transport/slide-recv.js` returns 2 (state-d-to-c arm + pickFolder finally)
- **Committed in:** 94422ee (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking — name collision avoided)
**Impact on plan:** Pure refactor of plan-suggested name to existing module-scope variable. Zero functional change to behavior. No scope creep.

## Issues Encountered

- Two pre-existing flaky tests during initial test:fast runs (`reconnect.spec.js:43` and `keyboard.spec.js:18`). Both are unrelated to Plan 10-04's changes (Phase 5 transport reconnect + Phase 4 keyboard zoom). Each flake reproduces ~once per 3 runs of test:fast in isolation; both pass when re-run individually. Third test:fast run after Task 2 was 81/81 green deterministically. Logged as Phase 10 deferred-items observation but NOT auto-fixed per scope-boundary rule (out-of-scope test infrastructure).

## Verification Results

### Static Greps (success criteria from plan prompt)

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -c 'Save received files to a folder' www/index.html` | ≥ 1 | 1 | PASS |
| `grep -c 'Choose folder…' www/index.html` (U+2026 ellipsis) | ≥ 1 | 2 | PASS |
| `grep -c 'id="slide-recv-to-folder-checkbox"' www/index.html` | ≥ 1 | 1 | PASS |
| `grep -c 'showDirectoryPicker' www/transport/slide-recv.js` | ≥ 1 | 6 | PASS |
| `grep -c 'requestPermission' www/transport/slide-recv.js` | ≥ 1 | 8 | PASS |
| `grep -c '999' www/transport/slide-recv.js` (suffix retry budget) | ≥ 1 | 3 | PASS |
| `grep -c $'\xe2\x9a\xa0\xef\xb8\x8f' www/index.html` (variant emoji `⚠️`) | 0 | 0 | PASS |
| `grep -c $'\xe2\x9a\xa0\xef\xb8\x8f' www/transport/slide-recv.js` | 0 | 0 | PASS |

### LOCKED VERBATIM COPY confirmation (UI-SPEC §Copywriting Contract)

All 14 strings present in COPY object byte-for-byte:

| Symbol | Value (verbatim) |
|--------|------------------|
| buttonChooseFolder | `Choose folder…` |
| buttonChangeFolder | `Change folder…` |
| buttonReAllow | `Re-allow folder…` |
| tooltipToggleFirst | `Toggle the checkbox first` |
| tooltipPickFolder | `Pick a folder for received files` |
| tooltipChangeFolder | `Pick a different folder for received files` |
| tooltipReAllow | `Re-grant permission for the previously-chosen folder` |
| stateNoFolder | `No folder selected` |
| stateNeedsFolder | `⚠ Pick a folder before next transfer` |
| stateSavingTo(name) | `Saving to: ${name}` |
| statePermissionDenied(name) | `⚠ Permission needed for ${name}` |
| hintToggleOff | `Received files land in your Downloads folder. Toggle this to pick a fixed destination.` |
| hintToggleOn | `Received files are written here directly. Toggle off to revert to your Downloads folder.` |

### Test results

- `cd www && npm run test:fast`: 81/81 PASS (third run; first two had unrelated pre-existing flakes in reconnect.spec.js + keyboard.spec.js — both unrelated to Plan 10-04)
- `cd www && npx playwright test slide-wakeup.spec.js slide-dispatcher.spec.js slide-sender.spec.js file-source.spec.js`: 36/36 PASS (Phase 8/9 specs preserved)
- `bash scripts/build.sh`: exit 0 (no Rust changes — wasm rebuild succeeds; www/pkg/ regenerated; ADR-002 invariant preserved — only lib.rs has #[wasm_bindgen])
- ESM module load smoke: `node -e "import('./transport/slide-recv.js').then(m => Object.keys(m))"` returns 9 expected exports

### Manual DevTools session smoke check

Not executed in this autonomous run (would require interactive browser session). Recommended for human-verify checkpoint when run in non-auto mode:

1. Open page; expand Settings → confirm row visible at bottom with "[ ] Save received files to a folder" + "[Choose folder…]" (disabled) + "No folder selected".
2. Click the checkbox → button enables, status text changes to "⚠ Pick a folder before next transfer".
3. Click "[Choose folder…]" → showDirectoryPicker dialog appears → pick a folder → button text changes to "[Change folder…]" + status text changes to "Saving to: {folder name}".
4. Reload the page → state (c) or (d) per Chrome version (Chrome 122+ shows one-click Allow + state c persists; older Chrome may downgrade to state d requiring [Re-allow folder…] click).
5. Toggle off → status text "No folder selected"; handle persists in IndexedDB so re-toggling on restores state (c).

## Next Phase Readiness

- **Plan 10-05 (UAT/E2E) unblocked.** All 5 DOM IDs are stable; the COPY frozen object provides a stable surface for Playwright `expect(button).toHaveText(COPY.buttonChooseFolder)` style assertions; window.__slideRecv.__getStateForTests exposes hasHandle / handleName / permission for IDB integration tests.
- **No blockers.** SLIDE-18 + SLIDE-20 user-visible affordances now operational; the Z80 receive path from Plans 10-01/10-02/10-03 is now end-to-end usable with folder-save persistence across reloads.
- **Phase 11 reuse anticipated.** The COPY frozen-object pattern + the 4-state runtime swap renderer are the templates for the slideAutoSendCommand (text input row), slideShowSummary (checkbox), and Compatibility mode (selector) Settings rows that Phase 11 SLIDE-37/SLIDE-39 will extend below the Plan 10-04 row.

## Self-Check: PASSED

- File created: `.planning/phases/10-slide-receiver-cancellation/10-04-SUMMARY.md` — FOUND
- Commit `6755dac` (Task 1 — index.html) — FOUND in `git log --oneline`
- Commit `94422ee` (Task 2 — slide-recv.js) — FOUND in `git log --oneline`
- Commit `02d8e71` (Task 3 — main.js) — FOUND in `git log --oneline`
- All 3 task commits exist on the current branch (slide_integration)
- All 8 success criteria from plan prompt verified PASS

---
*Phase: 10-slide-receiver-cancellation*
*Completed: 2026-05-08*
