---
phase: 12
plan: 04
subsystem: docs
tags: [slide, docs, requirements, readme, z80-coordination]
requires: [SLIDE-12, SLIDE-36, SLIDE-38]
provides: [SLIDE-40, SLIDE-41]
affects: [docs/SLIDE_Z80_REQUIREMENT.md, README.md, .planning/REQUIREMENTS.md]
tech_stack:
  added: []
  patterns: [nygard-adr-style-doc, append-only-readme-diff, repo-root-link-not-pr]
key_files:
  created:
    - docs/SLIDE_Z80_REQUIREMENT.md
  modified:
    - README.md
    - .planning/REQUIREMENTS.md
decisions:
  - SLIDE-40 doc length 135 lines (target 50-200) — both audiences (Z80 firmware authors + Beastty users), brief, no inlined slide.asm patch diff
  - SLIDE-41 README spelling kept as 'BeasTTY' (existing file convention) rather than 'Beastty' — matches the rename guidance in MEMORY.md (BeasTTY is the post-rename spelling already in use throughout README; 'BestialiTTY' would have been the violation)
  - Pitfall 7 honoured — no hardcoded PR number in Z80 doc; link to repo root only
  - 'Status: pending upstream merge' banner verified by inspecting upstream slide.asm HEAD has no ESC^SLIDE / no CTRL_CAN echo
metrics:
  start_time: "2026-05-08T22:27:09Z"
  end_time: "2026-05-08T22:33:08Z"
  duration: "~6m"
  tasks_completed: 2
  files_changed: 3
  commits: 2
completed: "2026-05-08T22:33:08Z"
---

# Phase 12 Plan 04: SLIDE Z80 Requirement Doc + README Extension Summary

**One-liner:** Markdown deliverables — Z80 firmware-author requirements doc (Nygard-style ADR analog citing ADR-003 + B:SLIDE R + repo-root link with pending-merge banner) and a README "File transfer (SLIDE)" section with 3 new keyboard-shortcut rows.

## Goal

Close SLIDE-40 (Z80-side requirements doc) and SLIDE-41 (README extension) — the two pure-markdown deliverables of Phase 12. Both depend on Plans 12-01..12-03 because the README content describes shipped behaviours from those plans (drag-drop overlay, collision modal, first-use-confirm chip, Settings → SLIDE file transfer sub-block, Esc-to-cancel).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create docs/SLIDE_Z80_REQUIREMENT.md (Z80 firmware requirements doc) | `8c38b29` | `docs/SLIDE_Z80_REQUIREMENT.md` (NEW), `.planning/REQUIREMENTS.md` |
| 2 | Extend README.md with File transfer section + 3 keyboard-shortcut rows | `083e1ec` | `README.md`, `.planning/REQUIREMENTS.md` |

## Implementation

### docs/SLIDE_Z80_REQUIREMENT.md (NEW — 135 lines)

Repo-root `docs/` directory created (`mkdir -p docs`). The doc follows the Nygard-style header from ADR-003 (Status / Date / Audience), then five locked sections per 12-CONTEXT.md and 12-PATTERNS.md:

1. **§1 Wakeup signature: ESC ^ S L I D E** — 7-byte signature `0x1B 0x5E 0x53 0x4C 0x49 0x44 0x45`. Documents torn-chunk safety (matcher detects across arbitrary Web Serial chunk boundaries — no Z80-side coalescing required) and explicitly notes pre-v0.2.1 stock `slide.com` does NOT emit it.
2. **§2 v0.2.1 amendment: bidirectional CTRL_CAN echo** — cites ADR-003 as the protocol authority. Lists the four amendment clauses: either side may initiate, raw single byte (not framed), 500 ms echo deadline, idempotent host-initiated cancel. Notes the 2 s `force_idle` escape hatch tolerates older Z80 firmware that cannot echo within deadline.
3. **§3 Send command convention: B:SLIDE R** — default auto-send `B:SLIDE R\r`. Notes the SLIDE-38 client-side safety regex `/^[A-Za-z0-9: ]*\r$/` (validation happens in browser; Z80 does not need to sanitize). Notes Z80 → PC convention `B:SLIDE S FILE.TXT[,FILE2.TXT,...]`.
4. **§4 Upstream patch** — repo-root link to `https://github.com/blowback/slide`, **Status: pending upstream merge** banner. Three behaviour-impact bullets: Send-direction works against stock; Recv-direction degraded (requires Compatibility-mode `force-start`); Cancellation asymmetric (force_idle absorbs the missing echo). Explicit Pitfall 7 prose advising readers not to hardcode a PR number.
5. **§5 Cross-link** — relative-path links to ADR-003, SPEC-v0.2.md (in upstream), upstream repo root, and the Beastty PROJECT.md.

Project name "Beastty" used throughout (per MEMORY.md `project_renamed_to_beastty`); no emojis, no exclamations, no hardcoded PR number. Em-dash `—` (U+2014) used for sentence-internal pauses.

### README.md (MODIFIED — 36 insertions, 0 deletions)

Two append-only changes preserve the existing 102-line layout:

1. **Keyboard shortcuts table extension** — inserted at the END of the existing UI/clipboard table (between row "Ctrl+Shift+Esc" and the trailing blank line at line 54-55). Three new rows with two-column shape matching the existing table format:
   - `Drag files onto canvas` → `Open SLIDE send modal for the dropped files`
   - `Click ↑ Send file (top bar)` → `Open file picker for SLIDE send`
   - `Esc (during SLIDE transfer)` → `Cancel the in-flight SLIDE send or receive`

2. **New `## File transfer (SLIDE)` section** — appended BEFORE `## Can I run it locally?` (line 88 in original). Three sub-sections (`### Sending files (PC → Z80)`, `### Receiving files (Z80 → PC)`, `### Cancelling`) with prose describing only the shipped behaviour from Plans 12-01..12-03 + Phase 9-11 lineage:
   - Sending: drag-drop and `↑ Send file` button entry points; CP/M 8.3 rewrite preview; collision auto-rename example (`REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT, …`); three-button resolution surface; auto-send `B:SLIDE R\r`; first-use confirm chip.
   - Receiving: `B:SLIDE S FILE.TXT` Z80 command; auto-detection of `ESC ^ S L I D E` wakeup; downloads-tray default; folder-save Settings option.
   - Cancelling: Esc or `[Cancel]` chip; clean CP/M prompt return.

README spelling 'BeasTTY' kept (existing file convention; this is the post-rename spelling already in use throughout — distinct from 'BestialiTTY' which is the old name MEMORY.md flags). Out-of-scope P2 differentiators (preset dropdown, ETA, NAK counter) not mentioned per CONTEXT §"Out of scope".

### REQUIREMENTS.md flips

Both top-level checkboxes and traceability-table rows flipped Pending → Complete:

- `- [x] **SLIDE-40**: docs/SLIDE_Z80_REQUIREMENT.md documents (a) the slide.asm ESC ^ S L I D E wakeup requirement, (b) the v0.2.1 protocol amendment ...`
- `| SLIDE-40 | Phase 12 | Complete |`
- `- [x] **SLIDE-41**: README.md "Keyboard shortcuts" section extended with drag-drop and file-picker references; new "File transfer" section ...`
- `| SLIDE-41 | Phase 12 | Complete |`

## Verification

### Acceptance criteria (all green)

**docs/SLIDE_Z80_REQUIREMENT.md:**
- `test -d docs` succeeds (created via `mkdir -p`)
- `test -f docs/SLIDE_Z80_REQUIREMENT.md` succeeds
- `grep -qE 'ESC.\^.*SLIDE|wakeup' docs/SLIDE_Z80_REQUIREMENT.md` matches (12-VALIDATION 12-XX-18 smoke)
- `grep -q "ADR-003"` matches (cross-reference present)
- `grep -q "B:SLIDE R"` matches (command convention documented)
- `grep -q "github.com/blowback/slide"` matches (repo-root link)
- `grep -q "pending upstream merge"` matches (Pitfall 7 banner)
- `grep -q "Beastty"` matches; `grep -c "BestialiTTY"` returns 0 (project name correct)
- `grep -c "TODO"` returns 0; `grep -c "/pull/"` returns 0; `grep -c "!"` returns 0 (project voice)
- File length 135 lines (within 50-200 target band)

**README.md:**
- `grep -q "^## File transfer"` matches; `^### Sending files`, `^### Receiving files`, `^### Cancelling` all match
- `grep -q "REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT"` matches (collision example)
- `grep -q "B:SLIDE R"` matches (auto-send command)
- `grep -qE "ESC.*SLIDE|wakeup"` matches (wakeup signature)
- All 3 keyboard-shortcut rows present (drag-drop / Send-button / Esc-cancel)
- `git diff --stat README.md` shows 36 insertions, 0 deletions (append-only)
- `grep -cE "TODO|FIXME"` returns 0

**Sanity gate (`cd www && npm run test:fast`):**
- 81/81 deterministic at `--workers=4` (third confirmation run pre-commit)
- 10-worker default-config: 80/81 across three runs, with three different intermittent flakes (slide-sender:54, file-source.spec:133, slide-wakeup:123) — all pre-existing parallelism flakes from Phase 8/9/11 documented in deferred-items.md (see Phase 11 Plan 11-05 SUMMARY notes); unrelated to this plan's markdown-only changes (verified by `git diff --stat` showing only README/REQUIREMENTS modified).

## Deviations from Plan

### None.

Plan executed exactly as written. The two pre-existing concerns surfaced did not require deviation actions:

1. **Pre-existing Phase 10 dirty state in working tree** (10-RESEARCH/10-VALIDATION modifications and 10-0X-PLAN.md untracked files) — left untouched per the executor's plan-prompt instruction "DO NOT touch those files. Stage and commit ONLY the files this plan modifies." Verified via `git status --short` after each commit.

2. **test:fast flakes at 10-worker parallelism** — pre-existing pattern documented in Phase 11 Plan 11-05 SUMMARY ("Pre-existing 11 full-suite failures ... all documented in deferred-items.md per executor SCOPE BOUNDARY rule"). Three retries surfaced three different specs flaking, each from earlier phases unrelated to this plan's markdown changes. Confirmed unrelated by `git diff` showing only `.md` file modifications. Deterministic 81/81 green at `--workers=4` confirms the gate passes when not under parallelism starvation.

## Threat Model Mitigations

All three threat-register items from the plan addressed:

- **T-12-doc-01 (Information Disclosure — hardcoded PR # creates dead link):** mitigated. Doc links to `https://github.com/blowback/slide` repo root only; uses prose ("see open PRs for the v0.2.1 amendment branch") instead of a PR URL. "Status: pending upstream merge" banner makes the dependency explicit. `grep -c '/pull/' docs/SLIDE_Z80_REQUIREMENT.md` returns 0.
- **T-12-doc-02 (Information Disclosure — README claims unshipped behaviour):** mitigated. The "File transfer (SLIDE)" section describes exactly the behaviour shipped in Plans 12-01..12-03 (drag-drop overlay, collision modal with `~N` rename and three-button resolution, first-use confirm chip, `B:SLIDE R\r` auto-send, ESC^SLIDE wakeup detection, Esc-cancel). Out-of-scope P2 differentiators (preset dropdown, ETA, NAK counter) not mentioned.
- **T-12-doc-03 (Repudiation — doc fails to cite ADR-003 + upstream):** mitigated. §5 Cross-link enumerates ADR-003 (relative-path link), upstream repo, SPEC-v0.2.md, and PROJECT.md.

## Self-Check: PASSED

**Files exist:**
- FOUND: `/home/ant/src/microbeast/bestialitty/docs/SLIDE_Z80_REQUIREMENT.md` (135 lines)
- FOUND: `/home/ant/src/microbeast/bestialitty/README.md` (138 lines, was 102 before)
- FOUND: `/home/ant/src/microbeast/bestialitty/.planning/REQUIREMENTS.md` (SLIDE-40 + SLIDE-41 traceability table rows + top-level checkboxes flipped)

**Commits exist:**
- FOUND: `8c38b29` — docs(12-04): add SLIDE Z80 requirements doc + flip SLIDE-40 to Complete
- FOUND: `083e1ec` — docs(12-04): extend README with File transfer section + flip SLIDE-41 to Complete

**Plan acceptance gates:**
- All `<verify>` automated grep gates green for both tasks
- All `<acceptance_criteria>` items green for both tasks
- `<success_criteria>`: 4/4 (`docs/SLIDE_Z80_REQUIREMENT.md` exists with all 4 locked sections + cross-link + banner; README.md has new section + 3 new keyboard rows; SLIDE-40 + SLIDE-41 flipped Pending → Complete; project naming respected; no hardcoded PR; no emojis/exclamations; test:fast baseline preserved)

**TDD gate compliance (N/A):** This plan is `type: execute` (not `type: tdd`). No RED/GREEN/REFACTOR cycle required for markdown-only deliverables.
