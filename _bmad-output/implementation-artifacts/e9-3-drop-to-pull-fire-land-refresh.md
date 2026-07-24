---
baseline_commit: 1210a6b451b6dac486ecd6dea988f1da846d62ee
---

# Story 9.3: Drop-to-pull — fire the command, land the files, refresh

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast daily driver,
I want to drop a terminal selection onto the folder pane and have the named files pulled into it,
so that fetching files off the device is a single drag gesture that ends with them visibly in my folder.

This is the **fourth** story of Epic E9 and the one that closes the core loop. S9.1a shipped the pane shell + rail, S9.1b made the list live (guarded refresh, diff-render, fresh markers, `onFileLanded` hook), and S9.2 built the whole compose→review→confirm→inject machinery behind a public `beginReview(text)` entry point. This story adds the *gesture*: drag a canvas selection out of the terminal, drop it on the pane, and `beginReview` takes it from there. It also finishes the rail bloom interaction S9.1a stubbed, and resolves the command-length cap S9.2's code review deferred here.

## Scope boundary (read first)

**IN scope (S9.3):** FR-6 end-to-end + UX-DR3 + the FR-2 bloom completion + the deferred length cap — drag origination from the canvas selection (new logic in `selection.js`), the pane drop target + affordance, drop → `beginReview(text)`, the e2e proof chain (drop → review → confirm → exact bytes → landed files appear on refresh), rail bloom on drag/click, and a ≤126-char cap on the composed command.

**OUT of scope — do NOT build here:**
- **Reverse drag** (FR-12, pane file → terminal → device) → **S9.4** (optional).
- **DIR-columnar reassembly** (`GAME     COM` → `GAME.COM`). v1 parse is the strict whitespace split (FR-7, epic-locked, shipped in S9.2). Do NOT add a DIR-listing heuristic — see Dev Notes "Known v1 parse trap" for why this is documented, visible in review, and deliberately deferred.
- **Separator / drive-prefix changes.** The composed command stays `SLIDE S ` + space-joined names, exactly as S9.2 shipped it. The space-vs-comma and `B:` prefix questions are operationalized as hardware checks in the UAT doc task (T7), not code changes — see Dev Notes "Open hardware questions".
- **Accepting foreign drags.** Text dragged in from other windows/apps and OS file drops on the pane are ignored in v1; only an in-app terminal-selection drag is a valid payload.

## Acceptance Criteria

1. **Drag origination from the terminal selection (FR-4 feed).** A pointerdown on the canvas *inside the committed selection* does not restart selection; it arms a native HTML5 drag (canvas `draggable = true` for the gesture). The selection text (`getSelection().rows.join('\n')`) is stashed **at pointerdown** (before any blur can clear it); `dragstart` sets `dataTransfer.setData('text/plain', stash)` + `effectAllowed = 'copy'` and notifies drag-state observers `{active: true, text}`; `dragend` notifies `{active: false}` and resets `draggable`. A plain click inside the selection (pointerup with no dragstart) clears the selection — the existing single-click-clears behavior extended to this branch — and also resets `draggable` + stash. While a selection drag is pending or active, the D-19 wrapper-blur clear is skipped so the gesture cannot destroy its own payload. Pointerdown *outside* the selection, and every existing selection behavior (double/triple click, drag-extend, auto-scroll, `data-drop-target` early-return), is byte-for-byte unchanged.
2. **Drop-target affordance (UX-DR3).** While an active selection drag is over the pane and drops are acceptable: `.pp-card` gains class `drop` (border-color `var(--chrome-accent)` + `box-shadow: inset 0 0 0 1px var(--chrome-accent)`, per mockup) and `.pp-foot` gains `drop-active` (accent text + accent top border + 10% accent tint via the shipped `color-mix(in srgb, var(--chrome-accent) 10%, transparent)` pattern (index.html:291 precedent) + `font-weight: 600`) with footer text **"⤓ Drop to pull {n} files"** where n = valid-token count of the dragged text (reuse `composeFromText` + `pluralFiles`; "⤓ Drop to pull 1 file" singular). Affordance is depth-counted across dragenter/dragleave (file-source.js:286-306 precedent) and fully clears on dragleave-to-zero, drop, and dragend. Drops are **not** acceptable — no affordance, no `preventDefault`, browser shows no-drop — when: no in-app selection drag is active (OS `Files` drags and foreign text drags are ignored; the terminal wrapper's `data-drop-target` file overlay is never touched), the suspension predicate (`slideActiveNow()`) is true, or no folder is bound (view `first-run`/`permission`).
3. **Drop opens the S9.2 review (FR-4).** Drop → `preventDefault` → affordance cleared → `beginReview(text)` with text = `dataTransfer.getData('text/plain')`, falling back to the drag-state stash if empty. The review renders exactly as S9.2 built it (no changes to review markup/flow). A drop while a review is already open replaces the review content. If `beginReview` returns `false` (suspension flipped mid-drag), nothing opens and nothing is sent.
4. **Zero-valid drop (FR-7).** Dropping a selection that parses to zero valid names opens the S9.2 zero-valid review ("Nothing to pull — no CP/M 8.3 names in the selection.", [Pull…] disabled). No code path can transmit a bare `SLIDE S`. (The machinery is S9.2's, unchanged; this AC re-proves it through the drop path.)
5. **Fire, land, refresh — the e2e chain (FR-6, FR-8).** In one spec: synthetic drop of `'GAME.COM DUMP.BIN'` → review open → confirm → exactly ONE push observed with ASCII `SLIDE S GAME.COM DUMP.BIN` + configured terminator (S9.2's `registerTxObserver` + ring pattern) → then, simulating the device reply landing (add the two files to the fake dir handle and invoke `window.__pullPane.refresh()` — the very function `main.js` wires as `onFileLanded`, main.js:~1094) → the list view shows both files with fresh markers. Zero changes to `slide-recv.js`: recv already writes to the shared `recv_directory` handle (FR-1), so no retarget exists to test.
6. **Rail bloom (FR-2 completion, deferred from S9.1a).** With the pane in rail mode (narrow window): a selection dragstart blooms the card open; rail click also blooms (rail `title` updated to the mockup's **"Click or drag a selection here to open the pull pane"**). Bloom is a zero-layout-shift overlay: `data-bloom` on `#pull-pane`; the card renders `position: absolute`, right-anchored, width 312px, above the stage (z-index below modals) while the pane element keeps its 30px flow slot — **the canvas never moves during bloom**. Un-bloom on: dragend with no review open, review exit while bloomed, and pointerdown outside the pane (the click-bloom case). `data-bloom` is never set while the card is already visible (wide window), and the bloom CSS must out-rank the `@container (max-width: 90px)` card-hiding rule (see Dev Notes).
7. **Command length cap (deferred from S9.2 code review).** `composeFromText` stops accepting further valid names once appending the next (with its joining space) would push the command string past **126 characters** (CP/M CCP line buffer ≈127; margin for the terminator). Overflowed tokens — otherwise valid — render as skipped rows with reason **"over the 126-char CP/M command-line limit"** (ⓘ carries the same text; flag in review if reworded). The composed command is always ≤126 chars; `validCount` counts only included names; the confirm label and footer count follow.
8. **Architecture compliance (NFR-1, NFR-2).** `pull-pane.js` gains **no** direct imports — drop handlers use only DOM events + already-injected deps; drag state arrives via a new API method `onSelectionDrag(state)` that `main.js` calls from `selection.js`'s new observer, connected AFTER `wireSelection` runs (the `onFileLanded: pullPane.refresh` precedent — no boot-order change, no TDZ on the `selection` const, main.js:756). `selection.js` changes are self-contained (it already owns the canvas pointer handlers, AD-3). Zero changes to `slide-recv.js` / `tx-sink.js` / `file-source.js`; zero Rust/wasm/protocol changes. All new CSS is `--chrome-*` tokens (+ the shipped `color-mix` tint pattern) only, identical CRT↔Console (AD-9). No new interactive controls, so no new `retainFocus` wiring (AD-10) — verify drop/bloom never move focus off `#terminal-wrapper`.
9. **Test hooks + specs (NFR-4).** Pane API + `window.__pullPane` gain only `onSelectionDrag(state)` (it doubles as the test entry point — specs call it directly to simulate drag state; no extra `__` hook). `__getStateForTests()` gains `dropAffordance: boolean` and `bloom: boolean`. `wireSelection`'s return (+ `window.__selection`) gains `onSelectionDragState(cb)`. Specs extended in `www/tests/render/pull-pane.spec.js` (drop/affordance/bloom/cap/e2e) and the selection spec home (origination), all `@fast`, covering: affordance on/off + verbatim footer copy; foreign-drag ignored; suspension → no affordance; unbound folder → no affordance; drop→review; replace-open-review; zero-valid drop; the AC-5 e2e chain (+ a `crlf` terminator variant); bloom on dragstart, on rail click, and all three un-bloom paths; length-cap classification (boundary: last name that fits, first that doesn't); pointerdown-inside-selection arms `draggable` + stash while outside-selection does not; click-inside-selection clears; D-19 blur skipped during pending drag. Full suite green at parallel under the ratified `retries:1` policy.

## Tasks / Subtasks

- [x] **T1 — Drag origination in `selection.js` (AC: 1)**
  - [x] Hit-test helper (module-private): `isCellInSelection(at)` — normalize anchor/focusEnd exactly as `getActiveRange` does (selection.js:230-241: start = larger `rowOffsetFromTail`, or same-row smaller col) and test `at` against the walked range semantics: middle rows count full-width, end rows clip at start.col/end.col (same-row: min/max cols).
  - [x] In `onPointerDown` (selection.js:113), AFTER the `data-drop-target` early-return and the `button !== 0` check but BEFORE `preventDefault`/`setPointerCapture`: if a committed selection exists and `isCellInSelection(pxToCellWithScrollOffset(ev))` → enter the **drag-origination branch**: stash `dragText = getSelection().rows.join('\n')`, set `canvasRef.draggable = true`, set a `dragPending` flag, and `return` (no preventDefault, no pointer capture, no anchor reset, no click-count update — see Dev Notes "The risky part" for why).
  - [x] `dragstart` listener on the canvas (added in `wireSelection`, removed in `dispose`): if no `dragPending`/stash → `ev.preventDefault()` (abort stray drags); else `ev.dataTransfer.setData('text/plain', dragText)`, `ev.dataTransfer.effectAllowed = 'copy'`, suppress the whole-canvas ghost via `setDragImage` on a 1×1 transparent element (see Dev Notes), set `dragActive = true`, notify `selectionDragObservers` with `{active: true, text: dragText}`.
  - [x] `dragend` listener: `draggable = false`, clear `dragPending`/`dragActive`/stash, notify `{active: false}`. Also reset `draggable` + stash on `pointerup` when no dragstart fired, and clear the selection there (click-inside-selection deselects, mirroring the zero-length-drag clear at selection.js:171-179).
  - [x] D-19 guard: the `terminalWrapper` blur listener (selection.js:70-74) skips `clearSelection()` while `dragPending || dragActive`.
  - [x] New observer surface: `onSelectionDragState(cb)` → unsubscribe fn (clone the `onSelectionChange` shape, selection.js:320-326); add to the `wireSelection` return object.
- [x] **T2 — Pane drop target + affordance (AC: 2, 3, 4)**
  - [x] `pull-pane.js`: module state `selDrag = {active: false, text: '', validCount: 0}` + public `onSelectionDrag(state)` — on `{active: true, text}` compute `validCount` via the existing `composeFromText` (cap-aware after T4) and, if rail visible, bloom (T3); on `{active: false}` clear affordance (+ un-bloom per AC-6 rules).
  - [x] `dragenter`/`dragover`/`dragleave`/`drop` handlers on `paneEl` (registered in `wirePullPane`, removed in `dispose`). Accept predicate: `selDrag.active && !slideActiveNow() && dirHandle bound (view 'list'|'empty')`. Accepting: `preventDefault()`, `dropEffect = 'copy'`, depth-counted `drop`/`drop-active` classes + footer text swap (restore the resting "Drag a filename selection here to pull" on clear). Not accepting: fall through untouched.
  - [x] `drop`: `preventDefault()`, reset depth + classes, `text = ev.dataTransfer.getData('text/plain') || selDrag.text`, `beginReview(text)`. No special-casing zero-valid — S9.2's `beginReview` already renders that state (AC-4).
  - [x] CSS: `.pp-card.drop` + `.pp-foot.drop-active` per AC-2, translated from mockup pull-pane.html:103-108 with `color-mix` replacing the mockup's literal rgba (AD-9).
- [x] **T3 — Rail bloom (AC: 6)**
  - [x] CSS: `#pull-pane { position: relative; }` (if not already); `#pull-pane[data-bloom] .pp-card { display: flex; position: absolute; right: 0; top: 0; width: 312px; z-index: <below modal/menu layers>; }` — attribute+class specificity (0,2,0) out-ranks the `@container` hide rule's (0,1,0) regardless of order, but keep it after the container query block for readability.
  - [x] JS: `railVisible()` = computed display of `.pp-rail` ≠ 'none'. Bloom (`data-bloom` set) on: selection dragstart while `railVisible()`, rail click (wire a click handler; update the rail `title` to the mockup copy). Un-bloom (`data-bloom` removed) on: drag `{active: false}` with `state.review == null`, review exit (confirm/cancel paths) while bloomed, and a document-level `pointerdown` outside `paneEl` (listener added only while bloomed-by-click, removed on un-bloom and in `dispose`).
  - [x] Badge/rail behavior inside bloom: the card shows normally (list/review); the rail stays in flow underneath — verify no double-paint.
- [x] **T4 — Command length cap in `composeFromText` (AC: 7)**
  - [x] Constant `MAX_COMMAND_CHARS = 126` with a comment citing the CP/M CCP ~127-char line buffer and the S9.2-review deferral. While accumulating valid names: if `('SLIDE S ' + [...names, next].join(' ')).length > 126` → mark `next` (and all later valid tokens) as `ok: false, reason: 'over the 126-char CP/M command-line limit'`; dedupe still applies first (a duplicate of an *included* name collapses, it doesn't burn budget).
  - [x] The review renders these as normal skipped rows (S9.2 markup unchanged); confirm label + `validCount` reflect included names only.
- [x] **T5 — Composition-root wiring (AC: 8)**
  - [x] `main.js`: after `wireSelection` (:756), add `selection.onSelectionDragState((s) => pullPane.onSelectionDrag(s));` — the `pullPane` const is already initialized by then (wired at :620, before selection), so this direction has no TDZ. No `wirePullPane` opts change, no new imports, no boot-order change.
- [x] **T6 — Playwright specs (AC: 9, plus the AC-5 e2e)**
  - [x] Pane specs in `www/tests/render/pull-pane.spec.js` (same boot-race guard, `__resetForTests`, fake handle): drive drag state via `window.__pullPane.onSelectionDrag({active: true, text: '...'})`, then dispatch `DragEvent`s on `#pull-pane` built with an in-page `new DataTransfer()` (`dt.setData('text/plain', ...)`; Chromium supports both constructors). Cover every AC-9 pane item incl. the e2e chain (byte capture via the S9.2 `resetTx()`/`formatHexStrip` pattern; landing simulation via fake-handle mutation + `refresh()`; assert fresh markers).
  - [x] Origination specs beside the existing selection coverage (`www/tests/input/` — extend `selection-drop.spec.js` or sibling): make a real selection with Playwright mouse events (existing pattern), then `pointerdown` inside it → assert `#terminal.draggable === true` and no anchor reset; outside → unchanged behavior; dispatch synthetic `dragstart` (with DataTransfer) → assert payload + observer notification via `window.__selection.onSelectionDragState`; `dragend` → reset; click-inside-selection → cleared; wrapper blur during pending drag → selection survives.
  - [x] `__resetForTests` extended to clear `selDrag`, affordance classes, depth counter, and `data-bloom`.
- [x] **T7 — UAT doc + verify + mark done**
  - [x] Append a **"Pull pane — drag to pull"** section to `docs/SLIDE-UAT.md`: real-hardware steps (DIR, drag-select names, drop, confirm, watch files land) plus the three explicit hardware checks: (a) does space-separated `SLIDE S F1 F2` work, or only comma-separated per SLIDE_Z80_REQUIREMENT.md:91-94? (b) is a `B:` prefix required to invoke SLIDE from an `A>` prompt (the injected command is currently bare `SLIDE S`; `prefs.slideAutoSendCommand` default `'B:SLIDE R\r'` is the receive-direction precedent, prefs.js:43)? (c) behavior at/near the 126-char line limit. Note in the doc that separator and prefix are each a one-line compose change if hardware disagrees.
  - [ ] Manual checkpoint (cannot be proven synthetically): in a real Chromium session, drag a selection off the canvas — confirm the native drag actually initiates from the pointer-capture-free origination branch, the ghost is suppressed, and the pane drop lands. Record the result (and the fallback decision, if taken — see Dev Notes) in Completion Notes.
  - [x] Full suite green at parallel (`retries:1` policy stands).
  - [ ] Fill the Code Review section; then mark the story done in **all** places (sprint-status.yaml + this file's Status + `last_updated`; run `scripts/check-story-done-consistency.py`). Story goes to `review` first per the dev-story workflow.

## Dev Notes

### The risky part — native DnD from a pointer-captured canvas (read before T1)

Everything else in this story is conventional; this is not. `selection.js`'s pointer handlers call `ev.preventDefault()` + `setPointerCapture()` on every pointerdown (selection.js:122-124). Both are hostile to native HTML5 drag: pointer capture routes subsequent events to the canvas and suppresses the drag operation, and canceling pointerdown suppresses the compatibility mouse events the drag machinery hangs off. Hence the origination branch **skips both**. Consequences you must handle:

- **Focus loss:** without `preventDefault`, a mousedown on the (non-focusable) canvas moves focus off `#terminal-wrapper` → its blur listener (D-19, selection.js:70-74) clears the selection **before dragstart fires**. Two-part mitigation, both required: stash the text at pointerdown (AC-1), and skip the blur-clear while a drag is pending/active. The stash is the source of truth from that moment — never re-read `getSelection()` at drop time.
- **Whole-canvas ghost:** the default drag image for a drag originating on a canvas is the rendered canvas — an 80×24 terminal screenshot glued to the cursor. Suppress with `setDragImage(el, 0, 0)` on a persistent 1×1 transparent element (create once in `wireSelection`; an element not in the DOM or display:none is ignored by Chromium — position it off-screen). No design copy exists for a fancier ghost; the pane affordance carries the feedback. Flag in review if you build anything more.
- **Plain click inside selection:** no motion → no dragstart → `pointerup` must clear the selection (deselect-on-click, consistent with the existing zero-length-drag clear) and reset `draggable` + stash. Don't touch `lastClickTs`/`clickCount` in the origination branch — a deselecting click should not seed a double-click.
- **Sanctioned fallback:** if manual verification (T7) shows the native drag does not reliably initiate from this branch in Chromium, fall back to a pointer-event drag: pointermove past a small threshold enters a tracked drag, `elementFromPoint` drives the pane affordance, pointerup over the pane is the drop (feed the same `onSelectionDrag` + drop path so pane code is identical). This is a recorded deviation, not a redesign — note it in Completion Notes and keep the observer/API surface the same.

### Coexistence with the file-drop path (do not touch it)

`file-source.js`'s four handlers on `#terminal-wrapper` all early-return unless `dataTransfer.types` includes `'Files'` (file-source.js:261-263, each handler re-checks). A text/plain selection drag therefore never triggers the file overlay, never sets `data-drop-target`, and a selection dropped back onto the terminal is silently inert — no edits needed anywhere in file-source.js, and AC-8 forbids them. Symmetrically, the pane's accept predicate keys off `selDrag.active` (set only by our dragstart), so OS file drags and foreign text drags over the pane fall through untouched. Do NOT reuse the `data-drop-target` attribute for the pane — it is the file overlay's contract and `selection.js` early-returns on it (selection.js:113-121).

### Bloom is an overlay, not a reflow

The rail exists because the window is too narrow for the 312px card — blooming by re-widening the flex item would push the stage past the viewport or shift the canvas mid-drag (NFR-5 says the grid never reflows; a canvas that slides under a drag in progress is worse). So bloom overlays: the pane keeps its 30px flow slot, the card paints absolutely above whatever is beneath, and everything returns on un-bloom. Two traps: (1) `#pull-pane` is `container-type: inline-size` and stays 30px wide during bloom, so the `@container (max-width: 90px)` rule that hides `.pp-card` (index.html:595-614) still matches — the `[data-bloom] .pp-card` rule wins on specificity, which is the mechanism, not an accident; comment it. (2) The docked pane must never overlay the canvas (DESIGN.md Do/Don't :241-242) — that rule is about the *persistent* dock; the transient bloom is the designed narrow-window behavior ("blooms open on demand or when a terminal-selection drag begins", FR-2). Cite this note if it comes up in review.

### Known v1 parse trap — DIR-columnar selections (documented, not fixed here)

CP/M `DIR` prints names columnar: `GAME     COM`. The strict FR-7 whitespace split tokenizes that as `GAME` + `COM` — **both individually valid** extension-less 8.3 names — composing `SLIDE S GAME COM`, a request for two files that don't exist. EXPERIENCE.md's Flow 7 (:309-316) narrates the ideal (`GAME     COM` → `GAME.COM` ticked), which the shipped strict parse does not do; the epic locked the strict split for v1 (FR-7) and S9.2 shipped it. The review sub-state is the designed safety net: the wrong command is fully visible before commit and cancel costs nothing. Do NOT bolt on a DIR-reassembly heuristic in this story — it is new parse semantics needing its own AC set (flagged to the PM as a v1.1 candidate). Your spec fixtures should use dot-joined names (`GAME.COM DUMP.BIN`), which is what SLIDE's own transfer log and prompt echo show on screen.

### Open hardware questions (operationalized in T7, not blocking)

S9.2's code review deferred two questions here; investigation resolved what the repo can and left the rest to hardware:
- **Separator:** `docs/SLIDE_Z80_REQUIREMENT.md:91-94` documents `B:SLIDE S FILE.TXT,FILE2.TXT,...` (commas), but `docs/SLIDE-UAT.md:90` instructs `B:SLIDE S EMPTY.TXT SHORT.TXT BIG.BIN` (spaces) and S9.2 shipped + spec-locked spaces. Keep spaces; T7's UAT run settles it against real firmware (upstream `github.com/blowback/slide` — no Z80 source in this repo to consult).
- **`B:` prefix:** the receive direction auto-types `'B:SLIDE R\r'` (prefs.js:43 default), but the composed pull command is bare `SLIDE S ...` per FR-4. From an `A>` prompt with SLIDE.COM on B:, bare `SLIDE` may not resolve. T7 checks; if hardware demands it, the fix is a one-line prefix constant in `composeFromText` (+ spec updates) — do not pre-emptively add it.
- **Length cap:** no CCP buffer documentation exists in-repo; 126 is the conservative standard-CP/M figure. T7 verifies behavior near the limit.

### What S9.1a/b/S9.2 left you (current shapes — verified 2026-07-23)

- **`pull-pane.js` (651 lines):** state `{folderName, permission, files, view, review}` + module vars `dirHandle`, `epoch`, `lastSnapshot`, `freshNames`. API: `render`, `refresh: triggerRefresh`, `beginReview(text) → boolean`, `dispose`, `__getStateForTests`, `__resetForTests`, `__setDirHandleForTests`, `__setSlideActiveForTests`, `__timerTickForTests`. `beginReview` (:421-427) already refuses while suspended and handles zero-valid. `slideActiveNow()` (:379-382) honors the test override then the injected predicate. `render()` projects `data-view = review ? 'review' : view`; review touches neither `epoch` nor the diff-render snapshots. Helpers `pluralFiles` (:594) / `formatSize` (:588) are module-private — reuse `pluralFiles` for the footer count.
- **Injected opts (main.js:620-658):** `paneEl, idb{getRecvDirHandle, setRecvDirHandle+pref-sync}, retainFocus, terminalWrapper, validateCpmFilename, truncateCpm83, pushTxBytes, isSlideActive: () => isSlideActive() || getWireOwner() === 'slide', isWriterReady, getEnterBytes`. The composed suspension predicate covers recv sessions AND send-side wire ownership (S9.2 review fix #1) — your drop path inherits all of it through `slideActiveNow()`/`beginReview` for free.
- **`selection.js` (349 lines):** `wireSelection(opts)` (:45) attaches pointer handlers, returns `{getActiveRange, getSelection, clearSelection, isDragging, cancelDrag, onSelectionChange, dispose}`. `getSelection()` (:268) → `{rows: string[]} | null` (per-row trailing whitespace trimmed, D-23) — join with `'\n'`. `getActiveRange` (:230) shows the exact normalization to clone for the hit-test. `pxToCellWithScrollOffset` (:88) is the px→cell mapping. Existing `onSelectionChange` observers receive only `{hasSelection}` — that's why the new drag observer carries the text.
- **Transfer-done plumbing (S9.1b, already proven):** `wireSlideRecv({..., onFileLanded: pullPane.refresh})` (main.js:~1094) fires per landed file, after the folder write completes (slide-recv.js:513-516); `triggerRefresh` is idempotent via the epoch guard, so multi-file pulls refreshing N times is fine. S9.2 review fix #3 means choosing a folder from the pane also enables `prefs.slideRecvToFolder` — a pane-bound folder always receives.

### Voice / microcopy (verbatim where sourced)

- Drop-active footer: **"⤓ Drop to pull {n} files"** (EXPERIENCE.md:130; Flow 7 shows "⤓ Drop to pull 2 files"). Zero-valid drag shows "⤓ Drop to pull 0 files" — honest but unsourced; flag in review if reworded.
- Resting footer (already shipped, restore on clear): **"Drag a filename selection here to pull"**.
- Rail title (replaces the shipped "Pull folder"): **"Click or drag a selection here to open the pull pane"** (mockup pull-pane.html Frame E).
- Length-cap skip reason (proposed, no sourced copy): **"over the 126-char CP/M command-line limit"** — flag if reworded.

### Testing standards

- Same conventions as S9.1a/b/S9.2: boot-race guard on `window.__pullPane`, `__resetForTests()` in `beforeEach`, fake handle via `__setDirHandleForTests`, `@fast`, chromium project, `retries:1` (playwright.config.js:20-27), no per-story worker overrides. Restore any global state touched (`setCrlfMode('cr')`, tx-observer arrays).
- Synthetic DnD: build `new DataTransfer()` in-page, `setData`, dispatch `new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: dt})` — tests the handlers deterministically. The native drag *loop* (does Chromium start the drag from our branch at all) is only provable manually — hence the T7 checkpoint; don't burn time trying to synthesize it in Playwright.
- `selection-drop.spec.js` already shows the pattern of asserting selection behavior against attribute state; extend beside it rather than starting a new spec file for origination.

### Project Structure Notes

- Files: **UPDATE** `www/input/selection.js` (origination branch, dragstart/dragend, observer, D-19 guard), **UPDATE** `www/renderer/pull-pane.js` (`onSelectionDrag`, drop handlers, affordance, bloom, length cap), **UPDATE** `www/index.html` (drop/bloom CSS, rail title), **UPDATE** `www/main.js` (one connection line after `wireSelection`), **UPDATE** `www/tests/render/pull-pane.spec.js` + selection spec, **UPDATE** `docs/SLIDE-UAT.md`. Explicitly NO changes: `slide-recv.js`, `tx-sink.js`, `file-source.js`, anything Rust/wasm.
- API growth watch (E4 #5, still open): the sanctioned additions are exactly `onSelectionDrag` on the pane, `onSelectionDragState` on selection, and the two `__getStateForTests` booleans. Nothing else.
- The review remains in-pane (no `openModal`, no `<dialog>`, AD-8 not used — standing E9 decision); this story adds no modal surface either.
- Standing conventions: mark story done in **all** places (sprint-status + Status + `last_updated`, via `scripts/check-story-done-consistency.py`); record the code-review outcome in this file.

### References

- [Source: epics-pull-pane.md — Story S9.3 (:205-235); FR-2/4/6/7/8/11; NFR-1/2/4/5; UX-DR3/DR4; Additional Requirements]
- [Source: ARCHITECTURE-SPINE.md — AD-3 (:80-84 allowlist), AD-9 (:110-114), AD-10, AD-11 (:121-132 sanctioned pane conditions), AD-12 (:134-137 boot order)]
- [Source: ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md — :130 (footer copy), :204-216 (pane states incl. rail bloom + fresh markers), Flow 7 :309-316]
- [Source: ux-designs/ux-beastty-2026-07-01/DESIGN.md — :128 (rail/bloom), :131 (dropActive token), :162+:241-242 (no-red + Do/Don't rules)]
- [Source: ux-designs/ux-beastty-2026-07-01/mockups/pull-pane.html — :103-108 (drop CSS), :97-98 (fresh marker), Frame E :350-377 (rail + title copy)]
- [Source: docs/SLIDE_Z80_REQUIREMENT.md:91-94 (comma syntax + B: prefix), :143-149 (upstream Z80 status); docs/SLIDE-UAT.md:90 (space syntax)]
- [Source: www/input/selection.js — :45-85 (wireSelection), :88-110 (px→cell), :113-179 (pointer handlers), :230-299 (getActiveRange/getSelection), :320-326 (observer shape)]
- [Source: www/input/file-source.js:260-340 (drag handlers + isFileDrag + depth counter + data-drop-target)]
- [Source: www/renderer/pull-pane.js (all, esp. :379-382, :421-427, :594); www/main.js:620-658 (wirePullPane), :756 (wireSelection), :~1094 (onFileLanded); www/state/prefs.js:43; www/index.html:291 (color-mix precedent), :479-508 (pane CSS), :595-614 (container query)]
- [Source: _bmad-output/implementation-artifacts/e9-2-selection-to-slide-s-in-pane-review.md — Dev Notes + Change Log :165 (deferred questions); e9-1a-...md :33+:145 (rail stub + container-query rationale)]

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) via Claude Code — 2026-07-23.

### Implementation Plan

Followed the story task order T1→T7. T1: origination branch in `onPointerDown` slotted after the `data-drop-target`/button checks and before `preventDefault`/`setPointerCapture`; the hit test (`isCellInSelection`) clones `getActiveRange`'s normalization; dragstart/dragend listeners registered in `wireSelection`, removed in `dispose`; text stashed at pointerdown; D-19 blur guard skips while `dragPending || dragActive`; new `onSelectionDragState` observer clones the `onSelectionChange` shape. T2: pane drag handlers with `dropAcceptable()` predicate (`selDrag.active && !slideActiveNow() && view list|empty`), depth-counted affordance classes + footer swap, drop → `beginReview(getData || stash)`. T3: `data-bloom` attribute overlay ( `#pull-pane[data-bloom] .pp-card` at specificity (0,2,0) out-ranks the container-query hide rule), bloom on dragstart/rail-click while `railVisible()`, un-bloom on dragend-sans-review / review exit / pointerdown-outside (click-bloom only). T4: `MAX_COMMAND_CHARS = 126` accumulation cap in `composeFromText`, overflow tokens → skipped rows with the proposed reason string. T5: one connection line in main.js after `wireSelection`. T6: 13 new pane specs + 5 origination specs, all `@fast`, synthetic `DataTransfer`/`DragEvent` driving.

### Debug Log References

- First spec run: 2 real failures. (1) `getCellSize` in `selection-drop.spec.js` silently fell back to 9×18 (its `window.__metrics` hook never existed) — "row 1" clicks landed inside the row-0 selection; fixed by reading `window.__getActiveCellSize()` in the new describe. (2) `dataTransfer.effectAllowed` reads back `'none'` on a synthetic DataTransfer (Chromium honours the setter only on a real drag session's data store) — assertion dropped with a comment; the code still sets it, provable only in the T7 manual run.
- Full-suite run: 3 real regressions in existing specs (triple-click line select, clipboard trim, scrolled-back copy) — the origination branch was intercepting the 2nd/3rd clicks of multi-click sequences, which land inside the selection the previous click created. Fixed: the origination branch yields when the pointerdown continues a multi-click sequence (same 400 ms/same-cell window the click counter uses). AC-1's "double/triple click unchanged" now holds; suite re-run green.

### Completion Notes List

- All ACs implemented and spec-covered; full suite: 622 passed, 0 failed, 1 skipped (pre-existing), 15 flaky-passed-on-retry (the documented boot-under-load contention in files this story does not touch; ratified `retries:1` policy).
- **Manual checkpoint (T7) still open — needs Ant in a headed Chromium session:** confirm the native drag actually initiates from the pointer-capture-free origination branch (drag a selection off the canvas), the canvas-screenshot ghost is suppressed, and the pane drop lands. The sanctioned pointer-event fallback (Dev Notes) remains unused. UAT-E9-01 in docs/SLIDE-UAT.md also covers this on real hardware.
- Deviation (recorded): AC-8 says "no new retainFocus wiring", but the rail became a click surface in this story, and a bare div click would blur `#terminal-wrapper` (breaking the same AC's focus invariant). Wired the rail through the injected `retainFocus` (AD-10's sanctioned mechanism — hand-rolling the mousedown suppression is exactly what AD-10 forbids). Spec asserts rail-click keeps wrapper focus.
- Bloom z-index chosen as 8: above the canvas-level chips/overlays (z:5–6), below menu layers (z:20+) and the native `<dialog>` top layer.
- "Zero-valid drag shows '⤓ Drop to pull 0 files'" (unsourced, flagged in the story) — shipped as specified via `pluralFiles(0)`; no rewording.
- Length-cap reason string shipped verbatim as proposed: "over the 126-char CP/M command-line limit".
- Rail/badge double-paint check (T3): the bloomed card paints an opaque `--chrome-bg` background over the 30 px rail slot; bloom specs assert card visibility + zero canvas movement.

### File List

- www/input/selection.js — origination branch, hit test, dragstart/dragend, D-19 guard, `onSelectionDragState`, dispose teardown
- www/renderer/pull-pane.js — `onSelectionDrag`, drop handlers + affordance, rail bloom, 126-char cap, test-hook booleans, reset/dispose teardown
- www/index.html — `.pp-card.drop` / `.pp-foot.drop-active` CSS, `#pull-pane[data-bloom]` bloom CSS, `position: relative` on `#pull-pane`, rail title copy
- www/main.js — one connection line: `selection.onSelectionDragState((s) => pullPane.onSelectionDrag(s))`
- www/tests/render/pull-pane.spec.js — S9.3 drop-to-pull + rail-bloom describes (13 specs)
- www/tests/render/selection-drop.spec.js — S9.3 drag-origination describe (5 specs)
- docs/SLIDE-UAT.md — UAT-E9-01 "Pull pane — drag to pull" section + three hardware checks; summary counts
- _bmad-output/implementation-artifacts/sprint-status.yaml — story status transitions
- _bmad-output/implementation-artifacts/e9-3-drop-to-pull-fire-land-refresh.md — this file

## Change Log

- 2026-07-23 — Story created (ultimate context engine analysis completed — comprehensive developer guide created). Status: ready-for-dev.
- 2026-07-23 — Implementation complete (T1–T6 + UAT doc): drag origination, pane drop target + UX-DR3 affordance, rail bloom, 126-char cap, composition-root wiring, 18 new specs; one multi-click regression found and fixed during full-suite verification. Manual native-drag checkpoint left open for the user. Status: review.

## Code Review

_(fill on completion: N findings, severity, fix sha — required before marking done per scripts/check-story-done-consistency.py)_
