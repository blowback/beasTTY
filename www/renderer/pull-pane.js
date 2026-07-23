// Beastty Epic E9 Story S9.1a — Local Folder Pull Pane shell (FR-1/2/3, NFR-2/4/5).
//
// A persistent, gutter-docked chrome component that binds SLIDE-recv's folder,
// lists its files one level deep, and handles the first-run / permission-needed /
// empty states. Built on the www/renderer/scroll-state.js / slide-chip.js template
// (AD-1/AD-2): module-scope state + wirePullPane(opts) → API + a private render()
// projecting state via data-view / [hidden] only + dispose() + the test hooks.
//
// Scope (S9.1a): the SHELL only. NO refresh machinery (the three triggers / the
// ~60s timer guard / diff-render → S9.1b), NO drop/compose/pull (S9.2/S9.3), NO
// reverse drag (S9.4). render() is factored so S9.1b can call refresh() on a
// trigger, but nothing here schedules a timer or listens for focus/visibility.
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
let state = { folderName: null, permission: 'prompt', files: [], view: 'first-run' };

// The bound directory handle (SLIDE-recv's recv_directory). Not persisted here
// beyond the idb.setRecvDirHandle write on the first-run pick.
let dirHandle = null;

// Async epoch. Every entry point that starts a new intent (bindFromIdb/refresh,
// onChoose, onGrant, the test seam, reset) bumps this and captures its value;
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

// DOM refs derived from the injected #pull-pane root in wire.
let paneRootEl = null, cardEl = null, fnameEl = null, capEl = null, countEl = null,
    listEl = null, blankEl = null, blankMsgEl = null,
    chooseBtn = null, grantBtn = null, footEl = null, badgeEl = null;

// Verbatim microcopy (EXPERIENCE.md — do NOT paraphrase).
const COPY = {
    firstRun: 'No folder chosen. Pulled files land here.',
    permission: 'Permission needed to read this folder.',
    empty: 'Empty — pulled files will appear here.',
};

const FSA_OPTS = { mode: 'readwrite' };

export function wirePullPane(opts) {
    ({ paneEl: paneRootEl, idb: idbRef, retainFocus: retainFocusRef, terminalWrapper: wrapperRef } = opts);

    // Derive child refs from the injected root (no cross-module document reach).
    cardEl = paneRootEl.querySelector('.pp-card');
    fnameEl = paneRootEl.querySelector('#pull-pane-fname');
    capEl = paneRootEl.querySelector('#pull-pane-cap');
    countEl = paneRootEl.querySelector('#pull-pane-count');
    listEl = paneRootEl.querySelector('#pull-pane-list');
    blankEl = paneRootEl.querySelector('#pull-pane-blank');
    blankMsgEl = paneRootEl.querySelector('#pull-pane-blank-msg');
    chooseBtn = paneRootEl.querySelector('#pull-pane-choose');
    grantBtn = paneRootEl.querySelector('#pull-pane-grant');
    footEl = paneRootEl.querySelector('#pull-pane-foot');
    badgeEl = paneRootEl.querySelector('#pull-pane-badge');

    // AD-10 — every interactive control retains #terminal-wrapper focus. Both are
    // buttons (the mousedown→preventDefault branch, restoreTarget unused for that
    // branch) but the wrapper is passed for explicitness + forward-compat.
    if (chooseBtn) { retainFocusRef(chooseBtn, wrapperRef); chooseBtn.addEventListener('click', onChoose); }
    if (grantBtn) { retainFocusRef(grantBtn, wrapperRef); grantBtn.addEventListener('click', onGrant); }

    // Paint first-run synchronously (no flash of a blank pane) …
    render();
    // … then hydrate from idb (async): getRecvDirHandle → view.
    bindFromIdb();

    return {
        render,
        refresh: bindFromIdb,   // S9.1b calls this on a trigger; nothing schedules it here.
        dispose,
        __getStateForTests,
        __resetForTests,
        __setDirHandleForTests,
    };
}

// bindFromIdb — read SLIDE-recv's persisted handle; null → first-run, else evaluate.
async function bindFromIdb() {
    const gen = ++epoch;
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
            let size = 0;
            try { const f = await h.getFile(); size = f.size; } catch { size = 0; }
            files.push({ name, size });
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
    state.files = files;
    state.view = files.length === 0 ? 'empty' : 'list';
    render();
}

// First-run [Choose folder…] — showDirectoryPicker → persist as recv_directory
// (the shared key) → enumerate. AbortError (user dismissed) is swallowed (D-04).
async function onChoose() {
    const gen = ++epoch;
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

// ====== Render (projects state via data-view / [hidden] only — no inline styles) ======

function render() {
    if (!cardEl) return;
    const { view, files, folderName } = state;
    cardEl.setAttribute('data-view', view);

    // Header — bound states show the folder name; first-run shows the generic label.
    if (fnameEl) fnameEl.textContent = folderName || 'Pull pane';

    const bound = view === 'empty' || view === 'list';   // folder bound + readable

    // Caption + counts.
    if (capEl) capEl.hidden = !bound;
    if (countEl) countEl.textContent = pluralFiles(files.length);
    if (badgeEl) badgeEl.textContent = String(files.length);

    // File list.
    if (listEl) {
        listEl.hidden = view !== 'list';
        if (view === 'list') renderRows(files);
        else listEl.replaceChildren();
    }

    // Blank state (first-run | permission | empty) — one message + one control.
    const blankView = view === 'first-run' || view === 'permission' || view === 'empty';
    if (blankEl) blankEl.hidden = !blankView;
    if (blankMsgEl) {
        if (view === 'first-run') blankMsgEl.textContent = COPY.firstRun;
        else if (view === 'permission') blankMsgEl.textContent = COPY.permission;
        else if (view === 'empty') blankMsgEl.textContent = COPY.empty;
    }
    if (chooseBtn) chooseBtn.hidden = view !== 'first-run';
    if (grantBtn) grantBtn.hidden = view !== 'permission';

    // Footer hint — only once a folder is bound + readable.
    if (footEl) footEl.hidden = !bound;
}

function renderRows(files) {
    const frag = document.createDocumentFragment();
    for (const f of files) {
        const row = document.createElement('div');
        row.className = 'pp-row';
        const nm = document.createElement('span');
        nm.className = 'pp-nm';
        nm.textContent = f.name;
        const sz = document.createElement('span');
        sz.className = 'pp-sz';
        sz.textContent = formatSize(f.size);
        row.append(nm, sz);
        frag.append(row);
    }
    listEl.replaceChildren(frag);
}

// Byte formatter — mirrors slide-chip.js formatBytes (12 KB / 820 B / 1.2 MB).
function formatSize(b) {
    if (b < 1000) return `${b} B`;
    if (b < 1_000_000) return `${Math.round(b / 1000)} KB`;
    return `${(b / 1_000_000).toFixed(1)} MB`;
}

function pluralFiles(n) { return n === 1 ? '1 file' : `${n} files`; }

// ====== Test introspection (matches the window.__* pattern) ======

export function __getStateForTests() {
    return {
        folderName: state.folderName,
        permission: state.permission,
        view: state.view,
        fileCount: state.files.length,
        files: state.files.map((f) => ({ ...f })),
    };
}

export function __resetForTests() {
    ++epoch;   // invalidate any boot-time bindFromIdb still in flight
    dirHandle = null;
    state = { folderName: null, permission: 'prompt', files: [], view: 'first-run' };
    render();
}

// Test seam — inject a fake directory handle and run the real query→enumerate
// path. showDirectoryPicker / permission prompts can't run headless, so tests
// build an in-page fake handle ({ name, queryPermission, requestPermission,
// entries }) and drive deterministic states through here.
export async function __setDirHandleForTests(handle) {
    const gen = ++epoch;
    dirHandle = handle;
    await evaluateHandle(handle, gen);
}

export function dispose() {
    if (chooseBtn) chooseBtn.removeEventListener('click', onChoose);
    if (grantBtn) grantBtn.removeEventListener('click', onGrant);
}
