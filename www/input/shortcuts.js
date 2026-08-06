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
// Ctrl+A…Ctrl+Z control-code range (the default encode path), the browser-claimed
// Ctrl+W/N/T combos (Chromium handles them — no page handler to bind), and the
// Ctrl+Shift+↑/↓ history bypass (no handler at all — it works because three separate
// guards each decline to act; see the Command history group below). They render in the
// modal but have no single live handler to point at.

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
// Clear an established selection. Relocated from the inline guard keyboard.js used to
// carry — the same five conditions, reordered to the modifiers-first shape every other
// predicate here uses. All five are pure property reads, so the result is identical;
// the move is what lets the Help modal advertise the chord at all.
export const matchClearSelection = (e) =>
    e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'Escape';

// Flip the persisted commandHistoryEnabled pref. TWO chords, one predicate — the same
// shape as the zoom trio's `Equal || NumpadAdd`. Two because neither is dependable
// everywhere: Insert is missing from many compact keyboards, and Ctrl+Alt+H can be
// claimed by a window manager. This chord changes the SETTING — it is NOT a way out of
// an already-open recall overlay, which swallows every Ctrl/Alt/Meta chord. Press Esc
// to close that, or Ctrl+Shift+↑/↓ to bypass it per-keypress without opening it at all.
//
// Two keyboard realities the naive predicate gets wrong:
//   - With NumLock off the numpad Insert key reports code 'Numpad0' (key 'Insert').
//     Accepted too — otherwise the chord misses AND packKeyCode sends keypad-0 bytes.
//     The key check keeps NumLock-on numpad 0 typing a digit.
//   - AltGr reports ctrlKey+altKey on Windows and most X11 layouts, so on a layout
//     mapping AltGr+H to a character this would flip the setting instead of typing it.
export const matchCommandHistoryToggle = (e) =>
    (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
        && (e.code === 'Insert' || (e.code === 'Numpad0' && e.key === 'Insert')))
    || (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyH'
        && !(e.getModifierState && e.getModifierState('AltGraph')));

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
        { keys: 'Ctrl+Shift+Esc', act: 'Clear selection (bare Esc still reaches the MicroBeast)', match: matchClearSelection },
    ] },
    { heading: 'Command history', rows: [
        { keys: 'Ctrl+Shift+Insert / Ctrl+Alt+H', act: 'Turn command history on / off (persisted; brief toast confirms)', match: matchCommandHistoryToggle },
        // Informational — there is no handler to point at. Holding Ctrl+Shift makes the
        // arrow bypass the recall overlay: command-history.js's closed-branch trigger
        // returns on any modifier without preventDefault, keyboard.js has no
        // Ctrl+Shift+Arrow intercept, and key.rs encodes ArrowUp/Down ignoring modifiers
        // — so the plain ESC A / ESC B reaches the wire.
        { keys: 'Ctrl+Shift+↑ / Ctrl+Shift+↓', act: 'Send ↑/↓ to the MicroBeast without opening the recall overlay' },
    ] },
    { heading: 'Cancel', rows: [
        { keys: 'Esc', act: 'Cancel in-flight SLIDE / close topmost modal / dismiss confirm' },
    ] },
    { heading: 'Reserved Ctrl combinations', rows: [
        { keys: 'Ctrl+A…Ctrl+Z', act: 'Forwarded to MicroBeast as control codes (except W / N / T)' },
        { keys: 'Ctrl+W / Ctrl+N / Ctrl+T', act: 'Claimed by Chromium — use Ctrl+F4 / Ctrl+Shift+N / a different keybinding' },
    ], hint: 'See Settings ▸ Browser-reserved Ctrl combinations… for the full list.' },
];
