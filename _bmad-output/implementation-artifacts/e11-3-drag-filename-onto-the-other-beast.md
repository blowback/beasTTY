---
baseline_commit: 3915b02a9daa8e6ba33b861e8f459ffe5a862d19
---

# Story 11.3: Drag a filename onto the other beast

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast daily driver with two machines side by side,
I want to select a filename in one beast's terminal and drop it on the other beast's terminal,
so that copying a file between my two machines takes one gesture instead of a pull, a folder, and a send.

This is the **last** story of Epic E11 and the only one a user can see. S11.1 (`37c6726`+`299646f`), S11.4 (`42b1bb1`+`d570904`) and S11.2 (`3915b02`) are all done. **Everything below is written against the shipped `peer-link.js` contract, not against the epic's description of it** — where the two disagree, §3 says so.

**Line numbers are HEAD (`3915b02`) line numbers and the working tree is clean.**

## Scope boundary (read first)

**IN scope:**

1. **One new module, `www/input/peer-drop.js`** — the foreign-payload drop handlers on `#terminal-wrapper`, the confirm modal, every user-facing string in this feature, the destination-side local refusals, and the two orchestrations (destination: request → `sendFiles`; source: the `provideFiles` provider handed to `peer-link`).
2. **One `setData` line in `selection.js`'s existing `dragstart`** (`:334`) plus one injected thunk that supplies the stamp. No other change to that module.
3. **Two new methods on the pull pane's returned API** — `composeSelection(text)` and `pullForPeer(names)` (§4, §5). Plus the landing notification widening in §5(c).
4. **One new static `<dialog class="chrome-modal">` in `index.html`** and one dynamic write to `#drop-overlay-text` — the first ever (§6).
5. **One new `slide-chip.js` entry point** for a neutral transient notice (§7) — the refusal surface.
6. **`main.js`**: one `wirePeerDrop({...})` call, one `provideFiles` thunk added to the **existing** `wirePeerLink({...})` call, one widened `hasBoundFolder` thunk (§3(f)), and `window.__peerDrop`.
7. **Docs** — the Split View precondition line in `README.md` and `EXPERIENCE.md` (UX-DR6), the Voice-table rows for the new copy, plus `docs/architecture-www.md` and `docs/component-inventory-www.md`.
8. **Specs** — single-page cases under `www/tests/input/`, cross-tab cases under `www/tests/transport/` on the S11.2 two-page harness.

**OUT of scope — do NOT build here:**

- **Any change to `peer-link.js`.** Its contract is frozen by S11.2 and mapped in §2. The only thing this story adds to it is the `provideFiles` dependency S11.2 deliberately left unwired (`main.js:1155-1158` says so in a comment). No fifth message kind, no cancel message, no presence probe, no roster.
- **Any change to `slide.js` / `slide-recv.js` / the SLIDE protocol / Rust / wasm.** NFR-1. Nothing new goes on the wire in either direction: A runs an ordinary `SLIDE S`, B runs an ordinary `SLIDE R`.
- **A new progress surface.** NFR-8: both tabs are visible, each shows its own existing SLIDE chip, and the user watches both. No cross-tab progress, no percentage, no "waiting for the other beast" spinner.
- **Any persistent chrome** — no pane, no peer list, no nicknames, no settings row, no menu item (UX-DR5). The feature exists only during a drag and a transfer.
- **Changing `#send-modal`.** The existing send confirm stays exactly as it is; the new modal is a sibling, not a rework (§6(b)).
- **Any second confirmation ceremony.** FR-4: one modal, driven by the **existing** `slideConfirmTransfers` preference. When it is off, the transfer starts on drop.
- **Rewording anything S11.1 froze** (`PORT_IN_USE_MSG`, the multi-adapter boot cue) or anything E9/E10 froze (the pull-pane footer copy, the `#send-modal` strings).
- **More than two beasts.** Addressing is by session id and a third tab is harmless, but no code chooses *between* peers and none should be written. "The other beast" is correct for exactly two and the epic records it as the assumption it is (UX-DR3).
- **Chunking** (FR-7, whole files) and **non-Split-View drag** (recorded out of scope in the epic, `epics-beast-to-beast.md:94-97`).

## Corrections to the epic (read before you plan)

The epic's S11.3 section (`epics-beast-to-beast.md:265-354`) is right about the shape and wrong or silent about seven mechanisms. Take these readings — several of them would otherwise be found late, in a spec that passes for the wrong reason.

### (a) The payload cannot be read while the drag is *over* the target. Only its type list can.

The epic's second AC ("a foreign-session payload dragged over tab B's terminal … B shows the overlay") and its third ("a tab's own payload dropped onto its own terminal … nothing happens") both read as though B inspects the payload during `dragover`. It cannot. Chromium's **protected drag data store** makes `dataTransfer.getData()` return `''` for every type during `dragenter` / `dragover` / `dragleave`; only `dataTransfer.types` is readable, and only at `drop` does `getData` return anything. Every existing drag guard in this codebase already obeys this without saying why — `isFileDrag` reads `types.includes('Files')` (`file-source.js:266-268`) and `wrapperDropOurs` reads `types.includes('Files')` (`pull-pane.js:1071`); neither ever calls `getData` before `drop`.

**So the hover-time decision is made from two facts only:** the custom type is present in `ev.dataTransfer.types`, and **this tab is not itself dragging**. The second fact needs no payload: `selection.js` already broadcasts `{ active, text }` to the composition root through `onSelectionDragState` (`selection.js:490`, wired at `main.js:817`), which is precisely how the pull pane distinguishes our own selection drag today. FR-3's "own payload is a no-op" is therefore a **local drag-state check at hover time**, and the session-id comparison is a **belt at drop time**, when `getData` finally works. Implement both; neither alone is enough (the local flag alone would let a third tab's payload through as "not ours", and the id comparison alone cannot light or withhold the overlay).

### (b) `#drop-overlay-text` is a static HTML text node. Nothing has ever written to it.

`index.html:2131-2132` ships the string `Drop file(s) to send via SLIDE`, and an exhaustive grep of `www/*.js` (tests excluded) finds **zero** writes to `#drop-overlay-text` or `#drop-overlay`. S9.4 reused the overlay for a semantically different gesture and simply lived with the wrong words. UX-DR1 asks for the same overlay *treatment* with copy that names the source — so this story is the first to make that text conditional.

Consequences to plan for: the write must be paired with a restore, because file-source's own `setDropTarget(true)` (`file-source.js:365`) never touches the text and would otherwise show our sentence on the next OS file drag. Restore on `dragleave`, on `drop`, and on `dragend`. And `file-source.spec.js:75` asserts the resting string exactly — it must still pass.

### (c) `pullProgramFromAutoSend` does not exist, and the epic names it three times

Carried forward from S11.2 §3(c) so nothing is written against a symbol that never existed. The real composer is `slideProgramPath(p)` (`prefs.js:341`, `slideProgramDrive` + `slideProgramName`), injected into the pane as `getPullProgram` (`main.js:699`, with a `|| 'SLIDE'` fallback) and given its direction letter **by the caller**: `' S '` for a pull (`pull-pane.js:256`), `' R\r'` for a send (`slide.js:246`). This story composes nothing new — `pullForPeer` goes through the pane's existing `composeFromText` → `transmitPull` pair (§5), which already does all of it.

### (d) A pull has no completion signal, and this is the largest single unknown in the story

`transmitPull` (`pull-pane.js:1617`) is **synchronous fire-and-forget keystroke injection returning `boolean`** — it reports that the command went out, nothing more. There is no promise, no per-request correlation, and no partial-failure signal. The only "it landed" hook is `onFileLandedRef()` (`slide-recv.js:528`), which is fire-and-forget, carries **no filename and no count**, and **does not fire at all on the anchor-download fallback path**.

The epic's AC ("A performs an ordinary S9.3 pull … A then reads the file(s) back and posts them to B") assumes a step that does not exist. §5 specifies the mechanism this story must build, and it must be **event-driven, never polled** — S11.4 removed the poll shape from this codebase and S11.2 refused to reintroduce it.

### (e) `isBound()` is not "has a usable pull folder". `slideRecvToFolder` defaults **off**.

S11.2 wired `hasBoundFolder: () => pullPane.isBound()` (`main.js:1180`), which is the pane's own `view === 'empty' || view === 'list'` predicate (`pull-pane.js:1659`) — genuinely correct for "is a folder bound and readable". But `slide-recv.js:521` only writes to that folder when `prefsRef.slideRecvToFolder` is truthy, and that pref **defaults to `false`** (`prefs.js:44`). `main.js:647-653` force-sets it whenever the folder is picked *through the pane*, which is why this has never bitten — but the Settings checkbox `#slide-recv-to-folder-checkbox` can turn it back off with the folder still bound.

In that state `isBound()` reports `true`, A accepts the request, the pull runs, every file goes to the browser's Downloads tray via `downloadViaAnchor`, `onFileLanded` never fires, and **the provider waits for landings that will never come**. The requester's deadline is already cleared by the accept, so B stalls silently — the exact failure S11.2's known limit describes, reached by a route that has nothing to do with a dying tab.

**Fix it where the fact is wrong, not where it hurts:** widen the existing thunk to `() => pullPane.isBound() && getPrefs()?.slideRecvToFolder !== false`. One line in `main.js`, no change to `peer-link.js`, no change to the pane, and the honest answer for the `no-folder` refusal — whose copy already sends the user to the pull pane, which is where they will re-pick the folder and re-set the pref.

### (f) A hidden source tab does not refresh its pane, so the landing signal must not be routed through the refresh

`triggerRefresh()` early-returns while `document.hidden` (`pull-pane.js:486`). FR-11 refuses a request from a **hidden** peer, so A is visible when it accepts — but S11.4 established that a tab hidden **mid-transfer** is ordinary and must not break anything, and the user selecting a third tab during a 19200-baud pull is exactly the case S11.4 exists for.

If `pullForPeer` waits on enumeration, a mid-pull hide silently stops the signal and the provider hangs. **So the landing count must come from the `onFileLanded` callback itself, which fires regardless of visibility, and the read-back must enumerate the directory handle directly rather than through `triggerRefresh`.** §5 specifies it that way. This is not a hypothetical: it is one glance at another tab.

### (g) The on-disk name is not the name to send, and `#send-modal`'s markup is not the aesthetic to copy

Two carried facts, both already earned:

- `ensureUnique` (`slide-recv.js:587`) inserts `~N` before the extension on collision and `downloadToFolder` never reports which name it chose. The name that must reach B's device is the **CP/M name the user dragged**, which is why `peer-link`'s record carries `name` as an explicit field beside the blob. Read-back therefore cannot be `getFileHandle(requestedName)` — §5(d).
- `#send-modal` (`index.html:2302`) does **not** carry `class="chrome-modal"`. It predates the aligned-row restyle and is still a bespoke `<ul><li>` list. Every other modal in the app does carry it. UX-DR2's "aligned rows plus ⓘ tooltips per `key-screen-chrome.html`" means the `.chrome-modal .field` family (`index.html:1398-1503`), and the row to copy verbatim is the **Confirm file transfers** row itself (`index.html:2709-2717`). Do not use `#send-modal` as the template.

## Acceptance Criteria

**AC-1 — The drag carries identity, and carries it without disturbing anything that already reads a drag.**
**Given** a terminal text selection in tab A with at least one CP/M 8.3 name in it
**When** the drag starts
**Then** `dataTransfer` carries a custom type whose payload names A's session id, a **freshly minted** single-use nonce, and the filenames produced by the existing S9.2 parser including DIR-column reassembly (`mergeDirColumns`, `pull-pane.js:1455`)
**And** `text/plain` still carries the identical string it carries today, `effectAllowed` is still `'copy'`, and the 1×1 transparent drag image is still set — the pull-pane drop (S9.3), the reverse-drag handoff (S9.4) and every other existing drag behaviour are bit-for-bit unchanged
**And** a selection that parses to **zero** valid names stamps no custom type at all, so no foreign tab ever lights a drop target for a drag that could not be honoured. (FR-2)

**AC-2 — The overlay lights on a foreign payload, using the shipped affordance and naming the source.**
**Given** a foreign-tab payload dragged over tab B's terminal
**When** it is over the drop area
**Then** B sets the **existing** `data-drop-target="true"` on `#terminal-wrapper` — same attribute, same element, same `#drop-overlay` CSS, no new visual language — and `#drop-overlay-text` reads the verbatim drop label
**And** the decision is made from `ev.dataTransfer.types` plus this tab's own drag state only, never from `getData` (§3(a))
**And** the overlay text is restored to its resting string on `dragleave`, on `drop`, and on `dragend`, so the next OS file drag shows file-source's own words. (UX-DR1, and §3(b))

**AC-3 — A tab's own payload on its own terminal is inert, and so is everything that is not ours.**
**Given** a tab's own payload dropped onto its own terminal
**When** it lands
**Then** nothing happens: no overlay at hover, no `preventDefault`, no wire traffic, no modal, no error, no console noise
**And** a drag carrying a real `'Files'` payload is left entirely to `file-source.js`, and a drag armed by the pull pane's reverse-drag stash is left entirely to the pane — this story's handlers early-return **without `preventDefault`** in every case that is not theirs, the `wrapperDropOurs` discipline (`pull-pane.js:1062-1073`)
**And** at drop time the session id in the payload is compared against this tab's own as a second, independent check. (FR-3)

**AC-4 — The destination refuses before anything reaches the source.**
**Given** B is not connected, or B's own wire is busy
**When** a foreign payload is dropped
**Then** the matching verbatim message is shown and **no request is posted on the channel at all** — no nonce is consumed on A, nothing is spent
**And** "busy" is the **composite** predicate (`hasPendingSendSession || mode === 'send' || mode === 'recv' || getWireOwner() === 'slide'`), the `main.js:1172-1177` shape — **not** `slide-recv.js:385`'s recv-only `isSlideActive()`. A recv-only predicate leaking into a send path has now happened three times in this codebase and S11.2 declined the fourth opportunity; this is the fifth. (FR-10)

**AC-5 — The confirm preference is honoured, and no second ceremony is invented.**
**Given** the existing **Confirm file transfers** preference (`slideConfirmTransfers`, `prefs.js:60`, default ON) is on
**When** a foreign payload is dropped and B's own checks pass
**Then** a modal in the `.chrome-modal` aligned-row aesthetic states the file(s), the source, and the destination drive, with the verbatim title, rows and buttons
**And** nothing is transmitted and **no request reaches A** until Copy is confirmed; Cancel, Esc and backdrop-dismiss all leave the app exactly as it was
**And** the preference is read **live at drop time** through `getPrefs()`, the `file-source.js:451-452` shape, so a Settings change applies without a reload
**And** with the preference off the transfer begins directly, with no second confirmation. (FR-4, UX-DR2)

**AC-6 — The transfer is two ordinary halves, and each tab shows only its own.**
**Given** a confirmed transfer
**When** it runs
**Then** A performs an **ordinary** pull — the pane's existing `composeFromText` → `transmitPull` pair, `<program> S <files>` with the drive from `slideProgramPath` (§3(c)), received into A's bound folder, A's own SLIDE chip showing it
**And** A reads the pulled file(s) back off its own disk and posts them to B as `{ name, blob }` records, the `name` being the **CP/M name the user dragged**, never the possibly-`~N`-suffixed disk name (§3(g))
**And** B converts each record with `new File([blob], name)` and calls the existing `sendFiles` (`file-source.js:382`), so B's device receives them through the identical validate → truncate → collision → confirm → `enterSendMode` path an ordinary local-file send uses, with B's own send chip and the existing N/M batch hint
**And** each tab shows only its own progress; no cross-tab progress reporting exists anywhere
**And** the file is a **copy** — nothing in either direction deletes, renames or rewrites the file on A's device, and A's pulled copy stays in A's folder afterwards. (FR-1, FR-6, FR-8, FR-12, NFR-8)

**AC-7 — Waiting for the pull is event-driven and survives a hidden tab.**
**Given** the provider on A
**When** it waits for the pulled files to land
**Then** it resolves on **events** — landing callbacks and SLIDE lifecycle transitions — and contains **no `setTimeout(tick, N)` poll of any kind** (the shape S11.4 removed and S11.2 refused to reintroduce)
**And** the landing count comes from the `onFileLanded` callback, **not** from the pane's `triggerRefresh`, which early-returns while `document.hidden` (§3(f))
**And** hiding A mid-pull does not fail, cancel or stall the transfer — a spec proves it against the simulated clamped clock, the `slide-hidden-tab-clamp.spec.js:85-97` shim
**And** a pull that ends without all its files — a SLIDE error, a wakeup that never came, a session that closed short — resolves `pull-failed` rather than waiting forever. (FR-15 adjacent; NFR-7)

**AC-8 — Every refusal is legible, quiet, and names its one fix.**
**Given** A is not connected, has no usable pull folder, is mid-transfer, or is not visible
**When** B asks for the file
**Then** the reason code that comes back over the channel is mapped to its verbatim sentence and shown to the user, each sentence naming exactly one fix
**And** the not-visible case names Split View rather than stalling silently
**And** the mapping is exhaustive over `PEER_REFUSAL_CODES` read from **`peerLink.REFUSAL_CODES`** — the object `wirePeerLink` returns, not a re-hardcoded copy and not something attached to `window.__peerLink` from outside (S11.2's code review fixed exactly that defect)
**And** an unmapped or unrecognised code still produces a sentence rather than a blank, silent, or `[object Object]` outcome. (FR-9, FR-11)

**AC-9 — Nothing is red, nothing is colour alone, and no control steals focus.**
**Given** the implementation
**When** it is reviewed
**Then** no refusal or failure state uses red — red is reserved for port-lost and security (`prd.md:589`) — and no state is signalled by colour alone
**And** every new control is wired through `retainFocus` (`focus.js:60`, AD-10), **not** the hand-rolled `mousedown → preventDefault` that `#send-modal` still uses (`file-source.js:161`)
**And** all styling is `--chrome-*` tokens only and visually identical CRT↔Console (AD-9)
**And** the modal is a static `<dialog class="chrome-modal">` in `index.html` opened through the shared `openModal(dialogEl, { initialFocus, restoreTo })` helper (AD-8), never a hand-rolled dialog. (UX-DR4, NFR-4)

**AC-10 — A failure names its stage and points at the copy that already exists.**
**Given** any stage fails
**When** the failure is reported
**Then** the message names which stage failed — fetching from the other beast, or sending to this one
**And** the source file on A's device is untouched in every case
**And** a **send**-side failure points the user at the copy now sitting in A's pull folder, so the recovery is the shipped local-file drag with no beast-to-beast path involved. (FR-13)

**AC-11 — With one tab open, nothing changed.**
**Given** only one Beastty tab is open
**When** the user drags a terminal selection
**Then** behaviour is identical to today — the custom type is stamped, nothing listens for it, no drop target appears anywhere, no timer runs, and the pull-pane drop and OS-file drop behave exactly as they did at `3915b02`
**And** `__getStateForTests` proves it rather than a comment claiming it. (FR-14)

**AC-12 — No new persistent surface, and the words are the words.**
**Given** the finished feature
**When** the app is inspected with no drag in progress
**Then** it has added no pane, no peer list, no nickname system, no settings row and no menu item — the feature exists only during a drag and a transfer
**And** the two machines are referred to as "the other beast" and "this beast", accurate for exactly two and recorded in the epic as the assumption it is
**And** every user-facing string matches the verbatim list below **exactly**, with no paraphrase, held in a frozen map at module top in the `BUTTON_LABELS` manner (`ARCHITECTURE-SPINE.md:165`). (UX-DR3, UX-DR5, UX-DR7)

**AC-13 — The docs carry the precondition.**
**Given** the docs
**When** the story completes
**Then** `README.md` and `EXPERIENCE.md` each carry the Split View precondition line verbatim, dated as an E11 amendment in `EXPERIENCE.md`'s house style (`[E11 2026-08-06]`, the `[E10 2026-07-24]` precedent)
**And** `EXPERIENCE.md`'s Voice table gains rows for the new copy, and `docs/architecture-www.md` / `docs/component-inventory-www.md` each gain an entry for the new module. (UX-DR6)

**AC-14 — The tests cannot pass vacuously, and the cross-tab cases are real.**
**Given** the test suite
**When** it runs
**Then** the pure rules — payload build/parse, the ownership predicate, the code→sentence mapping, the destination-side refusal decision — are covered by single-page specs importing the module directly
**And** **every "it is ignored" case has a positive control** in the same spec proving the harness would have observed the response had one been sent — an ignore assertion with no positive control passes against a module that does nothing at all (S11.2's §8 trap, which arrived on schedule there)
**And** the genuinely cross-tab cases — round trip, each refusal round trip, own-payload no-op, hidden-mid-pull — run on the two-page harness S11.2 built (`peer-link-two-tabs.spec.js`), in `tests/transport/` so they land in the serialised project
**And** each new case is proven red before it is claimed green, with `--retries=0` (`retries: 1` is configured and will hide an intermittent green). (NFR-4)

**AC-15 — Two real tabs, two real beasts, checked by hand.**
**Given** two Beastty tabs in one Chrome window in Split View, each holding its own MicroBeast
**When** the checkpoint runs
**Then** a single-file drag A→B and a multi-file drag A→B are each observed to land on B's device, at least one refusal is observed end to end, and the observations are recorded in the Debug Log
**And** the two checkpoints E11 has been carrying since S11.4 are closed in this story or explicitly re-carried by name (E9 retro action #2: checkpoints run in the story that raises them). See Project Structure Notes.

## Verbatim copy (do not paraphrase)

Frozen at module top. `{NAME}` is a single CP/M filename; `{n}` a count.

| Where | String |
|---|---|
| drop overlay label | `⤓ Drop to copy from the other beast` |
| confirm modal title (1 file) | `Copy from the other beast?` |
| confirm modal title (n files) | `Copy {n} files from the other beast?` |
| confirm modal rows | `File` · `From` → `the other beast` · `To` → `this beast` (**amended 2026-08-06 — the drive letter dropped after Ant's hardware checkpoint; see below**) |
| confirm modal buttons | `Copy` / `Cancel` |
| destination not connected | `This beast isn't connected. Connect it and try again.` |
| destination busy | `This beast is mid-transfer. Wait for it to finish and try again.` |
| source not visible | `The other beast's tab isn't visible. Put both tabs side by side in Split View and try again.` |
| source not connected | `The other beast isn't connected. Connect it in its tab and try again.` |
| source busy | `The other beast is mid-transfer. Wait for it to finish and try again.` |
| source has no folder | `The other beast has no pull folder yet. Choose one in its pull pane and try again.` |
| source tab gone | `The other beast's tab has gone. Reopen it and try again.` |
| drag went stale (**added 2026-08-06 — Ant answered Open Question 2**) | `That drag took too long — the other beast's tab is still there. Drag it again.` |
| pull failed (1 file) | `Couldn't fetch {NAME} from the other beast. It's unchanged there — try the drag again.` |
| pull failed (n files) (**added 2026-08-06 — Ant answered Open Question 3**) | `Couldn't fetch {n} files from the other beast. They're unchanged there — try the drag again.` |
| send failed (1 file) | `Couldn't send {NAME} to this beast. A copy is in the other beast's pull folder — drag it from there.` |
| send failed (n files) (**added 2026-08-06 — Ant answered Open Question 3**) | `Couldn't send {n} files to this beast. Copies are in the other beast's pull folder — drag them from there.` |
| docs line | `Beast-to-beast drag needs both Beastty tabs visible at once — use Chrome's Split View to put them side by side.` |
| overlay resting string (**restore target — unchanged, do not edit**) | `Drop file(s) to send via SLIDE` |

**Multi-file `{NAME}` — RESOLVED 2026-08-06.** The story shipped with the singular strings borrowing the **first** requested name, which reads as though one file was involved. Ant sanctioned a plural form (Open Question 3), so each stage failure now picks its form from the **count**: pronoun and verb both change ("It's" → "They're", "A copy is … drag it" → "Copies are … drag them"), never an 's' bolted on. The send half counts what was actually **handed over**, not what was asked for — a pull that ended short still sends what it got.

**The nonce-expiry sentence — RESOLVED 2026-08-06.** Ant sanctioned a new sentence (Open Question 2). A drag held past peer-link's 120 s nonce TTL used to report "The other beast's tab has gone" about a tab that is plainly right there. The drag payload now carries an **optional** mint timestamp `t` (the version deliberately does **not** bump — an old tab's payload must still be honoured and a new tab's must still parse in an old build), and a `peer-gone` outcome on a drag older than `STALE_DRAG_MS` maps to the new sentence instead. The staleness threshold governs **wording only, never behaviour**: it is a heuristic over an outcome that has already failed, so drift against peer-link's own TTL can only change which of two sentences a failed drag shows — it can never stop a good request being sent.

**The destination drive — REMOVED 2026-08-06, on hardware evidence.** The `To` row read `{X}: — this beast`, where `{X}` was `slideProgramDrive`: **where SLIDE.COM lives**, which is not a guarantee of where CP/M writes the received file. The story accepted the approximation because it is right on every setup this app had been used on and no better fact exists. Ant's hardware checkpoint found the case that isn't: the row claimed `A:` while the receiving beast was on `B:`. A row that states a fact the app does not have is worse than a row that states less, so the drive is **gone** rather than qualified — the row now reads simply `this beast`, and the `getDestDrive` dependency is deleted from `peer-drop.js` and `main.js` along with it.

## Tasks / Subtasks

- [x] **T1 — Stamp the drag (AC-1, AC-11)**
  - [x] `selection.js` `onDragStart` (`:318-341`): after the existing `setData('text/plain', dragText)`, call one injected optional thunk (`getPeerStamp`, absent ⇒ stamp nothing) and `setData` the custom type when it returns a payload. Nothing else in that function moves.
  - [x] The thunk lives in `peer-drop.js` and is injected into `wireSelection` from `main.js`. `selection.js` imports nothing new (AD-3).
  - [x] Payload: a JSON string `{ v, sessionId, nonce, names }`. `sessionId` from `peerLink.getSessionId()`, `nonce` from `peerLink.mintNonce()`, `names` from the pane's new `composeSelection(text)` (T2), valid tokens only. Zero valid names ⇒ return null ⇒ no custom type.
  - [x] Custom type constant, lowercase, frozen at module top (Chromium lowercases type strings).

- [x] **T2 — `composeSelection(text)` on the pull pane (AC-1)**
  - [x] One method on `wirePullPane`'s returned API (`pull-pane.js:457-466`), a thin export of the existing private `composeFromText` (`:1490`). No new parsing logic and no duplicate of `mergeDirColumns` anywhere.
  - [x] Do **not** put `command` in the drag payload — A composes its own command at pull time from its own live prefs.

- [x] **T3 — The drop handlers and the overlay (AC-2, AC-3, AC-11)**
  - [x] New `www/input/peer-drop.js`, `wirePeerDrop(opts)` shape per AD-1/AD-2, module-scope state, `dispose()`, `__getStateForTests`, `__resetForTests`.
  - [x] Four guarded handlers on the injected `#terminal-wrapper`, copying `pull-pane.js:1085-1120` verbatim in discipline: ownership predicate → early return with **no** `preventDefault` when not ours → depth-counted enter/leave → drop clears the affordance **before** re-checking ownership.
  - [x] Ownership predicate: custom type present **and** no `'Files'` type **and** this tab's own selection drag is not active. Local drag state via the existing `onSelectionDragState` observer (`main.js:817` is the wiring precedent).
  - [x] Overlay: set/clear `data-drop-target` on the same element file-source uses, plus the first-ever write to `#drop-overlay-text` with a restore on leave/drop/dragend (§3(b)).

- [x] **T4 — Destination-side checks and the confirm modal (AC-4, AC-5, AC-9, AC-12)**
  - [x] On drop: parse the payload, reject on a bad shape or a version mismatch, compare session ids (belt), then run B's own two checks **before** anything is posted.
  - [x] `slideConfirmTransfers` read live via injected `getPrefs`. Modal built into a new static `<dialog id="peer-copy-modal" class="chrome-modal">`, opened via the shared `openModal` helper, `initialFocus` on Copy, `restoreTo` the terminal wrapper. `retainFocus` on both buttons.
  - [x] Rows follow `.chrome-modal .field` (`index.html:1398-1503`); the row to copy is `#slide-confirm-transfers-row` (`index.html:2709-2717`). Not `#send-modal`.

- [x] **T5 — Destination orchestration (AC-6, AC-8, AC-10)**
  - [x] `peerLink.requestFiles({ peerSessionId, nonce, names })` → on `{ ok: true, files }` convert each `{ name, blob }` with `new File([blob], name)` and call the injected `sendFiles`; on `{ ok: false, reason }` map the code to its sentence and show it.
  - [x] Codes read from `peerLink.REFUSAL_CODES`. Exhaustive mapping plus a defined fallback sentence for an unknown code.
  - [x] A `sendFiles` rejection is the send-failed case; a resolved `sendFiles` is not proof the bytes landed, and this story does not claim otherwise (`sendFiles` returns before the wire finishes).

- [x] **T6 — `pullForPeer(names)` on the pull pane (AC-6, AC-7)** — the story's largest piece; §5 is the specification.
  - [x] One method on the pane's returned API. Refuses (rejects/`null`) when not bound, when SLIDE owns the wire, or when there is no writer.
  - [x] Snapshot the directory's entry names directly off `dirHandle` — not via `triggerRefresh`, which is hidden-guarded (§3(f)).
  - [x] Fire the pull through the existing `composeFromText` → `transmitPull` pair restricted to `names`.
  - [x] Resolve on events only: a landing counter fed by the widened landing notification (T7), plus SLIDE lifecycle transitions for the ends-short case. **No poll.**
  - [x] Read back each newly-appeared entry with `handle.getFile()`, pair it with the **requested** name in arrival order, return `[{ name, blob }]`.

- [x] **T7 — Landing notification widened (AC-7)**
  - [x] `main.js:1142`'s `onFileLanded` currently calls `pullPane.refresh()` only. Route it through one pane method that both increments the peer-pull counter **and** does today's refresh, so the counter is fed even when the refresh early-returns on a hidden tab. One method, not two call sites in `main.js`.

- [x] **T8 — The refusal surface (AC-8, AC-9)**
  - [x] One new `slide-chip.js` entry point for a neutral transient notice: the existing chip render path and auto-hide, no `[Retry]` button, no "Transfer failed —" prefix, no red (`enterError` is the wrong wrapper — §7).
  - [x] Sanctioned API growth, named in the Completion Notes.

- [x] **T9 — Composition root (AC-4, AC-6, AC-8)**
  - [x] One `wirePeerDrop({...})` call in `main.js`, every dependency a lazy thunk per the `main.js:479` / `:1148` idiom.
  - [x] Add **one** `provideFiles` thunk to the existing `wirePeerLink({...})` call — the dependency S11.2 deliberately left unwired. Nothing else in that call changes except (below).
  - [x] Widen `hasBoundFolder` to `() => pullPane.isBound() && getPrefs()?.slideRecvToFolder !== false` (§3(e)).
  - [x] `window.__peerDrop` per-property assignment (`main.js:1293-1296` convention).

- [x] **T10 — Tests (AC-14, AC-11)**
  - [x] Single-page spec `www/tests/input/peer-drop.spec.js` — payload build/parse, ownership predicate, code→sentence exhaustiveness, destination refusals, modal, overlay text set **and restored**, zero-valid-names stamps nothing, single-tab unchanged.
  - [x] Cross-tab spec `www/tests/transport/peer-drag-two-tabs.spec.js` on S11.2's harness — round trip, one round trip per refusal code, own-payload no-op, hidden-mid-pull.
  - [x] Regression pins: `file-source.spec.js:75`'s resting overlay string still passes; the S9.3 pane-drop and S9.4 reverse-drag describes still pass untouched.
  - [x] Every ignore case paired with a positive control. Each new case proven red with `--retries=0`.

- [x] **T11 — Docs (AC-13)** — README line, `EXPERIENCE.md` line + Voice rows dated `[E11 2026-08-06]`, `docs/architecture-www.md` bullet, `docs/component-inventory-www.md` row.

- [x] **T12 — Manual checkpoint (AC-15)** — **RUN BY ANT ON HARDWARE, 2026-08-06.** Two MicroBeasts, two tabs, one Chrome window in Split View. All four checks passed; the observations and the one copy defect they found are in the Debug Log. Carried checkpoint (i) is **closed** by it; (ii) is **re-carried** by name with an owner.

## Dev Notes

### 1. The shipped `peer-link.js` contract — read this, not the epic

Everything below is verified against `3915b02`. Import nothing from `peer-link.js` in `peer-drop.js`; take it all through injection (AD-3), the way `main.js` already does.

**What `wirePeerLink` returns** (`peer-link.js:151-164`): `{ REFUSAL_CODES, getSessionId, mintNonce, consumeNonce, requestFiles, dispose, __setFileProviderForTests, __resetForTests, __getStateForTests }`. `REFUSAL_CODES` is on the returned object **deliberately** — S11.2's code review found it had been bolted onto `window.__peerLink` from `main.js`, so every spec re-wire silently dropped it. Do not re-hardcode the strings and do not read them off the window.

**Codes** (`peer-link.js:74-84`, frozen): `NOT_CONNECTED: 'not-connected'`, `BUSY: 'busy'`, `NO_FOLDER: 'no-folder'`, `NOT_VISIBLE: 'not-visible'`, `PULL_FAILED: 'pull-failed'`, `PEER_GONE: 'peer-gone'`.

**Requester side.** `requestFiles({ peerSessionId, nonce, names })` returns a promise that **never rejects** and resolves to exactly one of `{ ok: true, files: [{ name, blob }] }` or `{ ok: false, reason: <code> }`. `peer-gone` is produced **locally** and never travels; it covers the 2000 ms reply deadline expiring, an inbound `bye`, a self-addressed request, a duplicate nonce still in flight, and a malformed argument. An out-of-set inbound reason collapses to `pull-failed`. The 2000 ms deadline (`REPLY_DEADLINE_MS`, `:63`) covers **only** the accept/refuse reply — it is cleared the moment `accepted` arrives, and the transfer that follows has no deadline at all. That is the whole of S11.2 §3(d); do not add one here.

**Responder side.** The provider is registered **only** as `opts.provideFiles` on `wirePeerLink`. It is called as `await provideFilesRef({ names, nonce, fromSessionId })` and must return `[{ name: string, blob: Blob }]`. `sanitiseRecords` (`:317-326`) rejects a non-array, an empty array, a missing/empty `name`, or a `blob` that is not `instanceof Blob` — an `ArrayBuffer` fails. Anything that fails, and anything the provider throws, becomes a late `refused` with `pull-failed`. **So the provider's contract is: resolve with well-formed records, or throw / resolve empty. It never reports its own reason** — there is one failure code and this story owns the sentence for it.

**The four self-checks are evaluated before the provider is called**, in the order `not-connected` → `busy` → `no-folder` → `not-visible` (`chooseRefusal`, `:282-294`), from getters read live at answer time. `busy` additionally ORs in `outstanding.size > 0` at the point status is read (`:276`) — an S11.2 code-review fix that stops a second peer being accepted during the `await`s between the accept and the pull actually starting. Two tabs dragging at a third are therefore already handled; do not add a second guard for it.

### 2. Where each half lives, and why `peer-drop.js` is a third owner of the same element

`#terminal-wrapper` already has two independent sets of drag handlers:

- **`file-source.js:139-143`** — claims a drag iff `types.includes('Files')` (`isFileDrag`, `:266-268`). An OS file drop.
- **`pull-pane.js:429-437`** — claims a drag iff its reverse-drag stash is armed with resolved Files, no SLIDE session owns the wire, and the drag carries **no** `'Files'` type (`wrapperDropOurs`, `:1062-1073`). A pane→terminal drag.

A third set is safe because the three predicates are disjoint in practice and each refuses by returning **without `preventDefault`**, which is what leaves the event to the others:

- Ours needs the custom type, which only a terminal-selection drag stamps.
- The pane's needs `dragOut !== null`, armed only by a pointerdown on a pane row — a gesture that cannot be in flight at the same time as a terminal-selection drag in the same tab.
- file-source's needs `'Files'`, which our payload never carries.

Write the ownership predicate so those facts are asserted rather than assumed: a spec that drives a `'Files'`-carrying drag and a pane-armed drag past our handlers and observes them untouched. S9.4 shipped exactly this pair of handoff-route specs (`pull-pane.spec.js`, "handoff route 1 / route 2") and they are the template.

`peer-drop.js` goes under `www/input/` because that is where `file-source.js` lives — the module that owns drop handling **and** a confirm modal, which is this module's shape exactly.

### 3. Reading a drag while it is over you — the constraint that shapes AC-2 and AC-3

Chromium's protected drag data store: during `dragenter`/`dragover`/`dragleave`, `dataTransfer.getData(type)` returns `''` for every type; only `dataTransfer.types` is populated. `getData` works at `drop`. This is why every existing guard in this codebase tests `types.includes(...)` and never `getData` before drop, and why FR-3 cannot be implemented as an id comparison at hover time.

Do **not** work around it by encoding the session id into the type string. It would work — `crypto.randomUUID()` is lowercase and Chromium lowercases type strings — but it puts identity in a place nothing else in the app looks, it is invisible to the payload validation, and the local drag-state check (which already ships, is already wired, and is already the mechanism the pull pane uses) answers the same question honestly.

Playwright note: synthetic `DragEvent` + `new DataTransfer()` has **no** protected mode, so `getData` works at every phase in a spec. That means a spec can pass while the real browser cannot read what the spec assumed. Write the hover-time assertions against `types` only, and add one spec that asserts the handlers never call `getData` before `drop` (read the module source and fail on the pattern — the `peer-link.spec.js:121-142` structural-assertion precedent).

### 4. The drag payload

```
type:  application/x-beastty-peer-drag        (lowercase, frozen const)
value: JSON string { v: 1, sessionId, nonce, names: [ 'WOTBEAST.FTH', ... ] }
```

`v` matters for the same reason `peer-link`'s envelope version matters: two tabs can be running two builds across a deploy, which is an ordinary daily-driver state for this app. An unrecognised `v` is treated as not-ours — no overlay, no drop, no error.

Parse defensively at drop: `JSON.parse` in a `try`, then check every field's type before use. A malformed payload is inert, not an exception — this runs in a DOM event handler, where a throw is a console trace and nothing else.

**Nonce timing.** FR-2 mints at `dragstart`. `NONCE_TTL_MS` is 120 000 (`peer-link.js:68`) and the table caps at 32 (`NONCE_MAX`). A drag held for over two minutes produces a request whose nonce has been pruned; A drops it in total silence and B's 2000 ms deadline resolves `peer-gone`, so the user is told "The other beast's tab has gone" about a tab that is plainly right there. S11.2 recorded this in its code review and handed the copy to this story. **This story does not add a string for it** — see Open Questions; the epic's frozen list has no sentence for it and UX-DR7 forbids inventing one without a decision. Record it in the Completion Notes as a known limit.

### 5. `pullForPeer(names)` — the specification for the story's hardest piece

Nothing like this exists. `transmitPull` reports only that the command went out; `onFileLanded` carries no name and no count; and there is no accessor that reads a file back out of the bound folder (the handles live in `pull-pane.js:565 state.files[].handle`, module-private and deliberately stripped from `__getStateForTests` at `:1822`). All three facts were found and recorded by S11.2 (§10) precisely so this story would not discover them late.

Build it on the pane, not in `main.js` and not in `peer-drop.js`, for the same reason S11.2 put `isBound()` there: the pane owns the bound folder, and the `no-folder` refusal already sends the user to it.

**(a) Refuse early, from facts the pane already holds.** Not bound (`isBound()`), SLIDE owns the wire (`slideActiveNow()`, `:1428`), no writer (`isWriterReadyRef()`) — the same three `transmitPull` already checks (`:1617-1621`). Refusing here is cheap; the peer's own four checks have already passed by the time the provider runs, so this is a narrow race window, not a duplicate.

**(b) Snapshot before, off the handle directly.** Enumerate `dirHandle` yourself into a `Set` of names. **Do not** call `triggerRefresh()` — it early-returns while `document.hidden` (`:486`) and a source tab hidden mid-pull is the ordinary case S11.4 exists for (§3(f)).

**(c) Fire the pull through the shipped pair.** `composeFromText(names.join(' '))` → `transmitPull(rv)`. This reuses the drive derivation, the 126-char cap, the duplicate collapse, the `onPullRequested` batch hint to the chip, and the `getEnterBytes` terminator — all of it, for free. If `transmitPull` returns `false`, fail immediately.

Note the composed command is capped at 126 chars and silently drops names past the cap into `tokens[].reason = REASON_LIMIT`. A multi-file drag that exceeds it will pull **fewer** files than requested — decide the answer (the honest one is: pull what fits, return only what landed, and let B send those) and pin it with a spec rather than leaving it to chance.

**(d) Wait on events, never a clock.** Two resolution sources, both event-driven:

- **Landings.** The widened landing notification (T7) increments a counter. `onFileLanded` fires per file from `slide-recv.js:528` regardless of tab visibility. When the count reaches the number of names actually transmitted, the pull is done.
- **Ends short.** A SLIDE session that errors, never wakes, or closes with fewer files must not leave the promise pending. `slide-chip.js`'s existing `onStateChange(fn)` observer (`:419`, already part of its returned API) fans out the chip lifecycle — awaiting-wakeup, active, summary, error, hidden — and is the event source to hang this on. Inject it; do not import it.

A single non-chained `setTimeout` as a **backstop** is defensible if and only if it is genuinely a backstop for a case neither source covers, and it must be justified in the Completion Notes. A `setTimeout(tick, N)` re-check loop is not, under any justification: S11.4 removed that shape from this codebase after it reported healthy transfers as failed, and S11.2 declined to reintroduce it.

**(e) Read back what actually arrived, not what was asked for.** `ensureUnique` (`slide-recv.js:587`) may have `~N`-suffixed the disk copy and reports nothing back. So enumerate again, diff against the snapshot, and take the **new** entries. Pair them with the requested names **in arrival order** — SLIDE delivers in command order, so entry *i* is name *i*. Record that as the assumption it is and pin it with a multi-file spec.

Read each with `handle.getFile()` — the primitive S9.4 (`pull-pane.js:985`) and S10.1 (`:1178`) both already use. Return `[{ name: requestedNames[i], blob: file }]`: **the requested CP/M name, the arrived bytes.** A `File` is a `Blob`, so `sanitiseRecords`' `instanceof Blob` check passes without conversion.

**(f) `slideRecvToFolder` must be on** or the files go to the Downloads tray and `onFileLanded` never fires at all (§3(e)). T9's widened `hasBoundFolder` stops the request before it ever reaches the provider; `pullForPeer` should still not assume it.

### 6. The modal, and the aesthetic it must actually follow

`#send-modal` is **not** the template (§3(g)). The pattern is `.chrome-modal .field` (`index.html:1398-1503`) — a flex row, muted label left, control right, optional `.field-info` / `.field-tip` ⓘ pushed right with `margin-left: auto`. The row to copy verbatim is the Confirm file transfers row itself:

```html
<div class="field check" id="slide-confirm-transfers-row">
  <input type="checkbox" id="slide-confirm-transfers-checkbox" checked>
  <label for="slide-confirm-transfers-checkbox">Confirm file transfers</label>
  <span class="field-info" tabindex="0" role="note" aria-label="About confirming file transfers">
    <span aria-hidden="true">ⓘ</span>
    <span class="field-tip">When off, drops and picker selections begin transferring immediately. …</span>
  </span>
</div>
```

Open it through `openModal(dialogEl, { initialFocus, restoreTo })` (AD-8) — it resolves to the raw `returnValue` tag string, and `''` on Esc or backdrop dismiss, which is the Cancel path. `restoreTo` is the terminal wrapper (`file-source.js:630` is the precedent). `retainFocus(btn)` on each button — `focus.js:60`, one argument for buttons; `#send-modal`'s inline `mousedown → preventDefault` (`file-source.js:161`) predates AD-10 and must not be copied.

A "File" row listing several names needs a shape; the aligned-row family has no multi-value row today. Keep it inside the row (a comma-joined single value is fine and needs no new CSS) rather than transplanting `#send-modal`'s `<ul>`.

### 7. Where a refusal is shown

There is no general "tell the user something" surface in this app. What exists:

- `slide-chip.js` — top-right transient, `--chrome-accent` border, **never red in any state** (`index.html:335-356`). It already carries a refusal-shaped message: `flashDropRejected()` renders "Transfer in progress — cancel first" for 3 s (`:394`).
- `enterError(reason)` (`:386`) renders `Transfer failed — {reason}.  [Retry]` with a 5 s auto-hide. **Wrong wrapper** — this story's sentences are complete sentences, several are not failures, and none offers a retry.
- The paste toast is a paste-progress component, not a message bus. The status bar holds no independent truth (AD-6) and its recent-errors ring is serial errors.

**So: one new `slide-chip.js` entry point** rendering a plain sentence on the existing neutral chip with the existing auto-hide, no prefix and no button. Sanctioned API growth; name it in the Completion Notes and keep it to that. If review prefers a different surface, that is a copy/UX decision and belongs in Open Questions, not in a silent substitution.

Red is reserved for port-lost and security (`prd.md:589`). Nothing in this feature is either.

### 8. The send half is genuinely free — provided the shape is right

`sendFiles(files)` (`file-source.js:382`) is already exported and already injected into the pull pane (`main.js:682`) for S9.4. It refuses on `isSessionActive()` (flashing the chip) and otherwise runs the identical `processFiles` path — validate → 8.3 truncate → collisions → confirm modal per pref → `enterSendMode({ files })`.

`processFiles` **duck-types**: it reads `f.name` (`:403`) and awaits `f.arrayBuffer()` (`:410`), never `instanceof File`. A bare `Blob` has no `.name`, `validateCpmFilename(undefined)` returns `{ ok: false, reason: 'empty filename' }` rather than throwing, and every file lands in the *rejected* rows — the user is offered "Send 0 files", or with the pref off, nothing at all. This is exactly why S11.2 put the name in the message. **`new File([blob], name)` on B, once, at the boundary.**

The N/M batch hint needs nothing: `total_files` comes from the array length passed to `enterSendMode` (`slide.js:504`), so passing all files in **one** `sendFiles` call is the whole of FR-12's send half. Do not loop.

One honesty note for the ACs: `sendFiles` resolving does not mean the bytes reached the Z80 — `enterSendMode` returns before the wire finishes, and its three refusals (`slide.js:953-979`) are console-only. B's own SLIDE chip is what tells the user the send is running. Do not claim more than that in the copy or the specs.

### 9. Testing standards

- Playwright only; no unit runner. Specs load the real app and reach modules via `window.__*` or an in-page `import('/input/peer-drop.js')`, which returns the **same** module instance `main.js` loaded (`modal.spec.js:1-13`).
- **Drags are synthetic.** `new DataTransfer()` + `new DragEvent(type, { bubbles, cancelable, dataTransfer })` dispatched at the element — `selection-drop.spec.js:186-190` and `pull-pane.spec.js:1208-1215` are the two shapes to copy. The real native drag loop is a manual checkpoint, not a spec; that is a standing decision in this repo, not a gap to close here.
- **Cross-tab cases go in `tests/transport/`.** `testMatch` is a four-folder allowlist (`playwright.config.js:16`) — a new folder is discovered by nothing and runs zero specs, silently. Use `context.addInitScript(SERIAL_MOCK)` so both pages get the mock, boot each page to completion before the next (concurrent wasm boots starve the connect handshake, `playwright.config.js:19-27`), and wait on each page's hooks before asserting. Tag nothing two-page `@fast`.
- **`npm test` will not run the two-page spec** — it pins `--project=chromium` (`package.json:7`). Use `npx playwright test` for everything and `--project=chromium-transport` for the transport project alone.
- Read state with `expect.poll(() => page.evaluate(...), { timeout })`, never `waitForTimeout` + bare assert. `waitForTimeout` is only ever a settle before a **negative** assertion.
- For the clamped clock, use the `setTimeout`-floor shim (`slide-hidden-tab-clamp.spec.js:85-97`) installed after boot; `page.clock` freezes the wasm boot (`:26`).
- Spec titles carry the AC id and the user-visible symptom; the file header names the failure that motivated the spec.
- Prove each new case red with `--retries=0`. Report untruncated suite counts including the flaky section; diagnose flakes rather than accepting them. **Baseline at `3915b02`: 768 passed / 1 skipped / 6 flaky = 775 cases**, all six from the standing load-sensitive pool recorded in S11.1's review.

### Project Structure Notes

- **NEW:** `www/input/peer-drop.js`; `www/tests/input/peer-drop.spec.js`; `www/tests/transport/peer-drag-two-tabs.spec.js`. Split the specs — one file mixing single-page unit cases with two-page boots is slow for everyone and hard to read (S11.2's structure).
- **UPDATE:** `www/main.js` (one `wirePeerDrop` call; one `provideFiles` thunk and one widened `hasBoundFolder` on the existing `wirePeerLink` call; one `getPeerStamp` opt on `wireSelection`; the landing-notification route; `window.__peerDrop`), `www/input/selection.js` (**one `setData` line + one opt**), `www/renderer/pull-pane.js` (`composeSelection`, `pullForPeer`, the landing counter), `www/renderer/slide-chip.js` (one notice entry point), `www/index.html` (one `<dialog class="chrome-modal">` + any CSS it needs), `README.md`, `EXPERIENCE.md`, `docs/architecture-www.md`, `docs/component-inventory-www.md`.
- **Explicitly NO changes:** `www/transport/peer-link.js`, `www/transport/slide.js`, `www/transport/slide-recv.js`, `www/transport/serial.js`, `www/state/prefs.js`, `www/state/idb.js`, `www/renderer/menu-bar.js`, `www/renderer/chrome.js`, `#send-modal`'s markup or copy, anything Rust/wasm.
- **API growth watch (E4 #5).** The sanctioned additions are exactly: the `peer-drop.js` module surface; one `window.__peerDrop`; two pull-pane methods (`composeSelection`, `pullForPeer`) plus the landing-notification method; one `slide-chip.js` notice entry point; one `selection.js` opt. Nothing else. No new export from `peer-link.js`, `slide.js`, `slide-recv.js`, `serial.js` or `file-source.js`.
- **Architecture compliance.** **AD-1/AD-2** (new unit = one ESM + one `wireXxx` call, module-scope state, `dispose()`, `__getStateForTests`, `window.__xxx`) and **AD-3** (inject everything — `peer-drop.js` imports nothing) bind. **AD-8** binds: the modal is a static `<dialog>` opened through the shared helper. **AD-9/AD-10** bind for real here, unlike S11.2 where they were vacuous — there is a modal, there are buttons, and there is an overlay. **AD-11** is satisfied by adding no persistent surface at all. **AD-12** is untouched: no new keydown listener and no change to boot order beyond siting one `wireXxx` call.
- **Standing conventions:** story marked done in ALL places (`sprint-status.yaml` + front-matter + `last_updated`), verified by `scripts/check-story-done-consistency.py`; the `## Code Review` section is filled at write time, not backfilled (E8 retro action #1); the banned-vocabulary list applies to every new comment and to this story's text.
- **Commit style:** `feat: E11 S11.3 drag a filename onto the other beast`. The code-review pass is a separate commit carrying the finding count and suite total.
- **Open action items that bind here.** **E9 #1 (bot-parity-first)** — this story drives real SLIDE sessions in both directions, so confirm the mock bot's behaviour against `slide.asm` for the paths exercised before trusting a green two-tab run; S11.4 found the bot flattering the suite in exactly this way. **E9 #2 (checkpoints run in the story that raises them)** — AC-15, and it needs two beasts. **E8 #3, E9 #3, E9 #4** — not this surface.
- **Two checkpoints E11 has been carrying since S11.4, both of which must close before E11 ships.** (i) S11.4's clamp fix is simulated and **not hardware-verified**. (ii) S11.4 code-review finding (3): `main.js:458` hands `wireChrome` the recv-only `isSlideActive`, so the `pagehide` `CTRL_CAN` teardown never fires for **send** sessions — and since S11.4 made `pagehide` the sole hide-time trigger, that is now the only remaining protection and it has a hole. This story is the last in E11: **close them here or re-carry them by name in the Completion Notes with who closes them.** Note that (ii) is the same recv-only-predicate trap AC-4 guards against, seen from a third angle.

### Open questions for Ant — ANSWERED 2026-08-06

> Ant's answers: **1 fine · 2 make a new sentence · 3 add a plural form · 4 fine · 5 ok.** (2) and (3) are implemented; (1), (4) and (5) confirm what shipped.

1. **`{X}:` in the modal's "To" row** is `slideProgramDrive` — where SLIDE.COM lives, not a guaranteed destination drive (§Verbatim copy). Accept the approximation, or drop the drive from the row?
2. **The nonce-expiry sentence.** A drag held past 120 s reports "The other beast's tab has gone" about a tab that is right there (§4). The epic's frozen list has no sentence for it. Add one, shorten the drag→drop window, or accept it as a recorded limit?
3. **The multi-file `{NAME}`** in the two failure strings is singular; the story specifies "use the first name". Is a plural form wanted?
4. **The refusal surface** is a new neutral notice on the SLIDE chip (§7). Right surface?
5. **Story size.** This is the largest story in E11 — 12 FRs, all 7 UX-DRs, a new module, a new modal, two new pane methods and a two-tab spec suite. The epic offers a split at "transfer path vs refusal-and-docs surface" (`epics-beast-to-beast.md:160-162`), which is **the wrong line** — the refusals are interleaved with the transfer path and AC-4 requires them before any request is sent, so the first half could not ship. If it must split, the honest line is **gesture-and-handshake** (T1–T5, T8–T11 with the provider still answering `pull-failed`) vs **the transfer** (T6, T7, and B's `sendFiles` handoff) — dependency-ordered, and the first half delivers a drag that lights up, confirms, and refuses legibly but moves no bytes. Recorded so the decision is available; the default is to build it whole, as S10.1 was.

### References

- [Source: _bmad-output/planning-artifacts/epics-beast-to-beast.md — Story S11.3 :265-354; verbatim copy :341-354; FR-1..FR-4 :56-59; FR-6..FR-14 :61-69; NFR-4 :77; NFR-7 :80; NFR-8 :81; reuse-don't-reimplement :93; UX-DR1..UX-DR7 :101-107; recorded out-of-scope :94-97]
- [Source: www/transport/peer-link.js — `PEER_REFUSAL_CODES` :74-84; `wirePeerLink` and its returned API :127-164; the injected-getter contract :106-134; `readFlag` fail-closed :263-266; `readSelfStatus` with `outstanding.size` :268-280; `chooseRefusal` order :282-294; `sanitiseRecords` and the reason it exists :296-326; `handleRequest` :328-371; `sayGoodbye` :376-382; `requestFiles` and its synchronous refusals :408-441; `handleAccepted` clearing the deadline :450-457; `handleRefused` fallback :459-468; `REPLY_DEADLINE_MS` :63; `NONCE_TTL_MS` / `NONCE_MAX` :68-69; `__getStateForTests` :540-559]
- [Source: www/main.js — the `wirePeerLink` call and its four thunks :1159-1193, including the "No `provideFiles` yet … is S11.3's work" comment :1155-1158 and `hasBoundFolder` :1180; `onFileLanded → pullPane.refresh()` :1142; `wirePullPane` opts :631-706 (`isSlideActive` composite :672, `sendFiles` :682, `getPullProgram` :699, `isConfirmEnabled` :704); `window.__pullPane` :706; `selection.onSelectionDragState → pullPane.onSelectionDrag` :817 and its no-import rationale :813-816; the `slideRecvToFolder` force-set on folder pick :647-653; lazy-thunk idiom :479/:1148; `window.__*` per-property convention :1293-1296]
- [Source: www/input/selection.js — `onDragStart` and every `dataTransfer` call :318-341; `onDragEnd` :343-351; the 1×1 drag image and why :76-84; `getSelection` :431-457; `onSelectionDragState` :490-496]
- [Source: www/renderer/pull-pane.js — returned API :457-466; `isBound` :1659; `composeFromText` :1490-1519; `mergeDirColumns` :1455-1474; `beginReview` :1532-1561; `transmitPull` and its three refusals :1617-1634; `onReviewConfirm` :1636; `cmdPrefix` / `CMD_DIRECTION` :256-258; `MAX_COMMAND_CHARS` / `REASON_83` / `REASON_LIMIT` :238-245; `triggerRefresh` hidden early-return :486; `slideActiveNow` :1428-1431; `confirmEnabledNow` :1432-1440; wrapper drag handlers :429-437; `wrapperDropOurs` :1062-1073; the four wrapper handlers :1085-1120; `data-drop-target` reuse rationale :1075-1078; the S9.4 stash and `handle.getFile()` :975-990; the S10.1 read-back :1178-1179; `state.files[].handle` :565-567; `__getStateForTests` and the stripped handle :1816-1848; the Chromium File-stripping comment :23-32]
- [Source: www/input/file-source.js — wrapper drag handlers :139-143; `isFileDrag` :266-268; `isSessionActive` :270-279; `getSendGate` :218-251; `setDropTarget` :365-372; `sendFiles` :382-394; `processFiles` duck-typing `.name`/`.arrayBuffer()` :397-484; the live `slideConfirmTransfers` read :451-452; `showConfirmModal` and `openModal` usage :527-633; the pre-AD-10 inline focus retention :161-175; `__getStateForTests` :786-797]
- [Source: www/transport/slide.js — `enterSendMode` and its three guards :942-982; `enterSendModeProceed` :988-1084; `total_files` from the array length :504; `__getStateForTests` :487-544; `readAutoSendCommandBytes` and the `' R\r'` direction :246-256; `waitForSendState` shape :1223-1243]
- [Source: www/transport/slide-recv.js — `onRecvEvent` :401; `onRecvFileDone` :440; `assembleAndDownload` :513; the `slideRecvToFolder` branch :521; `onFileLanded` and its folder-path-only comment :525-529; `downloadToFolder` :551; `ensureUnique` `~N` :587; recv-only `isSlideActive` :385]
- [Source: www/renderer/slide-chip.js — returned API :103-107; `enterActive` :356; `enterSummary` :373; `enterError` and its 5 s auto-hide :386-391; `flashDropRejected` :394; `onStateChange` :419; the active-state render reading `total_files` :189-230]
- [Source: www/renderer/focus.js — `retainFocus` :60-88 and the missing-`restoreTarget` throw :71-73]
- [Source: www/renderer/modal.js — `openModal` contract; `__getStateForTests` :88-102]
- [Source: www/state/prefs.js — `slideRecvToFolder` default `false` :44; `slideConfirmTransfers` default `true` :60; `getPrefs` :300-302; `savePrefs` :192-196; `slideProgramPath` and the "caller appends R or S" note :337-341]
- [Source: www/index.html — `#drop-overlay` CSS :1073-1101; the static `#drop-overlay-text` node :2131-2132; `.chrome-modal .field` family :1398-1503; `#send-modal` (**not** `.chrome-modal`) :2298-2331; the row to copy, `#slide-confirm-transfers-row` :2709-2717; the seven `.chrome-modal` dialogs :2341-2614]
- [Source: www/playwright.config.js — `testMatch` allowlist :16; project split :33-51; `retries: 1` :28; parallel-starvation rationale :19-27; www/package.json :7 (`npm test` excludes transport)]
- [Source: www/tests/render/selection-drop.spec.js — synthetic drag technique :186-190; the stray-dragstart cancellation case :207-214; "the native drag loop is a manual checkpoint" :118-121]
- [Source: www/tests/render/pull-pane.spec.js — pane-drop dispatch helper :121-129; `onSelectionDrag` direct push :120; the wrapper degraded-store helper :1208-1215; the S9.4 handoff-route describes ~:998; the confirm-pref describe ~:1548]
- [Source: www/tests/input/file-source.spec.js — the resting overlay-text assertion this story must not break :75; in-page module import for pure functions :235-247]
- [Source: www/tests/transport/peer-link-two-tabs.spec.js + peer-link.spec.js — the repo's only two-page harness; the structural source-assertion pattern :121-142]
- [Source: www/tests/transport/slide-hidden-tab-clamp.spec.js — timer-floor shim :85-97; why not `page.clock` :26; writer-log liveness oracle :114-117]
- [Source: ARCHITECTURE-SPINE.md — AD-1 :70-73; AD-2 :75-78; AD-3 :80-83; AD-8 :105-108; AD-9 :110-114; AD-10 :116-119; AD-11 :121-132; AD-12 :134-137; AD-13 with the E11 amendment :139-143; conventions table :162-170]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md — Voice table and the `[E10 2026-07-24]` dating precedent :135-141]
- [Source: _bmad-output/planning-artifacts/prds/prd-beastty-2026-07-01/prd.md — "red is reserved for port-lost/security only" :589]
- [Source: _bmad-output/implementation-artifacts/e11-2-cross-tab-link-identity-nonce-blob-transport.md — the whole file; especially §3(a) the `{ name, blob }` decision, §3(b) the composite busy predicate, §3(c) `pullProgramFromAutoSend`, §3(d) the two-phase exchange, §5 FR-11 vs S11.4, §6 the bound-folder caches, §7 the two-tab harness, §8 specs that pass for the wrong reason, §10 the three facts carried into this story, and the Code Review's two carried limits]
- [Source: _bmad-output/implementation-artifacts/e11-4-hidden-tab-never-invents-a-failure.md — resolve-on-transition, the clamp numbers, the mock bot flattering the suite, the carried `main.js:458` finding]
- [Source: _bmad-output/implementation-artifacts/e9-4-reverse-drag-pane-to-terminal.md — the sanctioned `sendFiles` fallback and the Chromium File-stripping proof; the wrapper-handler handoff routes; the AD-10 row exception]
- [Source: MDN HTML Drag and Drop API — the protected drag data store: `getData()` returns the empty string during `dragenter`/`dragover`; `types` is readable throughout]

## Dev Agent Record

### Agent Model Used

claude-opus-5 (Claude Code, `bmad-dev-story`). Baseline `3915b02`, working tree clean at start.

### Debug Log References

**Suite.** Final: **819 passed / 1 skipped / 1 flaky = 821 cases** (818 after the implementation run, +3 for the copy answered in Open Questions 2 and 3). Baseline at `3915b02`, measured this session before any edit: **772 passed / 1 skipped / 2 flaky = 775 cases** — the same total the story records (it recorded 768/1/6, a different split of the same standing load-sensitive pool). After the implementation run: **813 passed / 1 skipped / 4 flaky = 818 cases** (818 − 775 = **43 new**: 34 single-page + 9 two-tab). After Ant's copy answers: **821 cases**, i.e. **46 new** — three more single-page cases for the stale-drag sentence, the payload mint timestamp, and the singular/plural split.

The four flaky were `cursor.spec.js` (wall-clock blink), `slide-collisions`, `slide-compatibility`, `slide-wakeup` — none in this story's files. Diagnosed rather than accepted: re-run in isolation with `--retries=0 --workers=2`, **35 passed**, no retries. They are the documented shifting failure set, load-sensitive, and the set differs run to run (this session's *baseline* flaked on two entirely different files).

**Hardware checkpoint (AC-15) — RUN BY ANT, 2026-08-06.** Two MicroBeasts, two Beastty tabs, one Chrome window in Split View, each tab on its own port; source tab with a bound pull folder and *Save received files to a folder* on.

| Check | Result |
|---|---|
| Single-file drag A→B | **Pass.** Overlay lit on B, modal confirmed, both chips ran their own half, file landed on B's device. |
| Multi-file drag A→B | **Pass.** All files landed. |
| Refusals end to end (destination not connected; source folder-save off) | **Pass**, both as described — including the §3(e) state that used to stall B silently forever. |
| Source tab hidden mid-transfer (switched to an unrelated tab ~10 s) | **Pass.** Transfer completed unaffected. |

**What this closes that no spec could.** Playwright drags are synthetic — a `new DataTransfer()` has no protected mode — so the **real Chromium drag loop had never been exercised**. That the overlay lights at all on B is the proof that the custom type survives a native cross-tab drag through the protected drag data store, which was the single highest-risk unknown in the story. The structural source assertion pins the *rule*; only this run proves the *mechanism*.

**One copy defect found, and fixed.** The modal's `To` row read `A: — this beast` while the receiving beast was actually on `B:`. `{X}` was `slideProgramDrive` — where SLIDE.COM lives, which is **not** where CP/M writes the received file. The story had accepted that approximation (Open Question 1) on the grounds that it is right on every setup this app had been used on; the checkpoint found the setup where it isn't. Rather than qualify it, the drive is **removed**: the row now reads `this beast`, and the `getDestDrive` dependency is deleted from `peer-drop.js` and `main.js`. A row that states a fact the app does not have is worse than a row that states less.

**Red-proving (`--retries=0` throughout).** Twelve mutations (nine on the implementation, three on the copy Ant answered); every one confirmed red, but **two only after the spec was strengthened** — both were passing for the wrong reason, which is the trap the story names:

| # | Mutation | Result |
|---|---|---|
| 1 | Drop the `#drop-overlay-text` restore | 2 failed ✓ |
| 2 | Ownership predicate ignores this tab's own drag state | 1 failed ✓ |
| 3 | Remove the drop-time session-id belt | 1 failed ✓ |
| 4 | Run this beast's checks *after* posting the request | 2 failed ✓ |
| 5 | Hand the peer the **disk** name instead of the dragged one | **passed first** → spec fixed → failed ✓ |
| 6 | Route the landing counter through the hidden-guarded refresh | **passed first** → spec fixed → failed ✓ |
| 7 | Revert `hasBoundFolder` to bare `isBound()` | 1 failed ✓ |
| 8 | Hand a bare Blob to `sendFiles` (no `new File([blob], name)`) | 1 failed ✓ (on the collision case) |
| 9 | Drop one code from the refusal→sentence map | 1 failed ✓ |
| 10 | Stale drag falls back to the "tab has gone" sentence | 1 failed ✓ |
| 11 | Plural collapses back to the first-name singular | 1 failed ✓ |
| 12 | Drop the mint timestamp from the drag stamp | 1 failed ✓ |

- **(5)** used `WOTBEAST.FTH`. On collision the disk copy is `WOTBEAST~1.FTH`, and file-source's own 8.3 truncation repairs that straight back to `WOTBEAST.FTH` — so the wrong name reached B's device and the assertion still passed. Re-fixtured to `WOT.FTH` → `WOT~1.FTH`, which fits 8.3 unchanged and therefore survives all the way to the device. Same reason (8) only bites on the collision case, not the single-file one.
- **(6)** the hidden-mid-pull case stayed green with the landing counter broken, because the session-end backstop resolved the wait 1.5 s later and the read-back still found the file. The transfer worked — for the wrong reason. Fixed by exposing `lastPeerPullReason` (diagnostics only) and asserting `'complete'` (landings) rather than `'ended'` (backstop). Without that one assertion, AC-7's central claim was untested.

**Two spec-harness facts found the hard way**, both recorded in the specs:
- A stub directory handle carries functions, so `IndexedDB.put` refuses it (`DataCloneError`). Binding the folder through IDB left slide-recv's `cachedHandle` null, every file went to the Downloads tray, and the spec would have been exercising the anchor fallback while claiming to test the folder. The two-tab spec binds through slide-recv's own picker instead (the FSAP spec's route, for the same reason).
- `slide-recv` holds `window.__prefs.live`; `main.js`'s `hasBoundFolder` reads `getPrefs()`. Setting only one leaves the two halves disagreeing — the request is accepted and the files then bypass the folder.

### Completion Notes List

**What landed.** One new module (`www/input/peer-drop.js`, ~640 lines incl. commentary) owning both halves of the gesture and every user-facing string; one `setData` line plus one injected thunk in `selection.js`; three new pull-pane methods (`composeSelection`, `pullForPeer`, `noteFileLanded`); one new `<dialog class="chrome-modal">`; one new `slide-chip.js` entry point; one `wirePeerDrop` call, one `provideFiles` thunk, one widened `hasBoundFolder` and one `window.__peerDrop` in `main.js`. 43 new cases across two specs.

**Three corrections to the story, all material:**

1. **`slide-chip.js`'s `onStateChange` does NOT fan out the chip lifecycle.** §5(d) says it "fans out the chip lifecycle — awaiting-wakeup, active, summary, error, hidden — and is the event source to hang this on". It does not, and never has: since Plan 11-04 it has carried exactly one event kind, `'inline-action'`, emitted only when the user clicks a bracketed button. Its own header (`:19`) and `slide.js:319`'s subscribing comment both *describe* it as the lifecycle hook, so the story took the description for the behaviour. Filled the fan-out in (one `emitLifecycle()` helper called from each transition). Additive by construction: the one existing subscriber early-returns on any kind that is not `'inline-action'`. This is behaviour added to `slide-chip.js` beyond "one notice entry point" — flagging it as an API-growth item the story did not sanction in those words, though it is what §5(d) assumed already existed.

2. **The two event sources are not ordered, so the wait needs a tail grace.** `slide.js`'s `exitRecvMode` fires `enterSummary` **synchronously** (`:880-890`) while the file writes it is summarising are still chained through slide-recv's `downloadDispatchTail` with a 250 ms SLIDE-19 gap each. Resolving on the session-end event alone would drop the final file of every multi-file pull. So a terminal lifecycle arms **one** 1500 ms grace and then settles with whatever landed.

3. **The pane cannot subscribe to the chip at wire time.** `wireSlideChip` runs *after* `wirePullPane` in the boot order (AD-12), so an `onSlideLifecycle` thunk invoked during the wire hits a `const` in its temporal dead zone. Subscription is taken lazily, on the first peer pull — long after boot, and nothing needs it sooner.

**Backstops, and why each is defensible (§5(d) requires this justification).** Two `setTimeout`s in the peer-pull block, both one-shot, both armed off an event, neither ever re-armed from its own body. A structural spec asserts exactly that: no `setInterval`, exactly two `setTimeout` call sites, and no `setTimeout` nested inside a `setTimeout` callback.
- **Tail grace (1500 ms), armed on the session-end event.** Not a deadline — an ordering fix for correction (2) above. It cannot time out a transfer; it only runs *after* the transfer is already over.
- **Start deadline (30 s), armed at transmit, cleared by the first sign of life** (chip `'active'`, or any landing). This is the only bound on "a wakeup that never came", which neither event source covers: no file lands and the chip sits in `awaiting-wakeup`, which is not terminal — and in Compatibility mode `wakeup-required` the chip deliberately arms no timeout of its own. Scoped to the **handshake**: once a session goes active it is cleared, so a real 19200-baud transfer of any length is never timed out. That distinction is the whole of S11.4's lesson.
Both can only be made to fire **late** by a hidden tab's clamp, which is the harmless direction — the peer has no deadline left to miss, its single one having been cleared by the accept.

**The §3(e) defect is fixed and proven.** `hasBoundFolder` is now `pullPane.isBound() && getPrefs()?.slideRecvToFolder !== false`. A two-tab spec drives the exact stalling state (folder bound, Settings toggle off) and asserts the honest `no-folder` sentence plus *no pull started on A* — with a positive control that flipping the pref back on gets the request accepted.

**Sanctioned API growth, named as required.** `peer-drop.js`'s module surface; `window.__peerDrop`; three pull-pane methods (`composeSelection`, `pullForPeer`, `noteFileLanded`); one `slide-chip.js` entry point (`enterNotice`) **plus the lifecycle fan-out through the existing `onStateChange`** — see correction (1); one `selection.js` opt (`getPeerStamp`); one pull-pane opt (`onSlideLifecycle`). Two additions to the existing `window.__slideChip` test hook (`enterNotice`, `onStateChange`). `pull-pane.__getStateForTests` gained `peerPull`, `slideLifecycleWired` and `lastPeerPullReason`. No new export from `peer-link.js`, `slide.js`, `slide-recv.js`, `serial.js` or `file-source.js`; `peer-link.js` is **byte-for-byte unchanged**, as the story required.

**Approximations and limits recorded rather than papered over:**
- **The destination drive is GONE from the modal.** It was `slideProgramDrive` — where SLIDE.COM lives, not a guarantee of where CP/M writes the file. Accepted as an approximation until Ant's hardware checkpoint found the setup where it is wrong (row said `A:`, receiving beast was on `B:`). Removed rather than qualified; the `getDestDrive` dependency went with it.
- **The nonce TTL sentence — RESOLVED (Open Question 2, Ant: "make a new sentence").** A drag held past 120 s produces a pruned nonce; A drops it in silence and B's deadline resolves `peer-gone`, so the user was told "The other beast's tab has gone" about a tab that is plainly right there. Now: `That drag took too long — the other beast's tab is still there. Drag it again.` — names the cause, corrects the false impression, one fix. Mechanism: the payload carries an **optional** mint timestamp `t`; `PAYLOAD_VERSION` deliberately does **not** bump, because an additive optional field should not make two builds refuse each other (an old tab's payload still parses here, a new tab's still parses there, and a missing `t` simply falls back to the original sentence). The staleness threshold is **wording only, never behaviour** — it is a heuristic over an outcome that has *already* failed, so drift against peer-link's own `NONCE_TTL_MS` can only change which of two sentences a failed drag shows, never whether a good request is sent.
- **Multi-file `{NAME}` — RESOLVED (Open Question 3, Ant: "add a plural form").** Each stage failure now picks singular or plural from the **count**, with the pronoun and verb both changing rather than an 's' bolted on: `Couldn't fetch {n} files from the other beast. They're unchanged there — try the drag again.` and `Couldn't send {n} files to this beast. Copies are in the other beast's pull folder — drag them from there.` The send half counts what was actually **handed over**, not what was asked for — a pull that ended short still sends what it got, and claiming three files failed when two were in flight would be wrong.
- **The 126-char command cap.** A multi-file drag past it pulls fewer files than asked; the decision taken is *pull what fits, return only what landed, let B send those*, since pulling the rest would need a second SLIDE session. Documented at the call site.
- **`sendFiles` resolving is not proof the bytes reached the Z80** — `enterSendMode` returns before the wire finishes. Neither the copy nor the specs claim more; B's own SLIDE chip is what tells the user.
- **Arrival order = command order** is an assumption, recorded as one and pinned by the multi-file two-tab case.

**A pre-existing slide-recv inconsistency observed, not fixed** (out of scope — no change to that module): when `downloadToFolder` finds no handle it sets the session fallback and returns *without throwing*, so `assembleAndDownload` still fires `onFileLanded` even though the file went to the Downloads tray. Harmless here — the landing counter completes, the read-back finds nothing, and the pull resolves `pull-failed`, which is the honest outcome — but the callback's name is a lie on that path. Worth a note for whoever next touches `slide-recv`.

**AC-15 / the manual checkpoint — RUN ON HARDWARE by Ant, 2026-08-06, and PASSED.** Single-file drag, multi-file drag, two refusals end to end, and a source tab hidden mid-transfer: all four observed on two real MicroBeasts in Chrome Split View. Full table in the Debug Log. It found one real defect the whole automated suite could not — the `To` row's drive letter — which is fixed by deleting the drive rather than qualifying it.

**The two checkpoints E11 has carried since S11.4 — one CLOSED, one RE-CARRIED.**
1. **CLOSED (with a stated limit).** S11.4's clamp fix was simulated, not hardware-verified. Ant switched to an unrelated tab for ~10 s during a live transfer on real hardware and the transfer completed unaffected. That exercises the basic hidden-tab timer clamp on the real thing, which is what the fix protects. **The limit worth stating rather than glossing:** Chromium escalates clamping the longer a tab stays hidden (a coarser floor after ~5 minutes of backgrounding), and a 10-second hide does not reach that regime. Deep-backgrounding a tab for minutes mid-transfer remains unobserved on hardware. Judgement: this closes the checkpoint as written — but if a long-hide failure ever surfaces in daily driving, this is the gap it came through.
2. **RE-CARRIED — `main.js:458` hands `wireChrome` the recv-only `isSlideActive`**, so the `pagehide` `CTRL_CAN` teardown never fires for **send** sessions — and since S11.4 made `pagehide` the sole hide-time trigger, that is the only remaining protection and it has a hole. Deliberately **not** fixed here: it is a `chrome.js`/`main.js` teardown defect with its own reach, and this story's Project Structure Notes list `chrome.js` under "Explicitly NO changes". Note it is the same recv-only-predicate trap AC-4 guards against, seen from a third angle — and that both composite predicates this story adds get it right, with a spec asserting the composition root's own wiring names `hasPendingSendSession`, both modes, and the wire owner. **Owner: needs a story of its own in E12, or a fix commit before E11 ships.**

### File List

New:
- `www/input/peer-drop.js`
- `www/tests/input/peer-drop.spec.js`
- `www/tests/transport/peer-drag-two-tabs.spec.js`
- `_bmad-output/implementation-artifacts/e11-3-drag-filename-onto-the-other-beast.md` (this story)

Modified:
- `www/main.js`
- `www/input/selection.js`
- `www/renderer/pull-pane.js`
- `www/renderer/slide-chip.js`
- `www/index.html`
- `README.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/architecture-www.md` — *gitignored in this repo (`.gitignore:21`); edited on disk*
- `docs/component-inventory-www.md` — *gitignored; edited on disk*
- `_bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md` — *gitignored (`.gitignore:16`); edited on disk*

Unchanged, as the story required: `www/transport/peer-link.js`, `slide.js`, `slide-recv.js`, `serial.js`, `state/prefs.js`, `state/idb.js`, `renderer/menu-bar.js`, `renderer/chrome.js`, `#send-modal`'s markup and copy, anything Rust/wasm.

## Code Review

_(fill on completion — this section is filled at write time, not backfilled; E8 retro action #1)_

## Change Log

| Date | Change |
|---|---|
| 2026-08-06 | **Hardware checkpoint run by Ant — AC-15 PASSED, and it found a defect the suite could not.** Two MicroBeasts, two tabs, one Chrome window in Split View: single-file drag ✓, multi-file drag ✓, two refusals end to end ✓ (including the §3(e) state that used to stall the requester silently forever), source tab hidden ~10 s mid-transfer ✓. **This is the run that proves the real Chromium drag loop**: Playwright drags are synthetic (`new DataTransfer()` has no protected mode), so that the overlay lights at all on B is the evidence the custom type survives a native cross-tab drag through the protected drag data store — the highest-risk unknown in the story, and one the structural source assertion could only pin the *rule* for, never the *mechanism*. **Defect found and fixed: the modal's `To` row.** It read `A: — this beast` while the receiving beast was on `B:`. `{X}` was `slideProgramDrive` — where SLIDE.COM *lives*, not where CP/M writes the received file — an approximation the story had accepted under Open Question 1 on the grounds that it is right on every setup this app had been used on. The checkpoint found the setup where it isn't. **Ant's call: drop the drive letter.** The row now reads `this beast`; `COPY.toValue` is a constant, and the `getDestDrive` opt, the `destDriveNow()` reader and the `main.js` thunk are all deleted — one fewer dependency and one fewer thing that can be wrong. A row that states a fact the app does not have is worse than a row that states less. Copy table here, and the Voice row in `EXPERIENCE.md`, both amended with the reason so nobody re-adds it. **Carried checkpoint (i) CLOSED** — S11.4's clamp fix is now hardware-observed, with the limit stated rather than glossed: a 10-second hide exercises the basic clamp but not Chromium's coarser post-~5-minute backgrounding regime, so a long hide mid-transfer remains unobserved. **Carried checkpoint (ii) RE-CARRIED** — `main.js:458`'s recv-only `isSlideActive` still leaves the `pagehide` `CTRL_CAN` teardown blind to send sessions; `chrome.js` is on this story's no-change list, so it needs its own story in E12 or a fix commit before E11 ships. Suite after the copy change: **819 passed / 1 skipped / 1 flaky = 821**. |
| 2026-08-06 | **Open Questions answered by Ant** (1 fine · 2 make a new sentence · 3 add a plural form · 4 fine · 5 ok); (2) and (3) implemented, (1)/(4)/(5) confirm what shipped. **(2) The nonce-expiry sentence.** A drag held past peer-link's 120 s nonce TTL resolves `peer-gone` and used to report "The other beast's tab has gone" about a tab that is plainly right there. New sentence: `That drag took too long — the other beast's tab is still there. Drag it again.` The drag payload now carries an **optional** mint timestamp `t`; `PAYLOAD_VERSION` deliberately does **not** bump, because an additive optional field must not make two builds across a deploy refuse each other — an old tab's payload still parses here, a new tab's still parses there, and a missing or nonsense `t` falls back to the original sentence rather than being treated as malformed. The staleness threshold governs **wording only, never behaviour**: it is a heuristic over an outcome that has already failed, so drift against peer-link's own `NONCE_TTL_MS` can only change which of two sentences a failed drag shows, never whether a good request is sent — which is why it does not need (and must not take) peer-link's constant. **(3) The plural forms.** Each stage failure now picks singular or plural from the **count**, pronoun and verb both changing rather than an 's' bolted on: `Couldn't fetch {n} files from the other beast. They're unchanged there — try the drag again.` and `Couldn't send {n} files to this beast. Copies are in the other beast's pull folder — drag them from there.` The send half counts what was actually **handed over**, not what was asked for, so a pull that ended short cannot claim more files failed than were in flight. `sentenceForRefusal(code, names, opts)` now takes the name **array** and an options bag carrying the drag age, staying a pure function of its arguments so the whole mapping — including the peer-gone/stale split — is drivable by spec without a channel. Copy table in this story, and the Voice rows in `EXPERIENCE.md`, both amended. 3 new cases (46 new in total); suite **819 passed / 1 skipped / 1 flaky = 821**. Three further mutations run and confirmed red: stale drag falling back to the gone sentence, plural collapsing to the first-name singular, and the mint timestamp dropped from the stamp. |
| 2026-08-06 | Implemented (status → review). New `www/input/peer-drop.js` owns both halves of the gesture and every user-facing string; one `setData` line + one injected `getPeerStamp` thunk in `selection.js`; three pull-pane methods (`composeSelection`, `pullForPeer`, `noteFileLanded`); one new `<dialog id="peer-copy-modal" class="chrome-modal">` on the `#slide-confirm-transfers-row` aligned-row rails; one `slide-chip.js` `enterNotice` entry point; one `wirePeerDrop` call, one `provideFiles` thunk, one widened `hasBoundFolder` and `window.__peerDrop` in `main.js`. `peer-link.js` byte-for-byte unchanged. **Three corrections to the story:** (1) `slide-chip.js`'s `onStateChange` does NOT fan out the chip lifecycle — since Plan 11-04 it has carried only `'inline-action'`; its own header and `slide.js:319`'s comment describe it as the lifecycle hook, so §5(d) took the description for the behaviour. The fan-out was filled in (additive: the one existing subscriber early-returns on other kinds) and is flagged as API growth the story did not sanction in those words. (2) The two event sources are unordered — `exitRecvMode` fires `enterSummary` synchronously while the writes it summarises are still chained behind a 250 ms per-file gap, so resolving on session-end alone would drop the last file of every multi-file pull; a 1500 ms tail grace fixes the ordering. (3) The pane cannot subscribe to the chip at wire time (`wireSlideChip` runs later in the boot order — TDZ), so the subscription is lazy, on first peer pull. **Two backstops, both justified as §5(d) requires:** the tail grace (an ordering fix, not a deadline — it only runs after the transfer is over) and a 30 s START deadline for "a wakeup that never came", cleared by the first sign of life so a real transfer of any length is never timed out; a structural spec asserts no `setInterval`, exactly two `setTimeout` sites, and no self-re-arming. **The §3(e) defect is fixed and proven** — `hasBoundFolder` now ANDs in `slideRecvToFolder !== false`, with a two-tab spec driving the exact stalling state plus a positive control. 43 new cases (34 single-page, 9 two-tab on S11.2's harness). Suite **813 passed / 1 skipped / 4 flaky = 818** vs a measured baseline of 772/1/2 = 775; the four flaky are the standing load-sensitive pool (none in this story's files) and all 35 pass in isolation at `--retries=0`. **Nine mutations run; all confirmed red, but two only after the spec was strengthened** — the ~N name case passed with the wrong name because 8.3 truncation repaired `WOTBEAST~1.FTH` back to `WOTBEAST.FTH` (re-fixtured to `WOT.FTH`, whose suffix survives), and the hidden-mid-pull case passed with the landing counter broken because the backstop covered for it (now asserts the settle reason is `complete`, not `ended` — without it AC-7's central claim was untested). **AC-15 NOT RUN:** needs two physical MicroBeasts and a human doing a native drag in Split View; the single-file drag, multi-file drag and end-to-end refusal are unverified on hardware. **Both carried E11 checkpoints re-carried, neither closed:** the S11.4 clamp fix is still simulated (owner Ant, same setup as AC-15), and `main.js:458`'s recv-only `isSlideActive` still leaves the `pagehide` `CTRL_CAN` teardown blind to send sessions (deliberately not fixed — `chrome.js` is on this story's no-change list; needs its own story or a fix commit before E11 ships). Open questions 1–4 remain open; no sentence invented for the 120 s nonce-expiry case. |
| 2026-08-06 | Story created (ready-for-dev). Seven corrections to the epic recorded, several of which would otherwise have been found late: (a) Chromium's protected drag data store makes `getData()` return `''` during `dragover`, so the hover-time decision can use `types` and this tab's own drag state only — FR-3's own-payload no-op is a local drag-state check, not an id comparison, and the id comparison is a drop-time belt; (b) `#drop-overlay-text` is a static HTML node nothing has ever written to, so this story is the first to make it conditional and must restore it or file-source's next OS drag shows our sentence; (c) `pullProgramFromAutoSend` still does not exist — the composer is `slideProgramPath()` plus a caller-supplied direction letter, and `pullForPeer` reuses the pane's shipped `composeFromText` → `transmitPull` pair rather than composing anything; (d) a pull has **no** completion signal — `transmitPull` is fire-and-forget returning `boolean` and `onFileLanded` carries no name and no count — so §5 specifies an event-driven wait (landing counter plus the chip's existing `onStateChange`) with no poll, the shape S11.4 removed; (e) **`isBound()` is not "usable pull folder"** — `slideRecvToFolder` defaults `false` (`prefs.js:44`) and `slide-recv.js:521` only writes to the folder when it is on, so with the folder bound and the Settings toggle off A accepts, pulls to the Downloads tray, never fires a landing, and B stalls silently with its deadline already cleared by the accept; the fix is one widened thunk in `main.js`; (f) `triggerRefresh()` early-returns while `document.hidden`, so the landing signal must come from `onFileLanded` and the read-back must enumerate the handle directly — a source tab hidden mid-pull is the ordinary case S11.4 exists for; (g) the on-disk name may be `~N`-suffixed by `ensureUnique` and is never reported back, so read-back diffs the directory rather than asking for the requested name, and `#send-modal` is **not** `.chrome-modal` so UX-DR2's aligned-row aesthetic must be taken from `#slide-confirm-transfers-row`, not from the send modal. Also pinned: the payload rides a versioned JSON custom type (two tabs can run two builds across a deploy); `new File([blob], name)` at the B boundary because `processFiles` duck-types `.name`/`.arrayBuffer()` and drops a nameless file into the *rejected* rows without throwing; one `sendFiles` call for the whole batch, which is all FR-12's send half needs since `total_files` comes from the array length; the refusal surface is one new neutral entry point on the SLIDE chip because `enterError`'s "Transfer failed — … [Retry]" wrapper is wrong for sentences that are mostly not failures; `peer-drop.js` is a **third** owner of `#terminal-wrapper` drag events and its ownership predicate must be spec-asserted against the other two rather than assumed disjoint; and the nonce TTL (120 s) means a long-held drag reports "the other beast's tab has gone" about a tab that is right there — carried from S11.2's code review, no sentence invented, raised in Open Questions. Five questions recorded for Ant, including the story-size split: the epic's suggested line (transfer path vs refusals) is wrong because AC-4 needs the refusals before any request is sent, and the honest line if one is needed is gesture-and-handshake vs the transfer. Default is to build it whole, as S10.1 was. Next: dev-story e11-3. |
