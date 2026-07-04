// Beastty — keyboard-shortcut registry: ONE source of truth for the chord handlers
// AND the Help ▸ Keyboard Shortcuts modal.
//
// The drift this ends (code-review #7): the modal was a hand-transcribed HTML table of
// chords that had to be kept in sync BY HAND with the real keydown handlers in
// chrome.js (theme / zoom) and keyboard.js (copy / paste). Rebind a chord in a handler
// and the Help modal silently started lying. Now each mechanical chord is ONE entry
// carrying both its display label (`keys` + `act`) AND the event predicate the handler
// matches on (`match`). chrome.js / keyboard.js call the predicate; main.js renders the
// modal rows from the same groups — change a chord here and the handler and the modal
// move together. tests/render/shortcuts-registry.spec.js pins each label to its
// predicate so the two halves of an entry can't drift either.
//
// Pure logic — no DOM, no imports — so both the renderer (chrome.js) and input
// (keyboard.js) layers can import it. Rows WITHOUT a `match` are informational: the Esc
// disambiguation chain (4-5 ordered handlers in keyboard.js, not one predicate), the
// Ctrl+A…Ctrl+Z control-code range (the default encode path), and the browser-claimed
// Ctrl+W/N/T combos (Chromium handles them — no page handler to bind). They render in
// the modal but have no single live handler to point at.

// ==== Chord predicates (KeyboardEvent → boolean) ====
// Each is the COMPLETE guard the handler used inline, modifiers included, so it holds
// standalone (chrome.js's zoom trio no longer needs a shared outer modifier `if`).
// `code`-based (physical key) so they are keyboard-layout independent, matching the
// handlers they replace.
export const matchThemeToggle = (e) =>
    e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyT';
export const matchZoomIn = (e) =>
    e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.code === 'Equal' || e.code === 'NumpadAdd');
export const matchZoomOut = (e) =>
    e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.code === 'Minus' || e.code === 'NumpadSubtract');
export const matchZoomReset = (e) =>
    e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.code === 'Digit0' || e.code === 'Numpad0');
export const matchCopy = (e) =>
    e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyC';
export const matchPaste = (e) =>
    e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyV';

// ==== Display registry ====
// Groups render top-to-bottom in the modal. Each row carries the <kbd> label (`keys`),
// the action text (`act`), and — for a mechanical chord — the `match` predicate the
// live handler uses. A group may carry a trailing `hint` paragraph.
export const SHORTCUT_GROUPS = [
    { heading: 'Display', rows: [
        { keys: 'Ctrl+Alt+T', act: 'Toggle theme (Console ↔ CRT)', match: matchThemeToggle },
    ] },
    { heading: 'Zoom', rows: [
        { keys: 'Ctrl+=', act: 'Zoom In', match: matchZoomIn },
        { keys: 'Ctrl+-', act: 'Zoom Out', match: matchZoomOut },
        { keys: 'Ctrl+0', act: 'Actual Size (zoom 1×)', match: matchZoomReset },
    ] },
    { heading: 'Editing', rows: [
        { keys: 'Ctrl+Shift+C', act: 'Copy selection', match: matchCopy },
        { keys: 'Ctrl+Shift+V', act: 'Paste (large paste ≥4096 B → paste-confirm toast)', match: matchPaste },
    ] },
    { heading: 'Cancel', rows: [
        { keys: 'Esc', act: 'Cancel in-flight SLIDE / close topmost modal / dismiss confirm' },
    ] },
    { heading: 'Reserved Ctrl combinations', rows: [
        { keys: 'Ctrl+A…Ctrl+Z', act: 'Forwarded to MicroBeast as control codes (except W / N / T)' },
        { keys: 'Ctrl+W / Ctrl+N / Ctrl+T', act: 'Claimed by Chromium — use Ctrl+F4 / Ctrl+Shift+N / a different keybinding' },
    ], hint: 'See Settings ▸ Browser-reserved Ctrl combinations… for the full list.' },
];
