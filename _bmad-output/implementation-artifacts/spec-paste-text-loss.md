---
title: 'Paste into the MicroBeast loses most of the text'
type: 'bugfix'
created: '2026-08-06'
status: 'done'
baseline_commit: '2e7bb59e7831dcdea158f352933a43d727f11c66'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pasting a multi-line block into the terminal loses nearly all of it, from two independent defects. (1) `applyCrlfRewrite` only ever inspects `0x0D`, so LF-only clipboard text — the normal case on Linux — reaches the wire as bare `0x0A` in every mode, and the far end never sees a line break. (2) The pump paces to ~1684 B/s at 19200 baud — roughly 300× what the MicroBeast can consume in a full-screen editor without flow control (measured at ~5–8 B/s, see the hardware finding below) — and offers no way to go slower. Observed on hardware: with flow control `none`, ~17 clean characters arrive then garbage; with RTS/CTS, ~66 bytes arrive with every line break missing, which was defect (1) rather than a flow-control failure.

**Approach:** Three user settings, grouped in a **Paste settings modal** off the Settings menu: **Paste line ending** (normalise every break in the pasted text to CR / LF / CRLF, or pass through as-is), and two controls describing the wire cadence directly — **Paste chunk size** (how many bytes land back-to-back) and **Paste pause** (how long the receiver gets to drain between them). Throughput is a consequence of the two, not a setting. The in-progress paste chip reports elapsed time and the rate actually achieved, so the app measures itself instead of the user timing it by hand.

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
- The three paste settings live together in one modal opened from Settings, following the `#serial-config-modal` precedent and the clean-modal aesthetic (aligned rows, ⓘ tooltips) — not verbose transplanted panels. Persist ≠ apply still holds: every control applies to the pump **and** persists.
- **The paste chip reports elapsed time and achieved rate while pasting.** Measured from real progress, never derived from the settings — its whole value is telling the user what actually happened rather than what was configured.
- **Progress counts bytes the wire accepted, not bytes handed to a buffer.** The paste path awaits Web Serial backpressure, so the chip's rate is the wire's rate on every path including a handshaking one. Without this the readout is honest when paced and meaningless when not.
- **A write resolving after a cancel or port loss may not advance anything.** Guard the resume with a generation token: no cursor movement, no progress event, no further chunk.
- Append new prefs to `DEFAULTS` **without** bumping `CURRENT_VERSION` (defensive spread-merge, as every prior pref).
- Each new pref validates at its consumer, as `setCrlfMode` does — `prefs.js` has no field validation, and a merged `null` overrides a default rather than falling back to it.
- SLIDE must never see paste bytes, and paste progress must never advance over bytes SLIDE caused to be dropped.

**Ask First:**
- Any change to `pushTxBytes` itself, or to SLIDE transport. Keystrokes and SLIDE control bytes share `pushTxBytes`; the paste path gets its own awaitable entry point beside `writeSlideFrameAwaitable` rather than changing the one everybody uses.
- Widening the async conversion beyond the paste chunk loop.

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
| Pause 150 ms offered | chunk 1, pause 150 ms | ≈ 6.7 B/s — the gap between the 10 B/s that nearly worked and the 5 B/s that did | N/A |
| Chip while pasting | 400 B in flight, 20 s elapsed | chip shows bytes, percent, elapsed seconds and achieved B/s, updating as it runs | N/A |
| Chip rate is measured | flow control bypassing the pause | achieved rate reflects the wire, not the configured pause | N/A |
| Settings reachable | Settings ▸ Paste settings… | one modal holds line ending, chunk size, pause and the throughput readout | N/A |
| Settings changed mid-paste | chunk or pause changed during a paced paste | the in-flight paste keeps its enqueue-time values; a paste appended to a live run adopts the slower of the two | N/A |
| SLIDE starts mid-paste | transfer begins while a paced paste runs | pump stops; progress does not advance over dropped bytes | N/A |
| Chip rate on a handshaking port | RTS/CTS throttling to ~13.5 B/s | chip reports ~13.5 B/s, not the enqueue rate | N/A |
| Port lost mid-paste | writer rejects | paste aborts; progress never reports `complete`; unsent count is real | rejection reaches the pump rather than a console line |
| Cancel during an in-flight write | Esc while a write is pending | pump stops; the resolving write advances nothing | generation token; no `0x1B` emitted |
| No writer registered | paste with nothing connected | no progress, no fabricated completion | reported, not silently "done" |
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

**Execution — backpressure:**
- [x] `www/input/tx-sink.js` -- add an awaitable paste entry point beside `writeSlideFrameAwaitable`: ring + `notify()` + the SLIDE-owner drop, then `await writer.ready; await writer.write`. Return whether the bytes were accepted. Leave `pushTxBytes` untouched.
- [x] `www/input/paste-pump.js` -- `writeOneChunk` becomes async and awaits that entry point. Advance the cursor and fire progress only for bytes the wire accepted. Guard the resume with a generation token so a write resolving after a cancel, a port loss or a SLIDE start advances nothing and schedules nothing.
- [x] `www/input/paste-pump.js` -- surface a write rejection: abort the paste, report the real unsent count, never fire `complete`. A paste with no writer registered must not report progress at all.
- [x] `www/tests/transport/paste.spec.js` -- cancel while a write is in flight; port lost mid-paste never reaching `complete`; no writer registered; and the chip's rate tracking a throttled writer rather than the enqueue rate.

**Execution — review patches:**
- [x] `www/transport/serial.js` -- record the port config on **every** successful open, reconnect paths included, so the pump's flow-control belief always matches the open port. Removes the Disconnect → unplug → replug case that leaves a handshaking port paced, and removes the asymmetry the current comment has to reason about. Test the replug path.
- [x] `www/renderer/paste-toast.js` -- reset the clock when a run's byte count restarts (append compacts the queue and `written` returns to 1, so elapsed and written currently measure different intervals). Quote no rate until enough time has passed to compute one — the present `elapsedMs > 0` guard admits a first frame of 160,000 B/s. Correct the steady-state bias (n bytes over n−1 pauses).
- [x] `www/renderer/paste-toast.js` -- restore a wire bound to the duration estimate: at pause 0 the model is all pauses, so 2 MB quotes "~1 s". On a handshaking port quote a duration too — dropping it entirely leaves a ~2 h paste unwarned at the measured 13.5 B/s.
- [x] `www/renderer/paste-config.js` -- re-project the throughput readout when the connection changes, so an open modal cannot keep claiming `wire speed (flow control)` after the port is lost.
- [x] `www/index.html` -- correct the modal hint: pacing also applies when nothing is connected, which the current wording denies. Restore scrolling to the modal body — `overflow: visible` makes the Close button unreachable at high zoom.
- [x] `www/input/paste-pump.js` + `www/renderer/paste-toast.js` -- one rounding rule for throughput across chip, modal and confirm: 1 B / 150 ms must not read `≈ 7 B/s` in the control the user picks from while the chip says `6.7 B/s`. Compare unrounded in `slowerPacing` so near-equal cadences do not tie.
- [x] `www/tests/render/paste-config-modal.spec.js` -- the removal check iterates `paste-chunk` / `paste-pause`, which never existed; the retired panel was `paste-speed`. Two assertions are vacuous and the one that matters is missing.
- [x] `www/tests/input/paste-line-ending.spec.js` -- the corrupt-stored-value test cannot fail: `ready()` installs its own prefs blob that overwrites the seeded one. Let `ready()` take an override.
- [x] `www/tests/transport/paste.spec.js` -- delete the retracted burst theory from the "Paste cadence" describe header; it states the wrong mechanism directly above the tests for the right one.
- [x] `www/tests/render/menu-bar-settings.spec.js` -- drop the now-dead `ready()` options and unused import; re-home the lost "Enter key sends" label assertion; remove the double `setup()` in the toast progress case.
- [x] `www/renderer/paste-config.js` -- replace the banned word in the injected-dependencies comment.

**Acceptance Criteria:**
- Given a paste over a handshaking port, when the chip reports a rate, then it is the wire's rate and not the rate at which bytes were handed to the writer.
- Given a paste is cancelled or the port is lost while a write is in flight, when that write resolves, then no bytes are sent, no progress fires and the paste never reports `complete`.
- Given a port is reopened by any path including reconnect, when a paste runs, then the pacing matches the flow control the port was actually opened with.
- Given the pause is 0 and the payload is large, when the confirm quotes a duration, then the quote accounts for the wire rather than reporting ~1 s.
- Given a chunk size and pause, when throughput is displayed anywhere, then every surface renders the same number the same way.
- All acceptance criteria from previous rounds continue to hold.

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

### 2026-08-07 (later) — settings move to a modal; chip self-measures; 150 ms added

**Triggering evidence.** Ant timed both paths on real hardware: **59 s over RTS/CTS**, **148 s at chunk 1 / pause 200 ms**. The handshake settles at ~13.5 B/s, so the machine has roughly 2.5× the headroom our fixed 5 B/s assumes. Ant asked for a 150 ms pause option, for the pasting chip to show elapsed time and effective chars/sec, and for the paste settings to be grouped together.

**What was amended.** A 150 ms pause joins the offered set (≈6.7 B/s, between the 10 B/s that nearly worked and the 5 B/s that did). The paste chip gains elapsed time and achieved rate, measured from progress events rather than derived from settings. The three paste settings move out of the Settings menu into a **Paste settings modal**.

**Why a modal rather than the submenu Ant asked for.** `menu-bar.js` holds a single `openSubmenuPanel` (`:111`, and `:767` — "only one submenu open at a time"), so the menu bar supports exactly two levels and Settings ▸ Paste line ending ▸ CR already uses both. A Paste ▸ parent would need a third level: a submenu stack, reworked keyboard navigation and a changed Esc-collapses-one-level chain, all of which have tests pinning current behaviour. `#serial-config-modal` is the existing precedent for transport settings that outgrew the menu. Ant chose the modal with that constraint stated.

**Known-bad state avoided.** A third menu level rebuilt under time pressure in the keyboard-navigation code, and a fixed pause with no option between 100 and 200 ms when hardware says the answer is in that gap.

**KEEP — still binding.** Everything in the previous entries' KEEP lists. The radio-submenu constraint is **superseded for the paste settings only** — the crlf, theme, phosphor, font and cmdhistory-size submenus are untouched, and persist-≠-apply still governs every paste control.

### 2026-08-07 (round 3 review) — backpressure pulled back in; 20 patches

**Triggering findings.** Three reviewers audited `cc3bb01..4c3e4c1`. The acceptance audit confirmed the spec was satisfied — all 25 matrix rows, all 10 acceptance criteria, every constraint and all prior KEEP lists — so these are patches, not a loopback. But two findings cut at the chip Ant had just asked for: `pushTxBytes` never awaits `writer.ready`, so on an unpaced (flow-controlled) port the pump hands the payload to the stream in ~100 ms and the chip reports thousands of B/s for a transfer that takes 59 s. The readout is honest when paced and meaningless when not — and the unpaced case is precisely the one Ant had to time by hand.

**What was amended.** Backpressure moves from `deferred-work.md` into scope, at Ant's direction. The Ask-First clause that forbade it is replaced by a narrower one: `pushTxBytes` itself stays untouched, because keystrokes and SLIDE control bytes share it; the paste path gets its own awaitable entry point beside `writeSlideFrameAwaitable`. Three Always constraints and four matrix rows follow from it — progress counts accepted bytes, a write resolving after a cancel advances nothing, and the chip's rate is the wire's on every path.

**Why it was deferred and why that no longer holds.** It was carved out during planning because the reported bug reproduced without it. It does not reproduce without it any more: the chip is a feature Ant asked for, and it cannot tell the truth about a handshaking port while the write path is fire-and-forget.

**Known-bad state avoided.** A self-measuring readout that is wrong in exactly the state the user most wants measured, plus a progress bar that reaches 100 % over bytes still sitting in a browser buffer — or, on port loss, over bytes that will never leave.

**Retirements recorded (correcting an omission).** Two entry-1 KEEP items were dropped by later amendments without being named: *"Full-speed (0) as byte-for-byte restoration, pinned by `[32, 32, 16]` and `gapMs` 19"* and *"`config.spec.js` selecting Full speed before its baud assertions"*. Both belonged to the baud/rate model that entries 2 and 3 replaced. Equivalents exist and are stronger — `paste.spec.js` pins the unpaced shape as `[32×12, 16]`, and the dead-hook lesson now lives in "the hook serial.js pushes through is live". Recorded here so the retirement is deliberate rather than silent, as the CRLF-never-split rule was.

**KEEP — still binding.** Everything in the previous four entries' KEEP lists, minus the two retired above. Add: the flow-control bypass and its wired-and-tested hook; the modal projecting from the pump's live getters; measured-not-derived chip figures.

## Design Notes

Two independent controls, both physical:

- `pasteChunk` — bytes written back-to-back. Offered: 1, 2, 4, 8, 16, 32. Default **1**.
- `pastePauseMs` — idle time between chunks. Offered: 0, 5, 10, 20, 50, 100, **150**, 200. Default **200**.

Everything else follows: `writes = ceil(B / pasteChunk)`, `duration ≈ (writes - 1) × pastePauseMs`, `throughput ≈ pasteChunk / pastePauseMs × 1000`. The defaults are the measured working point on real hardware — one byte every 200 ms, ~5 B/s — chosen so a bare connection works out of the box rather than so a paste is quick.

Those defaults would make every paste glacial if they applied universally, so they do not: **when the open port's flow control is `hardware`, the pump runs unpaced** (a full 32-byte chunk, no pause), which is what the pre-fix pump did and what real hardware confirms works. Flow control unknown — no port ever opened — counts as `none`, because pacing a connection that does not need it costs time while not pacing one that does costs data.

**Why the previous model was wrong.** It made throughput the setting and derived the cadence, with an extra pause at line breaks on the theory that a full-screen editor redraws on newline. That theory was never evidenced, and it left chunk size pinned at 8 while the user varied a number that changed only the idle time. The measured ceiling is ~5–8 B/s, so every speed that model offered (60 B/s and up) was an order of magnitude too fast — which is why they all failed identically. Not a burst effect: simply a range that never reached the working point.

The 16C550's FIFO configuration on this machine remains unconfirmed, and no longer matters to this design: two chunk sizes at equal throughput behave the same, so the pump paces on rate and lets the user pick the burst.

**Measured on hardware, 2026-08-07.** The ~800 B block took **59 s over a handshaking port** and **148 s at chunk 1 / pause 200 ms**. The first figure means RTS/CTS settles at about **13.5 B/s** — the machine's real capacity, discovered by the handshake rather than guessed. The second matches the configured 5 B/s almost exactly, confirming the pacing does what it claims. The gap between them is the cost of a fixed rate chosen conservatively, which is why 150 ms (≈6.7 B/s) is now offered: 10 B/s nearly worked, and the handshake says there is headroom above 5.

This is also why the chip reports **achieved** rate rather than configured. Two numbers that should agree are worth showing side by side; the 59 s figure only exists because it was timed by hand.


Local echo needs its own copy of the bytes. The wire wants the configured terminator; the screen wants something the VT52 core renders as a new row, and `0x0D` alone is not that (`terminal.rs:364`).

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

**The two original defects**

- Start here: line breaks normalised in one scan, `\r\n` consumed as one break.
  [`paste-pump.js:630`](../../www/input/paste-pump.js#L630)

- The cadence: every chunk exactly the configured size, nothing reads byte content.
  [`paste-pump.js:479`](../../www/input/paste-pump.js#L479)

**Paced only where pacing is needed**

- Hardware handshaking beats anything the pump can do, so it stands aside.
  [`paste-pump.js:414`](../../www/input/paste-pump.js#L414)

- The pump's belief about the port; the hook that feeds it is proven by a failing test.
  [`paste-pump.js:342`](../../www/input/paste-pump.js#L342)

- Every successful open records its config, reconnects included — no asymmetry left to reason about.
  [`serial.js:1135`](../../www/transport/serial.js#L1135)

**Telling the truth about the wire**

- Paste gets its own awaitable write beside SLIDE's; `pushTxBytes` untouched.
  [`tx-sink.js:190`](../../www/input/tx-sink.js#L190)

- The generation token: a write resolving after a cancel advances nothing.
  [`paste-pump.js:264`](../../www/input/paste-pump.js#L264)

- Local echo needs its own bytes — bare CR moves the column, not the row.
  [`paste-pump.js:604`](../../www/input/paste-pump.js#L604)

**Surfaces**

- One rounding rule, so 6.7 B/s reads the same everywhere.
  [`paste-rate.js:19`](../../www/renderer/paste-rate.js#L19)

- The modal projects from the pump's live values, never the stored pref.
  [`paste-config.js:65`](../../www/renderer/paste-config.js#L65)

**Tests**

- Cancel mid-write, port loss, no writer, and the chip tracking a throttled writer.
  [`paste.spec.js:1`](../../www/tests/transport/paste.spec.js#L1)

- Every line-ending row of the matrix against real wire bytes.
  [`paste-line-ending.spec.js:1`](../../www/tests/input/paste-line-ending.spec.js#L1)
