// Beastty Phase 9 — File-source: picker + drag-drop + CP/M validation + confirm modal.
//
// Public API: wireFileSource, validateCpmFilename, truncateCpm83, packSendMetadata.
//
// Sources:
//   - 09-CONTEXT.md D-01..D-09 + D-18 (locked decisions).
//   - 09-RESEARCH.md Pattern 2 (validation), Pattern 3 (modal), Pattern 4 (drag-drop).
//   - 09-UI-SPEC.md §Copywriting (verbatim modal + button copy) + §Interaction & State Contracts.
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
    // Build per-file rows: { kind: 'rewrite' | 'unchanged' | 'rejected',
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

    // Show modal; await user choice.
    const userConfirmed = await showConfirmModal(rows, surviving);
    if (!userConfirmed) return;

    // Hand off to transport/slide.js.
    if (enterSendModeFn) {
        enterSendModeFn({ files: surviving });
    }
}

// ===== showConfirmModal — Promise-returning native <dialog> flow =====
function showConfirmModal(rows, surviving) {
    if (!modalElRef) return Promise.resolve(false);

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

    return new Promise((resolve) => {
        const onClose = () => {
            modalElRef.removeEventListener('close', onClose);
            const sent = modalElRef.returnValue === 'send';
            // Focus restoration per UI-SPEC §Focus retention on modal close.
            if (sent) {
                wrapperElRef?.focus();
            } else {
                topBarSendBtnRef?.focus();
            }
            resolve(sent);
        };
        modalElRef.addEventListener('close', onClose);
        modalElRef.showModal();
        // Initial focus on Cancel button (UI-SPEC §Interaction — safer default).
        cancelBtnRef?.focus();
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
