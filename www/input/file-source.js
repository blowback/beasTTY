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
let topBarSendBtnRef = null;
let topBarSendInputRef = null;
let enterSendModeFn = null;
let getSlideStateFn = null;
let isWriterReadyFn = null;   // Phase 9 WR-03 — gate button on writer registration
let slideChipRef = null;      // Phase 11 Plan 11-03 D-10 — chip flash on drop-during-active-session

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
        sendBtn,          // #send-file-button
        sendInput,        // #send-file-input
        modalEl,          // #send-modal <dialog>
        titleEl,          // #send-modal-title
        listEl,           // #send-modal-list
        hintEl,           // #send-modal-all-rejected-hint
        modalCancelBtn,   // #send-modal-cancel
        modalSendBtn,     // #send-modal-send
        enterSendMode,    // imported from transport/slide.js (injected)
        getSlideState,    // () => window.__slide.__getStateForTests() (injected)
        isWriterReady,    // Phase 9 WR-03 — () => txSink.isWriterReady() (injected)
        slideChip,        // Phase 11 Plan 11-03 D-10 — chip flash on drop-during-active-session (injected)
        // Phase 12 SLIDE-36 — three new modal action buttons (collision-mode footer):
        modalSendRenamedBtn,   // #send-modal-send-renamed
        modalFirstOnlyBtn,     // #send-modal-first-only
        modalRefuseBtn,        // #send-modal-refuse
        // Phase 12 SLIDE-12 — post-drop selection clear (injected; called from onDrop).
        clearSelectionFn,
    } = opts;
    wrapperElRef = wrapperEl;
    topBarSendBtnRef = sendBtn;
    topBarSendInputRef = sendInput;
    modalElRef = modalEl;
    titleElRef = titleEl;
    listElRef = listEl;
    hintElRef = hintEl;
    cancelBtnRef = modalCancelBtn;
    sendBtnRef = modalSendBtn;
    enterSendModeFn = enterSendMode;
    getSlideStateFn = getSlideState;
    isWriterReadyFn = isWriterReady ?? null;
    slideChipRef = slideChip || null;
    // Phase 12 SLIDE-36 / SLIDE-12.
    sendRenamedBtnRef   = modalSendRenamedBtn || null;
    firstOnlyBtnRef     = modalFirstOnlyBtn   || null;
    refuseBtnRef        = modalRefuseBtn      || null;
    clearSelectionFnRef = clearSelectionFn    || null;

    // ===== Top-bar button click → open file picker =====
    sendBtn.addEventListener('click', () => {
        // Defense-in-depth: if button is disabled, the click event won't fire,
        // but if a test or accessibility tool dispatches it programmatically,
        // short-circuit.
        if (sendBtn.disabled) return;
        sendInput.click();
    });
    // Phase 4 D-16 sacred — focus retention on click (mirrors Phase 6 #clear-button).
    sendBtn.addEventListener('mousedown', (e) => e.preventDefault());

    // ===== File picker change → validate + show modal =====
    sendInput.addEventListener('change', () => {
        const files = Array.from(sendInput.files || []);
        // Reset the input so re-selecting the same file later still fires change.
        sendInput.value = '';
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
    buttonStateInterval = setInterval(updateButtonState, 200);
}

function updateButtonState() {
    if (!getSlideStateFn || !topBarSendBtnRef) return;
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
    if (shouldDisable && !topBarSendBtnRef.disabled) {
        topBarSendBtnRef.disabled = true;
        if (!writerReady && !isPending && !isSending && !isReceiving) {
            // Pre-Connect state: distinguish from in-flight transfer label.
            topBarSendBtnRef.textContent = '↑ Send file';
            topBarSendBtnRef.title = 'Connect to a serial port first';
        } else {
            topBarSendBtnRef.textContent = '↑ Send file (sending…)';   // ellipsis = U+2026
            topBarSendBtnRef.title = 'Transfer in progress — wait for completion';
        }
    } else if (!shouldDisable && topBarSendBtnRef.disabled) {
        topBarSendBtnRef.disabled = false;
        topBarSendBtnRef.textContent = '↑ Send file';
        topBarSendBtnRef.title = 'Send file(s) to MicroBeast via SLIDE';
    } else if (shouldDisable && topBarSendBtnRef.disabled) {
        // Already-disabled — keep the title in sync if the reason changed
        // (e.g. writer registered while a session was already active).
        if (!writerReady && !isPending && !isSending && !isReceiving) {
            if (topBarSendBtnRef.title !== 'Connect to a serial port first') {
                topBarSendBtnRef.title = 'Connect to a serial port first';
                topBarSendBtnRef.textContent = '↑ Send file';
            }
        } else if (topBarSendBtnRef.title !== 'Transfer in progress — wait for completion') {
            topBarSendBtnRef.title = 'Transfer in progress — wait for completion';
            topBarSendBtnRef.textContent = '↑ Send file (sending…)';
        }
    }
}

// ===== Drag-drop handlers (D-04 silent rejection at dragenter for non-file drags) =====
function isFileDrag(ev) {
    return ev.dataTransfer && ev.dataTransfer.types && ev.dataTransfer.types.includes && ev.dataTransfer.types.includes('Files');
}

function isSessionActive() {
    if (!getSlideStateFn) return false;
    let st;
    try { st = getSlideStateFn(); } catch { return false; }
    return !!st?.hasPendingSendSession || st?.mode === 'send';
}

function onDragEnter(ev) {
    if (!isFileDrag(ev)) return;
    if (isSessionActive()) {
        // Phase 11 Plan 11-03 D-10 / SLIDE-11 — chip flash replaces Phase 9
        // silent ignore. flashDropRejected sets a 3-second sliding window
        // overlay on the active-state chip rendering "Transfer in progress —
        // cancel first" (UI-SPEC §Copywriting verbatim). Don't preventDefault;
        // don't set the [data-drop-target] attribute (the drop overlay must
        // not appear, only the chip flash).
        try { if (slideChipRef && typeof slideChipRef.flashDropRejected === 'function') slideChipRef.flashDropRejected(); } catch {}
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

    return new Promise((resolve) => {
        const onClose = () => {
            modalElRef.removeEventListener('close', onClose);
            // Phase 12 SLIDE-36 — tagged returnValue (replaces Phase 9 boolean).
            const action = modalElRef.returnValue || null;
            // Focus restoration:
            //   'send' | 'first-only' → terminal-wrapper (transfer is starting)
            //   'refuse' | 'cancel' | falsy → top-bar Send-file button
            if (action === 'send' || action === 'first-only') {
                wrapperElRef?.focus();
            } else {
                topBarSendBtnRef?.focus();
            }
            resolve(action);
        };
        modalElRef.addEventListener('close', onClose);
        modalElRef.showModal();
        // Phase 12 SLIDE-36 D-03 default-focus override: scoped to collision-
        // present mode only. The no-collision happy path retains Phase 9's
        // Cancel-default focus (Pitfall 2).
        const initialFocusTarget = collisionsPresent
            ? (sendRenamedBtnRef || cancelBtnRef)
            : cancelBtnRef;
        initialFocusTarget?.focus();
    });
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
    if (topBarSendBtnRef) {
        topBarSendBtnRef.disabled = false;
        topBarSendBtnRef.textContent = '↑ Send file';
        topBarSendBtnRef.title = 'Send file(s) to MicroBeast via SLIDE';
    }
    if (modalElRef && modalElRef.open) modalElRef.close('cancel');
}

export function __getStateForTests() {
    return {
        dragDepth,
        dropTargetActive: wrapperElRef?.hasAttribute('data-drop-target') ?? false,
        modalOpen: modalElRef?.open ?? false,
        sendBtnDisabled: topBarSendBtnRef?.disabled ?? false,
        sendBtnLabel: topBarSendBtnRef?.textContent ?? '',
    };
}
