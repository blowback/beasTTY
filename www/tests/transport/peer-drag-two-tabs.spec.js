// Beastty Epic E11 Story S11.3 — the drag, end to end, across two real tabs.
//
// The single-page spec next door owns the pure rules: the payload, the ownership
// predicate, the code→sentence mapping, this beast's own refusals, the modal,
// the overlay restore. Every one of its "it is ignored" cases carries a positive
// control there.
//
// What genuinely needs two tabs is here, and it is the story's whole claim:
//   - a REAL round trip — tab A runs an ordinary SLIDE pull into its own bound
//     folder, reads the bytes back, hands them over, and tab B's device receives
//     them through the identical local-file send path;
//   - each refusal code, produced by a real peer and turned into its sentence;
//   - the own-payload no-op with two live identities in play;
//   - the source tab hidden MID-pull, which is the ordinary case S11.4 exists
//     for (one glance at a third tab) and the reason the landing signal cannot
//     be routed through the pane's hidden-guarded refresh.
//
// Harness rules inherited from peer-link-two-tabs.spec.js (S11.2 built it; this
// is its second consumer):
//   - the serial mock installs PER PAGE, so context.addInitScript is what gets
//     it into both. Two pages therefore hold two INDEPENDENT mock devices —
//     exactly E11's world: two tabs, two beasts.
//   - both pages boot wasm, and playwright.config.js:19-27 records that
//     concurrent wasm boots starve the connect handshake. Each page is booted to
//     completion before the next one starts, and nothing here is tagged @fast.
//
// Bot-parity note (E9 retro action #1): this spec drives real SLIDE sessions in
// BOTH directions — a recv session on A (the pull) and a send session on B (the
// handoff). Both use the JS mock bot, which is a deliberately independent
// re-implementation of slide-rs (PITFALLS §13) precisely so a drift in the
// production core cannot be masked by a sympathetic bug in the peer. The bot is
// not a second copy of the Rust; that is why a green run here means something.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';
import { MOCK_SERIAL_SLIDE_BOT } from './mock-serial-slide-bot.js';

// A directory-handle stub that supports everything BOTH consumers need:
// slide-recv's write path (getFileHandle({create:true}) → createWritable) and
// S11.3's read-back path (entries() + getFile()). The FSAP spec's stub covers
// only the first; pullForPeer enumerates and reads, so this one is wider.
//
// It also honours ensureUnique's ~N escalation for free: a reserved slot makes
// the next getFileHandle({create:false}) probe succeed, so a collision suffixes
// exactly as the real folder would — which is what makes the "the name that
// reaches B is the name the user DRAGGED" assertion meaningful.
const DIR_STUB = `
(() => {
  window.__dirStub = { handle: null, pickCount: 0, handleName: 'PeerFolder', preloadFiles: [] };
  function makeFile(name, bytes) {
    const blob = new Blob([bytes]);
    return {
      name,
      size: bytes.length,
      lastModified: 1,
      arrayBuffer: () => blob.arrayBuffer(),
      slice: (...a) => blob.slice(...a),
      stream: () => blob.stream(),
      text: () => blob.text(),
      type: '',
      _blob: blob,
    };
  }
  function fileHandleFor(handle, name) {
    return {
      name,
      kind: 'file',
      async getFile() {
        const bytes = handle._files.get(name) || new Uint8Array(0);
        // A real File is a Blob; peer-link's sanitiseRecords does an
        // instanceof Blob check, so hand back a genuine one.
        return new File([bytes], name);
      },
      createWritable: async () => {
        const chunks = [];
        return {
          write: async (d) => { chunks.push(d); },
          close: async () => {
            let combined = new Uint8Array(0);
            if (chunks[0] instanceof Blob) combined = new Uint8Array(await chunks[0].arrayBuffer());
            else if (chunks[0] instanceof Uint8Array) combined = chunks[0];
            handle._files.set(name, combined);
            handle._writeLog.push({ name, bytes: Array.from(combined) });
          },
        };
      },
    };
  }
  window.__makeDirHandle = (name) => {
    const handle = {
      name,
      kind: 'directory',
      _files: new Map(),
      _writeLog: [],
      async *entries() {
        for (const [n] of handle._files) {
          if (handle._files.get(n) === null) continue;   // reserved, not yet written
          yield [n, fileHandleFor(handle, n)];
        }
      },
      async getFileHandle(fileName, opts) {
        if (opts && opts.create) {
          if (!handle._files.has(fileName)) handle._files.set(fileName, null);
          return fileHandleFor(handle, fileName);
        }
        if (handle._files.has(fileName)) return fileHandleFor(handle, fileName);
        const err = new Error('NotFoundError');
        err.name = 'NotFoundError';
        throw err;
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    for (const seed of window.__dirStub.preloadFiles) handle._files.set(seed, new Uint8Array([1, 2, 3]));
    return handle;
  };
  window.showDirectoryPicker = async () => {
    window.__dirStub.pickCount += 1;
    // Reuse an already-picked handle so a rebind cannot silently swap the pane
    // onto an empty folder the writes never reached.
    if (!window.__dirStub.handle) window.__dirStub.handle = window.__makeDirHandle(window.__dirStub.handleName);
    return window.__dirStub.handle;
  };
})();
`;

// One page, booted to completion. Never boot two of these concurrently.
async function bootPage(target) {
    await target.goto('/');
    await target.waitForFunction(() => document.getElementById('terminal').width > 0);
    await target.waitForFunction(
        () => window.__peerDrop && typeof window.__peerDrop.__getStateForTests === 'function',
    );
}

async function connect(target) {
    await target.evaluate(() => window.__menuBar.open('connection'));
    await target.click('#menu-connect-item');
    await expect.poll(
        () => target.evaluate(() => Boolean(navigator.serial._grantedPorts[0]?._reader)),
        { timeout: 5000 },
    ).toBe(true);
}

// Make this page a usable SOURCE: a bound folder that slide-recv will actually
// write to, and that the pane will enumerate. Both must be the SAME handle or
// the read-back diffs a folder nothing landed in.
//
// slideRecvToFolder is set explicitly. It defaults to FALSE (prefs.js:44) and
// that is not a detail: with it off, the pull runs, every file goes to the
// browser's Downloads tray, onFileLanded never fires, and a requester would
// stall silently — which is why main.js's hasBoundFolder now ANDs it in.
// The folder is bound through slide-recv's OWN picker (Settings ▸ SLIDE File
// Transfer… ▸ Choose folder…), not by writing the handle into IDB. A stub handle
// carries functions and IndexedDB refuses to structured-clone it
// (DataCloneError) — so an IDB route would leave slide-recv's cachedHandle null,
// every file would go to the Downloads tray, and the spec would be testing the
// fallback while claiming to test the folder. The picker route populates
// cachedHandle directly, which is what the FSAP spec does for the same reason.
async function makeSource(target, { preload = [] } = {}) {
    await target.evaluate((seeds) => { window.__dirStub.preloadFiles = seeds; }, preload);
    await target.evaluate(() => window.__menuBar.open('settings'));
    await target.click('#dropdown-settings .menu-item[data-action="slide-config"]');
    await target.locator('#slide-config-modal').waitFor({ state: 'visible' });
    await target.locator('#slide-recv-to-folder-checkbox')
        .evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await target.click('#slide-recv-folder-button');
    await expect(target.locator('#slide-recv-folder-status')).toHaveText('Saving to: PeerFolder');
    await target.click('#slide-config-close');
    await target.locator('#slide-config-modal').waitFor({ state: 'hidden' });

    await target.evaluate(async () => {
        // slideRecvToFolder must be true in BOTH places: savePrefs feeds
        // getPrefs(), which main.js's widened hasBoundFolder reads, and `live` is
        // the very object slide-recv was handed at wire time and consults on
        // every write. Setting only one leaves the two halves disagreeing — the
        // request is accepted and the files then go to the Downloads tray.
        window.__prefs.savePrefs({ slideRecvToFolder: true });
        window.__prefs.live.slideRecvToFolder = true;
        // The pane reads back from the SAME handle slide-recv writes to. If these
        // two ever pointed at different folders the read-back would diff a folder
        // nothing landed in.
        await window.__pullPane.__setDirHandleForTests(window.__dirStub.handle);
    });
    await expect.poll(() => target.evaluate(() => window.__pullPane.isBound()), { timeout: 5000 }).toBe(true);
}

// The bot answers the pull the way a MicroBeast would: it waits until the
// command bytes are actually on the wire, THEN wakes up and sends. Watching the
// writer log rather than sleeping is what keeps this honest — if the pull
// command were never composed, this would time out instead of passing on a
// coincidence.
async function answerPullWith(target, files) {
    await target.evaluate((f) => {
        window.__mockSlideBot.reset();
        window.__mockSlideBot.setRole('send');
        window.__peerPullWatch = { armed: true };
        window.__mockSlideBot.queueSendFiles(f.map((x) => ({ name: x.name, bytes: new Uint8Array(x.bytes) })));
    }, files.map((f) => ({ name: f.name, bytes: Array.from(f.bytes) })));

    // Wait for `<program> S <names>` to reach the wire.
    await expect.poll(
        () => target.evaluate(() => window.__mockWriterLog
            .map((w) => String.fromCharCode(...w.bytes))
            .join('')
            .includes(' S ')),
        { timeout: 10_000 },
    ).toBe(true);

    await target.evaluate(() => window.__mockSlideBot.pushSlideHostWakeup());
    await expect.poll(
        () => target.evaluate(() => window.__slide.__getStateForTests().mode),
        { timeout: 10_000 },
    ).toBe('recv');
    await target.evaluate(() => window.__mockSlideBot.startSendSession());
}

// Make this page a usable DESTINATION: its bot plays the MicroBeast on the
// receiving end of the ordinary local-file send the handover turns into.
async function makeDest(target) {
    await target.evaluate(() => {
        window.__mockSlideBot.reset();
        window.__mockSlideBot.setRole('recv');
        window.__mockSlideBot.enable();
    });
}

// The destination's Z80 answers the auto-typed `<program> R`. enterSendMode
// arms a pending send session and waits for the wakeup signature; without this
// the send sits in awaiting-wakeup forever and no byte reaches the device.
// Waiting on the pending session rather than sleeping keeps it honest: if the
// handover never reached sendFiles, this times out instead of passing on a
// coincidence.
async function answerSendOn(target) {
    await expect.poll(
        () => target.evaluate(() => Boolean(window.__slide.__getStateForTests().hasPendingSendSession)),
        { timeout: 20_000 },
    ).toBe(true);
    await target.evaluate(() => window.__mockSlideBot.pushSlideWakeup());
}

// Stamp a drag on tab A exactly as its dragstart would, then hand the payload to
// tab B. Nothing is faked: the session id and the nonce both come from A's own
// production stamp.
async function stampOn(source, text) {
    const stamp = await source.evaluate((t) => window.__peerDrop.getPeerStamp(t), text);
    expect(stamp, 'tab A stamped no payload for this selection').not.toBeNull();
    return stamp.payload;
}

// Drop it on B's terminal. Confirm is turned off so the transfer starts on drop —
// the modal is the single-page spec's subject, not this one's.
async function dropOn(dest, payload, { confirm = false } = {}) {
    await dest.evaluate((c) => window.__prefs.savePrefs({ slideConfirmTransfers: c }), confirm);
    await dest.evaluate((p) => {
        const dt = new DataTransfer();
        dt.setData('application/x-beastty-peer-drag', p);
        const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
        document.getElementById('terminal-wrapper').dispatchEvent(e);
    }, payload);
}

const noticeOn = (target) => target.evaluate(() => window.__peerDrop.__getStateForTests().lastNotice);

test.describe('E11 S11.3 — a filename dragged onto the other beast, two real tabs', () => {
    test.slow();   // two wasm boots and up to two real SLIDE sessions per case

    test.beforeEach(async ({ context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await context.addInitScript(MOCK_SERIAL_SLIDE_BOT);
        await context.addInitScript(DIR_STUB);
    });

    test('AC-6 a single-file drag A→B lands on B\'s device under the name the user dragged', async ({ page, context }) => {
        const tabA = page;                       // the source — holds the file
        await bootPage(tabA);
        await connect(tabA);
        const tabB = await context.newPage();    // the destination — receives it
        await bootPage(tabB);
        await connect(tabB);

        await makeSource(tabA);
        // B's bot plays the MicroBeast on the receiving end of the ordinary send.
        await makeDest(tabB);

        const fixture = [0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03];
        const payload = await stampOn(tabA, 'WOTBEAST.FTH');
        await dropOn(tabB, payload);
        await answerPullWith(tabA, [{ name: 'WOTBEAST.FTH', bytes: fixture }]);
        await answerSendOn(tabB);

        // A's own SLIDE chip showed A's own pull, and the file is in A's folder —
        // the copy stays there afterwards (AC-6's last clause: this is a COPY,
        // nothing deletes, renames or rewrites anything on A).
        await expect.poll(
            () => tabA.evaluate(() => window.__dirStub.handle._writeLog.map((w) => w.name)),
            { timeout: 15_000 },
        ).toEqual(['WOTBEAST.FTH']);

        // And B's DEVICE received it, through the identical validate → truncate →
        // collision → enterSendMode path an ordinary local-file send uses.
        await expect.poll(
            () => tabB.evaluate(() => window.__mockSlideBot.getReceivedFilenames()),
            { timeout: 20_000 },
        ).toEqual(['WOTBEAST.FTH']);
        expect(await tabB.evaluate(() => window.__mockSlideBot.getReceivedBytes(0))).toEqual(fixture);

        // Both links are back at rest: one outcome, no waiter, no timer, and no
        // peer pull left in flight on either side.
        const linkB = await tabB.evaluate(() => window.__peerLink.__getStateForTests());
        expect(linkB.pendingRequests).toBe(0);
        expect(linkB.liveDeadlines).toBe(0);
        expect(await tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull)).toBeNull();
        expect(await tabA.evaluate(() => window.__peerLink.__getStateForTests().outstandingResponses)).toBe(0);
        await tabB.close();
    });

    test('AC-6 a multi-file drag pulls in command order and sends as ONE batch', async ({ page, context }) => {
        const tabA = page;
        await bootPage(tabA);
        await connect(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);

        await makeSource(tabA);
        await makeDest(tabB);

        const files = [
            { name: 'ONE.BIN', bytes: [0x11, 0x11, 0x11] },
            { name: 'TWO.BIN', bytes: [0x22, 0x22, 0x22] },
            { name: 'THREE.BIN', bytes: [0x33, 0x33, 0x33] },
        ];
        const payload = await stampOn(tabA, 'ONE.BIN TWO.BIN THREE.BIN');
        await dropOn(tabB, payload);
        await answerPullWith(tabA, files);
        await answerSendOn(tabB);

        // Arrival order is command order — the assumption §5(e) records, pinned
        // here rather than left to chance.
        await expect.poll(
            () => tabB.evaluate(() => window.__mockSlideBot.getReceivedFilenames()),
            { timeout: 25_000 },
        ).toEqual(['ONE.BIN', 'TWO.BIN', 'THREE.BIN']);
        for (let i = 0; i < files.length; i += 1) {
            expect(await tabB.evaluate((n) => window.__mockSlideBot.getReceivedBytes(n), i))
                .toEqual(files[i].bytes);
        }
        // FR-12's send half needs nothing more than ONE sendFiles call: the N/M
        // batch hint comes from the array length passed to enterSendMode. Three
        // files, ONE send session — proven by the auto-typed `<program> R`
        // appearing exactly once on B's wire. A per-file loop would have started
        // three sessions and typed it three times. (Reading total_files instead
        // would be a race: the session is over by the time the files have all
        // arrived, and the counter is gone with it.)
        const autoSends = await tabB.evaluate(() => {
            const wire = window.__mockWriterLog.map((w) => String.fromCharCode(...w.bytes)).join('');
            return wire.split('A:SLIDE.COM R').length - 1;
        });
        expect(autoSends).toBe(1);
        await tabB.close();
    });

    test('AC-6/§3(g) a ~N-suffixed disk copy still reaches B under the DRAGGED name', async ({ page, context }) => {
        // ensureUnique inserts ~N before the extension on collision and reports
        // nothing back. If the read-back asked the folder for the requested name,
        // or handed the disk name over, B's device would receive WOTBEAST~1.FTH.
        const tabA = page;
        await bootPage(tabA);
        await connect(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);

        // A SHORT base on purpose. With a long one the proof evaporates:
        // WOTBEAST~1.FTH truncates back to WOTBEAST.FTH under file-source's own
        // 8.3 rule, so B would receive the right name even if the pane handed
        // over the wrong one — a spec passing for the wrong reason (verified: the
        // long-name version of this case survives the mutation that hands over
        // the disk name). WOT~1.FTH fits 8.3 unchanged, so the suffix survives
        // all the way to the device if it is ever handed over.
        await makeSource(tabA, { preload: ['WOT.FTH'] });
        await makeDest(tabB);

        const fixture = [0xAA, 0xBB, 0xCC];
        const payload = await stampOn(tabA, 'WOT.FTH');
        await dropOn(tabB, payload);
        await answerPullWith(tabA, [{ name: 'WOT.FTH', bytes: fixture }]);
        await answerSendOn(tabB);

        // The disk copy IS suffixed…
        await expect.poll(
            () => tabA.evaluate(() => window.__dirStub.handle._writeLog.map((w) => w.name)),
            { timeout: 15_000 },
        ).toEqual(['WOT~1.FTH']);
        // …and the name that reached B's device is the one the user dragged.
        await expect.poll(
            () => tabB.evaluate(() => window.__mockSlideBot.getReceivedFilenames()),
            { timeout: 20_000 },
        ).toEqual(['WOT.FTH']);
        expect(await tabB.evaluate(() => window.__mockSlideBot.getReceivedBytes(0))).toEqual(fixture);
        await tabB.close();
    });

    test('AC-7 hiding the source tab MID-pull does not fail, cancel or stall the transfer', async ({ page, context }) => {
        // The ordinary case S11.4 exists for: one glance at a third tab during a
        // 19200-baud pull. triggerRefresh early-returns while document.hidden, so
        // routing the landing signal through it would hang the provider here.
        const tabA = page;
        await bootPage(tabA);
        await connect(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);

        await makeSource(tabA);
        await makeDest(tabB);

        // Hide A for real: override the visibility getters and fire the event, the
        // shape chrome.js's own hidden-tab handling is tested with. FR-11 checks
        // visibility at REQUEST time and A is visible then; this hides it after.
        const fixture = [0x5A, 0x5A, 0x5A, 0x5A];
        const payload = await stampOn(tabA, 'HIDDEN.BIN');
        await dropOn(tabB, payload);

        await expect.poll(
            () => tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull !== null),
            { timeout: 10_000 },
        ).toBe(true);
        await tabA.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        // The pane's own refresh is now inert — which is the point.
        expect(await tabA.evaluate(() => document.hidden)).toBe(true);

        await answerPullWith(tabA, [{ name: 'HIDDEN.BIN', bytes: fixture }]);
        await answerSendOn(tabB);

        // The landing signal came from onFileLanded, not from the refresh, so the
        // transfer completes with A hidden throughout.
        await expect.poll(
            () => tabB.evaluate(() => window.__mockSlideBot.getReceivedFilenames()),
            { timeout: 25_000 },
        ).toEqual(['HIDDEN.BIN']);
        expect(await tabB.evaluate(() => window.__mockSlideBot.getReceivedBytes(0))).toEqual(fixture);
        // Nothing invented a failure while it was hidden.
        expect(await noticeOn(tabB)).toBe('');

        // And it completed for the RIGHT reason: 'complete' means the landing
        // counter reached the file count, which is the onFileLanded callback —
        // the one signal that fires regardless of visibility. 'ended' would mean
        // the session-end backstop covered for a landing signal that never
        // arrived, which is exactly what routing the counter through the pane's
        // hidden-guarded refresh would produce: still green end to end, 1.5 s
        // slower, and for the wrong reason. (Verified: without this assertion the
        // case survives that mutation.)
        expect(await tabA.evaluate(() => window.__pullPane.__getStateForTests().lastPeerPullReason))
            .toBe('complete');
        await tabB.close();
    });

    test('AC-8 every refusal the other beast can give arrives as its own sentence', async ({ page, context }) => {
        const tabA = page;
        await bootPage(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);   // B must pass its OWN checks or it never asks

        // Each case re-wires A's link with the one self-check under test failing,
        // then runs a real request from B and reads the sentence B shows.
        const cases = [
            { flags: { connected: false, busy: false, bound: true, visible: true },
              sentence: "The other beast isn't connected. Connect it in its tab and try again." },
            { flags: { connected: true, busy: true, bound: true, visible: true },
              sentence: 'The other beast is mid-transfer. Wait for it to finish and try again.' },
            { flags: { connected: true, busy: false, bound: false, visible: true },
              sentence: 'The other beast has no pull folder yet. Choose one in its pull pane and try again.' },
            { flags: { connected: true, busy: false, bound: true, visible: false },
              sentence: "The other beast's tab isn't visible. Put both tabs side by side in Split View and try again." },
        ];

        for (const c of cases) {
            const stamp = await tabA.evaluate(async (f) => {
                const m = await import('/transport/peer-link.js');
                const api = m.wirePeerLink({
                    isConnected: () => f.connected,
                    isBusy: () => f.busy,
                    hasBoundFolder: () => f.bound,
                    isVisible: () => f.visible,
                    // A provider that would succeed if it were ever reached. It is
                    // not: the four self-checks run BEFORE the provider is called,
                    // so a refusal here is a refusal and not a hidden failure.
                    provideFiles: async ({ names }) =>
                        names.map((n) => ({ name: n, blob: new Blob([new Uint8Array([1, 2, 3])]) })),
                });
                window.__peerLink = api;
                return JSON.stringify({
                    v: 1, sessionId: api.getSessionId(), nonce: api.mintNonce(), names: ['A.TXT'],
                });
            }, c.flags);

            await dropOn(tabB, stamp);
            await expect.poll(() => noticeOn(tabB), { timeout: 10_000 }).toBe(c.sentence);
        }

        // POSITIVE CONTROL — the same two tabs with all four checks passing get
        // FILES, not a sentence. Without it the four cases above are green
        // against a peer that refuses everything unconditionally.
        await tabB.evaluate(() => window.__peerDrop.__resetForTests());
        const good = await tabA.evaluate(async () => {
            const m = await import('/transport/peer-link.js');
            const api = m.wirePeerLink({
                isConnected: () => true, isBusy: () => false,
                hasBoundFolder: () => true, isVisible: () => true,
                provideFiles: async ({ names }) =>
                    names.map((n) => ({ name: n, blob: new Blob([new Uint8Array([1, 2, 3])]) })),
            });
            window.__peerLink = api;
            return JSON.stringify({
                v: 1, sessionId: api.getSessionId(), nonce: api.mintNonce(), names: ['A.TXT'],
            });
        });
        await makeDest(tabB);
        await dropOn(tabB, good);
        await answerSendOn(tabB);
        await expect.poll(
            () => tabB.evaluate(() => window.__mockSlideBot.getReceivedFilenames()),
            { timeout: 20_000 },
        ).toEqual(['A.TXT']);
        expect(await noticeOn(tabB)).toBe('');
        await tabB.close();
    });

    test('AC-8 a peer that has gone is named as gone, not as a silent stall', async ({ page, context }) => {
        const tabA = page;
        await bootPage(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);

        const payload = await stampOn(tabA, 'GONE.BIN');
        await tabA.close();   // the drag payload is still valid in B's hand

        await dropOn(tabB, payload);
        await expect.poll(() => noticeOn(tabB), { timeout: 10_000 })
            .toBe("The other beast's tab has gone. Reopen it and try again.");
        // And B is back at rest rather than holding a waiter open.
        const link = await tabB.evaluate(() => window.__peerLink.__getStateForTests());
        expect(link.pendingRequests).toBe(0);
        expect(link.liveDeadlines).toBe(0);
        await tabB.close();
    });

    test('AC-8/§3(e) a bound folder with recv-to-folder OFF refuses honestly instead of stalling', async ({ page, context }) => {
        // The defect this story found. isBound() is not "usable pull folder":
        // slide-recv only writes to the folder when slideRecvToFolder is on, and
        // that pref defaults to FALSE. With it off, A used to accept, pull every
        // file to the browser's Downloads tray, never fire a landing, and leave B
        // waiting forever — its single deadline already cleared by the accept.
        const tabA = page;
        await bootPage(tabA);
        await connect(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);

        await makeSource(tabA);
        // The Settings checkbox turns it back off with the folder still bound.
        await tabA.evaluate(() => {
            window.__prefs.savePrefs({ slideRecvToFolder: false });
            window.__prefs.live.slideRecvToFolder = false;
        });
        expect(await tabA.evaluate(() => window.__pullPane.isBound())).toBe(true);   // still bound…

        const payload = await stampOn(tabA, 'STALL.BIN');
        await dropOn(tabB, payload);

        // …and the answer is no-folder's sentence, which sends the user to the
        // pull pane — where they re-pick the folder and re-set the pref.
        await expect.poll(() => noticeOn(tabB), { timeout: 10_000 })
            .toBe('The other beast has no pull folder yet. Choose one in its pull pane and try again.');
        // Refused BEFORE the provider ran: no pull was started on A.
        expect(await tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull)).toBeNull();
        expect(await tabA.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');

        // POSITIVE CONTROL — the pref back on, the same drag is accepted and A
        // starts a real pull. Without it the refusal above is green against a
        // peer that refuses regardless of the pref.
        await tabA.evaluate(() => {
            window.__prefs.savePrefs({ slideRecvToFolder: true });
            window.__prefs.live.slideRecvToFolder = true;
        });
        await tabB.evaluate(() => window.__peerDrop.__resetForTests());
        const again = await stampOn(tabA, 'STALL.BIN');
        await dropOn(tabB, again);
        await expect.poll(
            () => tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull !== null),
            { timeout: 10_000 },
        ).toBe(true);
        await tabB.close();
    });

    test('AC-3 a tab\'s own payload on its own terminal is inert, with two identities live', async ({ page, context }) => {
        const tabA = page;
        await bootPage(tabA);
        await connect(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);
        await makeSource(tabA);

        // A stamps a drag and drops it on ITS OWN terminal.
        const own = await stampOn(tabA, 'SELF.BIN');
        await dropOn(tabA, own);
        await tabA.waitForTimeout(500);   // settle before a NEGATIVE assertion only

        const stA = await tabA.evaluate(() => window.__peerDrop.__getStateForTests());
        expect(stA.requestCount).toBe(0);       // nothing asked
        expect(stA.modalOpen).toBe(false);      // no ceremony
        expect(stA.lastNotice).toBe('');        // no error invented
        expect(await tabA.evaluate(() => window.__slide.__getStateForTests().mode)).toBe('terminal');
        expect(await tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull)).toBeNull();
        // B heard nothing either — the request was never posted.
        expect((await tabB.evaluate(() => window.__peerLink.__getStateForTests())).outstandingResponses).toBe(0);

        // POSITIVE CONTROL — the SAME stamp dropped on B is not inert. Both
        // identities are live and the only difference is which terminal it landed
        // on, which is the whole of FR-3.
        await makeDest(tabB);
        const forB = await stampOn(tabA, 'SELF.BIN');
        await dropOn(tabB, forB);
        await expect.poll(
            () => tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull !== null),
            { timeout: 10_000 },
        ).toBe(true);
        await tabB.close();
    });

    test('AC-7 a pull that never wakes resolves rather than waiting forever', async ({ page, context }) => {
        // "A wakeup that never came" — neither event source covers it: no file
        // lands, and the chip sits in awaiting-wakeup, which is not terminal. The
        // start deadline is the only bound, and it is scoped to the HANDSHAKE:
        // once a session goes active it is cleared, so a real transfer of any
        // length is never timed out.
        const tabA = page;
        await bootPage(tabA);
        await connect(tabA);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);
        await makeSource(tabA);

        const payload = await stampOn(tabA, 'NOWAKE.BIN');
        await dropOn(tabB, payload);

        // The pull starts…
        await expect.poll(
            () => tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull !== null),
            { timeout: 10_000 },
        ).toBe(true);
        // …with exactly ONE live backstop, never a growing chain of them.
        expect((await tabA.evaluate(() => window.__pullPane.__getStateForTests())).peerPull.timers).toBe(1);

        // The bot never wakes. Rather than wait out the real 30 s deadline, cancel
        // the session the way a port-lost or a user cancel would — the chip's
        // terminal transition is the SECOND event source, and it must end the wait.
        await tabA.evaluate(() => window.__slideChip.enterError('wire desync'));
        await expect.poll(() => noticeOn(tabB), { timeout: 15_000 })
            .toBe("Couldn't fetch NOWAKE.BIN from the other beast. It's unchanged there — try the drag again.");
        expect(await tabA.evaluate(() => window.__pullPane.__getStateForTests().peerPull)).toBeNull();
        await tabB.close();
    });
});
