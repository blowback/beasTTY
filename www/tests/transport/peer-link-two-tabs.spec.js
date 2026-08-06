// Beastty Epic E11 Story S11.2 — the cross-tab peer link, two real tabs.
//
// No spec in this repo had ever opened a second page: all 82 were
// `async ({ page })` with one `page.goto('/')`. So the harness below is a
// deliverable of this story, not a given.
//
// What it has to get right, and what bites if it does not:
//   - the serial mock installs PER PAGE (mock-serial.js passes a string to
//     addInitScript), so context.addInitScript is what gets it into both. Two
//     pages therefore hold two INDEPENDENT mock devices, which is exactly E11's
//     world: two tabs, two beasts.
//   - both pages boot wasm, and playwright.config.js:19-27 records that
//     concurrent wasm boots starve the connect handshake. Each page is booted to
//     completion before the next one starts, and no case here is tagged @fast.
//   - a page that has not finished booting has no window.__peerLink, and an
//     assertion against a half-booted page B is easier to write than to notice
//     (the S11.1 review found the one-page version of that mistake).
//
// The single-page spec next door covers the trust rules — every ignore case with
// its positive control, the nonce table, the refusal ordering. What genuinely
// needs two tabs is here: two identities, a real round trip, a real refusal, the
// blob handover across a process boundary, and the requester's two-phase wait.
//
// so this spec wedges without transport/peer-link.js's addressed envelope.
import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from './mock-serial.js';

const KB = 1024;
const BIG_BLOB_BYTES = 256 * KB;

// One page, booted to completion. Never boot two of these concurrently.
async function bootPage(target) {
    await target.goto('/');
    await target.waitForFunction(() => document.getElementById('terminal').width > 0);
    await target.waitForFunction(
        () => window.__peerLink && typeof window.__peerLink.__getStateForTests === 'function',
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

// Make this page a willing responder. The four self-checks are faked because a
// Playwright page has no MicroBeast writer and no FSA folder handle; everything
// else (the channel, the envelope, the nonce table, the handover) is production
// code.
//
// `provider` names one of a fixed set of LITERAL functions defined in the page.
// Not a source string compiled with new Function(): the page's CSP is
// script-src 'self' 'wasm-unsafe-eval', so that throws EvalError — and since a
// throwing provider is itself a pull-failed case, a string-compiled harness
// would look like it was testing the payload while never building one.
//
//   'big'  — one Blob of BIG_BLOB_BYTES under the name that was ASKED FOR, which
//            is the point of §3(a): the responder's disk copy may carry a ~N
//            suffix (slide-recv's ensureUnique) and that is not the name that
//            must reach the other beast's device.
//   'hang' — accepts, then works forever. The shape of a real SLIDE pull that
//            has not finished yet.
//   null   — no provider at all (main.js's S11.2 wiring).
async function makeResponder(target, { flags, provider = null }) {
    return target.evaluate(async ({ f, kind, bigBytes }) => {
        const m = await import('/transport/peer-link.js');
        const providers = {
            big: async ({ names }) => names.map((n, i) => {
                const bytes = new Uint8Array(bigBytes);
                bytes.fill(0x40 + i);
                bytes.set([0xAA, 0xBB, 0xCC, 0xDD], 0);
                bytes.set([0x11, 0x22, 0x33, 0x44], bytes.length - 4);
                return { name: n, blob: new Blob([bytes]) };
            }),
            hang: () => new Promise(() => {}),
        };
        const api = m.wirePeerLink({
            isConnected: () => f.connected,
            isBusy: () => f.busy,
            hasBoundFolder: () => f.bound,
            isVisible: () => f.visible,
            provideFiles: kind ? providers[kind] : undefined,
        });
        window.__peerLink = api;
        return api.getSessionId();
    }, { f: flags, kind: provider, bigBytes: BIG_BLOB_BYTES });
}

const ALL_PASS = { connected: true, busy: false, bound: true, visible: true };

// The drag payload S11.3 will stamp: the responder's session id plus a nonce
// only the responder could have minted. Both are read from tab A, exactly as a
// real dragstart would produce them.
async function stampDrag(responder) {
    return responder.evaluate(() => ({
        peerSessionId: window.__peerLink.getSessionId(),
        nonce: window.__peerLink.mintNonce(),
    }));
}

// Run the request from tab B and bring the outcome back across the bridge. A
// Blob cannot cross it, so the files are projected to name + size + a byte
// sample read with .arrayBuffer() (NOT fetch(objectURL) — CSP is
// connect-src 'self' with no blob:, so an object URL fetch is blocked outright).
async function requestFrom(requester, drag, names) {
    return requester.evaluate(async ({ d, n }) => {
        const outcome = await window.__peerLink.requestFiles({ ...d, names: n });
        if (!outcome.ok) return outcome;
        const files = [];
        for (const f of outcome.files) {
            const buf = await f.blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            files.push({
                name: f.name,
                isBlob: f.blob instanceof Blob,
                size: bytes.length,
                head: Array.from(bytes.slice(0, 4)),
                tail: Array.from(bytes.slice(-4)),
            });
        }
        return { ok: true, files };
    }, { d: drag, n: names });
}

test.describe('E11 S11.2 — the cross-tab peer link, two real tabs', () => {
    test.slow();   // two wasm boots per case, serialised on purpose

    test('AC-2/AC-12 two tabs hold two different session identities', async ({ page, context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await bootPage(page);
        const tabB = await context.newPage();
        await bootPage(tabB);

        const idA = await page.evaluate(() => window.__peerLink.getSessionId());
        const idB = await tabB.evaluate(() => window.__peerLink.getSessionId());
        expect(idA).toMatch(/^[0-9a-f]{8}-/);
        expect(idB).toMatch(/^[0-9a-f]{8}-/);
        expect(idA).not.toBe(idB);

        // FR-14 — neither tab has invented any work merely by the other existing.
        for (const t of [page, tabB]) {
            const st = await t.evaluate(() => window.__peerLink.__getStateForTests());
            expect(st.pendingRequests).toBe(0);
            expect(st.liveDeadlines).toBe(0);
            expect(st.outstandingResponses).toBe(0);
        }
        await tabB.close();
    });

    test('AC-9/AC-11 a multi-kilobyte handover crosses two tabs as a Blob, under the dragged name', async ({ page, context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await bootPage(page);                       // tab A — the responder
        const tabB = await context.newPage();
        await bootPage(tabB);                       // tab B — the requester

        await makeResponder(page, { flags: ALL_PASS, provider: 'big' });
        const drag = await stampDrag(page);

        const outcome = await requestFrom(tabB, drag, ['WOTBEAST.FTH']);
        expect(outcome.ok).toBe(true);
        expect(outcome.files).toHaveLength(1);
        // The name is the one the user dragged, carried as an explicit field —
        // NOT inferred from a bare Blob (which has none) and not the responder's
        // possibly ~N-suffixed disk name.
        expect(outcome.files[0].name).toBe('WOTBEAST.FTH');
        expect(outcome.files[0].isBlob).toBe(true);
        expect(outcome.files[0].size).toBe(BIG_BLOB_BYTES);
        expect(outcome.files[0].head).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);
        expect(outcome.files[0].tail).toEqual([0x11, 0x22, 0x33, 0x44]);

        // Both sides are back to rest: one outcome, no waiter, no timer, and the
        // nonce retired.
        const stA = await page.evaluate(() => window.__peerLink.__getStateForTests());
        const stB = await tabB.evaluate(() => window.__peerLink.__getStateForTests());
        expect(stA.nonceCount).toBe(0);
        expect(stA.outstandingResponses).toBe(0);
        expect(stB.pendingRequests).toBe(0);
        expect(stB.liveDeadlines).toBe(0);
        await tabB.close();
    });

    test('AC-9 the handover stalls neither tab: both read loops and the wire stay live across it', async ({ page, context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await bootPage(page);
        await connect(page);
        const tabB = await context.newPage();
        await bootPage(tabB);
        await connect(tabB);

        // Liveness oracle, before: bytes pushed through each page's mock reader
        // reach its grid (the readloop.spec.js:25-34 round trip).
        const readRow = (t) => t.evaluate(() => {
            const g = window.__testGridView();
            return String.fromCharCode(g[0], g[8], g[16], g[24], g[32]);
        });
        for (const t of [page, tabB]) {
            await t.evaluate(() => window.__mockReaderPush([0x42, 0x45, 0x46, 0x4F, 0x52]));   // BEFOR
            await expect.poll(() => readRow(t), { timeout: 5000 }).toBe('BEFOR');
        }

        await makeResponder(page, { flags: ALL_PASS, provider: 'big' });
        const drag = await stampDrag(page);
        const outcome = await requestFrom(tabB, drag, ['BIG.BIN']);
        expect(outcome.ok).toBe(true);
        expect(outcome.files[0].size).toBe(BIG_BLOB_BYTES);

        // Liveness oracle, after: a quarter-megabyte moved between the tabs and
        // neither read loop wedged. A Blob travels as a handle into the browser-
        // process blob store; an ArrayBuffer in the same message would have been
        // structured-CLONED synchronously on the sending thread, because
        // BroadcastChannel.postMessage takes no transfer list.
        for (const t of [page, tabB]) {
            // CR LF then AFTER — VT52: CR is column 0, LF is the next row.
            await t.evaluate(() => window.__mockReaderPush([0x0D, 0x0A, 0x41, 0x46, 0x54, 0x45, 0x52]));
            await expect.poll(
                () => t.evaluate(() => {
                    const g = window.__testGridView();
                    const row1 = 80 * 8;
                    return String.fromCharCode(g[row1], g[row1 + 8], g[row1 + 16], g[row1 + 24], g[row1 + 32]);
                }),
                { timeout: 5000 },
            ).toBe('AFTER');
        }

        // Wire pacing, after: the responder can still put a byte on the wire.
        const before = await page.evaluate(() => window.__mockWriterLog.length);
        await page.locator('#terminal-wrapper').focus();
        await page.keyboard.press('K');
        await expect.poll(
            () => page.evaluate(() => window.__mockWriterLog.length),
            { timeout: 5000 },
        ).toBeGreaterThan(before);
        await tabB.close();
    });

    test('AC-11 a refusal round trip carries a code, not a sentence', async ({ page, context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await bootPage(page);
        const tabB = await context.newPage();
        await bootPage(tabB);

        const cases = [
            { flags: { ...ALL_PASS, connected: false }, code: 'not-connected' },
            { flags: { ...ALL_PASS, busy: true }, code: 'busy' },
            { flags: { ...ALL_PASS, bound: false }, code: 'no-folder' },
            { flags: { ...ALL_PASS, visible: false }, code: 'not-visible' },
        ];

        for (const c of cases) {
            await makeResponder(page, { flags: c.flags, provider: 'big' });
            const drag = await stampDrag(page);
            const outcome = await requestFrom(tabB, drag, ['A.TXT']);
            expect(outcome, `flags: ${JSON.stringify(c.flags)}`).toEqual({ ok: false, reason: c.code });
        }

        // Every code that came back is in the frozen closed set, and none of them
        // is a sentence — S11.3 owns the words.
        const codes = await tabB.evaluate(() => Object.values(window.__peerLink.REFUSAL_CODES));
        for (const c of cases) expect(codes).toContain(c.code);

        // CONTROL: the same two tabs, all four checks passing, files come back.
        await makeResponder(page, { flags: ALL_PASS, provider: 'big' });
        const drag = await stampDrag(page);
        expect((await requestFrom(tabB, drag, ['A.TXT'])).ok).toBe(true);
        await tabB.close();
    });

    test('AC-7 a peer that is gone before it answers resolves peer-gone on one deadline', async ({ page, context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await bootPage(page);
        const tabB = await context.newPage();
        await bootPage(tabB);

        await makeResponder(page, { flags: ALL_PASS, provider: 'big' });
        const drag = await stampDrag(page);
        const deadlineMs = await tabB.evaluate(() => window.__peerLink.__getStateForTests().replyDeadlineMs);

        // Tab A goes away with the drag payload still valid in tab B's hand.
        await page.close();

        const started = Date.now();
        const outcome = await requestFrom(tabB, drag, ['A.TXT']);
        const elapsed = Date.now() - started;

        expect(outcome).toEqual({ ok: false, reason: 'peer-gone' });
        expect(elapsed).toBeGreaterThanOrEqual(deadlineMs - 150);
        const st = await tabB.evaluate(() => window.__peerLink.__getStateForTests());
        expect(st.pendingRequests).toBe(0);
        expect(st.liveDeadlines).toBe(0);
        await tabB.close();
    });

    test('AC-7 a peer that goes away AFTER accepting says bye, and the wait ends without a timer', async ({ page, context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await bootPage(page);
        const tabB = await context.newPage();
        await bootPage(tabB);

        // A provider that never settles: tab A accepts, then works forever. This
        // is the shape of a real SLIDE pull that has not finished — and the
        // reason the accept has to clear the deadline. If it did not, this case
        // would report a healthy transfer as failed, which is the S11.4 defect.
        await makeResponder(page, { flags: ALL_PASS, provider: 'hang' });
        const drag = await stampDrag(page);
        const deadlineMs = await tabB.evaluate(() => window.__peerLink.__getStateForTests().replyDeadlineMs);

        await tabB.evaluate((d) => {
            window.__outcome = null;
            window.__peerLink.requestFiles({ ...d, names: ['SLOW.BIN'] }).then((r) => { window.__outcome = r; });
        }, drag);

        // Accepted: the deadline is cleared, the waiter stays.
        await expect.poll(
            () => tabB.evaluate(() => window.__peerLink.__getStateForTests().liveDeadlines),
            { timeout: 5000 },
        ).toBe(0);
        expect(await tabB.evaluate(() => window.__peerLink.__getStateForTests().pendingRequests)).toBe(1);
        expect(await page.evaluate(() => window.__peerLink.__getStateForTests().outstandingResponses)).toBe(1);

        // Well past the deadline, still waiting — nothing invented a failure.
        await tabB.waitForTimeout(Math.round(deadlineMs * 1.5));
        expect(await tabB.evaluate(() => window.__outcome)).toBeNull();

        // Then tab A tears its link down, which is what pagehide does on the way
        // out: a best-effort bye for every request it accepted and never answered.
        await page.evaluate(() => window.__peerLink.dispose());
        await expect.poll(() => tabB.evaluate(() => window.__outcome), { timeout: 5000 })
            .toEqual({ ok: false, reason: 'peer-gone' });
        expect(await tabB.evaluate(() => window.__peerLink.__getStateForTests().pendingRequests)).toBe(0);
        await tabB.close();
    });

    test('AC-3 a third tab hears the exchange and ignores all of it', async ({ page, context }) => {
        await context.addInitScript(SERIAL_MOCK);
        await bootPage(page);
        const tabB = await context.newPage();
        await bootPage(tabB);
        const tabC = await context.newPage();
        await bootPage(tabC);

        // Addressing is by session id, so a third tab is harmless — but "harmless"
        // has to be observed, not assumed: every message of this exchange lands in
        // tab C's channel and every one of them is dropped.
        await makeResponder(page, { flags: ALL_PASS, provider: 'big' });
        await makeResponder(tabC, { flags: ALL_PASS, provider: 'big' });
        const drag = await stampDrag(page);
        const cNonceBefore = await tabC.evaluate(() => window.__peerLink.__getStateForTests().nonceCount);

        const outcome = await requestFrom(tabB, drag, ['A.TXT']);
        expect(outcome.ok).toBe(true);

        const stC = await tabC.evaluate(() => window.__peerLink.__getStateForTests());
        expect(stC.pendingRequests).toBe(0);
        expect(stC.liveDeadlines).toBe(0);
        expect(stC.outstandingResponses).toBe(0);
        expect(stC.nonceCount).toBe(cNonceBefore);   // C's own nonce table untouched
        await tabB.close();
        await tabC.close();
    });
});
