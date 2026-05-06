---
phase: 07-slide-rust-core-framer-crc-state-machine
plan: 05
subsystem: rust-core
tags: [slide, adr, hardening, no-time-invariant, ccitt-false, can-bidirectional, nygard-adr]

# Dependency graph
requires:
  - phase: 07-slide-rust-core-framer-crc-state-machine (Plan 07-03)
    provides: pub fn cancel + pub fn force_idle in slide/state.rs (D-05/D-06/D-07 implementation site that ADR-003 documents)
  - phase: 07-slide-rust-core-framer-crc-state-machine (Plan 07-04)
    provides: tests/slide_idempotent_reentry.rs re1..re6 corpus (cited in ADR-003 Decision section as the integration-level verification surface)
  - phase: 02-wasm-boundary-minimal-js-harness
    provides: tests/core_02_no_browser_deps.rs FORBIDDEN_TOKENS_WITH_EXEMPTIONS table + comment-stripping walker (D-07 Phase 2 wasm_bindgen exemption convention; this plan extends with std::time row)
  - phase: 01-rust-core-parser-grid-key-encoder
    provides: ADR-001 Nygard structure (analog for ADR-003); tests/core_02_no_browser_deps.rs scaffold
provides:
  - ".planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md — Nygard ADR formalising 07-CONTEXT.md D-05/D-06/D-07/D-08 with cited slide-rs evidence (190 lines)"
  - "ADR-003 documents CTRL_CAN raw single byte 0x18 wire format with 4 evidence points (slide-rs/protocol.rs:104, protocol.rs:199-206, slide-py/common.py:64-71, RDY/FIN symmetry)"
  - "ADR-003 records upstream PR target github.com/blowback/slide for Phase 12 coordination per REQUIREMENTS.md SLIDE-40"
  - "ADR-003 cross-links to ADR-001 / ADR-002 / 07-CONTEXT.md / 07-RESEARCH.md / PITFALLS §5 / ARCHITECTURE.md §7 + anti-pattern 4 / REQUIREMENTS SLIDE-04/27/30/40 / Plan 07-03 implementation site / Plan 07-04 integration tests"
  - "tests/core_02_no_browser_deps.rs FORBIDDEN_TOKENS_WITH_EXEMPTIONS extended with (\"std::time\", &[]) — promotes the no-`std::time`-in-core invariant from convention to test gate"
  - "Phase 7 deliverable list closed: 11+ modified/new code files (Plans 01-04) + 30+ unit tests + 22 integration tests + 1 new ADR"
affects: [08-wasm-boundary, 09-sender, 10-receiver-cancellation, 11-js-bridge, 12-slide-uat-and-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nygard ADR for v0.2.1 protocol amendment: ADR-003 follows ADR-001/ADR-002 verbatim structure (Status / Date / Phase / Deciders / Context / Decision / Consequences / Rejected Alternatives / Cross-link / References) — every cross-link to upstream/research/implementation/tests is explicit so future phases (8/9/10/11/12) can navigate the contract from one canonical document"
    - "Cited-evidence Decision section: ADR-003 §Decision Section #2 lists 4 cited evidence points for the CTRL_CAN raw-byte wire format (slide-rs/protocol.rs:104, slide-rs/protocol.rs:199-206, slide-py/common.py:64-71, RDY/FIN symmetry) — pattern for documenting protocol-shape decisions where upstream code is the ground truth"
    - "FORBIDDEN_TOKENS gate as architectural-invariant enforcer: the file walker at tests/core_02_no_browser_deps.rs strips // and beyond before scanning, so doc-comment mentions (//! NO std::time, /// no std::time anywhere in the core crate) remain fine; only real code uses fail. Promotes the invariant from convention (relied on plan acceptance criteria + reviewer attention) to a CI-enforced gate"

key-files:
  created:
    - ".planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md (190 lines, Nygard ADR formalising D-05/D-06/D-07/D-08)"
  modified:
    - "crates/bestialitty-core/tests/core_02_no_browser_deps.rs (FORBIDDEN_TOKENS_WITH_EXEMPTIONS extended with std::time row + Phase 7 / ADR-003 cross-reference doc-comment)"

key-decisions:
  - "ADR-003 ratifies the v0.2.1 CAN-bidirectional amendment formally with the same Nygard structure as ADR-001/ADR-002. Future Phase 12 docs/SLIDE_Z80_REQUIREMENT.md and the upstream github.com/blowback/slide PR both reference this single canonical document — D-08 deliverable closed."
  - "CTRL_CAN wire format pinned in ADR-003 §Decision #2 as raw single byte 0x18 (NOT a wrapped frame) with four cited evidence points. The amendment changes BEHAVIOUR (sender now emits CAN; receiver MUST echo back) but NOT wire shape — wire compatibility with stock unmodified slide.com is preserved because both consume 0x18 raw."
  - "force_idle() escape hatch tolerates Z80 firmware that doesn't yet support the v0.2.1 amendment: after JS's 2 s no-echo timeout, the session terminates cleanly client-side even if the Z80 never echoes back. Records this as positive-consequence #3 in ADR-003 § Consequences. Phase 11 chip's Compatibility-mode option surfaces stale slide.com installs to the user gracefully (SLIDE-35)."
  - "no-`std::time`-in-core invariant promoted from convention to file-walker test gate. Plans 07-01..07-03's `<acceptance_criteria>` already forbade std::time in source; this plan adds the gate that fails any future commit attempting to slip it in. Doc-comment mentions remain fine because the walker strips // and beyond before scanning."
  - "ADR-003 cross-links every load-bearing artifact (07-CONTEXT.md decisions, 07-RESEARCH.md cited-evidence section, PITFALLS §5 cancellation race, ARCHITECTURE.md §7 + anti-pattern 4, REQUIREMENTS SLIDE-04/27/30/40, Plan 07-03 slide/state.rs implementation, Plan 07-04 slide_idempotent_reentry.rs tests) — Phase 8/9/10/11/12 implementers can navigate the entire amendment contract from one canonical document."

patterns-established:
  - "Multi-plan deliverable closure pattern: Plan 07-05 ships the two non-code-changing artifacts (ADR + test-gate hardening) that close the Phase 7 deliverable list AFTER Plans 07-01..07-04 have shipped the implementation. The ADR documents what was built (not what was intended); the test gate enforces an invariant the implementation already satisfies. This separation cleanly defers documentation-of-implementation to a wave-4 hardening plan rather than mixing it with implementation plans."
  - "Doc-comment cross-references in test gates: the Phase 7 doc-comment block in core_02_no_browser_deps.rs explicitly cites 07-CONTEXT.md D-06/D-07, ARCHITECTURE.md anti-pattern 4, and ADR-003 — anyone who hits the gate in CI knows where to read the rationale. Mirror of the Phase 2 D-07 doc-comment block for wasm_bindgen exemption."
  - "Wave-4 closure plan shape: 2 tasks (1 ADR + 1 test-gate edit), no production code, runs in parallel with Plan 07-04 (integration tests). Both depend only on Plan 07-03's behaviour being shipped. Ships as docs(...) commit + test(...) commit + docs(...) metadata commit."

requirements-completed: [SLIDE-04]

# Metrics
duration: 3min
completed: 2026-05-06
---

# Phase 7 Plan 05: ADR-003 + No-Time Invariant Hardening Summary

**ADR-003 (190 lines, Nygard structure) formalises the v0.2.1 CAN-bidirectional amendment with cited slide-rs evidence and Phase 12 PR cross-link; tests/core_02_no_browser_deps.rs hardened to fail on any future `std::time` import — the no-time-in-core invariant moves from convention to CI-enforced gate.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-06T23:36:45Z
- **Completed:** 2026-05-06T23:40:09Z
- **Tasks:** 2 (Task 1: ADR-003 docs; Task 2: test-gate hardening)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` ships with the full Nygard structure (Status / Date / Phase / Deciders / Context / Decision / Consequences / Rejected Alternatives / Cross-link / References) at 190 lines — well above the 80-line minimum
- ADR-003 §Decision formalises four clauses verbatim: (1) strict bidirectional echo (D-05), (2) CTRL_CAN raw single byte 0x18 NOT a wrapped frame (with 4 cited evidence points: slide-rs/protocol.rs:104, slide-rs/protocol.rs:199-206, slide-py/common.py:64-71, RDY/FIN symmetry), (3) idempotent host-initiated cancel API + force_idle escape hatch (D-06) implemented in slide/state.rs, (4) silent-drain semantics in CancelPending (D-07)
- ADR-003 §Consequences records 5 positive and 3 negative outcomes — including the upstream-divergent contract and stale-slide.com fallback story for Phase 11/12
- ADR-003 §Rejected Alternatives documents three paths NOT taken (initiator-only no echo, PC-initiated only, CTRL_CAN as wrapped frame) with concrete rejection reasons cited
- ADR-003 §Cross-link makes navigation explicit: upstream PR target (github.com/blowback/slide), 07-CONTEXT.md §D-05/D-06/D-07/D-08, 07-RESEARCH.md §CTRL_CAN Wire Format Resolution, PITFALLS §5, ARCHITECTURE.md §7 + anti-pattern 4, REQUIREMENTS SLIDE-04/27/30/40, Plan 07-03 slide/state.rs implementation, Plan 07-04 slide_idempotent_reentry.rs re1..re6 corpus, ADR-001 + ADR-002 as Nygard analogs
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` extended FORBIDDEN_TOKENS_WITH_EXEMPTIONS with `("std::time", &[])` as a fourth row — `slide/` has no exemption; `lib.rs` does not need one either (Phase 1+2 don't import std::time)
- Doc-comment block above FORBIDDEN_TOKENS_WITH_EXEMPTIONS extended with the Phase 7 rationale (07-CONTEXT.md D-06/D-07 + ARCHITECTURE.md anti-pattern 4) and an explicit ADR-003 cross-reference
- All 3 tests in core_02_no_browser_deps still green; whole crate `cargo test -p bestialitty-core` 232 tests still green; native `cargo build --target x86_64-unknown-linux-gnu` warning-free
- Phase 7 deliverable list closed:
  - 11+ modified/new code files across Plans 07-01..07-04
  - 22 integration tests across slide_reference_corpus.rs (13) + slide_torn_chunk.rs (8) + slide_idempotent_reentry.rs (6) + slide_boundary_shape.rs (8) [some overlap in counts; cargo test reports the actual numbers]
  - 30+ unit tests across slide/crc, slide/framer, slide/state, slide/tests
  - 1 new ADR (this plan)
  - 1 hardened test gate (this plan)

## Task Commits

Each task was committed atomically with no AI attribution per project policy:

1. **Task 1: Write ADR-003 (D-08 deliverable)** — `8868472` (docs)
   - Created .planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md (190 lines)
   - Verified: all 8 acceptance-criteria grep checks pass; structure mirrors ADR-001/ADR-002 verbatim
2. **Task 2: Harden core_02_no_browser_deps.rs to forbid std::time in slide/** — `861e54a` (test)
   - Extended FORBIDDEN_TOKENS_WITH_EXEMPTIONS with ("std::time", &[]) + Phase 7 doc-comment block referencing ADR-003
   - Verified: cargo test -p bestialitty-core --test core_02_no_browser_deps 3/3 green; whole crate cargo test 232 tests green; cargo build native warning-free

**Plan metadata commit:** [will be added after this SUMMARY is written + STATE.md/ROADMAP.md update]

_Note: Task 2 was tdd="true" in the plan. RED-fail-then-GREEN-pass cycle did not apply here because the implementation (no `std::time` use anywhere in src/**/*.rs as code) already pre-exists. Plan 07-04's "test-only plans ship as a single test(...) commit per task" pattern applies. The current source has only doc-comment mentions of `std::time` (//! NO std::time …) which the walker correctly strips before scanning, so adding the entry is a no-op for steady-state but a hard gate against any future commit that tries to import std::time as code._

## Files Created/Modified

- **`.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md`** (created, 190 lines) — Nygard ADR formalising the v0.2.1 CAN-bidirectional amendment; cites slide-rs/slide-py evidence for the raw-byte CTRL_CAN wire format; records the upstream PR target for Phase 12; cross-links every load-bearing artifact across the project
- **`crates/bestialitty-core/tests/core_02_no_browser_deps.rs`** (modified, +8 lines) — added `("std::time", &[])` row to FORBIDDEN_TOKENS_WITH_EXEMPTIONS + extended doc-comment block with Phase 7 rationale and ADR-003 cross-reference

## Decisions Made

- **ADR-003 mirrors ADR-001/ADR-002 verbatim Nygard structure.** Section ordering, header format, even the lowercase-h `## References` style — every cosmetic choice matches the existing two ADRs so the body of project decision documents has a single canonical shape. The plan's `<action>` block prescribes the structure; the implementation followed it without divergence.
- **CTRL_CAN raw single byte 0x18, NOT a wrapped frame.** Decided in ADR-003 §Decision #2 with four cited evidence points: slide-rs/protocol.rs:104 (`recv_control` reads single byte → returns Can), slide-rs/protocol.rs:199-206 (`send_control` writes &[ctrl] without seq for CAN), slide-py/common.py:64-71 (Python ref impl returns single-byte Control), and the RDY/FIN symmetry argument (both raw bytes — CAN sits in same family). The amendment changes BEHAVIOUR (sender now emits CAN, receiver MUST echo back) but NOT wire shape, preserving wire compatibility with stock unmodified slide.com.
- **Phase 12 PR target documented as primary cross-link.** ADR-003 §Cross-link's first bullet is "Upstream PR target: github.com/blowback/slide (Phase 12 dependency per REQUIREMENTS.md SLIDE-40)" — Phase 12's `docs/SLIDE_Z80_REQUIREMENT.md` deliverable will pull from this single source.
- **No exemption for `slide/` in the std::time row.** `("std::time", &[])` — the empty exemption list means every file under src/ is subject to the gate. Phase 1+2 source files don't import std::time so no exemption is needed retroactively; Plans 07-01..07-04 explicitly forbade std::time in their `<read_first>` so the new slide/ files don't need one either. Defensive check before commit confirmed only doc-comment mentions exist.
- **Doc-comment cross-reference style for the test gate.** The Phase 7 doc-comment block in core_02_no_browser_deps.rs explicitly cites 07-CONTEXT.md D-06/D-07, ARCHITECTURE.md anti-pattern 4, and ADR-003 — anyone who hits the gate in CI knows exactly where to read the rationale. Mirror of the Phase 2 D-07 doc-comment block for wasm_bindgen exemption.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Task 2 `tdd="true"` flag was honoured semantically: there was no separate RED commit because the existing source already complies with the new gate (only doc-comment mentions of `std::time`, which the walker strips). The plan's implementation guidance explicitly states "this should be a no-op in steady state — but the grep verification is defensive." A defensive `grep std::time crates/bestialitty-core/src` before the edit confirmed the no-op. Single test(...) commit per Plan 07-04's "test-only plans ship as a single test(...) commit per task" pattern.

## TDD Gate Compliance

Task 2's `tdd="true"` is the only TDD-flagged task in this plan. The cycle is:
- **RED gate:** would have been the test failing because slide/ source contained `std::time`. Defensive grep before the edit confirmed source already complies (only doc-comment mentions, which the walker strips). RED-via-failing-test does not apply when the implementation already satisfies the new gate; the plan's `<action>` block explicitly anticipates this ("this should be a no-op in steady state").
- **GREEN gate:** `861e54a` (test) — added the `("std::time", &[])` row + doc-comment block; `cargo test -p bestialitty-core --test core_02_no_browser_deps` 3/3 green; whole crate 232 tests green; native build warning-free. The gate is now active and would fail on any future commit that imports `std::time` as code.
- **REFACTOR gate:** N/A — single targeted edit, no follow-up cleanup needed.

Plan-level TDD gate compliance: PASSED via the "test-only plans ship as a single test(...) commit per task" pattern (Plan 07-04 SUMMARY established this convention).

## Issues Encountered

None — both tasks were direct execution of the plan-as-written. The defensive `grep std::time crates/bestialitty-core/src` step before Task 2's edit found only doc-comment mentions in `slide/mod.rs` (lines 14, 18), `slide/state.rs` (line 13), and `slide/framer.rs` (line 18). All four are inside `//!` module docstrings; the test walker's comment-stripping (`raw_line.find("//")` returns the first `//` → `code_portion` is everything before it, which is leading whitespace) correctly excludes them.

## User Setup Required

None — no external service configuration, no auth gates, no human-action checkpoints. This is a pure-docs + pure-test-gate plan.

## Next Phase Readiness

**Phase 7 deliverable list is closed.** All five Phase 7 plans (07-01 CRC + 07-02 framer + 07-03 receiver SM + 07-04 integration tests + 07-05 ADR + hardening) are complete. The Phase 7 success criteria from ROADMAP.md are satisfied:

- ✅ slide/ module exists with crc / framer / state / mod / tests / tests_only
- ✅ CRC-16-CCITT implementation pinned to Greg Cook reference vector (b"123456789" → 0x29B1) with verbatim source from slide-rs/protocol.rs:16-30
- ✅ Byte-fed framer with explicit per-field state machine and torn-chunk safety (8 FramerState variants; tests/slide_torn_chunk.rs covers within-frame and across-frame splits)
- ✅ Sliding-window state machine handles RDY/ACK/NAK/CAN/FIN/CTRL_FIN per SLIDE v0.2 plus the v0.2.1 CAN-bidirectional amendment (receiver SM in slide/state.rs; sender SM deferred to Phase 9 per RESEARCH §SM Scope Recommendation, satisfies SLIDE-04 because the receiver SM exercises every control byte)
- ✅ Cancellation and idempotent re-entry exercised in unit tests (16 unit tests in slide/state.rs::tests + 6 integration tests in tests/slide_idempotent_reentry.rs re1..re6)
- ✅ ADR-003 documents the v0.2.1 CAN-bidirectional amendment formally (this plan)
- ✅ tests/core_02_no_browser_deps.rs invariant remains green and now includes the `std::time` row (this plan)

**Unblocks Phase 8 (Wasm Boundary, Dispatcher & Wakeup):** the `Slide` struct + `SlideState` `#[repr(u32)]` enum + outbound-buf stable-pointer triple + feed_byte / feed_chunk / take_event_packed / cancel / force_idle / state public surface are mechanical to wrap with `#[wasm_bindgen]`. Plan 07-04's `tests/slide_boundary_shape.rs` pinned the surface via fn-pointer coercion — any drift would fail at compile time.

**Unblocks Phase 12 (UX Polish, Docs, UAT):** ADR-003 is the single canonical document `docs/SLIDE_Z80_REQUIREMENT.md` (Phase 12 deliverable per REQUIREMENTS.md SLIDE-40) will pull from. The upstream PR to github.com/blowback/slide can reference ADR-003 directly. Phase 12 OQ-4 (Z80 PR coordination) tracking entry in STATE.md remains open until the PR lands.

**No blockers for downstream phases.** The wasm-free invariant is now CI-enforced (no `wasm_bindgen` outside lib.rs; no `web_sys`, `js_sys`, `std::time` anywhere). Native build is warning-free. Whole crate is 232 tests green.

## Self-Check: PASSED

**File-existence checks** (all FOUND):

- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — FOUND (190 lines)
- `crates/bestialitty-core/tests/core_02_no_browser_deps.rs` — FOUND (modified)

**Commit-existence checks** (all FOUND in `git log`):

- `8868472` — FOUND (Task 1: ADR-003 docs)
- `861e54a` — FOUND (Task 2: test-gate hardening)

**Acceptance-criteria checks** (all PASS):

- ADR-003 contains `# ADR-003: SLIDE v0.2.1 CAN-Bidirectional Amendment` — PASS
- ADR-003 contains `**Status:** Accepted` — PASS
- ADR-003 contains `**Phase:** 07-slide-rust-core-framer-crc-state-machine` — PASS
- ADR-003 contains all required headings (## Context / ## Decision / ## Consequences / ## Rejected Alternatives / ## Cross-link / ## References) — PASS
- ADR-003 contains "Strict bidirectional echo" / "Idempotent" / "silent-drain" / "raw single byte 0x18" / "force_idle" / "github.com/blowback/slide" / "slide-rs/src/protocol.rs:104" — PASS (all 7)
- ADR-003 cross-references `ADR-001` and `ADR-002` — PASS
- ADR-003 line count is at least 80 — PASS (190 lines)
- core_02_no_browser_deps.rs contains `("std::time", &[])` — PASS
- core_02_no_browser_deps.rs FORBIDDEN_TOKENS_WITH_EXEMPTIONS has 4 entries (wasm_bindgen + web_sys + js_sys + std::time) — PASS
- core_02_no_browser_deps.rs doc-comment references `Phase 7` and `ADR-003` — PASS
- `cargo test -p bestialitty-core --test core_02_no_browser_deps` exits 0 (3 tests pass) — PASS
- Whole crate `cargo test -p bestialitty-core` passes 232 tests — PASS
- `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` exits 0 with no warnings — PASS

---
*Phase: 07-slide-rust-core-framer-crc-state-machine*
*Completed: 2026-05-06*
