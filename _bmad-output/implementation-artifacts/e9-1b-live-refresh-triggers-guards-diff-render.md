---
baseline_commit: 20c23f24f7146c1deecc2292aeac60d964fb4c77
---

# Story 9.1b: Keep the file list live — refresh, guards, diff-render

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast daily driver,
I want the pane's list to update itself as files arrive and as I return to the tab,
so that I watch pulled files appear without manually refreshing — and without the list flickering or losing my scroll position.

This is the **second** story of Epic E9. S9.1a shipped the pane shell (`renderer/pull-pane.js` — docked pane, one-level file list, first-run / permission / empty / list views, epoch-guarded async binds) and deliberately wired **no** refresh machinery. This story adds it: the three FR-8 triggers, the FR-9 timer guards, and the FR-10 diff-render — plus the `↻` header control S9.1a left inert.

## Scope boundary (read first)

**IN scope (S9.1b):** FR-8, FR-9, FR-10 — refresh triggers (transfer-done / window focus / ~60s timer), timer guards (permission, hidden document), diff-render with the fresh-file mint marker, and wiring the `↻` glyph as a real manual-refresh button (EXPERIENCE.md:254 names it a control; this is the refresh story, so it lands here).

**OUT of scope — do NOT build here:**
- **Drop / compose / preview / inject** (FR-4/5/7/11) → **S9.2**. No drag-drop handlers, no `SLIDE S` composition, no `tx-sink` calls, no `isSlideActive` wiring.
- **Drop-to-pull end-to-end** (FR-6) → **S9.3**. The transfer-done trigger built here will be *exercised* end-to-end by S9.3; here you wire and unit-verify the hook, not the full pull flow.
- **Reverse drag** (FR-12) → **S9.4**.

## Acceptance Criteria

1. **Refresh triggers (FR-8).** With a folder bound, the list re-enumerates the handle when: (a) a SLIDE-received file lands in the folder (see AC-2), (b) the window regains focus (`window` `focus` event), (c) a ~60s repeating timer ticks. All triggers route through **one** guarded refresh path that re-enumerates the **currently bound** `dirHandle` (falling back to the IDB read only when no handle is bound yet — see Dev Notes "Trigger refresh path").
2. **Transfer-done hook (FR-8a).** `transport/slide-recv.js` `wireSlideRecv(opts)` gains an **optional** `onFileLanded` callback, invoked (fire-and-forget, `try/catch`-wrapped) once a folder write has fully succeeded — after `await downloadToFolder(...)` resolves in the success branch (slide-recv.js:505-506), the moment the file is actually enumerable. `main.js` injects `onFileLanded: () => pullPane.refresh()` (main.js:973 call site). No other slide/transport change; no Rust/wasm/protocol change (NFR-1). Do **not** derive this signal from the slide-chip lifecycle (see Dev Notes — it is pref-dependent and mistimed).
3. **Timer guards (FR-9).** The timer tick **skips** re-enumeration when the bound handle's `state.permission !== 'granted'` (and never calls `requestPermission` — no user gesture exists) and while `document.hidden` is true. Skipping is silent: no view change, no console error, no prompt.
4. **Diff-render, unchanged case (FR-10, UX-DR4).** A refresh whose enumeration matches the current list (same names + sizes, compared as a snapshot) performs **zero DOM mutation of the list** — no row rebuild, no flicker, no scroll-position reset, and nothing that could interrupt a drag.
5. **Diff-render, changed case (freshMarker — DESIGN.md `{components.pull-pane}`, Flow 7).** When enumeration differs: files not present in the previous snapshot are **fresh** — they sort to the **top** of the list (then the rest name-asc, as today) and render with the thin mint left-marker (2px `var(--chrome-accent)` left bar + the same subtle accent row treatment as the hover highlight — never a new color). `listEl.scrollTop` is captured before the rebuild and restored after. The fresh set belongs to the latest content-changing refresh: a later refresh that adds files replaces it; unchanged refreshes leave markers as-is; the **first** enumeration after bind/choose/grant marks nothing fresh.
6. **Manual `↻` refresh (EXPERIENCE.md:254).** The header `↻` becomes a real `<button>` (keeping its class/tooltip), wired through `retainFocus` (mousedown→preventDefault, AD-10), click → the same guarded refresh path. It keeps `title="Refreshes on transfer-done, window focus, and ~60s"` and gains `aria-label="Refresh file list"` (drop the `aria-hidden`).
7. **Concurrency + lifecycle (NFR-2).** Every trigger participates in the existing **epoch guard** so an overlapping slow enumeration can never clobber a newer result (the S9.1a review-fix pattern — carry it, don't re-derive it). `dispose()` clears the interval and removes the `focus` listener and the `↻` click handler. AD-3 unchanged on the pane side: `pull-pane.js` still direct-imports nothing; the only new dependency edge is `onFileLanded`, which flows through `main.js` opts on the **slide-recv** side.
8. **Test hooks + spec (NFR-4).** `window.__pullPane` gains `__timerTickForTests()` (runs the guarded timer tick body synchronously-awaitably). `www/tests/render/pull-pane.spec.js` is **extended** (same file, same patterns) to cover: focus-trigger re-enumeration; timer tick re-enumeration; permission guard (tick with a `'prompt'` handle does not enumerate); hidden guard (tick with stubbed `document.hidden` does not enumerate); unchanged refresh → identical row nodes + preserved `scrollTop`; changed refresh → fresh rows at top with the marker + preserved `scrollTop`; `↻` click refreshes and retains terminal focus. All `@fast`; full suite green under the ratified `retries:1` policy.

## Tasks / Subtasks

- [x] **T1 — Guarded trigger-refresh path (AC: 1, 3, 7)**
  - [x] Add `triggerRefresh()` in `pull-pane.js`: if no `dirHandle` → `bindFromIdb()` (cheap IDB get; also discovers a folder bound by SLIDE-recv's own picker within a minute); else if `state.permission !== 'granted'` or `document.hidden` → return silently; else re-enumerate the current `dirHandle` under a fresh epoch (reuse `evaluateHandle`/`enumerateAndRender` — do not duplicate their logic).
  - [x] Repoint the public API `refresh` at `triggerRefresh` (S9.1a aliased it to `bindFromIdb`; a trigger that re-reads IDB would clobber the `__setDirHandleForTests` handle and churn IDB every minute).
- [x] **T2 — Diff-render + fresh markers (AC: 4, 5)**
  - [x] Keep the last rendered snapshot (`[{name, size}]`, sorted). After enumeration, compare: identical → update `state.files` only, **skip** `renderRows` entirely.
  - [x] Changed → compute `fresh` = names in new but not in previous snapshot (skip when no previous snapshot — first bind). Order rows fresh-first, then name-asc. Capture `listEl.scrollTop` before `replaceChildren`, restore after.
  - [x] Row markup: fresh rows get `data-fresh` (or `.fresh`) — visual state via attributes, never inline styles (Consistency Conventions).
  - [x] CSS in `index.html`: `.pp-row.fresh::before` 2px left bar `var(--chrome-accent)` (mockup pattern, pull-pane.html:97-98) + reuse the exact `.pp-row:hover` background treatment for the fresh row tint. `--chrome-*` tokens only (AD-9).
- [x] **T3 — Triggers + `↻` control + cleanup (AC: 1, 6, 7)**
  - [x] `setInterval(triggerRefresh, REFRESH_INTERVAL_MS)` with `const REFRESH_INTERVAL_MS = 60_000` at module top; started in `wirePullPane`, cleared in `dispose()` (slide-chip.js:498-504 cleanup precedent). No visibilitychange listener needed — the hidden guard lives inside the tick, and Chromium throttles hidden-tab timers anyway.
  - [x] `window.addEventListener('focus', triggerRefresh)`; removed in `dispose()`. (chrome.js:184-245 is the listener-precedent region; the pane owns its own listener like slide-chip owns its interval.)
  - [x] `index.html`: `↻` span → `<button id="pull-pane-refresh" class="pp-refresh" …>`, keep the title, add `aria-label`, remove `aria-hidden`. Wire click → `triggerRefresh` with `retainFocusRef(btn)` like the existing choose/grant buttons.
- [x] **T4 — Transfer-done hook (AC: 2)**
  - [x] `transport/slide-recv.js`: accept `onFileLanded` in `wireSlideRecv(opts)` (slide-recv.js:139; module-scope ref, default null). Call it inside `try/catch` in the folder-write **success** branch — after `await downloadToFolder(file.name, blob)` resolves and `lastDownloadAt` updates (slide-recv.js:505-506; `downloadToFolder` itself is at :529). Not in the anchor-fallback path (no folder = pane unbound). Fires per file — with diff-render that is cheap and matches Flow 7's files-appear-one-by-one beat. Do not touch `slide.js`, the dispatch chain, or anything Rust-side.
  - [x] `main.js`: at the `wireSlideRecv({...})` call (main.js:973), add `onFileLanded: () => { try { pullPane.refresh(); } catch {} }`. `wirePullPane` runs earlier in boot (main.js:587-593), so the `pullPane` API exists by then.
- [x] **T5 — Playwright spec (AC: 8)**
  - [x] Extend `www/tests/render/pull-pane.spec.js`. Give the fake handle an **enumeration counter** (increment inside `entries()`), exposed so guard tests can assert "tick did not enumerate". Drive: `window.dispatchEvent(new Event('focus'))` for the focus trigger; `window.__pullPane.__timerTickForTests()` for tick tests; `Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })` for the hidden guard (restore after).
  - [x] Unchanged-refresh test: bind ~30 files so `#pull-pane-list` actually scrolls, set `scrollTop`, tick with identical contents → assert row **node identity** unchanged (e.g. tag a row via `dataset` before the tick and re-find it) and `scrollTop` unchanged.
  - [x] Changed-refresh test: mutate the fake handle's file set, tick → new names at top with the fresh marker, previous `scrollTop` preserved, count/badge updated.
  - [x] `onFileLanded` hook: assert the wiring at the slide-recv level if an existing recv spec context makes it cheap (see `www/tests` slide specs); otherwise cover the pane-side `refresh()` behavior here and leave the end-to-end land-and-appear proof to S9.3, which owns FR-6. State in the completion notes which of the two you did.
- [x] **T6 — Verify + mark done**
  - [x] Full suite green at parallel (`retries:1` policy stands — no per-story `--workers=1` re-diagnosis; see E5 retro).
  - [x] Fill the Code Review section; then mark the story done in **both** sprint-status.yaml **and** this file's Status + `last_updated` (run `scripts/check-story-done-consistency.py`). Story goes to `review` first per the dev-story workflow; done-marking follows the code-review pass. _(Done 2026-07-23 after the `code-review --fix` pass.)_

## Dev Notes

### What S9.1a left you (read `renderer/pull-pane.js` first — it is small)
- API: `wirePullPane(opts)` → `{ render, refresh, dispose, __getStateForTests, __resetForTests, __setDirHandleForTests }`; opts = `{ paneEl, idb: {getRecvDirHandle, setRecvDirHandle}, retainFocus, terminalWrapper }` (main.js:587-592). State: `{ folderName, permission: 'prompt'|'granted', files: [{name,size}], view: 'first-run'|'permission'|'empty'|'list' }`.
- **`renderRows()` full-rebuilds via `listEl.replaceChildren(frag)` on every call — today an unchanged refresh WOULD reset scroll to top.** That is precisely what this story fixes; the diff/skip must land before any trigger is wired, or the triggers ship the FR-10 violation.
- **Epoch guard exists** (module-scope `epoch`, bumped in `bindFromIdb` / `onChoose` / `onGrant` / test hooks) — added as an S9.1a review fix so a slow in-flight read can't clobber a newer result. Every new trigger must go through it. [Source: commit 20c23f2 message; pull-pane.js]
- **No timers or focus/visibility listeners exist yet** — S9.1a scope boundary held; you are adding the first ones.
- Scroll container is `#pull-pane-list` itself (`overflow:auto`, index.html ~480-485). The rail badge is repainted from `render()` unconditionally — leave that alone.
- Permission degradation is already correct (query/request wrapped; post-`granted` read failure degrades to the permission view, never throws). Don't re-handle it in the tick — just guard-and-skip.

### Transfer-done: why `onFileLanded` in `slide-recv.js`, not the chip, not `exitRecvMode`
- **Chip lifecycle is disqualified:** `slide-chip.js enterSummary()` early-returns to `hide()` when `prefs.slideShowSummary` is false (slide-chip.js:443-454) — a refresh derived from chip state silently dies when the user turns the summary off. Its `onStateChange` also only emits button events today.
- **Session-exit is mistimed:** `exitRecvMode` (slide.js:891) fires when the protocol state machine hits DONE, but the actual folder writes ride an async chain (`downloadDispatchTail`, slide-recv.js:113-122; `assembleAndDownload` → `downloadToFolder`) that settles **after** it — refreshing there can enumerate before the file is closed and visible.
- **After `await downloadToFolder()` resolves** (slide-recv.js:505-506) is the exact moment a pulled file becomes enumerable, and slide-recv is already wired via `wireSlideRecv(opts)` from main.js with injected refs (the `slideChip` opt is the precedent for this exact injection shape). One optional callback opt, one call site, `try/catch` so a pane failure can never disturb a transfer. NFR-1 forbids Rust/wasm/protocol/firmware changes — a JS-shell callback opt is compliant; keep it to slide-recv.js only.
- Failure/cancel paths don't fire it (nothing landed); the focus and timer triggers mop up any straggler state.

### Trigger refresh path — do NOT reuse `bindFromIdb` as the trigger target
S9.1a's `refresh` alias re-reads IndexedDB. If triggers call it: (a) the 60s timer would overwrite the test-injected fake handle with the (empty) real IDB value, breaking every spec that uses `__setDirHandleForTests`; (b) pointless IDB churn every minute. Triggers re-enumerate the **current** `dirHandle`. The one useful IDB re-read: when **no** handle is bound, a tick may `bindFromIdb()` so a folder bound through SLIDE-recv's own internal `pickFolder()` (slide-recv.js:276) shows up in the pane within a minute — the two paths share the one `recv_directory` key by design (S9.1a coordination note).

### Diff-render — deliberately simple
Snapshot-compare (names + sizes, sorted) and **skip render entirely when identical** — that is the whole FR-10 hard requirement (the AC is "when contents are unchanged"). When changed, a full rebuild with `scrollTop` capture/restore is acceptable and far simpler than keyed per-row reconciliation for a CP/M pull folder of a few dozen files; fresh-first ordering makes new arrivals visible without scroll-hunting (Flow 7: "appear at the top of the pane's list with a thin mint marker"). Do not build a virtual-DOM-ish differ (setter-grab-bag watch, E4 #5 — keep the API and internals lean).

### Fresh-marker semantics (deterministic, testable)
- `fresh` = set of names added by the latest **content-changing** refresh.
- First enumeration after bind/choose/grant: baseline only, nothing fresh.
- Later content-changing refresh with additions: fresh set is **replaced**.
- Unchanged refreshes: markers untouched (no DOM mutation at all).
- A removed file leaves the fresh set. Markers are not time-based — no fade timers.

### Guards — one predicate, inside the tick
`document.hidden || state.permission !== 'granted'` → return. No `requestPermission` from any trigger (no gesture). No visibilitychange listener juggling — the guard inside the tick *is* the pause, and Chromium throttles hidden-tab intervals regardless. Window `focus` implies visible, so the focus trigger passes the hidden guard naturally; routing all four triggers (landed / focus / timer / `↻`) through the same `triggerRefresh` keeps behavior uniform and gives the spec one thing to test.

### Files to create / modify
- **UPDATE** `www/renderer/pull-pane.js` — `triggerRefresh`, diff/skip + fresh in the render path, interval + focus listener + `↻` wiring, dispose cleanup, `__timerTickForTests`.
- **UPDATE** `www/index.html` — `↻` span → button; `.pp-row` fresh CSS (`--chrome-*` only).
- **UPDATE** `www/transport/slide-recv.js` — `onFileLanded` opt + one call in the folder-write success branch (:505-506).
- **UPDATE** `www/main.js` — pass `onFileLanded` at the `wireSlideRecv` call (:973). `window.__pullPane = pullPane` (main.js:593) exposes the full returned API, so `__timerTickForTests` lands automatically once added to the return object.
- **UPDATE** `www/tests/render/pull-pane.spec.js` — extend, same file.

### Testing standards
- Spec conventions carry over verbatim from S9.1a: boot-race guard on `window.__pullPane.__getStateForTests`, `__resetForTests()` in `beforeEach`, fake handle via the in-page factory + `__setDirHandleForTests`, `@fast`, chromium project, `retries:1` (playwright.config.js:20-27) with no per-story worker overrides. [Source: www/tests/render/pull-pane.spec.js; E5/E6 retros]
- The fake handle factory (pull-pane.spec.js:25-41) already fakes `queryPermission`/`requestPermission`/`entries()` — add the enumeration counter there, don't invent a second fake.
- `document.hidden` is stubbable per-page via `Object.defineProperty(document, 'hidden', {configurable: true, get})` in Chromium; restore (delete the own property) after the test so later specs in the file see reality.

### Voice / microcopy
No new user-facing copy. The `↻` keeps `title="Refreshes on transfer-done, window focus, and ~60s"` (index.html:1727-1728, placed there in S9.1a) and gains `aria-label="Refresh file list"`.

### Project Structure Notes
- Same component, same wiring — no new modules, no boot-order change. The one cross-module addition (`onFileLanded`) follows the established composition-root injection shape (`slideChip` opt into `wireSlideRecv`, main.js:991 region) rather than any new event mechanism — the codebase has no CustomEvent/emitter pattern in core modules; don't introduce one.
- Standing conventions: mark story done in **all** places (sprint-status + this file's Status + `last_updated`); record the code-review outcome here; keep the pane API lean (E4 #5 watch, still open).

### References
- [Source: epics-pull-pane.md — Story S9.1b; FR-8/9/10; NFR-1/2/4; UX-DR4]
- [Source: ARCHITECTURE-SPINE.md — AD-11 (sanctioned surface conditions), AD-2/3/9/10, Consistency Conventions]
- [Source: ux-designs/ux-beastty-2026-07-01/DESIGN.md:122-135 — `{components.pull-pane}` `freshMarker`; :226 — diff-render + mint left-marker]
- [Source: ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md:152 — State Pattern row (triggers + guards); :254 — `↻` is a real button; Flow 7 step 5 — fresh files at top]
- [Source: ux-designs/ux-beastty-2026-07-01/mockups/pull-pane.html:97-98 — `.pp-row.fresh` CSS; :334-345 — "just received" frame]
- [Source: www/renderer/pull-pane.js (all); www/main.js:587-593, 973; www/transport/slide-recv.js:113-122, 139, 276, 499-514, 529; www/transport/slide.js:863-924; www/renderer/slide-chip.js:107, 443-454, 498-504; www/renderer/chrome.js:184-245; www/tests/render/pull-pane.spec.js]
- [Source: _bmad-output/implementation-artifacts/e9-1a-pull-pane-shell-fsa-folder-view.md — Completion Notes (epoch guard, rail-is-CSS, test-hook idb note)]

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]) — BMad dev-story workflow.

### Debug Log References

- Full Playwright suite: **555 passed, 1 skipped, 0 failed** at parallel. 8 pre-existing
  flakes (serial-config-modal, slide-config-modal, reconnect, slide-chip — all transport/modal
  boot-under-load contention) self-healed on the ratified `retries:1` retry; none are pull-pane.
  No per-story `--workers=1` re-diagnosis (E5 retro policy stands).
- `tests/render/pull-pane.spec.js`: 17 passed (7 S9.1a carried + 10 new S9.1b).

### Completion Notes List

- **FR-8 triggers** route through one guarded `triggerRefresh()` (pull-pane.js): the ~60s
  `setInterval`, the `window` `focus` listener, the manual `↻`, and the transfer-done
  `refresh()` (repointed from `bindFromIdb` to `triggerRefresh`). With no bound handle a trigger
  falls back to a cheap `bindFromIdb()` IDB re-read (so a folder bound via SLIDE-recv's own picker
  surfaces within a tick); otherwise it re-enumerates the **current** `dirHandle`.
- **FR-9 guards** are one predicate inside the tick: `document.hidden || state.permission !== 'granted'`
  → silent return, never `requestPermission` (no gesture). No visibilitychange listener.
- **FR-10 diff-render**: snapshot compare (name+size, sorted). Identical → **zero** list DOM
  mutation (return before `render()`), so scroll and node identity survive. Changed → fresh-first
  ordering + `listEl.scrollTop` capture/restore around `replaceChildren`.
- **Fresh markers**: `.pp-row.fresh` (class, not inline style) = 2px `--chrome-accent` `::before`
  bar + the shipped hover-row accent treatment (AD-9, `--chrome-*` only). The fresh set is the
  latest content-changing refresh's additions; reset to empty on every bind/choose/grant intent
  (`resetDiffBaseline()`) so the first enumeration after bind marks nothing fresh, and NOT reset
  on a trigger. A later content-changing refresh replaces the set; unchanged refreshes leave it.
- **NFR-2 epoch guard**: every trigger bumps `epoch` and passes it down; a superseded in-flight
  enumeration bails before committing. `dispose()` clears the interval + removes the focus and
  `↻` listeners.
- **FR-8a hook**: `slide-recv.js` `wireSlideRecv` gained an optional `onFileLanded` opt, fired
  fire-and-forget + `try/catch` in the folder-write **success** branch right after
  `await downloadToFolder(...)` resolves (the moment the file is enumerable). `main.js` injects
  `onFileLanded: () => pullPane.refresh()`. No slide/dispatch/Rust/wasm/protocol change (NFR-1).
- **onFileLanded test coverage decision (T5)**: I covered the **pane-side** `refresh()` behavior
  directly (a `window.__pullPane.refresh()` test asserts the transfer-done path re-enumerates) and
  left the end-to-end land-and-appear proof to **S9.3**, which owns FR-6. A slide-recv-level wiring
  test wasn't cheap to add without standing up a full recv session, so the pane-side proof + the
  one-line `main.js` injection is the seam verified here.
- **Test-layout note**: `#pull-pane` grows to content height and the page (not the list) scrolls
  when content exceeds the terminal height, so the two scroll-preservation tests bound
  `#pull-pane-list` height (test-only inline style) to make `scrollTop` a real internal offset and
  genuinely exercise the FR-10 capture/restore. No production layout change.

### File List

- `www/renderer/pull-pane.js` — modified (triggerRefresh, diff/skip + fresh render path, interval + focus listener + ↻ wiring, dispose cleanup, `__timerTickForTests`, `resetDiffBaseline`).
- `www/index.html` — modified (↻ span → `<button id="pull-pane-refresh">`; `.pp-row.fresh` CSS + `.pp-refresh` button styling; stale-comment update).
- `www/transport/slide-recv.js` — modified (`onFileLanded` opt + one guarded call in the folder-write success branch).
- `www/main.js` — modified (pass `onFileLanded: () => pullPane.refresh()` at the `wireSlideRecv` call).
- `www/tests/render/pull-pane.spec.js` — modified (enumeration counter + mutable file set on the fake handle; new S9.1b describe block: focus/timer triggers, permission + hidden guards, unchanged/changed diff-render, fresh-set replacement, refresh() API, manual ↻ + focus retention).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (status tracking: ready-for-dev → in-progress → review).

## Change Log

- 2026-07-23 — S9.1b implemented: FR-8 refresh triggers, FR-9 timer guards, FR-10 diff-render + fresh markers, manual `↻` button, FR-8a transfer-done hook. 10 new Playwright tests; full suite green (555 passed / 0 failed). Status → review.
- 2026-07-23 — `code-review --fix` pass: 5 findings fixed (hidden-tab guard bypass, re-wire timer/listener leak, stale docblocks, banned-word comments, O(n²) diff), 3 deferred, 3 refuted. `pull-pane.spec.js` green (17). Status → done.

## Code Review

- 2026-07-23 — `code-review --fix` (high effort, 8 finder angles → verify). **5 findings fixed, 3 deferred, 3 refuted.** Fixes committed with the done-marking (see Change Log entry of the same date).

**Fixed:**
1. *(correctness)* `triggerRefresh` ran a full IDB read + `queryPermission` + enumeration on a **hidden** tab whenever no handle was bound yet — the `if (!dirHandle)` branch returned before the `document.hidden` check. Moved the hidden guard to the top so every trigger honours FR-9.
2. *(robustness)* `wirePullPane` stacked a duplicate ~60s timer + `focus` listener on any re-wire (hot reload / re-init) — no teardown before re-arming. Added idempotent `clearInterval` + `removeEventListener`.
3. *(accuracy)* Module header + `main.js` wiring comment still declared "NO refresh machinery / no refresh triggers" after the S9.1b layer landed. Rewrote both.
4. *(conventions)* Banned vocabulary ("seam") in new comments (`pull-pane.js` ×3, spec ×2) — reworded to "test hook". Left two verbatim citations (`ARCHITECTURE-SPINE.md`, the quoted story phrase) per the exception.
5. *(efficiency)* O(n²) fresh-file diff in `enumerateAndRender` — replaced the per-file `prevSnap.some(...)` scan with a one-time `Set` → O(n).

**Deferred (out of this diff / low value):** `formatSize`+`pluralFiles` duplicate `slide-chip.js`'s private helpers (extraction would touch `slide-chip.js`); `formatSize` rounds 999,500–999,999 B to "1000 KB" (cosmetic, and deliberately mirrors `slide-chip.js` — fix both together); sequential `getFile()` awaits (negligible for a small pull folder).

**Refuted:** claimed equal-snapshot stale-DOM race (reset-on-new-intent prevents it); "fresh-on-arrival lost across rebind" (first-bind marks-nothing-fresh is intended); `onGrant` non-granted render (benign).

Full `pull-pane.spec.js` suite green (17 passed) after the fixes.
