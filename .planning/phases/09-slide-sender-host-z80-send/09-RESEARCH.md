# Phase 9: SLIDE Sender — Host → Z80 Send - Research

**Researched:** 2026-05-08
**Domain:** Browser-side SLIDE sender — file picker + drag-drop + CP/M filename rewrite + Rust sender SM extension + JS dispatcher 'send' branch + tx-sink awaitable backpressure
**Confidence:** HIGH (every implementation question grounded in slide-rs send.rs + Phase 7 receiver SM + Phase 8 dispatcher; no novel architecture)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01..D-04 — Send entry points.** Top-bar text button `[↑ Send file]` (Unicode arrow + label, mirrors Phase 6 `[Connect] [Disconnect] [Download log] [Clear]`); hidden adjacent `<input type="file" multiple id="send-file-input">`; drag-drop overlay = full-canvas dashed border + ~10% chrome-accent tint + centred "Drop file(s) to send via SLIDE", parented to `#terminal-wrapper`, toggled via `[data-drop-target]` attribute (mirrors `[data-focused]` / `[data-scrolled-back]`); silent rejection of non-file drags at `dragenter` via `dataTransfer.types.includes('Files')`; no chip flash. NO keyboard chord in Phase 9.
- **D-05..D-07 — Filename rewrite + validation.** Inline `<dialog>` confirm modal showing rewrite list + rejected files before opening session; native `showModal()`; two buttons `[Cancel]` + `[Send N file(s)]`. CP/M-invalid set: `< > , ; : = ? * [ ]` + bytes ≥ 0x80 + control characters (< 0x20). 8.3 truncation = `String#toUpperCase()` + split on **last** dot, base→8, ext→3; dotfiles invalid; multiple-dot collapses to last-dot split. Multi-file collision detection deferred to Phase 12 (SLIDE-36).
- **D-08..D-12 — Sender SM (Rust).** Rust owns sender SM + frame builder; JS feeds payload chunks. New API: `enter_send_mode(metadata: &[u8])` + `feed_send_chunk(payload: &[u8], eof: bool)`. Metadata blob = length-prefixed records: `<u32 file_count><for each: u32 name_len, name (utf-8 bytes, already validated/uppercased), u32 size>`. Sender SM extends Phase 7 `SlideState` (NO repr(u32) renumber). Transitions: `Idle → enter_send_mode → WaitingRdy → SendingHeader (HeaderPhase) → SendingData (DataPhase) → SendingEof → next file or FinPending → Done`. New events: `EVT_FILE_COMPLETE = 8 << 16` (aux=file_idx) + `EVT_SESSION_COMPLETE = 9 << 16`. NO `std::time` in core. JS owns timing.
- **D-13..D-15 — Auto-type + dispatcher integration.** JS auto-types `B:SLIDE R\r` via existing `pushTxBytes` path (owner gate is `'terminal'`-permissive at auto-type time); Phase 8 wakeup matcher catches Z80's `ESC ^ S L I D E` response; dispatcher's wakeup-completion clause branches to `enterSendModeInternal(pendingSendSession)` (NOT `enterRecvMode()`) when `pendingSendSession !== null`. Pref hardcoded; empty-string-disables semantic preserved as code path. NO timeout in Phase 9 (Phase 11 owns SLIDE-35).
- **D-16..D-17 — Backpressure.** Extend `tx-sink.js` with `writeSlideFrameAwaitable(bytes): Promise<void>` using `await registeredWriter.ready; await registeredWriter.write(bytes)`. Sender main-loop drain shape: `while (slide.outbound_len() > 0) { const owned = drainSlideOutboundOwned(); await txSinkRef.writeSlideFrameAwaitable(owned); slide.clear_outbound(); }`. Pitfall 5 slice-before-await preserved via `view.slice()`.
- **D-18 — Progress feedback.** Silent operation; `window.__slide` introspection extended with `{ mode, state, file_idx, total_files, bytes_in_file_done, bytes_in_file_total, current_filename }`. Top-bar `[↑ Send file]` button `disabled` + label `[↑ Send file (sending…)]` while `pendingSendSession !== null` OR session active. No floating chip in Phase 9 (Phase 11 owns SLIDE-25/26).
- **D-19..D-20 — Cancel.** Sender SM honours inbound `EVT_CAN` per ADR-003 D-05 strict bidirectional: any sender state + inbound CAN → push CTRL_CAN echo → `CancelPending`. JS observes via events ring, calls `setWireOwner('terminal')`, resets `mode = 'terminal'`, console-logs abort. No user-visible Cancel UI in Phase 9 (Phase 10 owns SLIDE-27). `slide.cancel()` boundary exists from Phase 8 D-10; Phase 9 adds no new entry point.

### Claude's Discretion

- `<dialog>` modal CSS treatment — minimal styled like Phase 6 chip palette, full-width `<ul>` of rewrite/rejection rows. Planner picks readable layout.
- `pendingSendSession` queue depth = 1 (latest click wins, second click clobbers). Documented behavior.
- `SlideState` variant rename (`HeaderPhase` → `SendingHeader`?) — RECOMMENDATION: keep existing names + drive role context via existing `SlideRole` (Receiver | Sender). Lighter touch; doesn't invalidate Phase 7 receiver tests.
- Sender retry budget — match slide-rs (no upper bound on NAK retries). Sender-side `SEND_NAK_BUDGET` is a planning-time call.
- Native test corpus split — new `tests/slide_sender.rs` for end-to-end against mock receiver bot; unit-test sender SM transitions in `slide/state.rs` `#[cfg(test)] mod tests`. Boundary-shape extensions in existing 2 pin files.
- `#send-file-input` placement — hidden adjacent to button (`<input type="file" multiple hidden>`), keep DOM tree readable.
- Mock peer for sender Playwright tests — extend Phase 5 mock-serial.js with a tiny SLIDE-receiver bot (RDY → ACK(0) → ACK(seq) per window per slide-rs/recv.rs control flow). Do NOT introduce Python subprocess test rig.
- `packSendMetadata` location — `www/input/file-source.js` (knows the File shape). `slide.js` receives a fully-baked `Uint8Array`.
- Drag-drop overlay z-index — same as Phase 6 scrollback chip; `pointer-events: none` ensures no click interference.
- Auto-typed-command echo — ship Phase 9 with visible doubling per D-13. Pull-forward of swallow filter (SLIDE-14, Phase 11) only if planner judges < 30 lines and doesn't entangle with Phase 11 concerns.

### Deferred Ideas (OUT OF SCOPE)

- Floating SLIDE chip (`bottom: 8px; left: 8px`, file count + filename + N/M + percent + 2-second sliding-window throughput) — Phase 11 (SLIDE-25/26)
- User-visible Cancel button + Esc-key cancel disambiguation + post-cancel "Cancelled — N of M files transferred" chip + 200/500/100/2000 ms cancel drain timing — Phase 10 (SLIDE-27/28/30)
- Drops during active SLIDE session rejected with chip "Transfer in progress — cancel first" — Phase 11 (SLIDE-11)
- Auto-typed `B:SLIDE R\r` 500 ms swallow-echo filter — Phase 11 (SLIDE-14 + PITFALLS §11)
- `prefs.slideAutoSendCommand` pref key + Settings pane row + "show transfer summary chip" checkbox + `Compatibility mode` selector — Phase 11 (SLIDE-37/39); Phase 9 hardcodes default
- Auto-type "Z80 didn't respond" timeout chip with `[Retry] [Cancel] [Force start (legacy slide.com)]` — Phase 11 (SLIDE-35 + PITFALLS §15)
- Z80 → PC receive direction (Chrome download anchor-click + showDirectoryPicker fallback + 250 ms inter-file gap; zero-byte / sub-frame / binary edge cases; `chunks: Uint8Array[]` + `new Blob(chunks)` reassembly) — Phase 10 (SLIDE-18..24)
- Mid-session re-entrant `ESC ^ S L I D E` detection + "Z80 reset detected; cancelling current transfer" warning — Phase 10 (SLIDE-34)
- Session-log pause + paste-pump `slide.isActive()` gate + `paste-pump.cancelPaste()` on session start — Phase 11 (SLIDE-33 + PITFALLS §16/§18)
- `visibilitychange` best-effort CTRL_CAN on tab close — Phase 11 (SLIDE-31)
- Real `slidePumpOnPortLost` (currently Phase 8 no-op stub) — Phase 11 (SLIDE-32)
- Filename collision auto-rename UX (`NAME.TXT, NAME~1.TXT, NAME~2.TXT`) + drag-drop pointer-select isolation regression spec + auto-send command safety validation — Phase 12 (SLIDE-12/36/38)
- `docs/SLIDE_Z80_REQUIREMENT.md` + README + `docs/SLIDE-UAT.md` — Phase 12 (SLIDE-40/41/42)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SLIDE-07** | User can initiate file send via multi-file `<input type="file" multiple>` picker | D-01 hidden input + button click → §Standard Stack: hidden adjacent input + click forwarder; §Architecture §5 file-source.js NEW module |
| **SLIDE-08** | User can initiate file send by drag-and-drop onto `#terminal-wrapper` | D-03 overlay parented to wrapper; §Architecture §5 drag-drop wiring; §Code Examples Pattern 4 |
| **SLIDE-09** | Drag-over visual feedback shows dashed-border overlay + faint tint + "Drop file(s) to send via SLIDE" message | D-03 `[data-drop-target]` attribute mirrors `[data-scrolled-back]`; §Code Examples Pattern 5 CSS |
| **SLIDE-10** | Non-file drags rejected at `dragenter` via `dataTransfer.types.includes('Files')` filter | D-04 silent rejection; §Pitfall 8 Drag-drop event collision (already mitigated by `pointer-events: none` per ARCHITECTURE.md §5) |
| **SLIDE-13** | BestialiTTY auto-types configured command (default `B:SLIDE R\r`) before opening session; configurable; empty disables | D-13 `pushTxBytes(textEncoder.encode('B:SLIDE R\r'))` while owner='terminal'; D-14 hardcoded constant; D-13 empty-disables code path preserved for Phase 11 |
| **SLIDE-15** | Filenames auto-uppercased + truncated to CP/M 8.3 in JS before reaching Rust SM; chip displays rewrite | D-05 `<dialog>` confirm modal; D-07 truncation algorithm; §Code Examples Pattern 1 |
| **SLIDE-16** | CP/M filename validation rejects `<>,;:=?*[]`; error chip surfaces before session opens | D-05 same modal lists rejections; D-06 character set; §Code Examples Pattern 2 validateCpmFilename |
</phase_requirements>

## Summary

Phase 9 closes the SLIDE host → Z80 send path. The work is a **mechanical extension** of three already-shipped seams — Phase 7's receiver SM gets sender-side transition arms, Phase 8's dispatcher gets a `pendingSendSession` branch in its wakeup-completion clause, and Phase 5/8's tx-sink gets a Promise-returning awaitable sibling to `writeSlideFrame`. The ONE new module is `www/input/file-source.js` which owns the file picker click + drag-drop event lifecycle on `#terminal-wrapper` + the rewrite/rejection `<dialog>` confirm modal + the CP/M validation/truncation/metadata-pack helpers.

The slide-rs reference sender at `/home/ant/src/microbeast/SLIDE/slide-rs/src/send.rs:155-249` is the authoritative byte-flow contract: header frame (seq=0, null-terminated UPPERCASE filename + LE u32 size) → wait ACK(0) → window of WIN_SIZE=4 frames seq 1..N → wait ACK(eof_seq) or NAK(seq) → next file or FIN → wait FIN echo. Phase 9's Rust SM mirrors this control flow as event-driven transitions; JS owns the chunked payload feed (slicing the user's `File.arrayBuffer()` into FRAME_SIZE=1024-byte chunks) and the await-writer.ready discipline that satisfies SC#5 backpressure.

The single biggest correctness gate is **PITFALLS §4 backpressure** — `await writer.ready; await writer.write(bytes)` is the legitimate idiom; chained `await writer.write(bytes)` without `writer.ready` is BLOCKING-banned. D-16 + D-17 lock the awaitable shape; the Pitfall 5 slice-before-await discipline carries through unchanged from Phase 8's recv-mode drain.

**Primary recommendation:** Implement Phase 9 in 4 plans following the build dependency graph — (1) Rust sender SM + framer build_frame helper + EVT_* additions + boundary-pin extensions in 2 files (Wave 0/1 RED+GREEN); (2) wasm façade extension in `lib.rs` + scripts/build.sh smoke + JS-side slide.js extension (`pendingSendSession`, 'send' branch, `enterSendMode` export, sender main-loop drain) + tx-sink `writeSlideFrameAwaitable` (Wave 2); (3) NEW `www/input/file-source.js` + index.html top-bar button + drop overlay + `<dialog>` modal + CSS + main.js `wireFileSource` boot wiring (Wave 3); (4) Playwright sender-flow + mock-receiver-bot + native sender corpus end-to-end (Wave 4).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sender state machine + frame builder | Rust core (wasm-free) | — | D-08 locks; mirrors Phase 7 receiver SM in same struct/file (state.rs); slide-rs/send.rs is byte-flow authority; no `std::time` |
| Web Serial writer.ready backpressure | JS shell (transport/slide.js + tx-sink.js) | — | D-16 awaitable; CLAUDE.md "Web Serial driven from JS"; ARCHITECTURE.md Anti-Pattern 4 (no time logic in Rust) |
| File picker + drag-drop event lifecycle | JS shell (input/file-source.js NEW) | — | Browser File API; ARCHITECTURE.md §5 wrapper-level drop overlay |
| CP/M filename validation + 8.3 truncation + UTF-8 → ASCII pre-flight | JS shell (input/file-source.js) | — | D-06/D-07 lock; Rust trusts pre-validated bytes per D-09; mirrors slide-rs `build_header_frame.uppercase()` (slide-rs/protocol.rs:47-56) but with truncation added |
| Metadata blob pack (`<u32 file_count><records>`) | JS shell (input/file-source.js) | — | D-09 location; close to File source shape |
| Auto-type `B:SLIDE R\r` command | JS shell (transport/slide.js → tx-sink.pushTxBytes) | — | D-13: owner='terminal' at auto-type time, gate is permissive; reuses Phase 4/5 pushTxBytes path unmodified |
| `pendingSendSession` flag + dispatcher 'send' branch | JS shell (transport/slide.js extension) | — | D-13 + D-15 lock; Phase 8 dispatcher is the integration point |
| `<dialog>` rewrite/rejection confirm modal | JS shell (input/file-source.js) | DOM (index.html) | D-05; native `<dialog>` element + `showModal()`; small CSS in index.html |
| Top-bar `[↑ Send file]` button (disabled state during session) | DOM (index.html) + JS shell (input/file-source.js or main.js) | — | D-01 mirrors Phase 6 text-button row; D-18 disabled attribute |
| `window.__slide` introspection accessor | JS shell (transport/slide.js + main.js) | — | D-18 mirrors Phase 8 precedent; Playwright reads via `await page.evaluate(() => window.__slide.state)` |
| EVT_* / STATE_* JS-side mirror constants | JS shell (transport/slide.js) | — | EVT_FILE_COMPLETE + EVT_SESSION_COMPLETE; pinned by Rust-side boundary tests |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `<dialog>` element + `showModal()` | HTML Living Standard | Confirm modal for rewrite/rejection list (D-05) | [VERIFIED: MDN — supported in all Chromium ≥ 37; BestialiTTY is Chromium-only] Zero-dep modal with built-in focus trap, Esc-to-cancel, backdrop, ARIA `role="dialog"` |
| `await writer.ready; await writer.write(bytes)` | Web Serial / Streams API | Sender backpressure discipline (D-16, PITFALLS §4 BLOCKING) | [CITED: PITFALLS §4 + RESEARCH-confirmed] The ONLY correct pattern for multi-frame writes; `writer.ready` resolves when internal queue drains |
| `<input type="file" multiple hidden>` + button-click forwarder | HTML Living Standard | File picker (D-01) | [VERIFIED: standard pattern; mirrors Phase 6 Download log button click → Blob URL anchor pattern] |
| `dataTransfer.types.includes('Files')` | HTML5 Drag and Drop | Non-file rejection at dragenter (D-04, SLIDE-10) | [CITED: HTML Living Standard §"The DragEvent interface"] Returns 'Files' for OS file drags only; text/URL drags don't expose 'Files' |
| `[data-attr]` CSS attribute selectors | CSS Selectors Level 4 | `[data-drop-target]` overlay toggle (D-03) | [VERIFIED: Phase 6 `[data-scrolled-back]`, `[data-focused]` precedents in www/index.html lines 117/127] |
| `File.arrayBuffer()` → `Uint8Array` | File API + DOM | Read user files into wasm-feedable bytes | [VERIFIED: standard pattern; Phase 6 already uses for paste/clipboard] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `TextEncoder` (built-in) | Encoding Living Standard | Encode filename → UTF-8 bytes for metadata blob; encode `B:SLIDE R\r` for auto-type | After CP/M validation has ensured ASCII-only; standard browser global |
| `DataView` (built-in) | ECMAScript | Build `<u32 file_count><u32 name_len><name><u32 size>` metadata blob | Native LE u32 packing without manual byte shuffling |
| `Promise` + `Promise.allSettled` | ECMAScript | (Phase 10 cancel uses these; Phase 9 only needs `await`) | Phase 9 uses simple `await writer.ready; await writer.write` — no parallel writes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `<dialog>` | Custom div + `position: fixed` overlay | `<dialog>` provides focus trap + Esc-cancel + backdrop free; custom path duplicates browser code [REJECTED — D-05 explicitly chooses native] |
| `await writer.write(bytes)` chained | `await writer.ready; await writer.write(bytes)` | Chained-without-ready is the BLOCKING anti-pattern (PITFALLS §4); `writer.ready` is the correct gate |
| Per-byte FFI (`feed_send_chunk_byte`) | Bulk `feed_send_chunk(payload, eof)` | Bulk avoids 1024 FFI calls per data frame; mirrors Phase 7 `feed_chunk` recv hot path [LOCKED — D-08 lock] |
| Rust-side filename validation | JS-side validation per D-06 + D-09 | Rust trusts JS-validated bytes; no `std::String` UTF-8 check needed in core; pre-flight UX (modal) is JS-native anyway |
| Bundle multi-file send into single frame | Per-file header → data → EOF cycle | slide-rs/recv.rs is per-file; bundling diverges from cross-tool wire compat [LOCKED — D-11 transition table] |

**Installation:** No new dependencies. Uses Phase 7+8 Rust stack (no new Cargo deps) + browser-native APIs only.

**Version verification:** Phase 9 adds zero new packages. Verified against `crates/bestialitty-core/Cargo.toml` (vte 0.15 + wasm-bindgen 0.2.118, both target-gated). [VERIFIED: cargo metadata at Phase 7 close — 232 tests green; Phase 8 close — 240 tests green]

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          USER INTERACTION                                   │
│   ┌────────────────────┐         ┌──────────────────────────────────┐      │
│   │ click [↑ Send file]│         │ drag files onto #terminal-wrapper│      │
│   │ → hidden <input>   │         │ → dragenter/over/drop events     │      │
│   │   .click()         │         │ → [data-drop-target] overlay     │      │
│   └─────────┬──────────┘         └─────────────┬────────────────────┘      │
│             │ change event                     │ drop event                │
│             └──────────────┬───────────────────┘                           │
│                            ▼                                               │
│   ┌────────────────────────────────────────────────────────────────┐       │
│   │  www/input/file-source.js (NEW)                                │       │
│   │   1. Read each File via .arrayBuffer() → Uint8Array            │       │
│   │   2. validateCpmFilename(name) → { ok, reason }                │       │
│   │   3. truncateCpm83(name) → uppercase + last-dot split + 8/3   │       │
│   │   4. Build modal rows (rewrite + rejection)                    │       │
│   │   5. Show <dialog> showModal()                                 │       │
│   │   6. On [Send N files] click:                                  │       │
│   │      → packSendMetadata(survivors) → Uint8Array                │       │
│   │      → enterSendMode({ metadata, fileBytes[] })                │       │
│   └────────────────────────┬───────────────────────────────────────┘       │
└────────────────────────────┼───────────────────────────────────────────────┘
                             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│              www/transport/slide.js (Phase 8 extension)                     │
│                                                                             │
│   enterSendMode({ metadata, fileBytes[] })                                  │
│      ├─ pushTxBytes(textEncoder.encode('B:SLIDE R\r'))  ← owner='terminal'  │
│      └─ pendingSendSession = { metadata, fileBytes }                        │
│                                                                             │
│   dispatchInbound(value)  ── value reaches dispatcher via serial.js:453     │
│      ├─ mode === 'terminal' → wakeup matcher (Phase 8)                      │
│      │     └─ on 7-byte ESC^SLIDE match:                                    │
│      │           if (pendingSendSession) {                                  │
│      │               enterSendModeInternal(pendingSendSession);             │
│      │               pendingSendSession = null;                             │
│      │           } else {                                                   │
│      │               enterRecvMode();   // Phase 8 path                     │
│      │           }                                                          │
│      ├─ mode === 'recv' → feedSlide + drain (Phase 8 path unchanged)        │
│      └─ mode === 'send' → feedSlide + drain + sender main loop (NEW)        │
│                                                                             │
│   enterSendModeInternal({ metadata, fileBytes })                            │
│      ├─ slide = new SlideCtor()                                             │
│      ├─ slide.enter_send_mode(metadata)  ← Rust SM Idle → WaitingRdy        │
│      ├─ txSink.setWireOwner('slide')                                        │
│      ├─ mode = 'send'                                                       │
│      └─ kick first frame: outbound CTRL_RDY pushed by SM after entry        │
│                                                                             │
│   sender main loop (driven by inbound EVT_ACK / EVT_NAK events):            │
│      while (slide.outbound_len() > 0) {                                     │
│          const owned = drainSlideOutboundOwned();   // slice() copy         │
│          await txSinkRef.writeSlideFrameAwaitable(owned);                   │
│          slide.clear_outbound();                                            │
│      }                                                                      │
│      // Then push next data chunk if SM expects more:                       │
│      if (smExpectsMoreData) slide.feed_send_chunk(nextPayload, isEof);     │
│      // Drain again on next inbound chunk (events from feed_chunk)          │
└────────────────────────────┬───────────────────────────────────────────────┘
                             ▼ Web Serial wire (writer.write + reader.read)
┌────────────────────────────────────────────────────────────────────────────┐
│                       RUST SLIDE SENDER SM                                  │
│   crates/bestialitty-core/src/slide/state.rs (Phase 9 extension)            │
│                                                                             │
│   enter_send_mode(metadata: &[u8])                                          │
│      ├─ parse metadata: file_count + records[file_count]                    │
│      ├─ store as Vec<FileMeta { name, size }>                               │
│      ├─ push CTRL_RDY → outbound_buf                                        │
│      └─ sm_state = WaitingRdy                                               │
│                                                                             │
│   handle_framer_event(evt)  ─ sender arm matches role=Sender                │
│      WaitingRdy + EVT_RDY  → push header frame for files[0] → SendingHeader │
│      SendingHeader + EVT_ACK(0) → SendingData (or EOF if size=0)            │
│      SendingData + feed_send_chunk(payload, false)                          │
│           → outbound_buf.extend(build_frame(seq, payload)); seq++           │
│           → events.push_back(EVT_NONE)  // no event, JS drives next chunk   │
│      SendingData + feed_send_chunk(payload, true)                           │
│           → push final data frame + push zero-payload EOF frame (eof_seq)   │
│           → state stays SendingData waiting for ACK(eof_seq)                │
│      SendingData + EVT_ACK(seq) where seq == eof_seq                        │
│           → events.push_back(EVT_FILE_COMPLETE | (file_idx as u32))         │
│           → if more files: header frame for files[file_idx+1] → SendingHeader│
│           → else: push CTRL_FIN → FinPending                                │
│      SendingData + EVT_NAK(seq)                                             │
│           → rebuild + push retransmit frame for seq → outbound              │
│      any sender state + EVT_CAN  ← D-19 ADR-003                             │
│           → push CTRL_CAN echo → CancelPending                              │
│      FinPending + EVT_FIN                                                   │
│           → events.push_back(EVT_SESSION_COMPLETE) → Done                   │
│                                                                             │
│   outbound_buf:                                                             │
│      OUTBOUND_RESERVE growth — see Common Pitfall 1 (capacity for sender)   │
└────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
crates/bestialitty-core/src/
├── slide/
│   ├── mod.rs           # MODIFIED: re-export EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE
│   ├── crc.rs           # UNCHANGED
│   ├── framer.rs        # MODIFIED: + EVT_FILE_COMPLETE = 8 << 16, EVT_SESSION_COMPLETE = 9 << 16
│   │                    #           + pub fn build_frame(seq, payload, &mut Vec<u8>) helper
│   ├── state.rs         # MODIFIED: + enter_send_mode(metadata) + feed_send_chunk(payload, eof)
│   │                    #           + sender-mode arms in handle_framer_event
│   │                    #           + role gate (Receiver vs Sender) in handle_framer_event
│   │                    #           + OUTBOUND_RESERVE_SEND const for sender capacity
│   │                    #           + SendCtx { files: Vec<FileMeta>, current_file_idx, current_seq, eof_seq }
│   ├── tests.rs         # MODIFIED: + sender SM unit tests (handshake, ACK advance, NAK retx, EOF, CAN echo)
│   └── tests_only.rs    # MODIFIED: + EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE re-export
└── lib.rs               # MODIFIED: + Slide::enter_send_mode + Slide::feed_send_chunk wasm forwards

crates/bestialitty-core/tests/
├── slide_boundary_shape.rs        # MODIFIED: + sender fn-pointer pins + new EVT_* constants
├── slide_wasm_boundary_shape.rs   # MODIFIED: same mirror
└── slide_sender.rs                # NEW — end-to-end sender against in-process mock receiver

www/
├── transport/
│   └── slide.js                   # MODIFIED: + 'send' mode branch + pendingSendSession +
│                                  #          enterSendMode export + sender main-loop drain +
│                                  #          EVT_FILE_COMPLETE/EVT_SESSION_COMPLETE mirrors
├── input/
│   ├── tx-sink.js                 # MODIFIED: + writeSlideFrameAwaitable
│   └── file-source.js             # NEW — file picker + drag-drop + dialog + validation + pack
├── pkg/                           # REGENERATED by scripts/build.sh
├── index.html                     # MODIFIED: + [↑ Send file] button + hidden <input multiple> +
                                   #          drop overlay div + <dialog> + ~30 lines CSS
├── main.js                        # MODIFIED: + wireFileSource({...}) call after wireSlideDispatcher
└── tests/
    ├── transport/
    │   └── slide-sender.spec.js   # NEW — sender mock-peer end-to-end
    └── input/
        └── file-source.spec.js    # NEW — picker click, drag-drop overlay, modal flow,
                                   #       CP/M validation, non-file rejection
```

### Pattern 1: Sender SM extends in-place (no parallel struct)

**What:** Add sender-mode transitions to the existing `crate::slide::Slide` struct rather than introducing `SlideSender`. Use the existing `SlideRole` (Receiver | Sender) field as the role gate inside `handle_framer_event`.

**When to use:** Always — the receiver SM already structures `match (sm_state, evt)` as the dispatch surface; sender arms slot in the same way without duplicating the framer-event-loop driver.

**Example:**
```rust
// crates/bestialitty-core/src/slide/state.rs (MODIFIED)
// Source: extends Phase 7 Slide struct; mirror of slide-rs/send.rs:155-249 control flow

struct FileMeta {
    name: Vec<u8>,    // already CP/M-validated UTF-8 (ASCII subset) by JS
    size: u32,
}

struct SendCtx {
    files: Vec<FileMeta>,
    current_file_idx: usize,
    /// Next seq to assign for the next data frame within current file.
    /// seq=0 reserved for header; data frames start at 1 (slide-rs/send.rs:107).
    current_seq: u8,
    /// EOF marker seq = (last_data_seq + 1) wrapping at u8.
    eof_seq: u8,
}

pub struct Slide {
    framer: Framer,
    sm_state: SlideState,
    role: SlideRole,
    expected_seq: u8,         // receiver-side
    nak_retry_count: u32,
    outbound_buf: Vec<u8>,
    events: VecDeque<u32>,
    send_ctx: Option<SendCtx>, // populated by enter_send_mode
}

impl Slide {
    /// Phase 9 D-08/D-09: parse metadata blob, push CTRL_RDY, transition to WaitingRdy.
    /// Metadata layout: <u32 file_count> [<u32 name_len> <name bytes> <u32 size>]*
    pub fn enter_send_mode(&mut self, metadata: &[u8]) {
        let mut cursor = 0usize;
        let file_count = read_le_u32(&metadata[cursor..]) as usize;
        cursor += 4;
        let mut files = Vec::with_capacity(file_count);
        for _ in 0..file_count {
            let name_len = read_le_u32(&metadata[cursor..]) as usize;
            cursor += 4;
            let name = metadata[cursor..cursor + name_len].to_vec();
            cursor += name_len;
            let size = read_le_u32(&metadata[cursor..]);
            cursor += 4;
            files.push(FileMeta { name, size });
        }
        self.send_ctx = Some(SendCtx {
            files,
            current_file_idx: 0,
            current_seq: 1,
            eof_seq: 1,
        });
        self.role = SlideRole::Sender;
        self.outbound_buf.push(CTRL_RDY);  // sender RDY first per spec §Startup Handshake
        self.sm_state = SlideState::WaitingRdy;
    }

    /// Phase 9 D-08: JS pushes a data-frame payload chunk into outbound.
    /// `eof = true` means: this is the last chunk of the current file; after pushing
    /// the data frame, also push the zero-payload EOF frame (slide-rs/send.rs:184).
    pub fn feed_send_chunk(&mut self, payload: &[u8], eof: bool) {
        debug_assert!(self.role == SlideRole::Sender);
        debug_assert!(self.sm_state == SlideState::DataPhase);  // sender semantic
        let ctx = self.send_ctx.as_mut().expect("send_ctx populated");
        let seq = ctx.current_seq;
        build_frame_into(&mut self.outbound_buf, seq, payload);
        ctx.current_seq = ctx.current_seq.wrapping_add(1);
        if eof {
            // EOF marker: zero-payload frame at next seq (slide-rs/send.rs:157-161)
            ctx.eof_seq = ctx.current_seq;
            build_frame_into(&mut self.outbound_buf, ctx.eof_seq, &[]);
            // SM stays in DataPhase waiting for ACK(eof_seq); no state change here.
        }
    }
}

// Inside handle_framer_event, sender-side arms slot in alongside receiver arms:
fn handle_framer_event(&mut self, evt: u32) {
    let aux = (evt & 0xFFFF) as u8;

    // Bidirectional CAN echo (ADR-003 D-05) — applies to BOTH roles.
    if evt == EVT_CAN
        && !matches!(self.sm_state, SlideState::Done | SlideState::Error | SlideState::CancelPending)
    {
        self.outbound_buf.push(CTRL_CAN);
        self.sm_state = SlideState::CancelPending;
        return;
    }

    // Sender role gate
    if self.role == SlideRole::Sender {
        match (self.sm_state, evt) {
            (SlideState::WaitingRdy, EVT_RDY) => {
                // Z80 echoed RDY → ship header for files[0]
                self.push_header_frame(0);
                self.sm_state = SlideState::HeaderPhase;
            }
            (SlideState::HeaderPhase, EVT_ACK_KIND) if aux == 0 => {
                let ctx = self.send_ctx.as_ref().unwrap();
                let cur_file = &ctx.files[ctx.current_file_idx];
                if cur_file.size == 0 {
                    // Empty file (SLIDE-21): immediate EOF, no data frames.
                    let eof_seq = 1u8;
                    build_frame_into(&mut self.outbound_buf, eof_seq, &[]);
                    self.send_ctx.as_mut().unwrap().eof_seq = eof_seq;
                    self.sm_state = SlideState::DataPhase;
                } else {
                    self.sm_state = SlideState::DataPhase;
                    // JS drives feed_send_chunk from here.
                }
            }
            (SlideState::DataPhase, EVT_ACK_KIND) => {
                let ctx = self.send_ctx.as_ref().unwrap();
                if aux == ctx.eof_seq {
                    // File complete.
                    let file_idx = ctx.current_file_idx;
                    self.events.push_back(EVT_FILE_COMPLETE | (file_idx as u32));
                    let next_idx = file_idx + 1;
                    if next_idx < ctx.files.len() {
                        // Next file in batch.
                        self.push_header_frame(next_idx);
                        let ctx_mut = self.send_ctx.as_mut().unwrap();
                        ctx_mut.current_file_idx = next_idx;
                        ctx_mut.current_seq = 1;
                        self.sm_state = SlideState::HeaderPhase;
                    } else {
                        // Last file done — FIN.
                        self.outbound_buf.push(CTRL_FIN);
                        self.sm_state = SlideState::FinPending;
                    }
                }
                // else: window-boundary ACK; advance is implicit (no SM change).
            }
            (SlideState::DataPhase, EVT_NAK_KIND) => {
                // Rebuild and retransmit the requested seq.
                // (Implementation note: sender must keep last WIN_SIZE frames in
                // a small ring so retransmits don't require re-reading from JS.
                // See OQ-9 — alternative is "let JS re-feed_send_chunk on NAK".)
                // For Phase 9 simplicity, the sender SM tracks current_seq and
                // emits an "EVT_RETRANSMIT_NEEDED | aux" event so JS can call
                // feed_send_chunk(buffered_payload[seq], false) again.
                self.events.push_back(EVT_RETRANSMIT_NEEDED | (aux as u32));
                let ctx_mut = self.send_ctx.as_mut().unwrap();
                ctx_mut.current_seq = aux;  // rewind
            }
            (SlideState::FinPending, EVT_FIN) => {
                self.events.push_back(EVT_SESSION_COMPLETE);
                self.sm_state = SlideState::Done;
            }
            _ => { /* receiver-side arms run when role == Receiver */ }
        }
        return;
    }

    // Receiver role — Phase 7 logic unchanged.
    /* ... existing match arms ... */
}
```

[CITED: slide-rs/src/send.rs:155-249] — sender control flow shape; window-ACK advance, NAK rewind, EOF marker, FIN exchange.

### Pattern 2: JS-side CP/M validation + 8.3 truncation

**What:** Pre-flight filename normalization in JS before the metadata blob is built. Rust trusts the bytes (D-09).

**When to use:** Inside `file-source.js`'s drop/picker handler, BEFORE showing the `<dialog>` modal.

**Example:**
```js
// www/input/file-source.js (NEW)

// D-06: CP/M-invalid character set
const CPM_INVALID = new Set(['<', '>', ',', ';', ':', '=', '?', '*', '[', ']'].map(c => c.charCodeAt(0)));

export function validateCpmFilename(name) {
    if (name.length === 0) return { ok: false, reason: 'empty filename' };
    if (name.startsWith('.')) return { ok: false, reason: 'dotfiles not supported in CP/M' };
    for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        if (c < 0x20) return { ok: false, reason: `invalid control character 0x${c.toString(16).padStart(2, '0')}` };
        if (c >= 0x80) return { ok: false, reason: 'non-ASCII character (CP/M is ASCII-only)' };
        if (CPM_INVALID.has(c)) return { ok: false, reason: `invalid CP/M character '${name[i]}'` };
    }
    return { ok: true, reason: null };
}

// D-07: 8.3 truncation: uppercase, last-dot split, base→8, ext→3
export function truncateCpm83(name) {
    const upper = name.toUpperCase();
    const lastDot = upper.lastIndexOf('.');
    if (lastDot === -1) {
        return { result: upper.slice(0, 8), changed: upper !== upper.slice(0, 8) };
    }
    const base = upper.slice(0, lastDot).slice(0, 8);
    const ext  = upper.slice(lastDot + 1).slice(0, 3);
    const result = ext.length > 0 ? `${base}.${ext}` : base;
    return { result, changed: result !== upper };
}

// D-09: pack metadata blob: <u32 file_count><for each: u32 name_len, name (UTF-8), u32 size>
// File names have already passed validateCpmFilename so they're ASCII-only;
// TextEncoder is used for consistency with the Rust-side parse.
export function packSendMetadata(files) {
    const enc = new TextEncoder();
    const nameBytesArr = files.map(f => enc.encode(f.name));
    const totalLen = 4 + nameBytesArr.reduce((acc, nb, i) => acc + 4 + nb.length + 4, 0);
    const buf = new Uint8Array(totalLen);
    const dv = new DataView(buf.buffer);
    let cursor = 0;
    dv.setUint32(cursor, files.length, true /* LE */); cursor += 4;
    for (let i = 0; i < files.length; i++) {
        const nameBytes = nameBytesArr[i];
        dv.setUint32(cursor, nameBytes.length, true); cursor += 4;
        buf.set(nameBytes, cursor); cursor += nameBytes.length;
        dv.setUint32(cursor, files[i].bytes.length, true); cursor += 4;
    }
    return buf;
}
```

### Pattern 3: Native `<dialog>` confirm modal

**What:** Use the browser's built-in `<dialog>` element with `showModal()` for the rewrite/rejection list. Provides focus trap + Esc-cancel + backdrop for free.

**Example:**
```html
<!-- www/index.html addition -->
<dialog id="send-confirm-dialog">
  <form method="dialog">
    <h2 id="send-dialog-title">Sending N files via SLIDE</h2>
    <ul id="send-dialog-list"></ul>
    <p id="send-dialog-summary" hidden></p>
    <menu>
      <button type="submit" value="cancel">Cancel</button>
      <button type="submit" value="send" id="send-dialog-confirm">Send N files</button>
    </menu>
  </form>
</dialog>
```

```js
// www/input/file-source.js (NEW)
function showConfirmModal(rows, surviving) {
    const dialog = document.getElementById('send-confirm-dialog');
    const title  = document.getElementById('send-dialog-title');
    const list   = document.getElementById('send-dialog-list');
    const summary = document.getElementById('send-dialog-summary');
    const sendBtn = document.getElementById('send-dialog-confirm');

    title.textContent = `Sending ${surviving.length} file${surviving.length === 1 ? '' : 's'} via SLIDE`;
    list.innerHTML = '';
    for (const row of rows) {
        const li = document.createElement('li');
        if (row.kind === 'rewrite') {
            li.textContent = `${row.original} → ${row.rewritten}`;
        } else if (row.kind === 'unchanged') {
            li.textContent = row.original;
        } else /* rejection */ {
            li.textContent = `${row.original} — rejected: ${row.reason}`;
        }
        list.appendChild(li);
    }
    if (surviving.length === 0) {
        summary.textContent = 'All files rejected — see details above.';
        summary.hidden = false;
        sendBtn.disabled = true;
        sendBtn.textContent = 'Send 0 files';
    } else {
        summary.hidden = true;
        sendBtn.disabled = false;
        sendBtn.textContent = `Send ${surviving.length} file${surviving.length === 1 ? '' : 's'}`;
    }
    return new Promise((resolve) => {
        dialog.addEventListener('close', () => {
            resolve(dialog.returnValue === 'send');
        }, { once: true });
        dialog.showModal();
    });
}
```

### Pattern 4: Drag-drop event handlers + non-file rejection at dragenter (SLIDE-10)

**What:** Attach `dragenter` / `dragover` / `dragleave` / `drop` to `#terminal-wrapper`. Check `dataTransfer.types.includes('Files')` at dragenter; only call `preventDefault()` for file drags.

**Example:**
```js
// www/input/file-source.js (NEW)
let dragDepth = 0;  // dragenter/dragleave fire for child elements; track depth

function isFileDrag(ev) {
    return ev.dataTransfer && ev.dataTransfer.types && ev.dataTransfer.types.includes('Files');
}

function onDragEnter(ev) {
    if (!isFileDrag(ev)) return;  // D-04: silent rejection — never preventDefault, never set attribute
    ev.preventDefault();
    dragDepth++;
    if (dragDepth === 1) {
        wrapperEl.setAttribute('data-drop-target', 'true');
    }
}
function onDragOver(ev) {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();  // required for drop to fire
}
function onDragLeave(ev) {
    if (!isFileDrag(ev)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
        wrapperEl.removeAttribute('data-drop-target');
    }
}
async function onDrop(ev) {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    wrapperEl.removeAttribute('data-drop-target');
    const files = Array.from(ev.dataTransfer.files);
    if (files.length === 0) return;
    await processFiles(files);
}
```

### Pattern 5: CSS for drop overlay + dialog chrome

```css
/* www/index.html addition */
#terminal-wrapper[data-drop-target="true"]::after {
    content: "Drop file(s) to send via SLIDE";
    position: absolute;
    inset: 0;
    z-index: 6;                 /* above scrollback chip (5), below dialog */
    pointer-events: none;       /* selection still works underneath when no drop */
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
    font-size: 14px;
    color: var(--chrome-accent);
    background: color-mix(in srgb, var(--chrome-accent) 10%, transparent);
    border: 2px dashed var(--chrome-accent);
}
[data-theme="crt"] #terminal-wrapper[data-drop-target="true"]::after {
    color: var(--phosphor-fg);
    background: color-mix(in srgb, var(--phosphor-fg) 10%, transparent);
    border-color: var(--phosphor-fg);
}

#send-confirm-dialog {
    background: var(--chrome-bg);
    color: var(--chrome-fg);
    border: 1px solid var(--chrome-accent);
    padding: 16px 24px;
    font-family: inherit;
    max-width: 60ch;
}
#send-confirm-dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
}
#send-confirm-dialog ul {
    list-style: none;
    padding: 0;
    margin: 8px 0;
    max-height: 16em;
    overflow-y: auto;
}
#send-confirm-dialog li {
    padding: 2px 0;
    font-size: 13px;
}
#send-confirm-dialog menu {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 0;
    margin: 12px 0 0 0;
}
```

### Anti-Patterns to Avoid

- **Anti-pattern 1: Rust validates filenames.** D-06/D-09 lock validation in JS; Rust trusts the metadata blob bytes. Rust would otherwise need to grow `std::String` UTF-8 logic + a per-byte CP/M character check, doubling the surface area for zero benefit.
- **Anti-pattern 2: `await writer.write(bytes)` chained without `await writer.ready` first.** PITFALLS §4 BLOCKING. The `writer.ready` Promise is the gate; the `writer.write` Promise resolves when the queue accepts (NOT when bytes leave USB). Naive chaining leads to silent throughput collapse + cancel deadlock.
- **Anti-pattern 3: Per-byte FFI for data frames.** `feed_send_chunk(payload: &[u8], eof: bool)` is the bulk hot path; calling it per-byte across 1024 bytes per frame is a 1000× waste.
- **Anti-pattern 4: `std::time` in Rust core.** `tests/core_02_no_browser_deps.rs` enforces this gate. Sender retry budget is a count (NAK_BUDGET-equivalent or unbounded per slide-rs); JS owns any timeout windows.
- **Anti-pattern 5: SLIDE writes through `pushTxBytes`.** Phase 8 D-08 owner gate already silently drops keystroke writes during `'slide'` mode; sender frames go via `writeSlideFrameAwaitable` (D-16) bypassing the keystroke ring entirely.
- **Anti-pattern 6: Auto-type AFTER setting pendingSendSession.** The Phase 8 owner gate is `'slide'`-blocks-pushTxBytes; setting `pendingSendSession` and flipping owner before the auto-type would silently drop the `B:SLIDE R\r` bytes. D-13 lock: auto-type happens IMMEDIATELY before setting `pendingSendSession`, while owner is still `'terminal'`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal focus trap + Esc-cancel + backdrop | Custom div+`position:fixed`+keydown listeners | Native `<dialog>` + `showModal()` | Browser provides all three for free; D-05 explicitly chooses native |
| File picker UI | Custom drag-drop-only flow | `<input type="file" multiple hidden>` + button-click forwarder | OS-native file picker; SLIDE-07 acceptance |
| 8.3 filename truncation regex | Single regex like `/^([A-Z0-9]{1,8})\.([A-Z0-9]{1,3})$/` | Last-dot split + slice(0,8) / slice(0,3) | Regex misses multi-dot files (`my.tar.gz` → `MY.TAR.GZ`); slide-rs/protocol.rs:47 uses `Path::file_name().to_uppercase()`, no truncation; CP/M does truncation server-side. D-07 explicit |
| Backpressure timing logic | Per-frame `setTimeout` between writes | `await writer.ready` | OS USB buffer + WritableStream queue handle backpressure correctly; manual delay is incorrect at all baud rates |
| Multi-file collision detection | JS pre-flight loop comparing 8.3 names | NOTHING in Phase 9 | D-07 LOCKED — collision UX is Phase 12 (SLIDE-36); Phase 9 just shows the rewrite list |
| LE u32 byte packing | Manual `(n & 0xFF), ((n >> 8) & 0xFF), ...` | `DataView.setUint32(offset, value, true)` | Built-in, well-tested; no off-by-one risk |
| UTF-8 encoding | Manual codepoint-to-byte expansion | `TextEncoder` | Built-in browser global; D-06 ASCII-only validation already guarantees no multi-byte sequences anyway |
| SLIDE wire frame builder | Custom JS frame assembly | Rust `framer::build_frame_into(buf, seq, payload)` | Rust core owns CRC + frame shape per CLAUDE.md architecture split. D-08 lock |

**Key insight:** Phase 9 has near-zero novel logic. Every concern lands on a built-in browser API (`<dialog>`, drag/drop events, File API, Streams API `writer.ready`, `DataView`/`TextEncoder`) or an existing Phase 7/8 seam (Slide SM, dispatcher, tx-sink owner, framer build_frame). The work is integration, not invention.

## Common Pitfalls

### Pitfall 1: OUTBOUND_RESERVE too small for sender frame egress (Phase 7 receiver-only sized it at 16 bytes)

**What goes wrong:** Phase 7 set `OUTBOUND_RESERVE = 16` for receiver control bytes (RDY/ACK/NAK/CAN/FIN, ≤ 7 bytes). Sender pushes up to FRAME_SIZE+7 = 1031 bytes per data frame; a 4-frame window = ~4 KB of outbound. With reserve at 16 bytes, the Vec reallocates on first frame → `outbound_ptr()` becomes invalid → `outbound_view` cached in JS at lines 211-215 of slide.js becomes a dangling view → byte serialization corruption.

**Why it happens:** Stable-pointer discipline depends on Vec capacity being reserved upfront. The receiver-only sizing was correct for Phase 7's scope; sender extension breaks it.

**How to avoid:** Two options, planner picks:
- **Option A (RECOMMENDED):** Resize `OUTBOUND_RESERVE` constant to 4128 bytes (4 frames × 1031 bytes + 32 byte slack for control bytes mid-window). Update the stable-pointer test `slide/state.rs:tests::outbound_ptr_stable_across_feed_byte` to feed a sender-mode payload window and assert pointer stability. JS-side `OUTBOUND_VIEW_CAP = 16` constant in `transport/slide.js:78` MUST also grow to match (4128) — pinned by boundary-shape test.
- **Option B:** Introduce a separate `outbound_buf_send: Vec<u8>` with `OUTBOUND_RESERVE_SEND = 4128`, keep receiver buf at 16. Splits the API surface (`outbound_ptr` vs `outbound_send_ptr`) — REJECTED for breaking the existing JS-side single-view pattern. Mention as alternative only.

**Warning signs:** First sender frame succeeds; second frame's bytes arrive at receiver as garbage. Or: `outbound_view` shows the right bytes but Web Serial transmits zeros.

### Pitfall 2: Auto-type echo doubling printed in terminal (PITFALLS §11)

**What goes wrong:** PC auto-types `B:SLIDE R\r`. CP/M echoes back `B:SLIDE R\r\n`. The echo bytes flow through `dispatchInbound` while `mode='terminal'` → terminal renders them → user sees command typed twice in the screen output (once from local-echo if enabled, once from CP/M echo).

**Why it happens:** PITFALLS §11 — the swallow-echo filter (SLIDE-14) is a Phase 11 concern; Phase 9 ships without it per CONTEXT D-13.

**How to avoid:** **DOCUMENTED, NOT FIXED.** Phase 9 ships with visible doubling per locked D-13. Acceptable for an interactive feature where the user is watching what they typed. Phase 11 SLIDE-14 owns the 500 ms swallow filter.

**Warning signs:** Manual UAT during Phase 9 finds doubling jarring → planner has Claude's discretion to pull-forward minimal swallow filter (only if < 30 lines and doesn't entangle with other Phase 11 concerns). Default: ship without.

### Pitfall 3: pendingSendSession set BEFORE auto-type (owner gate would drop bytes)

**What goes wrong:** If the order is `setWireOwner('slide')` → `pushTxBytes('B:SLIDE R\r')`, the Phase 8 D-08 owner gate at `tx-sink.js:50` early-returns and the auto-type bytes never reach the wire.

**Why it happens:** Subtle ordering bug — easy to write `pendingSendSession = ...; pushTxBytes(autoSendCommand)` and assume order doesn't matter.

**How to avoid:** D-13 LOCKED ORDER: (1) `pushTxBytes(textEncoder.encode(autoSendCommand))` while owner is `'terminal'`, (2) THEN `pendingSendSession = { metadata, fileBytes }`. Owner stays `'terminal'` until the wakeup match flips it. Explicit comment in `enterSendMode` export documenting the order.

**Warning signs:** Z80 never wakes up; user stares at terminal; `__mockWriterLog` is empty in Playwright tests.

### Pitfall 4: Sender SM advances on EVT_ACK during sender main-loop await

**What goes wrong:** Sender main loop is in `await txSinkRef.writeSlideFrameAwaitable(owned)`. Meanwhile the read loop's `dispatchInbound` calls `slide.feed_chunk(rxBytes)` which pushes inbound EVT_ACK / EVT_NAK events into the events ring AND mutates `outbound_buf` (e.g., on EVT_ACK(eof_seq) → next-file header pushed). When the await resolves and `slide.clear_outbound()` runs, the next-file header bytes are wiped before they reach the wire.

**Why it happens:** The sender main loop assumes `outbound_buf` is monotonically written-then-cleared, but inbound events DURING the await can push more data into `outbound_buf`.

**How to avoid:** Two-step drain shape (mirror of Phase 8 dispatcher pattern):
```js
// www/transport/slide.js
async function senderMainLoop() {
    while (slide.state() !== STATE_DONE && slide.state() !== STATE_ERROR) {
        // Step 1: snapshot len, slice owned copy, await write, then clear ONLY the snapshotted len.
        const len = slide.outbound_len();
        if (len === 0) {
            // Wait for next inbound chunk to push events → outbound. (Done by dispatcher's
            // 'send' branch which already drains events + outbound after feed_chunk.)
            await new Promise(resolve => setTimeout(resolve, 0));  // yield to event loop
            continue;
        }
        const owned = drainSlideOutboundOwned();  // slice() from view[0..len]
        await txSinkRef.writeSlideFrameAwaitable(owned);
        // BUG: clear_outbound() wipes ALL bytes, including any pushed by feed_chunk
        // during the await. Solution: track len_at_drain and shift bytes manually,
        // OR drive the loop entirely from dispatcher's 'send' branch (RECOMMENDED).
        slide.clear_outbound();
    }
}
```

**RECOMMENDED FIX (preferred):** Don't run a parallel sender main loop. Instead, drive the entire sender lifecycle from the existing `dispatchInbound` 'send' branch — feed_chunk drains inbound events → events emitted (EVT_ACK etc.) → SM transitions push more outbound → drain outbound (await write) → clear → DONE. This serializes inbound→SM-step→outbound-drain so the await never overlaps with mutation. Mirrors Phase 8 recv-mode dispatcher exactly:

```js
// www/transport/slide.js
async function dispatchSendMode(value) {
    // 1. Feed inbound bytes (RX RDY/ACK/NAK/FIN) — SM pushes outbound + events.
    feedSlide(value);
    // 2. Drain events + outbound (await write).
    await drainEventsAndOutboundAwaitable();
    // 3. After ACK advanced SM, JS may need to push next data chunk.
    pumpNextDataChunkIfReady();
    // 4. Drain again if data chunk pushed.
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();
}
```

The kickoff (initial RDY → header) is triggered by `enterSendModeInternal` pushing CTRL_RDY immediately, then waiting for first inbound RDY echo to arrive at the dispatcher.

**Warning signs:** Multi-file send fails on file 2's header — receiver gets garbage SOF after file 1's EOF ACK. Or: throughput collapses to 1 frame per RX chunk.

### Pitfall 5: Multi-file batches lose track of file boundaries (slide-rs control flow nuance)

**What goes wrong:** slide-rs/send.rs:135-140 sleeps 500 ms after header ACK to "give Z80 time to create the file" and clears the input buffer. Phase 9 has no analogous step. If the Z80 hasn't fully created the file when the first data frame arrives, the file write may fail silently.

**Why it happens:** Hardware-dependent timing slack that slide-rs absorbs with `thread::sleep(500ms)`. BestialiTTY can't sleep in Rust (no `std::time`); JS-side delay would be the natural fix.

**How to avoid:** **DEFERRED to Phase 12 hardware UAT.** D-15 explicitly disables timeouts in Phase 9. Phase 12's `docs/SLIDE-UAT.md` real-hardware run will surface whether the no-delay path works on real Z80 hardware. If it fails, planner can add a 500 ms JS-side wait between header ACK and first data frame in Phase 11 or 12 (additive change; no Rust SM impact). Mock-receiver bot in Playwright tests doesn't have this latency so the gap won't surface in CI.

**Warning signs:** Real-hardware UAT shows file 1 lands successfully, file 2 truncates or has corrupted prefix. Mock-peer Playwright tests pass.

### Pitfall 6: NAK retransmit requires sender to keep last WIN_SIZE frames buffered (slide-rs/send.rs:235-244 implementation choice)

**What goes wrong:** On EVT_NAK(seq), sender must retransmit the frame for that seq. slide-rs keeps the entire file's frames in `Vec<(seq, payload)>` and rewinds `send_idx`. Phase 9's streaming model (JS feeds chunks, SM doesn't keep a buffer) cannot rebuild a previously-feed_send_chunk'd payload.

**Why it happens:** Architectural mismatch — slide-rs reads the whole file into RAM; BestialiTTY can't (1 MB+ files would inflate wasm memory unnecessarily) BUT actually CAN, because the user's File is already in JS memory (`File.arrayBuffer()` returns a Uint8Array the JS holds).

**How to avoid:** Two options, planner picks:
- **Option A (RECOMMENDED):** JS keeps the file's full Uint8Array in memory (already true — `fileBytes[]` shape from D-08). On EVT_NAK(seq), the sender SM emits an `EVT_RETRANSMIT_NEEDED | seq` event; JS sees it, computes `payload = fileBytes[currentFile].subarray((seq-1) * FRAME_SIZE, seq * FRAME_SIZE)`, calls `slide.feed_send_chunk(payload, isEof)` to push a fresh frame at that seq. Adds one event constant: `EVT_RETRANSMIT_NEEDED = 10 << 16`.
- **Option B:** Rust SM keeps a small ring of last WIN_SIZE=4 frames internally (4 KB Vec). Self-contained but doubles outbound_buf logic.

Option A is preferred because (a) JS already has the bytes, (b) Rust core stays minimal, (c) the event-driven shape matches existing EVT_* convention.

**Warning signs:** First NAK succeeds (slide-rs case), but multi-NAK or NAK across file boundary fails. Mock-peer test that injects 1 NAK at frame 3 of 5 should catch this.

### Pitfall 7: Empty-file (zero-byte) edge case (SLIDE-21, Phase 10 scope but Phase 9 sender must handle)

**What goes wrong:** User drops a zero-byte file. Sender SM receives ACK(0) for header → must immediately push EOF frame (zero-payload at seq=1) → wait ACK(1) → next file or FIN. If sender falls into the "wait for feed_send_chunk" branch instead, it stalls forever.

**Why it happens:** Nominally, files with size > 0 transition `HeaderPhase + ACK(0) → DataPhase + waiting for feed_send_chunk`. Empty files break that assumption.

**How to avoid:** Inside `handle_framer_event`'s `(SlideState::HeaderPhase, EVT_ACK_KIND)` arm with `aux == 0`, check `cur_file.size`: if zero, skip DataPhase entirely and push the EOF frame immediately. See Pattern 1 example code lines marked "SLIDE-21".

**Warning signs:** A zero-byte file in the batch hangs the session at file boundary. Test corpus must include `fixture_empty_file.txt` (0 bytes).

### Pitfall 8: Drag-depth counter for nested children (HTML5 drag-drop quirk)

**What goes wrong:** `dragenter` / `dragleave` fire repeatedly as the drag pointer crosses child element boundaries inside `#terminal-wrapper` (canvas, scrollback chip, bell overlay). Naive `wrapperEl.removeAttribute('data-drop-target')` on dragleave hides the overlay every time the pointer crosses to a child element.

**Why it happens:** HTML5 drag events bubble; dragleave fires before dragenter on the new child.

**How to avoid:** Track depth counter (Pattern 4 `dragDepth++/--`). Only set/remove the attribute at depth 0/1 transitions.

**Warning signs:** Overlay flickers as user drags over the terminal canvas. Manual UAT only — Playwright drag synthesis won't reproduce.

### Pitfall 9: Z80 emits ESC^SLIDE WITHOUT pendingSendSession (someone runs SLIDE S manually)

**What goes wrong:** User typed `B:SLIDE S MYFILE.TXT` themselves at the CP/M prompt (Z80 → PC send, Phase 10 scope). Z80 emits `ESC ^ S L I D E` to wake BestialiTTY. Phase 9's wakeup-completion clause checks `pendingSendSession` first — if null, falls through to `enterRecvMode()` which is the correct Phase 8 path. **No bug — falls through to existing Phase 8 receiver path.** Confirmed correct by D-13's defaulting branch.

**Why this is in the pitfalls list:** To prevent a planner from inadvertently REVERSING the order ("if no pendingSend then send empty session" or similar). The D-13 order MUST be: `if (pendingSendSession) enterSendModeInternal(...); else enterRecvMode();`.

**Warning signs:** Phase 8 receiver tests start failing after Phase 9 lands.

### Pitfall 10: CP/M filename truncation produces collisions (SLIDE-36 deferred)

**What goes wrong:** User drops `my-document.txt` + `my-document-final.txt` → both truncate to `MY-DOCU.TXT` → Z80 silently overwrites first with second.

**Why it happens:** D-07 LOCKED — collision detection deferred to Phase 12. Phase 9 modal shows the rewrites but doesn't flag dups.

**How to avoid:** **NOT FIXED IN PHASE 9** — the modal will show two `→ MY-DOCU.TXT` rows; the user can visually catch it. Phase 12 SLIDE-36 will add detection + auto-rename UX.

**Warning signs:** Documented limitation. Phase 12 backlog.

## Code Examples

### Native sender SM unit test (extends Phase 7 test corpus)

```rust
// crates/bestialitty-core/src/slide/state.rs, in #[cfg(test)] mod tests
// Source: mirror of Phase 7 receiver test pattern; new sender-mode sets

fn s_send(metadata: &[u8]) -> Slide {
    let mut slide = Slide::new();
    slide.enter_send_mode(metadata);
    slide
}

/// Pack a 1-file metadata blob: 1 file, name="A.TXT" (5 bytes), size=10.
fn meta_one_file() -> Vec<u8> {
    let mut m = Vec::new();
    m.extend_from_slice(&1u32.to_le_bytes());           // file_count
    m.extend_from_slice(&5u32.to_le_bytes());           // name_len
    m.extend_from_slice(b"A.TXT");                       // name
    m.extend_from_slice(&10u32.to_le_bytes());          // size
    m
}

#[test]
fn enter_send_mode_pushes_rdy_and_transitions_to_waiting_rdy() {
    let slide = s_send(&meta_one_file());
    assert_eq!(slide.state(), SlideState::WaitingRdy as u32);
    let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
    assert_eq!(buf, &[CTRL_RDY]);
}

#[test]
fn sender_handshake_ships_header_after_rdy_echo() {
    let mut slide = s_send(&meta_one_file());
    slide.clear_outbound();
    assert_eq!(slide.feed_byte(CTRL_RDY), EVT_RDY);
    assert_eq!(slide.state(), SlideState::HeaderPhase as u32);
    // Header frame: SOF + seq=0 + len + "A.TXT\0" + size_le + CRC = 17 bytes
    assert!(slide.outbound_len() >= 16);
    let buf = unsafe { std::slice::from_raw_parts(slide.outbound_ptr(), slide.outbound_len()) };
    assert_eq!(buf[0], SOF);
    assert_eq!(buf[1], 0);  // header seq
}

#[test]
fn sender_window_ack_advances_to_eof_and_completes_file() {
    /* drive header → ACK(0) → push 4 data frames → ACK(eof_seq) → EVT_FILE_COMPLETE */
}

#[test]
fn sender_nak_emits_retransmit_event() {
    /* drive into DataPhase, feed NAK, assert EVT_RETRANSMIT_NEEDED in events ring */
}

#[test]
fn sender_empty_file_skips_data_phase() {
    /* size=0 file: ACK(0) immediately pushes EOF frame, no feed_send_chunk needed */
}

#[test]
fn sender_inbound_can_echoes_and_transitions_to_cancel_pending() {
    /* D-19 ADR-003: any sender state + EVT_CAN → push CTRL_CAN, → CancelPending */
}

#[test]
fn sender_multi_file_batch_advances_through_files_then_fin() {
    /* 2-file metadata: ACK(0) → data → ACK(eof) → EVT_FILE_COMPLETE(0) → header for file 1 → ... → FIN */
}

#[test]
fn outbound_ptr_stable_across_sender_window_pushes() {
    /* Reserve test: push 4 full FRAME_SIZE frames, assert ptr unchanged from new() */
    let mut slide = s_send(&meta_one_file());
    let ptr_before = slide.outbound_ptr();
    slide.feed_byte(CTRL_RDY);
    // Drive through ACK(0), push 4 data frames (1024 bytes each)
    /* ... */
    assert_eq!(slide.outbound_ptr(), ptr_before, "OUTBOUND_RESERVE must accommodate sender window");
}
```

### Sender end-to-end against in-process mock receiver bot

```rust
// crates/bestialitty-core/tests/slide_sender.rs (NEW)
use bestialitty_core::slide::tests_only::*;

/// In-process mock receiver bot. Mirrors slide-rs/recv.rs control flow:
/// RDY → ACK(0) for header → ACK(seq) per WIN_SIZE frames → ACK(eof) → FIN-FIN.
struct MockReceiver { /* ... */ }

#[test]
fn end_to_end_single_file_3kb_byte_identical_round_trip() {
    let payload = pseudo_random_bytes(3000);  // covers 3 frames + EOF + FIN
    let metadata = pack_metadata(&[("TEST.BIN", &payload)]);
    let mut sender = Slide::new();
    sender.enter_send_mode(&metadata);
    let mut receiver_bot = MockReceiver::new();
    let mut received_bytes = Vec::new();

    // Pump until done.
    while sender.state() != SlideState::Done as u32 {
        // Drain sender outbound, feed into receiver bot.
        let out_len = sender.outbound_len();
        if out_len > 0 {
            let out_bytes = unsafe {
                std::slice::from_raw_parts(sender.outbound_ptr(), out_len).to_vec()
            };
            sender.clear_outbound();
            let response = receiver_bot.feed(&out_bytes);
            // Drain bot's response (ACK/NAK/FIN), feed into sender.
            sender.feed_chunk(&response);
        }
        // Pump sender events: on EVT_ACK in DataPhase + size > 0 + payload remaining,
        // call feed_send_chunk(next_payload_chunk, eof).
        /* ... */
    }
    assert_eq!(receiver_bot.received_bytes(0), payload);
}

#[test]
fn end_to_end_multi_file_batch_2_files_byte_identical() { /* ... */ }

#[test]
fn end_to_end_zero_byte_file_handles_immediate_eof() { /* ... */ }

#[test]
fn end_to_end_nak_retransmit_recovers_and_completes() { /* ... */ }

#[test]
fn end_to_end_inbound_can_echoes_and_transitions_to_cancel_pending() { /* ... */ }
```

### Playwright sender flow with extended mock-serial bot

```js
// www/tests/transport/slide-sender.spec.js (NEW)
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK_WITH_SLIDE_BOT } from './mock-serial-slide-bot.js';

test('SLIDE-07 — picker click flow + sender end-to-end with mock bot', async ({ page }) => {
    await page.addInitScript(SERIAL_MOCK_WITH_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#connect-button').click();
    /* wait for connection */

    // Inject a synthetic File via the picker's hidden input.
    const fileContent = 'Hello SLIDE!';
    await page.setInputFiles('#send-file-input', {
        name: 'hello.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContent),
    });

    // Modal should appear with rewrite "hello.txt → HELLO.TXT"
    await expect(page.locator('#send-confirm-dialog')).toBeVisible();
    await expect(page.locator('#send-dialog-list li').first()).toHaveText('hello.txt → HELLO.TXT');

    // Click [Send 1 file]
    await page.locator('#send-dialog-confirm').click();

    // Auto-type happens — verify B:SLIDE R\r in mock writer log
    await expect.poll(
        () => page.evaluate(() => window.__mockWriterLog.flatMap(e => e.bytes).slice(0, 10)),
        { timeout: 1000 },
    ).toEqual([0x42, 0x3A, 0x53, 0x4C, 0x49, 0x44, 0x45, 0x20, 0x52, 0x0D]);  // 'B:SLIDE R\r'

    // Mock bot replies with ESC^SLIDE wakeup
    await page.evaluate(() => window.__mockReaderPushSlideWakeup());

    // Bot replies with RDY → ACK(0) → ACK(eof_seq) → FIN
    // Sender SM should transition through all states and complete.
    await expect.poll(
        () => page.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 5000 },
    ).toBe('terminal');  // back to terminal after EVT_SESSION_COMPLETE

    // Verify the bot received the file bytes byte-identically
    expect(await page.evaluate(() => window.__mockSlideBotGetReceivedBytes(0))).toEqual([...Buffer.from(fileContent)]);
});

test('SLIDE-08 — drag-drop overlay show/hide + non-file rejection', async ({ page }) => {
    /* synthesize dragenter/over/drop events; verify [data-drop-target] toggles */
    /* dragenter with text/plain types: assert no [data-drop-target] set (D-04) */
});

test('SLIDE-15 — modal shows rewrite list correctly', async ({ page }) => {
    /* multiple files with rewrites + rejections; verify modal rows */
});

test('SLIDE-16 — modal disables Send button when all files rejected', async ({ page }) => {
    /* drop a single file with invalid char like "bad?file.txt" */
});
```

### tx-sink.js writeSlideFrameAwaitable (D-16)

```js
// www/input/tx-sink.js (extension)
export async function writeSlideFrameAwaitable(bytes) {
    if (!registeredWriter) {
        throw new Error('[tx-sink] writeSlideFrameAwaitable: no writer registered');
    }
    // PITFALLS §4 BLOCKING: writer.ready is the gate. NEVER chain await writer.write
    // without first awaiting writer.ready.
    await registeredWriter.ready;
    await registeredWriter.write(bytes);
}
```

## Runtime State Inventory

> Phase 9 is greenfield JS modules + Rust SM extensions; no rename or refactor of existing storage. This section is included for completeness because Phase 9 has data that crosses the boundary.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 9 doesn't write to localStorage, IndexedDB, or any persistent store. The `slideAutoSendCommand` pref is hardcoded (D-14); Phase 11 introduces the pref key. | None |
| Live service config | n/a — no external services | None |
| OS-registered state | None — file picker uses transient `<input>` element, drag-drop is event-driven, downloads are Phase 10's concern | None |
| Secrets/env vars | None | None |
| Build artifacts | `www/pkg/bestialitty_core.js` regenerated by `scripts/build.sh` after Rust SM additions; same artifact path as Phase 7/8. After rebuild, USERS NEED HARD RELOAD (Ctrl+Shift+R) per MEMORY.md `project_wasm_cache_workflow` because soft reload serves stale wasm. Document in plan. | Re-run `scripts/build.sh` after every Rust change; document hard-reload requirement in plan task descriptions |

## Open Questions Resolutions

These are the OQ-1..OQ-13 from the task brief. Each resolution is one of: RESOLVED (answer + cited source), DEFERRED to plan-time (planner picks within Claude's Discretion bounds), or DEFERRED to Phase 10/11/12.

### OQ-1: Should `framer.rs` add a `pub fn build_frame(seq, payload, &mut Vec<u8>)` helper? **RESOLVED.**

Yes — add `pub fn build_frame_into(buf: &mut Vec<u8>, seq: u8, payload: &[u8])`. Returns `()`; appends bytes to caller's buffer (so sender SM extends `outbound_buf` directly, no allocation). Visibility: `pub` (consumed by `state.rs` sender arms; same visibility as Phase 7 framer surface). Mirrors slide-rs/protocol.rs:33-44 algorithmically but writes into a caller-provided buffer rather than allocating a new `Vec<u8>`.

```rust
// crates/bestialitty-core/src/slide/framer.rs (extension)
/// Build a complete wire frame into `buf`: SOF + SEQ + LEN_HI + LEN_LO + PAYLOAD + CRC_HI + CRC_LO.
/// Mirrors slide-rs/protocol.rs:33-44 byte-for-byte. Allocation-free when buf has reserved capacity.
pub fn build_frame_into(buf: &mut Vec<u8>, seq: u8, payload: &[u8]) {
    let length = payload.len();
    let len_hi = (length >> 8) as u8;
    let len_lo = (length & 0xFF) as u8;
    // Compute CRC over [seq, len_hi, len_lo, ...payload]
    let mut crc_buf = Vec::with_capacity(3 + length);  // small alloc, hot path concern minor
    crc_buf.push(seq); crc_buf.push(len_hi); crc_buf.push(len_lo);
    crc_buf.extend_from_slice(payload);
    let crc = crc16_ccitt(&crc_buf);
    // Emit frame
    buf.push(SOF); buf.push(seq); buf.push(len_hi); buf.push(len_lo);
    buf.extend_from_slice(payload);
    buf.push((crc >> 8) as u8); buf.push((crc & 0xFF) as u8);
}
```

[CITED: slide-rs/src/protocol.rs:33-44] — algorithm; the change is signature shape (caller-provided buf).

### OQ-2: OUTBOUND_RESERVE growth strategy. **RESOLVED.**

**Resolution:** Grow the existing `OUTBOUND_RESERVE` to **4128 bytes** (4 frames × 1031 bytes + 32 bytes slack for control bytes mid-window). Single Vec, single accessor triple, single JS-side cached view. See Common Pitfall 1 for full rationale; Option A preferred over Option B (separate sender Vec).

JS-side `OUTBOUND_VIEW_CAP = 16` constant in `www/transport/slide.js:78` MUST grow to **4128** in lockstep. The boundary-shape pin should add an assertion `OUTBOUND_RESERVE >= 4128` to catch future shrinkage.

The stable-pointer test `slide/state.rs:tests::outbound_ptr_stable_across_feed_byte` should be **extended** with a new sibling test `outbound_ptr_stable_across_sender_window_pushes` that drives `enter_send_mode` + 4 frames of `feed_send_chunk` and asserts the pointer didn't move. Existing receiver-side stable-pointer test stays as-is.

### OQ-3: Sender SM transition specifics — exact interaction between feed_send_chunk(eof=true) and EVT_ACK(eof_seq). **RESOLVED — see Pattern 1 example code.**

Resolution: `feed_send_chunk(payload, eof=true)` pushes BOTH the final data frame at `current_seq` AND the zero-payload EOF frame at `current_seq + 1`. State stays in `DataPhase`. The SM advances on subsequent inbound `EVT_ACK(eof_seq)` — ack of the EOF marker triggers the next-file-or-FIN branch. Mirrors slide-rs/send.rs:184-189 (EOF appended to last window) + slide-rs/send.rs:226-231 (`if acked_seq == eof_seq, send_idx = total_frames`).

### OQ-4: Multi-file send — how does sender SM cycle through metadata records? **RESOLVED.**

Resolution: SM tracks `send_ctx.current_file_idx` + `send_ctx.current_seq`. JS calls `feed_send_chunk(payload_chunk, isLastChunkOfFile)` repeatedly per file (one call per FRAME_SIZE chunk; final call with `eof=true`). After the SM emits `EVT_FILE_COMPLETE | file_idx` (on ACK of EOF) and pushes the next file's header frame, JS observes `EVT_FILE_COMPLETE`, advances its own `currentFile` cursor, and starts feeding chunks of the next file. The SM and JS tracking move in lockstep via the shared event ring.

JS-side per-file pump:
```js
// www/transport/slide.js (sender pump, called from dispatchSendMode)
function pumpNextDataChunkIfReady() {
    const st = slide.state();
    if (st !== STATE_DATA_PHASE) return;
    const ctx = currentSendCtx;  // { fileBytes[], currentFileIdx, sentBytesInFile }
    const file = ctx.fileBytes[ctx.currentFileIdx];
    if (ctx.sentBytesInFile >= file.length) return;  // SM is mid-await on ACK
    const chunkStart = ctx.sentBytesInFile;
    const chunkEnd = Math.min(chunkStart + FRAME_SIZE, file.length);
    const payload = file.subarray(chunkStart, chunkEnd);
    const isEof = chunkEnd === file.length;
    slide.feed_send_chunk(payload, isEof);
    ctx.sentBytesInFile = chunkEnd;
    // After feeding, drain outbound (Pitfall 4 serialized shape).
}
```

On `EVT_FILE_COMPLETE | aux`:
```js
// transport/slide.js drain loop
function handleEvent(evt) {
    const kind = evt >>> 16;
    const aux  = evt & 0xFFFF;
    if (kind === EVT_FILE_COMPLETE) {
        const ctx = currentSendCtx;
        ctx.currentFileIdx = aux + 1;  // SM tells us which file just completed
        ctx.sentBytesInFile = 0;
        // SM has already pushed next file's header onto outbound; nothing more to do here.
    }
    if (kind === EVT_SESSION_COMPLETE) {
        exitSendMode();
    }
}
```

### OQ-5: Sender backpressure interaction — does sender main loop poll take_event_packed between window writes? **RESOLVED.**

Resolution: NO parallel sender main loop (see Pitfall 4). The entire sender lifecycle is driven from `dispatchSendMode` (called from `dispatchInbound` 'send' branch when a chunk arrives). Inbound RX bytes carry the events that advance the SM; the dispatcher's drain shape ensures `feed_chunk → drain_events → drain_outbound (await write) → pump_next_data_chunk → drain_outbound` runs serially per inbound RX chunk. No race between the await and SM mutation.

The only exception: the very first sender-side write (CTRL_RDY) is pushed during `enter_send_mode` BEFORE any RX arrives. `enterSendModeInternal` must trigger an immediate drain after entering send mode:
```js
function enterSendModeInternal({ metadata, fileBytes }) {
    if (slide && typeof slide.free === 'function') slide.free();
    slide = new SlideCtor();
    slide.enter_send_mode(metadata);  // pushes CTRL_RDY
    currentSendCtx = { fileBytes, currentFileIdx: 0, sentBytesInFile: 0 };
    txSinkRef.setWireOwner('slide');
    mode = 'send';
    // Drain the initial CTRL_RDY immediately. await is fine here because dispatchInbound
    // hasn't started reading the next chunk yet.
    drainEventsAndOutboundAwaitable();  // fire-and-forget (Promise) — JS continues, RX read loop
                                         // will pick up Z80's RDY echo when it arrives.
}
```

### OQ-6: pendingSendSession queue depth — depth-1 latest-wins. **RESOLVED.**

Resolution: depth-1, latest user-initiated send wins. Second click while `pendingSendSession !== null` clobbers the queued metadata. Documented behavior. Mitigation in Phase 9: top-bar button `disabled` while pending (D-18); user can't easily click twice. Drag-drop second drop while pending: `processFiles` short-circuits if `pendingSendSession || mode !== 'terminal'` and console-logs "send already in flight, ignored" (no chip in Phase 9; chip is Phase 11).

### OQ-7: Auto-type while owner='terminal'. **RESOLVED — see Pitfall 3.**

D-13 LOCKED ORDER: `pushTxBytes(textEncoder.encode(autoSendCommand))` BEFORE `pendingSendSession = ...`. Owner stays `'terminal'`-permissive at auto-type time; gate flips to `'slide'` only after wakeup match in `enterSendModeInternal`. Phase 8 owner gate at `tx-sink.js:50` only blocks during `owner === 'slide'`.

### OQ-8: Multi-file metadata packing JS exact byte layout. **RESOLVED.**

Resolution: D-09 LOCKED LAYOUT:
```
Offset  Bytes  Field
0       4      file_count (u32 LE)
For each file:
  +0    4      name_len (u32 LE)
  +4    name_len bytes  name (UTF-8, ASCII subset after CP/M validation)
  +N    4      size (u32 LE)
```

NOT the slide-rs `build_header_frame` shape (which is `name + 0x00 + size_le_u32` — null-terminated). The metadata blob is a Phase 9 internal contract between JS and Rust SM; Rust SM uses it to BUILD slide-rs-compatible header frames internally. The slide-rs format applies to the wire frame, not the metadata blob.

Cross-check: slide-rs/protocol.rs:47-56 `build_header_frame` produces `payload = name.into_bytes() + b'\0' + filesize.to_le_bytes()` for the wire. Rust SM's internal `push_header_frame(file_idx)` builds this from `send_ctx.files[file_idx]`:
```rust
fn push_header_frame(&mut self, file_idx: usize) {
    let ctx = self.send_ctx.as_ref().unwrap();
    let file = &ctx.files[file_idx];
    let mut payload = Vec::with_capacity(file.name.len() + 1 + 4);
    payload.extend_from_slice(&file.name);
    payload.push(0);                                 // null terminator
    payload.extend_from_slice(&file.size.to_le_bytes());
    build_frame_into(&mut self.outbound_buf, 0, &payload);
}
```

### OQ-9: Sender retry budget. **DEFERRED to plan-time within Claude's Discretion.**

Default per CONTEXT: match slide-rs (no upper bound — slide-rs/send.rs:194-208 just retries the window indefinitely on NAK/timeout). Plan-time alternative: introduce `SEND_NAK_BUDGET = 15` mirroring receiver-side `NAK_BUDGET`. Recommendation: ship Phase 9 with no budget (match slide-rs); add `SEND_NAK_BUDGET` if Phase 12 hardware UAT shows infinite retries hang the wire on flaky USB cables. Trivial to add (single field + check); skip until evidence demands it.

### OQ-10: Test corpus design — mock peer reuses Rust receiver wasm? **RESOLVED.**

Resolution: **Hand-write a JS receiver bot** in extended `mock-serial.js`. NOT a Rust-wasm receiver embedded in the test page. Rationale:
- The test page is the SUT; embedding a second `Slide` instance for receive-mode would require a second wasm load + careful state isolation, doubling complexity for no fault-isolation benefit.
- The hand-written JS bot is ~150 lines (RDY echo, ACK every 4 frames, FIN echo, optional NAK injection) — trivial to maintain.
- Mock-peer-bot is INTENTIONALLY a parallel implementation; PITFALLS §13 explicitly tags this as the "deliberately divergent test rig" so a SLIDE protocol drift in the production Rust core CAN'T be masked by a sympathetic bug in the mock peer.
- Native cargo tests (`tests/slide_sender.rs`) will use a Rust mock receiver in-process — that path provides cross-validation against the JS bot (any drift triggers a 3-way disagreement: prod core vs Rust mock vs JS bot).

Mock bot code lives in `www/tests/transport/mock-serial-slide-bot.js` (NEW), extends `mock-serial.js` SERIAL_MOCK with a SLIDE-receiver state machine that watches `__mockWriterLog`, parses inbound frames, generates ACK/NAK/FIN responses via `__mockReaderPush`. Spec hooks: `window.__mockSlideBotInjectNak(seq)`, `window.__mockSlideBotGetReceivedBytes(file_idx)`.

### OQ-11: `<dialog>` modal CSS — focus pin, Esc-to-cancel, pointer-down outside dismisses. **RESOLVED — see Pattern 5 + Pattern 3.**

Resolution: Native `<dialog>` provides Esc-to-cancel for free (built-in browser behavior; the dialog closes with `returnValue = ''`). Initial focus on Send button: set `autofocus` on the Send button OR call `sendBtn.focus()` after `dialog.showModal()`. Pointer-down outside dialog: native `<dialog>` does NOT dismiss on backdrop click (intentional — the user must explicitly click Cancel). Phase 9 default = native behavior; planner can add backdrop click → close listener if UAT prefers.

### OQ-12: Filename validation — Unicode (`résumé.txt`). **RESOLVED — see Pattern 2.**

Resolution: D-06 LOCKS — bytes ≥ 0x80 are rejected as "non-ASCII (CP/M is ASCII-only)". The validation runs on `name.charCodeAt(i)` (UTF-16 code unit) — for Unicode characters in the BMP this matches the codepoint; for surrogate pairs, the high surrogate is ≥ 0xD800 ≥ 0x80 so it triggers rejection on the first half. Adequate for Phase 9. The regex/codepoint check uses `for (let i = 0; i < name.length; i++) { const c = name.charCodeAt(i); if (c >= 0x80) return rejected; }`.

### OQ-13: Stable-pointer test update. **RESOLVED — see OQ-2.**

`slide/state.rs:tests::outbound_ptr_stable_across_feed_byte` (existing receiver test) keeps its current scope. Phase 9 adds a sibling test `outbound_ptr_stable_across_sender_window_pushes` that proves OUTBOUND_RESERVE growth is sufficient for sender mode.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 7 receiver-only `OUTBOUND_RESERVE = 16` | Phase 9 sender-extended to 4128 (4 frames × 1031 + slack) | Phase 9 sender SM extension | Vec capacity sized for sender window; stable-pointer discipline preserved across role swap |
| Phase 7/8 single Slide instance lifecycle, receiver-only entry via `enter_recv_mode()` | Phase 9 dual-role entry via `enter_recv_mode()` OR `enter_send_mode(metadata)`, `SlideRole` field gates which arms run in `handle_framer_event` | Phase 9 sender SM | One struct, two role surfaces; mirrors slide-rs's single Slide-style API |
| Phase 8 `writeSlideFrame` fire-and-forget (1-byte control writes) | Phase 9 `writeSlideFrameAwaitable` (multi-frame data writes need writer.ready gate) | Phase 9 sender wire driver | PITFALLS §4 BLOCKING fix; backpressure correctness |
| Phase 8 dispatcher 'recv' branch only | Phase 9 'send' branch added; wakeup-completion clause checks `pendingSendSession` first | Phase 9 dispatcher extension | Branch is mechanical; no architectural delta |

**Deprecated/outdated:**
- None — Phase 9 is purely additive. No Phase 7/8 contract is invalidated.

## Assumptions Log

> All claims tagged `[ASSUMED]` in this research below. Most claims are CITED or VERIFIED; the unassumed claims are flagged for user/planner confirmation if the planner thinks the answer matters.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Phase 8 owner gate at `tx-sink.js:50` does NOT block when owner is `'terminal'`, only when owner is `'slide'`. [VERIFIED: read `www/input/tx-sink.js:50` directly — `if (owner === 'slide') return;`] | Pitfall 3, OQ-7 | Auto-type would silently drop; D-13 invalidated |
| A2 | The mock-peer Playwright harness can synthesize SLIDE wakeup + RDY/ACK responses via the existing `__mockReaderPush(bytes)` hook in `mock-serial.js`. [VERIFIED: `www/tests/transport/mock-serial.js:176-187` — push bytes resolve pending read() with chunk] | OQ-10, Code Examples | Sender Playwright tests fail to drive end-to-end flow |
| A3 | `<dialog>` native showModal is Chromium-supported in BestialiTTY's target environment. [CITED: BestialiTTY is Chromium-only per CLAUDE.md; `<dialog>` shipped in Chromium 37 (2014); current target is Chromium >= 89 per main.js comments about top-level await] | Pattern 3, D-05 | Modal doesn't render; fall back to custom div+overlay required |
| A4 | `dataTransfer.types.includes('Files')` returns true ONLY for OS file drags, not text/URL drags. [CITED: HTML Living Standard §"DataTransfer interface" — types is DOMStringList; "Files" is the constant for file drops] | D-04, SLIDE-10, Pattern 4 | Non-file rejection broken; selection drag would erroneously trigger overlay |
| A5 | slide-rs/send.rs's 500ms post-header-ACK sleep is hardware-specific timing slack that BestialiTTY can OMIT in mock-bot tests but may need on real hardware. [ASSUMED — based on slide-rs/send.rs:135-140 + Z80 CP/M file-creation latency assumption] | Pitfall 5 | Real-hardware Phase 12 UAT shows file 2 truncates; needs Phase 11/12 fix |
| A6 | `File.arrayBuffer()` in Chromium reliably returns a `Uint8Array` view backed by the original file bytes; no encoding conversion. [CITED: File API spec — arrayBuffer() returns ArrayBuffer of the file's raw bytes] | Architecture diagram, OQ-9 | Binary `.COM` files (Phase 10 receive scope; Phase 9 send doesn't strictly send `.COM` but COULD) would corrupt |
| A7 | The Web Serial `writer.ready` Promise resolves when the WritableStream's internal queue accepts more bytes (i.e., desiredSize > 0). [CITED: WHATWG Streams spec; PITFALLS §4] | Pattern 1, D-16, Pitfall 1 | Backpressure pattern incorrect; throughput collapses |
| A8 | TextEncoder always produces UTF-8 output; ASCII filenames (post-CP/M-validation) are byte-identical between UTF-8 encoding and `.charCodeAt(i)` cast to byte. [CITED: Encoding Living Standard — TextEncoder is always UTF-8] | Pattern 2 packSendMetadata | Filename bytes garble if multi-byte UTF-8 sneaks in (but D-06 validation rejects ≥ 0x80, so this is double-locked) |

## Open Questions

These remain genuinely unresolved at research-time and should be either resolved at planning-time or accepted as Phase 9 limitations.

1. **Real-hardware 500ms post-header sleep gap (A5).**
   - What we know: slide-rs/send.rs:135-140 sleeps 500ms after header ACK; comment says "give Z80 time to create the file."
   - What's unclear: Whether the Z80 always-needs-this or whether modern slide.com is faster.
   - Recommendation: Phase 9 ships without; Phase 12 UAT validates against real MicroBeast. If it fails, add JS-side `setTimeout(500)` between header ACK and first data chunk in Phase 11 or 12 (additive — no Rust change).

2. **NAK retransmit shape — Option A (event-driven JS reseed) vs Option B (Rust-side small ring of last 4 frames).**
   - What we know: slide-rs keeps full-file Vec; Phase 9 streaming model can't.
   - What's unclear: Whether NAKs are common enough on real hardware that Option B's encapsulation benefit outweighs Option A's added EVT_RETRANSMIT_NEEDED event.
   - Recommendation: Option A (RECOMMENDED in OQ-9 / Pitfall 6) — JS keeps fileBytes anyway, computes payload at NAK time. Plan-time call.

3. **Should sender SM track an `outbound_buf_len_drained` cursor to avoid clobbering inbound-event-pushed bytes?**
   - What we know: Pitfall 4 documents the race. RECOMMENDED FIX is dispatcher-driven serialization (no separate sender main loop), which side-steps the issue.
   - What's unclear: Whether all corner cases of the dispatcher-driven approach work (e.g., sender state when no RX arrives for a long time — is the wire driven only by RX arrivals?).
   - Recommendation: dispatcher-driven approach; if Phase 9 testing reveals an "idle wire after first ACK" pathology, add a microtask-scheduled drain.

4. **Should the Phase 9 plan add a `SLIDE_FRAME_SIZE = 1024` constant import to `transport/slide.js`?** Currently FRAME_SIZE is hardcoded at multiple places (slide-rs/protocol.rs, slide/framer.rs, slide/state.rs, send.rs sender bot). JS-side hardcoding is fine for Phase 9 but could drift; planner picks whether to expose via a wasm-exported `slide_frame_size()` accessor.

## Environment Availability

> Phase 9 has no new external tool/service dependencies beyond Phase 7/8.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Cargo + rustc (wasm32-unknown-unknown target) | Rust SM extensions | ✓ (Phase 1+2) | toolchain-pinned via rust-toolchain.toml | — |
| wasm-pack | scripts/build.sh regeneration | ✓ (Phase 2) | from Phase 2 setup | — |
| Node + npm + Playwright | sender + file-source Playwright specs | ✓ (Phase 3+) | playwright ^1.51.0 (verified in www/package.json) | — |
| Chromium (system browser for Playwright) | Playwright executor | ✓ | from Phase 3 | — |
| python3 (http.server for static-site) | Playwright dev server | ✓ | from Phase 2 README | — |
| Real MicroBeast hardware (USB-serial CP2102N) | Real-hardware UAT | DEFERRED to Phase 12 | — | Phase 9 ships against mock-peer Playwright; Phase 12 owns hardware UAT |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (Rust) | `cargo test` (unit + integration tests under `crates/bestialitty-core/tests/`) |
| Framework (JS) | Playwright `^1.51.0` (chromium-only project; HiDPI deviceScaleFactor=2) |
| Config file (Rust) | `crates/bestialitty-core/Cargo.toml` |
| Config file (JS) | `www/playwright.config.js` |
| Quick run command (Rust unit) | `cargo test -p bestialitty-core slide::state::tests` |
| Quick run command (Rust integration sender) | `cargo test --test slide_sender` |
| Quick run command (Playwright @fast) | `cd www && npm run test:fast` |
| Full suite command (Rust) | `cargo test --workspace` |
| Full suite command (JS) | `cd www && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLIDE-07 | Multi-file picker triggers send via `<input type="file" multiple>` | Playwright e2e | `cd www && npx playwright test transport/slide-sender.spec.js -g "picker click flow"` | ❌ Wave 0 (NEW) |
| SLIDE-08 | Drag-drop onto `#terminal-wrapper` triggers send | Playwright e2e | `cd www && npx playwright test input/file-source.spec.js -g "drag-drop overlay"` | ❌ Wave 0 (NEW) |
| SLIDE-09 | Drag-over shows dashed-border overlay + faint tint + label | Playwright e2e + visual snapshot | `cd www && npx playwright test input/file-source.spec.js -g "overlay visible"` | ❌ Wave 0 (NEW) |
| SLIDE-10 | Non-file drags rejected at dragenter | Playwright unit | `cd www && npx playwright test input/file-source.spec.js -g "non-file rejection"` | ❌ Wave 0 (NEW) |
| SLIDE-13 | Auto-types `B:SLIDE R\r` via existing tx-sink path | Playwright e2e | `cd www && npx playwright test transport/slide-sender.spec.js -g "auto-type"` (assert __mockWriterLog content) | ❌ Wave 0 (NEW) |
| SLIDE-15 | Filenames uppercased + 8.3-truncated; rewrite shown in modal | Playwright unit + Rust unit | `cd www && npx playwright test input/file-source.spec.js -g "modal rewrite"` + `cargo test -p bestialitty-core slide::state::tests::sender_handshake_ships_header` | ❌ Wave 0 (NEW) |
| SLIDE-16 | CP/M-invalid characters rejected pre-flight | Playwright unit | `cd www && npx playwright test input/file-source.spec.js -g "modal rejection"` | ❌ Wave 0 (NEW) |
| Phase 9 SC#5 | Sender uses `await writer.ready; writer.write(bytes)` | Rust integration + Playwright e2e | `cargo test --test slide_sender end_to_end_single_file` + `cd www && npx playwright test transport/slide-sender.spec.js -g "byte-identical round-trip"` | ❌ Wave 0 (NEW) |
| Boundary contract | Sender API fn-pointer pin | Rust integration | `cargo test --test slide_boundary_shape slide_send_methods_have_stable_signatures` | ⚠️ EXTEND (file exists; new tests) |
| Boundary contract | Wasm façade fn-pointer pin | Rust integration | `cargo test --test slide_wasm_boundary_shape slide_send_methods_have_stable_signatures` | ⚠️ EXTEND |
| Boundary contract | New EVT_FILE_COMPLETE / EVT_SESSION_COMPLETE pinned | Rust integration | `cargo test --test slide_boundary_shape slide_event_constants_pinned` | ⚠️ EXTEND |
| OUTBOUND_RESERVE growth | Stable pointer across sender window | Rust unit | `cargo test -p bestialitty-core slide::state::tests::outbound_ptr_stable_across_sender_window_pushes` | ❌ Wave 0 (NEW) |

### Sampling Rate
- **Per task commit:** `cargo test -p bestialitty-core slide::` (Rust SM unit tests, < 5s)
- **Per wave merge:** `cargo test --workspace && cd www && npm run test:fast` (Rust full + Playwright @fast subset)
- **Phase gate:** `cargo test --workspace && cd www && npm test` (full Rust + full Playwright) — all green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `crates/bestialitty-core/tests/slide_sender.rs` — NEW; covers Phase 9 SC#5 byte-identical round-trip + multi-file + zero-byte + NAK retransmit + inbound CAN echo
- [ ] `crates/bestialitty-core/src/slide/state.rs` `#[cfg(test)] mod tests` — EXTEND with sender SM transition tests (handshake, ACK advance, NAK rewind, EOF, mid-send CAN echo)
- [ ] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — EXTEND with sender API fn-pointer coercions + new EVT_* assertions
- [ ] `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — EXTEND mirror
- [ ] `www/tests/transport/slide-sender.spec.js` — NEW; full sender flow against mock SLIDE bot
- [ ] `www/tests/input/file-source.spec.js` — NEW; picker click, drag-drop overlay, modal flow, CP/M validation, non-file rejection
- [ ] `www/tests/transport/mock-serial-slide-bot.js` — NEW; SLIDE-receiver bot extending `mock-serial.js` with frame parser + ACK/NAK injector hooks

*All Wave 0 gaps are net-new test files; no framework install needed (Rust + Playwright already configured from Phase 1-8).*

## Project Constraints (from CLAUDE.md)

| Directive | Where Phase 9 Honors It |
|-----------|-------------------------|
| Rust core owns parser + terminal state + key encoding; pure logic | Phase 9 sender SM extends `crates/bestialitty-core/src/slide/state.rs`; pure event-driven, no I/O, no DOM; passes `tests/core_02_no_browser_deps.rs` |
| JS shell owns Web Serial I/O, canvas rendering, event loop, browser state | Phase 9 file picker, drag-drop, dialog modal, auto-type, sender main-loop drain ALL live in JS (`www/input/file-source.js` NEW; `www/transport/slide.js` extension; `www/input/tx-sink.js` extension) |
| Rust↔JS interop uses `wasm-bindgen` + `wasm-pack` (target `web`) | Phase 9 adds `Slide::enter_send_mode` + `Slide::feed_send_chunk` to `lib.rs:wasm_boundary` (one-line forwards); `scripts/build.sh` regenerates pkg/ |
| Web Serial driven from JS, not Rust | Phase 9 `writeSlideFrameAwaitable` lives in `tx-sink.js` (JS); Rust SM never touches `web_sys::Serial*` (forbidden by `core_02_no_browser_deps.rs`) |
| Chromium-only | Phase 9 uses `<dialog>` showModal (Chromium ≥ 37), `dataTransfer.types.includes('Files')`, `await writer.ready` (Streams API in Chromium), drag-drop events — all Chromium-supported |
| Static site deploy only; no server runtime | Phase 9 adds zero server endpoints; Playwright dev server is `python3 -m http.server` only (Phase 2+) |
| VT52 pragmatic subset only — not strict DEC | Phase 9 doesn't touch parser; auto-type echo doubling (Pitfall 2) is a v1.1 known limitation |

| MEMORY.md directive | Where Phase 9 Honors It |
|---------------------|-------------------------|
| No AI attribution in commit messages | Plan-level concern; not a research deliverable. Documented for plan author. |
| Wasm rebuild requires hard reload | Phase 9 plan tasks must include "after `scripts/build.sh`, hard reload (Ctrl+Shift+R) to pick up new Slide exports" in any UAT step. Document in task action descriptions. |

## Sources

### Primary (HIGH confidence)
- **slide-rs reference impl** — `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:33-56` (build_frame + build_header_frame) + `src/send.rs:155-249` (sender SM control flow) — byte-flow authority
- **slide-py reference impl** — `/home/ant/src/microbeast/SLIDE/slide-py/slide/common.py:35-49` (build_frame + build_header_frame) — cross-validation
- **SLIDE v0.2 spec** — `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — startup handshake, FIN handshake, multi-file session flow, frame format
- **ADR-001** — `/home/ant/src/microbeast/bestialitty/.planning/decisions/ADR-001-parser-strategy.md` — vte 0.15 (parser layer untouched in Phase 9)
- **ADR-002** — `/home/ant/src/microbeast/bestialitty/.planning/decisions/ADR-002-wasm-gating.md` — wasm-bindgen target-gated to wasm32 only
- **ADR-003** — `/home/ant/src/microbeast/bestialitty/.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — bidirectional CTRL_CAN echo contract; Phase 9 D-19/D-20 implements sender side
- **ARCHITECTURE.md** — `/home/ant/src/microbeast/bestialitty/.planning/research/ARCHITECTURE.md` §1 (wasm boundary), §2 (byte-routing dispatch), §3 (TX-sink owner handoff), §5 (drag-drop wiring), §9 (build orchestration), Anti-Patterns 1, 2, 4, 5
- **PITFALLS.md** — `/home/ant/src/microbeast/bestialitty/.planning/research/PITFALLS.md` §4 BLOCKING (backpressure), §5 BLOCKING (cancellation race), §11 (auto-type echo), §13 (mock-peer drift)
- **Phase 7 receiver SM** — `crates/bestialitty-core/src/slide/state.rs` — extension target
- **Phase 7 framer** — `crates/bestialitty-core/src/slide/framer.rs:31-39` (EVT_*) + 23-29 (CTRL_*) — extension target
- **Phase 7 boundary pin** — `crates/bestialitty-core/tests/slide_boundary_shape.rs` — extension target
- **Phase 8 wasm boundary** — `crates/bestialitty-core/src/lib.rs:177-285` (Slide façade) — extension target
- **Phase 8 dispatcher** — `www/transport/slide.js` — extension target (lines 90-254)
- **Phase 5+8 tx-sink** — `www/input/tx-sink.js` (lines 105-126) — extension target
- **Phase 5 mock-serial** — `www/tests/transport/mock-serial.js` — extension target for slide-bot
- **Phase 8 dispatcher Playwright spec** — `www/tests/transport/slide-dispatcher.spec.js` — pattern template

### Secondary (MEDIUM confidence)
- **Phase 7 Plan 03 + 04 lessons** — STATE.md "Phase 7 Plan 03/04" entries — Auto-fix Rule 1 EVT_CRC_ERROR match-arm guard pattern carries to sender NAK matching
- **Phase 8 Plan 03 + 04 lessons** — STATE.md "Phase 8 Plan 03/04" entries — auto-fix Rule 1 wakeup-via-vte-string-state insight (irrelevant to sender, but informs why dispatcher tests use matcher-state introspection)

### Tertiary (LOW confidence — unverified, flagged for plan-time validation)
- A5 (slide-rs 500ms sleep is hardware-specific) — based on slide-rs comment text + Z80 CP/M-architecture inference. Not validated against real hardware. Phase 12 UAT confirms or denies.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every API native to Chromium / well-documented; no novel tooling
- Architecture: HIGH — Phase 9 extends three existing seams (Phase 7 SM, Phase 8 dispatcher, Phase 5/8 tx-sink); ARCHITECTURE.md §1-9 grounds every integration point
- Sender SM transitions: HIGH — slide-rs/send.rs:155-249 is the authoritative byte-flow reference; algorithm is mechanical mirror
- Backpressure pattern: HIGH — PITFALLS §4 explicitly documents the BLOCKING pattern; D-16 locks the awaitable shape verbatim
- Pitfalls: HIGH — every pitfall traces to a known Phase 7/8 contract that Phase 9 extension must respect; Pitfall 1 (OUTBOUND_RESERVE) and Pitfall 4 (drain-await race) are the most subtle, both have explicit resolutions
- Test corpus design: HIGH — pattern templates (Phase 7 receiver tests, Phase 5 mock-serial, Phase 8 dispatcher specs) all exist; mock-bot is hand-written ~150 lines

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (30 days for stable references; SLIDE protocol spec is frozen at v0.2.1; slide-rs is the cross-tool ground truth)

---

*Phase: 09-slide-sender-host-z80-send*
*Research complete: 2026-05-08*
