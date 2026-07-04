// Beastty — two-click "click again to confirm" state machine (shared).
//
// D-35 — the destructive Reset-all-preferences action is guarded by a deliberate
// 2-click confirm: the first activation swaps the control's label to a countdown
// prompt and arms a revert timer; a second activation within the window commits.
//
// Settings ▸ Reset all preferences (menu-bar.js) drives the reset. This module is
// the ONE implementation of the arm / commit / disarm semantics + the confirm
// window (E7.1 retired the legacy #reset-prefs-button/chrome.js surface, leaving
// this the sole shared machine — previously the whole machine was hand-copied
// into both, and the menu copy silently depended on every dropdown-close path
// remembering to disarm an armed timer — a leaked timer could commit a destructive
// reset on an unrelated later click).
//
// The caller supplies WHERE the label lives (getLabelEl — a function so the menu
// row can resolve its .lbl child at call time) and WHAT to run on commit; the
// caller keeps ownership of surface behavior (a menu keeps itself open on `armed`,
// closes on `committed`).

// makeTwoClickConfirm({ getLabelEl, idleLabel, confirmLabel, windowMs?, onCommit? })
//   → { activate(), disarm(), isArmed() }
//
// activate() drives one click: returns 'armed' on the first (label → confirm, timer
// started) and 'committed' on the second within the window (disarms, then runs
// onCommit). disarm() is the external cancel — call it from every path that dismisses
// the surface (menu close / Esc / switch / dispose) so an armed timer never survives.
export function makeTwoClickConfirm({ getLabelEl, idleLabel, confirmLabel, windowMs = 3000, onCommit }) {
    let timer = null;

    function setLabel(text) {
        const el = getLabelEl();
        if (el) el.textContent = text;
    }

    function disarm() {
        if (timer === null) return;   // idle — nothing to disarm
        clearTimeout(timer);
        timer = null;
        setLabel(idleLabel);
    }

    function activate() {
        if (timer === null) {
            setLabel(confirmLabel);
            timer = setTimeout(disarm, windowMs);
            return 'armed';
        }
        disarm();            // clear the timer + revert the label
        onCommit?.();        // then run the destructive action
        return 'committed';
    }

    return { activate, disarm, isArmed: () => timer !== null };
}
