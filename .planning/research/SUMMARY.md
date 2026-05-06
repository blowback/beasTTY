# Research Summary — v1.1 FileTransfer (SLIDE Protocol)

**Synthesized:** 2026-05-06
**Milestone:** BestialiTTY v1.1 FileTransfer
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Confidence:** HIGH overall — every integration point grounded in existing code; protocol implementations read directly.

---

## Executive Summary

v1.1 adds browser-side SLIDE protocol to an already-shipped v1.0 VT52 terminal emulator. The work is additive and integration-seam-targeted: the Rust core gains one new sibling module (`slide/`) with a distinct `Slide` struct that mirrors the `Terminal` pattern exactly; the JS shell gains three new modules (`transport/slide.js`, `input/file-source.js`, `renderer/slide-chip.js`) and four surgical edits to existing files. The most load-bearing architectural decision — Rust core is a pure-logic byte-fed state machine and JS shell owns all I/O, timers, and browser state — is unchanged and fully validated from v1.0. Zero new JS dependencies. One new Rust dependency (`crc = "=3.4"`).

The five BLOCKING pitfalls (chunk-boundary framing, wakeup detection, CRC variant, backpressure, cancellation race) are all solvable with patterns already in the codebase: v1.0 parser's torn-chunk handling is the direct template for the SLIDE framer; paste-pump's `writer.ready` discipline is the template for the SLIDE TX loop; Phase 5 port-lost handler is the template for SLIDE teardown.

The single genuine external dependency is a Z80-side change to `slide.asm`: emitting `ESC ^` (`0x1B 0x5E`) as a wakeup before the existing RDY handshake. This lives in a separate upstream repo (`github.com/blowback/slide`) and is tracked as a linked PR. Host-initiated send (PC → Z80) works with stock unmodified SLIDE.COM and does not depend on the Z80 PR.

---

## 1. Stack Additions

**One new Rust dependency:**

| Dep | Version | Purpose |
|-----|---------|---------|
| `crc` (mrhooray/crc-rs) | `=3.4` (pinned) | CRC-16-CCITT (poly 0x1021, init 0xFFFF) = predefined `CRC_16_IBM_3740` constant; `NoTable` impl avoids lookup-table wasm bytes; `Digest` API supports incremental CRC across header + payload slices. |

**No new JS dependencies.** All browser APIs used (`HTML Drag and Drop`, `Blob.stream()`, `URL.createObjectURL`, `AbortController`) are universally available at the Chromium 89+ floor already set by Web Serial.

**Critical version constraint:** Do NOT use the BYOB reader (`getReader({ mode: 'byob' })`); requires Chromium 106+ for Web Serial and adds zero benefit at 19200 baud.

See STACK.md §Recommended Stack — Additions for full rationale.

---

## 2. Feature Table-Stakes (Must Ship for v1.1)

All 26 table-stakes features (TS-1..TS-26) from FEATURES.md constitute the MVP. Grouped by domain:

**SEND (host → Z80):**
- TS-1: `<input type="file" multiple>` picker (also accepts drag-drop)
- TS-2: Auto-type configured `B:SLIDE R<CR>` after file selection (configurable; off = skip)
- TS-3: Per-file progress: percent + byte count + frame N/M in chip
- TS-4: "File N of M: NAME.EXT" header line in chip

**RECV (Z80 → PC):**
- TS-5: Detect `ESC ^` wakeup → suspend terminal parser → hand wire to SLIDE state machine
- TS-6: Per-file Chrome download as each file completes (anchor-click pattern; 250 ms inter-file gap)
- TS-7: Progress for in-flight file: filename + bytes received / total

**PROG (progress display):**
- TS-8: Floating chip at `bottom: 8px; left: 8px` (scrollback chip stays `right: 8px`) — reuses Phase 6 chip pattern
- TS-9: Throughput display (2 s sliding window, show `—` first 2 s)
- TS-10: `[data-slide-active]` border tint on `#terminal-wrapper` + top-bar pill "Connected · SLIDE"

**CANCEL:**
- TS-11: Cancel button on chip → `CTRL_CAN` (0x18) → drain → restore parser
- TS-12: Esc key while chip visible = same as Cancel (extends Phase 5 D-18 Esc-intercept)
- TS-13: Post-cancel chip: "Cancelled — N of M files transferred" for 5 s then auto-hide
- TS-14: Hard-fail recovery: CRC retries exhausted / port lost → drain + restore + chip error + "Retry" hint

**DROP (drag-and-drop):**
- TS-15: Full-canvas drop zone on `#terminal-wrapper`; coexists with Phase 6 D-16 pointer-select
- TS-16: Dashed-border overlay during drag-over with faint tint + "Drop file(s) to send via SLIDE"
- TS-17: Drop-confirmation flash (~300 ms CSS pulse) before chip appears
- TS-18: Reject non-file drags (`dataTransfer.types.includes('Files')` filter at `dragenter`)
- TS-19: Reject drops during active SLIDE session with "Transfer in progress — cancel first"

**SETTINGS:**
- TS-20: Auto-send command text input; default `B:SLIDE R`; empty string = off; persisted to `prefs.slideAutoSendCommand`
- TS-21: "Show transfer chip after session" checkbox (default on); `prefs.slideShowSummary`

**EDGE:**
- TS-22: Zero-byte file (header → immediate EOF; no data frames)
- TS-23: Sub-frame file (< 1024 bytes; exactly one data frame + EOF)
- TS-24: Binary content (`.COM`, `.HEX`) — `Uint8Array` throughout; zero text-encoding
- TS-25: Filename auto-uppercase + 8.3 truncate in JS before wasm; show rewrite in chip
- TS-26: CP/M filename validation (reject `<>.,;:=?*[]`)

**P2 differentiators (ship if implementation goes smoothly):** DI-1 ETA, DI-2 NAK counter, DI-7 pre-send confirm chip, DI-13 open-downloads link, DI-14 backgrounded-tab redraw skip, DI-15 auto-send command preset dropdown.

**Defer to v1.2+:** DI-3/DI-4/DI-5 batch list, DI-9 frame trace, DI-10 timeout slider, DI-11 collision warning, DI-12 per-file failure isolation.

See FEATURES.md §Table Stakes and §Differentiators for full prioritization matrix.

---

## 3. Architecture Decisions

**Locked (from PROJECT.md §Current Milestone, not re-debatable):**
- Rust core owns: SLIDE state machine, framer, CRC-16-CCITT, sliding-window send/recv, RDY/ACK/NAK/CAN/FIN handshakes
- JS shell owns: Web Serial bytes in/out, File API + drag-drop, browser downloads, chip UI, auto-send command emitter
- Terminal parser fully suspended during SLIDE session — SLIDE owns wire from `ESC ^` to FIN-FIN

**Integration seams — concrete file edits:**

| File | Change | Scope |
|------|--------|-------|
| `crates/bestialitty-core/src/lib.rs` | Add `pub mod slide;`; add `Slide` wasm-bindgen struct + 11 exports | +80 lines |
| `crates/bestialitty-core/src/slide/` | New module: `crc.rs`, `framer.rs`, `state.rs`, `mod.rs`, `tests.rs` | ~590 lines new |
| `www/transport/serial.js:453` | `term.feed(value)` → `dispatchInbound(value)` | 1 line |
| `www/input/tx-sink.js` | + `owner` state + `setWireOwner` + `writeSlideFrame`; `pushTxBytes` early-returns when `owner === 'slide'` | +15 lines |
| `www/input/keyboard.js` | + Esc → SLIDE cancel disambiguation (slot 2 of 4) | +8 lines |
| `www/state/prefs.js` | + `slideAutoSendCommand` and `slideAutoSendEnabled` to DEFAULTS | +2 lines |
| `www/main.js` | Boot wiring for new modules | +30 lines |
| `www/index.html` | SLIDE chip element + drop overlay + Settings rows | +60 lines |

**New files (JS):** `www/transport/slide.js` (~250 lines), `www/input/file-source.js` (~80 lines), `www/renderer/slide-chip.js` (~50 lines), `docs/SLIDE_Z80_REQUIREMENT.md` (~30 lines).

**Key integration patterns:**

- `ESC ^` detection is a pre-parser sniff in JS (`dispatchInbound` in `transport/slide.js`), NOT routed through Rust first. The VT52 parser already accumulates partial escapes — letting Rust see `ESC ^` first has no clean rewind path. A 5-line JS byte scan avoids the problem entirely. `lastByteWasEscPending` module-scope flag handles split-chunk case.
- TX writer shared via `tx-sink.js` "wire owner" handoff (`setWireOwner('slide')` at session start). SLIDE writes via new `writeSlideFrame(bytes)` export that bypasses the TX ring.
- `Slide` struct is a sibling to `Terminal`, not nested. Keeps invariants independent and both testable in native `cargo test`.
- All timers (cancel timeout, abort timeout) live in JS. Rust core is purely event-driven — no `std::time::Instant`.
- wasm-bindgen TX egress pattern: `tx_ptr() / tx_len() / clear_outbound()` accessors over `wasm.memory.buffer` view. JS must call `view.slice()` before `await writer.write()` — `await` may straddle wasm memory growth.
- Z80 source (`slide.asm`) lives in separate repo; tracked as linked PR + `docs/SLIDE_Z80_REQUIREMENT.md`. Do not submodule or vendor.

**Build dependency graph (strictly ordered):**

```
1. Rust slide module (crc → framer → state → mod → tests green)
2. wasm-bindgen exports in lib.rs
3. scripts/build.sh → www/pkg/ regenerated
4. transport/slide.js + tx-sink.js
5. serial.js single-line edit
6. file-source.js + slide-chip.js
7. prefs.js + Settings UI
8. main.js wiring
9. Playwright end-to-end tests
10. Z80 PR merged + real-hardware UAT
```

See ARCHITECTURE.md §9 Build Orchestration and §2–§8 for per-seam detail with line-number references.

---

## 4. Watch Out For — BLOCKING and HIGH Pitfalls

### 5 BLOCKING (will lose data, hang wire, or corrupt files)

**P1 — Chunk-boundary framing (PITFALLS §1):** Web Serial chunks (1–4096 bytes) never align to 1031-byte SLIDE frames. Framer MUST be a byte-fed state machine in Rust with explicit states for each field. Test with torn-chunk corpus.

**P2 — `ESC ^` wakeup detection across chunks (PITFALLS §2):** Two-byte wakeup can straddle chunk boundaries; `ESC ^` is also a valid VT52 graphics-mode escape. JS dispatcher must carry `lastByteWasEscPending` flag. Consider extending wakeup signature (`ESC ^ S L I D E`, 7 bytes) — see Open Question OQ-2.

**P3 — CRC variant (PITFALLS §3):** "CRC-16-CCITT" is a family. SLIDE uses CCITT-FALSE: poly 0x1021, init 0xFFFF, no refin/refout, xorout 0, big-endian on wire. Pin test: `crc16_ccitt(b"123456789") == 0x29B1`.

**P4 — Backpressure / `writer.write()` discipline (PITFALLS §4):** Pattern is `await writer.ready; writer.write(bytes)` — NOT `await writer.write(bytes)`. Sliding window WIN_SIZE=4 means 4 frames can queue simultaneously; naïve parallel fire makes NAK retransmit incoherent.

**P5 — Cancellation race (PITFALLS §5):** Frame may be mid-write when user clicks Cancel. Do NOT call `reader.cancel()` or `port.close()`. Cancellation order: set flag → settle in-flight writes (Promise.allSettled, 200 ms) → send CTRL_CAN → wait up to 500 ms for Z80 CAN echo → drain 100 ms → re-arm framer.

### 6 HIGH (will confuse users or silently lose files)

**P6 — Tab close mid-transfer (PITFALLS §6):** `beforeunload` fires unreliably. Add `visibilitychange` listener.

**P7 — Filename collision after 8.3 truncation (PITFALLS §7):** `report.txt` + `Report.txt` + `REPORT.TXT` all become `REPORT.TXT`. JS pre-flight check + collision-resolution prompt required.

**P8 — Drag-drop vs canvas pointer-select collision (PITFALLS §8):** Mitigate: attach drag handlers to `#terminal-wrapper` (not `<canvas>`); in `selection.js:onPointerDown`, early-return if drop overlay is active.

**P9 — Re-entrant `ESC ^` mid-session (PITFALLS §9):** Z80 reboots or buggy program emits `ESC ^` while transfer is in progress. Framer must handle idempotently.

**P10 — Chrome multi-file download throttling (PITFALLS §10):** Chrome prompts "Allow multiple downloads?" on second download in short window. PITFALLS recommends `showDirectoryPicker()` (one-time gesture). Conflicts with STACK.md anchor-click recommendation — see OQ-3.

**P11 — Auto-type echo confusion (PITFALLS §11):** Auto-typed `B:SLIDE R\r` echoed back by CP/M; echo lands in SLIDE receive window if `ESC ^` arrives same chunk. Auto-type must set swallow-echo flag for ~500 ms.

See PITFALLS.md §Medium-Severity for P12 (memory growth — use `chunks: Uint8Array[]`), P13 (test mock divergence), P14 (chip z-index), P15 (Z80 version skew).

---

## 5. Suggested Phase Boundaries

PITFALLS and ARCHITECTURE researchers independently converge on 6 phases:

| Suggested Phase | Primary Deliverable | Pitfalls Addressed |
|----------------|--------------------|--------------------|
| **Ph A — Rust framer + CRC** | `slide/` module: CRC, framer (byte-fed SM), event drain API. Native `cargo test` corpus including torn-chunk corpus. | P1, P3, P13 |
| **Ph B — Wasm boundary + JS dispatch** | `lib.rs` Slide exports + wasm-pack rebuild. `transport/slide.js` + `serial.js:453` single-line edit. `ESC ^` pre-parser sniff with split-chunk flag. | P2, P11 |
| **Ph C — Sender-side wire driver** | Host-initiated send end-to-end: file picker → auto-type → SLIDE framing → `writeSlideFrame` loop. `file-source.js` drag-drop. TX writer discipline. | P4, P8 |
| **Ph D — Receiver-side state machine + cancellation** | Z80-initiated receive end-to-end: `ESC ^` → framer → file reassembly → Chrome download. Cancel path: CTRL_CAN, abort timeout, wire drain, re-arm. | P5, P9, P12 |
| **Ph E — JS bridge / integration** | `slide-chip.js`, prefs integration, session-log pause, paste-pump gate, port-lost handler, auto-type swallow-echo, Z80 version-skew fallback chip. | P6, P11, P15, P16, P18 |
| **Ph F — UX polish + end-to-end UAT** | Filename collision UX, drop overlay isolation fix, download throttle resolution, chip stacking, auto-send command validation, Playwright E2E, real-hardware UAT with patched slide.asm. | P7, P8, P10, P14, P17 |

**Gate conditions between phases:**
- Ph A: CRC test vector `== 0x29B1` green; torn-chunk corpus green; byte-for-byte equality with slide-rs frame fixtures.
- Ph B: wakeup detected across chunk boundaries; spurious `ESC ^` in terminal mode doesn't trigger SLIDE.
- Ph C: `writer.ready` discipline in place; cancellation mid-frame leaves wire neutral.
- Ph D: 1 MB receive memory-bounded; double-wakeup handled idempotently.
- Ph E: beforeunload + visibilitychange cleanup; session log paused during SLIDE; paste-pump gated.
- Ph F: real-hardware UAT with actual MicroBeast + patched slide.asm; Z80 PR merged.

---

## 6. Open Questions

These are not research gaps — they are decisions requiring coordination or user testing.

**OQ-1 — CAN frame ACK behavior in SLIDE v0.2 (blocks Ph D):**
SLIDE v0.2 spec covers FIN, ACK, NAK, RDY but not explicitly CTRL_CAN (0x18) from PC → Z80. `slide-rs` and `slide-py` are never CAN senders, only receivers. Planner must confirm with upstream what the Z80 response to PC-sent CAN is, or define behavior as part of the Z80 PR.

**OQ-2 — Wakeup signature length (blocks Ph B):**
PITFALLS §2 recommends extending `ESC ^` (2 bytes) to `ESC ^ S L I D E` (7 bytes) to reduce false-positive collisions. ARCHITECTURE assumes 2-byte. Must be confirmed with Z80 PR author before implementing JS sniff logic.

**OQ-3 — Multi-file download throttle resolution (blocks Ph F):**
STACK recommends anchor-click per file with 250 ms gap; PITFALLS §10 recommends `showDirectoryPicker()`. Locked PROJECT.md says "one Chrome download per file" — written before pitfall fully enumerated. Choose: (a) anchor-click + document "Allow multiple downloads" site setting, (b) switch to `showDirectoryPicker`, or (c) offer `showDirectoryPicker` as opt-in fallback.

**OQ-4 — Z80 PR coordination (blocks Ph F gate):**
Real-hardware UAT requires patched `slide.asm`. PR to `github.com/blowback/slide` is a dependency. Track in `docs/SLIDE_Z80_REQUIREMENT.md`. Host-initiated send can be tested without Z80 PR; Z80-initiated receive cannot.

**OQ-5 — Wakeup tail timing after auto-type (PITFALLS §11):**
After auto-typing `B:SLIDE R\r`, how long does CP/M take to load `slide.com` and emit `ESC ^`? Hardware-dependent. Researcher suggests 3 s timeout — verify on real hardware. Flag for human UAT.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Single new dep; all browser APIs MDN-confirmed |
| Features | HIGH | Locked milestone scope; reference impls read directly |
| Architecture | HIGH | Every seam grounded in existing code with line numbers |
| Pitfalls | HIGH (BLOCKING/HIGH), MEDIUM (cancel protocol, download throttle) | CAN behavior and download threshold empirically observed but not formally specified |
| Z80 coordination | MEDIUM | Depends on upstream PR author cooperation |

**Gaps for planning attention:**
- OQ-1 (CAN behavior) before Ph D cancellation work
- OQ-2 (wakeup signature) before Ph B begins
- OQ-3 (download throttle strategy) before Ph F begins

---

## Sources

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec
- `/home/ant/src/microbeast/SLIDE/slide-rs/src/{protocol,send,recv}.rs` — Rust reference impl
- `/home/ant/src/microbeast/SLIDE/slide-py/slide/{send,recv,common}.py` — Python reference impl
- `crates/bestialitty-core/src/lib.rs` (existing wasm boundary, lines 33–190)
- `www/transport/serial.js` (read loop line 453, teardown 498–525, port-lost 661–668)
- `www/input/tx-sink.js` (writer sharing 27–51)
- `www/input/paste-pump.js` (cancellation 57–82)
- `www/renderer/scroll-state.js` (chip lifecycle 194–207)
- `www/state/prefs.js` (DEFAULTS 18–29, defensive merge 55)
- `www/input/selection.js` (pointer-event ownership)
- `.planning/PROJECT.md` §Current Milestone (locked scope)
- `crc` crate docs (docs.rs/crc) + Greg Cook CRC catalogue (reveng.sourceforge.io)
- MDN: Blob.stream(), HTML Drag and Drop API
- zmodemjs (FGasper/zmodemjs) — `save_to_disk` per-file pattern
- trzsz documentation — drag-drop, progress UX
- Filestack 2025 / LogRocket / Smashing Magazine — drop-zone UX consensus
