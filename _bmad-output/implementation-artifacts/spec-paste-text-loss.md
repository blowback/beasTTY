---
title: 'Paste into the MicroBeast loses most of the text'
type: 'bugfix'
created: '2026-08-06'
status: 'in-progress'
baseline_commit: '182f3797bd22e59144bfed9582af190a708b915c'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pasting a multi-line block into the terminal loses nearly all of it, from two independent defects. (1) `applyCrlfRewrite` only ever inspects `0x0D`, so LF-only clipboard text — the normal case on Linux — reaches the wire as bare `0x0A` in every mode, and the far end never sees a line break. (2) The pump paces to ~1684 B/s at 19200 baud, which no Z80 editor can consume, and writes each 32-byte chunk at full wire speed into a 16-byte UART FIFO, so a chunk overruns whatever the average rate. Observed on hardware: with flow control `none`, 17 clean characters arrive (one FIFO) then garbage; with RTS/CTS, ~66 bytes arrive with every line break missing.

**Approach:** Two user settings — **Paste line ending** (normalise every break in the pasted text to CR / LF / CRLF, or pass through as-is) and **Paste speed** (bytes/sec). At a paced speed, chunks drop to 8 bytes so a burst cannot overrun the FIFO, split at line terminators, and the pause after a break is longer than after an ordinary chunk.

## Boundaries & Constraints

**Always:**
- Paste line ending is a **separate** setting from Settings ▸ "Enter key sends" (`crlfMode`); neither reads the other. Label both rows so it is obvious which governs which — they can hold different values, and that must read as deliberate.
- A paced chunk is **≤ 8 bytes**, under the 16-byte 16C550 FIFO with room to drain.
- A chunk never spans a line terminator: it ends at one, or contains none.
- Follow the established radio-submenu pattern end to end (markup → `onRadioSelect` → `savePrefs` → `projectMenuOnOpen` → `projectPrefs` → `applyPrefs`). Persist ≠ apply — the handler calls both.
- Append new prefs to `DEFAULTS` **without** bumping `CURRENT_VERSION` (defensive spread-merge, as every prior pref).
- Each new pref validates at its consumer, as `setCrlfMode` does — `prefs.js` has no field validation.
- SLIDE behaviour untouched; paste still silently no-ops during a transfer.

**Ask First:**
- Any change to `pushTxBytes`, `tx-sink.js` write semantics, or SLIDE transport. Backpressure is deliberately out of scope (see `deferred-work.md`); if the pacing fix seems to require it, HALT.
- Making `writeOneChunk` async. It stays synchronous in this spec.

**Never:**
- No echo-driven or adaptive pacing. Fixed rate only.
- Do not touch `crlfMode`, `keyboard.js:forwardBytes`, or the Enter-key path.
- No XON/XOFF — the MicroBeast does not speak it.
- No DOM `paste` handler; `Ctrl+Shift+V` stays the only entry point.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| LF clipboard, ending `cr` | `A\nB` | `41 0D 42` | N/A |
| CRLF clipboard, ending `cr` | `A\r\nB` | `41 0D 42` — one break, not two | N/A |
| CR clipboard, ending `crlf` | `A\rB` | `41 0D 0A 42` | N/A |
| Mixed clipboard, ending `lf` | `A\r\nB\nC\rD` | `41 0A 42 0A 43 0A 44` | N/A |
| Ending `raw` | `A\r\nB` | `41 0D 0A 42` — unchanged | N/A |
| Paced paste | 800 B at 240 B/s | chunks ≤ 8 B; longer pause after each terminator; ~4-6 s | N/A |
| Full speed | speed `0` | today's behaviour: 32 B at `computeGap(baud)` | N/A |
| Speed above the wire | 480 B/s at 2400 baud | clamped to the 8N1 byte rate | N/A |
| Cancel mid-paste | Esc while paced | pump stops; no `0x1B` emitted (unchanged) | N/A |
| Stored pref out of range | `pasteSpeed: 99999` | consumer rejects, falls back to default | no throw; matches `setCrlfMode` |
| Empty / no-break paste | `ABC` | unchanged bytes, paced normally | N/A |

</frozen-after-approval>

## Code Map

- `www/input/paste-pump.js` -- the bug's home. `applyCrlfRewrite` (159-186), `computeGap` (122-125), `CHUNK_SIZE` (29), `writeOneChunk` (127-157), `setBaudForPump` (107-118), `__getStateForTests` (196-198).
- `www/index.html` -- Settings dropdown `#dropdown-settings`. The "Enter key sends" radio submenu at 1968-1994 is the markup template; new rows go after 1994, before the separator at 1995.
- `www/renderer/menu-bar.js` -- `onRadioSelect` crlf branch (836-846) and the numeric `cmdhistory-size` branch (847-859, the shape for Paste speed); panel refs (~502/518); `projectMenuOnOpen` settings block (1191-1198); `projectPrefs` (1439-1453).
- `www/state/prefs.js` -- `DEFAULTS` (20+), `crlfMode` at 28; `savePrefs` 250 ms debounce (192-196).
- `www/main.js` -- `applyPrefs` (1797+, `setCrlfMode` at 1835); `wireMenuBar` opts (612-623); `confirmLargePaste` injection (1070-1076); `window.__pastePump` (1083-1090).
- `www/renderer/paste-toast.js` -- `confirmLargePaste` (140-155) estimates from baud alone; rendered string at 238-243. Both go stale once pacing no longer tracks baud.

## Tasks & Acceptance

**Execution:**
- [ ] `www/state/prefs.js` -- append `pasteLineEnding: 'cr'` and `pasteSpeed: 240` to `DEFAULTS` with inline comments; do not bump `CURRENT_VERSION`.
- [ ] `www/input/paste-pump.js` -- replace `applyCrlfRewrite` with a line-break normaliser: scan for `\r\n`, `\r`, `\n`, emit the configured terminator for each; `raw` returns input unchanged. Add `setPasteLineEnding` / `setPasteSpeed` with consumer-side validation.
- [ ] `www/input/paste-pump.js` -- re-chunk: 8-byte cap when paced, split at terminators, `lineGapMs` after a terminator-ending chunk, clamp the rate to the wire. Extend `__getStateForTests` with `lineEnding`, `speed`, `lineGapMs`. Keep `writeOneChunk` synchronous.
- [ ] `www/index.html` -- two radio submenus after line 1994: "Paste line ending" (`paste-eol`: CR / LF / CRLF / As-is) and "Paste speed" (`paste-speed`: Full speed / 480 / 240 / 120 / 60 B/s).
- [ ] `www/renderer/menu-bar.js` -- panel refs, injected setters, two `onRadioSelect` branches, plus entries in the settings re-projection and in `projectPrefs`.
- [ ] `www/main.js` -- inject both setters into `wireMenuBar`; call both from `applyPrefs`; confirm `wirePastePump` runs before `applyPrefs(prefs)`; expose the new getters on `window.__pastePump`.
- [ ] `www/renderer/paste-toast.js` + `www/main.js` -- estimate from the pump's effective rate rather than baud; render `About to paste N B (~S s at R B/s).`
- [ ] `www/tests/input/paste-line-ending.spec.js` -- new spec covering every line-ending row of the I/O matrix against `#tx-strip`.
- [ ] `www/tests/transport/paste.spec.js` -- add paced chunk size, per-line pause, and wire-clamp cases; re-verify the existing 19 ms/`gapMs` assumptions in the duration test (39-57) and the keystroke queue-jump test (106) against the new chunking.
- [ ] `www/tests/session/prefs.spec.js`, `www/tests/render/menu-bar-settings.spec.js`, `www/tests/render/menu-bar-settings-reset.spec.js`, `www/tests/render/paste-toast.spec.js` -- defaults, reload round-trip, menu persist/apply/focus-retention, reset re-projection, updated toast string.

**Acceptance Criteria:**
- Given default settings and an LF-only multi-line clipboard, when the user pastes, then every line break reaches the wire as `0x0D` and the rest of the byte stream is identical to the clipboard text.
- Given a paced speed, when a paste runs, then no single write exceeds 8 bytes and none spans a line terminator.
- Given "Enter key sends" and "Paste line ending" are set to different values, when the user presses Enter and then pastes a line break, then each emits its own configured bytes with no interference.
- Given either new setting is changed, when the page is reloaded, then the value persists and both the menu checkmark and the live behaviour reflect it.
- Given `pasteSpeed` is `0`, when a paste runs, then chunk size and timing are byte-for-byte what they are today.

## Spec Change Log

## Design Notes

`pasteSpeed` is bytes/sec, with `0` meaning "as fast as the wire allows" — today's behaviour, kept for targets that can take it. Paced gap is `max(4, round(chunk / min(speed, baud/10 * 0.90) * 1000))`. `lineGapMs` is `gapMs * 5`, floored at 50 ms, because a line break costs a full-screen editor a redraw where an ordinary character costs a buffer insert.

The 240 B/s default is an estimate, not a measurement. It must be confirmed on real hardware during manual verification and changed if VIBE still drops text.

Normalisation must consume `\r\n` as a single break. The naive per-byte substitution the current code applies to `\r` is exactly how `\r\n` becomes a doubled break.

## Verification

**Commands:**
- `cd www && npx playwright test tests/input/paste-line-ending.spec.js tests/transport/paste.spec.js` -- expected: all pass.
- `cd www && npx playwright test` -- expected: no new failures. A known pool of load-sensitive specs flakes (see `deferred-work.md`) — re-run any single failure in isolation before calling it a regression.

**Manual checks (real hardware — the only check that closes this bug):**
- At 19200 with flow control `none`, open VIBE on the MicroBeast, enter insert mode, paste the ~800 B Forth block from the bug report. Expect every line present, correctly broken, no garbage. If text is still lost, step `pasteSpeed` down (120, then 60) and record the first value that survives — that becomes the default.
- Repeat with RTS/CTS and confirm it is no worse.
