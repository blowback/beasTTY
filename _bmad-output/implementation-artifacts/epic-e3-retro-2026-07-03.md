# Epic E3 Retrospective — File, Settings & Transfer Configuration

**Date:** 2026-07-03 · **Facilitator:** Amelia (Dev) · **Format:** streamlined (no party-mode)
**Epic status:** 4/4 stories complete (e3-1…e3-4) · **Next epic:** E4 · Bottom Status Bar

---

## 1. Summary

E3 relocated the last of the legacy `<details>` panes — File actions, Settings toggles, and the
SLIDE transfer config — into the menu bar + modals, holding the epic-wide premise: **pure relocation,
no behavior change**. No state machine was touched (`session-log.js`, `keyboard.js`, `slide.js`,
`slide-chip.js`, `slide-recv.js` all read-only except one additive hook). By close, the SLIDE
sub-pane was fully removed and `<details id="settings">` is a thin vestige awaiting E7.

| Story | Scope | Outcome | New tests |
|-------|-------|---------|-----------|
| E3.1 | File ▸ Send File + Download Session Log | Done (injected-opt relocation; one new `onStateChange` hook — the sole genuinely-new code) | 6 |
| E3.2 | Settings ▸ Local echo + Enter-key-sends | Done (reused E2.2 `data-pref` seam; 4th radio submenu) | 6 |
| E3.3 | Settings ▸ Reset All Prefs + Reserved-Ctrl | Done (inline 2-click confirm = a 3rd menu-item behavior; `openModal` info dialog) | 16 |
| E3.4 | SLIDE File Transfer modal | Done (MOVE same-id controls; clean aligned-row modal from the start) | 15 |

Suite grew clean across the epic: 429 → 267/171 → 289 → 476 passing, 0 hard failures at close.

## 2. What went well

- **The injected-opt seam held for a third epic.** "`menu-bar.js` is a DOM projector fed by injected
  opts; the state module is reached only through opts" (AD-3) carried every E3 story: `sendFile` +
  `onStateChange` (E3.1), `setLocalEcho`/`setCrlfMode` (E3.2), `resetPrefs` + `openReservedCtrl`
  (E3.3), `openSlideConfig` (E3.4). One decision, now amortized across E1+E2+E3.
- **Reuse-before-reinvent was real, not aspirational.** E3.2 rode the E2.2 `data-pref` checkable seam
  and the E1.5 "fill a bare radio-parent" template with *zero* new mechanic. E3.4 reused the E3.3
  `.chrome-modal` chrome and the E2.3 MOVE-opener pattern. The prep built in earlier epics was
  consumed exactly as intended.
- **The persist ≠ apply trap was caught in planning, not production.** E3.2 correctly identified that
  `savePrefs` doesn't fan out (AD-4), so a menu toggle that only persisted would flip the glyph but
  leave live `keyboard.js` state stale until reload. The story called it "the one correctness trap"
  and the new spec proved live apply (grid echo + TX-byte oracle). A silent bug designed out up front.
- **Code review found a genuine invariant hole (E3.3).** A re-wire-while-armed on the reset 2-click
  confirm could commit `resetPrefs()` on a single click and leak a timer onto a torn-down row. Not
  reachable in the shipping single-wire config, but a real hole — fixed by disarming in
  `wireMenuBar` re-init / `dispose()` / `__resetForTests()`. Review earned its keep.
- **Standing conventions were honored without prompting.** E3.4 built the SLIDE modal clean
  (aligned `.field` rows + upward ⓘ tooltips) *from the start* per the clean-modal memory, rather
  than transplanting the verbose pane and polishing later — and hoisted the shared `.field*` CSS to
  `.chrome-modal` (single-source) as it went.

## 3. What was harder

- **The flake tax recurred — but the mask is now accepted, not re-litigated.** The wasm-boot-under-
  parallelism flake reappeared (E3.1: 8 flakes self-healed; E3.4: 2). The difference from E1/E2: every
  E3 story treats `chromium-transport` + `retries:1` as **"the ratified mask"** and explicitly
  refuses per-story `--workers=1`. The E2 "decide once in writing" call (action #3) effectively took —
  the root contention persists but the re-diagnosis cost is gone.
- **Relocation kept forcing incumbent-spec edits.** E3.3 broke an E1.1 assertion (`[data-variant=
  "action"]` became ambiguous once Reset turned into a stay-open 2-click and a second action row
  appeared); repointed, no coverage lost. Same standing cost flagged in E2 — moving controls
  repeatedly invalidates specs that hardcoded old DOM/state.
- **A third menu-item behavior was introduced (E3.3).** Alongside "action closes" and "checkable/radio
  keeps open," the Reset row is now "stay open on arm, close on commit," with disarm wired into three
  distinct hide paths (`closeMenu` / `openMenuNamed` / `toggleMenu` — the last discovered during dev,
  not in the plan). Correct, well-tested, but the menu-item dispatch is accreting special cases.

## 4. Process observations (systemic, not blame)

- **Code-review recording is now half-adopted — inconsistently.** E2 action #2 asked for a review
  line in each story file. E3.2 and E3.3 have real Code Review sections (0 bugs / 5 cleanup;
  4 findings all fixed). **But E3.1 and E3.4 still read "Pending — run code-review"** while marked
  `done`. So two stories shipped without a recorded (or possibly run) review. The habit is forming
  but not enforced.
- **Story-file status now agrees with sprint-status.** E2 action #5's gap is closed: all four E3
  front-matters read `Status: done` and sprint-status agrees. (Minor residue: some Change Log lines
  still narrate "→ review".) The reconciliation lesson took.

## 5. E2 retro follow-through

| E2 action | State | Evidence in E3 |
|-----------|-------|----------------|
| #1 Promote codified test idioms to one shared home | **Open — still applied per-story** | All four E3 stories *again* re-embedded a "codified idioms" section. Now carried **three epics** (E1 #4 → E2 #1 → still open). |
| #2 Capture code-review outcomes in the story file | **Partially done** | E3.2 + E3.3 recorded; **E3.1 + E3.4 left "Pending"** while done. Half-adopted. |
| #3 Decide the flake endgame in writing | **Effectively done** | Every E3 story names `retries:1` "the ratified mask" and refuses per-story `--workers=1`. Re-diagnosis cost eliminated. |
| #4 Keep the E7 dual-chrome checklist current | **Applied — and reduced debt** | E3.1–E3.3 left E7 markers; **E3.4 removed `<details id="settings-slide">` outright**. Net dual-chrome debt shrank this epic. |
| #5 Reconcile story-file status with sprint-status | **Done** | All four E3 front-matters read `done`, matching sprint-status. |

**Insight:** action #1 is the one that will not die by being "applied in practice." Three epics of
authors have now hand-copied the same ~10-line idioms block instead of importing it. It is either
worth 20 minutes to extract once (a `TESTING.md` or a test helper) before E4, or it should be
formally killed — carrying it a fourth time is the worst option.

## 6. Next epic (E4) readiness

**E4 depends on E1 + E2, not E3** — so E3's completion doesn't gate it, and both dependencies are
long done. But E4 is a **different kind of epic**, and that is the one thing to flag:

- ⚠️ **E4 is the first non-relocation epic.** E0–E3 were all "pure relocation, byte-identical to
  legacy, preserve verbatim copy." E4 (connection/device/baud readout, build SHA, zoom, recent-errors
  affordance) **builds new surfaces fed by subscription + imperative push**. The anchor that made
  every prior story's acceptance criteria falsifiable — "does it match v1.1 exactly?" — no longer
  applies. E4 acceptance criteria have to define *correct* from the spec, not from an incumbent.
- ✅ **The push/projector patterns E4 needs already exist.** E2's connection projection (injected out
  of `serial.js`) and E1's zoom push are the exact feeds E4's status bar consumes; the status bar
  "holds no independent truth" (per the epic) — same projector discipline, new direction.
- ✅ **`.chrome-modal` / `.field` system and the recent-errors → Serial Config modal opener** are in
  place from E2.3/E3.

**No significant discovery.** Nothing in E3 invalidates E4's plan. **No epic update required** — but
E4 planning should consciously drop the "relocation / verbatim" framing that E0–E3 leaned on.

## 7. Action items

| # | Action | Owner | Type |
|---|--------|-------|------|
| 1 | **Resolve the codified-idioms carry once and for all** (now 3 epics old): either extract the menu-test idioms block into a shared `TESTING.md` or test helper before E4, or formally close the action as "intentionally per-story." Stop carrying it unresolved. | Amelia | Process |
| 2 | **Run + record code review for E3.1 and E3.4** (both shipped `done` with a "Pending" review section), and make "review section filled" a done-gate so it can't recur. Closes the half-adopted E2 #2. | Amelia + reviewer | Process |
| 3 | **Frame E4 planning as build-new, not relocate:** write acceptance criteria against the spec (subscription + imperative push, "holds no independent truth"), not against a v1.1 incumbent — the preservation premise that anchored E0–E3 ends here. | Amelia | Technical |
| 4 | **Carry the E7 dual-chrome close-out forward:** after E3.4, `<details id="settings-slide">` is gone and `<details id="settings">` is a local-echo/crlf-only vestige; keep the retirement checklist current through E4/E5/E6 so E7 is a clean sweep. Continues E1 #5 / E2 #4. | Amelia | Technical |

## 8. Readiness verdict

E3 is **complete and clear to proceed to E4.** No blockers, no significant discovery; dual-chrome
debt actually *shrank* (SLIDE pane retired). Two open threads are process hygiene (§4 / actions 1 & 2)
and one is a framing shift for E4 planning (action 3) — none gate E4.
