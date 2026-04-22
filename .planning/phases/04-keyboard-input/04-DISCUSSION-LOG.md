# Phase 4: Keyboard Input - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 04-keyboard-input
**Mode:** discuss-phase (`--chain`)
**Areas discussed:** (none selected — user replied "none"; all gray areas handled as Claude's discretion)

---

## Gray areas presented

Six gray areas were surfaced after codebase scout + prior-CONTEXT.md review.
User elected not to drive any of them ("none" reply to the multiSelect
prompt), so Claude resolved each with defaults anchored in prior-phase
decisions, capture evidence, and research pitfalls.

### 1. TX sink + debug view

| Option | Selected |
|--------|----------|
| Console only (`console.log` per key) | |
| Module-scoped ring buffer + hex strip in existing Phase 3 Debug `<details>` | ✓ (Claude's discretion) |
| Separate always-visible TX pane at bottom of canvas | |

**Resolution:** Extends Phase 3 D-15 (Debug pane retains SC-4 demo path).
Avoids new top-level chrome. See CONTEXT.md §D-07, §D-15.

### 2. CR/LF override semantics

| Option | Selected |
|--------|----------|
| TX-side only, 3-way (CR / LF / CRLF), default CR | ✓ (Claude's discretion) |
| TX-side only, 2-way (CR / CRLF) | |
| RX-side (parser change) | |
| Both TX and RX with separate toggles | |

**Resolution:** TX-side only preserves Phase 1 D-13 (JS-only for Phase 4).
Default CR matches every observed MicroBeast workload (captures 01 + 02).
3-way covers the "every line prints twice" (CRLF) and "lines stack on top
of each other" (LF) failure modes. See CONTEXT.md §D-10 — §D-12.

### 3. Toggle + note UI placement

| Option | Selected |
|--------|----------|
| Top bar alongside theme + phosphor | |
| Inside existing Debug `<details>` pane | |
| New Settings `<details>` pane between canvas and Debug | ✓ (Claude's discretion) |

**Resolution:** Phase 3 D-12 kept the top bar deliberately minimal;
Settings pane mirrors the Debug pane disclosure pattern users already know.
See CONTEXT.md §D-13, §D-14.

### 4. Focus-retention mechanism

| Option | Selected |
|--------|----------|
| `mousedown` preventDefault on toolbar buttons | ✓ (Claude's discretion) |
| Programmatic refocus in click handler | |
| `pointerdown` | |

**Resolution:** Only mousedown-preventDefault avoids a visible focus
flicker AND preserves keyboard activation (Tab + Space). Scope covers
theme button, phosphor buttons, new Settings toggles, and Reset TX
button. See CONTEXT.md §D-16.

### 5. Unhandled keys scope

| Option | Selected |
|--------|----------|
| Silent drop, no preventDefault (browser handles) | ✓ (Claude's discretion) |
| Silent drop with preventDefault | |
| Forward as empty bytes | |
| Extend Rust `KeyCode` enum (scope creep from Phase 1 D-13) | |

**Resolution:** Not in Phase 1 KeyCode enum; VT52 has no canonical
bytes; F5/F12/F11 daily-driver browser features remain usable. See
CONTEXT.md §D-17 and deferred ideas.

### 6. Keypad mode scope

| Option | Selected |
|--------|----------|
| Out of scope — plain ASCII digits (current encoder behaviour) | ✓ (Claude's discretion) |
| In scope — wire numpad + parser state for ESC = / ESC > | |
| Defer to v2 backlog with explicit note | |

**Resolution:** Phase 1 captures 01 + 02 show zero ESC = / ESC > usage.
MicroBeast does not need mode-aware keypad. Plain-ASCII output from the
current Phase 1 encoder suffices. See CONTEXT.md §D-18 and deferred ideas.

---

## Claude's Discretion

All six gray areas above (user replied "none" to the selection prompt).
Plus the standard Claude-discretion items inside individual decisions:
- Exact CSS of the new Settings pane
- Hex strip byte count (32 / 64 / 128)
- `wireKeyboard(opts)` vs multiple small exports
- `TextEncoder` vs strict ASCII guard for IME `compositionend`
- Playwright spec file layout under `www/tests/input/`
- Whether to add a `keyup` listener (not needed by any SC)

## Deferred Ideas

See CONTEXT.md §deferred. Surfaced during resolution:
- Mode-aware keypad (`ESC =` / `ESC >`)
- F1–F12, Home/End, PgUp/PgDn, Del/Ins
- Configurable keymap / MicroBeast-specific codes
- Send Break button
- Paste throttling / large-paste confirmation
- Local-echo / CR-LF persistence (Phase 6)
- Audible bell
- Clipboard integration (Phase 6)
- Extended Alt/Meta modifier semantics
- Keyboard-shortcut help overlay
