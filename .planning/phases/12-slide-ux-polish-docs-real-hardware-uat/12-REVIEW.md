---
phase: 12-slide-ux-polish-docs-real-hardware-uat
reviewed: 2026-05-08T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - README.md
  - docs/SLIDE-UAT.md
  - docs/SLIDE_Z80_REQUIREMENT.md
  - www/index.html
  - www/input/file-source.js
  - www/input/selection.js
  - www/main.js
  - www/renderer/slide-chip.js
  - www/state/prefs.js
  - www/tests/render/selection-drop.spec.js
  - www/tests/transport/slide-autosend-safety.spec.js
  - www/tests/transport/slide-collisions.spec.js
  - www/transport/slide.js
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-05-08
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 12 covers six change groups: SLIDE-12 (pointer/drop isolation), SLIDE-36
(filename collision detection + auto-rename modal), SLIDE-38 (auto-send safety
regex + first-use-confirm chip), SLIDE-40/41/42 (docs). No `crates/` files
appear in the review scope — the zero-Rust hard invariant is satisfied.

The core logic is solid. The collision-detection algorithm is correct, the
safety regex correctly admits the default `B:SLIDE R\r` after the documented
Plan 12-03 deviation widening, and the wire-safety hard gate at
`readAutoSendCommandBytes` is properly layered before `TextEncoder.encode`. The
SLIDE-12 early-return guard in `onPointerDown` is exactly right. Two warnings
are raised: a duplicate character bug in `selectLine` that silently degrades
triple-click trimming, and a double-`enterSendMode` race window opened by the
async first-use-confirm path. Four info items round out style and dead-code
notes.

---

## Warnings

### WR-01: Duplicate character in `selectLine` whitespace comparison silently fails to trim narrow-space glyphs

**File:** `www/input/selection.js:209`

**Issue:** The `while` loop in `selectLine` tests two different Unicode
characters for trailing-whitespace trimming:

```js
while (end > 0 && (text[end] === ' ' || text[end] === ' ')) end -= 1;
```

Visually both operands look identical, but one is U+0020 (SPACE) and the other
is U+00A0 (NO-BREAK SPACE) or another look-alike. If both code units are in
fact U+0020 then the second branch is a dead condition and trimming still works,
but the intent is clearly to trim at least two distinct whitespace types.
Checking the raw hex: JavaScript source is UTF-16 internally, and the two
string literals cannot be distinguished by eye. In either case this is a logic
defect — either the second comparison is unreachable dead code (harmless but
misleading), or it targets a character that the regex `slice.replace(/[\s ]+$/,
'')` in `getSelection` already strips, making the two paths inconsistent.
Neither case is the stated intent.

**Fix:**

```js
// Be explicit about every whitespace code unit you want to trim.
while (end > 0 && (text[end] === ' ' || text[end] === ' ')) end -= 1;
```

Or use the regex approach that `getSelection` already uses for consistency:

```js
// Triple-click: trim trailing whitespace from end index.
while (end > 0 && /\s/.test(text[end])) end -= 1;
```

---

### WR-02: Double-`enterSendMode` race window during async first-use-confirm path

**File:** `www/transport/slide.js:850-870` (and `enterSendModeAfterFirstUseConfirm`)

**Issue:** When `shouldSurfaceFirstUseConfirm(cmd)` is true, `enterSendMode`
calls `void enterSendModeAfterFirstUseConfirm(...)` and returns immediately
without setting `pendingSendSession`. The existing WR-05 first-click-wins guard
checks `pendingSendSession !== null`, but during the async confirmation wait
`pendingSendSession` is still `null`. A second call to `enterSendMode` (e.g.,
from a rapid double-click on the modal's send button, or a programmatic caller)
passes the `pendingSendSession !== null` check, also reaches
`shouldSurfaceFirstUseConfirm`, and launches a second `enterSendModeAfterFirstUseConfirm`
coroutine. Both coroutines independently await the same chip Promise. The first
to be resolved calls `enterSendModeProceed` — which sets `pendingSendSession`
and auto-types bytes — and the second also calls `enterSendModeProceed` on its
own resolution path. This would auto-type the command twice and set two
`pendingSendSession` objects (the second clobbers the first, per the "depth 1"
design, but only after the first may have already triggered
`enterSendModeInternal`).

The code comment at line 862-864 acknowledges part of this: "the second click
would also reach this branch". The chip's `enterFirstUseConfirm` clears prior
state on re-entry (clearing callbacks), which means the FIRST coroutine's
`onConfirm`/`onReset` are nulled out when the second coroutine fires the chip,
so the first coroutine's `surfaceFirstUseConfirm` Promise never resolves —
creating the T-12-07 unresolved-Promise leak at double-click time.

In production the file-source button is disabled during the modal, making this
rare. But a rapid programmatic double-call to `window.__slide.enterSendMode`
(as used in tests) reproduces it easily.

**Fix:** Set a sentinel flag (not `pendingSendSession`) that is cleared on both
confirm and reset paths:

```js
// At module scope (near pendingSendSession):
let firstUseConfirmPending = false;

// In enterSendMode, before `void enterSendModeAfterFirstUseConfirm`:
if (firstUseConfirmPending) {
    console.warn('[slide.js] first-use confirm already in progress; ignoring duplicate enterSendMode');
    return;
}
firstUseConfirmPending = true;
void enterSendModeAfterFirstUseConfirm({ files, cmd });

// At the top of enterSendModeAfterFirstUseConfirm, in both branches:
firstUseConfirmPending = false;

// In __resetForTests:
firstUseConfirmPending = false;
```

---

## Info

### IN-01: `getCellSize` in selection-drop.spec.js falls back silently when `__getActiveCellSize` is absent

**File:** `www/tests/render/selection-drop.spec.js:37-44`

**Issue:** The `getCellSize` helper reads `window.__metrics?.cellSize?.()` as
its primary path, then falls back to a hardcoded `{ cellW: 9, cellH: 18 }`.
Phase 6 selection spec precedent uses `window.__getActiveCellSize()` (exposed
at `main.js:265`). The `window.__metrics` path is not wired anywhere in the
codebase under review, so the primary branch always evaluates to `undefined`
and the hardcoded fallback always fires. If the active cell size diverges from
9×18 (e.g., after a zoom or font change), the drag coordinates will miss the
intended cells, silently producing a flaky or vacuously-passing test.

**Fix:**

```js
async function getCellSize(page) {
    return await page.evaluate(() => {
        const m = typeof window.__getActiveCellSize === 'function'
            ? window.__getActiveCellSize()
            : null;
        return m || { cellW: 9, cellH: 18 };
    });
}
```

---

### IN-02: `enterSendModeProceed` has an unused `cmd` parameter in its destructuring

**File:** `www/transport/slide.js:920`

**Issue:** The function signature is `function enterSendModeProceed({ files /* cmd */ })`.
`cmd` is commented out of the destructuring. `readAutoSendCommandBytes()` re-reads
from `prefsRef` internally, so the caller-provided `cmd` is not needed inside this
function. However, the comment `// cmd is passed through (raw string from prefs) —
readAutoSendCommandBytes will re-read prefs internally` at line 918 is slightly
misleading: the function was originally designed with `cmd` as a passed-through
argument (as the JSDoc says) but `cmd` is stripped from the destructuring and
`readAutoSendCommandBytes` re-derives it from `prefsRef`. This creates a subtle
risk: if the prefs mutate between when `cmd` was read in `enterSendMode` and when
`readAutoSendCommandBytes` fires inside `enterSendModeProceed`, the validated
and displayed `cmd` will diverge from the one actually encoded on the wire.
For the current code path this window is negligible, but it is an unnecessary
re-read that contradicts the caller's intent.

**Fix:** Either pass and use `cmd` explicitly (eliminating the re-read), or
remove the comment that implies it is passed:

```js
// Option A — use the already-validated cmd:
function enterSendModeProceed({ files, cmd }) {
    const autoSendBytes = cmd.length === 0 ? new Uint8Array(0) : new TextEncoder().encode(cmd);
    // ... (safety gate already ran in enterSendMode; no need to re-read)
}
```

---

### IN-03: `README.md` typo — "crips" should be "crisp"

**File:** `README.md:20`

**Issue:** `"Render a crips modern display"` — "crips" is a typo for "crisp".

**Fix:** `"Render a crisp modern display"`

---

### IN-04: `isSessionActive()` in file-source.js does not account for recv mode

**File:** `www/input/file-source.js:223-228`

**Issue:** `isSessionActive()` returns true for `hasPendingSendSession || mode === 'send'`
but does not check `mode === 'recv'`. This means that while a file is being
received from the Z80, a new drag-drop lands on the terminal and the overlay
renders normally (no `flashDropRejected`, no `setDropTarget(false)` guard).
`onDragEnter` and `onDrop` do check `isSessionActive()` — and because
`isSessionActive()` returns `false` during recv, the drop overlay would appear
and `processFiles` would be called, reaching `enterSendModeFn`. The actual
`enterSendMode` in slide.js has the WR-02 guard that rejects a send when
`owner !== 'terminal'`, so bytes don't actually reach the wire, but the UI
incorrectly renders the drop overlay and opens the send modal during an active
receive session. The `updateButtonState` function (line 183) correctly accounts
for recv mode (`isReceiving` at line 183), so this discrepancy is inconsistent.

**Fix:** Include recv mode in the predicate:

```js
function isSessionActive() {
    if (!getSlideStateFn) return false;
    let st;
    try { st = getSlideStateFn(); } catch { return false; }
    return !!st?.hasPendingSendSession || st?.mode === 'send' || st?.mode === 'recv';
}
```

---

_Reviewed: 2026-05-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
