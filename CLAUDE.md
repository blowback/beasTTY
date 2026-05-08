# Beastty

An in-browser VT52 terminal emulator for the MicroBeast Z80 retrocomputer.
Static web app: Rust core compiled to wasm for parser / terminal state / key
encoding (pure logic), JavaScript shell for Web Serial I/O, canvas rendering,
event loop, and browser state. Chromium-only. Daily-driver targeted.

## Project Context

The canonical source of truth for this project lives in `.planning/`:

- `.planning/PROJECT.md` — project context, core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — v1 / v2 / out-of-scope requirements with REQ-IDs
- `.planning/ROADMAP.md` — 6-phase build order with per-phase success criteria
- `.planning/STATE.md` — current phase / plan status
- `.planning/config.json` — workflow settings (YOLO, standard granularity, parallel, quality model profile)
- `.planning/research/` — stack, features, architecture, and pitfalls research

**Read these before proposing changes.** They encode decisions already made.

## Architecture (Hard Constraints)

- **Rust → wasm core** owns the parser, terminal state, key encoding.
  Pure logic. Zero `web-sys` / `js-sys::Serial*` / DOM / I/O dependencies.
- **JavaScript shell** owns Web Serial I/O, canvas rendering, event loop,
  browser state. No business logic.
- **Rust↔JS interop** uses `wasm-bindgen` + `wasm-pack` (target `web`).
- **Web Serial is driven from JS, not Rust.** No Rust Web Serial bindings.
- **Chromium-only.** Non-Chromium browsers get a polite-fail message.
- **Static site deploy** only. No server runtime.
- **VT52 pragmatic subset** — only what the MicroBeast actually emits.
  Not strict DEC VT52. Not ANSI. Not H19.

## Workflow (GSD)

This project uses the Get Shit Done (GSD) workflow. Phases execute strictly
in order 1 → 2 → 3 → 4 → 5 → 6.

Per-phase loop:
1. `/gsd-discuss-phase N` — gather context and clarify approach
2. `/gsd-plan-phase N` — create detailed PLAN.md with verification loop
3. `/gsd-execute-phase N` — execute all plans with atomic commits
4. `/gsd-verify-phase N` — confirm phase success criteria are met

Progress and next actions: `/gsd-progress`.

## Key Decisions (as of 2026-04-21)

- Architecture split: Rust pure-logic core, JS shell owns browser (see PROJECT.md)
- Web Serial driven from JS (brittle Rust bindings avoided)
- `wasm-bindgen` + `wasm-pack` interop
- Chromium-only + polite fail on others
- Ship both CRT and clean modern themes in v1
- MIT / Apache-2.0 license plan
- Parser strategy (hand-rolled DFA vs Alacritty `vte` with `Perform`) —
  unresolved; resolved in Phase 1 via a short spike with ADR

## Phase 1 Dependencies to Surface Early

- Parser strategy ADR (hand-rolled vs `vte`)
- Live MicroBeast capture of actual VT52 sequences emitted
- CR/LF convention verification from real hardware
- BEL / graphics-mode / alt-keypad usage on real hardware
