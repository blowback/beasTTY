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
// setters yet (those land in E1.4/E1.5, E2, E3, E5).
//
// SCOPE (E1.2): adds the KEYBOARD LAYER over the E1.1 shell — one keydown
// listener on #terminal-wrapper that, WHEN a dropdown is open, moves between
// menus (←/→, wrapping), moves the focused item (↑/↓, skipping disabled),
// activates items (Enter, reusing the E1.1 onItemClick variant semantics),
// exposes a no-op submenu-open hook (Enter/→ on a radio-submenu row — real
// panels are E1.4/E1.5), announces disabled reasons via aria-live, and — the
// highest-risk clause — the Esc passthrough guard (AD-7): close one level +
// preventDefault when a menu is open; a SILENT early-return with NO
// preventDefault and NO side effect when none is open, so keyboard.js's Esc
// chain (paste-cancel / SLIDE-cancel / selection-cancel / encode 0x1B) still
// fires untouched (FR-4 / NFR-8). Focus is attribute-driven ([data-focused]) —
// the nav path NEVER calls .focus()/.blur() on a title/item, so terminal focus
// (NFR-1 "sacred") is retained and the listener keeps receiving every keystroke.
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

// E1.2 keyboard-nav state. focusedIndex is an index into the OPEN menu's
// *focusable* (non-disabled) rows — so disabled rows are skipped by
// construction and can never be [data-focused]. -1 = nothing focused (the
// state on open / after close). render() projects it onto [data-focused].
let focusedIndex = -1;
let liveRegionEl = null;      // #menu-bar-live — aria-live=polite announcer
let lastAnnounced = '';       // coalesce: only rewrite the live region on change

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
    liveRegionEl = document.getElementById('menu-bar-live');
    openMenu = null;
    focusedIndex = -1;
    lastAnnounced = '';

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

    // E1.2 — the keyboard-nav + Esc-passthrough listener. Attached to
    // #terminal-wrapper (the SAME target as chrome.js and keyboard.js) via
    // trackListener so dispose()/idempotent re-wire detach it. The attach ORDER
    // is load-bearing (AD-12): main.js wires chrome → menu-bar → keyboard, and
    // all three short-circuit on e.defaultPrevented, so chords reach chrome
    // first and the terminal Esc chain reaches keyboard last. Do NOT attach to
    // document/window — that would break the ordering vs keyboard.js.
    if (terminalWrapperRef) trackListener(terminalWrapperRef, 'keydown', onMenuKeydown);

    render();
    return buildApi();
}

// ====== E1.2 keyboard navigation ======

// The single keydown handler. Mirrors the keyboard.js guard shape: bail on an
// already-handled event (chrome.js chords) and on IME composition, and let any
// modifier chord fall through untouched so chrome.js / keyboard.js still own
// them. Every branch that ACTS on an open menu calls preventDefault(); the
// no-menu-open paths (incl. the Esc passthrough) NEVER do (AC-4).
function onMenuKeydown(e) {
    if (e.defaultPrevented) return;              // chrome.js already handled it
    if (e.isComposing) return;                   // IME safety (mirror keyboard.js)
    // Bare keys only — modified chords belong to chrome.js / keyboard.js
    // (e.g. Ctrl+Shift+Esc selection-clear, or a bare Shift+Arrow chord, must
    // reach keyboard.js untouched even while a menu is open).
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

    // --- Esc passthrough guard (AC-3 / AD-7) — the highest-risk clause. ---
    // Menu open  → close ONE level + preventDefault (keyboard.js short-circuits).
    // No menu    → early-return with ZERO side effect and NO preventDefault, so
    //              keyboard.js runs its full Esc chain (paste/SLIDE/selection
    //              cancel, or encode 0x1B). Breaking this silence is the exact
    //              FR-4 regression this story forbids.
    if (e.key === 'Escape') {
        if (openMenu === null) return;           // passthrough — DO NOT touch e
        closeMenu();                             // closes one level (only level today)
        e.preventDefault();
        return;
    }

    // All remaining nav keys act ONLY on an open menu. With none open they must
    // pass through untouched so keyboard.js still encodes arrows/Enter to the
    // Z80 (AC-4) — no preventDefault, no side effect.
    if (openMenu === null) return;

    switch (e.key) {
        case 'ArrowLeft':
            openNeighbour(-1);
            e.preventDefault();
            return;
        case 'ArrowRight': {
            // → on a radio-submenu row opens its submenu (no-op hook for now);
            // on any other row it advances to the next menu.
            const item = currentFocusedItem();
            if (item && item.getAttribute('data-variant') === 'radio-submenu') {
                activateFocused();
            } else {
                openNeighbour(+1);
            }
            e.preventDefault();
            return;
        }
        case 'ArrowDown':
            moveFocus(+1);
            e.preventDefault();
            return;
        case 'ArrowUp':
            moveFocus(-1);
            e.preventDefault();
            return;
        case 'Enter':
            activateFocused();
            e.preventDefault();
            return;
        default:
            return;                              // other keys pass through untouched
    }
}

// The open menu's focusable (non-disabled) rows, in DOM order.
function focusableItems() {
    if (openMenu === null) return [];
    const dropdown = dropdownEls[openMenu];
    if (!dropdown) return [];
    return Array.from(dropdown.querySelectorAll('.menu-item'))
        .filter((el) => el.getAttribute('data-disabled') !== 'true');
}

// Every row (incl. disabled) of the open menu — used only for the disabled
// neighbour announcement (AC-2).
function allItems() {
    if (openMenu === null) return [];
    const dropdown = dropdownEls[openMenu];
    if (!dropdown) return [];
    return Array.from(dropdown.querySelectorAll('.menu-item'));
}

function currentFocusedItem() {
    const items = focusableItems();
    if (focusedIndex < 0 || focusedIndex >= items.length) return null;
    return items[focusedIndex];
}

// ←/→ — open the wrapped neighbour of the current (or first) menu and land
// focus on its first enabled row (per Task 3.2).
function openNeighbour(dir) {
    const base = openMenu !== null ? MENUS.indexOf(openMenu) : 0;
    const next = (base + dir + MENUS.length) % MENUS.length;
    openMenuNamed(MENUS[next]);                  // resets focusedIndex to -1
    focusedIndex = focusableItems().length > 0 ? 0 : -1;
    render();
    refreshLiveRegion();
}

// ↑/↓ — move focus over the focusable rows, wrapping within the dropdown.
function moveFocus(dir) {
    const items = focusableItems();
    if (items.length === 0) { focusedIndex = -1; render(); return; }
    if (focusedIndex < 0) focusedIndex = dir > 0 ? 0 : items.length - 1;
    else focusedIndex = (focusedIndex + dir + items.length) % items.length;
    render();
    refreshLiveRegion();
}

// Enter / → — reuse the E1.1 variant semantics verbatim (action closes;
// checkable toggles + stays open; radio-submenu → submenu-open hook + stays).
function activateFocused() {
    const item = currentFocusedItem();
    if (item) onItemClick(item);
}

// E1.4/E1.5 seam — the single documented attach point for a real submenu
// panel. A structural no-op today that keeps the menu open (never closes,
// never throws), so Enter/→ on a radio-submenu row is inert-but-safe.
function openSubmenu(item) {
    return;   // no-op hook — real second-level panel lands in E1.4/E1.5
}

// AC-2 — announce a disabled row's reason when focus lands beside it. Coalesced
// (only rewritten when the reason changes) so it is not per-keystroke spam;
// cleared when focus moves away from any disabled neighbour.
function refreshLiveRegion() {
    if (!liveRegionEl) return;
    let reason = '';
    const item = currentFocusedItem();
    if (item) {
        const all = allItems();
        const idx = all.indexOf(item);
        const disabledNeighbour = [all[idx - 1], all[idx + 1]].find(
            (n) => n && n.getAttribute('data-disabled') === 'true');
        if (disabledNeighbour) reason = disabledNeighbour.getAttribute('title') || '';
    }
    if (reason !== lastAnnounced) {
        lastAnnounced = reason;
        liveRegionEl.textContent = reason;
    }
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
        openSubmenu(item);               // E1.2 submenu-open hook (no-op today)
        return;                          // submenu placeholder — keep open (E1.4/E1.5)
    }
    closeMenu();                         // action item closes the menu (AC-2)
}

function syncCheckGlyph(item) {
    const on = item.getAttribute('data-checked') === 'true';
    // data-checked is the single source of truth; project it onto BOTH the
    // visual glyph and aria-checked so role="menuitemcheckbox" conveys its
    // state to assistive tech (and updates on every toggle).
    item.setAttribute('aria-checked', on ? 'true' : 'false');
    const check = item.querySelector('.check');
    if (!check) return;
    check.textContent = on ? '✓' : '';
}

// ====== Open/close state machine ======

// Opening or closing ALWAYS resets keyboard focus to "nothing focused" (-1):
// a click/API open shows no highlight (matches E1.1); keyboard nav (↑/↓/←/→)
// establishes focus explicitly. This keeps [data-focused] a pure projection of
// focusedIndex and avoids a stale index bleeding across menus.
function toggleMenu(key) {
    openMenu = (openMenu === key) ? null : key;
    focusedIndex = -1;
    render();
    refreshLiveRegion();
}

function openMenuNamed(key) {
    if (!MENUS.includes(key)) return;
    openMenu = key;
    focusedIndex = -1;
    render();
    refreshLiveRegion();
}

function closeMenu() {
    if (openMenu === null) return;
    openMenu = null;
    focusedIndex = -1;
    render();
    refreshLiveRegion();
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
            // aria-expanded mirrors the open state for AT (aria-haspopup alone
            // does not convey that the menu is currently open).
            title.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
    }
    if (menuBarEl) {
        if (openMenu) menuBarEl.setAttribute('data-active-menu', openMenu);
        else menuBarEl.removeAttribute('data-active-menu');
    }
    renderFocus();
}

// [data-focused] is a pure projection of focusedIndex + openMenu (E1.2): clear
// it from every row, then set it on the one focused (enabled) row, if any.
// Closing a menu → focusedIndex is -1 → all rows cleared. Never calls .focus().
function renderFocus() {
    for (const key of MENUS) {
        const dropdown = dropdownEls[key];
        if (!dropdown) continue;
        dropdown.querySelectorAll('.menu-item[data-focused="true"]')
            .forEach((el) => el.removeAttribute('data-focused'));
    }
    const item = currentFocusedItem();
    if (item) item.setAttribute('data-focused', 'true');
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
    // (render() clears [hidden]/data-open/data-active-menu + [data-focused]).
    openMenu = null;
    focusedIndex = -1;
    render();
    // Detach every listener we attached (title clicks + item clicks + the
    // document click-away) so the disposed bar is fully inert — clicking a title
    // no longer toggles a dropdown.
    removeTrackedListeners();
}

// ====== Test introspection (matches the window.__* pattern) ======

export function __getStateForTests() {
    const focused = currentFocusedItem();
    const lbl = focused ? focused.querySelector('.lbl') : null;
    return {
        openMenu,
        focusedIndex,                                  // E1.2 — index into focusable rows; -1 = none
        focusedLabel: lbl ? lbl.textContent.trim() : null,
        menus: MENUS.slice(),
        wired: menuBarEl !== null,
        hasTerminalWrapper: terminalWrapperRef !== null,
    };
}

export function __resetForTests() {
    openMenu = null;
    focusedIndex = -1;
    lastAnnounced = '';
    render();
    if (liveRegionEl) liveRegionEl.textContent = '';
}
