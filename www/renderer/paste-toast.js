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
//   - confirmLargePaste(byteCount, { getRate, getBreakPauseMs, breaks })
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
let confirmData = null;     // { formattedN, seconds, rate } for the 'confirm' render
let confirmResolver = null; // (ok:boolean) => void — resolves confirmLargePaste's Promise
let pumpingData = null;     // { total, pct } for the 'pumping' render
let portLostUnsent = 0;     // bytes-unsent for the 'cancelled-port-lost' render

// Single auto-hide timer handle (complete / cancelled / cancelled-port-lost).
let autoHideHandle = null;

// Bytes/sec quoted in the large-paste confirm when NO rate getter is injected —
// the full-speed pump on the default 19200 connection (32 B every 19 ms). Only a
// harness ever sees it; main.js always passes the pump's live rate. It is used
// solely in place of a MISSING getter, never in place of a value a real getter
// returned — substituting for a real rate is how an estimate starts lying.
const FALLBACK_RATE = 1684;

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
            enterPumping(ev.total, 0);
            return;
        case 'chunk': {
            const pct = ev.total > 0 ? Math.round((ev.written / ev.total) * 100) : 0;
            enterPumping(ev.total, pct);
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
    // The estimate reads the PUMP's pacing, not the baud: since Paste speed became
    // a setting the pump no longer runs at wire rate, so a baud-derived figure
    // would promise a paste many times faster than it runs.
    //
    // BOTH terms count. Paste speed is the byte rate BETWEEN line breaks; each
    // break costs a further pause on top, and on short lines that pause is the
    // larger term — 5000 B of 40-char lines is 21 s of bytes and 16 s of breaks.
    // Quoting bytes ÷ rate alone understates a real paste by 2-15×.
    const getRate = (opts && typeof opts.getRate === 'function') ? opts.getRate : null;
    const getBreakPauseMs = (opts && typeof opts.getBreakPauseMs === 'function') ? opts.getBreakPauseMs : null;
    const breaks = (opts && Number.isFinite(opts.breaks)) ? opts.breaks : 0;
    return new Promise((resolve) => {
        // If a confirm is already pending (two large pastes before the user acts),
        // abandon the older one cleanly (resolve false = "don't paste") so its
        // awaiting caller never hangs — the newer confirm takes the surface.
        settlePendingConfirm(false);
        // Floor at 1 B/s rather than falling back: a real getter's answer is used
        // whatever it says, and only a MISSING getter takes FALLBACK_RATE.
        const rate = Math.max(1, getRate ? getRate() : FALLBACK_RATE);
        const breakPauseMs = getBreakPauseMs ? Math.max(0, getBreakPauseMs()) : 0;
        const seconds = Math.max(1, Math.round(byteCount / rate + (breaks * breakPauseMs) / 1000));
        confirmData = { formattedN: byteCount.toLocaleString(), seconds, rate };
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

function enterPumping(total, pct) {
    clearAutoHide();
    pumpingData = { total, pct };
    lifecycle = 'pumping';
    refresh();
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
            const { formattedN, seconds, rate } = confirmData || { formattedN: '0', seconds: 0, rate: FALLBACK_RATE };
            // Carried over from clipboard.js's showLargePasteConfirm (06-UI-SPEC
            // §Large-paste inline confirm chip), with the trailing figure changed
            // from the baud to the pump's byte rate — the baud stopped predicting
            // how long a paste takes once Paste speed became a setting. The quoted
            // seconds already include the per-break pauses; the quoted rate is the
            // between-breaks rate, which is what the menu row offers. The bracketed
            // [Paste]/[Cancel] affordance is the persistent-button pair beside the text.
            toastTextElRef.textContent =
                `About to paste ${formattedN} B (~${seconds} s at ${rate} B/s).`;
            setButton(pasteBtnRef, true);
            setButton(cancelBtnRef, true);
            toastElRef.setAttribute('aria-label', `Confirm paste of ${formattedN} bytes — Paste or Cancel`);
            toastElRef.removeAttribute('hidden');
            return;
        }

        case 'pumping': {
            const { total, pct } = pumpingData || { total: 0, pct: 0 };
            toastTextElRef.textContent = `Pasting ${total} B — ${pct}%`;
            setButton(pasteBtnRef, false);
            setButton(cancelBtnRef, true);
            toastElRef.setAttribute('aria-label', `Pasting ${total} bytes, ${pct}% — click Cancel to abort`);
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
