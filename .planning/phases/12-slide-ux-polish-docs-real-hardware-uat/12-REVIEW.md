---
phase: 12-slide-ux-polish-docs-real-hardware-uat
reviewed: 2026-05-09T00:00:00Z
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
  warning: 3
  info: 8
  total: 11
status: issues_found
passes:
  - reviewed: 2026-05-08
    scope: full-phase
    files_reviewed: 13
    findings: { critical: 0, warning: 2, info: 4 }
  - reviewed: 2026-05-09
    scope: gaps-only (Plan 12-06)
    files_reviewed: 4
    findings: { critical: 0, warning: 1, info: 4 }
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

---

# Phase 12 — Gap-Closure Re-Review (Plan 12-06 only)

**Scope:** `--gaps-only` execution on 2026-05-09. Reviews the four files touched by Plan 12-06 (SLIDE-36 modal default-focus + SLIDE-38 auto-send invalid border). Plans 12-01..12-05 are unchanged since the 2026-05-08 pass and are not re-reviewed here.

**Files Reviewed (4):**
- `www/index.html`
- `www/input/file-source.js`
- `www/tests/render/modal-default-focus.spec.js`
- `www/tests/transport/slide-autosend-safety.spec.js`

**Findings:** 0 critical / 1 warning / 4 info

## Summary (Gap-Closure Pass)

Plan 12-06 closes two UAT gaps via the canonical Phase 6 `[data-focused="true"]` attribute idiom (Gap 1) and the new `--chrome-invalid-strong` token (Gap 2). The CSS-and-attribute contract is correct end-to-end and the change-handler / `onClose` lifecycle is sound for the use cases in scope.

One Warning calls out an inconsistency in how the two halves of Plan 12-06 apply the project's "no source-order trap" specificity discipline: the SLIDE-38 invalid rule was deliberately bumped to (0,2,2,0) to win on specificity alone, but the new SLIDE-36 modal-focus rule sits at (0,2,1,1) — TIED with the sibling `:focus-visible` and `:hover` rules, so it relies entirely on source order. The same anti-pattern the SLIDE-38 comment block calls out is reintroduced one block earlier.

The data-focused clear lifecycle in `onClose` correctly covers the only two buttons that ever receive `data-focused="true"` today (`sendRenamedBtnRef`, `cancelBtnRef`), so there is no live stale-state hole. The two new tests in `modal-default-focus.spec.js` use the correct production code path (file-input change → showModal → focus()) and treat the attribute poll as the load-bearing assertion, not the borderColor check. The two new blurred-state tests in `slide-autosend-safety.spec.js` correctly pin the round-trip and acknowledge the `:focus-visible` interaction in their comments.

No XSS or injection surface introduced — CSS tokens, attribute writes with hard-coded literal strings, and test data only.

## Warnings (Gap-Closure Pass)

### WR-03: New modal-focus CSS rule reintroduces the source-order trap that the SLIDE-38 fix was specifically designed to avoid

**File:** `www/index.html:743`

The new rule

```css
#send-modal footer button[data-focused="true"] {
  border-color: var(--chrome-accent);
  outline: none;
}
```

has specificity (0, 2, 1, 1). The existing rule four lines earlier

```css
#send-modal footer button:hover,
#send-modal footer button:focus-visible {
  border-color: var(--chrome-accent);
  outline: none;
}
```

ALSO has specificity (0, 2, 1, 1). They tie, so the cascade falls back to source order. The data-focused rule appears AFTER `:focus-visible` so today it wins — but only on source order.

This is exactly the regression vector that Plan 12-06's other half spends a 25-line CSS comment block (lines 753-776) warning future authors away from. The auto-send invalid rule was bumped to (0,2,2,0) on the explicit reasoning *"(0,2,2,0) wins regardless of order — no source-order trap."* Applying that principle inconsistently within the same plan is a maintenance hazard.

A second-order concern: today both rules paint the same color (`var(--chrome-accent)`), so the source-order tie is invisible at runtime. If the modal-focus rule ever needs a distinct color or style, the source-order dependency becomes load-bearing.

**Fix:**

```css
[data-theme] #send-modal footer button[data-focused="true"] {
  border-color: var(--chrome-accent);
  outline: none;
}
```

`[data-theme]` adds (0,1,0,0) so the rule becomes (0,3,1,1) — beats both competing (0,2,1,1) rules on specificity alone. Same `<body data-theme>` ancestry argument the SLIDE-38 comment block already documents applies. Then add a symmetric "(0,3,1,1) wins regardless of order" comment for parity with the SLIDE-38 block.

## Info (Gap-Closure Pass)

### IN-05: `data-focused` clear uses string `"false"` rather than `removeAttribute`; OK for current selector but slightly off-idiom

**File:** `www/input/file-source.js:499-500`

The clear path writes literal `"false"`. The CSS selector is `[data-focused="true"]` so `"false"` correctly fails to match — no live bug. The local analog in `www/renderer/chrome.js` uses the same string-`"false"` convention, so this matches local precedent and the test (`getAttribute('data-focused')).toBe('false')`) depends on the literal string.

**Fix:** No change recommended — current code matches the established `chrome.js` precedent and the test contract.

### IN-06: `data-focused` clear list omits `firstOnly` and `refuse` buttons; correct today, but a maintenance landmine

**File:** `www/input/file-source.js:496-500`

The `onClose` handler clears `data-focused` on `sendRenamedBtnRef` and `cancelBtnRef` only. Today the set call site only ever targets one of those two, so this is sufficient. But if a future change extends `initialFocusTarget` to include `firstOnlyBtnRef` or `refuseBtnRef`, the clear path will silently miss them and a stale `data-focused="true"` leaks into the next modal open.

**Fix:**

```javascript
[sendRenamedBtnRef, cancelBtnRef, sendBtnRef, firstOnlyBtnRef, refuseBtnRef]
    .forEach((btn) => btn?.setAttribute('data-focused', 'false'));
```

…or leave a comment at the clear site stating "must mirror `initialFocusTarget` candidates". The full-set sweep is cheaper than the cognitive tax.

### IN-07: Modal-default-focus borderColor assertion is not load-bearing under Playwright's synthetic file-input path

**File:** `www/tests/render/modal-default-focus.spec.js:66-69`

The test header comment (lines 53-56) already acknowledges this — the borderColor check matches `--chrome-accent` whether `:focus-visible` or `[data-focused="true"]` paints it. The attribute poll on lines 57-60 is the load-bearing contract.

**Fix:** No code change — the test author already calls this out and uses the attribute poll as the load-bearing contract. Optionally swap one variant to a clean-theme borderColor (`rgb(127, 219, 202)` = `#7fdbca`) for theme coverage; gold-plating.

### IN-08: Slide-autosend safety blurred-state tests assume body `data-theme` remains `"crt"` at test time

**File:** `www/tests/transport/slide-autosend-safety.spec.js:269-276, 301-307`

Both new tests assert hard-coded RGB tuples (`rgb(224, 64, 64)` for invalid; `rgba(255, 255, 255, 0.08)` for muted). Both tokens (`--chrome-invalid-strong`, `--chrome-border`) are NOT redefined per theme — confirmed against `www/index.html` lines 38-58 — so the assertions are robust to a theme change.

**Fix:** None required. Optionally add a one-line `// theme-independent token` comment so a future maintainer doesn't have to walk the CSS.

## Focus-Area Notes (Gap-Closure Pass)

1. **Specificity contract correctness:** SLIDE-38 invalid rule's (0,2,2,0) bump correctly beats the (0,2,1,0) `:focus-visible` rule on specificity alone — verified. SLIDE-36 modal-focus rule does NOT carry the same discipline through (WR-03).
2. **setAttribute / removeAttribute lifecycle:** No race or stale-state hole today. Set is synchronous before `.focus()`, clear is synchronous in `onClose`, `removeEventListener` inside `onClose` prevents handler accumulation. Implicit assumption that `initialFocusTarget` will only ever be sendRenamed or cancel — see IN-06.
3. **Test contract realism:** Both new modal-default-focus tests drive the production trigger path (`setInputFiles → 'change' → processFiles → showModal`) rather than calling `.focus()` directly, which would trigger `:focus-visible` and mask the bug. The blurred-state tests in `slide-autosend-safety.spec.js` correctly pin blur — the actual UX moment when the user sees the invalid cue.
4. **Security / XSS surface:** Clean. CSS-only token addition + `setAttribute` writes with hard-coded literal strings ("true" / "false"). No user-controlled content reaches attribute names or values; no `innerHTML`, no `eval`. Test fixtures use `Buffer.from()` with literal byte strings.

---

_Re-Reviewed: 2026-05-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Scope: gaps-only (Plan 12-06)_
