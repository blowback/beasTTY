// Beastty Phase 3 — DOM event wiring for the canvas chrome.
//
// Consumes Plan 02's www/renderer/canvas.js public API:
//   setTheme / setPhosphor / zoomStep / resetZoom / setFocus / getActiveTheme
//   + getActivePhosphor.
//
// Source:
//   - CONTEXT D-12 (top-bar), D-14 (Ctrl+Shift+T), D-13 (focus wiring).
//   - RESEARCH §Keyboard Shortcut Capture + Pitfall #3 (synchronous preventDefault)
//     + Pitfall #10 (e.code, not e.key).
//   - UI-SPEC §Copywriting Contract (button label shows DESTINATION theme).

import {
    setTheme,
    setFont,
    zoomStep,
    resetZoom,
    setFocus,
    getActiveTheme,
    getActiveFont,
    getActiveZoom as getActiveZoomFn,
} from './canvas.js';
// Epic E0 Story E0.1 (AD-10) — shared focus-retention helper. Picks the right
// branch (mousedown-preventDefault for buttons, change-restore for <select>)
// so callers stop hand-writing either one.
import { retainFocus } from './focus.js';

// Phase 11 Plan 11-04 D-13 / SLIDE-31 — module-scope refs for the
// visibilitychange + pagehide CTRL_CAN best-effort branches. Set inside
// wireChrome from opts; remain null when wireChrome is called from older
// boot paths or test harnesses that don't pass the new opts (the branch
// gates on the predicate so a null ref is a no-op).
let isSlideActiveRef = null;
let cancelSlideRecvRef = null;
let txSinkRef = null;

// Epic E1 Story E1.4 — the theme/phosphor CONTROLS retired to the View menu
// (menu-bar.js owns them, AD-7), but the Ctrl+Alt+T chord STAYS here (AD-13).
// toggleTheme is now the chord's only caller; it drives only the surviving
// side-effects. onThemeChangeRef re-gates #font-row (the retired
// applyThemeSideEffects used to); savePrefsRef persists the chord's theme
// change (the retired button handler persisted — the chord path does now too).
let onThemeChangeRef = null;
let savePrefsRef = null;

function toggleTheme() {
    const current = getActiveTheme().name;
    const destination = (current === 'crt') ? 'clean' : 'crt';
    setTheme(destination);                        // E1.4 Task 1 — also sets body[data-theme]
    // Persist BEFORE the shared post-theme hook: onThemeChange re-projects the View
    // menu from getPrefs(), so the new theme must already be in the cached blob
    // (AD-4, synchronous) or an open menu would re-project to the stale theme.
    if (savePrefsRef) savePrefsRef({ theme: destination }); // persist the chord theme change
    if (onThemeChangeRef) onThemeChangeRef(destination);    // #font-row CRT-gate + re-project open View menu
}

export function wireChrome(opts) {
    const {
        terminalWrapper, bellOverlay, requestFrame,
        // Epic E1 Story E1.3 (AD-13) — the two Clear buttons relocated to
        // menu-bar.js, so `term` / `getScrollState` no longer arrive here.
        // `requestFrame` STAYS: the visibilitychange catch-up repaint uses it.
        // Epic E1 Story E1.4 (AD-13) — #theme-toggle / #phosphor-group retired to
        // the View menu; only the Ctrl+Alt+T chord stays here. onThemeChange
        // re-gates #font-row on the chord path (the retired applyThemeSideEffects
        // used to).
        onThemeChange,
        // Phase 6 Plan 06 (Wave 5) — pref persistence + Settings new rows.
        // prefs:        starting blob (loadPrefs() result) — used for the Auto
        //               connect checkbox's initial DOM state at boot.
        // savePrefs:    debounced merge-and-persist; called on the Ctrl+Alt+T
        //               theme chord / zoom / Auto-connect change.
        // resetPrefs:   D-35 reset-all-preferences trigger.
        prefs,
        savePrefs,
        resetPrefs,
        // Phase 11 Plan 11-04 D-13 / SLIDE-31 — fire-and-forget CTRL_CAN
        // emission on hide / pagehide during active SLIDE session. All three
        // refs are optional; missing refs disable the branch (production
        // main.js boot wires all three, tests that don't pass them retain
        // pre-Phase-11 visibilitychange behaviour).
        isSlideActive,
        cancelSlideRecv,
        txSink,
    } = opts;

    // Phase 11 Plan 11-04 D-13 — bind module-scope refs for the SLIDE
    // best-effort CTRL_CAN branch (visibilitychange + pagehide listeners
    // below).
    isSlideActiveRef = isSlideActive || null;
    cancelSlideRecvRef = cancelSlideRecv || null;
    txSinkRef = txSink || null;
    // Epic E1 Story E1.4 — bind the chord's surviving side-effect refs
    // (#font-row gate + theme persistence). Both optional (guarded at use).
    onThemeChangeRef = onThemeChange || null;
    savePrefsRef = savePrefs || null;

    // ==== Epic E1 Story E1.3 (AD-13) — Clear buttons relocated to menu-bar.js ====
    // The #clear-button (top-bar) and #clear-scrollback-button (Settings) click
    // handlers moved OUT of chrome.js this story. menu-bar.js is now their sole
    // owner (clearScreen / clearScrollback), routing the same clear_visible /
    // resize_scrollback(0)→(10000) / snapToBottom / requestFrame semantics. No
    // behaviour changed — only the ownership. Do NOT re-wire them here.

    // ==== Epic E1 Story E1.4 (AD-7) — theme/phosphor controls retired ====
    // The #theme-toggle button click + #phosphor-group radio loop moved OUT of
    // chrome.js this story. menu-bar.js (View ▸ Theme / Phosphor) is now their
    // sole owner, calling the SAME setTheme / setPhosphor + savePrefs verbatim.
    // Only the Ctrl+Alt+T chord below remains here (AD-13). Do NOT re-wire them.

    // ==== Keyboard shortcuts (keydown on wrapper — synchronous preventDefault) ====
    terminalWrapper.addEventListener('keydown', (e) => {
        // Ctrl+Alt+T — theme toggle (RENDER-07).
        // NOTE: Ctrl+Shift+T was the original chord per CONTEXT D-14 but Chromium
        // reserves it for "reopen closed tab" with no page-level override
        // (RESEARCH §Pitfall 3, reaffirmed by 03-UAT gap #4). Ctrl+Alt+T is
        // the standard Linux/GNOME/i3 "open terminal" chord and is hookable
        // from a web page — the Chromium default is a no-op on this chord.
        // Do NOT include e.shiftKey: Alt+Shift+T already maps to "pin tab" on
        // some Chromium builds, and we want the chord to work with exactly
        // Ctrl+Alt+T (no extra modifier).
        if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyT') {
            e.preventDefault();          // SYNCHRONOUS first — RESEARCH Pitfall #3.
            toggleTheme();
            return;
        }
        // Ctrl+{+, -, 0} — integer zoom (RENDER-09 / D-10).
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
            if (e.code === 'Equal' || e.code === 'NumpadAdd') {
                e.preventDefault();
                zoomStep(+1);
                if (savePrefs) savePrefs({ fontZoom: getActiveZoomFn() });   // Phase 6 Plan 06 (PREF-01)
                return;
            }
            if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
                e.preventDefault();
                zoomStep(-1);
                if (savePrefs) savePrefs({ fontZoom: getActiveZoomFn() });   // Phase 6 Plan 06 (PREF-01)
                return;
            }
            if (e.code === 'Digit0' || e.code === 'Numpad0') {
                e.preventDefault();
                resetZoom();
                if (savePrefs) savePrefs({ fontZoom: getActiveZoomFn() });   // Phase 6 Plan 06 (PREF-01)
                return;
            }
        }
        // Any other key: Phase 4 will claim character-encoding keys here.
    });

    // ==== Focus indicator (RENDER-03 / D-13) ====
    // canvas.js owns the cursor-style change; chrome.js wires focus/blur to
    // setFocus. The CSS :focus-visible on #terminal-wrapper drives the border.
    terminalWrapper.addEventListener('focus', () => {
        terminalWrapper.setAttribute('data-focused', 'true');
        setFocus(true);
    });
    terminalWrapper.addEventListener('blur', () => {
        terminalWrapper.setAttribute('data-focused', 'false');
        setFocus(false);
    });

    // Clicking anywhere in the wrapper focuses it (defensive — tabindex=0 already does this).
    terminalWrapper.addEventListener('click', () => {
        if (document.activeElement !== terminalWrapper) {
            terminalWrapper.focus();
        }
    });

    // ==== Visibility-change listener — clears '(!) ' title prefix on foreground return ====
    // The add-prefix half lives in main.js (synchronous after term.feed when document.hidden).
    // This is the ONLY visibilitychange listener in Phase 3 — canvas.js does not listen.
    // Phase 5 D-39 — additive: catch-up paint on foreground return (Pitfall #6).
    // The async read loop kept feeding `term` throughout the hidden period; this
    // wakes the renderer to paint the accumulated state immediately instead of
    // waiting for the next natural rAF tick (which Chromium throttles to ~1 Hz
    // on hidden tabs). requestFrame is defensively-optional so tests that call
    // wireChrome without it fall back to Phase 3 BEL-prefix-only behavior.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && document.title.startsWith('(!) ')) {
            document.title = document.title.slice(4);
        }
        if (!document.hidden && requestFrame) requestFrame();
        // Phase 11 Plan 11-04 D-13 / SLIDE-31 — fire-and-forget CTRL_CAN on
        // hide during active SLIDE session. Best-effort: try/catch wrappers
        // prevent error propagation during page teardown (PITFALLS §6 — page
        // is hidden / unloading; errors must NOT propagate). No await — the
        // browser may not flush the wire before the tab closes, and that is
        // acceptable per CONTEXT D-13. The 0x18 byte is the SLIDE CTRL_CAN
        // per ADR-003. cancelSlideRecv is the Phase 10 D-15 5-step cancel
        // state machine; calling it AND writing 0x18 is intentional double
        // safety (the cancel state machine internalises its own CTRL_CAN
        // emission via slide.cancel(), and the writeSlideFrame is a
        // last-ditch direct-to-wire call in case the SM has already
        // transitioned past CancelPending — Phase 10 D-15 cancelInFlight
        // guard makes this idempotent).
        if (document.visibilityState === 'hidden' && isSlideActiveRef && isSlideActiveRef()) {
            try { if (cancelSlideRecvRef) cancelSlideRecvRef(); } catch {}
            try { if (txSinkRef && txSinkRef.writeSlideFrame) txSinkRef.writeSlideFrame(new Uint8Array([0x18])); } catch {}
        }
    });

    // Phase 11 Plan 11-04 D-13 / SLIDE-31 — pagehide is the bfcache-safe
    // complement to visibilitychange. modern Chromium fires visibilitychange
    // on tab close, but pagehide is the spec-guaranteed signal for bfcache
    // eviction. Body mirrors the visibilitychange SLIDE branch verbatim;
    // the inner isSlideActiveRef() guard ensures duplicate calls are safe
    // (the second one no-ops because slide.cancel() already transitioned
    // to CancelPending).
    window.addEventListener('pagehide', () => {
        if (isSlideActiveRef && isSlideActiveRef()) {
            try { if (cancelSlideRecvRef) cancelSlideRecvRef(); } catch {}
            try { if (txSinkRef && txSinkRef.writeSlideFrame) txSinkRef.writeSlideFrame(new Uint8Array([0x18])); } catch {}
        }
    });

    // ==== Bitmap font selector (CRT-only) ====
    // Same-value short-circuit lives inside setFont; persists via savePrefs so
    // the choice survives a reload. Initial DOM value mirrors the loaded blob
    // so a fresh page reflects persisted state. #font-row is CRT-gated by the
    // onThemeChange helper (main.js) — invoked at boot via applyPrefs and on
    // every theme change (chord + View ▸ Theme) — since the retired
    // applyThemeSideEffects no longer hides it (vector rasteriser ignores font).
    const fontSelect = document.getElementById('font-select');
    if (fontSelect) {
        fontSelect.value = (prefs && prefs.font) || getActiveFont();
        fontSelect.addEventListener('change', (e) => {
            setFont(e.target.value);
            if (savePrefs) savePrefs({ font: e.target.value });
        });
        // Restore wrapper focus after the dropdown closes — Phase 4 D-16. The
        // <select> branch of the shared helper owns this (it restores on change
        // because a select needs the native focus transfer to open its picker).
        retainFocus(fontSelect, terminalWrapper);
    }

    // ==== Phase 6 Plan 06 (Wave 5) — Auto connect checkbox (D-34) ====
    // Toggle saves prefs.autoConnect; takes effect on NEXT page load (no
    // immediate connect/disconnect on toggle). Initial DOM state mirrors the
    // loaded blob so a fresh page always reflects persisted state.
    const autoConnectCheckbox = document.getElementById('auto-connect-checkbox');
    if (autoConnectCheckbox) {
        autoConnectCheckbox.checked = !!(prefs && prefs.autoConnect);
        autoConnectCheckbox.addEventListener('change', (e) => {
            if (savePrefs) savePrefs({ autoConnect: e.target.checked });
        });
        retainFocus(autoConnectCheckbox);   // Phase 4 D-16 — focus retention (AD-10).
    }

    // ==== "Show all serial devices" checkbox ====
    // When on, the Connect picker drops the CP2102N VID/PID filter so users
    // with non-stock USB-serial bridges (FTDI, CH340, CP2104) or virtual COM
    // ports can see their device. serial.js reads the live pref via getPrefs()
    // at requestPort time, so the checkbox takes effect on the next Connect
    // click without needing a reload.
    const showAllSerialCheckbox = document.getElementById('show-all-serial-devices');
    if (showAllSerialCheckbox) {
        showAllSerialCheckbox.checked = !!(prefs && prefs.showAllSerialDevices);
        showAllSerialCheckbox.addEventListener('change', (e) => {
            if (savePrefs) savePrefs({ showAllSerialDevices: e.target.checked });
        });
        retainFocus(showAllSerialCheckbox);   // Phase 4 D-16 — focus retention (AD-10).
    }

    // ==== Phase 6 Plan 06 (Wave 5) — Reset prefs 2-click confirm (D-35) ====
    // First click swaps label to "Click again to confirm (3 s)" and arms a
    // 3-second timer that reverts. Second click within 3 s commits the reset:
    // clears beastty.prefs, in-memory blob replaced with defaults,
    // subscribers fire (applyPrefs in main.js re-applies defaults to chrome /
    // canvas state in-place — NO page reload per D-35).
    const resetPrefsButton = document.getElementById('reset-prefs-button');
    const RESET_PREFS_IDLE_LABEL = 'Reset all preferences';
    const RESET_PREFS_CONFIRM_LABEL = 'Click again to confirm (3 s)';
    let resetPrefsConfirmTimer = null;
    if (resetPrefsButton) {
        resetPrefsButton.addEventListener('click', () => {
            if (resetPrefsConfirmTimer === null) {
                resetPrefsButton.textContent = RESET_PREFS_CONFIRM_LABEL;
                resetPrefsConfirmTimer = setTimeout(() => {
                    resetPrefsButton.textContent = RESET_PREFS_IDLE_LABEL;
                    resetPrefsConfirmTimer = null;
                }, 3000);
            } else {
                clearTimeout(resetPrefsConfirmTimer);
                resetPrefsConfirmTimer = null;
                if (resetPrefs) resetPrefs();
                resetPrefsButton.textContent = RESET_PREFS_IDLE_LABEL;
            }
        });
        retainFocus(resetPrefsButton);   // Phase 4 D-16 — focus retention (AD-10).
    }

    // Auto-focus the wrapper at boot so cursor blinks and Ctrl+Shift+T works immediately.
    terminalWrapper.focus();
}
