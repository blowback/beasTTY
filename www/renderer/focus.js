// Beastty Epic E0 Story E0.1 — Focus-retention helper (retainFocus).
//
// Factors the two existing inline focus-retention patterns into one leaf
// helper (AD-10). Every interactive chrome control must hand keyboard focus
// back to #terminal-wrapper so keystrokes keep flowing to the Z80
// (NFR-1, UX-DR9 "Sacred").
//
// Two branches, picked by element type:
//   - <select>  → needs the native focus transfer to open its picker, so we
//                 cannot use the mousedown-preventDefault pattern that buttons
//                 and radios use; restore focus to restoreTarget on 'change'.
//   - everything else (buttons, checkbox/radio <input>, button-like elements)
//                 → mousedown fires BEFORE the focus move; preventDefault at
//                   this phase blocks the focus transfer entirely. The
//                   element's own click/change handler still fires (click and
//                   mousedown are separate events), and keyboard activation
//                   (Tab + Space/Enter) is unaffected because mousedown does
//                   not fire on keyboard activation.
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
const wired = new WeakSet();

export function retainFocus(el, restoreTarget) {
    if (!el) return el;
    if (wired.has(el)) return el;
    if (el.tagName === 'SELECT') {
        // <select> needs the native focus transfer to open its picker, so we
        // restore focus on change instead of suppressing mousedown. The
        // restore target is mandatory here — without it the helper would
        // silently drop focus retention (NFR-1 "Sacred" regression with no
        // error), so fail loud. The whole point of AD-10 is to stop callers
        // hand-rolling focus retention wrong.
        if (!restoreTarget) {
            throw new TypeError('retainFocus(<select>) requires a restoreTarget to restore focus to on change');
        }
        el.addEventListener('change', () => {
            restoreTarget.focus();
        });
        retained.push({ tag: el.tagName, branch: 'select' });
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
}
