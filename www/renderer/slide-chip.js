// BestialiTTY Phase 11 Plan 11-02 (Wave 1) — floating SLIDE chip module.
//
// Mirrors the www/renderer/scroll-state.js shape verbatim per CONTEXT C-02.
// Module-scope state + wireSlideChip({...}) initializer + [hidden] toggle
// render + 250 ms refresh tick for throughput sliding-window updates +
// observer fan-out for Plan 11-03 dispatcher hooks. NO production callers
// in Plan 11-02 — chip is addressable only via window.__slideChip until
// Plan 11-03 wires the dispatcher onRecvEvent / send-mode lifecycle hooks
// and Plan 11-04 adds the Compatibility-mode timer + swallow-echo filter.
//
// Public API (returned from wireSlideChip):
//   - enterAwaitingWakeup({ armTimer })       ← Plan 11-04 wires armTimer logic
//   - enterActive()                            ← switch to active session render
//   - enterCancelledSummary({ done, total })   ← 5-second auto-hide (D-08)
//   - enterSummary({ direction, fileCount, totalBytes })  ← gated by prefs.slideShowSummary
//   - enterError(reason)                       ← 5-second auto-hide unless [Retry]
//   - flashDropRejected()                      ← 3-second overlay on active state
//   - hide()                                   ← lifecycle = 'hidden'
//   - onStateChange(fn)                        ← Plan 11-03 dispatcher subscribes
//   - dispose()                                ← clear all timers
//
// Sources:
//   - 11-CONTEXT.md C-02 (chip module location + module-scope state pattern);
//     D-01 (single-line dense layout); D-02 (throughput formula);
//     D-08 (summary chip 5-second auto-hide); D-10 (drop-rejected flash 3 s);
//     D-15 (awaiting-wakeup + awaiting-timeout state).
//   - 11-UI-SPEC.md §Layout Contract Floating chip — DOM shape, lifecycle
//     states, dimensions (8 lifecycle states with verbatim copy strings);
//     §Copywriting Contract (verbatim text for every state);
//     §Accessibility Contract (aria-live=polite, aria-atomic=true, aria-label).
//   - 11-PATTERNS.md §slide-chip.js (NEW — chip module).
//
// Analog: www/renderer/scroll-state.js:11-77 (module-scope state + wireXxx
// initializer); :194-207 (refreshChip render + [hidden] toggle); :145-151 +
// :209-213 (onChange observer + fireChange fan-out).

// ====== Module-scope state ======

// Lifecycle state machine (UI-SPEC §Layout Contract verbatim — 8 states).
let lifecycle = 'hidden';   // 'hidden' | 'awaiting-wakeup' | 'awaiting-timeout'
                            // | 'active' | 'cancelled-summary' | 'sent-summary'
                            // | 'received-summary' | 'error' | 'drop-rejected-flash'
let lastReason = '';        // for error state ('port lost' / 'CRC retries exhausted'
                            // / 'wire desync' / 'force_idle escape')
let summaryData = null;     // { direction: 'sent'|'received', fileCount, totalBytes }
                            // for sent/received-summary
let cancelledData = null;   // { done, total } for cancelled-summary

// Throughput sliding window (D-02).
const samples = [];         // { t: number, bytes: number }[] — capped to 2-second window
const WINDOW_MS = 2000;

// Drop-rejected flash overlay (D-10).
let dropRejectedUntil = 0;  // Date.now() + 3000 on each flashDropRejected() call

// Timer handles for lifecycle auto-hides.
let refreshTickHandle = null;        // 250 ms interval for active redraw + throughput
let summaryAutoHideHandle = null;    // 5 s for sent/received/cancelled/error states

// Injected deps (set by wireSlideChip).
let chipElRef = null;
let chipTextElRef = null;
let getSlideStateFn = null;
let onCancelFn = null;
let prefsRef = null;

// Observer fan-out (Plan 11-03 dispatcher subscribes here for lifecycle hooks).
const stateChangeObservers = [];

// ====== wireSlideChip initializer ======

export function wireSlideChip(opts) {
    const { chipEl, chipTextEl, getSlideState, onCancel, prefs } = opts;
    chipElRef = chipEl;
    chipTextElRef = chipTextEl;
    getSlideStateFn = getSlideState;
    onCancelFn = onCancel;
    prefsRef = prefs;

    // Phase 4 D-16 — focus retention on chip outer click (sacred).
    if (chipEl) {
        chipEl.addEventListener('mousedown', (e) => { e.preventDefault(); });
        // Outer chip click is a no-op in Phase 11 (only inner buttons fire actions).
    }

    // Initial render with hidden lifecycle.
    refreshChip();

    // 250 ms refresh tick (D-02 throughput updates between state events).
    refreshTickHandle = setInterval(refreshChip, 250);

    return {
        enterAwaitingWakeup,    // ({ armTimer: bool }) — Plan 11-04 wires armTimer logic
        enterActive,            // () — switch to active session render
        enterCancelledSummary,  // ({ done, total }) — 5-second auto-hide
        enterSummary,           // ({ direction, fileCount, totalBytes }) — gated by prefs.slideShowSummary
        enterError,             // (reason) — 5-second auto-hide unless [Retry]
        flashDropRejected,      // () — 3-second overlay on active state
        hide,                   // () — set lifecycle = 'hidden'
        onStateChange,          // (fn) — Plan 11-03 dispatcher subscribes
        dispose,                // () — clear all timers
    };
}

// ====== Render function ======

function refreshChip() {
    if (!chipElRef || !chipTextElRef) return;

    // Drop-rejected flash takes precedence over the active-state render.
    if (lifecycle === 'active' && Date.now() < dropRejectedUntil) {
        chipTextElRef.textContent = 'Transfer in progress — cancel first';
        chipElRef.setAttribute('aria-label', 'Drop rejected — transfer in progress');
        chipElRef.removeAttribute('hidden');
        return;
    }

    switch (lifecycle) {
        case 'hidden':
            chipElRef.setAttribute('hidden', '');
            return;

        case 'awaiting-wakeup':
            chipTextElRef.innerHTML = '↑ Waiting for Z80…  ' + cancelButtonHtml();
            chipElRef.setAttribute('aria-label', 'Waiting for Z80 — click Cancel to abort');
            wireInlineButtons();
            chipElRef.removeAttribute('hidden');
            return;

        case 'awaiting-timeout':
            chipTextElRef.innerHTML =
                "Z80 didn't respond.  " + retryButtonHtml() + '  ' + cancelButtonHtml() + '  ' + forceStartButtonHtml();
            chipElRef.setAttribute('aria-label', 'Z80 did not respond — Retry, Cancel, or Force start');
            wireInlineButtons();
            chipElRef.removeAttribute('hidden');
            return;

        case 'active':
            renderActiveState();
            return;

        case 'cancelled-summary': {
            const { done, total } = cancelledData || { done: 0, total: 0 };
            chipTextElRef.textContent = `Cancelled — ${done} of ${total} files transferred`;
            chipElRef.setAttribute('aria-label', 'Transfer cancelled');
            chipElRef.removeAttribute('hidden');
            return;
        }

        case 'sent-summary': {
            const { fileCount, totalBytes } = summaryData || { fileCount: 0, totalBytes: 0 };
            chipTextElRef.textContent = `Sent ${pluralFile(fileCount)} — ${formatBytes(totalBytes)} → MicroBeast`;
            chipElRef.setAttribute('aria-label', `Transfer complete — sent ${fileCount} files`);
            chipElRef.removeAttribute('hidden');
            return;
        }

        case 'received-summary': {
            const { fileCount, totalBytes } = summaryData || { fileCount: 0, totalBytes: 0 };
            chipTextElRef.textContent = `Received ${pluralFile(fileCount)} — ${formatBytes(totalBytes)}`;
            chipElRef.setAttribute('aria-label', `Transfer complete — received ${fileCount} files`);
            chipElRef.removeAttribute('hidden');
            return;
        }

        case 'error':
            chipTextElRef.innerHTML = `Transfer failed — ${escapeHtml(lastReason)}.  ` + retryButtonHtml();
            chipElRef.setAttribute('aria-label', 'Transfer failed — click Retry to re-arm');
            wireInlineButtons();
            chipElRef.removeAttribute('hidden');
            return;
    }
}

// Active state renderer (D-01 verbatim layout + D-02 throughput).
function renderActiveState() {
    const st = getSlideStateFn ? getSlideStateFn() : null;
    if (!st || st.mode === 'terminal') {
        // Defensive — dispatcher hasn't transitioned yet; render placeholder.
        chipElRef.setAttribute('hidden', '');
        return;
    }

    const arrow = st.mode === 'send' ? '↑' : '↓';
    const filename = st.current_filename || '';
    const fileIdx = (st.file_idx || 0) + 1;        // 1-based for display
    const totalFiles = st.total_files || 1;
    const bytesDone = st.bytes_in_file_done || 0;
    const bytesTotal = st.bytes_in_file_total || 1;
    const percent = Math.floor((bytesDone / bytesTotal) * 100);

    // Push throughput sample.
    const now = Date.now();
    samples.push({ t: now, bytes: bytesDone });
    // Trim window to 2 s (D-02).
    while (samples.length > 0 && (now - samples[0].t) > WINDOW_MS) samples.shift();

    const throughputText = formatThroughput(samples);

    // Two-space separators (UI-SPEC §Layout token separators — locked verbatim).
    chipTextElRef.innerHTML =
        `${arrow} ${escapeHtml(filename)}  ${fileIdx}/${totalFiles}  ${percent}%  ${formatBytes(bytesDone)}  ${throughputText}  ${cancelButtonHtml()}`;
    chipElRef.setAttribute('aria-label', 'SLIDE transfer in progress — click Cancel to abort');
    wireInlineButtons();
    chipElRef.removeAttribute('hidden');
}

// ====== Throughput + byte-count formatters (D-02 verbatim) ======

function formatThroughput(samples) {
    if (samples.length < 2) return '—';
    const ageMs = samples[samples.length - 1].t - samples[0].t;
    if (ageMs < 2000) return '—';
    const deltaBytes = samples[samples.length - 1].bytes - samples[0].bytes;
    const bps = (deltaBytes * 1000) / ageMs;
    if (bps < 1000) return `${Math.round(bps)} B/s`;
    if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} KB/s`;
    return `${(bps / 1_000_000).toFixed(1)} MB/s`;
}

function formatBytes(b) {
    if (b < 1000) return `${b} B`;
    if (b < 1_000_000) return `${Math.round(b / 1000)} KB`;
    return `${(b / 1_000_000).toFixed(1)} MB`;
}

function pluralFile(n) { return n === 1 ? '1 file' : `${n} files`; }

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

// ====== Inline button HTML helpers (UI-SPEC §Layout — bracketed text) ======

function cancelButtonHtml() {
    return '<button type="button" class="slide-inline" data-action="cancel">[Cancel]</button>';
}
function retryButtonHtml() {
    return '<button type="button" class="slide-inline" data-action="retry">[Retry]</button>';
}
function forceStartButtonHtml() {
    return '<button type="button" class="slide-inline" data-action="force-start">[Force start]</button>';
}

function wireInlineButtons() {
    if (!chipTextElRef) return;
    const buttons = chipTextElRef.querySelectorAll('button.slide-inline');
    buttons.forEach((btn) => {
        // Phase 4 D-16 focus retention.
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();   // don't bubble to outer chip
            const action = btn.getAttribute('data-action');
            handleInlineAction(action);
        });
    });
}

function handleInlineAction(action) {
    if (action === 'cancel') {
        if (onCancelFn) try { onCancelFn(); } catch {}
        // Plan 11-04 wires the [Retry] / [Force start] handlers; for now a no-op
        // hook out via state-change observers.
    }
    // [Retry] / [Force start] handlers: emit through stateChangeObservers
    // so Plan 11-04's dispatcher hooks can listen.
    for (const fn of stateChangeObservers) {
        try { fn({ kind: 'inline-action', action }); } catch {}
    }
}

// ====== Public state-transition methods (UI-SPEC verbatim states) ======

export function enterAwaitingWakeup(_opts) {
    // _opts.armTimer wired by Plan 11-04.
    clearAutoHide();
    lifecycle = 'awaiting-wakeup';
    samples.length = 0;
    refreshChip();
}

export function enterActive() {
    clearAutoHide();
    lifecycle = 'active';
    samples.length = 0;
    refreshChip();
}

export function enterCancelledSummary({ done, total }) {
    clearAutoHide();
    lifecycle = 'cancelled-summary';
    cancelledData = { done, total };
    refreshChip();
    summaryAutoHideHandle = setTimeout(() => { hide(); }, 5000);
}

export function enterSummary({ direction, fileCount, totalBytes }) {
    // D-08 — gated by prefs.slideShowSummary.
    if (!prefsRef || !prefsRef.slideShowSummary) {
        hide();
        return;
    }
    clearAutoHide();
    lifecycle = direction === 'sent' ? 'sent-summary' : 'received-summary';
    summaryData = { direction, fileCount, totalBytes };
    refreshChip();
    summaryAutoHideHandle = setTimeout(() => { hide(); }, 5000);
}

export function enterError(reason) {
    clearAutoHide();
    lifecycle = 'error';
    lastReason = reason || 'unknown';
    refreshChip();
    summaryAutoHideHandle = setTimeout(() => { hide(); }, 5000);
}

export function flashDropRejected() {
    // Sliding 3-second window per UI-SPEC; subsequent calls re-extend.
    dropRejectedUntil = Date.now() + 3000;
    refreshChip();
}

export function hide() {
    clearAutoHide();
    lifecycle = 'hidden';
    cancelledData = null;
    summaryData = null;
    lastReason = '';
    dropRejectedUntil = 0;
    samples.length = 0;
    refreshChip();
}

function clearAutoHide() {
    if (summaryAutoHideHandle) {
        clearTimeout(summaryAutoHideHandle);
        summaryAutoHideHandle = null;
    }
}

export function onStateChange(fn) {
    stateChangeObservers.push(fn);
    return () => {
        const i = stateChangeObservers.indexOf(fn);
        if (i >= 0) stateChangeObservers.splice(i, 1);
    };
}

export function dispose() {
    if (refreshTickHandle) clearInterval(refreshTickHandle);
    refreshTickHandle = null;
    clearAutoHide();
}

// ====== Test introspection (matches Phase 6/9/10 pattern) ======

export function __resetForTests() {
    lifecycle = 'hidden';
    samples.length = 0;
    dropRejectedUntil = 0;
    cancelledData = null;
    summaryData = null;
    lastReason = '';
    clearAutoHide();
    if (chipElRef) chipElRef.setAttribute('hidden', '');
    if (chipTextElRef) chipTextElRef.textContent = '';
}

export function __getStateForTests() {
    return {
        lifecycle,
        samples: samples.slice(),
        dropRejectedUntil,
        cancelledData: cancelledData ? { ...cancelledData } : null,
        summaryData: summaryData ? { ...summaryData } : null,
        lastReason,
        hasAutoHideTimer: summaryAutoHideHandle !== null,
    };
}
