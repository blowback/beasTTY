// Beastty Epic E11 Story S11.2 — the cross-tab peer link.
//
// Two tabs of this app, same browser profile, same origin. One of them holds a
// pull folder full of files that came off its MicroBeast; the other wants a copy
// of one. This module is the whole of how they find each other, decide whether
// the request is allowed, and move the bytes. It is deliberately small and
// deliberately dumb: no user-facing words, no DOM, no drag, no SLIDE.
//
// What rides where:
//   - identity + authorisation ride in a custom dataTransfer payload that S11.3
//     stamps onto the drag (session id + a single-use nonce this module minted);
//   - the bytes ride over a same-origin BroadcastChannel, as Blobs.
//
// Three facts about BroadcastChannel shape the design:
//   1. It never delivers a message back to the context that posted it. A tab
//      cannot hear itself, so "own payload dropped on own terminal" is a
//      session-id comparison in S11.3, not a channel behaviour here.
//   2. postMessage() takes no transfer list, so an ArrayBuffer in a message is
//      structured-CLONED — a full synchronous copy on the sending thread. A Blob
//      serialises as a handle into the browser-process blob store instead, so
//      the bytes never travel through either renderer. That is why the response
//      carries Blobs (NFR-7), and why nothing else in a message is bulky.
//   3. It is same-origin and server-free by construction (NFR-2), and no CSP
//      directive governs it. Note the reverse: CSP here is `connect-src 'self'`
//      with no `blob:`, so URL.createObjectURL + fetch() is NOT a way to read
//      these bytes back. Use .arrayBuffer().
//
// Why the exchange is two-phase (S11.2 §3(d)). A peer ANSWERS a request in
// microseconds; a peer FULFILS one by running a real SLIDE pull over 19200 baud,
// which takes seconds to tens of seconds. One deadline cannot cover both jobs: a
// deadline long enough for the pull cannot notice a closed tab in useful time,
// and one short enough to notice a closed tab reports a healthy transfer as
// failed — the exact defect S11.4 exists to have removed. So:
//   request -> `accepted` or `refused`, IMMEDIATELY. This reply, and only this
//              reply, is what the single deadline covers.
//   later   -> `files` (or a late `refused` carrying pull-failed), no deadline.
// The tab that closes after accepting is covered without a timer by a
// best-effort `bye` on pagehide — same shape and the same honesty as
// serial.js:212's beforeunload teardown. A hard-killed tab posts nothing and the
// requester waits; that residual case is recorded as a known limit rather than
// papered over with a poll (a poll is also what a hidden tab's clamped chained
// timers destroy — see slide.js:1200-1208).
//
// Module template: www/transport/echo-swallow.js — DOM-free, imports nothing,
// module-scope state, wireXxx(opts) returning an API whose methods are also
// named exports. Frozen exported vocabulary: session-log.js:47-50.
//
// NOT here, on purpose: no presence/heartbeat broadcast (FR-14 wants the link
// inert with one tab open), no peer roster, no nicknames, no chunking (FR-7),
// no code for choosing BETWEEN peers, and no user-facing string of any kind —
// this module produces reason CODES; S11.3 owns the words.

// The channel name is fixed and un-versioned on purpose: two tabs running two
// builds must be able to HEAR each other in order to ignore each other honestly
// (one tab left open across a deploy is an ordinary daily-driver state). The
// version lives in the envelope instead.
const CHANNEL_NAME = 'beastty-peer-link';
const SCHEMA_VERSION = 1;

// Covers the immediate accept/refuse reply only — never the transfer. A
// same-origin channel round trip is sub-millisecond; 2 s is slack for a peer
// that is busy painting, not a transfer budget.
const REPLY_DEADLINE_MS = 2000;

// Nonce table bounds. Pruned LAZILY, on mint and on validate — never by a
// sweeper timer, which would leave a timer running with one tab open and
// contradict FR-14.
const NONCE_TTL_MS = 120_000;   // a drag that takes longer than this has been abandoned
const NONCE_MAX = 32;           // hard cap; oldest-first eviction

// The closed set of refusal codes. Codes, not copy — S11.3 maps each to its
// verbatim sentence. Exported frozen so a consumer can speak this vocabulary
// without re-hardcoding it (the SESSION_LOG_TOOLTIPS precedent).
export const PEER_REFUSAL_CODES = Object.freeze({
    NOT_CONNECTED: 'not-connected',   // the responder has no writer
    BUSY: 'busy',                     // the responder's wire is owned, or a send is pending
    NO_FOLDER: 'no-folder',           // the responder has no usable bound pull folder
    NOT_VISIBLE: 'not-visible',       // the responder's tab is not visible
    PULL_FAILED: 'pull-failed',       // the responder accepted, then the pull failed
    PEER_GONE: 'peer-gone',           // produced LOCALLY by the requester; never travels
});

const REFUSAL_CODE_LIST = Object.freeze(Object.values(PEER_REFUSAL_CODES));
const refusalCodes = new Set(REFUSAL_CODE_LIST);

const KIND_REQUEST = 'request';
const KIND_ACCEPTED = 'accepted';
const KIND_REFUSED = 'refused';
const KIND_FILES = 'files';
const KIND_BYE = 'bye';
const messageKinds = new Set([KIND_REQUEST, KIND_ACCEPTED, KIND_REFUSED, KIND_FILES, KIND_BYE]);

// ===== Module-scope state =====

let channel = null;
let sessionId = null;           // per TAB, minted at wire time, never persisted
let pagehideHandler = null;

const nonces = new Map();       // nonce -> mintedAt ms   (responder side: what this tab stamped onto a drag)
const pending = new Map();      // nonce -> waiter        (requester side: awaiting an outcome)
const outstanding = new Map();  // nonce -> requester id  (responder side: accepted, not yet answered)

// Injected deps (set by wirePeerLink). Every one is read AT ANSWER TIME and
// nothing they return is stored — there must be no copy of this tab's status
// that could disagree with the tab it describes (AC-6).
let isConnectedRef = null;
let isBusyRef = null;
let hasBoundFolderRef = null;
let isVisibleRef = null;
let provideFilesRef = null;

/**
 * wirePeerLink(opts) — one call from main.js, everything injected.
 *
 * opts.isConnected      () => boolean   tx-sink isWriterReady()
 * opts.isBusy           () => boolean   the COMPOSITE session predicate (see main.js)
 * opts.hasBoundFolder   () => boolean   pullPane.isBound()
 * opts.isVisible        () => boolean   document.visibilityState === 'visible'
 * opts.provideFiles     async ({ names, nonce, fromSessionId }) => [{ name, blob }]
 *                                       Optional in S11.2 — absent means this tab
 *                                       can accept but never fulfil, so it answers
 *                                       pull-failed. S11.3 supplies the real one.
 *
 * Idempotent: a second call tears the first down rather than stacking a second
 * channel and a second pagehide listener.
 */
export function wirePeerLink(opts = {}) {
    dispose();

    isConnectedRef = typeof opts.isConnected === 'function' ? opts.isConnected : null;
    isBusyRef = typeof opts.isBusy === 'function' ? opts.isBusy : null;
    hasBoundFolderRef = typeof opts.hasBoundFolder === 'function' ? opts.hasBoundFolder : null;
    isVisibleRef = typeof opts.isVisible === 'function' ? opts.isVisible : null;
    provideFilesRef = typeof opts.provideFiles === 'function' ? opts.provideFiles : null;

    // AC-2 — a TAB identity, minted here and held only in module scope. NOT
    // sessionStorage: that survives a reload AND is copied into a duplicated
    // tab, which would hand two tabs one identity. Nothing in this module reads
    // getInfo(), a VID or a PID; the id identifies the tab, never a beast.
    sessionId = crypto.randomUUID();

    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (ev) => { onChannelMessage(ev && ev.data); };

    // The requester-side cover for "the tab that accepted then went away".
    // Best-effort and fire-and-forget: pagehide has a tight browser time budget
    // (the serial.js:212 rationale), and there is nothing to await.
    pagehideHandler = () => { sayGoodbye(); };
    window.addEventListener('pagehide', pagehideHandler);

    return {
        // On the API rather than bolted onto window.__peerLink by the caller: a
        // re-wire replaces that object wholesale, and anything attached from
        // outside silently disappears with it.
        REFUSAL_CODES: PEER_REFUSAL_CODES,
        getSessionId,
        mintNonce,
        consumeNonce,
        requestFiles,
        dispose,
        __setFileProviderForTests,
        __resetForTests,
        __getStateForTests,
    };
}

export function getSessionId() { return sessionId; }

// ===== Envelope =====

/**
 * The one admission rule, kept pure so a spec can drive it directly.
 *
 * Anything that fails is dropped in total silence — no reply, no side effect, no
 * log line. In particular an envelope of an UNRECOGNISED VERSION is dropped
 * rather than best-effort parsed: two tabs can be running two builds.
 */
export function isEnvelopeForSelf(data, selfId) {
    if (!data || typeof data !== 'object') return false;
    if (data.v !== SCHEMA_VERSION) return false;
    if (typeof data.kind !== 'string' || !messageKinds.has(data.kind)) return false;
    if (typeof data.from !== 'string' || data.from.length === 0) return false;
    if (typeof data.nonce !== 'string' || data.nonce.length === 0) return false;
    if (typeof selfId !== 'string' || selfId.length === 0) return false;
    if (data.to !== selfId) return false;
    if (data.from === selfId) return false;   // a tab never answers itself
    return true;
}

function onChannelMessage(data) {
    if (!isEnvelopeForSelf(data, sessionId)) return;
    switch (data.kind) {
        case KIND_REQUEST:  handleRequest(data); return;
        case KIND_ACCEPTED: handleAccepted(data); return;
        case KIND_REFUSED:  handleRefused(data); return;
        case KIND_FILES:    handleFiles(data); return;
        case KIND_BYE:      handleBye(data); return;
        default: return;
    }
}

// Returns whether the message actually went out. Callers that owe an answer must
// check it: after `accepted` the requester has no deadline left, so a silently
// dropped final message would strand it forever.
function post(fields) {
    if (!channel) return false;
    try {
        channel.postMessage({ v: SCHEMA_VERSION, from: sessionId, ...fields });
        return true;
    } catch {
        // A closing tab, or a Blob the browser refuses to serialise. Before the
        // accept this is harmless — the requester's deadline covers the silence.
        return false;
    }
}

// ===== Nonce table (AC-4) =====

/**
 * One nonce per drag, minted by the tab that OWNS the files (S11.3 calls this at
 * dragstart and stamps the result into the drag payload). It comes back in the
 * peer's request, which is the only way this tab can tell a request it authorised
 * from one it did not.
 */
export function mintNonce() {
    const nonce = crypto.randomUUID();
    nonces.set(nonce, Date.now());
    pruneNonces();
    return nonce;
}

/**
 * Valid exactly once. Retired BEFORE the responder does any work, so a duplicated
 * message cannot start two pulls.
 */
export function consumeNonce(nonce) {
    pruneNonces();
    if (typeof nonce !== 'string' || !nonces.has(nonce)) return false;
    nonces.delete(nonce);
    return true;
}

// Lazy — runs on mint and on validate, never on a timer.
function pruneNonces() {
    const now = Date.now();
    for (const [n, mintedAt] of nonces) {
        if (now - mintedAt > NONCE_TTL_MS) nonces.delete(n);
    }
    // Map iterates in insertion order, which here is mint order, so the first
    // key is always the oldest survivor.
    while (nonces.size > NONCE_MAX) {
        const oldest = nonces.keys().next();
        if (oldest.done) break;
        nonces.delete(oldest.value);
    }
}

// ===== Responder side: self-status and the refusal decision (AC-5, AC-6) =====

// An absent or throwing getter yields the REFUSING value for its field, never
// the permissive one. An unwired harness therefore refuses rather than handing
// out files on the strength of a missing dependency.
function readFlag(fn, fallback) {
    if (typeof fn !== 'function') return fallback;
    try { return !!fn(); } catch { return fallback; }
}

function readSelfStatus() {
    return {
        connected: readFlag(isConnectedRef, false),
        // An answer this tab still owes counts as busy in its own right. The
        // injected isBusy only goes true once the pull has actually started, and
        // there are several awaits between accepting and that moment — long
        // enough for a second peer's request to arrive, pass the same four
        // checks, and put a second pull on one wire.
        busy: readFlag(isBusyRef, true) || outstanding.size > 0,
        bound: readFlag(hasBoundFolderRef, false),
        visible: readFlag(isVisibleRef, false),
    };
}

/**
 * The refusal decision, pure and ordered. First failure wins, so the code the
 * user eventually sees names the most fundamental thing that is wrong.
 *
 * @returns a code from PEER_REFUSAL_CODES, or null when the request may proceed.
 */
export function chooseRefusal(status) {
    if (!status || !status.connected) return PEER_REFUSAL_CODES.NOT_CONNECTED;
    if (status.busy) return PEER_REFUSAL_CODES.BUSY;
    if (!status.bound) return PEER_REFUSAL_CODES.NO_FOLDER;
    if (!status.visible) return PEER_REFUSAL_CODES.NOT_VISIBLE;
    return null;
}

/**
 * The response records. NOT bare Blobs and NOT File objects.
 *
 * Not bare Blobs because the destination's send path duck-types its argument —
 * file-source.js processFiles reads f.name and awaits f.arrayBuffer() and never
 * does an instanceof check. A nameless Blob does not throw there; it makes
 * validateCpmFilename(undefined) return { ok: false, 'empty filename' } and every
 * file lands in the REJECTED rows, so the user gets a modal offering "Send 0
 * files" — or, with the confirm preference off, nothing at all.
 *
 * Not File objects because the name on the responder's disk may not be the name
 * that was asked for: slide-recv's ensureUnique inserts a ~N before the extension
 * on collision, so a pull of WOTBEAST.FTH into a folder that already holds one
 * lands as WOTBEAST~1.FTH. The name that must reach the destination's device is
 * the CP/M name the user dragged, chosen by the responder. S11.3 does the
 * one-line conversion (new File([blob], name)) because it is the send path that
 * imposes the File requirement.
 *
 * Validated in both directions — a malformed payload becomes pull-failed rather
 * than reaching S11.3 as something it will try to construct a File out of.
 */
function sanitiseRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return null;
    const out = [];
    for (const r of records) {
        if (!r || typeof r.name !== 'string' || r.name.length === 0) return null;
        if (!(r.blob instanceof Blob)) return null;
        out.push({ name: r.name, blob: r.blob });
    }
    return out;
}

async function handleRequest(msg) {
    // Retire first, work second (AC-4).
    if (!consumeNonce(msg.nonce)) return;

    const refusal = chooseRefusal(readSelfStatus());
    if (refusal) {
        // Refused without the file provider ever being called.
        post({ kind: KIND_REFUSED, to: msg.from, nonce: msg.nonce, reason: refusal });
        return;
    }

    // Accepted: the single deadline on the requester stops here, and this tab
    // owes exactly one further message.
    outstanding.set(msg.nonce, msg.from);
    post({ kind: KIND_ACCEPTED, to: msg.from, nonce: msg.nonce });

    let records = null;
    try {
        if (provideFilesRef) {
            records = await provideFilesRef({
                names: Array.isArray(msg.names) ? msg.names.slice() : [],
                nonce: msg.nonce,
                fromSessionId: msg.from,
            });
        }
    } catch {
        records = null;
    }

    // A dispose() or __resetForTests() landed while the pull was running, or a
    // pagehide already said goodbye for this nonce. Either way the debt is
    // settled and posting again would be a second outcome for one request.
    if (!outstanding.has(msg.nonce)) return;

    const clean = sanitiseRecords(records);
    const sent = clean
        ? post({ kind: KIND_FILES, to: msg.from, nonce: msg.nonce, files: clean })
        : post({ kind: KIND_REFUSED, to: msg.from, nonce: msg.nonce, reason: PEER_REFUSAL_CODES.PULL_FAILED });
    // The debt is only settled once the answer is actually on the channel. If the
    // post failed, leave the nonce in `outstanding` so pagehide/dispose still owes
    // this requester a `bye` — its deadline was cleared by the accept, so nothing
    // else would ever end its wait.
    if (sent) outstanding.delete(msg.nonce);
}

// Best-effort, on pagehide and on dispose: tell everyone this tab accepted from
// that it is not going to finish. Without it a requester whose peer closes AFTER
// accepting would wait forever, because the accept cleared its deadline.
function sayGoodbye() {
    if (outstanding.size === 0) return;
    for (const [nonce, requesterId] of outstanding) {
        post({ kind: KIND_BYE, to: requesterId, nonce });
    }
    outstanding.clear();
}

// ===== Requester side: one deadline, never a poll (AC-7) =====

function refusal(code) { return { ok: false, reason: code }; }

/**
 * requestFiles({ peerSessionId, nonce, names }) -> Promise<outcome>
 *
 * outcome is exactly one of:
 *   { ok: true,  files: [{ name, blob }] }
 *   { ok: false, reason: <a PEER_REFUSAL_CODES value> }
 *
 * The deadline shape is waitForSendState's (slide.js:1223-1243): ONE non-chained
 * setTimeout, a settled guard, clearTimeout on settle, and the waiter dropped
 * from module scope — not the setTimeout(tick, 10) shape S11.4 removed. A single
 * non-chained deadline can only be made to fire LATE by a hidden tab's clamp,
 * which is the harmless direction; a poll collapses to one or two samples.
 *
 * The deadline is cleared the moment `accepted` arrives, because the transfer
 * that follows has no deadline of its own (§3(d)).
 *
 * Each handler settles with the payload IT received and never by re-reading
 * module state a later message could have changed — the notifyRecvStateTransition
 * discipline (slide-recv.js:716-731).
 */
export function requestFiles(req) {
    const peerSessionId = req && req.peerSessionId;
    const nonce = req && req.nonce;
    const names = Array.isArray(req && req.names) ? req.names.slice() : [];

    // Every unusable argument resolves peer-gone rather than throwing: the
    // caller is a drop handler and has exactly one way to report a failure.
    if (!channel || typeof sessionId !== 'string') return Promise.resolve(refusal(PEER_REFUSAL_CODES.PEER_GONE));
    if (typeof peerSessionId !== 'string' || peerSessionId.length === 0) return Promise.resolve(refusal(PEER_REFUSAL_CODES.PEER_GONE));
    if (peerSessionId === sessionId) return Promise.resolve(refusal(PEER_REFUSAL_CODES.PEER_GONE));
    if (typeof nonce !== 'string' || nonce.length === 0) return Promise.resolve(refusal(PEER_REFUSAL_CODES.PEER_GONE));
    if (pending.has(nonce)) return Promise.resolve(refusal(PEER_REFUSAL_CODES.PEER_GONE));   // single-use on this side too

    return new Promise((resolve) => {
        const waiter = { peerId: peerSessionId, nonce, deadline: null, settle: null };
        let settled = false;
        waiter.settle = (outcome) => {
            if (settled) return;
            settled = true;
            waiter.clearDeadline();
            if (pending.get(nonce) === waiter) pending.delete(nonce);
            resolve(outcome);
        };
        waiter.clearDeadline = () => {
            if (waiter.deadline !== null) {
                clearTimeout(waiter.deadline);   // a leaked timer would outlive the session
                waiter.deadline = null;
            }
        };
        waiter.deadline = setTimeout(() => waiter.settle(refusal(PEER_REFUSAL_CODES.PEER_GONE)), REPLY_DEADLINE_MS);
        pending.set(nonce, waiter);
        post({ kind: KIND_REQUEST, to: peerSessionId, nonce, names });
    });
}

// A reply only counts if it came from the tab we actually asked.
function waiterFor(msg) {
    const waiter = pending.get(msg.nonce);
    if (!waiter || waiter.peerId !== msg.from) return null;
    return waiter;
}

function handleAccepted(msg) {
    const waiter = waiterFor(msg);
    if (!waiter) return;
    // The transfer gets no deadline: a real SLIDE pull over 19200 baud takes
    // seconds to tens of seconds, and timing it out is how S11.4's defect was
    // built. From here the outcome arrives, or a `bye` does.
    waiter.clearDeadline();
}

function handleRefused(msg) {
    const waiter = waiterFor(msg);
    if (!waiter) return;
    // A code outside the closed set means the peer is broken, not that the
    // request succeeded. Report the generic failure rather than hanging.
    const code = (typeof msg.reason === 'string' && refusalCodes.has(msg.reason) && msg.reason !== PEER_REFUSAL_CODES.PEER_GONE)
        ? msg.reason
        : PEER_REFUSAL_CODES.PULL_FAILED;
    waiter.settle(refusal(code));
}

function handleFiles(msg) {
    const waiter = waiterFor(msg);
    if (!waiter) return;
    const clean = sanitiseRecords(msg.files);
    waiter.settle(clean ? { ok: true, files: clean } : refusal(PEER_REFUSAL_CODES.PULL_FAILED));
}

function handleBye(msg) {
    const waiter = waiterFor(msg);
    if (!waiter) return;
    waiter.settle(refusal(PEER_REFUSAL_CODES.PEER_GONE));
}

// Settle on teardown — a waiter left pending across a reset is a test that hangs
// for reasons nobody can find (the forceExitSendMode / __resetForTests discipline
// at slide.js:479-480, :1246).
function abandonPendingRequests() {
    for (const waiter of Array.from(pending.values())) {
        waiter.settle(refusal(PEER_REFUSAL_CODES.PEER_GONE));
    }
    pending.clear();
}

// ===== Lifetime =====

// There is no central teardown in main.js and nothing calls this in production —
// dispose() exists for idempotent re-wire and test isolation, like the other six.
// The channel is the app's first browser resource of its kind, so it gets a real
// close() rather than being left to GC.
export function dispose() {
    sayGoodbye();
    abandonPendingRequests();
    outstanding.clear();
    nonces.clear();
    if (pagehideHandler) {
        window.removeEventListener('pagehide', pagehideHandler);
        pagehideHandler = null;
    }
    if (channel) {
        try { channel.close(); } catch {}
        channel = null;
    }
    sessionId = null;
    isConnectedRef = null;
    isBusyRef = null;
    hasBoundFolderRef = null;
    isVisibleRef = null;
    provideFilesRef = null;
}

// ===== Test surface =====

// S11.3 injects the real provider through wirePeerLink. This exists so a spec
// can drive an accept -> files round trip before that provider exists.
export function __setFileProviderForTests(fn) {
    provideFilesRef = typeof fn === 'function' ? fn : null;
}

export function __resetForTests() {
    abandonPendingRequests();
    // sayGoodbye, not a bare clear: the accept cleared the requester's deadline,
    // so a peer mid-wait in another tab has nothing else that could end it — a
    // reset here would hang the far side for the rest of the run.
    sayGoodbye();
    outstanding.clear();
    nonces.clear();
}

// A fresh plain object with copied collections: no live refs, no functions, so
// it survives the Playwright bridge (the focus.js:26-33 rule).
export function __getStateForTests() {
    let liveDeadlines = 0;
    for (const waiter of pending.values()) if (waiter.deadline !== null) liveDeadlines += 1;
    return {
        wired: channel !== null,
        sessionId,
        schemaVersion: SCHEMA_VERSION,
        channelName: CHANNEL_NAME,
        replyDeadlineMs: REPLY_DEADLINE_MS,
        nonceCount: nonces.size,
        nonces: Array.from(nonces.keys()),
        nonceMax: NONCE_MAX,
        nonceTtlMs: NONCE_TTL_MS,
        pendingRequests: pending.size,   // AC-8 — zero from boot onwards with one tab open
        liveDeadlines,                   // AC-8 — ditto
        outstandingResponses: outstanding.size,
        hasFileProvider: provideFilesRef !== null,
        refusalCodes: REFUSAL_CODE_LIST.slice(),
    };
}
