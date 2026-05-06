# PITFALLS Research — SLIDE Browser-Side File Transfer

**Domain:** Adding a binary, framed, sliding-window file-transfer protocol over Web Serial to an existing terminal emulator (BestialiTTY v1.0 → v1.1).
**Researched:** 2026-05-06
**Confidence:** HIGH for SLIDE protocol shape and Web Serial behavior. MEDIUM for Chrome download-throttle behavior. HIGH for re-entrancy and chip-collision risks.

---

## Critical Pitfalls (BLOCKING — will lose data, hang the wire, or corrupt files)

### Pitfall 1: Frame-at-a-time parsing assuming Web Serial chunks align with SLIDE frames

**Severity:** BLOCKING

**What goes wrong:**
SLIDE wire is `[SOF=0x01] [SEQ] [LEN_H] [LEN_L] [PAYLOAD ≤1024B] [CRC_H] [CRC_L]` — frames up to 1031 bytes. Web Serial delivers `Uint8Array` chunks at *whatever* size the OS USB driver chose: 1 byte, 64 bytes (one CDC packet), 4 KB (one URB completion). **Zero alignment** between chunk boundaries and SLIDE frames. Naive `parseFrame(chunk)` per `reader.read()` resolution will:
- Bail when chunk ends mid-payload — state lost; next chunk seen as garbage.
- Mis-parse a chunk containing 1.5 frames.
- Miss control bytes (ACK/NAK/RDY) arriving with the next frame.

**Manifestation:**
- Transfer succeeds at low payload sizes (≤64 bytes that fit in a single CDC packet) but fails when OS coalesces.
- "CRC mismatch" errors that disappear when you `console.log` the chunks.
- Heisenbugs at ~2KB+ files; success on ≤1KB files.

**Prevention:**
Rust core MUST own a streaming framer with these properties:
1. **Append-only feed:** JS calls `slide.feed_bytes(uint8array)`; Rust appends to internal buffer.
2. **State machine drives consumption:** explicit states `WaitingSof / GotSof_NeedSeq / GotSeq_NeedLenH / ... / Reading_Payload(remaining: usize) / Reading_CrcH / Reading_CrcL_Validate`.
3. **`drain_events()` accessor** returns 0..N completed frames + 0..N control byte events as a batch.
4. **No JS-side framing logic at all.**

Code guard location: `crates/bestialitty-core/src/slide/framer.rs`. Test with a torn-chunk corpus (mirror Phase 1's `tests/torn_chunk.rs` pattern).

**Phase to address:** Phase 1 of v1.1 (Rust framer).

---

### Pitfall 2: `ESC ^` wakeup detection that doesn't span chunk boundaries

**Severity:** BLOCKING

**What goes wrong:**
Wakeup is two bytes: `0x1B 0x5E`. Naive per-chunk scan misses across boundaries, AND `ESC ^` is a valid VT52 sequence ("enter graphics mode") that some Z80 programs may emit accidentally.

**Manifestation:**
- Failure 1: transfer never starts when slide.com runs; user sees `RDY` bytes (`0x11 0x11 0x11`) bleed into terminal display.
- Failure 2: terminal locks into SLIDE mode after some innocent program output.

**Prevention:**
1. **Detection lives in the Rust parser, not in JS.** Extend the existing escape state.
2. **Consider extending wakeup signature:** `ESC ^ S L I D E` (7 bytes — near-zero collision risk).
3. **Forward-compat fallback:** if user runs old slide.com that emits only `ESC ^`, wait ~50ms after `ESC ^` for confirmation bytes (RDY 0x11 next byte = legit; anything else = treat as VT52 graphics mode escape).
4. **Z80 version detection:** capture slide.asm version in wakeup payload (`ESC ^ S L 0 2` → "SLIDE v0.2").

How ZMODEM-over-xterm.js solves it (ecosystem precedent): ZMODEM uses `**\x18B00` (5 bytes including ZDLE) — much longer signature for exactly this reason.

**Phase to address:** Phase 2 (parser integration).

---

### Pitfall 3: CRC-16-CCITT poly direction / init / byte-order confusion

**Severity:** BLOCKING

**What goes wrong:**
"CRC-16-CCITT" is not one algorithm — it's a family of variants that disagree on:
- **Polynomial direction:** 0x1021 (msb-first, "standard") vs 0x8408 (lsb-first, bit-reversed).
- **Initial value:** 0xFFFF (CCITT-FALSE, what SLIDE uses) vs 0x0000 (XMODEM) vs 0x1D0F (CCITT-AUG).
- **RefIn / RefOut:** whether each input byte and final CRC are bit-reversed.
- **Byte order on wire:** big-endian (CRC_H first, what SLIDE uses) vs little-endian.

slide-rs and slide-py use **CCITT-FALSE specifically: poly 0x1021, init 0xFFFF, no refin/refout, xorout 0x0000, big-endian on wire**. Many "CRC-16-CCITT" libraries default to one of OTHER variants.

**Manifestation:**
- Every frame NAK'd → 15 retries → transfer aborts.
- Or worse: ~50% frames pass → looks like noisy USB cable → user blames hardware.
- Test fails: `crc16_ccitt(b"123456789")` MUST return `0x29B1`. Any other value = wrong variant.

**Prevention:**
1. **Hand-roll the CRC in Rust core**, copy-paste from slide-rs `protocol.rs:16-30` exactly. (Or use the `crc` crate v3.4 with predefined `CRC_16_IBM_3740` — SLIDE's CRC is exactly this catalogue entry. STACK research confirms.)
2. **Pin a wire-compatibility test** that asserts byte-for-byte equality against slide-rs `build_frame` output for fixed corpus.
3. **CRC bytes on wire are big-endian** (CRC_H first).
4. **CRC covers SEQ + LEN_H + LEN_L + PAYLOAD** — NOT including SOF, NOT including CRC bytes themselves.

Code guard location: `crates/bestialitty-core/src/slide/crc.rs` with reference-corpus test.

**Phase to address:** Phase 1.

---

### Pitfall 4: Backpressure ignored — `writer.write()` chained without `await writer.ready`

**Severity:** BLOCKING (sliding-window throughput) → HIGH (correctness if combined with cancellation)

**What goes wrong:**
SLIDE sends sliding window: WIN_SIZE=4 frames × 1024 = ~4 KB rapidly. Web Serial's `writer.write(bytes)` returns Promise that resolves when *internal queue* accepts bytes — NOT when bytes leave USB port. If consumer (CP2102N + Z80) is slow, OS USB buffer fills, WritableStream queue fills, `writer.write()` Promises take arbitrary time.

Two failure modes:
1. **Naive parallel writes:** all 4 promises fire simultaneously; if receiver NAKs frame 2, frames 3-4 already queued — can't pull back. NAK-driven retransmit becomes incoherent.
2. **Sequential await without `writer.ready`:** seems safe, but `writer.write()` resolves on queue-accept, not byte-out. If receiver hangs, Promise never resolves — cancellation can't proceed.

**Manifestation:**
- Looks fine in single-frame tests; explodes at multi-frame windows.
- Throughput at 19200 baud should be ~1900 B/s. If you see 200 B/s, backpressure is mishandled.
- Cancel button doesn't work — write loop stuck in `await writer.write()`.

**Prevention:**
1. **Use `writer.ready` as the gate, not the write Promise.**
2. **Race the write against an AbortSignal-driven Promise** for cancellation.
3. **Track in-flight write Promises in a Set** so cancellation can `Promise.allSettled` them on a teardown timeout.
4. Ban `await writer.write()` via code-review gate; the legitimate idiom is `await writer.ready; writer.write(bytes)`.

Code guard location: `www/transport/slide.js` sender-side write loop.

**Phase to address:** Phase 3 (sender-side wire driver).

---

### Pitfall 5: Cancellation race — frame in flight when user clicks Cancel

**Severity:** BLOCKING

**What goes wrong:**
User clicks Cancel mid-transfer:
- A frame is mid-write (~512 bytes already on wire).
- Reader is mid-read.
- Receiver (Z80) is mid-frame-receive on its end.

Naive `reader.cancel()` + `writer.releaseLock()` leaves wire in unknown state. Z80 sees partial frame, eventually times out, NAK arrives AFTER teardown — bytes pile up in OS buffer. Next SLIDE session sees `0x15 0x__` as garbage SOF-search and consumes random bytes.

Worse: SLIDE protocol defines `CTRL_CAN = 0x18` but slide-rs/slide-py never SEND it — only treat as "Z80 reported disk error". No defined PC→Z80 cancel signal.

**Manifestation:**
- Cancel "succeeds" but next transfer fails with "CRC mismatch" on first frame.
- Z80 hangs at SLIDE prompt — slide.com waits 30 seconds for retry.
- "Reload page" required to recover.

**Prevention:**
1. **Define cancellation protocol amendment** for SLIDE v0.2.1: PC sends `CTRL_CAN`, Z80 acknowledges with CAN echo, both sides drain. **Z80-side change.**
2. **Cancellation order:**
   1. Set `cancelRequested = true` flag.
   2. Wait for in-flight `writer.write()` to settle (Promise.allSettled, 200ms timeout).
   3. Send `CTRL_CAN` byte.
   4. Wait up to 500ms for Z80's CAN echo.
   5. Drain remaining bytes (100ms reader.read loop).
   6. **Do NOT call reader.cancel() or port.close()** — keep terminal session alive.
3. **Re-arm framer** by calling `slide.reset()`.
4. **AbortController everywhere** — propagates into `writer.ready` race and framer event loop.

Code guard location: `crates/bestialitty-core/src/slide/state.rs` `cancel()` API + `www/transport/slide.js` wire-level CAN exchange.

**Phase to address:** Phase 4 (state machine + cancellation). Playwright test: simulate Cancel at mid-frame, mid-window-ack — assert wire returns to neutral.

---

## High-Severity Pitfalls

### Pitfall 6: Tab close mid-transfer — `beforeunload` doesn't fire reliably

**Severity:** HIGH

**What goes wrong:**
Phase 5 relies on `beforeunload` for teardown. Doesn't reliably fire for:
- Browser crash, OS kill, hardware shutdown.
- Mobile-style tab eviction (Chromium discards background tabs).
- Closing entire browser window with multiple tabs.

Mid-transfer leaves wire in undefined state; Z80 file write may be partial garbage on disk.

**Prevention:**
1. **`visibilitychange` listener** in addition to `beforeunload`: send CAN if active session.
2. **Header frame includes transaction ID** (random UUID). Z80 writes file as `SLIDE.TMP`, renames to final after EOF ACK. Atomic. **Z80-side change.**
3. **Document failure mode** in human-UAT: "Closing browser mid-transfer may leave partial file on Z80 — cleanup with `era *.tmp`".
4. **Receive direction (Z80 → PC):** failure benign — partial file in JS memory dies with tab.

**Phase to address:** Phase 5 (integration).

---

### Pitfall 7: Filename collision after CP/M 8.3 uppercase truncation

**Severity:** HIGH

**What goes wrong:**
slide-rs/slide-py uppercase but don't truncate. Z80-side does the truncation. Multi-file exposes this:
- `report.txt` + `Report.txt` + `REPORT.TXT` all uppercase to `REPORT.TXT`; Z80 silently overwrites.
- `verylongname.text` + `verylongother.text` truncate to `VERYLONG.TEX`; same overwrite.

User has no visual feedback that overwrites are happening.

**Manifestation:**
- User uploads 5 files; only 1-2 land on Z80.
- Silent data loss.

**Prevention:**
1. **JS-side pre-flight collision check.** Compute post-truncation 8.3 form before opening session. If duplicates, surface chip:
   ```
   3 files would collide on the Z80 (REPORT.TXT × 3):
   [Cancel] [Send only first] [Auto-rename: REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT]
   ```
2. **Auto-rename pattern:** Windows convention `NAME.EXT`, `NAME~1.EXT`, `NAME~2.EXT`. Bounded to 9 collisions.
3. **Reject non-ASCII filenames** at JS layer.
4. **Settings option:** `Filename collision policy: [Auto-rename | Refuse | Prompt]`. Default = Prompt.

**Phase to address:** Phase 6 (UX polish).

---

### Pitfall 8: Drag-drop event collision with existing canvas pointer-selection

**Severity:** HIGH

**What goes wrong:**
v1.0 canvas has pointerdown/move/up handlers in `selection.js`. Drag-drop uses `dragenter/over/drop`. Different event types — but on Chrome the order when dropping a file:
1. `dragenter` fires.
2. `drop` fires.
3. `pointerdown` MAY fire (depends on drag source).

Risk: `pointerdown` calls `setPointerCapture` and starts drag-select state. Both handlers run; selection state left dirty.

**Manifestation:**
- Dropping file highlights random row of text after drop.
- Ghost cursor / inverse-text artifact at drop location.
- Inconsistent across Chromium versions.

**Prevention:**
1. **Drag-drop handler at wrapper level, not canvas:** attach to `#terminal-wrapper`; aggressive `e.preventDefault()`.
2. **Drop visual signal at wrapper level:** semi-transparent overlay div with `pointer-events: none`.
3. **Suppress pointer-selection while drop overlay visible:** in `selection.js:onPointerDown`, early-return if `slideDrop.isActiveOverlay()`.
4. **Test in Playwright:** fire dragenter/dragover/drop manually; assert no selection range exists post-drop.

**Phase to address:** Phase 6.

---

### Pitfall 9: Re-entrant `ESC ^` mid-session — state machine double-entry

**Severity:** HIGH

**What goes wrong:**
Z80 mid-receive. CP/M shell or buggy program emits `ESC ^` accidentally (or Z80 reboots and slide.com auto-runs from RAMdisk). Parser sees `ESC ^` while in `SlideMode { ReceivingFile { seq: 5 } }`:
1. Wakeup re-entry: parser resets to `Initial`; in-flight transfer's state lost.
2. Wakeup ignored: Z80 has actually started new session; we miss new RDY handshake.

**Manifestation:**
- "Transfer randomly fails halfway" on Z80 reboots.
- "Z80 says it sent the file but BestialiTTY shows no progress."

**Prevention:**
1. **Idempotent wakeup detection** in framer:
   - Currently `Idle` → enter SLIDE mode.
   - In `SlideMode { Initial }` → ignore (double wakeup, no harm).
   - In `SlideMode { active }` → emit warning chip "Z80 reset detected; cancelling current transfer", call `reset()`.
2. **Explicit session ID** in wakeup payload (random byte from Z80). Different ID → hard reset.
3. **State entry/exit logged** to inline error log.
4. **Don't auto-resume.** User clicks "Send again" if they want retry. Fail loudly, never silently.

**Phase to address:** Phase 4 (state machine).

---

### Pitfall 10: Chrome download throttling on multi-file receive

**Severity:** HIGH

**What goes wrong:**
Receiving 10 files = 10 `URL.createObjectURL(blob)` + synthetic anchor click sequences. Chrome's "Multiple downloads" prompt appears at >= 2 downloads in short window:
- 1st: silent.
- 2nd within ~10s: address bar prompt "This site wants to download multiple files. Allow / Block."
- Block → all subsequent silently fail.

Threshold not documented; varies across Chromium versions.

**Manifestation:**
- Multi-file works for first 1-2 files, then silently stops.
- User sees "Transfer complete" chip but only 1 file in Downloads.
- No JS-visible error.

**Prevention (priority order):**
1. **Bundle multi-file receives into single ZIP** using `fflate` (~10KB MIT). One Blob, one download, no prompt. Trade-off: one new dependency.
2. **Throttle downloads to once per ~3 seconds** to stay below threshold. Won't help for 10 files but helps for 2-3.
3. **Use File System Access API** (`showSaveFilePicker` / `showDirectoryPicker`): user picks destination once, all files saved there with no prompt. Chromium-only; aligns with stance.

**Recommendation:** Ship `showDirectoryPicker` for v1.1. Already Chromium-only.

**Phase to address:** Phase 6.

---

### Pitfall 11: Echo of auto-typed `B:SLIDE R\r` confused for protocol bytes

**Severity:** HIGH

**What goes wrong:**
PC→Z80 send flow:
1. User drops file.
2. BestialiTTY auto-types `B:SLIDE R\r`.
3. CP/M echoes back: `B:SLIDE R\r\n`.
4. CP/M loads slide.com.
5. slide.com emits `ESC ^` then `RDY`.

Risk: if `ESC ^` arrives in same chunk as the echo, eager wakeup detection might match and switch ALL preceding bytes (the echo) to SLIDE mode — corrupting the echo into "framer ate my command echo".

Second risk: BestialiTTY's auto-typed `B:SLIDE R\r` contains `S L I D E` — looks like wakeup tail signature. UNLIKELY because `\x1B\x5E` prefix isn't there, but worth flagging.

**Manifestation:**
- "Auto-send command appears twice in terminal" (echo not suppressed).
- "Sometimes transfer starts, sometimes I see garbage."
- Triple-printing if local-echo also enabled.

**Prevention:**
1. **Auto-type sets a "swallow echo" flag** for ~500ms. Parser emits bytes to swallow-buffer, compares against typed text; matches silently consumed; non-matches flush to screen.
2. **Wakeup detection in parser is single-pass byte-by-byte** (Pitfall 2's discipline). Parser sees echo bytes as terminal bytes UNTIL it hits `\x1B`.
3. **Auto-type is JS-side, not Rust-side.**
4. **Configurable timeout for auto-type:** if `\x1B\x5E` doesn't arrive within ~3s of auto-type completion, surface chip "Z80 didn't start SLIDE — is `slide.com` on B:?"

**Phase to address:** Phase 5.

---

## Medium-Severity Pitfalls

### Pitfall 12: Memory growth on large file receive

**Severity:** MEDIUM

**What goes wrong:**
Receiving 1 MB file in 1024-byte frames. Naive concatenation:
```js
const next = new Uint8Array(buffer.length + frame.length);
next.set(buffer); next.set(frame, buffer.length);
buffer = next;
```
That's O(n²) memory churn — total ~512 MB allocated to receive 1 MB.

**Prevention:**
1. **Mirror Phase 6 session-log pattern**: `chunks: Uint8Array[]`, append by reference, Blob assembled at end.
2. SLIDE-receive: `chunks.push(frame.payload); const blob = new Blob(chunks, { type: 'application/octet-stream' });`
3. **Test memory under load** in Playwright.

**Phase to address:** Phase 4.

---

### Pitfall 13: Test isolation — mock Web Serial peer that knows SLIDE protocol

**Severity:** MEDIUM

**What goes wrong:**
Mock peer needs to bidirectionally implement SLIDE (validate CRC, send ACK/NAK, handle handshake/FIN, inject errors). Naive: write parallel SLIDE in JS — could DRIFT from canonical Rust impl. Tests pass, deployment fails.

**Prevention:**
1. **Reuse Rust core via wasm in test harness.** Same `slide` module compiled to wasm acts as "other end". CRC single-source.
2. **Or:** mock peer is Python subprocess running `slide-py/slide/recv.py` against virtual serial pair. Real reference impl. Slower but rock-solid.
3. **Mock-only for fault-injection tests** (deliberately corrupt CRC, inject CAN). Clearly comment "DELIBERATE BUGS — do not use as reference."
4. **Wire-trace fixture corpus:** capture real wire traces, replay as fixed-byte-stream tests.

**Phase to address:** Phase 1 (test harness).

---

### Pitfall 14: Floating SLIDE chip lifecycle conflicts with scrollback chip

**Severity:** MEDIUM

**What goes wrong:**
v1.0 scrollback chip lives bottom-right. v1.1 SLIDE chip lives in same region. Conflicts:
1. Z-index / overlap if both visible simultaneously.
2. Snap-to-bottom: does SLIDE auto-type count as TX? If yes, scrolled-up users yanked to bottom on every auto-type.
3. Click target collision.

**Prevention:**
1. **Stack chips at opposite corners** (right + left).
2. **Define explicit collision policy:**
   - Both visible: stack vertically.
   - SLIDE active: scrollback chip suppressed.
   - Scrollback chip click does NOT cancel SLIDE.
3. **Mirror Phase 6 chip CSS pattern.**
4. **Snap-to-bottom on auto-type:** YES, treat as TX (consistent with paste).

**Phase to address:** Phase 6.

---

### Pitfall 15: Z80-side version skew — old slide.com doesn't emit `ESC ^`

**Severity:** MEDIUM

**What goes wrong:**
v1.1 depends on slide.asm change. Users may have:
- Old slide.com (v0.2 without wakeup) — BestialiTTY never enters SLIDE mode.
- Mismatched versions.
- Wrong drive (`A:SLIDE R` works, `B:SLIDE R` doesn't if slide.com only on A:).

Silent failure — BestialiTTY just keeps waiting for `ESC ^`.

**Prevention:**
1. **Auto-type fallback:** if `ESC ^` doesn't arrive within ~5s, surface chip:
   ```
   Z80 didn't respond. Possible causes:
   - slide.com is older than v0.2.1
   - slide.com isn't on B: drive
   - Z80 isn't at CP/M prompt
   [Retry] [Cancel] [Force start (assume Z80 is ready)]
   ```
2. **Wakeup includes version byte:** `ESC ^ S L 0 2 1`.
3. **Document slide.com version requirement** in README and Settings pane.
4. **Settings option:** `Compatibility mode: [Auto | Wakeup-required | Force-start (legacy)]`. Default = Auto.

**Phase to address:** Phase 5.

---

## Low-Severity Pitfalls

### Pitfall 16: SLIDE bytes leaking into session log

**Severity:** LOW

Phase 6 D-30 session log appends every RX byte. During SLIDE transfer, thousands of binary frame bytes would land in session log file.

**Prevention:** Suspend session-log append while SLIDE active. Add `sessionLogRef.pause()` / `.resume()` API.

**Phase to address:** Phase 5.

---

### Pitfall 17: Settings pane "Auto-send command" injection vector

**Severity:** LOW

User sets auto-send to `B:RM *.* ; SLIDE R\r` (joke or hostile config). BestialiTTY auto-types this on every drop, deleting Z80 files. Or paste from hostile webpage.

**Prevention:**
1. **Validate auto-send command:** alphanumeric + `:` + `\r` only. Reject `;`, pipes, control characters.
2. **Confirm prompt on first non-default value.**
3. **Display command before send:** "About to type `B:SLIDE R` to Z80 — [Cancel] [Send]". Suppressible via "don't ask again."

**Phase to address:** Phase 6.

---

### Pitfall 18: SLIDE-progress chip vs paste-pump progress overlap

**Severity:** LOW

User pastes mid-SLIDE-transfer. Paste-pump tries to write but writer is gated by SLIDE owner.

**Prevention:**
1. **Paste-pump checks `slide.isActive()` before enqueueing:** refuse with chip "Wait for transfer to finish before pasting."
2. **Keyboard typing during SLIDE:** suppress writer.write call; queue or refuse.

**Phase to address:** Phase 5.

---

## Pitfall-to-Phase Mapping Summary

| v1.1 Phase | Primary Pitfalls Addressed | Verification Gate |
|------------|---------------------------|-------------------|
| **Phase 1: Rust framer + CRC + drain-events API** | #1, #3, #13 | Torn-chunk corpus green; CRC reference vector `crc16_ccitt(b"123456789") == 0x29B1`; byte-for-byte equality with slide-rs fixtures |
| **Phase 2: Parser integration (`ESC ^` wakeup)** | #2, #11 | Wakeup detected across chunk boundaries; spurious ESC^ doesn't trigger; auto-type echo not consumed |
| **Phase 3: Sender-side wire driver** | #4, #5 | `await writer.ready` discipline; cancellation mid-frame leaves wire neutral; CAN exchange clean |
| **Phase 4: Receiver-side state machine** | #5, #9, #12 | State machine cancels cleanly; double-wakeup handled idempotently; 1MB receive memory bounded |
| **Phase 5: JS bridge + Web Serial integration** | #6, #11, #15, #16, #18 | beforeunload cleanup; auto-type fallback chip; session log paused; paste-pump gated |
| **Phase 6: UX polish** | #7, #8, #10, #14, #17 | Filename collision UX; drop event isolated; download throttle handled; chip stacking |

## Severity Rollup

- **BLOCKING (5):** #1 frame parsing, #2 wakeup detection, #3 CRC variant, #4 backpressure, #5 cancellation race
- **HIGH (6):** #6 tab close, #7 filename collision, #8 drop collision, #9 re-entrant wakeup, #10 download throttle, #11 echo confusion
- **MEDIUM (4):** #12 memory growth, #13 test mock divergence, #14 chip overlap, #15 Z80 version skew
- **LOW (3):** #16 session log pollution, #17 settings injection, #18 paste-during-SLIDE

## Confidence Assessment

| Pitfall area | Confidence | Notes |
|--------------|------------|-------|
| Web Serial chunk behavior | HIGH | Verified against Phase 5 RESEARCH chunk-handling discipline |
| CRC variant specifics | HIGH | Source-verified against slide-rs and slide-py |
| Wakeup detection across chunks | HIGH | Phase 1 parser already maintains escape state across chunks |
| Cancellation protocol | MEDIUM | SLIDE has CTRL_CAN defined but not bidirectionally implemented; v1.1 needs to extend |
| Chrome download throttle | MEDIUM | Empirical only — not documented by Chromium |
| `showDirectoryPicker` availability | HIGH | Chromium-only, BestialiTTY is Chromium-only — clean fit |
| Z80 echo timing | MEDIUM | Depends on CP/M version, baud, RTS/CTS state — UAT-only verifiable |
| Re-entrant wakeup behavior | HIGH | Logic problem, not API problem |

## Sources

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md`
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` (Rust ref impl)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/send.rs` (sender state machine)
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/recv.rs` (receiver state machine)
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py` (Python ref impl)
- `/home/ant/src/microbeast/SLIDE/README.md` (RTS/CTS hardware flow control note)
- `.planning/PROJECT.md` (v1.1 milestone scope)
- `www/transport/serial.js` (Phase 5 teardown/beforeunload/error-log)
- `www/renderer/scroll-state.js` (chip pattern precedent)
- `www/input/selection.js` (pointer-event ownership)
- `www/input/paste-pump.js` (backpressure pattern precedent)
- `.planning/phases/05-web-serial-transport/05-RESEARCH.md` (Phase 5 pitfall corpus)
- `.planning/phases/06-daily-driver-polish-session-deployment/06-RESEARCH.md` (Phase 6 chip + memory patterns)
