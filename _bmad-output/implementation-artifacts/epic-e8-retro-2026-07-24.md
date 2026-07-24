# Epic E8 Retrospective — Command History

**Date:** 2026-07-24 · **Facilitator:** Amelia (Dev) · **Format:** party-mode with Ant (Project Lead / hardware operator)
**Epic status:** 3/3 stories complete (E8.1, E8.2, E8.3) · **Run out of order:** E9 shipped and retro'd first (2026-07-24); this retro closes the skipped-over E8 and is on the deployment critical path (E9 retro §7 parked deployment behind it).

---

## 1. Summary

E8 shipped the complete command-history feature in three stories over two days (2026-07-22 → 23) on the
`ui-rethink` branch: an invisible capture engine (line mirror + persisted, dedup'd, newest-first store), the
arrows-triggered recall overlay (filter / Tab-copy / edit / Enter-send), and the Settings surfaces (enable
toggle, size presets with immediate trim, clear-with-confirm). Merged at `1210a6b`; E9 then built on top.

| Story | Scope | Outcome |
|-------|-------|---------|
| E8.1 | Capture engine — line mirror, history store, prefs keys | Done (`ea27a13`) — review: 2 hardening fixes (cap clamp, defensive `getHistory` copy) |
| E8.2 | Recall overlay — trigger, filter, edit, send | Done (`474cf65`) — review: **5 real fixes** + regression test |
| E8.3 | Settings — enable, size, clear | Done (`c1706d0`) — review: 0 correctness bugs, 3 cleanups |

**Numbers:** +41 Playwright specs (17 + 18 + 6); suite ~582 green on the ratified `retries:1` mask; all
21 FRs + NFR-1…6 covered; **zero Rust/wasm changes, zero new dependencies**. No dedicated hardware UAT round
during the epic — but the feature has since been exercised on the real MicroBeast in daily use (see §6).

## 2. What went well

- **Hard invariants made structural, not checked.** The capture hook sits at the `forwardBytes` choke point,
  so paste physically never reaches it — PRD OQ-4 ("don't capture pasted lines") cost zero code. The engine
  never imports `pushTxBytes`, so observe-only (NFR-2) can't regress. The overlay `preventDefault`s every key
  while open, so "nothing transmitted while editing" is guaranteed by listener order, not a runtime flag.
- **E7's shared-surface lesson applied at design time.** Three keydown consumers share `#terminal-wrapper`
  (menu-bar → overlay → keyboard.js). E8.2's story spelled out the precedence chain — registration order in
  the AD-12 slot plus `defaultPrevented` hand-offs, with both neighbours' dependencies documented — before a
  line was written. Zero interleaving defects shipped (E7's one real bug was exactly this class).
- **Story authoring prevented review findings.** The E8.2 story caught two mockup-vs-DESIGN.md conflicts
  (selected-row tint, drop shadow) and resolved them pre-dev; flagged the `commit('')` empty-string edge case
  as an explicit warning the implementation honoured. E8.3's story flagged the TDZ thunk-injection trap;
  honoured. Each story left the next fully plumbed — E8.3 was small *by design*.
- **Review yield concentrated where the novel logic was.** E8.2's review found five real defects, all in
  input classification: keypad digits desyncing the mirror (real user-facing), Shift+Arrow stealing a wire
  keystroke, missing IME guard, modified-chord misreads, trigger active during SLIDE. E8.3's review found
  zero correctness bugs — it reused generic menu mechanics wholesale. Novel input-edge code pays for review;
  proven machinery doesn't.

## 3. The headline — the done-consistency guard has a loophole the exact shape of its target

All three E8 change logs stop at "Status → review". The reviews ran — the evidence is thorough — but it
lives only in commit messages; no story file carries a `### Code Review` section. The E9 retro caught this
for S9.1a (action #5). Verifying *how* done-without-review-section passes the guard revealed the real issue:

`check-story-done-consistency.py` treats a **missing** section as a non-blocking "legacy gap — predates the
convention". That allowance was meant for E0–E3; it currently covers **19 stories, including all of E8 and
all five E9 stories**. The guard only blocks a *stub* section — so simply never adding the section sails
through, and the convention silently lapsed after E3 with nobody noticing. The E5-era lesson was "write the
invariant as code, not as a carried reminder"; the code was written, but its escape hatch was open-ended.
**A grandfather clause needs a closed list, or it grandfathers the future too.**

A second, smaller lapse of the same kind: E8.2 *solved* the parallel-boot flake tax — keep the spec's
`ready()` light and wait on the wasm encoder only when the test sends real keys (spec 33 s → 5 s, zero
flake) — but the discovery lives only inside the E8.2 story file. E8.3 and all five E9 stories kept paying
the triage tax afterwards (E8.1 flaked 9/17 isolated, E8.2 3/18, E8.3 triaged four more).

## 4. Previous-retro follow-through (E7, milestone ui-rethink close)

E7 carried zero open action items (clean milestone close) and seeded two observations:

| E7 seed | E8 outcome |
|---------|-----------|
| Spell out precedence up front when flows share one surface | **Applied** — three-consumer keydown precedence designed in E8.2 before coding; zero interleaving defects |
| Grep prose for retired names after wide removals | **N/A** — E8 was purely additive |

## 5. Action items (opened in sprint-status)

1. **Backfill `### Code Review` sections for e8-1, e8-2, e8-3** from the commit-message evidence
   (`ea27a13`, `474cf65`, `c1706d0`) — extends E9 action #5's convention repair. Owner: Amelia.
2. **Close the guard loophole** — `check-story-done-consistency.py` treats a missing Code Review section as
   *blocking* for E8-onward stories; the legacy allowance becomes a pinned pre-convention list. Owner: Amelia.
3. **Record the light-`ready()` spec pattern** (wait on the wasm encoder only when a test sends real keys)
   in the test docs / spec template, so new specs stop rediscovering the boot-flake tax. Owner: Paige.
4. **Implement the recall-overlay hardware tweaks (i–iv, §6)** including the EXPERIENCE.md microcopy / key-map
   amendments, with the Enter-precedence rule written down before coding. Owner: Amelia. Pre-deployment.

## 6. Hardware feedback — field-driven spec amendments (Ant, real MicroBeast daily use)

Ant has used the feature against real hardware: **"basic functionality is solid"**, with four tweaks. Two are
spec *reversals*, not bugs — FR-16's desk-designed "Enter always sends the edit line, never an un-copied
highlight" was voted down by real use. Flow 6's acceptance criteria refined by the field:

- **(i)** Most recent command at the **bottom** of the overlay list (display order flips; store stays newest-first).
- **(ii)** With an entry highlighted and no Tab, **Enter sends the highlighted command as-is** (reverses FR-16's
  edit-line-only rule). Design point to settle first: when edit text *and* a highlight both exist, which wins —
  proposed rule: edit text when non-empty, highlight when empty.
- **(iii)** With an entry highlighted and no Tab, **←/→ copies it into the edit area** (as if Tab), then edits.
- **(iv)** Drop the **"←→ edit"** legend text (unnecessary; legend becomes `Tab select · ↑↓ move · Enter send · Esc cancel`).

## 7. Significant discoveries / next-epic impact

No plan to invalidate — E9 already shipped on E8's merge and passed four hardware UAT rounds with no E8
defect surfacing. The guard-loophole finding (§3) is process-significant and is covered by action #2.

## 8. Readiness verdict

E8 is **complete and field-validated**: 3/3 stories done, all reviews run (record backfill = action #1),
suite green, hardware use confirms the core is solid. `epic-e8` flipped to done in sprint-status alongside
this retro. **Deployment remains parked** behind action #4 (the four tweaks) and the planned file-transfer
conversation — per the E9 retro's parking note, now with the E8 "issues" made concrete as tweaks i–iv.
