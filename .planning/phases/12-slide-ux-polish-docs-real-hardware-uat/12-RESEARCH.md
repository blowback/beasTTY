# Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT — Research

**Researched:** 2026-05-08
**Domain:** JS-shell UX polish (no Rust changes); user-facing documentation; real-hardware UAT scaffolding for the v1.1 FileTransfer milestone
**Confidence:** HIGH

## Summary

Phase 12 is a six-requirement closeout phase. None of the work needs new
libraries — every concern lands in existing modules with well-established
patterns from Phases 6/9/10/11. The phase splits cleanly into three
behavior fixes (SLIDE-12 pointer/drop isolation, SLIDE-36 send-side
collision UX, SLIDE-38 auto-send safety) plus three documentation
deliverables (SLIDE-40 Z80 requirement doc, SLIDE-41 README extension,
SLIDE-42 real-hardware UAT). The dominant risk is **scope inversion**:
Phase 11 already ships extensive chip + Settings infrastructure that the
Phase 12 deliverables only extend by single-line touches. Plans must
treat the existing module shapes (`file-source.js`, `selection.js`,
`prefs.js`, `slide.js`, `slide-chip.js`) as locked contracts and avoid
restructuring them.

Two upstream-blocked items shape the docs: (1) the `github.com/blowback/slide`
PR carrying the `ESC ^ S L I D E` wakeup + bidirectional CTRL_CAN echo
amendment is **NOT YET MERGED** (verified by inspecting
`/home/ant/src/microbeast/SLIDE/slide.asm` head: declares `SLIDE v0.4`
but contains zero ESC^SLIDE emission and zero CTRL_CAN echo path); (2)
Phase 10 UAT-10-01 is already in `result: blocked` status awaiting that
same patch. SLIDE-40's doc must therefore frame the Z80 work as a live
dependency and SLIDE-42's UAT must mark the cancel-echo test as `blocked`
with the same idiom Phase 10 already established.

**Primary recommendation:** Plan in five plans — (1) SLIDE-12 selection
fix + spec, (2) SLIDE-36 collision UX + tests + helper, (3) SLIDE-38
safety validation + first-use chip + tests, (4) SLIDE-40 + SLIDE-41 docs
together (both are pure markdown), (5) SLIDE-42 UAT scaffold. Atomic;
each plan ships to a single commit boundary cleanly.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pointer drag vs file-drop arbitration (SLIDE-12) | JS shell input layer (`selection.js`) | DOM (`#terminal-wrapper[data-drop-target]`) | Pure browser-side concern: pointer events vs drag events compete for the same canvas element. No Rust involvement. |
| Filename collision detection (SLIDE-36) | JS shell input layer (`file-source.js`) | — | Must run pre-flight in JS so the modal can show the rewrite list before the SLIDE session opens. Rust core never sees the original filenames. |
| Filename collision rename application (SLIDE-36) | JS shell input layer (`file-source.js`) | — | New pure helper `computeRenameScheme` exports next to existing `validateCpmFilename` + `truncateCpm83`. |
| Auto-send command safety regex (SLIDE-38) | JS shell — split: validation site = `slide.js` use-time read AND `prefs.js` save-time | `slide-chip.js` (first-use confirm surface) | Defense-in-depth: regex at use site is the wire-safety contract; save-time validation gives Settings input visual feedback. Confirm chip is rendered surface only. |
| First-use confirmation persistence (SLIDE-38) | JS shell state (`prefs.js` new key `slideAutoSendCommandConfirmed`) | — | Sticky flag, like `localEcho` — boolean keyed to the exact command string. |
| Z80 requirement doc (SLIDE-40) | Repo top-level `docs/` | Cross-link: ADR-003, upstream PR | Markdown only; audience is Z80 firmware authors + curious Beastty users. |
| README "File transfer" section (SLIDE-41) | Repo root `README.md` | — | Markdown only; mirror existing structure (level-2 sections, simple tables). |
| Real-hardware UAT (SLIDE-42) | Repo top-level `docs/` | Cross-link: 10-HUMAN-UAT.md format template | Markdown only; mirrors `10-HUMAN-UAT.md` per CONTEXT canonical_refs. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**SLIDE-36 filename collisions:**

- **D-01:** Collision detection key = `truncateCpm83(name).toUpperCase()`. Files with the same key collide. Catches case-insensitive, 8.3-truncation, and mixed case+ext cases. Single pass over post-validation `surviving` array.
- **D-02:** Surface = extend the existing Phase 9 send `<dialog>` modal. No second dialog; no separate prompt step. Modal grows a fourth row kind (`'collision'`) alongside `'rewrite'`, `'unchanged'`, `'rejected'`, displayed as `• REPORT.TXT \n     ↳ REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT`. Reuses focus-trap + `returnValue` plumbing + existing `[Cancel]`. Adds three action buttons returning distinct values: `'send'`, `'refuse'`, `'first-only'`.
- **D-03:** Three resolution buttons, default focus on `[Send N renamed]` when collisions present. The departure from Phase 9's Cancel-default focus only applies in the collision-present flow; the no-collision happy path retains Cancel-default. Auto-rename is the safe path — no file dropped, only `~N` suffixes added that match Phase 10 RECV.
- **D-04:** `~N` suffix scheme: **unlimited via base truncation**. For each collision group of size K+1, first member keeps name; remaining K get `~1`, `~2`, ..., `~K`. When `N ≥ 10`, shrink the existing truncated base by `len(str(N))` chars from the END. Determinism rule: `name_i = truncate_base(BASE, 8 - len(str(i))) + '~' + str(i) + '.' + EXT` for `i ≥ 1`. Tests must pin: 12-collision case, 100-collision case.
- **D-05:** Detection runs after `validateCpmFilename` rejection filtering and after `truncateCpm83`. Second pass after the existing `for f of filesArr` loop (lines 248–264). New pure helper `computeRenameScheme` exports alongside existing helpers for testability.
- **D-06:** Modal renders in three modes:
  - No collisions → existing flow unchanged. Cancel-default focus; `[Send N files]` / `[Cancel]` buttons.
  - Collisions present → three-action button row replaces the existing two-button row. `[Send N renamed]` default focus.
  - All-rejected hint → existing `hintElRef.hidden = false` + disabled send button preserved; collision rows can't appear when nothing survived.
  - Promise resolution: `'send'` → apply rename scheme; `'first-only'` → keep group[0] for each colliding group, drop rest; `'refuse'` → return early; falsy (Cancel/Esc) → return early.

### Claude's Discretion

- **Modal CSS for the collision row kind** — D-02 fixes the textual format; planner picks indent/color/separator. Should match the existing `'rewrite'` / `'rejected'` row visual idiom.
- **`computeRenameScheme(group)` helper signature/return shape** — `string[]` parallel to `group`, or `Map<originalIndex, newName>`. Whether base truncation is inlined or extracted as a sub-helper.
- **Whether to expose `[Send only first]` when no collisions** — Default: hide it. Planner may show disabled for consistency.
- **Pointer/drop isolation (SLIDE-12) — predicate mechanism** — Default: read `[data-drop-target="true"]` on `#terminal-wrapper` directly (matches existing `[data-focused]` / `[data-scrolled-back]` pattern). Alternatives: inject `isDropOverlayActive()` predicate via `wireSelection` opts; central state module (over-engineered).
- **Pointer/drop isolation — in-flight drag handling when overlay activates mid-drag** — Default: cancel the drag (`clearSelection()`) — drop should win because file-source already set the overlay attribute by the time `dragenter` fired.
- **Auto-send safety (SLIDE-38) — validation site** — Default: validate at use time + render rejection chip from Settings input (visual cue without blocking save). Alternatives: prefs save sanitization (input rejection), defense-in-depth (both).
- **Auto-send first-use confirmation surface** — Default: chip via `slideChip.flashDropRejected()`-style API with `[Confirm] [Reset to default]` mirroring SLIDE-35 timeout chip pattern. Alternative: one-shot `<dialog>`.
- **Auto-send "default" detection scope** — Default: any value not exactly equal to DEFAULTS literal `'B:SLIDE R\r'` triggers confirmation. Alternative: broader heuristic ("any value with `:` not followed by `SLIDE`").
- **SLIDE-40 doc depth** — Default: brief, both audiences (Z80 firmware authors + Beastty users), protocol amendment summary + B:SLIDE R + link to upstream PR; no inlined diff. Coordinate with PR landing status — if PR not merged at plan time, mark doc with "Status: pending upstream merge" banner per Phase 10 UAT-10-01 pattern.
- **README structure** — Default: append the new "File transfer" section; extend keyboard shortcuts in place. Existing README is 102 lines; appending keeps the diff minimal. Add screenshots only if a single image clarifies the drag-drop UI; otherwise text-only.
- **UAT scope** — Default: SLIDE-only (4 tests covering the requirement enumeration). 10-HUMAN-UAT.md format is locked. Blocked-result handling for upstream-pending tests follows UAT-10-01 idiom.

### Deferred Ideas (OUT OF SCOPE)

- `~N` collision scheme harmonization across SEND and RECV (Phase 10 D-05 RECV cap rule may differ from Phase 12 D-04 unlimited rule — future cleanup phase).
- First-use confirmation flag granularity (hash-keyed; planner uses simple exact-match).
- Z80 patch landing coordination (out of Beastty's control; track in PROJECT.md).
- UAT screencasts / video recordings (text-only UAT in v1).
- Stress-test UAT: 100-file batches, 10 MB+ single files (10-HUMAN-UAT.md covers 1 MB+ — bigger stress is v2-XPORT extension).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SLIDE-12 | `selection.js:onPointerDown` early-returns when drop overlay is active; Playwright regression spec proves no ghost selection / inverse-text artefact remains after drop | Section "SLIDE-12 — Pointer/Drop Isolation" + minimal-diff sketch |
| SLIDE-36 | Send-side filename collision detection in `processFiles`; user prompted to auto-rename, refuse, or send-only-first | Section "SLIDE-36 — Send-Side Collision Algorithm" with full pseudocode + edge cases + test pinning |
| SLIDE-38 | `slideAutoSendCommand` validated for safety; first-use confirmation chip surfaces for non-default values | Section "SLIDE-38 — Auto-Send Safety" with regex + validation site + chip surface recommendations |
| SLIDE-40 | `docs/SLIDE_Z80_REQUIREMENT.md` — wakeup requirement + v0.2.1 amendment + B:SLIDE R + upstream PR link | Section "SLIDE-40 — Z80 Requirement Doc" with outline + PR-pending handling |
| SLIDE-41 | README.md gains "File transfer" section + extended "Keyboard shortcuts" | Section "SLIDE-41 — README Updates" with section diffs |
| SLIDE-42 | `docs/SLIDE-UAT.md` mirroring `10-HUMAN-UAT.md` end-to-end UAT against patched MicroBeast | Section "SLIDE-42 — Real-Hardware UAT" with 4 test specifications |

## Project Constraints (from CLAUDE.md)

- **Rust → wasm core** owns parser/state/key-encoding; Phase 12 ships **ZERO Rust changes** (mirrors Phase 11 hard invariant).
- **JS shell** owns Web Serial I/O, canvas rendering, event loop, browser state.
- **Web Serial driven from JS, not Rust.** Phase 12 makes no protocol-level changes; only consumes existing wire contracts.
- **Chromium-only.** Phase 12 docs (README + Z80 + UAT) reaffirm this stance.
- **Static site deploy only.** No server runtime added.
- **VT52 pragmatic subset** — Phase 12 doesn't touch parser; consumes existing.
- **No AI attribution in commit messages** (per user MEMORY).
- **Wasm rebuild requires hard reload** — irrelevant; no wasm changes.
- **Project renamed BestialiTTY → Beastty** — use `beastty` everywhere going forward in new docs (existing CLAUDE.md / PROJECT.md / repo path retain old `bestialitty` references). Comments still bear `Bestialitty` in some files (e.g., `file-source.js:1`); planner does NOT bulk-rename in Phase 12 (deferred).

## Standard Stack

### Core (NO new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) | — | — | Phase 12 ships zero new deps. All work uses native browser APIs (`<dialog>`, drag/drop, `URL.createObjectURL`, `localStorage`, `setTimeout`) plus existing Phase 9/10/11 module structure. [VERIFIED: scanning the file-source.js / selection.js / slide.js source — every API in use is already in production] |

### Supporting (existing modules consumed)

| Module | Existing role | Phase 12 extension |
|--------|---------------|--------------------|
| `www/input/file-source.js` | Phase 9 send picker + drop + validation + modal | SLIDE-36: add `computeRenameScheme` export, second pass after validation loop, `'collision'` row kind in `showConfirmModal`, three-action button row, default-focus override [VERIFIED: file read in full — current shape is 458 LOC, 6 exports, supports the extension cleanly] |
| `www/input/selection.js` | Phase 6 pointer drag-select | SLIDE-12: insert early-return at `onPointerDown` line 113-115 [VERIFIED: file read — `onPointerDown` body begins at line 113, `ev.preventDefault()` at line 115] |
| `www/state/prefs.js` | Phase 6 versioned blob | SLIDE-38: add `slideAutoSendCommandConfirmed: false` to DEFAULTS (or related flag for first-use tracking); optional save-time sanitization wrapper [VERIFIED: file read — DEFAULTS at line 18-33, savePrefs debounce at line 86-90] |
| `www/transport/slide.js` | Phase 8/9/10/11 dispatcher + auto-send | SLIDE-38: validate at use time before `pushTxBytes` in `enterSendMode`/`enterSendModeInternal` [VERIFIED: file read — `readAutoSendCommandBytes` at line 183-196 is the canonical use site] |
| `www/renderer/slide-chip.js` | Phase 11 chip lifecycle | SLIDE-38: optional new `enterAwaitingConfirm` state OR reuse `enterError(reason)` for first-use chip flash with action buttons [VERIFIED: file read — chip already supports inline buttons via `wireInlineButtons`/`handleInlineAction` at line 263-288, observable via `onStateChange`] |
| `README.md` | 102-line existing user-facing doc | SLIDE-41: append "File transfer" section + extend "Keyboard shortcuts" [VERIFIED: file read in full] |
| `docs/SLIDE_Z80_REQUIREMENT.md` | NEW | SLIDE-40 |
| `docs/SLIDE-UAT.md` | NEW | SLIDE-42 |
| `docs/` directory | DOES NOT EXIST YET | Plan creates it as part of SLIDE-40 plan [VERIFIED: `ls /home/ant/src/microbeast/bestialitty/docs` returns "no docs/ dir yet"] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reading `[data-drop-target]` from selection.js | Inject `isDropOverlayActive` predicate via `wireSelection` opts | Cleaner module boundary but adds plumbing through main.js. Default reads attribute (matches `[data-focused]` / `[data-scrolled-back]` patterns at chrome.js). |
| Validation at use site (slide.js) | Validation at save site (prefs.js) | Save-site rejection feels protective but blocks valid transient edits; use-site validation is the wire-safety contract. **Recommend BOTH**: save-time produces visual feedback (chip flash), use-time is the hard gate. |
| First-use chip via `slideChip.flashDropRejected()`-style | One-shot `<dialog>` confirm | Chip preserves single-modal-at-a-time UX (Phase 9 modal already exists; second `<dialog>` would compete for focus and z-index). Chip + action buttons mirrors SLIDE-35's existing pattern verbatim. |
| Append to README | Restructure README | Append preserves 102-line existing flow; restructure burns user comprehension for negligible gain. |

**Installation:** None — no new packages.

**Version verification:** Skipped; no new packages added in Phase 12.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────────────┐
                        │                Phase 12 surface area            │
                        └─────────────────────────────────────────────────┘
                                              │
       ┌──────────────────────┬───────────────┼───────────────┬──────────────────┐
       ▼                      ▼               ▼               ▼                  ▼
  ┌──────────┐         ┌────────────┐  ┌──────────┐    ┌──────────┐       ┌──────────┐
  │SLIDE-12  │         │ SLIDE-36   │  │SLIDE-38  │    │SLIDE-40  │       │SLIDE-41  │
  │selection │         │ file-source│  │auto-send │    │Z80 doc   │       │README    │
  │  .js     │         │   .js      │  │ safety   │    │          │       │          │
  └────┬─────┘         └──────┬─────┘  └────┬─────┘    └────┬─────┘       └────┬─────┘
       │                      │             │               │                  │
       │ reads                │ extends     │ extends       │ ↳cross-refs:     │
       │ [data-drop-target]   │ processFiles│ readAuto-     │   ADR-003        │ markdown
       │ from #terminal-      │ +           │ SendCommand   │   SPEC-v0.2      │ append
       │ wrapper              │ showConfirm-│ Bytes()       │   upstream PR    │
       ▼                      │ Modal       │ at slide.js   │                  │
  ┌──────────┐                │             │ line 183      │                  │
  │ on-      │                ▼             ▼               ▼                  ▼
  │ Pointer- │           ┌──────────────────────┐    ┌──────────┐       ┌──────────┐
  │ Down     │           │  computeRename-      │    │ docs/    │       │README.md │
  │ early-   │           │  Scheme(group)       │    │ SLIDE_   │       │  + new   │
  │ return   │           │   pure helper        │    │ Z80_REQ  │       │  "File   │
  └──────────┘           │  (testable)          │    │ -        │       │  trans-  │
                         └──────────────────────┘    │ MENT.md  │       │  fer"    │
                                  │                  └──────────┘       │  section │
                                  │                                     └──────────┘
                                  ▼
                         ┌──────────────────────┐
                         │ SLIDE-42:            │
                         │ docs/SLIDE-UAT.md    │
                         │ (4 tests, mirrors    │
                         │  10-HUMAN-UAT.md)    │
                         └──────────────────────┘

Trace 1 — User drops file during active selection drag (SLIDE-12):
  pointerdown on canvas → selection.js onPointerDown reads
    canvasRef.parentElement?.getAttribute('data-drop-target')
    → 'true' (set by file-source.js setDropTarget) → early return
    → no anchor/focusEnd set → no inverse-text artefact

Trace 2 — User drops 6 files all named REPORT.TXT (SLIDE-36):
  files arrive at processFiles → existing validate loop builds
    surviving with 6 entries all named 'REPORT.TXT' (post-truncation)
    → NEW second-pass: collisionGroups groups by uppercase key
    → 'REPORT.TXT' → group of 6 → computeRenameScheme returns
      ['REPORT.TXT', 'REPORT~1.TXT', 'REPORT~2.TXT', ..., 'REPORT~5.TXT']
    → showConfirmModal renders 'collision' row + 3-action menu
    → user clicks [Send 6 renamed] → returnValue 'send'
    → processFiles applies rename to surviving array
    → enterSendMode({ files: renamedSurviving })

Trace 3 — User sets auto-send to 'B:RM *.* ;\r' (SLIDE-38):
  Settings input change → savePrefs({slideAutoSendCommand: ...})
    → optional input-time visual: chip flash 'rejected — invalid char ;'
  Later, user clicks ↑ Send file → enterSendMode →
    readAutoSendCommandBytes() reads prefs.slideAutoSendCommand
    → SAFE_AUTO_SEND_RE.test('B:RM *.* ;\r') === false
    → block auto-type; emit chip 'Auto-send command unsafe — using disabled'
    OR display first-use confirm chip if value changed since last confirmation
```

### Recommended Project Structure (additive only)

```
docs/                                       # NEW (created by SLIDE-40 plan)
├── SLIDE_Z80_REQUIREMENT.md                # NEW (SLIDE-40)
└── SLIDE-UAT.md                             # NEW (SLIDE-42)

README.md                                   # extended in place (SLIDE-41)

www/
├── input/
│   ├── file-source.js                       # extended: computeRenameScheme + collision pass + modal modes
│   └── selection.js                         # 3-line insertion: drop-overlay early-return
├── transport/
│   └── slide.js                             # extended: SAFE_AUTO_SEND_RE check at readAutoSendCommandBytes
├── renderer/
│   └── slide-chip.js                        # extended: optional new state for first-use confirm
├── state/
│   └── prefs.js                             # extended: slideAutoSendCommandConfirmed flag in DEFAULTS
└── tests/transport/
    ├── slide-collisions.spec.js             # NEW (SLIDE-36)
    └── slide-autosend-safety.spec.js        # NEW (SLIDE-38)
www/tests/render/
    └── selection-drop.spec.js               # NEW (SLIDE-12 regression)
```

### Pattern 1: `[data-*]` attribute as cross-module signal

**What:** Existing pattern (Phase 3 `[data-focused]`, Phase 6 `[data-scrolled-back]`, Phase 9 `[data-drop-target]`). One module sets/clears the attribute on a DOM element; consuming modules read it without an event subscription.

**When to use:** Cross-module boolean state where the consumer only needs current value, not change events.

**Example:**

```js
// Source: www/input/selection.js — Phase 12 SLIDE-12 insertion
function onPointerDown(ev) {
    if (ev.button !== 0) return;
    // SLIDE-12: drop overlay active → defer to file-source.js drag handlers.
    // canvasRef.parentElement is #terminal-wrapper (the drop attribute owner).
    if (canvasRef.parentElement?.getAttribute('data-drop-target') === 'true') {
        return;
    }
    ev.preventDefault();
    // ... rest unchanged
}
```

[VERIFIED: file-source.js:233-240 is the attribute setter; selection.js:113-115 is the modification site]

### Pattern 2: Pure-function exports for testability

**What:** Helpers exported alongside the module's wireXxx initializer so tests can import them without side effects.

**When to use:** Any computation that can be expressed as `input → output` without DOM/I/O state.

**Example:**

```js
// Source: www/input/file-source.js — Phase 12 SLIDE-36 new export
export function computeRenameScheme(group) {
    // group: { name, bytes }[] — all members share the same post-truncation key
    // Returns: string[] parallel to group, where result[0] === group[0].name (kept)
    //          and result[i] for i ≥ 1 follows the unlimited base-truncation rule.
    if (group.length === 0) return [];
    const first = group[0].name;
    const result = [first];
    const lastDot = first.lastIndexOf('.');
    const baseFull = lastDot < 0 ? first : first.slice(0, lastDot);
    const ext      = lastDot < 0 ? ''    : first.slice(lastDot);  // includes the dot
    for (let i = 1; i < group.length; i++) {
        const suffix = '~' + i;
        const baseLimit = Math.max(0, 8 - String(i).length);
        const trimmedBase = baseFull.slice(0, baseLimit);
        result.push(trimmedBase + suffix + ext);
    }
    return result;
}
```

[CITED: D-04 "Determinism rule: ... `name_i = truncate_base(BASE, 8 - len(str(i))) + '~' + str(i) + '.' + EXT`"]

**Verifiable test cases (D-04 + Specifics):**

| Group input | Expected result |
|-------------|-----------------|
| `[{name: 'REPORT.TXT'}]` (size 1) | `['REPORT.TXT']` (no rename — group of 1 by definition isn't a collision; planner may early-return before this helper) |
| `[REPORT.TXT × 13]` (12 collisions, K=12) | `['REPORT.TXT', 'REPORT~1.TXT', ..., 'REPORT~9.TXT', 'REPOR~10.TXT', 'REPOR~11.TXT', 'REPOR~12.TXT']` (base shrinks 6→5 once N hits two digits) |
| `[LONGNAME.TXT × 101]` (100 collisions) | `['LONGNAME.TXT', 'LONGNAM~1.TXT', ..., 'LONGNAM~9.TXT', 'LONGNA~10.TXT', ..., 'LONGNA~99.TXT', 'LONGN~100.TXT']` (base shrinks 8→7→6 as N grows) |
| `[NOEXT × 3]` (no extension) | `['NOEXT', 'NOEX~1', 'NOEX~2']` (ext='' so result has no dot) |
| `[REPOR.TXT × 3]` (base already 5) | `['REPOR.TXT', 'REPO~1.TXT', 'REP~2.TXT']` — wait: D-04 truncates from full-length 8-char base, but `REPOR` is already shorter than 8. **Refinement:** the formula is `truncate_base(BASE, 8 - len(str(i)))` where BASE is the post-truncation base. If BASE is already shorter than `8 - len(str(i))`, no shrinking happens. So `REPOR.TXT × 3` → `['REPOR.TXT', 'REPOR~1.TXT', 'REPOR~2.TXT']` (no shrink because 5 ≤ 7). [ASSUMED: clarification not explicit in D-04; planner should confirm with user before locking the implementation] |
| `[A.TXT × 3]` (base 1 char) | `['A.TXT', 'A~1.TXT', 'A~2.TXT']` (no shrink possible) |

### Pattern 3: Module-scope state with `wireXxx({...})` initializer

**What:** Existing pattern across `paste-pump.js`, `scroll-state.js`, `slide.js`, `slide-recv.js`, `file-source.js`, `slide-chip.js`. Module-scope refs set by a single `wireXxx` call from `main.js` boot.

**When to use:** Any module owning state for the lifetime of the page.

**SLIDE-38 application:** if a separate `auto-send-safety.js` module is extracted, it would follow this pattern. Default recommendation: keep the validation inline in `slide.js`'s existing `readAutoSendCommandBytes` (a single regex test) and keep first-use confirmation state inline in `slide-chip.js` or `prefs.js`.

### Pattern 4: Modal `returnValue`-driven flow

**What:** Existing pattern from Phase 9 `showConfirmModal` (file-source.js:317-333). `<dialog>.close(value)` resolves the calling Promise with `returnValue`; calling code switches.

**SLIDE-36 application:** The modal Promise resolution shape changes from boolean `userConfirmed` to a tagged result. Recommended planner refactor:

```js
// Phase 9 (existing):
return new Promise((resolve) => {
    const onClose = () => {
        modalElRef.removeEventListener('close', onClose);
        const sent = modalElRef.returnValue === 'send';   // boolean
        // ...
        resolve(sent);
    };
    // ...
});

// Phase 12 SLIDE-36:
return new Promise((resolve) => {
    const onClose = () => {
        modalElRef.removeEventListener('close', onClose);
        const action = modalElRef.returnValue;            // 'send' | 'refuse' | 'first-only' | '' (cancel)
        // ...
        resolve(action || null);
    };
    // ...
});
```

Then `processFiles` does:

```js
const action = await showConfirmModal(rows, surviving, collisionRows);
switch (action) {
    case 'send':
        // apply rename scheme to colliding groups
        const renamed = applyCollisionRenames(surviving, collisionRows);
        if (enterSendModeFn) enterSendModeFn({ files: renamed });
        break;
    case 'first-only':
        // for each colliding group, keep group[0], drop rest
        const firstOnly = applyFirstOnlyFilter(surviving, collisionRows);
        if (enterSendModeFn) enterSendModeFn({ files: firstOnly });
        break;
    case 'refuse':
    default:
        return;  // don't call enterSendMode
}
```

### Anti-Patterns to Avoid

- **Adding a second `<dialog>` for collisions.** D-02 explicitly forbids this — single modal grows a row kind. Two-dialog flows fight for focus and z-index, especially with `::backdrop` styling.
- **Re-deriving truncated base from original filename in `computeRenameScheme`.** D-04 determinism rule operates on the post-truncation base only. Re-truncating from `surviving[0].original` would yield drift between modal preview and actual rename.
- **Putting the first-use confirmation chip on top of an already-active session chip.** Phase 11's chip is single-state at a time. If a session is already in flight when the user changes auto-send, the confirmation must defer to the next session (or open a one-shot `<dialog>`). Default discretion: chip is fine because the auto-send command only fires at session START, not mid-session.
- **Blocking save when the auto-send regex fails.** SLIDE-38 spec: validate at use, not at save. Save-time blocking would make Settings feel laggy; the user might reasonably type incomplete commands transiently. Use-time hard-gate is the only contract.
- **Bulk-renaming `bestialitty` → `beastty` in Phase 12.** Per MEMORY.md project_renamed_to_beastty, the project has been renamed but old references remain in PROJECT.md / CLAUDE.md / source comments. Phase 12 is NOT the rename phase — only NEW files (SLIDE-40 doc, SLIDE-42 UAT) use the new name verbatim; existing files keep their current spelling.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal dialog with focus trap + ::backdrop + close-on-Esc | Custom div + JS focus management | Existing `<dialog>` from Phase 9 (extended) | `<dialog>.showModal()` provides ARIA + focus trap + Esc-to-close + top-layer stacking for free. Already in production. |
| Drag depth tracking | Custom mouse-pos counters | Existing `dragDepth` counter at file-source.js:21 | Pitfall 8 (nested children fire repeated dragenter/dragleave) is already mitigated; don't reintroduce. |
| `[data-*]` CSS attribute toggle | `classList` add/remove | Existing `data-drop-target` attribute (file-source.js:233-240) | Phase 9 already pinned this approach; selection.js reading the same attribute is the symmetric consumer. |
| Auto-send command character validation | Substring tests, character iteration | Single regex `/^[A-Za-z0-9:]*\r$/` | One-line, deterministic, easy to test. |
| 8.3 truncation algorithm | New helper | Existing `truncateCpm83` at file-source.js:395 | Already production-tested in Phase 9 + Phase 10. Phase 12 D-01 says collision key uses the OUTPUT of this helper, not a re-implementation. |
| Filename collision detection | New algorithm | Standard Map keyed on `truncateCpm83(name).toUpperCase()` per D-01 | Single linear pass over the surviving array; nothing fancier needed. |
| Real-hardware UAT format | Custom doc structure | 10-HUMAN-UAT.md template (CONTEXT canonical_refs) | Already proven; downstream tooling/expectations are anchored to this format. |

**Key insight:** Phase 12 is a polish phase — the bulk of every requirement is **subtractive in surface area** (one regex, one helper export, one early-return, three new doc files). Custom infrastructure beyond what's listed above is a smell.

## Runtime State Inventory

> Phase 12 is not a rename / refactor / migration phase, but it does add a new prefs key (SLIDE-38) and new doc files (SLIDE-40/41/42). Documenting state additions for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New prefs key `slideAutoSendCommandConfirmed: false` (boolean default) added to `prefs.js` DEFAULTS. Phase 6 D-32 defensive merge fills missing field for existing users — no migration step. | None — defensive merge handles transparently. |
| Live service config | None — Phase 12 makes no protocol or UART changes. | None — verified by inspecting slide.asm (no v0.2.1 protocol adoption needed from Phase 12). |
| OS-registered state | None — Phase 12 is browser-side only; no OS-level integration changes. | None. |
| Secrets/env vars | None. | None. |
| Build artifacts | New `docs/` directory at repo root containing `SLIDE_Z80_REQUIREMENT.md` and `SLIDE-UAT.md`. Plan creates the directory. No `wasm-pack` rebuild needed. README change is in-place text edit. | None beyond `mkdir docs` in the SLIDE-40 plan. |

**Nothing found in category:** Verified by:
- `grep -i "ESC ^ S L I D E\|wakeup\|0x1B.*0x5E" /home/ant/src/microbeast/SLIDE/slide.asm` → no matches (no Z80-side wakeup emission yet → SLIDE-40 doc must call out this dependency)
- `ls /home/ant/src/microbeast/bestialitty/docs` → "no docs/ dir yet" → planning must include `mkdir docs` step
- No new wasm exports / OS scheduler tasks / SOPS keys / pm2 process names etc.

## Common Pitfalls

### Pitfall 1: Collision detection key includes the original (not truncated) filename

**What goes wrong:** A naive `key = name.toUpperCase()` would treat `report.txt` and `REPORT.TXT` as colliding (correct) but miss `longname1.txt` and `longname2.txt` collapsing to the same `LONGNAME.TXT` after truncation. The false-negative manifests as Z80-side overwrites at recv time.

**Why it happens:** Truncation is a post-validation step in the existing `processFiles` loop (file-source.js:255). If detection runs BEFORE truncation, the keys are wrong.

**How to avoid:** Implement detection AFTER `truncateCpm83` (per D-05). The `surviving` array already contains post-truncation names by the time the second pass runs.

**Warning signs:** Tests with mixed-case + truncation pairs (`longname1.TXT` + `LONGNAME2.txt` + `LONGNAME.TXT`) fail.

### Pitfall 2: Default focus override leaks into the no-collision path

**What goes wrong:** D-03 changes default focus to `[Send N renamed]` *only when collisions are detected*. A naive override like `if (collisionRows) sendBtnRef.focus()` instead of `cancelBtnRef.focus()` in the modal close-handler would shift the no-collision happy path away from the existing Phase 9 contract.

**Why it happens:** Modal flow is currently a single `cancelBtnRef?.focus()` call at file-source.js:332. Adding the override needs a guard.

**How to avoid:** Compute focus target from the collision presence flag at the call site:

```js
const initialFocusTarget = collisionRows.length > 0 ? sendBtnRef : cancelBtnRef;
initialFocusTarget?.focus();
```

**Warning signs:** Existing Phase 9 file-source.spec.js tests that assert Cancel-default focus regress.

### Pitfall 3: `processFiles` returnValue routing forgets `'first-only'` rename application

**What goes wrong:** If the user clicks `[Send only first]`, the surviving array still contains all members of each collision group, but only group[0] should reach `enterSendMode`. The naive switch:

```js
case 'first-only':
    enterSendModeFn({ files: surviving });   // BUG: still includes duplicates
    break;
```

**Why it happens:** Filtering is implicit if the planner forgets the per-group dedup step.

**How to avoid:** Build `firstOnly = surviving.filter((item, idx) => !inDuplicateGroupAfterFirst(idx, collisionRows))`. Test must pin: 3-collision group → `'first-only'` → enterSendMode receives 1 file (not 3).

**Warning signs:** Round-trip test of 3-file send with `'first-only'` selection sees 3 files arrive on the Z80 side.

### Pitfall 4: SLIDE-12 attribute read returns null (not false) for missing attribute

**What goes wrong:** `getAttribute('data-drop-target')` returns `null` (not `'false'`) when the attribute is absent. A naive `=== 'true'` check is correct (`null !== 'true'` → false → no early-return → drag works). But a `!== 'false'` check would early-return forever after page load. Likewise, `hasAttribute('data-drop-target')` returns `true` even if the attribute has an empty string value.

**Why it happens:** DOM attribute APIs have subtle null vs string vs missing semantics.

**How to avoid:** Use the strict equality check `=== 'true'`. The setter at file-source.js:236 uses `setAttribute('data-drop-target', 'true')` — verbatim string `'true'` — so the equality check is contract-aligned.

**Warning signs:** SLIDE-12 spec accidentally fails on first page load before any drag has occurred.

### Pitfall 5: SLIDE-38 regex permits empty string but requires trailing `\r` for non-empty

**What goes wrong:** A naive `/^[A-Za-z0-9:]+\r$/` (note `+`) rejects the empty string, breaking SLIDE-13's "empty disables auto-type" semantic. A naive `/^[A-Za-z0-9:]+\r?$/` accepts non-CR-terminated commands, which the Z80 won't act on.

**Why it happens:** The two semantics conflict on first reading.

**How to avoid:** Treat empty as a special case — bypass the regex entirely:

```js
function isAutoSendSafe(cmd) {
    if (cmd.length === 0) return true;          // SLIDE-13 disabled sentinel
    return /^[A-Za-z0-9:]*\r$/.test(cmd);       // * not + — body may be empty
                                                  // before the required \r
}
```

The `*` (not `+`) is intentional because `[A-Za-z0-9:]*\r` admits the bare `\r` case, which is harmless (sends a CR to the Z80 — equivalent to pressing Enter at the prompt).

**Warning signs:** Test cases for `''` (must pass) and `'\r'` (must pass) and `'B:SLIDE R'` (no trailing CR — must FAIL) all need explicit assertions.

### Pitfall 6: First-use confirmation chip overwrites in-flight active-session chip

**What goes wrong:** If the user changes auto-send during an active session, the chip is currently showing `↑ MY-DOC.TXT 1/3 47% ... [Cancel]` (active state). Surfacing a first-use confirm chip via `enterAwaitingConfirm` clobbers the active progress display.

**Why it happens:** chip state machine is single-state at a time.

**How to avoid:** Surface the first-use chip ONLY at session START — i.e., in `enterSendMode` (slide.js:enterSendMode entry point), AFTER reading auto-send bytes but BEFORE pushing them to the wire. The user sees: click Send → confirm chip → click Confirm → auto-type fires → wakeup → active chip. Do NOT surface during the Settings input change event.

**Warning signs:** Active-session chip flickers when the user opens Settings mid-transfer.

### Pitfall 7: SLIDE-40 doc references upstream PR # before PR exists

**What goes wrong:** If the doc hardcodes `https://github.com/blowback/slide/pull/XX`, a reader clicking the link gets a 404.

**Why it happens:** Phase 12 is preparing a deliverable; the PR may or may not be open at plan time.

**How to avoid:** Use a "Status: pending upstream merge" banner pattern (mirrors UAT-10-01). Link to the upstream repo root (`github.com/blowback/slide`) and use prose ("see open PRs for the v0.2.1 amendment branch") rather than a hardcoded PR number.

**Warning signs:** Doc reviewer asks "where's the PR?" — answer must be honest: "the PR is the next deliverable AFTER this doc lands."

### Pitfall 8: SLIDE-42 UAT scope creep into Phase 11 chip lifecycle

**What goes wrong:** A real-hardware UAT covering "everything that touches a serial line" easily expands to 10+ tests covering Phase 5/6/9/10/11 surfaces. Phase 12's UAT is SCOPED to SLIDE end-to-end against patched Z80 firmware.

**Why it happens:** Once you have the MicroBeast on the bench, the temptation to verify everything is high.

**How to avoid:** Lock to 4 tests per CONTEXT D-defaults (multi-file send including binary `.COM`, multi-file recv including zero-byte file, cancel mid-send, cancel mid-recv with Z80 echo verified). All other manual-test flows already live in `06-HUMAN-UAT.md` (daily-driver) and `10-HUMAN-UAT.md` (recv-specific).

**Warning signs:** UAT doc grows beyond ~150 lines or test count exceeds 5.

## Code Examples

### SLIDE-12: Pointer/drop isolation insertion

```js
// Source: derived from www/input/selection.js:113-115 (current state)
//         + 12-CONTEXT.md Specifics §"Pointer/drop isolation (SLIDE-12) — minimal diff sketch"
//         + Pattern 1 above

function onPointerDown(ev) {
    if (ev.button !== 0) return;
    // SLIDE-12: drop overlay active → defer to file-source.js drag handlers.
    // The data-drop-target attribute is set by file-source.js:setDropTarget
    // at every drag-enter (Phase 9 D-03). Reading the attribute matches the
    // existing [data-focused] / [data-scrolled-back] cross-module pattern;
    // no new module dependency.
    if (canvasRef.parentElement?.getAttribute('data-drop-target') === 'true') {
        return;
    }
    ev.preventDefault();
    try { canvasRef.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    dragging = true;
    // ... rest unchanged
}
```

### SLIDE-36: processFiles second-pass + helper export

```js
// Source: extends www/input/file-source.js:processFiles + new helper export
//         per 12-CONTEXT.md D-01..D-06

// NEW PURE HELPER (exported alongside validateCpmFilename + truncateCpm83):
export function computeRenameScheme(group) {
    // group: { name, bytes }[] — all members share the same post-truncation
    //         uppercase key (per D-01). Returns string[] parallel to group;
    //         result[0] === group[0].name (kept verbatim — first member wins);
    //         result[i] for i >= 1 follows D-04 unlimited base-truncation rule.
    if (group.length === 0) return [];
    const first = group[0].name;
    const result = [first];
    const lastDot = first.lastIndexOf('.');
    const baseFull = lastDot < 0 ? first : first.slice(0, lastDot);
    const ext      = lastDot < 0 ? ''    : first.slice(lastDot);   // includes dot
    for (let i = 1; i < group.length; i++) {
        const suffixDigits = String(i);
        const baseLimit = Math.max(0, 8 - suffixDigits.length);
        const trimmedBase = baseFull.slice(0, baseLimit);
        result.push(trimmedBase + '~' + suffixDigits + ext);
    }
    return result;
}

// PROCESSFILES SECOND PASS (after the existing validate+truncate loop at lines 248-264):
async function processFiles(filesArr) {
    const rows = [];
    const surviving = [];
    // ... existing for-loop unchanged ...

    // SLIDE-36 D-05: collision detection — second pass over post-truncation surviving.
    const collisionGroups = new Map();
    for (const item of surviving) {
        const key = item.name.toUpperCase();   // D-01: post-truncation uppercased
        if (!collisionGroups.has(key)) collisionGroups.set(key, []);
        collisionGroups.get(key).push(item);
    }
    const collisionRows = [];
    for (const [key, group] of collisionGroups) {
        if (group.length > 1) {
            collisionRows.push({
                kind: 'collision',
                base: key,
                members: group,                              // user-presentation order preserved
                renamed: computeRenameScheme(group),         // parallel to members
            });
        }
    }

    // Show modal; await user choice (returnValue: 'send' | 'refuse' | 'first-only' | falsy).
    const action = await showConfirmModal(rows, surviving, collisionRows);
    if (!action || action === 'refuse') return;

    let finalFiles;
    if (action === 'send') {
        finalFiles = applyCollisionRenames(surviving, collisionRows);
    } else if (action === 'first-only') {
        finalFiles = applyFirstOnlyFilter(surviving, collisionRows);
    }
    if (enterSendModeFn && finalFiles && finalFiles.length > 0) {
        enterSendModeFn({ files: finalFiles });
    }
}

// Helpers — extract for testability:
function applyCollisionRenames(surviving, collisionRows) {
    if (collisionRows.length === 0) return surviving;
    const renameMap = new Map();   // surviving-index → newName
    for (const cr of collisionRows) {
        for (let i = 0; i < cr.members.length; i++) {
            const memberItem = cr.members[i];
            const idx = surviving.indexOf(memberItem);
            if (idx >= 0) renameMap.set(idx, cr.renamed[i]);
        }
    }
    return surviving.map((item, idx) =>
        renameMap.has(idx) ? { name: renameMap.get(idx), bytes: item.bytes } : item
    );
}

function applyFirstOnlyFilter(surviving, collisionRows) {
    if (collisionRows.length === 0) return surviving;
    const dropSet = new Set();   // surviving-indices to drop
    for (const cr of collisionRows) {
        // Keep cr.members[0]; drop the rest.
        for (let i = 1; i < cr.members.length; i++) {
            const idx = surviving.indexOf(cr.members[i]);
            if (idx >= 0) dropSet.add(idx);
        }
    }
    return surviving.filter((_, idx) => !dropSet.has(idx));
}
```

### SLIDE-36: Modal three-action button row + default-focus override

```js
// Source: extends www/input/file-source.js:showConfirmModal per D-02/D-03/D-06

// In the existing showConfirmModal, when collisionRows.length > 0:
//   - Append collision rows to listElRef (new li.className='collision' rendering)
//   - Modify the footer button row to show three actions

function renderCollisionRowDOM(cr) {
    // Renders:
    //   • REPORT.TXT
    //        ↳ REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT
    const li = document.createElement('li');
    li.className = 'collision';
    const head = document.createElement('div');
    head.appendChild(spanText('•', true));
    head.appendChild(spanText(cr.base, false, 'orig'));
    li.appendChild(head);
    const sub = document.createElement('div');
    sub.className = 'collision-rename';
    sub.appendChild(spanText('↳', true));
    sub.appendChild(spanText(cr.renamed.join(', '), false, 'rewritten'));
    li.appendChild(sub);
    return li;
}

// Default-focus override (D-03): only when collisionRows present.
return new Promise((resolve) => {
    const onClose = () => {
        modalElRef.removeEventListener('close', onClose);
        const action = modalElRef.returnValue;
        // Focus restoration unchanged — wrapper if action emitted, else top-bar.
        if (action === 'send' || action === 'first-only') wrapperElRef?.focus();
        else topBarSendBtnRef?.focus();
        resolve(action || null);
    };
    modalElRef.addEventListener('close', onClose);
    modalElRef.showModal();

    // D-03 default-focus override: collision present → [Send N renamed].
    if (collisionRows.length > 0) {
        sendRenamedBtnRef?.focus();   // new button, defaults to renamed-mode
    } else {
        cancelBtnRef?.focus();        // Phase 9 default — preserved
    }
});
```

### SLIDE-38: Auto-send safety regex + use-time validation

```js
// Source: extends www/transport/slide.js:readAutoSendCommandBytes (line 183-196)
//         per 12-CONTEXT.md Claude's Discretion + Specifics §"Auto-send safety regex"

// Module-scope (near the existing AUTO_SEND_DEFAULT constant):
const SAFE_AUTO_SEND_RE = /^[A-Za-z0-9:]*\r$/;

function isAutoSendSafe(cmd) {
    if (typeof cmd !== 'string') return false;
    if (cmd.length === 0) return true;        // SLIDE-13 disabled sentinel — bypass
    return SAFE_AUTO_SEND_RE.test(cmd);
}

// Modify readAutoSendCommandBytes:
function readAutoSendCommandBytes() {
    let cmd;
    if (prefsRef) {
        cmd = prefsRef.slideAutoSendCommand;
        if (cmd === undefined || cmd === null) cmd = AUTO_SEND_DEFAULT;
    } else {
        cmd = AUTO_SEND_DEFAULT;
    }
    if (!isAutoSendSafe(cmd)) {
        // SLIDE-38: refuse to send unsafe command. Emit chip + console.error;
        // return zero-length so enterSendMode skips pushTxBytes (treats as if
        // SLIDE-13 disabled-empty was set).
        console.error('[slide] Auto-send command failed safety check; auto-type skipped:',
                      JSON.stringify(cmd));
        if (slideChipRef && typeof slideChipRef.enterError === 'function') {
            try { slideChipRef.enterError('auto-send command unsafe — fix in Settings'); } catch {}
        }
        return new Uint8Array(0);
    }
    if (cmd.length === 0) return new Uint8Array(0);
    return new TextEncoder().encode(cmd);
}
```

### SLIDE-38: First-use confirmation gate

```js
// Source: new logic threading through prefs.js + slide.js per
//         CONTEXT Claude's Discretion §"first-use confirmation chip surface"

// In prefs.js DEFAULTS — add the confirmation flag:
//   slideAutoSendCommandConfirmed: false,
// (keyed implicitly by the exact string in slideAutoSendCommand;
//  changing slideAutoSendCommand re-arms confirmation by ALSO resetting
//  this flag in the Settings input change handler — see below.)

// In the Settings input change handler (Phase 11 D-06):
//   on input change → savePrefs({
//     slideAutoSendCommand: value + '\r',
//     slideAutoSendCommandConfirmed: false,    // RE-ARM confirmation
//   });

// In slide.js enterSendMode, BEFORE auto-type push:
function shouldSurfaceFirstUseConfirm(cmd) {
    if (cmd === AUTO_SEND_DEFAULT) return false;             // default value — no confirm
    if (prefsRef?.slideAutoSendCommandConfirmed === true) return false;
    return true;
}

// Then in enterSendMode:
async function enterSendMode({ files }) {
    const bytes = readAutoSendCommandBytes();
    const cmd = prefsRef?.slideAutoSendCommand ?? AUTO_SEND_DEFAULT;
    if (shouldSurfaceFirstUseConfirm(cmd)) {
        const confirmed = await surfaceFirstUseConfirm(cmd);
        if (!confirmed) return;   // user cancelled — abort send
        savePrefs({ slideAutoSendCommandConfirmed: true });
    }
    // ... existing pushTxBytes + pendingSendSession assignment
}

// surfaceFirstUseConfirm: chip-based UX (Claude's Discretion default).
// Reuses the existing chip onStateChange observer pattern from Phase 11 D-15
// (Retry/Cancel/Force-start). Returns Promise<boolean>.
function surfaceFirstUseConfirm(cmd) {
    return new Promise((resolve) => {
        // Chip text: 'Confirm auto-send: "<cmd-pretty>"  [Confirm] [Reset to default]'
        // (the chip module exposes a new state OR re-uses enterError-style with custom buttons)
        if (!slideChipRef) { resolve(true); return; }   // no chip — fail-open in tests
        const dispose = slideChipRef.onStateChange((evt) => {
            if (evt?.kind !== 'inline-action') return;
            if (evt.action === 'confirm-autosend') { dispose?.(); resolve(true); }
            if (evt.action === 'reset-autosend')   { dispose?.(); resolve(false); }
        });
        slideChipRef.enterAwaitingAutoSendConfirm({ cmd });   // new chip state
    });
}
```

### SLIDE-12: Regression spec skeleton

```js
// Source: NEW www/tests/render/selection-drop.spec.js
// Pattern: Phase 9 file-source.spec.js + Phase 6 selection.spec.js

import { test, expect } from '@playwright/test';

test('SLIDE-12 — onPointerDown early-returns when drop overlay active', async ({ page }) => {
    await page.goto('/');
    // Setup: connect mock serial so we can drive a drag.
    // (Pattern from Phase 5 mock-serial.js precedent.)
    await page.evaluate(() => window.__connectMockSerial?.());
    await page.waitForFunction(() => window.__txSink?.isWriterReady?.());

    // Activate the drop overlay programmatically (mirrors what dragenter does):
    await page.evaluate(() => {
        document.getElementById('terminal-wrapper').setAttribute('data-drop-target', 'true');
    });

    const canvas = page.locator('#terminal-canvas');
    const box = await canvas.boundingBox();

    // Attempt pointer-down WHILE overlay is active.
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.up();

    // Assert: no selection state was produced.
    const sel = await page.evaluate(() => window.__selection?.getSelection?.());
    expect(sel).toBeNull();

    // Visual: no inverse-text artefact remains (no cell with inverted bg/fg).
    // This is the SLIDE-12 success criterion verbatim; a screenshot diff here
    // would be acceptable but the API check is sufficient.
    const inDrag = await page.evaluate(() => window.__selection?.isDragging?.());
    expect(inDrag).toBe(false);
});

test('SLIDE-12 — onPointerDown works normally when overlay NOT active', async ({ page }) => {
    // Regression: verify the early-return doesn't break the normal pointer-select path.
    await page.goto('/');
    await page.evaluate(() => window.__connectMockSerial?.());
    // Overlay is absent by default.
    const canvas = page.locator('#terminal-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.up();
    const sel = await page.evaluate(() => window.__selection?.getSelection?.());
    expect(sel).not.toBeNull();
});
```

### SLIDE-36: Collision spec skeleton

```js
// Source: NEW www/tests/transport/slide-collisions.spec.js
// Pattern: existing slide-bridge.spec.js + Phase 9 file-source.spec.js

import { test, expect } from '@playwright/test';

test('SLIDE-36 — computeRenameScheme handles 12-collision case', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
        const fs = window.__fileSource;
        const group = Array.from({length: 13}, () => ({ name: 'REPORT.TXT', bytes: new Uint8Array(0) }));
        return fs.computeRenameScheme(group);
    });
    expect(result.length).toBe(13);
    expect(result[0]).toBe('REPORT.TXT');
    expect(result[1]).toBe('REPORT~1.TXT');
    expect(result[9]).toBe('REPORT~9.TXT');
    expect(result[10]).toBe('REPOR~10.TXT');     // base shrinks 6 → 5 once N hits 2 digits
    expect(result[11]).toBe('REPOR~11.TXT');
    expect(result[12]).toBe('REPOR~12.TXT');
});

test('SLIDE-36 — computeRenameScheme handles 100-collision case', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
        const fs = window.__fileSource;
        const group = Array.from({length: 101}, () => ({ name: 'LONGNAME.TXT', bytes: new Uint8Array(0) }));
        return fs.computeRenameScheme(group);
    });
    expect(result[0]).toBe('LONGNAME.TXT');
    expect(result[1]).toBe('LONGNAM~1.TXT');     // base 8 → 7
    expect(result[9]).toBe('LONGNAM~9.TXT');
    expect(result[10]).toBe('LONGNA~10.TXT');    // base 7 → 6
    expect(result[99]).toBe('LONGNA~99.TXT');
    expect(result[100]).toBe('LONGN~100.TXT');   // base 6 → 5
});

test('SLIDE-36 — computeRenameScheme handles no-extension case', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
        return window.__fileSource.computeRenameScheme([
            { name: 'NOEXT', bytes: new Uint8Array(0) },
            { name: 'NOEXT', bytes: new Uint8Array(0) },
            { name: 'NOEXT', bytes: new Uint8Array(0) },
        ]);
    });
    expect(result).toEqual(['NOEXT', 'NOEX~1', 'NOEX~2']);
});

test('SLIDE-36 — modal renders 3 buttons + default focus when collisions present', async ({ page }) => {
    // Drive a 3-file picker with all-same-name files via __fileSource testing hook.
    // Assert: modal opens, [Send 3 renamed] is focused, [Refuse batch] + [Send only first] visible.
    // (Detailed setup follows Phase 9 file-source.spec.js precedent.)
    // ...
});

test('SLIDE-36 — Send N renamed applies rename to all groups', async ({ page }) => {
    // Mock-serial-bot in receive role; drive 3-file picker, click [Send 3 renamed].
    // Assert: bot sees 3 distinct filenames REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT.
    // ...
});

test('SLIDE-36 — Send only first drops collision-group members 1..N', async ({ page }) => {
    // Drive 3-file picker, click [Send only first].
    // Assert: bot sees exactly 1 file with name REPORT.TXT.
    // ...
});

test('SLIDE-36 — Refuse batch prevents enterSendMode call', async ({ page }) => {
    // Drive picker, click [Refuse batch]. Assert pendingSendSession === null.
    // ...
});
```

### SLIDE-38: Safety spec skeleton

```js
// Source: NEW www/tests/transport/slide-autosend-safety.spec.js

import { test, expect } from '@playwright/test';

const SAFE_CASES = [
    { input: 'B:SLIDE R\r',  expected: true },
    { input: 'A:SLIDE R\r',  expected: true },
    { input: 'B:SLIDE\r',    expected: true },
    { input: '',             expected: true },   // SLIDE-13 disabled
    { input: '\r',           expected: true },   // edge case: bare CR
];
const UNSAFE_CASES = [
    { input: 'B:SLIDE R',           expected: false },
    { input: 'B:SLIDE R\n',         expected: false },
    { input: 'B:SLIDE R; rm -rf /\r', expected: false },
    { input: 'B:SLIDE R\rB:DIR\r',    expected: false },
    { input: 'B:SLIDE R\r',     expected: false },   // BEL injected
];

test.describe('SLIDE-38 isAutoSendSafe regex', () => {
    for (const tc of SAFE_CASES) {
        test(`accepts: ${JSON.stringify(tc.input)}`, async ({ page }) => {
            await page.goto('/');
            const ok = await page.evaluate((s) => window.__slide.__isAutoSendSafeForTests(s), tc.input);
            expect(ok).toBe(true);
        });
    }
    for (const tc of UNSAFE_CASES) {
        test(`rejects: ${JSON.stringify(tc.input)}`, async ({ page }) => {
            await page.goto('/');
            const ok = await page.evaluate((s) => window.__slide.__isAutoSendSafeForTests(s), tc.input);
            expect(ok).toBe(false);
        });
    }
});

test('SLIDE-38 unsafe command blocks auto-type at use site', async ({ page }) => {
    // Set prefs.slideAutoSendCommand to 'B:SLIDE R; rm\r' via window.__prefs.live.
    // Drive enterSendMode; assert no auto-type bytes hit the wire AND chip enterError fired.
    // ...
});

test('SLIDE-38 first-use confirmation surfaces for non-default value', async ({ page }) => {
    // Set prefs.slideAutoSendCommand to 'A:SLIDE R\r' (valid but non-default).
    // Drive enterSendMode; assert chip enters awaiting-autosend-confirm state.
    // Click [Confirm]; assert prefs.slideAutoSendCommandConfirmed === true.
    // Drive enterSendMode again; assert chip does NOT re-prompt.
    // ...
});

test('SLIDE-38 changing auto-send re-arms confirmation flag', async ({ page }) => {
    // After confirming, change prefs to a different value; assert confirmed === false.
    // ...
});
```

## State of the Art

| Old Approach (Phase 9/10/11) | Current Approach (Phase 12) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 9: silent overwrite on Z80 if multiple files truncate to same 8.3 name | Pre-flight collision detection + auto-rename via D-04 unlimited scheme | Phase 12 SLIDE-36 | Eliminates last UX cliff in send flow; users see exactly what will land on Z80. |
| Phase 9: drag-drop overlay sets `data-drop-target` but selection.js's pointer-down still fires, producing ghost selection mid-drop | selection.js early-returns when overlay active | Phase 12 SLIDE-12 | Drop and drag-select can coexist on same canvas without inverse-text artefacts. |
| Phase 11: `slideAutoSendCommand` stored as-typed; injection vector documented but not mitigated | Strict regex at use site + first-use confirmation chip for non-default values | Phase 12 SLIDE-38 | Closes Pitfall 17 (auto-send injection vector); compatible with hostile-config defense-in-depth. |
| Phase 7-11: ADR-003 + PITFALLS §15 reference upstream PR; no user-facing doc | `docs/SLIDE_Z80_REQUIREMENT.md` formalizes the requirement | Phase 12 SLIDE-40 | Z80 firmware authors have a single canonical source for Beastty's expectations. |
| Phase 6: README ships at v1.0 polish level; v1.1 SLIDE features undocumented in README | README "File transfer" section + extended keyboard shortcuts table | Phase 12 SLIDE-41 | New users discover SLIDE in the README without diving into PROJECT.md. |
| Phase 10: 10-HUMAN-UAT.md covers recv flows; no integrated send+recv UAT | `docs/SLIDE-UAT.md` end-to-end against patched MicroBeast | Phase 12 SLIDE-42 | Closes the v1.1 milestone with a real-hardware acceptance gate. |

**Deprecated/outdated:**
- None — Phase 12 is purely additive. No existing patterns are removed or renamed.

## Section: SLIDE-12 — Pointer/Drop Isolation

**Status:** Single-file change in `www/input/selection.js`; new spec file in `www/tests/render/selection-drop.spec.js`.

### Predicate mechanism — recommended: read attribute directly

The CONTEXT D-discretion lists three options:

| Option | Pros | Cons | Recommended? |
|--------|------|------|--------------|
| Read `[data-drop-target="true"]` from `canvasRef.parentElement` | Zero new plumbing; matches existing `[data-focused]` / `[data-scrolled-back]` patterns; immediate value (no event subscription) | Couples selection.js to a DOM contract owned by file-source.js | **Recommended** — the coupling is via existing public DOM, not a JS API; symmetric with how chrome.js reads `[data-focused]` |
| Inject `isDropOverlayActive()` predicate via `wireSelection` opts | Cleaner module boundary; testable without DOM mock | One more plumbing step in main.js boot wiring; an extra `getXxx()` callback shape proliferating | Acceptable but extra surface for negligible test benefit |
| Central state module for "active overlays" | Future-proof for additional overlays | Over-engineered for one bit of state; YAGNI | Reject |

[CITED: D-discretion §"Pointer/drop isolation (SLIDE-12) — predicate mechanism" defaults to attribute read]

### In-flight drag handling

If a drag is **already in flight** when overlay activates mid-drag (hypothetical: user starts drag-select then drags a file from file manager into the page), recommended behavior per CONTEXT default: **cancel the drag** (`clearSelection()`).

**Rationale:** the overlay activated because file-source.js's `dragenter` fired, and `dragenter` only fires for file drags. The file drag should "win" — abandoning the in-progress text selection is the safer default than letting both proceed.

**Implementation:** add a tiny watcher in selection.js that observes the `data-drop-target` attribute and, if dragging is true when it transitions to `'true'`, calls `clearSelection()`. Alternative: a one-shot check inside `onPointerMove` — every move call, if attribute is `'true'` and `dragging`, call `clearSelection()` and set `dragging = false`. Cheaper than MutationObserver. [ASSUMED: this micro-detail isn't actually required by the SLIDE-12 acceptance criterion; SLIDE-12 only specifies "no ghost selection / inverse-text artefact remains after a drop completes". A dropped-mid-drag edge case may be deferred if planning surfaces it as out-of-scope.]

### Regression spec scope

Per SLIDE-12 acceptance: **prove no ghost selection / inverse-text artefact remains after a drop**. Minimum spec:

1. **Test 1 (negative):** Activate `[data-drop-target="true"]` programmatically; attempt pointer-down + drag + up; assert `getSelection()` returns null AND `isDragging()` returns false.
2. **Test 2 (positive regression):** With overlay NOT active, confirm pointer-select still works (i.e., the early-return doesn't break the normal path).
3. **Test 3 (post-drop cleanup):** Simulate full drag-and-drop sequence (dragenter → dragover → drop), then attempt pointer-select on the canvas; assert it works (overlay attribute properly cleared by file-source.js setDropTarget(false)).

Three tests. Locating the spec in `www/tests/render/` (where `selection.spec.js` already lives) keeps the convention; `www/tests/transport/` is for SLIDE protocol surfaces. [VERIFIED: Playwright config matches `**/render/*.spec.js` per `www/playwright.config.js:6`]

## Section: SLIDE-36 — Send-Side Collision Algorithm

(Detailed pseudocode and edge cases above in Code Examples §SLIDE-36.)

### Edge-case decision matrix

| Scenario | Behavior | Test required |
|----------|----------|---------------|
| Single file, no collision | Modal renders normally; no collision row; Cancel-default focus; existing 2-button row | Yes — regression for Phase 9 contract |
| 2 files, collision | Modal shows 1 collision row + 3-action button row; `[Send 2 renamed]` default focus | Yes |
| 12 files all colliding | Single collision row showing `REPORT.TXT, REPORT~1.TXT, ..., REPORT~9.TXT, REPOR~10.TXT, REPOR~11.TXT, REPOR~12.TXT` | Yes — pin D-04 base-shrink rule |
| 100 files all colliding | Single collision row showing the full rename list with base shrinking 8→7→6→5 | Yes — pin D-04 unlimited rule |
| 3 files no extension, all 'NOEXT' | Renames: `NOEXT, NOEX~1, NOEX~2` (no dot in result) | Yes |
| Mix: 2 colliding + 1 non-colliding + 1 rejected | Rejected row appears as Phase 9 unchanged; collision row appears once; surviving non-colliding file untouched; Send button shows 3 (or 4 if 'first-only') | Yes — integration |
| User clicks `[Cancel]` (modal X) | `processFiles` returns early; no enterSendMode call | Yes (Phase 9 regression) |
| User clicks `[Refuse batch]` | `processFiles` returns early; no enterSendMode | Yes |
| User clicks `[Send only first]` | enterSendMode receives ONLY group[0] of each colliding group; non-colliding files included | Yes |
| User clicks `[Send N renamed]` | enterSendMode receives full rename scheme applied | Yes |
| User starts collision-rename batch via drop instead of picker | Same modal; same 3 buttons; behavior identical (drop is a different entry to processFiles, all funneled through the same modal) | No (orthogonal — Phase 9 entry parity) |

### Determinism rule + "first member kept" interaction

D-04 says: *"the kept name is the user-presentation-order first member of the group"*. Tests must verify this — if the user adds files in order [A, B, C] all collapsing to the same key, A keeps its name, B becomes ~1, C becomes ~2. The order is established by the JavaScript File array order (which is insertion order per `<input multiple>` and per `dataTransfer.files` browser contract). [ASSUMED: planner should pin this in a test rather than rely on the browser preserving order — `dataTransfer.files` order is technically OS-dependent on multi-select drag, though Chromium consistently preserves user-click-order in our local testing]

## Section: SLIDE-38 — Auto-Send Safety

### Validation site analysis

Three candidate sites; recommend **both** (defense-in-depth):

| Site | Behavior | Strength | Weakness |
|------|----------|----------|----------|
| `prefs.js` save time | Sanitize on input; chip-flash rejection on Settings field; commit either way | Visual feedback at edit time | Doesn't gate the wire; user-set malformed value persists on reload |
| `slide.js` use time (in `readAutoSendCommandBytes` line 183-196) | Hard-gate: refuse to push bytes; chip enterError | True wire-safety contract | No visual feedback at Settings edit time |
| Both | Settings flash + use-time block | Defense-in-depth | Slightly more code |

**Recommended (default):** use-time validation in `readAutoSendCommandBytes` IS the wire safety contract; this is non-negotiable. Save-time validation is the optional UX improvement. Phase 12 plan should ship at minimum the use-time gate. The save-time gate is a Claude's Discretion stretch goal.

### First-use confirmation surface

CONTEXT default: chip-based via `slideChip.flashDropRejected()`-style API.

**Why chip over `<dialog>`:**

1. **Single-modal-at-a-time UX:** Phase 9's `<dialog>` already exists for send-confirm. A second `<dialog>` competing for focus and `::backdrop` would feel jarring. The chip already supports inline buttons (verified at slide-chip.js:251-274 — `cancelButtonHtml` / `retryButtonHtml` / `forceStartButtonHtml` follow the same pattern).
2. **Action vocabulary maps cleanly:** existing chip states have `[Retry] [Cancel] [Force start]`; SLIDE-38 needs `[Confirm] [Reset to default]`. Adding two more inline-button HTML helpers + observer event types follows the pattern verbatim.
3. **Pattern symmetry with SLIDE-35:** SLIDE-35 already prompts the user for a non-trivial decision via the chip with action buttons. A second user prompt via chip in the same workflow feels native.

**Required new chip API surface:**

```js
// www/renderer/slide-chip.js — new exports
export function enterAwaitingAutoSendConfirm({ cmd }) {
    clearAutoHide();
    clearWakeupTimer();
    lifecycle = 'awaiting-autosend-confirm';   // new lifecycle state
    autoSendConfirmCmd = cmd;
    refreshChip();
    // No auto-hide — user must click [Confirm] or [Reset to default].
}

// In refreshChip switch — add:
case 'awaiting-autosend-confirm':
    chipTextElRef.innerHTML =
        `Confirm auto-send: <code>${escapeHtml(autoSendConfirmCmd)}</code>  ` +
        confirmButtonHtml() + '  ' + resetButtonHtml();
    chipElRef.setAttribute('aria-label', 'Confirm auto-send command');
    wireInlineButtons();
    chipElRef.removeAttribute('hidden');
    return;

// Add new button helpers + handleInlineAction arms for 'confirm-autosend' / 'reset-autosend'.
```

[CITED: slide-chip.js:251-274 establishes the `<button class="slide-inline" data-action="...">` pattern + observer fan-out. Following this verbatim costs ~40 LOC; the test surface is identical.]

### "Default" detection scope

Recommended: **exact match against DEFAULTS literal**. CONTEXT default. The simpler rule is the safer rule.

The "broader heuristic" alternative ("any value with `:` not followed by `SLIDE`") would surface confirmation for `B:SLIDE R\r` if `slideAutoSendCommand` was edited to e.g. `B:dir\r` (legitimate user edit). That's surface noise for low-value protection. Stay with exact-match.

The flag is keyed implicitly: `slideAutoSendCommandConfirmed` is set to `true` when the user confirms; the Settings input change handler resets it to `false` whenever the underlying string changes (D-discretion §"first-use confirmation flag granularity" — "the flag is keyed to the exact string so changing the value re-arms confirmation"). [CITED: 12-CONTEXT.md Specifics §"First-use confirmation copy"]

## Section: SLIDE-40 — Z80 Requirement Doc

### Outline (recommended default — both audiences, brief)

```markdown
# SLIDE — Z80-side requirements

> Status: ZZZ
> If Z80 firmware bullet items below are unticked, Beastty will fall back
> to client-side cancel timeouts and `Force start` Compatibility-mode
> escapes, but daily-driver UX is degraded.

## Audience

- Z80 firmware authors maintaining or porting `slide.com` / `slide.asm`.
- Beastty users curious why their stock `slide.com` doesn't trigger SLIDE
  mode automatically.

## What Beastty expects from the Z80

### 1. Wakeup signature: `ESC ^ S L I D E` (7 bytes)

When entering recv mode, slide.com MUST emit the 7-byte sequence
`0x1B 0x5E 'S' 'L' 'I' 'D' 'E'` to the wire **before** sending the
first SLIDE protocol byte. Beastty uses this signature to switch from
terminal mode to SLIDE mode.

- Status in upstream `github.com/blowback/slide`: pending
  (`slide.asm` v0.4 does not currently emit the signature; see PR linked
  below).
- Compatibility mode: legacy `slide.com` without this signature can be
  driven via Settings → SLIDE → Compatibility mode → `Force start`.

### 2. Bidirectional CTRL_CAN echo (v0.2.1 amendment)

When the Z80 receives `CTRL_CAN = 0x18`, it MUST echo `0x18` back to
the wire and return to its idle state within 500 ms.

- Authoritative document: ADR-003 in this repo
  (`.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md`).
- Wire format: raw single byte; NOT a wrapped frame.
- Beastty client-side fallback: 2 s absolute timeout triggers
  `force_idle()` — the wire returns to a clean state regardless, but
  cancel UX feels laggy.

### 3. `B:SLIDE R` command convention

Beastty defaults to auto-typing `B:SLIDE R\r` before each session,
assuming `SLIDE.COM` is on the B: drive. This default is configurable
in Settings → SLIDE → Auto-send command.

If `slide.com` lives on A:, change the auto-send command to
`A:SLIDE R\r`. If `slide.com` is loaded manually, set the auto-send
command to the empty string to disable auto-typing.

## Upstream PR

The Z80-side patch landing the wakeup signature + CTRL_CAN echo lives
upstream at `github.com/blowback/slide`. See open PRs for the
v0.2.1 amendment branch.

If you build a custom `slide.asm` from scratch, the patches needed are:

1. After parsing `R` in `entry`, emit the 7 ESC^SLIDE bytes via the
   normal terminal output routine before opening the SLIDE state
   machine.
2. In every wait-for-control loop, if `CTRL_CAN` is received, echo
   `CTRL_CAN` back via the standard frame-output path (single byte) and
   transition to a CancelDrain state that consumes inbound bytes
   silently for 100 ms before returning to idle.

(Inline diff format: NO — keeping the doc reference-only per
CONTEXT D-default. Cite the upstream PR for the specific bytes.)

## Cross-references

- ADR-003 — bidirectional CTRL_CAN echo contract.
- SPEC-v0.2.md (upstream `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md`).
- REQUIREMENTS.md SLIDE-04 / SLIDE-27 / SLIDE-30 / SLIDE-40.
```

### PR-pending status handling

Per CONTEXT D-default: **mark with "Status: pending upstream merge" banner if PR is not merged at plan time**. The Phase 10 UAT-10-01 already establishes this idiom (verified in 10-HUMAN-UAT.md result line). Use the same banner format.

If the PR is merged before plan time, swap the banner for a "Status: amendments landed in slide.com vN.M" line and remove the inline "fallback" qualifications. The doc text above intentionally accommodates both states.

### Inline `slide.asm` patch diff: NO

CONTEXT D-default explicitly says "no inlined diff". Rationale: the diff is in upstream's PR; inlining it duplicates a moving target. Cross-reference is the right pattern.

## Section: SLIDE-41 — README Updates

### Section diffs (append-only per CONTEXT default)

**Insert AFTER existing "Esc key behaviour" section (line 79), BEFORE "Browser-reserved chords" (line 82):**

```markdown

### File transfer (drag-drop & file picker)

| Action                            | Effect                                                |
|-----------------------------------|-------------------------------------------------------|
| Drag files onto the terminal area | Open the SLIDE send modal with the dropped file(s)    |
| Click `↑ Send file` in top bar    | Open the OS file picker (multi-select supported)      |
| Esc during active SLIDE transfer  | Cancel transfer (slot 2 of the Esc disambiguation)    |
```

**Insert AFTER "Browser-reserved chords" section (line 87), as a new H2 section before "Can I run it locally?":**

```markdown
## File transfer

Beastty supports SLIDE — a custom file-transfer protocol for the
MicroBeast that ships files back and forth via the same serial wire as
your terminal session. SLIDE was created by feersum technology and
documented at `github.com/blowback/slide`.

### Sending a file to the MicroBeast

1. Make sure `slide.com` is on the B: drive of your MicroBeast (or
   change the auto-send command in Settings → SLIDE).
2. From a CP/M prompt on the MicroBeast, drag a file from your computer
   onto the terminal area, OR click `↑ Send file` in the top bar.
3. A confirmation modal shows you what filenames will land on the Z80
   side after CP/M's 8.3 truncation. Click `Send N files` to start.
4. The floating SLIDE chip (bottom-left of the terminal) shows progress;
   click `[Cancel]` or press Esc to abort mid-transfer.

### Receiving a file from the MicroBeast

1. From a CP/M prompt, run `B:SLIDE S MYFILE.COM` (or list multiple
   filenames after `S`).
2. The MicroBeast emits a wakeup signature; Beastty switches into recv
   mode automatically.
3. Each received file lands as a Chrome download, OR — if you've
   enabled Settings → SLIDE → "Save received files to a folder" — into
   your chosen directory.

### Z80 firmware requirements

See [`docs/SLIDE_Z80_REQUIREMENT.md`](docs/SLIDE_Z80_REQUIREMENT.md)
for the slide.com / slide.asm requirements.

### Real-hardware test plan

End-to-end UAT against a patched MicroBeast: see
[`docs/SLIDE-UAT.md`](docs/SLIDE-UAT.md).
```

### Keyboard shortcuts table extension

The existing "Esc key behaviour" table at README.md line 75-79 lists three contexts. Insert a new row for SLIDE cancel:

```diff
 | Context                                 | Effect of Esc                  |
 |-----------------------------------------|--------------------------------|
 | **Ctrl+Shift+Esc** (any time)           | Clear established selection    |
 | Mid-drag (mouse button still down)      | Cancel the in-flight selection |
+| Active SLIDE transfer                   | Cancel the transfer            |
 | Paste pump still running                | Cancel paste                   |
 | Otherwise                               | Encode `0x1B` to host          |
```

[VERIFIED: README.md:75-79 + 12-CONTEXT.md Specifics §"Esc disambiguation slot for SLIDE-cancel"]

### Screenshots

CONTEXT default: text-only unless a single image clarifies drag-drop UI. **Recommendation: SKIP screenshots in Phase 12** — the existing README has only two screenshots (logo + screener.png + graphics.png). A drag-drop screenshot adds maintenance burden (re-shoot on every visual change) for marginal clarity gain. Text descriptions in the new "File transfer" section are sufficient.

## Section: SLIDE-42 — Real-Hardware UAT

### Format mirror

`docs/SLIDE-UAT.md` mirrors `10-HUMAN-UAT.md` verbatim:

- Front-matter block with `status: partial`, `phase: ...`, `source: [...]`, `started: ...`, `updated: ...`
- Top section explaining out-of-band nature (does NOT block `/gsd-verify-phase`)
- Setup section (hardware required, software state)
- Tests numbered with `expected:` / `steps:` / `result:` per test
- Summary block (total / passed / issues / pending / skipped / blocked)
- Sign-off block

### Four test specifications

Per CONTEXT D-default, the four UAT tests are:

#### UAT-12-01: Multi-file send including binary `.COM`

**expected:** Sending a 3-file batch including a binary `.COM` (e.g. STAT.COM ~6 KB) plus two text files lands all three on the Z80 byte-identical, with correct CP/M 8.3 names (uppercased + truncated). The Beastty chip shows progress smoothly; the chip's `Sent 3 files — XX KB → MicroBeast` summary appears for 5 s on completion.

**steps:**
1. Connect to MicroBeast at 19200 8N1.
2. Drag three files onto the terminal: `stat.com` (binary), `readme.txt` (text), `notes-2026.txt` (text — will truncate to `NOTES-20.TXT`).
3. Confirm modal lists all three rewrites; click `Send 3 files`.
4. CP/M `B:SLIDE R` prompt receives the wakeup; SLIDE chip shows `↑ STAT.COM 1/3 ... [Cancel]`.
5. Wait for completion summary: `Sent 3 files — XX KB → MicroBeast`.
6. On the MicroBeast, run `DIR B:` and verify all three filenames present.
7. Run `STAT.COM` from CP/M and verify it executes correctly (binary integrity).

**result:** TBD (pending Z80 PR for ESC^SLIDE wakeup; see UAT-12-04 blocker rationale)

#### UAT-12-02: Multi-file recv including zero-byte file

**expected:** Sending a 3-file batch from the MicroBeast (`B:SLIDE S BIG.BIN ZERO.TXT TINY.DAT`) where ZERO.TXT is 0 bytes lands all three on the host byte-identical. Each appears as a separate Chrome download (or in the chosen folder if FSAP toggle is on). The chip shows `↓ BIG.BIN 1/3 ... [Cancel]` then transitions through each file; summary `Received 3 files — XX KB`.

**steps:**
1. Pre-stage MicroBeast files: `STAT.COM` ~6 KB, an empty file ZERO.TXT (use ED + immediate save), TINY.DAT 32 bytes.
2. From CP/M: `B:SLIDE S STAT.COM ZERO.TXT TINY.DAT`.
3. Wait for Beastty to detect wakeup; chip shows recv progress.
4. After completion, verify three files in Downloads (or chosen folder); compare bytes to MicroBeast originals (e.g., via diff or hash).
5. Confirm ZERO.TXT exists at exactly 0 bytes (Blob assembly with `chunks=[]` per Phase 10 SLIDE-21).

**result:** TBD (pending Z80 PR)

#### UAT-12-03: Cancel mid-send (PC-initiated)

**expected:** During a 1 MB+ send, pressing Esc OR clicking the chip's `[Cancel]` button results in: (a) Beastty stops sending data frames within 200 ms; (b) CTRL_CAN sent to Z80; (c) Z80 echoes CTRL_CAN within 500 ms (per ADR-003); (d) wire returns to clean CP/M `B>` prompt; (e) Beastty chip shows `Cancelled — N of 1 files transferred` for 5 s; (f) running `B:SLIDE R` again works without Z80 reset.

**steps:**
1. Stage a 1 MB pseudo-random file on the host.
2. Drag onto terminal; click `Send 1 file`.
3. Wait for chip to show `↑ ... 50% ...` (mid-transfer).
4. Press Esc.
5. Observe: chip transitions to cancelled-summary; CP/M prompt returns visibly within 2 s.
6. Run `B:SLIDE R` again from CP/M; verify Z80 is responsive.

**result:** TBD (pending Z80 PR for CTRL_CAN echo behavior)

#### UAT-12-04: Cancel mid-recv with Z80 echo verified

**expected:** Same as UAT-12-03 but for the inbound direction. Running `B:SLIDE S BIG.BIN` then pressing Esc mid-recv results in the Z80 honoring the CTRL_CAN echo (returning cleanly to CP/M prompt rather than hanging), Beastty wire returns to clean state, and a re-run of `B:SLIDE S BIG.BIN` succeeds without Z80 reset.

**steps:**
1. From CP/M: `B:SLIDE S BIG.BIN` where BIG.BIN is ≥ 8 KB on the MicroBeast.
2. Wait for Beastty chip to show `↓ BIG.BIN ... 30% ...`.
3. Press Esc.
4. Observe: chip transitions to cancelled-summary; CP/M prompt `B>` returns within 2 s.
5. Run `B:SLIDE S BIG.BIN` a second time; verify Z80 is not stuck and accepts the new send.

**result:** blocked (Z80 SLIDE.COM does not yet implement the v0.2.1 ADR-003 ESC^SLIDE wakeup + CTRL_CAN echo amendment; PR to github.com/blowback/slide is the upstream dependency. Re-run after the patched slide.asm lands. Mirrors UAT-10-01 blocked status pattern.)

### Blocked-result handling

Per CONTEXT D-default: blocked results are acceptable when the upstream slide.asm patch hasn't landed (mirrors UAT-10-01's current blocked status). The doc literally inherits UAT-10-01's blocked-result line format.

UAT-12-01, UAT-12-02, UAT-12-03 all also depend on the wakeup signature for entering SLIDE mode — they're gated on the Z80 PR too. The doc should explicitly note this in the Setup section: "All four tests require the patched `slide.com` from `github.com/blowback/slide` PR. Pre-PR, only the auto-send command flow can be exercised in `Force start` Compatibility mode (Settings → SLIDE), which is documented in the existing 10-HUMAN-UAT.md daily-driver tests."

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `computeRenameScheme` for short-base groups (`REPOR.TXT × 3`) does NOT shrink (rule "no shrink possible if base already < 8 - len(N)") | Code Examples §Pattern 2 test cases | LOW — short-base files don't show up in real workflows; planner can pin behavior in tests with explicit user confirmation |
| A2 | In-flight drag handling on mid-drag overlay activation: cancel the drag (`clearSelection()`) | Section "SLIDE-12 — In-flight drag handling" | LOW — edge case may be deferred entirely; SLIDE-12 acceptance only requires post-drop artefact freedom |
| A3 | `dataTransfer.files` order on multi-select drop is consistent with user-click order in Chromium | Section "SLIDE-36 — Determinism rule" | LOW — observed in local testing; planner pins via explicit ordered-list test |
| A4 | First-use confirmation chip can co-exist with active session chip (NEVER renders mid-session because it surfaces only at session START) | Pitfall 6 + Section "SLIDE-38 — First-use confirmation surface" | MEDIUM — if user changes Settings mid-session and immediately initiates a NEW session before the first completes, behavior must be defined; default: queue gracefully via existing pendingSendSession depth-1 contract |
| A5 | Upstream `github.com/blowback/slide` PR for v0.2.1 amendment is NOT YET MERGED at Phase 12 plan time | Sections SLIDE-40, SLIDE-42 + Pitfall 7 | LOW — verified by inspecting `/home/ant/src/microbeast/SLIDE/slide.asm` directly; if PR has merged by plan time, planner swaps "Status: pending" banner for "Status: landed" |
| A6 | Bulk-rename of `bestialitty` → `beastty` in source comments / file headers is OUT OF SCOPE for Phase 12 (project rename was a separate event) | Project Constraints | LOW — MEMORY.md confirms; only NEW Phase 12 doc files use new name |

**If this table seems large for a polish phase:** most assumptions are LOW-risk edge cases. The pattern is to surface them so the planner can either (a) pin behavior with explicit tests, or (b) defer to a follow-up note in CONTEXT.md if user input is needed.

## Open Questions

1. **`computeRenameScheme` for short-base files (e.g., 5-char base) at high collision counts**
   - **What we know:** D-04 specifies `truncate_base(BASE, 8 - len(str(i)))` for `i ≥ 1`. For i=10, this is `truncate_base(BASE, 6)`.
   - **What's unclear:** if BASE is already 5 chars (e.g., `REPOR`), does `truncate_base('REPOR', 6)` = `'REPOR'` (no shrink) or does the rule abort with an error?
   - **Recommendation:** treat as no-shrink (slice doesn't expand); test 5-char-base with 12-collision case explicitly. Planner should add to discuss-phase if tests find the edge case behaves unintuitively.

2. **First-use confirmation persistence across `slideAutoSendCommand` reverts to default**
   - **What we know:** CONTEXT default keys the confirmation flag to the exact string. Changing the value re-arms confirmation.
   - **What's unclear:** if the user changes the value to `'A:SLIDE R\r'`, confirms it (flag → true), then changes back to default `'B:SLIDE R\r'`, the default is recognized as default and confirmation is bypassed (per "non-default values" wording). But the flag is keyed to the old string — should it auto-reset to false on revert-to-default? The behavior is observably correct either way.
   - **Recommendation:** simple rule — `slideAutoSendCommandConfirmed` always resets to `false` on every Settings input change (regardless of new value); the use-time check evaluates "is current value === default?" first and skips confirmation if so. This means default-revert silently re-arms (harmless), and any non-default change requires confirmation (correct).

3. **`<dialog>` modal's three-action button row CSS**
   - **What we know:** Phase 9 modal footer uses 2-button right-aligned layout (file-source.spec.js + index.html:1014-1015).
   - **What's unclear:** with three primary actions, does `[Send N renamed]` group together with `[Send only first]` (visually similar — both proceed), or does each get equal weight, with `[Cancel]` and `[Refuse batch]` separated as exits?
   - **Recommendation:** `[Send N renamed]  [Send only first]  [Refuse batch]  [Cancel]` per CONTEXT Specifics — keep `[Cancel]` rightmost as the existing pattern. Discretion-level CSS detail; planner picks.

4. **SLIDE-38 use-time validation interaction with SLIDE-13 empty-string-disabled**
   - **What we know:** SLIDE-13 says empty string disables auto-type. SLIDE-38 regex `/^[A-Za-z0-9:]*\r$/` rejects empty string.
   - **Resolution (Pitfall 5 above):** treat empty as a special case — bypass the regex. `isAutoSendSafe('') === true`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js for tests | Playwright | ✓ | (existing setup, Phase 5+) | — |
| Chromium for tests | Playwright | ✓ | (existing setup, Phase 5+) | — |
| `wasm-pack` | NOT REQUIRED — Phase 12 ships zero Rust changes | — | — | — |
| `python3 -m http.server` | Local dev | ✓ | — | — |
| MicroBeast hardware (real) | SLIDE-42 UAT | external (depends on tester) | — | UAT marked `result: blocked` for Z80-PR-pending tests |
| Patched `slide.com` (post-PR) | SLIDE-42 UAT | ✗ | upstream PR pending | All 4 SLIDE-42 tests gated on this; mark blocked per UAT-10-01 idiom |

**Missing dependencies with no fallback:** None for code/test work. The patched slide.com is only required for executing the SLIDE-42 UAT, which the spec already accommodates via the blocked-result convention.

**Missing dependencies with fallback:** Patched slide.com → blocked-result UAT entries. Tester re-runs after PR lands.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (existing — `@playwright/test`) for browser-side specs. Native `cargo test` (existing) for Rust-side — but **Phase 12 makes ZERO Rust changes**, so cargo invocation is a no-op pass-through. |
| Config file | `www/playwright.config.js` (testMatch covers render/input/transport/session — both new spec locations are inside the matched globs) |
| Quick run command | `cd www && npm run test:fast -g "SLIDE-12\|SLIDE-36\|SLIDE-38"` (filter by requirement ID embedded in test name) |
| Full suite command | `cd www && npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLIDE-12 | onPointerDown early-returns when `[data-drop-target]` set | Integration (Playwright) | `cd www && npx playwright test render/selection-drop.spec.js` | ❌ Wave 0 |
| SLIDE-12 | Pointer-select still works when overlay NOT active (regression) | Integration (Playwright) | (same file) | ❌ Wave 0 |
| SLIDE-12 | Post-drop pointer-select works (overlay clears) | Integration (Playwright) | (same file) | ❌ Wave 0 |
| SLIDE-36 | `computeRenameScheme` 12-collision case | Unit (via Playwright `__fileSource`) | `cd www && npx playwright test transport/slide-collisions.spec.js -g "12-collision"` | ❌ Wave 0 |
| SLIDE-36 | `computeRenameScheme` 100-collision case | Unit | (same file) | ❌ Wave 0 |
| SLIDE-36 | `computeRenameScheme` no-extension case | Unit | (same file) | ❌ Wave 0 |
| SLIDE-36 | Modal renders 3 buttons + correct default focus when collisions present | Integration | (same file) | ❌ Wave 0 |
| SLIDE-36 | `[Send N renamed]` applies rename via mock-bot send round-trip | Integration | (same file) | ❌ Wave 0 |
| SLIDE-36 | `[Send only first]` drops collision-group members 1..N | Integration | (same file) | ❌ Wave 0 |
| SLIDE-36 | `[Refuse batch]` prevents enterSendMode call | Integration | (same file) | ❌ Wave 0 |
| SLIDE-36 | No-collision happy path: Cancel-default focus preserved | Regression | (same file) | ❌ Wave 0 |
| SLIDE-38 | `isAutoSendSafe` regex accepts SAFE_CASES (5 cases) | Unit | `cd www && npx playwright test transport/slide-autosend-safety.spec.js -g "accepts"` | ❌ Wave 0 |
| SLIDE-38 | `isAutoSendSafe` regex rejects UNSAFE_CASES (5 cases) | Unit | (same file) | ❌ Wave 0 |
| SLIDE-38 | Unsafe command blocks auto-type at use site | Integration | (same file) | ❌ Wave 0 |
| SLIDE-38 | First-use confirm surfaces for non-default value | Integration | (same file) | ❌ Wave 0 |
| SLIDE-38 | Confirmation flag sticks across enterSendMode calls | Integration | (same file) | ❌ Wave 0 |
| SLIDE-38 | Changing auto-send re-arms confirmation flag | Integration | (same file) | ❌ Wave 0 |
| SLIDE-40 | Doc file `docs/SLIDE_Z80_REQUIREMENT.md` exists with required sections | Manual / smoke | `test -f docs/SLIDE_Z80_REQUIREMENT.md && grep -q 'ESC.\\^.*SLIDE\\|wakeup' docs/SLIDE_Z80_REQUIREMENT.md` | ❌ Wave 0 |
| SLIDE-41 | README.md gains "File transfer" section | Manual / smoke | `grep -q 'File transfer' README.md` | n/a (in-place edit) |
| SLIDE-41 | README.md keyboard shortcuts table extended | Manual / smoke | `grep -q 'Active SLIDE transfer' README.md` | n/a (in-place edit) |
| SLIDE-42 | Doc file `docs/SLIDE-UAT.md` exists with 4 tests in 10-HUMAN-UAT format | Manual / smoke | `test -f docs/SLIDE-UAT.md && grep -c 'UAT-12-' docs/SLIDE-UAT.md` (should be 4 per test = 4) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd www && npm run test:fast` (existing Phase 5+ command — runs the relevant new specs alongside regression coverage; ~10-30 s)
- **Per wave merge:** `cd www && npx playwright test --workers=4` (full suite; matches Phase 11 Plan 11-05 precedent for parallel-safe execution)
- **Phase gate:** Full suite green + manual smoke greps for the 3 doc files before `/gsd-verify-work` (per the requirements above; the manual checks are a sub-minute step)

### Wave 0 Gaps

- [ ] `www/tests/render/selection-drop.spec.js` — covers SLIDE-12 (3 tests)
- [ ] `www/tests/transport/slide-collisions.spec.js` — covers SLIDE-36 (8 tests)
- [ ] `www/tests/transport/slide-autosend-safety.spec.js` — covers SLIDE-38 (15 tests across SAFE/UNSAFE_CASES + integration)
- [ ] `docs/SLIDE_Z80_REQUIREMENT.md` — SLIDE-40 deliverable
- [ ] `docs/SLIDE-UAT.md` — SLIDE-42 deliverable
- [ ] Optional `__isAutoSendSafeForTests` introspection export on `window.__slide` — needed for SLIDE-38 unit tests

*(Framework install: NOT NEEDED — Playwright already installed at Phase 5; cargo not invoked.)*

## Security Domain

Per `.planning/config.json`, `security_enforcement` is not explicitly set — treat as enabled by default per Beastty's general project posture.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — no authentication boundary in Phase 12 |
| V3 Session Management | no | N/A — no auth session |
| V4 Access Control | no | N/A — local app |
| V5 Input Validation | yes | **SLIDE-38 regex** (`/^[A-Za-z0-9:]*\r$/`) — strict allowlist for auto-send command. Mitigates Pitfall 17 (auto-send injection vector). |
| V6 Cryptography | no | N/A — no new crypto in Phase 12 (CRC handled by Phase 7 Rust core, not modified) |
| V7 Error Handling | yes | All Phase 12 code paths use `try/catch` consistently with Phase 9-11 precedent (e.g., `try { slideChipRef.enterError(...) } catch {}` mirrors slide.js:188 pattern). Errors logged via `console.error` not `alert` (no UI hijack). |
| V12 File Handling | yes | **SLIDE-36 collision detection**: post-truncation key prevents Z80-side overwrites. **SLIDE-12 isolation**: drag-drop and pointer-select don't compete for click events, preventing accidental file-content drops to remote terminal as text. |
| V14 Configuration | yes | **SLIDE-38 first-use confirmation chip**: defends against hostile-config injection where a user is tricked into pasting a command that runs Z80-side commands. Confirmation chip provides visible signal that an unusual command is about to run. |

### Known Threat Patterns for Beastty + SLIDE

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hostile auto-send command (e.g., `B:RM *.* ; SLIDE R\r`) typed via Settings or auto-loaded from imported prefs | Tampering / Elevation of Privilege (Z80-side execution) | SLIDE-38 regex at use site (`SAFE_AUTO_SEND_RE`); first-use confirmation chip for non-default values; localStorage-stored prefs are isolated per-origin (browser standard) |
| File-name injection via crafted filenames bypassing CP/M validation | Tampering | Phase 9 `validateCpmFilename` already enforces character set; Phase 12 SLIDE-36 detection runs AFTER this gate, so collision keys are already validated |
| Drag-drop spoofing — user thinks they're text-pasting but actually file-dropping | Spoofing | Phase 9 D-04 silent rejection at `dragenter` for non-file drags; SLIDE-12 isolation extends this by ensuring pointer-select doesn't fire during file drag |
| Real-hardware UAT-induced data loss (canceling at wrong moment leaves Z80 stuck) | Denial of Service | ADR-003 v0.2.1 amendment + 2 s `force_idle` escape hatch in JS already ships; SLIDE-42 UAT exercises this path with `result: blocked` until upstream Z80 patch lands |

## Sources

### Primary (HIGH confidence)

- `/home/ant/src/microbeast/bestialitty/.planning/phases/12-slide-ux-polish-docs-real-hardware-uat/12-CONTEXT.md` — locked decisions, Claude's Discretion bounds
- `/home/ant/src/microbeast/bestialitty/.planning/REQUIREMENTS.md` — 6 pending requirements + traceability table
- `/home/ant/src/microbeast/bestialitty/.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — protocol authority
- `/home/ant/src/microbeast/bestialitty/.planning/research/PITFALLS.md` §15, §17 — Z80-side version skew + auto-send injection vector (the exact pattern SLIDE-38 mitigates)
- `/home/ant/src/microbeast/bestialitty/www/input/file-source.js` — current Phase 9 implementation (read in full, 458 LOC)
- `/home/ant/src/microbeast/bestialitty/www/input/selection.js` — current Phase 6 implementation (read in full, 337 LOC, line 113 confirmed as insertion point)
- `/home/ant/src/microbeast/bestialitty/www/transport/slide.js:160-200` — `readAutoSendCommandBytes` site (verbatim source for SLIDE-38 extension)
- `/home/ant/src/microbeast/bestialitty/www/renderer/slide-chip.js` — chip lifecycle + observer pattern (read in full, 429 LOC)
- `/home/ant/src/microbeast/bestialitty/www/state/prefs.js` — DEFAULTS + savePrefs debounce contract
- `/home/ant/src/microbeast/bestialitty/www/index.html:1005-1017, 642-728` — modal markup + CSS
- `/home/ant/src/microbeast/bestialitty/.planning/phases/10-slide-receiver-cancellation/10-HUMAN-UAT.md` — verbatim format template for SLIDE-42
- `/home/ant/src/microbeast/bestialitty/README.md` — current 102-line state for SLIDE-41 extension
- `/home/ant/src/microbeast/SLIDE/slide.asm` — confirmed v0.4 head with NO ESC^SLIDE / NO CTRL_CAN echo (PR-pending verification)
- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — protocol authority cited by SLIDE-40 doc
- Phase 9/10/11 CONTEXT.md files — establish patterns Phase 12 honors

### Secondary (MEDIUM confidence)

- `/home/ant/src/microbeast/bestialitty/.planning/phases/06-daily-driver-polish-session-deployment/06-HUMAN-UAT.md` — alternate UAT format reference (Phase 12 follows 10-HUMAN-UAT, not 06)
- `/home/ant/src/microbeast/bestialitty/.planning/research/SUMMARY.md` — synthesized research summary (used for cross-validation, not direct citation)

### Tertiary (LOW confidence)

- None — Phase 12 is well-bounded and every claim has direct file-level evidence.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all extension points verified by file reads
- Architecture: HIGH — Phase 12 follows established Phase 9/10/11 patterns verbatim
- Pitfalls: HIGH — extracted from ADR-003 + PITFALLS §15/§17 + direct code inspection
- SLIDE-36 algorithm correctness: HIGH for normal cases, MEDIUM for short-base edge case (pinned in Open Questions)
- SLIDE-38 regex correctness: HIGH — explicit cases enumerated, SLIDE-13 interaction resolved
- SLIDE-40 doc audience/depth: MEDIUM — text-based deliverable; planner has reasonable latitude on prose
- SLIDE-41 README structure: HIGH — append-only per CONTEXT default
- SLIDE-42 UAT: HIGH for format (mirror), MEDIUM for content validity until upstream PR lands

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days — phase boundaries stable; only refresh if upstream Z80 PR lands and changes the SLIDE-40/SLIDE-42 status banners)

## RESEARCH COMPLETE
