// www/transport/slide-recv.js
//
// Phase 10 — Plan 10-02 — receiver-mode plumbing SKELETON.
//
// Owns the per-file `chunks: Uint8Array[]` accumulator + Blob assembly
// + anchor-click vs folder-save download dispatch + ~N collision suffix
// retry + lastDownloadAt-serialised inter-file gap (SLIDE-19).
//
// Plan 10-02 = SKELETON: cancelSlideRecv is a STUB; full 5-step CTRL_CAN
// state machine + slidePumpOnPortLost real impl + recoverHardFail 3-mode
// convergence ship in Plan 10-03.
//
// Sources:
//   - 10-CONTEXT.md D-01..D-07 (locked decisions: toggle gates path, ~N suffix,
//                               IndexedDB persistence, picker-dismissal D-04)
//   - 10-RESEARCH.md Pattern 1..8 + Example 3 (recv main loop verbatim)
//   - 10-RESEARCH.md §"Pitfall 5: cancellation race" (BLOCKING — Plan 10-03 fills)
//   - 10-RESEARCH.md §"Pitfall 4: memory.buffer growth detaches view"
//   - 10-RESEARCH.md §"Pitfall 12: memory growth on large recv" — MAX_FILE_SIZE cap
//   - 10-PATTERNS.md §"www/transport/slide-recv.js" (5 analogs: session-log,
//     slide.js outbound triple, dispatchSendMode async lifecycle, file-source.js
//     state, slide.js __getStateForTests)
//   - Phase 6 session-log.js (anchor-click pattern verbatim)
//   - Phase 9 file-source.js (module-scope + injected deps + __resetForTests)
//
// Architecture rule: NO Web Serial calls; NO term parser calls; everything
// goes through txSink (writeSlideFrame for cancel echo — Plan 10-03 wires)
// and the slide instance (recv_ptr/recv_len/clear_recv/cancel/force_idle).
//
// W3 assumption (documented per checker review): feed_chunk produces at most
// one EVT_RECV_DATA per call to step() because framer.step processes one frame
// per byte sequence terminated by CRC; subsequent frames in the same chunk emit
// subsequent EVT_RECV_DATA events that are drained sequentially with
// per-frame clear_recv() per Pitfall 5. Plan 10-01's slide_recv_corpus.rs
// includes a recv_corpus_multi_data_frames_in_one_chunk test that pins this
// contract — the JS drain loop relies on calling clear_recv() between events
// so each EVT_RECV_DATA refers only to the bytes from that single frame.
//
// W4 (lastDownloadAt-serialised gap): the inter-file 250 ms gap is enforced
// by reading `lastDownloadAt` BEFORE the anchor-click / createWritable call
// and writing it AFTER. This actually serialises the gap — vs an earlier
// fire-and-forget `.finally(() => delay(250))` design that did NOT block
// subsequent file dispatch on the timer.

// ===== Constants =====
const RECV_VIEW_CAP = 1024;            // FRAME_SIZE in framer.rs
const FILENAME_VIEW_CAP = 16;          // RECV_FILENAME_RESERVE in state.rs
const MAX_FILE_SIZE = 100 * 1024 * 1024;   // T-10-01 mitigation: 100 MB cap on bytesDone
const INTER_FILE_GAP_MS = 250;         // SLIDE-19 / CONTEXT C-01 (W4 — actually serialised)
const SUFFIX_RETRY_BUDGET = 999;       // CONTEXT D-06

const STATE_IDLE = 0;
const STATE_DONE = 6;
const STATE_ERROR = 7;

// ===== Cancel sequence constants — ADR-003 §3 =====
// Plan 10-03 — verbatim per CONTEXT.md "Cancel sequence pseudocode":
//   200 ms allSettled → CTRL_CAN → 500 ms echo wait → 100 ms drain → 2000 ms force_idle escape
const CANCEL_INFLIGHT_TIMEOUT_MS = 200;
const CANCEL_ECHO_WAIT_MS = 500;
const CANCEL_DRAIN_MS = 100;
const CANCEL_ABSOLUTE_TIMEOUT_MS = 2000;
const STATE_CANCEL_PEND = 5;

// EVT_* mirror — Plan 10-03's slide.js wires these via dispatch on kind.
// (Plan 10-02 needs these constants for onRecvEvent's switch.)
// Pinned in lockstep with crates/bestialitty-core/src/slide/framer.rs +
// tests/slide_wasm_boundary_shape.rs::slide_event_constants_pinned_for_phase_8_jsmirror.
const EVT_HEADER_RECEIVED = 11 << 16;
const EVT_RECV_DATA       = 12 << 16;
const EVT_RECV_FILE_DONE  = 13 << 16;

// ===== UI-SPEC LOCKED COPY — VERBATIM; do NOT paraphrase =====
// Source: 10-UI-SPEC.md §"Copywriting Contract".
// Glyph rules:
//   - `…` is U+2026 HORIZONTAL ELLIPSIS (NOT three ASCII dots).
//   - `⚠` is U+26A0 WARNING SIGN (NOT the variant emoji `⚠️` U+FE0F).
const COPY = Object.freeze({
    buttonChooseFolder:    'Choose folder…',
    buttonChangeFolder:    'Change folder…',
    buttonReAllow:         'Re-allow folder…',
    tooltipToggleFirst:    'Toggle the checkbox first',
    tooltipPickFolder:     'Pick a folder for received files',
    tooltipChangeFolder:   'Pick a different folder for received files',
    tooltipReAllow:        'Re-grant permission for the previously-chosen folder',
    stateNoFolder:         'No folder selected',
    stateNeedsFolder:      '⚠ Pick a folder before next transfer',
    stateSavingTo:         (name) => `Saving to: ${name}`,
    statePermissionDenied: (name) => `⚠ Permission needed for ${name}`,
    hintToggleOff: 'Received files land in your Downloads folder. Toggle this to pick a fixed destination.',
    hintToggleOn:  'Received files are written here directly. Toggle off to revert to your Downloads folder.',
});

// ===== Module-scope state =====
let prefsRef = null;
let savePrefsRef = null;
let idbRef = null;
let txSinkRef = null;
let wasmRef = null;
let slideRef = null;
let wrapperElRef = null;
let rowElRef = null;
let toggleElRef = null;
let folderButtonElRef = null;
let statusElRef = null;
let helpElRef = null;

let currentFile = null;            // { name, totalBytes, chunks: Uint8Array[], bytesDone }
let inflightDownloads = [];        // Promise[] for cancel-time settle (Plan 10-03)
let cancelInFlight = false;        // Plan 10-03 idempotency guard
let sessionFolderFallback = false; // D-04 — picker dismissed mid-session → anchor-click for rest
let lastDownloadAt = 0;            // W4 — module-scope timestamp for actual gap serialisation
// Plan 10-05 Rule 1 fix — FIFO promise chain that actually serialises
// concurrent assembleAndDownload calls. Without this, three EOF events
// arriving in the same drain loop kick off three concurrent assembleAndDownload
// promises that ALL read the same stale `lastDownloadAt`, all compute the same
// wait, and all call URL.createObjectURL within microseconds — defeating the
// 250 ms inter-file gap (SLIDE-19 verifiable failure). Chained through this
// tail, each download awaits the previous one's createObjectURL + lastDownloadAt
// update before reading lastDownloadAt itself; the gap is then correctly observed.
let downloadDispatchTail = Promise.resolve();
let recvBuffer = null;             // memory.buffer reference for view re-derivation
let recvView = null;
let filenameBuffer = null;
let filenameView = null;
let cachedHandle = null;           // Plan 10-04 populates via showDirectoryPicker
let currentPermission = null;      // Plan 10-04 populates via queryPermission
let dispatcherForceExitRef = null; // Plan 10-05 Rule 1 — slide.js's forceExitRecvMode (mode-flag sync)
const filenameDecoder = new TextDecoder('latin1');   // Open Question 5 — never throws on high bytes

// ===== wireSlideRecv — boot-time initializer =====
//
// DOM refs (rowEl / toggleEl / folderButtonEl / statusEl / helpEl) MAY be
// null during Plan 10-02 boot — the Settings UI lands in Plan 10-04, which
// will pass non-null refs. The recv plumbing still works for the anchor-click
// default path when refs are null (slideRecvToFolder=false default in prefs).
export function wireSlideRecv(opts) {
    prefsRef = opts.prefs;
    savePrefsRef = opts.savePrefs;
    idbRef = opts.idb;
    txSinkRef = opts.txSink;
    wasmRef = opts.wasm;
    slideRef = opts.slideRef || null;
    wrapperElRef = opts.wrapperEl;
    rowElRef = opts.rowEl || null;
    toggleElRef = opts.toggleEl || null;
    folderButtonElRef = opts.folderButtonEl || null;
    statusElRef = opts.statusEl || null;
    helpElRef = opts.helpEl || null;
    // Plan 10-05 Rule 1 fix — dispatcher's mode-flag sync. When the cancel
    // sequence completes (or hard-fail recovery fires), forceExitRecvMode
    // calls this so slide.js's `mode` flips back to 'terminal' synchronously
    // without waiting for the next inbound chunk to trigger maybeExitRecvMode.
    dispatcherForceExitRef = opts.dispatcherForceExit || null;
    // Plan 10-04 — Settings DOM event wiring + initial render + boot-time
    // permission re-request. When DOM refs are null (Plan 10-02 callsite),
    // these no-op cleanly.
    if (toggleElRef) {
        toggleElRef.addEventListener('change', onToggleChange);
        // Phase 4 D-16 + Phase 6 precedent — preventDefault on mousedown to
        // retain terminal focus; rely on native click toggle (do NOT pre-flip
        // in mousedown — Phase 4 P-04 Rule 1 fix precedent).
        toggleElRef.addEventListener('mousedown', (e) => e.preventDefault());
    }
    if (folderButtonElRef) {
        folderButtonElRef.addEventListener('click', onFolderButtonClick);
        folderButtonElRef.addEventListener('mousedown', (e) => e.preventDefault());
    }
    // Boot-time hydration: if toggle is on AND a handle is in IndexedDB,
    // re-request permission so state (c) or (d) is reflected on first paint.
    // When refs are null this still calls renderSettingsRow() which no-ops.
    bootHandleHydration();
}

// ===== Plan 10-04 — Settings DOM handlers + state-string render =====
//
// renderSettingsRow — pure render; reads (toggleEl.checked / hasHandle /
// currentPermission) and updates button label, button disabled, button
// title tooltip, statusEl text, helpEl text. No side effects beyond DOM
// writes. Safe to call when toggleElRef / folderButtonElRef / statusElRef
// are null (no-op early return).
function renderSettingsRow() {
    if (!toggleElRef || !folderButtonElRef || !statusElRef) return;
    const toggledOn = !!prefsRef?.slideRecvToFolder;
    const hasHandle = !!cachedHandle;
    const permGranted = currentPermission === 'granted';
    // Sync the checkbox UI to prefs (boot path: prefs may be 'true' from
    // localStorage but the DOM checkbox starts unchecked).
    if (toggleElRef.checked !== toggledOn) toggleElRef.checked = toggledOn;
    // Hint paragraph swap (toggle-off variant vs toggle-on variant).
    if (helpElRef) {
        helpElRef.textContent = toggledOn ? COPY.hintToggleOn : COPY.hintToggleOff;
    }
    // Button + state-string per state (a) / (b) / (c) / (d).
    if (!toggledOn) {
        // State (a) — toggle off, no folder UI.
        folderButtonElRef.textContent = COPY.buttonChooseFolder;
        folderButtonElRef.title = COPY.tooltipToggleFirst;
        folderButtonElRef.disabled = true;
        statusElRef.textContent = COPY.stateNoFolder;
    } else if (!hasHandle) {
        // State (b) — toggle on, no folder yet.
        folderButtonElRef.textContent = COPY.buttonChooseFolder;
        folderButtonElRef.title = COPY.tooltipPickFolder;
        folderButtonElRef.disabled = false;
        statusElRef.textContent = COPY.stateNeedsFolder;
    } else if (permGranted) {
        // State (c) — toggle on, folder granted.
        folderButtonElRef.textContent = COPY.buttonChangeFolder;
        folderButtonElRef.title = COPY.tooltipChangeFolder;
        folderButtonElRef.disabled = false;
        statusElRef.textContent = COPY.stateSavingTo(cachedHandle.name);
    } else {
        // State (d) — toggle on, folder denied/prompt.
        folderButtonElRef.textContent = COPY.buttonReAllow;
        folderButtonElRef.title = COPY.tooltipReAllow;
        folderButtonElRef.disabled = false;
        statusElRef.textContent = COPY.statePermissionDenied(cachedHandle.name);
    }
}

// onToggleChange — checkbox change handler. Updates prefsRef + savePrefs +
// renders. Does NOT auto-trigger pickFolder (user clicks the button
// explicitly per UI-SPEC §"Settings-row state machine" — toggle and button
// are decoupled).
function onToggleChange() {
    if (!prefsRef || !savePrefsRef || !toggleElRef) return;
    prefsRef.slideRecvToFolder = !!toggleElRef.checked;
    try { savePrefsRef(); } catch (e) { console.warn('[slide-recv] savePrefs failed:', e); }
    renderSettingsRow();
}

// onFolderButtonClick — button click handler. Two paths:
//   - state (d) → cachedHandle exists but permission is not granted →
//     try requestPermission first; if granted, transition to state (c)
//     without showing the picker.
//   - state (b) or state (c) → showDirectoryPicker.
// State (a) is unreachable — button is disabled.
async function onFolderButtonClick() {
    if (cachedHandle && currentPermission !== 'granted') {
        try {
            const ask = await cachedHandle.requestPermission({ mode: 'readwrite' });
            currentPermission = ask;
            renderSettingsRow();
            if (ask === 'granted') {
                // State (d) → (c) on grant; no picker dialog.
                if (wrapperElRef && typeof wrapperElRef.focus === 'function') {
                    wrapperElRef.focus();
                }
                return;
            }
            // Still not granted — fall through to picker so the user can
            // pick a different folder rather than re-prompting forever.
        } catch (e) {
            console.warn('[slide-recv] requestPermission failed:', e);
            // Fall through to picker.
        }
    }
    await pickFolder();
}

// pickFolder — showDirectoryPicker entry. Resolution → cache handle +
// persist to IndexedDB + transition to state (c). Rejection (user
// dismissed) → silent fall-back per CONTEXT D-04 (no console.error, no
// state change). Always restores terminal focus on settle.
async function pickFolder() {
    try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        cachedHandle = handle;
        if (idbRef && typeof idbRef.setRecvDirHandle === 'function') {
            await idbRef.setRecvDirHandle(handle);
        }
        // Picker resolution implicitly grants permission for the duration
        // of the user gesture; queryPermission returns 'granted' afterwards.
        currentPermission = 'granted';
        renderSettingsRow();
    } catch (e) {
        // User dismissed (AbortError) — D-04 silent fall-back; no console.error.
        if (e && e.name !== 'AbortError') {
            console.warn('[slide-recv] showDirectoryPicker failed:', e);
        }
        // No state change.
    } finally {
        // Restore daily-driver focus invariant per UI-SPEC §"Picker-dialog
        // focus return".
        if (wrapperElRef && typeof wrapperElRef.focus === 'function') {
            wrapperElRef.focus();
        }
    }
}

// requestPermissionAndUpdate — boot-time re-permission probe. Chrome 122+
// guidance: queryPermission first (no user gesture required); only call
// requestPermission inside an explicit user-gesture click handler. Boot
// path here only updates currentPermission to whatever queryPermission
// returns — if 'granted', state (c); if 'prompt' / 'denied', state (d) +
// the user must click [Re-allow folder…] to escalate.
async function requestPermissionAndUpdate(handle) {
    try {
        const queryResult = await handle.queryPermission({ mode: 'readwrite' });
        currentPermission = queryResult;   // 'granted' | 'prompt' | 'denied'
    } catch (e) {
        console.warn('[slide-recv] queryPermission failed:', e);
        currentPermission = 'prompt';
    }
    renderSettingsRow();
}

// bootHandleHydration — boot-time IndexedDB read + render orchestrator.
// If toggle is off → just render state (a). If toggle is on but no
// handle in IDB → state (b). If handle present → query permission and
// render (c) or (d).
async function bootHandleHydration() {
    if (!prefsRef?.slideRecvToFolder || !idbRef || typeof idbRef.getRecvDirHandle !== 'function') {
        renderSettingsRow();
        return;
    }
    try {
        const handle = await idbRef.getRecvDirHandle();
        if (handle) {
            cachedHandle = handle;
            await requestPermissionAndUpdate(handle);
        } else {
            // Toggle on but no handle — state (b).
            renderSettingsRow();
        }
    } catch (e) {
        console.warn('[slide-recv] bootHandleHydration failed:', e);
        renderSettingsRow();
    }
}

// setSlideRef — slide.js calls this on every enterRecvMode (per CONTEXT C-05
// per-session lifecycle — new Slide() per session). Plan 10-03 invokes from
// slide.js's enterRecvMode. Plan 10-02 just defines the export.
export function setSlideRef(slide) {
    slideRef = slide;
}

// ===== isSlideActive — Esc-disambiguation gate (Plan 10-03 imports) =====
// Returns true when slideRef && state in {WaitingRdy(1), HeaderPhase(2),
// DataPhase(3), FinPending(4), CancelPending(5)}. Plan 10-03 imports this
// from keyboard.js to disambiguate Esc-cancel-recv from Esc-to-VT52.
//
// Phase 10 review WR-02 — wrap state() in try/catch defensively. Now that
// exitRecvMode nulls slideRef this should be unreachable, but if a future
// caller forgets to null the ref before calling slide.free(), reading
// state() on a freed wasm instance would panic across the FFI boundary
// (RESEARCH Pitfall 4 — uncatchable across wasm-bindgen). Defensive return
// keeps the Esc-cancel guard graceful.
export function isSlideActive() {
    if (!slideRef) return false;
    try {
        const st = slideRef.state();
        return st !== STATE_IDLE && st !== STATE_DONE && st !== STATE_ERROR;
    } catch {
        return false;
    }
}

// ===== onRecvEvent — called by slide.js drainEventsAndOutbound (Plan 10-03 wires) =====
// Each EVT_RECV_DATA event corresponds to ONE data frame; per the W3
// assumption documented in the head comment, slide.js calls clear_recv()
// between events so the recv_buf payload is always exactly the just-arrived
// frame's payload at the time onRecvData runs.
export function onRecvEvent(evt) {
    const kind = evt & 0xFFFF_0000;
    if (kind === EVT_HEADER_RECEIVED) onHeaderReceived();
    else if (kind === EVT_RECV_DATA) onRecvData();
    else if (kind === EVT_RECV_FILE_DONE) onRecvFileDone();
}

function onHeaderReceived() {
    if (currentFile) {
        // Defensive: a header arriving mid-file is a protocol drift — flush
        // the partial accumulator. Plan 10-03 will integrate recoverHardFail
        // for this case; Plan 10-02 just resets currentFile.
        console.warn('[slide-recv] header arrived mid-file; flushing partial');
    }
    const filename = readRecvFilenameOwned();
    const totalBytes = slideRef.recv_file_size();
    currentFile = {
        name: filename,
        totalBytes,
        chunks: [],
        bytesDone: 0,
    };
}

function onRecvData() {
    if (!currentFile) return;
    const owned = sliceRecvBytesToOwned();
    currentFile.chunks.push(owned);
    currentFile.bytesDone += owned.byteLength;
    // T-10-01 mitigation: hard cap at 100 MB.
    // Plan 10-03 — full hard-fail integration: slide.cancel() pushes CTRL_CAN
    // and recoverHardFail() converges on force_idle + setWireOwner('terminal').
    if (currentFile.bytesDone > MAX_FILE_SIZE) {
        console.error(`[slide-recv] file ${currentFile.name} exceeded MAX_FILE_SIZE (${MAX_FILE_SIZE} bytes); cancelling`);
        if (slideRef && typeof slideRef.cancel === 'function') slideRef.cancel();
        recoverHardFail('file too large');
    }
}

function onRecvFileDone() {
    if (!currentFile) return;
    const file = currentFile;
    currentFile = null;
    // Plan 10-05 Rule 1 fix — chain through downloadDispatchTail so multiple
    // EOF events draining in the same dispatch loop are serialised; each
    // assembleAndDownload only starts after the previous one's
    // lastDownloadAt update. Without this, the SLIDE-19 250 ms inter-file
    // gap is silently violated when files arrive back-to-back.
    const downloadPromise = downloadDispatchTail.then(() => assembleAndDownload(file)).catch((err) => {
        console.error('[slide-recv] assembleAndDownload failed:', err);
    });
    downloadDispatchTail = downloadPromise;
    inflightDownloads.push(downloadPromise);
    // Cleanup once the download settles (Plan 10-03 inflightDownloads array
    // also serves as the cancel-time allSettled target).
    downloadPromise.finally(() => {
        inflightDownloads = inflightDownloads.filter(p => p !== downloadPromise);
    });
}

// ===== Recv view consumers — Pitfall 4 + Pitfall 5 verbatim =====
//
// Pitfall 4 (memory.buffer growth detaches view): wasm grow_memory invalidates
// any Uint8Array backed by the old ArrayBuffer; re-derive the view when
// `wasmRef.memory.buffer !== recvBuffer`.
//
// Pitfall 5 (slice BEFORE await / clear_recv): take an OWNED copy via
// `new Uint8Array(view.subarray(0, len))` BEFORE calling clear_recv() — the
// underlying buffer is shared with wasm and its content is undefined after
// the next feed_chunk.
function sliceRecvBytesToOwned() {
    const len = slideRef.recv_len();
    if (len === 0) return new Uint8Array(0);
    if (wasmRef.memory.buffer !== recvBuffer) {
        recvBuffer = wasmRef.memory.buffer;
        recvView = new Uint8Array(recvBuffer, slideRef.recv_ptr(), RECV_VIEW_CAP);
    }
    const owned = new Uint8Array(recvView.subarray(0, len));   // copy BEFORE clear
    slideRef.clear_recv();
    return owned;
}

function readRecvFilenameOwned() {
    const len = slideRef.recv_filename_len();
    if (len === 0) return '';
    if (wasmRef.memory.buffer !== filenameBuffer) {
        filenameBuffer = wasmRef.memory.buffer;
        filenameView = new Uint8Array(filenameBuffer, slideRef.recv_filename_ptr(), FILENAME_VIEW_CAP);
    }
    const slice = filenameView.subarray(0, len);
    return filenameDecoder.decode(slice);   // latin1 — never throws (Open Question 5)
}

// ===== Download dispatch =====
//
// W4 — actually serialise the SLIDE-19 inter-file gap. Compute wait BEFORE
// the click (not fire-and-forget after); update lastDownloadAt AFTER the
// click. Both branches (folder-save and anchor-click) honour the gap so
// multi-file Chrome download throttle is avoided.
async function assembleAndDownload(file) {
    const blob = new Blob(file.chunks, { type: 'application/octet-stream' });
    // W4 — actually serialise the SLIDE-19 inter-file gap.
    // Compute wait BEFORE the click, not fire-and-forget after.
    const sinceLast = Date.now() - lastDownloadAt;
    const wait = Math.max(0, INTER_FILE_GAP_MS - sinceLast);
    if (wait > 0) await delay(wait);

    if (prefsRef.slideRecvToFolder && !sessionFolderFallback) {
        try {
            await downloadToFolder(file.name, blob);
            lastDownloadAt = Date.now();
            return;
        } catch (e) {
            console.warn('[slide-recv] downloadToFolder failed; falling back to anchor:', e);
            // Fall through to anchor.
        }
    }
    downloadViaAnchor(file.name, blob);
    lastDownloadAt = Date.now();
}

function downloadViaAnchor(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function downloadToFolder(filename, blob) {
    let dirHandle = cachedHandle || (idbRef ? await idbRef.getRecvDirHandle() : null);
    if (dirHandle && cachedHandle !== dirHandle) cachedHandle = dirHandle;
    if (!dirHandle) {
        // No handle yet — Plan 10-04 wires showDirectoryPicker via the
        // [Choose folder…] button. If we land here mid-recv without a
        // handle, fall back to anchor (D-04 — picker prompt requires user
        // gesture which the recv path doesn't have).
        sessionFolderFallback = true;
        downloadViaAnchor(filename, blob);
        return;
    }
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
        const ask = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (ask !== 'granted') {
            sessionFolderFallback = true;
            downloadViaAnchor(filename, blob);
            return;
        }
    }
    const uniqueName = await ensureUnique(dirHandle, filename);
    if (uniqueName === null) {
        console.warn(`[slide-recv] ${filename}: ~999 collisions; falling back to anchor`);
        downloadViaAnchor(filename, blob);
        return;
    }
    const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(blob);
    await writer.close();
}

// ensureUnique — CONTEXT D-05 — split on last '.', insert ~N before the dot.
// Returns the unique candidate name on success, or null on ~999 exhaustion
// (caller falls through to anchor-click per T-10-04 mitigation).
async function ensureUnique(dir, name) {
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0
        ? [name.slice(0, dot), name.slice(dot)]
        : [name, ''];
    for (let n = 0; n <= SUFFIX_RETRY_BUDGET; n++) {
        const candidate = n === 0 ? name : `${base}~${n}${ext}`;
        try {
            await dir.getFileHandle(candidate, { create: false });
            // Exists — try next.
        } catch (e) {
            if (e.name === 'NotFoundError') return candidate;
            throw e;
        }
    }
    return null;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===== Cancel sequence — ADR-003 §3 (Plan 10-03) =====
//
// Verbatim from CONTEXT.md "Cancel sequence pseudocode":
//   1. await Promise.race([Promise.allSettled(inflightDownloads), delay(200)])
//   2. slide.cancel() pushes CTRL_CAN (0x18) to outbound_buf
//      drainSlideOutboundOneShot() — 1-byte writeSlideFrame fire-and-forget
//   3. const echoArrived = await waitForState(STATE_DONE, 500)
//   4. await delay(100)
//   5. if (!echoArrived) slide.force_idle()   // ADR-003 §3 escape hatch
//      forceExitRecvMode()
//
// 2000 ms Promise.race wraps the entire sequence (absolute escape hatch).
// NEVER calls reader.cancel() or port.close() — keeps terminal session alive.
//
// Idempotency guards (T-10-cancel-race):
//   - cancelInFlight boolean (module-scope) — second call returns early.
//   - slide.cancel() also idempotent (Phase 7 D-06; state.rs:332-348).
//   - !isSlideActive() guard — no-op if no active recv session.
export async function cancelSlideRecv() {
    if (cancelInFlight) return;
    if (!isSlideActive()) return;
    cancelInFlight = true;

    // Absolute timeout escape hatch (ADR-003 §3 — 2 s wraps the whole sequence).
    const absoluteTimeout = setTimeout(() => {
        console.warn('[slide-recv] cancel absolute timeout (2s); force_idle');
        if (slideRef && typeof slideRef.force_idle === 'function') slideRef.force_idle();
        forceExitRecvMode();
    }, CANCEL_ABSOLUTE_TIMEOUT_MS);

    try {
        // Step 1 — settle in-flight writes (200 ms cap).
        await Promise.race([
            Promise.allSettled(inflightDownloads),
            delay(CANCEL_INFLIGHT_TIMEOUT_MS),
        ]);
        // Step 2 — push CTRL_CAN onto outbound (slide.cancel pushes 0x18).
        if (slideRef && typeof slideRef.cancel === 'function') {
            slideRef.cancel();
        }
        drainSlideOutboundOneShot();    // 1-byte writeSlideFrame fire-and-forget
        // Step 3 — wait up to 500 ms for Z80 echo (state transitions Done).
        const echoArrived = await waitForState(STATE_DONE, CANCEL_ECHO_WAIT_MS);
        // Step 4 — drain 100 ms post-echo.
        await delay(CANCEL_DRAIN_MS);
        // Step 5 — if no echo, force_idle escape hatch (ADR-003 §3).
        if (!echoArrived && slideRef && typeof slideRef.force_idle === 'function') {
            slideRef.force_idle();
        }
        clearTimeout(absoluteTimeout);
        forceExitRecvMode();
    } catch (e) {
        clearTimeout(absoluteTimeout);
        console.error('[slide-recv] cancel sequence threw:', e);
        if (slideRef && typeof slideRef.force_idle === 'function') slideRef.force_idle();
        forceExitRecvMode();
    } finally {
        cancelInFlight = false;
    }
}

// drainSlideOutboundOneShot — 1-byte CTRL_CAN write for the cancel path.
// Pitfall 4 — re-derive view (one-shot; we don't cache the outbound view here
// because slide.js owns the cached outbound view and we don't want to interfere
// with its module-scope state).
function drainSlideOutboundOneShot() {
    if (!slideRef) return;
    if (typeof slideRef.outbound_len !== 'function') return;
    const len = slideRef.outbound_len();
    if (len === 0) return;
    const outboundView = new Uint8Array(wasmRef.memory.buffer, slideRef.outbound_ptr(), len);
    const owned = new Uint8Array(outboundView);
    if (txSinkRef && typeof txSinkRef.writeSlideFrame === 'function') {
        txSinkRef.writeSlideFrame(owned);
    }
    if (typeof slideRef.clear_outbound === 'function') slideRef.clear_outbound();
}

// waitForState — poll slideRef.state() every 10 ms; resolve true on match,
// false on timeout. Used by the cancel sequence Step 3 to detect Z80 echo
// (Done state) within 500 ms.
function waitForState(targetState, timeoutMs) {
    return new Promise((resolve) => {
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const tick = () => {
            if (slideRef && slideRef.state() === targetState) return resolve(true);
            if (now() - t0 >= timeoutMs) return resolve(false);
            setTimeout(tick, 10);
        };
        tick();
    });
}

// forceExitRecvMode — flip TX-sink wire owner back to terminal + clear
// per-session bookkeeping (currentFile, sessionFolderFallback, inflightDownloads).
// Plan 10-05 Rule 1 fix — also synchronously flip slide.js's `mode` flag
// via dispatcherForceExitRef so the dispatcher returns to terminal mode
// without waiting for the next inbound chunk to trigger maybeExitRecvMode.
function forceExitRecvMode() {
    if (txSinkRef && typeof txSinkRef.setWireOwner === 'function') {
        txSinkRef.setWireOwner('terminal');
    }
    if (typeof dispatcherForceExitRef === 'function') {
        dispatcherForceExitRef();
    }
    currentFile = null;
    sessionFolderFallback = false;
    inflightDownloads = [];
}

// slidePumpOnPortLost — port lost mid-recv (T-10-port-lost).
// CONTEXT Discretion default: 5-line minimum (force_idle + console.warn +
// forceExitRecvMode). Phase 11 SLIDE-32 will replace with chip-emitting logic.
// Without this real impl, port loss leaves SM stuck in DataPhase; with it,
// the next reload + reconnect starts cleanly.
export function slidePumpOnPortLost() {
    if (slideRef && typeof slideRef.force_idle === 'function') {
        slideRef.force_idle();
    }
    console.warn('[slide-recv] port lost — force_idle + setWireOwner(terminal)');
    forceExitRecvMode();
}

// recoverHardFail — 3-mode convergence (T-10-hard-fail):
//   - NAK_BUDGET exhausted (Phase 7 state.rs:392-406)
//   - port lost (slidePumpOnPortLost)
//   - wire desync (CancelPending silent-drain)
// All converge on slide.force_idle() + setWireOwner('terminal') + console.error.
// Phase 11 SLIDE-29 attaches the visible "Retry" chip surface.
//
// Phase 10 review CR-02 — drain outbound BEFORE force_idle so any control byte
// pre-pushed by the caller (e.g. CTRL_CAN from a preceding slide.cancel() in
// the file-too-large hard-fail branch) actually reaches the wire. Without
// this drain, force_idle() at state.rs:377-380 clears outbound_buf and the
// Z80 sender never observes the cancel — wire desync until next ESC^SLIDE.
export function recoverHardFail(reason) {
    console.error(`[slide-recv] hard-fail: ${reason}; resetting`);
    // Ship any pending control bytes (e.g. CTRL_CAN from a preceding cancel())
    // BEFORE force_idle wipes the outbound buffer. This is fire-and-forget
    // (drainSlideOutboundOneShot does writeSlideFrame, not Awaitable) so the
    // hard-fail path stays synchronous and idempotent.
    drainSlideOutboundOneShot();
    if (slideRef && typeof slideRef.force_idle === 'function') {
        slideRef.force_idle();
    }
    forceExitRecvMode();
}

// ===== Test introspection =====
export function __resetForTests() {
    currentFile = null;
    inflightDownloads = [];
    cancelInFlight = false;
    sessionFolderFallback = false;
    lastDownloadAt = 0;
    // Plan 10-05 Rule 1 fix — reset the dispatch-tail chain so a stale
    // promise from a prior test does not block the next one.
    downloadDispatchTail = Promise.resolve();
    recvBuffer = null;
    recvView = null;
    filenameBuffer = null;
    filenameView = null;
    cachedHandle = null;
    currentPermission = null;
}

export function __getStateForTests() {
    return {
        currentFilename: currentFile?.name ?? null,
        bytesInFileDone: currentFile?.bytesDone ?? 0,
        bytesInFileTotal: currentFile?.totalBytes ?? 0,
        recvToFolder: prefsRef?.slideRecvToFolder ?? false,
        cancelInFlight,
        sessionFolderFallback,
        lastDownloadAt,
        hasHandle: !!cachedHandle,
        handleName: cachedHandle?.name ?? null,
        permission: currentPermission,
    };
}
