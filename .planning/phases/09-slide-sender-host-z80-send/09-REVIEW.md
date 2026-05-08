---
phase: 09-slide-sender-host-z80-send
reviewed: 2026-05-07T18:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - crates/bestialitty-core/src/lib.rs
  - crates/bestialitty-core/src/slide/framer.rs
  - crates/bestialitty-core/src/slide/mod.rs
  - crates/bestialitty-core/src/slide/state.rs
  - crates/bestialitty-core/src/slide/tests_only.rs
  - crates/bestialitty-core/tests/slide_boundary_shape.rs
  - crates/bestialitty-core/tests/slide_sender.rs
  - crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs
  - www/index.html
  - www/input/file-source.js
  - www/input/tx-sink.js
  - www/main.js
  - www/tests/input/file-source.spec.js
  - www/tests/input/tx-sink.spec.js
  - www/tests/transport/mock-serial-slide-bot.js
  - www/tests/transport/slide-sender.spec.js
  - www/transport/slide.js
findings:
  critical: 1
  warning: 5
  info: 7
  total: 13
status: issues_found
---

# Phase 9: Code Review Report (Refresh)

**Reviewed:** 2026-05-07 (refresh)
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

This refresh follows the user-found dialog-flow bug fix at commit 651f9d6
(`#send-modal:not([open]) { display: none; }` restoring the UA-suppression
that the author rule's `#id` specificity had clobbered). The fix is in
place at index.html:561-563, the regression test
`closed-state dialog is not visible in document flow` is wired in
www/tests/input/file-source.spec.js:243-257, and the layout rules are now
correctly scoped to `#send-modal[open]` (index.html:564). That class of
issue — author CSS subverting UA dialog state — is fully addressed.

The remaining Phase 9 surface still tracks the locked D-01..D-20
decisions; architectural invariants (no `wasm_bindgen`/`web_sys`/`js_sys`/
`std::time` leaks into the core crate; sole `#[wasm_bindgen]` block in
`lib.rs`; EVT_*/SlideState pin tests mirrored between native and wasm
boundary; `outbound_buf` stable-pointer triple) hold. The byte-identical
round-trip gate (SC#5) is verified at the three layers called out in
CONTEXT (native Rust mock receiver in `slide_sender.rs`; JS mock SLIDE
bot in `mock-serial-slide-bot.js`; CRC-16-CCITT exact match enforced in
both bots).

The findings below cluster around four themes:

1. **CR-01 (Critical) — Panic-on-malformed-metadata at the wasm boundary.**
   Carries over from the prior review; not addressed in 651f9d6. The Rust
   sender ingest of JS-supplied metadata still trusts byte boundaries via
   direct slicing in `enter_send_mode` and the helper `read_le_u32`; any
   crashable input across the wasm FFI traps the page. Mirror of the
   `encode_key_raw` defensive shape called out in lib.rs:312-320 is
   missing on the sender entry point.

2. **WR-01..WR-05 (Warnings) — UI affordance + protocol-edge cases.**
   Carries over from the prior review. The dialog-state fix at 651f9d6
   does not touch any of these paths. Highlighted: `enterSendMode` has
   silent-drop paths when `owner === 'slide'` (active recv session) or
   when no writer is registered (pre-Connect click); the button-state
   observer's 200 ms poll leaves a small clobber window for
   `pendingSendSession`; the NAK retransmit semantics still diverge from
   slide-rs window-rewind and the test mock papers over the divergence.

3. **IN-01..IN-07 (Info) — code-quality refinements.** Mostly carryovers
   plus one new finding (IN-07) re: sequential per-file `arrayBuffer()`
   reads that hold all selected files in memory before showing the modal.

None of the findings affect the locked Phase 9 SC#1..SC#5 acceptance
gates. CR-01 should be fixed before any production deploy that exposes
`enter_send_mode` to potentially-untrusted input; the warnings should be
addressed before Phase 11's user-facing chip + cancel UI relies on the
underlying state machine being defensive against caller misuse.

## Critical Issues

### CR-01: `Slide::enter_send_mode` panics on malformed metadata

**File:** `crates/bestialitty-core/src/slide/state.rs:156-180` and
`crates/bestialitty-core/src/slide/state.rs:514-516`
**Issue:** The metadata-parse loop calls `read_le_u32(&metadata[cursor..])`
(state.rs:158/162/166) and `metadata[cursor..cursor + name_len].to_vec()`
(state.rs:164) without any length validation against `metadata.len()`. The
helper at state.rs:514-516 (`read_le_u32`) panics on out-of-bounds
(`bytes[0]..bytes[3]`), and the `name` slice indexing panics on
`cursor + name_len > metadata.len()`. The doc comment at state.rs:153-155
states "metadata is trusted" because JS-side `validateCpmFilename` +
`truncateCpm83` ran first — but those validators only constrain the
*filename character set*, not the **outer framing** of the length-prefixed
blob. A bug in `packSendMetadata` (e.g., a future contributor who counts
UTF-16 code units instead of UTF-8 bytes for `name_len`), a truncated
metadata buffer caused by a wasm memory-growth race, or any direct call
to `Slide.enter_send_mode` from a test surface (`window.__slide.enterSendMode`
is exposed in main.js:410) with malformed bytes will panic across the
wasm FFI boundary, which abort-traps the entire wasm instance and wedges
the page until reload. This is the same class of issue the
`encode_key_raw` boundary explicitly guards against in lib.rs:312-320
("returns an empty `Vec<u8>` rather than panicking across the wasm FFI
boundary (RESEARCH Pitfall #4)"). Sender-side parity is missing here,
and Phase 9's `slide_sender.rs` corpus does not cover any malformed-input
path.

**Fix:** Make `enter_send_mode` defensive and either (a) return an `Err`
that the wasm façade in lib.rs translates to a JS exception, or (b)
transition into `SlideState::Error` with no other side-effects (no
CTRL_RDY pushed, no role swap, no send_ctx populated). Concrete sketch:

```rust
pub fn enter_send_mode(&mut self, metadata: &[u8]) {
    fn try_parse(metadata: &[u8]) -> Option<Vec<FileMeta>> {
        let mut cursor = 0usize;
        if metadata.len() < 4 { return None; }
        let file_count = u32::from_le_bytes(
            metadata[cursor..cursor + 4].try_into().ok()?
        ) as usize;
        cursor += 4;
        let mut files = Vec::with_capacity(file_count);
        for _ in 0..file_count {
            if cursor + 4 > metadata.len() { return None; }
            let name_len = u32::from_le_bytes(
                metadata[cursor..cursor + 4].try_into().ok()?
            ) as usize;
            cursor += 4;
            if cursor + name_len + 4 > metadata.len() { return None; }
            let name = metadata[cursor..cursor + name_len].to_vec();
            cursor += name_len;
            let size = u32::from_le_bytes(
                metadata[cursor..cursor + 4].try_into().ok()?
            );
            cursor += 4;
            files.push(FileMeta { name, size });
        }
        Some(files)
    }

    let Some(files) = try_parse(metadata) else {
        self.sm_state = SlideState::Error;
        return;
    };
    self.send_ctx = Some(SendCtx {
        files,
        current_file_idx: 0,
        current_seq: 1,
        eof_seq: 0,
    });
    self.role = SlideRole::Sender;
    self.outbound_buf.push(CTRL_RDY);
    self.sm_state = SlideState::WaitingRdy;
}
```

Add a `tests/slide_sender.rs` corpus entry that feeds (a) zero-length, (b)
file_count > 0 with a truncated record, (c) name_len that runs past
`metadata.len()`, (d) name_len that wraps via `usize` arithmetic on
32-bit targets, and asserts each transitions the SM to
`SlideState::Error` without panicking.

## Warnings

### WR-01: NAK retransmit re-feeds a single seq, not the window — diverges from slide-rs

**File:** `www/transport/slide.js:520-545` and
`crates/bestialitty-core/src/slide/state.rs:386-395`
**Issue:** On `EVT_NAK(seq)` the Rust SM emits
`EVT_RETRANSMIT_NEEDED | seq` and resets `current_seq = aux` (state.rs:392-394).
The JS handler in `drainEventsAndOutboundAwaitable` re-feeds **only the
single seq's chunk** via `slide.feed_send_chunk(payload, isEof)`
(slide.js:541) and does not rewind `currentSendCtx.sentBytesInFile`.
slide-rs/send.rs:194-208 "retries the window" — i.e., re-sends every
frame from the NAKed seq through the end of the in-flight window, then
resumes from there. The native test corpus papers over this divergence:
the mock receiver in `tests/slide_sender.rs` uses
`awaiting_retransmit: Option<u8>` to silently drop in-flight post-NAK
frames (slide_sender.rs:163-171, 187), which makes the
single-frame-retransmit logic appear correct in the test. The Playwright
JS bot in `mock-serial-slide-bot.js` does NOT have this latch — but its
NAK path (`setInjectNakOnSeq` at line 95) is exercised only by tests that
do not currently run a window-rewind assertion. Real slide.com hardware
that follows slide-rs's window-rewind contract will see (a) a post-NAK
seq=N retransmit, then (b) the **next** frame the JS pump emits will be
at the JS-side `sentBytesInFile` value — which is past the window the
receiver expected to re-receive — yielding seq drift and a stalled
session. CONTEXT D-11's authority line ("slide-rs is the byte-for-byte
reference for any ambiguity") flags this as the binding contract.

**Fix:** Two options. (a) In the Rust SM, when handling `EVT_NAK(aux)`,
also reset internal "next data seq" state to the NAKed seq AND emit a
sequence of `EVT_RETRANSMIT_NEEDED` events (one per outstanding seq from
aux..current_seq exclusive) so JS replays the window. (b) Push the
window-rewind into JS by having `currentSendCtx` track per-seq chunk
boundaries, and have the `EVT_RETRANSMIT_NEEDED` handler rewind
`sentBytesInFile` to `(aux - 1) * FRAME_SIZE` before the next pump cycle
naturally re-sends every frame from there forward. Whichever direction
is chosen, also drop the `awaiting_retransmit` shortcut from
`tests/slide_sender.rs:80-94/163-171` so the test exercises the real
window-rewind path (and add the same window-rewind assertion to the
Playwright bot via `setInjectNakOnSeq` once a real slide.com behaviour is
captured).

```js
// www/transport/slide.js — sketch for option (b)
} else if (kind === EVT_RETRANSMIT_NEEDED) {
    const ctx = currentSendCtx;
    if (!ctx) continue;
    const file = ctx.fileBytes[ctx.currentFileIdx];
    if (!file) continue;
    // Rewind sentBytesInFile to the NAKed seq's chunk start; the
    // pumpNextDataChunkIfReady call later in this cycle will resume from
    // ctx.sentBytesInFile and walk forward through the remaining frames,
    // re-feeding each.
    const startSeq = aux;
    ctx.sentBytesInFile = (startSeq - 1) * FRAME_SIZE;
    // Do NOT call feed_send_chunk here — let the natural pump cycle
    // handle the resend so per-frame seq accounting stays consistent.
}
```

### WR-02: `enterSendMode` silently drops auto-type bytes when `owner === 'slide'`

**File:** `www/transport/slide.js:388-410` (`enterSendMode`),
`www/input/tx-sink.js:50` (silent-drop gate), and
`www/input/file-source.js:139-144` (`isSessionActive`)
**Issue:** If the user clicks `[↑ Send file]` and confirms the modal
during an active receiver-mode session (`mode === 'recv'`,
`owner === 'slide'`), `enterSendMode` calls
`pushTxBytes(AUTO_SEND_COMMAND)` (slide.js:404-406). The owner gate at
tx-sink.js:50 silently drops the bytes because owner is 'slide'. Then
`pendingSendSession` is set — but the wakeup matcher is in recv-mode
bytestream territory, not terminal mode, so the queued send will never
fire. The `[↑ Send file]` button's disabled-state observer in
`file-source.js:116-132` (driven by `isSessionActive` at lines 139-144)
checks `hasPendingSendSession || mode === 'send'` but **not**
`mode === 'recv'`, so the button is enabled during recv. Net result:
silent transfer loss with no console error. This is a quality issue
rather than a security/correctness bug because no data is *corrupted* —
but the user-visible behaviour is "I clicked Send and nothing happened."
The drag-drop path already handles this case correctly via
`isSessionActive` at file-source.js:148/163/178, but only because
`isSessionActive` and `updateButtonState` use different shouldDisable
predicates: drag-drop returns early on the "pending" flag plus
`mode === 'send'`, ignoring `'recv'`. Both surfaces should treat
`'recv'` as session-active.

**Fix:** Either (a) extend `isSessionActive()` and `updateButtonState()`
in file-source.js to treat any non-`'terminal'` mode as active and
disable the button + silently ignore drag-drops; or (b) raise an error
in `enterSendMode` when `getWireOwner() === 'slide'` so callers see a
thrown rejection. (a) is the lower-friction fix and matches D-04
("silent at dragenter") for the analogous drag-drop case during active
sessions.

```js
// www/input/file-source.js — extend isSessionActive
function isSessionActive() {
    if (!getSlideStateFn) return false;
    let st;
    try { st = getSlideStateFn(); } catch { return false; }
    return !!st?.hasPendingSendSession
        || st?.mode === 'send'
        || st?.mode === 'recv';      // NEW — block during inbound recv
}

// www/input/file-source.js — extend updateButtonState
const isPending = !!st?.hasPendingSendSession;
const isSending = st?.mode === 'send';
const isReceiving = st?.mode === 'recv';
const shouldDisable = isPending || isSending || isReceiving;
```

### WR-03: `[↑ Send file]` is enabled before a writer is registered

**File:** `www/main.js:432-444` (`wireFileSource`) and
`www/transport/slide.js:404-406`
**Issue:** `wireFileSource` runs at boot synchronously (main.js:432 is
inside the boot script BEFORE `await wireSerial(...)` at line 458). The
button starts in its enabled state. If the user clicks `[↑ Send file]`
before clicking Connect (or while the auto-connect attempt is in flight),
the modal flows through to `enterSendMode`, which calls
`pushTxBytes(AUTO_SEND_COMMAND)`. At tx-sink.js:66-71, no
`registeredWriter` is set yet, so the bytes accumulate in the local ring
but never reach the wire. `pendingSendSession` is then set and the
wakeup matcher waits forever. Mirror of WR-02 but for the disconnected
case. Phase 11 SLIDE-35 owns the user-visible "Z80 didn't respond" chip;
for Phase 9 the failure should at minimum be observable in console.

**Fix:** Gate the `[↑ Send file]` button on
`getWireOwner() && registeredWriter` (or a new `txSink.isWriterReady()`
accessor) in the same observer that already polls every 200 ms.
Alternatively, log a console error in `enterSendMode` when no writer is
registered and abort the `pendingSendSession` assignment.

```js
// www/transport/slide.js — abort if no writer
export function enterSendMode({ files }) {
    // Defensive: refuse to queue a send when no writer is registered
    // (auto-type would silent-fail; user sees nothing happen).
    // Phase 11 SLIDE-35 owns the visible "Z80 didn't respond" chip;
    // for Phase 9 a console.error keeps the failure observable.
    if (!txSinkRef || typeof txSinkRef.isWriterReady !== 'function'
        || !txSinkRef.isWriterReady()) {
        console.error('[slide.js] enterSendMode: no writer registered; aborting');
        return;
    }
    /* ...existing body... */
}
```

(Requires a small addition to `tx-sink.js` exporting
`isWriterReady() { return registeredWriter !== null; }`.)

### WR-04: `pumpNextDataChunkIfReady` may pump stale bytes after a multi-file boundary

**File:** `www/transport/slide.js:506-514` and `slide.js:578-593`
**Issue:** When `EVT_FILE_COMPLETE | aux` arrives, the JS handler advances
`currentSendCtx.currentFileIdx = aux + 1` and resets `sentBytesInFile = 0`
(slide.js:511-514). The Rust SM has at this point pushed the **next
file's header frame** onto `outbound_buf` (state.rs:367-376) and
transitioned to `HeaderPhase`. Control flow then falls through to the
`drainSlideOutboundAwaitable` call at slide.js:551. Then
`pumpNextDataChunkIfReady` runs (slide.js:489) — the SM is in
`HeaderPhase`, so the `if (st !== STATE_DATA_PHASE) return` early-exit at
slide.js:582 fires and no payload is fed. Good. **However:** the per-cycle
ordering at slide.js:486-491 is sensitive to a sequence where both ACKs
(EOF-ACK and new-header-ACK) arrive in the same inbound chunk versus
distinct chunks. With both in distinct chunks: EVT_FILE_COMPLETE drains →
JS advances cursor → pumpNextDataChunkIfReady runs while SM is still in
HeaderPhase → no-op (early exit); on the NEXT inbound chunk (the new
header's ACK), SM advances to DataPhase and pump fires correctly. So the
ordering is safe in practice. But the logic is fragile to future
SM-state-emission reordering, and the relationship between
EVT_FILE_COMPLETE and "currentFileIdx" assumes the SM has already pushed
the next header. There is no test that exercises the case where both
ACKs arrive in distinct chunks, then one chunk has a transient pump
opportunity. The Plan 09-04 Rule 1 fix (slide.js:124, sendDispatchTail
serialisation) papers over the duplicate-write symptom but does not
exercise the transient-pump invariant.

**Fix:** Either (a) remove the JS-side cursor advance from the
EVT_FILE_COMPLETE handler and have `pumpNextDataChunkIfReady` derive the
current file index from a Rust-side accessor (e.g.,
`slide.send_file_idx()`) each call, ensuring single source of truth; or
(b) document explicitly that the JS pump is a strict slave to SM state
transitions and add a state-driven test that interleaves EOF-ACK and
new-header-ACK across two chunks (drop them into the read loop with a
microtask gap, observe sender state at each step).

```js
// www/transport/slide.js — sketch for option (a)
function pumpNextDataChunkIfReady() {
    if (!slide || !currentSendCtx) return;
    const st = slide.state();
    if (st !== STATE_DATA_PHASE) return;
    // Authoritative cursor from Rust SM (new accessor in a Phase 9 follow-up
    // or Phase 10 / 11 hardening). Also exposed via __getStateForTests so
    // Playwright can pin invariant directly.
    const fileIdx = slide.send_current_file_idx();
    const file = currentSendCtx.fileBytes[fileIdx];
    /* ...existing body... */
}
```

### WR-05: `pendingSendSession` clobber leaks `B:SLIDE R\r` bytes onto the wire

**File:** `www/transport/slide.js:388-410` (`enterSendMode`)
**Issue:** Per the Claude's-Discretion default in CONTEXT, depth-1 clobber
semantics apply: a second `enterSendMode` call before the first one's
wakeup arrives replaces `pendingSendSession`. Each call also pushes
`AUTO_SEND_COMMAND` (10 bytes of `B:SLIDE R\r`) onto the wire
(slide.js:404-406). The button-state observer at file-source.js:113
disables the button while `pendingSendSession !== null` — but the
observer polls every 200 ms (file-source.js:113), leaving up to a
200 ms window where two rapid clicks race the disabled state. Two
clicks within that window → 20 bytes auto-typed → the Z80 sees
`B:SLIDE R\rB:SLIDE R\r` in its CCP, executes the command twice, fires
SLIDE twice, and only the **first** ESC^SLIDE wakeup flushes the
(latest) `pendingSendSession`. The second SLIDE invocation is then
fielded by Phase 8's recv-mode (the default branch at slide.js:257). Net
effect: a phantom recv session opens unexpectedly, which the user did not
initiate. The same 200 ms race is exploitable from
`window.__slide.enterSendMode` programmatic test usage (main.js:410
exposes the entry point).

**Fix:** When `pendingSendSession` is already set, refuse to push
auto-type bytes a second time (and ideally to update the metadata at
all, so the depth-1 clobber semantic itself becomes "first click wins").

```js
export function enterSendMode({ files }) {
    if (pendingSendSession !== null) {
        // Click-through during the 200 ms button-disable window.
        // First-click-wins: ignore the second click rather than clobber
        // and double-auto-type. The user-visible footgun (clicking a
        // disabled button mid-poll) is the price; correctness wins.
        console.warn('[slide.js] enterSendMode: send already pending; ignoring');
        return;
    }
    const metadata = packMetadataInline(files);
    const fileBytes = files.map((f) => f.bytes);
    if (AUTO_SEND_COMMAND.length > 0) {
        pushTxBytes(AUTO_SEND_COMMAND);
    }
    pendingSendSession = { metadata, fileBytes };
}
```

Combined with WR-02's button-disable extension, this closes the only
remaining path where rapid clicks can leak auto-type bytes onto the wire.

## Info

### IN-01: Dead-code arm in `Framer::step` `AfterAckOrNak`

**File:** `crates/bestialitty-core/src/slide/framer.rs:122`
**Issue:** The `_ => EVT_NONE` arm at framer.rs:122 with the comment
"unreachable in practice" is genuinely unreachable: `AfterAckOrNak(ctrl)`
state is only entered with `ctrl ∈ {CTRL_ACK, CTRL_NAK}` from
framer.rs:105/109. A pure-Rust dead-code reviewer (clippy::unreachable,
or a `match` that exhausts the variants) would catch this; the current
code uses a `u8` inner type so the compiler can't.
**Fix:** Replace with `unreachable!()` or refactor `AfterAckOrNak(u8)`
into a 2-variant enum (`AfterAck` / `AfterNak`) so the type system
enforces the invariant.

### IN-02: `truncateCpm83` does not validate dotfile / empty-base inputs

**File:** `www/input/file-source.js:354-363`
**Issue:** The function comment notes that callers MUST run
`validateCpmFilename` first; if not, e.g. `truncateCpm83('.txt')` returns
`'.TXT'` — a leading-dot CP/M-invalid filename. There's no defensive
`debug_assert`-style check, and the export is reachable from
page.evaluate in tests (file-source.spec.js:185-203 calls it directly,
relying on the documented contract that validation has run first; the
test corpus does not exercise the dotfile path).
**Fix:** Either add a one-line
`if (!validateCpmFilename(name).ok) throw new Error(...)` at the top, or
fold validation+truncation into a single `cpmifyFilename(name)` returning
`{ ok, value, reason }` so misuse is structurally impossible.

### IN-03: `drive_session` test harness uses but ignores `_seq`

**File:** `crates/bestialitty-core/tests/slide_sender.rs:263`
**Issue:** `if let Some(_seq) = retransmit_seq { ... }` binds `_seq` but
the body uses only `file_offsets[current_file] = 0`
(slide_sender.rs:267) — the comment at slide_sender.rs:264-266 explains
this is a one-shot NAK simplification. The `_seq` binding is intentional
but reads like a forgotten variable. WR-01's recommended drop of
`awaiting_retransmit` will require this branch to actually use `_seq`
for window-rewind logic.
**Fix:** Inline-comment the simplification or rewrite as
`if retransmit_seq.is_some()`. Address together with WR-01.

### IN-04: Test introspection mutates `topBarSendBtnRef` and leaks `setInterval`

**File:** `www/input/file-source.js:397-406` (`__resetForTests`) and
`www/input/file-source.js:35,113` (`buttonStateInterval`)
**Issue:** The test reset path force-restores the button label to
`'↑ Send file'` and re-enables the button. This sidesteps the polling
observer and could mask a regression where `updateButtonState` fails to
restore the label after session completion. Tests that assert
button-label state after a session should not be running through
`__resetForTests` between assertions. Additionally, `__resetForTests`
does NOT clear `buttonStateInterval`; the `setInterval` keeps firing on
a stale `wrapperElRef` across test runs unless `clearInterval` is also
added (the existing guard at file-source.js:112 only protects against
double-installation when `wireFileSource` runs twice — it does not
defend against a stale ref outliving its DOM).
**Fix:** Document in a comment that `__resetForTests` is a hard reset,
not a state-coherent reset. Also clear `buttonStateInterval` in the
reset path so a stale interval cannot fire on a subsequent test that
resets the DOM:

```js
export function __resetForTests() {
    dragDepth = 0;
    if (wrapperElRef) wrapperElRef.removeAttribute('data-drop-target');
    if (topBarSendBtnRef) {
        topBarSendBtnRef.disabled = false;
        topBarSendBtnRef.textContent = '↑ Send file';
        topBarSendBtnRef.title = 'Send file(s) to MicroBeast via SLIDE';
    }
    if (modalElRef && modalElRef.open) modalElRef.close('cancel');
    // Phase 9 IN-04 — keep the polling observer paused across resets;
    // wireFileSource will re-install on the next test that calls it.
    if (buttonStateInterval) {
        clearInterval(buttonStateInterval);
        buttonStateInterval = null;
    }
}
```

### IN-05: `EVT_RETRANSMIT_NEEDED` u8 wraparound at >255 frames

**File:** `www/transport/slide.js:530-544`
**Issue:** The retransmit handler computes
`chunkStart = (seq - 1) * FRAME_SIZE` where `seq` is a u8 (slide-rs
convention). Files larger than 255 frames × 1024 bytes = 261 120 bytes
will wrap the seq number, and this naive mapping won't work — an inline
comment at slide.js:533-535 already calls this out as out-of-scope.
Neither the native test corpus nor the Playwright suite exercises files
> 50 KB with NAK injection. This is a known limitation rather than an
active bug; flagging here so it isn't forgotten when Phase 10/11
hardware UAT surfaces it. Coupled with WR-01's window-rewind work, the
solution likely lives in the Rust SM (track wrap epoch alongside seq)
rather than JS.
**Fix:** None for Phase 9. Track for hardware UAT in Phase 12.

### IN-06: `OUTBOUND_RESERVE = 4128` slack is exactly 8 bytes

**File:** `crates/bestialitty-core/src/slide/state.rs:42`
**Issue:** `OUTBOUND_RESERVE = 4128` accommodates 4 max-size frames at
1030 bytes each (=4120 bytes) plus 8 bytes of slack. The comment at
state.rs:36-41 documents this. If the SM ever pushes a single CTRL byte
mid-window (e.g., a CTRL_FIN echo or mid-window CAN echo) while the
4-frame window is full, the outbound buffer exceeds 4120 + 1 = 4121
bytes — fits within 4128, but only barely. A theoretical sender-mode
edge case where two control bytes follow a 4-frame window
(CTRL_CAN echo + CTRL_FIN) reaches 4122 bytes — still fits — but the
slack is small enough that a future contributor adding a 9-byte frame
(the empty file-EOF marker can push 6 bytes; a hypothetical FIN-after-EOF
could push 7 bytes) could exhaust the reserve and trigger a Vec
reallocation, breaking the stable-pointer contract verified by
`outbound_ptr_stable_across_sender_window_pushes` at state.rs:957-977.
**Fix:** Bump `OUTBOUND_RESERVE` to 4192 (+72 bytes slack) or tighten
the test `outbound_ptr_stable_across_sender_window_pushes` to also push
a control byte after the 4-frame window so any future regression is
caught at native cargo test time. Mirror the change in
`OUTBOUND_VIEW_CAP` at slide.js:98 so JS view derivation stays in
lockstep.

### IN-07: `processFiles` reads all selected files into RAM before showing the modal

**File:** `www/input/file-source.js:202-233`
**Issue:** `processFiles` calls `await f.arrayBuffer()` inside the `for`
loop (file-source.js:215) BEFORE showing the rewrite/rejection modal.
For a multi-file batch totaling N bytes, the user sits with N bytes of
ArrayBuffer memory committed before the modal opens — and if the user
then cancels the modal, the memory was loaded for nothing. For Phase 9's
target workload (CP/M 8.3 files, typically tens to hundreds of KB
each), this is a non-issue. For a hypothetical drag-drop of 50 large
files, the modal-open latency becomes the slowest filesystem read times
the file count, plus all bytes are pinned until the user decides. The
fix is to defer `f.arrayBuffer()` to after modal confirm, but that
requires re-shaping `processFiles` to track `File` references instead of
pre-baked `Uint8Array`s. Out of scope for Phase 9; flagging for
Phase 11/12 if real-hardware UAT surfaces a workload that hits the
ergonomic seam.
**Fix:** None for Phase 9. Track for Phase 11/12 if multi-file drag-drop
ergonomics surface a complaint.

---

_Reviewed: 2026-05-07 (refresh after commit 651f9d6 dialog-flow fix)_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
