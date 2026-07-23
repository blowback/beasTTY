// Beastty Epic E9 Story S9.1a (FR-1/2/3, NFR-2/4/5, AD-9/AD-10/AD-11) — pull pane shell.
//
// Clones the paste-toast.spec.js shape: boot-race guard on the window.__pullPane
// hook, __resetForTests in beforeEach, @fast where no serial is needed. FSA picker
// and permission prompts can't run headless, so deterministic states are driven
// through the __setDirHandleForTests seam with an in-page fake directory handle
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
const FAKE_HANDLE_FACTORY = `
  (function makeFakeHandle({ name, permission, grantsTo, files }) {
    return {
      name,
      kind: 'directory',
      async queryPermission() { return permission; },
      async requestPermission() { return grantsTo || permission; },
      async *entries() {
        for (const f of files) {
          yield [f.name, { kind: 'file', async getFile() { return { size: f.size }; } }];
        }
        // A sub-directory the v1 one-level enumeration must skip.
        yield ['SUBDIR', { kind: 'directory' }];
      },
    };
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

// Drive a bound state via the test seam with an in-page fake handle.
async function bindFake(page, opts) {
    await page.evaluate(async ({ factory, o }) => {
        // eslint-disable-next-line no-eval
        const makeFakeHandle = eval(factory);
        await window.__pullPane.__setDirHandleForTests(makeFakeHandle(o));
    }, { factory: FAKE_HANDLE_FACTORY, o: opts });
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
