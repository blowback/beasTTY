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
    zoomStep,
    resetZoom,
    setFocus,
    getActiveTheme,
    getActiveZoom as getActiveZoomFn,
} from './canvas.js';
// Epic E0 Story E0.1 (AD-10) — shared focus-retention helper. Picks the right
// branch (mousedown-preventDefault for buttons, change-restore for <select>)
// so callers stop hand-writing either one.
// E7.1 — chrome.js no longer wires any interactive control that needs focus
// retention (the auto-connect + reset-prefs legacy controls retired with
// <details id="settings">), so the retainFocus import is gone. The surviving
// "show all serial devices" checkbox lives inside a focus-trapped modal (E2.3), so
// it deliberately does not use retainFocus.
// E7.1 — the reset 2-click confirm (labels + shared state machine) moved wholly to
// menu-bar.js's Settings ▸ Reset all preferences row with the legacy
// #reset-prefs-button's removal, so chrome.js no longer imports the reset labels or
// confirm-toggle. (prefs.js RESET_PREFS_* + confirm-toggle.js are still the single
// source — menu-bar.js imports them.)
// E6.1 fix (code-review #7) — the theme + zoom chord predicates are single-sourced in
// the shortcut registry that the Help ▸ Keyboard Shortcuts modal renders from, so the
// chord this handler matches and the chord the modal advertises can never diverge.
import { matchThemeToggle, matchZoomIn, matchZoomOut, matchZoomReset } from '../input/shortcuts.js';

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
// Epic E1 Story E1.5 (FR-10 / AD-6) — the zoom chord feeds the (future) status
// bar too, so the shortcut and the View ▸ Zoom items both push the new level.
// Optional; a null ref no-ops the push (status bar lands in E4).
let pushZoomRef = null;

function toggleTheme() {
    const current = getActiveTheme().name;
    const destination = (current === 'crt') ? 'clean' : 'crt';
    setTheme(destination);                        // E1.4 Task 1 — also sets body[data-theme]
    // Persist BEFORE the shared post-theme hook: onThemeChange re-projects the View
    // menu from getPrefs(), so the new theme must already be in the cached blob
    // (AD-4, synchronous) or an open menu would re-project to the stale theme.
    if (savePrefsRef) savePrefsRef({ theme: destination }); // persist the chord theme change
    if (onThemeChangeRef) onThemeChangeRef();               // re-project an open View menu (reads getPrefs)
}

// Persist the chord's new zoom level and mirror it to the status bar — shared by the
// three Ctrl+{=,-,0} handlers so the persist + AD-6 push are identical on every zoom
// chord (was copy-pasted per branch). Reads the CLAMPED getActiveZoom() (canvas clamps
// to [1,4]) so the persisted pref and the bar readout can never show an out-of-range
// level. Both refs optional — a null ref no-ops that half.
function pushZoomLevel() {
    if (savePrefsRef) savePrefsRef({ fontZoom: getActiveZoomFn() });   // Phase 6 Plan 06 (PREF-01)
    if (pushZoomRef) pushZoomRef(getActiveZoomFn());                   // E1.5 (AD-6) — status-bar push
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
        // Epic E1 Story E1.5 (AD-6) — imperative zoom→status-bar push. The chord
        // path pushes the new level so the status bar (E4) updates from the
        // shortcut too; no-op stub until E4 wires the real bar.
        pushZoom,
        // Phase 6 Plan 06 (Wave 5) — pref persistence.
        // prefs:        starting blob (loadPrefs() result) — used for the "show all
        //               serial devices" checkbox's initial DOM state at boot.
        // savePrefs:    debounced merge-and-persist; called on the Ctrl+Alt+T theme
        //               chord / zoom / show-all-serial-devices change.
        // E7.1 — resetPrefs opt dropped: the reset surface moved wholly to the
        // Settings menu (the legacy #reset-prefs-button retired with <details>).
        prefs,
        savePrefs,
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
    pushZoomRef = pushZoom || null;   // E1.5 (AD-6) — zoom status-bar push on the chord path

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
        // Ctrl+Alt+T (no extra modifier). Predicate lives in the shortcut registry.
        if (matchThemeToggle(e)) {
            e.preventDefault();          // SYNCHRONOUS first — RESEARCH Pitfall #3.
            toggleTheme();
            return;
        }
        // Ctrl+{+, -, 0} — half-step zoom 1..3× (RENDER-09 / D-10). Each registry
        // predicate carries the full modifier guard, so the trio is three standalone
        // checks (no shared outer `if`); the persist + status-bar push are identical.
        if (matchZoomIn(e)) {
            e.preventDefault();
            zoomStep(+0.5);
            pushZoomLevel();
            return;
        }
        if (matchZoomOut(e)) {
            e.preventDefault();
            zoomStep(-0.5);
            pushZoomLevel();
            return;
        }
        if (matchZoomReset(e)) {
            e.preventDefault();
            resetZoom();
            pushZoomLevel();
            return;
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
        // E11 S11.4 (2026-08-05) — hiding the tab NO LONGER cancels an active
        // SLIDE session. Phase 11 Plan 11-04 D-13 / SLIDE-31 fired a cancel +
        // raw CTRL_CAN here, but its own rationale is about teardown ("the
        // browser may not flush the wire before the tab closes") — which is
        // what pagehide signals. Split View makes "hidden" an ordinary state
        // during a transfer: selecting another tab would destroy a healthy
        // one. The cancel + CTRL_CAN pair is kept verbatim on pagehide below.
        // Recorded as a dated amendment to AD-13 in ARCHITECTURE-SPINE.md and
        // docs/architecture-www.md — AD-13 forbids losing that behaviour
        // silently, not narrowing it deliberately.
    });

    // Phase 11 Plan 11-04 D-13 / SLIDE-31 — since E11 S11.4 this is the SOLE
    // hide trigger for the cancel (visibilitychange no longer fires it), and
    // it is the one D-13's rationale actually argues for: the page is really
    // going away, and the browser may not flush the wire before it does.
    // pagehide is also the spec-guaranteed signal for bfcache eviction, where
    // modern Chromium's visibilitychange-on-tab-close is not.
    //
    // Fire-and-forget, best-effort: the try/catch wrappers stop errors
    // propagating during teardown (PITFALLS §6), and there is no await — an
    // unflushed wire is acceptable per CONTEXT D-13. The 0x18 byte is the
    // SLIDE CTRL_CAN per ADR-003. Calling cancelSlideRecv (the Phase 10 D-15
    // 5-step cancel state machine) AND writing 0x18 is intentional double
    // safety: the state machine emits its own CTRL_CAN via slide.cancel(),
    // and the writeSlideFrame is a last-ditch direct-to-wire call for the case
    // where the SM has already moved past CancelPending. The isSlideActiveRef()
    // guard plus D-15's cancelInFlight latch make repeat calls no-ops.
    window.addEventListener('pagehide', () => {
        if (isSlideActiveRef && isSlideActiveRef()) {
            try { if (cancelSlideRecvRef) cancelSlideRecvRef(); } catch {}
            try { if (txSinkRef && txSinkRef.writeSlideFrame) txSinkRef.writeSlideFrame(new Uint8Array([0x18])); } catch {}
        }
    });

    // ==== Epic E1 Story E1.5 (AD-7) — bitmap font selector retired ====
    // The #font-select change handler moved OUT of chrome.js this story.
    // menu-bar.js (View ▸ Font radio submenu) is now its sole owner, calling the
    // SAME setFont + savePrefs verbatim, and — per AD-9 — showing the submenu
    // disabled off-CRT instead of the old #font-row hide. Do NOT re-wire it here.

    // ==== Epic E7 Story E7.1 (AD-7) — auto-connect checkbox wiring removed ====
    // The legacy #auto-connect-checkbox retired with <details id="settings">.
    // Connection ▸ Auto connect on load (menu-bar.js checkable) is now the sole
    // surface; its handler already calls savePrefs({ autoConnect }). Removing this
    // wiring (not merely null-guarding it) keeps boot from throwing on the absent node.

    // ==== "Show all serial devices" checkbox ====
    // When on, the Connect picker drops the CP2102N VID/PID filter so users
    // with non-stock USB-serial bridges (FTDI, CH340, CP2104) or virtual COM
    // ports can see their device. serial.js reads the live pref via getPrefs()
    // at requestPort time, so the checkbox takes effect on the next Connect
    // click without needing a reload.
    // E2.3 (FR-15, Task 5) — this checkbox MOVED into #serial-config-modal. Inside a
    // focus-trapped <dialog> the terminal is inert behind the scrim, so the AD-10
    // retainFocus terminal-restore is both meaningless (keystrokes can't reach the Z80
    // while the modal is open) and wrong (it fought the trap). Dropped — focus stays in
    // the modal on the control until Close, where openModal's restoreTo returns it to
    // #terminal-wrapper (NFR-1). The change→savePrefs wiring is unchanged (resolves by
    // id regardless of the checkbox's new DOM home).
    const showAllSerialCheckbox = document.getElementById('show-all-serial-devices');
    if (showAllSerialCheckbox) {
        showAllSerialCheckbox.checked = !!(prefs && prefs.showAllSerialDevices);
        showAllSerialCheckbox.addEventListener('change', (e) => {
            if (savePrefs) savePrefs({ showAllSerialDevices: e.target.checked });
        });
    }

    // ==== Epic E7 Story E7.1 (AD-7) — reset-prefs 2-click confirm removed ====
    // The legacy #reset-prefs-button retired with <details id="settings">.
    // Settings ▸ Reset all preferences (menu-bar.js) is a SEPARATE, independent
    // 2-click machine (shared confirm-toggle.js + resetPrefs()) and remains the sole
    // reset surface. Removing this wiring keeps boot from throwing on the absent node.

    // Auto-focus the wrapper at boot so cursor blinks and Ctrl+Shift+T works immediately.
    terminalWrapper.focus();
}
