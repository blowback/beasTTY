---
baseline_commit: 0044eadd01cb23184a2f6562100b4b4343e3f2a8
---

# Story 9.2: Selection to `SLIDE S` command with reviewable in-pane preview

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast daily driver,
I want a terminal text selection turned into a reviewable `SLIDE S <files>` command,
so that I can pull named files by picking them on screen instead of retyping the command — without risking a silent request for a file that doesn't exist.

This is the **third** story of Epic E9. S9.1a shipped the pane shell (views: first-run / permission / empty / list) and S9.1b made the list live (guarded `triggerRefresh`, diff-render, fresh markers). This story adds the pane's one genuinely new piece of logic — selection text → validated CP/M 8.3 tokens → composed `SLIDE S ...` line — plus the **in-pane review sub-state** (list swaps to review; no modal, no scrim) and the confirm→inject / cancel ceremony. The drop *gesture* that will feed it is S9.3; here the entry point is a public API method.

## Scope boundary (read first)

**IN scope (S9.2):** FR-4, FR-5, FR-7, FR-11 — tokenize + validate a selection string, compose the `SLIDE S` line, render the review sub-state (aligned rows + ⓘ tooltip), confirm → push command + configured Enter terminator via the injected `pushTxBytes`, cancel → nothing sent, and suspension of compose/inject while a SLIDE session is active. Entry point: a new public API method `beginReview(text)` on the pane (callable by tests now, by S9.3's drop handler next).

**OUT of scope — do NOT build here:**
- **Drag/drop wiring + drop-target affordance** (UX-DR3, the dragover/drop DOM handlers, rail bloom-on-drag) → **S9.3**. No `getSelection()` call lands in this story either — S9.3's drop handler reads the selection and feeds its text to `beginReview`.
- **End-to-end pull proof** (FR-6: command fires → device sends → files land → list refreshes) → **S9.3**. The confirm→`pushTxBytes` machinery is built and spec-verified *here*; S9.3 exercises it from a real drop and owns the land-and-appear proof. (Same pattern as S9.1b's transfer-done hook: build + unit-verify now, prove end-to-end later.)
- **Reverse drag** (FR-12) → **S9.4**.

## Acceptance Criteria

1. **Strict parse + compose (FR-4, FR-7).** `beginReview(text)` splits `text` on whitespace/newlines (`/\s+/`, empty tokens dropped, selection order preserved). A token is **valid** iff `validateCpmFilename(token).ok && truncateCpm83(token) === token` — i.e. it passes the existing validator AND is already an uppercase name that fits 8.3 without truncation (idempotence check; see Dev Notes "Why idempotence, not truncation"). Exact-duplicate valid tokens collapse to the first occurrence. The composed command is the string `SLIDE S ` + valid names joined by single spaces (no trailing space) — `SLIDE S` verbatim, uppercase.
2. **Skipped tokens are flagged, never silent (FR-7).** Every token appears as a review row: valid → `✓` (mark in `--chrome-accent`) + name; invalid → `✗` + struck-through name in `--chrome-muted` + right-aligned "skipped ⓘ" where the ⓘ carries `title="Not a CP/M 8.3 name (name ≤8, ext ≤3, uppercase). v1 only pulls 8.3 names."` (verbatim — EXPERIENCE.md:133, mockup pull-pane.html:282). Tokens rejected by `validateCpmFilename` may surface its specific `reason` instead; tokens that fail only the idempotence check use the 8.3 tooltip. Never red (`--chrome-invalid-strong` is reserved; DESIGN.md color rules).
3. **In-pane review sub-state (FR-5, UX-DR2, AD-9).** On `beginReview` with ≥1 token, the pane body swaps to the review: caption reads **"Review — pull to this folder"**, the composed line renders in a bordered command row with a mint `›` prefix, token rows below, then a `.pp-actions` footer with **[Cancel]** (secondary) + **[Pull N files]** (primary, count = valid names, singular "Pull 1 file"). No modal, no `openModal`, no scrim — the canvas stays live behind it. Projection stays `data-view` / `[hidden]` only; CSS is `--chrome-*` tokens only, identical CRT↔Console. **Review survives refresh:** the review flag is stored separately from the content view, so a background `triggerRefresh` (timer/focus/transfer-done) updates the underlying list state without exiting or repainting the review.
4. **Confirm / cancel (FR-5).** Confirm pushes ONE `pushTxBytes` call: ASCII bytes of the composed command + the configured Enter terminator (`CRLF_MODES[getCrlfMode()]` — injected as a `getEnterBytes()` closure), then exits review back to the content view. Cancel transmits nothing and exits review (the underlying view re-renders, picking up any refresh that happened meanwhile). Both buttons use `retainFocus` (AD-10).
5. **Zero valid names → no empty `SLIDE S` (FR-7).** With zero valid tokens (all skipped, or empty/whitespace-only text) the review still opens: skipped rows (if any) render, the command row is replaced by the message **"Nothing to pull — no CP/M 8.3 names in the selection."**, and [Pull…] is `disabled`. No code path can transmit a bare `SLIDE S`.
6. **Suspension while SLIDE is active (FR-11).** When `isSlideActive()` is true: `beginReview` is a no-op (returns `false`, review does not open) and a confirm re-checks and refuses to push (review stays open). This mirrors the paste-pump precedent (paste-pump.js:47). `pushTxBytes`'s own silent drop when the wire owner is `slide` (tx-sink.js:50) remains a backstop, not the mechanism.
7. **Architecture compliance (NFR-2).** `pull-pane.js` still direct-imports nothing: `validateCpmFilename`, `truncateCpm83` (from `input/file-source.js`), `pushTxBytes` (from `input/tx-sink.js`), `isSlideActive` (from `transport/slide-recv.js`), and the `getEnterBytes` closure (over `keyboard.js` `getCrlfMode`/`CRLF_MODES`) all arrive via `wirePullPane(opts)` extended in `main.js` (AD-3). Existing S9.1a/S9.1b behavior (bind, permission, refresh triggers, diff-render, fresh markers, rail) is untouched.
8. **Test hooks + spec (NFR-4).** API + `window.__pullPane` gain `beginReview(text)` and `__setSlideActiveForTests(boolOrNull)` (overrides the injected `isSlideActive`; cleared by `__resetForTests`). `__getStateForTests()` gains `review: null | { command, tokens: [{raw, name, ok, reason}], validCount }`. `www/tests/render/pull-pane.spec.js` is extended (same file, same patterns) to cover: token classification (valid / lowercase / over-length / invalid-char / duplicate); composed-command text; skipped-row rendering + verbatim tooltip title; confirm → exactly the command + `0x0D` bytes observed (via `registerTxObserver`), and a `crlf`-mode variant → `0x0D 0x0A`; cancel → zero bytes + view restored; zero-valid → disabled confirm + message; suspension (beginReview refused, confirm refused); refresh-during-review stays in review; focus retention on both buttons. All `@fast`; full suite green under the ratified `retries:1` policy.

## Tasks / Subtasks

- [x] **T1 — Review markup + CSS (AC: 2, 3, 5)**
  - [x] `index.html`: inside `.pp-card`, add `#pull-pane-review` (hidden) — command row (`.pp-cmdline` with `›` prefix span), token list (`.pp-tok` rows: `.mk` mark / `.nm` name / `.why` reason + `.pp-info` ⓘ), zero-valid message node — and `.pp-actions` with `<button type="button" class="pp-btn" id="pull-pane-cancel">Cancel</button>` + `<button type="button" class="pp-btn pp-btn-primary" id="pull-pane-confirm">…</button>`. Follow the mockup markup shape (pull-pane.html:276-289) but reuse the shipped `.pp-btn` class (index.html:521-530) rather than the mockup's `.btn`.
  - [x] CSS on the mockup pattern (pull-pane.html:112-141) translated to shipped tokens: command row = 1px `var(--chrome-border)` border, radius 4px, background = the same subtle treatment as `.pp-row:hover` (the S9.1b precedent for reusing the accent tint); `›` in `var(--chrome-accent)`; skip rows `var(--chrome-muted)` + `line-through` name; ⓘ = 14px bordered circle, muted. Primary button: `var(--chrome-accent)` background, `var(--chrome-bg)` text, plus a `:disabled` treatment. `--chrome-*` only, no `[data-theme]` branches (AD-9). _(Deviation: command-row background uses the shipped theme-independent `var(--field-bg)` token — what the mockup's `.cmdline` itself specifies — rather than the `.pp-row:hover` solid-accent fill, which would make the mint `›` prefix invisible on its own colour. No new colour was invented; see Completion Notes.)_
  - [x] `data-view="review"` projection: review + actions visible, list/blank/foot hidden; caption text swaps to "Review — pull to this folder" (restore normal caption on exit).
- [x] **T2 — Tokenize + validate + compose (AC: 1, 2, 5)**
  - [x] In `pull-pane.js`: `composeFromText(text)` (pure, module-private) → `{ tokens: [{raw, name, ok, reason}], validCount, command|null }`. Split `/\s+/`; per token run injected `validateCpmFilename` → if `!ok` keep its `reason`; else check `truncateCpm83(token) === token` → mismatch = skipped with the 8.3 reason; `name` = the token itself for valid rows (already uppercase by definition). Dedupe exact-duplicate valid names (first occurrence wins). `command = 'SLIDE S ' + names.join(' ')` or `null` when `validCount === 0`.
  - [x] Do NOT re-implement any filename rule locally — the two injected functions are the only validators (epic AC; see Dev Notes for the accepted multi-dot edge).
- [x] **T3 — Review sub-state + confirm/cancel + suspension (AC: 3, 4, 5, 6)**
  - [x] `state.review = null | {command, tokens, validCount}` — a flag **separate from `state.view`**; `render()` projects `data-view = state.review ? 'review' : state.view`. Refresh paths keep mutating list state underneath; they must not touch `state.review` (and the diff-render skip already avoids DOM churn).
  - [x] `beginReview(text)`: if injected-or-overridden `isSlideActive()` → return `false`; compose; set `state.review`; `render()`; return `true`. Zero tokens (empty text) also opens review with the zero-valid message (AC-5) so S9.3's drop of a prose-only selection has something to show.
  - [x] Confirm handler: re-check `isSlideActive()` → refuse (stay in review); else build bytes = `TextEncoder().encode(command)` + `getEnterBytes()`, ONE `pushTxBytes(bytes)` call, clear `state.review`, `render()`. Cancel: clear `state.review`, `render()`. Both buttons wired with `retainFocusRef(btn)` like choose/grant (AD-10). Confirm button label via the existing `pluralFiles` helper ("Pull 2 files" / "Pull 1 file"); `disabled` when `validCount === 0`.
  - [x] `dispose()` removes the two new click handlers. `__resetForTests()` clears `state.review` + the slide-active override.
- [x] **T4 — Composition-root wiring (AC: 7)**
  - [x] `main.js`: import `validateCpmFilename`, `truncateCpm83` from `./input/file-source.js`, `pushTxBytes` from `./input/tx-sink.js`, `isSlideActive` from `./transport/slide-recv.js` (paste-pump.js:11-18 shows the same imports); `getCrlfMode`/`CRLF_MODES` are already imported for keyboard wiring — reuse. Extend the `wirePullPane({...})` call (main.js:588-594) with `validateCpmFilename, truncateCpm83, pushTxBytes, isSlideActive, getEnterBytes: () => CRLF_MODES[getCrlfMode()]`. No boot-order change; `window.__pullPane` picks up the new API automatically. _(One delta: `CRLF_MODES` was not yet imported in main.js — added to the existing keyboard.js import line.)_
- [x] **T5 — Playwright spec (AC: 8)**
  - [x] Extend `www/tests/render/pull-pane.spec.js` (same boot-race guard, `__resetForTests` in `beforeEach`, `@fast`). Drive review via `page.evaluate(() => window.__pullPane.beginReview('...'))`.
  - [x] Classification test: `'GAME.COM notes.txt TOOLONGNAME.TXT BAD:NM GAME.COM DUMP.BIN'` → valid `[GAME.COM, DUMP.BIN]` (dup collapsed), skipped rows for `notes.txt` (8.3 reason), `TOOLONGNAME.TXT` (8.3 reason), `BAD:NM` (validator reason mentions `:`); `command === 'SLIDE S GAME.COM DUMP.BIN'`; confirm label "Pull 2 files".
  - [x] Byte capture: `page.evaluate` → `import('/input/tx-sink.js')` (same ESM singleton) → `registerTxObserver` pushing into a window array; confirm → assert exactly ASCII `SLIDE S GAME.COM DUMP.BIN` + `0x0D`. Variant: `import('/input/keyboard.js')` → `setCrlfMode('crlf')` → terminator `0x0D 0x0A`; restore `'cr'` after. _(Capture shape: `registerTxObserver` notifies without arguments, so the observer counts pushes — proving the ONE-push contract — while the exact bytes are read back from the ring via `resetTx()` + `formatHexStrip(1024)`.)_
  - [x] Cancel / zero-valid / suspension (`__setSlideActiveForTests(true)` → `beginReview` returns false; open review first, then set active → confirm pushes nothing, review persists) / refresh-during-review (`__timerTickForTests()` with changed fake-handle contents → still `data-view="review"`, review DOM untouched) / tooltip verbatim title / focus retention (click both buttons → `#terminal-wrapper` keeps focus).
- [x] **T6 — Verify + mark done**
  - [x] Full suite green at parallel (`retries:1` policy stands — no per-story `--workers=1` re-diagnosis).
  - [ ] Fill the Code Review section; then mark the story done in **both** sprint-status.yaml **and** this file's Status + `last_updated` (run `scripts/check-story-done-consistency.py`). Story goes to `review` first per the dev-story workflow; done-marking follows the code-review pass.

## Dev Notes

### Why idempotence, not truncation (the one semantic that differs from the send path)
On **send**, `truncateCpm83` renames the outgoing file to fit the device — truncation is the feature. On **pull**, the command must request the **exact name the device has**: truncating `LONGNAME.TEXT` to `LONGNAME.TEX` would silently request a *different* file — precisely the "silent request for a file that doesn't exist" this story exists to prevent. Hence the predicate `validateCpmFilename(t).ok && truncateCpm83(t) === t`: it reuses both existing functions verbatim (the epic AC's explicit requirement — no new validator) and rejects anything truncation would alter. Because `truncateCpm83` uppercases, the idempotence check also rejects lowercase/mixed-case tokens — which is exactly the mockup's behavior (`notes.txt` is skipped, pull-pane.html:281-283) and the UX rationale: CP/M directory listings are uppercase, so lowercase tokens are prose, not filenames.

**Accepted v1 edge:** `MY.TAR.GZ` passes both checks (validator allows `.` in the base; truncate splits on the *final* dot and returns it unchanged). It is not a real CP/M name, but adding a dot-in-base rule would be a new validator — out of scope per the epic AC, and consistent with what the send path accepts today. Note it in the review only if it comes up.

### Review is a flag, not a fifth view — refresh must not evict it
S9.1b's `triggerRefresh` fires from the ~60s timer, window focus, and transfer-done, and its render path repaints views. If `'review'` were a `state.view` value, any content-changing refresh would recompute the view and throw the user out of their review mid-decision. Store review separately (`state.review`), have `render()` prefer it for the `data-view` projection, and leave every refresh path untouched — the underlying list state stays live and simply shows (with fresh markers) the moment review exits. The refresh paths already never write `state.view` to `'review'`, so no guard is needed inside `triggerRefresh` — just don't let the review swap touch `lastSnapshot`/`freshNames` either.

### Suspension semantics — mirror paste-pump, re-check at confirm
`isSlideActive()` (slide-recv.js:373) is the session predicate paste-pump uses (paste-pump.js:47): true while the SLIDE state machine is neither idle, done, nor errored. Check it at `beginReview` (a drop during a transfer composes nothing) AND at confirm (a transfer that started while the review sat open must not be corrupted by injected keystrokes — SLIDE owns the wire). On confirm-refusal keep the review open; the user confirms again after the transfer. Do not build queuing/retry. `pushTxBytes`'s owner check (tx-sink.js:50) silently drops when owner is `slide` — that backstop is why one combined push (command + terminator in a single call) matters: two pushes could straddle an owner flip and send half a command.

### One push, exact bytes
`bytes = [...TextEncoder().encode(command), ...getEnterBytes()]` → single `pushTxBytes(Uint8Array)`. `getEnterBytes` is a main.js closure over `CRLF_MODES[getCrlfMode()]` (keyboard.js:70-74, 97-101) — read **at confirm time**, not captured at wire time, so a Settings change mid-session is honored (same live-read behavior as keyboard Enter and paste-pump). No local echo concerns: this is an injected command, same as paste — the device echoes.

### What S9.1a/S9.1b left you (current `pull-pane.js` shape)
- API: `wirePullPane(opts)` → `{ render, refresh: triggerRefresh, dispose, __getStateForTests, __resetForTests, __setDirHandleForTests, __timerTickForTests }`; opts = `{ paneEl, idb, retainFocus, terminalWrapper }` (main.js:588-594). State: `{ folderName, permission, files, view: 'first-run'|'permission'|'empty'|'list' }` + module vars `dirHandle`, `epoch`, `lastSnapshot`, `freshNames`.
- `render()` projects via `cardEl.setAttribute('data-view', …)` + `[hidden]` on sub-containers; **no inline styles** (index.html:1731-1758 documents the contract). Add the review projection the same way.
- The epoch guard protects *enumeration* results; review does not enumerate, so it needs no epoch — but don't let review entry/exit bump the epoch either (it would needlessly cancel an in-flight refresh).
- `pluralFiles`/`formatSize` helpers exist module-private (S9.1b review deferred their extraction — reuse `pluralFiles` for the confirm label, don't duplicate).
- The `↻` button, choose/grant buttons show the `retainFocusRef(btn)` wiring pattern to copy for Cancel/Pull.

### APIs to reuse (verified present — do not reinvent)
- `input/file-source.js:609` `validateCpmFilename(name)` → `{ok, reason|null}` (rejects empty, leading-dot, control chars, non-ASCII, `< > ; : = ? * [ ]`; does NOT check length/case). `:640` `truncateCpm83(name)` → uppercased, base≤8/ext≤3 split on final dot. Both are pure named exports.
- `input/tx-sink.js:46` `pushTxBytes(bytes)` (accepts `Uint8Array`; `:50` silent drop when owner `slide`); `:87` `registerTxObserver(fn)` — the spec's byte-capture surface.
- `transport/slide-recv.js:373` `isSlideActive()` → boolean, exception-safe.
- `input/keyboard.js:70-74` `CRLF_MODES` (`cr`→`[0x0D]`, `lf`→`[0x0A]`, `crlf`→`[0x0D,0x0A]`); `:101` `getCrlfMode()`. Pref lives at `state/prefs.js:26` (`crlfMode: 'cr'` default) — no direct prefs read needed; go through the closure.
- `input/selection.js:269` `getSelection()` → `{rows: string[]}|null` — **not used in this story** (S9.3's drop handler joins `rows` with `\n` and calls `beginReview`); listed so nobody wires it early.
- `renderer/focus.js` `retainFocus` — already injected as `retainFocusRef`.

### Files to create / modify
- **UPDATE** `www/renderer/pull-pane.js` — `composeFromText`, `state.review` + projection, `beginReview`, confirm/cancel handlers + suspension, `__setSlideActiveForTests`, extended `__getStateForTests`/`__resetForTests`/`dispose`.
- **UPDATE** `www/index.html` — `#pull-pane-review` + `.pp-actions` markup inside `.pp-card`; review CSS (`--chrome-*` only).
- **UPDATE** `www/main.js` — three new imports + `getEnterBytes` closure; five new opts at the `wirePullPane({...})` call (:588-594).
- **UPDATE** `www/tests/render/pull-pane.spec.js` — extend, same file. No other file changes; explicitly none in `slide-recv.js` / `tx-sink.js` / `selection.js` / `file-source.js`.

### Voice / microcopy (verbatim where sourced)
- ⓘ tooltip (verbatim, EXPERIENCE.md:133 + mockup :282): **"Not a CP/M 8.3 name (name ≤8, ext ≤3, uppercase). v1 only pulls 8.3 names."**
- Review caption (verbatim, mockup :275): **"Review — pull to this folder"** · Skip label: **"skipped ⓘ"** · Buttons: **"Cancel"** / **"Pull N files"** (mockup :287-288 shows "Pull 2 files").
- Zero-valid message (proposed — no sourced copy exists; matches the terse voice): **"Nothing to pull — no CP/M 8.3 names in the selection."** Flag in review if you reword.

### Testing standards
- Same conventions as S9.1a/b: boot-race guard on `window.__pullPane`, `__resetForTests()` in `beforeEach`, fake handle via `__setDirHandleForTests`, `@fast`, chromium project, `retries:1` (playwright.config.js:20-27), no per-story worker overrides.
- Same-module ESM imports inside `page.evaluate` (`import('/input/tx-sink.js')`) hit the already-loaded singleton — the established pattern from file-source.spec.js pure-function tests. Restore global state you touch (`setCrlfMode('cr')`, delete the tx-observer array) so later specs see reality.
- `__setSlideActiveForTests` overrides the *injected* function reference inside pull-pane (null restores) — cheaper and more deterministic than standing up a real recv session, mirroring the `__setDirHandleForTests` approach to unhostable browser state.

### Project Structure Notes
- Same component, same wiring — no new modules, no boot-order change, no `slide-recv.js`/`tx-sink.js`/`selection.js` edits, zero Rust/wasm/protocol changes (NFR-1). The only cross-module delta is five injected opts at the composition root (paste-pump.js:11-18 is the import precedent for three of them).
- The review deliberately does NOT use `openModal` (AD-8) — the 2026-07-23 UX decision superseded the earlier modal assumption; E9 has no dependency on the modal surface. Do not add a `<dialog>`.
- Standing conventions: mark story done in **all** places (sprint-status + Status front-matter + `last_updated`, via `scripts/check-story-done-consistency.py`); record the code-review outcome in this file; keep the pane API lean (E4 #5 watch, still open — `beginReview` + two test hooks is the whole growth).

### References
- [Source: epics-pull-pane.md — Story S9.2 (lines 175-203); FR-4/5/7/11; NFR-1/2/4; UX-DR2; Additional Requirements]
- [Source: ARCHITECTURE-SPINE.md — AD-1/2/3 (allowlist), AD-8 (not used, by decision), AD-9, AD-10, AD-11, AD-12]
- [Source: ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md:133 (skip reason verbatim), :152 (component pattern row), :204-217 (pane states incl. review), Flow 7]
- [Source: ux-designs/ux-beastty-2026-07-01/DESIGN.md — pull-pane component block; color rules (no red in review)]
- [Source: ux-designs/ux-beastty-2026-07-01/mockups/pull-pane.html:112-141 (review CSS), :252-298 (Frame C review markup, buttons, caption)]
- [Source: www/renderer/pull-pane.js (all); www/index.html:451-543, 1731-1760; www/main.js:588-594; www/input/file-source.js:609-649; www/input/tx-sink.js:46-120; www/input/paste-pump.js:11-18, 47; www/input/keyboard.js:70-101; www/transport/slide-recv.js:373; www/input/selection.js:269-299; www/tests/render/pull-pane.spec.js; www/tests/input/file-source.spec.js]
- [Source: _bmad-output/implementation-artifacts/e9-1b-live-refresh-triggers-guards-diff-render.md — Completion Notes + Code Review (epoch guard, diff-render internals, helper duplication deferral)]

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) via Claude Code — 2026-07-23.

### Implementation Plan

- Review stored as `state.review` (a flag beside `state.view`, per Dev Notes): `render()` projects `data-view = review ? 'review' : view` and, while reviewing, only toggles `[hidden]` — it never repaints the review body or the list. Review content is painted exactly once, by `renderReview()` from `beginReview()`, so refresh-triggered renders cannot churn an open review.
- Valid-token predicate implemented verbatim: `validateCpmFilename(t).ok && truncateCpm83(t) === t` — no local filename rules; validator failures carry the validator's `reason`, idempotence failures carry the verbatim 8.3 tooltip string.
- Confirm builds command + terminator into one `Uint8Array` and makes ONE `pushTxBytes` call; `isSlideActive` is re-checked at confirm and refusal keeps the review open. `getEnterBytes` is read at confirm time (live CR/LF pref).
- Red-green: the nine S9.2 specs were written and run first (all failed — `beginReview` absent), then T1–T4 were implemented and the same specs went green without modification.

### Debug Log References

- Red run: 9/9 new S9.2 specs failed pre-implementation (beginReview undefined), as expected.
- Green run: 9/9 S9.2 specs passed first try post-implementation.
- Full suite at parallel: run 1 — 556 passed / 1 skipped / 0 failed; run 2 — 560 passed / 12 flaky-passed-on-retry / 1 skipped / 0 failed. Flaky set is the known wasm-boot-under-parallelism contention in transport/boot specs, accepted under the ratified `retries:1` policy (playwright.config.js:20-27) — no per-story re-diagnosis.

### Completion Notes List

- ✅ All eight ACs implemented and spec-covered; the nine new tests are all `@fast` in the existing `www/tests/render/pull-pane.spec.js`.
- **Command-row background deviation (T1):** the story text said "the same subtle treatment as `.pp-row:hover`", but that rule is a solid `--chrome-accent` fill with `--chrome-bg` text — under it the mint `›` prefix (also `--chrome-accent`) would vanish and the row would read as a hover state. Used the shipped, theme-independent `var(--field-bg)` token instead — which is exactly what the mockup's `.cmdline` rule specifies (pull-pane.html:128) — so no new colour was coined and the mockup look is preserved. Flagging per the story's "flag in review if you reword" convention.
- **Byte-capture mechanics (T5):** `registerTxObserver` observers are invoked with no payload (tx-sink.js:167-169), so the spec counts pushes via the observer (proving AC-4's ONE-push contract) and reads exact bytes back from the TX ring via `resetTx()` before + `formatHexStrip(1024)` after. Same-singleton dynamic `import('/input/tx-sink.js')` per the established pattern.
- **Zero-valid copy** shipped as proposed in Dev Notes, verbatim: "Nothing to pull — no CP/M 8.3 names in the selection." (static node in index.html).
- The review deliberately does not touch `epoch`, `lastSnapshot`, or `freshNames`; the refresh-during-review spec proves an open review survives a content-changing `__timerTickForTests()` with its DOM node identity intact, and that cancel lands on the refreshed list.
- `window.__pullPane` gained `beginReview`, `__setSlideActiveForTests`; `__getStateForTests()` gained `review`; `__resetForTests()` clears both the review flag and the slide-active override. Pane API growth is exactly the story-sanctioned set (E4 #5 watch).
- T6's done-marking sub-item is intentionally unchecked at review time — it belongs to the post-code-review pass (same handling as S9.1b).

### File List

- `www/index.html` — `#pull-pane-review` + `#pull-pane-actions` markup inside `.pp-card`; `#pull-pane-cap-label` id added to the caption span; S9.2 review CSS block (`.pp-review`, `.pp-cmdline`, `.pp-nothing`, `.pp-toklist`, `.pp-tok`, `.pp-info`, `.pp-actions`, `.pp-btn-primary`).
- `www/renderer/pull-pane.js` — `composeFromText`, `beginReview`, `renderReview`, confirm/cancel handlers + `slideActiveNow` suspension, `state.review` projection in `render()`, `__setSlideActiveForTests`, extended `__getStateForTests`/`__resetForTests`/`dispose`, new injected deps in `wirePullPane`.
- `www/main.js` — `CRLF_MODES` added to the keyboard import; `pushTxBytes` added to the tx-sink import; `validateCpmFilename`/`truncateCpm83` added to the file-source import; five new opts on the `wirePullPane({...})` call (incl. the `getEnterBytes` closure).
- `www/tests/render/pull-pane.spec.js` — new "E9 S9.2 — pull pane: selection → SLIDE S review" describe block (11 tests, all `@fast`).

## Change Log

- 2026-07-23 — Story created (ultimate context engine analysis completed — comprehensive developer guide created). Status: ready-for-dev.
- 2026-07-23 — S9.2 implemented: selection→`SLIDE S` compose (strict 8.3 idempotence predicate), in-pane review sub-state (flag, not a view — survives refresh), confirm→one combined `pushTxBytes` push honouring the live CR/LF pref, cancel→nothing, FR-11 suspension at both entry and confirm. 9 new Playwright specs; full suite green at parallel. Status: review.
- 2026-07-23 — code-review --fix pass, 4 findings fixed: (1) the suspension predicate now also checks tx-sink wire ownership — slide-recv's `isSlideActive` never sees send sessions, so a confirm during a send was silently dropped by tx-sink yet closed the review as if transmitted; (2) confirm refuses (stays open) when no serial writer is registered, mirroring WR-03 — previously the bytes went only to the diagnostics ring; (3) choosing a folder from the pane now also enables `prefs.slideRecvToFolder` (+ Settings checkbox sync) — otherwise pulls landed in ~/Downloads via the anchor fallback and `onFileLanded` never refreshed the pane; (4) the injected deps are called unguarded so a mis-wired composition root fails loudly instead of e.g. sending a command with no Enter terminator. 2 new specs (send-session suspension, WR-03 refusal) → 11 total; full suite green. Open questions deferred to S9.3: multi-file separator (AC says space-joined; `docs/SLIDE_Z80_REQUIREMENT.md:91` says comma-separated batches with a `B:` drive prefix — needs a hardware check) and an upper bound on composed command length (CP/M CCP line buffer is ~127 bytes; no cap composed today). Status: done.

## Code Review

_(fill on completion: N findings, severity, fix sha — required before marking done per scripts/check-story-done-consistency.py)_
