---
phase: 06-daily-driver-polish-session-deployment
plan: 08
subsystem: docs
tags: [soak, uat, validation, daily-driver, performance.memory, scrollback, session-log]

# Dependency graph
requires:
  - phase: 06-daily-driver-polish-session-deployment
    provides: Plans 06-01..06-07 — scrollback, selection, session log, prefs, deploy artifacts (LICENSE + GH Pages workflow + CSP)
provides:
  - 24-hour soak protocol document (06-SOAK.md) with sampling cadence + ±10% byteLength pass criterion
  - 8-test daily-driver Human UAT checklist (06-HUMAN-UAT.md) closing SC-1, SC-3, SC-4, SC-5 from user perspective
  - 3 supplementary OOB checks (real-clipboard handshake, GH Pages first-deploy headers, CSP defense-in-depth)
affects: [phase-verify, phase-6-sign-off, future-soak-runs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OOB validation doc pair (soak protocol + UAT checklist) mirrors Phase 5 Plans 07/08 cadence"
    - "Sampler snippets use setInterval (NOT rAF) for hidden-tab safety per RESEARCH §Pitfall 9"

key-files:
  created:
    - .planning/phases/06-daily-driver-polish-session-deployment/06-SOAK.md
    - .planning/phases/06-daily-driver-polish-session-deployment/06-HUMAN-UAT.md
  modified: []

key-decisions:
  - "Soak sampler cadence locked at 60_000ms (1,440 samples / 24h); Pitfall 9 mandates setInterval over rAF for hidden-tab survival"
  - "Primary memory signal is wasm.memory.buffer.byteLength; performance.memory documented as supplementary fallback per RESEARCH A7"
  - "Pass criterion ±10% of t=10min byteLength is locked verbatim from CONTEXT D-40, not tunable"
  - "06-HUMAN-UAT.md format mirrors 05-HUMAN-UAT.md verbatim (front-matter shape, ### N. Title (REQ-ID), expected/steps/result blocks)"
  - "24-h soak (Test 8) and full daily-driver UAT explicitly OUT-OF-BAND — does NOT block /gsd-verify-phase 06"
  - "Task 3 checkpoint:human-verify auto-approved under workflow._auto_chain_active=true (mirrors Plan 06-07 + Plans 04-04 / 05-07 / 05-08 / 06-04..06-07 precedent)"

patterns-established:
  - "Out-of-band validation doc pair: soak protocol + Human UAT checklist ship as markdown only; the actual run is the user's schedule"
  - "Soak sampling discipline: setInterval(60_000) NOT rAF; primary signal is wasm.memory.buffer.byteLength; performance.memory is supplementary fallback"
  - "Phase Human UAT mirrors prior phase's HUMAN-UAT.md format verbatim — front-matter shape, ### N. Title (REQ-ID), expected/steps/result, supplementary A/B/C section"

requirements-completed: [SESS-01, PLAT-03, PLAT-05]

# Metrics
duration: 3min
completed: 2026-04-25
---

# Phase 6 Plan 08: 24-Hour Soak Protocol + Daily-Driver Human UAT Summary

**Two markdown-only protocol docs shipped: 06-SOAK.md (24-h memory-flat sampler with setInterval(60_000) + ±10% byteLength pass criterion) and 06-HUMAN-UAT.md (8 daily-driver tests + 3 OOB supplementary checks) — closes the documentation portion of SC-2 and SC-5; the actual runs remain out-of-band.**

## Performance

- **Duration:** 3min
- **Started:** 2026-04-25T14:59:57Z
- **Completed:** 2026-04-25T15:02:48Z
- **Tasks:** 3 (2 auto + 1 auto-approved checkpoint:human-verify)
- **Files modified:** 2 created, 0 modified

## Accomplishments

- **06-SOAK.md** — 24-hour soak protocol with copy-paste-able DevTools-console sampler snippet. Sampler uses `setInterval(60_000)` (NOT rAF — Pitfall 9) and records `wasm.memory.buffer.byteLength`, `sessionLogBytes`, and `performance.memory` (when available) every 60 seconds for 24 hours (~1440 samples). Primary pass criterion: byteLength stable within ±10% of t=10min sample (CONTEXT D-40 — locked, not tunable). Includes failure-handling playbook with three most-likely suspects (atlas glyph cache growth, selection observer leak, session log retention beyond Connect cycle) and a YAML result block ready for post-run fill-in.
- **06-HUMAN-UAT.md** — 8 daily-driver tests covering all enumerated scenarios from CONTEXT line 94-98: paste 100 KB during real CP/M (SESS-03 / SC-1), scroll back through 8K BASIC lines (SESS-01 / SC-2), copy command from history + paste back (SESS-02 / SESS-03), theme toggle while scrolled up (D-13), clear-screen during long output (D-26), full reload restores prefs + port preset (PREF-01/02 / D-32 / D-36), auto-connect on second visit (D-34), 24-hour soak xref (D-40 / 06-SOAK.md). Plus 3 OOB supplementary checks (A: real-clipboard handshake, B: GH Pages first-deploy headers, C: CSP defense-in-depth). Format mirrors 05-HUMAN-UAT.md verbatim per 06-PATTERNS.md.
- **Phase 6 ready for `/gsd-verify-phase 06`.** All 8 plans landed; phase-verify will check the test suite + must-haves + ROADMAP SC-1..SC-5; the 24-h soak and full daily-driver UAT are documented OOB items not gating the verifier.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write 06-SOAK.md (24-hour memory-flat protocol)** — `582dfd4` (docs)
2. **Task 2: Write 06-HUMAN-UAT.md (8 daily-driver tests)** — `da30124` (docs)
3. **Task 3: checkpoint:human-verify (Phase 6 docs ship-ready)** — auto-approved under `workflow._auto_chain_active=true`; no commit (gate only)

⚡ Auto-approved checkpoint: Task 3 (Confirm Phase 6 docs ship-ready) — `_auto_chain_active=true` in `.planning/config.json` per `--auto` chain mode. The 5-item operator verification (read both docs end-to-end, paste-test the sampler snippet, mental walkthrough of Test 1 + Test 6, format-consistency check vs 05-HUMAN-UAT.md, OOB-posture confirmation) is deferred to post-execution operator review. The 24-hour soak (SC-2) and full-day daily-driver UAT (SC-5) are documented protocols that the user runs out-of-band — this plan ships the markdown only, no actual runs required for plan completion.

**Plan metadata commit:** to follow this summary write-up.

## Files Created/Modified

- `.planning/phases/06-daily-driver-polish-session-deployment/06-SOAK.md` — 24-hour memory-flat soak protocol; setInterval(60_000) sampler, wasm.memory.buffer.byteLength primary signal, performance.memory supplementary fallback, ±10% pass criterion, failure-handling playbook, YAML result block.
- `.planning/phases/06-daily-driver-polish-session-deployment/06-HUMAN-UAT.md` — Daily-driver Human UAT with 8 tests covering SC-1..SC-5 from user perspective + 3 supplementary OOB checks (real-clipboard, GH Pages headers, CSP enforcement).

## Decisions Made

- **Sampler cadence: 60_000ms** — 1,440 samples per 24h is the right resolution to see drift trends without flooding console. Lower cadences fragment the signal; higher (e.g. 5 min) miss spikes. Locked.
- **setInterval (NOT rAF) for sampling** — Pitfall 9 mandate. rAF throttles to ~1 Hz on hidden tabs (Chromium background-tab throttling); setInterval continues firing even on hidden tabs. Verified by `grep -c "requestAnimationFrame" 06-SOAK.md` = 0 (T-06-08-02 mitigation).
- **Primary signal: wasm.memory.buffer.byteLength; performance.memory supplementary** — RESEARCH §Assumptions Log A7 documents that `performance.memory` is non-standard and Chromium may eventually remove it. The protocol works either way; if Chromium removes it, the sampler still records `wasmByteLength` and the pass criterion still applies.
- **Pass criterion ±10% locked verbatim from CONTEXT D-40** — not tunable; the tunable `wasmByteLength` initial value is the t=10-minute sample, allowing the wasm linear memory to settle past initial atlas/scrollback ramp before the stability window begins.
- **HUMAN-UAT mirrors 05-HUMAN-UAT.md verbatim** — same front-matter shape (status/phase/source/started/updated), same `### N. Title (REQ-ID)` heading style, same `**expected:** … **steps:** … **result:**` block structure, supplementary A/B/C section pattern preserved.
- **Both docs are explicitly OUT-OF-BAND** — first paragraph of each doc states `/gsd-verify-phase 06` does NOT block; the user runs both on their schedule and updates result lines post-run.
- **Task 3 checkpoint auto-approved under `_auto_chain_active=true`** — config flag was set when the user kicked off the auto-chain. Mirrors auto-approve precedent from Plan 06-07 (both human-verify gates), Plan 06-04, Plan 05-07, Plan 04-04. The 5 operator verification items (doc read-through, sampler paste-test, Test 1 + Test 6 walkthrough, format consistency check, OOB-posture confirmation) are deferred to post-execution operator review.

## Deviations from Plan

None — plan executed exactly as written. Both docs created from the verbatim templates the planner supplied; all acceptance criteria pass; no Rule 1/2/3 fixes required.

## Issues Encountered

None.

## User Setup Required

None — both docs are markdown-only and require no environment, dependency, or service configuration. The user runs the protocols on their schedule (24-h soak + 8 daily-driver tests + 3 supplementary OOB checks) when the deployed URL is live and a real MicroBeast is plugged in.

## Next Phase Readiness

**Phase 6 ready for `/gsd-verify-phase 06`.** All 8 plans landed:

- Plan 06-01 (Wave 0): test scaffolding for SESS-* / PREF-* / PLAT-05
- Plan 06-02 (Wave 1): Rust core `snapshot_grid_at` + `clear_visible` + wasm façade
- Plan 06-03 (Wave 2): scroll-state.js + canvas branching for scrollback navigation
- Plan 06-04 (Wave 3): selection.js + clipboard.js (Ctrl+Shift+C/V intercepts)
- Plan 06-05 (Wave 4): session-log.js per-connection raw-byte buffer + Download log button
- Plan 06-06 (Wave 5): prefs.js + auto-connect on second visit
- Plan 06-07 (Wave 6): MIT LICENSE + GH Pages workflow + _headers + CSP meta-tag fallback
- Plan 06-08 (Wave 7, this plan): 24-h soak protocol + Human UAT checklist

**Phase 6 verifier check matrix:**
- Test suite green: ✅ (no code changes in this plan; preserved from Plan 06-07)
- Deploy artifacts committed: ✅ (LICENSE, .github/workflows/pages.yml, www/_headers, www/index.html CSP meta — Plan 06-07)
- OOB protocol docs committed: ✅ (06-SOAK.md + 06-HUMAN-UAT.md — this plan)

**Out-of-band items the user runs on their schedule:**
- 24-hour soak run (06-SOAK.md `## Result` block fill-in post-run) — closes SC-2
- 8 daily-driver tests + 3 supplementary checks (06-HUMAN-UAT.md `**result:**` lines fill-in post-run) — closes SC-5
- Real-clipboard handshake (06-HUMAN-UAT.md §A) — proves clipboard.readText user-gesture flow
- GitHub Pages first-deploy headers (06-HUMAN-UAT.md §B) — confirms `pkg/*.wasm` Content-Type
- CSP defense-in-depth (06-HUMAN-UAT.md §C) — confirms script-src enforcement on deployed page

**Concerns:** None. Phase 6 fully shipped at the code + docs level; everything pending is the user's deferred manual validation.

## Self-Check: PASSED

Verified after writing summary:

```
[ -f .planning/phases/06-daily-driver-polish-session-deployment/06-SOAK.md ] && echo "FOUND"
→ FOUND

[ -f .planning/phases/06-daily-driver-polish-session-deployment/06-HUMAN-UAT.md ] && echo "FOUND"
→ FOUND

git log --oneline | grep "582dfd4"
→ FOUND (Task 1 commit: docs(06-08): 24-hour soak protocol)

git log --oneline | grep "da30124"
→ FOUND (Task 2 commit: docs(06-08): daily-driver Human UAT checklist)
```

All claims verified.

---
*Phase: 06-daily-driver-polish-session-deployment*
*Completed: 2026-04-25*
