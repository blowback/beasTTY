// BestialiTTY Phase 6 Plan 06 (Wave 5) — versioned prefs blob in localStorage.
//
// Public API: loadPrefs, savePrefs, resetPrefs, subscribe, getPrefs, DEFAULTS.
//
// Sources:
//   - 06-CONTEXT.md D-32..D-36.
//   - 06-RESEARCH.md §Pattern 5 + §Code Examples (verbatim).
//   - 06-PATTERNS.md §"www/state/prefs.js" (verbatim).
//   - 06-UI-SPEC.md §"localStorage schema migration" (verbatim D-32 schema).
//
// STORAGE_KEY 'bestialitty.prefs' is DISTINCT from Phase 5's
// 'bestialitty.port.preset' — identity vs. config are conceptually distinct
// (D-32 + 05-CONTEXT.md D-31).

const STORAGE_KEY = 'bestialitty.prefs';
const CURRENT_VERSION = 1;

const DEFAULTS = Object.freeze({
    version: CURRENT_VERSION,
    theme: 'crt',
    phosphor: 'green',
    font: 'modern',
    fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false,
    crlfMode: 'cr',
    autoConnect: false,
    showAllSerialDevices: false,
    slideRecvToFolder: false,    // Phase 10 — CONTEXT D-02 (default OFF; toggle in Settings pane lands in Plan 10-04)
});

let cached = null;
let saveTimer = null;
const subscribers = [];

export function loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            cached = structuredClone(DEFAULTS);
            return cached;
        }
        let parsed = JSON.parse(raw);
        if (typeof parsed.version !== 'number' || parsed.version > CURRENT_VERSION) {
            // Future-version blob OR malformed — fall back to defaults wholesale
            // so we never trust fields a future schema might have moved.
            parsed = structuredClone(DEFAULTS);
        } else if (parsed.version < CURRENT_VERSION) {
            // Field-by-field upgrade: keep stored fields, fill missing from defaults,
            // bump version. Future plans add per-version migration steps here.
            parsed = { ...DEFAULTS, ...parsed, version: CURRENT_VERSION };
        }
        // Defensive merge — partial-blob safety: a stored object missing the
        // serial sub-object (e.g. v0 prototype data, or a hand-edited blob)
        // must not produce undefined when consumers read prefs.serial.baud.
        cached = { ...DEFAULTS, ...parsed, serial: { ...DEFAULTS.serial, ...(parsed.serial || {}) } };
        return cached;
    } catch (err) {
        // Pitfall 5 — JSON.parse failure / SecurityError in incognito / corrupt
        // blob: log and fall back to defaults so boot never aborts here.
        console.warn('[prefs] load failed; falling back to defaults', err);
        cached = structuredClone(DEFAULTS);
        return cached;
    }
}

export function savePrefs(partial) {
    cached = { ...cached, ...partial };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPrefs, 250);   // D-33 debounce — 250 ms locked.
}

// Phase 6 Plan 06-09 (gap closure) — flushPrefs MUST NOT fire subscribers.
// Rationale: every savePrefs() call originates from a user action that
// already mutated the DOM (theme click, phosphor click, serial-config
// selectOption, etc.). Re-applying the just-saved blob to the DOM 250 ms
// later is at best a no-op and at worst races against any other code
// path that touched the same DOM in the intervening window (the proven
// case is snapPreset in transport/serial.js, fixed in companion task).
// External callers that need a notification — version migration on
// load, the Reset prefs 2-click confirm path — go through resetPrefs()
// which still iterates subscribers below.
function flushPrefs() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
    } catch (err) {
        // Pitfall 5 — QuotaExceededError or SecurityError (incognito with
        // storage disabled): swallow silently; in-memory prefs preserved for
        // the session. console.warn for developer triage only — no user UI.
        if (err && err.name === 'QuotaExceededError') {
            console.warn('[prefs] Could not persist preferences (storage quota). In-memory only.');
        } else {
            console.warn('[prefs] Could not persist preferences:', err);
        }
    }
    saveTimer = null;
    // No subscriber fan-out here — see comment block above this function.
}

// D-33 — flush immediately on beforeunload so a pending debounced write
// is not lost when the user navigates away. Independent of Phase 5's
// beforeunload teardown handler in serial.js (both fire; no ordering dep).
window.addEventListener('beforeunload', () => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        flushPrefs();
    }
});

// D-35 — reset all preferences. Removes the storage key and replaces the
// in-memory blob with defaults; subscribers re-apply defaults to chrome state
// in-place (no page reload).
export function resetPrefs() {
    cached = structuredClone(DEFAULTS);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    for (const fn of subscribers) fn(cached);
}

export function subscribe(fn) {
    subscribers.push(fn);
    return () => {
        const i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
    };
}

export function getPrefs() {
    return cached;
}

export { DEFAULTS };
