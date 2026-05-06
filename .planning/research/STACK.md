# Stack Research — v1.1 FileTransfer (SLIDE in BestialiTTY)

**Domain:** Browser-side binary file-transfer protocol (SLIDE) layered on Web Serial, inside an existing Rust→wasm + JS-shell terminal emulator.
**Researched:** 2026-04-25
**Confidence:** HIGH

This document is **incremental**: it lists ONLY what is added or newly exercised
for v1.1 FileTransfer. The validated v1.0 stack (`wasm-bindgen 0.2.118`,
`wasm-pack --target web`, `vte = "=0.15"`, Web Serial driven from JS,
canvas + bitmap atlas, localStorage prefs blob, GitHub Pages static deploy)
is unchanged and is not re-itemised here. The previous v1.0 STACK.md content
this file replaces remains in git history.

---

## Recommended Stack — Additions

### New Rust crate dependency (core)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `crc` (mrhooray/crc-rs) with the `Algorithm` constructor + `NoTable` impl | `=3.4` (pin) | Compute CRC-16-CCITT (poly 0x1021, init 0xFFFF) on every outbound and inbound SLIDE frame inside the wasm core. | Authoritative Rust CRC crate, MIT/Apache-2.0, `no_std`. SLIDE's CRC parameters match the pre-defined `CRC_16_IBM_3740` constant (width 16, poly 0x1021, init 0xFFFF, refin/refout false, xorout 0). One-line replacement for the hand-rolled bit-by-bit loop in `slide-rs/src/protocol.rs`. The `NoTable` implementation avoids shipping a 512-byte (or 8-KiB) lookup table in the wasm `.text` section — at 19200 baud (≤ 2 kB/s) the table buys nothing and CRC is the wrong place to spend wasm bytes. |

That is the **only** new Rust dep. No `web-sys`, no `js-sys`, no
`wasm-bindgen-futures`, no `gloo-*`. SLIDE is a pure state machine — same
architectural rule as the VT52 parser (CLAUDE.md / CONTEXT D-06 / D-20:
`wasm-bindgen` macros only in `lib.rs`'s `wasm_boundary` mod, browser
bindings forbidden everywhere else).

### Newly exercised browser APIs (no library, no polyfill)

| API | Where used | Chromium version | Why this one |
|-----|------------|------------------|--------------|
| **HTML Drag and Drop API** (`dragenter` / `dragover` / `dragleave` / `drop` on the `#terminal-wrapper` canvas wrapper) | `www/transport/slide-dropzone.js` (new) | Chrome 4+ (universal) | Only API that exposes `event.dataTransfer.files` for OS-dropped files. No alternative. |
| **`DataTransferItemList`** + `item.kind === "file"` filter on `dragover` | drop-zone visual feedback (set `dropEffect = "copy"` only when files are present) | Chrome 18+ (universal) | Lets us reject non-file drags (selected text, dragged DOM nodes from another tab) without ever showing the drop overlay. Per MDN: must be filtered at `dragover` time, before `drop`. |
| **`File.stream()` → `ReadableStream<Uint8Array>` + `getReader()`** | Pull file bytes lazily, 64 KiB at a time, into the SLIDE framer — never load the whole file into JS memory at once. | Chrome 76+ (universal) | A `File` is a `Blob`; `Blob.stream()` returns a `ReadableStream` that pulls from the underlying file lazily. Default chunk size in Chromium is 65 536 bytes — already the right granularity for our 1024-byte SLIDE frames. Backpressure is automatic: each `await reader.read()` waits for the previous chunk to be consumed before pulling the next from disk. This is the Phase 5 Pattern 2 read-loop shape, just running over a file instead of a port. |
| **Anchor download via `URL.createObjectURL(blob)` + `<a download="NAME">`** | Trigger a Chrome download per received file inside `slide-recv.js` | Chrome 14+ (universal) | One-liner, no permission prompts, no user-gesture window beyond the in-progress SLIDE session. **`URL.revokeObjectURL` after a `setTimeout(_, 0)`** to free the blob without racing the download start. |
| **`AbortController` / `AbortSignal`** | Cancel an in-progress SLIDE session from the floating chip's "Cancel" button. Threaded through the JS side; the Rust state machine just exposes a `cancel()` method that emits CTRL_CAN. | Chrome 66+ (universal) | Already the canonical cancel pattern in modern browser APIs. Pairs naturally with the existing `reader.cancel()` shape used in `serial.js`'s read loop. |

### Reused-from-v1.0 (no version change)

| Technology | Version | New use in v1.1 |
|------------|---------|-----------------|
| `wasm-bindgen` | `0.2.118` (existing pin) | Façade gains `Slide` struct, `slide_send_init`, `slide_feed_byte` / `slide_feed_chunk`, `slide_pop_tx_chunk`, `slide_state`, `slide_progress`, `slide_cancel` methods. Same target-arch-gated `wasm_boundary` mod, same one-call-per-chunk discipline (RESEARCH Pitfall #4). |
| `wasm-pack` `--target web` | (existing) | Rebuild yields a fatter `.wasm` (+ ~3 KB for SLIDE state machine + ~1 KB for `crc` NoTable). Acceptable. |
| Web Serial `port.readable.getReader()` (default reader, **NOT** BYOB) | (existing) | Same read loop as Phase 5 — see "Chunk handling" below for why we do NOT switch to a BYOB reader. |
| Web Serial `writer.write(Uint8Array)` | (existing) | SLIDE TX path: JS pulls completed frame bytes from the wasm core via `slide_pop_tx_chunk` and writes them straight to the existing `writer`. Reuses `tx-sink.js` registration so paste/keystrokes are correctly **suspended** (not contended) during a SLIDE session. |
| localStorage prefs blob | (existing, schema-versioned) | Adds `prefs.slide = { autoSendCommand: "B:SLIDE R\r", autoSend: true }`. New keys, same blob, same `savePrefs` debounce — schema version bump only if the migration code lands. |

---

## Installation

No npm/cargo install commands beyond the existing workspace. The single new
dependency is added to `crates/bestialitty-core/Cargo.toml`:

```toml
[dependencies]
vte = "=0.15"
# v1.1 FileTransfer — CRC-16-CCITT (poly 0x1021, init 0xFFFF) for SLIDE
# framer. NoTable impl keeps wasm small; no_std-clean. Pinned per the
# vte =0.15 precedent — silent `cargo update` cannot drift the API.
crc = "=3.4"
```

That is the only `Cargo.toml` edit. Everything else is pure source code on
both sides of the wasm boundary.

---

## Detailed answers to the six investigation areas

### 1. Browser File API surfaces (drag-drop → byte stream)

**Use:** `event.dataTransfer.files` → `File` → `file.stream().getReader()`.
Iterate `await reader.read()` and forward each `Uint8Array` chunk to the
SLIDE framer.

**Why not `FileReader.readAsArrayBuffer`:** Loads the whole file into JS heap
at once. Fine for 4 KB CP/M binaries, dies on a 4 MB disk image. SLIDE on a
real MicroBeast can transfer files larger than the browser tab's comfortable
working set; we must stream.

**Why not File System Access API (`showOpenFilePicker` →
`FileSystemFileHandle.getFile()`):** Drag-drop already gives us a `File` — no
permission prompt, no user-gesture window to manage, and no extra Chromium
85+ requirement on top of the Web Serial floor. The File System Access API
matters for **save** (see §2), not load.

**Compatibility floor:** `Blob.stream()` is Chromium 76+. Web Serial is
Chromium 89+. Web Serial is the ceiling — `stream()` is universally available
wherever BestialiTTY runs.

**Subtlety:** If we ever want **directory** drops (drop a folder of files),
the modern path is `DataTransferItem.getAsFileSystemHandle()` (Chrome 86+).
v1.1 is explicitly file-list only; defer this.

### 2. Browser download triggering (per-file Save)

**Use:** Anchor-click pattern. After each file's last frame is committed:

```js
const blob = new Blob([bytes], { type: 'application/octet-stream' });
const url  = URL.createObjectURL(blob);
const a    = document.createElement('a');
a.href = url;
a.download = filename;       // server-suggested filename (CP/M 8.3)
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(() => URL.revokeObjectURL(url), 0);
```

**Why not `showSaveFilePicker`:** Three blockers.

1. Requires a **fresh user gesture per call**. SLIDE-receive sessions are
   server-initiated (`SLIDE S` on the Z80) — by the time the first file
   completes, we are well past any user click. The picker would throw
   `SecurityError: must be handling a user gesture`.
2. Even if we held the gesture (we cannot, mid-async), the user would have to
   click "Save" *N* times for *N* files. The locked-decision is "one Chrome
   download per file as it completes" — not a save dialog per file.
3. Adds Chromium 86+ requirement on top of Web Serial 89+. No new floor in
   practice, but no benefit either.

**Multi-file throttling:** Chrome shows the "This site attempted to download
multiple files automatically" banner the *second* time within a short window
unless the user has clicked "Allow" on the bestialitty origin. Two
mitigations, both in scope:

- **Stagger downloads.** Insert a 250 ms gap between successive `a.click()`s.
  At ≤ 2 kB/s wire speed each file is already seconds apart in practice; the
  gap matters only when many tiny files arrive in rapid succession.
- **Settings note + first-run hint.** Document the "Allow multiple downloads
  for this site" setting in the Settings pane. Mirror the existing Phase 4
  approach to browser-reserved Ctrl combos: discoverable note, not API
  acrobatics.

The `showSaveFilePicker` path stays in `## What NOT to Use` below.

### 3. wasm-bindgen byte-buffer interop (no per-byte boundary crossings)

**Locked rule (already validated in v1.0):** ONE `term.feed(bytes)` call per
serial RX chunk (RESEARCH Pitfall #4 / SC-4, terminal `lib.rs` comments). The
SLIDE wasm boundary follows the same shape:

- **JS → Rust (RX path):** `slide.feed_chunk(bytes: Uint8Array)` —
  wasm-bindgen marshals `Uint8Array` → `&[u8]` with one copy of the chunk
  into linear memory. For a 1024-byte SLIDE frame that is a 1 µs memcpy on
  any machine that can run a browser. Don't optimise.

- **Rust → JS (TX path) — the load-bearing decision:** Use the **existing
  zero-copy `wasm.memory.buffer` view pattern** that `canvas.js` already
  uses for `gridView`. The SLIDE state machine maintains an internal
  `Vec<u8>` outbound queue. The façade exposes:

  ```rust
  pub fn tx_ptr(&self) -> *const u8 { self.inner.tx_buf.as_ptr() }
  pub fn tx_len(&self) -> usize     { self.inner.tx_buf.len() }
  pub fn tx_clear(&mut self)        { self.inner.tx_buf.clear(); }
  ```

  JS reads with:

  ```js
  const view = new Uint8Array(wasm.memory.buffer, slide.tx_ptr(), slide.tx_len());
  await writer.write(view.slice());   // see caveat
  slide.tx_clear();
  ```

  **Caveat — view lifetime:** `Uint8Array` views over `wasm.memory.buffer`
  are invalidated whenever wasm memory grows (any `Vec` realloc inside the
  core). The Phase 6 D-03 / D-19 pattern handles this for the grid by
  re-deriving the view when `wasm.memory.buffer !== priorBuffer`. SLIDE
  follows the same pattern. **Critical:** if `writer.write(view)` is awaited
  and a memory growth happens between the `await` resolving and the bytes
  being copied to the wire (it can — Chromium's serial writer is async),
  behaviour is undefined. Mitigations, in priority order:

  1. **Copy at the JS boundary**: `writer.write(view.slice())`. The slice
     allocates an independent ArrayBuffer; safe across awaits. Cost is
     irrelevant at 19200 baud. **This is the recommended path.**
  2. **Drain synchronously**: pop the queue, snapshot length, copy out,
     clear before any await. Same effect, more code.

  The existing pattern in `canvas.js` works without copying because the
  read is synchronous (canvas blit is sync); the SLIDE write is async, and
  must copy.

- **Why not return `Vec<u8>` from each Rust method:** wasm-bindgen will
  copy the `Vec<u8>` into a fresh `Uint8Array` on every call. That is two
  allocations (Rust grow + JS allocation) per pop, and a fresh GC root.
  At 19200 baud over a single 4 KB transfer that is 4-8 frames per second —
  not a perf problem, but the existing zero-copy pattern is already in the
  codebase and is the architectural fit. Do not deviate.

### 4. Drag-drop event semantics on the canvas

**Sequence (modern, MDN-verified):**

| Event | Listener target | preventDefault? | Purpose |
|-------|-----------------|-----------------|---------|
| `dragenter` | `#terminal-wrapper` | yes | Increment counter; if first enter, show overlay highlight. |
| `dragover` | `#terminal-wrapper` | **yes (mandatory)** | Without this, browser refuses the drop. Set `e.dataTransfer.dropEffect = 'copy'` only if `[...e.dataTransfer.items].some(i => i.kind === 'file')`. |
| `dragleave` | `#terminal-wrapper` | yes | Decrement counter; if 0, hide overlay. |
| `drop` | `#terminal-wrapper` | **yes (mandatory)** | Without this, browser opens the dropped file in the tab — full BestialiTTY navigation, full state loss. |
| `dragover` | `window` | yes (when items contain files) | Belt-and-braces guard so a missed-target drag onto chrome (top-bar, scrollback indicator) does not fall through to default-open. |
| `drop` | `window` | yes (when items contain files) | Same. |

**The flicker problem:** Naive `dragenter` / `dragleave` flickers the
overlay when the cursor crosses child elements (the cursor span, the
inverted-glyph selection rectangle). MDN does not show this — the canonical
fix is the **counter pattern**: maintain `let dragDepth = 0`; increment on
every `dragenter`, decrement on every `dragleave`, only hide overlay when
`dragDepth === 0`, force `dragDepth = 0` on `drop`. Apply on
`#terminal-wrapper`, not `<canvas>` directly — the wrapper does not have
child elements that fire dragenter/leave.

**Compatibility with existing canvas focus/blur:** Canvas focus is governed
by the `[data-focused]` attribute pattern (Phase 3 UAT gap #7). Drop events
do **not** fire focus changes; the drop overlay is visual only. After a
successful drop, `slide-dropzone.js` calls the existing focus helper to
restore canvas focus before triggering SLIDE — the user-experienced focus
state is unchanged.

**Drop-target scope:** Per the locked decision, drag-drop is **canvas /
terminal area only** — not the top bar, not the Settings pane, not the
scrollback chip. Implementation: listen on `#terminal-wrapper` and the
`window`-level guards filter only; top-bar and Settings pane do not get
drop handlers.

### 5. CRC-16-CCITT in Rust

**Use:** `crc::Crc::<u16, crc::NoTable>::new(&CUSTOM_ALG)` where
`CUSTOM_ALG` matches `CRC_16_IBM_3740` (width 16, poly 0x1021, init 0xFFFF,
refin false, refout false, xorout 0, check 0x29B1).

**Why this matches SLIDE exactly:** SLIDE's `protocol.rs` hand-roll uses
`init = 0xFFFF`, MSB-first (no reflection), no final xor. That is *literally*
the IBM-3740 catalogue entry. The hand-rolled implementation in
`slide-rs/src/protocol.rs` even pins the reference test vector
`crc16_ccitt(b"123456789") == 0x29B1`, which equals `IBM_3740.check`. We
are not approximating; the predefined constant **is** the algorithm.

**Why `NoTable` over `Table<1>` / `Table<16>`:**

| Implementation | Binary cost | Throughput @ 1 frame/300 µs |
|----------------|-------------|------------------------------|
| `NoTable` (bit-by-bit) | 0 KB | ~10 MB/s |
| `Table<1>` (256 × 2 B = 512 B) | +0.5 KB wasm | ~50 MB/s |
| `Table<16>` (16 × 256 × 2 B = 8 KB) | +8 KB wasm | ~200 MB/s |

At 19200 baud, peak data rate is 1920 B/s. CRC of a 1024-byte frame at
10 MB/s takes 100 µs — three orders of magnitude faster than the wire. The
table buys nothing. Wasm size is the load-bearing axis (every KB matters
for a static-site initial paint), so `NoTable`.

**Why not just keep the hand-roll from `slide-rs/src/protocol.rs`:**
Acceptable, and the test already pins it. But:

- The shared crate has zero dependencies and adds the predefined
  `CRC_16_IBM_3740` constant — one line replaces the whole
  `crc16_ccitt(data: &[u8]) -> u16` function and removes a hand-rolled bit
  loop from the code review surface.
- The `crc` crate exposes a `Digest` API (`digest.update(slice)` /
  `digest.finalize()`) that supports **incremental** CRC over multiple
  byte slices. The hand-roll currently requires building a `Vec` of
  `[seq, len_h, len_l, ...payload]` and CRC-ing it whole. Streaming CRC
  is the natural shape for the wasm-side framer, where header bytes and
  payload bytes arrive at different state-machine transitions.

Use `crc = "=3.4"` with `NoTable`. Keep the existing test vector as a
regression gate.

### 6. Chunk handling in Web Serial reads

**Confirmed via Web Serial spec + Chromium impl:** chunks delivered by
`reader.read()` from `port.readable.getReader()` (default reader) do **not**
align with any application-layer framing. A 6-byte SLIDE control frame
`[0x06][SEQ]` may arrive as one chunk, two chunks, or arrive interleaved
with the trailing bytes of the previous frame. This is the identical
chunk-tearing problem v1.0 solved for the VT52 parser (Pitfall #10 — "raw
Uint8Array chunks pass directly to the parser via `term.feed`; no
byte-to-string coercion on the read path"; Phase 1 has 20 torn-chunk tests).

**Apply the v1.0 pattern to SLIDE.** The Rust-side framer is a byte-fed
state machine: `feed_chunk(&[u8])` advances state for each byte, emits
framing events (`HeaderReceived`, `DataFrameReceived(seq, payload)`,
`Eof`, `Fin`, `BadCrc`) into an internal queue, and never returns mid-byte.
JS calls `slide.feed_chunk(value)` once per `reader.read()` result, then
drains the event queue with a polling accessor (`slide.next_event() -> u32`
tag plus pointer accessors for any byte payload — same shape as
`host_reply_ptr` / `host_reply_len`).

**Why NOT switch to a BYOB reader (`getReader({ mode: 'byob' })`):**

- BYOB is a zero-copy optimisation for high-throughput readers.
  `Uint8Array` view onto a caller-owned `ArrayBuffer`, no internal queue
  copy. **None of this matters at 19200 baud (~2 kB/s).**
- BYOB requires Chromium 106+ for Web Serial specifically (separate from
  general Streams BYOB support). Phase 5 is pinned to Chromium 89+ — adding
  a 106+ floor for SLIDE only would split the support matrix for no gain.
- BYOB adds complexity: caller must allocate buffers of the right size,
  handle partial reads, decide on a buffer pool. The default reader has
  none of this.
- Worst case at 19200 baud: 2 kB/s ÷ 1024-byte SLIDE frames = ~2 frames/s.
  The existing default-reader chunk model trivially keeps up; the bottleneck
  is the wire.

**Read-loop integration:** the Phase 5 `runReadLoop` in `serial.js` calls
`term.feed(value)`. v1.1 splits the dispatch:

- **In normal mode:** `term.feed(value)` — unchanged.
- **In SLIDE mode:** `slide.feed_chunk(value)`, then drain SLIDE events.
  The terminal parser is **suspended** (locked decision) — bytes are routed
  to SLIDE only. Mode flag is JS-side state in a new
  `www/slide/dispatcher.js`, set when JS sees the `ESC ^` (0x1B 0x5E)
  preamble in raw RX bytes (or set proactively when JS initiates a send).

Bypass intentionally lives in JS, not Rust: the Rust core remains
parser-agnostic, the JS shell decides "which state machine owns the wire
right now." This matches the architectural rule.

The cancellation-safe `while (port.readable)` outer loop and
`reader.cancel()` teardown remain unchanged. SLIDE adds no new teardown
paths — a mid-session disconnect drains the SLIDE state machine through its
normal "session abort" path (CTRL_CAN to wire, FIN-FIN handshake abandoned).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `crc` crate `NoTable` | Hand-rolled bit-by-bit CRC (port `slide-rs/src/protocol.rs::crc16_ccitt` verbatim) | Acceptable if we want literally zero new deps. Tradeoff is ~30 lines of fiddly bit-twiddling in the code review surface vs. one line. Not worth it; `crc` is MIT/Apache, audited, and adds <1 KB. |
| `crc` crate `NoTable` | `crc16` crate (older, separate from mrhooray's `crc-rs`) | The `crc16` crate is fine but smaller, less maintained, and ships variant tables hardcoded — no compile-time `Algorithm` constructor for arbitrary parameters. Use `crc` for the long-term-maintained API. |
| `crc` crate `NoTable` | `crc-fast` (SIMD-accelerated) | Pointless at 19200 baud and the SIMD path requires nightly + target features. Adds wasm bytes for zero gain. |
| Anchor-click download per file | `showSaveFilePicker` (File System Access API) | Use **only** if v1.x ever lets the user pre-select a target directory before initiating receive — the only path that satisfies the user-gesture rule. Out of scope for v1.1. |
| Anchor-click download per file | Server-side ZIP packaging | Out of question — static site. Listed for completeness. |
| Anchor-click download per file | IndexedDB virtual filesystem with a "Browse received files" UI | Locked out of v1.1 scope. Worth re-evaluating in v2 if users ask for batch operations. |
| `Blob.stream()` + `getReader()` | `FileReader.readAsArrayBuffer` (whole file → memory) | Tiny files only. Switch if a file-size cap is enforced (it is not). |
| `Blob.stream()` + `getReader()` | `File.arrayBuffer()` (Promise-returning, whole file) | Same problem as above — loads everything. Use only for the SLIDE header building, where the filename + size fit in <100 bytes. |
| Default Web Serial reader | BYOB reader (`getReader({ mode: 'byob' })`) | If we ever raise the wire baud to 1 Mbps+ (we won't — UART tops out around 115200 in practice for the MicroBeast). Keep default reader. |
| `wasm.memory.buffer` view + `view.slice()` for TX | Return `Vec<u8>` from each `slide_pop_tx_chunk` call | If we ever decide the existing zero-copy pattern is too much complexity for the SLIDE-specific code, the `Vec<u8>` return shape is acceptable here (low frequency, small buffers). The existing pattern is preferred only because it is already in the codebase and is the architectural fit. |
| Drag-drop on `#terminal-wrapper` only | Drop anywhere in the page (full-page overlay) | If usability testing finds users dragging onto the top bar by accident. Locked decision is canvas-only for v1.1. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `serialport` crate (used by `slide-rs`) | Native serial — not available in wasm. SLIDE's wasm port owns framing logic only; the wire is JS. | Drive Web Serial from JS; pass bytes across the wasm boundary. |
| `tokio` / `async-std` / `futures` in the core | Would force `wasm-bindgen-futures` + `web-sys::ReadableStream` plumbing, breaking the architectural rule. The state machine is sync and that is correct — the JS event loop drives it. | Sync state machine in Rust; JS owns all I/O. |
| `wasm-bindgen-futures` in the core | Same as above. SLIDE callbacks would couple the core to browser eventing. | JS calls sync `feed_chunk` / drains the event queue between awaits. |
| `web-sys::HtmlAnchorElement` for download triggering from Rust | Architectural-rule violation; the v1.0 boundary disallows `web-sys`. | Trigger anchor-click in JS after pulling completed file bytes from wasm. |
| `serde-wasm-bindgen` for crossing the boundary | Allocates JS objects per call; we are passing byte buffers, not structures. | `Uint8Array` (in) + `wasm.memory.buffer` view (out). Copy-once at JS boundary. |
| `comlink` / a worker-based architecture for the wasm core | Adds postMessage hops and a structured-clone copy on every boundary crossing. SLIDE is not CPU-bound; main-thread is right. | Main-thread wasm, same as v1.0. |
| `pako` / any inflate/deflate library | SLIDE does not compress. Adds bytes for nothing. | — |
| `crypto-js` / SHA-anything | SLIDE has CRC, not crypto integrity. | `crc` crate. |
| Polling at high frequency for SLIDE event drain (e.g. `setInterval(_, 1)`) | Wastes battery; couples SLIDE to clock instead of wire. | Drain immediately after each `await reader.read()` returns — same shape as Phase 6 dirty-row repaint wake. |
| `showOpenFilePicker` for loading files for send | Adds a permission prompt and user-gesture rule on top of drag-drop, which already gives us the file. | Drag-drop only. (A regular `<input type="file">` can be the keyboard-fallback if needed; same `File` shape, same `.stream()`.) |
| `showSaveFilePicker` per-file on receive | Cannot satisfy user-gesture rule mid-async-session; UX would prompt N times. | Anchor-click download with `setTimeout(revoke, 0)` and a 250 ms inter-file gap. |
| Returning `Vec<u8>` for the *outbound TX queue* (not for one-shot small returns) | Allocates JS-side per call; conflicts with the established zero-copy pattern in `canvas.js`. | `tx_ptr` / `tx_len` / `tx_clear` accessors over `wasm.memory.buffer`. |

---

## Stack Patterns by Variant

**If a single SLIDE session transfers more files than Chrome's
"automatic-downloads" threshold (commonly 10):**
- Stagger downloads with a 250 ms gap (already specified above).
- First-run banner or Settings note pointing at
  `chrome://settings/content/automaticDownloads` for the bestialitty origin.
- Do NOT batch into a single ZIP — that introduces a compression dep and
  breaks the "one Chrome download per file" locked decision.

**If a future v1.2 wants directory drop (drop a folder of files):**
- Switch from `event.dataTransfer.files` to iterating
  `event.dataTransfer.items` and calling
  `item.getAsFileSystemHandle()` (Chrome 86+, no extra cost — Chrome floor
  is already 89 for Web Serial).
- Recurse into directory handles with `for await (const entry of dir.values())`.
- Locked out of v1.1; flag as v1.2 if requested.

**If a future v1.x wants pre-selected save target (no per-file Chrome
download, save into a chosen folder):**
- Use `showDirectoryPicker()` once at session start under user gesture,
  cache the `FileSystemDirectoryHandle` in IndexedDB, request persistent
  permission (Chrome 122+), then `dir.getFileHandle(name, { create: true })`
  per file — no Chrome download UI at all.
- Significant UX upgrade; significant complexity. Out of v1.1.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `crc = "=3.4"` | `wasm-bindgen 0.2.118`, Rust 1.83+ (workspace MSRV) | `no_std`-clean, no `alloc` requirement for `Crc::checksum`. The `Digest` API does require `alloc`, which we have (we are `std`-targeting wasm). |
| `crc = "=3.4"` | `vte = "=0.15"` | Independent — no transitive overlap. |
| Web Serial default reader | Web Serial BYOB reader | Mutually exclusive on a given `port.readable` — pick one per port. We pick default. |
| `Blob.stream()` Chromium 76+ | Web Serial Chromium 89+ | Floor remains 89 (Web Serial). Stream is universally available beneath that floor. |
| `URL.createObjectURL` Chromium 8+ | All BestialiTTY targets | Universal. |
| `<a download>` attribute Chromium 14+ | All BestialiTTY targets | Universal. |
| HTML Drag and Drop | All BestialiTTY targets | Universal. `DataTransferItem.kind` is universal too. |
| `AbortController` Chromium 66+ | All BestialiTTY targets | Universal. |

---

## Sources

- **`crc` crate (mrhooray/crc-rs)** — https://github.com/mrhooray/crc-rs and https://docs.rs/crc/latest/crc/ — version 3.4.0, MIT/Apache-2.0, `Crc<u16, NoTable>` API confirmed, `CRC_16_IBM_3740` constant verified to match SLIDE parameters. **Confidence: HIGH** (official crate docs).
- **CRC-16/IBM-3740 catalogue entry** — https://reveng.sourceforge.io/crc-catalogue/16.htm — width 16, poly 0x1021, init 0xFFFF, refin/refout false, xorout 0, check 0x29B1. SLIDE's hand-roll matches byte-for-byte. **Confidence: HIGH** (Greg Cook's authoritative CRC catalogue).
- **MDN — `Blob.stream()`** — https://developer.mozilla.org/en-US/docs/Web/API/Blob/stream — confirms 64 KiB default chunk, ReadableStream contract, backpressure semantics. **Confidence: HIGH**.
- **MDN — `ReadableStream.getReader()`** — https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/getReader — confirms locking semantics; default-reader behaviour. **Confidence: HIGH**.
- **MDN — `ReadableStreamBYOBReader`** — https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBReader — confirms zero-copy semantics; we explicitly opt out for the reasons in §6. **Confidence: HIGH**.
- **MDN — HTML Drag and Drop API + File drag and drop** — https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API and https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop — confirms `dragover` + `drop` preventDefault requirement, `DataTransferItem.kind === "file"` filter pattern. **Confidence: HIGH**.
- **MDN — `Window.showSaveFilePicker()`** — https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker — confirms user-gesture requirement and `SecurityError` failure mode. **Confidence: HIGH**.
- **Chrome for Developers — File System Access API** — https://developer.chrome.com/docs/capabilities/web-apis/file-system-access — confirms Chromium 86+ floor, secure-context requirement, gesture rule, write buffering until `close()`. **Confidence: HIGH**.
- **Chrome for Developers — Persistent permissions for File System Access API** — https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api — Chromium 122+ persistent permissions; relevant only to a hypothetical v1.x directory-handle UX (out of v1.1 scope). **Confidence: HIGH**.
- **Chrome for Developers — Web Serial API** — https://developer.chrome.com/docs/capabilities/serial — confirms BYOB reader available in Chrome 106+ for Web Serial; chunk-boundary contract for default reader. **Confidence: HIGH**.
- **Chromium support page — multiple file downloads** — https://support.google.com/chrome/a/answer/7579271 and developer commentary on `support.google.com/chrome/thread/252586523` — confirms staggering pattern needed; default site-setting prompts after multiple successive downloads. **Confidence: MEDIUM** (support docs, not formal spec; behaviour is observed-stable but not guaranteed across versions).
- **wasm-bindgen guide — passing byte arrays** — https://rustwasm.github.io/docs/wasm-bindgen/print.html and GitHub issue threads (#1643, #1619, #1160) — confirms `Uint8Array` → `&[u8]` copy-on-pass; view-over-`memory.buffer` pattern; view invalidation on memory growth. **Confidence: HIGH** (combined official guide + maintainer-confirmed issues).
- **WICG/serial #127** — https://github.com/WICG/serial/issues/127 — confirms `port.readable` is `type: "bytes"` stream supporting BYOB; default reader still works. **Confidence: HIGH**.
- **Existing v1.0 codebase** — `crates/bestialitty-core/src/lib.rs` (`wasm_boundary` mod shape), `www/transport/serial.js` (`runReadLoop`), `www/renderer/canvas.js` (zero-copy `gridView` pattern). **Confidence: HIGH** (read directly).
- **Existing SLIDE reference impls** — `/home/ant/src/microbeast/SLIDE/slide-rs/src/protocol.rs` (CRC algorithm, frame format), `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` (bidirectional + multi-file flow, FIN handshake). **Confidence: HIGH** (read directly).

---
*Stack research for: v1.1 FileTransfer (SLIDE protocol additions to BestialiTTY)*
*Researched: 2026-04-25*
