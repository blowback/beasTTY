---
baseline_commit: d570904188906065f448a6de47e75734c138e5cb
---

# Story 11.1: Two tabs, two beasts — per-tab port identity

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast owner with two machines on one desk,
I want two Beastty tabs to each hold their own MicroBeast without fighting over the same one,
so that running both at once is ordinary rather than fiddly.

This is the **first** story of Epic E11 (Beast-to-Beast Drag Transfer) and the ground the feature stands on. S11.2 (`peer-link.js`) and S11.3 (the drag) both depend on it. It carries **no FRs** — it fixes three pre-existing defects the E11 design surfaced, in `www/transport/serial.js` only.

**Line numbers in this story are HEAD (`d570904`) line numbers and the working tree is clean.** `serial.js` was untouched by the last four commits, so every reference below is accurate as written.

## Scope boundary (read first)

**IN scope — three defects, one test fixture:**

1. **The boot scan cannot tell two identical adapters apart, and stashes one anyway** (`serial.js:237-249`). `ports.find()` returns the same first match in both tabs, and the only skip-the-picker open path (`:262`) then targets it.
2. **The boot recognition cue implies one specific recognised device** when more than one is attached (`status-bar.js:166`, fed by `showBootReady`).
3. **The in-use failure message tells the user to close the other tab** (`serial.js:491`) — the exact configuration E11 requires them to keep open. The classifier that produces it also probably never fires for the real cross-tab case (see Dev Notes §3 — verify before you trust it).
4. An **opt-in** two-identical-port fixture in `mock-serial.js`, plus specs, so the two-tab case is covered without hardware.

**OUT of scope — do NOT build here:**

- **Anything S11.2 or S11.3 owns.** No `peer-link.js`, no session id, no nonce, no `BroadcastChannel`, no drag, no drop target, no confirm modal, no new user-facing surface beyond the two strings named below.
- **Anything S11.4 owns.** It has landed (`42b1bb1` + `d570904`). Do not touch `slide.js` / `slide-recv.js` / the cancel machinery.
- **Any device-identity scheme.** `getInfo()` (`serial.js:45-46`) exposes only `usbVendorId` / `usbProductId`. There is no device path, no serial number, no stable id, and a `SerialPort` is not persistable across a reload. Do not invent a fingerprint, do not try to write a port handle to IndexedDB, do not add a "which beast is this" preference. The epic's whole design exists *because* this is impossible.
- **Adding a picker to the Connect click.** It is already there — see §1 below. Adding a second one is a regression.
- **Changing the D-25 reconnect ambiguity branch** (`serial.js:837-856`). It already refuses to guess between two matches and surfaces "Choose MicroBeast…". That is the precedent this story extends to boot time; reuse its shape, do not duplicate its code or alter its behaviour.
- **Rust/wasm, new dependencies, a new module, `index.html`, or any CSS.** None are needed. This story adds no DOM node and no style rule.
- **Widening `countMicroBeastAdapters()`'s role.** It stays exactly what it is: menu-bar's `>1` gate for "Choose MicroBeast…" (`main.js:525`, `menu-bar.js:1295-1302`). See §2 for why it is the wrong source for the boot cue.

## Three corrections to the epic (read before you plan)

The epic's Additional Requirements paragraph (`epics-beast-to-beast.md:85-88`) is right about the defects and imprecise about two mechanisms. Take these readings:

**(a) AC-2 is about auto-connect, not about the Connect click.** The epic's second AC says "When the user clicks Connect / Then the Chromium picker is shown rather than opening the claimed port directly." The picker is *already* shown on every Connect click: `connectMicroBeast()` (`:455-467`) calls `requestMicroBeastPort()` unless handed a `preselectedPort`, and the only caller that passes one is `chooseMicroBeast` (`main.js:539`), which ran its own picker a moment earlier. The epic says as much at `:85` ("Explicit Connect already works").

The **only** path that opens a port without a picker is the auto-connect branch at `serial.js:261-301`, gated on `prefs.autoConnect === true` (default `false`, `prefs.js:39`). So AC-2's real content is: *when the boot match is ambiguous, auto-connect must decline rather than open, and declining must not leave an error the user has to read past before clicking Connect.* Nothing about the click path changes.

**(b) The boot scan does not use the MicroBeast predicate.** `isMicroBeast()` (`:45-46`) is hardcoded to `10c4:ea60`. The boot scan at `:237-242` matches against the **stored preset** VID/PID (`:239-240`, falling back to the constants when nothing is stored) — which, after a "Show all serial devices" connect (`:446`) to a clone on FTDI/CH340, is *not* a CP2102N.

So `countMicroBeastAdapters()` and the boot scan can disagree: stored preset = FTDI, two FTDI adapters attached → the boot scan matches 2, `countMicroBeastAdapters()` returns 0, and a cue sourced from the latter reads **"0 MicroBeasts detected"**. **Derive the cue's count from the boot scan's own filter result**, in the same pass, and only show the multi-adapter variant when that count is > 1.

**(c) The in-use classifier probably never fires for the real cross-tab case.** `serial.js:490` keys the D-29 branch on `err.name === 'InvalidStateError'`. Per the Web Serial spec, `open()` rejects with `InvalidStateError` when *this page's* `SerialPort` object is already open — a same-page double-open. A second tab holds a **different** `SerialPort` object whose state is `closed`, so its `open()` proceeds past that check and fails at device acquisition, which the spec maps to **`NetworkError`** ("the attempt to open the port failed"). The existing spec at `errors.spec.js:83-100` forces `InvalidStateError` by hand, so it has never exercised the real shape.

Widen the classifier to cover the cross-tab shape as well as the same-page one, keep one message for both, and **verify it against two real tabs on real hardware** — that is this story's manual checkpoint (see AC-6). Do not assume; if the real rejection is neither name, record what it actually is and classify on that.

## Acceptance Criteria

**AC-1 — Ambiguous boot match is not stashed.**
**Given** the boot `getPorts()` scan finds more than one port matching the preset VID/PID
**When** `wireSerial` completes
**Then** `lastPortRef` is left null rather than pointing at an arbitrary first match
**And** with exactly one match the stash behaviour, and everything downstream of it, is unchanged.

**AC-2 — Auto-connect declines quietly on an ambiguous match.**
**Given** `prefs.autoConnect === true` and an ambiguous boot match
**When** the auto-connect branch runs
**Then** no port is opened, no retry is attempted, and **no entry is added to the error log and `lastConnectError` is not set**
**And** the user's subsequent Connect click goes through the existing picker and is honoured first time.
*(The "no error" half is load-bearing, not cosmetic: `status-bar.js:163-168` returns `lastConnectError` **before** it reaches the boot cue, so setting one hides AC-3's message entirely.)*

**AC-3 — The boot cue states the count when the match is ambiguous.**
**Given** the boot scan matched more than one port
**When** the status-bar readout renders while disconnected
**Then** it reads exactly `{n} MicroBeasts detected — click Connect to choose`, with `n` the boot scan's own match count
**And** with exactly one match it still reads `{device} — click Connect`, byte-for-byte as today.

**AC-4 — The single-adapter case does not regress.**
**Given** exactly one MicroBeast attached
**When** the app boots, auto-connects (pref on) or connects by click
**Then** behaviour, copy, and the D-05 / D-31 preset-and-restore flow are all unchanged — this is the common case and it must be provably untouched.

**AC-5 — The in-use message names both real fixes.**
**Given** a Connect attempt that fails because another Beastty tab holds the port
**When** the message renders
**Then** it reads exactly `That MicroBeast is already connected in another Beastty tab. Choose a different one, or disconnect it there first.`
**And** it never advises closing the other tab
**And** the same message is produced whether the rejection arrives as the same-page shape or the cross-tab shape (§(c)), and from the auto-connect path as well as the click path.

**AC-6 — The cross-tab rejection shape is verified, not assumed.**
**Given** two Chrome tabs, two MicroBeasts, and a port opened in tab A
**When** tab B is pointed at the same port
**Then** the actual `err.name` and `err.message` are recorded in the Debug Log
**And** the classifier in AC-5 keys on what was observed. If hardware is unavailable at implementation time, say so explicitly in the Completion Notes and carry it as a named open risk into S11.2 (E9 retro action #2).

**AC-7 — Two identical ports are simulable, and no existing spec changes meaning.**
**Given** the test suite
**When** it runs
**Then** a spec can pre-grant two ports with identical VID/PID through a new **opt-in** hook
**And** the default `mock-serial.js` behaviour — one port, `_grantedPorts[0]`, the `length - 1` targeting in `__simulateUnplug` / `__simulateReplug` / `__mockReaderPush` — is byte-for-byte unchanged (see Dev Notes §5: 30+ specs depend on it)
**And** each of AC-1..AC-5 has a spec that is shown failing before the fix and passing after.

**AC-8 — No new surface.**
**Given** the finished change
**When** it is reviewed
**Then** it has added no DOM node, no CSS rule, no preference, no module and no dependency; the two strings render through the existing `#port-status` and `#error-log`, both already `--chrome-*`-only and identical CRT↔Console
**And** the injected-dependency shape (AD-3) is preserved — `status-bar.js` still imports neither `serial.js` nor anything new, and any signal change travels through the existing `wireSerial` / `wireStatusBar` opts.

## Verbatim copy (do not paraphrase)

- Multi-adapter boot cue: `{n} MicroBeasts detected — click Connect to choose`
- In-use failure: `That MicroBeast is already connected in another Beastty tab. Choose a different one, or disconnect it there first.`

`n` is only ever ≥ 2 on this branch, so the plural is always correct — **do not write pluralisation logic**. The dash is an em-dash U+2014, matching the existing `{device} — click Connect` cue.

## Tasks / Subtasks

- [ ] **T1 — Boot scan: filter, don't find (AC-1, AC-3, AC-4)**
  - [ ] `serial.js:237-242`: `ports.find(...)` → `ports.filter(...)`, same predicate, same stored-preset fallback.
  - [ ] One match → `lastPortRef = matches[0]` and fire the cue as today. More than one → leave `lastPortRef` null and fire the cue with the count. Zero → unchanged (no cue).
  - [ ] Widen the `onBootDeviceRecognized` signal to carry the count. Keep it null-guarded and inert on a harness that omits it.
- [ ] **T2 — Auto-connect declines quietly (AC-2)**
  - [ ] Add an explicit ambiguous branch to `serial.js:261-301` that opens nothing, logs nothing, and does not set `lastConnectError`. It must not fall into the existing `else if (!lastPortRef)` arm, whose message ("no granted port found") is now false as well as noisy.
  - [ ] Leave the single-match and no-match arms exactly as they are.
- [ ] **T3 — Count-aware boot cue (AC-3, AC-4, AC-8)**
  - [ ] `main.js:1449`: pass the count through to `statusBar.showBootReady(...)`.
  - [ ] `status-bar.js:298-301` + `:161-168`: store the count alongside `bootDeviceReady`, render the multi variant when > 1, keep the existing single-match string and the existing "clear on `connected`, not on `connecting`" rule (`:132-136` — it exists for a reason; the cancelled-picker case).
  - [ ] Expose the count via the existing `__getStateForTests` snapshot (that is the sanctioned way to read it — no `window.__*` hook).
- [ ] **T4 — In-use message + classifier (AC-5, AC-6)**
  - [ ] Replace the `serial.js:491` literal with the verbatim string.
  - [ ] Lift the classifier out of `connectMicroBeast`'s catch into one small helper and call it from the auto-connect catch too, so both paths produce the same message from the same rules.
  - [ ] Widen it to the cross-tab rejection shape per §(c) — after T5's checkpoint tells you what that shape is.
  - [ ] `errors.spec.js:99` asserts `'another Beastty tab'`, which survives the rewording; confirm rather than assume, and add an assertion on the new advice.
- [ ] **T5 — Hardware checkpoint (AC-6)** — two tabs, two beasts, record the real `err.name` / `err.message`. Run this **before** finalising T4's classifier.
- [ ] **T6 — Fixture + specs (AC-7)**
  - [ ] `mock-serial.js`: an opt-in multi-port pre-grant hook alongside `__preGrantPort`, following its existing "flags set before the mock IIFE runs" convention (`auto-connect.spec.js:31-37`). Default path untouched.
  - [ ] Specs for AC-1..AC-5. Ambiguous-boot and auto-connect cases belong with `auto-connect.spec.js` (session project); the in-use classifier case belongs with `errors.spec.js` (transport project); the cue rendering belongs with `status-bar.spec.js` (render project). Each proven red first.

## Dev Notes

### 1. What `connectMicroBeast` actually does, so you don't "fix" the click path

`connectMicroBeast(configOverride, preselectedPort)` (`:455`) clears `lastConnectError`, sets `connecting`, and calls `requestMicroBeastPort()` (`:461`) — the CP2102N-filtered picker, or the unfiltered one when `prefs.showAllSerialDevices` is on (`:446-448`) — unless a `preselectedPort` was handed in. A cancelled picker lands silently back in `disconnected` (`:463-466`), which is correct and must stay silent.

The picker is never skipped on a click. The one skip-the-picker path in the whole module is `wireSerial`'s auto-connect branch (`:261-301`), and its target is `lastPortRef` — which is exactly why T1 and T2 are the same fix seen from two ends.

### 2. `lastPortRef` has four readers, not one

Leaving it null on an ambiguous match is the right call, but it is not a local change. Check each:

| Reader | Line | Effect when `lastPortRef` is null at boot |
|---|---|---|
| Auto-connect target | `:262` | **Intended.** The branch declines — this is AC-2. |
| `onNavSerialDisconnect` port-lost trigger | `:864` | Unplugging *either* adapter no longer drops this (still-disconnected) tab into `port-lost`. Correct: with two identical adapters and nothing open, the tab genuinely does not know which one was its own. |
| `onNavSerialConnect` D-25 identity preference | `:844` | Unreachable from here — that handler early-returns unless `state === 'port-lost'` (`:825`), which requires a prior successful connect, and `connectMicroBeast:506` / `finishReconnect:915` both set `lastPortRef` to the real port. Untouched. |
| `getConnectionDevice()` | `:595` | Returns null, so `status-bar.js:144` falls back to `MICROBEAST_DEVICE_LABEL`. Irrelevant on this branch — the multi-adapter cue does not interpolate the device label — but do not "fix" the fallback. |

### 3. The in-use classifier, precisely

`serial.js:489-496`:

```js
const msg = (err.message || '').toLowerCase();
if (err.name === 'InvalidStateError' && (msg.includes('in use') || msg.includes('already open'))) {
```

Two problems. The name is very likely wrong for the cross-tab case (§(c)) — and the `msg.includes` guard is a second gate on a browser-authored string, so even a correct name can fall through to the generic "Could not open port: …" if Chromium words it differently. Whatever T5 observes, keep the classification narrow enough not to swallow genuinely different failures (a wedged adapter, an unplugged device) but do not make it depend on a message substring you have not seen with your own eyes.

Note also that `NetworkError` already carries a *different* meaning one layer away: `handleReadError` (`:670-672`) treats it as permission-revoked. That is the read loop, not `open()`, so there is no conflict — but do not unify the two.

### 4. The error-log precedence trap

`status-bar.js:163-168` composes the disconnected readout in this order: `lastConnectError` (`:165`) → boot cue (`:166`) → `'Not connected'` (`:167`). So *any* error the auto-connect path logs on the ambiguous branch wins over AC-3's cue and the user reads a failure instead of an instruction. This is the single most likely way to implement T1/T3 correctly and still fail AC-3. Write the AC-2 and AC-3 specs so they would catch it.

Second-order: `appendErrorLog` also drives the amber "▲ N recent errors" affordance (`:743`) and the red-border Connect signal. A boot that logged nothing wrong must not light either.

### 5. The test fixture trap — read this before touching `mock-serial.js`

Thirty-plus specs index `navigator.serial._grantedPorts[0]` directly, and the three test hooks (`__simulateUnplug` `:152`, `__simulateReplug` `:168`, `__mockReaderPush` `:178`) all target `_grantedPorts[_grantedPorts.length - 1]`. With one port those are the same object; with two they are not.

Consequences:

- The second pre-granted port **must** be opt-in. Changing the default pre-grant count silently re-points every hook in the transport suite at a different port.
- Inside your own two-port specs, be explicit about which port you drive — `[0]` and "the last one" are now different, and a spec that mixes them will pass or fail for the wrong reason.
- `errors.spec.js:101-129` already builds two identical ports at runtime by reading the constructor off an existing port (`_grantedPorts[0].constructor`) and replacing the array. That is a working pattern for a mid-test swap; it is not a boot-time pre-grant, which is what AC-1/AC-2/AC-3 need, because the scan you are testing runs inside `wireSerial` during boot.

### 6. Where the specs go, and how they are run

Three Playwright projects, and the split matters:

- `www/playwright.config.js:33-52` — `chromium` covers `render/`, `input/`, `session/`; `chromium-transport` covers `transport/` and runs `fullyParallel: false`.
- **`npm test` runs `--project=chromium` only and does NOT run the transport suite.** Run both projects before you claim green. The baseline at `d570904` is 735 passed / 1 skipped for the full run.
- `retries: 1` is configured (`:27`). Prove a new spec red with `--retries=0`, or you will not know whether you proved anything.

### 7. Lessons from the prior stories that bind here

- **Prove the defect before claiming the repair** (E9 discipline; S11.4 §AC-7). Four of these five specs can pass against unfixed code if written loosely — especially AC-3's, which passes trivially if you assert only "some text is present".
- **A spec can pass for the wrong reason.** S11.4's clamp case passed twice before it was honest. If your AC-2 spec asserts "no error entry", make sure the boot it drives would actually have produced one before the fix.
- **Manual checkpoints run in the story that raises them** (E9 retro action #2, open). T5 is that checkpoint. One left open at story end is an explicit carried risk named in S11.2's plan, not a silent gap.
- **Report untruncated suite counts, flaky section included.** The known pre-existing flake is the wasm-boot starvation race (`window.__menuBar` undefined in `commonReset`); it is not yours, and it is not a reason to skip a diagnosis.

### Testing standards

- Playwright only; there is no unit-test runner in this repo. Specs load the real app (`page.goto('/')` → real `main.js` → real wasm).
- Boot-time state is set through `page.addInitScript` **before** `SERIAL_MOCK`, per `auto-connect.spec.js:31-44` — flags first, mock second, then `goto`. Order is not optional; the mock IIFE reads the flags as it installs.
- Read state with `expect.poll(() => page.evaluate(...), { timeout })` — never `waitForTimeout` + bare assert.
- Assert user-visible strings against the verbatim list, not against substrings that would also match the old copy.
- Spec titles carry the AC id and the user-visible symptom; the file header names the failure that motivated the spec and ends with the greppable claim "**so this spec wedges without `<the named fix>`**" (house style — `slide-sender.spec.js:180-190`).
- Tag `@fast` only where the case genuinely is.

### Project Structure Notes

- **UPDATE:** `www/transport/serial.js`, `www/renderer/status-bar.js`, `www/main.js` (one opt), `www/tests/transport/mock-serial.js`, `www/tests/transport/errors.spec.js`, `www/tests/session/auto-connect.spec.js`, `www/tests/render/status-bar.spec.js`.
- **NEW:** none required. Add a spec file only if the AC-1/AC-2 cases read badly inside `auto-connect.spec.js`; prefer extending it.
- **Explicitly NO changes:** `www/transport/slide.js`, `slide-recv.js`, `renderer/menu-bar.js`, `renderer/chrome.js`, `renderer/pull-pane.js`, `state/prefs.js`, `index.html`, any CSS, anything Rust/wasm.
- **API growth watch:** the sanctioned additions are exactly — one argument on the existing `onBootDeviceRecognized` signal and its `showBootReady` counterpart, one field in `status-bar.js`'s `__getStateForTests` snapshot, one opt-in hook in `mock-serial.js`, and one internal classifier helper in `serial.js`. Nothing else. No new export from `serial.js`, no `window.__*` hook.
- **Architecture compliance, honestly:** `ARCHITECTURE-SPINE.md:7` and `:233` put the serial state machine outside that document's scope, so most ADs are vacuous here. The three that genuinely bind: **AD-3** (`status-bar.js` must not import `serial.js`; the count arrives through the injected opt at `main.js:1449`), **AD-6** (the status bar is fed, never owns — keep the imperative-push shape), **AD-15** (`serial.js` writes no connection DOM; if you find yourself reaching for an element, you have gone wrong). AD-9/AD-10 are satisfied vacuously — no new control, no new style. Do not pad the implementation with compliance work for decisions that do not apply.
- **UX docs:** `EXPERIENCE.md:169` and `:272` document the *connected* readout, which this story does not change. The boot cue and the in-use message are not currently in either UX doc, so nothing there needs amending — and inventing a doc section for them is out of scope. S11.3 owns the E11 documentation amendments (UX-DR6).
- **Standing conventions:** story marked done in ALL places (`sprint-status.yaml` + front-matter + `last_updated`), verified by `scripts/check-story-done-consistency.py`; the `## Code Review` section is filled at write time, not backfilled (E8 retro action #1); the banned-vocabulary list applies to every new comment and to this story's text.
- **Commit style:** `fix: E11 S11.1 two tabs, two beasts — per-tab port identity`. The code-review pass is a separate commit carrying the finding count and suite total.
- **Open action items that bind here:** E9 #2 (manual checkpoint runs in the story that raises it) — yes, AC-6/T5. E9 #1 (bot-parity-first) — no, this story touches no SLIDE transport. E8 #3, E9 #3, E9 #4 — not this surface.

### References

- [Source: _bmad-output/planning-artifacts/epics-beast-to-beast.md — Story S11.1 :177-215; the two-tabs prerequisite :85-88; the identity paragraph :90; NFR-4 :77; out-of-scope record :94-97]
- [Source: www/transport/serial.js — boot scan :234-252; auto-connect :261-301; `isMicroBeast` :45-46; `requestMicroBeastPort` :444-450; `connectMicroBeast` :455-524; in-use classifier :489-496; `lastPortRef` writes :506, :915; `getConnectionDevice` :594-604; `countMicroBeastAdapters` :611-615; `appendErrorLog` :732-752; D-25 reconnect ambiguity :824-858]
- [Source: www/renderer/status-bar.js — `bootDeviceReady` :93-98; `projectConnection` clear-on-connected rule :126-134; `deviceLabel` :143-146; `composeText` :152-170 (disconnected precedence :163-168); `showBootReady` :298-301]
- [Source: www/main.js — `wireSerial` opts :1417-1455 (`onBootDeviceRecognized` :1449); `wireMenuBar` serial opts :515-545 (`getAdapterCount` :525, `chooseMicroBeast` :539); `wireStatusBar` opts :600-620]
- [Source: www/renderer/menu-bar.js — `refreshChooseMicroBeast` :1294-1302; `setChooseMicroBeastPresent` :1309-1320; `signalConnectLabel` :1532-1534]
- [Source: www/state/prefs.js — `autoConnect` default false :39; `showAllSerialDevices` default false :43; `CONN_STATUS_LABELS` :250-256; `MICROBEAST_DEVICE_LABEL` :263]
- [Source: www/tests/transport/mock-serial.js — hook contract :14-28; `_grantedPorts` :111-120; `__preGrantPort` :125-147; last-port targeting :152, :168, :178]
- [Source: www/tests/session/auto-connect.spec.js — init-script ordering :29-48; the four existing auto-connect branches :51-95]
- [Source: www/tests/transport/errors.spec.js — in-use case :83-100 (`'another Beastty tab'` assertion :99); runtime two-port construction :101-129]
- [Source: www/playwright.config.js — project split :33-52; `retries: 1` :27; www/package.json :7-11 (`npm test` excludes transport)]
- [Source: ARCHITECTURE-SPINE.md — AD-3 :80; AD-9 :110; AD-10 :116; AD-15 :150; scope :7 and Deferred :233 (serial machine out of scope)]
- [Source: WICG Serial spec + MDN `SerialPort.open()` — `InvalidStateError` when the port is already open (same-page state check); `NetworkError` when the open attempt fails. Basis for correction §(c); AC-6 verifies it against Chromium rather than trusting it.]
- [Source: _bmad-output/implementation-artifacts/e11-4-hidden-tab-never-invents-a-failure.md — prove-red-first discipline; honest suite counts; the "passes for the wrong reason" lesson]
- [Source: _bmad-output/implementation-artifacts/epic-e9-retro-2026-07-24.md — action #2 (manual checkpoints run in the story that raises them, open)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Code Review

_Fill on completion — findings count, what was fixed, what was skipped and why, suite totals._

## Change Log

| Date | Change |
|---|---|
| 2026-08-06 | Story created (ready-for-dev). Three corrections to the epic recorded: AC-2 is about the auto-connect path (the Connect click already shows the picker); the boot cue's count must come from the boot scan's own stored-preset filter, not `countMicroBeastAdapters()`; and the in-use classifier keys on `InvalidStateError`, which is the same-page shape, so the real cross-tab rejection is probably `NetworkError` and needs a hardware checkpoint (AC-6) before the classifier is finalised. |
