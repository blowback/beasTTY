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
    setPhosphor,
    setFont,
    zoomStep,
    resetZoom,
    setFocus,
    getActiveTheme,
    getActivePhosphor,
    getActiveFont,
    getActiveZoom as getActiveZoomFn,
} from './canvas.js';
// Epic E0 Story E0.1 (AD-10) — shared focus-retention helper. Picks the right
// branch (mousedown-preventDefault for buttons, change-restore for <select>)
// so callers stop hand-writing either one.
import { retainFocus } from './focus.js';

function labelFor(destinationThemeName) {
    // The button label shows the theme the user will switch TO on click.
    return destinationThemeName === 'crt' ? 'CRT' : 'Clean';
}

// Phase 11 Plan 11-04 D-13 / SLIDE-31 — module-scope refs for the
// visibilitychange + pagehide CTRL_CAN best-effort branches. Set inside
// wireChrome from opts; remain null when wireChrome is called from older
// boot paths or test harnesses that don't pass the new opts (the branch
// gates on the predicate so a null ref is a no-op).
let isSlideActiveRef = null;
let cancelSlideRecvRef = null;
let txSinkRef = null;

function applyThemeSideEffects(newTheme, { themeButton, phosphorGroup }) {
    // Body attribute drives scanline visibility via CSS (RENDER-04 / D-11).
    document.body.setAttribute('data-theme', newTheme);
    // Phosphor group is hidden in clean theme (D-12).
    phosphorGroup.hidden = (newTheme !== 'crt');
    // Bitmap font selector is CRT-only — clean theme renders vector glyphs.
    const fontRow = document.getElementById('font-row');
    if (fontRow) fontRow.hidden = (newTheme !== 'crt');
    // Button label shows the OTHER theme name (UI-SPEC Copywriting).
    const destination = (newTheme === 'crt') ? 'clean' : 'crt';
    themeButton.textContent = labelFor(destination);
}

function applyPhosphorSideEffects(selectedColor, phosphorButtons) {
    // Update aria-pressed on every phosphor button.
    for (const btn of phosphorButtons) {
        btn.setAttribute('aria-pressed', btn.dataset.phosphor === selectedColor ? 'true' : 'false');
    }
}

function toggleTheme(ctx) {
    const current = getActiveTheme().name;
    const destination = (current === 'crt') ? 'clean' : 'crt';
    setTheme(destination);
    applyThemeSideEffects(destination, ctx);
}

export function wireChrome(opts) {
    const {
        terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay, requestFrame,
        // Epic E1 Story E1.3 (AD-13) — the two Clear buttons relocated to
        // menu-bar.js, so `term` / `getScrollState` no longer arrive here.
        // `requestFrame` STAYS: the visibilitychange catch-up repaint uses it.
        // Phase 6 Plan 06 (Wave 5) — pref persistence + Settings new rows.
        // prefs:        starting blob (loadPrefs() result) — used for the Auto
        //               connect checkbox's initial DOM state at boot.
        // savePrefs:    debounced merge-and-persist; called on every theme /
        //               phosphor / zoom / Auto-connect change.
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
    const ctx = { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay };

    // Phase 11 Plan 11-04 D-13 — bind module-scope refs for the SLIDE
    // best-effort CTRL_CAN branch (visibilitychange + pagehide listeners
    // below).
    isSlideActiveRef = isSlideActive || null;
    cancelSlideRecvRef = cancelSlideRecv || null;
    txSinkRef = txSink || null;

    // Initial paint of chrome side-effects (reflects canvas.js default state).
    applyThemeSideEffects(getActiveTheme().name, ctx);
    applyPhosphorSideEffects(getActivePhosphor(), phosphorButtons);

    // ==== Epic E1 Story E1.3 (AD-13) — Clear buttons relocated to menu-bar.js ====
    // The #clear-button (top-bar) and #clear-scrollback-button (Settings) click
    // handlers moved OUT of chrome.js this story. menu-bar.js is now their sole
    // owner (clearScreen / clearScrollback), routing the same clear_visible /
    // resize_scrollback(0)→(10000) / snapToBottom / requestFrame semantics. No
    // behaviour changed — only the ownership. Do NOT re-wire them here.

    // ==== Theme toggle button (click) ====
    themeButton.addEventListener('click', () => {
        toggleTheme(ctx);
        // Phase 6 Plan 06 (PREF-01) — persist new theme. getActiveTheme().name
        // reads the post-toggle value (toggleTheme already called setTheme above).
        if (savePrefs) savePrefs({ theme: getActiveTheme().name });
    });
    // Phase 4 D-16 — focus retention: suppress native focus transfer on mouse
    // click so #terminal-wrapper keeps focus. mousedown fires BEFORE focus
    // move; preventDefault at this phase blocks it entirely. Click handler
    // above still fires (click and mousedown are separate events).
    // Keyboard activation (Tab-to-button + Space) is unaffected because
    // mousedown does not fire on keyboard activation.
    // Epic E0 Story E0.1 (AD-10) — relocated into the shared retainFocus helper.
    retainFocus(themeButton);

    // ==== Phosphor radio-group (click) ====
    for (const btn of phosphorButtons) {
        btn.addEventListener('click', () => {
            const color = btn.dataset.phosphor;
            if (color !== 'green' && color !== 'amber' && color !== 'white') return;
            setPhosphor(color);
            applyPhosphorSideEffects(color, phosphorButtons);
            // Phase 6 Plan 06 (PREF-01) — persist phosphor choice.
            if (savePrefs) savePrefs({ phosphor: color });
        });
        retainFocus(btn);                  // Phase 4 D-16 — focus retention (AD-10).
    }

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
            toggleTheme(ctx);
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
    // so a fresh page reflects persisted state. Hidden in clean theme by
    // applyThemeSideEffects above (vector rasteriser ignores font selection).
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
