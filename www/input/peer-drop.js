// Beastty Epic E11 Story S11.3 — drag a filename onto the other beast.
//
// The only part of E11 a user can see. Select a filename in one beast's
// terminal, drag it onto the other beast's terminal in a second tab, and the
// file is copied A → B in one gesture instead of a pull, a folder and a send.
//
// This module owns BOTH halves of that gesture, which is why it is one module:
//
//   the SOURCE half — one thunk (getPeerStamp) handed to selection.js's existing
//     dragstart, which stamps this tab's identity, a single-use nonce and the
//     parsed filenames onto the drag; and one provider (provideFiles) handed to
//     peer-link, which runs the ordinary pull and hands back the bytes.
//
//   the DESTINATION half — four drag handlers on #terminal-wrapper, the confirm
//     modal, this tab's own refusals, and the code → sentence mapping for the
//     other tab's.
//
// It also owns EVERY user-facing string in the feature (peer-link.js produces
// reason codes and no words at all — S11.2 was explicit about that), frozen in
// COPY at module top in the BUTTON_LABELS manner.
//
// Sited under www/input/ because that is where file-source.js lives: the module
// that owns drop handling AND a confirm modal, which is this module's shape
// exactly. Template: file-source.js's handler discipline, pull-pane.js's
// wrapperDropOurs ownership discipline.
//
// AD-3: imports NOTHING. peer-link, the pull pane, the chip, sendFiles, prefs,
// openModal and retainFocus all arrive through wirePeerDrop.
//
// ===== Two constraints that shape everything below =====
//
// 1. THE PAYLOAD CANNOT BE READ WHILE THE DRAG IS OVER US. Chromium's protected
//    drag data store makes dataTransfer.getData() return '' for every type
//    during dragenter/dragover/dragleave; only dataTransfer.types is readable,
//    and only at drop does getData work. So the hover-time decision is made from
//    two facts and no others: our custom type is present in `types`, and THIS
//    tab is not itself dragging (selection.js already broadcasts that through
//    onSelectionDragState — the same signal the pull pane consumes). The
//    session-id comparison is a second, independent check at DROP time, when
//    getData finally works. Neither alone is enough: the local flag would let a
//    third tab's payload through as "not ours", and the id comparison cannot
//    light or withhold the overlay.
//
//    A Playwright synthetic DragEvent has NO protected mode, so getData works at
//    every phase in a spec — meaning a spec written the other way would pass
//    while the real browser could not. The spec asserts against `types` only,
//    and a structural assertion pins that no handler reads getData before drop.
//
// 2. #drop-overlay-text IS A STATIC NODE NOTHING HAS EVER WRITTEN TO. S9.4
//    reused file-source's overlay for a different gesture and lived with the
//    wrong words; this is the first code to make that text conditional. Every
//    write is therefore paired with a restore on dragleave, drop AND dragend —
//    file-source's own setDropTarget(true) never touches the text, so without
//    the restore the next OS file drag would show our sentence instead of its
//    own. (file-source.spec.js:75 pins the resting string.)
//
// NOT here, on purpose: no persistent chrome of any kind (UX-DR5) — no pane, no
// peer list, no nicknames, no settings row, no menu item. The feature exists
// only during a drag and a transfer. No second confirmation ceremony: one modal,
// driven by the EXISTING Confirm file transfers preference (FR-4). No cross-tab
// progress (NFR-8) — both tabs are visible and each shows its own SLIDE chip.

// ===== The drag payload =====

// Lowercase and frozen: Chromium lowercases dataTransfer type strings, so a
// mixed-case constant would compare unequal against what `types` reports.
const PEER_DRAG_TYPE = 'application/x-beastty-peer-drag';

// Versioned for the same reason peer-link's envelope is: two tabs can be running
// two builds across a deploy, which is an ordinary daily-driver state for this
// app. An unrecognised version is treated as NOT OURS — no overlay, no drop, no
// error — rather than best-effort parsed.
const PAYLOAD_VERSION = 1;

// The mint timestamp rides in the payload as an OPTIONAL field, so the version
// deliberately does NOT bump: an old tab's payload (no `t`) still parses here,
// and a new tab's payload still parses in an old build, which ignores the extra
// field. Bumping would make the two builds refuse each other outright — a heavy
// price for one additive field whose absence costs nothing but a less specific
// sentence.
//
// What it is for: telling "this drag sat too long" apart from "that tab is
// really gone". Both arrive as peer-gone and they need different words.
//
// WORDING ONLY, never behaviour. peer-link prunes a nonce after its own
// NONCE_TTL_MS (120 s at time of writing); this module must not import that
// constant (AD-3) and must not reach into a test hook for it, so this is a
// heuristic used solely to choose between two sentences for an outcome that has
// ALREADY failed. If the two ever drift, the only consequence is which of two
// sentences a failed drag shows — never whether a good request is sent.
const STALE_DRAG_MS = 120_000;

// ===== Verbatim copy (UX-DR7 — do not paraphrase) =====
//
// Frozen at module top. Every string a user can see in this feature is here and
// nowhere else. {NAME} is a single CP/M filename, {n} a count, {X} a drive
// letter.
const COPY = Object.freeze({
    dropOverlay: '⤓ Drop to copy from the other beast',
    // The resting string the overlay is restored to. Owned by index.html and by
    // file-source's own gesture; repeated here ONLY as the restore target, and
    // pinned byte-for-byte by file-source.spec.js:75.
    dropOverlayResting: 'Drop file(s) to send via SLIDE',

    modalTitleOne: 'Copy from the other beast?',
    modalTitleMany: (n) => `Copy ${n} files from the other beast?`,
    rowFile: 'File',
    rowFrom: 'From',
    rowTo: 'To',
    fromValue: 'the other beast',
    // Just "this beast" — no drive letter. It used to read "{X}: — this beast",
    // where {X} was slideProgramDrive: where SLIDE.COM LIVES, which is not where
    // CP/M writes the received file. Ant's hardware checkpoint (2026-08-06)
    // caught exactly that — the row claimed A: while the receiving beast was on
    // B:. A row that states a fact the app does not have is worse than a row
    // that states less, so the drive is gone rather than qualified.
    toValue: 'this beast',
    btnCopy: 'Copy',
    btnCancel: 'Cancel',

    // This tab's own refusals — shown before anything is posted on the channel.
    destNotConnected: "This beast isn't connected. Connect it and try again.",
    destBusy: 'This beast is mid-transfer. Wait for it to finish and try again.',

    // The other tab's refusals, one per code in peerLink.REFUSAL_CODES.
    srcNotVisible: "The other beast's tab isn't visible. Put both tabs side by side in Split View and try again.",
    srcNotConnected: "The other beast isn't connected. Connect it in its tab and try again.",
    srcBusy: 'The other beast is mid-transfer. Wait for it to finish and try again.',
    srcNoFolder: 'The other beast has no pull folder yet. Choose one in its pull pane and try again.',
    srcGone: "The other beast's tab has gone. Reopen it and try again.",
    // A drag held past peer-link's nonce TTL produces a request the source drops
    // in silence, and the requester's deadline then resolves peer-gone — so
    // without this the user was told the other tab had GONE about a tab that is
    // plainly right there. Carried from S11.2's code review; sanctioned by Ant
    // 2026-08-06 (story Open Question 2). Names the cause, corrects the false
    // impression, and gives exactly one fix.
    dragExpired: "That drag took too long — the other beast's tab is still there. Drag it again.",

    // The two stage-naming failures (FR-13 / AC-10), singular and plural.
    // Plural sanctioned by Ant 2026-08-06 (story Open Question 3); before that
    // a multi-file failure borrowed the FIRST name, which reads as though only
    // one file was involved.
    pullFailed: (name) => `Couldn't fetch ${name} from the other beast. It's unchanged there — try the drag again.`,
    pullFailedMany: (n) => `Couldn't fetch ${n} files from the other beast. They're unchanged there — try the drag again.`,
    sendFailed: (name) => `Couldn't send ${name} to this beast. A copy is in the other beast's pull folder — drag it from there.`,
    sendFailedMany: (n) => `Couldn't send ${n} files to this beast. Copies are in the other beast's pull folder — drag them from there.`,
});

// The two stage failures pick their form from the COUNT, never from a flag, so
// a one-file batch can never render the plural and vice versa.
function pullFailedSentence(names) {
    const list = Array.isArray(names) ? names : [];
    return list.length === 1 ? COPY.pullFailed(list[0]) : COPY.pullFailedMany(list.length);
}

// The send half counts what was actually HANDED OVER, not what was asked for: a
// pull that came back short still sends what it got, and telling the user three
// files failed when two were handed over would be wrong.
function sendFailedSentence(names) {
    const list = Array.isArray(names) ? names : [];
    return list.length === 1 ? COPY.sendFailed(list[0]) : COPY.sendFailedMany(list.length);
}

// ===== Module-scope state =====

let wrapperElRef = null;
let overlayTextElRef = null;

// dragenter/dragleave fire per descendant crossing — depth-count them, the
// file-source.js:36 Pitfall-8 discipline.
let dragDepth = 0;
let overlayTextOverridden = false;

// THIS tab's own selection drag, fed by selection.js's onSelectionDragState
// through main.js. The hover-time half of FR-3's own-payload no-op: a tab must
// not light a drop target for the drag it is itself performing, and at hover
// time the payload cannot be read to find out (see constraint 1).
let selfDragging = false;

// Modal refs.
let modalElRef = null;
let titleElRef = null;
let fileValueElRef = null;
let fromValueElRef = null;
let toValueElRef = null;
let copyBtnRef = null;
let cancelBtnRef = null;

// Injected deps.
let peerLinkRef = null;        // { REFUSAL_CODES, getSessionId, mintNonce, requestFiles }
let composeSelectionRef = null;// pullPane.composeSelection
let pullForPeerRef = null;     // pullPane.pullForPeer
let sendFilesRef = null;       // file-source.sendFiles
let isConnectedRef = null;     // tx-sink isWriterReady
let isBusyRef = null;          // the COMPOSITE session predicate (never recv-only)
let getPrefsRef = null;        // live prefs read
let openModalRef = null;       // the shared AD-8 helper
let retainFocusRef = null;     // the shared AD-10 helper
let showNoticeRef = null;      // slideChip.enterNotice

// Diagnostics only — never an oracle for behaviour.
let lastNotice = '';
let requestCount = 0;

/**
 * wirePeerDrop(opts) — one call from main.js, everything injected (AD-1/AD-3).
 * Idempotent: a second call tears the first down rather than stacking handlers.
 */
export function wirePeerDrop(opts = {}) {
    dispose();

    wrapperElRef = opts.wrapperEl || null;
    overlayTextElRef = opts.overlayTextEl || null;
    modalElRef = opts.modalEl || null;
    titleElRef = opts.modalTitleEl || null;
    fileValueElRef = opts.modalFileEl || null;
    fromValueElRef = opts.modalFromEl || null;
    toValueElRef = opts.modalToEl || null;
    copyBtnRef = opts.modalCopyBtn || null;
    cancelBtnRef = opts.modalCancelBtn || null;

    peerLinkRef = opts.peerLink || null;
    composeSelectionRef = typeof opts.composeSelection === 'function' ? opts.composeSelection : null;
    pullForPeerRef = typeof opts.pullForPeer === 'function' ? opts.pullForPeer : null;
    sendFilesRef = typeof opts.sendFiles === 'function' ? opts.sendFiles : null;
    isConnectedRef = typeof opts.isConnected === 'function' ? opts.isConnected : null;
    isBusyRef = typeof opts.isBusy === 'function' ? opts.isBusy : null;
    getPrefsRef = typeof opts.getPrefs === 'function' ? opts.getPrefs : null;
    openModalRef = typeof opts.openModal === 'function' ? opts.openModal : null;
    retainFocusRef = typeof opts.retainFocus === 'function' ? opts.retainFocus : null;
    showNoticeRef = typeof opts.showNotice === 'function' ? opts.showNotice : null;

    if (wrapperElRef) {
        wrapperElRef.addEventListener('dragenter', onDragEnter);
        wrapperElRef.addEventListener('dragover', onDragOver);
        wrapperElRef.addEventListener('dragleave', onDragLeave);
        wrapperElRef.addEventListener('drop', onDrop);
        // A drag cancelled with Esc while over the wrapper can skip dragleave
        // entirely (the pull pane's onRowDragEnd rule) — and this tab's OWN
        // dragend fires here too, which is where the overlay-text restore has to
        // happen or file-source's next OS drag inherits our sentence.
        wrapperElRef.addEventListener('dragend', onDragEnd);
    }

    // AD-10 — both modal buttons through the shared helper, NOT the hand-rolled
    // mousedown→preventDefault #send-modal still carries (file-source.js:161,
    // which predates AD-10 and must not be copied).
    if (copyBtnRef) {
        if (retainFocusRef) retainFocusRef(copyBtnRef, wrapperElRef);
        copyBtnRef.addEventListener('click', onCopyClick);
    }
    if (cancelBtnRef) {
        if (retainFocusRef) retainFocusRef(cancelBtnRef, wrapperElRef);
        cancelBtnRef.addEventListener('click', onCancelClick);
    }
    // Backdrop dismissal — a click on the dialog element itself (not a child)
    // landed on the backdrop region. file-source.js:179-185 verbatim.
    if (modalElRef) modalElRef.addEventListener('click', onModalBackdropClick);

    return {
        getPeerStamp,      // → selection.js's dragstart (T1)
        provideFiles,      // → peer-link's wirePeerLink({ provideFiles }) (T5, source half)
        onSelectionDrag,   // ← selection.js's onSelectionDragState (T3)
        PEER_DRAG_TYPE,
        COPY,
        dispose,
        __getStateForTests,
        __resetForTests,
    };
}

// ===== The source half: stamping the drag (FR-2, AC-1) =====

/**
 * getPeerStamp(text) → { type, payload } | null
 *
 * Called from selection.js's dragstart with the selection text it is already
 * carrying in text/plain. Returns null — stamp NOTHING — when the selection
 * parses to zero valid CP/M names, so no foreign tab ever lights a drop target
 * for a drag that could not be honoured (AC-1).
 *
 * The nonce is minted HERE, once per drag, by the tab that owns the files. It
 * comes back in the peer's request and is the only way this tab can tell a
 * request it authorised from one it did not.
 *
 * Known limit, carried from S11.2's code review and NOT papered over: peer-link
 * prunes nonces after NONCE_TTL_MS (120 s). A drag held longer than that
 * produces a request whose nonce has been pruned; the responder drops it in
 * silence and the requester's deadline resolves peer-gone, so the user is told
 * "The other beast's tab has gone" about a tab that is plainly right there. The
 * epic's frozen copy has no sentence for that case and UX-DR7 forbids inventing
 * one, so it stays a recorded limit rather than a paraphrase.
 */
export function getPeerStamp(text) {
    if (!peerLinkRef || !composeSelectionRef) return null;
    let names = [];
    try {
        const rv = composeSelectionRef(String(text ?? ''));
        names = (rv && Array.isArray(rv.tokens) ? rv.tokens : [])
            .filter((t) => t && t.ok)
            .map((t) => t.name);
    } catch {
        return null;
    }
    if (names.length === 0) return null;   // nothing to offer — stamp no type at all

    let sessionId = null;
    let nonce = null;
    try {
        sessionId = peerLinkRef.getSessionId();
        nonce = peerLinkRef.mintNonce();
    } catch {
        return null;
    }
    if (typeof sessionId !== 'string' || !sessionId || typeof nonce !== 'string' || !nonce) return null;

    return {
        type: PEER_DRAG_TYPE,
        // `t` is the mint moment. Both tabs are the same browser on the same
        // machine, so the two clocks are the same clock — no skew to allow for.
        payload: JSON.stringify({ v: PAYLOAD_VERSION, sessionId, nonce, names, t: Date.now() }),
    };
}

/**
 * parsePayload(raw) → { sessionId, nonce, names } | null   (pure; exported for specs)
 *
 * Defensive by construction: this runs inside a DOM event handler, where a throw
 * is a console trace and nothing else. A malformed payload is INERT, not an
 * exception. An unrecognised version is not-ours for the deploy-skew reason
 * above.
 */
export function parsePayload(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    let data;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object') return null;
    if (data.v !== PAYLOAD_VERSION) return null;
    if (typeof data.sessionId !== 'string' || data.sessionId.length === 0) return null;
    if (typeof data.nonce !== 'string' || data.nonce.length === 0) return null;
    if (!Array.isArray(data.names) || data.names.length === 0) return null;
    for (const n of data.names) {
        if (typeof n !== 'string' || n.length === 0) return null;
    }
    const out = { sessionId: data.sessionId, nonce: data.nonce, names: data.names.slice() };
    // OPTIONAL, and its absence is not a malformed payload — a tab running the
    // build before this field existed is a peer we still honour (see the
    // PAYLOAD_VERSION note). A present-but-nonsense value is simply ignored.
    if (typeof data.t === 'number' && Number.isFinite(data.t)) out.mintedAt = data.t;
    return out;
}

// ===== The source half: fulfilling a request (AC-6) =====

/**
 * provideFiles({ names }) — peer-link's provider, the S11.2 wiring deliberately
 * left unwired (main.js:1155-1158 says so in a comment).
 *
 * Its contract is narrow on purpose: resolve with well-formed { name, blob }
 * records, or throw. peer-link turns anything else into ONE outcome —
 * pull-failed — because the provider never reports its own reason; this module
 * owns the single sentence for it. So there is nothing to catch here.
 */
async function provideFiles(req) {
    if (!pullForPeerRef) throw new Error('peer-drop: no pull provider wired');
    const names = Array.isArray(req && req.names) ? req.names : [];
    if (names.length === 0) throw new Error('peer-drop: request named no files');
    return pullForPeerRef(names);
}

// ===== The destination half: the ownership predicate (AC-3) =====

// selection.js → main.js → here. The pull pane consumes the identical signal
// (main.js:817); this is a second subscriber, not a second mechanism.
export function onSelectionDrag(s) {
    selfDragging = !!(s && s.active);
}

function typeList(ev) {
    const t = ev && ev.dataTransfer && ev.dataTransfer.types;
    return t && typeof t.includes === 'function' ? t : null;
}

/**
 * Is this wrapper drag ours?
 *
 * `#terminal-wrapper` has THREE independent owners of these events now, and they
 * stay disjoint only because each refuses by returning WITHOUT preventDefault —
 * which is what leaves the event to the others (the wrapperDropOurs discipline,
 * pull-pane.js:1062-1073). Asserted by spec against both other owners rather
 * than assumed:
 *
 *   - file-source.js claims a drag iff types includes 'Files'. Our payload never
 *     carries 'Files', and we refuse any drag that does.
 *   - the pull pane claims one iff its reverse-drag stash is armed, which needs
 *     a pointerdown on a pane row — a gesture that cannot be in flight at the
 *     same time as a terminal-selection drag in the same tab.
 *   - ours needs the custom type, which only a terminal-selection drag stamps.
 *
 * `types` ONLY — never getData. See constraint 1 at the top of this file.
 */
export function dragIsOurs(ev) {
    const types = typeList(ev);
    if (!types) return false;
    if (!types.includes(PEER_DRAG_TYPE)) return false;
    if (types.includes('Files')) return false;   // an OS file drag belongs to file-source
    if (selfDragging) return false;              // our own drag, over our own terminal (FR-3)
    return true;
}

// ===== The destination half: overlay + handlers (AC-2, AC-3) =====

function setOverlayText(on) {
    if (!overlayTextElRef) return;
    if (on) {
        overlayTextElRef.textContent = COPY.dropOverlay;
        overlayTextOverridden = true;
    } else if (overlayTextOverridden) {
        // Restore ONLY what we changed. file-source's setDropTarget never
        // touches this node, so an unconditional write here would fight nothing
        // — but it would also make this module the owner of a string it does not
        // own. Restore what we borrowed and stop.
        overlayTextElRef.textContent = COPY.dropOverlayResting;
        overlayTextOverridden = false;
    }
}

function setDropTarget(active) {
    if (!wrapperElRef) return;
    if (active) {
        // The SAME attribute file-source sets, on the same element, driving the
        // same #drop-overlay CSS. No new visual language (UX-DR1).
        wrapperElRef.setAttribute('data-drop-target', 'true');
        setOverlayText(true);
    } else {
        wrapperElRef.removeAttribute('data-drop-target');
        setOverlayText(false);
    }
}

function clearAffordance() {
    if (dragDepth === 0 && !overlayTextOverridden) return;
    dragDepth = 0;
    setDropTarget(false);
}

function onDragEnter(ev) {
    if (!dragIsOurs(ev)) return;   // NOT ours — no preventDefault, event left to the others
    ev.preventDefault();
    dragDepth += 1;
    if (dragDepth === 1) setDropTarget(true);
}

function onDragOver(ev) {
    if (!dragIsOurs(ev)) return;
    ev.preventDefault();           // required for drop to fire
    ev.dataTransfer.dropEffect = 'copy';
}

function onDragLeave() {
    // Keyed off our own entered-state rather than dragIsOurs(): if acceptability
    // flips off mid-drag the leave must still clear the affordance
    // (pull-pane.js:1098-1104's rule).
    if (dragDepth === 0) return;
    dragDepth -= 1;
    if (dragDepth === 0) setDropTarget(false);
}

// This tab's own dragend, and the Esc-cancelled drag that skips dragleave. The
// overlay text restore MUST happen here or the next OS file drag shows our
// sentence (constraint 2).
function onDragEnd() {
    clearAffordance();
}

function onDrop(ev) {
    // Clear the affordance even when the checks below refuse — the overlay must
    // never outlive the drag (onWrapperDrop's rule, pull-pane.js:1106-1109).
    const wasOurs = dragIsOurs(ev);
    clearAffordance();
    if (!wasOurs) return;          // not ours: no preventDefault, nothing happens
    ev.preventDefault();

    // Only NOW does getData work. Read it, and treat everything after this as
    // untrusted input.
    let raw = '';
    try { raw = ev.dataTransfer.getData(PEER_DRAG_TYPE); } catch { raw = ''; }
    const payload = parsePayload(raw);
    if (!payload) return;          // malformed — inert, per constraint 1's note

    // The drop-time belt on FR-3: a tab's own payload on its own terminal is
    // inert. The hover-time check was this tab's local drag state; this is the
    // independent one, and it also catches a payload that arrived by some route
    // the local flag never saw.
    let selfId = null;
    try { selfId = peerLinkRef && peerLinkRef.getSessionId(); } catch { selfId = null; }
    if (selfId && payload.sessionId === selfId) return;

    // Async from here; a rejection must never escape a drop handler.
    handleDrop(payload).catch((err) => {
        console.error('[peer-drop] drop handling failed:', err);
    });
}

function onModalBackdropClick(e) {
    if (e.target === modalElRef) modalElRef.close('cancel');
}

function onCopyClick() {
    if (modalElRef) modalElRef.close('copy');
}

function onCancelClick() {
    if (modalElRef) modalElRef.close('cancel');
}

// ===== The destination half: checks, confirm, orchestration (AC-4/5/6/8/10) =====

function notice(sentence) {
    lastNotice = sentence;
    if (showNoticeRef) {
        try { showNoticeRef(sentence); } catch { /* the surface must never break the drop */ }
    }
}

// Read at use, never cached (peer-link's own rule): a status copy that could
// disagree with the tab it describes is the bug.
function destBusyNow() {
    if (typeof isBusyRef !== 'function') return true;   // fail CLOSED, readFlag's rule
    try { return !!isBusyRef(); } catch { return true; }
}

function destConnectedNow() {
    if (typeof isConnectedRef !== 'function') return false;
    try { return !!isConnectedRef(); } catch { return false; }
}

/**
 * The code → sentence mapping (AC-8).
 *
 * Codes come from peerLink.REFUSAL_CODES — the object wirePeerLink RETURNS, not
 * a re-hardcoded copy and not something attached to window.__peerLink from
 * outside. S11.2's code review fixed exactly that defect: the vocabulary was
 * bolted onto the window from main.js, so every spec re-wire replaced the object
 * wholesale and dropped it silently.
 *
 * An unmapped or unrecognised code still produces a SENTENCE — never a blank, a
 * silence, or an [object Object]. pull-failed is the honest fallback: something
 * went wrong fetching from the other beast, which is exactly what an
 * unrecognised answer means.
 */
export function sentenceForRefusal(code, names, opts = {}) {
    const codes = (peerLinkRef && peerLinkRef.REFUSAL_CODES) || {};
    // A missing code must not be matched by a missing vocabulary. With
    // peerLinkRef torn down mid-flight every `codes.X` below is undefined, so an
    // undefined code would hit the FIRST case and claim "The other beast isn't
    // connected" about a tab nobody asked. Nothing to say but the fallback.
    if (typeof code !== 'string' || code.length === 0) return pullFailedSentence(names);
    switch (code) {
        case codes.NOT_CONNECTED: return COPY.srcNotConnected;
        case codes.BUSY:          return COPY.srcBusy;
        case codes.NO_FOLDER:     return COPY.srcNoFolder;
        case codes.NOT_VISIBLE:   return COPY.srcNotVisible;
        // peer-gone covers two situations the user experiences completely
        // differently: the other tab really is gone, or this drag sat in the
        // hand so long that the nonce authorising it was pruned. Age is the only
        // thing that tells them apart, and it is a heuristic over an outcome
        // that has already failed — see STALE_DRAG_MS.
        case codes.PEER_GONE:
            return (typeof opts.dragAgeMs === 'number' && opts.dragAgeMs >= STALE_DRAG_MS)
                ? COPY.dragExpired
                : COPY.srcGone;
        case codes.PULL_FAILED:   return pullFailedSentence(names);
        default:                  return pullFailedSentence(names);
    }
}

function confirmEnabledNow() {
    // Live at drop time through getPrefs (the file-source.js:451-452 shape), so
    // a Settings change applies without a reload. Absent or throwing → CONFIRM:
    // a mis-wired composition root must not start transferring without asking.
    if (typeof getPrefsRef !== 'function') return true;
    try { return getPrefsRef()?.slideConfirmTransfers !== false; } catch { return true; }
}

async function handleDrop(payload) {
    const names = payload.names;
    // How long the drag was held. Undefined when the payload came from a build
    // that predates the field — the mapping then falls back to the generic
    // peer-gone sentence, which is what it always said.
    const dragAgeMs = typeof payload.mintedAt === 'number' ? Date.now() - payload.mintedAt : undefined;

    // AC-4 — THIS beast's own checks, before anything is posted on the channel.
    // No request goes out, so no nonce is consumed on the other tab and nothing
    // is spent. Order matters: not-connected is the more fundamental fault, so
    // it is named first (chooseRefusal's ordering rule, applied locally).
    if (!destConnectedNow()) { notice(COPY.destNotConnected); return; }
    // The COMPOSITE predicate, never slide-recv's recv-only isSlideActive(). A
    // recv-only predicate leaking into a send path has happened three times in
    // this codebase; main.js keeps the composite in one place and injects it.
    if (destBusyNow()) { notice(COPY.destBusy); return; }

    // AC-5 — one modal, the EXISTING preference, no second ceremony.
    if (confirmEnabledNow()) {
        const ok = await showCopyModal(names);
        if (!ok) return;   // Cancel, Esc and backdrop all leave the app as it was
        // Re-check both facts after the modal, for the reason the pull pane
        // re-checks its own at confirm (pull-pane.js:1445-1451): the dialog can
        // sit open for as long as the user likes, and the tab can lose its port
        // or start a local transfer in that time. Without this the source runs a
        // full SLIDE pull and the bytes come back to a tab that cannot take
        // them. Same two sentences — nothing new to say.
        if (!destConnectedNow()) { notice(COPY.destNotConnected); return; }
        if (destBusyNow()) { notice(COPY.destBusy); return; }
    }

    // Only now does anything reach the other tab.
    requestCount += 1;
    let outcome;
    try {
        outcome = await peerLinkRef.requestFiles({
            peerSessionId: payload.sessionId,
            nonce: payload.nonce,
            names,
        });
    } catch {
        // requestFiles is documented never to reject; belt anyway — a drop
        // handler has exactly one way to report a failure.
        notice(pullFailedSentence(names));
        return;
    }

    if (!outcome || !outcome.ok) {
        notice(sentenceForRefusal(outcome && outcome.reason, names, { dragAgeMs }));
        return;
    }

    // AC-6 — the send half. new File([blob], name) ONCE, at the boundary:
    // file-source's processFiles duck-types its argument (reads .name, awaits
    // .arrayBuffer()) and never does an instanceof check, so a bare Blob does
    // not throw — it makes validateCpmFilename(undefined) fail and drops every
    // file into the REJECTED rows, offering the user "Send 0 files".
    // The names that actually came back — NOT the names that were asked for. A
    // pull that ended short hands over fewer, and the send-failed sentence must
    // count what was really in flight.
    const handedOver = outcome.files.map((r) => r.name);
    let files;
    try {
        files = outcome.files.map((r) => new File([r.blob], r.name));
    } catch {
        notice(sendFailedSentence(handedOver));
        return;
    }

    // ONE call for the whole batch. The N/M batch hint needs nothing more:
    // total_files comes from the array length passed to enterSendMode
    // (slide.js:504), so a loop would be both wrong and slower.
    //
    // A resolved sendFiles does NOT mean the bytes reached the Z80 —
    // enterSendMode returns before the wire finishes. B's own SLIDE chip is what
    // tells the user the send is running, and nothing here claims more.
    try {
        await sendFilesRef(files);
    } catch (err) {
        console.error('[peer-drop] sendFiles failed:', err);
        // AC-10 — a SEND-side failure points at the copy now sitting in the
        // other beast's pull folder, so the recovery is the shipped local-file
        // drag with no beast-to-beast path involved.
        notice(sendFailedSentence(handedOver));
    }
}

/**
 * The confirm modal (AC-5, AC-9, UX-DR2).
 *
 * A static <dialog class="chrome-modal"> in index.html, opened through the
 * shared openModal helper (AD-8) — never hand-rolled. The rows follow the
 * .chrome-modal .field family, whose template is #slide-confirm-transfers-row.
 * NOT #send-modal: that predates the aligned-row restyle, does not carry
 * class="chrome-modal", and is still a bespoke <ul><li> list.
 */
function showCopyModal(names) {
    if (!modalElRef || !openModalRef) return Promise.resolve(false);
    const n = names.length;
    if (titleElRef) titleElRef.textContent = n === 1 ? COPY.modalTitleOne : COPY.modalTitleMany(n);
    // Several names in one aligned row: a comma-joined single value. The row
    // family has no multi-value shape today and inventing one to hold a list is
    // more new surface than the case earns.
    if (fileValueElRef) fileValueElRef.textContent = names.join(', ');
    if (fromValueElRef) fromValueElRef.textContent = COPY.fromValue;
    if (toValueElRef) toValueElRef.textContent = COPY.toValue;
    if (copyBtnRef) copyBtnRef.textContent = COPY.btnCopy;
    if (cancelBtnRef) cancelBtnRef.textContent = COPY.btnCancel;

    // openModal resolves to the RAW returnValue and '' on Esc or backdrop
    // dismiss, which is the Cancel path. restoreTo is the terminal wrapper so
    // keystrokes flow back to the Z80 (NFR-1).
    return openModalRef(modalElRef, {
        initialFocus: copyBtnRef || cancelBtnRef,
        restoreTo: () => wrapperElRef,
    }).then((rv) => rv === 'copy');
}

// ===== Lifetime =====

export function dispose() {
    if (wrapperElRef) {
        clearAffordance();
        wrapperElRef.removeEventListener('dragenter', onDragEnter);
        wrapperElRef.removeEventListener('dragover', onDragOver);
        wrapperElRef.removeEventListener('dragleave', onDragLeave);
        wrapperElRef.removeEventListener('drop', onDrop);
        wrapperElRef.removeEventListener('dragend', onDragEnd);
    }
    if (copyBtnRef) copyBtnRef.removeEventListener('click', onCopyClick);
    if (cancelBtnRef) cancelBtnRef.removeEventListener('click', onCancelClick);
    if (modalElRef) {
        modalElRef.removeEventListener('click', onModalBackdropClick);
        if (modalElRef.open) modalElRef.close('cancel');
    }
    dragDepth = 0;
    overlayTextOverridden = false;
    selfDragging = false;
    wrapperElRef = null;
    overlayTextElRef = null;
    modalElRef = null;
    titleElRef = null;
    fileValueElRef = null;
    fromValueElRef = null;
    toValueElRef = null;
    copyBtnRef = null;
    cancelBtnRef = null;
    peerLinkRef = null;
    composeSelectionRef = null;
    pullForPeerRef = null;
    sendFilesRef = null;
    isConnectedRef = null;
    isBusyRef = null;
    getPrefsRef = null;
    openModalRef = null;
    retainFocusRef = null;
    showNoticeRef = null;
}

// ===== Test surface =====

export function __resetForTests() {
    dragDepth = 0;
    selfDragging = false;
    if (wrapperElRef) wrapperElRef.removeAttribute('data-drop-target');
    setOverlayText(false);
    if (modalElRef && modalElRef.open) modalElRef.close('cancel');
    lastNotice = '';
    requestCount = 0;
}

// A fresh plain object of primitives — no live refs, no functions, so it
// survives the Playwright bridge (the focus.js:26-33 rule).
export function __getStateForTests() {
    return {
        wired: wrapperElRef !== null,
        dragType: PEER_DRAG_TYPE,
        payloadVersion: PAYLOAD_VERSION,
        dragDepth,
        selfDragging,
        dropTargetActive: wrapperElRef ? wrapperElRef.hasAttribute('data-drop-target') : false,
        overlayText: overlayTextElRef ? overlayTextElRef.textContent : null,
        overlayTextOverridden,
        modalOpen: modalElRef ? !!modalElRef.open : false,
        // AC-11 — with one tab open this stays 0 from boot onwards: nothing
        // listens, nothing is asked, no timer runs.
        requestCount,
        lastNotice,
        hasProvider: pullForPeerRef !== null,
    };
}
