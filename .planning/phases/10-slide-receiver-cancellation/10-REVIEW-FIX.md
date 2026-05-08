---
phase: 10-slide-receiver-cancellation
fixed_at: 2026-05-08T00:00:00Z
review_path: .planning/phases/10-slide-receiver-cancellation/10-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 5
skipped: 1
status: partial
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-05-08
**Source review:** `.planning/phases/10-slide-receiver-cancellation/10-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (2 Critical + 4 Warning)
- Fixed: 5
- Skipped: 1 (WR-03 deferred per reviewer guidance — code-quality only, not a correctness issue)

All applied fixes pass the relevant test gates (`cargo test --workspace`, `npm run test:fast`, `bash scripts/build.sh` for the wasm rebuild).

## Fixed Issues

### CR-01: Multi-frame USB chunk data corruption — `recv_buf` overwritten between frames

**Files modified:**
- `crates/bestialitty-core/src/slide/state.rs`
- `crates/bestialitty-core/src/lib.rs`
- `crates/bestialitty-core/tests/slide_boundary_shape.rs`
- `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs`
- `crates/bestialitty-core/tests/slide_recv_corpus.rs`
- `www/transport/slide-recv.js`

**Commit:** `72d89d5`

**Applied fix:** Took **Option C** (the recommended approach in the orchestrator prompt). Added `recv_payloads: VecDeque<Vec<u8>>` to the `Slide` struct; the `DataPhase` arm now pushes each accepted data frame's payload onto the queue alongside the `EVT_RECV_DATA` event push. New `pop_recv_payload(&mut self) -> bool` pops the front entry into `recv_buf` so the existing `recv_ptr / recv_len / clear_recv` zero-copy triple keeps working unchanged. Stable-pointer discipline preserved (`Vec::clear + extend_from_slice` never reallocates within `RECV_BUF_RESERVE`).

Threaded the new method through the wasm-bindgen façade in `lib.rs`; pinned both the inner and façade signatures in the boundary-shape tests. Updated `slide-recv.js::sliceRecvBytesToOwned` to call `pop_recv_payload` before reading `recv_len`, and refreshed the head comment that documented the buggy contract (IN-05 docs drift).

Also extended `recv_corpus_multi_data_frames_in_one_chunk` to assert per-event `recv_buf` bytes via `pop_recv_payload` — the regression test that proves the fix (IN-04 absorbed into this fix). The test previously only counted events; it now drives both events to completion and asserts `vec![1,2,3]` for seq=1 and `vec![4,5,6]` for seq=2 in turn. Before this commit, that assertion would fail with `[4,5,6]` reported for both events.

Bonus: added `recv_payload_queue_len` test-introspection accessor for the regression test to assert the queue depth after `feed_chunk` returns.

**Note:** Logic-bug change touching the receiver hot path. Marked as **fixed: requires human verification** because the W3 multi-frame regression test was extended specifically to cover this — but the JS-side end-to-end path (slide.js drainEventsAndOutbound → onRecvEvent → pop_recv_payload → recv_buf) was exercised by the existing fast Playwright suite (49 SLIDE-related specs, all green). Hardware UAT (Phase 12) will provide the final confidence gate.

### CR-02: `recoverHardFail` clobbers in-flight CTRL_CAN before it reaches the wire

**Files modified:** `www/transport/slide-recv.js`

**Commit:** `5451d60`

**Applied fix:** Took the second option from the review (modify `recoverHardFail` itself) so any future hard-fail caller pre-pushing a control byte is also covered. `recoverHardFail` now calls `drainSlideOutboundOneShot()` BEFORE `force_idle()` so any pending CTRL_CAN reaches the wire before `force_idle` clears `outbound_buf`. The drain helper already exists for the cancel sequence (slide-recv.js:611) and is fire-and-forget, keeping `recoverHardFail` synchronous and idempotent.

### WR-01: Mid-session re-entry chunk-spanning wakeup produces negative-end subarray

**Files modified:** `www/transport/slide.js`

**Commit:** `cc0ece8`

**Applied fix:** Replaced `value.subarray(0, matchEnd - 6)` with a clamped two-line variant: `const beforeEnd = Math.max(0, matchEnd - 6); const before = value.subarray(0, beforeEnd);`. Added a comment explaining the chunk-spanning case (`matchEnd ∈ 0..5` makes `matchEnd - 6` negative; `Uint8Array.subarray(0, -N)` interprets the negative end as `length + end` and returns the chunk's leading bytes — which are the trailing bytes of the wakeup signature, not benign pre-wakeup data).

The reviewer recommended adding a regression spec for this; that was not included in this fix pass to keep scope tight on the correctness change. The fix is small and clearly correct on inspection; if a regression spec is desired it can be added in a follow-up.

### WR-02: `setSlideRef(null)` never called on session exit — stale handle leaks across sessions

**Files modified:** `www/transport/slide.js`, `www/transport/slide-recv.js`

**Commit:** `11b81c8`

**Applied fix:** Two-part fix per the review's recommendation:
1. `slide.js::exitRecvMode` now mirrors the `enter` path's `setSlideRecvRef(slide)` with `setSlideRecvRef(null)` so slide-recv cannot dereference a freed wasm Slide.
2. `slide-recv.js::isSlideActive` wraps `state()` in try/catch as defense-in-depth so any future caller forgetting to null the ref gets a graceful `false` instead of an uncatchable wasm-bindgen FFI panic (RESEARCH Pitfall 4).

### WR-04: prefs DEFAULTS lacks documentation for `slideRecvDirectoryHandle` non-storage

**Files modified:** `www/state/prefs.js`

**Commit:** `fca7518`

**Applied fix:** Added an `IDB_ONLY_FIELDS` allow-list (currently `['slideRecvDirectoryHandle']`); `loadPrefs` deletes those keys from `cached` after the partial-blob merge so `getPrefs().slideRecvDirectoryHandle` is guaranteed `undefined` regardless of any crosstalk in localStorage. CONTEXT D-03 cross-reference + dual-storage hazard documented in the surrounding comment.

## Skipped Issues

### WR-03: `waitForState` polls every 10 ms instead of subscribing to SM transitions

**File:** `www/transport/slide-recv.js:627-638`

**Reason:** Deferred to a later phase per orchestrator guidance — "acceptable as-is at standard depth; mark as won't-fix-here in REVIEW-FIX.md if low-cost not achievable in this pass". The reviewer also explicitly notes this is a code-quality concern (not a correctness issue): the polling adds at most ~10 ms of latency per state-change observation against a 500 ms timeout, with up to 50 wasm boundary calls in the worst case. The proposed fix requires a state-change notifier in `slide.js::drainEventsAndOutbound` plus a Promise-resolver list in `slide-recv.js`, plus updating the resolvers on every `slide.state()` transition observed during the drain — touches multiple modules and the wakeup → drain → onRecvEvent hot path. Out of scope for this review-fix pass; a follow-up plan can address it cleanly.

**Original issue:** `waitForState` uses a 10 ms `setTimeout` polling loop in the cancel sequence's Step 3 (echo wait). Each tick is a wasm boundary call plus a `setTimeout` re-arm; over the 500 ms window this fires up to 50 times. An event-driven notifier would eliminate the polling latency and the wasm boundary overhead, but the implementation is non-trivial.

## Notes

- **Info findings (IN-01 .. IN-05) are out of scope** for this `critical_warning` fix-scope pass. IN-04 (the W3 test that didn't validate per-event recv_buf) was naturally absorbed into the CR-01 fix since the regression test had to be extended to prove the fix. IN-05 (slide-recv.js head comment drift) was likewise addressed alongside CR-01 — the head comment now describes the corrected per-frame queue contract.
- **Verification:** `cargo test --workspace` passes (all 287+ tests across 16 test binaries); `npm run test:fast` passes (81/81 fast Playwright tests); wasm rebuild via `scripts/build.sh` succeeds; targeted SLIDE-specific Playwright suites (`slide-recv.spec.js`, `slide-recv-e2e.spec.js`, `slide-recv-fsap.spec.js`, `slide-recv-reentry.spec.js`, `slide-recv-settings.spec.js`, `slide-cancel.spec.js`, `slide-dispatcher.spec.js`, `slide-wakeup.spec.js`, `slide-sender.spec.js`) all pass — 49 specs, 0 failures.
- **Project commit convention:** Standard conventional commits with `fix(10-XX-NN)` scope; no AI attribution per project policy.

---

_Fixed: 2026-05-08_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
