// Beastty Epic E0 Story E0.2 — Modal helper (openModal).
//
// The one shared way every dialog opens, closes, traps focus, and restores
// focus (AD-8). Extracted verbatim from the open/close/focus mechanics that
// lived inline in file-source.js's showConfirmModal — a pure relocation so the
// #send-modal keeps its exact v1.1 behavior while the future Serial Config /
// SLIDE / Shortcuts / About modals (E2, E3, E6) get the contract for free.
//
// Contract (AD-8, pinned):
//   openModal(dialogEl, { initialFocus, restoreTo }) → Promise<returnValue>
//   - dialogEl    — the <dialog>. Opened via showModal() so the browser gives
//                   us the top layer, the native ::backdrop, AND a native focus
//                   trap. We do NOT hand-roll a focus-trap loop — showModal()
//                   already traps. The caller owns building content and wiring
//                   its own close triggers (buttons, backdrop-click, Esc).
//   - initialFocus — element to focus on open. We set data-focused="true" on it
//                   BEFORE .focus() (the attribute paints the visible border;
//                   Chromium suppresses :focus-visible after a programmatic
//                   focus that follows a pointer-initiated path — see the
//                   #send-modal footer CSS rule + 12-uat-focus-ring-missing.md),
//                   and clear it to "false" on close.
//   - restoreTo   — Element | ((returnValue) => Element | null) | null. On close
//                   we focus the resolved target. The callback form is what lets
//                   file-source.js express its conditional restore (wrapper on
//                   send/first-only, trigger otherwise) without this helper ever
//                   knowing about SLIDE actions or reaching for #terminal-wrapper.
//   - resolves to the RAW dialogEl.returnValue string (may be ''). Mapping
//                   '' → null and switching on the tag is the CALLER's job.
//
// AD-1: no build step, native ESM, named exports only (no default).
// AD-2: carries test hooks (__getStateForTests / __resetForTests) but is a leaf
//       helper (like focus.js), so it has no wireXxx initializer; main.js
//       surfaces it as window.__modal for the Playwright chromium suite.
// AD-3: zero imports — dialogEl / initialFocus / restoreTo are all passed in by
//       the caller; modal.js must never getElementById('terminal-wrapper').

// Module-scope introspection state. Copies only cross the Playwright evaluate
// boundary (never live DOM refs), so we track primitives: how many opens have
// happened, the returnValue the last close resolved with, and the id of the
// dialog most recently opened.
let openCount = 0;
let lastReturnValue = null;
let lastOpenDialogId = null;

export function openModal(dialogEl, { initialFocus, restoreTo } = {}) {
    return new Promise((resolve) => {
        // One-shot close listener: { once: true } means the browser removes it
        // after firing, so repeated opens of the same dialog never stack
        // listeners (mirrors the old inline removeEventListener-in-onClose).
        const onClose = () => {
            // Read BEFORE any focus move. openModal cleared returnValue to '' at
            // showModal() time, so an Esc/backdrop dismissal (which never sets
            // returnValue) reads '' here rather than inheriting a prior close's
            // tag — the caller maps '' → bail.
            const rv = dialogEl.returnValue;
            lastReturnValue = rv;
            // Clear the attribute we set on open — and only that element, so a
            // stale data-focused can't paint a ghost border next open. The caller
            // decides which element initialFocus is, so we always clear exactly
            // the one we lit.
            if (initialFocus) initialFocus.setAttribute('data-focused', 'false');
            // restoreTo: callback form is resolved with the raw returnValue so the
            // caller can branch (send/first-only → wrapper, else → trigger);
            // element form is focused directly; nullish → no restore. Null-guarded
            // focus so a callback that returns null never throws.
            const target = typeof restoreTo === 'function' ? restoreTo(rv) : restoreTo;
            target?.focus?.();
            resolve(rv);
        };
        dialogEl.addEventListener('close', onClose, { once: true });

        openCount++;
        lastOpenDialogId = dialogEl.id || null;
        // Reset returnValue BEFORE showModal() so this open starts from a clean
        // slate. A native <dialog> never clears returnValue on its own, and Esc
        // closes WITHOUT setting it — so without this reset an Esc-dismiss would
        // inherit the tag left by a PREVIOUS close ('send'/'first-only'), and a
        // truthy-tag caller guard would treat the cancelled dialog as a submit
        // (e.g. re-sending a batch the user Esc-cancelled). Clearing here makes
        // Esc/backdrop dismissal resolve '' every time, which every caller maps
        // to bail. (E0.2 AD-8 — was the deferred latent edge; now closed.)
        dialogEl.returnValue = '';
        dialogEl.showModal();

        // data-focused MUST be set before .focus() so the [data-focused="true"]
        // CSS rule paints the border immediately (see header). No initialFocus →
        // no focus set (both args are optional per the contract).
        if (initialFocus) {
            initialFocus.setAttribute('data-focused', 'true');
            initialFocus.focus();
        }
    });
}

// ====== Test introspection (matches the focus.js / slide-chip.js pattern) ======

export function __getStateForTests() {
    return {
        openCount,
        lastReturnValue,
        openDialogId: lastOpenDialogId,
    };
}

export function __resetForTests() {
    openCount = 0;
    lastReturnValue = null;
    lastOpenDialogId = null;
}
