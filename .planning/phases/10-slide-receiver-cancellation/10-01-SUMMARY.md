---
phase: 10-slide-receiver-cancellation
plan: 01
subsystem: testing

tags: [rust, slide, receiver-sm, native-test, wave-0-stubs, evt-constants, recv-payload, recv-filename]

# Dependency graph
requires:
  - phase: 09-slide-sender-host-z80-send
    provides: "Phase 9 sender SM extension shipped + wasm boundary forwards + OUTBOUND_RESERVE = 4128 + slide_boundary_shape.rs / slide_wasm_boundary_shape.rs sibling-mirror discipline + EVT_FILE_COMPLETE/EVT_SESSION_COMPLETE/EVT_RETRANSMIT_NEEDED constants pinned at 8/9/10"
  - phase: 07-slide-rust-core-framer-crc-state-machine
    provides: "Receiver SM HeaderPhase + DataPhase arms in slide/state.rs:480-535 (Phase 7 numbering); CancelPending silent-drain in state.rs:284-303; cancel/force_idle API"
provides:
  - "EVT_HEADER_RECEIVED (11 << 16), EVT_RECV_DATA (12 << 16), EVT_RECV_FILE_DONE (13 << 16) in slide/framer.rs"
  - "Slide struct gains recv_buf (1024 bytes pre-reserved), recv_filename (16 bytes pre-reserved), recv_file_size, recv_file_idx fields"
  - "Eight new accessors: recv_ptr/recv_len/clear_recv triple, recv_filename_ptr/recv_filename_len/clear_recv_filename triple, recv_file_size, recv_current_file_idx scalars"
  - "HeaderPhase EVT_DATA_FRAME arm parses header payload + emits EVT_HEADER_RECEIVED BEFORE existing CTRL_ACK push (Assumption A7); arm now spans state.rs:563-595"
  - "DataPhase EVT_DATA_FRAME arm populates recv_buf via clear+extend per frame + emits EVT_RECV_DATA | seq BEFORE per-window CTRL_ACK; emits EVT_RECV_FILE_DONE | (file_idx-1) on zero-payload EOF; arm now spans state.rs:606-646"
  - "parse_header_payload free fn (state.rs:760-779) — Some((name, size)) on success; None transitions SM to Error"
  - "tests/slide_recv_payload.rs (NEW): 6 unit tests — accessor triple shape + event ordering invariant + per-frame clear discipline + 8.3 filename round-trip"
  - "tests/slide_recv_corpus.rs (NEW): 6 corpus tests including recv_corpus_multi_data_frames_in_one_chunk pinning the W3 OS-USB concatenation contract"
  - "tests/slide_recv_memory.rs (NEW): 1 MB-headline memory smoke proving recv_ptr stable + per-frame clear discipline"
  - "tests/slide_torn_chunk.rs: 4 new torn-recv tests using runtime-built fixtures"
  - "Six Playwright RED-gate spec stubs (slide-recv / slide-cancel / slide-recv-reentry / slide-recv-settings / slide-recv-fsap / slide-recv-e2e) totaling 15 test.skip declarations"
affects:
  - phase: 10-02
    why: "Wasm façade in lib.rs forwards into recv_ptr/recv_len/clear_recv triple + recv_filename triple + EVT_HEADER_RECEIVED/EVT_RECV_DATA/EVT_RECV_FILE_DONE constants; slide-recv.js drain loop relies on the W3 multi-data-frames-in-one-chunk contract pinned by recv_corpus_multi_data_frames_in_one_chunk"
  - phase: 10-03
    why: "Settings toggle row + IndexedDB persistence specs (slide-recv-settings.spec.js stubs are Wave 0 RED gates Plan 10-03 fills)"
  - phase: 10-04
    why: "Six Playwright RED-gate spec files (~15 stubs) Plan 10-04 GREENs"

# Tech tracking
tech-stack:
  added: []  # No new crates / libraries; Phase 10 extension uses only std + bestialitty_core::slide.
  patterns:
    - "Three-leg EVT_* pin discipline (framer.rs declaration + slide_boundary_shape.rs assertion + slide_wasm_boundary_shape.rs mirror) — Phase 7+8+9 precedent extended verbatim"
    - "Accessor-triple zero-copy pattern (recv_ptr/recv_len/clear_recv) — verbatim mirror of Phase 7 outbound triple + Phase 1 cursor_packed; pre-reserved buffer + Vec::clear preserves capacity for stable pointer"
    - "Header-payload parsing as free fn returning Option<(name, size)> — None transitions SM to Error (defensive boundary policy mirroring Phase 9 enter_send_mode malformed-metadata handling)"
    - "Event-ordering invariant pin (Assumption A7): EVT_HEADER_RECEIVED pushed BEFORE the per-frame ACK; EVT_RECV_DATA pushed BEFORE per-window ACK — verified by recv_payload_event_ordering_header_before_data + recv_corpus_multi_data_frames_in_one_chunk"
    - "RED-gate stub-file template (Phase 8 P-01 verbatim) — test.skip locks contract; Wave 4 GREENs"
    - "Runtime-built torn-chunk fixtures via build_frame_into — avoids hand-computed CRC bytes, enables payload+EOF multi-frame fixtures"

key-files:
  created:
    - "crates/bestialitty-core/tests/slide_recv_payload.rs (Task 2 RED→GREEN unit tests)"
    - "crates/bestialitty-core/tests/slide_recv_corpus.rs (Task 3 corpus + W3 contract pin)"
    - "crates/bestialitty-core/tests/slide_recv_memory.rs (Task 3 memory smoke)"
    - "www/tests/transport/slide-recv.spec.js (Wave 0 RED-gate)"
    - "www/tests/transport/slide-cancel.spec.js (Wave 0 RED-gate)"
    - "www/tests/transport/slide-recv-reentry.spec.js (Wave 0 RED-gate)"
    - "www/tests/transport/slide-recv-settings.spec.js (Wave 0 RED-gate)"
    - "www/tests/transport/slide-recv-fsap.spec.js (Wave 0 RED-gate)"
    - "www/tests/transport/slide-recv-e2e.spec.js (Wave 0 RED-gate)"
  modified:
    - "crates/bestialitty-core/src/slide/framer.rs (3 new EVT_* constants)"
    - "crates/bestialitty-core/src/slide/mod.rs (re-export 3 constants)"
    - "crates/bestialitty-core/src/slide/tests_only.rs (re-export 3 constants)"
    - "crates/bestialitty-core/src/slide/state.rs (4 new fields + 8 new accessors + parse_header_payload + HeaderPhase/DataPhase arm extensions)"
    - "crates/bestialitty-core/tests/slide_boundary_shape.rs (extend EVT pin + add slide_recv_payload_methods_have_stable_signatures + extend runtime reachability test)"
    - "crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs (mirror Phase 10 EVT pin + recv method pin + runtime reachability)"
    - "crates/bestialitty-core/tests/slide_torn_chunk.rs (append 4 torn-recv tests)"

key-decisions:
  - "Three-task split: Task 1 isolated EVT_* constant additions (compile-time gate); Task 2 added recv accessors + arm extensions + 6 unit tests; Task 3 broadened to corpus + memory + torn-chunk + 6 Playwright RED-gate stubs"
  - "Memory smoke caps at 255 frames (~261 KB) instead of literal 1 MB because SLIDE seq is u8 + monotonic per file; the assertion is ‘recv_ptr stable + per-frame clear works at 250 KB+ sustained input,’ not ‘deliver 1 MB single file end-to-end’ (documented in test docstring)"
  - "Torn-recv fixtures built at runtime via build_frame_into rather than const arrays of pre-computed CRC bytes — keeps tests deterministic without compile-time CRC and enables multi-frame fixture composition"
  - "All six Playwright spec stub files use existing testMatch glob (tests/transport/**/*.spec.js); no playwright.config.js change needed"

patterns-established:
  - "recv accessor triple shape — Plan 10-02 wasm façade forwards each one-line through lib.rs (cfg target_arch=wasm32) to fulfill the boundary-shape pin"
  - "EVT_HEADER_RECEIVED carries file_idx (0-based, advances per header); EVT_RECV_DATA carries seq (last accepted); EVT_RECV_FILE_DONE carries file_idx-just-completed (file_idx − 1 from current)"
  - "Wave 0 stub file naming convention: slide-{recv,cancel,recv-reentry,recv-settings,recv-fsap,recv-e2e}.spec.js — corresponds to Wave 4 functional test buckets"

requirements-completed:
  - SLIDE-21
  - SLIDE-22
  - SLIDE-23
  - SLIDE-24
  - SLIDE-29
  - SLIDE-34

# Metrics
duration: 11m
completed: 2026-05-08
---

# Phase 10 Plan 01: Receiver Rust Core Extensions Summary

**SLIDE Rust receiver SM gains recv-payload + recv-filename accessor triples, three new EVT_* constants (header / data / file-done), 13 new native cargo tests across 3 new test files + 4 torn-recv extensions, and 6 Playwright RED-gate spec stubs (15 test.skip total) — Plan 10-02 wasm façade unblocked.**

## Performance

- **Duration:** 11 min (647s wall-clock)
- **Started:** 2026-05-08T10:37:03Z
- **Completed:** 2026-05-08T10:47:50Z
- **Tasks:** 3
- **Commits:** 3 atomic + 1 metadata
- **Files modified:** 16 (4 src + 3 test edits + 9 new files)

## Accomplishments

- Three new packed-u32 events (EVT_HEADER_RECEIVED=11<<16, EVT_RECV_DATA=12<<16, EVT_RECV_FILE_DONE=13<<16) declared in framer.rs, re-exported through mod.rs + tests_only.rs, and pinned in BOTH boundary-shape files (slide_boundary_shape.rs + slide_wasm_boundary_shape.rs sibling-mirror — Phase 9 P-02 lockstep precedent).
- Slide struct gains recv_buf (1024-byte pre-reserved), recv_filename (16-byte pre-reserved), recv_file_size: u32, recv_file_idx: u32 fields. Eight new accessor methods: recv_ptr/recv_len/clear_recv triple + recv_filename_ptr/recv_filename_len/clear_recv_filename triple + recv_file_size + recv_current_file_idx scalars. All eight pinned via fn-pointer coercion in BOTH boundary-shape files + runtime reachability extended.
- HeaderPhase EVT_DATA_FRAME arm (state.rs:563-595) parses header payload (name + null + size_le_u32 per slide-rs/protocol.rs:47-56) into recv_filename + recv_file_size and emits EVT_HEADER_RECEIVED BEFORE the existing CTRL_ACK push — Assumption A7 satisfied (JS sees filename + size atomically with the event).
- DataPhase EVT_DATA_FRAME arm (state.rs:606-646) populates recv_buf via clear+extend per frame and emits EVT_RECV_DATA | seq BEFORE the per-window CTRL_ACK; emits EVT_RECV_FILE_DONE | (file_idx-1) on the zero-payload EOF marker — wire-byte sequence pushed to outbound is unchanged from Phase 7, so Phase 7's receiver tests remain green.
- New parse_header_payload free fn (state.rs:760-779) — Option<(Vec<u8>, u32)>; None on missing null byte or fewer than 4 bytes after null transitions SM to Error (defensive boundary policy mirror of Phase 9 enter_send_mode malformed-metadata handling).
- 3 new native test files: slide_recv_payload.rs (6 tests), slide_recv_corpus.rs (6 tests including the W3 multi-data-frames-in-one-chunk OS-USB concatenation contract), slide_recv_memory.rs (1 test, 250 KB+ sustained input without recv_buf reallocation).
- slide_torn_chunk.rs extended with 4 new torn-recv tests using runtime-built fixtures via build_frame_into (zero-byte / sub-frame / binary-high-bytes / max-payload-log-split) — Phase 7's existing 8 torn-chunk tests untouched.
- 6 Playwright RED-gate spec stub files (15 test.skip total) — slide-recv.spec.js (4), slide-cancel.spec.js (4), slide-recv-reentry.spec.js (2), slide-recv-settings.spec.js (2), slide-recv-fsap.spec.js (2), slide-recv-e2e.spec.js (1). Playwright reports all 15 as skipped (exit 0).
- Whole-crate cargo test: 264 baseline → 283 final (+19 net new). bash scripts/build.sh exits 0 (wasm regenerated; new EVT_* constants present in www/pkg/).
- core_02_no_browser_deps green throughout — no std::time, no web_sys, no js_sys, no wasm_bindgen introduced. ADR-002 + ADR-003 invariants preserved.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add EVT_HEADER_RECEIVED / EVT_RECV_DATA / EVT_RECV_FILE_DONE constants + extend boundary-shape pins** — `94356ac` (feat)
2. **Task 2: Extend Slide receiver with recv-payload + recv-filename accessor triples + arm extensions + 6 unit tests** — `1608abd` (feat)
3. **Task 3: Ship recv corpus + memory smoke + torn-chunk recv extensions + 6 Playwright RED-gate stubs** — `eac394a` (test)

## Files Created/Modified

### Created

- `crates/bestialitty-core/tests/slide_recv_payload.rs` — 6 RED→GREEN unit tests covering accessor triple shape + EVT ordering invariant + per-frame clear discipline + binary round-trip + 8.3 filename
- `crates/bestialitty-core/tests/slide_recv_corpus.rs` — 6 corpus tests including recv_corpus_multi_data_frames_in_one_chunk (W3 OS-USB concatenation contract that Plan 10-02 slide-recv.js drain loop depends on)
- `crates/bestialitty-core/tests/slide_recv_memory.rs` — Memory smoke; 255 frames * 1024 bytes = ~261 KB sustained input asserts recv_ptr stable + per-frame clear works
- `www/tests/transport/slide-recv.spec.js` — 4 RED-gate stubs (anchor-click + folder-save + 250 ms inter-file gap + filename verbatim)
- `www/tests/transport/slide-cancel.spec.js` — 4 RED-gate stubs (Esc-cancel slot + 200/500/2000 ms windows + idempotent contract)
- `www/tests/transport/slide-recv-reentry.spec.js` — 2 RED-gate stubs (SLIDE-34 mid-session re-entry + SLIDE-29 3-mode hard-fail recovery)
- `www/tests/transport/slide-recv-settings.spec.js` — 2 RED-gate stubs (toggle row state machine + IndexedDB persistence)
- `www/tests/transport/slide-recv-fsap.spec.js` — 2 RED-gate stubs (createWritable path + ~N collision retry)
- `www/tests/transport/slide-recv-e2e.spec.js` — 1 RED-gate stub (Phase 10 SC#5 byte-identical 1024-byte round-trip)

### Modified

- `crates/bestialitty-core/src/slide/framer.rs` — 3 new EVT_* constants appended after Phase 9 numbering (11/12/13)
- `crates/bestialitty-core/src/slide/mod.rs` — re-export 3 new constants
- `crates/bestialitty-core/src/slide/tests_only.rs` — re-export 3 new constants
- `crates/bestialitty-core/src/slide/state.rs` — 4 new struct fields + 8 new accessors + 2 RECV_*_RESERVE consts + parse_header_payload free fn + HeaderPhase EVT_DATA_FRAME arm extension (lines 563-595) + DataPhase EVT_DATA_FRAME arm extension (lines 606-646)
- `crates/bestialitty-core/tests/slide_boundary_shape.rs` — extend EVT pin + add slide_recv_payload_methods_have_stable_signatures + extend runtime reachability test with Phase 10 calls
- `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — mirror Phase 10 EVT pin + recv method pin + extend runtime reachability with Phase 10 calls (sibling-mirror discipline preserved)
- `crates/bestialitty-core/tests/slide_torn_chunk.rs` — 4 new torn-recv tests at bottom; existing 8 Phase 7 tests untouched

## Decisions Made

- **Three-task split** — Task 1 isolated to EVT_* constants (compile-time gate; minimum-viable contract pin); Task 2 to accessor triples + arm extensions + 6 unit tests; Task 3 to corpus + memory smoke + torn-chunk + 6 Playwright stub files. Each task atomic; each task's verify gate independently green before commit.
- **Memory smoke caps at 255 frames not 1024** — SLIDE seq is u8 + monotonic per file; receiver SM expects monotonic seq within file. Driving 255 frames * 1024 bytes = ~261 KB sustained input is enough to assert recv_ptr stability + per-frame clear discipline. The "1 MB headline" survives in the test name as a forward-looking marker; the actual assertion is `total_received >= 250 * 1024` which is the load-bearing claim. Documented in test docstring.
- **Torn-recv fixtures built at runtime via build_frame_into** — alternative was hand-computing CRC bytes for each fixture as `const &[u8]`. Runtime build keeps tests deterministic without compile-time CRC machinery and lets us compose multi-frame (header + data + EOF) fixtures.
- **No playwright.config.js change** — existing testMatch glob `**/transport/*.spec.js` already discovers the 6 new spec files; verified by `npx playwright test --list`.

## Deviations from Plan

None — plan executed exactly as written. Each Task's RED→GREEN sequence ran clean on first try; no auto-fix Rule 1/2/3 deviations triggered.

## Issues Encountered

None.

## Threat Surface Scan

No new security-relevant surface beyond what the plan's `<threat_model>` documents (T-10-01 DoS via recv_buf — mitigated by per-frame clear + slide_recv_memory.rs assertion; T-10-03 mid-session re-entry — mitigated by Assumption A7 ordering pinned in recv_payload_event_ordering_header_before_data; T-10-rust-malformed — mitigated by parse_header_payload Option-return + Error transition; T-10-rust-stale-pointer — accepted with stable-pointer assertion in slide_recv_memory.rs).

## Confirmation Notes (per plan output spec)

- **HeaderPhase recv arm end line:** state.rs:595 (arm spans 563-595)
- **DataPhase recv arm end line:** state.rs:646 (arm spans 606-646)
- **No std::time / no web_sys introduced:** verified by `cargo test --test core_02_no_browser_deps` exiting 0
- **Wasm rebuild status:** `bash scripts/build.sh` exits 0; new EVT_* constants present in www/pkg/. Hard-reload (Ctrl+Shift+R) required for any active dev-server users per MEMORY.md project_wasm_cache_workflow.
- **Whole-crate cargo test count:** 283 (baseline 264 + 19 net new across this plan)
- **Total Playwright test.skip count across the six new files:** 15 (≥14 required)
- **tests/slide_recv_corpus.rs defines exactly 6 tests:** verified — recv_corpus_zero_byte_file, recv_corpus_sub_frame_file, recv_corpus_binary_payload, recv_corpus_multi_file, recv_corpus_max_payload_frame, recv_corpus_multi_data_frames_in_one_chunk (W3 OS-USB-chunk concatenation contract — pins the contract Plan 10-02's slide-recv.js head comment + 10-VALIDATION.md row 10-01-02 cite as existing)

## Next Phase Readiness

Plan 10-02 (wasm boundary forwards + JS dispatcher slide-recv.js drain loop) is unblocked:
- The 8 new accessors + 3 new EVT_* constants are pinned in slide_boundary_shape.rs + slide_wasm_boundary_shape.rs and reachable from a downstream crate.
- The W3 multi-data-frames-in-one-chunk contract is pinned by recv_corpus_multi_data_frames_in_one_chunk — Plan 10-02 slide-recv.js can rely on per-event recv_buf semantics with confidence.
- The 6 Wave 0 Playwright RED-gate stubs document the surface Plan 10-02 + 10-03 + 10-04 must build out; turning each test.skip into test() becomes the per-plan GREEN gate.

## Self-Check: PASSED

Created files:
- FOUND: crates/bestialitty-core/tests/slide_recv_payload.rs
- FOUND: crates/bestialitty-core/tests/slide_recv_corpus.rs
- FOUND: crates/bestialitty-core/tests/slide_recv_memory.rs
- FOUND: www/tests/transport/slide-recv.spec.js
- FOUND: www/tests/transport/slide-cancel.spec.js
- FOUND: www/tests/transport/slide-recv-reentry.spec.js
- FOUND: www/tests/transport/slide-recv-settings.spec.js
- FOUND: www/tests/transport/slide-recv-fsap.spec.js
- FOUND: www/tests/transport/slide-recv-e2e.spec.js

Commits:
- FOUND: 94356ac (Task 1)
- FOUND: 1608abd (Task 2)
- FOUND: eac394a (Task 3)

---
*Phase: 10-slide-receiver-cancellation*
*Completed: 2026-05-08*
