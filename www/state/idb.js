// www/state/idb.js — minimal IndexedDB wrapper for FileSystemDirectoryHandle persistence.
//
// Phase 10 — Plan 10-02 — implements CONTEXT D-03:
//   "Directory persists across page reloads via IndexedDB."
//
// Architecture:
//   - DB name: 'bestialitty-handles'
//   - DB version: 1
//   - Store: 'handles' (created on upgradeneeded)
//   - Keys: 'recv_directory' (FileSystemDirectoryHandle for SLIDE recv)
//
// The handle is structuredClone-compatible per the File System Access API
// spec; IndexedDB serialises it transparently. On reload, the handle returns
// intact; permission must still be re-requested via requestPermission()
// (Chrome 122+ persistent-permissions model — one-click Allow for previously
//  granted handles).
//
// Defensive: every IndexedDB error is swallowed with console.warn so an
// incognito-mode tab (which restricts IDB) still runs the rest of the app.
// Failure mode is "handle is null" which slide-recv treats as a fall-through
// to the anchor-click download path (D-04 silent fallback).
//
// Sources:
//   - 10-RESEARCH.md §"Code Examples — Example 4: IndexedDB handle store"
//     (verbatim 3-export module body, lines 1067-1130).
//   - 10-CONTEXT.md D-03 (directory persists across reloads via IndexedDB).
//   - 10-PATTERNS.md §"www/state/idb.js (NEW; utility, IndexedDB storage)".
//   - WICG/file-system-access EXPLAINER §"Storing file handles or directory
//     handles in IndexedDB" (cited in RESEARCH).

const DB_NAME = 'bestialitty-handles';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY_RECV_DIR = 'recv_directory';

let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

export async function getRecvDirHandle() {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(KEY_RECV_DIR);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('[idb] getRecvDirHandle failed:', e);
        return null;
    }
}

export async function setRecvDirHandle(handle) {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(handle, KEY_RECV_DIR);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[idb] setRecvDirHandle failed:', e);
    }
}

export async function clearRecvDirHandle() {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(KEY_RECV_DIR);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[idb] clearRecvDirHandle failed:', e);
    }
}
