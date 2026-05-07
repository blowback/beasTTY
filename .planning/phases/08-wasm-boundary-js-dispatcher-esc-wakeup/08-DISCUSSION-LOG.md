# Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 08-wasm-boundary-js-dispatcher-esc-wakeup
**Areas discussed:** Wakeup matcher state + collision behavior

---

## Gray-Area Selection

User selected 1 of 4 offered gray areas:

| Area | Selected |
|------|----------|
| Wakeup matcher state + collision behavior | ✓ |
| Slide wasm-bindgen export surface scope | (deferred to Claude's discretion at planning) |
| Slide instance lifecycle | (deferred to Claude's discretion at planning) |
| Test strategy for SC#1–#5 | (deferred to Claude's discretion at planning) |

Rationale for the offered set: ARCHITECTURE.md §1–§3 + Phase 7's
`tests/slide_boundary_shape.rs` already locked the bulk of Phase 8's
implementation; remaining choices are detail-level.

---

## Wakeup Matcher State + Collision Behavior

### Q1: Match-state shape

| Option | Description | Selected |
|--------|-------------|----------|
| Match-index counter (0–7) | Module-scope `wakeIdx` integer in www/transport/slide.js. On match: increment + swallow. On full match (idx==7): switch mode='recv'. State persists across chunks via module-scope. | ✓ |
| 7-byte sliding ring buffer | Module-scope `Uint8Array(7)` tracking last 7 bytes; `endsWith(WAKEUP)` per byte. | |
| Rust-side stateful helper | Add `slide::wakeup::Matcher::step(b)` to Phase 7 module; wasm-bindgen wraps it. | |

**User's choice:** Match-index counter
**Notes:** Matches the existing JS module-scope state idiom (paste-pump.js,
scroll-state.js); avoids expanding Phase 7's locked Rust API surface.

### Walk-through clarification (`ESC ^ S L O P`)

Before answering Q2, user asked: "if we take option 1, what happens if I
type ESC ^ SLOP? Will the held bytes (initial prefix match) get forwarded?"

Response traced through the matcher under Q1 + the recommended Q2:

```
byte 1: ESC    idx 0→1, SWALLOW (held: [ESC])
byte 2: ^      idx 1→2, SWALLOW (held: [ESC, ^])
byte 3: S      idx 2→3, SWALLOW (held: [ESC, ^, S])
byte 4: L      idx 3→4, SWALLOW (held: [ESC, ^, S, L])
byte 5: O      idx 4, expected I → MISMATCH
                ↓ REPLAY held bytes to term.feed in order
                ↓ reset idx=0
                ↓ re-process current byte O from idx=0:
                  O ≠ ESC → forward O to term.feed
byte 6: P      idx 0, P ≠ ESC → forward P to term.feed
```

Net: terminal parser sees `ESC ^ S L O P` in original order, exactly as
if SLIDE didn't exist.

User correction during walk-through: VT52 `ESC ^` is "enter auto-copy
mode" (thermal printer hardcopy on the original DEC VT52 / MicroBeast
peripheral); `ESC _` exits. MicroBeast has no thermal printer attached,
so toggling auto-copy in the parser is visually a no-op. The existing
parser silently swallows both via D-15. This correction is captured in
CONTEXT.md D-03.

User confirmed Q1 = "tracking index vs ring buffer" choice.

### Q2: Partial-match failure recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Replay swallowed prefix to term.feed in order | Hold consumed bytes (max 6) in backing buffer; on mismatch, flush to term.feed in original order, reset idx=0, re-process current failing byte from idx=0. Preserves baseline VT52 behavior. ~10 LOC. | ✓ |
| Discard swallowed prefix bytes | Drop ESC ^ S L I D silently; pass only the failing byte X (and following) to term.feed. Simpler. Slight behavior change vs baseline (auto-copy toggle becomes invisible to terminal). | |

**User's choice:** Replay swallowed prefix to term.feed in order
**Notes:** Preserves baseline behavior (benign Z80 ESC^ still reaches
the terminal parser as it would today); ~10 LOC overhead is trivial.

---

## Claude's Discretion (Deferred to Planning)

The following gray areas were offered but not selected; planner decides
at plan-phase time, with the defaults stated in CONTEXT.md `<decisions>`
"Claude's Discretion" subsection:

- Slide wasm-bindgen export surface (default: minimal recv-only Phase 8
  surface; Phase 9 amends with `enter_send_mode`)
- Slide instance lifecycle (default: per-session `new Slide()`; no Rust
  API expansion)
- Test strategy mix (default: cargo boundary-shape pin extending Phase 7's
  `slide_boundary_shape.rs` pattern + Playwright dispatcher harness using
  the Phase 5 `navigator.serial` mock)
- Boot wiring / dispatcher API shape (default: module-scope state with a
  `wireSlideDispatcher({...})` initializer following the codebase grain)
- `EVT_*` constant exposure (default: planner picks Rust-side
  `#[wasm_bindgen]` consts vs JS-mirrored consts based on drift risk)
- Wakeup-matcher backing-buffer location (default: module-scope
  `Uint8Array(6)` allocated once)
- Test corpus split-points for the 7-byte signature (default: every
  internal split point + benign partial-match cases including
  `ESC ^ ESC ^ S L I D E` re-process)

---

## Deferred Ideas

Mentioned during discussion as out of scope for Phase 8:

- Mid-session re-entrant `ESC ^ S L I D E` detection — Phase 10
  (SLIDE-34, "Z80 reset detected" warning chip)
- Floating SLIDE chip + Settings + session-log pause + paste-pump gate —
  Phase 11
- Filename collision UX, drag-drop pointer-select isolation — Phase 12
- Real-hardware UAT against patched MicroBeast — Phase 12
