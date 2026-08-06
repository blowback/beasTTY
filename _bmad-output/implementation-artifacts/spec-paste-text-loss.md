---
title: 'Paste into the MicroBeast loses most of the text'
type: 'bugfix'
created: '2026-08-06'
status: 'done'
baseline_commit: 'e0da1afe875e098412840a1b50b20d9bb7e98173'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pasting a multi-line block into the terminal loses nearly all of it, from two independent defects. (1) `applyCrlfRewrite` only ever inspects `0x0D`, so LF-only clipboard text — the normal case on Linux — reaches the wire as bare `0x0A` in every mode, and the far end never sees a line break. (2) The pump paces to ~1684 B/s at 19200 baud, which no Z80 editor can consume, and hands 32 bytes to the writer back-to-back, so they arrive as an unbroken 16.7 ms burst that a 16-byte FIFO cannot absorb whatever the average rate. Observed on hardware: with flow control `none`, 17 clean characters arrive (one FIFO) then garbage; with RTS/CTS, ~66 bytes arrive with every line break missing.

**Approach:** Two user settings — **Paste line ending** (normalise every break in the pasted text to CR / LF / CRLF, or pass through as-is) and **Paste speed** (bytes/sec). At a paced speed, chunks drop to 8 bytes so a burst cannot overrun the FIFO, split at line terminators, and a line break earns an extra pause on top of the ordinary inter-chunk gap.

## Boundaries & Constraints

**Always:**
- Paste line ending is a **separate** setting from Settings ▸ "Enter key sends" (`crlfMode`); neither reads the other. Label both rows so it is obvious which governs which — they can hold different values, and that must read as deliberate.
- A paced chunk is **≤ 8 bytes**, under the 16-byte 16C550 FIFO with room to drain.
- A chunk never spans a line terminator: it ends at one, or contains none.
- **Paste speed is the byte rate _between_ line breaks.** The per-break pause is additive and deliberate. Menu labels must say so, and any duration estimate must count both terms.
- **The inter-chunk gap is proportional to the bytes actually written**, never a flat per-chunk value — a chunk truncated at a terminator must not cost the same as a full one.
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
| Paced paste | 800 B at 240 B/s | ~240 B/s between breaks + ~133 ms per break: 40-char lines ≈ 6 s, 20-char lines ≈ 8 s | N/A |
| Short chunk cost | 3-byte chunk ending at a terminator | pays ~3/rate, not a full chunk's gap — then the break pause | N/A |
| Large-paste estimate | 5000 B, 125 breaks, 240 B/s | quoted duration counts both terms (~37 s), within ~15 % of actual | N/A |
| Local echo, multi-line | echo on, ending `cr`, `A\nB` | screen shows `A` and `B` on separate lines | N/A |
| Full speed | speed `0` | today's behaviour: 32 B at `computeGap(baud)`, no break pause | N/A |
| Speed above the wire | 480 B/s at 2400 baud | clamped to the 8N1 byte rate | N/A |
| Speed changed mid-paste | Full speed picked during a paced paste | the in-flight paste keeps its enqueue-time pacing; the new value applies to the next paste | N/A |
| SLIDE starts mid-paste | transfer begins while a paced paste runs | pump stops; progress does not advance over dropped bytes | N/A |
| Cancel mid-paste | Esc while paced | pump stops; no `0x1B` emitted (unchanged) | N/A |
| Out-of-range stored pref | `pasteSpeed: 99999` | rejected, default stands | no throw |
| Non-numeric stored pref | `pasteSpeed: null` / `""` / `false` / `[]` | rejected, default stands, menu shows the default | no throw; must not coerce to `0` |
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

**Execution:**
- [ ] `www/state/prefs.js` -- append `pasteLineEnding: 'cr'` and `pasteSpeed: 240` to `DEFAULTS` with inline comments; do not bump `CURRENT_VERSION`.
- [ ] `www/input/paste-pump.js` -- replace `applyCrlfRewrite` with a line-break normaliser: scan for `\r\n`, `\r`, `\n`, emit the configured terminator for each; `raw` returns input unchanged. Add `setPasteLineEnding` / `setPasteSpeed`; `setPasteSpeed` must reject any non-`number` **before** the integer test, so `null`/`""`/`false`/`[]` cannot coerce to `0`.
- [ ] `www/input/paste-pump.js` -- re-chunk and re-pace: 8-byte cap when paced, split at terminators, gap **proportional to the bytes in the chunk just written**, plus an additive break pause after a terminator-ending chunk. Clamp the rate to the wire. Freeze the pacing values for an in-flight paste at enqueue so a mid-paste speed change cannot burst the remainder. Keep `writeOneChunk` synchronous.
- [ ] `www/input/paste-pump.js` -- feed local echo a display copy in which the terminator renders as a real newline, so a multi-line paste echoes as multiple lines. Re-check `isTransferRunning()` in `writeOneChunk` and stop without advancing progress if a transfer started mid-paste.
- [ ] `www/index.html` -- two radio submenus after line 1994: "Paste line ending" (`paste-eol`: CR / LF / CRLF / As-is) and "Paste speed" (`paste-speed`: Full speed / 480 / 240 / 120 / 60 B/s), the paced rows labelled to show the break pause is extra.
- [ ] `www/renderer/menu-bar.js` -- panel refs, injected setters, two `onRadioSelect` branches, plus entries in the settings re-projection and in `projectPrefs`.
- [ ] `www/main.js` -- inject both setters into `wireMenuBar`; call both from `applyPrefs`; confirm `wirePastePump` runs before `applyPrefs(prefs)`; expose the new getters on `window.__pastePump`.
- [ ] `www/renderer/paste-toast.js` + `www/main.js` -- estimate from both terms: `bytes / rate` plus one break pause per terminator in the payload. Never substitute a fallback rate for a real one; floor the reported rate at 1.
- [ ] `www/input/paste-pump.js` -- comment accuracy pass: state the FIFO rationale as *burst length* (not arrival rate) and cite the observed 17-byte prefix as its evidence; correct the stale "18ms" figure; make the `MAX_PASTE_SPEED` comment admit the 4 ms floor caps the paced path well below it; drop the unreachable `i === start` disjunct in the chunk-end scan or assert the constant it depends on.
- [ ] `www/tests/input/paste-line-ending.spec.js` -- new spec covering every line-ending row of the I/O matrix against `#tx-strip`, plus a paced CRLF pair straddling the chunk cap (reachable only in `crlf`/`raw` mode).
- [ ] `www/tests/transport/paste.spec.js` -- paced chunk size, proportional short-chunk gap, additive break pause, wire clamp, mid-paste speed change, SLIDE-starts-mid-paste, and a realistic multi-line duration; re-verify the existing duration (39-57) and keystroke queue-jump (106) tests against the new chunking.
- [ ] `www/tests/render/*` + `www/tests/session/prefs.spec.js` -- defaults, reload round-trip, menu persist/apply/focus-retention, reset re-projection, the non-numeric-pref rejection, a multi-line local-echo render, the updated toast string, and an assertion that the pump's module defaults match `DEFAULTS`.

**Acceptance Criteria:**
- Given default settings and an LF-only multi-line clipboard, when the user pastes, then every line break reaches the wire as `0x0D` and the rest of the byte stream is identical to the clipboard text.
- Given a paced speed, when a paste runs, then no single write exceeds 8 bytes and none spans a line terminator.
- Given local echo is on and the default line ending, when a multi-line block is pasted, then the echoed text occupies as many rows as it has lines.
- Given "Enter key sends" and "Paste line ending" are set to different values, when the user presses Enter and then pastes a line break, then each emits its own configured bytes with no interference.
- Given either new setting is changed, when the page is reloaded, then the value persists and both the menu checkmark and the live behaviour reflect it.
- Given `pasteSpeed` is `0`, when a paste runs, then chunk size and timing are byte-for-byte what they are today.

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

## Design Notes

`pasteSpeed` is bytes/sec **between line breaks**, with `0` meaning "as fast as the wire allows" — today's behaviour, kept for targets that can take it. Let `rate = min(pasteSpeed, baud/10 * 0.90)`.

- Gap after writing a chunk of `n` bytes: `max(4, round(n / rate * 1000))`.
- If that chunk ended in a terminator, add `lineExtraMs = max(50, round(8 / rate * 1000) * 4)` on top — a line break costs a full-screen editor a redraw where an ordinary character costs a buffer insert.
- Estimated duration for a payload of `B` bytes containing `k` breaks: `B / rate + k * lineExtraMs / 1000`.

At 240 B/s that is a 33 ms gap for a full 8-byte chunk, ~13 ms for a 3-byte one, and a 133 ms extra pause per line — so 800 B of 40-char lines takes ~6 s, and the estimate agrees with the pump instead of guessing.

Local echo needs its own copy of the bytes. The wire wants the configured terminator; the screen wants something the VT52 core renders as a new row, and `0x0D` alone is not that (`terminal.rs:364`).

The 240 B/s default is an estimate, not a measurement. It must be confirmed on real hardware during manual verification and changed if VIBE still drops text.

## Verification

**Commands:**
- `cd www && npx playwright test tests/input/paste-line-ending.spec.js tests/transport/paste.spec.js` -- expected: all pass.
- `cd www && npx playwright test` -- expected: no new failures. A known pool of load-sensitive specs flakes (see `deferred-work.md`) — re-run any single failure in isolation before calling it a regression.

**Manual checks (real hardware — the only check that closes this bug):**
- At 19200 with flow control `none`, open VIBE on the MicroBeast, enter insert mode, paste the ~800 B Forth block from the bug report. Expect every line present, correctly broken, no garbage. If text is still lost, step `pasteSpeed` down (120, then 60) and record the first value that survives — that becomes the default.
- With Local echo on, confirm the same paste echoes as multiple lines locally.
- Repeat with RTS/CTS and confirm it is no worse.

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
