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

**Problem:** Pasting a multi-line block into the terminal loses nearly all of it, from two independent defects. (1) `applyCrlfRewrite` only ever inspects `0x0D`, so LF-only clipboard text — the normal case on Linux — reaches the wire as bare `0x0A` in every mode, and the far end never sees a line break. (2) The pump paces to ~1684 B/s at 19200 baud, which no Z80 editor can consume, and hands 32 bytes to the writer back-to-back, so they arrive as an unbroken 16.7 ms burst that a 16-byte FIFO cannot absorb whatever the average rate. Observed on hardware: with flow control `none`, 17 clean characters arrive (one FIFO) then garbage; with RTS/CTS, ~66 bytes arrive with every line break missing.

**Approach:** Three user settings — **Paste line ending** (normalise every break in the pasted text to CR / LF / CRLF, or pass through as-is), and two controls describing the wire cadence directly: **Paste chunk size** (how many bytes land back-to-back) and **Paste pause** (how long the receiver gets to drain between them). Throughput is a consequence of the two, not a setting.

**Hardware finding (2026-08-06, real MicroBeast).** With flow control the paste is correct at full speed, so the firmware handshakes per byte and the line-ending fix is confirmed. Without flow control the paste fails identically at 60, 120 and 240 B/s — a 4× rate change with no effect — because every one of those sends the same 8-byte burst and varies only the idle time after it. The loss is inside the chunk, so the pause cannot reach it. Chunk size is the variable that was never tested.

## Boundaries & Constraints

**Always:**
- Paste line ending is a **separate** setting from Settings ▸ "Enter key sends" (`crlfMode`); neither reads the other. Label both rows so it is obvious which governs which — they can hold different values, and that must read as deliberate.
- **Chunk size and pause are the two controls, and both are physical facts.** Chunk size is how many bytes go out back-to-back; pause is the idle time the receiver gets between chunks. Neither is derived from the other and neither is expressed as a rate.
- **Throughput is shown, never set.** Derive it from the two controls and display it in the menu and the confirm estimate, so the user reads a consequence rather than reasoning backwards from one.
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
| Paced paste | 800 B, chunk 1, pause 20 ms | 800 writes of 1 byte, 20 ms apart, ~16 s; no chunk larger than 1 whatever the bytes contain | N/A |
| Chunk holding a line break | chunk 8, payload `AB\nCDEFGHIJ` | the break rides inside a chunk like any other byte — no early split, no longer pause | N/A |
| Derived throughput shown | chunk 8, pause 20 ms | menu and estimate both read ~400 B/s; the user never types a rate | N/A |
| Large-paste estimate | 5000 B, chunk 8, pause 20 ms | `ceil(5000/8) × 20 ms` ≈ 13 s, within ~15 % of actual | N/A |
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
- [x] `www/state/prefs.js` -- replace `pasteSpeed: 240` with `pasteChunk: 1` and `pastePauseMs: 20`. Still no `CURRENT_VERSION` bump; a stored `pasteSpeed` from the previous shape is simply ignored by the spread-merge.
- [x] `www/input/paste-pump.js` -- replace the rate model with the two controls. `setPasteChunk` / `setPastePauseMs` / getters, each rejecting the type before the value. Delete `effectiveRate`, `gapForBytes`, `lineExtraFor`, `MAX_PASTE_SPEED`, `setBaudForPump`'s pacing role and the wire clamp — none of them survive a model where the user sets the cadence directly.
- [x] `www/input/paste-pump.js` -- `chunkEnd` becomes `min(start + chunk, queue.length)` with no terminator scan; the delay after every chunk is `pastePauseMs` flat. Remove the CRLF-never-split rule (see the change log: it only existed to protect a pause that no longer exists). Keep `writeOneChunk` synchronous, keep the SLIDE re-check, keep freezing at enqueue and the slower-of-the-two rule on append.
- [x] `www/transport/serial.js` -- drop the `setBaudForPump` call from `setLastConfig` if the pump no longer consumes baud, and correct the comment rather than leaving it claiming a live hook. If any baud-derived behaviour remains, say exactly what.
- [x] `www/index.html` -- replace the `paste-speed` submenu with two: "Paste chunk size" (`paste-chunk`: 1 / 2 / 4 / 8 / 16 / 32 bytes) and "Paste pause" (`paste-pause`: none / 5 / 10 / 20 / 50 / 100 / 200 ms). Show the derived throughput on the parent row or alongside, so the consequence is visible without arithmetic.
- [x] `www/renderer/menu-bar.js` -- swap the `paste-speed` branch for the two new panels, projecting each from the pump's live getter as the current code does. Keep every projection point.
- [x] `www/main.js` -- inject and apply both setters; expose both getters plus the derived throughput on `window.__pastePump`.
- [x] `www/renderer/paste-toast.js` + `www/input/clipboard.js` -- estimate becomes `(ceil(wireBytes / chunk) - 1) × pauseMs`. Drop the break term and the between-line-breaks qualifier from the string; quote the derived throughput.
- [x] `www/input/paste-pump.js` -- comment pass: record what the hardware actually showed (identical corruption at 60/120/240 B/s with chunk pinned at 8, correct at full speed with flow control) and why chunk size is therefore the control that matters. Remove the FIFO-size claims that the evidence no longer supports — the 16C550's FIFO configuration on this machine is unconfirmed.
- [x] `www/tests/transport/paste.spec.js` -- chunk size honoured exactly at 1/2/8/32 including across line breaks; flat pause after every chunk; pause 0; settings changed mid-paste; the slower-of-two append; SLIDE mid-paste. Delete the tests that asserted terminator-splitting and the break pause.
- [x] `www/tests/*` -- defaults, reload round-trip, menu persist/apply/focus-retention, reset re-projection, type-rejection for both new prefs, and the updated estimate string. Line-ending and local-echo specs should need no change; if one does, that is a signal the pacing rework reached further than intended.

**Acceptance Criteria:**
- Given default settings and an LF-only multi-line clipboard, when the user pastes, then every line break reaches the wire as `0x0D` and the rest of the byte stream is identical to the clipboard text.
- Given any chunk size, when a paste runs, then every write is exactly that many bytes except the last, regardless of where line breaks fall in the payload.
- Given any pause, when a paste runs, then the delay between every pair of consecutive writes is that value — the same after a line break as anywhere else.
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

## Design Notes

Two independent controls, both physical:

- `pasteChunk` — bytes written back-to-back. Offered: 1, 2, 4, 8, 16, 32. Default **1**.
- `pastePauseMs` — idle time between chunks. Offered: 0, 5, 10, 20, 50, 100, 200. Default **20**.

Everything else follows: `writes = ceil(B / pasteChunk)`, `duration ≈ (writes - 1) × pastePauseMs`, `throughput ≈ pasteChunk / pastePauseMs × 1000` (unbounded when the pause is 0, where the wire is the only limit). Defaults give one byte every 20 ms ≈ 50 B/s.

**Why the previous model was wrong.** It made throughput the setting and derived the cadence, with an extra pause at line breaks on the theory that a full-screen editor redraws on newline. That theory was never evidenced. Worse, it left chunk size pinned at 8 while the user varied a number that only changed the idle time — which is why 60, 120 and 240 B/s produced identical corruption on real hardware. The bytes that were lost were lost *within* the 8-byte burst, where no pause can reach them.

The default of chunk 1 is deliberately the most conservative setting available, not a tuned one. Walking it upward until the paste breaks is what tells us the receiver's real buffer size — the number nobody currently knows, since the 16C550's FIFO configuration on this machine is unconfirmed.

Local echo needs its own copy of the bytes. The wire wants the configured terminator; the screen wants something the VT52 core renders as a new row, and `0x0D` alone is not that (`terminal.rs:364`).

Local echo needs its own copy of the bytes. The wire wants the configured terminator; the screen wants something the VT52 core renders as a new row, and `0x0D` alone is not that (`terminal.rs:364`).

The 240 B/s default is an estimate, not a measurement. It must be confirmed on real hardware during manual verification and changed if VIBE still drops text.

## Verification

**Commands:**
- `cd www && npx playwright test tests/input/paste-line-ending.spec.js tests/transport/paste.spec.js` -- expected: all pass.
- `cd www && npx playwright test` -- expected: no new failures. A known pool of load-sensitive specs flakes (see `deferred-work.md`) — re-run any single failure in isolation before calling it a regression.

**Manual checks (real hardware — the only check that closes this bug):**
- **Line endings: already confirmed.** With flow control at full speed the ~800 B Forth block pastes into VIBE correctly. No further check needed.
- **Chunk size sweep, flow control `none`, 19200.** Start at the default (chunk 1, pause 20 ms) and paste the Forth block into VIBE in insert mode. If it survives, walk chunk size up — 2, 4, 8 — until it breaks. **The largest chunk that survives is the receiver's usable buffer**, which is the number nobody has yet; record it and it becomes the default. If chunk 1 at 20 ms still fails, raise the pause instead (50, 100) before concluding the receiver cannot be paced at all.
- With Local echo on, confirm the same paste echoes as multiple lines locally.
- Confirm RTS/CTS at full speed is unaffected — it already works and must stay working.

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
