// Beastty Phase 6 Plan 04 (Wave 3) — pointer drag-select state machine.
//
// Public API: wireSelection, getActiveRange, getSelection, clearSelection,
//             isDragging, cancelDrag, onSelectionChange, onSelectionDragState.
//
// Sources:
//   - 06-CONTEXT.md D-16..D-20.
//   - 06-RESEARCH.md §Pattern 2 + §Code Examples 1271-1306.
//   - 06-PATTERNS.md §"www/input/selection.js" (verbatim handler shapes).
//   - 06-RESEARCH.md §Pitfall 4 + §Pitfall 7 — endpoint coords MUST be
//     scrollback-tail-relative (rowOffsetFromTail, col) so they stay stable
//     when scrollback grows mid-drag.

// readRowText is injected via wireSelection({ readRow }) — keeps selection.js
// importable from canvas.js (canvas.js imports selectionGetActiveRange) without
// creating a circular import. canvas.js owns gridView so it owns readRowText.
let readRowText = null;

// --- Module-scope state --------------------------------------------------

let anchor = null;            // { rowOffsetFromTail, col }
let focusEnd = null;          // { rowOffsetFromTail, col }
let dragging = false;
let lastClickTs = 0;
let lastClickCol = -1;
let lastClickRow = -1;
let clickCount = 0;

// S9.3 (E9 FR-4) — drag-origination state. A pointerdown INSIDE the committed
// selection arms a native HTML5 drag instead of restarting selection. The text
// is read at dragstart: both D-19 clear triggers (wrapper blur, scroll) are
// suppressed while a drag is pending/active, so the selection is guaranteed
// alive until then — and a plain click-to-deselect never pays for a
// getSelection() walk it would only throw away.
let dragPending = false;      // origination branch entered; dragstart not yet fired
let dragActive = false;       // native drag in flight (dragstart fired, dragend pending)
let dragText = '';            // selection text stashed at dragstart
let dragImageEl = null;       // persistent 1×1 transparent setDragImage target

const selectionObservers = [];
const selectionDragObservers = [];

// --- Injected deps -------------------------------------------------------

let canvasRef = null;
let scrollStateRef = null;
let termRef = null;
let getCellWFn = null;
let getCellHFn = null;
let requestFrameFn = null;
let unsubscribeScroll = null;
// E11 S11.3 — the beast-to-beast drag stamp. OPTIONAL: absent means stamp
// nothing, which is exactly the pre-E11 drag. Injected from main.js (AD-3);
// selection.js imports nothing new and knows nothing about sessions, nonces or
// peers — it asks for a payload and sets it if it gets one.
let getPeerStampFn = null;

const WORD_REGEX = /\S+/;       // CONTEXT D-16 + Claude's Discretion — whitespace-bounded run

// --- Public wire entry ---------------------------------------------------

export function wireSelection(opts) {
    const { canvas, scrollState, term, requestFrame, getCellW, getCellH, terminalWrapper, readRow, getPeerStamp } = opts;
    canvasRef = canvas;
    scrollStateRef = scrollState;
    termRef = term;
    requestFrameFn = requestFrame;
    getCellWFn = getCellW;
    getCellHFn = getCellH;
    readRowText = readRow;
    getPeerStampFn = typeof getPeerStamp === 'function' ? getPeerStamp : null;   // E11 S11.3

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('lostpointercapture', onLostPointerCapture);
    // S9.3 — native drag hooks for the origination branch in onPointerDown.
    canvas.addEventListener('dragstart', onDragStart);
    canvas.addEventListener('dragend', onDragEnd);

    // S9.3 — persistent 1×1 transparent drag-image target. Without it the
    // default drag image for a canvas-originated drag is the rendered canvas —
    // an 80×24 screenshot glued to the cursor. Must be in the DOM and rendered
    // (Chromium ignores display:none / detached elements), so park it off-screen.
    if (!dragImageEl) {
        dragImageEl = document.createElement('div');
        dragImageEl.style.cssText = 'position:fixed;top:-10px;left:-10px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(dragImageEl);
    }

    // D-19 — selection clears on any scroll AFTER the drag completes.
    // While dragging, the auto-scroll branch in onPointerMove still extends
    // the selection naturally (the scroll handler fires inside the drag).
    // S9.3: also skipped while a selection drag is pending/active — a wheel
    // notch between arming and dragstart must not destroy the drag's payload
    // (mirrors the blur guard below).
    unsubscribeScroll = scrollState.onChange(() => {
        if (!dragging && !dragPending && !dragActive && (anchor || focusEnd)) {
            clearSelection();
        }
    });

    // D-19 — selection clears on focus loss on #terminal-wrapper. S9.3: skipped
    // while a selection drag is pending/active — the origination branch skips
    // preventDefault, so the mousedown itself blurs the wrapper, and clearing
    // here would destroy the drag's own payload before dragstart fires.
    if (terminalWrapper) {
        terminalWrapper.addEventListener('blur', () => {
            if (dragPending || dragActive) return;
            if (anchor || focusEnd) clearSelection();
        });
    }

    return {
        getActiveRange,
        getSelection,
        clearSelection,
        isDragging,
        cancelDrag,
        onSelectionChange,
        onSelectionDragState,
        dispose,
    };
}

// --- Px-to-cell conversion (Pitfall 4 + 7 — tail-relative storage) -----

function pxToCellWithScrollOffset(ev) {
    const r = canvasRef.getBoundingClientRect();
    const cellW = getCellWFn();
    const cellH = getCellHFn();
    const cols = termRef.cols();
    const visibleRows = termRef.rows();
    // Clamp the cursor to the visible row range so a drag past the bottom
    // does not produce a negative tail offset.
    const yClamped = Math.max(0, Math.min(ev.clientY - r.top, visibleRows * cellH - 1));
    const xClamped = Math.max(0, Math.min(ev.clientX - r.left, cols * cellW - 1));
    const visibleRow = Math.floor(yClamped / cellH);
    const col = Math.floor(xClamped / cellW);
    // Tail-relative: visibleRow == (visibleRows - 1) => 0 + scrollOffset.
    // Newer rows (smaller offset) are toward the bottom of the viewport.
    const offset = scrollStateRef.getOffset();
    const rowOffsetFromTail = (visibleRows - 1 - visibleRow) + offset;
    return {
        rowOffsetFromTail: Math.max(0, rowOffsetFromTail),
        col: Math.max(0, Math.min(col, cols - 1)),
    };
}

// --- Endpoint normalization (shared) --------------------------------------

// Normalize anchor/focusEnd into {start, end}: start is the older row (larger
// rowOffsetFromTail), or the smaller col on the same row. Single source for
// isCellInSelection, getActiveRange, and getSelection — the three must agree
// or the drag hit-test diverges from the rendered highlight.
function normalizedEndpoints() {
    if (!anchor || !focusEnd) return null;
    const a = anchor;
    const f = focusEnd;
    const aIsStart = (a.rowOffsetFromTail > f.rowOffsetFromTail)
                  || (a.rowOffsetFromTail === f.rowOffsetFromTail && a.col <= f.col);
    return { start: aIsStart ? a : f, end: aIsStart ? f : a };
}

// --- S9.3 drag-origination hit test --------------------------------------

// Is `at` inside the committed selection? Tests against the walked-range
// semantics: middle rows count full-width, end rows clip at start.col/end.col
// (same-row: min/max cols).
function isCellInSelection(at) {
    const range = normalizedEndpoints();
    if (!range) return false;
    const { start, end } = range;
    // Rows walk top (older, larger offset) → bottom (newer, smaller offset).
    if (at.rowOffsetFromTail > start.rowOffsetFromTail
            || at.rowOffsetFromTail < end.rowOffsetFromTail) {
        return false;
    }
    if (start.rowOffsetFromTail === end.rowOffsetFromTail) {
        return at.col >= Math.min(start.col, end.col)
            && at.col <= Math.max(start.col, end.col);
    }
    if (at.rowOffsetFromTail === start.rowOffsetFromTail) return at.col >= start.col;
    if (at.rowOffsetFromTail === end.rowOffsetFromTail) return at.col <= end.col;
    return true;   // middle rows count full-width
}

// --- Pointer event handlers ----------------------------------------------

function onPointerDown(ev) {
    if (ev.button !== 0) return;
    // SLIDE-12: drop overlay active → defer to file-source.js drag handlers.
    // canvasRef.parentElement is #terminal-wrapper (the [data-drop-target] owner).
    // Strict equality on the literal string 'true' — getAttribute returns null
    // when the attribute is absent (12-RESEARCH.md Pitfall 4).
    if (canvasRef.parentElement?.getAttribute('data-drop-target') === 'true') {
        return;
    }

    const at = pxToCellWithScrollOffset(ev);
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    // S9.3 — a previous origination press that never got a canvas pointerup
    // (released off-canvas below the drag threshold, or pointercancel missed)
    // must not leak into this gesture: disarm before branching.
    if (dragPending && !dragActive) disarmDrag();

    // S9.3 — drag-origination branch: pointerdown INSIDE the committed selection
    // arms a native HTML5 drag instead of restarting selection. Deliberately NO
    // preventDefault (it would suppress the compatibility mouse events the drag
    // machinery hangs off) and NO setPointerCapture (capture routes events to the
    // canvas and kills the drag operation). No anchor reset — the selection is
    // the drag payload. A pointerdown continuing a multi-click sequence (same
    // 400ms/same-cell window the click counter uses) is NOT origination: the
    // 3rd click of a triple-click lands inside the word the 2nd click selected,
    // and must still select the line.
    const continuesMultiClick = now - lastClickTs < 400
            && lastClickRow === at.rowOffsetFromTail
            && lastClickCol === at.col;
    if (!continuesMultiClick && anchor && focusEnd && isCellInSelection(at)) {
        dragPending = true;
        canvasRef.draggable = true;
        return;
    }

    ev.preventDefault();
    try { canvasRef.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    dragging = true;

    // Click-count detection (window: 400 ms AND same cell).
    if (continuesMultiClick) {
        clickCount += 1;
    } else {
        clickCount = 1;
    }
    lastClickTs = now;
    lastClickRow = at.rowOffsetFromTail;
    lastClickCol = at.col;

    anchor = at;
    focusEnd = at;

    if (clickCount === 2) {
        selectWord(at);
    } else if (clickCount >= 3) {
        selectLine(at);
        clickCount = 0;   // reset so a 4th click starts fresh
    }

    notifySelectionChange();
    if (requestFrameFn) requestFrameFn();
}

function onPointerMove(ev) {
    if (!dragging) return;
    focusEnd = pxToCellWithScrollOffset(ev);
    // D-18 — drag-past-edge auto-scroll.
    const r = canvasRef.getBoundingClientRect();
    if (ev.clientY < r.top) {
        scrollStateRef.scrollByLines(+1);
    } else if (ev.clientY > r.bottom && scrollStateRef.isScrolledBack()) {
        scrollStateRef.scrollByLines(-1);
    }
    notifySelectionChange();
    if (requestFrameFn) requestFrameFn();
}

function onPointerUp(ev) {
    // S9.3 — armed drag but no dragstart fired: this was a plain click inside
    // the selection. Deselect (the existing single-click-clears behavior
    // extended to this branch) and disarm. The click counter is seeded as a
    // single click, exactly as the pre-S9.3 restart-selection path did — so
    // double-clicking a word inside an existing selection still word-selects
    // on the second click.
    if (dragPending && !dragActive) {
        disarmDrag();
        const at = pxToCellWithScrollOffset(ev);
        clickCount = 1;
        lastClickTs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        lastClickRow = at.rowOffsetFromTail;
        lastClickCol = at.col;
        anchor = null;
        focusEnd = null;
        notifySelectionChange();
        if (requestFrameFn) requestFrameFn();
        return;
    }
    dragging = false;
    if (anchor && focusEnd
            && anchor.rowOffsetFromTail === focusEnd.rowOffsetFromTail
            && anchor.col === focusEnd.col
            && clickCount < 2) {
        // Zero-length drag (single click) — clear without committing a selection.
        anchor = null;
        focusEnd = null;
        notifySelectionChange();
        if (requestFrameFn) requestFrameFn();
    }
}

function onPointerCancel() {
    // S9.3 — the browser reclaimed the gesture (touch scroll, pen palm-reject)
    // after the origination branch armed: disarm so the stale flags don't
    // suppress D-19 or hijack the next gesture's pointerup.
    if (dragPending && !dragActive) disarmDrag();
    dragging = false;
}

function onLostPointerCapture() {
    dragging = false;
    // Selection persists until D-19 trigger.
}

// --- S9.3 native drag handlers -------------------------------------------

// Clear the origination-arm state (pending flag, payload stash, draggable).
function disarmDrag() {
    dragPending = false;
    dragText = '';
    if (canvasRef) canvasRef.draggable = false;
}

function onDragStart(ev) {
    // A drag not armed by the origination branch is a stray (e.g. a leftover
    // draggable attribute) — abort it.
    if (!dragPending) {
        ev.preventDefault();
        return;
    }
    // Read the payload now — the D-19 blur/scroll guards kept the selection
    // alive since the arming pointerdown, and reading here (once per real
    // drag) spares every click-to-deselect the full getSelection() row walk.
    const sel = getSelection();
    dragText = sel ? sel.rows.join('\n') : '';
    if (!dragText) {
        ev.preventDefault();
        return;
    }
    ev.dataTransfer.setData('text/plain', dragText);
    // E11 S11.3 (FR-2) — offer the same selection to another Beastty tab. The
    // thunk owns the type string and the whole payload (identity, nonce, parsed
    // filenames); it returns null when there is nothing to offer — no valid 8.3
    // name in the selection — and then no custom type is stamped at all, so a
    // foreign tab never lights a drop target for a drag it could not honour.
    //
    // Deliberately AFTER the text/plain setData and before nothing: text/plain,
    // effectAllowed and the 1×1 drag image are bit-for-bit what they were, so
    // the pull-pane drop (S9.3) and the reverse-drag handoff (S9.4) cannot tell
    // this apart from the drag they have always seen. A throwing stamp is
    // swallowed for the same reason — a peer feature must never break the drag
    // that already works.
    if (getPeerStampFn) {
        try {
            const stamp = getPeerStampFn(dragText);
            if (stamp && typeof stamp.type === 'string' && typeof stamp.payload === 'string') {
                ev.dataTransfer.setData(stamp.type, stamp.payload);
            }
        } catch (err) {
            console.warn('[selection] peer drag stamp failed:', err);
        }
    }
    ev.dataTransfer.effectAllowed = 'copy';
    if (dragImageEl) {
        try { ev.dataTransfer.setDragImage(dragImageEl, 0, 0); } catch { /* ignore */ }
    }
    dragActive = true;
    notifySelectionDrag({ active: true, text: dragText });
}

function onDragEnd() {
    disarmDrag();
    dragActive = false;
    // D-19 — the wrapper lost focus at the origination mousedown and the blur
    // guard swallowed that clear to protect the payload; the drag is over now,
    // so re-establish the invariant (no highlight without focus).
    clearSelection();
    notifySelectionDrag({ active: false });
}

// --- Word / line selection helpers ---------------------------------------

function selectWord(at) {
    const text = safeReadRowText(at.rowOffsetFromTail);
    if (text == null || text.length === 0) return;
    let start = at.col;
    let end = at.col;
    // If we landed on whitespace, leave a zero-length anchor; user re-double-clicks.
    if (start >= text.length || /\s/.test(text[start])) {
        return;
    }
    while (start > 0 && /\S/.test(text[start - 1])) start -= 1;
    while (end < text.length - 1 && /\S/.test(text[end + 1])) end += 1;
    anchor = { rowOffsetFromTail: at.rowOffsetFromTail, col: start };
    focusEnd = { rowOffsetFromTail: at.rowOffsetFromTail, col: end };
}

function selectLine(at) {
    const text = safeReadRowText(at.rowOffsetFromTail);
    if (text == null) return;
    let end = text.length - 1;
    // Triple-click: trim trailing whitespace. Use /\s/ for consistency with
    // the regex `getSelection` already applies (`slice.replace(/[\s ]+$/, '')`)
    // and to cover all Unicode whitespace classes the prior literal-comparison
    // form silently failed to trim (Phase 12 WR-01 — the second comparand
    // was a stray NUL byte, not a distinct space glyph).
    while (end > 0 && /\s/.test(text[end])) end -= 1;
    anchor = { rowOffsetFromTail: at.rowOffsetFromTail, col: 0 };
    focusEnd = { rowOffsetFromTail: at.rowOffsetFromTail, col: Math.max(0, end) };
}

function safeReadRowText(rowOffsetFromTail) {
    if (typeof readRowText !== 'function') return null;
    try {
        return readRowText(rowOffsetFromTail);
    } catch (err) {
        console.warn('[selection] readRowText failed:', err);
        return null;
    }
}

// --- Public exports ------------------------------------------------------

export function getActiveRange() {
    const range = normalizedEndpoints();
    if (!range) return null;
    // start is the older row (larger offset) so cells iterate top-to-bottom
    // in the viewport.
    const { start, end } = range;
    const a = anchor;
    const f = focusEnd;
    const cols = termRef.cols();
    const visibleRows = termRef.rows();
    const offset = scrollStateRef.getOffset();
    return {
        anchor: a,
        focus: f,
        cells: function* () {
            // Walk rows top (older, larger offset) → bottom (newer, smaller offset).
            for (let row = start.rowOffsetFromTail; row >= end.rowOffsetFromTail; row -= 1) {
                let c0 = 0;
                let c1 = cols - 1;
                if (row === start.rowOffsetFromTail) c0 = start.col;
                if (row === end.rowOffsetFromTail) c1 = end.col;
                if (row === start.rowOffsetFromTail && row === end.rowOffsetFromTail) {
                    c0 = Math.min(start.col, end.col);
                    c1 = Math.max(start.col, end.col);
                }
                const visibleRow = (visibleRows - 1 - row) + offset;
                if (visibleRow < 0 || visibleRow >= visibleRows) continue;
                for (let c = c0; c <= c1; c += 1) {
                    yield { row: visibleRow, col: c, rowOffsetFromTail: row };
                }
            }
        },
    };
}

export function getSelection() {
    const range = normalizedEndpoints();
    if (!range) return null;
    // Decode each row of the selection per D-23: trim trailing whitespace per
    // line; \n line endings are joined by the caller (clipboard.js).
    const { start, end } = range;
    const cols = termRef.cols();
    const rows = [];
    for (let row = start.rowOffsetFromTail; row >= end.rowOffsetFromTail; row -= 1) {
        const text = safeReadRowText(row);
        if (text == null) continue;
        let c0 = 0;
        let c1 = cols - 1;
        if (row === start.rowOffsetFromTail) c0 = start.col;
        if (row === end.rowOffsetFromTail) c1 = end.col;
        if (row === start.rowOffsetFromTail && row === end.rowOffsetFromTail) {
            c0 = Math.min(start.col, end.col);
            c1 = Math.max(start.col, end.col);
        }
        let slice = text.substring(c0, Math.min(c1 + 1, text.length));
        // D-23 — trim trailing whitespace per line.
        slice = slice.replace(/[\s ]+$/, '');
        rows.push(slice);
    }
    if (rows.length === 0) return null;
    return { rows };
}

export function clearSelection() {
    if (!anchor && !focusEnd) {
        return;
    }
    anchor = null;
    focusEnd = null;
    notifySelectionChange();
    if (requestFrameFn) requestFrameFn();
}

export function isDragging() {
    return dragging;
}

export function cancelDrag() {
    dragging = false;
    clearSelection();
}

export function onSelectionChange(fn) {
    selectionObservers.push(fn);
    return () => {
        const i = selectionObservers.indexOf(fn);
        if (i >= 0) selectionObservers.splice(i, 1);
    };
}

// S9.3 — drag-state observer: {active: true, text} on dragstart, {active: false}
// on dragend. Carries the stashed text because onSelectionChange observers only
// receive {hasSelection} (and the selection may already be blur-cleared by the
// time a consumer wants the payload).
export function onSelectionDragState(fn) {
    selectionDragObservers.push(fn);
    return () => {
        const i = selectionDragObservers.indexOf(fn);
        if (i >= 0) selectionDragObservers.splice(i, 1);
    };
}

export function dispose() {
    if (unsubscribeScroll) {
        try { unsubscribeScroll(); } catch { /* ignore */ }
        unsubscribeScroll = null;
    }
    if (canvasRef) {
        canvasRef.removeEventListener('pointercancel', onPointerCancel);
        canvasRef.removeEventListener('dragstart', onDragStart);
        canvasRef.removeEventListener('dragend', onDragEnd);
        canvasRef.draggable = false;
    }
    if (dragImageEl) {
        try { dragImageEl.remove(); } catch { /* ignore */ }
        dragImageEl = null;
    }
    selectionObservers.length = 0;
    selectionDragObservers.length = 0;
    getPeerStampFn = null;   // E11 S11.3
    anchor = null;
    focusEnd = null;
    dragging = false;
    dragPending = false;
    dragActive = false;
    dragText = '';
}

function notifySelectionChange() {
    const has = !!(anchor && focusEnd);
    for (const fn of selectionObservers) {
        try {
            fn({ hasSelection: has });
        } catch (err) {
            console.warn('[selection] observer threw:', err);
        }
    }
}

function notifySelectionDrag(state) {
    for (const fn of selectionDragObservers) {
        try {
            fn(state);
        } catch (err) {
            console.warn('[selection] drag observer threw:', err);
        }
    }
}
