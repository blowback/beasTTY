---
baseline_commit: c4bfd86fef11b662a4239bef5f160707d3669e1f
---

# Story 10.1: Ambient CRC-32 column + per-record detail view

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a MicroBeast daily driver,
I want every file in the pull pane to quietly show its `CSUM`-compatible CRC-32, with a per-file view of the per-record Fletcher-16 listing,
so that I can glance-compare a file on my disk against `CSUM` output on the Beast without running a PC-side tool.

This is the **first** story of Epic E10 (Host-side Checksums in the Pull Pane). It builds only on shipped E9 code. The external contract is the sibling `beast_csum` repo: `CSUM.COM` (Z80/CP/M) and `csumhost` (PC) print byte-identical checksums — whole-file CRC-32 (zip/zlib flavour) and, verbose, one Fletcher-16 per 128-byte CP/M record, with the file zero-padded to a whole number of records. This story makes Beastty a third byte-identical implementation, ambient in the pane. Ground-truth vectors are embedded below — the sibling repo is NOT needed to build or test this story.

**Sizing decision (readiness report 2026-07-24):** kept as ONE story. If mid-implementation this proves too large, STOP and split at the documented line — T1–T3 (module + column + cache) vs T4 (detail view) — rather than trimming ACs. Record the split as a deviation.

## Scope boundary (read first)

**IN scope (S10.1):** the pure checksum module + embedded vectors; the ambient CRC-32 column with cached async fill; the hover/focus-revealed per-row detail button; the detail sub-state (Fletcher-16 listing); per-row degradation; specs; the UX-contract dated amendments.

**OUT of scope — do NOT build here:**
- **The `CSUM -V` drag-to-diff** (FR-6..FR-11) — that is S10.2, including all drop-routing changes. In S10.1 a terminal-selection drop while the detail view is open is simply **refused** (see AC-7) — an explicitly interim rule that S10.2 replaces with diff routing.
- **Cache persistence.** The checksum cache is an in-memory `Map`, session-lifetime. No idb.
- **Any change to `input/file-source.js`, `transport/slide.js`, `input/tx-sink.js`, `input/selection.js`.** `main.js` gains exactly one import + one injected opt (the csum module, per AD-3).
- **Keyboard shortcuts for the detail view** beyond the button being genuinely keyboard-reachable (AC-6). Esc does not close the detail view (consistent with the S9.2 review, which is button-driven).
- **New colors/tokens.** `--chrome-*` only (AD-9).
- **Wire traffic.** Nothing in this story reads or writes the serial port; checksumming is NOT suspended during SLIDE sessions (it reads local disk only).

## Acceptance Criteria

1. **Pure checksum module, injected not imported (FR-1, NFR-1, NFR-2).** New module `www/renderer/csum.js`: no DOM, no I/O, no imports. Exports (named) at minimum `analyzeCsum(bytes: Uint8Array) → { records: string[], crc: string }` — `records[i]` is the 4-uppercase-hex Fletcher-16 of 128-byte record *i* (final short record zero-padded), `crc` is the 8-uppercase-hex CRC-32 (poly `0xEDB88320` reflected, init/final `0xFFFFFFFF`) over the **padded** content. Empty input → `{ records: [], crc: '00000000' }`. `pull-pane.js` receives it as a `wirePullPane` opt injected by `main.js` — pull-pane's imports-NOTHING rule (pull-pane.js:36-42) is unchanged. Output must reproduce every embedded vector (Dev Notes) byte-for-byte.
2. **Ambient column (FR-1, FR-2, UX-DR1).** Each `.pp-row` gains a `.pp-cs` cell between `.pp-nm` and `.pp-sz`: the file's CRC-32 as 8 uppercase hex digits — `--chrome-muted`, ~11px, monospace, `font-variant-numeric: tabular-nums`, `title` verbatim "CRC-32 — matches CSUM / csumhost". Pending = `…`; unreadable = `—` (AC-8). The cell never wraps or widens the row (name keeps `flex:1` + ellipsis); hover/fresh row states recolor it like `.pp-sz` (index.html:509-519 precedent).
3. **Async fill, zero churn (FR-2, NFR-3).** The list paints immediately on enumeration with placeholders; checksums fill in afterwards by **textContent-only mutation** of existing `.pp-cs` cells — no row rebuild, no scroll reset, no flicker, no drag interruption. Files are read **sequentially** (one `getFile()`/`arrayBuffer()` at a time — no I/O stampede on large folders), each fill guarded by the E9 epoch: capture `gen` at enumeration, re-check `gen === epoch` before every cell write; a stale fill after a rebind/new-folder intent writes nothing (cache write is still fine — it is keyed by content identity, not by view).
4. **Cache + the same-size-edit trap (FR-3).** Cache is a module-scope `Map` keyed `` `${name}:${size}:${lastModified}` ``. `lastModified` is captured during enumeration from the same `getFile()` call that already reads `size` (pull-pane.js:432) — entries become `{name, size, lastModified, handle}`. **Critical:** the diff-render snapshot stays keyed on name+size ONLY (pull-pane.js:453-465 semantics unchanged, existing specs must stay green), so a same-size on-disk edit produces a snapshot-equal refresh that returns before `render()` — therefore the **fill pass must run on every enumeration completion, including the snapshot-equal early-return path** (pull-pane.js:454-457), updating only cells whose cached value is missing or whose key changed. Cache-hit rows render their value synchronously in `renderRows` (no placeholder flash); only misses go through the async queue. `__getStateForTests().files` stays `{name, size}` only (specs deep-compare it — S9.4 lesson).
5. **Detail sub-state (FR-4, FR-5, UX-DR3, UX-DR7).** Opening a row's detail swaps the pane to a detail view painted ONCE at open (the S9.2 review-flag pattern verbatim: a `detail` flag stored beside `view`/`review` — pull-pane.js:62-68 — its DOM painted by its own `renderDetail()`, while refresh-triggered `render()` calls only project visibility and never repaint it). Content: header line verbatim `{NAME} · {n} records · CRC {XXXXXXXX}` (singular "1 record"), a `‹ Back` button, then the record listing — one aligned row per record, `NNNN: VVVV` (4-hex index, 4-hex Fletcher-16), scrolling **internally** (the pane has `container-type: size` — content must never inflate the stage row; follow `.pp-list`/`.pp-review` overflow precedent, index.html:447-456). Labels honest: the whole-file value is CRC-32, per-record values are Fletcher-16 (four hex digits — never "Fletcher-32"). Detail bytes are read fresh at open via the row's `handle.getFile()` (records are not kept from the column fill); read failure paints verbatim "Couldn't read this file." in the detail body, never a throw (AC-8). `‹ Back` clears the flag and re-renders — the list re-projects current state, picking up any refresh that landed meanwhile. Detail opens only from list view with no review open (mutual exclusion by construction). Bloom rules untouched: closing detail does not un-bloom (the S9.3 click-bloom dismissal paths are unchanged).
6. **The row button — keyboard-reachable, gesture-inert (UX-DR2, AD-10, readiness note).** Each row gains a real `<button class="pp-detail">⁞</button>` at the right edge, `title` verbatim "Per-record checksums (CSUM -V)". Hidden at rest; revealed on row hover **and** on its own focus (`:focus-visible` / row `:focus-within` — a keyboard user Tabbing to it must see it; this is the readiness carry-in, in-scope not extra). Its `pointerdown` calls `stopPropagation()` so the S9.4 row-gesture layer never sees it: selection unchanged, drag stash never armed (pull-pane.js:698-753). It is wired through `retainFocus` like every other pane control (the S9.4 bare-rows exception does NOT apply — the button is not a drag source; `retainFocus`'s mousedown `preventDefault` composes fine with keyboard focus). Not suspended during SLIDE sessions (no wire traffic).
7. **Interim drop refusal while detail open (S10.2 boundary).** `dropAcceptable()` (pull-pane.js:569-573) additionally returns false while the detail flag is set: a terminal-selection drag over the pane shows no affordance and a drop does nothing. One spec asserts it. Comment it as the S10.2 boundary-in-waiting — S10.2 replaces this branch with diff routing. Everywhere else the S9.3 drop path is byte-identical.
8. **Degradation (FR-12).** A `getFile()`/read rejection during the column fill sets that row's cell to `—` (muted) and the queue continues — one bad file never blocks the rest. A read failure at detail-open paints the failure copy (AC-5). No console spam beyond one `console.warn` per failure (existing pull-pane style, e.g. :391).
9. **Test hooks (NFR-4, API growth watch).** `__getStateForTests()` gains exactly two fields: `csums` (object: name → 8-hex string | `'…'` | `'—'`) and `detail` (null | `{name, recordCount, crc, error}`). `__resetForTests()` clears the cache, the fill queue, and the detail flag. No new window hooks, no new pane API methods beyond what `wirePullPane` already returns.
10. **Specs (NFR-1, NFR-4).** New file `www/tests/render/pull-pane-csum.spec.js` (the existing pull-pane.spec.js is already 60+ specs — do not bloat it), all `@fast`, chromium project, E9 conventions (boot-race guard on `window.__pullPane`, `__resetForTests` in `beforeEach`, fake handle via `__setDirHandleForTests`). Required coverage: (a) vector conformance — `import('/renderer/csum.js')` in page, assert every embedded vector incl. empty; (b) column shows the vector values for bound fake files with byte-exact `content`; (c) pending placeholder under `manual` getFile mode, fills after release; (d) cache hit — second refresh performs zero additional `getFile()` calls for unchanged files (fake gains a per-entry getFile counter); (e) same-size mtime bump → snapshot-equal refresh (zero list DOM churn — reuse the S9.1b unchanged-refresh assertion style) BUT the cell updates to the new value; (f) `reject` mode → `—`, other rows still fill; (g) detail open → header + rows match the vector listing; (h) a content-changing refresh while detail is open does not repaint the detail DOM, and Back lands on the updated list; (i) button gesture inertness — pointerdown on the button arms no drag and changes no selection (`dragOutArmed: false`, `selectedNames` unchanged); (j) drop refused while detail open (dispatchDrag helper precedent, pull-pane.spec.js:110-115); (k) epoch guard — `manual` mode, rebind to a new folder, release the old resolves → no cell write, no crash; (l) keyboard reachability — the button is focusable and visibly revealed on focus. Run the FULL existing pull-pane.spec.js after the fake-handle upgrade (shared-fixture caution — S9.4 lesson). Full suite green at parallel under the ratified `retries:1` policy.
11. **UX contract amendments (readiness action #4).** `DESIGN.md` `{components.pull-pane}` gains the column + detail entries; `EXPERIENCE.md` gains the new pull-pane states (`detail`) and the Voice-table microcopy rows (all strings from the verbatim block below) — each with a dated `[E10 2026-07-…]` marker, the E8-retro convention. Small, surgical, no restructuring.

**Verbatim copy (do not paraphrase, do not re-invent):** column cell tooltip "CRC-32 — matches CSUM / csumhost" · detail button tooltip "Per-record checksums (CSUM -V)" · detail header "{NAME} · {n} records · CRC {XXXXXXXX}" (singular "1 record") · back control "‹ Back" · detail footer hint "Drag CSUM -V output here to compare" (markup + copy ship in S10.1 but stay `[hidden]` — never show an invitation AC-7 refuses; S10.2 un-hides it when the drop becomes real) · read failure "Couldn't read this file."

## Tasks / Subtasks

- [x] **T1 — `csum.js` + vector conformance (AC: 1)**
  - [x] `www/renderer/csum.js`: `fletcher16` (sums mod 255, `(s2<<8)|s1`), `crc32` (table-less loop fine — files are CP/M-sized), `analyzeCsum` composing both over 128-byte records with zero-pad. Match `csumhost.c:25-44` semantics exactly.
  - [x] Page-import vector spec first (red), then implement to green — the embedded vectors are the oracle.
- [x] **T2 — enumeration + cache + fill machinery (AC: 3, 4, 8)**
  - [x] `enumerateAndRender` (pull-pane.js:426-476): capture `f.lastModified` beside `size`; entries `{name, size, lastModified, handle}`; snapshot builder and `__getStateForTests().files` untouched (name+size only).
  - [x] Module-scope `csumCache` Map + sequential fill queue; kick the fill pass at BOTH exits of enumerateAndRender (snapshot-equal early return AND the render path); epoch-guard every cell write; rejection → `—` + continue.
  - [x] `main.js`: import `analyzeCsum`, inject via `wirePullPane` opts (one line each). Fail-loud if missing (the S9.2 unguarded-injection convention, pull-pane.js:88-97).
- [x] **T3 — column cell + CSS (AC: 2)**
  - [x] `renderRows` (pull-pane.js:1127-1160): insert `.pp-cs` between name and size — cache-hit value synchronously, else `…`. CSS beside `.pp-sz` rules (index.html:511): muted, 11px, mono, tabular-nums, hover/fresh recolor.
- [x] **T4 — detail sub-state (AC: 5, 6, 7)**
  - [x] Static markup in `index.html` (`#pull-pane-detail`: header span, `‹ Back` button, scrollable rows container, footer hint shipped `[hidden]` per the verbatim-copy note) + CSS on `--chrome-*` only; internal scroll per `.pp-review` precedent.
  - [x] `pull-pane.js`: `detail` flag + `openDetail(name)` (fresh `getFile()` → `analyzeCsum` → `renderDetail` paint-once) + `closeDetail`; `render()` projects `data-view="detail"` with the same hidden/visible discipline as review (:1074-1125); `dropAcceptable()` gains `&& !state.detail` with the S10.2 boundary comment.
  - [x] Per-row `⁞` button in `renderRows`: `stopPropagation` on pointerdown, `retainFocus` wiring, hover + focus reveal CSS, delegated click → `openDetail`.
  - [x] Teardown: `dispose`/`__resetForTests` clear cache, queue, detail (and remove nothing that S9.3/S9.4 teardown already owns).
- [x] **T5 — specs (AC: 9, 10)**
  - [x] Fake-handle upgrades in the NEW spec file's copy of the factory: `mkFile` honors `f.mtime` (`new File([...], name, {lastModified: f.mtime ?? 0})`) + per-entry getFile call counter. (If the factory is lifted to a shared helper instead, re-run the whole existing pull-pane.spec.js — shared-fixture caution.)
  - [x] All AC-10 items (a)–(l). Full suite at parallel; record counts honestly (untruncated output — S9.4 lesson).
- [x] **T6 — UX contract amendments (AC: 11)**
  - [x] DESIGN.md `{components.pull-pane}` + EXPERIENCE.md states/Voice rows, dated markers, verbatim strings.
- [x] **T7 — review + done**
  - [x] Fill the `### Code Review` section at completion (write-time, not backfilled — E8 retro action). Mark done in ALL places: sprint-status.yaml + this file's Status + `last_updated`; run `scripts/check-story-done-consistency.py`. Story goes to `review` first per dev-story.

## Dev Notes

### Ground-truth vectors (generated 2026-07-24 with the real `csumhost`, beast_csum @ HEAD)

| Input bytes | `-V` records | CRC-32 |
|---|---|---|
| empty (0 bytes) | *(none)* | `00000000` |
| `bytes(range(128))` — 0x00..0x7F, one full record | `0000: 9ADF` | `24650D57` |
| `bytes(i%256 for i in range(200))` — two records, short final (zero-padded) | `0000: 9ADF` · `0001: 482A` | `EB945AF8` |
| `0xAA` × 256 — two identical full records | `0000: 0055` · `0001: 0055` | `AFBD4CF6` |
| `b'HELLO FROM Z80\r\n'` (16 bytes, one padded record) | `0000: 24C4` | `5D3BDC84` |

Note the short-final case's record 0 equals the one-full-record vector (same first 128 bytes) — a free cross-check. The empty file prints NO record lines, only the CRC (csumhost.c:75 — the read loop never executes).

### The same-size-edit trap (why the fill pass runs on the early-return path)

`snapshotsEqual` compares name+size positionally (pull-pane.js:479-485). A file edited in place without changing size produces an "unchanged" refresh that returns at :454-457 **before** `render()`. If the fill pass only ran on the render path, the stale CRC would sit on screen forever — the exact corruption this feature exists to expose. So: fill pass on every enumeration completion; it compares cache keys (mtime moved → miss → recompute → textContent update). Do NOT "fix" this by adding lastModified to the snapshot — that would rebuild rows (scroll reset, FR-10 regression) for a change the diff-render contract deliberately ignores.

### Why injected, not imported

`pull-pane.js` direct-imports NOTHING (header :36-42; AD-3). The S9.2 validators arrived as opts; `analyzeCsum` arrives the same way, unguarded (a missing injection is a mis-wired composition root and must fail loudly — :88-97 convention). `csum.js` itself is pure and import-free, so it is unit-testable by page `import()` with no wiring.

### Detail view is the review pattern, not a new invention

Every mechanism exists in S9.2: flag beside `view` (:62-67), paint-once by a dedicated render fn (:994), `render()` projects visibility only (:1074-1125), exit re-renders truthfully (:1066-1070). Copy the shape; do not build a second projection idiom. The one difference: detail content comes from an async read, so `openDetail` awaits `getFile()`/`arrayBuffer()` BEFORE setting the flag + painting (no half-painted state; a slow read just delays the swap; failure paints the error body instead).

### Row gestures — the button must be invisible to S9.4

`onRowPointerDown` (:698-753) claims every primary pointerdown on a row: selection semantics + drag-stash arming. The `⁞` button's `stopPropagation` on pointerdown keeps all of that untouched (AC-6 spec (i) proves it). `retainFocus` on the button is correct — the S9.4 bare-row exception exists because `preventDefault` on mousedown suppresses *drag initiation*; the button initiates no drag.

### What the codebase gives you (verified shapes @ c4bfd86)

- **`pull-pane.js`:** state `{folderName, permission, files, view, review}` :68; epoch discipline :74-81 (bump + capture + re-check — your fill uses the same `gen`); injected deps :84-97; enumeration (`getFile()` for size already) :426-476; snapshot :479-485; review flag/paint/exit :62-67/:994-1031/:1066-1070; `dropAcceptable` :569-573; row gesture layer :698-818; `renderRows` :1127-1160 (fresh-first via `orderedFiles()` :677); `render()` :1074-1125; hooks :1173-1228; `dispose` :1230-1274; `COPY` :166-176 (add the new strings there — single-source, the footEl sync precedent :253-255).
- **`index.html`:** pane CSS :442-680 (`container-type: size` :453 — detail must scroll internally); `.pp-row`/`.pp-nm`/`.pp-sz` :501-519; review sub-state markup precedent inside `.pp-card` :2045+.
- **`main.js`:** `wirePullPane` opts block (S9.2/S9.4 injections) — add `analyzeCsum` beside them.
- **`csumhost.c`:** crc32_update :25-33; fletcher16 :36-44; record loop + zero-pad :73-83.
- **Spec toolkit (pull-pane.spec.js):** fake-handle factory :36-69 (getFile modes `ok`/`reject`/`manual` + `__resolvePendingGetFiles` :48 — reuse for pending/epoch specs); `setup`/boot-race guard :71-80; `bindFake` :84-91; `dispatchDrag` :110-115; state readers :100-102.
- **Suite reality:** Playwright chromium project, `npm test` / `test:fast` (`@fast` grep), `retries:1` ratified; boot-race guard is mandatory (E0.1 learning).

### Project Structure Notes

- Files: **NEW** `www/renderer/csum.js`, **NEW** `www/tests/render/pull-pane-csum.spec.js`; **UPDATE** `www/renderer/pull-pane.js`, `www/index.html`, `www/main.js` (import + opt only), `_bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/DESIGN.md` + `EXPERIENCE.md` (dated E10 amendments). Explicitly NO changes: `file-source.js`, `slide.js`, `tx-sink.js`, `selection.js`, anything Rust/wasm.
- API growth watch: sanctioned additions are exactly `csums` + `detail` in `__getStateForTests` and the `analyzeCsum` injected opt. Nothing else.
- Standing conventions: story done in ALL places via `scripts/check-story-done-consistency.py`; Code Review section filled at write time (E8 retro action #1 — no more backfills).
- Open E9 action items relevant here: none touch this story (bot-parity-first is transport-only; S10.2 should re-check it for the parser — noted in the epic).

### References

- [Source: _bmad-output/planning-artifacts/epics-csum.md — Story S10.1 + FR-1..5, FR-12; NFR-1..6; UX-DR1..3, UX-DR6..7; Additional Requirements]
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-07-24.md — READY verdict; carried notes (keyboard button, split line, vectors-in-fixtures, UX amendments)]
- [Source: ../beast_csum/csumhost.c — :25-33 (CRC-32), :36-44 (Fletcher-16), :73-86 (record loop + zero-pad); ../beast_csum/README.md — output grammar, padding rule]
- [Source: ARCHITECTURE-SPINE.md — AD-2 :75-78, AD-3 :80-83, AD-9 :110-114, AD-10 :116-119, AD-11 :121-132]
- [Source: ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md — pull-pane component rules :152, states :204-216, accessibility floor :254; DESIGN.md — {components.pull-pane} :122-134, component prose :226]
- [Source: www/renderer/pull-pane.js — line refs above @ c4bfd86]
- [Source: www/tests/render/pull-pane.spec.js — :36-69, :71-91, :100-115]
- [Source: _bmad-output/implementation-artifacts/e9-4-reverse-drag-pane-to-terminal.md — row-gesture layer, retainFocus exception rationale, shared-fixture caution, honest-suite-count lesson]

## Dev Agent Record

### Agent Model Used

Fable 5 (claude-fable-5) via Claude Code / bmad-dev-story.

### Debug Log References

- T1 red run: vector spec failed on missing `/renderer/csum.js` (import 404), then green after implementation. Vectors additionally cross-checked in node (all 5 OK, including empty → `00000000`).
- Spec (c) first attempt deadlocked: with global `manual` mode the enumeration parks on the FIRST file's size read (AA.DAT), not the new file's — fixed by releasing each parked read in enumeration order (AA.DAT's 3rd call, then HELLO.TXT's 1st).
- Spec (e) initially hardcoded an unverified CRC; replaced with `B17ECC3C` computed by the module in node for 128×0xAA (record `0055` cross-checks against the 0xAA vector).

### Completion Notes List

- **T1** — `www/renderer/csum.js`: pure, import-free; named exports `fletcher16` (sums mod 255, `(s2<<8)|s1`), `crc32` (table-less reflected 0xEDB88320, init/final 0xFFFFFFFF), `analyzeCsum` (128-byte records, final record zero-padded, CRC over padded content; empty → `{records: [], crc: '00000000'}`). All five embedded vectors reproduce byte-for-byte in-page and in node.
- **T2** — enumeration captures `lastModified` from the same `getFile()` that reads size; entries now `{name, size, lastModified, handle}` (snapshot + `__getStateForTests().files` untouched — name+size only). Module-scope `csumCache` (successes only, keyed `name:size:lastModified`), `csumShown` (what each cell displays), and a sequential `fillChain` (one read at a time). `kickCsumFill(gen)` runs at BOTH `enumerateAndRender` exits — including the snapshot-equal early return (the same-size-edit trap) — reconciling cache hits synchronously and queueing misses. Every cell write re-checks `gen === epoch`; failures show `—`, are never cached (next refresh retries), and never block the queue. `main.js`: one import + one injected opt.
- **T3** — `.pp-cs` cell between name and size: cache hits paint synchronously in `renderRows` (no placeholder flash), misses show `…`; tooltip verbatim. CSS beside `.pp-sz`: muted 11px monospace tabular-nums, hover/fresh/sel recolor parity with the size cell.
- **T4** — `detail` flag beside `view`/`review` (S9.2 pattern verbatim): `openDetail` awaits fresh `getFile()`/`arrayBuffer()` BEFORE setting the flag + painting once via `renderDetail`; `render()` only projects `data-view="detail"` + `[hidden]`; `closeDetail` re-renders truthfully. Read failure paints "Couldn't read this file." — never throws. Per-row `⁞` button: pointerdown `stopPropagation` (S9.4 gesture layer never sees it), `retainFocus`-wired, opacity-hidden at rest (stays keyboard-focusable), revealed on row hover / `:focus-within` / `:focus-visible`; delegated click on the list container. `dropAcceptable()` gains `&& !state.detail` (interim S10.2 boundary, commented). Detail footer hint ships `[hidden]`. Teardown in `dispose` + `__resetForTests` (cache, shown-map, chain, flag, listeners).
- **T5** — new `www/tests/render/pull-pane-csum.spec.js` (14 specs, all `@fast`): factory copy upgraded with `mtime` → `lastModified`, per-entry `getFile` counters, per-file `mode` override. Covers AC-10 (a)–(l): vectors + purity, column values/tooltip/placement, pending placeholder choreography, cache-hit zero-fill-reads (enumeration's own size read is the only permitted delta — documented in-spec), same-size mtime bump (node identity preserved + cell updated), per-row rejection degradation, detail paint-once + verbatim header (plural and singular) + rows + hidden footer + Back, detail read-failure copy, no-repaint-under-refresh + Back-sees-updates, button gesture inertness, drop refusal while detail open, epoch guard across a rebind with a parked read, keyboard reachability (focusable at opacity 0, revealed on focus, Enter opens).
- **T6** — DESIGN.md `{components.pull-pane}`: three token entries + prose sentence; EXPERIENCE.md: `detail` state row + three Voice-table rows. All dated `[E10 2026-07-24]`, verbatim strings from the story block.
- Suite: full parallel run 495 passed + 10 flaky-passed-on-retry (all pre-existing E8-overlay/input/zoom specs, none from this story's files) + 1 skipped = 506 total, under the ratified `retries:1` policy. Targeted runs: pull-pane-csum.spec.js 14/14; existing pull-pane.spec.js 55/55.

### File List

- `www/renderer/csum.js` (NEW)
- `www/tests/render/pull-pane-csum.spec.js` (NEW)
- `www/tests/render/pull-pane.spec.js` (UPDATE — code-review fix: fake `mkFile` pins `lastModified: 0`)
- `www/renderer/pull-pane.js` (UPDATE)
- `www/index.html` (UPDATE)
- `www/main.js` (UPDATE — import + injected opt only)
- `_bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/DESIGN.md` (UPDATE — dated E10 amendments)
- `_bmad-output/planning-artifacts/ux-designs/ux-beastty-2026-07-01/EXPERIENCE.md` (UPDATE — dated E10 amendments)
- `_bmad-output/implementation-artifacts/e10-1-ambient-crc32-column-per-record-detail-view.md` (story bookkeeping)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status transitions)

## Code Review

2026-07-24 — high effort, `--fix`, 8 parallel finder passes (3 correctness + reuse/simplification/efficiency/altitude/conventions) over the working-tree diff, candidates verified against the code before fixing. **10 findings, all fixed:**

1. **`openDetail` staleness guard** — the post-await recheck ignored rebinds, view degrades, file removal, and a second ⁞ click (first-resolve-wins). Now: a last-click-wins token, plus recheck of `dirHandle` identity (refresh ticks never change it, so a background tick can't kill an open), `view === 'list'`, and the file still existing.
2. **`—` cells regressed to `…` on non-enumeration re-renders** — `renderRows` painted cache-miss cells as pending even when `csumShown` held a truthful `—` (failures are never cached), faking an in-progress state after Back/review-exit with no fill queued. Now falls back to the shown value before the placeholder.
3. **Per-button `retainFocus` + pointerdown closure per rebuild** — every rebuilt ⁞ button pushed a new focus.js registry descriptor (new element → WeakSet miss), unbounded over a session and skewing `retainedCount`. Replaced with two delegated listEl handlers: `onListDetailMousedown` (preventDefault — retainFocus's button branch verbatim) and a `.pp-detail` early-return in `onRowPointerDown` (replacing per-button `stopPropagation`). Recorded as a deviation from AC-6's "wired through retainFocus" letter; the mousedown-preventDefault behavior is identical.
4. **Keyboard focus lost on rebuild** — a refresh rebuilding rows while a ⁞ button held focus dropped focus to `<body>` (keystrokes reached nothing — AD-10 regression). `renderRows` now restores focus to the same row's button, else the wrapper.
5. **Cache lifetime** — `csumCache`/`csumShown` survived rebinds (the key has no folder identity: a same-`name:size:mtime` file in another folder inherited the old CRC unread) and grew unboundedly (every mtime bump mints a key, none died). Now: `resetDiffBaseline` → `resetCsumState()` on every new-folder intent, and `kickCsumFill` prunes both maps to the live file set.
6. **`beginReview` (public API) could stack over an open detail** — refused now (`state.detail` → `return false`), mirroring `dropAcceptable`; the "mutual exclusion by construction" claim holds on every entry point.
7. **Narrow-rail bloom invited a refused drop** — a selection drag bloomed the card open onto an open detail whose drop AC-7 refuses (no-drop cursor on a card that just animated open). Bloom now skipped while detail is set.
8. **Column/detail contradiction** — `openDetail`'s fresh CRC is now written back to cache + cell (keyed by the fresh mtime), so Back can no longer revert the column to a value contradicting the header the user just read.
9. **`dispose()` left an open detail painted** with its Back listener removed — now hides `#pull-pane-detail` and resets `data-view` (the S9.3 clear-visuals-before-listeners rule).
10. **Banned vocabulary** — the story file coined "seam" twice (AC-7, T4); reworded to "boundary" per the user-level CLAUDE.md (wording-only edit to story text, noted in the Change Log).

**Cleanups applied below the 10-finding cap:** `updateCsumCell` O(rows)-scan → one `CSS.escape`d attribute selector; redundant `font-family` declarations dropped (`html, body` already sets the identical monospace stack); `pluralFiles`/`pluralRecords` collapsed to one `plural(n, noun)`; reset/dispose csum-teardown duplication → shared `resetCsumState()`; `state.detail` no longer retains the full records array (DOM is the listing's single home; hook keeps `recordCount`); CRC-32 upgraded to a lazily built 256-entry table (identical output — all vectors re-verified — ~8× less main-thread work per byte); the pre-existing suite's fake `mkFile` pins `lastModified: 0` (its per-call `Date.now()` default minted a fresh cache key every enumeration → needless full re-reads per tick and pending-queue interleaving in `manual`-mode specs); spec (k) strengthened (rebind lands a *different* file so a stale write would be visible as a phantom value).

**Skipped (deliberate):** reusing the enumeration's File for the fill / caching the detail's records (story mandates fresh reads and the spec choreography depends on the second read); zero-pad copy avoidance + chunked CRC yielding (story sanctions the simple form at CP/M sizes); injecting a shared `hex` helper (the story's API-growth watch caps injected opts at `analyzeCsum`); restructuring `enumerateAndRender` to a single exit and a generalized overlay/sub-state mechanism (S10.2's call — drift risk reduced meanwhile by the shared `overlay` const in `render()`).

Post-fix verification: vectors green in node (6/6 incl. the B17ECC3C cross-check), pull-pane-csum + pull-pane spec files 77/77, full suite 499 passed + 6 flaky-passed-on-retry (all pre-existing: tx-sink, selection-drop, slide-config-modal) + 1 skipped = 506.

## Change Log

- 2026-07-24 — Story created (ultimate context engine analysis completed — comprehensive developer guide created; ground-truth vectors generated with real csumhost and embedded). Status: ready-for-dev.
- 2026-07-24 — T1–T6 implemented (csum module + vectors, ambient CRC-32 column with cached sequential fill on both enumeration exits, per-record Fletcher-16 detail sub-state, ⁞ row button, interim drop refusal, 14 new specs, UX-contract dated amendments). Full suite green (495 passed + 10 pre-existing flaky + 1 skipped). Status: review.
- 2026-07-24 — Code review (high effort, --fix): 10 findings fixed + cleanup batch (see Code Review section). Two wording-only edits to AC-7/T4 story text replaced the banned word "seam" with "boundary" (CLAUDE.md vocabulary rule — no semantic change). Post-fix: vectors 6/6, pull-pane files 77/77, full suite 499 passed + 6 pre-existing flaky + 1 skipped. Status: done.
