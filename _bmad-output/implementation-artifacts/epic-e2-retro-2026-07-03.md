# Epic E2 Retrospective — Connection & Serial Configuration

**Date:** 2026-07-03 · **Facilitator:** Amelia (Dev) · **Format:** streamlined (no party-mode)
**Epic status:** 3/3 stories complete (e2-1, e2-2, e2-3) · **Next epic:** E3 · File, Settings & Transfer

---

## 1. Summary

E2 relocated all connection and serial-config controls out of the legacy `<details>` panes into
the menu bar + a modal, holding to the epic-wide premise: **pure relocation, no behavior change**.
The `serial.js` connection state machine was not touched — only its DOM projection moved.

| Story | Scope | Outcome | New tests |
|-------|-------|---------|-----------|
| E2.1 | Connect/Disconnect single-writer menu item | Done (projection injected out of `serial.js`; `menu-bar.js` sole writer) | 9 |
| E2.2 | Auto-connect toggle + Choose MicroBeast | Done (conditional row via true `[hidden]` absence) | 6 |
| E2.3 | Serial Configuration modal | Done (MOVE, not duplicate-mirror) | 15 |

Suite grew clean across the epic: 396 → 410 → 427 passing, 0 hard failures at close.

## 2. What went well

- **The injected-opt seam paid off three times.** "`menu-bar.js` is a DOM projector fed by injected
  opts; `serial.js` is reached only through opts" (AD-3), established in E2.1, was reused verbatim in
  E2.2 (`getAdapterCount`, `chooseMicroBeast`) and E2.3 (`openSerialConfig`). One architectural
  decision amortized across the whole epic.
- **E2.3 chose MOVE over duplicate-mirror** and explicitly cited E1 retro action #5 as the reason —
  the team is now *designing to avoid* dual-chrome debt, not just tracking it after the fact.
- **Tests caught a real code gap that the plan missed.** E2.2's "no new CSS needed" assumption was
  wrong: `#menu-bar .menu-item{display:flex}` outranks UA `[hidden]{display:none}`, so hidden rows
  still rendered. A failing test surfaced it before it shipped. Tests are earning their keep.
- **A reusable seam was built ahead of demand.** The generic `data-pref` checkable-persist path
  (E2.2) was deliberately shaped for E3's Settings checkables — prep done inside this epic.
- **Every E1 retro lesson was actually applied** (see §5). Continuity is working.

## 3. What was harder

- **The flake tax recurred in all three stories.** The known wasm-boot-starvation flake under high
  parallelism reappeared in E2.1, E2.2, and E2.3. The E1 fix (`chromium-transport` project +
  `retries:1`) *masks* it and it self-heals on retry, but each story still spent effort confirming
  "not a regression" and re-running in isolation. The mask holds; the root contention does not.
- **Relocation keeps forcing incumbent-spec edits.** Moving controls repeatedly broke specs that
  hardcoded old state or DOM locations (E2.2 checkable-glyph `'true'` default, disabled-row
  repointing; E2.3 config/errors repointing). No coverage was lost, but "update N stale specs" is a
  standing cost of the relocation strategy.
- **Two coexistence mirrors were added** (`#connect-button` in E2.1, `#auto-connect-checkbox` in
  E2.2), each with an E7-retirement marker. E2.3 avoided a third by moving instead of mirroring —
  but the dual-chrome debt still grew this epic.

## 4. Process observations (systemic, not blame)

- **Code-review findings aren't captured in the story files.** All three commits are titled
  "…+ code-review fixes", so reviews happened and fixes landed — but no story file has a
  review-findings section. The audit trail lives only in git. A retro/audit can't see *what* was
  found, only that *something* was.
- **Story-file status lags sprint-status.** The three story files still read `Status: review` in
  their front-matter while sprint-status marks them `done`. Minor, but it means neither source is
  authoritative on its own.

## 5. E1 retro follow-through

All five E1 action items were honored; the three closed post-retro stayed closed, and the two that
remain formally "open" were nonetheless *applied in practice*:

| E1 action | State | Evidence in E2 |
|-----------|-------|----------------|
| #1 Real flake fix (`chromium-transport`, `retries:1`) | **Done, held** | All 3 stories relied on it; zero per-story `--workers=1` re-diagnosis needed |
| #2 Ratify Font disabled off-CRT | Done | — |
| #3 `openModal` returnValue-reset policy in `modal.js` | **Done, consumed** | E2.3 references the documented policy by name for close/Reset semantics |
| #4 Codify menu-driven test idioms | **Open — but applied** | Every E2 story re-wrote a "codified idioms" section (`window.__menuBar.open`, `force:true` on `[hidden]`/`aria-disabled`, boot-race `waitForFunction`, `retainFocus`) |
| #5 Track `#top-bar`/`<details>` coexistence to E7 | **Open — but applied** | Every story left E7 retirement markers or avoided new dual-chrome |

**Insight:** #4 and #5 are "applied per-story but never promoted to a shared home." Each author
re-derives the same testing idioms by copy-pasting the previous story's section. That's the gap E2
action #1 (below) closes.

## 6. Next epic (E3) readiness

E3 reuses E2's exact pattern (`<details>` → menu + modal, `openModal` opener), so E2 left it
**well-provisioned** — critical prep is minimal:

- ✅ **`data-pref` checkable-persist seam** — directly reusable for E3.2 Local echo / Enter-key-sends.
- ✅ **`openModal` opener + dispatch-branch template** — the shape for E3.4's SLIDE transfer modal.
- ✅ **`focusableItems` `[hidden]` filter + `.menu-item[hidden]` CSS** — available for E3's
  conditional rows.
- ⚠️ **Vestigial `<details id="connection">`** still holds `#download-log-button`, which E3.1
  (Download Session Log) owns and will relocate/retire.

**No significant discovery.** Nothing in E2 invalidates E3's plan; the relocation approach E3
inherits is the one E2 just validated three times. **No epic update required.**

## 7. Action items

| # | Action | Owner | Type |
|---|--------|-------|------|
| 1 | Promote the per-story "codified menu-test idioms" prose into one shared location (TESTING doc or test helper) so E3 authors inherit it instead of re-deriving it. Closes carried-forward E1 #4. | Amelia | Process |
| 2 | Capture code-review outcomes in the story file (even one line: "N findings, fixed in <sha>") so reviews are visible to retro/audit, not only in git. | Amelia + reviewer | Process |
| 3 | Decide the flake endgame: either accept `retries:1` as the permanent mask (and stop re-diagnosing per story), or fix the root wasm-boot contention (boot barrier / quarantine the boot-race specs). Make the call once, in writing. | Amelia | Technical |
| 4 | Keep the E7 dual-chrome retirement checklist current as E3 adds surfaces, so nothing ships mid-migration. Continues E1 #5. | Amelia | Technical |
| 5 | Reconcile story-file `Status:` front-matter with sprint-status on completion (or drop one as authoritative). | Amelia | Process |

## 8. Readiness verdict

E2 is **complete and clear to proceed to E3.** No blockers, no significant discovery, debt is
tracked and bounded. The only open threads are process hygiene (§4, actions 2 & 5) and the standing
flake-mask decision (action 3) — none gate E3.
