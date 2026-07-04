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
// Settings ▸ Strip ctrl codes from logs — injected getter returning the live
// pref boolean (main.js: () => getPrefs().stripCtrlLogs). Read at download-click
// time so toggling the setting mid-session affects the very next download.
// Injected (not imported) so session-log stays dependency-free. Null harness =
// never strip.
let getStripCtrlRef = null;

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
    getStripCtrlRef = opts.getStripCtrl || null;
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
    // Settings ▸ Strip ctrl codes from logs (read live at click time). When ON,
    // assemble a cleaned, readable transcript; otherwise the raw RX byte stream.
    const strip = getStripCtrlRef ? !!getStripCtrlRef() : false;
    // Blob constructor accepts Uint8Array[]; the Blob does an internal copy at
    // construction time. This is the single allocation the raw path incurs (the
    // strip path pre-assembles one cleaned buffer, see stripControlCodes).
    const parts = strip ? [stripControlCodes(chunks, totalBytes)] : chunks;
    const blob = new Blob(parts, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Filename uses the download-click time (UTC) so repeat downloads in the
    // same session produce distinct filenames. Earlier behaviour pinned the
    // stamp to connect-start, which made every mid-session download share the
    // same name and overwrote prior captures on re-download.
    a.download = filenameForNow(strip);
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

// beastty-{YYYYMMDD-HHMMSS}.{bin|txt} (UTC stamp at download-click time).
// Stripped logs are a readable text transcript → .txt; raw logs are the binary
// RX stream → .bin. Strict alphanumeric + dashes — no user input on this path
// (T-06-05-04 path-traversal mitigation).
function filenameForNow(stripped) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
        `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    return `beastty-${stamp}.${stripped ? 'txt' : 'bin'}`;
}

// Strip ctrl codes for a readable transcript (Settings ▸ Strip ctrl codes from
// logs). Flattens the by-reference chunk list into one buffer (a VT52 escape
// sequence can span a chunk boundary), then drops:
//   - whole VT52 escape sequences: ESC (0x1B) + its command byte, plus 2 more
//     bytes for ESC Y <row> <col> (the only parameterised sequence — vt52.rs);
//   - all other C0 control bytes (< 0x20) and DEL (0x7F).
// Line breaks CR (0x0D) and LF (0x0A) are KEPT so the log stays line-structured.
// A trailing/torn ESC at end-of-buffer simply drops itself. Bytes >= 0x80 pass
// through untouched (not C0 controls; may be legitimate high-bit data).
function stripControlCodes(chunks, byteCount) {
    const src = new Uint8Array(byteCount);
    let o = 0;
    for (const c of chunks) { src.set(c, o); o += c.byteLength; }
    const out = new Uint8Array(byteCount);   // result can only be <= source
    let w = 0;
    for (let i = 0; i < src.length; i++) {
        const b = src[i];
        if (b === 0x1B) {
            // Consume the command byte; ESC Y additionally eats the next 2 bytes.
            const cmd = src[i + 1];
            i += 1;
            if (cmd === 0x59) i += 2;   // 0x59 = 'Y'
            continue;
        }
        if (b === 0x0A || b === 0x0D) { out[w++] = b; continue; }
        if (b < 0x20 || b === 0x7F) continue;
        out[w++] = b;
    }
    return out.subarray(0, w);
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
