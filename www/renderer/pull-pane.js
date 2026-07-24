// Beastty Epic E9 Story S9.1a — Local Folder Pull Pane shell (FR-1/2/3, NFR-2/4/5).
//
// A persistent, gutter-docked chrome component that binds SLIDE-recv's folder,
// lists its files one level deep, and handles the first-run / permission-needed /
// empty states. Built on the www/renderer/scroll-state.js / slide-chip.js template
// (AD-1/AD-2): module-scope state + wirePullPane(opts) → API + a private render()
// projecting state via data-view / [hidden] only + dispose() + the test hooks.
//
// Scope: S9.1a shell (first-run / permission / empty / list views) PLUS the S9.1b
// refresh layer — the four triggers (transfer-done / window focus / ~60s timer /
// manual ↻) all funnelled through one guarded triggerRefresh, plus FR-10 diff-render
// (unchanged enumeration → zero DOM churn; new arrivals marked fresh) — PLUS the
// S9.2 selection→SLIDE S layer: beginReview(text) tokenizes a selection string,
// validates each token against the injected CP/M helpers, composes the SLIDE S
// command, and opens the in-pane review sub-state (confirm → one pushTxBytes of
// command + Enter terminator, refused while a SLIDE session is active or no
// serial writer is registered; cancel → nothing) — PLUS the S9.3 drop layer:
// onSelectionDrag(state) receives the terminal-selection drag state from
// main.js (fed by selection.js's onSelectionDragState observer, never imported),
// the pane's dragenter/over/leave/drop handlers show the UX-DR3 affordance and
// route a drop into beginReview, and the narrow-window rail blooms the card
// open as a zero-layout-shift overlay (data-bloom) — PLUS the S9.4 reverse
// drag: file rows are native drag sources whose payload is the row's real File
// (resolved via handle.getFile(), prefetched at pointerdown, attached with
// dataTransfer.items.add at dragstart). Chromium's REAL drag loop strips a
// JS-constructed File from the drag data store (platform serialization
// degrades it to a text/plain filename — verified 2026-07-24), so the handoff
// is the sanctioned fallback (story e9-4 Dev Notes): the pane's own guarded
// dragover/drop handlers on the injected #terminal-wrapper call the injected
// file-source sendFiles() with the stashed File. If a drag ever DOES carry a
// real 'Files' payload (OS drags; a future Chromium that preserves added
// Files), the pane handlers step back and file-source owns the drop.
// The ~60s timer + window-focus listener are set up in wirePullPane
// and torn down in dispose().
//
// Direct-import allowlist (AD-3): this module direct-imports NOTHING from other
// app modules — every dependency (idb, retainFocus, the DOM root, the
// terminal-wrapper) arrives via wirePullPane(opts) from main.js at the
// composition root. It binds EXACTLY SLIDE-recv's persisted recv_directory handle
// (one shared folder, no second destination — AD-11 / Dev Notes "v1 folder
// binding"): on first-run it calls showDirectoryPicker AND idb.setRecvDirHandle
// against the same key recv reads, so they stay consistent.
//
// AD-9 neutral shell: styled with --chrome-* tokens only (in index.html) — no
// phosphor var, no [data-theme] branch. AD-10: every interactive control is
// wired through the injected retainFocus so keystrokes keep flowing to the Z80.
//
// Sources:
//   - epics-pull-pane.md — Story S9.1a (FR-1/2/3, NFR-2/4/5, UX-DR1/DR3).
//   - ARCHITECTURE-SPINE.md — AD-11 (amended), AD-1/2/3/9/10/12.
//   - DESIGN.md {components.pull-pane}; EXPERIENCE.md Voice/Tone + Pull-pane states.
//   - Template: renderer/scroll-state.js:32-165, renderer/slide-chip.js:89-523.
//   - APIs reused: state/idb.js:51-92 (get/setRecvDirHandle); the FSA picker /
//     permission / one-level enumeration patterns from transport/slide-recv.js:276-311.

// ====== Module-scope state ======

// view: 'first-run' | 'permission' | 'empty' | 'list'. (The narrow-window 'rail'
// is a CSS container-query presentation of whichever content view is current — it
// is not a JS state, so it composes with every bound state; see index.html.)
//
// review (S9.2) is a FLAG stored beside view, not a fifth view value: refresh
// paths keep mutating list state underneath (they never write state.review), so
// a background refresh can never evict an open review mid-decision. render()
// prefers it for the data-view projection; the review's own DOM is painted once
// by beginReview (renderReview), never by refresh-triggered render() calls.
// Shape: null | { command: string|null, tokens: [{raw, name, ok, reason}], validCount }.
//
// detail (S10.1) is the same flag pattern as review: stored beside view, its
// DOM painted once by openDetail (renderDetail), projected — never repainted —
// by refresh-triggered render() calls. Opens only from list view with no
// review open. Shape: null | { name, records: string[], crc: string|null,
// error: string|null }.
let state = { folderName: null, permission: 'prompt', files: [], view: 'first-run', review: null, detail: null };

// The bound directory handle (SLIDE-recv's recv_directory). Not persisted here
// beyond the idb.setRecvDirHandle write on the first-run pick.
let dirHandle = null;

// Async epoch. Every entry point that starts a new intent (bindFromIdb/refresh,
// onChoose, onGrant, the test hook, reset) bumps this and captures its value;
// after each await it re-checks before committing to state/render, so a slow
// in-flight read (e.g. an S9.1b refresh() overlapping a folder pick) can never
// clobber a newer result. Callers pass their captured handle down explicitly so
// enumeration is always tied to the pick that triggered it, not to whatever
// dirHandle happens to point at when the loop runs.
let epoch = 0;

// Injected deps (set by wirePullPane — AD-3, nothing direct-imported).
let idbRef = null;
let retainFocusRef = null;
let wrapperRef = null;          // #terminal-wrapper — retainFocus restore target
// S9.2 compose/inject deps — the two filename functions are the ONLY validators
// (no local filename rules in this module); getEnterBytes is a main.js closure
// over CRLF_MODES[getCrlfMode()] read live at confirm time; isWriterReady is
// tx-sink's WR-03 predicate (confirm refuses before a port is connected). All
// are called unguarded: a missing injection is a mis-wired composition root and
// must fail loudly, not degrade (e.g. silently sending a command with no Enter
// terminator).
let validateRef = null, truncateRef = null, pushTxBytesRef = null,
    isSlideActiveRef = null, isWriterReadyRef = null, getEnterBytesRef = null,
    onPullRequestedRef = null,
    sendFilesRef = null,   // S9.4 — file-source send path (sanctioned fallback)
    analyzeCsumRef = null; // S10.1 — pure csum module (renderer/csum.js), injected not imported

// Test override for the injected isSlideActive (null = use the injected one).
// Mirrors the __setDirHandleForTests approach to unhostable browser state.
let slideActiveOverride = null;

// DOM refs derived from the injected #pull-pane root in wire.
let paneRootEl = null, cardEl = null, fnameEl = null, capEl = null, capLabelEl = null,
    countEl = null, listEl = null, blankEl = null, blankMsgEl = null,
    chooseBtn = null, grantBtn = null, footEl = null, badgeEl = null, refreshBtn = null,
    reviewEl = null, cmdlineEl = null, cmdTextEl = null, nothingEl = null,
    tokListEl = null, actionsEl = null, cancelBtn = null, confirmBtn = null,
    railEl = null,
    detailEl = null, detailTitleEl = null, detailRowsEl = null, detailBackBtn = null;

// ====== S9.3 — selection-drag / drop-affordance / bloom state ======

// The in-app selection drag currently pending over the app, as reported by
// selection.js via main.js (onSelectionDrag). The accept predicate keys off
// selDrag.active — set ONLY by our own dragstart — so OS file drags and
// foreign text drags over the pane fall through untouched.
let selDrag = { active: false, text: '', validCount: 0 };
// dragenter/dragleave fire per descendant; depth-count so the affordance only
// clears on leave-to-zero (file-source.js dragDepth precedent).
let dropDepth = 0;
let dropAffordanceOn = false;
// Rail bloom (FR-2). bloomedByClick tracks whether the document-level
// pointerdown-outside listener is installed (only the click-bloom case
// dismisses that way).
let bloomed = false;
let bloomedByClick = false;

// ====== S9.4 — reverse-drag stash (FR-12) ======

// dataTransfer accepts a payload only synchronously inside dragstart, but
// handle.getFile() is async — so a primary-button pointerdown on a row starts
// the resolves and dragstart consumes them. Shape: null | {names: string[],
// want: number, files: File[]} — armed when non-null, ready when
// files.length === want. Re-resolved per gesture, never cached across drags
// (a file replaced on disk between drags must send fresh bytes). Independent
// of selDrag: that is the terminal-selection drag INTO the pane; this is a
// file drag OUT of it.
let dragOut = null;
// True from a successful dragstart until dragend — a native drag session is
// in flight. Chromium fires pointercancel when the native drag begins, and
// that pointercancel must NOT clear the stash (the drop side still reads it);
// every other pointercancel (touch pan) and any pointerup that never reaches
// listEl (release outside the list) must, or the armed stash outlives its
// gesture and a later unrelated text drag over the terminal would claim it.
let dragOutInFlight = false;
// Depth counter for the wrapper drop affordance during a reverse drag
// (dragenter/leave fire per descendant — file-source.js dragDepth precedent).
let wrapDropDepth = 0;

// Multi-select (S9.4 extension, user-requested 2026-07-24): plain click
// selects one row, ctrl/cmd-click toggles, shift-click extends from the
// anchor in RENDERED order (fresh-first, then name-asc), empty-area click
// clears. Dragging a selected row drags the whole selection; dragging an
// unselected row reselects to just it first (filer convention). Selection
// lives on names, survives refreshes (pruned to files that still exist), and
// resets with every new-folder intent.
let selectedNames = new Set();
let selAnchor = null;
// A plain pointerdown on an ALREADY-selected row must not collapse the
// selection immediately (the gesture may be a drag of the group) — filers
// collapse on the mouse-up that turns out to be a plain click. pointercancel
// (fired when a native drag starts) never runs the collapse.
let pendingCollapse = null;

// ====== S10.1 — host-side checksum column (FR-1/2/3, NFR-3) ======

// Whole-file CRC-32 cache, keyed by content identity `${name}:${size}:${lastModified}`
// — NOT by view. Session-lifetime, in-memory only (no idb — story scope).
// Successes only; a read failure is shown as '—' but never cached, so the next
// refresh retries it.
let csumCache = new Map();
// What each row's .pp-cs cell currently shows (name → 8-hex | '…' | '—').
// The test hook derives `csums` from this ∩ state.files.
let csumShown = new Map();
// Sequential fill queue: one getFile()/arrayBuffer() at a time across ALL fill
// passes (no I/O stampede on large folders). Each pass chains onto the tail.
let fillChain = Promise.resolve();

const CSUM_PENDING = '…';
const CSUM_FAIL = '—';

function csumKey(f) { return `${f.name}:${f.size}:${f.lastModified}`; }

// Verbatim microcopy (EXPERIENCE.md — do NOT paraphrase).
const COPY = {
    firstRun: 'No folder chosen. Pulled files land here.',
    permission: 'Permission needed to read this folder.',
    empty: 'Empty — pulled files will appear here.',
    boundCaption: 'Local folder',
    reviewCaption: 'Review — pull to this folder',
    // S9.3 — resting footer (restored when the drop affordance clears) and the
    // drop-active footer prefix (EXPERIENCE.md:130 — "⤓ Drop to pull 2 files").
    footResting: 'Drag a filename selection here to pull',
    footDropPrefix: '⤓ Drop to pull ',
    // S10.1 — checksum column + detail view (story e10-1 verbatim-copy block).
    csumTip: 'CRC-32 — matches CSUM / csumhost',
    detailTip: 'Per-record checksums (CSUM -V)',
    detailReadFail: "Couldn't read this file.",
};

// Verbatim skip reason for tokens that fail the 8.3 idempotence check
// (EXPERIENCE.md:133 / mockup pull-pane.html:282 — do NOT paraphrase). Tokens
// rejected by validateCpmFilename surface its specific reason instead.
const REASON_83 = 'Not a CP/M 8.3 name (name ≤8, ext ≤3, uppercase). v1 only pulls 8.3 names.';

// S9.3 (AC-7, deferred from the S9.2 code review) — the composed command must
// stay within the standard CP/M CCP line buffer (~127 chars); 126 leaves margin
// for the terminator. Otherwise-valid names that would push past it are skipped
// with this reason (proposed copy, no sourced wording — flag in review if reworded).
const MAX_COMMAND_CHARS = 126;
const REASON_LIMIT = 'over the 126-char CP/M command-line limit';
// The command shape, single-sourced for both the cap arithmetic and the final
// join — SLIDE-UAT.md UAT-E9-01 checks (a)/(b) anticipate hardware changing
// the separator (space → comma) or prefix (B:SLIDE S); each is one line here.
const CMD_PREFIX = 'SLIDE S ';
const CMD_SEP = ' ';

const FSA_OPTS = { mode: 'readwrite' };

// ====== S9.1b refresh machinery (FR-8/9/10) ======

// The ~60s repeating trigger (FR-8c). Chromium throttles hidden-tab intervals,
// and the tick's own guard skips work while hidden/ungranted — no visibilitychange
// listener needed. Started in wirePullPane, cleared in dispose.
const REFRESH_INTERVAL_MS = 60_000;
let refreshTimer = null;

// FR-10 diff-render bookkeeping. lastSnapshot is the [{name,size}] (name-asc) of
// the list currently on screen; a re-enumeration equal to it performs ZERO list
// DOM mutation. freshNames is the set added by the latest content-changing refresh
// (they sort to the top with the mint marker). Both reset on every NEW-folder /
// grant / bind intent (so the first enumeration after bind marks nothing fresh),
// but NOT on a trigger — that is what lets a trigger detect arrivals.
let lastSnapshot = null;
let freshNames = new Set();

function resetDiffBaseline() {
    lastSnapshot = null;
    freshNames = new Set();
    // Every caller is a new-folder/reset intent (bind / choose / grant / test
    // bind / test reset) — a fresh folder starts with a fresh selection too.
    selectedNames = new Set();
    selAnchor = null;
    pendingCollapse = null;
    // S10.1 — and a fresh checksum slate: the cache key (name:size:mtime) has
    // no folder identity, so an entry surviving a rebind could hand a
    // same-named, same-stamped file in ANOTHER folder the old folder's CRC
    // without a read — the exact corruption the column exists to expose.
    resetCsumState();
}

// S10.1 — shared csum teardown (rebind / test reset / dispose). Callers bump
// the epoch first, which already makes any in-flight fill write nothing;
// detaching the chain keeps a parked read from blocking the next intent's.
function resetCsumState() {
    csumCache = new Map();
    csumShown = new Map();
    fillChain = Promise.resolve();
}

export function wirePullPane(opts) {
    ({
        paneEl: paneRootEl, idb: idbRef, retainFocus: retainFocusRef, terminalWrapper: wrapperRef,
        // S9.2 (AC-7) — compose/inject deps arrive here from main.js, never imported.
        validateCpmFilename: validateRef, truncateCpm83: truncateRef,
        pushTxBytes: pushTxBytesRef, isSlideActive: isSlideActiveRef,
        isWriterReady: isWriterReadyRef, getEnterBytes: getEnterBytesRef,
        // Optional — confirmed-pull batch-size hint. main.js routes it to the
        // SLIDE dispatcher so the transfer chip can show "N/M" for pulls
        // (the wire protocol itself never announces the batch size).
        onPullRequested: onPullRequestedRef,
        // S9.4 — file-source's send path for the reverse-drag handoff
        // (sanctioned fallback; see the header note and story e9-4 Dev Notes).
        sendFiles: sendFilesRef,
        // S10.1 — the pure csum module's analyzeCsum. Called unguarded, like
        // the validators above: a missing injection is a mis-wired composition
        // root and must fail loudly.
        analyzeCsum: analyzeCsumRef,
    } = opts);

    // Derive child refs from the injected root (no cross-module document reach).
    cardEl = paneRootEl.querySelector('.pp-card');
    fnameEl = paneRootEl.querySelector('#pull-pane-fname');
    capEl = paneRootEl.querySelector('#pull-pane-cap');
    capLabelEl = paneRootEl.querySelector('#pull-pane-cap-label');
    countEl = paneRootEl.querySelector('#pull-pane-count');
    listEl = paneRootEl.querySelector('#pull-pane-list');
    blankEl = paneRootEl.querySelector('#pull-pane-blank');
    blankMsgEl = paneRootEl.querySelector('#pull-pane-blank-msg');
    chooseBtn = paneRootEl.querySelector('#pull-pane-choose');
    grantBtn = paneRootEl.querySelector('#pull-pane-grant');
    footEl = paneRootEl.querySelector('#pull-pane-foot');
    // COPY.footResting is the single source for the resting hint (the drop
    // affordance restores from it); sync the static HTML copy to it at wire
    // time so the two can never drift.
    if (footEl) footEl.textContent = COPY.footResting;
    badgeEl = paneRootEl.querySelector('#pull-pane-badge');
    refreshBtn = paneRootEl.querySelector('#pull-pane-refresh');
    reviewEl = paneRootEl.querySelector('#pull-pane-review');
    cmdlineEl = paneRootEl.querySelector('#pull-pane-cmdline');
    cmdTextEl = paneRootEl.querySelector('#pull-pane-cmdtext');
    nothingEl = paneRootEl.querySelector('#pull-pane-nothing');
    tokListEl = paneRootEl.querySelector('#pull-pane-toklist');
    actionsEl = paneRootEl.querySelector('#pull-pane-actions');
    cancelBtn = paneRootEl.querySelector('#pull-pane-cancel');
    confirmBtn = paneRootEl.querySelector('#pull-pane-confirm');
    railEl = paneRootEl.querySelector('.pp-rail');
    // S10.1 — detail sub-state refs.
    detailEl = paneRootEl.querySelector('#pull-pane-detail');
    detailTitleEl = paneRootEl.querySelector('#pull-pane-detail-title');
    detailRowsEl = paneRootEl.querySelector('#pull-pane-detail-rows');
    detailBackBtn = paneRootEl.querySelector('#pull-pane-detail-back');

    // AD-10 — every interactive control retains #terminal-wrapper focus. All are
    // buttons (the mousedown→preventDefault branch, restoreTarget unused for that
    // branch) but the wrapper is passed for explicitness + forward-compat.
    if (chooseBtn) { retainFocusRef(chooseBtn, wrapperRef); chooseBtn.addEventListener('click', onChoose); }
    if (grantBtn) { retainFocusRef(grantBtn, wrapperRef); grantBtn.addEventListener('click', onGrant); }
    // Manual ↻ (EXPERIENCE.md:254) — same guarded path as the other triggers.
    if (refreshBtn) { retainFocusRef(refreshBtn, wrapperRef); refreshBtn.addEventListener('click', triggerRefresh); }
    // S9.2 review actions — same retainFocus wiring as choose/grant (AD-10).
    if (cancelBtn) { retainFocusRef(cancelBtn, wrapperRef); cancelBtn.addEventListener('click', onReviewCancel); }
    if (confirmBtn) { retainFocusRef(confirmBtn, wrapperRef); confirmBtn.addEventListener('click', onReviewConfirm); }
    // S10.1 — detail back button + the delegated per-row ⁞ handlers (buttons
    // are rebuilt with the rows; container listeners survive them all, where
    // per-button wiring would re-register N listeners + N focus.js registry
    // entries on every rebuild).
    if (detailBackBtn) { retainFocusRef(detailBackBtn, wrapperRef); detailBackBtn.addEventListener('click', closeDetail); }
    if (listEl) {
        listEl.addEventListener('click', onListDetailClick);
        listEl.addEventListener('mousedown', onListDetailMousedown);
    }

    // S9.3 — drop target (AC-2/3/4). DOM events only, no new imports (AD-3).
    // Handlers early-return unless an in-app selection drag is acceptable, so
    // OS file drags / foreign text drags fall through untouched (no
    // preventDefault → browser shows no-drop).
    paneRootEl.addEventListener('dragenter', onPaneDragEnter);
    paneRootEl.addEventListener('dragover', onPaneDragOver);
    paneRootEl.addEventListener('dragleave', onPaneDragLeave);
    paneRootEl.addEventListener('drop', onPaneDrop);
    // S9.3 — rail click blooms the card open (FR-2). The rail became a click
    // surface here, so it goes through retainFocus like every other pane
    // control (AD-10): its mousedown is suppressed, keeping #terminal-wrapper
    // focused while the bloom paints.
    if (railEl) { retainFocusRef(railEl, wrapperRef); railEl.addEventListener('click', onRailClick); }

    // S9.4 — reverse-drag origination, delegated on the rows container. Rows
    // are the sanctioned EXCEPTION to the AD-10 every-control retainFocus rule:
    // retainFocus preventDefault()s mousedown, which also suppresses native
    // drag initiation (S9.3 hit this from the canvas side; story e9-4 "Focus").
    // So a row pointerdown blurs #terminal-wrapper; onRowDragEnd restores it,
    // and a completed drop re-routes focus through the send modal's own
    // openModal/restoreTo flow.
    if (listEl) {
        listEl.addEventListener('pointerdown', onRowPointerDown);
        listEl.addEventListener('pointerup', onRowPointerUp);
        listEl.addEventListener('dragstart', onRowDragStart);
        listEl.addEventListener('dragend', onRowDragEnd);
        // Second-chance cleanup for gestures the listEl handlers never see:
        // a release outside the list, or a touch pan's pointercancel. Without
        // these the armed stash survives the gesture (and the wrapper stays
        // blurred, dropping keystrokes) until the next row click.
        window.addEventListener('pointerup', onWindowPointerRelease);
        window.addEventListener('pointercancel', onWindowPointerRelease);
    }
    // S9.4 — the reverse-drag drop side (sanctioned fallback). The wrapper is
    // an injected opt (AD-3); the handlers are inert unless OUR stash is armed
    // and the drag carries no real 'Files' payload, so file-source's own
    // handlers on the same element never see a competing preventDefault.
    if (wrapperRef) {
        wrapperRef.addEventListener('dragenter', onWrapperDragEnter);
        wrapperRef.addEventListener('dragover', onWrapperDragOver);
        wrapperRef.addEventListener('dragleave', onWrapperDragLeave);
        wrapperRef.addEventListener('drop', onWrapperDrop);
    }

    // FR-8 triggers: the ~60s timer + window focus. Both route through the one
    // guarded triggerRefresh; the transfer-done trigger arrives via refresh() from
    // slide-recv's onFileLanded. (chrome.js owns document listeners; the pane owns
    // its own like slide-chip owns its interval.) Tear down any prior wiring first
    // (retainFocus is already idempotent via its WeakSet) so a re-wire — hot reload
    // or a second wirePullPane — never stacks a duplicate timer + focus listener.
    if (refreshTimer) clearInterval(refreshTimer);
    window.removeEventListener('focus', triggerRefresh);
    refreshTimer = setInterval(triggerRefresh, REFRESH_INTERVAL_MS);
    window.addEventListener('focus', triggerRefresh);

    // Paint first-run synchronously (no flash of a blank pane) …
    render();
    // … then hydrate from idb (async): getRecvDirHandle → view.
    bindFromIdb();

    return {
        render,
        refresh: triggerRefresh,   // FR-8a transfer-done trigger (main.js onFileLanded).
        beginReview,               // S9.2 entry point (now also the S9.3 drop path).
        onSelectionDrag,           // S9.3 — selection drag state from main.js (AC-8);
                                   // doubles as the test entry point (specs call it directly).
        dispose,
        __getStateForTests,
        __resetForTests,
        __setDirHandleForTests,
        __setSlideActiveForTests,  // S9.2 NFR-4 — overrides the injected isSlideActive.
        __timerTickForTests,       // NFR-4 — runs the guarded tick body awaitably.
    };
}

// triggerRefresh — the ONE guarded refresh path shared by all four triggers
// (transfer-done / window focus / ~60s timer / manual ↻). While the tab is hidden
// we do nothing at all (FR-9): no IDB re-read, no queryPermission, no enumeration —
// a backgrounded tab is not a user waiting on a fresh list. When visible: no bound
// handle yet → a cheap IDB re-read (also surfaces a folder bound through SLIDE-recv's
// own picker within a tick — the shared recv_directory key). Otherwise skip silently
// while permission isn't granted (never prompts — no user gesture, FR-9), else
// re-enumerate the CURRENT handle under a fresh epoch so an overlapping slow read
// can never clobber a newer result (NFR-2).
async function triggerRefresh() {
    if (document.hidden) return;
    // A rebuild while a reverse-drag gesture is armed would detach the drag-
    // source row: dragend then never bubbles to listEl's delegated handler,
    // stranding the stash and the blurred wrapper. Skip this tick — the next
    // trigger (timer / focus / transfer-done / manual) lands after the
    // gesture resolves.
    if (dragOut) return;
    if (!dirHandle) { await bindFromIdb(); return; }
    if (state.permission !== 'granted') return;
    const gen = ++epoch;
    await enumerateAndRender(dirHandle, gen);
}

// Test hook — runs the guarded timer-tick body (the exact triggerRefresh path a
// ~60s tick would run), awaitable so specs can assert enumeration / guard skips.
function __timerTickForTests() { return triggerRefresh(); }

// bindFromIdb — read SLIDE-recv's persisted handle; null → first-run, else evaluate.
async function bindFromIdb() {
    const gen = ++epoch;
    resetDiffBaseline();   // a (re)bind is a fresh baseline — nothing is "fresh"
    let handle = null;
    try {
        if (idbRef && typeof idbRef.getRecvDirHandle === 'function') {
            handle = await idbRef.getRecvDirHandle();
        }
    } catch (e) {
        console.warn('[pull-pane] getRecvDirHandle failed:', e);
        handle = null;
    }
    if (gen !== epoch) return;   // a newer bind/pick superseded this read
    if (!handle) { dirHandle = null; setFirstRun(); return; }
    dirHandle = handle;
    await evaluateHandle(handle, gen);
}

// evaluateHandle — queryPermission (no gesture needed); granted → enumerate + list,
// otherwise → permission-needed state. Never throws (AC-5).
async function evaluateHandle(handle, gen) {
    if (!handle) { setFirstRun(); return; }
    let perm = 'prompt';
    try {
        perm = await handle.queryPermission(FSA_OPTS);
    } catch (e) {
        console.warn('[pull-pane] queryPermission failed:', e);
        perm = 'prompt';
    }
    if (gen !== epoch) return;   // superseded during the permission query
    state.folderName = handle.name || 'folder';
    state.permission = perm;
    if (perm === 'granted') {
        await enumerateAndRender(handle, gen);
    } else {
        state.files = [];
        state.view = 'permission';
        render();
    }
}

// enumerateAndRender — one level deep: files only, skip sub-directories (v1). Size
// via getFile().size. Sorted name-ascending. A post-'granted' read failure (folder
// vanished, revoked mid-read) degrades to permission-needed rather than throwing.
async function enumerateAndRender(handle, gen) {
    const files = [];
    try {
        for await (const [name, h] of handle.entries()) {
            if (h.kind !== 'file') continue;
            let size = 0, lastModified = 0;
            // S10.1 — lastModified rides the same getFile() that already reads
            // size; it feeds the checksum cache key only, never the snapshot.
            try { const f = await h.getFile(); size = f.size; lastModified = f.lastModified; } catch { size = 0; }
            // S9.4 — keep the file handle so a row drag can resolve its File.
            // The diff-render snapshot below stays keyed on name+size only: a
            // handle identity change alone must never count as a content change.
            files.push({ name, size, lastModified, handle: h });
        }
    } catch (e) {
        console.warn('[pull-pane] enumerate failed:', e);
        if (gen !== epoch) return;
        state.permission = 'prompt';
        state.files = [];
        state.view = 'permission';
        render();
        return;
    }
    if (gen !== epoch) return;   // a newer intent superseded this enumeration
    files.sort((a, b) => a.name.localeCompare(b.name));

    // FR-10 diff-render. Unchanged (same names + sizes as the on-screen list) →
    // ZERO list DOM mutation: no rebuild, no flicker, no scroll reset, markers
    // untouched. Just keep state truthful and return before render().
    const prevSnap = lastSnapshot;
    if (prevSnap && snapshotsEqual(prevSnap, files)) {
        state.files = files;
        // S10.1 — the same-size-edit trap (story e10-1 Dev Notes): an in-place
        // edit that keeps the size produces exactly this snapshot-equal early
        // return, so the checksum fill MUST run here too or the stale CRC sits
        // on screen forever — the very corruption the column exists to expose.
        // The bumped lastModified makes the cache key miss → recompute →
        // textContent-only cell update, zero row churn.
        kickCsumFill(gen);
        return;
    }
    // Changed → files present now but absent from the previous snapshot are fresh
    // (they sort to the top with the mint marker). No previous snapshot = the
    // first enumeration after bind/choose/grant → nothing is fresh.
    const prevNames = prevSnap ? new Set(prevSnap.map((p) => p.name)) : null;
    freshNames = prevNames
        ? new Set(files.filter((f) => !prevNames.has(f.name)).map((f) => f.name))
        : new Set();
    lastSnapshot = files.map((f) => ({ name: f.name, size: f.size }));
    state.files = files;
    // Multi-select: names that vanished from the folder leave the selection
    // (an unchanged enumeration has identical names — nothing to prune there).
    if (selectedNames.size > 0) {
        const live = new Set(files.map((f) => f.name));
        selectedNames = new Set([...selectedNames].filter((n) => live.has(n)));
        if (selAnchor && !live.has(selAnchor)) selAnchor = null;
    }
    state.view = files.length === 0 ? 'empty' : 'list';
    render();
    // S10.1 — fill pass on EVERY enumeration completion (both exits — see the
    // snapshot-equal branch above). After render() so the cells exist.
    kickCsumFill(gen);
}

// ====== S10.1 — checksum column fill (FR-2/3, NFR-3) ======

// Reconcile every row's .pp-cs cell with the cache, then queue the misses for
// the sequential async fill. Cache hits update synchronously (renderRows
// already painted them; this also catches the snapshot-equal path where no
// rows were rebuilt). Cell writes are textContent-only — never a row rebuild.
function kickCsumFill(gen) {
    // Prune entries whose file (or content identity) is gone — without an
    // owner reconciling them, mtime bumps mint a new key per save and the
    // maps grow for the whole session.
    const liveNames = new Set(state.files.map((f) => f.name));
    for (const n of csumShown.keys()) {
        if (!liveNames.has(n)) csumShown.delete(n);
    }
    const liveKeys = new Set(state.files.map(csumKey));
    for (const k of csumCache.keys()) {
        if (!liveKeys.has(k)) csumCache.delete(k);
    }
    const misses = [];
    for (const f of state.files) {
        if (!f.handle) continue;
        const hit = csumCache.get(csumKey(f));
        if (hit !== undefined) {
            if (csumShown.get(f.name) !== hit) {
                csumShown.set(f.name, hit);
                updateCsumCell(f.name, hit);
            }
        } else {
            misses.push(f);
        }
    }
    if (misses.length > 0) enqueueFill(misses, gen);
}

// Sequential fill: one getFile()/arrayBuffer() at a time, chained onto the
// module-wide queue so overlapping passes never stampede the disk. Every cell
// write re-checks gen === epoch (the E9 discipline) — a stale pass after a
// rebind/new-folder intent writes nothing. Cache writes are keyed by content
// identity, not by view, so they stay valid even from a superseded pass. A
// read failure shows '—' and the loop continues (FR-12) — one bad file never
// blocks the rest — and is NOT cached, so the next refresh retries.
function enqueueFill(misses, gen) {
    fillChain = fillChain.then(async () => {
        for (const f of misses) {
            if (gen !== epoch) return;   // superseded — a newer pass owns the fill
            const key = csumKey(f);
            let value = csumCache.get(key);   // a newer pass may have filled it
            if (value === undefined) {
                try {
                    const file = await f.handle.getFile();
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    value = analyzeCsumRef(bytes).crc;
                    csumCache.set(key, value);
                } catch (e) {
                    console.warn('[pull-pane] checksum read failed:', e);
                    value = CSUM_FAIL;
                }
            }
            if (gen !== epoch) return;   // stale fill writes no cell
            csumShown.set(f.name, value);
            updateCsumCell(f.name, value);
        }
    });
}

// textContent-only mutation of an existing cell — no rebuild, no scroll reset.
function updateCsumCell(name, text) {
    if (!listEl) return;
    const cs = listEl.querySelector(`.pp-row[data-name="${CSS.escape(name)}"] .pp-cs`);
    if (cs) cs.textContent = text;
}

// Snapshot equality — both arrays are name-asc; compare names + sizes positionally.
function snapshotsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].name !== b[i].name || a[i].size !== b[i].size) return false;
    }
    return true;
}

// First-run [Choose folder…] — showDirectoryPicker → persist as recv_directory
// (the shared key) → enumerate. AbortError (user dismissed) is swallowed (D-04).
async function onChoose() {
    const gen = ++epoch;
    resetDiffBaseline();   // new folder → first enumeration marks nothing fresh
    let handle = null;
    try {
        handle = await window.showDirectoryPicker(FSA_OPTS);
    } catch (e) {
        if (e && e.name !== 'AbortError') console.warn('[pull-pane] showDirectoryPicker failed:', e);
        return;   // silent fall-back; no state change
    }
    try {
        if (idbRef && typeof idbRef.setRecvDirHandle === 'function') await idbRef.setRecvDirHandle(handle);
    } catch (e) {
        console.warn('[pull-pane] setRecvDirHandle failed:', e);
    }
    if (gen !== epoch) return;   // superseded while persisting the pick
    dirHandle = handle;
    // Picker resolution implicitly grants permission for the gesture's duration.
    state.folderName = handle.name || 'folder';
    state.permission = 'granted';
    await enumerateAndRender(handle, gen);
}

// Permission-needed [Grant access] — requestPermission runs inside this user
// gesture (per Chrome 122+ guidance); on 'granted', re-read and list.
async function onGrant() {
    const handle = dirHandle;
    if (!handle) return;
    const gen = ++epoch;
    resetDiffBaseline();   // first enumeration after grant marks nothing fresh
    let perm = 'prompt';
    try {
        perm = await handle.requestPermission(FSA_OPTS);
    } catch (e) {
        console.warn('[pull-pane] requestPermission failed:', e);
        return;
    }
    if (gen !== epoch) return;   // superseded during the permission request
    state.permission = perm;
    if (perm === 'granted') await enumerateAndRender(handle, gen);
    else render();
}

function setFirstRun() {
    state.folderName = null;
    state.permission = 'prompt';
    state.files = [];
    state.view = 'first-run';
    render();
}

// ====== S9.3 — drop target + affordance + rail bloom (FR-2/4/6, UX-DR3) ======

// onSelectionDrag — public API + test entry point. main.js feeds it from
// selection.js's onSelectionDragState observer ({active: true, text} on
// dragstart, {active: false} on dragend); specs call it directly to simulate
// drag state.
function onSelectionDrag(dragState) {
    if (dragState && dragState.active) {
        const text = String(dragState.text ?? '');
        // validCount is computed lazily on the first accepted dragenter —
        // a drag that never reaches the pane skips the compose entirely.
        selDrag = { active: true, text, validCount: 0 };
        // FR-2 — a selection drag blooms the rail open so the drop target
        // exists. Not while a detail is open (S10.1): dropAcceptable refuses
        // that drop, and blooming would animate open a card that then shows a
        // no-drop cursor — an invitation AC-7 refuses.
        if (railVisible() && !state.detail) setBloom(true, false);
    } else {
        selDrag = { active: false, text: '', validCount: 0 };
        dropDepth = 0;
        setDropAffordance(false);
        // Un-bloom on dragend — unless the drag ended in a drop that opened the
        // review (the review keeps the bloom until it exits).
        if (bloomed && !state.review) setBloom(false);
    }
}

// Accept predicate — drops are acceptable only while an in-app selection drag
// is active (never OS 'Files' drags or foreign text — selDrag.active is set
// solely by our own dragstart), no SLIDE session owns the wire, and a folder
// is bound + readable (view list|empty; state.view stays truthful under an
// open review, so a drop can replace it — AC-3).
function dropAcceptable() {
    return selDrag.active
        && !slideActiveNow()
        // S10.1 (AC-7) — interim S10.2 boundary: while the detail view is open
        // a terminal-selection drop is refused outright (no affordance, drop
        // inert). S10.2 replaces this branch with CSUM -V diff routing.
        && !state.detail
        && (state.view === 'list' || state.view === 'empty');
}

function onPaneDragEnter(ev) {
    if (!dropAcceptable()) return;
    ev.preventDefault();
    dropDepth++;
    if (dropDepth === 1) {
        // Cap-aware count for the footer copy ("⤓ Drop to pull {n} files").
        selDrag.validCount = composeFromText(selDrag.text).validCount;
        setDropAffordance(true);
    }
}

function onPaneDragOver(ev) {
    if (!dropAcceptable()) return;
    ev.preventDefault();   // required for drop to fire
    ev.dataTransfer.dropEffect = 'copy';
}

function onPaneDragLeave() {
    // Cleanup keys off the pane's own entered-state, NOT dropAcceptable():
    // if acceptability flips off mid-drag (a device-initiated SLIDE session
    // starts), the leave must still count down and clear the affordance —
    // otherwise the accent + footer stay lit promising a drop that is inert.
    if (dropDepth === 0) return;
    dropDepth -= 1;
    if (dropDepth === 0) setDropAffordance(false);
}

function onPaneDrop(ev) {
    if (!dropAcceptable()) return;
    ev.preventDefault();
    dropDepth = 0;
    setDropAffordance(false);
    // The stash is the fallback: some synthetic DataTransfers round-trip empty.
    const text = (ev.dataTransfer && ev.dataTransfer.getData('text/plain')) || selDrag.text;
    // beginReview re-checks suspension itself — if it flipped mid-drag, nothing
    // opens and nothing is sent (AC-3). Zero-valid text still opens the S9.2
    // zero-valid review (AC-4).
    beginReview(text);
}

// UX-DR3 affordance — classes only (mockup pull-pane.html:103-108, rgba
// translated to the shipped color-mix tint); footer swaps to the drop copy
// with the cap-aware valid-token count and restores the resting hint on clear.
function setDropAffordance(on) {
    dropAffordanceOn = on;
    if (cardEl) cardEl.classList.toggle('drop', on);
    if (footEl) {
        footEl.classList.toggle('drop-active', on);
        footEl.textContent = on
            ? `${COPY.footDropPrefix}${plural(selDrag.validCount, 'file')}`
            : COPY.footResting;
    }
}

// ====== S9.3 — rail bloom (FR-2, deferred from S9.1a) ======

// The rail is visible only under the @container (max-width: 90px) narrow-window
// query — computed display is the one honest source (data-bloom must never be
// set while the card is already visible in a wide window).
function railVisible() {
    if (!railEl) return false;
    return getComputedStyle(railEl).display !== 'none';
}

// Bloom is a zero-layout-shift overlay: data-bloom on #pull-pane makes the
// card paint position:absolute above the stage while the pane keeps its 30px
// flow slot — the canvas never moves (NFR-5). CSS in index.html.
function setBloom(on, byClick) {
    if (on) {
        if (!bloomed) {
            paneRootEl.setAttribute('data-bloom', '');
            bloomed = true;
        }
        // Only the click-bloom case dismisses on pointerdown-outside; the
        // drag-bloom case un-blooms on dragend / review exit instead.
        if (byClick && !bloomedByClick) {
            bloomedByClick = true;
            document.addEventListener('pointerdown', onDocPointerDown, true);
        }
    } else {
        if (bloomed) paneRootEl.removeAttribute('data-bloom');
        bloomed = false;
        if (bloomedByClick) {
            bloomedByClick = false;
            document.removeEventListener('pointerdown', onDocPointerDown, true);
        }
    }
}

function onRailClick() {
    if (railVisible()) setBloom(true, true);
}

function onDocPointerDown(ev) {
    if (paneRootEl.contains(ev.target)) return;
    setBloom(false);
}

// ====== S9.4 — reverse drag: pane row → terminal file-drop (FR-12) ======

// The rendered row order — fresh-first, then name-asc (renderRows' partition,
// single-sourced here so shift-ranges and drag payload order match the screen).
function orderedFiles() {
    const fresh = [], rest = [];
    for (const f of state.files) (freshNames.has(f.name) ? fresh : rest).push(f);
    return fresh.concat(rest);
}

// Project the selection onto the live rows — class only, no rebuild.
function applySelectionClasses() {
    if (!listEl) return;
    for (const rowEl of listEl.querySelectorAll('.pp-row')) {
        rowEl.classList.toggle('sel', selectedNames.has(rowEl.dataset.name));
    }
}

// Primary-button pointerdown on a row: update the selection (plain / ctrl /
// shift semantics above), then start resolving every selected row's File into
// the stash so the (synchronous) dragstart can consume them. Suspended while
// a SLIDE session owns the wire (FR-11 precedent) — selection still updates
// (local UI), but no prefetch, and dragstart refuses too. The settle
// callbacks identity-check the stash object: a resolve landing after
// dragend/pointerup already cleared it must not resurrect anything.
function onRowPointerDown(ev) {
    if (ev.button !== 0) return;
    // S10.1 — the ⁞ detail button is gesture-inert: no selection change, no
    // drag-stash arming (its click routes through onListDetailClick instead).
    if (ev.target.closest && ev.target.closest('.pp-detail')) return;
    const rowEl = ev.target.closest('.pp-row');
    if (!rowEl) {
        // Empty-area click inside the list clears the selection (filer convention).
        selectedNames = new Set();
        selAnchor = null;
        applySelectionClasses();
        return;
    }
    const name = rowEl.dataset.name;
    if (ev.shiftKey && selAnchor) {
        const names = orderedFiles().map((f) => f.name);
        const a = names.indexOf(selAnchor);
        const b = names.indexOf(name);
        if (a !== -1 && b !== -1) {
            selectedNames = new Set(names.slice(Math.min(a, b), Math.max(a, b) + 1));
        } else {
            selectedNames = new Set([name]);
            selAnchor = name;
        }
    } else if (ev.ctrlKey || ev.metaKey) {
        if (selectedNames.has(name)) selectedNames.delete(name);
        else selectedNames.add(name);
        selAnchor = name;
    } else if (!selectedNames.has(name)) {
        selectedNames = new Set([name]);
        selAnchor = name;
    } else {
        // Already selected, no modifier: defer the collapse-to-single until a
        // plain pointerup proves this wasn't the start of a group drag.
        pendingCollapse = name;
    }
    applySelectionClasses();
    if (slideActiveNow()) return;
    // Prefetch the drag payload: the selection if the pressed row is in it
    // (a ctrl-click that just deselected the row arms nothing — no drag from
    // an unselected row), in rendered order so the send modal lists what the
    // screen shows.
    if (!selectedNames.has(name)) return;
    const targets = orderedFiles().filter((f) => selectedNames.has(f.name) && f.handle);
    if (targets.length === 0) return;
    // files is index-placed (resolves can land out of order) and `got` counts
    // arrivals — ready iff got === want, order always the rendered order.
    const stash = { names: targets.map((f) => f.name), want: targets.length, got: 0, files: new Array(targets.length) };
    dragOut = stash;
    targets.forEach((entry, i) => {
        entry.handle.getFile().then(
            (file) => { if (dragOut === stash) { stash.files[i] = file; stash.got += 1; } },
            // Rejection (file deleted/renamed since enumeration) disarms the
            // whole stash: the drag silently never starts (never send a partial
            // batch), and the next refresh reconciles the list.
            () => { if (dragOut === stash) dragOut = null; },
        );
    });
}

// A plain click (pointerup with no drag) resolves the deferred collapse and
// must not leave a stale stash behind. In a real drag the browser fires
// pointercancel instead, so this never races dragstart; dragend does the
// post-drag cleanup. Refocus the wrapper: rows can't go through retainFocus
// (the AD-10 drag exception), so the click restores focus here instead.
function onRowPointerUp(ev) {
    if (pendingCollapse) {
        const rowEl = ev.target && ev.target.closest ? ev.target.closest('.pp-row') : null;
        if (rowEl && rowEl.dataset.name === pendingCollapse
                && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
            selectedNames = new Set([pendingCollapse]);
            selAnchor = pendingCollapse;
            applySelectionClasses();
        }
        pendingCollapse = null;
    }
    dragOut = null;
    if (wrapperRef) wrapperRef.focus();
}

// Window-level release: catches what listEl's delegated pointerup never sees.
// pointerup inside the list runs onRowPointerUp first (bubbling), which nulls
// dragOut, so this no-ops there. A pointercancel fired because the native
// drag began keeps the stash — dragend owns that cleanup path.
function onWindowPointerRelease(ev) {
    if (ev.type === 'pointercancel' && dragOutInFlight) return;
    if (!dragOut && !pendingCollapse) return;
    dragOut = null;
    pendingCollapse = null;
    clearWrapperAffordance();
    // The row pointerdown blurred #terminal-wrapper; restore it so keystrokes
    // keep reaching the Z80 even though the gesture ended off-list.
    if (wrapperRef) wrapperRef.focus();
}

function onRowDragStart(ev) {
    pendingCollapse = null;   // the gesture is a drag — never collapse the group
    // Unarmed, still-resolving, or suspended → the drag never starts (silent
    // abort — never send a half-armed or partial payload).
    if (!dragOut || dragOut.got !== dragOut.want || slideActiveNow()) {
        ev.preventDefault();
        return;
    }
    dragOutInFlight = true;
    for (const file of dragOut.files) ev.dataTransfer.items.add(file);
    ev.dataTransfer.effectAllowed = 'copy';
    // No setDragImage: the default ghost for a drag originating on the row is
    // the row itself — small and correct (S9.3's canvas-screenshot problem
    // does not apply here).
}

function onRowDragEnd() {
    dragOut = null;
    dragOutInFlight = false;
    pendingCollapse = null;
    // A drag canceled while over the wrapper (Esc) can skip dragleave — make
    // sure the drop affordance never outlives the drag.
    clearWrapperAffordance();
    // The row pointerdown blurred #terminal-wrapper (see the wire-time AD-10
    // exception note); restore it unconditionally. If the drop landed, the send
    // modal takes focus afterwards through its own openModal flow and restores
    // per its existing restoreTo rules.
    if (wrapperRef) wrapperRef.focus();
}

// ── S9.4 drop side (sanctioned fallback — see the header note) ──

// A wrapper drag event is ours to handle iff the reverse-drag stash is armed
// with every File resolved, no SLIDE session owns the wire, and the drag
// carries no real 'Files' payload (an OS file drag — or a future Chromium
// that preserves the dragstart-added Files — belongs to file-source.js
// untouched).
function wrapperDropOurs(ev) {
    if (!dragOut || dragOut.got !== dragOut.want || dragOut.want === 0) return false;
    if (slideActiveNow()) return false;
    const types = ev.dataTransfer && ev.dataTransfer.types;
    if (types && types.includes && types.includes('Files')) return false;
    return true;
}

// The affordance is file-source's existing data-drop-target overlay ("Drop
// file(s) to send via SLIDE") — same attribute, reused, never fought over:
// file-source ignores this drag entirely (isFileDrag false, so it neither
// sets nor clears the attribute while ours is up).
function clearWrapperAffordance() {
    if (wrapDropDepth === 0) return;
    wrapDropDepth = 0;
    if (wrapperRef) wrapperRef.removeAttribute('data-drop-target');
}

function onWrapperDragEnter(ev) {
    if (!wrapperDropOurs(ev)) return;
    ev.preventDefault();
    wrapDropDepth += 1;
    if (wrapDropDepth === 1) wrapperRef.setAttribute('data-drop-target', 'true');
}

function onWrapperDragOver(ev) {
    if (!wrapperDropOurs(ev)) return;
    ev.preventDefault();   // required for drop to fire
    ev.dataTransfer.dropEffect = 'copy';
}

function onWrapperDragLeave() {
    // Keyed off our own entered-state, not wrapperDropOurs(): if acceptability
    // flips off mid-drag the leave must still clear the affordance.
    if (wrapDropDepth === 0) return;
    wrapDropDepth -= 1;
    if (wrapDropDepth === 0) wrapperRef.removeAttribute('data-drop-target');
}

function onWrapperDrop(ev) {
    // Clear the affordance even when the guards below refuse (a session that
    // started mid-drag must not leave the overlay lit — onPaneDragLeave's rule).
    clearWrapperAffordance();
    if (!wrapperDropOurs(ev)) return;
    ev.preventDefault();
    const files = dragOut.files.slice();
    // The handoff: file-source's send path from validation onward — validate →
    // 8.3 truncate → collisions → confirm modal (or the slideConfirmTransfers
    // silent path) → enterSendMode with all its refusals. Async; a failure
    // must not escape the drop handler.
    Promise.resolve(sendFilesRef(files)).catch((err) => {
        console.error('[pull-pane] reverse-drag send failed:', err);
    });
}

// ====== S10.1 — per-record checksum detail sub-state (FR-4/5) ======

// Delegated ⁞ click. onRowPointerDown ignores button targets (gesture-inert);
// click still bubbles here, where the row's name routes to openDetail.
function onListDetailClick(ev) {
    const btn = ev.target && ev.target.closest ? ev.target.closest('.pp-detail') : null;
    if (!btn) return;
    const rowEl = btn.closest('.pp-row');
    if (rowEl) openDetail(rowEl.dataset.name);
}

// Delegated stand-in for retainFocus's button branch (AD-10): preventDefault
// on mousedown blocks the focus steal from #terminal-wrapper while the click
// (and keyboard Tab-focus) still work. One container listener instead of
// per-button retainFocus wiring, because the buttons are rebuilt with the
// rows on every content-changing refresh.
function onListDetailMousedown(ev) {
    if (ev.target && ev.target.closest && ev.target.closest('.pp-detail')) ev.preventDefault();
}

// The in-flight ⁞ open, if any. Last click wins: a second open supersedes the
// first even though neither has set the flag yet (the flag is only set after
// the read resolves).
let detailOpenToken = null;

// openDetail — read the file FRESH (records are never kept from the column
// fill), analyze, then set the flag + paint ONCE (the S9.2 review pattern:
// refresh-triggered render() calls only project visibility). The await runs
// BEFORE the flag is set, so there is never a half-painted detail — a slow
// read just delays the swap. A read failure paints the failure copy in the
// detail body; it never throws (AC-8). Post-await, the open is abandoned if
// the pane moved on: another sub-state opened, a LATER ⁞ click superseded
// this one, the folder was rebound (dirHandle identity — refresh ticks never
// change it, so a background tick can't kill the open), the view degraded, or
// the file vanished from the folder.
async function openDetail(name) {
    if (state.review || state.detail) return;   // mutual exclusion by construction
    if (state.view !== 'list') return;
    const entry = state.files.find((f) => f.name === name);
    if (!entry || !entry.handle) return;
    const boundHandle = dirHandle;
    const token = {};
    detailOpenToken = token;
    let detail;
    let records = [];
    let freshKey = null;
    try {
        const file = await entry.handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const analyzed = analyzeCsumRef(bytes);
        records = analyzed.records;
        detail = { name, recordCount: records.length, crc: analyzed.crc, error: null };
        freshKey = `${name}:${file.size}:${file.lastModified}`;
    } catch (e) {
        console.warn('[pull-pane] detail read failed:', e);
        detail = { name, recordCount: 0, crc: null, error: COPY.detailReadFail };
    }
    if (detailOpenToken !== token) return;      // a later ⁞ click owns the open
    if (state.review || state.detail) return;   // the pane moved on during the read
    if (dirHandle !== boundHandle || state.view !== 'list') return;
    if (!state.files.some((f) => f.name === name)) return;   // file vanished meanwhile
    if (freshKey) {
        // Write-back: the column must agree with the header the user is about
        // to read. The fresh mtime keys the cache, so the next enumeration
        // hits it instead of reverting the cell to a stale value.
        csumCache.set(freshKey, detail.crc);
        csumShown.set(name, detail.crc);
        updateCsumCell(name, detail.crc);
    }
    state.detail = detail;
    renderDetail(detail, records);
    render();
}

// ‹ Back — clear the flag and re-render truthfully: the list re-projects
// current state, picking up any refresh that landed while the detail was open.
// Bloom rules untouched: closing the detail never un-blooms (S9.3 dismissal
// paths own that).
function closeDetail() {
    state.detail = null;
    render();
}

// renderDetail — paints the detail's own DOM. Called ONLY from openDetail, so
// refresh-triggered render() calls never repaint an open detail. The records
// array is consumed here and not kept in state (post-paint, nothing reads it —
// the DOM is the record listing's single home). Labels stay honest: the
// whole-file value is CRC-32, per-record values are Fletcher-16.
function renderDetail(dv, records) {
    if (!dv) return;
    if (detailTitleEl) {
        detailTitleEl.textContent = dv.error
            ? dv.name
            : `${dv.name} · ${plural(dv.recordCount, 'record')} · CRC ${dv.crc}`;
    }
    if (detailRowsEl) {
        const frag = document.createDocumentFragment();
        if (dv.error) {
            const err = document.createElement('div');
            err.className = 'pp-dv-err';
            err.textContent = dv.error;
            frag.append(err);
        } else {
            for (let i = 0; i < records.length; i++) {
                const row = document.createElement('div');
                row.className = 'pp-dv-row';
                row.textContent = `${hex4(i)}: ${records[i]}`;
                frag.append(row);
            }
        }
        detailRowsEl.replaceChildren(frag);
    }
}

function hex4(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }

// ====== S9.2 — selection → SLIDE S compose + in-pane review (FR-4/5/7/11) ======

// The session predicate, test-overridable. Checked at beginReview AND
// re-checked at confirm — a transfer that started while the review sat open
// must not have keystrokes injected under it (SLIDE owns the wire). The
// injected predicate (main.js) covers BOTH directions: slide-recv's
// isSlideActive for recv sessions plus tx-sink wire ownership for send
// sessions, which slide-recv never sees. tx-sink's own silent drop when the
// wire owner is 'slide' (tx-sink.js:50) remains a backstop, not the mechanism.
function slideActiveNow() {
    if (slideActiveOverride !== null) return slideActiveOverride;
    return isSlideActiveRef();
}

// mergeDirColumns — rewrite the raw token stream so a dragged CP/M DIR listing
// reads as filenames. DIR prints columnar 'NAME     EXT' fields (no dot) with
// ':' between columns and a leading drive prefix ('A:'), so the plain
// whitespace split sees 'VPEEK    COM' as two names and ':' as a third.
// Rules, deliberately narrow:
//   - a lone ':' and drive-prefix tokens ('A:'…'P:') are DIR noise — dropped;
//   - a dotless 1-8 char token followed by a dotless 1-3 char token joins as
//     NAME.EXT, but ONLY when the joined form passes the injected validators
//     (so lowercase prose never joins, and dot-joined selections like
//     'GAME.COM DUMP.BIN' pass through untouched — neither half is dotless
//     next to a joinable partner).
// Anything the rules don't match flows through to per-token validation and
// surfaces in the review, which remains the operator's safety net.
function mergeDirColumns(raws) {
    const out = [];
    for (let i = 0; i < raws.length; i += 1) {
        const t = raws[i];
        if (t === ':' || /^[A-P]:$/.test(t)) continue;
        const next = raws[i + 1];
        if (next
                && !t.includes('.') && t.length <= 8
                && next !== ':' && !next.includes('.') && next.length <= 3) {
            const joined = `${t}.${next}`;
            if (validateRef(joined).ok && truncateRef(joined) === joined) {
                out.push(joined);
                i += 1;   // consume the ext token
                continue;
            }
        }
        out.push(t);
    }
    return out;
}

// composeFromText — pure: selection text → { tokens, validCount, command|null }.
// Split on whitespace/newlines, order preserved, empty tokens dropped, then
// mergeDirColumns rewrites DIR-columnar pairs into dot-joined names. A token
// is valid iff it passes the injected validateCpmFilename AND truncateCpm83
// returns it unchanged (idempotence, NOT truncation: on pull the command must
// request the exact name the device has — truncating LONGNAME.TEXT to
// LONGNAME.TEX would silently request a different file. Because truncateCpm83
// uppercases, this also rejects lowercase tokens, which are prose in a CP/M
// listing, not filenames). Exact-duplicate valid tokens collapse to the first
// occurrence (whether the first was included or cap-skipped). command is
// CMD_PREFIX + names joined by CMD_SEP, or null when nothing is valid (no
// code path may transmit a bare 'SLIDE S' — FR-7).
function composeFromText(text) {
    const tokens = [];
    const names = [];
    const seen = new Set();
    // AC-7 — once appending a name (with its joining separator) would push the
    // command past MAX_COMMAND_CHARS, that name and every later valid one are
    // skipped. Dedupe applies first: a duplicate of an included name collapses,
    // it doesn't burn budget. cmdLen tracks the composed length so the cap
    // arithmetic and the final join can never disagree on the command shape.
    let capReached = false;
    let cmdLen = CMD_PREFIX.length;
    const raws = mergeDirColumns(text.split(/\s+/).filter((t) => t.length > 0));
    for (const raw of raws) {
        const v = validateRef(raw);
        if (!v.ok) { tokens.push({ raw, name: raw, ok: false, reason: v.reason }); continue; }
        if (truncateRef(raw) !== raw) { tokens.push({ raw, name: raw, ok: false, reason: REASON_83 }); continue; }
        if (seen.has(raw)) continue;   // duplicate valid name — first occurrence wins
        seen.add(raw);
        const prospective = cmdLen + (names.length > 0 ? CMD_SEP.length : 0) + raw.length;
        if (capReached || prospective > MAX_COMMAND_CHARS) {
            capReached = true;
            tokens.push({ raw, name: raw, ok: false, reason: REASON_LIMIT });
            continue;
        }
        cmdLen = prospective;
        names.push(raw);
        tokens.push({ raw, name: raw, ok: true, reason: null });
    }
    return {
        tokens,
        validCount: names.length,
        command: names.length > 0 ? CMD_PREFIX + names.join(CMD_SEP) : null,
    };
}

// beginReview — the S9.2 public entry point (also the S9.3 drop path —
// onPaneDrop routes here). Opens the review even with zero tokens (a prose-only drop still needs
// something to show — the zero-valid message). Returns false (no-op) while a
// SLIDE session is active (FR-11). Review entry does NOT bump the epoch (it
// enumerates nothing, and cancelling an in-flight refresh would be needless)
// and does NOT touch lastSnapshot/freshNames.
export function beginReview(text) {
    if (slideActiveNow()) return false;
    // S10.1 (AC-7) — refused while the detail sub-state is open, mirroring
    // dropAcceptable: this is a public entry point, so the exclusion must
    // hold here too, not only on the drop path. S10.2 routes this case to
    // the CSUM -V diff instead.
    if (state.detail) return false;
    state.review = composeFromText(String(text ?? ''));
    renderReview();
    render();
    return true;
}

// renderReview — paints the review's own DOM (command line, token rows, the
// zero-valid message, the confirm label). Called ONLY from beginReview, so
// refresh-triggered render() calls never repaint an open review (AC-3).
function renderReview() {
    const rv = state.review;
    if (!rv || !reviewEl) return;
    if (cmdTextEl) cmdTextEl.textContent = rv.command || '';
    if (cmdlineEl) cmdlineEl.hidden = !rv.command;
    if (nothingEl) nothingEl.hidden = rv.validCount > 0;
    if (tokListEl) {
        const frag = document.createDocumentFragment();
        for (const t of rv.tokens) {
            const row = document.createElement('div');
            row.className = t.ok ? 'pp-tok ok' : 'pp-tok skip';
            const mk = document.createElement('span');
            mk.className = 'mk';
            mk.textContent = t.ok ? '✓' : '✗';
            const nm = document.createElement('span');
            nm.className = 'nm';
            nm.textContent = t.name;
            row.append(mk, nm);
            if (!t.ok) {
                const why = document.createElement('span');
                why.className = 'why';
                why.append('skipped ');
                const info = document.createElement('span');
                info.className = 'pp-info';
                info.textContent = 'ⓘ';
                info.title = t.reason;
                why.append(info);
                row.append(why);
            }
            frag.append(row);
        }
        tokListEl.replaceChildren(frag);
    }
    if (confirmBtn) {
        confirmBtn.textContent = `Pull ${plural(rv.validCount, 'file')}`;
        confirmBtn.disabled = rv.validCount === 0;
    }
}

// Confirm — re-check the session predicate (refuse + stay open if a transfer
// started meanwhile) and writer readiness (refuse + stay open with no port —
// WR-03: otherwise the bytes land only in the diagnostics ring and the review
// closes as if the pull fired), then ONE pushTxBytes of command + Enter
// terminator. One combined push matters: two pushes could straddle a
// wire-owner flip and send half a command. getEnterBytes reads the CR/LF pref
// at confirm time, so a Settings change mid-session is honored (same live-read
// as keyboard Enter).
function onReviewConfirm() {
    const rv = state.review;
    if (!rv || !rv.command) return;          // zero-valid — button is disabled anyway
    if (slideActiveNow()) return;            // FR-11 — refuse; review stays open
    if (!isWriterReadyRef()) return;         // no port — refuse; connect, then confirm
    const cmd = new TextEncoder().encode(rv.command);
    const enter = getEnterBytesRef();
    const bytes = new Uint8Array(cmd.length + enter.length);
    bytes.set(cmd, 0);
    bytes.set(enter, cmd.length);
    // Batch-size hint BEFORE the command bytes go out — the Z80's wakeup can
    // only follow the injected command, so the hint is in place when the
    // recv session starts (chip shows "N/M" instead of a bare index).
    if (onPullRequestedRef) {
        try { onPullRequestedRef(rv.validCount); } catch { /* hint only — never blocks the pull */ }
    }
    pushTxBytesRef(bytes);
    exitReview();
}

function onReviewCancel() { exitReview(); }   // transmits nothing (FR-5)

// Exit — clear the flag and re-render: the underlying content view re-projects,
// picking up any refresh that landed while the review was open. S9.3: a review
// exit while bloomed also un-blooms (AC-6 — the bloom existed for the review).
function exitReview() {
    state.review = null;
    if (bloomed) setBloom(false);
    render();
}

// ====== Render (projects state via data-view / [hidden] only — no inline styles) ======

function render() {
    if (!cardEl) return;
    const { view, files, folderName } = state;
    // S9.2 — an open review wins the data-view projection; the content view
    // underneath stays live (refresh keeps mutating it) and re-projects on exit.
    // S10.1 — the detail flag projects the same way (review outranks it, but
    // the two are mutually exclusive by construction).
    const reviewing = !!state.review;
    const detailing = !reviewing && !!state.detail;
    // One source for "a sub-state covers the content view" — every content
    // projection below keys off this, so a future sub-state (S10.2 diff) is
    // one term here, not five hand-updated conditions.
    const overlay = reviewing || detailing;
    cardEl.setAttribute('data-view', reviewing ? 'review' : detailing ? 'detail' : view);

    // Header — bound states show the folder name; first-run shows the generic label.
    if (fnameEl) fnameEl.textContent = folderName || 'Pull pane';

    const bound = view === 'empty' || view === 'list';   // folder bound + readable

    // Caption + counts. Review forces the caption visible with the review
    // caption and hides the file count (mockup Frame C).
    if (capEl) capEl.hidden = reviewing ? false : !bound;
    if (capLabelEl) capLabelEl.textContent = reviewing ? COPY.reviewCaption : COPY.boundCaption;
    if (countEl) {
        countEl.hidden = reviewing;
        countEl.textContent = plural(files.length, 'file');
    }
    if (badgeEl) badgeEl.textContent = String(files.length);

    // File list. While a sub-state covers it, leave the list DOM entirely
    // alone (hidden but untouched — zero churn); the exit render repaints it
    // from current state.
    if (listEl) {
        listEl.hidden = overlay || view !== 'list';
        if (!overlay) {
            if (view === 'list') renderRows();
            else listEl.replaceChildren();
        }
    }

    // Blank state (first-run | permission | empty) — one message + one control.
    const blankView = view === 'first-run' || view === 'permission' || view === 'empty';
    if (blankEl) blankEl.hidden = overlay || !blankView;
    if (blankMsgEl) {
        if (view === 'first-run') blankMsgEl.textContent = COPY.firstRun;
        else if (view === 'permission') blankMsgEl.textContent = COPY.permission;
        else if (view === 'empty') blankMsgEl.textContent = COPY.empty;
    }
    if (chooseBtn) chooseBtn.hidden = view !== 'first-run';
    if (grantBtn) grantBtn.hidden = view !== 'permission';

    // Footer hint — only once a folder is bound + readable (never under a
    // sub-state).
    if (footEl) footEl.hidden = overlay || !bound;

    // Review body + actions — content is painted by renderReview at beginReview
    // time; render() only projects visibility (AC-3: refresh never repaints it).
    if (reviewEl) reviewEl.hidden = !reviewing;
    if (actionsEl) actionsEl.hidden = !reviewing;

    // S10.1 detail body — same paint-once discipline (renderDetail at
    // openDetail time; here only visibility).
    if (detailEl) detailEl.hidden = !detailing;
}

function renderRows() {
    // Fresh-first ordering (Flow 7): freshly-arrived names float to the top,
    // then the rest, name-asc within each group. orderedFiles() is the single
    // source of that order — shift-ranges and the drag payload read it too,
    // so what the user selects/drags always matches what the screen shows.
    const ordered = orderedFiles();

    // FR-10 changed-case: capture scroll before the rebuild, restore it after, so
    // a refresh that adds files never yanks the user's scroll position.
    const prevScroll = listEl.scrollTop;
    // S10.1 — the rebuild destroys any keyboard-focused ⁞ button; note which
    // row held it so focus is restored after (otherwise it falls to <body>
    // and keystrokes reach neither the terminal nor any control — AD-10).
    const activeEl = document.activeElement;
    const focusedDetailRow = (activeEl && activeEl.classList
            && activeEl.classList.contains('pp-detail') && listEl.contains(activeEl))
        ? activeEl.closest('.pp-row').dataset.name
        : null;
    const frag = document.createDocumentFragment();
    for (const f of ordered) {
        const row = document.createElement('div');
        // Visual state via class only (never inline styles). Fresh rows get the
        // mint left-marker + hover-row accent treatment; selected rows the
        // accent tint + inset line (index.html, --chrome-*).
        row.className = freshNames.has(f.name) ? 'pp-row fresh' : 'pp-row';
        if (selectedNames.has(f.name)) row.classList.add('sel');
        // S9.4 — every row (plain and fresh alike) is a native drag source;
        // dataset.name lets the delegated handlers find the entry.
        row.draggable = true;
        row.dataset.name = f.name;
        const nm = document.createElement('span');
        nm.className = 'pp-nm';
        nm.textContent = f.name;
        // S10.1 — ambient CRC-32 cell. Cache hits paint synchronously (no
        // placeholder flash). A miss keeps whatever the cell last showed —
        // '—' after a read failure (never cached, so the next enumeration's
        // fill retries it) or a stale value awaiting recompute — and only a
        // never-shown file gets the pending placeholder. Repainting misses as
        // '…' here would fake an in-progress state on paths (review/detail
        // exit) that queue no fill.
        const cs = document.createElement('span');
        cs.className = 'pp-cs';
        cs.title = COPY.csumTip;
        const hit = f.handle ? csumCache.get(csumKey(f)) : undefined;
        const shown = hit ?? csumShown.get(f.name) ?? CSUM_PENDING;
        cs.textContent = shown;
        csumShown.set(f.name, shown);
        const sz = document.createElement('span');
        sz.className = 'pp-sz';
        sz.textContent = formatSize(f.size);
        // S10.1 — per-row detail button (⁞). Gesture-inert and focus-safe via
        // the DELEGATED listEl handlers (onListDetailMousedown preventDefaults
        // the focus steal — retainFocus's button branch verbatim — and
        // onRowPointerDown ignores button targets): rows rebuild on every
        // content change, and per-button retainFocus wiring would push a new
        // focus.js registry entry per button per rebuild, unbounded.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pp-detail';
        btn.textContent = '⁞';
        btn.title = COPY.detailTip;
        row.append(nm, cs, sz, btn);
        frag.append(row);
    }
    listEl.replaceChildren(frag);
    listEl.scrollTop = prevScroll;
    if (focusedDetailRow !== null) {
        const again = listEl.querySelector(`.pp-row[data-name="${CSS.escape(focusedDetailRow)}"] .pp-detail`);
        if (again) again.focus();
        else if (wrapperRef) wrapperRef.focus();
    }
}

// Byte formatter — mirrors slide-chip.js formatBytes (12 KB / 820 B / 1.2 MB).
function formatSize(b) {
    if (b < 1000) return `${b} B`;
    if (b < 1_000_000) return `${Math.round(b / 1000)} KB`;
    return `${(b / 1_000_000).toFixed(1)} MB`;
}

function plural(n, noun) { return n === 1 ? `1 ${noun}` : `${n} ${noun}s`; }

// ====== Test introspection (matches the window.__* pattern) ======

export function __getStateForTests() {
    return {
        folderName: state.folderName,
        permission: state.permission,
        view: state.view,
        fileCount: state.files.length,
        // name+size only — the S9.4 handle stays out (specs deep-compare this).
        files: state.files.map((f) => ({ name: f.name, size: f.size })),
        dropAffordance: dropAffordanceOn,   // S9.3 (AC-9)
        bloom: bloomed,                     // S9.3 (AC-9)
        dragOutArmed: dragOut !== null,     // S9.4 (AC-7)
        selectedNames: [...selectedNames].sort(),   // S9.4 multi-select extension
        // S10.1 (AC-9) — what each row's checksum cell shows right now.
        csums: Object.fromEntries(state.files.map((f) => [f.name, csumShown.get(f.name) ?? CSUM_PENDING])),
        // S10.1 (AC-9) — the open detail sub-state.
        detail: state.detail ? { ...state.detail } : null,
        review: state.review
            ? {
                command: state.review.command,
                validCount: state.review.validCount,
                tokens: state.review.tokens.map((t) => ({ ...t })),
            }
            : null,
    };
}

export function __resetForTests() {
    ++epoch;   // invalidate any boot-time bindFromIdb still in flight
    resetDiffBaseline();
    dirHandle = null;
    slideActiveOverride = null;
    state = { folderName: null, permission: 'prompt', files: [], view: 'first-run', review: null, detail: null };
    // S9.3 — clear drag/drop/bloom state so specs start from rest.
    selDrag = { active: false, text: '', validCount: 0 };
    dropDepth = 0;
    setDropAffordance(false);
    setBloom(false);
    dragOut = null;   // S9.4 — no stale reverse-drag stash across specs
    dragOutInFlight = false;
    clearWrapperAffordance();
    // (csum cache/shown/chain were reset by resetDiffBaseline above.)
    render();
}

// S9.2 test hook — override the injected isSlideActive (true/false), null (or
// undefined) restores the injected predicate. Cheaper and more deterministic
// than standing up a real SLIDE recv session in a headless run.
export function __setSlideActiveForTests(v) {
    slideActiveOverride = (v === null || v === undefined) ? null : !!v;
}

// Test hook — inject a fake directory handle and run the real query→enumerate
// path. showDirectoryPicker / permission prompts can't run headless, so tests
// build an in-page fake handle ({ name, queryPermission, requestPermission,
// entries }) and drive deterministic states through here.
export async function __setDirHandleForTests(handle) {
    const gen = ++epoch;
    resetDiffBaseline();   // binding a fresh handle → first enumeration none-fresh
    dirHandle = handle;
    await evaluateHandle(handle, gen);
}

export function dispose() {
    if (chooseBtn) chooseBtn.removeEventListener('click', onChoose);
    if (grantBtn) grantBtn.removeEventListener('click', onGrant);
    if (refreshBtn) refreshBtn.removeEventListener('click', triggerRefresh);
    if (cancelBtn) cancelBtn.removeEventListener('click', onReviewCancel);
    if (confirmBtn) confirmBtn.removeEventListener('click', onReviewConfirm);
    // S10.1 — detail sub-state teardown (row ⁞ buttons go with the rows).
    // Clear the visual state BEFORE the listeners go (the S9.3 bloom rule): a
    // disposed pane must not freeze an open detail on screen with its Back
    // listener removed.
    state.detail = null;
    if (detailEl) detailEl.hidden = true;
    if (cardEl && cardEl.getAttribute('data-view') === 'detail') {
        cardEl.setAttribute('data-view', state.view);
    }
    if (detailBackBtn) detailBackBtn.removeEventListener('click', closeDetail);
    if (listEl) {
        listEl.removeEventListener('click', onListDetailClick);
        listEl.removeEventListener('mousedown', onListDetailMousedown);
    }
    // S9.3 — drop target + bloom teardown. Clear the visual state BEFORE the
    // listeners go: a disposed pane must not leave the bloom overlay painted
    // (or the drop affordance lit) with every dismiss path removed.
    if (paneRootEl) {
        selDrag = { active: false, text: '', validCount: 0 };
        dropDepth = 0;
        setDropAffordance(false);
        setBloom(false);
        paneRootEl.removeEventListener('dragenter', onPaneDragEnter);
        paneRootEl.removeEventListener('dragover', onPaneDragOver);
        paneRootEl.removeEventListener('dragleave', onPaneDragLeave);
        paneRootEl.removeEventListener('drop', onPaneDrop);
    }
    if (railEl) railEl.removeEventListener('click', onRailClick);
    // S9.4 — reverse-drag origination + drop-side teardown.
    if (listEl) {
        dragOut = null;
        dragOutInFlight = false;
        selectedNames = new Set();
        selAnchor = null;
        pendingCollapse = null;
        listEl.removeEventListener('pointerdown', onRowPointerDown);
        listEl.removeEventListener('pointerup', onRowPointerUp);
        listEl.removeEventListener('dragstart', onRowDragStart);
        listEl.removeEventListener('dragend', onRowDragEnd);
        window.removeEventListener('pointerup', onWindowPointerRelease);
        window.removeEventListener('pointercancel', onWindowPointerRelease);
    }
    if (wrapperRef) {
        clearWrapperAffordance();
        wrapperRef.removeEventListener('dragenter', onWrapperDragEnter);
        wrapperRef.removeEventListener('dragover', onWrapperDragOver);
        wrapperRef.removeEventListener('dragleave', onWrapperDragLeave);
        wrapperRef.removeEventListener('drop', onWrapperDrop);
    }
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    window.removeEventListener('focus', triggerRefresh);
    // S10.1 — checksum machinery teardown (epoch bump stops in-flight writes).
    ++epoch;
    resetCsumState();
}
