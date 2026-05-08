# Phase 10: SLIDE Receiver & Cancellation — Research

**Researched:** 2026-05-08
**Domain:** Z80 → PC SLIDE receive end-to-end (Rust SM payload extraction → JS reassembly → Chrome download → cancel/recover)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Multi-file download flow:**

- **D-01:** User-controlled "Save received files to a folder" toggle gates ALL recv sessions (single file + batch). Off (default) = always anchor-click + 250 ms inter-file gap (SLIDE-19 carry-forward). On = `showDirectoryPicker` on first activation; subsequent files write via `FileSystemFileHandle.createWritable()`. Single mental model — toggle state determines path, file count does not.

- **D-02:** Toggle UI lives in the Settings pane as a row + adjacent `[Choose folder…]` button. Mirrors Phase 4 / Phase 6 Settings-row idiom. New `prefs.js` keys: `slideRecvToFolder: false` (boolean default) and `slideRecvDirectoryHandle: null` (FileSystemDirectoryHandle, persisted to IndexedDB — NOT to `localStorage`, which can't store the handle). Pulls one Settings row forward from Phase 11.

- **D-03:** Directory persists across page reloads via IndexedDB. Store `FileSystemDirectoryHandle` (structuredClone-compatible) in an IndexedDB object store created by the prefs subsystem. On reload, re-request permission via `handle.requestPermission({ mode: 'readwrite' })` — Chrome shows one-click "Allow" for previously-granted handles; if denied, treat as off (toggle stays on but next file falls through to anchor-click and `[Choose folder…]` re-arms). Tiny `www/state/idb.js` module exposing `getRecvDirHandle()` / `setRecvDirHandle(handle)`.

- **D-04:** Picker dismissal during a session falls back to anchor-click for the remainder of that session; toggle stays on; no re-prompt. If the user cancels `showDirectoryPicker` (or denies permission on reload), continue the in-flight transfer using the anchor-click fallback path. Do not emit CTRL_CAN. Do not re-prompt the picker on the next file boundary. Settings toggle remains "on" — next recv session re-attempts the picker.

- **D-05:** Filename collision policy: append `~N` suffix (`REPORT.TXT → REPORT~1.TXT → REPORT~2.TXT → …`). Insertion point: between base and last `.` (`REPORT.TXT` → `REPORT~1.TXT`, `NOEXT` → `NOEXT~1`, `MY.TAR.GZ` → `MY.TAR~1.GZ`).

- **D-06:** Suffix retry budget: keep going up to `~999` then fall through to anchor-click for that single file. After 999 failures, route the offending file through the anchor-click path; subsequent files in the same batch continue attempting the directory path normally.

- **D-07:** SLIDE-20 acceptance ("Received files retain their CP/M 8.3 uppercase names verbatim") annotated with collision-exception clause. Verbatim applies when target name does not collide. On collision, `~N` suffix is the lesser evil vs silent overwrite. Add a one-line note to REQUIREMENTS.md SLIDE-20 referencing this CONTEXT decision.

**Carry-forward (locked from prior context, not re-asked):**

- **C-01:** Anchor-click + 250 ms inter-file gap is the toggle-OFF / fallback download path (SLIDE-19; mirror of Phase 6 session-log download anchor pattern).
- **C-02:** `chunks: Uint8Array[]` + `new Blob(chunks, { type: 'application/octet-stream' })` for memory-bounded per-file reassembly (SLIDE-24 + Phase 6 session-log mirror).
- **C-03:** Bidirectional CTRL_CAN echo + `force_idle()` 2-second escape hatch per ADR-003. Receiver SM already implements CancelPending semantics (Phase 7 D-05/D-06/D-07).
- **C-04:** 7-byte `ESC ^ S L I D E` wakeup signature per Phase 8 D-01.
- **C-05:** Per-session `new Slide()` lifecycle; no singleton reset optimization (Phase 8 dispatcher pattern).
- **C-06:** No floating SLIDE chip in Phase 10; tests assert progress via `window.__slide` introspection (Phase 9 D-18 precedent).
- **C-07:** No `std::time` in Rust core (ADR-003 + ADR-002 + `tests/core_02_no_browser_deps.rs`). All cancel timing windows live in JS.

### Claude's Discretion

- **Recv data API shape (Rust → JS surfacing of filename + per-frame payload bytes).** Three options. Default expectation: option (b) `recv_ptr / recv_len / clear_recv` accessor triple mirroring outbound triple, plus a new `EVT_HEADER_RECEIVED` event so JS knows when the filename is available.
- **Mid-session re-entrant `ESC^SLIDE` detection (SLIDE-34).** Two options. Default: option (a) JS-side wakeup matcher in `dispatchRecvMode` running in parallel with the framer feed (mirror of `dispatchTerminalMode`'s 7-byte matcher).
- **Cancel UX in Phase 10 (pre-chip).** Phase 11 owns the floating chip. Phase 10 ships with: (a) Esc-key cancel only (slot 2/4); (b) `window.__slide.cancelRecv()` programmatic accessor for Playwright. No top-bar Cancel button.
- **Esc disambiguation slot for SLIDE-cancel.** Default: insert as new step 3 in the chain: 1) Ctrl+Shift+Esc clear selection, 2) Esc + selection-dragging, 3) Esc + slide.isActive() (NEW), 4) Esc + paste-pump active, 5) Esc fallthrough → 0x1B.
- **Cancel timing windows.** PITFALLS §5 + ADR-003 verbatim: 200 ms in-flight settle / CTRL_CAN echo / 500 ms Z80-echo wait / 100 ms drain / 2000 ms absolute timeout → `force_idle()`.
- **Hard-fail recovery (SLIDE-29).** Three failure modes converge on: exit recv mode, set wire owner back to terminal, console.error the failure mode, leave open for next wakeup.
- **Receiver test mock.** Default: extend Phase 9's `tests/mock-serial-slide-bot.js` with a `role` parameter (`'recv'` or `'send'`); add a sender-role state machine.
- **`www/transport/slide-recv.js` vs in-place extension.** Default: split out a sibling `slide-recv.js` (dispatcher imports + delegates).
- **prefs.js key naming + IndexedDB store layout.** Default: `slideRecvToFolder: false` in DEFAULTS; handle in IndexedDB store `bestialitty-handles` key `recv_directory`.
- **Suffix-insertion algorithm.** Default: split on last `.`; insert `~N` immediately before the last dot; if no dot in name, append `~N` at end.
- **Per-frame download trigger timing (anchor-click path).** Default: at EOF data frame ACK. Blob constructed once from accumulated `chunks: Uint8Array[]`; anchor-click fires synchronously; chunks array reset for next file. 250 ms gap via JS-side `setTimeout` between consecutive `<a>.click()` calls.
- **Edge-case test corpus.** Default: extend `crates/bestialitty-core/tests/slide_torn_chunk.rs` with zero-byte / sub-frame / binary fixtures driven through receiver SM in native cargo test; add Playwright specs (`slide-recv.spec.js` + `slide-cancel.spec.js`).

### Deferred Ideas (OUT OF SCOPE)

- Floating SLIDE chip at `bottom: 8px; left: 8px` with file count + filename + N/M + percent + 2-second sliding-window throughput — Phase 11 (SLIDE-25, SLIDE-26).
- Chip Cancel button as primary user-visible cancel surface — Phase 11 (SLIDE-27 chip surface). Phase 10 ships with Esc-key + `window.__slide.cancelRecv()` only.
- Post-cancel "Cancelled — N of M files transferred" 5-second auto-hide chip — Phase 11 (SLIDE-28).
- Hard-fail recovery chip with "Retry" hint — Phase 11 (SLIDE-29 chip surface). Phase 10 ships with console.error only; the SM cleanup is the Phase 10 deliverable.
- Drops during active SLIDE session rejection chip — Phase 11 (SLIDE-11).
- Auto-typed `B:SLIDE R\r` 500 ms swallow-echo filter — Phase 11 (SLIDE-14).
- `prefs.slideAutoSendCommand` text input + `slideShowSummary` checkbox + `Compatibility mode` selector — Phase 11 (SLIDE-37, SLIDE-39). Phase 10's `slideRecvToFolder` is the ONLY Settings-pane SLIDE row in Phase 10.
- Auto-type "Z80 didn't respond" timeout chip — Phase 11 (SLIDE-35).
- Session-log pause + paste-pump `slide.isActive()` gate — Phase 11 (SLIDE-33).
- `visibilitychange` listener best-effort CTRL_CAN on tab close — Phase 11 (SLIDE-31).
- Real `slidePumpOnPortLost` — Phase 11 (SLIDE-32). Planner has Discretion to pull a 5-line minimum forward if natural.
- Filename collision UX on SEND — Phase 12 (SLIDE-36).
- Drag-drop pointer-select isolation regression spec — Phase 12 (SLIDE-12).
- Auto-send command safety validation — Phase 12 (SLIDE-38).
- `docs/SLIDE_Z80_REQUIREMENT.md` + README + UAT docs — Phase 12 (SLIDE-40, SLIDE-41, SLIDE-42).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SLIDE-18 | Per-file Chrome download (anchor-click); `showDirectoryPicker` opt-in fallback for batches > 1 | Standard Stack §File System Access; Architecture Pattern 3; Pitfall 1 |
| SLIDE-19 | Multi-file batches stagger ≥ 250 ms between downloads | Pitfall 1 (Chrome multi-download throttle); Pattern 4 |
| SLIDE-20 | Received files retain CP/M 8.3 uppercase names verbatim (collision exception per D-05/D-07) | Pattern 5 (suffix algorithm); reference impl `slide-rs/recv.rs:236-247` |
| SLIDE-21 | Empty (zero-byte) files transfer cleanly | Receiver SM `state.rs:494-498` (FIN at HeaderPhase); zero-byte chunks → empty Blob |
| SLIDE-22 | Sub-frame files (< 1024 bytes) transfer cleanly | Single data frame + EOF marker (`recv.rs:172-180`); already in receiver SM |
| SLIDE-23 | Binary content (`.COM`, `.HEX`) round-trips via Uint8Array end-to-end | Don't-Hand-Roll #2 (Blob preserves bytes); zero text-encoding |
| SLIDE-24 | 1 MB+ memory-bounded receive (`chunks: Uint8Array[]` + `new Blob`) | Pattern 2 (memory-bounded reassembly); Pitfall 6 (Blob construction is O(n)) |
| SLIDE-27 | Cancel via Esc key (slot 2 of 4 in disambiguation chain) | Pattern 6 (Esc disambiguation); `keyboard.js:202-227` |
| SLIDE-29 | Hard-fail recovery (CRC retries / port lost / wire desync) cleanly resets SM | Pattern 7 (3 failure-mode convergence); SM `state.rs:540-543` |
| SLIDE-30 | Cancel mid-frame leaves wire neutral (200/500/100/2000 ms windows) | Pattern 8 (cancel sequence); ADR-003 verbatim; Pitfall 3 (cancel race) |
| SLIDE-34 | Mid-stream `ESC^SLIDE` re-entry handled idempotently | Pattern 9 (re-entry matcher); Pitfall 4 (re-entrant wakeup); slide.js dispatchTerminalMode template |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Architecture split:** Rust → wasm core owns parser/SM/key-encoding (pure logic). JS shell owns Web Serial I/O, canvas rendering, browser state. **No `web-sys` / `js-sys::Serial*` / DOM in Rust.**
- **Web Serial driven from JS, not Rust.** No Rust Web Serial bindings.
- **Chromium-only.** File System Access API + IndexedDB FileSystemDirectoryHandle persistence aligns cleanly with this stance.
- **GSD workflow:** Phase 10 follows the per-phase loop (discuss → plan → execute → verify). Phases execute strictly in order; Phase 9 is complete.
- **No `std::time` in Rust core** (ADR-003 + ADR-002, enforced by `tests/core_02_no_browser_deps.rs` FORBIDDEN_TOKENS list). All cancel timing windows MUST live in JS.
- **Wasm rebuild requires hard reload** (Ctrl+Shift+R) per `MEMORY.md` — call out in plans for any task that adds new wasm exports.
- **No AI attribution in commit messages** (per memory) — never add `Co-Authored-By: Claude` or mention Claude/Anthropic.

## Summary

Phase 10 closes the SLIDE Z80→PC receive path by adding three new layers on top of the already-shipped Phase 7 receiver state machine:

1. **Rust → JS payload bridge.** The Phase 7 receiver SM already consumes header + data frames, ACKs them, and silent-drains during CancelPending. What it does NOT do is surface the bytes to JS. Adding a `recv_ptr / recv_len / clear_recv` accessor triple (mirror of the proven `outbound_*` triple) plus a new `EVT_HEADER_RECEIVED` event is sufficient — no SM logic changes required for the basic recv path. [VERIFIED: state.rs:466-555 + framer.rs:31-43]

2. **JS reassembly + download dispatch (`www/transport/slide-recv.js`).** A new sibling to `slide.js` owning the per-file `chunks: Uint8Array[]` accumulator, `new Blob(chunks)` assembly at EOF, and download dispatch. Two paths gated by the `slideRecvToFolder` Settings toggle: anchor-click + 250 ms inter-file gap (default) OR `FileSystemFileHandle.createWritable()` against a persisted `FileSystemDirectoryHandle` from IndexedDB (opt-in).

3. **Cancellation + recovery.** Esc-key cancel (slot 3 in the existing disambiguation chain), 200/500/100/2000 ms timing windows verbatim from PITFALLS §5 + ADR-003, mid-session re-entry detection mirroring the Phase 8 wakeup-matcher pattern in `dispatchTerminalMode`, and three-failure-mode convergence on a single recovery path.

**Primary recommendation:** Implement in 4 waves following the Phase 9 sender precedent: Wave 1 Rust SM extension + boundary pin → Wave 2 wasm boundary + JS plumbing (`slide-recv.js`) → Wave 3 Settings UI + IndexedDB → Wave 4 Playwright e2e + mock-bot extension + edge-case corpus.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SLIDE protocol state machine | Rust core | — | Already lives there (Phase 7); pure logic, byte-fed, torn-chunk safe |
| Header frame parsing (filename + size) | Rust core | — | Bytes already in SM via `framer.take_payload()`; null-terminated name + LE u32 size per `slide-rs/protocol.rs:47-56` |
| Recv-payload byte surfacing across wasm boundary | Rust core (accessor) + JS shell (consumer) | — | Mirror of outbound triple — proven Phase 8 pattern |
| Per-file chunks accumulator | JS shell | — | Memory-bounded `Uint8Array[]` lives in JS (mirror of session-log Phase 6); Blob assembly is browser API |
| Blob assembly + download dispatch | JS shell | Browser (Chrome download manager) | `URL.createObjectURL` + anchor-click is browser-native |
| FileSystemDirectoryHandle picker + writable | JS shell | Browser (File System Access API) | Chromium API; cannot live in Rust |
| IndexedDB handle persistence | JS shell | Browser (IndexedDB) | structuredClone of FileSystemDirectoryHandle; browser-only |
| Cancel timing (200/500/100/2000 ms) | JS shell | — | ADR-003 + ARCHITECTURE.md anti-pattern 4: NO `std::time` in Rust core |
| Cancel state transition (CancelPending) | Rust core | — | Already implemented (Phase 7 D-07); event-driven, no time logic |
| Mid-session ESC^SLIDE matcher | JS shell (`dispatchRecvMode`) | — | Mirror of Phase 8 `dispatchTerminalMode` matcher; dispatch-layer concern per ARCHITECTURE.md §2 |
| Esc disambiguation chain | JS shell (`keyboard.js`) | — | UI input layer; SLIDE-cancel slot 3 of 5 |
| Settings toggle + Choose folder button | JS shell (`index.html` + `main.js`) | — | DOM event wiring + prefs subsystem |
| Hard-fail recovery (port lost, NAK exhaust, desync) | JS shell (slide.js / slide-recv.js) | Rust core (state transition) | Rust SM transitions to Error; JS observes state and tears down |
| Edge-case test corpus | Rust native cargo test (Wave 1-corpus) + Playwright (Wave 4 e2e) | — | Two-layer coverage: SM-level + integration-level |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Existing `crc` (mrhooray/crc-rs) | `=3.4` (already in Cargo.toml) | CRC-16-CCITT (CCITT-FALSE) verification of received frames | Already pinned in Phase 7; no new deps |
| Existing `vte` | `=0.15` | (Unrelated to recv — terminal parser; mentioned for context) | Already pinned (ADR-001) |

**Zero new Rust deps for Phase 10.** [VERIFIED: STACK.md §Recommended Stack — Additions]

### Supporting (browser APIs)
| API | Required Chromium | Purpose | When to Use |
|-----|-------------------|---------|-------------|
| File System Access API: `showDirectoryPicker`, `FileSystemDirectoryHandle.getFileHandle({ create: true })`, `FileSystemFileHandle.createWritable()` | 86+ (Web Serial floor 89+) | Opt-in folder save | When `prefs.slideRecvToFolder === true` AND user has granted permission |
| `FileSystemHandle.requestPermission({ mode: 'readwrite' })` | 86+ | Re-permission on reload | First file write per page-load when handle was previously granted |
| `FileSystemHandle.queryPermission({ mode: 'readwrite' })` | 86+ | Cheap permission probe | Before calling `requestPermission` to avoid unnecessary user-gesture race |
| IndexedDB | universal | Persist `FileSystemDirectoryHandle` across reloads | structuredClone-compatible per File System Access spec |
| `URL.createObjectURL(blob)` + synthetic `<a download>.click()` | universal | Anchor-click fallback download path | Default path (toggle off); also fallback for picker dismissal/permission denial |
| `Blob`, `new Blob(chunks: Uint8Array[], { type: 'application/octet-stream' })` | universal | Memory-bounded file assembly | EOF-time materialisation per file |
| `performance.memory.usedJSHeapSize` | Chromium-specific | 1 MB+ memory smoke test | Phase 10 Playwright spec only (asserts no O(n²) growth) |

[VERIFIED: developer.chrome.com File System Access docs; WICG/file-system-access EXPLAINER.md; Chrome 122+ persistent permissions blog post]

**No new JS deps for Phase 10.** Same stance as Phase 9.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `recv_ptr/_len/clear_recv` accessor triple | New `take_recv_payload()` method that copies bytes out per call | Triple is zero-copy + identical idiom to outbound triple (proven, low cost). `take_*` would copy per frame and add a second drain pattern to learn. (b) wins on consistency. |
| New `EVT_HEADER_RECEIVED` event | Inline `take_recv_metadata()` polling after EVT_DATA_FRAME | Event-driven matches existing dispatcher pattern (Phase 9 EVT_FILE_COMPLETE precedent); polling would leak mode-transition logic into JS unnecessarily. |
| Sibling `slide-recv.js` module | Extend `slide.js` with recv-mode plumbing | `slide.js` is already 670+ LOC; per-mode I/O lives in sibling files (analog to `paste-pump.js` vs `tx-sink.js`). Splitting wins on file-cohesion. |
| Anchor-click + 250 ms gap (default OFF path) | ZIP-then-download via `fflate` (~10 KB MIT) | ZIP would solve Chrome multi-download prompt for free but introduces a JS dep + non-trivial UX (user gets `transfer.zip` not 5 separate files). PITFALLS §10 calls this out; `showDirectoryPicker` opt-in is the better fit. |
| `showDirectoryPicker` + persisted handle (default ON path) | `showSaveFilePicker` per file | `showSaveFilePicker` requires per-file user-gesture which doesn't exist in a passive recv flow. `showDirectoryPicker` once + `getFileHandle({ create: true })` per file is the only viable path. |
| Mid-session re-entry matcher inline in `dispatchRecvMode` | Extract to shared `wakeupMatcher.js` helper | Inline duplicates ~25 LOC of `dispatchTerminalMode`. Extraction would reduce duplication but adds a module + import. Inline keeps each dispatcher's matcher locally readable. Default: inline; planner picks. |

**Installation:** Nothing to install. All dependencies are existing crates / browser APIs.

**Version verification:** Phase 9 already verified `crc = "=3.4"` and Phase 7 verified Rust-side primitives. Phase 10 adds zero deps.

## Architecture Patterns

### System Architecture Diagram

```
        Z80 SLIDE.COM (patched, emits ESC^SLIDE wakeup)
                         │
                         │  Web Serial (USB CDC)
                         ▼
       ┌─────────────────────────────────────────────────┐
       │  www/transport/serial.js:453                    │
       │  reader.read() loop → dispatchInbound(value)    │
       └─────────────────────┬───────────────────────────┘
                             │
                             ▼
       ┌─────────────────────────────────────────────────┐
       │  www/transport/slide.js                         │
       │  • dispatchTerminalMode (existing 7-byte matcher)│
       │  • dispatchRecvMode (Phase 10 — extended)       │
       │      ├─ NEW: re-entry ESC^SLIDE matcher        │
       │      ├─ slide.feed_chunk(bytes)                 │
       │      ├─ event drain (EVT_HEADER_RECEIVED, ...) │
       │      ├─ outbound drain (ACK/NAK/CAN bytes)     │
       │      └─ delegate payload events → slide-recv.js │
       │  • dispatchSendMode (Phase 9, unchanged)        │
       └────────┬────────────────────────────────────────┘
                │
                │ (Header / Data events + bytes)
                ▼
       ┌─────────────────────────────────────────────────┐
       │  www/transport/slide-recv.js (NEW)              │
       │                                                  │
       │  EVT_HEADER_RECEIVED ─►  current_filename       │
       │                          bytes_in_file_total    │
       │                          chunks = []             │
       │                                                  │
       │  EVT_RECV_DATA       ─►  chunks.push(payload)    │
       │                          bytes_in_file_done++   │
       │                                                  │
       │  EVT_RECV_FILE_DONE  ─►  assembleAndDownload()   │
       │                          (per-file branching)    │
       │                                                  │
       │  • cancelRecv() — Esc / programmatic            │
       └────────┬────────────────────────────────────────┘
                │
                ▼ (branches on prefs.slideRecvToFolder)
       ┌────────┴───────────────────┐
       │                            │
       ▼                            ▼
 Anchor-click path          Folder-save path
 (toggle OFF, default       (toggle ON + handle granted)
  + fallback)                + collision suffix retry
       │                            │
       ▼                            ▼
 URL.createObjectURL +     dirHandle.getFileHandle(
 <a download>.click() +    ensureUnique(name), {create:true})
 250 ms inter-file gap +   .createWritable() →
 setTimeout chain          writer.write(blob); writer.close()
       │                            │
       └─────────┬──────────────────┘
                 ▼
        Browser download manager / chosen folder

       ┌────────────────────────────────────┐
       │  Rust core wasm                    │
       │  ┌──────────────────────────────┐  │
       │  │ Slide (lib.rs façade)        │  │
       │  │ ├── feed_byte / feed_chunk   │  │
       │  │ ├── outbound_ptr/_len/clear  │  │
       │  │ ├── recv_ptr/_len/clear (NEW)│  │
       │  │ ├── recv_filename_ptr/_len   │  │
       │  │ │   (NEW — header surfacing) │  │
       │  │ ├── cancel / force_idle      │  │
       │  │ └── state                    │  │
       │  └──────────────────────────────┘  │
       │            │                        │
       │            ▼                        │
       │  ┌──────────────────────────────┐  │
       │  │ slide/state.rs (receiver SM) │  │
       │  │ • RDY → Header → Data → ...  │  │
       │  │ • per-window ACK             │  │
       │  │ • CancelPending silent-drain │  │
       │  │ • Phase 10: stash payload+   │  │
       │  │   filename in side buffers   │  │
       │  │   exposed via new accessors  │  │
       │  └──────────────────────────────┘  │
       └────────────────────────────────────┘
```

### Recommended Project Structure
```
crates/bestialitty-core/src/
├── lib.rs                       MODIFY (+ recv accessors on Slide façade)
├── slide/
│   ├── state.rs                 MODIFY (+ recv_buf, recv_filename, recv_size; emit EVT_HEADER_RECEIVED + EVT_RECV_DATA + EVT_RECV_FILE_DONE)
│   ├── framer.rs                MODIFY (+ EVT_HEADER_RECEIVED + EVT_RECV_DATA + EVT_RECV_FILE_DONE constants)
│   ├── crc.rs                   UNCHANGED
│   └── tests_only.rs            POSSIBLE +fixtures for recv corpus

crates/bestialitty-core/tests/
├── slide_boundary_shape.rs      MODIFY (+ new EVT_* + new fn-pointer pin)
├── slide_wasm_boundary_shape.rs MODIFY (same)
├── slide_torn_chunk.rs          MODIFY (+ recv corpus: zero-byte / sub-frame / binary / multi-file)
├── slide_recv_payload.rs        NEW (recv-payload extraction unit tests)
└── slide_recv_corpus.rs         NEW (end-to-end recv corpus driving SM with fixtures)

www/transport/
├── slide.js                     MODIFY (extend dispatchRecvMode with re-entry matcher + payload event delegation)
└── slide-recv.js                NEW (~250-350 LOC: per-file accumulator, Blob assembly, download dispatch, cancel sequence)

www/state/
├── prefs.js                     MODIFY (+ slideRecvToFolder: false in DEFAULTS)
└── idb.js                       NEW (~30-50 LOC: getRecvDirHandle / setRecvDirHandle / clearRecvDirHandle)

www/input/
└── keyboard.js                  MODIFY (+ Esc → SLIDE cancel slot at lines ~225)

www/index.html                   MODIFY (+ Settings row "Save received files to folder" + Choose folder button + ~10 lines CSS)
www/main.js                      MODIFY (+ wireSlideRecv({ wrapperEl, prefs, idb }) after wireSlideDispatcher)

www/tests/transport/
├── mock-serial-slide-bot.js     MODIFY (+ sender-role state machine; role parameter)
├── slide-recv.spec.js           NEW (anchor-click + folder-save + edge cases)
└── slide-cancel.spec.js         NEW (cancel timing + re-entry + hard-fail)
```

### Pattern 1: Rust → JS recv-payload extraction (zero-copy triple)

**What:** Mirror the proven `outbound_ptr / outbound_len / clear_outbound` triple for recv-mode payload bytes. Add a parallel `recv_ptr / recv_len / clear_recv` triple plus separate `recv_filename_ptr / recv_filename_len / clear_recv_filename` for the header.

**When to use:** Every framer event carrying payload data needs to surface those bytes to JS without a copy at the FFI boundary. Phase 7's `framer.take_payload()` already returns ownership of the payload Vec; Phase 10 stashes it in a Slide-level recv buffer until JS reads it.

**Example:**
```rust
// crates/bestialitty-core/src/slide/state.rs — extension
pub struct Slide {
    // ... existing fields ...
    /// Stable-pointer recv buffer. Holds the most recently completed data
    /// frame's payload (populated in the DataPhase EVT_DATA_FRAME arm at
    /// state.rs:509-535) until JS calls clear_recv after copying.
    recv_buf: Vec<u8>,
    /// Header-frame filename (null-stripped). Populated in HeaderPhase
    /// arm at state.rs:480-498 alongside the existing ACK push.
    recv_filename: Vec<u8>,
    /// Header-frame total file size (LE u32 from header payload bytes 5..9
    /// after null terminator). Surfaced as scalar for window.__slide.
    recv_file_size: u32,
}

impl Slide {
    pub fn recv_ptr(&self) -> *const u8 { self.recv_buf.as_ptr() }
    pub fn recv_len(&self) -> usize { self.recv_buf.len() }
    pub fn clear_recv(&mut self) { self.recv_buf.clear(); }

    pub fn recv_filename_ptr(&self) -> *const u8 { self.recv_filename.as_ptr() }
    pub fn recv_filename_len(&self) -> usize { self.recv_filename.len() }
    pub fn recv_file_size(&self) -> u32 { self.recv_file_size }
}
```

**Wasm boundary forwards in lib.rs (same pattern as Phase 9 `enter_send_mode`):**
```rust
#[cfg(target_arch = "wasm32")]
mod wasm_boundary {
    #[wasm_bindgen]
    impl Slide {
        pub fn recv_ptr(&self) -> *const u8 { self.inner.recv_ptr() }
        pub fn recv_len(&self) -> usize { self.inner.recv_len() }
        pub fn clear_recv(&mut self) { self.inner.clear_recv(); }
        pub fn recv_filename_ptr(&self) -> *const u8 { self.inner.recv_filename_ptr() }
        pub fn recv_filename_len(&self) -> usize { self.inner.recv_filename_len() }
        pub fn recv_file_size(&self) -> u32 { self.inner.recv_file_size() }
    }
}
```

**JS-side consumption (slide-recv.js):**
```js
// On EVT_HEADER_RECEIVED
const filenameView = new Uint8Array(wasmRef.memory.buffer, slide.recv_filename_ptr(), slide.recv_filename_len());
const filename = new TextDecoder('latin1').decode(filenameView);  // CP/M is ASCII subset
const totalBytes = slide.recv_file_size();
slide.clear_recv_filename();   // optional — could skip if Rust overwrites on next header
currentFile = { name: filename, totalBytes, chunks: [], bytesDone: 0 };

// On EVT_RECV_DATA (every accepted data frame)
const len = slide.recv_len();
if (len > 0) {
    if (wasmRef.memory.buffer !== recvBuffer) {
        recvBuffer = wasmRef.memory.buffer;
        recvView = new Uint8Array(recvBuffer, slide.recv_ptr(), RECV_VIEW_CAP);
    }
    const owned = new Uint8Array(recvView.subarray(0, len));   // Pitfall 5: copy before any await
    currentFile.chunks.push(owned);
    currentFile.bytesDone += len;
    slide.clear_recv();
}
```

[CITED: state.rs:466-555 receiver SM; framer.rs:86-88 take_payload; slide.js:330-344 outbound triple precedent]

### Pattern 2: Memory-bounded per-file reassembly (`chunks: Uint8Array[]` + Blob)

**What:** Per-file, accumulate Uint8Array references in a `chunks` array. At EOF, materialise via `new Blob(chunks, { type: 'application/octet-stream' })` — Blob does an internal copy at construction time, but only once per file (O(n) total).

**When to use:** Verbatim mirror of Phase 6 session-log download pattern (`session-log.js:62-85`). Memory cost = sum of payloads ≈ file size, never O(n²) like naive concatenation.

**Example:**
```js
// www/transport/slide-recv.js
let currentFile = null;  // { name, totalBytes, chunks: Uint8Array[], bytesDone }

function onHeaderReceived() {
    if (currentFile) {
        // Defensive: previous file should have completed before next header.
        // If we land here without an EOF, log + flush whatever we have.
        console.warn('[slide-recv] header arrived mid-file; flushing partial');
    }
    currentFile = {
        name: readRecvFilename(),
        totalBytes: slide.recv_file_size(),
        chunks: [],
        bytesDone: 0,
    };
}

function onRecvData() {
    const owned = sliceRecvBytesToOwned();
    currentFile.chunks.push(owned);
    currentFile.bytesDone += owned.byteLength;
}

async function onRecvFileDone() {
    if (!currentFile) return;
    const file = currentFile;
    currentFile = null;
    await assembleAndDownload(file);
    await delay(250);  // SLIDE-19 inter-file gap
}

async function assembleAndDownload(file) {
    const blob = new Blob(file.chunks, { type: 'application/octet-stream' });
    if (prefs.slideRecvToFolder && dirHandleAvailable) {
        await downloadToFolder(file.name, blob);
    } else {
        downloadViaAnchor(file.name, blob);
    }
}
```

[CITED: session-log.js:62-85 verbatim Blob+anchor-click pattern; PITFALLS.md §12 memory growth]

### Pattern 3: Anchor-click download (default / fallback path)

**What:** `URL.createObjectURL(blob)` + synthetic `<a download="NAME.EXT">.click()` + `setTimeout(URL.revokeObjectURL, 5000)`. Identical to `session-log.js:62-85`.

**When to use:** Toggle off (default) OR toggle on but picker was dismissed / permission denied / collision-budget (~999) exhausted.

**Example:**
```js
function downloadViaAnchor(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;          // CP/M 8.3 names are valid Chrome download filenames
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
```

[CITED: session-log.js:62-85; verbatim mirror with `filename` parameter instead of `filenameForNow()`]

### Pattern 4: Folder-save download (opt-in path)

**What:** `dirHandle.getFileHandle(uniqueName, { create: true })` → `fileHandle.createWritable()` → `writer.write(blob)` → `writer.close()`. No 250 ms gap needed (no Chrome download manager involvement).

**When to use:** `prefs.slideRecvToFolder === true` AND `dirHandle` is non-null AND `requestPermission` returns `'granted'`.

**Example:**
```js
async function downloadToFolder(filename, blob) {
    let dirHandle = await getRecvDirHandle();   // from idb.js
    if (!dirHandle) {
        // First call this session — prompt for picker.
        try {
            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            await setRecvDirHandle(dirHandle);
        } catch (e) {
            // User dismissed picker → D-04: fall back to anchor for this session
            console.warn('[slide-recv] picker dismissed; falling back to anchor');
            sessionFolderFallback = true;
            return downloadViaAnchor(filename, blob);
        }
    }
    // Re-permission gate (handle from IndexedDB needs reload-permission).
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
        const ask = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (ask !== 'granted') {
            sessionFolderFallback = true;
            return downloadViaAnchor(filename, blob);
        }
    }
    // Collision suffix retry (D-05/D-06).
    const uniqueName = await ensureUnique(dirHandle, filename);
    if (uniqueName === null) {
        // ~999 collisions exhausted — D-06 fall through.
        return downloadViaAnchor(filename, blob);
    }
    const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(blob);
    await writer.close();
}
```

[CITED: WICG/file-system-access EXPLAINER.md; developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api]

### Pattern 5: Suffix collision algorithm (`~N` retry)

**What:** Try base name; on collision (`getFileHandle({ create: false })` resolves), bump suffix; retry up to `~999`; fall through to anchor-click.

**When to use:** Inside `downloadToFolder` before `getFileHandle({ create: true })`. Default insertion algorithm: split on last `.`; insert `~N` before the last dot; if no dot, append `~N` at end.

**Example:**
```js
async function ensureUnique(dir, name) {
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0
        ? [name.slice(0, dot), name.slice(dot)]
        : [name, ''];
    for (let n = 0; n <= 999; n++) {
        const candidate = n === 0 ? name : `${base}~${n}${ext}`;
        try {
            await dir.getFileHandle(candidate, { create: false });
            // Exists — try next.
        } catch (e) {
            if (e.name === 'NotFoundError') return candidate;
            throw e;  // Other errors (permission?) bubble up.
        }
    }
    return null;  // ~999 exhausted.
}
```

**Edge cases:**
- `REPORT.TXT` → `REPORT~1.TXT` ✓
- `NOEXT` → `NOEXT~1` ✓ (no dot)
- `MY.TAR.GZ` → `MY.TAR~1.GZ` ✓ (insert before last dot)
- `REPORT.` → `REPORT~1.` ✓ (empty ext is fine; trailing dot odd but accepted)
- `MY~FILE.TXT` → `MY~FILE~1.TXT` ✓ (visual oddity acknowledged in CONTEXT)

[CITED: CONTEXT.md D-05/D-06; example pseudocode under CONTEXT.md §Specific Ideas]

### Pattern 6: Esc disambiguation chain (insert SLIDE-cancel as slot 3)

**What:** Insert SLIDE-cancel arm into `keyboard.js:202-227` between the existing selection-drag-cancel and paste-cancel arms. Final order:

1. `Ctrl+Shift+Esc` — clear selection (existing, line 206)
2. `Esc + selectionIsDragging()` — cancel selection drag (existing, line 216)
3. **`Esc + slide.isActive()` — cancel SLIDE session (NEW)**
4. `Esc + pastePumpIsActive()` — cancel paste (existing, line 225, was slot 3)
5. `Esc fallthrough` — encode 0x1B to remote (existing, was slot 4)

**When to use:** Phase 10 only. The new slot must `e.preventDefault()` + `return`, identical to peers.

**Example:**
```js
// www/input/keyboard.js — insertion at line 220 (after selection-drag, before paste)
import { isSlideActive, cancelSlideRecv } from '../transport/slide-recv.js';

// (new arm — slot 3 of 5)
if (e.code === 'Escape' && isSlideActive()) {
    e.preventDefault();
    cancelSlideRecv();
    return;
}
```

`isSlideActive()` returns true when `mode === 'recv' || mode === 'send'` AND `state` is not in `Idle / Done / Error`. Phase 10 wires it for recv; Phase 11 chip will use the same accessor for the chip's Cancel button.

[CITED: keyboard.js:202-227 verbatim chain; UI-SPEC §Esc key disambiguation]

### Pattern 7: Hard-fail recovery (3-mode convergence)

**What:** All three failure modes converge on a single recovery path: exit recv mode, set wire owner back to `'terminal'`, console.error the failure mode, leave the door open for the next wakeup.

**When to use:** Whenever the recv path detects an unrecoverable state.

**Three failure modes:**

1. **NAK_BUDGET exhausted** (state.rs:540-543): SM transitions to `SlideState::Error` after 16 consecutive CRC errors. JS observes via `slide.state() === STATE_ERROR` in the post-feed `maybeExitRecvMode` check. → Convergence path.

2. **Port lost** (Phase 8 `slidePumpOnPortLost` stub): `serial.js` teardown / `handleReadError` / `onNavSerialDisconnect` fires `slidePumpOnPortLost()`. Phase 11 SLIDE-32 makes this a real implementation; Phase 10 has Discretion to pull a 5-line minimum forward (the cancel work needs SOMETHING in the stub). → Convergence path.

3. **Wire desync** (e.g., framer in mid-byte when CTRL_CAN arrives): CancelPending silent-drain handles this in Rust (D-07 implementation). The desync recovers on its own once the framer hits a clean SOF or control byte. No JS action needed — covered by Pattern 8 cancel sequence.

**Example:**
```js
// www/transport/slide-recv.js
function recoverHardFail(reason) {
    console.error(`[slide-recv] hard-fail: ${reason}; resetting`);
    if (slide && typeof slide.free === 'function') slide.free();
    slide = null;
    currentFile = null;
    sessionFolderFallback = false;
    txSinkRef.setWireOwner('terminal');
    mode = 'terminal';
    // No chip in Phase 10; Phase 11 SLIDE-29 attaches a "Retry" chip here.
}
```

[CITED: state.rs:540-543 NAK_BUDGET; state.rs:284-303 CancelPending; ARCHITECTURE.md §8 port-lost integration]

### Pattern 8: Cancel sequence (PITFALLS §5 + ADR-003 verbatim)

**What:** 5-step cancel handshake with strict timing windows. JS owns all timing.

**When to use:** Esc key during recv session, OR `window.__slide.cancelRecv()` programmatic, OR (Phase 11) chip Cancel button.

**Example (verbatim from CONTEXT.md):**
```js
async function cancelRecv() {
    if (cancelInFlight) return;   // idempotent — second call is no-op
    cancelInFlight = true;
    const absoluteTimeout = setTimeout(() => {
        // Step 5b — 2 s absolute escape hatch
        slide.force_idle();
        forceExitRecvMode();
    }, 2000);
    try {
        // Step 1 — settle in-flight writes (200 ms cap)
        await Promise.race([
            Promise.allSettled(inflightWrites),
            delay(200),
        ]);
        // Step 2 — push CTRL_CAN onto outbound (single byte 0x18)
        slide.cancel();   // pushes CTRL_CAN; transitions SM to CancelPending
        await drainSlideOutboundAwaitable();   // 1-byte writeSlideFrame
        // Step 3 — wait up to 500 ms for Z80's CAN echo
        // (state.rs:285-292 transitions CancelPending → Done on inbound CTRL_CAN)
        const echoArrived = await waitForState(STATE_DONE, 500);
        // Step 4 — drain 100 ms post-echo so any straggler bytes are consumed
        await delay(100);
        // Step 5a — if Z80 didn't echo (stock slide.com without v0.2.1), force_idle
        if (!echoArrived) slide.force_idle();
        // Re-arm — exit recv mode, owner back to terminal
        clearTimeout(absoluteTimeout);
        forceExitRecvMode();
    } catch (e) {
        clearTimeout(absoluteTimeout);
        console.error('[slide-recv] cancel sequence threw:', e);
        forceExitRecvMode();
    } finally {
        cancelInFlight = false;
    }
}

function waitForState(targetState, timeoutMs) {
    return new Promise((resolve) => {
        const t0 = performance.now();
        const tick = () => {
            if (slide && slide.state() === targetState) return resolve(true);
            if (performance.now() - t0 >= timeoutMs) return resolve(false);
            setTimeout(tick, 10);   // 10 ms poll — cheap, low precision OK
        };
        tick();
    });
}
```

**Critical detail:** `waitForState` polls because there is no event-driven "state changed to Done" signal in the wasm boundary. The 10 ms poll is cheap (slide.state() is a plain u32 return). An alternative is to make slide-recv.js hand off polling to the next inbound chunk's `dispatchRecvMode` (which already calls `slide.state()` post-feed). Planner picks; either works.

[CITED: ADR-003 §Decision §3 + §4; PITFALLS §5; state.rs:284-303 CancelPending silent-drain]

### Pattern 9: Mid-session ESC^SLIDE re-entry detection (SLIDE-34)

**What:** Run a second 7-byte wakeup matcher in `dispatchRecvMode` in parallel with the framer feed. On match: console.warn ("Z80 reset detected"), call `slide.force_idle()`, `exitRecvMode`, then `enterRecvMode` for the new session.

**When to use:** Mid-recv-session. Handles two real scenarios: (1) Z80 reboots and slide.com auto-runs from RAMdisk emitting a fresh wakeup; (2) a buggy Z80 program emits ESC^SLIDE accidentally.

**Example:**
```js
// www/transport/slide.js — extension to dispatchRecvMode
let recvWakeIdx = 0;
const recvScratch = new Uint8Array(6);

function dispatchRecvMode(value) {
    // Run re-entry matcher in parallel with framer feed.
    // Walk byte-by-byte to detect the 7-byte signature; bytes that don't
    // match the signature are still fed to the SM (the framer is byte-fed
    // and tolerates arbitrary bytes — ESC^SLIDE characters are silently
    // discarded by the framer's Idle arm).
    let matchEnd = -1;
    for (let i = 0; i < value.length; i++) {
        const b = value[i];
        if (b === WAKEUP[recvWakeIdx]) {
            recvScratch[recvWakeIdx] = b;
            recvWakeIdx++;
            if (recvWakeIdx === 7) {
                matchEnd = i;
                recvWakeIdx = 0;
                break;
            }
        } else {
            // D-02 mirror — current byte may be the start of a new match.
            if (recvWakeIdx > 0) {
                if (b === WAKEUP[0]) {
                    recvScratch[0] = b;
                    recvWakeIdx = 1;
                } else {
                    recvWakeIdx = 0;
                }
            }
        }
    }

    if (matchEnd >= 0) {
        // Re-entry detected. Feed bytes BEFORE the wakeup to current SM
        // (last-ditch ACK), then reset and re-enter.
        const before = value.subarray(0, matchEnd - 6);   // bytes before the 7-byte signature
        if (before.length) feedSlide(before);
        drainEventsAndOutbound();
        console.warn('[slide.js] mid-session ESC^SLIDE detected — Z80 reset; re-entering recv mode');
        slide.force_idle();
        exitRecvMode();
        enterRecvMode();
        // Forward chunk tail (bytes after the wakeup) to the new SM.
        const tail = value.subarray(matchEnd + 1);
        if (tail.length) {
            feedSlide(tail);
            drainEventsAndOutbound();
            maybeExitRecvMode();
        }
        return;
    }

    // No re-entry — normal path.
    feedSlide(value);
    drainEventsAndOutbound();
    maybeExitRecvMode();
}
```

**Note:** This duplicates ~25 LOC of `dispatchTerminalMode`'s matcher. Planner has Discretion to extract to a shared `wakeupMatcher.js` helper module if the duplication is worth eliminating; default = inline.

[CITED: slide.js:229-310 `dispatchTerminalMode` matcher template; PITFALLS §9 re-entrant wakeup; ARCHITECTURE.md §2 byte-routing]

### Anti-Patterns to Avoid

- **Naive concatenation `next = new Uint8Array(buffer.length + frame.length); next.set(buffer); next.set(frame, buffer.length); buffer = next` →** O(n²) memory churn. Total ~512 MB allocated to receive 1 MB. Use `chunks: Uint8Array[]` + Blob assembly. [CITED: PITFALLS §12]

- **`reader.cancel()` or `port.close()` during cancel →** kills the terminal session. Cancel must NEVER touch the read loop or port lifecycle. CTRL_CAN + drain re-arms the framer; the wire stays connected. [CITED: PITFALLS §5; ADR-003]

- **`await writer.write(bytes)` instead of `await writer.ready; writer.write(bytes)` →** for the receiver-side CTRL_CAN echo this is a 1-byte fire-and-forget write so writeSlideFrame (Phase 8) is fine. But if any future Phase 10 extension adds multi-byte writes from recv, use the `*Awaitable` variant. [CITED: PITFALLS §4]

- **Synchronous `await` inside `dispatchInbound` (the read loop's inner call) →** would block subsequent chunks. dispatchSendMode in Phase 9 already solved this with `sendDispatchTail = sendDispatchTail.then(() => dispatchSendMode(value))`. Phase 10 does NOT need this for `dispatchRecvMode` because feed/drain are synchronous; only the cancel sequence is async, and it's triggered by Esc/programmatic, not by inbound bytes. [CITED: slide.js:115-127, 168-170]

- **Reading `slide.outbound_ptr()` without re-deriving the view on `wasm.memory.buffer` change →** Pitfall 4. Always check `if (wasmRef.memory.buffer !== outboundBuffer) re-derive` before slicing. Same applies to the new `recv_ptr` view. [CITED: slide.js:335-337]

- **Slicing the recv view without copying-before-await →** Pitfall 5. The view is a window into wasm linear memory; if a subsequent allocation grows the buffer during an `await`, the view becomes stale. Always `new Uint8Array(view.subarray(0, len))` BEFORE any `await`. [CITED: slide.js:341]

- **Storing `FileSystemDirectoryHandle` in `localStorage` →** doesn't roundtrip through JSON. Must use IndexedDB (structuredClone). [CITED: WICG/file-system-access; CONTEXT D-02]

- **Using `showSaveFilePicker` per file →** requires per-file user-gesture which doesn't exist in passive recv flow. Use `showDirectoryPicker` once + `getFileHandle({ create: true })` per file. [CITED: developer.chrome.com File System Access API]

- **Forgetting the 250 ms inter-file gap on the anchor-click path →** Chrome's "Allow multiple downloads" prompt fires at >= 2 downloads in short window. Threshold is empirical (not formally documented); 250 ms is the safe default but is INSUFFICIENT for >5 file batches; Phase 10 ships 250 ms as floor and documents the limit. [CITED: PITFALLS §10]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File assembly from chunks | Custom `concat(Uint8Array[])` helper | `new Blob(chunks, { type: 'application/octet-stream' })` | Blob does a single internal copy — O(n) — and gives you a download-ready BlobURL. Custom concat re-implements the same logic worse. [VERIFIED: session-log.js:62-85 mirror] |
| Browser download trigger | `fetch('data:...').then(r => r.blob())` or other tricks | `URL.createObjectURL(blob)` + `<a download>.click()` + revokeObjectURL after timeout | Standard Chromium pattern; supports arbitrary binary bytes; `download="NAME"` attribute carries CP/M filename verbatim. [VERIFIED: session-log.js:60-85] |
| Folder-save | Building a file-picker UI in DOM | `window.showDirectoryPicker({ mode: 'readwrite' })` | Native Chromium API; OS-integrated; user-gesture-bound; permission-managed by browser. [VERIFIED: WICG/file-system-access EXPLAINER] |
| Handle persistence | localStorage + JSON serialization | `IDBObjectStore.put(handle)` (handles are structuredClone-compatible) | localStorage can't store FileSystemDirectoryHandle (no JSON form). IndexedDB is the spec-defined persistence layer. [VERIFIED: WICG/file-system-access spec; developer.chrome.com persistent permissions blog] |
| Re-permission probe | Always calling `requestPermission` (creates user-gesture race) | `queryPermission` first; only call `requestPermission` if state !== 'granted' | `requestPermission` requires a user-gesture; `queryPermission` is read-only. Chrome 122+ persistent permissions blog explicitly recommends this guard. [CITED: developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api] |
| CRC verification | Hand-roll in JS | Already done in Rust framer (`framer.rs:163-181`); JS never validates CRC | The Rust SM verifies + emits EVT_DATA_FRAME or EVT_CRC_ERROR; JS just reacts to events. No JS-side framing logic at all (Pitfall 1 architectural rule). [CITED: framer.rs:163-181] |
| Cancel timing in Rust | `std::time::Instant` in core | All windows in JS via `setTimeout` / `Promise.race` | ADR-003 + ARCHITECTURE.md anti-pattern 4; `tests/core_02_no_browser_deps.rs` FORBIDDEN_TOKENS list enforces. [CITED: ADR-003 §Decision §3] |
| Mid-stream re-entry detection in Rust | Rust framer `EVT_REENTRY_DETECTED` | JS-side wakeup matcher in `dispatchRecvMode` | Per ARCHITECTURE.md §2: wakeup detection is dispatch-layer concern, not framer concern. Phase 8 already solved this in `dispatchTerminalMode`; Phase 10 reuses the pattern. [CITED: ARCHITECTURE.md §2; slide.js:229-310] |
| Anchor-click + folder-save path arbitration | Embedded if-else throughout | Single `assembleAndDownload(file)` function that branches on `prefs.slideRecvToFolder` | Single mental model (CONTEXT D-01); easier to reason about + test. |

**Key insight:** Phase 10 is fundamentally a **plumbing phase** on top of an already-correct receiver SM. Every problem listed above has either an existing browser primitive or a Phase 6/7/8/9 precedent. Net new logic is the suffix collision retry loop and the 5-step cancel handshake — both ~20-line algorithms.

## Runtime State Inventory

> Phase 10 is a **greenfield feature add** (Z80→PC receive end-to-end, new modules, new Settings row, new IndexedDB store). NOT a rename / refactor / migration. State inventory is informational: nothing pre-exists to migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 10 introduces the IndexedDB store `bestialitty-handles` for the first time. No prior store to migrate. | Create new IndexedDB DB on first `setRecvDirHandle` call (inside `idb.js`) — follow open-on-demand pattern; idempotent across reloads. |
| Live service config | None — no external services with this concept. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None. | None. |
| Build artifacts | `www/pkg/bestialitty_core.{js,d.ts,_bg.wasm}` regenerate from `scripts/build.sh` after lib.rs adds new recv accessors. Hard reload (Ctrl+Shift+R) required per MEMORY.md. | Re-run `bash scripts/build.sh` after Wave 1 + Wave 2 commits; flag hard-reload step in plan acceptance. |

**Nothing pre-exists in production user state for Phase 10:** verified by greppingthe codebase for `slideRecvToFolder`, `slideRecvDirectoryHandle`, `idb.js`, `bestialitty-handles` — none exist in `www/state/` or `www/transport/` as of Phase 9 close.

## Common Pitfalls

### Pitfall 1: Chrome multi-download throttling fires unpredictably (HIGH)

**What goes wrong:** Receiving 10 files via anchor-click = 10 `URL.createObjectURL(blob)` + synthetic anchor click sequences. Chrome's "Allow multiple downloads" prompt appears at >= 2 downloads in short window: 1st silent, 2nd within ~10 s shows address-bar prompt. Block → all subsequent silently fail.

**Why it happens:** Threshold not formally documented; varies across Chromium versions. Per current Chrome docs, "Sites can ask to automatically download multiple files" is the default permission policy; sites must opt-in via the prompt.

**How to avoid:**
- Default OFF path: 250 ms inter-file gap is the legacy mitigation. Insufficient for >5 file batches; explicitly document.
- Default ON path (`slideRecvToFolder`): no Chrome download manager involvement → no throttle. This is the architectural answer; the 250 ms gap is the fallback.
- Phase 10 acceptance tests should drive the mock with 3-5 files and assert all of them land (not just the first 1-2).

**Warning signs:** "Multi-file works for first 1-2 files, then silently stops." User sees no JS-visible error.

[CITED: PITFALLS §10; web search confirms threshold-not-documented stance per windowsdigitals.com 2025; chrome://settings/content/automaticDownloads control documented at lifewire.com 2025]

### Pitfall 2: FileSystemDirectoryHandle permission expires unpredictably across reloads (MEDIUM)

**What goes wrong:** Chrome 122+ supports persistent permissions for previously-granted handles, BUT: the user can revoke at any time via site settings; permissions can expire; cross-session restore can require a `requestPermission` user-gesture.

**Why it happens:** File System Access API spec allows handles to "expire" without surfacing a clean lifecycle event. The handle remains structuredClone-valid (loads from IndexedDB fine) but `queryPermission` may return `'prompt'` requiring re-confirmation.

**How to avoid:**
- ALWAYS call `queryPermission({ mode: 'readwrite' })` before first write per page-load.
- If `'prompt'` or `'denied'`, fall back to anchor-click path (D-04 — silently for the rest of the session, toggle stays on, next session re-attempts).
- Surface to user via Settings row label (CONTEXT.md §Specifics rough draft):
  - Toggled on AND no folder: `⚠ Pick a folder before next transfer`
  - Toggled on AND permission denied on reload: `⚠ Permission needed for ~/Downloads/MicroBeast`

**Warning signs:** "Folder save worked yesterday but not today" — almost always a revoked permission.

[CITED: developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api; WICG/file-system-access#289 issue confirms the prompt-on-stored-handle pattern]

### Pitfall 3: Cancel race — frame in flight when user hits Esc (BLOCKING)

**What goes wrong:** A frame is mid-write (~512 bytes already on wire); receiver SM is mid-frame-receive on its end; user cancels. Naive `slide.cancel()` + immediate exit leaves the framer in a partial state on the next session.

**Why it happens:** SLIDE wire is half-duplex but frames are 1031 bytes at 19200 baud ≈ 540 ms wire-time. Cancel arrival is unsynchronised with frame boundaries.

**How to avoid:** Pattern 8 verbatim. Critical: `slide.cancel()` is idempotent (D-06); silent-drain in CancelPending consumes any straggler bytes (D-07) until CTRL_CAN echo OR 2 s timeout.

**Warning signs:** Cancel "succeeds" but next transfer fails with "CRC mismatch" on first frame. Z80 hangs at SLIDE prompt for 30 seconds. "Reload page" required to recover.

[CITED: PITFALLS §5; ADR-003 verbatim]

### Pitfall 4: Re-entrant `ESC^SLIDE` loses in-flight transfer state (HIGH; SLIDE-34)

**What goes wrong:** Z80 reboots mid-receive (or buggy program emits ESC^SLIDE). Two failure modes: (1) Wakeup re-entry naively resets to Initial, in-flight transfer's chunks lost; (2) Wakeup ignored, Z80 has actually started new session, we miss the new RDY handshake.

**Why it happens:** Z80 reset-during-recv is a real real-world scenario (CP/M shell reboots, RAMdisk auto-runs slide.com).

**How to avoid:** Pattern 9. Run wakeup matcher in `dispatchRecvMode` in parallel with framer feed. On match: console.warn, `slide.force_idle()`, `exitRecvMode`, `enterRecvMode`. Phase 11 chip will surface the warning to the user.

**Warning signs:** "Transfer randomly fails halfway" on Z80 reboots. "Z80 says it sent the file but BestialiTTY shows no progress."

[CITED: PITFALLS §9; CONTEXT Claude's Discretion default]

### Pitfall 5: `take_payload()` invalidated by next frame consumption (MEDIUM)

**What goes wrong:** The Phase 7 framer's `take_payload()` returns ownership of the payload Vec via `std::mem::take`. If JS reads the recv-payload view AFTER the SM has consumed the next byte (which calls `framer.step` internally and may overwrite or replace the payload), the view is stale.

**Why it happens:** The Slide SM and framer share state. The state.rs DataPhase arm at line 513 calls `self.framer.take_payload()` and IMMEDIATELY uses it for the EOF/seq/NAK decision. If we then push that payload into a `recv_buf` Vec on the Slide struct, that Vec is owned by Slide and survives until JS reads + clears it.

**How to avoid:**
- Phase 10 architecture: copy bytes into `Slide::recv_buf` during the DataPhase arm AT THE SAME TIME as the existing ACK push. Do NOT expose the framer's payload directly across the wasm boundary.
- Concretely: `state.rs` DataPhase EVT_DATA_FRAME arm does `let payload = self.framer.take_payload();` (already does); add `if !payload.is_empty() && aux == self.expected_seq { self.recv_buf.extend_from_slice(&payload); self.events.push_back(EVT_RECV_DATA | (aux as u32)); }` BEFORE the per-window ACK push.
- JS reads `recv_buf` via the new triple AFTER the inbound chunk is fully fed. Because feed_chunk is byte-fed and accumulates events in a ring, JS sees ALL EVT_RECV_DATA events for the chunk + the recv_buf bytes by the time `take_event_packed` returns EVT_NONE.

**Warning signs:** Received file bytes look like a corrupted shifted version of the expected — symptom of consuming the framer's mutable payload buffer.

[CITED: state.rs:509-535 DataPhase arm; framer.rs:86-88 take_payload]

### Pitfall 6: Blob assembly is O(n) — but only if `chunks` is a flat array of Uint8Array (MEDIUM)

**What goes wrong:** `new Blob(chunks)` where `chunks` is a flat `Uint8Array[]` is O(n) — single internal copy. But `new Blob([new Blob(chunks), moreChunks])` is O(n²) because nested Blobs may force re-walk.

**Why it happens:** Sharing the `chunks` array across files (via concat or push of prior file's accumulator) is an anti-pattern.

**How to avoid:** Reset `currentFile.chunks = []` at every header boundary. Each file's Blob is constructed exactly once from its own flat array.

**Warning signs:** Memory sample at end of 5-file 1 MB batch is 25+ MB instead of <5 MB.

[CITED: PITFALLS §12; Blob spec MDN]

### Pitfall 7: `performance.memory.usedJSHeapSize` includes scrollback + glyph atlas + everything else (MEDIUM)

**What goes wrong:** A naive memory smoke test that reads `usedJSHeapSize` before + after a 1 MB recv asserts the delta is `< 3 * 1024 * 1024`. But scrollback grows during the recv (any terminal output that snuck through before the wakeup), glyph atlas may grow on first render, GC timing is non-deterministic.

**Why it happens:** `usedJSHeapSize` is a process-wide counter. Sampling delta is noisy.

**How to avoid:**
- Sample BEFORE recv starts (after a `await page.evaluate(() => gc?.())` if Playwright supports it — gc() is exposed only with `--js-flags=--expose-gc`).
- Allow generous slack: 1 MB file → 5 MB delta (accumulator + Blob + URL + slack).
- Run the assertion 3 times; take the minimum delta.
- Document this is a coarse-grained smoke, NOT a soak (Phase 6's 24-h soak is the precise tool).

**Warning signs:** Test flakes intermittently; passes locally but fails in CI.

[CITED: PITFALLS §12; Phase 6 SOAK pattern at coarse granularity]

### Pitfall 8: Mock-bot drift from production Rust SM (MEDIUM; PITFALLS §13)

**What goes wrong:** Phase 9 mock bot acts as receiver against BestialiTTY's sender (parallel reimplementation per PITFALLS §13). Phase 10 needs the inverse: bot acts as sender, BestialiTTY is receiver. If the bot's sender role state machine drifts from slide-rs/send.rs, tests pass but real-hardware UAT fails.

**Why it happens:** Hand-rolled JS sender bot easy to get subtly wrong (sliding-window NAK semantics, EOF marker conventions, FIN echo timing).

**How to avoid:**
- Mock bot's sender role is a FOURTH independent reimplementation: production Rust receiver SM (state.rs) ↔ Phase 9 Rust mock receiver bot (slide_sender.rs in-process) ↔ Phase 9 JS mock recv-bot ↔ Phase 10 JS mock send-bot. All four must agree on every wire byte for a Phase 10 e2e test to pass.
- Mirror slide-rs/send.rs:155-249 byte-for-byte. Use the same loop structure.
- Cross-validate against slide-py/slide/send.py if questions arise.
- Native Rust corpus test (`slide_recv_corpus.rs` Wave 1) drives the production receiver SM with a hand-built byte sequence — the corpus IS the contract for what bytes the bot must emit.

**Warning signs:** Receiver works against bot but real Z80 with patched slide.com fails. (Phase 12 UAT scope.)

[CITED: PITFALLS §13; slide-rs/src/send.rs:100-260]

### Pitfall 9: 500 ms Z80-echo wait is tight at 19200 baud (MEDIUM)

**What goes wrong:** PITFALLS §5 specifies 500 ms wait for Z80's CTRL_CAN echo. But a single 1031-byte frame at 19200 baud is ~540 ms wire-time. If the cancel arrives mid-frame, the Z80 won't see CTRL_CAN until ~540 ms later in the worst case, then must process and echo — probably fine within 500 ms after that, but tight.

**Why it happens:** Half-duplex serial + slow baud + frame-size > echo-wait window.

**How to avoid:**
- Ship 500 ms verbatim per ADR-003.
- The 2 s absolute timeout (force_idle escape hatch) catches the slow case.
- Document as a Phase 12 UAT scope item: time the Z80 cancel-echo path on real hardware; if 500 ms is too tight, widen ADR-003's clause and bump in Phase 11/12.

**Warning signs:** UAT shows force_idle firing frequently (cancel feels slow but works because the absolute timeout catches it).

[CITED: ADR-003 §Decision §3; CONTEXT.md "researcher / planner has Claude's Discretion to widen any window if real-hardware UAT during Phase 12 surfaces a slow-Z80 case"]

### Pitfall 10: Settings toggle race on first-load (LOW)

**What goes wrong:** User has `slideRecvToFolder: true` in localStorage from prior session. Page loads, `slide-recv.js` initialises, but `idb.js`'s async `getRecvDirHandle()` hasn't resolved yet by the time the first recv session might start.

**Why it happens:** IndexedDB is async; first read blocks on DB open + transaction.

**How to avoid:**
- Boot sequence: `await getRecvDirHandle()` BEFORE `wireSlideDispatcher`. Cache the result in a module-scope variable in `slide-recv.js`.
- If a recv session starts before the cache is populated (would require sub-100 ms boot), fall back to anchor-click (D-04 silent-fall-back semantics) — this is the safe behaviour anyway.

**Warning signs:** Race condition only triggerable in tests with extremely fast wakeup-after-page-load timing.

[CITED: structurally similar to Phase 6 prefs.js boot pattern]

## Code Examples

### Example 1: Header frame parsing (existing — Phase 7 SM consumes; Phase 10 surfaces)

```rust
// crates/bestialitty-core/src/slide/state.rs — DataPhase EVT_DATA_FRAME arm at line 480
// Phase 10 EXTENSION: stash filename + size into Slide-level recv_filename + recv_file_size.
(SlideState::HeaderPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
    if aux == 0 {
        // PHASE 10 NEW BLOCK: parse header payload (already consumed by framer).
        let payload = self.framer.take_payload();
        if let Some((name, size)) = parse_header_payload(&payload) {
            self.recv_filename = name;
            self.recv_file_size = size;
            self.events.push_back(EVT_HEADER_RECEIVED | (self.recv_file_idx as u32));
            self.recv_file_idx = self.recv_file_idx.wrapping_add(1);
        } else {
            // Malformed header — protocol violation.
            self.sm_state = SlideState::Error;
            return;
        }
        // EXISTING: ACK seq=0, advance to DataPhase.
        self.outbound_buf.push(CTRL_ACK);
        self.outbound_buf.push(0);
        self.expected_seq = 1;
        self.nak_retry_count = 0;
        self.sm_state = SlideState::DataPhase;
    } else {
        self.sm_state = SlideState::Error;
    }
}

fn parse_header_payload(payload: &[u8]) -> Option<(Vec<u8>, u32)> {
    // slide-rs/src/protocol.rs:47-56 + recv.rs:236-247: name + null + size_le_u32
    let null_idx = payload.iter().position(|&b| b == 0)?;
    if payload.len() < null_idx + 5 { return None; }
    let name = payload[..null_idx].to_vec();
    let size = u32::from_le_bytes(payload[null_idx + 1..null_idx + 5].try_into().ok()?);
    Some((name, size))
}
```

[CITED: state.rs:480-498 HeaderPhase arm; slide-rs/recv.rs:236-247 parse_header verbatim]

### Example 2: DataPhase EVT_DATA_FRAME extension (stash payload bytes)

```rust
// crates/bestialitty-core/src/slide/state.rs — DataPhase arm at line 509
// PHASE 10 EXTENSION: push payload bytes into recv_buf BEFORE the existing
// per-window ACK so JS sees them in event order.
(SlideState::DataPhase, e) if e & 0xFFFF_0000 == EVT_DATA_FRAME => {
    let payload = self.framer.take_payload();
    if payload.is_empty() {
        // EXISTING EOF handling — emit EVT_RECV_FILE_DONE so JS finalises file.
        self.outbound_buf.push(CTRL_ACK);
        self.outbound_buf.push(aux);
        self.expected_seq = 1;
        self.nak_retry_count = 0;
        self.sm_state = SlideState::HeaderPhase;
        // PHASE 10 NEW: signal end-of-file to JS.
        self.events.push_back(EVT_RECV_FILE_DONE);
    } else if aux == self.expected_seq {
        // PHASE 10 NEW: stash payload bytes for JS extraction + emit event.
        self.recv_buf.clear();
        self.recv_buf.extend_from_slice(&payload);
        self.events.push_back(EVT_RECV_DATA | (aux as u32));
        // EXISTING: per-window ACK on WIN_SIZE boundary.
        self.expected_seq = self.expected_seq.wrapping_add(1);
        self.nak_retry_count = 0;
        let last_acked = self.expected_seq.wrapping_sub(1);
        if last_acked & (WIN_SIZE - 1) == 0 {
            self.outbound_buf.push(CTRL_ACK);
            self.outbound_buf.push(last_acked);
        }
    } else {
        // EXISTING: NAK with expected_seq.
        self.outbound_buf.push(CTRL_NAK);
        self.outbound_buf.push(self.expected_seq);
    }
}
```

**Critical:** `recv_buf.clear()` BEFORE extend ensures recv_buf only ever holds ONE frame's bytes at a time. JS must drain (read + clear_recv) between EVT_RECV_DATA events. The event ring guarantees JS sees them in order; per-byte feed_chunk processing means events are pushed in order even if multiple frames complete in one chunk — the recv_buf is overwritten frame-by-frame BUT JS drains via the event ring which preserves order.

**Alternative:** Append (not clear+extend) and let JS drain at chunk-end after walking all events. Simpler but couples event ordering to clear_recv calls. Default: clear+extend per frame — JS reads after each EVT_RECV_DATA event before continuing event-ring drain.

[CITED: state.rs:509-535 DataPhase arm; framer.rs:86-88 take_payload]

### Example 3: JS recv main loop (slide-recv.js)

```js
// www/transport/slide-recv.js (skeleton)
import { sliceRecvBytesToOwned, readRecvFilename, readRecvFileSize, slide, wasmRef } from './slide.js';
// (slide.js exports new helpers OR slide-recv.js gets the slide instance via wireSlideRecv)

let currentFile = null;
let inflightDownloads = [];
let cancelInFlight = false;
let sessionFolderFallback = false;

export function onRecvEvent(evt) {
    const kind = evt & 0xFFFF_0000;
    if (kind === EVT_HEADER_RECEIVED) {
        if (currentFile) {
            // Defensive: previous file should have completed before next header.
            console.warn('[slide-recv] header arrived mid-file; flushing partial');
        }
        currentFile = {
            name: readRecvFilename(),
            totalBytes: readRecvFileSize(),
            chunks: [],
            bytesDone: 0,
        };
    } else if (kind === EVT_RECV_DATA) {
        if (!currentFile) return;
        const owned = sliceRecvBytesToOwned();
        currentFile.chunks.push(owned);
        currentFile.bytesDone += owned.byteLength;
    } else if (kind === EVT_RECV_FILE_DONE) {
        if (!currentFile) return;
        const file = currentFile;
        currentFile = null;
        const p = assembleAndDownload(file);
        inflightDownloads.push(p);
        // Inter-file gap (only meaningful for anchor-click path; folder-save
        // doesn't need it but the gap is harmless).
        p.finally(() => delay(250));
    }
}

export function isSlideActive() {
    if (!slide) return false;
    const st = slide.state();
    // STATE_IDLE=0, STATE_DONE=6, STATE_ERROR=7
    return st !== 0 && st !== 6 && st !== 7;
}

export async function cancelSlideRecv() {
    // Pattern 8 verbatim.
    if (cancelInFlight) return;
    cancelInFlight = true;
    // ... 5-step sequence ...
}
```

### Example 4: IndexedDB handle store (idb.js)

```js
// www/state/idb.js — minimal IndexedDB wrapper for FileSystemDirectoryHandle persistence
const DB_NAME = 'bestialitty-handles';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY_RECV_DIR = 'recv_directory';

let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

export async function getRecvDirHandle() {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(KEY_RECV_DIR);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('[idb] getRecvDirHandle failed:', e);
        return null;
    }
}

export async function setRecvDirHandle(handle) {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(handle, KEY_RECV_DIR);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[idb] setRecvDirHandle failed:', e);
    }
}

export async function clearRecvDirHandle() {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(KEY_RECV_DIR);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[idb] clearRecvDirHandle failed:', e);
    }
}
```

[CITED: WICG/file-system-access EXPLAINER §"Storing file handles or directory handles in IndexedDB"; structuredClone-compatible per spec]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Concatenation `new Uint8Array(buffer.length + frame.length); next.set(buffer); next.set(frame, buffer.length)` | `chunks: Uint8Array[]` + `new Blob(chunks)` | Phase 6 session-log convention (2026-04) | O(n²) → O(n) memory |
| `localStorage` for FileSystemDirectoryHandle | IndexedDB (structuredClone) | File System Access spec (2020+) | Persistent handles work |
| Always `requestPermission` | `queryPermission` first, then conditional `requestPermission` | Chrome 122 persistent permissions (2024) | Avoids unnecessary user-gesture race |
| `ESC ^` 2-byte wakeup | `ESC ^ S L I D E` 7-byte wakeup | Phase 8 D-01 (2026-05) | False-positive collision near zero |
| `reader.cancel() + port.close()` for cancel | CTRL_CAN + drain + force_idle | ADR-003 v0.2.1 (2026-05) | Wire stays connected; Z80 recovers cleanly |
| `std::time::Instant` for SM timing | All timing in JS | Phase 7 ADR-003 (2026-05) | wasm-pure core; CORE-02 invariant |

**Deprecated/outdated:**
- BYOB reader (`getReader({ mode: 'byob' })`) — STACK.md says skip; default reader is sufficient at 19200 baud.
- ZIP-then-download for multi-file batches — superseded by `showDirectoryPicker` opt-in fallback (PITFALLS §10 resolution).
- "Send byte-by-byte" SLIDE design considered in v0.1 — replaced by 1024-byte data frames + sliding window in v0.2.

## Assumptions Log

> Claims tagged `[ASSUMED]` in this research. Most claims are `[VERIFIED]` against existing code or `[CITED]` against authoritative refs.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `~999` collision budget is sufficient for any real workload — no real Z80 batch will ever hit 1000 same-named files | Pattern 5 / D-06 | Low; if hit, fall through to anchor-click is graceful |
| A2 | A 250 ms inter-file gap is sufficient for batches up to 5 files; >5 files may still hit Chrome's "Allow multiple downloads" prompt | Pitfall 1 | Medium — empirical verification deferred to Phase 12 UAT; documented in CONTEXT |
| A3 | `performance.memory.usedJSHeapSize` delta < 5× file size is a reasonable smoke threshold for the 1 MB test | Pitfall 7 | Low — coarse smoke, not a precise soak; Phase 6 SOAK is the precise tool |
| A4 | A 10 ms `setTimeout` poll for `slide.state() === STATE_DONE` in `waitForState` is acceptable jitter | Pattern 8 cancel | Low — 10 ms at 500 ms window = 2% noise; alternative is event-driven via dispatcher chunk arrival |
| A5 | Phase 10 may pull the 5-line minimum `slidePumpOnPortLost` real implementation forward from Phase 11 SLIDE-32 if natural | Pattern 7 / Discretion | Low — explicit Discretion granted in CONTEXT |
| A6 | The `10 ms` `setTimeout` polling pattern survives Playwright timer-mock environments | Pattern 8 / tests | Medium — tests may need to advance fake timers; documented in test plan |
| A7 | `EVT_HEADER_RECEIVED` ring-position guarantees JS reads filename BEFORE first EVT_RECV_DATA even if both fire in the same chunk | Pattern 1 / Example 3 | Medium — verified by event-ring FIFO discipline; native test corpus must cover this |
| A8 | `slide.state()` is cheap enough to poll at 10 ms during cancel without measurable CPU cost | Pattern 8 | Low — Rust function is a single u32 return; FFI cost ≈ 1 µs |

**If claims A2 or A6 prove wrong in Phase 10 execution, planner should widen the windows or adopt an event-driven cancel-completion signal.**

## Open Questions

1. **Should `recv_buf` accumulate across frames or be cleared per-frame?**
   - What we know: per-frame clear forces JS to drain between events; accumulating across frames lets JS read once per chunk.
   - What's unclear: which is simpler for the planner.
   - Recommendation: per-frame clear (Example 2). Rationale: the event ring already serialises `EVT_RECV_DATA` events, so JS naturally reads recv_buf inside its event-loop drain. Accumulating would let the JS skip drain calls but introduces ambiguity about which event "owns" which bytes.

2. **Cancel poll vs cancel event-driven completion?**
   - What we know: Pattern 8 uses 10 ms `setTimeout` poll on `slide.state()`; alternative is to make `dispatchRecvMode` set a module-scope flag when state hits Done.
   - What's unclear: trade-off between simplicity (poll) and event-purity (signal).
   - Recommendation: poll (simpler, well-understood); planner has Discretion to switch if Playwright timer mocks cause flakiness.

3. **Should `slidePumpOnPortLost` get a real 5-line impl in Phase 10?**
   - What we know: Phase 11 SLIDE-32 is the formal home; Phase 8 stub is a no-op; cancel work in Phase 10 needs SOMETHING when port drops mid-cancel.
   - What's unclear: 5-line minimum that just calls `slide.force_idle() + console.warn` is sufficient for Phase 10's correctness gate.
   - Recommendation: pull forward minimally (5-line `force_idle + console.warn + setWireOwner('terminal')`); document explicitly that Phase 11 will replace with full chip-emitting logic. CONTEXT explicitly grants this Discretion.

4. **Where does the wakeup matcher live — inline in `dispatchRecvMode` or extracted to `wakeupMatcher.js`?**
   - What we know: Inline duplicates ~25 LOC; extraction adds a module + import.
   - What's unclear: which the planner / reviewers prefer.
   - Recommendation: inline first (default per CONTEXT); refactor if a third caller emerges.

5. **`recv_filename` encoding — TextDecoder('latin1') vs ('utf-8')?**
   - What we know: CP/M is ASCII-only; uppercased filenames are pure ASCII subset of both.
   - What's unclear: defensive choice if a buggy Z80 emits high bytes.
   - Recommendation: `TextDecoder('latin1')` — never throws on invalid bytes (utf-8 throws), and CP/M filenames in real use are always ASCII so the codepoint values match. If high bytes appear, they round-trip through latin1 to the Chrome download filename; OS file system handles the rest. Document as Phase 10 choice.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Rust toolchain | Wave 1 SM extension | ✓ (assumed; Phase 7-9 used it) | stable | — |
| `wasm-pack` (target web) | Wave 2 build | ✓ | latest | — |
| Node.js + npm + Playwright | Wave 4 e2e | ✓ | (Phase 9 uses it) | — |
| Chromium (for File System Access tests) | Wave 4 folder-save spec | ✓ (Playwright bundled) | bundled | Manual UAT in Phase 12 if Playwright Chromium can't drive `showDirectoryPicker` |
| `--js-flags=--expose-gc` for Playwright (Pitfall 7 memory smoke) | Wave 4 1 MB test | ⚠ may need launch flag | — | Coarse delta sample without forced GC; document slack accordingly |

**No missing dependencies block execution.** All tooling is the same as Phase 9.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust: `cargo test` (Phase 1+); JS: Playwright (Phase 3+); both already wired |
| Config file | `Cargo.toml` (workspace) + `playwright.config.js` (www/) |
| Quick run command | `cargo test --workspace` + `cd www && npm run test:fast` |
| Full suite command | `cargo test --workspace && cd www && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLIDE-18 | Anchor-click per file + showDirectoryPicker opt-in | e2e | `npx playwright test slide-recv.spec.js -g "anchor-click"` | ❌ Wave 0 |
| SLIDE-18 | Folder-save with createWritable | e2e | `npx playwright test slide-recv.spec.js -g "folder-save"` | ❌ Wave 0 |
| SLIDE-19 | Multi-file 250 ms inter-file gap | e2e | `npx playwright test slide-recv.spec.js -g "inter-file gap"` | ❌ Wave 0 |
| SLIDE-20 | CP/M 8.3 verbatim names + collision suffix | e2e + unit | `npx playwright test slide-recv.spec.js -g "filename"` + `cargo test --test slide_recv_corpus filename_passthrough` | ❌ Wave 0 |
| SLIDE-21 | Zero-byte file (header → immediate EOF) | unit + e2e | `cargo test --test slide_recv_corpus zero_byte_file` + `npx playwright test slide-recv.spec.js -g "zero-byte"` | ❌ Wave 0 |
| SLIDE-22 | Sub-frame file (< 1024 bytes, single data + EOF) | unit + e2e | `cargo test --test slide_recv_corpus sub_frame_file` + `npx playwright test slide-recv.spec.js -g "sub-frame"` | ❌ Wave 0 |
| SLIDE-23 | Binary content (.COM/.HEX) round-trip | unit + e2e | `cargo test --test slide_recv_corpus binary_roundtrip` + `npx playwright test slide-recv.spec.js -g "binary"` | ❌ Wave 0 |
| SLIDE-24 | 1 MB+ memory bounded | e2e | `npx playwright test slide-recv.spec.js -g "1MB memory"` | ❌ Wave 0 |
| SLIDE-27 | Esc-key cancel slot 2/4 | e2e | `npx playwright test slide-cancel.spec.js -g "esc cancel"` | ❌ Wave 0 |
| SLIDE-29 | Hard-fail recovery (3 modes) | unit + e2e | `cargo test --test slide_recv_payload nak_budget_recovers_to_terminal` + `npx playwright test slide-cancel.spec.js -g "hard-fail"` | ❌ Wave 0 |
| SLIDE-30 | Cancel mid-frame leaves wire neutral | e2e | `npx playwright test slide-cancel.spec.js -g "wire neutral"` | ❌ Wave 0 |
| SLIDE-34 | Mid-stream ESC^SLIDE re-entry idempotent | unit + e2e | `cargo test --test slide_idempotent_reentry mid_recv_re6` (existing? extend) + `npx playwright test slide-cancel.spec.js -g "re-entry"` | ⚠ existing Rust test file; Wave 0 extends |

**Validation Architecture (Nyquist Dim 8) coverage matrix:**

| Test concern | Layer | File | Coverage |
|--------------|-------|------|----------|
| Cancel race condition (PITFALLS §5) | unit Rust | slide_recv_payload.rs | cancel_idempotent + cancel_pending_silent_drain (already in state.rs) |
| Cancel race condition | e2e JS | slide-cancel.spec.js | mid-frame cancel + Z80-no-echo timeout + wire-neutral assertion |
| Re-entry idempotency (SLIDE-34) | unit Rust | slide_idempotent_reentry.rs | extend with re-recv-mid-data scenario |
| Re-entry idempotency | e2e JS | slide-cancel.spec.js | bot emits second ESC^SLIDE mid-recv; assert chip warning + clean re-entry |
| Memory bounds (SLIDE-24) | e2e JS | slide-recv.spec.js | 1 MB file + performance.memory delta sample |
| Edge-case coverage (zero-byte / sub-frame / binary / multi-file / single-file) | unit Rust | slide_recv_corpus.rs | 5 fixtures × native cargo |
| Edge-case coverage | e2e JS | slide-recv.spec.js | 5 fixtures × Playwright |
| Mock peer drift (PITFALLS §13) | unit Rust | slide_recv_corpus.rs | hand-built byte sequence is contract for bot |
| Mock peer drift | e2e JS | slide-recv.spec.js + mock-serial-slide-bot.js sender role | bot bytes verified against native corpus |

### Sampling Rate

- **Per task commit:** `cargo test --workspace -p bestialitty-core` (Rust SM tests, ~5 s)
- **Per wave merge:** `cargo test --workspace && cd www && npm run test:fast` (~30 s, deterministic Playwright subset)
- **Phase gate:** Full suite green, including `npm run test:e2e` (full Playwright run + slide-recv + slide-cancel specs).

### Wave 0 Gaps

- [ ] `crates/bestialitty-core/tests/slide_recv_payload.rs` — covers SLIDE-21/22/23 unit-level + recv-payload extraction (NEW file)
- [ ] `crates/bestialitty-core/tests/slide_recv_corpus.rs` — covers SLIDE-21/22/23/24/29 end-to-end SM driving (NEW file)
- [ ] `www/tests/transport/slide-recv.spec.js` — covers SLIDE-18/19/20/21/22/23/24 e2e (NEW file with stub `test.skip` declarations Wave 0; filled Wave 4)
- [ ] `www/tests/transport/slide-cancel.spec.js` — covers SLIDE-27/29/30/34 e2e (NEW file, same pattern)
- [ ] `crates/bestialitty-core/tests/slide_torn_chunk.rs` — extend with recv-corpus chunk-split fixtures (existing file, +tests)
- [ ] `crates/bestialitty-core/tests/slide_boundary_shape.rs` — extend with new EVT_HEADER_RECEIVED / EVT_RECV_DATA / EVT_RECV_FILE_DONE constants + new fn-pointer pin for recv accessors (existing file, +pins)
- [ ] `crates/bestialitty-core/tests/slide_wasm_boundary_shape.rs` — same extensions for wasm façade (existing file, +pins)
- [ ] `www/tests/transport/mock-serial-slide-bot.js` — add sender-role state machine (existing file, +role parameter + sender SM state)

*Existing test infrastructure covers some of Phase 10 — the Rust receiver SM is already 100% tested at unit level (state.rs:565-797); Phase 10 adds payload-extraction tests, e2e flows, and edge cases.*

## Security Domain

> Per .planning/config.json: no explicit `security_enforcement` key — treating as enabled. Phase 10 is a feature-add with file-write capability; security analysis applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local serial; user owns the device |
| V3 Session Management | no | Per-page-load only |
| V4 Access Control | yes (browser-mediated) | File System Access API permission model — browser handles user consent |
| V5 Input Validation | yes | CP/M filename validation already done in Phase 9 send-side; recv-side filename trust is delegated to browser download filename sanitization |
| V6 Cryptography | no | CRC-16-CCITT is integrity, not crypto |
| V11 Business Logic | yes | Cancel sequence + force_idle escape hatch — must not be bypassable |

### Known Threat Patterns for {Rust+JS+wasm+Web Serial+File System Access}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hostile Z80 sends filename like `../../../../etc/passwd` | Tampering | Browser download API + File System Access API both treat the filename as a leaf-name only; Chrome rejects path-traversal characters in `<a download>` and `getFileHandle` validates legal filename chars. CP/M 8.3 names are a strict subset of Chrome-legal filenames so risk is structurally low. **Mitigation: do nothing — relying on Chrome filename sanitization, same as Phase 6 session-log download.** [VERIFIED: Chrome anchor download docs] |
| Hostile Z80 sends huge file claiming size = 1 GB | DoS (memory) | `chunks: Uint8Array[]` accumulator unbounded; could OOM the tab. **Mitigation: cap accumulator at e.g. 100 MB; if `bytesDone > MAX_FILE_SIZE`, transition to error state and emit CTRL_CAN.** Phase 10 acceptance: document the cap in `slide-recv.js` as `MAX_FILE_SIZE = 100 * 1024 * 1024`. |
| Re-entry wakeup attack: malicious Z80 emits ESC^SLIDE at high frequency to wedge BestialiTTY in a re-entry loop | DoS | Pattern 9 console.warns on each detection; no rate-limit. **Mitigation: low priority; user can close the tab. Document as Phase 12 hardening if observed.** |
| User dropbox-style folder-save handle gets pointed at a sensitive system folder via showDirectoryPicker | Tampering | Browser shows the folder name in the permission prompt; user is responsible for confirming. **Mitigation: Settings row text "Saving to: ~/Downloads/MicroBeast" makes the destination glanceable; first-use confirmation chip is Phase 11 scope.** |
| CRC bypass via crafted hostile bytes from Z80 | Tampering | Phase 7 framer's CRC is mandatory + handled in Rust; no JS-side CRC bypass exists. [VERIFIED: framer.rs:163-181] |

**Phase 10 net new attack surface:**
- File System Access API write capability (mitigated by browser's permission model + folder-scoped handle)
- New IndexedDB store (mitigated by same-origin policy)
- 1 MB+ memory bound exposed to hostile sender (mitigated by MAX_FILE_SIZE cap recommendation above)

## Sources

### Primary (HIGH confidence)
- `crates/bestialitty-core/src/slide/state.rs` — receiver SM at lines 466-555; CancelPending at 284-303; cancel/force_idle at 332-348 [VERIFIED]
- `crates/bestialitty-core/src/slide/framer.rs` — DFA at lines 71-184; build_frame_into at 192-221 [VERIFIED]
- `crates/bestialitty-core/src/lib.rs:33-356` — wasm_boundary façade pattern [VERIFIED]
- `www/transport/slide.js` — Phase 8/9 dispatcher; matcher at 229-310; outbound triple at 330-344; sender pattern at 379-672 [VERIFIED]
- `www/transport/session-log.js` — anchor-click + Blob pattern at 60-85 [VERIFIED]
- `www/input/keyboard.js` — Esc disambiguation chain at 202-227 [VERIFIED]
- `www/state/prefs.js` — DEFAULTS at 18-29; defensive merge at 55 [VERIFIED]
- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — bidirectional CAN echo + force_idle escape hatch [VERIFIED]
- `.planning/research/PITFALLS.md` — §1, §3, §5, §9, §10, §12, §13 [VERIFIED]
- `.planning/research/ARCHITECTURE.md` — §1, §2, §3, §7, §9 [VERIFIED]
- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec [VERIFIED]
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/recv.rs:103-247` — reference receive impl [VERIFIED]
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs:47-56` — header frame layout [VERIFIED]
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/send.rs:100-260` — sender reference (for mock-bot sender role) [VERIFIED]
- `.planning/phases/10-slide-receiver-cancellation/10-CONTEXT.md` — locked decisions D-01..D-07 + Claude's Discretion [VERIFIED]
- `.planning/phases/09-slide-sender-host-z80-send/09-CONTEXT.md` — sender precedent [VERIFIED]
- `.planning/phases/08-wasm-boundary-js-dispatcher-esc-wakeup/08-CONTEXT.md` — wakeup matcher precedent [VERIFIED]
- `.planning/phases/07-slide-rust-core-framer-crc-state-machine/07-CONTEXT.md` — receiver SM contract [VERIFIED]
- `www/tests/transport/mock-serial-slide-bot.js:1-100` — Phase 9 mock bot extension target [VERIFIED]

### Secondary (MEDIUM confidence)
- developer.chrome.com — File System Access API + persistent permissions blog (Chrome 122+) [CITED via WebSearch]
- WICG/file-system-access EXPLAINER.md — IndexedDB persistence; structuredClone-compatible handles [CITED via WebSearch]
- MDN — Blob, URL.createObjectURL, IndexedDB, FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemHandle.queryPermission/requestPermission

### Tertiary (LOW confidence)
- Chrome multiple-download throttle threshold — empirical only, not formally documented [CITED via WebSearch; flagged as documented limitation]
- 500 ms Z80 echo-wait sufficiency on real hardware — flagged for Phase 12 UAT [CITED: ADR-003]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all browser APIs MDN/Chrome-confirmed
- Architecture: HIGH — every integration point grounded in existing code with line numbers; receiver SM already shipped in Phase 7
- Pitfalls: HIGH (BLOCKING/HIGH), MEDIUM (cancel timing under real-hardware Z80, multi-download throttle threshold)
- Validation: HIGH — Rust SM unit tests at 100% coverage; Playwright e2e harness already proven in Phases 5/8/9
- Security: HIGH — net new attack surface is file-write (browser-mediated) + IndexedDB (same-origin); MAX_FILE_SIZE cap is the one new mitigation

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (30 days; stable browser APIs + frozen protocol contract)
