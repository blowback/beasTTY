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
