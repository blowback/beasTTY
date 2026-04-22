// BestialiTTY Phase 3 — DOM event wiring for the canvas chrome.
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
    zoomStep,
    resetZoom,
    setFocus,
    getActiveTheme,
    getActivePhosphor,
} from './canvas.js';

function labelFor(destinationThemeName) {
    // The button label shows the theme the user will switch TO on click.
    return destinationThemeName === 'crt' ? 'CRT' : 'Clean';
}

function applyThemeSideEffects(newTheme, { themeButton, phosphorGroup }) {
    // Body attribute drives scanline visibility via CSS (RENDER-04 / D-11).
    document.body.setAttribute('data-theme', newTheme);
    // Phosphor group is hidden in clean theme (D-12).
    phosphorGroup.hidden = (newTheme !== 'crt');
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
    const { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay } = opts;
    const ctx = { terminalWrapper, themeButton, phosphorButtons, phosphorGroup, bellOverlay };

    // Initial paint of chrome side-effects (reflects canvas.js default state).
    applyThemeSideEffects(getActiveTheme().name, ctx);
    applyPhosphorSideEffects(getActivePhosphor(), phosphorButtons);

    // ==== Theme toggle button (click) ====
    themeButton.addEventListener('click', () => {
        toggleTheme(ctx);
    });

    // ==== Phosphor radio-group (click) ====
    for (const btn of phosphorButtons) {
        btn.addEventListener('click', () => {
            const color = btn.dataset.phosphor;
            if (color !== 'green' && color !== 'amber' && color !== 'white') return;
            setPhosphor(color);
            applyPhosphorSideEffects(color, phosphorButtons);
        });
    }

    // ==== Keyboard shortcuts (keydown on wrapper — synchronous preventDefault) ====
    terminalWrapper.addEventListener('keydown', (e) => {
        // Ctrl+Shift+T — theme toggle (RENDER-07 / D-14).
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
            e.preventDefault();          // SYNCHRONOUS first — RESEARCH Pitfall #3.
            toggleTheme(ctx);
            return;
        }
        // Ctrl+{+, -, 0} — integer zoom (RENDER-09 / D-10).
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
            if (e.code === 'Equal' || e.code === 'NumpadAdd') {
                e.preventDefault();
                zoomStep(+1);
                return;
            }
            if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
                e.preventDefault();
                zoomStep(-1);
                return;
            }
            if (e.code === 'Digit0' || e.code === 'Numpad0') {
                e.preventDefault();
                resetZoom();
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
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && document.title.startsWith('(!) ')) {
            document.title = document.title.slice(4);
        }
    });

    // Auto-focus the wrapper at boot so cursor blinks and Ctrl+Shift+T works immediately.
    terminalWrapper.focus();
}
