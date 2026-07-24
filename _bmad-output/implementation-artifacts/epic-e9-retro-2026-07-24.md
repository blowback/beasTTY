# Epic E9 Retrospective — Local Folder Pull Pane (milestone: pull-pane)

**Date:** 2026-07-24 · **Facilitator:** Amelia (Dev) · **Format:** party-mode with Ant (Project Lead / hardware operator)
**Epic status:** 5/5 stories complete (S9.1a, S9.1b, S9.2, S9.3, S9.4-optional) · **Next epic:** none defined — E9 is the milestone's only epic

---

## 1. Summary

E9 shipped the full pull-pane loop — select filenames in the terminal, drag onto the pane, review the
composed `SLIDE S ...` line in-pane, confirm, files land in the bound folder and appear in the list — plus
the optional reverse direction (pane row → terminal → device) with a user-requested multi-select extension.

| Story | Scope | Outcome |
|-------|-------|---------|
| S9.1a | Pane shell, FSA folder view, gutter dock, rail | Done — 8 specs, single pass |
| S9.1b | Live refresh: 3 triggers, timer guards, diff-render | Done — review: 5 fixed / 3 deferred / 3 refuted |
| S9.2 | Selection → `SLIDE S` compose + in-pane review | Done — review: 4 fixed, 2 new specs |
| S9.3 | Drop-to-pull end-to-end, drag origination, bloom | Done — 1 multi-click regression caught in-suite; hardware UAT-E9-01 pass |
| S9.4 | Reverse drag (optional) + multi-select (T6 ext.) | Done — design pivot to sanctioned fallback; review: 10 fixed; UAT-E9-02/03/04 pass |

**Numbers:** ~6,100 insertions across 6 feature/fix commits (20c23f2 → 8bdb80a); ~69 new Playwright specs;
suite at 663–666 green under the ratified retries:1 mask; ~20 code-review findings fixed across the epic;
**zero Rust/wasm and zero SLIDE protocol changes** (NFR-1 held). Four real-hardware UAT rounds fixed
**12 interop defects**, several predating the epic. Headline side effect: the sender pump now bursts
window-aligned to match the Z80's ACK-per-4-frames cadence — **every SLIDE send runs ~4–5× faster**.

## 2. What went well

- **"Thin view over existing plumbing" held.** The epic brief's bet — SLIDE-recv, `tx-sink`, `selection.js`,
  and the persisted `recv_directory` handle already provide the transport — was true. S9.1a–S9.3 landed with
  no transport changes; the AD-3 injection discipline meant each new pane capability was one injected closure
  at the composition root (S9.2's suspension-predicate fix and S9.4's `sendFiles` fallback both touched
  `main.js` only).
- **The gutter dock made NFR-5 structurally safe.** Pane outside the 80×24 grid, canvas centering in the
  remainder, narrow-window rail in pure CSS container queries — the grid could not shrink by construction.
- **Review-as-a-flag applied E7's shared-surface lesson before it became a bug.** Review state is stored
  beside (not inside) the content view, so the 60 s refresh cannot evict a human mid-decision. E7 shipped the
  equivalent defect and found it in review; E9 caught it at design time.
- **Hardware UAT as a defect net, with evidence-first debugging.** When the UAT-E9-03 retest failed
  identically after round one, the response was to read the real `slide.asm` — which surfaced the true defect
  (ACK-per-window cadence vs. one-frame-per-ACK pump) rather than another symptom patch. Every interop fix in
  the record cites its evidence (e.g. seq 24 = 0x18 = CTRL_CAN split across chunks ⇒ deterministic spurious
  cancel for ≥24 KB files).
- **The optional story pivoted cheaply because its fallback was pre-authorized.** When Chromium stripped
  constructed `File`s from the real drag store, S9.4's documented fallback (native gesture + pane-owned drop
  handlers + sanctioned `sendFiles` export) shipped without renegotiating scope. Field-confirmed by Ant
  ("works great"; post-cadence-fix: "much nippier").

## 3. The headline — both synthetic environments flattered us

The epic's two hardest moments share one sentence: **our simulated realities were more forgiving than the
real ones, and reality was consulted only at UAT/checkpoint time.**

- **Playwright's drag events vs. Chromium's real drag loop.** S9.4 design (a) passed all synthetic specs;
  the real drag loop degrades a JS-constructed `File` to a text/plain filename. Only Ant's manual checkpoint
  caught it. The synthetic drag never touches the platform drag store — green specs measured the wrong thing.
- **The transport bot vs. the Z80.** The bot ACKed per-frame; real SLIDE ACKs once per 4-frame window. The
  bot only gained v0.5.2 cadence, split-ACK realism, and a stall knob *after* hardware failed twice. Related:
  the S9.3 manual native-drag checkpoint was left open at story end and the answer arrived one story later —
  a deferred checkpoint is exactly where the risk concentrates, because checkpoints exist where the harness
  is blind.

A second theme: **invisible degradation needs a baseline.** The 4–5× send slowdown was undetectable because
transfers still completed — nothing anywhere recorded what throughput *should* be. And two Phase 9
"until wired" leftovers (Esc-cancel for sends, chip filename) sat dormant for months with nothing tracking
them until this epic's UAT tripped over both.

## 4. Previous-retro follow-through (E7, milestone ui-rethink)

| E7 seed | E9 outcome |
|---------|-----------|
| Define precedence up front when two flows share one surface | **Applied** — review-as-a-flag (see §2); caught at design/review time |
| Grep prose for retired names after wide removals | **Not exercised** — E9 was additive; carries as a standing habit |

All ui-rethink action items were closed and cleared from sprint-status before E9 began (2026-07-23).
Clean ledger in, clean ledger out.

## 5. Action items (opened in sprint-status)

1. **Bot-parity-first rule** — any story touching SLIDE transport starts by confirming bot behavior against
   `slide.asm` for the paths it exercises. Owner: Amelia. Done when recorded as a standing note where
   transport test work starts (docs / story-plan template).
2. **Checkpoints run in the story that raises them** — a manual platform checkpoint left open at story end is
   an explicit carried risk, named in the next story's plan. Owner: Amelia (workflow). Done when the next
   story plan reflects it.
3. **Latent-stub sweep** — grep the shell for "until wired" / dormant-hook TODOs like the two Phase 9
   leftovers; triage findings into fix/park/delete. Owner: Amelia. Done when results recorded (even if empty).
4. **Record wire-speed reference numbers** — expected throughput (e.g. ~11 s for 19 KB @ 19200 baud) noted in
   the transport docs so a future silent slowdown is measurable. Owner: Paige. Done when numbers are findable.
5. **Backfill S9.1a's code-review outcome section** so the story-record convention stays unbroken.
   Owner: Amelia. Done when the section is filled.

**Backlog seeds (v1.1 candidates, not tracked actions):** DIR-columnar reassembly heuristic (`VPEEK    COM`
currently tokenizes as two files — visible in review by design); bloom-card dismissal after a drag-out drop;
`formatSize` dedup with `slide-chip.js`.

## 6. Significant discoveries / next-epic impact

No next epic is defined, so nothing to invalidate. Two discoveries matter for future planning:
- The Chromium constructed-`File` drag limitation rules out one implementation family for any future
  drag-out feature; the pane-owned-drop pattern is the proven route.
- The parked dual-pane remote file manager remains blocked on SLIDE gaining a directory-LIST verb. Ant has a
  further file-transfer idea to bring to a planning discussion before the next milestone is shaped.

## 7. Readiness verdict

E9 is **complete**. 5/5 stories done incl. the optional one; all four hardware UAT rounds pass; suite green
at 663–666; all code reviews complete (S9.1a outcome section to backfill — action #5); no unresolved
blockers (the Linux desktop drag-in rejection is proven environmental — Wayland/portal/Chromium DnD layer —
with Windows Chrome accepting the same drag; diagnostics left in place for field triage).

**Deployment is intentionally parked** behind (a) the E8 Command History retro + addressing its issues, and
(b) a planning conversation about the next file-transfer idea. Codebase gut-check from the Project Lead:
solid — "very happy."
