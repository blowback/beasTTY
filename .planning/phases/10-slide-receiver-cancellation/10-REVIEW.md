---
phase: 10-slide-receiver-cancellation
reviewed: 2026-05-08T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - crates/bestialitty-core/src/lib.rs
  - crates/bestialitty-core/src/slide/framer.rs
  - crates/bestialitty-core/src/slide/mod.rs
  - crates/bestialitty-core/src/slide/state.rs
  - crates/bestialitty-core/src/slide/tests_only.rs
  - crates/bestialitty-core/tests/slide_boundary_shape.rs
  - crates/bestialitty-core/tests/slide_recv_corpus.rs
  - crates/bestialitty-core/tests/slide_recv_memory.rs
  - crates/bestialitty-core/tests/slide_recv_payload.rs
  - crates/bestialitty-core/tests/slide_torn_chunk.rs
  - crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs
  - www/index.html
  - www/input/keyboard.js
  - www/main.js
  - www/state/idb.js
  - www/state/prefs.js
  - www/tests/transport/mock-serial-slide-bot.js
  - www/tests/transport/slide-cancel.spec.js
  - www/tests/transport/slide-recv-e2e.spec.js
  - www/tests/transport/slide-recv-fsap.spec.js
  - www/tests/transport/slide-recv-reentry.spec.js
  - www/tests/transport/slide-recv-settings.spec.js
  - www/tests/transport/slide-recv.spec.js
  - www/transport/slide-recv.js
  - www/transport/slide.js
findings:
  critical: 2
  warning: 4
  info: 5
  total: 11
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-05-08
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Phase 10 ships the SLIDE Z80 → PC receive path: a Rust-side recv-payload accessor surface (`recv_ptr/_len/clear_recv` + filename triple + size/idx scalars), a JS-side `slide-recv.js` module owning the `chunks: Uint8Array[]` accumulator + Blob assembly + anchor-click vs FSAP download dispatch + ~N collision retry + 5-step CTRL_CAN cancel sequence, an Esc-cancel slot in the keyboard disambiguation chain, and a Settings-pane row for the folder-save toggle backed by IndexedDB.

The Rust receiver SM extension is solid: events emit in the correct ordering (header-before-data per Assumption A7), torn-chunk safety holds across new fixtures, and the pinned wasm boundary tests cover the new accessors. The JS shell wiring is mostly clean and follows established patterns (module-scope state, injected deps, `__resetForTests`/`__getStateForTests` introspection).

However, the review surfaced **two critical correctness defects** in the cross-boundary recv-data path. The most serious is a multi-frame-per-chunk data-corruption bug: when an OS-level USB read delivers two or more SLIDE data frames in a single chunk (the W3 contract scenario the corpus test was specifically designed to cover), the Rust SM clears and overwrites `recv_buf` per accepted frame while pushing one event per frame onto the ring. By the time JS drains the events, `recv_buf` only holds the LAST frame's payload — every earlier `EVT_RECV_DATA` event in that batch reads stale or empty bytes, silently corrupting reassembled files. The pinned `recv_corpus_multi_data_frames_in_one_chunk` test verifies that the events arrive in the correct order, but does NOT verify per-event payload bytes, so the SM passes its own tests while violating the contract its head comment claims to honour.

The second critical finding is in the file-too-large hard-fail path: `onRecvData` calls `slideRef.cancel()` (which pushes CTRL_CAN to outbound_buf) and then immediately calls `recoverHardFail()` which calls `force_idle()` — and `force_idle` clears outbound_buf, wiping the CTRL_CAN before it can reach the wire. The Z80 sender never learns the receiver gave up.

The warnings flag a real torn-chunk re-entry bug (negative-end Uint8Array.subarray when the wakeup signature spans chunk boundaries), the recv path's lack of a `setSlideRef(null)` on session exit (stale handle leaks across sessions), the use of a `setTimeout` polling loop in `waitForState` (unnecessary 10 ms heartbeat against an event-driven SM), and the missing `slideRecvDirectoryHandle` field in the prefs DEFAULTS / structuredClone path that contradicts CONTEXT D-03's "NOT in DEFAULTS" intent in a way the code now silently relies on.

Info items cover dead code, a bot-comment desync, a stale module-scope filename decoder cache, a duplicated W3 assertion gap in tests, and a documentation drift between the slide-recv head comment and the actual SM contract.

## Critical Issues

### CR-01: Multi-frame USB chunk data corruption — `recv_buf` overwritten between frames

**File:** `crates/bestialitty-core/src/slide/state.rs:626-631` (and consumer at `www/transport/slide-recv.js:355-413`)
**Issue:** When `Slide::feed_chunk` processes a chunk containing two or more complete SLIDE data frames (the documented W3 / OS-level USB chunking case), the receiver SM clears and overwrites `recv_buf` for each accepted frame BEFORE the previous frame's payload has been consumed by JS:

```rust
} else if aux == self.expected_seq {
    self.recv_buf.clear();
    self.recv_buf.extend_from_slice(&payload);     // overwrites prior frame
    self.events.push_back(EVT_RECV_DATA | (aux as u32));
    ...
}
```

The events ring correctly accumulates one `EVT_RECV_DATA` per frame, but `recv_buf` is single-frame-sized. The JS drain loop in `slide.js:drainEventsAndOutbound` runs AFTER `feed_chunk` returns; at that point only the LAST frame's bytes remain in `recv_buf`. The first `onRecvEvent(EVT_RECV_DATA|seq=1)` call slices the second frame's bytes (or empty if `clear_recv` ran for prior events); subsequent events read empty.

Concrete failure: a 6-byte file split into two 3-byte frames `[1,2,3]` (seq=1) and `[4,5,6]` (seq=2), delivered in one `read()` chunk, lands in JS with `file.chunks = [[4,5,6], []]` instead of `[[1,2,3], [4,5,6]]` — the assembled Blob is `[4,5,6]` not `[1,2,3,4,5,6]`. Any production receive flow where the sender pipelines window frames back-to-back (which slide-rs/send.rs already does) and the OS USB stack delivers the resulting bytes in a batched read can corrupt files silently — no CRC error, no NAK, no console warning.

The pinned test at `tests/slide_recv_corpus.rs:183-217` (`recv_corpus_multi_data_frames_in_one_chunk`) only asserts that two events were emitted with correct seq values; it never reads `recv_buf` between events, so the defect cannot fail this test. The slide-recv.js head comment lines 30-37 documents a "W3 assumption" that is contradicted by the actual SM behaviour.

**Fix:** Either (a) accumulate per-frame payloads inside the SM event ring (e.g., embed payload bytes in a parallel ring drained alongside events) and surface them via a new accessor, or (b) make `feed_chunk` stop after each accepted data frame and force JS to drain before continuing — exposing a `feed_one_frame` boundary or returning early from `feed_chunk` once an `EVT_RECV_DATA` event is queued. Option (b) is a smaller change:

```rust
pub fn feed_chunk(&mut self, bytes: &[u8]) -> u32 {
    let before = self.events.len();
    let mut i = 0;
    while i < bytes.len() {
        let _ = self.feed_byte(bytes[i]);
        i += 1;
        // Stop after queuing a data event so JS drains recv_buf before the next.
        if self.events.back().map_or(false, |&e| (e & 0xFFFF_0000) == EVT_RECV_DATA) {
            // Caller must call feed_chunk again with the remaining bytes.
            // Return number of events to signal "more bytes pending".
            break;
        }
    }
    (self.events.len() - before) as u32
}
```

Then the JS dispatcher must loop:

```js
function feedSlide(bytes) {
    let remaining = bytes;
    while (remaining.length > 0) {
        const consumed = slide.feed_chunk_until_data_event(remaining);  // new API
        drainEventsAndOutbound();   // JS reads recv_buf + clear_recv
        remaining = remaining.subarray(consumed);
    }
}
```

Either way, the fix MUST be paired with a regression test that hand-builds two data frames in one chunk and asserts the per-event recv_buf bytes match each frame's payload, not just that two events fire.

---

### CR-02: `recoverHardFail` clobbers in-flight CTRL_CAN before it reaches the wire

**File:** `www/transport/slide-recv.js:386-391` (and `crates/bestialitty-core/src/slide/state.rs:377-380`)
**Issue:** The file-too-large hard-fail branch in `onRecvData` does:

```js
if (currentFile.bytesDone > MAX_FILE_SIZE) {
    console.error(...);
    if (slideRef && typeof slideRef.cancel === 'function') slideRef.cancel();
    recoverHardFail('file too large');
}
```

`slideRef.cancel()` pushes `CTRL_CAN` (0x18) onto `outbound_buf` and transitions the SM to `CancelPending`. Immediately after, `recoverHardFail()` calls `slideRef.force_idle()`:

```rust
pub fn force_idle(&mut self) {
    self.sm_state = SlideState::Done;
    self.outbound_buf.clear();   // wipes the CTRL_CAN we just pushed
}
```

The CTRL_CAN never makes it to the wire. The Z80 sender doesn't observe a cancel and continues shipping data frames; any subsequent inbound chunks arrive at a SM in `Done` state (silently no-op'd) and a JS dispatcher whose `mode` was flipped back to `'terminal'` (so bytes get fed to the VT52 parser as garbage). Wire desync until the next `ESC^SLIDE` wakeup arrives — which may never happen, leaving the connection in a broken state until the user reloads.

The cancel sequence in `cancelSlideRecv` handles this correctly: it pushes CTRL_CAN, drains outbound (ships the byte to the wire via `drainSlideOutboundOneShot`), waits for echo, THEN calls force_idle. The hard-fail branch skips the drain step.

**Fix:** Drain the outbound buffer between `cancel()` and `recoverHardFail()`:

```js
if (currentFile.bytesDone > MAX_FILE_SIZE) {
    console.error(`[slide-recv] file ${currentFile.name} exceeded MAX_FILE_SIZE (${MAX_FILE_SIZE} bytes); cancelling`);
    if (slideRef && typeof slideRef.cancel === 'function') {
        slideRef.cancel();
        drainSlideOutboundOneShot();    // ship CTRL_CAN to the wire
    }
    recoverHardFail('file too large');
}
```

Alternatively, have `recoverHardFail` itself drain outbound before force_idle when invoked from a recoverable state:

```js
export function recoverHardFail(reason) {
    console.error(`[slide-recv] hard-fail: ${reason}; resetting`);
    // Ship any pending control bytes (e.g. CTRL_CAN from a preceding cancel())
    // BEFORE force_idle wipes the outbound buffer.
    drainSlideOutboundOneShot();
    if (slideRef && typeof slideRef.force_idle === 'function') {
        slideRef.force_idle();
    }
    forceExitRecvMode();
}
```

The second option also fixes any future hard-fail caller that pre-pushes a control byte.

## Warnings

### WR-01: Mid-session re-entry chunk-spanning wakeup produces negative-end subarray

**File:** `www/transport/slide.js:391-399`
**Issue:** `dispatchRecvMode` accumulates the wakeup matcher state in `recvWakeIdx` across chunks (correctly — `recvScratch` and `recvWakeIdx` are module-scope). But when the 7-byte wakeup signature spans two chunks (`recvWakeIdx > 0` going into the current chunk), the `matchEnd` index in the current chunk can be 0..5 — meaning fewer than 7 signature bytes are present in this chunk:

```js
const before = value.subarray(0, matchEnd - 6);
```

When `matchEnd = 3` (e.g., 4 bytes already matched in prior chunks, 3 more in this chunk completes the signature), `matchEnd - 6 = -3`. `Uint8Array.subarray(0, -3)` interprets the negative end as `length + end`, so for a chunk of length N it returns bytes 0..N-3. Those bytes are the FIRST PART of the signature (the trailing match), but the code treats them as benign pre-wakeup data and feeds them to the Rust SM:

```js
if (before.length) {
    feedSlide(before);          // feeds a partial wakeup signature into the framer
    drainEventsAndOutbound();
}
```

The Rust framer will likely silently discard these as malformed (they hit the `Idle` arm's "silent discard" default), so the data corruption surface is small in practice — but the logic is wrong, the assertion in the comment ("matchEnd points at the last byte of the 7-byte signature; the signature occupies indices [matchEnd-6 .. matchEnd] inclusive") is false when the signature spans chunks, and a future framer change that's less tolerant could break silently.

**Fix:** Clamp `before` to non-negative length:

```js
const beforeEnd = Math.max(0, matchEnd - 6);
const before = value.subarray(0, beforeEnd);
if (before.length) {
    feedSlide(before);
    drainEventsAndOutbound();
}
```

Add a regression spec that pushes the wakeup signature split into a 4-byte + 3-byte chunk pair and asserts the Rust SM exits `WaitingRdy` cleanly (no spurious bytes consumed).

---

### WR-02: `setSlideRef(null)` never called on session exit — stale handle leaks across sessions

**File:** `www/transport/slide.js:480-491`, `www/transport/slide-recv.js:336-338`
**Issue:** `enterRecvMode` calls `setSlideRecvRef(slide)` on every new session (line 473), passing the freshly-constructed Slide. `exitRecvMode` (line 480-491) flips the wire owner and mode, but does NOT call `setSlideRecvRef(null)` — so `slideRef` in slide-recv.js continues to point to the previous (now Done/Error) Slide instance.

Consequences:
- `isSlideActive()` reads the stale slide's `state()`. Since post-Done feeds are no-ops, the state remains `Done` (6) and `isSlideActive` correctly returns false — so the Esc-cancel guard works. OK in practice.
- But `cancelSlideRecv()` early-return logic checks `isSlideActive()` first, then calls `slideRef.cancel()` if active. If a NEW session starts via `enterRecvMode` then exits, then a SECOND session never reaches `enterRecvMode` (e.g., user keyboard cancel races boot), `slideRef` could still point to the first session — calls to `cancel()` / `force_idle()` would mutate the stale instance, not the live one.
- The `slide.free()` call on the next `enterRecvMode` (slide.js:467) frees the wasm memory backing the stale `slideRef`. Subsequent reads of `slideRef.state()` from slide-recv.js between the `free()` and the new `setSlideRecvRef` (if any code fires in that window) would dereference freed memory — wasm-bindgen panics in this path are uncatchable across the FFI boundary (RESEARCH Pitfall 4).

The window is small (synchronous handoff), but the contract is fragile.

**Fix:** Mirror the lifecycle in `exitRecvMode`:

```js
function exitRecvMode() {
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    setSlideRecvRef(null);   // clear slide-recv's stale reference
}
```

And in slide-recv.js, harden the accessor sites:

```js
export function isSlideActive() {
    if (!slideRef) return false;
    try {
        const st = slideRef.state();
        return st !== STATE_IDLE && st !== STATE_DONE && st !== STATE_ERROR;
    } catch {
        // wasm instance freed underneath us — defensive return.
        return false;
    }
}
```

---

### WR-03: `waitForState` polls every 10 ms instead of subscribing to SM transitions

**File:** `www/transport/slide-recv.js:627-638`
**Issue:** The cancel sequence's Step 3 (wait up to 500 ms for Z80 echo → SM transitions to Done) uses a setTimeout polling loop:

```js
function waitForState(targetState, timeoutMs) {
    return new Promise((resolve) => {
        const t0 = ...;
        const tick = () => {
            if (slideRef && slideRef.state() === targetState) return resolve(true);
            if (now() - t0 >= timeoutMs) return resolve(false);
            setTimeout(tick, 10);
        };
        tick();
    });
}
```

Each tick is a wasm boundary call (`slide.state()`) plus a `setTimeout` re-arm. Over the 500 ms window, this fires up to 50 times. The SM only transitions to Done on inbound CTRL_CAN, which arrives via the serial.js read loop → `dispatchInbound` → `dispatchRecvMode` → `feedSlide` → `slide.feed_chunk` (which can transition the SM in a single byte). The dispatcher already drains events and could notify a callback — no need for polling.

This is a code-quality concern (not a correctness issue): the polling adds unnecessary latency (up to 10 ms per state-change observation), unnecessary wasm boundary calls, and unnecessary task scheduler load. On a fast Z80 echo (typical case), the cancel sequence pays an extra 10 ms before resolving.

**Fix:** Add a state-change notifier in `slide.js`'s `drainEventsAndOutbound` that fires when the SM transitions to Done or Error during a recv session:

```js
// slide-recv.js — replace polling with a Promise that resolves on state change.
let stateChangeResolvers = [];
export function notifyStateChange(newState) {
    const resolvers = stateChangeResolvers;
    stateChangeResolvers = [];
    for (const r of resolvers) r(newState);
}
function waitForState(targetState, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        stateChangeResolvers.push((s) => {
            if (s === targetState) {
                clearTimeout(timer);
                resolve(true);
            }
        });
    });
}
// slide.js — call notifyStateChange(slide.state()) inside drainEventsAndOutbound
// when state transitions are observed (e.g., on EVT_CAN consumption).
```

If the polling is preferred for simplicity, document that the 10 ms cadence is a deliberate trade-off and tune it (50 ms would still meet the 500 ms timeout with 90% slack and 5x fewer wasm calls).

---

### WR-04: prefs DEFAULTS lacks documentation for `slideRecvDirectoryHandle` non-storage

**File:** `www/state/prefs.js:18-30`
**Issue:** CONTEXT D-03 specifies `slideRecvDirectoryHandle` lives in IndexedDB, NOT in the localStorage prefs blob. This is correctly implemented (the field is absent from `DEFAULTS`, and `idb.js` owns it). But the partial-blob safety logic at `prefs.js:56`:

```js
cached = { ...DEFAULTS, ...parsed, serial: { ...DEFAULTS.serial, ...(parsed.serial || {}) } };
```

means that if a stored prefs blob from a future schema version somehow contains `slideRecvDirectoryHandle: "<some string>"`, it WILL be merged into `cached` and exposed via `getPrefs()`. Code reading `prefs.slideRecvDirectoryHandle` (none in the current codebase, but the temptation exists) would get the corrupt string back instead of the real IDB-stored handle.

This isn't a present-day bug, but it's a subtle invariant the comments don't capture. A future contributor adding "save the handle path string for display" could introduce a dual-storage hazard where the prefs blob and IDB drift.

**Fix:** Add a defensive strip in `loadPrefs` to actively delete IDB-only fields if they leak into the blob, and document the boundary:

```js
const IDB_ONLY_FIELDS = Object.freeze(['slideRecvDirectoryHandle']);

export function loadPrefs() {
    try {
        ...
        cached = { ...DEFAULTS, ...parsed, serial: { ...DEFAULTS.serial, ...(parsed.serial || {}) } };
        // Strip fields that must NEVER be stored in localStorage (handles can't
        // JSON-roundtrip; storing a handle-path string would defeat IDB ownership).
        for (const key of IDB_ONLY_FIELDS) delete cached[key];
        return cached;
    } catch ...
}
```

## Info

### IN-01: Dead `slidePumpOnPortLost` stub in `slide.js`

**File:** `www/transport/slide.js:199-201`
**Issue:** The Phase 11 stub `slidePumpOnPortLost` in slide.js is now superseded by the real implementation in slide-recv.js (`slidePumpOnPortLost` exported from there and imported into main.js as `slideRecvPumpOnPortLost`). The slide.js stub is unreferenced — `main.js` imports the slide-recv version, not the slide version. Search confirms: no other module imports `slidePumpOnPortLost` from `./slide.js`.

**Fix:** Delete the unused export to prevent future confusion about which implementation is authoritative:

```js
// Remove lines 196-201 entirely — the real impl lives in slide-recv.js.
```

If kept for "test introspection" reasons, document why and add a comment pointing to the live implementation.

---

### IN-02: mock-bot comment incorrectly says payload Array.from instead of Uint8Array

**File:** `www/tests/transport/mock-serial-slide-bot.js:341-345`
**Issue:** The bot's frame parser slices `payload = bot.parse_buf.slice(4, 4 + len)` which returns an `Array<number>` (because `parse_buf` is an Array). The CRC computation then iterates this Array — works fine. But the comment block at lines 343-348 implies the payload is byte-typed; readers mistaking it for `Uint8Array` may try to `.subarray` it and get a runtime error.

**Fix:** Update the comment to clarify the type, OR convert to Uint8Array for type consistency:

```js
const payload = new Uint8Array(bot.parse_buf.slice(4, 4 + len));
```

Minor; bot is test-only.

---

### IN-03: `filenameDecoder` is module-scope and never reset

**File:** `www/transport/slide-recv.js:129`
**Issue:** `const filenameDecoder = new TextDecoder('latin1');` is a module-scope singleton. It's reused across sessions, which is correct. But `__resetForTests` (line 685) doesn't reset it — and `__resetForTests` resets every other module-scope state. A future change that makes `filenameDecoder` stateful (e.g., switching to `TextDecoder('utf-8', { fatal: true })` and the decoder accumulating partial-multi-byte state) would silently leak across tests.

**Fix:** Either move `filenameDecoder` inside `readRecvFilenameOwned` (slight allocation overhead per filename, negligible at SLIDE's session cadence), or document explicitly that the latin1 decoder is stateless and safe to share:

```js
// latin1 decoder is stateless (single-byte encoding) — module-scope singleton
// is safe to reuse across sessions. If the encoding ever changes to a multi-
// byte one, move this inside readRecvFilenameOwned.
const filenameDecoder = new TextDecoder('latin1');
```

---

### IN-04: Test `recv_corpus_multi_data_frames_in_one_chunk` doesn't validate per-event recv_buf

**File:** `crates/bestialitty-core/tests/slide_recv_corpus.rs:183-217`
**Issue:** As detailed in CR-01, this test asserts both events are emitted with correct seq aux but never reads `recv_buf` between events. A regression in the SM that overwrites all but the last frame's payload (which is the current behaviour) passes this test. The test's docstring claims to "pin the contract that Plan 10-02's slide-recv.js head comment cites as existing" but does not actually pin per-frame-payload preservation.

**Fix:** Extend the test to read `recv_buf` after consuming each event in turn, asserting per-frame byte identity. This is dependent on resolving CR-01 first:

```rust
s.feed_chunk(&combined);
// Drain events ONE AT A TIME, reading recv_buf between each.
let evt1 = s.take_event_packed();
assert_eq!(evt1, EVT_RECV_DATA | 1);
let bytes1: Vec<u8> = unsafe { std::slice::from_raw_parts(s.recv_ptr(), s.recv_len()).to_vec() };
assert_eq!(bytes1, vec![1, 2, 3], "first event must read first frame's payload");
s.clear_recv();
let evt2 = s.take_event_packed();
assert_eq!(evt2, EVT_RECV_DATA | 2);
let bytes2: Vec<u8> = unsafe { std::slice::from_raw_parts(s.recv_ptr(), s.recv_len()).to_vec() };
assert_eq!(bytes2, vec![4, 5, 6], "second event must read second frame's payload");
```

Today this test will fail (recv_buf will be `[4,5,6]` for both reads). After CR-01 is fixed, this is the regression test that proves it.

---

### IN-05: slide-recv.js head comment "W3 assumption" contradicts SM contract

**File:** `www/transport/slide-recv.js:30-37`
**Issue:** The head comment claims:

> feed_chunk produces at most one EVT_RECV_DATA per call to step() because framer.step processes one frame per byte sequence terminated by CRC; subsequent frames in the same chunk emit subsequent EVT_RECV_DATA events that are drained sequentially with per-frame clear_recv() per Pitfall 5.

The first half is true (framer.step is single-byte). The second half describes the desired behaviour but is contradicted by the actual `Slide::feed_chunk` implementation, which loops over all bytes in one call without yielding to JS — so subsequent frames in the same chunk emit events but their payloads overwrite recv_buf before JS observes them. This is the documentation surface of CR-01.

**Fix:** Update the comment to match the actual contract once CR-01 is resolved (or, if option (b) from CR-01 is taken, document the new contract explicitly). The "drained sequentially with per-frame clear_recv()" claim must be backed by either a per-frame yield in the SM or per-frame payload buffering on the Rust side.

---

_Reviewed: 2026-05-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
