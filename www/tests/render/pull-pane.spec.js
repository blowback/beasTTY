// Beastty Epic E9 Story S9.1a (FR-1/2/3, NFR-2/4/5, AD-9/AD-10/AD-11) — pull pane shell.
//
// Clones the paste-toast.spec.js shape: boot-race guard on the window.__pullPane
// hook, __resetForTests in beforeEach, @fast where no serial is needed. FSA picker
// and permission prompts can't run headless, so deterministic states are driven
// through the __setDirHandleForTests hook with an in-page fake directory handle
// (the story's "settable test seam" — Testing standards / Dev Notes).
//
// Covers: first-run, bound+listed, permission-needed, empty, the zero-terminal-
// columns invariant (canvas width unchanged with the pane present), neutral-shell
// (identical across a data-theme flip), focus retention, and the narrow-window rail.

import { test, expect } from '@playwright/test';
import { SERIAL_MOCK } from '../transport/mock-serial.js';

const PANE = '#pull-pane';
const CARD = '#pull-pane .pp-card';
const BLANK_MSG = '#pull-pane-blank-msg';

// An in-page fake FileSystemDirectoryHandle. Built inside page.evaluate so its
// methods survive (functions don't cross the evaluate boundary). `permission`
// governs queryPermission; `grantsTo` is what requestPermission resolves to;
// `names` are the files entries() yields (plus one sub-directory, which the
// one-level enumeration must skip).
//
// S9.1b additions: `enumCount` increments on every enumeration (so guard tests can
// assert "the tick did NOT enumerate"), and `__setFiles(next)` mutates the file
// set so a refresh can be driven from unchanged → changed.
const FAKE_HANDLE_FACTORY = `
  (function makeFakeHandle({ name, permission, grantsTo, files }) {
    let curFiles = files.slice();
    const handle = {
      name,
      kind: 'directory',
      enumCount: 0,
      __setFiles(next) { curFiles = next.slice(); },
      async queryPermission() { return permission; },
      async requestPermission() { return grantsTo || permission; },
      async *entries() {
        handle.enumCount++;
        for (const f of curFiles) {
          yield [f.name, { kind: 'file', async getFile() { return { size: f.size }; } }];
        }
        // A sub-directory the v1 one-level enumeration must skip.
        yield ['SUBDIR', { kind: 'directory' }];
      },
    };
    return handle;
  })
`;

async function setup(page) {
    await page.addInitScript(SERIAL_MOCK);
    await page.goto('/');
    await page.locator('#terminal-wrapper').focus();
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    // Boot-race guard (E0.1 learning) — wait on the window.__* hook before driving.
    await page.waitForFunction(() =>
        window.__pullPane && typeof window.__pullPane.__getStateForTests === 'function');
    await page.evaluate(() => window.__pullPane.__resetForTests());
}

// Drive a bound state via the test hook with an in-page fake handle. The handle
// is stashed on window.__ppFake so S9.1b tests can read enumCount / mutate files.
async function bindFake(page, opts) {
    await page.evaluate(async ({ factory, o }) => {
        // eslint-disable-next-line no-eval
        const makeFakeHandle = eval(factory);
        window.__ppFake = makeFakeHandle(o);
        await window.__pullPane.__setDirHandleForTests(window.__ppFake);
    }, { factory: FAKE_HANDLE_FACTORY, o: opts });
}

// N files that overflow the pane list so scrollTop is meaningful. Names are
// zero-padded so name-asc order is stable and predictable.
function manyFiles(n) {
    return Array.from({ length: n }, (_, i) => ({ name: `F${String(i).padStart(2, '0')}.COM`, size: 1000 + i }));
}

// ── Shared state readers (S9.2/S9.3 describes) ──
const view = (page) => page.locator(CARD).getAttribute('data-view');
const reviewState = (page) => page.evaluate(() => window.__pullPane.__getStateForTests().review);
const paneState = (page) => page.evaluate(() => window.__pullPane.__getStateForTests());

// ── Shared drag simulation (S9.3 describes) ──
// Simulate the selection.js observer feed (dragstart/dragend).
const dragState = (page, s) => page.evaluate((st) => window.__pullPane.onSelectionDrag(st), s);
// Dispatch a DragEvent on #pull-pane with an in-page DataTransfer carrying
// text/plain. Returns dispatchEvent's result: false iff preventDefault ran
// (i.e. the pane accepted the drag).
const dispatchDrag = (page, type, text) => page.evaluate(({ t, txt }) => {
    const dt = new DataTransfer();
    if (txt != null) dt.setData('text/plain', txt);
    const ev = new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
    return document.getElementById('pull-pane').dispatchEvent(ev);
}, { t: type, txt: text });

// ── Shared tx-sink byte capture (S9.2/S9.3 transmit specs) ──
// Register the push counter AFTER resetTx (resetTx itself notifies observers).
// Also registers a stub writer: confirm refuses without a connected port
// (WR-03), so the transmit specs need one to reach the push path.
async function armTxCapture(page) {
    await page.evaluate(async () => {
        const tx = await import('/input/tx-sink.js');
        tx.resetTx();
        tx.registerWriter({ write: async () => {} });
        window.__txPushes = 0;
        tx.registerTxObserver(() => { window.__txPushes++; });
    });
}
const txPushes = (page) => page.evaluate(() => window.__txPushes);
const ringBytes = (page) => page.evaluate(async () => {
    const tx = await import('/input/tx-sink.js');
    const hex = tx.formatHexStrip(1024);
    return hex ? hex.split(' ').map((p) => parseInt(p, 16)) : [];
});
// Restore global state touched by the capture so later specs see reality.
const disarmTxCapture = (page) => page.evaluate(async () => {
    const tx = await import('/input/tx-sink.js');
    tx.unregisterWriter();
    tx.resetTx();
    delete window.__txPushes;
});
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

test.describe('E9 S9.1a — pull pane: content states', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('first-run: no folder → "No folder chosen…" + [Choose folder…] @fast', async ({ page }) => {
        await expect(page.locator(PANE)).toBeVisible();
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().view)).toBe('first-run');
        await expect(page.locator(BLANK_MSG)).toHaveText('No folder chosen. Pulled files land here.');
        await expect(page.locator('#pull-pane-choose')).toBeVisible();
        await expect(page.locator('#pull-pane-grant')).toBeHidden();
        await expect(page.locator('#pull-pane-list')).toBeHidden();
    });

    test('bound + granted: lists files one level deep, size right, sub-dir skipped @fast', async ({ page }) => {
        await bindFake(page, {
            name: 'MicroBeastPull', permission: 'granted',
            files: [{ name: 'NOTES.TXT', size: 820 }, { name: 'GAME.COM', size: 12000 }],
        });
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().view)).toBe('list');
        // Enumerated files only (SUBDIR skipped), sorted name-ascending.
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().fileCount)).toBe(2);
        await expect(page.locator('#pull-pane-fname')).toHaveText('MicroBeastPull');
        const rows = page.locator('#pull-pane-list .pp-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0).locator('.pp-nm')).toHaveText('GAME.COM');
        await expect(rows.nth(0).locator('.pp-sz')).toHaveText('12 KB');
        await expect(rows.nth(1).locator('.pp-nm')).toHaveText('NOTES.TXT');
        await expect(rows.nth(1).locator('.pp-sz')).toHaveText('820 B');
        await expect(page.locator('#pull-pane-count')).toHaveText('2 files');
        await expect(page.locator('#pull-pane-foot')).toBeVisible();
    });

    test('permission-needed: not granted → message + [Grant access], does not throw @fast', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await bindFake(page, {
            name: 'MicroBeastPull', permission: 'prompt', grantsTo: 'granted',
            files: [{ name: 'GAME.COM', size: 12000 }],
        });
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().view)).toBe('permission');
        await expect(page.locator(BLANK_MSG)).toHaveText('Permission needed to read this folder.');
        await expect(page.locator('#pull-pane-grant')).toBeVisible();
        await expect(page.locator('#pull-pane-list')).toBeHidden();
        expect(errors).toEqual([]);
        // Granting (user gesture → requestPermission 'granted') re-reads and lists.
        await page.locator('#pull-pane-grant').click();
        await expect(page.locator('#pull-pane-list .pp-row')).toHaveCount(1);
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().view)).toBe('list');
    });

    test('empty: bound + readable + no files → "Empty — pulled files will appear here." @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().view)).toBe('empty');
        await expect(page.locator(BLANK_MSG)).toHaveText('Empty — pulled files will appear here.');
        await expect(page.locator('#pull-pane-list')).toBeHidden();
        await expect(page.locator('#pull-pane-count')).toHaveText('0 files');
        await expect(page.locator('#pull-pane-foot')).toBeVisible();
    });
});

test.describe('E9 S9.1a — pull pane: layout, shell, focus (AC-1/2/7)', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    test('zero terminal columns: canvas width is unchanged with the pane present @fast', async ({ page }) => {
        await bindFake(page, {
            name: 'MicroBeastPull', permission: 'granted',
            files: [{ name: 'GAME.COM', size: 12000 }],
        });
        await expect(page.locator(CARD)).toBeVisible();
        const withPane = await page.locator('#terminal').evaluate((el) => el.getBoundingClientRect().width);
        // Remove the pane entirely and re-measure — the fixed-size canvas must not reflow.
        await page.locator(PANE).evaluate((el) => el.remove());
        const withoutPane = await page.locator('#terminal').evaluate((el) => el.getBoundingClientRect().width);
        expect(withoutPane).toBe(withPane);
    });

    test('neutral shell: card styling is identical across a data-theme flip @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        const read = () => page.locator(CARD).evaluate((el) => {
            const s = getComputedStyle(el);
            return { bg: s.backgroundColor, fg: s.color, border: s.borderTopColor, shadow: s.boxShadow };
        });
        const theme = await page.evaluate(() => document.body.getAttribute('data-theme'));
        const before = await read();
        expect(before.shadow).toBe('none');
        await page.evaluate((cur) => {
            document.body.setAttribute('data-theme', cur === 'crt' ? 'console' : 'crt');
        }, theme);
        const after = await read();
        expect(after.bg).toBe(before.bg);
        expect(after.fg).toBe(before.fg);
        expect(after.border).toBe(before.border);
        expect(after.shadow).toBe('none');
    });

    test('focus retention (AD-10 sacred): clicking [Choose folder…] keeps #terminal-wrapper focus @fast', async ({ page }) => {
        // Stub the picker so the click's onChoose handler settles without a headless prompt.
        await page.evaluate(() => {
            window.showDirectoryPicker = async () => { const e = new Error('dismissed'); e.name = 'AbortError'; throw e; };
        });
        await page.locator('#terminal-wrapper').focus();
        await page.locator('#pull-pane-choose').click();
        expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
    });

    test('narrow window: pane collapses to the file-count rail (card hidden) @fast', async ({ page }) => {
        await bindFake(page, {
            name: 'MicroBeastPull', permission: 'granted',
            files: [{ name: 'A.COM', size: 10 }, { name: 'B.COM', size: 20 }, { name: 'C.COM', size: 30 }],
        });
        await page.setViewportSize({ width: 720, height: 900 });
        // The container query swaps the card for the rail; the badge shows the count.
        await expect(page.locator(CARD)).toBeHidden();
        await expect(page.locator('#pull-pane .pp-rail')).toBeVisible();
        await expect(page.locator('#pull-pane-badge')).toHaveText('3');
    });
});

// ── S9.1b — refresh triggers (FR-8), timer guards (FR-9), diff-render (FR-10) ──
test.describe('E9 S9.1b — pull pane: refresh triggers, guards, diff-render', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    const enumCount = (page) => page.evaluate(() => window.__ppFake.enumCount);
    const scrollTop = (page) => page.evaluate(() => document.getElementById('pull-pane-list').scrollTop);
    const oneFile = [{ name: 'A.COM', size: 10 }];

    test('focus trigger: window focus re-enumerates the bound folder @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: oneFile });
        const before = await enumCount(page);   // 1 (the bind enumeration)
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        // The focus handler runs triggerRefresh fire-and-forget; wait for the re-read.
        await expect.poll(() => enumCount(page)).toBe(before + 1);
    });

    test('timer tick: re-enumerates the bound folder @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: oneFile });
        const before = await enumCount(page);
        await page.evaluate(() => window.__pullPane.__timerTickForTests());
        expect(await enumCount(page)).toBe(before + 1);
    });

    test('permission guard: tick with a "prompt" handle does not enumerate or prompt @fast', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await bindFake(page, { name: 'MicroBeastPull', permission: 'prompt', grantsTo: 'granted', files: oneFile });
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().view)).toBe('permission');
        const before = await enumCount(page);   // 0 — permission-needed never enumerated
        await page.evaluate(() => window.__pullPane.__timerTickForTests());
        // Silent skip: no enumeration, no view change, no error.
        expect(await enumCount(page)).toBe(before);
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().view)).toBe('permission');
        expect(errors).toEqual([]);
    });

    test('hidden guard: tick while document.hidden skips; visible tick resumes @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: oneFile });
        const before = await enumCount(page);   // 1
        // Stub document.hidden = true, then tick → guarded skip.
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            return window.__pullPane.__timerTickForTests();
        });
        expect(await enumCount(page)).toBe(before);
        // Flip visible and tick again → re-enumerates. Restore reality afterwards.
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
            return window.__pullPane.__timerTickForTests();
        });
        expect(await enumCount(page)).toBe(before + 1);
        await page.evaluate(() => { delete document.hidden; });
    });

    test('unchanged refresh: identical contents → zero DOM churn, scroll preserved (UX-DR4) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: manyFiles(60) });
        await expect(page.locator('#pull-pane-list .pp-row')).toHaveCount(60);
        // Bound the list height (the pane otherwise grows and the page scrolls, not
        // the list) so scrollTop is a real internal offset, then scroll + tag the
        // 6th row so we can prove node identity survives.
        await page.evaluate(() => {
            const list = document.getElementById('pull-pane-list');
            list.style.maxHeight = '300px';
            list.scrollTop = 200;
            list.querySelectorAll('.pp-row')[5].dataset.tag = 'keepme';
        });
        const scrollBefore = await scrollTop(page);
        expect(scrollBefore).toBeGreaterThan(0);
        const enumBefore = await enumCount(page);
        // Tick with identical contents — the guard passes (it DID enumerate) …
        await page.evaluate(() => window.__pullPane.__timerTickForTests());
        expect(await enumCount(page)).toBe(enumBefore + 1);
        // … but the diff skipped the render: tagged node still present, still 6th,
        // and the scroll position is untouched.
        expect(await page.evaluate(() => !!document.querySelector('#pull-pane-list .pp-row[data-tag="keepme"]'))).toBe(true);
        expect(await page.evaluate(() => document.querySelectorAll('#pull-pane-list .pp-row')[5].dataset.tag)).toBe('keepme');
        expect(await scrollTop(page)).toBe(scrollBefore);
    });

    test('changed refresh: new file mints fresh at the top, scroll + count updated @fast', async ({ page }) => {
        const base = manyFiles(40);
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: base });
        await expect(page.locator('#pull-pane-list .pp-row')).toHaveCount(40);
        // Bound the list height so scrollTop is a real internal offset (see the
        // unchanged-refresh test for why the pane otherwise grows unbounded).
        await page.evaluate(() => {
            const list = document.getElementById('pull-pane-list');
            list.style.maxHeight = '300px';
            list.scrollTop = 150;
        });
        const scrollBefore = await scrollTop(page);
        expect(scrollBefore).toBeGreaterThan(0);
        // Add a file whose name sorts to the MIDDLE — so it can only be on top by
        // virtue of being fresh, not by alphabetical order.
        await page.evaluate((b) => {
            window.__ppFake.__setFiles([...b, { name: 'F19B.COM', size: 4096 }]);
            return window.__pullPane.__timerTickForTests();
        }, base);
        await expect(page.locator('#pull-pane-list .pp-row')).toHaveCount(41);
        const first = page.locator('#pull-pane-list .pp-row').first();
        await expect(first).toHaveClass(/\bfresh\b/);
        await expect(first.locator('.pp-nm')).toHaveText('F19B.COM');
        // Exactly the one arrival is fresh; count/badge updated; scroll preserved.
        await expect(page.locator('#pull-pane-list .pp-row.fresh')).toHaveCount(1);
        await expect(page.locator('#pull-pane-count')).toHaveText('41 files');
        await expect(page.locator('#pull-pane-badge')).toHaveText('41');
        expect(await scrollTop(page)).toBe(scrollBefore);
    });

    test('fresh markers are replaced by the next content-changing refresh @fast', async ({ page }) => {
        const base = manyFiles(5);
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: base });
        // First arrival → ONE.COM fresh.
        await page.evaluate((b) => {
            window.__ppFake.__setFiles([...b, { name: 'ONE.COM', size: 100 }]);
            return window.__pullPane.__timerTickForTests();
        }, base);
        await expect(page.locator('#pull-pane-list .pp-row.fresh')).toHaveCount(1);
        // Second arrival → TWO.COM fresh, ONE.COM no longer fresh (set replaced).
        await page.evaluate((b) => {
            window.__ppFake.__setFiles([...b, { name: 'ONE.COM', size: 100 }, { name: 'TWO.COM', size: 200 }]);
            return window.__pullPane.__timerTickForTests();
        }, base);
        await expect(page.locator('#pull-pane-list .pp-row.fresh')).toHaveCount(1);
        await expect(page.locator('#pull-pane-list .pp-row.fresh .pp-nm')).toHaveText('TWO.COM');
    });

    test('refresh() API (the transfer-done trigger) re-enumerates the bound folder @fast', async ({ page }) => {
        // main.js's onFileLanded calls pullPane.refresh(); prove that path re-reads.
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: oneFile });
        const before = await enumCount(page);
        await page.evaluate(() => window.__pullPane.refresh());
        expect(await enumCount(page)).toBe(before + 1);
    });

    test('manual ↻ button refreshes and keeps #terminal-wrapper focus (AD-10) @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: oneFile });
        await page.locator('#terminal-wrapper').focus();
        const before = await enumCount(page);
        await page.locator('#pull-pane-refresh').click();
        await expect.poll(() => enumCount(page)).toBe(before + 1);
        expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
    });
});

// ── S9.2 — selection → SLIDE S: tokenize/validate/compose + in-pane review ──
// beginReview(text) is the public entry point (S9.3's drop handler calls it next).
// Byte capture goes through the tx-sink ESM singleton: resetTx() → confirm →
// formatHexStrip read back as bytes; registerTxObserver counts pushes (one
// combined command+terminator push is part of the contract — AC-4).
test.describe('E9 S9.2 — pull pane: selection → SLIDE S review', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    const TOOLTIP_83 = 'Not a CP/M 8.3 name (name ≤8, ext ≤3, uppercase). v1 only pulls 8.3 names.';

    test('classification: valid / lowercase / over-length / invalid-char / duplicate → rows + composed command @fast', async ({ page }) => {
        const ok = await page.evaluate(() =>
            window.__pullPane.beginReview('GAME.COM notes.txt TOOLONGNAME.TXT BAD:NM GAME.COM DUMP.BIN'));
        expect(ok).toBe(true);
        expect(await view(page)).toBe('review');
        const rv = await reviewState(page);
        expect(rv.command).toBe('SLIDE S GAME.COM DUMP.BIN');
        expect(rv.validCount).toBe(2);
        // 5 rows — the exact-duplicate GAME.COM collapsed into the first occurrence.
        await expect(page.locator('#pull-pane-toklist .pp-tok')).toHaveCount(5);
        await expect(page.locator('#pull-pane-toklist .pp-tok.ok .nm')).toHaveText(['GAME.COM', 'DUMP.BIN']);
        const skipped = page.locator('#pull-pane-toklist .pp-tok.skip');
        await expect(skipped.locator('.nm')).toHaveText(['notes.txt', 'TOOLONGNAME.TXT', 'BAD:NM']);
        await expect(skipped.nth(0).locator('.why')).toHaveText(/skipped/);
        // 8.3-shape failures carry the verbatim tooltip; validator failures surface its reason.
        expect(await skipped.nth(0).locator('.pp-info').getAttribute('title')).toBe(TOOLTIP_83);
        expect(await skipped.nth(1).locator('.pp-info').getAttribute('title')).toBe(TOOLTIP_83);
        expect(await skipped.nth(2).locator('.pp-info').getAttribute('title')).toContain(':');
        // Composed line with the mint › prefix; confirm counts valid names; caption swaps.
        await expect(page.locator('#pull-pane-cmdtext')).toHaveText('SLIDE S GAME.COM DUMP.BIN');
        await expect(page.locator('#pull-pane-confirm')).toHaveText('Pull 2 files');
        await expect(page.locator('#pull-pane-confirm')).toBeEnabled();
        await expect(page.locator('#pull-pane-cap-label')).toHaveText('Review — pull to this folder');
    });

    test('confirm pushes exactly the command + CR terminator in ONE push (cr mode) @fast', async ({ page }) => {
        await armTxCapture(page);
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM DUMP.BIN'));
        await page.locator('#pull-pane-confirm').click();
        expect(await txPushes(page)).toBe(1);
        expect(await ringBytes(page)).toEqual(ascii('SLIDE S GAME.COM DUMP.BIN').concat([0x0D]));
        // Review exits back to the content view.
        expect(await view(page)).not.toBe('review');
        expect(await reviewState(page)).toBe(null);
        await disarmTxCapture(page);
    });

    test('confirm reads Settings ▸ Enter key sends at confirm time (crlf → 0D 0A) @fast', async ({ page }) => {
        await armTxCapture(page);
        await page.evaluate(async () => (await import('/input/keyboard.js')).setCrlfMode('crlf'));
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        await page.locator('#pull-pane-confirm').click();
        expect(await ringBytes(page)).toEqual(ascii('SLIDE S GAME.COM').concat([0x0D, 0x0A]));
        await page.evaluate(async () => (await import('/input/keyboard.js')).setCrlfMode('cr'));
        await disarmTxCapture(page);
    });

    test('cancel transmits nothing and restores the content view + caption @fast', async ({ page }) => {
        await bindFake(page, {
            name: 'MicroBeastPull', permission: 'granted',
            files: [{ name: 'GAME.COM', size: 12000 }],
        });
        await armTxCapture(page);
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        expect(await view(page)).toBe('review');
        await expect(page.locator('#pull-pane-confirm')).toHaveText('Pull 1 file');
        await page.locator('#pull-pane-cancel').click();
        expect(await txPushes(page)).toBe(0);
        expect(await ringBytes(page)).toEqual([]);
        expect(await view(page)).toBe('list');
        expect(await reviewState(page)).toBe(null);
        await expect(page.locator('#pull-pane-cap-label')).toHaveText('Local folder');
        await disarmTxCapture(page);
    });

    test('zero valid names: message + disabled [Pull…] — no bare SLIDE S possible @fast', async ({ page }) => {
        await armTxCapture(page);
        await page.evaluate(() => window.__pullPane.beginReview('read this prose notes.txt'));
        expect(await view(page)).toBe('review');
        const rv = await reviewState(page);
        expect(rv.command).toBe(null);
        expect(rv.validCount).toBe(0);
        await expect(page.locator('#pull-pane-nothing')).toBeVisible();
        await expect(page.locator('#pull-pane-nothing'))
            .toHaveText('Nothing to pull — no CP/M 8.3 names in the selection.');
        await expect(page.locator('#pull-pane-cmdline')).toBeHidden();
        await expect(page.locator('#pull-pane-confirm')).toBeDisabled();
        // Skipped tokens still render as rows (flagged, never silent — FR-7).
        await expect(page.locator('#pull-pane-toklist .pp-tok.skip')).toHaveCount(4);
        // Belt-and-braces: a programmatic click on the disabled button pushes nothing.
        await page.evaluate(() => document.getElementById('pull-pane-confirm').click());
        expect(await txPushes(page)).toBe(0);
        await disarmTxCapture(page);
    });

    test('empty/whitespace selection still opens review with the zero-valid message @fast', async ({ page }) => {
        expect(await page.evaluate(() => window.__pullPane.beginReview('   \n  '))).toBe(true);
        expect(await view(page)).toBe('review');
        await expect(page.locator('#pull-pane-toklist .pp-tok')).toHaveCount(0);
        await expect(page.locator('#pull-pane-nothing')).toBeVisible();
        await expect(page.locator('#pull-pane-confirm')).toBeDisabled();
    });

    test('suspension (FR-11): active SLIDE refuses beginReview AND refuses confirm @fast', async ({ page }) => {
        await armTxCapture(page);
        // beginReview refused while a SLIDE session is active.
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(true));
        expect(await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'))).toBe(false);
        expect(await view(page)).not.toBe('review');
        expect(await reviewState(page)).toBe(null);
        // Open review while idle, THEN a transfer starts → confirm re-checks and refuses.
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(null));
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(true));
        await page.locator('#pull-pane-confirm').click();
        expect(await txPushes(page)).toBe(0);
        expect(await view(page)).toBe('review');   // stays open for a later confirm
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(null));
        await disarmTxCapture(page);
    });

    test('suspension covers SEND sessions: wire owner slide refuses beginReview AND confirm @fast', async ({ page }) => {
        await armTxCapture(page);
        // slide-recv never sees a slideRef in send sessions, so the injected
        // predicate also checks tx-sink wire ownership (the send-mode signal).
        await page.evaluate(() => window.__txSink.setWireOwner('slide'));
        expect(await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'))).toBe(false);
        expect(await reviewState(page)).toBe(null);
        // Open review while idle, THEN a send session takes the wire → confirm refuses.
        await page.evaluate(() => window.__txSink.setWireOwner('terminal'));
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        await page.evaluate(() => window.__txSink.setWireOwner('slide'));
        await page.locator('#pull-pane-confirm').click();
        expect(await txPushes(page)).toBe(0);
        expect(await view(page)).toBe('review');   // stays open for a later confirm
        await page.evaluate(() => window.__txSink.setWireOwner('terminal'));
        await disarmTxCapture(page);
    });

    test('confirm refuses with no serial port connected (WR-03) — review stays open @fast', async ({ page }) => {
        await armTxCapture(page);
        // Simulate the disconnected state the mock writer papered over.
        await page.evaluate(async () => (await import('/input/tx-sink.js')).unregisterWriter());
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        await page.locator('#pull-pane-confirm').click();
        expect(await txPushes(page)).toBe(0);
        expect(await ringBytes(page)).toEqual([]);
        expect(await view(page)).toBe('review');   // connect, then confirm again
        await disarmTxCapture(page);
    });

    test('a background refresh updates the list underneath without evicting the review @fast', async ({ page }) => {
        const base = [{ name: 'A.COM', size: 10 }];
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: base });
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        expect(await view(page)).toBe('review');
        // Tag a review row to prove node identity survives the refresh render.
        await page.evaluate(() => { document.querySelector('#pull-pane-toklist .pp-tok').dataset.tag = 'keepme'; });
        await page.evaluate((b) => {
            window.__ppFake.__setFiles([...b, { name: 'NEW.BIN', size: 42 }]);
            return window.__pullPane.__timerTickForTests();
        }, base);
        // Still reviewing; review DOM untouched; the underlying list state moved on.
        expect(await view(page)).toBe('review');
        expect(await page.evaluate(() => document.querySelector('#pull-pane-toklist .pp-tok').dataset.tag)).toBe('keepme');
        expect(await page.evaluate(() => window.__pullPane.__getStateForTests().fileCount)).toBe(2);
        // Exiting review lands on the refreshed list.
        await page.locator('#pull-pane-cancel').click();
        expect(await view(page)).toBe('list');
        await expect(page.locator('#pull-pane-list .pp-row')).toHaveCount(2);
    });

    test('focus retention (AD-10): Cancel and [Pull N files] keep #terminal-wrapper focus @fast', async ({ page }) => {
        await armTxCapture(page);
        await page.locator('#terminal-wrapper').focus();
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        await page.locator('#pull-pane-cancel').click();
        expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
        await page.evaluate(() => window.__pullPane.beginReview('GAME.COM'));
        await page.locator('#pull-pane-confirm').click();
        expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
        await disarmTxCapture(page);
    });
});

// ── S9.3 — drop-to-pull: affordance (UX-DR3), drop→review, e2e chain (FR-6/8),
//    rail bloom (FR-2), 126-char cap (AC-7) ──
// Drag state is driven through the public onSelectionDrag entry point (AC-9 —
// no extra __ hook); DragEvents are dispatched on #pull-pane with an in-page
// DataTransfer, which tests the handlers deterministically (the native drag
// loop itself is the T7 manual checkpoint).
test.describe('E9 S9.3 — pull pane: drop-to-pull', () => {
    test.beforeEach(async ({ page }) => { await setup(page); });

    const FOOT_RESTING = 'Drag a filename selection here to pull';
    const REASON_LIMIT = 'over the 126-char CP/M command-line limit';

    test('affordance: dragenter shows drop classes + verbatim footer copy; dragleave restores @fast', async ({ page }) => {
        await bindFake(page, {
            name: 'MicroBeastPull', permission: 'granted',
            files: [{ name: 'NOTES.TXT', size: 820 }],
        });
        await dragState(page, { active: true, text: 'GAME.COM DUMP.BIN prose' });
        const accepted = await dispatchDrag(page, 'dragenter', 'GAME.COM DUMP.BIN prose');
        expect(accepted).toBe(false);   // preventDefault ran — drop is acceptable
        expect((await paneState(page)).dropAffordance).toBe(true);
        await expect(page.locator(CARD)).toHaveClass(/\bdrop\b/);
        await expect(page.locator('#pull-pane-foot')).toHaveClass(/\bdrop-active\b/);
        // Valid-token count only (prose excluded), verbatim ⤓ copy (EXPERIENCE.md:130).
        await expect(page.locator('#pull-pane-foot')).toHaveText('⤓ Drop to pull 2 files');
        // Leave-to-zero clears everything and restores the resting hint.
        await dispatchDrag(page, 'dragleave', null);
        expect((await paneState(page)).dropAffordance).toBe(false);
        await expect(page.locator(CARD)).not.toHaveClass(/\bdrop\b/);
        await expect(page.locator('#pull-pane-foot')).not.toHaveClass(/\bdrop-active\b/);
        await expect(page.locator('#pull-pane-foot')).toHaveText(FOOT_RESTING);
        await dragState(page, { active: false });
    });

    test('affordance: singular copy for one file; depth-counted across nested enter/leave @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await dragState(page, { active: true, text: 'GAME.COM' });
        await dispatchDrag(page, 'dragenter', 'GAME.COM');
        await expect(page.locator('#pull-pane-foot')).toHaveText('⤓ Drop to pull 1 file');
        // A second enter (child element) then one leave keeps the affordance on…
        await dispatchDrag(page, 'dragenter', 'GAME.COM');
        await dispatchDrag(page, 'dragleave', null);
        expect((await paneState(page)).dropAffordance).toBe(true);
        // …and the second leave (depth 0) clears it.
        await dispatchDrag(page, 'dragleave', null);
        expect((await paneState(page)).dropAffordance).toBe(false);
        // dragend (drag-state off) also fully clears a stuck affordance.
        await dispatchDrag(page, 'dragenter', 'GAME.COM');
        expect((await paneState(page)).dropAffordance).toBe(true);
        await dragState(page, { active: false });
        expect((await paneState(page)).dropAffordance).toBe(false);
        await expect(page.locator('#pull-pane-foot')).toHaveText(FOOT_RESTING);
    });

    test('foreign drags ignored: no in-app selection drag → no affordance, no preventDefault, no review @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        // No onSelectionDrag({active:true}) — this is a foreign text drag.
        const enterNotPrevented = await dispatchDrag(page, 'dragenter', 'GAME.COM');
        expect(enterNotPrevented).toBe(true);   // fell through untouched → browser shows no-drop
        expect((await paneState(page)).dropAffordance).toBe(false);
        await expect(page.locator(CARD)).not.toHaveClass(/\bdrop\b/);
        await dispatchDrag(page, 'drop', 'GAME.COM');
        expect(await reviewState(page)).toBe(null);
        expect(await view(page)).not.toBe('review');
    });

    test('suspension: active SLIDE session → no affordance, drop inert @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(true));
        await dragState(page, { active: true, text: 'GAME.COM' });
        const notPrevented = await dispatchDrag(page, 'dragenter', 'GAME.COM');
        expect(notPrevented).toBe(true);
        expect((await paneState(page)).dropAffordance).toBe(false);
        await dispatchDrag(page, 'drop', 'GAME.COM');
        expect(await reviewState(page)).toBe(null);
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(null));
        await dragState(page, { active: false });
    });

    test('no folder bound (first-run) → no affordance, drop inert @fast', async ({ page }) => {
        expect((await paneState(page)).view).toBe('first-run');
        await dragState(page, { active: true, text: 'GAME.COM' });
        const notPrevented = await dispatchDrag(page, 'dragenter', 'GAME.COM');
        expect(notPrevented).toBe(true);
        expect((await paneState(page)).dropAffordance).toBe(false);
        await dispatchDrag(page, 'drop', 'GAME.COM');
        expect(await reviewState(page)).toBe(null);
        await dragState(page, { active: false });
    });

    test('drop opens the S9.2 review; affordance cleared; a second drop replaces it @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await dragState(page, { active: true, text: 'GAME.COM' });
        await dispatchDrag(page, 'dragenter', 'GAME.COM');
        await dispatchDrag(page, 'drop', 'GAME.COM');
        await dragState(page, { active: false });
        expect(await view(page)).toBe('review');
        expect((await reviewState(page)).command).toBe('SLIDE S GAME.COM');
        expect((await paneState(page)).dropAffordance).toBe(false);
        await expect(page.locator(CARD)).not.toHaveClass(/\bdrop\b/);
        // Drop while the review is open replaces the review content (AC-3).
        await dragState(page, { active: true, text: 'DUMP.BIN' });
        await dispatchDrag(page, 'dragenter', 'DUMP.BIN');
        await dispatchDrag(page, 'drop', 'DUMP.BIN');
        await dragState(page, { active: false });
        expect(await view(page)).toBe('review');
        expect((await reviewState(page)).command).toBe('SLIDE S DUMP.BIN');
        await expect(page.locator('#pull-pane-cmdtext')).toHaveText('SLIDE S DUMP.BIN');
    });

    test('drop falls back to the drag-state stash when dataTransfer text is empty @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await dragState(page, { active: true, text: 'GAME.COM DUMP.BIN' });
        await dispatchDrag(page, 'drop', null);   // empty DataTransfer
        expect((await reviewState(page)).command).toBe('SLIDE S GAME.COM DUMP.BIN');
        await dragState(page, { active: false });
    });

    test('suspension flipping mid-drag: drop after the flip opens nothing, sends nothing @fast', async ({ page }) => {
        await armTxCapture(page);
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await dragState(page, { active: true, text: 'GAME.COM' });
        await dispatchDrag(page, 'dragenter', 'GAME.COM');
        expect((await paneState(page)).dropAffordance).toBe(true);
        // A SLIDE transfer starts while the drag is mid-air…
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(true));
        await dispatchDrag(page, 'drop', 'GAME.COM');
        expect(await reviewState(page)).toBe(null);
        expect(await txPushes(page)).toBe(0);
        // …and dragend still clears the stuck affordance.
        await dragState(page, { active: false });
        expect((await paneState(page)).dropAffordance).toBe(false);
        await page.evaluate(() => window.__pullPane.__setSlideActiveForTests(null));
        await disarmTxCapture(page);
    });

    test('zero-valid drop opens the S9.2 zero-valid review — no bare SLIDE S possible (FR-7) @fast', async ({ page }) => {
        await armTxCapture(page);
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await dragState(page, { active: true, text: 'read this prose' });
        await dispatchDrag(page, 'drop', 'read this prose');
        await dragState(page, { active: false });
        expect(await view(page)).toBe('review');
        expect((await reviewState(page)).command).toBe(null);
        await expect(page.locator('#pull-pane-nothing'))
            .toHaveText('Nothing to pull — no CP/M 8.3 names in the selection.');
        await expect(page.locator('#pull-pane-confirm')).toBeDisabled();
        await page.evaluate(() => document.getElementById('pull-pane-confirm').click());
        expect(await txPushes(page)).toBe(0);
        await disarmTxCapture(page);
    });

    test('DIR columnar: NAME EXT pairs join dot-less, drive prefix + ":" separators dropped @fast', async ({ page }) => {
        // The user's real drag off a DIR screen: 'A: VLOAD    COM : VPEEK    COM'.
        await page.evaluate(() =>
            window.__pullPane.beginReview('A: VLOAD    COM : VPEEK    COM'));
        let rv = await reviewState(page);
        expect(rv.command).toBe('SLIDE S VLOAD.COM VPEEK.COM');
        expect(rv.validCount).toBe(2);
        await expect(page.locator('#pull-pane-toklist .pp-tok')).toHaveCount(2);
        await expect(page.locator('#pull-pane-toklist .pp-tok.ok .nm'))
            .toHaveText(['VLOAD.COM', 'VPEEK.COM']);
        // Single columnar pair joins too; dot-joined names pass through beside it.
        await page.evaluate(() =>
            window.__pullPane.beginReview('GAME.COM VPEEK    COM'));
        rv = await reviewState(page);
        expect(rv.command).toBe('SLIDE S GAME.COM VPEEK.COM');
        // Lowercase prose never joins (the joined form fails the uppercase
        // idempotence check), and a join that would exceed 8.3 shape is left split.
        await page.evaluate(() =>
            window.__pullPane.beginReview('read me TOOLONGNAME COM'));
        rv = await reviewState(page);
        // TOOLONGNAME (9 chars) can't join; COM alone is still a valid bare name.
        expect(rv.command).toBe('SLIDE S COM');
        const skipped = page.locator('#pull-pane-toklist .pp-tok.skip .nm');
        await expect(skipped).toHaveText(['read', 'me', 'TOOLONGNAME']);
        await page.locator('#pull-pane-cancel').click();
    });

    test('long review scrolls inside the pane — the window never grows a scrollbar @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        const noWindowScroll = () => page.evaluate(() =>
            document.documentElement.scrollHeight <= document.documentElement.clientHeight);
        expect(await noWindowScroll()).toBe(true);
        // 49 distinct names → 49 review rows (cap-skipped ones still render),
        // far taller than the viewport. The pane must not inflate the stage.
        const names = Array.from({ length: 49 }, (_, i) => `N${String(i).padStart(2, '0')}.COM`);
        await page.evaluate((t) => window.__pullPane.beginReview(t), names.join(' '));
        await expect(page.locator('#pull-pane-toklist .pp-tok')).toHaveCount(49);
        expect(await noWindowScroll()).toBe(true);
        // The overflow lives inside the token list (its own scrollbar engages)…
        expect(await page.evaluate(() => {
            const el = document.getElementById('pull-pane-toklist');
            return el.scrollHeight > el.clientHeight;
        })).toBe(true);
        // …while the command line stays visible above it, un-squeezed (its
        // overflow-x:auto zeroes the flex minimum, so without flex-shrink:0 a
        // long list collapses it to just its horizontal scrollbar).
        const cmd = await page.locator('#pull-pane-cmdline').boundingBox();
        expect(cmd.height).toBeGreaterThan(25);
        await expect(page.locator('#pull-pane-cmdtext')).toBeVisible();
        // Same containment for the plain file list view.
        await page.locator('#pull-pane-cancel').click();
        await page.evaluate(() => {
            window.__ppFake.__setFiles(Array.from({ length: 80 }, (_, i) =>
                ({ name: `L${String(i).padStart(2, '0')}.BIN`, size: 100 + i })));
            return window.__pullPane.refresh();
        });
        await expect(page.locator('#pull-pane-list .pp-row')).toHaveCount(80);
        expect(await noWindowScroll()).toBe(true);
        expect(await page.evaluate(() => {
            const el = document.getElementById('pull-pane-list');
            return el.scrollHeight > el.clientHeight;
        })).toBe(true);
    });

    test('e2e chain (AC-5): drop → review → confirm → ONE push of exact bytes → landed files appear fresh @fast', async ({ page }) => {
        const base = [{ name: 'NOTES.TXT', size: 820 }];
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: base });
        await armTxCapture(page);
        // Drop the dragged selection on the pane.
        await dragState(page, { active: true, text: 'GAME.COM DUMP.BIN' });
        await dispatchDrag(page, 'dragenter', 'GAME.COM DUMP.BIN');
        await dispatchDrag(page, 'drop', 'GAME.COM DUMP.BIN');
        await dragState(page, { active: false });
        expect(await view(page)).toBe('review');
        // Confirm → exactly ONE push: ASCII command + configured terminator (cr).
        await page.locator('#pull-pane-confirm').click();
        expect(await txPushes(page)).toBe(1);
        expect(await ringBytes(page)).toEqual(ascii('SLIDE S GAME.COM DUMP.BIN').concat([0x0D]));
        expect(await view(page)).toBe('list');
        // Confirm also handed the batch size to the SLIDE dispatcher (the
        // injected onPullRequested → setExpectedRecvFiles), so the transfer
        // chip can show "N/2" for this pull.
        expect(await page.evaluate(() => window.__slide.__getStateForTests().expectedRecvFiles)).toBe(2);
        // Device reply lands the files in the shared folder → onFileLanded fires
        // pullPane.refresh() (the very function main.js wires) → both files
        // appear with fresh markers, sorted to the top.
        await page.evaluate((b) => {
            window.__ppFake.__setFiles([...b,
                { name: 'GAME.COM', size: 12000 }, { name: 'DUMP.BIN', size: 4096 }]);
            return window.__pullPane.refresh();
        }, base);
        await expect(page.locator('#pull-pane-list .pp-row')).toHaveCount(3);
        await expect(page.locator('#pull-pane-list .pp-row.fresh')).toHaveCount(2);
        const rows = page.locator('#pull-pane-list .pp-row');
        await expect(rows.nth(0).locator('.pp-nm')).toHaveText('DUMP.BIN');
        await expect(rows.nth(1).locator('.pp-nm')).toHaveText('GAME.COM');
        await expect(rows.nth(0)).toHaveClass(/\bfresh\b/);
        await expect(rows.nth(1)).toHaveClass(/\bfresh\b/);
        await disarmTxCapture(page);
    });

    test('e2e terminator variant: crlf mode → command + 0D 0A through the drop path @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await armTxCapture(page);
        await page.evaluate(async () => (await import('/input/keyboard.js')).setCrlfMode('crlf'));
        await dragState(page, { active: true, text: 'GAME.COM' });
        await dispatchDrag(page, 'drop', 'GAME.COM');
        await dragState(page, { active: false });
        await page.locator('#pull-pane-confirm').click();
        expect(await ringBytes(page)).toEqual(ascii('SLIDE S GAME.COM').concat([0x0D, 0x0A]));
        await page.evaluate(async () => (await import('/input/keyboard.js')).setCrlfMode('cr'));
        await disarmTxCapture(page);
    });

    test('length cap (AC-7): boundary at 126 chars — last fit included, overflow skipped with reason @fast', async ({ page }) => {
        // 'SLIDE S ' (8) + nine 12-char names joined (116) = 124; + ' A' = 126
        // (exactly at the cap → included); 'B' would make 128 → skipped, along
        // with every later valid token. A duplicate of an included name
        // collapses without burning budget.
        const nine = Array.from({ length: 9 }, (_, i) => `AAAAAAA${i}.COM`);
        const text = [...nine, 'A', 'AAAAAAA0.COM', 'B', 'C.TXT'].join(' ');
        await page.evaluate((t) => window.__pullPane.beginReview(t), text);
        const rv = await reviewState(page);
        expect(rv.command).toBe(`SLIDE S ${nine.join(' ')} A`);
        expect(rv.command.length).toBe(126);
        expect(rv.validCount).toBe(10);
        // 12 rows: 10 included + B + C.TXT (the duplicate collapsed, no row).
        await expect(page.locator('#pull-pane-toklist .pp-tok')).toHaveCount(12);
        const skipped = page.locator('#pull-pane-toklist .pp-tok.skip');
        await expect(skipped.locator('.nm')).toHaveText(['B', 'C.TXT']);
        expect(await skipped.nth(0).locator('.pp-info').getAttribute('title')).toBe(REASON_LIMIT);
        expect(await skipped.nth(1).locator('.pp-info').getAttribute('title')).toBe(REASON_LIMIT);
        await expect(page.locator('#pull-pane-confirm')).toHaveText('Pull 10 files');
        await page.locator('#pull-pane-cancel').click();
        // The drop-affordance footer count is cap-aware too (composeFromText).
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await dragState(page, { active: true, text });
        await dispatchDrag(page, 'dragenter', text);
        await expect(page.locator('#pull-pane-foot')).toHaveText('⤓ Drop to pull 10 files');
        await dragState(page, { active: false });
    });
});

// ── S9.3 — rail bloom (FR-2 completion). Narrow viewport → container query
//    swaps card for rail; bloom overlays the card without any layout shift. ──
test.describe('E9 S9.3 — pull pane: rail bloom', () => {
    test.beforeEach(async ({ page }) => {
        await setup(page);
        await page.setViewportSize({ width: 720, height: 900 });
    });

    const hasBloomAttr = (page) => page.evaluate(() => document.getElementById('pull-pane').hasAttribute('data-bloom'));

    test('selection dragstart blooms the card open; dragend with no review un-blooms; zero layout shift @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [{ name: 'A.COM', size: 10 }] });
        await expect(page.locator(CARD)).toBeHidden();
        await expect(page.locator('#pull-pane .pp-rail')).toBeVisible();
        const canvasBefore = await page.locator('#terminal').evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        await dragState(page, { active: true, text: 'GAME.COM' });
        expect(await hasBloomAttr(page)).toBe(true);
        expect((await paneState(page)).bloom).toBe(true);
        await expect(page.locator(CARD)).toBeVisible();
        // NFR-5 — bloom is an overlay: the canvas never moves.
        const canvasDuring = await page.locator('#terminal').evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        expect(canvasDuring).toEqual(canvasBefore);
        // Dragend with no review open → un-bloom, card hidden again.
        await dragState(page, { active: false });
        expect(await hasBloomAttr(page)).toBe(false);
        await expect(page.locator(CARD)).toBeHidden();
    });

    test('rail click blooms (title = mockup copy); pointerdown outside un-blooms @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await expect(page.locator('#pull-pane .pp-rail'))
            .toHaveAttribute('title', 'Click or drag a selection here to open the pull pane');
        await page.locator('#terminal-wrapper').focus();
        await page.locator('#pull-pane .pp-rail').click();
        expect(await hasBloomAttr(page)).toBe(true);
        await expect(page.locator(CARD)).toBeVisible();
        // Bloom never moves focus off the wrapper (AC-8).
        expect(await page.evaluate(() => document.activeElement.id)).toBe('terminal-wrapper');
        // Pointerdown outside the pane (on the canvas) dismisses the click-bloom.
        const box = await page.locator('#terminal').boundingBox();
        await page.mouse.click(box.x + 20, box.y + 20);
        expect(await hasBloomAttr(page)).toBe(false);
        await expect(page.locator(CARD)).toBeHidden();
    });

    test('drop during bloom opens the review; bloom survives dragend and clears on review exit @fast', async ({ page }) => {
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await dragState(page, { active: true, text: 'GAME.COM' });
        expect(await hasBloomAttr(page)).toBe(true);
        await dispatchDrag(page, 'dragenter', 'GAME.COM');
        await dispatchDrag(page, 'drop', 'GAME.COM');
        // dragend after the drop: review is open → bloom stays for the decision.
        await dragState(page, { active: false });
        expect(await hasBloomAttr(page)).toBe(true);
        await expect(page.locator(CARD)).toHaveAttribute('data-view', 'review');
        // Review exit while bloomed → un-bloom (cancel path).
        await page.locator('#pull-pane-cancel').click();
        expect(await hasBloomAttr(page)).toBe(false);
        await expect(page.locator(CARD)).toBeHidden();
        expect((await paneState(page)).review).toBe(null);
    });

    test('wide window: card already visible → data-bloom never set @fast', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await bindFake(page, { name: 'MicroBeastPull', permission: 'granted', files: [] });
        await expect(page.locator(CARD)).toBeVisible();
        await dragState(page, { active: true, text: 'GAME.COM' });
        expect(await hasBloomAttr(page)).toBe(false);
        expect((await paneState(page)).bloom).toBe(false);
        await dragState(page, { active: false });
    });
});
