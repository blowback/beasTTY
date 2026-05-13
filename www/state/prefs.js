// Beastty Phase 6 Plan 06 (Wave 5) — versioned prefs blob in localStorage.
//
// Public API: loadPrefs, savePrefs, resetPrefs, subscribe, getPrefs, DEFAULTS.
//
// Sources:
//   - 06-CONTEXT.md D-32..D-36.
//   - 06-RESEARCH.md §Pattern 5 + §Code Examples (verbatim).
//   - 06-PATTERNS.md §"www/state/prefs.js" (verbatim).
//   - 06-UI-SPEC.md §"localStorage schema migration" (verbatim D-32 schema).
//
// STORAGE_KEY 'beastty.prefs' is DISTINCT from Phase 5's
// 'beastty.port.preset' — identity vs. config are conceptually distinct
// (D-32 + 05-CONTEXT.md D-31).

const STORAGE_KEY = 'beastty.prefs';
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
    slideAutoSendCommand: 'B:SLIDE R\r',          // Phase 11 — D-09 (SLIDE-37) — trailing \r is a 0x0D byte, not a literal backslash-r
    slideShowSummary: true,                       // Phase 11 — D-09 (D-08 default ON; Cancelled summary chip ALWAYS shows regardless)
    slideCompatibilityMode: 'auto',               // Phase 11 — D-09 ('auto' | 'wakeup-required' | 'force-start')
    slideAutoSendCommandConfirmed: '',            // Phase 12 SLIDE-38: exact-match flag, keyed to the value last confirmed.
                                                  //   Empty string = never confirmed. Re-arms on every Settings change.
                                                  //   CURRENT_VERSION NOT bumped per Phase 6 D-32 defensive merge.
    slideConfirmTransfers: true,
        // v1.1 polish (260513-grs Task 2) — default ON preserves the existing
        // confirm-modal flow. Toggle in #settings-slide → "Confirm file transfers".
        // When false, www/input/file-source.js's processFiles skips
        // showConfirmModal entirely; collisions auto-rename via the SLIDE-36
        // applyCollisionRenames helper (same logic the modal's [Send N renamed]
        // button uses). CURRENT_VERSION NOT bumped per Phase 6 D-32 defensive
        // merge (older blobs missing this field receive `true` via the
        // loadPrefs spread fill).
    serialAssertRtsOnConnect: true,
        // Phase 12.1 Plan 12-08 — gates connect-time setSignals.requestToSend
        // (true = assert RTS on every port.open(); false = de-assert RTS as
        // per the original Phase 5 D-09 safe-default). Default true because
        // MicroBeast Z80-side UART hardware auto-flow-control requires host
        // RTS asserted (slide-team finding 2026-05-09 hardware UAT). Toggle
        // exists for users on hardware where RTS is wired to a reset GPIO
        // (Pitfall #12 original concern). DTR remains de-asserted on connect
        // in ALL paths — DTR-as-reset is more credible. Close-time setSignals
        // (beforeunload + teardown) is UNCHANGED — RTS=false on close is
        // clean signalling that Beastty is going away. CURRENT_VERSION NOT
        // bumped per Phase 6 D-32 defensive merge (older blobs missing this
        // field receive `true` via the loadPrefs spread fill).
});

// Phase 10 review WR-04 — fields that MUST never live in the localStorage
// prefs blob. CONTEXT D-03 specifies `slideRecvDirectoryHandle` lives in
// IndexedDB (handles cannot JSON-roundtrip; storing a string would defeat
// IDB ownership and create a dual-storage hazard). The DEFAULTS object
// already omits this field, but the partial-blob merge in `loadPrefs` would
// happily incorporate it if a stored blob (corrupt, hand-edited, or future
// schema variant) carried one. Strip these fields actively after the merge
// so prefs.{IDB_ONLY_FIELDS[i]} is guaranteed undefined for callers.
const IDB_ONLY_FIELDS = Object.freeze(['slideRecvDirectoryHandle']);

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
        // Phase 10 review WR-04 — strip IDB-only fields that may have leaked
        // into the blob (corrupt store, hand-edited, future-schema crosstalk).
        // Handles cannot JSON-roundtrip, so a stored value here is meaningless;
        // exposing it via getPrefs() would invite dual-storage drift between
        // the blob and the canonical IndexedDB record (CONTEXT D-03).
        for (const key of IDB_ONLY_FIELDS) delete cached[key];
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

// Phase 12 SLIDE-38 — auto-send command safety regex.
// Body uses `*` (zero-or-more) NOT `+` so the bare `\r` case is admitted —
// harmless on the Z80 (CCP receives a CR with no command body and re-prompts).
// HTML-relevant characters (`<`, `>`, `&`, `"`, `'`) are not in this character
// class, so values that pass this gate are also XSS-safe by construction
// (T-12-05).
//
// Plan 12-03 Rule 1 deviation: the regex literal recorded in 12-RESEARCH.md
// Pitfall 5 + 12-UI-SPEC.md §SLIDE-38 was `/^[A-Za-z0-9:]*\r$/`, which
// REJECTS the default DEFAULTS literal `'B:SLIDE R\r'` because the space
// (0x20) between `R` and CR is not in `[A-Za-z0-9:]`. The SAFE_CASES /
// UNSAFE_CASES locked table in the same docs (and 12-VALIDATION.md) lists
// `'B:SLIDE R\r'` and `'A:SLIDE R\r'` as MUST-PASS, so the SAFE_CASES table
// is internally inconsistent with the regex literal. The SAFE/UNSAFE table
// is the authoritative artefact (the default auto-type value MUST be
// accepted or auto-send is broken at every install — the locked default in
// DEFAULTS.slideAutoSendCommand contains the space), so the character class
// is widened to include the space character. The threat model survives:
// semicolons, pipes, LF, multiple CR, control chars, and backslash are all
// still outside the class and still rejected by the same regex (the 5
// UNSAFE_CASES still all fail the gate).
const SAFE_AUTO_SEND_RE = /^[A-Za-z0-9: ]*\r$/;

/**
 * SLIDE-38: validate auto-send command for wire safety.
 * Empty string is the SLIDE-13 disabled sentinel and bypasses the regex
 * (auto-type is suppressed entirely; nothing reaches the wire).
 * Returns false for non-string inputs (defensive against undefined/null).
 */
export function isAutoSendSafe(cmd) {
    if (typeof cmd !== 'string') return false;
    if (cmd.length === 0) return true;
    return SAFE_AUTO_SEND_RE.test(cmd);
}

export { DEFAULTS };
