---
phase: 10-slide-receiver-cancellation
plan: 05
subsystem: tests
tags:
  - playwright
  - e2e
  - mock-serial
  - slide-bot
  - sender-role
  - verification
  - human-uat
  - traceability

# Dependency graph
requires:
  - phase: 10-slide-receiver-cancellation/10-01
    provides: 6 RED-gate Playwright spec stubs + slide_recv_corpus.rs hand-built fixtures (cross-validation contract — bot wire bytes must equal corpus bytes per PITFALLS §13)
  - phase: 10-slide-receiver-cancellation/10-02
    provides: window.__slideRecv (__resetForTests / __getStateForTests / hasHandle / handleName), 8 wasm forwards (recv_ptr/recv_len/clear_recv triple + recv_filename triple + recv_file_size + recv_current_file_idx), idb.js + prefs.slideRecvToFolder DEFAULT
  - phase: 10-slide-receiver-cancellation/10-03
    provides: window.__slide.cancelRecv + window.__slide.isActive + ADR-003 §3 5-step CTRL_CAN sequence + slide.js dispatchRecvMode mid-session ESC^SLIDE re-entry matcher + Esc-disambiguation chain slot
  - phase: 10-slide-receiver-cancellation/10-04
    provides: Settings DOM (#slide-recv-folder-row + #slide-recv-to-folder-checkbox + #slide-recv-folder-button + #slide-recv-folder-status + #slide-recv-folder-help), pickFolder click flow, COPY frozen object verbatim strings
  - phase: 09-slide-sender-host-z80-send/09-04
    provides: mock-serial-slide-bot.js receiver-role state machine + verbatim setup template (page.addInitScript SERIAL_MOCK + MOCK_SERIAL_SLIDE_BOT + beforeEach reset block)
provides:
  - mock-serial-slide-bot.js sender-role state machine (FOURTH independent SLIDE implementation per PITFALLS §13)
  - 24 Phase 10 Playwright tests filling every Plan 10-01 RED-gate stub (across 6 spec files)
  - 10-HUMAN-UAT.md daily-driver UAT scaffold with 6 manual checks
  - REQUIREMENTS.md flips: SLIDE-18..24, 27, 29, 30, 34 traceability rows Pending -> Complete + SLIDE-19 top-level checkbox flipped + SLIDE-20 collision-exception annotation
  - deferred-items.md: 2 out-of-scope pre-existing items logged for future plans
affects:
  - phase 11-slide-js-bridge (chip + lifecycle wiring will reuse the mock-bot sender role for chip-render assertions; PITFALLS §13 four-leg discipline carries forward)
  - phase 12-slide-uat (real-hardware UAT extends the 6 mock-bot UAT items with on-Z80 verification; UAT-10-01 explicitly marks the real-hardware item)

# Tech tracking
tech-stack:
  added: []   # no new dependencies; reuses Playwright + Phase 9 mock-bot infrastructure
  patterns:
    - "Mock-bot role gate: bot.role = 'recv' | 'send' switches at the top of onInboundByte before any role-specific state-machine logic runs; reset() clears both role-specific state blocks; setRole(r) is the single switch point"
    - "Sender-role byte flow mirrors slide-rs/send.rs:155-249 verbatim — buildSlideFrame helper (CRC-16-CCITT scope = SEQ + LEN_HI + LEN_LO + PAYLOAD), buildSlideHeaderFrame helper (name + null + size_le_u32), shipNextHeader / shipDataWindow / handleAck / handleNak control flow"
    - "PITFALLS §13 four-leg discipline operationalised: production Rust SM <-> Plan 10-01 Rust corpus fixtures <-> Phase 9 JS mock recv-bot <-> Phase 10 JS mock send-bot; CRC-16-CCITT JS port self-tested against Phase 7 SLIDE-03 reference vector 0x29B1 for b'123456789'"
    - "Spec setup template (verbatim from Phase 9 P-04 slide-sender.spec.js): page.addInitScript(SERIAL_MOCK) + page.addInitScript(MOCK_SERIAL_SLIDE_BOT) + page.goto('/') + #terminal-wrapper.focus() + #connection.open=true + connect-button.click() + expect.poll on _grantedPorts[0]._reader + __slide.__resetForTests + __slideRecv.__resetForTests + __mockWriterLog.length=0 + bot.reset() + bot.setRole('send')"
    - "FSAP picker stub: page.addInitScript injects window.showDirectoryPicker that returns a fake FileSystemDirectoryHandle with _files Map (collision tracking) + _writeLog ([{ name, bytes }]) + queryPermission/requestPermission stubs driven by window.__pickerStub mutable settings"
    - "Memory smoke methodology (Pitfall 7): take 3 samples of performance.memory.usedJSHeapSize delta around the recv; assert minimum delta < 5x file size — minimum-of-3 + 5x slack absorbs scrollback / GC noise"
    - "Force_idle escape hatch test asserts BOTH lower bound (>= 1900 ms confirms wait happened) AND upper bound (<= 2500 ms confirms didn't hang) — anti-flake against optimistic / pessimistic timer drift"

key-files:
  created:
    - .planning/phases/10-slide-receiver-cancellation/10-HUMAN-UAT.md (6 daily-driver UAT checks)
    - .planning/phases/10-slide-receiver-cancellation/deferred-items.md (2 out-of-scope items logged)
    - .planning/phases/10-slide-receiver-cancellation/10-05-SUMMARY.md (this file)
  modified:
    - www/tests/transport/mock-serial-slide-bot.js (sender-role state machine + CRC-16-CCITT JS port + buildSlideFrame + buildSlideHeaderFrame + shipNextHeader + shipDataWindow + handleAck + handleNak + setRole + queueSendFiles + startSendSession + pushSlideHostWakeup; role gate at top of onInboundByte; bot.reset() clears both role state blocks)
    - www/tests/transport/slide-recv.spec.js (7 tests: SLIDE-18 anchor-click, SLIDE-19 250ms inter-file gap, SLIDE-20 filename verbatim, SLIDE-21 zero-byte, SLIDE-22 sub-frame, SLIDE-23 binary, SLIDE-24 1MB+ memory smoke)
    - www/tests/transport/slide-cancel.spec.js (6 tests: SLIDE-27 Esc cancel, SLIDE-30 programmatic + idempotent, cancel timing windows, force_idle escape hatch, SLIDE-29 hard-fail recovery)
    - www/tests/transport/slide-recv-reentry.spec.js (2 tests: SLIDE-34 mid-session ESC^SLIDE re-entry, SLIDE-29 3-mode convergence)
    - www/tests/transport/slide-recv-settings.spec.js (3 tests: toggle (a)->(b)->(c), persistence handle + prefs flag, queryPermission denied -> state d)
    - www/tests/transport/slide-recv-fsap.spec.js (4 tests: createWritable write path, ~1 collision, 3-file collision cascade ~1/~2/~3, ~999 budget exhaustion fall-through)
    - www/tests/transport/slide-recv-e2e.spec.js (2 tests: 3-file batch byte-identical round-trip, CRC-16-CCITT self-check 0x29B1)
    - .planning/REQUIREMENTS.md (SLIDE-19 top checkbox flipped + 11 traceability rows flipped Pending -> Complete + SLIDE-20 collision-exception annotation)
  deleted:
    - www/tests/transport/_dbg.spec.js (debug artifact from previous executor's WIP — never committed)

key-decisions:
  - "CRC-16-CCITT (CCITT-FALSE) JS port verbatim from Phase 7 SLIDE-03 — poly 0x1021, init 0xFFFF, no reflect, no XOR-out; reference vector b'123456789' -> 0x29B1 self-tested in slide-recv-e2e.spec.js (caught at test boot, not buried mid-recv)"
  - "Sender-role state advances by inbound-byte interpretation: CTRL_RDY (single 0x11) -> shipNextHeader; CTRL_FIN (single 0x04) -> sessionDone; CTRL_CAN (single 0x18) -> echo + reset; CTRL_ACK + seq (2 bytes) -> handleAck; CTRL_NAK + seq (2 bytes) -> handleNak; sendInboundBuf accumulator drops on length > 2 to recover from unknown bytes"
  - "shipDataWindow ships up to WIN_SIZE=4 frames; EOF marker is empty data frame at seq=(last+1); zero-byte file emits immediate EOF at seq=1 (SLIDE-21 path)"
  - "Persistence test reads localStorage with expect.poll up to 2 s — savePrefs is debounced 250 ms (Phase 6 D-33); without poll the test races against the debounce flush. Documented as Rule 3 deviation."
  - "FSAP collision test escalates by reserving _files slots inside getFileHandle (create:true) BEFORE createWritable resolves — without this, ensureUnique probes never see the previous file because the handle wasn't observable until after close()"
  - "~999 budget exhaustion test pre-seeds 1000 file names (BUDGET.TXT + BUDGET~1.TXT through BUDGET~999.TXT); installs URL.createObjectURL spy AFTER pickFolder click so the click doesn't pollute the spy; asserts blob count + zero folder writes (anchor-click path took over)"
  - "E2E spec asserts byte-identical for 3-file batch covering edge cases: ZERO.TXT (SLIDE-21 zero-byte), SMALL.TXT (SLIDE-22 sub-frame text), BIN.COM (SLIDE-23 binary high bytes); plus CRC-16-CCITT self-check that detects mock-bot drift on the very first test run"
  - "REQUIREMENTS.md SLIDE-20 row carries explicit collision-exception annotation per CONTEXT D-07: 'Complete (verbatim except on filename collision -- ~N suffix per CONTEXT D-05/D-06; see 10-CONTEXT.md D-07)' so the verbatim contract isn't mis-read in isolation"
  - "Out-of-scope pre-existing log-download.spec.js filename mismatch (production: beastty- vs test: bestialitty-) logged to deferred-items.md DEF-10-01 per SCOPE BOUNDARY rule; NOT auto-fixed in 10-05"

patterns-established:
  - "Mock-bot role gate + dual-state-block reset pattern (10-05 / Phase 11 / Phase 12 chip tests will all reuse the same setRole + reset shape)"
  - "Spec test fixture for SLIDE recv: installBlobSpy hooks URL.createObjectURL + appendChild to capture both blob and anchor.download attribute in a single spy; capturedDownloads timestamp enables SLIDE-19 inter-file gap assertions"
  - "PICKER_STUB initScript pattern: window.__pickerStub mutable settings (queryPermissionResult / requestPermissionResult / preloadFiles / pickCount / handle) drive the fake FileSystemDirectoryHandle; tests mutate the settings before driving the recv flow; FSAP behaviour is fully introspectable via __pickerStub.handle._writeLog"
  - "Force_idle two-bound assertion (>= 1900 ms AND <= 2500 ms) — pattern reusable for any timeout-driven escape hatch test; lower bound proves the wait happened, upper bound proves the timeout fired"
  - "Mock-bot CRC self-test in e2e spec — Phase 7 SLIDE-03 reference vector 0x29B1 for b'123456789' is the canonical regression check; if it fails, every subsequent recv test will fail BestialiTTY's CRC validation; spec-level assertion catches mock-bot drift at test boot rather than mid-recv"

requirements-completed:
  - SLIDE-18
  - SLIDE-19
  - SLIDE-20
  - SLIDE-21
  - SLIDE-22
  - SLIDE-23
  - SLIDE-24
  - SLIDE-27
  - SLIDE-29
  - SLIDE-30
  - SLIDE-34

# Metrics
duration: ~50min (across 2 executor runs — original burned tokens at API overload mid-Task 3; continuation finished Task 3 + UAT + REQUIREMENTS + SUMMARY)
completed: 2026-05-08
---

# Phase 10 Plan 5: Receiver Verification Gate Summary

Filled 6 Playwright RED-gate spec stubs (24 tests across slide-recv +
slide-cancel + slide-recv-reentry + slide-recv-settings + slide-recv-fsap +
slide-recv-e2e); extended mock-serial-slide-bot.js with a sender-role state
machine (FOURTH independent SLIDE implementation per PITFALLS §13);
created 10-HUMAN-UAT.md daily-driver UAT scaffold with 6 manual checks; flipped
all 11 Phase 10 SLIDE requirements (SLIDE-18..24, 27, 29, 30, 34) Complete in
REQUIREMENTS.md.

## Counts

- **Phase 10 Playwright tests filled:** 24 (across 6 spec files)
  - slide-recv.spec.js: 7 (SLIDE-18..24)
  - slide-cancel.spec.js: 6 (SLIDE-27, SLIDE-29, SLIDE-30 + force_idle + cancel timing window + idempotent re-entry)
  - slide-recv-reentry.spec.js: 2 (SLIDE-34 mid-session re-entry, SLIDE-29 3-mode convergence)
  - slide-recv-settings.spec.js: 3 (toggle state machine, persistence, queryPermission denied)
  - slide-recv-fsap.spec.js: 4 (createWritable write, ~1 collision, ~1/~2/~3 cascade, ~999 budget exhaustion)
  - slide-recv-e2e.spec.js: 2 (3-file batch byte-identical, CRC self-check)
- **test.skip remaining:** 0 across all 6 specs
- **Cargo tests:** 283/283 (no Rust changes; baseline preserved)

## CRC-16-CCITT self-test

Mock bot's `crc16Ccitt(b'123456789')` returns `0x29B1` -- matches Phase 7
SLIDE-03 reference vector. Asserted directly in
slide-recv-e2e.spec.js:128 ("CRC-16-CCITT self-check"). Passing on first
run + on every subsequent run.

## 1 MB memory smoke methodology

`SLIDE-24` test in slide-recv.spec.js takes 3 samples of
`performance.memory.usedJSHeapSize` delta around the recv; asserts
minimum delta < 5x file size. Minimum-of-3 absorbs scrollback growth /
GC noise per Pitfall 7.

## force_idle escape hatch bounds

slide-cancel.spec.js force_idle test asserts BOTH:
- lower bound: elapsed >= 1900 ms (confirms force_idle waited the full
  2 s absolute timeout, didn't bail early)
- upper bound: elapsed <= 2500 ms (confirms the timeout actually
  fired and the cancel sequence didn't hang)

## REQUIREMENTS.md flips (11 rows, 1 checkbox)

| ID | Top-level checkbox | Traceability row |
|----|--------------------|------------------|
| SLIDE-18 | already `[x]` | Pending -> Complete |
| SLIDE-19 | `[ ]` -> `[x]` | Pending -> Complete |
| SLIDE-20 | already `[x]` | Pending -> Complete (verbatim except on filename collision -- ~N suffix per CONTEXT D-05/D-06; see 10-CONTEXT.md D-07) |
| SLIDE-21..24 | already `[x]` | Pending -> Complete |
| SLIDE-27 | already `[x]` | Pending -> Complete |
| SLIDE-29..30 | already `[x]` | Pending -> Complete |
| SLIDE-34 | already `[x]` | Pending -> Complete |

SLIDE-20 collision-exception annotation present per CONTEXT D-07 plan
acceptance criterion.

## 10-HUMAN-UAT.md (6 manual checks)

| ID | Check |
|----|-------|
| UAT-10-01 | Real-hardware Z80 cancel echo timing (SLIDE-27) |
| UAT-10-02 | FileSystemDirectoryHandle persistence across browser restart |
| UAT-10-03 | Settings toggle visual feel (locked copy + state machine) |
| UAT-10-04 | Toggle off keeps handle (no re-pick on re-toggle) |
| UAT-10-05 | Multi-download Chrome throttle threshold (SLIDE-19) |
| UAT-10-06 | 1 MB+ daily-driver UX feel (SLIDE-24) |

Mirrors 06-HUMAN-UAT.md / 09-HUMAN-UAT.md structure and tone. Out-of-band;
`/gsd-verify-phase 10` does NOT block on UAT sign-off.

## Commits

- a1a419e feat(10-05): extend mock-serial-slide-bot.js with sender-role state machine (Task 1)
- cc194a0 feat(10-05): fill RED-gate stubs in slide-recv/cancel/reentry specs (15 tests) (Task 2)
- c2fcf9d feat(10-05): fill recv-settings + recv-fsap + recv-e2e spec stubs (Task 3 main)
- 8e96b01 docs(10-05): add 10-HUMAN-UAT.md + flip 11 SLIDE requirements Complete (Task 3 docs)

## Deviations from Plan

### Rule 3 (blocking-issue auto-fix) -- savePrefs debounce in persistence test

- **Found during:** Task 3 (slide-recv-settings.spec.js initial run)
- **Issue:** Persistence test asserted `localStorage.bestialitty.prefs.slideRecvToFolder === true` synchronously, but savePrefs is debounced 250 ms (Phase 6 D-33). Test failed because the flush hadn't happened yet.
- **Fix:** Wrapped the localStorage assertion in `expect.poll` with a 2 s timeout so the test waits for the debounced flush.
- **Files modified:** www/tests/transport/slide-recv-settings.spec.js
- **Commit:** c2fcf9d

### Out-of-scope: Pre-existing log-download.spec.js filename mismatch

- **Found during:** Task 3 full Playwright suite verification
- **Issue:** 2 SESS-04/SESS-05 tests fail because production session-log.js emits `beastty-{stamp}.bin` but test asserts `bestialitty-{stamp}.bin`. Test/code mismatch from upstream Phase 6/7 — NOT caused by 10-05 changes.
- **Disposition:** Logged to deferred-items.md DEF-10-01 per SCOPE BOUNDARY rule (only auto-fix issues directly caused by current task's changes). NOT fixed in 10-05.
- **Commit:** 8e96b01 (deferred-items.md)

### Out-of-scope: slide-cancel timing window flake under heavy parallel load

- **Found during:** Task 3 full Playwright suite verification
- **Issue:** `cancel timing windows` test occasionally times out under `npx playwright test` full-suite parallelism (10 workers). Re-running with `--workers=2` gives 8/8 passing.
- **Disposition:** Logged to deferred-items.md flake-watch section. Threat T-10-flake-timer in 10-05-PLAN.md threat model anticipated this; current slack should suffice for normal runs.

## Threat Flags

None new -- all surfaces in 10-05-PLAN.md threat model accounted for.

## Self-Check: PASSED

- [x] mock-serial-slide-bot.js: `function crc16Ccitt` exists (1 occurrence)
- [x] mock-serial-slide-bot.js: `function buildSlideFrame` exists (1 occurrence)
- [x] mock-serial-slide-bot.js: `function buildSlideHeaderFrame` exists (1 occurrence)
- [x] All 6 spec files: 0 `test.skip` declarations
- [x] All 6 spec files: 24 tests pass in isolation (`npx playwright test slide-recv.spec.js slide-cancel.spec.js slide-recv-reentry.spec.js slide-recv-settings.spec.js slide-recv-fsap.spec.js slide-recv-e2e.spec.js` exits 0)
- [x] cargo test --workspace: 283 passing
- [x] 10-HUMAN-UAT.md exists with `## Tests` and 6 UAT-10-XX entries
- [x] REQUIREMENTS.md: 11 traceability rows flipped Complete; SLIDE-20 carries collision-exception annotation
- [x] _dbg.spec.js: deleted (no longer present)
- [x] Commits: a1a419e + cc194a0 + c2fcf9d + 8e96b01 all in `git log`
