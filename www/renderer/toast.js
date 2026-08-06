// Beastty — generic transient notice toast (bottom-centre).
//
// One line of text, shown for ~2 s, then gone. Added for the E8 command-history
// escape hatch (2026-08-06): the Ctrl+Shift+Insert / Ctrl+Alt+H chord flips a
// persisted pref, and savePrefs does not fan out to subscribers, so without a toast
// the operator gets no feedback at all that the chord landed.
//
// Why a new module rather than reusing renderer/paste-toast.js: that one is a paste
// state machine (confirm affordance, pump progress, a Promise<boolean>) whose text is
// derived from paste state. It has no "just say this" entry point, and bolting one on
// would give it two owners of its lifecycle. This module has one state — visible or
// not — and no callers other than whoever calls show().
//
// Conventions cloned from paste-toast.js:
//   - [hidden] ATTRIBUTE for show/hide, never inline styles (AD-2). index.html spells
//     out `#toast[hidden] { display: none; }` rather than relying on the UA stylesheet,
//     matching the sibling chips.
//   - Neutral chrome ONLY — var(--chrome-*) tokens, NO [data-theme="crt"] branch, NO
//     box-shadow (AD-9).
//   - role="status" + aria-live="polite" + aria-atomic="true", with aria-label
//     rewritten alongside textContent so the announcement matches what is on screen.
//   - retainFocus on the element (AD-10) — a notice must never pull keyboard focus
//     off #terminal-wrapper.
//
// AD-1: no build step, native ESM, named exports only (no default).
// AD-2: window.__toast test hooks (wired in main.js).

import { retainFocus } from './focus.js';

// ====== Module-scope state ======

let visible = false;
let text = '';

// Single auto-hide timer handle. Cleared then re-armed on every show(), so three
// chords inside the window leave exactly one pending timer showing the latest text.
let autoHideHandle = null;
const HIDE_MS = 2000;

// Injected deps (set by wireToast).
let toastElRef = null;
let toastTextElRef = null;

// ====== wireToast initializer ======

export function wireToast(opts) {
    const { toastEl, toastTextEl } = opts;
    toastElRef = toastEl;
    toastTextElRef = toastTextEl;

    // AD-10 — focus retention on the toast (mousedown → preventDefault, the
    // non-focus-owning branch, so no restoreTarget is needed). retainFocus is the
    // shared primitive (E0.1); do not hand-roll.
    if (toastEl) retainFocus(toastEl);

    refresh();   // initial render with the hidden state

    return {
        show,
        hide,
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

// wireXxx shape parity (AD-2). Unlike command-history.js's near-no-op dispose, this
// module genuinely has something to drop: a pending auto-hide timer that would fire
// against a torn-down element. The retainFocus mousedown listener lives and dies with
// the element itself, so there is nothing to detach here.
function dispose() {
    clearAutoHide();
    visible = false;
    text = '';
}

// ====== Public API ======

// Show `msg` for HIDE_MS, replacing whatever was showing. Re-arming (rather than
// stacking) is what makes rapid re-toggling read as "latest state only".
export function show(msg) {
    clearAutoHide();
    text = String(msg ?? '');
    visible = true;
    refresh();
    autoHideHandle = setTimeout(hide, HIDE_MS);
}

export function hide() {
    clearAutoHide();
    visible = false;
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
    if (!visible) {
        toastElRef.setAttribute('hidden', '');
        return;
    }
    toastTextElRef.textContent = text;
    // The label is the whole message: aria-atomic="true" means AT re-announces the
    // element as a unit, so a stale label would be read instead of the new text.
    toastElRef.setAttribute('aria-label', text);
    toastElRef.removeAttribute('hidden');
}

// ====== Test introspection (matches the window.__* pattern across the project) ======

export function __getStateForTests() {
    return {
        visible,
        text,
        hasAutoHideTimer: autoHideHandle !== null,
    };
}

export function __resetForTests() {
    clearAutoHide();
    visible = false;
    text = '';
    if (toastElRef) toastElRef.setAttribute('hidden', '');
    if (toastTextElRef) toastTextElRef.textContent = '';
}
