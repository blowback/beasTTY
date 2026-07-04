# Epic E6 Retrospective — Help Menu

**Date:** 2026-07-04 · **Facilitator:** Amelia (Dev) · **Format:** focused / concise (no party-mode)
**Epic status:** 2/2 stories complete (e6-1, e6-2) · **Next epic:** E7 · Paste Toast (the last epic)

---

## 1. Summary

E6 shipped the two Help-menu reference modals — the 4th and 5th static-content `<dialog>`s on the shared
`openModal` seam first laid in E2.3. Both are non-destructive info modals (body copy + Close, AD-8 policy #4)
reached from a `data-action` Help row through the `menu-bar.js` action→opener table, opener injected via
`wireMenuBar` opts (AD-3 held — `menu-bar.js` imported no `modal.js`).

| Story | Scope | Outcome | New tests |
|-------|-------|---------|-----------|
| E6.1 | Help ▸ Keyboard Shortcuts… modal | Done — **0 findings on its own code** | +7 (`keyboard-shortcuts-modal.spec.js`) |
| E6.2 | Help ▸ About Beastty… modal (dynamic build SHA) | Done — **0 findings on its own code** | +9 (`about-modal.spec.js`) + registry spec |

**Zero new mechanic across both.** E6.1 was a pure clone of `#reserved-ctrl-modal` (E3.3). E6.2 added exactly
one wrinkle — the build SHA + `builtAt` are read from `window.__buildInfo` at open-time via `makeModalOpener`'s
`onOpen` third arg (the `openSlideConfig` precedent), single-sourced with `#status-build` so the two surfaces
can never drift. No `modal.js` change, no new pref/state, no build step, no new dependency in either story.

Suite green: **355 passed / 1 skipped / 0 failed** after E6.2 (E6.1 landed at 338/1/0). All flakes passed on
the accepted `retries:1` mask — no regressions.

## 2. What went well

- **The modal seam is now boringly repeatable — exactly the E0 payoff.** Five modals on identical rails; the
  `menu-bar.js` map comment literally named E6.2 as "one entry, not another copy-pasted branch," and that is
  precisely what it was. A new menu-reached info modal is now four mechanical edits (dialog markup +
  `data-action` row + one map entry + one injected opener) with a clone-able spec. This is the shared-primitive
  dividend compounding across the milestone.
- **The one genuinely-new bit (dynamic build fields) reused an existing seam instead of inventing one.** E6.2's
  `onOpen` build projection copied `openSlideConfig`'s use-time-sync shape rather than snapshotting at boot or
  re-importing `build-info.js` — so About reads the *same* `window.__buildInfo` the status bar reads. FR-25's
  "same SHA as the bar" is structurally guaranteed, not asserted-and-hoped.
- **E4.2's foresight paid off precisely as its retro predicted.** `window.__buildInfo` was deliberately kept
  alive and single-sourced in E4.2 *for exactly this modal*; E6.2 consumed it with zero plumbing rebuild. A
  cross-epic setup landed two epics later exactly as designed.
- **Both stories' own code was clean on review** (0 correctness findings each) — the clone discipline held.

## 3. The headline — trivial stories became the vehicle for whole-branch hardening

The two E6 stories were the *lightest* of the milestone (a clone and a clone-plus-one-field). Yet the
whole-branch code reviews they triggered surfaced and fixed **12 correctness/cleanup findings on adjacent
E3/E4/E6 surfaces** — none in the E6 modals themselves:

- **E6.1's review** fixed 4 (status-bar boot-cue lost on picker-cancel; `dispose()` leaking a click listener;
  Reset disarm-guard sitting after the `disabled` early-return; a hand-copied `setRowDisabled` triple).
- **E6.2's review** fixed 8 (monotonic recent-errors ring never cleared; send-file gate shipping enabled with
  no synchronous init; `chooseMicroBeast` floating promise; `zoom 0×` pre-paint clamp; dead `setConnectionInfo`
  deleted; `BUILD_UNKNOWN_SHA` single-sourced; shared `.conn-dot` class; **and the #7 shortcut registry**).

**The lesson that generalizes:** on a mature branch, reviewing the *whole working tree* on each story — even a
trivial one — is where accumulated adjacent debt actually gets swept. Two throwaway modal stories retired a
dozen latent defects because the review scope was the branch, not the diff. This is a keep-doing, and it makes
E7 (the last story) the final natural sweep before milestone close.

## 4. The shortcut-registry arc — a deferred observation closed one story later

E6.1's review raised, and **intentionally accepted**, that the shortcut combos were static HTML rather than
derived from the live chord handlers (a static help modal doesn't need runtime derivation; Q3 single-sourcing).
One story later, E6.2's review **built `input/shortcuts.js`** — now the single source for both the chord
predicates (`chrome.js` theme/zoom, `keyboard.js` copy/paste match via its predicates) *and* the modal display,
pinned by `shortcuts-registry.spec.js`. The Help modal can no longer misinform on a chord rebind.

This is the E5 process-debt inversion continuing: a design observation that would once have been carried
"deferred" across epics was instead closed structurally within the same epic — and closed as *code that
prevents drift* (a registry + a pinning spec), not a prose reminder. Same shape as E5's
`check-story-done-consistency.py` win: **write the invariant as code.**

## 5. What was harder / worth watching

- **The `--chrome-*`/single-source discipline is now load-bearing across five surfaces.** Five modals, three
  status-bar readers of the build stamp, two readers of `window.__buildInfo`. It has held, but the count of
  things that must-agree-or-the-user-sees-a-lie keeps rising. E6.2's review already had to single-source
  `BUILD_UNKNOWN_SHA` across three readers (#6) and the `.conn-dot` colour map (#7-sibling) because drift had
  *started*. Watch for the next duplicated constant before it becomes a fourth.
- **Content code-accuracy is a real hazard in a reference modal specifically.** E6.1 had to reconcile
  `EXPERIENCE.md`'s generic "copy/paste" against the real `Ctrl+Shift+C/V` handlers (bare Ctrl+C/V encode
  control codes to the remote — showing them would be actively wrong). A shortcuts modal that lies is worse
  than no modal. The registry (§4) now enforces this, but it's the reason the registry was worth building.
- **Whole-branch reviews are only as good as the record.** Both E6 stories carry detailed Code Review sections
  (findings + fix-sha + refuted-with-reason); `check-story-done-consistency.py` (E4 #2) is what keeps that
  honest. Standing dependency — do not let it rot.

## 6. E5 retro follow-through

| E5 action | State | Evidence in E6 |
|-----------|-------|----------------|
| #1 Ratify `retries:1` at the source (comment in `playwright.config.js`) | **Done** | `playwright.config.js:20-27` carries the policy comment + `retries: 1`; no per-story `--workers=1` re-diagnosis this epic. **Closing e5 #1.** |
| #2 Carry E7 dual-chrome close-out forward (debug-panel exception recorded) | **Applied — correctly still open for E7** | E6 added only new surfaces (no legacy pane to retire); E7 is where the formal sweep lands. |
| #3 E6 prep — confirm About build source + clean-modal aesthetic | **Done** | E6.2 read `window.__buildInfo` (single-sourced with `#status-build`), applied aligned-row aesthetic, verbatim privacy string, literal `TBD` source, Chromium note — all as specified. |
| #4 Watch the status-bar setter surface (standing) | **Done + fired** | E6 *did* touch `status-bar.js` — and the surface **shrank**: dead `setConnectionInfo` deleted (#5), zoom pre-paint clamped (#4), recent-errors ring fixed (#1). The "fed, never owned" contract held; no new setter added. |

**Insight:** the E5 → E6 arc confirms the E5 thesis held under a second test. The two *process/technical-hygiene*
actions that had a real close-out point (retries ratification, setter watch) both closed cleanly; the one carry
still open (E7 dual-chrome) is open only because its close-out genuinely lives in E7. No pattern of deferral.

## 7. Next epic (E7 · Paste Toast) readiness

**E7 depends on E0 only** — long done. E6 does not gate E7; nothing in E6 invalidates E7's plan.

E7 rehomes the paste-progress row (orphaned by `#top-bar` removal) plus the large-paste confirm as a transient
centered toast following the **`slide-chip.js`** precedent (FR-29). Two things make E7 special:

- ✅ **The toast precedent exists.** `slide-chip.js` is the transient-centered-chip pattern to clone — same
  posture as the modal seam was for E6. This should be another low-new-mechanic epic.
- ⚠️ **E7 is the convergence point for the dual-chrome retirement.** Every carried close-out — e1 #5 / e2 #4 /
  e3 #4 / e4 #4 / e5 #2 — lands here, because the `#top-bar` removal that orphaned the paste-progress row *is*
  the last act of the dual-chrome sweep. E7 is simultaneously the last feature epic **and** the formal
  retirement of the neutral-shell pin. Plan it as both: ship the toast **and** run the dual-chrome checklist to
  zero, confirming the debug panel is the one recorded pane that stays (E5 exception).

**No significant discovery. No epic update required.** E7's plan stands.

## 8. Action items

| # | Action | Owner | Type |
|---|--------|-------|------|
| 1 | **E7 = the dual-chrome formal sweep.** Plan E7 to close the retirement checklist to zero alongside the paste-toast feature: `#top-bar` removal is the sweep's last act, so verify no dual-chrome ships, retire the neutral-shell pin, and confirm the debug panel is the one recorded pane that stays. Closes the five-epic carry (e1 #5 / e2 #4 / e3 #4 / e4 #4 / e5 #2). | Amelia | Technical |
| 2 | **Run the whole-branch review on E7 as the milestone's final sweep.** E6 proved trivial stories retire adjacent debt when the review scope is the branch, not the diff (12 findings off two clone stories). E7 is the last story — treat its whole-branch review as the last natural pass over the entire `ui-rethink` tree before milestone close. | Amelia + reviewer | Process |
| 3 | **Guard the must-agree surface before it drifts.** Five modals + three build-stamp readers + the conn-dot/`BUILD_UNKNOWN_SHA` single-sources now hold cross-surface truth. Before E7 adds a toast that reads any shared state, confirm it consumes an existing single-source (don't add a sixth duplicated constant). Continues the setter watch (e4 #5) into its likely close. | Amelia | Technical |
| 4 | **Follow `slide-chip.js` for the toast, `input/shortcuts.js` for any derived content.** E7's toast should clone the transient-chip precedent (no new mechanic); if it surfaces any handler-derived text, derive it from a registry like E6.2's shortcuts registry rather than static strings. | Amelia | Technical |

## 9. Readiness verdict

E6 is **functionally complete and clear to proceed to E7** — 2/2 stories done, **0 code-review findings on
either modal's own code**, suite green at 355/1/0, single-source build discipline structurally guaranteed
(About == the bar), and AD-3/AD-8/AD-9/AD-12 held throughout. The epic's real value was leverage: two of the
lightest stories in the milestone became the vehicle that swept **12 adjacent E3/E4 defects** and produced the
`input/shortcuts.js` registry — the E5 "write the invariant as code" thesis holding under a second test. The
E5 follow-through is clean (retries ratified, setter surface shrank, About prep landed as specified). The only
open carry is the dual-chrome sweep, which correctly converges in E7 — the last epic — where it lands *with*
the paste toast. No significant discovery; no epic update required.
