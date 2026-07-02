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
// E1.3 (AD-3 / AD-14) — menu-bar.js may import prefs.js directly. getPrefs is
// the use-time read for the reset re-projection seam (projectPrefs below); it
// is never cached across a save (AD-4: savePrefs reassigns the cached blob).
// E1.4 (AD-3 / AD-4) — savePrefs joins getPrefs as a direct prefs import: the
// View ▸ Theme / Phosphor selects persist via savePrefs (the graph edge
// `menu -->|direct import OK| prefs` is authoritative over the AD-3 prose).
import { getPrefs, savePrefs } from '../state/prefs.js';
// E1.4 (AD-3 / AD-7) — the theme/phosphor menu actions relocate the SAME canvas
// setters the retired #theme-toggle / #phosphor-group handlers called, verbatim.
// canvas.js setters are the only other allowed direct import (AD-3 allowlist).
// E1.5 (AD-3 / AD-7) — View ▸ Font / Zoom relocate the SAME setters the retired
// #font-select handler + the SACRED Ctrl+{=,-,0} chord call: setFont, zoomStep,
// resetZoom (+ getActiveZoom to read the clamped level for savePrefs / the push).
import { setTheme, setPhosphor, setFont, zoomStep, resetZoom, getActiveZoom } from './canvas.js';

// Left-to-right menu order. Keys map to the #menu-<key> / #dropdown-<key> IDs.
const MENUS = ['file', 'connection', 'view', 'settings', 'debug', 'help'];

// E2.1 (AD-15) — the Connect item / legacy #connect-button ACTION label per
// connection state. Moved VERBATIM (incl. the literal U+2026 ellipsis) from the
// retired serial.js BUTTON_LABELS: menu-bar.js is now the sole writer of every
// Connect surface, projecting state → label + data-state via this frozen map.
const CONNECT_LABELS = Object.freeze({
    disconnected:  'Connect',
    connecting:    'Connecting…',          // U+2026 ellipsis — do not paraphrase
    connected:     'Disconnect',
    reconnecting:  'Reconnecting…',        // U+2026 ellipsis
    'port-lost':   'Reconnect',
});

// E2.1 (AC-3) — the right-aligned #menu-conn-label status text per state.
// disconnected/connecting/reconnecting are verbatim-sourced (placeholder +
// EXPERIENCE.md state table); connected/port-lost wording is the dev default
// ratified with Ant (2026-07-02). Distinct from CONNECT_LABELS — the status
// label DESCRIBES the state; the Connect item names the ACTION.
const CONN_STATUS_LABELS = Object.freeze({
    disconnected:  'Not connected',
    connecting:    'Connecting…',
    connected:     'Connected',
    reconnecting:  'Reconnecting…',
    'port-lost':   'Connection lost',
});

// ====== Module-scope state ======

let openMenu = null;          // null = all closed; otherwise one of MENUS
let menuBarEl = null;         // #menu-bar
const titleEls = {};          // key -> title <button>
const dropdownEls = {};       // key -> dropdown panel
let terminalWrapperRef = null;

// E1.3 (AD-13) — refs for the two relocated Clear controls. Their click
// handlers moved OUT of chrome.js into this module (the sole AD-13 handler
// move this story). getScrollStateRef is a THUNK, not the value: scrollState
// is wired AFTER menu-bar in main.js's boot order, so the live ref must be
// resolved at click time (mirrors the chrome.js:130 / main.js:242 pattern).
let termRef = null;
let getScrollStateRef = null;
let requestFrameRef = null;

// E1.2 keyboard-nav state. focusedIndex is an index into the OPEN menu's
// *focusable* (non-disabled) rows — so disabled rows are skipped by
// construction and can never be [data-focused]. -1 = nothing focused (the
// state on open / after close). render() projects it onto [data-focused].
let focusedIndex = -1;
let liveRegionEl = null;      // #menu-bar-live — aria-live=polite announcer
let lastAnnounced = '';       // coalesce: only rewrite the live region on change

// E1.4 — second-level (radio-submenu) state. openSubmenuPanel is the currently
// open .submenu element (or null); submenuFocusIndex indexes its focusable
// radios. This is a DISTINCT state layer from the top-level openMenu/focusedIndex
// — render() stays the SOLE writer of top-level open/close; the submenu is
// projected by openSubmenu/closeSubmenu/renderSubmenuFocus only.
let openSubmenuPanel = null;
let submenuFocusIndex = -1;

// E1.4 — injected opts (AD-3: everything other than canvas setters + prefs must
// arrive via wireMenuBar). onThemeChangeRef re-gates #font-row (the temporary
// E1.5 bridge); clearSelectionRef rehomes the D-19 selection-clear onto the
// theme/phosphor menu actions.
let onThemeChangeRef = null;
let clearSelectionRef = null;

// E1.5 — injected opts (AD-3). pushZoomRef is the imperative status-bar zoom push
// (AD-6): the View ▸ Zoom items own the menu-path mutation, so they push the new
// level; it is a no-op stub until E4 wires the real status bar. confirmClearScrollbackRef
// runs the deliberate-friction confirm for View ▸ Clear Scrollback… (FR-11) — main.js
// owns the modal (openModal) so modal.js stays out of menu-bar's import set (AD-3).
let pushZoomRef = null;
let confirmClearScrollbackRef = null;

// E2.1 (AD-15) — connection projection state. serial.js arrives via opts (never a
// direct import — AD-3): toggleConnectionRef is the exported click action;
// getConnectionStateRef reads the current state for the initial paint;
// connUnsub is the onStateChange unsubscribe closure (called on re-wire + dispose
// so the subscriber never double-registers — AC-6). The four DOM refs are the
// Connect surfaces this module is the SOLE writer of.
let toggleConnectionRef = null;
let getConnectionStateRef = null;
let connUnsub = null;
let connectItemEl = null;     // #menu-connect-item (the Connect/Disconnect menu row)
let connDotEl = null;         // #menu-conn-dot
let connLabelEl = null;       // #menu-conn-label
let legacyConnectBtnEl = null; // #connect-button — coexistence mirror, retires with #top-bar in E7

// E2.2 (FR-13/FR-14, AD-3) — Auto-connect + Choose MicroBeast injected seams.
// getAdapterCountRef is serial's async CP2102N count (present-when->1 gate);
// chooseMicroBeastRef opens the existing filtered requestPort picker. Both arrive
// via opts (serial is never a direct import). The two DOM refs are the rows this
// module projects: the checkable auto-connect row and the count-gated Choose row.
let getAdapterCountRef = null;
let chooseMicroBeastRef = null;
let autoConnectItemEl = null;      // #menu-autoconnect-item — checkable, derived from prefs.autoConnect
let chooseMicroBeastItemEl = null; // #menu-choose-microbeast-item — [hidden] unless >1 adapter
// Bumped on every refreshChooseMicroBeast() kickoff so an EARLIER open's async
// count (getPorts() latency is non-deterministic) can't resolve last and stomp a
// later open's visibility with a stale adapter count. Only the newest seq applies.
let chooseCountSeq = 0;

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

// ====== E1.3 (AD-13) — relocated Clear actions ======
// The single owner of the Clear actions. Semantics are copied VERBATIM from the
// pre-move chrome.js handlers (chrome.js:120-136 / :279-288) so behaviour is
// byte-identical. E1.5 points the View ▸ Clear Screen / Clear Scrollback… menu
// items at these SAME actions (the incumbent #clear-button / #clear-scrollback-
// button are retired), routed through the runViewAction dispatch below.
// clear_visible() is the Rust direct-clear forwarder —
// it does NOT feed \x1B\x4A, so the remote VT52 state machine is untouched
// (Plan 06-02 gate). resize_scrollback(0)→(10000) cycles the ring buffer back
// to its Phase 1 D-12 default cap. Both snap to the live tail (D-04) via the
// getScrollState thunk (resolved at call time — scrollState is late-bound).

function clearScreen({ alsoScrollback } = {}) {
    if (!termRef) return;
    termRef.clear_visible();                 // NOT \x1B\x4A — direct-clear forwarder.
    if (alsoScrollback) {
        // Shift+click also wipes scrollback (D-26).
        termRef.resize_scrollback(0);
        termRef.resize_scrollback(10000);
    }
    const ss = getScrollStateRef && getScrollStateRef();
    if (ss) ss.snapToBottom();               // D-04 trigger — clear is a snap action.
    if (requestFrameRef) requestFrameRef();
}

function clearScrollback() {
    if (!termRef) return;
    // Settings 'Clear scrollback' (D-15) — flush the ring buffer only; the
    // visible 80x24 grid is deliberately untouched.
    termRef.resize_scrollback(0);
    termRef.resize_scrollback(10000);
    const ss = getScrollStateRef && getScrollStateRef();
    if (ss) ss.snapToBottom();               // D-04 trigger.
    if (requestFrameRef) requestFrameRef();
}

// ====== wireMenuBar initializer ======

export function wireMenuBar(opts = {}) {
    // Idempotent re-wire: drop any listeners a prior wireMenuBar() attached
    // before adding fresh ones (retainFocus stays idempotent on its own).
    removeTrackedListeners();
    terminalWrapperRef = opts.terminalWrapper || null;
    // E1.3 (AD-13) — Clear-handler opts. term / getScrollState / requestFrame
    // arrive via opts (NOT imports — AD-3), matching the pre-move chrome.js
    // wiring. getScrollState is a thunk; hold it as-is and call it at click time.
    termRef = opts.term || null;
    getScrollStateRef = opts.getScrollState || null;
    requestFrameRef = opts.requestFrame || null;
    // E1.4 — font-row gate + D-19 selection-clear, injected (AD-3). Both are
    // optional: a test harness that omits them leaves the corresponding
    // side-effect inert (guarded at each call site).
    onThemeChangeRef = opts.onThemeChange || null;
    clearSelectionRef = opts.clearSelection || null;
    // E1.5 — zoom status push (AD-6) + Clear Scrollback confirm (FR-11). Both
    // optional: a harness that omits them leaves the push inert / the wipe
    // unconfirmed (guarded at each call site).
    pushZoomRef = opts.pushZoom || null;
    confirmClearScrollbackRef = opts.confirmClearScrollback || null;
    // E2.1 (AD-15) — serial injected via opts (AD-3: not a direct import). All
    // optional: a harness that omits them leaves the Connect projection inert.
    toggleConnectionRef = opts.toggleConnection || null;
    getConnectionStateRef = opts.getConnectionState || null;
    // E2.2 — serial's adapter count + filtered picker (AD-3 injected). Both
    // optional: a harness that omits getAdapterCount leaves Choose MicroBeast…
    // permanently absent; one that omits chooseMicroBeast leaves its click inert.
    getAdapterCountRef = opts.getAdapterCount || null;
    chooseMicroBeastRef = opts.chooseMicroBeast || null;
    menuBarEl = document.getElementById('menu-bar');
    liveRegionEl = document.getElementById('menu-bar-live');
    openMenu = null;
    focusedIndex = -1;
    openSubmenuPanel = null;
    submenuFocusIndex = -1;
    lastAnnounced = '';

    // E1.5 — the incumbent #clear-button / #clear-scrollback-button are retired;
    // Clear Screen / Clear Scrollback… are now View-menu items wired through the
    // dropdown item path (wireDropdownItems → onItemClick → runViewAction), so no
    // separate button-wiring pass is needed. clearScreen / clearScrollback remain.

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

    // E2.1 (AD-15) — discover the Connect surfaces by convention (mirrors how the
    // titles/dropdowns are discovered above), then subscribe to the serial state
    // machine and take the initial paint. Every write goes through
    // projectConnection (the sole writer); each ref is null-guarded there.
    connectItemEl = document.getElementById('menu-connect-item');
    connDotEl = document.getElementById('menu-conn-dot');
    connLabelEl = document.getElementById('menu-conn-label');
    // Coexistence mirror (Task 3) — the legacy #connect-button stays a valid
    // serial-state oracle for the transport/session suite until #top-bar is
    // removed in E7 (E1 retro open action #5). menu-bar.js now OWNS its click +
    // mousedown too (moved out of serial.js), so it is not a second writer.
    legacyConnectBtnEl = document.getElementById('connect-button');
    if (legacyConnectBtnEl) {
        retainFocus(legacyConnectBtnEl);   // AD-10 — mousedown→preventDefault (AC-5)
        trackListener(legacyConnectBtnEl, 'click', () => {
            if (toggleConnectionRef) toggleConnectionRef();
        });
    }
    // Drop any prior onStateChange subscription BEFORE re-subscribing so an
    // idempotent re-wire never double-registers projectConnection (AC-6).
    // (connUnsub is a serial closure, not a tracked DOM listener, so
    // removeTrackedListeners above does not cover it.) Kept adjacent to the
    // re-subscribe — PAST the `!menuBarEl` early return — so a defensive re-wire
    // on a missing bar leaves the live subscription intact instead of dropping it
    // and never re-registering (which would freeze every Connect surface).
    if (connUnsub) { connUnsub(); connUnsub = null; }
    // Subscribe (AC-1) + initial paint. onStateChange fires projectConnection on
    // every transition; the initial read yields 'disconnected' at boot (menu-bar
    // wires before wireSerial — AD-12), so the first paint is Connect/gray.
    if (opts.onConnectionStateChange) {
        connUnsub = opts.onConnectionStateChange(projectConnection);
    }
    projectConnection(getConnectionStateRef ? (getConnectionStateRef() || 'disconnected') : 'disconnected');

    // E2.2 — discover the Auto-connect + Choose MicroBeast rows (same by-id
    // convention as the Connect surfaces above) and take the auto-connect initial
    // paint from prefs so the row is correct BEFORE the first Connection-menu open
    // (never trust the HTML data-checked literal — AC-3). Choose MicroBeast… stays
    // [hidden] at boot (the ≤1-adapter default); it is re-derived async on open.
    autoConnectItemEl = document.getElementById('menu-autoconnect-item');
    chooseMicroBeastItemEl = document.getElementById('menu-choose-microbeast-item');
    projectAutoConnect();

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
        // E1.4 — Esc collapses ONE level: an open submenu first, else the menu.
        // Either way the event is consumed so keyboard.js short-circuits (the
        // E1.2 contract — Esc must not reach the terminal while a menu is open).
        if (openSubmenuPanel) closeSubmenu();
        else closeMenu();
        e.preventDefault();
        return;
    }

    // All remaining nav keys act ONLY on an open menu. With none open they must
    // pass through untouched so keyboard.js still encodes arrows/Enter to the
    // Z80 (AC-4) — no preventDefault, no side effect.
    if (openMenu === null) return;

    // E1.4 — when a radio submenu is open, keys drive the submenu radios: ↑/↓
    // move, Enter/→ select, ← collapse back to the parent level. All consume the
    // event (a menu is open).
    if (openSubmenuPanel) {
        switch (e.key) {
            case 'ArrowDown': moveSubmenuFocus(+1); e.preventDefault(); return;
            case 'ArrowUp':   moveSubmenuFocus(-1); e.preventDefault(); return;
            case 'ArrowLeft': closeSubmenu();       e.preventDefault(); return;
            case 'Enter':
            case 'ArrowRight': selectSubmenuFocused(); e.preventDefault(); return;
            default: return;                     // other keys pass through untouched
        }
    }

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

// The open menu's TOP-LEVEL focusable (non-disabled) rows, in DOM order. E1.4 —
// rows inside a .submenu panel are a distinct nav layer (submenuItems), so they
// are excluded here; the radio-submenu PARENT rows (Theme/Phosphor/Font) are not
// in a .submenu and remain top-level.
function focusableItems() {
    if (openMenu === null) return [];
    const dropdown = dropdownEls[openMenu];
    if (!dropdown) return [];
    return Array.from(dropdown.querySelectorAll('.menu-item'))
        .filter((el) => !el.closest('.submenu'))
        .filter((el) => el.getAttribute('data-disabled') !== 'true')
        // E2.2 (AC-2) — a [hidden] row (Choose MicroBeast… when ≤1 adapter) is not
        // visible, so ↑/↓ keyboard nav must not land focus on it. It appears /
        // disappears between opens; excluding it keeps the index math valid.
        .filter((el) => !el.hasAttribute('hidden'));
}

// Every top-level row (incl. disabled) of the open menu — used only for the
// disabled neighbour announcement (AC-2). Excludes submenu children (E1.4).
function allItems() {
    if (openMenu === null) return [];
    const dropdown = dropdownEls[openMenu];
    if (!dropdown) return [];
    return Array.from(dropdown.querySelectorAll('.menu-item'))
        .filter((el) => !el.closest('.submenu'))
        // E2.2 — a [hidden] row (Choose MicroBeast… when ≤1 adapter) is neither a
        // focus target nor a visible neighbour, so refreshLiveRegion's AC-2
        // disabled-neighbour scan must not see it (keeps this index space aligned
        // with focusableItems, which already excludes [hidden]).
        .filter((el) => !el.hasAttribute('hidden'));
}

function currentFocusedItem() {
    const items = focusableItems();
    if (focusedIndex < 0 || focusedIndex >= items.length) return null;
    return items[focusedIndex];
}

// ---- Shared nav helpers (used by BOTH the top-level and submenu layers) ----

// Wrapping index step: seed from an empty selection (-1) to the first/last row
// per direction, else step and wrap. Single source of truth so the two nav
// layers can never drift on an off-by-one.
function nextWrappedIndex(idx, dir, len) {
    if (len === 0) return -1;
    if (idx < 0) return dir > 0 ? 0 : len - 1;
    return (idx + dir + len) % len;
}

// Clear the [data-focused] highlight from every row under `root` (a dropdown or
// a submenu panel) so the focus-marking convention lives in one place.
function clearFocused(root) {
    root.querySelectorAll('.menu-item[data-focused="true"]')
        .forEach((el) => el.removeAttribute('data-focused'));
}

// ←/→ — open the wrapped neighbour of the current (or first) menu and land
// focus on its first enabled row (per Task 3.2). Delegates to openMenuNamed's
// focusFirstRow path so opening + focusing is a SINGLE render (no double pass).
function openNeighbour(dir) {
    const base = openMenu !== null ? MENUS.indexOf(openMenu) : 0;
    const next = (base + dir + MENUS.length) % MENUS.length;
    openMenuNamed(MENUS[next], true);
}

// ↑/↓ — move focus over the focusable rows, wrapping within the dropdown.
function moveFocus(dir) {
    const items = focusableItems();
    if (items.length === 0) { focusedIndex = -1; render(); return; }
    focusedIndex = nextWrappedIndex(focusedIndex, dir, items.length);
    render();
    refreshLiveRegion();
}

// Enter / → — reuse the E1.1 variant semantics verbatim (action closes;
// checkable toggles + stays open; radio-submenu → submenu-open hook + stays).
function activateFocused() {
    const item = currentFocusedItem();
    if (item) onItemClick(item);
}

// ====== E1.4 — radio submenu (second-level) mechanic ======

// Resolve the .submenu panel a radio-submenu PARENT row controls (via the row's
// data-submenu key). Font's parent has no data-submenu / panel yet (E1.5), so
// this returns null there and openSubmenu no-ops safely.
function panelForParent(item) {
    const key = item && item.getAttribute('data-submenu');
    if (!key) return null;
    const dropdown = item.closest('.dropdown');
    if (!dropdown) return null;
    return dropdown.querySelector(`.submenu[data-submenu-panel="${key}"]`);
}

// Open a radio-submenu parent's child panel (Enter/→/click on the parent row).
// Toggles: re-activating the currently-open parent collapses it. Shows the panel
// via [hidden] only (never inline styles), sets aria-expanded, and lands focus
// on the active (checked) radio, else the first. Never writes top-level
// open/close state — render() stays its sole writer.
function openSubmenu(item) {
    const panel = panelForParent(item);
    if (!panel) return;                          // Font (E1.5) / unknown — inert
    if (openSubmenuPanel === panel) { closeSubmenu(); return; }
    if (openSubmenuPanel) closeSubmenu();        // only one submenu open at a time
    openSubmenuPanel = panel;
    panel.removeAttribute('hidden');
    item.setAttribute('aria-expanded', 'true');
    const items = submenuItems();
    const activeIdx = items.findIndex((el) => el.getAttribute('data-checked') === 'true');
    submenuFocusIndex = items.length ? (activeIdx >= 0 ? activeIdx : 0) : -1;
    renderSubmenuFocus();
    // Keyboard-open path: the parent row still carries the top-level
    // [data-focused] highlight (renderFocus set it before Enter/→). Clear it so
    // ONLY the submenu radio shows the focus ring — otherwise the parent and a
    // radio both paint the accent fill. closeSubmenu restores the parent
    // highlight from focusedIndex. Mouse-open leaves focusedIndex at -1 (no
    // parent highlight), so this is a harmless no-op there.
    item.removeAttribute('data-focused');
}

// Collapse the open submenu back to the parent level: hide the panel, clear its
// [data-focused] highlight, restore the parent's aria-expanded. Never throws
// with no submenu open (idempotent). Terminal focus is untouched (retainFocus).
function closeSubmenu() {
    if (!openSubmenuPanel) return;
    openSubmenuPanel.setAttribute('hidden', '');
    clearFocused(openSubmenuPanel);
    const key = openSubmenuPanel.getAttribute('data-submenu-panel');
    const parent = menuBarEl && menuBarEl.querySelector(`.menu-item[data-submenu="${key}"]`);
    if (parent) parent.setAttribute('aria-expanded', 'false');
    openSubmenuPanel = null;
    submenuFocusIndex = -1;
    // Restore the parent row's [data-focused] highlight that openSubmenu cleared
    // (keyboard path) so collapsing the submenu (←/Esc) returns the visible focus
    // to the parent. renderFocus is idempotent and no-ops when nothing is
    // keyboard-focused (focusedIndex -1 / mouse path) or the menu is closing
    // (a render() follows in every non-← caller).
    renderFocus();
}

// The open submenu's focusable radios (none are individually disabled today).
function submenuItems() {
    if (!openSubmenuPanel) return [];
    return Array.from(openSubmenuPanel.querySelectorAll('.menu-item'))
        .filter((el) => el.getAttribute('data-disabled') !== 'true');
}

// ↑/↓ within the open submenu, wrapping.
function moveSubmenuFocus(dir) {
    const items = submenuItems();
    if (items.length === 0) { submenuFocusIndex = -1; return; }
    submenuFocusIndex = nextWrappedIndex(submenuFocusIndex, dir, items.length);
    renderSubmenuFocus();
}

// Enter/→ within the open submenu — select the focused radio (routes to
// onItemClick → onRadioSelect, the same path a click takes).
function selectSubmenuFocused() {
    const items = submenuItems();
    const item = items[submenuFocusIndex];
    if (item) onItemClick(item);
}

// [data-focused] projection for the open submenu — mirrors renderFocus() but for
// the submenu layer (kept separate so the two never clobber each other).
function renderSubmenuFocus() {
    if (!openSubmenuPanel) return;
    clearFocused(openSubmenuPanel);
    const items = submenuItems();
    const item = items[submenuFocusIndex];
    if (item) item.setAttribute('data-focused', 'true');
}

// A radio was selected (Theme or Phosphor child). Relocated VERBATIM from the
// retired chrome.js handlers (AD-7): setTheme + savePrefs({theme}) /
// setPhosphor + savePrefs({phosphor}). Moves the check glyph, rehomes the D-19
// selection-clear (clearSelectionRef), re-gates #font-row (onThemeChangeRef,
// theme only), and re-derives Phosphor's disabled state live (AC-3). Radio
// select keeps the menu (and submenu) open — checkable/radio semantics (AD-7).
function onRadioSelect(panel, item) {
    const group = panel.getAttribute('data-submenu-panel');
    const value = item.getAttribute('data-value');
    if (!value) return;
    if (group === 'theme') {
        setTheme(value);                         // AD-7 verbatim (also sets body[data-theme], E1.4 Task 1)
        savePrefs({ theme: value });             // AD-4 — persist
        setRadioChecked(panel, value);
        if (onThemeChangeRef) onThemeChangeRef();        // re-project an open View menu (reads getPrefs)
        if (clearSelectionRef) clearSelectionRef();      // D-19 rehomed onto the menu action
        // AC-3 — re-derive Phosphor enable/disable from the just-picked theme,
        // collapsing its submenu if now disabled, in the SAME interaction.
        const view = dropdownEls.view || document.getElementById('dropdown-view');
        if (view) {
            syncSubmenuDisabled(view, value, 'phosphor', 'Phosphor');
            syncSubmenuDisabled(view, value, 'font', 'Font');   // E1.5 — Font is CRT-only too (AD-9)
        }
        // Phosphor's disabled state (and thus its aria-live reason) just changed;
        // re-announce so AT reflects it without waiting for the next keystroke. NOT
        // render() — the theme submenu is still open and render()/renderFocus would
        // clobber its [data-focused]; refreshLiveRegion touches neither.
        refreshLiveRegion();
    } else if (group === 'phosphor') {
        setPhosphor(value);                      // AD-7 verbatim (no-op off-CRT — canvas guards it)
        savePrefs({ phosphor: value });          // AD-4 — persist
        setRadioChecked(panel, value);
        if (clearSelectionRef) clearSelectionRef();      // D-19 rehomed onto the menu action
    } else if (group === 'font') {
        // E1.5 (AD-7) — relocated VERBATIM from the retired #font-select handler
        // (chrome.js:227-229): setFont + savePrefs({font}). Font is NOT a D-19
        // trigger (only theme/phosphor/zoom clear the selection), so the selection
        // is deliberately left intact here.
        setFont(value);                          // AD-7 verbatim (same-value/unknown-id guards live in setFont)
        savePrefs({ font: value });              // AD-4 — persist
        setRadioChecked(panel, value);
    }
}

// Project the active radio within a submenu panel: exactly one row carries
// data-checked="true" + the ✓ glyph (deselecting siblings). Reuses
// syncCheckGlyph so aria-checked + the glyph stay in lockstep with data-checked.
function setRadioChecked(panel, value) {
    panel.querySelectorAll('.menu-item').forEach((el) => {
        el.setAttribute('data-checked', el.getAttribute('data-value') === value ? 'true' : 'false');
        syncCheckGlyph(el);
    });
}

// AD-9 — Phosphor AND Font are CRT-only: the vector/Clean renderer ignores the
// bitmap font and the phosphor tint, so each submenu parent is SHOWN but
// data-disabled off-CRT (not hidden), aria-disabled, skipped in nav (data-disabled
// → focusableItems filters it), announced via #menu-bar-live (the row's `title` is
// surfaced by refreshLiveRegion when a neighbour is focused), and its open submenu
// collapsed on disable. Keyed on the `data-submenu` name so the two rows can never
// drift on the disable behaviour (Font replaced the retired #font-row hide-gate).
function syncSubmenuDisabled(viewDropdown, theme, key, label) {
    const parent = viewDropdown.querySelector(`.menu-item[data-submenu="${key}"]`);
    if (!parent) return;
    if (theme !== 'crt') {
        parent.setAttribute('data-disabled', 'true');
        parent.setAttribute('aria-disabled', 'true');
        parent.setAttribute('title', `${label} — CRT theme only`);
        if (openSubmenuPanel && openSubmenuPanel.getAttribute('data-submenu-panel') === key) {
            closeSubmenu();
        }
    } else {
        parent.removeAttribute('data-disabled');
        parent.removeAttribute('aria-disabled');
        parent.removeAttribute('title');
    }
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
        retainFocus(item);               // AD-10 focus retention on every row (incl. submenu radios)
        // E1.4 — sync the glyph for any checkable/radio row from its
        // data-checked source of truth (was checkable-only; radios need it too).
        if (item.hasAttribute('data-checked')) {
            syncCheckGlyph(item);        // single source of truth = data-checked
        }
        // E1.5 — thread the click event so a data-action row can read modifiers
        // (Shift on Clear Screen → also clears scrollback, matching #clear-button).
        trackListener(item, 'click', (e) => onItemClick(item, e));
    });
}

function onItemClick(item, ev) {
    const disabled = item.getAttribute('data-disabled') === 'true';
    if (disabled) return;                // inert (incl. Phosphor / Font parent off-CRT)

    // E1.4 — a click inside a .submenu panel is a radio SELECT (Theme/Phosphor/Font).
    // Routed before the variant switch; radio select keeps the menu open (AD-7).
    const panel = item.closest('.submenu');
    if (panel) { onRadioSelect(panel, item); return; }

    const variant = item.getAttribute('data-variant');
    if (variant === 'checkable') {
        const on = item.getAttribute('data-checked') === 'true';
        const next = !on;
        item.setAttribute('data-checked', next ? 'true' : 'false');
        syncCheckGlyph(item);
        // E2.2 (AC-1, AD-4) — a pref-backed checkable persists its new value via
        // savePrefs. The pref key rides on the row (data-pref) so the branch stays
        // generic: Settings ▸ Local echo / Enter-key-sends (E3) reuse this path.
        // savePrefs touches ONLY the named key (AD-4) and does NOT fire subscribers.
        const prefKey = item.getAttribute('data-pref');
        if (prefKey) {
            savePrefs({ [prefKey]: next });
            // E2.2 (AC-4) — menu→pane lockstep during the E7 coexistence window:
            // savePrefs does not fan out, so the legacy #auto-connect-checkbox in
            // the <details> pane would go stale in-session. Mirror it here. This
            // line retires with #top-bar in E7 (E1 retro open action #5), same as
            // the #connect-button mirror in projectConnection.
            if (prefKey === 'autoConnect') {
                const legacy = document.getElementById('auto-connect-checkbox');
                if (legacy) legacy.checked = next;
            }
        }
        return;                          // checkable keeps the menu open (AC-1)
    }
    if (variant === 'radio-submenu') {
        openSubmenu(item);               // E1.4 — open/toggle the child panel
        return;                          // parent row keeps the menu open
    }
    // E2.1 — the Connection ▸ Connect/Disconnect row drives the exported serial
    // toggle (relocated from the retired #connect-button handler), then closes the
    // menu (action semantics). Transient states are click-inert inside
    // toggleConnection itself, so no extra guard is needed here.
    const action = item.getAttribute('data-action');
    if (action === 'connect-toggle') {
        if (toggleConnectionRef) toggleConnectionRef();
        closeMenu();
        return;
    }
    // E2.2 (AC-5, FR-13) — Choose MicroBeast… drives the existing CP2102N-filtered
    // requestPort picker (injected as opts.chooseMicroBeast → connectMicroBeast),
    // letting the user pick which board, then closes the menu (action semantics).
    if (action === 'choose-microbeast') {
        if (chooseMicroBeastRef) chooseMicroBeastRef();
        closeMenu();
        return;
    }
    // E1.5 — an action row carrying data-action drives a View action (zoom / clear);
    // a bare action row just closes the menu.
    if (action) { runViewAction(action, ev); return; }
    closeMenu();                         // plain action item closes the menu (AC-2)
}

// ====== E1.5 — View ▸ Zoom / Clear action dispatch ======

// A View ▸ Zoom item runs the SAME canvas.js function the SACRED Ctrl+{=,-,0}
// chord runs (AD-13 keeps the chord in chrome.js; AD-7 relocates the menu action),
// then persists fontZoom (AD-4), clears the selection (D-19 — zoom is a trigger),
// and pushes the clamped level to the (future) status bar (AD-6 imperative push).
function applyZoom(mutate) {
    mutate();
    savePrefs({ fontZoom: getActiveZoom() });        // AD-4 — persist (same key as the chord)
    if (clearSelectionRef) clearSelectionRef();      // D-19 — selection clears on zoom change
    if (pushZoomRef) pushZoomRef(getActiveZoom());   // AD-6 — status-bar push (no-op until E4)
}

// Route a data-action to its behaviour. Zoom + Clear Screen close the menu after
// firing (action semantics). Clear Scrollback… closes the dropdown, then runs the
// deliberate-friction confirm (FR-11) and wipes only on confirm; with no confirm
// opt wired (a bare test harness) it falls back to a direct wipe.
function runViewAction(action, ev) {
    switch (action) {
        case 'zoom-in':     applyZoom(() => zoomStep(+1)); closeMenu(); return;
        case 'zoom-out':    applyZoom(() => zoomStep(-1)); closeMenu(); return;
        case 'zoom-actual': applyZoom(() => resetZoom());  closeMenu(); return;
        case 'clear-screen':
            clearScreen({ alsoScrollback: !!(ev && ev.shiftKey) });   // Shift → also scrollback (D-26)
            closeMenu();
            return;
        case 'clear-scrollback':
            closeMenu();                             // close the dropdown; the confirm takes over
            if (confirmClearScrollbackRef) {
                confirmClearScrollbackRef().then((ok) => { if (ok) clearScrollback(); });
            } else {
                clearScrollback();                   // no confirm wired (harness) — direct
            }
            return;
        default:
            closeMenu();
            return;
    }
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
    closeSubmenu();                       // E1.4 — a top-level change collapses any open submenu
    openMenu = (openMenu === key) ? null : key;
    focusedIndex = -1;
    render();
    projectMenuOnOpen();                  // re-derive prefs-driven rows at open (View: theme/phosphor; Connection: auto-connect + adapter count)
    refreshLiveRegion();
}

// focusFirstRow (←/→ nav) lands focus on the first enabled row; the default
// (click / public open() API) shows no highlight. projectMenuOnOpen runs BEFORE
// the focus computation so focusableItems() sees the freshly-derived Phosphor
// disabled state, and a single render() then opens the menu AND projects
// [data-focused] — no second pass.
function openMenuNamed(key, focusFirstRow = false) {
    if (!MENUS.includes(key)) return;
    closeSubmenu();                       // E1.4 — collapse any submenu from the previous menu
    openMenu = key;
    projectMenuOnOpen();                  // re-derive prefs-driven rows at open (View: theme/phosphor; Connection: auto-connect + adapter count)
    focusedIndex = (focusFirstRow && focusableItems().length > 0) ? 0 : -1;
    render();
    refreshLiveRegion();
}

// When a menu opens, re-derive its prefs-driven / live-state rows at USE-TIME.
// E1.4 — View: re-derive Theme/Phosphor check glyphs + Phosphor disabled state
// (keeps the menu correct after a Ctrl+Alt+T chord fired while it was closed —
// savePrefs updates `cached` synchronously (AD-4), so getPrefs() already reflects
// it; no chrome→menu notify edge (AD-3)). E2.2 — Connection: re-derive the
// Auto-connect row from prefs (AC-3 pane→menu; a legacy-checkbox toggle is
// reflected on the next open) and kick off the async adapter count that gates
// Choose MicroBeast… (AC-2). All reads are at USE-TIME; none call a setter.
function projectMenuOnOpen() {
    if (openMenu === 'view') projectPrefs();
    if (openMenu === 'connection') {
        projectAutoConnect();
        refreshChooseMicroBeast();
    }
}

// E2.2 (AC-1/AC-3) — project the Auto-connect checkable row from prefs.autoConnect
// at USE-TIME (the passed blob on reset, else getPrefs()). Read-at-use, no-throw,
// idempotent; NEVER calls a serial setter. Shared by the wire-time initial paint,
// the Connection-menu open re-derive, and the reset re-projection (projectPrefs).
function projectAutoConnect(prefs) {
    if (!autoConnectItemEl) return;                  // row absent (harness) — no-op
    const p = prefs || getPrefs();
    if (!p) return;
    autoConnectItemEl.setAttribute('data-checked', p.autoConnect ? 'true' : 'false');
    syncCheckGlyph(autoConnectItemEl);               // projects glyph + aria-checked
}

// E2.2 (AC-2, FR-13) — async-count the granted CP2102N adapters and show Choose
// MicroBeast… only when >1. The count is async and must never throw or block the
// menu open; the stale-guard reapplies only if the Connection menu is still open
// when the promise resolves (it may have closed first). No-op without the seam.
function refreshChooseMicroBeast() {
    if (!chooseMicroBeastItemEl || !getAdapterCountRef) return;
    const seq = ++chooseCountSeq;                    // this open's count; a stale one no-ops below
    Promise.resolve()
        .then(() => getAdapterCountRef())
        // Apply only if this is still the newest count AND the Connection menu is
        // still open — an out-of-order earlier resolve would otherwise stomp it.
        .then((n) => { if (seq === chooseCountSeq && openMenu === 'connection') setChooseMicroBeastPresent(n > 1); })
        .catch(() => {});                            // no-throw — never break the open
}

// Toggle the Choose MicroBeast… row's presence via the [hidden] attribute (a
// native [hidden] <button> is display:none — no extra CSS). A row appearing /
// disappearing between opens can strand keyboard focus on a now-hidden row, so
// re-derive top-level focus (a no-op on the mouse/click open path, focusedIndex -1).
function setChooseMicroBeastPresent(present) {
    if (!chooseMicroBeastItemEl) return;
    // Capture WHICH row is keyboard-focused BEFORE the membership change: adding /
    // removing Choose MicroBeast… (above other rows) shifts every focusableItems()
    // index, so a plain index clamp would silently slide the highlight onto a
    // different row. Re-anchor to the same row's new index; clamp only if it's gone.
    const focused = currentFocusedItem();
    if (present) chooseMicroBeastItemEl.removeAttribute('hidden');
    else chooseMicroBeastItemEl.setAttribute('hidden', '');
    if (focused) {
        const idx = focusableItems().indexOf(focused);
        if (idx >= 0) { focusedIndex = idx; renderFocus(); refreshLiveRegion(); return; }
    }
    reconcileFocusedRow();
}

function closeMenu() {
    if (openMenu === null) return;
    closeSubmenu();                       // E1.4 — collapse any open submenu with the menu
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
        if (dropdown) clearFocused(dropdown);
    }
    const item = currentFocusedItem();
    if (item) item.setAttribute('data-focused', 'true');
}

// Re-derive the top-level keyboard focus after a row's data-disabled state may
// have changed while the View menu is open (a Ctrl+Alt+T chord / reset flipping
// Phosphor+Font off-CRT). focusedIndex is an index into focusableItems(), which
// EXCLUDES disabled rows — so once the focused row is disabled it leaves that
// set and the stored index silently points at a different row (or past the end),
// while the disabled row keeps its stale [data-focused] highlight. Clamp the
// index back into range and renderFocus() (which clears every row's highlight
// first, dropping the stale one) so the highlight and the next arrow step stay
// valid. No-op when nothing is keyboard-focused (focusedIndex -1 / mouse path).
function reconcileFocusedRow() {
    if (focusedIndex < 0) return;
    const items = focusableItems();
    if (focusedIndex >= items.length) focusedIndex = items.length ? items.length - 1 : -1;
    renderFocus();
    refreshLiveRegion();
}

// ====== E1.3 (AD-14) — reset re-projection seam ======
// menu-bar.js registers as a prefsSubscribe subscriber (main.js) and owns
// re-projecting the View submenu's *menu DOM* (theme/phosphor check glyphs,
// font radio, zoom label) from prefs whenever resetPrefs() fans out. The
// division of labour that avoids the AD-14 double-apply race: applyPrefs owns
// the canvas setters (setTheme/setPhosphor/setFont/setZoom — exactly one call
// site each); projectPrefs owns ONLY the View menu projection and must NEVER
// call a canvas setter.
//
// Those submenus are structural placeholders today (E1.4 fills theme/phosphor;
// E1.5 fills font/zoom), so this is a SAFE, IDEMPOTENT no-op that touches only
// present DOM. Standing up the subscription + the no-throw/idempotence contract
// NOW means resetPrefs() already re-projects the View menu the instant E1.4/E1.5
// add real state — they only fill the body below.
//
// Contract (relied on by E1.4/E1.5): reads prefs at USE-TIME (the blob
// resetPrefs passes, else getPrefs()) — never caches the ref (AD-4); never
// throws (guards every lookup); calling it twice yields identical DOM. It must
// only ever touch View *item* check/label state — render() stays the SOLE
// writer of open/close ([hidden]/data-open) state (Task 5.3 compliance).
export function projectPrefs(prefs) {
    const p = prefs || getPrefs();
    if (!p) return;                                  // nothing to project — no-op
    // E2.2 (AC-3) — re-project the Connection ▸ Auto-connect row from p.autoConnect
    // so resetPrefs() (AD-14) restores the unchecked default in the menu DOM.
    // Resolved BEFORE (and independently of) the View-dropdown guard below: a
    // View-less harness must still get the auto-connect reset re-projection.
    projectAutoConnect(p);
    const viewDropdown = dropdownEls.view || document.getElementById('dropdown-view');
    if (!viewDropdown) return;                       // View menu absent — no-op
    // E1.4 — project p.theme + p.phosphor onto the submenu radio check glyphs and
    // re-derive Phosphor's disabled state from the theme. Reads at USE-TIME (the
    // passed blob, else getPrefs()), NEVER calls a canvas setter (applyPrefs owns
    // those on reset — AD-14 single-writer), NEVER writes top-level open/close
    // state, and is idempotent + no-throw (every lookup guarded).
    const themePanel = viewDropdown.querySelector('.submenu[data-submenu-panel="theme"]');
    if (themePanel && p.theme) setRadioChecked(themePanel, p.theme);
    const phosphorPanel = viewDropdown.querySelector('.submenu[data-submenu-panel="phosphor"]');
    if (phosphorPanel && p.phosphor) setRadioChecked(phosphorPanel, p.phosphor);
    if (p.theme) syncSubmenuDisabled(viewDropdown, p.theme, 'phosphor', 'Phosphor');
    // E1.5 — project p.font onto the Font submenu's active radio and re-derive the
    // Font parent's data-disabled from the theme (AD-9), mirroring theme/phosphor.
    // Reads at USE-TIME, never calls a canvas setter (applyPrefs owns setFont —
    // AD-14 single-writer), idempotent, no-throw.
    const fontPanel = viewDropdown.querySelector('.submenu[data-submenu-panel="font"]');
    if (fontPanel && p.font) setRadioChecked(fontPanel, p.font);
    if (p.theme) syncSubmenuDisabled(viewDropdown, p.theme, 'font', 'Font');
    // If this re-projection just disabled the row the user was keyboard-focused
    // on (Ctrl+Alt+T / reset flipping Phosphor+Font off-CRT while View is open),
    // re-derive top-level focus so no stale [data-focused] lingers and the next
    // arrow key lands on the right row. Guarded on the open View menu; a no-op on
    // the closed-menu reset path (focusedIndex is -1 there).
    if (openMenu === 'view') reconcileFocusedRow();
    // Zoom has NO persistent menu-DOM to project — the View ▸ Zoom items are
    // stateless actions; the live level surfaces in the status bar (E4). The reset
    // zoom→status push lives at applyPrefs's setZoom site (AD-6/AD-14 single-writer),
    // not here, so the zoom half is a deliberate no-op.
}

// ====== E2.1 (AD-15) — connection projection (the sole Connect-surface writer) ======

// The SOLE writer of every Connect surface: the Connect menu item (label +
// data-state), the right-aligned status dot (data-state → discrete colour) and
// its label, and — during coexistence — the legacy #connect-button (label +
// data-state) so the transport/session oracles stay green (Task 3). Fed by the
// serial onStateChange subscription + the boot initial paint; NEVER calls a
// serial setter / connect / disconnect (reading state must not re-drive the
// machine — the E1.4 double-apply lesson). Mirrors projectPrefs's contract:
// read-at-use, no-throw (every ref null-guarded), idempotent. Does NOT touch
// menu open/close state — render() stays that sole writer.
function projectConnection(state) {
    const label = CONNECT_LABELS[state] || CONNECT_LABELS.disconnected;
    writeConnectLabel(label);                      // action label (item + legacy button)
    if (connectItemEl) connectItemEl.dataset.state = state;
    if (connDotEl) connDotEl.dataset.state = state;
    if (connLabelEl) connLabelEl.textContent = CONN_STATUS_LABELS[state] || CONN_STATUS_LABELS.disconnected;
    // Coexistence mirror — retires with #top-bar in E7 (E1 retro action #5).
    if (legacyConnectBtnEl) legacyConnectBtnEl.dataset.state = state;
}

// The single source of truth for WHICH surfaces carry the Connect ACTION label:
// the #menu-connect-item .lbl and — during coexistence — the legacy
// #connect-button. Shared by projectConnection (the state path) and
// signalConnectLabel (the out-of-band override) so the surface list can never
// drift between them. Null-guarded — a missing surface is a no-op.
function writeConnectLabel(label) {
    if (connectItemEl) {
        const lbl = connectItemEl.querySelector('.lbl');
        if (lbl) lbl.textContent = label;
    }
    if (legacyConnectBtnEl) legacyConnectBtnEl.textContent = label;
}

// AC-4 — the out-of-band "Choose MicroBeast…" prompt (multi-adapter guard). Not
// representable by the 5-state CONNECT_LABELS map, so serial.js hands the literal
// string here via opts.signalConnectLabel; menu-bar.js (the sole writer) paints
// it onto the Connect ACTION surfaces until the next setState re-projects. The
// status dot/label keep their port-lost state (red / "Connection lost") — only
// the actionable label is overridden, matching the incumbent button behaviour.
function signalConnectLabel(label) {
    writeConnectLabel(label);
}

// ====== Public API ======

function buildApi() {
    return {
        open: openMenuNamed,
        close: closeMenu,
        getOpenMenu: () => openMenu,
        // E1.3 (AD-14) — reset re-projection seam; main.js registers it as a
        // prefsSubscribe subscriber and tests drive it via window.__menuBar.
        projectPrefs,
        // E2.1 (AC-4) — main.js hands this to wireSerial as opts.signalConnectLabel
        // so the multi-adapter guard can surface "Choose MicroBeast…" through the
        // sole writer. Also exposed for tests to drive the override directly.
        signalConnectLabel,
        // E2.1 (AC-3) — expose the projection so tests can drive discrete states
        // deterministically (incl. the transient connecting/reconnecting labels)
        // without racing a live serial handshake.
        projectConnection,
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

export function dispose() {
    // Close any open dropdown FIRST so a disposed bar is left visually shut
    // (render() clears [hidden]/data-open/data-active-menu + [data-focused]).
    closeSubmenu();                       // E1.4 — collapse any open submenu too
    openMenu = null;
    focusedIndex = -1;
    render();
    // Detach every listener we attached (title clicks + item clicks + the
    // document click-away + the legacy #connect-button click) so the disposed bar
    // is fully inert — clicking a title no longer toggles a dropdown.
    removeTrackedListeners();
    // E2.1 (AC-6) — unsubscribe the serial onStateChange subscriber so a disposed
    // bar stops projecting connection state (and a re-wire never double-subscribes).
    if (connUnsub) { connUnsub(); connUnsub = null; }
}

// ====== Test introspection (matches the window.__* pattern) ======

export function __getStateForTests() {
    const focused = currentFocusedItem();
    const lbl = focused ? focused.querySelector('.lbl') : null;
    // E1.4 — additive submenu introspection (openMenu/focusedIndex shape from
    // E1.1/E1.2 is unchanged). openSubmenu is the open panel's key or null;
    // submenuFocusLabel is the focused radio's label within it.
    const subFocused = openSubmenuPanel ? submenuItems()[submenuFocusIndex] : null;
    const subLbl = subFocused ? subFocused.querySelector('.lbl') : null;
    return {
        openMenu,
        focusedIndex,                                  // E1.2 — index into focusable rows; -1 = none
        focusedLabel: lbl ? lbl.textContent.trim() : null,
        menus: MENUS.slice(),
        wired: menuBarEl !== null,
        hasTerminalWrapper: terminalWrapperRef !== null,
        openSubmenu: openSubmenuPanel ? openSubmenuPanel.getAttribute('data-submenu-panel') : null,
        submenuFocusIndex,                             // E1.4 — index into open submenu radios; -1 = none
        submenuFocusLabel: subLbl ? subLbl.textContent.trim() : null,
    };
}

export function __resetForTests() {
    closeSubmenu();                       // E1.4 — collapse any open submenu
    openMenu = null;
    focusedIndex = -1;
    lastAnnounced = '';
    render();
    if (liveRegionEl) liveRegionEl.textContent = '';
}
