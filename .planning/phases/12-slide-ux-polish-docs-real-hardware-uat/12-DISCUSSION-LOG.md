# Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 12-slide-ux-polish-docs-real-hardware-uat
**Areas discussed:** Collision UX (SLIDE-36)

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Collision UX (SLIDE-36) | Where collision detection lives, rename scheme, default action | ✓ |
| Auto-send safety (SLIDE-38) | Allowed character set, validation site, first-use confirmation surface | |
| Pointer/drop isolation (SLIDE-12) | How selection.js learns the drop overlay is active | |
| Docs scope & UAT shape (SLIDE-40/41/42) | Z80 doc audience, README structure, UAT scope | |

**User's choice:** Collision UX only. Other areas land as Claude's Discretion in CONTEXT.md within reasonable interpretations of the requirements text.

---

## Collision UX (SLIDE-36)

### Q1: Where should collision detection + the auto-rename / refuse / send-only-first choice surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing send modal (Recommended) | Add 'collisions' row group to Phase 9 `<dialog>`; three buttons inside the existing modal flow | ✓ |
| Two-step modal flow | Show rewrite/rejected modal first; on confirm, open second `<dialog>` for collisions | |
| Inline chip + auto-resolve | Skip prompt; always auto-rename; show chip "Auto-renamed N collisions" 5s | |

**User's choice:** Extend existing send modal.
**Notes:** Reuses existing focus-trap, `returnValue` plumbing, and rendering idioms; avoids second dialog click-through.

### Q2: When the modal opens with collisions detected, which button should be the default (focused)?

| Option | Description | Selected |
|--------|-------------|----------|
| Send N renamed (Recommended) | Auto-rename is the safe path — no file dropped; matches requirement primary listed choice | ✓ |
| Cancel (existing default) | Match Phase 9 modal pattern (cancelBtnRef.focus()); most conservative | |
| Refuse batch | Most conservative on data integrity but annoying for large batches with few collisions | |

**User's choice:** Send N renamed.
**Notes:** Departure from Phase 9's cancel-default focus, but only when collisions are present. The no-collision happy path retains the original Cancel default.

### Q3: How should the collision detection key be computed?

| Option | Description | Selected |
|--------|-------------|----------|
| Post-truncation uppercase 8.3 (Recommended) | `truncateCpm83(name).toUpperCase()` — catches case-insensitive AND 8.3 truncation collisions | ✓ |
| Pre-truncation uppercase only | `name.toUpperCase()` — misses 8.3 truncation collisions; doesn't satisfy requirement | |
| Post-truncation + reject ~N input | Same as recommended plus reject user filenames with `~N` already present | |

**User's choice:** Post-truncation uppercase 8.3.
**Notes:** Handles all three requirement cases (case-insensitive, 8.3 truncation, mixed case + extension) in a single pass after existing validation.

### Q4: What's the cap on the ~N suffix, and what happens when the cap is exceeded?

| Option | Description | Selected |
|--------|-------------|----------|
| ~1..~9, then reject the surplus (Recommended) | Up to 9 collisions per base; 10th becomes a rejected row | |
| ~1..~99 with base shrink | Allow ~10..~99 by truncating base further | |
| Unlimited via base truncation | No cap; ~999 etc with base shrunk by len(str(N)) | ✓ |

**User's choice:** Unlimited via base truncation.
**Notes:** Departure from the recommended `~1..~9` cap. Locked decision (D-04) requires a deterministic shrink rule: when N reaches two digits, base shrinks from 8 → 7; three digits → 6; etc. Shrinks from the *end* of the base to preserve the leading prefix. Tests must pin the 12-collision and 100-collision cases.

---

## Wrap-up: explore more or write context?

| Option | Description | Selected |
|--------|-------------|----------|
| Explore more gray areas (Recommended) | Pick from Auto-send safety, Pointer/drop isolation, Z80 doc, README, UAT | |
| I'm ready for context | Write CONTEXT.md now; remaining areas land as Claude's Discretion | ✓ |

**User's choice:** Write CONTEXT.md now.
**Notes:** Five gray-area buckets remain unaddressed. CONTEXT.md captures each as Claude's Discretion bullets within the locked Collision UX decisions, citing the specific requirement text as the bound on planner flexibility.

---

## Claude's Discretion (areas not discussed)

The following areas were not discussed and remain at the planner's discretion within
the bounds of the requirement text:

- **SLIDE-12 (pointer/drop isolation)** — predicate mechanism (DOM attribute read vs
  injected predicate vs central state) + in-flight drag handling.
- **SLIDE-38 (auto-send safety)** — validation site (prefs save vs use site vs both),
  first-use confirmation surface (chip vs `<dialog>`), default-detection scope (exact
  match vs broader heuristic).
- **SLIDE-40 (Z80 requirement doc)** — depth, audience framing, inline diff vs link-only.
- **SLIDE-41 (README updates)** — append vs restructure, screenshots vs text-only.
- **SLIDE-42 (UAT scope)** — SLIDE-only vs daily-driver-extended, blocked-result handling.

Defaults are documented in CONTEXT.md `<decisions>` § Claude's Discretion.

---

## Deferred Ideas

Captured during this discussion, deferred per scope guard:

- `~N` cap harmonization between SEND (Phase 12 D-04 unlimited) and RECV (Phase 10 D-05).
- First-use confirmation flag granularity (SLIDE-38) — exact-match vs hash/history.
- Z80 patch coordination with upstream — out of Beastty's control.
- UAT screencasts / video recordings — text-only is the default.
- Stress-test UAT (100-file batches, 10 MB+ singles) — beyond v1 daily-driver bar.
