// Beastty Epic E1 Story E1.1 — menu-bar shell + dropdown mechanics.
//
// The neutral desktop-style menu bar (File · Connection · View · Settings ·
// Debug · Help) plus a right-aligned connection-status placeholder. This
// module owns the bar and every dropdown: open/active state is expressed
// ONLY via [hidden] + data-* (never inline styles), click-away closes, and a
// checkable item keeps its menu open while an action item closes it (AD-7).
//
// SCOPE (E1.1): this is the SHELL. Dropdown items are structural PLACEHOLDERS
// that demonstrate the four menu-item variants (action / checkable /
// radio-submenu / disabled) — they are NOT wired to canvas.js / prefs.js
// setters yet (those land in E1.4/E1.5, E2, E3, E5). This story registers NO
// keydown/Esc handler — full keyboard navigation and the Esc-passthrough guard
// are E1.2, so keyboard.js paste-cancel / SLIDE-cancel stay untouched (NFR-8).
//
// AD-1: native ESM, no build step, named exports only (no default).
// AD-2: mirrors the www/renderer/scroll-state.js / slide-chip.js template —
//       module-scope state + wireMenuBar(opts) → API + private render()
//       toggling [hidden]/data-* + dispose() + __getStateForTests /
//       __resetForTests; main.js exposes the API as window.__menuBar.
// AD-3: menu-bar.js may import only canvas.js setters + prefs.js directly.
//       For this shell story neither is needed (items are placeholders); the
//       sole opt is terminalWrapper (a <select> restore target for retainFocus
//       in later menu stories — titles/buttons need no restore target).
// AD-10 / NFR-1 ("Sacred"): every interactive control registers retainFocus so
//       opening a menu never steals keyboard focus from #terminal-wrapper.

import { retainFocus } from './focus.js';

// Left-to-right menu order. Keys map to the #menu-<key> / #dropdown-<key> IDs.
const MENUS = ['file', 'connection', 'view', 'settings', 'debug', 'help'];

// ====== Module-scope state ======

let openMenu = null;          // null = all closed; otherwise one of MENUS
let menuBarEl = null;         // #menu-bar
const titleEls = {};          // key -> title <button>
const dropdownEls = {};       // key -> dropdown panel
let terminalWrapperRef = null;

// Every listener this module attaches, recorded so dispose() — and an
// idempotent re-wire — can detach ALL of them. retainFocus's mousedown handlers
// are WeakSet-guarded in focus.js, but the click handlers below are not, so a
// second wireMenuBar() would otherwise double-bind the title toggles (open→close
// on a single click) and leak the previous document click-away listener.
let listenerRecords = [];

function trackListener(target, type, handler) {
    target.addEventListener(type, handler);
    listenerRecords.push({ target, type, handler });
}

function removeTrackedListeners() {
    for (const { target, type, handler } of listenerRecords) {
        target.removeEventListener(type, handler);
    }
    listenerRecords = [];
}

// ====== wireMenuBar initializer ======

export function wireMenuBar(opts = {}) {
    // Idempotent re-wire: drop any listeners a prior wireMenuBar() attached
    // before adding fresh ones (retainFocus stays idempotent on its own).
    removeTrackedListeners();
    terminalWrapperRef = opts.terminalWrapper || null;
    menuBarEl = document.getElementById('menu-bar');
    openMenu = null;

    if (!menuBarEl) return buildApi();   // defensive — nothing to wire

    for (const key of MENUS) {
        const title = document.getElementById(`menu-${key}`);
        const dropdown = document.getElementById(`dropdown-${key}`);
        titleEls[key] = title;
        dropdownEls[key] = dropdown;

        if (title) {
            retainFocus(title);          // AD-10 — buttons: mousedown→preventDefault
            trackListener(title, 'click', () => toggleMenu(key));
        }
        if (dropdown) wireDropdownItems(dropdown);
    }

    // Click-away (AC-2). A bubbling document listener closes the open menu when
    // the click lands OUTSIDE the bar. Clicks on titles / items land inside the
    // bar, so this never fights the title-toggle or the item handlers — they
    // resolve their own open/close, and menuBarEl.contains(target) short-circuits
    // this handler for in-bar clicks.
    trackListener(document, 'click', (e) => {
        if (menuBarEl && !menuBarEl.contains(e.target)) closeMenu();
    });

    render();
    return buildApi();
}

// Wire the placeholder rows inside one dropdown. Behaviour by variant (AC-2/AC-3):
//   - disabled       → inert (no toggle, no close)
//   - checkable      → toggle data-checked + leading ✓ glyph, KEEP menu open
//   - radio-submenu  → submenu placeholder (real submenu = E1.4/E1.5); KEEP open
//   - action         → close the menu
function wireDropdownItems(dropdown) {
    const items = dropdown.querySelectorAll('.menu-item');
    items.forEach((item) => {
        retainFocus(item);               // AD-10 focus retention on every row
        if (item.getAttribute('data-variant') === 'checkable') {
            syncCheckGlyph(item);        // single source of truth = data-checked
        }
        trackListener(item, 'click', () => onItemClick(item));
    });
}

function onItemClick(item) {
    const variant = item.getAttribute('data-variant');
    const disabled = item.getAttribute('data-disabled') === 'true';
    if (disabled) return;                // inert

    if (variant === 'checkable') {
        const on = item.getAttribute('data-checked') === 'true';
        item.setAttribute('data-checked', on ? 'false' : 'true');
        syncCheckGlyph(item);
        return;                          // checkable keeps the menu open (AC-2)
    }
    if (variant === 'radio-submenu') {
        return;                          // submenu placeholder — keep open (E1.4/E1.5)
    }
    closeMenu();                         // action item closes the menu (AC-2)
}

function syncCheckGlyph(item) {
    const check = item.querySelector('.check');
    if (!check) return;
    check.textContent = item.getAttribute('data-checked') === 'true' ? '✓' : '';
}

// ====== Open/close state machine ======

function toggleMenu(key) {
    openMenu = (openMenu === key) ? null : key;
    render();
}

function openMenuNamed(key) {
    if (!MENUS.includes(key)) return;
    openMenu = key;
    render();
}

function closeMenu() {
    if (openMenu === null) return;
    openMenu = null;
    render();
}

// ====== Render — the ONLY place that mutates the DOM open/close state. ======
// Everything is [hidden] + data-* — no inline styles are ever written (AC-2).
function render() {
    for (const key of MENUS) {
        const title = titleEls[key];
        const dropdown = dropdownEls[key];
        const isOpen = openMenu === key;

        if (dropdown) {
            if (isOpen) dropdown.removeAttribute('hidden');
            else dropdown.setAttribute('hidden', '');
        }
        if (title) {
            if (isOpen) title.setAttribute('data-open', 'true');
            else title.removeAttribute('data-open');
        }
    }
    if (menuBarEl) {
        if (openMenu) menuBarEl.setAttribute('data-active-menu', openMenu);
        else menuBarEl.removeAttribute('data-active-menu');
    }
}

// ====== Public API ======

function buildApi() {
    return {
        open: openMenuNamed,
        close: closeMenu,
        getOpenMenu: () => openMenu,
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

export function dispose() {
    // Close any open dropdown FIRST so a disposed bar is left visually shut
    // (render() clears [hidden]/data-open/data-active-menu from the open menu).
    openMenu = null;
    render();
    // Detach every listener we attached (title clicks + item clicks + the
    // document click-away) so the disposed bar is fully inert — clicking a title
    // no longer toggles a dropdown.
    removeTrackedListeners();
}

// ====== Test introspection (matches the window.__* pattern) ======

export function __getStateForTests() {
    return {
        openMenu,
        menus: MENUS.slice(),
        wired: menuBarEl !== null,
        hasTerminalWrapper: terminalWrapperRef !== null,
    };
}

export function __resetForTests() {
    openMenu = null;
    render();
}
