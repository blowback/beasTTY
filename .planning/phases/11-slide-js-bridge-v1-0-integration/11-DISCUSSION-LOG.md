# Phase 11: SLIDE JS Bridge & v1.0 Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or
> execution agents. Decisions are captured in `11-CONTEXT.md` — this log
> preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 11-slide-js-bridge-v1-0-integration
**Areas discussed:** Chip content & throughput format, Settings SLIDE-block layout & defaults

---

## Gray Area Selection

| Area Presented | Selected |
|----------------|----------|
| Chip content & throughput format | ✓ |
| Z80-didn't-respond + Compatibility mode | ✗ (Claude's Discretion) |
| Session-log pause + paste-pump gating | ✗ (Claude's Discretion) |
| Settings SLIDE-block layout & defaults | ✓ |

**Note:** Two unselected areas were resolved as Claude's Discretion using the
research-locked PITFALLS prescriptions and prior-phase patterns. They surface
in CONTEXT.md as locked decisions (D-11/D-12 session-log + paste-pump,
D-13/D-14 visibilitychange + port-lost, D-15/D-16 timeout chip + Compatibility
mode behavior). See CONTEXT.md `<canonical_refs>` for the source authorities.

---

## Chip content & throughput format

### Q1: How should the chip layout look during an active transfer?

| Option | Description | Selected |
|--------|-------------|----------|
| Single line, dense | Compact one-line: `↑ MY-DOC.TXT  2/3  47%  482 KB  12.3 KB/s  [Cancel]` | ✓ |
| Two lines: header + meta | Line 1: header. Line 2: progress + cancel. Easier to read filename without truncation. | |
| Three lines: header + bar + meta | Adds a CSS progress bar between header and meta. | |

**User's choice:** Single line, dense (Recommended)
**Notes:** Mirrors Phase 6 scrollback chip's terseness; minimal vertical real estate.

### Q2: Throughput display format?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-scaled units | `847 B/s` / `12.3 KB/s` / `1.4 MB/s`; first 2 s `—`. | ✓ |
| Always B/s with thousands separator | `12,345 B/s`; unit-stable, less readable for fast transfers. | |
| Fixed KB/s only | `12.3 KB/s` always; sub-1 KB shows `0.8 KB/s`. | |

**User's choice:** Auto-scaled units (Recommended)
**Notes:** Matches the way humans read Web Serial speeds.

### Q3: Filename treatment when long?

| Option | Description | Selected |
|--------|-------------|----------|
| Show full 8.3 verbatim | 8.3 CP/M filenames are guaranteed ≤ 12 chars; no truncation logic needed. | ✓ |
| Truncate with ellipsis if > 10 chars | Adds CSS work + truncation function for a case that won't happen. | |
| Wrap to 2 lines if needed | Variable height; complicates lifecycle. | |

**User's choice:** Show full 8.3 verbatim (Recommended)
**Notes:** Mirrors Phase 10 CONTEXT D-07 verbatim policy.

### Q4: Cancel control on the chip?

| Option | Description | Selected |
|--------|-------------|----------|
| `[Cancel]` text button | Plain text button matching Phase 6 scrollback chip style; no icons elsewhere in chrome. | ✓ |
| `✕` close icon | More compact; introduces a new visual idiom mid-project. | |
| `[Cancel] (Esc)` with shortcut hint | Surfaces the keyboard shortcut; one extra rendered token. | |

**User's choice:** `[Cancel]` text button (Recommended)
**Notes:** Esc-key parity preserved (Phase 10 D-* slot 2).

### Continuation prompt

| Option | Selected |
|--------|----------|
| More chip questions (post-cancel summary, error chip lifecycle, awaiting-wakeup state copy) | |
| Move to Settings | ✓ |

**User's choice:** Move to Settings (chip extra states resolved as Claude's Discretion)

---

## Settings SLIDE-block layout & defaults

### Q1: How to group SLIDE controls in the Settings pane?

| Option | Description | Selected |
|--------|-------------|----------|
| Nested `<details class="reserved">` SLIDE block | Wrap all 4 SLIDE rows in `<details>` summary "SLIDE file transfer". Mirrors `details.reserved` pattern. | ✓ |
| Flat rows with `<legend>SLIDE</legend>` | `<fieldset><legend>SLIDE</legend>` group; always visible. | |
| Flat rows, no grouping | Append rows under existing settings; rely on labels for grouping. | |

**User's choice:** Nested `<details class="reserved">` SLIDE block (Recommended)
**Notes:** Keeps Settings pane scannable; collapses out of the way until needed.

### Q2: Default for the auto-send command text input?

| Option | Description | Selected |
|--------|-------------|----------|
| `B:SLIDE R\r` visible default | Pre-fill with literal `B:SLIDE R` + `\r appended automatically` hint. | ✓ |
| Empty placeholder, default applies invisibly | Placeholder `e.g. B:SLIDE R`; if empty, code uses hardcoded default. | |
| Read-only display + `Edit` button | Static text; click to edit. | |

**User's choice:** `B:SLIDE R\r` visible default (Recommended)
**Notes:** Discoverable; matches SLIDE-13/SLIDE-37 acceptance verbatim.

### Q3: Compatibility mode selector shape?

| Option | Description | Selected |
|--------|-------------|----------|
| 3-way `<select>`: Auto / Wakeup-required / Force-start | Verbatim PITFALLS §15 prescription. | ✓ |
| Single checkbox: "Wait for ESC^ wakeup" | Collapses Auto + Wakeup-required; loses middle ground. | |
| No selector — chip's `[Force start]` is only escape | Simplest UI; worst legacy-user UX. | |

**User's choice:** 3-way `<select>` (Recommended)
**Notes:** Default `Auto`. `Wakeup-required` = no timeout chip ever. `Force-start` = skip wakeup wait.

### Q4: Show transfer summary chip checkbox?

| Option | Description | Selected |
|--------|-------------|----------|
| Default ON | After session, show 5-second summary; opt-out via checkbox. | ✓ |
| Default OFF | Quieter daily-driver UX; loses success confirmation. | |
| No checkbox — always show summary | Hardcode; simplest. | |

**User's choice:** Default ON (Recommended)
**Notes:** Matches SUMMARY TS-21 default. SLIDE-28 post-cancel summary is non-optional regardless.

### Continuation prompt

| Option | Selected |
|--------|----------|
| Move to context | ✓ |
| More Settings questions (row order, label copy, validation surfacing, default-reset affordance) | |

**User's choice:** Move to context (additional Settings details locked as Claude's Discretion in CONTEXT.md)

---

## Claude's Discretion (areas not selected for discussion)

The following areas were locked using research-prescribed defaults and
prior-phase patterns rather than user discussion. Each is captured as a
locked decision in CONTEXT.md.

- **Z80-didn't-respond timeout: 3 seconds** (ROADMAP) — SLIDE-35 chip with
  `[Retry] [Cancel] [Force start]` buttons. Compatibility mode `Auto` arms
  the timer; `Wakeup-required` does not; `Force-start` skips the wait
  entirely.
- **Session-log pause: gate at the call site** (D-11) — wrap
  `sessionLog.append(value)` in `serial.js` read loop with
  `if (!isSlideActive())` predicate.
- **Paste-pump gate: cancelPaste() on session start** (D-12) — large paste
  in flight at SLIDE wakeup is interrupted via the existing Phase 5 D-18
  cancel chip.
- **visibilitychange CTRL_CAN: fire-and-forget single byte** (D-13) — extends
  the existing Phase 3 BEL-prefix listener in `chrome.js`; also registers
  `pagehide` for bfcache safety.
- **slidePumpOnPortLost: lives in `slide-recv.js`; symmetric to
  `pastePumpOnPortLost`** (D-14) — wired from `serial.js` teardown +
  handleReadError + onNavSerialDisconnect.
- **Auto-type swallow-echo filter: byte-for-byte match, ~500 ms** (C-03) —
  PITFALLS §11 prescription verbatim.

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. None proposed during
discussion that aren't already in the roadmap-deferred set.

