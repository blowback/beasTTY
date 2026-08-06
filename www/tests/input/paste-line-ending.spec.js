// Settings ▸ Paste line ending — every line break in PASTED text is rewritten to
// the configured terminator before it reaches the wire.
//
// This is one half of the paste-text-loss fix. The pump used to read the Enter
// key's CR/LF mode and substitute per byte on 0x0D alone, which meant LF-only
// clipboard text — the normal case on Linux — reached the wire as bare 0x0A in
// every mode and the MicroBeast never saw a line break at all. The same per-byte
// substitution turned CRLF text into a doubled break in 'crlf' mode.
//
// The oracle is #tx-strip (the debug pane's hex view of the TX ring), same as
// tests/input/crlf-override.spec.js — no serial connection needed, because
// tx-sink notifies its observers whether or not a writer is registered. Paste is
// driven through the debug pane's #paste-test button, which routes the textarea
// through parseHexEscapes → enqueuePaste, so \xNN produces real control bytes.
import { test, expect } from '@playwright/test';

const PASTE_EOL_PARENT = '#dropdown-settings .menu-item[data-submenu="paste-eol"]';
const pasteEolRow = (v) =>
    `#dropdown-settings .submenu[data-submenu-panel="paste-eol"] .menu-item[data-value="${v}"]`;
const CRLF_PARENT = '#dropdown-settings .menu-item[data-submenu="crlf"]';
const crlfRow = (v) =>
    `#dropdown-settings .submenu[data-submenu-panel="crlf"] .menu-item[data-value="${v}"]`;

// Boot-race guard (E0/E1 protocol): wait on the window.__* handles before driving.
async function ready(page) {
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('terminal').width > 0);
    await page.waitForFunction(
        () => window.__menuBar && typeof window.__menuBar.open === 'function');
    await page.waitForFunction(
        () => window.__pastePump && typeof window.__pastePump.getPasteLineEnding === 'function');
    await page.locator('#terminal-wrapper').focus();
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.locator('#tx-reset').click();
}

async function setPasteEol(page, value) {
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(PASTE_EOL_PARENT);
    await page.click(pasteEolRow(value));
    await page.evaluate(() => window.__menuBar.close());
    await page.locator('#terminal-wrapper').focus();
}

async function setCrlf(page, value) {
    await page.evaluate(() => window.__menuBar.open('settings'));
    await page.click(CRLF_PARENT);
    await page.click(crlfRow(value));
    await page.evaluate(() => window.__menuBar.close());
    await page.locator('#terminal-wrapper').focus();
}

// Paste `text` (with \xNN escapes) and read back the hex the wire saw.
async function paste(page, text) {
    await page.locator('#input').fill(text);
    await page.locator('#paste-test').click();
}

test.describe('Paste line ending — the rewrite matrix', () => {
    test('LF clipboard with ending CR sends 0x0D @fast', async ({ page }) => {
        await ready(page);
        // CR is the default, so this is also the out-of-the-box behaviour: the
        // ordinary Linux clipboard, pasted, arrives as a line break the
        // MicroBeast accepts.
        expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('cr');
        await paste(page, 'A\\x0AB');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D 42');
    });

    test('CRLF clipboard with ending CR sends ONE break, not two @fast', async ({ page }) => {
        await ready(page);
        // The regression this spec exists for: \r\n is ONE break. A per-byte
        // substitution would emit 0D 0A here (or 0D 0D in a naive fix).
        await paste(page, 'A\\x0D\\x0AB');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D 42');
    });

    test('CR clipboard with ending CRLF expands to 0x0D 0x0A @fast', async ({ page }) => {
        await ready(page);
        await setPasteEol(page, 'crlf');
        await paste(page, 'A\\x0DB');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D 0A 42');
    });

    test('mixed clipboard with ending LF normalises every form @fast', async ({ page }) => {
        await ready(page);
        await setPasteEol(page, 'lf');
        // All three break forms in one string: CRLF, bare LF, bare CR.
        await paste(page, 'A\\x0D\\x0AB\\x0AC\\x0DD');
        await expect(page.locator('#tx-strip')).toHaveText('41 0A 42 0A 43 0A 44');
    });

    test('ending As-is passes the clipboard bytes through untouched @fast', async ({ page }) => {
        await ready(page);
        await setPasteEol(page, 'raw');
        await paste(page, 'A\\x0D\\x0AB');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D 0A 42');
    });

    test('text with no line break is unchanged @fast', async ({ page }) => {
        await ready(page);
        await paste(page, 'ABC');
        await expect(page.locator('#tx-strip')).toHaveText('41 42 43');
    });

    test('a CRLF pair split across two pastes is not merged @fast', async ({ page }) => {
        await ready(page);
        // Normalisation happens per enqueue, so a CR ending one paste and an LF
        // opening the next are two separate breaks. Pinning it because the
        // alternative — carrying a pending CR across calls — is exactly the kind
        // of state the pump must not grow.
        await paste(page, 'A\\x0D');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D');
        await paste(page, '\\x0AB');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D 0D 42');
    });
});

test.describe('Paste line ending is independent of Enter key sends', () => {
    test('the two settings hold different values and neither reads the other @fast', async ({ page }) => {
        await ready(page);
        // Enter sends CRLF; paste rewrites breaks to LF. Nothing about that pair
        // is contradictory — one is the keyboard, the other is the clipboard.
        await setCrlf(page, 'crlf');
        await setPasteEol(page, 'lf');

        await page.keyboard.press('Enter');
        await expect(page.locator('#tx-strip')).toHaveText('0D 0A');

        await paste(page, 'A\\x0DB');
        await expect(page.locator('#tx-strip')).toHaveText('0D 0A 41 0A 42');
    });

    test('changing Enter key sends does NOT change what a paste emits @fast', async ({ page }) => {
        await ready(page);
        // The pre-fix pump read getCrlfMode(), so this was the whole bug surface:
        // the Enter setting silently governed paste too.
        await setCrlf(page, 'lf');
        expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('cr');
        await paste(page, 'A\\x0AB');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D 42');
    });
});

test.describe('Paste line ending — the menu row', () => {
    test('selecting a row persists AND applies (persist != apply) @fast', async ({ page }) => {
        await ready(page);
        await setPasteEol(page, 'crlf');
        expect(await page.evaluate(() => window.__prefs.getPrefs().pasteLineEnding)).toBe('crlf');
        expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('crlf');
    });

    test('submenu exclusivity: checking one unchecks the others @fast', async ({ page }) => {
        await ready(page);
        await page.evaluate(() => window.__menuBar.open('settings'));
        await page.click(PASTE_EOL_PARENT);
        await page.click(pasteEolRow('raw'));
        await expect(page.locator(pasteEolRow('raw'))).toHaveAttribute('data-checked', 'true');
        for (const other of ['cr', 'lf', 'crlf']) {
            await expect(page.locator(pasteEolRow(other))).toHaveAttribute('data-checked', 'false');
        }
    });

    test('a corrupt stored value leaves the pump on the default @fast', async ({ page }) => {
        // paste-pump validates at the consumer (the setCrlfMode precedent) —
        // prefs.js has no field validation, so a hand-edited or future-schema
        // blob can carry anything. The setter rejects it and the default stands.
        await page.addInitScript(() => localStorage.setItem(
            'beastty.prefs', JSON.stringify({ version: 2, pasteLineEnding: 'nonsense' })));
        await ready(page);
        expect(await page.evaluate(() => window.__pastePump.getPasteLineEnding())).toBe('cr');
        await paste(page, 'A\\x0AB');
        await expect(page.locator('#tx-strip')).toHaveText('41 0D 42');
    });
});
