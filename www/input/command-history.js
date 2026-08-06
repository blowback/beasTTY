// Beastty Epic E8 Story E8.1 — command capture engine (line mirror + history store).
//
// Beastty is a character-by-character passthrough terminal: every keydown is
// encoded by the wasm core and pushed to the wire; the MicroBeast does all echo
// and line editing (Beastty holds no line buffer). This module adds the first
// piece of "command history" WITHOUT changing wire behaviour: a JS-shell line
// mirror that reconstructs the current input line from outbound keystrokes, and a
// history store (persisted in prefs) it commits to on each Enter.
//
// HARD INVARIANT (NFR-2): this module observes and persists ONLY. It must never
// call pushTxBytes or otherwise emit a byte. E8.2's recall overlay is what will
// send bytes (on Enter, reusing commit()); E8.3 is the Settings surface.
//
// The capture hook is placed at keyboard.js's forwardBytes choke point (:297),
// which sees TYPED keystrokes only — paste flows through paste-pump.js on a
// different path that never reaches here, so pasted lines are excluded for free
// (PRD OQ-4), with no paste-detection logic.
//
// Direct-import allowlist (AD-3): state/prefs.js (AD-4 — getPrefs/savePrefs) and
// transport/slide.js (isTransferRunning, sibling-ish import per the keyboard.js:22
// and paste-pump.js precedents). NO wasm/Rust import (NFR-1); no pushTxBytes
// (no emission). The tx-sink import this module used to carry for AD-5's
// getWireOwner is gone — that check now lives inside isTransferRunning().
//
// Sources:
//   - _bmad-output/planning-artifacts/epics-command-history.md#Story E8.1 (ACs).
//   - ARCHITECTURE-SPINE.md #AD-1/#AD-2 (composition-root + wireXxx shape),
//     #AD-3 (import allowlist), #AD-4 (prefs read-at-use-time), #AD-5 (getWireOwner).
//   - www/input/keyboard.js:51-66 (KEY_TAG), :287-298 (choke point + info fields).
//   - crates/beastty-core/src/key.rs — Backspace→0x08, Ctrl-U→0x15, Ctrl-X→0x18.

import { getPrefs, savePrefs, DEFAULTS } from '../state/prefs.js';
// E11 retrospective (2026-08-06) — capture used to suspend on
// `getWireOwner() === 'slide'` alone, which is true once a session owns the
// wire but NOT in the window after the SLIDE command has been auto-typed and
// before the Z80's wakeup arrives. Keystrokes in that window were mirrored
// into history as if they were the user's own command line. isTransferRunning()
// covers that window (and both directions) in one place.
import { isTransferRunning } from '../transport/slide.js';

// Control-byte constants (crates/beastty-core/src/key.rs). Backspace is always
// 0x08 (BS, not DEL); Ctrl-letter is upper−0x40 → Ctrl-U 0x15, Ctrl-X 0x18.
const BYTE_BS     = 0x08;   // Backspace (and Ctrl-H, which the wire treats identically) → pop
const BYTE_CTRL_U = 0x15;   // Ctrl-U → clear line
const BYTE_CTRL_X = 0x18;   // Ctrl-X → clear line

// Modifier bit layout (keyboard.js packModifiers / key.rs:165-168).
const MOD_CTRL = 0b0001;
const MOD_ALT  = 0b0100;
const MOD_META = 0b1000;

// --- Module-scope state ---------------------------------------------------
// The line mirror: a TRANSIENT reconstruction of the line being typed. NOT
// persisted, NOT derived from getPrefs() — it exists only to answer "what
// command did the user just send" when Enter arrives. The persisted store lives
// in prefs.commandHistory (read fresh at use-time per AD-4).
let mirror = '';

// --- Wire entry (composition-root DI — AD-1/AD-2) -------------------------

export function wireCommandHistory(opts) {
    // No injected deps in E8.1: enable/size/store are all read fresh from
    // getPrefs() at use-time (AD-4), and whether a transfer is running is asked
    // of isTransferRunning() directly. opts is accepted for shape parity with the other wireXxx
    // modules and forward-compatibility with E8.2/E8.3.
    void opts;

    // Reset transient state on (re)wire so an idempotent re-wire never carries a
    // stale half-typed line. Persisted history is untouched.
    mirror = '';

    return {
        capture,
        isLineEmpty,
        getHistory,
        commit,
        clear,
        trimToCap,
        toggleEnabled,
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

// --- Capture path (AC-1, AC-2, AC-4) --------------------------------------

// The keystroke classifier, fed each TYPED keystroke from keyboard.js's choke
// point. `info` carries { e, code, mods, bytes, wasEnter } (all in scope at
// keyboard.js:293-297). Observation-only — never emits a byte.
function capture(info) {
    const p = getPrefs();
    // AC-4 / AC-6 — inert when disabled or if prefs unavailable (crash-safe
    // degrade), and suspended while a SLIDE transfer owns the wire (the hook is
    // upstream of tx-sink's SLIDE gate, so the engine must check the owner itself).
    if (!p || p.commandHistoryEnabled === false) return;
    if (isTransferRunning()) return;

    const { mods, bytes, wasEnter } = info;

    // AC-1 — Enter is the terminator regardless of crlfMode; commit + reset.
    if (wasEnter) { commitMirror(); return; }

    const b0 = bytes && bytes.length ? bytes[0] : -1;

    // AC-2 — Backspace pops the last char (0x08, whether from the Backspace key
    // or Ctrl-H, both of which the remote treats as a backspace).
    if (b0 === BYTE_BS) {
        if (mirror.length > 0) mirror = mirror.slice(0, -1);
        return;
    }

    // AC-2 — Ctrl-U / Ctrl-X clear the whole line.
    if (b0 === BYTE_CTRL_U || b0 === BYTE_CTRL_X) {
        mirror = '';
        return;
    }

    // AC-1/AC-2 — a printable keystroke appends the WIRE byte itself. Guard: no
    // Ctrl/Alt/Meta held (Shift is fine — it produced the shifted byte) and the
    // emitted byte lands in the printable ASCII range 0x20–0x7E. Mirroring the byte
    // that reached the MicroBeast (bytes[0]) rather than the KEY_TAG or e.key so
    // numeric-keypad keys stay in sync: key.rs encodes them to real printable bytes
    // ('0'-'9', ',', '-', '.') off e.code regardless of NumLock, so e.key can read
    // 'End'/'Insert'/'\0' while '1' is what was actually sent. Without this, a
    // command typed on the keypad (e.g. `GOTO 100`) would desync from the wire.
    // Everything else (arrows, Esc, Tab, function keys, other Ctrl combos) leaves
    // the mirror unchanged; the Keypad Enter terminator is the wasEnter branch above.
    if ((mods & (MOD_CTRL | MOD_ALT | MOD_META)) === 0
        && b0 >= 0x20 && b0 <= 0x7E) {
        mirror += String.fromCharCode(b0);
    }
    // else: no-op — fancier in-line editing is explicitly not tracked (FR-2). A
    // rare cosmetic mismatch never affects the wire.
}

// AC-1/AC-3 — commit the mirror on Enter: a non-empty line goes to the store
// (via the shared commit path), then the mirror resets. An empty mirror is a
// no-op (blank Enter never stores an entry).
function commitMirror() {
    if (mirror.length === 0) return;
    commit(mirror);
    mirror = '';
}

// --- History store (AC-3, AC-5, AC-6) -------------------------------------

// Clamp the size cap to a positive integer: a corrupt/hand-edited blob (or a bad
// Settings input yielding NaN/""/negative) must not mis-truncate from the tail or
// wipe the store. Falls back to the default. Shared by commit() and trimToCap() so
// the corruption-defense rule lives in one place.
function capOf(p) {
    return Number.isInteger(p.commandHistorySize) && p.commandHistorySize > 0
        ? p.commandHistorySize : DEFAULTS.commandHistorySize;
}

// The shared dedup + cap + persist path. E8.2's overlay reuses this for its
// Enter-send so a recalled-and-sent command re-sorts to newest identically.
// Read prefs fresh (AD-4 — never cache the ref across savePrefs).
function commit(str) {
    const p = getPrefs();
    if (!p) return;   // crash-safe degrade (AC-6)
    const existing = Array.isArray(p.commandHistory) ? p.commandHistory : [];
    // Dedup, newest-first, exact-string / case-sensitive (AC-3): an existing copy
    // is removed then re-inserted at the head, so it MOVES to newest (never a
    // duplicate). Then the size cap drops the oldest tail entries (AC-5).
    let next = [str, ...existing.filter((c) => c !== str)];
    // Cap drops the oldest tail entries (AC-5); capOf() clamps a corrupt cap.
    next = next.slice(0, capOf(p));
    savePrefs({ commandHistory: next });   // debounced localStorage flush (FR-21)
}

// --- Public API for E8.2 / E8.3 (AC-7) ------------------------------------

// FR-5 — drives E8.2's trigger: the recall overlay opens on ↑ only when the
// operator is not mid-line (mirror empty).
function isLineEmpty() { return mirror.length === 0; }

// Newest-first store → E8.2's list. Crash-safe empty on absent/corrupt prefs
// (non-array blob degrades to []). Returns a fresh copy so an E8.2 in-place
// edit can never corrupt the cached prefs array outside savePrefs.
function getHistory() {
    const h = getPrefs()?.commandHistory;
    return Array.isArray(h) ? [...h] : [];
}

// E8.3 — clear all history.
function clear() { savePrefs({ commandHistory: [] }); }

// E8.3 (AC-3) — trim the store to the current commandHistorySize immediately.
// Called when a Settings size preset is selected (not just at next commit), so
// dropping the excess is visible right away. Read prefs fresh (AD-4) and clamp via
// the shared capOf(). Store is newest-first, so slice(0, cap) keeps the newest and
// drops the oldest tail; a no-op when already within the cap.
function trimToCap() {
    const p = getPrefs();
    if (!p) return;   // crash-safe degrade
    const history = Array.isArray(p.commandHistory) ? p.commandHistory : [];
    const cap = capOf(p);
    if (history.length > cap) savePrefs({ commandHistory: history.slice(0, cap) });
}

// E8 escape hatch (2026-08-06) — flip commandHistoryEnabled and return the new value.
// The keyboard chord (Ctrl+Shift+Insert / Ctrl+Alt+H) and the Settings ▸ Command history
// checkbox write the SAME pref, so there is one notion of "on"; the checkbox re-projects
// from prefs the next time the menu opens. Lives here because this module already owns
// the feature's other prefs writes (clear, trimToCap), and — like them — it emits no byte.
//
// Read prefs fresh (AD-4). "Anything but an explicit false is on" is the same reading
// capture() and the overlay's trigger use, so a blob predating E8.1 (key absent) flips
// to off, which is what an operator pressing the chord is asking for. savePrefs does NOT
// fan out to subscribers — the caller shows the toast.
function toggleEnabled() {
    const p = getPrefs();
    const next = !(p ? p.commandHistoryEnabled !== false : true);
    savePrefs({ commandHistoryEnabled: next });
    return next;
}

// wireXxx shape parity (AD-2). No listeners/subscriptions to tear down; the
// transient mirror is dropped so a disposed engine holds no line state.
function dispose() { mirror = ''; }

// --- Test hooks -----------------------------------------------------------

function __getStateForTests() {
    const p = getPrefs();
    return {
        mirror,
        history: p?.commandHistory ?? [],
        enabled: p ? p.commandHistoryEnabled !== false : true,
        size: p?.commandHistorySize ?? null,
    };
}

// Clears the transient mirror and empties the persisted store so a spec starts
// from a known-clean slate within a single page (reload-persistence specs seed
// localStorage instead and do NOT call this).
function __resetForTests() {
    mirror = '';
    savePrefs({ commandHistory: [] });
}
