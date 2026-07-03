// Beastty Phase 6 Plan 05 (Wave 4) — RX-only session log accumulator + Blob download.
//
// Public API: wireSessionLog, reset, append, download, getCurrentBytes.
//
// Per-connection lifecycle (D-29): a fresh chunks array is allocated on every
// successful port.open(). The buffer is RX-only (D-28) — TX bytes (typing,
// paste) never enter this module. Chunks are pushed by reference (D-30); no
// copy until download() assembles the Blob. Filename uses the connect-time
// UTC stamp (D-31) so each download maps unambiguously to the session that
// produced it.
//
// Sources:
//   - 06-CONTEXT.md D-27..D-31.
//   - 06-RESEARCH.md §Pattern 4 + §Code Examples lines 1337-1353 (Blob download trigger).
//   - 06-PATTERNS.md §"www/transport/session-log.js" (verbatim reset/append/download bodies).
//   - 06-UI-SPEC.md §Connection-pane Download log button (verbatim copy strings).

// Module-scope state.
let chunks = [];
let totalBytes = 0;
let downloadBtnRef = null;
// Epic E3 Story E3.1 (AC-7) — subscriber fired from setButtonState whenever the
// download-enabled state is (re)applied, so the File ▸ Download Session Log menu
// row can re-project. Set via wireSessionLog({ onStateChange }). The subscriber
// (menu-bar's projectSessionLog) reads the live byte count itself and is
// idempotent + no-throw, so setButtonState fires unconditionally — no
// transition-dedup state is needed. session-log stays the SOLE writer of its own
// button; the callback lets menu-bar stay the sole writer of its own row.
let onStateChangeRef = null;

// Verbatim tooltip strings — UI-SPEC §Connection-pane Download log button.
// Quoted ONCE here as the authoritative source; do NOT duplicate in comments
// (Phase 5 grep-hygiene rule from Plan 05-08).
const TOOLTIP_DISABLED = 'No bytes received yet';
const TOOLTIP_ENABLED = 'Download all bytes received this connection (.bin)';

// Epic E3 Story E3.1 (AC-4/AC-5) — the SAME two strings surfaced for injection so
// the File-menu row can show them WITHOUT re-hardcoding (AC-4 "do NOT re-hardcode
// elsewhere") and WITHOUT menu-bar importing session-log (AD-3). main.js passes
// this into wireMenuBar; session-log.js remains the single source of truth.
export const SESSION_LOG_TOOLTIPS = Object.freeze({
    enabled: TOOLTIP_ENABLED,
    disabled: TOOLTIP_DISABLED,
});

// wireSessionLog({ downloadButton }) — registers the click handler + sets the
// initial disabled state. Idempotent: calling reset() afterwards returns to
// the disabled state without dropping the listener.
export function wireSessionLog(opts) {
    downloadBtnRef = opts.downloadButton;
    // E3.1 (AC-7) — optional notify hook. A harness that omits it leaves the
    // menu-row projection inert (the button still updates via setButtonState).
    onStateChangeRef = opts.onStateChange || null;
    if (downloadBtnRef) {
        downloadBtnRef.addEventListener('click', download);
        // Phase 4 D-16 sacred — mousedown preventDefault retains #terminal-wrapper focus.
        downloadBtnRef.addEventListener('mousedown', (e) => e.preventDefault());
    }
    setButtonState(false);
}

// D-29 — reset on each Connect. Filename is generated at download-click time
// (UTC) so repeat downloads in the same session produce distinct filenames.
export function reset() {
    chunks = [];
    totalBytes = 0;
    setButtonState(false);
}

// D-30 — append by reference; no copy. Empty chunks are dropped (defensive
// against zero-length reads from the mock or real Web Serial).
export function append(uint8) {
    if (!uint8 || uint8.byteLength === 0) return;
    const wasEmpty = totalBytes === 0;
    chunks.push(uint8);
    totalBytes += uint8.byteLength;
    if (wasEmpty) setButtonState(true);
}

// D-31 — synthetic anchor click. The chunks array is NOT cleared — mid-session
// download leaves the accumulator running so subsequent appends continue.
export function download() {
    if (totalBytes === 0) return;
    // Blob constructor accepts Uint8Array[]; the Blob does an internal copy at
    // construction time. This is the single allocation the log incurs.
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Filename uses the download-click time (UTC) so repeat downloads in the
    // same session produce distinct filenames. Earlier behaviour pinned the
    // stamp to connect-start, which made every mid-session download share the
    // same name and overwrote prior captures on re-download.
    a.download = filenameForNow();
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revocation a few seconds — some browsers stall the download if
    // revoked too soon (RESEARCH §Pattern 4 commentary). Chromium handles
    // correctly, but the delay is hygiene defense across browsers. The
    // numeric literal below is the single authoritative source; do NOT
    // duplicate it in a comment (Phase 5 Plan 08 grep-hygiene rule).
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function getCurrentBytes() {
    return totalBytes;
}

// beastty-{YYYYMMDD-HHMMSS}.bin (UTC stamp at download-click time).
// Strict alphanumeric + dashes — no user input on this path (T-06-05-04
// path-traversal mitigation).
function filenameForNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
        `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    return `beastty-${stamp}.bin`;
}

function setButtonState(enabled) {
    // Sole writer of THIS button (E3.1 AC-6). Guard keeps a button-less harness
    // working; the onStateChange notify below still fires so a menu-only surface
    // learns the transition.
    if (downloadBtnRef) {
        if (enabled) {
            downloadBtnRef.removeAttribute('disabled');
            downloadBtnRef.setAttribute('title', TOOLTIP_ENABLED);
        } else {
            downloadBtnRef.setAttribute('disabled', '');
            downloadBtnRef.setAttribute('title', TOOLTIP_DISABLED);
        }
    }
    // E3.1 (AC-7) — notify the menu-row projector whenever the enabled state is
    // (re)applied: first-byte enable (append's wasEmpty), reset()'s disable, and
    // the wire-time init. The subscriber reads the live byte count and is
    // idempotent, so a redundant disabled→disabled notify is a harmless no-op.
    // No-throw so a failing subscriber can never break the log accumulator.
    if (onStateChangeRef) {
        try { onStateChangeRef(enabled); } catch { /* subscriber must not break the log */ }
    }
}
