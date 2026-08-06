// Beastty Epic E11 Story S11.2 — the cross-tab peer link, single-page rules.
//
// Almost every acceptance criterion in this story has the form "it is ignored".
// A module that has not been written yet also ignores everything, so an
// ignore-assertion on its own is green against an empty file. EVERY ignore case
// below is therefore paired, in the same test, with a positive control: the
// identical exchange with a valid nonce / the right session id / a known schema
// version, observed to produce a reply. If the module stopped answering
// altogether, the controls fail first.
//
// How one page tests a cross-tab protocol: BroadcastChannel never delivers a
// message back to the CHANNEL OBJECT that posted it, but it does deliver to
// every OTHER object of the same name in the same origin — including one in the
// same page. So this spec opens its own channel and plays the peer. That is a
// real end-to-end exercise of the production handler, not a backdoor into it;
// only the genuinely two-tab cases (AC-12's identities, the blob handover under
// two live read loops) need the two-page spec next door.
//
// The four self-status getters are re-injected per test through wirePeerLink,
// which is the only way to reach the busy / no-folder / not-visible branches
// without a MicroBeast, a bound folder and a hidden tab.
//
// so this spec wedges without transport/peer-link.js.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SERIAL_MOCK } from './mock-serial.js';

const MODULE_PATH = fileURLToPath(new URL('../../transport/peer-link.js', import.meta.url));

const ALL_PASS = { connected: true, busy: false, bound: true, visible: true };

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    // Boot-race guard (E0.1 / S11.1 lesson) — window.__peerLink is set partway
    // through main.js, so wait for it in-page rather than reading across the
    // evaluate boundary before boot has run.
    await page.waitForFunction(
        () => window.__peerLink && typeof window.__peerLink.__getStateForTests === 'function',
    );
}

// A second BroadcastChannel object in this same page, playing the other tab.
// Records everything the module posts at us; `post` stamps a well-formed
// envelope unless the test overrides a field on purpose.
async function installFakePeer(page) {
    return page.evaluate(() => {
        const st = window.__peerLink.__getStateForTests();
        const ch = new BroadcastChannel(st.channelName);
        const peer = {
            id: 'fake-peer-0000-1111',
            received: [],
            channel: ch,
            post(fields) {
                ch.postMessage({
                    v: st.schemaVersion,
                    from: peer.id,
                    to: window.__peerLink.getSessionId(),
                    ...fields,
                });
            },
        };
        ch.onmessage = (ev) => { peer.received.push(ev.data); };
        window.__fakePeer = peer;
        return peer.id;
    });
}

// Projection, not the raw messages: a `files` payload carries Blobs, which do
// not cross the Playwright bridge.
function inbox(page) {
    return page.evaluate(() => window.__fakePeer.received.map((m) => ({
        v: m.v,
        kind: m.kind,
        from: m.from,
        to: m.to,
        nonce: m.nonce,
        reason: m.reason ?? null,
        files: Array.isArray(m.files)
            ? m.files.map((f) => ({ name: f.name, isBlob: f.blob instanceof Blob, size: f.blob ? f.blob.size : -1 }))
            : null,
    })));
}

const clearInbox = (page) => page.evaluate(() => { window.__fakePeer.received.length = 0; });
const peerPost = (page, fields) => page.evaluate((f) => window.__fakePeer.post(f), fields);
const mintNonce = (page) => page.evaluate(() => window.__peerLink.mintNonce());
const sessionId = (page) => page.evaluate(() => window.__peerLink.getSessionId());
const linkState = (page) => page.evaluate(() => window.__peerLink.__getStateForTests());

// Re-wire the real module with faked status getters. Returns the NEW session id
// (wirePeerLink mints one per wiring, so a test must re-read it).
async function rewire(page, flags, opts = {}) {
    return page.evaluate(async ({ f, withProvider }) => {
        const m = await import('/transport/peer-link.js');
        const api = m.wirePeerLink({
            isConnected: () => f.connected,
            isBusy: () => f.busy,
            hasBoundFolder: () => f.bound,
            isVisible: () => f.visible,
            provideFiles: withProvider
                ? async ({ names }) => names.map((n, i) => ({
                    name: n,
                    blob: new Blob([new Uint8Array(16).fill(0x41 + i)]),
                }))
                : undefined,
        });
        window.__peerLink = api;
        return api.getSessionId();
    }, { f: flags, withProvider: !!opts.withProvider });
}

// A settle window before a NEGATIVE assertion only — never before a positive one
// (those use expect.poll). Two channel hops and a microtask drain is microseconds;
// 200 ms is slack, not a guess at how long the module takes.
const settle = (page) => page.waitForTimeout(200);

// ===== AC-1 — pure, injected, reachable =====

test('AC-1 peer-link.js imports nothing and touches no DOM @fast', async () => {
    const src = readFileSync(MODULE_PATH, 'utf8');
    // Comments name DOM things they must not touch, so judge the code only. The
    // module contains no string literal holding `//` or `/*`, so this is exact
    // here even though it is not a general JS parser.
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');

    // AD-1 / the echo-swallow.js precedent: a leaf module with every dependency
    // injected. One accidental `import` here and the module stops being unit-
    // testable in isolation, which is NFR-5.
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\bdocument\b/);
    // The only sanctioned `window.` uses are the pagehide listener's add/remove.
    const windowUses = (code.match(/\bwindow\.\w+/g) || []).filter(
        (u) => u !== 'window.addEventListener' && u !== 'window.removeEventListener',
    );
    expect(windowUses).toEqual([]);
    // And no persistence of any kind (AC-2).
    expect(code).not.toMatch(/sessionStorage|localStorage|indexedDB/);
});

test('AC-1 the test surface is on window.__peerLink and its snapshot crosses the bridge @fast', async ({ page }) => {
    await setup(page);
    const st = await linkState(page);
    // Serialisable: no live refs, no functions (the focus.js:26-33 rule). If it
    // held either, the evaluate above would already have thrown.
    expect(() => JSON.stringify(st)).not.toThrow();
    expect(st.wired).toBe(true);
    expect(st.schemaVersion).toBe(1);
    expect(await page.evaluate(() => typeof window.__peerLink.__resetForTests)).toBe('function');
    expect(await page.evaluate(() => typeof window.__peerLink.requestFiles)).toBe('function');
    expect(await page.evaluate(() => typeof window.__peerLink.mintNonce)).toBe('function');
});

// ===== AC-2 — per-tab identity =====

test('AC-2 the session id is a per-tab UUID that nothing persists @fast', async ({ page }) => {
    await setup(page);
    const first = await sessionId(page);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Not in web storage — sessionStorage in particular survives a reload AND is
    // copied into a duplicated tab, which would hand two tabs one identity.
    const storage = await page.evaluate(() => ({
        session: JSON.stringify(Object.entries(sessionStorage)),
        local: JSON.stringify(Object.entries(localStorage)),
    }));
    expect(storage.session).not.toContain(first);
    expect(storage.local).not.toContain(first);

    // A reload is a new tab identity, which is the point: the id is minted at
    // wire time and means "this tab, this run".
    await page.reload();
    await page.waitForFunction(() => window.__peerLink && window.__peerLink.getSessionId());
    expect(await sessionId(page)).not.toBe(first);
});

// ===== AC-8 — inert with one tab open =====

test('AC-8 one tab open leaves no waiter and no live deadline @fast', async ({ page }) => {
    await setup(page);
    const boot = await linkState(page);
    expect(boot.pendingRequests).toBe(0);
    expect(boot.liveDeadlines).toBe(0);
    expect(boot.outstandingResponses).toBe(0);
    expect(boot.nonceCount).toBe(0);

    // Still zero after the app has been running a while — a sweeper timer or a
    // presence heartbeat would have shown up by now.
    await page.waitForTimeout(1200);
    const later = await linkState(page);
    expect(later.pendingRequests).toBe(0);
    expect(later.liveDeadlines).toBe(0);
    expect(later.outstandingResponses).toBe(0);

    // And minting a nonce (which is all a dragstart does) starts nothing either.
    await mintNonce(page);
    const afterMint = await linkState(page);
    expect(afterMint.nonceCount).toBe(1);
    expect(afterMint.pendingRequests).toBe(0);
    expect(afterMint.liveDeadlines).toBe(0);
});

// ===== AC-3 / AC-4 — the ignore rules, each with a positive control =====

test('AC-3/AC-4 malformed, misaddressed and unauthorised envelopes are ignored — with controls', async ({ page }) => {
    await setup(page);
    await installFakePeer(page);
    const self = await rewire(page, ALL_PASS, { withProvider: true });

    // ---- POSITIVE CONTROL FIRST. If this fails, every silence below is
    // meaningless because the module is answering nothing at all. Poll for the
    // COMPLETE two-message exchange, so no straggler can land in the inbox after
    // the clear below and be mistaken for a reply to a malformed envelope.
    const control = await mintNonce(page);
    await peerPost(page, { kind: 'request', nonce: control, names: ['CTRL.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);

    // ---- Each ignore case: a fresh valid nonce spoiled exactly one way.
    const cases = [
        {
            name: 'unrecognised schema version',
            build: (n) => ({ v: 999, kind: 'request', nonce: n, to: self }),
        },
        {
            name: 'addressed to another tab',
            build: (n) => ({ kind: 'request', nonce: n, to: 'some-other-session' }),
        },
        {
            name: 'no address at all',
            build: (n) => ({ kind: 'request', nonce: n, to: undefined }),
        },
        {
            name: 'unknown kind',
            build: (n) => ({ kind: 'hello', nonce: n }),
        },
        {
            name: 'absent nonce',
            build: () => ({ kind: 'request', nonce: undefined }),
        },
        {
            name: 'nonce this tab never minted',
            build: () => ({ kind: 'request', nonce: 'never-minted-by-anyone' }),
        },
    ];

    for (const c of cases) {
        const nonce = await mintNonce(page);
        await clearInbox(page);
        await peerPost(page, c.build(nonce));
        await settle(page);
        expect(await inbox(page), `case: ${c.name}`).toEqual([]);
    }

    // A payload that is not an envelope at all (a bare string on the channel).
    await clearInbox(page);
    await page.evaluate(() => { window.__fakePeer.channel.postMessage('not an envelope'); });
    await settle(page);
    expect(await inbox(page)).toEqual([]);

    // ---- CLOSING CONTROL. The module is still answering after all of that, so
    // the six silences above were refusals to act, not a dead handler.
    const closing = await mintNonce(page);
    await clearInbox(page);
    await peerPost(page, { kind: 'request', nonce: closing, names: ['CTRL2.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);
    expect(self).toBeTruthy();
});

test('AC-4 a nonce is retired before any work, so the duplicate starts nothing', async ({ page }) => {
    await setup(page);
    await installFakePeer(page);
    await rewire(page, ALL_PASS, { withProvider: true });

    const nonce = await mintNonce(page);
    expect((await linkState(page)).nonceCount).toBe(1);

    // First request: honoured, and the nonce is gone from the table immediately.
    await peerPost(page, { kind: 'request', nonce, names: ['ONE.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);
    expect((await linkState(page)).nonceCount).toBe(0);

    // Replay the SAME message. Nothing at all — not a second accept, not a
    // second pull, not a refusal.
    await clearInbox(page);
    await peerPost(page, { kind: 'request', nonce, names: ['ONE.TXT'] });
    await settle(page);
    expect(await inbox(page)).toEqual([]);

    // Control: a fresh nonce still works, so the silence above is the nonce rule
    // and not a module that stopped after one request.
    const second = await mintNonce(page);
    await peerPost(page, { kind: 'request', nonce: second, names: ['TWO.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);
});

test('AC-4 the nonce table prunes lazily by cap, with no sweeper timer @fast', async ({ page }) => {
    await setup(page);
    const { nonceMax } = await linkState(page);

    const minted = await page.evaluate((n) => {
        const out = [];
        for (let i = 0; i < n + 8; i++) out.push(window.__peerLink.mintNonce());
        return out;
    }, nonceMax);

    const st = await linkState(page);
    expect(st.nonceCount).toBe(nonceMax);
    // Oldest-first eviction: the first 8 are gone, the last nonceMax survive.
    expect(st.nonces).toEqual(minted.slice(8));
    // Pruning happened on mint, not on a tick — nothing is scheduled.
    expect(st.liveDeadlines).toBe(0);

    // And an evicted nonce is now simply unknown.
    expect(await page.evaluate((n) => window.__peerLink.consumeNonce(n), minted[0])).toBe(false);
    expect(await page.evaluate((n) => window.__peerLink.consumeNonce(n), minted[minted.length - 1])).toBe(true);
});

// ===== AC-5 / AC-6 — the refusal decision, read live =====

test('AC-5 chooseRefusal is ordered and closed over the frozen code set @fast', async ({ page }) => {
    await setup(page);
    const out = await page.evaluate(async () => {
        const m = await import('/transport/peer-link.js');
        const C = m.PEER_REFUSAL_CODES;
        const call = (s) => m.chooseRefusal(s);
        return {
            codes: Object.values(C),
            frozen: Object.isFrozen(C),
            allPass: call({ connected: true, busy: false, bound: true, visible: true }),
            notConnected: call({ connected: false, busy: false, bound: true, visible: true }),
            busy: call({ connected: true, busy: true, bound: true, visible: true }),
            noFolder: call({ connected: true, busy: false, bound: false, visible: true }),
            notVisible: call({ connected: true, busy: false, bound: true, visible: false }),
            // Ordering: the most fundamental failure wins when several are true.
            allFail: call({ connected: false, busy: true, bound: false, visible: false }),
            busyBeatsFolder: call({ connected: true, busy: true, bound: false, visible: false }),
            folderBeatsVisible: call({ connected: true, busy: false, bound: false, visible: false }),
            nothing: call(null),
        };
    });
    expect(out.frozen).toBe(true);
    expect(out.codes).toEqual(['not-connected', 'busy', 'no-folder', 'not-visible', 'pull-failed', 'peer-gone']);
    expect(out.allPass).toBeNull();
    expect(out.notConnected).toBe('not-connected');
    expect(out.busy).toBe('busy');
    expect(out.noFolder).toBe('no-folder');
    expect(out.notVisible).toBe('not-visible');
    expect(out.allFail).toBe('not-connected');
    expect(out.busyBeatsFolder).toBe('busy');
    expect(out.folderBeatsVisible).toBe('no-folder');
    expect(out.nothing).toBe('not-connected');
});

test('AC-5/AC-6 each failing self-check refuses with its own code, without calling the provider', async ({ page }) => {
    await setup(page);
    await installFakePeer(page);

    const matrix = [
        { flags: { connected: false, busy: false, bound: true, visible: true }, code: 'not-connected' },
        { flags: { connected: true, busy: true, bound: true, visible: true }, code: 'busy' },
        { flags: { connected: true, busy: false, bound: false, visible: true }, code: 'no-folder' },
        { flags: { connected: true, busy: false, bound: true, visible: false }, code: 'not-visible' },
    ];

    for (const row of matrix) {
        await rewire(page, row.flags, { withProvider: true });
        // Prove the provider is installed, so "the provider was not called" below
        // means "the module refused first", not "there was nothing to call".
        expect((await linkState(page)).hasFileProvider).toBe(true);
        const nonce = await mintNonce(page);
        await clearInbox(page);
        await peerPost(page, { kind: 'request', nonce, names: ['X.TXT'] });
        await expect.poll(() => inbox(page).then((m) => m.length), { timeout: 3000 }).toBe(1);
        const [reply] = await inbox(page);
        expect(reply.kind, `flags: ${JSON.stringify(row.flags)}`).toBe('refused');
        expect(reply.reason).toBe(row.code);
        // Exactly one outcome — no accept, and no files behind it.
        await settle(page);
        expect((await inbox(page)).length).toBe(1);
    }

    // CONTROL: the same module, the same provider, all four checks passing.
    await rewire(page, ALL_PASS, { withProvider: true });
    const nonce = await mintNonce(page);
    await clearInbox(page);
    await peerPost(page, { kind: 'request', nonce, names: ['Y.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);
});

test('AC-6 status is re-read at answer time, never cached', async ({ page }) => {
    await setup(page);
    await installFakePeer(page);

    // One wiring whose getters read a mutable page-level object — so a change
    // between two requests can only be seen if the module re-reads.
    await page.evaluate(async () => {
        window.__flags = { connected: true, busy: false, bound: true, visible: true };
        const m = await import('/transport/peer-link.js');
        window.__peerLink = m.wirePeerLink({
            isConnected: () => window.__flags.connected,
            isBusy: () => window.__flags.busy,
            hasBoundFolder: () => window.__flags.bound,
            isVisible: () => window.__flags.visible,
            provideFiles: async ({ names }) => names.map((n) => ({ name: n, blob: new Blob([new Uint8Array(4)]) })),
        });
    });

    const first = await mintNonce(page);
    await peerPost(page, { kind: 'request', nonce: first, names: ['A.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);

    // Flip one fact with no notification of any kind.
    await page.evaluate(() => { window.__flags.busy = true; });
    const second = await mintNonce(page);
    await clearInbox(page);
    await peerPost(page, { kind: 'request', nonce: second, names: ['B.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['refused']);
    expect((await inbox(page))[0].reason).toBe('busy');
});

test('AC-5 no file provider means accepted, then pull-failed', async ({ page }) => {
    await setup(page);
    await installFakePeer(page);
    // This is main.js's wiring in S11.2: the four checks can pass, but reading a
    // file back OUT of the bound folder is S11.3's work. Accepting and then
    // failing is the honest shape.
    await rewire(page, ALL_PASS);
    expect((await linkState(page)).hasFileProvider).toBe(false);

    const nonce = await mintNonce(page);
    await peerPost(page, { kind: 'request', nonce, names: ['Z.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'refused']);
    expect((await inbox(page))[1].reason).toBe('pull-failed');
});

test('AC-5 a provider that returns something unusable becomes pull-failed, never a nameless Blob', async ({ page }) => {
    await setup(page);
    await installFakePeer(page);

    // The §3(a) defect, at the only place it can still be caught: a bare Blob has
    // no .name, and file-source's processFiles does NOT throw on that — it drops
    // the file into the rejected rows and offers the user "Send 0 files".
    //
    // Each shape is a LITERAL function selected by key, not a string compiled in
    // the page. The page's CSP is script-src 'self' 'wasm-unsafe-eval', so
    // new Function() throws EvalError there — and a provider that throws is
    // itself one of the cases below, so a string-compiled version of this test
    // would report pull-failed for every row without ever building the payload
    // the row is named after.
    const bad = ['bare-blob', 'no-bytes', 'arraybuffer', 'empty-list', 'throws'];

    for (const kind of bad) {
        await page.evaluate(async (k) => {
            const m = await import('/transport/peer-link.js');
            const providers = {
                'bare-blob': async () => [new Blob([new Uint8Array(4)])],
                'no-bytes': async () => [{ name: 'A.TXT' }],
                'arraybuffer': async () => [{ name: 'A.TXT', blob: new ArrayBuffer(8) }],
                'empty-list': async () => [],
                'throws': async () => { throw new Error('pull blew up'); },
            };
            window.__peerLink = m.wirePeerLink({
                isConnected: () => true,
                isBusy: () => false,
                hasBoundFolder: () => true,
                isVisible: () => true,
                provideFiles: providers[k],
            });
        }, kind);
        const nonce = await mintNonce(page);
        await clearInbox(page);
        await peerPost(page, { kind: 'request', nonce, names: ['A.TXT'] });
        await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
            .toEqual(['accepted', 'refused']);
        expect((await inbox(page))[1].reason, `case: ${kind}`).toBe('pull-failed');
    }

    // CONTROL: a well-formed { name, blob } record goes through untouched.
    await rewire(page, ALL_PASS, { withProvider: true });
    const nonce = await mintNonce(page);
    await clearInbox(page);
    await peerPost(page, { kind: 'request', nonce, names: ['GOOD.TXT'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);
    expect((await inbox(page))[1].files).toEqual([{ name: 'GOOD.TXT', isBlob: true, size: 16 }]);
});

// ===== AC-7 — one deadline, never a poll =====

test('AC-7 a request nobody answers resolves peer-gone on one deadline', async ({ page }) => {
    await setup(page);
    const { replyDeadlineMs } = await linkState(page);

    const started = Date.now();
    const outcome = await page.evaluate(
        () => window.__peerLink.requestFiles({ peerSessionId: 'nobody-is-listening', nonce: 'n-1', names: ['A.TXT'] }),
        undefined,
    );
    const elapsed = Date.now() - started;

    expect(outcome).toEqual({ ok: false, reason: 'peer-gone' });
    // Fired ON the deadline, not before it — a poll loop that gave up early
    // would land well short of this.
    expect(elapsed).toBeGreaterThanOrEqual(replyDeadlineMs - 150);
    // And the waiter is gone, deadline cleared: a leaked timer would outlive the
    // session (the waitForSendState rule).
    const st = await linkState(page);
    expect(st.pendingRequests).toBe(0);
    expect(st.liveDeadlines).toBe(0);
});

test('AC-7 accepted clears the deadline, and a later bye resolves peer-gone', async ({ page }) => {
    await setup(page);
    const peerId = await installFakePeer(page);
    const self = await rewire(page, ALL_PASS);

    // Start the request without awaiting it — the outcome arrives much later.
    await page.evaluate((p) => {
        window.__req = window.__peerLink.requestFiles({ peerSessionId: p, nonce: 'drag-nonce-1', names: ['A.TXT'] });
    }, peerId);

    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 }).toEqual(['request']);
    const mid = await linkState(page);
    expect(mid.pendingRequests).toBe(1);
    expect(mid.liveDeadlines).toBe(1);

    // The peer accepts. The transfer that follows gets NO deadline of its own —
    // a real SLIDE pull over 19200 baud takes seconds to tens of seconds, and
    // timing that out is how S11.4's defect was built.
    await peerPost(page, { kind: 'accepted', nonce: 'drag-nonce-1' });
    await expect.poll(() => linkState(page).then((s) => s.liveDeadlines), { timeout: 3000 }).toBe(0);
    expect((await linkState(page)).pendingRequests).toBe(1);

    // Well past the deadline the request is STILL waiting — nothing invented a
    // failure while the peer was working.
    await page.waitForTimeout(Math.round(mid.replyDeadlineMs * 1.5));
    expect((await linkState(page)).pendingRequests).toBe(1);

    // Then the peer's tab goes away and says so on the way out.
    await peerPost(page, { kind: 'bye', nonce: 'drag-nonce-1' });
    expect(await page.evaluate(() => window.__req)).toEqual({ ok: false, reason: 'peer-gone' });
    const end = await linkState(page);
    expect(end.pendingRequests).toBe(0);
    expect(end.liveDeadlines).toBe(0);
    expect(self).toBeTruthy();
});

test('AC-7 a reply from the wrong tab, or for the wrong nonce, does not settle the wait', async ({ page }) => {
    await setup(page);
    const peerId = await installFakePeer(page);
    await rewire(page, ALL_PASS);

    await page.evaluate((p) => {
        window.__settled = null;
        window.__peerLink.requestFiles({ peerSessionId: p, nonce: 'n-x', names: ['A.TXT'] })
            .then((r) => { window.__settled = r; });
    }, peerId);
    await expect.poll(() => linkState(page).then((s) => s.pendingRequests), { timeout: 3000 }).toBe(1);

    // Right nonce, wrong sender.
    await page.evaluate(() => {
        window.__fakePeer.channel.postMessage({
            v: 1, kind: 'refused', from: 'an-impostor', to: window.__peerLink.getSessionId(),
            nonce: 'n-x', reason: 'busy',
        });
    });
    // Right sender, wrong nonce.
    await peerPost(page, { kind: 'refused', nonce: 'a-different-drag', reason: 'busy' });
    await settle(page);
    expect(await page.evaluate(() => window.__settled)).toBeNull();
    expect((await linkState(page)).pendingRequests).toBe(1);

    // CONTROL: the right sender with the right nonce settles it immediately.
    await peerPost(page, { kind: 'refused', nonce: 'n-x', reason: 'busy' });
    await expect.poll(() => page.evaluate(() => window.__settled), { timeout: 3000 })
        .toEqual({ ok: false, reason: 'busy' });
});

test('AC-7 __resetForTests settles a pending wait instead of leaving it hanging @fast', async ({ page }) => {
    await setup(page);
    const peerId = await installFakePeer(page);
    await rewire(page, ALL_PASS);
    await page.evaluate((p) => {
        window.__settled = null;
        window.__peerLink.requestFiles({ peerSessionId: p, nonce: 'n-reset', names: ['A.TXT'] })
            .then((r) => { window.__settled = r; });
    }, peerId);
    await expect.poll(() => linkState(page).then((s) => s.pendingRequests), { timeout: 3000 }).toBe(1);

    await page.evaluate(() => window.__peerLink.__resetForTests());
    await expect.poll(() => page.evaluate(() => window.__settled), { timeout: 3000 })
        .toEqual({ ok: false, reason: 'peer-gone' });
    const st = await linkState(page);
    expect(st.pendingRequests).toBe(0);
    expect(st.liveDeadlines).toBe(0);
});

// ===== AC-9 — the handover moves no bytes through an object URL =====

test('AC-9 the handover creates no object URL (CSP has connect-src self, no blob:)', async ({ page }) => {
    await setup(page);
    await installFakePeer(page);
    await page.evaluate(() => {
        window.__objectUrls = 0;
        const real = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (...a) => { window.__objectUrls += 1; return real(...a); };
    });
    await rewire(page, ALL_PASS, { withProvider: true });

    const nonce = await mintNonce(page);
    await peerPost(page, { kind: 'request', nonce, names: ['BIG.BIN'] });
    await expect.poll(() => inbox(page).then((m) => m.map((x) => x.kind)), { timeout: 3000 })
        .toEqual(['accepted', 'files']);
    // Reading the payload is .arrayBuffer(), not fetch(objectURL) — the latter is
    // blocked outright by the page's CSP, so a spec that never noticed would ship
    // a transfer that fails only in production.
    const bytes = await page.evaluate(async () => {
        const msg = window.__fakePeer.received.find((m) => m.kind === 'files');
        const buf = await msg.files[0].blob.arrayBuffer();
        return Array.from(new Uint8Array(buf));
    });
    expect(bytes.length).toBe(16);
    expect(await page.evaluate(() => window.__objectUrls)).toBe(0);
});
