# Retrospective — Epic E0: Shared UI Primitives

- **Date:** 2026-07-01
- **Project:** beastty (Chrome Redesign)
- **Facilitator:** Amelia (Developer)
- **Participants:** Amelia (Developer), Winston (Architect), Sally (UX Designer), John (PM), Ant (Project Lead)
- **Retrospective type:** First retrospective of the project — no prior retro to follow up on.

## Epic Summary

Epic E0 is an **enabler epic** (deliberate risk boundary): ship the two UI primitives every
later epic (E1–E7) imports, and prove each against one existing caller before dependents build
on them. No new user-facing surface — the payoff is structural.

| Metric | Value |
| --- | --- |
| Stories completed | 2 / 2 (100%) |
| New modules | `renderer/focus.js`, `renderer/modal.js` (both zero-import leaf helpers) |
| New specs | `tests/input/focus-helper.spec.js`, `tests/render/modal.spec.js` |
| Hard blockers | 0 |
| Production incidents | 0 |
| Behavior changes (user-visible) | 0 — pure relocation premise held |
| Regression oracles edited | 0 (all stayed green unchanged) |

**Stories:**
- **E0.1** — Focus-retention helper `retainFocus(el, restoreTarget?)` (covers NFR-1, AD-10).
- **E0.2** — Modal helper `openModal(dialogEl, {initialFocus, restoreTo}) → Promise` + send-modal
  refactor (covers AD-8, FR-16, UX-DR13).

**Business outcome:** E0's entire reason to exist — ship the two primitives, prove each against a
live caller, establish the NFR-1 focus-retention floor — was fully achieved.

## What Went Well

- **The architecture spine held.** AD-8 (`openModal`) and AD-10 (`retainFocus`) are load-bearing;
  every future modal (E2/E3/E6) inherits `openModal`'s contract. The `restoreTo`-accepts-a-callback
  decision made the send-modal's conditional focus-restore expressible without per-caller reinvention.
- **NFR-1 ("Sacred") preserved.** The `data-focused`-before-`.focus()` ordering survived the refactor;
  the `<select>` branch was hardened to fail loud rather than silently strand focus.
- **Test-first discipline paid off.** The named oracles (`modal-default-focus.spec.js`,
  `focus-retention.spec.js`) were the correctness contract and stayed byte-green with zero edits.
- **Real story-to-story continuity.** E0.1 discovered the `window.__*` test boot-race; E0.2 applied the
  `waitForFunction` guard from the start instead of re-learning it.
- **Code review found real latent bugs** (E0.1 hardening): silent focus-drop when `restoreTarget` is
  omitted (now throws `TypeError`) and duplicate-listener stacking (now guarded by a `WeakSet`).

## Challenges / Growth Areas

- **Recurring pre-existing test flake.** Parallel-load / wasm-boot starvation makes the full chromium
  suite flaky (`slide-post-fin-forward.spec.js:47` fails identically on a clean baseline; the failing
  set varies run-to-run). Both stories spent debug effort proving failures were change-independent —
  a real, recurring cognitive tax on regression judgment.
- **Scope-boundary deviation (E0.1 Task 3).** Task 3 was scoped to refactor one proof site
  (`themeButton`). A code-review "incomplete refactor" finding prompted migrating all 7 remaining
  `chrome.js` focus sites — approved by Ant, good outcome (zero inline focus sites left in `chrome.js`),
  but it front-ran part of E1.3's work. A scope-boundary pattern worth watching.

## Key Insights

1. For enabler epics, "no visible outcome" is the intended result, not a shortfall — product feedback
   belongs at the first user-visible surface (E1's menu bar).
2. The pre-existing flake will tax every future epic's regression judgment unless standardized or fixed.
3. `openModal`'s deferred `returnValue`-reset is a deliberate, documented latent edge that future
   modals must consciously decide on.

## Action Items

| # | Category | Action | Owner | When | Done when |
| --- | --- | --- | --- | --- | --- |
| 1 | Process | Establish a flaky-test protocol: serialize/quarantine the offending transport specs, OR codify "judge regressions by named oracles in isolation (`--workers=1`)" as a standing convention. | Amelia (Dev) | Before/during E1 | Flake stops requiring per-story re-diagnosis. |
| 2 | Technical | Decide `openModal`'s `returnValue`-reset policy for future (new) modals; document in `modal.js`. | Winston + Amelia | At E2.3 (first new modal) | Policy decided and documented. |
| 3 | Documentation | Note in E1.3's plan that `chrome.js` already has zero inline focus sites (migrated in E0.1) so the work isn't re-planned. | Amelia | At E1 plan time | E1.3 plan reflects it. |

## Epic E1 Preparation

- **No blockers.** E0 delivered exactly what E1 imports (`retainFocus`, `openModal`), both proven
  against live callers.
- Inline focus sites remain in `scroll-state.js`, `slide-chip.js`, `serial.js`, `session-log.js`,
  `file-source.js`, `main.js` — these migrate with their **owning** modules in E2–E7, not E1. Only
  `chrome.js` was migrated early (E0.1).
- **No significant discoveries** requiring an E1 re-plan. E1's plan is sound as written.

## Readiness Assessment

| Dimension | Status |
| --- | --- |
| Stories complete | ✅ 2/2 done |
| Regression oracles | ✅ All green, zero edits |
| Deployment/stakeholder gates | N/A — internal primitives epic, no user-visible surface |
| Carry-forward | ⚠️ Pre-existing test flake (action item #1) — not caused by E0 |

**Verdict:** E0 is complete and E1 is clear to proceed once action items #1 and #3 are actioned at
E1 plan time.

## Notes on Facilitation

Ant declined to offer product feedback, correctly observing that E0 has "no visible outcomes so far."
This is expected for an enabler epic; the retrospective focused on the builder-facing carry-forwards
(test flake, scope boundary, deferred `returnValue` reset) rather than manufacturing a product discussion.
