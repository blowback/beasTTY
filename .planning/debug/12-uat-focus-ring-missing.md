---
status: diagnosed
trigger: "UAT Test 5 (Phase 12 12-UAT.md): [Send N renamed] button does not show a visible focus ring as the modal's default-focused element when collisions are present, even though it IS the default focus target (Enter triggers it)."
goal: find_root_cause_only
created: 2026-05-09T00:30:00Z
updated: 2026-05-09T00:50:00Z
---

## Current Focus

hypothesis: ":focus-visible" pseudo-class is gated on keyboard-initiated focus heuristic in Chromium. The modal opens via a pointer-initiated path (drop / mouse click on file picker), then file-source.js calls `.focus()` programmatically on `sendRenamedBtnRef`. Chromium's `:focus-visible` heuristic does NOT trigger for programmatic .focus() following pointer-initiated interaction, so the `border-color: var(--chrome-accent)` rule (the project's "focus ring" mechanism) never applies. The button HAS focus (Enter triggers it) but the visual cue is suppressed by browser policy.
test: Read CSS at www/index.html:711-723 to confirm modal-button focus styling is gated solely on `:focus-visible`. Read existing project documentation at www/index.html:108-116 to confirm this exact failure mode is already documented (gap #7 fix from Phase 6).
expecting: Confirmation that the modal-button focus indicator uses `:focus-visible` only, with no fallback `:focus` rule and no attribute-driven indicator. If confirmed → root cause is browser `:focus-visible` heuristic mismatch with programmatic `.focus()` after pointer-initiated modal open.
next_action: Diagnosis complete — return to caller for plan-phase --gaps to schedule the fix.

## Symptoms

expected: [Send N renamed] button shows a visible focus ring (border-color: var(--chrome-accent) per the existing #send-modal footer button:focus-visible rule) as the modal's default-focused element when collisions are present.
actual: [Send N renamed] button has focus (Enter triggers it — confirmed by user), but no visible focus ring/outline/border-color change renders.
errors: none (cosmetic-only)
reproduction: UAT Test 5 — drop ≥2 files into the terminal whose names collide under CP/M 8.3 rules. Modal opens. Default-focused button is [Send N renamed]. No visible focus ring appears.
started: Phase 12 Plan 02 commits be4a630 / 93efb1b / 6eb72f9 (added the three-button modal footer with D-03 default-focus override).

## Eliminated

- hypothesis: "Existing modal button styles set `outline: none` somewhere without a replacement."
  evidence: www/index.html:723 DOES set `outline: none` on `#send-modal footer button:focus-visible`, but this is intentional — the project replaces the UA outline with a `border-color: var(--chrome-accent)` change on the SAME ruleset. The replacement IS present (line 722). So the missing-replacement hypothesis is wrong; the replacement exists, it's the rule activation that fails.
  timestamp: 2026-05-09T00:45:00Z

- hypothesis: "The button has no `:focus`/`:focus-visible` rule at all (relies on browser default)."
  evidence: www/index.html:720-724 has `#send-modal footer button:hover, #send-modal footer button:focus-visible { border-color: var(--chrome-accent); outline: none; }`. The new buttons (#send-modal-send-renamed / #send-modal-first-only / #send-modal-refuse) DO match this selector — they are `<button>` elements inside the `#send-modal <footer>` per www/index.html:1056-1070. Selector applies; the rule is not missing.
  timestamp: 2026-05-09T00:45:00Z

- hypothesis: "The three new IDs are missing from the focus-style selector list (e.g. an explicit ID-list selector that excludes them)."
  evidence: The selector is `#send-modal footer button:focus-visible` — NOT an ID-list. It applies to ALL `<button>` descendants of the modal `<footer>`. The three new buttons (1067-1069) are direct children of the same `<footer>` as the Phase 9 buttons (1057-1058). Selector coverage is uniform.
  timestamp: 2026-05-09T00:45:00Z

## Evidence

- timestamp: 2026-05-09T00:35:00Z
  checked: www/input/file-source.js:493-517 (showConfirmModal Promise body — focus call site)
  found: Line 509: `modalElRef.showModal();`. Lines 513-516: `const initialFocusTarget = collisionsPresent ? (sendRenamedBtnRef || cancelBtnRef) : cancelBtnRef; initialFocusTarget?.focus();`. Focus is set programmatically via `.focus()` AFTER `.showModal()`.
  implication: This is a pure programmatic `.focus()` call. No `focus({ focusVisible: true })` hint. No keyboard event preceded it (modal is opened by mouse drop or file-picker dismissal — both pointer-initiated paths).

- timestamp: 2026-05-09T00:38:00Z
  checked: www/index.html:711-728 (modal footer button CSS)
  found: The "focus ring" is implemented as a border-color change, NOT an outline. `#send-modal footer button { border: 1px solid var(--chrome-border); }` defines the resting border. `#send-modal footer button:hover, #send-modal footer button:focus-visible { border-color: var(--chrome-accent); outline: none; }` is the ONLY rule that produces a focus indicator. There is NO `:focus` (without -visible) rule, NO attribute-driven (`[data-focused]`) rule, and NO `[aria-focused]` style.
  implication: The visible focus cue is gated 100% on the `:focus-visible` pseudo-class. If the browser does not match `:focus-visible` for this focused element, NO visible cue renders.

- timestamp: 2026-05-09T00:40:00Z
  checked: www/index.html:108-116 (existing project comment — terminal-wrapper focus indicator)
  found: A verbatim documentation block already exists in the project explaining this exact failure mode for the terminal-wrapper border: "Attribute-based selector is used instead of :focus-visible because Chromium's :focus-visible heuristic does NOT trigger for programmatic .focus() at boot OR for mouse-click focus — it only activates on keyboard-initiated focus (e.g. Tab). The data-focused='true' attribute is set by chrome.js on BOTH programmatic and pointer focus, making this indicator work in every focus path (gap #7 fix — previously test 10 failed because :focus-visible never fired after .focus() at boot)."
  implication: This is a known Chromium behavior already encountered and mitigated elsewhere in the project (Phase 6 gap #7). The Phase 12 modal-button focus styling did NOT receive the same attribute-driven mitigation and so reproduces the original failure mode.

- timestamp: 2026-05-09T00:42:00Z
  checked: Modal-open trigger paths (www/input/file-source.js:107-115, :264-289)
  found: Both trigger paths are pointer-initiated:
    (1) File picker dismissal — `sendInput.addEventListener('change', ...)` follows from a click on the top-bar [↑ Send file] button which routes to `sendInput.click()` and the OS-native file picker (mouse-driven by default).
    (2) Drop event — `wrapperEl.addEventListener('drop', ...)` is fired by the OS drag-drop completion (mouse-driven, exclusively).
  implication: The modality preceding `.focus()` is pointer in both supported paths. Chromium's `:focus-visible` heuristic is therefore in "do-not-show-keyboard-focus-ring" mode when `.focus()` is called. This applies equally to the Phase 9 Cancel button and the Phase 12 [Send N renamed] button — but the Cancel button's missing focus ring is also a real bug that the user simply did not notice (or the user's UAT Test 4-no-collision path happens to have already triggered keyboard focus, e.g. Tab from connect-button, before the modal opened).

- timestamp: 2026-05-09T00:45:00Z
  checked: www/index.html:1056-1070 (modal footer markup)
  found: All five footer buttons (cancel, send, send-renamed, first-only, refuse) are direct children of the same `<footer>` element. They all match the selector `#send-modal footer button`. The CSS rule applies uniformly; no per-ID exception exists.
  implication: The bug is architectural (focus-visible policy), NOT a missed selector. The fix must add a focus-visibility-independent indicator (analog of the Phase 6 `[data-focused]` attribute pattern) OR add a plain `:focus` rule (less precise but simpler). Cancel button is incidentally affected by the same root cause.

## Resolution

root_cause: |
  Chromium's `:focus-visible` heuristic does not trigger for programmatic `.focus()` calls
  that follow pointer-initiated interactions. The Phase 12 modal opens via drop (mouse)
  or file-picker dismissal (mouse), then file-source.js:516 calls `.focus()` on
  `sendRenamedBtnRef`. Chromium classifies the focus modality as "pointer" and suppresses
  `:focus-visible`. The project's only focus-indicator rule for modal footer buttons —
  `#send-modal footer button:focus-visible { border-color: var(--chrome-accent); }` at
  www/index.html:721-723 — never matches, so no visible cue renders. Button HAS focus
  (Enter triggers click) but the visual border-color change is gated solely on
  `:focus-visible`, with no fallback `:focus` rule and no attribute-driven indicator.

  This is the same Chromium behavior the project already mitigated for the terminal-wrapper
  border (www/index.html:108-116, "gap #7 fix") — but the Phase 12 modal footer did not
  receive the same attribute-driven treatment.

  Note: the Phase 9 Cancel button shares the SAME bug; user did not report it on Cancel
  but the failure mode is identical when the modal is opened via pointer.

fix: (deferred to plan-phase --gaps; do not apply here per goal: find_root_cause_only)
verification: (deferred)
files_changed: []
