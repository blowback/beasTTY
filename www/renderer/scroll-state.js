// Beastty Phase 6 Plan 03 (Wave 2) — scrollback offset state machine + listeners.
//
// Public API: wireScrollState. Mirrors the wireX(opts) pattern from
// www/input/paste-pump.js (Phase 5).
//
// Sources:
//   - 06-CONTEXT.md D-01..D-15.
//   - 06-RESEARCH.md §Pattern 1 + §Code Examples lines 1247-1268.
//   - 06-PATTERNS.md §"www/renderer/scroll-state.js" (verbatim wheel handler).
//   - 06-UI-SPEC.md §Copywriting (verbatim chip text format).

// Module-scope state.
let offset = 0;                      // 0 = live tail; > 0 = N rows back
let trackpadAccumulator = 0;         // fractional deltaY accumulator (D-02)
let newLinesSinceUserScrolled = 0;   // chip counter (D-03)
let needsRepaint = false;            // D-08 paint-once gate
const changeObservers = [];

// Injected deps.
let termRef = null;
let canvasWrapperRef = null;
let indicatorElRef = null;
let indicatorTextElRef = null;
let requestFrameFn = null;
let markAllRowsDirtyFn = null;

// Constants per CONTEXT D-02.
const TRACKPAD_TICK_PX = 30;          // accumulator threshold; tunable to 50 if real-trackpad UAT shows overscroll
const LINES_PER_NOTCH = 3;            // mouse-wheel D-02
const PAGE_LINES = 24;                // Shift+wheel + Shift+PgUp/PgDn

export function wireScrollState(opts) {
    const { term, canvasWrapper, indicator, indicatorText, requestFrame, markAllRowsDirty } = opts;
    termRef = term;
    canvasWrapperRef = canvasWrapper;
    indicatorElRef = indicator;
    indicatorTextElRef = indicatorText;
    requestFrameFn = requestFrame;
    markAllRowsDirtyFn = markAllRowsDirty || null;

    // Wheel listener — D-02 + D-12 (attached to wrapper, NOT document).
    canvasWrapper.addEventListener('wheel', onWheel, { passive: false });

    // Keydown listener for Shift+PgUp / Shift+PgDn / Shift+Home / Shift+End is INSTALLED
    // BY www/input/keyboard.js in Plan 06-04 — this module exposes scrollByPage,
    // jumpToTop, snapToBottom, scrollByLines for keyboard.js to call. No keyboard
    // listener here; the chrome.js Esc-paste-cancel pattern shows that keyboard
    // intercepts live in keyboard.js.

    // Chip click — snap to bottom (D-04 trigger 1).
    if (indicator) {
        indicator.addEventListener('click', () => {
            snapToBottom();
        });
        indicator.addEventListener('mousedown', (e) => {
            e.preventDefault();   // Phase 4 D-16 focus-retention pattern — sacred.
        });
    }

    // Initial state.
    refreshAttribute();
    refreshChip();

    return {
        getOffset,
        isScrolledBack,
        scrollByLines,
        scrollByPage,
        snapToBottom,
        jumpToTop,
        notifyFeed,
        onChange,
        consumeNeedsRepaint,
        requestRepaint,
        dispose,
    };
}

function onWheel(ev) {
    ev.preventDefault();   // claim — D-12 chrome panes never see it (they're outside #terminal-wrapper).
    let lines;
    if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        // Mouse wheel — Linux/Windows-default deliver line deltas.
        lines = (ev.shiftKey ? PAGE_LINES : LINES_PER_NOTCH) * Math.sign(ev.deltaY);
    } else {
        // Trackpad / hi-res mouse — accumulate raw pixels.
        trackpadAccumulator += ev.deltaY;
        lines = 0;
        while (Math.abs(trackpadAccumulator) >= TRACKPAD_TICK_PX) {
            lines += LINES_PER_NOTCH * Math.sign(trackpadAccumulator);
            trackpadAccumulator -= TRACKPAD_TICK_PX * Math.sign(trackpadAccumulator);
        }
    }
    if (lines !== 0) scrollByLines(-lines);   // up-wheel (negative deltaY) = +offset
}

export function scrollByLines(delta) {
    setOffset(offset + delta);
}

export function scrollByPage(direction) {
    // direction: +1 = back (older), -1 = forward (newer toward live)
    setOffset(offset + direction * PAGE_LINES);
}

export function jumpToTop() {
    if (!termRef) return;
    // D-05 — clamp to scrollback length minus visible_rows.
    // term.snapshot_grid_at clamps internally per D-06; using a large bounded
    // value here lets the Rust side do the clamp without us tracking total_len.
    setOffset(Number.MAX_SAFE_INTEGER);
}

export function snapToBottom() {
    setOffset(0);
}

export function notifyFeed(value) {
    if (!isScrolledBack()) return;
    // Count newlines.
    let n = 0;
    for (let i = 0; i < value.byteLength; i++) {
        if (value[i] === 0x0A) n++;
    }
    if (n > 0) {
        newLinesSinceUserScrolled += n;
        refreshChip();
    }
}

export function isScrolledBack() {
    return offset > 0;
}

export function getOffset() {
    return offset;
}

export function consumeNeedsRepaint() {
    const r = needsRepaint;
    needsRepaint = false;
    return r;
}

export function onChange(fn) {
    changeObservers.push(fn);
    return () => {
        const i = changeObservers.indexOf(fn);
        if (i >= 0) changeObservers.splice(i, 1);
    };
}

export function requestRepaint() {
    // Called by canvas.js after theme/phosphor/zoom change while scrolled-up (D-13).
    needsRepaint = true;
    if (requestFrameFn) requestFrameFn();
}

export function dispose() {
    if (canvasWrapperRef) {
        canvasWrapperRef.removeEventListener('wheel', onWheel);
    }
    changeObservers.length = 0;
}

function setOffset(next) {
    // Clamp to >= 0; upper bound is enforced by term.snapshot_grid_at which clamps internally.
    const clamped = Math.max(0, next);
    if (clamped === offset) return;
    const wasScrolled = offset > 0;
    offset = clamped;
    needsRepaint = true;
    refreshAttribute();
    if (offset === 0 && wasScrolled) {
        // Snap-to-bottom — reset chip counter AND force all-rows repaint so
        // the previously-painted scrollback view is overwritten by the live grid.
        newLinesSinceUserScrolled = 0;
        if (markAllRowsDirtyFn) markAllRowsDirtyFn();
    }
    refreshChip();
    fireChange();
    if (requestFrameFn) requestFrameFn();
}

function refreshAttribute() {
    if (!canvasWrapperRef) return;
    if (offset > 0) {
        canvasWrapperRef.setAttribute('data-scrolled-back', 'true');
    } else {
        canvasWrapperRef.removeAttribute('data-scrolled-back');
    }
}

function refreshChip() {
    if (!indicatorElRef || !indicatorTextElRef) return;
    if (offset > 0 && newLinesSinceUserScrolled > 0) {
        // 06-UI-SPEC §Copywriting verbatim singular/plural rule.
        const n = newLinesSinceUserScrolled;
        const unit = n === 1 ? 'new line' : 'new lines';
        const formatted = n.toLocaleString();
        indicatorTextElRef.innerHTML = `<span aria-hidden="true">↓</span> ${formatted} ${unit}`;
        indicatorElRef.setAttribute('aria-label', `${formatted} ${unit} below — click to scroll to live output`);
        indicatorElRef.removeAttribute('hidden');
    } else {
        indicatorElRef.setAttribute('hidden', '');
    }
}

function fireChange() {
    for (const fn of changeObservers) {
        fn({ offset, isScrolledBack: offset > 0, newLines: newLinesSinceUserScrolled });
    }
}
