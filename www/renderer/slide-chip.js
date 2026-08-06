// Beastty Phase 11 Plan 11-02 (Wave 1) — floating SLIDE chip module.
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
//   - enterNotice(text)                        ← E11 S11.3 neutral sentence, 5 s auto-hide
//   - flashDropRejected()                      ← 3-second overlay on active state
//   - hide()                                   ← lifecycle = 'hidden'
//   - onStateChange(fn)                        ← inline actions + (E11 S11.3) lifecycle
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
                            // | 'notice'  (E11 S11.3)
let lastReason = '';        // for error state ('port lost' / 'CRC retries exhausted'
                            // / 'wire desync' / 'force_idle escape')
// E11 S11.3 — the neutral transient notice. A complete sentence on the existing
// chip: no "Transfer failed —" wrapper, no [Retry], no red. enterError is the
// wrong shape for this feature's copy because most of its sentences are not
// failures ("The other beast isn't connected…") and none of them offers a retry.
let noticeText = '';
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
// Phase 11 Plan 11-04 D-15 — wakeup-timeout timer. Armed by enterAwaitingWakeup
// when armTimer === true (Compatibility mode 'auto'). Cleared on enterActive
// (wakeup arrived in time), hide (user cancelled), and __resetForTests. Also
// re-armed on each enterAwaitingWakeup call (defensive — clearing prior arm).
let wakeupTimeoutHandle = null;
const WAKEUP_TIMEOUT_MS = 3000;

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
        enterNotice,            // (text) — E11 S11.3 neutral transient sentence, 5 s auto-hide
        flashDropRejected,      // () — 3-second overlay on active state
        hide,                   // () — set lifecycle = 'hidden'
        onStateChange,          // (fn) — inline-action AND (E11 S11.3) lifecycle events
        dispose,                // () — clear all timers
        // Plan 11-05 Rule 1 fix — slide.js's handleChipInlineAction reads chip
        // lifecycle via this accessor to disambiguate awaiting-* states from
        // active-session cancels (CONTEXT D-15). Without it, the dispatcher
        // sees lc=null and the cancel-from-awaiting-timeout branch falls
        // through, leaving the chip stuck in awaiting-timeout after [Cancel].
        __getStateForTests,
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

        // E11 S11.3 — a complete sentence, rendered as text. textContent (not
        // innerHTML): the caller owns the words and there is no markup in them,
        // so nothing here needs escaping and nothing can inject any.
        case 'notice':
            chipTextElRef.textContent = noticeText;
            chipElRef.setAttribute('aria-label', noticeText);
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
    // total_files is 0 on the recv side — the SLIDE protocol never announces
    // batch size, so a Z80→PC session's total is unknown until FIN. Show the
    // bare 1-based index rather than a fabricated "/1" (a 9-file pull used
    // to end on "9/1"). Send-side sessions know their count and keep "N/M".
    const fileCounter = st.total_files ? `${fileIdx}/${st.total_files}` : `${fileIdx}`;
    const bytesDone = st.bytes_in_file_done || 0;
    const bytesTotal = st.bytes_in_file_total || 1;
    const percent = Math.floor((bytesDone / bytesTotal) * 100);

    // Push throughput sample.
    const now = Date.now();
    samples.push({ t: now, bytes: bytesDone });
    // Trim window to 2 s (D-02).
    while (samples.length > 0 && (now - samples[0].t) > WINDOW_MS) samples.shift();
    // File transition — bytes_in_file_done reset under the window. Drop the
    // stale samples (keep the newest as the new baseline) here at the push
    // site, so the formatter stays a pure reader of the window; the held
    // rate carries the display across the gap.
    if (samples.length >= 2 && samples[samples.length - 1].bytes < samples[0].bytes) {
        samples.splice(0, samples.length - 1);
    }

    const throughputText = formatThroughput(samples);

    // Two-space separators (UI-SPEC §Layout token separators — locked verbatim).
    chipTextElRef.innerHTML =
        `${arrow} ${escapeHtml(filename)}  ${fileCounter}  ${percent}%  ${formatBytes(bytesDone)}  ${throughputText}  ${cancelButtonHtml()}`;
    chipElRef.setAttribute('aria-label', 'SLIDE transfer in progress — click Cancel to abort');
    wireInlineButtons();
    chipElRef.removeAttribute('hidden');
}

// ====== Throughput + byte-count formatters (D-02 verbatim) ======

// UAT-E9-04 niggle (iii) — the rate used to flip between "—" and a value
// every few ticks: the sample trim guarantees the window spans AT MOST
// WINDOW_MS while the old guard demanded AT LEAST that same span, so timer
// jitter put alternating renders on either side of the boundary. Two fixes:
// the minimum measurable span (500 ms) is now decoupled from the trim
// window, and the last computed rate is HELD whenever the current window
// can't produce one — so after the first half-second the token never
// reverts to "—" mid-session (width stays stable, no chip jumping).
const MIN_RATE_SPAN_MS = 500;
let lastThroughputText = null;   // held across ticks; cleared on enterActive

function formatThroughput(samples) {
    const held = lastThroughputText ?? '—';
    if (samples.length < 2) return held;
    const deltaBytes = samples[samples.length - 1].bytes - samples[0].bytes;
    // Negative deltas are trimmed at the push site (renderActiveState);
    // defensively hold rather than show a negative rate if one slips through.
    if (deltaBytes < 0) return held;
    const ageMs = samples[samples.length - 1].t - samples[0].t;
    if (ageMs < MIN_RATE_SPAN_MS) return held;
    const bps = (deltaBytes * 1000) / ageMs;
    let text;
    if (bps < 1000) text = `${Math.round(bps)} B/s`;
    else if (bps < 1_000_000) text = `${(bps / 1000).toFixed(1)} KB/s`;
    else text = `${(bps / 1_000_000).toFixed(1)} MB/s`;
    lastThroughputText = text;
    return text;
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

// E11 S11.3 — announce the lifecycle this chip just entered.
//
// onStateChange has carried exactly ONE event kind since Plan 11-04:
// 'inline-action', emitted when the user clicks a bracketed button. Its own
// header (:19) and the dispatcher comment that subscribes to it (slide.js:319)
// both describe it as the chip-lifecycle hook, but nothing ever emitted a
// lifecycle. S11.3's provider needs the transfer's end as an EVENT — a pull
// that errors, is cancelled, or closes short must not leave a peer's promise
// pending — so the fan-out its API always claimed is filled in here.
//
// Additive by construction: the one existing subscriber (slide.js's
// handleChipInlineAction wiring) early-returns on any evt.kind that is not
// 'inline-action', so it never sees these.
function emitLifecycle() {
    for (const fn of stateChangeObservers) {
        try { fn({ kind: 'lifecycle', lifecycle }); } catch { /* a subscriber must not break the chip */ }
    }
}

export function enterAwaitingWakeup(opts) {
    // Phase 11 Plan 11-04 D-15 / D-16 — armTimer governed by Compatibility
    // mode (caller passes armTimer based on prefs.slideCompatibilityMode):
    //   - 'auto' → armTimer: true → 3 s timer arms; on expiry transition to
    //     awaiting-timeout state (Z80 didn't respond chip + Retry/Cancel/
    //     Force-start buttons).
    //   - 'wakeup-required' → armTimer: false → no timer; chip stays in
    //     awaiting-wakeup indefinitely (modern slide.com).
    //   - 'force-start' → armTimer: false → no timer; dispatcher transitions
    //     to send mode immediately (chip never sees awaiting-timeout).
    clearAutoHide();
    clearWakeupTimer();
    lifecycle = 'awaiting-wakeup';
    samples.length = 0;
    refreshChip();
    emitLifecycle();

    if (opts && opts.armTimer === true) {
        wakeupTimeoutHandle = setTimeout(() => {
            wakeupTimeoutHandle = null;
            // Transition to awaiting-timeout — chip displays the
            // [Retry][Cancel][Force start] buttons (UI-SPEC verbatim copy).
            lifecycle = 'awaiting-timeout';
            refreshChip();
            emitLifecycle();
        }, WAKEUP_TIMEOUT_MS);
    }
}

function clearWakeupTimer() {
    if (wakeupTimeoutHandle) {
        clearTimeout(wakeupTimeoutHandle);
        wakeupTimeoutHandle = null;
    }
}

export function enterActive() {
    clearAutoHide();
    clearWakeupTimer();   // Phase 11 D-15 — wakeup arrived in time; cancel pending timeout.
    lifecycle = 'active';
    samples.length = 0;
    lastThroughputText = null;   // UAT-E9-04 (iii) — fresh session, fresh hold
    refreshChip();
    emitLifecycle();
}

export function enterCancelledSummary({ done, total }) {
    clearAutoHide();
    lifecycle = 'cancelled-summary';
    cancelledData = { done, total };
    refreshChip();
    emitLifecycle();
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
    emitLifecycle();
    summaryAutoHideHandle = setTimeout(() => { hide(); }, 5000);
}

export function enterError(reason) {
    clearAutoHide();
    lifecycle = 'error';
    lastReason = reason || 'unknown';
    refreshChip();
    emitLifecycle();
    summaryAutoHideHandle = setTimeout(() => { hide(); }, 5000);
}

/**
 * E11 S11.3 — the neutral transient notice (the story's one sanctioned entry
 * point here). A complete sentence, the existing 5 s auto-hide, and nothing
 * else: no prefix, no button, no red. The chip's border is --chrome-accent in
 * every state (index.html:335-356), so this inherits the "nothing is red"
 * guarantee rather than restating it.
 *
 * Takes the chip the way enterError does. Every sentence this feature shows is
 * produced at a moment when THIS tab is not mid-transfer — a busy destination
 * refuses before it asks (S11.3 AC-4) — so there is no live progress to stomp.
 */
export function enterNotice(text) {
    const sentence = typeof text === 'string' ? text.trim() : '';
    if (sentence.length === 0) return;   // nothing to say; leave the chip alone
    clearAutoHide();
    clearWakeupTimer();
    lifecycle = 'notice';
    noticeText = sentence;
    dropRejectedUntil = 0;   // the flash overlay only outranks 'active'; be explicit
    refreshChip();
    emitLifecycle();
    summaryAutoHideHandle = setTimeout(() => { hide(); }, 5000);
}

export function flashDropRejected() {
    // Sliding 3-second window per UI-SPEC; subsequent calls re-extend.
    dropRejectedUntil = Date.now() + 3000;
    refreshChip();
}

export function hide() {
    clearAutoHide();
    clearWakeupTimer();   // Phase 11 D-15 — clear any pending awaiting-timeout transition.
    lifecycle = 'hidden';
    cancelledData = null;
    summaryData = null;
    lastReason = '';
    noticeText = '';
    dropRejectedUntil = 0;
    samples.length = 0;
    refreshChip();
    emitLifecycle();
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
    clearWakeupTimer();
}

// ====== Test introspection (matches Phase 6/9/10 pattern) ======

export function __resetForTests() {
    lifecycle = 'hidden';
    samples.length = 0;
    dropRejectedUntil = 0;
    cancelledData = null;
    summaryData = null;
    lastReason = '';
    noticeText = '';
    clearAutoHide();
    clearWakeupTimer();   // Phase 11 D-15 — test isolation.
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
        hasWakeupTimer: wakeupTimeoutHandle !== null,   // Phase 11 D-15 — test introspection.
    };
}
