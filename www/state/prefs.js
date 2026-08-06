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
// v2 — the SLIDE auto-send command line was replaced by where SLIDE.COM lives
// (drive + program name) plus an auto-start switch. See migrateV1ToV2 below.
const CURRENT_VERSION = 2;

const DEFAULTS = Object.freeze({
    version: CURRENT_VERSION,
    theme: 'crt',
    phosphor: 'green',
    font: 'modern',
    fontZoom: 1,
    serial: { baud: 19200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
    localEcho: false,
    crlfMode: 'cr',
    wrapLongLines: false,        // Settings ▸ Wrap long lines — optional deferred autowrap at
                                 //   col 80 in the wasm core (term.set_wrap). Default OFF preserves
                                 //   the VT52 last-column overstrike. First pref that reaches the
                                 //   core; applied by main.js applyPrefs. CURRENT_VERSION NOT bumped
                                 //   (defensive spread-merge, same precedent as showDebugPanel below).
    stripCtrlLogs: false,        // Settings ▸ Strip ctrl codes from logs — when ON, a downloaded
                                 //   session log has C0 control bytes + whole VT52 escape sequences
                                 //   removed (CR/LF kept) for a readable transcript. Read at
                                 //   download time by session-log.js; no live apply. CURRENT_VERSION
                                 //   NOT bumped (defensive spread-merge, same precedent as above).
    autoConnect: false,
    showDebugPanel: false,       // E5.1 (FR-23, AD-11) — Debug ▸ Show Debug Panel checkable, default OFF.
                                 //   New boolean rides the defensive spread-merge; CURRENT_VERSION NOT bumped
                                 //   (same precedent as slideConfirmTransfers / serialAssertRtsOnConnect above).
    showAllSerialDevices: false,
    slideRecvToFolder: false,    // Phase 10 — CONTEXT D-02 (default OFF; toggle in Settings pane lands in Plan 10-04)
    // ── Where SLIDE.COM lives on the device (v2; replaces the v1 auto-send
    //    command line). Beastty appends the direction letter itself — `R` when
    //    it sends a file to the device, `S` when the pull pane asks for files —
    //    plus the CR, so the stored value is a location, not a command. Stating
    //    it once means both directions invoke the same program: before v2 the
    //    pull side was hardcoded to a bare `SLIDE S`, which CP/M answers with
    //    `SLIDE?` from any drive that isn't the one holding SLIDE.COM.
    slideProgramDrive: 'A:',                      // 'A:'..'P:' — a drive is always stated (no "current drive")
    slideProgramName: 'SLIDE.COM',                // CP/M 8.3 name; the '.COM' is optional ('SLIDE' is equivalent)
    slideAutoStart: true,                         // Auto-start SLIDE on the device before sending. OFF = type nothing
                                                  //   (you run SLIDE R yourself) — the v1 empty-command sentinel, now
                                                  //   explicit. The location above still drives the PULL command, so
                                                  //   drag-to-pull keeps working with auto-start off.
    slideShowSummary: true,                       // Phase 11 — D-09 (D-08 default ON; Cancelled summary chip ALWAYS shows regardless)
    slideCompatibilityMode: 'auto',               // Phase 11 — D-09 ('auto' | 'wakeup-required' | 'force-start')
    slideConfirmTransfers: true,
        // v1.1 polish (260513-grs Task 2) — default ON preserves the existing
        // confirm-modal flow. Toggle in #settings-slide → "Confirm file transfers".
        // When false, www/input/file-source.js's processFiles skips
        // showConfirmModal entirely; collisions auto-rename via the SLIDE-36
        // applyCollisionRenames helper (same logic the modal's [Send N renamed]
        // button uses). CURRENT_VERSION NOT bumped per Phase 6 D-32 defensive
        // merge (older blobs missing this field receive `true` via the
        // loadPrefs spread fill).
    commandHistoryEnabled: true,   // E8.1 (FR-6, NFR-3) — Command History capture engine on/off.
                                   //   When false, command-history.js's capture path early-returns
                                   //   (inert; no line mirror, no store writes). Toggle lands in E8.3
                                   //   Settings. CURRENT_VERSION NOT bumped per D-32 defensive merge.
    commandHistorySize: 100,       // E8.1 (FR-20) — max distinct commands retained; oldest (tail)
                                   //   dropped on overflow. Read fresh at commit-time so an E8.3 change
                                   //   applies on the next Enter. CURRENT_VERSION NOT bumped.
    commandHistory: [],            // E8.1 (FR-21) — persisted command store, newest-first. Top-level
                                   //   array so the defensive spread-merge replaces it wholesale (not the
                                   //   nested-object merge path). CURRENT_VERSION NOT bumped.
    pasteLineEnding: 'cr',         // Settings ▸ Paste line ending — what every line break in PASTED
                                   //   text is rewritten to before it reaches the wire
                                   //   ('cr' | 'lf' | 'crlf' | 'raw'). Deliberately SEPARATE from
                                   //   crlfMode above: that one governs the Enter key, this one governs
                                   //   paste, and neither reads the other. Clipboard text on Linux
                                   //   arrives LF-only, which the MicroBeast does not accept as a line
                                   //   break — hence the 'cr' default. 'raw' passes the clipboard bytes
                                   //   through untouched. Validated at its consumer (paste-pump.js
                                   //   setPasteLineEnding), as crlfMode is at setCrlfMode — prefs.js has
                                   //   no field validation. CURRENT_VERSION NOT bumped per Phase 6 D-32
                                   //   defensive merge, same as every pref above.
    pasteSpeed: 240,               // Settings ▸ Paste speed — bytes/sec the paste pump aims for BETWEEN
                                   //   line breaks, with 0 meaning "as fast as the wire allows" (the
                                   //   pre-fix behaviour, kept for targets that can take it). Each line
                                   //   break costs an additional pause on top. A full-speed paste writes
                                   //   32 bytes at a time into a 16-byte UART FIFO, so the back half of
                                   //   a single write is lost however slow the average rate; at any
                                   //   paced speed the pump drops to 8-byte writes that stop at line
                                   //   terminators. 240 is an estimate pending real hardware, not a
                                   //   measurement. Validated at its consumer (paste-pump.js
                                   //   setPasteSpeed). CURRENT_VERSION NOT bumped.
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

// v1 → v2: the auto-send command line becomes a location + an auto-start switch.
//
// v1 stored the whole line Beastty auto-typed at the CCP ('B:SLIDE R\r'), with
// the empty string meaning "type nothing". v2 stores where SLIDE.COM lives and
// appends the direction letter itself, so the same setting serves sends AND
// pulls. Read the program invocation out of the old line and drop the rest.
//
// The name is NOT constrained to 'SLIDE' — rename the binary to BANANA.COM if
// you like; it still speaks the SLIDE protocol and still takes the standard
// R / S argument, which is all Beastty needs. What v2 will not express is a
// command line: the accepted shape is a program token plus at most a bare
// direction letter, because that letter is the only thing marking the token as
// a SLIDE invocation rather than an arbitrary command. 'A:SLIDE R' and
// 'A:BANANA.COM R' both read; 'A:SLIDE R QUIET' does not, and must NOT be
// reduced to the program 'A:SLIDE' — Beastty would then auto-type a command
// the user never asked for.
//
// A v1 line that fails that shape falls back to the defaults. Auto-start is
// left ON there: the user had auto-typing enabled, and silently disabling it
// would be a surprising way to lose a working send.
const LEGACY_PROGRAM_RE = /^([A-Pa-p]:)?([A-Za-z0-9]{1,8}(?:\.[A-Za-z0-9]{1,3})?)$/;
const LEGACY_DIRECTION_RE = /^[RSrs]$/;

function migrateV1ToV2(blob) {
    const out = { ...blob };
    const legacy = out.slideAutoSendCommand;
    delete out.slideAutoSendCommand;
    delete out.slideAutoSendCommandConfirmed;   // the first-use-confirm ceremony went with v1
    if (typeof legacy !== 'string') return out;                 // absent → defaults
    if (legacy.length === 0) { out.slideAutoStart = false; return out; }   // v1 disabled sentinel
    const parts = legacy.trim().split(/\s+/).filter((t) => t.length > 0);
    if (parts.length > 2) return out;
    if (parts.length === 2 && !LEGACY_DIRECTION_RE.test(parts[1])) return out;
    const m = LEGACY_PROGRAM_RE.exec(parts[0] || '');
    if (!m) return out;
    out.slideAutoStart = true;
    // No drive in the old line means it ran from whatever drive was current;
    // v2 always states one, and DEFAULTS supplies 'A:' when this is absent.
    if (m[1]) out.slideProgramDrive = m[1].toUpperCase();
    out.slideProgramName = m[2].toUpperCase();
    return out;
}

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
            // Field-by-field upgrade: keep stored fields, fill missing from
            // defaults, bump version. Per-version migration steps run first so
            // a renamed/restructured field is rewritten before the merge (an
            // unmigrated v1 blob would otherwise keep its dead fields AND take
            // the v2 defaults, losing the user's setting).
            if (parsed.version < 2) parsed = migrateV1ToV2(parsed);
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

// D-35 — the reset 2-click confirm labels. Single-sourced here (the reset SSOT)
// so the confirm machine that drives resetPrefs() — the Settings ▸ Reset all
// preferences menu row (menu-bar.js via confirm-toggle.js) — renders these exact
// prompts. (E7.1 retired the second surface, the legacy #reset-prefs-button.)
export const RESET_PREFS_IDLE_LABEL = 'Reset all preferences';
export const RESET_PREFS_CONFIRM_LABEL = 'Click again to confirm (3 s)';

// E4.1 review fix (#9) — the connection-STATUS label map, single-sourced here so the
// two connection projectors that must never disagree — menu-bar.js (#menu-conn-label)
// and status-bar.js (#port-status) — share ONE frozen copy instead of hand-synced
// duplicates guarded only by a comment. prefs.js is the one module both are allowed
// to import (AD-3), and it already hosts the RESET_PREFS_* single-sourced labels (same
// precedent). status-bar composes its own `connected` device/baud line, so it reads
// only the four non-connected entries; menu-bar uses all five (connected → 'Connected').
// U+2026 ellipsis in Connecting…/Reconnecting… — do not paraphrase.
export const CONN_STATUS_LABELS = Object.freeze({
    disconnected:  'Not connected',
    connecting:    'Connecting…',
    connected:     'Connected',
    reconnecting:  'Reconnecting…',
    'port-lost':   'Connection lost',
});

// The canonical MicroBeast (CP2102N) device string, single-sourced here (same
// AD-3 precedent as CONN_STATUS_LABELS above) so serial.js's getConnectionDevice()
// label and status-bar.js's harness fallback share ONE literal and can never drift
// on a PID/relabel change. serial.js owns the VID/PID predicate; this is only the
// display string those two surfaces render.
export const MICROBEAST_DEVICE_LABEL = 'MicroBeast (CP2102N 10c4:ea60)';

// The build-stamp shown when pkg/build-info.js is absent (a raw wasm-pack build that
// skipped build.sh). Single-sourced (same AD-3 precedent as above) so the three
// readers that render it — main.js's import-catch fallback object, projectAboutBuild
// (Help ▸ About), and status-bar.js's setBuild harness guard — can never word it
// differently. main.js feeds the bar the fallback OBJECT; About and setBuild default
// to this string only when their source is absent.
export const BUILD_UNKNOWN_SHA = 'unknown (unbuilt)';

// Pure framing formatter → the `19200 8N1` segment. Single-sourced so the live
// path (serial.js getActiveFraming, from the open port's lastConfig) and the
// prefs-derived fallback (status-bar.js, from getPrefs().serial) format identically.
// Callers map their own schema onto the named fields (serial uses `baudRate`, the
// prefs blob uses `baud`). parity → its uppercased initial ('none' → 'N').
export function formatFraming({ baud, dataBits, parity, stopBits }) {
    const p = String(parity || 'none')[0].toUpperCase();
    return `${baud} ${dataBits}${p}${stopBits}`;
}

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

// ── Where SLIDE.COM lives: validation + composition ──
//
// v2 replaced the free-form auto-send command line with a drive and a program
// name, so the grammar a user can express is now narrow by construction: a
// drive letter from a dropdown, and a CP/M 8.3 filename. That is what retired
// the v1 first-use-confirmation ceremony (SLIDE-38) — there is no longer an
// arbitrary command to confirm. The use-time hard gate it protected stays:
// slide.js validates HERE before any byte reaches the wire, because a
// hand-edited or corrupt localStorage blob can still carry anything.
//
// HTML-relevant characters (`<`, `>`, `&`, `"`, `'`), separators (`;`, `|`),
// whitespace and control bytes are all outside both character classes, so
// values that pass are wire-safe and XSS-safe by construction (T-12-03/T-12-05).
//
// CP/M stops at drive P. The extension is optional — 'SLIDE' and 'SLIDE.COM'
// are the same program to the CCP.
const PROGRAM_DRIVE_RE = /^[A-P]:$/;
const PROGRAM_NAME_RE = /^[A-Z0-9]{1,8}(\.[A-Z0-9]{1,3})?$/;

/** True iff `d` is a CP/M drive qualifier, 'A:'..'P:'. Pure. */
export function isValidProgramDrive(d) {
    return typeof d === 'string' && PROGRAM_DRIVE_RE.test(d);
}

/** True iff `n` is a CP/M 8.3 program name, extension optional. Pure. */
export function isValidProgramName(n) {
    return typeof n === 'string' && PROGRAM_NAME_RE.test(n);
}

/**
 * Compose the program invocation SLIDE is started with, e.g. 'A:SLIDE.COM'.
 * Pure. Returns null when either half fails its grammar — callers decide what
 * an unusable location means for them (slide.js types nothing; the pull pane
 * falls back to a bare 'SLIDE', which is no worse than pre-v2 behaviour).
 * Note this deliberately does NOT include the direction letter: the caller
 * appends ' R' to send or ' S' to pull.
 */
export function slideProgramPath(p) {
    if (!p) return null;
    const drive = p.slideProgramDrive;
    const name = p.slideProgramName;
    if (!isValidProgramDrive(drive) || !isValidProgramName(name)) return null;
    return drive + name;
}

export { DEFAULTS };
