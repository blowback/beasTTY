---
baseline_commit: 034e5df29204997c8007d48780fd6b7ef1760a84
---

# Story 11.4: A hidden tab never invents a failure

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast daily driver,
I want a transfer that is running fine to keep running fine when I look at another tab,
so that "transfer failed" always means a transfer actually failed.

This is the **standalone** story of Epic E11 (Beast-to-Beast Drag Transfer). It depends on nothing and ships on its own — it repairs defects present in the code today. It must land before E11 ships, because it covers the tab hidden *mid*-transfer, which S11.3's request-time visibility check cannot.

**Zero UI. Zero user-facing strings. Zero wire-byte changes.** This story changes *how a wait is satisfied* and *when a hide cancels*, not what is sent on the wire.

## ⚠️ Read this before you start: line numbers are working-tree, not HEAD

The working tree at story-creation time carries a large uncommitted change set (the SLIDE.COM-location prefs rework: `slide.js` −239/+48, plus `main.js`, `prefs.js`, `slide-chip.js`, `index.html`, `pull-pane.js`, and a staged spec rename `slide-autosend-safety.spec.js → slide-program-location.spec.js`).

- **Every line number in this story is a working-tree line number.** At HEAD, `waitForSendState` is at `slide.js:1367`, not `:1176`.
- **No in-flight hunk touches anything this story edits.** The `slide.js` diff ends inside `enterSendModeProceed` (~line 1071); the `slide-recv.js` diff is +8 lines wiring an `onFolderChanged` callback. The cancel/wait machinery is untouched by both.
- **Do not rebase or land the in-flight work as part of this story.** Edit on top of it and expect line drift. If the working tree has changed since, re-locate by symbol name, not by line.

## Scope boundary (read first)

**IN scope:**

1. Convert `waitForSendState` (`slide.js:1176`) and `waitForState` (`slide-recv.js:683`) from a `setTimeout(tick, 10)` poll-against-a-deadline to **resolve-on-transition, driven by the inbound dispatcher**, with **one** real deadline retained.
2. Fix the recv-side handle-nulling defect that makes `waitForState` unable to succeed *at all* (see Dev Notes — this is a second, independent defect).
3. Narrow the tab-hide cancel trigger: `pagehide` still cancels, `visibilitychange → hidden` no longer does (**decision recorded 2026-08-05 — see "The cancel-on-hide decision"**).
4. The observability field + specs that prove each defect red before the fix and green after.
5. The dated AD-13 amendment and the `docs/architecture-www.md` update that record change 3.

**OUT of scope — do NOT build here:**

- **Any Rust/wasm change.** ADR-003's CORE-02 invariant forbids time logic in the core, and `tests/core_02_no_browser_deps.rs` enforces it. The fix is 100% JS shell. (E11 NFR-1.)
- **Any change to the four ADR-003 cancel windows: 200 / 500 / 100 / 2000 ms.** They are the ADR contract and the Z80's published budget. You are changing *how* the 500 ms is satisfied, never its value.
- **Any change to wire bytes or pacing.** `WIN_SIZE`, `windowAckOwed`, `sendCtrlSeqPending`, `FRAME_SIZE`, `INTER_FILE_HEADER_DELAY_MS`, `sendDispatchTail` — all untouched. If your diff touches one, you have gone wrong.
- **Defeating the timer clamp for the genuine delays.** `INTER_FILE_HEADER_DELAY_MS` (`slide.js:1430`), the 200 ms settle and the 100 ms drain are *minimums for the Z80*; a longer minimum is still a valid minimum. Let them stretch. The epic says so explicitly.
- **Anything E11 S11.1/S11.2/S11.3 owns** — no `peer-link.js`, no session id, no nonce, no drag, no BroadcastChannel, no UI.
- **Playwright `page.clock`.** It fakes `Date`, `performance.now`, `setTimeout` *and* `rAF` and pauses time until advanced — it would freeze the wasm boot and the mock-serial pump. Wrong tool. Use the targeted `setTimeout` shim in AC-7.
- **New dependencies, new modules, `main.js` changes.** None are needed.

## The cancel-on-hide decision (2026-08-05)

`chrome.js:227-230` currently cancels an active SLIDE session and writes a raw `CTRL_CAN` when `visibilitychange` reports hidden (Phase 11 Plan 11-04 D-13 / SLIDE-31). `isSlideActiveRef` is `slide-recv.js`'s recv-only `isSlideActive`, so **this fires on receives, not sends.**

That behaviour makes FR-15's second AC unreachable: hiding the tab does not merely risk a false failure report, it *deliberately destroys the transfer*. Fixing the poll alone would not deliver the story.

**Decision:** split the trigger.

- `pagehide` keeps the cancel + `CTRL_CAN` **unchanged** — the page is actually going away, which is the case D-13's rationale (`chrome.js:214-227`: "the browser may not flush the wire before the tab closes") actually argues for.
- `visibilitychange → hidden` **no longer cancels**. Selecting a third tab in Split View leaves the transfer running.

This narrows an incumbent behaviour that AD-13 (`ARCHITECTURE-SPINE.md:139-142`) names as one that must not be silently lost — so it is recorded as a **dated AD-13 amendment**, not a silent edit (AC-6). Losing it silently is what AD-13 forbids; narrowing it deliberately with the reason written down is not.

## Acceptance Criteria

1. **The send wait resolves on the transition (FR-15).** `waitForSendState` (`slide.js:1176`) no longer calls `setTimeout(tick, 10)`. It keeps its exact signature `(targetState, timeoutMs) → Promise<boolean>`, still resolves `true`/`false` and never rejects, and still performs its **synchronous first check** before arming anything (the CAN echo can already have been fed during the `await drainSlideOutboundAwaitable()` at `slide.js:1253` — losing this check reintroduces a race the current code handles). The pending wait is settled by a notification raised from the inbound byte dispatcher, plus **one** `setTimeout(timeoutMs)` deadline. Clearing the deadline on transition-resolve is required — a leaked timer would outlive the session.

2. **The receive wait resolves on the transition, and can succeed at all (FR-15).** `waitForState` (`slide-recv.js:683`) is converted the same way. **The notification must carry the transitioned-to state value as an argument; the waiter must not re-read `slideRef.state()` to decide.** This is not a style preference — it is the fix for the second defect (Dev Notes §1): `slideRef` is nulled *at* the transition, so any waiter that reads it can never observe `STATE_DONE`. After this change, a bot that echoes `CTRL_CAN` must produce `echoArrived === true` on an ordinary unclamped clock, which it never does today.

3. **The deadline stretches, it does not poll (FR-15).** Exactly one `setTimeout` per wait, armed once, for `timeoutMs`. Under a clamped clock it fires *late*, never early — which is the safe direction and the whole reason the epic prescribes this shape. No chained timers, no re-arming, no `setInterval`.

4. **The no-echo path is unchanged (ADR-003 §3).** When no echo arrives, the wait still resolves `false` only after the full `500 ms`, Step 4's `100 ms` drain still runs *after* resolution in both branches, and Step 5 still calls `force_idle()`. `slide-cancel.spec.js:117-137` asserts `elapsed >= 600` on exactly this path and **must stay green** — do not resolve early on `STATE_ERROR` or on any terminal state other than the requested `targetState`.

5. **Notification comes from the inbound dispatcher only.** The transition notify is raised from the byte-walk in `dispatchSendMode` / `dispatchRecvMode`. It is **not** raised from the local `force_idle()` calls in the cancel sequences (`slide.js:1241/1260/1268`, `slide-recv.js:631/652/659`) — those are the escape hatch, and reporting them as "the Z80 echoed" would be a lie. A pending waiter must still be settled `false` when the session is torn down under it (`forceExitSendMode` nulls `slide` at `slide.js:1212`), rather than left hanging to its deadline.

6. **Tab-hide no longer cancels; pagehide still does (FR-15).** The SLIDE branch is removed from the `visibilitychange` listener (`chrome.js:227-230`) and kept verbatim in the `pagehide` listener (`chrome.js:240-245`). The rest of the `visibilitychange` listener — the BEL `(!) ` title strip and the `requestFrame()` catch-up repaint (`chrome.js:210-213`) — is **untouched**. Recorded as a dated `[E11 2026-08-05]` amendment on AD-13 in `ARCHITECTURE-SPINE.md` and in `docs/architecture-www.md` (which documents the branch at `:42`), each naming the reason: Split View makes "hidden" an ordinary state during a transfer, and teardown protection belongs on `pagehide`.

7. **Each converted wait has a spec proven red before the fix and green after (E9 discipline).** New file `www/tests/transport/slide-hidden-tab-clamp.spec.js` (new file, not an addition to `slide-cancel.spec.js` / `slide-sender.spec.js` — both carry unstaged edits). Required coverage:
   - (a) **recv, ordinary clock** — bot echoes `CTRL_CAN`; `echoArrived` must be `true`. *Red today* (defect 1: `slideRef` nulled at the transition).
   - (b) **recv, clamped clock** — same, with the `setTimeout` floor shim installed immediately before the cancel; `echoArrived` must be `true` and the `[slide-recv] cancel absolute timeout (2s); force_idle` console warning must **not** appear. *Red today* (defect 2).
   - (c) **send, clamped clock** — cancel an active send with the shim installed; `echoArrived` must be `true` and `[slide.js] send-cancel absolute timeout (2s); force_idle` must not appear. *Red today.*
   - (d) **no-echo still burns the full budget** — `__mockSlideBot.send.injectNoEchoOnCancel = true`, ordinary clock; `echoArrived === false` and elapsed `>= 600 ms`. Guards AC-4.
   - (e) **hide does not cancel** — dispatch `visibilitychange` while a recv session is active; no `CTRL_CAN` on the wire, `mode` stays `'recv'`. Guards AC-6.
   The clamp shim, verbatim (install via `page.evaluate` right before the cancel, **not** `addInitScript` — the boot, connect handshake and bot pump must stay on real timers):
   ```js
   await page.evaluate(() => {
       const real = window.setTimeout.bind(window);
       window.__restoreTimerClamp = () => { window.setTimeout = real; };
       window.setTimeout = (fn, ms, ...rest) => real(fn, Math.max(ms | 0, 1000), ...rest);
   });
   ```
   Prove red with `--retries=0` (the ratified `retries: 1` would otherwise mask a marginal timing failure).

8. **Sanctioned API growth — exactly one field per module.** `__getStateForTests()` gains `lastCancelEchoArrived` (`true | false | null`) in **both** `slide.js:483` and `slide-recv.js:810`, set at the Step 3 call sites and reset to `null` by `__resetForTests()` on each side. Nothing else is added to either snapshot, no new `window.__*` hook, no new export beyond the single recv notify function AC-2 requires. `isSendActive()` and `isSlideActive()` keep their current shapes.

9. **Existing suites pass unchanged (NFR-1).** `slide-cancel.spec.js` (the ADR-003 pinning spec, all 6), `slide-sender.spec.js`, `slide-recv*.spec.js`, `slide-bridge.spec.js` all green. **One deliberate exception:** `slide-bridge.spec.js:185` ("visibilitychange hidden emits single-byte CTRL_CAN when active") asserts the behaviour AC-6 removes and **must be inverted** — retitled and rewritten to assert that hide does *not* emit, with a comment citing this story and the decision. `:210` (pagehide emits) and `:226` (idle does not emit) stay exactly as they are.

10. **Bot parity confirmed before the specs are trusted (E9 retro action #1, still open).** The ~500 ms echo budget and the echo-then-console-text shape are checked against `/home/ant/src/microbeast/SLIDE/slide.asm` — §2 header (`:19-21`) and `respond_to_cancel` (`:407-421`) — and the finding recorded in Completion Notes. This action item binds this story: it is transport, and `slide.asm` is the parity anchor.

11. **Timing, pacing and wire behaviour are indistinguishable in a visible tab.** A transfer in a visible tab sends the same bytes in the same order with the same cadence as before. Verify by running the full transport project and confirming the round-trip specs' byte-equality assertions still hold.

## Tasks / Subtasks

- [ ] **T1 — Observability first, so the red run is honest (AC: 8)**
  - [ ] Add `lastCancelEchoArrived` to both `__getStateForTests()` snapshots, recording the existing `echoArrived` value at `slide.js:1255` and `slide-recv.js:647`. Reset to `null` in both `__resetForTests()`.
  - [ ] **This is instrumentation only — do not touch the wait helpers yet.** Landing it first is what makes T2's red run a genuine behavioural failure rather than "the field does not exist".
- [ ] **T2 — Write the specs, prove them red (AC: 7)**
  - [ ] New `www/tests/transport/slide-hidden-tab-clamp.spec.js`, cases (a)–(e), house `beforeEach` copied verbatim from `slide-cancel.spec.js:13-34`.
  - [ ] Run with `--retries=0`. Record which cases are red and the exact failure output — (a), (b), (c) and (e) must be red now; (d) must already be green.
- [ ] **T3 — Convert the receive wait (AC: 2, 3, 4, 5)**
  - [ ] Add a named export to `slide-recv.js` that accepts the transitioned-to state value and settles a pending waiter. Import it in `slide.js` alongside the existing `onRecvEvent` / `setSlideRef` / `isSlideActive` imports (`slide.js:46`) — no `main.js` change.
  - [ ] Call it from `dispatchRecvMode`'s byte-walk **after** `slide.feed_byte(b)` / `stAfter` (`slide.js:772-777`) and **before** `maybeExitRecvMode()` (`slide.js:783`) — passing `stAfter`.
  - [ ] Rewrite `waitForState`: synchronous first check, then `Promise.race`-style settle against one `delay(timeoutMs)`. Reuse the existing `delay` (`slide-recv.js:601`).
  - [ ] Clear the pending waiter in `forceExitRecvMode` and `__resetForTests` so it cannot leak across sessions or specs.
- [ ] **T4 — Convert the send wait (AC: 1, 3, 4, 5)**
  - [ ] Module-scope waiter in `slide.js`; notify after the `dispatchSendMode` byte-walk (`slide.js:1371-1405`), before the drains. Same module, so no new export.
  - [ ] Rewrite `waitForSendState` to the same shape. Reuse `sendCancelDelay` (`slide.js:1172`).
  - [ ] Settle any pending waiter `false` in `forceExitSendMode` (which nulls `slide` at `:1212`) and clear in `__resetForTests`.
  - [ ] Keep the two helpers **symmetric twins** — they were created as mirrors (`728cbfe`) and are documented as such at `slide.js:1188-1190` and `slide-recv.js:704-707`.
- [ ] **T5 — Narrow the hide trigger (AC: 6, 9)**
  - [ ] Remove the SLIDE branch from `chrome.js`'s `visibilitychange` listener (`:227-230`); leave `:210-213` and the whole `pagehide` listener alone.
  - [ ] Invert `slide-bridge.spec.js:185`; leave `:210` and `:226` untouched.
- [ ] **T6 — Green run + docs (AC: 7, 9, 10, 11)**
  - [ ] Re-run the new spec file: all five green. Then the full transport project, then the full suite.
  - [ ] Dated `[E11 2026-08-05]` AD-13 amendment in `ARCHITECTURE-SPINE.md`; matching update to `docs/architecture-www.md:42`.
  - [ ] Record the `slide.asm` parity check in Completion Notes.

## Dev Notes

### 1. The receive wait has TWO defects, and the epic only names one

The epic's Additional Requirements paragraph names the poll. There is a second, independent defect underneath it, and it is the more severe of the two: **`waitForState` can never resolve `true` in production, clamped clock or not.**

The chain, all synchronous inside one Web Serial read-loop callback:

```
serial.js:632  dispatchInbound(value)
slide.js:772     slide.feed_byte(b)          ← CAN echo fed; Rust SM CancelPending → Done
slide.js:773     const stAfter = slide.state()
slide.js:774-777 if (stAfter === STATE_DONE || …) { recvDoneAt = i; break; }
slide.js:782     drainEventsAndOutbound()
slide.js:783     maybeExitRecvMode()
slide.js:829-835   → st === STATE_DONE → exitRecvMode()
slide.js:890         → setSlideRecvRef(null)   ← slideRef is now null
```

`waitForState`'s guard is `if (slideRef && slideRef.state() === targetState)`. No `setTimeout(tick, 10)` can interleave with a synchronous block, so by the time the first scheduled tick runs, `slideRef` is already `null` and the guard is false forever. The wait burns its full 500 ms and resolves `false` on **every** cancel, and Step 5's `force_idle()` is then skipped anyway by its own `slideRef &&` guard.

**This is why AC-2 requires the notification to carry the state value.** A notifier that merely says "something changed, go look" inherits the bug. Pass `stAfter`.

The send side does **not** have this defect: `exitSendMode` deliberately leaves `slide` non-null (`slide.js:1276-1303`), so `waitForSendState` can genuinely observe `Done`. Only `forceExitSendMode` nulls it, and that runs after the wait.

### 2. The clamp mechanism — be precise, the loose version is wrong

The state check precedes the deadline check:

```js
const tick = () => {
    if (slide && slide.state() === targetState) return resolve(true);   // state FIRST
    if (now() - start >= timeoutMs) return resolve(false);
    setTimeout(tick, 10);
};
```

So a late tick that *does* find `Done` still resolves `true`. The damage is not "the deadline pre-empts the check" — it is that **the poll collapses to one or two samples**:

- `tick()` runs synchronously at t≈0. The `CTRL_CAN` was written microseconds earlier, so the echo cannot have arrived. Correct `false`; it schedules.
- Chrome floors a hidden tab's chained `setTimeout` at ~1000 ms while `performance.now()` keeps real time. The next tick lands at t≈1000, where `elapsed >= 500` — and the Z80's entire published ~500 ms echo budget was never sampled.
- Under *intensive* throttling (hidden > 5 min, chain depth ≥ 5 — which a poll loop is by construction) timers align to ~1-minute buckets, and the 2000 ms absolute timeout can fire first, force-idling a healthy session.

A **single, non-chained** `setTimeout(2000)` is only floored, never shortened — clamping makes it fire late, which is harmless. That asymmetry is exactly why "one deadline, not a polled one" is the correct shape.

### 3. Where the transition happens, and why you cannot use the event drain

**ADR-003 §4 is the trap:** while the SM is in `CancelPending`, `feed_byte`/`feed_chunk` *silently consume* incoming bytes and **emit no events at all** until the CAN echo is recognised. So the echo produces no `EVT_*`. `slide.js:806` filters `onRecvEvent` down to three event kinds anyway. **The notify must hang off the post-feed point, not off `drainEventsAndOutbound`.**

- **Recv:** transition at `slide.js:772`, observable at `:773` as `stAfter`. Notify between `:777` and `:783`.
- **Send:** transitions in `dispatchSendMode`'s byte-walk — the RDY/FIN/**CAN**/SOF feed at `slide.js:1397`. Notify after the walk (`:1405`), before the drains at `:1406-1408`.

`dispatchSendMode` is async and FIFO-serialized through `sendDispatchTail` (`slide.js:217-225`) — a depth-1 chain that exists specifically to stop a double pump+drain. A notification that resolves a promise is safe inside it (it settles on a microtask, no re-entrancy), but **do not `await` anything new in that path.**

### 4. What the codebase gives you (verified shapes, working tree @ 034e5df + uncommitted)

- **`slide.js`** — `STATE_*` mirror `:111-118` (`STATE_DONE = 6`); `dispatchInbound` `:422-443`; `dispatchRecvMode` `:669-791`; `maybeExitRecvMode` `:829-835`; `exitRecvMode` `:863-895` (nulls the recv ref at `:890`); event filter `:806`; cancel constants `:1154-1157` (200/500/100/2000); `sendCancelDelay` `:1172`; **`waitForSendState` `:1176-1187`**; `forceExitSendMode` `:1189-1222` (`slide = null` at `:1212`); `cancelSlideSend` `:1224-1274` (Step 3 at **`:1255`**); `exitSendMode` `:1276-1303` (leaves `slide` non-null); `dispatchSendMode` `:1315-1419` (byte-walk `:1371-1405`, CAN feed `:1397`, drains `:1406-1408`, `maybeExitSendMode` `:1409`); `INTER_FILE_HEADER_DELAY_MS` `:1430`; `sleepMs` `:1432`; `__resetForTests` `:457-476`; `isSendActive` `:480`; `__getStateForTests` `:483-544`.
- **`slide-recv.js`** — `STATE_DONE` `:54`; `CANCEL_ECHO_WAIT_MS` `:61`; `setSlideRef` `:354`; `isSlideActive` `:381-389` (recv-only, `state()` wrapped in try/catch per WR-02); `delay` `:601-603`; `cancelSlideRecv` `:623-664` (Step 3 at **`:647`**); **`waitForState` `:683-697`**; `forceExitRecvMode` `:704`; `__resetForTests` `:793`; `__getStateForTests` `:810-823`.
- **`chrome.js`** — `visibilitychange` listener `:209-231` (title strip + repaint `:210-213`, SLIDE branch **`:227-230`**); `pagehide` listener `:240-245`; the D-13 rationale comment `:214-227`.
- **`main.js`** — `window.__slide` / `window.__slideRecv` hooks `:1281-1297`; `isSlideActive` wired to `wireChrome` at `:458`.
- **Bot (`tests/transport/mock-serial-slide-bot.js`)** — `setRole('send')` makes the bot the Z80 sender (page receives); `send.injectNoEchoOnCancel` withholds the echo; `send.pauseAfterFirstWindow` parks the receiver mid-`DataPhase`; `setStallAfterAcks(n)` wedges a send. Reuse `enterMidStream()` from `slide-cancel.spec.js:41-60` for the recv cases.
- **Suite reality** — two Playwright projects. **`npm test` pins `--project=chromium` and therefore does NOT run the transport suite.** Use `npx playwright test --project=chromium-transport` (196 tests / 26 files, `fullyParallel: false`) and `npx playwright test` for everything (724 tests / 81 files at story-creation time — this is the real baseline; the "513" in sprint-status describes the `chromium` project alone).

### 5. Timing invariants you must not disturb

| Invariant | Where | Why it matters |
|---|---|---|
| Window-aligned burst pump, `WIN_SIZE = 4` | `slide.js:279-284`, `:1564-1611` | The e9-4 fix. Reverting to one-frame-per-dispatch reinstates the retry-NAK crutch (4–5× slow) and the desync that turned seq 24 (`0x18`) into a spurious CAN. |
| `windowAckOwed` latch | `slide.js:1113-1118`, `:1449-1454`, `:1597` | e9-4 code-review #1. A split ACK's lone control byte, console text or line noise must never pump the next window early — that uncovers the Z80's disk-flush deaf window. |
| `sendCtrlSeqPending` cross-chunk carry | `slide.js:1160-1170`, `:1372-1395` | UAT-E9-03. A lone ACK/NAK at a chunk boundary owes its seq byte to the next chunk; it must be fed unconditionally, never classified. |
| `INTER_FILE_HEADER_DELAY_MS = 500` | `slide.js:1430` | Covers the Z80's deaf `close_file` window (16-byte UART FIFO < header frame). A **minimum** — let it stretch. |
| 200 / 500 / 100 / 2000 ms | `slide.js:1154-1157` + recv twins | ADR-003 §3 contract; `slide.asm` §2 publishes the ~500 ms echo. |
| `slide.free()` before dropping the ref | `slide.js:1204-1213` | Skipping it leaks the wasm struct and a stale cached `outboundView` can put a leading `CTRL_CAN` on the wire. |
| Focus restore to `wrapperEl` in both `forceExit*` | `slide.js:1215-1221`, `slide-recv.js:704+` | Phase 12 UAT Niggle 1. |

### 6. Lessons from the prior transport stories

- **Read the Z80 source before patching a symptom.** E9 retro §2: the UAT-E9-03 retest failed identically after round one; reading the real `slide.asm` surfaced the true defect. AC-10 makes that a step here, not a suggestion.
- **Recv-only predicates leak into send paths.** It has happened twice — `keyboard.js`'s Esc chain (fixed in e9-4) and `chrome.js`'s `isSlideActiveRef` (still recv-only, and the reason AC-6 only affects receives). Check any predicate you touch.
- **The bot can flatter you.** Per-frame ACKing masked a real defect for months (E9 retro §3). Confirm a knob against `slide.asm` before trusting what it proves.
- **Report untruncated suite counts**, including the flaky section — e9-4 records why `tail -8` produced wrong numbers.

### Testing standards

- Playwright only; there is no unit-test runner in this repo. Specs load the real app (`page.goto('/')` → real `main.js` → real wasm) and cross via `page.evaluate` against `window.__slide` / `window.__slideRecv`.
- Read state with `expect.poll(() => page.evaluate(...), { timeout })` — never `waitForTimeout` + bare assert.
- Console assertions use the `slide-recv-reentry.spec.js:48-51` pattern (`page.on('console', …)` collecting warnings).
- Spec titles carry the requirement id and the user-visible symptom; a header comment names the failure that motivated the spec and ends with the greppable claim "**so this spec wedges without `<the named fix>`**" (house style — `slide-sender.spec.js:180-190`).
- Tag `@fast` only if the case is genuinely quick; the clamped cases are not.

### Project Structure Notes

- **UPDATE:** `www/transport/slide.js`, `www/transport/slide-recv.js`, `www/renderer/chrome.js`, `www/tests/transport/slide-bridge.spec.js`, `_bmad-output/planning-artifacts/architecture/architecture-beastty-2026-07-01/ARCHITECTURE-SPINE.md`, `docs/architecture-www.md`.
- **NEW:** `www/tests/transport/slide-hidden-tab-clamp.spec.js`.
- **Explicitly NO changes:** `www/main.js`, `input/*`, `renderer/canvas.js`, `renderer/pull-pane.js`, `state/prefs.js`, `index.html`, anything Rust/wasm, any UX doc (this story has no UX surface and no user-facing strings).
- **API growth watch:** the sanctioned additions are exactly `lastCancelEchoArrived` in each of the two `__getStateForTests()` snapshots, plus the one named recv notify export AC-2 requires. Nothing else.
- **Architecture compliance, honestly:** AD-13 is the only architecture decision that binds this story, and AC-6 amends it deliberately with a dated note. `ARCHITECTURE-SPINE.md:7` and `:233` put the SLIDE protocol and serial state machine outside that document's scope entirely, so **AD-1..AD-12 and AD-14..AD-16 do not apply** — no UI, no CSS, no tokens, no focus, no modal, no injected dependency. E11's NFR-4 restates AD-3/AD-9/AD-10 generically; they are satisfied vacuously here and should not be padded into the implementation.
- **Standing conventions:** story done in ALL places via `scripts/check-story-done-consistency.py`; the `## Code Review` section is filled at write time (E8 retro action #1 — no more backfills); banned-vocabulary list applies to all new comments and to this story's text.
- **Commit style:** `feat: E11 S11.4 hidden tab never invents a failure — resolve-on-transition waits; hide no longer cancels`. The code-review pass is a separate `chore:` commit carrying the finding count and suite total.
- **Open action items that bind here:** E9 #1 (bot-parity-first) — yes, see AC-10. E9 #4 (record wire-speed reference throughput in transport docs) — adjacent but not this story. E8 #3 (`light-ready()` spec pattern doc) and E9 #3 (latent-stub sweep) — not this surface.

### References

- [Source: _bmad-output/planning-artifacts/epics-beast-to-beast.md — Story S11.4 :356-389; FR-15 :70; NFR-1 :74; the hidden-tab prerequisite paragraph :89]
- [Source: .planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md — §3 (JS owns the 200/500/100/2000 windows; Rust purely event-driven), §4 (CancelPending emits NO events), Consequences (CORE-02 invariant, `tests/core_02_no_browser_deps.rs`)]
- [Source: /home/ant/src/microbeast/SLIDE/slide.asm — §2 header :19-21 ("the other side echoes CTRL_CAN back within ~500 ms"); `respond_to_cancel` :407-421; `msg_cancelled` :1979; `WIN_SIZE`/`FRAME_SIZE`/`FLUSH_SIZE` :47-57]
- [Source: docs/SLIDE_Z80_REQUIREMENT.md — §2 :54 (the ~500 ms echo requirement), :67-70 (`force_idle` fallback), :163 (2 s behaviour against stock slide.com)]
- [Source: ARCHITECTURE-SPINE.md — AD-13 :139-142 (binding); scope :7 and Deferred :233 (SLIDE/serial explicitly out of scope); Tests convention :169]
- [Source: www/transport/slide.js — line refs in Dev Notes §4, working tree]
- [Source: www/transport/slide-recv.js — line refs in Dev Notes §4, working tree]
- [Source: www/renderer/chrome.js — :209-231, :240-245]
- [Source: www/tests/transport/slide-cancel.spec.js — :13-34 (house beforeEach), :41-60 (`enterMidStream`), :102-114, :117-137 (the `>= 600` lower bound AC-4 protects)]
- [Source: www/tests/transport/slide-bridge.spec.js — :185 (invert), :210, :226 (leave)]
- [Source: www/playwright.config.js — :20-30 (flake rationale), :42-51 (`chromium-transport`, `fullyParallel: false`); www/package.json (`npm test` excludes transport)]
- [Source: _bmad-output/implementation-artifacts/e9-4-reverse-drag-pane-to-terminal.md — window-ACK pacing latch, split-ACK carry, recv-only-predicate lesson, honest-suite-count lesson]
- [Source: _bmad-output/implementation-artifacts/epic-e9-retro-2026-07-24.md — action #1 bot-parity-first (open); §2 read-the-Z80-source; §3 the bot can flatter you]
- [Source: developer.chrome.com/blog/timer-throttling-in-chrome-88 — hidden-tab clamp to ~1/s; intensive throttling at >5 min hidden with chain depth ≥ 5]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Code Review

## Change Log

- 2026-08-05 — Story created (bmad-create-story). Analysis surfaced two defects beyond the one the epic names: (1) `waitForState` reads `slideRef`, which `exitRecvMode` nulls at the transition, so it can never resolve `true` on any clock; (2) `chrome.js:227-230` deliberately cancels an active receive on tab-hide (D-13 / SLIDE-31), which made FR-15's second AC unreachable by a poll fix alone. Decision taken with Ant: split the trigger — `pagehide` keeps the cancel, `visibilitychange → hidden` drops it — recorded as a dated AD-13 amendment. Also corrected the epic's reach claim: both helpers have exactly one call site each (the ADR-003 cancel sequence), so the defect affects every *cancel*, not every send. Status: ready-for-dev.
