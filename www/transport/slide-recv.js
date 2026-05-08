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

// EVT_* mirror — Plan 10-03's slide.js wires these via dispatch on kind.
// (Plan 10-02 needs these constants for onRecvEvent's switch.)
// Pinned in lockstep with crates/bestialitty-core/src/slide/framer.rs +
// tests/slide_wasm_boundary_shape.rs::slide_event_constants_pinned_for_phase_8_jsmirror.
const EVT_HEADER_RECEIVED = 11 << 16;
const EVT_RECV_DATA       = 12 << 16;
const EVT_RECV_FILE_DONE  = 13 << 16;

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
let recvBuffer = null;             // memory.buffer reference for view re-derivation
let recvView = null;
let filenameBuffer = null;
let filenameView = null;
let cachedHandle = null;           // Plan 10-04 populates via showDirectoryPicker
let currentPermission = null;      // Plan 10-04 populates via queryPermission
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
    // Plan 10-02 leaves DOM event handlers unwired; Plan 10-04 (Settings UI)
    // adds change/click listeners when toggleEl + folderButtonEl are non-null.
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
export function isSlideActive() {
    if (!slideRef) return false;
    const st = slideRef.state();
    return st !== STATE_IDLE && st !== STATE_DONE && st !== STATE_ERROR;
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
    if (currentFile.bytesDone > MAX_FILE_SIZE) {
        console.error(`[slide-recv] file ${currentFile.name} exceeded MAX_FILE_SIZE (${MAX_FILE_SIZE} bytes); resetting`);
        // Plan 10-02 leaves this as a soft reset; Plan 10-03 will integrate
        // slide.cancel() + recoverHardFail for proper hard-fail recovery.
        currentFile = null;
    }
}

function onRecvFileDone() {
    if (!currentFile) return;
    const file = currentFile;
    currentFile = null;
    const downloadPromise = assembleAndDownload(file);
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

// ===== STUB exports — Plan 10-03 fills these =====
export async function cancelSlideRecv() {
    throw new Error('cancelSlideRecv not implemented until Plan 10-03');
}

export function slidePumpOnPortLost() {
    // Plan 10-03 wires the 5-line minimum (force_idle + setWireOwner('terminal')).
    // Phase 11 SLIDE-32 will replace with chip-emitting logic.
}

export function recoverHardFail(reason) {
    // Plan 10-03 wires the 3-mode convergence (NAK budget / port lost / wire desync).
    console.error(`[slide-recv] hard-fail STUB: ${reason}`);
}

// ===== Test introspection =====
export function __resetForTests() {
    currentFile = null;
    inflightDownloads = [];
    cancelInFlight = false;
    sessionFolderFallback = false;
    lastDownloadAt = 0;
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
