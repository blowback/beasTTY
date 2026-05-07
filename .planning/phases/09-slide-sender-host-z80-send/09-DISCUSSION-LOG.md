# Phase 9: SLIDE Sender — Host → Z80 Send - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 09-slide-sender-host-z80-send
**Areas discussed:** Send entry points UX, Phase 9 progress feedback + sender SM scope

---

## Gray Area Selection

**Question:** Which gray areas should we discuss for Phase 9 (SLIDE Sender)?

| Option | Description | Selected |
|--------|-------------|----------|
| Send entry points UX | File picker placement, drag-drop overlay copy/visual. SLIDE-07/08/09. | ✓ |
| Filename rewrite & validation UX | How `my-doc.txt → MY-DOC.TXT` and CP/M-invalid char rejection are surfaced. SLIDE-15/16. | |
| Phase 9 progress feedback + sender SM scope | What the user sees during a send AND the Rust-vs-JS split for sender framing. SC#5. | ✓ |
| Phase 9/10/11/12 boundary scope | Auto-type pref vs Settings UI scope (SLIDE-13), out-of-Phase-9 edge cases. | |

**Notes:** Filename-rewrite UX and the boundary-scope question were folded into the discussion of the two selected areas — the locked answers in CONTEXT.md (D-05/D-06/D-07 for rewrite UX; D-14/D-15 for boundary scope) follow the prior-phase pattern of minimal Phase 9 + chatty UX deferred to Phases 10/11/12.

---

## Send entry points UX

### Q1: Where should the file picker live?

| Option | Description | Selected |
|--------|-------------|----------|
| Top-bar icon button (Recommended) | New button in #top-bar (next to Connect / Disconnect / Download log / Clear). Hidden `<input type="file" multiple>` triggered by click. | ✓ |
| Settings pane row | 'Send file...' row in Settings pane. | |
| Top-bar AND Settings pane | Both entry points; ~20 LOC extra. | |
| Drag-drop only — no picker | Defer SLIDE-07. Violates SC#1. | |

### Q2: What does the drag-over overlay look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Full canvas dashed border + faint tint + center text (Recommended) | Mirrors SLIDE-09 verbatim. Overlay div on `#terminal-wrapper`, `pointer-events: none`, dashed border in chrome accent, ~10% opacity tint, centred text. | ✓ |
| Subtle top-bar indicator only | Less invasive; keeps terminal output visible. | |
| Outline-only (no tint) | Cleaner aesthetic; minor discoverability cost. | |
| Solid-fill semi-transparent overlay | Highest visual weight; less daily-driver-friendly. | |

### Q3: How should non-file drags (text, URLs) be rejected?

| Option | Description | Selected |
|--------|-------------|----------|
| Block at dragenter, no overlay (Recommended) | Check `dataTransfer.types.includes('Files')`. If false, never set `data-drop-target`. Silent rejection; matches SLIDE-10. | ✓ |
| Brief 'Files only' chip flash | More discoverable but chatty. | |
| Allow drop, ignore content | Footgun. | |

### Q4: What top-bar glyph for the file-picker button?

| Option | Description | Selected |
|--------|-------------|----------|
| Unicode arrow ↑ 'Send file' (Recommended) | Plain Unicode arrow + label, matches existing top-bar text-button style. Zero asset overhead. | ✓ |
| Paperclip 📎 + 'Send file' | Emoji + label. CLAUDE.md prefers no emoji unless explicitly asked. | |
| Plain text 'Send file' — no glyph | Most consistent; less scannable. | |
| Custom SVG icon | Higher polish but adds maintenance. | |

### Q5: Should the file picker also accept a keyboard shortcut?

| Option | Description | Selected |
|--------|-------------|----------|
| No chord in Phase 9 (Recommended) | Top-bar click + drag-drop sufficient for v1.1. Avoids burning a keystroke. Phase 11/12 can add if needed. | ✓ |
| Ctrl+Alt+U (upload) | U for 'upload'. No Chromium reservation conflict. | |
| Ctrl+O (open file) | Conventional but Ctrl+O is browser-reserved. | |

---

## Phase 9 progress feedback + sender SM scope

### Q6: What progress feedback should Phase 9 ship with?

| Option | Description | Selected |
|--------|-------------|----------|
| Silent, Playwright introspection only (Recommended) | No visible UI. `window.__slide.{state, file_idx, bytes_done, total_bytes}` introspection hook (mirrors Phase 8 precedent). Top-bar button visibly disabled during a session. Phase 11 owns the chip. | ✓ |
| Top-bar text update | Reuse the existing top-bar paste-progress strip pattern. | |
| Browser title-bar suffix | Visible from background tabs, mirrors Phase 3 visible-bell title-flash precedent. | |
| Minimal Phase 11 chip pulled forward | Exceeds Phase 9 scope; risks blocking on Phase 10 cancel mechanics. | |

### Q7: Where does the sender state machine live — Rust or JS?

| Option | Description | Selected |
|--------|-------------|----------|
| Rust owns SM + frame builder; JS feeds payload chunks (Recommended) | Mirror of receiver. New `slide::Slide enter_send_mode(metadata: &[u8])` + `feed_send_chunk(payload, eof)`. NAK retransmit lives in Rust SM. ARCHITECTURE.md §1 contract. | ✓ |
| Rust owns frame builder only; JS drives the SM | Add `Slide::build_frame(seq, payload)` but JS owns sliding window. Drift risk vs Rust receiver SM. | |
| Rust owns full sender SM + frame builder + payload reader | Pass full file bytes via `enter_send_mode(metadata, payload)`. Linear-memory footprint balloons for 1MB+ files. | |

### Q8: How does the sender drive `await writer.ready` discipline (PITFALLS §4)?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend tx-sink with `writeSlideFrameAwaitable(bytes)` (Recommended) | Promise-returning sibling to existing `writeSlideFrame`. `await registeredWriter.ready; await registeredWriter.write(bytes)`. Preserves Phase 5 D-21 invariant. | ✓ |
| Expose `getWriter()` on tx-sink — slide.js owns the writer.ready loop | Breaks Phase 5 D-21 (writer is private to serial.js). | |
| Polling — setTimeout chain mirroring paste-pump | PITFALLS §4 explicitly bans this for SLIDE. | |

### Q9: How does the auto-typed `B:SLIDE R\r` flow integrate with the wakeup matcher?

| Option | Description | Selected |
|--------|-------------|----------|
| JS-side auto-type, Phase 8 wakeup catches Z80's response (Recommended) | `pushTxBytes('B:SLIDE R\r')` → wait for ESC^SLIDE wakeup → dispatcher switches to 'send' (NOT 'recv') because `pendingSendSession` flag is set. | ✓ |
| Skip wakeup detection entirely on send path | Auto-type → setTimeout(2s) → start blasting RDY. Races against slide.com readiness; PITFALLS §15 explicitly says wait for wakeup. | |
| User-set delay, no wakeup wait | Doesn't adapt to slow CP/M loads; requires user tuning. | |

### Q10: What event surface does the sender SM expose?

| Option | Description | Selected |
|--------|-------------|----------|
| Add EVT_FILE_COMPLETE + EVT_SESSION_COMPLETE; reuse EVT_NAK / EVT_ACK / EVT_CAN (Recommended) | Minimal extension of Phase 7 EVT_* namespace. Boundary-shape pin extended. | ✓ |
| Single EVT_PROGRESS with packed (file_idx, pct, bytes_in_window) | One event covers all per-frame progress, but JS still needs FILE_COMPLETE / SESSION_COMPLETE / ERROR distinctions. | |
| JS polls `state()` + `progress_packed()` accessors, no events | Misses high-frequency NAK retransmit signals. | |

### Q11: Filename rewrite (`my-doc.txt → MY-DOC.TXT`) surfacing?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline modal/confirm with rewrite list (Recommended) | Native `<dialog>` + tiny CSS. Lists each rewrite + rejected files. User clicks Send or Cancel. Mirrors SLIDE-15 acceptance. | ✓ |
| Auto-proceed; rewrite list in console only | Borderline against SLIDE-15 'surfaced to the user'. User surprised when REPORT.TXT lands instead of report.txt. | |
| Top-bar status text flash for ~3s | Less interrupting than a modal; doesn't handle invalid-char rejection (which must block). | |

---

## Claude's Discretion

The following intentionally remain unlocked at the planning/research stage (see CONTEXT.md `### Claude's Discretion`):

- `<dialog>` modal CSS treatment
- `pendingSendSession` queue depth
- `SlideState` variant rename (`HeaderPhase` → `SendingHeader`)
- Sender retry budget (match slide-rs no-bound vs impose `SEND_NAK_BUDGET = 15`)
- Native test corpus split (per-file `slide_send_*.rs` vs extending existing pin files)
- `#send-file-input` placement in DOM
- Mock peer for sender Playwright tests (extend Phase 5 mock vs Python subprocess)
- `packSendMetadata` location (file-source.js vs slide.js)
- Drag-drop overlay z-index
- Auto-typed-command echo doubling (ship Phase 9 with visible doubling vs pull Phase 11 SLIDE-14 swallow filter forward)

## Deferred Ideas

(See CONTEXT.md `<deferred>` section for the full list — items moved to Phases 10/11/12 per the prior-phase pattern of minimal Phase 9 + chatty UX deferred.)
