# Epic E4 Retrospective — Bottom Status Bar

**Date:** 2026-07-03 · **Facilitator:** Amelia (Dev) · **Format:** streamlined (no party-mode)
**Epic status:** 3/3 stories complete (e4-1…e4-3) · **Next epic:** E5 · Debug Menu & In-Page Debug Panel

---

## 1. Summary

E4 is the **first non-relocation epic** — E0–E3 preserved a verbatim v1.1 incumbent; E4 built a new
surface (`www/renderer/status-bar.js`) fed by subscription + imperative push that "holds no independent
truth" (AD-6). Three connection projectors now coexist, each the single writer of its own DOM field.
The `serial.js` state machine was never touched — only its DOM projection was injected out (AD-15
precedent) and one additive getter/hook added in E4.3.

| Story | Scope | Outcome | New tests |
|-------|-------|---------|-----------|
| E4.1 | Connection & device/baud readout (`#status-bar` + `#port-status` relocation) | Done — new subscribing module, `#port-status` moved out of `<details id="connection">` | 8 |
| E4.2 | Build SHA + zoom readout (`.sb-right` group) | Done — `setBuild`/`setZoom` imperative-push writers; `#build-sha` debug-line relocated | 6 |
| E4.3 | Recent-errors affordance (`#status-errors` button) | Done — `setErrorCount` + click reuses E2.3 `openSerialConfig`; first interactive bar control (`retainFocus`) | 7 |

Suite grew clean: 473 → 485 → 498 passing, 0 hard failures at each close. Flake stayed masked by the
ratified `chromium-transport` + `retries:1` — no per-story re-diagnosis (E2 action #3 holding).

## 2. What went well

- **The build-new framing (E3 action #3) landed cleanly.** E4.1's "Context & framing (read first)"
  explicitly drops the relocation/verbatim anchor and writes acceptance against the spec (FR-26 / AD-6),
  not an incumbent. The preservation premise ended exactly where E3's retro said it would, with no
  confusion in the stories that followed.
- **The projector discipline transferred to a new direction without strain.** The same subscribe +
  frozen-label-map → `data-*`/`textContent` pattern that `menu-bar.js` uses for `#menu-conn-dot` was
  mirrored for `#status-conn-dot` — three connection projectors reading one truth, each the single
  writer of its field. `STATUS_TEXT` reuses `menu-bar.js`'s exact non-connected strings (by value, no
  cross-import) so the two surfaces can never disagree — AD-6's whole purpose, proven by test.
- **AD-6's two feed modes both got exercised.** Subscription for the observer source (`serial.onStateChange`)
  and imperative push for the observer-less ones (build stamp, zoom, error count via `setBuild`/`setZoom`/
  `setErrorCount`). E4.2 in particular routed *both* zoom paths — View menu and Ctrl+{=,-,0} — through the
  one `pushZoom` sink, so the readout is live from a single writer.
- **Cross-epic setup paid forward.** E4.2 relocating `#build-sha` out of the debug pane means E5.1's AC
  "Build info does **not** live here" is *already satisfied* before E5 starts. E4.3's affordance reused
  E2.3's `openSerialConfig` opener verbatim — no new modal wiring, injected via opts (AD-3 held: the module
  imports only `prefs.js`).
- **`window.__buildInfo` kept alive for the right reason.** E4.2 relocated the debug-pane build line but
  deliberately retained `window.__buildInfo`, single-sourced with `#status-build`, so Help ▸ About (E6.2)
  and the console can't drift from the bar. Foresight, not accretion.

## 3. What was harder

- **The status bar accretes an imperative-push API per story.** `setConnectionInfo` (E4.1) → `setBuild`/
  `setZoom` (E4.2) → `setErrorCount` (E4.3). Each is well-tested and AD-6-shaped, but the module's surface
  is growing one writer at a time and `__getStateForTests`/`__resetForTests` are extended each story. Not a
  problem yet — worth watching that the "fed, never owned" contract doesn't quietly become a grab-bag of
  setters.
- **First interactive control on the bar pulled in focus-retention (E4.3).** The `#status-errors` button is
  the bar's first focusable control, so NFR-1/`retainFocus` (dormant through E4.1/E4.2) activated — plus the
  drop-before-resubscribe re-wire discipline had to extend to the click opener so an idempotent re-wire never
  stacks duplicate openers. Correctly handled, but it's the point where the "read-only projector" became an
  "interactive projector."
- **Geometry has a known soft edge.** E4.1's own debug log records that `#status-bar` overlays the terminal
  when the 80×24 canvas is taller than the viewport (short-window scroll case); the terminal is never
  reflowed, but the bar can occlude it on a short window. Documented, not fixed — fine for now, but it's an
  untracked visual caveat.

## 4. Process observations (systemic, not blame)

- **Code review WAS run on all three stories — but the story-file Code Review section was never written
  back.** (Corrected after the draft: the reviews happened; E4.3's fixes are folded into commit `8d2795e`,
  which touched `menu-bar.js` + `serial.js` beyond base scope — review-driven edits.) The real defect is a
  **recording gap, not a quality gap**: all three story files still carry the dev-story workflow's template
  stub ("Not yet run — … To be filled with: N findings, fixed in `<sha>`"), because "mark the story done"
  flips status in sprint-status + front-matter but has no step that fills the review section. So the section
  survives as a placeholder, and any retro/audit that reads the story file mis-concludes "review skipped."
  **This is the same ghost as E2 action #2 and E3 action #2** — it keeps regenerating not because review is
  skipped but because the *record-it-on-done* step was never wired in. The fix is to make "record the review
  outcome" part of what "mark done" means (now captured in the `mark-story-done-all-places` convention).
- **Story-file status agrees with sprint-status (E2 action #5 still holding).** All three E4 front-matters
  read `done`; sprint-status agrees. The one stale field is the Code Review section — the recording gap
  above, not a status-reconciliation regression.

## 5. E3 retro follow-through

| E3 action | State | Evidence in E4 |
|-----------|-------|----------------|
| #1 Resolve the codified-idioms carry (extract to a shared `TESTING.md`/helper, or formally close) | **Still open — now 4 epics** | E4.1 Dev Notes *again* embeds the "codified menu-driven test idioms" block, tagged "still per-story, see retro action #1." Neither extracted nor formally killed. The exact fourth-time-is-worst outcome E3 warned against. |
| #2 Run + record code review for shipped stories; make "review section filled" a done-gate | **Run, not recorded** | Reviews *were* run on all three (E4.3 fixes folded into `8d2795e`). But the story-file Code Review sections still read "Not yet run" — the "record it" half never fired because "mark done" doesn't touch that section. The action mis-frames it as a review-execution gap; it's a recording gap. |
| #3 Frame E4 planning as build-new, not relocate | **Done** | E4.1's "Context & framing" drops the incumbent anchor; acceptance is spec-based (FR-26/AD-6). Carried through E4.2/E4.3. |
| #4 Carry the E7 dual-chrome close-out forward | **Applied — debt shrank again** | E4.1 left `<details id="connection">` holding only `#download-log-button`; `#port-status` moved to the permanent `#status-bar`. E4.2 removed the legacy `#build-sha` debug line. E7 checklist kept current. |

**Insight:** two of four E3 actions are process-hygiene carries that keep slipping (#1 four epics, #2 now
regressed), while the two *technical* framing actions (#3, #4) landed cleanly and on the first pass. The
pattern is consistent across four retros: **technical guidance gets applied, process guidance gets deferred.**
Writing the gate into the story text was not enough to make it fire — so the fix has to be structural, not
another restatement.

## 6. Next epic (E5) readiness

**E5 depends on E1 only** (long done) — not on E4, so E4's completion doesn't gate it. One framing shift to
flag, and it is the *inverse* of E4's:

- ⚠️ **E5 is the one surface that stays in-page — the exception to the relocation sweep.** E0–E3 removed
  legacy `<details>` panes; E4 built new chrome. E5 does *neither wholesale*: the debug panel's widgets
  (`#input`, Feed / 64 KB Stress / Paste buttons, TX-strip `<pre>`, Reset TX) are **relocated but kept**,
  gated behind a Debug ▸ Show Debug Panel toggle (checkable, default OFF). It must stay functional after the
  move — so E5 is a "relocate-and-keep," a third mode distinct from E0–E3's "relocate-and-delete" and E4's
  "build-new." Plan acceptance against *still-works-after-move*, and note this is the one pane that survives
  the E7 dual-chrome sweep.
- ✅ **E4.2 already did E5's prerequisite.** `#build-sha` is out of the debug pane, so E5.1's "Build info
  does **not** live here" is satisfied before E5 begins.
- ✅ **The menu-test idioms apply directly.** Debug is a menu (checkable item, `window.__menuBar.open`) —
  same mechanics as View/Settings. Which is exactly why E3 action #1 matters again: E5.1 will re-derive the
  idioms block a fifth time unless it's extracted first.

**No significant discovery.** Nothing in E4 invalidates E5's plan. **No epic update required.**

## 7. Action items

| # | Action | Owner | Type |
|---|--------|-------|------|
| 1 | **Backfill the three E4 Code Review sections with the reviews that already ran** (findings count + severity + fix sha, or "0 findings" — E4.3's fixes are in `8d2795e`). The reviews happened; only the record is missing. Owner has the outcomes. | Ant + Amelia | Process |
| 2 | **Fold "record the review outcome" into the "mark story done" step so it can't recur.** The gap is that "mark done" updates status but never fills the Code Review section, leaving the workflow's template stub in place. Make filling that section (from the review that was run) part of marking done — captured now in the `mark-story-done-all-places` convention; consider a mechanical check that a story can't read `done` while its Code Review section still reads "Not yet run"/"Pending". Closes the E2 #2 / E3 #2 ghost at its actual root. | Amelia | Process |
| 3 | **Kill or extract the codified-idioms carry — this is the last call (5 epics).** Before E5.1's tests re-derive the block a fifth time, spend the 20 minutes to extract it into a shared `TESTING.md`/test helper, OR formally close the action as intentionally per-story and stop listing it. Carrying it again is not an option. Closes E1 #4 / E2 #1 / E3 #1. | Amelia | Process |
| 4 | **Carry the E7 dual-chrome close-out forward — with the E5 exception noted.** After E4, `<details id="connection">` holds only `#download-log-button` and the debug pane is next. Keep the retirement checklist current through E5/E6, but record that the **debug panel is the one pane that does not retire** — it relocates behind the Debug menu and stays. Continues E1 #5 / E2 #4 / E3 #4. | Amelia | Technical |
| 5 | **Watch the status-bar setter surface.** The imperative-push API grew a writer per E4 story (`setConnectionInfo`/`setBuild`/`setZoom`/`setErrorCount`). Before adding more, confirm the "fed, never owned" contract still holds and the module isn't becoming a setter grab-bag. | Amelia | Technical |

## 8. Readiness verdict

E4 is **functionally complete and clear to proceed to E5** — 498 passing / 0 hard failures, scope held on
every story, `serial.js` state machine untouched, dual-chrome debt shrank again, **and code review was run on
all three stories.** The only caveat is documentation, not quality: the reviews weren't written back into the
story-file Code Review sections (§4 / action 1) because "mark done" has no step that fills them. That doesn't
gate E5's *start* (E5 depends on E1, not E4) — backfill the three sections and wire the record-on-done step
(action 2) so it stops recurring. No significant discovery; no epic update required. The one thing to
internalise for E5: it is **relocate-and-keep**, the third and final relocation mode, and the one pane that
survives E7.
