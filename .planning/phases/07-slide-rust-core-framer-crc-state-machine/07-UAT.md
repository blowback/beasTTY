---
status: complete
phase: 07-slide-rust-core-framer-crc-state-machine
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md]
started: 2026-05-07T00:00:00Z
updated: 2026-05-07T00:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Full crate test suite passes
expected: |
  `cargo test -p bestialitty-core` returns 232 tests passing across 12 binaries
  (lib + 11 integration test files). Phase 7 added: slide::crc::tests (3),
  slide::framer::tests (12), slide::state::tests (16), slide::tests (5 module
  smokes), slide_reference_corpus (13), slide_torn_chunk (8),
  slide_idempotent_reentry (6), slide_boundary_shape (8). All Phase 1+
  pre-existing tests still pass — no regressions.
result: pass

### 2. Native build is warning-free
expected: |
  `cargo build -p bestialitty-core --target x86_64-unknown-linux-gnu` exits 0
  with NO warnings. D-20 cross-target reuse invariant: the same crate that
  Phase 8 will compile to wasm must also build natively for cargo test. Any
  warning here would indicate either dead code, missing #[cfg(target_arch)]
  gating, or a slipped-in dev dependency.
result: pass

### 3. Zero-browser-deps + no-std::time invariant green
expected: |
  `cargo test -p bestialitty-core --test core_02_no_browser_deps` returns 3/3
  passing: cargo_toml_declares_cdylib_and_rlib, source_files_contain_no_wasm_attrs,
  dependency_graph_excludes_browser_crates. Phase 7 extended FORBIDDEN_TOKENS to
  include `std::time` (per ADR-003 — JS owns all timing). Any future commit
  that imports std::time::Instant or std::time::Duration in core source files
  will fail this gate.
result: pass

### 4. SLIDE reference corpus byte-for-byte equal slide-rs
expected: |
  `cargo test -p bestialitty-core --test slide_reference_corpus` returns 13/13
  passing. The 7 fixture frames (FIXTURE_HEADER_TEST_TXT, FIXTURE_SUBFRAME_HI,
  FIXTURE_EMPTY_SEQ_0, FIXTURE_EOF_SEQ_4, FIXTURE_ALL_FF_16, fixture_max_payload_aa,
  FIXTURE_SLIDE_RS_HELLO) plus CRC reference vector pin
  (`crc16_ccitt(b"123456789") == 0x29B1`) plus CRC scope tests prove byte-for-byte
  wire compatibility with /home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs's
  build_frame output. Cross-tool drift would surface here first.
result: pass

### 5. ADR-003 exists with Nygard structure
expected: |
  `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` exists, ~190 lines,
  with Nygard headings (Status, Context, Decision, Consequences) mirroring
  ADR-001 / ADR-002. Documents D-05 strict bidirectional CAN echo, D-06
  idempotent cancel + force_idle escape hatch, D-07 silent drain in CancelPending,
  CTRL_CAN raw-byte 0x18 wire format with 4 evidence citations from slide-rs,
  and links to upstream github.com/blowback/slide PR placeholder. This is the
  D-08 deliverable closing Phase 7's documentation surface.
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
