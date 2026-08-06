// Beastty Epic E11 Story S11.3 — the drag, the drop and the words, one page.
//
// The failure this spec exists to prevent: a suite that agrees with the spec
// author instead of with Chromium.
//
// A Playwright synthetic DragEvent carries a `new DataTransfer()` that has NO
// protected mode, so getData() works at EVERY phase in here. The real browser's
// protected drag data store returns '' for every type during dragenter /
// dragover / dragleave, and only lets getData work at drop. So a hover-time
// assertion written against getData would pass in this file and be impossible in
// the product. Two defences, both below:
//   - every hover-time case asserts against dataTransfer.types only, and
//   - one STRUCTURAL case reads peer-drop.js's own source and fails if any
//     handler reaches for getData before drop (the peer-link.spec.js:121-142
//     precedent).
//
// Second trap, inherited from S11.2 §8 and confirmed there on schedule: most of
// AC-3's criteria have the form "nothing happens". A module that does nothing at
// all also makes nothing happen. EVERY ignore case here is therefore paired, in
// the same test, with a POSITIVE CONTROL — the identical gesture with the one
// disqualifying fact removed, observed to produce the response the ignore case
// says was withheld.
//
// The genuinely cross-tab cases (a real round trip, each refusal end to end, the
// own-payload no-op across two identities, hidden-mid-pull) are in
// tests/transport/peer-drag-two-tabs.spec.js on the S11.2 two-page harness.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const MODULE_PATH = fileURLToPath(new URL('../../input/peer-drop.js', import.meta.url));

// The resting string #drop-overlay-text ships with. file-source.spec.js:75 pins
// it too; repeated here because this is the FIRST code ever to overwrite that
// node and the restore is the whole of AC-2's third clause.
const RESTING = 'Drop file(s) to send via SLIDE';
const DROP_LABEL = '⤓ Drop to copy from the other beast';

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    // Boot-race guard (the S11.1 lesson): window.__peerDrop is set partway
    // through main.js. Wait for it IN PAGE rather than reading across the
    // evaluate boundary before boot has run.
    await page.waitForFunction(
        () => window.__peerDrop && typeof window.__peerDrop.__getStateForTests === 'function',
    );
}

test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
        window.__peerDrop.__resetForTests();
        if (window.__slide) window.__slide.__resetForTests();
        if (window.__slideChip) window.__slideChip.__resetForTests();
    });
});

const dropState = (page) => page.evaluate(() => window.__peerDrop.__getStateForTests());
const overlayText = (page) => page.evaluate(() => document.getElementById('drop-overlay-text').textContent);

// A settle window before a NEGATIVE assertion only — never before a positive
// one (those use expect.poll). Dispatching a synthetic DragEvent is synchronous;
// 150 ms is slack, not a guess at how long the module takes.
const settle = (page) => page.waitForTimeout(150);

// ===== Synthetic drag helpers =====
//
// The two shapes this repo already uses: selection-drop.spec.js:186-190 and
// pull-pane.spec.js:1208-1215. `kinds` says what goes into the data store, which
// is what dataTransfer.types then reports.

async function dispatchDrag(page, eventType, { peerPayload = null, withFiles = false, text = null } = {}) {
    return page.evaluate(({ ev, payload, files, plain, type }) => {
        const dt = new DataTransfer();
        if (payload !== null) dt.setData(type, payload);
        if (plain !== null) dt.setData('text/plain', plain);
        if (files) dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }));
        const e = new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt });
        document.getElementById('terminal-wrapper').dispatchEvent(e);
        return { prevented: e.defaultPrevented, types: Array.from(dt.types) };
    }, {
        ev: eventType,
        payload: peerPayload,
        files: withFiles,
        plain: text,
        type: 'application/x-beastty-peer-drag',
    });
}

// A well-formed payload from a DIFFERENT tab: a session id that is not ours and
// a nonce string. Nothing here mints a real nonce — a single-page drop never
// reaches the channel (peer-link refuses a self-addressed request), and the
// cases that need a real one live in the two-page spec.
function foreignPayload(names = ['WOTBEAST.FTH'], overrides = {}) {
    return JSON.stringify({
        v: 1,
        sessionId: 'not-this-tab-0000-1111',
        nonce: 'nonce-0000-1111',
        names,
        ...overrides,
    });
}

// ===== AC-1 — the drag carries identity, and disturbs nothing that reads a drag =====

test.describe('AC-1 the drag stamp', () => {
    test('a selection with valid 8.3 names stamps the custom type beside an unchanged text/plain @fast', async ({ page }) => {
        const stamped = await page.evaluate(() => {
            const text = 'WOTBEAST.FTH GAME.COM';
            const stamp = window.__peerDrop.getPeerStamp(text);
            return { stamp, sessionId: window.__peerLink.getSessionId() };
        });
        expect(stamped.stamp).not.toBeNull();
        expect(stamped.stamp.type).toBe('application/x-beastty-peer-drag');
        const payload = JSON.parse(stamped.stamp.payload);
        expect(payload.v).toBe(1);
        expect(payload.sessionId).toBe(stamped.sessionId);
        expect(payload.names).toEqual(['WOTBEAST.FTH', 'GAME.COM']);
        // A freshly minted single-use nonce, not a reused constant.
        expect(typeof payload.nonce).toBe('string');
        expect(payload.nonce.length).toBeGreaterThan(0);
    });

    test('every stamp mints a FRESH nonce and the link records it @fast', async ({ page }) => {
        const r = await page.evaluate(() => {
            window.__peerLink.__resetForTests();
            const before = window.__peerLink.__getStateForTests().nonceCount;
            const a = JSON.parse(window.__peerDrop.getPeerStamp('A.TXT').payload);
            const b = JSON.parse(window.__peerDrop.getPeerStamp('B.TXT').payload);
            return { before, a: a.nonce, b: b.nonce, after: window.__peerLink.__getStateForTests().nonceCount };
        });
        expect(r.a).not.toBe(r.b);
        expect(r.after).toBe(r.before + 2);
    });

    test('the DIR-column reassembly the pull pane already does is what names the files @fast', async ({ page }) => {
        // 'VPEEK    COM' is how CP/M's DIR prints a name; a plain whitespace
        // split would offer two junk tokens. mergeDirColumns is the pane's, and
        // composeSelection is a thin export of it — proving this here is what
        // stops a second copy of that logic being written in peer-drop.js.
        const names = await page.evaluate(() =>
            JSON.parse(window.__peerDrop.getPeerStamp('A: VPEEK    COM : GAME     BIN').payload).names);
        expect(names).toEqual(['VPEEK.COM', 'GAME.BIN']);
    });

    test('a selection that parses to ZERO valid names stamps nothing at all @fast', async ({ page }) => {
        // AC-1's third clause: no foreign tab may ever light a drop target for a
        // drag that could not be honoured.
        const none = await page.evaluate(() => window.__peerDrop.getPeerStamp('just some prose here'));
        expect(none).toBeNull();
        // CONTROL: the same call with one valid name present DOES stamp, so the
        // null above is the parse refusing and not the stamp being broken.
        const some = await page.evaluate(() => window.__peerDrop.getPeerStamp('just some prose GAME.COM here'));
        expect(some).not.toBeNull();
        expect(JSON.parse(some.payload).names).toEqual(['GAME.COM']);
    });

    test('AC-11 the real dragstart still carries text/plain, copy and the 1×1 image @fast', async ({ page }) => {
        // The regression that would be invisible: a stamp that disturbed the
        // drag every OTHER consumer reads. Driven through selection.js's own
        // handler, not through getPeerStamp.
        const r = await page.evaluate(async () => {
            const wrapper = document.getElementById('terminal-wrapper');
            const canvas = document.getElementById('terminal');
            wrapper.focus();
            // Put a known line in the grid and select it.
            window.__term.feed(new TextEncoder().encode('GAME.COM\r\n'));
            await new Promise((r2) => requestAnimationFrame(r2));
            return new Promise((resolve) => {
                // Arm the origination branch the way a pointerdown inside a
                // committed selection does, then fire a real dragstart.
                const dt = new DataTransfer();
                const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt });
                canvas.dispatchEvent(ev);
                resolve({ prevented: ev.defaultPrevented, types: Array.from(dt.types) });
            });
        });
        // With no armed selection the drag is aborted exactly as it was before
        // this story (selection-drop.spec.js's stray-dragstart case), and no
        // custom type leaks onto it.
        expect(r.prevented).toBe(true);
        expect(r.types).not.toContain('application/x-beastty-peer-drag');
    });
});

// ===== AC-2 — the overlay lights on a foreign payload, and is restored =====

test.describe('AC-2 the overlay', () => {
    test('a foreign payload lights the SHIPPED affordance and names the source @fast', async ({ page }) => {
        const r = await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload() });
        expect(r.prevented).toBe(true);
        const st = await dropState(page);
        // The same attribute, the same element, the same #drop-overlay CSS.
        expect(st.dropTargetActive).toBe(true);
        expect(await overlayText(page)).toBe(DROP_LABEL);
    });

    test('the overlay text is restored on dragleave, on drop and on dragend @fast', async ({ page }) => {
        // The consequence if it is not: file-source's own OS-file drag never
        // touches this node, so its next drop overlay would read our sentence.
        for (const finisher of ['dragleave', 'drop', 'dragend']) {
            await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload() });
            expect(await overlayText(page), `after dragenter (${finisher})`).toBe(DROP_LABEL);
            await dispatchDrag(page, finisher, { peerPayload: foreignPayload() });
            expect(await overlayText(page), `after ${finisher}`).toBe(RESTING);
            const st = await dropState(page);
            expect(st.dropTargetActive, `drop target after ${finisher}`).toBe(false);
            expect(st.dragDepth, `depth after ${finisher}`).toBe(0);
        }
    });

    test("an OS file drag after ours still shows file-source's own words @fast", async ({ page }) => {
        // The end-to-end shape of the restore bug, driven through both owners of
        // #terminal-wrapper in the order that would expose it.
        await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload() });
        await dispatchDrag(page, 'dragend', { peerPayload: foreignPayload() });
        await dispatchDrag(page, 'dragenter', { withFiles: true });
        expect(await overlayText(page)).toBe(RESTING);
        // CONTROL: file-source really did claim that drag (its overlay is up),
        // so the assertion above is about the WORDS and not about a drag nobody
        // handled.
        expect(await page.evaluate(() =>
            document.getElementById('terminal-wrapper').hasAttribute('data-drop-target'))).toBe(true);
    });

    test('nested dragenter/dragleave pairs are depth-counted, not toggled @fast', async ({ page }) => {
        const p = foreignPayload();
        await dispatchDrag(page, 'dragenter', { peerPayload: p });
        await dispatchDrag(page, 'dragenter', { peerPayload: p });   // crossing a child element
        await dispatchDrag(page, 'dragleave', { peerPayload: p });
        // Still lit: one enter is outstanding.
        expect((await dropState(page)).dropTargetActive).toBe(true);
        expect(await overlayText(page)).toBe(DROP_LABEL);
        await dispatchDrag(page, 'dragleave', { peerPayload: p });
        expect((await dropState(page)).dropTargetActive).toBe(false);
        expect(await overlayText(page)).toBe(RESTING);
    });
});

// ===== AC-3 — ours, theirs, and nobody's =====

test.describe('AC-3 the ownership predicate', () => {
    test('a drag carrying real Files is left entirely to file-source @fast', async ({ page }) => {
        // Ours must not claim it even when our own type rides along — a drag
        // with 'Files' belongs to the module that can read them.
        await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload(), withFiles: true });
        await settle(page);
        const st = await dropState(page);
        expect(st.dragDepth).toBe(0);                 // ours never entered
        expect(st.overlayTextOverridden).toBe(false); // ours never wrote the text
        expect(await overlayText(page)).toBe(RESTING);
        // POSITIVE CONTROL: the same payload WITHOUT Files is claimed by ours,
        // so the assertions above are about the 'Files' arm and not about a
        // module that ignores everything.
        await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload() });
        expect((await dropState(page)).dragDepth).toBe(1);
        expect(await overlayText(page)).toBe(DROP_LABEL);
    });

    test('a plain text drag is nobody-in-this-module and is not prevented @fast', async ({ page }) => {
        const r = await dispatchDrag(page, 'dragenter', { text: 'GAME.COM' });
        // No preventDefault is exactly what leaves the event to the other two
        // owners of this element.
        expect(r.prevented).toBe(false);
        expect((await dropState(page)).dragDepth).toBe(0);
        // POSITIVE CONTROL.
        expect((await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload() })).prevented).toBe(true);
    });

    test("FR-3 this tab's own drag over its own terminal is inert at hover @fast", async ({ page }) => {
        // The hover-time half: the payload cannot be read here, so the decision
        // is this tab's own drag state (selection.js's onSelectionDragState,
        // which main.js routes to peer-drop as a second subscriber).
        await page.evaluate(() => window.__peerDrop.onSelectionDrag({ active: true, text: 'GAME.COM' }));
        const r = await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload() });
        expect(r.prevented).toBe(false);
        const st = await dropState(page);
        expect(st.selfDragging).toBe(true);
        expect(st.dragDepth).toBe(0);
        expect(st.dropTargetActive).toBe(false);
        expect(await overlayText(page)).toBe(RESTING);
        // POSITIVE CONTROL: the identical gesture once our own drag has ended.
        await page.evaluate(() => window.__peerDrop.onSelectionDrag({ active: false }));
        expect((await dispatchDrag(page, 'dragenter', { peerPayload: foreignPayload() })).prevented).toBe(true);
        expect(await overlayText(page)).toBe(DROP_LABEL);
    });

    test('FR-3 a drop carrying THIS tab\'s own session id is inert — the drop-time belt @fast', async ({ page }) => {
        // The second, independent check. It matters on its own: the local flag
        // alone would let a THIRD tab's payload through as "not ours", and the
        // id comparison alone cannot light or withhold the overlay.
        const own = await page.evaluate(() => {
            const stamp = window.__peerDrop.getPeerStamp('GAME.COM');
            return stamp.payload;
        });
        await dispatchDrag(page, 'drop', { peerPayload: own });
        await settle(page);
        const st = await dropState(page);
        expect(st.requestCount).toBe(0);     // nothing was asked of anyone
        expect(st.modalOpen).toBe(false);    // no ceremony
        expect(st.lastNotice).toBe('');      // and no error was invented
        // POSITIVE CONTROL: the same drop with a FOREIGN session id gets as far
        // as this tab's own checks and says something.
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().lastNotice))
            .not.toBe('');
    });

    test('a malformed or wrong-version payload is inert, not an exception @fast', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        const bad = [
            'not json at all',
            '{}',
            JSON.stringify({ v: 2, sessionId: 'x', nonce: 'y', names: ['A.TXT'] }),   // future build
            JSON.stringify({ v: 1, sessionId: '', nonce: 'y', names: ['A.TXT'] }),
            JSON.stringify({ v: 1, sessionId: 'x', nonce: 'y', names: [] }),
            JSON.stringify({ v: 1, sessionId: 'x', nonce: 'y', names: [null] }),
        ];
        for (const p of bad) {
            await dispatchDrag(page, 'drop', { peerPayload: p });
        }
        await settle(page);
        const st = await dropState(page);
        expect(st.requestCount).toBe(0);
        expect(st.lastNotice).toBe('');
        expect(errors).toEqual([]);
        // POSITIVE CONTROL: a well-formed payload down the same path is NOT
        // inert, so the six above are the validator working rather than the drop
        // handler being dead.
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().lastNotice))
            .not.toBe('');
    });

    test('parsePayload is pure and rejects every malformed shape @fast', async ({ page }) => {
        const r = await page.evaluate(async () => {
            const m = await import('/input/peer-drop.js');
            const ok = m.parsePayload(JSON.stringify({
                v: 1, sessionId: 's', nonce: 'n', names: ['A.TXT', 'B.TXT'],
            }));
            return {
                ok,
                nulls: [
                    m.parsePayload(null), m.parsePayload(''), m.parsePayload('{'),
                    m.parsePayload(JSON.stringify({ v: 99, sessionId: 's', nonce: 'n', names: ['A'] })),
                    m.parsePayload(JSON.stringify({ v: 1, nonce: 'n', names: ['A'] })),
                    m.parsePayload(JSON.stringify({ v: 1, sessionId: 's', names: ['A'] })),
                    m.parsePayload(JSON.stringify({ v: 1, sessionId: 's', nonce: 'n', names: 'A' })),
                ],
            };
        });
        expect(r.ok).toEqual({ sessionId: 's', nonce: 'n', names: ['A.TXT', 'B.TXT'] });
        expect(r.nulls).toEqual([null, null, null, null, null, null, null]);
    });
});

// Re-wire peer-drop with the two destination predicates under test pinned. It
// is the only way to reach "no writer" and "mid-transfer" without a MicroBeast,
// and equally the only way to reach the HAPPY path: a Playwright page has no
// writer, so the production wiring refuses every drop at the first check.
// Everything else here is production code — the same module instance main.js
// loaded (modal.spec.js:1-13's rule), the real peer-link, the real modal.
async function rewire(page, { connected, busy }) {
    await page.evaluate(async ({ c, b }) => {
            const m = await import('/input/peer-drop.js');
            window.__peerDrop = m.wirePeerDrop({
                wrapperEl: document.getElementById('terminal-wrapper'),
                overlayTextEl: document.getElementById('drop-overlay-text'),
                modalEl: document.getElementById('peer-copy-modal'),
                modalTitleEl: document.getElementById('peer-copy-modal-title'),
                modalFileEl: document.getElementById('peer-copy-file'),
                modalFromEl: document.getElementById('peer-copy-from'),
                modalToEl: document.getElementById('peer-copy-to'),
                modalCopyBtn: document.getElementById('peer-copy-confirm'),
                modalCancelBtn: document.getElementById('peer-copy-cancel'),
                peerLink: window.__peerLink,
                composeSelection: (t) => window.__pullPane.composeSelection(t),
                pullForPeer: (n) => window.__pullPane.pullForPeer(n),
                sendFiles: async () => {},
                isConnected: () => c,
                isBusy: () => b,
                getPrefs: () => window.__prefs.getPrefs(),
                openModal: (await import('/renderer/modal.js')).openModal,
                retainFocus: (await import('/renderer/focus.js')).retainFocus,
                showNotice: (t) => { window.__lastNotice = t; },
            });
        }, { c: connected, b: busy });
}

// ===== AC-4 — the destination refuses before anything reaches the source =====
//
// This beast's own checks run BEFORE any request is posted, so no nonce is
// consumed on the other tab and nothing is spent.

test.describe('AC-4 this beast refuses first', () => {
    test('not connected → its verbatim sentence, and NO request is posted @fast', async ({ page }) => {
        await rewire(page, { connected: false, busy: false });
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().lastNotice))
            .toBe("This beast isn't connected. Connect it and try again.");
        expect((await dropState(page)).requestCount).toBe(0);
        expect((await dropState(page)).modalOpen).toBe(false);
    });

    test('busy → its verbatim sentence, and NO request is posted @fast', async ({ page }) => {
        await rewire(page, { connected: true, busy: true });
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().lastNotice))
            .toBe('This beast is mid-transfer. Wait for it to finish and try again.');
        expect((await dropState(page)).requestCount).toBe(0);
    });

    test('not-connected outranks busy — the more fundamental fault is named @fast', async ({ page }) => {
        await rewire(page, { connected: false, busy: true });
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().lastNotice))
            .toBe("This beast isn't connected. Connect it and try again.");
    });

    test('POSITIVE CONTROL — with both checks passing the drop DOES post a request @fast', async ({ page }) => {
        // Without this the three cases above are green against a module that
        // never posts anything under any circumstances.
        await rewire(page, { connected: true, busy: false });
        await page.evaluate(() => window.__prefs.savePrefs({ slideConfirmTransfers: false }));
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().requestCount))
            .toBe(1);
    });

    test('AC-4 the busy predicate is the COMPOSITE one, never recv-only', async ({ page }) => {
        // A recv-only predicate leaking into a send path has happened three
        // times in this codebase. Read the composition root's own wiring: the
        // predicate handed to peer-drop must name hasPendingSendSession and the
        // wire owner, not just slide-recv's isSlideActive.
        const src = await page.evaluate(() => fetch('/main.js').then((r) => r.text()));
        const call = src.slice(src.indexOf('const peerDrop = wirePeerDrop('));
        const isBusyArm = call.slice(call.indexOf('isBusy:'), call.indexOf('getPrefs,'));
        expect(isBusyArm).toContain('hasPendingSendSession');
        expect(isBusyArm).toContain("mode === 'send'");
        expect(isBusyArm).toContain("mode === 'recv'");
        expect(isBusyArm).toContain("getWireOwner() === 'slide'");
    });
});

// ===== AC-5 — the confirm preference, and no second ceremony =====

test.describe('AC-5 the confirm modal', () => {
    // A destination that passes its own two checks — otherwise every drop is
    // refused at the first one and no modal could ever open.
    test.beforeEach(async ({ page }) => {
        await rewire(page, { connected: true, busy: false });
    });

    async function dropAndOpen(page, names = ['WOTBEAST.FTH']) {
        await page.evaluate(() => window.__prefs.savePrefs({ slideConfirmTransfers: true }));
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload(names) });
        await expect.poll(() => page.evaluate(() => document.getElementById('peer-copy-modal').open))
            .toBe(true);
    }

    test('one file — verbatim title, rows and buttons on the aligned-row rails @fast', async ({ page }) => {
        await dropAndOpen(page);
        await expect(page.locator('#peer-copy-modal-title')).toHaveText('Copy from the other beast?');
        await expect(page.locator('#peer-copy-file')).toHaveText('WOTBEAST.FTH');
        await expect(page.locator('#peer-copy-from')).toHaveText('the other beast');
        // No drive letter: the only one the app knows is where SLIDE.COM lives,
        // which is not where CP/M writes the file. Ant's hardware checkpoint saw
        // it claim A: while the receiving beast was on B:.
        await expect(page.locator('#peer-copy-to')).toHaveText('this beast');
        await expect(page.locator('#peer-copy-confirm')).toHaveText('Copy');
        await expect(page.locator('#peer-copy-cancel')).toHaveText('Cancel');
        // UX-DR2 — the .chrome-modal aligned-row family, NOT #send-modal's
        // bespoke <ul><li> (which does not even carry class="chrome-modal").
        expect(await page.evaluate(() =>
            document.getElementById('peer-copy-modal').classList.contains('chrome-modal'))).toBe(true);
        expect(await page.locator('#peer-copy-modal .field').count()).toBe(3);
    });

    test('n files — the plural title and a joined File row @fast', async ({ page }) => {
        await dropAndOpen(page, ['A.TXT', 'B.TXT', 'C.TXT']);
        await expect(page.locator('#peer-copy-modal-title')).toHaveText('Copy 3 files from the other beast?');
        await expect(page.locator('#peer-copy-file')).toHaveText('A.TXT, B.TXT, C.TXT');
    });

    test('nothing reaches the other tab until Copy is confirmed @fast', async ({ page }) => {
        await dropAndOpen(page);
        await settle(page);
        expect((await dropState(page)).requestCount).toBe(0);
        // POSITIVE CONTROL: Copy releases it.
        await page.click('#peer-copy-confirm');
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().requestCount))
            .toBe(1);
    });

    test('Cancel, Esc and backdrop-dismiss all leave the app exactly as it was @fast', async ({ page }) => {
        for (const how of ['cancel', 'esc', 'backdrop']) {
            await dropAndOpen(page);
            if (how === 'cancel') await page.click('#peer-copy-cancel');
            else if (how === 'esc') await page.keyboard.press('Escape');
            else await page.evaluate(() => document.getElementById('peer-copy-modal').click());
            await expect.poll(() => page.evaluate(() => document.getElementById('peer-copy-modal').open))
                .toBe(false);
            await settle(page);
            expect((await dropState(page)).requestCount, `after ${how}`).toBe(0);
            expect((await dropState(page)).lastNotice, `after ${how}`).toBe('');
        }
    });

    test('with the preference OFF the transfer begins directly — no second ceremony @fast', async ({ page }) => {
        await page.evaluate(() => window.__prefs.savePrefs({ slideConfirmTransfers: false }));
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => window.__peerDrop.__getStateForTests().requestCount))
            .toBe(1);
        expect(await page.evaluate(() => document.getElementById('peer-copy-modal').open)).toBe(false);
    });

    test('the preference is read LIVE at drop time, not at boot @fast', async ({ page }) => {
        // Off at drop → no modal.
        await page.evaluate(() => window.__prefs.savePrefs({ slideConfirmTransfers: false }));
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await settle(page);
        expect(await page.evaluate(() => document.getElementById('peer-copy-modal').open)).toBe(false);
        // Flip it on and drop again, with no reload: the modal appears.
        await page.evaluate(() => window.__prefs.savePrefs({ slideConfirmTransfers: true }));
        await dispatchDrag(page, 'drop', { peerPayload: foreignPayload() });
        await expect.poll(() => page.evaluate(() => document.getElementById('peer-copy-modal').open))
            .toBe(true);
    });

    test('AC-9 the modal opens through the shared helper and restores terminal focus @fast', async ({ page }) => {
        const before = await page.evaluate(() => window.__modal.__getStateForTests().openCount);
        await dropAndOpen(page);
        const during = await page.evaluate(() => window.__modal.__getStateForTests());
        // AD-8 — the shared openModal, never a hand-rolled dialog.
        expect(during.openCount).toBe(before + 1);
        expect(during.openDialogId).toBe('peer-copy-modal');
        // Copy is default-focused with the attribute that paints the border.
        expect(await page.evaluate(() =>
            document.getElementById('peer-copy-confirm').getAttribute('data-focused'))).toBe('true');
        await page.click('#peer-copy-cancel');
        // NFR-1 sacred — keystrokes flow back to the Z80.
        await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('terminal-wrapper');
    });
});

// ===== AC-8 — every refusal is legible, and the mapping is exhaustive =====

test.describe('AC-8 the code → sentence mapping', () => {
    test('every code in peerLink.REFUSAL_CODES maps to its verbatim sentence @fast', async ({ page }) => {
        const r = await page.evaluate(async () => {
            const codes = window.__peerLink.REFUSAL_CODES;
            const out = {};
            for (const [k, v] of Object.entries(codes)) {
                out[v] = window.__peerDrop.__getStateForTests && null;
            }
            // sentenceForRefusal is module-level; reach the SAME instance main.js
            // loaded (modal.spec.js:1-13's in-page import rule).
            const m = await import('/input/peer-drop.js');
            const mapped = {};
            for (const v of Object.values(codes)) mapped[v] = m.sentenceForRefusal(v, ['WOTBEAST.FTH']);
            return { codes: Object.values(codes), mapped };
        });
        expect(r.mapped).toEqual({
            'not-connected': "The other beast isn't connected. Connect it in its tab and try again.",
            'busy': 'The other beast is mid-transfer. Wait for it to finish and try again.',
            'no-folder': 'The other beast has no pull folder yet. Choose one in its pull pane and try again.',
            'not-visible': "The other beast's tab isn't visible. Put both tabs side by side in Split View and try again.",
            'pull-failed': "Couldn't fetch WOTBEAST.FTH from the other beast. It's unchanged there — try the drag again.",
            'peer-gone': "The other beast's tab has gone. Reopen it and try again.",
        });
        // Exhaustive over the FROZEN set read off the returned API — not a
        // re-hardcoded copy, and not something attached to window.__peerLink
        // from outside (the defect S11.2's code review fixed).
        expect(r.codes.sort()).toEqual([
            'busy', 'no-folder', 'not-connected', 'not-visible', 'peer-gone', 'pull-failed',
        ]);
    });

    test('an unmapped or unrecognised code still produces a SENTENCE @fast', async ({ page }) => {
        const r = await page.evaluate(async () => {
            const m = await import('/input/peer-drop.js');
            return [
                m.sentenceForRefusal('something-nobody-defined', ['A.TXT']),
                m.sentenceForRefusal(undefined, ['A.TXT']),
                m.sentenceForRefusal(null, ['A.TXT']),
                m.sentenceForRefusal({ nested: 'object' }, ['A.TXT']),
            ];
        });
        for (const s of r) {
            expect(s).toBe("Couldn't fetch A.TXT from the other beast. It's unchanged there — try the drag again.");
            expect(s).not.toContain('object Object');
            expect(s).not.toBe('');
        }
    });

    test('a stale drag is told it went stale, not that the tab has gone @fast', async ({ page }) => {
        // Open Question 2, answered by Ant 2026-08-06. peer-link prunes a nonce
        // after 120 s, so a drag held longer produces a request the source drops
        // in silence and the requester's deadline resolves peer-gone — and the
        // user was told the other tab had GONE about a tab that is right there.
        const r = await page.evaluate(async () => {
            const m = await import('/input/peer-drop.js');
            const gone = window.__peerLink.REFUSAL_CODES.PEER_GONE;
            return {
                fresh: m.sentenceForRefusal(gone, ['A.TXT'], { dragAgeMs: 1_000 }),
                stale: m.sentenceForRefusal(gone, ['A.TXT'], { dragAgeMs: 130_000 }),
                // A payload from a build that predates the timestamp field: no
                // age to judge by, so it keeps the sentence it always had.
                unknownAge: m.sentenceForRefusal(gone, ['A.TXT']),
            };
        });
        expect(r.stale).toBe("That drag took too long — the other beast's tab is still there. Drag it again.");
        // The other two keep the original sentence — this is a NEW branch, not a
        // replacement, and a genuinely-gone tab must still say so.
        expect(r.fresh).toBe("The other beast's tab has gone. Reopen it and try again.");
        expect(r.unknownAge).toBe("The other beast's tab has gone. Reopen it and try again.");
    });

    test('the drag stamp carries a mint timestamp, and its absence is not malformed @fast', async ({ page }) => {
        const r = await page.evaluate(async () => {
            const m = await import('/input/peer-drop.js');
            const before = Date.now();
            const stamped = JSON.parse(window.__peerDrop.getPeerStamp('A.TXT').payload);
            const after = Date.now();
            return {
                t: stamped.t,
                before,
                after,
                // The version does NOT bump for an additive optional field: an
                // old tab's payload must still be honoured, and a new tab's must
                // still parse in an old build.
                v: stamped.v,
                withT: m.parsePayload(JSON.stringify({ v: 1, sessionId: 's', nonce: 'n', names: ['A'], t: 12345 })),
                withoutT: m.parsePayload(JSON.stringify({ v: 1, sessionId: 's', nonce: 'n', names: ['A'] })),
                nonsenseT: m.parsePayload(JSON.stringify({ v: 1, sessionId: 's', nonce: 'n', names: ['A'], t: 'soon' })),
            };
        });
        expect(r.v).toBe(1);
        expect(r.t).toBeGreaterThanOrEqual(r.before);
        expect(r.t).toBeLessThanOrEqual(r.after);
        expect(r.withT.mintedAt).toBe(12345);
        // Absent or nonsense → parsed, just without an age. NOT rejected.
        expect(r.withoutT).not.toBeNull();
        expect(r.withoutT.mintedAt).toBeUndefined();
        expect(r.nonsenseT).not.toBeNull();
        expect(r.nonsenseT.mintedAt).toBeUndefined();
    });

    test('the two stage failures pick singular or plural from the COUNT @fast', async ({ page }) => {
        // Open Question 3, answered by Ant 2026-08-06. Before this a three-file
        // failure borrowed the FIRST name and read as though one file was
        // involved.
        const r = await page.evaluate(async () => {
            const m = await import('/input/peer-drop.js');
            const failed = window.__peerLink.REFUSAL_CODES.PULL_FAILED;
            return {
                one: m.sentenceForRefusal(failed, ['WOTBEAST.FTH']),
                three: m.sentenceForRefusal(failed, ['A.TXT', 'B.TXT', 'C.TXT']),
                sendOne: window.__peerDrop.COPY.sendFailed('WOTBEAST.FTH'),
                sendThree: window.__peerDrop.COPY.sendFailedMany(3),
                pullOne: window.__peerDrop.COPY.pullFailed('WOTBEAST.FTH'),
                pullThree: window.__peerDrop.COPY.pullFailedMany(3),
            };
        });
        expect(r.one).toBe("Couldn't fetch WOTBEAST.FTH from the other beast. It's unchanged there — try the drag again.");
        expect(r.three).toBe("Couldn't fetch 3 files from the other beast. They're unchanged there — try the drag again.");
        expect(r.sendOne).toBe("Couldn't send WOTBEAST.FTH to this beast. A copy is in the other beast's pull folder — drag it from there.");
        expect(r.sendThree).toBe("Couldn't send 3 files to this beast. Copies are in the other beast's pull folder — drag them from there.");
        expect(r.pullOne).toBe(r.one);
        expect(r.pullThree).toBe(r.three);
        // Singular and plural are different sentences, not one with an 's'
        // bolted on: the pronoun and the verb both change.
        expect(r.three).toContain("They're");
        expect(r.sendThree).toContain('Copies are');
    });

    test('AC-12 not one user-facing string in this feature is red @fast', async ({ page }) => {
        // Red is reserved for port-lost and security (prd.md:589). The chip's
        // border is --chrome-accent in every state; assert the notice really
        // renders on it rather than trusting the CSS by reading.
        await page.evaluate(() => window.__slideChip.enterNotice('The other beast has gone.'));
        await expect(page.locator('#slide-chip')).toBeVisible();
        const colours = await page.evaluate(() => {
            const el = document.getElementById('slide-chip');
            const cs = getComputedStyle(el);
            return { border: cs.borderTopColor, colour: cs.color };
        });
        // No pure/dominant red channel in either.
        for (const c of Object.values(colours)) {
            const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!m) continue;
            const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
            expect(r > g + 60 && r > b + 60, `red-dominant colour: ${c}`).toBe(false);
        }
    });
});

// ===== AC-11 — with one tab open, nothing changed =====

test('AC-11 one tab open: the type is stamped, nothing listens, no timer runs @fast', async ({ page }) => {
    // Proven by state, not by a comment claiming it.
    const st = await dropState(page);
    expect(st.requestCount).toBe(0);
    expect(st.dragDepth).toBe(0);
    expect(st.overlayTextOverridden).toBe(false);
    expect(await overlayText(page)).toBe(RESTING);
    // peer-link is equally idle: no waiter, no deadline, no outstanding answer.
    const link = await page.evaluate(() => window.__peerLink.__getStateForTests());
    expect(link.pendingRequests).toBe(0);
    expect(link.liveDeadlines).toBe(0);
    expect(link.outstandingResponses).toBe(0);
    // And the pane has invented no peer pull.
    expect((await page.evaluate(() => window.__pullPane.__getStateForTests())).peerPull).toBeNull();
    // The stamp still happens (FR-14: the drag carries it; nothing listens).
    expect(await page.evaluate(() => window.__peerDrop.getPeerStamp('GAME.COM'))).not.toBeNull();
});

// ===== AC-14 / §3 — the structural assertions this spec cannot make any other way =====

test('AC-2 no handler reads getData before drop — the protected-store rule', async () => {
    // THE case this whole file is shaped around. A synthetic DataTransfer has no
    // protected mode, so a hover-time getData works HERE and returns '' in
    // Chromium. No behavioural assertion can catch that; only the source can.
    const src = readFileSync(MODULE_PATH, 'utf8');
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');

    // getData appears exactly once, and it is inside onDrop.
    const getDataHits = code.match(/getData\s*\(/g) || [];
    expect(getDataHits).toHaveLength(1);
    const onDropBody = code.slice(code.indexOf('function onDrop('), code.indexOf('function onModalBackdropClick('));
    expect(onDropBody).toContain('getData(');

    // The hover-time handlers reach the data store through `types` only.
    for (const fn of ['onDragEnter', 'onDragOver', 'onDragLeave', 'onDragEnd']) {
        const body = code.slice(code.indexOf(`function ${fn}(`));
        const end = body.indexOf('\n}\n');
        expect(body.slice(0, end), `${fn} must not read getData`).not.toContain('getData');
    }
    // And the predicate they all share reads types, never the payload.
    const pred = code.slice(code.indexOf('export function dragIsOurs('));
    expect(pred.slice(0, pred.indexOf('\n}\n'))).not.toContain('getData');
});

test('AD-3 peer-drop.js imports nothing — every dependency is injected', async () => {
    const src = readFileSync(MODULE_PATH, 'utf8');
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/^\s*import\s/m);
    // No persistence of any kind: identity is per-tab and lives in peer-link.
    expect(code).not.toMatch(/sessionStorage|localStorage|indexedDB/);
    // The custom type is lowercase — Chromium lowercases type strings, so a
    // mixed-case constant would never match what `types` reports.
    const typeConst = code.match(/const PEER_DRAG_TYPE\s*=\s*'([^']+)'/);
    expect(typeConst).not.toBeNull();
    expect(typeConst[1]).toBe(typeConst[1].toLowerCase());
});

test('AC-7 the peer-pull wait contains no poll', async () => {
    // The shape S11.4 REMOVED from this codebase after it reported healthy
    // transfers as failed, and that S11.2 declined to reintroduce. Read the
    // pane's peer-pull machinery: setInterval must not appear in it, and every
    // setTimeout must be a one-shot backstop, never re-armed from its own body.
    const src = readFileSync(
        fileURLToPath(new URL('../../renderer/pull-pane.js', import.meta.url)), 'utf8');
    const block = src
        .slice(
            src.indexOf('====== E11 S11.3 — serving a peer'),
            src.indexOf('====== Render ('),
        )
        // Judge the CODE only: the comments in this block name the poll shape
        // they exist to warn against, so an un-stripped scan counts the warning
        // as the offence.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(block.length).toBeGreaterThan(500);          // the slice actually found it
    expect(block).not.toContain('setInterval');
    // Exactly two setTimeout call sites: the tail grace and the start deadline.
    expect(block.match(/setTimeout\(/g) || []).toHaveLength(2);
    // Neither re-arms itself — no setTimeout inside a setTimeout callback.
    expect(block).not.toMatch(/setTimeout\([^)]*setTimeout/);
});
