#!/usr/bin/env python3
"""
check-story-done-consistency.py — guard that "done" means done *in every place*.

The recurring failure (E2/E3/E4 retros): a story is marked `done` in
sprint-status.yaml but the copies of its status drift — the story-file
front-matter still reads `review`, or the `### Code Review` section is still the
dev-story template stub ("Not yet run" / "To be filled with…"). Retros then
mis-read the stub as "review skipped" when the review was actually run and just
never recorded.

This script makes the invariant mechanical: for every story marked `done` in
sprint-status, its story file must ALSO read done AND carry a filled-in Code
Review outcome. It depends on nothing being remembered — run it manually, or
wire it as a git pre-commit hook (see scripts/install-git-hooks.sh).

Exit 0 = consistent. Exit 1 = drift found (details printed). No third-party deps.
"""
import re
import sys
from pathlib import Path

IMPL = Path(__file__).resolve().parent.parent / "_bmad-output" / "implementation-artifacts"
SPRINT = IMPL / "sprint-status.yaml"

# A Code Review section still containing any of these is an unfilled stub.
# "fill on completion" is the E9 story-template stub text — it sat unflagged
# through all five E9 stories (E8 retro finding, 2026-07-24).
STUB_MARKERS = ("Not yet run", "To be filled with", "Pending — run", "Pending - run",
                "fill on completion")

# Stories that predate the Code Review section convention (E0–E3 era). ONLY these
# may lack the section without blocking; the list is CLOSED — never add to it for
# a new story. An open-ended "legacy" allowance grandfathered E8 and E9 wholesale
# (E8 retro headline, 2026-07-24): a missing section anywhere else is now an ERROR.
LEGACY_NO_SECTION = frozenset({
    "e0-1-focus-retention-helper",
    "e0-2-modal-helper-openmodal-send-modal-refactor",
    "e1-1-menu-bar-shell-dropdown-mechanics",
    "e1-2-keyboard-navigation-esc-passthrough-guard",
    "e1-3-chrome-js-decomposition-boot-order-reset-re-projection",
    "e1-4-view-menu-theme-phosphor",
    "e1-5-view-menu-font-zoom-clear",
    "e2-1-connect-disconnect-single-writer-menu-item",
    "e2-2-auto-connect-toggle-choose-microbeast",
    "e2-3-serial-configuration-modal",
})


def done_story_slugs(sprint_text: str) -> list[str]:
    """Story slugs marked `done` under development_status (excl. epic-*/retrospective keys)."""
    slugs = []
    in_status = False
    for line in sprint_text.splitlines():
        # Match the block header whether bare OR carrying an inline `# comment`
        # (sibling top-level keys like `last_updated:` already do — without the
        # optional-comment tail a commented header silently disables the guard).
        if re.match(r"^development_status:\s*(#.*)?$", line):
            in_status = True
            continue
        if in_status:
            # leave the block when a new top-level (non-indented, non-comment) key appears
            if line and not line[0].isspace() and not line.lstrip().startswith("#"):
                break
            m = re.match(r"^\s+([a-z0-9][a-z0-9-]*):\s*done\b", line)
            if not m:
                continue
            slug = m.group(1)
            if slug.startswith("epic-") or slug.endswith("-retrospective"):
                continue
            slugs.append(slug)
    return slugs


def story_file(slug: str) -> Path | None:
    f = IMPL / f"{slug}.md"
    return f if f.exists() else None


def check_story(slug: str) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Errors = drift of something that WAS recorded then
    diverged (blocks). Warnings = legacy gap that predates the convention (surfaced,
    doesn't block)."""
    errors, warnings = [], []
    f = story_file(slug)
    if f is None:
        return ([f"{slug}: marked `done` in sprint-status but no story file {slug}.md found"], [])
    text = f.read_text(encoding="utf-8")

    # 1) front-matter Status must read done — a mismatch is active drift (ERROR)
    m = re.search(r"^Status:\s*(.+?)\s*$", text, re.MULTILINE)
    if not m:
        errors.append(f"{slug}: no `Status:` front-matter line found")
    elif m.group(1).strip().lower() != "done":
        errors.append(f"{slug}: front-matter Status is '{m.group(1).strip()}' but sprint-status says done")

    # 2) Code Review section: an unfilled STUB is the exact E4 regression (ERROR);
    #    an ABSENT section blocks too, unless the story is on the closed
    #    pre-convention list (WARNING). Both `## Code Review` (E9 template) and
    #    `### Code Review` (E4–E8 convention) count — the h3-only match let the
    #    h2-headed E9 sections (stubs included) sail past unread.
    cr = re.search(r"^#{2,3}\s+Code Review\s*$(.*?)(?=^#{2,3}\s|\Z)",
                   text, re.MULTILINE | re.DOTALL)
    if not cr:
        msg = f"{slug}: no `Code Review` section"
        if slug in LEGACY_NO_SECTION:
            warnings.append(f"{msg} (predates the section convention — backfill when known)")
        else:
            errors.append(f"{msg} (required for post-E3 stories — record the review outcome)")
    else:
        body = cr.group(1).strip()
        if not body:
            errors.append(f"{slug}: `Code Review` section is empty")
        elif any(mark in body for mark in STUB_MARKERS):
            errors.append(
                f"{slug}: `Code Review` is still the unfilled stub "
                f"(record the review outcome: N findings / fix sha, or '0 findings / clean')"
            )
    return errors, warnings


def main() -> int:
    if not SPRINT.exists():
        print(f"error: {SPRINT} not found", file=sys.stderr)
        return 2
    slugs = done_story_slugs(SPRINT.read_text(encoding="utf-8"))
    errors, warnings = [], []
    for slug in slugs:
        e, w = check_story(slug)
        errors.extend(e)
        warnings.extend(w)

    if warnings:
        print(f"⚠ {len(warnings)} legacy gap(s) (not blocking):")
        for w in warnings:
            print(f"  • {w}")
        print()

    if errors:
        print("✗ story-done consistency check FAILED — 'done' is not recorded in every place:\n")
        for p in errors:
            print(f"  • {p}")
        print(
            f"\n{len(errors)} drift(s) across {len(slugs)} done stories. "
            "Fix the story file(s) so done means done everywhere, or unset the status."
        )
        return 1

    print(f"✓ {len(slugs)} done stories consistent — no status/review drift.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
