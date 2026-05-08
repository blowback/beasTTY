---
phase: 09-slide-sender-host-z80-send
fixed_at: 2026-05-07T19:30:00Z
review_path: .planning/phases/09-slide-sender-host-z80-send/09-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-05-07T19:30:00Z
**Source review:** `.planning/phases/09-slide-sender-host-z80-send/09-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning): 6
- Fixed: 6
- Skipped: 0
- Info findings (IN-01..IN-07): out of scope (advisory only)

All 264 Rust tests (`cargo test --workspace`) and 81 JS @fast tests
(`cd www && npm run test:fast`) pass after each commit.

## Fixed Issues

### CR-01: `Slide::enter_send_mode` panics on malformed metadata

**Files modified:** `crates/bestialitty-core/src/slide/state.rs`,
`crates/bestialitty-core/tests/slide_sender.rs`
**Commit:** 08c9c1e
**Applied fix:** Wrapped the length-prefixed metadata blob parse in a
`try_parse` helper that returns `Option<Vec<FileMeta>>`. On any
out-of-bounds slice (truncated buffer, name_len overrunning
`metadata.len()`, usize add-overflow on 32-bit targets, file_count
larger than the buffer can support), `enter_send_mode` transitions the
SM to `SlideState::Error` with no role swap and no `CTRL_RDY` pushed
onto `outbound_buf` — matching the `encode_key_raw` boundary policy at
`lib.rs:312-320` (RESEARCH Pitfall #4: never panic across the wasm FFI
boundary; abort-traps wedge the wasm instance until page reload).
Added 5 corpus entries to `tests/slide_sender.rs` covering: empty
buffer, truncated-after-count, name_len overruns buffer (`u32::MAX`),
truncated second record, truncated size field. Dropped the now-unused
`read_le_u32` helper.

### WR-01: NAK retransmit re-feeds a single seq, not the window

**Files modified:** `www/transport/slide.js`
**Commit:** 151a799
**Applied fix:** Rewound `currentSendCtx.sentBytesInFile` to the NAKed
seq's chunk start in the `EVT_RETRANSMIT_NEEDED` handler (option (b)
from the review). The pump cycle later in the same `dispatchSendMode`
invocation resumes from the rewound cursor and walks forward through
every remaining frame in the window, mirroring
`slide-rs/send.rs:194-208`'s window-rewind contract. Per-frame seq
accounting stays consistent with the Rust SM's `current_seq` reset at
`state.rs:392-394`; we deliberately do not call `feed_send_chunk` here
— the natural pump cycle handles each frame.

### WR-02: `enterSendMode` silently drops auto-type bytes when `owner === 'slide'`

**Files modified:** `www/input/file-source.js`, `www/transport/slide.js`
**Commit:** af35f83 (combined with WR-03 + WR-05)
**Applied fix:** Extended `updateButtonState` in `file-source.js` to
treat `mode === 'recv'` as session-active so the button is disabled
during inbound recv. Added a defense-in-depth check at the top of
`enterSendMode` in `slide.js` that refuses to queue a send when the
wire is owned by an active SLIDE session (`getWireOwner() !==
'terminal'`). The defensive check catches programmatic callers
(`window.__slide.enterSendMode`) that bypass the button gate.

### WR-03: `[↑ Send file]` is enabled before a writer is registered

**Files modified:** `www/input/tx-sink.js`, `www/main.js`,
`www/input/file-source.js`, `www/transport/slide.js`
**Commit:** af35f83 (combined with WR-02 + WR-05)
**Applied fix:** Added `isWriterReady()` accessor to `tx-sink.js` (also
exposed on `window.__txSink` for tests). Wired it through `main.js`
into `wireFileSource` opts. `updateButtonState` in `file-source.js` now
disables the button when no writer is registered, with a distinct
"Connect to a serial port first" tooltip. Added a defense-in-depth
check at the top of `enterSendMode` in `slide.js` that aborts with
`console.error` when no writer is registered — closes the path where a
pre-Connect click would silent-fail (auto-type bytes accumulate in
the local ring without reaching the wire, `pendingSendSession` waits
forever).

### WR-04: `pumpNextDataChunkIfReady` may pump stale bytes after a multi-file boundary

**Files modified:** `crates/bestialitty-core/src/slide/state.rs`,
`crates/bestialitty-core/src/lib.rs`,
`crates/bestialitty-core/tests/slide_boundary_shape.rs`,
`crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs`,
`www/transport/slide.js`
**Commit:** e07adc4
**Applied fix:** Added `Slide::send_current_file_idx() -> u32` to the
core SM and exposed it across the wasm boundary (`lib.rs` façade + both
pin tests in `slide_boundary_shape.rs` and
`slide_wasm_boundary_shape.rs`). `pumpNextDataChunkIfReady` in
`www/transport/slide.js` now reads the current file index directly
from the Rust SM via this accessor instead of trusting the JS-side
`currentSendCtx.currentFileIdx`. The JS-side counter is still
maintained by the `EVT_FILE_COMPLETE` handler for the introspection
accessor (`__getStateForTests`), but the pump no longer depends on
JS-side cursor accuracy. Added a state.rs unit test
(`send_current_file_idx_tracks_sm_advance`) that drives the SM through
a 2-file batch and asserts the accessor advances from 0 to 1 after
`EVT_FILE_COMPLETE | 0`.

### WR-05: `pendingSendSession` clobber leaks `B:SLIDE R\r` bytes onto the wire

**Files modified:** `www/transport/slide.js`
**Commit:** af35f83 (combined with WR-02 + WR-03)
**Applied fix:** Added a first-click-wins guard at the top of
`enterSendMode` in `slide.js`. If `pendingSendSession !== null` (the
200ms button-disable poll has not yet caught up to the first click's
state change), the function returns early with a `console.warn` and
does NOT push the auto-type bytes a second time. Combined with the
WR-02 button-disable extension and the WR-03 writer-ready gate, this
closes the only remaining path where rapid clicks within the 200ms
poll window could leak `B:SLIDE R\rB:SLIDE R\r` (20 bytes) onto the
wire and trigger a phantom recv session.

## Notes on Combined Commit (af35f83)

WR-02, WR-03, and WR-05 were committed together as a single atomic fix
because:
1. All three add stacked guards at the top of the same `enterSendMode`
   function in WR-05 → WR-02 → WR-03 order (most-specific failure mode
   short-circuits first).
2. WR-02 and WR-03 share the `updateButtonState` extension logic in
   `file-source.js` (a single `shouldDisable` predicate now factors in
   `isReceiving`, `writerReady`, plus the existing `isPending` /
   `isSending` arms).
3. The `isWriterReady` plumbing is shared between WR-03's button gate
   and WR-03's defense check; splitting across multiple commits would
   require breaking a single conceptual pipe in half.

The combined commit message clearly delineates each finding's
contribution; `git log --grep "WR-0"` surfaces all three.

## Skipped Issues

None — all in-scope findings (Critical + Warning severity) were
successfully fixed.

## Info Findings — Not in Scope

Per `fix_scope: critical_warning`, the seven Info findings (IN-01
through IN-07) were intentionally not addressed. Reviewer-flagged
follow-ups for Phase 11/12 hardening:

- IN-01: `Framer::step AfterAckOrNak` dead-code arm
- IN-02: `truncateCpm83` does not validate dotfile / empty-base inputs
- IN-03: `drive_session` test harness `_seq` ignored — couples to
  WR-01's window-rewind work (now the test bot's
  `awaiting_retransmit` shortcut is no longer load-bearing for
  protocol correctness, but the helper still uses it to short-circuit
  the test fixture)
- IN-04: `__resetForTests` mutates button state + leaks `setInterval`
- IN-05: `EVT_RETRANSMIT_NEEDED` u8 wraparound at >255 frames
- IN-06: `OUTBOUND_RESERVE = 4128` slack is exactly 8 bytes
- IN-07: `processFiles` reads all selected files into RAM before modal

---

_Fixed: 2026-05-07T19:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
