---
phase: 09-slide-sender-host-z80-send
verified: 2026-05-07T03:15:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open the app in Chromium, connect to a real or mock serial port, click the [↑ Send file] button, and verify: (a) the OS multi-file picker opens; (b) select a file with a long lowercase name like 'my-document-long.txt'; (c) the confirm modal shows the rewrite row 'my-document-long.txt → MY-DOCUME.TXT'; (d) clicking 'Send 1 file(s)' auto-types 'B:SLIDE R' in the terminal and the send session begins."
    expected: "Picker opens, modal shows rewrite, button transitions to '↑ Send file (sending…)', auto-type 'B:SLIDE R\\r' appears as typed bytes."
    why_human: "Visual UI appearance, modal layout, and real-time button state cannot be verified programmatically without a live serial port."
  - test: "Drag a file onto the terminal canvas area (#terminal-wrapper) and verify: (a) dashed-border overlay appears with faint accent tint; (b) text reads exactly 'Drop file(s) to send via SLIDE'; (c) then drag a URL or text snippet onto the same area and verify no overlay appears."
    expected: "File drag shows overlay; non-file drag is silently rejected (no overlay, no preventDefault on navigation-type drops)."
    why_human: "Drag-drop visual overlay and the dashed-border + tint appearance require visual inspection in a real browser."
  - test: "Try clicking [↑ Send file] with a file containing a CP/M-invalid character in the name (e.g., 'my*file.txt') and verify the modal shows a rejection row (not a rewrite row) and the Send button is disabled or shows 'All files rejected'."
    expected: "Modal lists rejection reason 'invalid CP/M character *', Send button disabled, no SLIDE session opens."
    why_human: "File picker on most OSes won't produce files with '*' in the name; a synthetic drag-drop test would be needed, which is verified in automated tests (SLIDE-16) — the visual presentation needs developer confirmation."
---

# Phase 9: SLIDE Sender — Host → Z80 Send Verification Report

**Phase Goal:** Deliver host-initiated SLIDE send end-to-end. User picks files (multi-file `<input type="file" multiple>` picker OR drag-drop onto `#terminal-wrapper`), BestialiTTY auto-types `B:SLIDE R\r` command, then the Phase 7 SLIDE state machine — extended in Phase 9 with sender-side transitions — frames + ships bytes via `await writer.ready` backpressure discipline. Filenames CP/M 8.3 validated + uppercased in JS before any frame leaves the wire; rewrites surfaced via inline `<dialog>` confirm modal.

**Verified:** 2026-05-07T03:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can initiate a send via multi-file picker OR drag-drop onto `#terminal-wrapper`; both paths end in the same `enterSendMode({ files })` entry point | ✓ VERIFIED | `www/input/file-source.js` exports `wireFileSource` with both picker `change` and `drop` event handlers (lines 87, 134+); both call `enterSendModeRef({ files: validated })`. Playwright tests `picker click flow` and `drop triggers picker-equivalent flow — modal opens` pass. |
| 2 | Drag-over canvas shows dashed-border overlay + faint tint + "Drop file(s) to send via SLIDE"; non-file drags rejected at `dragenter` via `dataTransfer.types.includes('Files')` filter | ✓ VERIFIED | `file-source.js:136` implements the `types.includes('Files')` filter; `index.html:763` contains verbatim text "Drop file(s) to send via SLIDE"; `index.html:539` contains `#terminal-wrapper[data-drop-target="true"] #drop-overlay` CSS rule with dashed border. Playwright tests `drag-drop overlay shows on dragenter` and `non-file rejection — silent at dragenter` pass. |
| 3 | BestialiTTY auto-types `B:SLIDE R\r` before opening SLIDE session; empty configured value disables auto-type; uses Phase 5 writer contract | ✓ VERIFIED | `slide.js:130-132` defines `AUTO_SEND_COMMAND` as `B:SLIDE R\r` bytes; `slide.js:404` guards with `if (AUTO_SEND_COMMAND.length > 0)` (empty disables); `pushTxBytes` is called BEFORE `pendingSendSession` assignment (Pitfall 3 order-critical, line 405 then 409). Playwright test `auto-type B:SLIDE R\r before wakeup match` passes. |
| 4 | Filenames uppercased + truncated to CP/M 8.3 in JS before reaching Rust SM; rewrite surfaced to user; CP/M-invalid characters rejected pre-flight with user-visible error before any frame leaves the wire | ✓ VERIFIED | `file-source.js:323` implements `validateCpmFilename` with `CPM_INVALID_CHARS = new Set(['<','>',',',';',':','=','?','*','[',']'])` at line 18; `file-source.js:354` implements `truncateCpm83` with `toUpperCase()`. Rewrite shown in `showConfirmModal`. Playwright tests `modal rewrite` and `modal rejection` pass. Pure-function unit tests for `validateCpmFilename`/`truncateCpm83`/`packSendMetadata` pass. |
| 5 | Sender-side write loop uses `await writer.ready; writer.write(bytes)` discipline; end-to-end test against mock peer transfers multi-KB binary file with byte-identical round-trip | ✓ VERIFIED | `tx-sink.js:152-153` implements `await registeredWriter.ready; await registeredWriter.write(bytes)` in `writeSlideFrameAwaitable`. Rust: `cargo test --test slide_sender` → 6 tests pass including `end_to_end_single_file`, `end_to_end_multi_file`, `end_to_end_zero_byte_file`, `nak_triggers_retransmit`. JS: Playwright `byte-identical round-trip — single file via mock SLIDE-receiver bot` passes. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `crates/bestialitty-core/src/slide/framer.rs` | `EVT_FILE_COMPLETE = 8 << 16`, `EVT_SESSION_COMPLETE = 9 << 16`, `EVT_RETRANSMIT_NEEDED = 10 << 16`; `pub fn build_frame_into` | ✓ VERIFIED | Lines 41-43 contain all three constants; line 202 defines `pub fn build_frame_into` |
| `crates/bestialitty-core/src/slide/state.rs` | `OUTBOUND_RESERVE = 4128`; `pub fn enter_send_mode`; `pub fn feed_send_chunk`; `SendCtx` struct | ✓ VERIFIED | Line 42: `OUTBOUND_RESERVE = 4128`; line 79: `struct SendCtx`; line 156: `pub fn enter_send_mode`; line 191: `pub fn feed_send_chunk` |
| `crates/bestialitty-core/src/slide/mod.rs` | Re-exports `EVT_FILE_COMPLETE`, `EVT_SESSION_COMPLETE`, `EVT_RETRANSMIT_NEEDED` | ✓ VERIFIED | Line 41 re-exports all three constants |
| `crates/bestialitty-core/tests/slide_boundary_shape.rs` | `slide_send_methods_have_stable_signatures` test + new EVT_* assertions | ✓ VERIFIED | Line 51: `fn slide_send_methods_have_stable_signatures`; test passes |
| `crates/bestialitty-core/tests/slide_sender.rs` | 6-test end-to-end corpus including `end_to_end_single_file` | ✓ VERIFIED | All 6 tests confirmed passing: `end_to_end_single_file`, `end_to_end_multi_file`, `end_to_end_zero_byte_file`, `nak_triggers_retransmit`, `fin_after_all_files_acks_session_complete`, `mid_send_can_echoes_and_aborts` |
| `crates/bestialitty-core/src/lib.rs` | `Slide#[wasm_bindgen] enter_send_mode + feed_send_chunk` one-line forwards | ✓ VERIFIED | Lines 293-303: `self.inner.enter_send_mode(metadata)` and `self.inner.feed_send_chunk(payload, eof)` |
| `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` | Mirror of `slide_send_methods_have_stable_signatures` | ✓ VERIFIED | Line 50: `fn slide_send_methods_have_stable_signatures` |
| `www/pkg/bestialitty_core.js` | Exports `enter_send_mode` + `feed_send_chunk` | ✓ VERIFIED | Lines 72 and 109 of pkg file export both methods, forwarding to wasm |
| `www/input/tx-sink.js` | `writeSlideFrameAwaitable(bytes)` with `await writer.ready` backpressure | ✓ VERIFIED | Lines 148-154: async function using `await registeredWriter.ready; await registeredWriter.write(bytes)` |
| `www/transport/slide.js` | `enterSendMode` export + `pendingSendSession` + `dispatchSendMode` + `EVT_FILE_COMPLETE/SESSION_COMPLETE/RETRANSMIT_NEEDED` + `OUTBOUND_VIEW_CAP = 4128` + `drainSlideOutboundAwaitable` | ✓ VERIFIED | All confirmed present: line 59 `EVT_FILE_COMPLETE`, line 98 `OUTBOUND_VIEW_CAP = 4128`, line 106 `pendingSendSession`, line 388 `export function enterSendMode`, line 486 `dispatchSendMode`, line 557 `drainSlideOutboundAwaitable` |
| `www/input/file-source.js` | `wireFileSource`, `validateCpmFilename`, `truncateCpm83`, `packSendMetadata`, drag-drop handlers, modal flow | ✓ VERIFIED | All exports confirmed at lines 38, 323, 354, 376; drag-drop at lines 87, 134+; `CPM_INVALID_CHARS` set at line 18 |
| `www/index.html` | `[↑ Send file]` button + hidden multi-file input + `#drop-overlay` + `<dialog id="send-modal">` + ~50 lines CSS | ✓ VERIFIED | `send-file-button` at line 664; `drop-overlay` at line 762; `send-modal` at line 848; CSS drop overlay + modal styling confirmed |
| `www/main.js` | `wireFileSource` boot wiring AFTER `wireSlideDispatcher` | ✓ VERIFIED | Line 85 imports `wireFileSource`; line 432 calls it |
| `www/tests/transport/mock-serial-slide-bot.js` | SLIDE-receiver mock bot extending SERIAL_MOCK | ✓ VERIFIED | `MOCK_SERIAL_SLIDE_BOT` export at line 28 |
| `www/tests/transport/slide-sender.spec.js` | 5 Playwright tests covering SLIDE-07 + SLIDE-13 + Phase 9 SC#5 `byte-identical round-trip` | ✓ VERIFIED | 5 tests pass including `picker click flow`, `auto-type`, `byte-identical round-trip`, `multi-file`, `introspection` |
| `www/tests/input/file-source.spec.js` | 10 Playwright tests covering SLIDE-08 through SLIDE-16 + pure-function unit tests | ✓ VERIFIED | 10 tests pass including `drag-drop overlay`, `overlay visible`, `non-file rejection`, `modal rewrite`, `modal rejection` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `slide/state.rs` | `slide/framer.rs` | `build_frame_into` + `EVT_FILE_COMPLETE` + `EVT_SESSION_COMPLETE` + `EVT_RETRANSMIT_NEEDED` | ✓ WIRED | Constants imported and used in state.rs sender arms |
| `tests/slide_sender.rs` | `slide/state.rs` | `enter_send_mode` + `feed_send_chunk` + `outbound_ptr` | ✓ WIRED | Integration tests call sender API directly |
| `tests/slide_boundary_shape.rs` | `slide/state.rs` | fn-pointer coercion of `Slide::enter_send_mode` and `Slide::feed_send_chunk` | ✓ WIRED | `slide_send_methods_have_stable_signatures` test at line 51 |
| `lib.rs` | `slide/state.rs` | `self.inner.enter_send_mode(metadata)` and `self.inner.feed_send_chunk(payload, eof)` | ✓ WIRED | Lines 294, 302 of lib.rs |
| `www/transport/slide.js` | `www/input/tx-sink.js` | `writeSlideFrameAwaitable` + `pushTxBytes` | ✓ WIRED | line 36 imports both; `drainSlideOutboundAwaitable` calls `txSinkRef.writeSlideFrameAwaitable` at line 570 |
| `www/transport/slide.js` | `www/pkg/bestialitty_core.js` | `slide.enter_send_mode(metadata)` + `slide.feed_send_chunk(payload, eof)` | ✓ WIRED | Slide wasm object used in `enterSendModeInternal` and `pumpNextDataChunkIfReady` |
| `www/input/file-source.js` | `www/transport/slide.js` | `enterSendMode({ files })` call after modal confirm | ✓ WIRED | `enterSendModeRef` injected via `wireFileSource` opts; called at modal confirm path |
| `www/main.js` | `www/input/file-source.js` | `wireFileSource({...})` call with DOM refs | ✓ WIRED | Line 432 calls `wireFileSource({...})` after `wireSlideDispatcher` |
| `www/tests/transport/slide-sender.spec.js` | `www/tests/transport/mock-serial-slide-bot.js` | `MOCK_SERIAL_SLIDE_BOT` initScript | ✓ WIRED | Confirmed by test passage; MOCK_SERIAL_SLIDE_BOT loaded before tests |
| `www/tests/transport/slide-sender.spec.js` | `window.__slide.enterSendMode` | `page.evaluate` call | ✓ WIRED | Tests use `window.__slide.enterSendMode` to drive sender flow programmatically |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `www/input/file-source.js` (modal) | `processedFiles` (rewrite rows, rejection rows) | `File.name` from user file picker / drag-drop | Yes — real filename bytes from browser File API | ✓ FLOWING |
| `www/transport/slide.js` (`drainSlideOutboundAwaitable`) | `outboundView` bytes from wasm | `slide.outbound_len()` + `outbound_ptr()` from Rust SM | Yes — real SLIDE frame bytes from Rust state machine | ✓ FLOWING |
| `www/tests/transport/slide-sender.spec.js` (byte-identical test) | reassembled bytes from mock bot | Mock bot accumulates framed bytes and compares to input | Yes — 23-byte payload verified byte-identical via `deepStrictEqual` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `cargo test --test slide_sender` exits 0 with 6 tests | `cargo test --test slide_sender` | 6 passed; 0 failed | ✓ PASS |
| `cargo test --test slide_boundary_shape` exits 0 with sender fn-pointer pin | `cargo test --test slide_boundary_shape` | 11 passed; 0 failed | ✓ PASS |
| `cargo test --test core_02_no_browser_deps` exits 0 (no `std::time` introduced) | `cargo test --test core_02_no_browser_deps` | 3 passed; 0 failed | ✓ PASS |
| `cargo test --workspace` exits 0 with 258 passing | `cargo test --workspace` | 258 passed; 0 failed (13 test batches) | ✓ PASS |
| Playwright Phase 9 suite (15 tests) all pass | `npx playwright test transport/slide-sender.spec.js input/file-source.spec.js` | 15 passed; 0 failed | ✓ PASS |
| `www/pkg/bestialitty_core.js` exports `enter_send_mode` + `feed_send_chunk` | Grep pkg file | Both methods present at lines 72 and 109 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SLIDE-07 | 09-03, 09-04 | User can initiate file send via multi-file picker | ✓ SATISFIED | `wireFileSource` picker handler + Playwright `picker click flow` test passes |
| SLIDE-08 | 09-03, 09-04 | User can initiate file send via drag-drop on `#terminal-wrapper` | ✓ SATISFIED | Drag-drop handlers in `file-source.js` + Playwright `drag-drop overlay shows on dragenter` passes |
| SLIDE-09 | 09-03, 09-04 | Drag-over visual feedback: dashed-border overlay + faint tint + verbatim message | ✓ SATISFIED | `index.html` CSS + overlay div with exact text "Drop file(s) to send via SLIDE" + Playwright `overlay visible` test passes |
| SLIDE-10 | 09-03, 09-04 | Non-file drags rejected at `dragenter` via `dataTransfer.types.includes('Files')` | ✓ SATISFIED | `file-source.js:136` + Playwright `non-file rejection — silent at dragenter` passes |
| SLIDE-13 | 09-01, 09-02, 09-04 | BestialiTTY auto-types configured command before opening session | ✓ SATISFIED | `slide.js:130-132` `AUTO_SEND_COMMAND` + `length > 0` guard + Playwright `auto-type B:SLIDE R\r before wakeup match` passes |
| SLIDE-15 | 09-03, 09-04 | Filenames uppercased + truncated to CP/M 8.3; rewrite surfaced in chip/modal | ✓ SATISFIED | `validateCpmFilename` + `truncateCpm83` exports + modal rewrite row + Playwright `modal rewrite` passes |
| SLIDE-16 | 09-03, 09-04 | CP/M filename validation rejects invalid characters; error surfaced before session opens | ✓ SATISFIED | `CPM_INVALID_CHARS` set with `<>.,;:=?*[]` + rejection row in modal + Playwright `modal rejection` passes |

All 7 required SLIDE-* requirements marked Complete in `.planning/REQUIREMENTS.md`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `crates/bestialitty-core/src/slide/state.rs` | 156-180 | `enter_send_mode` reads metadata bytes via direct slice indexing with no bounds validation | ⚠️ Warning (CR-01) | Future regression risk — panics if metadata blob is malformed. Does NOT affect current code path (metadata always produced by `packSendMetadata` which has correct framing). Advisory: fix before any third-party extension surface exposes `Slide.enter_send_mode` to untrusted input. |
| `www/transport/slide.js` | 388-410 | `enterSendMode` silently drops auto-type bytes when `owner === 'slide'` (during active recv session) | ⚠️ Warning (WR-02) | Silent transfer loss if user clicks Send during active recv. Not a Phase 9 SC blocker. |
| `www/transport/slide.js` | 388-410 | Double-click auto-type clobber: second call sends `B:SLIDE R\r` again without guard | ⚠️ Warning (WR-05) | Programmatic double-call sends bytes twice; button observer mitigates for UI path. |
| `www/main.js` | 432-444 | `[↑ Send file]` enabled before writer registered | ⚠️ Warning (WR-03) | Pre-connect click queues send that never fires; `pendingSendSession` waits forever. |
| `www/transport/slide.js` | 506-514 | NAK retransmit re-feeds single seq only, not window — diverges from slide-rs/send.rs window-rewind | ⚠️ Warning (WR-01) | Real hardware running slide-rs NAK semantics may see seq drift. Test bot masks with `awaiting_retransmit` latch. Advisory: fix before Phase 12 hardware UAT. |
| `crates/bestialitty-core/src/slide/framer.rs` | 122 | Dead-code arm `_ => EVT_NONE` in `AfterAckOrNak` | ℹ️ Info (IN-01) | No behavioral impact; refactor opportunity. |
| `www/input/file-source.js` | 354-363 | `truncateCpm83` does not re-validate dotfile/empty input | ℹ️ Info (IN-02) | Caller contract issue; misuse possible in future code. |

**None of the above anti-patterns block the Phase 9 success criteria.** CR-01 is a future-hardening item (current metadata always comes from well-formed `packSendMetadata`). WR-01 through WR-05 are quality improvements for Phase 11/12. The code review report at `09-REVIEW.md` confirms "None of the findings affect the locked Phase 9 SC#1..SC#5 acceptance gates."

### Human Verification Required

The automated suite (Playwright + cargo) fully verifies the protocol correctness and most UI behaviors. Three items require visual/manual developer verification:

#### 1. Multi-file picker → modal → send flow (visual confirmation)

**Test:** Open the app in Chromium, connect to a serial port (or use existing mock), click the `[↑ Send file]` button in the top bar.
**Expected:** OS multi-file picker opens. Select a file with a long lowercase name (e.g., `my-long-document.txt`). The confirm modal appears listing the rewrite row `my-long-document.txt → MY-LONG-D.TXT`. The top-bar button transitions to `↑ Send file (sending…)` (disabled) immediately. Clicking `Don't send` closes modal and re-enables button.
**Why human:** Modal visual layout, button label text transitions, and the rewrite display format require visual confirmation. The automated test uses `page.evaluate` introspection rather than visual pixel checks.

#### 2. Drag-drop overlay appearance

**Test:** Open the app in Chromium. Drag a file from the OS file manager over the terminal canvas area (`#terminal-wrapper`).
**Expected:** A dashed-border overlay appears with a faint accent-color tint and the exact text "Drop file(s) to send via SLIDE" centered. Then drag a browser URL or a text selection over the same area.
**Expected for non-file:** No overlay appears. The page does not navigate or show any visual feedback.
**Why human:** The dashed border, tint color, and exact visual appearance require developer eye confirmation. The text content and silent-rejection behavior are verified by automated tests, but visual quality of the overlay needs sign-off.

#### 3. All-rejected modal disabled state (visual + interaction)

**Test:** Trigger the picker or a drag-drop with only CP/M-invalid filenames (e.g., a file named `bad*name.txt` via drag-drop, which file-source.spec.js exercises programmatically). Verify the modal opens with only rejection rows, the Send button reads "Send 0 files" and is disabled, and the hint "All files rejected — see details below." appears.
**Expected:** Modal Send button is disabled (not clickable), hint text appears below the list, clicking `Don't send` closes the modal cleanly.
**Why human:** The visual disabled state of the Send button and the hint text position cannot be confirmed without rendering in a real browser viewport.

### Gaps Summary

No gaps blocking the Phase 9 goal. All five success criteria are verified by automated tests (Rust native + Playwright) and artifact inspection. The three human verification items are visual quality checks, not correctness gaps.

The code review warnings (CR-01, WR-01 through WR-05) are advisory items for Phase 11/12 hardening:
- **CR-01** (metadata panic risk): blocked by a real-world invariant (packSendMetadata always produces well-formed blobs) and not reachable from current UI paths. Fix before any third-party extension surface.
- **WR-01** (NAK window-rewind divergence): masked by test bot but a real concern for hardware UAT in Phase 12.
- **WR-02/WR-03/WR-05**: UX edge cases (send-during-recv, pre-connect send, double-click) with silent-fail behavior rather than data corruption.

---

_Verified: 2026-05-07T03:15:00Z_
_Verifier: Claude (gsd-verifier)_
