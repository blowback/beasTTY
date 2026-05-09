---
phase: 12-slide-ux-polish-docs-real-hardware-uat
plan: 06
subsystem: ui
tags: [css-specificity, focus-visible, data-attribute, playwright, slide-36, slide-38, gap-closure]

# Dependency graph
requires:
  - phase: 12-slide-ux-polish-docs-real-hardware-uat
    provides: "Plan 12-02 SLIDE-36 collision modal (the modal whose default-focus button needed the focus indicator) + Plan 12-03 SLIDE-38 auto-send safety regex + Settings invalid-state CSS scaffolding (the rule whose specificity we bump)"
  - phase: 06-daily-driver-polish-session-deployment
    provides: "Phase 6 gap #7 [data-focused='true'] attribute pattern on #terminal-wrapper — the canonical mitigation we replicate for the modal footer"
  - phase: 05-web-serial-transport
    provides: "#e04040 literal red used in #connect-button[data-state='port-lost'] — the de-facto error red we promote to the --chrome-invalid-strong CSS variable"
provides:
  - "[data-focused='true'] attribute-driven focus indicator on #send-modal footer buttons (CSS rule covers all five footer buttons; JS sets+clears attribute at .focus() call site + onClose handler in file-source.js)"
  - "--chrome-invalid-strong (#e04040) CSS variable in :root — promotes the Phase 5 literal hex to a named token without modifying Phase 5 declaration (deliberate single-control exception to muted/destructive policy)"
  - "Bumped-specificity (0,2,2,0) invalid-state rule for #slide-auto-send-input — wins on specificity ALONE against base (0,2,0,0) and :focus-visible (0,2,1,0); no source-order tiebreak required"
  - "Two new + two appended Playwright regression tests pinning the visible-border contracts (BLURRED-state assertions for autosend; data-focused attribute poll as load-bearing assertion for modal default-focus)"
affects: [phase-12-verify, future-modal-refactors, future-css-tokens]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "[data-focused='true'] attribute-driven focus indicator (Phase 6 gap #7 pattern, replicated for modal footer)"
    - "Specificity-bump CSS pattern: leading [data-theme] (always-true on body) adds (0,1,0) without affecting semantics"
    - "BLURRED-state computed-color contract for visible-border tests (avoids :focus-visible interference under Playwright synthetic input paths)"

key-files:
  created:
    - "www/tests/render/modal-default-focus.spec.js (NEW — 2 tests pinning Gap 1 contract)"
  modified:
    - "www/index.html (CSS — :root --chrome-invalid-strong + #send-modal footer button[data-focused] rule + bumped-specificity invalid-state rule)"
    - "www/input/file-source.js (JS — setAttribute('data-focused','true') at .focus() call site + clear in onClose handler)"
    - "www/tests/transport/slide-autosend-safety.spec.js (APPEND — 2 tests pinning Gap 2 BLURRED-state contracts)"

key-decisions:
  - "Promote #e04040 (Phase 5 port-lost red literal) to --chrome-invalid-strong CSS variable rather than introducing a new hex literal. Single-control exception to muted/destructive policy locked by user 2026-05-09 (\"it's a serious matter so red is appropriate\")."
  - "Use specificity (0,2,2,0) — not (0,2,1,0) — for the invalid-state rule. Wins on specificity ALONE against the :focus-visible rule (0,2,1,0); future file rearrangements cannot silently regress focused-and-invalid case."
  - "Test load-bearing assertion is the data-focused attribute poll, not the computed-color check. Playwright's synthetic file-input path may still classify .focus() as keyboard-like and match :focus-visible — the attribute poll catches a missing JS edit unambiguously; computed-color is defense-in-depth."
  - "Phase 9 [Cancel] button benefits incidentally from the data-focused fix via the shared .focus() call site. Plan 12-06 is single-call-site scope, not a Phase 9 retrofit."

patterns-established:
  - "Defense-in-depth visual cue for security-relevant inputs: hard gate (use-time check at boundary) + DOM marker (data-invalid attribute) + visible cue (red border via specificity-stable rule). Plan 12-03 shipped layers 1-2; Plan 12-06 closes layer 3 at full visual parity."
  - "Promote-on-promote-only CSS variable introduction: don't sprinkle hex; promote an existing literal to a named token with explicit comment about scope and don't retroactively rewrite the donor declaration."

requirements-completed: [SLIDE-36, SLIDE-38]

# Metrics
duration: 8min
completed: 2026-05-09
---

# Phase 12 Plan 06: SLIDE-36/SLIDE-38 UX-cliff gap closure Summary

**Closes the two diagnosed UAT gaps — modal default-focus visible focus indicator (replicates Phase 6 gap #7 [data-focused] pattern for #send-modal footer) and auto-send Settings invalid-border specificity collision (bumps to 0,2,2,0 + switches to red --chrome-invalid-strong token).**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-09T11:52:29Z
- **Completed:** 2026-05-09T12:00:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Gap 1 (UAT Test 5, cosmetic) closed: `[Send N renamed]` modal default-focus button now paints a visible green border on collision-mode modal open via the `[data-focused="true"]` attribute pattern (mirrors Phase 6 gap #7 mitigation on `#terminal-wrapper`). Phase 9 `[Cancel]` button benefits incidentally via the shared `.focus()` call site.
- Gap 2 (UAT Test 7, major) closed: Settings auto-send command field now paints a red border (`--chrome-invalid-strong = #e04040`) when value fails `SAFE_AUTO_SEND_RE`. Specificity bump to `(0,2,2,0)` wins ALONE against the base `(0,2,0,0)` rule and the `:focus-visible` `(0,2,1,0)` rule — no source-order tiebreak required.
- New `--chrome-invalid-strong` CSS variable in `:root` promotes the existing Phase 5 `#e04040` port-lost literal to a named token (deliberate single-control exception to the muted/destructive policy, locked by user 2026-05-09).
- 4 new Playwright regression tests pin both contracts so neither gap can silently return; full isolated suite (modal-default-focus + slide-autosend-safety) green at `--workers=1` (19/19).

## Task Commits

Each task was committed atomically:

1. **Task 1: data-focused attribute mitigation for modal footer default-focus** — `2816432` (feat)
2. **Task 2: invalid-state specificity (0,2,2,0) + --chrome-invalid-strong red token** — `2a06a30` (feat)
3. **Task 3: Playwright regression tests pinning Gap 1 + Gap 2 contracts** — `e00dda5` (test)

## Files Created/Modified

- `www/index.html` (modified) — `:root --chrome-invalid-strong: #e04040` + `#send-modal footer button[data-focused="true"]` CSS rule + bumped-specificity `[data-theme] #settings-slide #slide-auto-send-input[data-invalid="true"]` rule with `var(--chrome-invalid-strong)` border color
- `www/input/file-source.js` (modified) — `setAttribute('data-focused', 'true')` at `.focus()` call site (lines 521-528) + clear on modal close inside the existing `onClose` handler (lines 496-500)
- `www/tests/render/modal-default-focus.spec.js` (NEW) — 2 Playwright tests pinning the Gap 1 contracts (data-focused poll as load-bearing assertion + computed-color rgb(51,255,102) defense-in-depth + onClose clear)
- `www/tests/transport/slide-autosend-safety.spec.js` (appended) — 2 new tests at end of file (15 → 17 total) pinning the Gap 2 BLURRED-state contracts (rgb(224,64,64) on unsafe blurred + rgba(255,255,255,0.08) on safe blurred)

## Verification — computed-color / specificity arithmetic

**Computed-color RGB values verified by Playwright assertions (deterministic, no flake):**

- Modal default-focus button border: `rgb(51, 255, 102)` (= `#33ff66` = `var(--phosphor-fg)` = `var(--chrome-accent)` under default theme `data-theme="crt"`)
- Settings input invalid + blurred: `rgb(224, 64, 64)` (= `#e04040` = `var(--chrome-invalid-strong)`)
- Settings input safe + blurred: `rgba(255, 255, 255, 0.08)` (= `var(--chrome-border)`)

**Specificity arithmetic for Edit B:**

- New rule `[data-theme] #settings-slide #slide-auto-send-input[data-invalid="true"]` → (0, **2**, **2**, **0**)
- Base rule `#settings-slide #slide-auto-send-input` (line 217) → (0, 2, 0, 0) — **LOSES by 2 attributes**
- `:focus-visible` rule `#settings-slide #slide-auto-send-input:focus-visible` (line 227) → (0, 2, 1, 0) — **LOSES by 1 attribute**
- Wins on **specificity alone** — no source-order tiebreak required.

## Scope guardrails honoured

`git diff --stat` confirms ONLY four files touched across all 3 commits:

```
www/index.html                                    |  54 ++++++++++--
www/input/file-source.js                          |  15 +++-
www/tests/render/modal-default-focus.spec.js      | 100 ++++++++++++++++++++++
www/tests/transport/slide-autosend-safety.spec.js |  68 +++++++++++++++
```

Files NOT touched (verified):
- `www/state/prefs.js` — UNTOUCHED
- `www/transport/slide.js` — UNTOUCHED
- `www/main.js` — UNTOUCHED
- `www/renderer/slide-chip.js` — UNTOUCHED
- `www/input/selection.js` — UNTOUCHED
- `www/renderer/chrome.js` — UNTOUCHED
- `crates/**` / `Cargo.*` — UNTOUCHED (Phase 12 ZERO-Rust-changes invariant from CLAUDE.md preserved; cargo workspace 283/283 sanity-checked)

## Hex-literal grep audit

```
$ grep -n '#e04040' www/index.html
48:         Mirrors the literal #e04040 used in Phase 5 connect-button     # comment reference
52:      --chrome-invalid-strong: #e04040;                                  # ACTIVE — new :root declaration
411:    #connect-button[data-state="port-lost"]    { border-color: #e04040; }  # ACTIVE — Phase 5 (UNTOUCHED)
768:           var(--chrome-invalid-strong) (= #e04040). DELIBERATE EXCEPTION # comment reference
```

Two ACTIVE occurrences (the `:root` declaration + the pre-existing Phase 5 port-lost rule); two reference occurrences inside CSS comments documenting the value's history. No scattered hex.

## Decisions Made

- **Promote-not-sprinkle:** `#e04040` was already used as a literal hex in Phase 5; rather than scattering more literals or invent a new color, promoted to a named CSS variable `--chrome-invalid-strong` with an inline comment documenting the muted/destructive policy exception.
- **Specificity-bump-not-source-order:** Selected `(0,2,2,0)` for the invalid-state rule rather than `(0,2,1,0)`. The latter would tie the `:focus-visible` rule and rely on cascade source-order — a hidden contract that future file rearrangements could silently break. `(0,2,2,0)` wins regardless of order.
- **Load-bearing-attribute-poll:** Test A1's primary assertion is `data-focused === 'true'` (catches missing JS edit unambiguously); the computed-color check is defense-in-depth. Reason documented in spec comment block: under Playwright's synthetic file-input path, Chromium MAY still match `:focus-visible` and paint the same accent color even if the JS attribute write were absent.
- **BLURRED-state contract for autosend tests:** Both Gap 2 tests blur the input before reading `borderColor`. The `:focus-visible` rule (0,2,1,0) on a focused input would paint `var(--chrome-accent)` regardless of valid/invalid state, masking the contract. The blurred state matches the realistic UX moment (user types, tabs/clicks away, sees the cue).

## Deviations from Plan

None — plan executed exactly as written.

The plan's "Expected: 81 + 2 = 83 tests passing" prediction in the `<verification>` block was inaccurate because the verbatim spec text the plan dictates does NOT include `@fast` tags on the new modal-default-focus tests (and `npm run test:fast` filters by `@fast` grep). The new tests are in the full suite; the fast suite's 81 baseline is preserved. This is not a deviation — the plan's verbatim spec text is authoritative; the prediction was an aside in the verification block.

## Issues Encountered

- Pre-existing Playwright parallelism flakes observed during fast-suite runs: `tests/input/tx-debug-strip.spec.js` (1st run), `tests/input/tx-sink.spec.js` (2nd run), `tests/session/prefs.spec.js` (after Task 2). All passed cleanly when re-run in isolation at `--workers=1`. Documented in earlier deferred-items.md files as a known pre-existing condition unrelated to Plan 12-06 changes (CSS-only + JS-attribute-only edits cannot affect WASM boot timing).

## User Setup Required

None — no external service configuration required. Manual sanity check (NOT a verification gate) per plan Verification §6: re-run UAT Test 5 + Test 7 against the running app after a hard reload (Ctrl+Shift+R, per MEMORY.md `project_wasm_cache_workflow`).

## Next Phase Readiness

- Phase 12 verification gate (`/gsd-verify-phase 12`) ready to re-run; both UAT gaps closed at the contract level.
- v1.1 milestone closure unblocked once Phase 12 verifies and the user's manual UAT confirmation lands on Tests 5 + 7.
- Out-of-scope deferred items: any extension of the `[data-focused]` mitigation to internal Phase 9 modal logic that does NOT route through this `showConfirmModal` Promise body (currently the no-collision Cancel benefits incidentally via the shared `.focus()` call site — sufficient for v1.1).

## Self-Check: PASSED

- `www/tests/render/modal-default-focus.spec.js` — FOUND
- `www/tests/transport/slide-autosend-safety.spec.js` — FOUND (modified)
- `www/index.html` — FOUND (modified)
- `www/input/file-source.js` — FOUND (modified)
- Commit `2816432` — FOUND in git log
- Commit `2a06a30` — FOUND in git log
- Commit `e00dda5` — FOUND in git log

---
*Phase: 12-slide-ux-polish-docs-real-hardware-uat*
*Completed: 2026-05-09*
