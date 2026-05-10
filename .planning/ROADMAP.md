# Roadmap: Beastty

## Overview

Beastty is built bottom-up in two milestones to date:

- **v1.0 MVP** (Phases 1–6) — Rust → wasm core (parser, terminal state, key
  encoding), wasm boundary, canvas renderer with CRT and clean themes,
  keyboard input, Web Serial transport, and daily-driver polish (copy/paste,
  scrollback, session logging, prefs, static deploy under MIT). Shipped
  2026-04-25.
- **v1.1 SLIDE FileTransfer** (Phases 7–12) — bidirectional file transfer
  over the Web Serial wire via the SLIDE protocol: pure-Rust state machine,
  JS dispatcher routing inbound bytes to terminal-parser-or-SLIDE, host →
  Z80 send via picker + drag-drop, Z80 → PC receive via Chrome downloads,
  floating chip + cancel + Compatibility-mode fallback for legacy slide.com.
  Shipped 2026-05-10.

## Milestones

- ✅ **v1.0 MVP** — Phases 1–6 (shipped 2026-04-25, retroactively recorded)
- ✅ **v1.1 SLIDE FileTransfer** — Phases 7–12 (shipped 2026-05-10)

Next milestone: TBD. Use `/gsd-new-milestone` to scope.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>✅ v1.0 MVP (Phases 1–6) — SHIPPED 2026-04-25</summary>

- [x] Phase 1: Rust Core — Parser, Grid, Key Encoder (7/7 plans) — completed 2026-04-21
- [x] Phase 2: Wasm Boundary & Minimal JS Harness (6/6 plans) — completed 2026-04-22
- [x] Phase 3: Canvas Renderer (7/7 plans) — completed 2026-04-22
- [x] Phase 4: Keyboard Input (4/4 plans) — completed 2026-04-22
- [x] Phase 5: Web Serial Transport (9/9 plans) — completed 2026-04-23
- [x] Phase 6: Daily-Driver Polish, Session & Deployment (8/8 plans) — completed 2026-04-25

A small post-Phase-6 polish stream landed without a separate phase
(font system with selectable bitmap fonts, ESC F/G graphics-mode wiring,
copy-paste UX fixes, disconnect race fix, cursor ghosting fix, optional
unfiltered serial picker, log-filename rotation, Ctrl+Shift+Esc
clear-selection chord). Tracked in commit history.

</details>

<details>
<summary>✅ v1.1 SLIDE FileTransfer (Phases 7–12) — SHIPPED 2026-05-10</summary>

- [x] Phase 7: SLIDE Rust Core — Framer, CRC, State Machine (5/5 plans) — completed 2026-05-06
- [x] Phase 8: Wasm Boundary, JS Dispatcher & ESC^ Wakeup (4/4 plans) — completed 2026-05-07
- [x] Phase 9: SLIDE Sender — Host → Z80 Send (4/4 plans) — completed 2026-05-08
- [x] Phase 10: SLIDE Receiver & Cancellation (5/5 plans) — completed 2026-05-08
- [x] Phase 11: SLIDE JS Bridge & v1.0 Integration (5/5 plans) — completed 2026-05-08
- [x] Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT (9/9 plans) — completed 2026-05-10

Full archive: [.planning/milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

## Progress

| Phase                                          | Milestone | Plans Complete | Status   | Completed  |
| ---------------------------------------------- | --------- | -------------- | -------- | ---------- |
| 1. Rust Core — Parser, Grid, Key Encoder       | v1.0      | 7/7            | Complete | 2026-04-21 |
| 2. Wasm Boundary & Minimal JS Harness          | v1.0      | 6/6            | Complete | 2026-04-22 |
| 3. Canvas Renderer                             | v1.0      | 7/7            | Complete | 2026-04-22 |
| 4. Keyboard Input                              | v1.0      | 4/4            | Complete | 2026-04-22 |
| 5. Web Serial Transport                        | v1.0      | 9/9            | Complete | 2026-04-23 |
| 6. Daily-Driver Polish, Session & Deployment   | v1.0      | 8/8            | Complete | 2026-04-25 |
| 7. SLIDE Rust Core — Framer, CRC, SM           | v1.1      | 5/5            | Complete | 2026-05-06 |
| 8. Wasm Boundary, JS Dispatcher & ESC^ Wakeup  | v1.1      | 4/4            | Complete | 2026-05-07 |
| 9. SLIDE Sender — Host → Z80 Send              | v1.1      | 4/4            | Complete | 2026-05-08 |
| 10. SLIDE Receiver & Cancellation              | v1.1      | 5/5            | Complete | 2026-05-08 |
| 11. SLIDE JS Bridge & v1.0 Integration         | v1.1      | 5/5            | Complete | 2026-05-08 |
| 12. SLIDE UX Polish, Docs & Real-Hardware UAT  | v1.1      | 9/9            | Complete | 2026-05-10 |

---
*Roadmap created: 2026-04-21*
*v1.0 shipped (informal): 2026-04-25 — 54 v1 requirements complete*
*v1.1 phases appended: 2026-05-06*
*v1.1 shipped: 2026-05-10 — 42 SLIDE requirements complete*
*Reorganised under milestone groupings on v1.1 close: 2026-05-10*
