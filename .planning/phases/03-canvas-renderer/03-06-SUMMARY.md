---
phase: 03-canvas-renderer
plan: 06
subsystem: ui
tags: [keyboard-shortcut, focus-indicator, chrome-wiring, accessibility, gap-closure]

# Dependency graph
requires:
  - phase: 03-canvas-renderer
    provides: "chrome.js wireChrome with keydown handler + focus/blur data-focused wiring (Plan 03-03); CSS custom properties + #terminal-wrapper layout (Plan 03-01)"
provides:
  - "Theme-toggle chord remapped from Ctrl+Shift+T (browser-reserved) to Ctrl+Alt+T (hookable)"
  - "Focus border driven by data-focused attribute (works for programmatic, mouse, and Tab focus — not just Tab)"
  - "theme-toggle button tooltip surfaces the new chord"
  - "README SC-2 and UI-SPEC Theme toggle table aligned on Ctrl+Alt+T with traceability to UAT gap #4 and original D-14"
affects: [04-keyboard-input, 03-07-regression-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Attribute-driven CSS focus indicators (data-focused=\"true\") instead of :focus-visible where programmatic/mouse focus must show the indicator"
    - "Conservative chord check: require explicit !shiftKey && !metaKey alongside ctrlKey && altKey to avoid accidental match on Chromium-reserved chords like Alt+Shift+T (pin tab)"

key-files:
  created:
    - .planning/phases/03-canvas-renderer/03-06-SUMMARY.md
  modified:
    - www/renderer/chrome.js
    - www/index.html
    - www/README.md
    - .planning/phases/03-canvas-renderer/03-UI-SPEC.md

key-decisions:
  - "Remap theme-toggle chord from D-14 Ctrl+Shift+T to Ctrl+Alt+T — Chromium reserves Ctrl+Shift+T for 'reopen closed tab' with no page-level override (UAT gap #4, RESEARCH §Pitfall 3). Ctrl+Alt+T is the standard Linux/GNOME/i3 'open terminal' chord and is fully hookable via preventDefault."
  - "Switch #terminal-wrapper focus border from :focus-visible to [data-focused=\"true\"] attribute selector — Chromium's :focus-visible heuristic only fires on keyboard-initiated focus (Tab), not on programmatic .focus() at boot nor on mouse click. chrome.js already sets data-focused on BOTH paths, making the attribute selector universally correct (UAT gap #7)."
  - "Keep #terminal-wrapper base rule (border: 1px solid transparent — D-13 no-reflow contract) untouched: surgical diff minimises regression surface."
  - "Chord check includes !e.shiftKey && !e.metaKey so Alt+Shift+T (Chromium 'pin tab' on some builds) and Cmd+Ctrl+Alt+T do NOT trigger the handler (T-03-06-01 mitigation)."

patterns-established:
  - "When CSS focus indicators must be visible for both programmatic and pointer focus, use an attribute-selector driven by a JS focus/blur listener instead of :focus-visible"
  - "When remapping a keyboard chord due to browser-reservation conflict, document the rationale inline in chrome.js (comment block), in the user-facing README (parenthetical in the step that uses the chord), and in the UI-SPEC table (traceability to original decision ID + UAT gap)"

requirements-completed: [RENDER-03, RENDER-07]

# Metrics
duration: 3min
completed: 2026-04-22
---

# Phase 03 Plan 06: Chrome Wiring Gap Closure Summary

**Remapped theme-toggle to Ctrl+Alt+T (unhookable Ctrl+Shift+T → hookable chord) and switched focus border to data-focused attribute selector so it shows on mouse/programmatic focus, not only Tab.**

## Performance

- **Duration:** 2m 53s
- **Started:** 2026-04-22T15:11:24Z
- **Completed:** 2026-04-22T15:14:17Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- **UAT gap #4 closed (Test 6):** `Ctrl+Shift+T` is Chromium-reserved for "reopen closed tab" and page-level preventDefault is silently ignored. Remapped to `Ctrl+Alt+T`, the standard Linux/GNOME/i3 "open terminal" chord, which is fully hookable. Chord check explicitly excludes `shiftKey`/`metaKey` to avoid Alt+Shift+T (Chromium "pin tab") collision.
- **UAT gap #7 closed (Test 10):** `#terminal-wrapper:focus-visible` never fired because Chromium only activates `:focus-visible` on keyboard-initiated focus (Tab). Switched to `#terminal-wrapper[data-focused="true"]` — chrome.js already sets `data-focused="true"|"false"` on focus/blur, so the border now appears for mouse click, programmatic .focus() at boot, AND Tab.
- **Discoverability:** `theme-toggle` button now has `title="Toggle theme (Ctrl+Alt+T)"` tooltip so users discover the chord without reading docs.
- **Documentation aligned:** README.md SC-2 section header AND step both reference Ctrl+Alt+T (no internal inconsistency); Ctrl+Shift+T survives only as rationale prose. 03-UI-SPEC.md Theme toggle table remapped with traceability back to D-14 (original chord) and 03-UAT.md gap #4 (trigger).

## Task Commits

Each task was committed atomically:

1. **Task 1: Remap theme-toggle chord to Ctrl+Alt+T in chrome.js** — `af80886` (fix)
2. **Task 2: Switch focus border CSS to data-focused attribute + add theme button tooltip** — `3212321` (fix)
3. **Task 3: Update README.md SC-2 + UI-SPEC.md D-14 amendment for the Ctrl+Alt+T remap** — `7227880` (docs)

**Plan metadata:** _pending — created after this SUMMARY_

## Files Created/Modified

- `www/renderer/chrome.js` — Replaced `Ctrl+Shift+T` keydown branch with `Ctrl+Alt+T` branch (adds `!e.shiftKey && !e.metaKey` guards; synchronous `preventDefault()` preserved per RESEARCH §Pitfall 3). Inline comment block explains the remap rationale.
- `www/index.html` — Replaced `#terminal-wrapper:focus-visible` CSS rule with `#terminal-wrapper[data-focused="true"]` attribute selector (chrome.js already populates the attribute). Added `title="Toggle theme (Ctrl+Alt+T)"` to `<button id="theme-toggle">`. `#terminal-wrapper` base rule (`border: 1px solid transparent`) untouched — D-13 no-reflow contract preserved.
- `www/README.md` — SC-2 section header remapped from `(Ctrl+Shift+T and UI button)` to `(Ctrl+Alt+T and UI button)`. SC-2 step 2 remapped from "Press Ctrl+Shift+T to switch back to CRT" to "Press Ctrl+Alt+T to switch back to CRT" with parenthetical citing `03-UAT.md gap #4`. `Ctrl+Shift+T` now appears exactly once (rationale prose only).
- `.planning/phases/03-canvas-renderer/03-UI-SPEC.md` — Theme toggle table row remapped to Ctrl+Alt+T; added tooltip note to top-bar-button row; rationale paragraph cites UAT gap #4 and D-14 for traceability.

## Decisions Made

- **Attribute selector over :focus-visible** — `:focus-visible` is strictly a keyboard-focus affordance in Chromium; it does not reflect "is this element focused" for any pointer or programmatic path. Since the chrome contract (D-13) needs the border to reflect *actual focus state* across all paths, attribute-driven CSS is the correct tool.
- **Keep the base rule untouched** — per REVIEW warning 4, the `#terminal-wrapper` default-state CSS (1px transparent border) already documents the no-reflow contract. Rewriting its comment block would expand the diff with no behavioral benefit.
- **Conservative modifier check on the chord** — `!e.shiftKey && !e.metaKey` alongside `e.ctrlKey && e.altKey` ensures Alt+Shift+T (Chromium "pin tab") and Cmd+Ctrl+Alt+T do not trigger the handler. Matches T-03-06-01 mitigation in the plan's threat register.
- **Document the remap in three places** — chrome.js comment block (developer reading code), README.md SC-2 parenthetical (user running UAT), UI-SPEC.md table (future planner auditing decisions). Traceability from any entry point lands on the same explanation.

## Deviations from Plan

None — plan executed exactly as written.

All three tasks' `<action>` blocks applied verbatim; all `<verify>` automated checks passed on first run; no auto-fixes were required and no architectural questions surfaced. Plan 03-06 was a tight, well-scoped gap-closure.

**Total deviations:** 0
**Impact on plan:** Zero scope creep. Surgical diff as designed.

## Issues Encountered

- **Expected failure in existing Playwright specs:** `theme-toggle.spec.js`'s `test('Ctrl+Shift+T toggles theme @fast')` and `keyboard.spec.js`'s `test('Ctrl+Shift+T toggles theme (state check only) @fast')` will now fail against the new chord. Plan 03-06's verification section calls this out explicitly — Plan 03-07 is scoped to rewrite those tests. NOT treated as a deviation because the plan anticipates and documents it.

## User Setup Required

None — no external service configuration, no new dependencies, no environment variables.

## Next Phase Readiness

Ready for Plan 03-07 (regression tests + human re-UAT):

- **Test rewrites expected:** `www/tests/render/theme-toggle.spec.js` and `www/tests/render/keyboard.spec.js` need `Ctrl+Shift+T` → `Ctrl+Alt+T` chord updates. Plan 03-07 addresses this.
- **Human re-UAT expected to pass:**
  - Test 6 (Ctrl+Alt+T toggles theme without browser hijack) — chrome.js now recognizes the new chord; Ctrl+Shift+T chord is no longer handled so Chromium's "reopen closed tab" default fires unhindered.
  - Test 10 (focus border visible after click AND Tab) — attribute-selector fires for both paths.
- **Plan 03-05 disjoint state preserved:** Plan 03-05 touched `canvas.js` / `main.js` / `index.html` (renderer fixes for UAT gaps 1/2/3/5/6/8 + WR-03/04/05). Plan 03-06 touches `chrome.js` / `index.html` / `README.md` / `03-UI-SPEC.md`. Index.html overlap is surgical (one selector swap + one attribute add) with zero conflict against 03-05's HTML edits.

## Self-Check: PASSED

Files (all FOUND):
- `www/renderer/chrome.js`
- `www/index.html`
- `www/README.md`
- `.planning/phases/03-canvas-renderer/03-UI-SPEC.md`
- `.planning/phases/03-canvas-renderer/03-06-SUMMARY.md`

Commits (all FOUND in `git log --oneline --all`):
- `af80886` — Task 1 (fix: chrome.js chord remap)
- `3212321` — Task 2 (fix: index.html data-focused selector + tooltip)
- `7227880` — Task 3 (docs: README.md + UI-SPEC.md alignment)

---
*Phase: 03-canvas-renderer*
*Completed: 2026-04-22*
