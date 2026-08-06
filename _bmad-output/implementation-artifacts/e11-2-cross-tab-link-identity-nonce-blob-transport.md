---
baseline_commit: 9118b21ed2f7a6ca62987d7c6e9c47a8919a1cd8
---

# Story 11.2: The cross-tab link — identity, authorisation, blob transport

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Beastty developer,
I want one small module that lets two tabs of the same app identify each other, authorise exactly one file request, and hand over bytes,
so that the drag in S11.3 is wiring rather than invention, and the trust rules are testable on their own.

This is the **second** story of Epic E11. S11.1 is done (`9118b21`); S11.4 is done (`42b1bb1` + `d570904`). S11.3 — the drag itself — depends entirely on this module's contract, so **every name, message shape and reason code decided here is what S11.3 will be written against.**

**Line numbers in this story are HEAD (`9118b21`) line numbers and the working tree is clean.**

## Scope boundary (read first)

**IN scope:**

1. **One new module, `www/transport/peer-link.js`** — channel wiring, message envelope, per-tab session identity, the single-use nonce table, the self-status checks, the closed set of refusal codes, and the blob handover. No DOM, no user-facing copy.
2. **One `wirePeerLink(opts)` call in `main.js`**, all dependencies injected, plus the `window.__peerLink` test hook.
3. **One `isBound()` addition to the pull pane's returned API** — the "has this tab got a pull folder?" fact has no public getter today (§6).
4. **A two-page Playwright harness**, which does not exist in any form today (§7), plus single-page unit coverage of the pure rules.
5. **A comment correction in `serial.js`** — `serial.js:537` currently promises that this story answers "is another Beastty tab holding this port?". It does not, and §3(e) records why. The dangling promise is corrected, the copy is not.
6. **Two doc rows** — `docs/architecture-www.md` §transport and `docs/component-inventory-www.md` §transport.

**OUT of scope — do NOT build here:**

- **Anything S11.3 owns.** No `dragstart` stamping, no `dataTransfer` type, no drop target, no confirm modal, no orchestration of pull-then-send, no calls to `beginReview` / `sendFiles` / `enterSendMode`, and **no user-facing strings whatsoever**. This module produces reason *codes*; S11.3 owns the *words* (UX-DR7 fixes them verbatim in S11.3's list, `epics-beast-to-beast.md:341-354`).
- **Changing the in-use message** (`PORT_IN_USE_MSG`, `serial.js:553`). It is a verbatim AC of S11.1 and §3(e) explains why this module cannot honestly narrow it. The comment above it is corrected; the string is not touched.
- **Any device-identity scheme.** Unchanged from S11.1: `getInfo()` (`serial.js:45-46`) exposes only `usbVendorId` / `usbProductId`. A session id identifies a **tab**, never a beast.
- **Any change to `slide.js` / `slide-recv.js` / the SLIDE protocol / Rust / wasm.** NFR-1. This module never touches the wire.
- **Any persistent surface.** No pane, no peer list, no nicknames, no preference, no DOM node, no CSS rule (UX-DR5).
- **A presence/heartbeat protocol.** No periodic "who's there" broadcast, no peer roster refresh timer. FR-14 requires the link to be inert with one tab open, and a heartbeat is the most obvious way to fail it.
- **Chunking.** FR-7 is explicit: whole files, no chunking in v1.
- **Supporting more than two beasts.** Addressing is by session id, so a third tab is harmless, but no code exists to choose *between* peers and none should be written.

## Corrections to the epic (read before you plan)

The epic's S11.2 section (`epics-beast-to-beast.md:217-263`) is right about the shape and imprecise about four mechanisms. Take these readings.

### (a) "posts them to B as Blobs" — a bare `Blob` does not survive the destination, and it fails *quietly*

`sendFiles` (`file-source.js:382`) duck-types its argument: `processFiles` reads `f.name` (`:403`) and awaits `f.arrayBuffer()` (`:410`). It never does `instanceof File`.

A bare `Blob` has no `.name`, so `validateCpmFilename(undefined)` returns `{ ok: false, reason: 'empty filename' }` (`file-source.js:664`) — it does **not** throw. Every file lands in the *rejected* rows, and the user gets a confirm modal offering "Send 0 files" (`file-source.js:580-588`), or, with the preference off, nothing at all (`:461` requires `silentFinal.length > 0`). A `{ name, blob }` wrapper is worse: no `.arrayBuffer()` means a `TypeError` inside `processFiles`, surfaced only through the caller's `.catch`.

**So the response message carries the name as an explicit field beside the bytes** — a list of `{ name, blob }` records, not bare Blobs and not `File` objects. Not `File` for a specific reason: the name on A's disk may **not** be the name that was asked for. `ensureUnique` (`slide-recv.js:585`) inserts a `~N` before the extension on collision, so a pull of `WOTBEAST.FTH` into a folder that already holds one lands as `WOTBEAST~1.FTH`. The name that should reach B's device is the CP/M name the user dragged, chosen by the responder — not whatever the disk entry ended up being called. Converting to a File is S11.3's one-liner (`new File([blob], name)`); this module does not do it, because it is the destination's send path that imposes the requirement.

### (b) "the peer reports its own connected / busy / bound-folder / visible state" — three of those four have traps

- **connected** — `isWriterReady()` (`tx-sink.js:110`) is the predicate the whole app already uses, not `serial.getState()`. A writer exists only after a successful `open()` + `registerWriter`.
- **busy** — **do not use `slide-recv.js:385 isSlideActive()`.** It is recv-only. The complete predicate exists twice already: `main.js:667` (`isSlideActive() || getWireOwner() === 'slide'`) and, more completely, `file-source.js:270-279 isSessionActive()`, which also covers `hasPendingSendSession` — the window between auto-typing `A:SLIDE.COM R\r` and the Z80's wakeup, during which the wire owner is still `'terminal'` and the tab is nonetheless committed. **Use the `isSessionActive()` shape.** A recv-only predicate leaking into a send path has now happened three times in this codebase (`keyboard.js`'s Esc chain, `chrome.js`'s `isSlideActiveRef`, and S11.4 code-review finding (3), still open). This is the fourth opportunity; do not take it.
- **bound folder** — there is **no public getter**, and the pane's handles are deliberately stripped from `__getStateForTests` (`pull-pane.js:1809`). See §6 for the one sanctioned addition.
- **visible** — `document.visibilityState` is DOM, and AC-1 requires this module to touch none. Inject it (§3(c)).

### (c) The epic names `pullProgramFromAutoSend`; no such identifier exists

Carried here so S11.3 is not written against a symbol that was renamed out from under the epic. `pullProgramFromAutoSend` appears only in the planning doc (`epics-beast-to-beast.md:61`, `:93`, `:299`). The real mechanism is `slideProgramPath(p)` (`prefs.js:341`, composing `slideProgramDrive` + `slideProgramName`), injected into the pane as `getPullProgram` (`main.js:694`) and given its direction letter by the caller — `' S '` for a pull (`pull-pane.js:256`), `' R\r'` for a send (`slide.js:246`). Same pref pair, two composers. **This story does not touch it**; it is recorded so S11.3's plan starts from the code rather than the doc.

### (d) One deadline cannot cover both "did anyone answer?" and "did the file arrive?"

The epic's AC says a request whose peer never answers "resolves with a defined *peer gone* reason after a **single deadline, never a poll loop**." Correct — but a naive reading gives that one deadline two incompatible jobs. A peer answers a request in microseconds; a peer *fulfils* one by running a real SLIDE pull over 19200 baud, which takes seconds to tens of seconds. A single deadline long enough for the pull cannot detect a closed tab in useful time, and one short enough to detect a closed tab reports a healthy transfer as failed — which is precisely the defect S11.4 exists to have removed.

**So the exchange is two-phase:**

1. `request` → the responder replies **immediately** with `accepted` or `refused`. This reply is what the single deadline covers.
2. later, `files` (or a late `refused` carrying `pull-failed`) arrives with no deadline of its own.

The dead-tab-after-accept case is covered without a timer by a best-effort `bye` posted on `pagehide` — the same shape and the same honesty as `serial.js:212`'s `beforeunload` teardown. A hard-killed tab posts nothing and the requester waits; that is recorded as a known limit in AC-7 rather than papered over with a poll.

### (e) `serial.js:537` promises this story answers the in-use question. It cannot, and the comment must stop saying so

S11.1 closed with a known limit: `isPortInUse()` treats **every** `NetworkError` as a cross-tab hold, so a device held by `minicom`, or an OS permission denial (on Linux, a user not in `dialout`/`uucp` — the most common first-run CP2102N failure), reads as "already connected in another Beastty tab." The comment at `serial.js:531-538` and the sprint-status record both point at this story.

**The honest answer: a peer link can *falsify* that message but never *confirm* it.** If no other Beastty tab exists, the claim is certainly wrong. If one does exist and is connected, it may be holding the *other* beast while something outside the browser holds this one — so the message is still a guess. Turning a guess into a narrower guess would need a second user-facing string, and UX-DR7 requires every such string to be fixed verbatim in a story. There is no copy budget here and no UX decision on record.

**This story therefore does not narrow it, and says so in the code.** It does **not** change the message, the classifier, or any string in `serial.js`; it rewrites the dangling half of the comment so nothing promises a repair that is not coming, and names where the decision actually lives.

Note what it does *not* add, and why: a "is any other Beastty tab alive?" probe would be a short broadcast answered under one deadline — cheap, and buildable on this module in a few lines. It is left unbuilt because nothing in E11 needs a peer roster (the drag carries the id, which is the whole point of the design), because a presence protocol is out of scope above, and because the fact on its own is useless until someone decides what the second message says. Recorded as an explicit non-delivery, not left as a silent gap.

## Acceptance Criteria

**AC-1 — The module is pure, injected, and reachable from a spec.**
**Given** the new `www/transport/peer-link.js`
**When** it is reviewed
**Then** it touches no DOM (no `document`, no `window` beyond the channel construction and the `pagehide` listener), imports nothing (the `echo-swallow.js` / `session-log.js` precedent), and receives every dependency through `wirePeerLink(opts)` from `main.js`
**And** it adds no Rust/wasm change, no SLIDE protocol or firmware change, no server or network call, and no new dependency — a browser primitive and native ESM only
**And** its `__getStateForTests` / `__resetForTests` are exposed on `window.__peerLink` in `main.js`. *(Not optional: `echo-swallow.js` returns its hooks from `wireEchoSwallow` only, and `slide-bridge.spec.js:440-447` is a spec that gave up asserting against it as a direct result.)* (NFR-1, NFR-2, NFR-3, NFR-5)

**AC-2 — Session identity is per tab, minted at wire time, never persisted.**
**Given** a tab boots
**When** `wirePeerLink` runs
**Then** it mints a session id with `crypto.randomUUID()` held in module scope
**And** it is **not** written to `localStorage`, `sessionStorage` or IndexedDB — `sessionStorage` in particular survives a reload *and* is copied into a duplicated tab, which would give two tabs one identity
**And** nothing in the module reads `getInfo()`, a VID/PID, or any device fact: the id identifies the tab and only the tab.

**AC-3 — Every message carries a version and an address, and anything else is ignored.**
**Given** an inbound message
**When** it arrives
**Then** it is ignored silently — no reply, no side effect, no log entry — unless it is a well-formed envelope of the current schema version addressed to this tab's session id
**And** an envelope of an unrecognised version is ignored rather than best-effort parsed. *(Two tabs can be running two builds: one tab left open across a deploy is an ordinary daily-driver state for this app.)* (FR-5)

**AC-4 — Nonce rules.**
**Given** an inbound request whose nonce is unknown, already used, or absent
**When** it arrives
**Then** it is ignored
**And** a nonce is minted one per drag by `mintNonce()`, is valid exactly once, and is retired the moment it is honoured — before the responder does any work, so a duplicated message cannot start two pulls
**And** the table is pruned **lazily**, on mint and on validate, by age and by a hard size cap — never by a sweeper timer, which would contradict AC-8. (FR-5, NFR-6)

**AC-5 — Exactly one outcome per honoured request, and the refusal decision lives in this module.**
**Given** an inbound request with this tab's id and a live nonce
**When** it is honoured
**Then** the module evaluates its own four self-checks first — connected, not busy, bound folder, visible — from injected getters, and refuses without calling the file provider if any fails
**And** if all four pass it invokes the injected file provider exactly once and produces exactly one of: the file records, or a refusal
**And** every refusal carries a code from the frozen closed set, never a free-text string, and never a user-facing sentence. (FR-7, NFR-6)

**AC-6 — Status is read live, never cached.**
**Given** a peer status query
**When** it is answered
**Then** every field is read through its injected getter at answer time
**And** no field is stored, memoised or mirrored anywhere in this module — there is no copy that could disagree with the tab it describes
**And** the busy check is the composite one per §3(b), not `slide-recv.js`'s recv-only `isSlideActive()`.

**AC-7 — Peer gone resolves on one deadline, never a poll.**
**Given** a request whose peer never answers
**When** the wait ends
**Then** it resolves with the `peer-gone` reason after **one** non-chained `setTimeout` deadline, cleared on settle, settle-once guarded — the `waitForSendState` shape (`slide.js:1223-1243`), not the `setTimeout(tick, 10)` shape S11.4 removed
**And** the deadline covers only the immediate accept/refuse reply, not the transfer (§3(d))
**And** a tab that closes after accepting posts a best-effort `bye` on `pagehide`, which resolves the requester with the same reason
**And** the residual case — a hard-killed tab, which posts nothing — is recorded in the Completion Notes as a known limit, with the note that S11.3 owns whatever the user is told about a stalled transfer.

**AC-8 — With one tab open the link is inert.**
**Given** only one Beastty tab is open
**When** the app runs
**Then** no peers are known, no request is ever sent or received, **no timer is left running**, and no observable behaviour changes anywhere in the app
**And** `__getStateForTests` proves it: a field reporting live deadlines/waiters reads zero from boot onwards. (FR-14)

**AC-9 — A multi-kilobyte handover stalls neither tab.**
**Given** a blob handover of a multi-kilobyte file
**When** it is posted
**Then** it travels as a `Blob`, **not** an `ArrayBuffer`: `BroadcastChannel.postMessage()` takes no transfer list, so an ArrayBuffer is structured-*cloned* — a full synchronous copy on the sending thread — while a Blob serialises as a handle into the browser-process blob store
**And** neither tab's serial read loop nor its wire pacing is stalled by it, proven by a spec, not asserted
**And** no path uses `URL.createObjectURL` + `fetch()` to move the bytes: CSP is `connect-src 'self'` with no `blob:` (`www/_headers`, `index.html:10-18`), so fetching an object URL is blocked. Read with `.arrayBuffer()`. (NFR-7)

**AC-10 — The in-use message question is answered, not inherited.**
**Given** `serial.js:531-538`, which points at this story
**When** this story completes
**Then** the comment names the decision in §3(e) — a peer link can falsify the claim but not confirm it — and no longer promises a repair that is not coming
**And** `isPortInUse()`, `PORT_IN_USE_MSG` and every string in `serial.js` are **byte-for-byte unchanged**.

**AC-11 — The trust rules are tested without two tabs, and the tests cannot pass vacuously.**
**Given** the test suite
**When** it runs
**Then** the pure rules — envelope validation, addressing, nonce minting/validation/retirement/pruning, the refusal decision against faked status getters, and the frozen code set — are covered by single-page specs that import the module directly, the `file-source.spec.js:235-247` / `shortcuts-registry.spec.js:34-51` pattern
**And** **every "it is ignored" case has a positive control** in the same spec proving the harness would have observed a response had one been sent — a silent-ignore assertion with no positive control passes against a module that does nothing at all
**And** the genuinely cross-tab cases (round trip, refusal round trip, peer-gone deadline, blob handover, inert-with-one-tab) run in a two-page spec built on the new harness in §7.

**AC-12 — Two real tabs, checked by hand.**
**Given** two Beastty tabs in one Chrome window
**When** the checkpoint runs
**Then** the two session ids are observed to differ, a request/accept round trip and at least one refusal round trip are observed end to end, and the observations are recorded in the Debug Log
**And** no MicroBeast is required for this — the link is testable with nothing plugged in, so there is no reason to defer it (E9 retro action #2: checkpoints run in the story that raises them).

**AC-13 — No new surface.**
**Given** the finished change
**When** it is reviewed
**Then** it has added no DOM node, no CSS rule, no preference, no dependency, and **no user-facing string of any kind**
**And** AD-9 / AD-10 are satisfied vacuously — there is no control and no style to write; do not pad the implementation with compliance work for decisions that do not apply here.

## Reason-code vocabulary (closed set — S11.3 maps these to words)

Frozen at the top of the module in the `BUTTON_LABELS` / `CONN_STATUS_LABELS` manner (`ARCHITECTURE-SPINE.md:165`). These are **codes, not copy** — the sentences live in S11.3's verbatim list.

| Code | Meaning | Travels? | S11.3's string (`epics-beast-to-beast.md:347-352`) |
|---|---|---|---|
| `not-connected` | the responder has no writer | yes | "The other beast isn't connected…" |
| `busy` | the responder's wire is owned or a send is pending | yes | "The other beast is mid-transfer…" |
| `no-folder` | the responder has no usable bound pull folder | yes | "The other beast has no pull folder yet…" |
| `not-visible` | the responder's `visibilityState` is not `visible` | yes | "The other beast's tab isn't visible…" |
| `pull-failed` | the responder accepted, then the pull failed | yes | "Couldn't fetch {NAME} from the other beast…" |
| `peer-gone` | no reply before the deadline, or a `bye` arrived | **no — produced locally by the requester** | "The other beast's tab has gone…" |

The destination tab's own refusals (its own not-connected / busy) never cross the channel and need no code here; they are S11.3's local checks.

## Tasks / Subtasks

- [x] **T1 — The module: envelope, identity, addressing (AC-1, AC-2, AC-3)**
  - [x] `www/transport/peer-link.js`, module-scope state block + `wirePeerLink(opts)` returning the API, following `echo-swallow.js:31-49`. Named exports only, no default.
  - [x] Frozen channel name and schema version consts at module top. One `BroadcastChannel`, constructed in `wirePeerLink`.
  - [x] `crypto.randomUUID()` session id. Nothing persisted.
  - [x] Envelope validation: version, kind, target session id, nonce. Anything failing is dropped with no reply and no side effect.
- [x] **T2 — Nonce table (AC-4)**
  - [x] `mintNonce()`, validate-and-retire, lazy prune by age and hard cap, no timer. Named consts for both bounds.
- [x] **T3 — Self-status and the refusal decision (AC-5, AC-6)**
  - [x] Four injected getters — `isConnected`, `isBusy`, `hasBoundFolder`, `isVisible` — read at answer time only.
  - [x] The frozen reason-code set; the refusal decision made here, before the file provider is called.
  - [x] The injected async file provider is optional in this story: absent ⇒ the module refuses. S11.3 supplies it.
- [x] **T4 — Request/reply and the blob handover (AC-7, AC-9)**
  - [x] `requestFiles(...)` → immediate accept/refuse under one deadline (the `slide.js:1223-1243` shape, with `abandonPending*` called from `__resetForTests` and from `dispose()`), then the `files` message with no deadline of its own.
  - [x] Response payload is `{ name, blob }` records per §3(a). Never a bare Blob, never an ArrayBuffer, never an object URL.
  - [x] `bye` on `pagehide`; `dispose()` closes the channel and settles any waiter.
- [x] **T5 — Composition root (AC-1, AC-6)**
  - [x] `wirePeerLink({...})` in `main.js`, sited after `wireSlideRecv` (`:1116-1142`) and before `wireFileSource` (`:1343`), with **every** dependency as a lazy thunk (`() => …`) per the `main.js:479` / `:1148` idiom, so ordering cannot bite.
  - [x] `isBusy` uses the `file-source.js:270-279` shape — `hasPendingSendSession || mode === 'send' || mode === 'recv'` — read through `__slideGetStateForTests`, plus `getWireOwner() === 'slide'`.
  - [x] `isVisible: () => document.visibilityState === 'visible'` — injected, so the module stays DOM-free and the hidden case is testable without hiding a real tab.
  - [x] `window.__peerLink` per-property assignment (the `main.js:1293-1296` convention).
- [x] **T6 — `isBound()` on the pull pane (AC-5)**
  - [x] One method on `wirePullPane`'s returned API (`pull-pane.js:457`), returning the pane's own existing predicate `view === 'empty' || view === 'list'` (`pull-pane.js:1683`). Do not duplicate that expression in `main.js` and do not read `__getStateForTests` from production code.
- [x] **T7 — `serial.js` comment correction (AC-10)**
  - [x] `serial.js:531-538` only. Comment text; no code, no string.
- [x] **T8 — Tests (AC-11, AC-8)**
  - [x] Single-page unit spec for the pure rules, each ignore-case paired with its positive control.
  - [x] Two-page spec + the context-level harness (§7).
  - [x] The inert-with-one-tab case, asserting zero live waiters/deadlines.
- [x] **T9 — Manual two-tab checkpoint (AC-12)** — run it, record it.
- [x] **T10 — Docs (AC-13 adjacent)** — one bullet in `docs/architecture-www.md` §transport, one row in `docs/component-inventory-www.md` §transport. No UX doc changes: this story has no user-facing surface. UX-DR6's Split View line is S11.3's.

## Dev Notes

### 1. Nothing of this exists yet — verified, not assumed

Exhaustive grep over `www/` (excluding `node_modules`, `tests`): **zero** hits for `BroadcastChannel` (except the one comment at `serial.js:537`), `crypto.*`, `randomUUID`, `getRandomValues`, `sessionStorage`, `SharedWorker`, `MessageChannel`, `postMessage`, `navigator.locks`, `StorageEvent`. The only `nonce` in the tree is `renderer/atlas.js`'s unrelated glyph-cache counter. There is no prior art to follow and none to accidentally duplicate.

### 2. The module template to copy

`www/transport/echo-swallow.js` is the closest existing thing: DOM-free, imports nothing, module-scope state block, `wireEchoSwallow(opts)` returning an API object whose methods are *also* named module exports, `__resetForTests` + `__getStateForTests` (`:118-124`) returning a fresh plain object with copied collections. `session-log.js:47-50` is the precedent for exporting a frozen map so a consumer can use this module's vocabulary without importing it — which is exactly how S11.3 will map codes to strings.

Copy its discipline about serialisability: `focus.js:26-33` states the rule — the snapshot carries no live DOM refs and no functions, so it survives the Playwright bridge.

### 3. `BroadcastChannel` facts that shape the design

- **It never delivers a message back to the posting context.** A tab cannot hear itself. FR-3's "own payload dropped on own terminal is a no-op" is therefore *not* a channel behaviour — it is a same-tab session-id comparison, and it belongs to S11.3.
- **Same-origin, same browser profile, no server** — NFR-2 is satisfied by the primitive itself. CSP has no directive that governs it.
- **A `Blob` serialises as a handle** (Chromium: a blob UUID plus a mojo handle into the browser-process blob store); the bytes are not copied through the renderer. An `ArrayBuffer` in the same position is deep-copied synchronously, because `postMessage` here accepts no transfer list. That asymmetry is the whole of AC-9, and it is the reason the epic says "Blobs".
- Keep the non-blob part of every message small; the envelope should carry ids and codes, nothing bulky.

### 4. The deadline shape, verbatim from the story that earned it

Copy `waitForSendState` (`slide.js:1223-1243`) — synchronous first check, one non-chained `setTimeout`, a `settled` guard, `clearTimeout` on settle ("a leaked timer would outlive the session"), and the waiter cleared from module scope. Its recv twin is `slide-recv.js:737-757`. Read the rationale block at `slide.js:1200-1208` before writing a line of it.

Two disciplines from S11.4 that apply directly here:

- **Settle on teardown.** `forceExitSendMode` opens with `abandonPendingSendStateWait()` (`slide.js:1246`) and `__resetForTests` does the same (`slide.js:479-480`). A waiter left pending across a reset is a test that hangs for reasons nobody can find.
- **Do not re-read a handle the notifier could have nulled.** `notifyRecvStateTransition` carries the state *value* for this reason (`slide-recv.js:716-731`). The analogue here: the reply handler resolves the waiter with the payload it received, never by re-reading module state that another message could have changed in between.

Why one deadline is safe under a clamped clock, and a poll is not: a hidden tab floors chained timers at ~1 s and, past ~5 minutes hidden with chain depth ≥ 5, aligns them to ~1-minute buckets. A single non-chained deadline can only be made to fire **late**, which is the harmless direction. A poll collapses to one or two samples. This is the S11.4 finding restated; do not reintroduce the shape it removed.

### 5. FR-11's visibility refusal and S11.4's "hidden is ordinary" are not in conflict

S11.4 established that hiding a tab **mid-transfer** must not cancel or fail anything (AD-13 amendment, `ARCHITECTURE-SPINE.md:143`; `chrome.js:209-224`). FR-11 refuses a request when the responder is **not visible at request time**. These are different moments: one is a precondition check on a gesture the user is making right now, the other is robustness during a transfer already under way. Implement AC-5's `not-visible` check exactly as specified and do not "fix" it with S11.4's rule, or vice versa.

Related, and worth knowing: `pull-pane.js:475 triggerRefresh()` early-returns while `document.hidden`, so a hidden responder's pane will not repaint during a transfer. That is S11.3's problem, not this module's.

### 6. The bound-folder fact has no public getter, and two caches of it exist

One IndexedDB record backs everything: `beastty-handles` / `handles` / `recv_directory` (`idb.js:31-34`). It is cached independently in two places — `slide-recv.js:132 cachedHandle` (+ `currentPermission` `:133`) and `pull-pane.js:78 dirHandle`. The pane's own bound predicate is `pull-pane.js:1683`:

```js
const bound = view === 'empty' || view === 'list';   // folder bound + readable
```

`state.view` ∈ `first-run | permission | empty | list`, so that one expression already covers "no handle" *and* "handle without permission". That is why T6 adds `isBound()` to the pane rather than composing a new predicate in `main.js`: the pane owns the user-facing "pull folder" idea, and `no-folder`'s S11.3 string sends the user to the pane. Precedent for the shape: `getSendGate()` (`file-source.js:218`).

Do not read `__getStateForTests()` from production wiring. It is a test hook and its contents are asserted by deep-compare in several specs.

### 7. The two-tab test harness does not exist — this is the largest unknown in the story

Verified across all 82 spec files: **zero** uses of `browser.newContext`, `context.newPage`, `page.context()`, the `{ browser }` or `{ context }` fixtures, `test.use(`, or `BroadcastChannel`. Every spec is `async ({ page })` with `page.goto('/')`. Budget for building this, not just for using it.

What you will hit:

- **The serial mock is installed per page.** `SERIAL_MOCK` is a string passed to `page.addInitScript` (`mock-serial.js:4-6`) and it installs an *independent* `MockSerial` per page, so two pages do not share `_grantedPorts`. For this story that is a feature, not a problem: two tabs, two independent devices, which is exactly E11's world. Use `context.addInitScript` so page B gets it too, or add it to each page explicitly.
- **Both pages boot wasm.** `playwright.config.js:19-27` documents that concurrent wasm boots starve the connect handshake, which is why `retries: 1` exists and why `chromium-transport` is `fullyParallel: false` (`:48`). Put the spec in `www/tests/transport/` for the serialised project, and do not tag any two-page case `@fast`.
- **`testMatch` is a four-folder allowlist** (`playwright.config.js:16`, `:37`, `:47`). A new folder under `tests/` is discovered by nothing and runs zero specs, silently. Use `tests/transport/`.
- **Wait for each page's hooks before asserting.** `page.waitForFunction(() => window.__peerLink && typeof window.__peerLink.__getStateForTests === 'function')` — the `modal.spec.js:22` / `command-history.spec.js:28-31` guard. The S11.1 review found an assertion satisfied by static markup before `main.js` had run; the two-page equivalent (asserting against page B before it has booted) is easier to write than to notice.
- **`npm test` will not run this spec.** It pins `--project=chromium` (`package.json:7`). Use `npx playwright test --project=chromium-transport` and `npx playwright test` for everything.

### 8. Specs that pass for the wrong reason — the specific risk in this story

Most of this module's ACs are of the form "it is ignored." A module that has not been written yet also ignores everything. Every such case needs a positive control in the same spec: the identical exchange with a *valid* nonce, or the correct session id, or a known version, observed to produce a response. Without it the ignore-assertions are green against an empty file.

The same trap, in the codebase's own words: S11.4's clamp case "passed twice before it was honest" (`e11-4-…md`, Debug Log), and S11.1's AC-2 assertion resolved against static markup before boot. Both are recorded because they were nearly missed.

For AC-9, the liveness oracle is the existing one: `window.__mockWriterLog.length` growth (`slide-hidden-tab-clamp.spec.js:114-117`) and the `__mockReaderPush` → grid round trip (`readloop.spec.js:25-34`). Existing large-payload precedent to size against: `slide-sender.spec.js:227-228` drives 19 KB + 24 KB; `slide-hidden-tab-clamp.spec.js:149` uses `enterMidStream(page, 200 * 1024)`.

### 9. Lifetime, and the fact that nothing in `main.js` disposes anything

There is no central teardown. `dispose()` exists on six modules and **is called from nowhere in `main.js`** — it exists for idempotent re-wire and test isolation. The two real unload hooks are `serial.js:212` (`beforeunload`, best-effort port teardown, fire-and-forget because "beforeunload has a tight browser time budget") and `prefs.js:228` (debounced-write flush). `chrome.js:242-247` is the `pagehide` precedent.

So: a `BroadcastChannel` here would be the first browser resource of its kind in the app. Provide `dispose()` for symmetry and test isolation, put the `bye` on `pagehide` next to the existing listener's precedent, and do not invent a teardown registry.

### 10. Carried into S11.3, so it is not rediscovered late

Three facts found while researching this story that S11.3 must plan around. None of them is work for this story.

1. **A pull has no completion signal.** `transmitPull` (`pull-pane.js:1615`) is synchronous fire-and-forget keystroke injection returning `boolean`. The only "it landed" hook is `slide-recv.js:528 onFileLanded()`, fire-and-forget, and it **does not fire on the anchor-download fallback path** (`sessionFolderFallback`).
2. **The on-disk name may not be the requested name** — `ensureUnique` (`slide-recv.js:585`) `~N`-suffixes on collision, and `downloadToFolder` does not report back what it chose. This is why §3(a) puts the name in the message as an explicit field.
3. **There is no accessor that reads a file back out of the bound folder.** The handles live in `pull-pane.js:565 state.files[].handle`, module-private and deliberately stripped from the test hook (`:1809`). The nearest pattern to copy is the S9.4 drag stash (`pull-pane.js:975-990`).

### Testing standards

- Playwright only; there is no unit-test runner in this repo. Specs load the real app (`page.goto('/')` → real `main.js` → real wasm) and reach modules either through `window.__*` or through `page.evaluate(async () => { const m = await import('/transport/peer-link.js'); … })`, which returns the **same** module instance `main.js` loaded (`modal.spec.js:1-13` states the guarantee).
- Read state with `expect.poll(() => page.evaluate(...), { timeout })` — never `waitForTimeout` + bare assert. `waitForTimeout` is only ever a settle before a *negative* assertion.
- There is no clock-stubbing helper and `page.clock` is unusable here (it freezes the wasm boot — `slide-hidden-tab-clamp.spec.js:26`). If a clamped clock is needed, use the `setTimeout`-floor shim at `slide-hidden-tab-clamp.spec.js:85-97`, installed via `page.evaluate` after boot.
- Spec titles carry the AC id and the user-visible symptom; the file header names the failure that motivated the spec and ends with the greppable claim "**so this spec wedges without `<the named fix>`**" (house style — `slide-sender.spec.js:180-190`).
- Prove a new case red with `--retries=0`; `retries: 1` is configured (`playwright.config.js:28`) and will hide an intermittent green.
- Report untruncated suite counts, flaky section included, and diagnose flakes rather than accepting them. Baseline at `9118b21`: **748 passed / 1 skipped / 2 flaky**, both flakes from the documented load-sensitive pool (a control run on the unmodified tree flaked 6, a different set).
- Tag `@fast` only where the case genuinely is. No two-page case qualifies.

### Project Structure Notes

- **NEW:** `www/transport/peer-link.js`; `www/tests/transport/peer-link.spec.js` (single-page rules); `www/tests/transport/peer-link-two-tabs.spec.js` (cross-tab). Split the specs — one file mixing a one-page unit block with two-page boots will be slow for everyone and hard to read.
- **UPDATE:** `www/main.js` (one `wirePeerLink` call + `window.__peerLink`), `www/renderer/pull-pane.js` (one `isBound()` on the returned API), `www/transport/serial.js` (**comment only**), `docs/architecture-www.md`, `docs/component-inventory-www.md`.
- **Explicitly NO changes:** `www/transport/slide.js`, `www/transport/slide-recv.js`, `www/input/file-source.js`, `www/input/selection.js`, `www/renderer/chrome.js`, `www/renderer/menu-bar.js`, `www/state/prefs.js`, `index.html`, any CSS, anything Rust/wasm, any UX doc.
- **API growth watch** — the sanctioned additions are exactly: the `peer-link.js` module surface, one `wirePeerLink` call, one `window.__peerLink` hook, and one `isBound()` on the pull pane. Nothing else. No new export from `serial.js`, `slide.js`, `slide-recv.js` or `file-source.js`.
- **Architecture compliance, honestly:** **AD-1/AD-2** (new unit = one ESM + one `wireXxx` call, module-scope state, `dispose()`, `__getStateForTests`, `window.__xxx`) and **AD-3** (inject everything) bind and are the point of the story. **AD-12** does not: the polite-fail check and the chord ordering are untouched, and this module has no listener that competes for a key. **AD-9 / AD-10 are vacuous** — no control, no style. `ARCHITECTURE-SPINE.md:7` and `:233` put transport outside that document's scope, and `transport/` modules already import each other freely (`slide.js:46` imports from `slide-recv.js`); the AD-3 discipline is adopted here because it makes the module unit-testable, which is NFR-5, not because the letter of AD-3 reaches `transport/`.
- **Standing conventions:** story marked done in ALL places (`sprint-status.yaml` + front-matter + `last_updated`), verified by `scripts/check-story-done-consistency.py`; the `## Code Review` section is filled at write time, not backfilled (E8 retro action #1); the banned-vocabulary list applies to every new comment and to this story's text.
- **Commit style:** `feat: E11 S11.2 the cross-tab link — identity, authorisation, blob transport`. The code-review pass is a separate commit carrying the finding count and suite total.
- **Open action items that bind here:** E9 #2 (checkpoints run in the story that raises them) — yes, AC-12/T9, and it needs no hardware. E9 #1 (bot-parity-first) — no, this story touches no SLIDE transport. E8 #3, E9 #3, E9 #4 — not this surface.
- **Two checkpoints still open across E11, named so they are not lost:** S11.4's clamp fix is simulated and not hardware-verified; S11.4 code-review finding (3) is carried — `main.js:458` hands `wireChrome` the recv-only `isSlideActive`, so the `pagehide` `CTRL_CAN` teardown never fires for **send** sessions, and since S11.4 made `pagehide` the sole hide-time trigger that is now the only remaining protection and it has a hole. Both must be closed before E11 ships. Neither is this story's work; §3(b) is the same recv-only-predicate trap seen from a different angle.

### References

- [Source: _bmad-output/planning-artifacts/epics-beast-to-beast.md — Story S11.2 :217-263; FR-5 :60; FR-7 :62; FR-14 :69; NFR-1..NFR-3 :74-76; NFR-5 :78; NFR-6 :79; NFR-7 :80; the new-module line :92; reuse-don't-reimplement :93; UX-DR5 :105; UX-DR7 :107; S11.3's verbatim strings :341-354]
- [Source: www/transport/echo-swallow.js — module template :31-49; `__getStateForTests` :118-124]
- [Source: www/transport/session-log.js — frozen exported copy map :47-50; `wireSessionLog` :55-67; Blob construction note :95-98]
- [Source: www/transport/slide.js — `waitForSendState` :1223-1243 and its rationale :1196-1208; `notifySendStateTransition` :1213-1217; `abandonPendingSendStateWait` :1219-1221 and its call from `forceExitSendMode` :1246; `enterSendMode` :942 and its refusal checks :953-979; `isSendActive` :484; `__getStateForTests` :487-546; `setExpectedRecvFiles` :150]
- [Source: www/transport/slide-recv.js — `waitForState` :737-757 and its two-defect header :704-731; `notifyRecvStateTransition` :725-730; `isSlideActive` (recv-only) :385; `downloadToFolder` :551; `ensureUnique` `~N` :585; `onFileLanded` :528; `cachedHandle`/`currentPermission` :132-133; `__getStateForTests` :875-888]
- [Source: www/transport/serial.js — the comment this story corrects :531-538; `isPortInUse` :545-547; `PORT_IN_USE_MSG` :553; `getInfo` :45-46; `beforeunload` teardown :212-231; `getState` :683]
- [Source: www/input/file-source.js — `sendFiles` :382-393; `processFiles` name/bytes read :403-417; `validateCpmFilename` empty-name path :663-664; `isSessionActive` :270-279; `getSendGate` :218; the `slideConfirmTransfers` read :451-452]
- [Source: www/input/tx-sink.js — `isWriterReady` :110; `getWireOwner` :120]
- [Source: www/renderer/pull-pane.js — `wirePullPane` opts :303-330; returned API `refresh`/`rebind` :457-458; `dirHandle` :78; the bound predicate :1683; `triggerRefresh` hidden early-return :475; `transmitPull` :1615; `composeFromText` :1488-1519; `mergeDirColumns` :1453; `state.files[].handle` :565; handle stripped from the test hook :1809; S9.4 stash pattern :975-990]
- [Source: www/state/idb.js — `beastty-handles` / `recv_directory` :31-34; `getRecvDirHandle` :51]
- [Source: www/state/prefs.js — `slideProgramPath` :341 and the "caller appends R or S" note :337-338; `slideConfirmTransfers` :60; `CONN_STATUS_LABELS` frozen-map precedent :250-256]
- [Source: www/main.js — `wirePullPane` :631-700 (`isSlideActive` composite :667, `getPullProgram` :694); `wireSlideRecv` :1116-1142; `wireFileSource` :1343-1368; `await wireSerial` :1417; lazy-thunk idiom :431/:479/:1148; post-wire link precedent :812; `window.__*` per-property convention :1293-1296]
- [Source: www/renderer/chrome.js — `visibilitychange` after the S11.4 amendment :209-224; `pagehide` :242-247]
- [Source: www/playwright.config.js — `testMatch` allowlist :16, project split :33-51, `retries: 1` :28, parallel-starvation rationale :19-27; www/package.json :7-11 (`npm test` excludes transport)]
- [Source: www/tests/input/file-source.spec.js — in-page module import for pure-function tests :235-247; byte-layout assertion :285-296]
- [Source: www/tests/render/shortcuts-registry.spec.js — no-mock pure-module spec :34-51]
- [Source: www/tests/render/modal.spec.js — the same-module-instance guarantee :1-13; boot-race guard :22]
- [Source: www/tests/transport/slide-hidden-tab-clamp.spec.js — timer-floor shim :85-97; why not `page.clock` :26; hide-the-tab helper :125-135; writer-log liveness oracle :114-117; negative control :209-228]
- [Source: www/tests/transport/half-open-rollback.spec.js — DOMException-shaped fault injection with the right name :26-35]
- [Source: www/tests/session/auto-connect.spec.js — init-script ordering :29-30; the boot-scan-finished signal and why `data-state` proved nothing :150-158]
- [Source: www/tests/transport/mock-serial.js — `navigator.serial` install point :144; opt-in pre-grant hooks :146-184]
- [Source: www/tests/transport/slide-bridge.spec.js — the spec that could not assert against a `wireXxx`-only hook :440-447]
- [Source: ARCHITECTURE-SPINE.md — AD-1 :70-73; AD-2 :75-78; AD-3 :80-83; AD-12 :134-137; AD-13 with the E11 amendment :139-143; conventions table :162-170; scope :7 and Deferred :233 (transport outside this document)]
- [Source: www/_headers + www/index.html:10-18 — CSP `connect-src 'self'`, no `blob:`]
- [Source: docs/architecture-www.md — `transport/` subsystem :46-52; the S11.4 amendment note :42]
- [Source: docs/component-inventory-www.md — `transport/` table :26-34]
- [Source: _bmad-output/implementation-artifacts/e11-1-two-tabs-two-beasts-per-tab-port-identity.md — the in-use known limit and its hand-off to this story (Completion Notes, Code Review); the "spec that concealed both halves" lesson]
- [Source: _bmad-output/implementation-artifacts/e11-4-hidden-tab-never-invents-a-failure.md — one-deadline-not-a-poll; the clamp numbers; "it passed for the wrong reason"; honest suite counts]
- [Source: _bmad-output/implementation-artifacts/epic-e9-retro-2026-07-24.md — action #2 (manual checkpoints run in the story that raises them, open)]
- [Source: MDN Broadcast Channel API + Chromium `storage/browser/blob` README — structured clone with no transfer list; Blob serialised as a UUID + handle into the browser-process blob store, so bytes are not copied through the renderer]

## Dev Agent Record

### Agent Model Used

claude-opus-5 (Claude Code, bmad-dev-story)

### Debug Log References

**AC-12 — two real Chrome tabs, one window, no MicroBeast plugged in.** Run headed
(`DISPLAY=:1`, `headless: false`) against `http://localhost:8000/` with a throwaway
script driving two tabs of one browser context. Verbatim observations:

```
=== OBSERVATION 1 — two tabs, two identities ===
  tab A session id : ae821689-7867-4aba-aba6-8f28a0e35a4e
  tab B session id : fac652a1-739a-4ac1-83ca-dca6a00425a8
  differ           : true

=== OBSERVATION 2 — both tabs idle: no waiter, no deadline (FR-14) ===
  tab A: pendingRequests=0 liveDeadlines=0 outstandingResponses=0 nonces=0
  tab B: pendingRequests=0 liveDeadlines=0 outstandingResponses=0 nonces=0

=== OBSERVATION 3 — request / accept round trip, A -> B ===
  tab A re-wired as responder, session id now: f4c32c02-2311-4916-bd19-ebbec7c37d0c
  drag payload stamped in A : {"peerSessionId":"f4c32c02-…","nonce":"fd88748f-d021-41f1-82b5-527749bd799b"}
  outcome in B              : {"ok":true,"files":[{"name":"WOTBEAST.FTH","size":10800,
                               "first20":"HELLO FROM THE OTHER"}],"ms":2}

=== OBSERVATION 4 — refusal round trips, one per self-check ===
  A not connected    -> B sees: {"ok":false,"reason":"not-connected","ms":0}
  A busy             -> B sees: {"ok":false,"reason":"busy","ms":0}
  A no pull folder   -> B sees: {"ok":false,"reason":"no-folder","ms":0}
  A tab not visible  -> B sees: {"ok":false,"reason":"not-visible","ms":0}

=== OBSERVATION 5 — the nonce is single-use ===
  first  use : {"ok":true,"files":[{"name":"ONCE.TXT","size":10800,…}],"ms":0}
  replay     : {"ok":false,"reason":"peer-gone","ms":2000}

=== OBSERVATION 6 — tabs at rest afterwards ===
  tab A: pendingRequests=0 liveDeadlines=0 outstandingResponses=0 nonces=0
  tab B: pendingRequests=0 liveDeadlines=0 outstandingResponses=0 nonces=0
```

Two notes on what those numbers say. A round trip is **2 ms** for a 10.8 KB payload
and **0 ms** for a refusal, which is the whole justification for §3(d): the reply is
instantaneous and the fulfilment is not, so one deadline cannot cover both. And the
replay in Observation 5 takes the **full 2000 ms deadline** and comes back
`peer-gone` — the retired nonce is ignored in total silence, exactly as AC-4 asks,
and the requester learns nothing about *why*, which is correct (a tab that ignores
you is indistinguishable from a tab that is not there).

The four self-status getters were supplied by the script, because a Playwright
window has no MicroBeast writer and no picked folder. Everything else in the run —
channel, envelope, addressing, nonce table, refusal decision, blob handover — is
the shipped module.

**Proving each new case fails without its fix.** Five mutations, each run with
`--retries=0`, each turning the intended test red and nothing else:

| Mutation | Test that went red |
|---|---|
| schema-version check removed from `isEnvelopeForSelf` | AC-3/AC-4 malformed envelopes are ignored |
| `consumeNonce` never deletes | AC-4 a nonce is retired before any work |
| `handleAccepted` leaves the deadline running (the S11.4 shape) | AC-7 a peer that goes away AFTER accepting |
| self-status memoised instead of read live | AC-6 status is re-read at answer time |
| `sanitiseRecords` replaced by a bare `Array.isArray` | AC-5 …never a nameless Blob |

**One test was found passing for the wrong reason, and fixed.** The first draft of
the "unusable provider" case compiled each bad provider from a source string with
`new Function`. The page's CSP is `script-src 'self' 'wasm-unsafe-eval'`, so every
one of those threw `EvalError` — and *a provider that throws is itself one of the
five cases*, so all five reported `pull-failed` without ever building the payload
they were named after. Both specs now use literal functions selected by key. This is
the §8 trap arriving on schedule; it was caught only because the two-page spec
failed loudly on the same mechanism while the one-page spec went green.

**Suite counts, untruncated.** `npx playwright test` (both projects, `retries: 1`
as configured): **773 passed / 1 skipped / 1 flaky**, 2.1 min. Baseline at `9118b21`
was 748 passed / 1 skipped / 2 flaky, i.e. 751 cases; 751 + 24 new = 775 = 773 + 1 + 1. ✔

The flake was `input/file-source.spec.js:61 drag-drop overlay shows on dragenter`.
Diagnosed, not accepted: `--repeat-each=3 --retries=0` on that file alone failed a
*different* test (`:100 drop triggers picker-equivalent flow`), and a control run of
the same command on the **stashed, unmodified tree** failed a *third* one
(`:160 File ▸ Send File… opens the picker`). Shifting failure set within one file,
1/39 each time, present without this story's changes — the documented load-sensitive
pool, not a regression.

### Completion Notes List

- **`www/transport/peer-link.js` is new and imports nothing.** Channel wiring, a
  per-tab `crypto.randomUUID()` session id, the single-use nonce table, the four
  self-checks, the frozen refusal-code set, and the blob handover. No DOM: the
  `visibilityState` read and all four status getters arrive through
  `wirePeerLink(opts)` from `main.js`. A spec pins this structurally — it reads the
  file, strips comments, and fails on any `import`, any `document`, any `window.*`
  other than the pagehide add/remove, and any web-storage identifier.

- **The exchange is two-phase, per §3(d).** `request` → an immediate
  `accepted`/`refused` under **one** non-chained `setTimeout` (the
  `waitForSendState` shape); then `files` or a late `refused`, with no deadline at
  all. `handleAccepted` clears the deadline, which is the single line that keeps a
  slow-but-healthy SLIDE pull from being reported as a failure. The two-tab spec
  drives it with a provider that never settles and watches the request survive well
  past the deadline.

- **The requester's cover for a tab that dies after accepting is a `bye` on
  `pagehide`**, not a timer. `dispose()` sends it too, which is how the two-tab spec
  exercises the path deterministically without depending on what
  `page.close()` does to unload handlers.

- **Refusals are codes, never sentences.** `not-connected` / `busy` / `no-folder` /
  `not-visible` / `pull-failed` travel; `peer-gone` is produced locally by the
  requester and never crosses the channel. `PEER_REFUSAL_CODES` is exported frozen
  (the `SESSION_LOG_TOOLTIPS` precedent) so S11.3 can speak the vocabulary without
  re-hardcoding it. No user-facing string was added anywhere.

- **The response carries `{ name, blob }` records** — not bare Blobs (which
  `file-source.js` would silently drop into the *rejected* rows, offering the user
  "Send 0 files") and not `File` objects (the responder's disk copy may carry a `~N`
  suffix from `ensureUnique`, and the name that must reach the other beast is the
  one the user dragged). The module validates the shape in **both** directions, so a
  malformed payload becomes `pull-failed` rather than reaching S11.3 as something it
  will try to build a `File` out of. Five malformed shapes are covered.

- **`isBusy` in `main.js` is the composite predicate**, per §3(b):
  `hasPendingSendSession || mode === 'send' || mode === 'recv'`, plus
  `getWireOwner() === 'slide'`. Not `slide-recv.js`'s recv-only `isSlideActive()` —
  the leak this codebase has already made three times. An absent or throwing `isBusy`
  getter reads as **busy**; the other three read as their refusing value. An unwired
  harness refuses rather than handing out files on a missing dependency.

- **`isBound()` is one new method on the pull pane's returned API** (T6), returning
  the pane's own existing predicate. The expression now lives in exactly one place —
  `render()` calls the same function — so it cannot drift from what the pane paints.

- **`serial.js` is comment-only** (T7/AC-10). `isPortInUse`, `PORT_IN_USE_MSG` and
  every string are byte-for-byte unchanged; verified with `git diff`. The comment now
  records that a peer link can *falsify* the in-use claim but never *confirm* it, and
  that the repair needs copy nobody has written — so it no longer points at this
  story for a fix that is not coming.

- **The two-page Playwright harness is new** (§7). `context.addInitScript(SERIAL_MOCK)`
  gets the mock into both pages; each page is booted to completion before the next
  starts, because concurrent wasm boots starve the connect handshake
  (`playwright.config.js:19-27`); the specs live in `tests/transport/` for the
  serialised project and none is tagged `@fast`. Note `npm test` pins
  `--project=chromium` and will **not** run either of these — use
  `npx playwright test` or `--project=chromium-transport`.

- **Every "it is ignored" case has a positive control** in the same test (AC-11).
  The single-page spec plays the peer with a second `BroadcastChannel` object in the
  same page — legal, because the channel excludes only the posting *object*, not the
  posting context — so the silences are measured against a handler observed to be
  answering both immediately before and immediately after.

**Known limit, carried deliberately (AC-7).** A tab that is hard-killed — process
crash, `kill -9`, an OS shutdown that skips `pagehide` — posts no `bye`, and a
requester waiting on an already-accepted request waits indefinitely. Not papered
over with a poll: a poll is exactly the shape S11.4 removed, and a hidden tab's
clamped chained timers collapse it to one or two samples. **S11.3 owns whatever the
user is eventually told about a transfer that stalls**, and it is the right place for
it — that story has the copy budget and the progress surface; this module has
neither.

**Not built, and named so it is not mistaken for an oversight.** No "is any other
Beastty tab alive?" probe. It would be a short broadcast under one deadline and a few
lines on top of this module, but nothing in E11 needs a peer roster (the drag carries
the id, which is the design), a presence protocol is out of scope, and the fact is
useless until someone decides what the narrower in-use message says.

**Still open across E11, unchanged by this story** (both must close before E11 ships):
S11.4's clamp fix is simulated, not hardware-verified; and S11.4 code-review finding
(3) — `main.js` hands `wireChrome` the recv-only `isSlideActive`, so the `pagehide`
`CTRL_CAN` teardown never fires for **send** sessions. §3(b) is the same recv-only
trap seen from another angle, and this story took the correct branch of it.

### File List

**New**
- `www/transport/peer-link.js`
- `www/tests/transport/peer-link.spec.js`
- `www/tests/transport/peer-link-two-tabs.spec.js`

**Modified**
- `www/main.js` — one `wirePeerLink({...})` call with four lazy-thunk deps; `window.__peerLink`.
- `www/renderer/pull-pane.js` — `isBound()` extracted and added to the returned API.
- `www/transport/serial.js` — comment only (`isPortInUse` rationale block).
- `docs/architecture-www.md` — `transport/` bullet for `peer-link.js`.
- `docs/component-inventory-www.md` — `transport/` table row for `peer-link.js`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status → review.
- `_bmad-output/implementation-artifacts/e11-2-cross-tab-link-identity-nonce-blob-transport.md` — this file.

## Code Review

Ran 2026-08-06 (`/code-review --fix`). **Four findings, all fixed; two further limits recorded and carried to S11.3.** Every one of the four sits in the same place: what this tab owes a requester *after* it has already posted `accepted`. That is the one moment the protocol has no safety net, because the accept deliberately clears the requester's only deadline (§(d)) — so any path that drops the obligation strands the other tab silently and forever.

**Fixed — a second request could be accepted while the first was still unanswered.** `readSelfStatus()` reported only the four injected checks, and the injected `isBusy` does not go true until the SLIDE pull has actually entered recv/send mode, several `await`s past the accept. Two peers (tabs B and C both dragging at tab A) landing inside that window therefore both passed all four checks, and S11.3's provider would put two pulls on one wire. `outstanding.size > 0` is now OR'd into `busy` at the point the status is *read* — deliberately not inside `chooseRefusal()`, which stays a pure function of the status object so the AC-driven precedence order remains testable on its own.

**Fixed — `__resetForTests()` cleared the responder's debts without paying them.** It settled the requester side via `abandonPendingRequests()` but emptied `outstanding` with no `bye`. The peer in the other tab had had its deadline cleared by the accept, so nothing else could ever end its wait: a two-tab spec that resets tab A mid-transfer would hang tab B until Playwright's 30 s timeout — precisely the failure the module's own teardown exists to prevent. `dispose()` had this right; the reset path did not. Both now go through `sayGoodbye()`.

**Fixed — the debt was cleared before the answer was on the channel.** `handleRequest` deleted the nonce from `outstanding` and *then* called `post()`, which swallows throws by design. A structured-clone failure on the `files` message therefore stranded the requester permanently — its deadline gone, its nonce no longer in `outstanding`, so neither `pagehide` nor `dispose` would ever send it a `bye`. `post()` now returns whether it succeeded and the nonce is released only on success. `post()`'s comment claimed "the requester's deadline or its `bye` covers the silence", which is true only *before* the accept; corrected.

**Fixed — `REFUSAL_CODES` was bolted onto the test hook from outside.** `main.js` attached it to `window.__peerLink` after the fact, so every spec re-wire (`rewire()`, `makeResponder()`) replaced the object wholesale and silently dropped it. It now hangs off what `wirePeerLink` itself returns; the two-tab spec only worked because `tabB` happens never to be re-wired.

**Recorded, not fixed — an expired reply deadline tells the responder nothing.** A peer that was merely slow to answer still runs a full SLIDE pull on its beast and posts a `files` message nobody is listening for. Ending that needs a cancel message, i.e. a fifth message kind, which is a protocol addition beyond this story's closed vocabulary. S11.3 owns it alongside the hard-killed-tab limit already carried.

**Recorded, not fixed — a nonce past `NONCE_TTL_MS` (120 s) is dropped in total silence**, so the requester reports `peer-gone` ("the other tab has gone") about a tab that is plainly right there. This is the ignore rule the ACs specify and the silence is deliberate, but the *words* are wrong for the case — S11.3's copy work needs a sentence for it.

**Suite: 768 passed / 1 skipped / 6 flaky, all green on retry** — 775 cases, the same total as the implementation run. The six are the standing load-sensitive pool recorded in S11.1's review, not this diff.

## Change Log

| Date | Change |
|---|---|
| 2026-08-06 | Code review (`--fix`) → **done**. Four findings, all fixed, and all four in one place: what this tab owes a requester after it has posted `accepted` — the one moment with no safety net, because the accept clears the requester's only deadline. (1) `readSelfStatus()` consulted only the four injected checks, and injected `isBusy` does not go true until the pull has entered recv/send several `await`s later, so two peers landing in that window both passed and S11.3's provider would put two pulls on one wire; `outstanding.size > 0` is now OR'd in where the status is read, keeping `chooseRefusal()` a pure function of it. (2) `__resetForTests()` emptied `outstanding` with no `bye`, so a peer mid-wait — deadline already cleared by the accept — could never be released; a two-tab spec resetting tab A would hang tab B to Playwright's 30 s timeout, the exact failure teardown exists to prevent. `dispose()` had it right, the reset path did not. (3) The nonce was deleted *before* the final `post()`, which swallows throws, so a clone failure stranded the requester permanently with neither `pagehide` nor `dispose` able to reach it; `post()` now reports success and the debt clears only then. (4) `REFUSAL_CODES` was attached to `window.__peerLink` from `main.js`, so every spec re-wire dropped it silently; it now comes off what `wirePeerLink` returns. Two limits recorded and carried to S11.3: an expired reply deadline tells the responder nothing (it still runs a full pull nobody awaits — needs a cancel message, a fifth kind, beyond this story's closed vocabulary), and a nonce past the 120 s TTL is dropped in silence so the requester says "the other tab has gone" about a tab that is right there — the ignore rule is correct, the words are not, and S11.3's copy needs a sentence for it. Suite 768 passed / 1 skipped / 6 flaky (all green on retry) = the same 775 cases; the six are S11.1's recorded load-sensitive pool. Next: S11.3 (the drag itself). |
| 2026-08-06 | Implemented (→ review). New `www/transport/peer-link.js`: one `BroadcastChannel`, a per-tab `crypto.randomUUID()` session id, a lazily-pruned single-use nonce table, four injected self-checks, a frozen refusal-code set, and a `{ name, blob }` handover. Two-phase exchange — immediate `accepted`/`refused` under **one** non-chained deadline, then `files` with none — plus a best-effort `bye` on `pagehide`. One `wirePeerLink` call in `main.js` (all deps lazy thunks; `isBusy` is the composite predicate, not the recv-only one), one `isBound()` on the pull pane, `serial.js` comment corrected with no string touched. Two new specs, 24 cases, including the repo's **first two-page Playwright harness**; every ignore case paired with a positive control, and five mutations run to prove the key cases red. One draft test was caught passing for the wrong reason (CSP blocks `new Function`, and a throwing provider is itself a `pull-failed` case) and rewritten. Suite: 773 passed / 1 skipped / 1 flaky; the flake is the documented shifting failure set in `file-source.spec.js`, reproduced on the unmodified tree. |
| 2026-08-06 | Story created (ready-for-dev). Five corrections to the epic recorded: (a) a bare Blob does not survive `sendFiles`, which duck-types `.name` + `.arrayBuffer()` and drops a nameless file into the *rejected* rows without throwing — so the response carries `{ name, blob }` records, with the name chosen by the responder because `ensureUnique` may have `~N`-suffixed the disk copy; (b) the "busy" half of the peer status query must use the composite predicate (`hasPendingSendSession \|\| mode === 'send' \|\| mode === 'recv'`, plus wire ownership), not `slide-recv.js`'s recv-only `isSlideActive()` — the recv-only leak has already happened three times; (c) the epic's `pullProgramFromAutoSend` does not exist, the real composer is `slideProgramPath()` + a caller-supplied direction letter (carried to S11.3); (d) one deadline cannot cover both "did anyone answer?" and "did the file arrive?", so the exchange is two-phase — an immediate accept/refuse under the single deadline, then the files with none — with a best-effort `bye` on `pagehide` for the tab that closes after accepting; (e) `serial.js:537` promises this story answers "is another Beastty tab holding this port?" and it cannot — a peer link can falsify that claim but never confirm it, so the capability is exposed, the copy is untouched, and the dangling comment is corrected rather than left promising a repair. Also pinned: `Blob` not `ArrayBuffer` (no transfer list on `BroadcastChannel.postMessage`, so an ArrayBuffer is a synchronous deep copy while a Blob travels as a handle); no `fetch(objectURL)` under `connect-src 'self'`; lazy nonce pruning with no sweeper timer, because a timer would contradict FR-14's inert-with-one-tab; the bound-folder fact has no public getter, so one `isBound()` is added to the pull pane rather than duplicating its predicate; and the largest unknown — **no two-page or `BroadcastChannel` test infrastructure exists in any of the 82 specs**, so the harness is a deliverable, not a given, and every "it is ignored" case needs a positive control or it passes against an empty file. Next: dev-story e11-2. |
