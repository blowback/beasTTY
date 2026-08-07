---
title: 'Paste into the MicroBeast loses most of the text'
type: 'bugfix'
created: '2026-08-06'
status: 'in-progress'
baseline_commit: '2e7bb59e7831dcdea158f352933a43d727f11c66'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pasting a multi-line block into the terminal loses nearly all of it, from two independent defects. (1) `applyCrlfRewrite` only ever inspects `0x0D`, so LF-only clipboard text — the normal case on Linux — reaches the wire as bare `0x0A` in every mode, and the far end never sees a line break. (2) The pump paces to ~1684 B/s at 19200 baud — roughly 300× what the MicroBeast can consume in a full-screen editor without flow control (measured at ~5–8 B/s, see the hardware finding below) — and offers no way to go slower. Observed on hardware: with flow control `none`, ~17 clean characters arrive then garbage; with RTS/CTS, ~66 bytes arrive with every line break missing, which was defect (1) rather than a flow-control failure.

**Approach:** Three user settings — **Paste line ending** (normalise every break in the pasted text to CR / LF / CRLF, or pass through as-is), and two controls describing the wire cadence directly: **Paste chunk size** (how many bytes land back-to-back) and **Paste pause** (how long the receiver gets to drain between them). Throughput is a consequence of the two, not a setting.

**Hardware finding (2026-08-07, measured on a real MicroBeast).** In VIBE with flow control `none`, the machine absorbs roughly **5–8 bytes per second**. Measured: chunk 1 / pause 200 ms (5 B/s) succeeds; chunk 1 / pause 100 ms and chunk 2 / pause 200 ms (both 10 B/s) both nearly succeed. Two different chunk sizes at the same throughput behave the same, so **throughput governs, not burst size**. With flow control the same paste is correct at full wire speed, confirming the firmware handshakes per byte.

This corrects an earlier claim in this spec that the loss happened *inside* an 8-byte chunk. It did not. 60, 120 and 240 B/s produced identical corruption because every one of them was 10–50× above a ~6 B/s ceiling, and everything that far over capacity looks equally destroyed. The chunk-size control was still necessary — the previous model could not express a rate that low — but it is not the mechanism.

**Consequence.** Pacing that works without flow control is glacial: ~800 B takes about 2 min 40 s at 5 B/s, against under a second with RTS/CTS. Pacing therefore applies **only** when the open port's flow control is `none`, which is the only case it exists for.

## Boundaries & Constraints

**Always:**
- Paste line ending is a **separate** setting from Settings ▸ "Enter key sends" (`crlfMode`); neither reads the other. Label both rows so it is obvious which governs which — they can hold different values, and that must read as deliberate.
- **Chunk size and pause are the two controls, and both are physical facts.** Chunk size is how many bytes go out back-to-back; pause is the idle time the receiver gets between chunks. Neither is derived from the other and neither is expressed as a rate.
- **Throughput is shown, never set.** Derive it from the two controls and display it in the menu and the confirm estimate, so the user reads a consequence rather than reasoning backwards from one.
- **Pacing applies only when the open port's flow control is `none`.** Hardware handshaking throttles per byte, which is strictly better than anything the pump can do, so with RTS/CTS the pump runs at wire speed regardless of the pause setting.
- **When pacing is inactive the UI must say so and say why.** A setting that is silently ignored is the defect this whole spec keeps re-learning; the throughput readout carries the reason.
- The pump learns flow control from the same place it learns any port fact — the single point where the open port's config is recorded. That hook must be **wired and tested**, not merely written.
- **No behaviour keys off the content of the bytes.** Chunks are a fixed size regardless of what they contain, and every pause is the same length. A line break is an ordinary byte.
- Every chunk is exactly the configured size except the last, which is the remainder.
- **Local echo must render a pasted multi-line block as separate lines.** The bytes on the wire and the bytes fed to the terminal for echo need not be identical.
- Follow the established radio-submenu pattern end to end (markup → `onRadioSelect` → `savePrefs` → `projectMenuOnOpen` → `projectPrefs` → `applyPrefs`). Persist ≠ apply — the handler calls both.
- Append new prefs to `DEFAULTS` **without** bumping `CURRENT_VERSION` (defensive spread-merge, as every prior pref).
- Each new pref validates at its consumer, as `setCrlfMode` does — `prefs.js` has no field validation, and a merged `null` overrides a default rather than falling back to it.
- SLIDE must never see paste bytes, and paste progress must never advance over bytes SLIDE caused to be dropped.

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
| Paced paste, no flow control | 800 B, chunk 1, pause 200 ms | 800 writes of 1 byte, 200 ms apart, ~2 min 40 s; no chunk larger than 1 whatever the bytes contain | N/A |
| Flow control `hardware` | any pause setting, port open with RTS/CTS | pump runs at wire speed — pause not applied; readout says "wire speed (flow control)" | N/A |
| Flow control changed | port reopened `hardware` → `none` | the next paste paces; the readout returns to the derived figure | N/A |
| No port open | never connected | pacing applies (flow control unknown is treated as `none`) | N/A |
| Chunk holding a line break | chunk 8, payload `AB\nCDEFGHIJ` | the break rides inside a chunk like any other byte — no early split, no longer pause | N/A |
| Derived throughput shown | chunk 8, pause 20 ms, flow control `none` | menu and estimate both read ~400 B/s; the user never types a rate | N/A |
| Large-paste estimate | 5000 B, chunk 8, pause 20 ms, no flow control | `ceil(5000/8) × 20 ms` ≈ 13 s, within ~15 % of actual | N/A |
| Local echo, multi-line | echo on, ending `cr`, `A\nB` | screen shows `A` and `B` on separate lines | N/A |
| No pause | pause `0` | today's behaviour: writes at wire speed, chunk size still honoured | N/A |
| Pause below timer resolution | pause 5 ms | honoured as given; no silent floor that makes a setting a lie | N/A |
| Settings changed mid-paste | chunk or pause changed during a paced paste | the in-flight paste keeps its enqueue-time values; a paste appended to a live run adopts the slower of the two | N/A |
| SLIDE starts mid-paste | transfer begins while a paced paste runs | pump stops; progress does not advance over dropped bytes | N/A |
| Cancel mid-paste | Esc while paced | pump stops; no `0x1B` emitted (unchanged) | N/A |
| Out-of-range stored pref | `pasteChunk: 99999` / `pastePauseMs: -1` | rejected, default stands | no throw |
| Non-numeric stored pref | either pref as `null` / `""` / `false` / `[]` | rejected, default stands, menu shows the default | no throw; must not coerce to `0` |
| Empty / no-break paste | `ABC` | unchanged bytes, paced normally | N/A |

</frozen-after-approval>

## Code Map

- `www/input/paste-pump.js` -- the bug's home. `applyCrlfRewrite` (159-186), `computeGap` (122-125), `CHUNK_SIZE` (29), `writeOneChunk` (127-157) — note its local-echo `termRef.feed(chunk)` branch, which must not be fed CR-normalised bytes. `setBaudForPump` (107-118), `__getStateForTests` (196-198).
- `crates/beastty-core/src/terminal.rs:364` -- `0x0D` resets the column without advancing the row; only `0x0A` calls `line_feed()`. This is why the echo copy differs from the wire copy.
- `www/index.html` -- Settings dropdown `#dropdown-settings`. The "Enter key sends" radio submenu at 1968-1994 is the markup template; new rows go after 1994, before the separator at 1995.
- `www/renderer/menu-bar.js` -- `onRadioSelect` crlf branch (836-846) and the numeric `cmdhistory-size` branch (847-859, the shape for Paste speed); panel refs (~502/518); `projectMenuOnOpen` settings block (1191-1198); `projectPrefs` (1439-1453).
- `www/state/prefs.js` -- `DEFAULTS` (20+), `crlfMode` at 28; `loadPrefs` spread-merge (~196) where an explicit `null` overrides the default; `savePrefs` 250 ms debounce (192-196).
- `www/main.js` -- `applyPrefs` (1797+, `setCrlfMode` at 1835); `wireMenuBar` opts (612-623); `confirmLargePaste` injection (1070-1076); `window.__pastePump` (1083-1090).
- `www/renderer/paste-toast.js` -- `confirmLargePaste` (140-155) estimates from baud alone; rendered string at 238-243.
- `www/transport/slide.js` -- `isTransferRunning()`, the predicate `enqueuePaste` already consults and `writeOneChunk` must too.

## Tasks & Acceptance

The line-ending half of this spec is implemented and hardware-confirmed. These tasks replace the pacing half only. The line-ending normaliser, the local-echo display copy, the `isTransferRunning()` re-check, the menu-projection approach and the validator style all stay as they are.

**Execution:**
- [x] `www/state/prefs.js` -- change `pastePauseMs` default from `20` to `200` (the measured working point); comment it as measured, not chosen.
- [x] `www/input/paste-pump.js` -- add `setPasteFlowControl(fc)` plus a getter. When the recorded flow control is `'hardware'`, `pacingFromSettings()` yields the unpaced shape (32-byte chunk, no pause) whatever the two settings hold. Anything else, including never having connected, paces normally. Freeze it at enqueue with the rest of the pacing snapshot.
- [x] `www/transport/serial.js` -- call `setPasteFlowControl` from `setLastConfig`, the single place the open port's config is recorded, and reset it on disconnect. Comment must state that it is live and be true.
- [x] `www/renderer/menu-bar.js` + `www/index.html` -- the throughput readout reports `wire speed (flow control)` when pacing is inactive, so the pause setting is never silently ignored.
- [x] `www/renderer/paste-toast.js` -- the confirm estimate uses the same frozen snapshot, so a handshaken port quotes a wire-speed duration rather than a paced one.
- [x] `www/tests/transport/paste.spec.js` -- pacing bypassed on a `hardware` port and restored on a `none` port; the bypass survives a reconnect that changes flow control; the hook is genuinely wired (a test that fails if the `serial.js` call is removed).
- [x] `www/tests/render/*` + `www/tests/session/prefs.spec.js` -- new default asserted; readout copy in both states; estimate in both states.

**Acceptance Criteria:**
- Given default settings and an LF-only multi-line clipboard, when the user pastes, then every line break reaches the wire as `0x0D` and the rest of the byte stream is identical to the clipboard text.
- Given any chunk size, when a paced paste runs, then every write is exactly that many bytes except the last, regardless of where line breaks fall in the payload.
- Given any pause, when a paced paste runs, then the delay between every pair of consecutive writes is that value — the same after a line break as anywhere else.
- Given a port open with flow control `hardware`, when a paste runs, then no pause is applied and the throughput readout says why.
- Given a port open with flow control `none`, or no port at all, when a paste runs, then the configured pause is applied.
- Given local echo is on and the default line ending, when a multi-line block is pasted, then the echoed text occupies as many rows as it has lines.
- Given "Enter key sends" and "Paste line ending" are set to different values, when the user presses Enter and then pastes a line break, then each emits its own configured bytes with no interference.
- Given either pacing setting is changed, when the page is reloaded, then the value persists and both the menu checkmark and the live behaviour reflect it.
- Given a chunk size and pause, when the confirm quotes a duration, then it is within ~15 % of how long the paste actually takes.

## Spec Change Log

### 2026-08-06 — pacing model corrected after review round 1

**Triggering findings.** Three independent reviewers (blind, edge-case, acceptance) agreed the inter-chunk gap was a flat per-chunk value, so a chunk truncated at a line terminator paid the full gap for however few bytes it carried. At the 240 B/s default that made real source run at 55–155 B/s and made the large-paste estimate wrong by 2–15×. The acceptance audit further showed the frozen matrix row (800 B in ~4-6 s) was unachievable under the spec's own formula — actual 6.4–8.6 s. Separately, the edge-case review found the LF→CR rewrite was also fed to `termRef.feed()` for local echo, and the core treats `0x0D` as column-reset only, so every pasted line drew on top of the last whenever local echo was on — a regression in the default configuration. Two smaller model gaps: `writeOneChunk` never re-checked `isTransferRunning()`, widening the SLIDE silent-drop window ~7×, and a mid-paste switch to Full speed burst the remainder of the in-flight payload.

**What was amended.** Paste speed is now defined as the byte rate *between* line breaks, with the break pause additive and stated in the menu labels — the human's call, chosen over a true-average label because the between-break rate is the term that governs FIFO overrun and must stay directly tunable. The gap is now proportional to bytes actually written. The frozen matrix row now states both terms rather than a single duration. New matrix rows cover local echo, mid-paste speed change, SLIDE starting mid-paste, the non-numeric stored pref, and the estimate's accuracy. New "Always" constraints pin the proportional gap, the echo requirement, and the SLIDE progress rule.

**Known-bad state avoided.** A "240 B/s" setting that silently delivers 55 B/s; a confirm chip understating a paste by 4×; a default configuration where pasting into an editor with local echo on renders as one line of overstrike; and a progress bar advancing over bytes SLIDE threw away.

**KEEP — must survive re-derivation.** These were verified correct by all three reviewers and should be re-derived to the same shape, not redesigned:
- The two-pass `normaliseLineBreaks`: test `\r\n` **before** either bare byte, size the output in pass 1, fill in pass 2. Verified correct for empty input, terminator-only input, a lone trailing `\r`, and all four modes.
- The chunk-end scan's rule that a CRLF pair is never split across two writes — if the LF will not fit under the cap, end the chunk *before* the CR.
- `setPasteLineEnding` validating by `hasOwnProperty` against the terminator table (correctly rejects `null` and prototype keys). The speed validator must be made equally strict.
- Full-speed (`0`) as a genuine byte-for-byte restoration of the pre-fix pump, pinned by a test asserting chunk sizes `[32, 32, 16]` and `gapMs` 19.
- The complete radio-submenu wiring with no missing projection point, including the initial paint at wire time.
- `config.spec.js` selecting Full speed before its baud assertions — necessary, not convenient: at the paced default `gapMs` is 33 at both 19200 and 9600, so the test cannot otherwise discriminate baud, and its purpose is proving `setBaudForPump` is wired.
- `paste-toast.spec.js` asserting the toast string exactly rather than with `toContainText`.

### 2026-08-06 — pacing replaced by chunk size + pause after hardware testing

**Triggering evidence.** Real-hardware testing of `fe2b57f`. With flow control the paste is correct at full speed — confirming the line-ending fix and disproving an earlier claim of mine that the MicroBeast was not handshaking. Without flow control it fails *identically* at 60, 120 and 240 B/s. `__getStateForTests()` confirmed the setting was genuinely applied (`chunkSize: 8, gapMs: 133, speed: 60`), so a 4× rate change with no observable effect can only mean the pause is not where the loss happens. Every one of those speeds sent the same 8-byte burst; only the idle time afterwards differed. Chunk size was pinned at 8 throughout and was never tested.

**What was amended, at Ant's direction.** The rate-with-a-line-break-qualifier model is replaced by two independent physical controls — chunk size and pause. Throughput becomes a displayed consequence rather than a setting. All content-dependent behaviour is removed: no splitting at terminators, no longer pause after a line break, no proportional gap. Ant's words: *"the settings menu clearly says 'pause between line breaks'. what we need is 'pause between half-fifo sized chunks'."*

**Known-bad state avoided.** A settings menu offering a knob that cannot affect the failure the user is trying to fix, while presenting a number that describes neither the cadence nor the delivered throughput.

**KEEP — carried forward from the previous entry and still binding.** The two-pass `normaliseLineBreaks`; `hasOwnProperty`-style validation with the type rejected before the value; the complete radio-submenu wiring including the wire-time paint; projecting the menu from the pump's live values rather than the raw pref; exact-string toast assertions; the local-echo display copy; the `isTransferRunning()` re-check inside the write loop; and the slower-of-the-two rule when appending to a live run. The CRLF-never-split rule is **retired**, not lost — it existed to keep the line-break pause from landing between a CR and its LF, and there is no longer a line-break pause.

### 2026-08-07 — measured working point; pacing limited to unhandshaken ports

**Triggering evidence.** Ant swept the new controls on real hardware. chunk 1 / pause 200 ms (5 B/s) works; chunk 1 / pause 100 ms and chunk 2 / pause 200 ms (both 10 B/s) both nearly work. Equal throughput by two different chunk sizes behaves the same, so throughput governs and burst size does not — at least not at this scale.

**What was amended.** The measured working point becomes the default (pause 200 ms, up from 20 ms). The frozen Intent's claim that loss happened *inside* the 8-byte chunk is corrected: every previously offered speed was simply 10–50× above a ~6 B/s ceiling. Pacing is now limited to ports whose flow control is `none`, at Ant's direction, because 5 B/s applied to a handshaken port would turn a sub-second paste into nearly three minutes for no benefit. The pump regains a hook from `serial.js` — this time for flow control rather than baud — with an explicit constraint that it be wired and tested, since a dead hook of exactly that shape is documented in this repo as having cost months.

**Known-bad state avoided.** A default that either corrupts every paste on a bare connection or imposes a three-minute paste on a connection that never needed pacing.

**KEEP — still binding.** Everything in the previous entry's KEEP list, plus: no behaviour may key off the *content* of the bytes. The flow-control condition keys off port configuration, which is a different thing and is the only exception.

## Design Notes

Two independent controls, both physical:

- `pasteChunk` — bytes written back-to-back. Offered: 1, 2, 4, 8, 16, 32. Default **1**.
- `pastePauseMs` — idle time between chunks. Offered: 0, 5, 10, 20, 50, 100, 200. Default **200**.

Everything else follows: `writes = ceil(B / pasteChunk)`, `duration ≈ (writes - 1) × pastePauseMs`, `throughput ≈ pasteChunk / pastePauseMs × 1000`. The defaults are the measured working point on real hardware — one byte every 200 ms, ~5 B/s — chosen so a bare connection works out of the box rather than so a paste is quick.

Those defaults would make every paste glacial if they applied universally, so they do not: **when the open port's flow control is `hardware`, the pump runs unpaced** (a full 32-byte chunk, no pause), which is what the pre-fix pump did and what real hardware confirms works. Flow control unknown — no port ever opened — counts as `none`, because pacing a connection that does not need it costs time while not pacing one that does costs data.

**Why the previous model was wrong.** It made throughput the setting and derived the cadence, with an extra pause at line breaks on the theory that a full-screen editor redraws on newline. That theory was never evidenced, and it left chunk size pinned at 8 while the user varied a number that changed only the idle time. The measured ceiling is ~5–8 B/s, so every speed that model offered (60 B/s and up) was an order of magnitude too fast — which is why they all failed identically. Not a burst effect: simply a range that never reached the working point.

The 16C550's FIFO configuration on this machine remains unconfirmed, and no longer matters to this design: two chunk sizes at equal throughput behave the same, so the pump paces on rate and lets the user pick the burst.

Local echo needs its own copy of the bytes. The wire wants the configured terminator; the screen wants something the VT52 core renders as a new row, and `0x0D` alone is not that (`terminal.rs:364`).

Local echo needs its own copy of the bytes. The wire wants the configured terminator; the screen wants something the VT52 core renders as a new row, and `0x0D` alone is not that (`terminal.rs:364`).

The 240 B/s default is an estimate, not a measurement. It must be confirmed on real hardware during manual verification and changed if VIBE still drops text.

## Verification

**Commands:**
- `cd www && npx playwright test tests/input/paste-line-ending.spec.js tests/transport/paste.spec.js` -- expected: all pass.
- `cd www && npx playwright test` -- expected: no new failures. A known pool of load-sensitive specs flakes (see `deferred-work.md`) — re-run any single failure in isolation before calling it a regression.

**Manual checks (real hardware):**
- **Line endings: confirmed 2026-08-06.** With flow control at full speed the ~800 B Forth block pastes into VIBE correctly.
- **Working point: confirmed 2026-08-07.** Flow control `none`, chunk 1 / pause 200 ms delivers the block intact (~2 min 40 s). 10 B/s by either route nearly works, so the ceiling is ~5–8 B/s.
- **Remaining check — the flow-control bypass.** Connect with RTS/CTS and confirm a paste runs at wire speed with the pause still set to 200 ms, and that the throughput readout says pacing is inactive. Then reconnect with flow control `none` and confirm the same paste paces again. This is the only behaviour in this spec that no hardware run has yet exercised.
- With Local echo on, confirm a multi-line paste echoes as multiple lines locally.

## Suggested Review Order

**The two defects, and the model that replaced them**

- Start here: line breaks are normalised in one scan, `\r\n` consumed as one break.
  [`paste-pump.js:513`](../../www/input/paste-pump.js#L513)

- The other half of the bug: 8-byte paced writes stay under the 16-byte FIFO.
  [`paste-pump.js:53`](../../www/input/paste-pump.js#L53)

- A chunk ends at a terminator or contains none; a CRLF pair is never split.
  [`paste-pump.js:399`](../../www/input/paste-pump.js#L399)

- The correction that cost a revert: the gap scales with bytes actually written.
  [`paste-pump.js:322`](../../www/input/paste-pump.js#L322)

- A line break costs an editor a redraw, so it earns an additive pause.
  [`paste-pump.js:328`](../../www/input/paste-pump.js#L328)

- The wire is always the ceiling — asking for more than it carries is clamped.
  [`paste-pump.js:313`](../../www/input/paste-pump.js#L313)

**State that must not drift**

- One snapshot drives both the quoted estimate and the run that follows it.
  [`paste-pump.js:272`](../../www/input/paste-pump.js#L272)

- Appending to a live run adopts the slower pacing, never the faster.
  [`paste-pump.js:377`](../../www/input/paste-pump.js#L377)

- Local echo needs its own copy: bare CR moves the column, not the row.
  [`paste-pump.js:487`](../../www/input/paste-pump.js#L487)

- Type rejected before value, so `null` cannot coerce to Full speed.
  [`paste-pump.js:244`](../../www/input/paste-pump.js#L244)

- Reported rate honours the 4 ms floor the gap arithmetic already enforced.
  [`paste-pump.js:263`](../../www/input/paste-pump.js#L263)

**Settings surface**

- Two prefs appended; `CURRENT_VERSION` deliberately not bumped.
  [`prefs.js:79`](../../www/state/prefs.js#L79)

- Menu projects from the pump's live values, so a checkmark cannot lie.
  [`menu-bar.js:530`](../../www/renderer/menu-bar.js#L530)

- Both radio branches: apply to the pump and persist, never one alone.
  [`menu-bar.js:875`](../../www/renderer/menu-bar.js#L875)

- The estimate counts bytes and breaks, and says so when breaks dominate.
  [`paste-toast.js:149`](../../www/renderer/paste-toast.js#L149)

- Threshold and quote both measure post-normalisation wire length.
  [`clipboard.js:95`](../../www/input/clipboard.js#L95)

**Tests**

- Every line-ending row of the matrix, against real wire bytes.
  [`paste-line-ending.spec.js:1`](../../www/tests/input/paste-line-ending.spec.js#L1)

- Paced chunking, proportional gap, break pause, clamp, SLIDE, mid-paste change.
  [`paste.spec.js:1`](../../www/tests/transport/paste.spec.js#L1)

- Multi-line paste echoes as multiple rows — the regression that forced round 2.
  [`local-echo.spec.js:1`](../../www/tests/input/local-echo.spec.js#L1)

- Corrupt and off-menu stored values: pump and checkmark must agree.
  [`prefs.spec.js:1`](../../www/tests/session/prefs.spec.js#L1)
