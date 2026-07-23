# Epic E7 Retrospective — Paste Toast (+ milestone close)

**Date:** 2026-07-04 · **Facilitator:** Amelia (Dev) · **Format:** streamlined / no party-mode
**Epic status:** 1/1 story complete (e7-1) · **Next epic:** none — E7 is the last epic of milestone `ui-rethink`

---

## 1. Summary

E7 was one story doing two coupled jobs by explicit design (e6 retro #1): ship the **paste toast**, and
run the **dual-chrome formal sweep** as the milestone's closing act. The two are inseparable because
`#top-bar` removal — the sweep's last act — is exactly what orphans the paste-progress row the toast rehomes.

| Story | Scope | Outcome | Tests |
|-------|-------|---------|-------|
| E7.1 | Centered paste toast (progress + ≥4096 B confirm) **+** dual-chrome sweep **+** whole-branch review | Done — **3 findings, all fixed in `cbfcd35`** | +`paste-toast.spec.js`; ~20 specs migrated off removed ids |

**Zero new mechanic on the feature side.** `renderer/paste-toast.js` clones the `slide-chip.js` transient-chip
seam (module `lifecycle` state machine + `wirePasteToast(opts)` + `[hidden]` render + `window.__pasteToast`
hooks), event-driven off `paste-pump.onProgress` (no 250 ms tick — progress is discrete `'chunk'` events).
`clipboard.js` stayed DOM-agnostic via an injected `confirmLargePaste(...) → Promise<boolean>`; the `4096`
literal was hoisted to `LARGE_PASTE_THRESHOLD` (single-source per e6 #3). No new dependency, no build step.

**The sweep landed the whole retirement checklist to zero:** `#top-bar` + `<details id="connection">` +
`<details id="settings">` and every mirror-tied element/CSS/JS wiring deleted; the `[data-theme="crt"]`
chrome-var override + both neutral-shell pins removed (base `--chrome-*` tokens are now the sole source —
AD-9); `<details id="debug">` kept as the one recorded exception (AD-11). Suite green: **chromium 360/0,
chromium-transport 166/0** on the ratified `retries:1` mask.

## 2. What went well

- **The load-bearing "coexistence mirror" insight made a wide deletion sweep safe.** Every legacy surface was
  built with the menu/modal authoritative and the projector null-guarded to fail-open on absence. So most of
  ~16 removal sites across 6 files was "delete the DOM node + its dead mirror line" — the guards already handled
  absence. The correctness core narrowed to the handful of *unguarded* JS wirings (paste-cancel listener,
  `#local-echo`/`#crlf-*` refs) that would null-throw at boot; those were deleted, not orphaned. This is the
  additive-first discipline (E1.1 shipped 231 insertions / 0 deletions precisely to defer this) paying off at
  the exact point it was designed to.
- **Delete-order discipline held: rehome → top-bar → panes → pins, suite between groups.** No paste path was
  ever pointed at a removed element mid-implementation; a missed unguarded ref would have surfaced at the next
  group's suite run, not at the end.
- **The whole-branch review earned its keep as the final sweep (e6 #2).** Three parallel passes over the entire
  `ui-rethink` tree: Pass 1 (boot null-ref / removed-element hazards — AC-2's core) traced every live
  `getElementById`/`querySelector` against the current DOM and came back CLEAN, empirically corroborated by all
  526 specs booting green. Pass 3 (sweep completeness) was CLEAN — no live selector matches a deleted node.
- **Suite migration preserved coverage, didn't silently drop it.** ~20 specs moved off removed ids to their
  menu/modal/toast equivalents, with intentional drops noted inline where a surface was genuinely retired.
- **The CRT visual baseline was regenerated for a *legitimate* reflow** (771→770 px wrapper height from removing
  `#top-bar`), not rubber-stamped — the 1px delta was understood before the snapshot was accepted.

## 3. The headline — the one real bug was a design regression from the consolidation itself

The paste toast's own review (Pass 2) found the only substantive defect of the epic, and it was *born* of E7's
own design choice — folding progress **and** confirm into a single shared toast element:

- **[MEDIUM] Overlapping paste clobbered an open confirm and leaked its Promise.** A still-pumping small paste's
  `'chunk'`/`'complete'` events overwrote an open large-paste confirm; on auto-hide, `confirmLargePaste`'s
  Promise was left unresolved — silently dropping the ≥4096 B paste. **Fixed:** `handleProgress` returns early
  while `lifecycle === 'confirm'` (the pump keeps running underneath; the next event re-renders once the user
  resolves). Regression test added.
- **[LOW-MEDIUM] A second overlapping `confirmLargePaste` abandoned the first Promise.** **Fixed:**
  `settlePendingConfirm(ok)` resolves any pending confirm exactly once, so no awaiting caller hangs.

**The lesson that generalizes:** when you consolidate two independent UI flows onto one shared element to avoid
a second mechanic, the new failure mode is *interleaving* — the two flows racing for the one element. The clone
was correct; the sharing needed an explicit "confirm is modal-over-progress" rule, which is what the fix
encodes. Worth remembering the next time a "reuse one element" simplification tempts.

A second, quieter win in the same pass: `#paste-toast` shipped as a `<div role="status">`, not a `<button>` —
the persistent `[Paste]`/`[Cancel]` children would have made a `<button>` an invalid nested-button, and an
earlier innerHTML-per-tick approach detached the button mid-click. Both caught and corrected during dev, not
review.

## 4. What was harder / worth watching (carried into the milestone, not the next epic)

- **Comment rot is the residue of a big sweep.** Pass 3 found **9 stale present-tense comments** (in `main.js`,
  `confirm-toggle.js`, `prefs.js`, `serial.js`, `menu-bar.js`) still describing removed legacy surfaces as live.
  All rewritten to historical framing. The *code* was clean; the *narration* lagged the deletion. On any future
  wide removal, grep the prose for the retired names as a distinct step — the compiler won't flag a lying comment.
- **The must-agree surface peaked here and is now frozen by milestone close.** Five modals, three build-stamp
  readers, the `.conn-dot`/`BUILD_UNKNOWN_SHA`/`LARGE_PASTE_THRESHOLD` single-sources. The toast correctly
  consumed existing single-sources (paste-pump for progress, hoisted threshold) rather than adding a sixth
  duplicated constant (e6 #3 satisfied). Nothing to watch *forward* — the milestone is done — but the next
  milestone inherits a codebase where cross-surface truth is real and must stay single-sourced.

## 5. E6 retro follow-through — all four closed

| E6 action | State | Evidence in E7 |
|-----------|-------|----------------|
| #1 E7 = the dual-chrome formal sweep (checklist to zero, debug panel stays) | **Done** | `cbfcd35`: `#top-bar` + both `<details>` vestiges + neutral-shell pins + `[data-theme="crt"]` chrome override all gone; `<details id="debug">` kept. Closes the five-epic carry (e1#5/e2#4/e3#4/e4#4/e5#2). |
| #2 Whole-branch review as the milestone's final sweep | **Done** | Three-pass high-effort review over the whole `ui-rethink` tree; 3 findings fixed in `cbfcd35`, recorded in the story's Code Review section (the `check-story-done-consistency.py` done-gate holds). |
| #3 Guard the must-agree surface before it drifts | **Done** | Toast consumed `paste-pump.onProgress` + the hoisted `LARGE_PASTE_THRESHOLD`; no sixth duplicated constant added. |
| #4 Follow `slide-chip.js` for the toast, registry for derived content | **Done** | `paste-toast.js` is a straight slide-chip clone; the toast's only derived text (byte count + baud) comes from the pump/clipboard, so no static-string registry was needed. |

**Plus one standing item closes here.** The e4 #5 **status-bar setter watch** ("fed, never owned"; carried
E4→E5→E6) reaches milestone end intact: E7 touched `status-bar.js` only to prune a stale "until E7" comment —
the setters remain `setBuild`/`setZoom`/`setErrorCount`, no new writer added. The contract held for the full
milestone. **Closing e4 #5.**

## 6. Milestone close — `ui-rethink` is complete

E7 is the last epic; there is no E8. The milestone shipped the full chrome rethink: menu-bar backbone (E1),
connection/serial config (E2), file/settings/transfer (E3), bottom status bar (E4), debug menu + panel (E5),
help menu (E6), and the paste toast (E7) — with the dual-chrome coexistence period retired to zero in this
final story.

**The milestone's through-line, in one sentence:** *write the invariant as code, not as a carried reminder.*
The E5 `check-story-done-consistency.py` done-gate, the E6 `input/shortcuts.js` registry, and the E7
single-sourced `LARGE_PASTE_THRESHOLD` + fail-open projectors are the same move — every "must agree" or "must
not recur" was encoded structurally so a future edit can't silently break it. The additive-first sequencing
(build the new surface behind a null-guarded mirror, sweep the legacy at the end) let a delicate wide-deletion
land as its own last story with zero mid-migration dual-chrome shipped.

**No significant discovery. No epic update required.** There is no next epic to invalidate.

## 7. Action items

None carried forward — the milestone is complete and every open action item is now closed (the six E7-carry
items + the e4 #5 setter watch). The next milestone starts from a clean action-item ledger.

Two observations to *seed* the next milestone's planning (not tracked as open actions here):

1. **On any future wide removal, grep the prose for retired names as a distinct sweep step.** E7's only cleanup
   residue was 9 lying comments the compiler couldn't flag.
2. **When consolidating two UI flows onto one shared element, spell out the precedence rule up front.** E7's one
   real bug was interleaving on the shared toast element — cheap to prevent by design, found only in review.

## 8. Readiness verdict

E7 is **complete and the `ui-rethink` milestone is done.** 1/1 story done; the paste toast ships event-driven
off the pump with the ≥4096 B confirm rehomed; the dual-chrome checklist is at zero with the debug panel the
one recorded survivor; the whole-branch review found 3 findings (1 MEDIUM interleaving regression + 1
LOW-MEDIUM promise-leak + comment hygiene), all fixed in `cbfcd35`; suite green at chromium 360/0 +
chromium-transport 166/0. AD-7/AD-9/AD-10/AD-11/AD-16 all held. Every action item across the milestone is
closed. Clear to close the milestone.
