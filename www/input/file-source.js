// Beastty Phase 9 — File-source: picker + drag-drop + CP/M validation + confirm modal.
//
// Public API: wireFileSource, validateCpmFilename, truncateCpm83, packSendMetadata,
//             computeRenameScheme (Phase 12 SLIDE-36).
//
// Sources:
//   - 09-CONTEXT.md D-01..D-09 + D-18 (locked decisions).
//   - 09-RESEARCH.md Pattern 2 (validation), Pattern 3 (modal), Pattern 4 (drag-drop).
//   - 09-UI-SPEC.md §Copywriting (verbatim modal + button copy) + §Interaction & State Contracts.
//   - 12-CONTEXT.md D-01..D-06 (LOCKED) — SLIDE-36 send-side collision detection
//     extends the Phase 9 modal with a fourth row kind ('collision') + three-action
//     button row + post-drop selection-clear via injected clearSelectionFn opt
//     (SLIDE-12 SC#1 companion to Plan 12-01's selection.js early-return).
//   - Analog: www/input/paste-pump.js (module-scope state + wireXxx({...}) shape).
//   - Analog: www/renderer/scroll-state.js ([data-attribute] toggle on #terminal-wrapper).
//
// Architectural rule: JS shell ONLY. No Rust calls; the SLIDE state machine
// is reached via transport/slide.js's `enterSendMode({ files })` export
// (injected via wireFileSource opts — dependency injection per paste-pump.js
// precedent).

// v1.1 polish (260513-grs Task 2) — getPrefs is read live inside processFiles
// so the slideConfirmTransfers toggle takes effect on the very next picker /
// drop without re-wiring or boot.
import { getPrefs } from '../state/prefs.js';
// Epic E0 Story E0.2 (AD-8) — the one shared open/close/focus primitive.
// file-source.js is the proof caller: #send-modal is the only <dialog> today,
// so this leaf import (mirroring chrome.js importing retainFocus from
// ./focus.js) is what pins the openModal contract for the future config modals.
import { openModal } from '../renderer/modal.js';

// ===== CP/M validation constants (D-06) =====
const CPM_INVALID_CHARS = new Set(['<','>',',',';',':','=','?','*','[',']']);

// ===== Module-scope state =====
let dragDepth = 0;          // dragenter/dragleave fire for child elements; track depth (Pitfall 8)
let modalElRef = null;
let titleElRef = null;
let listElRef = null;
let hintElRef = null;
let cancelBtnRef = null;
let sendBtnRef = null;

let wrapperElRef = null;
// Epic E7 Story E7.1 (AD-7) — #send-file-button + #send-file-input retired with
// #top-bar. file-source.js now OWNS the picker: a programmatic (never-rendered)
// <input type="file"> created at wire time, triggered only via File ▸ Send File…
// (openSendPicker). The send GATE is held as module state here (no button DOM to
// hang .disabled/.title on); menu-bar's Send File… row reads it via getSendGate().
let sendInputEl = null;
let sendGateDisabled = true;                            // closed until a writer is registered
let sendGateTitle = 'Connect to a serial port first';  // mirrored onto the menu row's tooltip
let enterSendModeFn = null;
let getSlideStateFn = null;
// E11 retrospective (2026-08-06) — the one shared answer to "is a transfer
// running?", injected per AD-3 rather than imported (this module takes
// enterSendMode the same way). Replaces a local three-part copy of the
// composite that had drifted from the other four in the codebase.
let isTransferRunningFn = null;
let isWriterReadyFn = null;   // Phase 9 WR-03 — gate button on writer registration
let slideChipRef = null;      // Phase 11 Plan 11-03 D-10 — chip flash on drop-during-active-session
// E3.1 review fix (#6) — fired when the send gate flips, so the File ▸ Send File…
// menu row can re-project WHILE the File menu is held open (the poll runs every
// 200ms; without this the row only self-corrected on the next menu open, and a
// stale-disabled row swallowed an otherwise-valid activation). Injected by main.js
// as wireFileSource({ onSendGateChange }); mirrors session-log's onStateChange
// hook. Optional + no-throw — a harness that omits it is inert.
let onSendGateChangeFn = null;

// Phase 12 SLIDE-36 — three new modal action buttons (collision-mode footer).
let sendRenamedBtnRef = null;
let firstOnlyBtnRef = null;
let refuseBtnRef = null;

// Phase 12 SLIDE-12 — post-drop selection clear (companion to Plan 12-01's
// selection.js early-return; called from onDrop after setDropTarget(false)).
let clearSelectionFnRef = null;

let buttonStateInterval = null;

// ===== wireFileSource — exposed to main.js =====
export function wireFileSource(opts) {
    const {
        wrapperEl,        // #terminal-wrapper
        modalEl,          // #send-modal <dialog>
        titleEl,          // #send-modal-title
        listEl,           // #send-modal-list
        hintEl,           // #send-modal-all-rejected-hint
        modalCancelBtn,   // #send-modal-cancel
        modalSendBtn,     // #send-modal-send
        enterSendMode,    // imported from transport/slide.js (injected)
        getSlideState,    // () => window.__slide.__getStateForTests() (injected)
        isTransferRunning,   // E11 retro — () => slide.isTransferRunning() (injected)
        isWriterReady,    // Phase 9 WR-03 — () => txSink.isWriterReady() (injected)
        slideChip,        // Phase 11 Plan 11-03 D-10 — chip flash on drop-during-active-session (injected)
        // Phase 12 SLIDE-36 — three new modal action buttons (collision-mode footer):
        modalSendRenamedBtn,   // #send-modal-send-renamed
        modalFirstOnlyBtn,     // #send-modal-first-only
        modalRefuseBtn,        // #send-modal-refuse
        // Phase 12 SLIDE-12 — post-drop selection clear (injected; called from onDrop).
        clearSelectionFn,
        // E3.1 review fix (#6) — notify on send-gate transitions (menu-row re-project).
        onSendGateChange,
    } = opts;
    wrapperElRef = wrapperEl;
    modalElRef = modalEl;
    titleElRef = titleEl;
    listElRef = listEl;
    hintElRef = hintEl;
    cancelBtnRef = modalCancelBtn;
    sendBtnRef = modalSendBtn;
    enterSendModeFn = enterSendMode;
    getSlideStateFn = getSlideState;
    isTransferRunningFn = isTransferRunning;
    isWriterReadyFn = isWriterReady ?? null;
    slideChipRef = slideChip || null;
    onSendGateChangeFn = onSendGateChange || null;   // E3.1 review fix (#6)
    // Phase 12 SLIDE-36 / SLIDE-12.
    sendRenamedBtnRef   = modalSendRenamedBtn || null;
    firstOnlyBtnRef     = modalFirstOnlyBtn   || null;
    refuseBtnRef        = modalRefuseBtn      || null;
    clearSelectionFnRef = clearSelectionFn    || null;

    // ===== Own the file picker (E7.1 — the retired #send-file-input) =====
    // Created programmatically so it is never rendered chrome — the ONLY trigger
    // is File ▸ Send File… → openSendPicker(). Re-created idempotently on a re-wire.
    sendInputEl = document.createElement('input');
    sendInputEl.id = 'send-file-input';   // stable handle for the picker (test-addressable)
    sendInputEl.type = 'file';
    sendInputEl.multiple = true;
    sendInputEl.hidden = true;
    // Attach off-screen so .click() reliably opens the native picker inside the
    // menu-item click gesture (and so the Playwright suite can locate it).
    document.body.appendChild(sendInputEl);
    // ===== File picker change → validate + show modal =====
    sendInputEl.addEventListener('change', () => {
        const files = Array.from(sendInputEl.files || []);
        // Reset the input so re-selecting the same file later still fires change.
        sendInputEl.value = '';
        if (files.length === 0) return;
        processFiles(files).catch((err) => {
            console.error('[file-source] processFiles (picker) failed:', err);
        });
    });

    // ===== Drag-drop on #terminal-wrapper =====
    wrapperEl.addEventListener('dragenter', onDragEnter);
    wrapperEl.addEventListener('dragover',  onDragOver);
    wrapperEl.addEventListener('dragleave', onDragLeave);
    wrapperEl.addEventListener('drop',      onDrop);

    // ===== Modal cancel/send buttons =====
    cancelBtnRef.addEventListener('click', () => modalElRef.close('cancel'));
    sendBtnRef.addEventListener('click', () => {
        if (sendBtnRef.disabled) return;
        modalElRef.close('send');
    });

    // ===== Phase 12 SLIDE-36 — three-action button row (collision-mode footer) =====
    // Each button closes the dialog with a tagged returnValue that processFiles
    // switches on ('send' | 'first-only' | 'refuse'). Phase 4 D-16 mousedown
    // preventDefault retains canvas focus mirroring the existing two buttons.
    if (sendRenamedBtnRef) {
        sendRenamedBtnRef.addEventListener('click', () => {
            if (sendRenamedBtnRef.disabled) return;
            modalElRef.close('send');
        });
        sendRenamedBtnRef.addEventListener('mousedown', (e) => e.preventDefault());
    }
    if (firstOnlyBtnRef) {
        firstOnlyBtnRef.addEventListener('click', () => {
            if (firstOnlyBtnRef.disabled) return;
            modalElRef.close('first-only');
        });
        firstOnlyBtnRef.addEventListener('mousedown', (e) => e.preventDefault());
    }
    if (refuseBtnRef) {
        refuseBtnRef.addEventListener('click', () => {
            if (refuseBtnRef.disabled) return;
            modalElRef.close('refuse');
        });
        refuseBtnRef.addEventListener('mousedown', (e) => e.preventDefault());
    }

    // ===== Modal click-outside-to-dismiss (UI-SPEC §Interaction) =====
    modalElRef.addEventListener('click', (e) => {
        // Click on the dialog element itself (not on a child) means the click
        // landed on the backdrop region (native browser behavior).
        if (e.target === modalElRef) {
            modalElRef.close('cancel');
        }
    });

    // ===== Button-state observer =====
    // UI-SPEC §Top-bar button state machine — disabled while pendingSendSession
    // is set OR mode === 'send'. Re-enabled when mode returns to 'terminal'.
    // Poll every 200ms; cheap and event-loop-friendly.
    if (buttonStateInterval) clearInterval(buttonStateInterval);
    // Synchronous first pass BEFORE the interval so the gate reflects reality at wire
    // time — not up to 200ms later. The menu row (projectSendFile, re-projected via
    // onSendGateChange) and openSendPicker both read this state, so a boot-window
    // interaction could slip through the gate. Idempotent: if the state already
    // matches, updateSendGate is a no-op and fires no spurious onSendGateChange.
    updateSendGate();
    buttonStateInterval = setInterval(updateSendGate, 200);
}

// ===== Epic E3 Story E3.1 (FR-16, AC-1) — menu-path picker entry =====
// File ▸ Send File… routes here (injected into wireMenuBar as opts.sendFile) so
// menu-bar drives the picker→#send-modal path WITHOUT importing file-source
// (AD-3 / relocation-strategy: inject-the-action). E7.1 — this is now the SOLE
// picker trigger (#send-file-button retired). Honors the same disabled gate
// (updateSendGate closes it while a SLIDE session is pending/active or no writer
// is ready), so it is inert in exactly those states.
export function openSendPicker() {
    if (!sendInputEl) return;          // unwired harness — no-op
    if (sendGateDisabled) return;      // same gate the top-bar button click used to enforce
    sendInputEl.click();
}

// E7.1 — the send gate as module state (was carried on #send-file-button's live
// .disabled/.title before #top-bar's removal). getSendGate() lets menu-bar's
// Send File… row project the same disabled/tooltip feedback the button gave,
// without any DOM coupling — read-at-use, no-throw.
export function getSendGate() {
    return { disabled: sendGateDisabled, title: sendGateTitle };
}

function updateSendGate() {
    if (!getSlideStateFn) return;
    let st;
    try { st = getSlideStateFn(); } catch { return; }
    const isPending = !!st?.hasPendingSendSession;
    const isSending = st?.mode === 'send';
    // Phase 9 WR-02 — `'recv'` is also a session-active state. Without this
    // arm, a click during an inbound recv session flows through to
    // enterSendMode → pushTxBytes (silent-dropped because owner === 'slide')
    // → user sees nothing happen.
    const isReceiving = st?.mode === 'recv';
    // Phase 9 WR-03 — disable until a writer is registered (i.e., user has
    // successfully clicked Connect). Pre-Connect clicks would otherwise
    // accumulate auto-type bytes in the ring without reaching the wire.
    const writerReady = isWriterReadyFn ? !!isWriterReadyFn() : true;
    const shouldDisable = isPending || isSending || isReceiving || !writerReady;
    // Preserve the two distinct disabled-reason tooltips the button carried.
    const nextTitle = !shouldDisable
        ? 'Send file(s) to MicroBeast via SLIDE'
        : ((!writerReady && !isPending && !isSending && !isReceiving)
            ? 'Connect to a serial port first'
            : 'Transfer in progress — wait for completion');
    // Notify only on an actual change so the mirrored File ▸ Send File… row
    // re-projects (its tooltip reads sendGateTitle) without spurious churn.
    if (shouldDisable !== sendGateDisabled || nextTitle !== sendGateTitle) {
        sendGateDisabled = shouldDisable;
        sendGateTitle = nextTitle;
        notifySendGate();
    }
}

// E3.1 review fix (#6) — no-throw notify of a send-gate transition (a failing
// subscriber must never break the 200ms poll or leak an exception into it).
function notifySendGate() {
    if (!onSendGateChangeFn) return;
    try { onSendGateChangeFn(); } catch { /* subscriber must not break the poll */ }
}

// ===== Drag-drop handlers (D-04 silent rejection at dragenter for non-file drags) =====

// UAT-E9-04 (i) — refusal-diagnostic throttle (dragenter fires per
// descendant crossing; one line per half second is plenty).
let lastDragRefuseLogTs = 0;

function isFileDrag(ev) {
    return ev.dataTransfer && ev.dataTransfer.types && ev.dataTransfer.types.includes && ev.dataTransfer.types.includes('Files');
}

function isSessionActive() {
    // 'recv' is included (inside isTransferRunning) so a drop during an active
    // pull gets the same "Transfer in progress" chip flash instead of a confirm
    // modal whose Send click enterSendMode then refuses (wire owner is 'slide')
    // with only a console.warn — matching updateSendGate's WR-02 arm.
    //
    // E11 retrospective (2026-08-06) — this was a local copy of the composite
    // that omitted the wire-owner part the other versions had. Fail-closed on a
    // missing dependency (an unwired harness refuses the drop rather than
    // accepting one it cannot honour).
    if (!isTransferRunningFn) return false;
    try { return !!isTransferRunningFn(); } catch { return false; }
}

function onDragEnter(ev) {
    if (!isFileDrag(ev)) {
        // UAT-E9-04 (i) diagnostic — a refused external drag is otherwise
        // silent (no preventDefault → OS shows no-drop, no overlay). Some
        // Linux filer/portal combinations present drags whose hover-phase
        // types lack 'Files' (e.g. text/uri-list only) — Chromium cannot
        // hand the page such files, so the refusal is correct but opaque.
        // console.info (NOT debug — DevTools hides Verbose by default),
        // throttled: dragenter fires per descendant crossing.
        const now = Date.now();
        if (now - lastDragRefuseLogTs > 500) {
            lastDragRefuseLogTs = now;
            const t = ev.dataTransfer && ev.dataTransfer.types ? Array.from(ev.dataTransfer.types) : [];
            console.info('[file-source] drag not a Files drag — refused; types:', JSON.stringify(t));
        }
        return;
    }
    if (isSessionActive()) {
        // Phase 11 Plan 11-03 D-10 / SLIDE-11 — chip flash replaces Phase 9
        // silent ignore. flashDropRejected sets a 3-second sliding window
        // overlay on the active-state chip rendering "Transfer in progress —
        // cancel first" (UI-SPEC §Copywriting verbatim). Don't preventDefault;
        // don't set the [data-drop-target] attribute (the drop overlay must
        // not appear, only the chip flash). Throttled like the non-Files
        // branch above — dragenter fires per descendant crossing, and each
        // flashDropRejected call re-renders the chip; one call per half
        // second keeps the 3 s sliding window pinned just the same.
        const now = Date.now();
        if (now - lastDragRefuseLogTs > 500) {
            lastDragRefuseLogTs = now;
            console.info('[file-source] drag refused — SLIDE session active (or pending send session)');
            try { if (slideChipRef && typeof slideChipRef.flashDropRejected === 'function') slideChipRef.flashDropRejected(); } catch {}
        }
        return;
    }
    ev.preventDefault();
    dragDepth++;
    if (dragDepth === 1) {
        setDropTarget(true);
    }
}

function onDragOver(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) return;
    ev.preventDefault();   // required for drop to fire
}

function onDragLeave(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
        setDropTarget(false);
    }
}

function onDrop(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) {
        // Phase 11 Plan 11-03 D-10 / SLIDE-11 — chip flash replaces Phase 9
        // silent ignore. Same 3-second sliding window as onDragEnter; bytes
        // never reach enterSendMode while the session is active
        // (T-11-03-drop-injection mitigation).
        try { if (slideChipRef && typeof slideChipRef.flashDropRejected === 'function') slideChipRef.flashDropRejected(); } catch {}
        return;
    }
    ev.preventDefault();
    dragDepth = 0;
    setDropTarget(false);
    // Phase 12 SLIDE-12 SC#1 — clear any in-flight pointer-select bounds left
    // by a half-completed drag. Drop wins per CONTEXT Claude's Discretion default
    // (12-UI-SPEC.md §SLIDE-12). Wrapped in try/catch so a clearSelection failure
    // cannot abort the drop (T-12-10 mitigation).
    if (typeof clearSelectionFnRef === 'function') {
        try { clearSelectionFnRef(); } catch { /* ignore */ }
    }
    const files = Array.from(ev.dataTransfer.files);
    if (files.length === 0) return;
    processFiles(files).catch((err) => {
        console.error('[file-source] processFiles (drop) failed:', err);
    });
}

function setDropTarget(active) {
    if (!wrapperElRef) return;
    if (active) {
        wrapperElRef.setAttribute('data-drop-target', 'true');
    } else {
        wrapperElRef.removeAttribute('data-drop-target');
    }
}

// ===== sendFiles — E9 S9.4 sanctioned fallback entry (story e9-4 Dev Notes) =====
// The pull pane's reverse drag cannot hand its File over inside the native
// drag data store: Chromium's real drag loop serializes the store through
// platform formats, and a JS-constructed File (no OS backing) is degraded to
// a text/plain string of its filename (verified 2026-07-24, headless + headed).
// So the pane keeps the native drag for the gesture and calls this on
// drop-over-wrapper instead. Same path as an OS file drop from validation
// onward: validate → truncate → collisions → confirm modal → enterSendMode.
export function sendFiles(files) {
    // Same session guard the OS drag/drop path enforces at dragenter/drop.
    // Without it a reverse drag during a pending send (auto-typed command,
    // awaiting the Z80 wakeup — wire owner still 'terminal', so the pane's
    // own slide-active check passes) walks the whole confirm modal and then
    // enterSendMode refuses with only a console.warn: the modal closes as
    // if queued and nothing is ever sent. Flash the chip like the OS path.
    if (isSessionActive()) {
        try { if (slideChipRef && typeof slideChipRef.flashDropRejected === 'function') slideChipRef.flashDropRejected(); } catch {}
        return Promise.resolve();
    }
    return processFiles(Array.from(files));
}

// ===== processFiles — runs validation + truncation + modal flow =====
async function processFiles(filesArr) {
    // Build per-file rows: { kind: 'rewrite' | 'unchanged' | 'rejected' | 'collision',
    //                        original, rewritten?, reason?, bytes? }
    const rows = [];
    const surviving = [];
    for (const f of filesArr) {
        const original = f.name;
        const validation = validateCpmFilename(original);
        if (!validation.ok) {
            rows.push({ kind: 'rejected', original, reason: validation.reason });
            continue;
        }
        const rewritten = truncateCpm83(original);
        const ab = await f.arrayBuffer();
        const bytes = new Uint8Array(ab);
        if (rewritten === original) {
            rows.push({ kind: 'unchanged', original });
        } else {
            rows.push({ kind: 'rewrite', original, rewritten });
        }
        surviving.push({ name: rewritten, bytes });
    }

    // Phase 12 SLIDE-36 D-05 — collision detection: second pass over post-truncation
    // surviving. Key = item.name.toUpperCase() (D-01 — case-insensitive on top of
    // post-8.3 truncation). Pitfall 1: detection runs AFTER validateCpmFilename
    // rejection AND truncateCpm83.
    const collisionGroups = new Map();
    for (const item of surviving) {
        const key = item.name.toUpperCase();
        if (!collisionGroups.has(key)) collisionGroups.set(key, []);
        collisionGroups.get(key).push(item);
    }
    const collisionRows = [];
    for (const [key, group] of collisionGroups) {
        if (group.length > 1) {
            collisionRows.push({
                kind: 'collision',
                base: key,                              // e.g. 'REPORT.TXT'
                members: group,                         // user-presentation order preserved
                renamed: computeRenameScheme(group),    // parallel to members
            });
        }
    }

    // v1.1 polish 260513-grs Task 2 — skip modal entirely when the user has
    // disabled confirmation in Settings. Default ON (slideConfirmTransfers=true)
    // preserves the Phase 9 / Phase 12 modal flow verbatim. When OFF:
    //   - collisions present → silent auto-rename (same scheme as the modal's
    //     [Send N renamed] button — applyCollisionRenames over collisionRows).
    //   - no collisions → use `surviving` as-is.
    // In both branches, enterSendModeFn is invoked directly without user
    // confirmation. All-rejected (surviving.length === 0) still short-circuits
    // because the silent branch only fires enterSendMode when finalFiles.length > 0.
    const livePrefsForConfirm = (typeof getPrefs === 'function') ? getPrefs() : null;
    const confirmEnabled = (!livePrefsForConfirm || livePrefsForConfirm.slideConfirmTransfers !== false);

    if (!confirmEnabled) {
        let silentFinal;
        if (collisionRows.length > 0) {
            silentFinal = applyCollisionRenames(surviving, collisionRows);
        } else {
            silentFinal = surviving;
        }
        if (enterSendModeFn && silentFinal && silentFinal.length > 0) {
            enterSendModeFn({ files: silentFinal });
        }
        return;
    }

    // Show modal; await tagged user choice (D-06: 'send' | 'first-only' | 'refuse' | falsy).
    const action = await showConfirmModal(rows, surviving, collisionRows);
    if (!action || action === 'refuse') return;

    let finalFiles;
    if (action === 'send') {
        finalFiles = applyCollisionRenames(surviving, collisionRows);
    } else if (action === 'first-only') {
        finalFiles = applyFirstOnlyFilter(surviving, collisionRows);
    } else {
        return;   // unknown action — bail
    }

    // Hand off to transport/slide.js.
    if (enterSendModeFn && finalFiles && finalFiles.length > 0) {
        enterSendModeFn({ files: finalFiles });
    }
}

/**
 * SLIDE-36: Apply the auto-rename scheme to surviving items.
 * Returns a new array; surviving items NOT in any colliding group pass through
 * unchanged. The rename map is built by surviving-array index so the per-item
 * bytes Uint8Array reference is preserved.
 */
function applyCollisionRenames(surviving, collisionRows) {
    if (collisionRows.length === 0) return surviving;
    const renameMap = new Map();   // surviving-index → newName
    for (const cr of collisionRows) {
        for (let i = 0; i < cr.members.length; i++) {
            const memberItem = cr.members[i];
            const idx = surviving.indexOf(memberItem);
            if (idx >= 0) renameMap.set(idx, cr.renamed[i]);
        }
    }
    return surviving.map((item, idx) =>
        renameMap.has(idx) ? { name: renameMap.get(idx), bytes: item.bytes } : item
    );
}

/**
 * SLIDE-36: Drop K-1 files per collision group; keep group[0]. Items NOT in any
 * colliding group pass through. Pitfall 3: actual filter, NOT pass-through.
 */
function applyFirstOnlyFilter(surviving, collisionRows) {
    if (collisionRows.length === 0) return surviving;
    const dropSet = new Set();
    for (const cr of collisionRows) {
        for (let i = 1; i < cr.members.length; i++) {
            const idx = surviving.indexOf(cr.members[i]);
            if (idx >= 0) dropSet.add(idx);
        }
    }
    return surviving.filter((_, idx) => !dropSet.has(idx));
}

// ===== showConfirmModal — Promise-returning native <dialog> flow =====
// Phase 12 SLIDE-36 — extended with the optional `collisionRows` third arg.
// Returns a tagged returnValue: 'send' | 'first-only' | 'refuse' | null
// (Phase 9 boolean shape replaced with tagged for D-06 three-mode flow).
function showConfirmModal(rows, surviving, collisionRows) {
    if (!modalElRef) return Promise.resolve(null);

    // Build modal contents.
    const n = surviving.length;
    titleElRef.textContent = `Sending ${n} file${n === 1 ? '' : 's'} via SLIDE`;
    listElRef.innerHTML = '';
    for (const row of rows) {
        const li = document.createElement('li');
        if (row.kind === 'rewrite') {
            li.className = 'rewrite';
            li.appendChild(spanText('•', true));
            li.appendChild(spanText(row.original, false, 'orig'));
            li.appendChild(spanText('→', true));
            li.appendChild(spanText(row.rewritten, false, 'rewritten'));
        } else if (row.kind === 'unchanged') {
            li.className = 'unchanged';
            li.appendChild(spanText('•', true));
            li.appendChild(spanText(row.original, false, 'orig'));
        } else {
            // rejected
            li.className = 'rejected';
            li.appendChild(spanText('•', true));
            li.appendChild(spanText(row.original, false, 'orig'));
            li.appendChild(spanText(` — rejected: ${row.reason}`, false, 'reason'));
        }
        listElRef.appendChild(li);
    }

    // Phase 12 SLIDE-36 — append collision rows AFTER the per-file rows
    // (rejected/rewrite/unchanged). Ordering preserves D-05 detection order
    // (Map iteration is insertion-ordered in JS so first-occurrence wins).
    // Each collision row renders as two visual lines:
    //   • BASE
    //        ↳ NAME0, NAME1, NAME2, ...
    // Per 12-UI-SPEC.md §A "Modal collision row copy" (locked verbatim).
    for (const cr of collisionRows || []) {
        const li = document.createElement('li');
        li.className = 'collision';
        const head = document.createElement('div');
        head.appendChild(spanText('•', true));
        head.appendChild(spanText(cr.base, false, 'orig'));
        li.appendChild(head);
        const sub = document.createElement('div');
        sub.className = 'rename-list';
        sub.setAttribute('aria-label', `Renamed to: ${cr.renamed.join(', ')}`);
        sub.appendChild(spanText('↳', true));
        sub.appendChild(document.createTextNode(' ' + cr.renamed.join(', ')));
        li.appendChild(sub);
        listElRef.appendChild(li);
    }

    // All-rejected hint + send-button disabled state.
    if (n === 0) {
        hintElRef.hidden = false;
        sendBtnRef.disabled = true;
        sendBtnRef.textContent = 'Send 0 files';
    } else {
        hintElRef.hidden = true;
        sendBtnRef.disabled = false;
        sendBtnRef.textContent = `Send ${n} file${n === 1 ? '' : 's'}`;
    }

    // Phase 12 SLIDE-36 D-06 — footer-button three-mode flow toggle.
    // No collisions: Phase 9 two-button row visible (Cancel + Send N files).
    // Collisions present: three-action button row replaces the two-button row
    // (Send N renamed + Send only first + Refuse batch); Phase 9 buttons hidden.
    const collisionsPresent = !!(collisionRows && collisionRows.length > 0);
    if (collisionsPresent) {
        if (cancelBtnRef) cancelBtnRef.hidden = true;
        if (sendBtnRef)   sendBtnRef.hidden = true;
        if (sendRenamedBtnRef) {
            sendRenamedBtnRef.hidden = false;
            // Singular/plural rule per 12-UI-SPEC.md.
            sendRenamedBtnRef.textContent = (n === 1) ? 'Send 1 renamed' : `Send ${n} renamed`;
            sendRenamedBtnRef.disabled = (n === 0);
        }
        if (firstOnlyBtnRef) firstOnlyBtnRef.hidden = false;
        if (refuseBtnRef)    refuseBtnRef.hidden    = false;
    } else {
        if (cancelBtnRef) cancelBtnRef.hidden = false;
        if (sendBtnRef)   sendBtnRef.hidden   = false;
        if (sendRenamedBtnRef) sendRenamedBtnRef.hidden = true;
        if (firstOnlyBtnRef)   firstOnlyBtnRef.hidden   = true;
        if (refuseBtnRef)      refuseBtnRef.hidden      = true;
    }

    // Epic E0 Story E0.2 (AD-8) — open/close/focus now lives in openModal. The
    // caller keeps ONLY the two decisions that vary per dialog:
    //   initialFocus — which footer button to light (data-focused + .focus()).
    //     Phase 12 UAT Niggle 2: no-collision default is [Send N files] (leftmost
    //     primary, so Enter sends); collision mode keeps [Send N renamed] per
    //     SLIDE-36 D-03. openModal clears data-focused on exactly this element on
    //     close (the old defensive clears of the other footer buttons are no
    //     longer needed — the helper always clears the one it lit).
    //   restoreTo — E7.1: the trigger is now the File ▸ Send File… menu item, which
    //     closes on activation, so every outcome restores focus to #terminal-wrapper
    //     (NFR-1 — keystrokes flow back to the Z80). The former top-bar-button
    //     restore target retired with #top-bar.
    // openModal resolves to the RAW returnValue ('' for Esc); processFiles' own
    // `!action` guard maps '' → bail, preserving showConfirmModal's contract.
    const initialFocus = collisionsPresent
        ? (sendRenamedBtnRef || cancelBtnRef)
        : (sendBtnRef || cancelBtnRef);
    const restoreTo = () => wrapperElRef;
    return openModal(modalElRef, { initialFocus, restoreTo });
}

function spanText(text, ariaHidden, className) {
    const s = document.createElement('span');
    s.textContent = text;
    if (ariaHidden) s.setAttribute('aria-hidden', 'true');
    if (className) s.className = className;
    return s;
}

// ===== Pure-function exports (testable independently) =====

/**
 * Validate a filename against the CP/M-invalid character set (D-06).
 *
 * Returns { ok: true, reason: null } if valid, otherwise an object with
 * a human-readable reason string suitable for the modal rejection row.
 *
 * Rules:
 *   - empty string → invalid
 *   - leading dot (dotfile) → invalid
 *   - control characters (codepoint < 0x20) → invalid
 *   - non-ASCII (codepoint >= 0x80) → invalid
 *   - any char in <,>,,,;,:,=,?,*,[,] → invalid
 *
 * The bytes-≥-0x80 check uses charCodeAt (UTF-16 code unit). For BMP
 * codepoints this matches; for surrogate pairs the high surrogate is
 * always ≥ 0xD800 ≥ 0x80 so it triggers rejection on the first half
 * (correct outcome).
 */
export function validateCpmFilename(name) {
    if (!name || name.length === 0) return { ok: false, reason: 'empty filename' };
    if (name.startsWith('.')) return { ok: false, reason: 'leading-dot dotfile' };
    for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        if (c < 0x20) {
            return { ok: false, reason: `control character 0x${c.toString(16).padStart(2, '0')}` };
        }
        if (c >= 0x80) {
            return { ok: false, reason: `non-ASCII byte 0x${c.toString(16).padStart(2, '0')}` };
        }
        const ch = name[i];
        if (CPM_INVALID_CHARS.has(ch)) {
            return { ok: false, reason: `invalid CP/M character '${ch}'` };
        }
    }
    return { ok: true, reason: null };
}

/**
 * Apply the CP/M 8.3 truncation algorithm (D-07).
 *
 * - Uppercase via String#toUpperCase()
 * - Split on the FINAL `.`; truncate base to 8, ext to 3
 * - No extension → truncate base to 8, no dot in result
 * - Multi-dot files split on last dot (e.g. `my.tar.gz` → base=`my.tar` → 6 chars,
 *   ext=`gz` → 2 chars → result `MY.TAR.GZ`)
 *
 * Caller is expected to have already passed validateCpmFilename — this
 * function does NOT re-validate (e.g., it does not reject leading-dot files).
 */
export function truncateCpm83(name) {
    const upper = name.toUpperCase();
    const lastDot = upper.lastIndexOf('.');
    if (lastDot < 0) {
        return upper.slice(0, 8);
    }
    const base = upper.slice(0, lastDot).slice(0, 8);
    const ext = upper.slice(lastDot + 1).slice(0, 3);
    return ext.length > 0 ? `${base}.${ext}` : base;
}

/**
 * Phase 12 SLIDE-36: Compute the auto-rename scheme for a colliding group.
 *
 * Per 12-CONTEXT.md D-04 (LOCKED), unlimited-via-base-truncation:
 *   For collision group of size K+1, name_i for i >= 1 is:
 *     truncate_base(BASE, 8 - len(str(i))) + '~' + str(i) + '.' + EXT
 *   where BASE = post-truncation 8.3 base (the existing surviving[i].name
 *   stripped of its extension), and truncate_base(s, n) = s[:n].
 *
 * The first member (i=0) keeps its name verbatim — first-occurrence wins.
 * Determinism: group order is the user-presentation order from the
 * processFiles surviving array. Base truncation operates on the
 * post-truncation base ONLY (never re-derives from the original
 * filename — that would drift from modal preview vs final wire bytes).
 *
 * Examples:
 *   computeRenameScheme([])                                      → []
 *   computeRenameScheme([{name:'REPORT.TXT'}])                   → ['REPORT.TXT']
 *   computeRenameScheme(13 × {name:'REPORT.TXT'})                → ['REPORT.TXT', 'REPORT~1.TXT', ..., 'REPORT~9.TXT', 'REPOR~10.TXT', 'REPOR~11.TXT', 'REPOR~12.TXT']
 *   computeRenameScheme(101 × {name:'LONGNAME.TXT'})             → indices 0='LONGNAME.TXT', 1='LONGNAM~1.TXT', 9='LONGNAM~9.TXT', 10='LONGNA~10.TXT', 99='LONGNA~99.TXT', 100='LONGN~100.TXT'
 *   computeRenameScheme(3 × {name:'NOEXT'})                      → ['NOEXT', 'NOEX~1', 'NOEX~2'] (no extension; ext='' so result has no dot)
 *
 * @param {Array<{name: string, bytes?: Uint8Array}>} group
 * @returns {string[]} parallel to group; result[0] === group[0].name
 */
export function computeRenameScheme(group) {
    if (!Array.isArray(group) || group.length === 0) return [];
    const first = group[0].name;
    const result = [first];
    const lastDot = first.lastIndexOf('.');
    const baseFull = lastDot < 0 ? first : first.slice(0, lastDot);
    const ext      = lastDot < 0 ? ''    : first.slice(lastDot);   // includes dot
    for (let i = 1; i < group.length; i++) {
        const suffixDigits = String(i);
        const baseLimit = Math.max(0, 8 - suffixDigits.length);
        const trimmedBase = baseFull.slice(0, baseLimit);
        result.push(trimmedBase + '~' + suffixDigits + ext);
    }
    return result;
}

/**
 * Pack file metadata per CONTEXT D-09:
 *
 *   <u32 LE file_count>
 *   for each file:
 *     <u32 LE name_len>
 *     <name bytes (UTF-8 / ASCII; already CP/M-validated + truncated)>
 *     <u32 LE size>
 *
 * Returns Uint8Array. Caller passes [{ name: string, bytes: Uint8Array }, ...].
 */
export function packSendMetadata(files) {
    const enc = new TextEncoder();
    const nameBytesArr = files.map((f) => enc.encode(f.name));
    let totalLen = 4;
    for (const nb of nameBytesArr) {
        totalLen += 4 + nb.length + 4;
    }
    const buf = new Uint8Array(totalLen);
    const dv = new DataView(buf.buffer);
    let cursor = 0;
    dv.setUint32(cursor, files.length, true /* LE */); cursor += 4;
    for (let i = 0; i < files.length; i++) {
        const nb = nameBytesArr[i];
        dv.setUint32(cursor, nb.length, true); cursor += 4;
        buf.set(nb, cursor); cursor += nb.length;
        dv.setUint32(cursor, files[i].bytes.length, true); cursor += 4;
    }
    return buf;
}

// ===== Test introspection (mirror of paste-pump.js / slide.js precedent) =====
export function __resetForTests() {
    dragDepth = 0;
    if (wrapperElRef) wrapperElRef.removeAttribute('data-drop-target');
    sendGateDisabled = false;
    sendGateTitle = 'Send file(s) to MicroBeast via SLIDE';
    if (modalElRef && modalElRef.open) modalElRef.close('cancel');
}

export function __getStateForTests() {
    return {
        dragDepth,
        dropTargetActive: wrapperElRef?.hasAttribute('data-drop-target') ?? false,
        modalOpen: modalElRef?.open ?? false,
        // E7.1 — the send gate is module state now (was #send-file-button.disabled /
        // .textContent). sendBtnLabel is kept in the shape for spec compatibility,
        // surfacing the gate tooltip in lieu of the retired button's label.
        sendBtnDisabled: sendGateDisabled,
        sendBtnLabel: sendGateTitle,
    };
}
