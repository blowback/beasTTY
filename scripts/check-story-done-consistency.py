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
STUB_MARKERS = ("Not yet run", "To be filled with", "Pending — run", "Pending - run")


def done_story_slugs(sprint_text: str) -> list[str]:
    """Story slugs marked `done` under development_status (excl. epic-*/retrospective keys)."""
    slugs = []
    in_status = False
    for line in sprint_text.splitlines():
        if re.match(r"^development_status:\s*$", line):
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
    #    a totally ABSENT section is a pre-convention legacy gap (WARNING).
    cr = re.search(r"^###\s+Code Review\s*$(.*?)(?=^###\s|\Z)", text, re.MULTILINE | re.DOTALL)
    if not cr:
        warnings.append(f"{slug}: no `### Code Review` section (predates the section convention — backfill when known)")
    else:
        body = cr.group(1).strip()
        if not body:
            errors.append(f"{slug}: `### Code Review` section is empty")
        elif any(mark in body for mark in STUB_MARKERS):
            errors.append(
                f"{slug}: `### Code Review` is still the unfilled stub "
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
