---
quick_id: 260513-grs
type: execute
wave: 1
depends_on: []
files_modified:
  - www/renderer/themes.js
  - www/state/prefs.js
  - www/index.html
  - www/main.js
  - www/input/file-source.js
  - www/transport/slide.js
  - www/tests/session/prefs.spec.js
  - www/tests/transport/slide-confirm-pref.spec.js
  - www/tests/transport/slide-post-fin-forward.spec.js
autonomous: true
requirements:
  - V11-POLISH-1   # Clean theme default size parity with CRT
  - V11-POLISH-2   # SLIDE "Confirm file transfers" toggle
  - V11-POLISH-3   # Forward post-FIN bytes to terminal parser (send + recv)

must_haves:
  truths:
    - "Booting Beastty with Clean theme renders a canvas ~1280x768 px (parity with CRT defaults), not 720x432."
    - "When prefs.slideConfirmTransfers === true (default), dropping/picking files still surfaces the confirm modal exactly as before."
    - "When prefs.slideConfirmTransfers === false, dropping/picking files starts the transfer immediately — modal is never shown."
    - "When the Z80's CTRL_FIN echo arrives in the same wire chunk as trailing terminal text (send mode), the terminal text is rendered after the SLIDE chip exits, not silently dropped."
    - "When the Z80 emits its own CTRL_FIN followed by trailing terminal text in one chunk (recv mode), the terminal text reaches term.feed after exitRecvMode flips owner back to 'terminal'."
    - "Existing slide-sender / slide-chip / slide-recv / slide-recv-e2e Playwright specs remain green."
  artifacts:
    - path: "www/renderer/themes.js"
      provides: "Clean theme cellW/cellH/fontPx bumped to match CRT 1280x768 default render size"
      contains: "clean:"
    - path: "www/state/prefs.js"
      provides: "slideConfirmTransfers field in DEFAULTS (default true)"
      contains: "slideConfirmTransfers"
    - path: "www/index.html"
      provides: "Settings row #slide-confirm-transfers-row inside #settings-slide block"
      contains: "slide-confirm-transfers-checkbox"
    - path: "www/main.js"
      provides: "Boot-time mirror + change listener for slide-confirm-transfers-checkbox (savePrefs on change)"
      contains: "slideConfirmTransfers"
    - path: "www/input/file-source.js"
      provides: "processFiles gates showConfirmModal on prefs.slideConfirmTransfers; silent auto-rename when off"
      contains: "slideConfirmTransfers"
    - path: "www/transport/slide.js"
      provides: "dispatchSendMode + dispatchRecvMode forward post-FIN tail bytes to termRef.feed after mode flips to terminal"
      contains: "termRef.feed"
    - path: "www/tests/transport/slide-confirm-pref.spec.js"
      provides: "Playwright spec: modal NOT shown when slideConfirmTransfers=false"
      contains: "slideConfirmTransfers"
    - path: "www/tests/transport/slide-post-fin-forward.spec.js"
      provides: "Playwright spec: post-FIN trailing terminal text reaches the grid"
      contains: "termRef"
  key_links:
    - from: "www/main.js applyPrefs / boot mirror"
      to: "#slide-confirm-transfers-checkbox in index.html"
      via: "getElementById + addEventListener('change') + savePrefs({ slideConfirmTransfers })"
      pattern: "slide-confirm-transfers-checkbox"
    - from: "www/input/file-source.js processFiles"
      to: "prefs.slideConfirmTransfers via getPrefs()"
      via: "live read; when false, skip showConfirmModal entirely and call enterSendModeFn directly (after applyCollisionRenames if collisions exist)"
      pattern: "slideConfirmTransfers"
    - from: "www/transport/slide.js dispatchSendMode"
      to: "termRef.feed(postFinTail)"
      via: "byte-by-byte feed when state === STATE_FIN_PENDING; capture transition index to STATE_DONE; after exitSendMode flips mode to 'terminal', forward tail bytes"
      pattern: "termRef\\.feed"
    - from: "www/transport/slide.js dispatchRecvMode"
      to: "termRef.feed(postFinTail)"
      via: "byte-by-byte feed when next byte may trigger Done; after exitRecvMode flips mode to 'terminal', forward tail bytes"
      pattern: "termRef\\.feed"

# Quick-mode note: this plan ships THREE independent fixes as THREE atomic
# commits (one per task). No Rust changes — zero-Rust invariant carried
# forward from Phase 11. Memory hint: NO AI attribution in any commit.
---

<objective>
v1.1 polish — three independent bug fixes bundled as one plan, three atomic commits.

Fix 1 — Clean theme default zoom: Clean canvas renders at 720x432 (45% the size of CRT's 1280x768) at boot. Bump Clean's cellW / cellH / fontPx so its z=1 render matches CRT z=1.

Fix 2 — SLIDE "Confirm file transfers" Settings toggle: add `prefs.slideConfirmTransfers` (default true; preserves current behavior). When off, drops + picker selections begin transferring immediately — no modal.

Fix 3 — Forward post-FIN trailing bytes to the terminal parser (send + recv symmetric). When the Z80 emits CTRL_FIN in the same wire chunk as trailing console text (e.g. slide.com's "Session complete." msg_done_session), the SLIDE SM transitions to Done on the FIN byte; subsequent bytes are silently dropped by the Rust SM (state.rs:347-349) and never reach the terminal. Fix: dispatchSendMode / dispatchRecvMode detect the mid-chunk Done transition, capture the post-FIN tail, and feed it to termRef.feed() after exitSendMode / exitRecvMode has flipped owner+mode back to terminal.

Purpose: three observable v1.1 daily-driver quality issues, each independently regression-tested.
Output: 3 task commits + 2 new Playwright specs + DEFAULTS field + Settings row + render-size-parity tweak.
</objective>

<execution_context>
@/home/ant/src/microbeast/bestialitty/.claude/get-shit-done/workflows/execute-plan.md
@/home/ant/src/microbeast/bestialitty/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/PROJECT.md
@CLAUDE.md

# Source files this plan modifies (exact line refs for executor)
@www/renderer/themes.js
@www/state/prefs.js
@www/input/file-source.js
@www/main.js

# Source files referenced for shape (NOT modified for Fix 1 / Fix 2; modified for Fix 3)
# slide.js is large — executor will Grep + offset-Read the relevant ranges, not whole-file Read
# Key ranges:
#   lines 100..225  — event packing + state ID constants (STATE_FIN_PENDING=4, STATE_DONE=6, STATE_ERROR=7, STATE_DATA_PHASE=3)
#   lines 471..492  — dispatchInbound mode switch
#   lines 581..693  — dispatchTerminalMode (forms the byte-by-byte + tail-forward pattern Fix 3 mirrors)
#   lines 700..760  — dispatchRecvMode (mid-session ESC^SLIDE wakeup matcher — pattern to extend)
#   lines 760..805  — feedSlide / drainEventsAndOutbound / maybeExitRecvMode
#   lines 1290..1340 — exitSendMode + dispatchSendMode (~5 lines, fast path)
#   lines 1495..1510 — maybeExitSendMode (calls exitSendMode on STATE_DONE / STATE_ERROR / STATE_CANCEL_PEND)

<interfaces>
<!-- prefs.js exports -->
From www/state/prefs.js:
```js
export function loadPrefs(): PrefsBlob
export function savePrefs(partial: Partial<PrefsBlob>): void
export function getPrefs(): PrefsBlob | null
export function resetPrefs(): void
export function subscribe(fn: (prefs) => void): () => void
export const DEFAULTS: Readonly<PrefsBlob>
// DEFAULTS includes Phase 10/11/12 fields already:
//   slideRecvToFolder, slideAutoSendCommand, slideShowSummary,
//   slideCompatibilityMode, slideAutoSendCommandConfirmed, ...
```

<!-- themes.js shape (the field we touch in Fix 1) -->
From www/renderer/themes.js:
```js
export const THEMES = {
    crt:   { name, fg, bg, accent, font: null,            rasteriser: 'bitmap', cellW: 16, cellH: 32, baseline, cursor, ..., phosphorSlots },
    clean: { name, fg, bg, accent, font: 'JetBrains Mono', rasteriser: 'vector', cellW: 9,  cellH: 18, fontPx: 14, baseline, cursor, ... },
};
// At zoom=1: CRT renders 16*80 = 1280 W by 32*24 = 768 H.
//            Clean renders 9*80 = 720 W by 18*24 = 432 H.
// Goal: Clean z=1 should also render ~1280x768.
// Math: 1280/80 = 16 → cellW=16. 768/24 = 32 → cellH=32. fontPx scales 14 * (16/9) ≈ 24.89 → 25.
// New Clean values: cellW=16, cellH=32, fontPx=25.
```

<!-- file-source.js shape (the path Fix 2 modifies) -->
From www/input/file-source.js:
```js
// processFiles(filesArr) — async, ~lines 301..363
// Builds rows[] + surviving[] + collisionRows[], then calls:
//   const action = await showConfirmModal(rows, surviving, collisionRows);
// Returns 'send' | 'first-only' | 'refuse' | null.
// Action handling:
//   'send'  → finalFiles = applyCollisionRenames(surviving, collisionRows)
//   'first-only' → finalFiles = applyFirstOnlyFilter(surviving, collisionRows)
//   then enterSendModeFn({ files: finalFiles })
//
// Fix 2 gate: when prefs.slideConfirmTransfers === false:
//   - collisions present  → finalFiles = applyCollisionRenames(surviving, collisionRows) [same as 'send' path]
//   - no collisions       → finalFiles = surviving
//   - if finalFiles.length > 0 → enterSendModeFn({ files: finalFiles })
//   - skip showConfirmModal entirely
```

<!-- slide.js relevant SM state IDs (Fix 3) -->
From www/transport/slide.js lines 112..120:
```js
const STATE_IDLE          = 0;
const STATE_WAITING_RDY   = 1;
const STATE_HEADER_PHASE  = 2;
const STATE_DATA_PHASE    = 3;
const STATE_FIN_PENDING   = 4;
const STATE_CANCEL_PEND   = 5;
const STATE_DONE          = 6;
const STATE_ERROR         = 7;
```
These constants are ALREADY exposed in slide.js (line 119 confirms STATE_DONE=6 is declared). No need to add anything.

<!-- slide.js dispatchSendMode current shape (Fix 3 target) -->
```js
// Lines 1333..1339 — current 5-line implementation:
async function dispatchSendMode(value) {
    feedSlide(value);                                  // slide.feed_chunk(value)
    await drainEventsAndOutboundAwaitable();
    pumpNextDataChunkIfReady();
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();                               // calls exitSendMode() on STATE_DONE/ERROR/CANCEL_PEND
}
```

<!-- slide.js dispatchRecvMode current shape (Fix 3 target) -->
```js
// Lines 702..760 — already byte-walks `value` for the mid-session ESC^SLIDE
// wakeup matcher. The post-FIN tail-forward logic must integrate with this
// existing byte-walk, NOT duplicate it.
// Pattern: track stateBeforeByte → stateAfterByte transition Done; on
// transition, the bytes already fed went to feed_chunk, so we need a
// different approach for the recv path: feed bytes one at a time when we're
// near the FIN boundary (STATE_HEADER_PHASE in recv terminology — per the
// scope-note: "after the receiver echoes CTRL_FIN, it transitions Done from
// HeaderPhase on EVT_FIN").
```

<!-- termRef and exitRecvMode / exitSendMode -->
```js
// termRef = injected via wireSlideDispatcher (module-scope at line 141).
// termRef.feed(Uint8Array) is the canonical entry point for forwarding
// bytes to the VT52 parser (used at lines 614, 691, etc.).
// exitSendMode (line 1295) — flips mode to 'terminal' synchronously.
// exitRecvMode (line 823) — flips mode to 'terminal' synchronously.
// After either exit returns, mode === 'terminal' and termRef.feed is
// safe to call (the wakeIdx wakeup-matcher state is unaffected — it's
// a separate per-byte counter in dispatchTerminalMode that resets on
// mismatch).
```
</interfaces>
</context>

<tasks>

<!-- =============================================================
     TASK 1 — Fix 1: Clean theme default render-size parity with CRT
     ============================================================= -->
<task type="auto">
  <name>Task 1: Bump Clean theme cellW/cellH/fontPx so z=1 renders at 1280x768 (CRT parity)</name>
  <files>www/renderer/themes.js</files>
  <action>
Edit www/renderer/themes.js, the `clean` theme descriptor (currently lines 64..83). Change three fields:

  cellW: 9   → cellW: 16
  cellH: 18  → cellH: 32
  fontPx: 14 → fontPx: 25

Update the inline comment on the `cellW: 9, cellH: 18` line. Replace:
```
cellW: 9, cellH: 18,    // measured from JetBrains Mono 14 px at ~1.3 line-height
fontPx: 14,
```
with:
```
// v1.1 polish (260513-grs Task 1): bumped 9/18/14 → 16/32/25 so Clean
// theme z=1 renders 1280x768 (parity with CRT z=1). 16/9 ≈ 32/18 ≈ 25/14 ≈ 1.78
// linear scale. JetBrains Mono is a vector font so fractional-ish pt sizes
// rasterise cleanly; the chosen 25 px keeps the 1.78× ratio close enough that
// the 16x32 cell is still a comfortable home for the glyph (descender room).
cellW: 16, cellH: 32,
fontPx: 25,
```

DO NOT change anything else in themes.js. Leave the CRT theme block, phosphorSlots, DEFAULT_THEME_NAME, DEFAULT_PHOSPHOR, and DEFAULT_ZOOM untouched. Atlas eviction + resizeToTheme will pick up the new cell dimensions automatically the first time the user switches to Clean (and at boot if Clean is the persisted theme).

After saving, run `scripts/build.sh` to refresh the wasm output (technically not required because this is a JS-only file, but the project's hard-reload-after-build memory note applies any time files in www/ change — also a no-op if scripts/build.sh detects no Rust changes).

Commit message (NO AI attribution per project memory):
```
fix(clean-theme): bump z=1 render to 1280x768 (CRT parity)

Clean theme z=1 was rendering 720x432 — 56% the size of CRT z=1 (1280x768).
Bump Clean's cellW/cellH/fontPx from 9/18/14 to 16/32/25 so the user
toggling themes at boot sees comparable canvas sizes by default.

JetBrains Mono is vector-rasterised so 25 px (the 1.78× scale of 14 px)
rasterises without bitmap-zoom artefacts. The atlas evicts on every
setTheme() call, so the new cell dimensions take effect on the next paint.

Quick fix from .planning/quick/260513-grs.
```
  </action>
  <verify>
    <automated>
node -e "const t = require('./www/renderer/themes.js'); console.error('themes.js is ESM not CJS; use the playwright check instead')" 2>&1 | grep -q "ESM" && echo "themes.js is ESM — relying on playwright canvas-size check below"

# Boot the dev server (background) and assert canvas dimensions per theme via Playwright (re-using the existing test harness).
# This is structurally similar to the boot smoke tests already in www/tests/session/.
# If a focused spec is too heavyweight, the executor MAY substitute a one-shot grep assertion:
grep -n "cellW: 16, cellH: 32," www/renderer/themes.js | tee /tmp/clean-theme-grep.txt
grep -n "fontPx: 25" www/renderer/themes.js | tee -a /tmp/clean-theme-grep.txt
test -s /tmp/clean-theme-grep.txt
    </automated>
  </verify>
  <done>
    - www/renderer/themes.js Clean block has cellW=16, cellH=32, fontPx=25.
    - CRT block unchanged.
    - DEFAULT_THEME_NAME / DEFAULT_PHOSPHOR / DEFAULT_ZOOM unchanged.
    - Commit message has no Co-Authored-By / Claude / Anthropic strings.
    - Manual smoke check (out of band, encouraged but not blocking): toggle to Clean in the browser after hard-reload (Ctrl+Shift+R); canvas visual size should be a close match to CRT.
  </done>
</task>

<!-- =============================================================
     TASK 2 — Fix 2: SLIDE "Confirm file transfers" toggle
     ============================================================= -->
<task type="auto" tdd="true">
  <name>Task 2: Add prefs.slideConfirmTransfers (default true) + Settings row + processFiles gate</name>
  <files>
www/state/prefs.js,
www/index.html,
www/main.js,
www/input/file-source.js,
www/tests/transport/slide-confirm-pref.spec.js
  </files>
  <behavior>
    Test cases (encoded in www/tests/transport/slide-confirm-pref.spec.js):

    - Test 1 — default ON behavior preserved: with prefs.slideConfirmTransfers === true (default), simulating a file picker change event triggers the existing modal (#send-modal has [open] attribute).
    - Test 2 — toggle OFF skips modal: programmatically savePrefs({ slideConfirmTransfers: false }), then simulate a file picker change event with one valid CP/M-safe file → assert #send-modal NEVER receives [open]; assert window.__slide.__getStateForTests() shows hasPendingSendSession === true within ~200 ms (proves enterSendMode fired without user confirmation).
    - Test 3 — toggle OFF with collisions silently auto-renames: with slideConfirmTransfers=false, simulate picker with two files whose post-truncation 8.3 names collide → no modal shown; enterSendMode is invoked once with a 2-element files array; verify (via a wrapping window.__slide.enterSendMode spy installed in the test) that the second file's `name` matches the SLIDE-36 auto-rename scheme (e.g. `REPOR~1.TXT` for `report.txt` collision pair).
    - Test 4 — Settings checkbox round-trip: render #slide-confirm-transfers-checkbox; click it; assert getPrefs().slideConfirmTransfers becomes false; click again; assert it becomes true; assert the DOM checkbox.checked state matches getPrefs() on resetPrefs().

    The spec MUST use the same test-harness scaffolding as www/tests/transport/slide-collisions.spec.js (look it up for the boot/wireFileSource/window.__slide accessor patterns).

    Run order:
    1. Write spec FIRST (RED — file picker event handling will not skip modal yet).
    2. Implement the four production edits (GREEN).
    3. Re-run spec; all four tests pass.
  </behavior>
  <action>
**Sub-step A — Add pref to DEFAULTS (www/state/prefs.js):**

In the DEFAULTS object (currently lines 18..49), add a new line after `slideAutoSendCommandConfirmed: '',`:

```js
slideConfirmTransfers: true,
    // v1.1 polish (260513-grs Task 2) — default ON preserves the existing
    // confirm-modal flow. Toggle in #settings-slide → "Confirm file transfers".
    // When false, www/input/file-source.js's processFiles skips
    // showConfirmModal entirely; collisions auto-rename via the SLIDE-36
    // applyCollisionRenames helper (same logic the modal's [Send N renamed]
    // button uses). CURRENT_VERSION NOT bumped per Phase 6 D-32 defensive
    // merge (older blobs missing this field receive `true` via the
    // loadPrefs spread fill).
```

DO NOT bump CURRENT_VERSION. The defensive merge at line 85 (`{ ...DEFAULTS, ...parsed, ... }`) backfills new fields automatically for older blobs.

**Sub-step B — Add Settings row to www/index.html:**

Locate the `<details ... id="settings-slide">` block (lines 1022..1073). After the "Row 3 — Show summary checkbox" block (ending with the closing `</div>` of #slide-show-summary-row at approximately line 1062), insert a new `<div class="settings-row">` block BEFORE the "Row 4 — Compatibility mode" `<div class="settings-row" id="slide-compat-row">`:

```html
      <!-- Row — Confirm file transfers (v1.1 polish 260513-grs Task 2; default ON).
           When OFF, drops + picker selections start transferring immediately;
           collisions auto-rename via the SLIDE-36 scheme. -->
      <div class="settings-row" id="slide-confirm-transfers-row">
        <label>
          <input type="checkbox" id="slide-confirm-transfers-checkbox" checked>
          Confirm file transfers
        </label>
        <p class="hint">When off, drops and picker selections begin transferring immediately. Filename collisions are auto-renamed.</p>
      </div>
```

Use `checked` as the default DOM state (matches DEFAULTS.slideConfirmTransfers = true). applyPrefs (sub-step C) will sync this on every prefs apply.

**Sub-step C — Wire the checkbox in www/main.js:**

(1) Near the boot-time `const slideShowSummaryCheckbox = document.getElementById('slide-show-summary');` (line ~574), add a sibling line:

```js
const slideConfirmTransfersCheckbox = document.getElementById('slide-confirm-transfers-checkbox');
```

(2) After the `if (slideShowSummaryCheckbox) { ... }` block (lines 640..645), add an analogous block:

```js
if (slideConfirmTransfersCheckbox) {
    slideConfirmTransfersCheckbox.checked = (prefs.slideConfirmTransfers !== false);   // defensive default ON
    slideConfirmTransfersCheckbox.addEventListener('change', (e) => {
        savePrefs({ slideConfirmTransfers: !!e.target.checked });
    });
}
```

(3) In `applyPrefs` (line ~982 area — search for "applyPrefs"), find the analogous `if (slideShowSummaryCheckbox) ...` mirror or, if absent, locate the resetPrefs-driven mirror for `showAllSerialCheckbox` (line 1016). Add right after the `slideRecvToFolder` / `slideShowSummary` mirrors (whichever exists in applyPrefs already; if neither is mirrored, add one new entry after `showAllSerialCheckbox`):

```js
const slideConfirmTransfersCheckboxRef = document.getElementById('slide-confirm-transfers-checkbox');
if (slideConfirmTransfersCheckboxRef) slideConfirmTransfersCheckboxRef.checked = (p.slideConfirmTransfers !== false);
```

(Defensive `!== false` matches the slideShowSummary pattern.)

**Sub-step D — Gate processFiles in www/input/file-source.js:**

processFiles is currently lines 301..363. The gate runs AFTER rows/surviving/collisionRows have been computed (i.e. after line 344) and BEFORE the `const action = await showConfirmModal(...)` call at line 347. The replacement:

```js
    // v1.1 polish 260513-grs Task 2 — skip modal entirely when the user
    // has disabled confirmation. Default ON (slideConfirmTransfers=true)
    // preserves the Phase 9 / Phase 12 modal flow verbatim. When OFF:
    //   - collisions present → silent auto-rename (same scheme as the
    //     modal's [Send N renamed] button — applyCollisionRenames over
    //     collisionRows).
    //   - no collisions → use `surviving` as-is.
    // In both branches, enterSendModeFn is invoked directly without
    // user confirmation. All-rejected (surviving.length === 0) still
    // short-circuits via the existing finalFiles.length check below.
    //
    // Import getPrefs from www/state/prefs.js at top of file if not already
    // imported. (Check the existing imports block; if absent, add:
    //   import { getPrefs } from '../state/prefs.js';
    // following the existing import style in the file.)
    const livePrefsForConfirm = (typeof getPrefs === 'function') ? getPrefs() : null;
    const confirmEnabled = (!livePrefsForConfirm || livePrefsForConfirm.slideConfirmTransfers !== false);

    if (!confirmEnabled) {
        // Silent path — no modal. Collisions auto-rename; no-collision path
        // passes surviving through.
        let silentFinal;
        if (collisionRows.length > 0) {
            silentFinal = applyCollisionRenames(surviving, collisionRows);
        } else {
            silentFinal = surviving;
        }
        if (enterSendModeFn && silentFinal && silentFinal.length > 0) {
            enterSendModeFn({ files: silentFinal });
        }
        return;
    }

    // Default (confirmEnabled === true) — existing modal flow unchanged.
    const action = await showConfirmModal(rows, surviving, collisionRows);
    // ... (rest of existing processFiles body lines 348..363 untouched)
```

Verify `getPrefs` is imported at the top of file-source.js. If the file currently does NOT import from `../state/prefs.js`, add the import alongside the existing import statements (check first ~20 lines).

**Sub-step E — Playwright spec (www/tests/transport/slide-confirm-pref.spec.js):**

Mirror the test-harness scaffolding from www/tests/transport/slide-collisions.spec.js verbatim — same boot flow, same window.__slide / window.__prefs accessors, same modal selector (#send-modal).

The four tests outlined in <behavior>. For "Test 3 silent auto-rename verification", wrap window.__slide.enterSendMode with a spy via `await page.evaluate(() => { ... wrap impl, capture call args on window.__senderCalls = [] ... })` BEFORE simulating the file picker change. The spy must call through to the real enterSendMode so the post-call state still moves to send-pending (the test then asserts on window.__senderCalls[0].files names).

Use DataTransfer.items polyfill / Playwright's built-in `setInputFiles` for picker simulation — match whatever slide-collisions.spec.js uses (likely setInputFiles).

**Three atomic commits required for this task** (executor may EITHER ship as one combined task commit OR split into three; if split, the order is: prefs/HTML/main.js → file-source.js → spec):

Recommended single commit message:
```
feat(slide): add "Confirm file transfers" Settings toggle

New pref slideConfirmTransfers (default true; preserves existing modal flow).
When off, drops/picker selections begin transferring immediately;
filename collisions auto-rename via the SLIDE-36 scheme used by the
[Send N renamed] modal button. Settings row appears in #settings-slide.

Quick fix from .planning/quick/260513-grs.
```
  </action>
  <verify>
    <automated>
# Prefs round-trip
grep -n "slideConfirmTransfers" www/state/prefs.js | grep -q "true,"

# HTML row exists
grep -n 'id="slide-confirm-transfers-checkbox"' www/index.html

# main.js wiring
grep -n "slideConfirmTransfersCheckbox" www/main.js | head -5

# file-source.js gate
grep -n "slideConfirmTransfers" www/input/file-source.js

# Spec file exists and references the pref + modal selector
test -f www/tests/transport/slide-confirm-pref.spec.js
grep -q "slideConfirmTransfers" www/tests/transport/slide-confirm-pref.spec.js
grep -q "#send-modal" www/tests/transport/slide-confirm-pref.spec.js

# Run the spec + existing slide tests that this change touches the surface area of
cd www && npx playwright test tests/transport/slide-confirm-pref.spec.js tests/transport/slide-collisions.spec.js tests/transport/slide-sender.spec.js tests/transport/slide-chip.spec.js --reporter=line
    </automated>
  </verify>
  <done>
    - DEFAULTS.slideConfirmTransfers === true exists in prefs.js (no version bump).
    - #slide-confirm-transfers-checkbox renders inside #settings-slide, between #slide-show-summary-row and #slide-compat-row.
    - main.js boot mirror + change listener + applyPrefs mirror are all present.
    - file-source.js processFiles skips showConfirmModal when getPrefs().slideConfirmTransfers === false.
    - Collisions in the silent path are auto-renamed via applyCollisionRenames (same call as the 'send' action branch).
    - New spec passes: default-ON modal-still-shows; OFF skips modal; OFF auto-renames collisions; checkbox round-trips.
    - Existing slide-collisions / slide-sender / slide-chip Playwright suites stay green.
    - Commit message has no AI attribution.
  </done>
</task>

<!-- =============================================================
     TASK 3 — Fix 3: Forward post-FIN bytes (send + recv symmetric)
     ============================================================= -->
<task type="auto" tdd="true">
  <name>Task 3: Forward post-FIN tail bytes to termRef.feed (send + recv) so trailing terminal text reaches the grid</name>
  <files>
www/transport/slide.js,
www/tests/transport/slide-post-fin-forward.spec.js
  </files>
  <behavior>
    Test cases (encoded in www/tests/transport/slide-post-fin-forward.spec.js):

    - Test 1 — Send mode post-FIN tail: programmatically enter a send session via window.__slide.enterSendMode({ files: [...] }), drive the bot through to STATE_FIN_PENDING, then push a single inbound chunk containing `[CTRL_FIN, ...terminalTextBytes]` (or whatever byte sequence the slide SM accepts to transition FinPending → Done — pull this from the existing slide-sender.spec.js / slide-bridge.spec.js mock helpers; do not invent SM semantics). Assert window.__term.__testGridView (or the equivalent existing test introspection — search slide-recv-e2e.spec.js for the pattern) shows the terminalText after a short await. Assert window.__slide.__getStateForTests().mode === 'terminal' after the chunk.

    - Test 2 — Recv mode post-FIN tail: drive a recv session through to one-frame-from-FIN, then push a chunk containing `[CTRL_FIN, ...terminalTextBytes]`. Same assertion: grid contains terminalText; mode is 'terminal'.

    - Test 3 — No regression on the pre-existing fast path: drive a normal send session through to natural completion where the Z80's CTRL_FIN arrives in its OWN chunk (no trailing text). Assert no spurious bytes reach the terminal grid; mode is 'terminal'.

    - Test 4 — No regression on terminal text that does NOT contain a FIN transition: drive a recv session mid-stream and push `[some_data_bytes]` (no FIN). Existing recv-mode dispatchRecvMode path still consumes the bytes via feed_chunk; no spurious termRef.feed call.

    Run order:
    1. Write spec FIRST (RED — Test 1 / Test 2 will fail because trailing bytes are dropped).
    2. Implement the two slide.js function edits (GREEN).
    3. Re-run; Tests 1 + 2 now pass, Tests 3 + 4 still pass.

    Mock bot helper: slide-sender.spec.js and slide-recv.spec.js both contain helpers for driving the SLIDE SM via window.__mockReaderPush. Reuse them verbatim. DO NOT introduce new wasm bindings or new exported helpers from slide.js — the fix is JS-only inside the existing dispatchSendMode / dispatchRecvMode functions.
  </behavior>
  <action>
**Approach summary (no Rust changes, no new exported symbols):**

The Rust SM at slide/state.rs:347-349 silently drops bytes after STATE_DONE / STATE_ERROR. The JS dispatcher feeds whole chunks via `slide.feed_chunk(value)` — once the SM is Done, the subsequent bytes in the chunk vanish.

Fix is to BYTE-WALK the chunk in JS when the SM is about to transition Done (FinPending in send mode; HeaderPhase-near-FIN in recv mode), capture the byte index at which the transition occurs, then:
  1. Let the existing pump+drain+exit lifecycle run on the bytes UP TO that index.
  2. After exitSendMode / exitRecvMode has flipped mode back to 'terminal', call termRef.feed(tail) with the post-transition bytes.

**Sub-step A — Edit dispatchSendMode in www/transport/slide.js (lines 1333..1339):**

Current implementation:
```js
async function dispatchSendMode(value) {
    feedSlide(value);
    await drainEventsAndOutboundAwaitable();
    pumpNextDataChunkIfReady();
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();
}
```

Replacement:
```js
async function dispatchSendMode(value) {
    // v1.1 polish 260513-grs Task 3 — post-FIN tail forwarding.
    //
    // When the Z80's CTRL_FIN echo lands in the same wire chunk as
    // trailing console text (e.g. slide.com's "Session complete." msg from
    // msg_done_session), the SLIDE SM transitions to Done on the FIN byte
    // and the Rust state.rs:347-349 early-return SILENTLY DROPS every
    // byte after. exitSendMode flips mode back to 'terminal', but those
    // post-FIN bytes are already lost — the user sees the SLIDE chip
    // vanish without the Z80's post-transfer summary ever reaching the
    // terminal.
    //
    // Approach: when the SM is in STATE_FIN_PENDING entering this chunk,
    // feed byte-by-byte and capture the index at which the SM transitions
    // to STATE_DONE. The bytes after that index are the post-FIN tail.
    // After the existing drain/pump/drain/exit cycle has fired, if mode
    // has flipped back to 'terminal' and we have a captured tail, forward
    // it to termRef.feed. For any other entry state, keep the existing
    // single-feed_chunk fast path (the tail-capture overhead is irrelevant
    // for those — Done isn't imminent).
    let postFinTail = null;
    const entryState = slide ? slide.state() : -1;
    if (entryState === STATE_FIN_PENDING) {
        // Walk bytes one at a time; stop feeding the SM the moment it
        // transitions Done so we don't trigger the Rust early-return.
        let doneAt = -1;
        for (let i = 0; i < value.length; i++) {
            slide.feed_byte(value[i]);
            if (slide.state() === STATE_DONE || slide.state() === STATE_ERROR) {
                doneAt = i;
                break;
            }
        }
        if (doneAt >= 0 && doneAt < value.length - 1) {
            postFinTail = value.subarray(doneAt + 1);
        }
        // If the chunk ended without a Done transition (e.g. FIN echo
        // spans chunks), no tail to capture — existing flow handles
        // the next chunk normally.
    } else {
        feedSlide(value);
    }
    await drainEventsAndOutboundAwaitable();
    pumpNextDataChunkIfReady();
    await drainEventsAndOutboundAwaitable();
    maybeExitSendMode();
    // After maybeExitSendMode, if we captured a post-FIN tail and the
    // mode has indeed flipped back to terminal, forward the trailing
    // bytes to the VT52 parser. Defensive mode check: if cancellation
    // or error landed us in a different state, drop the tail (safer
    // than feeding to a half-state terminal).
    if (postFinTail && mode === 'terminal' && postFinTail.length > 0) {
        try {
            termRef.feed(new Uint8Array(postFinTail));
        } catch (e) {
            console.error('[slide.js] post-FIN tail forward (send) threw:', e);
        }
    }
}
```

**Required wasm method**: `slide.feed_byte(b: number): void`. Verify this exists by grepping the wasm-pack output (build artefact in www/pkg/) OR the Rust source. The grep:
```
grep -n "feed_byte" crates/beastty-core/src/slide/*.rs
grep -n "feed_byte" www/pkg/*.d.ts
```

If `feed_byte` does NOT exist as a wasm-exported method, the alternative is to feed_chunk one-byte slices: `slide.feed_chunk(value.subarray(i, i + 1))`. **Do not add a new Rust binding** — zero-Rust invariant. Use feed_chunk(slice) if feed_byte is unavailable.

The Rust SM already has `feed_byte` based on the state.rs reference (line 347 is inside an outer feed_byte-style early-return, and SLIDE-recv tests reference single-byte feeds). Verify before relying on it.

**Sub-step B — Edit dispatchRecvMode in www/transport/slide.js (lines 702..760):**

dispatchRecvMode is more involved because it ALREADY byte-walks `value` for the mid-session ESC^SLIDE wakeup matcher. The post-FIN tail-forward must compose with that walk.

The recv-side pre-FIN transition state (per scope note) is broader than send-mode's STATE_FIN_PENDING — "after the receiver echoes CTRL_FIN, it transitions Done from HeaderPhase on EVT_FIN" (state.rs ~line 609). Safest: capture slide.state() BEFORE each byte; on transition to STATE_DONE / STATE_ERROR while still inside the value loop, capture the remaining tail.

Two implementation options:

  **Option 1 (preferred — preserves the existing structure)**: After the existing wakeup-matcher byte walk completes (line 723) but BEFORE the `// No re-entry — normal recv path.` block at line 756, change the final feedSlide(value) path to a byte-walk that captures the Done transition. Skipped when matchEnd >= 0 because that path has its own re-entry semantics (the new SM after enterRecvMode won't be Done).

  **Option 2 (simpler — replaces feedSlide(value))**: Replace the final block (lines 756..759) with:

```js
    // v1.1 polish 260513-grs Task 3 — recv-side post-FIN tail forward.
    // When the Z80's own CTRL_FIN arrives in the same chunk as trailing
    // terminal text, feed byte-by-byte and capture the tail at the
    // Done transition. State-before-each-byte gating mirrors send-mode
    // dispatchSendMode but for recv side; the pre-FIN state is broader
    // than send (state.rs ~line 609: recv transitions Done from
    // HeaderPhase on EVT_FIN), so the predicate is just "if a Done
    // transition happens mid-chunk, capture the rest".
    let recvPostFinTail = null;
    let doneAt = -1;
    for (let i = 0; i < value.length; i++) {
        const stBefore = slide.state();
        if (stBefore === STATE_DONE || stBefore === STATE_ERROR) {
            // Already Done before this byte — bytes from here on are tail.
            doneAt = i - 1;
            break;
        }
        slide.feed_byte(value[i]);   // OR feed_chunk(value.subarray(i, i+1))
        if (slide.state() === STATE_DONE || slide.state() === STATE_ERROR) {
            doneAt = i;
            // Don't break — drain events for the Done-transition byte
            // first via the existing path. Tail capture happens below.
            // Actually DO break — the post-Done bytes are tail; feeding
            // them would be silently no-op'd anyway (Rust early-return).
            break;
        }
    }
    if (doneAt >= 0 && doneAt < value.length - 1) {
        recvPostFinTail = value.subarray(doneAt + 1);
    }
    drainEventsAndOutboundAwaitable();   // Existing call signature — currently it's drainEventsAndOutbound() in recv path. Use whichever the existing code uses (the file uses drainEventsAndOutbound + maybeExitRecvMode for recv).
    drainEventsAndOutbound();
    maybeExitRecvMode();
    if (recvPostFinTail && mode === 'terminal' && recvPostFinTail.length > 0) {
        try {
            termRef.feed(new Uint8Array(recvPostFinTail));
        } catch (e) {
            console.error('[slide.js] post-FIN tail forward (recv) threw:', e);
        }
    }
    return;
```

(Use the EXISTING function signatures in dispatchRecvMode — the recv path currently calls `feedSlide(value); drainEventsAndOutbound(); maybeExitRecvMode();` synchronously, NOT the awaitable variants. Match the existing style.)

**Sub-step C — Verify feed_byte exists or fall back to feed_chunk slices.**

Before committing the byte-walk approach, run:
```
grep -n "feed_byte\b" www/pkg/*.d.ts www/pkg/*.js 2>/dev/null
```

If `feed_byte` is present in the .d.ts: use it directly.
If not: replace `slide.feed_byte(value[i])` with `slide.feed_chunk(value.subarray(i, i + 1))`. Functionally equivalent (single-byte chunk).

**Sub-step D — Playwright spec (www/tests/transport/slide-post-fin-forward.spec.js):**

Use the helpers in www/tests/transport/slide-sender.spec.js and www/tests/transport/slide-recv.spec.js as the boot/mock-bot scaffold. The key new pieces:

  1. For the send-mode test: drive the bot through to STATE_FIN_PENDING (the existing slide-sender.spec.js's "successful one-file session" path already reaches FinPending — look at how it constructs the final ACK + FIN echo), then in the SAME `window.__mockReaderPush` call concatenate the FIN echo byte + a short ASCII string (e.g. "TX_DONE\r\n"). Use a TextEncoder to build the payload.

  2. For the recv-mode test: mirror slide-recv-e2e.spec.js's "FIN exchange completes" flow but bundle FIN + ASCII trailer in one push.

  3. Assertion target — find the existing test introspection for the terminal grid. Slot-recv-e2e likely uses `window.__term.__getGridForTests()` or similar; mirror that exact accessor.

Three atomic commits OK (slide.js dispatchSendMode → slide.js dispatchRecvMode → spec) OR one combined commit. Recommended single commit:

```
fix(slide): forward post-FIN bytes to terminal parser (send + recv)

When the Z80's CTRL_FIN echo (send) or own CTRL_FIN (recv) arrives in
the same wire chunk as trailing console text, the SLIDE SM transitions
to Done on the FIN byte and Rust state.rs:347-349 silently drops every
subsequent byte. exitSendMode/exitRecvMode flips mode back to terminal
but the post-FIN tail is already gone — user sees the SLIDE chip vanish
without the Z80's post-transfer message reaching the grid.

dispatchSendMode now byte-walks the chunk when entry state is
FinPending, capturing the transition-to-Done index and forwarding
the post-FIN tail to termRef.feed after exitSendMode runs. The
fast path (entry state != FinPending) is unchanged.

dispatchRecvMode now byte-walks the post-wakeup-matcher path with
the same capture logic. The pre-FIN state on recv side is broader
(Done can be entered from HeaderPhase on EVT_FIN per state.rs:609)
so the predicate is just "any transition to Done while bytes remain
in the chunk".

Zero Rust changes (state.rs:347-349 early-return preserved).

Quick fix from .planning/quick/260513-grs.
```
  </action>
  <verify>
    <automated>
# 1. dispatchSendMode contains the byte-walk + postFinTail capture
grep -n "STATE_FIN_PENDING" www/transport/slide.js | grep -v "const STATE_FIN_PENDING"
grep -n "postFinTail" www/transport/slide.js

# 2. dispatchRecvMode forwards a tail
grep -n "recvPostFinTail\|post-FIN" www/transport/slide.js | head -10

# 3. Spec file exists and exercises both paths
test -f www/tests/transport/slide-post-fin-forward.spec.js

# 4. Run the new spec PLUS all the existing SLIDE specs the changes touch
cd www && npx playwright test \
    tests/transport/slide-post-fin-forward.spec.js \
    tests/transport/slide-sender.spec.js \
    tests/transport/slide-chip.spec.js \
    tests/transport/slide-recv.spec.js \
    tests/transport/slide-recv-e2e.spec.js \
    --reporter=line
    </automated>
  </verify>
  <done>
    - dispatchSendMode byte-walks when entry state is STATE_FIN_PENDING and forwards the post-FIN tail to termRef.feed after exitSendMode flips mode.
    - dispatchRecvMode captures any mid-chunk Done transition and forwards the tail after exitRecvMode flips mode.
    - No new Rust bindings; no changes outside www/transport/slide.js + the new spec.
    - New Playwright spec proves both send + recv post-FIN trailing text reaches the grid; the fast-path-no-tail and no-FIN-transition cases continue to behave as before.
    - slide-sender, slide-chip, slide-recv, slide-recv-e2e suites all green.
    - Commit message has no AI attribution.
  </done>
</task>

</tasks>

<verification>
After all three tasks ship:

1. **Playwright regression sweep** — full SLIDE-related subset must stay green:
   ```
   cd www && npx playwright test tests/transport/slide-*.spec.js --reporter=line
   ```
   Specifically must pass: slide-sender, slide-chip, slide-recv, slide-recv-e2e, slide-collisions, slide-prefs, slide-compatibility, slide-autosend-safety, slide-bridge, slide-confirm-pref (NEW), slide-post-fin-forward (NEW).

2. **Manual smoke (out-of-band, recommended)**:
   - Hard-reload Beastty (Ctrl+Shift+R per project memory).
   - Toggle to Clean theme — canvas should be visibly close in size to CRT.
   - Open Settings → SLIDE → see "Confirm file transfers" checkbox, checked by default.
   - Uncheck it; drop a file on the terminal wrapper — transfer should start without modal.
   - Re-check it; drop again — modal appears as before.
   - Connect to a MicroBeast (or the legacy slide.com B:OLDSLIDE.COM target per project memory) and run a SLIDE recv session — the Z80's `Session complete.` text should appear on the grid AFTER the chip exits.

3. **Three atomic commits in git log** — `git log --oneline -5` should show:
   - `fix(clean-theme): bump z=1 render to 1280x768 (CRT parity)`
   - `feat(slide): add "Confirm file transfers" Settings toggle`
   - `fix(slide): forward post-FIN bytes to terminal parser (send + recv)`

   None contain `Co-Authored-By: Claude` or any Claude/Anthropic mention (project memory).
</verification>

<success_criteria>
1. www/renderer/themes.js Clean theme has cellW=16, cellH=32, fontPx=25 (CRT z=1 parity).
2. www/state/prefs.js DEFAULTS contains `slideConfirmTransfers: true` (no CURRENT_VERSION bump).
3. www/index.html #settings-slide block contains a new #slide-confirm-transfers-row between the show-summary and compatibility-mode rows.
4. www/main.js wires boot mirror + change listener + applyPrefs mirror for #slide-confirm-transfers-checkbox.
5. www/input/file-source.js processFiles skips showConfirmModal when getPrefs().slideConfirmTransfers === false; auto-renames collisions silently in that path.
6. www/transport/slide.js dispatchSendMode byte-walks on STATE_FIN_PENDING entry + forwards post-FIN tail to termRef.feed after exitSendMode.
7. www/transport/slide.js dispatchRecvMode captures any mid-chunk Done transition + forwards the tail to termRef.feed after exitRecvMode.
8. Two new Playwright specs (slide-confirm-pref, slide-post-fin-forward) cover the new behaviour and pass.
9. All pre-existing slide-* Playwright suites stay green.
10. Three atomic commits in git history, none with AI attribution.
11. Zero Rust files changed across all three fixes.
</success_criteria>

<output>
After all tasks complete, create `.planning/quick/260513-grs-v1-1-polish-bump-clean-theme-default-zoo/260513-grs-SUMMARY.md` per the GSD summary template, recording:
  - Which three commits shipped (sha + subject).
  - Any deviations from the plan (e.g. feed_byte unavailable → fell back to feed_chunk slices).
  - Final Playwright suite result.
  - Any visual screenshots of Clean theme at the new default size (optional, encouraged).
</output>
