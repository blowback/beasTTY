# Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the v1.1 FileTransfer milestone. Three behavioral fixes (drag-drop ↔
pointer-select isolation, send-side filename collisions, auto-send command
safety validation) plus three docs (Z80 requirement, README updates,
real-hardware UAT). After this phase, Beastty v1.1 is daily-driver-ready
for SLIDE.

**In scope:**
- **SLIDE-12** — `selection.js:onPointerDown` early-returns when the drop
  overlay is active; Playwright regression spec proves no ghost selection
  / inverse-text artefact remains after a drop.
- **SLIDE-36** — Send-side filename collision detection in
  `file-source.js:processFiles`; user prompted to auto-rename
  (`NAME.TXT, NAME~1.TXT, NAME~2.TXT, …`), refuse the batch, or send only
  the first colliding file. Reuses the existing Phase 9 `<dialog>` modal.
- **SLIDE-38** — `slideAutoSendCommand` validated for safety
  (alphanumeric + `:` + `\r` only; rejects `;`, pipes, non-`\r` control
  chars); first-use confirmation chip surfaces for non-default values.
- **SLIDE-40** — `docs/SLIDE_Z80_REQUIREMENT.md` documents the slide.asm
  `ESC ^ S L I D E` wakeup requirement, the v0.2.1 protocol amendment
  (PC-initiated CTRL_CAN with Z80 echo per ADR-003), the `B:SLIDE R`
  command convention, and links to the upstream
  `github.com/blowback/slide` PR.
- **SLIDE-41** — README.md gains a "File transfer" section; existing
  "Keyboard shortcuts" coverage is extended for drag-drop and the file
  picker.
- **SLIDE-42** — `docs/SLIDE-UAT.md` (mirroring `06-HUMAN-UAT.md` /
  `10-HUMAN-UAT.md`) end-to-end against a patched MicroBeast: send a
  multi-file batch including a binary `.COM`, receive a multi-file batch
  including a zero-byte file, cancel mid-transfer in both directions,
  confirm wire returns to a clean CP/M prompt every time.

**Out of scope:**
- Any new SLIDE protocol behavior — protocol is locked from Phases 7–11.
- Z80-side patch of `slide.asm` — separate repo
  (github.com/blowback/slide). SLIDE-40 documents the requirement and
  links the upstream PR; it does not own the patch itself. The
  Phase 10 UAT-10-01 blocker (Z80 cancel echo) remains blocked until the
  upstream patch lands.
- Recv-side collision handling — already shipped in Phase 10 D-05 (`~N`
  suffix). Phase 12 SLIDE-36 covers SEND only and intentionally mirrors
  the recv `~N` scheme for symmetry.
- P2 differentiators (ETA, NAK counter, pre-send confirm chip,
  open-downloads link, backgrounded-tab redraw skip, auto-send command
  preset dropdown) — DI-* items per FEATURES.md / SUMMARY §4; out of v1
  scope.
- Bulk save / batch download UI, IndexedDB virtual filesystem, long
  filename support beyond CP/M 8.3 — out of scope per PROJECT.md
  §"Out of scope for v1.1".

</domain>

<decisions>
## Implementation Decisions

### Send-side filename collisions (SLIDE-36)

- **D-01:** **Collision detection key = post-truncation uppercased 8.3
  form.** For each surviving file (those that pass `validateCpmFilename`),
  compute `truncateCpm83(name).toUpperCase()` and use that as the
  equivalence-class key. Files with the same key collide.

  Catches all three requirement cases: (a) case-insensitive
  (`report.txt` vs `REPORT.TXT`), (b) 8.3 truncation collision
  (`longname1.txt` vs `longname2.txt` both truncate to `LONGNAME.TXT`),
  (c) mixed case + extension (`a.txt` vs `a.TXT`). Single-pass over
  the post-validation `surviving` array. (Locked.)

- **D-02:** **Surface = extend the existing Phase 9 send modal** in
  `file-source.js:showConfirmModal`. No second `<dialog>`, no separate
  prompt step. The modal grows a fourth row kind (`'collision'`)
  alongside `'rewrite'`, `'unchanged'`, `'rejected'`, displayed as:

  ```
  • REPORT.TXT
       ↳ REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT
  ```

  Reuses focus-trap, `returnValue` plumbing, and the existing
  `[Cancel]` button. Adds three action buttons that resolve the
  Promise with distinct `returnValue`s: `'send'` (auto-rename),
  `'refuse'` (drop the entire batch), `'first-only'` (send only the
  first member of each colliding group). (Locked.)

- **D-03:** **Three resolution buttons; default focus = `[Send N
  renamed]`.** Buttons inside `<menu method="dialog">`:
  - `[Send N renamed]` — `value="send"` — auto-rename via the D-04
    scheme; the modal already shows the full preview list of resulting
    names.
  - `[Refuse batch]` — `value="refuse"` — close modal, drop all files.
  - `[Send only first]` — `value="first-only"` — keep the first
    member of each colliding group, drop the rest from the batch.
  - `[Cancel]` — existing button, returns falsy `userConfirmed`.

  Default focus on `[Send N renamed]` when collisions are present
  (departure from Phase 9's `cancelBtnRef.focus()` default — only
  applies when collisions are detected; the no-collision happy path
  retains the original Cancel-default focus). Auto-rename is the safe
  path — no file is dropped, all transfer, names just gain `~N`
  suffixes that match Phase 10 RECV. (Locked.)

- **D-04:** **`~N` suffix scheme: unlimited via base truncation.**
  Mirrors Phase 10 D-05 RECV semantics for symmetry. For each
  collision group of size K + 1, the first member keeps its name; the
  remaining K members get `~1`, `~2`, …, `~K`.

  When `N ≥ 10`, shrink the base by `len(str(N))` characters to keep
  the total within CP/M 8.3 (8-char base + `.` + 3-char ext). Shrink
  from the *end* of the base (preserves the leading prefix that's
  more likely to be meaningful):
  - `REPORT.TXT` (base=`REPORT`, 6 chars) collides 12 times →
    `REPORT.TXT, REPORT~1.TXT, … REPORT~9.TXT, REPOR~10.TXT,
    REPOR~11.TXT, REPOR~12.TXT`. Base shrinks from 6 to 5 once N hits
    two digits.
  - `LONGNAME.TXT` (base=`LONGNAME`, 8 chars) collides 100 times →
    `LONGNAME.TXT, LONGNAM~1.TXT … LONGNAM~9.TXT, LONGNA~10.TXT …
    LONGNA~99.TXT, LONGN~100.TXT`. Base shrinks from 7 to 6 to 5 as
    N grows.

  Determinism rule: for collision group `{F0, F1, ..., FK}` ordered
  by user-presentation order (first occurrence wins as the "kept"
  name), `F_i` (i ≥ 1) renames to `truncate_base(BASE, 8 - len(str(i)))
  + '~' + str(i) + '.' + EXT`. Base truncation shrinks the existing
  truncated base; it does not re-derive from the original filename.

  This is more permissive than the recommended `~1..~9` cap but
  preserves predictability via a single shrink rule. Edge case: if
  user supplies a filename whose base is already `~N`-shaped
  (e.g. user drops `REPORT~7.TXT`), it's treated as opaque — the
  collision detector compares the post-truncation key as-is. The
  resulting names are unambiguous on the Z80 because CP/M only sees
  the final 8.3 form. (Locked.)

- **D-05:** **Detection runs after `validateCpmFilename` rejection
  filtering and after `truncateCpm83`.** In `processFiles`, after the
  existing `for f of filesArr` loop (lines 248–264) that builds
  `rows` + `surviving`, add a second pass:

  ```js
  // Group surviving files by post-truncation uppercased key.
  const collisionGroups = new Map();
  for (const item of surviving) {
      const key = item.name.toUpperCase();
      if (!collisionGroups.has(key)) collisionGroups.set(key, []);
      collisionGroups.get(key).push(item);
  }
  // Build collision rows for groups with size > 1.
  const collisionRows = [];
  for (const [key, group] of collisionGroups) {
      if (group.length > 1) {
          collisionRows.push({
              kind: 'collision',
              base: key,
              members: group,    // preserves user-presentation order
              renamed: computeRenameScheme(group),
          });
      }
  }
  ```

  `surviving[i].name` is already the post-truncation form (set at line
  263). Uppercasing on top satisfies D-01. `computeRenameScheme` is a
  new pure helper exported alongside `validateCpmFilename` and
  `truncateCpm83` for testability. (Locked.)

- **D-06:** **Modal flow: existing modal renders in three modes.**
  - **No collisions** (`collisionRows.length === 0`): existing flow
    unchanged. Cancel default focus; `[Send N files]` / `[Cancel]`
    buttons.
  - **Collisions present** (`collisionRows.length > 0`): three-action
    button row replaces the existing two-button row. `[Send N renamed]`
    has default focus.
  - **All-rejected hint** (`surviving.length === 0`): existing
    `hintElRef.hidden = false` + disabled send button preserved;
    collision rows can't appear when nothing survived.

  On Promise resolution, `processFiles` switches on the modal's
  `returnValue` to decide the final `surviving` payload before
  calling `enterSendModeFn({ files: surviving })`:
  - `'send'` → apply rename scheme; pass renamed files to enterSendMode.
  - `'first-only'` → for each collision group, keep group[0], drop
    rest; pass kept files (renamed unchanged) to enterSendMode.
  - `'refuse'` → return early; do not call enterSendMode.
  - falsy (Cancel/Esc) → return early. (Locked.)

### Claude's Discretion

The planner has discretion within the locked decisions above for:

- **Modal CSS for the collision row kind.** D-02 specifies the row
  textual format (`• BASE \n ↳ NAME, NAME~1, NAME~2, …`); the planner
  picks the exact CSS treatment (indentation, color, separator
  character). Consistent with the existing `'rewrite'` /
  `'rejected'` row visual idiom in the modal.

- **`computeRenameScheme(group)` helper signature + return shape.**
  D-04 specifies the determinism rule; the planner decides whether
  the helper returns a `string[]` (parallel to `group`) or a
  `Map<originalIndex, newName>`, and whether base truncation is
  inlined or extracted as a sub-helper.

- **Whether to expose `[Send only first]` when there are no
  collisions.** Default: hide it (no surface change to the
  no-collision happy path). Planner may show it disabled for
  consistency if the test surface stays clean.

- **Pointer/drop isolation (SLIDE-12) — predicate mechanism.** The
  requirement specifies the behavior (`onPointerDown` early-returns
  when drop overlay is active); the planner picks how
  `selection.js` learns it: read `[data-drop-target="true"]` on
  `#terminal-wrapper` directly (zero new deps; observes existing DOM
  contract), inject an `isDropOverlayActive()` predicate via
  `wireSelection` opts (cleaner module boundary; one extra plumbing
  step), or a central state module (over-engineered for one bit).
  Default: read the attribute; matches the existing pattern in
  `chrome.js` for `[data-focused]` / `[data-scrolled-back]`.
  Whatever mechanism is picked, the regression Playwright spec
  must prove no ghost selection / inverse-text artefact remains
  after a drop completes (matches the SLIDE-12 success criterion).

- **Pointer/drop isolation — in-flight drag if drop activates
  mid-drag.** The requirement is silent on this. Default: if a drag
  is in flight when drop overlay activates, cancel the drag
  (`clearSelection()`). Drop should win because file-source already
  set the overlay attribute by the time `dragenter` fired. Planner
  may revise if the tests find a cleaner contract.

- **Auto-send safety (SLIDE-38) — validation site.** The requirement
  specifies the rule (alphanumeric + `:` + `\r` only; rejects `;`,
  pipes, non-`\r` control chars). The planner picks where to
  enforce: at save time in `prefs.js` (sanitize on input,
  Settings input rejects invalid chars), at use time in `slide.js`
  (validate just before auto-type), or both (defense-in-depth).
  Default: validate at use time + render a rejection chip from the
  Settings input (visual cue without blocking save). The first-use
  confirmation chip surface is also Discretion: chip flash via the
  existing `slideChip.flashDropRejected()`-style API vs a one-shot
  `<dialog>` confirm. Default: chip with `[Confirm] [Reset to
  default]` action buttons mirroring the SLIDE-35 timeout chip
  pattern.

- **Auto-send safety — "default" detection scope.** The first-use
  confirmation surfaces for "non-default values". Default
  interpretation: any value that does not exactly match the
  DEFAULTS literal `'B:SLIDE R\r'` triggers the one-time
  confirmation. Planner may broaden to "any value with `:` not
  followed by `SLIDE`" if exact match feels too strict.

- **Z80 requirement doc (SLIDE-40) — depth.** The requirement
  enumerates four content items (a)–(d); the planner picks the
  doc length, whether to inline the slide.asm patch diff or just
  link to the upstream PR, and the audience framing (Z80
  firmware authors vs Beastty users vs both). Default: both
  audiences, brief — protocol amendment summary + B:SLIDE R
  command convention + link to the upstream PR; no inlined diff.
  Coordinate with the PR landing status — if the PR isn't merged
  by Phase 12 plan time, mark the doc with a "Status: pending
  upstream merge" banner per the same pattern as Phase 10
  UAT-10-01's blocked-result line.

- **README.md updates (SLIDE-41) — structure.** The requirement
  asks for a new "File transfer" section + extended "Keyboard
  shortcuts" coverage. The planner picks: append (preserve
  existing layout) vs restructure (give File transfer top-level
  prominence). Default: append the new section; extend keyboard
  shortcuts in place. Existing README is 102 lines — appending
  keeps the diff minimal. Add screenshots only if a single
  representative image clarifies the drag-drop UI; otherwise
  text-only.

- **UAT scope (SLIDE-42) — scope of the document.** The
  requirement specifies "end-to-end against a patched MicroBeast"
  with 4 enumerated test classes. Mirroring `10-HUMAN-UAT.md`
  format (front-matter + tests with expected/steps/result) is
  the locked-in template. Planner picks: SLIDE-only (4 tests
  covering the requirement enumeration) vs broader daily-driver
  pass (SLIDE + post-SLIDE-session terminal-mode sanity checks).
  Default: SLIDE-only — keeps the doc focused; the broader
  daily-driver UAT already lives in `06-HUMAN-UAT.md`. UAT
  acceptance criteria match the existing "result: pass / fail /
  blocked" status line; blocked results are acceptable when the
  upstream slide.asm patch hasn't landed (mirrors UAT-10-01's
  current blocked status).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent

- `.planning/PROJECT.md` §"Out of scope for v1.1" — confirms what
  Phase 12 is NOT allowed to add (long filenames, IndexedDB FS,
  bulk save UI). §"Current Milestone: v1.1 FileTransfer" — locked
  scope context.
- `.planning/REQUIREMENTS.md` SLIDE-12, SLIDE-36, SLIDE-38,
  SLIDE-40, SLIDE-41, SLIDE-42 — the six Pending requirements
  this phase closes.
- `.planning/ROADMAP.md` §Phase 12 — goal, dependencies, 5
  success criteria.

### Prior phase context (cross-phase consistency)

- `.planning/phases/09-slide-sender-host-z80-send/09-CONTEXT.md` —
  send modal pattern (`<dialog>` + `processFiles` +
  `showConfirmModal`); validateCpmFilename + truncateCpm83
  contracts; D-13 auto-type flow (Phase 12 SLIDE-38 validates the
  command consumed here).
- `.planning/phases/10-slide-receiver-cancellation/10-CONTEXT.md` —
  **D-05 RECV-side `~N` collision suffix** (Phase 12 SLIDE-36
  mirrors this scheme for SEND); 10-HUMAN-UAT.md format (Phase 12
  SLIDE-42 mirrors); UAT-10-01 blocked status (Z80 patch
  dependency same as SLIDE-40).
- `.planning/phases/11-slide-js-bridge-v1-0-integration/11-CONTEXT.md` —
  **D-09 `slideAutoSendCommand` prefs key** (Phase 12 SLIDE-38
  validates); D-10 `slideChip.flashDropRejected()` pattern
  (Phase 12 SLIDE-38 first-use confirm chip surface candidate);
  Settings SLIDE sub-block layout (Phase 12 SLIDE-38 may add
  validation feedback row).
- `.planning/phases/06-daily-driver-polish-session-deployment/06-CONTEXT.md` —
  D-32/D-33 prefs versioned blob + 250 ms debounced save (Phase
  12 SLIDE-38 validation site decision interacts with this).

### Existing project decisions

- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` —
  bidirectional CTRL_CAN echo contract; Phase 12 SLIDE-40 doc
  cites this ADR as the protocol authority.
- `.planning/decisions/ADR-001-parser-strategy.md` — irrelevant to
  Phase 12 work but listed for completeness.
- `.planning/decisions/ADR-002-wasm-gating.md` — irrelevant to
  Phase 12 work; this phase ships zero Rust changes.

### SLIDE upstream protocol & reference impls

- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol spec
  Phase 12 SLIDE-40 doc cites.
- `/home/ant/src/microbeast/SLIDE/slide.asm` — the Z80-side file
  whose patch is the SLIDE-40 dependency. Located in the
  upstream `github.com/blowback/slide` repo (referenced as the
  PR target).
- `/home/ant/src/microbeast/SLIDE/README.md` — upstream README;
  Phase 12 SLIDE-40 links to upstream.

### Existing JS shell seams (Phase 12 modifies / honours)

- `www/input/file-source.js` lines 243–334 (`processFiles` +
  `showConfirmModal`) — **Phase 12 SLIDE-36 extension point**.
  Existing pure exports `validateCpmFilename` (line 364) and
  `truncateCpm83` (line 395) are reused; new
  `computeRenameScheme` export sits alongside.
- `www/input/file-source.js:181, 200, 206, 215` — `isSessionActive()`
  guards (read-only references for Phase 12; SLIDE-36 doesn't
  alter the active-session drop-rejection flow installed in
  Phase 11 D-10).
- `www/input/selection.js:113` (`onPointerDown`) — **Phase 12
  SLIDE-12 modification point**. Inserts the drop-overlay
  early-return.
- `www/index.html` (data-drop-target attribute on
  `#terminal-wrapper`, set/cleared by `setDropTarget` at
  `file-source.js:233-240`) — Phase 12 SLIDE-12 may read this
  attribute as the overlay-active predicate.
- `www/state/prefs.js:30` (`slideAutoSendCommand`) — Phase 12
  SLIDE-38 validation site candidate (sanitize on save).
- `www/transport/slide.js:188` (`cmd = prefsRef.slideAutoSendCommand`)
  — Phase 12 SLIDE-38 validation site candidate (validate at
  use).
- `www/renderer/slide-chip.js` — Phase 12 SLIDE-38 first-use
  confirmation chip surface; consumed via the chip module's
  imperative state-transition API
  (`enterAwaitingWakeup` / `enterError` / `flashDropRejected` —
  per Phase 11 D-10/C-02).
- `www/tests/transport/` — Phase 12 adds
  `slide-collisions.spec.js` (SLIDE-36), extends
  `slide-bridge.spec.js` or adds new `selection-drop.spec.js`
  (SLIDE-12 regression), `slide-autosend-safety.spec.js`
  (SLIDE-38).

### Build / test orchestration

- `scripts/build.sh` — Phase 12 ships ZERO Rust changes; the
  wasm-pack build is a no-op for this phase.
- `www/playwright.config.js` — Phase 12 adds new spec files;
  configuration unchanged.

### Phase 10 UAT format reference

- `.planning/phases/10-slide-receiver-cancellation/10-HUMAN-UAT.md`
  — exact format `docs/SLIDE-UAT.md` mirrors. Front-matter +
  Setup section + tests with `expected:` / `steps:` / `result:`
  per test. Blocked-result handling for upstream-Z80-pending
  cases is the established pattern.

### Existing user-visible doc

- `README.md` (102 lines) — **Phase 12 SLIDE-41 extension point**.
  Append "File transfer" section; extend "Keyboard shortcuts"
  coverage in place.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`file-source.js:processFiles`** (lines 243–274) — already builds
  `rows` (rewrite/unchanged/rejected kinds) + `surviving` arrays.
  Phase 12 SLIDE-36 adds a second pass after this loop to compute
  collision groups, then a fourth row kind `'collision'`.
- **`file-source.js:showConfirmModal`** (lines 277–334) — Promise-
  returning native `<dialog>` with `returnValue` plumbing; reused
  unchanged structurally. New action buttons added inside the
  `<menu>`; default focus override applies only when collisions are
  present.
- **`file-source.js:validateCpmFilename`** (line 364) +
  **`truncateCpm83`** (line 395) — pure exported helpers; SLIDE-36
  composes their output to derive the collision detection key
  (`truncateCpm83(name).toUpperCase()` per D-01). New
  `computeRenameScheme` helper exports alongside them.
- **Phase 10 RECV `~N` scheme** — already shipped in
  `slide-recv.js`; Phase 12 SLIDE-36 mirrors it on SEND for
  symmetry. The unlimited-via-base-truncation rule (D-04) is more
  permissive than RECV but uses the same `~N` infix and
  base-shrink direction (from the end of the base).
- **Phase 11 `slideChip.flashDropRejected()` pattern** — the
  imperative chip-state API. SLIDE-38 first-use confirmation chip
  reuses this surface (via a new `enterAwaitingConfirm()` or
  similar method on the chip module — exact name is planner's
  call).
- **`selection.js:onPointerDown`** (line 113) — single insertion
  point for the SLIDE-12 early-return. The function is local to
  the module; the predicate (DOM attribute read or injected
  callback) is the only new dependency.
- **`[data-drop-target="true"]` attribute on `#terminal-wrapper`**
  — already set/cleared by `file-source.js:setDropTarget`. Phase
  12 SLIDE-12 reads this attribute as the overlay-active signal
  (or planner injects an explicit predicate; either path works).
- **10-HUMAN-UAT.md** — exact format template for SLIDE-42's
  `docs/SLIDE-UAT.md`. Same front-matter, same Setup section,
  same expected/steps/result per-test format, same
  blocked-result idiom for upstream-pending tests.

### Established Patterns

- **Pure-function exports for testability** (Phase 9 +
  `file-source.js`): `validateCpmFilename`, `truncateCpm83` are
  exported and unit-testable. SLIDE-36 adds `computeRenameScheme`
  in the same vein.
- **Modal `returnValue`-driven flow** — switch on the dialog's
  return string in the calling code; SLIDE-36 adds two new return
  values (`'refuse'`, `'first-only'`) without changing the
  resolution shape.
- **`[data-*]` attribute as cross-module signal** — `[data-focused]`
  (Phase 3), `[data-scrolled-back]` (Phase 6), `[data-drop-target]`
  (Phase 9). SLIDE-12 reading the existing attribute fits the
  established pattern.
- **No Rust changes in JS-bridge / polish phases** — Phase 12 ships
  zero modifications to `crates/bestialitty-core/`. Locked from
  Phases 7–11.
- **Doc files mirroring `XX-HUMAN-UAT.md` format** — `06-HUMAN-UAT.md`
  and `10-HUMAN-UAT.md` are the established pattern. SLIDE-42's
  `docs/SLIDE-UAT.md` lifts the structure verbatim, only the
  filename location differs (top-level `docs/` per SLIDE-42 vs
  `.planning/phases/XX-*/` for the phase UATs).
- **Upstream-blocked status via `result: blocked` line** — Phase
  10 UAT-10-01 establishes the pattern when a UAT depends on
  upstream code that hasn't landed. SLIDE-42's Z80-cancel-echo
  test inherits the same blocked-status approach until the
  slide.asm patch is merged.

### Integration Points

- **`www/input/file-source.js`** — SLIDE-36: extend `processFiles`
  with collision-detection second pass; extend `showConfirmModal`
  with `'collision'` row kind + 3-action button row + default
  focus override; export new pure helper `computeRenameScheme`.
  Optional Claude's Discretion: cleanup of the Phase 9
  button-state observer at line 115.
- **`www/input/selection.js`** — SLIDE-12: insert early-return at
  `onPointerDown` (line 113) when drop overlay is active. Single
  conditional, ~3 lines.
- **`www/state/prefs.js`** — SLIDE-38 validation site candidate.
  Either sanitize on save (input rejection) or store-as-typed and
  validate at use; planner's call.
- **`www/transport/slide.js`** — SLIDE-38 validation site
  candidate (validate at line 188 use site).
- **`www/renderer/slide-chip.js`** — SLIDE-38 first-use
  confirmation chip surface; new lifecycle state + buttons.
- **`www/index.html`** — possibly extends Settings SLIDE sub-block
  with a validation-feedback row for SLIDE-38 (Claude's
  Discretion).
- **`README.md`** — SLIDE-41: append "File transfer" section;
  extend "Keyboard shortcuts" in place.
- **`docs/SLIDE_Z80_REQUIREMENT.md`** (NEW) — SLIDE-40.
- **`docs/SLIDE-UAT.md`** (NEW) — SLIDE-42.
- **`www/tests/transport/slide-collisions.spec.js`** (NEW) —
  SLIDE-36 Playwright coverage.
- **`www/tests/transport/slide-autosend-safety.spec.js`** (NEW) —
  SLIDE-38 Playwright coverage.
- **`www/tests/render/selection-drop.spec.js`** (NEW or extension
  of existing selection spec) — SLIDE-12 regression Playwright
  coverage.

</code_context>

<specifics>
## Specific Ideas

- **Collision modal row visual sketch (D-02):**
  ```
  • REPORT.TXT     ← original kept as-is (first member of group)
       ↳ REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT
  • LONGNAME.TXT   ← truncated form of original 'longname1.txt'
       ↳ LONGNAM~1.TXT, LONGNAM~2.TXT, …
  ```
  The header row shows the post-truncation key (the canonical
  collision base); the indented `↳` row shows the resulting names
  after the rename scheme is applied.

- **Three-action button row (D-03):**
  ```
  [Send 6 renamed]  [Send only first]  [Refuse batch]  [Cancel]
   ^^^^^^^^^^^^^^^
   default focus
  ```
  Only the leading button has the "(N)" count substituted in real
  time as the user reviews the modal.

- **Rename scheme determinism rule (D-04):**
  - Group of size K + 1 → K + 1 names: `[F0_kept, F1~1, F2~2, …,
    FK~K]`.
  - For `i ≥ 1`: `name_i = truncate_base(BASE, 8 - len(str(i))) +
    '~' + str(i) + '.' + EXT`.
  - `truncate_base(s, n) = s[:n]` — drop from the end.
  - The "kept" name is the user-presentation-order first member
    of the group; subsequent members get suffixes in their
    user-presentation order.
  - Tests should pin: 12-collision case, 100-collision case,
    base-already-7-chars case, no-extension case.

- **Pointer/drop isolation (SLIDE-12) — minimal diff sketch:**
  ```js
  function onPointerDown(ev) {
      if (ev.button !== 0) return;
      // SLIDE-12: drop overlay active → defer to file-source.js drag handlers.
      if (canvasRef.parentElement?.getAttribute('data-drop-target') === 'true') {
          return;
      }
      ev.preventDefault();
      // ... existing body
  }
  ```
  Three-line insertion. The `parentElement` walk lands on
  `#terminal-wrapper` (the drop attribute owner). Planner may
  prefer an injected predicate; the behavior is identical.

- **Auto-send safety regex (SLIDE-38):**
  ```js
  const SAFE_AUTO_SEND_RE = /^[A-Za-z0-9:]*\r$/;
  // Examples:
  //   'B:SLIDE R\r'  → valid (default)
  //   'A:SLIDE R\r'  → valid (drive switch)
  //   'B:SLIDE\r'    → valid (no R; user drives slide.com manually)
  //   ''             → valid (disabled per SLIDE-13)
  //   'B:SLIDE R'    → invalid (missing trailing \r)
  //   'B:SLIDE R\n'  → invalid (LF instead of CR)
  //   'B:SLIDE R; rm -rf /\r' → invalid (semicolon)
  //   'B:SLIDE R\rB:DIR\r'    → invalid (multiple \r)
  ```
  Empty string is the SLIDE-13 "disabled" sentinel and bypasses
  validation entirely.

- **First-use confirmation copy (SLIDE-38 Discretion default):**
  ```
  Confirm auto-send command: "B:DIR\r"
  This will be typed automatically before each SLIDE session.
  [Confirm]  [Reset to default]
  ```
  Surfaces as a chip flash on Settings save when the new value
  != the DEFAULTS literal. Persists `slideAutoSendCommandConfirmed:
  true` in prefs once confirmed; the flag is keyed to the exact
  string so changing the value re-arms confirmation.

- **`docs/SLIDE_Z80_REQUIREMENT.md` outline (SLIDE-40 default):**
  ```
  # SLIDE — Z80-side requirements

  ## Wakeup signature: ESC ^ S L I D E
  Beastty enters SLIDE recv mode only after detecting this 7-byte
  signature. Pre-v0.2.1 slide.com does NOT emit it; modern
  slide.com (post-PR-XX) does.

  ## v0.2.1 amendment: bidirectional CTRL_CAN echo
  See ADR-003 (.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md).
  Z80 must echo CTRL_CAN within 500 ms of receiving one.

  ## Send command convention: B:SLIDE R
  ...

  ## Upstream patch
  PR: https://github.com/blowback/slide/pull/XX (status: pending merge)
  ```

- **`docs/SLIDE-UAT.md` test outline (SLIDE-42 default):**
  ```
  UAT-12-01: Multi-file send including binary .COM
  UAT-12-02: Multi-file recv including zero-byte file
  UAT-12-03: Cancel mid-send (PC-initiated)
  UAT-12-04: Cancel mid-recv (PC-initiated; Z80 echo verified)
  ```
  Each test follows 10-HUMAN-UAT.md's expected/steps/result
  format. UAT-12-04 inherits UAT-10-01's blocked status until
  the upstream slide.asm patch lands.

</specifics>

<deferred>
## Deferred Ideas

Out of scope for Phase 12; tracked here so they're not lost:

- **`~N` collision scheme harmonization across SEND and RECV.**
  Phase 10 D-05 ships RECV `~N`; Phase 12 D-04 ships SEND
  unlimited-via-base-truncation. RECV is currently capped (per
  Phase 10 CONTEXT — re-verify); if the two diverge in the cap
  rule, a future cleanup phase could harmonize. Not blocking
  v1.1.
- **First-use confirmation flag granularity (SLIDE-38).**
  D-* (Discretion) keys the confirmation flag to the exact
  string. A future improvement could key it to a hash or to
  the user's confirmation history. Not blocking; the simple
  exact-match flag is fine for v1.
- **Z80 patch coordination with upstream.** SLIDE-40 documents
  the requirement and links the PR; the actual PR landing is
  out of Beastty's control. Track in PROJECT.md "Current
  Milestone" status notes; revisit during milestone close.
- **UAT screencasts / video recordings.** SLIDE-42 default is
  text-only UAT format. Recording sessions would aid future
  troubleshooting; not in v1 scope.
- **Stress-test UAT: 100-file batches, 10 MB+ single files.**
  10-HUMAN-UAT.md already covers 1 MB+ at the day-driver
  level; SLIDE-42 inherits that bar. Bigger stress tests
  would be a v2-XPORT extension.

</deferred>

---

*Phase: 12-slide-ux-polish-docs-real-hardware-uat*
*Context gathered: 2026-05-08*
