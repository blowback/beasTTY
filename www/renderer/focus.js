// Beastty Epic E0 Story E0.1 — Focus-retention helper (retainFocus).
//
// Factors the two existing inline focus-retention patterns into one leaf
// helper (AD-10). Every interactive chrome control must hand keyboard focus
// back to #terminal-wrapper so keystrokes keep flowing to the Z80
// (NFR-1, UX-DR9 "Sacred").
//
// Two branches, picked by focus CAPABILITY (not a single tag name):
//   - focus-owning controls (<select>, text <input>, <textarea>, contenteditable)
//                 → these MUST hold focus to function: a <select> needs the
//                   native focus transfer to open its picker, and a text field
//                   needs the caret. mousedown-preventDefault would make them
//                   unusable (unopenable picker / unplaceable caret) — a SILENT
//                   "Sacred" trap. So we restore focus to restoreTarget on
//                   'change' (fires on commit/blur) instead of suppressing the
//                   focus transfer. restoreTarget is mandatory for this branch.
//   - everything else (buttons, checkbox/radio <input>, button-like elements)
//                 → these do NOT need focus. mousedown fires BEFORE the focus
//                   move; preventDefault at this phase blocks the focus transfer
//                   entirely. The element's own click/change handler still fires
//                   (click and mousedown are separate events), and keyboard
//                   activation (Tab + Space/Enter) is unaffected because
//                   mousedown does not fire on keyboard activation.
//
// AD-1: no build step, native ESM, named exports only (no default).
// AD-2: carries test hooks (__getStateForTests / __resetForTests) but is a
//       leaf helper (like modal.js), so it has no wireXxx initializer.
// AD-3: zero imports — restoreTarget is passed in by the caller; focus.js
//       must never reach for #terminal-wrapper itself.

// Module-scope registry of wired elements. We store lightweight descriptors
// (never live DOM refs) so __getStateForTests can be serialised across the
// Playwright evaluate boundary and can never leak a mutable module reference.
const retained = [];

// Idempotency guard: already-wired elements are skipped so a repeat
// retainFocus(el) (re-init, hot reload, test re-wire) is a no-op instead of
// stacking duplicate listeners and double-counting in the registry. WeakSet
// holds no strong ref, so it never keeps a detached element alive.
let wired = new WeakSet();

// Text-entry <input> types that own a caret (as opposed to button/checkbox/radio
// inputs, which do not). Kept as a set so the branch keys on focus-capability,
// not on a single hard-coded tag name.
const TEXT_INPUT_TYPES = new Set(
    ['text', 'search', 'url', 'email', 'tel', 'password', 'number'],
);

// A control needs the native focus transfer (so it must NOT get the
// mousedown-preventDefault branch) when it is a <select>, a <textarea>, a
// contenteditable host, or a text-entry <input>. Everything else (buttons,
// checkbox/radio inputs, button-like elements) is safe to suppress.
function needsNativeFocus(el) {
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el.type || '').toLowerCase());
    return false;
}

export function retainFocus(el, restoreTarget) {
    if (!el) return el;
    if (wired.has(el)) return el;
    if (needsNativeFocus(el)) {
        // Focus-owning control (<select> / text input / textarea / contenteditable):
        // restore focus on change instead of suppressing mousedown, because
        // blocking mousedown would make it unusable (unopenable picker /
        // unplaceable caret). The restore target is mandatory here — without it
        // the helper would silently drop focus retention (NFR-1 "Sacred"
        // regression with no error), so fail loud. The whole point of AD-10 is
        // to stop callers hand-rolling focus retention wrong.
        if (!restoreTarget) {
            throw new TypeError('retainFocus() on a focus-owning control (<select>, text input, <textarea>, contenteditable) requires a restoreTarget to restore focus to on change');
        }
        el.addEventListener('change', () => {
            restoreTarget.focus();
        });
        retained.push({ tag: el.tagName, branch: 'change' });
    } else {
        // mousedown fires BEFORE focus move; preventDefault blocks the focus
        // transfer entirely while the click/change handler still fires.
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        retained.push({ tag: el.tagName, branch: 'mousedown' });
    }
    wired.add(el);
    return el;
}

// ====== Test introspection (matches the Phase 6/9/10/11 window.__* pattern) ======

export function __getStateForTests() {
    return {
        retainedCount: retained.length,
        elements: retained.map((r) => ({ ...r })),
    };
}

export function __resetForTests() {
    retained.length = 0;
    // Swap in a fresh WeakSet (WeakSet has no clear()) so re-wiring the SAME
    // element instance after a reset actually re-attaches instead of hitting the
    // idempotency skip — otherwise a re-wire test sees retainedCount stuck at 0.
    wired = new WeakSet();
}
