// Beastty Epic E7 Story E7.1 — centered paste toast (transient-chip clone).
//
// Clones the renderer/slide-chip.js transient-chip seam (which itself clones
// renderer/scroll-state.js): module-scope `lifecycle` state machine + per-state
// data + injected deps via wirePasteToast(opts) + [hidden]-attribute toggle
// render + inline bracketed buttons re-wired per render + returned API object.
//
// Differences from slide-chip (deliberate, per E7.1 Dev Notes):
//   - CENTERED over the terminal canvas (translate(-50%,-50%)), not top-right —
//     distinct from the SLIDE chip (top-right) and #scrollback-indicator
//     (bottom-right).
//   - Hosts the large-paste confirm affordance ([Paste]/[Cancel]) that
//     input/clipboard.js drives as a Promise<boolean>, rehoming the confirm the
//     retired #paste-progress-row used to carry (FR-29 / AD-16 / UX-DR15).
//   - EVENT-DRIVEN progress (NO 250 ms tick): paste-pump fires discrete 'chunk'
//     events carrying exact written/total, so each event renders directly.
//   - Neutral chrome ONLY — var(--chrome-*) tokens, NO [data-theme="crt"]
//     styling branch (AD-9 / NFR-2 — the slide-chip's CRT special-casing at
//     index.html is exactly what AD-9 says NOT to copy), no box-shadow.
//
// The paste-pump (input/paste-pump.js) stays the SINGLE SOURCE OF TRUTH (NFR-4):
// this module only SUBSCRIBES via onProgress and never drives the queue, calls a
// pump setter, or owns paste state (the E1.4 projector-never-writes-machine
// lesson). Esc-cancel keeps working unchanged (keyboard.js calls the pump
// directly; the pump fires 'cancelled' → this toast renders it).
//
// Public API (returned from wirePasteToast):
//   - handleProgress(ev)                         ← paste-pump.onProgress observer
//   - confirmLargePaste(byteCount, { getChunk, getPauseMs, isFlowControlled })
//                                                → Promise<boolean>
//   - hide()                                     ← lifecycle = 'hidden'
//   - __getStateForTests / __resetForTests       ← Playwright chromium suite hooks
//
// AD-1: no build step, native ESM, named exports only (no default).
// AD-2: window.__pasteToast test hooks (wired in main.js).
// AD-10: focus retention (retainFocus) on the toast + inline buttons — sacred;
//        a paste in flight must never steal focus from the canvas.

import { retainFocus } from './focus.js';

// ====== Module-scope state ======

// Lifecycle state machine (mirrors the paste-pump event vocabulary + the
// large-paste confirm gate).
let lifecycle = 'hidden';   // 'hidden' | 'confirm' | 'pumping' | 'complete'
                            // | 'cancelled' | 'cancelled-port-lost'

// Per-state data.
let confirmData = null;     // { formattedN, seconds, rate, flowControlled } for 'confirm'
                            // (rate null = nothing paces the run; flowControlled says the
                            //  reason is the port handshaking, not a pause of 0)
let confirmResolver = null; // (ok:boolean) => void — resolves confirmLargePaste's Promise
let pumpingData = null;     // { total, pct, written, elapsedMs, rate } for the 'pumping' render
let portLostUnsent = 0;     // bytes-unsent for the 'cancelled-port-lost' render

// When the pump fired 'started' for the run now in flight, on the monotonic clock.
// The chip reports elapsed time and the rate ACTUALLY ACHIEVED, and both are measured
// from here: bytes the pump says it has written, over wall-clock time it took to write
// them. Nothing about either figure comes from the Paste settings.
//
// That is the whole point of showing them. A paste over a handshaking port ignores the
// configured pause entirely and runs at whatever the handshake settles to — 13.5 B/s on
// real hardware against a configured 5 — and a rate derived from the settings would
// report the number the user typed instead of the number the wire delivered. The 59 s
// figure that told us the handshake had headroom only exists because it was timed by
// hand with a stopwatch; this is the app measuring itself.
//
// It starts at 'started', NOT when the large-paste confirm opened: the confirm can sit
// on screen for as long as the user takes to read it, and none of that is paste time.
let pumpStartedAt = null;

// Single auto-hide timer handle (complete / cancelled / cancelled-port-lost).
let autoHideHandle = null;

// The cadence assumed in the large-paste confirm when NO getter is injected — the
// pump's own defaults (1 byte every 200 ms). Only a harness ever sees these;
// main.js always passes the pump's live values. They stand in for a MISSING
// getter, never for a value a real getter returned — substituting for a real
// reading is how an estimate starts lying.
const FALLBACK_CHUNK = 1;
const FALLBACK_PAUSE_MS = 200;

const COMPLETE_HIDE_MS = 2000;
const CANCELLED_HIDE_MS = 2000;
const PORT_LOST_HIDE_MS = 3000;

// Injected deps (set by wirePasteToast).
let toastElRef = null;
let toastTextElRef = null;
let pasteBtnRef = null;     // persistent [Paste] button (confirm only)
let cancelBtnRef = null;    // persistent [Cancel] button (confirm + pumping)
let onCancelFn = null;      // () => cancelPastePump() — called by the [Cancel] button mid-pump

// ====== wirePasteToast initializer ======

export function wirePasteToast(opts) {
    const { toastEl, toastTextEl, onCancel } = opts;
    toastElRef = toastEl;
    toastTextElRef = toastTextEl;
    onCancelFn = onCancel || null;

    // The [Paste]/[Cancel] buttons are PERSISTENT children (markup), not rebuilt
    // per render — a progress tick re-injecting innerHTML would detach the button
    // mid-click (both for Playwright and a real user). We only toggle their [hidden]
    // and update the text span. Wire each button's click + focus retention ONCE.
    pasteBtnRef = toastEl ? toastEl.querySelector('button[data-action="paste"]') : null;
    cancelBtnRef = toastEl ? toastEl.querySelector('button[data-action="cancel"]') : null;
    wireInlineButton(pasteBtnRef);
    wireInlineButton(cancelBtnRef);

    // AD-10 — focus retention on the outer toast (mousedown→preventDefault so a
    // click on the chip never pulls focus off #terminal-wrapper). retainFocus is
    // the shared primitive (E0.1); do not hand-roll.
    if (toastEl) retainFocus(toastEl);

    refresh();   // initial render with the hidden lifecycle

    return {
        handleProgress,
        confirmLargePaste,
        hide,
        __getStateForTests,
        __resetForTests,
    };
}

// ====== paste-pump.onProgress observer ======

// Routes the pump's discrete progress events to the render (event-driven — no
// tick). The pump is the single source of truth; this only reflects it.
export function handleProgress(ev) {
    if (!ev) return;
    // A large-paste confirm takes visual priority over any pump progress. If a
    // SMALL paste is still pumping when a large paste opens the confirm, its
    // 'chunk'/'complete' events must NOT clobber the confirm affordance (which
    // would overwrite the [Paste] button and, on 'complete' → auto-hide, leak the
    // confirm Promise and silently drop the large paste). The pump keeps running
    // underneath; once the user resolves the confirm, the next event re-renders.
    if (lifecycle === 'confirm') return;
    switch (ev.status) {
        case 'started':
            // The clock starts HERE — the first byte is about to go out.
            pumpStartedAt = now();
            enterPumping(ev.total, 0, 0);
            return;
        case 'chunk': {
            const pct = ev.total > 0 ? Math.round((ev.written / ev.total) * 100) : 0;
            // A harness may drive 'chunk' without a preceding 'started'; start the
            // clock at the first event rather than reporting an absurd elapsed time.
            if (pumpStartedAt === null) pumpStartedAt = now();
            enterPumping(ev.total, pct, ev.written || 0);
            return;
        }
        case 'complete':
            enterComplete();
            return;
        case 'cancelled':
            enterCancelled();
            return;
        case 'cancelled-port-lost':
            enterPortLost(ev.unsent || 0);
            return;
    }
}

// ====== Large-paste confirm (Promise<boolean>) ======

// input/clipboard.js calls this at the >= LARGE_PASTE_THRESHOLD gate instead of
// driving #paste-confirm/#paste-cancel (which no longer exist). Resolves true on
// [Paste], false on [Cancel]. On either outcome the confirm affordance clears —
// a confirmed paste re-renders as 'pumping' the instant the pump fires 'started'
// (synchronous microtask after resolve, so no paint occurs in between).
export function confirmLargePaste(byteCount, opts) {
    // The estimate reads the PUMP's cadence, not the baud: the pump does not pace
    // to the wire at all any more — the user sets the chunk size and the pause
    // directly — so a baud-derived figure would promise a paste many times faster
    // than it runs.
    //
    // The duration is the pauses, and only the pauses: ceil(bytes / chunk) writes
    // with a pause after each but the last. Nothing here depends on what the bytes
    // ARE — the pump pauses the same amount after every chunk, so a line break
    // costs exactly what any other byte costs.
    //
    // The cadence handed in is the SNAPSHOT the run will use, which on a port
    // opened with hardware flow control is the unpaced shape whatever the Paste
    // pause setting holds — so a handshaken port quotes wire speed here, and says
    // that flow control is why (isFlowControlled). Quoting the paced figure for a
    // run that will not be paced is the same lie the Settings readout must not tell.
    const getChunk = (opts && typeof opts.getChunk === 'function') ? opts.getChunk : null;
    const getPauseMs = (opts && typeof opts.getPauseMs === 'function') ? opts.getPauseMs : null;
    const isFlowControlled = (opts && typeof opts.isFlowControlled === 'function') ? opts.isFlowControlled : null;
    return new Promise((resolve) => {
        // If a confirm is already pending (two large pastes before the user acts),
        // abandon the older one cleanly (resolve false = "don't paste") so its
        // awaiting caller never hangs — the newer confirm takes the surface.
        settlePendingConfirm(false);
        // Floor rather than fall back: a real getter's answer is used whatever it
        // says, and only a MISSING getter takes the FALLBACK_* defaults.
        const chunk = Math.max(1, getChunk ? getChunk() : FALLBACK_CHUNK);
        const pauseMs = Math.max(0, getPauseMs ? getPauseMs() : FALLBACK_PAUSE_MS);
        const writes = Math.ceil(byteCount / chunk);
        const seconds = Math.max(1, Math.round(((writes - 1) * pauseMs) / 1000));
        // Throughput is derived, exactly as the Settings readout derives it. With no
        // pause there is no pacing limit and the wire is the only ceiling, which is
        // not a number this module can know — see refresh().
        confirmData = {
            formattedN: byteCount.toLocaleString(),
            seconds,
            rate: pauseMs > 0 ? Math.max(1, Math.round((chunk / pauseMs) * 1000)) : null,
            flowControlled: isFlowControlled ? !!isFlowControlled() : false,
        };
        confirmResolver = resolve;
        clearAutoHide();
        lifecycle = 'confirm';
        refresh();
    });
}

// Resolve any pending confirm Promise exactly once, then clear the resolver — so
// no code path (a superseding confirm, hide()) can leak an unresolved confirm.
function settlePendingConfirm(ok) {
    const resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve(ok);
}

function resolveConfirm(ok) {
    confirmData = null;
    // Clear the confirm affordance immediately. A confirmed paste re-renders as
    // 'pumping' on the pump's synchronous 'started' event; a cancelled or
    // pump-gated (SLIDE-active) paste simply stays hidden.
    lifecycle = 'hidden';
    refresh();
    settlePendingConfirm(ok);
}

// ====== State-entry helpers ======

// `written` is the pump's own count of bytes it has handed to the writer, and the
// elapsed time is measured against the monotonic clock — so the rate below is the one
// the run actually achieved, whatever the settings said it would be.
//
// No rate is quoted until measurable time has passed: dividing by a zero-length
// interval is meaningless, and the first chunk of a run lands within a millisecond of
// 'started'. The elapsed figure shows from the first event either way.
function enterPumping(total, pct, written) {
    clearAutoHide();
    const elapsedMs = (pumpStartedAt === null) ? 0 : Math.max(0, now() - pumpStartedAt);
    const rate = (elapsedMs > 0 && written > 0) ? (written / (elapsedMs / 1000)) : null;
    pumpingData = { total, pct, written, elapsedMs, rate };
    lifecycle = 'pumping';
    refresh();
}

// Monotonic — a wall-clock jump mid-paste must not make the achieved rate negative or
// enormous. Guarded so a harness without performance still renders.
function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// The achieved rate, as a figure a human reads off a chip. Below 10 B/s one decimal
// place is the difference between the settings this project actually chooses between —
// 5, 6.7 and 10 B/s — so rounding to whole bytes there would hide the thing the number
// is for. Above that a whole number is plenty.
function formatRate(rate) {
    return (rate < 10) ? rate.toFixed(1) : String(Math.round(rate));
}

function enterComplete() {
    clearAutoHide();
    lifecycle = 'complete';
    refresh();
    autoHideHandle = setTimeout(hide, COMPLETE_HIDE_MS);
}

function enterCancelled() {
    clearAutoHide();
    lifecycle = 'cancelled';
    refresh();
    autoHideHandle = setTimeout(hide, CANCELLED_HIDE_MS);
}

function enterPortLost(unsent) {
    clearAutoHide();
    portLostUnsent = unsent;
    lifecycle = 'cancelled-port-lost';
    refresh();
    autoHideHandle = setTimeout(hide, PORT_LOST_HIDE_MS);
}

export function hide() {
    clearAutoHide();
    // Defensively settle a pending confirm (false = "don't paste") so hide() can
    // never strand an awaiting confirmLargePaste caller.
    settlePendingConfirm(false);
    confirmData = null;
    lifecycle = 'hidden';
    pumpingData = null;
    pumpStartedAt = null;   // the next run starts its own clock at its 'started'
    portLostUnsent = 0;
    refresh();
}

function clearAutoHide() {
    if (autoHideHandle) {
        clearTimeout(autoHideHandle);
        autoHideHandle = null;
    }
}

// ====== Render ======

function refresh() {
    if (!toastElRef || !toastTextElRef) return;

    switch (lifecycle) {
        case 'hidden':
            setButton(pasteBtnRef, false);
            setButton(cancelBtnRef, false);
            toastElRef.setAttribute('hidden', '');
            return;

        case 'confirm': {
            const { formattedN, seconds, rate, flowControlled } =
                confirmData || { formattedN: '0', seconds: 0, rate: null, flowControlled: false };
            // Carried over from clipboard.js's showLargePasteConfirm (06-UI-SPEC
            // §Large-paste inline confirm chip), with the trailing figure changed
            // from the baud to the pump's derived throughput — the baud stopped
            // predicting how long a paste takes once the cadence became a setting.
            //
            // The two figures divide: seconds ≈ bytes ÷ rate, because both come
            // from the same chunk-and-pause arithmetic. With no pause set there is
            // no rate to quote — the wire is the only limit and the pump does not
            // know what it carries — so the sentence says so rather than inventing
            // a number. It is the same wording the Settings readout carries.
            //
            // On a handshaking port there is no duration worth quoting — the paste
            // runs at wire speed and is over before the sentence is read — and the
            // "~1 s" floor the paced arithmetic collapses to would be noise dressed
            // as an estimate. So that case drops the duration and spends the words
            // on the reason instead, in the phrase the Settings readout uses.
            if (flowControlled) {
                toastTextElRef.textContent =
                    `About to paste ${formattedN} B at wire speed (flow control).`;
            } else {
                const rateText = (rate == null) ? 'wire speed' : `${rate} B/s`;
                toastTextElRef.textContent =
                    `About to paste ${formattedN} B (~${seconds} s at ${rateText}).`;
            }
            setButton(pasteBtnRef, true);
            setButton(cancelBtnRef, true);
            toastElRef.setAttribute('aria-label', `Confirm paste of ${formattedN} bytes — Paste or Cancel`);
            toastElRef.removeAttribute('hidden');
            return;
        }

        case 'pumping': {
            const { total, pct, elapsedMs, rate } =
                pumpingData || { total: 0, pct: 0, elapsedMs: 0, rate: null };
            // Bytes, percent, how long it has been running, and how fast it is
            // actually going. The last two are MEASURED (see pumpStartedAt): on a
            // handshaking port the configured pause is not applied at all, and this
            // line then reports what the wire delivered rather than what the Paste
            // settings asked for. Both advance as the paste proceeds — the pump fires
            // an event per chunk, so there is no tick to keep in step with.
            const seconds = Math.round(elapsedMs / 1000);
            const measured = (rate == null) ? `${seconds} s` : `${seconds} s · ${formatRate(rate)} B/s`;
            toastTextElRef.textContent = `Pasting ${total} B — ${pct}% · ${measured}`;
            setButton(pasteBtnRef, false);
            setButton(cancelBtnRef, true);
            toastElRef.setAttribute('aria-label',
                `Pasting ${total} bytes, ${pct}%, ${measured} — click Cancel to abort`);
            toastElRef.removeAttribute('hidden');
            return;
        }

        case 'complete':
            setButton(pasteBtnRef, false);
            setButton(cancelBtnRef, false);
            toastTextElRef.textContent = 'Paste complete';
            toastElRef.setAttribute('aria-label', 'Paste complete');
            toastElRef.removeAttribute('hidden');
            return;

        case 'cancelled':
            setButton(pasteBtnRef, false);
            setButton(cancelBtnRef, false);
            toastTextElRef.textContent = 'Paste cancelled';
            toastElRef.setAttribute('aria-label', 'Paste cancelled');
            toastElRef.removeAttribute('hidden');
            return;

        case 'cancelled-port-lost':
            setButton(pasteBtnRef, false);
            setButton(cancelBtnRef, false);
            toastTextElRef.textContent = `Paste cancelled — port lost (${portLostUnsent} bytes unsent)`;
            toastElRef.setAttribute('aria-label', 'Paste cancelled — port lost');
            toastElRef.removeAttribute('hidden');
            return;
    }
}

// ====== Inline button wiring (persistent bracketed buttons, slide-chip precedent) ======

function setButton(btn, visible) {
    if (!btn) return;
    if (visible) btn.removeAttribute('hidden');
    else btn.setAttribute('hidden', '');
}

function wireInlineButton(btn) {
    if (!btn) return;
    // AD-10 — focus retention on the button (reuse retainFocus; a button is the
    // mousedown→preventDefault branch, so no restoreTarget is needed). Wired once
    // at init on the PERSISTENT node — never re-injected, so never detaches mid-click.
    retainFocus(btn);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();   // don't bubble to the outer toast
        handleInlineAction(btn.getAttribute('data-action'));
    });
}

function handleInlineAction(action) {
    if (lifecycle === 'confirm') {
        if (action === 'paste') resolveConfirm(true);
        else if (action === 'cancel') resolveConfirm(false);
        return;
    }
    if (lifecycle === 'pumping' && action === 'cancel') {
        // The pump is the single source of truth — cancel it and let the pump's
        // 'cancelled' event render on this toast (never mutate lifecycle here).
        if (onCancelFn) try { onCancelFn(); } catch { /* cancel must never throw into a click */ }
    }
}

// ====== Test introspection (matches the window.__* pattern across the project) ======

export function __resetForTests() {
    lifecycle = 'hidden';
    confirmData = null;
    confirmResolver = null;
    pumpingData = null;
    pumpStartedAt = null;
    portLostUnsent = 0;
    clearAutoHide();
    if (toastElRef) toastElRef.setAttribute('hidden', '');
    if (toastTextElRef) toastTextElRef.textContent = '';
    setButton(pasteBtnRef, false);
    setButton(cancelBtnRef, false);
}

export function __getStateForTests() {
    return {
        lifecycle,
        confirmData: confirmData ? { ...confirmData } : null,
        pumpingData: pumpingData ? { ...pumpingData } : null,
        portLostUnsent,
        hasConfirmResolver: confirmResolver !== null,
        hasAutoHideTimer: autoHideHandle !== null,
    };
}
