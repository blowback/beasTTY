# Phase 12: SLIDE UX Polish, Docs & Real-Hardware UAT — Pattern Map

**Mapped:** 2026-05-08
**Files analyzed:** 12 (7 modify + 5 create)
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Action | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|--------|------|-----------|----------------|---------------|
| `www/input/file-source.js` | modify | input/module-state | event-driven (drag-drop) + request-response (modal Promise) | (self — extends existing `processFiles` + `showConfirmModal`; analog inside same file: `truncateCpm83` line 395 for pure-helper export shape) | exact (in-place extension) |
| `www/input/selection.js` | modify | input/module-state | event-driven (pointer events) | (self — line 113 `onPointerDown`; cross-module signal pattern from `chrome.js` `[data-focused]`) | exact (in-place 3-line insertion) |
| `www/state/prefs.js` | modify | state/persistence | CRUD (versioned localStorage blob) | (self — extend `DEFAULTS` literal at line 18-33; export `isAutoSendSafe` next to existing pure helpers) | exact (in-place additive extension) |
| `www/transport/slide.js` | modify | transport/dispatcher | event-driven (auto-send at session boundary) | (self — extend `readAutoSendCommandBytes` at line 183-196) | exact (in-place validation gate) |
| `www/renderer/slide-chip.js` | modify | renderer/chip-lifecycle | event-driven (state machine) | (self — add `enterAwaitingConfirm`/`enterFirstUseConfirm` next to `enterAwaitingWakeup` at line 292-317) | exact (state-machine extension) |
| `www/index.html` | modify | markup+CSS | static config | (self — append modal CSS at line 642-728; add validation hint inside `#slide-auto-send-row`) | exact (in-place additive markup+CSS) |
| `README.md` | modify | docs | static markdown | (self — extend "Keyboard shortcuts" at line 37-67; append new "File transfer" section before "Can I run it locally?" at line 88) | exact (in-place text edit) |
| `www/tests/render/selection-drop.spec.js` | create | test/render | request-response (Playwright over DOM+canvas) | `www/tests/render/focus.spec.js` (data-attribute pattern) + `www/tests/session/selection.spec.js` (pointer drag harness + `window.__selection` introspection) | dual analog (best for combined behaviour) |
| `www/tests/transport/slide-collisions.spec.js` | create | test/transport | request-response (Playwright + mock SLIDE bot) | `www/tests/transport/slide-sender.spec.js` (modal flow + `setInputFiles` + button click) — mock-bot setup template per Phase 9 P-04 | exact (same role + data flow) |
| `www/tests/transport/slide-autosend-safety.spec.js` | create | test/transport | request-response (Playwright over Settings input + chip lifecycle) | `www/tests/transport/slide-prefs.spec.js` (Settings pane setup + `localStorage` polling) + `www/tests/transport/slide-chip.spec.js` (`window.__slideChip.__getStateForTests()` introspection) | dual analog (Settings + chip state) |
| `docs/SLIDE_Z80_REQUIREMENT.md` | create | docs | static markdown | `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` (Nygard ADR-style technical narrative; Phase 12 deliverable cross-linked from this ADR's §Consequences) | exact (technical narrative format) |
| `docs/SLIDE-UAT.md` | create | docs | static markdown | `.planning/phases/10-slide-receiver-cancellation/10-HUMAN-UAT.md` (verbatim front-matter + Setup + per-test expected/steps/result format; locked by 12-CONTEXT.md `<canonical_refs>`) | exact (verbatim template) |

## Pattern Assignments

### `www/input/file-source.js` (modify — controller/input + pure helpers)

**Analog:** self (same file). The file already exports `validateCpmFilename` (line 364) and `truncateCpm83` (line 395) as pure helpers; SLIDE-36 adds `computeRenameScheme` next to them in the same idiom. The collision second-pass extends `processFiles` (line 243-274) immediately after the existing validate+truncate loop.

**Existing `processFiles` core pattern** (file-source.js:243-274) — the extension point:
```js
async function processFiles(filesArr) {
    const rows = [];
    const surviving = [];
    for (const f of filesArr) {
        const original = f.name;
        const validation = validateCpmFilename(original);
        if (!validation.ok) {
            rows.push({ kind: 'rejected', original, reason: validation.reason });
            continue;
        }
        const rewritten = truncateCpm83(original);
        const ab = await f.arrayBuffer();
        const bytes = new Uint8Array(ab);
        if (rewritten === original) {
            rows.push({ kind: 'unchanged', original });
        } else {
            rows.push({ kind: 'rewrite', original, rewritten });
        }
        surviving.push({ name: rewritten, bytes });
    }

    // Show modal; await user choice.
    const userConfirmed = await showConfirmModal(rows, surviving);
    if (!userConfirmed) return;

    // Hand off to transport/slide.js.
    if (enterSendModeFn) {
        enterSendModeFn({ files: surviving });
    }
}
```

**Phase 12 SLIDE-36 insertion site:** between the existing `for f of filesArr` loop body (line 264) and the `showConfirmModal` call (line 267). New code:
1. Build `collisionGroups: Map<string, Item[]>` keyed on `item.name.toUpperCase()` (post-truncation).
2. Filter to groups with `length > 1`; produce `collisionRows: { kind: 'collision', base, members, renamed }[]`.
3. Pass `collisionRows` as a third arg to `showConfirmModal`.
4. Switch on the modal's tagged `returnValue` (`'send'` / `'first-only'` / `'refuse'` / falsy) instead of the current boolean.

**Existing pure-helper export shape** (file-source.js:344-410, summary):
```js
// ===== Pure-function exports (testable independently) =====
export function validateCpmFilename(name) {
    if (!name || name.length === 0) return { ok: false, reason: 'empty filename' };
    // ...
}
```

**Phase 12 SLIDE-36 new export — `computeRenameScheme(group)`** mirrors this shape (per 12-RESEARCH.md §Pattern 2):
```js
export function computeRenameScheme(group) {
    if (group.length === 0) return [];
    const first = group[0].name;
    const result = [first];
    const lastDot = first.lastIndexOf('.');
    const baseFull = lastDot < 0 ? first : first.slice(0, lastDot);
    const ext      = lastDot < 0 ? ''    : first.slice(lastDot);
    for (let i = 1; i < group.length; i++) {
        const suffix = String(i);
        const baseLimit = Math.max(0, 8 - suffix.length);
        result.push(baseFull.slice(0, baseLimit) + '~' + suffix + ext);
    }
    return result;
}
```

**Existing modal flow pattern** (file-source.js:317-333) — the extension point for the three-action button row:
```js
return new Promise((resolve) => {
    const onClose = () => {
        modalElRef.removeEventListener('close', onClose);
        const sent = modalElRef.returnValue === 'send';
        if (sent) {
            wrapperElRef?.focus();
        } else {
            topBarSendBtnRef?.focus();
        }
        resolve(sent);
    };
    modalElRef.addEventListener('close', onClose);
    modalElRef.showModal();
    // Initial focus on Cancel button (UI-SPEC §Interaction — safer default).
    cancelBtnRef?.focus();
});
```

**Phase 12 SLIDE-36 modification:**
- `resolve(sent)` → `resolve(modalElRef.returnValue || null)` (tagged result, not boolean)
- `cancelBtnRef?.focus()` → conditional: `(collisionRows.length > 0 ? sendRenamedBtnRef : cancelBtnRef)?.focus()` (per 12-CONTEXT.md D-03 default-focus override + 12-RESEARCH.md §Pitfall 2)

**Existing modal row-builder pattern** (file-source.js:283-303) — the new `'collision'` row kind extension site:
```js
for (const row of rows) {
    const li = document.createElement('li');
    if (row.kind === 'rewrite') {
        li.className = 'rewrite';
        li.appendChild(spanText('•', true));
        li.appendChild(spanText(row.original, false, 'orig'));
        li.appendChild(spanText('→', true));
        li.appendChild(spanText(row.rewritten, false, 'rewritten'));
    } else if (row.kind === 'unchanged') {
        // ...
    } else {
        // rejected
        // ...
    }
    listElRef.appendChild(li);
}
```

**Phase 12 SLIDE-36 new branch** (per 12-UI-SPEC.md §A "Modal `<li class=\"collision\">` row shape"):
```js
} else if (row.kind === 'collision') {
    li.className = 'collision';
    const head = document.createElement('div');
    head.appendChild(spanText('•', true));
    head.appendChild(spanText(row.base, false, 'orig'));
    li.appendChild(head);
    const sub = document.createElement('div');
    sub.className = 'rename-list';
    sub.setAttribute('aria-label', `Renamed to: ${row.renamed.join(', ')}`);
    sub.appendChild(spanText('↳', true));
    sub.appendChild(document.createTextNode(' ' + row.renamed.join(', ')));
    li.appendChild(sub);
}
```

**Caller sites that may need updating:**
- `wireFileSource` opts (line 40-55): may need a new `clearSelectionFn` injection per 12-UI-SPEC.md §SLIDE-12 "Implementation seam" — `file-source.js`'s `onDrop` (line 215-231) calls it after `setDropTarget(false)` to wipe any in-flight pointer-select from `selection.js`. Wired from `www/main.js` boot per the existing Phase 11 D-10 `slideChip` injection precedent.
- `www/main.js` boot — must pass new `clearSelectionFn` (and any new modal button refs `modalSendRenamedBtn`, `modalFirstOnlyBtn`, `modalRefuseBtn`) into `wireFileSource`.

---

### `www/input/selection.js` (modify — input/module-state)

**Analog:** self at line 113. Cross-module signal pattern lifted from `www/renderer/chrome.js` (`[data-focused]`) and `www/renderer/scroll-state.js` (`[data-scrolled-back]`). The setter for `[data-drop-target]` is `file-source.js:233-240` (`setDropTarget`).

**Existing `onPointerDown` pattern** (selection.js:113-146):
```js
function onPointerDown(ev) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    try { canvasRef.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    dragging = true;

    const at = pxToCellWithScrollOffset(ev);
    // ... click-count detection, anchor/focusEnd setup, word/line selection
    notifySelectionChange();
    if (requestFrameFn) requestFrameFn();
}
```

**Existing `[data-drop-target]` setter pattern** (file-source.js:233-240):
```js
function setDropTarget(active) {
    if (!wrapperElRef) return;
    if (active) {
        wrapperElRef.setAttribute('data-drop-target', 'true');
    } else {
        wrapperElRef.removeAttribute('data-drop-target');
    }
}
```

**Phase 12 SLIDE-12 insertion** (3-line early-return between line 114 and 115; reads the wrapper attribute owned by `file-source.js`):
```js
function onPointerDown(ev) {
    if (ev.button !== 0) return;
    // SLIDE-12: drop overlay active → defer to file-source.js drag handlers.
    // canvasRef.parentElement is #terminal-wrapper (the [data-drop-target] owner).
    // Strict equality on the literal string 'true' (Pitfall 4 — null vs 'false' vs missing).
    if (canvasRef.parentElement?.getAttribute('data-drop-target') === 'true') {
        return;
    }
    ev.preventDefault();
    // ... rest unchanged
}
```

**Existing public API** (selection.js:76-85) already exposes `clearSelection`:
```js
return {
    getActiveRange,
    getSelection,
    clearSelection,
    isDragging,
    cancelDrag,
    onSelectionChange,
    dispose,
};
```

The post-drop selection-clear contract (12-UI-SPEC.md §SLIDE-12 "Post-drop selection-clear contract") reuses this existing `clearSelection` export — no new API surface in `selection.js`. The wiring (calling it from `file-source.js:onDrop`) is the only new code, and lives in `file-source.js` per the `clearSelectionFn` injection above.

---

### `www/state/prefs.js` (modify — state/persistence)

**Analog:** self at line 18-33 (`DEFAULTS`). The Phase 6/10/11 progression already added `slideRecvToFolder`, `slideAutoSendCommand`, `slideShowSummary`, `slideCompatibilityMode` keys; SLIDE-38 adds `slideAutoSendCommandConfirmed` next to them. The defensive merge at line 64 (`{ ...DEFAULTS, ...parsed, version: CURRENT_VERSION }`) handles existing-user migration transparently — no migration step needed.

**Existing `DEFAULTS` literal pattern** (prefs.js:18-33):
```js
const DEFAULTS = Object.freeze({
    version: CURRENT_VERSION,
    theme: 'crt',
    // ...
    slideAutoSendCommand: 'B:SLIDE R\r',          // Phase 11 — D-09 (SLIDE-37)
    slideShowSummary: true,                       // Phase 11 — D-09
    slideCompatibilityMode: 'auto',               // Phase 11 — D-09
});
```

**Phase 12 SLIDE-38 new key:**
```js
slideAutoSendCommandConfirmed: '',   // Phase 12 — SLIDE-38: exact-match flag keyed
                                      //   to the value that was last confirmed.
                                      //   Empty string = never confirmed; first-use
                                      //   confirmation chip surfaces when
                                      //   prefs.slideAutoSendCommand !== prefs.slideAutoSendCommandConfirmed
                                      //   AND the value is non-default.
```

(Per 12-UI-SPEC.md §C "First-use-confirm chip lifecycle state" + 12-RESEARCH.md "exact-match flag, keyed to the exact string". Default empty string forces confirmation on the first non-default change.)

**Existing pure-export pattern** — `prefs.js` exports `loadPrefs`, `savePrefs`, `resetPrefs`, `subscribe`, `getPrefs`, `DEFAULTS` (per the file header at line 3). Phase 12 may also add a pure helper `isAutoSendSafe(cmd)` here (per 12-CONTEXT.md Claude's Discretion "validation site" defense-in-depth default), exported alongside the existing API. Source for the regex (per 12-RESEARCH.md §Pitfall 5):
```js
const SAFE_AUTO_SEND_RE = /^[A-Za-z0-9:]*\r$/;

export function isAutoSendSafe(cmd) {
    if (typeof cmd !== 'string') return false;
    if (cmd.length === 0) return true;          // SLIDE-13 disabled sentinel — bypass
    return SAFE_AUTO_SEND_RE.test(cmd);
}
```

**Caller sites:**
- `www/transport/slide.js:188` — uses `isAutoSendSafe(cmd)` at the wire boundary (use-time hard gate).
- `www/main.js` Settings input handler — uses `isAutoSendSafe(input.value + '\r')` to set the `data-invalid` attribute on `#slide-auto-send-input` (visual cue only, does NOT block save per 12-RESEARCH.md §Anti-Patterns).

---

### `www/transport/slide.js` (modify — transport/dispatcher)

**Analog:** self at line 183-196 (`readAutoSendCommandBytes`). The function already reads `prefsRef.slideAutoSendCommand` and treats the empty string as the SLIDE-13 disabled sentinel — Phase 12 SLIDE-38 adds a `isAutoSendSafe(cmd)` gate immediately after the read.

**Existing `readAutoSendCommandBytes` pattern** (slide.js:182-196):
```js
const AUTO_SEND_DEFAULT = 'B:SLIDE R\r';
function readAutoSendCommandBytes() {
    let cmd;
    if (prefsRef) {
        cmd = prefsRef.slideAutoSendCommand;
        if (cmd === undefined || cmd === null) cmd = AUTO_SEND_DEFAULT;
    } else {
        cmd = AUTO_SEND_DEFAULT;
    }
    if (cmd.length === 0) return new Uint8Array(0);
    return new TextEncoder().encode(cmd);
}
```

**Phase 12 SLIDE-38 modification** (per 12-RESEARCH.md §Code Examples lines 683-700):
```js
import { isAutoSendSafe } from '../state/prefs.js';   // NEW import (or inline)
// or define SAFE_AUTO_SEND_RE locally and call inline.

function readAutoSendCommandBytes() {
    let cmd;
    if (prefsRef) {
        cmd = prefsRef.slideAutoSendCommand;
        if (cmd === undefined || cmd === null) cmd = AUTO_SEND_DEFAULT;
    } else {
        cmd = AUTO_SEND_DEFAULT;
    }
    if (cmd.length === 0) return new Uint8Array(0);
    // SLIDE-38 use-time hard gate: validate before placing on the wire.
    // Unsafe values are treated as the SLIDE-13 disabled sentinel.
    if (!isAutoSendSafe(cmd)) {
        // Surface the rejection via the chip + Settings hint (planner wires
        // these signals through wireSlideDispatcher opts or via
        // slideChipRef.flashAutoSendUnsafe()).
        return new Uint8Array(0);
    }
    return new TextEncoder().encode(cmd);
}
```

**First-use confirmation site** (per 12-UI-SPEC.md §C "State transitions: hidden → first-use-confirm: triggered by `enterSendMode` when `prefs.slideAutoSendCommandConfirmed !== prefs.slideAutoSendCommand`"):
- Triggered inside `enterSendMode` (the existing send-mode entry point — `slide.js` line ~378-383 per 09-CONTEXT.md Pitfall 3 reference) BEFORE `pushTxBytes(autoSendBytes)`.
- Calls `slideChipRef.enterFirstUseConfirm({ value: cmd, onConfirm, onReset })` (new chip API — see slide-chip.js below).
- Defers the actual auto-type until the user clicks `[Confirm]`; the confirm callback resumes the existing pre-Phase-12 path.

---

### `www/renderer/slide-chip.js` (modify — renderer/chip-lifecycle)

**Analog:** self at line 292-317 (`enterAwaitingWakeup`). The existing 8-state lifecycle machine (line 40-42) already supports inline buttons via `wireInlineButtons` + `handleInlineAction` (line 263-288). Phase 12 SLIDE-38 adds one new lifecycle state (`first-use-confirm`) and one new `enterFirstUseConfirm` API method, both modeled on `enterAwaitingWakeup`'s shape verbatim.

**Existing lifecycle-state-machine declaration** (slide-chip.js:40-42):
```js
let lifecycle = 'hidden';   // 'hidden' | 'awaiting-wakeup' | 'awaiting-timeout'
                            // | 'active' | 'cancelled-summary' | 'sent-summary'
                            // | 'received-summary' | 'error' | 'drop-rejected-flash'
```

**Phase 12 SLIDE-38 extension:** add `'first-use-confirm'` to the union (one comment-line edit).

**Existing `enterAwaitingWakeup` shape** (slide-chip.js:292-317) — the template for `enterFirstUseConfirm`:
```js
export function enterAwaitingWakeup(opts) {
    clearAutoHide();
    clearWakeupTimer();
    lifecycle = 'awaiting-wakeup';
    samples.length = 0;
    refreshChip();

    if (opts && opts.armTimer === true) {
        wakeupTimeoutHandle = setTimeout(() => {
            wakeupTimeoutHandle = null;
            lifecycle = 'awaiting-timeout';
            refreshChip();
        }, WAKEUP_TIMEOUT_MS);
    }
}
```

**Phase 12 SLIDE-38 new `enterFirstUseConfirm`** mirrors this shape:
```js
const FIRST_USE_CONFIRM_TIMEOUT_MS = 30000;   // per 12-UI-SPEC.md §C — 30s defensive timeout
let firstUseConfirmHandle = null;
let firstUseConfirmCallbacks = null;   // { onConfirm, onReset, value }

export function enterFirstUseConfirm({ value, onConfirm, onReset }) {
    clearAutoHide();
    clearWakeupTimer();
    lifecycle = 'first-use-confirm';
    firstUseConfirmCallbacks = { onConfirm, onReset, value };
    refreshChip();
    firstUseConfirmHandle = setTimeout(() => {
        firstUseConfirmHandle = null;
        firstUseConfirmCallbacks = null;
        hide();
    }, FIRST_USE_CONFIRM_TIMEOUT_MS);
}
```

**Existing inline-button HTML helpers** (slide-chip.js:253-261) — extension point for `[Confirm]` / `[Reset to default]`:
```js
function cancelButtonHtml() {
    return '<button type="button" class="slide-inline" data-action="cancel">[Cancel]</button>';
}
function retryButtonHtml() { /* ... */ }
function forceStartButtonHtml() { /* ... */ }
```

**Phase 12 new helpers:**
```js
function confirmButtonHtml() {
    return '<button type="button" class="slide-inline" data-action="confirm">[Confirm]</button>';
}
function resetButtonHtml() {
    return '<button type="button" class="slide-inline" data-action="reset">[Reset to default]</button>';
}
```

**Existing `handleInlineAction` pattern** (slide-chip.js:277-288) — extension point for the new actions:
```js
function handleInlineAction(action) {
    if (action === 'cancel') {
        if (onCancelFn) try { onCancelFn(); } catch {}
    }
    for (const fn of stateChangeObservers) {
        try { fn({ kind: 'inline-action', action }); } catch {}
    }
}
```

**Phase 12 extension** (call the `firstUseConfirmCallbacks.onConfirm` / `.onReset`):
```js
function handleInlineAction(action) {
    if (action === 'cancel') { /* unchanged */ }
    else if (action === 'confirm' && firstUseConfirmCallbacks) {
        const cb = firstUseConfirmCallbacks;
        firstUseConfirmCallbacks = null;
        clearTimeout(firstUseConfirmHandle); firstUseConfirmHandle = null;
        try { cb.onConfirm?.(); } catch {}
    } else if (action === 'reset' && firstUseConfirmCallbacks) {
        const cb = firstUseConfirmCallbacks;
        firstUseConfirmCallbacks = null;
        clearTimeout(firstUseConfirmHandle); firstUseConfirmHandle = null;
        hide();
        try { cb.onReset?.(); } catch {}
    }
    for (const fn of stateChangeObservers) {
        try { fn({ kind: 'inline-action', action }); } catch {}
    }
}
```

**Public API export** (slide-chip.js:98-110) — add `enterFirstUseConfirm` next to `enterAwaitingWakeup`:
```js
return {
    enterAwaitingWakeup,
    enterFirstUseConfirm,    // NEW Phase 12 SLIDE-38
    enterActive,
    enterCancelledSummary,
    // ... existing
};
```

---

### `www/index.html` (modify — markup+CSS)

**Analog:** self at line 642-728 (`#send-modal` CSS block) for the modal collision row. Self at line ~750-850 (existing `#slide-auto-send-row`) for the validation hint row.

**Existing modal CSS pattern** (index.html:681-689) — the inheritance source for `<li class="collision">`:
```css
#send-modal ul li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--chrome-fg);
}
#send-modal ul li .orig,
#send-modal ul li .rewritten {
  font-family: inherit;
}
#send-modal ul li .reason {
  color: rgba(255, 255, 255, 0.6);
}
```

**Phase 12 SLIDE-36 CSS additions** (per 12-UI-SPEC.md §"CSS additions" lines 426-478, verbatim):
```css
#send-modal ul li.collision {
  flex-direction: column;
  align-items: stretch;
}
#send-modal ul li.collision > div:first-child {
  display: flex;
  gap: 8px;
}
#send-modal ul li.collision > .rename-list {
  margin-left: 24px;
  margin-top: 4px;
}
#send-modal ul li.collision > .rename-list > span[aria-hidden="true"] {
  margin-right: 4px;
}
```

**Existing send-modal `<footer>` markup** (index.html:1014-1015):
```html
<footer>
  <button id="send-modal-cancel" type="button">Don't send</button>
  <button id="send-modal-send" type="button">Send 0 files</button>
</footer>
```

**Phase 12 SLIDE-36 new buttons** (per 12-UI-SPEC.md §B "Modal three-action button row"):
```html
<button id="send-modal-send-renamed" type="button" value="send" hidden>Send 0 renamed</button>
<button id="send-modal-first-only" type="button" value="first-only" hidden>Send only first</button>
<button id="send-modal-refuse" type="button" value="refuse" hidden>Refuse batch</button>
```

(Static markup; toggled `hidden` at runtime by `showConfirmModal` based on `collisionRows.length > 0`. Reuses existing Phase 9 `#send-modal footer button` styles verbatim — gap, padding, focus border. Per 12-UI-SPEC.md §B "Researcher default: single `<footer>`, runtime swap of inner buttons".)

**Existing `#slide-auto-send-row` markup** (Phase 11 — find via Grep `slide-auto-send-row` in index.html). Phase 12 SLIDE-38 adds:
```html
<div class="hint validation-hint" id="slide-auto-send-validation-hint" hidden>
  Auto-send command unsafe — using disabled.
</div>
```

(per 12-UI-SPEC.md §D "Settings auto-send validation hint row")

**Phase 12 SLIDE-38 CSS additions** (per 12-UI-SPEC.md §"CSS additions" lines 463-478):
```css
#slide-auto-send-input[data-invalid="true"] {
  border-color: rgba(255, 255, 255, 0.6);
}
#slide-auto-send-row .validation-hint {
  padding-top: 4px;
}
#slide-auto-send-row .validation-hint[hidden] {
  display: none;
}
```

---

### `README.md` (modify — docs)

**Analog:** self at line 37-67 (existing "Keyboard shortcuts" section) for in-place extension; self at line 88 (before "Can I run it locally?") for the new "File transfer" section append.

**Existing "Keyboard shortcuts" header** (README.md:37-43):
```markdown
## Keyboard shortcuts

All shortcuts are intercepted only when the terminal area has focus. Bare keys
(no modifier listed) encode normally to the host as VT52 bytes — the table only
lists chords and special keys with UI-side meaning.

### UI / clipboard
```

**Existing UI/clipboard table pattern** (README.md:45-53):
```markdown
| Shortcut             | Action                                              |
|----------------------|-----------------------------------------------------|
| Ctrl+Alt+T           | Toggle theme (CRT ↔ Clean)                          |
| Ctrl+= / Ctrl++      | Zoom in (1× → 4×)                                   |
| ...                  | ...                                                 |
```

**Phase 12 SLIDE-41 new "File transfer" section** — append before "Can I run it locally?" at line 88. Mirror the section-+-table idiom verbatim:
```markdown
## File transfer (SLIDE)

BeasTTY supports the SLIDE protocol for sending and receiving files between
your computer and the MicroBeast.

### Sending files (PC → Z80)

Drag files onto the terminal area, or click the `↑ Send file` button in the top
bar. The send modal previews each filename rewritten to CP/M 8.3 form, and lets
you confirm or cancel the batch before the transfer starts.

If two or more files would collide on the Z80 side after 8.3 truncation
(case-insensitive), the modal shows a per-collision-group preview of the
auto-rename scheme (`REPORT.TXT, REPORT~1.TXT, REPORT~2.TXT, …`) and offers
three resolutions: `Send N renamed`, `Send only first`, or `Refuse batch`.

By default BeasTTY auto-types `B:SLIDE R\r` at the Z80 prompt before the
transfer to put the Z80 into receive mode. The auto-send command is
configurable in Settings → SLIDE file transfer; the first time you change it,
a chip prompts you to confirm the new value.

### Receiving files (Z80 → PC)

When the Z80 sends a file via `B:SLIDE S FILE.TXT`, BeasTTY auto-detects the
SLIDE wakeup signature and downloads each file. Settings → SLIDE file transfer
lets you optionally save received files to a chosen folder instead of the
default Downloads tray.

### Cancelling

Press Esc, or click `[Cancel]` on the floating chip, to abort an in-flight
send or receive. The wire returns to a clean CP/M prompt.
```

**Phase 12 SLIDE-41 keyboard-shortcut extensions** — extend the existing UI/clipboard table in place (READIME.md:45-53):
```markdown
| Drag files onto canvas        | Open SLIDE send modal for the dropped files |
| Click ↑ Send file (top bar)   | Open file picker for SLIDE send             |
| Esc (during SLIDE transfer)   | Cancel the in-flight SLIDE send or receive  |
```

(Per 12-CONTEXT.md SLIDE-41 default: "append the new section; extend keyboard shortcuts in place. Existing README is 102 lines — appending keeps the diff minimal." No screenshots unless one image clarifies drag-drop UI; otherwise text-only.)

---

### `www/tests/render/selection-drop.spec.js` (create — Playwright/render)

**Primary analog:** `www/tests/render/focus.spec.js` for the `[data-*]` attribute assertion harness; `www/tests/session/selection.spec.js` for the pointer drag introspection via `window.__selection`.

**Imports + setup pattern** (focus.spec.js:1-7 + selection.spec.js:13-29):
```js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(() => typeof window.__selection === 'object' && window.__selection !== null);
    // Feed default content so the grid has glyphs to potentially select.
    await page.evaluate(() => {
        const bytes = new TextEncoder().encode('hello world\nfoo bar baz');
        window.__term.feed(bytes);
        window.__term.snapshot_grid();
    });
}
```

**Existing data-attribute introspection pattern** (focus.spec.js:21-23):
```js
await wrapper.focus();
await page.waitForTimeout(50);
await expect(wrapper).toHaveAttribute('data-focused', 'true');
```

**Existing pointer-drag harness** (selection.spec.js:42-50):
```js
const { cellW, cellH } = await getCellSize(page);
const canvas = page.locator('#terminal');
const box = await canvas.boundingBox();
const yMid = box.y + cellH / 2;
await page.mouse.move(box.x + cellW / 2, yMid);
await page.mouse.down();
await page.mouse.move(box.x + cellW * 5 + cellW / 2, yMid);
await page.mouse.up();
const sel = await page.evaluate(() => window.__selection.getSelection());
expect(sel).not.toBeNull();
```

**Existing data-attribute toggle from JS** (file-source.spec.js:42-48 — DataTransfer pattern for setting `[data-drop-target]`):
```js
await page.evaluate(({ ev, name, content }) => {
    const dt = new DataTransfer();
    const file = new File([content], name, { type: 'text/plain' });
    dt.items.add(file);
    const e = new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt });
    document.getElementById('terminal-wrapper').dispatchEvent(e);
}, { ev: 'dragenter', name: 'a.txt', content: 'a' });
```

**Phase 12 SLIDE-12 three tests** (per 12-UI-SPEC.md §SLIDE-12 "Test contract"):

| Test | Pattern source | Behaviour asserted |
|------|----------------|--------------------|
| `pointerdown does not start selection while drop overlay active` | focus.spec.js attr-set + selection.spec.js drag harness | Set `[data-drop-target]="true"` programmatically (or via `dragenter`); fire `pointerdown` on canvas; assert `window.__selection.getSelection()` is null. |
| `pointerdown starts selection normally when drop overlay inactive` | selection.spec.js drag harness verbatim | Without `[data-drop-target]`, drag-and-release; assert selection bounds present (Phase 6 regression). |
| `drop event clears any in-flight pointer-select bounds` | file-source.spec.js drag-fire harness + selection.spec.js post-drag introspection | Start a pointer-down + pointer-move (selection in flight); fire synthetic `dragenter` + `drop` with files; assert `window.__selection.getSelection()` returns null. |

---

### `www/tests/transport/slide-collisions.spec.js` (create — Playwright/transport)

**Analog:** `www/tests/transport/slide-sender.spec.js` for the modal flow + `setInputFiles` harness + mock-bot setup. The Phase 9 P-04 setup template is the canonical reference (referenced verbatim by `slide-recv.spec.js` line 10).

**Imports + setup pattern** (slide-sender.spec.js:19-30):
```js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.addInitScript(MOCK_SERIAL_SLIDE_BOT);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#connection').evaluate((el) => { el.open = true; });
}
```

**Existing per-test reset pattern** (slide-sender.spec.js:34-52):
```js
test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.locator('#connect-button').click();
    await expect.poll(
        () => page.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
    await page.evaluate(() => {
        window.__slide.__resetForTests();
        window.__fileSource.__resetForTests();
        window.__mockWriterLog.length = 0;
        window.__mockSlideBot.reset();
    });
});
```

**Existing multi-file `setInputFiles` pattern** (slide-sender.spec.js:58-72):
```js
const content = 'Hello SLIDE!';
await page.setInputFiles('#send-file-input', {
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
});
await expect(page.locator('#send-modal')).toBeVisible();
await expect(page.locator('#send-modal-title')).toHaveText('Sending 1 file via SLIDE');
await expect(page.locator('#send-modal-list li').first()).toContainText('hello.txt');
```

**Phase 12 SLIDE-36 multi-file collision setup** (extend `setInputFiles` to an array of files):
```js
await page.setInputFiles('#send-file-input', [
    { name: 'report.txt',  mimeType: 'text/plain', buffer: Buffer.from('a') },
    { name: 'REPORT.TXT',  mimeType: 'text/plain', buffer: Buffer.from('b') },
    { name: 'longname1.txt', mimeType: 'text/plain', buffer: Buffer.from('c') },
    { name: 'longname2.txt', mimeType: 'text/plain', buffer: Buffer.from('d') },
]);
```

**Existing modal-button assertion pattern** (slide-sender.spec.js:69-71):
```js
await expect(page.locator('#send-modal-send')).toHaveText('Send 1 file');
await expect(page.locator('#send-modal-send')).toBeEnabled();
```

**Phase 12 SLIDE-36 modal three-button assertions** (per 12-UI-SPEC.md §B):
```js
await expect(page.locator('#send-modal-send-renamed')).toHaveText('Send 4 renamed');
await expect(page.locator('#send-modal-send-renamed')).toBeVisible();
await expect(page.locator('#send-modal-first-only')).toBeVisible();
await expect(page.locator('#send-modal-refuse')).toBeVisible();
// Default focus override (CONTEXT D-03):
await expect(page.locator('#send-modal-send-renamed')).toBeFocused();
// Phase 9 buttons hidden in collisions-present mode:
await expect(page.locator('#send-modal-cancel')).toBeHidden();
await expect(page.locator('#send-modal-send')).toBeHidden();
```

**Existing pure-helper test pattern** — the file-source.spec.js (input-namespace) does pure-helper unit tests via `page.evaluate(import('...'))`. For `computeRenameScheme` Phase 12 should add helper unit tests in this same idiom OR within the collision spec file itself.

**Phase 12 SLIDE-36 8 tests** (per Phase 12 plan target — collisions detection, rename scheme determinism per D-04, modal flow per D-06):
1. case-insensitive collision detection (`report.txt` + `REPORT.TXT`)
2. 8.3-truncation collision detection (`longname1.txt` + `longname2.txt`)
3. mixed-case + extension collision detection (`a.txt` + `a.TXT`)
4. `[Send N renamed]` resolution applies rename scheme to surviving array
5. `[Send only first]` resolution drops K-1 files per group
6. `[Refuse batch]` resolution returns early (no enterSendMode call; verify via `__mockWriterLog.length === 0`)
7. `computeRenameScheme` 12-collision case (base `REPORT` shrinks 6→5 once N hits 2 digits)
8. `computeRenameScheme` 100-collision case (base `LONGNAME` shrinks 8→7→6 as N grows)

---

### `www/tests/transport/slide-autosend-safety.spec.js` (create — Playwright/transport)

**Dual analog:**
- **Settings persistence + input change pattern** — `www/tests/transport/slide-prefs.spec.js` (Settings panel setup at line 26-33; `localStorage` polling at line 91-105).
- **Chip lifecycle introspection** — `www/tests/transport/slide-chip.spec.js` (`window.__slideChip.__getStateForTests()` polling at line 90-93).

**Imports + setup pattern** (slide-prefs.spec.js:23-33):
```js
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.locator('#settings').evaluate((el) => { el.open = true; });
    await page.locator('#settings-slide').evaluate((el) => { el.open = true; });
}
```

**Existing input-change persistence-poll pattern** (slide-prefs.spec.js:91-105):
```js
test('typing + change event persists slideAutoSendCommand to localStorage with trailing \\r', async ({ page }) => {
    await setup(page);
    await page.locator('#slide-auto-send-input').fill('A:RUN PROG.COM');
    await page.locator('#slide-auto-send-input').dispatchEvent('change');
    await expect.poll(
        () => page.evaluate(() => {
            const raw = localStorage.getItem('beastty.prefs');
            if (!raw) return null;
            try { return JSON.parse(raw).slideAutoSendCommand; } catch { return null; }
        }),
        { timeout: 2000 },
    ).toBe('A:RUN PROG.COM\r');
});
```

**Existing chip lifecycle poll pattern** (slide-chip.spec.js:90-93):
```js
await expect.poll(
    () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
    { timeout: 8000 },
).toBe('active');
```

**Phase 12 SLIDE-38 15 tests** (regex coverage + use-time gate + first-use confirm chip + Settings hint visibility):

Per 12-RESEARCH.md §Pitfall 5 the regex must pass `''` (disabled), `'\r'`, `'B:SLIDE R\r'`, `'A:SLIDE R\r'`, `'B:DIR\r'` and reject `'B:SLIDE R'` (no CR), `'B:SLIDE R\n'` (LF), `'B:SLIDE R; rm -rf /\r'`, `'B:SLIDE R\rB:DIR\r'`. Plus first-use-confirm chip transitions per 12-UI-SPEC.md §C: `hidden → first-use-confirm` on `enterSendMode` when `slideAutoSendCommand !== slideAutoSendCommandConfirmed`; `first-use-confirm → awaiting-wakeup` on `[Confirm]`; `first-use-confirm → hidden` on `[Reset to default]`. Plus the 30 s defensive timeout.

Suggested 15-test layout (planner discretion):
1. `isAutoSendSafe('')` returns true (SLIDE-13 disabled sentinel) — pure helper
2. `isAutoSendSafe('B:SLIDE R\r')` returns true (default)
3. `isAutoSendSafe('A:SLIDE R\r')` returns true (drive switch)
4. `isAutoSendSafe('B:DIR\r')` returns true (alternate command)
5. `isAutoSendSafe('B:SLIDE R')` returns false (missing CR)
6. `isAutoSendSafe('B:SLIDE R\n')` returns false (LF instead of CR)
7. `isAutoSendSafe('B:SLIDE R; rm -rf /\r')` returns false (semicolon)
8. `isAutoSendSafe('B:SLIDE R\rB:DIR\r')` returns false (multiple CRs)
9. Settings input invalid value sets `[data-invalid="true"]` on `#slide-auto-send-input`
10. Settings input invalid value still persists to localStorage (save-time NOT blocked)
11. `#slide-auto-send-validation-hint` visible after use-time validation fails
12. Use-time gate: `enterSendMode` with unsafe value → no auto-type bytes on `__mockWriterLog`
13. First-use-confirm chip: `enterSendMode` with non-default value → chip lifecycle = `'first-use-confirm'`
14. First-use-confirm chip `[Confirm]` → lifecycle transitions to `'awaiting-wakeup'` + `slideAutoSendCommandConfirmed` saved to localStorage
15. First-use-confirm chip `[Reset to default]` → lifecycle = `'hidden'` + `slideAutoSendCommand` reset to `'B:SLIDE R\r'`

---

### `docs/SLIDE_Z80_REQUIREMENT.md` (create — markdown)

**Analog:** `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — the Nygard-style ADR with §Context / §Decision / §Consequences / §Rejected Alternatives / §Cross-link / §References. ADR-003 is also the cited authority that this new doc references.

**Existing ADR header pattern** (ADR-003 lines 1-8):
```markdown
# ADR-003: SLIDE v0.2.1 CAN-Bidirectional Amendment

**Status:** Accepted
**Date:** 2026-05-06
**Phase:** 07-slide-rust-core-framer-crc-state-machine
**Deciders:** ant (project author)

## Context
```

**Phase 12 SLIDE-40 doc — apply the same Nygard structure**, but framed as a Z80-firmware-author requirements doc (not an internal ADR). Sections per 12-CONTEXT.md SLIDE-40 outline + 12-UI-SPEC.md is silent (markdown):

```markdown
# SLIDE — Z80-side requirements for Beastty

**Status:** Pending upstream merge (see §Upstream patch below)
**Date:** 2026-05-08
**Audience:** Z80 firmware authors maintaining slide.com on the MicroBeast,
              and Beastty users running the SLIDE protocol against patched
              MicroBeast firmware.

## Wakeup signature: ESC ^ S L I D E

Beastty enters SLIDE recv mode only after detecting the 7-byte signature
`ESC ^ S L I D E` (`0x1B 0x5E 0x53 0x4C 0x49 0x44 0x45`) on the inbound serial
stream. Pre-v0.2.1 slide.com does not emit this prefix; modern slide.com
(post-PR) does.

## v0.2.1 amendment: bidirectional CTRL_CAN echo

Per ADR-003 (`.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md`):
either side may initiate `CTRL_CAN` (raw byte `0x18`); the other side MUST
echo `CTRL_CAN` back within ~500 ms. Both sides then drain the wire and
return to idle. The amendment makes CAN symmetric; previously only the
receiver could emit it.

[Cite ADR-003 §Decision points 1-4 verbatim or by reference.]

## Send command convention: B:SLIDE R

Beastty's default auto-send command is `B:SLIDE R\r` — drive `B:`, command
`SLIDE`, mode `R` (receive). The Z80 must accept this at the CP/M prompt
and enter SLIDE receive mode within ~250 ms (Beastty's wakeup-detection
window).

## Upstream patch

The Z80-side patch implementing items 1-2 above is tracked at
`github.com/blowback/slide`. **Status: pending upstream merge.** Until
the patch lands, Beastty's `Compatibility mode` Settings option (default
`auto`) provides a 3-second wakeup-timeout fallback path for stock
slide.com (per Phase 11 D-15).

## Cross-link

- `.planning/decisions/ADR-003-slide-v0-2-1-can-amendment.md` — protocol authority
- `/home/ant/src/microbeast/SLIDE/SPEC-v0.2.md` — base v0.2 spec
- `github.com/blowback/slide` — upstream Z80 reference impl
```

(Per 12-CONTEXT.md SLIDE-40 default: "brief — protocol amendment summary + B:SLIDE R + link to upstream PR; no inlined diff. Coordinate with the PR landing status — if the PR isn't merged by Phase 12 plan time, mark the doc with a 'Status: pending upstream merge' banner". Per 12-RESEARCH.md §Pitfall 7: do not hardcode a PR # — link to repo root and use prose.)

---

### `docs/SLIDE-UAT.md` (create — markdown UAT template)

**Analog:** `.planning/phases/10-slide-receiver-cancellation/10-HUMAN-UAT.md` — verbatim format template per 12-CONTEXT.md `<canonical_refs>`. Front-matter + Setup + per-test `expected:` / `steps:` / `result:` rows + Summary + Sign-off + Gaps.

**Existing front-matter pattern** (10-HUMAN-UAT.md:1-7):
```markdown
---
status: partial
phase: 10-slide-receiver-cancellation
source: [10-VALIDATION.md, 10-CONTEXT.md, 10-UI-SPEC.md, 10-RESEARCH.md]
started: 2026-05-08
updated: 2026-05-08
---

# Phase 10 — Daily-Driver Human UAT
```

**Phase 12 front-matter:**
```markdown
---
status: pending
phase: 12-slide-ux-polish-docs-real-hardware-uat
source: [12-CONTEXT.md, 12-RESEARCH.md, 12-UI-SPEC.md]
started: 2026-05-08
updated: 2026-05-08
---

# SLIDE — Real-hardware UAT (Phase 12 SLIDE-42)
```

**Existing Setup pattern** (10-HUMAN-UAT.md:21-29):
```markdown
## Setup

- Fresh Chromium tab; localhost dev server running (`scripts/dev.sh`).
- DevTools open; clear console.
- (Optional but recommended) MicroBeast hardware connected for the
  real-hardware UAT-10-01 + UAT-10-05.
```

**Phase 12 Setup** — adapt: explicit MicroBeast hardware connection required (not optional); slide.com on the Z80 must be the patched (post-PR) build.

**Existing per-test pattern** (10-HUMAN-UAT.md:32-49 — UAT-10-01 verbatim):
```markdown
### UAT-10-01: Real-hardware Z80 cancel echo timing (SLIDE-27)

**expected:** Pressing Esc mid-recv on a real MicroBeast Z80 produces a
visible canvas-unfreeze within 2 s, ...
**steps:**
1. Connect to MicroBeast at 19200 8N1.
2. From the MicroBeast prompt, run `B:SLIDE S BIGFILE.BIN` ...
3. As soon as the canvas shows the recv chip ...
4. Observe: ...
**result:** blocked (Z80 SLIDE.COM does not yet implement the v0.2.1 ADR-003 ESC^SLIDE wakeup + CTRL_CAN echo amendment; PR to github.com/blowback/slide is a Phase 12 deliverable per REQUIREMENTS.md SLIDE-40. Re-run after the patched slide.asm lands.)
```

**Phase 12 SLIDE-42 four tests** (per 12-CONTEXT.md `<specifics>` §"`docs/SLIDE-UAT.md` test outline"):
- **UAT-12-01:** Multi-file send including binary `.COM`
- **UAT-12-02:** Multi-file recv including zero-byte file
- **UAT-12-03:** Cancel mid-send (PC-initiated)
- **UAT-12-04:** Cancel mid-recv (PC-initiated; Z80 echo verified) — inherits UAT-10-01's `result: blocked` until upstream patch lands.

**Existing Summary pattern** (10-HUMAN-UAT.md:152-159):
```markdown
## Summary

total: 6
passed: 3
issues: 0
pending: 0
skipped: 2
blocked: 1
```

**Existing Sign-off pattern** (10-HUMAN-UAT.md:161-166):
```markdown
## Sign-off

- Tester: ant
- Date: 2026-05-08
- Pass count: ...
- Notes: ...
```

(Per 12-RESEARCH.md §Pitfall 8: "Lock to 4 tests... All other manual-test flows already live in 06-HUMAN-UAT.md and 10-HUMAN-UAT.md." Doc length target: ~150 lines max.)

---

## Shared Patterns

### Pattern A: `[data-*]` attribute as cross-module signal

**Source:** `www/renderer/chrome.js` (`[data-focused]`), `www/renderer/scroll-state.js` (`[data-scrolled-back]`), `www/input/file-source.js:233-240` (`[data-drop-target]`).

**Apply to:** Phase 12 SLIDE-12 (selection.js reads `[data-drop-target]`), Phase 12 SLIDE-38 (Settings input gets `[data-invalid]`).

**Setter excerpt** (file-source.js:233-240):
```js
function setDropTarget(active) {
    if (!wrapperElRef) return;
    if (active) {
        wrapperElRef.setAttribute('data-drop-target', 'true');
    } else {
        wrapperElRef.removeAttribute('data-drop-target');
    }
}
```

**Reader excerpt** (Phase 12 SLIDE-12 insertion in selection.js:113):
```js
if (canvasRef.parentElement?.getAttribute('data-drop-target') === 'true') {
    return;
}
```

**Strict-equality requirement:** `=== 'true'` (NOT `!== 'false'`, NOT `hasAttribute(…)`). Per 12-RESEARCH.md §Pitfall 4 — `getAttribute` returns `null` for missing attributes; only `=== 'true'` is contract-aligned with the setter.

### Pattern B: Pure-function exports for testability

**Source:** `www/input/file-source.js:344-410` (`validateCpmFilename`, `truncateCpm83`, `packSendMetadata` exported alongside `wireFileSource`); `www/state/prefs.js` (`loadPrefs`, `getPrefs`, `DEFAULTS` exported alongside `subscribe`).

**Apply to:** Phase 12 SLIDE-36 (`computeRenameScheme` in file-source.js); Phase 12 SLIDE-38 (`isAutoSendSafe` in prefs.js or as a local module helper in slide.js).

**Excerpt** (file-source.js:364-378):
```js
export function validateCpmFilename(name) {
    if (!name || name.length === 0) return { ok: false, reason: 'empty filename' };
    if (name.startsWith('.')) return { ok: false, reason: 'leading-dot dotfile' };
    for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        if (c < 0x20) return { ok: false, reason: `control character 0x${c.toString(16).padStart(2, '0')}` };
        // ...
    }
    return { ok: true, reason: null };
}
```

### Pattern C: Modal `returnValue`-driven flow

**Source:** `www/input/file-source.js:317-333` (Phase 9 `showConfirmModal`).

**Apply to:** Phase 12 SLIDE-36 — extend the boolean `userConfirmed` resolution to a tagged `'send' | 'first-only' | 'refuse' | null` resolution; reuse the same `<dialog>` close-event plumbing.

**Excerpt** (file-source.js:317-333):
```js
return new Promise((resolve) => {
    const onClose = () => {
        modalElRef.removeEventListener('close', onClose);
        const sent = modalElRef.returnValue === 'send';
        if (sent) wrapperElRef?.focus();
        else topBarSendBtnRef?.focus();
        resolve(sent);
    };
    modalElRef.addEventListener('close', onClose);
    modalElRef.showModal();
    cancelBtnRef?.focus();
});
```

**Phase 12 transformation:** `resolve(sent)` → `resolve(modalElRef.returnValue || null)`; default-focus computed from `collisionRows.length > 0`.

### Pattern D: Module-scope state with `wireXxx({...})` initializer

**Source:** `www/input/paste-pump.js`, `www/renderer/scroll-state.js`, `www/transport/slide.js`, `www/input/file-source.js:39-69`, `www/renderer/slide-chip.js:78-97`.

**Apply to:** Phase 12 SLIDE-38 — `slide-chip.js` `enterFirstUseConfirm` lifecycle state extension; Phase 12 SLIDE-12 — `file-source.js` adds `clearSelectionFn` injection through existing `wireFileSource(opts)`.

**Excerpt** (slide-chip.js:78-97 — wireSlideChip pattern):
```js
export function wireSlideChip(opts) {
    const { chipEl, chipTextEl, getSlideState, onCancel, prefs } = opts;
    chipElRef = chipEl;
    chipTextElRef = chipTextEl;
    getSlideStateFn = getSlideState;
    onCancelFn = onCancel;
    prefsRef = prefs;
    // ...
    return {
        enterAwaitingWakeup,
        enterActive,
        // ... + Phase 12 enterFirstUseConfirm
    };
}
```

### Pattern E: Mock-bot Playwright integration test setup

**Source:** `www/tests/transport/slide-sender.spec.js:19-52` (canonical Phase 9 P-04 template); reused verbatim by `slide-recv.spec.js`, `slide-chip.spec.js`, `slide-bridge.spec.js`, `slide-cancel.spec.js`.

**Apply to:** `www/tests/transport/slide-collisions.spec.js`, `www/tests/transport/slide-autosend-safety.spec.js`.

**Self-contained file rule** (per slide-bridge.spec.js:30-31): "Helpers (setup / commonReset / enterMidStream) copied verbatim from `slide-cancel.spec.js`... do NOT cross-import — keep each spec file self-contained." Phase 12 specs follow the same convention — copy `setup` / per-test reset bodies into each new spec file.

### Pattern F: Window introspection hook for test assertions

**Source:** `window.__selection`, `window.__slideChip.__getStateForTests()`, `window.__slide.__getStateForTests()`, `window.__mockWriterLog`, `window.__sessionLog`, `window.__pastePump`, `window.__fileSource.__resetForTests()`.

**Apply to:** Phase 12 SLIDE-12 (`window.__selection.getSelection()`); Phase 12 SLIDE-38 (`window.__slideChip.__getStateForTests().lifecycle === 'first-use-confirm'`); Phase 12 SLIDE-36 (`window.__mockWriterLog` to verify `enterSendMode` call gating per `[Refuse batch]`).

**Excerpt** (slide-chip.spec.js:90-93):
```js
await expect.poll(
    () => page.evaluate(() => window.__slideChip.__getStateForTests().lifecycle),
    { timeout: 8000 },
).toBe('active');
```

(For Phase 12 SLIDE-38 chip-state introspection, confirm `__getStateForTests()` returns `lifecycle` including the new `'first-use-confirm'` value — slide-chip.js __getStateForTests must be extended to surface it.)

## No Analog Found

(none — every Phase 12 deliverable has a strong existing-code analog in the codebase. Phase 12 is a polish phase: SLIDE-12 is a 3-line in-place insertion; SLIDE-36 extends an existing modal flow; SLIDE-38 extends an existing chip lifecycle state machine; SLIDE-40/41/42 mirror existing markdown templates verbatim.)

## Metadata

**Analog search scope:**
- `www/input/` (file-source, selection, paste-pump)
- `www/transport/` (slide, slide-recv, serial)
- `www/renderer/` (slide-chip, scroll-state, chrome)
- `www/state/` (prefs)
- `www/tests/transport/` (slide-sender, slide-prefs, slide-chip, slide-bridge, slide-recv, slide-cancel)
- `www/tests/render/` (focus, cursor)
- `www/tests/session/` (selection)
- `www/tests/input/` (file-source)
- `.planning/decisions/` (ADR-003)
- `.planning/phases/10-slide-receiver-cancellation/` (10-HUMAN-UAT.md)
- `README.md`

**Files scanned:** ~25 source/test files plus 2 docs templates.

**Pattern extraction date:** 2026-05-08

## PATTERN MAPPING COMPLETE
