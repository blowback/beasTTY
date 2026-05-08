---
phase: 12-slide-ux-polish-docs-real-hardware-uat
fixed_at: 2026-05-09T00:00:00Z
review_path: .planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-05-09
**Source review:** `.planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (warnings only; 4 info findings deferred per `fix_scope: critical_warning`)
- Fixed: 2
- Skipped: 0

Both warnings landed cleanly. WR-02 changes the state-machine semantics
of the first-use-confirm async window, so the commit status below flags
it as `fixed: requires human verification` per the GSD verifier guideline
for logic-class fixes.

## Fixed Issues

### WR-01: Duplicate character in `selectLine` whitespace comparison silently fails to trim narrow-space glyphs

**Files modified:** `www/input/selection.js`
**Commit:** `3d12102`
**Status:** fixed
**Applied fix:**

The original line was, byte-for-byte:

```
while (end > 0 && (text[end] === ' ' || text[end] === '\x00')) end -= 1;
```

That is — the second comparand was a literal NUL byte (`\x00`), not a
distinct space glyph. The bug was masked in the editor and in the review
because both characters render as whitespace. Replaced with the regex
form recommended in the WR-01 fix block:

```js
while (end > 0 && /\s/.test(text[end])) end -= 1;
```

This matches the consistency intent (mirrors the existing
`getSelection` trimming approach) and removes the NUL byte from the
source file. Verified via `node -c` syntax check; verified via re-read
that the surrounding `selectLine` body is intact.

Note (out of scope for WR-01, but worth flagging for a follow-up
finding): a separate NUL byte still exists inside the regex character
class in `getSelection` at `www/input/selection.js:294`
(`/[\s\x00]+$/`). The WR-01 finding text quotes that regex as
`/[\s ]+$/` (i.e., the reviewer also did not see the NUL byte there).
The narrow scope of WR-01 is `selectLine` (line 209 only), so this
sibling defect was deliberately not modified. Recommend filing a new
finding (or expanding the existing IN list) for that second NUL.

### WR-02: Double-`enterSendMode` race window during async first-use-confirm path

**Files modified:** `www/transport/slide.js`
**Commit:** `1200af7`
**Status:** fixed: requires human verification
**Applied fix:**

Added a module-scope `firstUseConfirmPending` sentinel exactly as the
WR-02 fix block recommends:

1. Declared near `pendingSendSession` (with a Phase 12 WR-02 comment
   block explaining why the existing first-click-wins guard cannot
   cover this window).
2. Set `firstUseConfirmPending = true` immediately before
   `void enterSendModeAfterFirstUseConfirm({ files, cmd })` in
   `enterSendMode` (the synchronous entry).
3. Added a guard at the top of `enterSendMode` (alongside the existing
   `pendingSendSession !== null` check) that emits the same
   `console.warn` shape and returns early if the sentinel is true.
4. Cleared `firstUseConfirmPending = false` once at the top of
   `enterSendModeAfterFirstUseConfirm` immediately after the
   `surfaceFirstUseConfirm` await/catch — covering Confirm, Reset to
   default, and surfaceFirstUseConfirm-throw paths in a single place
   (more robust than three duplicate clears, and avoids any branch
   forgetting it).
5. Reset `firstUseConfirmPending = false` in `__resetForTests` so
   Playwright runs start from a clean state.

Verified via `node -c` syntax check; verified via re-read that all four
edit points are present and correctly ordered. Flagged as `requires
human verification` because this is a logic/state-machine change in a
race-prone async path — the verifier should confirm with a Playwright
spec (or manual exercise) that:

- Two rapid programmatic `window.__slide.enterSendMode` calls during
  the chip-displayed window result in exactly one coroutine and one
  surfaced chip.
- After the user clicks Confirm or Reset to default, a fresh
  `enterSendMode` call is no longer refused by the new sentinel.
- `__resetForTests` clears the sentinel between specs.

---

_Fixed: 2026-05-09_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
